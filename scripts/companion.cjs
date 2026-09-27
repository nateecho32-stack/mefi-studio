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
 * holds first: a held card before a parked one before one awaiting approval. A
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
  // A failed verdict parks the card after any attempt (backlog.workState and
  // the assistant read it the same way), not only after the third.
  const parked = num(task.parkedAt) > 0 || num(task.verifyAttempts) >= PARK_VERIFY_ATTEMPTS || num(task.runFailures) >= PARK_RUN_FAILURES || task.verification?.state === "failed";
  // A hold (the owner's stop, or the keeper's loop hold) is listed before a
  // park: a card both held and parked must read as held, or whoever re-arms
  // parked cards (the desk) would lift the owner's own stop.
  if (isObject(task.ownerHold) || isObject(task.loopGuard) || isObject(task.autonomyBudgetHold)) return { kind: "held", at: num(task.ownerHold?.at) || num(task.loopGuard?.at) || num(task.autonomyBudgetHold?.at) || num(task.updatedAt) };
  // Work done outside Studio looks like it already covers the card
  // (scripts/outside-work.cjs): it waits for the owner's word, like a hold.
  if (isObject(task.relevance) && task.relevance.state === "ask") return { kind: "held", at: num(task.relevance.at) || num(task.updatedAt) };
  if (parked && !cooling) return { kind: "parked", at: num(task.parkedAt) || num(task.lastAttempt?.at) || num(task.updatedAt) };
  if (task.needsApproval || stageName(task) === "approval") return { kind: "approval", at: num(task.updatedAt) || num(task.createdAt) };
  return null;
}

// ---- the welcome-back digest ------------------------------------------------------------

const stageOf = (event) => String(event?.stage ?? event?.data?.stage ?? "");
const atOf = (event) => num(event?.at);

/**
 * What happened while the owner was away, from the work events and the board.
 * `needsYouIds` adds tasks the host already knows wait on the owner (an open
 * question's task, say) to the ones the board shows. `outside` is the
 * project's report of work done outside Studio (outside-work.cjs digestPart):
 * its phrase joins the headline and its lines lead the list.
 */
function digest({ events = [], tasks = [], since, now, needsYouIds = [], outside = null } = {}) {
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
    if (num(task.verifyAttempts) < PARK_VERIFY_ATTEMPTS && task.verification?.state !== "failed") continue;
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

  const away = isObject(outside) && clip(outside.phrase, 80) ? outside : null;
  const parts = [];
  if (away) parts.push(clip(away.phrase, 80));
  if (done.length) parts.push(`${done.length} done`);
  if (stopped.length) parts.push(`${stopped.length} failed`);
  if (waiting.length) parts.push(`${waiting.length} need${waiting.length === 1 ? "s" : ""} you`);
  if (!parts.length && started) parts.push(`${started} agent run${started === 1 ? "" : "s"} started`);
  const headline = parts.length ? `While you were away (${formatAway(awayMs)}): ${parts.join(", ")}.` : "Nothing changed while you were away.";

  // What changed outside Studio first, then what needs the owner, then what
  // stopped, then what finished.
  const all = [
    ...asArray(away?.lines).map((line) => clip(line, LIMITS.line + 20)).filter(Boolean).slice(0, 3),
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
    ...(away ? { outside: { phrase: clip(away.phrase, 80), at: num(away.at) } } : {}),
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
  const approvalFamilies = new Map();
  for (const task of asArray(tasks)) {
    const need = taskNeed(task, at);
    if (!need || asked.has(String(task.id))) continue;
    const parentId = need.kind === "approval" && task.delegatedFrom?.intake ? task.parentTaskId || task.delegatedFrom.parentTaskId : null;
    if (parentId) {
      if (!approvalFamilies.has(parentId)) {
        const parent = asArray(tasks).find((row) => row?.id === parentId);
        const family = { id: `approval:${parentId}`, kind: "approval", taskId: parentId, memberIds: [], title: clip(parent?.title, LIMITS.title) || "Your request", project, at: need.at, actions: [{ id: "approve", label: "Review these steps" }] };
        approvalFamilies.set(parentId, family); items.push(family);
      }
      approvalFamilies.get(parentId).memberIds.push(String(task.id));
      continue;
    }
    items.push({
      id: `${need.kind}:${task.id}`,
      kind: need.kind,
      taskId: String(task.id),
      title: clip(task.title, LIMITS.title) || String(task.id),
      // The project's name as the host passes it: a card's projectId is an id
      // ("project_9ebe…"), and item.projectId means another project's ask to
      // the renderer (agent-brain.js queueItem), so neither goes here.
      project: project ?? null,
      at: need.at,
      actions: TASK_ACTIONS[need.kind].map((action) => ({ ...action })),
    });
  }
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const counts = { total: items.length, question: 0, approval: 0, held: 0, parked: 0, review: 0 };
  for (const item of items) counts[item.kind] += 1;
  return { items, counts };
}

// ---- clearing the queue ------------------------------------------------------------------
// Things get stuck in the queue: an ask whose work moved on, a card parked
// by an older build. The owner's Clear marks every item as seen at its own
// time; an item comes back only when it is new or its reason is newer (a card
// parked again later, say), so clearing never hides what happens next.

const CLEARED_KEPT = 400;

/** The owner's clear marks after clearing `items`: { [itemId]: at }, bounded. */
function markCleared(marks, items) {
  const next = { ...(isObject(marks) ? marks : {}) };
  for (const item of asArray(items)) if (isObject(item) && item.id) next[String(item.id)] = Math.max(num(next[String(item.id)]), num(item.at));
  const rows = Object.entries(next).filter(([, at]) => Number.isFinite(Number(at)));
  if (rows.length <= CLEARED_KEPT) return Object.fromEntries(rows);
  return Object.fromEntries(rows.sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, CLEARED_KEPT));
}

/** The queue without the items the owner cleared, with its counts redone. */
function dropCleared(queue, marks) {
  const cleared = isObject(marks) ? marks : {};
  const items = asArray(queue?.items).filter((item) => !(String(item.id) in cleared) || num(item.at) > num(cleared[String(item.id)]));
  const counts = { total: items.length, question: 0, approval: 0, held: 0, parked: 0, review: 0 };
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
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
  markCleared,
  dropCleared,
  preferences,
};
