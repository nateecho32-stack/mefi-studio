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
const point = ({ x, y }) => ({ x, y });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function layoutFixture() {
  let now = 10000;
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const state = {
    active: true, view: "2d", nodeLayout: "constellation", fit: 1, zoom: 1,
    camera: { x: 0, y: 0, z: 0 }, angle: 0, pitch: 0, tasks: [], edges: [],
    agentLayout: new Map(), fx: new Map(), nodes: [],
  };
  const env = vm.createContext({
    state, Math, Date: class extends Date { static now() { return now; } },
    usableArea: () => area, noMotion: () => false, NODE_GROW_MS: 650, NODE_ABSORB_MS: 800,
    absorbHost: (fx) => state.nodes.find((node) => node.id === fx?.anchorId),
  });
  vm.runInContext(section("function centerX()", "// The HUD owns"), env);
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const hosts = [
    { id: "task:first", kind: "task", x: -300, y: 0, z: 0 },
    { id: "task:second", kind: "task", x: 250, y: 0, z: 0 },
  ];
  // Predetermined world anchors isolate moving-worker behavior from the
  // independent layout algorithms and their initial packing choices.
  state.screenLayout = {
    key: "constellation|2d|0,0,1200,800",
    nodes: new Map(hosts.map((node) => [node.id, { world: { x: node.x, y: node.y, z: node.z } }])),
    slots: new Map(),
  };
  const worker = (host = hosts[0], extra = {}) => ({
    id: "agent:reference", kind: "agent", role: "reference", status: "running",
    targetId: host.id, phase: "hovering", x: host.x + 50, y: host.y, z: host.z, ...extra,
  });
  const frame = (agent, time, still = false) => {
    state.nodes = [...hosts, agent];
    const projected = state.nodes.map((node) => ({ node, p: env.project(node) }));
    env.layoutProjectedGraph(projected, area, "free", time, still);
    return { agent: point(projected.at(-1).p), hosts: projected.slice(0, 2).map(({ p }) => point(p)) };
  };
  return { env, state, hosts, worker, frame, setNow: (value) => { now = value; } };
}

test("Command interpolates destination changes across rebuilt objects with the same worker id", () => {
  const { state, hosts, worker, frame } = layoutFixture();
  const start = frame(worker(), 1000).agent;
  // Every refresh creates new node objects, including the worker and target.
  const changed = frame(worker(hosts[1]), 1016).agent;
  assert.ok(distance(changed, start) > 0, "the worker starts toward its new destination");
  assert.ok(distance(changed, start) < 100, "retargeting does not teleport across the graph");
  let latest = changed;
  for (let time = 1032; time <= 3000; time += 16) {
    const next = frame(worker(hosts[1]), time).agent;
    assert.ok(distance(next, latest) < 100, "each refresh continues the existing flight");
    latest = next;
  }
  assert.ok(distance(latest, start) > 450, "the worker eventually reaches the new host");
  assert.ok(distance(latest, { x: 850, y: 400 }) < 100);
  assert.ok(state.agentLayout.has("agent:reference"), "display continuity is keyed by stable identity");
});

test("Command worker interpolation follows elapsed time rather than frame count", () => {
  const run = (interval) => {
    const { hosts, worker, frame } = layoutFixture();
    const start = frame(worker(), 1000).agent;
    let current;
    for (let elapsed = interval; elapsed <= 320; elapsed += interval) current = frame(worker(hosts[1]), 1000 + elapsed).agent;
    return { start, current };
  };
  const fast = run(16), slow = run(32);
  assert.ok(distance(fast.current, fast.start) > 100, "both runs advance a real flight");
  assert.ok(distance(fast.current, slow.current) < 0.01, "equal elapsed time produces the same displayed position");
});

test("Command camera pans immediately carry workers with their unchanged hosts", () => {
  const { state, worker, frame } = layoutFixture();
  const before = frame(worker(), 1000);
  state.camera.x -= 700;
  state.camera.z += 65;
  const after = frame(worker(), 1016);
  assert.ok(Math.abs((after.agent.x - before.agent.x) - (after.hosts[0].x - before.hosts[0].x)) < 1e-7);
  assert.ok(Math.abs((after.agent.y - before.agent.y) - (after.hosts[0].y - before.hosts[0].y)) < 1e-7);
  assert.ok(after.agent.x < 0, "a host panned offscreen does not leave its worker pinned to the panel edge");
});

test("Command bounds flight offsets and honors reduced motion at destination changes", () => {
  const { hosts, worker, frame } = layoutFixture();
  const distant = frame(worker(hosts[0], { phase: "flying", x: -10000, z: 10000 }), 1000);
  assert.ok(distance(distant.agent, distant.hosts[0]) < 160, "a distant simulation source cannot throw the displayed worker out of view");
  const reduced = frame(worker(hosts[1]), 1016, true);
  assert.ok(distance(reduced.agent, reduced.hosts[1]) < 100, "reduced motion reaches the new host immediately");
});

