import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

async function environment({ classes = [], sessions, todos = [] } = {}) {
  const bodyClasses = new Set(classes), frames = new Map(), documentEvents = new Map(), windowEvents = new Map(), bridgeEvents = {};
  let nextFrame = 0, now = 0, paints = 0, bitmapWrites = 0, bodyObserver, resizeObserver;
  const element = () => ({
    style: {}, clientWidth: 420, clientHeight: 600, append() {}, addEventListener() {},
    setAttribute() {}, removeAttribute() {}, querySelector: () => null,
    classList: { contains: () => false, toggle() {} },
  });
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : key === "clearRect" ? () => { paints += 1; }
      : key === "measureText" ? (text) => ({ width: String(text).length * 7 })
      : () => ({ addColorStop() {} }),
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const canvas = element(), rail = element();
  canvas.getContext = () => ctx;
  for (const dimension of ["width", "height"]) Object.defineProperty(canvas, dimension, { set() { bitmapWrites += 1; } });
  const elements = { "tree-canvas": canvas, "tree-rail": rail, "tree-stats": element() };
  const document = {
    hidden: false, body: { classList: { contains: (name) => bodyClasses.has(name) } },
    getElementById: (id) => elements[id] ?? null, createElement: element,
    addEventListener: (name, callback) => documentEvents.set(name, callback),
  };
  const window = {
    devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
    addEventListener: (name, callback) => windowEvents.set(name, callback),
    mefiStudio: {
      eyesState: async () => ({ ok: true, sessions: sessions ?? [{ id: "s1", title: "Current session", timeUpdated: Date.now() }], todos }),
      assistantState: async () => ({ ok: true, state: { status: "idle", agents: [] } }),
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
  vm.runInContext(source.replace("  window.MefiTree = {", "  window.__pulseCount = () => pulses.length;\n  window.MefiTree = {"), context);
  await window.MefiTree.init();
  return {
    tree: window.MefiTree, window, rail, frames,
    paints: () => paints, bitmapWrites: () => bitmapWrites, pulseCount: window.__pulseCount,
    resize: () => resizeObserver(),
    advance(time) { now = time; return window.MefiTree.advanceAgents(time); },
    async agents(agents) { await window.MefiTree.applyAssistant({ state: { status: "running", agents } }); },
    async activity(data) { bridgeEvents.activity(data); await flush(); },
    hide(hidden) { document.hidden = hidden; documentEvents.get("visibilitychange")(); },
    cover(name, enabled) { if (enabled) bodyClasses.add(name); else bodyClasses.delete(name); bodyObserver(); },
    frame(time) { now = time; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
  };
}

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
