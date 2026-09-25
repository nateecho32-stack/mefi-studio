// The host's verification and dispatch boundary, with memory-only stores.
// No timers, child processes, live profiles, or model calls are started.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import * as history from "../scripts/task-history.mjs";
import backlog from "../scripts/backlog.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import taskDelegation from "../scripts/task-delegation.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import executorActivity from "../scripts/executor-activity.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Host boundary exists: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => structuredClone(value);
const NOW = 100000;
const clock = class extends Date { static now() { return NOW; } };

function verificationHost({ tasks = [], requests = [], unavailable = [], changes = null } = {}) {
  let board = { tasks: copy(tasks), requests: copy(requests) };
  const notes = [];
  const env = vm.createContext({
    Date: clock, crypto, backlog, taskHandoffs, taskDelegation, executorResume, executorProcessAlive: () => false, process: { pid: 1 }, EXECUTOR_PARALLEL_CAP: 3, autopilot: { jobs: [] }, assistantState: { prefs: {} }, assistantModule: assistant,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests",
    getAssistant: async () => assistant, loadModule: async () => history,
    getEyes: async () => ({ readJson: async (key) => copy(board[key] ?? []), listChanges: ({ sessionId }) => {
      if (unavailable.includes(sessionId)) throw new Error("fixture evidence store unavailable");
      return changes ?? [{ file: "fixture.js", status: "completed" }];
    } }),
    getReceiptsModule: async () => null, policyRecord() {}, refreshAutopilotQueue: async () => {},
    assistantClip: (value, limit) => String(value ?? "").slice(0, limit), logLine: (text) => notes.push(text),
    mutateBoard: async (mutate) => {
      const next = copy(board);
      const patch = mutate(next);
      for (const key of ["tasks", "requests"]) if (patch[key]) next[key] = patch[key];
      board = next;
      return { ...patch, written: ["tasks"] };
    },
  });
  vm.runInContext(section("const VERIFY_DWELL_MS =", "// One autopilot tick:"), env);
  return { env, board: () => board, notes };
}

// The foreman, the post-verification kick and backlogControl "run" can all
// ask for housekeeping at once. Each pass loads its history module first, so
// the loads count the passes.
test("overlapping housekeeping calls share one pass and buy exactly one re-run", async () => {
  const { env } = verificationHost({ tasks: [{ id: "open", title: "Open task", status: "open" }] });
  let passes = 0;
  env.loadModule = async () => { passes += 1; return history; };
  await Promise.all([env.autopilotHousekeeping(), env.autopilotHousekeeping(), env.autopilotHousekeeping()]);
  assert.equal(passes, 2, "the first call's pass, then one re-run for everything that asked during it");
  await env.autopilotHousekeeping();
  await env.autopilotHousekeeping();
  assert.equal(passes, 4, "calls that do not overlap each get their own pass");
});

test("a failed housekeeping pass rejects its joined callers and does not wedge the next call", async () => {
  const { env } = verificationHost();
  let passes = 0;
  env.loadModule = async () => {
    passes += 1;
    if (passes === 1) throw new Error("fixture module load failed");
    return history;
  };
  const results = await Promise.allSettled([env.autopilotHousekeeping(), env.autopilotHousekeeping()]);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(passes, 1, "a failed pass is not re-run behind its callers' backs");
  await env.autopilotHousekeeping();
  assert.equal(passes, 2, "the next call starts a fresh pass");
});

test("a housekeeping call for another project waits for the running pass instead of joining it", async () => {
  const { env } = verificationHost();
  let project = "first";
  env.projects = { current: () => ({ id: project }) };
  const gates = [];
  let passes = 0;
  env.loadModule = async () => { passes += 1; await new Promise((resolve) => gates.push(resolve)); return history; };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const first = env.autopilotHousekeeping();
  project = "second";
  const second = env.autopilotHousekeeping();
  await flush();
  assert.equal(passes, 1, "nothing for the second project runs under the first project's pass");
  gates[0]();
  const firstEnded = await Promise.race([first.then(() => true), flush().then(() => false)]);
  assert.equal(firstEnded, true, "the first project's flight ends after its own pass: no re-run was bought for it");
  await flush();
  assert.equal(passes, 2, "then the second project gets a pass of its own");
  gates[1]();
  await second;
});

