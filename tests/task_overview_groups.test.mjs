import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const env = vm.createContext({ window: {} });
vm.runInContext(await readFile(new URL("../renderer/task-groups.js", import.meta.url), "utf8"), env);
const { overviewGroups } = env.window.MefiTaskGroups;

test("delegated builders stay beneath the shared task in the board and Command graph", () => {
  const tasks = [
    { id: "child-b", title: "Export UI", status: "active", projectId: "p", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
    { id: "parent", title: "Shared export", status: "open", projectId: "p", delegation: { childTaskIds: ["child-a", "child-b"] } },
    { id: "child-a", title: "Export format", status: "done", projectId: "p", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
    { id: "other", title: "Unrelated", status: "open", projectId: "elsewhere", parentTaskId: "parent", delegatedFrom: { parentTaskId: "parent" } },
  ];
  const before = structuredClone(tasks);
  for (const order of [tasks, [...tasks].reverse()]) {
    const groups = env.window.MefiTaskGroups.groupTasks(order);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].kind, "task-delegation");
    assert.deepEqual(Array.from(groups[0].members, (member) => member.id).sort(), ["child-a", "child-b"]);
    const overview = overviewGroups(order);
    assert.equal(overview.length, 2);
    assert.equal(overview.find((group) => group.id === "parent").task.id, "parent");
    const graph = env.window.MefiTaskGroups.graphTasks(order, { groups, runningIds: new Set(["child-b"]) });
    assert.equal(graph.find((entry) => entry.task.id === "child-b").groupParentId, "task:parent");
    assert.equal(graph.find((entry) => entry.task.id === "other").groupParentId, undefined);
  }
  assert.deepEqual(tasks, before);
});

test("overview includes discussion plans, singleton plans and unknown saved steps without inventing completion", () => {
  const plans = [{ id: "talk", title: "Discuss export", questions: [{ id: "q", status: "open" }] }, { id: "approved", title: "Build export", taskIds: ["one", "missing"] }];
  const tasks = [{ id: "one", title: "Build CSV", status: "done", planningId: "approved" }];
  const groups = overviewGroups(tasks, { plans });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].plan, plans[0]);
  assert.equal(groups[0].members.length, 0);
  assert.equal(groups[1].members[0].task, tasks[0]);
  const missing = groups[1].members[1];
  assert.equal(missing.canonical, false);
  assert.equal(missing.task.status, "unknown");
  assert.equal(missing.task.unavailable, true);
});

test("conversation follow-ups stay under their original goal independent of board recency without merging equal titles", () => {
  const tasks = [{ id: "grandchild", title: "Check durability", parentTaskId: "child", status: "open" },
    { id: "child", title: "Verify", parentTaskId: "root", status: "active" },
    { id: "unrelated", title: "Verify", status: "open" },
    { id: "root", title: "Improve keyboard controls", status: "awaiting_verification" }];
  const before = structuredClone(tasks);
  for (const order of [tasks, [...tasks].reverse()]) {
    const groups = overviewGroups(order);
    assert.equal(groups.length, 2);
    const thread = groups.find((group) => group.id === "root");
    assert.equal(thread.kind, "task-thread");
    assert.equal(thread.title, tasks[3].title);
    assert.deepEqual(Array.from(thread.members, (member) => member.id).sort(), ["child", "grandchild", "root"]);
    assert.equal(groups.find((group) => group.id === "unrelated").kind, "task");
  }
  assert.deepEqual(tasks, before);
});

test("explicit execution groups share a single card and keep missing member requirements recoverable", () => {
  const root = { id: "root", title: "Retry safety", status: "active", members: [{ id: "member", title: "Existing" }, { id: "snapshot", title: "Saved requirement", prompt: "Preserve edge case" }] };
  const tasks = [root, { id: "member", status: "absorbed", absorbedInto: "root" }, { id: "followup", parentTaskId: "root", status: "open" }];
  const groups = overviewGroups(tasks);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].task, root);
  assert.deepEqual(Array.from(groups[0].members, (member) => member.id), ["member", "snapshot", "followup"]);
  assert.equal(groups[0].members[1].canonical, false);
  assert.equal(groups[0].members[1].task.prompt, "Preserve edge case");
});

test("approved plan ownership fences conversation lineage and malformed cycles remain bounded", () => {
  const tasks = [{ id: "a", parentTaskId: "b", status: "open" }, { id: "b", parentTaskId: "a", status: "open" },
    { id: "c", planningId: "plan", projectId: "right", parentTaskId: "foreign" },
    { id: "foreign", projectId: "wrong", status: "active" },
    { id: "child", projectId: "right", parentTaskId: "foreign", status: "open" }];
  const groups = overviewGroups(tasks, { plans: [{ id: "plan", projectId: "right", title: "Scoped plan" }] });
  assert.equal(groups.find((group) => group.id === "planning:plan").members.length, 1);
  assert.equal(groups.find((group) => group.id === "foreign").members.length, 1);
  const ids = groups.flatMap((group) => Array.from(group.members, (member) => member.id));
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
});
