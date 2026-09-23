// Duplicate card families, decided once by the owner. The keeper's audit pass
// (scripts/assistant.mjs auditPass) proposes one question per family and
// settles the links the owner made; backlog.workState waits a linked card on
// the card it names; the host (main.cjs) posts the asks, applies the answer
// through the question machinery, and the overseer reports what is waiting on
// the owner.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";
import taskContext from "../scripts/task-context.cjs";
import taskHandoffs from "../scripts/task-handoffs.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
// Values that crossed out of a vm carry that realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const card = (id, title, overrides = {}) => ({ id, title, status: "open", createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY, logs: [], ...overrides });
const pass = (tasks, options = {}) => assistant.auditPass({ tasks, nodeFolders: {}, now: NOW, armedAt: NOW - HOUR, hostCaps: { loopHold: true, duplicateWait: true }, ...options });
const KEY = "full gate rerun on the quiet tree";
// One obligation minted twice: the original and a handoff clone. The board
// lists the clone first; the original is the oldest. The split of the
// original shares the family key but is the extra scope its brief did not
// cover: lineage, never a copy, so it is never asked about or linked.
const family = () => [
  card("task_two", "Full-gate rerun on the quiet tree — follow-up 6c5e94", { createdAt: NOW - 2 * DAY, originalTitle: "Full-gate rerun on the quiet tree" }),
  card("task_one", "Full-gate rerun on the quiet tree", { createdAt: NOW - 3 * DAY, parentTaskId: "task_parent" }),
  card("task_three", "Follow-up: Full-gate rerun on the quiet tree", { createdAt: NOW - DAY, splitFrom: "task_one" }),
  card("task_parent", "Ship the release gate", { status: "done", doneAt: NOW - 4 * DAY }),
];
const pair = (key, overrides = {}) => [card(`task_${key}_a`, `Wire the ${key} panel`, overrides), card(`task_${key}_b`, `Follow-up: Wire the ${key} panel`, overrides)];

// ---- the proposal -------------------------------------------------------------

test("a duplicate family becomes one owner question, keep-the-oldest recommended, and nothing is written", () => {
  const tasks = family();
  const result = pass(tasks);
  assert.equal(result.familyAsks.length, 1);
  const ask = result.familyAsks[0];
  assert.equal(ask.familyKey, KEY);
  assert.equal(ask.source, "family");
  assert.equal(ask.title, "These 2 cards look like the same work");
  assert.deepEqual(ask.context, { severity: "decision", taskId: "task_one", taskTitle: "Full-gate rerun on the quiet tree" });
  assert.equal(ask.detail, [
    '1) "Full-gate rerun on the quiet tree" · open · created 3d ago · from "Ship the release gate"',
    // Titles are clipped so a family of several still fits the ask.
    '2) "Full-gate rerun on the quiet tree — follow-up…" · open · created 2d ago',
  ].join("; "));
  assert.deepEqual(ask.options.map((option) => [option.id, option.label, option.recommended === true]), [
    ["keep-oldest", "Keep the oldest, wait the rest on it", true],
    ["keep-all", "Keep them all", false],
  ]);
  const memberIds = ["task_one", "task_two"];
  assert.deepEqual(ask.options[0].action, { kind: "family", choice: "keep-oldest", familyKey: KEY, keepId: "task_one", memberIds });
  assert.deepEqual(ask.options[1].action, { kind: "family", choice: "keep-all", familyKey: KEY, memberIds });
  assert.deepEqual([result.report.familiesWaiting, result.report.familiesAsked], [1, 1]);
  assert.match(result.text, /1 duplicate family · asked about 1 duplicate family/);
  result.tasks.forEach((row, index) => assert.equal(row, tasks[index], "an ask writes nothing on the board"));
  // A host whose workState cannot wait a linked card is never asked: the
  // family is still counted as waiting for the owner.
  const older = pass(tasks, { hostCaps: { loopHold: true } });
  assert.deepEqual(older.familyAsks, []);
  assert.equal(older.report.familiesWaiting, 1);
  assert.doesNotMatch(older.text, /asked about/);
});

test("a long family lists what fits and counts the rest", () => {
  const tasks = Array.from({ length: 9 }, (_, index) => card(`task_${index}`, `${"Follow-up: ".repeat(index % 2)}Rebuild the booklet from staged sources after the release cut ${index ? `— follow-up ${index}a` : ""}`.trim(), { createdAt: NOW - (10 - index) * DAY, originalTitle: "Rebuild the booklet from staged sources after the release cut" }));
  const [ask] = pass(tasks).familyAsks;
  assert.equal(ask.title, "These 9 cards look like the same work");
  assert.ok(ask.detail.length <= 400, `bounded detail (${ask.detail.length})`);
  assert.match(ask.detail, /; \+\d+ more$/);
  assert.equal(ask.options[0].action.memberIds.length, 9, "the answer still names every card");
  assert.equal(ask.options[0].action.keepId, "task_0");
});

test("a split or a handoff child is its parent's lineage, never asked about as a copy of it", () => {
  // The owner answered an issue ask with "split the extra work out": the
  // follow-up is filed and the parent re-armed.
  const parent = card("task_parent", "Fix the login redirect", { createdAt: NOW - 3 * DAY });
  const split = card("task_split", "Follow-up: Fix the login redirect", { createdAt: NOW - HOUR, splitFrom: "task_parent", splitDepth: 1 });
  const splitted = pass([parent, split]);
  assert.deepEqual(splitted.familyAsks, [], "a split and its parent produce no ask");
  assert.equal(splitted.report.familiesWaiting, 0);
  assert.equal(splitted.report.families, 1, "still reported as a family");
  // A split of the split, and a handoff child delegated by the parent.
  const deeper = card("task_split2", "Follow-up 2: Fix the login redirect", { createdAt: NOW - MIN, splitFrom: "task_split", splitDepth: 2 });
  const child = card("task_child", "Fix the login redirect — follow-up 0a0a0a", { originalTitle: "Fix the login redirect", createdAt: NOW - 2 * HOUR, parentTaskId: "task_parent" });
  assert.deepEqual(pass([parent, split, deeper, child]).familyAsks, []);
  // The parent finished; a later copy of it is not the split's work either.
  const done = { ...parent, status: "done", doneAt: NOW - HOUR };
  const copy = card("task_copy", "Fix the login redirect", { createdAt: NOW - 2 * DAY });
  assert.deepEqual(pass([done, split, copy]).familyAsks, [], "a split is never linked to its parent's copies");
  // Two splits of the same card are asked about together.
  const twin = card("task_twin", "Follow-up: Fix the login redirect", { createdAt: NOW - 30 * MIN, splitFrom: "task_parent", splitDepth: 1 });
  const [twins] = pass([done, split, twin, copy]).familyAsks;
  assert.deepEqual(twins.options[0].action.memberIds, ["task_split", "task_twin"]);
  assert.equal(twins.options[0].action.familyKey, "fix the login redirect#split:task_parent");
});

