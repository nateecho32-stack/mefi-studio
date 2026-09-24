import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { organize } from "../scripts/assistant.mjs";

const source = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const MINUTE = 60000, HOUR = 60 * MINUTE;

async function environment({ classes = [], sessions, todos = [], profiler, assistant } = {}) {
  const bodyClasses = new Set(classes), frames = new Map(), documentEvents = new Map(), windowEvents = new Map(), bridgeEvents = {};
  let nextFrame = 0, now = 0, paints = 0, bitmapWrites = 0, stateReads = 0, bodyObserver, resizeObserver, paintError;
  const element = () => ({
    style: {}, clientWidth: 420, clientHeight: 600, append() {}, addEventListener() {},
    setAttribute() {}, removeAttribute() {}, querySelector: () => null,
    classList: { contains: () => false, toggle() {} },
  });
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : key === "clearRect" ? () => { if (paintError) throw paintError; paints += 1; }
      : key === "measureText" ? (text) => ({ width: String(text).length * 7 })
      : () => ({ addColorStop() {} }),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const canvas = element(), rail = element();
  canvas.getContext = () => ctx;
  for (const dimension of ["width", "height"]) Object.defineProperty(canvas, dimension, { set() { bitmapWrites += 1; } });
  const elements = { "tree-canvas": canvas, "tree-rail": rail, "tree-stats": element() };
  const bodyData = {};
  const document = {
    hidden: false, body: { dataset: bodyData, classList: { contains: (name) => bodyClasses.has(name) } },
    getElementById: (id) => elements[id] ?? null, createElement: element,
    addEventListener: (name, callback) => documentEvents.set(name, callback),
  };
  const window = {
    MefiProfiler: profiler,
    devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    mefiStudio: {
      eyesState: async () => { stateReads += 1; return { ok: true, sessions: sessions ?? [{ id: "s1", title: "Current session", timeUpdated: Date.now() }], todos }; },
      assistantState: async () => ({ ok: true, state: assistant ?? { status: "idle", agents: [] } }),
      eyesCheckpointsRead: async () => ({ checkpoints: {} }),
      onEyesActivity: (callback) => { bridgeEvents.activity = callback; },
      onAssistant() {}, onCheckpoints() {},
    },
  };
  const context = vm.createContext({
    window, document, console, performance: { now: () => now },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (callback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    MutationObserver: class { constructor(callback) { bodyObserver = callback; } observe() {} },
    ResizeObserver: class { constructor(callback) { resizeObserver = callback; } observe() {} },
  });
  vm.runInContext(source.replace("  window.MefiTree = {", "  window.__pulseCount = () => pulses.length;\n  window.__pulsesLive = () => pulses.every((pulse) => nodes.includes(pulse.from) && nodes.includes(pulse.to));\n  window.MefiTree = {"), context);
  await window.MefiTree.init();
  return {
    tree: window.MefiTree, window, rail, frames,
    paints: () => paints, bitmapWrites: () => bitmapWrites, stateReads: () => stateReads, pulseCount: window.__pulseCount, pulsesLive: window.__pulsesLive,
    resize: () => resizeObserver(),
    failPaint(error) { paintError = error; },
    advance(time) { now = time; return window.MefiTree.advanceAgents(time); },
    async agents(agents) { await window.MefiTree.applyAssistant({ state: { status: "running", agents } }); },
    async activity(data) { bridgeEvents.activity(data); await flush(); },
    hide(hidden) { document.hidden = hidden; documentEvents.get("visibilitychange")(); },
    cover(name, enabled) { if (enabled) bodyClasses.add(name); else bodyClasses.delete(name); bodyObserver(); },
    sheet(id) { if (id) bodyData.sheet = id; else delete bodyData.sheet; bodyObserver(); },
    frame(time) { now = time; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
  };
}

test("the real rail profiles completed work only and closes its scope after a paint failure", async () => {
  const started = [], completed = [], stack = [];
  const profiler = {
    begin(name) { const token = { name }; started.push(name); stack.push(token); return token; },
    end(token) { assert.equal(stack.pop(), token, "renderer timing scopes must close in order"); completed.push(token.name); },
  };
  const env = await environment({ classes: ["workspace-active"], profiler });
  assert.ok(started.includes("tree.graph"), "covered graph updates still receive causal timings");
  assert.equal(started.includes("tree.frame"), false);
  assert.deepEqual(completed, started);
  env.cover("workspace-active", false);
  env.frame(1);
  assert.equal(started.filter((name) => name === "tree.frame").length, 1);
  env.frame(17);
  assert.equal(started.filter((name) => name === "tree.frame").length, 1, "throttled RAF callbacks must not dilute draw timings");
  const error = new Error("paint fixture failed");
  env.failPaint(error);
  assert.throws(() => env.frame(34), (caught) => caught === error);
  assert.equal(stack.length, 0, "failed draws cannot corrupt the next sample's scope stack");
  assert.deepEqual(completed, started);
});

test("the real tree rail suspends covered canvases and resumes a single fresh frame", async () => {
  const env = await environment({ classes: ["workspace-active"] });
  assert.equal(env.frames.size, 0, "Home must not start a hidden animation loop");
  assert.ok(env.tree.snapshot().nodes.some((node) => node.id === "s1"), "graph data stays available to other views");
  await env.activity({ activity: [{ sessionId: "s1" }], todos: true });
  assert.equal(env.frames.size, 0, "a data refresh cannot paint behind Home");
  for (let i = 0; i < 25; i += 1) {
    env.cover("workspace-active", false);
    assert.equal(env.frames.size, 1);
    env.cover("workspace-active", true);
    assert.equal(env.frames.size, 0);
  }
  env.cover("workspace-active", false);
  env.frame(1);
  assert.equal(env.paints(), 1, "returning to the rail paints at once");
  env.frame(17);
  assert.equal(env.paints(), 1, "visible ambient frames retain the 30fps cap");
  env.frame(34);
  assert.equal(env.paints(), 2);
  env.cover("command-active", true);
  assert.equal(env.frames.size, 0);
  env.frame(1000);
  assert.equal(env.paints(), 2);
  env.cover("command-active", false);
  env.sheet("tasks");
  assert.equal(env.frames.size, 0, "a page over the rail (hidden by CSS, still sized) stops its loop");
  env.sheet(null);
  assert.equal(env.frames.size, 1, "closing the page resumes it");
  env.hide(true);
  assert.equal(env.frames.size, 0, "minimized windows retain no rail callback");
  env.hide(false);
  env.hide(false);
  assert.equal(env.frames.size, 1, "repeated resume events cannot stack callbacks");
  env.frame(1001);
  assert.equal(env.paints(), 3);
  env.rail.clientWidth = 0;
  env.resize();
  assert.equal(env.frames.size, 0, "a responsive display:none rail is also suspended");
  env.rail.clientWidth = 420;
  env.resize();
  assert.equal(env.frames.size, 1);
});

test("covered rail effects stay bounded while Command advances shared agent flights", async () => {
  const env = await environment();
  await env.activity({ activity: [{ sessionId: "s1" }] });
  assert.ok(env.pulseCount() > 0);
  env.cover("command-active", true);
  assert.equal(env.pulseCount(), 0, "covered rail drops its transient pulse references");
  await env.tree.applyAssistant({ state: { status: "running", agents: [{ role: "watcher", status: "running", targets: [{ kind: "session", id: "s1" }] }] } });
  const first = env.tree.advanceAgents(1000).watcher;
  const second = env.tree.advanceAgents(2000).watcher;
  assert.ok(first && second);
  assert.notDeepEqual([first.x, first.y, first.z], [second.x, second.y, second.z], "Command can move agents without a rail frame");
  for (let i = 0; i < 1000; i += 1) env.tree.advanceAgents(2000 + i * 400);
  await env.activity({ activity: Array.from({ length: 1000 }, () => ({ sessionId: "s1" })) });
  assert.equal(env.pulseCount(), 0, "background activity cannot retain invisible pulse history");
  assert.equal(env.frames.size, 0);
});

test("duplicate resize notifications preserve the bitmap and pixel ratio changes resize it", async () => {
  const env = await environment();
  assert.equal(env.bitmapWrites(), 2, "initialization and pin restoration share the same bitmap");
  for (let i = 0; i < 10; i += 1) env.resize();
  assert.equal(env.bitmapWrites(), 2);
  env.window.devicePixelRatio = 2;
  env.resize();
  assert.equal(env.bitmapWrites(), 4, "moving between monitors still updates the backing resolution");
});

test("large store history is grouped once while visible todo order, caps and edges stay intact", async () => {
  const sessions = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, title: `Session ${i}`, timeUpdated: Date.now() - i }));
  let reads = 0;
  const todos = Array.from({ length: 4000 }, (_, i) => ({
    get sessionId() { reads += 1; return i < 160 ? `s${i % 8}` : "archived"; },
    position: 4000 - i, content: `Todo ${i}`, status: "pending",
  }));
  const env = await environment({ sessions, todos });
  assert.equal(reads, todos.length, "rebuilding cannot rescan all history for every session");
  const snapshot = env.tree.snapshot();
  assert.equal(snapshot.nodes.filter((node) => node.kind === "todo").length, 8 * 14);
  assert.equal(snapshot.nodes.find((node) => node.kind === "todo").label, "Todo 152");
  for (const edge of snapshot.edges) {
    const from = snapshot.nodes[edge.a], to = snapshot.nodes[edge.b];
    assert.ok(from && to);
    if (to.kind === "todo") assert.equal(from.id, to.sessionId);
    else assert.equal(from.id, "__root__");
  }
});

