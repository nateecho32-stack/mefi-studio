// Mefi's Studio AI+ — Scratch: the rules of the slower memory tier
// (docs/plans/scratch-tier.md). Scratch is a per-project store of text blobs
// on this PC's own disk that agents and the engine lean on instead of the
// JavaScript heap: parked outputs, notes between attempts, and (later) the
// task history's snapshot bodies. The Rust arena (crates/mefi-core scratch)
// and the plain-file fallback (scripts/scratch-host.cjs) both follow what is
// written here, so a search ranks the same under either host:
//
// - the key grammar: run/<runId>/<name>, task/<taskId>/<name>, shared/<name>,
//   history/<sha256>;
// - KINDS: what may be evicted, what is searchable, how long it lives;
// - QUOTAS for what one agent may put, FALLBACK_LIMITS for what the
//   plain-file host keeps in memory;
// - the tokenizer and the BM25 scorer, with the tie-break, stated once;
// - the eviction choice: evictable kinds, the expired ones first, then the
//   least recently used, never history;
// - the index record of the fallback's index.jsonl, encoded and decoded;
// - prefs(settings, env): settings.scratch plus the environment switches
//   (MEFI_STUDIO_NO_SCRATCH=1 turns everything off; MEFI_SCRATCH_DIR moves
//   the store, refused inside OneDrive);
// - historyReady(peers, minVersion): whether every paired PC reads the new
//   history format, so history bodies may leave the board;
// - the stats line Team › Resources shows;
// - a buddy allocator model, for the tests that pin what the Rust arena does.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const path = require("node:path");
const { appVersion, compareVersions } = require("./link-compat.cjs");
const { insideOneDrive } = require("./local-dirs.cjs");

