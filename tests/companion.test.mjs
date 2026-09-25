// The companion (0.4.0 M9) is the one place the owner hears what happened and
// acts on what waits for them. Its digest must match the board, every kind of
// waiting card must land in one queue in a stable order, and its preferences
// are only ever suggestions drawn from enough answers.
import test from "node:test";
import assert from "node:assert/strict";
import { STATES, LOOKS, stateFor, formatAway, digest, queue, preferences } from "../scripts/companion.cjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = 1_800_000_000_000;
const SINCE = NOW - 3 * HOUR;

test("the states and looks are fixed lists", () => {
  assert.deepEqual(STATES, ["greeting", "working", "needs-you", "resting"]);
  assert.deepEqual(LOOKS, ["wisp", "fox", "owl", "cat", "person"]);
  assert.ok(Object.isFrozen(STATES));
  assert.ok(Object.isFrozen(LOOKS));
});

test("greeting beats needs-you beats working beats resting", () => {
  assert.equal(stateFor({ running: 2, needsYou: 1, greetingUntil: NOW + 1, now: NOW }), "greeting");
  assert.equal(stateFor({ running: 2, needsYou: 1, greetingUntil: NOW, now: NOW }), "needs-you");
  assert.equal(stateFor({ running: 2, needsYou: 0, greetingUntil: NOW - 1, now: NOW }), "working");
  assert.equal(stateFor({ now: NOW }), "resting");
  assert.equal(stateFor(), "resting");
  for (const state of [stateFor({ now: NOW }), stateFor({ running: 1, now: NOW })]) assert.ok(STATES.includes(state));
});

test("away time reads in minutes, hours or days", () => {
  assert.equal(formatAway(20 * 1000), "under a minute");
  assert.equal(formatAway(-5), "under a minute");
  assert.equal(formatAway(NaN), "under a minute");
  assert.equal(formatAway(12 * MIN), "12 min");
  assert.equal(formatAway(59 * MIN), "59 min");
  assert.equal(formatAway(59.8 * MIN), "1 h");
  assert.equal(formatAway(3 * HOUR + 10 * MIN), "3 h");
  assert.equal(formatAway(23.7 * HOUR), "1 day");
  assert.equal(formatAway(26 * HOUR), "1 day");
  assert.equal(formatAway(2 * 24 * HOUR), "2 days");
});

function board() {
  return [
    { id: "t_done", title: "Ship the retry banner", status: "done", doneAt: NOW - HOUR },
    { id: "t_done_old", title: "Old work", status: "done", doneAt: SINCE - 1 },
    { id: "t_done_no_stamp", title: "No stamp", status: "done" },
    { id: "t_parked", title: "Fix the flaky gate", status: "open", verifyAttempts: 3, lastAttempt: { at: NOW - 2 * HOUR } },
    { id: "t_parked_old", title: "Parked long ago", status: "open", verifyAttempts: 4, parkedAt: SINCE - HOUR },
    { id: "t_cooling", title: "Cooling", status: "open", verifyAttempts: 3, lastAttempt: { at: NOW - HOUR }, nextRunAt: NOW + HOUR },
    { id: "t_held", title: "Held by you", status: "open", ownerHold: { at: NOW - 5 * HOUR, reason: "wait" } },
    { id: "t_loop", title: "Looping card", status: "open", loopGuard: { at: NOW - 30 * MIN, count: 3 } },
    { id: "t_approval", title: "Build the exporter", status: "open", needsApproval: true, updatedAt: NOW - 4 * HOUR },
    { id: "t_running", title: "Running", status: "active" },
    { id: "t_event_done", title: "Finished per event", status: "archived" },
  ];
}

