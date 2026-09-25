import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tasks.js", import.meta.url), "utf8");
const groupsSource = await readFile(new URL("../renderer/task-groups.js", import.meta.url), "utf8");
const stageSource = await readFile(new URL("../renderer/stage-labels.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div", ownerDocument = null) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attrs = {};
    this.ownerDocument = ownerDocument;
    this.hidden = false; this.value = ""; this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach((n) => classes.add(n)), contains: (n) => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) };
  }
  set textContent(text) {
    if (this.ownerDocument?.activeElement !== this && this.contains(this.ownerDocument?.activeElement)) this.ownerDocument.activeElement = null;
    this.ownText = String(text); this.children = [];
  }
  get textContent() { return (this.ownText ?? "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  insertBefore(child, next) { const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = value; }
  querySelectorAll(selector) {
    const match = (el) => selector === "[data-filter]" ? !!el.dataset.filter
      : selector.startsWith('[data-filter="') ? el.dataset.filter === selector.slice(14, -2)
      : selector === "li.selected" ? el.tagName === "li" && el.classList.contains("selected")
      : selector === "input" ? el.tagName === "input" : false;
    return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest() { return this; }
  contains(element) { return Boolean(element) && (element === this || this.children.some((child) => child.contains(element))); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  scrollIntoView() { this.scrolled = true; }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this, stopPropagation() {}, preventDefault() {} }); }
}

function environment({ tasks = [], filter = "all", saveOk = true, prefsWait = null, bridge = {}, overview = false, timers = null, clock = null } = {}) {
  const els = new Map();
  const document = { readyState: "loading", activeElement: null, getElementById: (id) => get(id), createElement: (tag) => new Element(tag, document), querySelectorAll: () => [], addEventListener() {} };
  const get = (id) => { if (!els.has(id)) els.set(id, new Element("div", document)); return els.get(id); };
  for (const filter of ["all", "open", "done"]) {
    const button = new Element("button"); button.dataset.filter = filter; get("task-filters").append(button);
  }
  const saved = []; const notifications = []; const events = []; const polls = new Map(); let onTasks, onProjects, onAssistantStatus;
  const prefs = { taskFilter: filter, autoReference: false };
  const context = vm.createContext({
    window: {
      mefiStudio: {
        tasksList: async () => ({ ok: true, tasks: structuredClone(tasks) }),
        tasksSave: async (rows) => { saved.push(structuredClone(rows)); return { ok: saveOk }; },
        prefsGet: async () => { if (prefsWait) await prefsWait; return { ok: true, prefs }; },
        prefsSet: async (patch) => { Object.assign(prefs, patch); return { ok: true, prefs }; },
        onTasks: (fn) => { onTasks = fn; },
        onProjects: (fn) => { onProjects = fn; },
        onAssistantStatus: (fn) => { onAssistantStatus = fn; },
        ...bridge,
      },
      MefiNav: { setBadge() {}, claim() {}, release() {} },
      MefiBoot: { pollStart: (name, callback) => polls.set(name, callback) }, MefiToast: (text) => notifications.push(text),
      dispatchEvent: (event) => { events.push(event); return true; },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document,
    // Timers stay inert unless a test collects them to fire by hand.
    setTimeout: (fn, delay) => { timers?.push({ fn, delay }); return timers ? timers.length : undefined; }, setInterval() {}, console,
    // A test clock moves Date.now() by hand; new Date(value) stays real.
    ...(clock ? { Date: class extends Date { static now() { return clock.now; } } } : {}),
  });
  vm.runInContext(stageSource, context);
  if (overview) vm.runInContext(groupsSource, context);
  vm.runInContext(source, context);
  const api = context.window.MefiTasks; api.init();
  return { api, get, document, window: context.window, saved, notifications, events, broadcast: (rows) => onTasks(rows), project: (activeId) => onProjects({ activeId }), live: (value) => onAssistantStatus(value), poll: () => polls.get("tasks.board")?.() };
}

test("workflow summary uses the current project's exact worker and recorded checks without promoting worker claims", async () => {
  const env = environment();
  const task = { id: "snake", projectId: "p", runId: "run-2", status: "active", lastAttempt: { result: { tests: "99 tests passed" } }, verificationRun: { state: "running", results: [{ ok: true }, { ok: false }] } };
  const status = { projectId: "p", running: [{ taskId: "snake", projectId: "q", currentStep: "Private foreign work" }, { taskId: "snake", runId: "run-1", currentStep: "Stale attempt" }, { taskId: "snake", runId: "run-2", route: "Builder A", currentStep: "Bash running · checking server", lastOutputAt: 58000 }] };
  const summary = env.api.workflowSummary(task, { status, now: 100000 });
  assert.equal(summary.worker, "Builder A");
  assert.equal(summary.action, "Bash running · checking server");
  assert.equal(summary.activityAge, "Updated 42s ago");
  assert.equal(summary.checks, "1/2 recorded checks passed · running");
  assert.equal(summary.stage, "running");
  assert.doesNotMatch(JSON.stringify(summary), /99 tests|Private foreign|Stale attempt/);
  const ready = env.api.workflowSummary({ id: "ready", projectId: "p", status: "open" }, { status: { projectId: "p", held: true, running: [] } });
  assert.match(ready.nextAction, /Task ready; agents paused/);
  assert.equal(ready.checks, "No completion checks recorded");
});

test("a saved worker assignment without current status is uncertain, and failed checks never look ready", () => {
  const env = environment();
  const task = { id: "work", projectId: "p", status: "active", runId: "current" };
  const summary = env.api.workflowSummary(task, { status: { projectId: "p", running: [{ taskId: "work", runId: "old", route: "Stale builder", currentStep: "Old output", lastOutputAt: 123 }] } });
  assert.equal(summary.stage, "waiting");
  assert.equal(summary.label, "Waiting for worker status");
  assert.match(summary.action, /saved worker assignment/);
  assert.equal(summary.worker, "Current worker status unavailable");
  assert.equal(summary.activityAge, "");
  assert.doesNotMatch(JSON.stringify(summary), /Ready for a worker|No worker running|Stale builder|Old output/);
  const failed = env.api.workflowSummary({ id: "failed", projectId: "p", status: "open", verification: { state: "failed", reason: "Rule checks failed" } });
  assert.equal(failed.stage, "blocked");
  assert.equal(failed.label, "Needs attention");
  assert.match(failed.action, /last completion check failed/);
  assert.match(failed.nextAction, /View checks/);
  assert.equal(failed.blocker, "Rule checks failed");
  // Green checks beside a rejected verdict: the action names the rejection
  // instead of calling the checks failed, and "passed" is said once.
  const rejected = env.api.workflowSummary({ id: "rejected", projectId: "p", status: "open", lastAttempt: { runId: "run_7" },
    verification: { state: "failed", reason: "No change in the attempt's session" }, verificationRun: { key: "rejected:run_7", state: "passed", results: [{ ok: true }] } });
  assert.equal(rejected.checks, "1/1 recorded checks passed");
  assert.match(rejected.action, /checks passed, but the result was not accepted/);
  assert.equal(rejected.blocker, "No change in the attempt's session");
  assert.doesNotMatch(`${rejected.action} ${rejected.checks}`, /check failed|passed · passed/);
  // An earlier attempt's run is labelled as such, and does not excuse this one.
  const stale = env.api.workflowSummary({ id: "stale", projectId: "p", status: "open", lastAttempt: { runId: "run_8" },
    verification: { state: "failed", reason: "Rule checks failed" }, verificationRun: { key: "stale:run_7", state: "passed", results: [{ ok: true }] } });
  assert.equal(stale.checks, "1/1 recorded checks passed · from an earlier attempt");
  assert.match(stale.action, /last completion check failed/);
  const checking = env.api.workflowSummary({ ...task, status: "awaiting_verification" }, { status: { projectId: "p", running: [] } });
  assert.equal(checking.stage, "review");
  assert.equal(checking.action, "Worker finished; checking the result", "a verification run can retain the completed worker's run id");
});

test("Work offers scoped start or saved resume once and keeps blocked or approval tasks held", async () => {
  for (const stage of ["ready", "owner", "blocked", "approval"]) {
    const task = { id: "start", projectId: "p", title: "Build Snake", status: "open" };
    const env = environment({ tasks: [task], bridge: { backlogStatus: async () => ({ ok: true, projectId: "p", paused: true, taskStates: [{ id: "start", stage: stage === "owner" ? "blocked" : stage, blockedBy: stage === "owner" ? "owner" : stage === "blocked" ? "dependencies" : undefined, reason: "Waiting" }] }) } });
    let finish; const pending = new Promise((resolve) => { finish = resolve; }); const calls = [];
    env.window.MefiWorkspace = { startTask: async (value) => { calls.push(value.id); await pending; } };
    await env.api.open({ taskId: "start" });
    const start = () => descendants(env.get("task-detail")).find((element) => element.dataset.taskAction === "start-task");
    if (["blocked", "approval"].includes(stage)) { assert.equal(start(), undefined); continue; }
    assert.equal(start().textContent, stage === "owner" ? "Resume this task" : "Start this task");
    start().click(); env.broadcast([task]); start().click();
    assert.equal(start().disabled, true);
    assert.deepEqual(calls, ["start"]);
    finish(); await settle();
    assert.equal(start().disabled, false);
  }
});

test("short task titles retain the complete brief and completed results expose useful next actions", async () => {
  const full = "Validate Snake and launch a local preview. Work only in Studio Snake Trial and preserve all existing controls and tests.";
  const task = { id: "done", projectId: "p", title: full, prompt: `${full}\nFinal acceptance check: keyboard input works.`, status: "done", verification: { state: "verified" } };
  const env = environment({ tasks: [task], bridge: { tasksList: async () => ({ ok: true, projectId: "p", tasks: [task] }) } });
  const actions = [];
  env.window.MefiWorkspace = { requestChange: (value) => actions.push(["change", value.id]), previewStatus: () => ({ projectId: "p", phase: "ready", message: "Ready" }), previewAction: (kind, value) => actions.push([kind, value.taskId]) };
  await env.api.open({ taskId: "done" });
  assert.equal(env.get("task-title").textContent, "Validate Snake and launch a local preview.");
  assert.ok(env.get("task-detail").textContent.includes(task.prompt));
  const controls = () => descendants(env.get("task-detail"));
  controls().find((element) => element.dataset.taskAction === "view-checks").click();
  assert.equal(env.get("task-tab-evidence").attrs["aria-selected"], "true");
  controls().find((element) => element.dataset.taskAction === "request-change").click();
  controls().find((element) => element.dataset.taskAction === "open-app").click();
  assert.deepEqual(actions, [["change", "done"], ["open", "done"]]);
  env.window.MefiWorkspace.previewStatus = () => ({ projectId: "q", phase: "ready" });
  env.broadcast([task]);
  assert.equal(controls().some((element) => element.dataset.taskAction === "open-app"), false);
});

test("a one-line task does not repeat its title as the brief, and Delete reads as destructive before it is armed", async () => {
  const task = { id: "one", projectId: "p", title: "Export notes as Markdown", status: "open" };
  const env = environment({ tasks: [task], bridge: { tasksList: async () => ({ ok: true, projectId: "p", tasks: [task] }) } });
  await env.api.open({ taskId: "one" });
  assert.equal(env.get("task-title").textContent, task.title);
  const repeats = descendants(env.get("task-detail")).filter((element) => element.tagName === "p" && element.textContent === task.title);
  assert.equal(repeats.length, 0, "the heading already shows the title");
  const remove = env.get("task-status-row").children.find((button) => button.textContent === "Delete");
  assert.match(remove.className, /\bdanger\b/);
});

test("Work keeps each project's selection and panel through project switches", async () => {
  let projectId = "p";
  const tasks = { p: [{ id: "first", projectId: "p", title: "First project", status: "open" }], q: [{ id: "second", projectId: "q", title: "Second project", status: "open" }] };
  const env = environment({ bridge: { tasksList: async () => ({ ok: true, projectId, tasks: tasks[projectId] }) } });
  await env.api.open({ taskId: "first" });
  env.get("task-tab-evidence").click();
  env.api.close();
  projectId = "q"; env.project("q"); await env.api.open({ taskId: "second" });
  projectId = "p"; env.project("p"); await settle();
  assert.equal(env.api.state.selected, "first");
  assert.equal(env.api.saveState().projectId, "p");
  assert.equal(env.get("task-tab-evidence").attrs["aria-selected"], "true");
  assert.doesNotMatch(env.get("task-detail").textContent, /Second project/);
});

test("returning to the board overview survives background refresh until Work is deliberately reopened", async () => {
  const task = { id: "one", projectId: "p", title: "Build Snake", status: "open" };
  const env = environment({ bridge: { tasksList: async () => ({ ok: true, projectId: "p", tasks: [task] }) } });
  await env.api.open({ taskId: "one" });
  env.get("task-overview-back").click();
  env.poll(); await settle();
  assert.equal(env.api.state.selected, null, "the background poll never undoes the user's Back action");
  env.api.close(); await env.api.open();
  assert.equal(env.api.state.selected, "one", "returning from another surface deliberately restores the task context");
});

test("live activity refresh preserves a History draft and stale reads cannot replace newer activity", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const task = { id: "working", projectId: "p", status: "active", runId: "run-1", title: "Build Snake" };
  const env = environment({ tasks: [task], bridge: { tasksList: async () => ({ ok: true, projectId: "p", tasks: [task] }), assistantStatus: () => pending } });
  const opening = env.api.open({ taskId: "working" });
  env.api.state.projectId = "p";
  env.live({ projectId: "p", running: [{ taskId: task.id, runId: task.runId, currentStep: "Current tool running" }] });
  finish({ ok: true, status: { projectId: "p", running: [{ taskId: task.id, currentStep: "Old output" }] } });
  await opening;
  env.get("task-tab-history").click();
  const input = () => descendants(env.get("task-detail")).find((element) => element.placeholder === "Log a note…");
  input().focus(); input().value = "Keep this note";
  for (const listener of input().listeners.input) listener({ target: input() });
  env.live({ projectId: "p", running: [{ taskId: task.id, runId: task.runId, currentStep: "Next tool running" }] });
  assert.equal(input().value, "Keep this note");
  assert.equal(env.document.activeElement, input());
  assert.match(env.get("task-detail").textContent, /Next tool running/);
  assert.doesNotMatch(env.get("task-detail").textContent, /Old output/);
});

