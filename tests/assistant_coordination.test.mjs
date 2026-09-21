import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import executorResume from "../scripts/executor-resume.cjs";

// Exercise host handoffs with the real assistant rules and controlled I/O.
// These fixtures never open a store, start a worker, or call a model.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const clip = (value, length) => String(value ?? "").slice(0, length);

test("overseer reads live runs inside the board transaction before recovering orphaned claims", async () => {
  const lock = deferred();
  const board = { tasks: [{ id: "new-task", status: "open" }, { id: "orphan", status: "active", runId: "old-run" }], requests: [] };
  const autopilot = { jobs: [], execute: true, enabled: true };
  const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    process, executorResume, executorProcessAlive: () => false,
    assistantState: { status: "running", prefs: {} }, autopilot,
    getEyes: async () => ({}),
    mutateBoard: async (mutator) => { await lock.promise; const patch = mutator(board); Object.assign(board, patch); return patch; },
    getAssistant: async () => ({ pendingWork: () => ({}) }), assistantRestartWork: () => [],
    assistantReadStore: async () => ({ sessions: [], todos: [] }),
    assistantModule: { staleRescues: () => [], policyFromPrefs: () => ({}) }, requestBaseline: async () => [],
    ASSISTANT_PRIORITY: { demand: 2 }, assistantEnqueueRole() {}, assistantAskForWork() {},
    assistantLog() {}, emitAutopilot() {}, saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantOverseerRepair(", "// overseer: the R&D layer"), env);
  const review = env.assistantOverseerRepair(1000);
  await flush();
  // The executor's earlier transaction claims work while repair is waiting.
  autopilot.jobs.push({ id: "new-run" });
  board.tasks[0] = { ...board.tasks[0], status: "active", runId: "new-run" };
  board.requests.push({ title: "new request", status: "running", runId: "new-run" });
  lock.resolve();
  await review;
  assert.equal(board.tasks[0].status, "active", "a live worker's task must not be reopened for duplicate dispatch");
  assert.equal(board.tasks[0].runId, "new-run");
  assert.equal(board.requests[0].status, "running");
  assert.equal(board.tasks[1].status, "open", "an actual orphan still recovers");
});

test("overseer recovery preserves live owner or worker processes and restores dead claims with their saved progress", async () => {
  const now = 4000000;
  const specs = [
    { id: "foreign-fresh", lease: { pid: process.pid + 1, at: now - 1000 }, held: true },
    { id: "foreign-stale", lease: { pid: process.pid + 2, at: now - 30 * 60000 }, held: false },
    { id: "foreign-live-stale", lease: { pid: process.pid + 1, at: 1 }, held: true },
    { id: "foreign-dead-fresh", lease: { pid: process.pid + 2, at: now - 1000 }, held: false },
    { id: "worker-still-alive", lease: { pid: process.pid + 2, at: 1 }, workerPid: process.pid + 4, held: true },
    { id: "owned-dead", lease: { pid: process.pid, at: now - 1000 }, held: false },
    { id: "legacy", held: false },
    { id: "live-local", lease: { pid: process.pid, at: 1 }, held: true },
  ];
  for (const manual of [false, true]) {
    const board = {
      tasks: specs.map((row) => ({ id: row.id, status: "active", runId: row.id, lease: row.lease, runProgress: { runId: row.id, workerPid: row.workerPid, outputTail: ["saved changes"] } })),
      requests: specs.map((row) => ({ title: row.id, status: "running", runId: row.id, lease: row.lease, runProgress: { runId: row.id, workerPid: row.workerPid, outputTail: ["saved changes"] } })),
    };
    const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
      process, executorResume, executorProcessAlive: (pid) => [process.pid + 1, process.pid + 4].includes(pid),
      assistantState: { status: "running", prefs: {} }, autopilot: { jobs: [{ id: "live-local" }], execute: true, enabled: true },
      getEyes: async () => ({}),
      mutateBoard: async (mutator) => { const patch = mutator(board); Object.assign(board, patch); return patch; },
      getAssistant: async () => ({ pendingWork: () => ({}) }), assistantRestartWork: () => [],
      assistantReadStore: async () => ({ sessions: [], todos: [] }),
      assistantModule: { ...assistant, staleRescues: () => [], policyFromPrefs: () => ({}) }, requestBaseline: async () => [],
      ASSISTANT_PRIORITY: { demand: 2 }, assistantEnqueueRole() {}, assistantAskForWork() {},
      assistantLog() {}, emitAutopilot() {}, saveAssistant: async () => {},
    });
    vm.runInContext(section("async function assistantOverseerRepair(", "// overseer: the R&D layer"), env);
    await env.assistantOverseerRepair(now, { manual });
    for (const [index, spec] of specs.entries()) {
      assert.equal(board.tasks[index].status, spec.held ? "active" : "open", `${spec.id}: manual=${manual}`);
      assert.equal(board.requests[index].status, spec.held ? "running" : undefined, `${spec.id}: manual=${manual}`);
      if (!spec.held) {
        assert.equal(board.tasks[index].runProgress.pending, true);
        assert.deepEqual(board.requests[index].runProgress.outputTail, ["saved changes"]);
      }
      if (spec.held) {
        assert.deepEqual(board.tasks[index].lease, spec.lease);
        assert.deepEqual(board.requests[index].lease, spec.lease);
      } else {
        assert.equal(board.tasks[index].runId, undefined);
        assert.equal(board.tasks[index].lease, undefined);
        assert.equal(board.requests[index].runId, undefined);
        assert.equal(board.requests[index].lease, undefined);
      }
    }
  }
});