test("Command resumes a paused worker flight without skipping the visible transition", () => {
  const { hosts, worker, frame } = layoutFixture();
  const start = frame(worker(), 1000).agent;
  const resumed = frame(worker(hosts[1]), 31000).agent;
  assert.ok(distance(resumed, start) > 0);
  assert.ok(distance(resumed, start) < 200, "a long animation gap cannot teleport a worker to a different host");
});

test("departing builders fly from their last painted position all the way into their host", () => {
  const { state, hosts, worker, frame, setNow } = layoutFixture();
  const start = frame(worker(hosts[0], { builder: true }), 1000);
  state.fx.set("agent:reference", { anchorId: hosts[0].id, absorbAt: 10000, bornAt: -Infinity, builder: true });
  // The raw simulation is already near home. The return still starts where
  // this worker was actually painted after satellite clearance.
  const ghost = () => worker(hosts[0], { dying: true, builder: true, x: hosts[0].x, z: hosts[0].z });
  const departing = frame(ghost(), 1000);
  assert.ok(distance(departing.agent, start.agent) < 1e-7, "beginning the exit does not snap to simulation coordinates");
  setNow(10400);
  const middle = frame(ghost(), 1400);
  assert.ok(distance(middle.agent, middle.hosts[0]) < distance(start.agent, start.hosts[0]));
  assert.ok(distance(middle.agent, middle.hosts[0]) > 0);
  setNow(10800);
  const end = frame(ghost(), 1800);
  assert.ok(distance(end.agent, end.hosts[0]) < 1e-7, "a departing worker reaches the host instead of sticking to the minimum orbit radius");
});

test("Command snapshots retain retiring agents and remap their live edges until departure finishes", () => {
  const env = vm.createContext({});
  vm.runInContext(section("function visibleGraphSnapshot(", "function refreshGraph()"), env);
  const nodes = [
    { id: "hub", kind: "assistant" },
    { id: "queued", kind: "agent", status: "queued" },
    { id: "running", kind: "agent", status: "running" },
    { id: "returning", kind: "agent", status: "done", retiring: true },
    { id: "finished", kind: "agent", status: "done" },
  ];
  const graph = env.visibleGraphSnapshot({ nodes, edges: nodes.slice(1).map((_, index) => ({ a: 0, b: index + 1 })) });
  assert.deepEqual(Array.from(graph.nodes, ({ id }) => id), ["hub", "running", "returning"]);
  assert.deepEqual(Array.from(graph.edges, ({ a, b }) => [a, b]), [[0, 1], [0, 2]]);
});

test("Command paints service retirement opacity and hides an expired live motion entry", () => {
  const node = { id: "agent:reference", kind: "agent", role: "reference", status: "done" };
  const state = { nodes: [node], agentSeq: {}, pulses: [], fx: new Map() };
  let motion = { reference: { x: 12, y: 24, z: 36, phase: "returning", opacity: 0.4, retiring: true, pulseSeq: 0, sparkSeq: 0, doneSeq: 0 } };
  const env = vm.createContext({ state, Math, window: { MefiTree: { advanceAgents: () => motion } }, assistantNode: () => null });
  vm.runInContext(section("function syncAgentMotion(", "// ---------- evidence popups"), env);
  vm.runInContext(section("function stepFx(", "// Grace expiry"), env);
  env.syncAgentMotion(10000, 1000);
  env.stepFx(10000);
  assert.equal(node.motionOpacity, 0.4);
  assert.equal(node.retiring, true);
  assert.equal(node._fade, 0.4, "the lifecycle pass preserves the service fade");
  motion = {};
  env.syncAgentMotion(10016, 1016);
  env.stepFx(10016);
  assert.equal(node._fade, 0, "an expired motion entry cannot leave a stale orb onscreen until the next poll");
});

test("service roster pushes cannot overwrite an executor builder's live status or progress", () => {
  const builder = { id: "builder:task", kind: "agent", role: "builder", builder: true, status: "running", state: "running", progress: 0.35, text: "Implement the task" };
  const service = { id: "agent:builder", kind: "agent", role: "builder", status: "running", progress: 0.2 };
  const before = { ...builder };
  const state = { nodes: [builder, service] };
  const env = vm.createContext({
    state, AGENT_STATES: new Set(["running", "queued", "error", "done"]),
    assistantFull: () => ({ agents: [{ role: "builder", status: "done", progress: 1, text: "Service pass completed" }] }),
  });
  vm.runInContext(section("function syncAgentNodes()", "async function assistantPrefs("), env);
  env.syncAgentNodes();
  assert.deepEqual(builder, before, "executor work owns its own status, progress, and task description");
  assert.equal(service.status, "done", "the service satellite still follows its roster");
  assert.equal(service.progress, 1);
  assert.equal(service.text, "Service pass completed");
});

