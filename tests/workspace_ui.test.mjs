import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/workspace.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.value = ""; this.hidden = false; this.disabled = false; this.scrollTop = 0; this.clientHeight = 400; this.scrollHeight = 400;
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach((n) => classes.add(n)), remove: (...names) => names.forEach((n) => classes.delete(n)), toggle: (n, on) => on ? classes.add(n) : classes.delete(n), contains: (n) => classes.has(n) };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return (this.ownText ?? "") + this.children.map((child) => child.textContent).join(""); }
  get firstChild() { return this.children[0] || this; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.ownText = ""; this.children = children; }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  async trigger(name, event = {}) { await Promise.all((this.listeners[name] ?? []).map((fn) => fn({ target: this, preventDefault() {}, ...event }))); }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const matches = (node) => selector === "[data-work-filter]" ? !!node.dataset.workFilter
      : selector === "[data-project-id]" ? !!node.dataset.projectId
      : selector === "button" ? node.tagName === "button"
      : selector === "span" ? node.tagName === "span" : false;
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function environment({ timerQueue = null } = {}) {
  const elements = new Map(); const storage = new Map(); const events = {};
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const el = (name) => get(`workspace-${name}`);
  for (const stage of ["all", "open", "review", "done", "ideas"]) {
    const button = new Element("button"); button.dataset.workFilter = stage; button.append(new Element("span")); el("layer").append(button); elements.set(`workspace-${stage}`, button);
  }
  const currentProject = { id: "project-a", name: "Project A", path: "C:/projects/a" };
  const projects = { ok: true, activeId: currentProject.id, projects: [currentProject, { id: "project-b", name: "Project B", path: "C:/projects/b" }] };
  const bridge = {
    projectsList: async () => projects,
    projectsAdd: async () => ({ ...projects, canceled: true }),
    tasksList: async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "original", projectId: "project-a", title: "Original task", status: "open" }] }),
    assistantState: async () => ({ ok: true, state: { projectId: "project-a", messages: [], ai: { keyPresent: true } } }),
    assistantStatus: async () => ({ ok: true, status: { projectId: "project-a", running: [] } }),
    jevStatus: async () => ({ configured: true, enabled: true, phase: "idle", lastSuccessAt: 1 }),
    assistantMessage: async () => ({ ok: false, error: "Connection unavailable" }),
    tasksCreate: async () => ({ ok: true }),
    ideasList: async () => ({ ok: true, ideas: [] }),
    backlogStatus: async () => ({ ok: true, projectId: "project-a", counts: { ready: 1, running: 0, blocked: 0 }, taskStates: [], next: [], paused: false, draining: false }),
    backlogControl: async () => ({ ok: true }),
    onProjects: (fn) => { events.projects = fn; },
    onTasks: (fn) => { events.tasks = fn; },
    onIdeas: (fn) => { events.ideas = fn; },
    onAssistant: (fn) => { events.assistant = fn; },
    onAssistantStatus: (fn) => { events.status = fn; },
  };
  const context = vm.createContext({
    window: {
      mefiStudio: bridge, dispatchEvent() {}, addEventListener() {},
      MefiNav: { list: () => [], go() {} }, MefiIdle: { exit() {} }, MefiBoot: { pollStart() {} },
      MefiTasks: { describe: (task) => ({ stage: task.status === "done" ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status, summary: task.prompt || "" }) },
    },
    document: { body: new Element(), hidden: false, getElementById: get, createElement: (tag) => new Element(tag), addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
    setTimeout: timerQueue ? (fn, delay) => { const timer = { fn, delay }; timerQueue.push(timer); return timer; } : setTimeout,
    clearTimeout: timerQueue ? (timer) => { if (timer) timer.cancelled = true; } : clearTimeout, console,
  });
  vm.runInContext(source, context);
  await flush();
  context.window.MefiWorkspace.enter();
  await flush();
  return { workspace: context.window.MefiWorkspace, el, bridge, events, storage, projects, nav: context.window.MefiNav };
}

