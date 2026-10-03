// Mefi's Studio AI+ — append-only JSONL segments, sealed into monthly gzip archives.
//
// Studio's log, and later its ledgers and work journal, are kept whole: old
// lines are archived, never trimmed or rewritten (the owner's rule for 0.4.5).
// One instance is one stream, named by its `kind` (the log core's is "log"):
//
//   <dir>/<kind>.<stamp>.jsonl               append-only segments; the newest
//                                            takes new lines
//   <archiveDir>/<YYYY-MM>.<kind>.jsonl.gz   the month's sealed segments, one
//                                            gzip member each, back to back,
//                                            so zcat (or zlib.gunzipSync)
//                                            reads a whole month as one stream
//   <archiveDir>/<YYYY-MM>.<kind>.idx.json   {v:1, end, members:[{segment,
//                                            off, len, raw, first, last,
//                                            count}]}: where each member sits,
//                                            its decoded size, its first and
//                                            last record time and its lines
//
// A segment is sealed at 4 MB, when the month changes (UTC) or when it is 7
// days old; stamps and months come from the injected clock. Sealing is
// crash-safe, in six steps:
//   1. fsync the segment;
//   2. gzip it (async, on libuv's pool, not the main thread);
//   3. truncate the archive to the sidecar's `end`, which drops a member a
//      crash left behind after step 4 (it is sealed again from its segment);
//   4. append the member and fsync it (and the folder, on POSIX);
//   5. write the sidecar through a temporary file and a rename: the commit;
//   6. unlink the segment.
// A crash anywhere leaves the segment (sealed again on the next open) or the
// committed member (the segment then only goes, step 6), never both counted
// and never neither. Every member is a plain gzip member whose header also
// names its segment (FNAME) and carries its compressed length, line count and
// times (a FEXTRA field "Mf"), so an index lost outside Studio is rebuilt from
// the archive instead of cutting committed members off, and bytes nobody can
// account for are copied aside before a truncation, never just dropped.
//
// On open, leftover segments are sealed (oldest first), a torn last line in
// the newest (a crash mid-write) is cut, or completed when its JSON was
// whole, and the newest keeps taking lines unless its size, month or age says
// to seal it. One process writes a stream at a time: open() takes
// <dir>/<kind>.lock (the pid; a dead holder's lock is taken over, a live one
// is waited on for a few seconds, which covers a relaunch).
//
// Reading goes newest first across the active segment, segments waiting to
// be sealed and the archives, with a cursor ("<segment>#<line>") that stays
// valid while its segment is sealed. readMember() decodes one member with an
// async gunzip through a small shared cache (4 members, 16 MB at most).
//
// A file moved in from elsewhere (adopt, moveFile) falls back to copy, fsync
// and unlink when it sits on another volume (EXDEV).

"use strict";

const nodeFs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const deflateRaw = promisify(zlib.deflateRaw);
const gunzip = promisify(zlib.gunzip);

const LIMITS = Object.freeze({
  segmentBytes: 4 * 1024 * 1024,
  segmentAgeMs: 7 * 24 * 60 * 60 * 1000,
  cacheEntries: 4,
  cacheBytes: 16 * 1024 * 1024,
  page: 2000,
  budget: 50000,
  lockTries: 12,
  lockWaitMs: 500,
  sealRetryMs: 60000,
  sealTries: 5,
});

