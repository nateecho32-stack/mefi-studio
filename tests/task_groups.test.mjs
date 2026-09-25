import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/task-groups.js", import.meta.url), "utf8");
const env = vm.createContext({ window: {} });
vm.runInContext(source, env);
const { groupTasks } = env.window.MefiTaskGroups;
const { graphTasks } = env.window.MefiTaskGroups;

test("graph groups use canonical tasks and retain snapshots, missing obligations and history without mutation", () => {
  const snapshot = { id: "one", title: "Original brief", prompt: "Saved requirement", logs: [{ text: "Prior work" }] };
  const parent = { id: "plan", title: "Related changes", status: "open", members: [snapshot, { id: "missing", title: "Recoverable work", prompt: "Full missing brief" }, snapshot] };
  const live = { id: "one", title: "Current brief", status: "absorbed", absorbedInto: "plan", handoff: "Resume here" };
  const tasks = [live, parent]; const before = structuredClone(tasks);
  const groups = groupTasks(tasks);
  assert.equal(groups.length, 1); assert.equal(groups[0].id, "plan"); assert.equal(groups[0].task, parent);
  assert.deepEqual(Array.from(groups[0].members, (member) => member.id), ["one", "missing"]);
  const first = groups[0].members[0];
  assert.equal(first.task, live); assert.equal(first.snapshot, snapshot); assert.equal(first.canonical, true); assert.equal(first.readOnly, true);
  assert.equal(groups[0].members[1].canonical, false); assert.equal(groups[0].members[1].task.prompt, "Full missing brief");
  assert.deepEqual(tasks, before);
  assert.deepEqual(Array.from(groupTasks([...tasks].reverse())[0].members, (member) => member.id), ["one", "missing"], "board recency cannot reorder a group's explicit membership");
});

test("current absorption wins over stale snapshots and dangling ownership creates no fake plan", () => {
  const task = { id: "child", status: "absorbed", absorbedInto: "new" };
  const tasks = [{ id: "old", members: [{ id: "child", title: "Old snapshot" }] }, { id: "new", title: "Current group" }, task, { id: "orphan", absorbedInto: "gone" }];
  const groups = groupTasks(tasks);
  assert.deepEqual(Array.from(groups, (group) => group.id), ["new"]);
  assert.equal(groups[0].members[0].task, task);
});

test("shared approved planning IDs group real distinct tasks while similar titles alone stay independent", () => {
  const a = { id: "a", title: "Shared task title", planningId: "approved", dependsOn: ["b"], runId: "held", status: "active" };
  const b = { id: "b", title: "Shared task title", planningId: "approved", prompt: "Different scope", status: "open" };
  const unrelated = { id: "c", title: "Shared task title" };
  const tasks = [a, b, unrelated];
  const groups = groupTasks(tasks, { plans: [{ id: "approved", title: "Approved release" }] });
  assert.equal(groups.length, 1); assert.equal(groups[0].id, "planning:approved"); assert.equal(groups[0].title, "Approved release");
  assert.deepEqual(Array.from(groups[0].members, (member) => member.id), ["a", "b"]);
  assert.equal(groups[0].members[0].task.runId, "held"); assert.deepEqual(a.dependsOn, ["b"]);
  assert.equal(groupTasks([unrelated, { id: "d", title: unrelated.title }]).length, 0);
  assert.equal(groupTasks([a]).length, 0);
});

test("malformed cyclic absorption links cannot create a circular graph hierarchy", () => {
  const groups = groupTasks([{ id: "a", absorbedInto: "b" }, { id: "b", absorbedInto: "a" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);
  assert.notEqual(groups[0].members[0].id, groups[0].id);
});

test("collapsed groups occupy one backlog slot and preserve running and verifying actual task nodes", () => {
  const tasks = [
    { id: "plan", title: "Release work", status: "open", members: [{ id: "saved", title: "Saved obligation", prompt: "Do not lose this" }] },
    { id: "saved", title: "Saved obligation", status: "absorbed", absorbedInto: "plan" },
    { id: "run", title: "Real worker", status: "active", planningId: "approved" },
    { id: "verify", title: "Check result", status: "awaiting_verification", planningId: "approved" },
    { id: "next", title: "Waiting step", status: "open", planningId: "approved" },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `other-${index}`, status: "open", title: "Other work" })),
  ];
  const collapsed = graphTasks(tasks, { runningIds: new Set(["run"]) });
  assert.equal(collapsed.filter((entry) => !entry.groupParentId).length, 12);
  assert.equal(collapsed.find((entry) => entry.task.id === "run").task, tasks[2]);
  assert.equal(collapsed.find((entry) => entry.task.id === "verify").groupParentId, "task:planning:approved");
  assert.equal(collapsed.some((entry) => entry.task.id === "next"), false);
  assert.equal(collapsed.filter((entry) => entry.task.id === "run").length, 1);
  const expanded = graphTasks(tasks, { runningIds: new Set(["run"]), expanded: new Set(["planning:approved", "plan"]), childLimit: 1 });
  assert.equal(expanded.filter((entry) => entry.groupParentId && !["run", "verify"].includes(entry.task.id)).length, 1);
  assert.equal(expanded.find((entry) => entry.task.id === "next").readOnly, true);
});

