import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import backlog from "../scripts/backlog.cjs";
import taskContext from "../scripts/task-context.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import * as assistant from "../scripts/assistant.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => JSON.parse(JSON.stringify(value));

test("backlog counts match actual dispatch states and do not double-count promoted inbox work", () => {
  const now = 1000;
  const tasks = [
    { id: "next", title: "A task", status: "open", createdAt: 2 },
    { id: "older", title: "Older", status: "open", createdAt: 1 },
    { id: "run", title: "Running", status: "active" },
    { id: "review", title: "Review", status: "awaiting_verification" },
    { id: "verify", title: "Unverified", status: "open", verifyAttempts: 3 },
    { id: "failed", title: "Failed", status: "open", runFailures: 5 },
    { id: "cool", title: "Cooling", status: "open", nextRunAt: 2000 },
    { id: "done", title: "Done", status: "done" },
  ];
  const requests = [{ title: "A task" }, { title: "Unique request", at: 3 }, { title: "Unique request", at: 4 }];
  const ideas = [
    { id: "idea", title: "Saved idea", source: "manual", status: "new" },
    { id: "chat", title: "Possible thought", source: "chat", status: "new" },
    { id: "promoted", title: "Already queued", taskId: "next", status: "new" },
  ];
  const snapshot = backlog.summarizeBacklog({ tasks, requests, ideas, now, ideaEligible: assistant.backlogIdeaEligible });
  assert.deepEqual(snapshot.counts, { ready: 3, running: 1, review: 1, blocked: 2, cooling: 1, done: 1, grouped: 0, waiting: 0, approval: 0, requests: 1, ideas: 2, eligibleIdeas: 1, ideaNotes: 1 });
  assert.deepEqual(snapshot.next.map((item) => item.title), ["Older", "A task", "Unique request"]);
  assert.equal(snapshot.nextRetryAt, 2000);
  assert.equal(snapshot.blocked.find((item) => item.id === "verify").stage, "blocked");
});

test("an explicit retry preserves evidence and obligations while clearing both failure budgets", () => {
  const previous = { id: "failed", status: "open", runFailures: 5, verifyAttempts: 3, verification: { state: "failed" }, remaining: ["Fix the test"], refs: [{ kind: "file", detail: "file.js" }], lastAttempt: { result: "partial", at: 10 }, logs: [] };
  const next = backlog.retryTask(previous, 100);
  assert.equal(backlog.workState(next, 100).stage, "ready");
  assert.deepEqual(next.remaining, previous.remaining);
  assert.deepEqual(next.refs, previous.refs);
  assert.deepEqual(next.lastAttempt, previous.lastAttempt);
  assert.equal(previous.verifyAttempts, 3, "reading/retrying never edits a stale snapshot in place");
  assert.equal(next.pin, true);
  assert.match(next.logs.at(-1).text, /previous result and remaining work retained/);
});

function controlHost({ tasks = [], requests = [], ideas = [] } = {}) {
  let board = { tasks: copy(tasks), requests: copy(requests), ideas: copy(ideas) };
  let chain = Promise.resolve();
  const state = { status: "paused", prefs: {}, agents: [] };
  const autopilot = { jobs: [], execute: false, parkedUntil: 0 };
  const project = { id: "project-a", path: "C:/fixture" };
  const effects = [];
  const eyes = { readJson: async (key) => copy(board[key]), writeJson: async (key, value) => { board[key] = copy(value); } };
  const env = vm.createContext({
    Date, console, backlog, taskContext, structuredClone, assistantState: state, autopilot,
    projects: { current: () => project, open: () => project }, projectRoot: () => project.path,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas",
    getAssistant: async () => assistant, getEyes: async () => eyes, machineLagGate: null,
    ensureAssistant: async () => state, withBoardLock: (fn) => {
      const run = chain.then(fn); chain = run.catch(() => {}); return run;
    }, send: () => {},
    compareWork: (a, b) => (a.createdAt ?? a.at ?? 0) - (b.createdAt ?? b.at ?? 0),
    workTitleKey: (value) => String(value ?? "").toLowerCase(),
    assistantLog: (_kind, text) => effects.push(text), assistantAskForWork: (reason) => effects.push(reason),
    setAutopilot: async (patch) => Object.assign(autopilot, patch),
    assistantPause: async () => { state.status = "paused"; },
    assistantResume: async () => { state.status = "running"; },
    autopilotHousekeeping: async () => effects.push("verify"),
    classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => effects.push("promote requests"),
    refreshAutopilotQueue: async () => {}, emitAutopilot: () => {},
  });
  // Use the actual board gateway, including serialized writes and automatic
  // durable history, against memory-only fixture files.
  vm.runInContext(section("const isThenable =", "// Drop a claim this run still owns."), env);
  vm.runInContext(section("function queuedWorkCount(", "function workTitleKey("), env);
  return { env, state, autopilot, effects, board: () => copy(board) };
}

