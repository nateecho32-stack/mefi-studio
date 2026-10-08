// The Scratch tier's arena, Rust (crates/mefi-core scratch, docs/plans/scratch-tier.md
// WP1) against its JavaScript twin (scripts/scratch-host.cjs with
// scratch-rules.cjs, WP2): the same put, get, has, list, search, stats,
// compact and evict sequence in two folders must give the same answers, and
// the same ranking. Needs npm run host:core; skips without it. The twin
// comparisons also skip while scripts/scratch-host.cjs is not on this
// branch (WP2 lands separately); the Rust-only parts (the cap, crash replay,
// malformed requests, the lock) run whenever the binary is there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, openSync, closeSync, ftruncateSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const hostPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "scratch-host.cjs");
const twin = existsSync(hostPath) ? require(hostPath) : null;
const skipTwin = skip || (twin ? false : "scripts/scratch-host.cjs (WP2) is not on this branch yet");
const NOW = 1_760_000_000_000;
const sha = (text) => createHash("sha256").update(text).digest("hex");

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map((answer) => (answer.ok ? answer.value : { thrown: answer.error }));
}

function folder(t, name) {
  const dir = mkdtempSync(path.join(tmpdir(), `mefi-parity-scratch-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

const CORPUS = [
  ["run/1/log", "output", "Build started. Compiling module alpha, then beta. Warning: unused import in alpha.", { step: 1 }],
  ["run/1/result", "result", "Build passed: alpha and beta compiled, 12 tests green.", null],
  ["run/2/log", "output", "Compiling gamma. Error: gamma failed to link against alpha.", { step: 2 }],
  ["task/9/notes", "note", "Alpha is the core module; beta depends on it; gamma is optional.", null],
  ["shared/readme", "note", "the quick brown fox jumps over the lazy dog, and the dog sleeps", null],
  ["history/abc", "history", "snapshot body one: alpha", null],
  ["run/2/dup", "output", "Build passed: alpha and beta compiled, 12 tests green.", null],
];
const QUERIES = ["alpha", "alpha beta", "gamma error", "dog", "nothing-here", "ALPHA, beta!", "fox"];

/** The same sequence on the Rust arena: every answer in order. */
function rustSequence(dir, at = NOW) {
  const given = (now = at) => ({ dir, capMB: 4, now });
  const calls = [{ function: "scratch.open", args: [given(), {}] }];
  CORPUS.forEach(([key, kind, text, meta], index) => calls.push({ function: "scratch.put", args: [given(at + index), { key, kind, text, meta: meta ?? undefined, searchable: kind !== "history", ttlMs: kind === "output" ? 60_000 : undefined }] }));
  calls.push({ function: "scratch.get", args: [given(at + 100), { key: "run/1/log" }] });
  calls.push({ function: "scratch.get", args: [given(at + 101), { hash: sha(CORPUS[1][2]) }] });
  calls.push({ function: "scratch.get", args: [given(at + 102), { key: "missing/key" }] });
  calls.push({ function: "scratch.has", args: [given(), { key: "run/1/log" }] });
  calls.push({ function: "scratch.has", args: [given(), { key: "nope" }] });
  calls.push({ function: "scratch.list", args: [given(), { limit: 100 }] });
  calls.push({ function: "scratch.list", args: [given(), { prefix: "run/", limit: 2 }] });
  calls.push({ function: "scratch.list", args: [given(), { kind: "note", limit: 100 }] });
  QUERIES.forEach((query) => calls.push({ function: "scratch.search", args: [given(), { query, limit: 10 }] }));
  calls.push({ function: "scratch.search", args: [given(), { query: "alpha", kind: "output", limit: 10 }] });
  calls.push({ function: "scratch.search", args: [given(), { query: "alpha", prefix: "task/", limit: 10 }] });
  calls.push({ function: "scratch.stats", args: [given(), {}] });
  calls.push({ function: "scratch.evict", args: [given(at + 200), { prefix: "run/2/" }] });
  calls.push({ function: "scratch.compact", args: [given(at + 201), {}] });
  calls.push({ function: "scratch.list", args: [given(), { limit: 100 }] });
  calls.push({ function: "scratch.search", args: [given(), { query: "alpha", limit: 10 }] });
  calls.push({ function: "scratch.stats", args: [given(), {}] });
  return rust(calls);
}

/** The same sequence on the JavaScript twin. */
async function twinSequence(dir, at = NOW) {
  let clock = at;
  const host = twin.createScratch({ dir, capMB: 4, now: () => clock, log: () => {} });
  const out = [];
  const step = async (promise) => out.push(await promise);
  if (typeof host.open === "function") await step(host.open());
  else out.push({ ok: true });
  for (const [index, [key, kind, text, meta]] of CORPUS.entries()) {
    clock = at + index;
    await step(host.put({ key, kind, text, meta: meta ?? undefined, searchable: kind !== "history", ttlMs: kind === "output" ? 60_000 : undefined }));
  }
  clock = at + 100;
  await step(host.get({ key: "run/1/log" }));
  clock = at + 101;
  await step(host.get({ hash: sha(CORPUS[1][2]) }));
  clock = at + 102;
  await step(host.get({ key: "missing/key" }));
  clock = at;
  await step(host.has({ key: "run/1/log" }));
  await step(host.has({ key: "nope" }));
  await step(host.list({ limit: 100 }));
  await step(host.list({ prefix: "run/", limit: 2 }));
  await step(host.list({ kind: "note", limit: 100 }));
  for (const query of QUERIES) await step(host.search({ query, limit: 10 }));
  await step(host.search({ query: "alpha", kind: "output", limit: 10 }));
  await step(host.search({ query: "alpha", prefix: "task/", limit: 10 }));
  await step(host.stats());
  clock = at + 200;
  await step(host.evict({ prefix: "run/2/" }));
  clock = at + 201;
  await step(host.compact());
  clock = at;
  await step(host.list({ limit: 100 }));
  await step(host.search({ query: "alpha", limit: 10 }));
  await step(host.stats());
  if (typeof host.close === "function") await host.close();
  return out;
}

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const ranked = (answer) => (answer.items ?? []).map((item) => ({ key: item.key, hash: item.hash, score: Number(item.score.toFixed(6)), at: item.at }));

test("scratch: the Rust arena answers as the JavaScript twin", { skip: skipTwin }, async (t) => {
  const left = rustSequence(folder(t, "rust"));
  const right = plain(await twinSequence(folder(t, "twin")));
  assert.equal(left.length, right.length);
  let index = 1;
  for (const [key, , text] of CORPUS) {
    assert.deepEqual(left[index], right[index], `put ${key}`);
    assert.equal(left[index].hash, sha(text), `put ${key} hash`);
    index += 1;
  }
  assert.deepEqual(left[index], right[index], "get by key");
  assert.deepEqual(left[index + 1], right[index + 1], "get by hash");
  assert.deepEqual(left[index + 2], right[index + 2], "get missing");
  assert.deepEqual(left[index + 3], right[index + 3], "has");
  assert.deepEqual(left[index + 4], right[index + 4], "has not");
  index += 5;
  for (const label of ["list all", "list run/ limit 2", "list kind note"]) {
    assert.deepEqual(left[index], right[index], label);
    index += 1;
  }
  for (const query of [...QUERIES, "alpha kind output", "alpha prefix task/"]) {
    assert.deepEqual(ranked(left[index]), ranked(right[index]), `search ${query}`);
    assert.deepEqual(left[index].items.map((item) => item.snippet), right[index].items.map((item) => item.snippet), `search ${query} snippets`);
    index += 1;
  }
  const statKeys = ["ok", "bytes", "capBytes", "liveBytes", "deadBytes", "keys", "blobs", "hits", "misses", "generation", "lastCompactAt"];
  for (const stats of [left[index], right[index]]) assert.deepEqual(Object.keys(stats).sort(), [...statKeys].sort(), "stats shape");
  for (const field of ["ok", "liveBytes", "keys", "blobs", "hits", "misses"]) assert.equal(left[index][field], right[index][field], `stats ${field}`);
  index += 1;
  assert.deepEqual(left[index], right[index], "evict");
  assert.equal(left[index + 1].ok, right[index + 1].ok, "compact");
  assert.deepEqual(left[index + 2], right[index + 2], "list after compaction");
  assert.deepEqual(ranked(left[index + 3]), ranked(right[index + 3]), "search after compaction");
  for (const field of ["ok", "liveBytes", "keys", "blobs"]) assert.equal(left[index + 4][field], right[index + 4][field], `stats after ${field}`);
});

test("scratch: the Rust arena's answers on their own", { skip }, (t) => {
  const dir = folder(t, "rust-only");
  const answers = rustSequence(dir);
  assert.equal(answers[0].ok, true, "open");
  assert.deepEqual(answers[1], { ok: true, hash: sha(CORPUS[0][2]), bytes: Buffer.byteLength(CORPUS[0][2]), dedup: false });
  assert.deepEqual(answers[7], { ok: true, hash: sha(CORPUS[1][2]), bytes: Buffer.byteLength(CORPUS[1][2]), dedup: true }, "the same bytes under another key are a dedup");
  assert.deepEqual(answers[8], { ok: true, text: CORPUS[0][2], kind: "output", at: NOW + 100, meta: { step: 1 } });
  assert.equal(answers[9].text, CORPUS[1][2]);
  assert.deepEqual(answers[10], { ok: false, reason: "missing" });
  assert.deepEqual(answers[11], { ok: true, has: true });
  assert.deepEqual(answers[12], { ok: true, has: false });
  assert.equal(answers[13].items.length, CORPUS.length);
  assert.deepEqual(answers[13].items.slice(0, 2).map((item) => item.key), ["run/2/dup", "run/1/log"], "list is newest touch first: the get by hash touched the newest key holding it");
  assert.equal(answers[14].items.length, 2);
  assert.deepEqual(answers[15].items.map((item) => item.key).sort(), ["shared/readme", "task/9/notes"]);
  const alpha = answers[16];
  assert.deepEqual(alpha.items.map((item) => item.key).sort(), ["run/1/log", "run/1/result", "run/2/dup", "run/2/log", "task/9/notes"]);
  assert.equal(alpha.items[0].key, "run/1/log", "alpha twice in a short document ranks first");
  assert.ok(alpha.items.every((item) => typeof item.score === "number" && item.score > 0 && typeof item.snippet === "string" && item.hash.length === 64));
  assert.ok(!alpha.items.some((item) => item.key === "history/abc"), "history is not searchable here");
  assert.deepEqual(answers[20].items, [], "no hit");
  assert.deepEqual(ranked(answers[21]), ranked(answers[17]), "punctuation and case do not change a query");
  assert.deepEqual(answers[23].items.map((item) => item.key).sort(), ["run/1/log", "run/2/dup", "run/2/log"], "kind filter");
  assert.deepEqual(answers[24].items.map((item) => item.key), ["task/9/notes"], "prefix filter");
  const stats = answers[25];
  assert.equal(stats.keys, CORPUS.length);
  assert.equal(stats.blobs, CORPUS.length - 1);
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 1);
  assert.equal(stats.capBytes, 4 * 1024 * 1024);
  assert.deepEqual(answers[26], { ok: true, evicted: 2 });
  assert.equal(answers[27].generation, 1);
  assert.equal(answers[28].items.length, CORPUS.length - 2);
  assert.ok(answers[29].items.every((item) => !item.key.startsWith("run/2/")));
  assert.equal(answers[30].generation, 1);
  assert.equal(answers[30].lastCompactAt, NOW + 201);
  assert.deepEqual(Object.keys(stats), ["ok", "bytes", "capBytes", "liveBytes", "deadBytes", "keys", "blobs", "hits", "misses", "generation", "lastCompactAt"]);
  for (const file of ["arena.bin", "index.log", "index.snap", "postings.bin"]) assert.ok(existsSync(path.join(dir, file)), file);
  assert.equal(readFileSync(path.join(dir, "arena.bin")).subarray(0, 4).toString(), "MFSC");
  assert.ok(!existsSync(path.join(dir, "arena.bin.next")));
});

test("scratch: the cap, eviction and full", { skip }, (t) => {
  const dir = folder(t, "cap");
  // 16 pages: the header and 15 blobs of one page each.
  const given = (now) => ({ dir, capMB: 16 * 4096 / (1024 * 1024), now });
  const text = (n) => `${String(n).padStart(3, "0")} ${"x".repeat(200)}`;
  const calls = [];
  for (let n = 0; n < 15; n += 1) calls.push({ function: "scratch.put", args: [given(NOW + n), { key: `k/${n}`, kind: n % 5 === 0 ? "history" : "run", text: text(n), ttlMs: n === 7 ? 1 : undefined }] });
  calls.push({ function: "scratch.put", args: [given(NOW + 100), { key: "k/15", kind: "run", text: text(15) }] });
  calls.push({ function: "scratch.has", args: [given(NOW), { key: "k/7" }] });
  calls.push({ function: "scratch.put", args: [given(NOW + 101), { key: "k/16", kind: "run", text: text(16) }] });
  calls.push({ function: "scratch.has", args: [given(NOW), { key: "k/1" }] });
  calls.push({ function: "scratch.has", args: [given(NOW), { key: "k/0" }] });
  calls.push({ function: "scratch.put", args: [given(NOW + 102), { key: "big", kind: "run", text: "y".repeat(100_000) }] });
  calls.push({ function: "scratch.stats", args: [given(NOW), {}] });
  const answers = rust(calls);
  assert.ok(answers.slice(0, 16).every((answer) => answer.ok === true), JSON.stringify(answers.slice(0, 16)));
  assert.deepEqual(answers[16], { ok: true, has: false }, "the expired run entry went first");
  assert.equal(answers[17].ok, true);
  assert.deepEqual(answers[18], { ok: true, has: false }, "then the least recently touched run entry");
  assert.deepEqual(answers[19], { ok: true, has: true }, "history stays");
  assert.deepEqual(answers[20], { ok: false, reason: "full" }, "larger than the cap");
  assert.equal(answers[21].keys, 15);
});

test("scratch: crash replay drops the torn record and keeps the rest", { skip }, (t) => {
  const dir = folder(t, "replay");
  const given = (now = NOW) => ({ dir, capMB: 4, now });
  const puts = Array.from({ length: 5 }, (_, n) => ({ function: "scratch.put", args: [given(NOW + n), { key: `run/1/${n}`, kind: "output", text: `record number ${n} with some words`, searchable: true }] }));
  assert.ok(rust(puts).every((answer) => answer.ok));
  // No close: the process exits with everything in index.log alone.
  const log = path.join(dir, "index.log");
  assert.ok(!existsSync(path.join(dir, "index.snap")), "nothing snapshotted yet");
  const fd = openSync(log, "r+");
  ftruncateSync(fd, statSync(log).size - 9);
  closeSync(fd);
  const [opened, listed, found, missing] = rust([
    { function: "scratch.open", args: [given(), {}] },
    { function: "scratch.list", args: [given(), { limit: 10 }] },
    { function: "scratch.search", args: [given(), { query: "record words", limit: 10 }] },
    { function: "scratch.get", args: [given(), { key: "run/1/4" }] },
  ]);
  assert.equal(opened.ok, true);
  assert.equal(opened.dropped, 1);
  assert.equal(opened.replayed, 4);
  assert.deepEqual(listed.items.map((item) => item.key).sort(), ["run/1/0", "run/1/1", "run/1/2", "run/1/3"]);
  assert.equal(found.items.length, 4, "postings rebuilt from the arena");
  assert.deepEqual(missing, { ok: false, reason: "missing" });
  // A corrupt header: the index still comes from the log.
  const arena = path.join(dir, "arena.bin");
  const bytes = readFileSync(arena);
  bytes[5] ^= 0xff;
  writeFileSync(arena, bytes);
  const [again] = rust([{ function: "scratch.list", args: [given(), { limit: 10 }] }]);
  assert.equal(again.items.length, 4);
});

test("scratch: malformed requests, a missing dir and the lock", { skip }, (t) => {
  const dir = folder(t, "bad");
  const given = { dir, capMB: 1, now: NOW };
  const answers = rust([
    { function: "scratch.put", args: [given, { kind: "x", text: "y" }] },
    { function: "scratch.put", args: [given, { key: "", text: "y" }] },
    { function: "scratch.put", args: [given, { key: "k", text: 5 }] },
    { function: "scratch.put", args: [given, { key: "k", text: "y", kind: 7 }] },
    { function: "scratch.get", args: [given, {}] },
    { function: "scratch.has", args: [given, { key: 1 }] },
    { function: "scratch.search", args: [given, {}] },
    { function: "scratch.evict", args: [given, {}] },
    { function: "scratch.put", args: [given, "not an object"] },
    { function: "scratch.nothing", args: [given, {}] },
    { function: "scratch.stats", args: [{}, {}] },
    { function: "scratch.stats", args: [{ dir: path.join(dir, "nested", "deeper"), now: NOW }, {}] },
    { function: "scratch.put", args: [given, { key: "k", text: "y", searchable: "yes", ttlMs: "soon", meta: [1, 2] }] },
    { function: "scratch.get", args: [given, { key: "k" }] },
    { function: "scratch.close", args: [given, {}] },
  ]);
  for (const answer of answers.slice(0, 11)) assert.ok(typeof answer.thrown === "string" && answer.thrown.startsWith("scratch"), JSON.stringify(answer));
  assert.equal(answers[11].ok, true, "a dir is created when missing");
  assert.deepEqual(answers[12], { ok: true, hash: sha("y"), bytes: 1, dedup: false }, "lenient flags");
  assert.deepEqual(answers[13], { ok: true, text: "y", kind: "note", at: NOW, meta: [1, 2] });
  assert.deepEqual(answers[14], { ok: true });
  // Another live process holds the folder: refused with its pid.
  writeFileSync(path.join(dir, "scratch.lock"), JSON.stringify({ pid: process.pid, at: NOW }));
  const [locked] = rust([{ function: "scratch.stats", args: [given, {}] }]);
  assert.deepEqual(locked, { ok: false, reason: "locked", pid: process.pid });
  rmSync(path.join(dir, "scratch.lock"));
});
