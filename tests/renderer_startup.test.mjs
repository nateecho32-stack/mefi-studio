import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/boot.js", import.meta.url), "utf8");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let count = 0; count < 20; count += 1) await Promise.resolve(); };

function bootEnvironment({ bridge = {}, reducedMotion = false, domLoading = false } = {}) {
  let now = 0, nextId = 0;
  const timers = new Map(), frames = new Map(), listeners = new Map(), windowListeners = new Map();
  const document = { readyState: domLoading ? "loading" : "complete", hidden: false, activeElement: null };
  class Element {
    constructor(id = "", tagName = "DIV") { this.id = id; this.tagName = tagName; this.hidden = false; this.inert = false; this.children = []; this.dataset = {}; this.attributes = new Map(); this.classes = new Set(); this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name) }; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    append(node) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    focus() { document.activeElement = this; }
  }
  const elements = Object.fromEntries(["layer", "title", "detail", "progress", "count", "steps", "actions", "retry", "continue"].map((name) => ["boot-" + name, new Element("boot-" + name)]));
  const layer = elements["boot-layer"];
  layer.append(elements["boot-retry"]); layer.append(elements["boot-continue"]);
  const main = new Element("main"), alreadyInert = new Element("existing-inert");
  alreadyInert.inert = true;
  Object.assign(document, {
    body: { children: [main, alreadyInert, layer, new Element("", "SCRIPT")] },
    documentElement: new Element(),
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element("", tag.toUpperCase()),
    addEventListener: (name, fn) => listeners.set(name, fn),
  });
  const context = vm.createContext({
    window: {
      mefiStudio: bridge, MefiNav: { noMotion: () => reducedMotion },
      addEventListener: (name, fn) => windowListeners.set(name, fn),
      removeEventListener: (name, fn) => { if (windowListeners.get(name) === fn) windowListeners.delete(name); },
    }, document, performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id), console,
  });
  vm.runInContext(source, context);
  return {
    boot: context.window.MefiBoot, layer, main, alreadyInert, elements, document, listeners, windowListeners,
    async advance(ms) {
      const target = now + ms;
      await flush();
      while (now < target) {
        now = Math.min(now + 16, target);
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
        const callbacks = [...frames.values()]; frames.clear();
        for (const frame of callbacks) frame(now);
        await flush();
      }
    },
    key(key, target = main, extra = {}) {
      const event = { key, target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
      windowListeners.get("keydown")?.(event);
      return event;
    },
  };
}

test("shared reads issue one concurrent IPC, release settled data and retry failures", async () => {
  const result = deferred();
  let calls = 0, answer = result.promise;
  const env = bootEnvironment({ bridge: { tasksList: () => { calls += 1; return answer; } } });
  const first = env.boot.read("tasksList");
  assert.equal(env.boot.read("tasksList"), first);
  await flush(); assert.equal(calls, 1);
  result.resolve({ tasks: [{ id: "old" }] }); await first;
  answer = Promise.resolve({ tasks: [{ id: "new" }] });
  assert.equal((await env.boot.read("tasksList")).tasks[0].id, "new", "settled snapshots are never cached");
  answer = Promise.reject(new Error("store unavailable"));
  await assert.rejects(env.boot.read("tasksList"), /store unavailable/);
  answer = Promise.resolve({ tasks: [] }); await env.boot.read("tasksList");
  assert.equal(calls, 4);
  await assert.rejects(env.boot.read("tasksSave"), /Not a shared read/);
});