test("each ordinary foreman pass verifies prerequisites before dispatching the next task", async () => {
  const first = { id: "first", title: "First task", status: "awaiting_verification", lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "first-session" } };
  const second = { id: "second", title: "Next task", status: "open", dependsOn: ["first"] };
  const { env, board } = verificationHost({ tasks: [first, second] });
  const order = [];
  Object.assign(env, {
    assistantState: { status: "running", prefs: { backlogMode: false }, agents: [] },
    autopilot: { execute: true, parallel: 1, jobs: [] },
    classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => { order.push("promote"); },
    admitBacklogIdeas: async () => { throw new Error("ordinary mode must not admit backlog ideas"); },
    executeNextRequest: async () => {
      order.push("dispatch");
      assert.equal(board().tasks[0].status, "done");
      assert.equal(backlog.workState(board().tasks[1], NOW, { tasks: board().tasks }).stage, "ready");
      env.autopilot.jobs.push({ id: "second-run", taskId: "second", title: "Next task" });
    },
    assistantHop: async () => {}, taskTarget: (id) => ({ kind: "task", id }),
    assistantClip: (text) => text, assistantLog: (_kind, text) => order.push(text),
    assistantModule: { ...assistant, intelLines: () => [] },
  });
  vm.runInContext(section("async function assistantForemanJob(", "// The thinker:"), env);
  const result = await env.assistantForemanJob(NOW, {});
  assert.deepEqual(order.slice(0, 2), ["promote", "dispatch"]);
  assert.equal(result.intel.handedOut, 1);
});

// Legacy "verifying" inbox rows (direct request execution is retired) are
// moved onto the board by the same pass and settle as ordinary tasks.
test("one unavailable session leaves its verification budget intact while other work settles", async () => {
  const attempt = (sessionId) => ({ startedAt: 1, at: 2, code: 0, sessionId, runId: sessionId });
  const { env, board, notes } = verificationHost({
    tasks: [
      { id: "blocked", title: "Waiting on evidence", status: "awaiting_verification", verifyAttempts: 2, lastAttempt: attempt("missing") },
      { id: "ready", title: "Evidenced work", status: "awaiting_verification", lastAttempt: attempt("present") },
    ],
    requests: [
      { title: "Request waiting on evidence", status: "verifying", verifyAttempts: 1, lastAttempt: attempt("missing") },
      { title: "Verified request", status: "verifying", at: 5, lastAttempt: attempt("request-session") },
    ],
    unavailable: ["missing"],
  });
  await env.autopilotHousekeeping();
  const data = board();
  const byTitle = (title) => data.tasks.find((task) => task.title === title);
  assert.equal(byTitle("Waiting on evidence").status, "awaiting_verification");
  assert.equal(byTitle("Waiting on evidence").verifyAttempts, 2);
  assert.equal(byTitle("Evidenced work").status, "done");
  // Deliberately changed: the move is two-phase (the file store writes the
  // inbox before the tasks), so the rows stay until a pass sees their tasks.
  assert.equal(data.requests.length, 2, "both legacy rows stay until their tasks are saved");
  assert.equal(byTitle("Request waiting on evidence").status, "awaiting_verification", "an unavailable store spends no budget on the migrated card either");
  assert.equal(byTitle("Request waiting on evidence").verifyAttempts, 1);
  assert.equal(byTitle("Verified request").status, "done");
  assert.equal(notes.filter((line) => line.includes("verification waiting")).length, 2);
  assert.equal(notes.filter((line) => /legacy request .* was verifying; moved to the board/.test(line)).length, 2, "one line per migrated row");
  await env.autopilotHousekeeping();
  assert.equal(board().requests.length, 0, "both legacy rows left the inbox once their tasks were on the board");
  assert.equal(board().tasks.length, 4, "no task is added twice");
  assert.equal(board().tasks.find((task) => task.title === "Verified request").status, "done");
});

