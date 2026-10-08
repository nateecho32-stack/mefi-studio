// scripts/scratch-rules.cjs: the rules of the Scratch tier (docs/plans/
// scratch-tier.md), pure, so every rule is pinned here: the key grammar,
// KINDS, the quotas and the fallback's limits, the tokenizer and the BM25
// ranking with its tie-break on a corpus whose order is worked out by hand
// (the Rust arena ranks the same: tests/rust_parity_scratch.test.mjs reuses
// it), the eviction choice, the index record, prefs with the environment
// switches and the OneDrive refusal, historyReady, the stats line, and the
// buddy allocator model's invariants.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../scripts/scratch-rules.cjs");

const KiB = 1024;
const MiB = 1024 * KiB;
const DAY = 24 * 60 * 60 * 1000;
const HASH = "a".repeat(64);
const near = (value, expected, message) => assert.ok(Math.abs(value - expected) < 0.0005, `${message ?? "value"}: ${value} is not about ${expected}`);

// ---- keys -----------------------------------------------------------------------------------
test("the key grammar: run, task, shared and history keys, and nothing else", () => {
  assert.deepEqual(rules.parseKey("run/r-1/out.log"), { ok: true, scope: "run", id: "r-1", name: "out.log", kind: "run" });
  assert.deepEqual(rules.parseKey("run/r1/notes/step_2"), { ok: true, scope: "run", id: "r1", name: "notes/step_2", kind: "run" });
  assert.deepEqual(rules.parseKey("task/t.9/brief"), { ok: true, scope: "task", id: "t.9", name: "brief", kind: "task" });
  assert.deepEqual(rules.parseKey("shared/style/guide"), { ok: true, scope: "shared", id: null, name: "style/guide", kind: "shared" });
  assert.deepEqual(rules.parseKey(`history/${HASH}`), { ok: true, scope: "history", id: null, name: HASH, kind: "history" });
  for (const bad of ["", "run", "run/", "run/r1", "run/r1/", "run//x", "run/r1/a b", "run/r1/../x", "task/t1", "shared", "shared/", "history/abc", `history/${HASH}/x`, "other/x/y", `run/r1/${"x".repeat(81)}`, `run/r1/${"x/".repeat(130)}y`, 5, null]) {
    assert.deepEqual(rules.parseKey(bad), { ok: false, reason: "bad-key" }, String(bad));
  }
  assert.equal(rules.KEY_MAX, 240);
});

test("KINDS, the quotas and the fallback's limits are the plan's numbers", () => {
  assert.deepEqual(Object.keys(rules.KINDS), ["history", "run", "note", "output", "result", "task", "shared"]);
  assert.equal(rules.KINDS.history.evictable, false);
  assert.equal(rules.KINDS.history.searchable, false);
  assert.equal(rules.KINDS.run.evictable, true);
  assert.equal(rules.KINDS.run.ttlMs, 7 * DAY);
  for (const kind of ["note", "output", "result"]) {
    assert.deepEqual(rules.KINDS[kind].scopes, ["run"], `${kind} is run-scoped`);
    assert.equal(rules.KINDS[kind].ttlMs, 7 * DAY);
    assert.equal(rules.KINDS[kind].searchable, true);
  }
  assert.equal(rules.KINDS.shared.ttlMs, null);
  assert.equal(rules.KINDS.task.ttlMs, 30 * DAY);
  assert.deepEqual(rules.QUOTAS, { perPutBytes: 256 * KiB, perRunKeys: 200, perRunBytes: 8 * MiB, perTaskBytes: 32 * MiB });
  assert.deepEqual(rules.FALLBACK_LIMITS, { keys: 20000, indexBytes: 4 * MiB, searchBytes: 8 * MiB });
  // A kind must fit the key's scope; none asked means the scope's own.
  const run = rules.parseKey("run/r1/x");
  assert.equal(rules.kindFor(run), "run");
  assert.equal(rules.kindFor(run, "note"), "note");
  assert.equal(rules.kindFor(run, "history"), null);
  assert.equal(rules.kindFor(rules.parseKey("shared/x"), "note"), null);
  assert.equal(rules.kindFor(rules.parseKey(`history/${HASH}`)), "history");
  assert.equal(rules.kindFor({ ok: false }), null);
  // Expiry: the record's own ttl, else the kind's, else never.
  assert.equal(rules.expiresAt({ kind: "run", at: 100 }), 100 + 7 * DAY);
  assert.equal(rules.expiresAt({ kind: "run", at: 100, ttlMs: 50 }), 150);
  assert.equal(rules.expiresAt({ kind: "shared", at: 100 }), null);
  assert.equal(rules.expiresAt({ kind: "history", at: 100 }), null);
});

