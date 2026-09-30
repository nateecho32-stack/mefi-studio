// The Command tree's return path up the chain. A part another task delegated
// pops out of the task that handed it out and, closed, flies straight home
// into it (no done-hold, not into its session). A sub-agent session tree3d
// hangs under its parent flies home into that parent when it leaves the board.
// Other group members stay read-only leaves without a life-cycle of their own.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const start = source.indexOf("  // ---------- node life-cycle (pop out / absorb) ----------");
const end = source.indexOf("  const read = (method) =>", start);
assert.ok(start > 0 && end > start, "the life-cycle section is where it was");
const lifeCycle = source.slice(start, end);

function environment(groups = []) {
  let now = 10_000;
  const state = {
    nodes: [], edges: [], fx: new Map(), absorbed: new Map(), doneHold: new Map(),
    tasksSeeded: true, graphSeeded: true, active: false, selected: null, hoverNode: null,
    taskGroups: [], expandedTaskGroups: new Set(), tasks: [],
  };
  const feed = [];
  const context = vm.createContext({
    state, Math, Map, Set, Number, String, Boolean, Array, Object, JSON, Infinity,
    Date: class extends Date { static now() { return now; } },
    window: { MefiTaskGroups: { groupTasks: () => groups } },
    noMotion: () => false,
    selectNode() {}, spawnParticles() {}, bell() {}, renderInfo() {},
    pushFeed: (entry) => feed.push(entry),
    nodeForSession: (id) => state.nodes.find((node) => node.kind === "session" && node.id === id && !node.dying) ?? null,
    assistantNode: () => state.nodes.find((node) => node.kind === "assistant") ?? null,
    rootNode: () => state.nodes.find((node) => node.kind === "root") ?? null,
    targetHostNode: () => null,
    NODE_ABSORB_MS: 800, NODE_ABSORB_TTL: 2400, NODE_GROW_MS: 650, DONE_FRESH_MS: 10 * 60_000, ABSORBED_MAX: 24,
  });
  vm.runInContext(`${lifeCycle}\nthis.api = { ensureFx, markAbsorb, absorbHost, sweepFx, takeTasks };`, context);
  return { state, api: context.api, feed, advance: (ms) => { now += ms; }, now: () => now };
}

const session = { id: "ses-1", kind: "session", x: 0, y: 0, z: 0 };
const assistant = { id: "__assistant__", kind: "assistant", x: 0, y: -100, z: 0 };

test("a delegated part flies home into the task that handed it out, not its session, with no hold", () => {
  const parent = { id: "parent", title: "Build the world", status: "active", delegation: { childTaskIds: ["part"] } };
  const part = { id: "part", title: "Build the map", status: "active", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } };
  const plain = { id: "plain", title: "A plan step", status: "open", parentTaskId: "elsewhere" };
  const groups = [
    { id: "parent", kind: "task-delegation", task: parent, members: [{ id: "part", task: part }] },
    { id: "plan", kind: "task", task: { id: "plan", status: "open" }, members: [{ id: "plain", task: plain }] },
  ];
  const { state, api, advance, now } = environment(groups);
  api.takeTasks([parent, part, plain, { id: "plan", status: "open" }]);
  assert.equal(state.fx.get("task:part")?.delegated, true, "the delegated part keeps a life-cycle entry");
  assert.equal(state.fx.get("task:part")?.bornAt, now(), "and pops out of its host");
  assert.ok(!state.fx.has("task:plain"), "a plain group member stays a read-only leaf");

  // As appendTaskNodes wires it: the part is shown read-only under its parent.
  const parentNode = { id: "task:parent", kind: "task", anchorSessionId: "ses-1", x: 40, y: 40, z: 0 };
  const partNode = { id: "task:part", kind: "task", readOnly: true, groupParentId: "task:parent", x: 60, y: 90, z: 0 };
  state.nodes = [assistant, session, parentNode, partNode];
  Object.assign(state.fx.get("task:part"), { anchorId: "task:parent", seen: true, wasRendered: true });
  assert.equal(api.absorbHost(state.fx.get("task:part")).id, "task:parent", "its host is the parent task, not the parent's session");
  api.sweepFx();
  assert.ok(state.fx.has("task:part"), "being read-only does not cost a delegated part its entry");

  advance(1000);
  api.takeTasks([parent, { ...part, status: "done", doneAt: now() }, plain, { id: "plan", status: "open" }]);
  const fx = state.fx.get("task:part");
  assert.equal(fx.absorbAt, now(), "closed, it starts home at once");
  assert.ok(!state.doneHold.has("task:part"), "without the finished-work hold");
  assert.equal(fx.lastX, 60, "from where it was drawn");

  // It leaves the graph (no longer urgent): its ghost flies into the parent.
  state.nodes = [assistant, session, parentNode];
  fx.seen = false;
  api.sweepFx();
  const ghost = state.nodes.find((node) => node.id === "task:part" && node.dying);
  assert.ok(ghost, "a ghost flies home");
  assert.equal(ghost.state, "done");
  advance(3000);
  state.nodes = [assistant, session, parentNode];
  api.sweepFx();
  assert.ok(!state.fx.has("task:part"), "the flight ends");
  assert.equal(state.absorbed.get("task:parent")?.[0]?.title, "Build the map", "the parent keeps what came back");
});

