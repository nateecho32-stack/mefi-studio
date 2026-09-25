import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";
import taskOversight from "../scripts/task-oversight.cjs";
import { baselineCompareWork } from "../scripts/policy.mjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};
const target = { kind: "session", id: "fixture-session", label: "Auto request deduplication in assistant.mjs" };

function workOnHost(options = {}) {
  const h = executorHost(options);
  let sequence = 0;
  h.state.messages = [];
  const replies = [], effects = [];
  const askForWork = h.env.assistantAskForWork;
  Object.assign(h.env, {
    assistantFocus: async (focus) => { h.state.focus = { ...focus }; },
    assistantMessageId: () => `message-${++sequence}`,
    assistantCaps: () => ({ messages: 100 }),
    assistantTrim: (rows, limit) => rows.splice(0, Math.max(0, rows.length - limit)),
    assistantAppendReply: (text, via, intent) => {
      effects.push("reply");
      const reply = { id: `message-${++sequence}`, role: "assistant", text, via, intent, at: h.now() };
      replies.push(reply);
      h.state.messages.push(reply);
      return reply;
    },
    assistantAskForWork: (reason) => { effects.push("dispatch"); return askForWork(reason); },
  });
  vm.runInContext(section("async function assistantWorkOn(", "// A tree click hands the assistant"), h.env);
  vm.runInContext(section("let autopilotPassInFlight = null;", "async function setAutopilot("), h.env);
  return Object.assign(h, { replies, effects, workOn: () => h.env.assistantWorkOn(target) });
}

function addControls(h) {
  Object.assign(h.env, {
    assistantTimer: null, assistantLoop: false, overseerManualUntil: 0,
    applyKeepAwake() {}, assistantPump() {}, assistantClearQueue() {}, clearAssistantAiProbe() {},
    logError: (text) => h.logs.push(text),
  });
  vm.runInContext([
    section("async function assistantPause()", "// ---- 24/7:"),
    section("async function assistantControl(", "async function assistantSetPrefs("),
  ].join("\n"), h.env);
  return h;
}

const namedTask = (extra = {}) => ({ id: "named", title: "Build the named app", prompt: "Implement its saved rules and test them.", status: "open", createdAt: 1, files: ["app.js"], ...extra });
const startNamed = (h) => h.env.assistantWorkOn({ kind: "task", id: "named", projectId: "fixture", label: "Build the named app", start: true });

test("Start this task crosses the service pause only for its named worker and needs no helper calls", async () => {
  const otherHold = { at: 1, reason: "leave this for later" };
  const h = workOnHost({ realPool: true, paused: true, execute: false, parallel: 3, tasks: [
    namedTask({ ownerHold: { at: 1, reason: "stopped by you" } }),
    { id: "held-other", title: "Other held work", status: "open", ownerHold: otherHold },
    { id: "ready-other", title: "Other ready work", status: "open" },
  ] });
  h.autopilot.held = true;
  const settings = h.settings();
  const result = await startNamed(h);
  assert.equal(result.ok, true);
  assert.equal(result.taskId, "named");
  assert.equal(result.dispatch.phase, "preparing", "a claim precedes the actual spawn event");
  assert.equal(result.dispatch.requested, true);
  assert.equal(result.dispatch.held, false);
  assert.equal(result.dispatch.runId, h.starts[0].runId);
  assert.deepEqual(h.starts.map((row) => row.taskId), ["named"]);
  assert.equal(h.board().tasks[0].ownerHold, undefined);
  assert.deepEqual(h.board().tasks[1].ownerHold, otherHold);
  assert.equal(h.board().tasks[2].status, "open");
  assert.equal(h.supportCalls.length, 0, "a routine named task needs no planner/reviewer round trip");
  assert.equal(h.state.status, "paused");
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.autopilot.held, true);
  assert.deepEqual(h.settings(), settings);
  assert.equal(h.autopilot.taskStarts.size, 0, "the permission ends with this dispatch attempt");
  h.starts[0].child.emit("spawn");
  assert.equal(h.autopilot.jobs[0].startAnnounced, true);
  await h.finish("named", { lines: ["MEFI_RESULT: done: saved and tested the named app; remaining: none", "MEFI_JOB_DONE"] });
  await h.env.runVerificationJobs();
  assert.equal(h.board().tasks[0].status, "awaiting_verification", "the builder's report alone does not close the task");
  assert.equal(h.verificationStarts.length, 1);
  assert.equal(h.verificationStarts[0].cwd, h.env.projectRoot());
  h.advance(31000);
  // Drive the real finish/result timer, without globally waking the foreman.
  for (const timer of h.timers.filter((timer) => !timer.cancelled && timer.at <= h.now())) { timer.cancelled = true; timer.fn(); }
  for (let turn = 0; turn < 20 && h.board().tasks[0].status !== "done"; turn++) await new Promise(setImmediate);
  assert.equal(h.board().tasks[0].status, "done");
  assert.equal(h.board().tasks[0].verification.state, "verified");
  assert.equal(h.board().tasks[0].verificationRun.results[0].cwd, h.env.projectRoot());
  assert.equal(h.autopilot.jobs.length, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.state.status, "paused");
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.autopilot.held, true);
  await h.pump();
  assert.equal(h.starts.length, 1, "completion cannot drain unrelated backlog through the scoped permission");
});

