// The Command node tree: regressions from the September 2026 node-tree pass.
// Each test slices the real functions out of renderer/idle.js by their
// literal markers, as the other Command suites do, and stubs what they call.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = (await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return source.slice(a, b);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("wires and branch parents index the drawn list, which leaves the hub out", () => {
  // tree3d's snapshot puts the assistant hub between the sessions and the
  // tasks idle.js appends; drawFrame then drops the hub from `projected`.
  const nodes = [
    { id: "__root__", kind: "root" }, { id: "s1", kind: "session" }, { id: "__assistant__", kind: "assistant" },
    { id: "task:a", kind: "task" }, { id: "task:b", kind: "task" },
  ];
  const edges = [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 3, task: true }, { a: 1, b: 4, task: true }];
  const state = { nodes, edges };
  const env = vm.createContext({ state, Map });
  vm.runInContext(section("  // Edges index state.nodes, but the frame draws", "  function primaryBranchParents("), env);
  const projected = nodes.filter((node) => node.kind !== "assistant").map((node) => ({ node, p: { x: 0, y: 0 } }));
  const list = env.frameEdges(projected);
  const named = list.map((edge) => `${projected[edge.a].node.id}>${projected[edge.b].node.id}`);
  assert.deepEqual(plain(named), ["__root__>s1", "s1>task:a", "s1>task:b"], "the hub's edge is dropped and every later wire keeps its own ends");
  assert.equal(list[2].task, true, "an edge's flags ride along");
  assert.equal(env.frameEdges(projected.slice()), list, "the same graph reuses one remap");
  state.nodes = [...nodes];
  assert.notEqual(env.frameEdges(projected.slice()), list, "a rebuilt graph remaps again");
});

function graphHelpers(nodes, selected = null) {
  const moves = [];
  const state = { nodes, selected };
  const env = vm.createContext({
    state, Set, Boolean,
    assistantNode: () => nodes.find((node) => node.kind === "assistant") ?? null,
    foldedNode: () => null,
    selectNode: (node) => { state.selected = node ? { id: node.id, node } : null; moves.push(node?.id ?? null); },
    focusNode() {}, focusComposer() {},
  });
  vm.runInContext(section("  // ---------- graph helpers ----------", "  function agoLabel("), env);
  vm.runInContext(section("  // ---------- keyboard ----------", "  function branchFit()"), env);
  return { env, state, moves };
}

test("task groups are walked like tasks, and absorbed ghosts are skipped by the keys", () => {
  const session = { id: "s1", kind: "session", updated: 1 };
  const group = { id: "task:plan", kind: "task-group", anchorSessionId: "s1", task: { id: "plan", updatedAt: 30 } };
  const task = { id: "task:t", kind: "task", anchorSessionId: "s1", task: { id: "t", updatedAt: 20 } };
  const ghost = { id: "task:gone", kind: "task", anchorSessionId: "s1", task: { id: "gone", updatedAt: 40 }, _absorbed: true };
  const { env, state, moves } = graphHelpers([{ id: "__root__", kind: "root" }, session, group, task, ghost]);
  assert.deepEqual(env.childrenOf("s1").map((node) => node.id), ["task:plan", "task:t"], "the group is a child of its session; the sunk task is not");
  assert.deepEqual(env.taskNodes().map((node) => node.id), ["task:plan", "task:t"]);
  state.selected = { id: group.id, node: group };
  env.cycleTasks(1);
  assert.equal(moves.at(-1), "task:t", "] moves on from a selected group instead of re-selecting the first task");
  env.cycleSiblings(task, 1);
  assert.equal(moves.at(-1), "task:plan", "→ among a session's children reaches the group");
  env.ascend(group);
  assert.equal(moves.at(-1), "s1", "↑ from a group returns to its session");
});

test("absorbed lists evict the least recently used hosts and never the root's or the hub's", () => {
  const state = { absorbed: new Map() };
  const env = vm.createContext({ state, Set, ABSORBED_MAX: 8 });
  vm.runInContext(section("  // A host's absorbed list, newest first.", "  const easeOut ="), env);
  env.rememberAbsorbed("__root__", { title: "old session" });
  env.rememberAbsorbed("__assistant__", { title: "chore" });
  for (let index = 0; index < 60; index += 1) env.rememberAbsorbed(`task:${index}`, { title: `job ${index}` });
  assert.ok(state.absorbed.has("__root__") && state.absorbed.has("__assistant__"), "the busiest lists survive");
  assert.ok(state.absorbed.size <= 48);
  assert.ok(state.absorbed.has("task:59") && !state.absorbed.has("task:0"), "the oldest hosts go first");
  env.rememberAbsorbed("task:30", { title: "again" });
  assert.equal([...state.absorbed.keys()].at(-1), "task:30", "a host that absorbs again moves to the back of the queue");
});