test("build mode saves once without changing worker controls and restores the saved value on failure", async () => {
  const env = await environment(); const pending = deferred(); const changes = [];
  let autoBuild = true;
  env.bridge.assistantStatus = async () => ({ ok: true, status: { autoBuild, execute: true, running: [] } });
  env.bridge.assistantAutopilot = (patch) => { changes.push(patch); return pending.promise; };
  await env.workspace.refresh(true);
  assert.equal(env.el("auto-build").checked, true);
  env.el("auto-build").checked = false;
  const save = env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").disabled, true);
  await env.el("auto-build").trigger("change");
  assert.equal(changes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [{ autoBuild: false }]);
  autoBuild = false; pending.resolve({ ok: true, status: { autoBuild: false } }); await save;
  assert.equal(env.el("auto-build").checked, false);
  assert.equal(env.el("build-mode-label").textContent, "Verify first");
  assert.match(env.el("build-mode-note").textContent, /Open Review/);
  env.bridge.assistantAutopilot = async () => ({ ok: false, error: "Settings could not be saved" });
  env.el("auto-build").checked = true; await env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").checked, false);
  assert.match(env.el("feedback").textContent, /Settings could not be saved/);
  autoBuild = true; await env.workspace.refresh(true);
  env.bridge.assistantAutopilot = async () => { autoBuild = false; throw new Error("Unable to persist; current session is held"); };
  env.el("auto-build").checked = false; await env.el("auto-build").trigger("change");
  assert.equal(env.el("auto-build").checked, false, "read the host's immediate hold after a failed persistence attempt");
  assert.match(env.el("feedback").textContent, /Unable to persist/);
});

test("unapproved builds appear in Review and open scope details without approving or prioritizing", async () => {
  const env = await environment(); const routes = []; let mutations = 0;
  env.nav.go = (...args) => routes.push(args);
  env.bridge.backlogControl = async () => { mutations++; return { ok: true }; };
  env.bridge.assistantStatus = async () => ({ ok: true, status: { autoBuild: false, running: [] } });
  env.bridge.backlogStatus = async () => ({ ok: true, counts: { approval: 1, ready: 0 }, taskStates: [{ id: "original", stage: "approval", reason: "Review the scope before building" }], next: [] });
  await env.workspace.refresh(true);
  await env.el("review").trigger("click");
  assert.match(env.el("work-list").textContent, /Awaiting build approval/);
  const review = env.el("work-list").querySelectorAll("button").find((button) => button.textContent === "Review build ↗");
  assert.ok(review); await review.trigger("click");
  assert.equal(routes[0][0], "tasks"); assert.equal(routes[0][1].taskId, "original");
  assert.equal(mutations, 0);
  assert.doesNotMatch(env.el("work-list").textContent, /Do next|Try again/);
  assert.match(env.el("backlog-metrics").textContent, /1to approve/);
  await env.el("mode-work").trigger("click"); env.el("input").value = "A considered new feature";
  await env.el("form").trigger("submit");
  assert.match(env.el("feedback").textContent, /Task added for approval/);
  assert.equal(env.el("review").attrs["aria-pressed"], "true");
});

test("conversation and task drafts stay separate across mode and project changes", async () => {
  const env = await environment();
  env.el("input").value = "A question I am still thinking about";
  await env.el("input").trigger("input");
  await env.el("mode-work").trigger("click");
  assert.equal(env.el("input").value, "");
  env.el("input").value = "Export the garden journal";
  await env.el("input").trigger("input");
  await env.el("mode-chat").trigger("click");
  assert.equal(env.el("input").value, "A question I am still thinking about");
  await env.el("mode-work").trigger("click");
  assert.equal(env.el("input").value, "Export the garden journal");
  env.events.projects({ ...env.projects, activeId: "project-b" });
  await flush();
  assert.equal(env.el("input").value, "");
  assert.equal(env.el("mode-chat").attrs["aria-pressed"], "true");
  env.events.projects(env.projects);
  await flush();
  assert.equal(env.el("mode-work").attrs["aria-pressed"], "true");
  assert.equal(env.el("input").value, "Export the garden journal");
});

