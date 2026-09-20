// Real host lifecycle boundaries, memory-only state and a disposable SQLite
// session store. No live profile, child process, timers or model requests.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import * as eyes from "../scripts/eyes.mjs";
import * as assistant from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import executorResume from "../scripts/executor-resume.cjs";
import { createRequire } from "node:module";
const { createProjects } = createRequire(import.meta.url)("../scripts/projects.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

test("session evidence belongs to the exact user dispatch, never the nearest concurrent session", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-run-identity-"));
  const file = path.join(folder, "sessions.db");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER); CREATE TABLE message (id TEXT, session_id TEXT, data TEXT); CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT)");
    const add = (id, text, { role = "user", parent = null, directory = folder } = {}) => {
      db.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run(id, parent, directory, 100);
      db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(`m_${id}`, id, JSON.stringify({ role }));
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run(`p_${id}`, `m_${id}`, id, JSON.stringify({ type: "text", text }));
    };
    add("unrelated", "A manually started session at exactly the same time");
    add("other-run", "This dispatch is run run_100_20 for task other.");
    add("assistant-echo", "This dispatch is run run_100_2 for task ours.", { role: "assistant" });
    add("subagent-echo", "This dispatch is run run_100_2 for task ours.", { parent: "ours" });
    add("ours", "Requirements. This dispatch is run run_100_2 for task ours.");
    const found = eyes.findRunSession({ dbPath: file, runId: "run_100_2", since: 90 });
    assert.equal(found.id, "ours");
    assert.equal(eyes.findRunSession({ dbPath: file, runId: "run_100_9", since: 90 }), null);
    assert.equal(eyes.findRunSession({ dbPath: file, runId: "run_100_2", since: 101 }), null);
    const projects = createProjects({ defaultRoot: folder, studioRoot: folder, isDirectory: () => true });
    const scoped = projects.eyes(eyes);
    assert.equal(scoped.findRunSession({ dbPath: file, runId: "run_100_2" }).id, "ours");
    add("foreign-project", "This dispatch is run run_100_3.", { directory: path.join(os.tmpdir(), "another-project") });
    assert.equal(scoped.findRunSession({ dbPath: file, runId: "run_100_3" }), null);
    add("copied-dispatch", "This dispatch is run run_100_2 for task ours.");
    assert.equal(eyes.findRunSession({ dbPath: file, runId: "run_100_2" }), null, "ambiguous copied identities cannot supply verification evidence");
  } finally {
    eyes.openDb(file).close();
    db.close();
    await unlink(file);
    await rmdir(folder);
  }
});

test("worker attribution waits for its identity and refuses sibling or finished jobs", () => {
  const first = { id: "run_100_1", startedAt: 100, sessionId: null };
  const second = { id: "run_100_2", startedAt: 100, sessionId: "sibling" };
  const env = vm.createContext({ autopilot: { jobs: [first, second] }, queueExecutorCheckpoint() {} });
  vm.runInContext(section("function attributeRunSession(", "function watchRunSession("), env);
  const reader = { listSessions: () => assert.fail("timestamp matching must not be used"), findRunSession: () => null };
  assert.equal(env.attributeRunSession(reader, first), false);
  assert.equal(first.sessionId, null);
  reader.findRunSession = () => ({ id: "sibling" });
  assert.equal(env.attributeRunSession(reader, first), false);
  reader.findRunSession = ({ runId }) => ({ id: `${runId}-session` });
  assert.equal(env.attributeRunSession(reader, first), true);
  assert.equal(first.sessionId, "run_100_1-session");
  first.sessionId = null;
  first.finished = true;
  assert.equal(env.attributeRunSession(reader, first), false);
});

