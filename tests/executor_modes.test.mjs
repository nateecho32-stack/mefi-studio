// Real scheduling, durable claims, preparation and worker settlement with
// memory stores and controllable HTTP/process boundaries. No paid calls.
import test from "node:test";
import assert from "node:assert/strict";
import { executorHost } from "./fixtures/host_executor.mjs";

const task = (id, extra = {}) => ({ id, title: `Implement mode fixture ${id}`, prompt: `Implement ${id} and test the changed module.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });
const flushUntil = async (predicate) => {
  for (let turn = 0; turn < 200 && !predicate(); turn += 1) await Promise.resolve();
  assert.ok(predicate(), "the awaited host boundary must be reached");
};
function holdSupport(h) {
  const pending = [];
  const complete = h.env.httpAssistantCall;
  h.env.httpAssistantCall = (...args) => {
    const report = complete(...args);
    return new Promise((resolve) => pending.push(() => resolve(report)));
  };
  return { pending, release() { for (const resolve of pending.splice(0)) resolve(); } };
}
function assertUnclaimed(h, id) {
  const saved = h.board().tasks.find((row) => row.id === id);
  assert.equal(saved.status, "open");
  assert.equal(saved.runId, undefined);
  assert.equal(saved.lease, undefined);
  assert.equal(h.autopilot.jobs.length, 0);
  assert.equal(h.registry.size, 0);
}

test("legacy settings default to swarm and mode changes persist without changing retained worker limits", async () => {
  const h = executorHost({ savedSettings: { ui: { marker: "preserved", autopilot: { enabled: false, execute: false, parallel: 3, adaptiveParallel: false } } } });
  await h.env.bootAutopilot();
  assert.equal(h.autopilot.mode, "swarm");
  assert.equal(h.settings().ui.autopilot.mode, "swarm");
  const changed = await h.env.setAutopilot({ mode: "cluster" });
  assert.equal(changed.ok, true);
  assert.equal(h.settings().ui.autopilot.mode, "cluster");
  assert.equal(h.autopilot.parallel, 3);
  assert.equal(h.autopilot.adaptiveParallel, false);
  assert.equal(h.settings().ui.marker, "preserved");
  const reopened = executorHost({ savedSettings: h.settings() });
  await reopened.env.bootAutopilot();
  assert.equal(reopened.autopilot.mode, "cluster");
});

test("invalid execution modes are rejected without mutating settings or active work", async () => {
  const h = executorHost({ mode: "cluster" });
  const saved = h.settings();
  for (const mode of ["anything", "", null, 5]) {
    const result = await h.env.setAutopilot({ mode });
    assert.equal(result.ok, false);
    assert.equal(h.autopilot.mode, "cluster");
    assert.deepEqual(h.settings(), saved);
  }
});

test("swarm starts independent tasks together with shared planning and review agents", async () => {
  const h = executorHost({ mode: "swarm", adaptiveParallel: true, tasks: [task("first"), task("second"), task("third")] });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second", "third"]);
  assert.equal(h.autopilot.jobs.length, 3);
  assert.equal(h.supportJobs.length, 6);
  assert.equal(h.supportCalls.length, 6);
  assert.ok(h.supportCalls.every((call) => call.source === "swarm"));
});

test("cluster runs two task-focused advisors in parallel and hands both findings to one builder", async () => {
  const h = executorHost({ mode: "cluster", adaptiveParallel: true, tasks: [task("focus"), task("unrelated", { createdAt: 2 })] });
  const held = holdSupport(h);
  h.wake(); const pumping = h.pump();
  await flushUntil(() => held.pending.length === 2);
  assert.equal(h.starts.length, 0, "the lead receives finished advice before starting");
  assert.equal(h.autopilot.jobs.length, 1, "all support shares one durable work claim");
  assert.equal(h.board().tasks[0].status, "active");
  assert.equal(h.board().tasks[1].status, "open");
  assert.equal(h.registry.size, 1);
  assert.deepEqual(h.supportJobs.map((row) => row.role).sort(), ["cluster-planner", "cluster-reviewer"]);
  assert.ok(h.supportJobs.every((row) => row.ai === true));
  assert.ok(h.supportJobs.every((row) => row.targets.some((target) => target.kind === "task" && target.id.includes("focus"))));
  assert.ok(h.routeCalls.every((row) => row.allowCli === false), "advisory agents cannot fall through to a coding CLI");
  assert.ok(h.contextCalls.every((row) => row.root === h.env.projectRoot()));
  assert.ok(h.supportCalls.every((row) => row.user.includes(task("focus").prompt)));
  held.release(); await pumping;
  assert.deepEqual(h.starts.map((row) => row.taskId), ["focus"]);
  assert.match(h.starts[0].child.prompt, /cluster-planner finding/);
  assert.match(h.starts[0].child.prompt, /cluster-reviewer finding/);
  assert.equal(h.autopilot.clusterFocus.id, "focus");
  assert.ok(h.autopilot.clusterAgents.every((row) => row.taskId === "focus" && row.status === "done"));
});

test("cluster keeps unrelated work queued through evidence verification, then advances", async () => {
  const h = executorHost({ mode: "cluster", adaptiveParallel: true, tasks: [task("first"), task("second", { createdAt: 2 })] });
  h.wake(); await h.pump();
  await h.finish("first"); await h.pump();
  assert.equal(h.board().tasks[0].status, "awaiting_verification");
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first"]);
  assert.equal(h.autopilot.clusterFocus.id, "first");
  h.advance(31000); h.wake(); await h.pump();
  assert.equal(h.board().tasks[0].status, "done");
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second"]);
  assert.equal(h.autopilot.clusterFocus.id, "second");
});

test("a direct request keeps cluster focus until its durable Done record is verified", async () => {
  const request = { title: "Implement direct request", prompt: "Complete the direct request and its tests", at: 1, source: "manual", pin: true };
  const h = executorHost({ mode: "cluster", adaptiveParallel: true, requests: [request], tasks: [task("queued")] });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.starts[0].taskId, null);
  assert.equal(h.autopilot.clusterFocus.source, "request");
  await h.finish(null);
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 1, "unrelated work waits while direct-request evidence is flushing");
  assert.equal(h.board().requests[0].status, "verifying");
  h.advance(31000);
  await h.env.autopilotHousekeeping();
  await h.env.executeNextRequest();
  const completion = h.board().tasks.find((row) => row.title === request.title);
  assert.ok(completion, "verification produces a durable Done entry for direct requests");
  assert.equal(completion.status, "done");
  assert.equal(completion.verification.state, "verified");
  assert.equal(h.board().requests.length, 0);
  assert.equal(h.starts.at(-1).taskId, "queued");
  assert.equal(h.autopilot.clusterFocus.source, "task");
  assert.equal(h.autopilot.clusterFocus.id, "queued");
});

test("a focus from another project cannot pin or mislabel the current project's cluster", async () => {
  const h = executorHost({ mode: "cluster", tasks: [task("current"), task("old-focus", { createdAt: 2 })] });
  h.autopilot.clusterFocus = { source: "task", id: "old-focus", title: "A foreign project's task", projectId: "foreign" };
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["current"]);
  assert.equal(h.autopilot.clusterFocus.projectId, "fixture");
  assert.equal(h.autopilot.clusterFocus.title, task("current").title);
  assert.ok(h.autopilot.clusterAgents.every((row) => row.taskId === "current" && row.taskTitle === task("current").title));
});

test("cluster follows a substantive delegated child before unrelated queued work", async () => {
  const h = executorHost({ mode: "cluster", adaptiveParallel: true, tasks: [task("parent"), task("unrelated", { createdAt: 2 })] });
  h.wake(); await h.pump();
  await h.finish("parent", { lines: ["MEFI_NEXT: Complete focused integration :: Implement the missing integration and tests", "MEFI_RESULT: done: base implementation; remaining: Complete focused integration", "MEFI_JOB_DONE"] });
  await h.pump();
  const child = h.board().tasks.find((row) => row.parent);
  assert.ok(child, "handoff becomes durable work");
  assert.deepEqual(h.starts.map((row) => row.taskId), ["parent", child.id]);
  assert.equal(h.board().tasks.find((row) => row.id === "unrelated").status, "open");
  await h.finish(child.id); h.advance(31000); await h.pump(); h.wake(); await h.pump();
  assert.equal(h.board().tasks.find((row) => row.id === "parent").status, "done");
  assert.equal(h.starts.at(-1).taskId, "unrelated");
});

test("entering cluster drains existing swarm workers before selecting another task", async () => {
  const h = executorHost({ mode: "swarm", parallel: 2, tasks: [task("first"), task("second"), task("third")] });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 2);
  await h.env.setAutopilot({ mode: "cluster" });
  await h.finish("first"); await h.pump();
  assert.equal(h.starts.length, 2);
  assert.equal(h.autopilot.jobs[0].taskId, "second");
  assert.equal(h.terminations.length, 0, "switching modes preserves running work");
  await h.finish("second"); h.advance(31000); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second", "third"]);
  assert.equal(h.supportCalls.length, 6);
});

test("switching cluster to swarm admits independent work without stopping its lead", async () => {
  const h = executorHost({ mode: "cluster", parallel: 2, tasks: [task("first"), task("second")] });
  h.wake(); await h.pump();
  const lead = h.autopilot.jobs[0];
  await h.env.setAutopilot({ mode: "swarm" }); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second"]);
  assert.ok(h.autopilot.jobs.includes(lead));
  assert.equal(h.terminations.length, 0);
});

for (const change of ["pause", "mode", "mode-roundtrip", "scope", "approval"]) {
  test(`${change} during cluster assistance prevents an obsolete launch and releases its claim`, async () => {
    const h = executorHost({ mode: "cluster", tasks: [task("race")] });
    const held = holdSupport(h);
    const dispatch = h.env.spawnNextJob();
    await flushUntil(() => held.pending.length === 2);
    if (change === "pause") await h.env.assistantPause();
    if (change === "mode") await h.env.setAutopilot({ mode: "swarm" });
    if (change === "mode-roundtrip") {
      await h.env.setAutopilot({ mode: "swarm" });
      await h.env.setAutopilot({ mode: "cluster" });
    }
    if (change === "scope") h.edit((board) => { board.tasks[0].prompt = "A different saved scope requiring fresh assistance"; });
    if (change === "approval") await h.env.setAutopilot({ autoBuild: false });
    held.release(); await dispatch;
    assert.equal(h.starts.length, 0);
    assertUnclaimed(h, "race");
    assert.equal(h.board().tasks[0].runFailures, undefined, "cancelled preparation is not a failed build");
  });
}

for (const constraint of ["exclusive lease", "resource pressure"]) {
  test(`${constraint} arriving during cluster assistance releases the claim before launching`, async () => {
    const h = executorHost({ mode: "cluster", tasks: [task("capacity-race")] });
    const held = holdSupport(h);
    const dispatch = h.env.spawnNextJob();
    await flushUntil(() => held.pending.length === 2);
    if (constraint === "exclusive lease") h.machine.leaseStatus = async () => ({ exclusive: true });
    else h.machine.workerCapacity = async () => ({ canStart: false, reason: "fixture memory pressure" });
    held.release();
    assert.equal(await dispatch, constraint === "exclusive lease" ? "busy" : "resources");
    assert.equal(h.starts.length, 0);
    assertUnclaimed(h, "capacity-race");
    assert.equal(h.board().tasks[0].runFailures, undefined);
  });
}

test("cluster advisors obey the real pool's AI width and retain their task target while queued", async () => {
  const h = executorHost({ mode: "cluster", realPool: true, poolParallel: 2, aiParallel: 1, tasks: [task("pool")] });
  const held = holdSupport(h);
  const dispatch = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 1 && h.pool.queue.length === 1);
  assert.equal(h.pool.running.size, 1);
  assert.equal(h.supportCalls.length, 1, "one AI slot admits only one advisor");
  assert.equal(h.pool.queue[0].role, "cluster-reviewer");
  assert.equal(h.pool.queue[0].target.id, "pool");
  held.release();
  await flushUntil(() => held.pending.length === 1 && h.supportCalls.length === 2);
  assert.equal(h.pool.running.size, 1);
  assert.equal(h.pool.queue.length, 0);
  assert.equal(h.starts.length, 0, "the builder still awaits the second advisor");
  held.release(); await dispatch;
  assert.equal(h.pool.running.size, 0);
  assert.equal(h.env.projectAgentJobs, 0);
  assert.equal(h.starts.length, 1);
  assert.match(h.starts[0].child.prompt, /cluster-planner finding/);
  assert.match(h.starts[0].child.prompt, /cluster-reviewer finding/);
});

test("Pause immediately releases preparation while the active HTTP advisor keeps its real pool slot", async () => {
  const h = executorHost({ mode: "cluster", realPool: true, aiParallel: 1, tasks: [task("pool-pause")] });
  const held = holdSupport(h);
  const dispatch = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 1 && h.pool.queue.length === 1);
  await h.env.assistantPause();
  assert.equal(h.pool.queue.length, 0, "queued nonjournaled support does not wait indefinitely for Resume");
  assert.equal(h.pool.running.size, 1, "already running HTTP support retains its actual pool ownership");
  await dispatch;
  assert.equal(h.supportCalls.length, 1);
  assert.equal(h.starts.length, 0);
  assertUnclaimed(h, "pool-pause");
  held.release(); await flushUntil(() => h.pool.running.size === 0);
});

test("an advisory deadline removes queued helpers and starts the builder without awaiting occupied AI slots", async () => {
  const h = executorHost({ mode: "cluster", realPool: true, aiParallel: 1, tasks: [task("deadline")] });
  let releaseBackground;
  const background = h.env.enqueue("briefer", () => new Promise((resolve) => { releaseBackground = resolve; }), { ai: true, key: "background" });
  const dispatch = h.env.spawnNextJob();
  await flushUntil(() => h.pool.queue.length === 2 && Boolean(releaseBackground));
  assert.equal(h.supportCalls.length, 0);
  const deadline = h.timers.find((timer) => timer.delay === 90000 && !timer.cancelled);
  assert.ok(deadline);
  h.advance(90000); deadline.fn();
  await dispatch;
  assert.equal(h.starts.length, 1);
  assert.equal(h.supportCalls.length, 0);
  assert.equal(h.pool.queue.length, 0);
  assert.equal(h.pool.running.size, 1, "unrelated HTTP work keeps its own slot");
  assert.ok(h.autopilot.clusterAgents.every((row) => row.status === "skipped" && /time limit/i.test(row.step)));
  releaseBackground({ ok: true, text: "Finished background request" }); await background;
  await flushUntil(() => h.pool.running.size === 0);
  assert.equal(h.supportCalls.length, 0, "expired queued helpers never spend a later call");
});

test("mode cancellation frees the claim immediately and late HTTP results cannot overwrite a replacement run", async () => {
  const h = executorHost({ mode: "cluster", realPool: true, tasks: [task("replacement")] });
  const held = holdSupport(h);
  const firstDispatch = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  const oldRun = h.autopilot.jobs[0].id;
  await h.env.setAutopilot({ mode: "swarm" });
  await firstDispatch;
  assertUnclaimed(h, "replacement");
  assert.equal(held.pending.length, 2, "cancellation does not pretend network transports ended");
  assert.equal(h.pool.running.size, 2);
  const replacementDispatch = h.env.spawnNextJob();
  held.release();
  await flushUntil(() => held.pending.length === 2);
  held.release();
  assert.equal(await replacementDispatch, "spawned");
  const replacement = h.autopilot.jobs[0];
  assert.notEqual(replacement.id, oldRun);
  const status = h.autopilot.clusterAgents;
  held.release(); await flushUntil(() => h.pool.running.size === 0);
  assert.equal(h.autopilot.clusterAgents, status, "late findings cannot reattach old agent state");
  assert.equal(status.length, 2);
  assert.equal(h.autopilot.jobs[0], replacement);
  assert.equal(h.board().tasks[0].runId, replacement.id);
  assert.equal(h.starts.length, 1);
  assert.ok(status.every((agent) => agent.id.startsWith(replacement.id) && agent.mode === "swarm"));
});

test("unavailable HTTP assistance remains visible and does not block an otherwise configured builder", async () => {
  const h = executorHost({ mode: "cluster", tasks: [task("keyless")] });
  h.env.resolveAiRoute = async () => ({ ok: false, error: "No saved HTTP key" });
  h.wake(); await h.pump();
  assert.equal(h.supportCalls.length, 0);
  assert.deepEqual(h.starts.map((row) => row.taskId), ["keyless"]);
  assert.equal(h.autopilot.clusterAgents.length, 2);
  assert.ok(h.autopilot.clusterAgents.every((row) => ["skipped", "failed"].includes(row.status)));
  assert.match(JSON.stringify(h.autopilot.clusterAgents), /key|HTTP|unavailable/i);
});

test("one failed advisor cannot discard the successful peer's findings or hold the task forever", async () => {
  const h = executorHost({ mode: "cluster", tasks: [task("partial")] });
  const complete = h.env.httpAssistantCall;
  h.env.httpAssistantCall = async (...args) => {
    const result = await complete(...args);
    return args[4].taskType === "cluster-reviewer" ? { ok: false, error: "fixture review service unavailable" } : result;
  };
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["partial"]);
  assert.match(h.starts[0].child.prompt, /cluster-planner finding/);
  assert.ok(h.autopilot.clusterAgents.some((row) => row.role === "reviewer" && row.status === "failed"));
});

// Stop all lands while a claim's advisory is in flight: the reap releases the
// claim, then the dispatch resumes and reaches its own paused gate. The
// release ledger measures why claims are dropped, so it gets one row, not two.
test("a claim released by a reap and then by its own gate records one release", async () => {
  const h = executorHost({ tasks: [task("stop-mid-advisory")] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const http = h.env.httpAssistantCall;
  h.env.httpAssistantCall = async (...args) => { await gate; return http(...args); };
  h.wake();
  const pumping = h.pump();
  const turns = async (predicate) => {
    for (let turn = 0; turn < 100 && !predicate(); turn += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(predicate(), "the claim's advisory must be in flight");
  };
  await turns(() => typeof h.autopilot.jobs[0]?.reap === "function" && (h.autopilot.clusterAgents ?? []).some((agent) => agent.status === "running"));
  const entry = h.autopilot.jobs[0];
  h.autopilot.execute = false;
  h.autopilot.clusterCancel?.("New work stopped");
  await entry.reap(1, "stopped by user");
  release();
  await pumping;
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
  const rows = h.records.filter((row) => row?.event === "release");
  assert.deepEqual(rows.map((row) => row.reason), ["stopped by user"]);
  assert.equal(h.board().tasks[0].status, "open");
  assert.equal(h.board().tasks[0].runId, undefined);
});

test("a claim dropped at the capacity gate reuses its answered advisory when re-claimed", async () => {
  let starved = false;
  const h = executorHost({ mode: "cluster", tasks: [task("starved")], workerCapacity: async () => (starved
    ? { canStart: false, reason: "Machine memory is low (382 MB available; 440 MB needed before another worker).", resources: null }
    : { canStart: true, reason: null, resources: { cpuPercent: 15, availableMemoryMB: 8192, totalMemoryMB: 32768 } }) });
  const held = holdSupport(h);
  const first = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  starved = true;
  held.release();
  assert.equal(await first, "resources");
  assertUnclaimed(h, "starved");
  assert.equal(h.supportCalls.length, 2, "the first claim paid for both advisors before the gate cut it");
  assert.equal(h.contextCalls.length, 1, "the reference search also ran once");
  starved = false;
  const second = h.env.spawnNextJob();
  assert.equal(await second, "spawned");
  assert.equal(h.supportCalls.length, 2, "the re-claim does not pay for the same two calls again");
  assert.equal(h.contextCalls.length, 1, "the re-claim does not repeat the reference search");
  assert.deepEqual(h.starts.map((row) => row.taskId), ["starved"]);
  assert.match(h.starts[0].child.prompt, /cluster-planner finding/);
  assert.match(h.starts[0].child.prompt, /cluster-reviewer finding/);
  assert.ok(h.autopilot.clusterAgents.every((row) => row.status === "done" && /reused from an earlier claim/i.test(row.step)));
});

test("advice answered after the claim was released is neither briefed nor kept for the re-claim", async () => {
  const h = executorHost({ mode: "cluster", tasks: [task("tripped")] });
  const held = holdSupport(h);
  const first = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  // A sibling's third infra failure trips the breaker: finish() sets execute
  // false directly, with no clusterCancel, while both advisors are in flight.
  h.autopilot.execute = false;
  held.release();
  assert.equal(await first, "empty");
  assertUnclaimed(h, "tripped");
  assert.ok(h.autopilot.clusterAgents.every((row) => row.status !== "done"), "a discarded answer is not shown as findings");
  h.autopilot.execute = true;
  const second = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  held.release();
  assert.equal(await second, "spawned");
  assert.equal(h.supportCalls.length, 4, "the re-claim asks the advisors again");
  assert.doesNotMatch(h.starts[0].child.prompt, /Advisory cancelled/);
  assert.match(h.starts[0].child.prompt, /cluster-planner finding/);
});

test("an advisory where both advisors failed is not reused, so the re-claim asks again", async () => {
  let starved = false;
  const h = executorHost({ mode: "cluster", tasks: [task("outage")], workerCapacity: async () => (starved
    ? { canStart: false, reason: "Machine memory is low (382 MB available; 440 MB needed before another worker).", resources: null }
    : { canStart: true, reason: null, resources: { cpuPercent: 15, availableMemoryMB: 8192, totalMemoryMB: 32768 } }) });
  const complete = h.env.httpAssistantCall;
  h.env.httpAssistantCall = async (...args) => { await complete(...args); return { ok: false, error: "429 rate limited" }; };
  const held = holdSupport(h);
  const first = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  starved = true;
  held.release();
  assert.equal(await first, "resources");
  assert.equal(h.supportCalls.length, 2);
  starved = false;
  const second = h.env.spawnNextJob();
  await flushUntil(() => held.pending.length === 2);
  held.release();
  assert.equal(await second, "spawned");
  assert.equal(h.supportCalls.length, 4, "failed advice is asked for again, not reused");
  assert.equal(h.contextCalls.length, 2);
  assert.deepEqual(h.starts.map((row) => row.taskId), ["outage"]);
});