const KiB = 1024;
const MiB = 1024 * KiB;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- keys ------------------------------------------------------------------------------
const SCOPES = Object.freeze(["run", "task", "shared", "history"]);
// A segment of letters, digits, dot, dash and underscore, never dots alone (no "." or "..").
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]{1,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY_MAX = 240;

/**
 * A key taken apart: { ok: true, scope, id, name, kind } where `id` is the
 * run or task id (null for shared and history keys), `name` the rest after
 * it, and `kind` the kind a key of that scope takes when none is given.
 * Anything else answers { ok: false, reason: "bad-key" }.
 */
function parseKey(key) {
  const bad = { ok: false, reason: "bad-key" };
  if (typeof key !== "string" || !key || key.length > KEY_MAX) return bad;
  const parts = key.split("/");
  const scope = parts[0];
  if (!SCOPES.includes(scope)) return bad;
  if (scope === "history") {
    if (parts.length !== 2 || !SHA256.test(parts[1])) return bad;
    return { ok: true, scope, id: null, name: parts[1], kind: "history" };
  }
  const rest = scope === "shared" ? parts.slice(1) : parts.slice(2);
  const id = scope === "shared" ? null : parts[1];
  if (id !== null && !SEGMENT.test(id)) return bad;
  if (!rest.length || !rest.every((part) => SEGMENT.test(part))) return bad;
  return { ok: true, scope, id, name: rest.join("/"), kind: scope };
}

// ---- kinds, quotas, limits -------------------------------------------------------------
// evictable: may leave the store when it is over its cap; searchable: joins
// the BM25 index; ttlMs: how long since its last use before it is expired
// (null: never); scopes: the key scopes a record of this kind may have.
const KINDS = Object.freeze({
  history: Object.freeze({ evictable: false, searchable: false, ttlMs: null, scopes: Object.freeze(["history"]) }),
  run: Object.freeze({ evictable: true, searchable: true, ttlMs: 7 * DAY_MS, scopes: Object.freeze(["run"]) }),
  note: Object.freeze({ evictable: true, searchable: true, ttlMs: 7 * DAY_MS, scopes: Object.freeze(["run"]) }),
  output: Object.freeze({ evictable: true, searchable: true, ttlMs: 7 * DAY_MS, scopes: Object.freeze(["run"]) }),
  result: Object.freeze({ evictable: true, searchable: true, ttlMs: 7 * DAY_MS, scopes: Object.freeze(["run"]) }),
  task: Object.freeze({ evictable: true, searchable: true, ttlMs: 30 * DAY_MS, scopes: Object.freeze(["task"]) }),
  shared: Object.freeze({ evictable: true, searchable: true, ttlMs: null, scopes: Object.freeze(["shared"]) }),
});

// What one agent may put (scripts/agent-brain-host.cjs enforces these at the desk).
const QUOTAS = Object.freeze({ perPutBytes: 256 * KiB, perRunKeys: 200, perRunBytes: 8 * MiB, perTaskBytes: 32 * MiB });

// What the plain-file host keeps in memory: index records only (`keys` of
// them, `indexBytes` of encoded records; past either, put answers "full"),
// and a search reads texts newest first up to `searchBytes`, then says partial.
const FALLBACK_LIMITS = Object.freeze({ keys: 20000, indexBytes: 4 * MiB, searchBytes: 8 * MiB });

/** The kind a record takes: the one asked for when it fits the key's scope, else the scope's own; null when it cannot. */
function kindFor(parsed, kind = null) {
  if (!parsed?.ok) return null;
  if (kind === null || kind === undefined || kind === "") return parsed.kind;
  const entry = KINDS[kind];
  return entry && entry.scopes.includes(parsed.scope) ? kind : null;
}

/** When a record of this kind, last used at `at`, is expired: at + ttl, or null when it never is. */
function expiresAt(record) {
  const ttl = Number.isFinite(record?.ttlMs) && record.ttlMs > 0 ? record.ttlMs : KINDS[record?.kind]?.ttlMs ?? null;
  return ttl === null ? null : Number(record.at ?? 0) + ttl;
}

// ---- the tokenizer and BM25 ------------------------------------------------------------
// Stated once, for both hosts: lowercase the text, split on every run of
// characters that is neither alphabetic (Unicode Alphabetic) nor numeric
// (Unicode N), keep the pieces longer than two characters (code points, not
// UTF-16 units), no stemming. Rust: to_lowercase, split on
// !char::is_alphanumeric, chars().count() > 2.
function tokenize(text) {
  const out = [];
  for (const part of String(text ?? "").toLowerCase().split(/[^\p{Alphabetic}\p{N}]+/u)) {
    if (part && [...part].length > 2) out.push(part);
  }
  return out;
}

const BM25 = Object.freeze({ k1: 1.2, b: 0.75 });

// score(d, q) = Σ over the distinct query tokens t:
//   idf(t) · tf · (k1 + 1) / (tf + k1 · (1 − b + b · dl / avgdl))
//   idf(t) = ln(1 + (N − df + 0.5) / (df + 0.5))
// with tf the count of t in d, dl the token count of d, avgdl the mean token
// count over all N documents (0 when N is 0), df the number of documents t
// occurs in, summed in the query's token order. Documents are
// [{ key, tokens, at }]; the answer keeps the ones that scored above zero.
function bm25(docs, query, { k1 = BM25.k1, b = BM25.b } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const terms = [...new Set(tokenize(query))];
  const N = list.length;
  if (!N || !terms.length) return [];
  let total = 0;
  for (const doc of list) total += doc.tokens.length;
  const avgdl = total / N;
  const df = new Map(terms.map((term) => [term, 0]));
  const counts = list.map((doc) => {
    const tf = new Map();
    for (const token of doc.tokens) if (df.has(token)) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, df.get(token) + 1);
    return tf;
  });
  const idf = new Map(terms.map((term) => [term, Math.log(1 + (N - df.get(term) + 0.5) / (df.get(term) + 0.5))]));
  const out = [];
  list.forEach((doc, index) => {
    const tf = counts[index];
    const dl = doc.tokens.length;
    let score = 0;
    for (const term of terms) {
      const count = tf.get(term) ?? 0;
      if (!count) continue;
      score += idf.get(term) * (count * (k1 + 1)) / (count + k1 * (1 - b + b * (avgdl ? dl / avgdl : 0)));
    }
    if (score > 0) out.push({ key: doc.key, score, at: Number(doc.at ?? 0) });
  });
  return out;
}

