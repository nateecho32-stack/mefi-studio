// scripts/scratch-host.cjs: the plain-file Scratch store (docs/plans/
// scratch-tier.md WP2) on an in-memory stand-in for fs.promises, so the
// bounds can be reached quickly: put, get, has, list, dedup, the quotas'
// refusals, key 20,001 refused with "full", a search that reads newest first
// and says partial past its budget, the cap's eviction order (expired first,
// then least recently used, never history), the pid lock refusing a second
// opener, a torn last index.jsonl line on open, a lost checkpoint, and a
// compaction that drops only what no key uses. One run on the real
// filesystem at the end proves the stand-in matches it.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import realFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createScratch, CHECKPOINT_EVERY } = require("../scripts/scratch-host.cjs");
const rules = require("../scripts/scratch-rules.cjs");

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const HASH = "b".repeat(64);

// fs.promises as the host uses it, in memory; paths compare with forward slashes.
function memoryFs() {
  const files = new Map();
  const dirs = new Set();
  const norm = (p) => String(p).replace(/\\/g, "/");
  const parent = (p) => p.slice(0, p.lastIndexOf("/"));
  const missing = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  return {
    files, dirs,
    async mkdir(p) { for (let d = norm(p); d && !dirs.has(d); d = parent(d)) dirs.add(d); },
    async writeFile(p, text, options) {
      const key = norm(p);
      if (options?.flag === "wx" && files.has(key)) throw Object.assign(new Error(`EEXIST: ${key}`), { code: "EEXIST" });
      files.set(key, String(text));
    },
    async appendFile(p, text) { const key = norm(p); files.set(key, (files.get(key) ?? "") + String(text)); },
    async readFile(p) { const key = norm(p); if (!files.has(key)) throw missing(key); return files.get(key); },
    async rename(from, to) { const key = norm(from); if (!files.has(key)) throw missing(key); files.set(norm(to), files.get(key)); files.delete(key); },
    async rm(p) { files.delete(norm(p)); },
    async readdir(p) {
      const base = `${norm(p)}/`;
      const out = new Set();
      for (const key of [...files.keys(), ...dirs]) if (key.startsWith(base)) out.add(key.slice(base.length).split("/")[0]);
      return [...out];
    },
    file: (p) => files.get(norm(p)),
    has: (p) => files.has(norm(p)),
  };
}

function clock(start = 1_000_000) {
  let t = start;
  const now = () => (t += 1000);
  now.set = (value) => { t = value; };
  now.peek = () => t;
  return now;
}

// A folder of its own per test: a lock this process holds is remembered by
// its path until the store closes, as it would be in Studio.
let DIR = "";
let folders = 0;
test.beforeEach(() => { folders += 1; DIR = `C:\\local\\scratch\\p${folders}`; });
function store(options = {}) {
  const fs = options.fs ?? memoryFs();
  const lines = [];
  const now = options.now ?? clock();
  const made = createScratch({ dir: DIR, capMB: 64, fs, now, log: (line) => lines.push(line), pid: 4242, isAlive: () => false, ...options });
  return { fs, lines, now, store: made };
}