function settingsHost() {
  let saved = { ui: { autopilot: { enabled: false, execute: false, parallel: 1, minutes: 7 } } };
  const events = [];
  const autopilot = { enabled: true, execute: false, parallel: 2, jobs: [], minutes: 5, parkedUntil: 0 };
  const env = vm.createContext({
    Date, os: { cpus: () => Array(8).fill({}) }, autopilot, EXECUTOR_PARALLEL_MAX: 12, EXECUTOR_PARALLEL_CAP: 3,
    readSettings: async () => structuredClone(saved), writeSettings: async (next) => { saved = structuredClone(next); events.push("saved"); },
    proactiveTimer: null, emitAutopilot() {}, autopilotStatus: () => autopilot, assistantAskForWork: () => events.push("asked"),
    setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }), clearInterval() {},
    getPolicyModule: async () => null, warmPolicyBaseline() {}, sweepSnapshotLocks: async () => {}, logLine() {},
    SMOKE: false, CAPTURE: false, CLI_MODE: false, assistantLoop: false, assistantState: { status: "running" },
    ensureAssistant: async () => { events.push(`assistant-loaded:${autopilot.execute}`); },
    applyKeepAwake() {}, applyTray() {}, assistantResumeWork: async () => {}, assistantLog() {},
    assistantSchedule: () => events.push("scheduled"), saveAssistant: async () => {}, executorUpdateHold: () => null,
    setAutopilotWaiting() {}, pushAutopilotHistory() {}, spawnNextJob: async () => assert.fail("paused work cannot launch"),
  });
  vm.runInContext(section("async function setAutopilot(", "// Settings may override the defaults") +
    section("let autopilotBootPromise =", "async function readSettings()") +
    section("async function startAssistant()", "// Quit path:") +
    section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"), env);
  return { env, autopilot, events, saved: () => saved };
}

test("assistant startup waits for persisted executor preferences before scheduling its first tick", async () => {
  const { env, autopilot, events } = settingsHost();
  let release;
  const read = env.readSettings;
  env.readSettings = () => new Promise((resolve) => { release = async () => resolve(await read()); });
  const started = env.startAssistant();
  await Promise.resolve();
  assert.deepEqual(events, [], "no foreman or assistant tick while preferences are unresolved");
  env.readSettings = read;
  await release();
  await started;
  assert.equal(autopilot.execute, false);
  assert.equal(autopilot.parallel, 1);
  assert.deepEqual(events, ["saved", "assistant-loaded:false", "scheduled"]);
  await env.setAutopilot({ parallel: 3 });
  await env.bootAutopilot();
  assert.equal(autopilot.parallel, 3, "the delayed boot timer cannot replay stale preferences over an operator change");
});

test("an explicit executor pause clears an expired infrastructure timer and cannot auto-resume", async () => {
  const { env, autopilot, saved } = settingsHost();
  autopilot.execute = false;
  autopilot.parkedUntil = Date.now() - 1;
  await env.setAutopilot({ execute: false });
  await env.executeNextRequest();
  assert.equal(autopilot.execute, false);
  assert.equal(autopilot.parkedUntil, 0);
  assert.equal(saved().ui.autopilot.execute, false);
});

