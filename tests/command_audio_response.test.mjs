import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
function environment(state = {}) {
  const writes = [];
  const env = vm.createContext({
    state, writes, renderMusicStatus() {}, writeStore: (...args) => writes.push(args),
    emphasis: () => 1, rgba: (tint, alpha) => ({ tint, alpha }),
    colorOf: () => [220, 180, 110], NODE_RGB: {
      task: [160, 170, 190], warm: [230, 180, 100],
      pending: [190, 120, 220], session: [100, 200, 240],
    },
    isBusyNode: (node, runningIds) => runningIds.has(node.id), agentRgb: () => [120, 180, 240],
  });
  const start = source.indexOf("  function setAudioResponse(");
  const end = source.indexOf("  function drawFrame(", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), env);
  return env;
}

function recordingContext() {
  const strokes = [];
  let path = [];
  return {
    strokes,
    save() {}, restore() {}, fill() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() { path = []; },
    moveTo: (x, y) => path.push({ type: "move", x, y }),
    lineTo: (x, y) => path.push({ type: "line", x, y }),
    bezierCurveTo: (...values) => path.push({ type: "bezier", values }),
    arc: (...values) => path.push({ type: "arc", values }),
    stroke() { strokes.push({ path: structuredClone(path), color: this.strokeStyle, width: this.lineWidth }); },
  };
}

const plainPoints = (wave) => Array.from(wave.points, ({ x, y }) => ({ x, y }));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const waveform = (phase = 0) => Array.from({ length: 64 }, (_, index) => Math.sin(index / 64 * Math.PI * 6 + phase));
const fullMusic = () => ({ bass: 0.8, bassline: 0.8, mid: 0.65, treble: 0.6, kick: 0.7, snare: 0.55, hat: 0.45, waveform: waveform() });

function graphFixture(nodeLayout = "constellation") {
  const nodes = [
    { id: "hub", kind: "assistant", label: "Assistant", x: 0, y: 0, z: 0 },
    { id: "task:first", kind: "task", label: "First task", state: "running", x: 100, y: 100, z: 0 },
    { id: "task:second", kind: "task", label: "Second task", state: "open", x: 300, y: 100, z: 0 },
    { id: "agent:worker", kind: "agent", role: "worker", status: "running", targetId: "task:first", x: 150, y: 130, z: 0 },
    { id: "music", kind: "music", label: "Local track", x: -100, y: 0, z: 0 },
  ];
  const state = {
    nodes, nodeLayout, audioResponse: 1, music: fullMusic(),
    edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }],
    branchParents: new Map([[nodes[1].id, nodes[0].id], [nodes[2].id, nodes[0].id]]),
    agentLayout: new Map([[nodes[3].id, { hostId: nodes[1].id }]]),
  };
  return { state, env: environment(state), projected: nodes.map(node => ({ node, p: { x: node.x + 200, y: node.y + 100 } })) };
}

test("frequency voices stay attached to nodes across reordering and all bands affect quiet work", () => {
  const env = environment();
  const nodes = [
    { id: "hub", kind: "assistant" }, { id: "session", kind: "session" },
    { id: "todo", kind: "todo" }, { id: "worker", kind: "agent" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `task:${index}`, kind: "task", state: "open" })),
  ];
  const voices = new Map(nodes.map(node => [node.id, env.nodeAudioResponse(node, {}, true).band]));
  assert.equal(new Set(nodes.filter(node => node.kind === "task").map(node => voices.get(node.id))).size, 3);
  for (const node of nodes.reverse()) {
    for (const band of ["bass", "mid", "treble"]) {
      const result = env.nodeAudioResponse(node, { [band]: 0.8 }, true, 1);
      assert.equal(result.band, voices.get(node.id));
      assert.equal(result.level > 0.5, band === voices.get(node.id));
    }
    assert.equal(node.state === "active", false, "music never marks work active");
  }
});