const rows = [
  { id: "open", title: "Upcoming task", status: "open", updatedAt: 100 },
  { id: "done", title: "Visible finished task", status: "done", doneAt: 200, updatedAt: 200, verification: { state: "verified", reason: "2 files changed" }, lastAttempt: { result: { parts: { done: "Saved project settings" } } } },
  { id: "archived", title: "Older finished task", status: "archived", doneAt: 50, updatedAt: 400 },
  { id: "verify", title: "Finished worker", status: "awaiting_verification", updatedAt: 300 },
  { id: "review", title: "Needs a check", status: "open", verification: { state: "failed", reason: "No completion evidence" } },
];

test("task detail tabs retain selection across live refresh and keep note drafts in History", async () => {
  const env = environment({ tasks: rows });
  await env.api.open({ taskId: "done" });
  env.get("task-tab-history").click();
  const panels = () => env.get("task-detail").children.filter((child) => child.id?.startsWith("task-panel-"));
  assert.equal(panels().find((panel) => panel.id === "task-panel-history").hidden, false);
  assert.equal(panels().find((panel) => panel.id === "task-panel-evidence").hidden, true);
  const note = descendants(env.get("task-detail")).find((element) => element.placeholder === "Log a note…");
  note.value = "Review this result";
  for (const listener of note.listeners.input) listener({ target: note });
  env.broadcast(rows);
  assert.equal(panels().find((panel) => panel.id === "task-panel-history").hidden, false);
  assert.equal(descendants(env.get("task-detail")).find((element) => element.placeholder === "Log a note…").value, "Review this result");
  env.get("task-tab-references").click();
  assert.equal(env.get("task-reference-controls").hidden, false);
  env.get("task-tab-details").click();
  assert.equal(env.get("task-reference-controls").hidden, true);
});

test("History entry focus survives refresh before typing and preserves an edited selection", async () => {
  for (const [placeholder, field, buttonText] of [["Log a note…", "logs", "Log"], ["Capture an idea for this task…", "ideas", "Add idea"]]) {
    const timers = [];
    const env = environment({ tasks: rows, timers });
    await env.api.open({ taskId: "done" });
    env.get("task-tab-history").click();
    const input = () => descendants(env.get("task-detail")).find((element) => element.placeholder === placeholder);
    input().focus();
    input().setSelectionRange(0, 0, "none");
    env.broadcast(rows);
    assert.equal(env.document.activeElement, input(), "a refresh between click and typing keeps the empty field focused");
    env.document.activeElement.value = "Review this result";
    for (const listener of input().listeners.input) listener({ target: input() });
    input().setSelectionRange(7, 11, "backward");
    env.broadcast(rows.map((task) => task.id === "done" ? { ...task, updatedAt: 999, logs: [{ text: "Fresh worker status", at: 999 }] } : task));
    // A second push inside the 250 ms window paints on its trailing timer.
    for (const timer of timers.splice(0).filter((row) => row.delay <= 250)) timer.fn();
    assert.equal(env.document.activeElement, input());
    assert.equal(input().value, "Review this result");
    assert.deepEqual([input().selectionStart, input().selectionEnd, input().selectionDirection], [7, 11, "backward"]);
    assert.match(env.get("task-detail").textContent, /Fresh worker status/, "keeping focus does not block live task updates");
    descendants(env.get("task-detail")).find((element) => element.tagName === "button" && element.textContent === buttonText).click();
    await settle();
    assert.equal(env.saved.at(-1).find((task) => task.id === "done")[field].at(-1).text, "Review this result");
    assert.equal(input().value, "", "a successful save clears the submitted draft");
    assert.equal(env.document.activeElement, input(), "the field remains ready for another entry");
    env.api.selectTask("open");
    assert.notEqual(env.document.activeElement, input(), "opening another task never transfers editor focus to its empty entry");
  }
});

test("a gather deep link opens References, and a resumed detail restores its selected panel", async () => {
  let reads = 0;
  const env = environment({ tasks: rows, bridge: {
    referenceGather: async () => { reads += 1; return { ok: true, references: { verdict: "Useful", coverage: 0, files: [], code: [], sessions: [], chats: [], pngs: [], web: [], ideas: [] } }; },
  } });
  await env.api.open({ taskId: "open", gather: true }); await settle();
  assert.equal(reads, 1);
  assert.equal(env.get("task-reference-controls").hidden, false);
  assert.equal(env.get("task-tab-references").attrs["aria-selected"], "true");
  env.get("task-tab-evidence").click();
  const saved = env.api.saveState();
  assert.equal(saved.panel, "evidence");
  env.api.close();
  await env.api.open(saved);
  assert.equal(env.get("task-tab-evidence").attrs["aria-selected"], "true");
});

test("narrow task details focus Back and return focus to task creation when leaving detail", async () => {
  const env = environment({ tasks: rows });
  env.window.matchMedia = () => ({ matches: true });
  let focused = "";
  env.get("task-overview-back").focus = () => { focused = "back"; };
  env.get("task-new").focus = () => { focused = "new"; };
  await env.api.open({ taskId: "open" });
  assert.equal(focused, "back");
  env.get("task-overview-back").click();
  assert.equal(env.api.state.selected, null);
  assert.equal(focused, "new");
});

