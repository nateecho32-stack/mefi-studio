// Append-only JSONL segments sealed into monthly gzip archives
// (scripts/segment-archive.cjs), on real folders: the round trip and zcat,
// newest-first paging whose cursor survives a seal, a crash after every one of
// the six seal steps (every record kept exactly once), a torn last line, the
// month rolling over, a lost index rebuilt from the archive, the folder lock
// and the exit path's synchronous append.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const { createSegmentArchive, clearMemberCache, parseMemberHeader, repairTail, stampOf } = require("../scripts/segment-archive.cjs");

const JAN = Date.UTC(2026, 0, 31, 23, 50);
async function folder(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-archive-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir: path.join(dir, "logs"), archiveDir: path.join(dir, "archive") };
}
// Each instance has its own lock registry, as a separate process would.
function archive(where, { clock, ...options } = {}) {
  return createSegmentArchive({ ...where, kind: "log", clock: clock ?? (() => JAN), locks: new Set(), lockTries: 2, lockWaitMs: 5, ...options });
}
const records = (from, count, at = JAN) => Array.from({ length: count }, (_, index) => ({ t: at + from + index, n: from + index, msg: `line ${from + index}` }));
async function everything(store) {
  const seen = [];
  let before = null;
  for (let pages = 0; pages < 1000; pages += 1) {
    const page = await store.readBackward({ before, limit: 7 });
    seen.push(...page.rows);
    if (page.done) return seen;
    before = page.next;
  }
  throw new Error("paging never finished");
}
const months = async (where) => (await readdir(where.archiveDir)).filter((name) => name.endsWith(".jsonl.gz")).sort();
const segments = async (where) => (await readdir(where.dir)).filter((name) => name.endsWith(".jsonl")).sort();
const gunzipLines = async (file) => zlib.gunzipSync(await readFile(file)).toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));

test("records round-trip, a sealed month reads whole with zcat, and paging newest first sees each record once", async (t) => {
  const where = await folder(t);
  const store = archive(where, { maxBytes: 300 });
  await store.open();
  for (let batch = 0; batch < 6; batch += 1) await store.append(records(batch * 5, 5));
  await store.sealed();
  const seen = await everything(store);
  assert.deepEqual(seen.map((row) => row.n), Array.from({ length: 30 }, (_, index) => 29 - index));
  const [month] = await months(where);
  assert.equal(month, "2026-01.log.jsonl.gz");
  const archived = await gunzipLines(path.join(where.archiveDir, month));
  const waiting = (await Promise.all((await segments(where)).map((name) => readFile(path.join(where.dir, name), "utf8")))).join("").split("\n").filter(Boolean).length;
  assert.equal(archived.length + waiting, 30, `${archived.length} records sealed, ${waiting} still in a segment`);
  assert.ok(archived.length >= 25, "segments past 300 bytes were sealed");
  assert.deepEqual(archived.map((row) => row.n), Array.from({ length: archived.length }, (_, index) => index), "members back to back read as one stream, in order");
  const index = JSON.parse(await readFile(path.join(where.archiveDir, "2026-01.log.idx.json"), "utf8"));
  assert.equal(index.members.reduce((sum, member) => sum + member.count, 0), archived.length);
  const bytes = await readFile(path.join(where.archiveDir, month));
  const header = parseMemberHeader(bytes.subarray(index.members[0].off));
  assert.equal(header.name, index.members[0].segment, "each member names its segment in its own header");
  assert.equal(header.count, index.members[0].count);
  await store.close();
});

