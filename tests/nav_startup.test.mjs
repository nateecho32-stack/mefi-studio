import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const resumeSource = source.slice(source.indexOf("// Every store access"), source.indexOf("// ---- boot"));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await Promise.resolve(); };

function fixture(saved, { loading = false } = {}) {
  const store = new Map([["mefiStudio.resume", typeof saved === "string" ? saved : JSON.stringify(saved)]]);
  const frames = [], timers = [], calls = [], elements = new Map(), listeners = new Map();
  const document = {
    readyState: loading ? "loading" : "complete", body: {}, activeElement: null,
    getElementById: (id) => elements.get(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
  };
  document.activeElement = document.body;
  const sheets = new Map([["tasks", {}], ["explorer", {}]]);
  const window = {
    MefiBooklet: { showTab: (tab) => calls.push(["tab", tab]) },
    MefiIdle: { enter: (manual, state) => calls.push(["command", manual, state]) },
    MefiWorkspace: { enter: () => calls.push(["workspace"]) },
  };
  const env = vm.createContext({
    window, document, Date, Event, RESUME_KEY: "mefiStudio.resume", FIELD_SELECTOR: "input, textarea",
    localStorage: { getItem: (key) => store.get(key), removeItem: (key) => store.delete(key) },
    get: (id) => sheets.get(id), go: (id, options) => calls.push(["sheet", id, options]),
    requestAnimationFrame: (fn) => { frames.push(fn); }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); },
  });
  vm.runInContext(resumeSource, env);
  return { env, document, window, store, frames, timers, calls, elements, sheets,
    domReady() { document.readyState = "interactive"; listeners.get("DOMContentLoaded")?.(); },
    async paint() { for (let pass = 0; pass < 2; pass += 1) { for (const fn of frames.splice(0)) fn(); await settle(); } },
  };
}

test("startup restoration waits for DOM, Command data, sheet loading and paint before releasing saved details", async () => {
  const host = fixture({ at: Date.now(), command: { active: true, zoom: 1.7 }, sheet: "tasks",
    tasks: { taskId: "task-7", filter: "all" }, fields: { draft: "keep this draft" }, scroll: { draft: 42 }, focus: "draft" }, { loading: true });
  const command = deferred(), sheet = deferred(), sheetReady = deferred();
  host.window.MefiIdle.ready = () => command.promise;
  host.sheets.get("tasks").ready = sheetReady.promise;
  host.env.go = (id, options) => { host.calls.push(["sheet", id, options]); return sheet.promise; };
  let inert = true, inputs = 0;
  const draft = { id: "draft", value: "", scrollTop: 0, scrollHeight: 200, clientHeight: 80,
    matches: () => true, dispatchEvent: () => { inputs += 1; }, focus: () => { if (!inert) host.document.activeElement = draft; } };
  host.elements.set("draft", draft);
  const loader = { id: "startup-loading" };
  host.document.activeElement = loader;
  const pending = host.env.resumeReady();
  let done = false;
  pending.then(() => { done = true; });
  await settle();
  assert.equal(host.store.has("mefiStudio.resume"), false, "resume is consumed before any wait");
  assert.equal(host.calls.length, 0, "surfaces are not entered before their DOM exists");
  host.domReady(); await settle();
  assert.equal(host.calls[0][0], "command");
  assert.equal(host.calls[0][2].zoom, 1.7);
  assert.equal(host.calls.length, 1, "sheet waits for actual Command initialization");
  command.resolve(); await settle();
  assert.deepEqual(host.calls[1].slice(0, 2), ["sheet", "tasks"]);
  assert.equal(host.calls[1][2].taskId, "task-7");
  assert.equal(done, false);
  sheet.resolve(); await settle();
  assert.equal(host.frames.length, 0, "the explicit sheet readiness hook also finishes before painting");
  sheetReady.resolve(); await settle();
  assert.equal(draft.value, "");
  await host.paint();
  const result = await pending;
  assert.equal(result.restored, true);
  assert.equal(draft.value, "keep this draft");
  assert.equal(draft.scrollTop, 42);
  assert.equal(inputs, 1);
  assert.equal(host.document.activeElement, loader, "inert preload cannot focus saved content");
  inert = false; result.finish();
  assert.equal(host.document.activeElement, draft, "focus is restored once after the gate releases");
  const nextField = { id: "next" };
  host.document.activeElement = nextField; draft.value = "new writing"; result.finish();
  assert.equal(host.document.activeElement, nextField, "a second finish cannot steal subsequent focus");
  assert.equal(draft.value, "new writing");
  assert.equal(host.timers.length, 0, "startup restoration uses readiness rather than delays");
});

