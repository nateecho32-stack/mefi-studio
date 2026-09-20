import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf("function startEyesWatch()");
const end = source.indexOf("async function improveFacts(", start);
assert.ok(start > 0 && end > start);

function host() {
  const timers = new Map(), pending = [], events = [], reads = [];
  let nextTimer = 0, project = { id: "first" }, visible = true;
  const eyes = {
    activitySince(options) { reads.push(options.since); return [{ time: 200 }]; },
    listTodos: () => [],
  };
  const context = vm.createContext({
    Date, window: { isMinimized: () => false, isVisible: () => visible },
    projects: { active: () => project, run: (_project, fn) => fn() },
    getEyes: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    send: (...args) => events.push(args),
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`let eyesTimer = null; let eyesWatchGeneration = 0; let eyesLastTs = 100;\n${source.slice(start, end)}`, context);
  return {
    start: context.startEyesWatch, stop: context.stopEyesWatch, timers, pending, events, reads,
    setVisible: (value) => { visible = value; },
    switchProject: () => { project = { id: "second" }; vm.runInContext("eyesLastTs = 150", context); },
    cursor: () => vm.runInContext("eyesLastTs", context),
    fire() { const [id, timer] = timers.entries().next().value; timers.delete(id); return timer.fn(); },
    finish() { pending.shift().resolve(eyes); },
  };
}

test("stopping an in-flight activity read cannot restart polling or publish stale activity", async () => {
  const env = host();
  env.start(); env.start();
  assert.equal(env.timers.size, 1, "repeated start shares the existing watcher");
  const tick = env.fire();
  env.stop(); env.finish(); await tick;
  assert.equal(env.timers.size, 0);
  assert.equal(env.reads.length, 0);
  assert.equal(env.events.length, 0);
  assert.equal(env.cursor(), 100);
});

test("rapid restart retains exactly one poll even if the old request fails later", async () => {
  const env = host();
  env.start(); const old = env.fire();
  env.stop(); env.start(); const fresh = env.fire();
  env.pending.shift().reject(new Error("old module load failed")); await old;
  assert.equal(env.timers.size, 0, "old completion does not schedule a second loop");
  env.finish(); await fresh;
  assert.equal(env.events.length, 1);
  assert.equal(env.events[0][0], "eyes:activity");
  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers.values()][0].ms, 2000);
});

test("project changes discard an obsolete read without skipping the next project's activity", async () => {
  const env = host();
  env.start(); const old = env.fire();
  env.switchProject(); env.finish(); await old;
  assert.equal(env.events.length, 0);
  assert.equal(env.cursor(), 150);
  assert.equal(env.timers.size, 1);
  const fresh = env.fire(); env.finish(); await fresh;
  assert.deepEqual(env.reads, [150]);
  assert.equal(env.cursor(), 200);
});

test("hidden views avoid activity queries, including hiding during an in-flight load", async () => {
  const env = host();
  env.setVisible(false); env.start(); await env.fire();
  assert.equal(env.pending.length, 0);
  assert.equal([...env.timers.values()][0].ms, 5000);
  env.setVisible(true); const tick = env.fire();
  env.setVisible(false); env.finish(); await tick;
  assert.equal(env.reads.length, 0);
  assert.equal(env.events.length, 0);
  assert.equal(env.timers.size, 1);
});

test("an active watcher recovers after a failed read", async () => {
  const env = host();
  env.start(); const failed = env.fire();
  env.pending.shift().reject(new Error("temporarily unavailable")); await failed;
  assert.equal(env.events[0][0], "eyes:error");
  assert.equal(env.timers.size, 1);
  const fresh = env.fire(); env.finish(); await fresh;
  assert.equal(env.events[1][0], "eyes:activity");
  assert.equal(env.timers.size, 1);
});
