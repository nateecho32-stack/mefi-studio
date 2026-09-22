// The host half of the decision lane: an agent's issue is triaged by the live
// brain map, either settled by the assistant or put in front of the owner, and
// the answer is written onto the task it was about before anything is re-armed.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import agentIssues from "../scripts/agent-issues.cjs";
import brains from "../scripts/brains.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

function issueHost({ policy = brains.issuePolicyFor(brains.defaultMap()), tasks = [{ id: "task_1", title: "Add the retry banner", status: "open", logs: [] }] } = {}) {
  const state = assistant.emptyState(1000);
  const board = { tasks, requests: [] };
  const logs = [], events = [], shapes = [], backlog = [], created = [], wakes = [], messages = [];
  const env = vm.createContext({
    console,
    assistantState: state,
    agentIssues,
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    assistantLog(kind, text) { logs.push({ kind, text }); return { kind, text }; },
    assistantEmit(event) { events.push(event); },
    saveAssistant: async () => {},
    ensureAssistant: async () => state,
    logError(text) { logs.push({ kind: "error", text }); },
    activeIssuePolicy: async () => policy,
    mutateBoard: async (fn) => fn(board),
    backlogControl: async (payload) => { backlog.push(payload); return { ok: true }; },
    rememberWorkShape: (taskId, shape) => shapes.push({ taskId, shape }),
    assistantCreateTask: async (payload) => { created.push(payload); return { id: `task_${created.length + 1}`, ...payload }; },
    assistantAskForWork: (reason) => wakes.push(reason),
    assistantMessage: async (text) => { messages.push(text); return { ok: true }; },
    assistantWorkOn: async () => ({ ok: true }),
    assistantControl: async () => ({ ok: true }),
    getAssistant: async () => ({ pendingOffers: () => [] }),
    readFile: async () => { throw new Error("not used"); },
    writeFile: async () => {},
    rename: async () => {},
    rm: async () => {},
    projectDataPath: (file) => file,
    EXECUTOR_LOG_PATH: "executor-log.jsonl",
    // The provider test and the start grace the failure question reads.
    assistantModule: assistant,
    EXECUTOR_START_FAILURE_GRACE: 5,
  });
  vm.runInContext(section("// ---- agent issues", "async function assistantSetPrefs("), env);
  return { env, state, board, logs, events, shapes, backlog, created, wakes, messages };
}

// Values that crossed out of the vm carry that realm's prototypes, so they
// are compared by shape rather than by strict identity.
const plain = (value) => JSON.parse(JSON.stringify(value));

const workerIssue = (kind, title, extra = {}) => ({
  kind, title, source: "worker", taskId: "task_1", taskTitle: "Add the retry banner", ...extra,
});

test("an agent's issue becomes a card about the task, with its evidence", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too", {
    detail: "the brief only covers the view", file: "renderer/idle.js", evidence: ["no store for retry state"],
  }));
  assert.ok(question, "the owner is asked");
  assert.equal(question.source, "issue");
  assert.match(question.title, /"Add the retry banner" is bigger than its brief/);
  assert.equal(question.context.taskId, "task_1");
  assert.equal(question.context.file, "renderer/idle.js");
  assert.deepEqual(plain(question.context.evidence), ["no store for retry state"]);
  assert.equal(h.state.questions.length, 1);
  assert.ok(h.logs.some((row) => row.kind === "issue" && row.text.includes("Add the retry banner")));
  // Every option acts on that task.
  for (const option of question.options) assert.equal(option.action.payload.taskId, "task_1");
});

test("a retryable issue inside the budget is settled by the assistant, not by you", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("run-failed", "exit 1", { attempts: 0 }));
  assert.equal(question, null, "no card for something the map lets the assistant settle");
  assert.equal(h.state.questions.length, 0);
  // Settle has already re-armed the failed run with its failure counted: the
  // assistant's answer is recorded, never applied as a retry that would erase
  // the budgets which park a looping card.
  assert.deepEqual(plain(h.backlog), []);
  assert.deepEqual(plain(h.wakes), []);
  assert.ok(h.logs.some((row) => row.kind === "decision" && row.text.includes("settled by the assistant")));
  const task = h.board.tasks[0];
  assert.equal(task.decisions.at(-1).choice, "retry");
  assert.match(task.logs.at(-1).text, /Assistant decided: try again/);
  assert.equal(task.pin, undefined, "the assistant never pins its own answer");
});

