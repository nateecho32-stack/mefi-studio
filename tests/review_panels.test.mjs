// review.js drawn one panel at a time (MefiReview.mount(host, { taskId, projectId, panel })): what the v2
// inspector (renderer/sessions.js) mounts in its Changes, Checks and Preview tabs. The panels are the ones the Evidence
// tab's section has (tests/review_ui.test.mjs pins those, untouched), without the tab row and with their own label
// from the caller. Every view of a task shares that task's record, so the attempt a person picked, what was read and
// what Accept and Revert answered are the same wherever they show; a panel is read only while some view of it is on
// screen; and counts() and onChange() tell a tab label what the list holds without opening it.
//
// Run: node --test tests/review_panels.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createDom } from "./fixtures/renderer-dom.mjs";

const source = readFileSync(new URL("../renderer/review.js", import.meta.url), "utf8");
const studioUi = readFileSync(new URL("../renderer/studio-ui.js", import.meta.url), "utf8");
const controls = studioUi.slice(studioUi.indexOf("  function arm("), studioUi.indexOf("  window.MefiUi = Object.assign("));

const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); await new Promise((resolve) => setImmediate(resolve)); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const file = (path, more = {}) => ({ path, dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "", name: path.slice(path.lastIndexOf("/") + 1), oldPath: null, status: "modified", additions: 2, deletions: 1, binary: false, kind: "file", state: "can-revert", ...more });
const changed = (more = {}) => ({
  ok: true, available: true, taskId: "t1", projectId: "p1", attempt: 2, runId: "run_1_2", state: "ended",
  attempts: [
    { n: 2, runId: "run_1_2", startedAt: 3, endedAt: Date.now() - 120000, ended: true, selected: true, reverts: [], accepted: false, running: false },
    { n: 1, runId: "run_1_1", startedAt: 1, endedAt: Date.now() - 360000, ended: true, selected: false, reverts: [], accepted: false, running: false },
  ],
  files: [file("src/a.js"), file("b.txt", { status: "added", additions: 3, deletions: 0 })],
  totals: { files: 2, additions: 5, deletions: 1, binary: 0 }, more: 0, skipped: { count: 0, files: [], sentence: "" }, overlap: [], worktree: false,
  accepted: false, running: false, waiting: false, canAccept: true, canRevert: true, ...more,
});
const checked = (more = {}) => ({
  ok: true, available: true, taskId: "t1", projectId: "p1", attempt: 2, at: Date.now() - 60000,
  results: [{ id: "typecheck", label: "Typecheck", status: "ok", detail: "0 errors", ms: 900 }, { id: "lint", label: "Lint", status: "warn", detail: "2 warnings", ms: 400 }],
  detected: [{ id: "typecheck", label: "Typecheck", auto: true, writes: false }, { id: "lint", label: "Lint", auto: true, writes: false }],
  none: false, build: false, ...more,
});
const shots = (more = {}) => ({
  ok: true, taskId: "t1", projectId: "p1", attempt: 2, runId: "run_1_2", enabled: true, forced: false,
  shots: [{ phase: "before", at: 1, bytes: 10, width: 1280, height: 800, dataUrl: PNG }, { phase: "after", at: 2, bytes: 10, width: 1280, height: 800, dataUrl: PNG }],
  notes: { before: "Captured when the task started.", after: "Captured when the task finished." },
  privacy: "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report.", ...more,
});
const prefs = (more = {}) => ({ ok: true, prefs: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, saved: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, forced: { snapshots: false, advisory: false, shots: false }, ...more });

