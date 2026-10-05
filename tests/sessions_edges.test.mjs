// The session panels' signals, errors and edges (renderer/sessions.js): what the host and the page say to them (pushes, a clock tick,
// appearance, permission and layout changes, a project opened without a word), how they answer a host that refuses or fails, the keys
// that need real focus (a menu, the list's own focus across a redraw, the lightbox's trap), and the smaller readings (how long a
// question has waited, a verdict, an ask that failed). The same real builder.js and the same stand-ins as the other three suites
// (tests/fixtures/sessions-env.mjs); every test here was written for code that none of them ran.
import test from "node:test";
import assert from "node:assert/strict";

import { sessionsApp, task, bridge, at, mins, clean, NOW, PICTURE, DATA_URL } from "./fixtures/sessions-env.mjs";

const board = () => [
  task("asking", { status: "active", runId: "r1", updatedAt: mins(4) }),
  task("working", { status: "active", runId: "r2", updatedAt: mins(1) }),
  task("queued", { updatedAt: at(2) }),
  task("finished", { status: "done", doneAt: at(2), updatedAt: at(2), verification: { state: "verified" } }),
];
const jobs = () => [{ taskId: "asking", runId: "r1", currentStep: "Waiting for your answer", route: "OpenCode" }, { taskId: "working", runId: "r2", currentStep: "Writing", route: "Claude Code", progress: 0.6 }];
const question = (extra = {}) => ({ id: "q1", status: "open", title: "Reuse it?", at: mins(4), context: { taskId: "asking" }, options: [{ id: "y", label: "Yes", recommended: true }, { id: "n", label: "No" }], ...extra });
const stages = { working: "running", asking: "running" };
const open = (extra = {}) => sessionsApp({ tasks: board(), running: jobs(), questions: [question()], stages, ...extra });
const meta = (a, id) => a.row(id).querySelector(".sx-row-meta").textContent;

// ---- what the host and the page say ------------------------------------------------------------------------------------------------

test("the host's pushes (tasks, the conversation, the run status, the projects) draw what moved, each is listened to once, and they do nothing once the panels are away", async () => {
  const a = await open();
  await a.settle();
  const pushes = a.api.state.pushes;
  assert.deepEqual(Object.values(pushes).map((list) => list.length), [1, 1, 1, 1, 1], "each is registered once");
  a.data.tasks = [...a.data.tasks, task("fresh", { updatedAt: mins(0) })];
  pushes.tasks[0](); await a.settle();
  assert.ok(a.rowKeys().includes("fresh"), "a pushed board is drawn");
  a.data.assistant.questions = [question({ id: "q2", context: { taskId: "queued" } })];
  pushes.assistant[0](); await a.settle();
  assert.equal(a.row("queued").dataset.tone, "ask", "a question that arrived puts its task in Needs you");
  a.data.assistant.questions = [];
  a.data.tasks = a.data.tasks.map((row) => (row.id === "queued" ? { ...row, status: "active", runId: "r9" } : row));
  a.data.status.running = [...a.data.status.running, { taskId: "queued", runId: "r9", currentStep: "Starting", route: "OpenCode" }];
  pushes.status[0](); await a.settle();
  assert.equal(a.row("queued").dataset.tone, "run", "a run that started is shown running");
  a.data.project = { ...a.data.project, name: "Renamed" };
  pushes.projects[0](); await a.settle();
  assert.equal(a.text("list", ".sx-proj-words b"), "Renamed");
  a.S.detach();
  const queued = a.env.frames.length + a.env.timeouts.length;
  for (const list of Object.values(pushes)) list[0]();
  assert.equal(a.env.frames.length + a.env.timeouts.length, queued, "nothing is queued for panels that are away");
});

test("Search lists New task with its key while the panels are there; it runs the list's own New task", async () => {
  const a = await open();
  await a.settle();
  const rows = a.calls.registered.filter((row) => row.id === "sessions-new-task");
  assert.equal(rows.length, 1, "registered once, when the panels attach");
  const [row] = rows;
  assert.deepEqual([row.kind, row.label, row.chord, row.paletteGroup, row.paletteBrowse, row.glyph, row.keyMatch()], ["action", "New task", "Ctrl N", "Actions", 1, "g-add", false]);
  assert.deepEqual({ ...row.showIn }, { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false });
  assert.equal(row.hidden(), false);
  a.S.select("queued");
  await a.settle();
  row.run();
  assert.equal(a.S.selected(), null, "the session is put away");
  assert.equal(a.calls.compose, 1, "and Home's box takes the new task, as the list's button does");
  a.S.detach();
  assert.equal(row.hidden(), true, "gone with the panels");
});

test("a minute's tick draws the words that count time again, and a window nobody can see waits for its turn", async () => {
  const a = await open();
  await a.settle();
  assert.equal(meta(a, "asking"), "Asking a question · waiting 4m");
  assert.equal(a.env.intervals.length, 1); assert.equal(a.env.intervals[0].delay, 60000, "once a minute");
  a.tick(60000);
  a.document.hidden = true; a.env.intervals[0].callback(); await a.settle();
  assert.equal(meta(a, "asking"), "Asking a question · waiting 4m", "a hidden window is not drawn for a tick");
  a.document.hidden = false; a.env.intervals[0].callback(); await a.settle();
  assert.equal(meta(a, "asking"), "Asking a question · waiting 5m");
});