for (const [name, extra, options, reason] of [
  ["approval", {}, { autoBuild: false }, "approval"],
  ["run budget", { runFailures: 5 }, {}, "blocked"],
  ["verification budget", { verifyAttempts: 3 }, {}, "blocked"],
  ["provider cooldown", { nextRunAt: 2_000_000, providerFailures: 2 }, {}, "cooling"],
  ["loop hold", { loopGuard: { count: 6, reason: "repeated attempts" } }, {}, "loop"],
]) test(`Start this task preserves its ${name} gate`, async () => {
  const h = workOnHost({ paused: true, execute: false, tasks: [namedTask(extra)], ...options });
  const result = await startNamed(h);
  assert.equal(result.dispatch.held, true);
  assert.equal(result.dispatch.requested, false);
  assert.equal(result.dispatch.reason, reason);
  for (const [key, value] of Object.entries(extra)) assert.deepEqual(h.board().tasks[0][key], value);
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
});

test("Start rejects a missing or foreign task instead of creating substitute work", async () => {
  const h = workOnHost({ tasks: [namedTask()] });
  const before = h.board();
  const foreign = await h.env.assistantWorkOn({ kind: "task", id: "named", projectId: "other-project", start: true });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /project changed/);
  assert.deepEqual(h.board(), before);
  const missing = await h.env.assistantWorkOn({ kind: "task", id: "deleted", projectId: "fixture", start: true });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no longer on the board/);
  assert.deepEqual(h.board(), before);
  assert.equal(h.starts.length, 0);
});

test("Start this task reports machine capacity without claiming it started or enabling other work", async () => {
  const h = workOnHost({ paused: true, execute: false, tasks: [namedTask()], workerCapacity: () => ({ canStart: false, reason: "Memory is full" }) });
  const result = await startNamed(h);
  assert.equal(result.dispatch.phase, "blocked");
  assert.equal(result.dispatch.reason, "resources");
  assert.match(result.dispatch.message, /Memory is full/);
  assert.doesNotMatch(taskOversight.resultLine({ kind: "work_on" }, { ...result, title: "Named" }), /Starting .*now|when a worker is free/);
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.execute, false);
});

test("a newer stop cancels an explicit Start while its capacity read is pending", async () => {
  let release, entered = false;
  const capacity = new Promise((resolve) => { release = resolve; });
  const h = workOnHost({ paused: true, execute: false, tasks: [namedTask()], workerCapacity: () => { entered = true; return capacity; } });
  const start = startNamed(h);
  for (let turn = 0; turn < 100 && !entered; turn++) await Promise.resolve();
  assert.equal(entered, true);
  await h.env.setAutopilot({ execute: false });
  release({ canStart: true });
  const result = await start;
  assert.equal(result.dispatch.reason, "cancelled");
  assert.match(result.dispatch.message, /cancelled/);
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].status, "open");
});

for (const control of ["pause", "stop"]) test(`${control} cancels named Start after its durable claim and releases ownership`, async () => {
  let release, calls = 0;
  const capacity = new Promise((resolve) => { release = resolve; });
  const h = addControls(workOnHost({ paused: true, execute: false, tasks: [namedTask()], workerCapacity: () => ++calls === 1 ? { canStart: true } : capacity }));
  const start = startNamed(h);
  for (let turn = 0; turn < 100 && calls < 2; turn++) await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(h.board().tasks[0].status, "active");
  assert.ok(h.board().tasks[0].runId, "a durable tentative claim exists before the stop");
  if (control === "pause") await h.env.assistantPause();
  else await h.env.setAutopilot({ execute: false });
  release({ canStart: true });
  const result = await start;
  assert.equal(result.dispatch.reason, "cancelled");
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].status, "open");
  assert.equal(h.board().tasks[0].runId, undefined);
  assert.equal(h.autopilot.jobs.length, 0);
  assert.equal(h.autopilot.taskStarts.size, 0);
  assert.equal(h.registry.size, 0);
});