test("cards from different parents are asked about apart, so keeping the oldest never links across lineages", () => {
  // Two parents each delegated a generic "Add tests" child; the second was
  // renamed because its title collides with the first.
  const parents = [card("p1", "Build the billing export", { status: "done", doneAt: NOW - HOUR }), card("p2", "Build the audio mixer", { status: "done", doneAt: NOW - HOUR })];
  const c1 = card("c1", "Add tests", { originalTitle: "Add tests", parentTaskId: "p1", fromRun: "run_1", handoffId: "handoff_a", createdAt: NOW - 2 * DAY });
  const c2 = card("c2", "Add tests — follow-up bbbbbb", { originalTitle: "Add tests", parentTaskId: "p2", fromRun: "run_2", handoffId: "handoff_b", createdAt: NOW - DAY });
  const apart = pass([...parents, c1, c2]);
  assert.deepEqual(apart.familyAsks, []);
  assert.equal(apart.report.familiesWaiting, 0);
  // A request's children carry no parent card: their runs tell them apart.
  const r1 = { ...c1, parentTaskId: undefined }, r2 = { ...c2, parentTaskId: undefined };
  assert.deepEqual(pass([r1, r2]).familyAsks, []);
  // Cards with no lineage of their own are still asked about, together.
  const x = card("x", "Add tests", { createdAt: NOW - 4 * DAY }), y = card("y", "Follow-up: Add tests", { createdAt: NOW - 3 * DAY });
  const [loose] = pass([...parents, c1, c2, x, y]).familyAsks;
  assert.deepEqual(loose.options[0].action.memberIds, ["x", "y"]);
  assert.equal(loose.options[0].action.familyKey, "add tests#");
  // One parent: a copy with no lineage is asked about with its child.
  const [one] = pass([parents[0], c1, x]).familyAsks;
  assert.deepEqual([one.options[0].action.familyKey, one.options[0].action.memberIds], ["add tests", ["x", "c1"]]);
});

test("the card kept is the oldest that can run; a family that is all held or parked is not asked about", () => {
  const loopGuard = { v: 1, at: NOW - DAY, kind: "attempts", count: 4, reason: "no attributable edits", remedy: "x", by: "keeper" };
  const held = card("old", "Fix the flaky export check", { createdAt: NOW - 4 * DAY, loopGuard });
  const fresh = card("fresh", "Fix the flaky export check — follow-up 9f9f9f", { originalTitle: "Fix the flaky export check", createdAt: NOW - DAY });
  const [ask] = pass([held, fresh]).familyAsks;
  assert.equal(ask.options[0].action.keepId, "fresh");
  assert.equal(ask.options[0].label, "Keep the oldest that can run, wait the rest on it");
  assert.equal(ask.options[0].recommended, true);
  assert.equal(ask.context.taskId, "fresh");
  assert.match(ask.detail, /^1\) "Fix the flaky export check" · open · held by the loop guard · created 4d ago; 2\) /);
  for (const park of [{ verification: { state: "failed", reason: "no evidence" } }, { verifyAttempts: 3 }, { runFailures: 5 }]) {
    const [parked] = pass([card("old", "Rebuild the icon atlas", { createdAt: NOW - 4 * DAY, ...park }), card("new", "Follow-up: Rebuild the icon atlas", { createdAt: NOW - DAY })]).familyAsks;
    assert.equal(parked.options[0].action.keepId, "new", JSON.stringify(park));
    assert.match(parked.detail, /· open · parked · /);
  }
  const allHeld = pass([held, { ...fresh, loopGuard }]);
  assert.deepEqual(allHeld.familyAsks, [], "nothing can run: Try again comes first");
  assert.equal(allHeld.report.familiesWaiting, 0);
});

test("a family is not asked about while a member is busy, once decided, or while its ask is open; two asks a pass", () => {
  for (const busy of [{ status: "active" }, { status: "awaiting_verification" }, { status: "verifying" }, { absorbedInto: "plan_1" }, { runId: "run_1" }, { lease: { pid: 1 } }]) {
    const tasks = family();
    tasks[0] = { ...tasks[0], ...busy };
    const result = pass(tasks);
    assert.deepEqual(result.familyAsks, [], `busy member ${JSON.stringify(busy)}`);
    assert.equal(result.report.familiesWaiting, 0);
  }
  const decided = family().map((task) => (task.id === "task_parent" ? task : { ...task, familyDecision: { at: NOW - HOUR, choice: "keep-all", keepId: null } }));
  assert.deepEqual(pass(decided).familyAsks, [], "a decided family is never asked again");
  assert.equal(pass(decided).report.familiesWaiting, 0);
  const openAsk = { id: "q_family", status: "open", source: "family", title: "These 3 cards look like the same work", options: [{ id: "keep-all", label: "Keep them all", action: { kind: "family", choice: "keep-all", familyKey: KEY, memberIds: ["task_one", "task_two", "task_three"] } }] };
  const asked = pass(family(), { questions: [openAsk] });
  assert.deepEqual(asked.familyAsks, [], "an open ask is not repeated");
  assert.equal(asked.report.familiesWaiting, 1, "the family still waits for the owner");
  assert.deepEqual(asked.supersedeQuestionIds, []);
  // An ask that expired unanswered decided nothing: the family is asked again.
  assert.equal(pass(family(), { questions: [{ ...openAsk, status: "expired" }] }).familyAsks.length, 1);
  const many = pass([...pair("delta"), ...pair("alpha"), ...pair("gamma"), ...pair("beta")]);
  assert.equal(many.report.familiesWaiting, 4);
  assert.deepEqual(many.familyAsks.map((ask) => ask.familyKey), ["wire the alpha panel", "wire the beta panel"], "two new asks a pass, in key order");
  assert.match(many.text, /asked about 2 duplicate families/);
});

test("after keep-the-oldest, a new copy is asked about with the kept card, never with the linked ones", () => {
  const decision = { at: NOW - DAY, choice: "keep-oldest", keepId: "task_one" };
  const linked = family().map((task) => {
    if (task.id === "task_parent") return task;
    return task.id === "task_one" ? { ...task, familyDecision: decision } : { ...task, familyDecision: decision, duplicateOf: "task_one" };
  });
  const settled = pass(linked);
  assert.deepEqual(settled.familyAsks, [], "a family whose copies all wait on the kept card is settled");
  assert.equal(settled.report.familiesWaiting, 0);
  assert.equal(settled.report.families, 1, "it is still reported as a family");
  const fresh = card("task_four", "Follow-up 2: Full-gate rerun on the quiet tree", { createdAt: NOW - HOUR });
  const [ask] = pass([...linked, fresh]).familyAsks;
  assert.equal(ask.title, "These 2 cards look like the same work");
  assert.deepEqual(ask.options[0].action.memberIds, ["task_one", "task_four"]);
  assert.equal(ask.options[0].action.keepId, "task_one");
});

test("a family ask is superseded once fewer than two of its cards are still open", () => {
  const ask = (id, memberIds) => ({ id, status: "open", source: "family", title: "These cards look like the same work", options: [{ id: "keep-oldest", label: "Keep the oldest, wait the rest on it", action: { kind: "family", choice: "keep-oldest", familyKey: "k", keepId: memberIds[0], memberIds } }] });
  const tasks = [card("task_a", "Draw the tide pool"), card("task_b", "Follow-up: Draw the tide pool"), card("task_c", "Draw the tide pool — follow-up 1a", { status: "done", doneAt: NOW }), card("task_d", "Other", { status: "archived" })];
  const result = pass(tasks, { questions: [ask("q_live", ["task_a", "task_b"]), ask("q_done", ["task_a", "task_c"]), ask("q_gone", ["task_x", "task_y"]), ask("q_archived", ["task_b", "task_d"]), { ...ask("q_answered", ["task_x", "task_y"]), status: "answered" }] });
  assert.deepEqual(result.supersedeQuestionIds, ["q_done", "q_gone", "q_archived"]);
  assert.equal(result.report.questionsSuperseded, 3);
});

// ---- the keeper settles the owner's links --------------------------------------