test("a paging cursor stays valid while its segment is sealed underneath it", async (t) => {
  const where = await folder(t);
  const store = archive(where);
  await store.open();
  await store.append(records(0, 20));
  const first = await store.readBackward({ limit: 5 });
  assert.deepEqual(first.rows.map((row) => row.n), [19, 18, 17, 16, 15]);
  await store.rotate();
  assert.deepEqual(await segments(where), [], "the segment went into the archive");
  clearMemberCache();
  const rest = [];
  let before = first.next;
  for (;;) {
    const page = await store.readBackward({ before, limit: 6 });
    rest.push(...page.rows.map((row) => row.n));
    if (page.done) break;
    before = page.next;
  }
  assert.deepEqual(rest, Array.from({ length: 15 }, (_, index) => 14 - index));
  const older = await store.readBackward({ before: JAN + 5, limit: 50 });
  assert.deepEqual(older.rows.map((row) => row.n), [4, 3, 2, 1, 0], "a time reads what is strictly older");
  await store.close();
});

for (const crashAt of [1, 2, 3, 4, 5, 6]) {
  test(`a crash after seal step ${crashAt} keeps every record exactly once`, async (t) => {
    const where = await folder(t);
    // One sealed member first, so step 3's truncation has a committed end to keep.
    const before = archive(where);
    await before.open();
    await before.append(records(0, 10));
    await before.rotate();
    await before.close();
    const doomed = archive(where, { hooks: { sealStep: async (step) => { if (step === crashAt) doomed.abandon(); } } });
    await doomed.open();
    await doomed.append(records(10, 10));
    await doomed.rotate().catch(() => {});
    await doomed.sealed().catch(() => {});
    // The crashed process never let go of its lock; the next one takes it over.
    const next = archive(where);
    await next.open();
    await next.sealed();
    clearMemberCache();
    const seen = (await everything(next)).map((row) => row.n);
    assert.deepEqual(seen, Array.from({ length: 20 }, (_, index) => 19 - index), `after step ${crashAt}`);
    await next.rotate();
    assert.deepEqual(await segments(where), []);
    const archived = (await gunzipLines(path.join(where.archiveDir, "2026-01.log.jsonl.gz"))).map((row) => row.n);
    assert.deepEqual(archived, Array.from({ length: 20 }, (_, index) => index), "the archive holds each record once, in order");
    const index = JSON.parse(await readFile(path.join(where.archiveDir, "2026-01.log.idx.json"), "utf8"));
    assert.equal(index.members.reduce((sum, member) => sum + member.count, 0), 20);
    assert.equal(index.end, (await readFile(path.join(where.archiveDir, "2026-01.log.jsonl.gz"))).length);
    await next.close();
  });
}