test("a started named run can use its one CLI fallback after the admission permit is released", async () => {
  const h = workOnHost({ paused: true, execute: false, tasks: [namedTask()] });
  h.env.executorRunEnv = async () => ({ via: "grok cli", cli: "grok", grok: true, modelArgs: "", env: {}, opencode: { cli: "opencode", via: "opencode default", modelArgs: "", env: {} } });
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => spawn(command === "grok" ? "cmd.exe" : command, args, options);
  const result = await startNamed(h);
  assert.equal(result.dispatch.phase, "preparing");
  assert.equal(h.autopilot.taskStarts.size, 0);
  const runId = h.board().tasks[0].runId;
  h.starts[0].child.emit("close", 1);
  assert.equal(h.starts.length, 2);
  assert.ok(h.records.some((row) => row?.event === "fallback"));
  assert.equal(h.board().tasks[0].runId, runId, "fallback belongs to the original claimed attempt");
  assert.equal(h.autopilot.jobs.length, 1);
  assert.equal(h.state.status, "paused");
  assert.equal(h.autopilot.execute, false);
  await h.finish("named");
});

test("Start during stop settlement explains the remaining wait without granting a later restart", async () => {
  const h = workOnHost({ paused: true, execute: false, tasks: [namedTask()] });
  await startNamed(h);
  const worker = h.autopilot.jobs[0];
  worker.stopUser = true;
  worker.ownerHold = { at: h.now(), reason: "stopped by you" };
  const result = await startNamed(h);
  assert.equal(result.dispatch.phase, "stopping");
  assert.equal(result.dispatch.requested, false);
  assert.match(result.dispatch.message, /Choose Start this task again after it finishes saving/);
  assert.equal(worker.resumeRequested, undefined);
  await h.finish("named", { code: 1, lines: [] });
  assert.ok(h.board().tasks[0].ownerHold);
  assert.equal(h.starts.length, 1);
});

test("Work on a paused session keeps one pinned request and explains New work on repeat clicks", async () => {
  const h = workOnHost({ paused: true, execute: true });
  const settings = h.settings();
  const first = await h.workOn();
  assert.equal(first.ok, true);
  assert.equal(first.dispatch.requested, false);
  assert.equal(first.dispatch.held, true);
  assert.match(first.dispatch.message, /New work is paused.*Turn on New work/);
  assert.doesNotMatch(h.replies[0].text, /will start|Dispatch requested/);
  assert.deepEqual(h.effects, ["dispatch", "reply"], "reply follows the actual dispatch decision");
  assert.equal(h.board().requests[0].pin, true);
  assert.deepEqual(h.board().requests[0].target, { kind: target.kind, id: target.id });
  h.advance(1000);
  const second = await h.workOn();
  assert.match(second.where, /kept.*at the front of the inbox/);
  assert.match(second.dispatch.message, /New work is paused.*Turn on New work/);
  assert.equal(second.dispatch.requested, false);
  assert.equal(h.board().requests.length, 1, "repeat Work on repins without adding work");
  assert.equal(h.board().requests[0].pinAt, h.now());
  assert.equal(h.replies.length, 1, "rapid repeats retain existing chat deduplication");
  assert.equal(h.state.messages.filter((entry) => entry.role === "user").length, 1);
  await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.state.status, "paused", "prioritizing never lifts Pause");
  assert.equal(h.autopilot.execute, true);
  assert.deepEqual(h.settings(), settings);
  assert.deepEqual(h.roleRequests, [], "paused demand never reaches the foreman");
});

test("Work on explains disabled coding workers without enabling them", async () => {
  const h = workOnHost({ execute: false });
  const settings = h.settings();
  const result = await h.workOn();
  assert.equal(result.dispatch.held, true);
  assert.match(result.dispatch.message, /Coding workers are off.*Turn on New work/);
  assert.doesNotMatch(result.dispatch.message, /New work is paused|will start/);
  await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.state.status, "running");
  assert.deepEqual(h.settings(), settings);
});

