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
    getAssistant: async () => assistant, loadModule: async () => history,
    getEyes: async () => ({ listChanges: ({ sessionId }) => {
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

test("each ordinary foreman pass verifies prerequisites before dispatching the next task", async () => {
  const first = { id: "first", title: "First task", status: "awaiting_verification", lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "first-session" } };
  const second = { id: "second", title: "Next task", status: "open", dependsOn: ["first"] };
  const { env, board } = verificationHost({ tasks: [first, second] });
  const order = [];
  Object.assign(env, {
    assistantState: { status: "running", prefs: { backlogMode: false }, agents: [] },
    autopilot: { execute: true, parallel: 1, jobs: [] },
    promoteRequestsToTasks: async () => { order.push("promote"); },
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
  assert.equal(data.tasks[0].status, "awaiting_verification");
  assert.equal(data.tasks[0].verifyAttempts, 2);
  assert.equal(data.tasks[1].status, "done");
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].verifyAttempts, 1);
  assert.ok(data.tasks.some((task) => task.title === "Verified request" && task.status === "done"));
  assert.equal(notes.filter((line) => line.includes("verification waiting")).length, 2);
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

test("a direct request cannot verify while its handed-on obligations remain open", async () => {
  const { env, board } = verificationHost({ requests: [{
    title: "Partially implemented request", at: 5, status: "verifying", remaining: ["Finish the requested integration"],
    lastAttempt: { startedAt: 1, at: 2, code: 0, sessionId: "partial-session", runId: "partial-run", result: { parts: { remaining: "none" } } },
  }] });
  await env.autopilotHousekeeping();
  assert.equal(board().requests.length, 1, "a partial request stays on the board for retry or review");
  assert.equal(board().requests[0].verifyAttempts, 1);
  assert.equal(board().requests[0].nextRunAt, NOW + 60000);
  assert.deepEqual(board().requests[0].remaining, ["Finish the requested integration"]);
  assert.equal(board().tasks.length, 0, "no durable Done entry is invented for unfinished work");
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

test("live worker status excludes finished entries and never exposes an invalid progress fraction", () => {
  const stopping = { since: 1000, reason: "time budget", error: "access denied", retryAt: 16000 };
  const env = vm.createContext({
    EXECUTOR_PARALLEL_CAP: 3, autopilot: { jobs: [
      { title: "Still running", taskId: "current", progress: .3, pid: 123, stopping },
      { title: "Finished and saving", finished: true, progress: 1 },
      { title: "Unknown progress", progress: NaN },
      { title: "Out of bounds", progress: 4 },
    ] }, foremanStatus: () => ({ status: "done" }),
  });
  vm.runInContext(section("function autopilotStatus()", "function emitAutopilot()"), env);
  const status = env.autopilotStatus();
  assert.equal(status.running.length, 3);
  assert.equal(status.running[0].progress, .3);
  assert.equal(status.running[0].pid, undefined);
  assert.deepEqual({ ...status.running[0].stopping }, stopping);
  assert.notEqual(status.running[0].stopping, stopping, "status cannot mutate the recovery controller");
  assert.equal(status.running[1].progress, undefined);
  assert.equal(status.running[2].progress, 1);
});