test("the digest counts what finished, stopped and waits since the owner left", () => {
  const events = [
    { kind: "stage", taskId: "t_done", stage: "done", at: NOW - HOUR },
    { kind: "stage", taskId: "t_event_done", stage: "done", at: NOW - 2 * HOUR },
    { kind: "stage", taskId: "t_gone", stage: "done", title: "Deleted since", at: NOW - 90 * MIN },
    { kind: "stage", taskId: "t_before", stage: "done", at: SINCE - 1 },
    { kind: "stage", taskId: "t_failed", stage: "failed", title: "Broke the build", at: NOW - 100 * MIN },
    { kind: "stage", taskId: "t_done", stage: "parked", at: NOW - 2 * HOUR },
    { kind: "agent.out", taskId: "t_done", at: NOW - 2 * HOUR },
    { kind: "agent.out", taskId: "t_running", at: NOW - MIN },
    { kind: "agent.out", taskId: "t_before", at: SINCE - MIN },
    { kind: "agent.home", taskId: "t_done", at: NOW - HOUR },
  ];
  const result = digest({ events, tasks: board(), since: SINCE, now: NOW, needsYouIds: ["t_asked", "t_held"] });
  assert.equal(result.since, SINCE);
  assert.equal(result.awayMs, 3 * HOUR);
  // Deduped by task, newest first; a task gone from the board keeps its event title.
  assert.deepEqual(result.finished, [
    { taskId: "t_done", title: "Ship the retry banner" },
    { taskId: "t_gone", title: "Deleted since" },
    { taskId: "t_event_done", title: "Finished per event" },
  ]);
  // A task that stopped and then finished counts as finished only.
  assert.deepEqual(result.failed, [
    { taskId: "t_failed", title: "Broke the build" },
    { taskId: "t_parked", title: "Fix the flaky gate" },
  ]);
  assert.deepEqual(result.needsYou.map((row) => row.taskId), ["t_parked", "t_parked_old", "t_held", "t_loop", "t_approval", "t_asked"]);
  assert.equal(result.started, 2);
  assert.equal(result.headline, "While you were away (3 h): 3 done, 2 failed, 6 need you.");
  assert.equal(result.lines.length, 6);
  assert.equal(result.lines[0], "Needs you: Fix the flaky gate");
  assert.equal(result.lines[5], "…and 6 more.");
});

test("the digest's wording for one item, only starts, and nothing at all", () => {
  const one = digest({ tasks: [{ id: "a", title: "One thing", status: "done", doneAt: NOW - 5 * MIN }], since: NOW - 12 * MIN, now: NOW });
  assert.equal(one.headline, "While you were away (12 min): 1 done.");
  assert.deepEqual(one.lines, ["Done: One thing"]);
  const waiting = digest({ tasks: [{ id: "h", title: "Held", status: "open", ownerHold: { at: 1 } }], since: NOW - 2 * 24 * HOUR, now: NOW });
  assert.equal(waiting.headline, "While you were away (2 days): 1 needs you.");
  const busy = digest({ events: [{ kind: "agent.out", taskId: "x", at: NOW - MIN }], since: NOW - HOUR, now: NOW });
  assert.equal(busy.headline, "While you were away (1 h): 1 agent run started.");
  const quiet = digest({ events: [], tasks: [], since: NOW - HOUR, now: NOW });
  assert.equal(quiet.headline, "Nothing changed while you were away.");
  assert.deepEqual(quiet.lines, []);
  assert.deepEqual({ ...quiet, headline: undefined, lines: undefined }, { since: NOW - HOUR, awayMs: HOUR, finished: [], failed: [], needsYou: [], started: 0, headline: undefined, lines: undefined });
  // Without a since there is no away window at all.
  assert.equal(digest({ tasks: board(), now: NOW }).awayMs, 0);
  const longTitle = digest({ tasks: [{ id: "l", title: "x".repeat(300), status: "done", doneAt: NOW }], since: NOW - MIN, now: NOW });
  assert.ok(longTitle.lines[0].length <= 120);
});