test("silence and disabled/reduced-motion response stay dark; sensitivity is bounded and saved", () => {
  const state = {}, env = environment(state), node = { id: "music", kind: "music" };
  const loud = { bass: 1, mid: 1, treble: 1, beat: 1, energy: 1 };
  for (const [music, enabled] of [[{}, true], [loud, false]]) {
    const response = env.nodeAudioResponse(node, music, enabled);
    assert.equal(response.level, 0); assert.equal(response.beat, 0);
  }
  const quiet = { bass: 0.2, energy: 0.1, beat: 0.15 };
  assert.ok(env.nodeAudioResponse(node, quiet, true, 2).level > env.nodeAudioResponse(node, quiet, true, 0.25).level * 3);
  for (const strength of [0.25, 1, 2, 100]) {
    const response = env.nodeAudioResponse(node, loud, true, strength);
    assert.ok(response.level >= 0 && response.level <= 1);
    assert.ok(response.beat >= 0 && response.beat <= 1);
  }
  env.setAudioResponse(100); assert.equal(state.audioResponse, 2);
  env.setAudioResponse(-1); assert.equal(state.audioResponse, 0);
  env.setAudioResponse(NaN); assert.equal(state.audioResponse, 0);
  assert.equal(env.writes.length, 2);
});

test("music light stays inside each node and graph links retain their endpoints and work tint", () => {
  const a = { id: "hub", kind: "assistant" }, b = { id: "task", kind: "task", _audioResponse: { level: 0.8, beat: 0.5 } };
  const state = { nodes: [a, b], edges: [{ a: 0, b: 1 }], branchParents: new Map([[b.id, a.id]]) };
  const env = environment(state), arcs = [], strokes = [], points = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {},
    arc: (...args) => arcs.push(args),
    createRadialGradient: () => ({ addColorStop() {} }),
    moveTo: (...args) => points.push(args), lineTo: (...args) => points.push(args),
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
  };
  const projected = [{ node: a, p: { x: 10, y: 30 } }, { node: b, p: { x: 100, y: 130 } }];
  const before = structuredClone(projected);
  env.drawNodeAudio(ctx, b, projected[1].p, 11, [100, 150, 200], { level: 1, beat: 1 });
  assert.ok(arcs.length > 0 && arcs.every(([x, y, radius]) => x === 100 && y === 130 && radius <= 11));
  strokes.length = 0;
  env.drawGraphConnections(ctx, projected, new Set(), false);
  const quiet = strokes.pop();
  env.drawGraphConnections(ctx, projected, new Set(), true);
  const musical = strokes.pop();
  assert.ok(musical.color.alpha > quiet.color.alpha && musical.width > quiet.width);
  assert.deepEqual(musical.color.tint, quiet.color.tint);
  assert.deepEqual(points.slice(0, 2), points.slice(2));
  assert.deepEqual(projected, before, "audio cannot move anchors, change labels or assign a work state");
});

test("bass lines, mids, highs and each drum attack bend and animate the actual connection path", () => {
  const env = environment(), a = { x: 20, y: 90 }, b = { x: 420, y: 90 };
  const shapes = [];
  for (const voice of ["bassline", "mid", "treble", "kick", "snare", "hat"]) {
    const music = { [voice]: 0.8 };
    const first = env.audioConnectionWave(a, b, music, 1, 120, false, 0.4);
    const later = env.audioConnectionWave(a, b, music, 1, 360, false, 0.4);
    assert.ok(first && later, `${voice} works without bass energy or a global beat`);
    assert.ok(first.points.some(point => Math.abs(point.y - a.y) > 0.5), `${voice} produces visible displacement`);
    assert.ok(first.points.some((point, index) => distance(point, later.points[index]) > 0.5), `${voice} travels between frames`);
    assert.deepEqual(plainPoints(first).at(0), a);
    assert.deepEqual(plainPoints(first).at(-1), b);
    shapes.push(plainPoints(first));
  }
  for (let index = 1; index < shapes.length; index += 1) {
    assert.notDeepEqual(shapes[index], shapes[index - 1], "frequency and drum voices do not collapse to one common pulse");
  }
  assert.deepEqual(plainPoints(env.audioConnectionWave(a, b, { bass: 0.8 }, 1, 120, false, 0.4)), shapes[0], "bass-only snapshots retain the bass-line voice");
});