test("put, get, has and list; a second put of the same text adds a key, not a copy; a get bumps `at`", async () => {
  const { store: s, fs, now } = store();
  assert.deepEqual(await s.open(), { ok: true, keys: 0, bytes: 0, host: "js" });
  const first = await s.put({ key: "run/r1/out.log", text: "the quick brown fox" });
  assert.equal(first.ok, true);
  assert.equal(first.dedup, false);
  assert.equal(first.bytes, 19);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.ok(fs.has(path.join(DIR, "blobs", first.hash.slice(0, 2), first.hash)), "one file per text, under its first two hex digits");
  const twin = await s.put({ key: "run/r1/copy.log", text: "the quick brown fox", kind: "output", meta: { step: 2 } });
  assert.deepEqual(twin, { ok: true, hash: first.hash, bytes: 19, dedup: true });
  const got = await s.get({ key: "run/r1/copy.log" });
  assert.deepEqual(got, { ok: true, key: "run/r1/copy.log", hash: first.hash, text: "the quick brown fox", bytes: 19, kind: "output", at: now.peek(), meta: { step: 2 } });
  assert.deepEqual(await s.get({ key: "run/r9/none" }), { ok: false, reason: "missing" });
  assert.equal((await s.get({ hash: first.hash })).text, "the quick brown fox", "a get by hash");
  assert.equal((await s.get({ hash: HASH })).reason, "missing");
  assert.deepEqual(await s.has({ key: "run/r9/none" }), { ok: true, has: false });
  assert.equal((await s.has({ key: "run/r1/out.log" })).has, true);
  const listed = await s.list({ prefix: "run/r1/" });
  assert.deepEqual(listed.items.map((item) => item.key), ["run/r1/copy.log", "run/r1/out.log"], "the most recently used first");
  assert.equal(listed.total, 2);
  assert.deepEqual((await s.list({ kind: "output" })).items.map((item) => item.key), ["run/r1/copy.log"]);
  assert.deepEqual((await s.list({ limit: 1 })).items.length, 1);
  const stats = await s.stats();
  assert.equal(stats.keys, 2);
  assert.equal(stats.blobs, 1);
  assert.equal(stats.liveBytes, 19);
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
  assert.equal(stats.capBytes, 64 * MiB);
  assert.equal(fs.file(path.join(DIR, "index.jsonl")).split("\n").filter(Boolean).length, 2, "two appended records");
});

test("the refusals: a bad key, a kind that does not fit, no text, odd meta, more than 256 KB", async () => {
  const { store: s } = store();
  assert.deepEqual(await s.put({ key: "run/r1", text: "x" }), { ok: false, reason: "bad-key" });
  assert.deepEqual(await s.put({ key: "shared/x", kind: "note", text: "x" }), { ok: false, reason: "bad-kind" });
  assert.deepEqual(await s.put({ key: "run/r1/x", text: 5 }), { ok: false, reason: "bad-text" });
  assert.deepEqual(await s.put({ key: "run/r1/x", text: "x", meta: [1] }), { ok: false, reason: "bad-meta" });
  assert.deepEqual(await s.put({ key: "run/r1/x", text: "x", meta: { big: "x".repeat(5000) } }), { ok: false, reason: "bad-meta" });
  assert.deepEqual(await s.put({ key: "run/r1/x", text: "x".repeat(256 * 1024 + 1) }), { ok: false, reason: "too-large" });
  assert.equal((await s.put({ key: "run/r1/x", text: "x".repeat(256 * 1024) })).ok, true, "exactly the quota fits");
  assert.equal((await s.put({ key: "run/r1/x", text: "" })).ok, true, "an empty text is a text");
});

test("key 20,001 is refused with full; a replaced key is not a new one; so is an index past 4 MB", async () => {
  const { store: s } = store();
  await s.open();
  for (let i = 0; i < rules.FALLBACK_LIMITS.keys; i += 1) {
    const put = await s.put({ key: `shared/k${i}`, text: `v${i}` });
    assert.equal(put.ok, true, `key ${i + 1}`);
  }
  assert.deepEqual(await s.put({ key: "shared/k20000", text: "one more" }), { ok: false, reason: "full" });
  assert.equal((await s.put({ key: "shared/k0", text: "replaced" })).ok, true, "writing an existing key again is not a new key");
  const stats = await s.stats();
  assert.equal(stats.keys, 20000);
  assert.equal(stats.full, true);
  assert.ok(stats.indexBytes > 1 * MiB && stats.indexBytes < rules.FALLBACK_LIMITS.indexBytes, `${stats.indexBytes} bytes of index in memory`);
  // The other bound: the encoded records' bytes.
  // Each record below encodes to about 152 bytes: two fit in 340, a third does not.
  const { store: tight } = store({ dir: `${DIR}-tight`, limits: { keys: 1000, indexBytes: 340, searchBytes: MiB } });
  assert.equal((await tight.put({ key: "shared/a", text: "x" })).ok, true);
  assert.equal((await tight.put({ key: "shared/b", text: "x" })).ok, true);
  assert.deepEqual(await tight.put({ key: "shared/c", text: "x" }), { ok: false, reason: "full" });
  assert.ok((await tight.stats()).indexBytes <= 340, "the refused record never counted");
});