test("callout titles clip by bisection and reuse the answer across frames", () => {
  let measured = 0;
  const ctx = { font: "", measureText: (text) => { measured += 1; return { width: text.length * 7 }; } };
  const state = { labelWidths: new Map() };
  const env = vm.createContext({ state, Math, String, Map, LABEL_CACHE_MAX: 400 });
  vm.runInContext(section("  function measure(ctx", "  function fontFor("), env);
  vm.runInContext(section("  // Callout titles are whole task and session titles", "  // The card's measurements:"), env);
  const title = `Refresh ${"the saved board and the executor ledger ".repeat(6)}`;
  const clipped = env.clipLine(ctx, "12px x", title, 200);
  assert.ok(clipped.endsWith("…") && clipped.length * 7 <= 200 && (clipped.length + 1) * 7 > 200, `the longest prefix that fits (${clipped})`);
  assert.ok(measured <= 12, `bisection measures a handful of prefixes, not one per character (${measured})`);
  const before = measured;
  for (let frame = 0; frame < 30; frame += 1) env.clipLine(ctx, "12px x", title, 200);
  assert.equal(measured, before, "later frames measure nothing");
  assert.equal(env.clipLine(ctx, "12px x", "short", 200), "short");
});

test("the width cache evicts its oldest entry instead of clearing every label at once", () => {
  const ctx = { font: "", measureText: (text) => ({ width: text.length }) };
  const state = { labelWidths: new Map() };
  const env = vm.createContext({ state, Math, String, Map, LABEL_CACHE_MAX: 4 });
  vm.runInContext(section("  function measure(ctx", "  function fontFor("), env);
  for (const text of ["a", "b", "c", "d", "e", "f"]) env.measure(ctx, "f", text);
  assert.ok(state.labelWidths.size <= 5 && state.labelWidths.has("f|f") && state.labelWidths.has("f|e"));
  assert.ok(!state.labelWidths.has("f|a"));
});

function builderFixture() {
  let now = 10000, jobs = [];
  const hub = { id: "hub", kind: "assistant", x: 0, y: 0, z: 0 };
  const session = { id: "ses_1", kind: "session", label: "Unrelated", x: 100, y: 0, z: 100 };
  const state = { nodes: [], edges: [], fx: new Map(), absorbed: new Map(), graphSeeded: true, active: false, allTasks: [] };
  const env = vm.createContext({
    state, Math, Set, Map, Number, String, Boolean, Date: class extends Date { static now() { return now; } },
    BUILDER_ORBIT: 15, BUILDER_FIELD: 78, NODE_ABSORB_MS: 800, NODE_ABSORB_TTL: 5000, NODE_GROW_MS: 650,
    ABSORBED_MAX: 8, noMotion: () => false, autopilotJobs: () => jobs,
    assistantNode: () => state.nodes.find((node) => node.kind === "assistant"), rootNode: () => null,
    nodeForSession: () => null, selectNode() {}, renderInfo() {}, pushFeed() {}, spawnParticles() {}, bell() {},
  });
  vm.runInContext(section("const titleKeys =", "// Grace expiry"), env);
  const rebuild = (nextJobs) => {
    now += 500; jobs = nextJobs;
    state.nodes = [hub, session]; state.edges = [];
    for (const fx of state.fx.values()) fx.seen = false;
    env.appendBuilderNodes(); env.sweepFx();
    return state.nodes.filter((node) => node.kind === "agent");
  };
  return { rebuild, state };
}

test("a builder keeps one orb for the whole run, even after its session is found", () => {
  const { rebuild } = builderFixture();
  const first = rebuild([{ id: "run_7", title: "Claimed request" }]);
  assert.deepEqual(first.map((node) => node.id), ["builder:run_7"]);
  const later = rebuild([{ id: "run_7", title: "Claimed request", sessionId: "ses_1" }]);
  assert.deepEqual(later.map((node) => node.id), ["builder:run_7"], "no second builder pops and no ghost flies home");
  const twins = rebuild([{ id: "run_7", title: "Same title" }, { id: "run_8", title: "Same title" }]);
  assert.equal(new Set(twins.filter((node) => !node.dying).map((node) => node.id)).size, 2, "two runs with one title are two orbs");
});