test("run backlog enables a project-local drain and admits only three oldest ideas", async () => {
  const ideas = Array.from({ length: 100 }, (_, index) => ({ id: `idea_${index}`, title: `Distinct idea ${index}`, detail: "Acceptance details", source: "manual", status: "new", createdAt: index + 1 }));
  const { env, state, board, effects } = controlHost({ ideas });
  const result = await env.backlogControl({ action: "run", projectId: "project-a" });
  assert.equal(result.ok, true);
  assert.equal(state.prefs.backlogMode, true);
  assert.equal(result.backlog.draining, true);
  assert.equal(result.backlog.paused, false);
  assert.equal(board().tasks.length, 3);
  assert.equal(board().ideas.length, 100, "backlog notes remain stored after admission");
  assert.deepEqual(board().tasks.map((task) => task.title), ["Distinct idea 0", "Distinct idea 1", "Distinct idea 2"]);
  assert.ok(board().tasks.every((task) => task.projectId === "project-a"));
  await env.admitBacklogIdeas();
  assert.equal(board().tasks.length, 3, "repeat passes do not overflow the buffer");
  await env.mutateBoard((current) => { current.tasks[0].status = "done"; });
  await env.admitBacklogIdeas();
  assert.equal(board().tasks.length, 4, "a completion frees exactly one admission slot");
  assert.equal(board().tasks.filter((task) => task.status === "open").length, 3);
  assert.equal(board().tasks.at(-1).title, "Distinct idea 3");
  assert.ok(effects.includes("work through the backlog"));
});

test("an explicit idea promotion is atomic under repeated clicks and stale project actions fail", async () => {
  const { env, board } = controlHost({ ideas: [{ id: "note", title: "Saved chat note", detail: "Keep full context", source: "chat", status: "new", createdAt: 1 }] });
  const stale = await env.backlogControl({ action: "promote", ideaId: "note", projectId: "project-b" });
  assert.equal(stale.ok, false);
  assert.equal(board().tasks.length, 0);
  await Promise.all([env.backlogControl({ action: "promote", ideaId: "note" }), env.backlogControl({ action: "promote", ideaId: "note" })]);
  assert.equal(board().tasks.length, 1);
  assert.equal(board().ideas[0].taskId, board().tasks[0].id);
});

test("pause clears a timed restart and retry refuses to double-run a live or reviewing task", async () => {
  const { env, autopilot, state, board } = controlHost({ tasks: [{ id: "live", status: "active" }, { id: "review", status: "awaiting_verification" }, { id: "failure", status: "open", verifyAttempts: 3, remaining: ["a check"] }] });
  autopilot.parkedUntil = Date.now() + 600000;
  const paused = await env.backlogControl({ action: "pause" });
  assert.equal(paused.backlog.paused, true);
  assert.equal(autopilot.parkedUntil, 0);
  assert.equal(state.status, "paused");
  for (const id of ["live", "review"]) assert.equal((await env.backlogControl({ action: "retry", taskId: id })).ok, false);
  assert.equal((await env.backlogControl({ action: "retry", taskId: "failure" })).ok, true);
  assert.equal(backlog.workState(board().tasks[2]).stage, "ready");
  assert.deepEqual(board().tasks[2].remaining, ["a check"]);
});

test("the actual executor will not dispatch exhausted verification tasks or requests", async () => {
  const records = { tasks: [{ id: "task", title: "Task", status: "open", verifyAttempts: 3 }], requests: [{ title: "Request", verifyAttempts: 3 }] };
  const env = vm.createContext({
    Date, console, backlog, executorResume, process: { pid: 321 }, projectSwitching: false, assistantState: { status: "running" }, assistantModule: assistant, getAssistant: async () => assistant, machineLagGate: null, executorUpdateHold: () => null, readSettings: async () => ({}), machineMemoryWarnOverride: () => false, logLine() {},
    projects: { current: () => ({ id: "fixture", path: "/fixture" }), open: () => ({ id: "fixture", path: "/fixture" }) }, projectRoot: () => "/fixture",
    autopilot: { execute: true, jobs: [] }, measureWorkerLag: async () => 0, getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => null }),
    executorRunEnv: async () => ({ via: "fixture" }), getEyes: async () => ({ readJson: async (key) => records[key] }),
    getPolicyModule: async () => null, warmPolicyBaseline: () => {},
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (value) => value,
    conflictsWithLiveFix: () => false, queuedWorkCount: () => 0, compareWork: () => 0,
  });
  vm.runInContext(section("async function spawnNextJob()", "// A finished run's handoffs"), env);
  assert.equal(await env.spawnNextJob(), "review");
  assert.equal(env.autopilot.jobs.length, 0);
  assert.equal(records.tasks[0].status, "open");
});