test("how long a question has waited is said in the unit a row has room for: seconds, minutes, hours, days", async () => {
  for (const [waited, words] of [[30 * 1000, "30s"], [2 * 1000, "2s"], [3 * 60 * 1000, "3m"], [5 * 3600 * 1000, "5h"], [3 * 86400 * 1000, "3d"]]) {
    const a = await open({ questions: [question({ at: NOW - waited })] });
    await a.settle();
    assert.equal(meta(a, "asking"), `Asking a question · waiting ${words}`, `after ${waited} ms`);
  }
});

test("a project the workspace opened without announcing it (the first one at launch) is taken up with its own tasks and what it remembered", async () => {
  const storage = new Map([["mefiStudio.sessions.v1", JSON.stringify({ p: { p2: { open: "b", tab: "backlog" } } })]]);
  const a = await open({ storage });
  await a.settle();
  assert.equal(a.S.selected(), null);
  a.data.projectId = "p2"; a.data.project = { id: "p2", name: "Second", path: "/work/second" };
  a.data.tasks = [task("a", { projectId: "p2" }), task("b", { projectId: "p2" })]; a.data.ideas = [{ id: "i1", title: "An idea", at: at(1), status: "open" }];
  a.env.emit("mefi:workspace-state"); await a.settle();
  assert.equal(a.text("list", ".sx-proj-words b"), "Second", "no project-changed was sent: the next push is enough");
  assert.equal(a.S.selected(), "b", "what that project remembered is open");
  assert.equal(a.one("list", "#sessions-tab-backlog").getAttribute("aria-selected"), "true", "and the list it was on");
  assert.deepEqual(a.rowKeys(), ["idea:i1"]);
});

test("Needs you follows the Inbox: when the Inbox moves (a decision taken in it, a digest that arrived) the list's groups follow, with no push of their own", async () => {
  const a = await open();
  await a.settle();
  const needs = () => a.all("list", ".sx-gh").find((node) => node.dataset.key === "group:needs")?.querySelector(".sx-count").textContent ?? "0";
  assert.equal(needs(), "1", "the open question, as the reading says without an Inbox");
  const held = new Set(["asking", "queued"]);
  a.window.MefiToday = { isOn: () => true, needTasks: () => held };
  a.env.emit("mefi:inbox"); await a.settle();
  assert.equal(needs(), "2", "the Inbox holds the queued one for a decision too: it is Needs you");
  held.delete("queued");
  a.env.emit("mefi:inbox"); await a.settle();
  assert.equal(needs(), "1", "decided in the Inbox: it leaves Needs you at once");
});

test("the page's appearance, permission and layout signals draw what they change: the companion's name, what Mefi decided, a short window", async () => {
  const decisions = [];
  const messages = [{ id: "n1", role: "assistant", kind: "notice", text: "A notice for you", at: mins(3), projectId: "p1", taskId: "queued" }];
  const a = await open({ decisions, messages });
  await a.settle();
  a.S.select("queued", { route: false }); await a.settle(4);
  const names = () => a.all("main", ".sx-item.is-notice .sx-who b").map((node) => node.textContent);
  assert.deepEqual(names(), ["Mefi"]);
  a.storage.set("mefiStudio.workspace.companion", "Ari");
  a.env.emit("mefi:appearance"); await a.settle(3);
  assert.deepEqual(names(), ["Ari"], "the companion's name is read again when the appearance changes");
  assert.equal(a.all("main", ".sx-decided").length, 0);
  decisions.push({ id: "d1", taskId: "queued", at: mins(2), title: "Reuse the parser", reason: "It already exists", pending: false, failed: false, undoable: true });
  a.env.emit("mefi:autonomy-changed"); await a.settle(3);
  assert.equal(a.all("main", ".sx-decided").length, 1, "a decision the permission mode made shows as soon as it is recorded");
  for (const event of ["mefi:layout", "mefi:shell-layout"]) {
    a.window.innerHeight = 1080; a.env.emit(event); await a.settle();
    assert.equal(a.thread().dataset.short, "false");
    a.window.innerHeight = 420; a.env.emit(event); await a.settle();
    assert.equal(a.thread().dataset.short, "true", `${event}: a window that got short is told`);
  }
});

// ---- the list's keys and menu, with real focus -------------------------------------------------------------------------------------

const key = async (a, node, name, extra = {}) => { await node.trigger("keydown", { key: name, ...extra }); await a.settle(); };
const main = (a, id) => a.row(id).querySelector('[data-part="main"]');
const items = (a) => a.all("list", ".sx-menu [role=menuitem]");

test("Down from the filter box goes to the first thing in the list", async () => {
  const a = await open();
  await a.settle();
  await a.one("list", "#sessions-find").trigger("keydown", { key: "ArrowDown" });
  assert.equal(a.all("list", "[data-nav]")[0].focused, true, "the first heading takes the focus");
  assert.equal(a.all("list", "[data-nav]")[0].dataset.key, "group:needs");
});

