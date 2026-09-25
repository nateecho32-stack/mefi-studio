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

// The repair pass used to repeat two things other passes already do: lost
// claims are recovered by housekeeping on every foreman pass (the same
// executorResume.recover and lease rule, under the board lock), and
// interrupted journal work by the tick and the boot resume. It keeps what
// nothing else does: the stale-session rescue (reading the board, never
// writing it), the manual re-enable and the ask for work when it changed
// something — and on the cadence it no longer queues the compactor, the
// auditor and the foreman whatever it found.
function repairHost({ manual = false, execute = true, rescues = [] } = {}) {
  const board = { tasks: [{ id: "orphan", status: "active", runId: "dead-run" }, { id: "carried", status: "open", sessionId: "ses_b" }], requests: [{ title: "stranded", status: "running", runId: "dead-run" }] };
  const effects = { writes: 0, restarts: 0, roles: [], asks: [], queued: [], rescueTasks: null };
  const autopilot = { jobs: [], execute, enabled: true };
  const env = vm.createContext({
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    process, executorResume, executorProcessAlive: () => false,
    assistantState: { status: "running", prefs: {}, focus: { kind: "task", id: "task:carried" } }, autopilot,
    getEyes: async () => ({ readJson: async (file, fallback) => (file === "tasks" ? JSON.parse(JSON.stringify(board.tasks)) : fallback) }), TASKS_PATH: "tasks",
    mutateBoard: async () => { effects.writes += 1; return {}; },
    getAssistant: async () => ({ pendingWork: () => ({ jobs: [{ id: "old" }] }) }), assistantRestartWork: () => { effects.restarts += 1; return ["old"]; },
    assistantReadStore: async () => ({ sessions: [], todos: [] }),
    assistantModule: { ...assistant, staleRescues: ({ tasks }) => { effects.rescueTasks = tasks; return rescues; }, policyFromPrefs: () => ({}) }, requestBaseline: async () => [],
    queueRequests: async (rows) => { effects.queued.push(...rows); return rows.length; }, assistantNodeContext() {}, assistantFocus: async () => {},
    assistantClip: clip, pushAutopilotHistory() {},
    ASSISTANT_PRIORITY: { demand: 2 }, assistantEnqueueRole: (role) => effects.roles.push(role), assistantAskForWork: (reason) => effects.asks.push(reason),
    assistantLog() {}, emitAutopilot() {}, saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantOverseerRepair(", "// overseer: the R&D layer"), env);
  return { env, board, effects, autopilot, run: () => env.assistantOverseerRepair(4000000, { manual }) };
}

test("the overseer's repair leaves claim recovery to housekeeping and interrupted jobs to the tick", async () => {
  const h = repairHost();
  const repair = await h.run();
  assert.equal(h.effects.writes, 0, "no board write: housekeeping recovers the orphaned claim on the next foreman pass");
  assert.equal(h.board.tasks[0].status, "active");
  assert.equal(h.board.requests[0].status, "running");
  assert.equal(h.effects.restarts, 0, "interrupted journal work is the tick's and the boot resume's");
  assert.deepEqual(h.effects.rescueTasks.map((task) => task.id), ["orphan", "carried"], "the stale rescue still reads the board's tasks");
  assert.equal(repair.fixed.length, 0);
  assert.deepEqual(h.effects.roles, [], "a cadence repair that fixed nothing queues no compactor or auditor");
  assert.deepEqual(h.effects.asks, [], "and asks the foreman for nothing");
});

test("the overseer's repair still rescues stale sessions, re-enables on the button, and then asks for work", async () => {
  const rescued = repairHost({ rescues: [{ id: "ses_a", title: "Stale work", todo: "wire it", quietMinutes: 1800, request: { title: "Resume: Stale work", prompt: "resume" } }] });
  const report = await rescued.run();
  assert.equal(report.rescued, 1);
  assert.deepEqual(rescued.effects.queued.map((row) => [row.title, row.source]), [["Resume: Stale work", "overseer"]]);
  assert.deepEqual(rescued.effects.asks, ["overseer repair"], "what the rescue filed is handed out");
  assert.deepEqual(rescued.effects.roles, []);
  const button = repairHost({ manual: true, execute: false });
  await button.run();
  assert.equal(button.autopilot.execute, true, "the Oversee click re-enables the executor the owner switched off");
  assert.deepEqual(button.effects.roles, ["compactor"], "the button reshapes the queue first");
  assert.deepEqual(button.effects.asks, ["overseer repair"]);
  const cadence = repairHost({ execute: false });
  const held = await cadence.run();
  assert.equal(cadence.autopilot.execute, false, "the cadence never overrides the owner's switch");
  assert.ok(held.directives.some((row) => /executor off by operator choice/.test(row.text)));
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

// The heavy review used to run on every 15-minute pass and every builder
// failure whenever a key was usable. The role still runs 24/7 (its local
// review never waits); only the paid call is gated on change or on a request.
test("the overseer pays for an AI review only when the board changed or the owner asked, and says which review it ran", async () => {
  const state = assistant.emptyState(1000);
  state.status = "running";
  state.ai.keyPresent = true;
  let calls = 0, usable = true;
  const env = vm.createContext({
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: state, getAssistant: async () => assistant, overseerManualUntil: 0,
    assistantOverseerRepair: async () => ({ fixed: [], directives: [], rescued: 0, staleCount: 0 }),
    growthBoardFacts: async () => ({ outstanding: 0, growthHeld: false, existingWork: [] }),
    SMOKE: false, assistantAiUsable: () => usable,
    assistantFetch: async () => { calls += 1; return { ok: true, text: JSON.stringify({ summary: "ai read", findings: [] }) }; },
    ASSISTANT_OVERSEER_SYSTEM: "fixture", overseerFacts: () => ({}),
    assistantAiOk() {}, assistantAiFailed() {}, assistantSetProblems() {}, assistantSetPrefs: async () => {},
    getEyes: async () => ({}), isStudioProject: () => false,
    requestsFromExpand: () => [], requestBaseline: async () => [], queueRequests: async () => 0,
    assistantLog() {}, assistantClip: clip, assistantCommitThought() {}, assistantAppendReply() {},
    assistantEnqueueRole() {}, ASSISTANT_PRIORITY: { demand: 2 }, assistantAskForWork() {}, saveAssistant: async () => {},
  });
  vm.runInContext(section("async function assistantOverseerJob(", "// An assistant call that hovers"), env);
  const first = await env.assistantOverseerJob(1000);
  assert.equal(calls, 1, "the first review has nothing to compare with");
  assert.match(first.text, /^AI review · no AI review yet/);
  assert.equal(state.overseer.ai.lastAt, 1000);
  assert.equal(state.overseer.ai.signature, assistant.overseerSignature(assistant.overseerDigest(state, 1000)));
  const same = await env.assistantOverseerJob(2000);
  assert.equal(calls, 1, "an unchanged board is not paid for again");
  assert.match(same.text, /^local review · nothing changed since the last AI review/);
  assert.equal(same.intel.ai, false);
  assert.deepEqual([state.overseer.reviews, state.overseer.ai.lastAt, state.overseer.ai.skippedAt, state.overseer.ai.skipped], [2, 1000, 2000, "nothing changed since the last AI review"], "the local review still ran and the skip is on record");
  state.problems = [{ kind: "audit", text: "1 audit error", since: 2500 }];
  const changed = await env.assistantOverseerJob(3000);
  assert.equal(calls, 2, "a new problem kind is a material change");
  assert.match(changed.text, /^AI review · the board changed/);
  await env.assistantOverseerJob(4000);
  assert.equal(calls, 2);
  env.overseerManualUntil = Date.now() + 60000;
  await env.assistantOverseerJob(5000);
  assert.equal(calls, 3, "the Oversee button always gets the AI review");
  assert.equal(env.overseerManualUntil, 0);
  usable = false;
  state.problems = [];
  const offline = await env.assistantOverseerJob(6000);
  assert.equal(calls, 3);
  assert.match(offline.text, /^local review · AI not usable/);
});

test("a builder failure wakes the overseer at most once per ten minutes", () => {
  let clock = 1_000_000;
  const env = vm.createContext({
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: assistant.emptyState(clock), assistantModule: assistant,
    Date: class extends Date { static now() { return clock; } },
    autopilot: { lastError: null }, EXECUTOR_DONE_MARK: "DONE",
    assistantClip: clip, logLine() {}, logError() {}, assistantEmit() {}, assistantLog() {}, assistantAppendReply() {},
    saveAssistant: async () => {}, assistantReportIntel() {},
  });
  vm.runInContext(section("function assistantHearBuilder(", "// A context entry lands"), env);
  const fail = (title) => env.assistantHearBuilder({ outputTail: ["broke"], handoffs: [] }, { title, source: "auto" }, false, `${title} failed`);
  assert.equal(fail("task A").wakeOverseer, true, "the first failure wakes it");
  clock += 5 * 60000;
  assert.equal(fail("task B").wakeOverseer, false, "a second failure inside ten minutes waits for the next review");
  assert.ok(assistant.overseerDigest(env.assistantState, clock).builders.fails >= 2, "both failures are still on the digest");
  clock += 5 * 60000 + 1;
  assert.equal(fail("task C").wakeOverseer, true, "ten minutes on, a failure wakes it again");
  assert.equal(env.assistantHearBuilder({ outputTail: [], handoffs: [] }, { title: "task D", source: "auto" }, true).wakeOverseer, false, "a finish never wakes it");
});

test("chat work gathers references once per card and saves them on it, with no roster fan-out", async () => {
  const calls = new Map(), gathered = [], attached = [], roles = [];
  const env = vm.createContext({
    ASSISTANT_PRIORITY: { demand: 2 }, assistantClip: clip,
    assistantEnqueueRole: (role) => roles.push(role),
    gatherReferences: async ({ text }) => { gathered.push(text); return { ok: true, references: { files: [text] } }; },
    attachTaskRefs: async (taskId, references) => { attached.push({ taskId, files: references.files }); return true; },
    lunaContextPointer: async () => null,
    enqueue(role, job, { key = role, work = null } = {}) { if (!calls.has(key)) calls.set(key, { role, job, work }); },
  });
  vm.runInContext(section("function assistantGatherTaskReferences(", "function assistantBrieferAllowed()"), env);
  env.assistantGatherTaskReferences("task_a", "Fix renderer accessibility");
  env.assistantGatherTaskReferences("task_b", "Verify file locking");
  env.assistantGatherTaskReferences("task_a", "Fix renderer accessibility");
  env.assistantGatherTaskReferences("task_c", "   ");
  for (const call of calls.values()) await call.job();
  assert.deepEqual(gathered, ["Fix renderer accessibility", "Verify file locking"], "one gather per card; an empty brief gathers nothing");
  assert.deepEqual(JSON.parse(JSON.stringify(attached)), [{ taskId: "task_a", files: ["Fix renderer accessibility"] }, { taskId: "task_b", files: ["Verify file locking"] }], "the result lands on the card that asked");
  assert.deepEqual([...calls.values()].map((call) => call.work.taskId), ["task_a", "task_b"], "the journal keeps the card, so a resumed gather still lands on it");
  assert.deepEqual(roles, [], "chat work no longer sends the roster out");
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

test("a finished builder's report quotes its own summary, never the protocol lines", () => {
  const logged = [];
  const env = vm.createContext({
    assistantTakeMail: () => [], assistantDeliverMail: () => 0, assistantSendMail: () => true,
    assistantState: assistant.emptyState(1000), assistantModule: assistant,
    autopilot: { lastError: null }, EXECUTOR_DONE_MARK: "DONE",
    assistantClip: clip, logLine() {}, logError: (text) => logged.push(text), assistantEmit() {}, assistantLog: (_kind, text) => logged.push(text), assistantAppendReply() {},
    saveAssistant: async () => {},
  });
  vm.runInContext(section("function assistantHearBuilder(", "// A context entry lands"), env);
  const note = { raw: "done: added the guard; remaining: none", parts: { done: "added the guard", remaining: "none" } };
  env.assistantHearBuilder({ outputTail: ["**Note for the parent**: edge case", "MEFI_RESULT: done: added the guard; remaining: none", "DONE"], handoffs: [], resultNote: note }, { title: "task B", source: "auto" }, true);
  assert.match(logged.at(-1), /added the guard/);
  assert.doesNotMatch(logged.at(-1), /MEFI_RESULT|\*\*|DONE/);
  env.assistantHearBuilder({ outputTail: ["npm ERR! missing script: check", "MEFI_RESULT: blocked", "DONE"], handoffs: [] }, { title: "task C", source: "auto" }, false);
  assert.match(logged.at(-1), /missing script: check/);
  assert.doesNotMatch(logged.at(-1), /MEFI_RESULT/);
});