test("an unanswered status read cannot freeze refreshed work or prevent recovery", async () => {
  const timerQueue = []; const env = await environment({ timerQueue });
  env.bridge.assistantStatus = () => new Promise(() => {});
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "updated", title: "Fresh task while status hangs", status: "open" }] });
  const refresh = env.workspace.refresh(true);
  await flush();
  const waiting = timerQueue.filter((timer) => timer.delay === 12000 && !timer.cancelled);
  assert.equal(waiting.length, 1);
  waiting[0].fn();
  assert.equal(await refresh, false);
  assert.match(env.el("work-list").textContent, /Fresh task while status hangs/);
  assert.match(env.el("feedback").textContent, /Couldn't refresh activity/);
  assert.equal(env.el("retry").hidden, false);
  env.bridge.assistantStatus = async () => ({ ok: true, status: { running: [] } });
  assert.equal(await env.workspace.refresh(true), true);
  assert.equal(env.el("retry").hidden, true);
});

test("task creation submits once, preserves a later draft, and distinguishes saved work from a failed refresh", async () => {
  const env = await environment(); const pending = deferred(); let calls = 0; let destination;
  env.bridge.tasksCreate = () => { calls += 1; return pending.promise; };
  env.nav.go = (...args) => { destination = args; };
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Create the journal export";
  const submission = env.el("form").trigger("submit");
  await env.el("form").trigger("submit");
  assert.equal(calls, 1);
  env.el("input").value = "A different task for later";
  env.bridge.tasksList = async () => { throw new Error("Read interrupted"); };
  pending.resolve({ ok: true, task: { id: "created" } });
  await submission;
  assert.equal(env.el("input").value, "A different task for later");
  assert.match(env.el("feedback").textContent, /Task added.*couldn't refresh/);
  assert.doesNotMatch(env.el("feedback").textContent, /draft is still here/);
  assert.equal(env.el("created-task").hidden, false);
  assert.equal(env.el("retry").hidden, false);
  await env.el("created-task").trigger("click");
  assert.equal(destination[0], "tasks"); assert.equal(destination[1].taskId, "created");
});

test("the optional task outline retains existing intent and never sends work", async () => {
  const env = await environment(); let calls = 0;
  env.bridge.tasksCreate = async () => { calls += 1; return { ok: true }; };
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Improve the garden journal";
  await env.el("task-outline").trigger("click");
  assert.match(env.el("input").value, /^Improve the garden journal\n\nDone when:/);
  assert.equal(calls, 0);
  assert.equal(env.storage.get("mefiStudio.workspace.draft.project-a.work"), env.el("input").value);
});

test("saved tasks explain disabled workers separately from a paused assistant", async () => {
  const env = await environment();
  env.bridge.assistantStatus = async () => ({ ok: true, status: { execute: false, running: [] } });
  env.bridge.backlogStatus = async () => ({ ok: true, paused: true, counts: {}, taskStates: [] });
  await env.workspace.refresh(true);
  assert.match(env.el("narration").textContent, /Coding workers are off/);
  await env.el("mode-work").trigger("click");
  env.el("input").value = "Export the journal";
  await env.el("form").trigger("submit");
  assert.match(env.el("feedback").textContent, /Work through backlog/);
  assert.doesNotMatch(env.el("feedback").textContent, /Resume/);
});

test("a delayed same-project refresh cannot erase newer task and conversation broadcasts", async () => {
  const env = await environment();
  const tasks = deferred(); const assistant = deferred();
  env.bridge.tasksList = () => tasks.promise;
  env.bridge.assistantState = () => assistant.promise;
  const pending = env.workspace.refresh(true);
  env.events.tasks([{ id: "new", projectId: "project-a", title: "Newly added task", status: "open" }]);
  env.events.assistant({ state: { projectId: "project-a", messages: [{ role: "assistant", id: "reply", text: "Your latest reply", at: 100 }] } });
  tasks.resolve({ ok: true, projectId: "project-a", tasks: [{ id: "old", projectId: "project-a", title: "Stale task", status: "open" }] });
  assistant.resolve({ ok: true, state: { projectId: "project-a", messages: [] } });
  await pending;
  assert.match(env.el("work-list").textContent, /Newly added task/);
  assert.doesNotMatch(env.el("work-list").textContent, /Stale task/);
  assert.match(env.el("thread").textContent, /Your latest reply/);
});

test("the latest forced refresh wins when same-project reads finish out of order", async () => {
  const env = await environment(); const first = deferred();
  env.bridge.tasksList = () => first.promise;
  const oldRead = env.workspace.refresh(true);
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [{ id: "fresh", projectId: "project-a", title: "Fresh snapshot", status: "open" }] });
  await env.workspace.refresh(true);
  first.resolve({ ok: true, projectId: "project-a", tasks: [{ id: "stale", projectId: "project-a", title: "Stale snapshot", status: "open" }] });
  await oldRead;
  assert.match(env.el("work-list").textContent, /Fresh snapshot/);
  assert.doesNotMatch(env.el("work-list").textContent, /Stale snapshot/);
});