function finishHost({ kind = "task", owner = "run_100_1", missing = false, failWrites = 0, commitBeforeError = false, duplicate = false } = {}) {
  const ref = { id: "task", title: "Fixture work", prompt: "Full fixture obligation", at: 5, status: kind === "task" ? "active" : "running", runId: owner, runFailures: 4, verifyAttempts: 2 };
  let board = { tasks: kind === "task" && !missing ? [structuredClone(ref)] : [], requests: kind === "request" && !missing ? [structuredClone(ref)] : [] };
  if (duplicate) board.requests.push({ ...ref, runId: undefined, status: undefined });
  const entry = { id: "run_100_1", taskId: kind === "task" ? "task" : null, title: ref.title, startedAt: 1, finished: false, spoke: true, sawDone: false, outputTail: ["new failure context"], handoffs: [{ title: "Follow up", prompt: "More work" }], resultNote: { raw: "done: changed; remaining: a follow-up", parts: { done: "changed", remaining: "a follow-up" } } };
  const autopilot = { execute: true, jobs: [entry], parallel: 1, consecutiveFailures: 0, infraFailures: 0 };
  const effects = [], timers = [], logs = [], records = [], roles = [];
  let mutations = 0;
  const env = vm.createContext({
    Date, console, entry, autopilot, job: { kind, title: ref.title, prompt: ref.prompt, source: "chat", ref: structuredClone(ref) }, assistantModule: assistant, taskHandoffs, queueExecutorCheckpoint() {},
    eyes: { findRunSession: () => ({ id: "own-session" }), readJson: async (key) => key === "history" ? [] : {}, writeJson: async (key, value) => records.push([key, structuredClone(value)]) },
    releaseFiles: () => effects.push("release"), discardEntry: () => { autopilot.jobs = autopilot.jobs.filter((item) => item !== entry); effects.push("release"); },
    executorLog: async () => effects.push("exit-fact"), policyRecord: () => effects.push("policy-fact"), workTitleKey: (text) => String(text),
    EXECUTOR_MAX_DEPTH: 3, EXECUTOR_MAX_HANDOFFS: 3, EXECUTOR_DONE_MARK: "DONE", AUTOPILOT_PARK_MS: 600000, ASSISTANT_PRIORITY: { demand: 1 },
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", ASSISTANT_HISTORY_PATH: "history", CHECKPOINTS_PATH: "checkpoints",
    mutateBoard: async (mutate) => {
      mutations += 1;
      const next = structuredClone(board);
      const result = mutate(next);
      if (failWrites-- > 0) {
        if (commitBeforeError) board = next;
        throw new Error("fixture store temporarily busy");
      }
      board = next;
      return result ?? {};
    },
    withBoardLock: async (fn) => fn(), logLine: (text) => logs.push(text), assistantClip: (text, limit) => String(text).slice(0, limit),
    assistantHearBuilder: () => { effects.push("heard"); return { wakeOverseer: true }; },
    assistantNodeContext: () => effects.push("node"), taskTarget: (id) => id, sessionTarget: (id) => id,
    emitAutopilot() {}, send() {}, pushAutopilotHistory: (kind) => effects.push(`history:${kind}`),
    runExecutorHandoffs: async () => effects.push("handoff"), assistantAppendReply: () => effects.push("reply"), saveAssistant: async () => {},
    assistantEnqueueRole: (role, priority, options) => { roles.push({ role, priority, options }); effects.push(`role:${role}`); }, assistantAskForWork: () => effects.push("ask"), refreshAutopilotQueue: async () => {},
    setAutopilotWaiting: (reason) => { autopilot.waiting = reason; }, clearTimeout() {},
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} }; },
    SMOKE: false, CAPTURE: false, CLI_MODE: false, assistantState: { status: "running" }, executorUpdateHold: () => null,
    spawnNextJob: async () => assert.fail("storage recovery must not launch another paid worker"),
  });
  vm.runInContext(section("function attributeRunSession(", "function watchRunSession(") +
    `function fixtureFinish() {\n${section("  let timeout = null;", "  entry.reap = finish;")}\nreturn finish; }` +
    section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"), env);
  return { env, entry, autopilot, finish: env.fixtureFinish(), effects, timers, logs, records, roles, board: () => board, mutations: () => mutations };
}

test("worker completion marks cleanup and failure-review role calls as automatic after Pause", async () => {
  const h = finishHost();
  h.env.assistantState.status = "paused";
  await h.finish(1);
  assert.deepEqual(h.roles.map((entry) => entry.role), ["compactor", "overseer"]);
  assert.ok(h.roles.every((entry) => entry.options?.automatic === true), "automatic completion roles must enter the durable held queue");
  assert.equal(h.board().tasks[0].status, "open", "Pause does not prevent saving the completed attempt");
});

