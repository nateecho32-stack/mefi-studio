// The loop's control plane: Stop all, the assistant's tick chain, a deferred
// manual restart and a foreman pass a project switch left behind. Each runs
// main.cjs's own section in a vm sandbox; no Electron, children or disk.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { executorHost } from "./fixtures/host_executor.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

// setAutopilot awaited its settings write before the kill loop, so a
// settings.json that could not be written (a sync client's lock, a full disk)
// rejected the whole brake with every worker still running.
test("Stop all stops every worker even when the stop cannot be saved", async () => {
  const stops = [];
  const logs = [];
  const job = { id: "run_1", finished: false, child: {}, stop: (reason) => stops.push(reason) };
  const env = vm.createContext({
    Date, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    autopilot: { enabled: true, execute: true, jobs: [job], parallel: 2, minutes: 5, adaptiveParallel: true, mode: "swarm", autoBuild: true },
    EXECUTOR_PARALLEL_MAX: 8, EXECUTOR_PARALLEL_CAP: 8, proactiveTimer: null,
    updateSettings: async () => { throw new Error("EBUSY: resource busy or locked, open 'settings.json'"); },
    projects: { run: (_project, fn) => fn(), active: () => ({}) },
    emitAutopilot() {}, assistantAskForWork() {}, logLine: (text) => logs.push(text), queueExecutorCheckpoint() {},
    assistantState: null, CLI_MODE: false, autopilotStatus: () => ({}),
  });
  vm.runInContext(section("async function setAutopilot(", "// ---- the operator's stop-everything brake")
    + section("function executorIdle(", "// Manual \"restart Studio\""), env);
  const pending = env.stopAllAgents({ reason: "stopped by user", waitMs: 0 });
  job.finished = true;
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(stops, ["stopped by user"], "the worker is stopped");
  assert.equal(job.stopUser, true, "as an intentional stop, so its progress is kept");
  assert.equal(env.autopilot.execute, false);
  assert.ok(logs.some((line) => /stop applied, but not saved: EBUSY/.test(line)), "the failed save is reported, not thrown");
});

// The tick timer is a one-shot chain that only a completed switch re-armed:
// a timer tick skipped during a switch that was then refused stopped the
// keeper, the overseer and every other cadence role until a manual Resume.
test("a timer tick skipped during a project switch keeps the tick chain alive", async () => {
  const timers = [];
  const env = vm.createContext({
    projects: { run: (_project, fn) => fn(), active: () => ({ id: "a" }) },
    projectSwitching: true, assistantLoop: true, assistantTimer: null, assistantTickInFlight: null, assistantTickDemand: null,
    assistantState: { status: "running", intervalMs: 30000 }, logLine() {},
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  });
  vm.runInContext(section("function assistantSchedule(", "// ---- session continuity"), env);
  env.assistantSchedule();
  assert.equal(timers.length, 1);
  const tick = timers.shift();
  await tick.fn();
  assert.equal(timers.length, 1, "the skipped tick armed the next one");
  assert.equal(timers[0].delay, 30000);
  assert.equal((await env.assistantTick("manual")).skipped, "switching project");
  assert.equal(timers.length, 1, "a demand tick arms no second timer");
});

function restartHost({ killMs = 25 * 60 * 1000 } = {}) {
  let exits = 0, asks = 0;
  const job = { id: "run_1", finished: false };
  const env = vm.createContext({
    Date, Promise, setTimeout, clearTimeout, activeChild: null, window: null, projectSwitching: false,
    autopilot: { jobs: [job] }, EXECUTOR_KILL_MS: killMs, UPDATE_GRACE_MS: 0, updater: { status: () => ({ auto: true }) },
    updateSettings: async (mutate) => mutate({}), saveResume: async () => {}, send() {}, logLine() {},
    assistantAskForWork: () => { asks += 1; },
    stopUpdateWatch() {}, stopEyesWatch() {}, stopMachineWatch() {}, stopAssistant() {}, relaunchArgs: () => [],
    app: { releaseSingleInstanceLock() {}, relaunch() {}, exit: () => { exits += 1; } },
  });
  vm.runInContext(section("// A pending restart drains", "async function startUpdateWatch(")
    + section("function executorIdle(", "// The project gate needs"), env);
  return { env, job, exits: () => exits, asks: () => asks };
}

