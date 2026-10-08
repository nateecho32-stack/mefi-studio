// Mefi's Studio AI+ — Scratch's plain-file host: the slower memory tier when
// the Rust arena is not there (the Electron build; docs/plans/scratch-tier.md
// WP2). It answers exactly like the Rust surface (`core.scratch.*`), with
// scripts/scratch-rules.cjs deciding keys, kinds, quotas, eviction and the
// search's ranking, so main.cjs and the desk never know which one they got.
//
// On disk, per project (scripts/local-dirs.cjs scratchDir):
//   blobs/<hh>/<sha256>   one file per distinct text, content-addressed, so a
//                         second put of the same bytes adds a key, not a copy
//   index.jsonl           appended records (scratch-rules encodeRecord)
//   index.json            a checkpoint of the live index (temp file + rename);
//                         the log is emptied right after one is written
//   scratch.lock          this process's pid; a live holder refuses a second
//                         Studio ({ ok: false, reason: "locked" })
//
// Bounded so it never becomes the board problem again: only index records
// live in memory (FALLBACK_LIMITS.keys of them, indexBytes of their encoded
// form; past either a put answers "full"); `get` reads one file; `search`
// reads texts newest first up to searchBytes and says `partial` past it; a
// get's `at` bump stays in memory until the next checkpoint. Every write is
// fs.promises, one at a time, and nothing here runs on a synchronous path.
// Open tolerates a torn last line of index.jsonl (a crash mid-append) and an
// unreadable checkpoint (the log is replayed from the start).

"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const rules = require("./scratch-rules.cjs");

const MiB = 1024 * 1024;
const CHECKPOINT_EVERY = 1000;
const LOCK_TRIES = 3;
const META_MAX = 4096;
const LIST_MAX = 1000;
const SEARCH_MAX = 50;
// Locks this process holds, so a second createScratch on the same folder in
// one process is refused like a second process would be.
const HELD = new Set();

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const plainMeta = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
const byRecent = (a, b) => b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * createScratch({ dir, capMB, fs, now, log, pid, isAlive, limits, quotas })
 * fs is node:fs/promises (or a stand-in); now() the clock; log(line) a bounded
 * log line without paths. Every method answers { ok, ... } and never throws;
 * a failure answers { ok: false, reason } with reason one of "locked",
 * "bad-key", "bad-kind", "bad-text", "bad-meta", "too-large", "full",
 * "missing", "closed" or "error".
 */
