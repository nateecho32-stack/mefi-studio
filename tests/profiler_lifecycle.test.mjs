import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [coreSource, panelSource] = await Promise.all([
  readFile(new URL("../renderer/performance-core.js", import.meta.url), "utf8"),
  readFile(new URL("../renderer/profiler.js", import.meta.url), "utf8"),
]);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const reply = (fixtureCapture, recording = true) => ({ ok: true, fixtureCapture, recording, samples: [], spans: [], incidents: [] });

function environment() {
  let now = 0, serial = 0, readCalls = 0;
  const frames = new Map(), intervals = new Map(), timeouts = new Map(), controls = [], downloads = [], observers = [], blobs = new Map();
  const documentEvents = new Map(), windowEvents = new Map(), elements = new Map();
  let controlHandler = ({ action }) => reply(action, action !== "stop");
  let readHandler = () => reply("sample");
  class Element {
    constructor(tag = "div") { this.tag = tag; this.hidden = false; this.disabled = false; this.textContent = ""; this.children = []; this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    getContext() { return null; }
    click() { if (this.tag === "a") downloads.push({ href: this.href, name: this.download }); else this.listeners.get("click")?.({ target: this }); }
    remove() {}
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  get("profiler-overlay").hidden = true;
  get("profiler-hud").hidden = true;
  const document = {
    hidden: false, readyState: "complete", body: new Element(),
    getElementById: get, createElement: (tag) => new Element(tag), createDocumentFragment: () => new Element(),
    addEventListener: (name, callback) => documentEvents.set(name, callback),
  };
  const window = {
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    mefiStudio: {
      performanceControl: (payload) => { controls.push(payload.action); return controlHandler(payload); },
      performanceSnapshot: () => { readCalls++; return readHandler(); },
    },
  };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [1700000000000 + now])); }
    static now() { return 1700000000000 + now; }
  }
  class Observer {
    static supportedEntryTypes = ["longtask"];
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    deliver(duration, startTime) { this.callback({ getEntries: () => [{ duration, startTime }] }); }
  }
  const context = vm.createContext({
    window, document, Date: FixtureDate, performance: { now: () => now }, PerformanceObserver: Observer, Blob,
    URL: { createObjectURL: (blob) => { const url = `blob:fixture-${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL: (url) => blobs.delete(url) },
    requestAnimationFrame: (callback) => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setInterval: (callback) => { const id = ++serial; intervals.set(id, callback); return id; }, clearInterval: (id) => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = ++serial; timeouts.set(id, { callback, delay }); return id; }, clearTimeout: (id) => timeouts.delete(id),
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(panelSource, context);
  return {
    profiler: window.MefiProfiler, frames, intervals, observers, controls, downloads, blobs, get,
    readCalls: () => readCalls,
    readWith(fn) { readHandler = fn; }, controlWith(fn) { controlHandler = fn; },
    at(time) { now = time; },
    frame(time) { now = time; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
    poll(time) { now = time; for (const callback of [...intervals.values()]) callback(); },
    hide(hidden) { document.hidden = hidden; documentEvents.get("visibilitychange")(); },
    pagehide() { windowEvents.get("pagehide")(); },
    timeout(delay) { for (const [id, entry] of [...timeouts]) if (entry.delay === delay) { timeouts.delete(id); entry.callback(); } },
    snapshot: () => JSON.parse(JSON.stringify(window.MefiProfiler.snapshot())),
  };
}

test("profiler starts on request, captures with the panel closed, freezes on stop and clears stopped captures", async () => {
  const env = environment(), p = env.profiler;
  p.open();
  assert.equal(env.frames.size, 0);
  assert.equal(env.intervals.size, 0);
  assert.deepEqual(env.controls, []);
  assert.equal(env.get("profiler-export").disabled, true);
  await p.start();
  assert.equal(env.frames.size, 1);
  assert.equal(env.intervals.size, 1);
  p.close();
  assert.equal(env.get("profiler-hud").hidden, false);
  env.frame(10); env.frame(30);
  assert.equal(env.snapshot().renderer.frameCount, 1);
  const stop = deferred();
  env.controlWith(() => stop.promise);
  const pending = p.stop();
  assert.equal(env.snapshot().renderer.recording, false, "renderer stops without waiting for the host");
  assert.equal(env.frames.size, 0);
  assert.equal(env.intervals.size, 0);
  env.at(2000);
  stop.resolve(reply("stopped", false)); await pending;
  const frozen = env.snapshot();
  env.frame(3000); env.poll(4000);
  assert.deepEqual(env.snapshot(), frozen);
  env.controlWith(() => reply("cleared", false));
  await p.reset(); p.open();
  assert.equal(env.snapshot().renderer.startedAt, null);
  assert.equal(env.snapshot().renderer.frameCount, 0);
  assert.equal(env.get("profiler-export").disabled, true);
  assert.equal(env.get("profiler-status").textContent, "Ready to record");
});

test("old host reads cannot replace a reset capture and reads pause while control is pending", async () => {
  const env = environment(), oldRead = deferred(), reset = deferred();
  await env.profiler.start();
  env.readWith(() => oldRead.promise);
  env.poll(500);
  assert.equal(env.readCalls(), 1);
  env.controlWith(() => reset.promise);
  const pendingReset = env.profiler.reset();
  env.poll(2000);
  assert.equal(env.readCalls(), 1, "a reset must suspend polling while its host response is pending");
  assert.equal(await env.profiler.start(), false, "duplicate controls cannot create another capture while resetting");
  reset.resolve(reply("new-capture")); await pendingReset;
  oldRead.resolve(reply("old-capture")); await flush();
  assert.equal(env.snapshot().host.fixtureCapture, "new-capture");
  assert.equal(env.snapshot().renderer.recording, true);
  assert.equal(env.snapshot().renderer.frameCount, 0);
  env.readWith(() => reply("new-sample")); env.poll(3000); await flush();
  assert.equal(env.snapshot().host.fixtureCapture, "new-sample");
});

test("concurrent polling and export share one host read, then export the measured capture", async () => {
  const env = environment(), read = deferred();
  await env.profiler.start(); env.frame(1); env.frame(18);
  env.readWith(() => read.promise);
  env.poll(500); env.poll(1500); env.poll(2500);
  const exported = env.profiler.exportCapture();
  assert.equal(env.readCalls(), 1);
  assert.equal(env.downloads.length, 0);
  read.resolve(reply("latest"));
  const result = await exported;
  assert.equal(result.host.fixtureCapture, "latest");
  assert.equal(env.downloads.length, 1);
  const json = JSON.parse(await env.blobs.get(env.downloads[0].href).text());
  assert.equal(json.renderer.frameCount, 1);
  assert.equal(json.host.fixtureCapture, "latest");
  env.poll(3500); await flush();
  assert.equal(env.readCalls(), 2, "settling the shared read permits the next sample");
});

test("an export awaiting host data cannot silently switch to a reset or restarted capture", async () => {
  for (const action of ["reset", "start"]) {
    const env = environment(), read = deferred();
    await env.profiler.start();
    env.readWith(() => read.promise);
    const pendingExport = env.profiler.exportCapture();
    env.at(100);
    await env.profiler[action]();
    read.resolve(reply("prior-capture"));
    assert.equal(await pendingExport, null, action);
    assert.equal(env.downloads.length, 0, action);
    assert.equal(env.snapshot().host.fixtureCapture, action);
  }
});

test("hidden renderer sampling resumes without a fake hitch or stale long-task callback", async () => {
  const env = environment();
  await env.profiler.start(); env.frame(0); env.frame(17);
  const beforeHide = env.observers.at(-1);
  env.hide(true);
  assert.equal(env.frames.size, 0);
  assert.equal(env.intervals.size, 0);
  assert.equal(beforeHide.disconnected, true);
  env.at(10000); env.hide(false);
  env.hide(false);
  assert.equal(env.frames.size, 1);
  assert.equal(env.intervals.size, 1);
  beforeHide.deliver(250, 16);
  env.observers.at(-1).deliver(75, 10000);
  env.frame(10001); env.frame(10018);
  const snapshot = env.snapshot().renderer;
  assert.equal(snapshot.frameCount, 2);
  assert.equal(snapshot.hitchCount, 0, "time spent hidden is not a delivered UI-frame gap");
  assert.equal(snapshot.longTaskCount, 1, "disconnected observers cannot add stale events after resume");
  env.pagehide();
  assert.equal(env.snapshot().renderer.recording, false);
  assert.equal(env.frames.size, 0);
  assert.equal(env.intervals.size, 0);
});

test("a timed out host read frees the next read and its late result stays discarded", async () => {
  const env = environment(), timedOut = deferred();
  await env.profiler.start();
  env.readWith(() => timedOut.promise); env.poll(500);
  env.timeout(3000); await flush();
  assert.match(env.snapshot().coverage.hostStatus, /unavailable/i);
  env.readWith(() => reply("recovered")); env.poll(4000); await flush();
  assert.equal(env.readCalls(), 2);
  timedOut.resolve(reply("late-expired")); await flush();
  assert.equal(env.snapshot().host.fixtureCapture, "recovered");
  assert.equal(env.snapshot().coverage.hostStatus, "available");
});
