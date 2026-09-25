import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import backlog from "../scripts/backlog.cjs";
import taskContext from "../scripts/task-context.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import executorCore from "../scripts/executor-core.cjs";
import workAdmission from "../scripts/work-admission.cjs";
import * as assistant from "../scripts/assistant.mjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";

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
  // represented: inbox rows the board already carries (deliberately added to the pin).
  assert.deepEqual(snapshot.counts, { ready: 3, running: 1, review: 1, blocked: 2, cooling: 1, done: 1, grouped: 0, waiting: 0, approval: 0, represented: 0, requests: 1, ideas: 2, eligibleIdeas: 1, ideaNotes: 1 });
  assert.deepEqual(snapshot.next.map((item) => item.title), ["Older", "A task", "Unique request"]);
  assert.equal(snapshot.nextRetryAt, 2000);
  assert.equal(snapshot.blocked.find((item) => item.id === "verify").stage, "blocked");
});

test("an inbox row the board already represents is not counted ready: promotion would never take it", () => {
  const now = 1000;
  const long = `Rework the saved filter panel so every filter keeps its state across project switches ${"and reloads ".repeat(4)}`.trim();
  const tasks = [
    { id: "card", title: "Search the board", prompt: "add search to the task board", status: "open", createdAt: 1 },
    { id: "child", title: "Finish keyboard access — follow-up 3f2a1c", prompt: "Implement arrow navigation.", handoffId: "handoff_1", fromRun: "run-1", status: "open", createdAt: 2 },
    { id: "clipped", title: long.slice(0, 90), prompt: long, status: "active", runId: "run-2", createdAt: 3 },
    { id: "gone", title: "Tidy the docs", prompt: "tidy the docs folder", status: "archived", createdAt: 4 },
  ];
  const requests = [
    { title: "Board search", prompt: "add search to the task board", at: 5 }, // the same brief
    { title: "Finish keyboard access", prompt: "Arrow keys, please.", handoffId: "handoff_1", fromRun: "run-1", at: 6 }, // the same handoff
    { title: long, prompt: long, at: 7 }, // the card carries its clipped title
    { title: "Tidy the docs", prompt: "tidy the docs folder", at: 8 }, // archived unfinished: not represented
    { title: "Legacy claim", prompt: "add search to the task board", runId: "run-legacy", status: "running", at: 9 }, // a claim is not promotable
    { title: "Brand new work", prompt: "write the changelog", at: 10 },
  ];
  const snapshot = backlog.summarizeBacklog({ tasks, requests, now });
  const readyTasks = snapshot.taskStates.filter((row) => row.stage === "ready").length;
  assert.equal(snapshot.counts.represented, 3);
  assert.equal(snapshot.counts.ready - readyTasks, 2, "only the archived card's work and the new request are ready requests");
  assert.equal(snapshot.counts.requests, 3, "represented rows are the board's work, not the inbox's");
  assert.deepEqual(snapshot.next.filter((row) => row.kind === "request").map((row) => row.title), ["Tidy the docs", "Brand new work"]);
  assert.match(snapshot.summary, /^2 building · 4 ready next$/);
  assert.equal(snapshot.counts.running, 2, "the legacy claim keeps its own stage");
  // The same inputs through workState alone would call all three ready.
  for (const request of requests.slice(0, 3)) assert.equal(backlog.workState(request, now, { tasks }).stage, "ready");
  const other = backlog.summarizeBacklog({ tasks: [], requests: requests.slice(0, 1), now });
  assert.equal(other.counts.represented, 0, "an empty board represents nothing");
});

