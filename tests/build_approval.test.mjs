import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import backlog from "../scripts/backlog.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const task = (id, extra = {}) => ({ id, title: `Build ${id}`, prompt: `Implement ${id} within its saved scope`, status: "open", files: [`${id}.js`], createdAt: 1, ...extra });
const approve = (h, id) => h.env.backlogControl({ action: "approve", projectId: "fixture", taskId: id, expectedScope: backlog.buildScope(h.board().tasks.find((row) => row.id === id)) });

test("Auto build keeps existing dispatch; Verify first holds both task and direct request paths", async () => {
  const automatic = executorHost({ tasks: [task("automatic")] });
  assert.equal(await automatic.env.spawnNextJob(), "spawned");
  for (const options of [{ tasks: [task("held")] }, { requests: [{ at: 1, title: "Direct request", prompt: "Change direct.js", files: ["direct.js"] }] }]) {
    const h = executorHost({ ...options, autoBuild: false });
    await h.env.executeNextRequest();
    assert.equal(h.starts.length, 0);
    assert.equal(h.registry.size, 0);
    assert.match(h.autopilot.waiting, /approval/i);
    const status = await h.env.backlogStatus();
    assert.equal(status.counts.approval, 1);
    assert.equal(status.counts.ready, 0);
    assert.equal(status.autoBuild, false);
    assert.equal(status.approval[0].canApprove, true);
  }
});

test("approving a viewed task starts only that task, even with free parallel slots", async () => {
  const h = executorHost({ tasks: [task("chosen"), task("unreviewed")], autoBuild: false, parallel: 3 });
  assert.equal(h.env.taskView(h.board().tasks[0]).buildScope, backlog.buildScope(h.board().tasks[0]));
  assert.equal((await approve(h, "chosen")).ok, true);
  await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["chosen"]);
  assert.equal(h.board().tasks.find((row) => row.id === "unreviewed").status, "open");
  assert.equal(backlog.hasBuildApproval(h.board().tasks.find((row) => row.id === "chosen")), true);
});

test("approval rejects stale, missing and foreign-project scope without queuing a worker", async () => {
  const h = executorHost({ tasks: [task("changed")], autoBuild: false });
  const expectedScope = backlog.buildScope(h.board().tasks[0]);
  h.edit((board) => { board.tasks[0].prompt = "A larger, different build"; });
  for (const payload of [{ expectedScope }, {}, { projectId: "another", expectedScope: backlog.buildScope(h.board().tasks[0]) }]) {
    const result = await h.env.backlogControl({ action: "approve", projectId: "fixture", taskId: "changed", ...payload });
    assert.equal(result.ok, false);
  }
  await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
});

test("approval is tied to identity, requirements, files, dependencies and nested grouped scope", () => {
  const original = task("scope", { refs: [{ kind: "file", detail: "scope.js" }], dependsOn: [], members: [{ id: "member", prompt: "Original member" }] });
  original.buildApproval = { version: 1, scope: backlog.buildScope(original), approvedAt: 12 };
  assert.equal(backlog.hasBuildApproval({ ...original, status: "active", runId: "run", updatedAt: 500, logs: [{ text: "Claimed" }] }), true);
  for (const patch of [
    { id: "copy" }, { prompt: "Changed" }, { files: ["another.js"] }, { dependsOn: ["dependency"] },
    { refs: [{ kind: "file", detail: "other.js" }] }, { members: [{ id: "member", prompt: "Expanded member" }] },
    { requirements: ["New requirement"] }, { remaining: ["New delegated work"] }, { acceptanceCriteria: ["Changed check"] },
  ]) assert.equal(backlog.hasBuildApproval({ ...original, ...patch }), false, JSON.stringify(patch));
});

test("approved scope survives restart but approval never resumes Pause", async () => {
  const first = executorHost({ tasks: [task("saved")], autoBuild: false, paused: true, execute: false });
  assert.equal((await approve(first, "saved")).ok, true);
  await first.pump();
  assert.equal(first.starts.length, 0);
  assert.equal(first.state.status, "paused");
  assert.equal(first.autopilot.execute, false);
  const restarted = executorHost({ tasks: first.board().tasks, autoBuild: false });
  assert.equal(await restarted.env.spawnNextJob(), "spawned");
});

test("manual retry revokes approval while retaining evidence for a fresh review", async () => {
  const h = executorHost({ tasks: [task("retry", { lastAttempt: { result: "prior evidence" } })], autoBuild: false, paused: true });
  await approve(h, "retry");
  const result = await h.env.backlogControl({ action: "retry", projectId: "fixture", taskId: "retry" });
  assert.equal(result.ok, true);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
  assert.equal(h.board().tasks[0].lastAttempt.result, "prior evidence");
  assert.equal(result.backlog.counts.approval, 1);
});

