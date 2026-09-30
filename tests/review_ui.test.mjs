// The review section of a task's Evidence tab (renderer/review.js) over the shared fake DOM and a
// stand-in for the host's tasks:changes / diff / accept / revert / checks / evidence / review:prefs:
// nothing is read until the section is open; the list, the diff on demand, Accept, Revert file and
// Revert attempt (two presses, "Revert all N", the host's refusal in its own words, the one safe
// way on, Undo); a running attempt read again while it is showing; the host's pushes; the attempt
// picker; the Checks and Preview panels; the three switches; and that nothing the project holds
// (file names, diff lines, output) is ever read as markup.
//
// Run: node --test tests/review_ui.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createDom } from "./fixtures/renderer-dom.mjs";

const source = readFileSync(new URL("../renderer/review.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../renderer/review.css", import.meta.url), "utf8");
const studioUi = readFileSync(new URL("../renderer/studio-ui.js", import.meta.url), "utf8");
// The real two-step button and the real sentence filter, cut out of studio-ui.js, so a change there is felt here.
const controls = studioUi.slice(studioUi.indexOf("  function arm("), studioUi.indexOf("  window.MefiUi = Object.assign("));

const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const file = (path, more = {}) => ({ path, dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "", name: path.slice(path.lastIndexOf("/") + 1), oldPath: null, status: "modified", additions: 2, deletions: 1, binary: false, kind: "file", state: "can-revert", ...more });
const changed = (more = {}) => ({
  ok: true, available: true, taskId: "t1", projectId: "p1", attempt: 1, runId: "run_1_1", state: "ended",
  attempts: [{ n: 1, runId: "run_1_1", startedAt: 1, endedAt: Date.now() - 120000, ended: true, selected: true, reverts: [], accepted: false, running: false }],
  files: [file("src/a.js"), file("b.txt", { status: "added", additions: 3, deletions: 0 })],
  totals: { files: 2, additions: 5, deletions: 1, binary: 0 }, more: 0, skipped: { count: 0, files: [], sentence: "" }, overlap: [], worktree: false,
  accepted: false, running: false, waiting: false, canAccept: true, canRevert: true, ...more,
});
const checked = (more = {}) => ({
  ok: true, available: true, taskId: "t1", projectId: "p1", attempt: 1, at: Date.now() - 60000,
  results: [{ id: "typecheck", label: "Typecheck", status: "ok", detail: "0 errors", ms: 900 }, { id: "lint", label: "Lint", status: "bad", detail: "3 errors", ms: 400, tail: "src/a.js:1 no-undef <b>x</b>" }, { id: "build", label: "Build", status: "skipped", detail: "Not run on its own, because a build writes files. Run it now." }],
  detected: [{ id: "typecheck", label: "Typecheck", auto: true, writes: false }, { id: "lint", label: "Lint", auto: true, writes: false }, { id: "build", label: "Build", auto: false, writes: true }],
  none: false, build: false, ...more,
});
const shots = (more = {}) => ({
  ok: true, taskId: "t1", projectId: "p1", attempt: 1, runId: "run_1_1", enabled: true, forced: false,
  shots: [{ phase: "before", at: 1, bytes: 10, width: 1280, height: 800, dataUrl: PNG }, { phase: "after", at: 2, bytes: 10, width: 1280, height: 800, dataUrl: PNG }],
  notes: { before: "Captured when the task started.", after: "Captured when the task finished." },
  privacy: "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report.", ...more,
});
const prefs = (more = {}) => ({ ok: true, prefs: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, saved: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, forced: { snapshots: false, advisory: false, shots: false }, ...more });

