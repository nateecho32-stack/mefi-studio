import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import profilerModule from "../scripts/performance-profiler.cjs";

const { createPerformanceProfiler, LIMITS } = profilerModule;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  let time = 20_000;
  let metrics = [
    { pid: 881, type: "Browser", cpu: { percentCPUUsage: 12.5 }, memory: { workingSetSize: 204800 }, name: "private-user", serviceName: "private-path" },
    { pid: 882, type: "Tab", cpu: { percentCPUUsage: 24.25 }, memory: { workingSetSize: 102400 } },
  ];
  let failMetrics = false;
  let failMemory = false;
  let reads = 0;
  let clockReads = 0;
  let nextTimer = 0;
  const histogram = { max: 0, enabled: false, enable() { this.enabled = true; }, disable() { this.enabled = false; }, reset() { this.max = 0; } };
  const timers = new Map();
  const profiler = createPerformanceProfiler({
    now: () => { clockReads += 1; return time; },
    wallNow: () => 1_789_855_386_972 + time,
    getAppMetrics: () => { reads += 1; if (failMetrics) throw Error("private-metrics-failure"); return metrics; },
    memoryUsage: () => { if (failMemory) throw Error("private-memory-failure"); return { rss: 268435456 }; },
    createLoopDelay: () => histogram,
    schedule: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    cancel: (id) => timers.delete(id),
  });
  return {
    profiler, timers, histogram,
    advance: (ms) => { time += ms; },
    tick: (ms = 1000) => { time += ms; for (const { callback } of [...timers.values()]) callback(); },
    setMetrics: (value) => { metrics = value; },
    fail: () => { failMetrics = true; failMemory = true; },
    get reads() { return reads; },
    get clockReads() { return clockReads; },
  };
}

test("profiler stays idle until explicitly started and leaves the disabled handler path untouched", async () => {
  const f = fixture();
  const value = { privateResult: "never-record-this" };
  const promised = Promise.resolve(value);
  const fault = new Error("private-error");
  const context = { value };
  assert.equal(f.profiler.wrap("sync", function (argument) { assert.equal(argument, value); return this.value; }).call(context, value), value);
  assert.equal(f.profiler.wrap("async", () => promised)(), promised);
  assert.throws(f.profiler.wrap("throws", () => { throw fault; }), (error) => error === fault);
  assert.equal(f.reads, 0);
  assert.equal(f.clockReads, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.profiler.snapshot(), {
    recording: false, startedAt: null, elapsedMs: 0, samples: [], spans: [], incidents: [], limits: LIMITS,
  });
  await promised;
});

test("samples convert Electron working-set KB and process RSS bytes, with explicit CPU warmup", () => {
  const f = fixture();
  const initial = f.profiler.control("start");
  assert.equal(initial.ok, true);
  assert.equal(initial.recording, true);
  assert.equal(initial.startedAt, 1_789_855_406_972);
  assert.equal(initial.samples[0].at, 0);
  assert.equal(initial.samples[0].cpuPercent, null);
  assert.equal(initial.samples[0].rssMB, 256);
  assert.deepEqual(initial.samples[0].processes, [
    { type: "Browser", cpuPercent: null, memoryMB: 200 },
    { type: "Tab", cpuPercent: null, memoryMB: 100 },
  ]);
  assert.equal([...f.timers.values()][0].delay, 1000);
  f.tick(1125);
  const snapshot = f.profiler.snapshot();
  assert.equal(snapshot.samples[1].cpuPercent, 36.75);
  assert.equal(snapshot.samples[1].hostLagMs, 125);
  assert.equal(snapshot.samples[1].at, 1125);
  assert.deepEqual(snapshot.incidents, [{ at: 1125, kind: "host-lag", name: "Host event loop", durationMs: 125 }]);
  const exported = JSON.stringify(snapshot);
  for (const secret of ["881", "882", "private-user", "private-path", "serviceName", "workingSetSize"]) {
    assert.equal(exported.includes(secret), false, `${secret} is absent from diagnostics`);
  }
});

test("new processes warm up separately and missing metrics are represented as null", () => {
  const f = fixture();
  f.profiler.start();
  f.tick();
  f.setMetrics([{ pid: 999, type: "sensitive-custom-service", cpu: { percentCPUUsage: Infinity }, memory: { workingSetSize: -1 } }]);
  f.tick();
  let latest = f.profiler.snapshot().samples.at(-1);
  assert.deepEqual(latest.processes, [{ type: "Unknown", cpuPercent: null, memoryMB: null }]);
  f.tick();
  assert.equal(f.profiler.snapshot().samples.at(-1).cpuPercent, null);
  f.fail();
  f.tick();
  latest = f.profiler.snapshot().samples.at(-1);
  assert.equal(latest.cpuPercent, null);
  assert.equal(latest.rssMB, null);
  assert.deepEqual(latest.processes, []);
  assert.doesNotMatch(JSON.stringify(f.profiler.snapshot()), /private-.*failure|sensitive-custom-service/);
});