test("group members stay represented by their plan and cannot be retried independently", async () => {
  const { env, board } = controlHost({ tasks: [{ id: "member", title: "Part one", status: "absorbed", absorbedInto: "plan" }, { id: "plan", title: "Full plan", status: "open" }] });
  const status = await env.backlogStatus();
  assert.equal(status.counts.grouped, 1);
  assert.equal(status.counts.blocked, 0);
  assert.equal(status.counts.ready, 1);
  assert.equal(status.taskStates[0].groupId, "plan");
  for (const action of ["retry", "prioritize"]) assert.equal((await env.backlogControl({ action, taskId: "member" })).ok, false);
  assert.equal(board().tasks[0].status, "absorbed");
});

test("promoting a request preserves its retry budget, pin, evidence and remaining work", async () => {
  const request = { title: "Blocked request", prompt: "Original obligation", at: 10, pin: true, pinAt: 20, runFailures: 2, verifyAttempts: 3, nextRunAt: 100, lastAttempt: { at: 50, result: "Partial" }, remaining: ["Check the result"], refs: [{ kind: "file", detail: "a.js" }] };
  const board = { tasks: [], requests: [request], ideas: [] };
  const env = vm.createContext({
    Date, backlog, projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture",
    crypto: { randomBytes: () => ({ toString: () => "fake-id" }) },
    mutateBoard: async (fn) => ({ ...fn(board, {}), ...board }),
    compareWork: (a, b) => (a.at ?? 0) - (b.at ?? 0), workTitleKey: (value) => value,
    workPlanTheme: () => null, isFixWork: () => false,
  });
  vm.runInContext(section("async function promoteRequestsToTasks()", "// Chat work lands straight on the task board."), env);
  assert.equal(await env.promoteRequestsToTasks(), 1);
  const promoted = board.tasks[0];
  assert.equal(backlog.workState(promoted, 200).stage, "blocked");
  assert.equal(promoted.createdAt, request.at);
  assert.equal(promoted.verifyAttempts, 3);
  assert.equal(promoted.pin, true);
  assert.deepEqual(copy(promoted.remaining), request.remaining);
  assert.deepEqual(copy(promoted.refs), request.refs);
  assert.deepEqual(copy(promoted.lastAttempt), request.lastAttempt);
});

test("the real drain pass performs local settlement without calling paid work generation", async () => {
  const effects = [];
  const env = vm.createContext({
    Date, projectSwitching: false, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    assistantState: { status: "running", prefs: { backlogMode: true } },
    autopilot: { enabled: true, execute: true }, TASKS_PATH: "tasks",
    projects: { open: () => ({ id: "fixture" }) },
    getEyes: async () => ({ readJson: async () => [] }),
    autopilotProactivePass: () => { throw new Error("Do not generate while draining"); },
    runAssistant: () => { throw new Error("Do not grow or improve while draining"); },
    autopilotHousekeeping: async () => effects.push("verify"),
    classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => effects.push("promote requests"),
    admitBacklogIdeas: async () => effects.push("admit ideas"),
    refreshAutopilotQueue: async () => {}, pushAutopilotHistory: () => {}, emitAutopilot: () => {},
    assistantAskForWork: () => effects.push("dispatch"), logLine: (text) => { throw new Error(text); },
  });
  vm.runInContext(`let autopilotTicks = 11;\n${section("let autopilotPassInFlight = null;", "async function setAutopilot(")}`, env);
  await env.autopilotPass();
  assert.deepEqual(effects, ["verify", "promote requests", "admit ideas", "dispatch"]);
});