function builderFixture(sharedHost = false) {
  let now = 10000, jobs = [];
  const hub = { id: "hub", kind: "assistant", x: 0, y: 0, z: 0 };
  const host = { id: "shared", kind: "session", x: 100, y: 0, z: 100 };
  const state = { nodes: [], edges: [], fx: new Map(), absorbed: new Map(), graphSeeded: true, active: false, allTasks: [] };
  const env = vm.createContext({
    state, Math, Date: class extends Date { static now() { return now; } },
    BUILDER_ORBIT: 15, BUILDER_FIELD: 78, NODE_ABSORB_MS: 800, NODE_ABSORB_TTL: 5000, NODE_GROW_MS: 650,
    ABSORBED_MAX: 40, noMotion: () => false, autopilotJobs: () => jobs,
    assistantNode: () => state.nodes.find((node) => node.kind === "assistant"), rootNode: () => null,
    nodeForSession: () => null, selectNode() {}, renderInfo() {}, pushFeed() {},
  });
  vm.runInContext(section("const titleKeys =", "// Grace expiry"), env);
  const rebuild = (nextJobs, at = now) => {
    now = at; jobs = nextJobs;
    state.nodes = [hub, ...(sharedHost ? [host] : [])]; state.edges = [];
    for (const fx of state.fx.values()) fx.seen = false;
    env.appendBuilderNodes(); env.sweepFx();
    return state.nodes.filter((node) => node.kind === "agent");
  };
  const job = (id) => ({ taskId: id, title: `Build ${id}`, sessionId: sharedHost ? host.id : null });
  return { env, state, rebuild, job };
}

test("builder orbit assignments survive status-list reorder and another worker leaving", () => {
  for (const sharedHost of [false, true]) {
    const { rebuild, job } = builderFixture(sharedHost);
    const jobs = [job("first"), job("second"), job("third")];
    const initial = new Map(rebuild(jobs).map((node) => [node.id, [node.orbit, node.radius, node.lift]]));
    for (const list of [[jobs[2], jobs[0], jobs[1]], [jobs[2], jobs[0]]]) {
      for (const node of rebuild(list).filter((entry) => !entry.dying)) {
        assert.deepEqual([node.orbit, node.radius, node.lift], initial.get(node.id), `${node.id} retains its orbit when ${sharedHost ? "host siblings" : "loose workers"} change order`);
      }
    }
  }
});

test("a builder returning during its departure reuses one live node and cancels the old exit", () => {
  const { env, state, rebuild, job } = builderFixture();
  const activeJob = job("same-work");
  rebuild([activeJob]);
  const fx = state.fx.get("builder:same-work");
  const orbit = state.nodes.find((node) => node.builder).orbit;
  const departing = rebuild([], 10100);
  assert.equal(departing.length, 1);
  assert.equal(departing[0].dying, true);
  assert.equal(fx.absorbAt, 10100);
  env.stepFx(10200);
  const departureOpacity = departing[0]._fade;
  const returning = rebuild([{ ...activeJob }], 10200);
  assert.equal(returning.length, 1, "a transiently absent job cannot create a live/ghost duplicate");
  assert.equal(Boolean(returning[0].dying), false);
  assert.equal(returning[0].orbit, orbit);
  assert.equal(state.fx.get("builder:same-work"), fx, "the same lifecycle survives the status refresh");
  assert.equal(fx.absorbAt, null);
  env.stepFx(10200);
  const resumeOpacity = returning[0]._fade;
  assert.ok(resumeOpacity > 0 && resumeOpacity < 1, "reentry begins at the partially faded departure");
  assert.equal(resumeOpacity, departureOpacity, "reentry cannot flash back to full opacity");
  env.stepFx(10320);
  assert.ok(returning[0]._fade > resumeOpacity && returning[0]._fade < 1, "the resumed worker eases back into view");
  env.stepFx(12000);
  assert.equal(returning[0]._fade, 1, "the canceled exit cannot later hide resumed work");
  assert.equal(state.absorbed.size, 0, "resumed work is not recorded as completed");
});

test("a builder for a task pinned to a board node orbits that node", () => {
  const { state, rebuild } = builderFixture(true);
  state.allTasks = [{ id: "shared-work", target: { kind: "session", id: "shared" } }];
  const builder = rebuild([{ taskId: "shared-work", title: 'Work on "Shared"', sessionId: null }]).find((node) => node.builder);
  assert.equal(builder.hostId, "shared");
  assert.equal(builder.onHost, true, "the task's own session id is not on the status row, only its target");
});