test("malformed review rows recover through the bounded retry gate instead of waiting forever", async () => {
  const { env, board } = verificationHost({ tasks: [
    { id: "orphan", title: "Review without attempt", status: "awaiting_verification" },
    { id: "exhausted", title: "Last review attempt", status: "awaiting_verification", verifyAttempts: 2 },
    { id: "fresh", title: "Flushing session", status: "awaiting_verification", lastAttempt: { startedAt: NOW - 2000, at: NOW - 1000, code: 0, sessionId: "fresh" } },
  ] });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "open");
  assert.equal(board().tasks[0].verifyAttempts, 1);
  assert.equal(board().tasks[0].verification.state, "unverified");
  assert.equal(board().tasks[0].nextRunAt, NOW + 60000);
  assert.equal(board().tasks[1].verification.state, "failed");
  assert.equal(backlog.workState(board().tasks[1], NOW).stage, "blocked");
  assert.equal(board().tasks[2].status, "awaiting_verification", "fresh evidence retains the flush dwell");
});

test("a legacy verifying request cannot verify while its handed-on obligations remain open", async () => {
  const { env, board } = verificationHost({ requests: [{
    title: "Partially implemented request", at: 5, status: "verifying", remaining: ["Finish the requested integration"],
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "partial-session", runId: "partial-run", result: { parts: { remaining: "none" } } },
  }] });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks.length, 1);
  await env.autopilotHousekeeping();
  assert.equal(board().requests.length, 0, "the row moved onto the board (it leaves on the pass after its task is saved)");
  assert.equal(board().tasks.length, 1);
  const task = board().tasks[0];
  assert.equal(task.status, "open", "a partial attempt goes back for retry or review, as any task's does");
  assert.equal(task.verifyAttempts, 1);
  assert.equal(task.nextRunAt, NOW + 60000);
  assert.deepEqual(task.remaining, ["Finish the requested integration"]);
  assert.equal(task.verification.state, "unverified", "no Done is invented for unfinished work");
});

test("a legacy verifying coordinator's delegated children name its migrated task on the board", async () => {
  const scope = "b".repeat(64);
  const ids = ["task_delegate_00000000000000000000000a", "task_delegate_00000000000000000000000b"];
  const child = (id) => ({ id, title: `Slice ${id.slice(-1)}`, status: "done", doneAt: 3, parentTaskId: null, fromRun: "run-c",
    delegatedFrom: { parentTaskId: null, parentRequestKey: "request:c", scope } });
  const { env, board, notes } = verificationHost({ tasks: [child(ids[0]), child(ids[1])], requests: [{
    title: "Shared coordinator", at: 5, status: "verifying", delegation: { version: 1, childTaskIds: ids, scope, fromRun: "run-c", admissions: [] },
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "coord-session", runId: "run-coord" },
  }] });
  await env.autopilotHousekeeping();
  const coordinator = board().tasks.find((task) => task.title === "Shared coordinator");
  assert.ok(coordinator, "the coordinator moved onto the board");
  for (const id of ids) {
    const row = board().tasks.find((task) => task.id === id);
    assert.equal(row.parentTaskId, coordinator.id, id);
    assert.equal(row.delegatedFrom.parentTaskId, coordinator.id, id);
  }
  assert.equal(board().tasks.length, 3, "no child is duplicated");
  assert.ok(notes.some((line) => /its 2 delegated tasks now name it/.test(line)));
});

test("completion reports distinguish no remaining work from real obligations", () => {
  for (const remaining of ["none", "None.", "nothing", "n/a", "no remaining work"]) {
    assert.equal(assistant.verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, resultNote: { parts: { remaining } } }).state, "verified", remaining);
  }
  for (const remaining of ["none of the tests pass", "no remaining UI work but API checks remain", "Run the regression check"]) {
    assert.equal(assistant.verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, resultNote: { parts: { remaining } } }).state, "unverified", remaining);
  }
  assert.equal(assistant.verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, remaining: ["Follow-up still required"], resultNote: { parts: { remaining: "none" } } }).state, "unverified", "a worker cannot erase persisted obligations");
});

