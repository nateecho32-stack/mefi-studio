// A builder run end to end through the host's own finish(), attach() and
// fallbackToOpencode() (sliced from main.cjs) with fake children, a movable
// clock and captured timers: what the card is charged, and what the model
// ledger records, when a CLI builder falls back to OpenCode, a provider says
// it is down, or the owner stops the run. The ledger row is the evidence the
// win-probability router reads, so it must name the model that did the work
// and count only that model's own failures.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import agentModes from "../scripts/agent-modes.cjs";
import agentIssues from "../scripts/agent-issues.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import executorCore from "../scripts/executor-core.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settleAll = async () => { for (let i = 0; i < 30; i += 1) await tick(); };

function host({ refPatch = {}, runRoute, providerUpAt = null }) {
  const ref = { id: "task", title: "Fixture work", prompt: "Full fixture obligation", at: 5, status: "active", runId: "run_100_1", ...refPatch };
  let board = { tasks: [structuredClone(ref)], requests: [] };
  const entry = { id: "run_100_1", taskId: "task", title: ref.title, startedAt: 100, finished: false, spoke: false, spokeOut: false, sawDone: false, outputTail: [], outputLog: [], handoffs: [], declinedHandoffs: [], issues: [], calls: new Set(), resultNote: null, workKind: "coding", startKilled: false };
  const autopilot = { execute: true, jobs: [entry], parallel: 1, infraFailures: 0, startKills: 0, startSamples: [] };
  const observations = [], timers = [], children = [];
  const clock = { offset: 0 };
  const RealDate = Date;
  class FakeDate extends RealDate { static now() { return RealDate.now() + clock.offset; } }
  const spawn = (command, args) => {
    const child = Object.assign(new EventEmitter(), { command, args, pid: 4000 + children.length, kill() {} });
    children.push(child);
    if (command === "taskkill") { setImmediate(() => child.emit("close", 0)); return child; }
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    if (command !== "grok") child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} });
    return child;
  };
  const env = vm.createContext({
    Date: FakeDate, console, process, entry, autopilot, executorResume, executorCore, runRoute, spawn, prompt: "the brief", runRoot: "C:/fixture", startedAt: 100,
    job: { kind: "task", title: ref.title, prompt: ref.prompt, source: "chat", ref: structuredClone(ref) }, assistantModule: assistant, taskHandoffs, queueExecutorCheckpoint() {},
    agentModes, agentIssues, verificationJobs: [], runVerificationJobs: async () => {},
    eyes: { findRunSession: () => null, readJson: async () => ({}), writeJson: async () => {} },
    releaseFiles: () => {}, discardEntry: () => { autopilot.jobs = []; },
    executorLog: async () => {}, policyRecord: () => {}, workTitleKey: (text) => String(text),
    EXECUTOR_MAX_DEPTH: 3, EXECUTOR_MAX_HANDOFFS: 3, EXECUTOR_START_FAILURE_GRACE: 5, EXECUTOR_DONE_MARK: "MEFI_DONE", AUTOPILOT_PARK_MS: 600000, ASSISTANT_PRIORITY: { demand: 1 },
    EXECUTOR_KILL_MS: 25 * 60000, EXECUTOR_START_BUDGET_MS: 90000,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", ASSISTANT_HISTORY_PATH: "history", CHECKPOINTS_PATH: "checkpoints",
    mutateBoard: async (mutate) => { const next = structuredClone(board); const result = mutate(next); board = next; return result ?? {}; },
    withBoardLock: async (fn) => fn(), logLine: () => {}, assistantClip: (text, limit) => String(text).slice(0, limit),
    assistantHearBuilder: () => ({}), assistantNodeContext: () => {}, taskTarget: (id) => id, sessionTarget: (id) => id,
    emitAutopilot() {}, send() {}, pushAutopilotHistory: () => {},
    runExecutorHandoffs: async () => {}, assistantAppendReply: () => {}, saveAssistant: async () => {},
    assistantEnqueueRole: () => {}, assistantAskForWork: () => {}, refreshAutopilotQueue: async () => {},
    setAutopilotWaiting: () => {}, executorUpdateHold: () => null,
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; },
    SMOKE: false, CAPTURE: false, CLI_MODE: false, assistantState: { status: "running" },
    recordModelCall: async (row) => { observations.push(row); },
    spawnNextJob: async () => assert.fail("a settled run must not launch another worker here"),
    parseExecutorHandoff: () => null, executorActivity: { recordOutput: () => false },
    cliModelArg: (value) => value, agyModelArg: (value) => value,
    sweepSnapshotLocks: async () => {}, watchRunSession: () => {},
  });
  // finish() checks `instanceof Map`, so the map comes from the sandbox's realm.
  autopilot.providerUpAt = vm.runInContext("new Map()", env);
  for (const [key, value] of Object.entries(providerUpAt ?? {})) autopilot.providerUpAt.set(key, value);
  vm.runInContext(section("async function attributeRunSession(", "function watchRunSession(") +
    section("function recordWorkerAttempt(", "// The verifier's verdict on an attempt") +
    `function fixtureRun() {\n${section("  let timeout = null;", "  let fellBack = false;")}\nreturn { finish, attach, spawnAttempt, cliRoute, label: () => runLabel }; }`, env);
  const run = env.fixtureRun();
  run.attach(run.spawnAttempt(runRoute, run.cliRoute), run.label(), runRoute, Boolean(run.cliRoute));
  // The start watchdog: the one pending timer that is not the hard budget or a poll.
  const watchdog = () => timers.filter((timer) => !timer.cleared && ![25 * 60000, 500, 15000].includes(timer.ms)).at(-1);
  return { entry, autopilot, children, clock, watchdog, observations, board: () => board };
}