test("a failed send preserves the draft and explains the failure", async () => {
  const env = await environment();
  env.el("input").value = "Keep this idea for later";
  await env.el("input").trigger("input");
  await env.el("form").trigger("submit");
  assert.equal(env.el("input").value, "Keep this idea for later");
  assert.equal(env.storage.get("mefiStudio.workspace.draft.project-a"), "Keep this idea for later");
  assert.match(env.el("feedback").textContent, /Connection unavailable/);
  assert.equal(env.el("send").disabled, false);
});

test("another project's snapshot and events cannot replace the visible project", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-b", tasks: [{ id: "foreign", projectId: "project-b", title: "Foreign task", status: "open" }] });
  env.bridge.assistantState = async () => ({ ok: true, state: { projectId: "project-b", messages: [{ id: "foreign-message", role: "assistant", text: "Foreign conversation" }] } });
  await env.workspace.refresh(true);
  env.events.assistant({ state: { projectId: "project-b", messages: [{ role: "assistant", text: "Foreign conversation" }] } });
  env.events.tasks([{ id: "foreign", projectId: "project-b", title: "Foreign task", status: "open" }]);
  assert.match(env.el("work-list").textContent, /Original task/);
  assert.doesNotMatch(env.el("thread").textContent, /Foreign conversation/);
  assert.equal(env.el("project-name").textContent, "Project A");
});

test("Jev errors supersede configured-key status and refresh after Settings changes", async () => {
  const env = await environment();
  env.bridge.jevStatus = async () => ({ configured: true, enabled: true, phase: "error", lastError: "Gateway rejected key", lastSuccessAt: null, nextAt: Date.now() + 60000 });
  await env.workspace.refresh(true);
  assert.doesNotMatch(env.el("jev").textContent, /connected for task intake/i);
  assert.match(env.el("jev").textContent, /error|rejected|retry|attention|unavailable|failed/i);
  env.bridge.jevStatus = async () => ({ configured: true, enabled: false });
  await env.workspace.refresh(true);
  assert.match(env.el("jev").textContent, /paused|disabled/i);
});

test("canceling Add project does not announce that a project was added", async () => {
  const env = await environment();
  await env.el("add-project").trigger("click");
  assert.doesNotMatch(env.el("feedback").textContent, /project added/i);
});

test("failed refresh preserves known work and offers a retry instead of an empty board", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => { throw new Error("Board offline"); };
  await env.workspace.refresh(true);
  assert.match(env.el("work-list").textContent, /Original task/);
  assert.match(env.el("feedback").textContent, /Couldn't refresh work/);
  assert.equal(env.el("retry").hidden, false);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [] });
  await env.el("retry").trigger("click");
  assert.equal(env.el("retry").hidden, true);
  assert.equal(env.el("feedback").textContent, "");
});

test("a large idea backlog is searchable past the initial page and promotes by durable project identity", async () => {
  const env = await environment();
  const ideas = Array.from({ length: 100 }, (_, i) => ({ id: `idea-${i + 1}`, title: `Garden idea ${i + 1}`, detail: i === 99 ? "unusual orchid" : "some detail", at: i + 1, status: "new", projectId: "project-a" }));
  env.bridge.ideasList = async () => ({ ok: true, ideas });
  await env.workspace.refresh(true);
  await env.el("ideas").trigger("click");
  assert.equal(env.el("work-list").children.length, 20);
  assert.match(env.el("show-more").textContent, /80 remaining/);
  await env.el("show-more").trigger("click");
  assert.equal(env.el("work-list").children.length, 40);
  env.el("work-search").value = "unusual orchid";
  await env.el("work-search").trigger("input");
  assert.equal(env.el("work-list").children.length, 1);
  assert.match(env.el("work-list").textContent, /Garden idea 100/);
  let payload;
  env.bridge.backlogControl = async (value) => { payload = value; return { ok: true }; };
  const promote = env.el("work-list").querySelectorAll("button").find((button) => button.dataset.backlogAction === "promote");
  await promote.trigger("click");
  assert.equal(payload.action, "promote");
  assert.equal(payload.ideaId, "idea-100");
  assert.equal(payload.projectId, "project-a");
  assert.equal(env.el("work-search").value, "");
  assert.match(env.el("feedback").textContent, /Idea linked/);
});