test("event-loop histogram catches stalls between sample deadlines and is disabled on stop", () => {
  const f = fixture();
  assert.equal(f.histogram.enabled, false);
  f.profiler.start();
  assert.equal(f.histogram.enabled, true);
  f.histogram.max = 195e6;
  f.tick();
  assert.equal(f.profiler.snapshot().samples.at(-1).hostLagMs, 175);
  f.tick();
  assert.equal(f.profiler.snapshot().samples.at(-1).hostLagMs, 0, "histogram resets each sample");
  f.profiler.stop();
  assert.equal(f.histogram.enabled, false);
});

test("host samples, process rows and incident history are bounded during long captures", () => {
  const f = fixture();
  f.setMetrics(Array.from({ length: 500 }, (_, pid) => ({ pid, type: "Tab", cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 1024 } })));
  f.profiler.start();
  for (let i = 0; i < 300; i += 1) f.tick(1100);
  const snapshot = f.profiler.snapshot();
  assert.equal(snapshot.samples.length, LIMITS.maxSamples);
  assert.equal(snapshot.samples[0].at, 181 * 1100);
  assert.equal(snapshot.samples.at(-1).processes.length, LIMITS.maxProcesses);
  assert.equal(snapshot.incidents.length, LIMITS.maxIncidents);
  assert.equal(snapshot.incidents[0].at, 241 * 1100);
});

test("stop freezes data and elapsed time; restart begins a new capture with one sampler", () => {
  const f = fixture();
  f.profiler.start();
  f.tick();
  const stopped = f.profiler.control("stop");
  const reads = f.reads;
  assert.equal(stopped.recording, false);
  assert.equal(f.timers.size, 0);
  f.tick(50_000);
  assert.equal(f.reads, reads);
  assert.deepEqual(f.profiler.snapshot(), (({ ok, ...result }) => result)(stopped));
  const fresh = f.profiler.start();
  assert.equal(fresh.elapsedMs, 0);
  assert.equal(fresh.samples.length, 1);
  assert.notEqual(fresh.startedAt, stopped.startedAt);
  f.profiler.start();
  assert.equal(f.timers.size, 1);
});

test("IPC timings retain exact results, receiver and failures without payloads or error strings", async () => {
  const f = fixture();
  const fault = new Error("private-failure-body");
  const secret = { prompt: "private-prompt-body", token: "private-token-body" };
  const context = { value: secret };
  const sync = f.profiler.wrap("tasks:list", function (arg) { assert.equal(arg, secret); f.advance(12); return this.value; });
  const throws = f.profiler.wrap("tasks:save", () => { f.advance(8); throw fault; });
  const rejects = f.profiler.wrap("tasks:action", async () => { f.advance(20); throw fault; });
  const fails = f.profiler.wrap("tasks:action", () => { f.advance(5); return { ok: false, error: "private-returned-error" }; });
  f.profiler.start();
  assert.equal(sync.call(context, secret), secret);
  assert.throws(throws, (error) => error === fault);
  await assert.rejects(rejects(), (error) => error === fault);
  assert.equal(fails().ok, false);
  const snapshot = f.profiler.snapshot();
  assert.deepEqual(snapshot.spans.find((row) => row.name === "tasks:list"), {
    name: "tasks:list", count: 1, totalMs: 12, meanMs: 12, p95Ms: 12, maxMs: 12, errors: 0,
  });
  assert.equal(snapshot.spans.find((row) => row.name === "tasks:save").errors, 1);
  assert.equal(snapshot.spans.find((row) => row.name === "tasks:action").errors, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|prompt|token/);
});

test("async duration measures settlement, and slow IPC creates a bounded incident", async () => {
  const f = fixture();
  const gate = deferred();
  const value = { ok: true };
  f.profiler.start();
  const pending = f.profiler.wrap("catalog:refresh", () => gate.promise)();
  f.advance(432);
  assert.equal(f.profiler.snapshot().spans.length, 0);
  gate.resolve(value);
  assert.equal(await pending, value);
  assert.equal(f.profiler.snapshot().spans[0].meanMs, 432);
  assert.deepEqual(f.profiler.snapshot().incidents, [{ at: 432, kind: "slow-ipc", name: "catalog:refresh", durationMs: 432 }]);
});

