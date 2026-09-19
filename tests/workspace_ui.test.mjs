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

async function environment() {
  const elements = new Map(); const storage = new Map(); const events = {};
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const el = (name) => get(`workspace-${name}`);
  for (const stage of ["open", "review", "done", "ideas"]) {
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
      mefiStudio: bridge, dispatchEvent() {},
      MefiNav: { list: () => [], go() {} }, MefiIdle: { exit() {} }, MefiBoot: { pollStart() {} },
      MefiTasks: { describe: (task) => ({ stage: task.status === "done" ? "done" : task.status === "awaiting_verification" ? "review" : "open", label: task.status, summary: task.prompt || "" }) },
    },
    document: { body: new Element(), hidden: false, getElementById: get, createElement: (tag) => new Element(tag), addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options?.detail; } },
    setTimeout, clearTimeout, console,
  });
  vm.runInContext(source, context);
  await flush();
  context.window.MefiWorkspace.enter();
  await flush();
  return { workspace: context.window.MefiWorkspace, el, bridge, events, storage, projects };
}

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