test("failed or pending edit tools are not treated as completed file changes", async () => {
  const { env, board } = verificationHost({ tasks: [{ id: "task", title: "Edit rejected", status: "awaiting_verification", lastAttempt: { startedAt: 1, at: 2, sessionId: "edit-session", code: 0 } }],
    changes: [{ file: "failed.js", status: "error" }, { file: "pending.js", status: "running" }, { file: null, files: [], status: "completed" }],
  });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "open");
  assert.equal(board().tasks[0].verification.changedFiles, 0);
  assert.equal(board().tasks[0].verification.state, "unverified");
});

test("a run whose only changes are the TESTRUNS ledger is stamped ledgerOnly; any other file clears it", async () => {
  for (const [changes, expected] of [
    [[{ file: "TESTRUNS.md", status: "completed" }], true],
    [[{ file: "C:\\repo\\docs\\archive\\testruns-2026-09.md", status: "completed" }, { files: ["TESTRUNS.md"], status: "completed" }], true],
    [[{ file: "TESTRUNS.md", status: "completed" }, { file: "main.cjs", status: "completed" }], undefined],
    [[{ file: "docs/archive/notes.md", status: "completed" }], undefined],
  ]) {
    const { env, board } = verificationHost({ tasks: [{ id: "task", title: "Rerun the gate", status: "awaiting_verification", lastAttempt: { startedAt: 1, at: 2, sessionId: "ledger-session", code: 0 } }], changes });
    await env.autopilotHousekeeping();
    const verification = board().tasks[0].verification;
    assert.equal(verification.ledgerOnly, expected, JSON.stringify(changes));
    assert.equal(verification.changedFiles, changes.length, "the count is unchanged");
  }
});

test("failed or skipped checks cannot become completion evidence under another field name", () => {
  for (const field of ["tests", "ran", "verified", "audit"]) {
    const failure = assistant.verifyCompletion({ verdictOk: true, changedFiles: 3, hasSession: true, resultNote: { parts: { [field]: "npm test failed" } } });
    assert.equal(failure.state, "unverified", field);
    assert.match(failure.reason, /failing checks/);
    for (const text of ["not run", "skipped", "npm test was not run", "passed"]) {
      const skipped = assistant.verifyCompletion({ verdictOk: true, resultNote: { parts: { [field]: text } } });
      assert.equal(skipped.state, "unverified", `${field}: ${text}`);
      assert.equal(skipped.evidence.namedChecks, false);
    }
  }
  assert.equal(assistant.verifyCompletion({ verdictOk: true, resultNote: { parts: { tests: "npm test: 20 passed, 0 failed" } } }).state, "unverified", "passing prose alone is not execution evidence");
  assert.equal(assistant.verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [{ command: "npm test", status: "completed", exitCode: 0, passed: true, startedAt: 1000 }], resultNote: { parts: { tests: "npm test: 20 passed, 0 failed" } } }).state, "verified");
  assert.equal(assistant.verifyCompletion({ verdictOk: true, resultNote: { parts: { tests: "npm test passed", audit: "failed" } } }).state, "unverified", "all reported check fields are considered");
});

test("an overseer verification run's results are the completed task's observed checks", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "overseen", title: "Overseen work", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "overseen-session" },
    verificationRun: { key: "verification:overseen:run_1", state: "passed", at: NOW - 100, results: [{ command: "npm run check", exitCode: 0, tail: "ok" }] },
  }] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "done");
  assert.equal(task.verification.state, "verified");
  assert.deepEqual(task.verification.checks, { total: 1, passed: 1, failed: 0, pending: 0 });
  assert.equal(task.verification.reason, "1 recorded check(s) passed in the overseer's verification run", "the reason names who ran the check");
});

test("the overseer's fresh run result supersedes the worker's stale failing run of the same command", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "rerun", title: "Fresh overseer run", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "rerun-session" },
    verificationRun: { key: "verification:rerun:run_1", state: "passed", at: NOW - 100, results: [{ command: "npm test", exitCode: 0, tail: "ok" }] },
  }] });
  Object.assign(env, { getEyes: async () => ({
    readJson: async (key) => copy(board()[key] ?? []),
    listChanges: () => [{ file: "fixture.js", status: "completed" }],
    listSessionChecks: () => ({ available: true, checks: [{ command: "npm test", startedAt: 5, status: "completed", exitCode: 1, passed: false }] }),
  }) });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "done", "the overseer's later row wins the latest-wins dedupe over the worker's stale failure");
  assert.deepEqual(task.verification.checks, { total: 1, passed: 1, failed: 0, pending: 0 });
});