// A page: the module loaded into a fresh window, a host whose answers a test sets, and a clock a test winds.
function page(answers = {}, { desktop = true } = {}) {
  const dom = createDom();
  // The fake element's focus() only notes it; here it moves document.activeElement as a browser does.
  dom.document.createElement("div").constructor.prototype.focus = function () { dom.document.activeElement = this; this.focused = true; };
  const calls = [];
  const toasts = [];
  const timers = [];
  const listeners = [];
  const reply = (name, fallback) => async (payload) => {
    calls.push([name, clone(payload ?? {})]);
    const made = answers[name];
    const value = typeof made === "function" ? made(clone(payload ?? {}), calls) : made === undefined ? fallback : made;
    if (value instanceof Error) throw value;
    return typeof value?.then === "function" ? value.then(clone) : clone(value);
  };
  const mefiStudio = {
    tasksChanges: reply("changes", changed()), tasksDiff: reply("diff", { ok: true, path: "src/a.js", status: "modified", additions: 1, deletions: 1, binary: false, truncated: false, lines: [{ k: "h", t: "@@ -1,2 +1,2 @@" }, { k: " ", t: "same", a: 1, b: 1 }, { k: "-", t: "old", a: 2 }, { k: "+", t: "new", b: 2 }] }),
    tasksAccept: reply("accept", { ok: true, accepted: true, attempt: 1 }), tasksRevert: reply("revert", { ok: true, reverted: 2, files: 2, already: 0, refused: [], receipt: "20260930T101010101Z", scope: "attempt", reopened: true }),
    tasksChecks: reply("checks", checked()), tasksCheckRun: reply("checkrun", { ok: true, attempt: 1, result: { id: "build", label: "Build", status: "ok", detail: "Built", ms: 1000 }, results: checked().results.map((row) => (row.id === "build" ? { id: "build", label: "Build", status: "ok", detail: "Built", ms: 1000 } : row)) }),
    tasksEvidence: reply("evidence", shots()), reviewPrefs: reply("prefs", prefs()),
    onReviewChanged: (callback) => { listeners.push(callback); },
  };
  const window = { MefiToast: (text, tone, options) => toasts.push({ text, tone, options }), ...(desktop ? { mefiStudio } : {}) };
  const context = vm.createContext({
    window, document: dom.document, Promise, Date, JSON, Map, Set, Number, String, Array, Object, Boolean, Math, Error, console,
    setTimeout: (run, delay) => { const timer = { run, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
  });
  vm.runInContext(`${controls}\nwindow.MefiUi = { arm, plainError };`, context);
  vm.runInContext(source, context);
  const fold = (open = true) => {
    const node = dom.document.createElement("details");
    const summary = dom.document.createElement("summary");
    summary.textContent = "Changes and checks";
    node.append(summary);
    node.open = open;
    dom.body.append(node);
    return node;
  };
  const mount = async (node, { taskId = "t1", projectId = "p1" } = {}) => { window.MefiReview.mount(node, { taskId, projectId }); await settle(); return node; };
  const pending = () => timers.filter((timer) => !timer.cancelled && !timer.done);
  const fire = async (delay) => { for (const timer of pending().filter((item) => delay === undefined || item.delay === delay)) { timer.done = true; timer.run(); } await settle(); };
  const named = (name) => calls.filter(([call]) => call === name).map(([, payload]) => payload);
  return { dom, window, context, calls, toasts, timers, listeners, fold, mount, pending, fire, named, api: mefiStudio };
}
const text = (node) => node.textContent;
const buttons = (node) => node.querySelectorAll("button");
const buttonNamed = (node, label) => buttons(node).find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
const tabNamed = (node, label) => node.querySelectorAll(".review-tab").find((item) => item.textContent.startsWith(label));

// ---- reading ----------------------------------------------------------------------------------------------------
test("nothing is read until the section is open, then the list is read once and kept for a short while", async () => {
  const p = page();
  const closed = await p.mount(p.fold(false));
  const reads = () => p.calls.filter(([name]) => name !== "prefs");
  assert.equal(reads().length, 0, "a closed section reads nothing of the project");
  assert.equal(p.named("prefs").length, 1, "only which switches the launch holds off, once, so a section that cannot work can stay hidden");
  assert.equal(text(closed.querySelector(".review")), "", "and draws nothing");
  p.window.MefiReview.refresh("t1"); p.window.MefiReview.refresh();
  await settle();
  assert.equal(reads().length, 0, "not even when something asks every section to read again");
  closed.open = true;
  await closed.trigger("toggle");
  await settle();
  assert.deepEqual(p.named("changes"), [{ taskId: "t1", projectId: "p1" }]);
  assert.equal(reads().length, 1, "only the Changed files panel is read");
  closed.open = false; await closed.trigger("toggle");
  closed.open = true; await closed.trigger("toggle");
  await settle();
  assert.equal(p.named("changes").length, 1, "opened again within a few seconds: the same answer");
  const again = await p.mount(p.fold(true));
  assert.equal(p.named("changes").length, 1, "a rebuilt detail pane reuses it too");
  assert.match(text(again), /2 files changed/);
});

test("a finished attempt is listed with its files, +/- and what can be done, and the heading counts them", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  assert.equal(text(node.querySelector("summary")), "Changes and checks · 2 files changed");
  assert.match(text(node), /2 files changed/);
  assert.equal(node.querySelector(".review-totals").textContent, "2 files changed");
  assert.match(node.querySelector(".review-head .review-nums").textContent, /\+5 −1/);
  assert.match(text(node), /Read from git, so it looks the same whichever builder did the work\./);
  assert.match(text(node), /Files git ignores, such as node_modules, can't be restored\./);
  const rows = node.querySelectorAll(".review-file");
  assert.deepEqual(rows.map((row) => row.querySelector(".review-file-name").textContent), ["a.js", "b.txt"]);
  assert.equal(rows[0].querySelector(".review-file-dir").textContent, "src/");
  assert.match(rows[1].textContent, /Added/);
  assert.ok(buttonNamed(node, "Accept changes") && !buttonNamed(node, "Accept changes").disabled);
  assert.ok(buttonNamed(node, "Revert attempt") && !buttonNamed(node, "Revert attempt").disabled);
  assert.equal(node.querySelectorAll(".review-tab").length, 3);
  assert.equal(tabNamed(node, "Changed files").getAttribute("aria-selected"), "true");
  assert.equal(tabNamed(node, "Checks").getAttribute("aria-selected"), "false");
});

test("what is not there says so in the host's own words: no attempt yet, a folder that is not a repository, a switch that is off", async () => {
  const none = page({ changes: { ok: true, available: true, attempts: [], attempt: null, files: [], totals: { files: 0, additions: 0, deletions: 0, binary: 0 }, state: "none", note: "" } });
  const a = await none.mount(none.fold(true));
  assert.match(text(a), /No changes yet/);
  assert.match(text(a), /Files appear here as the agent edits them\./);
  assert.equal(buttonNamed(a, "Accept changes"), undefined, "no buttons with nothing to act on");
  const repo = page({ changes: { ok: true, available: false, reason: "not-a-repo", note: "This project is not a Git repository, so Studio has no before-and-after record of its files.", taskId: "t1" } });
  const b = await repo.mount(repo.fold(true));
  assert.match(text(b), /This project is not a Git repository, so Studio has no before-and-after record of its files\./);
  assert.equal(text(b.querySelector("summary")), "Changes and checks");
  const off = page({ changes: { ok: true, available: false, reason: "off", forced: false, note: "Before-and-after snapshots are switched off on this PC." } });
  const c = await off.mount(off.fold(true));
  assert.match(text(c), /Before-and-after snapshots are switched off on this PC\./, "a setting that is off says so, and the switch to turn it on is right below");
  assert.equal(tabNamed(c, "Changed files").getAttribute("aria-selected"), "true");
});

test("an environment variable that holds the snapshots off hides the changed files, and all three hide the section", async () => {
  const forced = page({ changes: { ok: true, available: false, reason: "off", forced: true, note: "Before-and-after snapshots are switched off on this PC." } });
  const node = await forced.mount(forced.fold(true));
  assert.deepEqual(node.querySelectorAll(".review-tab").map((tab) => tab.textContent.trim()), ["Checks", "Preview"], "no Changed files tab");
  assert.equal(tabNamed(node, "Checks").getAttribute("aria-selected"), "true", "the first one left is showing");
  assert.doesNotMatch(text(node), /Before-and-after snapshots are switched off/, "and no note about what the owner chose to hold off");
  assert.equal(forced.named("checks").length, 1, "the Checks panel is read instead");
  assert.equal(node.hidden, false, "the rest of the section still works");
  await tabNamed(node, "Checks").trigger("keydown", { key: "ArrowLeft" });
  await settle();
  assert.equal(tabNamed(node, "Preview").getAttribute("aria-selected"), "true", "the arrow keys wrap across the tabs that are drawn");
  const all = page({ prefs: prefs({ prefs: { snapshots: false, advisory: false, advisoryBuild: false, shots: false }, forced: { snapshots: true, advisory: true, shots: true } }) });
  const gone = await all.mount(all.fold(true));
  assert.equal(gone.hidden, true, "nothing in it can work on this launch: there is no section");
  const partly = page({ prefs: prefs({ forced: { snapshots: true, advisory: false, shots: true } }) });
  assert.equal((await partly.mount(partly.fold(true))).hidden, false, "one left that works keeps it");
});

test("a host error is one sentence with Try again, and never throws into the page", async () => {
  let fail = true;
  const p = page({ changes: () => (fail ? { ok: false, error: "Open a project first." } : changed()) });
  const node = await p.mount(p.fold(true));
  assert.match(text(node), /Open a project first\./);
  fail = false;
  await buttonNamed(node, "Try again").click();
  await settle();
  assert.match(text(node), /2 files changed/);
  const thrown = page({ changes: new Error("Error invoking remote method 'tasks:changes': TypeError: x is not a function") });
  const bad = await thrown.mount(thrown.fold(true));
  assert.match(text(bad), /The changed files could not be read\./, "a programming error reads as the fallback, not as a stack");
  const web = page({}, { desktop: false });
  const plain = await web.mount(web.fold(true));
  assert.match(text(plain), /This is part of the desktop app\./);
});

// ---- the diff ---------------------------------------------------------------------------------------------------
test("one file's diff is read when it is opened, drawn as text with both line numbers, and closed by a second press", async () => {
  const p = page({ diff: { ok: true, path: "src/a.js", status: "modified", additions: 1, deletions: 1, binary: false, truncated: false, lines: [{ k: "h", t: "@@ -1,2 +1,2 @@" }, { k: " ", t: "same", a: 1, b: 1 }, { k: "-", t: "<img src=x onerror=alert(1)>", a: 2 }, { k: "+", t: "new", b: 2 }] } });
  const node = await p.mount(p.fold(true));
  assert.equal(p.named("diff").length, 0, "no diff is read until a file is opened");
  const first = node.querySelectorAll(".review-file-main")[0];
  assert.equal(first.getAttribute("aria-expanded"), "false");
  await first.click();
  await settle();
  assert.deepEqual(p.named("diff"), [{ taskId: "t1", projectId: "p1", attempt: 1, path: "src/a.js" }]);
  const diff = node.querySelector(".review-diff");
  assert.ok(diff, "drawn under its row");
  assert.deepEqual(diff.querySelectorAll(".review-diff-line").map((row) => row.dataset.k), ["h", " ", "-", "+"]);
  const removed = diff.querySelectorAll(".review-diff-line").find((row) => row.dataset.k === "-");
  assert.equal(removed.querySelector(".review-code").textContent, "<img src=x onerror=alert(1)>", "a line of the project is text, never markup");
  assert.equal(node.querySelectorAll("img").length, 0);
  assert.deepEqual(removed.querySelectorAll(".review-ln").map((cell) => cell.textContent), ["2", ""], "old and new line numbers");
  assert.equal(node.querySelectorAll(".review-file-main")[0].getAttribute("aria-expanded"), "true");
  await node.querySelectorAll(".review-file-main")[0].click();
  await settle();
  assert.equal(node.querySelector(".review-diff"), null, "a second press hides it");
  await node.querySelectorAll(".review-file-main")[0].click();
  await settle();
  assert.equal(p.named("diff").length, 1, "and opening it again reads nothing new");
  assert.ok(node.querySelector(".review-diff"));
});

test("a binary file, an empty diff, a long one and a diff that could not be read each say so; long ones come in pieces", async () => {
  const long = Array.from({ length: 450 }, (_, index) => ({ k: "+", t: `line ${index}`, b: index + 1 }));
  const answers = {
    "logo.png": { ok: true, binary: true, lines: [], truncated: false },
    "empty.txt": { ok: true, binary: false, lines: [], truncated: false },
    "long.js": { ok: true, binary: false, lines: long, truncated: true },
    "broken.js": { ok: false, error: "Git could not read that file's diff." },
  };
  const p = page({ diff: (body) => answers[body.path], changes: changed({ files: Object.keys(answers).map((name) => file(name)), totals: { files: 4, additions: 1, deletions: 0, binary: 1 } }) });
  const node = await p.mount(p.fold(true));
  const open = async (name) => { await node.querySelectorAll(".review-file-main").find((row) => row.querySelector(".review-file-name").textContent === name).click(); await settle(); };
  await open("logo.png");
  assert.match(text(node.querySelector(".review-diff")), /A binary file: its contents are not shown\./);
  await open("empty.txt");
  assert.equal(node.querySelectorAll(".review-diff").length, 1, "one file's diff at a time");
  assert.match(text(node.querySelector(".review-diff")), /There are no lines to show for this file\./);
  await open("long.js");
  assert.equal(node.querySelectorAll(".review-diff-line").length, 400, "the first 400 lines");
  await buttonNamed(node, "Show 50 more lines").click(); await settle();
  assert.equal(node.querySelectorAll(".review-diff-line").length, 450);
  assert.equal(buttonNamed(node, "Show 50 more lines"), undefined);
  assert.match(text(node.querySelector(".review-diff")), /only the first part of its changes is shown/, "a diff the host cut says so");
  await open("broken.js");
  assert.match(text(node.querySelector(".review-diff")), /Git could not read that file's diff\./);
  assert.equal(node.querySelector(".review-diff .review-note").dataset.tone, "bad");
  await open("broken.js"); // close
  await open("broken.js"); // and open again: a failure is asked about again
  assert.equal(p.named("diff").filter((body) => body.path === "broken.js").length, 2);
});

// ---- Accept -----------------------------------------------------------------------------------------------------
test("Accept changes records the owner's word, the chip replaces the button, and Undo accept takes it back", async () => {
  let accepted = false;
  const p = page({ changes: () => changed({ accepted }), accept: (body) => { accepted = body.accepted; return { ok: true, accepted: body.accepted, attempt: 1 }; } });
  const node = await p.mount(p.fold(true));
  await buttonNamed(node, "Accept changes").click();
  await settle();
  assert.deepEqual(p.named("accept"), [{ taskId: "t1", projectId: "p1", attempt: 1, accepted: true }]);
  assert.equal(p.toasts.at(-1).text, "Accepted 2 files");
  assert.equal(p.toasts.at(-1).options.action.label, "Undo");
  assert.match(text(node), /✓ Accepted/);
  assert.equal(buttonNamed(node, "Accept changes"), undefined);
  await buttonNamed(node, "Undo accept").click();
  await settle();
  assert.equal(p.named("accept").at(-1).accepted, false);
  assert.ok(buttonNamed(node, "Accept changes"), "back to the button");
  p.toasts.at(-1); // the toast's own Undo runs the same call
  accepted = false;
  await p.toasts[0].options.action.run();
  await settle();
  assert.equal(p.named("accept").at(-1).accepted, false);
});

test("while a worker is at work, Accept and Revert wait, and the page says why", async () => {
  const running = page({ changes: changed({ state: "running", running: true, waiting: true, canAccept: false, canRevert: false, attempts: [{ n: 1, runId: "run_1_1", startedAt: 1, endedAt: null, ended: false, selected: true, reverts: [], accepted: false, running: true }] }) });
  const a = await running.mount(running.fold(true));
  assert.match(text(a), /A worker is still changing files here\. This list updates as it works\. Accept and revert wait until the task is paused or finished, so nothing changes under a running agent\./);
  assert.equal(buttonNamed(a, "Accept changes").disabled, true);
  assert.equal(buttonNamed(a, "Revert attempt").disabled, true);
  assert.ok(buttonNamed(a, "Revert a.js")?.disabled, "nor one file");
  assert.match(text(a), /Attempt 1 · working now/);
  const other = page({ changes: changed({ waiting: true, canAccept: false, canRevert: false }) });
  const b = await other.mount(other.fold(true));
  assert.match(text(b), /A worker is changing files in this folder, so Accept and revert wait until it is paused or finished\./);
  const unfinished = page({ changes: changed({ state: "unfinished", canAccept: false, canRevert: false }) });
  const c = await unfinished.mount(unfinished.fold(true));
  assert.match(text(c), /never recorded its end/);
  const overlapped = page({ changes: changed({ overlap: ["run_2_1"], skipped: { count: 1, files: ["big.bin"], sentence: "1 file over the size limit was left out: big.bin." } }) });
  const d = await overlapped.mount(overlapped.fold(true));
  assert.match(text(d), /Other workers were changing files in this folder at the same time/);
  assert.match(text(d), /1 file over the size limit was left out: big\.bin\./);
});

// ---- Revert -----------------------------------------------------------------------------------------------------
test("Revert attempt takes two presses: the first arms 'Revert all N' and sends nothing, the second reverts, reopens and offers Undo", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  const revert = buttonNamed(node, "Revert attempt");
  await revert.click();
  assert.equal(p.named("revert").length, 0, "one press only asks");
  assert.equal(revert.textContent, "Revert all 2", "and says what it would do");
  assert.ok(revert.classList.contains("danger-armed"));
  await revert.click();
  await settle();
  assert.deepEqual(p.named("revert"), [{ taskId: "t1", projectId: "p1", attempt: 1, scope: "attempt" }], "the whole attempt, and not as a partial one");
  assert.equal(p.toasts.at(-1).text, "Reverted 2 files. The task is reopened.");
  assert.equal(p.toasts.at(-1).options.duration, 10000);
  assert.equal(p.toasts.at(-1).options.action.label, "Undo");
  assert.match(text(node), /Put back 2 files\. The task is reopened\. A copy of the folder as it was is kept\./);
  assert.ok(buttonNamed(node, "Undo the revert"));
  assert.equal(p.named("changes").length, 2, "the list is read again");
  await buttonNamed(node, "Undo the revert").click();
  await settle();
  assert.deepEqual(p.named("revert").at(-1), { taskId: "t1", projectId: "p1", attempt: 1, undo: "20260930T101010101Z" });
  assert.match(text(node), /The files are back as the attempt left them\. The task stays open\./);
  assert.equal(buttonNamed(node, "Undo the revert"), undefined, "a revert is undone once");
});

test("Revert file sends that one file, never the attempt, and offers Undo", async () => {
  const p = page({ revert: { ok: true, reverted: 1, files: 1, already: 0, refused: [], receipt: "20260930T101010101Z", scope: "file", reopened: false } });
  const node = await p.mount(p.fold(true));
  await node.querySelectorAll(".review-file-main")[0].click(); await settle();
  assert.ok(node.querySelector(".review-diff .review-diff-line"), "a diff is open");
  await buttonNamed(node, "Revert a.js").click();
  await settle();
  assert.deepEqual(p.named("revert"), [{ taskId: "t1", projectId: "p1", attempt: 1, scope: "file", path: "src/a.js" }]);
  assert.ok(node.querySelector(".review-diff .review-diff-line"), "it stays drawn: the attempt's own diff does not change when a file is put back");
  assert.equal(p.named("diff").length, 1, "and is not read again");
  assert.equal(p.toasts.at(-1).text, "Reverted a.js");
  assert.match(text(node), /Put back a\.js\. A copy of the folder as it was is kept\./);
  await buttonNamed(node, "Undo").click();
  await settle();
  assert.equal(p.named("revert").at(-1).undo, "20260930T101010101Z");
});

test("a refused revert shows the host's sentence and offers only the safe way on: the files that have not changed", async () => {
  const sentence = "Nothing was reverted. 1 file has changed since the attempt ended: src/a.js. Studio does not overwrite work it did not make.";
  const answers = [{ ok: false, refused: [{ path: "src/a.js", reason: "changed-since" }], error: sentence }, { ok: true, reverted: 1, files: 1, already: 0, refused: [{ path: "src/a.js", reason: "changed-since" }], receipt: "20260930T101010101Z", reopened: true, note: "1 file was left alone because it changed since the attempt ended: src/a.js." }];
  const p = page({ revert: () => answers.shift(), changes: changed({ files: [file("src/a.js", { state: "changed" }), file("b.txt", { status: "added", additions: 3, deletions: 0 })] }) });
  const node = await p.mount(p.fold(true));
  assert.match(text(node), /Changed since/, "the file that was edited since says so");
  assert.equal(buttonNamed(node, "Revert a.js"), undefined, "and has no revert of its own");
  await buttonNamed(node, "Revert attempt").click();
  await buttonNamed(node, "Revert all 2").click();
  await settle();
  const warning = node.querySelector(".review-note");
  assert.equal(warning.dataset.tone, "warn");
  assert.ok(text(warning).startsWith(sentence));
  assert.equal(p.named("revert")[0].partial, undefined);
  assert.equal(p.toasts.length, 0, "a refusal is a sentence in the section, not a toast");
  await buttonNamed(node, "Revert the 1 unchanged file").click();
  await settle();
  assert.deepEqual(p.named("revert")[1], { taskId: "t1", projectId: "p1", attempt: 1, scope: "attempt", partial: true });
  assert.match(text(node), /Put back 1 file\. The task is reopened\. 1 file was left alone because it changed since the attempt ended: src\/a\.js\./);
});

test("a revert that cannot start says why: a worker in the folder, a task that cannot be reopened, a reopen that failed after the files were back", async () => {
  for (const [answer, tone, pattern] of [
    [{ ok: false, busy: true, error: "A builder is working in this folder. Wait for it to finish or pause it, so nothing changes under it." }, "warn", /A builder is working in this folder/],
    [{ ok: false, blocked: true, error: "This task is being checked. Let the check finish, then revert." }, "bad", /being checked/],
    [{ ok: false, error: "Git could not read the earlier copy of b.txt. Nothing was changed." }, "bad", /Nothing was changed/],
  ]) {
    const p = page({ revert: answer });
    const node = await p.mount(p.fold(true));
    await buttonNamed(node, "Revert attempt").click();
    await buttonNamed(node, "Revert all 2").click();
    await settle();
    const shown = node.querySelector(".review-note");
    assert.equal(shown.dataset.tone, tone);
    assert.match(text(shown), pattern);
    assert.equal(buttonNamed(node, "Revert the 2 unchanged files"), undefined, "no partial offered when nothing was refused by name");
  }
  const reopened = page({ revert: { ok: true, reverted: 2, files: 2, already: 0, refused: [], receipt: "20260930T101010101Z", scope: "attempt", reopened: false, reopenError: "Let verification finish, or confirm the completed work explicitly." } });
  const node = await reopened.mount(reopened.fold(true));
  await buttonNamed(node, "Revert attempt").click();
  await buttonNamed(node, "Revert all 2").click();
  await settle();
  assert.match(text(node.querySelector(".review-note")), /Put back 2 files\. The task could not be reopened: Let verification finish/);
  assert.equal(reopened.toasts.at(-1).tone, "warn");
});

test("everything reverted reads as such, with the approved sentence, and a second press does not send two calls", async () => {
  const p = page({ changes: changed({ files: [file("src/a.js", { state: "reverted" }), file("b.txt", { state: "reverted" })], canRevert: false }) });
  const node = await p.mount(p.fold(true));
  assert.match(text(node), /Everything was reverted/);
  assert.match(text(node), /The task was reopened\. Nothing from that attempt is left in the folder\./);
  assert.equal(buttonNamed(node, "Revert attempt").disabled, true);
  const slow = page({ accept: () => new Promise(() => {}) });
  const held = await slow.mount(slow.fold(true));
  const accept = buttonNamed(held, "Accept changes");
  accept.click(); accept.click();
  await settle();
  assert.equal(slow.named("accept").length, 1, "a second press while one is in flight sends nothing");
  assert.equal(buttonNamed(held, "Accept changes").disabled, true, "and the buttons wait until it answers");
  assert.equal(buttonNamed(held, "Revert attempt").disabled, true);
});

// ---- a running attempt and the host's pushes -------------------------------------------------------------------------
test("a running attempt is read again every few seconds while the section is open and the window shows; a finished one is not", async () => {
  let live = true;
  const p = page({ changes: () => changed(live ? { state: "running", running: true, canAccept: false, canRevert: false } : {}) });
  const node = await p.mount(p.fold(true));
  assert.match(text(node), /A worker is still changing files here/);
  assert.deepEqual(p.pending().map((timer) => timer.delay), [6000]);
  await p.fire(6000);
  assert.equal(p.named("changes").length, 2);
  p.dom.document.hidden = true;
  await p.fire(6000);
  assert.equal(p.named("changes").length, 2, "a hidden window reads nothing");
  assert.deepEqual(p.pending().map((timer) => timer.delay), [6000], "and looks again later");
  p.dom.document.hidden = false;
  live = false;
  await p.fire(6000);
  assert.equal(p.named("changes").length, 3);
  assert.equal(buttonNamed(node, "Accept changes").disabled, false, "the buttons are back once it has ended");
  assert.doesNotMatch(text(node), /A worker is still changing files here/);
  assert.deepEqual(p.pending(), [], "an attempt that ended is not polled");
  live = true;
  const again = page({ changes: changed({ state: "running", running: true }) });
  const open = await again.mount(again.fold(true));
  open.open = false;
  await open.trigger("toggle");
  assert.deepEqual(again.pending(), [], "closing the section stops it");
});

test("the host's pushes refresh what they name, for that task only, once", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  assert.equal(p.named("changes").length, 1);
  const tell = (what, extra = {}) => p.listeners[0]({ projectId: "p1", taskId: "t1", attempt: 1, what, ...extra });
  assert.equal(p.listeners.length, 1, "subscribed once");
  tell("ended"); tell("shot"); tell("ended");
  assert.equal(p.named("changes").length, 1, "not at once: pushes that arrive together share one read");
  assert.equal(p.pending().filter((timer) => timer.delay === 400).length, 1, "and one pause, however many arrive");
  await p.fire(400);
  assert.equal(p.named("changes").length, 2);
  assert.equal(p.named("evidence").length, 0, "a new shot is not read while the Preview tab is not showing");
  tell("checks", { taskId: "other" }); tell("ended", { taskId: "other" });
  await p.fire(400);
  assert.equal(p.named("changes").length, 2, "another task's push is none of this one's business");
  tell("bogus");
  assert.equal(p.pending().length, 0);
  await tabNamed(node, "Preview").click();
  await settle();
  assert.equal(p.named("evidence").length, 1, "it is read when the tab is opened");
  tell("shot");
  await p.fire(400);
  assert.equal(p.named("evidence").length, 2, "and follows a new shot while it shows");
  await tabNamed(node, "Checks").click();
  await settle();
  tell("checks");
  await p.fire(400);
  assert.equal(p.named("checks").length, 2, "checks: read on opening the tab, then again for the push");
});

test("with several attempts a picker chooses one, and its files, checks and shots are all that attempt's", async () => {
  const attempts = [{ n: 2, runId: "run_2_1", startedAt: 5, endedAt: Date.now() - 1000, ended: true, selected: true, reverts: [], accepted: true, running: false }, { n: 1, runId: "run_1_1", startedAt: 1, endedAt: Date.now() - 3600000 * 3, ended: true, selected: false, reverts: [], accepted: false, running: false }];
  const p = page({ changes: (body) => changed({ attempt: body.attempt ?? 2, attempts: attempts.map((item) => ({ ...item, selected: item.n === (body.attempt ?? 2) })) }) });
  const node = await p.mount(p.fold(true));
  const select = node.querySelector(".review-select");
  assert.match(select.querySelectorAll("option")[0].textContent, /^Attempt 2 · just now · accepted$/);
  assert.match(select.querySelectorAll("option")[1].textContent, /^Attempt 1 · 3 h ago$/);
  assert.equal(select.value, "2");
  select.value = "1";
  await select.trigger("change");
  await settle();
  assert.deepEqual(p.named("changes").at(-1), { taskId: "t1", projectId: "p1", attempt: 1 }, "the older attempt is asked for by number");
  await tabNamed(node, "Checks").click(); await settle();
  assert.equal(p.named("checks").at(-1).attempt, 1);
  await tabNamed(node, "Preview").click(); await settle();
  assert.equal(p.named("evidence").at(-1).attempt, 1);
  await tabNamed(node, "Changed files").click(); await settle();
  node.querySelector(".review-select").value = "2";
  await node.querySelector(".review-select").trigger("change");
  await settle();
  assert.equal(p.named("changes").at(-1).attempt, undefined, "choosing the newest goes back to following the newest");
});

test("an answer for an attempt the person has already left is dropped, and the attempt they chose is read whatever is still in flight", async () => {
  const gate = {};
  const hold = (name) => new Promise((resolve) => { gate[name] = resolve; });
  const held = hold("old");
  const attempts = [{ n: 2, runId: "run_2_1", startedAt: 5, endedAt: 9, ended: true, selected: true, reverts: [], accepted: false, running: false }, { n: 1, runId: "run_1_1", startedAt: 1, endedAt: 2, ended: true, selected: false, reverts: [], accepted: false, running: false }];
  const p = page({ changes: async (body) => (body.attempt === 1 ? held.then(() => changed({ attempt: 1, attempts, files: [file("old.txt")], totals: { files: 1, additions: 1, deletions: 0, binary: 0 } })) : changed({ attempt: 2, attempts, files: [file("new.txt")], totals: { files: 1, additions: 1, deletions: 0, binary: 0 } })) });
  const node = await p.mount(p.fold(true));
  assert.match(text(node), /new\.txt/);
  const select = node.querySelector(".review-select");
  select.value = "1"; await select.trigger("change"); await settle();
  assert.match(text(node), /Reading the changed files…/, "the older attempt is slow");
  // Before it answers, the person goes back to the newest attempt.
  const again = node.querySelector(".review-select") ?? select;
  again.value = "2"; await again.trigger("change"); await settle();
  assert.equal(p.named("changes").length, 3, "the newest is read on its own, not joined to the read still in flight");
  assert.match(text(node), /new\.txt/);
  gate.old();
  await settle();
  assert.doesNotMatch(text(node), /old\.txt/, "the late answer for the attempt that was left is dropped");
  assert.match(text(node), /new\.txt/);
});

// ---- Checks -----------------------------------------------------------------------------------------------------
test("Checks: advisory, never blocks Done; a mark and a sentence for each, Run for each the project has, output for a failure", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  await tabNamed(node, "Checks").click();
  await settle();
  assert.deepEqual(p.named("checks"), [{ taskId: "t1", projectId: "p1", attempt: 1 }]);
  assert.match(text(node), /Advisory — never blocks Done/);
  assert.match(text(node), /Last run 1 min ago/);
  const rows = node.querySelectorAll(".review-check");
  assert.deepEqual(rows.map((row) => [row.dataset.status, row.querySelector(".review-check-label").textContent, row.querySelector(".review-check-detail").textContent]), [["ok", "Typecheck", "0 errors"], ["bad", "Lint", "3 errors"], ["skipped", "Build", "Not run on its own, because a build writes files. Run it now."]]);
  assert.deepEqual(rows.map((row) => row.querySelector(".review-mark").getAttribute("aria-label")), ["Passed", "Failed", "Not run"], "never only a colour");
  assert.deepEqual(rows.map((row) => row.querySelector(".review-mark").textContent), ["✓", "✕", "–"]);
  assert.match(text(rows[1].querySelector(".review-tail")), /src\/a\.js:1 no-undef <b>x<\/b>/, "a failure's output is text");
  assert.equal(node.querySelectorAll(".review-tail b").length, 0);
  assert.match(text(node), /A build writes files, so it only runs when you press Run\./);
  assert.equal(buttonNamed(node, "Run Build").textContent, "Run");
});