test("real Command grouping rebuilds maintain canonical task positions and group child edges", async () => {
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const state = { nodes: [{ id: "session", kind: "session", x: 0, y: 0, z: 0 }], edges: [], tasks: [], allTasks: [], taskGroups: [], expandedTaskGroups: new Set(), taskLayout: new Map(), fx: new Map(), doneHold: new Map() };
  const window = { MefiTaskGroups: env.window.MefiTaskGroups };
  const scope = vm.createContext({ state, window, Date, Math, Map, Set, DONE_FRESH_MS: 1000, markAbsorb: (id) => { state.fx.get(id).absorbAt = 1; }, autopilotJobs: () => [{ taskId: "working", sessionId: "session" }], ensureFx: (id) => { if (!state.fx.has(id)) state.fx.set(id, {}); return state.fx.get(id); }, absorbFallback: () => null });
  vm.runInContext(idle.slice(idle.indexOf("function taskPlacements("), idle.indexOf("// Loose words from a title")), scope);
  vm.runInContext(idle.slice(idle.indexOf("function takeTasks("), idle.indexOf("  const read =", idle.indexOf("function takeTasks("))), scope);
  const tasks = [{ id: "working", status: "active", title: "Build", planningId: "plan" }, { id: "verify", status: "awaiting_verification", title: "Verify", planningId: "plan" }, { id: "later", status: "open", title: "Later", planningId: "plan" }];
  scope.takeTasks(tasks); scope.appendTaskNodes();
  assert.equal(state.tasks.length, 3, "verification remains in the visible workload");
  const running = state.nodes.find((node) => node.task?.id === "working");
  assert.equal(running.groupParentId, "task:planning:plan");
  assert.equal(running.anchorSessionId, "session", "actual worker identity survives visual grouping");
  assert.equal(state.nodes.find((node) => node.task?.id === "verify").state, "active");
  const parent = state.nodes.find((node) => node.taskGroup);
  assert.equal(parent.kind, "task-group"); assert.equal(parent.readOnly, true);
  assert.ok(state.edges.some((edge) => state.nodes[edge.a] === parent && state.nodes[edge.b] === running));
  const original = [running.x, running.y, running.z];
  state.expandedTaskGroups.add("planning:plan");
  state.nodes = state.nodes.filter((node) => node.kind === "session"); state.edges = [];
  scope.takeTasks([...tasks].reverse()); scope.appendTaskNodes();
  const expandedRunning = state.nodes.find((node) => node.task?.id === "working");
  assert.deepEqual([expandedRunning.x, expandedRunning.y, expandedRunning.z], original);
  assert.equal(state.nodes.find((node) => node.task?.id === "later").readOnly, true);
  assert.equal(state.fx.size, 0, "read-only members do not acquire completion/pop lifecycle ghosts");
});

test("large verification groups remain bounded while an actual running worker is never hidden", () => {
  const tasks = Array.from({ length: 80 }, (_, index) => ({ id: `check-${index}`, status: "awaiting_verification", title: "Check", planningId: "large" }));
  tasks.push({ id: "worker", status: "active", title: "Current work", planningId: "large" });
  const entries = graphTasks(tasks, { runningIds: new Set(["worker"]), expanded: new Set(["planning:large"]) });
  assert.equal(entries.length, 26, "one parent, twenty-four verification leaves, one actual worker");
  assert.equal(entries.filter((entry) => entry.task.id === "worker").length, 1);
  assert.equal(entries[0].taskGroup.members.length, 81, "the full group card retains every obligation");
});

test("a task pinned to a board node works on that node instead of a node of its own", async () => {
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const host = { id: "session", kind: "session", label: "Rebuild booklet", x: 0, y: 0, z: 0 };
  const state = { nodes: [host], edges: [], tasks: [], allTasks: [], taskGroups: [], expandedTaskGroups: new Set(), taskLayout: new Map(), fx: new Map(), doneHold: new Map() };
  const window = { MefiTaskGroups: env.window.MefiTaskGroups };
  const scope = vm.createContext({ state, window, Date, Math, Map, Set, DONE_FRESH_MS: 1000, markAbsorb: (id) => { state.fx.get(id).absorbAt = 1; }, autopilotJobs: () => [{ taskId: "work", sessionId: "worker-session" }], ensureFx: (id) => { if (!state.fx.has(id)) state.fx.set(id, {}); return state.fx.get(id); }, absorbFallback: () => null });
  vm.runInContext(idle.slice(idle.indexOf("function taskPlacements("), idle.indexOf("// Loose words from a title")), scope);
  vm.runInContext(idle.slice(idle.indexOf("function takeTasks("), idle.indexOf("  const read =", idle.indexOf("function takeTasks("))), scope);
  const task = { id: "work", status: "active", title: 'Work on "Rebuild booklet"', target: { kind: "session", id: "session" } };
  scope.takeTasks([task]); scope.appendTaskNodes();
  assert.equal(state.nodes.some((node) => node.id === "task:work"), false, "the task adds no second node beside the node it was pinned to");
  assert.equal(host.workTask, task, "the clicked node carries the work");
  const fx = state.fx.get("task:work");
  assert.equal(fx.anchorId, "session");
  assert.equal(fx.wasRendered, false, "a task that never rendered cannot fly a ghost out of its host");
  state.nodes = [{ id: "elsewhere", kind: "session" }]; state.edges = [];
  scope.appendTaskNodes();
  assert.equal(state.nodes.some((node) => node.id === "task:work"), true, "the task keeps its own node when its target is not on the board");
});