test("a promoted inbox row stays its card's, open, done or gone, until compaction drops it", () => {
  const now = 1000;
  const tasks = [{ id: "task_done", title: "Rename the rail", prompt: "Rename the rail", status: "done", doneAt: 900 }];
  const requests = [
    // Titled differently from its card, so only the promotedTo stamp ties them.
    { title: "Tidy the rail labels", prompt: "Work on it", source: "chat", at: 5, promotedTo: "task_done" },
    { title: "Rescue a stale session", prompt: "Rescue it", source: "chat", at: 6, promotedTo: "task_gone" },
  ];
  const snapshot = backlog.summarizeBacklog({ tasks, requests, now });
  assert.equal(snapshot.counts.represented, 2);
  assert.equal(snapshot.counts.requests, 0, "neither is inbox work promotion would take again");
  assert.deepEqual(snapshot.next, [], "nothing is ready: the done card is done and the rows are its");
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

// A keeper loop hold (assistant.mjs auditPass) as the host stores it.
const loopHold = (overrides = {}) => ({ v: 1, at: 60, kind: "verify", count: 4, reason: "no attributable edits and no named checks", remedy: "This card changes no files: give it a named check the verifier can run, or close it by hand.", by: "keeper", ...overrides });

test("a loop-held card is blocked with its reason and remedy, and Try again stays offered", () => {
  const held = { id: "loop", title: "Looping", status: "open", logs: [], loopLedger: { v: 1, at: 50, n: 6, reasons: { "no attributable edits and no named checks": 4 } }, loopGuard: loopHold() };
  const state = backlog.workState(held, 100);
  assert.equal(state.stage, "blocked");
  assert.equal(state.blockedBy, "loop");
  assert.equal("canRetry" in state, false, "no canRetry:false, so the workspace keeps its Try again");
  assert.equal(state.reason, "Loop guard: 4 attempts since your last retry ended without verified progress (no attributable edits and no named checks). This card changes no files: give it a named check the verifier can run, or close it by hand.");
  assert.equal(backlog.workState({ ...held, nextRunAt: 500 }, 100).blockedBy, "loop", "a hold outranks a cooldown");
  assert.match(backlog.workState({ ...held, loopGuard: { count: 6 } }, 100).reason, /^Loop guard: 6 attempts .* Read the last attempts, edit or split the brief, then choose Try again\.$/);
  const summary = backlog.summarizeBacklog({ tasks: [held], now: 100 });
  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.blocked[0].blockedBy, "loop");
  assert.equal(backlog.LOOP_HOLD, 1, "the keeper's host capability");
});

test("the verification and failure parks win over a loop hold, and prerequisites still name their wait", () => {
  const loopGuard = loopHold({ kind: "attempts", count: 6, reason: "run failed exit N" });
  for (const parked of [{ verifyAttempts: 3 }, { verification: { state: "failed" } }, { runFailures: 5 }]) {
    const state = backlog.workState({ id: "parked", status: "open", loopGuard, ...parked }, 100);
    assert.equal(state.stage, "blocked", JSON.stringify(parked));
    assert.equal(state.blockedBy, undefined, JSON.stringify(parked));
    assert.doesNotMatch(state.reason, /Loop guard/);
  }
  const waiting = backlog.workState({ id: "child", status: "open", loopGuard, dependsOn: ["parent"] }, 100, { tasks: [{ id: "parent", title: "Parent", status: "open" }] });
  assert.equal(waiting.blockedBy, "dependencies");
});

test("an owner retry releases a loop hold and restarts its ledger from that moment", () => {
  const held = { id: "loop", status: "open", providerFailures: 2, loopLedger: { v: 1, at: 50, n: 7, reasons: { "outstanding obligations remain": 4 } }, loopGuard: loopHold({ reason: "outstanding obligations remain" }), logs: [] };
  const next = backlog.retryTask(held, 100);
  assert.equal(next.loopGuard, undefined);
  assert.equal(next.providerFailures, undefined);
  assert.deepEqual(next.loopLedger, { v: 1, at: 100, n: 0, reasons: {} });
  assert.equal(backlog.workState(next, 100).stage, "ready");
  assert.equal(held.loopGuard.count, 4, "the stale snapshot is not edited in place");
  // Nothing logged before the acknowledgement is charged again.
  const earlier = { at: 90, kind: "status", text: "unverified — outstanding obligations remain · retry 1/3" };
  const audited = assistant.auditPass({ tasks: [{ ...next, logs: [...next.logs, earlier] }], nodeFolders: {}, now: 200, armedAt: 10, hostCaps: { loopHold: backlog.LOOP_HOLD === 1 } });
  assert.equal(audited.tasks[0].loopLedger.n, 0);
  assert.equal(audited.tasks[0].loopGuard, undefined);
});

test("an owner's stop holds a queued card until they say go on, ranked like the loop hold", () => {
  const stopped = { id: "stop", title: "Stopped", status: "open", ownerHold: { v: 1, at: 60, by: "owner", reason: "  wrong\n approach  " }, logs: [] };
  assert.deepEqual(backlog.workState(stopped, 100), { stage: "blocked", blockedBy: "owner", reason: "Stopped by you (wrong approach) — say \"work on it\" or \"try again\" to resume it" });
  assert.equal(backlog.workState({ ...stopped, ownerHold: {} }, 100).reason, "Stopped by you — say \"work on it\" or \"try again\" to resume it");
  assert.ok(backlog.workState({ ...stopped, ownerHold: { reason: "x".repeat(500) } }, 100).reason.length < 160, "the reason stays short");
  assert.equal("canRetry" in backlog.workState(stopped, 100), false, "Try again stays offered");
  // The owner's word outranks a cooldown, a pin, the keeper's loop hold and a missing status...
  for (const extra of [{ nextRunAt: 500 }, { pin: true, pinAt: 90 }, { loopGuard: loopHold() }, { status: undefined }, { status: "queued" }]) {
    assert.equal(backlog.workState({ ...stopped, ...extra }, 100).blockedBy, "owner", JSON.stringify(extra));
  }
  // ...but never a running, verifying or finished card, nor the parks and prerequisite waits a loop hold yields to.
  for (const status of ["active", "running", "awaiting_verification", "verifying", "done", "archived"]) {
    assert.notEqual(backlog.workState({ ...stopped, status }, 100).blockedBy, "owner", status);
  }
  for (const parked of [{ verifyAttempts: 3 }, { verification: { state: "failed" } }, { runFailures: 5 }]) {
    const state = backlog.workState({ ...stopped, ...parked }, 100);
    assert.equal(state.stage, "blocked", JSON.stringify(parked));
    assert.equal(state.blockedBy, undefined, JSON.stringify(parked));
  }
  assert.equal(backlog.workState({ ...stopped, dependsOn: ["parent"] }, 100, { tasks: [{ id: "parent", title: "Parent", status: "open" }] }).blockedBy, "dependencies");
  for (const hold of ["yes", [], null, 1]) assert.equal(backlog.workState({ ...stopped, ownerHold: hold }, 100).stage, "ready", `only an object holds: ${JSON.stringify(hold)}`);
  const summary = backlog.summarizeBacklog({ tasks: [stopped], now: 100 });
  assert.equal(summary.counts.blocked, 1);
  assert.equal(summary.blocked[0].blockedBy, "owner");
  // A card waiting on a stopped duplicate names the stop as its hold.
  const linked = backlog.workState({ id: "twin", status: "open", duplicateOf: "stop" }, 100, { tasks: [stopped, { id: "twin", status: "open", duplicateOf: "stop" }] });
  assert.equal(linked.stage, "blocked");
  assert.match(linked.reason, /Stopped by you/);
});

test("Try again is the owner's release of their own stop", () => {
  const stopped = { id: "stop", status: "open", ownerHold: { at: 60, reason: "wait" }, loopGuard: loopHold(), logs: [] };
  const next = backlog.retryTask(stopped, 100);
  assert.equal(next.ownerHold, undefined);
  assert.equal(next.loopGuard, undefined);
  assert.equal(backlog.workState(next, 100).stage, "ready");
  assert.deepEqual(stopped.ownerHold, { at: 60, reason: "wait" }, "the stale snapshot is not edited in place");
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
    Date, console, backlog, executorResume, executorCore, process: { pid: 321 }, projectSwitching: false, assistantState: { status: "running" }, assistantModule: assistant, getAssistant: async () => assistant, machineLagGate: null, executorUpdateHold: () => null, readSettings: async () => ({}), machineMemoryWarnOverride: () => false, logLine() {},
    projects: { current: () => ({ id: "fixture", path: "/fixture" }), open: () => ({ id: "fixture", path: "/fixture" }) }, projectRoot: () => "/fixture",
    autopilot: { execute: true, jobs: [] }, measureWorkerLag: async () => 0, getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => null }),
    executorRunEnv: async () => ({ via: "fixture" }), getEyes: async () => ({ readJson: async (key) => records[key] }),
    getPolicyModule: async () => null, warmPolicyBaseline: () => {},
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (value) => value,
    conflictsWithLiveFix: () => false, queuedWorkCount: () => 0, compareWork: () => 0,
  });
  vm.runInContext(section("async function spawnNextJob(", "// A finished run's handoffs"), env);
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