test("a search reads texts newest first up to its budget and says partial past it; history is not searched", async () => {
  const { store: s, limits } = { ...store({ limits: { keys: 1000, indexBytes: MiB, searchBytes: 100 } }) };
  await s.put({ key: "run/r1/a", text: "fox ".repeat(10) });          // 40 bytes, oldest
  await s.put({ key: "run/r1/b", text: "fox fox ".repeat(5) });       // 40 bytes
  await s.put({ key: "run/r1/c", text: "fox fox fox fox fox fox fox fox fox fox" }); // 39 bytes, newest
  await s.put({ key: `history/${HASH}`, text: "fox fox fox fox fox fox fox fox" });
  const found = await s.search({ query: "fox" });
  assert.equal(found.ok, true);
  assert.equal(found.partial, true, "the third 40-byte text would pass 100 bytes");
  assert.equal(found.scanned, 2);
  assert.deepEqual(found.items.map((item) => item.key), ["run/r1/c", "run/r1/b"], "the two newest, c first (same score, more recent)");
  assert.ok(found.items[0].snippet.startsWith("fox fox"));
  assert.ok(found.items.every((item) => typeof item.score === "number" && item.score > 0 && item.hash));
  void limits;
  // With room for everything: not partial, and still never the history entry.
  const { store: roomy } = store({ dir: `${DIR}-roomy`, limits: { keys: 1000, indexBytes: MiB, searchBytes: MiB } });
  await roomy.put({ key: "run/r1/a", text: "alpha beta" });
  await roomy.put({ key: "shared/b", text: "alpha alpha" });
  await roomy.put({ key: `history/${HASH}`, text: "alpha alpha alpha" });
  await roomy.put({ key: "run/r1/quiet", text: "gamma", searchable: false });
  await roomy.put({ key: "run/r1/loud", text: "gamma", searchable: true });
  const all = await roomy.search({ query: "alpha" });
  assert.equal(all.partial, false);
  assert.deepEqual(all.items.map((item) => item.key), ["shared/b", "run/r1/a"]);
  assert.deepEqual((await roomy.search({ query: "gamma" })).items.map((item) => item.key), ["run/r1/loud"], "searchable can be set per record");
  assert.deepEqual((await roomy.search({ query: "alpha", prefix: "run/" })).items.map((item) => item.key), ["run/r1/a"]);
  assert.deepEqual((await roomy.search({ query: "alpha", kind: "shared" })).items.map((item) => item.key), ["shared/b"]);
  assert.deepEqual(await roomy.search({ query: "a" }), { ok: true, items: [], partial: false, scanned: 0 }, "no token longer than two characters: nothing to look for");
  assert.deepEqual((await roomy.search({ query: "alpha", limit: 1 })).items.length, 1);
});