test("Done visibly retains archived tasks and offers pending completion checks without declaring them done", async () => {
  const env = environment({ tasks: rows });
  await env.api.open({ filter: "done" });
  const text = env.get("task-list").textContent;
  assert.match(text, /2 finished · 1 archived/);
  assert.match(text, /Visible finished task/);
  assert.match(text, /Older finished task/);
  assert.match(text, /Saved project settings/);
  assert.match(text, /Review 2 attempts/);
  assert.doesNotMatch(text, /Upcoming task/);
  assert.deepEqual(JSON.parse(JSON.stringify(env.api.summary(rows))), { all: 5, open: 1, done: 2, review: 2 });
});

test("All shows completed work expanded on first open", async () => {
  const env = environment({ tasks: rows });
  await env.api.open();
  assert.match(env.get("task-list").textContent, /Visible finished task/);
  assert.equal(env.api.state.doneCollapsed, false);
});

test("deep linking a done task overrides a saved Open filter and exposes the result", async () => {
  const env = environment({ tasks: rows, filter: "open" });
  await env.api.open({ taskId: "done" });
  assert.equal(env.api.state.filter, "done");
  assert.match(env.get("task-list").textContent, /Visible finished task/);
  assert.match(env.get("task-detail").textContent, /Completion accepted: 2 files changed/);
  assert.match(env.get("task-detail").textContent, /Worker reported — done: Saved project settings/);
});

test("verification evidence pairs each recorded command with its actual working location", async () => {
  const task = { id: "checked", title: "Check the game", status: "done", verificationRun: {
    state: "passed", commands: ["node test.mjs", "npm run check"], results: [
      { ok: true, command: "node test.mjs", cwd: "C:\\projects\\snake" },
      { ok: true, command: "npm run check", cwd: "C:\\projects\\snake\\tools" },
      { ok: true, command: "legacy check" },
    ],
  } };
  const env = environment({ tasks: [task] });
  await env.api.open({ taskId: task.id });
  const text = env.get("task-detail").textContent;
  assert.ok(text.includes("node test.mjs — Location: C:\\projects\\snake"));
  assert.ok(text.includes("npm run check — Location: C:\\projects\\snake\\tools"));
  assert.equal((text.match(/Location:/g) ?? []).length, 2, "older results do not invent a location");
});

test("Review has its own list and keeps worker success distinct from confirmed completion", async () => {
  const env = environment({ tasks: rows });
  await env.api.open({ filter: "review" });
  const text = env.get("task-list").textContent;
  assert.match(text, /Finished worker/);
  assert.match(text, /completion checks are pending/i);
  assert.match(text, /Needs a check/);
  assert.doesNotMatch(text, /Visible finished task/);
  assert.doesNotMatch(text, /Upcoming task/);
});

test("opening an empty Done view explains pending work and never implies a completed worker is missing", async () => {
  const env = environment({ tasks: rows.filter((row) => row.id === "verify") });
  await env.api.open({ filter: "done" });
  assert.match(env.get("task-list").textContent, /Review 1 attempt/);
  assert.match(env.get("task-list").textContent, /No confirmed completions/);
});

// New work enters through tasks:create, the host's one admission path; the
// whole-board save (tasks:save) no longer creates cards, so a bridge without
// tasks:create refuses instead of saving a card the host never admitted.
test("failed task creation does not leave a fake task in the board, and a bridge without tasks:create adds none", async () => {
  const env = environment({ tasks: [], bridge: { tasksCreate: async () => ({ ok: false, error: "The task store could not be written." }) } });
  const created = await env.api.addTask("This must be saved");
  assert.equal(created, null);
  assert.equal(env.api.state.tasks.length, 0);
  assert.match(env.notifications.at(-1), /could not be written/);
  const legacy = environment({ tasks: [] });
  assert.equal(await legacy.api.addTask("No admission path"), null);
  assert.equal(legacy.api.state.tasks.length, 0);
  assert.equal(legacy.saved.length, 0, "the whole-board save is never used to create a card");
  assert.match(legacy.notifications.at(-1), /cannot add tasks/);
});

test("creating a task announces the walkthrough event, and a failed save never does", async () => {
  const ok = environment({ tasks: [], bridge: { tasksCreate: async (payload) => ({ ok: true, projectId: "p", task: { id: "created", projectId: "p", title: payload.title, status: "open" } }) } });
  const created = await ok.api.addTask("Announce me");
  assert.ok(created);
  assert.deepEqual(ok.events.map((event) => event.type), ["mefi:task-created"]);
  assert.equal(ok.events[0].detail.taskId, created.id);
  const failed = environment({ tasks: [], bridge: { tasksCreate: async () => ({ ok: false, error: "The task store could not be written." }) } });
  await failed.api.addTask("Never announced");
  assert.deepEqual(failed.events, []);
});

test("selecting a task announces the walkthrough event carrying its status", async () => {
  const env = environment({ tasks: [{ id: "one", title: "Finish me", status: "done", doneAt: 400 }] });
  await env.api.open();
  env.api.selectTask("one");
  assert.equal(env.events.at(-1).type, "mefi:task-opened");
  assert.equal(env.events.at(-1).detail.taskId, "one");
  assert.equal(env.events.at(-1).detail.status, "done");
});

test("the selected task stays visible when a completion arrives while viewing open work", async () => {
  const env = environment({ tasks: [{ id: "one", title: "Finish me", status: "open" }], filter: "open" });
  await env.api.open({ taskId: "one" });
  env.broadcast([{ id: "one", title: "Finish me", status: "done", doneAt: 400 }]);
  assert.equal(env.api.state.filter, "done");
  assert.match(env.get("task-list").textContent, /Finish me/);
});

test("an in-flight board load cannot overwrite a newer completion broadcast", async () => {
  let resolve;
  const prefsWait = new Promise((done) => { resolve = done; });
  const env = environment({ tasks: [{ id: "one", title: "Finish me", status: "open" }], prefsWait });
  const opening = env.api.open();
  env.broadcast([{ id: "one", title: "Finish me", status: "done", doneAt: 400 }]);
  resolve();
  await opening;
  assert.equal(env.api.state.tasks[0].status, "done");
  assert.equal(env.api.summary().done, 1);
});

