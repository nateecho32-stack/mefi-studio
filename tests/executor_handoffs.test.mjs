import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import * as assistant from "../scripts/assistant.mjs";

// Real parser, role routing and restartable reference work, with local I/O
// captured at its boundaries. No workers, live stores or models are invoked.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
function host() {
  const queued = [], requests = [], gathered = [], attached = [], history = [];
  const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    Date, Set, EXECUTOR_MAX_DEPTH: 3, EXECUTOR_MAX_HANDOFFS: 3,
    EXECUTOR_NEXT_MARK: "MEFI_NEXT:", EXECUTOR_CALL_MARK: "MEFI_CALL:",
    EXECUTOR_CALLABLE: new Set(["auditor", "reference"]),
    ASSISTANT_PRIORITY: { demand: 2 }, ASSISTANT_NODE: { kind: "assistant", id: "assistant" },
    assistantState: { prefs: {} }, assistantAiUsable: () => false,
    ASSISTANT_ROLE_JOBS: { auditor: async () => ({ ok: true }) },
    queueRequests: async (rows) => { requests.push(...rows); return rows.length; },
    taskHandoffs,
    mutateBoard: async (fn) => { const patch = fn({ tasks: [], requests: [...requests] }); requests.splice(0, requests.length, ...patch.requests); return patch; },
    enqueue: (role, run, options) => { queued.push({ role, run, options }); return Promise.resolve(); },
    taskTarget: (id) => ({ kind: "task", id }),
    gatherReferences: async (payload) => { gathered.push(payload); return { ok: true, references: { files: ["src/example.js"] } }; },
    attachTaskRefs: async (id, references) => { attached.push({ id, references }); },
    assistantClip: (text, max) => String(text ?? "").slice(0, max),
    pushAutopilotHistory: (kind, text) => history.push({ kind, text }),
    logLine() {}, assistantLog() {}, emitAutopilot() {}, assistantAskForWork() {},
  });
  vm.runInContext(
    section("function parseExecutorHandoff(", "// assistant:run modes map") +
    section("function assistantEnqueueRole(", "// On-demand roles") +
    section("function assistantWorkJob(", "function assistantRestartWork(") +
    section("async function runExecutorHandoffs(", "// Housekeeping runs every pass"), env);
  return { env, queued, requests, gathered, attached, history };
}