test("workspace restoration awaits enter and readiness and consumes the saved launch only once", async () => {
  const host = fixture({ at: Date.now(), workspace: true });
  const entered = deferred(), ready = deferred();
  host.window.MefiWorkspace.enter = () => { host.calls.push(["workspace"]); return entered.promise; };
  host.window.MefiWorkspace.ready = () => ready.promise;
  const first = host.env.resumeReady();
  const second = await host.env.resumeReady();
  assert.equal(second.restored, false);
  assert.equal(host.calls.length, 1);
  entered.resolve(); await settle();
  assert.equal(host.frames.length, 0);
  ready.resolve(); await settle(); await host.paint();
  assert.equal((await first).restored, true);
});

test("canceling a pending restoration cannot open a late sheet, restore details or steal focus", async () => {
  const host = fixture({ at: Date.now(), command: true, sheet: "tasks", fields: { draft: "saved" }, focus: "draft" });
  const ready = deferred();
  host.window.MefiIdle.ready = () => ready.promise;
  let current = true;
  const draft = { value: "", matches: () => true, dispatchEvent() {}, focus: () => { host.document.activeElement = draft; } };
  host.elements.set("draft", draft);
  const pending = host.env.resumeReady({ isCurrent: () => current });
  await settle();
  assert.equal(host.calls[0][0], "command");
  current = false;
  ready.resolve(); await settle();
  const result = await pending;
  assert.equal(result.restored, false);
  assert.equal(host.calls.length, 1, "canceled restore never navigates to its pending sheet");
  assert.equal(host.frames.length, 0);
  result.finish();
  assert.equal(draft.value, "");
  assert.equal(host.document.activeElement, host.document.body);
});

test("invalid or expired resumes do not hold startup, and empty detail restore respects a current draft", async () => {
  for (const saved of [null, "{broken", { at: Date.now() - 61000, command: true }]) {
    const host = fixture(saved);
    assert.equal((await host.env.resumeReady()).restored, false);
    assert.equal(host.frames.length, 0);
    assert.equal(host.calls.length, 0);
    assert.equal(host.store.has("mefiStudio.resume"), false);
  }
  const host = fixture({ at: Date.now(), fields: { draft: "old draft" } });
  const draft = { value: "already edited", matches: () => true };
  host.elements.set("draft", draft);
  const pending = host.env.resumeReady(); await settle(); await host.paint();
  const result = await pending; result.finish();
  assert.equal(result.restored, false);
  assert.equal(draft.value, "already edited");
});

test("legacy resume retains its synchronous timer contract", () => {
  const host = fixture({ at: Date.now(), command: true, sheet: "tasks" });
  assert.equal(host.env.resume(), true);
  assert.deepEqual(host.timers.map((timer) => timer.ms), [1200, 1500, 1600]);
  assert.equal(host.env.resume(), false);
});

test("navigation carries an overlay open promise back to its startup caller", () => {
  const open = deferred();
  const env = vm.createContext({ get: () => ({ kind: "overlay", open: () => open.promise }), rememberRoute() {}, closeHelpMenu() {}, taskProjectId: null, taskContext: () => null, window: {}, document: { documentElement: {dataset:{}}, getElementById: () => null } });
  vm.runInContext(source.slice(source.indexOf("  function go("), source.indexOf("  function toggle(")), env);
  assert.equal(env.go("tasks"), open.promise);
});