test("a map with no triage part settles nothing and records no decision", async () => {
  const map = brains.normalizeMap(brains.defaultMap());
  const untriaged = brains.issuePolicyFor(brains.normalizeMap({ ...map, nodes: map.nodes.filter((node) => node.type !== "issue.triage") }));
  assert.equal(untriaged.triage, false);
  const h = issueHost({ policy: untriaged });
  assert.equal(await h.env.assistantRaiseIssue(workerIssue("run-failed", "exit 1", { attempts: 0 })), null);
  assert.equal(h.board.tasks[0].decisions, undefined);
  assert.deepEqual(plain(h.backlog), []);
  assert.equal(h.state.questions.length, 0);
  assert.ok(h.logs.some((row) => row.kind === "issue"), "the issue is still recorded in the log");
});

test("past the retry budget the same issue reaches the owner", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("run-failed", "exit 1", { attempts: 4 }));
  assert.ok(question);
  assert.deepEqual(h.backlog, [], "nothing is re-armed until it is answered");
  assert.ok(question.options.some((option) => option.id === "retry-deep"));
});

test("a permission or a risk is never settled for you, whatever the map says", async () => {
  const wideOpen = { ...brains.issuePolicyFor(brains.defaultMap()), auto: agentIssues.ISSUE_KIND_IDS, autoRetryLimit: 5 };
  for (const kind of ["permission", "risk"]) {
    const h = issueHost({ policy: wideOpen });
    const question = await h.env.assistantRaiseIssue(workerIssue(kind, "it wants to edit main.cjs", { permission: "write-files" }));
    assert.ok(question, `${kind} reaches the owner`);
    assert.deepEqual(plain(h.backlog), []);
  }
});

test("one open card per task and kind, however often a run hits the same wall", async () => {
  const h = issueHost();
  const first = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
  const second = await h.env.assistantRaiseIssue(workerIssue("scope", "still bigger than the brief"));
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(h.state.questions.filter((question) => question.status === "open").length, 1);
  // A different kind on the same task is a different decision and still asks.
  assert.ok(await h.env.assistantRaiseIssue(workerIssue("conflict", "two ways to finish it")));
  assert.equal(h.state.questions.length, 2);
});

test("a map with no triage or ask part keeps decisions off the rail, and says so in the log", async () => {
  const map = brains.normalizeMap(brains.defaultMap());
  const quiet = brains.issuePolicyFor(brains.normalizeMap({
    ...map, nodes: map.nodes.filter((node) => !["issue.triage", "ask.user"].includes(node.type)),
  }));
  const h = issueHost({ policy: quiet });
  assert.equal(await h.env.assistantRaiseIssue(workerIssue("scope", "bigger than the brief")), null);
  assert.equal(h.state.questions.length, 0);
  assert.ok(h.logs.some((row) => row.kind === "issue"), "the issue is still recorded");
});

test("granting reach writes it on that task alone, then re-arms the work", async () => {
  const h = issueHost();
  const result = await h.env.assistantIssueAction({ action: "grant", payload: { taskId: "task_1", permission: "write-files", issueKind: "permission" } }, "only main.cjs");
  assert.equal(result.ok, true);
  const task = h.board.tasks[0];
  assert.deepEqual(plain(task.grants), ["write-files"]);
  assert.equal(task.decisions.at(-1).permission, "write-files");
  assert.equal(task.decisions.at(-1).text, "only main.cjs");
  assert.match(task.logs.at(-1).text, /grant write-files for this task — only main.cjs/);
  assert.deepEqual(plain(h.backlog), [{ action: "retry", taskId: "task_1" }]);
  assert.deepEqual(plain(h.wakes), ["a decision was answered"]);
});