const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("shared-task details link delegated builders and count only confirmed subtasks", async () => {
  const tasks = [
    { id: "parent", projectId: "p", title: "Shared export", status: "open", delegation: { childTaskIds: ["done", "checking", "approval", "missing", "foreign"], summary: "Build format and UI independently" } },
    { id: "done", projectId: "p", title: "Write format", status: "done", verification: { state: "verified" }, parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
    { id: "checking", projectId: "p", title: "Write UI", status: "awaiting_verification", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
    { id: "approval", projectId: "p", title: "Write checks", status: "open", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
    { id: "foreign", projectId: "other", title: "Unrelated private work", status: "done", verification: { state: "verified" } },
  ];
  const env = environment({ tasks, bridge: { backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: [{ id: "approval", stage: "approval", reason: "Approve the saved brief first" }] }) } });
  await env.api.open({ taskId: "parent" }); await settle();
  const panel = descendants(env.get("task-detail")).find((element) => element.dataset.taskPanel === "delegation");
  assert.match(panel.textContent, /Delegated subtasks · 1\/5 confirmed/);
  assert.match(panel.textContent, /Build format and UI independently/);
  assert.match(panel.textContent, /Write UI.*Verifying/);
  assert.match(panel.textContent, /Write checks.*Awaiting approval/);
  assert.match(panel.textContent, /Unavailable subtask · missing.*Board status unavailable/);
  assert.doesNotMatch(panel.textContent, /Unrelated private work/);
  assert.equal(descendants(panel).filter((element) => element.dataset.taskAction === "view-subtask" && element.disabled).length, 2);
  descendants(panel).find((element) => element.dataset.taskId === "checking").click();
  assert.equal(env.api.state.selected, "checking");
  const parentLink = descendants(env.get("task-detail")).find((element) => element.dataset.taskAction === "view-parent");
  assert.equal(parentLink.textContent, "Shared task: Shared export");
  parentLink.click();
  assert.equal(env.api.state.selected, "parent");
});

test("a shared-task overview includes the parent integration step after all subtasks finish", async () => {
  const tasks = [
    { id: "parent", title: "Shared export", status: "open", delegation: { childTaskIds: ["child"] } },
    { id: "child", title: "Write format", status: "done", verification: { state: "verified" }, parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
  ];
  const env = environment({ tasks, overview: true });
  await env.api.open(); await settle();
  assert.match(env.get("task-list").textContent, /SHARED TASK & SUBTASKS/);
  assert.match(env.get("task-list").textContent, /1\/2 confirmed \(50%\)/);
  assert.match(env.get("task-list").textContent, /Next: Shared export/);
});

test("overview follows plan progress with an actual current step and keeps worker exits unconfirmed", async () => {
  const tasks = [
    { id: "done", planningId: "release", title: "Define export format", status: "done", verification: { state: "verified" } },
    { id: "active", planningId: "release", title: "Write export files", status: "active" },
    { id: "review", planningId: "release", title: "Verify import compatibility", status: "awaiting_verification", lastAttempt: { exitCode: 0 } },
  ];
  const env = environment({ tasks, overview: true, bridge: { planningList: async () => ({ ok: true, plans: [{ id: "release", title: "Portable release", status: "converted", taskIds: tasks.map((task) => task.id) }] }) } });
  await env.api.open();
  const cards = env.get("task-list").children.filter((element) => element.dataset.overviewId);
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /Portable release.*1\/3 confirmed \(33%\).*Current stepWorking on: Write export files/);
  const progress = descendants(cards[0]).find((element) => element.attrs.role === "progressbar");
  assert.equal(progress.attrs["aria-valuenow"], "1"); assert.equal(progress.attrs["aria-valuemax"], "3");
  assert.match(progress.attrs["aria-valuetext"], /1 working; 1 awaiting checks/);
  const details = descendants(cards[0]).find((element) => element.tagName === "details");
  assert.equal(details.open, false);
  env.api.selectTask("review");
  assert.equal(descendants(env.get("task-list")).find((element) => element.tagName === "details").open, true);
  assert.match(env.get("task-detail").textContent, /completion checks are pending/i);
  assert.equal(env.saved.length, 0);
});

test("discussion cards show recorded decisions and the next unblocked question without pretending to build", async () => {
  const plan = { id: "talk", title: "Share without accounts", destination: "Keep shared exports portable", status: "planning", questions: [
    { id: "format", question: "Which format?", status: "resolved" },
    { id: "conflict", question: "How should conflicts be handled?", status: "open", dependsOn: ["format"] },
  ] };
  const env = environment({ overview: true, bridge: { planningList: async () => ({ ok: true, plans: [plan] }) } });
  await env.api.open();
  const card = env.get("task-list").children.find((element) => element.dataset.overviewId);
  assert.equal(card.dataset.stage, "planning");
  assert.match(card.textContent, /1\/2 decisions recorded.*discussion does not start a build/);
  assert.match(card.textContent, /Current stepDiscuss: How should conflicts be handled/);
  assert.doesNotMatch(card.textContent, /Open current task|confirmed \(/);
  assert.equal(descendants(card).find((element) => element.attrs.role === "progressbar").attrs["aria-label"], "Planning decisions recorded");
  assert.equal(env.saved.length, 0);
});

test("grouped requirements never imply independent running workers and search retains the goal", async () => {
  const tasks = [
    { id: "group", title: "Reliable retries", status: "active", members: [{ id: "one" }, { id: "two" }] },
    { id: "one", title: "Ideas retry helper", prompt: "Preserve the exhaustedAttempts contract", status: "absorbed", absorbedInto: "group" },
    { id: "two", title: "Compactor retry helper", status: "absorbed", absorbedInto: "group" },
  ];
  const env = environment({ tasks, overview: true });
  await env.api.open();
  assert.match(env.get("task-list").textContent, /0\/2 requirements confirmed \(0%\) · plan in progress/);
  assert.match(env.get("task-list").textContent, /Current stepWorking on: Reliable retries/);
  assert.doesNotMatch(env.get("task-list").textContent, /2 working/);
  env.get("task-search").value = "exhaustedAttempts"; env.get("task-search").listeners.input[0]();
  assert.match(env.get("task-list").textContent, /Reliable retries.*Ideas retry helper/);
  assert.equal(env.get("task-list").children.filter((element) => element.dataset.overviewId).length, 1);
  assert.equal(env.saved.length, 0);
});

test("overview counts legacy completion as awaiting evidence and folds only confirmed history", async () => {
  const env = environment({ overview: true, tasks: [
    { id: "old", title: "Historical result", status: "done", verification: { state: "unverified" } },
    { id: "confirmed", title: "Confirmed result", status: "done", verification: { state: "manual" } },
  ] });
  await env.api.open();
  const old = env.get("task-list").children.find((element) => element.dataset.overviewId === "old");
  assert.equal(old.dataset.stage, "review");
  assert.match(old.textContent, /0\/1 confirmed.*historical completion still needs verified evidence/s);
  const completed = descendants(env.get("task-list")).find((element) => element.tagName === "details" && /Confirmed plans & tasks/.test(element.textContent));
  assert.equal(completed.open, false);
});

test("a late planning response cannot restore discussion cards from the previous project", async () => {
  let projectId = "p", finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ overview: true, bridge: {
    tasksList: async () => ({ ok: true, projectId, tasks: [] }),
    planningList: ({ projectId }) => projectId === "p" ? pending : Promise.resolve({ ok: true, projectId, plans: [{ id: "new", projectId, title: "Current discussion", status: "planning" }] }),
  } });
  const opening = env.api.open(); await settle();
  projectId = "q"; env.project(projectId); await settle();
  finish({ ok: true, projectId: "p", plans: [{ id: "old", title: "Private prior discussion", status: "planning" }] });
  await opening; await settle();
  assert.match(env.get("task-list").textContent, /Current discussion/);
  assert.doesNotMatch(env.get("task-list").textContent, /Private prior discussion/);
});

test("a failed result keeps its evidence blocker instead of a stale ready scheduling message", async () => {
  const env = environment({ overview: true, tasks: [{ id: "failed", title: "Check export", status: "open", verification: { state: "failed", reason: "Named validation did not pass" } }], bridge: {
    backlogStatus: async () => ({ ok: true, taskStates: [{ id: "failed", stage: "ready", reason: "Ready when scheduling resumes" }] }),
  } });
  await env.api.open();
  const card = env.get("task-list").children.find((element) => element.dataset.overviewId === "failed");
  const note = card.children.find((element) => element.className === "task-overview-note");
  assert.equal(card.dataset.stage, "blocked");
  assert.equal(note.textContent, "Named validation did not pass");
});

test("prerequisites exclude self and other projects, preserve a draft during broadcasts, and save a targeted delta", async () => {
  const child = { id: "child", projectId: "p", title: "Add export", status: "open", dependsOn: ["parent"] };
  const parent = { id: "parent", projectId: "p", title: "Define the data model", status: "done" };
  const foreign = { id: "foreign", projectId: "q", title: "Other project", status: "open" };
  const calls = [];
  const backlog = { ok: true, projectId: "p", taskStates: [{ id: "child", stage: "ready", reason: "All prerequisites are complete" }] };
  const env = environment({ tasks: [child, parent, foreign], bridge: {
    backlogStatus: async () => backlog,
    tasksDependencies: async (payload) => { calls.push(payload); return { ok: true, task: { ...child, dependsOn: payload.dependsOn }, backlog }; },
  } });
  await env.api.open({ taskId: "child" });
  const options = () => descendants(env.get("task-detail")).filter((element) => element.dataset.dependencyId);
  assert.deepEqual(options().map((element) => element.dataset.dependencyId), ["parent"]);
  assert.match(env.get("task-detail").textContent, /All prerequisites are complete/);
  options()[0].checked = false; options()[0].listeners.change[0]();
  env.broadcast([child, parent, foreign]);
  await settle();
  assert.equal(options()[0].checked, false, "live status does not erase an unsaved prerequisite choice");
  descendants(env.get("task-detail")).find((element) => element.dataset.taskAction === "dependencies").click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "child", projectId: "p", dependsOn: [] }]);
  assert.equal(env.saved.length, 0, "prerequisites do not overwrite a stale whole-board snapshot");
  assert.match(env.get("task-detail").textContent, /Prerequisites saved/);
});

test("a missing prerequisite can be removed and a rejected save retains the edit with its real error", async () => {
  const child = { id: "child", projectId: "p", title: "Add export", status: "open", dependsOn: ["deleted-task"] };
  const env = environment({ tasks: [child], bridge: {
    tasksDependencies: async () => ({ ok: false, error: "This task has a live worker. Wait for it to finish." }),
  } });
  await env.api.open({ taskId: "child" });
  const option = descendants(env.get("task-detail")).find((element) => element.dataset.dependencyId === "deleted-task");
  assert(option, "deleted prerequisite remains visible for removal");
  option.checked = false; option.listeners.change[0]();
  descendants(env.get("task-detail")).find((element) => element.dataset.taskAction === "dependencies").click();
  await settle();
  assert.match(env.get("task-detail").textContent, /live worker/);
  assert.equal(env.api.state.tasks[0].dependsOn[0], "deleted-task", "failed mutation never reports saved dependencies");
  assert.equal(env.saved.length, 0);
});

test("history restore requests an exact saved revision and retains completed task evidence", async () => {
  const task = { id: "finished", projectId: "p", title: "Current brief", prompt: "Current requirements", status: "done", verification: { state: "verified", reason: "Checks passed" } };
  const calls = [];
  const env = environment({ tasks: [task], bridge: {
    tasksHistory: async () => ({ ok: true, entries: [{ id: "revision_old", kind: "saved", at: 100, snapshot: { prompt: "The earlier requirements" } }] }),
    tasksHandoff: async () => ({ ok: true, text: "Prior worker checked the export. Remaining: document the format." }),
    tasksRestore: async (payload) => { calls.push(payload); return { ok: true, task: { ...task, prompt: "The earlier requirements" } }; },
  } });
  await env.api.open({ taskId: "finished" }); await settle();
  assert.match(env.get("task-detail").textContent, /Prior worker checked the export/);
  descendants(env.get("task-detail")).find((element) => element.dataset.taskAction === "restore").click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "finished", projectId: "p", revisionId: "revision_old" }]);
  assert.equal(env.api.state.tasks[0].status, "done");
  assert.equal(env.api.state.tasks[0].verification.state, "verified");
  assert.equal(env.api.state.tasks[0].prompt, "The earlier requirements");
  assert.match(env.get("task-detail").textContent, /Files, task status, and completion evidence are unchanged/);
});

test("a late handoff read never replaces the newly selected task's context", async () => {
  let resolveOld;
  const oldRead = new Promise((resolve) => { resolveOld = resolve; });
  const env = environment({ tasks: [{ id: "old", title: "Old task", status: "open" }, { id: "new", title: "New task", status: "open" }], bridge: {
    tasksHistory: async () => ({ ok: true, entries: [] }),
    tasksHandoff: async ({ taskId }) => taskId === "old" ? oldRead : { ok: true, text: "Context for the new task" },
  } });
  await env.api.open({ taskId: "old" });
  await env.api.open({ taskId: "new" }); await settle();
  resolveOld({ ok: true, text: "Old context should stay out" }); await settle();
  assert.match(env.get("task-detail").textContent, /Context for the new task/);
  assert.doesNotMatch(env.get("task-detail").textContent, /Old context should stay out/);
});