test("finished and briefly missing agents complete their visit, return and fade before leaving", async () => {
  const env = await environment({ classes: ["command-active"] });
  const watcher = { role: "watcher", status: "running", targets: [{ kind: "session", id: "s1" }] };
  await env.agents([watcher, { role: "reference", status: "queued" }]);
  assert.equal(env.tree.agentPositions().reference, undefined, "queued work does not invent a new visible agent");
  assert.equal(env.tree.agentPositions().watcher.opacity, 0, "new work fades in from its home slot");
  const flying = env.advance(325).watcher;
  await env.agents([{ ...watcher, status: "done" }]);
  const stopped = env.tree.agentPositions().watcher;
  assert.deepEqual([stopped.x, stopped.y, stopped.z], [flying.x, flying.y, flying.z], "completion cannot teleport or remove an in-flight agent");
  assert.equal(stopped.retiring, true);
  assert.equal(env.tree.snapshot().nodes.find((node) => node.role === "watcher").retiring, true);
  await env.agents([]);
  assert.ok(env.tree.agentPositions().watcher, "an omitted roster row still completes its current visible visit");
  assert.equal(env.advance(650).watcher.phase, "hovering");
  assert.equal(env.advance(2050).watcher.phase, "returning");
  assert.equal(env.advance(2300).watcher.opacity, 1, "the return stays visible");
  assert.equal(env.advance(2550).watcher.phase, "home");
  const fading = env.advance(2710).watcher;
  assert.ok(fading.opacity > 0 && fading.opacity < 1, "the satellite fades after arriving home");
  assert.equal(env.advance(2870).watcher, undefined);
  assert.ok(!env.tree.snapshot().nodes.some((node) => node.role === "watcher"), "finished visual state also leaves the graph snapshot");
});