const zaiRoute = () => ({ cli: "opencode", modelProvider: "zai", model: "glm-5.3-flash", modelArgs: " --model mefi-zai/glm-5.3-flash", via: "mefi-zai/glm-5.3-flash" });
const grokRoute = () => ({ cli: "grok", env: {}, modelArgs: "", grok: true, model: "grok-5", via: "grok cli", opencode: zaiRoute() });
const say = async (child, lines, stream = "stdout") => { for (const line of lines) child[stream].write(`${line}\n`); await settleAll(); };
const ledger = (h) => h.observations.map((row) => [row.provider, row.model, row.status, row.outcome ?? null]);
const card = (h) => { const task = h.board().tasks[0]; return { runFailures: task.runFailures ?? 0, startFailures: task.startFailures ?? 0, providerFailures: task.providerFailures ?? 0 }; };
const rateLimited = "Error: 429 Too Many Requests - rate limit exceeded";

test("a CLI killed at start hands a fresh watchdog to its OpenCode fallback, whose own failure is charged and recorded as a loss", async () => {
  const h = host({ runRoute: grokRoute() });
  h.clock.offset = 10 * 60000; // past any start budget
  h.watchdog().fn();
  await settleAll(); // taskkill closes, ended() falls back and attaches OpenCode
  assert.equal(h.entry.ranRoute?.via, "mefi-zai/glm-5.3-flash");
  assert.equal(h.entry.startKilled, false, "the kill was the CLI's, not the fallback's");
  assert.equal(h.entry.cliStartKilled, true);
  const fallback = h.children.at(-1);
  await say(fallback, ["Editing src/app.js", "TypeError: cannot read x of undefined"]);
  fallback.emit("close", 1);
  await settleAll();
  assert.deepEqual(ledger(h), [["zai", "glm-5.3-flash", "error", "failed"]]);
  assert.deepEqual(card(h), { runFailures: 1, startFailures: 0, providerFailures: 0 }, "the attempt ran and failed: no 'never started' waiver");
});

test("an outage the provider reported is never the model's loss, even once the card's outage grace has run out", async () => {
  // A sibling run on the same route answered after this card's last outage,
  // so the card is charged this time; the model is not.
  const h = host({ runRoute: zaiRoute(), refPatch: { providerFailures: 1, lastAttempt: { at: 10 } }, providerUpAt: { "mefi-zai/glm-5.3-flash": 50 } });
  await say(h.children[0], ["Reading the brief", rateLimited]);
  h.children[0].emit("close", 1);
  await settleAll();
  assert.equal(card(h).runFailures, 1, "the card's grace ran out, so the card pays");
  assert.deepEqual(ledger(h), [["zai", "glm-5.3-flash", "error", null]]);
});

test("a fallback's outage is judged by the fallback route's health, and its success stamps that route, not the CLI's", async () => {
  // grok answered since the card's last outage; z.ai, which ran, did not.
  const h = host({ runRoute: grokRoute(), refPatch: { providerFailures: 1, lastAttempt: { at: 10 } }, providerUpAt: { "grok cli": 50 } });
  await say(h.children[0], ["DeprecationWarning: something"], "stderr");
  h.children[0].emit("close", 1); // a silent CLI exit: the route, not the job
  await settleAll();
  assert.equal(h.entry.ranRoute?.via, "mefi-zai/glm-5.3-flash");
  const fallback = h.children.at(-1);
  await say(fallback, [rateLimited]);
  fallback.emit("close", 1);
  await settleAll();
  assert.deepEqual(card(h), { runFailures: 0, startFailures: 0, providerFailures: 2 }, "requeued uncharged as a z.ai outage");
  assert.deepEqual(ledger(h), [["zai", "glm-5.3-flash", "error", null]]);

  const ok = host({ runRoute: grokRoute() });
  ok.children[0].emit("close", 1);
  await settleAll();
  const worked = ok.children.at(-1);
  await say(worked, ["did the work", "MEFI_DONE"]);
  worked.emit("close", 0);
  await settleAll();
  assert.deepEqual([...ok.autopilot.providerUpAt.keys()], ["mefi-zai/glm-5.3-flash"]);
  assert.deepEqual(ledger(ok), [["zai", "glm-5.3-flash", "ok", null]]);
});

test("a runner killed at start with no fallback is no loss; one that worked and failed is", async () => {
  const wedged = host({ runRoute: zaiRoute() });
  wedged.clock.offset = 10 * 60000;
  wedged.watchdog().fn();
  await settleAll();
  assert.deepEqual(ledger(wedged), [["zai", "glm-5.3-flash", "error", null]]);
  assert.deepEqual(card(wedged), { runFailures: 0, startFailures: 1, providerFailures: 0 });

  const failed = host({ runRoute: zaiRoute() });
  await say(failed.children[0], ["Editing src/app.js", "FAIL tests/app.test.mjs"]);
  failed.children[0].emit("close", 1);
  await settleAll();
  assert.deepEqual(ledger(failed), [["zai", "glm-5.3-flash", "error", "failed"]]);
  assert.equal(card(failed).runFailures, 1);
});

test("a run the owner stopped is a cancellation in the ledger, not the model's error", async () => {
  const h = host({ runRoute: zaiRoute() });
  await say(h.children[0], ["Editing src/app.js"]);
  h.entry.stopUser = true;
  h.entry.stop("stopped by you");
  await settleAll();
  assert.deepEqual(ledger(h), [["zai", "glm-5.3-flash", "cancelled", null]]);
  assert.equal(h.observations[0].errorKind, null);
  assert.equal(card(h).runFailures, 0);
});
