import test from "node:test";
import assert from "node:assert/strict";
import { executorHost } from "./fixtures/host_executor.mjs";

const task = (id, extra = {}) => ({ id, title: `Implement resource fixture ${id}`, prompt: `Implement ${id} within its own module.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });
const healthy = () => ({ canStart: true, reason: null, resources: { lagMs: 0, cpuPercent: 15, availableMemoryMB: 8192, totalMemoryMB: 32768 } });
const pressure = (kind) => ({
  canStart: false,
  reason: kind === "lag" ? "Machine responsiveness: waiting for UI lag to recover" : "Machine memory pressure: emergency reserve is exhausted",
  resources: { lagMs: kind === "lag" ? 250 : 0, cpuPercent: 20, availableMemoryMB: kind === "memory" ? 128 : 8192, totalMemoryMB: 32768 },
});
const assertUnclaimed = (h, id) => {
  const saved = h.board().tasks.find((row) => row.id === id);
  assert.equal(saved.status, "open");
  assert.equal(saved.runId, undefined);
  assert.equal(saved.lease, undefined);
};

test("machine-managed scheduling starts more than three independent workers without waiting for completion", async () => {
  const h = executorHost({ adaptiveParallel: true, parallel: 1, tasks: Array.from({ length: 5 }, (_, index) => task(`independent-${index}`)) });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 5);
  assert.equal(h.autopilot.jobs.length, 5, "all workers coexist before any completion event");
  assert.equal(h.registry.size, 5, "each worker retains its own file claim");
  assert.ok(h.board().tasks.every((row) => row.status === "active"));
  assert.ok(h.capacityCalls.length >= 10, "admission is measured before and after every durable claim");
  assert.equal(h.autopilot.parallel, 1, "adaptive admission does not overwrite the retained manual width");
});

test("a pinned user request starts while three other workers are still running", async () => {
  const h = executorHost({ adaptiveParallel: true, parallel: 3, tasks: [task("first"), task("second"), task("third")] });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 3);
  const firstRuns = h.autopilot.jobs.map((row) => row.id);
  h.edit((board) => board.tasks.push(task("requested", { pin: true, pinAt: h.now(), createdAt: h.now() })));
  h.wake("work on it"); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second", "third", "requested"]);
  assert.ok(firstRuns.every((id) => h.autopilot.jobs.some((row) => row.id === id)), "starting requested work does not terminate or replace an existing worker");
  assert.equal(h.terminations.length, 0);
});

for (const kind of ["lag", "memory"]) {
  test(`${kind} pressure defers fresh work without creating a durable or file claim`, async () => {
    const decision = pressure(kind);
    const h = executorHost({ adaptiveParallel: true, tasks: [task("held", { pin: true })], workerCapacity: async () => decision });
    h.wake(); await h.pump();
    assert.equal(h.starts.length, 0);
    assert.equal(h.autopilot.jobs.length, 0);
    assert.equal(h.registry.size, 0);
    assertUnclaimed(h, "held");
    assert.equal(h.autopilot.waiting, decision.reason, "the operator sees the measured reason for the delay");
    assert.equal(h.board().tasks[0].runFailures, undefined, "resource waits are not task failures");
  });
}

test("resource recovery fills the queue while the already running workers keep their claims", async () => {
  let underPressure = true;
  const h = executorHost({ adaptiveParallel: true, parallel: 1, tasks: [task("first"), task("second"), task("third")], workerCapacity: async ({ running }) => underPressure && running >= 2 ? pressure("lag") : healthy() });
  h.wake(); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second"]);
  assertUnclaimed(h, "third");
  assert.match(h.autopilot.waiting, /responsiveness/);
  underPressure = false;
  h.wake("machine performance recovered"); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "second", "third"]);
  assert.equal(h.autopilot.jobs.length, 3);
  assert.equal(h.registry.size, 3);
  assert.equal(h.autopilot.waiting, null);
  assert.equal(h.terminations.length, 0);
});

test("pressure arriving during the durable claim releases that claim before creating a child", async () => {
  let claimed = false;
  const h = executorHost({ adaptiveParallel: true, tasks: [task("race")], workerCapacity: async () => claimed ? pressure("memory") : healthy() });
  const mutate = h.env.mutateBoard;
  h.env.mutateBoard = async (fn) => {
    const result = await mutate(fn);
    if (h.board().tasks[0].runId) claimed = true;
    return result;
  };
  h.wake(); await h.pump();
  assert.ok(claimed, "the test crosses the durable claim boundary");
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.jobs.length, 0);
  assert.equal(h.registry.size, 0);
  assertUnclaimed(h, "race");
  assert.match(h.autopilot.waiting, /memory pressure/);
});

// Between the durable claim and the spawn the job owns a row, a slot and its
// file claims, but has no child — so `stop` is not how it is released. Stop and
// the ghost sweeper both reclaim through `reap`, and until one is assigned
// neither can: housekeeping keeps refreshing the lease of anything still in
// autopilot.jobs, so nothing requeues the row either.
test("a claimed job carries a reaper before its worker exists", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("pre-spawn")] });
  const context = h.env.taskContext;
  let observed = null;
  h.env.taskContext = { ...context, buildTaskHandoff: (...args) => {
    const entry = h.autopilot.jobs.at(-1);
    observed = { reap: typeof entry?.reap, child: entry?.child, claimed: h.board().tasks[0].runId === entry?.id };
    return context.buildTaskHandoff(...args);
  } };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.ok(observed, "the fixture must reach the window between the claim and the spawn");
  assert.equal(observed.claimed, true, "the row is already claimed here");
  assert.equal(observed.child, null, "no child exists yet, so stop() cannot release it");
  assert.equal(observed.reap, "function");
});

test("a throw after the durable claim releases it instead of stranding the slot", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("unreadable-brief")] });
  h.env.taskContext = { ...h.env.taskContext, buildTaskHandoff: () => { throw new Error("fixture brief is unreadable"); } };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0, "a half-built prompt must never reach a worker");
  assert.equal(h.autopilot.jobs.length, 0, "the slot returns to the pool");
  assert.equal(h.registry.size, 0, "the file claims are dropped with it");
  assertUnclaimed(h, "unreadable-brief");
});

test("a request typed into the inbox with no title starts under a title taken from its prompt", async () => {
  // Exactly what the Explorer's request box files: { prompt, source: "manual" }.
  const h = executorHost({ parallel: 2, requests: [{ prompt: "Make the header sticky\nIt scrolls away on long pages.", at: 5, source: "manual" }] });
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 1, "the manual request starts instead of throwing after its claim");
  assert.equal(h.autopilot.jobs[0].title, "Make the header sticky");
  assert.equal(h.board().requests[0].status, "running");
  assert.equal(h.board().requests[0].title, undefined, "the inbox row itself is not rewritten");
});

test("a claim the ghost sweep released during a slow worktree checkout never launches", async () => {
  const h = executorHost({ parallel: 2, tasks: [task("slow-checkout")] });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const discarded = [];
  let prepared = 0;
  h.env.executorWorktrees = {
    enabled: () => true,
    prepare: async ({ root, runId }) => { prepared += 1; await gate; return { root, path: `${root}/.mefi/worktrees/${runId}`, branch: `mefi/${runId}`, runId }; },
    discard: async (worktree) => { discarded.push(worktree); return { discarded: true }; },
    settle: async () => ({ merged: true }),
  };
  const fill = h.env.spawnNextJob();
  for (let turn = 0; turn < 200 && !prepared; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prepared, 1, "dispatch reached the checkout");
  const entry = h.autopilot.jobs[0];
  // The checkout outlasts the supervisor's two-minute sweep, which reaps the claim.
  h.advance(130000);
  h.env.assistantSuperviseJobs(h.now());
  for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(entry.finished, true);
  assertUnclaimed(h, "slow-checkout");
  release();
  assert.equal(await fill, "lost");
  assert.equal(h.starts.length, 0, "a released claim must not become an untracked worker");
  assert.equal(discarded.length, 1, "its checkout goes back");
});

test("the post-claim admission counts existing workers without counting its own pending start twice", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("last-available")], workerCapacity: async ({ running }) => running < 1 ? healthy() : pressure("memory") });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.deepEqual(h.capacityCalls.slice(0, 2).map((row) => row.running), [0, 0]);
  assert.equal(h.capacityCalls[1].force, true, "the post-claim read bypasses cached pre-claim measurements");
  assert.equal(h.autopilot.jobs.length, 1);
});

test("admission forwards measured UI lag and forces a fresh post-claim responsiveness check", async () => {
  const probes = [];
  const h = executorHost({ adaptiveParallel: true, tasks: [task("lag-forwarding")] });
  h.env.measureWorkerLag = async (options) => {
    probes.push({ ...options });
    return options.force ? 22 : 8;
  };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.deepEqual(probes.slice(0, 2), [{ force: false }, { force: true }]);
  assert.deepEqual(h.capacityCalls.slice(0, 2).map((row) => row.lagMs), [8, 22]);
});

test("manual width remains a cap while measured resource pressure can hold work below that cap", async () => {
  let underPressure = false;
  const h = executorHost({ adaptiveParallel: false, parallel: 2, tasks: [task("first"), task("second"), task("third")], workerCapacity: async () => underPressure ? pressure("lag") : healthy() });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 2);
  assertUnclaimed(h, "third");
  underPressure = true;
  await h.finish("first"); await h.pump();
  assert.equal(h.starts.length, 2, "a free manual slot cannot bypass resource pressure");
  assertUnclaimed(h, "third");
  assert.match(h.autopilot.waiting, /responsiveness/);
  underPressure = false;
  h.wake("resources available"); await h.pump();
  assert.equal(h.starts.length, 3);
  assert.equal(h.autopilot.jobs.length, 2);
  assert.equal(h.autopilot.parallel, 2);
});

test("a full manual pool explains the hold and starts the queued task after a worker finishes", async () => {
  const h = executorHost({ adaptiveParallel: false, parallel: 1, tasks: [task("first"), task("waiting", { createdAt: 2 })] });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.match(h.autopilot.waiting, /Manual worker limit reached \(1\/1\).*worker to finish/);
  assertUnclaimed(h, "waiting");
  h.wake("work on waiting task"); await h.pump();
  assert.equal(h.starts.length, 1, "another explicit request preserves the selected manual limit");
  assert.match(h.autopilot.waiting, /Manual worker limit reached/);
  await h.finish("first"); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["first", "waiting"]);
  assert.equal(h.autopilot.parallel, 1);
});

test("an unavailable worker route exposes its reason without claiming work or growing an idle queue", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("route-held")] });
  h.env.executorRunEnv = async () => ({ error: "AI routing is z.ai-only but no z.ai key is saved" });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0);
  assertUnclaimed(h, "route-held");
  assert.equal(h.registry.size, 0);
  assert.match(h.autopilot.waiting, /Worker connection unavailable:.*no z.ai key is saved/);
  assert.ok(!h.roleRequests.includes("compactor"), "a blocked route is not an empty queue to grow");
  h.env.executorRunEnv = async () => ({ via: "fixture", modelArgs: "", env: {} });
  h.wake("worker connection repaired"); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.waiting, null, "a successful retry clears the route hold");
});

test("unexpected dispatch errors stay visible and release the fill loop for a later retry", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("dispatch-held")] });
  const spawnNextJob = h.env.spawnNextJob;
  h.env.spawnNextJob = async () => { throw new Error("fixture work store unavailable"); };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0);
  assertUnclaimed(h, "dispatch-held");
  assert.match(h.autopilot.waiting, /Worker could not start: fixture work store unavailable/);
  assert.ok(!h.roleRequests.includes("compactor"));
  h.env.spawnNextJob = spawnNextJob;
  h.wake("work store recovered"); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.waiting, null);
});

test("machine-managed scheduling preserves Pause and exclusive test leases", async () => {
  for (const options of [{ paused: true }, { execute: false }, { exclusive: true }]) {
    const h = executorHost({ adaptiveParallel: true, tasks: [task("held", { pin: true })], ...options });
    if (options.exclusive) h.machine.leaseStatus = async () => ({ exclusive: true });
    h.wake("explicit work request"); await h.pump();
    assert.equal(h.starts.length, 0, JSON.stringify(options));
    assert.equal(h.registry.size, 0, JSON.stringify(options));
    assertUnclaimed(h, "held");
    if (options.exclusive) assert.equal(h.autopilot.waiting, "machine busy");
    if (options.paused) assert.equal(h.state.status, "paused");
    if (options.execute === false) assert.equal(h.autopilot.execute, false);
  }
});

test("an exclusive lease arriving after the claim still rolls back under adaptive admission", async () => {
  const h = executorHost({ adaptiveParallel: true, tasks: [task("lease-race")] });
  let leases = 0;
  h.machine.leaseStatus = async () => ({ exclusive: ++leases > 1 });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.autopilot.jobs.length, 0);
  assertUnclaimed(h, "lease-race");
  assert.equal(h.autopilot.waiting, "machine busy");
});

test("legacy saved worker width migrates to machine-managed mode without losing the retained manual width or Pause", async () => {
  const h = executorHost({ savedSettings: { ui: { autopilot: { enabled: false, execute: false, parallel: 1, minutes: 7 } } } });
  await h.env.bootAutopilot();
  assert.equal(h.autopilot.adaptiveParallel, true);
  assert.equal(h.autopilot.parallel, 1);
  assert.equal(h.autopilot.enabled, false);
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.settings().ui.autopilot.adaptiveParallel, true);
  assert.equal(h.settings().ui.autopilot.parallel, 1);
});

test("an explicit manual mode survives settings saves and a fresh host boot", async () => {
  const first = executorHost({ adaptiveParallel: true, parallel: 3 });
  await first.env.setAutopilot({ adaptiveParallel: false, parallel: 1 });
  assert.equal(first.settings().ui.autopilot.adaptiveParallel, false);
  await first.env.setAutopilot({ autoBuild: false });
  const restarted = executorHost({ savedSettings: first.settings() });
  await restarted.env.bootAutopilot();
  assert.equal(restarted.autopilot.adaptiveParallel, false);
  assert.equal(restarted.autopilot.parallel, 1);
  assert.equal(restarted.autopilot.autoBuild, false);
});

test("switching a full manual pool to machine-managed mode dispatches existing ready work immediately", async () => {
  const h = executorHost({ adaptiveParallel: false, parallel: 1, tasks: [task("running"), task("waiting")] });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  await h.env.setAutopilot({ adaptiveParallel: true });
  await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["running", "waiting"]);
  assert.equal(h.autopilot.jobs.length, 2);
  assert.equal(h.autopilot.parallel, 1);
  assert.equal(h.autopilot.enabled, true);
  assert.equal(h.autopilot.execute, true);
});

test("supervision retries a resource-held adaptive queue without waiting for an existing worker to finish", async () => {
  let underPressure = true;
  const h = executorHost({ adaptiveParallel: true, parallel: 1, tasks: [task("running"), task("waiting")], workerCapacity: async ({ running }) => underPressure && running >= 1 ? pressure("lag") : healthy() });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  const before = h.roleRequests.length;
  h.advance(29000);
  h.env.assistantSuperviseJobs(h.now());
  assert.equal(h.roleRequests.length, before, "supervision respects the retry interval");
  underPressure = false;
  h.advance(2000);
  h.env.assistantSuperviseJobs(h.now());
  assert.equal(h.roleRequests.length, before + 1);
  await h.pump();
  assert.equal(h.starts.length, 2);
  assert.equal(h.autopilot.jobs.length, 2);
  assert.equal(h.autopilot.waiting, null);
});

test("switching to a full manual limit during resource measurement prevents a stale adaptive admission", async () => {
  const h = executorHost({ adaptiveParallel: true, parallel: 1, tasks: [task("running")] });
  h.wake(); await h.pump();
  h.edit((board) => board.tasks.push(task("waiting", { createdAt: 2 })));
  h.machine.workerCapacity = async () => {
    h.autopilot.adaptiveParallel = false;
    return healthy();
  };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.jobs.length, 1);
  assertUnclaimed(h, "waiting");
});

for (const pausedDuringRetry of [false, true]) test(`a failed resource rollback retains ownership and recovers${pausedDuringRetry ? " without bypassing Pause" : " without a stranded claim"}`, async () => {
  let underPressure = false, rollbackFailureArmed = false;
  const h = executorHost({ adaptiveParallel: true, tasks: [task("rollback")], workerCapacity: async () => underPressure ? pressure("memory") : healthy() });
  const mutate = h.env.mutateBoard;
  h.env.mutateBoard = async (fn) => {
    const result = await mutate(fn);
    if (!rollbackFailureArmed && h.board().tasks[0].runId) {
      rollbackFailureArmed = true;
      underPressure = true;
      h.failNextWrite();
    }
    return result;
  };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.jobs[0]?.settlementPending, true, "failed rollback retains ownership until it can be persisted");
  assert.equal(h.registry.size, 1);
  const retry = h.timers.find((timer) => timer.delay === 5000 && !timer.cancelled);
  assert.ok(retry, "an unstarted worker has an automatic claim-release retry");
  underPressure = false;
  if (pausedDuringRetry) h.state.status = "paused";
  h.advance(5000);
  retry.fn();
  for (let step = 0; step < 30; step += 1) await Promise.resolve();
  await h.pump();
  if (pausedDuringRetry) {
    assert.equal(h.starts.length, 0, "storage recovery must not restart paused work");
    assert.equal(h.autopilot.jobs.length, 0);
    assert.equal(h.registry.size, 0);
    assertUnclaimed(h, "rollback");
    h.state.status = "running";
    h.wake("resume after resource rollback"); await h.pump();
  }
  assert.equal(h.starts.length, 1, "successful storage retry must release or recover the unstarted claim");
  assert.equal(h.autopilot.jobs.length, 1);
  assert.ok(h.autopilot.jobs[0].child, "the sole remaining claim belongs to the newly started process");
  assert.equal(h.registry.size, 1);
});

// The Policy Lab reads a decision only through the attempt it started, so a
// pick whose claim is released before launch records none; a launched pick
// writes its decision beside its attempt, stamped at the moment of the pick.
test("a released claim records no Policy Lab decision and a launched pick records one beside its attempt", async () => {
  let claimed = false;
  const h = executorHost({ adaptiveParallel: true, tasks: [task("gated")], workerCapacity: async () => claimed ? pressure("memory") : healthy() });
  h.env.resolveActivePolicyIdentity = async () => ({ id: "baseline", version: 1, kind: "baseline", hash: "fixture" });
  // The descriptor and the record counter live outside the sliced dispatcher;
  // their shapes are not under test.
  h.env.policyActionDescriptor = (_module, candidate, index) => ({ id: `action_${index}`, title: candidate.title });
  h.env.policyRecordSeq = 0;
  const mutate = h.env.mutateBoard;
  h.env.mutateBoard = async (fn) => {
    const result = await mutate(fn);
    if (h.board().tasks[0].runId) claimed = true;
    return result;
  };
  h.wake(); await h.pump();
  assert.ok(claimed, "the pick crossed the claim before pressure released it");
  const lab = () => h.records.filter((row) => Array.isArray(row));
  assert.deepEqual(lab().map(([kind]) => kind), [], "the released pick leaves no decision");
  claimed = false;
  h.env.mutateBoard = mutate;
  h.wake("machine performance recovered"); await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["gated"]);
  assert.deepEqual(lab().map(([kind]) => kind).slice(0, 2), ["decision", "attempt-start"]);
  const [[, decision], [, start]] = lab();
  assert.equal(start.decisionId, decision.decisionId);
  assert.ok(Number.isFinite(decision.at), "the decision keeps its own pick-time stamp");
  assert.equal(decision.stopReason, null);
});