test("a linked duplicate closes as its original's completion, and a parent waiting on it resolves", () => {
  const original = card("task_orig", "Wire the retry banner", { status: "done", doneAt: NOW - HOUR, verification: { state: "verified" } });
  const dup = card("task_dup", "Follow-up: Wire the retry banner", { duplicateOf: "task_orig", familyDecision: { at: NOW - DAY, choice: "keep-oldest", keepId: "task_orig" } });
  const parent = card("task_parent", "Ship the banner", { status: "awaiting_verification", delegation: { version: 1, childTaskIds: ["task_dup"] } });
  const tasks = [original, dup, parent];
  assert.equal(backlog.workState(parent, NOW, { tasks }).stage, "waiting", "the parent waits on its handoff child");
  const result = pass(tasks);
  const closed = result.tasks[1];
  assert.equal(closed.status, "archived");
  assert.equal(closed.completionFromTaskId, "task_orig");
  assert.equal(closed.doneAt, NOW);
  assert.equal(closed.updatedAt, NOW);
  assert.equal(closed.logs.at(-1).text, 'closed as a duplicate of "Wire the retry banner" (you linked them)');
  assert.deepEqual(closed.familyDecision, dup.familyDecision);
  assert.ok(backlog.completedTask(closed), "backlog reads it as completed work");
  assert.equal(backlog.workState(parent, NOW, { tasks: result.tasks }).stage, "review", "the parent's handoff resolves through completedTask");
  assert.equal(result.report.duplicatesClosed, 1);
  assert.match(result.text, /closed 1 duplicate card/);
  assert.equal(result.tasks[0], original);
  assert.equal(result.tasks[2], parent);
  const again = pass(result.tasks);
  again.tasks.forEach((row, index) => assert.equal(row, result.tasks[index], "a second pass changes nothing"));
  assert.equal(again.report.duplicatesClosed, 0);
});

test("a chain of links settles in one pass; a card a worker holds is left until it settles", () => {
  const done = card("task_a", "Draw the tide pool", { status: "archived", doneAt: NOW - HOUR });
  // Listed before the card it waits on: the chain still closes in one pass.
  const c = card("task_c", "Draw the tide pool — follow-up 2b", { duplicateOf: "task_b" });
  const b = card("task_b", "Follow-up: Draw the tide pool", { duplicateOf: "task_a" });
  const running = card("task_r", "Follow-up 2: Draw the tide pool", { status: "active", duplicateOf: "task_a" });
  const result = pass([c, done, b, running]);
  assert.deepEqual(result.tasks.map((task) => [task.id, task.status, task.completionFromTaskId ?? null]), [["task_c", "archived", "task_b"], ["task_a", "archived", null], ["task_b", "archived", "task_a"], ["task_r", "active", null]]);
  assert.equal(result.tasks[3], running);
  assert.equal(result.report.duplicatesClosed, 2);
  const again = pass(result.tasks);
  again.tasks.forEach((row, index) => assert.equal(row, result.tasks[index]));
});

test("a link to a card that left the board or was archived unfinished is dropped, and the card runs", () => {
  const shelved = card("task_shelved", "Draw the tide pool", { status: "archived" });
  const orphan = card("task_orphan", "Follow-up: Draw the tide pool", { duplicateOf: "task_deleted", familyDecision: { at: NOW - DAY, choice: "keep-oldest", keepId: "task_deleted" } });
  const stranded = card("task_stranded", "Draw the tide pool — follow-up 1a", { duplicateOf: "task_shelved" });
  const result = pass([shelved, orphan, stranded]);
  const [, freed, loose] = result.tasks;
  assert.equal(freed.duplicateOf, undefined);
  assert.equal(freed.logs.at(-1).text, "duplicate link dropped — the card it waited for is gone; this card runs on its own");
  assert.deepEqual(freed.familyDecision, orphan.familyDecision, "the decision stays: the family is not asked again");
  assert.equal(loose.duplicateOf, undefined);
  assert.equal(loose.logs.at(-1).text, 'duplicate link dropped — "Draw the tide pool" was archived unfinished; this card runs on its own');
  assert.equal(freed.status, "open");
  assert.equal(result.report.duplicateLinksDropped, 2);
  assert.match(result.text, /dropped 2 duplicate links/);
  for (const row of [freed, loose]) assert.equal(backlog.workState(row, NOW, { tasks: result.tasks }).stage, "ready");
});

// ---- backlog: the wait and Run anyway -------------------------------------------

test("workState waits a linked card on the card it names, and nothing else", () => {
  const original = card("task_orig", "Wire the retry banner");
  const dup = card("task_dup", "Follow-up: Wire the retry banner", { duplicateOf: "task_orig" });
  const tasks = [original, dup];
  const waiting = backlog.workState(dup, NOW, { tasks });
  assert.deepEqual(waiting, { stage: "waiting", blockedBy: "duplicate", reason: "Waiting for Wire the retry banner (the same work)", duplicateOf: "task_orig" });
  assert.equal(waiting.canRetry, undefined, "Run anyway goes through retry");
  const summary = backlog.summarizeBacklog({ tasks, now: NOW });
  assert.deepEqual([summary.counts.ready, summary.counts.waiting], [1, 1]);
  assert.deepEqual(summary.next.map((row) => row.id), ["task_orig"]);
  assert.equal(backlog.workState(dup, NOW).stage, "ready", "without the board the link is not read");
  assert.equal(backlog.workState({ ...dup, status: "active" }, NOW, { tasks }).stage, "running", "a worker's card keeps running");
  // The original is done but the keeper has not closed this card yet: it
  // still waits, so no worker picks the same work up in between.
  const finished = backlog.workState(dup, NOW, { tasks: [{ ...original, status: "done" }, dup] });
  assert.deepEqual([finished.stage, finished.blockedBy, finished.reason], ["waiting", "duplicate", "Wire the retry banner is done; this card closes as the same work"]);
  for (const [label, board] of [
    ["the original left the board", [dup]],
    ["the original was archived unfinished", [{ ...original, status: "archived" }, dup]],
  ]) assert.equal(backlog.workState(dup, NOW, { tasks: board }).stage, "ready", label);
  assert.equal(backlog.workState({ ...dup, duplicateOf: "task_dup" }, NOW, { tasks }).stage, "ready", "a card never waits on itself");
  const a = card("task_a", "Ring A", { duplicateOf: "task_b" });
  const b = card("task_b", "Ring B", { duplicateOf: "task_a" });
  assert.deepEqual([a, b].map((row) => backlog.workState(row, NOW, { tasks: [a, b] }).stage), ["ready", "ready"], "a ring of links never waits forever");
  const c = card("task_c", "Chain C", { duplicateOf: "task_dup" });
  assert.equal(backlog.workState(c, NOW, { tasks: [...tasks, c] }).reason, "Waiting for Follow-up: Wire the retry banner (the same work)");
});