test("a sub-agent session that leaves the board flies home into its parent session", () => {
  const { state, api, advance } = environment();
  state.nodes = [assistant, session, { id: "ses-child", kind: "session", child: true, parentSessionId: "ses-1", x: 20, y: 78, z: 0 }];
  const fx = api.ensureFx("ses-child", { pop: true });
  Object.assign(fx, { childSession: true, anchorId: "ses-1", label: "Explore the map code", seen: true, wasRendered: true, lastX: 20, lastY: 78, lastZ: 0 });
  api.takeTasks([]);
  assert.equal(fx.absorbAt, null, "a task read leaves sub-agent sessions alone");

  state.nodes = [assistant, session];
  fx.seen = false;
  api.sweepFx();
  const ghost = state.nodes.find((node) => node.id === "ses-child" && node.dying);
  assert.ok(ghost, "it flies home instead of vanishing");
  assert.deepEqual({ kind: ghost.kind, child: ghost.child, parent: ghost.parentSessionId, label: ghost.label, state: ghost.state }, { kind: "session", child: true, parent: "ses-1", label: "Explore the map code", state: "done" });
  assert.equal(api.absorbHost(fx).id, "ses-1");
  advance(3000);
  state.nodes = [assistant, session];
  api.sweepFx();
  assert.ok(!state.fx.has("ses-child"));
  assert.deepEqual({ ...state.absorbed.get("ses-1")?.[0], at: 0 }, { title: "Explore the map code", prompt: null, taskId: null, kind: "session", status: null, at: 0 }, "the parent's card lists the sub-agent that came back");
});

test("the Command frame plays the node style's finish beats over each flight home", () => {
  assert.match(source, /entry\.flight = \{ hostId, e, t, from: fx\.fromScreen \};/, "the flight carries its progress and start");
  assert.match(source, /nodeStyles\.done\(ctx, style, flight\.from, [^;]+flight\.t \/ 0\.34, beat\)/, "the work pops where it leaves");
  assert.match(source, /nodeStyles\.absorb\(ctx, style, \{ x: host\._px, y: host\._py \}, host\._pr, tint, \(flight\.t - 0\.6\) \/ 0\.4, beat\)/, "its host takes it in as it lands");
  assert.match(source, /if \(!node\.child \|\| !node\.parentSessionId\) continue;\s+const fx = ensureFx\(node\.id, \{ pop: true \}\);/, "every rebuild gives a sub-agent session its life-cycle entry");
  assert.match(source, /node\.kind === "session" && !node\.child\) node\.ordinal/, "sub-agents take no S number");
});
