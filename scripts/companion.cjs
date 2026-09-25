// Mefi's Studio AI+ — the companion (docs/roadmap-0.4.0.md, M9): its state,
// the welcome-back digest, the one queue of things waiting on the owner, and
// the preferences read from the owner's own answers.
//
// Before the companion, what needed the owner was spread over Ask cards, the
// review list, approvals, parked and held cards and toasts, each with its own
// count or none, and nothing said what happened while they were away. This
// module turns the board, the open questions and the work events into one
// queue with counts and one digest, locally: a greeting and a resting
// companion spend no AI call. Preferences are suggestions the owner can see;
// nothing here ever answers a question for them.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time
// is injected).

"use strict";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// A finished run is checked by the verifier first; only one still waiting
// after this long is the owner's to look at.
const REVIEW_AFTER_MS = 30 * MINUTE_MS;
// Verification that failed this many times parks the card (backlog.workState),
// and the fifth charged run failure parks it for a manual reopen
// (executor-core MAX_RUN_FAILURES).
const PARK_VERIFY_ATTEMPTS = 3;
const PARK_RUN_FAILURES = 5;
const LIMITS = Object.freeze({ lines: 6, line: 120, title: 140, preferences: 5, preferenceMin: 4, preferenceShare: 0.6 });

const STATES = Object.freeze(["greeting", "working", "needs-you", "resting"]);
const LOOKS = Object.freeze(["wisp", "fox", "owl", "cat", "person"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : 0);
const clock = (now) => num(now);
const clip = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// ---- state ------------------------------------------------------------------------

/** Which of the four poses the companion shows. Resting makes no AI call. */
function stateFor({ running = 0, needsYou = 0, greetingUntil = 0, now } = {}) {
  const at = clock(now);
  if (at < num(greetingUntil)) return "greeting";
  if (num(needsYou) > 0) return "needs-you";
  if (num(running) > 0) return "working";
  return "resting";
}

/** "12 min", "3 h", "2 days": how long the owner was away. */
function formatAway(ms) {
  const value = Math.max(0, num(ms));
  if (value < MINUTE_MS) return "under a minute";
  const minutes = Math.round(value / MINUTE_MS);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(value / HOUR_MS);
  if (hours < 24) return `${hours} h`;
  const days = Math.max(1, Math.round(value / DAY_MS));
  return `${days} day${days === 1 ? "" : "s"}`;
}

// ---- what a task is waiting on ----------------------------------------------------------

// The queued statuses backlog.workState calls runnable.
const isQueued = (task) => !task.status || ["open", "pending", "queued"].includes(task.status);
const stageName = (task) => (typeof task._stage === "string" ? task._stage : isObject(task._stage) ? String(task._stage.stage ?? "") : "");
const reviewAt = (task) => num(task.awaitingAt) || num(task.lastAttempt?.at) || num(task.updatedAt);

/**
 * Why a task waits on the owner, if it does, with backlog.workState's
 * precedence: a parked card before a held one before one awaiting approval. A
 * card cooling toward its next retry is not parked: the loop will run it
 * again on its own.
 */
function taskNeed(task, now) {
  if (!isObject(task) || !task.id || task.absorbedInto) return null;
  if (task.status === "awaiting_verification") {
    const at = reviewAt(task);
    return at && now - at >= REVIEW_AFTER_MS ? { kind: "review", at } : null;
  }
  if (!isQueued(task)) return null;
  const cooling = num(task.nextRunAt) > now;
  const parked = num(task.parkedAt) > 0 || num(task.verifyAttempts) >= PARK_VERIFY_ATTEMPTS || num(task.runFailures) >= PARK_RUN_FAILURES;
  if (parked && !cooling) return { kind: "parked", at: num(task.parkedAt) || num(task.lastAttempt?.at) || num(task.updatedAt) };
  if (isObject(task.ownerHold) || isObject(task.loopGuard)) return { kind: "held", at: num(task.ownerHold?.at) || num(task.loopGuard?.at) || num(task.updatedAt) };
  if (task.needsApproval || stageName(task) === "approval") return { kind: "approval", at: num(task.updatedAt) || num(task.createdAt) };
  return null;
}

// ---- the welcome-back digest ------------------------------------------------------------

const stageOf = (event) => String(event?.stage ?? event?.data?.stage ?? "");
const atOf = (event) => num(event?.at);

/**
 * What happened while the owner was away, from the work events and the board.
 * `needsYouIds` adds tasks the host already knows wait on the owner (an open
 * question's task, say) to the ones the board shows.
 */
function digest({ events = [], tasks = [], since, now, needsYouIds = [] } = {}) {
  const end = clock(now);
  const from = Number.isFinite(Number(since)) && since !== null ? Number(since) : end;
  const byId = new Map(asArray(tasks).filter((task) => isObject(task) && task.id).map((task) => [String(task.id), task]));
  const titleOf = (id, fallback) => clip(byId.get(id)?.title ?? fallback ?? id, LIMITS.title) || String(id);
  const rows = asArray(events).filter((event) => isObject(event) && atOf(event) >= from);

  const finished = new Map();
  for (const task of byId.values()) {
    if (task.status === "done" && num(task.doneAt) >= from && task.doneAt != null) finished.set(String(task.id), { taskId: String(task.id), title: titleOf(String(task.id)), at: num(task.doneAt) });
  }
  for (const event of rows) {
    const id = event.taskId ? String(event.taskId) : "";
    if (event.kind === "stage" && stageOf(event) === "done" && id && !finished.has(id)) finished.set(id, { taskId: id, title: titleOf(id, event.title), at: atOf(event) });
  }

  // A task that stopped and then finished inside the window finished.
  const failed = new Map();
  for (const event of rows) {
    const id = event.taskId ? String(event.taskId) : "";
    if (event.kind !== "stage" || !["parked", "failed"].includes(stageOf(event)) || !id || finished.has(id)) continue;
    const prior = failed.get(id);
    if (!prior || atOf(event) > prior.at) failed.set(id, { taskId: id, title: titleOf(id, event.title), at: atOf(event) });
  }
  for (const task of byId.values()) {
    const id = String(task.id);
    if (failed.has(id) || finished.has(id) || !isQueued(task) || num(task.nextRunAt) > end) continue;
    if (num(task.verifyAttempts) < PARK_VERIFY_ATTEMPTS) continue;
    const at = Math.max(num(task.parkedAt), num(task.lastAttempt?.at));
    if (at >= from && at > 0) failed.set(id, { taskId: id, title: titleOf(id), at });
  }

  const needsYou = new Map();
  for (const task of byId.values()) {
    const need = taskNeed(task, end);
    if (need && need.kind !== "review") needsYou.set(String(task.id), { taskId: String(task.id), title: titleOf(String(task.id)), kind: need.kind });
  }
  for (const raw of asArray(needsYouIds)) {
    const id = raw == null ? "" : String(raw);
    if (id && !needsYou.has(id)) needsYou.set(id, { taskId: id, title: titleOf(id), kind: "question" });
  }

  const started = rows.filter((event) => event.kind === "agent.out").length;
  const byRecent = (a, b) => b.at - a.at;
  const done = [...finished.values()].sort(byRecent).map(({ taskId, title }) => ({ taskId, title }));
  const stopped = [...failed.values()].sort(byRecent).map(({ taskId, title }) => ({ taskId, title }));
  const waiting = [...needsYou.values()];
  const awayMs = Math.max(0, end - from);

  const parts = [];
  if (done.length) parts.push(`${done.length} done`);
  if (stopped.length) parts.push(`${stopped.length} failed`);
  if (waiting.length) parts.push(`${waiting.length} need${waiting.length === 1 ? "s" : ""} you`);
  if (!parts.length && started) parts.push(`${started} agent run${started === 1 ? "" : "s"} started`);
  const headline = parts.length ? `While you were away (${formatAway(awayMs)}): ${parts.join(", ")}.` : "Nothing changed while you were away.";

  // What needs the owner first, then what stopped, then what finished.
  const all = [
    ...waiting.map((row) => `Needs you: ${row.title}`),
    ...stopped.map((row) => `Stopped: ${row.title}`),
    ...done.map((row) => `Done: ${row.title}`),
  ].map((line) => (line.length > LIMITS.line ? `${line.slice(0, LIMITS.line - 1)}…` : line));
  const lines = all.length > LIMITS.lines ? [...all.slice(0, LIMITS.lines - 1), `…and ${all.length - (LIMITS.lines - 1)} more.`] : all;

  return {
    since: from,
    awayMs,
    finished: done,
    failed: stopped,
    needsYou: waiting.map(({ taskId, title }) => ({ taskId, title })),
    started,
    headline,
    lines,
  };
}

// ---- the queue ---------------------------------------------------------------------------

const KIND_ORDER = ["question", "approval", "held", "parked", "review"];
const TASK_ACTIONS = Object.freeze({
  approval: [{ id: "approve", label: "Approve build" }],
  held: [{ id: "retry", label: "Try again" }, { id: "open", label: "Open task" }],
  parked: [{ id: "retry", label: "Try again" }, { id: "open", label: "Open task" }],
  review: [{ id: "checks", label: "View checks" }],
});

/**
 * Everything waiting on the owner, as one list with counts: open questions
 * first (oldest first), then approvals, held, parked and review cards. A task
 * with an open question is acted on through that question, so it is listed
 * once. Items carry their own project when known, else `project`.
 */
function queue({ questions = [], tasks = [], now, project = null } = {}) {
  const at = clock(now);
  const items = [];
  const asked = new Set();
  for (const question of asArray(questions)) {
    if (!isObject(question) || question.status !== "open") continue;
    const context = isObject(question.context) ? question.context : {};
    const taskId = context.taskId ? String(context.taskId) : question.taskId ? String(question.taskId) : null;
    if (taskId) asked.add(taskId);
    const issueKind = context.issueKind ? String(context.issueKind) : null;
    items.push({
      id: String(question.id ?? `question:${num(question.at)}`),
      kind: "question",
      taskId,
      title: clip(question.title, 240),
      project: question.projectId ?? context.projectId ?? question.project ?? project,
      at: num(question.at),
      issueKind,
      label: issueKind === "owner" ? "Only you can do this" : null,
      actions: asArray(question.options)
        .filter((option) => isObject(option) && option.id)
        .map((option) => ({ id: String(option.id), label: clip(option.label, 80) || String(option.id), ...(option.text ? { text: true } : {}), ...(option.recommended ? { recommended: true } : {}) })),
    });
  }
  for (const task of asArray(tasks)) {
    const need = taskNeed(task, at);
    if (!need || asked.has(String(task.id))) continue;
    items.push({
      id: `${need.kind}:${task.id}`,
      kind: need.kind,
      taskId: String(task.id),
      title: clip(task.title, LIMITS.title) || String(task.id),
      project: task.projectId ?? project,
      at: need.at,
      actions: TASK_ACTIONS[need.kind].map((action) => ({ ...action })),
    });
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = { total: items.length, question: 0, approval: 0, held: 0, parked: 0, review: 0 };
  for (const item of items) counts[item.kind] += 1;
  return { items, counts };
}

// ---- preferences ---------------------------------------------------------------------------

// The answer verbs as the owner saw them on the card (agent-issues ISSUE_OPTIONS).
const VERB_LABELS = Object.freeze({
  retry: "Try again",
  "retry-deep": "Try again with a heavier model",
  narrow: "Keep to the brief",
  split: "Split the extra work out",
  instruct: "Answer it in one line",
  acknowledge: "I'll take care of it",
  hold: "Leave it for review",
  grant: "Grant it for this task",
  proceed: "Go ahead",
  replan: "Re-plan this task",
});
const KIND_WORDS = Object.freeze({ "check-failed": "failing-check", "run-failed": "stopped-run", owner: "owner-only" });

/**
 * What the owner usually answers, per issue kind: a kind with at least 4
 * answers where one verb has 60% or more. Suggestions to show, never answers
 * to give.
 */
function preferences(decisions = []) {
  const kinds = new Map();
  for (const decision of asArray(decisions)) {
    if (!isObject(decision)) continue;
    const kind = clip(decision.kind, 40);
    const verb = clip(decision.verb, 40);
    if (!kind || !verb) continue;
    if (!kinds.has(kind)) kinds.set(kind, new Map());
    const verbs = kinds.get(kind);
    verbs.set(verb, (verbs.get(verb) ?? 0) + 1);
  }
  const rows = [];
  for (const [kind, verbs] of kinds) {
    const total = [...verbs.values()].reduce((sum, count) => sum + count, 0);
    if (total < LIMITS.preferenceMin) continue;
    const [verb, count] = [...verbs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (count / total < LIMITS.preferenceShare) continue;
    rows.push({ kind, verb, count, total });
  }
  rows.sort((a, b) => b.total - a.total || b.count / b.total - a.count / a.total || (a.kind < b.kind ? -1 : 1));
  return rows.slice(0, LIMITS.preferences).map((row) => `You usually choose "${VERB_LABELS[row.verb] ?? row.verb}" for ${KIND_WORDS[row.kind] ?? row.kind} questions (${row.count} of ${row.total}).`);
}

module.exports = {
  STATES,
  LOOKS,
  LIMITS,
  REVIEW_AFTER_MS,
  VERB_LABELS,
  stateFor,
  formatAway,
  digest,
  queue,
  preferences,
};
