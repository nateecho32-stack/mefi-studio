import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tasks.js", import.meta.url), "utf8");

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

function environment({ tasks = [], filter = "all", saveOk = true, prefsWait = null, bridge = {} } = {}) {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, new Element()); return els.get(id); };
  for (const filter of ["all", "open", "done"]) {
    const button = new Element("button"); button.dataset.filter = filter; get("task-filters").append(button);
  }
  const saved = []; const notifications = []; let onTasks;
  const prefs = { taskFilter: filter, autoReference: false };
  const context = vm.createContext({
    window: {
      mefiStudio: {
        tasksList: async () => ({ ok: true, tasks: structuredClone(tasks) }),
        tasksSave: async (rows) => { saved.push(structuredClone(rows)); return { ok: saveOk }; },
        prefsGet: async () => { if (prefsWait) await prefsWait; return { ok: true, prefs }; },
        prefsSet: async (patch) => { Object.assign(prefs, patch); return { ok: true, prefs }; },
        onTasks: (fn) => { onTasks = fn; },
        ...bridge,
      },
      MefiNav: { setBadge() {}, claim() {}, release() {} },
      MefiBoot: { pollStart() {} }, MefiToast: (text) => notifications.push(text),
    },
    document: { readyState: "loading", getElementById: get, createElement: (tag) => new Element(tag), querySelectorAll: () => [], addEventListener() {} },
    setTimeout() {}, setInterval() {}, console,
  });
  vm.runInContext(source, context);
  const api = context.window.MefiTasks; api.init();
  return { api, get, saved, notifications, broadcast: (rows) => onTasks(rows) };
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
