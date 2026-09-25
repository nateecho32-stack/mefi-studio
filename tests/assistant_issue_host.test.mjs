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
import workAdmission from "../scripts/work-admission.cjs";
import executorCore from "../scripts/executor-core.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

function issueHost({ policy = brains.issuePolicyFor(brains.defaultMap()), tasks = [{ id: "task_1", title: "Add the retry banner", status: "open", logs: [] }] } = {}) {
  const state = assistant.emptyState(1000);
  const board = { tasks, requests: [] };
  const logs = [], events = [], shapes = [], backlog = [], created = [], wakes = [], messages = [], replies = [];
  const env = vm.createContext({
    console,
    assistantState: state,
    agentIssues,
    executorCore,
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    assistantLog(kind, text) { logs.push({ kind, text }); return { kind, text }; },
    assistantEmit(event) { events.push(event); },
    saveAssistant: async () => {},
    ensureAssistant: async () => state,
    logError(text) { logs.push({ kind: "error", text }); },
    activeIssuePolicy: async () => policy,
    // The board as the lane reads it before asking and before applying.
    TASKS_PATH: "tasks",
    getEyes: async () => ({ readJson: async () => structuredClone(board.tasks) }),
    mutateBoard: async (fn) => fn(board),
    backlogControl: async (payload) => { backlog.push(payload); return { ok: true }; },
    rememberWorkShape: (taskId, shape) => shapes.push({ taskId, shape }),
    // A split admits its follow-up through the real admission module inside
    // the decision's own board write; `created` records each card admitted.
    workAdmission, projects: { current: () => ({ id: "fixture" }) }, projectRoot: () => "/fixture",
    crypto: { randomBytes: () => ({ toString: () => `split_${created.length + 1}` }) },
    assistantTaskAdmitted: async (task) => { created.push(task); },
    assistantAskForWork: (reason) => wakes.push(reason),
    assistantMessage: async (text) => { messages.push(text); return { ok: true }; },
    // The thread's local status line (answer.apply's announce).
    assistantAppendReply(text, via, intent) { replies.push({ text, via, intent }); return { text, via, intent }; },
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
  return { env, state, board, logs, events, shapes, backlog, created, wakes, messages, replies };
}

// Values that crossed out of the vm carry that realm's prototypes, so they
// are compared by shape rather than by strict identity.
const plain = (value) => JSON.parse(JSON.stringify(value));
// A split adds its follow-up to the board, so the card is found by id.
const card = (h, id = "task_1") => h.board.tasks.find((task) => task.id === id);

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
  const result = await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope", ask: "the store has to be written too" } }, "the store belongs in its own task");
  assert.deepEqual(plain(result), { ok: true, task: "task_1", decision: "split", rearmed: false });
  assert.equal(h.created.length, 1);
  assert.match(h.created[0].title, /Follow-up: Add the retry banner/);
  // A typed note still wins over the ask as the new card's brief.
  assert.equal(h.created[0].prompt, "the store belongs in its own task");
  assert.equal(h.created[0].splitFrom, "task_1");
  assert.equal(h.created[0].splitDepth, 1);
  assert.equal(card(h).decisions.at(-1).choice, "split");
  // The parent is still open, and a split never re-arms it: re-running it
  // wiped its verification budget and its worker only re-verified its work.
  assert.equal(card(h).status, "open");
  assert.deepEqual(plain(h.backlog), []);
  assert.deepEqual(plain(h.wakes), []);
});

test("a split with no note briefs the new card with the ask itself", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the retry store has to be written too", { detail: "the brief only covers the view" }));
  const split = question.options.find((option) => option.id === "split");
  assert.equal(split.action.payload.ask, "the retry store has to be written too");
  assert.equal(split.action.payload.detail, "the brief only covers the view");
  assert.equal((await h.env.assistantAnswer({ id: question.id, optionId: "split" })).ok, true);
  assert.equal(h.created.length, 1);
  const [card] = h.created;
  assert.equal(card.title, "Follow-up: Add the retry banner");
  assert.equal(card.prompt, "the retry store has to be written too — the brief only covers the view\n\n"
    + "Split out of \"Add the retry banner\" (task_1) by the owner: build only this. If it turns out to be something only the owner can do "
    + "(the board, Studio's task store, another session's files), put it under owner: in MEFI_RESULT and finish; do not ask to split it again.");
  // The decision says what it was about, and the log line keeps its wording.
  const task = h.board.tasks.find((row) => row.id === "task_1");
  assert.equal(task.decisions.at(-1).choice, "split");
  assert.equal(task.decisions.at(-1).ask, "the retry store has to be written too");
  assert.equal(task.decisions.at(-1).text, null);
  assert.equal(task.logs.at(-1).text, "You decided: split the extra work out");
  assert.deepEqual(plain(h.backlog), [], "the open parent is not re-armed");
  // A card saved before answers carried their ask keeps the old brief.
  const old = issueHost();
  await old.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } });
  assert.match(old.created[0].prompt, /^Work the agent found while building "Add the retry banner" that its brief did not cover\./);
  assert.equal(old.board.tasks.find((row) => row.id === "task_1").decisions.at(-1).ask, undefined);
});