test("search exposes matches in other views and All opens tasks and ideas through their own routes", async () => {
  const env = await environment(); const destinations = [];
  env.nav.go = (...args) => destinations.push(args);
  env.bridge.tasksList = async () => ({ ok: true, tasks: [
    { id: "open", title: "Garden paths", status: "open", projectId: "project-a" },
    { id: "finished", title: "Orchid export", status: "done", projectId: "project-a" },
    { id: "foreign", title: "Orchid from elsewhere", status: "done", projectId: "project-b" },
  ] });
  env.bridge.ideasList = async () => ({ ok: true, ideas: [
    { id: "seed", title: "Orchid reminder", status: "new", projectId: "project-a" },
  ] });
  await env.workspace.refresh(true);
  env.el("work-search").value = "orchid";
  await env.el("work-search").trigger("input");
  assert.match(env.el("work-list").textContent, /No matches in queue.*2 matches are available in other views/);
  assert.equal(env.el("all").querySelector("span").textContent, "2");
  assert.equal(env.el("done").querySelector("span").textContent, "1");
  assert.equal(env.el("ideas").querySelector("span").textContent, "1");
  assert.equal(env.el("clear-search").hidden, false);
  const searchAll = env.el("work-list").querySelectorAll("button").find((button) => button.textContent === "Search all work");
  await searchAll.trigger("click");
  assert.equal(env.el("all").attrs["aria-pressed"], "true");
  assert.equal(env.el("work-summary").textContent, "All work · 2 matches");
  assert.doesNotMatch(env.el("work-list").textContent, /elsewhere/);
  const buttons = env.el("work-list").querySelectorAll("button");
  await buttons.find((button) => button.dataset.taskId === "finished").trigger("click");
  await buttons.find((button) => button.dataset.ideaId === "seed").trigger("click");
  assert.equal(destinations[0][0], "tasks"); assert.equal(destinations[0][1].taskId, "finished");
  assert.equal(destinations[1][0], "ideas"); assert.equal(destinations[1][1].ideaId, "seed");
  assert.ok(buttons.find((button) => button.dataset.backlogAction === "promote"));
  await env.el("clear-search").trigger("click");
  assert.equal(env.el("work-search").value, "");
  assert.equal(env.el("work-search").focused, true);
  assert.equal(env.el("clear-search").hidden, true);
  assert.equal(env.el("work-summary").textContent, "All work · 3 items");
});

test("All work searches across pages and updates an empty view when matches arrive elsewhere", async () => {
  const env = await environment();
  const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `t-${i}`, title: `Task ${i}`, status: "open", projectId: "project-a" }));
  env.bridge.tasksList = async () => ({ ok: true, tasks });
  env.bridge.ideasList = async () => ({ ok: true, ideas: [{ id: "idea", title: "Hidden orchid idea", projectId: "project-a" }] });
  await env.workspace.refresh(true);
  await env.el("all").trigger("click");
  assert.equal(env.el("work-summary").textContent, "All work · 20 of 31 items");
  await env.el("show-more").trigger("click");
  assert.equal(env.el("work-summary").textContent, "All work · 31 items");
  assert.match(env.el("work-list").textContent, /Hidden orchid idea/);
  await env.el("open").trigger("click");
  env.el("work-search").value = "later result";
  await env.el("work-search").trigger("input");
  assert.doesNotMatch(env.el("work-list").textContent, /Search all work/);
  env.events.tasks([...tasks, { id: "later", title: "Later result", status: "done", projectId: "project-a" }]);
  assert.match(env.el("work-list").textContent, /1 match is available in other views.*Search all work/);
  await env.el("done").trigger("click");
  assert.equal(env.el("work-summary").textContent, "Done · 1 match");
  assert.match(env.el("work-list").textContent, /Later result/);
});