test("a read-only group parent loses a stale lifecycle instead of flying a dying twin", () => {
  const dying = [];
  const state = { nodes: [{ id: "task:plan", kind: "task", readOnly: true }], fx: new Map([["task:plan", { absorbAt: 1000, wasRendered: true, seen: false }]]) };
  const env = vm.createContext({
    state, Set, Date: { now: () => 1200 }, NODE_ABSORB_TTL: 6000, noMotion: () => false,
    appendDyingNode: (id) => dying.push(id), finalizeAbsorb: (id) => state.fx.delete(id), markAbsorb() {},
  });
  vm.runInContext(section("function sweepFx(", "// The flight ended (or never had to be seen)"), env);
  env.sweepFx();
  assert.deepEqual(dying, []);
  assert.equal(state.fx.has("task:plan"), false);
});

function switchFixture() {
  let resolveRead;
  const state = {
    projectId: "a", agentLayout: new Map(), taskLayout: new Map(), fx: new Map([["task:old", {}]]), doneHold: new Map([["task:old", {}]]),
    absorbed: new Map([["__root__", [{ title: "old" }]]]), touches: new Map([["s", {}]]), expandedTaskGroups: new Set(["g"]),
    tasksSeeded: true, foldedAbsorbedAt: 5, backlogRevision: 0, active: false,
  };
  const taken = [];
  const window = { MefiTree: { ready: () => Promise.resolve() }, mefiStudio: { tasksList: () => new Promise((resolve) => { resolveRead = resolve; }) } };
  const env = vm.createContext({ state, window, Promise, Boolean, refreshGraph() {}, updateTelemetry() {}, renderFeed() {}, exitFocus() {}, takeTasks: (tasks) => taken.push(tasks), read: () => Promise.resolve({ tasks: [] }) });
  vm.runInContext(section("  function projectChanged(", "  // Confirm a task done through"), env);
  return { env, state, taken, resolve: (value) => resolveRead(value) };
}

test("a project switch drops the old project's node lifecycle and any task read in flight", async () => {
  const { env, state, taken, resolve } = switchFixture();
  const pending = env.refreshTasks();
  env.projectChanged({ detail: { projectId: "b" } });
  for (const key of ["fx", "doneHold", "absorbed", "touches"]) assert.equal(state[key].size, 0, `${key} belongs to the old project`);
  assert.equal(state.expandedTaskGroups.size, 0);
  assert.equal(state.tasksSeeded, false, "the new board seeds as settled instead of popping its whole backlog");
  assert.equal(state.foldedAbsorbedAt, 0, "the new project's folded cluster is recorded");
  resolve({ tasks: [{ id: "old-project-task" }] });
  await pending;
  assert.deepEqual(taken, [], "a read that left before the switch never lands");
});

test("wheel zoom keeps the point under the pointer where it is", () => {
  const state = { view: "2d", camMode: "free", fit: 1.2, zoom: 1, angle: 0.4, pitch: 0, overviewScale: 0.8, overviewOffset: { x: 12, y: -6 }, center: { x: 500, y: 400 }, camera: { x: 5, y: 0, z: -3, tx: 5, ty: 0, tz: -3 } };
  const env = vm.createContext({ state, Math, Number, setCamMode() {}, setZoom: (value) => { state.zoom = Math.min(2.6, Math.max(0.45, value)); }, usableArea: () => ({ x: 0, y: 0, w: 1000, h: 800 }) });
  vm.runInContext(section("  function centerX()", "  function unprojectForLayout("), env);
  vm.runInContext(section("  // `anchor` (canvas pixels) is the point that stays put", "  function setLabels("), env);
  const world = { x: 180, y: 0, z: 90 };
  const before = env.project(world);
  env.userZoom(1.6, { x: before.x, y: before.y });
  const after = env.project(world);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-9, "the flat map keeps it exactly");
  state.view = "3d"; state.zoom = 1;
  const tilted = env.project(world);
  env.userZoom(1.3, { x: tilted.x, y: tilted.y });
  const moved = env.project(world);
  const centred = { x: 500 + 12, y: 400 - 6 };
  const drift = Math.hypot(moved.x - tilted.x, moved.y - tilted.y), centreDrift = Math.hypot(tilted.x - centred.x, tilted.y - centred.y) * 0.3;
  assert.ok(drift < centreDrift * 0.35, `3D stays close under the pointer (${drift.toFixed(1)} px against ${centreDrift.toFixed(1)} px for a centre zoom)`);
  const camera = { ...state.camera };
  env.userZoom(1.3, { x: 0, y: 0 });
  assert.deepEqual(plain(state.camera), plain(camera), "a zoom that is already at its limit moves nothing");
});