test("Run sends the check's id for this attempt and replaces that row with the result", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  await tabNamed(node, "Checks").click(); await settle();
  await buttonNamed(node, "Run Build").click();
  await settle();
  assert.deepEqual(p.named("checkrun"), [{ taskId: "t1", projectId: "p1", attempt: 1, id: "build" }]);
  const rows = node.querySelectorAll(".review-check");
  assert.deepEqual(rows.map((row) => row.dataset.status), ["ok", "bad", "ok"]);
  assert.equal(rows[2].querySelector(".review-check-detail").textContent, "Built");
  const refused = page({ checkrun: { ok: false, busy: true, error: "A build writes files, so it waits until no builder is working on this project." } });
  const other = await refused.mount(refused.fold(true));
  await tabNamed(other, "Checks").click(); await settle();
  await buttonNamed(other, "Run Build").click(); await settle();
  assert.match(text(other), /A build writes files, so it waits until no builder is working on this project\./);
  assert.equal(other.querySelectorAll(".review-check").length, 3, "the rows stay");
});

test("Checks that are off, forced off or not found say so", async () => {
  const off = page({ checks: { ok: true, available: false, reason: "off", forced: true, taskId: "t1" } });
  const a = await off.mount(off.fold(true));
  await tabNamed(a, "Checks").click(); await settle();
  assert.match(text(a), /Advisory checks are switched off on this PC\./);
  assert.match(text(a), /It is switched off for this launch\./);
  const none = page({ checks: checked({ results: [], detected: [], none: true }) });
  const b = await none.mount(none.fold(true));
  await tabNamed(b, "Checks").click(); await settle();
  assert.match(text(b), /No advisory checks found/);
  assert.match(text(b), /package\.json/);
});

