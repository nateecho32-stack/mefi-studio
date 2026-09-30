// Before and after shots without a window: the rules (scripts/attempt-evidence.cjs) and the
// host that keeps the files (scripts/attempt-evidence-host.cjs) with a stand-in for the capture.
// The real window is proven in tests/evidence_capture.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const rules = require("../scripts/attempt-evidence.cjs");
const { createAttemptEvidence } = require("../scripts/attempt-evidence-host.cjs");

// A PNG that says it is width x height (only the header is real).
function fakePng(width = 1280, height = 800, extra = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8); return out; };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(16 + extra, 7))), chunk("IEND", Buffer.alloc(0))]);
}

test("the module is pure and keeps the approved wording", () => {
  const source = readFileSync(new URL("../scripts/attempt-evidence.cjs", import.meta.url), "utf8");
  assert.match(source.slice(0, 4000), /Pure module: no Electron, no filesystem, no network, no processes, no/);
  assert.equal(rules.PRIVACY, "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report.");
  assert.deepEqual(rules.WHEN, { before: "Captured when the task started.", after: "Captured when the task finished." });
  assert.equal(rules.DIR, "attempt-evidence");
  assert.deepEqual([rules.LIMITS.width, rules.LIMITS.height], [1280, 800], "a fixed size");
  assert.equal(rules.LIMITS.keepImages, 10, "the newest ten attempts keep their pictures");
});

test("only an address on this PC, with no login in it, is ever opened", () => {
  assert.deepEqual(rules.loopback("http://127.0.0.1:5173/"), { url: "http://127.0.0.1:5173/", origin: "http://127.0.0.1:5173", host: "127.0.0.1:5173", secure: false });
  assert.equal(rules.loopback("https://localhost:8443/app").secure, true);
  assert.equal(rules.loopback("http://[::1]:3000/").host, "[::1]:3000");
  for (const bad of ["http://192.168.1.5:3000/", "http://example.com/", "http://127.0.0.1.evil.com/", "http://user:pw@127.0.0.1/", "file:///etc/passwd", "ftp://127.0.0.1/", "javascript:alert(1)", "http://localhost@evil.com/", "not a url", "", null, 5, `http://127.0.0.1/${"a".repeat(2100)}`]) assert.equal(rules.loopback(bad), null, String(bad).slice(0, 30));
});

test("the hidden window may request its own origin and pieces of the page, and nothing else", () => {
  const allowed = { host: "127.0.0.1:5173", secure: false, origin: "http://127.0.0.1:5173" };
  for (const yes of ["http://127.0.0.1:5173/", "http://127.0.0.1:5173/assets/app.js?v=3", "ws://127.0.0.1:5173/ws", "data:image/png;base64,AAAA", "blob:http://127.0.0.1:5173/uuid", "about:blank"]) assert.equal(rules.allowRequest(yes, allowed), true, yes);
  for (const no of ["http://127.0.0.1:5174/", "http://localhost:5173/", "https://127.0.0.1:5173/", "wss://127.0.0.1:5173/", "https://cdn.example.com/x.js", "file:///C:/secret.txt", "http://user:pw@127.0.0.1:5173/", "ftp://127.0.0.1:5173/", "chrome://gpu", "", "nonsense"]) assert.equal(rules.allowRequest(no, allowed), false, no);
  assert.equal(rules.allowRequest("https://127.0.0.1:8443/x", { host: "127.0.0.1:8443", secure: true }), true, "a secure preview may use https and wss");
  assert.equal(rules.allowRequest("http://127.0.0.1:8443/x", { host: "127.0.0.1:8443", secure: true }), false);
  assert.equal(rules.allowRequest("http://127.0.0.1:5173/", null), false);
});

test("the planner takes a shot only when it is asked to and the preview is ready on this PC", () => {
  const ready = { phase: "ready", url: "http://127.0.0.1:5173/" };
  const on = { shots: true };
  const plan = rules.planCapture({ phase: "before", prefs: on, preview: ready });
  assert.deepEqual([plan.capture, plan.url, plan.allow], [true, "http://127.0.0.1:5173/", { host: "127.0.0.1:5173", secure: false, origin: "http://127.0.0.1:5173" }]);
  assert.deepEqual(rules.planCapture({ phase: "after", prefs: { shots: false }, preview: ready }), { capture: false, reason: "off", say: "Screenshots are switched off on this PC." }, "switched off wins over a running preview");
  for (const preview of [null, undefined, { phase: "stopped", url: null }, { phase: "starting", url: "http://127.0.0.1:1/" }, { phase: "failed", url: "http://127.0.0.1:1/" }, { phase: "ready", url: "" }, { phase: "ready" }]) {
    const none = rules.planCapture({ phase: "before", prefs: on, preview });
    assert.deepEqual([none.capture, none.reason, none.say], [false, "no-preview", "The preview was not running when this task started."], JSON.stringify(preview));
  }
  assert.equal(rules.planCapture({ phase: "after", prefs: on, preview: null }).say, "The preview was not running when this task finished.");
  assert.equal(rules.planCapture({ phase: "before", prefs: on, preview: { phase: "ready", url: "http://example.com/" } }).reason, "bad-url");
  assert.equal(rules.planCapture({ phase: "during", prefs: on, preview: ready }).capture, false);
  assert.equal(rules.planCapture({}).capture, false);
});