test("a frame that throws closes its canvas clip, so the next frame is not drawn inside it", () => {
  const restores = [];
  const layer = (name) => ({ restore: () => restores.push(name) });
  const state = { active: true };
  const errors = [];
  const env = vm.createContext({
    state, document: { hidden: false, body: { dataset: {} } }, pickerHeld: () => false, Number, Math,
    drawFrame: () => { state.frameClip = [layer("near"), layer("far")]; throw new Error("paint failed"); },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {}, console: { error: (...args) => errors.push(args) },
  });
  vm.runInContext(section("// Animation state belongs", "function drawFrame("), env);
  env.frame(100);
  assert.deepEqual(restores, ["near", "far"]);
  assert.equal(state.frameClip, null);
  assert.equal(errors.length, 1, "the error is still reported once");
});

test("a selection is announced in one line, and the cards themselves are not live regions", async () => {
  const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
  for (const id of ["idle-info", "cmd-node"]) {
    const tag = template.match(new RegExp(`<aside id="${id}"[^>]*>`))?.[0] ?? "";
    assert.ok(tag && !tag.includes("aria-live"), `#${id} is rebuilt on pushes and must not re-read itself`);
  }
  assert.match(template, /<div id="cmd-announce" class="sr-only" role="status" aria-live="polite" aria-atomic="true"><\/div>/);
  const el = { announce: { textContent: "" } };
  const env = vm.createContext({ el, statusBadge: () => ({ text: "Running" }) });
  vm.runInContext(section("  // The cards are not live regions", "  function select(id)"), env);
  env.announceSelection({ kind: "task", label: "Refine navigation" });
  assert.equal(el.announce.textContent, "Task, Refine navigation, Running");
  env.announceSelection({ kind: "agent", role: "auditor", label: "auditor pass" });
  assert.equal(el.announce.textContent, "Agent, auditor, Running");
  env.announceSelection(null);
  assert.equal(el.announce.textContent, "Selection cleared");
});

test("the card keeps its signature cheap and changes it when what it shows moves on", () => {
  const nodes = [{ id: "t1", kind: "todo", sessionId: "s1", state: "done" }, { id: "t2", kind: "todo", sessionId: "s1", state: "pending" }];
  const state = { nodes };
  const env = vm.createContext({ state, document: {}, Map, Set, todosOf: (id) => nodes.filter((node) => node.kind === "todo" && node.sessionId === id) });
  vm.runInContext(section("  // The card is rebuilt whole on many pushes", "  function renderInfoImpl("), env);
  const task = { id: "task:a", kind: "task", label: "A", state: "task", task: { status: "open", updatedAt: 1 } };
  const ready = env.cardSignature(task);
  assert.equal(env.cardSignature({ ...task, x: 90, _px: 400 }), ready, "moving on screen is not news for the card");
  assert.notEqual(env.cardSignature({ ...task, task: { status: "active", updatedAt: 2 } }), ready, "a task that starts running is");
  const session = { id: "s1", kind: "session", label: "S" };
  const partly = env.cardSignature(session);
  nodes[1].state = "done";
  assert.notEqual(env.cardSignature(session), partly, "a session's done count is");
});

test("a resting scene sleeps on a timer between rest frames, and input wakes it at once", () => {
  const timers = [], requests = [], cleared = [];
  const state = { active: true, motionHot: false, frameCost: 4, calmFrames: 0 };
  const document = { hidden: false, body: { dataset: {} } };
  const env = vm.createContext({
    state, document, pickerHeld: () => false, drawFrame() {}, console,
    requestAnimationFrame: (callback) => { requests.push(callback); return requests.length; }, cancelAnimationFrame() {},
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimeout: (id) => cleared.push(id),
  });
  vm.runInContext(section("// Animation state belongs", "function drawFrame("), env);
  const REST = vm.runInContext("REST_AFTER_FRAMES", env), REST_MS = vm.runInContext("REST_FRAME_MS", env);
  env.frame(100);
  assert.equal(timers.length, 0, "the ambient pace stays on requestAnimationFrame");
  state.calmFrames = REST;
  env.frame(300);
  assert.equal(timers.length, 1, "a rest frame books the next one on a timer");
  assert.ok(Math.abs(timers[0].ms - (REST_MS - 8)) < 1e-9, `about a rest frame away (${timers[0].ms} ms)`);
  const before = requests.length;
  env.wakeFrames();
  assert.equal(state.calmFrames, 0);
  assert.ok(cleared.includes(1) && requests.length === before + 1, "input cancels the sleep and asks for the next display frame");
  document.body.dataset.sheet = "tasks";
  state.calmFrames = REST;
  env.frame(700);
  const sleeping = timers.length;
  env.wakeFrames();
  assert.equal(timers.length, sleeping, "a sheet over the canvas keeps its own wait");
});