test("a stale task finish cannot report success, spawn follow-ups or modify a new owner's evidence", async () => {
  const host = finishHost({ owner: "new-owner" });
  const before = structuredClone(host.board());
  await host.finish(0);
  assert.deepEqual(host.board(), before);
  assert.ok(!host.effects.some((effect) => ["heard", "handoff", "reply", "node", "history:review"].includes(effect)));
  assert.equal(host.records.length, 0);
  assert.equal(host.autopilot.jobs.length, 0);
  assert.ok(host.logs.some((line) => line.includes("stale result ignored")));
});

test("stale request failures never resurrect removed work or reset its retry budget", async () => {
  for (const options of [{ missing: true }, { owner: "next-run" }, { owner: null }]) {
    const host = finishHost({ kind: "request", ...options });
    const before = structuredClone(host.board());
    await host.finish(1);
    assert.deepEqual(host.board(), before);
    assert.ok(!host.effects.includes("heard"));
    assert.ok(!host.effects.includes("reply"));
  }
});

test("owned request success keeps unclaimed obligations and records only a pending verification verdict", async () => {
  const host = finishHost({ kind: "request", duplicate: true });
  await host.finish(0);
  assert.equal(host.board().requests.length, 2);
  assert.equal(host.board().requests[0].status, "verifying");
  assert.deepEqual(Array.from(host.board().requests[0].remaining ?? []), ["Follow up"], "request handoffs remain obligations until verified");
  assert.equal(host.board().requests[1].status, undefined);
  assert.equal(host.entry.sessionId, "own-session", "fast workers are attributed before the first poll");
  assert.ok(host.effects.includes("history:review"));
  assert.ok(!host.effects.includes("history:done"));
  const checkpoints = host.records.find(([key]) => key === "checkpoints")[1];
  assert.match(checkpoints["own-session"][0].note, /awaiting verification/);
  await host.finish(0);
  assert.equal(host.effects.filter((effect) => effect === "handoff").length, 1);
});

test("failed attempts retain their latest evidence and stop at the existing fifth-failure budget", async () => {
  for (const kind of ["task", "request"]) {
    const host = finishHost({ kind });
    await host.finish(1, "fixture error");
    const row = host.board()[kind === "task" ? "tasks" : "requests"][0];
    assert.equal(row.runFailures, 5);
    assert.equal(row.nextRunAt, undefined);
    assert.equal(row.lastAttempt.runId, host.entry.id);
    assert.equal(row.lastAttempt.error, "fixture error");
    assert.equal(row.lastAttempt.tail, "new failure context");
    assert.equal(row.verifyAttempts, 2);
    assert.ok(!host.effects.includes("handoff"));
  }
});

test("a failed outcome write holds its slot and retries storage without rerunning or reporting the worker", async () => {
  const host = finishHost({ failWrites: 1 });
  await host.finish(0);
  assert.equal(host.entry.finished, true);
  assert.equal(host.entry.settlementPending, true);
  assert.equal(host.autopilot.jobs.length, 1);
  assert.equal(host.board().tasks[0].status, "active");
  assert.ok(!host.effects.includes("handoff"));
  assert.ok(!host.effects.includes("heard"));
  assert.equal(host.timers[0].delay, 5000);
  await host.env.executeNextRequest();
  assert.match(host.autopilot.waiting, /saving a finished worker/);
  await host.timers.shift().fn();
  assert.equal(host.board().tasks[0].status, "awaiting_verification");
  assert.equal(host.entry.settlementPending, undefined);
  assert.equal(host.autopilot.jobs.length, 0);
  assert.equal(host.effects.filter((effect) => effect === "handoff").length, 1);
  assert.equal(host.effects.filter((effect) => effect === "exit-fact").length, 1);
});

test("retrying a partially committed failure does not spend a second retry or duplicate outcome effects", async () => {
  for (const kind of ["task", "request"]) {
    const host = finishHost({ kind, failWrites: 1, commitBeforeError: true });
    await host.finish(1);
    await host.timers.shift().fn();
    const row = host.board()[kind === "task" ? "tasks" : "requests"][0];
    assert.equal(row.runFailures, 5);
    assert.equal(host.mutations(), 2);
    assert.equal(host.effects.filter((effect) => effect === "heard").length, 1);
  }
});