test("Stop stays available for active builders while unsafe task edits remain locked", async () => {
  for (const source of ["manual", "a-eyes"]) {
    const task = { id: `working-${source}`, projectId: "p", title: source === "a-eyes" ? "Repair generated collision" : "Build the feature", status: "active", runId: `run-${source}`, source };
    const other = { id: "other", projectId: "p", title: "Independent worker", status: "active", runId: "other-run" };
    const calls = []; let finish;
    const env = environment({ tasks: [task, other], bridge: { tasksAction: (payload) => { calls.push(payload); return new Promise((resolve) => { finish = resolve; }); } } });
    await env.api.open({ taskId: task.id });
    const buttons = () => env.get("task-status-row").children;
    const stop = buttons().find((button) => button.dataset.taskAction === "stop");
    assert.ok(stop);
    assert.equal(stop.disabled, false, `${source} worker can be stopped`);
    assert.equal(buttons().find((button) => button.textContent === "Rename").disabled, false);
    assert.equal(buttons().find((button) => button.textContent === "Mark done").disabled, true);
    assert.equal(buttons().find((button) => button.textContent === "Delete").disabled, true);
    stop.click();
    assert.equal(buttons().find((button) => button.dataset.taskAction === "stop").disabled, true, "pending stop cannot be resubmitted");
    assert.equal(env.api.state.tasks[0].runId, task.runId, "running evidence stays until the host confirms");
    finish({ ok: true, task: { ...task, status: "open", runId: null }, backlog: { ok: true, projectId: "p", taskStates: [{ id: task.id, stage: "blocked", blockedBy: "owner", reason: "Stopped by you" }] } });
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: task.id, projectId: "p", action: "stop" }]);
    assert.equal(buttons().find((button) => button.textContent === "Resume").disabled, false);
    assert.equal(env.api.state.tasks[1].runId, "other-run", "other workers are unchanged");
    assert.equal(env.saved.length, 0, "stop never overwrites the task store");
  }
});

test("a refused targeted stop restores Stop without inventing a stopped worker", async () => {
  const task = { id: "working", projectId: "p", title: "Active worker", status: "active", runId: "running-worker" };
  const env = environment({ tasks: [task], bridge: { tasksAction: async () => ({ ok: false, error: "Worker could not be reached" }) } });
  await env.api.open({ taskId: task.id });
  env.get("task-status-row").children.find((button) => button.dataset.taskAction === "stop").click();
  await settle();
  assert.equal(env.api.state.tasks[0].runId, "running-worker");
  assert.equal(env.get("task-status-row").children.find((button) => button.dataset.taskAction === "stop").disabled, false);
  assert.match(env.get("task-detail").textContent, /Worker could not be reached/);
});

test("Retry and Confirm done use targeted actions and never change evidence before the server saves", async () => {
  const task = { id: "review", projectId: "p", title: "Review the export", status: "open", runFailures: 5, verification: { state: "failed", reason: "Checks did not pass" } };
  const calls = []; let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ tasks: [task], bridge: { tasksAction: async (payload) => {
    calls.push(payload);
    return payload.action === "retry" ? { ok: false, error: "The previous verification must finish first." } : pending;
  } } });
  await env.api.open({ taskId: "review" });
  env.get("task-status-row").children.find((element) => element.textContent === "Retry").click();
  await settle();
  assert.equal(env.api.state.tasks[0].verification.state, "failed");
  assert.equal(env.api.state.tasks[0].runFailures, 5);
  assert.match(env.get("task-detail").textContent, /previous verification must finish/);
  env.get("task-status-row").children.find((element) => element.textContent === "Confirm done").click();
  assert.equal(env.api.state.tasks[0].status, "open", "pending action is not a fake completion");
  finish({ ok: true, task: { ...task, status: "done", verification: { state: "manual", reason: "Marked done by you" } } });
  await settle();
  assert.equal(env.api.state.tasks[0].status, "done");
  assert.equal(env.api.state.tasks[0].verification.state, "manual");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "review", projectId: "p", action: "retry" }, { taskId: "review", projectId: "p", action: "status", status: "done" }]);
  assert.equal(env.saved.length, 0);
});

test("Do next prioritizes through the scheduler instead of fabricating an active worker", async () => {
  const task = { id: "queued", projectId: "p", title: "Queued work", status: "open" };
  const calls = [];
  const env = environment({ tasks: [task], bridge: { backlogControl: async (payload) => { calls.push(payload); return { ok: true }; } } });
  await env.api.open({ taskId: "queued" });
  assert(!env.get("task-status-row").children.some((element) => element.textContent === "Activate"));
  env.get("task-status-row").children.find((element) => element.textContent === "Do next").click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "queued", projectId: "p", action: "prioritize" }]);
  assert.equal(env.api.state.tasks[0].status, "open");
  assert.equal(env.saved.length, 0);
});

test("rejected note and idea saves roll back the unsaved entry and retain drafts across task refreshes", async () => {
  for (const [field, placeholder, buttonText] of [["logs", "Log a note…", "Log"], ["ideas", "Capture an idea for this task…", "Add idea"]]) {
    const task = { id: "busy", projectId: "p", title: "Work in progress", status: "open", logs: [], ideas: ["idea_saved"] };
    const env = environment({ tasks: [task], bridge: { tasksSave: async () => ({ ok: false, error: "The task changed. Refresh before saving." }) } });
    await env.api.open({ taskId: "busy" });
    const input = descendants(env.get("task-detail")).find((element) => element.placeholder === placeholder);
    input.value = "Keep this useful context";
    descendants(env.get("task-detail")).find((element) => element.tagName === "button" && element.textContent === buttonText).click();
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(env.api.state.tasks[0][field])), task[field], "unsaved entry is not displayed as a durable change");
    assert.equal(descendants(env.get("task-detail")).find((element) => element.placeholder === placeholder).value, "Keep this useful context");
    assert.match(env.notifications.at(-1), /not saved.*task changed/);
    env.broadcast([structuredClone(task)]); await settle();
    assert.equal(descendants(env.get("task-detail")).find((element) => element.placeholder === placeholder).value, "Keep this useful context", "a follow-up broadcast cannot erase the rejected draft");
    assert.match(env.get("task-detail").textContent, /Linked idea: idea_saved/);
    assert.doesNotMatch(env.get("task-detail").textContent, /Invalid Date|undefined/);
  }
});

test("failed reference attachment preserves the old task and explains that found references were not saved", async () => {
  const task = { id: "task", title: "Find context", status: "open", refs: [], logs: [] };
  const env = environment({ tasks: [task], saveOk: false, bridge: {
    referenceGather: async () => ({ ok: true, references: { verdict: "Useful", coverage: 10, files: ["README.md"], code: [], sessions: [], chats: [], pngs: [], web: [], ideas: [] } }),
  } });
  await env.api.open({ taskId: "task" });
  env.get("reference-run").click(); await settle();
  assert.equal(env.api.state.tasks[0].refs.length, 0);
  assert.equal(env.api.state.tasks[0].logs.length, 0);
  assert.match(env.get("reference-status").textContent, /found, but not saved/);
  assert.match(env.notifications.at(-1), /found, but not saved/);
  assert(!env.notifications.some((message) => /^References gathered/.test(message)));
});

test("scheduling filters distinguish blockers, approvals, verification and timed retries, and task links clear the filter", async () => {
  const tasks = ["ready", "blocked", "approval", "waiting", "cooling", "review"].map((stage) => ({ id: stage, title: `Task ${stage}`, status: stage === "review" ? "awaiting_verification" : "open", projectId: "p" }));
  const backlog = { ok: true, projectId: "p", taskStates: tasks.map((task) => ({ id: task.id, stage: task.id, reason: `Reason for ${task.id}`, ...(task.id === "cooling" ? { retryAt: Date.now() + 60000 } : {}) })) };
  const env = environment({ tasks, bridge: { backlogStatus: async () => backlog } });
  await env.api.open({ filter: "all", readiness: "blocked" });
  assert.match(env.get("task-list").textContent, /Task blocked.*Reason for blocked/);
  assert.match(env.get("task-list").textContent, /AWAITING APPROVAL.*Task approval.*Reason for approval/);
  assert.doesNotMatch(env.get("task-list").textContent, /Task ready|Task waiting|Task review/);
  await env.api.open({ readiness: "waiting" });
  assert.match(env.get("task-list").textContent, /Task waiting/);
  assert.match(env.get("task-list").textContent, /Task cooling.*Automatic retry in/);
  assert.doesNotMatch(env.get("task-list").textContent, /Task blocked|Task approval|Task review/);
  await env.api.open({ taskId: "ready" });
  assert.equal(env.api.state.readiness, "all");
  assert.match(env.get("task-list").textContent, /Task ready/);
  const select = descendants(env.get("task-filters")).find((item) => item.tagName === "select");
  select.value = "review"; select.listeners.change[0]();
  assert.match(env.get("task-list").textContent, /Task review/);
  assert.doesNotMatch(env.get("task-list").textContent, /Task ready|Task blocked/);
});