test("the measured waveform changes connection and node contours while staying inside the node", () => {
  const env = environment(), a = { x: 50, y: 70 }, b = { x: 390, y: 250 };
  const firstMusic = { ...fullMusic(), waveform: waveform(0) };
  const secondMusic = { ...firstMusic, waveform: waveform(Math.PI) };
  const first = env.audioConnectionWave(a, b, firstMusic, 1, 600, true);
  const second = env.audioConnectionWave(a, b, secondMusic, 1, 600, true);
  assert.ok(first.points.some((point, index) => distance(point, second.points[index]) > 1), "sample data changes geometry at the same time and band levels");
  const node = { id: "task:contour", kind: "task", state: "open" }, p = { x: 200, y: 180 }, radius = 14;
  const before = structuredClone(node), contours = [];
  for (const band of ["bass", "mid", "treble"]) {
    for (const music of [firstMusic, secondMusic]) {
      const ctx = recordingContext();
      env.drawNodeAudio(ctx, node, p, radius, [180, 190, 210], { band, level: 0.9, beat: 0.8 }, music, 600);
      const contour = ctx.strokes.find(stroke => stroke.path.length > 2).path;
      assert.ok(contour.every(point => distance(point, p) < radius), "the waveform preserves the status rim");
      assert.ok(distance(contour[0], contour.at(-1)) < 1e-9, "the orb contour closes without a seam");
      contours.push(contour);
    }
    assert.notDeepEqual(contours.at(-2), contours.at(-1), `${band} contour consumes the live waveform`);
  }
  assert.notDeepEqual(contours[0], contours[2], "midrange attacks produce a different contour from bass");
  assert.notDeepEqual(contours[2], contours[4], "high attacks produce a different contour from midrange");
  assert.deepEqual(node, before);
});

test("linear and branch waves pin endpoints with finite, bounded geometry at awkward lengths", () => {
  const env = environment(), music = fullMusic();
  const pairs = [
    [{ x: 10, y: 30 }, { x: 10, y: 430 }],
    [{ x: 410, y: 430 }, { x: 10, y: 30 }],
    [{ x: -200, y: 30 }, { x: 410, y: 30 }],
    [{ x: 10, y: 30 }, { x: 14, y: 30 }],
    [{ x: 10, y: 30 }, { x: 10.01, y: 30.01 }],
    [{ x: 10, y: 30 }, { x: 10, y: 30 }],
  ];
  for (const [a, b] of pairs) {
    for (const curved of [false, true]) {
      const wave = env.audioConnectionWave(a, b, music, 2, 200, curved);
      if (distance(a, b) < 4) {
        assert.equal(wave, null, "tiny and coincident anchors do not produce unstable waves");
        continue;
      }
      assert.deepEqual(plainPoints(wave)[0], a);
      assert.deepEqual(plainPoints(wave).at(-1), b);
      assert.ok(wave.points.length <= 57, "long links retain a fixed vertex budget");
      const limit = Math.min(22, distance(a, b) * 0.11) * 2;
      for (const [index, point] of wave.points.entries()) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        const t = index / (wave.points.length - 1), u = 1 - t;
        const middle = (a.y + b.y) / 2;
        const base = curved ? {
          x: u ** 3 * a.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * b.x,
          y: u ** 3 * a.y + 3 * u ** 2 * t * middle + 3 * u * t ** 2 * middle + t ** 3 * b.y,
        } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        assert.ok(distance(point, base) <= limit + 1e-9, "displacement is bounded around the real straight or Bezier tether");
      }
    }
  }
  const [a, b] = pairs[1];
  assert.deepEqual(plainPoints(env.audioConnectionWave(a, b, music, 100, 200)), plainPoints(env.audioConnectionWave(a, b, music, 2, 200)));
  assert.equal(env.audioConnectionWave(a, b, music, -100, 200), null);
  assert.equal(env.audioConnectionWave(a, b, music, 0, 200), null);
  assert.ok(env.audioConnectionWave(a, b, music, 2, 200).amplitude > env.audioConnectionWave(a, b, music, 0.25, 200).amplitude * 4);
});