test("a heavier retry is a routing hint for the next dispatch", async () => {
  const h = issueHost();
  await h.env.assistantIssueAction({ action: "retry-deep", payload: { taskId: "task_1", issueKind: "capability" } });
  assert.deepEqual(plain(h.shapes), [{ taskId: "task_1", shape: { weight: "deep", intent: "build", complexity: "high", role: "worker" } }]);
  assert.deepEqual(plain(h.backlog), [{ action: "retry", taskId: "task_1" }]);
});

test("splitting the extra work out makes a card for it and keeps this brief", async () => {
  const h = issueHost();
  await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } }, "the store belongs in its own task");
  assert.equal(h.created.length, 1);
  assert.match(h.created[0].title, /Follow-up: Add the retry banner/);
  assert.equal(h.created[0].prompt, "the store belongs in its own task");
  assert.equal(h.created[0].splitFrom, "task_1");
  assert.equal(h.created[0].splitDepth, 1);
  assert.equal(h.board.tasks[0].decisions.at(-1).choice, "split");
});

test("a follow-up's own split numbers the chain from its root instead of repeating its title", async () => {
  const h = issueHost({ tasks: [{ id: "task_1", title: "Follow-up: Add the retry banner", status: "open", splitFrom: "task_0", splitDepth: 1, logs: [] }] });
  const result = await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } });
  assert.equal(result.ok, true);
  assert.equal(h.created[0].title, "Follow-up 2: Add the retry banner");
  assert.equal(h.created[0].splitFrom, "task_1");
  assert.equal(h.created[0].splitDepth, 2);
  // A chain split before splitDepth was recorded counts its own prefixes.
  const legacy = issueHost({ tasks: [{ id: "task_1", title: "Follow-up: Follow-up: Add the retry banner", status: "open", logs: [] }] });
  await legacy.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } });
  assert.equal(legacy.created[0].title, "Follow-up 3: Add the retry banner");
  assert.equal(legacy.created[0].splitDepth, 3);
});

test("a split past three follow-ups is refused before anything is recorded", async () => {
  const h = issueHost({ tasks: [{ id: "task_1", title: "Follow-up 3: Add the retry banner", status: "open", splitFrom: "task_0", splitDepth: 3, logs: [] }] });
  const result = await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } }, "more work again");
  assert.equal(result.ok, false);
  assert.match(result.error, /3 deep; edit the parent or create a task by hand/);
  assert.deepEqual(h.created, []);
  assert.equal(h.board.tasks[0].decisions, undefined);
  assert.deepEqual(plain(h.backlog), []);
});

test("your answer about work that has since finished is kept on the card without reopening it", async () => {
  for (const status of ["done", "archived"]) {
    const h = issueHost({ tasks: [{ id: "task_1", title: "Add the retry banner", status, logs: [] }] });
    const result = await h.env.assistantIssueAction({ action: "retry", payload: { taskId: "task_1", issueKind: "run-failed" } }, "try it once more");
    assert.deepEqual(plain(result), { ok: true, task: "task_1", decision: "retry", rearmed: false });
    const task = h.board.tasks[0];
    assert.equal(task.status, status);
    assert.equal(task.decisions.at(-1).text, "try it once more");
    assert.match(task.logs.at(-1).text, /You decided: try again — try it once more/);
    assert.deepEqual(plain(h.backlog), [], `a ${status} card is not re-armed`);
    assert.deepEqual(plain(h.wakes), []);
  }
});