// ---- the tokenizer and BM25 ----------------------------------------------------------------
test("the tokenizer lowercases, splits on non-alphanumerics, keeps tokens longer than two characters and does not stem", () => {
  assert.deepEqual(rules.tokenize("Hello, hello World! a bb ccc 123 x9 running runs"), ["hello", "hello", "world", "ccc", "123", "running", "runs"]);
  assert.deepEqual(rules.tokenize("scripts/scratch-host.cjs:put(key)"), ["scripts", "scratch", "host", "cjs", "put", "key"]);
  assert.deepEqual(rules.tokenize("Ünïcode Straße 日本語"), ["ünïcode", "straße", "日本語"], "letters beyond ASCII are letters; the length counts code points");
  assert.deepEqual(rules.tokenize(""), []);
  assert.deepEqual(rules.tokenize(null), []);
  assert.deepEqual(rules.BM25, { k1: 1.2, b: 0.75 });
});

// The corpus the Rust side ranks too. Query "alpha beta", N = 6, avgdl = 16/6.
//   df(alpha) = 3 (d1, d2, d5), df(beta) = 4 (d1, d2, d3, d5)
//   idf(alpha) = ln(1 + 3.5/3.5) = ln 2 = 0.6931; idf(beta) = ln(1 + 2.5/4.5) = 0.4418
//   part(tf, dl) = tf·2.2 / (tf + 1.2·(0.25 + 0.75·dl/avgdl))
//   d1, d5 (dl 3): part(1, 3) = 0.9514 for both terms → 0.6931·0.9514 + 0.4418·0.9514 = 1.0798
//   d2 (dl 3): alpha part(2, 3) = 1.3283, beta part(1, 3) = 0.9514 → 0.9207 + 0.4203 = 1.3410
//   d3 (dl 4): beta part(4, 4) = 1.5575 → 0.4418·1.5575 = 0.6881
//   d4, d6: no query token → left out
// Order: d2, then d1 and d5 (equal scores: the more recently used, d1, first), then d3.
const CORPUS = [
  { key: "d1", text: "alpha beta gamma", at: 10 },
  { key: "d2", text: "alpha alpha beta", at: 20 },
  { key: "d3", text: "beta beta beta beta", at: 30 },
  { key: "d4", text: "gamma delta", at: 40 },
  { key: "d5", text: "alpha beta gamma", at: 5 },
  { key: "d6", text: "epsilon", at: 60 },
];
const docs = (rows) => rows.map((row) => ({ key: row.key, tokens: rules.tokenize(row.text), at: row.at }));

test("BM25 ranks the hand-worked corpus in the written-out order, with score, then `at`, then key as the tie-break", () => {
  const ranked = rules.rank(docs(CORPUS), "alpha beta");
  assert.deepEqual(ranked.map((hit) => hit.key), ["d2", "d1", "d5", "d3"]);
  near(ranked[0].score, 1.3410, "d2");
  near(ranked[1].score, 1.0798, "d1");
  assert.equal(ranked[1].score, ranked[2].score, "the same tokens at the same length score exactly the same");
  near(ranked[3].score, 0.6881, "d3");
  assert.deepEqual(ranked.map((hit) => hit.at), [20, 10, 5, 30]);
  // A repeated query term counts once; the limit cuts the tail.
  assert.deepEqual(rules.rank(docs(CORPUS), "alpha alpha beta", { limit: 2 }).map((hit) => hit.key), ["d2", "d1"]);
  // The last tie-break: the same score and the same `at` order by key, ascending.
  const twins = docs([{ key: "zeta", text: "alpha beta", at: 1 }, { key: "eta", text: "alpha beta", at: 1 }, { key: "theta", text: "alpha beta", at: 1 }]);
  assert.deepEqual(rules.rank(twins, "alpha").map((hit) => hit.key), ["eta", "theta", "zeta"]);
  // No query tokens, or no documents: nothing.
  assert.deepEqual(rules.rank(docs(CORPUS), "a b"), []);
  assert.deepEqual(rules.rank([], "alpha"), []);
  assert.equal(rules.compareRanked({ score: 1, at: 1, key: "a" }, { score: 1, at: 1, key: "a" }), 0);
});