// The order of a search's answer: score descending, then `at` descending
// (the more recently used first), then key ascending (by code unit, which
// is byte order for the ASCII keys the grammar allows).
function compareRanked(a, b) {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  if (a.at !== b.at) return a.at > b.at ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** The ranked answer for a query over [{ key, tokens, at }]: at most `limit` of [{ key, score, at }]. */
function rank(docs, query, { limit = 10, k1, b } = {}) {
  const count = Number.isInteger(limit) && limit > 0 ? limit : 10;
  return bm25(docs, query, { k1, b }).sort(compareRanked).slice(0, count);
}

// A window of the text around the first query token found in it (the
// earliest position among the tokens), collapsed to one line.
function snippet(text, query, width = 160) {
  const source = String(text ?? "");
  const lower = source.toLowerCase();
  let first = -1;
  for (const token of tokenize(query)) {
    const at = lower.indexOf(token);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  const start = first < 0 ? 0 : Math.max(0, first - 40);
  const end = Math.min(source.length, start + width);
  const piece = source.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${end < source.length ? "…" : ""}`;
}

// ---- eviction ---------------------------------------------------------------------------
// The order records leave an over-full store: only evictable kinds, the
// expired ones first (least recently used first among them), then the rest
// least recently used first; a tie by key. History never goes.
function evictionOrder(entries, now) {
  const rows = [];
  for (const entry of entries ?? []) {
    if (!entry || !KINDS[entry.kind]?.evictable) continue;
    const expiry = expiresAt(entry);
    rows.push({ key: entry.key, bytes: Number(entry.bytes) || 0, at: Number(entry.at) || 0, expired: expiry !== null && expiry <= now });
  }
  rows.sort((a, b) => Number(b.expired) - Number(a.expired) || a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows;
}

/** The keys to evict to free `needBytes`, in order, and the bytes they free (which may fall short). */
function chooseEvictions(entries, needBytes, now) {
  const keys = [];
  let bytes = 0;
  for (const row of evictionOrder(entries, now)) {
    if (bytes >= needBytes) break;
    keys.push(row.key);
    bytes += row.bytes;
  }
  return { keys, bytes };
}

// ---- the fallback's index records ---------------------------------------------------------
// One line of index.jsonl: { seq, op: "put" | "del" | "touch", key, and for a
// put hash, bytes, kind, at, meta?, ttlMs?, searchable? }. A line that does
// not parse, or lacks what its op needs, decodes to null and is skipped (the
// last line of a file may be torn by a crash).
const OPS = Object.freeze(["put", "del", "touch"]);
function encodeRecord(record) {
  const out = { seq: record.seq, op: record.op, key: record.key };
  if (record.op === "put") {
    out.hash = record.hash;
    out.bytes = record.bytes;
    out.kind = record.kind;
    out.at = record.at;
    if (record.meta !== undefined && record.meta !== null) out.meta = record.meta;
    if (Number.isFinite(record.ttlMs) && record.ttlMs > 0) out.ttlMs = record.ttlMs;
    if (typeof record.searchable === "boolean") out.searchable = record.searchable;
  } else if (record.op === "touch") out.at = record.at;
  return `${JSON.stringify(out)}\n`;
}
function decodeRecord(line) {
  let record;
  try { record = JSON.parse(String(line ?? "")); } catch { return null; }
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  if (!Number.isInteger(record.seq) || record.seq < 0 || !OPS.includes(record.op) || !parseKey(record.key).ok) return null;
  if (record.op === "put") {
    if (!SHA256.test(String(record.hash)) || !Number.isInteger(record.bytes) || record.bytes < 0 || !KINDS[record.kind] || !Number.isFinite(record.at)) return null;
  } else if (record.op === "touch" && !Number.isFinite(record.at)) return null;
  return record;
}

// ---- preferences --------------------------------------------------------------------------
const DEFAULTS = Object.freeze({ enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, embeddings: "off", gpu: "off" });
const CAP_MB = Object.freeze({ min: 64, max: 65536 });
const HISTORY_CHOICES = Object.freeze(["auto", true, false]);
const SWITCH = "MEFI_STUDIO_NO_SCRATCH";
const DIR_VAR = "MEFI_SCRATCH_DIR";

const capOf = (value) => (Number.isInteger(value) && value >= CAP_MB.min && value <= CAP_MB.max ? value : null);

/**
 * The effective choices from settings.scratch and the environment:
 * { enabled, capMB, historyBodies, agentTools, embeddings, gpu, dir, saved,
 *   forced, refused }. MEFI_STUDIO_NO_SCRATCH=1 turns everything off for the
 * launch (`forced` names it); MEFI_SCRATCH_DIR moves the store when it is a
 * full path outside OneDrive, else `refused` says why and `dir` stays null.
 */
function prefs(settings, env = {}, { platform = process.platform } = {}) {
  const source = settings?.scratch && typeof settings.scratch === "object" && !Array.isArray(settings.scratch) ? settings.scratch : {};
  const saved = {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULTS.enabled,
    capMB: capOf(source.capMB) ?? DEFAULTS.capMB,
    historyBodies: HISTORY_CHOICES.includes(source.historyBodies) ? source.historyBodies : DEFAULTS.historyBodies,
    agentTools: typeof source.agentTools === "boolean" ? source.agentTools : DEFAULTS.agentTools,
    embeddings: source.embeddings === "local" ? "local" : DEFAULTS.embeddings,
    gpu: source.gpu === "auto" ? "auto" : DEFAULTS.gpu,
  };
  const forced = String(env?.[SWITCH] ?? "") === "1" ? SWITCH : null;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const wanted = typeof env?.[DIR_VAR] === "string" ? env[DIR_VAR].trim() : "";
  let dir = null;
  let refused = null;
  if (wanted) {
    const oneDrive = paths.isAbsolute(wanted) ? insideOneDrive(wanted, { platform, env }) : null;
    if (!paths.isAbsolute(wanted)) refused = { dir: wanted, reason: "relative" };
    else if (oneDrive) refused = { dir: wanted, reason: "onedrive", detail: oneDrive };
    else dir = paths.normalize(wanted);
  }
  return {
    enabled: saved.enabled && !forced,
    capMB: saved.capMB,
    historyBodies: forced ? false : saved.historyBodies,
    agentTools: saved.agentTools && saved.enabled && !forced,
    embeddings: forced ? "off" : saved.embeddings,
    gpu: forced ? "off" : saved.gpu,
    dir,
    saved,
    forced,
    refused,
  };
}

/** What a page may set: enabled and agentTools (on or off), capMB (a whole number of MB in range), historyBodies (auto, on or off). */
function patchFrom(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Choose what to change." };
  const patch = {};
  for (const key of ["enabled", "agentTools"]) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== "boolean") return { ok: false, error: "Each switch is on or off." };
    patch[key] = body[key];
  }
  if (Object.hasOwn(body, "capMB")) {
    if (capOf(body.capMB) === null) return { ok: false, error: `The cap is a whole number of MB from ${CAP_MB.min} to ${CAP_MB.max}.` };
    patch.capMB = body.capMB;
  }
  if (Object.hasOwn(body, "historyBodies")) {
    if (!HISTORY_CHOICES.includes(body.historyBodies)) return { ok: false, error: "History bodies are auto, on or off." };
    patch.historyBodies = body.historyBodies;
  }
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: "Choose what to change." };
}

// ---- version readiness ------------------------------------------------------------------
/**
 * Whether every paired PC runs a build at or past `minVersion` (its `lastApp`,
 * the version it last connected with). A peer that never said its version is
 * not ready; no peers at all is ready.
 */
function historyReady(peers, minVersion) {
  if (!Array.isArray(peers) || !peers.length) return true;
  if (!appVersion(minVersion)) return false;
  return peers.every((peer) => Boolean(appVersion(peer?.lastApp)) && compareVersions(peer.lastApp, minVersion) >= 0);
}

// ---- the stats line -----------------------------------------------------------------------
const thousands = (value) => String(Math.max(0, Math.round(Number(value) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const mbOf = (bytes) => `${Math.round((Number(bytes) || 0) / MiB)} MB`;
function agoWords(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "Scratch: 61 MB of 512 MB, 1,204 keys, 94% hits, compacted 2 h ago" from a stats answer and the time now. */
function statsLine(stats, now) {
  if (!stats) return "Scratch: off";
  const lookups = (Number(stats.hits) || 0) + (Number(stats.misses) || 0);
  const hits = lookups ? `${Math.round(((Number(stats.hits) || 0) / lookups) * 100)}% hits` : "no lookups yet";
  const keys = `${thousands(stats.keys)} ${Number(stats.keys) === 1 ? "key" : "keys"}`;
  const compacted = Number.isFinite(stats.lastCompactAt) && stats.lastCompactAt > 0 ? `compacted ${agoWords(now - stats.lastCompactAt)}` : "never compacted";
  return `Scratch: ${mbOf(stats.bytes)} of ${mbOf(stats.capBytes)}, ${keys}, ${hits}, ${compacted}`;
}

// ---- a buddy allocator model ----------------------------------------------------------------
// The arena's allocator as a small model, for the tests that pin its
// invariants (the Rust side implements the same tree): a complete binary tree
// over `pages` leaves (a power of two); node i covers 2^order(i) pages, its
// children the two halves; each node keeps its largest free order plus one
// (0: nothing free below it). Allocation descends to the smallest fit; a free
// marks the block free and merges with its buddy all the way up.
function createBuddy({ pages }) {
  if (!Number.isInteger(pages) || pages < 1 || (pages & (pages - 1)) !== 0) throw new TypeError("createBuddy needs a power-of-two page count");
  const orderMax = Math.log2(pages);
  const tree = new Uint8Array(2 * pages - 1);
  const depthOf = (i) => Math.floor(Math.log2(i + 1));
  const orderOf = (i) => orderMax - depthOf(i);
  for (let i = 0; i < tree.length; i += 1) tree[i] = orderOf(i) + 1;
  const orderFor = (count) => (Number.isInteger(count) && count > 0 ? Math.ceil(Math.log2(count)) : null);
  function settle(i) {
    while (i > 0) {
      i = (i - 1) >> 1;
      const left = tree[2 * i + 1];
      const right = tree[2 * i + 2];
      const whole = orderOf(i);
      tree[i] = left === whole && right === whole ? whole + 1 : Math.max(left, right);
    }
  }
  function alloc(count) {
    const order = orderFor(count);
    if (order === null || order > orderMax || tree[0] < order + 1) return null;
    let i = 0;
    while (orderOf(i) > order) {
      const left = tree[2 * i + 1];
      const right = tree[2 * i + 2];
      const fitsLeft = left >= order + 1;
      const fitsRight = right >= order + 1;
      // The smallest fit: the child whose largest free block is the smaller one that still fits.
      i = fitsLeft && (!fitsRight || left <= right) ? 2 * i + 1 : 2 * i + 2;
    }
    tree[i] = 0;
    settle(i);
    return (i - (2 ** depthOf(i) - 1)) * 2 ** order;
  }
  function free(offset, count) {
    const order = orderFor(count);
    if (order === null || order > orderMax || offset % 2 ** order !== 0 || offset + 2 ** order > pages) throw new RangeError("free: not a block of this arena");
    const depth = orderMax - order;
    const i = 2 ** depth - 1 + offset / 2 ** order;
    if (tree[i] !== 0) throw new RangeError("free: that block is not allocated");
    tree[i] = order + 1;
    settle(i);
  }
  function freePagesBelow(i) {
    if (tree[i] === 0) return 0;
    if (tree[i] === orderOf(i) + 1) return 2 ** orderOf(i);
    if (i >= pages - 1) return 0;
    return freePagesBelow(2 * i + 1) + freePagesBelow(2 * i + 2);
  }
  return Object.freeze({
    pages,
    orderMax,
    tree,
    alloc,
    free,
    blockPages: (count) => (orderFor(count) === null ? null : 2 ** orderFor(count)),
    largestFree: () => (tree[0] ? 2 ** (tree[0] - 1) : 0),
    freePages: () => freePagesBelow(0),
    usedPages: () => pages - freePagesBelow(0),
  });
}

module.exports = {
  SCOPES, KEY_MAX, KINDS, QUOTAS, FALLBACK_LIMITS, BM25, DEFAULTS, CAP_MB, HISTORY_CHOICES, SWITCH, DIR_VAR, OPS,
  parseKey, kindFor, expiresAt,
  tokenize, bm25, compareRanked, rank, snippet,
  evictionOrder, chooseEvictions,
  encodeRecord, decodeRecord,
  prefs, patchFrom, historyReady,
  statsLine, agoWords,
  createBuddy,
};