function page(answers = {}) {
  const dom = createDom();
  dom.document.createElement("div").constructor.prototype.focus = function () { dom.document.activeElement = this; this.focused = true; };
  const calls = [], toasts = [], timers = [], listeners = [];
  const reply = (name, fallback) => async (payload) => {
    calls.push([name, clone(payload ?? {})]);
    const made = answers[name];
    const value = typeof made === "function" ? made(clone(payload ?? {}), calls) : made === undefined ? fallback : made;
    if (value instanceof Error) throw value;
    return clone(value);
  };
  const mefiStudio = {
    tasksChanges: reply("changes", changed()),
    tasksDiff: reply("diff", { ok: true, path: "src/a.js", status: "modified", additions: 1, deletions: 1, binary: false, truncated: false, lines: [{ k: "+", t: "new", b: 1 }] }),
    tasksAccept: reply("accept", { ok: true, accepted: true, attempt: 2 }),
    tasksRevert: reply("revert", { ok: true, reverted: 2, files: 2, already: 0, refused: [], receipt: "20260930T101010101Z", scope: "attempt", reopened: true }),
    tasksChecks: reply("checks", checked()),
    tasksCheckRun: reply("checkrun", { ok: true, attempt: 2, results: checked().results }),
    tasksEvidence: reply("evidence", shots()), reviewPrefs: reply("prefs", prefs()),
    onReviewChanged: (callback) => { listeners.push(callback); },
  };
  const window = { MefiToast: (text, tone, options) => toasts.push({ text, tone, options }), mefiStudio };
  const context = vm.createContext({
    window, document: dom.document, Promise, Date, JSON, Map, Set, Number, String, Array, Object, Boolean, Math, Error, console,
    setTimeout: (run, delay) => { const timer = { run, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
  });
  vm.runInContext(`${controls}\nwindow.MefiUi = { arm, plainError };`, context);
  vm.runInContext(source, context);
  const host = () => { const node = dom.document.createElement("div"); dom.body.append(node); return node; };
  const mount = async (node, panel, { taskId = "t1", projectId = "p1", labelledBy = "" } = {}) => { const handle = window.MefiReview.mount(node, { taskId, projectId, panel, labelledBy }); await settle(); return handle; };
  const live = () => timers.filter((timer) => !timer.cancelled && !timer.done);
  const fire = async (delay) => { for (const timer of live().filter((item) => delay === undefined || item.delay === delay)) { timer.done = true; timer.run(); } await settle(); };
  const named = (name) => calls.filter(([call]) => call === name).map(([, payload]) => payload);
  return { dom, window, calls, toasts, timers, listeners, host, mount, live, fire, named, api: mefiStudio };
}
const text = (node) => node.textContent;
const buttonNamed = (node, label) => node.querySelectorAll("button").find((item) => item.textContent === label || item.getAttribute("aria-label") === label);

test("a panel mounted on its own is drawn without a tab row, labelled by the caller's tab, with the switches under it", async () => {
  const p = page();
  const box = p.host();
  const handle = await p.mount(box, "changes", { labelledBy: "sx-tab-changes" });
  assert.ok(handle && typeof handle.unmount === "function");
  assert.equal(box.querySelectorAll(".review-tabs").length, 0, "no tab row: the inspector has its own");
  const panel = box.querySelector(".review-panel");
  assert.equal(panel.getAttribute("role"), "tabpanel");
  assert.equal(panel.getAttribute("aria-labelledby"), "sx-tab-changes");
  assert.match(text(panel), /2 files changed/);
  assert.equal(box.querySelectorAll(".review-file").length, 2);
  assert.ok(box.querySelector("details.review-settings"), "what Studio keeps for each attempt stays reachable");
  const bare = p.host();
  await p.mount(bare, "checks");
  assert.equal(bare.querySelector(".review-panel").getAttribute("aria-label"), "Checks", "with no tab of the caller's to name it, it names itself");
  assert.equal(bare.querySelector(".review-panel").getAttribute("aria-labelledby"), null);
});

test("each panel reads only its own data: Changes the list, Checks the checks, Preview the shots", async () => {
  const p = page();
  await p.mount(p.host(), "checks");
  assert.equal(p.named("checks").length, 1);
  assert.equal(p.named("changes").length, 0, "the Checks panel does not ask for the list");
  assert.equal(p.named("evidence").length, 0);
  const preview = p.host();
  await p.mount(preview, "preview");
  assert.equal(p.named("evidence").length, 1);
  assert.equal(p.named("changes").length, 0);
  assert.equal(preview.querySelectorAll(".review-shot").length, 2, "Before and After");
  assert.equal(preview.querySelectorAll("img.review-shot-image").length, 2);
  assert.match(text(preview), /Captured when the task started\./);
  await p.mount(p.host(), "changes");
  assert.equal(p.named("changes").length, 1);
  assert.equal(p.named("checks").length, 1, "and nothing is read twice for a panel that was already drawn");
});

test("the views of a task share one record: the attempt chosen in the list is the one the Checks and Preview panels read", async () => {
  const p = page();
  const list = p.host(), checks = p.host(), preview = p.host();
  await p.mount(list, "changes");
  await p.mount(checks, "checks");
  await p.mount(preview, "preview");
  assert.deepEqual(p.named("checks"), [{ taskId: "t1", projectId: "p1", attempt: 2 }], "the attempt the list is showing: the newest, which the host named");
  const select = list.querySelector("select.review-select");
  assert.ok(select, "two attempts: a picker");
  select.value = "1";
  await select.trigger("change");
  await settle();
  assert.deepEqual(p.named("changes").at(-1), { taskId: "t1", projectId: "p1", attempt: 1 }, "the list reads attempt 1");
  assert.deepEqual(p.named("checks").at(-1), { taskId: "t1", projectId: "p1", attempt: 1 }, "so do the checks");
  assert.deepEqual(p.named("evidence").at(-1), { taskId: "t1", projectId: "p1", attempt: 1 }, "and the shots");
});

test("counts() says what the list holds for a tab label, and onChange() tells when a panel was drawn again", async () => {
  const p = page();
  assert.equal(p.window.MefiReview.counts("t1", "p1"), null, "nothing is known before anything is read");
  const heard = [];
  const off = p.window.MefiReview.onChange((detail) => heard.push(detail));
  await p.mount(p.host(), "changes");
  assert.deepEqual(clone(p.window.MefiReview.counts("t1", "p1")), { files: 2, additions: 5, deletions: 1, running: false, accepted: false });
  assert.ok(heard.length >= 1);
  assert.deepEqual(clone(heard.at(-1)), { taskId: "t1", projectId: "p1" });
  off();
  const before = heard.length;
  await p.window.MefiReview.refresh("t1");
  await settle();
  assert.equal(heard.length, before, "a listener that left is not told");
  assert.equal(p.window.MefiReview.counts("other", "p1"), null, "a task that was never shown has no count");
  const none = page({ changes: { ok: true, available: true, attempts: [], attempt: null, files: [], totals: { files: 0, additions: 0, deletions: 0, binary: 0 }, state: "none" } });
  await none.mount(none.host(), "changes");
  assert.equal(none.window.MefiReview.counts("t1", "p1"), null, "no attempt yet: no number, not a zero");
  const unavailable = page({ changes: { ok: true, available: false, reason: "not-a-repo", note: "This project is not a Git repository." } });
  await unavailable.mount(unavailable.host(), "changes");
  assert.equal(unavailable.window.MefiReview.counts("t1", "p1"), null, "a folder that is not a repository has none either");
  assert.equal(typeof p.window.MefiReview.onChange("nope"), "function", "a listener that is not a function is ignored");
});

test("a running attempt is read again while its panel is on screen, and no longer once it is taken down or detached", async () => {
  const running = changed({ state: "running", running: true, waiting: true, canAccept: false, canRevert: false, attempts: [{ n: 2, runId: "run_1_2", startedAt: 3, endedAt: null, ended: false, selected: true, reverts: [], accepted: false, running: true }] });
  const p = page({ changes: running });
  const box = p.host();
  const handle = await p.mount(box, "changes");
  assert.equal(p.live().filter((timer) => timer.delay === 6000).length, 1, "a poll is waiting");
  await p.fire(6000);
  assert.equal(p.named("changes").length, 2, "read again");
  handle.unmount();
  assert.equal(p.live().filter((timer) => timer.delay === 6000).length, 0, "taken down: no poll is left");
  assert.equal(box.querySelectorAll(".review").length, 0, "and nothing of it is left on the page");
  const again = p.host();
  await p.mount(again, "changes");
  assert.equal(p.live().filter((timer) => timer.delay === 6000).length, 1);
  again.isConnected = false; // the box left the page
  await p.fire(6000);
  assert.equal(p.named("changes").length, 2, "the poll that was due finds no box on the page and reads nothing; it leaves no other behind");
  assert.equal(p.live().filter((timer) => timer.delay === 6000).length, 0);
  handle.unmount(); // a second unmount is harmless
});

test("the host's pushes reload the panels the task has on screen, and only those", async () => {
  const p = page();
  await p.mount(p.host(), "changes");
  await p.mount(p.host(), "checks");
  assert.equal(p.listeners.length, 1);
  p.listeners[0]({ taskId: "t1", projectId: "p1", what: "checks", attempt: 2 });
  p.listeners[0]({ taskId: "t1", projectId: "p1", what: "shot", attempt: 2 });
  await p.fire(400);
  assert.equal(p.named("checks").length, 2, "the checks panel is on screen: read again");
  assert.equal(p.named("evidence").length, 0, "no Preview panel: the shots are not read for nothing");
  p.listeners[0]({ taskId: "t1", projectId: "p1", what: "accept", attempt: 2 });
  await p.fire(400);
  assert.equal(p.named("changes").length, 2, "an Accept reloads the list");
  p.listeners[0]({ taskId: "someone-else", projectId: "p1", what: "accept" });
  await p.fire(400);
  assert.equal(p.named("changes").length, 2, "another task's push is not ours");
});

test("Accept and Revert work in a panel of their own, through the same two presses and the same Undo", async () => {
  let accepted = false;
  const p = page({ changes: () => changed({ accepted }), accept: (body) => { accepted = body.accepted; return { ok: true, accepted: body.accepted, attempt: 2 }; } });
  const box = p.host();
  await p.mount(box, "changes");
  await buttonNamed(box, "Accept changes").click();
  await settle();
  assert.deepEqual(p.named("accept"), [{ taskId: "t1", projectId: "p1", attempt: 2, accepted: true }]);
  assert.match(text(box), /✓ Accepted/);
  const revert = buttonNamed(box, "Revert attempt");
  await revert.click();
  assert.equal(p.named("revert").length, 0, "one press only asks");
  assert.equal(revert.textContent, "Revert all 2");
  await revert.click();
  await settle();
  assert.deepEqual(p.named("revert"), [{ taskId: "t1", projectId: "p1", attempt: 2, scope: "attempt" }]);
  assert.match(text(box), /Put back 2 files\. The task is reopened\./);
  await buttonNamed(box, "Undo the revert").click();
  await settle();
  assert.deepEqual(p.named("revert").at(-1), { taskId: "t1", projectId: "p1", attempt: 2, undo: "20260930T101010101Z" });
  // One file's diff opens in place and keeps the keyboard where it was.
  await box.querySelectorAll(".review-file-main")[0].click();
  await settle();
  assert.ok(box.querySelector(".review-diff .review-diff-line"));
  assert.equal(p.named("diff").length, 1);
});

test("Run in a Checks panel runs one check and shows its answer", async () => {
  const p = page({ checkrun: { ok: true, attempt: 2, results: [{ id: "typecheck", label: "Typecheck", status: "bad", detail: "4 errors", ms: 800 }, { id: "lint", label: "Lint", status: "warn", detail: "2 warnings", ms: 400 }] } });
  const box = p.host();
  await p.mount(box, "checks");
  assert.match(text(box), /Advisory — never blocks Done/);
  await buttonNamed(box, "Run Typecheck").click();
  await settle();
  assert.deepEqual(p.named("checkrun"), [{ taskId: "t1", projectId: "p1", attempt: 2, id: "typecheck" }]);
  assert.match(text(box), /4 errors/);
});

test("the Evidence tab's own section and a panel of its own can be on screen together, and share what was read", async () => {
  const p = page();
  const fold = p.dom.document.createElement("details");
  const summary = p.dom.document.createElement("summary");
  summary.textContent = "Changes and checks";
  fold.append(summary);
  fold.open = true;
  p.dom.body.append(fold);
  p.window.MefiReview.mount(fold, { taskId: "t1", projectId: "p1" });
  await settle();
  const box = p.host();
  await p.mount(box, "changes");
  assert.equal(p.named("changes").length, 1, "one read for both");
  assert.match(text(fold.querySelector(".review")), /2 files changed/);
  assert.match(text(box), /2 files changed/);
  assert.equal(text(fold.querySelector("summary")), "Changes and checks · 2 files changed");
  assert.equal(fold.querySelectorAll(".review-tabs").length, 1, "the section keeps its tab row");
  assert.equal(box.querySelectorAll(".review-tabs").length, 0);
});

test("a panel is refused for a name it does not know, a host that is not there or a task with no id", async () => {
  const p = page();
  assert.equal(p.window.MefiReview.mount(p.host(), { taskId: "t1", projectId: "p1", panel: "worktree" }), null);
  assert.equal(p.window.MefiReview.mount(null, { taskId: "t1", projectId: "p1", panel: "changes" }), null);
  assert.equal(p.window.MefiReview.mount(p.host(), { projectId: "p1", panel: "changes" }), null);
  await settle();
  assert.equal(p.calls.filter(([name]) => name !== "prefs").length, 0, "nothing was read for any of them");
});

test("a task with a panel on screen is never the one forgotten when the page has shown many tasks", async () => {
  const p = page();
  const keep = p.host();
  await p.mount(keep, "changes", { taskId: "first" });
  for (let index = 0; index < 60; index += 1) await p.mount(p.host(), "checks", { taskId: `task-${index}` });
  p.api.tasksChanges = async () => ({ ok: true, available: true, attempt: 1, attempts: [], files: [], totals: { files: 7, additions: 0, deletions: 0, binary: 0 }, state: "ended", taskId: "first" });
  p.window.MefiReview.refresh("first");
  await settle();
  assert.equal(p.window.MefiReview.state("first", "p1")?.open, false, "the record is still there");
  assert.ok(p.window.MefiReview.state("first", "p1")?.changes, "and still holds what was read");
  assert.equal(p.window.MefiReview.counts("first", "p1")?.files, 7, "and the refresh reached it");
});

test("mounting a panel on a box that already has one replaces it, and a handle that was replaced cannot take the new panel down", async () => {
  const p = page();
  const box = p.host();
  const first = await p.mount(box, "changes");
  const second = await p.mount(box, "changes");
  assert.equal(box.querySelectorAll(".review-bare").length, 1, "one panel in the box, not two");
  first.unmount();
  assert.equal(box.querySelectorAll(".review-bare").length, 1, "the old handle lets go of nothing");
  p.api.tasksChanges = async () => ({ ...changed(), totals: { files: 9, additions: 1, deletions: 1, binary: 0 } });
  p.window.MefiReview.refresh("t1"); await settle();
  assert.match(text(box.querySelector(".review-panel")), /9 files changed/, "and the panel is still kept up to date");
  second.unmount();
  assert.equal(box.querySelectorAll(".review-bare").length, 0);
});

test("one listener that throws does not stop the next from being told", async () => {
  const p = page();
  const heard = [];
  p.window.MefiReview.onChange(() => { throw new Error("a bad listener"); });
  p.window.MefiReview.onChange((detail) => heard.push(detail));
  await p.mount(p.host(), "changes");
  assert.ok(heard.length >= 1, "the second is told though the first fell over");
});

test("counts() falls back to the length of the file list when the host sent no totals", async () => {
  const listed = changed({ files: [file("a.js"), file("b.js"), file("c.js")] });
  delete listed.totals;
  const p = page({ changes: listed });
  await p.mount(p.host(), "changes");
  assert.deepEqual(clone(p.window.MefiReview.counts("t1", "p1")), { files: 3, additions: 0, deletions: 0, running: false, accepted: false });
});

test("a panel drawn before the settings were read shows the switches once they have arrived", async () => {
  const p = page();
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  p.api.reviewPrefs = async () => { await gate; return clone(prefs()); };
  const box = p.host();
  await p.mount(box, "changes");
  assert.match(text(box.querySelector(".review-settings")), /Reading the settings…/);
  assert.equal(box.querySelectorAll(".review-switch").length, 0);
  open(); await settle();
  assert.ok(box.querySelectorAll(".review-switch").length >= 3, "the panel that is on its own is drawn again, not only the section with a fold");
});
