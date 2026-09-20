// Real host decomposition, child claims, settlement and integration using only
// memory state and fake HTTP/process boundaries. Never contacts a provider.
import test from "node:test";
import assert from "node:assert/strict";
import backlog from "../scripts/backlog.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const objective = "Implement the shared export feature across its encoder and preview, then integrate both parts.";
const parentTask = (extra = {}) => ({ id: "shared-feature", title: "Implement shared export feature", prompt: objective,
  status: "open", createdAt: 1, files: ["src/encoder.js", "src/preview.js"], ...extra });
const unrelatedTask = () => ({ id: "unrelated", title: "Implement independent search", prompt: "Add independent search filtering.",
  status: "open", createdAt: 2, files: ["src/search.js"] });
const plan = (overlap = false) => ({ summary: "Build the encoder and preview contracts, then integrate the shared export feature.", subtasks: [
  { title: "Implement export encoder", prompt: "Implement encodeExport(data) in src/encoder.js with deterministic ordering; keep the preview interface stable.", files: ["src/encoder.js"], acceptance: ["Encoder preserves all input records in a stable order."] },
  { title: "Implement export preview", prompt: "Implement renderExportPreview(data) in src/preview.js using the agreed encodeExport(data) interface.", files: [overlap ? "src/encoder.js" : "src/preview.js"], acceptance: ["Preview presents every encoded record."] },
] });
const savedTask = (h, id = "shared-feature") => h.board().tasks.find((row) => row.id === id);
const childTasks = (h) => h.board().tasks.filter((row) => row.delegatedFrom);
const stage = (h, row) => backlog.workState(row, h.now(), { tasks: h.board().tasks, autoBuild: h.autopilot.autoBuild }).stage;

function providePlan(h, value = plan(), { everyPlanner = false } = {}) {
  const complete = h.env.httpAssistantCall;
  const planned = [];
  h.env.httpAssistantCall = async (...args) => {
    const result = await complete(...args);
    const [, system, user, , options] = args;
    if (options.taskType === "cluster-planner" && (everyPlanner || (user.includes(objective) && system.includes('"subtasks"')))) {
      planned.push({ system, user });
      return { ok: true, text: typeof value === "string" ? value : JSON.stringify(value) };
    }
    return result;
  };
  return planned;
}

function holdSupport(h) {
  const pending = [], complete = h.env.httpAssistantCall;
  h.env.httpAssistantCall = (...args) => {
    const result = complete(...args);
    return new Promise((resolve) => pending.push(() => resolve(result)));
  };
  return { pending, release() { for (const resolve of pending.splice(0)) resolve(); } };
}

async function flushUntil(predicate) {
  for (let turn = 0; turn < 250 && !predicate(); turn += 1) await Promise.resolve();
  assert.ok(predicate(), "expected host boundary was reached");
}

async function delegate(h) {
  assert.equal(await h.env.spawnNextJob(), "delegated");
  const children = childTasks(h);
  assert.equal(children.length, 2);
  assert.equal(h.starts.length, 0, "planning releases the parent before any builder starts");
  assert.equal(h.autopilot.jobs.length, 0);
  assert.equal(h.registry.size, 0, "parent file reservations are released for the child builders");
  return children;
}

async function finishChildren(h, children) {
  for (const [index, child] of children.entries()) {
    await h.finish(child.id, { lines: [`MEFI_RESULT: done: child ${index + 1} implementation saved; remaining: none`, "MEFI_JOB_DONE"],
      files: child.files.map((file) => ({ file, status: "completed" })) });
  }
}