test("splitting the extra work out of a card that has since finished still files the follow-up", async () => {
  for (const status of ["done", "archived"]) {
    const h = issueHost();
    // The worker asks mid-run; a scope ask is never settled for the owner.
    const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
    assert.ok(question);
    // The run keeps to its brief and is verified before the owner answers.
    h.board.tasks[0].status = status;
    const answer = await h.env.assistantAnswer({ id: question.id, optionId: "split", text: "the store belongs in its own task" });
    assert.equal(answer.ok, true);
    assert.equal(h.state.questions[0].status, "answered");
    assert.equal(h.state.questions[0].answer.error, undefined);
    assert.equal(h.created.length, 1, `the follow-up is made for a ${status} card`);
    assert.equal(h.created[0].title, "Follow-up: Add the retry banner");
    assert.equal(h.created[0].prompt, "the store belongs in its own task");
    assert.equal(h.created[0].splitFrom, "task_1");
    const task = h.board.tasks[0];
    assert.equal(task.status, status, "the finished card is not reopened");
    assert.equal(task.decisions.at(-1).choice, "split");
    assert.deepEqual(plain(h.backlog), [], "and nothing is re-armed");
    assert.deepEqual(plain(h.wakes), []);
  }
  // Direct, the answer says the card was not re-armed.
  const h = issueHost({ tasks: [{ id: "task_1", title: "Add the retry banner", status: "done", logs: [] }] });
  const result = await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "capability" } });
  assert.deepEqual(plain(result), { ok: true, task: "task_1", decision: "split", rearmed: false });
  assert.equal(h.created.length, 1);
  assert.deepEqual(plain(h.backlog), []);
});

test("holding changes nothing, and an unknown verb changes nothing either", async () => {
  const h = issueHost();
  assert.deepEqual(plain(await h.env.assistantIssueAction({ action: "hold", payload: { taskId: "task_1" } })), { ok: true, held: true });
  assert.equal(h.board.tasks[0].decisions, undefined);
  const unknown = await h.env.assistantIssueAction({ action: "detonate", payload: { taskId: "task_1" } });
  assert.equal(unknown.ok, false);
  assert.deepEqual(plain(h.backlog), []);
});