test("reset and stop fence pending completions out of a later capture", async () => {
  const f = fixture();
  const gate = deferred();
  f.profiler.start();
  const pending = f.profiler.wrap("before-reset", () => gate.promise)();
  f.tick();
  const reset = f.profiler.control("reset");
  assert.equal(reset.recording, true);
  assert.equal(reset.elapsedMs, 0);
  assert.equal(reset.samples.length, 1);
  assert.equal(f.timers.size, 1);
  gate.resolve("old-value");
  assert.equal(await pending, "old-value");
  assert.equal(f.profiler.snapshot().spans.length, 0);
  const gate2 = deferred();
  const pending2 = f.profiler.wrap("before-stop", () => gate2.promise)();
  f.profiler.stop();
  f.profiler.start();
  gate2.reject(Error("old-error"));
  await assert.rejects(pending2, /old-error/);
  assert.equal(f.profiler.snapshot().spans.length, 0);
  f.profiler.stop();
  const cleared = f.profiler.reset();
  assert.equal(cleared.recording, false);
  assert.equal(cleared.startedAt, null);
  assert.deepEqual(cleared.samples, []);
  assert.equal(f.timers.size, 0);
});

test("p95 uses a bounded recent window while count, total and maximum cover the capture", () => {
  const f = fixture();
  const work = f.profiler.wrap("fixture:duration", (ms) => f.advance(ms));
  f.profiler.start();
  work(1000);
  for (let i = 1; i <= LIMITS.spanSamples; i += 1) work(i);
  const row = f.profiler.snapshot().spans[0];
  assert.equal(row.count, 121);
  assert.equal(row.totalMs, 8260);
  assert.equal(row.maxMs, 1000);
  assert.equal(row.p95Ms, 114);
  assert.equal(row.meanMs, 68.26);
  for (let i = 0; i < LIMITS.maxSpans + 10; i += 1) f.profiler.wrap(`fixture:${i}`, () => {})();
  assert.equal(f.profiler.snapshot().spans.length, LIMITS.maxSpans);
});

test("snapshots are detached, and result getters are never evaluated by diagnostics", () => {
  const f = fixture();
  f.profiler.start();
  const result = { get ok() { throw Error("getter should not run"); } };
  assert.equal(f.profiler.wrap("fixture:getter", () => result)(), result);
  const first = f.profiler.snapshot();
  first.samples[0].processes[0].type = "private-edit";
  first.spans[0].count = 999;
  first.limits.maxSamples = 9000;
  const second = f.profiler.snapshot();
  assert.equal(second.samples[0].processes[0].type, "Browser");
  assert.equal(second.spans[0].count, 1);
  assert.equal(second.limits.maxSamples, 120);
});

test("IPC registration composes once with existing registration and excludes profiler traffic", () => {
  const f = fixture();
  const handlers = new Map();
  const ipc = { handle(channel, handler) { assert.equal(this, ipc); handlers.set(channel, handler); return "registered"; } };
  f.profiler.attachIpc(ipc);
  f.profiler.attachIpc(ipc);
  assert.equal(ipc.handle("tasks:list", () => 42), "registered");
  const control = () => f.profiler.control("reset");
  ipc.handle("performance:control", control);
  ipc.handle("performance:snapshot", () => f.profiler.snapshot());
  assert.equal(handlers.get("performance:control"), control);
  f.profiler.start();
  assert.equal(handlers.get("tasks:list")(), 42);
  handlers.get("performance:snapshot")();
  assert.equal(f.profiler.snapshot().spans.length, 1);
  assert.equal(f.profiler.snapshot().spans[0].count, 1);
});

test("the owning renderer's reload, crash or destruction stops sampling and removes listeners", () => {
  for (const reason of ["did-start-navigation", "destroyed", "render-process-gone"]) {
    const f = fixture();
    const owner = new EventEmitter();
    f.profiler.start(owner);
    owner.emit("did-start-navigation", {}, "local", false, false);
    owner.emit("did-start-navigation", {}, "local#anchor", true, true);
    assert.equal(f.profiler.snapshot().recording, true, "subframes and same-document navigation keep capturing");
    owner.emit(reason, {}, "local", false, true);
    assert.equal(f.profiler.snapshot().recording, false, reason);
    assert.equal(f.timers.size, 0, reason);
    assert.equal(owner.eventNames().length, 0, reason);
  }
});

test("repeated captures transfer lifecycle ownership without leaked listeners", () => {
  const f = fixture();
  const oldOwner = new EventEmitter();
  const newOwner = new EventEmitter();
  f.profiler.start(oldOwner);
  f.profiler.start(newOwner);
  assert.equal(oldOwner.eventNames().length, 0);
  oldOwner.emit("destroyed");
  assert.equal(f.profiler.snapshot().recording, true);
  f.profiler.reset();
  assert.equal(newOwner.listenerCount("destroyed"), 1);
  f.profiler.stop();
  assert.equal(newOwner.eventNames().length, 0);
  assert.equal(f.profiler.control("unknown").ok, false);
  assert.equal(f.timers.size, 0);
});

test("preload exposes only explicit profiler control and snapshot IPC methods", async () => {
  const source = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  let bridge;
  const calls = [];
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); }, on: () => {} },
      };
    },
  });
  await bridge.performanceControl({ action: "start" });
  await bridge.performanceSnapshot();
  assert.deepEqual(calls, [["performance:control", { action: "start" }], ["performance:snapshot"]]);
});