test("Try again is the release for a loop-held card: prioritizing it alone is refused", async () => {
  const { env, board } = controlHost({ tasks: [{ id: "held", title: "Looping card", status: "open", logs: [], loopLedger: { v: 1, at: 50, n: 6, reasons: {} }, loopGuard: loopHold({ kind: "attempts", count: 6 }) }] });
  const status = await env.backlogStatus();
  assert.equal(status.counts.blocked, 1);
  assert.equal(status.blocked[0].blockedBy, "loop");
  assert.equal((await env.backlogControl({ action: "prioritize", taskId: "held" })).ok, false);
  assert.ok(board().tasks[0].loopGuard, "a refused action leaves the hold");
  assert.equal((await env.backlogControl({ action: "retry", taskId: "held" })).ok, true);
  const saved = board().tasks[0];
  assert.equal(saved.loopGuard, undefined);
  assert.equal(saved.loopLedger.n, 0);
  assert.equal(backlog.workState(saved, Date.now()).stage, "ready");
});

test("promoting a request preserves its retry budget, pin, evidence and remaining work", async () => {
  const request = { title: "Blocked request", prompt: "Original obligation", at: 10, pin: true, pinAt: 20, runFailures: 2, verifyAttempts: 3, nextRunAt: 100, lastAttempt: { at: 50, result: "Partial" }, remaining: ["Check the result"], refs: [{ kind: "file", detail: "a.js" }] };
  const board = { tasks: [], requests: [request], ideas: [] };
  const env = vm.createContext({
    Date, backlog, workAdmission, projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture",
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

test("the real drain pass leaves settlement to the foreman and never calls paid work generation", async () => {
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
  assert.deepEqual(effects, ["dispatch"], "the pass only asks; the foreman below settles, promotes and admits");
});

test("the foreman a drain pass wakes settles, promotes and admits ideas before dispatch", async () => {
  const effects = [];
  const env = vm.createContext({
    assistantState: { status: "running", prefs: { backlogMode: true }, agents: [] },
    autopilot: { execute: true, jobs: [], parallel: 1, waiting: null },
    autopilotHousekeeping: async () => effects.push("verify"),
    promoteRequestsToTasks: async () => effects.push("promote requests"),
    admitBacklogIdeas: async () => effects.push("admit ideas"),
    executeNextRequest: async () => effects.push("dispatch"),
    assistantEnqueueRole: () => {}, ASSISTANT_PRIORITY: { demand: 5 }, MINUTE_MS: 60000, assistantCache: {},
  });
  vm.runInContext(section("async function assistantForemanJob(", "// The thinker: the assistant itself."), env);
  await env.assistantForemanJob(Date.now(), {});
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
  assert.equal((await env.saveTaskEdits([stale, { id: "fresh", title: "Added by you", status: "active", source: "a-eyes", runId: "run_forged" }])).ok, true);
  assert.ok(!board().tasks.some((task) => task.id === "task"), "a deleted legacy card must not be resurrected by a stale form");
  // New work enters through tasks:create, the one admission path: a form row
  // the board never held is not created here with the status, source and run
  // it chose, past every dedupe.
  assert.ok(!board().tasks.some((task) => task.id === "fresh"), "a detail save never creates a card");
  assert.ok(board().tasks.some((task) => task.id === "new"), "rows the form never listed are kept");
});

test("dispatch rechecks prerequisites inside the claim lock and loses the claim if a prerequisite reopens", async () => {
  const records = { tasks: [{ id: "pre", title: "Prerequisite", status: "done", doneAt: 1 }, { id: "next", title: "Dependent", status: "open", dependsOn: ["pre"] }], requests: [] };
  let claims = 0;
  const env = vm.createContext({
    Date, console, backlog, executorResume, executorCore, process: { pid: 321 }, projectSwitching: false, assistantState: { status: "running" }, assistantModule: assistant, getAssistant: async () => assistant, machineLagGate: null, executorUpdateHold: () => null, readSettings: async () => ({}), machineMemoryWarnOverride: () => false, logLine() {},
    projects: { current: () => ({ id: "fixture", path: "/fixture" }), open: () => ({ id: "fixture", path: "/fixture" }) }, projectRoot: () => "/fixture",
    autopilot: { execute: true, jobs: [] }, autopilotJobSeq: 0,
    measureWorkerLag: async () => 0, getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => null }), executorRunEnv: async () => ({ via: "fixture" }),
    // Per-task model routing has its own suite (jev_model_routing_host); this route names no routed provider.
    routeBuilderModel: async () => null,
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
  vm.runInContext(section("async function spawnNextJob(", "// A finished run's handoffs"), env);
  assert.equal(await env.spawnNextJob(), "lost");
  assert.equal(claims, 1);
  assert.equal(env.autopilot.jobs.length, 0);
  assert.equal(records.tasks[1].status, "open");
  assert.equal(records.tasks[1].runId, undefined);
});

test("Drop closes unfinished work without claiming it finished, and the parent that handed it on stops waiting", async () => {
  const toggle = { handoffId: "handoff_a", fromRun: "run_p", title: "Wire the toggle", originalTitle: "Wire the toggle", prompt: "Add the toggle." };
  const sweep = { ...toggle, handoffId: "handoff_b", title: "Sweep", originalTitle: "Sweep", prompt: "Run the sweep." };
  const parent = { id: "parent", title: "Ship the warn tier", status: "awaiting_verification", runId: "run_p", remaining: ["Wire the toggle", "Sweep"], lastAttempt: { runId: "run_p", handoffs: [toggle, sweep] } };
  const tasks = [parent, { ...toggle, id: "toggle", status: "open", verifyAttempts: 3, verification: { state: "failed", reason: "outstanding obligations remain" } }, { ...sweep, id: "sweep", status: "open" }];
  const { env, board, autopilot } = controlHost({ tasks });
  assert.equal((await env.taskAction({ action: "drop", taskId: "parent" })).ok, false, "a card being checked is not dropped");
  autopilot.jobs.push({ taskId: "sweep" });
  assert.equal((await env.taskAction({ action: "drop", taskId: "sweep" })).ok, false, "a card with a worker is not dropped");
  autopilot.jobs.length = 0;
  assert.equal((await env.taskAction({ action: "drop", taskId: "toggle", projectId: "project-b" })).ok, false, "a stale project action fails");
  const dropped = await env.taskAction({ action: "drop", taskId: "toggle", projectId: "project-a" });
  assert.equal(dropped.ok, true);
  assert.equal(dropped.task.status, "archived");
  assert.equal(dropped.task.doneAt, undefined, "a drop is not a completion");
  assert.equal(dropped.task.verification.state, "failed", "no verdict is invented");
  assert.equal(backlog.completedTask(board().tasks[1]), false);
  assert.equal(backlog.droppedTask(board().tasks[1]), true);
  assert.equal(dropped.backlog.taskStates.find((row) => row.id === "toggle").reason, "Dropped by you before it finished");
  assert.deepEqual(board().tasks[0].droppedHandoffs, ["handoff_a"]);
  assert.equal((await env.taskAction({ action: "drop", taskId: "toggle" })).ok, false, "a closed card is not dropped twice");
  assert.equal((await env.deleteTask({ taskId: "sweep" })).ok, true);
  assert.deepEqual(board().tasks[0].droppedHandoffs, ["handoff_a", "handoff_b"], "a deleted follow-up is recorded on its parent");
  const settled = taskHandoffs.reconcileTaskHandoffs({ tasks: board().tasks, requests: [] });
  assert.equal(settled.recovered, 0, "the deleted follow-up is not re-admitted as a fresh card");
  assert.equal(settled.waitingTaskIds.size, 0);
  assert.deepEqual(copy(settled.tasks[0].remaining), []);
  const reopened = await env.taskAction({ action: "status", status: "open", taskId: "toggle" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.task.status, "open");
  assert.equal(reopened.task.dropped, undefined, "Reopen clears the drop");
  const dependent = controlHost({ tasks: [{ id: "base", title: "Base", status: "open" }, { id: "after", title: "After", status: "open", dependsOn: ["base"] }] });
  assert.equal((await dependent.env.taskAction({ action: "drop", taskId: "base" })).ok, false, "a card other work waits on is not dropped");
});
