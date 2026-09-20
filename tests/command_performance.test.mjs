import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return source.slice(a, b);
}
function environment() {
  const area = { x: 32, y: 140, w: 1376, h: 660 }, text = [];
  const state = {
    active: true, camMode: "orbit", view: "3d", nodeLayout: "constellation", angle: 0.5, pitch: 0,
    camera: { x: 0, y: 0, z: 0 }, fit: 1, zoom: 1, nodes: [], tasks: [], edges: [],
    labels: "auto", query: "", matchSet: new Set(), labelRects: [], labelWidths: new Map(),
    hudRects: [], hudRectsAt: 0, expandedTaskGroups: new Set(),
  };
  const el = { width: 1440, height: 900, ctx: {
    measureText: (value) => ({ width: value.length * 6 }), beginPath() {}, moveTo() {}, lineTo() {},
    roundRect() {}, fill() {}, fillRect() {}, stroke() {}, fillText: (...args) => text.push(args),
  } };
  const env = vm.createContext({ state, el, Date, Math, usableArea: () => area,
    emphasis: () => 1, colorOf: () => [230, 201, 141], rgba: () => "#aabbcc", NODE_RGB: {},
  });
  vm.runInContext(section("const LABEL_FONT =", "// Node life-cycle:"), env);
  vm.runInContext(section("function centerX()", "// The HUD owns"), env);
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  vm.runInContext(section("function measure(ctx", "// ---------- hover tooltip"), env);
  return { env, state, area, text };
}
// The original exhaustive predicate is the oracle for both collision and full
// label-placement comparisons; ordering, padding and ignored nodes stay exact.
function linearBlocker(env, projected) {
  const rects = projected.filter(({ node }) => !node.dying && !node._absorbed).map(({ node, p }) => {
    const radius = Math.max(5, node._orbitTrail?.radius ?? node._pr ?? 4) + 3;
    return { node, x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 };
  });
  return (surface, node) => rects.some((rect) => rect.node !== node && env.overlaps(surface, rect));
}

test("Command label indexing preserves exact padded overlaps, exclusions and extreme bounds", () => {
  const { env } = environment();
  let seed = 719;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const projected = Array.from({ length: 240 }, (_, index) => ({
    node: { id: `${index}`, _pr: 4 + random() * 18, dying: index % 17 === 0, _absorbed: index % 13 === 0 },
    p: { x: random() * 2200 - 500, y: random() * 1400 - 300 },
  }));
  projected.push({ node: { id: "large-trail", _orbitTrail: { radius: 10000 } }, p: { x: 20000, y: 20000 } });
  projected.push({ node: { id: "invalid", _pr: 5 }, p: { x: NaN, y: 10 } });
  const indexed = env.nodeLabelBlocker(projected), linear = linearBlocker(env, projected);
  for (let index = 0; index < 1200; index += 1) {
    const node = projected[index % projected.length].node;
    const surface = { x: random() * 2400 - 500, y: random() * 1600 - 300, w: random() * 240, h: 10 + random() * 30 };
    assert.equal(indexed(surface, node), linear(surface, node));
  }
  for (const surface of [
    { x: -5000, y: -5000, w: 40000, h: 40000 },
    { x: 20000, y: 20000, w: 40, h: 20 },
    { x: NaN, y: 10, w: 30, h: 20 },
  ]) assert.equal(indexed(surface, null), linear(surface, null));
  const node = { _pr: 13 }, isolated = [{ node, p: { x: 64, y: 64 } }];
  const boundary = env.nodeLabelBlocker(isolated);
  assert.equal(boundary({ x: 64 + 16 + 8, y: 60, w: 10, h: 10 }, null), false, "touching padded bounds is clear");
  assert.equal(boundary({ x: 64 + 16 + 8 - 0.001, y: 60, w: 10, h: 10 }, null), true);
  assert.equal(boundary({ x: 58, y: 58, w: 10, h: 10 }, node), false, "a node does not block its own label");
});

test("dense Command labels retain their positions with far fewer collision checks", (t) => {
  const projected = [0, 1, 2].map((index) => ({
    node: { id: `busy:${index}`, kind: "task", label: `Current work ${index}`, state: "active", _workLabel: "Running", _pr: 15 },
    p: { x: 650 + index * 36, y: 430, k: 1, depth: 800 },
  }));
  for (let index = 0; index < 240; index += 1) projected.push({
    node: { id: `quiet:${index}`, kind: "task", label: `Saved work ${index}`, _pr: 11 },
    p: { x: 200 + index % 24 * 44, y: 190 + Math.floor(index / 24) * 42, k: 1, depth: 800 },
  });
  const run = (linear) => {
    const { env, state, text } = environment();
    let checks = 0;
    const overlaps = env.overlaps;
    env.overlaps = (...args) => { checks += 1; return overlaps(...args); };
    if (linear) env.nodeLabelBlocker = (nodes) => linearBlocker(env, nodes);
    env.drawLabels(projected);
    return JSON.parse(JSON.stringify({ checks, labels: state.labelRects, text, nodes: projected.map(({ node }) => node._label) }));
  };
  const indexed = run(false), linear = run(true);
  assert.equal(indexed.labels.length, 3, "all three real workers retain a readable title");
  assert.deepEqual(indexed.labels, linear.labels);
  assert.deepEqual(indexed.text, linear.text);
  assert.deepEqual(indexed.nodes, linear.nodes);
  assert.ok(indexed.checks < linear.checks * 0.2, `${indexed.checks} indexed checks versus ${linear.checks} exhaustive checks`);
  t.diagnostic(`Dense label fixture: ${linear.checks} -> ${indexed.checks} overlap checks (${Math.round((1 - indexed.checks / linear.checks) * 100)}% fewer).`);
});