function questions() {
  return [
    {
      id: "q_new", at: NOW - 10 * MIN, kind: "question", source: "issue", status: "open", title: "Scope ask",
      context: { issueKind: "scope", taskId: "t_scope", projectId: "proj_b" },
      options: [{ id: "narrow", label: "Keep to the brief", action: {} }, { id: "instruct", label: "Answer it in one line", text: true }, { label: "no id" }],
    },
    {
      id: "q_old", at: NOW - 60 * MIN, kind: "question", source: "issue", status: "open", title: "Owner ask",
      context: { issueKind: "owner", taskId: "t_held" },
      options: [{ id: "acknowledge", label: "I'll take care of it" }],
    },
    { id: "q_done", at: NOW - 5 * MIN, status: "answered", title: "Settled", options: [] },
    { id: "q_gone", at: NOW - 5 * MIN, status: "dismissed", title: "Dismissed", options: [] },
  ];
}

function queueTasks() {
  return [
    { id: "t_held", title: "Held by you", status: "open", ownerHold: { at: NOW - 5 * HOUR } },
    { id: "t_loop", title: "Looping", status: "open", loopGuard: { at: NOW - 3 * HOUR }, projectId: "proj_c" },
    { id: "t_parked", title: "Parked", status: "open", parkedAt: NOW - 2 * HOUR },
    { id: "t_failures", title: "Five failures", status: "open", runFailures: 5, updatedAt: NOW - 7 * HOUR },
    { id: "t_cooling", title: "Cooling", status: "open", verifyAttempts: 3, nextRunAt: NOW + MIN },
    { id: "t_approval_b", title: "Approval B", status: "open", needsApproval: true, updatedAt: NOW - HOUR },
    { id: "t_approval_a", title: "Approval A", status: "open", _stage: { stage: "approval" }, updatedAt: NOW - 2 * HOUR },
    { id: "t_approval_s", title: "Approval S", status: "open", _stage: "approval", createdAt: NOW - 3 * HOUR },
    { id: "t_review", title: "Waiting on review", status: "awaiting_verification", lastAttempt: { at: NOW - 45 * MIN } },
    { id: "t_fresh", title: "Just finished", status: "awaiting_verification", lastAttempt: { at: NOW - 5 * MIN } },
    { id: "t_running", title: "Running", status: "active", ownerHold: { at: 1 } },
    { id: "t_done", title: "Done", status: "done", needsApproval: true },
    { id: "t_plain", title: "Plain queued", status: "open" },
  ];
}

test("the queue lists every kind of waiting card in one stable order", () => {
  const { items, counts } = queue({ questions: questions(), tasks: queueTasks(), now: NOW, project: "proj_a" });
  assert.deepEqual(items.map((item) => item.id), [
    "q_old", "q_new",
    "approval:t_approval_s", "approval:t_approval_a", "approval:t_approval_b",
    "held:t_loop",
    "parked:t_failures", "parked:t_parked",
    "review:t_review",
  ]);
  assert.deepEqual(counts, { total: 9, question: 2, approval: 3, held: 1, parked: 2, review: 1 });
});