function createScratch({ dir, capMB, fs, now = Date.now, log = () => {}, pid = process.pid, isAlive = processAlive, limits = rules.FALLBACK_LIMITS, quotas = rules.QUOTAS, locks = HELD } = {}) {
  if (typeof dir !== "string" || !dir) throw new TypeError("createScratch needs a folder");
  if (!fs || typeof fs.writeFile !== "function") throw new TypeError("createScratch needs fs.promises");
  // Settings keep capMB within rules.CAP_MB; here any positive number is a
  // cap, so a test can fill a store of a few hundred bytes.
  const cap = Number.isFinite(capMB) && capMB > 0 ? capMB : rules.DEFAULTS.capMB;
  const capBytes = Math.round(cap * MiB);
  const blobsDir = path.join(dir, "blobs");
  const logFile = path.join(dir, "index.jsonl");
  const snapFile = path.join(dir, "index.json");
  const lockFile = path.join(dir, "scratch.lock");
  const blobPath = (hash) => path.join(blobsDir, hash.slice(0, 2), hash);

  const state = {
    opened: false, closed: false, lock: false,
    index: new Map(),   // key -> { key, hash, bytes, kind, at, meta, ttlMs, searchable, line }
    blobs: new Map(),   // hash -> { bytes, refs }
    indexBytes: 0, liveBytes: 0, deadBytes: 0,
    seq: 0, since: 0, dirty: false,
    hits: 0, misses: 0, generation: 0, lastCompactAt: null,
    stamp: 0,           // bumps on every change: the search cache's key
    search: null,       // { stamp, tokens: Map(hash -> string[]) }
  };

  // ---- one thing at a time -------------------------------------------------------------
  let chain = Promise.resolve();
  function exclusive(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }
  const failed = (error, where) => {
    log(`[scratch] ${where} failed: ${String(error?.code ?? error?.message ?? error).slice(0, 80)}`);
    return { ok: false, reason: "error" };
  };

  // ---- the index in memory ----------------------------------------------------------------
  function release(entry) {
    state.indexBytes -= entry.line;
    const blob = state.blobs.get(entry.hash);
    if (!blob) return;
    blob.refs -= 1;
    if (blob.refs <= 0) {
      state.blobs.delete(entry.hash);
      state.liveBytes -= blob.bytes;
      state.deadBytes += blob.bytes;
    }
  }
  function apply(record) {
    state.stamp += 1;
    if (record.op === "put") {
      const old = state.index.get(record.key);
      if (old) release(old);
      const entry = {
        key: record.key, hash: record.hash, bytes: record.bytes, kind: record.kind, at: record.at,
        meta: plainMeta(record.meta), ttlMs: Number.isFinite(record.ttlMs) && record.ttlMs > 0 ? record.ttlMs : null,
        searchable: typeof record.searchable === "boolean" ? record.searchable : null, line: rules.encodeRecord(record).length,
      };
      state.index.set(record.key, entry);
      state.indexBytes += entry.line;
      const blob = state.blobs.get(record.hash);
      if (blob) blob.refs += 1;
      else { state.blobs.set(record.hash, { bytes: record.bytes, refs: 1 }); state.liveBytes += record.bytes; }
    } else if (record.op === "del") {
      const old = state.index.get(record.key);
      if (old) { release(old); state.index.delete(record.key); }
    } else if (record.op === "touch") {
      const entry = state.index.get(record.key);
      if (entry) entry.at = record.at;
    }
  }
  const searchable = (entry) => (entry.searchable === null ? rules.KINDS[entry.kind]?.searchable === true : entry.searchable);
  const summary = (entry) => ({ key: entry.key, hash: entry.hash, bytes: entry.bytes, kind: entry.kind, at: entry.at, meta: entry.meta });

  // ---- the files ----------------------------------------------------------------------------
  async function append(record) {
    // A torn last line (a crash mid-append) gets its line end first, so the
    // next record is not glued to it and lost with it.
    const lead = state.torn ? "\n" : "";
    state.torn = false;
    await fs.appendFile(logFile, `${lead}${rules.encodeRecord(record)}`, "utf8");
    apply(record);
    state.since += 1;
    state.dirty = true;
  }
  async function writeOver(file, text) {
    const temp = `${file}.tmp-${pid}`;
    await fs.writeFile(temp, text, "utf8");
    await fs.rename(temp, file);
  }
  // The checkpoint: the live index to index.json, then an empty log. A crash
  // between the two leaves records the next open skips by their seq.
  async function checkpoint() {
    const snapshot = {
      version: 1, seq: state.seq, generation: state.generation, lastCompactAt: state.lastCompactAt, hits: state.hits, misses: state.misses,
      entries: [...state.index.values()].map(({ line, ...entry }) => entry),
    };
    await writeOver(snapFile, JSON.stringify(snapshot));
    await writeOver(logFile, "");
    state.since = 0;
    state.dirty = false;
  }
  async function writeBlob(hash, text) {
    const file = blobPath(hash);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeOver(file, text);
  }

  // ---- the lock -----------------------------------------------------------------------------
  async function takeLock() {
    if (locks.has(lockFile)) return false;
    for (let attempt = 0; attempt < LOCK_TRIES; attempt += 1) {
      try {
        await fs.writeFile(lockFile, JSON.stringify({ pid, at: now() }), { flag: "wx" });
        locks.add(lockFile);
        state.lock = true;
        return true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      let holder = null;
      try { holder = JSON.parse(await fs.readFile(lockFile, "utf8")); } catch { /* unreadable: stale */ }
      const other = Number(holder?.pid);
      if (Number.isInteger(other) && other > 0 && other !== pid && isAlive(other)) return false;
      await fs.rm(lockFile, { force: true });
    }
    return false;
  }
  async function dropLock() {
    if (!state.lock) return;
    state.lock = false;
    locks.delete(lockFile);
    try {
      const holder = JSON.parse(await fs.readFile(lockFile, "utf8"));
      if (Number(holder?.pid) === pid) await fs.rm(lockFile, { force: true });
    } catch { /* already gone */ }
  }

  // ---- opening ------------------------------------------------------------------------------
  async function loadSnapshot() {
    let text;
    try { text = await fs.readFile(snapFile, "utf8"); } catch { return 0; }
    let snapshot;
    try { snapshot = JSON.parse(text); } catch { log("[scratch] the checkpoint could not be read; replaying the log from the start"); return 0; }
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.entries)) return 0;
    for (const entry of snapshot.entries) {
      const record = rules.decodeRecord(JSON.stringify({ seq: 0, op: "put", ...entry }));
      if (record) apply(record);
    }
    state.seq = Number.isInteger(snapshot.seq) ? snapshot.seq : 0;
    state.generation = Number.isInteger(snapshot.generation) ? snapshot.generation : 0;
    state.lastCompactAt = Number.isFinite(snapshot.lastCompactAt) ? snapshot.lastCompactAt : null;
    state.hits = Number.isInteger(snapshot.hits) ? snapshot.hits : 0;
    state.misses = Number.isInteger(snapshot.misses) ? snapshot.misses : 0;
    return state.seq;
  }
  async function replayLog(after) {
    let text;
    try { text = await fs.readFile(logFile, "utf8"); } catch { return; }
    state.torn = text.length > 0 && !text.endsWith("\n");
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const record = rules.decodeRecord(line);
      if (!record) { skipped += 1; continue; }
      if (record.seq <= after) continue;
      apply(record);
      state.seq = record.seq;
      state.since += 1;
    }
    if (skipped) log(`[scratch] ${skipped} unreadable index line${skipped === 1 ? "" : "s"} skipped on open`);
  }
  async function open() {
    if (state.closed) return { ok: false, reason: "closed" };
    if (state.opened) return { ok: true, keys: state.index.size, bytes: state.liveBytes, host: "js" };
    try {
      await fs.mkdir(blobsDir, { recursive: true });
      if (!(await takeLock())) return { ok: false, reason: "locked" };
      const after = await loadSnapshot();
      await replayLog(after);
      // Blobs no record keeps are dead until a compaction deletes them.
      state.deadBytes = Math.max(0, state.deadBytes);
      state.opened = true;
      return { ok: true, keys: state.index.size, bytes: state.liveBytes, host: "js" };
    } catch (error) {
      await dropLock().catch(() => {});
      return failed(error, "open");
    }
  }
  async function ready() {
    if (state.opened) return { ok: true };
    return open();
  }

  // ---- put -----------------------------------------------------------------------------------
  async function put(request = {}) {
    return exclusive(async () => {
      const up = await ready();
      if (!up.ok) return up;
      const parsed = rules.parseKey(request?.key);
      if (!parsed.ok) return parsed;
      const kind = rules.kindFor(parsed, request.kind);
      if (!kind) return { ok: false, reason: "bad-kind" };
      if (typeof request.text !== "string") return { ok: false, reason: "bad-text" };
      const meta = request.meta === undefined || request.meta === null ? null : plainMeta(request.meta);
      if (request.meta !== undefined && request.meta !== null && (!meta || JSON.stringify(meta).length > META_MAX)) return { ok: false, reason: "bad-meta" };
      const bytes = Buffer.byteLength(request.text, "utf8");
      if (bytes > quotas.perPutBytes) return { ok: false, reason: "too-large" };
      const key = parsed.ok ? request.key : "";
      const existing = state.index.get(key);
      if (!existing && state.index.size >= limits.keys) return { ok: false, reason: "full" };
      const at = now();
      const hash = sha256(request.text);
      const record = { seq: state.seq + 1, op: "put", key, hash, bytes, kind, at, meta, ttlMs: request.ttlMs, searchable: request.searchable };
      const line = rules.encodeRecord(record).length;
      if (state.indexBytes - (existing?.line ?? 0) + line > limits.indexBytes) return { ok: false, reason: "full" };
      const dedup = state.blobs.has(hash);
      try {
        if (!dedup) {
          const spare = existing && state.blobs.get(existing.hash)?.refs === 1 ? existing.bytes : 0;
          const need = state.liveBytes - spare + bytes - capBytes;
          if (need > 0) {
            const others = [...state.index.values()].filter((entry) => entry.key !== key);
            const chosen = rules.chooseEvictions(others, need, at);
            for (const victim of chosen.keys) await append({ seq: state.seq += 1, op: "del", key: victim });
            if (state.liveBytes - spare + bytes > capBytes) return { ok: false, reason: "full" };
          }
          await writeBlob(hash, request.text);
        }
        record.seq = state.seq += 1;
        await append(record);
        if (state.since >= CHECKPOINT_EVERY) await checkpoint().catch((error) => failed(error, "checkpoint"));
        return { ok: true, hash, bytes, dedup };
      } catch (error) {
        return failed(error, "put");
      }
    });
  }

  // ---- reads ---------------------------------------------------------------------------------
  async function get(request = {}) {
    const up = await ready();
    if (!up.ok) return up;
    const byHash = typeof request?.hash === "string" && !request.key;
    const entry = byHash ? null : state.index.get(request?.key);
    const hash = byHash ? request.hash : entry?.hash;
    if (!hash || (byHash && !state.blobs.has(hash))) { state.misses += 1; return { ok: false, reason: "missing" }; }
    let text;
    try { text = await fs.readFile(blobPath(hash), "utf8"); }
    catch { state.misses += 1; return { ok: false, reason: "missing" }; }
    state.hits += 1;
    if (entry) { entry.at = now(); state.dirty = true; }
    return { ok: true, key: entry?.key ?? null, hash, text, bytes: Buffer.byteLength(text, "utf8"), kind: entry?.kind ?? null, at: entry?.at ?? null, meta: entry?.meta ?? null };
  }
  async function has(request = {}) {
    const up = await ready();
    if (!up.ok) return up;
    const entry = state.index.get(request?.key);
    return entry ? { ok: true, has: true, ...summary(entry) } : { ok: true, has: false };
  }
  function selected({ prefix, kind } = {}) {
    const start = typeof prefix === "string" ? prefix : "";
    const want = typeof kind === "string" && kind ? kind : null;
    const out = [];
    for (const entry of state.index.values()) {
      if (start && !entry.key.startsWith(start)) continue;
      if (want && entry.kind !== want) continue;
      out.push(entry);
    }
    return out.sort(byRecent);
  }
  async function list(request = {}) {
    const up = await ready();
    if (!up.ok) return up;
    const rows = selected(request);
    const limit = Number.isInteger(request?.limit) && request.limit > 0 ? Math.min(request.limit, LIST_MAX) : 100;
    return { ok: true, items: rows.slice(0, limit).map(summary), total: rows.length };
  }
  async function tokensOf(entry) {
    const cache = state.search?.stamp === state.stamp ? state.search : (state.search = { stamp: state.stamp, tokens: new Map() });
    const known = cache.tokens.get(entry.hash);
    if (known) return known;
    let text;
    try { text = await fs.readFile(blobPath(entry.hash), "utf8"); } catch { return null; }
    const tokens = rules.tokenize(text);
    cache.tokens.set(entry.hash, tokens);
    return tokens;
  }
  async function search(request = {}) {
    const up = await ready();
    if (!up.ok) return up;
    const query = typeof request?.query === "string" ? request.query : "";
    const limit = Number.isInteger(request?.limit) && request.limit > 0 ? Math.min(request.limit, SEARCH_MAX) : 10;
    if (!rules.tokenize(query).length) return { ok: true, items: [], partial: false, scanned: 0 };
    const docs = [];
    let read = 0;
    let partial = false;
    for (const entry of selected(request)) {
      if (!searchable(entry)) continue;
      if (read + entry.bytes > limits.searchBytes) { partial = true; break; }
      read += entry.bytes;
      const tokens = await tokensOf(entry);
      if (tokens) docs.push({ key: entry.key, tokens, at: entry.at });
    }
    const items = [];
    for (const hit of rules.rank(docs, query, { limit })) {
      const entry = state.index.get(hit.key);
      if (!entry) continue;
      let text = "";
      try { text = await fs.readFile(blobPath(entry.hash), "utf8"); } catch { /* evicted meanwhile: an empty snippet */ }
      items.push({ key: hit.key, hash: entry.hash, score: hit.score, snippet: rules.snippet(text, query), at: hit.at });
    }
    return { ok: true, items, partial, scanned: docs.length };
  }
  async function stats() {
    const up = await ready();
    if (!up.ok) return up;
    return {
      ok: true, host: "js", bytes: state.liveBytes + state.deadBytes, capBytes, liveBytes: state.liveBytes, deadBytes: state.deadBytes,
      keys: state.index.size, blobs: state.blobs.size, hits: state.hits, misses: state.misses, generation: state.generation, lastCompactAt: state.lastCompactAt,
      indexBytes: state.indexBytes, full: state.index.size >= limits.keys || state.indexBytes >= limits.indexBytes,
    };
  }

  // ---- compaction and eviction ------------------------------------------------------------------
  async function compact() {
    return exclusive(async () => {
      const up = await ready();
      if (!up.ok) return up;
      let removed = 0;
      try {
        let shelves = [];
        try { shelves = await fs.readdir(blobsDir); } catch { shelves = []; }
        for (const shelf of shelves) {
          let names = [];
          try { names = await fs.readdir(path.join(blobsDir, shelf)); } catch { continue; }
          for (const name of names) {
            if (state.blobs.has(name)) continue;
            await fs.rm(path.join(blobsDir, shelf, name), { force: true });
            removed += 1;
          }
        }
        state.generation += 1;
        state.lastCompactAt = now();
        state.deadBytes = 0;
        await checkpoint();
        return { ok: true, removed, keys: state.index.size, bytes: state.liveBytes };
      } catch (error) {
        return failed(error, "compact");
      }
    });
  }
  // Without a prefix: only what has expired; with one: everything under it.
  async function evict(request = {}) {
    return exclusive(async () => {
      const up = await ready();
      if (!up.ok) return up;
      const prefix = typeof request?.prefix === "string" ? request.prefix : "";
      const at = now();
      const victims = [];
      for (const entry of state.index.values()) {
        if (prefix ? entry.key.startsWith(prefix) : (rules.KINDS[entry.kind]?.evictable && rules.expiresAt(entry) !== null && rules.expiresAt(entry) <= at)) victims.push(entry);
      }
      const before = state.liveBytes;
      try {
        for (const entry of victims) await append({ seq: state.seq += 1, op: "del", key: entry.key });
        return { ok: true, evicted: victims.length, bytes: before - state.liveBytes };
      } catch (error) {
        return failed(error, "evict");
      }
    });
  }
  async function close() {
    return exclusive(async () => {
      if (state.closed) return { ok: true };
      state.closed = true;
      try {
        if (state.opened && state.dirty) await checkpoint();
      } catch (error) {
        failed(error, "close");
      }
      await dropLock().catch(() => {});
      return { ok: true };
    });
  }

  return Object.freeze({ host: "js", dir, capBytes, open, put, get, has, list, search, stats, compact, evict, close });
}

module.exports = { createScratch, CHECKPOINT_EVERY };