test("a decision about a task that has left the board is refused, not applied", async () => {
  const h = issueHost({ tasks: [] });
  const result = await h.env.assistantIssueAction({ action: "retry", payload: { taskId: "task_1" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /no longer on the board/);
  assert.deepEqual(plain(h.backlog), []);
});

test("a run that stopped is raised with its own evidence rather than a bare retry", async () => {
  const h = issueHost();
  const question = await h.env.assistantBuildFailureQuestion(
    { title: "Commit the memory-cap telemetry", ref: { id: "task_1", runFailures: 3 } },
    4,
    { outputTail: ["npm test", "FAIL tests/board.test.mjs"], runId: "run_9" },
  );
  assert.ok(question);
  assert.match(question.title, /"Commit the memory-cap telemetry" stopped without finishing/);
  assert.equal(question.context.runId, "run_9");
  assert.deepEqual(plain(question.context.evidence), ["npm test", "FAIL tests/board.test.mjs"]);
  assert.ok(question.options.some((option) => option.id === "replan"));
});

test("a provider outage is not the card's fault: nothing is raised, settled or re-armed", async () => {
  const job = { title: "Commit the memory-cap telemetry", ref: { id: "task_1", runFailures: 1 } };
  for (const evidence of [
    { outputTail: ["npm test", "Error: Usage limit reached for this month"], runId: "run_9" },
    { outputTail: ["\u001b[31mCannot connect to API\u001b[0m"] },
    // A start kill past its grace is charged, unless the provider stopped it.
    { error: "API Error: 429 Too Many Requests", outputTail: [] },
    // Settle's own verdict decides when finish() hands it over.
    { outputTail: ["FAIL tests/board.test.mjs"], providerDown: true },
  ]) {
    const h = issueHost();
    const startFailures = evidence.error ? 5 : 0;
    assert.equal(await h.env.assistantBuildFailureQuestion({ ...job, ref: { ...job.ref, startFailures } }, 2, evidence), null, JSON.stringify(evidence));
    assert.equal(h.state.questions.length, 0);
    assert.deepEqual(plain(h.backlog), []);
    assert.equal(h.board.tasks[0].decisions, undefined, "no automatic answer is recorded either");
  }
  // Only this run's error and last words are read, never a bare provider word
  // or a run that gave its result, and an outage settle charged past its grace
  // is put to triage like any failure.
  for (const evidence of [
    { outputTail: ["Error: Usage limit reached for this month", "npm test", "FAIL tests/board.test.mjs"] },
    { outputTail: ["npm test", "not ok 3 - the rate limiter returns 429 after ten calls"] },
    { outputTail: ["I changed src/usage.js but the quota banner test still fails; stopping here."] },
    { outputTail: ["MEFI_RESULT: done=the view; remaining=the store", "Error: Usage limit reached for this month"] },
    { outputTail: ["You've hit your usage limit"], providerDown: false },
  ]) {
    const h = issueHost();
    const question = await h.env.assistantBuildFailureQuestion({ ...job, ref: { ...job.ref, runFailures: 4 } }, 5, evidence);
    assert.ok(question, JSON.stringify(evidence));
    assert.equal(question.context.issueKind, "run-failed");
    assert.equal(h.state.questions.length, 1);
  }
  // The previous run's error is not this run's: an ordinary failure after an
  // outage still reaches the owner.
  const h = issueHost();
  const question = await h.env.assistantBuildFailureQuestion({ ...job, ref: { ...job.ref, runFailures: 4, lastRunError: "Usage limit reached" } }, 5, { outputTail: ["FAIL tests/board.test.mjs"] });
  assert.ok(question, "an ordinary failure is still raised");
});

test("a provider failure raises no issue and makes no board write or backlog call", async () => {
  // The row as settle leaves it after an outage: requeued on the outage
  // backoff with no attempt charged. Settle owns that bookkeeping; the
  // failure question adds nothing to it, now or later.
  const row = {
    id: "task_1", title: "Commit the memory-cap telemetry", status: "open", runFailures: 4, providerFailures: 1, nextRunAt: 7,
    lastAttempt: { runId: "run_9" }, lastRunError: "Error: Usage limit reached for this month",
    logs: [{ at: 1, kind: "status", text: "provider unavailable (exit 1) · Error: Usage limit reached for this month · requeued in 5m, no attempt charged" }],
  };
  const job = { title: row.title, ref: { id: "task_1", runFailures: 4 } };
  for (const evidence of [
    { outputTail: ["npm test", "Error: Usage limit reached for this month"], runId: "run_9" },
    { outputTail: ["You've hit your usage limit"], runId: "run_9" },
    { outputTail: ["exiting", "Error: Cannot connect to API: Unable to connect. Is the computer able to access the url?"], runId: "run_9" },
    { outputTail: ["FAIL tests/board.test.mjs"], runId: "run_9", providerDown: true },
  ]) {
    const h = issueHost({ tasks: [structuredClone(row)] });
    const writes = [], timers = [];
    const mutate = h.env.mutateBoard;
    h.env.mutateBoard = async (fn) => { writes.push(fn); return mutate(fn); };
    h.env.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
    const untouched = plain(h.board.tasks[0]);
    // The same run reported twice changes nothing either time.
    for (let report = 0; report < 2; report += 1) {
      assert.equal(await h.env.assistantBuildFailureQuestion(job, 5, evidence), null, JSON.stringify(evidence));
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(writes.length, 0, "no board write");
    assert.equal(timers.length, 0, "nothing is scheduled to revisit the row");
    assert.deepEqual(plain(h.backlog), [], "no backlog call");
    assert.equal(h.state.questions.length, 0, "no issue is raised");
    assert.ok(!h.logs.some((line) => line.kind === "issue" || line.kind === "decision"));
    assert.deepEqual(plain(h.board.tasks[0]), untouched);
  }
});

test("a start kill inside its grace is requeued uncharged, so nothing is asked about it", async () => {
  const job = { title: "Commit the memory-cap telemetry", ref: { id: "task_1", runFailures: 4, startFailures: 1 } };
  const h = issueHost();
  assert.equal(await h.env.assistantBuildFailureQuestion(job, 5, { error: "the worker never started", outputTail: [] }), null);
  assert.equal(h.state.questions.length, 0);
  assert.equal(h.board.tasks[0].decisions, undefined);
  // Out of start grace, the same kill is a charged failure and is raised.
  const spent = issueHost();
  const question = await spent.env.assistantBuildFailureQuestion({ ...job, ref: { ...job.ref, startFailures: 5 } }, 5, { error: "the worker never started", outputTail: [] });
  assert.ok(question);
});