test("over the cap, evictable kinds leave expired first, then least recently used, never history; a store that is still full says so", async () => {
  const now = clock(100 * DAY);
  // 200 bytes of room; every text below is 40 bytes.
  const { store: s } = store({ now, capMB: 200 / MiB });
  const text = (letter) => letter.repeat(40);
  assert.equal((await s.put({ key: `history/${HASH}`, text: text("h") })).ok, true);
  now.set(100 * DAY - 10 * DAY);
  assert.equal((await s.put({ key: "run/r1/expired", text: text("e") })).ok, true);
  now.set(100 * DAY - 3 * DAY);
  assert.equal((await s.put({ key: "shared/old", text: text("o") })).ok, true);
  now.set(100 * DAY - DAY);
  assert.equal((await s.put({ key: "run/r2/fresh", text: text("f") })).ok, true);
  now.set(100 * DAY);
  assert.equal((await s.put({ key: "task/t1/brief", text: text("t") })).ok, true);
  assert.equal((await s.stats()).liveBytes, 200, "full to the byte");
  // One more: the expired run scratch goes first.
  assert.equal((await s.put({ key: "shared/new1", text: text("1") })).ok, true);
  assert.equal((await s.has({ key: "run/r1/expired" })).has, false);
  assert.equal((await s.has({ key: "shared/old" })).has, true);
  // Another: the least recently used of the rest, shared/old, not history.
  assert.equal((await s.put({ key: "shared/new2", text: text("2") })).ok, true);
  assert.equal((await s.has({ key: "shared/old" })).has, false);
  assert.equal((await s.has({ key: `history/${HASH}` })).has, true);
  // A get makes a record recent, so it is the other one that goes.
  await s.get({ key: "run/r2/fresh" });
  assert.equal((await s.put({ key: "shared/new3", text: text("3") })).ok, true);
  assert.equal((await s.has({ key: "run/r2/fresh" })).has, true);
  assert.equal((await s.has({ key: "task/t1/brief" })).has, false);
  // Nothing evictable left but what is needed: full, and nothing was dropped for nothing.
  const { store: tiny } = store({ dir: `${DIR}-tiny`, now, capMB: 100 / MiB });
  assert.equal((await tiny.put({ key: `history/${HASH}`, text: text("h") })).ok, true);
  assert.equal((await tiny.put({ key: `history/${"c".repeat(64)}`, text: text("c") })).ok, true);
  assert.deepEqual(await tiny.put({ key: `history/${"d".repeat(64)}`, text: text("d") }), { ok: false, reason: "full" });
  assert.equal((await tiny.stats()).keys, 2);
  // A dedup put costs no bytes, so it fits a full store.
  assert.deepEqual(await tiny.put({ key: "shared/twin", text: text("h") }), { ok: true, hash: (await tiny.has({ key: `history/${HASH}` })).hash, bytes: 40, dedup: true });
  assert.deepEqual(await s.evict({ prefix: "shared/new" }), { ok: true, evicted: 3, bytes: 120 });
  assert.equal((await s.stats()).deadBytes, 120 + 120, "what left the index is dead on disk until a compaction");
});

test("evict without a prefix drops only what has expired", async () => {
  const now = clock(100 * DAY);
  const { store: s } = store({ now });
  now.set(100 * DAY - 8 * DAY);
  await s.put({ key: "run/r1/old", text: "old" });
  now.set(100 * DAY);
  await s.put({ key: "run/r1/new", text: "new" });
  await s.put({ key: "shared/forever", text: "shared" });
  assert.deepEqual(await s.evict({}), { ok: true, evicted: 1, bytes: 3 });
  assert.deepEqual((await s.list({})).items.map((item) => item.key).sort(), ["run/r1/new", "shared/forever"]);
});

test("the pid lock: a second opener in this process, or a live other process, is refused; a dead holder's lock is taken over", async () => {
  const fs = memoryFs();
  const first = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), pid: 4242, isAlive: () => true });
  assert.equal((await first.open()).ok, true);
  assert.deepEqual(JSON.parse(fs.file(path.join(DIR, "scratch.lock"))).pid, 4242);
  const second = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), pid: 4242, isAlive: () => true });
  assert.deepEqual(await second.open(), { ok: false, reason: "locked" });
  assert.deepEqual(await second.put({ key: "shared/x", text: "x" }), { ok: false, reason: "locked" }, "every call answers the refusal");
  assert.deepEqual(await first.close(), { ok: true });
  assert.equal(fs.has(path.join(DIR, "scratch.lock")), false, "closing gives the lock back");
  // Another live process holds it.
  await fs.writeFile(path.join(DIR, "scratch.lock"), JSON.stringify({ pid: 777, at: 1 }));
  const blocked = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), pid: 4242, isAlive: (pid) => pid === 777 });
  assert.deepEqual(await blocked.open(), { ok: false, reason: "locked" });
  // The holder died: taken over.
  const taken = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), pid: 4242, isAlive: () => false });
  assert.equal((await taken.open()).ok, true);
  assert.equal(JSON.parse(fs.file(path.join(DIR, "scratch.lock"))).pid, 4242);
  await taken.close();
  // An unreadable lock counts as stale.
  await fs.writeFile(path.join(DIR, "scratch.lock"), "not json");
  const over = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), pid: 4242, isAlive: () => true });
  assert.equal((await over.open()).ok, true);
  await over.close();
  assert.deepEqual(await over.open(), { ok: false, reason: "closed" });
});