test("evidence folders are named from the task and the attempt only, and a record reads back what was tried", () => {
  assert.deepEqual(rules.folderParts("task_ab", 3), ["attempt-evidence", "task_ab", "3"]);
  assert.deepEqual(rules.folderParts("a/b ..", 1), ["attempt-evidence", "a%2fb%20%2e%2e", "1"], "no task id can leave the folder");
  assert.equal(rules.folderParts("", 1), null);
  assert.equal(rules.folderParts("t", 0), null);
  assert.equal(rules.imageName("before"), "before.png");
  assert.equal(rules.imageName("../etc"), null);
  const one = rules.metaOf(null, { runId: "run_1_1", phase: "before", state: "captured", at: 1000, bytes: 500, width: 1280, height: 800 });
  const two = rules.metaOf(one, { phase: "after", state: "skipped", reason: "no-preview", at: 2000 });
  assert.deepEqual(two, { v: 1, runId: "run_1_1", before: { state: "captured", at: 1000, bytes: 500, width: 1280, height: 800 }, after: { state: "skipped", reason: "no-preview", at: 2000 } });
  const parsed = rules.parseMeta(JSON.stringify(two));
  assert.deepEqual([parsed.runId, parsed.before.state, parsed.after.reason, parsed.before.width], ["run_1_1", "captured", "no-preview", 1280]);
  assert.deepEqual(rules.parseMeta("garbage"), { v: 1, runId: null, before: null, after: null });
  assert.equal(rules.parseMeta(JSON.stringify({ runId: "../x", before: { state: "captured" } })).runId, null, "a run id that is not a flat token is dropped");
  assert.equal(rules.noteFor("before", { state: "captured" }, true), "Captured when the task started.");
  assert.equal(rules.noteFor("after", { state: "captured" }, true), "Captured when the task finished.");
  assert.equal(rules.noteFor("before", { state: "skipped", reason: "no-preview" }, false), "The preview was not running when this task started.");
  assert.match(rules.noteFor("after", { state: "skipped", reason: "failed" }, false), /did not answer when this task finished/);
  assert.equal(rules.noteFor("before", null, false), "");
});

test("pruning keeps pictures for a task's newest ten attempts, folders for twenty, and the folder under its size", () => {
  const rows = Array.from({ length: 24 }, (_, index) => ({ key: "t", n: index + 1, at: (index + 1) * 1000, images: 1000 }));
  const plan = rules.prunePlan(rows);
  assert.deepEqual(plan.dropFolders.map((row) => row.n).sort((a, b) => a - b), [1, 2, 3, 4], "past twenty the whole folder goes");
  assert.deepEqual(plan.dropImages.map((row) => row.n).sort((a, b) => a - b), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], "past ten only the pictures go");
  const other = rules.prunePlan([...rows, { key: "u", n: 1, at: 1, images: 5 }]);
  assert.equal(other.dropFolders.some((row) => row.key === "u") || other.dropImages.some((row) => row.key === "u"), false, "another task is not affected");
  const noImages = rules.prunePlan([{ key: "t", n: 1, at: 1, images: 0 }, ...Array.from({ length: 11 }, (_, index) => ({ key: "t", n: index + 2, at: index + 2, images: 0 }))]);
  assert.deepEqual(noImages.dropImages, [], "a folder with no pictures has none to drop");
  const heavy = Array.from({ length: 6 }, (_, index) => ({ key: `task${index}`, n: 1, at: (index + 1) * 10, images: 60 * 1024 * 1024 }));
  const capped = rules.prunePlan(heavy);
  assert.deepEqual(capped.dropImages.map((row) => row.key), ["task0", "task1", "task2"], "over 200 MB the oldest pictures go first");
  assert.deepEqual(rules.numbersOf([{ key: "t", n: 3 }, { key: "u", n: 9 }, { key: "t", n: 5 }, { key: "t", n: "x" }], "t"), [3, 5]);
  assert.deepEqual(rules.prunePlan(null), { dropImages: [], dropFolders: [] });
});

