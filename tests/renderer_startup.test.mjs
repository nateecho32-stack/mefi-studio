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

function bootEnvironment({ bridge = {}, startup = null, reducedMotion = false, domLoading = false } = {}) {
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
  const elements = Object.fromEntries(["layer", "title", "detail", "progress", "progress-heading", "count", "steps", "actions", "retry", "continue", "choose"].map((name) => ["boot-" + name, new Element("boot-" + name)]));
  const layer = elements["boot-layer"];
  layer.append(elements["boot-retry"]); layer.append(elements["boot-continue"]); layer.append(elements["boot-choose"]);
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
      mefiStudio: bridge, MefiStartup: startup, MefiNav: { noMotion: () => reducedMotion },
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
  catalog.resolve(true); await env.advance(600);
  assert.equal(await ready, true); assert.equal(opened, 1);
  assert.equal(env.elements["boot-progress"].value, 100);
  assert.equal(env.main.inert, false);
  assert.equal(env.alreadyInert.inert, true, "pre-existing inert state survives");
  assert.equal(env.layer.hidden, true);
  assert.equal(env.document.documentElement.attributes.has("data-starting"), false);
  assert.equal(env.windowListeners.size, 0);
});

test("a launch choice runs first with the gate locked and no readiness step reads before it is made", async () => {
  const choice = deferred(), loads = [];
  const env = bootEnvironment({ reducedMotion: true });
  let handoff = null;
  const ready = env.boot.run(
    [{ id: "workspace", label: "Your projects and work", load: () => { loads.push("workspace"); return true; } }],
    (complete, chosen) => { handoff = { complete, chosen }; },
    { choose: () => choice.promise },
  );
  await env.advance(300);
  assert.equal(env.boot.state().phase, "choose");
  assert.deepEqual(loads, [], "the project must be chosen before the workspace is read");
  assert.equal(env.elements["boot-choose"].hidden, false);
  assert.equal(env.elements["boot-progress"].hidden, true);
  assert.equal(env.elements["boot-steps"].hidden, true);
  assert.equal(env.elements["boot-title"].textContent, "Choose a project");
  assert.equal(env.main.inert, true, "the studio stays locked behind the choice");
  const escape = env.key("Escape", env.elements["boot-choose"]);
  assert.equal(escape.prevented, true, "Escape cannot skip the choice");
  choice.resolve({ projectId: "p1", startAgents: true, changed: false });
  await env.advance(300);
  assert.deepEqual(loads, ["workspace"]);
  assert.equal(env.elements["boot-choose"].hidden, true);
  assert.equal(env.elements["boot-progress"].hidden, false);
  assert.equal(await ready, true);
  assert.deepEqual(handoff, { complete: true, chosen: { projectId: "p1", startAgents: true, changed: false } }, "the handoff carries the choice");
  assert.equal(env.main.inert, false);
});

test("a gate without a launch choice and a failing choice both proceed straight to readiness", async () => {
  const plain = bootEnvironment({ reducedMotion: true });
  let opened = 0;
  const ready = plain.boot.run([{ id: "view", label: "View", load: () => true }], (complete, chosen) => { opened += 1; assert.equal(chosen, null); });
  await plain.advance(300);
  assert.equal(await ready, true); assert.equal(opened, 1);
  const failing = bootEnvironment({ reducedMotion: true });
  const loads = [];
  const result = failing.boot.run([{ id: "view", label: "View", load: () => { loads.push("view"); return true; } }], () => {}, { choose: async () => { throw new Error("no host"); } });
  await failing.advance(300);
  assert.deepEqual(loads, ["view"], "a broken choice never strands the launch");
  assert.equal(await result, true);
});

test("the launch gate routes radio arrows and skips unselected projects in its Tab cycle", async () => {
  const keys = [];
  const env = bootEnvironment({ startup: { navigateProjects: (key) => { keys.push(key); return key === "ArrowDown"; } } });
  env.boot.run([], () => {}, { choose: () => new Promise(() => {}) });
  await env.advance(20);
  const radio = { tabIndex: 0, getAttribute: (name) => name === "role" ? "radio" : null, focus: () => { env.document.activeElement = radio; } };
  const unselected = { tabIndex: -1, focus: () => { throw new Error("An unchecked project cannot be a Tab stop"); } };
  const open = { tabIndex: 0, focus: () => { env.document.activeElement = open; } };
  env.elements["boot-choose"].querySelectorAll = () => [unselected, radio, open];
  const arrow = env.key("ArrowDown", radio);
  assert.deepEqual(keys, ["ArrowDown"]);
  assert.equal(arrow.prevented, true);
  assert.equal(arrow.stopped, true, "workspace shortcuts remain locked during selection");
  env.document.activeElement = open;
  env.key("Tab", open);
  assert.equal(env.document.activeElement, radio, "Tab wraps to the selected project only");
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
  assert.equal(env.boot.state().phase, "loading", "a slow or stuck read never blocks before the backstop");
  await env.advance(45200);
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
  assert.equal(env.boot.state().phase, "loading", "slowness alone never flips the gate");
  await env.advance(45200);
  assert.equal(env.boot.state().phase, "error"); assert.equal(env.boot.state().progress, 0);
  env.elements["boot-continue"].onclick();
  assert.equal(await ready, false); assert.equal(completed, false); assert.equal(handoffs, 1);
  late.resolve(true); await env.advance(500);
  assert.equal(env.boot.state().phase, "partial"); assert.equal(env.main.inert, false); assert.equal(handoffs, 1);
});