const KIND = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const SEGMENT = /^([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.(\d{8}T\d{9}Z)(?:-(\d{1,6}))?\.jsonl$/;
const SIDECAR = /^(\d{4}-\d{2})\.([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.idx\.json$/;
const SIDECAR_TEMP = /^(\d{4}-\d{2})\.([A-Za-z0-9][A-Za-z0-9_-]{0,39})\.idx\.json\.tmp-\d+$/;
const CURSOR = /^(.+)#(\d{1,9})$/;
const TIME_PREFIX = /^\{"(?:t|at)":(-?\d+(?:\.\d+)?)[,}]/;
const NEWLINE = Buffer.from("\n");
// The member's own header field: "Mf", version 1, then the compressed length,
// the line count and the first and last record time (NaN when unknown).
const TAG = [0x4d, 0x66];
const META_BYTES = 25;
const HEADER_READ = 1024;
const RETRYABLE_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);
const HELD_LOCKS = new Set();

// ---- names, stamps and months -------------------------------------------------------
const MAX_MS = 253402300799999;
function stampOf(ms) {
  const value = Number.isFinite(ms) ? Math.min(MAX_MS, Math.max(0, Math.floor(ms))) : 0;
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(".", "");
}
function msOfStamp(stamp) {
  const part = (from, to) => Number(stamp.slice(from, to));
  return Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(9, 11), part(11, 13), part(13, 15), part(15, 18));
}
const monthOfStamp = (stamp) => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}`;
const monthOf = (ms) => monthOfStamp(stampOf(ms));

function parseName(name) {
  const match = SEGMENT.exec(String(name ?? ""));
  return match ? { kind: match[1], stamp: match[2], n: match[3] ? Number(match[3]) : 0 } : null;
}
const formatName = (kind, stamp, n) => `${kind}.${stamp}${n ? `-${n}` : ""}.jsonl`;
/** Segment names in the order they were made: by stamp, then by counter. */
function compareNames(a, b) {
  const left = parseName(a), right = parseName(b);
  if (!left || !right) return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  if (left.stamp !== right.stamp) return left.stamp < right.stamp ? -1 : 1;
  return left.n - right.n;
}
function parseCursor(value) {
  const match = CURSOR.exec(String(value ?? ""));
  if (!match || !parseName(match[1])) throw new TypeError("That page cursor is not one this archive made.");
  return { name: match[1], line: Number(match[2]) };
}

// ---- lines ----------------------------------------------------------------------------
function defaultTimeOf(record) {
  const value = record?.t ?? record?.at ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// One line's record time. Records that start with their time ({"t":…) are
// read from the first bytes; anything else is parsed.
function lineTime(buffer, start, end, timeOf, fast) {
  if (fast) {
    const match = TIME_PREFIX.exec(buffer.toString("latin1", start, Math.min(end, start + 48)));
    if (match) return Number(match[1]);
  }
  try {
    const time = timeOf(JSON.parse(buffer.toString("utf8", start, end)));
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

/** Lines, first and last record time of newline-terminated JSONL bytes. */
function scanLines(buffer, timeOf = defaultTimeOf) {
  const fast = timeOf === defaultTimeOf;
  let count = 0, first = null, last = null, start = 0;
  for (;;) {
    const end = buffer.indexOf(10, start);
    if (end < 0) break;
    count += 1;
    if (end > start) {
      const time = lineTime(buffer, start, end, timeOf, fast);
      if (time !== null) {
        first = first === null ? time : Math.min(first, time);
        last = last === null ? time : Math.max(last, time);
      }
    }
    start = end + 1;
  }
  return { count, first, last, complete: start };
}

// Where each whole line starts and ends; an unterminated tail is not a line.
function lineIndex(buffer) {
  const starts = [], ends = [];
  let start = 0;
  for (;;) {
    const end = buffer.indexOf(10, start);
    if (end < 0) break;
    starts.push(start);
    ends.push(end);
    start = end + 1;
  }
  return { starts, ends };
}

function wholeRecord(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return Boolean(value) && typeof value === "object";
  } catch {
    return false;
  }
}

/**
 * A crash mid-write can leave a last line without its newline. When those
 * bytes are a whole JSON record the line is completed; otherwise it is cut.
 * { buffer, cut, completed }: `cut` bytes dropped, or one newline added.
 */
function repairTail(buffer) {
  const complete = buffer.lastIndexOf(10) + 1;
  if (complete === buffer.length) return { buffer, cut: 0, completed: false };
  const tail = buffer.subarray(complete);
  if (wholeRecord(tail)) return { buffer: Buffer.concat([buffer, NEWLINE]), cut: 0, completed: true };
  return { buffer: buffer.subarray(0, complete), cut: tail.length, completed: false };
}

function serialize(records, timeOf) {
  const lines = [];
  let first = null, last = null;
  for (const record of Array.isArray(records) ? records : [records]) {
    if (!record || typeof record !== "object") continue;
    let line;
    try {
      line = JSON.stringify(record);
    } catch {
      continue;
    }
    if (typeof line !== "string") continue;
    lines.push(line);
    const time = timeOf(record);
    if (Number.isFinite(time)) {
      first = first === null ? time : Math.min(first, time);
      last = last === null ? time : Math.max(last, time);
    }
  }
  return { text: lines.length ? `${lines.join("\n")}\n` : "", count: lines.length, first, last };
}

// ---- gzip members -------------------------------------------------------------------------
async function buildMember(raw, { name, count, first, last, mtime = 0 }) {
  const deflated = await deflateRaw(raw);
  const header = Buffer.alloc(10 + 2 + 4 + META_BYTES);
  header[0] = 0x1f;
  header[1] = 0x8b;
  header[2] = 8;
  header[3] = 0x04 | 0x08; // FEXTRA | FNAME
  header.writeUInt32LE(Math.max(0, Math.floor(mtime)) >>> 0, 4);
  header[8] = 0;
  header[9] = 255;
  header.writeUInt16LE(4 + META_BYTES, 10);
  header[12] = TAG[0];
  header[13] = TAG[1];
  header.writeUInt16LE(META_BYTES, 14);
  header[16] = 1;
  header.writeUInt32LE(deflated.length, 17);
  header.writeUInt32LE(count >>> 0, 21);
  header.writeDoubleLE(Number.isFinite(first) ? first : NaN, 25);
  header.writeDoubleLE(Number.isFinite(last) ? last : NaN, 33);
  const fname = Buffer.from(`${name}\0`, "latin1");
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(zlib.crc32(raw) >>> 0, 0);
  trailer.writeUInt32LE(raw.length >>> 0, 4);
  return Buffer.concat([header, fname, deflated, trailer]);
}

/** One of this module's member headers at the start of `bytes`, or null. */
function parseMemberHeader(bytes) {
  if (!bytes || bytes.length < 12 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) return null;
  const flags = bytes[3];
  if (!(flags & 0x04)) return null;
  const extraEnd = 12 + bytes.readUInt16LE(10);
  if (bytes.length < extraEnd) return null;
  let meta = null;
  for (let at = 12; at + 4 <= extraEnd;) {
    const length = bytes.readUInt16LE(at + 2);
    if (bytes[at] === TAG[0] && bytes[at + 1] === TAG[1] && length >= META_BYTES && at + 4 + length <= extraEnd) {
      const first = bytes.readDoubleLE(at + 13), last = bytes.readDoubleLE(at + 21);
      meta = { deflated: bytes.readUInt32LE(at + 5), count: bytes.readUInt32LE(at + 9), first: Number.isFinite(first) ? first : null, last: Number.isFinite(last) ? last : null };
    }
    at += 4 + length;
  }
  if (!meta) return null;
  let at = extraEnd, name = null;
  if (flags & 0x08) {
    const zero = bytes.indexOf(0, at);
    if (zero < 0) return null;
    name = bytes.toString("latin1", at, zero);
    at = zero + 1;
  }
  if (flags & 0x10) {
    const zero = bytes.indexOf(0, at);
    if (zero < 0) return null;
    at = zero + 1;
  }
  if (flags & 0x02) at += 2;
  return { name, count: meta.count, first: meta.first, last: meta.last, total: at + meta.deflated + 8 };
}

// ---- small file helpers ---------------------------------------------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ignoreMissing = (error) => { if (error?.code !== "ENOENT") throw error; };

async function exists(fsp, file) {
  try {
    await fsp.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readExactly(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
    if (!bytesRead) break;
    done += bytesRead;
  }
  return done === length ? buffer : buffer.subarray(0, done);
}

async function writeAll(handle, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, done, buffer.length - done, position + done);
    if (!bytesWritten) throw new Error("the archive took no bytes");
    done += bytesWritten;
  }
}

async function fsyncFile(fsp, file) {
  const handle = await fsp.open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// A folder's own entry list is made durable on POSIX; Windows has no handle
// for that and journals the rename itself.
async function fsyncDir(fsp, dir, platform) {
  if (platform === "win32") return;
  let handle = null;
  try {
    handle = await fsp.open(dir, "r");
    await handle.sync();
  } catch (error) {
    if (!["EISDIR", "EPERM", "EINVAL", "EBADF", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// A reader (a virus scanner, the Explorer preview) can hold the target for a
// moment on Windows; the rename is tried again before the step fails.
async function renameOver(fsp, from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      if (!RETRYABLE_RENAME.has(error?.code) || attempt >= 5) throw error;
      await delay(20 * 2 ** attempt);
    }
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Move a file, never over an existing one. On another volume (EXDEV) it is
 * copied beside the target, made durable, renamed into place, and only then
 * is the source unlinked. Resolves { copied }.
 */
async function moveFile(from, to, { fs: io = nodeFs, platform = process.platform } = {}) {
  const fsp = io.promises;
  await fsp.mkdir(path.dirname(to), { recursive: true });
  if (await exists(fsp, to)) throw Object.assign(new Error(`${to} already exists`), { code: "EEXIST" });
  try {
    await fsp.rename(from, to);
    return { copied: false };
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }
  const part = `${to}.part-${process.pid}`;
  try {
    await fsp.copyFile(from, part);
    await fsyncFile(fsp, part);
    await fsp.rename(part, to);
  } catch (error) {
    await fsp.rm(part, { force: true }).catch(() => {});
    throw error;
  }
  await fsyncDir(fsp, path.dirname(to), platform);
  await fsp.unlink(from);
  return { copied: true };
}

// ---- reading one member, through a small shared cache ------------------------------------
const memberCache = new Map();
const memberReads = new Map();
let memberCacheBytes = 0;

function remember(key, raw) {
  if (raw.length > LIMITS.cacheBytes) return;
  memberCache.set(key, raw);
  memberCacheBytes += raw.length;
  while (memberCache.size > LIMITS.cacheEntries || memberCacheBytes > LIMITS.cacheBytes) {
    const [oldest, value] = memberCache.entries().next().value;
    memberCache.delete(oldest);
    memberCacheBytes -= value.length;
  }
}

/**
 * The decoded bytes of one member ({off, len} from a sidecar), by an async
 * gunzip. The newest four decoded members (16 MB at most) stay cached, so a
 * reader paging through one member decodes it once. The buffer is shared:
 * callers must not change it.
 */
async function readMember(archivePath, member, { fs: io = nodeFs } = {}) {
  const off = Number(member?.off), len = Number(member?.len);
  if (!Number.isInteger(off) || off < 0 || !Number.isInteger(len) || len <= 0) throw new TypeError("readMember needs a member with its off and len");
  const key = `${path.resolve(String(archivePath))}|${member.segment ?? ""}|${off}|${len}`;
  const hit = memberCache.get(key);
  if (hit) {
    memberCache.delete(key);
    memberCache.set(key, hit);
    return hit;
  }
  if (memberReads.has(key)) return memberReads.get(key);
  const read = (async () => {
    const handle = await io.promises.open(archivePath, "r");
    let packed;
    try {
      packed = await readExactly(handle, off, len);
    } finally {
      await handle.close();
    }
    if (packed.length !== len) throw new Error(`${path.basename(String(archivePath))} ends inside the member at ${off}`);
    const raw = await gunzip(packed);
    remember(key, raw);
    return raw;
  })().finally(() => memberReads.delete(key));
  memberReads.set(key, read);
  return read;
}

function clearMemberCache() {
  memberCache.clear();
  memberCacheBytes = 0;
}
const memberCacheStats = () => ({ entries: memberCache.size, bytes: memberCacheBytes });

// ---- sidecars -------------------------------------------------------------------------------
const finiteOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isCount = (value) => Number.isInteger(value) && value >= 0;
function validSidecar(parsed) {
  if (!parsed || parsed.v !== 1 || !isCount(parsed.end) || !Array.isArray(parsed.members)) return null;
  const members = [];
  for (const member of parsed.members) {
    if (!member || typeof member.segment !== "string" || !isCount(member.off) || !isCount(member.len) || !member.len || !isCount(member.raw) || !isCount(member.count)) return null;
    members.push({ segment: member.segment, off: member.off, len: member.len, raw: member.raw, first: finiteOrNull(member.first), last: finiteOrNull(member.last), count: member.count });
  }
  return { v: 1, end: parsed.end, members };
}
const cloneSidecar = (data) => ({ v: 1, end: data.end, members: data.members.map((member) => ({ ...member })) });

// ---- the archive -------------------------------------------------------------------------------
/**
 * One stream of JSONL records. Options: dir, archiveDir (default dir), kind,
 * clock, maxBytes, maxAgeMs, timeOf(record) -> ms, fs, platform, onError(error,
 * where), and for tests hooks.sealStep(step, {name}), isAlive(pid), locks,
 * lockTries and lockWaitMs.
 */
function createSegmentArchive(options = {}) {
  const dir = String(options.dir ?? "");
  const kind = String(options.kind ?? "");
  if (!dir) throw new TypeError("createSegmentArchive needs a dir");
  if (!KIND.test(kind)) throw new TypeError("createSegmentArchive needs a kind of letters, digits, dash or underscore");
  const archiveDir = String(options.archiveDir || dir);
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
  const maxBytes = positive(options.maxBytes, LIMITS.segmentBytes);
  const maxAgeMs = positive(options.maxAgeMs, LIMITS.segmentAgeMs);
  const timeOf = typeof options.timeOf === "function" ? options.timeOf : defaultTimeOf;
  const io = options.fs ?? nodeFs;
  const fsp = io.promises;
  const platform = options.platform ?? process.platform;
  const hooks = options.hooks ?? null;
  const isAlive = typeof options.isAlive === "function" ? options.isAlive : processAlive;
  const locks = options.locks ?? HELD_LOCKS;
  const lockTries = positive(options.lockTries, LIMITS.lockTries);
  const lockWaitMs = positive(options.lockWaitMs, LIMITS.lockWaitMs);
  const onError = typeof options.onError === "function" ? options.onError : null;
  const lockFile = path.join(dir, `${kind}.lock`);

  const state = {
    opening: null,
    open: false,
    failed: null,
    dead: false,
    closing: false,
    lock: null,
    active: null, // { name, file, month, created, size, first, last }
    sealing: [],
    tries: new Map(),
    sidecars: new Map(),
    lastName: null,
    appendChain: Promise.resolve(),
    sealChain: Promise.resolve(),
  };

  const archiveName = (month) => `${month}.${kind}.jsonl.gz`;
  const archivePath = (month) => path.join(archiveDir, archiveName(month));
  const sidecarPath = (month) => path.join(archiveDir, `${month}.${kind}.idx.json`);
  const monthOfName = (name) => monthOfStamp(parseName(name).stamp);
  const ours = (name) => parseName(name)?.kind === kind;

  function report(error, where) {
    if (!onError) return;
    try {
      onError(error instanceof Error ? error : new Error(String(error)), where);
    } catch { /* a reporter never breaks the archive */ }
  }
  async function step(number, name) {
    if (hooks?.sealStep) await hooks.sealStep(number, { name });
    if (state.dead) throw Object.assign(new Error("the archive was abandoned"), { code: "EABANDONED" });
  }

  // ---- the lock ----------------------------------------------------------------------------
  async function readLock() {
    try {
      return JSON.parse(await fsp.readFile(lockFile, "utf8"));
    } catch {
      return null;
    }
  }
  async function takeLock() {
    for (let attempt = 0; attempt < lockTries * 2; attempt += 1) {
      if (locks.has(lockFile)) throw Object.assign(new Error(`${kind} in ${dir} is already open in this process`), { code: "ELOCKED" });
      try {
        await fsp.writeFile(lockFile, JSON.stringify({ pid: process.pid, at: clock() }), { flag: "wx" });
        locks.add(lockFile);
        state.lock = lockFile;
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      const holder = await readLock();
      const pid = Number(holder?.pid);
      // A lock of this pid that this process does not hold is a previous
      // life's (a crash, or a test's abandoned instance).
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !isAlive(pid)) {
        await fsp.rm(lockFile, { force: true });
        continue;
      }
      if (attempt + 1 >= lockTries) throw Object.assign(new Error(`another Studio process (pid ${pid}) keeps ${dir}`), { code: "ELOCKED" });
      await delay(lockWaitMs);
    }
    throw Object.assign(new Error(`${lockFile} could not be taken`), { code: "ELOCKED" });
  }
  function releaseLockSync() {
    const held = state.lock;
    if (!held) return;
    state.lock = null;
    locks.delete(held);
    try {
      if (Number(JSON.parse(io.readFileSync(held, "utf8"))?.pid) === process.pid) io.rmSync(held, { force: true });
    } catch { /* already gone */ }
  }

  // ---- opening ------------------------------------------------------------------------------
  function due(segment, now) {
    return segment.size >= maxBytes || monthOf(now) !== segment.month || now - segment.created >= maxAgeMs;
  }
  function known(name) {
    if (state.lastName === null || compareNames(name, state.lastName) > 0) state.lastName = name;
  }
  async function months() {
    let names = [];
    try {
      names = await fsp.readdir(archiveDir);
    } catch {
      return [];
    }
    return names.map((name) => SIDECAR.exec(name)).filter((match) => match && match[2] === kind).map((match) => match[1]).sort().reverse();
  }
  // A month's index. A missing one is empty (the first seal writes it); one
  // that cannot be opened right now throws, so the caller tries again later.
  async function loadSidecar(month) {
    if (state.sidecars.has(month)) return state.sidecars.get(month);
    const file = sidecarPath(month);
    let text;
    try {
      text = await fsp.readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      text = null;
    }
    let data = null;
    if (text !== null) {
      try {
        data = validSidecar(JSON.parse(text));
      } catch { /* reported below */ }
      if (!data) {
        // An index nobody can read is rebuilt from the archive's own member
        // headers at the next seal; the unreadable bytes are kept beside it.
        const aside = `${file}.broken-${stampOf(clock())}`;
        await fsp.writeFile(aside, text).catch(() => {});
        report(new Error(`${path.basename(file)} could not be read; kept as ${path.basename(aside)} and rebuilt from the archive`), "sidecar");
      }
    }
    data ??= { v: 1, end: 0, members: [] };
    state.sidecars.set(month, data);
    return data;
  }
  async function writeSidecar(month, data) {
    const target = sidecarPath(month);
    const temp = `${target}.tmp-${process.pid}`;
    const handle = await fsp.open(temp, "w");
    try {
      await handle.writeFile(JSON.stringify({ v: 1, end: data.end, members: data.members }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameOver(fsp, temp, target);
    await fsyncDir(fsp, archiveDir, platform);
    state.sidecars.set(month, cloneSidecar(data));
  }

  async function openNow() {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(archiveDir, { recursive: true });
    await takeLock();
    const present = (await fsp.readdir(dir)).sort();
    // Leftovers of a crash that are not data: an index write's temporary
    // file and a move's partial copy (its source was still in place).
    for (const name of present) {
      if (name.startsWith(`${kind}.`) && /\.jsonl\.part-\d+$/.test(name)) await fsp.rm(path.join(dir, name), { force: true }).catch(() => {});
    }
    for (const name of await fsp.readdir(archiveDir).catch(() => [])) {
      const temp = SIDECAR_TEMP.exec(name);
      if (temp && temp[2] === kind) await fsp.rm(path.join(archiveDir, name), { force: true }).catch(() => {});
    }
    const segments = present.filter(ours).sort(compareNames);
    // New names always sort after every name this stream has used.
    const newestMonth = (await months())[0];
    const archived = newestMonth ? await loadSidecar(newestMonth).catch(() => null) : null;
    for (const member of archived?.members ?? []) if (ours(member.segment)) known(member.segment);
    for (const name of segments) known(name);
    const newest = segments.pop();
    for (const name of segments) queueSeal(name);
    if (newest) await resume(newest);
  }

  // The newest segment keeps taking lines, once its torn tail is repaired,
  // unless it was already sealed (a crash between steps 5 and 6) or its size,
  // month or age says to seal it now.
  async function resume(name) {
    const file = path.join(dir, name);
    const month = monthOfName(name);
    const sidecar = await loadSidecar(month).catch(() => null);
    if (sidecar?.members.some((member) => member.segment === name)) {
      queueSeal(name);
      return;
    }
    const bytes = await fsp.readFile(file);
    const repaired = repairTail(bytes);
    if (repaired.cut) await fsp.truncate(file, bytes.length - repaired.cut);
    else if (repaired.completed) await fsp.appendFile(file, NEWLINE);
    if (repaired.cut || repaired.completed) report(new Error(`${name} ended in a torn line (${repaired.cut ? `${repaired.cut} bytes cut` : "completed"})`), "repair");
    const stats = scanLines(repaired.buffer, timeOf);
    const segment = { name, file, month, created: msOfStamp(parseName(name).stamp), size: repaired.buffer.length, first: stats.first, last: stats.last };
    if (due(segment, clock())) {
      queueSeal(name);
      return;
    }
    state.active = segment;
  }

  function open() {
    if (!state.opening) {
      state.opening = openNow().then(() => {
        state.open = true;
      }, (error) => {
        state.failed = error;
        report(error, "open");
        throw error;
      });
    }
    return state.opening;
  }

  // ---- appending -----------------------------------------------------------------------------
  function nameFor(now) {
    let stamp = stampOf(now), n = 0;
    const last = state.lastName ? parseName(state.lastName) : null;
    if (last && stamp <= last.stamp) {
      stamp = last.stamp;
      n = last.n + 1;
    }
    return { stamp, n };
  }
  async function startSegment(now) {
    let { stamp, n } = nameFor(now);
    while (await exists(fsp, path.join(dir, formatName(kind, stamp, n)))) n += 1;
    const name = formatName(kind, stamp, n);
    known(name);
    return { name, file: path.join(dir, name), month: monthOfStamp(stamp), created: msOfStamp(stamp), size: 0, first: null, last: null };
  }
  function startSegmentSync(now) {
    let { stamp, n } = nameFor(now);
    while (io.existsSync(path.join(dir, formatName(kind, stamp, n)))) n += 1;
    const name = formatName(kind, stamp, n);
    known(name);
    return { name, file: path.join(dir, name), month: monthOfStamp(stamp), created: msOfStamp(stamp), size: 0, first: null, last: null };
  }
  function grow(segment, bytes, batch) {
    segment.size += bytes;
    if (batch.first !== null) segment.first = segment.first === null ? batch.first : Math.min(segment.first, batch.first);
    if (batch.last !== null) segment.last = segment.last === null ? batch.last : Math.max(segment.last, batch.last);
  }
  function detach() {
    const segment = state.active;
    state.active = null;
    if (segment) queueSeal(segment.name);
  }

  async function appendNow(records) {
    await open();
    if (state.dead) return 0;
    const batch = serialize(records, timeOf);
    if (!batch.count) return 0;
    const now = clock();
    if (state.active && due(state.active, now)) detach();
    if (!state.active) state.active = await startSegment(now);
    const segment = state.active;
    const bytes = Buffer.from(batch.text, "utf8");
    try {
      await fsp.appendFile(segment.file, bytes);
    } catch (error) {
      // A failed append can leave part of the batch behind: cut back to the
      // last whole line so the next batch starts clean, or, failing that,
      // seal what is there (the seal cuts the torn line) and start afresh.
      await fsp.truncate(segment.file, segment.size).catch(() => {
        if (state.active === segment) detach();
      });
      throw error;
    }
    grow(segment, bytes.length, batch);
    if (segment.size >= maxBytes && state.active === segment) detach();
    return batch.count;
  }

  /** Append records (objects, one JSON line each). Resolves the count written. */
  function append(records) {
    if (state.closing) return Promise.reject(Object.assign(new Error("the archive is closed"), { code: "ECLOSED" }));
    const run = state.appendChain.then(() => appendNow(records));
    state.appendChain = run.catch(() => {});
    return run;
  }

  /**
   * The exit path: write now, synchronously, to the active segment (or a new
   * one). Whatever this leaves unsealed is sealed by the next open.
   */
  function appendSync(records) {
    if (state.dead || state.closing || state.failed) return 0;
    const batch = serialize(records, timeOf);
    if (!batch.count) return 0;
    io.mkdirSync(dir, { recursive: true });
    if (!state.lock) {
      // open() has not taken the lock yet: take it here or write nothing.
      try {
        io.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: clock() }), { flag: "wx" });
      } catch (error) {
        if (error?.code !== "EEXIST") return 0;
        let pid = NaN;
        try { pid = Number(JSON.parse(io.readFileSync(lockFile, "utf8"))?.pid); } catch { /* unreadable: treat as stale */ }
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) return 0;
        io.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: clock() }));
      }
      locks.add(lockFile);
      state.lock = lockFile;
    }
    const now = clock();
    if (state.active && due(state.active, now)) {
      state.sealing.push(state.active.name);
      state.active = null;
    }
    if (!state.active) state.active = startSegmentSync(now);
    const bytes = Buffer.from(batch.text, "utf8");
    io.appendFileSync(state.active.file, bytes);
    grow(state.active, bytes.length, batch);
    return batch.count;
  }

  // ---- sealing --------------------------------------------------------------------------------
  function settled(name) {
    state.sealing = state.sealing.filter((item) => item !== name);
    state.tries.delete(name);
  }
  function queueSeal(name) {
    if (!state.sealing.includes(name)) state.sealing.push(name);
    const run = state.sealChain.then(() => sealNow(name));
    state.sealChain = run.catch((error) => {
      if (state.dead || error?.code === "EABANDONED") return;
      report(error, "seal");
      // Kept on disk and read from there; tried again a little later.
      const tries = (state.tries.get(name) ?? 0) + 1;
      state.tries.set(name, tries);
      if (tries < LIMITS.sealTries) setTimeout(() => { if (!state.dead && !state.closing && state.sealing.includes(name)) queueSeal(name); }, LIMITS.sealRetryMs).unref?.();
    });
    return run;
  }

  // Bytes past the index's end: a member a crash left after step 4 (its
  // segment is still here, so it is sealed again), a member cut short by a
  // crash mid-append, or a committed member whose index entry was lost (its
  // segment is gone), which is kept and indexed. Anything else is copied
  // aside before the cut. Resolves the offset the next member goes at.
  async function settleTail(handle, data, month, sealing) {
    const size = (await handle.stat()).size;
    let changed = false;
    if (size < data.end) {
      const kept = data.members.filter((member) => member.off + member.len <= size);
      report(new Error(`${archiveName(month)} is ${data.end - size} bytes shorter than its index; ${data.members.length - kept.length} member(s) past its end are gone`), "archive");
      data.members = kept;
      data.end = kept.reduce((max, member) => Math.max(max, member.off + member.len), 0);
      changed = true;
    }
    const listed = new Set(data.members.map((member) => member.segment));
    let at = data.end, stranger = false;
    while (at < size) {
      const header = parseMemberHeader(await readExactly(handle, at, Math.min(HEADER_READ, size - at)));
      // A few unreadable bytes are a header cut short; more are not ours.
      if (!header) {
        stranger = size - at > HEADER_READ;
        break;
      }
      if (at + header.total > size) break;
      if (!header.name || !ours(header.name)) {
        stranger = true;
        break;
      }
      if (listed.has(header.name) || header.name === sealing || await exists(fsp, path.join(dir, header.name))) break;
      const trailer = await readExactly(handle, at + header.total - 4, 4);
      data.members.push({ segment: header.name, off: at, len: header.total, raw: trailer.readUInt32LE(0), first: header.first, last: header.last, count: header.count });
      listed.add(header.name);
      at += header.total;
      data.end = at;
      changed = true;
      report(new Error(`${header.name} was committed to ${archiveName(month)} but missing from its index; it is indexed again`), "archive");
    }
    if (changed) await writeSidecar(month, data);
    if (at < size) {
      if (stranger) {
        const aside = path.join(archiveDir, `${archiveName(month)}.tail-${stampOf(clock())}`);
        const out = await fsp.open(aside, "wx");
        try {
          for (let from = at; from < size; from += 1024 * 1024) await writeAll(out, await readExactly(handle, from, Math.min(1024 * 1024, size - from)), from - at);
          await out.sync();
        } finally {
          await out.close();
        }
        report(new Error(`${size - at} bytes past the index of ${archiveName(month)} were not a member; kept as ${path.basename(aside)}`), "archive");
      }
      await handle.truncate(at);
    }
    return at;
  }

  async function openArchive(file) {
    try {
      return { handle: await fsp.open(file, "r+"), created: false };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { handle: await fsp.open(file, "wx+"), created: true };
  }

  async function sealNow(name) {
    if (state.dead || (state.closing && !state.lock)) return;
    const file = path.join(dir, name);
    const month = monthOfName(name);
    let bytes;
    try {
      bytes = await fsp.readFile(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      settled(name);
      return;
    }
    const raw = repairTail(bytes).buffer;
    const current = await loadSidecar(month);
    const committed = current.members.find((member) => member.segment === name);
    if (committed) {
      if (committed.raw === raw.length) {
        await fsp.unlink(file).catch(ignoreMissing);
        await step(6, name);
      } else {
        // Committed once with other bytes: both copies are kept. The segment
        // goes on under a new name and is sealed as a member of its own.
        const renamed = formatName(kind, parseName(name).stamp, parseName(name).n + 1000);
        await moveFile(file, path.join(dir, renamed), { fs: io, platform });
        report(new Error(`${name} was already archived with other bytes; the rest is sealed as ${renamed}`), "seal");
        known(renamed);
        queueSeal(renamed);
      }
      settled(name);
      return;
    }
    if (!raw.length) {
      await fsp.unlink(file).catch(ignoreMissing);
      settled(name);
      return;
    }
    await fsyncFile(fsp, file);
    await step(1, name);
    const stats = scanLines(raw, timeOf);
    const member = await buildMember(raw, { name, count: stats.count, first: stats.first, last: stats.last, mtime: clock() / 1000 });
    await step(2, name);
    const next = cloneSidecar(current);
    const { handle, created } = await openArchive(archivePath(month));
    let end;
    try {
      end = await settleTail(handle, next, month, name);
      await step(3, name);
      await writeAll(handle, member, end);
      await handle.sync();
    } finally {
      await handle.close().catch(() => {});
    }
    if (created) await fsyncDir(fsp, archiveDir, platform);
    await step(4, name);
    next.members.push({ segment: name, off: end, len: member.length, raw: raw.length, first: stats.first, last: stats.last, count: stats.count });
    next.end = end + member.length;
    await writeSidecar(month, next);
    await step(5, name);
    await fsp.unlink(file);
    await step(6, name);
    settled(name);
  }

  /** Seal the active segment now. Resolves when every queued seal is done. */
  function rotate() {
    const run = state.appendChain.then(async () => {
      await open();
      if (state.active) detach();
    });
    state.appendChain = run.catch(() => {});
    return run.then(() => state.sealChain);
  }

  /**
   * Move an outside JSONL file in as a segment and seal it into the month of
   * `at` (default now). Across volumes it is copied, made durable, then
   * unlinked. Resolves { name, copied }.
   */
  async function adopt(file, { at = null } = {}) {
    await open();
    const stamp = stampOf(Number.isFinite(at) ? at : clock());
    const sidecar = await loadSidecar(monthOfStamp(stamp));
    const taken = new Set(sidecar.members.map((member) => member.segment));
    let n = 0;
    while (taken.has(formatName(kind, stamp, n)) || state.sealing.includes(formatName(kind, stamp, n)) || state.active?.name === formatName(kind, stamp, n) || await exists(fsp, path.join(dir, formatName(kind, stamp, n)))) n += 1;
    const name = formatName(kind, stamp, n);
    const { copied } = await moveFile(file, path.join(dir, name), { fs: io, platform });
    known(name);
    queueSeal(name);
    return { name, copied };
  }

  // ---- reading --------------------------------------------------------------------------------
  // Newest first: archived members, then segment files (the active one read
  // only up to what its appends have finished), one entry per segment name.
  async function sources() {
    await open().catch(() => {});
    const byName = new Map();
    for (const month of await months()) {
      const data = await loadSidecar(month).catch(() => null);
      for (const member of data?.members ?? []) {
        if (!byName.has(member.segment)) byName.set(member.segment, { name: member.segment, archive: archivePath(month), member, first: member.first });
      }
    }
    let present = [];
    try {
      present = (await fsp.readdir(dir)).filter(ours);
    } catch { /* no segments yet */ }
    for (const name of present) {
      if (byName.has(name)) continue;
      const active = state.active?.name === name ? state.active : null;
      byName.set(name, { name, file: path.join(dir, name), size: active ? active.size : null, first: active ? active.first : null });
    }
    return [...byName.values()].filter((source) => ours(source.name)).sort((a, b) => compareNames(b.name, a.name));
  }
  async function contentOf(source) {
    if (source.member) return readMember(source.archive, source.member, { fs: io });
    try {
      const bytes = await fsp.readFile(source.file);
      return source.size === null ? bytes : bytes.subarray(0, Math.min(bytes.length, source.size));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    // Sealed while it was being read: its archived member has the same lines.
    const month = monthOfName(source.name);
    state.sidecars.delete(month);
    const member = (await loadSidecar(month)).members.find((item) => item.segment === source.name);
    return member ? readMember(archivePath(month), member, { fs: io }) : Buffer.alloc(0);
  }

  /**
   * Records newest first. `before` is a time in ms (records before it) or the
   * `next` cursor of an earlier read. `match(record)` filters parsed records,
   * `prefilter(line)` may skip a raw line before it is parsed. Reads at most
   * `limit` rows and examines at most `budget` lines:
   * { rows, next, done } where `next` continues exactly where this stopped.
   */
  async function readBackward({ before = null, limit = 250, budget = LIMITS.budget, match = null, prefilter = null } = {}) {
    const max = Math.max(1, Math.min(LIMITS.page, Math.floor(Number(limit) || 250)));
    const lines = Math.max(1, Math.floor(Number(budget) || LIMITS.budget));
    const cursor = typeof before === "string" && before ? parseCursor(before) : null;
    const until = typeof before === "number" && Number.isFinite(before) ? before : null;
    const all = await sources();
    const rows = [];
    let scanned = 0;
    for (let at = 0; at < all.length; at += 1) {
      const source = all[at];
      let from = Infinity;
      if (cursor) {
        const order = compareNames(source.name, cursor.name);
        if (order > 0) continue;
        if (order === 0) from = cursor.line;
      }
      if (until !== null && source.first !== null && source.first !== undefined && source.first >= until) continue;
      let content;
      try {
        content = await contentOf(source);
      } catch (error) {
        // One unreadable member never hides the rest of the history.
        report(error, "read");
        continue;
      }
      const index = lineIndex(content);
      let line = Math.min(from, index.starts.length);
      while (line > 0) {
        line -= 1;
        scanned += 1;
        const text = content.toString("utf8", index.starts[line], index.ends[line]);
        if (!prefilter || prefilter(text)) {
          let record = null;
          try {
            record = JSON.parse(text);
          } catch { /* a line nobody can read is skipped */ }
          if (record && typeof record === "object" && !(until !== null && timeOf(record) >= until) && (!match || match(record))) rows.push(record);
        }
        if (rows.length >= max || scanned >= lines) {
          const done = line === 0 && at === all.length - 1;
          return { rows, next: done ? null : `${source.name}#${line}`, done };
        }
      }
    }
    return { rows, next: null, done: true };
  }

  // ---- lifecycle --------------------------------------------------------------------------------
  /** Wait for queued appends and seals, then let go of the lock. */
  async function close() {
    if (state.closing) return;
    state.closing = true;
    await state.appendChain;
    await state.sealChain;
    releaseLockSync();
  }
  /** The exit path: let go of the lock; what is queued stays on disk for the next open. */
  function closeSync() {
    state.closing = true;
    releaseLockSync();
  }
  /** Stop without any cleanup, as a crash would (tests). */
  function abandon() {
    state.dead = true;
  }

  return {
    dir,
    archiveDir,
    kind,
    open,
    append,
    appendSync,
    rotate,
    adopt,
    readBackward,
    close,
    closeSync,
    abandon,
    flushed: () => state.appendChain,
    sealed: () => state.sealChain,
    archivePath,
    sidecarPath,
    status: () => ({
      open: state.open,
      failed: state.failed ? String(state.failed.message ?? state.failed) : null,
      active: state.active ? { name: state.active.name, size: state.active.size } : null,
      sealing: [...state.sealing],
      locked: Boolean(state.lock),
    }),
  };
}

module.exports = {
  LIMITS,
  createSegmentArchive,
  readMember,
  clearMemberCache,
  memberCacheStats,
  moveFile,
  parseMemberHeader,
  buildMember,
  repairTail,
  scanLines,
  compareNames,
  parseName,
  stampOf,
  monthOf,
};