test("a PNG's size is read from its header; only small ones are kept and sent to the page", () => {
  assert.deepEqual(rules.pngSize(fakePng(1280, 800)), { width: 1280, height: 800 });
  assert.equal(rules.pngSize(Buffer.from("not a png at all, not a png at all")), null);
  assert.equal(rules.pngSize(fakePng(0, 800)), null);
  assert.equal(rules.pngSize(fakePng(99999, 10)), null);
  assert.equal(rules.pngSize(Buffer.alloc(10)), null);
  assert.equal(rules.pngSize(null), null);
  assert.deepEqual([rules.keepable(1), rules.keepable(6 * 1024 * 1024), rules.keepable(6 * 1024 * 1024 + 1), rules.keepable(0), rules.keepable(NaN)], [true, true, false, false, false]);
  assert.deepEqual([rules.sendable(3 * 1024 * 1024), rules.sendable(3 * 1024 * 1024 + 1)], [true, false]);
  assert.match(rules.dataUrl(fakePng()), /^data:image\/png;base64,iVBORw0KGgo/);
});

// ---- the host ------------------------------------------------------------------------------------
function host(t, { capture, ...more } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-evidence-host-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const data = path.join(base, "data", "projects", "p1");
  const calls = [];
  const logs = [];
  const evidence = createAttemptEvidence({ root: () => data, capture: capture ?? (async (url, options) => { calls.push({ url, options }); return { ok: true, png: fakePng() }; }), log: (line) => logs.push(line), now: () => 5000, ...more });
  const dir = (key, n) => path.join(data, "attempt-evidence", key, String(n));
  return { base, data, evidence, calls, logs, dir };
}
const READY = { phase: "ready", url: "http://127.0.0.1:5173/" };
const ON = { shots: true };
const walk = (dir, out = []) => { if (!existsSync(dir)) return out; for (const entry of readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full, out); else out.push(full); } return out; };

test("a running preview is captured at the start and the end, each as a 1280 x 800 file under the project's data folder", async (t) => {
  const h = host(t);
  const before = await h.evidence.shot({ taskId: "task_1", n: 1, runId: "run_1_1", phase: "before", preview: READY, prefs: ON });
  assert.deepEqual([before.ok, before.captured, before.width, before.height], [true, true, 1280, 800]);
  await h.evidence.shot({ taskId: "task_1", n: 1, runId: "run_1_1", phase: "after", preview: READY, prefs: ON });
  assert.deepEqual(readdirSync(h.dir("task_1", 1)).sort(), ["after.png", "before.png", "meta.json"]);
  assert.deepEqual(h.calls.map((call) => call.url), ["http://127.0.0.1:5173/", "http://127.0.0.1:5173/"]);
  assert.deepEqual([h.calls[0].options.width, h.calls[0].options.height, h.calls[0].options.timeoutMs], [1280, 800, 15000], "the fixed size and a hard time limit");
  assert.deepEqual(h.calls[0].options.allow, { host: "127.0.0.1:5173", secure: false, origin: "http://127.0.0.1:5173" }, "the window is told the one origin it may use");
  assert.deepEqual(walk(h.base).filter((file) => !file.startsWith(h.data)), [walk(h.base).find((file) => file.endsWith(".gitconfig")) ].filter(Boolean), "nothing is written outside the data folder");
  const read = await h.evidence.read({ taskId: "task_1", n: 1 });
  assert.equal(read.ok, true);
  assert.equal(read.runId, "run_1_1");
  assert.deepEqual(read.shots.map((shot) => [shot.phase, shot.width, shot.height]), [["before", 1280, 800], ["after", 1280, 800]]);
  assert.ok(read.shots.every((shot) => /^data:image\/png;base64,/.test(shot.dataUrl)), "each picture as a data URL");
  assert.deepEqual(read.notes, { before: "Captured when the task started.", after: "Captured when the task finished." });
  assert.equal(read.privacy, rules.PRIVACY);
});