// ---- Preview ----------------------------------------------------------------------------------------------------
test("Preview: the before and after shots with their captions, and the privacy line", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  await tabNamed(node, "Preview").click(); await settle();
  assert.deepEqual(p.named("evidence"), [{ taskId: "t1", projectId: "p1", attempt: 1 }]);
  const figures = node.querySelectorAll(".review-shot");
  assert.deepEqual(figures.map((figure) => figure.dataset.phase), ["before", "after"]);
  const images = node.querySelectorAll("img");
  assert.equal(images.length, 2);
  assert.equal(images[0].src, PNG);
  assert.equal(images[0].alt, "The project preview when the task started");
  assert.equal(images[1].alt, "The project preview when the task finished");
  assert.match(text(figures[0]), /Before/);
  assert.match(text(figures[0]), /Captured when the task started\./);
  assert.match(text(figures[1]), /Captured when the task finished\./);
  assert.match(text(node), /Screenshots stay on this PC\. They can show secrets, so they are never added to a problem report\./);
});

test("Preview: a side with no shot says why in the host's words, an oversized one is named, and a picture that is not a PNG is never drawn", async () => {
  const p = page({ evidence: shots({ shots: [{ phase: "after", at: 2, bytes: 10, width: 1280, height: 800, dataUrl: PNG }], notes: { before: "The preview was not running when this task started.", after: "Captured when the task finished." } }) });
  const node = await p.mount(p.fold(true));
  await tabNamed(node, "Preview").click(); await settle();
  assert.match(text(node.querySelectorAll(".review-shot")[0]), /The preview was not running when this task started\./);
  assert.equal(node.querySelectorAll("img").length, 1);
  const big = page({ evidence: shots({ shots: [{ phase: "before", at: 1, bytes: 9e6, width: 1280, height: 800, tooBig: true }], notes: { before: "Captured when the task started.", after: "The preview did not answer when this task finished, so there is no shot." } }) });
  const b = await big.mount(big.fold(true));
  await tabNamed(b, "Preview").click(); await settle();
  assert.match(text(b), /This picture is too large to show here\./);
  assert.match(text(b), /The preview did not answer when this task finished, so there is no shot\./);
  const hostile = page({ evidence: shots({ shots: [{ phase: "before", at: 1, bytes: 10, width: 1280, height: 800, dataUrl: "javascript:alert(1)" }, { phase: "after", at: 1, bytes: 10, width: 1280, height: 800, dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }] }) });
  const c = await hostile.mount(hostile.fold(true));
  await tabNamed(c, "Preview").click(); await settle();
  assert.equal(c.querySelectorAll("img").length, 0, "only a PNG data URL is ever drawn");
  const offline = page({ evidence: shots({ enabled: false, forced: true, shots: [] , notes: {} }) });
  const d = await offline.mount(offline.fold(true));
  await tabNamed(d, "Preview").click(); await settle();
  assert.match(text(d), /Screenshots are switched off on this PC, so no new ones are taken\. It is switched off for this launch\./);
});