function dispatchHost({ interrupt = null, refuse = false, throwClaim = false, editBeforeClaim = null } = {}) {
  const root = path.join(os.tmpdir(), "mefi-external-project");
  const board = { requests: [], tasks: [{ id: "task", title: "Edit a module", status: "open", files: ["src/a.js"] }] };
  const registered = new Map(), askedPaths = [], releases = [];
  let leases = 0, mutations = 0, hold = null;
  const autopilot = { execute: true, jobs: [], parallel: 1 };
  const env = vm.createContext({
    Date, path, process: { pid: 999 }, backlog, executorResume, autopilot, autopilotJobSeq: 0, assistantCache: { store: {} },
    assistantModule: { ...assistant,
      claimWrite: (files, owner) => {
        askedPaths.push(...files);
        if (throwClaim) throw new Error("fixture registry unavailable");
        if (refuse) return { action: "refuse" };
        for (const file of files) registered.set(file, owner);
        return { action: "proceed" };
      },
      releaseWrite: (files, owner) => { releases.push(owner); for (const file of files) if (registered.get(file) === owner) registered.delete(file); },
    },
    projectSwitching: false, assistantState: { status: "running" }, executorUpdateHold: () => hold,
    projects: { current: () => ({ id: "external", path: root }) }, projectRoot: () => root,
    measureWorkerLag: async () => 0, getMachine: async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => {
      leases += 1;
      if (leases === 2 && interrupt === "after-claim") hold = "waiting for workers before restart";
      if (leases === 2 && interrupt === "pause") autopilot.execute = false;
      return { exclusive: leases === 2 && interrupt === "lease" };
    } }),
    executorRunEnv: async () => ({ via: "fixture" }), getEyes: async () => ({ readJson: async (key) => structuredClone(board[key]) }),
    getPolicyModule: async () => null, warmPolicyBaseline() {}, resolveActivePolicyIdentity: async () => null,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", workTitleKey: (text) => text, conflictsWithLiveFix: () => false,
    queuedWorkCount: () => 1, compareWork: () => 0, logLine() {},
    withBoardLock: async (fn) => fn(),
    mutateBoard: async (fn) => {
      mutations += 1;
      if (mutations === 1 && editBeforeClaim) Object.assign(board.tasks[0], editBeforeClaim);
      if (mutations === 1 && interrupt === "claim") hold = "waiting for workers before restart";
      if (mutations === 1 && interrupt === "write") throw new Error("fixture claim persistence failed");
      return fn(board);
    },
    fakeSpawn: (entry) => { env.started = entry; return "spawned"; },
  });
  const pick = section("async function spawnNextJob()", "  // Policy Lab PR1 — the attempt's identity:") + "return fakeSpawn(entry);\n}";
  vm.runInContext(section("async function releaseExecutorClaim(", "async function spawnNextJob()") + pick, env);
  return { env, board, root, autopilot, registered, releases, askedPaths, mutations: () => mutations, setHold: (value) => { hold = value; } };
}

test("file registry refusal or failure stops before claiming a board task", async () => {
  for (const options of [{ refuse: true }, { throwClaim: true }]) {
    const host = dispatchHost(options);
    assert.equal(await host.env.spawnNextJob(), "deferred");
    assert.equal(host.mutations(), 0);
    assert.equal(host.autopilot.jobs.length, 0);
    assert.equal(host.board.tasks[0].status, "open");
  }
});

test("claims use the selected project root and every cancelled launch releases its registry reservation", async () => {
  for (const interrupt of ["claim", "after-claim", "pause", "lease", "write"]) {
    const host = dispatchHost({ interrupt });
    if (interrupt === "write") await assert.rejects(host.env.spawnNextJob(), /claim persistence failed/);
    else assert.ok(["lost", "empty", "busy"].includes(await host.env.spawnNextJob()));
    assert.deepEqual(host.askedPaths, [path.resolve(host.root, "src/a.js")]);
    assert.equal(host.registered.size, 0, `${interrupt} must release its file lock`);
    assert.equal(host.autopilot.jobs.length, 0);
    assert.equal(host.board.tasks[0].status, "open");
    assert.equal(host.board.tasks[0].runId, undefined);
  }
});