test("a snippet is a window around the first query token, on one line", () => {
  const text = "line one\nline two says nothing at all, and line three says even less\n\nthe   fox appears here, after some words, and the text keeps going for a while longer than the window allows";
  const piece = rules.snippet(text, "fox", 60);
  assert.ok(piece.startsWith("…"), piece);
  assert.ok(piece.endsWith("…"), piece);
  assert.ok(piece.includes("the fox appears here"), piece);
  assert.ok(!piece.includes("\n"));
  assert.equal(rules.snippet("short", "fox"), "short", "no match: the start of the text");
  assert.equal(rules.snippet("", "fox"), "");
});

// ---- eviction --------------------------------------------------------------------------------
test("eviction takes evictable kinds only: expired first, then the least recently used, never history", () => {
  const now = 100 * DAY;
  const entries = [
    { key: `history/${HASH}`, kind: "history", at: 1, bytes: 500 },
    { key: "run/r1/old", kind: "run", at: now - 10 * DAY, bytes: 100 },     // expired (7 days)
    { key: "run/r2/older", kind: "note", at: now - 20 * DAY, bytes: 100 },  // expired, used less recently
    { key: "run/r3/fresh", kind: "output", at: now - DAY, bytes: 100 },
    { key: "shared/notes", kind: "shared", at: now - 50 * DAY, bytes: 100 }, // never expires, but least recently used
    { key: "task/t1/brief", kind: "task", at: now - 2 * DAY, bytes: 100 },
    { key: "run/r4/short", kind: "run", at: now - DAY, bytes: 100, ttlMs: 60000 }, // its own ttl: expired
  ];
  assert.deepEqual(rules.evictionOrder(entries, now).map((row) => row.key), ["run/r2/older", "run/r1/old", "run/r4/short", "shared/notes", "task/t1/brief", "run/r3/fresh"]);
  assert.deepEqual(rules.chooseEvictions(entries, 250, now), { keys: ["run/r2/older", "run/r1/old", "run/r4/short"], bytes: 300 });
  assert.deepEqual(rules.chooseEvictions(entries, 10000, now).bytes, 600, "history's 500 bytes never count");
  assert.deepEqual(rules.chooseEvictions([], 10, now), { keys: [], bytes: 0 });
});

// ---- the index record ------------------------------------------------------------------------
test("an index record encodes to one line and decodes back; a torn or odd line decodes to null", () => {
  const put = { seq: 3, op: "put", key: "run/r1/out", hash: HASH, bytes: 12, kind: "run", at: 1000, meta: { by: "me" }, ttlMs: 500, searchable: false };
  const line = rules.encodeRecord(put);
  assert.ok(line.endsWith("\n") && !line.slice(0, -1).includes("\n"));
  assert.deepEqual(rules.decodeRecord(line), put);
  assert.equal(rules.encodeRecord({ seq: 4, op: "del", key: "run/r1/out" }), '{"seq":4,"op":"del","key":"run/r1/out"}\n');
  assert.deepEqual(rules.decodeRecord('{"seq":5,"op":"touch","key":"run/r1/out","at":7}'), { seq: 5, op: "touch", key: "run/r1/out", at: 7 });
  assert.equal(rules.decodeRecord(line.slice(0, 40)), null, "a torn line");
  assert.equal(rules.decodeRecord(""), null);
  assert.equal(rules.decodeRecord('{"seq":1,"op":"put","key":"run/r1/x"}'), null, "a put without its hash");
  assert.equal(rules.decodeRecord('{"seq":1,"op":"put","key":"bad key","hash":"' + HASH + '","bytes":1,"kind":"run","at":1}'), null);
  assert.equal(rules.decodeRecord('{"seq":1,"op":"put","key":"run/r1/x","hash":"' + HASH + '","bytes":1,"kind":"odd","at":1}'), null);
  assert.equal(rules.decodeRecord('{"seq":-1,"op":"del","key":"run/r1/x"}'), null);
  assert.equal(rules.decodeRecord('{"seq":1,"op":"move","key":"run/r1/x"}'), null);
  assert.equal(rules.decodeRecord("[1]"), null);
  // Only what a put needs travels; nothing is lost that was set.
  assert.equal(rules.encodeRecord({ seq: 1, op: "put", key: "run/r1/x", hash: HASH, bytes: 1, kind: "run", at: 1, meta: null, ttlMs: 0 }).includes("meta"), false);
});