test("roster rebuilds and quick restarts retain current coordinates and permanent role slots", async () => {
  const env = await environment({ classes: ["command-active"] });
  const watcher = { role: "watcher", status: "running", targets: ["s1"] };
  const auditor = { role: "auditor", status: "running", targets: ["s1"] };
  await env.agents([watcher, auditor]);
  env.advance(650);
  await env.agents([{ ...watcher, status: "done" }, auditor]);
  env.advance(2050);
  const returning = env.advance(2200).watcher;
  await env.agents([auditor, watcher, { role: "reference", status: "running" }]);
  const restarted = env.tree.agentPositions().watcher;
  assert.deepEqual([restarted.x, restarted.y, restarted.z], [returning.x, returning.y, returning.z]);
  assert.equal(restarted.retiring, false);
  assert.equal(restarted.phase, "flying");
  assert.equal(restarted.slot, 0);
  assert.equal(env.tree.agentPositions().auditor.slot, 1);
  const beforeReload = env.tree.agentPositions();
  await env.tree.reload();
  assert.deepEqual(env.tree.agentPositions(), beforeReload, "store rebuilds preserve all live motion coordinates");
  await env.agents([auditor]);
  env.advance(2850);
  env.advance(4250);
  env.advance(4750);
  env.advance(5070);
  assert.equal(env.tree.agentPositions().watcher, undefined);
  await env.agents([auditor, { role: "builder", status: "running" }, watcher]);
  assert.equal(env.tree.agentPositions().watcher.slot, 0, "a returning role keeps its original home slot");
  assert.equal(env.tree.agentPositions().auditor.slot, 1, "new neighbors cannot reshuffle an active role");
});