test("a pending restart prevents predispatch work before routes, claims or children are started", async () => {
  const host = dispatchHost();
  host.setHold("waiting for workers before restart");
  host.env.executorRunEnv = async () => assert.fail("a restart hold must stop before route resolution");
  assert.equal(await host.env.spawnNextJob(), "empty");
  assert.equal(host.mutations(), 0);
  assert.equal(host.askedPaths.length, 0);
});

test("editing an open task during dispatch forces a fresh selection and file claim", async () => {
  const host = dispatchHost({ editBeforeClaim: { title: "Changed work", files: ["src/b.js"] } });
  assert.equal(await host.env.spawnNextJob(), "lost", "the old file reservation cannot authorize a new scope");
  assert.equal(host.board.tasks[0].status, "open");
  assert.equal(host.board.tasks[0].runId, undefined);
  assert.equal(host.registered.size, 0);
  assert.equal(host.autopilot.jobs.length, 0);
  assert.equal(await host.env.spawnNextJob(), "spawned", "the next pick uses the edited task");
  assert.equal(host.env.started.title, "Changed work");
  assert.deepEqual(host.askedPaths, [path.resolve(host.root, "src/a.js"), path.resolve(host.root, "src/b.js")]);
});

function childHost({ throwFallback = false, throwKill = false } = {}) {
  const makeChild = (pid) => {
    const child = new EventEmitter();
    Object.assign(child, { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { write() {}, end() {} }) });
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    return child;
  };
  const first = makeChild(11), fallback = makeChild(22), finishes = [], timers = [], spawns = [], watches = [], killers = [];
  let now = 100000;
  class Clock extends Date { static now() { return now; } }
  const entry = { id: "run_100_1", finished: false, spoke: false, handoffs: [], calls: new Set(), outputTail: [], outputLog: [], child: null };
  const env = vm.createContext({
    Date: Clock, entry, runRoute: { grok: true, cli: "grok", opencode: { env: {}, modelArgs: "" } }, runRoot: "C:/fixture", prompt: "fixture brief", startedAt: 1,
    process: { env: {} }, assistantModule: assistant, autopilot: { parallel: 1, jobs: [entry] }, eyes: {}, queueExecutorCheckpoint() {},
    job: { kind: "task", ref: { id: "task" }, title: "Fixture work" },
    EXECUTOR_DONE_MARK: "DONE", EXECUTOR_MAX_HANDOFFS: 3, EXECUTOR_KILL_MS: 600000, EXECUTOR_START_BUDGET_MS: 120000,
    parseExecutorHandoff: () => null, logLine() {}, pushAutopilotHistory() {}, executorLog: async () => {}, emitAutopilot() {},
    assistantClip: (text) => text, watchRunSession: () => watches.push("fallback"), sweepSnapshotLocks: async () => {},
    setTimeout: (fn, delay) => { Object.assign(fn, { delay, unref() {} }); timers.push(fn); return fn; }, clearTimeout: (timer) => { timer.cancelled = true; },
    spawn: (command) => {
      spawns.push(command);
      if (command === "taskkill") {
        if (throwKill) throw new Error("fixture taskkill unavailable");
        const killer = Object.assign(new EventEmitter(), { kill() { this.killed = true; } });
        killers.push(killer);
        return killer;
      }
      if (throwFallback) throw new Error("fixture replacement spawn failed");
      return fallback;
    },
    finish: async (code, error = null) => { entry.finished = true; finishes.push({ code, error }); },
  });
  const body = section('  let runLabel = runRoute.cli === "grok"', '  try {\n    child = spawnAttempt(runRoute');
  vm.runInContext(`function fixtureChildController() { let timeout = null, startWatchdog = null; ${body}\nreturn { attach, fallbackToOpencode }; }`, env);
  const controller = env.fixtureChildController();
  controller.attach(first, "grok", env.runRoute, true);
  return { first, fallback, entry, finishes, timers, spawns, watches, killers, advance: (ms) => { now += ms; } };
}