// ---- the three switches ---------------------------------------------------------------------------------------------------
test("the three switches show the owner's choices, save one at a time, and a forced one is off and cannot be turned on here", async () => {
  let saved = prefs();
  const p = page({ prefs: (body) => { const patch = Object.fromEntries(Object.entries(body).filter(([key]) => ["snapshots", "advisory", "advisoryBuild", "shots"].includes(key))); if (Object.keys(patch).length) saved = prefs({ saved: { ...saved.saved, ...patch }, prefs: { ...saved.prefs, ...patch } }); return saved; } });
  const node = await p.mount(p.fold(true));
  const settings = node.querySelector(".review-settings");
  assert.equal(p.named("prefs").length, 1, "read once when the section first appears");
  assert.equal(node.querySelectorAll(".review-switch input").length, 4, "the switches are drawn from that read");
  settings.open = true; await settings.trigger("toggle"); await settle();
  assert.equal(p.named("prefs").length, 2, "and again each time the settings are opened");
  assert.deepEqual(p.named("prefs")[1], {}, "a read sends no choice");
  const boxes = () => node.querySelectorAll(".review-switch input");
  assert.deepEqual(boxes().map((box) => box.checked), [true, true, false, true], "on by default, except the build");
  assert.match(text(node.querySelector(".review-settings")), /Keep a before and after picture of each attempt/);
  assert.match(text(node.querySelector(".review-settings")), /never pushed/);
  boxes()[3].checked = false;
  await boxes()[3].trigger("change"); await settle();
  assert.deepEqual(p.named("prefs").at(-1), { shots: false }, "one choice, nothing else");
  assert.equal(p.toasts.at(-1).text, "Screenshots is off.".replace("is off", "is off"));
  assert.deepEqual(boxes().map((box) => box.checked), [true, true, false, false]);
  // The environment's switch wins: shown off, disabled, and said so.
  saved = prefs({ prefs: { snapshots: false, advisory: true, advisoryBuild: false, shots: true }, saved: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, forced: { snapshots: true, advisory: false, shots: false } });
  settings.open = false; await settings.trigger("toggle");
  settings.open = true; await settings.trigger("toggle"); await settle();
  const forced = node.querySelector(".review-settings");
  assert.equal(boxes()[0].checked, false);
  assert.equal(boxes()[0].disabled, true);
  assert.match(text(forced), /Switched off for this launch\./);
  // Without the checks the build has nothing to join.
  saved = prefs({ prefs: { snapshots: true, advisory: false, advisoryBuild: false, shots: true }, saved: { snapshots: true, advisory: false, advisoryBuild: true, shots: true } });
  boxes()[1].checked = false;
  await boxes()[1].trigger("change"); await settle();
  assert.equal(boxes()[2].disabled, true);
  assert.match(text(node.querySelector(".review-settings")), /It needs the checks above switched on\./);
  assert.equal(p.named("changes").length > 1, true, "a change of switch reads what it shows again");
});