test("a link never masks the card's own park, and a wait on a blocked card is blocked, so a handoff parent sees it", () => {
  const loopGuard = { v: 1, at: NOW - DAY, kind: "attempts", count: 4, reason: "no attributable edits", remedy: "Give it a named check.", by: "keeper" };
  const original = card("task_orig", "Fix the flaky export check");
  const dup = card("task_dup", "Fix the flaky export check — follow-up 9f9f9f", { originalTitle: "Fix the flaky export check", duplicateOf: "task_orig", parentTaskId: "task_parent", fromRun: "run_p", handoffId: "handoff_1" });
  for (const own of [{ verification: { state: "failed" }, verifyAttempts: 3 }, { runFailures: 5 }, { loopGuard }]) {
    const state = backlog.workState({ ...dup, ...own }, NOW, { tasks: [original, dup] });
    assert.equal(state.stage, "blocked", JSON.stringify(own));
    assert.notEqual(state.blockedBy, "duplicate", "the card's own hold names the cause");
  }
  const heldOriginal = { ...original, loopGuard };
  const parent = card("task_parent", "Ship the exporter", {
    status: "awaiting_verification", remaining: ["Fix the flaky export check"],
    lastAttempt: { runId: "run_p", handoffs: [{ handoffId: "handoff_1", fromRun: "run_p", title: "Fix the flaky export check", originalTitle: "Fix the flaky export check", prompt: "x" }] },
  });
  const tasks = [heldOriginal, dup, parent];
  const blocked = backlog.workState(dup, NOW, { tasks });
  assert.equal(blocked.stage, "blocked");
  assert.equal(blocked.blockedBy, "duplicate");
  assert.equal(blocked.duplicateOf, "task_orig");
  assert.match(blocked.reason, /^Waiting for Fix the flaky export check \(the same work\), which is blocked: Loop guard: 4 attempts .*Give it a named check\.$/);
  const handoff = taskHandoffs.reconcileTaskHandoffs({ tasks, requests: [], now: NOW }).tasks.find((row) => row.id === "task_parent").handoffState;
  assert.deepEqual([handoff.state, handoff.blocked], ["blocked", 1], "the parent flags its child for review");
  const waiting = taskHandoffs.reconcileTaskHandoffs({ tasks: [original, dup, parent], requests: [], now: NOW }).tasks.find((row) => row.id === "task_parent").handoffState;
  assert.deepEqual([waiting.state, waiting.blocked], ["waiting", 0], "a runnable original is only waited on");
  // A chain: waiting on a card that waits on a held card is blocked too.
  const chained = card("task_c", "Follow-up: Fix the flaky export check", { duplicateOf: "task_dup" });
  assert.equal(backlog.workState(chained, NOW, { tasks: [heldOriginal, dup, chained] }).stage, "blocked");
  assert.equal(backlog.workState(chained, NOW, { tasks: [original, dup, chained] }).stage, "waiting");
});

test("retryTask drops the link and keeps the decision; neither field voids an approval or makes a revision", () => {
  const decision = { at: NOW - DAY, choice: "keep-oldest", keepId: "task_orig" };
  const dup = card("task_dup", "Follow-up: Wire the retry banner", { duplicateOf: "task_orig", familyDecision: decision });
  const retried = backlog.retryTask(dup, NOW);
  assert.equal(retried.duplicateOf, undefined);
  assert.deepEqual(retried.familyDecision, decision);
  assert.equal(backlog.workState(retried, NOW, { tasks: [card("task_orig", "Wire the retry banner"), retried] }).stage, "ready");
  const plainCard = card("task_x", "Wire the retry banner", { prompt: "Add the banner" });
  const approved = { ...plainCard, buildApproval: { version: 1, scope: backlog.buildScope(plainCard), approvedAt: NOW } };
  assert.ok(backlog.hasBuildApproval({ ...approved, duplicateOf: "task_orig", familyDecision: decision }), "a link voids no build approval");
  assert.deepEqual(taskContext.snapshotTask({ ...plainCard, duplicateOf: "task_orig", familyDecision: decision }), taskContext.snapshotTask(plainCard), "neither field is in the task-context snapshot");
});

// ---- the host: Run anyway through the real board gateway -------------------------

function gatewayHost({ tasks = [] } = {}) {
  let board = { tasks: plain(tasks), requests: [], ideas: [] };
  let chain = Promise.resolve();
  const state = { ...assistant.emptyState(NOW), status: "paused", projectId: "project-a" };
  const autopilot = { jobs: [], execute: false, parkedUntil: 0 };
  const project = { id: "project-a", path: "C:/fixture" };
  const logs = [], emitted = [];
  const eyes = { readJson: async (key) => plain(board[key]), writeJson: async (key, value) => { board[key] = plain(value); } };
  const env = vm.createContext({
    Date, console, backlog, taskContext, structuredClone, assistantState: state, autopilot,
    projects: { current: () => project, open: () => project }, projectRoot: () => project.path,
    TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas",
    getAssistant: async () => assistant, getEyes: async () => eyes, machineLagGate: null,
    ensureAssistant: async () => state, withBoardLock: (fn) => {
      const run = chain.then(fn); chain = run.catch(() => {}); return run;
    }, send: () => {},
    compareWork: (a, b) => (a.createdAt ?? a.at ?? 0) - (b.createdAt ?? b.at ?? 0),
    workTitleKey: (value) => String(value ?? "").toLowerCase(),
    assistantLog: (kind, text) => logs.push({ kind, text }), assistantAskForWork: (reason) => logs.push({ kind: "ask", text: reason }),
    setAutopilot: async (patch) => Object.assign(autopilot, patch),
    autopilotHousekeeping: async () => {}, classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => {},
    refreshAutopilotQueue: async () => {}, emitAutopilot: () => {},
    // The question machinery around the answer.
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    assistantEmit: (event) => emitted.push(plain(event)),
    saveAssistant: async () => {},
    logError: (text) => logs.push({ kind: "error", text }),
    assistantMessage: async () => ({ ok: true }),
  });
  vm.runInContext(section("const isThenable =", "// Drop a claim this run still owns."), env);
  vm.runInContext(section("function queuedWorkCount(", "function workTitleKey("), env);
  vm.runInContext(section("// ---- agent issues", "async function assistantSetPrefs("), env);
  return { env, state, logs, emitted, board: () => plain(board) };
}

test("Run anyway is the retry path: it drops the link and the card is ready", async () => {
  const h = gatewayHost({ tasks: [card("task_orig", "Wire the retry banner"), card("task_dup", "Follow-up: Wire the retry banner", { duplicateOf: "task_orig", familyDecision: { at: NOW, choice: "keep-oldest", keepId: "task_orig" } })] });
  const status = await h.env.backlogStatus();
  assert.equal(status.counts.waiting, 1);
  const row = status.taskStates.find((entry) => entry.id === "task_dup");
  assert.deepEqual([row.stage, row.blockedBy, row.duplicateOf], ["waiting", "duplicate", "task_orig"]);
  assert.equal((await h.env.backlogControl({ action: "retry", taskId: "task_dup" })).ok, true);
  const saved = h.board().tasks[1];
  assert.equal(saved.duplicateOf, undefined);
  assert.equal(saved.familyDecision.choice, "keep-oldest");
  assert.equal(backlog.workState(saved, Date.now(), { tasks: h.board().tasks }).stage, "ready");
});

