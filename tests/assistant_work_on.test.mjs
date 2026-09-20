import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";

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
  await h.workOn();
  await h.pump();
  assert.equal(h.replies.length, 1, "allocating a claim is not a startup confirmation");
  h.starts[0].child.emit("spawn");
  assert.equal(h.replies.length, 2);
  assert.match(h.replies[1].text, /^Started: Work on/);
  h.starts[0].child.emit("spawn");
  assert.equal(h.replies.length, 2, "one startup confirmation per attempt");
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