test("late output, close, errors and timers from Grok cannot settle or kill its OpenCode replacement", () => {
  const host = childHost();
  const oldTimers = host.timers.slice();
  host.first.emit("error", new Error("fixture Grok unavailable"));
  assert.equal(host.entry.child, host.fallback);
  assert.equal(host.watches.length, 1, "session attribution starts again even if the original poll window elapsed");
  host.first.stdout.emit("data", "DONE\nMEFI_RESULT: done: old result; remaining: none\n");
  host.first.emit("close", 0);
  host.first.emit("error", new Error("late original error"));
  for (const timer of oldTimers) timer();
  assert.equal(host.entry.finished, false);
  assert.equal(host.entry.spoke, false);
  assert.equal(host.entry.resultNote, undefined);
  assert.equal(host.finishes.length, 0);
  assert.deepEqual(host.spawns, ["cmd.exe"], "old timers cannot kill the replacement process");
  host.fallback.stdout.emit("data", "Working on the real replacement\n");
  assert.equal(host.entry.spoke, true);
  host.fallback.emit("close", 0);
  assert.deepEqual(host.finishes, [{ code: 0, error: null }]);
});

test("a synchronous replacement spawn failure settles once instead of escaping the process event callback", () => {
  const host = childHost({ throwFallback: true });
  assert.doesNotThrow(() => host.first.emit("error", new Error("fixture Grok unavailable")));
  host.first.emit("close", 1);
  assert.equal(host.finishes.length, 1);
  assert.equal(host.finishes[0].code, 1);
  assert.match(host.finishes[0].error, /fallback could not start/);
});

test("a broken worker prompt pipe waits for child exit and settles without an unhandled stream error", () => {
  const host = childHost();
  host.first.emit("error", new Error("fixture Grok unavailable"));
  const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
  assert.doesNotThrow(() => host.fallback.stdin.emit("error", error));
  assert.equal(host.finishes.length, 0, "a broken input pipe cannot release claims while the process is still alive");
  assert.doesNotThrow(() => host.first.stdin.emit("error", new Error("late previous pipe error")));
  host.fallback.emit("close", 0);
  assert.deepEqual(host.finishes, [{ code: 0, error: "write EPIPE" }]);
  host.fallback.emit("close", 1);
  assert.equal(host.finishes.length, 1);
});

test("a wedged startup retains its writer and file claim until tree termination succeeds before fallback", () => {
  const h = childHost();
  h.advance(120001);
  h.timers.find((timer) => timer.delay === 120000)();
  assert.equal(h.entry.child, h.first, "a kill request is not evidence the original writer exited");
  assert.equal(h.entry.finished, false);
  assert.equal(h.entry.stopping.reason.includes("wedged start"), true);
  assert.deepEqual(h.spawns, ["taskkill"], "the fallback cannot overlap the original process");
  h.killers[0].emit("close", 1);
  assert.equal(h.entry.child, h.first);
  assert.equal(h.finishes.length, 0);
  assert.match(h.entry.stopping.error, /taskkill exited 1/);
  assert.ok(h.entry.stopping.retryAt > 0);
  h.timers.at(-1)(); // automatic termination retry
  h.killers[1].emit("close", 0); // confirmed removal even if the worker's close event was lost
  assert.equal(h.entry.child, h.fallback);
  assert.equal(h.entry.stopping, undefined);
  assert.equal(h.finishes.length, 0);
  assert.deepEqual(h.spawns, ["taskkill", "taskkill", "cmd.exe"]);
  h.first.emit("close", 1);
  h.killers[0].emit("error", new Error("late old kill failure"));
  assert.equal(h.entry.child, h.fallback);
  h.fallback.emit("close", 0);
  assert.deepEqual(h.finishes, [{ code: 0, error: null }]);
});