// Only the updater's own phase events cleared a drain, and a manual restart
// has none: dispatch waited on "Studio update waiting…" with no restart ever
// following once the builds finished.
test("a manual restart deferred for a finishing build restarts once the build ends", async () => {
  const h = restartHost();
  const deferred = await h.env.applyRestart([], { counted: false });
  assert.equal(deferred.deferred, true);
  assert.match(h.env.executorUpdateHold(), /waiting for current builds/);
  h.job.finished = true;
  h.env.autopilot.jobs.splice(0); // settled: the entry leaves the list
  for (let turn = 0; turn < 40 && !h.exits(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(h.exits(), 1, "the restart the owner asked for happens");
});

test("a manual restart whose builds never end gives the queue back", async () => {
  const h = restartHost({ killMs: -5 * 60 * 1000 });
  await h.env.applyRestart([], { counted: false });
  for (let turn = 0; turn < 40 && h.env.executorUpdateHold(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(h.env.executorUpdateHold(), null, "dispatch is no longer held");
  assert.equal(h.asks(), 1);
  assert.equal(h.exits(), 0);
});

test("Restart now stops all coding workers and saves their latest progress before relaunch", async () => {
  const tasks = ["first", "second"].map((id) => ({ id, title: `Implement ${id}`, prompt: `Build ${id}`, files: [`${id}.js`], status: "open", createdAt: 1 }));
  const h = executorHost({ tasks, parallel: 2 });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 2);
  for (const job of h.autopilot.jobs) {
    job.sessionId = `session-${job.taskId}`;
    job.todos = [{ content: `Verify ${job.taskId}`, status: "in_progress" }];
    job.outputTail = [`Last action for ${job.taskId}`];
  }
  let releaseWrites, releaseIdle, stopped, exits = 0, helperSaves = 0;
  const writes = new Promise((resolve) => { releaseWrites = resolve; });
  const idle = new Promise((resolve) => { releaseIdle = resolve; });
  const stopping = new Promise((resolve) => { stopped = resolve; });
  const mutate = h.env.mutateBoard;
  h.env.mutateBoard = async (fn) => { await writes; return mutate(fn); };
  Object.assign(h.env, {
    activeChild: null, window: null, UPDATE_GRACE_MS: 0, updater: { status: () => ({ auto: true }) },
    assistantClearQueue: ({ abandonRunning }) => assert.equal(abandonRunning, true),
    saveAssistant: async () => { helperSaves += 1; return { ok: true }; },
    waitForExecutorIdle: async () => { stopped(); await idle; return !h.autopilot.jobs.length; },
    saveResume: async () => assert.equal(h.autopilot.jobs.length, 0),
    stopUpdateWatch() {}, stopEyesWatch() {}, stopMachineWatch() {}, stopAssistant() {}, relaunchArgs: () => ["--updated"],
    app: { releaseSingleInstanceLock() {}, relaunch() { assert.ok(helperSaves > 0); }, exit() { exits += 1; } },
  });
  const schedule = h.env.setTimeout;
  h.env.setTimeout = (fn, delay) => delay === 0 ? setTimeout(fn, delay) : schedule(fn, delay);
  vm.runInContext(section("// A pending restart drains", "async function startUpdateWatch("), h.env);
  const restart = h.env.applyRestart(["main.cjs"], { counted: false, stopAgents: true });
  await stopping;
  assert.equal(h.terminations.length, 2, "every owned coding process tree receives a stop");
  assert.equal(h.autopilot.execute, false);
  assert.equal(h.state.status, "paused");
  for (const termination of h.terminations) termination.child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits, 0, "process exit alone is insufficient while checkpoint writes wait");
  assert.equal(h.autopilot.jobs.length, 2);
  releaseWrites();
  for (let turn = 0; h.autopilot.jobs.length && turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.autopilot.jobs.length, 0);
  releaseIdle();
  assert.equal((await restart).ok, true);
  assert.equal(exits, 1);
  assert.deepEqual(h.settings().update.lastRestart.files, ["main.cjs"]);
  assert.deepEqual(h.settings().update.restarts, [], "the owner's click is not an automatic restart loop");
  for (const task of h.board().tasks) {
    assert.equal(task.status, "open");
    assert.equal(task.runProgress.pending, true);
    assert.equal(task.runProgress.sessionId, `session-${task.id}`);
    assert.deepEqual(task.runProgress.outputTail, [`Last action for ${task.id}`]);
    assert.equal(task.runProgress.todos[0].content, `Verify ${task.id}`);
    assert.equal(task.runFailures ?? 0, 0, "an update does not charge a failed coding attempt");
  }
});

test("Restart now keeps Studio open when the helper journal cannot be saved", async () => {
  const h = restartHost();
  h.env.assistantState = { status: "running" };
  h.env.CLI_MODE = false;
  h.env.stopAllAgents = async () => { h.env.autopilot.jobs = []; return { ok: true, idle: true }; };
  h.env.saveAssistant = async () => ({ ok: false, error: "disk full" });
  vm.runInContext(section("async function restartStudio(", "// Retained manual-mode default"), h.env);
  const result = await h.env.applyRestart(["main.cjs"], { stopAgents: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not save agent progress: disk full/);
  assert.equal(h.exits(), 0);
});

test("Restart now waits for a project switch before stopping its agents", async () => {
  const h = restartHost();
  h.env.projectSwitching = true;
  h.env.stopAllAgents = async () => assert.fail("a project switch owns the stop/save operation");
  vm.runInContext(section("async function restartStudio(", "// Retained manual-mode default"), h.env);
  assert.equal((await h.env.applyRestart(["main.cjs"], { stopAgents: true })).deferred, true);
  assert.equal(h.exits(), 0);
});

test("the update button with no pending changes still uses stop-and-save restart", async () => {
  let handler, stops = 0;
  const env = vm.createContext({
    updater: { applyNow: async () => ({ ok: true, applied: false, phase: "watching" }), status: () => ({ phase: "watching" }) },
    ipcMain: { handle: (_channel, fn) => { handler = fn; } },
    restartStudio: async () => { stops += 1; return { ok: false, error: "save failed" }; },
  });
  vm.runInContext(section('  ipcMain.handle("update:apply",', "  // The manual restart with the agents stopped"), env);
  const result = await handler();
  assert.equal(stops, 1);
  assert.equal(result.ok, false);
  assert.equal(result.error, "save failed");
});

test("an update still saving its workers never starts a second empty restart", async () => {
  let handler;
  const env = vm.createContext({
    updater: { applyNow: async () => ({ ok: true, applied: false, phase: "pending", reason: "worker saving" }), status: () => ({ phase: "pending" }) },
    ipcMain: { handle: (_channel, fn) => { handler = fn; } },
    restartStudio: async () => assert.fail("the pending update already owns its restart and file list"),
  });
  vm.runInContext(section('  ipcMain.handle("update:apply",', "  // The manual restart with the agents stopped"), env);
  assert.equal((await handler()).phase, "pending");
});

// drainProjectGate abandons a running roster pass and lets the switch go on,
// while the pass's body still runs scoped to the old project.
test("a foreman pass a project switch abandoned starts no worker in the project left behind", async () => {
  const h = executorHost({ tasks: [{ id: "old-card", title: "Task old-card", prompt: "Do it", status: "open", createdAt: 1, updatedAt: 1, source: "chat" }] });
  h.env.projects = {
    current: () => ({ id: "A", path: path.resolve("fixture-only-project") }),
    active: () => ({ id: "B", path: "/elsewhere/B" }),
    open: () => ({ id: "B", path: "/elsewhere/B" }),
    run: (_project, fn) => fn(),
  };
  h.env.projectSwitching = false;
  const result = await h.env.assistantForemanJob(h.now(), { abandoned: true, settled: true });
  assert.match(result.text, /project changed/);
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].status, "open", "the old project's card is not claimed");
  // Even a caller with no abandoned mark cannot dispatch into a project the
  // owner has left.
  assert.equal(await h.env.spawnNextJob(), "empty");
  assert.equal(h.starts.length, 0);
});