test("Work on names both holds and their New work control when service and workers are stopped", async () => {
  const h = workOnHost({ paused: true, execute: false });
  const result = await h.workOn();
  assert.equal(result.dispatch.requested, false);
  assert.equal(result.dispatch.held, true);
  assert.match(result.dispatch.message, /New work is paused.*Turn on New work/);
  assert.match(result.dispatch.message, /Coding workers are off.*Turn on New work/);
  assert.equal(h.state.status, "paused");
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.starts.length, 0);
});

test("ready Work on confirms a dispatch request before the foreman starts the saved work", async () => {
  const h = workOnHost();
  const result = await h.workOn();
  assert.equal(result.dispatch.requested, true);
  assert.equal(result.dispatch.held, false);
  assert.match(result.dispatch.message, /Dispatch requested; worker start is not yet confirmed/);
  assert.equal(h.starts.length, 0, "the acknowledgement does not claim a worker that has not started");
  assert.deepEqual(h.effects, ["dispatch", "reply"]);
  await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.jobs[0].title, `Work on "${target.label}"`);
  // Only tasks run: the pinned inbox entry was promoted in the same foreman
  // pass, and its card carries the session it points at.
  const card = h.board().tasks.find((row) => row.title === `Work on "${target.label}"`);
  assert.ok(card, "the pinned request became a board task");
  assert.equal(h.autopilot.jobs[0].kind, "task");
  assert.equal(h.starts[0].taskId, card.id);
  assert.deepEqual(card.target, { kind: target.kind, id: target.id });
  assert.deepEqual(card.sessions, [target.id]);
});

test("Work on attaches to the session's running builder without recreating its promoted request", async () => {
  const h = workOnHost();
  await h.workOn();
  await h.pump();
  const running = h.autopilot.jobs[0];
  h.edit((board) => { board.requests = []; }); // compactor has removed the promoted request
  h.advance(9000);
  const result = await h.workOn();
  assert.equal(result.dispatch.phase, "building");
  assert.equal(result.dispatch.requested, false);
  assert.equal(result.dispatch.held, false);
  assert.match(result.dispatch.message, /worker is already running/i);
  assert.doesNotMatch(h.replies.at(-1).text, /queued|not yet confirmed|manual worker limit/i);
  assert.equal(h.board().requests.length, 0);
  assert.equal(h.autopilot.jobs[0], running);
  await h.pump();
  assert.equal(h.starts.length, 1);
});

test("Work on reuses and pins an unfinished promoted task for the same target", async () => {
  const h = workOnHost({ paused: true, tasks: [{ id: "promoted", title: "Renamed saved work", status: "open", target, pin: false }] });
  const result = await h.workOn();
  assert.match(result.where, /pinned.*front of the board/i);
  assert.equal(h.board().tasks[0].pin, true);
  assert.equal(h.board().requests.length, 0);
});

test("Work on reports a claimed builder as preparing until it has a child process", async () => {
  const h = workOnHost();
  await h.workOn();
  await h.pump();
  h.autopilot.jobs[0].child = null;
  h.autopilot.jobs[0].pid = null;
  h.edit((board) => { board.requests = []; });
  h.advance(9000);
  const result = await h.workOn();
  assert.equal(result.dispatch.phase, "preparing");
  assert.match(result.dispatch.message, /preparing.*worker/i);
  assert.doesNotMatch(result.dispatch.message, /already running|dispatch requested/i);
  assert.equal(h.board().requests.length, 0);
});

test("Work on it on a loop-held card re-arms it and resets its ledger", async () => {
  const loopGuard = { v: 1, at: 50, kind: "attempts", count: 6, reason: "run failed exit N", remedy: "Read the last attempts, edit or split the brief, then choose Try again.", by: "keeper" };
  const h = workOnHost({ paused: true, tasks: [{ id: "held", title: "Looping card", status: "open", prompt: "A looping brief", providerFailures: 1, loopLedger: { v: 1, at: 50, n: 6, reasons: { "run failed exit N": 6 } }, loopGuard, logs: [] }] });
  assert.equal(h.env.backlog.workState(h.board().tasks[0]).blockedBy, "loop");
  const result = await h.env.assistantWorkOn({ kind: "task", id: "held", label: "Looping card" });
  assert.equal(result.ok, true);
  assert.match(result.where, /pinned "Looping card" to the front of the board/);
  const task = h.board().tasks[0];
  assert.equal(task.loopGuard, undefined, "the owner's ask releases the hold");
  assert.equal(task.providerFailures, undefined);
  assert.deepEqual(task.loopLedger, { v: 1, at: h.now(), n: 0, reasons: {} }, "nothing logged before the ask is counted again");
  assert.equal(task.pin, true);
  assert.equal(h.env.backlog.workState(task, h.now()).stage, "ready");
});

