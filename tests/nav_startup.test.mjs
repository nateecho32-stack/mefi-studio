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
  const env = vm.createContext({ get: () => ({ kind: "overlay", open: () => open.promise }), document: { getElementById: () => null } });
  vm.runInContext(source.slice(source.indexOf("  function go("), source.indexOf("  function toggle(")), env);
  assert.equal(env.go("tasks"), open.promise);
});