test("the owner's keep-the-oldest answer links the copies to the kept card and stamps every member", async () => {
  const tasks = [...family(), card("task_four", "Follow-up 2: Full-gate rerun on the quiet tree", { createdAt: NOW - DAY }), card("task_gone_done", "Full-gate rerun on the quiet tree — follow-up 99", { createdAt: NOW - 12 * HOUR })];
  const [ask] = pass(tasks).familyAsks;
  assert.deepEqual(ask.options[0].action.memberIds, ["task_one", "task_two", "task_four", "task_gone_done"], "oldest first, the split left out");
  // Meanwhile one copy finished on its own.
  const board = tasks.map((task) => (task.id === "task_gone_done" ? { ...task, status: "done", doneAt: NOW } : task));
  const h = gatewayHost({ tasks: board });
  const question = h.env.assistantQuestion(ask);
  assert.equal(question.source, "family");
  assert.equal(question.options[0].action.kind, "family");
  const kept = h.board().tasks.find((task) => task.id === "task_one");
  const answered = await h.env.assistantAnswer({ id: question.id, optionId: "keep-oldest" });
  assert.equal(answered.ok, true);
  assert.equal(h.state.questions[0].status, "answered");
  const after = Object.fromEntries(h.board().tasks.map((task) => [task.id, task]));
  for (const id of ["task_one", "task_two", "task_four", "task_gone_done"]) assert.deepEqual(Object.keys(after[id].familyDecision).sort(), ["at", "choice", "keepId"], `${id} is stamped`);
  assert.deepEqual([after.task_one.familyDecision.choice, after.task_one.familyDecision.keepId], ["keep-oldest", "task_one"]);
  assert.equal(after.task_one.duplicateOf, undefined, "the kept card waits on nothing");
  assert.deepEqual(taskContext.snapshotTask(after.task_one), taskContext.snapshotTask(kept), "the kept card's stamp is no revision");
  assert.deepEqual([after.task_three.familyDecision, after.task_three.duplicateOf], [undefined, undefined], "the split is neither stamped nor linked");
  for (const id of ["task_two", "task_four"]) {
    assert.equal(after[id].duplicateOf, "task_one");
    assert.equal(after[id].logs.at(-1).text, 'You decided: the same work as "Full-gate rerun on the quiet tree" — this card waits for it and closes when it is done');
    assert.equal(backlog.workState(after[id], NOW, { tasks: Object.values(after) }).blockedBy, "duplicate");
  }
  assert.equal(after.task_gone_done.duplicateOf, undefined, "finished work is stamped, never linked");
  assert.equal(after.task_parent.familyDecision, undefined, "only the family's cards are stamped");
  assert.ok(h.logs.some((row) => row.kind === "decision" && row.text === 'kept "Full-gate rerun on the quiet tree" · 2 duplicate cards wait on it'));
});