test("how deep Split may go is the live map's, and a map can turn it off", async () => {
  const base = brains.issuePolicyFor(brains.defaultMap());
  const chained = () => [{ id: "task_1", title: "Follow-up: Add the retry banner", status: "open", splitFrom: "task_0", splitDepth: 1, logs: [] }];
  const one = issueHost({ policy: { ...base, splitDepth: 1 }, tasks: chained() });
  const refused = await one.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope", ask: "more" } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /This follow-up chain is 1 deep; edit the parent or create a task by hand/);
  assert.deepEqual(one.created, []);
  assert.equal(one.board.tasks[0].decisions, undefined, "nothing is recorded for a refused split");
  const off = issueHost({ policy: { ...base, splitDepth: 0 } });
  const none = await off.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } });
  assert.equal(none.ok, false);
  assert.match(none.error, /Split is turned off in the live brain map/);
  assert.deepEqual(off.created, []);
  // A map saved before the setting existed reads as the default three.
  const { splitDepth: _unset, ...legacy } = base;
  const old = issueHost({ policy: legacy, tasks: [{ ...chained()[0], title: "Follow-up 2: Add the retry banner", splitDepth: 2 }] });
  assert.equal((await old.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope" } })).ok, true);
  assert.equal(old.created[0].title, "Follow-up 3: Add the retry banner");
  // A card already at the limit is not offered Split at all.
  const deep = issueHost({ tasks: [{ id: "task_1", title: "Follow-up 3: Add the retry banner", status: "open", splitDepth: 3, logs: [] }] });
  const question = await deep.env.assistantRaiseIssue(workerIssue("scope", "still more than the brief", { taskTitle: "Follow-up 3: Add the retry banner", splitDepth: 3 }));
  assert.deepEqual(question.options.map((option) => option.id), ["narrow", "replan", "hold"]);
  assert.match(question.detail, /Split is not offered: this follow-up chain is already 3 deep/);
});

test("an answer the host refuses is kept on the card with its reason, across a reload", async () => {
  const policy = { ...brains.issuePolicyFor(brains.defaultMap()) };
  const h = issueHost({ policy, tasks: [{ id: "task_1", title: "Follow-up: Add the retry banner", status: "open", splitFrom: "task_0", splitDepth: 1, logs: [] }] });
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too", { taskTitle: "Follow-up: Add the retry banner", splitDepth: 1 }));
  assert.ok(question.options.some((option) => option.id === "split"), "offered while the map allows it");
  // The owner tightens the map before answering.
  policy.splitDepth = 1;
  const answer = await h.env.assistantAnswer({ id: question.id, optionId: "split" });
  assert.equal(answer.ok, false);
  assert.match(h.state.questions[0].answer.error, /This follow-up chain is 1 deep/);
  const reloaded = assistant.normalizeState(JSON.parse(JSON.stringify(h.state)), Date.now());
  assert.match(reloaded.questions[0].answer.error, /This follow-up chain is 1 deep/);
  assert.ok(reloaded.questions[0].answer.error.length <= 200);
  // A success carries no error key at all.
  const ok = issueHost();
  const asked = await ok.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
  await ok.env.assistantAnswer({ id: asked.id, optionId: "narrow" });
  const clean = assistant.normalizeState(JSON.parse(JSON.stringify(ok.state)), Date.now());
  assert.equal("error" in clean.questions[0].answer, false);
});