for (const pause of [false, true]) test(`overseer findings ${pause ? "wait after Pause during AI review" : "wake the responsible roles"}`, async () => {
  const response = deferred(), sent = [], dispatched = [], thoughts = [];
  const state = assistant.emptyState(1000);
  state.status = "running";
  state.ai.keyPresent = true;
  const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: state, getAssistant: async () => assistant, overseerManualUntil: 0,
    assistantOverseerRepair: async () => ({ fixed: [], directives: [], rescued: 0, staleCount: 0 }),
    growthBoardFacts: async () => ({ outstanding: 0, growthHeld: false, existingWork: [] }),
    SMOKE: false, assistantAiUsable: () => true,
    assistantFetch: () => response.promise, ASSISTANT_OVERSEER_SYSTEM: "fixture", overseerFacts: () => ({}),
    assistantAiOk() {}, assistantSetProblems() {}, assistantSetPrefs: async () => {},
    getEyes: async () => ({}), isStudioProject: () => false,
    requestsFromExpand: () => [], requestBaseline: async () => [], queueRequests: async () => 0,
    assistantLog() {}, assistantClip: clip, assistantCommitThought: (text) => thoughts.push(text), assistantAppendReply() {},
    assistantEnqueueRole: (role) => sent.push(role), ASSISTANT_PRIORITY: { demand: 2 },
    assistantAskForWork: (reason) => dispatched.push(reason), saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantOverseerJob(", "// An assistant call that hovers"), env);
  const review = env.assistantOverseerJob(1000);
  await flush();
  if (pause) state.status = "paused";
  response.resolve({ ok: true, text: JSON.stringify({ findings: [{ severity: "warn", title: "builders reporting failures", detail: "check recent runs" }, { severity: "warn", title: "auditor failing", detail: "retry audit" }] }) });
  const result = await review;
  assert.equal(result.ok, true);
  assert.equal(state.overseer.reviews, 1, "the current review can finish and retain its findings");
  assert.equal(sent.includes("foreman"), !pause);
  assert.equal(sent.includes("auditor"), !pause);
  assert.equal(dispatched.length > 0, !pause);
  assert.equal(result.intel.sent, pause ? 0 : 2, "the report counts roles actually scheduled");
  if (pause) assert.ok(thoughts.every((text) => !text.startsWith("On it — sending")), "the assistant must not claim it sent paused agents");
});

test("reference handoffs retain distinct instructions while coalescing an identical in-flight request", async () => {
  const calls = new Map(), gathered = [];
  const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: { prefs: { proactive: false }, agents: [] }, assistantAiUsable: () => false,
    assistantBrieferAllowed: () => false, assistantEnqueueRole() {}, ASSISTANT_PRIORITY: { demand: 2 },
    assistantClip: clip, gatherReferences: async ({ text }) => { gathered.push(text); return { ok: true }; },
    enqueue(role, job, { key = role } = {}) { if (!calls.has(key)) calls.set(key, { role, job }); },
  });
  vm.runInContext(section("async function assistantDispatchAgents(", "function assistantBrieferAllowed()"), env);
  await env.assistantDispatchAgents("Fix renderer accessibility");
  await env.assistantDispatchAgents("Verify file locking");
  await env.assistantDispatchAgents("Fix renderer accessibility");
  for (const call of calls.values()) if (call.role === "reference") await call.job();
  assert.deepEqual(gathered, ["Fix renderer accessibility", "Verify file locking"]);
});

test("builder failure reports use the reporting run's error and wake recovery through shared intel", () => {
  const env = vm.createContext({
    // The mail channel has its own suite (assistant_mail.test.mjs); this host neither takes nor sends notes.
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: assistant.emptyState(1000), assistantModule: assistant,
    autopilot: { lastError: "unrelated parallel job error" }, EXECUTOR_DONE_MARK: "DONE",
    assistantClip: clip, logLine() {}, logError() {}, assistantEmit() {}, assistantLog() {}, assistantAppendReply() {},
    saveAssistant: async () => {},
  });
  vm.runInContext(section("function assistantHearBuilder(", "// A context entry lands"), env);
  const report = env.assistantHearBuilder({ outputTail: ["worker progress"], handoffs: [] }, { title: "task A", source: "chat" }, false, "task A check failed");
  assert.match(report.finding, /task A check failed/);
  assert.doesNotMatch(report.reply, /unrelated parallel/);
  assert.equal(report.wakeOverseer, true);
  const digest = assistant.overseerDigest(env.assistantState, Date.now());
  const review = assistant.overseerReview(digest);
  const talk = assistant.overseerTalk(review, { digest });
  assert.ok(review.findings.some((finding) => finding.title === "builders reporting failures"));
  assert.ok(talk.roles.includes("foreman"));
  assert.equal(talk.dispatch, true);
});