test("a done card whose overseer run later failed reopens on the failing evidence", async () => {
  const { env, board, notes } = verificationHost({ tasks: [{
    id: "raced", title: "Settled before its run finished", status: "done", doneAt: NOW - 500,
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "raced-session" },
    verificationRun: { key: "verification:raced:run_1", state: "failed", at: NOW - 100, results: [{ command: "npm run check", timedOut: true, tail: "killed after budget" }] },
  }] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "open");
  assert.equal(task.doneAt, undefined);
  assert.equal(task.verifyAttempts, 1);
  assert.equal(task.verification.state, "unverified");
  assert.equal(task.verification.checks, undefined, "the stale failing run is not recorded as completion evidence");
  assert.equal(task.verification.changedFiles, null);
  assert.equal(task.nextRunAt, NOW + 60000);
  assert.match(notes.join("\n"), /reopened "Settled before its run finished" — recorded checks failed/);
  // The failing command and its tail ride on the note: the retry's brief quotes the log.
  assert.equal(task.logs.at(-1).text, "reopened — overseer check failed — recorded checks failed in the overseer's verification run (npm run check failed — timed out: killed after budget) · retry 1/3");
});

test("a user's manual Done is not reopened by an overseer run that failed before it", async () => {
  const { env, board, notes } = verificationHost({ tasks: [{
    id: "manual", title: "Confirmed by hand", status: "done", doneAt: NOW - 50,
    verification: { state: "manual", at: NOW - 50 },
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "manual-session" },
    verificationRun: { key: "verification:manual:run_1", state: "failed", at: NOW - 100, results: [{ command: "npm run check", exitCode: 1, tail: "ENOENT" }] },
  }] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "done");
  assert.equal(task.verification.state, "manual");
  assert.equal(task.verifyAttempts, undefined, "no verify budget is spent");
  assert.doesNotMatch(notes.join("\n"), /reopened/);
});

// verificationRun is never cleared: a retry that queued no check of its own
// still carries the previous attempt's run, which is not evidence for it.
test("an earlier attempt's passing overseer run does not verify a later attempt", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "t", title: "Retry with nothing to show", status: "awaiting_verification",
    lastAttempt: { runId: "run_new", startedAt: 1, at: 2, sessionId: "s", code: 0 },
    verificationRun: { key: "verification:t:run_old", state: "passed", at: NOW - 100, results: [{ command: "npm run check", exitCode: 0 }] },
  }], changes: [] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "open");
  assert.equal(task.verification.state, "unverified");
  assert.match(task.verification.reason, /no attributable edits and no named checks/);
  assert.match(task.logs.at(-1).text, /^unverified — no attributable edits and no named checks · retry 1\/3$/);
});

test("an earlier attempt's failing overseer run does not fail a later attempt", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "t", title: "Retry that landed edits", status: "awaiting_verification",
    lastAttempt: { runId: "run_new", startedAt: 1, at: 2, sessionId: "s", code: 0 },
    verificationRun: { key: "verification:t:run_old", state: "failed", at: NOW - 100, results: [{ command: "npm run check", exitCode: 1, tail: "stale failure" }] },
  }] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "done");
  assert.equal(task.verification.state, "verified");
  assert.equal(task.verification.reason, "1 changed file(s) in the attempt's session");
  assert.equal(task.logs.at(-1).text, "verified — 1 changed file(s) in the attempt's session");
});

test("a queued verification run is not yet evidence", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "queued", title: "Run still draining", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "queued-session" },
    verificationRun: { key: "verification:queued:run_1", state: "queued", at: NOW - 100 },
  }], changes: [] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "open", "no attributable edits and no finished run — the done claim is retried, not accepted");
  assert.equal(task.verification.state, "unverified");
  assert.match(task.verification.reason, /no attributable edits and no named checks/);
  assert.equal(task.verifyAttempts, 1);
});