test("a redraw of the list puts the focus back on the same row's button", async () => {
  const a = await open({ focus: true });
  await a.settle();
  const before = main(a, "working");
  before.focus();
  assert.equal(a.document.activeElement, before);
  a.data.status.running = a.data.status.running.map((job) => (job.taskId === "working" ? { ...job, currentStep: "Testing" } : job));
  a.env.emit("mefi:workspace-state"); await a.settle();
  assert.match(meta(a, "working"), /Testing/, "the row was drawn again");
  const after = main(a, "working");
  assert.notEqual(after, before, "as a new button");
  assert.equal(a.document.activeElement, after, "and the focus did not leave the row");
});

test("a row's menu is a menu for the keyboard: the menu key opens it on its first item, arrows, Home and End move through it, Escape and Tab close it and give the row's menu button the focus back", async () => {
  const a = await open({ focus: true });
  await a.settle();
  await key(a, main(a, "queued"), "ContextMenu");
  const n = items(a).length;
  assert.ok(n >= 4, "open in a tab, pin, rename, delete at least");
  assert.equal(a.document.activeElement, items(a)[0], "it opens on its first item");
  await key(a, items(a)[0], "ArrowDown"); assert.equal(a.document.activeElement, items(a)[1]);
  await key(a, items(a)[1], "ArrowUp"); assert.equal(a.document.activeElement, items(a)[0]);
  await key(a, items(a)[0], "ArrowUp"); assert.equal(a.document.activeElement, items(a)[n - 1], "Up from the first wraps to the last");
  await key(a, items(a)[n - 1], "ArrowDown"); assert.equal(a.document.activeElement, items(a)[0], "and Down from the last to the first");
  await key(a, items(a)[0], "End"); assert.equal(a.document.activeElement, items(a)[n - 1]);
  await key(a, items(a)[n - 1], "Home"); assert.equal(a.document.activeElement, items(a)[0]);
  await key(a, items(a)[0], "Escape");
  assert.equal(a.one("list", ".sx-menu"), null, "Escape closes it");
  assert.equal(a.document.activeElement, a.row("queued").querySelector('[data-part="menu"]'), "and the row's menu button has the focus");
  await key(a, main(a, "queued"), "ContextMenu");
  await key(a, items(a)[2], "Tab");
  assert.equal(a.one("list", ".sx-menu"), null, "Tab closes it too, it does not wander off behind it");
  assert.equal(a.document.activeElement, a.row("queued").querySelector('[data-part="menu"]'));
});

// ---- deleting, when the host does not cooperate ------------------------------------------------------------------------------------

test("a delete the host fails says why and keeps the row; one the trash did not keep has no Undo; an Undo that fails says so, and one that warns says what", async () => {
  const a = await open();
  await a.settle();
  a.api.tasksDelete = async () => { throw new Error("The disk is full."); };
  await key(a, main(a, "queued"), "Delete");
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /Task not deleted · .*disk is full/);
  assert.ok(a.row("queued"), "the row stays");
  a.api.tasksDelete = async () => ({ ok: true, trashed: [] });
  await key(a, main(a, "queued"), "Delete");
  assert.equal(a.calls.toasts.at(-1).message, "Task deleted · Task queued"); assert.equal(a.calls.toasts.at(-1).options, undefined, "nothing to put back from, so no Undo is offered");
  a.api.tasksDelete = async (payload) => ({ ok: true, trashed: [{ kind: "task", id: payload.taskId }] });
  await key(a, main(a, "queued"), "Delete");
  const undo = a.calls.toasts.at(-1).options.action;
  assert.equal(undo.label, "Undo");
  a.api.state.fail.tasksUndelete = "It is gone.";
  await undo.run(); await a.settle();
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.equal(a.calls.toasts.at(-1).message, "Not put back · It is gone.");
  a.api.state.fail.tasksUndelete = null; a.api.tasksUndelete = async () => { throw new Error("The store is busy."); };
  await undo.run(); await a.settle();
  assert.match(a.calls.toasts.at(-1).message, /Not put back · The store is busy\./, "a call that throws is told the same way");
  a.api.tasksUndelete = async () => ({ ok: true, warning: "Its branch was gone" });
  await undo.run(); await a.settle();
  assert.equal(a.calls.toasts.at(-1).kind, "warn"); assert.equal(a.calls.toasts.at(-1).message, "Put back “Task queued” · Its branch was gone");
  delete a.api.tasksUndelete;
  await key(a, main(a, "queued"), "Delete");
  assert.equal(a.calls.toasts.at(-1).message, "Task deleted · Task queued", "a host that cannot put a task back does not promise to");
});

// ---- opening ---------------------------------------------------------------------------------------------------------------------

test("New task without Home's own box goes to Home itself", async () => {
  const a = await open();
  await a.settle();
  delete a.window.MefiWorkspace.composeTask;
  await a.one("list", "#sessions-new").click();
  assert.deepEqual(clean(a.calls.go.at(-1)), ["workspace"]);
});