test("Approve build reviews the full saved brief and authorizes only its displayed scope while preserving pause", async () => {
  const calls = []; let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const task = { id: "approval", projectId: "p", title: "Add export", status: "open", buildScope: "shown-scope", prompt: `Export each task.\n${"Keep the complete brief. ".repeat(100)}Final acceptance check.`, files: ["renderer/tasks.js"], dependsOn: ["prerequisite"] };
  const backlog = { ok: true, projectId: "p", paused: true, autoBuild: false, taskStates: [{ id: task.id, stage: "approval", canApprove: true, reason: "Review and approve this brief before building.", buildScope: task.buildScope }] };
  const env = environment({ tasks: [task, { id: "prerequisite", title: "Prepare export format", status: "done" }], bridge: { backlogStatus: async () => backlog, backlogControl: (payload) => { calls.push(payload); return pending; } } });
  await env.api.open({ taskId: task.id });
  assert.match(env.get("task-detail").textContent, /Build brief to review/);
  assert.ok(env.get("task-detail").textContent.includes(task.prompt));
  assert.match(env.get("task-detail").textContent, /Files in scope: renderer\/tasks.js/);
  assert.match(env.get("task-detail").textContent, /Prerequisites: Prepare export format/);
  assert.match(env.get("task-detail").textContent, /Leave this task here to decide later/);
  const approve = env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve");
  assert.equal(approve.textContent, "Approve build");
  assert.equal(approve.disabled, false);
  assert(!env.get("task-status-row").children.some((item) => item.textContent === "Do next"));
  approve.click(); approve.click();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { taskId: task.id, projectId: "p", action: "approve", expectedScope: "shown-scope" });
  assert.equal(env.api.state.tasks.find((item) => item.id === task.id).buildApproval, undefined, "approval is not invented before storage accepts it");
  finish({ ok: true, task: { ...task, buildApproval: { scope: task.buildScope } }, backlog: { ...backlog, taskStates: [{ id: task.id, stage: "ready", reason: "Ready when scheduling resumes." }] } });
  await settle();
  assert.equal(env.api.state.backlog.paused, true);
  assert.match(env.get("task-detail").textContent, /Build approved for this brief/);
  assert(!env.get("task-status-row").children.some((item) => item.dataset.taskAction === "approve"));
});

test("stale build approval submits the displayed task scope and surfaces rejection without releasing the hold", async () => {
  const calls = [];
  const task = { id: "approval", projectId: "p", title: "Displayed brief", prompt: "Scope the user has read", status: "open", buildScope: "old-displayed-scope" };
  const backlog = { ok: true, projectId: "p", taskStates: [{ id: task.id, stage: "approval", canApprove: true, buildScope: "newer-backlog-scope", reason: "Approval required" }] };
  const env = environment({ tasks: [task], bridge: { backlogStatus: async () => backlog, backlogControl: async (payload) => { calls.push(payload); return { ok: false, error: "This brief changed. Refresh and review it before approving." }; } } });
  await env.api.open({ taskId: task.id });
  env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve").click(); await settle();
  assert.equal(calls[0].expectedScope, "old-displayed-scope");
  assert.match(env.get("task-detail").textContent, /This brief changed/);
  assert.equal(env.api.state.backlog.taskStates[0].stage, "approval");
  assert.equal(env.api.state.tasks[0].buildApproval, undefined);
  assert.equal(env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve").disabled, false);
  env.broadcast([{ ...task, buildScope: undefined }]); await settle();
  assert.equal(env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve").disabled, true, "a legacy or incomplete task response cannot approve a brief it did not identify");
});

test("a delayed approval cannot restore the previous project while the new backlog is loading", async () => {
  let project = "p", finishApproval, finishBacklog;
  const pendingApproval = new Promise((resolve) => { finishApproval = resolve; });
  const nextBacklog = new Promise((resolve) => { finishBacklog = resolve; });
  const oldTask = { id: "shared-id", projectId: "p", title: "First project brief", prompt: "First scope", buildScope: "scope-p", status: "open" };
  const currentTask = { ...oldTask, projectId: "q", title: "Current project brief", prompt: "Current scope", buildScope: "scope-q" };
  const oldBacklog = { ok: true, projectId: "p", taskStates: [{ id: oldTask.id, stage: "approval", canApprove: true }] };
  const env = environment({ bridge: {
    tasksList: async () => ({ ok: true, projectId: project, tasks: [project === "p" ? oldTask : currentTask] }),
    backlogStatus: () => project === "p" ? Promise.resolve(oldBacklog) : nextBacklog,
    backlogControl: () => pendingApproval,
  } });
  await env.api.open({ taskId: oldTask.id });
  env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve").click();
  project = "q"; env.project(project); await settle();
  assert.equal(env.api.state.backlog, null);
  finishApproval({ ok: true, task: oldTask, backlog: { ...oldBacklog, taskStates: [{ id: oldTask.id, stage: "ready" }] } }); await settle();
  assert.equal(env.api.state.projectId, "q");
  assert.equal(env.api.state.backlog, null, "the previous project reply cannot repopulate this slot during project load");
  assert.equal(env.api.state.tasks.length, 0);
  finishBacklog({ ok: true, projectId: "q", taskStates: [{ id: currentTask.id, stage: "approval", canApprove: true }] }); await settle();
  env.api.selectTask(currentTask.id);
  assert.match(env.get("task-detail").textContent, /Current scope/);
  assert.doesNotMatch(env.get("task-detail").textContent, /First scope|Build approved for this brief/);
});

test("late context reads cannot pair an old brief with the approval token of a newly broadcast scope", async () => {
  let finishContext, reads = 0;
  const calls = [], lateContext = new Promise((resolve) => { finishContext = resolve; });
  const oldTask = { id: "task", projectId: "p", title: "Read this brief", prompt: "Old requirements", buildScope: "old-scope", status: "open" };
  const currentTask = { ...oldTask, prompt: "New requirements", buildScope: "new-scope" };
  const env = environment({ tasks: [oldTask], bridge: {
    backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: [{ id: oldTask.id, stage: "approval", canApprove: true }] }),
    tasksHistory: async () => ({ ok: true, entries: [] }),
    tasksHandoff: () => ++reads === 1 ? lateContext : Promise.resolve({ ok: true, text: "Context for new requirements" }),
    backlogControl: async (payload) => { calls.push(payload); return { ok: false, error: "Held for assertion" }; },
  } });
  await env.api.open({ taskId: oldTask.id });
  env.broadcast([currentTask]); await settle();
  finishContext({ ok: true, text: "Context for old requirements" }); await settle();
  assert.match(env.get("task-detail").textContent, /New requirements.*Context for new requirements/);
  assert.doesNotMatch(env.get("task-detail").textContent, /Old requirements|Context for old requirements/);
  env.get("task-status-row").children.find((item) => item.dataset.taskAction === "approve").click(); await settle();
  assert.equal(calls[0].expectedScope, "new-scope");
});

test("cooling tasks offer a targeted retry while prerequisite blockers do not offer misleading priority", async () => {
  const cooling = { id: "cooling", projectId: "p", title: "Retry the export", status: "open", runFailures: 1, nextRunAt: Date.now() + 120000 };
  const blocked = { id: "blocked", projectId: "p", title: "Repair prerequisite", status: "open", dependsOn: ["gone"] };
  const calls = [];
  const backlog = { ok: true, projectId: "p", taskStates: [{ id: "cooling", stage: "cooling", reason: "Waiting before another attempt", retryAt: cooling.nextRunAt }, { id: "blocked", stage: "blocked", blockedBy: "dependencies", canRetry: false, reason: "Missing prerequisite: gone" }] };
  const env = environment({ tasks: [cooling, blocked], bridge: { backlogStatus: async () => backlog, backlogControl: async () => { throw new Error("Blocked priority must not be offered"); }, tasksAction: async (payload) => { calls.push(payload); return { ok: false, error: "Project is paused. Retry remains available." }; } } });
  await env.api.open({ taskId: "cooling" });
  assert.match(env.get("task-detail").textContent, /Automatic retry in 2m/);
  env.get("task-status-row").children.find((item) => item.textContent === "Retry now").click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "cooling", projectId: "p", action: "retry" }]);
  await env.api.open({ taskId: "blocked" });
  assert(!env.get("task-status-row").children.some((item) => ["Do next", "Retry now"].includes(item.textContent)));
});

const LOOP_REASON = "Loop guard: 6 attempts since your last retry ended without verified progress (tests failed). Read the last attempts, edit or split the brief, then choose Try again.";

test("a loop-guard hold shows its reason and remedy and Try again releases it through the retry path", async () => {
  const task = { id: "loop", projectId: "p", title: "Fix the export", status: "open", lastRunError: "exit 1", loopGuard: { v: 1, count: 6, reason: "tests failed", by: "keeper" } };
  const calls = [];
  const env = environment({ tasks: [task], overview: true, bridge: {
    backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: [{ id: "loop", stage: "blocked", blockedBy: "loop", reason: LOOP_REASON }] }),
    tasksAction: async (payload) => {
      calls.push(payload);
      const released = { ...task };
      delete released.loopGuard;
      return { ok: true, task: { ...released, pin: true }, backlog: { ok: true, projectId: "p", taskStates: [{ id: "loop", stage: "ready", reason: "You chose this to go next" }] } };
    },
  } });
  await env.api.open({ taskId: "loop" });
  const card = env.get("task-list").children.find((element) => element.dataset.overviewId === "loop");
  assert.equal(card.dataset.stage, "blocked");
  assert.equal(card.children.find((element) => element.className === "task-overview-note").textContent, LOOP_REASON, "the hold's reason wins over the last run error");
  assert.ok(descendants(card).some((element) => element.dataset.taskAction === "try-again" && element.textContent === "Try again"), "the card offers Try again");
  const readiness = descendants(env.get("task-detail")).find((element) => element.dataset.taskReadiness);
  assert.equal(readiness.dataset.taskReadiness, "blocked");
  assert.equal(readiness.textContent, LOOP_REASON, "the detail shows the hold's reason with its remedy");
  assert.equal(env.get("task-detail").textContent.split("Loop guard:").length, 2, "the reason is shown once, not repeated as a review line");
  assert.equal(env.api.summary().review, 1, "a held card counts under Review");
  const row = env.get("task-status-row").children;
  const tryAgain = row.find((element) => element.dataset.taskAction === "try-again");
  assert.equal(tryAgain.textContent, "Try again");
  assert.equal(tryAgain.className, "primary");
  assert.equal(tryAgain.disabled, false);
  assert.equal(row.find((element) => element.textContent === "Mark done").className, "ghost");
  assert(!row.some((element) => ["Retry", "Confirm done"].includes(element.textContent)), "the hold's own action replaces the generic Retry");
  tryAgain.click(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "loop", projectId: "p", action: "retry" }]);
  assert.equal(env.api.state.tasks[0].loopGuard, undefined);
  assert(!env.get("task-status-row").children.some((element) => element.dataset.taskAction === "try-again"), "a released card no longer offers Try again");
  assert.doesNotMatch(env.get("task-detail").textContent, /Loop guard/);
  assert.equal(env.saved.length, 0, "the release never overwrites the board snapshot");
});