function layoutContext(view, nodeLayout) {
  const box = (left, top, width, height) => ({ hidden: false, getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
  const el = { width: 1440, height: 900, top: box(24, 20, 1392, 100), bottom: box(200, 826, 1040, 54), feed: box(24, 140, 320, 660), chatLog: box(1116, 140, 300, 64) };
  const state = { active: false, chatLogOpen: false, graphArea: null, graphAreaAt: 0, camera: { x: 0, y: 0, z: 0 }, view, zoom: 1, angle: 0.5, pitch: 0, nodes: [], fit: 1, nodeLayout, orbit: "paused", tasks: [], edges: [], settleUntil: 0 };
  const env = vm.createContext({ Date, Math, el, state, window: {}, console, Map, Set, Number, String, Object, Array, Boolean, Infinity });
  vm.runInContext(section("function centerX()", "function setZoom("), env);
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const nodes = [{ id: "root", kind: "root", x: 0, y: 0, z: 0 }], edges = [];
  for (let s = 0; s < 3; s += 1) {
    nodes.push({ id: `s${s}`, kind: "session", x: 0, y: 0, z: 0 });
    const session = nodes.length - 1;
    edges.push({ a: 0, b: session });
    for (let t = 0; t < 5; t += 1) { nodes.push({ id: `task:${s}-${t}`, kind: "task", x: 0, y: 0, z: 0 }); edges.push({ a: session, b: nodes.length - 1 }); }
  }
  const frame = (time) => {
    state.edges = edges;
    const projected = nodes.map((node) => ({ node, p: env.project(node._layoutAnchor ?? node) }));
    env.layoutProjectedGraph(projected, env.usableArea(), "free", time, false);
  };
  return { env, state, el, nodes, frame };
}

test("a resize waits for the frame to hold still, then re-seeds under the view the tree was laid out in", () => {
  for (const view of ["3d", "2d"]) for (const change of ["spin", "zoom"]) {
    const { state, el, nodes, frame } = layoutContext(view, "constellation");
    frame(0); frame(17);
    if (change === "spin") state.angle += Math.PI / 2; else state.zoom = 2.4;
    frame(300);
    const before = new Map(nodes.map((node) => [node.id, { ...node._layoutAnchor }]));
    const layout = state.screenLayout;
    el.width += 2; state.graphAreaAt = 0; state.center = null;
    frame(700);
    assert.equal(state.screenLayout, layout, `${view} ${change}: a frame still changing keeps the settled anchors`);
    frame(900);
    assert.notEqual(state.screenLayout, layout, `${view} ${change}: a settled frame re-seeds`);
    let worst = 0;
    for (const node of nodes) { const was = before.get(node.id), now = node._layoutAnchor; worst = Math.max(worst, Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z)); }
    assert.ok(worst < 4, `${view} ${change}: two pixels of width move no anchor far (${worst.toFixed(1)}), however the camera turned or zoomed since the layout was made`);
  }
});

test("a settled tree keeps the reach it was fitted for, so work arriving far out cannot shrink it", () => {
  const { env, state } = layoutContext("3d", "constellation");
  state.nodes = [{ id: "root", kind: "root", x: 0, y: -40, z: 0 }, { id: "s1", kind: "session", x: 120, y: 10, z: 0 }, { id: "builder:x", kind: "agent", x: 900, y: 0, z: 900 }];
  env.autoFit();
  const fitted = state.fit;
  assert.equal(state.fitReach.reach, 120, "a worker in flight does not define how wide the tree is");
  state.screenLayout = { key: "settled", nodes: new Map() };
  state.nodes.push({ id: "task:far", kind: "task", x: 0, y: 0, z: 400 });
  env.autoFit();
  assert.equal(state.fit, fitted, "a panel moving over a settled tree refits for the area, not for new raw positions");
  state.screenLayout = null;
  env.autoFit();
  assert.ok(state.fit < fitted, "Fit, a first graph or a view switch measures again");
});