test("prerequisites wait for success and reject cycles, self-links, missing tasks and foreign project edits", async () => {
  const { env, board } = controlHost({ tasks: [{ id: "first", title: "Build schema", status: "open" }, { id: "second", title: "Use schema", status: "open" }] });
  assert.equal((await env.setTaskDependencies({ taskId: "second", dependsOn: ["first"], projectId: "wrong" })).ok, false);
  const linked = await env.setTaskDependencies({ taskId: "second", dependsOn: ["first"], projectId: "project-a" });
  assert.equal(linked.ok, true);
  assert.equal(linked.backlog.taskStates.find((task) => task.id === "second").stage, "waiting");
  assert.equal(linked.backlog.counts.waiting, 1);
  for (const dependsOn of [["second"], ["missing"]]) assert.equal((await env.setTaskDependencies({ taskId: "second", dependsOn })).ok, false);
  assert.equal((await env.setTaskDependencies({ taskId: "first", dependsOn: ["second"] })).ok, false, "indirect cycles are rejected");
  for (const action of ["retry", "prioritize"]) assert.equal((await env.backlogControl({ action, taskId: "second" })).ok, false, "pin/retry cannot bypass prerequisites");
  assert.equal((await env.taskAction({ action: "status", status: "active", taskId: "second" })).ok, false);
  assert.equal((await env.deleteTask({ taskId: "first" })).ok, false, "a required record cannot disappear under its dependents");
  const finished = await env.taskAction({ action: "status", status: "done", taskId: "first" });
  assert.equal(finished.ok, true);
  assert.equal(finished.task.verification.state, "manual");
  assert.equal(finished.backlog.taskStates.find((task) => task.id === "second").stage, "ready");
  assert.equal(board().tasks[1].dependsOn[0], "first");
});

test("missing and cyclic imported prerequisites are held without inventing completion", () => {
  const tasks = [
    { id: "missing", title: "Missing input", status: "open", dependsOn: ["unknown"] },
    { id: "a", title: "A", status: "open", dependsOn: ["b"] },
    { id: "b", title: "B", status: "open", dependsOn: ["a"] },
    { id: "archive", title: "Old archive", status: "archived" },
    { id: "after", title: "After archive", status: "open", dependsOn: ["archive"] },
  ];
  for (const id of ["missing", "a", "b"]) {
    const state = backlog.workState(tasks.find((task) => task.id === id), 1, { tasks });
    assert.equal(state.stage, "blocked");
    assert.equal(state.canRetry, false);
  }
  assert.equal(backlog.workState(tasks[4], 1, { tasks }).stage, "waiting", "archived alone is not proof that required work succeeded");
  tasks[3].doneAt = 1;
  assert.equal(backlog.workState(tasks[4], 2, { tasks }).stage, "ready");
});

test("the board gateway keeps versioned briefs, restores one revision and leaves run evidence unchanged", async () => {
  const { env, board } = controlHost({ tasks: [{ id: "task", title: "Original title", prompt: "All original requirements", status: "done", doneAt: 10, lastAttempt: { result: "Passed acceptance", at: 10 }, verification: { state: "verified", at: 10 } }] });
  const renamed = await env.taskAction({ action: "rename", taskId: "task", title: "Updated title", projectId: "project-a" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.task.contextHistory, undefined, "board replies do not repeatedly serialize all saved context");
  assert.equal(renamed.task.contextVersion, 2);
  const history = await env.readTaskContext({ taskId: "task" });
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[1].snapshot.prompt, "All original requirements");
  const restored = await env.restoreTaskContext({ taskId: "task", revisionId: history.entries[1].id });
  assert.equal(restored.ok, true);
  assert.equal(restored.task.title, "Original title");
  assert.equal(restored.task.status, "done");
  assert.deepEqual(copy(restored.task.lastAttempt), { result: "Passed acceptance", at: 10 });
  assert.equal(board().tasks[0].contextHistory.entries.length, 3, "a restore is recorded once");
  assert.equal(board().tasks[0].contextHistory.entries.at(-1).kind, "restored");
  const count = board().tasks[0].contextHistory.entries.length;
  await env.mutateBoard((current) => { current.tasks[0].updatedAt = Date.now() + 10; });
  assert.equal(board().tasks[0].contextHistory.entries.length, count, "a heartbeat does not create a new brief");
  const handoff = await env.readTaskContext({ taskId: "task" }, "handoff");
  assert.match(handoff.text, /All original requirements/);
  assert.match(handoff.text, /Passed acceptance/);
});