function taskNavigation() {
  const store = new Map(), calls = [], events = [];
  const window = { MefiTasks: { state: { projectId: "p" } }, MefiWorkspace: { state: { activeId: "p" }, exit() {} }, MefiIdle: { exit() {} }, dispatchEvent: (event) => events.push(event) };
  const destinations = new Map(["tasks", "workspace", "command"].map((id) => [id, { kind: id === "tasks" ? "overlay" : "view", open: (params) => calls.push([id, params]) }]));
  const env = vm.createContext({ window, localStorage: { getItem: (key) => store.get(key), setItem: (key, value) => store.set(key, value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { documentElement: { dataset: {} }, getElementById: () => null },
    get: (id) => destinations.get(id), rememberRoute() {}, closeHelpMenu() {}, closeAll() {}, idleActive: () => false, underlyingView: () => "workspace", state: {}, dispatchNav() {},
  });
  const contextSource = source.slice(source.indexOf("  const taskContexts ="), source.indexOf("  // A record with no key"));
  const goSource = source.slice(source.indexOf("  function go("), source.indexOf("  // The surface under any sheet"));
  vm.runInContext(contextSource + goSource, env);
  return { env, window, store, calls, events };
}

test("task context follows Home, Work and Live while remaining scoped to its project", () => {
  const { env, window, calls, events } = taskNavigation();
  env.selectTask({ taskId: "snake", projectId: "p", title: "Build Snake" });
  env.go("workspace"); env.go("command"); env.go("tasks");
  assert.equal(calls[1][1].selected, "task:snake");
  assert.equal(calls[2][1].taskId, "snake");
  assert.equal(calls[2][1].projectId, "p");
  assert.equal(events.filter((event) => event.type === "mefi:task-context").length, 1, "unchanged context does not cause refresh loops");
  window.MefiWorkspace.state.activeId = "q"; window.MefiTasks.state.projectId = "q";
  env.selectTask({ taskId: "life", projectId: "q", title: "Build Life" });
  env.go("tasks");
  assert.equal(calls.at(-1)[1].taskId, "life");
  assert.equal(env.taskContext("p").taskId, "snake");
  env.go("tasks", { taskId: "foreign", projectId: "p" });
  assert.equal(env.taskContext("p").taskId, "snake", "a rejected cross-project link never rewrites another project's selection");
  env.go("command", { rail: "ask" });
  assert.equal(calls.at(-1)[1].selected, undefined, "an explicit diagnostic route is not replaced by the remembered task");
});

test("dismissing Appearance leaves the live tree without selecting the remembered task", () => {
  const { env, window, calls } = taskNavigation();
  env.selectTask({ taskId: "remembered", projectId: "p" });
  const departures = [];
  window.MefiMusic = { leaveSettingsAppearance: (options) => departures.push(options.keepTree) };
  env.go("command", { preserveSelection: true });
  assert.equal(calls.at(-1)[1].selected, undefined);
  assert.deepEqual(departures, [true]);
  env.go("workspace");
  assert.deepEqual(departures, [true, false], "other destinations stop the settings preview before opening");
});

test("task context reads persisted selection only for its exact project", () => {
  const { env, store } = taskNavigation();
  store.set("mefiStudio.taskContext.p", JSON.stringify({ projectId: "q", taskId: "private" }));
  assert.equal(env.taskContext("p"), null);
  store.set("mefiStudio.taskContext.p", JSON.stringify({ projectId: "p", taskId: "saved", title: "Saved task" }));
  assert.equal(env.taskContext("p").taskId, "saved");
  assert.equal(env.taskContext("q"), null);
  const context = env.taskContext("p"); context.taskId = "mutated";
  assert.equal(env.taskContext("p").taskId, "saved", "callers cannot change the saved navigation state by reference");
});