test("taking care of it yourself is recorded on the card, and nothing is made or re-armed", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "Will you correct the stored acceptance on task_delegate_b4f73d934d18f69906d57de9?", {
    detail: "workers may not rewrite Studio's task store",
  }));
  assert.equal(question.context.issueKind, "owner", "an owner-directed scope ask is filed as the owner's");
  assert.match(question.title, /"Add the retry banner" needs something only you can do/);
  assert.deepEqual(question.options.map((option) => option.id), ["acknowledge", "instruct", "hold"]);
  assert.equal((await h.env.assistantAnswer({ id: question.id, optionId: "acknowledge" })).ok, true);
  const task = h.board.tasks[0];
  assert.equal(task.decisions.at(-1).choice, "acknowledge");
  assert.equal(task.decisions.at(-1).kind, "owner");
  assert.match(task.decisions.at(-1).ask, /^Will you correct the stored acceptance/);
  assert.equal(task.logs.at(-1).text, "You decided: you'll take care of this yourself");
  assert.equal(task.status, "open");
  assert.deepEqual(h.created, []);
  assert.deepEqual(plain(h.backlog), []);
  assert.deepEqual(plain(h.wakes), []);
  const direct = await h.env.assistantIssueAction({ action: "acknowledge", payload: { taskId: "task_1", issueKind: "owner" } });
  assert.deepEqual(plain(direct), { ok: true, task: "task_1", decision: "acknowledge", rearmed: false });
});