test("a torn last line of index.jsonl, and a checkpoint that cannot be read, are survived on open", async () => {
  const { store: s, fs, lines } = store();
  await s.put({ key: "run/r1/a", text: "alpha" });
  await s.put({ key: "run/r1/b", text: "beta" });
  await s.put({ key: "run/r1/a", text: "alpha two" });
  const log = path.join(DIR, "index.jsonl");
  await fs.appendFile(log, '{"seq":4,"op":"put","key":"run/r1/c","hash":"ab');
  // The next Studio after a crash: a fresh process (its own lock memory), the old lock's pid dead.
  const again = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), log: (line) => lines.push(line), pid: 4343, isAlive: () => false, locks: new Set() });
  assert.deepEqual(await again.open(), { ok: true, keys: 2, bytes: 13, host: "js" }, "alpha two and beta");
  assert.equal((await again.get({ key: "run/r1/a" })).text, "alpha two", "the last whole record wins");
  assert.equal((await again.has({ key: "run/r1/c" })).has, false);
  assert.ok(lines.some((line) => line === "[scratch] 1 unreadable index line skipped on open"), lines.join("\n"));
  assert.ok(lines.every((line) => !line.includes(DIR) && !line.includes("local")), "no path in a log line");
  // The next put appends after the torn line with the right sequence number.
  assert.equal((await again.put({ key: "run/r1/d", text: "delta" })).ok, true);
  const lines2 = fs.file(log).split("\n").filter(Boolean);
  assert.equal(lines2.length, 5, "the torn line got its line end before the next record, which is whole");
  const records = lines2.map((line) => rules.decodeRecord(line)).filter(Boolean);
  assert.equal(records.length, 4);
  assert.equal(records.at(-1).seq, 4, "a torn record's number is not skipped: it was never applied");
  assert.equal(records.at(-1).key, "run/r1/d");
  await again.close();
  // A checkpoint that cannot be read: the log is replayed from the start.
  await fs.writeFile(path.join(DIR, "index.json"), "{broken");
  await fs.writeFile(log, records.map((record) => rules.encodeRecord(record)).join(""));
  const third = createScratch({ dir: DIR, capMB: 64, fs, now: clock(), log: (line) => lines.push(line), pid: 4444, isAlive: () => false, locks: new Set() });
  assert.equal((await third.open()).keys, 3);
  assert.ok(lines.some((line) => line.includes("the checkpoint could not be read")));
});

test("close writes the checkpoint and empties the log; a reopen reads the checkpoint and keeps counting", async () => {
  const { store: s, fs, now } = store();
  await s.put({ key: "run/r1/a", text: "alpha" });
  await s.get({ key: "run/r1/a" });
  await s.get({ key: "run/r9/missing" });
  const at = now.peek();
  await s.close();
  const snapshot = JSON.parse(fs.file(path.join(DIR, "index.json")));
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.seq, 1);
  assert.deepEqual(snapshot.entries.map((entry) => entry.key), ["run/r1/a"]);
  assert.equal(snapshot.entries[0].at, at, "the get's bump reached the checkpoint");
  assert.equal(snapshot.hits, 1);
  assert.equal(snapshot.misses, 1);
  assert.equal(fs.file(path.join(DIR, "index.jsonl")), "", "the log starts over after a checkpoint");
  const again = createScratch({ dir: DIR, capMB: 64, fs, now, pid: 4242, isAlive: () => false });
  assert.deepEqual(await again.open(), { ok: true, keys: 1, bytes: 5, host: "js" });
  assert.equal((await again.put({ key: "run/r1/b", text: "beta" })).ok, true);
  assert.equal(rules.decodeRecord(fs.file(path.join(DIR, "index.jsonl")).trim()).seq, 2, "the sequence carries on from the checkpoint");
  const stats = await again.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.keys, 2);
});

test(`a checkpoint happens by itself every ${CHECKPOINT_EVERY} records`, async () => {
  const { store: s, fs } = store();
  for (let i = 0; i < CHECKPOINT_EVERY - 1; i += 1) await s.put({ key: `shared/k${i}`, text: `v${i}` });
  assert.equal(fs.has(path.join(DIR, "index.json")), false);
  await s.put({ key: "shared/last", text: "v" });
  assert.equal(fs.has(path.join(DIR, "index.json")), true);
  assert.equal(fs.file(path.join(DIR, "index.jsonl")), "");
  assert.equal(JSON.parse(fs.file(path.join(DIR, "index.json"))).entries.length, CHECKPOINT_EVERY);
});