for (const mode of ["cluster", "swarm"]) {
  test(`${mode} delegates one objective to parallel builders with durable lineage and normal file claims`, async () => {
    const h = executorHost({ mode, parallel: 3, tasks: [parentTask(), unrelatedTask()] });
    const planned = providePlan(h);
    const children = await delegate(h);
    const parent = savedTask(h);
    assert.equal(parent.prompt, objective, "decomposition preserves the original integration scope");
    assert.equal(parent.status, "open");
    assert.equal(parent.runId, undefined);
    assert.equal(parent.lease, undefined);
    assert.deepEqual(parent.delegation.childTaskIds, children.map((row) => row.id));
    assert.deepEqual(backlog.dependencyIds(parent), children.map((row) => row.id));
    assert.equal(stage(h, parent), "waiting");
    for (const child of children) {
      assert.equal(child.parentTaskId, parent.id);
      assert.equal(child.delegatedFrom.parentTaskId, parent.id);
      assert.equal(child.delegatedFrom.parentPrompt, objective);
      assert.equal(child.projectId, "fixture");
      assert.equal(child.fromRun, parent.delegation.fromRun);
      assert.equal(child.depth, 1);
    }
    await h.env.executeNextRequest();
    const started = h.starts.map((row) => row.taskId);
    for (const child of children) {
      assert.ok(started.includes(child.id));
      assert.equal(savedTask(h, child.id).status, "active");
      assert.ok(savedTask(h, child.id).runId);
      const worker = h.starts.find((row) => row.taskId === child.id);
      assert.match(worker.child.prompt, /Shared task assignment/);
      assert.match(worker.child.prompt, /Other builders may be working/);
      assert.ok(worker.child.prompt.includes(child.prompt));
    }
    assert.equal(started.includes("unrelated"), mode === "swarm", "Cluster keeps its whole focus family; Swarm can also fill unrelated work");
    assert.equal(started.includes(parent.id), false);
    assert.equal(h.registry.size, mode === "swarm" ? 3 : 2);
    assert.equal(planned.length, 1, "children cannot request recursive decomposition");
    if (mode === "cluster") assert.equal(h.autopilot.clusterFocus.id, parent.id);
  });

  test(`${mode} integrates verified child results in the original task and verifies the parent separately`, async () => {
    const h = executorHost({ mode, parallel: 2, tasks: [parentTask()] });
    const planned = providePlan(h);
    const children = await delegate(h);
    await h.env.executeNextRequest();
    await finishChildren(h, children);
    await h.env.executeNextRequest();
    assert.ok(children.every((child) => savedTask(h, child.id).status === "awaiting_verification"));
    assert.equal(savedTask(h).status, "open");
    assert.equal(h.starts.length, 2, "reported success is insufficient to start integration");
    h.advance(31000);
    await h.env.autopilotHousekeeping();
    assert.ok(children.every((child) => savedTask(h, child.id).verification.state === "verified"));
    assert.equal(savedTask(h).status, "open", "verified child work never marks its parent complete");
    await h.env.executeNextRequest();
    assert.equal(h.starts.at(-1).taskId, "shared-feature");
    const integration = h.starts.at(-1).child.prompt;
    assert.ok(integration.includes(objective));
    assert.match(integration, /Integrate delegated work/);
    assert.match(integration, /Dependency outputs/);
    assert.match(integration, /child 1 implementation saved/);
    assert.match(integration, /child 2 implementation saved/);
    assert.match(integration, /verified/);
    assert.equal(planned.length, 1, "integration cannot divide the original task again");
    assert.equal(childTasks(h).length, 2);
    await h.finish("shared-feature");
    assert.equal(savedTask(h).status, "awaiting_verification");
    h.advance(31000);
    await h.env.autopilotHousekeeping();
    assert.equal(savedTask(h).status, "done");
    assert.equal(savedTask(h).verification.state, "verified");
    assert.notEqual(savedTask(h).lastAttempt.runId, savedTask(h).delegation.fromRun);
  });

  test(`${mode} serializes child builders that share a file and retains the parent dependency gate`, async () => {
    const h = executorHost({ mode, adaptiveParallel: true, tasks: [parentTask()] });
    providePlan(h, plan(true));
    const children = await delegate(h);
    await h.env.executeNextRequest();
    assert.equal(h.starts.length, 1);
    assert.equal(h.autopilot.jobs.length, 1);
    assert.equal(h.registry.size, 1);
    const first = h.starts[0].taskId, second = children.find((row) => row.id !== first).id;
    assert.equal(savedTask(h, second).status, "open");
    await h.finish(first);
    await h.env.executeNextRequest();
    assert.deepEqual(h.starts.map((row) => row.taskId), [first, second]);
    assert.equal(savedTask(h).status, "open");
    assert.equal(stage(h, savedTask(h)), "waiting");
  });

  test(`${mode} keeps delegated builders within the retained worker limit`, async () => {
    const h = executorHost({ mode, parallel: 1, tasks: [parentTask()] });
    providePlan(h);
    const children = await delegate(h);
    await h.env.executeNextRequest();
    assert.equal(h.starts.length, 1);
    assert.equal(h.autopilot.jobs.length, 1);
    assert.equal(children.filter((child) => savedTask(h, child.id).status === "open").length, 1);
    await h.finish(h.starts[0].taskId);
    await h.env.executeNextRequest();
    assert.equal(h.starts.length, 2);
    assert.equal(h.autopilot.jobs.length, 1);
  });

  for (const change of ["retry", "delete"]) {
    test(`${mode} rechecks child dependencies after ${change} during parent integration assistance`, async () => {
      const h = executorHost({ mode, parallel: 2, tasks: [parentTask()] });
      providePlan(h);
      const children = await delegate(h);
      await h.env.executeNextRequest();
      await finishChildren(h, children);
      h.advance(31000);
      await h.env.autopilotHousekeeping();
      const held = holdSupport(h);
      const dispatch = h.env.spawnNextJob();
      await flushUntil(() => held.pending.length === 2);
      assert.equal(savedTask(h).status, "active");
      h.edit((board) => {
        if (change === "delete") board.tasks = board.tasks.filter((row) => row.id !== children[0].id);
        else board.tasks = board.tasks.map((row) => row.id === children[0].id ? backlog.retryTask(row, h.now()) : row);
      });
      held.release();
      await dispatch;
      assert.equal(h.starts.length, 2, "invalidated prerequisites prevent the parent integration process from starting");
      assert.equal(savedTask(h).status, "open");
      assert.equal(savedTask(h).runId, undefined);
      assert.equal(savedTask(h).lease, undefined);
      assert.equal(stage(h, savedTask(h)), change === "delete" ? "blocked" : "waiting");
      assert.equal(h.autopilot.jobs.length, 0);
      assert.equal(h.registry.size, 0);
    });
  }

  for (const condition of ["failed", "missing"]) {
    test(`${mode} holds parent integration when a delegated child is ${condition}`, async () => {
      const h = executorHost({ mode, parallel: 2, tasks: [parentTask()] });
      providePlan(h);
      const children = await delegate(h);
      h.edit((board) => {
        Object.assign(board.tasks.find((row) => row.id === children[0].id), { status: "done", verification: { state: "verified" } });
        if (condition === "missing") board.tasks = board.tasks.filter((row) => row.id !== children[1].id);
        else Object.assign(board.tasks.find((row) => row.id === children[1].id), { verification: { state: "failed" }, verifyAttempts: 3 });
      });
      await h.env.executeNextRequest();
      assert.equal(h.starts.length, 0);
      assert.equal(savedTask(h).status, "open");
      assert.equal(stage(h, savedTask(h)), condition === "missing" ? "blocked" : "waiting");
      if (mode === "cluster") assert.equal(h.autopilot.clusterFocus.id, "shared-feature");
    });
  }

  test(`${mode} requires each delegated scope's approval under verify-first`, async () => {
    const parent = parentTask();
    parent.buildApproval = { version: 1, scope: backlog.buildScope(parent), approvedAt: 1 };
    const h = executorHost({ mode, parallel: 2, autoBuild: false, tasks: [parent] });
    providePlan(h);
    const children = await delegate(h);
    await h.env.executeNextRequest();
    assert.equal(h.starts.length, 0);
    for (const child of children) {
      assert.equal(child.buildApproval, undefined, "the parent approval cannot approve the generated child scope");
      assert.equal(stage(h, savedTask(h, child.id)), "approval");
    }
    const approval = await h.env.backlogControl({ action: "approve", taskId: children[0].id,
      projectId: "fixture", expectedScope: backlog.buildScope(savedTask(h, children[0].id)) });
    assert.equal(approval.ok, true);
    await h.env.executeNextRequest();
    assert.deepEqual(h.starts.map((row) => row.taskId), [children[0].id]);
    assert.equal(stage(h, savedTask(h, children[1].id)), "approval");
  });

  for (const change of ["pause", "mode", "mode-roundtrip", "scope", "approval"]) {
    test(`${mode} discards a delegation proposal after ${change} changes during assistance`, async () => {
      const h = executorHost({ mode, tasks: [parentTask()] });
      providePlan(h);
      const held = holdSupport(h);
      const dispatch = h.env.spawnNextJob();
      await flushUntil(() => held.pending.length === 2);
      if (change === "pause") await h.env.assistantPause();
      if (change === "mode") await h.env.setAutopilot({ mode: mode === "cluster" ? "swarm" : "cluster" });
      if (change === "mode-roundtrip") {
        await h.env.setAutopilot({ mode: mode === "cluster" ? "swarm" : "cluster" });
        await h.env.setAutopilot({ mode });
      }
      if (change === "scope") h.edit((board) => { board.tasks[0].prompt = "A replacement scope requiring its own plan."; });
      if (change === "approval") await h.env.setAutopilot({ autoBuild: false });
      held.release();
      await dispatch;
      assert.equal(childTasks(h).length, 0);
      assert.equal(savedTask(h).delegation, undefined);
      assert.equal(savedTask(h).status, "open");
      assert.equal(savedTask(h).runId, undefined);
      assert.equal(savedTask(h).lease, undefined);
      assert.equal(savedTask(h).runFailures, undefined);
      assert.equal(h.starts.length, 0);
      assert.equal(h.autopilot.jobs.length, 0);
      assert.equal(h.registry.size, 0);
    });
  }

  test(`${mode} releases the parent if durable subtask admission fails`, async () => {
    const h = executorHost({ mode, tasks: [parentTask()] });
    providePlan(h);
    const held = holdSupport(h);
    const dispatch = h.env.spawnNextJob();
    await flushUntil(() => held.pending.length === 2);
    h.failNextWrite();
    held.release();
    await dispatch;
    assert.equal(h.starts.length, 0);
    assert.equal(childTasks(h).length, 0);
    assert.equal(savedTask(h).delegation, undefined);
    assert.equal(savedTask(h).status, "open");
    assert.equal(savedTask(h).runId, undefined);
    assert.equal(savedTask(h).runFailures, undefined);
    assert.equal(h.autopilot.jobs.length, 0);
    assert.equal(h.registry.size, 0);
    assert.ok(h.logs.some((line) => /delegation save failed/.test(line)));
  });

  test(`${mode} ignores malformed or unavailable delegation advice and runs the saved objective`, async () => {
    const h = executorHost({ mode, tasks: [parentTask()] });
    providePlan(h, '{"summary":"Bad provider output", "subtasks": [');
    await h.env.executeNextRequest();
    assert.equal(childTasks(h).length, 0);
    assert.deepEqual(h.starts.map((row) => row.taskId), ["shared-feature"]);
    assert.ok(h.starts[0].child.prompt.includes(objective));
  });

  test(`${mode} promotes a delegated direct request by identity despite an unrelated task with the same title`, async () => {
    const request = { title: parentTask().title, prompt: objective, files: parentTask().files, at: 1, source: "manual", pin: true };
    const h = executorHost({ mode, parallel: 2, requests: [request] });
    providePlan(h);
    const children = await delegate(h);
    const savedRequest = h.board().requests[0];
    assert.equal(savedRequest.runId, undefined);
    assert.deepEqual(savedRequest.delegation.childTaskIds, children.map((child) => child.id));
    assert.equal(stage(h, savedRequest), "waiting");
    assert.ok(children.every((child) => child.delegatedFrom.parentRequestKey));
    const unrelated = { ...unrelatedTask(), title: request.title, createdAt: h.now() + 1 };
    h.edit((board) => { board.tasks.push(unrelated); });
    assert.equal(await h.env.promoteRequestsToTasks(), 1, "a same-title card is not this request's integration root");
    const promoted = h.board().tasks.find((row) => row.delegation);
    assert.ok(promoted);
    assert.notEqual(promoted.id, unrelated.id);
    assert.notEqual(promoted.title, unrelated.title, "the new identity can be dispatched despite the title collision");
    assert.equal(promoted.prompt, request.prompt);
    assert.deepEqual(promoted.delegation, savedRequest.delegation);
    assert.equal(stage(h, promoted), "waiting");
    for (const child of childTasks(h)) {
      assert.equal(child.parentTaskId, promoted.id);
      assert.equal(child.delegatedFrom.parentTaskId, promoted.id);
      assert.equal(child.delegatedFrom.scope, promoted.delegation.scope);
    }
    assert.equal(await h.env.promoteRequestsToTasks(), 0, "replaying promotion cannot duplicate the root or children");
    assert.equal(h.board().tasks.length, 4);
    await h.env.executeNextRequest();
    assert.deepEqual(new Set(h.starts.map((row) => row.taskId)), new Set(children.map((child) => child.id)));
    if (mode === "cluster") assert.equal(h.autopilot.clusterFocus.id, promoted.id);
    await finishChildren(h, children);
    h.advance(31000);
    await h.env.autopilotHousekeeping();
    await h.env.executeNextRequest();
    assert.ok(h.starts.some((row) => row.taskId === promoted.id));
    assert.equal(h.starts.filter((row) => row.taskId === null).length, 0, "the inbox copy cannot duplicate the promoted integration");
    assert.equal(childTasks(h).length, 2);
    assert.equal(h.board().tasks.filter((row) => row.delegation).length, 1);
  });

  test(`${mode} recovers exact delegated children from an interrupted direct-request board save`, async () => {
    const request = { title: parentTask().title, prompt: objective, files: parentTask().files, at: 1, source: "manual", pin: true };
    const h = executorHost({ mode, parallel: 2, requests: [request] });
    providePlan(h);
    const children = await delegate(h);
    const delegation = h.board().requests[0].delegation;
    assert.equal(delegation.admissions.length, 2, "the saved coordinator retains exact admissions for recovery");
    h.edit((board) => { board.tasks = []; });
    assert.equal(stage(h, h.board().requests[0]), "blocked");
    await h.env.autopilotHousekeeping();
    assert.deepEqual(childTasks(h).map((child) => child.id), children.map((child) => child.id));
    assert.equal(h.board().requests.length, 1);
    assert.deepEqual(h.board().requests[0].delegation, delegation);
    for (const child of childTasks(h)) {
      const original = children.find((row) => row.id === child.id);
      assert.equal(child.prompt, original.prompt);
      assert.deepEqual(child.files, original.files);
      assert.deepEqual(child.acceptance, original.acceptance);
      assert.deepEqual(child.delegatedFrom, original.delegatedFrom);
      assert.equal(child.status, "open");
      assert.equal(child.runId, undefined);
    }
    assert.equal(stage(h, h.board().requests[0]), "waiting");
    await h.env.autopilotHousekeeping();
    assert.equal(h.board().tasks.length, 2, "replaying recovery cannot duplicate admissions");
    assert.equal(await h.env.promoteRequestsToTasks(), 1);
    const parentId = h.board().tasks.find((row) => row.delegation).id;
    await h.env.autopilotHousekeeping();
    assert.equal(await h.env.promoteRequestsToTasks(), 0);
    assert.equal(h.board().tasks.filter((row) => row.delegation).length, 1);
    assert.equal(h.board().tasks.length, 3);
    assert.ok(childTasks(h).every((child) => child.parentTaskId === parentId));
    assert.equal(h.starts.length, 0, "recovery restores queued work without starting builders or inventing completion");
  });

  test(`${mode} cannot verify a completed integration while a child has been explicitly reopened`, async () => {
    const h = executorHost({ mode, parallel: 2, tasks: [parentTask()] });
    providePlan(h);
    const children = await delegate(h);
    await h.env.executeNextRequest();
    await finishChildren(h, children);
    h.advance(31000);
    await h.env.autopilotHousekeeping();
    await h.env.executeNextRequest();
    assert.equal(h.starts.at(-1).taskId, "shared-feature");
    const retry = await h.env.backlogControl({ action: "retry", taskId: children[0].id, projectId: "fixture" });
    assert.equal(retry.ok, true);
    assert.equal(savedTask(h, children[0].id).status, "open");
    await h.finish("shared-feature");
    assert.equal(savedTask(h).status, "awaiting_verification");
    const attempts = savedTask(h).verifyAttempts;
    h.advance(31000);
    await h.env.autopilotHousekeeping();
    assert.equal(savedTask(h).status, "awaiting_verification");
    assert.notEqual(savedTask(h).verification?.state, "verified");
    assert.equal(savedTask(h).doneAt, undefined);
    assert.equal(savedTask(h).verifyAttempts, attempts, "waiting for a reopened dependency does not consume verification retries");
    assert.equal(stage(h, savedTask(h)), "waiting");
    assert.equal(savedTask(h).prompt, objective);
    assert.equal(h.starts.length, 3);
  });
}