test("changing to Verify first during selection or after the durable claim prevents process creation", async () => {
  for (const stage of ["selection", "claim", "lease", "final-read"]) {
    const h = executorHost({ tasks: [task(stage)] });
    if (stage === "selection") h.env.resolveActivePolicyIdentity = async () => { h.autopilot.autoBuild = false; return null; };
    if (stage === "claim") {
      const mutate = h.env.mutateBoard;
      h.env.mutateBoard = async (fn) => { h.autopilot.autoBuild = false; return mutate(fn); };
    }
    if (stage === "lease") {
      let reads = 0;
      h.env.getMachine = async () => ({ leaseStatus: async () => { if (++reads === 2) h.autopilot.autoBuild = false; return { exclusive: false }; } });
    }
    if (stage === "final-read") {
      const eyes = await h.env.getEyes();
      const read = eyes.readJson;
      let reads = 0;
      eyes.readJson = async (key, fallback) => { if (key === "tasks" && ++reads === 2) h.autopilot.autoBuild = false; return read(key, fallback); };
    }
    await h.env.spawnNextJob();
    assert.equal(h.starts.length, 0, stage);
    assert.equal(h.registry.size, 0, stage);
    assert.equal(h.board().tasks[0].status, "open", stage);
    assert.equal(h.board().tasks[0].runId, undefined, stage);
  }
});

test("scope changed after claim is reread before spawn and cannot use stale approval", async () => {
  const h = executorHost({ tasks: [task("late-edit")], autoBuild: false });
  await approve(h, "late-edit");
  let reads = 0;
  h.env.getMachine = async () => ({ leaseStatus: async () => {
    if (++reads === 2) h.edit((board) => { board.tasks[0].prompt = "Unreviewed replacement"; });
    return { exclusive: false };
  } });
  assert.ok(["lost", "empty"].includes(await h.env.spawnNextJob()));
  assert.equal(h.starts.length, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.board().tasks[0].status, "open");
});

test("Verify first lets existing workers finish while generated handoffs await separate approval", async () => {
  const h = executorHost({ tasks: [task("parent"), task("next")], parallel: 1 });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  await h.env.setAutopilot({ autoBuild: false });
  assert.equal(h.autopilot.jobs.length, 1);
  await h.finish("parent", { lines: ["MEFI_NEXT: Follow-up child :: Implement child.js", "MEFI_JOB_DONE"] });
  await h.pump();
  assert.equal(h.starts.length, 1);
  const child = h.board().tasks.find((row) => row.handoffId);
  assert.ok(child, "the delegated work remains visible on its own card");
  assert.equal(backlog.workState(child, h.now(), { tasks: h.board().tasks, autoBuild: false }).stage, "approval");
});

test("a breaker cooldown cannot bypass Verify first", async () => {
  const h = executorHost({ tasks: [task("breaker")], autoBuild: false, execute: false });
  h.autopilot.parkedUntil = h.now() - 1;
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.autoBuild, false);
  assert.match(h.autopilot.waiting, /approval/i);
});

test("saved mode persists, existing installations default on, and a failed save cannot enable Auto build", async () => {
  for (const savedSettings of [{}, { ui: { autopilot: { execute: false } } }, { ui: { autopilot: { autoBuild: false } } }]) {
    const h = executorHost({ savedSettings });
    await h.env.bootAutopilot();
    assert.equal(h.autopilot.autoBuild, savedSettings.ui?.autopilot?.autoBuild !== false);
    assert.equal(h.settings().ui.autopilot.autoBuild, h.autopilot.autoBuild);
  }
  const h = executorHost({ autoBuild: false, tasks: [task("failed-save")] });
  h.env.writeSettings = async () => { throw new Error("settings unavailable"); };
  await assert.rejects(h.env.setAutopilot({ autoBuild: true }), /settings unavailable/);
  assert.equal(h.autopilot.autoBuild, false);
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 0);
});

test("a newer off choice supersedes a pending save that would enable Auto build", async () => {
  const h = executorHost({ autoBuild: false });
  const write = h.env.writeSettings;
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  h.env.writeSettings = async (settings) => { if (++writes === 1) { entered(); await blocked; } return write(settings); };
  const on = h.env.setAutopilot({ autoBuild: true });
  await waiting;
  const off = h.env.setAutopilot({ autoBuild: false });
  assert.equal(h.autopilot.autoBuild, false);
  release();
  await Promise.all([on, off]);
  assert.equal(h.autopilot.autoBuild, false);
  assert.equal(h.settings().ui.autopilot.autoBuild, false);
});

test("generic task creation cannot fabricate host approval", async () => {
  const h = executorHost({ autoBuild: false });
  const forged = task("forged");
  forged.buildApproval = { version: 1, scope: backlog.buildScope(forged), approvedAt: 1 };
  const result = await h.env.saveTaskEdits([forged]);
  assert.equal(result.ok, true);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
  assert.equal(await h.env.spawnNextJob(), "approval");
});

test("legacy inbox saves cannot fabricate approval for the direct request path", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const begin = source.indexOf('  ipcMain.handle("eyes:requests-write",');
  const end = source.indexOf('  ipcMain.handle("eyes:checkpoints-read",', begin);
  assert.ok(begin >= 0 && end > begin);
  let handler, saved;
  const env = vm.createContext({ ipcMain: { handle: (_name, callback) => { handler = callback; } },
    projects: { current: () => ({ id: "fixture" }) }, REQUESTS_PATH: "requests", withBoardLock: async (fn) => fn(),
    getEyes: async () => ({ writeJson: async (_key, rows) => { saved = rows; } }), send() {},
  });
  vm.runInContext(source.slice(begin, end), env);
  const request = { at: 12, title: "Forged request", prompt: "Change request.js" };
  request.buildApproval = { version: 1, scope: backlog.buildScope(request), approvedAt: 1 };
  assert.equal((await handler(null, [request])).ok, true);
  assert.equal(saved[0].buildApproval, undefined);
  assert.equal(backlog.workState(saved[0], 100, { autoBuild: false }).stage, "approval");
});