// ---- prefs --------------------------------------------------------------------------------------
test("prefs: the defaults, the saved choices, odd values, and the environment switches", () => {
  assert.deepEqual(rules.DEFAULTS, { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, embeddings: "off", gpu: "off" });
  const plain = rules.prefs({}, {}, { platform: "win32" });
  assert.deepEqual(plain, { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, embeddings: "off", gpu: "off", dir: null, saved: rules.DEFAULTS, forced: null, refused: null });
  const saved = rules.prefs({ scratch: { enabled: false, capMB: 1024, historyBodies: true, agentTools: false, embeddings: "local", gpu: "auto" } }, {}, { platform: "win32" });
  assert.equal(saved.enabled, false);
  assert.equal(saved.capMB, 1024);
  assert.equal(saved.historyBodies, true);
  assert.equal(saved.agentTools, false, "off when switched off");
  assert.equal(saved.embeddings, "local");
  assert.equal(saved.gpu, "auto");
  // A store that is off gives agents no tools either.
  assert.equal(rules.prefs({ scratch: { enabled: false, agentTools: true } }, {}).agentTools, false);
  // Odd values fall back to the defaults.
  const odd = rules.prefs({ scratch: { enabled: "yes", capMB: 7, historyBodies: "maybe", agentTools: 1, embeddings: "cloud", gpu: true } }, {}, { platform: "win32" });
  assert.deepEqual(odd.saved, rules.DEFAULTS);
  assert.equal(rules.prefs({ scratch: { capMB: 65537 } }, {}).capMB, 512);
  assert.equal(rules.prefs({ scratch: [] }, {}).capMB, 512);
  assert.equal(rules.prefs(null, {}).enabled, true);
  // MEFI_STUDIO_NO_SCRATCH=1: everything off, history inline, and the page can say why.
  const off = rules.prefs({ scratch: { enabled: true, historyBodies: true, embeddings: "local", gpu: "auto" } }, { MEFI_STUDIO_NO_SCRATCH: "1" }, { platform: "win32" });
  assert.equal(off.enabled, false);
  assert.equal(off.agentTools, false);
  assert.equal(off.historyBodies, false);
  assert.equal(off.embeddings, "off");
  assert.equal(off.gpu, "off");
  assert.equal(off.forced, "MEFI_STUDIO_NO_SCRATCH");
  assert.equal(off.saved.enabled, true, "the saved choice is kept for the page");
  assert.equal(rules.prefs({}, { MEFI_STUDIO_NO_SCRATCH: "0" }).enabled, true);
});

test("MEFI_SCRATCH_DIR moves the store when it is a full path outside OneDrive; inside OneDrive or relative it is refused with a reason", () => {
  const win = { OneDrive: "C:\\Users\\Ann\\OneDrive" };
  assert.equal(rules.prefs({}, { ...win, MEFI_SCRATCH_DIR: "D:\\fast\\scratch\\" }, { platform: "win32" }).dir, "D:\\fast\\scratch\\");
  assert.equal(rules.prefs({}, { ...win, MEFI_SCRATCH_DIR: "D:/fast/scratch" }, { platform: "win32" }).dir, "D:\\fast\\scratch");
  const inside = rules.prefs({}, { ...win, MEFI_SCRATCH_DIR: "c:\\users\\ann\\onedrive\\scratch" }, { platform: "win32" });
  assert.equal(inside.dir, null);
  assert.deepEqual(inside.refused, { dir: "c:\\users\\ann\\onedrive\\scratch", reason: "onedrive", detail: "env:OneDrive" });
  const segment = rules.prefs({}, { MEFI_SCRATCH_DIR: "E:\\OneDrive - Work\\scratch" }, { platform: "win32" });
  assert.equal(segment.refused.reason, "onedrive");
  assert.equal(segment.refused.detail, "segment:OneDrive - Work");
  const relative = rules.prefs({}, { MEFI_SCRATCH_DIR: "scratch" }, { platform: "win32" });
  assert.deepEqual(relative.refused, { dir: "scratch", reason: "relative" });
  assert.equal(rules.prefs({}, { MEFI_SCRATCH_DIR: "/var/scratch" }, { platform: "linux" }).dir, "/var/scratch");
  assert.equal(rules.prefs({}, { MEFI_SCRATCH_DIR: "   " }, { platform: "linux" }).dir, null, "blank is unset");
  assert.equal(rules.prefs({}, { MEFI_SCRATCH_DIR: "/var/scratch" }, { platform: "linux" }).enabled, true, "a refused folder never turns the store off; the local folder is used instead");
});