test("compact drops only what no key uses, writes a fresh checkpoint and keeps every live key readable", async () => {
  const { store: s, fs, now } = store();
  await s.put({ key: "run/r1/a", text: "alpha" });
  await s.put({ key: "run/r1/b", text: "beta" });
  await s.put({ key: "run/r1/b-twin", text: "beta" });
  await s.put({ key: "run/r1/c", text: "gamma" });
  await s.put({ key: "run/r1/a", text: "alpha again" });
  await s.evict({ prefix: "run/r1/c" });
  await s.evict({ prefix: "run/r1/b-twin" });
  // A blob a crash left behind with no record is dead too.
  await fs.mkdir(path.join(DIR, "blobs", "zz"));
  await fs.writeFile(path.join(DIR, "blobs", "zz", "z".repeat(64)), "orphan");
  const before = await s.stats();
  assert.equal(before.deadBytes, 5 + 5, "the old alpha and gamma");
  assert.equal(before.blobs, 2);
  const result = await s.compact();
  assert.deepEqual(result, { ok: true, removed: 3, keys: 2, bytes: 11 + 4 });
  const after = await s.stats();
  assert.equal(after.deadBytes, 0);
  assert.equal(after.generation, 1);
  assert.equal(after.lastCompactAt, now.peek());
  assert.equal(after.bytes, after.liveBytes);
  const shelves = await fs.readdir(path.join(DIR, "blobs"));
  let kept = 0;
  for (const shelf of shelves) kept += (await fs.readdir(path.join(DIR, "blobs", shelf))).length;
  assert.equal(kept, 2, "one file per live text");
  assert.equal((await s.get({ key: "run/r1/a" })).text, "alpha again");
  assert.equal((await s.get({ key: "run/r1/b" })).text, "beta");
  assert.equal((await s.get({ key: "run/r1/c" })).reason, "missing");
  assert.equal(fs.file(path.join(DIR, "index.jsonl")), "");
  assert.equal(rules.statsLine(await s.stats(), now.peek()), "Scratch: 0 MB of 64 MB, 2 keys, 67% hits, compacted just now");
  // The checkpoint reads back whole.
  await s.close();
  const again = createScratch({ dir: DIR, capMB: 64, fs, now, pid: 4242, isAlive: () => false });
  assert.deepEqual(await again.open(), { ok: true, keys: 2, bytes: 15, host: "js" });
  assert.equal((await again.stats()).generation, 1);
});

test("the stand-in matches the real filesystem: the same calls on a temp folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scratch-host-"));
  try {
    const now = clock();
    const s = createScratch({ dir, capMB: 64, fs: realFs, now, pid: process.pid });
    assert.deepEqual(await s.open(), { ok: true, keys: 0, bytes: 0, host: "js" });
    const put = await s.put({ key: "run/r1/out", text: "the quick brown fox", meta: { by: "test" } });
    assert.equal(put.ok, true);
    assert.deepEqual(await s.put({ key: "shared/twin", text: "the quick brown fox" }), { ok: true, hash: put.hash, bytes: 19, dedup: true });
    assert.equal((await s.get({ key: "run/r1/out" })).text, "the quick brown fox");
    assert.deepEqual((await s.search({ query: "quick fox" })).items.map((item) => item.key), ["run/r1/out", "shared/twin"], "the same score: the one just read is the more recent");
    const other = createScratch({ dir, capMB: 64, fs: realFs, now, pid: process.pid });
    assert.deepEqual(await other.open(), { ok: false, reason: "locked" }, "the same process twice");
    assert.equal((await s.evict({ prefix: "shared/" })).evicted, 1);
    assert.deepEqual(await s.compact(), { ok: true, removed: 0, keys: 1, bytes: 19 });
    await realFs.appendFile(path.join(dir, "index.jsonl"), '{"seq":9,"op":"put"');
    await s.close();
    const again = createScratch({ dir, capMB: 64, fs: realFs, now, pid: process.pid });
    assert.deepEqual(await again.open(), { ok: true, keys: 1, bytes: 19, host: "js" });
    assert.equal((await again.get({ key: "run/r1/out" })).meta.by, "test");
    await again.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