test("queue items carry their actions, labels and projects", () => {
  const { items } = queue({ questions: questions(), tasks: queueTasks(), now: NOW, project: "proj_a" });
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.deepEqual(byId.q_new, {
    id: "q_new", kind: "question", taskId: "t_scope", title: "Scope ask", project: "proj_b", at: NOW - 10 * MIN, issueKind: "scope", label: null,
    actions: [{ id: "narrow", label: "Keep to the brief" }, { id: "instruct", label: "Answer it in one line", text: true }],
  });
  assert.equal(byId.q_old.label, "Only you can do this");
  assert.equal(byId.q_old.project, "proj_a");
  assert.deepEqual(byId["approval:t_approval_b"].actions, [{ id: "approve", label: "Approve build" }]);
  assert.deepEqual(byId["held:t_loop"].actions, [{ id: "retry", label: "Try again" }, { id: "open", label: "Open task" }]);
  assert.equal(byId["held:t_loop"].project, "proj_c");
  assert.equal(byId["held:t_loop"].at, NOW - 3 * HOUR);
  assert.deepEqual(byId["parked:t_parked"].actions, [{ id: "retry", label: "Try again" }, { id: "open", label: "Open task" }]);
  assert.deepEqual(byId["review:t_review"].actions, [{ id: "checks", label: "View checks" }]);
  assert.equal(byId["review:t_review"].taskId, "t_review");
  // A task with an open question is acted on through the question alone.
  assert.equal(byId["held:t_held"], undefined);
  // Actions are fresh objects, so a caller cannot edit the table.
  byId["review:t_review"].actions[0].label = "changed";
  assert.equal(queue({ tasks: queueTasks(), now: NOW }).items.find((item) => item.kind === "review").actions[0].label, "View checks");
});

test("an empty or quiet board makes an empty queue", () => {
  assert.deepEqual(queue({ now: NOW }), { items: [], counts: { total: 0, question: 0, approval: 0, held: 0, parked: 0, review: 0 } });
  assert.deepEqual(queue({ questions: [null, "x", { status: "answered" }], tasks: [null, { title: "no id", ownerHold: {} }], now: NOW }).counts.total, 0);
});

test("preferences need four answers and a 60 percent favourite", () => {
  const decide = (kind, verb, count) => Array.from({ length: count }, (_, index) => ({ kind, verb, at: index }));
  const lines = preferences([
    ...decide("scope", "narrow", 7), ...decide("scope", "split", 2),
    ...decide("blocked", "retry", 3), ...decide("blocked", "instruct", 2),
    ...decide("missing", "instruct", 3),
    ...decide("check-failed", "retry", 4),
    ...decide("owner", "acknowledge", 4), ...decide("owner", "hold", 1),
    ...decide("risk", "proceed", 2), ...decide("risk", "hold", 2),
    { kind: "", verb: "retry" }, { kind: "scope" }, null,
  ]);
  assert.deepEqual(lines, [
    'You usually choose "Keep to the brief" for scope questions (7 of 9).',
    'You usually choose "I\'ll take care of it" for owner-only questions (4 of 5).',
    'You usually choose "Try again" for blocked questions (3 of 5).',
    'You usually choose "Try again" for failing-check questions (4 of 4).',
  ]);
  // missing: 3 answers is too few; risk: 50 percent is no favourite.
  assert.ok(!lines.some((line) => /missing|risk/.test(line)));
});

test("preferences list at most five kinds, most answered first, with every verb labelled", () => {
  const verbs = ["retry", "narrow", "split", "instruct", "acknowledge", "hold", "grant", "proceed", "replan"];
  const labels = ["Try again", "Keep to the brief", "Split the extra work out", "Answer it in one line", "I'll take care of it", "Leave it for review", "Grant it for this task", "Go ahead", "Re-plan this task"];
  const decisions = verbs.flatMap((verb, index) => Array.from({ length: 4 + index }, () => ({ kind: `kind${index}`, verb })));
  const lines = preferences(decisions);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /kind8 questions \(12 of 12\)/);
  assert.match(lines[0], /"Re-plan this task"/);
  for (const [index, verb] of verbs.entries()) {
    const one = preferences(Array.from({ length: 4 }, () => ({ kind: "k", verb })));
    assert.equal(one[0], `You usually choose "${labels[index]}" for k questions (4 of 4).`);
  }
  assert.equal(preferences([{ kind: "k", verb: "custom" }, { kind: "k", verb: "custom" }, { kind: "k", verb: "custom" }, { kind: "k", verb: "custom" }])[0], 'You usually choose "custom" for k questions (4 of 4).');
  assert.deepEqual(preferences(), []);
  assert.deepEqual(preferences("nope"), []);
});