test("exhausted tasks expose their blocker and explicit retry in Review", async () => {
  const env = await environment();
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", counts: { ready: 0, running: 0, blocked: 1 }, taskStates: [{ id: "original", stage: "blocked", reason: "Verification limit reached; inspect before retrying." }], next: [], draining: false, paused: false });
  await env.workspace.refresh(true);
  await env.el("review").trigger("click");
  assert.match(env.el("work-list").textContent, /Verification limit reached/);
  let payload;
  env.bridge.backlogControl = async (value) => { payload = value; return { ok: true }; };
  const retry = env.el("work-list").querySelectorAll("button").find((button) => button.dataset.backlogAction === "retry");
  assert.ok(retry);
  await retry.trigger("click");
  assert.equal(payload.taskId, "original");
  assert.equal(payload.projectId, "project-a");
});

test("backlog mode starts once, reports failure honestly and can pause without pretending a task finished", async () => {
  const env = await environment();
  const pending = deferred(); const calls = [];
  env.bridge.backlogControl = (value) => { calls.push(value); return pending.promise; };
  const first = env.el("run-backlog").trigger("click");
  await env.el("run-backlog").trigger("click");
  assert.equal(calls.length, 1);
  assert.equal(env.el("run-backlog").disabled, true);
  pending.resolve({ ok: false, error: "Finish the active project switch first." });
  await first;
  assert.match(env.el("feedback").textContent, /Finish the active project switch/);
  assert.equal(env.el("run-backlog").disabled, false);
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", draining: true, paused: false, counts: { ready: 1, running: 0, blocked: 0 }, taskStates: [], next: [] });
  await env.workspace.refresh(true);
  assert.equal(env.el("run-backlog").textContent, "Pause backlog");
  env.bridge.backlogControl = async (value) => { calls.push(value); return { ok: true }; };
  await env.el("run-backlog").trigger("click");
  assert.equal(calls.at(-1).action, "pause");
  assert.match(env.el("feedback").textContent, /Running jobs finish normally/);
});

test("a foreign or failed backlog snapshot never replaces the project's work plan", async () => {
  const env = await environment();
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-b", counts: { ready: 999 }, next: [{ title: "Foreign task" }] });
  await env.workspace.refresh(true);
  assert.doesNotMatch(env.el("backlog-next").textContent, /Foreign task/);
  env.bridge.backlogStatus = async () => { throw new Error("Backlog offline"); };
  await env.workspace.refresh(true);
  assert.match(env.el("backlog-title").textContent, /unavailable/i);
  assert.match(env.el("feedback").textContent, /backlog/);
  assert.equal(env.el("run-backlog").disabled, true);
});

test("dependency waits and grouped work remain visible without offering an unsafe retry", async () => {
  const env = await environment();
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-a", tasks: [
    { id: "waiting", status: "open", title: "Publish the gallery" },
    { id: "grouped", status: "absorbed", title: "Resize thumbnails" },
    { id: "plan", status: "open", title: "Gallery plan" },
  ] });
  env.bridge.backlogStatus = async () => ({ ok: true, projectId: "project-a", counts: { ready: 1, waiting: 1, grouped: 1 }, taskStates: [
    { id: "waiting", stage: "waiting", reason: "Waiting for Gallery plan", dependencies: [{ id: "plan", done: false }] },
    { id: "grouped", stage: "grouped", reason: "Included in Gallery plan", groupId: "plan" },
    { id: "plan", stage: "ready" },
  ], next: [{ title: "Gallery plan" }], paused: true, summary: "Paused. Current workers can finish; new work will wait.", waiting: "Paused. Current workers can finish; new work will wait." });
  await env.workspace.refresh(true);
  assert.match(env.el("work-list").textContent, /Waiting on prerequisites/);
  assert.match(env.el("work-list").textContent, /Waiting for Gallery plan/);
  assert.match(env.el("work-list").textContent, /Included in a plan/);
  assert.match(env.el("work-list").textContent, /View plan/);
  assert.doesNotMatch(env.el("work-list").textContent, /Try again/);
  assert.match(env.el("backlog-metrics").textContent, /1waiting/);
  assert.equal(env.el("backlog-next").textContent, "Up next: Gallery plan");
});