test("the same ask from another card waits on the open card, or takes its answer, instead of a new card", async () => {
  const tasks = () => [1, 2, 3].map((n) => ({ id: `task_${n}`, title: `Follow-up ${n}: TESTRUNS append helper`, status: "open", logs: [] }));
  const ask = (n, title, kind = "scope") => workerIssue(kind, title, { taskId: `task_${n}`, taskTitle: `Follow-up ${n}: TESTRUNS append helper` });
  const h = issueHost({ tasks: tasks() });
  const first = await h.env.assistantRaiseIssue(ask(1, "Will you correct the stored acceptance on task_delegate_b4f73d934d18f69906d57de9?"));
  assert.ok(first);
  // Still open: another card's ask about the same card waits on it.
  assert.equal(await h.env.assistantRaiseIssue(ask(2, "May Studio's stored acceptance for task_delegate_b4f73d934d18f69906d57de9 be corrected?")), null);
  assert.equal(h.state.questions.length, 1);
  assert.ok(h.logs.some((row) => row.kind === "issue" && row.text === `already asked on another card (${first.id}) · no new card`));
  assert.equal(h.board.tasks[1].decisions, undefined);
  // Answered: the answer is written onto the next card that asks, as a record.
  await h.env.assistantAnswer({ id: first.id, optionId: "acknowledge" });
  assert.equal(await h.env.assistantRaiseIssue(ask(3, "Workers may not rewrite Studio's task store; will you reword task_delegate_b4f73d934d18f69906d57de9's acceptance?")), null);
  assert.equal(h.state.questions.length, 1, "no new card");
  const task = h.board.tasks[2];
  assert.equal(task.decisions.at(-1).choice, "acknowledge");
  assert.equal(task.decisions.at(-1).text, `already answered on another card (${first.id})`);
  assert.match(task.decisions.at(-1).ask, /^Workers may not rewrite/);
  assert.match(task.logs.at(-1).text, /^Assistant decided: you'll take care of this yourself — already answered on another card/);
  assert.ok(h.logs.some((row) => row.kind === "decision" && row.text.startsWith(`already answered on another card (${first.id})`)));
  assert.deepEqual(plain(h.backlog), []);
  assert.deepEqual(h.created, []);
  // A folded split is a record of it: nothing is split again.
  const s = issueHost({ tasks: tasks() });
  const scoped = await s.env.assistantRaiseIssue(ask(1, "the reader for task_shared_store01 has to be written too"));
  await s.env.assistantAnswer({ id: scoped.id, optionId: "split", text: "the reader is its own card" });
  assert.equal(s.created.length, 1);
  assert.equal(await s.env.assistantRaiseIssue(ask(2, "task_shared_store01 still has no reader")), null);
  assert.equal(s.created.length, 1, "the earlier split is not made again");
  assert.equal(card(s, "task_2").decisions.at(-1).choice, "split");
  assert.match(card(s, "task_2").decisions.at(-1).text, /^already answered on another card \(q_[0-9_]+\): the reader is its own card$/);
  assert.deepEqual(plain(s.backlog), []);
});

test("a map may ask every repeat again, and a grant or a risk is asked on every card", async () => {
  const tasks = () => [1, 2].map((n) => ({ id: `task_${n}`, title: `Card ${n}`, status: "open", logs: [] }));
  const ask = (n, title, kind = "owner", extra = {}) => workerIssue(kind, title, { taskId: `task_${n}`, taskTitle: `Card ${n}`, ...extra });
  const loud = issueHost({ policy: { ...brains.issuePolicyFor(brains.defaultMap()), repeatAsks: "ask" }, tasks: tasks() });
  assert.ok(await loud.env.assistantRaiseIssue(ask(1, "Will you flip task_landing00001 to done?")));
  assert.ok(await loud.env.assistantRaiseIssue(ask(2, "Will you flip task_landing00001 to done?")));
  assert.equal(loud.state.questions.length, 2);
  for (const kind of ["risk", "permission"]) {
    const h = issueHost({ tasks: tasks() });
    const said = "landing task_sibling000001's refactor drops the old table";
    const first = await h.env.assistantRaiseIssue(ask(1, said, kind, { permission: "write-files" }));
    await h.env.assistantAnswer({ id: first.id, optionId: kind === "risk" ? "proceed" : "grant" });
    assert.ok(await h.env.assistantRaiseIssue(ask(2, said, kind, { permission: "write-files" })), `${kind} reaches the owner again`);
    assert.equal(h.board.tasks[1].decisions, undefined, "no answer is carried over");
    assert.equal(h.board.tasks[1].grants, undefined);
  }
});

test("a map that keeps stopped runs out of the decision lane raises nothing for them", async () => {
  const h = issueHost({ policy: { ...brains.issuePolicyFor(brains.defaultMap()), fromFailures: false } });
  const job = { title: "Commit the memory-cap telemetry", ref: { id: "task_1", runFailures: 4 } };
  assert.equal(await h.env.assistantBuildFailureQuestion(job, 5, { outputTail: ["FAIL tests/board.test.mjs"] }), null);
  assert.equal(h.state.questions.length, 0);
  assert.ok(!h.logs.some((row) => row.kind === "issue" || row.kind === "decision"));
  assert.equal(h.board.tasks[0].decisions, undefined);
  // A worker's own ask still reaches the owner.
  assert.ok(await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too")));
});

test("open cards expire after the ask node's hours, as the live rules last said", async () => {
  const h = issueHost({ policy: { ...brains.issuePolicyFor(brains.defaultMap()), expireHours: 2 } });
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
  question.at -= 3 * 60 * 60 * 1000;
  assert.equal(h.env.assistantPruneQuestions(), 1);
  assert.equal(h.state.questions[0].status, "expired");
  // The default map keeps two days.
  const d = issueHost();
  const kept = await d.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
  kept.at -= 3 * 60 * 60 * 1000;
  assert.equal(d.env.assistantPruneQuestions(), 0);
  assert.equal(d.state.questions[0].status, "open");
});

test("with announce on, the thread says what your answer did", async () => {
  const h = issueHost({ policy: { ...brains.issuePolicyFor(brains.defaultMap()), announce: true } });
  await h.env.assistantIssueAction({ action: "split", payload: { taskId: "task_1", issueKind: "scope", ask: "the store" } });
  assert.equal(h.replies.length, 1);
  assert.equal(h.replies[0].text, "Your answer on \"Add the retry banner\": split the extra work out — \"Follow-up: Add the retry banner\" is on the board.");
  assert.equal(h.replies[0].intent, "status");
  await h.env.assistantIssueAction({ action: "acknowledge", payload: { taskId: "task_1", issueKind: "owner" } });
  assert.equal(h.replies.at(-1).text, "Your answer on \"Add the retry banner\": you'll take care of this yourself.");
  // The assistant's own record says nothing, and it is never a chat message.
  await h.env.assistantIssueAction({ action: "retry", payload: { taskId: "task_1", issueKind: "run-failed" } }, "settled", { origin: "assistant" });
  assert.equal(h.replies.length, 2);
  assert.deepEqual(h.messages, []);
  // A map with "Say what changed" off stays quiet (the default map has it on).
  const quiet = issueHost({ policy: { ...brains.issuePolicyFor(brains.defaultMap()), announce: false } });
  await quiet.env.assistantIssueAction({ action: "acknowledge", payload: { taskId: "task_1", issueKind: "owner" } });
  assert.deepEqual(quiet.replies, []);
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
    const task = card(h);
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

test("an issue from a run whose card has left the board is logged, never asked or settled", async () => {
  // A worker moved the card to another project's store while its run went on.
  const h = issueHost({ tasks: [] });
  assert.equal(await h.env.assistantRaiseIssue(workerIssue("owner", "ratify the relocation of the five rows")), null);
  assert.equal(await h.env.assistantRaiseIssue(workerIssue("run-failed", "exit 1", { attempts: 0 })), null);
  assert.equal(h.state.questions.length, 0, "no card the owner could only fail to answer");
  assert.deepEqual(plain(h.backlog), []);
  assert.ok(h.logs.some((row) => row.kind === "issue" && row.text === "its card is no longer on the board · not asked"));
  assert.ok(!h.logs.some((row) => row.kind === "decision"), "nothing is settled on a card that is gone");
});

test("a board that cannot be read never keeps an issue from being asked", async () => {
  const h = issueHost();
  h.env.getEyes = async () => { throw new Error("board locked"); };
  const question = await h.env.assistantRaiseIssue(workerIssue("scope", "the store has to be written too"));
  assert.ok(question, "an unknown board is not a gone card");
  assert.equal(h.state.questions.length, 1);
});

test("answering an ask whose card has since left the board clears it instead of failing", async () => {
  const h = issueHost();
  const question = await h.env.assistantRaiseIssue(workerIssue("owner", "ratify the relocation of the five rows"));
  assert.ok(question);
  h.board.tasks.splice(0);
  const result = await h.env.assistantAnswer({ id: question.id, optionId: "acknowledge" });
  assert.equal(result.ok, false);
  assert.equal(result.gone, true, "the click is told the card is gone, not that the answer broke");
  assert.equal(result.error, "\"Add the retry banner\" is no longer on this board, so this question was cleared.");
  assert.equal(h.state.questions[0].status, "superseded");
  assert.equal(h.state.questions[0].answer, null, "no failed answer is recorded");
  assert.deepEqual(plain(h.backlog), []);
  assert.ok(h.events.some((event) => event.kind === "question" && event.id === question.id && event.status === "superseded"), "the rail hears it closed");
  const again = await h.env.assistantAnswer({ id: question.id, optionId: "acknowledge" });
  assert.equal(again.error, "That question is no longer waiting.");

  // Leaving it for review needs no card: it closes as a dismiss, as before.
  const held = issueHost();
  const ask = await held.env.assistantRaiseIssue(workerIssue("owner", "ratify the relocation of the five rows"));
  held.board.tasks.splice(0);
  assert.equal((await held.env.assistantAnswer({ id: ask.id, optionId: "hold" })).ok, true);
  assert.equal(held.state.questions[0].status, "dismissed");
});

test("a run that stopped is raised with its own evidence rather than a bare retry", async () => {
  const h = issueHost();
  const question = await h.env.assistantBuildFailureQuestion(
    { title: "Commit the memory-cap telemetry", ref: { id: "task_1", runFailures: 4 } },
    5,
    { outputTail: ["npm test", "FAIL tests/board.test.mjs"], runId: "run_9" },
  );
  assert.ok(question);
  assert.match(question.title, /"Commit the memory-cap telemetry" stopped without finishing/);
  assert.equal(question.context.runId, "run_9");
  assert.deepEqual(plain(question.context.evidence), ["npm test", "FAIL tests/board.test.mjs"]);
  assert.ok(question.options.some((option) => option.id === "replan"));
});

test("charged run failures repair automatically until the executor exhausts its retry budget", async () => {
  const job = { title: "Repair the rail", ref: { id: "task_1", runFailures: 0 } };
  for (let attempt = 1; attempt < executorCore.MAX_RUN_FAILURES; attempt += 1) {
    const h = issueHost();
    assert.equal(await h.env.assistantBuildFailureQuestion(job, attempt, { outputTail: ["FAIL rail check"] }), null);
    assert.equal(h.state.questions.length, 0, `attempt ${attempt} stays with the worker`);
  }
  const spent = issueHost();
  assert.ok(await spent.env.assistantBuildFailureQuestion(job, executorCore.MAX_RUN_FAILURES, { outputTail: ["FAIL rail check"] }));
  assert.equal(spent.state.questions.length, 1, "the exhausted task reaches Ask");
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
  assert.match(question.title, /FAIL tests\/board\.test\.mjs/, "and it is named by this run's words");
  assert.doesNotMatch(question.title, /Usage limit/, "not by the error the previous run ended on");
  // This run's own error, when it has one, names it (asked on the fifth
  // charged failure, once the repair retries are spent).
  const killed = await issueHost().env.assistantBuildFailureQuestion(job, 5, { runError: "killed after budget", outputTail: ["still editing"] });
  assert.match(killed.title, /ran past its time budget/, "a host stop reason reads in the owner's words");
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
