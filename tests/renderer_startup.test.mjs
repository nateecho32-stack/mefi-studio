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

function bootEnvironment({ bridge = {}, ready = Promise.resolve(), reducedMotion = false, domLoading = false } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const frames = new Map();
  const listeners = new Map();
  const classes = new Set();
  const radii = [];
  const layer = {
    hidden: true,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    addEventListener() {}, removeEventListener() {},
  };
  const ctx = new Proxy({}, {
    get: (_, name) => {
      if (name === "measureText") return (label) => ({ width: label.length * 7 });
      if (name === "arc") return (_x, _y, radius) => {
        assert.ok(Number.isFinite(radius) && radius >= 0, `invalid canvas arc radius: ${radius}`);
        radii.push(radius);
      };
      return () => ({ addColorStop() {} });
    },
    set: () => true,
  });
  const elements = {
    "boot-layer": layer,
    "boot-canvas": { style: {}, getContext: () => ctx },
    "boot-title": {}, "boot-count": {},
  };
  const context = vm.createContext({
    window: {
      mefiStudio: bridge,
      MefiIdle: { ready: () => ready },
      MefiNav: { noMotion: () => reducedMotion },
      innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
      addEventListener() {}, removeEventListener() {},
    },
    document: {
      readyState: domLoading ? "loading" : "complete",
      hidden: false,
      getElementById: (id) => elements[id],
      addEventListener: (name, fn) => listeners.set(name, fn),
    },
    performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    console,
  });
  vm.runInContext(source, context);
  return {
    boot: context.window.MefiBoot,
    layer, classes, listeners, radii,
    async advance(ms) {
      const target = now + ms;
      await flush();
      while (now < target) {
        now = Math.min(now + 16, target);
        for (const [id, timer] of [...timers]) {
          if (timer.at > now) continue;
          timers.delete(id);
          timer.fn();
        }
        const callbacks = [...frames.values()];
        frames.clear();
        for (const frame of callbacks) frame(now);
        await flush();
      }
    },
  };
}

test("shared reads issue one concurrent IPC, release settled data and retry failures", async () => {
  const result = deferred();
  let calls = 0;
  let answer = result.promise;
  const env = bootEnvironment({ bridge: { tasksList: () => { calls += 1; return answer; } } });
  const first = env.boot.read("tasksList");
  assert.equal(env.boot.read("tasksList"), first);
  await flush();
  assert.equal(calls, 1);
  result.resolve({ tasks: [{ id: "old" }] });
  await first;
  answer = Promise.resolve({ tasks: [{ id: "new" }] });
  assert.equal((await env.boot.read("tasksList")).tasks[0].id, "new", "settled snapshots are never cached");
  assert.equal(calls, 2);
  answer = Promise.reject(new Error("store unavailable"));
  await assert.rejects(env.boot.read("tasksList"), /store unavailable/);
  answer = Promise.resolve({ tasks: [] });
  await env.boot.read("tasksList");
  assert.equal(calls, 4, "a rejected read cannot poison future attempts");
  await assert.rejects(env.boot.read("tasksSave"), /Not a shared read/, "writes cannot enter the read cache");
});

test("boot starts independent reads together, shares tree reads, and waits for the graph", async () => {
  const assistant = deferred();
  const graph = deferred();
  const calls = [];
  const bridge = Object.fromEntries([
    "assistantState", "eyesState", "tasksList", "ideasList", "eyesRequestsRead", "eyesBriefingRead", "eyesCheckpointsRead", "machineStatus",
  ].map((method) => [method, () => {
    calls.push(method);
    return method === "assistantState" ? assistant.promise : Promise.resolve({ sessions: [] });
  }]));
  const env = bootEnvironment({ bridge, ready: graph.promise });
  let opened = 0;
  env.boot.read("eyesState"); // the rail starts this before the boot layer
  env.boot.run(() => { opened += 1; });
  await flush();
  assert.equal(opened, 1, "Command starts without an artificial timer");
  assert.equal(calls.filter((method) => method === "eyesState").length, 1);
  assert.ok(calls.includes("tasksList") && calls.includes("ideasList"), "assistant latency cannot serialize the other stores");
  assert.ok(!calls.includes("machineStatus"), "decorative startup readers cannot trigger a process scan");
  assistant.resolve({ state: { prefs: {} } });
  await env.advance(900);
  assert.equal(env.classes.has("done"), false, "ready data cannot fade over an unbuilt graph");
  graph.resolve();
  await env.advance(800);
  assert.equal(env.layer.hidden, true);
  assert.equal(env.boot.isActive(), false);
});

test("a ready launch retains its animation but becomes interactive within 1.3 seconds", async () => {
  const env = bootEnvironment();
  env.boot.run(() => {});
  await env.advance(400);
  assert.equal(env.layer.hidden, false);
  assert.ok(env.radii.length > 70, "the starfield and early reader phases render without invalid arc radii");
  await env.advance(900);
  assert.equal(env.layer.hidden, true);
});

test("reduced motion has no mandatory animation delay and DOM readiness replaces the sleep", async () => {
  const env = bootEnvironment({ reducedMotion: true, domLoading: true });
  let opened = 0;
  env.boot.run(() => { opened += 1; });
  await flush();
  assert.equal(opened, 0, "Command requires its DOM initialization");
  env.listeners.get("DOMContentLoaded")();
  await env.advance(80);
  assert.equal(opened, 1);
  assert.equal(env.layer.hidden, true);
});

test("a stalled store cannot hold the startup overlay indefinitely", async () => {
  const env = bootEnvironment({ bridge: { eyesState: () => new Promise(() => {}) }, ready: new Promise(() => {}) });
  env.boot.run(() => {});
  await env.advance(6100);
  assert.equal(env.layer.hidden, true);
});