test("patchFrom lets a page set the four choices and nothing else", () => {
  assert.deepEqual(rules.patchFrom({ enabled: false, agentTools: true, capMB: 1024, historyBodies: false, gpu: "auto", dir: "C:\\x" }), { ok: true, patch: { enabled: false, agentTools: true, capMB: 1024, historyBodies: false } });
  assert.deepEqual(rules.patchFrom({ historyBodies: "auto" }), { ok: true, patch: { historyBodies: "auto" } });
  assert.equal(rules.patchFrom({ enabled: "no" }).ok, false);
  assert.equal(rules.patchFrom({ capMB: 10 }).ok, false);
  assert.equal(rules.patchFrom({ capMB: 512.5 }).ok, false);
  assert.equal(rules.patchFrom({ historyBodies: "on" }).ok, false);
  assert.equal(rules.patchFrom({}).ok, false);
  assert.equal(rules.patchFrom(null).ok, false);
  assert.equal(rules.patchFrom({ gpu: "auto" }).ok, false, "nothing a page may set");
});

// ---- version readiness ------------------------------------------------------------------------
test("historyReady: every peer at or past the version, none behind, none silent; no peers is ready", () => {
  assert.equal(rules.historyReady([], "0.5.0"), true);
  assert.equal(rules.historyReady(null, "0.5.0"), true);
  assert.equal(rules.historyReady([{ lastApp: "0.5.0" }, { lastApp: "0.5.2" }], "0.5.0"), true, "equal and ahead");
  assert.equal(rules.historyReady([{ lastApp: "0.6.0-beta.1" }], "0.5.0"), true);
  assert.equal(rules.historyReady([{ lastApp: "0.5.0" }, { lastApp: "0.4.9" }], "0.5.0"), false, "one behind");
  assert.equal(rules.historyReady([{ lastApp: "0.5.0-beta.2" }], "0.5.0"), false, "a pre-release of the version is behind it");
  assert.equal(rules.historyReady([{ lastApp: "0.5.0" }, { name: "Laptop" }], "0.5.0"), false, "a peer that never said its version is not ready");
  assert.equal(rules.historyReady([{ lastApp: "" }], "0.5.0"), false);
  assert.equal(rules.historyReady([{ lastApp: "latest" }], "0.5.0"), false, "not a version");
  assert.equal(rules.historyReady([{ lastApp: "0.5.0" }], "soon"), false, "no readable floor: not ready");
});

// ---- the stats line ----------------------------------------------------------------------------
test("the stats line says what Team › Resources shows", () => {
  const now = 10 * DAY;
  assert.equal(rules.statsLine({ bytes: 61 * MiB, capBytes: 512 * MiB, keys: 1204, hits: 94, misses: 6, lastCompactAt: now - 2 * 3600 * 1000 }, now), "Scratch: 61 MB of 512 MB, 1,204 keys, 94% hits, compacted 2 h ago");
  assert.equal(rules.statsLine({ bytes: 0, capBytes: 512 * MiB, keys: 0, hits: 0, misses: 0, lastCompactAt: null }, now), "Scratch: 0 MB of 512 MB, 0 keys, no lookups yet, never compacted");
  assert.equal(rules.statsLine({ bytes: 1.4 * MiB, capBytes: 1024 * MiB, keys: 1, hits: 1, misses: 2, lastCompactAt: now - 20000 }, now), "Scratch: 1 MB of 1024 MB, 1 key, 33% hits, compacted just now");
  assert.equal(rules.statsLine({ bytes: 2_500_000, capBytes: 256 * MiB, keys: 1234567, hits: 3, misses: 0, lastCompactAt: now - 3 * DAY }, now), "Scratch: 2 MB of 256 MB, 1,234,567 keys, 100% hits, compacted 3 d ago");
  assert.equal(rules.agoWords(5 * 60 * 1000), "5 min ago");
  assert.equal(rules.statsLine(null, now), "Scratch: off");
});