test("startup prepares independent steps together and progress only follows real completion", async () => {
  const projects = deferred(), catalog = deferred(), calls = [];
  const env = bootEnvironment();
  let opened = 0;
  const ready = env.boot.run([
    { id: "projects", label: "Projects", load: () => { calls.push("projects"); return projects.promise; } },
    { id: "catalog", label: "Catalog", load: () => { calls.push("catalog"); return catalog.promise; } },
  ], () => { opened++; });
  assert.equal(env.boot.run([], () => { opened += 100; }), ready, "repeated run joins the existing gate");
  await env.advance(800);
  assert.deepEqual(calls, ["projects", "catalog"]);
  assert.equal(env.boot.state().progress, 0, "elapsed time never fabricates progress");
  assert.equal(env.main.inert, true);
  projects.resolve(true); await flush();
  assert.equal(env.boot.state().progress, 50);
  assert.equal(opened, 0); assert.equal(env.layer.hidden, false);
  catalog.resolve(true); await env.advance(240);
  assert.equal(await ready, true); assert.equal(opened, 1);
  assert.equal(env.elements["boot-progress"].value, 100);
  assert.equal(env.main.inert, false);
  assert.equal(env.alreadyInert.inert, true, "pre-existing inert state survives");
  assert.equal(env.layer.hidden, true);
  assert.equal(env.document.documentElement.attributes.has("data-starting"), false);
  assert.equal(env.windowListeners.size, 0);
});

test("Escape, Enter, pointer clicks and shortcuts cannot bypass pending preloads", async () => {
  const env = bootEnvironment();
  env.boot.run([{ id: "wait", label: "Projects", load: () => new Promise(() => {}) }]);
  for (const key of ["Escape", "Enter", " ", "d", "Tab"]) {
    const event = env.key(key); assert.equal(event.stopped, true); assert.equal(event.prevented, true);
  }
  const event = { target: env.main, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  env.windowListeners.get("click")(event);
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  await env.advance(1000);
  assert.equal(env.boot.isActive(), true); assert.equal(env.elements["boot-actions"].hidden, true);
});

test("DOM and reduced-motion readiness replace decorative launch delays", async () => {
  const env = bootEnvironment({ reducedMotion: true, domLoading: true });
  let prepared = 0;
  env.boot.run([{ id: "view", label: "View", load: () => { prepared++; } }]);
  await flush(); assert.equal(prepared, 0);
  env.listeners.get("DOMContentLoaded")();
  await env.advance(80);
  assert.equal(prepared, 1); assert.equal(env.layer.hidden, true);
});

test("failed steps keep controls locked and explicit Retry recovers without stale read promises", async () => {
  let calls = 0;
  const env = bootEnvironment({ reducedMotion: true, bridge: { tasksList: () => ++calls === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true }) } });
  const pending = env.boot.run([{ id: "work", label: "Your work", load: () => env.boot.read("tasksList") }]);
  await env.advance(15200);
  assert.equal(env.boot.state().phase, "error");
  assert.equal(env.boot.state().progress, 0);
  assert.equal(env.main.inert, true); assert.equal(env.elements["boot-actions"].hidden, false);
  assert.equal(env.document.activeElement, env.elements["boot-retry"]);
  env.key("Tab", env.elements["boot-retry"]);
  assert.equal(env.document.activeElement, env.elements["boot-continue"]);
  env.elements["boot-retry"].onclick();
  await env.advance(80);
  assert.equal(calls, 2); assert.equal(await pending, true); assert.equal(env.main.inert, false);
});

test("unavailable results never become Ready and late work cannot reopen an explicitly continued gate", async () => {
  const late = deferred(), env = bootEnvironment({ reducedMotion: true });
  let handoffs = 0, completed;
  const ready = env.boot.run([
    { id: "failed", label: "Projects", load: () => false },
    { id: "late", label: "History", load: () => late.promise },
  ], (value) => { handoffs++; completed = value; });
  await env.advance(15200);
  assert.equal(env.boot.state().phase, "error"); assert.equal(env.boot.state().progress, 0);
  env.elements["boot-continue"].onclick();
  assert.equal(await ready, false); assert.equal(completed, false); assert.equal(handoffs, 1);
  late.resolve(true); await env.advance(500);
  assert.equal(env.boot.state().phase, "partial"); assert.equal(env.main.inert, false); assert.equal(handoffs, 1);
});