test("an unavailable local check blocks automatic completion even when the worker changed files", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "fresh-project", title: "New project", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "project-session", runId: "run_fresh" },
    verificationRun: { key: "verification:fresh-project:run_fresh", state: "failed", at: NOW - 100,
      results: [{ command: "Project verification", unavailable: true, ok: false, exitCode: null, cwd: "C:/fresh-project", tail: "No supported check found" }] },
  }] });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.notEqual(task.status, "done");
  assert.equal(task.verification.reason, "no project-local verification check is available");
});

test("a migrated verifying request verifies to done through the ordinary task verification, with the overseer run's checks", async () => {
  const { env, board, notes } = verificationHost({ requests: [{
    title: "Overseen request", at: 5, status: "verifying", runId: "run_9", lease: { pid: 7, at: 2 },
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "request-session", runId: "run_9" },
    verificationRun: { key: "verification:request:abc:run_9", state: "passed", at: NOW - 100, results: [{ command: "npm run check", exitCode: 0, tail: "ok" }] },
  }] });
  await env.autopilotHousekeeping();
  assert.equal(board().requests.length, 1, "the inbox row stays until a pass sees its task saved");
  await env.autopilotHousekeeping();
  assert.equal(board().requests.length, 0, "the inbox row is released");
  assert.equal(board().tasks.length, 1);
  const done = board().tasks[0];
  assert.match(done.id, /^task_/);
  assert.equal(done.status, "done");
  assert.equal(done.verification.state, "verified");
  assert.equal(done.verification.checks.passed, 1, "the overseer's run is this attempt's observed check");
  assert.equal(done.verification.checks.failed, 0);
  assert.equal(done.runId, undefined, "verification releases the finished run like any task's");
  assert.equal(done.lastAttempt.runId, "run_9");
  assert.deepEqual(Array.from(done.logs, (row) => row.text.split(" — ")[0]), ["moved from the request inbox to the board", "verified"]);
  assert.ok(notes.some((line) => /legacy request "Overseen request" was verifying; moved to the board/.test(line)));
  assert.ok(notes.some((line) => /verified "Overseen request"/.test(line)));
});

test("a legacy running request with no live worker goes back to the inbox; one a live run holds stays", async () => {
  const running = (title, runId) => ({ title, prompt: `${title} brief`, at: 5, source: "chat", status: "running", runId, runningAt: 3, lease: { pid: 7, at: 3 },
    runProgress: { version: 1, runId, pending: false, sessionId: `${runId}-session`, outputTail: ["half way"] } });
  const { env, board, notes } = verificationHost({ requests: [running("Lost direct run", "run_lost"), running("Held direct run", "run_live")] });
  env.autopilot.jobs.push({ id: "run_live" });
  await env.autopilotHousekeeping();
  const [lost, held] = board().requests;
  for (const gone of ["status", "runId", "lease", "runningAt"]) assert.equal(lost[gone], undefined, gone);
  assert.equal(lost.runProgress.sessionId, "run_lost-session");
  assert.equal(lost.runProgress.pending, false, "promotion can take it");
  assert.equal(lost.interruptedAttempt.sessionId, "run_lost-session");
  assert.equal(held.status, "running");
  assert.equal(held.runId, "run_live");
  assert.equal(board().tasks.length, 0, "promotion, not housekeeping, puts it on the board");
  assert.deepEqual(notes.filter((line) => /legacy request/.test(line)), ["[autopilot] legacy request \"Lost direct run\" was running (run_lost) with no live worker; back in the inbox for promotion"]);
});

