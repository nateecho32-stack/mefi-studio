import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf("async function measureWorkerLag(");
const end = source.indexOf("// The renderer writes localStorage", start);
assert.ok(start >= 0 && end > start, "the host responsiveness sampler is available for behavioral tests");

function viewState() {
  const state = { visible: true, minimized: false, destroyed: false, rendererDestroyed: false };
  const view = {
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    isDestroyed: () => state.destroyed,
    webContents: { isDestroyed: () => state.rendererDestroyed },
  };
  return { state, view };
}

function probeHost() {
  let now = 1000;
  const first = viewState(), calls = [];
  const env = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    window: first.view,
    rendererValue: (script, fallback, timeoutMs) => new Promise((resolve, reject) => { calls.push({ script, fallback, timeoutMs, resolve, reject }); }),
  });
  vm.runInContext(source.slice(start, end), env);
  return { env, state: first.state, calls, advance: (ms) => { now += ms; }, measure: (options) => env.measureWorkerLag(options) };
}

for (const [roundTrip, expected] of [[33, 0], [50, 0], [250, 200]]) {
  test(`a ${roundTrip}ms two-frame response reports ${expected}ms of visible UI lag`, async () => {
    const h = probeHost(), pending = h.measure();
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].script.match(/requestAnimationFrame/g)?.length, 2);
    assert.match(h.calls[0].script, /new Worker/);
    assert.match(h.calls[0].script, /postMessage\(Date\.now\(\) - t0\)/);
    assert.equal(h.calls[0].fallback, null);
    assert.equal(h.calls[0].timeoutMs, 1000);
    h.advance(roundTrip); h.calls[0].resolve({ frames: true });
    assert.equal(await pending, expected);
  });
}

test("a visible renderer timeout is measured as lag and the next forced sample can recover", async () => {
  const h = probeHost(), pending = h.measure();
  h.advance(1000); h.calls[0].resolve(null);
  assert.equal(await pending, 1000);
  const recovered = h.measure({ force: true });
  assert.equal(h.calls.length, 2);
  h.advance(34); h.calls[1].resolve({ frames: true });
  assert.equal(await recovered, 0);
});

test("a script that never completed keeps the 1000ms sentinel as genuine lag evidence", async () => {
  const h = probeHost(), pending = h.measure();
  h.advance(1000); h.calls[0].resolve(null);
  assert.equal(await pending, 1000);
  const wedged = probeHost(), second = wedged.measure();
  wedged.advance(1000); wedged.calls[0].resolve({ workerDriftMs: "not-a-number" });
  assert.equal(await second, 1000, "a non-numeric worker reading cannot be trusted as an alibi");
});

test("an occluded-but-live renderer never reports the 1000ms sentinel as lag", async () => {
  const h = probeHost(), pending = h.measure();
  assert.match(h.calls[0].script, /new Worker/);
  h.advance(180); h.calls[0].resolve({ workerDriftMs: 160 });
  assert.equal(await pending, 0);
  const cached = h.measure();
  assert.equal(await cached, 0, "the throttled reading is cached like any other sample");
});

test("drift or round-trip past the worker's own schedule counts as real lag", async () => {
  const h = probeHost(), pending = h.measure();
  h.advance(300); h.calls[0].resolve({ workerDriftMs: 500 });
  assert.equal(await pending, 300, "worker-side drift alone");
  const h2 = probeHost(), second = h2.measure();
  h2.advance(900); h2.calls[0].resolve({ workerDriftMs: 160 });
  assert.equal(await second, 700, "a main thread wedged after script eval shows in the round trip");
});

test("a refused or failed worker falls back to an unthrottled MessageChannel aliveness check", () => {
  const h = probeHost();
  h.measure();
  const script = h.calls[0].script;
  assert.match(script, /new MessageChannel\(\)/, "the fallback aliveness channel must exist");
  assert.match(script, /catch \{ loopDelay\(\); \}/, "a refused worker construction must fall back to the loop probe, not the sentinel");
  assert.match(script, /worker\.onerror = \(\) => \{ try \{ worker\.terminate\(\); \} catch \{\} loopDelay\(\); \};/, "a failed worker must fall back to the loop probe too");
});