test("Work on preserves verification and reports it instead of queueing a second attempt", async () => {
  const h = workOnHost({ tasks: [{ id: "review", title: "Saved work", target, status: "awaiting_verification", lastAttempt: { result: "done: fixed" } }] });
  const result = await h.workOn();
  assert.equal(result.dispatch.phase, "verifying");
  assert.match(result.dispatch.message, /awaiting verification/i);
  assert.equal(h.board().tasks[0].status, "awaiting_verification");
  assert.equal(h.board().requests.length, 0);
});

test("the conversation confirms startup only after the requested worker's spawn event", async () => {
  const h = workOnHost();
  // The real task-notice block: the start is announced by the spawn handler
  // through assistantTaskStarted, as a notice on the owner's task.
  Object.assign(h.env, { taskOversight, assistantEmit() {}, logError: (text) => { throw new Error(text); } });
  vm.runInContext(section("// ---- task notices", "// The board as it stands when the assistant loads"), h.env);
  const started = () => h.state.messages.filter((message) => message.kind === "notice" && message.event === "started");
  await h.workOn();
  await h.pump();
  assert.equal(started().length, 0, "allocating a claim is not a startup confirmation");
  h.starts[0].child.emit("spawn");
  assert.equal(started().length, 1);
  assert.match(started()[0].text, /^Started: Work on/);
  h.starts[0].child.emit("spawn");
  assert.equal(started().length, 1, "one startup confirmation per attempt");
  assert.equal(h.replies.length, 1, "the start is a notice about the task, not a second reply");
});

test("Work on a running task remains truthful while new work is paused and workers are disabled", async () => {
  const h = workOnHost();
  await h.workOn();
  await h.pump();
  h.state.status = "paused";
  h.autopilot.execute = false;
  const running = h.autopilot.jobs[0];
  const saved = h.board().tasks[0];
  const result = await h.env.assistantWorkOn({ kind: "task", id: running.taskId, label: running.title });
  assert.equal(result.dispatch.phase, "building");
  assert.equal(result.dispatch.held, false);
  assert.match(result.dispatch.message, /worker is already running/i);
  assert.deepEqual(h.board().tasks[0], saved, "no pin or approval mutation on an occupied task");
  assert.equal(h.state.status, "paused");
  assert.equal(h.autopilot.execute, false);
});

test("Work on the worker's actual session follows that run even when its task has another target", async () => {
  const h = workOnHost();
  await h.workOn();
  await h.pump();
  h.autopilot.jobs[0].sessionId = "spawned-session";
  const before = h.board();
  const result = await h.env.assistantWorkOn({ kind: "session", id: "spawned-session", label: "Worker session" });
  assert.equal(result.dispatch.phase, "building");
  assert.deepEqual(h.board(), before);
});

test("a stale saved assignment is checked without claiming its worker has started", async () => {
  const h = workOnHost({ tasks: [{ id: "stale", title: "Saved work", target, status: "active", runId: "old-run" }] });
  const result = await h.workOn();
  assert.equal(result.dispatch.phase, "assigned");
  assert.equal(result.dispatch.requested, true, "the foreman must reconcile the saved claim");
  assert.match(result.dispatch.message, /check that assignment/i);
  assert.doesNotMatch(result.dispatch.message, /already running/);
  assert.equal(h.board().requests.length, 0);
});

test("rejected dispatch keeps the request and gives no start promise", async () => {
  const h = workOnHost();
  h.env.SMOKE = true;
  const result = await h.workOn();
  assert.equal(result.dispatch.requested, false);
  assert.equal(result.dispatch.held, true);
  assert.match(result.dispatch.message, /dispatch could not be requested/i);
  assert.doesNotMatch(result.dispatch.message, /will start|Dispatch requested;/);
  assert.equal(h.board().requests.length, 1);
  assert.equal(h.starts.length, 0);
  assert.deepEqual(h.roleRequests, []);
});