test("arrival blends into the orbit and moving task anchors interpolate without jumps", async () => {
  const env = await environment({ classes: ["command-active"] });
  env.tree.setExternalNodes([{ id: "task:target", kind: "task", x: 100, y: 0, z: 0, label: "Current task" }]);
  await env.agents([{ role: "reference", status: "running", targets: ["task:target"] }]);
  const arrived = env.advance(650).reference;
  const hovering = env.advance(651).reference;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(distance(arrived, hovering) < 0.1, "arrival cannot jump by the orbit radius");
  const beforeMove = env.advance(1050).reference;
  env.tree.setExternalNodes([{ id: "task:target", kind: "task", x: 500, y: 0, z: 0, label: "Current task" }]);
  const afterMove = env.advance(1066).reference;
  assert.ok(distance(beforeMove, afterMove) < 50, "a layout update is followed smoothly instead of jumping 400 units");
  for (let time = 1082; time <= 3066; time += 16) env.advance(time);
  assert.ok(env.tree.agentPositions().reference.x > 480, "interpolation still reaches the moved target");
});

test("reduced motion uses stationary target positions and removes settled roles immediately", async () => {
  const env = await environment({ classes: ["command-active", "no-motion"] });
  await env.agents([{ role: "watcher", status: "running", targets: ["s1"] }]);
  const first = env.advance(0).watcher;
  const second = env.advance(1000).watcher;
  assert.deepEqual([first.x, first.y, first.z], [second.x, second.y, second.z]);
  assert.equal(second.opacity, 1);
  await env.agents([{ role: "watcher", status: "done" }]);
  assert.equal(env.advance(1000).watcher, undefined);
});

test("unresolved targets lift off smoothly and repeated status updates preserve their animation", async () => {
  const env = await environment({ classes: ["command-active"] });
  const agent = { role: "reference", status: "running", targets: ["not-in-this-graph"] };
  await env.agents([agent]);
  const start = env.tree.agentPositions().reference;
  const next = env.advance(1).reference;
  assert.ok(Math.hypot(next.x - start.x, next.y - start.y, next.z - start.z) < 0.1, "running in place cannot snap up by the full lift");
  env.advance(300);
  await env.agents([{ ...agent, text: "Still gathering context" }]);
  const settled = env.advance(650).reference;
  const slot = env.tree.snapshot().nodes.find((node) => node.role === "reference");
  assert.equal(settled.phase, "running");
  assert.ok(settled.y < -116, "repeated reports do not restart the lift timer before it reaches working height");
  assert.equal(slot.retiring, false);
});