test("a rejected probe clears the in-flight state and allows a fresh measurement", async () => {
  const h = probeHost(), first = h.measure(), joined = h.measure({ force: true });
  assert.equal(h.calls.length, 1);
  h.calls[0].reject(new Error("fixture renderer unavailable"));
  assert.deepEqual(await Promise.all([first, joined]), [1000, 1000]);
  assert.equal(h.env.measureWorkerLag.inFlight, null);
  const next = h.measure({ force: true });
  assert.equal(h.calls.length, 2);
  h.advance(40); h.calls[1].resolve({ frames: true });
  assert.equal(await next, 0);
});

test("hidden, minimized, destroyed and missing renderers do not become lag evidence", async () => {
  for (const key of ["visible", "minimized", "destroyed", "rendererDestroyed", "missing"]) {
    const h = probeHost();
    if (key === "missing") h.env.window = null;
    else h.state[key] = key !== "visible";
    assert.equal(await h.measure({ force: true }), null, key);
    assert.equal(h.calls.length, 0, key);
  }
});

test("completed samples are cached for 750ms while forced and expired reads take a fresh shared sample", async () => {
  const h = probeHost(), first = h.measure();
  h.advance(100); h.calls[0].resolve({ frames: true });
  assert.equal(await first, 50);
  h.advance(749);
  assert.equal(await h.measure(), 50);
  assert.equal(h.calls.length, 1);
  h.advance(1);
  const expired = h.measure(), forced = h.measure({ force: true }), ordinary = h.measure();
  assert.equal(h.calls.length, 2, "all concurrent calls share the pending fresh sample");
  h.advance(250); h.calls[1].resolve({ frames: true });
  assert.deepEqual(await Promise.all([expired, forced, ordinary]), [200, 200, 200]);
  const refresh = h.measure({ force: true }), joined = h.measure({ force: true });
  assert.equal(h.calls.length, 3, "force bypasses the completed cache but does not duplicate an in-flight probe");
  h.advance(33); h.calls[2].resolve({ frames: true });
  assert.deepEqual(await Promise.all([refresh, joined]), [0, 0]);
});

test("hiding a window clears its cached lag before a visible window is sampled again", async () => {
  const h = probeHost(), first = h.measure();
  h.advance(250); h.calls[0].resolve({ frames: true });
  assert.equal(await first, 200);
  h.state.visible = false;
  assert.equal(await h.measure(), null);
  h.state.visible = true;
  const visibleAgain = h.measure();
  assert.equal(h.calls.length, 2, "a hidden window invalidates even a young cache entry");
  h.advance(30); h.calls[1].resolve({ frames: true });
  assert.equal(await visibleAgain, 0);
});

test("a window hidden, minimized or destroyed during a pending probe discards the result", async () => {
  for (const key of ["visible", "minimized", "destroyed", "rendererDestroyed"]) {
    const h = probeHost(), pending = h.measure();
    h.state[key] = key !== "visible";
    h.advance(1000); h.calls[0].resolve(null);
    assert.equal(await pending, null, key);
    assert.equal(h.env.measureWorkerLag.cache, undefined, key);
    assert.equal(h.env.measureWorkerLag.inFlight, null, key);
  }
});

test("a replaced window's stale probe cannot clear or populate the replacement's in-flight sample", async () => {
  const h = probeHost(), previous = h.measure();
  h.env.window = viewState().view;
  const replacement = h.measure();
  assert.equal(h.calls.length, 2);
  h.advance(20); h.calls[0].resolve({ frames: true });
  assert.equal(await previous, null);
  const joined = h.measure({ force: true });
  assert.equal(h.calls.length, 2, "the old probe's finally must not clear the replacement's pending request");
  h.advance(14); h.calls[1].resolve({ frames: true });
  assert.deepEqual(await Promise.all([replacement, joined]), [0, 0]);
  assert.equal(h.env.measureWorkerLag.cache.view, h.env.window);
});
