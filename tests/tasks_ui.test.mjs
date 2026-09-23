import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tasks.js", import.meta.url), "utf8");
const groupsSource = await readFile(new URL("../renderer/task-groups.js", import.meta.url), "utf8");
const stageSource = await readFile(new URL("../renderer/stage-labels.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attrs = {};
    this.hidden = false; this.value = ""; this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach((n) => classes.add(n)), contains: (n) => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) };
  }
  set textContent(text) { this.ownText = String(text); this.children = []; }
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
  scrollIntoView() { this.scrolled = true; }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this, stopPropagation() {}, preventDefault() {} }); }
}

function environment({ tasks = [], filter = "all", saveOk = true, prefsWait = null, bridge = {}, overview = false } = {}) {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, new Element()); return els.get(id); };
  for (const filter of ["all", "open", "done"]) {
    const button = new Element("button"); button.dataset.filter = filter; get("task-filters").append(button);
  }
  const saved = []; const notifications = []; const events = []; let onTasks, onProjects;
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
        ...bridge,
      },
      MefiNav: { setBadge() {}, claim() {}, release() {} },
      MefiBoot: { pollStart() {} }, MefiToast: (text) => notifications.push(text),
      dispatchEvent: (event) => { events.push(event); return true; },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document: { readyState: "loading", getElementById: get, createElement: (tag) => new Element(tag), querySelectorAll: () => [], addEventListener() {} },
    setTimeout() {}, setInterval() {}, console,
  });
  vm.runInContext(stageSource, context);
  if (overview) vm.runInContext(groupsSource, context);
  vm.runInContext(source, context);
  const api = context.window.MefiTasks; api.init();
  return { api, get, window: context.window, saved, notifications, events, broadcast: (rows) => onTasks(rows), project: (activeId) => onProjects({ activeId }) };
}

const rows = [
  { id: "open", title: "Upcoming task", status: "open", updatedAt: 100 },
  { id: "done", title: "Visible finished task", status: "done", doneAt: 200, updatedAt: 200, verification: { state: "verified", reason: "2 files changed" }, lastAttempt: { result: { parts: { done: "Saved project settings" } } } },
  { id: "archived", title: "Older finished task", status: "archived", doneAt: 50, updatedAt: 400 },
  { id: "verify", title: "Finished worker", status: "awaiting_verification", updatedAt: 300 },
  { id: "review", title: "Needs a check", status: "open", verification: { state: "failed", reason: "No completion evidence" } },
];

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

test("failed task saves do not leave a fake task in the board", async () => {
  const env = environment({ tasks: [], saveOk: false });
  const created = await env.api.addTask("This must be saved");
  assert.equal(created, null);
  assert.equal(env.api.state.tasks.length, 0);
  assert.match(env.notifications.at(-1), /could not be written/);
});

test("creating a task announces the walkthrough event, and a failed save never does", async () => {
  const ok = environment({ tasks: [] });
  const created = await ok.api.addTask("Announce me");
  assert.ok(created);
  assert.deepEqual(ok.events.map((event) => event.type), ["mefi:task-created"]);
  assert.equal(ok.events[0].detail.taskId, created.id);
  const failed = environment({ tasks: [], saveOk: false });
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