test("with no preview running nothing is captured, and the page is told so in the approved words", async (t) => {
  const h = host(t);
  const none = await h.evidence.shot({ taskId: "task_1", n: 1, runId: "run_1_1", phase: "before", preview: { phase: "stopped", url: null }, prefs: ON });
  assert.deepEqual([none.ok, none.captured, none.reason, none.say], [true, false, "no-preview", "The preview was not running when this task started."]);
  assert.equal(h.calls.length, 0, "no window was asked for");
  assert.deepEqual(readdirSync(h.dir("task_1", 1)), ["meta.json"]);
  const read = await h.evidence.read({ taskId: "task_1", n: 1 });
  assert.deepEqual(read.shots, []);
  assert.equal(read.notes.before, "The preview was not running when this task started.");
  assert.equal(read.notes.after, "");
});

test("switched off, it leaves no trace at all", async (t) => {
  const h = host(t);
  const off = await h.evidence.shot({ taskId: "task_1", n: 1, phase: "before", preview: READY, prefs: { shots: false } });
  assert.deepEqual([off.ok, off.captured, off.reason], [true, false, "off"]);
  assert.equal(h.calls.length, 0);
  assert.equal(existsSync(path.join(h.data, "attempt-evidence")), false, "not even a folder");
});

test("a capture that throws, answers badly or never answers costs a note, never an error, and never a long wait", async (t) => {
  for (const capture of [async () => { throw new Error("boom"); }, async () => ({ ok: false, error: "timed out" }), async () => ({ ok: true, png: Buffer.from("not a png") }), async () => ({ ok: true }), async () => null]) {
    const h = host(t, { capture });
    const result = await h.evidence.shot({ taskId: "task_1", n: 1, phase: "after", preview: READY, prefs: ON });
    assert.deepEqual([result.ok, result.captured, result.reason], [true, false, "failed"]);
    assert.match(result.say, /did not answer when this task finished/);
    assert.deepEqual(readdirSync(h.dir("task_1", 1)), ["meta.json"]);
  }
  const slow = host(t, { capture: () => new Promise(() => {}), graceMs: 40 });
  const started = Date.now();
  const late = await slow.evidence.shot({ taskId: "task_1", n: 1, phase: "before", preview: READY, prefs: ON, timeoutMs: 60 });
  assert.equal(late.reason, "failed");
  assert.ok(Date.now() - started < 2000, "the host gave up on it by itself");
  const gone = host(t);
  gone.evidence.shot({ taskId: "", n: 1, phase: "before", preview: READY, prefs: ON });
  assert.deepEqual(await gone.evidence.shot({ taskId: "", n: 1, phase: "before", preview: READY, prefs: ON }), { ok: false, reason: "failed" }, "an id with no safe name has no shot");
  assert.deepEqual(await gone.evidence.shot({ taskId: "t", n: 1, phase: "sideways", preview: READY, prefs: ON }), { ok: false, reason: "failed" });
});

test("a run that stopped waiting for its shot never has the late picture saved as its own", async (t) => {
  let release;
  const h = host(t, { capture: () => new Promise((resolve) => { release = () => resolve({ ok: true, png: fakePng() }); }) });
  let giveUp = false;
  const pending = h.evidence.shot({ taskId: "task_1", n: 1, runId: "run_1_1", phase: "before", preview: READY, prefs: ON, cancelled: () => giveUp });
  await new Promise((resolve) => setTimeout(resolve, 20));
  giveUp = true;
  release();
  const result = await pending;
  assert.deepEqual([result.captured, result.late], [false, true]);
  assert.deepEqual(readdirSync(h.dir("task_1", 1)), ["meta.json"], "no picture was kept");
});

test("a picture too large to keep is dropped with a note, and one too large to send is listed without its bytes", async (t) => {
  const big = Buffer.concat([fakePng(), Buffer.alloc(rules.LIMITS.imageBytes + 10, 1)]);
  const h = host(t, { capture: async () => ({ ok: true, png: big }) });
  const result = await h.evidence.shot({ taskId: "task_1", n: 1, phase: "before", preview: READY, prefs: ON });
  assert.deepEqual([result.captured, result.reason], [false, "too-big"]);
  assert.equal(existsSync(path.join(h.dir("task_1", 1), "before.png")), false);
  const middle = Buffer.concat([fakePng(), Buffer.alloc(rules.LIMITS.dataUrlBytes + 10, 1)]);
  const g = host(t, { capture: async () => ({ ok: true, png: middle }) });
  await g.evidence.shot({ taskId: "task_1", n: 1, phase: "before", preview: READY, prefs: ON });
  const read = await g.evidence.read({ taskId: "task_1", n: 1 });
  assert.equal(read.shots.length, 1);
  assert.deepEqual([read.shots[0].tooBig, "dataUrl" in read.shots[0]], [true, false], "the page is told it exists, not handed megabytes");
});