test("Resume schedules the existing pinned session without a second Work on click", async () => {
  const h = workOnHost({ paused: true });
  const held = await h.workOn();
  assert.equal(held.dispatch.requested, false);
  const queued = h.board().requests[0];
  const scheduled = [];
  Object.assign(h.env, {
    applyKeepAwake() {}, assistantPump() {}, assistantLoop: true,
    assistantSchedule: (delay) => { scheduled.push(delay); h.wake("fixture scheduled assistant tick"); },
  });
  vm.runInContext(section("async function assistantResume()", "// ---- 24/7:"), h.env);
  await h.env.assistantResume();
  assert.deepEqual(scheduled, [0], "Resume requests an immediate assistant tick");
  await h.pump();
  assert.equal(h.state.status, "running");
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.jobs[0].title, queued.title);
  assert.equal(h.autopilot.jobs[0].ref.prompt, queued.prompt);
  assert.equal(h.autopilot.jobs[0].ref.pin, true);
  assert.deepEqual(h.autopilot.jobs[0].ref.target, queued.target);
  assert.equal(h.board().tasks.length, 1, "the foreman promotes the saved request exactly once");
  assert.equal(h.replies.length, 1, "starting the work required no repeat request");
});

test("New work enables workers and resumes scheduling without changing growth or approval settings", async () => {
  const h = addControls(workOnHost({ paused: true, execute: false, autoBuild: false, mode: "cluster", parallel: 2 }));
  h.state.prefs.proactive = false;
  h.state.prefs.backlogMode = false;
  h.autopilot.enabled = false;
  const preferences = structuredClone(h.state.prefs);
  const initial = { mode: h.autopilot.mode, parallel: h.autopilot.parallel, adaptiveParallel: h.autopilot.adaptiveParallel, autoBuild: h.autopilot.autoBuild };
  await h.workOn();
  const order = [];
  const setAutopilot = h.env.setAutopilot, resume = h.env.assistantResume, ask = h.env.assistantAskForWork;
  h.env.setAutopilot = async (patch) => {
    assert.deepEqual({ ...patch }, { execute: true });
    assert.equal(h.state.status, "paused");
    const result = await setAutopilot(patch);
    order.push("settings saved");
    return result;
  };
  h.env.assistantResume = async () => { order.push("resume"); return resume(); };
  h.env.assistantAskForWork = (reason) => { order.push(reason); return ask(reason); };
  const result = await h.env.assistantControl("start-work");
  assert.equal(result.ok, true);
  assert.equal(result.state.status, "running");
  assert.equal(h.autopilot.execute, true);
  assert.equal(h.settings().ui.autopilot.execute, true);
  assert.deepEqual(order, ["settings saved", "resume", "new work enabled"]);
  assert.deepEqual(h.state.prefs, preferences);
  assert.equal(h.autopilot.enabled, false, "the automatic discovery preference is unchanged");
  for (const [key, value] of Object.entries(initial)) assert.equal(h.autopilot[key], value, `${key} remains unchanged`);
  assert.ok(h.roleRequests.includes("foreman"));
  await h.pump();
  assert.equal(h.starts.length, 0, "enabling scheduling never bypasses build approval");
  assert.equal(h.board().tasks.length, 1);
  assert.equal(h.board().tasks[0].status, "open");
  assert.equal(h.board().tasks[0].buildApproval, undefined);
});

test("New work reports a settings failure without resuming the paused assistant", async () => {
  const h = addControls(workOnHost({ paused: true, execute: false }));
  await h.workOn();
  let resumed = false;
  h.env.assistantResume = async () => { resumed = true; h.state.status = "running"; };
  h.env.writeSettings = async () => { throw new Error("fixture settings storage unavailable"); };
  const result = await h.env.assistantControl("start-work");
  assert.equal(result.ok, false);
  assert.match(result.error, /settings storage unavailable/);
  assert.equal(resumed, false);
  assert.equal(h.state.status, "paused");
  assert.equal(h.settings().ui.autopilot.execute, false, "failed settings are not presented as saved");
  assert.deepEqual(h.roleRequests, [], "a failed enable never requests dispatch");
  assert.equal(h.starts.length, 0);
});