test("Command collision bounds refresh after camera motion, orbit effects and node completion", () => {
  const { env } = environment();
  const node = { _pr: 8 }, projected = [{ node, p: { x: 80, y: 80 } }];
  const surface = { x: 128, y: 80, w: 30, h: 20 };
  assert.equal(env.nodeLabelBlocker(projected)(surface), false);
  node._orbitTrail = { radius: 45 };
  assert.equal(env.nodeLabelBlocker(projected)(surface), true);
  projected[0].p.x = 400;
  assert.equal(env.nodeLabelBlocker(projected)(surface), false);
  projected[0].p.x = 100;
  assert.equal(env.nodeLabelBlocker(projected)(surface), true);
  node.dying = true;
  assert.equal(env.nodeLabelBlocker(projected)(surface), false);
});

test("parallel long task titles bound text measurements and reuse them across recurring redraws", () => {
  const { env, state } = environment();
  let measurements = 0;
  const nativeMeasure = env.el.ctx.measureText;
  env.el.ctx.measureText = (value) => { measurements += 1; return nativeMeasure(value); };
  const projected = ["Guard transitions", "Recover the store", "Register search tests", "Audit keyboard controls", "Run Python discovery", "Mark idle sessions"].map((prefix, index) => ({
    node: {
      id: `task:long:${index}`, kind: "task", _workLabel: "Running", _pr: 15,
      label: `${prefix}: ${"Inspect saved work and preserve the project context while checking renderer behavior. ".repeat(3)}`.slice(0, 180),
    },
    p: { x: 280 + index % 3 * 420, y: 320 + Math.floor(index / 3) * 330, k: 1, depth: 800 },
  }));
  env.drawLabels(projected);
  assert.ok(measurements > 0 && measurements <= 180, `six long titles need bounded initial text layout (${measurements} measurements)`);
  assert.equal(state.labelRects.length, projected.length, "all six workers remain named");
  assert.ok(projected.every(({ node }) => node._labelLines.length === 2));
  measurements = 0;
  for (let frame = 0; frame < 12; frame += 1) {
    for (const { p } of projected) { p.x += 0.125; p.y += 0.0625; }
    env.drawLabels(projected);
    assert.equal(state.labelRects.length, projected.length);
  }
  assert.equal(measurements, 0, "unchanged task titles must not churn the measurement cache during animation");
});

