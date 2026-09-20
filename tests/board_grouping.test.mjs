import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import boardGrouping from "../scripts/board-grouping.cjs";
import { groupTasks } from "../scripts/assistant.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const first = source.indexOf("const reviewedGroupingInFlight = new Map();");
const last = source.indexOf("async function assistantCompactorJob(", first);
assert.ok(first >= 0 && last > first);
const a = { id: "a", title: "Retain board drafts", prompt: "Save unsent drafts and restore them after restart", status: "open" };
const b = { id: "b", title: "Recover unsent board requests", prompt: "Recover draft input after restart without submitting it", status: "open" };
const c = { id: "c", title: "Retain menu preference", prompt: "Restore the selected menu mode", status: "open" };
const d = { id: "d", title: "Keep menu state", prompt: "Save the chosen menu mode", status: "open" };
const clone = (value) => JSON.parse(JSON.stringify(value));
function manifest(tasks = [a, b], operationId = "reviewed-fixture") {
  return { operationId, groups: [{ title: "Board draft persistence", taskIds: tasks.map((task) => task.id), tasks: tasks.map((task) => task.title), fingerprints: tasks.map(boardGrouping.fingerprint) }] };
}
function apply(tasks, request = manifest(), options = {}) {
  return boardGrouping.applyReviewedGroups({ tasks, ideas: [], manifest: request, manifestHash: "fixture-hash", now: 1000, groupTasks, ...options });
}

test("reviewed groups preserve full obligations and replay through their durable operation stamp", () => {
  const result = apply([a, b]);
  assert.equal(result.absorbed, 2);
  const plan = result.tasks.find((task) => task.groupingOperationId);
  assert.deepEqual(plan.members.map((member) => member.prompt), [a.prompt, b.prompt]);
  assert.deepEqual(result.tasks.filter((task) => task.status === "absorbed").map((task) => task.prompt), [a.prompt, b.prompt]);
  const repeated = apply(result.tasks);
  assert.equal(repeated.alreadyApplied, true);
  assert.equal(repeated.tasks, result.tasks);
  assert.throws(() => apply(result.tasks, manifest(), { manifestHash: "changed" }), /already used/);
});

test("a claimed, edited, failed or dependency protected member holds its entire reviewed group", () => {
  for (const tasks of [
    [{ ...a, prompt: "New acceptance requirement" }, b],
    [{ ...a, runId: "live-run" }, b],
    [{ ...a, lease: { ownerPid: 123 } }, b],
    [{ ...a, runFailures: 1 }, b],
    [{ ...a, nextRunAt: 2000 }, b],
    [a, b, { ...c, dependsOn: [a.id] }],
  ]) {
    const result = apply(tasks);
    assert.equal(result.absorbed, 0);
    assert.equal(result.tasks, tasks);
    assert.equal(result.skipped.length, 1);
  }
  assert.equal(apply([a, b], manifest(), { heldTaskIds: [a.id] }).absorbed, 0, "in-flight jobs protect claims not persisted yet");
});

test("unrelated worker progress does not invalidate reviewed members; safe independent groups still apply", () => {
  const request = manifest();
  request.groups.push({ ...manifest([c, d]).groups[0], title: "Menu preferences" });
  const result = apply([{ ...a, status: "active", runId: "running" }, b, c, d], request);
  assert.equal(result.absorbed, 2);
  assert.deepEqual(result.plans[0].taskIds, [c.id, d.id]);
  assert.equal(result.skipped.length, 1);
  const afterProgress = apply([{ ...a, logs: [{ at: 12, text: "New observation" }], updatedAt: 100 }, b]);
  assert.equal(afterProgress.absorbed, 2);
});

test("ambiguous names and malformed reviewed manifests never guess task identity", () => {
  assert.equal(apply([a, b, { ...a, id: "other" }]).absorbed, 0);
  for (const request of [{ groups: [] }, { ...manifest(), groups: [manifest().groups[0], manifest().groups[0]] },
    { ...manifest(), groups: [{ ...manifest().groups[0], fingerprints: [] }] }]) {
    assert.throws(() => apply([a, b], request));
  }
});

function host({ request = manifest(), failReceipt = false, held = [] } = {}) {
  const board = { tasks: clone([a, b]), ideas: [], requests: [] };
  let raw = JSON.stringify(request), receipt = null, mutations = 0, writes = 0;
  const env = vm.createContext({
    path, crypto, Date, boardGrouping, TASKS_PATH: path.join("fixture", "eyes-tasks.json"), projectDataPath: (value) => value,
    readFile: async () => raw,
    getEyes: async () => ({ readJson: async () => receipt,
      writeJson: async (_path, next) => { writes += 1; if (failReceipt) { failReceipt = false; throw new Error("receipt disk unavailable"); } receipt = next; } }),
    getAssistant: async () => ({ groupTasks }), autopilot: { jobs: held.map((taskId) => ({ taskId })) },
    mutateBoard: async (mutate) => { mutations += 1; const result = mutate(board); board.tasks = result.tasks; board.ideas = result.ideas; return result; },
    assistantLog() {},
  });
  vm.runInContext(source.slice(first, last), env);
  return { env, board, receipt: () => receipt, mutations: () => mutations, writes: () => writes, change: (next) => { raw = JSON.stringify(next); } };
}

test("live host maintenance consumers share one gateway mutation and leave a replay receipt", async () => {
  const h = host();
  const [left, right] = await Promise.all([h.env.consumeReviewedTaskGroups(1000), h.env.consumeReviewedTaskGroups(1000)]);
  assert.equal(left, right);
  assert.equal(left.status, "applied");
  assert.equal(left.absorbed, 2);
  assert.equal(h.mutations(), 1);
  await h.env.consumeReviewedTaskGroups(2000);
  assert.equal(h.mutations(), 1);
  assert.equal(h.writes(), 1);
});

test("receipt write failure retries safely after the board change without creating another plan", async () => {
  const h = host({ failReceipt: true });
  await assert.rejects(h.env.consumeReviewedTaskGroups(1000), /disk unavailable/);
  assert.equal(h.board.tasks.filter((task) => task.members).length, 1);
  const receipt = await h.env.consumeReviewedTaskGroups(2000);
  assert.equal(receipt.status, "already-applied");
  assert.equal(h.board.tasks.filter((task) => task.members).length, 1);
});

test("live claims are inspected at mutation time and malformed requests cannot modify the board", async () => {
  const h = host({ held: [a.id] });
  assert.equal((await h.env.consumeReviewedTaskGroups(1000)).status, "skipped");
  assert.equal(h.board.tasks.length, 2);
  h.change({ operationId: "malformed", groups: [] });
  const rejected = await h.env.consumeReviewedTaskGroups(2000);
  assert.equal(rejected.status, "rejected");
  assert.equal(h.mutations(), 1, "validation rejected the second request before the gateway");
});

test("manifest paths and singleton identity use each selected project's mapped data directory", async () => {
  const h = host(), reads = [];
  h.env.readFile = async (file) => { reads.push(file); const error = new Error("missing"); error.code = "ENOENT"; throw error; };
  h.env.projectDataPath = () => path.join("projects", "first", "eyes-tasks.json");
  await h.env.consumeReviewedTaskGroups(1000);
  h.env.projectDataPath = () => path.join("projects", "second", "eyes-tasks.json");
  await h.env.consumeReviewedTaskGroups(2000);
  assert.deepEqual(reads, [path.join("projects", "first", "board-group-request.json"), path.join("projects", "second", "board-group-request.json")]);
  assert.equal(h.mutations(), 0);
});
