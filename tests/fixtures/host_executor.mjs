// Executes the host's real queue, claim, child-stream parsing, settlement,
// verification and foreman functions. Only external boundaries are replaced:
// memory stores, controllable time, process/event doubles and role delivery.
// No Electron profile, filesystem writes, credentials or network are used.
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import * as assistant from "../../scripts/assistant.mjs";
import * as history from "../../scripts/task-history.mjs";
import * as eyesModule from "../../scripts/eyes.mjs";
import backlog from "../../scripts/backlog.cjs";
import taskContext from "../../scripts/task-context.cjs";
import taskHandoffs from "../../scripts/task-handoffs.cjs";
import agentModes from "../../scripts/agent-modes.cjs";
import agentIssues from "../../scripts/agent-issues.cjs";
import taskDelegation from "../../scripts/task-delegation.cjs";
import executorResume from "../../scripts/executor-resume.cjs";

const source = (await readFile(new URL("../../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host boundary: ${start}`);
  return source.slice(from, to);
};
const copy = (value) => structuredClone(value);

export function executorHost({ tasks = [], requests = [], parallel = 1, adaptiveParallel = false, workerCapacity = null, paused = false, execute = true, autoBuild = true, mode = "swarm", savedSettings = null, realPool = false, poolParallel = 2, aiParallel = 2, pid = 101, livePids = [999], unknownPids = [], realWatches = false, gitStage = null } = {}) {
  let now = 1_000_000, pendingForeman = false, pendingWriteFailures = 0;
  let board = { tasks: copy(tasks), requests: copy(requests), ideas: [] };
  const logs = [], starts = [], roleRequests = [], records = [], timers = [], terminations = [], capacityCalls = [], supportCalls = [], supportJobs = [], contextCalls = [], routeCalls = [];
  const sessions = new Map(), todos = new Map(), changes = new Map(), checks = new Map(), extras = new Map(), registry = new Map();
  const root = path.resolve("fixture-only-project");
  const state = { ...(realPool ? assistant.emptyState(now) : {}), status: paused ? "paused" : "running", prefs: { backlogMode: true, parallel: poolParallel, aiParallel }, agents: [] };
  const pool = { queue: [], running: new Map(), seq: 0, waiters: [] };
  const autopilot = { enabled: true, execute, autoBuild, mode, modeRevision: 0, clusterFocus: null, clusterAgents: [], parallel, adaptiveParallel, jobs: [], infraFailures: 0, parkedUntil: 0, minutes: 5, history: [] };
  let settings = copy(savedSettings ?? { ui: { autopilot: { enabled: true, execute, autoBuild, mode, parallel, adaptiveParallel, minutes: 5 } } });
  const machine = {
    leaseStatus: async () => ({ exclusive: false }),
    workerCapacity: async (options) => {
      capacityCalls.push(copy(options));
      return workerCapacity ? workerCapacity(options) : { canStart: true, reason: null, resources: { lagMs: options.lagMs, cpuPercent: 15, availableMemoryMB: 8192, totalMemoryMB: 32768 } };
    },
  };
  const eyes = {
    readJson: async (key, fallback) => copy(board[key] ?? extras.get(key) ?? fallback),
    writeJson: async (key, value) => { extras.set(key, copy(value)); },
    findRunSession: ({ runId }) => sessions.get(runId) ?? null,
    listTodos: ({ sessionId }) => copy(todos.get(sessionId) ?? []),
    listChanges: ({ sessionId }) => { if (changes.get(sessionId) instanceof Error) throw changes.get(sessionId); return copy(changes.get(sessionId) ?? []); },
    listSessionChecks: ({ sessionId, since, until }) => {
      assert.ok(Number.isFinite(since) && since > 0 && Number.isFinite(until) && until >= since, "verification must bound observed checks to its attempt");
      if (checks.get(sessionId) instanceof Error) throw checks.get(sessionId);
      return { available: true, truncated: false, checks: copy(checks.get(sessionId) ?? []) };
    },
    // The shared-index sweep guard reads these when the host provides a
    // porcelain fixture; without one both keys stay absent, matching a host
    // that has no git observation at all.
    ...(gitStage != null ? { gitPorcelain: async () => gitStage, parsePorcelain: eyesModule.parsePorcelain } : {}),
  };
  const stream = () => Object.assign(new EventEmitter(), { setEncoding() {} });
  const env = vm.createContext({
    Date: class extends Date { static now() { return now; } }, crypto, path, console,
    process: { pid, env: {}, kill: (target) => {
      if (unknownPids.includes(target)) throw Object.assign(new Error("fixture process access denied"), { code: "EPERM" });
      if (target === pid || livePids.includes(target) || autopilot.jobs.some((job) => !job.finished && job.pid === target)) return true;
      throw Object.assign(new Error("fixture process has exited"), { code: "ESRCH" });
    } }, os: { cpus: () => [{}, {}] },
    autopilot, pool, projectAgentJobs: 0, assistantState: state, assistantCache: { store: {}, ingest: { newMaterial: false, at: now } }, autopilotJobSeq: 0,
    assistantModule: { ...assistant,
      claimWrite: (files, id) => { if (files.some((file) => registry.has(file) && registry.get(file) !== id)) return { action: "refuse" }; for (const file of files) registry.set(file, id); return { action: "proceed" }; },
      releaseWrite: (files, id) => { for (const file of files) if (registry.get(file) === id) registry.delete(file); },
    }, backlog, taskContext, taskHandoffs, agentModes, agentIssues, taskDelegation, executorResume,
    projectSwitching: false, executorUpdateHold: () => null, assistantStopping: false,
    projects: { current: () => ({ id: "fixture", path: root }), active: () => ({ id: "fixture", path: root }), open: () => ({ id: "fixture", path: root }), run: (_project, fn) => fn() },
    projectRoot: () => root, projectDataPath: (key) => path.join(root, key),
    getMachine: async () => machine,
    measureWorkerLag: async () => 0, machineLagGate: null,
    getEyes: async () => eyes, getAssistant: async () => env.assistantModule,
    getAnalyzer: async () => ({ verifyIdea: async (text, options) => { contextCalls.push({ text, ...options }); return { hits: [] }; } }),
    resolveAiRoute: async (role, options) => { routeCalls.push({ role, ...options }); return { ok: true, provider: "fixture-http", model: "fixture-model" }; },
    httpAssistantCall: async (route, system, user, maxTokens, options) => {
      supportCalls.push({ route: copy(route), system, user, maxTokens, ...options });
      return { ok: true, text: `${options.taskType} finding: inspect the captured task and verify its changed module.` };
    },
    enqueue: (role, run, options = {}) => {
      const entry = { role, targets: options.targets ?? [], target: options.targets?.[0] ?? null };
      supportJobs.push({ role, ...options });
      return Promise.resolve().then(() => run(entry));
    },
    getPolicyModule: async () => null, warmPolicyBaseline() {}, resolveActivePolicyIdentity: async () => null,
    getReceiptsModule: async () => null, policyRecord: (...args) => records.push(args),
    loadModule: async (name) => { assert.equal(name, "scripts/task-history.mjs"); return history; },
    executorRunEnv: async () => ({ via: "fixture", modelArgs: "", env: {} }),
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas", ASSISTANT_HISTORY_PATH: "history", CHECKPOINTS_PATH: "checkpoints",
    EXECUTOR_MAX_DEPTH: 3, EXECUTOR_MAX_HANDOFFS: 3, EXECUTOR_PROMPT_MAX: 24000, EXECUTOR_START_FAILURE_GRACE: 5,
    EXECUTOR_DONE_MARK: "MEFI_JOB_DONE", EXECUTOR_NEXT_MARK: "MEFI_NEXT:", EXECUTOR_CALL_MARK: "MEFI_CALL:",
    EXECUTOR_CALLABLE: new Set(["auditor", "reference"]), EXECUTOR_BUDGET_MINUTES: 15,
    EXECUTOR_KILL_MS: 1500000, EXECUTOR_START_BUDGET_MS: 180000, EXECUTOR_STAGGER_MS: 3000, EXECUTOR_PROGRESS_POLL_MS: 12000,
    EXECUTOR_PARALLEL_MAX: 12, EXECUTOR_PARALLEL_CAP: 3, AUTOPILOT_PARK_MS: 600000, MINUTE_MS: 60000,
    ASSISTANT_PRIORITY: { cadence: 1, demand: 2, responder: 3 }, ASSISTANT_NODE: { id: "assistant", kind: "assistant" }, ASSISTANT_JOB_WEDGED_MS: 1500000,
    AI_PARALLEL_MAX: 6, ASSISTANT_JOB_TIMEOUT_MS: 150000,
    assistantRoleTargets: () => [], assistantAgentEvent() {}, assistantReportIntel() {},
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true, assistantThink() {}, assistantThinkClear() {}, assistantWrite: async () => {}, assistantPoolCounts() {},
    SMOKE: false, CAPTURE: false, CLI_MODE: false, proactiveTimer: null,
    compareWork: (a, b) => Number(Boolean(b.pin)) - Number(Boolean(a.pin)) || (a.createdAt ?? a.at ?? 0) - (b.createdAt ?? b.at ?? 0),
    mutateBoard: async (mutator) => {
      const next = copy(board), result = mutator(next, eyes) ?? {};
      if (pendingWriteFailures > 0) { pendingWriteFailures -= 1; throw new Error("fixture storage unavailable"); }
      for (const key of ["tasks", "requests", "ideas"]) if (result[key]) next[key] = result[key];
      if (result.ok === false) return result;
      board = next; return { ...copy(board), ...result, written: ["tasks", "requests"] };
    }, withBoardLock: async (fn) => fn(),
    queueRequests: async (additions) => { const fresh = additions.filter((row) => !board.requests.some((saved) => saved.prompt === row.prompt)); board.requests.push(...copy(fresh)); return fresh.length; },
    assistantClip: (text, max) => String(text ?? "").slice(0, max), taskTarget: (id) => ({ id, kind: "task" }), sessionTarget: (id) => ({ id, kind: "session" }),
    assistantHop: async () => {}, assistantLog: (_kind, text) => logs.push(text), logLine: (text) => logs.push(text),
    assistantEnqueueRole: (role) => { roleRequests.push(role); if (role === "foreman") pendingForeman = true; },
    admitBacklogIdeas: async () => 0, refreshAutopilotQueue: async () => {},
    ensureAssistant: async () => {},
    assistantPause: async () => { env.assistantState.status = "paused"; autopilot.clusterCancel?.("Work paused"); if (realPool) env.assistantClearQueue({ text: "dropped · paused" }); },
    assistantResume: async () => { env.assistantState.status = "running"; if (realPool) env.assistantPump(); },
    backlogStatus: async () => ({ ok: true, ...backlog.summarizeBacklog({ ...board, jobs: autopilot.jobs, autoBuild: autopilot.autoBuild, paused: env.assistantState.status === "paused" || !autopilot.execute }) }),
    assistantHearBuilder: () => ({}), assistantNodeContext() {}, assistantAppendReply() {}, saveAssistant: async () => {}, assistantSetProblems() {},
    emitAutopilot() {}, send() {}, executorLog: async (record) => records.push(record),
    pushAutopilotHistory: (kind, text) => autopilot.history.push({ kind, text, at: now }),
    setAutopilotWaiting: (reason) => { autopilot.waiting = reason; },
    watchRunSession() {}, watchJobProgress() {}, statSync: () => ({ isFile: () => true }),
    setTimeout: (fn, delay) => { const timer = { fn, delay, at: now + delay, unref() {} }; timers.push(timer); if (delay === 3000) queueMicrotask(fn); return timer; },
    clearTimeout: (timer) => { timer.cancelled = true; }, setInterval: () => ({ unref() {} }), clearInterval() {},
    readSettings: async () => copy(settings), writeSettings: async (next) => { settings = copy(next); }, sweepSnapshotLocks: async () => {},
    autopilotStatus: () => autopilot,
    spawn: (command, args, options) => {
      if (command === "taskkill") {
        assert.equal(options.windowsHide, true); assert.equal(options.stdio, "ignore");
        const child = Object.assign(new EventEmitter(), { kill() { this.killed = true; } });
        terminations.push({ child, pid: Number(args[1]) });
        return child;
      }
      assert.equal(command, "cmd.exe"); assert.equal(options.cwd, root); assert.equal(options.windowsHide, true);
      const child = Object.assign(new EventEmitter(), { pid: 200 + starts.length, stdout: stream(), stderr: stream() });
      child.stdin = Object.assign(new EventEmitter(), { write: (prompt) => { child.prompt = prompt; }, end: () => { child.inputEnded = true; } });
      starts.push({ child, taskId: autopilot.jobs.at(-1)?.taskId, runId: autopilot.jobs.at(-1)?.id });
      return child;
    },
  });
  vm.runInContext([
    section("function parseExecutorHandoff(", "// assistant:run modes map"),
    section("function workTitleKey(", "async function refreshAutopilotQueue("),
    section("function queuedWorkCount(", "async function backlogStatus("),
    section("async function backlogControl(", "function taskProjectError("),
    section("function taskView(", "async function setTaskDependencies("),
    section("async function saveTaskEdits(", "function workTitleKey("),
    section("async function promoteRequestsToTasks()", "// Chat work lands straight"),
    section("function executorProcessAlive(", "// The `opencode run` child"),
    section("async function attributeRunSession(", "function watchRunSession("),
    section("let executorFillInFlight = null;", "// Work the assistant does on its own plumbing"),
    section("async function releaseExecutorClaim(", "// A finished run's handoffs:"),
    section("async function runExecutorHandoffs(", "// Housekeeping runs every pass"),
    section("const VERIFY_DWELL_MS =", "// One autopilot tick:"),
    section("async function assistantForemanJob(", "// The thinker:"),
    section("function assistantAskForWork(", "// What the assistant is doing about the build queue"),
    section("function assistantSuperviseJobs(", "function assistantStaleWork("),
    section("async function setAutopilot(", "// Settings may override the defaults"),
    section("let autopilotBootPromise = null;", "async function readSettings("),
    section("function machineMemoryWarnOverride(", "let machineTimer = null;"),
  ].join("\n"), env);
  if (realWatches) vm.runInContext(section("function watchJobProgress(", "// Starts eligible work"), env);
  if (realPool) {
    vm.runInContext([
      section("function assistantRowTargets(", "// Roster label"),
      section("function assistantPoolCounts(", "function assistantAgentEvent("),
      section("function enqueue(", "// ---- role jobs:"),
    ].join("\n"), env);
    const pooledEnqueue = env.enqueue;
    env.enqueue = (role, run, options = {}) => { supportJobs.push({ role, ...options }); return pooledEnqueue(role, run, options); };
  }
  return {
    env, get state() { return env.assistantState; }, pool, autopilot, starts, logs, roleRequests, records, registry, timers, terminations, machine, capacityCalls, supportCalls, supportJobs, contextCalls, routeCalls,
    board: () => copy(board), edit: (fn) => fn(board), now: () => now, settings: () => copy(settings),
    advance: (ms) => { now += ms; }, failNextWrite: () => { pendingWriteFailures += 1; },
    evidence: (id, value) => changes.set(id, value),
    session: (runId, sessionId, rows = []) => { sessions.set(runId, { id: sessionId }); todos.set(sessionId, copy(rows)); },
    wake: (reason = "fixture cadence") => env.assistantAskForWork(reason),
    async pump() { for (let turns = 0; pendingForeman; turns += 1) { assert.ok(turns < 12, "foreman wakeups must converge"); pendingForeman = false; await env.assistantForemanJob(now, {}); } },
    async finish(taskId, { code = 0, lines = ["MEFI_JOB_DONE"], files = [{ file: "fixture.js", status: "completed" }], observedChecks = [] } = {}) {
      const entry = autopilot.jobs.find((job) => job.taskId === taskId); assert.ok(entry, `live worker for ${taskId}`);
      const sessionId = `session:${entry.id}`; sessions.set(entry.id, { id: sessionId }); changes.set(sessionId, files);
      checks.set(sessionId, observedChecks);
      for (const line of lines) entry.child.stdout.emit("data", line + "\n");
      await entry.reap(code); return { entry, sessionId };
    },
  };
}