// The host's organize() classifies sessions; the rail must draw its verdict,
// not re-derive a different one from the todo rows.
test("a stale session draws in the stale tone, never as live work", async () => {
  const now = Date.now();
  const sessions = [
    { id: "live", title: "Live session", timeUpdated: now },
    { id: "rot", title: "Abandoned session", timeUpdated: now - 30 * HOUR },
  ];
  const todos = [
    { sessionId: "live", position: 0, content: "ship it", status: "in_progress" },
    { sessionId: "rot", position: 0, content: "half done", status: "in_progress" },
    { sessionId: "rot", position: 1, content: "never started", status: "pending" },
  ];
  const organization = organize({ sessions, todos, now });
  assert.deepEqual(organization.stale, ["rot"], "fixture: the host calls the quiet in-progress session stale");
  const env = await environment({ sessions, todos, assistant: { status: "idle", agents: [], organization } });
  const nodes = env.tree.snapshot().nodes;
  const rot = nodes.find((node) => node.id === "rot");
  assert.equal(rot.state, "stale", "stale wins over the in_progress todo it still holds");
  assert.equal(rot.stale, true);
  assert.equal(nodes.some((node) => node.kind === "todo" && node.sessionId === "rot"), false, "a stale session draws none of its todos");
  assert.equal(nodes.find((node) => node.id === "live").state, "active", "live work keeps the active tone");
});

test("cancelled todos are closed: they count toward done and dim instead of reading pending", async () => {
  const now = Date.now();
  const sessions = [
    { id: "closed", title: "Wrapped up", timeUpdated: now },
    { id: "mixed", title: "Half left", timeUpdated: now - 1000 },
  ];
  const todos = [
    { sessionId: "closed", position: 0, content: "build it", status: "completed" },
    { sessionId: "closed", position: 1, content: "dropped idea", status: "cancelled" },
    { sessionId: "closed", position: 2, content: "another dropped idea", status: "cancelled" },
    { sessionId: "mixed", position: 0, content: "dropped", status: "cancelled" },
    { sessionId: "mixed", position: 1, content: "still to do", status: "pending" },
  ];
  const env = await environment({ sessions, todos, assistant: { status: "idle", agents: [], organization: organize({ sessions, todos, now }) } });
  const nodes = env.tree.snapshot().nodes;
  const closed = nodes.find((node) => node.id === "closed");
  assert.equal(closed.state, "done", "completed plus cancelled is a finished session");
  assert.equal(closed.progress, 1);
  const cancelled = nodes.filter((node) => node.kind === "todo" && node.status === "cancelled");
  assert.equal(cancelled.length, 3);
  for (const node of cancelled) assert.equal(node.state, "done", "cancelled is closed, not pending");
  const mixed = nodes.find((node) => node.id === "mixed");
  assert.equal(mixed.state, "session", "a pending todo still keeps its session open");
  assert.equal(mixed.progress, 0.5);
  assert.equal(nodes.find((node) => node.kind === "assistant").progress, 4 / 5, "the hub meter counts cancelled rows as closed");
  // The host agrees: once quiet past foldAfterMinutes the finished one folds.
  assert.deepEqual(organize({ sessions: [{ ...sessions[0], timeUpdated: now - 2 * HOUR }], todos, now }).folded, ["closed"]);
  // Closed, but never finished: the rail paints it dim rather than done-green.
  const paint = vm.createContext({ window: {}, agentColor: () => "#ffffff" });
  vm.runInContext(source.slice(source.indexOf("  const COLORS = {"), source.indexOf("  const ASSISTANT_PULSE_KINDS")), paint);
  // colorOf reads the palette the frame resolved; no theme here.
  vm.runInContext("var framePalette = null;", paint);
  vm.runInContext(source.slice(source.indexOf("  function colorOf(node) {"), source.indexOf("  const hexRgb =")), paint);
  const colors = vm.runInContext("COLORS", paint);
  assert.equal(paint.colorOf(cancelled[0]), colors.stale);
  assert.equal(paint.colorOf(nodes.find((node) => node.kind === "todo" && node.status === "completed")), colors.done);
});