test("a duplicate you linked says what it waits for and Run anyway clears the link through the retry path", async () => {
  const tasks = [
    { id: "dup", projectId: "p", title: "Export tasks again", status: "open", duplicateOf: "orig" },
    { id: "orig", projectId: "p", title: "Build the export", status: "open" },
  ];
  const calls = [];
  const env = environment({ tasks, overview: true, bridge: {
    backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: [{ id: "dup", stage: "waiting", blockedBy: "duplicate", reason: "Waiting for Build the export (the same work)" }, { id: "orig", stage: "ready", reason: "Ready for an available worker" }] }),
    tasksAction: async (payload) => { calls.push(payload); return { ok: false, error: "Held for assertion" }; },
  } });
  await env.api.open();
  const card = env.get("task-list").children.find((element) => element.dataset.overviewId === "dup");
  assert.equal(card.children.find((element) => element.className === "task-overview-note").textContent, "Waiting for Build the export (the same work)");
  const runAnyway = descendants(card).find((element) => element.dataset.taskAction === "run-anyway");
  assert.equal(runAnyway.textContent, "Run anyway");
  runAnyway.click(); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "dup", projectId: "p", action: "retry" }]);
  assert.equal(env.api.state.tasks[0].duplicateOf, "orig", "a rejected release keeps the link");
  await env.api.open({ taskId: "dup" });
  const readiness = descendants(env.get("task-detail")).find((element) => element.dataset.taskReadiness);
  assert.equal(readiness.dataset.taskReadiness, "waiting");
  assert.equal(readiness.textContent, "Waiting for Build the export (the same work)");
  assert.equal(env.api.summary().review, 0, "waiting on the original is not a review");
  const row = env.get("task-status-row").children;
  assert.equal(row.find((element) => element.dataset.taskAction === "run-anyway").className, "primary");
  assert.equal(row.find((element) => element.textContent === "Mark done").className, "ghost");
  assert(!env.get("task-list").children.find((element) => element.dataset.overviewId === "orig").textContent.includes("Run anyway"), "the original offers nothing");
});

test("Try again and Run anyway are never offered while a worker or the checker holds the card", async () => {
  const tasks = [
    { id: "working", projectId: "p", title: "Working card", status: "active", runId: "run_1" },
    { id: "checking", projectId: "p", title: "Checking card", status: "awaiting_verification" },
    { id: "claimed", projectId: "p", title: "Claimed card", status: "open", runId: "run_2" },
  ];
  const states = [{ id: "working", stage: "blocked", blockedBy: "loop", reason: LOOP_REASON }, { id: "checking", stage: "blocked", blockedBy: "loop", reason: LOOP_REASON }, { id: "claimed", stage: "waiting", blockedBy: "duplicate", reason: "Waiting for Working card (the same work)" }];
  const env = environment({ tasks, overview: true, bridge: {
    backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: states }),
    tasksAction: async () => { throw new Error("a held card must not be retried"); },
  } });
  for (const task of tasks) {
    await env.api.open({ taskId: task.id });
    assert(!env.get("task-status-row").children.some((element) => ["try-again", "run-anyway"].includes(element.dataset.taskAction)), `${task.id} offers no release`);
  }
  assert(!descendants(env.get("task-list")).some((element) => ["try-again", "run-anyway"].includes(element.dataset.taskAction)), "no overview card offers one either");
});

test("board Add creates an explicit project task once, preserves newer typing and never routes through chat", async () => {
  const calls = []; let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ bridge: {
    tasksList: async () => ({ ok: true, projectId: "p", tasks: [] }),
    backlogStatus: async () => ({ ok: true, projectId: "p", paused: true, taskStates: [] }),
    tasksCreate: async (payload) => { calls.push(payload); return pending; },
    assistantMessage: () => { throw new Error("Explicit Add must not become discussion"); },
  } });
  await env.api.open();
  const input = env.get("task-new"), button = env.get("task-add");
  input.value = "Could the export include a timestamp?";
  button.click(); button.click(); await settle();
  assert.equal(button.disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ title: input.value, prompt: input.value, projectId: "p" }]);
  input.value = "A second task I am still drafting"; input.listeners.input[0]();
  finish({ ok: true, projectId: "p", task: { id: "created", projectId: "p", title: calls[0].title, status: "open" } });
  await settle();
  assert.equal(input.value, "A second task I am still drafting");
  assert.equal(button.disabled, false);
  assert.equal(env.api.state.tasks[0].id, "created");
  assert.equal(env.api.state.selected, "created");
  assert.match(env.notifications.at(-1), /queued until you resume/);
  assert.equal(env.saved.length, 0, "creation does not overwrite the board snapshot");
});

test("failed explicit task creation retains the full draft and actual failure without a fake task", async () => {
  const env = environment({ bridge: { tasksCreate: async () => ({ ok: false, error: "An unfinished task with this title already exists." }) } });
  await env.api.open();
  env.get("task-new").value = "Keep this task brief"; env.get("task-add").click(); await settle();
  assert.equal(env.get("task-new").value, "Keep this task brief");
  assert.equal(env.api.state.tasks.length, 0);
  assert.match(env.get("reference-status").textContent, /unfinished task with this title already exists/);
  assert.equal(env.get("task-add").disabled, false);
});

test("a creation response from another project cannot leak its task or clear the current draft", async () => {
  let project = "p", finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ bridge: {
    tasksList: async () => ({ ok: true, projectId: project, tasks: [] }),
    backlogStatus: async () => ({ ok: true, projectId: project, taskStates: [] }),
    tasksCreate: async () => pending,
  } });
  await env.api.open();
  env.get("task-new").value = "Task for first project"; env.get("task-add").click(); await settle();
  project = "q"; env.project("q"); await settle();
  env.get("task-new").value = "Second project draft"; env.get("task-new").listeners.input[0]();
  finish({ ok: true, projectId: "p", task: { id: "old", projectId: "p", title: "Task for first project", status: "open" } });
  await settle();
  assert.equal(env.api.state.projectId, "q");
  assert.equal(env.api.state.tasks.length, 0);
  assert.equal(env.get("task-new").value, "Second project draft");
  assert(!env.notifications.some((message) => /^Task created/.test(message)));
});

test("task detail lists each run from the ledger and links its session without implying completion", async () => {
  const task = { id: "fix", projectId: "p", title: "Fix save", status: "open", runId: "run_3", runProgress: { runId: "run_3", sessionId: "ses_live", progress: 0.4, outputTail: ["editing save.js"] }, lastAttempt: { runId: "run_2", at: 290 }, verification: { state: "failed", reason: "No completion evidence" } };
  const calls = [], went = [];
  const env = environment({ tasks: [task], bridge: {
    tasksAttempts: async (payload) => { calls.push(payload); return { ok: true, taskId: "fix", attempts: [
      { runId: "run_3", outcome: "unrecorded", via: "opencode/glm", startedAt: Date.now() - 120000, fallbacks: [], tail: [] },
      { runId: "run_2", outcome: "failed", via: "claude", startedAt: 200, seconds: 90, fallbacks: [{ at: 205, reason: "exited silently" }], error: "tests failed", sessionId: "ses_two", tail: ["npm test", "1 failing"] },
      { runId: "run_1", outcome: "unrecorded", via: "grok", startedAt: 100, fallbacks: [], tail: [] },
    ] }; },
  } });
  await env.api.open({ taskId: "fix" }); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { taskId: "fix", projectId: "p" });
  const detail = env.get("task-detail");
  const runs = descendants(detail).filter((element) => element.dataset.runId);
  assert.deepEqual(runs.map((element) => element.dataset.attemptOutcome), ["running", "failed", "unrecorded"]);
  const text = detail.textContent;
  assert.match(text, /Attempts · 3/);
  assert.match(text, /Working now 40%/);
  assert.match(text, /editing save\.js/, "the live run shows its checkpointed output");
  assert.match(text, /claude → retried on opencode/);
  assert.match(text, /tests failed/);
  assert.doesNotMatch(text, /Completion check for this run/, "a live newer run means the task stage no longer describes the older run");
  assert.match(text, /no finish for this run/, "an attempt with no recorded end is never shown as passed or running");
  assert.doesNotMatch(text, /Reported done/);
  env.window.MefiNav.go = (...args) => went.push(args);
  descendants(detail).find((element) => element.dataset.taskAction === "attempt-watch").click();
  descendants(detail).filter((element) => element.dataset.taskAction === "attempt-session")[1].click();
  assert.deepEqual(JSON.parse(JSON.stringify(went)), [["eyes", { sessionId: "ses_live" }], ["explorer", { sessionId: "ses_two" }]]);
});

test("a late attempts read never lands on the newly selected task, and a missing bridge hides the fold", async () => {
  let resolveOld;
  const oldRead = new Promise((resolve) => { resolveOld = resolve; });
  const env = environment({ tasks: [{ id: "old", title: "Old task", status: "open" }, { id: "new", title: "New task", status: "open" }], bridge: {
    tasksAttempts: async ({ taskId }) => taskId === "old" ? oldRead : { ok: true, taskId: "new", attempts: [] },
  } });
  await env.api.open({ taskId: "old" });
  await env.api.open({ taskId: "new" }); await settle();
  resolveOld({ ok: true, taskId: "old", attempts: [{ runId: "run_old", outcome: "failed", via: "grok", error: "Old run should stay out", fallbacks: [], tail: [] }] }); await settle();
  assert.match(env.get("task-detail").textContent, /No runs of this task are recorded yet/);
  assert.doesNotMatch(env.get("task-detail").textContent, /Old run should stay out/);
  const bare = environment({ tasks: [{ id: "only", title: "Only task", status: "open" }] });
  await bare.api.open({ taskId: "only" }); await settle();
  assert.doesNotMatch(bare.get("task-detail").textContent, /Attempts/);
});