test("a route that names an inspector tab for the session that is already open switches to it, is remembered, and a name that is no tab is ignored", async () => {
  const storage = new Map();
  const a = await open({ storage });
  await a.settle();
  a.S.select("working", { route: false }); await a.settle(4);
  assert.equal(a.S.tab("working"), "plan");
  a.navigate("workspace", { view: "task", taskId: "working", projectId: "p1", tab: "checks" }); await a.settle(4);
  assert.equal(a.S.tab("working"), "checks", "the same session asked for again with a tab");
  assert.equal(a.one("inspector", "#sessions-itab-checks").getAttribute("aria-selected"), "true");
  assert.equal(JSON.parse(storage.get("mefiStudio.sessions.v1")).p.p1.itab.working, "checks", "and the choice is kept");
  a.navigate("workspace", { view: "task", taskId: "working", projectId: "p1", tab: "bogus" }); await a.settle(4);
  assert.equal(a.S.tab("working"), "checks", "a name that is no tab changes nothing");
});

// ---- the thread: smaller readings --------------------------------------------------------------------------------------------------

const attempt = (extra = {}) => ({ runId: "run_1", startedAt: mins(40), via: "Claude Code", fallbacks: [], finishedAt: mins(14), ok: true, stopped: false, stoppedAtLimit: false, limitMinutes: 25, seconds: 1560, result: "Added the button.", tail: ["$ npm test", "ok"], release: null, outcome: "finished-ok", ...extra });
const picture = (n, extra = {}) => ({ ok: true, id: PICTURE(n), name: `pic${n}.png`, mime: "image/png", bytes: 100, width: 640, height: 400, dataUrl: DATA_URL(`pic${n}`), ...extra });
const shot = (phase, n) => ({ phase, dataUrl: `data:image/png;base64,${Buffer.from(`${phase}${n}`).toString("base64")}`, width: 1280, height: 800 });
const thread = async (id, options = {}) => {
  const a = await sessionsApp(options);
  await a.settle();
  a.S.select(id, { route: false });
  await a.settle(4);
  return a;
};
const feed = (a) => a.all("main", ".sx-feed .sx-item");
const box = (a) => ({ input: a.one("main", "#sessions-input"), form: a.one("main", "#sessions-compose"), send: a.one("main", "#sessions-send") });
const type = async (a, words) => { const { input } = box(a); input.value = words; await input.trigger("input"); };

test("what the checks said is a line in the thread: Verified, Not accepted or Checked, in the tone it deserves", async () => {
  for (const [state, title, outcome] of [["verified", "Verified", "good"], ["failed", "Not accepted", "bad"], ["manual", "Checked", ""]]) {
    const a = await thread("t1", { tasks: [task("t1", { status: "done", doneAt: mins(9), verification: { state, at: mins(10), reason: "Because of the tests." } })] });
    const line = feed(a).find((node) => node.classList.contains("is-verdict"));
    assert.ok(line, `${state}: a verdict line`);
    assert.equal(line.querySelector(".sx-line b").textContent, title);
    assert.equal(line.dataset.outcome, outcome);
    assert.match(line.textContent, /Because of the tests\./);
  }
});

test("an Ask the host could not take shows why under the question; one the conversation already holds is one line, not two", async () => {
  const failing = await thread("t1", { tasks: [task("t1")], api: bridge({ fail: { assistantMessage: "Mefi is offline." } }) });
  await failing.one("main", "#sessions-intent-ask").click();
  await type(failing, "Is it done?"); await box(failing).form.trigger("submit"); await failing.settle(4);
  const asked = feed(failing).filter((node) => node.classList.contains("is-ask"));
  assert.equal(asked.length, 1);
  assert.ok(asked[0].querySelector(".sx-note.bad"), "the reason sits under the question");
  assert.match(asked[0].querySelector(".sx-note.bad").textContent, /Mefi is offline\./);
  assert.equal(box(failing).input.value, "Is it done?", "and the words are still in the box");
  // The conversation has the question (the host adds it at once) while the answer is still out: the same ask, once.
  const a = await thread("t1", { tasks: [task("t1")] });
  a.api.assistantMessage = () => new Promise(() => {});
  await a.one("main", "#sessions-intent-ask").click();
  await type(a, "Is it done yet?"); await box(a).form.trigger("submit"); await a.settle(4);
  a.data.assistant.messages = [{ id: "m1", role: "user", text: 'About the task "Task t1" (t1): Is it done yet?', at: NOW + 1000, projectId: "p1" }];
  a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(feed(a).filter((node) => node.classList.contains("is-ask")).length, 1, "merged with the one this box sent");
  assert.match(feed(a).at(-1).textContent, /Mefi is thinking…/);
  a.data.assistant.messages.push({ id: "m2", role: "assistant", text: "Nearly.", at: NOW + 2000, projectId: "p1" });
  a.env.emit("mefi:workspace-state"); await a.settle(3);
  const done = feed(a).filter((node) => node.classList.contains("is-ask"));
  assert.equal(done.length, 1); assert.match(done[0].textContent, /Nearly\./); assert.doesNotMatch(done[0].textContent, /thinking/, "an answer that came in ends the wait");
});

