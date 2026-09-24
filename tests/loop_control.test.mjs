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
    Date, Promise, setTimeout, clearTimeout, activeChild: null, window: null,
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
