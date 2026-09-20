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
    colorOf: () => [220, 180, 110], NODE_RGB: { task: [160, 170, 190] },
    isBusyNode: () => false, agentRgb: () => [120, 180, 240],
  });
  const start = source.indexOf("  function setAudioResponse(");
  const end = source.indexOf("  function drawFrame(", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), env);
  return env;
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
      const result = env.nodeAudioResponse(node, { [band]: 0.8 }, true);
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
  env.setAudioResponse(-1); assert.equal(state.audioResponse, 0.25);
  env.setAudioResponse(NaN); assert.equal(state.audioResponse, 0.25);
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