test("restoring context revalidates old prerequisite links and refuses a held worker", async () => {
  const old = { id: "task", title: "Task", prompt: "Earlier brief", status: "open", dependsOn: ["gone"] };
  const latest = taskContext.recordTaskRevision({ ...old, prompt: "Current brief", dependsOn: [] }, { previous: old, now: 2 });
  const { env, board, autopilot } = controlHost({ tasks: [latest] });
  const revisionId = latest.contextHistory.entries[0].id;
  const missing = await env.restoreTaskContext({ taskId: "task", revisionId });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Missing prerequisite/);
  assert.equal(board().tasks[0].prompt, "Current brief");
  autopilot.jobs.push({ taskId: "task" });
  assert.equal((await env.restoreTaskContext({ taskId: "task", revisionId: latest.contextHistory.entries[1].id })).ok, false);
  assert.equal((await env.setTaskDependencies({ taskId: "task", dependsOn: [] })).ok, false);
});

test("a stale detail form cannot reopen completed work, replace restored context or delete new tasks", async () => {
  const { env, board } = controlHost({ tasks: [{ id: "task", title: "Original", prompt: "Original requirements", status: "open", refs: [], logs: [] }] });
  const stale = env.taskView(board().tasks[0]);
  await env.taskAction({ action: "rename", taskId: "task", title: "Fresh title" });
  await env.taskAction({ action: "status", status: "done", taskId: "task" });
  await env.mutateBoard((current) => { current.tasks.push({ id: "new", title: "New backlog item", status: "open" }); });
  const saved = await env.saveTaskEdits([stale]);
  assert.equal(saved.ok, true);
  assert.equal(board().tasks[0].title, "Fresh title");
  assert.equal(board().tasks[0].status, "done");
  assert.equal(board().tasks[0].verification.state, "manual");
  assert.ok(board().tasks.some((task) => task.id === "new"));
  const conflict = await env.saveTaskEdits([{ ...stale, title: "Overwrite fresh title" }]);
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /changed elsewhere/);
  assert.equal(board().tasks[0].title, "Fresh title");
  const revisionCount = board().tasks[0].contextHistory.entries.length;
  await env.saveTaskEdits([{ ...env.taskView(board().tasks[0]), contextHistory: { entries: [] } }]);
  assert.equal(board().tasks[0].contextHistory.entries.length, revisionCount, "client-supplied history never replaces the saved record");
  assert.equal((await env.deleteTask({ taskId: "task" })).ok, true);
  assert.equal((await env.saveTaskEdits([stale, { id: "fresh", title: "Added by you", status: "open" }])).ok, true);
  assert.ok(!board().tasks.some((task) => task.id === "task"), "a deleted legacy card must not be resurrected by a stale form");
  assert.ok(board().tasks.some((task) => task.id === "fresh"), "fresh tasks still save alongside stale peers");
});

test("dispatch rechecks prerequisites inside the claim lock and loses the claim if a prerequisite reopens", async () => {
  const records = { tasks: [{ id: "pre", title: "Prerequisite", status: "done", doneAt: 1 }, { id: "next", title: "Dependent", status: "open", dependsOn: ["pre"] }], requests: [] };
  let claims = 0;
  const env = vm.createContext({
    Date, console, backlog, executorResume, process: { pid: 321 }, projectSwitching: false, assistantState: { status: "running" }, assistantModule: assistant, getAssistant: async () => assistant, machineLagGate: null, executorUpdateHold: () => null, readSettings: async () => ({}), machineMemoryWarnOverride: () => false, logLine() {},
    projects: { current: () => ({ id: "fixture", path: "/fixture" }), open: () => ({ id: "fixture", path: "/fixture" }) }, projectRoot: () => "/fixture",
    autopilot: { execute: true, jobs: [] }, autopilotJobSeq: 0,
    measureWorkerLag: async () => 0, getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => null }), executorRunEnv: async () => ({ via: "fixture" }),
    getEyes: async () => ({ readJson: async (key) => records[key] }),
    getPolicyModule: async () => null, warmPolicyBaseline: () => {}, resolveActivePolicyIdentity: async () => null,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (value) => value,
    conflictsWithLiveFix: () => false, queuedWorkCount: () => 1, compareWork: () => 0,
    mutateBoard: async (mutate) => {
      claims += 1;
      records.tasks[0].status = "open";
      return mutate(records);
    },
    spawn: () => assert.fail("a dependency changed before the claim; no child may start"),
  });
  vm.runInContext(section("async function spawnNextJob()", "// A finished run's handoffs"), env);
  assert.equal(await env.spawnNextJob(), "lost");
  assert.equal(claims, 1);
  assert.equal(env.autopilot.jobs.length, 0);
  assert.equal(records.tasks[1].status, "open");
  assert.equal(records.tasks[1].runId, undefined);
});
