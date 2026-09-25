// Mefi's Studio AI+ — task oversight: what the assistant sees of the board and
// its workers, what the thread hears when an owned task moves, and how the chat
// model's reply becomes actions the host runs. The model writes one JSON
// envelope ({reply, actions, offers}); this module parses it, checks every
// action against the board it was shown, and splits what the owner plainly
// asked for, on a card their words name, from what needs their OK first.
// With no model, localChatActions reads the same actions from the owner's
// words alone. The host (main.cjs) runs the actions through its own
// functions — a CLI's own tools never touch the board.
//
// The owner's words are read clause by clause: an action runs only when one
// clause asks for its kind and names its card, and a clause that names the
// card with the kind negated vetoes it. Options the host passes:
//   allTitles  validateChatActions context, localChatActions options and
//              targetNamed context: id -> title (object or Map) for the whole
//              live board, not only the digest, so a word names a card only
//              when no title on the board shares it.
// taskEvents puts an owned card's needs-approval in `attention` (the rolled-up
// notice) with the unowned cards' asks, and a change past its cap of 24 is
// reported on the next call.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected: every function that needs the time takes `now`). Every function
// accepts garbage and never throws, every string is clipped and every list is
// capped, and every result is a plain JSON-safe object, so the host can keep
// the event index in saved state and the tests can run it with no host at all.
// backlog supplies stages; executor-activity formats bounded worker details
// with the same injected clock the digest uses.

"use strict";

const backlog = require("./backlog.cjs");
const { workerActivity } = require("./executor-activity.cjs");

// ---- shared helpers -----------------------------------------------------------

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// No list read from the board or saved state is walked past this many rows.
const BOARD_MAX = 5000;

// Cut to max characters with an ellipsis, never splitting a surrogate pair.
function cut(text, max) {
  if (text.length <= max) return text;
  if (max <= 1) return max === 1 ? "…" : "";
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

// One line of display text: colour codes, control characters and runs of
// whitespace go. Anything that is not a string, number or boolean is empty.
function clip(value, max) {
  const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  return cut(text.replace(ANSI, "").replace(CONTROL, "").replace(/\s+/g, " ").trim(), max);
}

// A block that keeps its line breaks (a brief, a note, a reply).
function clipBlock(value, max) {
  const text = typeof value === "string" ? value : "";
  return cut(text.replace(/\r\n?/g, "\n").replace(ANSI, "").replace(CONTROL, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), max);
}

const own = (object, key) => (object && Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined);
const rows = (value) => (Array.isArray(value) ? value.slice(0, BOARD_MAX).filter((row) => row && typeof row === "object" && !Array.isArray(row)) : []);
const count = (value) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 1e6) : 0;
};
const timeOf = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
// Ids key plain objects, so the one key that would rewrite a prototype is refused.
const idOf = (value) => {
  const id = clip(value, 200);
  return id && id !== "__proto__" ? id : "";
};
const plainObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);

// backlog.workState with the time always passed, so its clock default never runs.
function stateOf(task, now, options) {
  try {
    return backlog.workState(task, now, options) ?? { stage: "blocked", reason: "" };
  } catch {
    return { stage: "blocked", reason: "" };
  }
}