test("what the page asks about an attempt that has nothing, or a name that is not safe, is an empty answer, not an error", async (t) => {
  const h = host(t);
  assert.deepEqual((await h.evidence.read({ taskId: "task_1", n: 4 })).shots, []);
  const odd = await h.evidence.read({ taskId: "../../etc", n: 1 });
  assert.deepEqual([odd.ok, odd.shots], [true, []]);
  assert.deepEqual((await h.evidence.read({ taskId: "", n: 1 })).shots, []);
  assert.deepEqual((await h.evidence.read({})).shots, []);
  await h.evidence.shot({ taskId: "../../etc/x", n: 1, phase: "before", preview: READY, prefs: ON });
  assert.equal(walk(h.base).some((file) => file.includes("etc/x") || file.includes("..")), false, "an id with slashes is written safely, never as a path");
  assert.ok(walk(path.join(h.data, "attempt-evidence")).every((file) => file.includes("%2e%2e%2f") || file.includes("%2e%2e")));
});

test("attempt numbers already used by a folder are listed, so a run's number is the same everywhere", async (t) => {
  const h = host(t);
  for (const n of [1, 2, 7]) await h.evidence.shot({ taskId: "task_1", n, phase: "before", preview: null, prefs: ON });
  await h.evidence.shot({ taskId: "task_2", n: 3, phase: "before", preview: null, prefs: ON });
  mkdirSync(path.join(h.data, "attempt-evidence", "task_1", "notes"), { recursive: true });
  assert.deepEqual((await h.evidence.numbers("task_1")).sort((a, b) => a - b), [1, 2, 7]);
  assert.deepEqual(await h.evidence.numbers("task_2"), [3]);
  assert.deepEqual(await h.evidence.numbers("nobody"), []);
  assert.deepEqual(await h.evidence.numbers(""), []);
});

test("older attempts lose their pictures first and their folders later, and a task's newest ten keep theirs", async (t) => {
  const h = host(t, { now: () => Date.now() });
  for (let n = 1; n <= 22; n += 1) {
    const folder = h.dir("task_1", n);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "before.png"), fakePng());
    writeFileSync(path.join(folder, "meta.json"), "{}");
    utimesSync(path.join(folder, "before.png"), n, n);
  }
  writeFileSync(path.join(h.dir("task_1", 22), "old.png.abc.tmp"), "half");
  utimesSync(path.join(h.dir("task_1", 22), "old.png.abc.tmp"), 1, 1);
  mkdirSync(h.dir("task_2", 1), { recursive: true });
  writeFileSync(path.join(h.dir("task_2", 1), "before.png"), fakePng());
  const pruned = await h.evidence.prune();
  assert.deepEqual([pruned.images, pruned.folders], [10, 2]);
  const has = (n) => existsSync(path.join(h.dir("task_1", n), "before.png"));
  assert.deepEqual([has(22), has(13), has(12), has(3)], [true, true, false, false], "pictures stay for the newest ten attempts");
  assert.equal(existsSync(h.dir("task_1", 3)), true, "a folder stays for twenty");
  assert.equal(existsSync(h.dir("task_1", 2)), false);
  assert.equal(existsSync(h.dir("task_1", 1)), false, "and goes past twenty");
  assert.equal(existsSync(path.join(h.dir("task_1", 22), "old.png.abc.tmp")), false, "a half-written file from a crash is swept");
  assert.equal(existsSync(path.join(h.dir("task_2", 1), "before.png")), true, "another task is untouched");
});

test("advisory results are kept beside the pictures and read back", async (t) => {
  const h = host(t);
  const results = [{ id: "typecheck", label: "Typecheck", status: "ok", detail: "0 errors", ms: 1200 }, { id: "lint", label: "Lint", status: "warn", detail: "2 warnings", ms: 900 }];
  assert.deepEqual(await h.evidence.saveChecks({ taskId: "task_1", n: 2, runId: "run_9_1", results }), { ok: true });
  assert.deepEqual(await h.evidence.readChecks({ taskId: "task_1", n: 2 }), { ok: true, results, at: 5000, runId: "run_9_1" });
  assert.deepEqual(await h.evidence.readChecks({ taskId: "task_1", n: 3 }), { ok: true, results: [], at: null });
  assert.equal((await h.evidence.saveChecks({ taskId: "task_1", n: 2, results: "no" })).ok, false);
  assert.deepEqual(readdirSync(h.dir("task_1", 2)), ["checks.json"]);
});