test("a scrimmed sheet suspends the rail; Style & sound, which has none, leaves it drawing", async () => {
  const env = await environment();
  assert.equal(env.frames.size, 1);
  env.sheet("tasks");
  assert.equal(env.frames.size, 0, "the Tasks sheet's scrim covers the rail");
  env.frame(1);
  assert.equal(env.paints(), 0);
  await env.activity({ activity: [{ sessionId: "s1" }] });
  assert.equal(env.pulseCount(), 0, "no pulses pile up under a sheet");
  env.sheet(null);
  assert.equal(env.frames.size, 1, "closing the sheet resumes at once");
  env.frame(40);
  assert.equal(env.paints(), 1);
  env.sheet("music");
  assert.equal(env.frames.size, 1, "Style & sound sits beside the rail without a scrim");
  env.frame(80);
  assert.equal(env.paints(), 2);
});

test("activity pushes rebuild from their own todos and read the store only for a new session or after 15 s", async () => {
  const at = Date.now();
  const sessions = [{ id: "s1", title: "First", timeUpdated: at - 600000 }, { id: "s2", title: "Second", timeUpdated: at - 900000 }];
  const todo = (sessionId, position, content, status = "pending") => ({ sessionId, position, content, status });
  const env = await environment({ sessions, todos: [todo("s1", 0, "Old step")] });
  assert.equal(env.stateReads(), 1);
  const labels = () => Array.from(env.tree.snapshot().nodes.filter((node) => node.kind === "todo"), (node) => `${node.sessionId}:${node.label}:${node.status}`);
  assert.deepEqual(labels(), ["s1:Old step:pending"]);
  await env.activity({ activity: [{ sessionId: "s2", time: at - 1000 }], todos: [todo("s1", 0, "Old step", "completed"), todo("s2", 0, "New step", "in_progress")] });
  assert.equal(env.stateReads(), 1, "a push for a known session needs no store read");
  assert.deepEqual(labels(), ["s2:New step:in_progress", "s1:Old step:completed"], "the pushed todos rebuild the graph at once, the touched session now newest");
  assert.equal(env.tree.snapshot().nodes.find((node) => node.id === "s2").updated, at - 1000, "the touched session carries its newest activity");
  assert.equal(env.tree.snapshot().nodes.find((node) => node.id === "s1").updated, at - 600000);
  assert.equal(sessions[1].timeUpdated, at - 900000, "the read's own rows are never edited");
  assert.ok(env.pulseCount() > 0 && env.pulsesLive(), "the push's pulses ride the rebuilt nodes");
  await env.activity({ activity: [{ sessionId: "s9" }], todos: [] });
  assert.equal(env.stateReads(), 2, "a session the rail has not read yet takes a full read");
  await env.activity({ activity: [{ sessionId: "s1" }], todos: true });
  assert.equal(env.stateReads(), 3, "a push without a todo list falls back to the full read");
  env.advance(1000);
  await env.activity({ activity: [{ sessionId: "s1" }], todos: [] });
  assert.equal(env.stateReads(), 3);
  env.advance(1000 + 15000);
  await env.activity({ activity: [{ sessionId: "s1" }], todos: [] });
  assert.equal(env.stateReads(), 4, "sessions are re-read at least every 15 s while activity flows");
  await env.activity({ activity: [{ sessionId: "s1" }] });
  assert.equal(env.stateReads(), 4, "tool activity alone only pulses");
});