test("chores the assistant filed fold into the hub instead of a node of their own", async () => {
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const hub = { id: "__assistant__", kind: "assistant", label: "Assistant", x: 0, y: 0, z: 0 };
  const session = { id: "session", kind: "session", x: 40, y: 0, z: 0 };
  const state = { nodes: [session, hub], edges: [], tasks: [], allTasks: [], taskGroups: [], expandedTaskGroups: new Set(), taskLayout: new Map(), fx: new Map(), doneHold: new Map() };
  const window = { MefiTaskGroups: env.window.MefiTaskGroups };
  const scope = vm.createContext({ state, window, Date, Math, Map, Set, DONE_FRESH_MS: 1000, markAbsorb: (id) => { state.fx.get(id).absorbAt = 1; }, autopilotJobs: () => [{ taskId: "chore", sessionId: "session" }], ensureFx: (id) => { if (!state.fx.has(id)) state.fx.set(id, {}); return state.fx.get(id); }, absorbFallback: () => null });
  vm.runInContext(idle.slice(idle.indexOf("function taskPlacements("), idle.indexOf("// Loose words from a title")), scope);
  vm.runInContext(idle.slice(idle.indexOf("function takeTasks("), idle.indexOf("  const read =", idle.indexOf("function takeTasks("))), scope);
  const tasks = [
    { id: "chore", status: "open", title: "Overseer: Resolve store unavailable", source: "a-eyes" },
    { id: "pinned", status: "open", title: "Resolve collision: main.cjs", source: "collision", pin: true },
    { id: "ask", status: "open", title: "Add night mode", source: "chat" },
  ];
  scope.takeTasks(tasks); scope.appendTaskNodes();
  assert.equal(state.nodes.some((node) => node.task?.id === "chore"), false, "a filed chore adds no node");
  assert.deepEqual(Array.from(hub.filedWork, (task) => task.id), ["chore"], "the hub carries the filed ledger");
  assert.equal(state.nodes.some((node) => node.task?.id === "pinned"), true, "a pinned chore keeps its node");
  assert.equal(state.nodes.some((node) => node.task?.id === "ask"), true, "the user's ask keeps its node");
  const fx = state.fx.get("task:chore");
  assert.equal(fx.filed, true); assert.equal(fx.wasRendered, false); assert.equal(fx.anchorId, "__assistant__");
  state.nodes = [session]; state.edges = [];
  scope.appendTaskNodes();
  assert.equal(state.nodes.some((node) => node.task?.id === "chore"), true, "without a hub on the board the chore keeps its node");
});

test("work the host pinned (pin/pinAt) outranks newer open work in the graph; the legacy workPin/pinnedAt still count", () => {
  const newer = Array.from({ length: 4 }, (_, index) => ({ id: `newer-${index}`, status: "open", title: `Newer ${index}`, updatedAt: 100 + index }));
  // assistantWorkOn, Do next and tasks:create write pin and pinAt.
  const chosen = { id: "chosen", status: "open", title: "Chosen", updatedAt: 1, pin: true, pinAt: 50 };
  const legacy = { id: "legacy", status: "open", title: "Legacy", updatedAt: 2, workPin: true, pinnedAt: 40 };
  assert.deepEqual(Array.from(graphTasks([...newer, chosen, legacy], { limit: 2 }), (entry) => entry.task.id), ["legacy", "chosen"]);
  // A group whose member was pinned takes that rank for its one slot.
  const plan = { id: "plan", status: "open", title: "Plan", updatedAt: 0, members: [{ id: "member", title: "Member" }] };
  const member = { id: "member", status: "open", title: "Member", absorbedInto: "plan", pin: true, pinAt: 7 };
  assert.equal(graphTasks([...newer, plan, member], { limit: 1 })[0].task.id, "plan");
  assert.equal(graphTasks([...newer, plan, { ...member, pin: undefined, pinAt: undefined }], { limit: 1 })[0].task.id, "newer-3", "without the pin the group is ordinary work");
});