test("global Start agents releases a saved pause and launch hold after an older boot read finishes", async () => {
  const h = addControls(workOnHost({ paused: true, execute: false, tasks: [namedTask()] }));
  h.autopilot.held = true;
  const saved = h.settings(), readSettings = h.env.readSettings;
  let release, reading = false;
  const pendingRead = new Promise((resolve) => { release = resolve; });
  h.env.readSettings = async () => {
    if (!reading) { reading = true; await pendingRead; return saved; }
    return readSettings();
  };
  const scheduled = [];
  Object.assign(h.env, {
    applyTray() {}, refreshTray() {}, assistantResumeWork: async () => {},
    assistantSchedule: (delay) => { scheduled.push(delay); h.wake("service resumed"); },
  });
  vm.runInContext(section("async function releaseStartupHold()", "// Quit path:"), h.env);
  const boot = h.env.bootAutopilot();
  for (let turn = 0; turn < 20 && !reading; turn++) await Promise.resolve();
  assert.equal(reading, true);
  const start = h.env.assistantControl("start-work");
  await Promise.resolve();
  assert.equal(h.autopilot.execute, false, "the explicit enable waits for the older settings snapshot");
  release();
  const result = await start;
  await boot;
  assert.equal(result.ok, true);
  assert.equal(h.state.status, "running");
  assert.equal(h.autopilot.held, false);
  assert.equal(h.autopilot.execute, true);
  assert.equal(h.settings().ui.autopilot.execute, true);
  assert.ok(scheduled.includes(0));
  await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["named"]);
});

for (const control of [null, "pause", "stop"]) test(`held named Start loads saved preferences without overriding ${control || "its explicit permission"}`, async () => {
  const ownerHold = { at: 1, reason: "stopped by you" };
  const h = addControls(workOnHost({ paused: true, execute: false, tasks: [namedTask({ ownerHold })] }));
  h.autopilot.held = true;
  const saved = h.settings(), readSettings = h.env.readSettings;
  let release, reading = false;
  const pendingRead = new Promise((resolve) => { release = resolve; });
  h.env.readSettings = async () => {
    if (!reading) { reading = true; await pendingRead; return saved; }
    return readSettings();
  };
  const start = startNamed(h);
  for (let turn = 0; turn < 100 && !reading; turn++) await Promise.resolve();
  assert.equal(reading, true);
  assert.equal(h.starts.length, 0, "saved build approval and mode must load before admission");
  if (control === "pause") await h.env.assistantPause();
  if (control === "stop") await h.env.setAutopilot({ execute: false });
  release();
  const result = await start;
  assert.equal(result.dispatch.reason, control ? "cancelled" : null);
  assert.equal(h.starts.length, control ? 0 : 1);
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.autopilot.held, true);
  assert.equal(h.state.status, "paused");
  if (control) {
    assert.deepEqual(h.board().tasks[0].ownerHold, ownerHold);
    assert.equal(h.board().tasks[0].runId, undefined);
    assert.equal(h.registry.size, 0);
  } else await h.finish("named");
});

test("an early named Start honors saved verify-first before any worker is admitted", async () => {
  const h = workOnHost({ paused: true, execute: false, autoBuild: true, tasks: [namedTask()], savedSettings: { ui: { autopilot: { execute: false, autoBuild: false } } } });
  h.autopilot.held = true;
  const result = await startNamed(h);
  assert.equal(result.dispatch.reason, "approval");
  assert.equal(result.dispatch.held, true);
  assert.equal(h.autopilot.autoBuild, false);
  assert.equal(h.starts.length, 0);
});

test("New work starts the queued request and Pause leaves that worker running while holding later work", async () => {
  const h = addControls(workOnHost({ paused: true, execute: false }));
  await h.workOn();
  assert.equal((await h.env.assistantControl("start-work")).ok, true);
  await h.pump();
  assert.equal(h.starts.length, 1);
  const running = h.autopilot.jobs[0];
  assert.equal(running.title, `Work on "${target.label}"`);
  assert.equal(h.replies.length, 1, "enabling uses the already saved request");
  h.edit((board) => board.tasks.push({ id: "later", title: "Later fixture task", status: "open", prompt: "A separate task", files: ["later.js"] }));
  const result = await h.env.assistantControl("pause");
  assert.equal(result.ok, true);
  assert.equal(result.state.status, "paused");
  assert.equal(h.wake("new work while paused"), false);
  await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(h.autopilot.jobs[0], running, "Pause retains the live worker and its ownership");
  assert.equal(running.finished, false);
  assert.equal(h.terminations.length, 0);
  assert.equal(h.board().tasks.find((task) => task.id === "later").status, "open");
});