test("a task link naming another project does not select a same-id task here", async () => {
  const env = environment({ bridge: {
    tasksList: async () => ({ ok: true, projectId: "p", tasks: [{ id: "shared-id", projectId: "p", title: "This project's task", status: "open" }] }),
  } });
  await env.api.open();
  await env.api.open({ taskId: "shared-id", projectId: "q" }); await settle();
  assert.equal(env.api.state.selected, null);
  assert.doesNotMatch(env.get("task-detail").textContent, /This project's task/);
  await env.api.open({ taskId: "shared-id", projectId: "p" }); await settle();
  assert.equal(env.api.state.selected, "shared-id");
});

test("the run a completion check belongs to carries that check's result", async () => {
  const task = { id: "checked", projectId: "p", title: "Checked task", status: "done", doneAt: 300, lastAttempt: { runId: "run_9", at: 300 }, verification: { state: "verified", reason: "checks passed" } };
  const env = environment({ tasks: [task], bridge: {
    tasksAttempts: async () => ({ ok: true, taskId: "checked", attempts: [{ runId: "run_9", outcome: "finished-ok", via: "opencode", startedAt: 200, seconds: 100, fallbacks: [], tail: [] }, { runId: "run_8", outcome: "failed", via: "opencode", startedAt: 100, fallbacks: [], error: "exit 1", tail: [] }] }),
  } });
  await env.api.open({ taskId: "checked" }); await settle();
  const rows = descendants(env.get("task-detail")).filter((element) => element.dataset.runId);
  assert.match(rows[0].textContent, /Reported done[\s\S]*Completion check for this run: /);
  assert.doesNotMatch(rows[1].textContent, /Completion check/);
});

test("live pushes coalesce, leave unchanged rows and details in place, and read the scheduler at most once per 3.5 s", async () => {
  const timers = [], clock = { now: 1_000_000 };
  let reads = 0;
  const running = { id: "run", projectId: "p", title: "Running task", status: "active", runId: "r1", updatedAt: 5, runProgress: { runId: "r1", progress: 0.1 } };
  const other = { id: "other", projectId: "p", title: "Other task", status: "open", updatedAt: 4 };
  const env = environment({ tasks: [running, other], timers, clock, bridge: { backlogStatus: async () => { reads += 1; return { ok: true, projectId: "p", taskStates: [] }; } } });
  await env.api.open({ taskId: "other" }); await settle();
  assert.equal(reads, 1, "opening reads the scheduler once");
  const list = env.get("task-list"), detail = env.get("task-detail");
  const row = list.children[0], meta = detail.children[0];
  assert.match(row.textContent, /Running task/);
  // An executor checkpoint: only runProgress moved, and only the running
  // task's own detail would show it.
  clock.now += 1000;
  env.broadcast([{ ...running, runProgress: { runId: "r1", progress: 0.2 } }, other]); await settle();
  assert.equal(list.children[0], row, "a progress-only push leaves the list's rows in place");
  assert.equal(detail.children[0], meta, "and the detail of another task in place");
  assert.equal(reads, 1, "a push inside 3.5 s of the last scheduler read does not read it again");
  const backlogTimers = timers.filter((timer) => timer.delay > 250);
  assert.equal(backlogTimers.length, 1, "one trailing scheduler read is due instead");
  // Two real changes right after the first paint share one trailing paint.
  env.broadcast([{ ...running, title: "Renamed task" }, other]);
  env.broadcast([{ ...running, title: "Renamed again" }, other]);
  assert.doesNotMatch(list.textContent, /Renamed/, "pushes inside the 250 ms window wait for the trailing paint");
  const paints = timers.filter((timer) => timer.delay <= 250);
  assert.equal(paints.length, 1, "pushes inside the window share one trailing paint");
  assert.equal(timers.filter((timer) => timer.delay > 250).length, 1, "and the one queued scheduler read");
  clock.now += 250; paints[0].fn();
  assert.match(list.textContent, /Renamed again/);
  assert.doesNotMatch(list.textContent, /Renamed task/);
  clock.now += 2500; backlogTimers[0].fn(); await settle();
  assert.equal(reads, 2, "the trailing read lands once 3.5 s have passed");
  // A push after a quiet spell paints at once again.
  clock.now += 1000;
  env.broadcast([{ ...running, title: "Renamed a third time" }, other]);
  assert.match(list.textContent, /Renamed a third time/);
});

test("the selected running task's detail follows its live progress while the list stays put", async () => {
  const timers = [], clock = { now: 2_000_000 };
  const running = { id: "run", projectId: "p", title: "Running task", status: "active", runId: "r1", updatedAt: 5, runProgress: { runId: "r1", progress: 0.1, outputTail: ["first line"] } };
  const env = environment({ tasks: [running], timers, clock, bridge: {
    backlogStatus: async () => ({ ok: true, projectId: "p", taskStates: [] }),
    tasksAttempts: async () => ({ ok: true, attempts: [{ runId: "r1", outcome: "unrecorded", startedAt: 1 }] }),
  } });
  await env.api.open({ taskId: "run" }); await settle();
  const list = env.get("task-list"), detail = env.get("task-detail");
  const row = list.children[0];
  assert.match(detail.textContent, /Working now 10%/);
  clock.now += 1000;
  env.broadcast([{ ...running, runProgress: { runId: "r1", progress: 0.4, outputTail: ["first line", "second line"] } }]); await settle();
  assert.equal(list.children[0], row, "the list does not show progress, so it keeps its rows");
  assert.match(detail.textContent, /Working now 40%/, "the live attempt repaints with the checkpoint");
  assert.match(detail.textContent, /second line/);
});

test("a promoted card keeps its from line: the filer's source, or the owner's origin", async () => {
  // Promotion keeps a request's own source now (it used to rewrite it to
  // "a-eyes"), so every roster filer needs a label, and an origin naming the
  // owner says how the owner's own work arrived.
  const cases = [
    [{ source: "fix" }, "from an A-Eyes alert"], [{ source: "audit" }, "from the auditor"], [{ source: "agent" }, "from a builder's hand-off"],
    [{ source: "grow" }, "from the grower"], [{ source: "improver" }, "from the improver"], [{ source: "overseer" }, "from overseer"],
    [{ source: "machine" }, "from the machine monitor"], [{ source: "a-eyes", origin: { kind: "split", by: "owner" } }, "from a split"],
    [{ source: "chat", origin: { kind: "composer", by: "owner" } }, "from the composer"], [{ origin: { kind: "request", by: "audit" } }, "from the auditor"],
  ];
  for (const [fields, expected] of cases) {
    const task = { id: "t", projectId: "p", title: "Promoted card", status: "open", createdAt: Date.now(), ...fields };
    const env = environment({ tasks: [task], bridge: { tasksList: async () => ({ ok: true, projectId: "p", tasks: [task] }) } });
    await env.api.open({ taskId: "t" });
    const meta = descendants(env.get("task-detail")).find((element) => element.className === "muted who task-meta");
    assert.ok(meta?.textContent.endsWith(` · ${expected}`), `${JSON.stringify(fields)} → ${meta?.textContent}`);
  }
});

test("a parent waiting on its follow-ups is not a review, and Drop closes a parked card through the host", async () => {
  const parent = { id: "parent", projectId: "p", title: "Ship the warn tier", status: "awaiting_verification", runId: "run_p", handoffState: { state: "blocked", pending: 1, blocked: 1, childTaskIds: ["child"], reason: "1 delegated task needs review before this parent can finish" } };
  const child = { id: "child", projectId: "p", title: "Wire the toggle", status: "open", parentTaskId: "parent", verifyAttempts: 3, verification: { state: "failed", reason: "outstanding obligations remain" } };
  const checking = { id: "checking", projectId: "p", title: "Checked now", status: "awaiting_verification", runId: "run_c" };
  const calls = [];
  const env = environment({ tasks: [parent, child, checking], bridge: { tasksAction: async (payload) => { calls.push(payload); return { ok: true, task: { ...child, status: "archived", dropped: { at: Date.now(), by: "owner" } } }; } } });
  await env.api.open({ taskId: "parent" });
  assert.equal(env.api.summary().review, 2, "the parked follow-up and the card being checked, not the parent waiting on them");
  assert.equal(env.api.describe(parent).label, "Waiting on follow-ups");
  assert.match(env.get("task-detail").textContent, /waiting on its follow-ups/);
  assert.ok(!env.get("task-status-row").children.some((button) => button.textContent === "Drop"), "a card with a saved run is not dropped");
  const summary = env.api.workflowSummary(parent, { status: { projectId: "p", running: [] } });
  assert.deepEqual([summary.stage, summary.label], ["waiting", "Waiting on follow-ups"]);
  assert.match(summary.blocker, /needs review before this parent can finish/, "Home names the follow-up that holds it");
  env.api.selectTask("child"); await settle();
  env.get("task-status-row").children.find((button) => button.textContent === "Drop").click();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ taskId: "child", projectId: "p", action: "drop" }]);
  const closed = env.api.state.tasks.find((task) => task.id === "child");
  assert.equal(closed.status, "archived");
  assert.equal(env.api.describe(closed).label, "Dropped");
  assert.equal(env.api.state.selected, null, "triage stays on the list instead of following the card to Done");
  assert.equal(env.api.summary().review, 1);
  assert.ok(env.notifications.some((text) => /^Dropped · Wire the toggle/.test(text)));
});
