// The overseer's verification drain: bounded-parallel job execution and the
// coalesced settle kick after results land. Memory-only stores, no real child
// processes or timers.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import agentModes from "../scripts/agent-modes.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const from = source.indexOf("const verificationJobs = [];");
const to = source.indexOf("// A finished run's handoffs:", from);
assert.ok(from >= 0 && to > from, "the verification drain boundary exists");
const DRAIN = `${source.slice(from, to)}
globalThis.__queueVerification = (job) => verificationJobs.push(job);
globalThis.__verificationQueue = verificationJobs;`;

function drainHost({ tasks = [], requests = [] } = {}) {
  let board = structuredClone({ tasks, requests });
  const logs = [];
  const spawns = [];
  const timers = [];
  const housekeeping = [];
  // Roots that would actually host an npm script; a test can shrink this to
  // exercise the payload fallback.
  const pkgRoots = new Set(["C:/fixture-root", "C:/fixture-studio"]);
  const env = vm.createContext({
    // Every command is a controllable child: the test closes it by hand.
    spawn: (command, options) => {
      const child = new EventEmitter();
      child.command = String(command);
      child.cwd = options?.cwd;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; };
      child.close = (code, signal = null) => child.emit("close", code, signal);
      spawns.push(child);
      return child;
    },
    setTimeout: (fn, delay) => {
      const timer = { fn, delay, cancelled: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    mutateBoard: async (mutator) => {
      const next = structuredClone(board);
      const result = mutator(next);
      if (result) board = result;
      return structuredClone(board);
    },
    logLine: (text) => logs.push(String(text)),
    projectRoot: () => "C:/fixture-root",
    SOURCE_ROOT: "C:/fixture-studio",
    STUDIO_ROOT: "C:/fixture-payload",
    hasPackageJson: (dir) => pkgRoots.has(dir),
    agentModes,
    autopilotHousekeeping: async () => { housekeeping.push(true); },
  });
  vm.runInContext(DRAIN, env);
  return {
    env, spawns, timers, logs, housekeeping, pkgRoots,
    board: () => structuredClone(board),
    queue: (job) => env.__queueVerification(job),
    queued: () => env.__verificationQueue.length,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    settleTimer: () => timers.find((timer) => timer.delay === 1000 && !timer.cancelled),
  };
}

test("verification jobs run two at a time so a done-report burst does not stack behind one check", async () => {
  const host = drainHost();
  for (const id of ["one", "two", "three"]) host.queue({ key: `k-${id}`, taskId: `t-${id}`, commands: [`check-${id}`] });
  const drain = host.env.runVerificationJobs({});
  assert.deepEqual(host.spawns.map((child) => child.command), ["check-one", "check-two"], "the first pair starts together");
  host.spawns[0].close(0);
  await host.flush();
  assert.deepEqual(host.spawns.map((child) => child.command), ["check-one", "check-two", "check-three"], "the freed slot picks the next job up before the drain ends");
  host.spawns[1].close(0);
  host.spawns[2].close(0);
  await drain;
  assert.equal(host.queued(), 0, "the drain consumed the queue");
  assert.equal(host.logs.filter((line) => line.includes("verification run passed")).length, 3);
});

test("commands stay sequential inside a job and a failed check stamps the card", async () => {
  const host = drainHost({ tasks: [{ id: "t-one", title: "One", verificationRun: { key: "k-one", state: "queued" } }] });
  host.queue({ key: "k-one", taskId: "t-one", commands: ["npm run check", "node --test tests/one.test.mjs"] });
  const drain = host.env.runVerificationJobs({});
  assert.deepEqual(host.spawns.map((child) => child.command), ["npm run check"], "the focused test waits for the check");
  host.spawns[0].stderr.emit("data", "1 failing test\n");
  host.spawns[0].close(1);
  await drain;
  assert.equal(host.spawns.length, 1, "the focused test never runs after the check fails");
  const task = host.board().tasks[0];
  assert.equal(task.verificationRun.state, "failed");
  assert.equal(task.verificationRun.results.length, 1);
  assert.match(task.verificationRun.results[0].tail, /1 failing test/);
  assert.match(task.logs.at(-1).text, /verification run failed/);
});

test("request rows are stamped by request identity, not by a task id", async () => {
  const request = { at: 7, prompt: "Do work", title: "Req", verificationRun: { key: "k-req", state: "queued" } };
  const host = drainHost({ requests: [request] });
  host.queue({ key: "k-req", taskId: agentModes.requestKey(request), commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs({});
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.board().requests[0].verificationRun.state, "passed");
});

test("a landed result kicks one coalesced housekeeping pass instead of waiting for the next autopilot tick", async () => {
  const host = drainHost();
  host.queue({ key: "k-a", taskId: "t-a", commands: ["check-a"] });
  host.queue({ key: "k-b", taskId: "t-b", commands: ["check-b"] });
  const drain = host.env.runVerificationJobs({});
  host.spawns[0].close(0);
  host.spawns[1].close(0);
  await drain;
  assert.equal(host.housekeeping.length, 0, "the pass waits for its debounce timer");
  const timer = host.settleTimer();
  assert.ok(timer, "a settle timer was armed");
  assert.equal(host.timers.filter((row) => row.delay === 1000 && !row.cancelled).length, 1, "both results share one timer");
  timer.fn();
  await host.flush();
  assert.equal(host.housekeeping.length, 1, "one housekeeping pass settles the batch");
});

// A done report on a task from a project without its own package.json (a game
// checkout, a notes tree) used to run `npm run check` in that folder and die
// ENOENT before any real check executed.
test("a project folder without package.json has its verification moved to the Studio checkout", async () => {
  const host = drainHost({ tasks: [{ id: "t-game", title: "Game fix", verificationRun: { key: "k-game", state: "queued" } }] });
  host.queue({ key: "k-game", taskId: "t-game", projectPath: "C:/game checkout", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs({});
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.spawns[0].cwd, "C:/fixture-studio", "npm cannot run where no package.json defines the script");
  assert.ok(host.logs.some((line) => line.includes("has no package.json")), "the move is logged");
  assert.equal(host.board().tasks[0].verificationRun.state, "passed", "the check itself still settles the card");
});

test("a project that defines its own npm scripts keeps its own root", async () => {
  const host = drainHost();
  host.queue({ key: "k-app", taskId: "t-app", projectPath: "C:/fixture-root", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs({});
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.spawns[0].cwd, "C:/fixture-root");
  assert.equal(host.logs.some((line) => line.includes("has no package.json")), false, "no move was logged");
});

test("a payload install with no npm checkout falls back to the app payload root", async () => {
  const host = drainHost();
  host.pkgRoots.delete("C:/fixture-studio");
  host.queue({ key: "k-orphan", taskId: "t-orphan", projectPath: "C:/game checkout", commands: ["npm run check"] });
  const drain = host.env.runVerificationJobs({});
  host.spawns[0].close(0);
  await drain;
  assert.equal(host.spawns[0].cwd, "C:/fixture-payload");
});