test("playing waves preserve work links, status tint, assignments and anchors in straight and branch layouts", () => {
  for (const layout of ["constellation", "tree", "layers"]) {
    const { state, env, projected } = graphFixture(layout), runningIds = new Set(["task:first"]);
    const before = structuredClone({ nodes: state.nodes, edges: state.edges, branchParents: state.branchParents, agentLayout: state.agentLayout, projected });
    const quiet = recordingContext(), playing = recordingContext();
    env.drawGraphConnections(quiet, projected, runningIds, false, 100);
    env.drawGraphConnections(playing, projected, runningIds, true, 100);
    const workStrokes = playing.strokes.filter(stroke => stroke.path.length === 2);
    assert.deepEqual(workStrokes, quiet.strokes, "the original work tethers and their status tint remain underneath the wave");
    assert.deepEqual({ nodes: state.nodes, edges: state.edges, branchParents: state.branchParents, agentLayout: state.agentLayout, projected }, before);
    const waves = Array.from(state.audioWaves, wave => ({ from: wave.from, to: wave.to, source: wave.sourceLink }));
    assert.deepEqual(waves, [
      { from: "hub", to: "task:first", source: false },
      { from: "hub", to: "task:second", source: false },
      { from: "agent:worker", to: "task:first", source: false },
      { from: "music", to: "hub", source: true },
    ]);
    assert.equal(state.edges.some(edge => state.nodes[edge.a].kind === "music" || state.nodes[edge.b].kind === "music"), false, "the source cable cannot become a task dependency");
    for (const wave of state.audioWaves) {
      const from = projected.find(entry => entry.node.id === wave.from).p;
      const to = projected.find(entry => entry.node.id === wave.to).p;
      assert.deepEqual(plainPoints(wave)[0], from);
      assert.deepEqual(plainPoints(wave).at(-1), to);
    }
    const paintedWaves = playing.strokes.filter(stroke => stroke.path.length > 2);
    assert.equal(paintedWaves.length, state.audioWaves.length * 2);
    state.audioWaves.forEach((wave, index) => {
      for (const stroke of paintedWaves.slice(index * 2, index * 2 + 2)) {
        assert.deepEqual(stroke.path.map(({ x, y }) => ({ x, y })), plainPoints(wave), "both visible wave strokes paint the sampled geometry");
      }
    });
  }
});

test("silence and disabled audio clear rendered waves without leaving a previous frame behind", () => {
  const { state, env, projected } = graphFixture();
  const play = () => env.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  play(); assert.ok(state.audioWaves.length > 0);
  const quietMusic = { waveform: waveform(), bass: 0, mid: 0, treble: 0, kick: 0, snare: 0, hat: 0, energy: 0 };
  state.music = quietMusic;
  const silence = recordingContext();
  env.drawGraphConnections(silence, projected, new Set(), true, 250);
  assert.equal(state.audioWaves.length, 0, "stale waveform samples alone cannot animate silence");
  assert.ok(silence.strokes.every(stroke => stroke.path.length === 2));
  state.music = fullMusic(); play(); assert.ok(state.audioWaves.length > 0);
  const disabled = recordingContext();
  env.drawGraphConnections(disabled, projected, new Set(), false, 300);
  assert.equal(state.audioWaves.length, 0);
  assert.ok(disabled.strokes.every(stroke => stroke.path.length === 2));
});