// ---- the keyboard, sizes, safety -------------------------------------------------------------------------------------------------
test("tabs follow the arrow keys and keep the keyboard where it was; controls keep their place through a repaint", async () => {
  const p = page();
  const node = await p.mount(p.fold(true));
  const first = tabNamed(node, "Changed files");
  assert.equal(first.tabIndex, 0);
  assert.equal(tabNamed(node, "Checks").tabIndex, -1, "one tab stop for the row");
  first.focus();
  await first.trigger("keydown", { key: "ArrowRight" });
  await settle();
  assert.equal(tabNamed(node, "Checks").getAttribute("aria-selected"), "true");
  assert.equal(p.named("checks").length, 1);
  assert.equal(p.dom.document.activeElement, tabNamed(node, "Checks"), "the keyboard went with the selection, onto the tab that was drawn");
  await tabNamed(node, "Checks").trigger("keydown", { key: "End" });
  await settle();
  assert.equal(tabNamed(node, "Preview").getAttribute("aria-selected"), "true");
  await tabNamed(node, "Preview").trigger("keydown", { key: "ArrowRight" });
  await settle();
  assert.equal(tabNamed(node, "Changed files").getAttribute("aria-selected"), "true", "and wrap round");
  const panel = node.querySelector("[role=tabpanel]");
  assert.equal(panel.getAttribute("aria-labelledby"), tabNamed(node, "Changed files").id);
  // A repaint puts focus back on the control that had it.
  const accept = buttonNamed(node, "Accept changes");
  accept.focus();
  assert.equal(p.dom.document.activeElement, accept);
  await p.window.MefiReview.refresh("t1"); await settle();
  const again = buttonNamed(node, "Accept changes");
  assert.notEqual(again, accept, "the section was redrawn");
  assert.equal(p.dom.document.activeElement, again, "and the keyboard is on the new copy of the same control");
});