test("keep-them-all stamps only; an answer whose kept card is gone is refused and reported", async () => {
  const [ask] = pass(family()).familyAsks;
  const all = gatewayHost({ tasks: family() });
  const question = all.env.assistantQuestion(ask);
  assert.equal((await all.env.assistantAnswer({ id: question.id, optionId: "keep-all" })).ok, true);
  const rows = all.board().tasks.filter((task) => task.id === "task_one" || task.id === "task_two");
  assert.ok(rows.every((task) => task.familyDecision?.choice === "keep-all" && task.familyDecision.keepId === null && task.duplicateOf === undefined && task.logs.length === 0));
  assert.equal(all.board().tasks.find((task) => task.id === "task_three").familyDecision, undefined, "the split was never part of the ask");
  assert.deepEqual(pass(all.board().tasks).familyAsks, [], "a decided family is not asked again");
  const gone = gatewayHost({ tasks: family().filter((task) => task.id !== "task_one") });
  const stale = gone.env.assistantQuestion(ask);
  const refused = await gone.env.assistantAnswer({ id: stale.id, optionId: "keep-oldest" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "The card to keep is no longer on the board.");
  assert.equal(gone.state.questions[0].answer.error, "The card to keep is no longer on the board.");
  assert.ok(gone.board().tasks.every((task) => task.familyDecision === undefined && task.duplicateOf === undefined), "nothing is written");
  const bogus = await gone.env.assistantFamilyAction({ kind: "family", choice: "merge", memberIds: ["task_two", "task_three"] });
  assert.equal(bogus.ok, false);
});

test("a typed answer to a family ask decides nothing: the ask stays open for one of its options", async () => {
  const [ask] = pass(family()).familyAsks;
  const h = gatewayHost({ tasks: family() });
  const sent = [];
  h.env.assistantMessage = async (text) => { sent.push(text); return { ok: true }; };
  const question = h.env.assistantQuestion(ask);
  const typed = await h.env.assistantAnswer({ id: question.id, optionId: null, text: "these are different, leave them" });
  assert.equal(typed.ok, false);
  assert.equal(typed.error, "Choose Keep the oldest or Keep them all: a typed answer cannot decide which cards are the same work.");
  assert.deepEqual([h.state.questions[0].status, h.state.questions[0].answer], ["open", null]);
  assert.deepEqual(sent, [], "nothing goes to the chat responder");
  assert.ok(h.board().tasks.every((task) => task.familyDecision === undefined && task.duplicateOf === undefined), "nothing is written");
  // Still open, so the next keeper pass does not ask again; an option decides.
  assert.deepEqual(pass(h.board().tasks, { questions: h.state.questions }).familyAsks, []);
  assert.equal((await h.env.assistantAnswer({ id: question.id, optionId: "keep-all" })).ok, true);
  assert.deepEqual(pass(h.board().tasks, { questions: h.state.questions }).familyAsks, [], "decided");
  // Any other ask still takes typed words.
  const other = h.env.assistantQuestion({ title: "Pick one", source: "assistant", options: [{ id: "a", label: "A" }] });
  assert.equal((await h.env.assistantAnswer({ id: other.id, optionId: null, text: "neither" })).ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, ["neither"]);
});

test("Work on it on a linked card drops the link, keeps the decision and pins the card", async () => {
  const decision = { at: NOW, choice: "keep-oldest", keepId: "task_orig" };
  const h = executorHost({ paused: true, tasks: [card("task_orig", "Wire the retry banner", { prompt: "Add the banner" }), card("task_dup", "Follow-up: Wire the retry banner", { prompt: "Add the banner", duplicateOf: "task_orig", familyDecision: decision })] });
  h.state.messages = [];
  let sequence = 0;
  Object.assign(h.env, {
    assistantFocus: async () => {},
    assistantMessageId: () => `message-${++sequence}`,
    assistantCaps: () => ({ messages: 100 }),
    assistantTrim: (rows, limit) => rows.splice(0, Math.max(0, rows.length - limit)),
    assistantAppendReply: (text) => ({ id: `message-${++sequence}`, role: "assistant", text }),
  });
  vm.runInContext(section("async function assistantWorkOn(", "// A tree click hands the assistant"), h.env);
  assert.equal(h.env.backlog.workState(h.board().tasks[1], h.now(), { tasks: h.board().tasks }).blockedBy, "duplicate");
  const result = await h.env.assistantWorkOn({ kind: "task", id: "task_dup", label: "Follow-up: Wire the retry banner" });
  assert.equal(result.ok, true);
  const task = h.board().tasks[1];
  assert.equal(task.duplicateOf, undefined, "the owner's ask overrides the link");
  assert.deepEqual(task.familyDecision, decision, "the family is not asked about again");
  assert.equal(task.pin, true);
  assert.equal(task.logs.at(-1).text, "pinned — work on it · duplicate link dropped, it runs on its own");
  assert.equal(h.env.backlog.workState(task, h.now(), { tasks: h.board().tasks }).stage, "ready");
});

// ---- the host: the keeper posts the asks and closes the duplicates ---------------

function keeperHost({ tasks = [], backlogModule = backlog } = {}) {
  let state = { ...assistant.emptyState(NOW - HOUR), projectId: "project-a" };
  state.housekeeping = { ...state.housekeeping, loopArmedAt: NOW - 3 * HOUR };
  let board = { tasks: plain(tasks), requests: [], ideas: [] };
  const logs = [], errors = [];
  const env = vm.createContext({
    console,
    assistantState: state,
    assistantCache: { store: null, audit: null, duplicateScan: null },
    projects: { current: () => ({ id: "project-a" }) },
    backlog: backlogModule,
    taskContext,
    consumeReviewedTaskGroups: async () => {},
    getAssistant: async () => assistant,
    getEyes: async () => ({ readJson: async (_key, fallback) => fallback, writeJson: async () => {} }),
    CHECKPOINTS_PATH: "checkpoints",
    // A synchronous mutator, then the awaited write; a refused mutation
    // (ok: false) writes nothing, as in the real gateway.
    mutateBoard: async (mutator) => {
      const working = structuredClone(board);
      const patch = mutator(working) ?? {};
      if (patch.ok === false) return patch;
      const next = { tasks: patch.tasks ?? working.tasks, requests: patch.requests ?? working.requests, ideas: patch.ideas ?? working.ideas };
      const written = ["tasks", "requests", "ideas"].filter((key) => JSON.stringify(next[key]) !== JSON.stringify(board[key]));
      board = structuredClone(next);
      await Promise.resolve();
      return { ...patch, ...next, written };
    },
    send() {},
    assistantLog: (kind, text) => logs.push({ kind, text }),
    logError: (text) => errors.push(text),
    assistantEmit: () => {},
    assistantVisit: async () => {},
    taskTarget: (id) => ({ kind: "task", id: `task:${id}` }),
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    FOLDED_NODE: { kind: "folded", id: "__folded__" },
    assistantCaps: () => assistant.CAPS,
    assistantTrim(list, cap) { if (list.length > cap) list.splice(0, list.length - cap); },
    saveAssistant: async () => {},
    ensureAssistant: async () => env.assistantState,
    assistantMessage: async () => ({ ok: true }),
  });
  vm.runInContext([
    section("async function assistantKeeperJob(", "// Structural equality for plain JSON state"),
    section("// Structural equality for plain JSON state", "// briefer:"),
    section("// ---- agent issues", "async function assistantSetPrefs("),
  ].join("\n"), env);
  return {
    env, logs, errors,
    get state() { return env.assistantState; },
    board: () => structuredClone(board),
    setBoard(fn) { board = fn(structuredClone(board)); },
    run: () => env.assistantKeeperJob(NOW, null),
  };
}

test("the keeper asks once per family, the answer links, and the copies close when the kept card is done", async () => {
  const h = keeperHost({ tasks: family() });
  await h.run();
  assert.deepEqual(h.errors, []);
  const asks = h.state.questions.filter((question) => question.source === "family");
  assert.equal(asks.length, 1);
  assert.equal(asks[0].title, "These 2 cards look like the same work");
  assert.equal(asks[0].status, "open");
  assert.equal(h.state.housekeeping.familiesWaiting, 1);
  assert.match(h.state.housekeeping.lastText, /asked about 1 duplicate family/);
  assert.ok(h.logs.some((row) => row.kind === "question" && row.text === "asked: These 2 cards look like the same work"));
  await h.run();
  assert.equal(h.state.questions.filter((question) => question.source === "family").length, 1, "an open ask is never repeated");
  assert.equal((await h.env.assistantAnswer({ id: asks[0].id, optionId: "keep-oldest" })).ok, true);
  await h.run();
  assert.equal(h.state.housekeeping.familiesWaiting, 0, "decided");
  assert.equal(h.state.questions.filter((question) => question.source === "family").length, 1);
  assert.deepEqual(h.board().tasks.map((task) => [task.id, task.status]), [["task_two", "open"], ["task_one", "open"], ["task_three", "open"], ["task_parent", "done"]], "the copies wait; nothing is closed yet");
  h.setBoard((board) => ({ ...board, tasks: board.tasks.map((task) => (task.id === "task_one" ? { ...task, status: "done", doneAt: NOW - MIN, verification: { state: "verified" } } : task)) }));
  await h.run();
  const rows = Object.fromEntries(h.board().tasks.map((task) => [task.id, task]));
  assert.deepEqual([rows.task_two.status, rows.task_two.completionFromTaskId, rows.task_two.doneAt], ["archived", "task_one", NOW]);
  assert.equal(rows.task_two.logs.at(-1).text, 'closed as a duplicate of "Full-gate rerun on the quiet tree" (you linked them)');
  assert.deepEqual([rows.task_three.status, rows.task_three.completionFromTaskId], ["open", undefined], "the split's own work is still to do");
  assert.equal(backlog.workState(rows.task_three, NOW, { tasks: Object.values(rows) }).stage, "ready");
  assert.match(h.state.housekeeping.lastText, /closed 1 duplicate card/);
  assert.equal(h.state.questions.filter((question) => question.source === "family").length, 1, "nothing left to ask");
});

test("a host without the duplicate wait asks nothing, and a stale open ask is superseded", async () => {
  const older = keeperHost({ tasks: family(), backlogModule: { ...backlog, DUPLICATE_WAIT: undefined } });
  await older.run();
  assert.equal(older.state.questions.length, 0);
  assert.equal(older.state.housekeeping.familiesWaiting, 1, "still counted for the overseer");
  const h = keeperHost({ tasks: family() });
  await h.run();
  h.setBoard((board) => ({ ...board, tasks: board.tasks.filter((task) => task.id === "task_one" || task.id === "task_parent") }));
  await h.run();
  assert.equal(h.state.questions[0].status, "superseded", "one card left: nothing to choose between");
  assert.equal(h.state.housekeeping.questionsSuperseded, 1);
});

// ---- the overseer ----------------------------------------------------------------

test("the overseer warns about held cards and notes families waiting on the owner, and files no upgrade", () => {
  const withKeeper = (housekeeping) => assistant.overseerDigest({ ...assistant.emptyState(NOW), housekeeping: { lastAt: NOW - MIN, ...housekeeping } }, NOW);
  const digest = withKeeper({ loopsHeld: 0, loopsHolding: 2, familiesWaiting: 3 });
  assert.deepEqual([digest.housekeeping.loopsHeld, digest.housekeeping.familiesWaiting], [2, 3]);
  assert.equal(withKeeper({ loopsHeld: 1 }).housekeeping.loopsHeld, 1, "a state saved before loopsHolding reads the pass's new holds");
  const review = assistant.overseerReview(digest);
  const byTitle = Object.fromEntries(review.findings.map((finding) => [finding.title, finding]));
  assert.equal(byTitle["cards looping"].severity, "warn");
  assert.match(byTitle["cards looping"].detail, /^2 cards held by the loop guard · /);
  assert.equal(byTitle["duplicate work waiting for a decision"].severity, "info");
  assert.match(byTitle["duplicate work waiting for a decision"].detail, /^3 duplicate card families · /);
  const quiet = assistant.overseerReview(withKeeper({}));
  assert.ok(!quiet.findings.some((finding) => /looping|duplicate work/.test(finding.title)));
  assert.deepEqual(review.upgrades, quiet.upgrades, "more cards would not help a card that loops");
  assert.deepEqual(assistant.overseerTalk(review, { digest }).roles, [], "no agent is sent: these wait on the owner");
  // The findings are status snapshots: their lessons retire once quiet.
  let overseer = { lessons: [{ text: "cards looping: 2 cards held by the loop guard", hits: 3, firstAt: NOW - HOUR, lastAt: NOW - HOUR }] };
  for (let i = 1; i <= 4; i += 1) overseer = assistant.overseerMerge(overseer, { findings: [], lessons: [] }, NOW + i * MIN);
  assert.deepEqual(overseer.lessons, []);
});

test("a standing hold is spoken once, again only when it grows, and never carries other findings onto the thread", () => {
  const review = (housekeeping, overseer, now, ai = { keyPresent: true }) => {
    const state = assistant.normalizeState({ ...assistant.emptyState(NOW), ai, housekeeping: { lastAt: now - MIN, ...housekeeping } }, now);
    const digest = assistant.overseerDigest(state, now);
    const result = assistant.overseerReview(digest, overseer);
    return { digest, result, talk: assistant.overseerTalk(result, { digest }), next: assistant.overseerMerge(overseer, result, now, { digest, via: "local", directives: [] }) };
  };
  const first = review({ loopsHolding: 1, familiesWaiting: 1 }, null, NOW);
  assert.match(first.talk.say, /^I found cards looping \(1 card held by the loop guard/);
  assert.equal(first.talk.serious, true, "a new hold reaches the owner's thread");
  const second = review({ loopsHolding: 1, familiesWaiting: 1 }, first.next, NOW + 15 * MIN);
  assert.deepEqual(second.result.findings.map((finding) => [finding.title, finding.severity, finding.persisting]), [["cards looping", "warn", true], ["duplicate work waiting for a decision", "info", true]], "the review still scores and records it");
  assert.equal(second.result.score, first.result.score);
  assert.deepEqual([second.talk.say, second.talk.serious], ["", false], "the same hold is not repeated");
  const grown = review({ loopsHolding: 2, familiesWaiting: 1 }, second.next, NOW + 30 * MIN);
  assert.match(grown.talk.say, /^I found cards looping \(2 cards held/);
  assert.doesNotMatch(grown.talk.say, /duplicate work/, "the unchanged family count stays quiet");
  assert.equal(grown.talk.serious, true);
  // Another finding while the hold stands: spoken, but an info note alone
  // never reaches the thread just because a warn hold is standing.
  const keyless = review({ loopsHolding: 2, familiesWaiting: 1 }, grown.next, NOW + 45 * MIN, { keyPresent: false });
  assert.match(keyless.talk.say, /^I found no API key/);
  assert.equal(keyless.talk.serious, false);
  assert.ok(keyless.result.findings.some((finding) => finding.title === "cards looping" && finding.severity === "warn"));
  // The host reads the talk's verdict before its own warn scan.
  assert.match(source, /const serious = typeof talk\.serious === "boolean" \? talk\.serious : /);
});

test("the housekeeping counters survive a reload", () => {
  assert.deepEqual([assistant.emptyState(NOW).housekeeping.loopsHolding, assistant.emptyState(NOW).housekeeping.familiesWaiting], [0, 0]);
  const state = assistant.normalizeState({ ...assistant.emptyState(NOW), housekeeping: { loopsHolding: 2.7, familiesWaiting: 1, lastAt: NOW } }, NOW);
  assert.deepEqual([state.housekeeping.loopsHolding, state.housekeeping.familiesWaiting], [2, 1]);
});

// ---- repeating work, "Work on it" cards and the owner's holds -------------------

test("a Work on it card is the work it points at, even with its title clipped", () => {
  const plainTitle = pass([card("task_a", "Wire the retry banner"), card("task_w", 'Work on "Wire the retry banner"')]);
  assert.deepEqual(plainTitle.report.familyGroups.map((family) => [family.key, family.members.map((member) => member.id)]), [["wire the retry banner", ["task_a", "task_w"]]]);
  const label = "Follow-up 3: Rebuild the booklet from staged sources after the release cut";
  const clipped = card("task_clip", `Work on "${label}"`.slice(0, 60), { prompt: `Work on "${label}". Queued with Work on it — the user pointed at task (id: task_x).` });
  const [family] = pass([card("task_b", "Rebuild the booklet from staged sources after the release cut"), clipped]).report.familyGroups;
  assert.deepEqual(family.members.map((member) => member.id), ["task_b", "task_clip"], "the full label comes from the prompt");
});

const idleRun = (at, extra = {}) => ({ state: "verified", at, reason: "2 recorded checks passed", changedFiles: 0, ...extra });
// A chain the per-card ledger cannot see: the first card, its split, a split
// of the split, and a "Work on it" card for that, each a new card. Three of
// the last four runs changed nothing, or only the TESTRUNS notebook
// (ledgerOnly); the newest card waits to run.
const CHAIN_KEY = "testruns append helper";
const chain = () => [
  card("task_c1", "TESTRUNS append helper", { status: "done", doneAt: NOW - 20 * HOUR, createdAt: NOW - 24 * HOUR, verification: idleRun(NOW - 20 * HOUR, { changedFiles: 3 }) }),
  card("task_c2", "Follow-up: TESTRUNS append helper", { status: "done", doneAt: NOW - 10 * HOUR, createdAt: NOW - 18 * HOUR, splitFrom: "task_c1", splitDepth: 1, verification: idleRun(NOW - 10 * HOUR, { changedFiles: 1, ledgerOnly: true }) }),
  card("task_c3", "Follow-up 2: TESTRUNS append helper", { status: "done", doneAt: NOW - 6 * HOUR, createdAt: NOW - 9 * HOUR, splitFrom: "task_c2", splitDepth: 2, verification: idleRun(NOW - 6 * HOUR) }),
  card("task_c4", 'Work on "Follow-up 2: TESTRUNS append helper"', { createdAt: NOW - 5 * HOUR, verification: { state: "unverified", at: NOW - 4 * HOUR, reason: "outstanding obligations remain", changedFiles: 1, ledgerOnly: true } }),
];

test("work whose runs keep changing nothing is put to the owner once: hold it for review, or let it run", () => {
  const tasks = chain();
  const result = pass(tasks);
  assert.equal(result.report.familiesChurning, 1);
  const asks = result.familyAsks.filter((ask) => ask.familyKey === `${CHAIN_KEY}#churn`);
  assert.equal(asks.length, 1);
  const [ask] = asks;
  assert.equal(ask.source, "family");
  assert.equal(ask.title, "This work keeps coming back: 4 cards, and 3 of its last 4 runs changed nothing");
  assert.deepEqual(ask.context, { severity: "decision", taskId: "task_c4", taskTitle: 'Work on "Follow-up 2: TESTRUNS append helper"' });
  assert.match(ask.detail, /^1\) "TESTRUNS append helper" · done; 2\) "Follow-up: TESTRUNS append helper" · done; .*4\) "Work on /);
  assert.deepEqual(ask.options.map((option) => [option.id, option.label, option.recommended === true]), [["hold", "Hold it for my review", true], ["let-run", "Let it run", false]]);
  assert.deepEqual(ask.options[0].action.holdIds, ["task_c4"], "only the card that waits to run is held");
  assert.deepEqual(ask.options[0].action.memberIds, ["task_c1", "task_c2", "task_c3", "task_c4"]);
  assert.match(result.text, /1 repeating piece of work/);
  result.tasks.forEach((row, index) => assert.equal(row, tasks[index], "an ask writes nothing on the board"));
});

test("repeating work is not asked about on two idle runs of four, while busy, without a waiting card, or on an old host", () => {
  const busy = (tasks) => tasks.map((task) => (task.id === "task_c4" ? { ...task, status: "active", runId: "run_1" } : task));
  const twoIdle = chain().map((task) => (task.id === "task_c3" ? { ...task, verification: idleRun(NOW - 6 * HOUR, { changedFiles: 2 }) } : task));
  assert.equal(pass(twoIdle).report.familiesChurning, 0, "two of four is not enough");
  assert.equal(pass(busy(chain())).report.familiesChurning, 0, "a worker has it");
  const finished = chain().map((task) => (task.id === "task_c4" ? { ...task, status: "done", doneAt: NOW - HOUR } : task));
  assert.equal(pass(finished).report.familiesChurning, 0, "nothing waits to run");
  const oldHost = pass(chain(), { hostCaps: { duplicateWait: true } });
  assert.equal(oldHost.report.familiesChurning, 1, "still counted");
  assert.deepEqual(oldHost.familyAsks, [], "but a host that cannot hold for the owner is never asked");
  assert.equal(pass(chain().slice(2)).report.familiesChurning, 0, "two cards are no chain");
});

test("only runs after the owner's last answer count, so Let it run is asked again only after more idle runs", () => {
  const decided = chain().map((task) => ({ ...task, familyDecision: { at: NOW - 3 * HOUR, choice: "let-run", keepId: null } }));
  assert.equal(pass(decided).report.familiesChurning, 0, "the answer covers the runs before it");
  const later = decided.map((task) => (task.id === "task_c4" ? { ...task, contextHistory: { version: 1, entries: [1, 2, 3].map((n) => ({ id: `revision_${n}`, revision: n, snapshot: { id: "task_c4", verification: idleRun(NOW - 3 * HOUR + n * 10 * MIN) } })) } } : task));
  assert.equal(pass(later).report.familiesChurning, 1, "three idle runs since the answer ask again");
});

test("the owner's hold stops the waiting card until Try again; the loop-guard switches never release it", async () => {
  const [ask] = pass(chain()).familyAsks;
  const h = gatewayHost({ tasks: chain() });
  const question = h.env.assistantQuestion(ask);
  const typed = await h.env.assistantAnswer({ id: question.id, optionId: null, text: "hmm" });
  assert.equal(typed.ok, false);
  assert.equal(typed.error, "Choose Hold it for my review or Let it run: a typed answer cannot decide whether this work waits.");
  assert.equal((await h.env.assistantAnswer({ id: question.id, optionId: "hold" })).ok, true);
  const rows = Object.fromEntries(h.board().tasks.map((task) => [task.id, task]));
  for (const id of ["task_c1", "task_c2", "task_c3", "task_c4"]) assert.equal(rows[id].familyDecision.choice, "hold", `${id} is stamped`);
  assert.deepEqual([rows.task_c4.loopGuard.kind, rows.task_c4.loopGuard.by], ["family", "owner"]);
  assert.match(rows.task_c4.loopGuard.reason, /^you held it for review: 3 of this work's last 4 runs changed nothing/);
  assert.equal(rows.task_c4.logs.at(-1).text, "You decided: hold this work for your review — 3 of this work's last 4 runs changed nothing but the TESTRUNS notebook");
  assert.equal(rows.task_c1.loopGuard, undefined, "finished cards are stamped, never held");
  const state = backlog.workState(rows.task_c4, NOW, { tasks: Object.values(rows) });
  assert.deepEqual([state.stage, state.blockedBy], ["blocked", "loop"]);
  assert.ok(h.logs.some((row) => row.kind === "decision" && row.text === "held 1 card of repeating work for review"));
  for (const prefs of [{ loopGuard: false }, { loopGuardApply: false }]) {
    const out = pass(Object.values(rows), { prefs });
    assert.equal(out.tasks.find((task) => task.id === "task_c4").loopGuard?.by, "owner", `${JSON.stringify(prefs)} keeps the owner's hold`);
    assert.equal(out.report.loopsReleased, 0);
  }
  assert.equal(pass(Object.values(rows)).report.familiesChurning, 0, "a held card is not asked about again");
  assert.equal((await h.env.backlogControl({ action: "retry", taskId: "task_c4" })).ok, true);
  const released = h.board().tasks.find((task) => task.id === "task_c4");
  assert.equal(released.loopGuard, undefined, "Try again releases it");
  assert.equal(backlog.workState(released, Date.now(), { tasks: h.board().tasks }).stage, "ready");
});

test("Let it run stamps only, and the ask is not repeated for the runs it covered", async () => {
  const [ask] = pass(chain()).familyAsks;
  const h = gatewayHost({ tasks: chain() });
  const question = h.env.assistantQuestion(ask);
  assert.equal((await h.env.assistantAnswer({ id: question.id, optionId: "let-run" })).ok, true);
  const rows = h.board().tasks;
  assert.ok(rows.every((task) => task.familyDecision?.choice === "let-run" && task.loopGuard === undefined));
  assert.equal(backlog.workState(rows.find((task) => task.id === "task_c4"), Date.now(), { tasks: rows }).stage, "ready");
  // The runs the answer covered are not counted again.
  // (The fixture runs are dated ahead of the real clock the answer stamps;
  // move them, and the revisions the gateway recorded, before the answer.)
  const covered = rows.map(({ contextHistory: _history, ...task }) => (task.verification ? { ...task, verification: { ...task.verification, at: task.familyDecision.at - MIN } } : task));
  assert.equal(pass(covered).report.familiesChurning, 0);
});

test("a repeating-work ask goes once its waiting card finishes; an owner-only ask stays on a finished card", () => {
  const [ask] = pass(chain()).familyAsks;
  const open = { ...ask, id: "q_churn", status: "open" };
  assert.deepEqual(pass(chain(), { questions: [open] }).supersedeQuestionIds, [], "still waiting");
  const finished = chain().map((task) => (task.id === "task_c4" ? { ...task, status: "done", doneAt: NOW - MIN } : task));
  assert.deepEqual(pass(finished, { questions: [open] }).supersedeQuestionIds, ["q_churn"]);
  // agent-issues' "owner" kind: a leftover only the owner can do, usually
  // raised as the card finishes. It has no split option; its kind keeps it.
  const done = card("task_done", "Land the helper", { status: "done", doneAt: NOW - MIN });
  const owner = { id: "q_owner", status: "open", source: "issue", kind: "question", title: '"Land the helper" needs something only you can do: correct the stored wording', context: { issueKind: "owner", severity: "decision", taskId: "task_done" }, options: [{ id: "acknowledge", recommended: true, action: { kind: "issue", action: "acknowledge", payload: { issueKind: "owner", taskId: "task_done", ask: "correct the stored wording" } } }, { id: "instruct" }, { id: "hold" }] };
  const retry = { id: "q_retry", status: "open", source: "issue", kind: "question", context: { issueKind: "run-failed", taskId: "task_done" }, options: [{ id: "retry", action: { kind: "issue", action: "retry" } }] };
  assert.deepEqual(pass([done], { questions: [owner, retry] }).supersedeQuestionIds, ["q_retry"], "only the ask that could re-arm finished work goes");
});

test("Hold looping cards off releases the keeper's own holds, counts them as would-hold, and keeps the owner's", () => {
  const ledger = { v: 1, at: NOW - 2 * HOUR, n: 6, reasons: {} };
  const keeperHeld = card("task_keeper", "Rerun the flaky gate", { loopLedger: ledger, loopGuard: { v: 1, at: NOW - HOUR, kind: "attempts", count: 6, reason: "the runs failed", remedy: "…", by: "keeper" } });
  const ownerHeld = card("task_owner", "Chase the chain", { loopGuard: { v: 1, at: NOW - HOUR, kind: "family", count: 0, reason: "you held it for review", remedy: "…", by: "owner" } });
  const off = pass([keeperHeld, ownerHeld], { prefs: { loopGuardApply: false } });
  const [keeperRow, ownerRow] = off.tasks;
  assert.equal(keeperRow.loopGuard, undefined, "released");
  assert.deepEqual(keeperRow.loopLedger, ledger, "the count stays");
  assert.equal(ownerRow, ownerHeld, "the owner's hold is untouched");
  assert.deepEqual([off.report.loopsReleased, off.report.wouldHold, off.report.loopsHeld], [1, 1, 0]);
  assert.match(off.text, /released 1 loop hold · would hold 1 looping card/);
  const on = pass(off.tasks);
  assert.equal(on.tasks[0].loopGuard?.by, "keeper", "switched back on, the keeper holds it again");
});