test("a member half written past the index's end is cut on the next seal, and the month still reads with zcat", async (t) => {
  const where = await folder(t);
  const store = archive(where);
  await store.open();
  await store.append(records(0, 5));
  await store.rotate();
  await store.close();
  // A crash in the middle of step 4: bytes no index entry accounts for.
  await appendFile(path.join(where.archiveDir, "2026-01.log.jsonl.gz"), Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
  const next = archive(where);
  await next.open();
  await next.append(records(5, 5));
  await next.rotate();
  clearMemberCache();
  assert.deepEqual((await gunzipLines(path.join(where.archiveDir, "2026-01.log.jsonl.gz"))).map((row) => row.n), Array.from({ length: 10 }, (_, index) => index));
  assert.deepEqual((await everything(next)).map((row) => row.n), Array.from({ length: 10 }, (_, index) => 9 - index));
  await next.close();
});

test("a torn last line is cut, and a whole record without its newline is completed", () => {
  const torn = repairTail(Buffer.from('{"t":1}\n{"t":2,"msg":"cut sh'));
  assert.deepEqual([torn.buffer.toString(), torn.cut, torn.completed], ['{"t":1}\n', '{"t":2,"msg":"cut sh'.length, false]);
  const whole = repairTail(Buffer.from('{"t":1}\n{"t":2}'));
  assert.deepEqual([whole.buffer.toString(), whole.cut, whole.completed], ['{"t":1}\n{"t":2}\n', 0, true]);
  assert.equal(repairTail(Buffer.from('{"t":1}\n')).cut, 0);
});

test("on open, a crash mid-write leaves no half record behind", async (t) => {
  const where = await folder(t);
  const store = archive(where);
  await store.open();
  await store.append(records(0, 3));
  const [name] = await segments(where);
  store.abandon();
  await appendFile(path.join(where.dir, name), '{"t":99,"n":99,"msg":"torn');
  const next = archive(where);
  await next.open();
  await next.append(records(3, 2));
  assert.deepEqual((await everything(next)).map((row) => row.n), [4, 3, 2, 1, 0]);
  const text = await readFile(path.join(where.dir, name), "utf8");
  assert.ok(text.split("\n").filter(Boolean).every((line) => JSON.parse(line)), "every line on disk is a whole record");
  await next.close();
});

test("the month rolling over seals the old month's segment into its own archive", async (t) => {
  const where = await folder(t);
  let now = JAN;
  const store = archive(where, { clock: () => now });
  await store.open();
  await store.append(records(0, 4, JAN));
  now = Date.UTC(2026, 1, 1, 0, 5);
  await store.append(records(4, 4, now));
  await store.sealed();
  assert.deepEqual(await months(where), ["2026-01.log.jsonl.gz"]);
  assert.match((await segments(where))[0], new RegExp(`^log\\.${stampOf(now).slice(0, 8)}`), "the new segment is February's");
  await store.rotate();
  assert.deepEqual(await months(where), ["2026-01.log.jsonl.gz", "2026-02.log.jsonl.gz"]);
  clearMemberCache();
  assert.deepEqual((await everything(store)).map((row) => row.n), [7, 6, 5, 4, 3, 2, 1, 0], "both months read as one history");
  await store.close();
});

test("an index lost outside Studio is rebuilt from the members' own headers", async (t) => {
  const where = await folder(t);
  const store = archive(where);
  await store.open();
  await store.append(records(0, 6));
  await store.rotate();
  await store.append(records(6, 6));
  await store.rotate();
  await store.close();
  await rm(path.join(where.archiveDir, "2026-01.log.idx.json"));
  clearMemberCache();
  const next = archive(where);
  await next.open();
  assert.deepEqual((await everything(next)).map((row) => row.n), Array.from({ length: 12 }, (_, index) => 11 - index), "readable as soon as the archive is open");
  await next.append(records(12, 2));
  await next.rotate();
  clearMemberCache();
  assert.deepEqual((await everything(next)).map((row) => row.n), Array.from({ length: 14 }, (_, index) => 13 - index));
  assert.deepEqual((await gunzipLines(path.join(where.archiveDir, "2026-01.log.jsonl.gz"))).map((row) => row.n), Array.from({ length: 14 }, (_, index) => index), "nothing committed was cut off");
  await next.close();
});

test("the folder lock: a live holder is refused, a dead one's lock is taken over", async (t) => {
  const where = await folder(t);
  const first = archive(where);
  await first.open();
  first.abandon();
  await writeFile(path.join(where.dir, "log.lock"), JSON.stringify({ pid: 4242, at: JAN }));
  const blocked = archive(where, { isAlive: () => true });
  await assert.rejects(blocked.open(), (error) => error.code === "ELOCKED" && /pid 4242/.test(error.message));
  const taker = archive(where, { isAlive: () => false });
  await taker.open();
  assert.equal(JSON.parse(await readFile(path.join(where.dir, "log.lock"), "utf8")).pid, process.pid);
  await taker.close();
  await assert.rejects(readFile(path.join(where.dir, "log.lock")), /ENOENT/, "close lets go of it");
});

test("the exit path appends synchronously, and the next open reads and seals it", async (t) => {
  const where = await folder(t);
  const store = archive(where);
  await store.open();
  await store.append(records(0, 2));
  assert.equal(store.appendSync(records(2, 3)), 3);
  store.closeSync();
  const next = archive(where);
  await next.open();
  assert.deepEqual((await everything(next)).map((row) => row.n), [4, 3, 2, 1, 0]);
  await next.close();
});