test("the draw-frame audio gate disables all wave links for reduced motion and disconnected sources", () => {
  const { state, env, projected } = graphFixture();
  let still = false;
  env.noMotion = () => still;
  env.audioEnergy = () => 1;
  const start = source.indexOf("  function drawFrame("), end = source.indexOf("    // Nodes the assistant", start);
  assert.ok(start > 0 && end > start);
  // Execute the real frame's input gate, then send its result to the real
  // connection renderer; unrelated camera and DOM work need no mock here.
  vm.runInContext(`${source.slice(start, end)} return audioLinked; }`, env);
  state.reactive = true;
  const cases = [
    { still: false, reactive: true, localAudio: {}, inputStream: null, enabled: true },
    { still: true, reactive: true, localAudio: {}, inputStream: null, enabled: false },
    { still: false, reactive: false, localAudio: {}, inputStream: null, enabled: false },
    { still: false, reactive: true, localAudio: null, inputStream: null, enabled: false },
    { still: false, reactive: true, localAudio: null, inputStream: {}, enabled: true },
  ];
  for (const current of cases) {
    still = current.still;
    Object.assign(state, { reactive: current.reactive, localAudio: current.localAudio, inputStream: current.inputStream });
    const linked = env.drawFrame(200);
    assert.equal(linked, current.enabled);
    env.drawGraphConnections(recordingContext(), projected, new Set(), linked, 200);
    assert.equal(state.audioWaves.length > 0, current.enabled);
  }
});

test("retargeted, fading, absorbed and removed workers leave no old waveform tether", () => {
  const { state, env, projected } = graphFixture();
  const draw = () => env.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  const workerWaves = () => Array.from(state.audioWaves).filter(wave => wave.from === "agent:worker" || wave.to === "agent:worker");
  draw(); assert.equal(workerWaves().length, 1);
  state.agentLayout.set("agent:worker", { hostId: "task:second" });
  draw(); assert.equal(workerWaves().length, 1); assert.equal(workerWaves()[0].to, "task:second");
  const worker = projected[3].node;
  worker._fade = 0.01; draw(); assert.equal(workerWaves().length, 0);
  worker._fade = 1; draw(); assert.equal(workerWaves().length, 1);
  worker._absorbed = true; draw(); assert.equal(workerWaves().length, 0);
  worker._absorbed = false; draw(); assert.equal(workerWaves().length, 1);
  // A graph rebuild removes both the worker and its old indexed graph edge.
  state.edges = state.edges.filter(edge => edge.b !== 3);
  state.nodes.splice(3, 1); projected.splice(3, 1); state.agentLayout.delete(worker.id);
  draw(); assert.equal(workerWaves().length, 0);
  projected.find(entry => entry.node.kind === "music").node._fade = 0.01;
  draw(); assert.equal(state.audioWaves.some(wave => wave.sourceLink), false, "a disappearing source cable also releases");
});

test("dense graphs keep wave amplitude, vertices and strokes bounded at maximum response", () => {
  const nodes = Array.from({ length: 257 }, (_, index) => ({ id: `task:${index}`, kind: "task", state: "open" }));
  const state = { nodes, edges: nodes.slice(1).map((_, index) => ({ a: 0, b: index + 1 })), music: fullMusic(), audioResponse: 100 };
  const projected = nodes.map((node, index) => ({ node, p: { x: index * 100, y: index % 7 * 120 } }));
  const env = environment(state), ctx = recordingContext();
  env.drawGraphConnections(ctx, projected, new Set(), true, 400);
  assert.equal(state.audioWaves.length, 256);
  assert.equal(ctx.strokes.length, state.edges.length * 3, "each edge has one work stroke and two waveform strokes");
  assert.ok(state.audioWaves.every(wave => wave.points.length <= 57 && wave.amplitude <= 44 + 1e-9));
  assert.ok(ctx.strokes.every(stroke => stroke.path.length <= 57 && stroke.color.alpha <= 1 && stroke.width <= 5));
  assert.ok(state.audioWaves.every(wave => wave.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
});