// ---- the buddy allocator model -----------------------------------------------------------------
test("the buddy tree: a request takes the smallest block of the next power of two, never overlaps, and merges back on free", () => {
  const buddy = rules.createBuddy({ pages: 16 });
  assert.equal(buddy.tree.length, 2 * 16 - 1, "2N − 1 entries");
  assert.equal(buddy.orderMax, 4);
  assert.equal(buddy.blockPages(3), 4, "internal fragmentation is at most twofold");
  assert.equal(buddy.blockPages(4), 4);
  assert.equal(buddy.blockPages(5), 8);
  assert.equal(buddy.blockPages(0), null);
  const a = buddy.alloc(3);
  assert.equal(a, 0);
  assert.equal(buddy.usedPages(), 4);
  const b = buddy.alloc(1);
  assert.equal(b, 4, "the smallest fit beside it, not the big free half");
  const c = buddy.alloc(8);
  assert.equal(c, 8);
  assert.equal(buddy.largestFree(), 2);
  assert.equal(buddy.alloc(4), null, "no free block of that order: refused, not torn");
  assert.equal(buddy.alloc(2), 6);
  assert.equal(buddy.freePages(), 1);
  assert.equal(buddy.alloc(1), 5);
  assert.equal(buddy.freePages(), 0);
  assert.equal(buddy.alloc(1), null);
  buddy.free(4, 1);
  buddy.free(5, 1);
  assert.equal(buddy.largestFree(), 2, "two buddies merge into their parent");
  buddy.free(6, 2);
  assert.equal(buddy.largestFree(), 4);
  buddy.free(0, 3);
  assert.equal(buddy.largestFree(), 8, "the left half is whole again");
  buddy.free(8, 8);
  assert.equal(buddy.largestFree(), 16, "everything freed: one block");
  assert.equal(buddy.usedPages(), 0);
  assert.throws(() => buddy.free(8, 8), /not allocated/, "a double free is refused");
  assert.throws(() => buddy.free(3, 2), /not a block/, "a misaligned offset is refused");
  assert.throws(() => rules.createBuddy({ pages: 12 }), /power-of-two/);
  // A 512 MB cap is 131,072 pages of 4 KiB: 262,143 bytes of tree.
  assert.equal(rules.createBuddy({ pages: 131072 }).tree.length, 262143);
});

test("the buddy tree under a random load: no overlap, a request fails only when no block of its order is free, and all merges back", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const buddy = rules.createBuddy({ pages: 256 });
  const live = new Map();
  for (let step = 0; step < 3000; step += 1) {
    if (live.size && random() < 0.45) {
      const keys = [...live.keys()];
      const offset = keys[Math.floor(random() * keys.length)];
      buddy.free(offset, live.get(offset));
      live.delete(offset);
      continue;
    }
    const count = 1 + Math.floor(random() * 40);
    const block = buddy.blockPages(count);
    const could = buddy.largestFree() >= block;
    const offset = buddy.alloc(count);
    assert.equal(offset !== null, could, `step ${step}: a ${count}-page request fails only when no ${block}-page block is free`);
    if (offset === null) continue;
    assert.equal(offset % block, 0, "aligned to its order");
    for (const [other, size] of live) {
      const otherBlock = buddy.blockPages(size);
      assert.ok(offset + block <= other || other + otherBlock <= offset, `step ${step}: [${offset}, ${offset + block}) overlaps [${other}, ${other + otherBlock})`);
    }
    live.set(offset, count);
    let used = 0;
    for (const size of live.values()) used += buddy.blockPages(size);
    assert.equal(buddy.usedPages(), used);
  }
  for (const [offset, count] of live) buddy.free(offset, count);
  assert.equal(buddy.largestFree(), 256);
  assert.equal(buddy.freePages(), 256);
});

test("the fragmentation bound: free pages that are not buddies do not add up to a larger block", () => {
  const buddy = rules.createBuddy({ pages: 8 });
  const blocks = Array.from({ length: 8 }, () => buddy.alloc(1));
  assert.deepEqual(blocks, [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const offset of [1, 3, 5, 7]) buddy.free(offset, 1);
  assert.equal(buddy.freePages(), 4);
  assert.equal(buddy.largestFree(), 1, "four free pages, none a buddy of another: a two-page request is refused");
  assert.equal(buddy.alloc(2), null);
  for (const offset of [0, 2, 4, 6]) buddy.free(offset, 1);
  assert.equal(buddy.largestFree(), 8);
});