test("a finished run's shots show at the end of the thread even when its run history could not be read, and the history's own error is said", async () => {
  const a = await thread("t1", { tasks: [task("t1", { status: "awaiting_verification", lastAttempt: { at: mins(14), runId: "run_1" } })], stages: { t1: "review" }, api: bridge({ fail: { tasksAttempts: "The history is unavailable." }, evidence: { t1: { ok: true, shots: [shot("before", 1), shot("after", 1)] } } }) });
  const items = feed(a);
  assert.ok(items.at(-1).classList.contains("is-media"), "the before and after card closes the feed");
  assert.equal(items.filter((node) => node.classList.contains("is-run")).length, 0);
  assert.match(a.all("main", ".sx-feed .sx-note").map((node) => node.textContent).join("|"), /The history is unavailable\./, "and the thread says why there are no runs");
});

test("Request a change on a finished task turns the box to a Change and puts the cursor in it", async () => {
  const a = await thread("t1", { tasks: [task("t1", { status: "done", doneAt: at(1), verification: { state: "verified" } })] });
  await a.one("main", "#sessions-intent-note").click(); await a.settle(3);
  assert.equal(box(a).form.dataset.intent, "note");
  box(a).input.focused = false;
  await a.one("main", '#sessions-head [data-spec="change"]').click(); await a.settle(3);
  assert.equal(box(a).form.dataset.intent, "change");
  assert.equal(box(a).input.focused, true, "ready to write");
});

test("where the page has no two-press helper, a button that needs a second press asks through the styled confirm instead", async () => {
  const a = await thread("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r" }] });
  a.window.MefiUi.arm = undefined;
  a.S.refresh(); await a.settle(3);
  const stop = a.one("main", '#sessions-head [data-spec="stop"]');
  a.window.__confirmWith = false;
  await stop.click(); await a.settle(3);
  assert.deepEqual(clean(a.calls.confirms.map(([message]) => message)), ["Stop?"], "it asks");
  assert.equal(a.api.of("tasksAction").length, 0, "a no stops nothing");
  a.window.__confirmWith = true;
  await stop.click(); await a.settle(4);
  assert.deepEqual(clean(a.api.of("tasksAction")), [["tasksAction", { taskId: "t1", projectId: "p1", action: "stop" }]], "a yes is the same call the two presses make");
});

test("the chips tell a folder that is not on a branch: detached, no commits yet, the Worktree switch held by the environment, and the workers it can offer when none is installed", async () => {
  const api = bridge({ where: { ok: true, projectId: "p1", repo: true, branch: "", head: "abc1234", dirty: 0, worktrees: { on: true, forced: true } } });
  api.cliStatus = async () => [];
  const a = await thread("t1", { tasks: [task("t1")], api });
  await a.settle(4);
  const branch = a.one("main", "#sessions-branch"), toggle = a.all("main", "#sessions-chips button")[0];
  assert.equal(branch.textContent, "detached abc1234", "the run menu's Folder names the commit");
  assert.match(branch.title, /No branch checked out · nothing uncommitted/);
  assert.equal(toggle.disabled, true, "the environment decides");
  assert.match(toggle.title, /MEFI_STUDIO_WORKTREE_RUNS=1/); assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.deepEqual(a.all("main", "#sessions-worker-cli option").map((option) => option.value), ["opencode", "claude", "codex", "grok", "antigravity"], "without a list of what is installed, the known workers");
  const fresh = await thread("t1", { tasks: [task("t1")], api: bridge({ where: { ok: true, projectId: "p1", repo: true, branch: "", head: "", dirty: 1, worktrees: { on: false, forced: false } } }) });
  await fresh.settle(4);
  assert.equal(fresh.one("main", "#sessions-branch").textContent, "no commits yet+1");
  assert.match(fresh.one("main", "#sessions-branch").title, /1 uncommitted path\./);
});

test("a brief that names a picture by its id alone shows it, and a picture the host cannot read says so", async () => {
  const pic = PICTURE(7);
  const a = await thread("t1", { tasks: [task("t1", { prompt: `See ${pic} please` })], api: bridge({ pictures: { [pic]: picture(7, { id: pic }) } }) });
  const thumb = feed(a)[0].querySelector(".sx-thumb");
  assert.ok(thumb.querySelector("img"), "the picture is on the page");
  assert.equal(thumb.querySelector("img").getAttribute("alt"), "picture");
  assert.match(thumb.textContent, /picture · 640 × 400/);
  const api = bridge(); api.assistantImageRead = async () => { throw new Error("the store is locked"); };
  const b = await thread("t1", { tasks: [task("t1", { prompt: `See ${pic} please` })], api });
  assert.match(feed(b)[0].querySelector(".sx-thumb").textContent, /picture · The picture could not be read\./);
});