// 32-bit FNV-1a: a stable change marker for text the index need not keep.
function fingerprint(text) {
  const value = typeof text === "string" ? text : "";
  if (!value) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length && index < 4000; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// ---- 1. the board digest --------------------------------------------------------

// Live work first, then what needs the owner, then what waits by itself. The
// names are backlog.workState's stages.
const STAGE_RANK = Object.freeze({ running: 0, review: 1, approval: 2, blocked: 3, waiting: 4, ready: 5, cooling: 6, done: 7, grouped: 8 });
const DIGEST_GROUPS = Object.freeze(["running", "review", "needsYou", "blocked", "ready", "cooling", "recentDone"]);
const DIGEST_LIMITS = Object.freeze({ running: 6, review: 6, needsYou: 8, blocked: 6, ready: 8, cooling: 4, recentDone: 3, asks: 6 });

const REVIEW_STATUSES = new Set(["awaiting_verification", "verifying"]);

// Which list a task belongs in. Parked (verify or run budget spent), held by
// the loop guard, stopped by the owner, waiting on its duplicate, or waiting
// for approval: the owner is the only one who can move it, so it needs you.
function digestGroup(task, state) {
  const stage = state.stage;
  if (stage === "done") return { group: "recentDone" };
  if (stage === "running") return { group: "running" };
  if (stage === "review") return { group: "review" };
  if (stage === "approval") return { group: "needsYou", need: "approval" };
  if (stage === "cooling") return { group: "cooling" };
  if (stage === "ready") return { group: "ready" };
  if (state.blockedBy === "owner") return { group: "needsYou", need: "stopped" };
  if (state.blockedBy === "loop") return { group: "needsYou", need: "hold" };
  if (state.blockedBy === "duplicate") return { group: "needsYou", need: "duplicate" };
  if (stage === "waiting" && REVIEW_STATUSES.has(task.status)) return { group: "review" };
  if (stage === "blocked" && !state.blockedBy) return { group: "needsYou", need: /^Held \(/.test(String(state.reason ?? "")) ? "held" : "parked" };
  return { group: "blocked" };
}

function jobInfo(job, now) {
  const info = {};
  const runId = clip(job.id ?? job.runId, 80);
  if (runId) info.runId = runId;
  const started = timeOf(job.startedAt);
  info.minutes = started > 0 && now > started ? Math.floor((now - started) / 60000) : 0;
  const tail = Array.isArray(job.outputTail) ? job.outputTail : [];
  let last = "";
  for (let index = tail.length - 1; index >= Math.max(0, tail.length - 20) && !last; index -= 1) {
    last = clip(typeof tail[index] === "string" ? tail[index] : tail[index]?.text, 140);
  }
  if (!last) last = clip(job.lastLine, 140);
  if (last) info.lastLine = last;
  if (job.activeTool) info.currentTool = workerActivity(job, now).currentStep;
  // The run's own todo list is the honest fraction done (watchJobProgress).
  const todos = Array.isArray(job.todos) ? job.todos.slice(0, 500).filter((todo) => todo && typeof todo === "object") : [];
  if (todos.length) info.progress = `${todos.filter((todo) => todo.status === "completed").length}/${todos.length} todos`;
  else if (typeof job.progress === "number" && job.progress >= 0 && job.progress <= 1) info.progress = `${Math.round(job.progress * 100)}%`;
  return info;
}

// How long each passed-on string may be: the full digest, and the compact one
// a small chat budget asks for.
const ROW_SIZES = Object.freeze({ title: 90, reason: 160, verification: 140, loopGuard: 120, lastError: 140 });
const COMPACT_SIZES = Object.freeze({ title: 60, reason: 100, verification: 90, loopGuard: 90, lastError: 90 });

function digestRow(task, state, job, now, sizes = ROW_SIZES) {
  const row = {
    id: idOf(task.id),
    title: clip(task.title, sizes.title) || "Untitled task",
    stage: clip(state.stage, 24) || "unknown",
    reason: clip(state.reason, sizes.reason),
    status: clip(task.status, 40) || "open",
  };
  if (!row.reason) delete row.reason;
  if (task.pin) row.pin = true;
  const source = clip(task.source, 40);
  if (source) row.source = source;
  const runs = count(task.runFailures);
  if (runs) row.runs = runs;
  const verifies = count(task.verifyAttempts);
  if (verifies) row.verifies = verifies;
  const verification = plainObject(task.verification);
  const verdict = clip(verification?.state, 24);
  if (verdict) {
    row.verification = { state: verdict };
    const why = clip(verification.reason, sizes.verification);
    if (why) row.verification.reason = why;
  }
  const guard = plainObject(task.loopGuard);
  if (guard) row.loopGuard = clip(guard.reason, sizes.loopGuard) || "held by the loop guard";
  const lastError = clip(task.lastRunError, sizes.lastError);
  if (lastError) row.lastError = lastError;
  const blockedBy = clip(state.blockedBy, 24);
  if (blockedBy) row.blockedBy = blockedBy;
  if (state.stage === "cooling" && timeOf(state.retryAt) > now) row.retryInMinutes = Math.max(1, Math.ceil((timeOf(state.retryAt) - now) / 60000));
  // Stopped or interrupted with its checkpoint kept: the next run continues.
  if (task.runProgress && typeof task.runProgress === "object" && task.runProgress.pending) row.resumable = true;
  if (job) row.job = jobInfo(job, now);
  return row;
}

function openQuestions(questions) {
  return rows(questions)
    .map((question, order) => ({ question, order }))
    .filter(({ question }) => (question.status ?? "open") === "open")
    .sort((a, b) => timeOf(b.question.at) - timeOf(a.question.at) || b.order - a.order)
    .map(({ question }) => question);
}

function askOf(question) {
  const ask = {
    id: idOf(question.id),
    title: clip(question.title, 160),
    options: rows(question.options).slice(0, 6).map((option) => ({ id: clip(option.id, 40), label: clip(option.label, 60) })).filter((option) => option.id && option.label),
  };
  const taskId = idOf(plainObject(question.context)?.taskId ?? question.taskId);
  if (taskId) ask.taskId = taskId;
  return ask;
}

function digestLimits(limits) {
  const result = { ...DIGEST_LIMITS };
  const given = plainObject(limits);
  if (!given) return result;
  for (const name of Object.keys(DIGEST_LIMITS)) {
    const value = Math.floor(Number(own(given, name)));
    if (Number.isFinite(value)) result[name] = Math.max(0, Math.min(50, value));
  }
  return result;
}

// The board as the assistant should see it: every live task in one ranked,
// clipped list per group with its real stage and reason, what each worker is
// doing, the open Asks, and counts for everything clipped or left out.
// taskStates is summarizeBacklog(...).taskStates (joined by id); a task it
// does not name gets workState's answer. compare, when given, orders ready
// work after pins (the host's compareWork); otherwise the board order stands.
// compact: true clips every row harder (title 60, reason 100, verdict, hold
// and error 90) and keeps a worker's last line only on running rows. Every
// row carries its stage, so the host can hand the gate `stages` by id.
function boardDigest(input = {}) {
  const source = plainObject(input) ?? {};
  const now = timeOf(source.now);
  const limits = digestLimits(source.limits);
  const compact = source.compact === true;
  const sizes = compact ? COMPACT_SIZES : ROW_SIZES;
  const board = rows(source.tasks);
  const states = new Map();
  for (const state of rows(source.taskStates)) {
    const id = idOf(state.id);
    if (id && !states.has(id)) states.set(id, state);
  }
  const jobs = rows(source.jobs).filter((job) => !job.finished);
  const jobByTask = new Map();
  for (const job of jobs) {
    const taskId = idOf(job.taskId);
    if (taskId && !jobByTask.has(taskId)) jobByTask.set(taskId, job);
  }
  const focusSource = plainObject(source.focus);
  const focusId = focusSource && focusSource.kind === "task" ? idOf(String(focusSource.id ?? "").replace(/^task:/, "")) : "";
  const questions = openQuestions(source.questions);
  const askByTask = new Map();
  for (const question of questions) {
    const taskId = idOf(plainObject(question.context)?.taskId ?? question.taskId);
    if (taskId && !askByTask.has(taskId)) askByTask.set(taskId, idOf(question.id));
  }
  const groups = Object.fromEntries(DIGEST_GROUPS.map((name) => [name, []]));
  const counts = { archived: 0, grouped: 0, inbox: 0 };
  const seen = new Set();
  const autoBuild = source.autoBuild !== false;
  board.forEach((task, order) => {
    const id = idOf(task.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (task.absorbedInto) { counts.grouped += 1; return; }
    if (task.status === "archived") { counts.archived += 1; return; }
    const job = jobByTask.get(id) ?? null;
    const given = plainObject(states.get(id));
    const state = given && typeof given.stage === "string" ? given : job ? { stage: "running", reason: "A worker is building this task" } : stateOf(task, now, { tasks: board, autoBuild });
    if (state.stage === "grouped") { counts.grouped += 1; return; }
    const { group, need } = digestGroup(task, state);
    const row = digestRow(task, state, job, now, sizes);
    if (compact && group !== "running" && row.job) delete row.job.lastLine;
    if (need) row.need = need;
    const askId = askByTask.get(id);
    if (askId) row.ask = askId;
    if (id === focusId) row.focus = true;
    groups[group].push({ row, task, order, stage: state.stage, retryAt: timeOf(state.retryAt) });
  });
  // Inbox requests are not chat-actionable and no worker runs one (only
  // tasks run; a request is promoted first), so the inbox is only counted.
  for (const request of rows(source.requests)) {
    const status = String(request.status ?? "");
    if (status !== "done" && status !== "archived") counts.inbox += 1;
  }
  // A worker whose card this board does not show (a read that raced the
  // claim) is still what that worker is doing.
  for (const job of jobs) {
    const taskId = idOf(job.taskId);
    if (taskId && seen.has(taskId)) continue;
    const row = digestRow({ id: job.ref?.id ?? job.id, title: job.title, status: "running" }, { stage: "running", reason: "A worker is running this" }, job, now, sizes);
    row.id = row.id || "run";
    row.kind = "task";
    groups.running.push({ row, task: {}, order: 2 * BOARD_MAX, stage: "running", retryAt: 0 });
  }
  const updated = (entry) => timeOf(entry.task.updatedAt ?? entry.task.createdAt);
  groups.running.sort((a, b) => (b.row.job?.minutes ?? -1) - (a.row.job?.minutes ?? -1) || a.order - b.order);
  groups.review.sort((a, b) => a.order - b.order);
  groups.needsYou.sort((a, b) => (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9) || updated(b) - updated(a) || a.order - b.order);
  groups.blocked.sort((a, b) => updated(b) - updated(a) || a.order - b.order);
  const compare = typeof source.compare === "function" ? source.compare : null;
  const policy = (a, b) => {
    if (!compare) return 0;
    try {
      const result = Number(compare(a.task, b.task));
      return Number.isFinite(result) ? result : 0;
    } catch {
      return 0;
    }
  };
  // Pins first, the newest click first (the dispatcher's own tie-break).
  groups.ready.sort((a, b) => Number(Boolean(b.task.pin)) - Number(Boolean(a.task.pin))
    || (a.task.pin && b.task.pin ? timeOf(b.task.pinAt) - timeOf(a.task.pinAt) : 0)
    || policy(a, b) || a.order - b.order);
  groups.cooling.sort((a, b) => a.retryAt - b.retryAt || a.order - b.order);
  const doneAt = (entry) => timeOf(entry.task.doneAt ?? plainObject(entry.task.verification)?.at ?? entry.task.updatedAt);
  groups.recentDone.sort((a, b) => doneAt(b) - doneAt(a) || a.order - b.order);
  // Asks lead the digest: packChatPayload trims a section's later keys first.
  const asks = questions.map(askOf).filter((ask) => ask.id && ask.title);
  const digest = { at: now, counts: {}, omitted: {}, asks: asks.slice(0, limits.asks) };
  let focus = null;
  for (const name of DIGEST_GROUPS) {
    const list = groups[name];
    const shown = list.slice(0, limits[name]);
    // The task the owner is pointing at is always shown, even past the limit.
    if (focusId && !shown.some((entry) => entry.row.id === focusId)) {
      const focused = list.find((entry) => entry.row.id === focusId);
      if (focused) shown.push(focused);
    }
    if (focusId && list.some((entry) => entry.row.id === focusId)) focus = { id: focusId, group: name };
    digest.counts[name] = list.length;
    if (list.length > shown.length) digest.omitted[name] = list.length - shown.length;
    digest[name] = shown.map((entry) => entry.row);
  }
  digest.counts.asks = asks.length;
  if (asks.length > digest.asks.length) digest.omitted.asks = asks.length - digest.asks.length;
  Object.assign(digest.counts, counts, { total: seen.size });
  if (focus) digest.focus = focus;
  return digest;
}

// ---- 2. task events ------------------------------------------------------------------

// "started" is the host's alone: it posts one from the worker's real process
// spawn. A move into running is a claim, and a claim can be released before
// anything runs, so taskEvents never reports one.
const EVENT_KINDS = Object.freeze(["started", "verifying", "verified", "done", "retrying", "stopped", "parked", "held", "needs-approval", "removed"]);
const EVENTS_MAX = 24;
// What an unowned task says that still needs the owner (watchAll).
const ATTENTION_KINDS = new Set(["parked", "held", "needs-approval"]);
// assistant.mjs VERIFY_MAX_ATTEMPTS and the run-failure park: the same counts
// backlog.workState parks a card at.
const VERIFY_BUDGET = 3;
const RUN_BUDGET = 5;
const CLASSES = new Set(["open", "running", "review", "done", "archived", "grouped"]);

// Where a row is in its life, coarser than a stage: the transition between two
// observations of this is what an event reports.
function statusClass(task) {
  if (task.absorbedInto) return "grouped";
  const status = String(task.status ?? "open");
  if (status === "done") return "done";
  if (status === "archived") return backlog.completedTask(task) ? "done" : "archived";
  if (status === "active" || status === "running") return "running";
  if (REVIEW_STATUSES.has(status)) return "review";
  return "open";
}

// A user stop stamps the saved checkpoint (settle's userStop branch); a claim
// released before its worker launched does not, and is no stop.
function stopStamp(task) {
  const progress = plainObject(task.runProgress) ?? plainObject(task.interruptedAttempt);
  return count(progress?.interruptedAt);
}

function indexEntry(task, stage, owned) {
  const guard = plainObject(task.loopGuard);
  const hold = plainObject(task.ownerHold);
  return {
    title: clip(task.title, 90) || "Untitled task",
    status: clip(task.status, 40) || "open",
    cls: statusClass(task),
    stage: clip(stage, 24) || null,
    verification: clip(plainObject(task.verification)?.state, 24) || null,
    loopGuard: guard ? fingerprint(`${clip(guard.at, 40)}|${clip(guard.reason, 400)}|${clip(guard.count, 12)}`) : null,
    ownerHold: hold ? fingerprint(`owner|${clip(hold.at, 40)}|${clip(hold.reason, 400)}`) : null,
    runFailures: count(task.runFailures),
    verifyAttempts: count(task.verifyAttempts),
    requeues: count(task.providerFailures) + count(task.startFailures),
    error: fingerprint(typeof task.lastRunError === "string" ? task.lastRunError : ""),
    runId: clip(task.runId, 80) || null,
    stopped: stopStamp(task),
    owned: Boolean(owned),
  };
}

// Saved index entries come back from disk: coerce every field.
function readEntry(raw) {
  const entry = plainObject(raw);
  if (!entry) return null;
  const text = (value, max) => clip(value, max) || null;
  return {
    title: clip(entry.title, 90) || "Untitled task",
    status: clip(entry.status, 40) || "open",
    cls: CLASSES.has(entry.cls) ? entry.cls : statusClass({ status: entry.status }),
    stage: text(entry.stage, 24),
    verification: text(entry.verification, 24),
    loopGuard: text(entry.loopGuard, 16),
    ownerHold: text(entry.ownerHold, 16),
    runFailures: count(entry.runFailures),
    verifyAttempts: count(entry.verifyAttempts),
    requeues: count(entry.requeues),
    error: text(entry.error, 16),
    runId: text(entry.runId, 80),
    stopped: count(entry.stopped),
    owned: entry.owned === true,
  };
}

// What a task that was not on the board before is compared against.
const NEW_ENTRY = Object.freeze({ cls: "open", stage: null, verification: null, loopGuard: null, ownerHold: null, runFailures: 0, verifyAttempts: 0, requeues: 0, error: null, runId: null, stopped: 0 });

// The one event two observations add up to. Only the endpoints are compared,
// so a task that moved twice in between reports where it is now. A task seen
// for the first time (fresh) has no before to compare, so it reports only
// what a new card can newly need from the owner — an approval wait or a loop
// guard hold — never done, verified, verifying, removed, parked or retrying:
// an empty or failed baseline read must not replay the board's history. A
// move into running says nothing: it is a claim, not a start (the host posts
// the start from the worker's real spawn), and a claim released before its
// worker launched — back to open with no charge and no newer stop stamp —
// says nothing either.
function transition(prev, cur, state, fresh = false) {
  if (fresh) {
    if (cur.loopGuard && state.blockedBy === "loop") return "held";
    return cur.stage === "approval" ? "needs-approval" : null;
  }
  if (cur.cls === "done") return prev.cls === "done" ? null : cur.verification === "verified" ? "verified" : "done";
  if (cur.cls === "archived") return ["open", "running", "review"].includes(prev.cls) ? "removed" : null;
  if (cur.cls === "grouped") return null;
  if (cur.cls === "running") return null;
  const rerun = Boolean(cur.runId && prev.runId && cur.runId !== prev.runId);
  if (cur.cls === "review") return prev.cls !== "review" || rerun ? "verifying" : null;
  // Back in the queue. A charge (a failed run, an unverified result, an
  // uncharged requeue after a provider or start failure) or a fresh error means
  // another try is coming — unless the budget is spent (parked), the loop
  // guard holds it, or its owner stopped it, exactly as workState ranks
  // blocked before cooling.
  const charged = cur.runFailures > prev.runFailures || cur.verifyAttempts > prev.verifyAttempts || cur.requeues > prev.requeues
    || (cur.verification !== prev.verification && (cur.verification === "unverified" || cur.verification === "failed"))
    || (cur.error !== null && cur.error !== prev.error);
  const fromWork = prev.cls === "running" || prev.cls === "review";
  const stoppedNow = prev.cls === "running" && cur.stopped > prev.stopped;
  if (fromWork || charged) {
    if (state.stage === "blocked" && state.blockedBy === "loop") return "held";
    if (state.stage === "blocked" && !state.blockedBy) return "parked";
    // The owner's stop: nothing retries it, whatever the run was charged.
    if (state.stage === "blocked" && state.blockedBy === "owner") return stoppedNow ? "stopped" : "held";
    if (charged) return "retrying";
    if (stoppedNow) return "stopped";
    return null;
  }
  if (cur.loopGuard && cur.loopGuard !== prev.loopGuard && state.blockedBy === "loop") return "held";
  if (cur.ownerHold && cur.ownerHold !== prev.ownerHold && state.blockedBy === "owner") return "held";
  if (cur.stage === "approval" && prev.stage !== "approval") return "needs-approval";
  return null;
}

function eventText(kind, task, prev, cur, state, now) {
  const name = `"${clip(task.title ?? cur.title, 60) || "Untitled task"}"`;
  const verification = plainObject(task.verification) ?? {};
  switch (kind) {
    case "verifying":
      return `${name} finished its run; verifying the result`;
    case "verified": {
      const why = clip(verification.reason, 140);
      return `Verified: ${name}${why ? ` — ${why}` : ""}`;
    }
    case "done":
      return verification.state === "manual" ? `Done: ${name} — confirmed by you` : `Done: ${name}`;
    case "retrying": {
      const verifyCharged = cur.verifyAttempts > prev.verifyAttempts || (cur.verification === "unverified" && prev.verification !== "unverified");
      const runCharged = cur.runFailures > prev.runFailures;
      const attempt = verifyCharged ? `attempt ${Math.min(cur.verifyAttempts + 1, VERIFY_BUDGET)}/${VERIFY_BUDGET}`
        : runCharged ? `attempt ${Math.min(cur.runFailures + 1, RUN_BUDGET)}/${RUN_BUDGET}` : "no attempt charged";
      const why = clip(verifyCharged ? verification.reason || task.lastRunError : task.lastRunError, 140);
      const wait = timeOf(task.nextRunAt) > now ? ` in ${Math.max(1, Math.ceil((timeOf(task.nextRunAt) - now) / 60000))} min` : "";
      return `Retrying ${name}${wait} (${attempt})${why ? `: ${why}` : ""}`;
    }
    // Only the owner's stop waits for them; any other interruption (a restart,
    // a lost worker) picks up again by itself.
    case "stopped":
      return plainObject(task.ownerHold)
        ? `Stopped ${name} — progress saved; it waits for you. Say "work on it" or "try again" to resume.`
        : `${name} was interrupted; it resumes from its saved progress`;
    case "parked": {
      let why;
      if (verification.state === "failed" || cur.verifyAttempts >= VERIFY_BUDGET) why = clip(verification.reason, 140) || clip(state.reason, 160);
      else if (cur.runFailures >= RUN_BUDGET) why = `${cur.runFailures} attempts failed${clip(task.lastRunError, 100) ? ` (last: ${clip(task.lastRunError, 100)})` : ""}`;
      else why = clip(state.reason, 160);
      return `${name} is parked: ${(why || "it needs your review").replace(/[.\s]+$/, "")}. Say "try again" to re-arm it.`;
    }
    case "held": {
      if (state.blockedBy === "owner") return `Stopped ${name}; it waits for you. Say "work on it" or "try again" to resume.`;
      const why = clip(plainObject(task.loopGuard)?.reason, 120) || "it kept repeating without verified progress";
      return `${name} is on hold: ${why.replace(/[.\s]+$/, "")}. Say "try again" to run it anyway.`;
    }
    case "needs-approval":
      return `${name} needs your approval before it builds. Say "approve" to let it start.`;
    case "removed":
      return cur?.cls === "archived" ? `${name} was archived before it finished` : `${name} left the board before it finished`;
    default:
      return name;
  }
}

// Lifecycle events for the tasks the owner cares about. previousIndex is the
// index this returned last time (null on the first call, which only records a
// baseline). isOwned(task) says whether the owner cares (chat source, pin,
// Work on it, focus); once true it stays true for as long as the task is on
// the board. taskStates (summarizeBacklog) or autoBuild lets approval be seen.
// watchAll: true also reads the tasks nobody owns, and keeps only what needs
// the owner there (parked, held — the loop guard's or the owner's own — and
// needs-approval) in `attention`, same shape, so the host can roll them into
// one "needs you" notice. An owned task's approval wait goes to attention
// too: switching Verify first on moves every owned card at once, and that is
// one rolled-up notice, not one line per card. attention is always there
// (empty without watchAll unless an owned card waits for approval). Each list
// holds at most EVENTS_MAX rows; a task past the cap keeps its previous index
// entry (a first-seen one is left out of the index), so the next call reports
// it instead of losing it.
function taskEvents(previousIndex, tasks, options = {}) {
  const opts = plainObject(options) ?? {};
  const now = timeOf(opts.now);
  const isOwned = typeof opts.isOwned === "function" ? opts.isOwned : () => false;
  const watchAll = opts.watchAll === true;
  const baseline = !plainObject(previousIndex);
  const previous = baseline ? {} : previousIndex;
  const states = new Map();
  for (const state of rows(opts.taskStates)) {
    const id = idOf(state.id);
    if (id && !states.has(id)) states.set(id, state);
  }
  const autoBuild = opts.autoBuild !== false;
  const index = {};
  const events = [];
  const attention = [];
  const seen = new Set();
  // false when the list is full: the caller keeps the task's last look.
  const emit = (list, taskId, title, kind, text) => {
    if (list.length >= EVENTS_MAX) return false;
    list.push({ taskId, title, kind, text: cut(text, 320), at: now });
    return true;
  };
  for (const task of rows(tasks)) {
    const id = idOf(task.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const prev = readEntry(own(previous, id));
    let owned = prev?.owned === true;
    if (!owned) {
      try {
        owned = Boolean(isOwned(task));
      } catch {
        owned = false;
      }
    }
    // Only the task's own parks and holds matter here, so no board is passed:
    // a prerequisite wait is not something the worker did.
    const state = stateOf(task, now, { autoBuild });
    const given = plainObject(states.get(id));
    const cur = indexEntry(task, typeof given?.stage === "string" ? given.stage : state.stage, owned);
    index[id] = cur;
    if (baseline || (!owned && !watchAll)) continue;
    const before = prev ?? NEW_ENTRY;
    const kind = transition(before, cur, state, !prev);
    if (!kind) continue;
    const list = kind === "needs-approval" ? attention : owned ? events : ATTENTION_KINDS.has(kind) ? attention : null;
    if (!list || emit(list, id, cur.title, kind, eventText(kind, task, before, cur, state, now))) continue;
    // Over the cap: unreported, so the next call compares from the last look.
    if (prev) index[id] = { ...prev, owned: prev.owned || owned };
    else delete index[id];
  }
  if (!baseline) {
    for (const id of Object.keys(previous).slice(0, BOARD_MAX)) {
      if (seen.has(id) || id === "__proto__") continue;
      const prev = readEntry(previous[id]);
      if (!prev?.owned || !["open", "running", "review"].includes(prev.cls)) continue;
      if (!emit(events, id, prev.title, "removed", eventText("removed", { title: prev.title }, prev, { cls: "gone" }, {}, now))) index[id] = prev;
    }
  }
  return { index, events, attention };
}

// ---- 3. the chat action vocabulary ------------------------------------------------

const RUN_ROLES = Object.freeze(["keeper", "auditor", "watcher", "compactor", "overseer"]);
const ROLE_ALIASES = Object.freeze({
  keeper: "keeper", tidy: "keeper",
  auditor: "auditor", fix: "auditor",
  watcher: "watcher", organize: "watcher", organise: "watcher",
  compactor: "compactor", compact: "compactor",
  overseer: "overseer", review: "overseer",
});

// gate: how the owner's own words decide an action (validateChatActions).
//   asked+named  runs when one clause of the owner's message asks for this
//                kind (explicitlyAsked) and names this card (targetNamed),
//                and no clause names it with that kind negated; otherwise an
//                Ask card.
//   asked        runs when the owner asked for it; otherwise an Ask card.
//   confirm      never runs from chat: always an Ask card (the host's approve
//                card carries the scope the owner reviews).
//   label        picks an option of an offer only when a clause of the
//                owner's says the offer's title (never the "Work on" prefix
//                or a bare yes); every other Ask is click-only.
//   request      runs on a request; otherwise it is offered, never created.
//   role         runs on that role's own words; otherwise refused.
// explicit: explicitlyAsked knows words for the kind, so an unasked action of
// that kind waits for the owner's click (or, for answer, their card).
const CHAT_ACTION_KINDS = Object.freeze({
  create_task: Object.freeze({ explicit: false, gate: "request", args: Object.freeze(["title", "brief"]), does: "create a task for new work the owner asked for (title <=90 chars; brief <=2000 is your reading, the owner's own words become its prompt)" }),
  work_on: Object.freeze({ explicit: true, gate: "asked+named", args: Object.freeze(["taskId"]), does: "start, prioritise or re-arm an existing task" }),
  retry: Object.freeze({ explicit: true, gate: "asked+named", args: Object.freeze(["taskId"]), does: "re-arm a parked, held, stopped or cooling task without putting it first" }),
  stop: Object.freeze({ explicit: true, gate: "asked+named", args: Object.freeze(["taskId"]), does: "stop that task's running worker; its progress is saved" }),
  mark_done: Object.freeze({ explicit: true, gate: "asked+named", args: Object.freeze(["taskId"]), does: "mark a task done because the owner says it is" }),
  approve: Object.freeze({ explicit: true, gate: "confirm", args: Object.freeze(["taskId"]), does: "approve a Verify-first task so it can build (the owner always confirms it on a card)" }),
  note: Object.freeze({ explicit: true, gate: "asked+named", args: Object.freeze(["taskId", "text"]), does: "pass the owner's message to the next worker as a note (their words are stored, not yours)" }),
  answer: Object.freeze({ explicit: true, gate: "label", args: Object.freeze(["questionId", "optionId"]), does: "pick the option of an open offer the owner named; every other Ask is answered on its card" }),
  pause: Object.freeze({ explicit: true, gate: "asked", args: Object.freeze([]), does: "stop starting new work; running workers finish" }),
  resume: Object.freeze({ explicit: true, gate: "asked", args: Object.freeze([]), does: "start new work again" }),
  run_role: Object.freeze({ explicit: false, gate: "role", args: Object.freeze(["role"]), does: "run keeper (tidy), auditor (fix), watcher (organize), compactor (compact) or overseer (review) now" }),
});

const ACTIONS_SCANNED = 32;

// A short JSON-safe picture of an action that was refused, for the log.
function sketch(raw) {
  if (!plainObject(raw)) return { value: clip(Array.isArray(raw) ? "[array]" : raw, 80) };
  const out = {};
  for (const key of Object.keys(raw).slice(0, 6)) {
    if (key === "__proto__") continue;
    const value = raw[key];
    out[clip(key, 40)] = value && typeof value === "object" ? (Array.isArray(value) ? "[array]" : "[object]") : clip(value, 80);
  }
  return out;
}

function taskIdIn(value, ids) {
  const id = clip(value, 200);
  if (!id) return { error: "missing taskId" };
  if (ids.has(id)) return { id };
  // A model may echo the tree's "task:<id>" form.
  const bare = id.replace(/^task:/, "");
  return ids.has(bare) ? { id: bare } : { error: `unknown task id "${clip(id, 60)}"` };
}

function checkAction(raw, ids, questions) {
  const action = plainObject(raw);
  if (!action) return { error: "not an action object" };
  const kind = clip(action.kind ?? action.type ?? action.action, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (!kind) return { error: "missing kind" };
  if (!own(CHAT_ACTION_KINDS, kind)) return { error: `unknown kind "${kind}"` };
  // Arguments may sit beside the kind or under args; nothing else is kept.
  const args = { ...action, ...(plainObject(action.args) ?? {}) };
  switch (kind) {
    case "create_task": {
      const title = clip(args.title, 90);
      if (!title) return { error: "create_task needs a title" };
      const brief = clipBlock(args.brief ?? args.prompt, 2000);
      return { action: brief ? { kind, title, brief } : { kind, title } };
    }
    case "work_on":
    case "retry":
    case "stop":
    case "mark_done":
    case "approve": {
      const task = taskIdIn(args.taskId ?? args.task_id ?? args.id, ids);
      return task.error ? { error: task.error } : { action: { kind, taskId: task.id } };
    }
    case "note": {
      const task = taskIdIn(args.taskId ?? args.task_id ?? args.id, ids);
      if (task.error) return { error: task.error };
      const text = clipBlock(args.text ?? args.note, 400);
      return text ? { action: { kind, taskId: task.id, text } } : { error: "note needs text" };
    }
    case "answer": {
      const questionId = clip(args.questionId ?? args.question_id ?? args.question, 200);
      const question = questions.find((entry) => idOf(entry.id) === questionId);
      if (!question) return { error: questionId ? `no open question "${clip(questionId, 60)}"` : "missing questionId" };
      const wanted = clip(args.optionId ?? args.option_id ?? args.option, 120);
      const options = rows(question.options);
      // The model may name the option by its label instead of its id.
      const option = options.find((entry) => clip(entry.id, 40) === wanted)
        ?? options.find((entry) => wanted && clip(entry.label, 120).toLowerCase() === wanted.toLowerCase());
      if (!option) return { error: wanted ? `no option "${clip(wanted, 60)}" on that question` : "missing optionId" };
      return { action: { kind, questionId, optionId: clip(option.id, 40) }, label: clip(option.label, 120), question };
    }
    case "pause":
    case "resume":
      return { action: { kind } };
    case "run_role": {
      const role = own(ROLE_ALIASES, clip(args.role, 40).toLowerCase());
      return role ? { action: { kind, role } } : { error: `unknown role "${clip(args.role, 40)}"` };
    }
    default:
      return { error: `unknown kind "${kind}"` };
  }
}

// Where one checked action goes: { to: "run" | "confirm", action? }, or
// { reason, offer? } when it is refused. action, when given, replaces the
// checked one: a note stores the owner's message (the model's text is kept as
// modelText, for the log only), and a new task carries the owner's message as
// ownerText beside the model's brief.
function gateOf(checked, words) {
  const action = checked.action;
  const { text, names, intent, ownerNote, ownerText } = words;
  switch (action.kind) {
    case "work_on":
    case "retry":
    case "stop":
    case "mark_done":
    case "note": {
      let final = action;
      if (action.kind === "note") {
        if (!ownerNote) return { reason: "a note needs the owner's own words" };
        final = { kind: "note", taskId: action.taskId, text: ownerNote, modelText: clip(action.text, 200) };
      }
      const asked = kindAsked(names, action.kind, action.taskId)
        || ((action.kind === "work_on" || action.kind === "retry") && affirmedIn(names, action.taskId));
      return { to: asked ? "run" : "confirm", action: final };
    }
    case "approve":
      return { to: "confirm" };
    case "answer": {
      const question = plainObject(checked.question) ?? {};
      if (question.source !== "offer" && question.kind !== "suggestion") return { reason: "click-only: answer it on its card" };
      return labelNamed(names.message, checked.label) ? { to: "run" } : { reason: "the owner did not name that option: answer it on its card" };
    }
    case "pause":
    case "resume":
      return { to: messageAsks(names.message, EXPLICIT_WORDS[action.kind]) ? "run" : "confirm" };
    case "create_task":
      if (intent !== "request" && !workAsked(text)) return { reason: "not asked for; offer it instead", offer: true };
      return { to: "run", action: ownerText ? { ...action, ownerText } : action };
    case "run_role":
      return roleAsked(action.role, names.message) ? { to: "run" } : { reason: `not asked for: the owner did not ask for the ${action.role}` };
    default:
      return { reason: `unknown kind "${action.kind}"` };
  }
}

// The actions a chat reply asked for, checked against the board it was shown
// and the owner's own words (each kind's gate in CHAT_ACTION_KINDS):
//   run       plainly asked for, on a card the owner's words name;
//   confirm   what the owner did not plainly ask for: the host raises an Ask;
//   rejected  with the reason: invalid, a duplicate, a second action on one
//             task, a second stop or role run, over the limit, an Ask that
//             is click-only, or work nobody asked for;
//   offer     that unasked-for work as { title }, for the host to offer.
// context: text (the owner's message), taskIds, questions (the open Asks as
// saved, with source, kind and context), limit, and for naming a card:
// titles and stages (id -> text, object or Map, for every task the model was
// shown), allTitles (id -> title for the whole live board, object or Map:
// a word names a card only when no title on the board shares it, so a card
// the digest clipped is never mistaken for a shown one), referents ({ focus,
// notice, offers }: what "it" and "yes" can point at) and intent (the local
// classifier's reading of the message).
// One stop per message unless the owner said all, every, both or each; a
// stop the owner named keeps its slot over one they did not.
function validateChatActions(actions, context = {}) {
  const ctx = plainObject(context) ?? {};
  const text = typeof ctx.text === "string" ? ctx.text : "";
  const ids = new Set();
  const given = ctx.taskIds instanceof Set ? [...ctx.taskIds] : Array.isArray(ctx.taskIds) ? ctx.taskIds : [];
  for (const id of given.slice(0, BOARD_MAX)) {
    const clean = idOf(id);
    if (clean) ids.add(clean);
  }
  const questions = rows(ctx.questions).filter((question) => (question.status ?? "open") === "open");
  const wanted = Math.floor(Number(ctx.limit));
  const limit = Number.isFinite(wanted) ? Math.max(1, Math.min(12, wanted)) : 4;
  const list = Array.isArray(actions) ? actions : plainObject(actions) ? [actions] : [];
  const names = nameContext(text, ctx);
  const words = { text, names, intent: clip(ctx.intent, 40).toLowerCase(), ownerNote: clip(text, 400), ownerText: clipBlock(text, 2000) };
  const stopsAllowed = /\b(?:all|every\w*|both|each)\b/.test(names.said) ? limit : 1;
  const entries = list.slice(0, ACTIONS_SCANNED).map((raw) => {
    const checked = checkAction(raw, ids, questions);
    return checked.error ? { raw, checked, gate: null } : { raw, checked, gate: gateOf(checked, words) };
  });
  // How many stops the owner named are still to come after each entry.
  const namedStopsAfter = entries.map(() => 0);
  for (let index = entries.length - 2; index >= 0; index -= 1) {
    const next = entries[index + 1];
    namedStopsAfter[index] = namedStopsAfter[index + 1] + (next.gate?.to === "run" && next.checked.action.kind === "stop" ? 1 : 0);
  }
  const run = [];
  const confirm = [];
  const rejected = [];
  const offer = [];
  const seen = new Set();
  const touched = new Set();
  let stops = 0;
  let roles = 0;
  entries.forEach(({ raw, checked, gate }, index) => {
    if (checked.error) { rejected.push({ action: sketch(raw), reason: checked.error }); return; }
    const action = checked.action;
    const key = JSON.stringify(action);
    if (seen.has(key)) { rejected.push({ action, reason: "duplicate" }); return; }
    seen.add(key);
    if (action.taskId && touched.has(action.taskId)) { rejected.push({ action, reason: "one action per task" }); return; }
    if (gate.reason) {
      rejected.push({ action, reason: gate.reason });
      if (gate.offer && offer.length < 4 && !offer.some((entry) => entry.title === action.title)) offer.push({ title: action.title });
      return;
    }
    if (action.kind === "stop") {
      const free = stopsAllowed - stops;
      if (free <= 0 || (gate.to === "confirm" && free <= namedStopsAfter[index])) { rejected.push({ action, reason: "one stop per message" }); return; }
    }
    if (action.kind === "run_role" && roles >= 1) { rejected.push({ action, reason: "one role run per message" }); return; }
    if (run.length + confirm.length >= limit) { rejected.push({ action, reason: `over the limit of ${limit} actions` }); return; }
    (gate.to === "run" ? run : confirm).push(gate.action ?? action);
    if (action.taskId) touched.add(action.taskId);
    if (action.kind === "stop") stops += 1;
    if (action.kind === "run_role") roles += 1;
  });
  if (list.length > ACTIONS_SCANNED) rejected.push({ action: { value: `${list.length - ACTIONS_SCANNED} more` }, reason: "too many actions" });
  return { run, confirm, rejected, offer };
}

// ---- explicit asks -----------------------------------------------------------------

// Filler that may open a message before its real first word.
const FILLER = /^(?:(?:ok|okay|so|well|hey|hi|hello|hmm+|um+|uh+|and|but|also|then|alright|right|oh|btw|please|pls|mefi|assistant)\b[\s,.!:;-]*)+/;
// A question or a hedge is never an instruction, whatever words follow.
const INTERROGATIVE = /^(?:(?:what|what's|whats|why|how|how's|when|where|which|who|who's|whom|whose|is|isn't|are|aren't|was|wasn't|were|weren't|am|does|doesn't|did|didn't|can|can't|could|couldn't|would|wouldn't|should|shouldn't|shall|will|won't|may|might|must|has|hasn't|have|haven't|had|hadn't|maybe|perhaps)\b|(?:do|don't)\s+(?:you|we|i|they|he|she|u)\b|i\s+wonder\b)/;
const QUESTION_END = /\?[\s"'`)\]!.?]*$/;
const CONDITIONAL = /\b(?:if|once|when|whenever|after|until|unless|before|whether|in case)\b/;
// A negation anywhere from its clause's start to the verb, however far back
// ("do not for any reason at all stop X", "there is no need to stop X"), and
// telling the assistant to stop saying something ("stop saying it is done").
const NEGATION = /\b(?:don't|dont|do not|never|not|won't|wont|shouldn't|wouldn't|can't|cant|cannot|nothing|without|no need|no reason|no point|isn't|aren't|wasn't|weren't|doesn't|didn't|hasn't|haven't|neither|nor|hold off|refrain|avoid)\b|\b(?:stop|quit)\s+(?:saying|telling|claiming|calling|marking|reporting|pretending|asking)\b/;
const NEGATION_ALL = new RegExp(NEGATION.source, "g");
// The owner as the subject of a plan ("I'll stop it myself", "we're going to
// retry it", "let me note that"): what they will do, not an ask, for every
// kind. "I'd like you to" and "I want you to" still ask.
const SELF_FUTURE = /\b(?:i|we)(?:'ll|\s+will|\s+shall|'m\s+(?:going\s+to|gonna|about\s+to)|\s+am\s+(?:going\s+to|gonna|about\s+to)|'re\s+(?:going\s+to|gonna|about\s+to)|\s+are\s+(?:going\s+to|gonna|about\s+to)|\s+(?:was|were)\s+(?:going\s+to|gonna)|(?:'d|\s+would|\s+could|\s+can|\s+might|\s+may)(?!\s+(?:like|love|prefer|want|need)\b)|\s+(?:plan|intend|want|need|have|got|mean)\s+to|\s+gotta)\b|\blet\s+(?:me|us)\b/;
const SELF_FUTURE_ALL = new RegExp(SELF_FUTURE.source, "g");
const MYSELF = /\b(?:myself|ourselves)\b/;
// For the kinds that act on a card for the owner, any "I" before the verb
// ("I retry it when...") makes it the owner's own doing.
const SELF = /\b(?:i|let me)\b/;
const SELF_KINDS = new Set(["work_on", "retry", "note"]);
// Hands off a card: a veto on every kind for the cards the clause names.
const HANDS_OFF = /\bleave\b(?:\s+\S+){0,6}?\s+(?:alone|be|running|going|as\s+is)\b|\b(?:keep|let)\b(?:\s+\S+){1,3}?\s+(?:running|going|run|finish|continue|be)\b|\bhold\s+off\b|\b(?:don't|do\s+not|never)\s+touch\b|\bhands\s+off\b/;
// Said not to be done: a veto on marking the card the clause names done.
const NOT_DONE = /\b(?:not|never|isn't|aren't|wasn't|weren't|ain't)\s+(?:yet\s+|really\s+|quite\s+|fully\s+|actually\s+)?(?:done|finished|complete|completed)\b/g;
const EXPLICIT_WORDS = Object.freeze({
  stop: /\b(?:stop|cancel|kill|halt|abort|interrupt)\b(?!\s+(?:new\b|taking|starting|picking|queu|asking|telling|saying|suggesting|offering|talking|replying|posting|notifying))/g,
  mark_done: /\bmark\b(?:\s+[^\s.!;]+){0,8}?\s+(?:as\s+)?(?:done|complete|completed|finished|closed)\b|\bclose\b(?!\s+(?:to|enough|call|by)\b)|\b(?:is|it's|that's|this is|they're|are|was)\s+(?:already\s+|now\s+|all\s+)?(?:done|finished|complete|completed)\b|^(?:done|finished|complete|completed)\b/g,
  approve: /\b(?:approve|approved|go ahead|build it|ship it|green\s?light|lgtm)\b/g,
  pause: /\bpause\b|\bhold\s+(?:off|new|all|everything|the\s+(?:queue|builders?|workers?))\b|\bstop\s+(?:all\s+)?(?:new|taking|starting|picking|queu\w*)\b|\bno\s+new\s+work\b/g,
  resume: /\b(?:resume|unpause|un-pause|start\s+(?:again|back\s+up)|carry\s+on|keep\s+going)\b/g,
  answer: /\b(?:yes|yeah|yep|yup|ok|okay|sure|go|go\s+for\s+it|do\s+it|do\s+that|please\s+do|sounds\s+good|let's\s+do\s+it)\b/g,
  work_on: /\b(?:start|run|work\s+on|do\s+it|do\s+that|begin|kick\s+off|pick\s+up|prioriti[sz]e|go\s+ahead\s+with|continue|put\s+it\s+first|next(?!\s+(?:time|week|month|year|day|morning|session|to)\b))\b/g,
  retry: /\b(?:retry|try\s+(?:it\s+|that\s+)?again|re-?run|rerun|re-?arm|restart|unpark|unblock|give\s+it\s+another\s+(?:go|try))\b/g,
  note: /\b(?:note|tell\s+(?:it|the\s+worker|them)|remind(?!\s+me\b)|let\s+(?:it|the\s+worker|them)\s+know|add\s+(?:a\s+)?note|mention\s+to)\b/g,
});
// run_role's own words, per role; its name counts too ("run the keeper").
const ROLE_WORDS = Object.freeze({
  keeper: /\b(?:keeper|tidy|clean|clean-?up|prune|archive)\b/g,
  auditor: /\b(?:auditor|audit|fix|repair|problems)\b/g,
  watcher: /\b(?:watcher|organi[sz]e|tree|fold)\b/g,
  compactor: /\b(?:compactor|compact|dedupe|de-dupe|queue|backlog)\b/g,
  overseer: /\b(?:overseer|oversee|review|health)\b/g,
});
// A new task's message opens with the work itself.
const WORK_VERB = /^(?:add|make|build|write|create|implement|change|update|fix|refactor|rename|move|wire|improve|upgrade|remove|delete|ship|test|document)\b/;
const LABEL_STOP_WORDS = new Set(["the", "and", "for", "this", "that", "with", "them", "its", "it's", "you", "your", "my", "our", "a", "an", "to", "of", "on", "in", "it"]);

function askText(text) {
  return String(typeof text === "string" ? text : "").slice(0, 2000).normalize("NFKC").toLowerCase()
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, "\"").replace(/[^\S\n]+/g, " ").replace(/ ?\n[\s]*/g, "\n").trim();
}

// A message reads clause by clause. It splits at , ; . ! ? : (before a space
// or the end), a dash between spaces, a line break and the joining words;
// its sentences end at . ! ? ; : and line breaks. A quoted title never splits
// a clause and never reads as a cue.
const CLAUSE_CUT = /[,;.!?:]+(?=\s|$)|\s[-–—]+(?=\s)|[–—]|\n|\b(?:and|but|then|also|while|whereas)\b/g;
const SENTENCE_CUT = /[.!?;:\n]/;
// "instead of X", "rather than X", "except X": X is what the owner does not mean.
const CLAUSE_EXCEPT = /\b(?:instead\s+of|rather\s+than|except(?:\s+for)?|other\s+than|apart\s+from)\b/g;
// What may trail a negation or a plan that goes on past a comma: "we agreed
// not to ever, under any circumstances, stop X".
const DANGLING = /^(?:\s|\b(?:to|ever|even|again|please|pls|just|really|you|u|at|all|for|any|reason|reasons|under|circumstances?|case|whatsoever|anymore|and|or|neither|nor)\b)*$/;
// A clause that only adds names to the one before it ("stop the auth build
// and the login page", "stop X, not Y") opens like a name and has no verb.
const VERBISH = /\b(?:is|are|was|were|be|been|being|am|isn't|aren't|wasn't|weren't|it's|that's|there's|here's|what's|he's|she's|they're|we're|you're|i'm|has|have|had|hasn't|haven't|hadn't|does|did|do|doesn't|didn't|don't|can|can't|cannot|could|couldn't|will|won't|would|wouldn't|should|shouldn't|shall|may|might|must|seems?|seemed|looks?|looked|keeps?|kept|goes|went|gone|works|worked|breaks|broke|broken|fails|failed|needs|needed|wants|wanted|thinks?|thought|knows?|knew|says|said|means|meant|agreed?|gets|got|feels?|felt|matters?|let|leave|left|makes|made)\b/;
const SUBJECT = /\b(?:i|we|you|he|she|they)\b/;
const NAME_OPENER = /^\s*(?:(?:the|a|an|that|this|these|those|my|our|your|its|their|both|either|each|every|all|also|too|plus|not|task|tasks|card|cards)\b|["']|[\p{L}\p{N}]*[\d_][\p{L}\p{N}_:-]*(?![\p{L}\p{N}]))/u;
// The kinds whose words make a clause an instruction of its own.
const ACTION_KINDS = Object.freeze(["stop", "mark_done", "approve", "retry", "work_on", "note", "pause", "resume"]);
const CLAUSES_MAX = 48;

// The clause a match at `at` belongs to (one in the gap before a clause
// belongs to it), or -1.
function clauseAt(message, at) {
  const { clauses } = message;
  for (let index = 0; index < clauses.length; index += 1) {
    if (at < clauses[index].to) return index;
  }
  return -1;
}

// The last match of cue in text is followed only by words that leave it
// waiting for the next clause ("do not, for any reason, stop X").
function dangles(text, cue) {
  let last = null;
  cue.lastIndex = 0;
  for (const match of text.matchAll(cue)) last = match;
  return Boolean(last) && DANGLING.test(text.slice(last.index + last[0].length));
}

// One message, read once: said (normalised), core (said after its opening
// filler, or said itself with keepFiller), plain (not a question and not
// opened like one), masked (core with quoted titles blanked), the quoted
// spans, and the clauses — each with its sentence's condition, a negation or
// plan carried over from a clause that left it dangling, whether it has an
// action word of its own, keeps its hands off a card, or only adds names.
function readMessage(text, keepFiller = false) {
  const said = askText(text);
  const stripped = said.replace(FILLER, "");
  const core = keepFiller ? said : stripped;
  const message = { said, core, masked: core, plain: Boolean(said) && !QUESTION_END.test(said) && !INTERROGATIVE.test(stripped), clauses: [], spans: [], sentences: new Map(), hits: new Map() };
  if (!core) return message;
  let masked = core;
  QUOTED.lastIndex = 0;
  for (const match of core.matchAll(QUOTED)) {
    const inner = match[1] ?? match[2] ?? "";
    const end = match.index + match[0].length;
    const open = end - inner.length - 2;
    masked = `${masked.slice(0, open)}${" ".repeat(end - open)}${masked.slice(end)}`;
    const span = inner.replace(/[\s.,!?;:]+$/, "").trim();
    if (span.length >= 2 && message.spans.length < 8) message.spans.push({ span, at: open + 1 });
  }
  message.masked = masked;
  const cuts = [];
  for (const match of masked.matchAll(CLAUSE_CUT)) cuts.push({ from: match.index, to: match.index + match[0].length, sentence: SENTENCE_CUT.test(match[0]), except: false });
  for (const match of masked.matchAll(CLAUSE_EXCEPT)) cuts.push({ from: match.index, to: match.index + match[0].length, sentence: false, except: true });
  cuts.sort((a, b) => a.from - b.from || b.to - a.to);
  const { clauses, sentences } = message;
  let from = 0;
  let sentence = 0;
  let except = false;
  const close = (to) => {
    if (!core.slice(from, to).trim()) return;
    clauses.push({ from, to, text: core.slice(from, to), masked: masked.slice(from, to), sentence, except });
    except = false;
  };
  for (const cut of cuts) {
    if (cut.from < from) continue;
    if (clauses.length >= CLAUSES_MAX - 1) break;
    close(cut.from);
    from = cut.to;
    if (cut.sentence) sentence += 1;
    if (cut.except) except = true;
  }
  close(core.length);
  for (const clause of clauses) sentences.set(clause.sentence, `${sentences.get(clause.sentence) ?? ""} ${clause.masked}`);
  const acting = new Set();
  for (const kind of ACTION_KINDS) {
    const pattern = EXPLICIT_WORDS[kind];
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const index = clauseAt(message, match.index);
      if (index >= 0) acting.add(index);
    }
  }
  let carryNeg = false;
  let carrySelf = false;
  clauses.forEach((clause, index) => {
    if (index > 0 && clauses[index - 1].sentence !== clause.sentence) { carryNeg = false; carrySelf = false; }
    clause.conditional = CONDITIONAL.test(sentences.get(clause.sentence) ?? "");
    clause.carryNeg = carryNeg;
    clause.carrySelf = carrySelf;
    clause.acting = acting.has(index);
    clause.handsOff = HANDS_OFF.test(clause.masked);
    // A carried negation or plan lands on the next clause with a verb.
    if (clause.acting) { carryNeg = false; carrySelf = false; }
    if (dangles(clause.masked, NEGATION_ALL)) carryNeg = true;
    if (dangles(clause.masked, SELF_FUTURE_ALL)) carrySelf = true;
    clause.words = wordsOf(clause.text);
    clause.spoken = clause.words.filter((word) => word.length >= 4 && /\p{L}/u.test(word) && !COMMON_WORDS.has(word));
    clause.spans = message.spans.filter((entry) => entry.at >= clause.from && entry.at < clause.to).map((entry) => entry.span);
    clause.names = !clause.acting && !clause.handsOff && clause.words.length <= 10 && NAME_OPENER.test(clause.text)
      && !VERBISH.test(clause.masked) && !SUBJECT.test(clause.masked);
  });
  return message;
}

// What each clause says about one kind of ask: asked (plainly: not negated,
// not conditional, not a plan of the owner's), negated (a veto on the cards
// the clause names), own (it holds the kind's word or keeps its hands off).
// A clause that only adds names reads as the one before it: "stop X and Y",
// "don't stop X or Y", "stop X, not Y". veto: words that negate the kind
// wherever they are ("X is not done" for mark_done).
function patternHits(message, pattern, selfBroad = false, veto = null) {
  const hits = message.clauses.map((clause) => ({ asked: false, negated: clause.handsOff, own: clause.handsOff }));
  const read = (source, negate) => {
    source.lastIndex = 0;
    for (const match of message.masked.matchAll(source)) {
      const index = clauseAt(message, match.index);
      if (index < 0) continue;
      const clause = message.clauses[index];
      const hit = hits[index];
      hit.own = true;
      const prefix = message.masked.slice(clause.from, Math.max(clause.from, match.index));
      if (negate || clause.carryNeg || clause.except || NEGATION.test(prefix)) hit.negated = true;
      else if (!clause.conditional && !clause.carrySelf && !SELF_FUTURE.test(prefix) && !MYSELF.test(clause.masked) && !(selfBroad && SELF.test(prefix))) hit.asked = true;
    }
  };
  read(pattern, false);
  if (veto) read(veto, true);
  hits.forEach((hit, index) => {
    if (hit.own || index === 0) return;
    const clause = message.clauses[index];
    const prev = hits[index - 1];
    if (!clause.names || message.clauses[index - 1].sentence !== clause.sentence || (!prev.asked && !prev.negated)) return;
    const refused = clause.except || NEGATION.test(clause.masked);
    hit.asked = prev.asked && !refused;
    hit.negated = prev.negated || refused;
  });
  return hits;
}

// One card kind's clause readings for a message, worked out once.
function hitsOf(message, kind) {
  let hits = message.hits.get(kind);
  if (!hits) {
    hits = patternHits(message, EXPLICIT_WORDS[kind], SELF_KINDS.has(kind), kind === "mark_done" ? NOT_DONE : null);
    message.hits.set(kind, hits);
  }
  return hits;
}

// Some clause of a plain message asks for pattern.
function messageAsks(message, pattern, selfBroad = false) {
  return Boolean(message?.plain) && patternHits(message, pattern, selfBroad).some((hit) => hit.asked);
}

// The owner's words as an instruction matching pattern: not a question, not
// opened like one, and some clause plainly asks — neither negated from its
// start, conditional, nor (for every kind) a plan of the owner's own.
function askedIn(text, pattern, self = false) {
  return messageAsks(readMessage(text), pattern, self);
}

// Whether the owner's own words plainly ask for this kind of action. Built to
// miss rather than guess: a question ("should I stop X?", "is X done?") or a
// message that opens like one is never explicit, and only the explicit kinds
// have words (create_task and run_role are gated by workAsked and roleAsked
// instead, and return false here). For answer, context.label (the chosen
// option's label) also counts, and so does a bare "yes".
function explicitlyAsked(kind, text, context = {}) {
  const words = own(EXPLICIT_WORDS, kind);
  if (!words) return false;
  if (kind !== "answer") return askedIn(text, words, SELF_KINDS.has(kind));
  // "ok" and "yes" are filler elsewhere, but here they are the answer.
  const message = readMessage(text, true);
  if (!message.plain) return false;
  const { said } = message;
  const label = askText(plainObject(context)?.label);
  if (label && said.includes(label)) return true;
  const significant = (label.match(/[\p{L}\p{N}']+/gu) ?? []).filter((word) => word.length >= 2 && !LABEL_STOP_WORDS.has(word));
  const spoken = new Set(said.match(/[\p{L}\p{N}']+/gu) ?? []);
  if (significant.length && significant.every((word) => spoken.has(word))) return true;
  return messageAsks(message, words);
}

// An offer's option reads Work on "<title>"; the owner names it by the title.
const OFFER_LABEL = /^work on "(.+)"$/;
// A clause that takes the offer: a work word or a yes beside the title.
const OFFER_TAKEN = /\b(?:work\s+on|start|run|begin|kick\s+off|pick\s+up|prioriti[sz]e|go\s+ahead|go\s+for\s+it|do\s+it|do\s+that|continue|yes|yeah|yep|yup|ok|okay|sure|please|let's|sounds\s+good)\b/;
const AFFIRM_START = /^(?:yes|yeah|yep|yup|ok|okay|sure|alright|please|go\s+ahead|go\s+for\s+it|do\s+it|let's)\b/;

// The owner picked this option (message: readMessage's): a clause of theirs
// quotes the offer's title (what follows Work on, never the prefix) or holds
// every significant word of it, and is not negated, conditional or about what
// the owner will do; a Work on option also needs a work word or a yes beside
// the title. A clause that names the title negated vetoes it, and a bare
// "yes" or the prefix's words never pick anything. The title's own words are
// never cues: "Not now" answers the Not now option.
function labelNamed(message, label) {
  const wanted = askText(label);
  if (!message?.plain || !wanted) return false;
  const offer = wanted.match(OFFER_LABEL);
  const key = titleKey(offer ? offer[1] : wanted).replace(/[\s.,!?;:]+$/, "");
  if (!key) return false;
  const significant = [...new Set((key.match(/[\p{L}\p{N}']+/gu) ?? []).filter((word) => word.length >= 2 && !LABEL_STOP_WORDS.has(word)))];
  const blank = (text) => significant.reduce((out, word) => out.replace(new RegExp(`(?<![\\p{L}\\p{N}'])${word}(?![\\p{L}\\p{N}'])`, "gu"), " ".repeat(word.length)), text);
  const affirmed = AFFIRM_START.test(message.said);
  let named = false;
  for (const clause of message.clauses) {
    const spoken = new Set(clause.text.match(/[\p{L}\p{N}']+/gu) ?? []);
    if (!clause.spans.includes(key) && !(significant.length && significant.every((word) => spoken.has(word)))) continue;
    const masked = blank(clause.masked);
    if (clause.carryNeg || clause.except || NEGATION.test(masked)) return false;
    if (CONDITIONAL.test(blank(message.sentences.get(clause.sentence) ?? ""))) continue;
    if (clause.carrySelf || SELF.test(masked) || SELF_FUTURE.test(masked) || MYSELF.test(masked)) continue;
    if (offer && !OFFER_TAKEN.test(masked) && !(affirmed && !VERBISH.test(masked))) continue;
    named = true;
  }
  return named;
}

// A request for new work: the message opens with a work verb ("add", "fix").
function workAsked(text) {
  const said = askText(text);
  if (!said || QUESTION_END.test(said)) return false;
  return WORK_VERB.test(said.replace(FILLER, ""));
}

// message: readMessage's.
function roleAsked(role, message) {
  const words = own(ROLE_WORDS, role);
  return words ? messageAsks(message, words) : false;
}

// ---- naming a card ---------------------------------------------------------------------

// Words that never single a card out: the action vocabulary, filler, and the
// nouns every card shares. A card whose title says "retry" or "stop" is never
// named by an owner who used that word about another card.
const COMMON_WORDS = new Set([
  "this", "that", "these", "those", "with", "from", "into", "onto", "have", "what", "when", "where", "which", "while",
  "then", "than", "them", "they", "their", "there", "your", "yours", "ours", "mine", "please", "about", "would", "could",
  "should", "will", "just", "also", "some", "only", "very", "really", "again", "okay", "yeah", "sure", "thanks", "thank",
  "maybe", "right", "well", "good", "sounds", "fine", "anyway", "already", "later", "soon", "today", "still", "need",
  "want", "make", "like", "look", "check", "task", "tasks", "card", "cards", "build", "builds", "building", "built",
  "worker", "workers", "jobs", "work", "working", "thing", "things", "stuff", "stop", "stopped", "stopping", "cancel",
  "kill", "halt", "abort", "interrupt", "retry", "rerun", "restart", "unpark", "unblock", "rearm", "start", "started",
  "starting", "begin", "continue", "kick", "pick", "prioritise", "prioritize", "first", "next", "ahead", "give",
  "another", "mark", "done", "close", "closed", "finish", "finished", "complete", "completed", "approve", "approved",
  "ship", "note", "tell", "remind", "know", "mention", "pause", "resume", "keep", "going", "leave", "don't", "dont",
  "doesn't", "isn't", "it's", "that's", "let's",
]);
// Words about the moment or the work rather than names of it. A clause that
// names a card by one of its words may hold these beside it; any other word
// of 4+ letters must fit that card's title too, so "mark the login rate limit
// task done" names no "Login page redesign".
const FIT_STOP_WORDS = new Set([
  "even", "ever", "much", "many", "more", "most", "less", "such", "each", "both", "every", "either", "neither", "other",
  "else", "same", "here", "over", "under", "upon", "until", "unless", "because", "since", "though", "although", "after",
  "before", "during", "without", "within", "away", "back", "down", "once", "twice", "left", "whole", "entire", "time",
  "times", "tonight", "tomorrow", "yesterday", "morning", "evening", "night", "week", "weekend", "hour", "hours",
  "minute", "minutes", "moment", "anyone", "anybody", "anything", "anymore", "someone", "somebody", "something",
  "everyone", "everybody", "everything", "nothing", "nobody", "none", "whatever", "whenever", "wherever", "whether",
  "actually", "basically", "definitely", "probably", "totally", "finally", "quickly", "slowly", "immediately", "asap",
  "cool", "great", "nice", "awesome", "perfect", "alright", "hello", "perhaps", "instead", "rather", "except", "reason",
  "reasons", "circumstances", "circumstance", "case", "whatsoever", "myself", "yourself", "ourselves", "themselves",
  "itself", "keeps", "kept", "keeping", "failing", "failed", "fails", "broken", "broke", "breaking", "wrong", "stuck",
  "hanging", "looping", "taking", "takes", "took", "doing", "does", "been", "being", "were", "having", "gone", "goes",
  "went", "think", "thought", "guess", "seems", "seem", "seemed", "looks", "looked", "looking", "said", "says",
  "saying", "told", "telling", "knew", "known", "shipped", "fixed", "handled", "manually", "hand", "agreed", "agree",
  "mean", "means", "meant", "wait", "waiting", "happen", "happened", "happening", "matter", "matters", "worry",
  "mind", "sorry", "able", "enough", "slow", "long", "longer", "forever", "running", "runs", "finishing",
  "restarting", "retrying", "marking", "approving", "green", "light", "lgtm", "carry", "yours", "want", "wants",
  "wanted", "need", "needs", "needed", "should", "would", "could", "might", "must", "shall", "they", "them", "anyway",
  "again", "also", "just", "only", "really", "please", "still", "yeah", "okay", "sure", "thanks", "thank", "alone",
  "touch", "hold", "hands",
]);
const WORD = /[\p{L}\p{N}]+(?:'\p{L}+)?/gu;
const ID_CHAR = /[\p{L}\p{N}_]/u;
const QUOTED = /"([^"]{2,160})"|(?:^|[\s(\[{:,])'([^']{2,160}?)'(?=$|[\s.,!?;:)\]}])/g;
const PRONOUN = /\b(?:it|that|this|the\s+(?:task|card|build|job))\b/;
// A whole message that is only a command points at whatever is in view.
const BARE_COMMAND = /^(?:stop|cancel|halt|abort|kill|interrupt|retry|try\s+again|re-?run|rerun|re-?arm|restart|unpark|unblock|continue|start|begin|approve|go\s+ahead|kick\s+off|pick\s+up)(?:[\s,]+(?:again|now|please|anyway|then|already|thanks))*$/;
// ...and these are what a parked or stopped notice tells the owner to say.
const BARE_RESUME = /^(?:retry|try\s+(?:it\s+|that\s+)?again|re-?run|rerun|re-?arm|restart|unpark|unblock|continue|start|begin|work\s+on|give\s+it\s+another\s+(?:go|try))(?:\s+(?:it|that))?(?:\s+again)?(?:[\s,]+(?:now|please|anyway|then|thanks))*$/;
const AFFIRM_OPENING = /^(?:(?:yes|yeah|yep|yup|sure)\b[\s,.!:;-]*)+/;
const AFFIRMATION = /^(?:please do|let's do it|let's go|do it|do that|go ahead|go for it|sounds good|yes|yeah|yep|yup|okay|ok|sure|alright|please)\b[\s,.!]*/;
const AFFIRMED_TAIL = /^(?:(?:start|work\s+on)\s+(?:it|that)(?:\s+(?:now|please))*)?$/;
// The stages a notice asks the owner to move ("Say try again").
const WAITING_STAGES = new Set(["blocked", "parked"]);

const wordsOf = (text) => text.match(WORD) ?? [];
const titleKey = (title) => askText(title).replace(/(?:…|\.\.\.)$/, "").trim();
const overlaps = (span, key) => (span.length >= 2 && key.includes(span)) || (key.length >= 4 && span.includes(key));

// id -> text from a Map or a plain object, bounded and clipped.
function lookup(value, max) {
  const map = new Map();
  let entries = [];
  try {
    entries = value instanceof Map ? [...value.entries()] : plainObject(value) ? Object.entries(value) : [];
  } catch {
    entries = [];
  }
  for (const [key, text] of entries.slice(0, BOARD_MAX)) {
    const id = idOf(key);
    const clean = clip(text, max);
    if (id && clean && !map.has(id)) map.set(id, clean);
  }
  return map;
}

// { focus, notice, offers: [ids], offerCount }: an offer with no task id
// (new work) still counts, so "yes" never lands on the one that has one.
function referentsOf(value) {
  const given = plainObject(value) ?? {};
  const one = (entry) => idOf(typeof entry === "string" ? entry.replace(/^task:/, "") : "") || null;
  const offers = [];
  let offerCount = 0;
  for (const entry of Array.isArray(given.offers) ? given.offers.slice(0, 12) : []) {
    if (!entry) continue;
    const object = plainObject(entry);
    const id = one(object ? object.taskId ?? object.id ?? plainObject(object.target)?.id : entry);
    offerCount += 1;
    if (id && !offers.includes(id)) offers.push(id);
  }
  return { focus: one(given.focus), notice: one(given.notice), offers, offerCount };
}

// Everything naming needs from one message, worked out once. titles are the
// cards the owner can act on here (the digest's); allTitles, when given, is
// the whole live board, and a word singles a card out only when no title on
// it shares that word. A board title is whole where the digest's is clipped.
function nameContext(text, context) {
  const ctx = plainObject(context) ?? {};
  const message = readMessage(text);
  const { said } = message;
  const keys = new Map();
  const wordsBy = new Map();
  const counts = new Map();
  const add = (id, title) => {
    if (keys.has(id)) return;
    const key = titleKey(title);
    const words = new Set(wordsOf(key));
    keys.set(id, key);
    wordsBy.set(id, words);
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  };
  for (const [id, title] of lookup(ctx.allTitles, 200)) add(id, title);
  for (const [id, title] of lookup(ctx.titles, 200)) add(id, title);
  const referents = referentsOf(ctx.referents);
  const inView = [...new Set([referents.focus, referents.notice, ...referents.offers].filter(Boolean))];
  return {
    said,
    message,
    keys,
    wordsBy,
    counts,
    referents,
    stages: lookup(ctx.stages, 24),
    spoken: new Set(wordsOf(said).filter((word) => word.length >= 4 && /\p{L}/u.test(word) && !COMMON_WORDS.has(word))),
    core: said.replace(FILLER, "").replace(AFFIRM_OPENING, "").replace(FILLER, "").replace(/[\s.!,;:]+$/, ""),
    // The one card in view, or "" when there are none or several (an offer of
    // new work next to a card makes "it" ambiguous too).
    single: inView.length === 1 && referents.offerCount === referents.offers.length ? inView[0] : "",
    direct: null,
    mentioned: null,
    byClause: new Map(),
    through: new Map(),
  };
}

function idSaid(said, id) {
  const wanted = id.toLowerCase();
  if (wanted.length < 2) return false;
  for (let at = said.indexOf(wanted), guard = 0; at >= 0 && guard < 50; at = said.indexOf(wanted, at + 1), guard += 1) {
    const before = at > 0 ? said[at - 1] : " ";
    const after = said[at + wanted.length] ?? " ";
    if (!ID_CHAR.test(before) && !ID_CHAR.test(after)) return true;
  }
  return false;
}

// A quote names this card when it is its title, or fits it and no other title.
function spanNames(names, span, id, key) {
  if (span === key) return true;
  if (!overlaps(span, key)) return false;
  for (const [other, title] of names.keys) {
    if (other !== id && overlaps(span, title)) return false;
  }
  return true;
}

// A word fits a title when the title holds it, or it and a title word of 4+
// letters are one the other's stem ("auth" and "authorization", "logins").
function fitsWord(word, words) {
  if (words.has(word)) return true;
  for (const titleWord of words) {
    if (titleWord.length >= 4 && (word.startsWith(titleWord) || titleWord.startsWith(word))) return true;
  }
  return false;
}

// Every significant word of the clause fits the title, or only describes.
function fitsTitle(clause, words) {
  return clause.spoken.every((word) => FIT_STOP_WORDS.has(word) || fitsWord(word, words));
}

// The clauses (by index) that name this card outright: by id, by a quote that
// fits its title and no other (or is its title), or by a word of 4+ letters,
// not a command or filler word, that no other title holds. strict also asks
// that the clause's other significant words fit this title, so the card is
// the one meant; loose (a mention) does not, and serves vetoes, pronouns and
// ambiguity, where reading too much is the safe side.
function directClauses(names, id) {
  let found = names.byClause.get(id);
  if (found) return found;
  found = { strict: new Set(), loose: new Set() };
  names.byClause.set(id, found);
  const both = (index) => { found.strict.add(index); found.loose.add(index); };
  const { clauses, core } = names.message;
  if (!clauses.length) return found;
  if (idSaid(core, id)) {
    clauses.forEach((clause, index) => {
      if (idSaid(clause.text, id)) both(index);
    });
  }
  const key = names.keys.get(id);
  if (!key) return found;
  clauses.forEach((clause, index) => {
    if (clause.spans.some((span) => spanNames(names, span, id, key))) both(index);
  });
  const words = names.wordsBy.get(id);
  const only = (word) => words.has(word) && names.counts.get(word) === 1;
  if (![...names.spoken].some(only)) return found;
  clauses.forEach((clause, index) => {
    if (!clause.spoken.some(only)) return;
    found.loose.add(index);
    if (fitsTitle(clause, words)) found.strict.add(index);
  });
  return found;
}

// Every card the message names outright (or, loose, mentions), anywhere.
function directIds(names, loose = false) {
  const slot = loose ? "mentioned" : "direct";
  if (!names[slot]) {
    names[slot] = new Set();
    for (const id of names.keys.keys()) {
      if (directClauses(names, id)[loose ? "loose" : "strict"].size) names[slot].add(id);
    }
  }
  return names[slot];
}

// The cards mentioned outright in the clauses up to and including this one.
function namedThrough(names, index) {
  let found = names.through.get(index);
  if (!found) {
    found = new Set();
    for (const id of directIds(names, true)) {
      for (const at of directClauses(names, id).loose) {
        if (at <= index) { found.add(id); break; }
      }
    }
    names.through.set(index, found);
  }
  return found;
}

// A whole message that is only a command ("stop", "try again") and mentions
// no card points at the one card in view; a bare "try again" also answers the
// newest notice's parked or stopped card when the reply offered nothing.
function bareNamed(names, id) {
  if (directIds(names, true).size) return false;
  const resume = BARE_RESUME.test(names.core);
  if ((resume || BARE_COMMAND.test(names.core)) && names.single === id) return true;
  const { referents } = names;
  return resume && referents.offerCount === 0 && referents.notice === id && WAITING_STAGES.has(names.stages.get(id) ?? "");
}

// Whether clause `index` names this card: outright; by a pronoun ("it",
// "that", "the build") for the one card mentioned up to it (named outright
// somewhere), or, when the message mentions no card at all, the one card in
// view; or as a bare command. Words that name another card are about that
// card, whatever "it" says. liberal (for a veto) reads mentions as names and
// lets a pronoun before any mention mean the card in view.
function clauseNames(names, index, id, liberal = false) {
  const direct = directClauses(names, id);
  if ((liberal ? direct.loose : direct.strict).has(index)) return true;
  const clause = names.message.clauses[index];
  if (clause && PRONOUN.test(clause.masked)) {
    const before = namedThrough(names, index);
    if (before.size === 1) {
      if (before.has(id) && (liberal || direct.strict.size)) return true;
    } else if (!before.size && (liberal || !directIds(names, true).size) && names.single === id) {
      return true;
    }
  }
  return bareNamed(names, id);
}

function namedIn(names, taskId) {
  const id = idOf(taskId);
  if (!id || !names.said) return false;
  return names.message.clauses.some((_, index) => clauseNames(names, index, id));
}

// The owner asked for this kind on this card: a clause of a plain message
// holds the kind's word and names the card, and no clause names the card
// with that kind negated — "don't stop X, stop Y" never stops X, and neither
// does "I will stop X myself" or "there is no need to stop X".
function kindAsked(names, kind, taskId) {
  const id = idOf(taskId);
  const { message } = names;
  if (!id || !message.plain || !own(EXPLICIT_WORDS, kind)) return false;
  const hits = hitsOf(message, kind);
  let asked = false;
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    if (hit.negated && clauseNames(names, index, id, true)) return false;
    if (hit.asked && clauseNames(names, index, id)) asked = true;
  }
  return asked;
}

// The whole message is a yes ("yes", "ok, start it", "go ahead"), optionally
// with "start it" or "work on it" after it.
function bareAffirmation(said) {
  let rest = said.replace(/[\s.!]+$/, "");
  let affirmed = false;
  for (let guard = 0; guard < 8 && rest; guard += 1) {
    const match = rest.match(AFFIRMATION);
    if (!match) break;
    affirmed = true;
    rest = rest.slice(match[0].length);
  }
  return affirmed && AFFIRMED_TAIL.test(rest.trim());
}

// A plural yes ("all of them", "both", "yes, all", "start them all"):
// the whole message says every one of what was just offered.
const PLURAL_AFFIRMATION = /^(?:(?:yes|yeah|yep|yup|ok|okay|sure|please|go\s+ahead)\b[\s,.!:;-]*)*(?:(?:please\s+)?(?:do|start|run|work\s+on|handle|take|try|retry|go\s+with|tackle)\s+)?(?:(?:them|those|these)\s+all|all(?:\s+(?:of\s+)?(?:them|those|these|the\s+above))?|both(?:\s+of\s+(?:them|those|these))?|each(?:\s+of\s+(?:them|those|these)|\s+one)?|every(?:\s*one|thing)(?:\s+of\s+(?:them|those|these))?|(?:yes\s+)?to\s+all|all\s+(?:two|three|four|\d))(?:[\s,.!]+(?:please|now|then|too|as\s+well|of\s+them|thanks|thank\s+you))*[\s.!]*$/;
function pluralAffirmation(said) {
  return PLURAL_AFFIRMATION.test(String(said ?? "").trim().toLowerCase());
}

// A bare yes answers what was just put to the owner: the one card the reply
// offered, or, with no offers, the parked or stopped card of the newest
// notice. A plural yes ("all of them") answers every card the reply
// offered. Either counts as asked and named for work_on and retry only.
function affirmedIn(names, taskId) {
  const id = idOf(taskId);
  if (!id) return false;
  const { offers, offerCount, notice } = names.referents;
  if (offerCount > 1 && pluralAffirmation(names.said)) return offers.includes(id);
  if (!bareAffirmation(names.said)) return false;
  if (offerCount) return offerCount === 1 && offers[0] === id;
  return notice === id && WAITING_STAGES.has(names.stages.get(id) ?? "");
}

// Whether the owner's words name this card: its id; a quoted span that fits
// its title and no other title (or is its title); a word of 4+ letters, not
// a command or filler word, that its title holds and no other title does, in
// a clause whose other significant words fit its title too; a pronoun ("it",
// "that", "the build") for the one card named before it; or, when the words
// name no card, a pronoun or a bare command ("try again", "stop") while this
// card is the one thing in view (the focus, the newest notice's task, the
// answered reply's offers). A bare "try again" also names the parked or
// stopped card of the newest notice when the reply offered nothing. context:
// { titles, stages, referents, allTitles }, with titles, stages and allTitles
// (the whole board, for uniqueness) as id -> text in an object or a Map.
function targetNamed(text, taskId, context = {}) {
  try {
    return namedIn(nameContext(text, context), taskId);
  } catch {
    return false;
  }
}

// ---- local control --------------------------------------------------------------------

// Most specific first: a stop outranks everything that also matched.
const LOCAL_KINDS = Object.freeze(["stop", "mark_done", "approve", "retry", "work_on"]);
// The stages each kind can act on; a named card at any other stage gets none.
const LOCAL_FITS = Object.freeze({
  stop: (stage) => stage !== "done",
  mark_done: (stage) => stage !== "done",
  approve: (stage) => stage === "approval",
  retry: (stage) => !["running", "review", "done"].includes(stage),
  work_on: () => true,
});

// For a machine with no model: the one action the owner's words alone ask
// for, as raw actions for validateChatActions ([] or [{ kind, taskId }]).
// The words must name exactly one task of the digest (every group; inbox
// requests aside) and mention no other card, shown or not, and a clause of theirs
// must ask for a kind on that card (the most specific that fits it) with no
// clause naming it with that kind negated, exactly as the model path's gate.
// options: digest, referents, allTitles (the whole board, as
// validateChatActions takes it); intent is accepted for symmetry with the
// model path; the words decide.
function localChatActions(text, options = {}) {
  try {
    const opts = plainObject(options) ?? {};
    const digest = plainObject(opts.digest) ?? {};
    const titles = new Map();
    const stages = new Map();
    for (const group of DIGEST_GROUPS) {
      for (const row of rows(own(digest, group)).slice(0, 100)) {
        const id = idOf(row.id);
        if (!id || row.kind === "request" || titles.has(id)) continue;
        titles.set(id, clip(row.title, 200) || id);
        stages.set(id, clip(row.stage, 24));
      }
    }
    const names = nameContext(text, { titles, stages, referents: opts.referents, allTitles: opts.allTitles });
    const { message } = names;
    if (!message.plain || !LOCAL_KINDS.some((kind) => hitsOf(message, kind).some((hit) => hit.asked))) return [];
    const named = [...titles.keys()].filter((id) => namedIn(names, id));
    if (named.length !== 1 || [...directIds(names, true)].some((id) => id !== named[0])) return [];
    const kind = LOCAL_KINDS.find((entry) => LOCAL_FITS[entry](stages.get(named[0]) ?? "") && kindAsked(names, entry, named[0]));
    return kind ? [{ kind, taskId: named[0] }] : [];
  } catch {
    return [];
  }
}

// ---- 4. the chat envelope --------------------------------------------------------------

const REPLY_MAX = 1500;
const ENVELOPE_SCAN_MAX = 60000;
const ENVELOPE_KEYS = ["reply", "actions", "offers"];

// The index of the "}" that closes the object opened at start, or -1.
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseObject(text) {
  for (const candidate of [text, text.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const value = JSON.parse(candidate);
      if (plainObject(value)) return value;
    } catch {}
  }
  return null;
}

const isEnvelope = (value) => Boolean(value) && ENVELOPE_KEYS.some((key) => own(value, key) !== undefined);

// Top-level {...} spans in prose, bounded: a stray brace costs one failed scan.
function objectSpans(text) {
  const spans = [];
  let from = 0;
  for (let scans = 0; scans < 40 && spans.length < 8; scans += 1) {
    const start = text.indexOf("{", from);
    if (start < 0) break;
    const end = objectEnd(text, start);
    if (end < 0) { from = start + 1; continue; }
    spans.push([start, end]);
    from = end + 1;
  }
  return spans;
}

function envelopeOf(value, prose) {
  const replyText = [value.reply, value.message, value.text].find((entry) => typeof entry === "string");
  const reply = clipBlock(replyText ?? "", REPLY_MAX) || clipBlock(prose, REPLY_MAX);
  const rawActions = Array.isArray(value.actions) ? value.actions : plainObject(value.actions) ? [value.actions] : [];
  const actions = rawActions.slice(0, 12).filter((action) => plainObject(action));
  const rawOffers = Array.isArray(value.offers) ? value.offers : [];
  const offers = [];
  for (const offer of rawOffers.slice(0, 12)) {
    if (offers.length >= 4) break;
    if (typeof offer === "string") {
      const title = clip(offer, 160);
      if (title) offers.push({ title });
      continue;
    }
    const entry = plainObject(offer);
    if (!entry) continue;
    const title = clip(entry.title ?? entry.label, 160);
    const taskId = idOf(entry.taskId ?? entry.task_id ?? plainObject(entry.target)?.id);
    if (!title && !taskId) continue;
    offers.push(taskId ? { title, taskId } : { title });
  }
  return { ok: true, reply, actions, offers };
}

// The chat model's reply as {ok, reply, actions, offers}. Accepts a bare JSON
// object, a ```json fence, or prose ending in one JSON object; anything else
// is prose, still a reply but with no actions. Never throws.
function parseChatEnvelope(raw) {
  try {
    if (plainObject(raw)) return isEnvelope(raw) ? envelopeOf(raw, "") : { ok: false, reply: "", actions: [], offers: [] };
    const full = typeof raw === "string" ? raw : raw == null ? "" : clip(raw, REPLY_MAX);
    // Some models think aloud first; that is never the reply.
    const text = full.slice(0, ENVELOPE_SCAN_MAX).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const prose = () => ({ ok: false, reply: clipBlock(text, REPLY_MAX), actions: [], offers: [] });
    if (!text) return prose();
    const bare = text.startsWith("{") ? parseObject(text) : null;
    if (isEnvelope(bare)) return envelopeOf(bare, "");
    const fence = /```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/g;
    for (const match of text.matchAll(fence)) {
      const value = parseObject(match[1].trim());
      if (isEnvelope(value)) return envelopeOf(value, text.replace(match[0], " "));
    }
    const spans = objectSpans(text);
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      const [start, end] = spans[index];
      const value = parseObject(text.slice(start, end + 1));
      if (isEnvelope(value)) return envelopeOf(value, `${text.slice(0, start)} ${text.slice(end + 1)}`);
    }
    // A broken envelope: show its reply text, not the JSON around it.
    const quoted = text.match(/"reply"\s*:\s*("(?:[^"\\]|\\.)*")/);
    if (quoted) {
      try {
        const reply = clipBlock(JSON.parse(quoted[1]), REPLY_MAX);
        if (reply) return { ok: false, reply, actions: [], offers: [] };
      } catch {}
    }
    return prose();
  } catch {
    return { ok: false, reply: "", actions: [], offers: [] };
  }
}

// ---- 5. the chat payload -----------------------------------------------------------------

// ui (what the owner is looking at) and needsYou (the list behind the
// "N need you" badge) ride right after did: they are small, and they are
// what the owner's own words refer to.
const PACK_ORDER = Object.freeze(["message", "did", "ui", "needsYou", "asks", "events", "board", "thread", "focus", "suggestions"]);
// What the owner just said and what the host just did are never dropped.
const PACK_KEEP = new Set(["message", "did"]);
// Oldest first: these give way from the head so the newest entries stay.
const PACK_CHRONOLOGICAL = new Set(["thread", "events", "log", "history"]);
const PACK_FLOOR = 2;
const PACK_META = "_trimmed";

// A JSON-safe copy: no functions, cycles, non-finite numbers or BigInts, and
// bounded in depth, width and string length.
function jsonSafe(value, depth = 0, seen = new WeakSet()) {
  if (value === null) return null;
  switch (typeof value) {
    case "string": return value.length > 200000 ? cut(value, 200000) : value;
    case "number": return Number.isFinite(value) ? value : null;
    case "boolean": return value;
    case "bigint": return String(value);
    case "object": break;
    default: return undefined;
  }
  if (depth >= 16 || seen.has(value)) return null;
  try {
    if (typeof value.toJSON === "function") return jsonSafe(value.toJSON(), depth + 1, seen);
  } catch {
    return null;
  }
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = [];
    for (const item of value.slice(0, BOARD_MAX)) {
      let safe;
      try { safe = jsonSafe(item, depth + 1, seen); } catch { safe = null; }
      out.push(safe === undefined ? null : safe);
    }
  } else {
    out = {};
    for (const key of Object.keys(value).slice(0, 500)) {
      if (key === "__proto__") continue;
      let safe;
      try { safe = jsonSafe(value[key], depth + 1, seen); } catch { safe = null; }
      if (safe !== undefined) out[key] = safe;
    }
  }
  seen.delete(value);
  return out;
}

// The largest array inside a value that can still lose items, with its path.
function largestArray(value, floor, path, depth = 0, best = null) {
  if (!value || typeof value !== "object" || depth > 8) return best;
  if (Array.isArray(value)) {
    if (value.length > floor) {
      const size = JSON.stringify(value).length;
      if (!best || size > best.size) best = { array: value, size, path };
    }
    for (const item of value) best = largestArray(item, floor, path, depth + 1, best);
    return best;
  }
  for (const key of Object.keys(value)) best = largestArray(value[key], floor, `${path}.${key}`, depth + 1, best);
  return best;
}

// The array in one section that gives way next. Inside a section, as between
// sections, later keys rank lower: its last direct array still above the floor
// goes first (a digest's recentDone before its ready list), else the largest
// array deeper down.
function nextArray(entry, floor) {
  const value = entry.value;
  let found = null;
  if (Array.isArray(value)) {
    if (value.length > floor) found = { array: value, path: entry.name };
  } else if (value && typeof value === "object") {
    const keys = Object.keys(value);
    for (let index = keys.length - 1; index >= 0 && !found; index -= 1) {
      const child = value[keys[index]];
      if (Array.isArray(child) && child.length > floor) found = { array: child, path: `${entry.name}.${keys[index]}` };
    }
  }
  if (!found) return largestArray(value, floor, entry.name);
  found.size = JSON.stringify(found.array).length;
  return found;
}

function longestString(value, depth = 0, best = null, holder = null, key = null) {
  if (typeof value === "string") return !best || value.length > best.value.length ? { value, holder, key } : best;
  if (!value || typeof value !== "object" || depth > 8) return best;
  for (const name of Object.keys(value)) best = longestString(value[name], depth + 1, best, value, Array.isArray(value) ? Number(name) : name);
  return best;
}

// The chat request body as JSON that always parses and never passes budget.
// Sections go in priority order (message, did, asks, events, board, thread,
// focus, suggestions, then the rest as given). options.sectionBudgets (e.g.
// { board: 6000, thread: 2500 }) first shrinks each named section's arrays to
// its own budget, by the same rules. Over budget, arrays shrink first —
// lowest priority section (and, inside it, last key) first, down to a floor
// of two items, from the tail (from the head for thread/events/log) — then
// whole sections drop, lowest first; message and did are only clipped when
// nothing else is left. What was cut is named under "_trimmed". The
// serialized string is never sliced.
function packChatPayload(sections, budget = 14000, options = {}) {
  const wanted = Math.floor(Number(budget));
  const limit = Number.isFinite(wanted) ? Math.max(2, Math.min(wanted, 50000000)) : 14000;
  const budgets = plainObject(plainObject(options)?.sectionBudgets) ?? {};
  const source = plainObject(sections) ?? {};
  const names = [...PACK_ORDER.filter((name) => own(source, name) !== undefined),
    ...Object.keys(source).filter((name) => !PACK_ORDER.includes(name) && name !== PACK_META && name !== "__proto__").slice(0, 64)];
  const entries = [];
  for (const name of names) {
    let value;
    try { value = jsonSafe(source[name]); } catch { value = null; }
    if (value !== undefined) entries.push({ name, value, size: 0 });
  }
  const measure = (entry) => { entry.size = JSON.stringify(entry.name).length + 1 + JSON.stringify(entry.value).length; };
  entries.forEach(measure);
  const trimmed = [];
  const meta = { name: PACK_META, value: trimmed, size: 0, on: true };
  const note = (path) => { if (!trimmed.includes(path) && trimmed.length < 16) trimmed.push(path); };
  const live = () => entries.filter((entry) => !entry.dropped);
  const total = () => {
    const kept = live();
    if (meta.on && trimmed.length) { measure(meta); kept.push(meta); }
    return 2 + Math.max(0, kept.length - 1) + kept.reduce((sum, entry) => sum + entry.size, 0);
  };
  // Shrink the arrays inside one section toward the floor until the body fits,
  // or, given a target, until the section itself does.
  const shrink = (entry, floor, target = null) => {
    const over = () => (target === null ? total() - limit : entry.size - target);
    for (let rounds = 0; rounds < 400 && over() > 0; rounds += 1) {
      const found = nextArray(entry, floor);
      if (!found) return;
      const { array } = found;
      const each = Math.max(1, found.size / array.length);
      const drop = Math.max(1, Math.min(array.length - floor, Math.ceil(over() / each)));
      if (array === entry.value && PACK_CHRONOLOGICAL.has(entry.name)) array.splice(0, drop);
      else array.length -= drop;
      note(found.path);
      measure(entry);
    }
  };
  for (const entry of entries) {
    if (PACK_KEEP.has(entry.name)) continue;
    const sectionBudget = Math.floor(Number(own(budgets, entry.name)));
    if (Number.isFinite(sectionBudget) && sectionBudget > 0) shrink(entry, PACK_FLOOR, Math.max(2, sectionBudget));
  }
  for (let index = entries.length - 1; index >= 0 && total() > limit; index -= 1) {
    if (!PACK_KEEP.has(entries[index].name)) shrink(entries[index], PACK_FLOOR);
  }
  for (let index = entries.length - 1; index >= 0 && total() > limit; index -= 1) {
    const entry = entries[index];
    if (PACK_KEEP.has(entry.name)) continue;
    entry.dropped = true;
    note(entry.name);
  }
  // Only message and did are left: give up the note, then clip their long
  // strings, then drop did's items, then clip to nothing — did first each time.
  if (total() > limit) meta.on = false;
  const clipStrings = (entry, shortest) => {
    for (let rounds = 0; rounds < 64 && total() > limit; rounds += 1) {
      const found = longestString(entry.value);
      if (!found || found.value.length <= shortest) return;
      const next = cut(found.value, Math.max(shortest, found.value.length - (total() - limit) - 8));
      if (found.holder) found.holder[found.key] = next;
      else entry.value = next;
      measure(entry);
    }
  };
  const kept = ["did", "message"].map((name) => entries.find((item) => item.name === name && !item.dropped)).filter(Boolean);
  for (const step of [(entry) => clipStrings(entry, 200), (entry) => shrink(entry, 0), (entry) => clipStrings(entry, 0), (entry) => { entry.dropped = true; }]) {
    for (const entry of kept) {
      if (total() > limit && !entry.dropped) step(entry);
    }
  }
  const body = {};
  for (const entry of live()) body[entry.name] = entry.value;
  if (meta.on && trimmed.length) body[PACK_META] = trimmed;
  const text = JSON.stringify(body);
  return text.length <= limit ? text : "{}";
}

// ---- 6. result lines -----------------------------------------------------------------------

const ROLE_PURPOSE = Object.freeze({ keeper: "tidy", auditor: "fix", watcher: "organize", compactor: "compact", overseer: "review" });

// What the owner reads in the thread about one action: what actually happened,
// from the host's outcome ({ok, error, title, status, existing, dispatch, ...}),
// never what the model hoped would happen.
function resultLine(action, outcome) {
  const act = plainObject(action) ?? {};
  const kind = clip(act.kind, 40);
  const out = outcome === true ? { ok: true } : outcome === false ? { ok: false } : plainObject(outcome);
  const existing = plainObject(out?.existing);
  const title = clip(existing?.title ?? out?.title ?? act.title ?? act.questionTitle, 60);
  const target = title ? `"${title}"` : act.taskId ? `task ${clip(act.taskId, 40)}` : "that";
  const role = own(ROLE_PURPOSE, clip(act.role, 20)) ? clip(act.role, 20) : "";
  const phrase = {
    create_task: `create ${target}`,
    work_on: `start ${target}`,
    retry: `retry ${target}`,
    stop: `stop ${target}`,
    mark_done: `mark ${target} done`,
    approve: `approve ${target}`,
    note: `add a note to ${target}`,
    answer: `answer ${target}`,
    pause: "pause new work",
    resume: "resume new work",
    run_role: role ? `run the ${role} (${ROLE_PURPOSE[role]})` : "run that role",
  }[kind] ?? `do ${kind || "that"}`;
  if (!out) return cut(`Couldn't ${phrase}: no result came back`, 240);
  if (out.asked === true || out.confirm === true) return cut(`Waiting for your OK to ${phrase} — see the Ask card`, 240);
  if (out.ok === false) return cut(`Couldn't ${phrase}: ${clip(out.error, 160) || "it did not apply"}`, 240);
  const status = clip(existing?.status ?? out.status ?? out.already, 40);
  let line;
  switch (kind) {
    case "create_task":
      if (existing) line = `${target} is already on the board${status ? ` (${status.replace(/_/g, " ")})` : ""}`;
      else if (out.created === null) line = "A matching task is already on the board";
      else line = `Created ${target}${out.stage === "approval" ? " — it needs your approval before it builds" : ""}`;
      break;
    case "work_on":
      if (clip(plainObject(out.dispatch)?.message, 200)) line = `${target}: ${clip(out.dispatch.message, 200)}`;
      else if (out.already === true) line = `${target} is already under way`;
      else if (status === "active" || status === "running") line = `${target} is already running`;
      else if (REVIEW_STATUSES.has(status) || status === "review") line = `${target} is already being verified`;
      else if (plainObject(out.dispatch)?.held) line = `Prioritized ${target}; dispatch is held. Check the task's current requirements`;
      else line = `Requested dispatch for ${target}; worker start is not yet confirmed`;
      break;
    case "retry":
      line = `Re-armed ${target}; it runs when a worker is free`;
      break;
    case "stop":
      line = out.notRunning === true ? `${target} wasn't running` : `Stopped ${target} — progress saved`;
      break;
    case "mark_done":
      line = `Marked ${target} done`;
      break;
    case "approve":
      line = `Approved ${target}; it can build now`;
      break;
    case "note":
      line = `Added your note to ${target}`;
      break;
    case "answer": {
      const label = clip(out.label ?? act.optionLabel, 60);
      line = clip(plainObject(out.dispatch)?.message, 220) || `Answered ${target}${label ? `: ${label}` : ""}`;
      break;
    }
    case "pause":
      line = "Paused new work; running workers finish";
      break;
    case "resume":
      line = "Resumed new work";
      break;
    case "run_role": {
      const detail = clip(out.text, 160);
      line = out.queued === true ? `Queued the ${role || "role"} pass` : `Ran the ${role || "role"}${role ? ` (${ROLE_PURPOSE[role]})` : ""}${detail ? `: ${detail}` : ""}`;
      break;
    }
    default:
      line = `Did ${kind || "that"}`;
  }
  return cut(line, 240);
}

module.exports = {
  STAGE_RANK,
  DIGEST_GROUPS,
  DIGEST_LIMITS,
  boardDigest,
  EVENT_KINDS,
  taskEvents,
  CHAT_ACTION_KINDS,
  RUN_ROLES,
  validateChatActions,
  explicitlyAsked,
  targetNamed,
  localChatActions,
  parseChatEnvelope,
  packChatPayload,
  resultLine,
};