test("Cluster restores the durable shared-task focus after restarting between plan and child admission", async () => {
  const h = executorHost({ mode: "cluster", parallel: 2, tasks: [parentTask(), unrelatedTask()] });
  providePlan(h);
  const children = await delegate(h);
  const reopened = executorHost({ mode: "cluster", parallel: 2, tasks: h.board().tasks });
  providePlan(reopened);
  assert.equal(reopened.autopilot.clusterFocus, null);
  await reopened.env.executeNextRequest();
  assert.equal(reopened.autopilot.clusterFocus.id, "shared-feature");
  assert.deepEqual(new Set(reopened.starts.map((row) => row.taskId)), new Set(children.map((row) => row.id)));
  assert.equal(savedTask(reopened, "unrelated").status, "open");
  assert.equal(childTasks(reopened).length, 2);
});

test("planner output cannot recursively split delegated children or the parent's integration attempt", async () => {
  const h = executorHost({ mode: "cluster", parallel: 2, tasks: [parentTask()] });
  providePlan(h, plan(), { everyPlanner: true });
  const children = await delegate(h);
  await h.env.executeNextRequest();
  assert.equal(childTasks(h).length, 2);
  await finishChildren(h, children);
  h.advance(31000);
  await h.env.autopilotHousekeeping();
  await h.env.executeNextRequest();
  assert.equal(h.starts.at(-1).taskId, "shared-feature");
  assert.equal(childTasks(h).length, 2);
  assert.equal(h.board().tasks.length, 3);
});