test("a failed budget termination is visible, coalesces supervisor kicks and automatically retries", () => {
  const h = childHost();
  h.timers.find((timer) => timer.delay === 600000)();
  assert.equal(h.finishes.length, 0);
  assert.doesNotThrow(() => h.killers[0].emit("error", new Error("fixture access denied")));
  h.killers[0].emit("close", 1); // error plus close is one failed attempt
  assert.equal(h.entry.finished, false);
  assert.match(h.entry.stopping.error, /fixture access denied/);
  h.entry.stop("another supervisor tick");
  h.first.emit("error", new Error("child error while stopping"));
  assert.deepEqual(h.spawns, ["taskkill"]);
  const retry = h.timers.at(-1);
  assert.equal(retry.delay, 15000);
  retry();
  assert.equal(h.entry.stopping.retryAt, null);
  h.killers[1].emit("close", 0);
  assert.deepEqual(h.finishes, [{ code: 1, error: "killed after budget" }]);
  h.first.emit("close", 0);
  assert.equal(h.finishes.length, 1);
  assert.ok(!h.spawns.includes("cmd.exe"), "a hard time budget cannot restart the same task through fallback");
});

test("a synchronous termination failure keeps the worker owned until its actual exit", () => {
  const h = childHost({ throwKill: true });
  assert.doesNotThrow(() => h.timers.find((timer) => timer.delay === 600000)());
  assert.equal(h.entry.finished, false);
  assert.match(h.entry.stopping.error, /taskkill unavailable/);
  const retry = h.timers.at(-1);
  h.first.emit("close", 0);
  assert.equal(retry.cancelled, true);
  assert.deepEqual(h.finishes, [{ code: 0, error: "killed after budget" }], "an overdue worker cannot report success while it is being stopped");
  retry(); // even an already delivered timer cannot create another kill or writer
  assert.deepEqual(h.spawns, ["taskkill"]);
});

test("a hung termination helper has its own deadline and cannot hold the recovery path forever", () => {
  const h = childHost();
  h.timers.find((timer) => timer.delay === 600000)();
  h.timers.at(-1)(); // termination helper deadline
  assert.equal(h.killers[0].killed, true);
  assert.match(h.entry.stopping.error, /termination command did not finish/);
  assert.equal(h.entry.finished, false);
  h.timers.at(-1)(); // recovery retry
  assert.equal(h.killers.length, 2);
  h.killers[1].emit("close", 0);
  assert.equal(h.finishes.length, 1);
});

test("assistant supervision requests a safe stop instead of settling a still-live worker", () => {
  const stopped = [], reaped = [], problems = [];
  const live = { startedAt: 1, pid: 11, child: { pid: 11 }, title: "Overdue worker", stop: (reason) => stopped.push(reason), reap: () => assert.fail("a live worker must keep its claim") };
  const ghost = { startedAt: 1, pid: null, child: null, title: "Missing worker", reap: async (code, reason) => reaped.push({ code, reason }) };
  const env = vm.createContext({
    SMOKE: false, CAPTURE: false, CLI_MODE: false, ASSISTANT_JOB_WEDGED_MS: 600000,
    autopilot: { execute: true, jobs: [live, ghost], parallel: 2, queueDepth: 0 },
    assistantClip: (value) => value, assistantSetProblems: (_roles, items) => problems.push(...items),
  });
  vm.runInContext(section("function assistantSuperviseJobs(", "function assistantStaleWork("), env);
  env.assistantSuperviseJobs(700000);
  assert.deepEqual(stopped, ["wedged — kill timed out"]);
  assert.deepEqual(reaped, [{ code: 1, reason: "spawn never started" }]);
  assert.ok(problems.some((problem) => problem.kind === "executor"));
});
