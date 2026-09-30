// scripts/zip-lite.cjs: the in-memory zip writer Report a problem saves its
// bundle with. Written from the format, so it is read back three ways: by a
// reader in this file that walks the central directory and inflates each entry
// with node:zlib, by release-updater's own extractZip (which the app already
// trusts with real releases), and, when a Python is on the machine, by
// zipfile's testzip.
//
// Run: node --test tests/zip_lite.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { extractZip } from "../scripts/release-updater.mjs";

const require = createRequire(import.meta.url);
const { crc32, entryName, zip, MAX_ENTRIES } = require("../scripts/zip-lite.cjs");

// A reader from the format: end of central directory, central directory, local header, data.
function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, "an end of central directory record");
  const count = buffer.readUInt16LE(end + 10);
  assert.equal(buffer.readUInt16LE(end + 8), count, "one disk, all entries on it");
  let at = buffer.readUInt32LE(end + 16);
  assert.equal(at + buffer.readUInt32LE(end + 12), end, "the directory ends where the end record starts");
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, "a central directory record");
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10), time = buffer.readUInt16LE(at + 12), date = buffer.readUInt16LE(at + 14);
    const crc = buffer.readUInt32LE(at + 16), packed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50, `${name}: a local header`);
    assert.equal(buffer.toString("utf8", offset + 30, offset + 30 + buffer.readUInt16LE(offset + 26)), name, "the local header names the same file");
    assert.equal(buffer.readUInt32LE(offset + 14), crc, "and carries the same CRC");
    assert.equal(buffer.readUInt16LE(offset + 6), flags, "the same flags (names marked UTF-8 in both places)");
    assert.equal(buffer.readUInt16LE(offset + 8), method, "the same method");
    assert.equal(buffer.readUInt32LE(offset + 18), packed, "the same packed size");
    assert.equal(buffer.readUInt32LE(offset + 22), size, "and the same size");
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const body = buffer.subarray(start, start + packed);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(data.length, size, `${name}: the size in the directory is the size of the data`);
    entries.push({ name, data, method, flags, time, date, crc });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return entries;
}

const TEXT = "Studio closed unexpectedly. ".repeat(200);

test("crc32 is the standard one", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926, "the check value of CRC-32");
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from("6789"), crc32(Buffer.from("12345"))), 0xcbf43926, "a value can be continued");
});

test("what goes in comes out: names, bytes, CRCs, in the order given, with UTF-8 names", () => {
  const entries = [
    { name: "manifest.json", data: '{ "studio": "0.5.0" }\n' },
    { name: "trace-tail.log", data: TEXT },
    { name: "notes/über café.txt", data: Buffer.from([0, 1, 2, 250, 251, 252, 255]) },
    { name: "empty.log", data: "" },
  ];
  const bytes = zip(entries, { at: Date.UTC(2026, 8, 30, 15, 44, 40) });
  const back = readZip(bytes);
  assert.deepEqual(back.map((entry) => entry.name), entries.map((entry) => entry.name));
  for (const [index, entry] of back.entries()) {
    const want = Buffer.isBuffer(entries[index].data) ? entries[index].data : Buffer.from(entries[index].data);
    assert.ok(entry.data.equals(want), `${entry.name} is byte for byte what went in`);
    assert.equal(entry.crc, crc32(want), `${entry.name} has its CRC`);
    assert.equal(entry.flags & 0x0800, 0x0800, "names are marked UTF-8");
  }
  assert.equal(back[1].method, 8, "text is deflated");
  assert.ok(bytes.length < TEXT.length, "and shrinks");
  assert.equal(back[2].method, 0, "bytes that do not shrink are stored");
  assert.equal(back[3].method, 8, "an empty file is deflated (two bytes), so a reader that cuts by size can take it");
  // 2026-09-30 15:44:40 in DOS fields (two-second steps from 1980).
  assert.equal(back[0].date, ((2026 - 1980) << 9) | (9 << 5) | 30);
  assert.equal(back[0].time, (15 << 11) | (44 << 5) | 20);
});

test("the same input is the same bytes, and the epoch is the default time", () => {
  const entries = [{ name: "a.txt", data: "one" }, { name: "b.txt", data: TEXT }];
  assert.ok(zip(entries).equals(zip(entries)));
  assert.ok(zip(entries, { at: 1_800_000_000_000 }).equals(zip(entries, { at: 1_800_000_000_000 })));
  const [first] = readZip(zip(entries));
  assert.equal(first.date, (0 << 9) | (1 << 5) | 1, "1980-01-01 without a time");
  assert.deepEqual(readZip(zip([])), []);
});

test("the zip the app already trusts with releases reads it, and so does Python's zipfile", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-ziplite-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "report.zip");
  const entries = [{ name: "manifest.json", data: "{}\n" }, { name: "builders.log", data: TEXT }, { name: "crash.jsonl", data: '{"kind":"renderer-gone"}\n' }, { name: "empty.log", data: "" }];
  await writeFile(file, zip(entries, { at: Date.UTC(2026, 8, 30, 12, 0, 0) }));
  const out = path.join(dir, "out");
  const extracted = await extractZip(file, out);
  assert.ok(extracted, "extractZip accepted it");
  for (const entry of entries) assert.equal(await readFile(path.join(out, entry.name), "utf8"), entry.data, `${entry.name} extracts`);
  for (const python of ["python3", "python"]) {
    const probe = spawnSync(python, ["-c", "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); sys.exit(0 if z.testzip() is None and len(z.namelist()) == 4 else 1)", file], { encoding: "utf8" });
    if (probe.error) continue;
    assert.equal(probe.status, 0, `${python}: ${probe.stderr}`);
    break;
  }
});

test("a name that could escape the folder, a repeated name or a huge bundle is refused, never written", () => {
  for (const bad of ["../x.txt", "/abs.txt", "a/../b.txt", "a//b.txt", "C:\\x.txt", "a\\b.txt", "", ".", "bad\u0000name", "x".repeat(600), "trailing/", "q?.txt", undefined]) {
    assert.throws(() => zip([{ name: bad, data: "x" }]), /not a usable name/, JSON.stringify(bad));
  }
  assert.throws(() => zip([{ name: "a.txt", data: "1" }, { name: "A.TXT", data: "2" }]), /twice/, "a name that differs only by case is the same file on Windows");
  assert.throws(() => zip(Array.from({ length: MAX_ENTRIES + 1 }, (_, index) => ({ name: `f${index}.txt`, data: "" }))), /at most/);
  assert.equal(entryName("dir/file.txt"), "dir/file.txt");
});