// ---- the thinker's pin ---------------------------------------------------------
// The real thinker pass (assistantThinkerJob reads the board through
// assistantThinkerFacts and pins through assistantWorkOn's thinker form), with
// the owner's focus on a session they clicked.
function thinkerHost(tasks) {
  const h = workOnHost({ tasks });
  const notes = [], thoughts = [];
  h.state.prefs.proactive = true;
  h.state.focus = { kind: "session", id: "session-S", label: "The owner's session" };
  Object.assign(h.env, {
    assistantNodeContext: (node, kind, text) => notes.push({ node, kind, text }),
    assistantCommitThought: (text) => thoughts.push(text),
    logError: (text) => h.logs.push(text),
  });
  vm.runInContext([
    section("async function assistantThinkerJob(", "// Ask the assistant to hand work out."),
    section("function assistantOwnsTask(", "function assistantObserveTasks("),
  ].join("\n"), h.env);
  return Object.assign(h, { notes, thoughts, task: (id) => h.board().tasks.find((task) => task.id === id) });
}

test("the thinker never pins ahead of the card the owner just pinned", async () => {
  // suggestWork ignores pins, so its top pick was the older chat card B; the
  // thinker's pin (pinAt now, newest wins) then started B ahead of A.
  const h = thinkerHost([
    { id: "task_b", title: "Older chat card B", status: "open", source: "chat", createdAt: 1, logs: [] },
    { id: "task_a", title: "Composer card A", status: "open", source: "chat", pin: true, pinAt: 995_000, origin: { kind: "composer", by: "owner" }, createdAt: 2, logs: [] },
  ]);
  const result = await h.env.assistantThinkerJob(h.now(), null);
  assert.notEqual(result.intel?.pinned, true, result.text);
  assert.equal(h.task("task_b").pin, undefined, "the thinker's pick is only named");
  assert.equal(h.task("task_a").pinAt, 995_000);
  assert.deepEqual(h.roleRequests, [], "nothing asked for on the thinker's account");
});

test("the thinker's pin is not the owner's: focus, notes and ownership stay theirs, and it sorts behind their pins", async () => {
  const scout = (n) => ({ id: `task_scout${n}`, title: `Scout card ${n}`, status: "open", source: "a-eyes", createdAt: 4 + n, logs: [] });
  const h = thinkerHost([
    { id: "task_old", title: "Old plain card", status: "open", createdAt: 1, logs: [] },
    scout(1), scout(2), scout(3),
    // The owner's pin on a card cooling down: it goes first again when ready.
    { id: "task_owner", title: "Owner's cooling card", status: "open", source: "chat", pin: true, pinAt: 990_000, nextRunAt: 5_000_000, createdAt: 3, logs: [] },
  ]);
  const focus = structuredClone(h.state.focus);
  const result = await h.env.assistantThinkerJob(h.now(), null);
  assert.equal(result.intel?.pinned, true, result.text);
  const pinned = h.task("task_scout1");
  assert.equal(pinned.pin, true);
  assert.deepEqual(h.state.focus, focus, "the owner's focus stays on their session");
  assert.deepEqual(h.notes, [], "no \"work on it\" note on the node");
  assert.equal(pinned.logs.at(-1).text, "put first by the thinker");
  assert.equal(h.state.messages.length, 0, "no synthetic owner line and no reply");
  assert.equal(h.env.assistantOwnsTask(pinned), false, "an agent's card the thinker put first stays the agents'");
  assert.ok(pinned.pinAt < 990_000, `older than the owner's pin (${pinned.pinAt})`);
  assert.equal(pinned.thinkerPin, pinned.pinAt);
  const owner = { ...h.task("task_owner"), nextRunAt: 0 };
  assert.ok(baselineCompareWork(owner, pinned) < 0, "the owner's pin still goes first");
  assert.deepEqual(h.roleRequests, ["foreman"], "the pin asks the foreman like any Work on it");
  assert.equal(h.autopilot.lastAsk.reason, "the thinker put a card first");
  assert.equal(h.thoughts.length, 1);
  // The owner's own Work on it on that card makes it theirs.
  await h.env.assistantWorkOn({ kind: "task", id: "task_scout1", label: "Scout card 1" });
  const owned = h.task("task_scout1");
  assert.equal(owned.thinkerPin, undefined);
  assert.equal(h.env.assistantOwnsTask(owned), true);
});