test("live worker status excludes finished entries and never exposes an invalid progress fraction", () => {
  const stopping = { since: 1000, reason: "time budget", error: "access denied", retryAt: 16000 };
  const env = vm.createContext({
    EXECUTOR_PARALLEL_CAP: 3, executorActivity, autopilot: { jobs: [
      { title: "Still running", taskId: "current", progress: .3, pid: 123, stopping,
        child: {}, routeLabel: "Codex CLI", activity: { text: "Checking collisions", at: 2000 }, lastOutputAt: 2000,
        todos: [{ status: "in_progress", content: "Test wall collisions" }], todosUpdatedAt: 1500 },
      { title: "Finished and saving", finished: true, progress: 1 },
      { title: "Unknown progress", progress: NaN },
      { title: "Out of bounds", progress: 4, child: {}, sawDone: true },
    ] }, foremanStatus: () => ({ status: "done" }),
  });
  vm.runInContext(section("function autopilotStatus()", "function emitAutopilot()"), env);
  const status = env.autopilotStatus();
  assert.equal(status.running.length, 3);
  assert.equal(status.running[0].progress, .3);
  assert.equal(status.running[0].pid, undefined);
  assert.equal(status.running[0].phase, "building");
  assert.equal(status.running[0].route, "Codex CLI");
  assert.equal(status.running[0].activity, "Checking collisions");
  assert.equal(status.running[0].lastOutputAt, 2000);
  assert.equal(status.running[0].currentStep, "Test wall collisions");
  assert.equal(status.running[0].stepUpdatedAt, 1500);
  assert.deepEqual({ ...status.running[0].stopping }, stopping);
  assert.notEqual(status.running[0].stopping, stopping, "status cannot mutate the recovery controller");
  assert.equal(status.running[1].progress, undefined);
  assert.equal(status.running[1].phase, "preparing");
  assert.equal(status.running[2].progress, 1);
  assert.equal(status.running[2].phase, "finishing");
});

// Verification used to wait for the next autopilot tick (minutes) whenever a
// pass could not settle a card yet. The pass now re-arms one coalesced settle
// for the moment it can: the dwell's expiry, or a short bounded evidence retry.
test("a card inside its evidence dwell re-arms one settle pass for the moment the dwell expires", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "fresh", title: "Just finished", status: "awaiting_verification",
    lastAttempt: { startedAt: NOW - 20000, at: NOW - 10000, code: 0, sessionId: "fresh-session" },
  }] });
  const kicks = [];
  Object.assign(env, { kickVerificationSettlement: (ms) => kicks.push(ms) });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "awaiting_verification", "the dwell is respected");
  assert.deepEqual(kicks, [20250], "the pass is re-armed for the dwell's expiry, not the next tick");
});

test("a card whose overseer check is live in this process waits for that result instead of racing it", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "live", title: "Check still running", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "live-session" },
    verificationRun: { key: "verification:live:run_1", state: "queued", at: NOW - 100 },
  }] });
  const kicks = [];
  Object.assign(env, { kickVerificationSettlement: (ms) => kicks.push(ms), verificationJobs: [{ key: "verification:live:run_1" }], verificationInFlight: new Set() });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "awaiting_verification", "queued in this process: the run's own result kicks the settle");
  env.verificationJobs = [];
  env.verificationInFlight = new Set(["verification:live:run_1"]);
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "awaiting_verification", "in flight: still waited for");
  assert.deepEqual(kicks, [], "no timer is armed for a run that kicks on its own");
  env.verificationInFlight = new Set();
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "done", "once the run is no longer live the card settles on its evidence");
});

test("a stale queued stamp with no live job never blocks settlement", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "stale", title: "Queued by an earlier app session", status: "awaiting_verification",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "stale-session" },
    verificationRun: { key: "verification:stale:run_1", state: "queued", at: NOW - 100 },
  }] });
  Object.assign(env, { verificationJobs: [], verificationInFlight: new Set() });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "done");
});

test("evidence waits re-arm on the short cadence, bounded per streak", async () => {
  const { env, board } = verificationHost({
    tasks: [{ id: "waiting", title: "Store not answering", status: "awaiting_verification", lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "gone" } }],
    unavailable: ["gone"],
  });
  const kicks = [];
  Object.assign(env, { kickVerificationSettlement: (ms) => kicks.push(ms) });
  for (let pass = 0; pass < 10; pass += 1) await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "awaiting_verification");
  assert.equal(board().tasks[0].verification.state, "pending");
  assert.deepEqual(kicks, Array(8).fill(15000), "eight short retries, then the autopilot tick owns it");
});