test("the lightbox keeps the Tab key inside it: from the last control to the first and back", async () => {
  const a = await thread("t1", { tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" }, focus: true, api: bridge({ attempts: { t1: [attempt()] }, evidence: { t1: { ok: true, shots: [shot("before", 1), shot("after", 1)] } } }) });
  await a.one("main", ".sx-media .sx-link").click();
  const layer = a.document.body.querySelector("#sessions-lightbox");
  const controls = layer.querySelectorAll("button");
  assert.equal(controls.length, 3, "Before, After and Close");
  assert.equal(a.document.activeElement, controls[2], "it opens on Close");
  const tab = async (shiftKey = false) => { for (const listener of [...a.document.body.listeners.keydown]) await listener({ key: "Tab", shiftKey, preventDefault() {}, stopPropagation() {} }); };
  await tab(); assert.equal(a.document.activeElement, controls[0], "Tab from the last control goes to the first");
  await tab(); assert.equal(a.document.activeElement, controls[1]);
  await tab(true); assert.equal(a.document.activeElement, controls[0]);
  await tab(true); assert.equal(a.document.activeElement, controls[2], "Shift+Tab from the first goes to the last");
});

test("the host's word that a shot was taken or a review moved forgets what was read for that task: its shots and its usage are read again", async () => {
  const a = await thread("t1", { tasks: [task("t1", { status: "awaiting_verification" }), task("t2")], stages: { t1: "review" }, api: bridge({ metrics: { ok: true, attempt: null, task: null, cap: null }, attempts: { t1: [attempt()] }, evidence: { t1: { ok: true, shots: [shot("before", 1), shot("after", 1)] } } }) });
  a.S.setTab("agent"); await a.settle(4);
  const reads = () => [a.api.of("tasksEvidence").length, a.api.of("taskMetrics").length];
  assert.deepEqual(reads(), [1, 1]);
  const review = a.api.state.pushes.review[0];
  review({ taskId: "t2" }); await a.settle(3);
  review({}); review(null); await a.settle(3);
  assert.deepEqual(reads(), [1, 1], "another task's shots, or no task, change nothing here");
  a.tick(5000);
  review({ taskId: "t1" }); await a.settle(4);
  assert.deepEqual(reads(), [2, 2], "this task's are read again");
  a.S.detach();
  review({ taskId: "t1" }); await a.settle(3);
  assert.deepEqual(reads(), [2, 2], "and with the panels away nothing is asked");
});

// ---- the inspector: smaller readings -----------------------------------------------------------------------------------------------

const pane = (a, name) => a.one("inspector", `#sessions-pane-${name}`);
const cards = (a, name) => pane(a, name).querySelectorAll(".sx-icard");
const card = (a, name, title) => cards(a, name).find((node) => node.querySelector("h4").ownText === title);
const report = (more = {}) => ({ ok: true, attempt: null, task: null, cap: null, ...more });

test("Plan lists an outline part that has several lines, says so when a task has no brief text, and names the change a blocker is in the way of", async () => {
  const a = await thread("t1", { tasks: [task("t1", { prompt: "Goal:\nFirst thing\nSecond thing\n\nKeep unchanged:\nThe toolbar." })] });
  const brief = card(a, "plan", "Brief");
  assert.deepEqual(brief.querySelectorAll(".sx-list-plain li").map((node) => node.textContent), ["First thing", "Second thing"], "two lines under Goal are a list");
  assert.equal(brief.querySelectorAll("p.sx-text").filter((node) => node.textContent === "The toolbar.").length, 1, "one line is a sentence");
  const empty = await thread("t1", { tasks: [task("t1", { prompt: "", title: "" })] });
  assert.equal(card(empty, "plan", "Brief").querySelector(".sx-text").textContent, "This task has no brief text.");
});

test("the earlier briefs that could not be read say so in the host's words or in ours, and a Restore the host refuses says why and can be tried again", async () => {
  const refused = await thread("t1", { tasks: [task("t1")], api: bridge({ history: { ok: false, error: "The versions are locked." } }) });
  assert.match(card(refused, "plan", "Versions").textContent, /The versions are locked\./);
  const silent = await thread("t1", { tasks: [task("t1")], api: bridge({ history: { ok: false } }) });
  assert.match(card(silent, "plan", "Versions").textContent, /Earlier briefs could not be read\./);
  const entries = [{ id: "rev_1", kind: "Saved brief", at: at(1), snapshot: { prompt: "An older brief" } }, { id: "rev_2", kind: "Saved brief", at: at(2), snapshot: { prompt: "An even older brief" } }];
  const a = await thread("t1", { tasks: [task("t1")], api: bridge({ history: { ok: true, entries, hasMore: false } }) });
  a.api.tasksRestore = async (payload) => { a.api.calls.push(["tasksRestore", payload]); return { ok: false, error: "The task changed under you." }; };
  const restore = () => card(a, "plan", "Versions").querySelectorAll(".sx-version button");
  await restore()[0].click(); await a.settle(4);
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.match(a.calls.toasts.at(-1).message, /task changed under you/);
  assert.equal(restore()[0].disabled, false, "it can be tried again");
  a.api.tasksRestore = async (payload) => { a.api.calls.push(["tasksRestore", payload]); return { ok: false }; };
  await restore()[1].click(); await a.settle(4);
  assert.match(a.calls.toasts.at(-1).message, /The earlier brief could not be restored\./, "a refusal with no words gets ours");
  assert.equal(a.api.of("tasksRestore").length, 2);
});

test("Agent: an attempt that is running is timed from now, one that hit the limit says so, and a whole task with numbers shows them", async () => {
  const live = await thread("t1", { tasks: [task("t1", { status: "active", runId: "r" })], running: [{ taskId: "t1", runId: "r", route: "Claude Code", startedAt: mins(3) }], api: bridge({ metrics: report({ attempt: { live: true, startedAt: mins(3), seconds: null, route: { label: "Claude Code" }, tokens: { state: "reported", input: 12500, output: 800 }, cost: { state: "reported", usd: 0.4321 } }, task: { attempts: 1, seconds: 180, tokens: { state: "reported", input: 12500, output: 800 }, cost: { state: "reported", usd: 0.4321 } } }) }) });
  live.S.setTab("agent"); await live.settle(4);
  const now = card(live, "agent", "This attempt");
  assert.equal(now.querySelector("h4 .r").textContent, "Running now");
  assert.match(now.textContent, /Time\s*3 min/, "from the moment it started, not from a stored number");
  assert.match(now.textContent, /Tokens\s*12\.5k in · 800 out/); assert.match(now.textContent, /Cost\s*\$0\.43/);
  assert.doesNotMatch(now.textContent, /does not report/, "a builder that reports needs no apology");
  const whole = card(live, "agent", "Whole task");
  assert.match(whole.textContent, /Tokens\s*12\.5k in · 800 out/); assert.match(whole.textContent, /Cost\s*\$0\.43/);
  const capped = await thread("t1", { tasks: [task("t1")], api: bridge({ metrics: report({ attempt: { live: false, startedAt: mins(40), seconds: 1500, stoppedAtLimit: true, route: { label: "OpenCode" }, tokens: { state: "not-reported" }, cost: { state: "not-reported" } } }) }) });
  capped.S.setTab("agent"); await capped.settle(4);
  assert.equal(card(capped, "agent", "This attempt").querySelector("h4 .r").textContent, "Stopped at the time limit");
});

test("Agent says what a task that is not running is doing, from where it stands", async () => {
  const doing = async (options, id = "t1") => { const a = await thread(id, options); a.S.setTab("agent"); await a.settle(4); return card(a, "agent", "Worker").textContent; };
  assert.match(await doing({ tasks: [task("t1", { status: "done", doneAt: at(1) })] }), /Doing\s*Finished/);
  assert.match(await doing({ tasks: [task("asking")], questions: [question()] }, "asking"), /Doing\s*Waiting for your answer/);
  assert.match(await doing({ tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" } }), /Doing\s*Checking the result/);
  assert.match(await doing({ tasks: [task("t1")] }), /Worker\s*No worker yet/);
});

test("a Preview action the workspace fails on frees the controls again, and a cap the host refuses without words gets ours", async () => {
  const a = await thread("t1", { tasks: [task("t1")], preview: { phase: "stopped", available: true, canStop: true }, api: bridge({ metrics: report({ cap: { enabled: true, minutes: 25, effectiveMinutes: 25, min: 5, step: 5, ceilingMinutes: 60, raised: false } }) }) });
  a.S.setTab("preview"); await a.settle(4);
  a.window.MefiWorkspace.previewAction = () => Promise.reject(new Error("no window"));
  const buttons = () => pane(a, "preview").querySelector(".sx-own").querySelectorAll("button");
  await buttons()[0].click(); await a.settle(4);
  assert.ok(buttons().some((node) => !node.disabled), "the controls come back");
  a.S.setTab("agent"); await a.settle(4);
  a.api.tasksCap = async () => ({ ok: false });
  await card(a, "agent", "Limit").querySelectorAll(".sx-stepper button")[1].click(); await a.settle(3);
  assert.equal(a.calls.toasts.at(-1).kind, "bad"); assert.equal(a.calls.toasts.at(-1).message, "The limit could not be saved.");
});

// ---- the page around them ----------------------------------------------------------------------------------------------------------

test("a change of the page's class or sheet redraws the panels, and putting them away stops watching", async () => {
  const a = await open({ load: false });
  const watchers = [];
  a.env.context.MutationObserver = class { constructor(callback) { this.callback = callback; this.disconnected = false; watchers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() { this.disconnected = true; } };
  await a.env.load("sessions.js"); await a.settle();
  assert.equal(watchers.length, 1);
  assert.equal(watchers[0].target, a.document.body);
  assert.deepEqual(clean(watchers[0].options), { attributes: true, attributeFilter: ["class", "data-sheet"] });
  const queued = a.env.frames.length + a.env.timeouts.length;
  watchers[0].callback([]);
  assert.ok(a.env.frames.length + a.env.timeouts.length > queued, "a paint is asked for");
  a.window.MefiSessions.detach();
  assert.equal(watchers[0].disconnected, true);
});

test("a page whose router cannot say where it is decides by whether Home says it is showing", async () => {
  const a = await open();
  await a.settle();
  a.S.select("working", { route: false }); await a.settle(4);
  assert.equal(a.thread().hidden, false);
  a.window.MefiNav.current = () => undefined;
  a.window.MefiWorkspace.isActive = () => false; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(a.thread().hidden, true, "Home is not showing, so neither is the thread");
  a.window.MefiWorkspace.isActive = () => true; a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(a.thread().hidden, false);
});

test("a project change that names no project is read from the workspace", async () => {
  const a = await open();
  await a.settle();
  a.data.projectId = "p3"; a.data.project = { id: "p3", name: "Third", path: "/work/third" }; a.data.tasks = [task("only", { projectId: "p3" })];
  a.env.emit("mefi:project-changed", undefined); await a.settle();
  assert.deepEqual(a.rowKeys(), ["only"]); assert.equal(a.text("list", ".sx-proj-words b"), "Third");
});

test("a menu button pressed twice opens and closes its menu and keeps the focus on the button; a menu for a task that has left the board goes away", async () => {
  const a = await open({ focus: true });
  await a.settle();
  const button = () => a.row("queued").querySelector('[data-part="menu"]');
  await button().click(); await a.settle();
  assert.ok(a.one("list", ".sx-menu"));
  await button().click(); await a.settle();
  assert.equal(a.one("list", ".sx-menu"), null, "the same button closes it");
  assert.equal(a.document.activeElement, button(), "and keeps the focus");
  await button().click(); await a.settle();
  assert.ok(a.one("list", ".sx-menu"));
  a.data.tasks = a.data.tasks.filter((row) => row.id !== "queued");
  a.env.emit("mefi:workspace-state"); await a.settle(3);
  assert.equal(a.one("list", ".sx-menu"), null, "its task is gone, and so is its menu");
  assert.equal(a.row("queued"), null);
});

test("without a tab strip a row's menu says Open and opens the session in place", async () => {
  const a = await open({ tabs: false });
  await a.settle();
  await a.row("queued").querySelector('[data-part="menu"]').click(); await a.settle();
  const first = a.all("list", ".sx-menu .sx-menu-item")[0];
  assert.equal(first.textContent.trim(), "Open");
  await first.click(); await a.settle(3);
  assert.equal(a.S.selected(), "queued");
  assert.deepEqual(clean(a.calls.go.at(-1)), ["workspace", { view: "task", taskId: "queued", projectId: "p1" }], "through the router, as a tab would");
});

test("shots the host could not read leave no card and no complaint; a worktree look that fails is the quiet answer", async () => {
  const api = bridge(); api.tasksEvidence = async () => { throw new Error("no window"); };
  const worktrees = { state: () => ({ list: null }), summary: () => ({ repo: true, tasks: [] }), peek: () => Promise.reject(new Error("git is busy")) };
  const a = await thread("t1", { tasks: [task("t1", { status: "awaiting_verification" })], stages: { t1: "review" }, api, worktrees });
  await a.settle(4);
  assert.equal(a.one("main", ".sx-media"), null);
  assert.ok(a.one("main", ".sx-feed"), "and the thread is still drawn");
});

test("a question with no title says what it asks in its own field, and one with neither says it is a decision", async () => {
  const titled = await thread("asking", { tasks: [task("asking")], questions: [question({ title: undefined, question: "Which way?" })] });
  assert.equal(titled.one("main", ".sx-ask .sx-ask-q").textContent, "Which way?");
  const bare = await thread("asking", { tasks: [task("asking")], questions: [question({ title: undefined })] });
  assert.equal(bare.one("main", ".sx-ask .sx-ask-q").textContent, "A decision");
});

test("the coding worker's tiers name the model each one runs, where the host knows it", async () => {
  const routing = { ok: true, executorCli: "opencode", executorTier: "fast", executorModels: { opencode: "zai/glm-5.3" }, executorTierModels: { opencode: { fast: "zai/glm-fast" } }, executorTierDefaults: { opencode: { heavy: { model: "zai/heavy-1" } } } };
  const a = await thread("t1", { tasks: [task("t1")], api: bridge({ routing }) });
  await a.settle(4);
  assert.deepEqual(a.all("main", "#sessions-worker-tier option").map((option) => option.textContent), ["Auto tier", "Free tier", "Fast tier · glm-fast", "Heavy tier · heavy-1"]);
  assert.equal(a.one("main", "#sessions-worker-tier").value, "fast");
  assert.equal(a.all("main", "#sessions-worker-cli option")[0].textContent, "OpenCode · glm-5.3", "and the worker its own");
});

test("an earlier brief with nothing in it says so", async () => {
  const entries = [{ id: "rev_1", kind: "Saved brief", at: at(1), snapshot: {} }];
  const a = await thread("t1", { tasks: [task("t1")], api: bridge({ history: { ok: true, entries, hasMore: false } }) });
  assert.match(card(a, "plan", "Versions").querySelector(".sx-version-text").textContent, /No brief text in this version\./);
});