function poolHost(saved = null) {
  const h = host(), started = [];
  const pool = { queue: [], running: new Map(), seq: 0, waiters: [] };
  const state = saved ? assistant.normalizeState(saved) : assistant.emptyState();
  state.status = "paused";
  Object.assign(h.env, {
    pool, assistantState: state, assistantModule: assistant,
    ASSISTANT_PRIORITY: { cadence: 1, demand: 2, responder: 3 },
    ASSISTANT_JOB_TIMEOUT_MS: 150000, EXECUTOR_PARALLEL_MAX: 12, AI_PARALLEL_MAX: 6,
    CLI_MODE: true, projectSwitching: false, projectAgentJobs: 0, assistantStopping: false,
    projects: { current: () => ({ id: "fixture" }), run: (_project, run) => run() },
    setTimeout: () => 1, clearTimeout() {},
    assistantRoleTargets: () => [{ kind: "assistant", id: "assistant" }],
    assistantJobId: () => `work_${pool.seq + 1}`,
    assistantJobLabel: (role, work) => `${role}: ${work.text}`, assistantWorkLabel: (work) => work.text,
    assistantInFlight: (id) => [...pool.queue, ...pool.running.values()].some((entry) => entry.key === id || entry.work?.id === id),
    assistantJournal: (entry) => { h.env.assistantState = assistant.applyWork(h.env.assistantState, entry); },
    assistantWrite: async () => {}, assistantAgentEvent() {}, assistantThink() {}, assistantThinkClear() {}, assistantReportIntel() {},
    assistantLoop: false, applyKeepAwake() {}, saveAssistant: async () => {},
    gatherReferences: async (payload) => { started.push("reference"); h.gathered.push(payload); return { ok: true, references: {} }; },
    ASSISTANT_ROLE_JOBS: Object.fromEntries(["auditor", "improver", "watcher", "compactor", "ideas", "overseer"].map((role) => [role, async () => { started.push(role); return { ok: true }; }])),
  });
  vm.runInContext([
    section("function assistantRowTargets(", "// Roster label"),
    section("function assistantPoolCounts(", "function assistantAgentEvent("),
    section("function enqueue(", "// ---- role jobs:"),
    section("function assistantRestartWork(", "// Boot: what the previous process"),
    section("async function assistantResume()", "// ---- 24/7:"),
  ].join("\n"), h.env);
  return { ...h, pool, started };
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

test("a foreman finishing after Pause retains cleanup and idea handoffs until Resume", async () => {
  const h = poolHost();
  let finishDispatch;
  const dispatch = new Promise((resolve) => { finishDispatch = resolve; });
  Object.assign(h.env, {
    autopilot: { execute: true, jobs: [], parallel: 1 }, assistantCache: {}, MINUTE_MS: 60000,
    autopilotHousekeeping: async () => {}, classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => {}, executeNextRequest: () => dispatch,
  });
  h.env.assistantState.status = "running";
  vm.runInContext(section("async function assistantForemanJob(", "// The thinker: the assistant itself."), h.env);
  const foreman = h.env.assistantForemanJob(Date.now(), {});
  await flush();
  h.env.assistantState.status = "paused";
  finishDispatch();
  await foreman;
  await flush();
  assert.deepEqual(h.started, []);
  assert.deepEqual(h.pool.queue.map((entry) => entry.role).sort(), ["compactor", "ideas"]);
  assert.equal(h.env.assistantState.work.length, 2);
  await h.env.assistantResume();
  await flush();
  assert.deepEqual(h.started.sort(), ["compactor", "ideas"]);
  assert.equal(h.env.assistantState.work.length, 0);
});

test("an explicit manual request can run the same held role without duplicating its handoff", async () => {
  const h = poolHost();
  const automatic = h.env.assistantEnqueueRole("auditor", 2, { automatic: true });
  await flush();
  assert.deepEqual(h.started, []);
  const manual = h.env.assistantEnqueueRole("auditor", 2);
  assert.equal(manual, automatic);
  await manual;
  assert.deepEqual(h.started, ["auditor"]);
  assert.equal(h.env.assistantState.status, "paused");
  await h.env.assistantResume();
  await flush();
  assert.deepEqual(h.started, ["auditor"]);
  assert.equal(h.env.assistantState.work.length, 0);
});

for (const restart of [false, true]) test(`automatic worker calls wait for Resume${restart ? " across a paused restart" : " while manual actions remain available"}`, async () => {
  let h = poolHost();
  const job = { kind: "task", ref: { id: "task-a" }, title: "Saved brief", prompt: "Keep the complete requirement" };
  await h.env.runExecutorHandoffs({ id: "run-a", depth: 0, handoffs: [], calls: new Set(["reference", "auditor", "improver"]) }, job);
  await flush();
  assert.deepEqual(h.started, [], "a worker finishing after Pause must not start follow-up agents");
  assert.equal(h.env.assistantState.work.length, 3, "each paused handoff has a durable journal");
  assert.ok(h.pool.queue.every((entry) => entry.held));
  if (restart) {
    const saved = structuredClone(h.env.assistantState);
    const pending = assistant.pendingWork(saved);
    h = poolHost(saved);
    h.env.assistantRestartWork({ ...pending, interruptedRoles: [] });
    await flush();
    assert.deepEqual(h.started, [], "restart preserves operator Pause");
  } else {
    await h.env.assistantEnqueueRole("watcher");
    assert.deepEqual(h.started, ["watcher"], "an explicit manual role still runs while paused");
    h.started.length = 0;
  }
  await h.env.assistantResume();
  await flush();
  assert.deepEqual(h.started.sort(), ["auditor", "improver", "reference"]);
  assert.equal(h.env.assistantState.work.length, 0);
  await h.env.assistantResume();
  await flush();
  assert.equal(h.started.length, 3, "repeated Resume must not repeat completed follow-ups");
});

test("a worker's reference call runs a journaled gather for its saved task brief", async () => {
  const h = host();
  const parsed = h.env.parseExecutorHandoff("MEFI_CALL: reference");
  assert.equal(parsed.role, "reference");
  const job = { kind: "task", ref: { id: "task-a" }, title: "Repair task history", prompt: "Preserve prerequisite results and find relevant coverage." };
  await h.env.runExecutorHandoffs({ id: "run-a", depth: 0, handoffs: [], calls: new Set([parsed.role]) }, job);
  const reference = h.queued.find((row) => row.role === "reference");
  assert.ok(reference, "the allowed reference role must really be queued");
  assert.equal(reference.options.work.taskId, "task-a");
  assert.equal(reference.options.work.kind, "reference");
  assert.match(reference.options.work.payload.text, /Preserve prerequisite results/);
  assert.equal(reference.options.work.payload.useWeb, false);
  await reference.run();
  assert.equal(h.gathered.length, 1);
  assert.equal(h.attached[0].id, "task-a");
  assert.equal(h.attached[0].references.files[0], "src/example.js");
  // The saved job follows the same path after an interrupted app restart.
  await h.env.assistantWorkJob(reference.options.work).run();
  assert.equal(h.attached.length, 2);
});

test("worker handoffs retain parent/run lineage, cap follow-ups and route only allowed roles", async () => {
  const h = host();
  const next = h.env.parseExecutorHandoff("MEFI_NEXT: Verify keyboard flow :: Run the focus regression.");
  assert.equal(next.kind, "next");
  assert.equal(h.env.parseExecutorHandoff("MEFI_CALL: responder"), null);
  const job = { kind: "request", title: "Implement keyboard flow", prompt: "Keep keyboard access." };
  const entry = { id: "run-parent", depth: 1, handoffs: Array.from({ length: 4 }, (_, i) => ({ ...next, title: `${next.title} ${i}` })), calls: new Set(["auditor"]) };
  await h.env.runExecutorHandoffs(entry, job);
  assert.equal(h.requests.length, 3);
  assert.ok(h.requests.every((request) => request.depth === 2 && request.parent === job.title && request.fromRun === entry.id));
  assert.equal(h.queued[0].role, "auditor");
  entry.depth = 3;
  await h.env.runExecutorHandoffs(entry, job);
  assert.equal(h.requests.length, 3, "a chain at its depth limit cannot create further coding work");
});