// Some evidence gaps never close (a check history past the read cap, a session
// row gone from the store). Such a card used to sit in review for good with
// its verify budget untouched; past the bound it is parked for the owner.
test("evidence that stays unreadable past its bound parks the card for the owner without a rerun", async () => {
  const attempt = (sessionId) => ({ startedAt: 1, at: 2, code: 0, sessionId, runId: sessionId });
  const waiting = (at) => ({ state: "pending", at, reason: "Waiting for the attempt's recorded execution evidence" });
  const { env, board } = verificationHost({
    tasks: [
      { id: "stuck", title: "Evidence gone for good", status: "awaiting_verification", verification: waiting(NOW - 2 * 3600 * 1000), lastAttempt: attempt("gone") },
      { id: "recent", title: "Store briefly down", status: "awaiting_verification", verification: waiting(NOW - 60 * 1000), lastAttempt: attempt("gone") },
    ],
    requests: [{ title: "Request evidence gone", status: "verifying", at: 5, verification: waiting(NOW - 3 * 3600 * 1000), lastAttempt: attempt("gone") }],
    unavailable: ["gone"],
  });
  await env.autopilotHousekeeping();
  const byId = (id) => board().tasks.find((task) => task.id === id);
  const stuck = byId("stuck"), recent = byId("recent");
  assert.equal(stuck.status, "open");
  assert.equal(stuck.verification.state, "failed");
  assert.match(stuck.verification.reason, /could not be read for 2 hours .*fixture evidence store unavailable.*confirm it yourself/);
  assert.equal(stuck.nextRunAt, undefined, "no automatic rerun: a new run cannot make old evidence readable");
  assert.equal(backlog.workState(stuck, NOW).stage, "blocked");
  assert.equal(recent.status, "awaiting_verification", "a short outage still waits without spending anything");
  assert.equal(recent.verifyAttempts, undefined);
  // A legacy "verifying" inbox row moves onto the board as a task with the
  // same attempt and settles by the same rule (the row leaves on a later pass).
  const moved = board().tasks.find((task) => task.title === "Request evidence gone");
  assert.equal(moved?.status, "open", "the request's evidence gap parks its task for the owner");
  assert.match(moved.verification.reason, /could not be read/);
  assert.equal(moved.nextRunAt, undefined);
});

// A project with no package.json has its `npm run check` moved to the Studio
// checkout; that run checked Studio's tree, so its red is not the card's.
test("a done card is not reopened by a relocated check that only failed on Studio's own tree", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "notes", title: "Notes project card", status: "done", doneAt: NOW - 500,
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "notes-session" },
    verificationRun: { key: "verification:notes:run_1", state: "failed", at: NOW - 100, results: [{ command: "npm run check", ok: false, exitCode: 1, relocated: true, tail: "Studio lint" }] },
  }] });
  await env.autopilotHousekeeping();
  assert.equal(board().tasks[0].status, "done");
});

test("a reopened done card gets a receipt of its own, so the earlier verified one is not the last word", async () => {
  const { env, board } = verificationHost({ tasks: [{
    id: "raced", title: "Settled before its run finished", status: "done", doneAt: NOW - 500, verificationReceiptId: "rcp_verified",
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "raced-session", runId: "run_1" },
    verificationRun: { key: "verification:raced:run_1", state: "failed", at: NOW - 100, results: [{ command: "npm run check", ok: false, exitCode: 1, tail: "1 failing" }] },
  }] });
  const appended = [];
  env.RECEIPTS_PATH = "receipts";
  env.getReceiptsModule = async () => ({
    buildReceipt: ({ attemptId, verdict }) => ({ id: `rcp_${verdict.state}_${attemptId}`, attemptId, result: verdict.state, trust: "runner", workItem: { intentKey: "raced" }, acceptance: { remaining: [] } }),
    appendReceipt: async (_file, receipt) => { appended.push(receipt); },
  });
  await env.autopilotHousekeeping();
  const task = board().tasks[0];
  assert.equal(task.status, "open");
  assert.equal(task.verificationReceiptId, "rcp_unverified_run_1");
  assert.deepEqual(appended.map((receipt) => receipt.result), ["unverified"]);
});
