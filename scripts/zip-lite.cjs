// Mefi's Studio AI+ — a small zip writer for bundles that are built in memory.
//
// Report a problem builds five text files on this PC and hands the owner one
// zip (scripts/crash-report.cjs decides what is in it, main.cjs's "Report a
// problem" block saves it). scripts/release-updater.mjs already has a
// streaming writer for whole release folders, but it zips a directory to a
// path; this one takes named strings or buffers and returns the bytes, so the
// file a person previewed is exactly the file that is saved. Each entry is
// deflated, carries its CRC-32 and sizes in its local header (no data
// descriptor), and names are UTF-8 (general purpose bit 11) with `/`
// separators. No zip64, no encryption, no comments: a bundle is a few hundred
// kilobytes. tests/zip_lite.test.mjs reads the result back three ways
// (a reader written from the format, node:zlib on each entry, and
// release-updater's extractZip).
//
// Pure module: no Electron, no filesystem, no network, no clock reads. The
// modified time is passed in (`at`, milliseconds), and defaults to the DOS
// epoch so the same input always gives the same bytes.

"use strict";

const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** The CRC-32 of a buffer, as an unsigned number. `seed` continues an earlier value. */
function crc32(buffer, seed = 0) {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let index = 0; index < buffer.length; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time: two-second resolution from 1980, local fields as given.
function dosStamp(at) {
  const date = new Date(Number.isFinite(at) ? at : Date.UTC(1980, 0, 1));
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

const MAX_ENTRIES = 1000;
const NAME_PATTERN = /^[^\\/:*?"<>|\u0000-\u001f][^\\:*?"<>|\u0000-\u001f]*$/;

/** A name that is safe as an entry: relative, forward slashes, no `..` step, no drive, no control characters. */
function entryName(name) {
  const text = String(name ?? "");
  if (!text || text.length > 512 || !NAME_PATTERN.test(text) || text.startsWith("/") || text.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`not a usable name inside a zip: ${JSON.stringify(text.slice(0, 80))}`);
  }
  return text;
}

/**
 * The bytes of a zip holding `entries` ([{ name, data }], data a string or a
 * Buffer), in the order given. `at` is the modified time of every entry.
 * A name given twice, an unusable name or more than 1000 entries throws.
 */
function zip(entries, { at = Date.UTC(1980, 0, 1) } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length > MAX_ENTRIES) throw new Error(`a bundle holds at most ${MAX_ENTRIES} files`);
  const stamp = dosStamp(at);
  const seen = new Set();
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of list) {
    const name = entryName(entry?.name);
    if (seen.has(name.toLowerCase())) throw new Error(`the name ${name} is in the zip twice`);
    seen.add(name.toLowerCase());
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ""), "utf8");
    if (raw.length >= 0xffffffff) throw new Error(`${name} is too large for a zip entry`);
    const packed = zlib.deflateRawSync(raw, { level: 6 });
    // A file that does not shrink is stored. An empty one is deflated (two
    // bytes) rather than stored with no data at all: a reader that cuts an
    // entry's data by its size, like release-updater's extractZip, cannot
    // take an entry with none.
    const stored = raw.length > 0 && packed.length >= raw.length;
    const body = stored ? raw : packed;
    const method = stored ? 0 : 8;
    const crc = crc32(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30 + nameBytes.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    nameBytes.copy(header, 30);
    local.push(header, body);
    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x031e, 4); // made by: Unix, spec 3.0
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(0o100644 << 16 >>> 0, 38); // external attributes: a regular file, rw-r--r--
    record.writeUInt32LE(offset, 42);
    nameBytes.copy(record, 46);
    central.push(record);
    offset += header.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

module.exports = { zip, crc32, entryName, MAX_ENTRIES };