test("more than 200 files come in steps, and the list says when git held more than it lists", async () => {
  const many = Array.from({ length: 230 }, (_, index) => file(`f/${String(index).padStart(3, "0")}.txt`));
  const p = page({ changes: changed({ files: many, totals: { files: 1300, additions: 1, deletions: 1, binary: 0 }, more: 1070 }) });
  const node = await p.mount(p.fold(true));
  assert.equal(node.querySelectorAll(".review-file").length, 200);
  await buttonNamed(node, "Show 30 more files").click(); await settle();
  assert.equal(node.querySelectorAll(".review-file").length, 230);
  assert.match(text(node), /1070 more files changed, too many to list here\./);
  assert.equal(text(node.querySelector("summary")), "Changes and checks · 1300 files changed");
});

test("nothing the project holds is read as markup, the section draws no scrollbar of its own and no text is under 12 px", () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|srcdoc|\.href\s*=/, "file names, diff lines and check output are text");
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket/, "nothing leaves the page but the bridge's calls");
  const sizes = [...css.matchAll(/font(?:-size)?:\s*(?:[0-9]{3}\s+)?([0-9.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 10 && sizes.every((size) => size >= 12), `font sizes: ${[...new Set(sizes)].join(", ")}`);
  assert.doesNotMatch(css, /overflow(?:-x|-y)?:\s*(?:auto|scroll)/, "long lines wrap instead of scrolling");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "every colour is a theme token");
  assert.match(source, /MefiUi\.arm\(node, \{ run, armed \}\)/, "the destructive button is the shared two-step one");
  assert.match(source, /armed: `Revert all \$\{count\}`/);
});