test("narrow Command overviews keep a real work label between expanded side panels", () => {
  const { env, state, area, text } = environment();
  Object.assign(area, { x: 318, y: 174, w: 277, h: 631 });
  env.el.width = 901; env.el.height = 901;
  // Rounded positions from the isolated 48-node Command capture fixture.
  // Full-width chips found no clear slot anywhere in this narrow viewport.
  const points = [
    [456.5,489.63,11],[501,407.27,10.7],[494.6,264.64,4.34],[514.99,300.2,4.34],
    [549.05,325.29,4.34],[574.61,361.41,4.34],[549.56,395.37,4.34],[565,444.61,4.34],
    [492.5,602.61,10.7],[540.44,530.58,4.34],[537.63,565.34,4.34],[533.18,598.57,4.34],
    [544.51,639.61,4.34],[529.77,675.14,4.34],[493.76,692.64,4.34],[417.88,594.76,10.7],
    [450.46,740.62,4.34],[438.5,775.55,4.34],[416.9,742.85,4.34],[415.9,710.74,4.34],
    [395.72,674.18,4.34],[361.92,688.18,4.34],[438.73,384.15,10.7],[372.92,442.8,4.33],
    [376,408.25,4.33],[380.71,375.34,4.33],[369.63,334.73,4.33],[411.91,327.04,4.33],
    [403.48,292.84,4.33],[460.72,334.87,14.34],[522.12,461.78,9.67],[522.12,461.78,9.67],
    [506.1,360.81,10.49],[519.51,469.27,11.56],[512.67,781.01,11.56],[358.32,588.8,11.56],
    [533.5,727.84,11],[366.95,634.52,11],[405.9,251.19,11],[449.57,258.44,11],
    [373.07,538.79,11],[429.65,204.17,11],[561.56,486.64,11],[396.07,779.89,11],
    [371.44,486.64,11],[516.97,465.85,9.61],[510.34,777.51,9.67],[356.31,585.21,9.78],
  ];
  const title = "Refine the project switcher";
  const projected = points.map(([x, y, radius], index) => ({
    node: { id: `fixture:${index}`, kind: "task", label: index >= 33 && index <= 35 ? title : "Saved work", _workLabel: index >= 33 && index <= 35 ? "Running" : null, _pr: radius },
    p: { x, y, k: 1, depth: 800 },
  }));
  env.drawLabels(projected);
  assert.ok(projected.slice(33, 36).some(({ node }) => node._label), "at least one real worker stays named");
  assert.ok(text.some(([value]) => value === "RUNNING"));
  assert.ok(text.some(([value]) => value.startsWith("Refine") && value.endsWith("…")));
  for (const { node, p } of projected) {
    assert.equal(node.label, node.id === "fixture:33" || node.id === "fixture:34" || node.id === "fixture:35" ? title : "Saved work");
    if (!node._label) continue;
    const rect = node._label;
    assert.ok(rect.x >= area.x && rect.y >= area.y && rect.x + rect.w <= area.x + area.w && rect.y + rect.h <= area.y + area.h);
    assert.equal(linearBlocker(env, projected)(rect, node), false);
    assert.deepEqual([p.x, p.y], points[Number(node.id.split(":")[1])].slice(0, 2));
  }
  const worker = projected[33].node;
  state.selected = { id: worker.id };
  assert.equal(env.labelText(env.el.ctx, worker, env.fontFor(worker), { separateStatus: true }), title, "inspection retains the full title");
});

test("fixed Command anchors bypass layout collision work but still follow the camera and admit new nodes", () => {
  for (const layoutName of ["constellation", "tree", "layers", "radial", "helix"]) {
    const { env, state, area } = environment();
    state.nodeLayout = layoutName;
    const nodes = Array.from({ length: 40 }, (_, index) => ({ id: `task:${index}`, kind: "task", x: index * 5, y: index % 3 * 12, z: index % 7 * 10 }));
    let arrangements = 0;
    const arrange = env.arrangeProjectedNodes;
    env.arrangeProjectedNodes = (...args) => { arrangements += 1; return arrange(...args); };
    const run = () => {
      const projected = nodes.map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(projected, area, state.camMode);
      return projected;
    };
    run();
    const initialPasses = arrangements;
    const anchors = nodes.map((node) => ({ ...node._layoutAnchor }));
    for (let frame = 0; frame < 60; frame += 1) {
      state.angle += 0.01; state.camera.x += 0.2; state.zoom += 0.001;
      const projected = run();
      for (let index = 0; index < nodes.length; index += 1) {
        assert.deepEqual({ ...nodes[index]._layoutAnchor }, anchors[index]);
        assert.deepEqual({ ...projected[index].p }, { ...env.project(anchors[index]) });
      }
    }
    assert.equal(arrangements, initialPasses, `${layoutName} does not rebuild a no-op collision grid every frame`);
    nodes.push({ id: "task:new", kind: "task", x: 0, y: 0, z: 0 });
    run();
    assert.equal(arrangements, initialPasses + 1, `${layoutName} still places new arrivals`);
    assert.ok(state.screenLayout.nodes.has("task:new"));
    for (let index = 0; index < anchors.length; index += 1) assert.deepEqual({ ...nodes[index]._layoutAnchor }, anchors[index]);
  }
});

test("Command advances agent flights itself while the tree rail is hidden and retains the older API fallback", () => {
  const agent = { id: "agent:reference", kind: "agent", role: "reference" };
  const state = { nodes: [agent], agentSeq: {}, pulses: [] }, times = [];
  const motion = { x: 12, y: 24, z: 36, phase: "idle", pulseSeq: 0, sparkSeq: 0, doneSeq: 0 };
  const tree = { advanceAgents: (now) => { times.push(now); return { reference: { ...motion, x: now } }; }, agentPositions: () => { throw new Error("an advanced snapshot should not be read twice"); } };
  const env = vm.createContext({ window: { MefiTree: tree }, state, assistantNode: () => null });
  vm.runInContext(section("function syncAgentMotion(", "// ---------- evidence popups"), env);
  env.syncAgentMotion(1789850000000, 1000); env.syncAgentMotion(1789850000033, 1033);
  assert.deepEqual(times, [1000, 1033]);
  assert.equal(agent.x, 1033); assert.equal(agent.y, 24);
  delete tree.advanceAgents;
  tree.agentPositions = () => ({ reference: motion });
  env.syncAgentMotion(1789850000066, 1066);
  assert.equal(agent.x, 12);
});
