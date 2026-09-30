// What one task took: this attempt's time, tokens and cost, and the whole task's
// with all of its attempts, read from the ledgers Studio already keeps and never
// from a guess. Behind the task's Usage tab (main.cjs "task:metrics").
//
// Three sources, all handed in by the host:
//  - the executor ledger's text (data/executor-log.jsonl, read by
//    task-attempts.cjs): which runs the task had, when each started and ended,
//    which route ran it, whether it was stopped at its time limit;
//  - the merged usage ledger (usage-tracker.cjs mergeLedgers: Studio's own calls
//    and OpenCode's per-turn store), scoped to each attempt the way `usage:task`
//    scopes the latest one (its run id, or its session inside its time window);
//  - the board rows, for the task's delegated sub-tasks and its saved limit.
//
// A route that does not report is said so. Claude Code, Codex, Grok and
// Antigravity, run as builders, print no token counts and no price to Studio, so
// their attempts carry a measured time and "not reported" for the rest, never a
// zero. A plan or subscription that prices no call stays "unpriced", never free.
// A store that could not be read is "unavailable", not "none".
//
// Pure module: no Electron, no filesystem, no network, no clock reads (`now` is
// passed in).

"use strict";

const { attemptsFromLedger } = require("./task-attempts.cjs");
const { rollupUsage } = require("./usage-tracker.cjs");
const taskCap = require("./task-cap.cjs");

const CLI_NAMES = Object.freeze({ claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity" });
const FAMILY_DEPTH = 4;
const FAMILY_MAX = 24;
const ATTEMPTS_PER_TASK = 100;
const ATTEMPTS_SHOWN = 10;

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plus = (a, b) => (a === null ? b : b === null ? a : a + b);

/**
 * Which kind of builder ran an attempt, from the route text the executor ledger
 * keeps ("claude cli · ...", "opencode / model"). An attempt that started on a
 * CLI and was retried on OpenCode did its work there, and says so.
 */
function routeOf(via, fallbacks = []) {
  const text = String(via ?? "").trim();
  const cli = /^(claude|codex|grok|antigravity)\b/i.exec(text)?.[1]?.toLowerCase() ?? null;
  if (cli && Array.isArray(fallbacks) && fallbacks.length) return { kind: "opencode", label: "OpenCode", via: text, fellBackFrom: CLI_NAMES[cli] };
  if (cli) return { kind: "cli", label: CLI_NAMES[cli], via: text, cli };
  if (!text) return { kind: "unknown", label: null, via: "" };
  return { kind: "opencode", label: "OpenCode", via: text };
}

/** The task and its delegated descendants (parentTaskId), bounded. `truncated` says the walk stopped early. */
function familyOf(task, tasks) {
  const rows = Array.isArray(tasks) ? tasks.filter((row) => row && typeof row === "object" && typeof row.id === "string") : [];
  const parentOf = (row) => row.parentTaskId || row.delegatedFrom?.parentTaskId || null;
  const members = [task];
  const seen = new Set([task.id]);
  let frontier = [task.id], truncated = false;
  for (let depth = 0; depth < FAMILY_DEPTH && frontier.length; depth += 1) {
    const next = [];
    for (const row of rows) {
      if (seen.has(row.id) || !frontier.includes(parentOf(row))) continue;
      if (members.length >= FAMILY_MAX) { truncated = true; continue; }
      seen.add(row.id); members.push(row); next.push(row.id);
    }
    frontier = next;
  }
  if (frontier.length && rows.some((row) => !seen.has(row.id) && frontier.includes(parentOf(row)))) truncated = true;
  return { members, truncated };
}

// One attempt's numbers. `sessionId` of a live run comes from the card's own progress record.
function attemptMetrics(attempt, { usageRows, storeOk, now, liveSession = null }) {
  const live = attempt.finishedAt == null && !attempt.release && attempt.live === true;
  const route = routeOf(attempt.via, attempt.fallbacks);
  const startedAt = number(attempt.startedAt);
  const endedAt = number(attempt.finishedAt);
  const seconds = number(attempt.seconds) ?? (live && startedAt !== null ? Math.max(0, Math.round((now - startedAt) / 1000)) : null);
  const sessionId = attempt.sessionId || (live ? liveSession : null);
  const base = {
    runId: attempt.runId, taskId: attempt.taskId, startedAt, endedAt, live, seconds, outcome: live ? "running" : attempt.outcome,
    stoppedAtLimit: attempt.stoppedAtLimit === true, limitMinutes: number(attempt.limitMinutes),
    route: { kind: route.kind, label: route.label, ...(route.fellBackFrom ? { fellBackFrom: route.fellBackFrom } : {}) },
  };
  if (route.kind === "cli") {
    // The route prints no counts and no price: say so, whatever the ledgers hold.
    return { ...base, tokens: { state: "not-reported" }, cost: { state: "not-reported" } };
  }
  if (!Array.isArray(usageRows)) return { ...base, tokens: { state: "unavailable" }, cost: { state: "unavailable" } };
  const scope = [{ runId: attempt.runId }];
  const until = endedAt ?? (live ? now : null);
  if (sessionId && startedAt !== null && until !== null && until >= startedAt) scope.push({ sessionId: String(sessionId), since: startedAt, until });
  const summary = rollupUsage(usageRows, scope);
  // Studio's own ledger may have answered while OpenCode's store did not: with no call found, that is "cannot say", not "none".
  if (!summary.calls) { const state = storeOk ? "none-recorded" : "unavailable"; return { ...base, tokens: { state }, cost: { state } }; }
  const field = (key) => summary.usage?.[key]?.known ?? null;
  const input = field("inputTokens"), output = field("outputTokens");
  const total = field("totalTokens") ?? (input !== null || output !== null ? (input ?? 0) + (output ?? 0) : null);
  const usd = field("costUsd"), unpriced = summary.usage?.costUsd?.unknownRecords ?? 0;
  return {
    ...base,
    tokens: { state: total === null && input === null && output === null ? "none-recorded" : "reported", input, output, cacheRead: field("cacheReadTokens"), total, calls: summary.calls },
    cost: { state: usd !== null && usd > 0 ? "reported" : unpriced > 0 ? "unpriced" : usd !== null ? "reported" : "none-recorded", usd, unpricedCalls: unpriced, calls: summary.calls },
  };
}

// The whole task: every attempt of every member, added up without turning a gap into a zero.
function rollUp(attempts) {
  const out = { attempts: attempts.length, seconds: null, secondsUnknown: 0, tokens: null, cost: null, unreported: 0, unavailable: 0, firstStartedAt: null, lastEndedAt: null, stoppedAtLimit: 0 };
  let tokens = { input: null, output: null, total: null, calls: 0 }, priced = null, unpriced = 0, sawTokens = false, sawCost = false;
  for (const attempt of attempts) {
    if (attempt.seconds === null) out.secondsUnknown += 1; else out.seconds = (out.seconds ?? 0) + attempt.seconds;
    if (attempt.startedAt !== null && (out.firstStartedAt === null || attempt.startedAt < out.firstStartedAt)) out.firstStartedAt = attempt.startedAt;
    if (attempt.endedAt !== null && (out.lastEndedAt === null || attempt.endedAt > out.lastEndedAt)) out.lastEndedAt = attempt.endedAt;
    if (attempt.stoppedAtLimit) out.stoppedAtLimit += 1;
    if (attempt.tokens.state === "not-reported") { out.unreported += 1; continue; }
    if (attempt.tokens.state === "unavailable") { out.unavailable += 1; continue; }
    if (attempt.tokens.state === "reported") {
      sawTokens = true;
      tokens = { input: plus(tokens.input, attempt.tokens.input), output: plus(tokens.output, attempt.tokens.output), total: plus(tokens.total, attempt.tokens.total), calls: tokens.calls + (attempt.tokens.calls || 0) };
    }
    if (attempt.cost.state === "reported" || attempt.cost.state === "unpriced") {
      sawCost = true;
      priced = plus(priced, attempt.cost.usd);
      unpriced += attempt.cost.unpricedCalls || 0;
    }
  }
  const partial = out.unreported + out.unavailable;
  const state = (saw) => (saw ? "reported" : out.unreported && !out.unavailable && out.unreported === attempts.length ? "not-reported" : out.unavailable ? "unavailable" : "none-recorded");
  out.tokens = { state: state(sawTokens), ...(sawTokens ? tokens : {}), partial: sawTokens && partial > 0 };
  out.cost = { state: sawCost && !(priced > 0) && unpriced > 0 ? "unpriced" : state(sawCost), ...(sawCost ? { usd: priced, unpricedCalls: unpriced } : {}), partial: sawCost && partial > 0 };
  return out;
}

/**
 * The report for one task. `ledger` is the executor log's text, `usageRows` the
 * merged usage ledger (null when it could not be read: `storeOk` false),
 * `killMs` the app's hard limit and `capOn` whether limits are switched on.
 */
function taskMetrics({ task, tasks = [], ledger = "", usageRows = null, storeOk = true, now, killMs, capOn = true, projectId = null } = {}) {
  if (!task || typeof task !== "object" || typeof task.id !== "string") return { ok: false, error: "That task is not on the board." };
  const asOf = number(now) ?? 0;
  const { members, truncated } = familyOf(task, tasks);
  const ids = members.map((row) => row.id);
  // The ledger is read once: only the lines that name one of these tasks are parsed again per member.
  const text = String(ledger ?? "");
  const relevant = text ? text.split("\n").filter((line) => line && ids.some((id) => line.includes(id))).join("\n") : "";
  const all = [];
  const reasons = [];
  for (const member of members) {
    const own = attemptsFromLedger(relevant, { taskId: member.id, limit: ATTEMPTS_PER_TASK }).attempts;
    const liveRun = typeof member.runId === "string" && member.runId ? member.runId : null;
    const liveSession = member.runProgress?.runId && member.runProgress.runId === liveRun ? member.runProgress.sessionId ?? null : null;
    for (const attempt of own) {
      all.push(attemptMetrics({ ...attempt, live: attempt.runId === liveRun && attempt.outcome === "unrecorded" }, { usageRows, storeOk, now: asOf, liveSession }));
    }
    if (own.length >= ATTEMPTS_PER_TASK) reasons.push(`Only the newest ${ATTEMPTS_PER_TASK} attempts of ${member.id === task.id ? "this task" : "a sub-task"} are counted.`);
  }
  all.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const own = all.filter((attempt) => attempt.taskId === task.id);
  const current = own[0] ?? null;
  const whole = rollUp(all);
  if (!storeOk) reasons.push("OpenCode's store could not be read, so the tokens and cost of coding turns are missing.");
  if (all.some((attempt) => attempt.outcome === "unrecorded" && !attempt.live)) reasons.push("Some attempts have no recorded end, so their time is missing.");
  if (truncated) reasons.push("This task has more sub-tasks than are counted here.");
  if (!all.length) reasons.push(text ? "No run of this task is in the run history yet." : "There is no run history yet.");
  const limit = taskCap.limit({ killMs, task, on: capOn });
  const ceiling = taskCap.ceilingMinutes(killMs);
  return {
    ok: true,
    taskId: task.id,
    ...(projectId ? { projectId } : {}),
    asOf,
    attempt: current,
    task: { ...whole, subtasks: members.length - 1 },
    attempts: own.slice(0, ATTEMPTS_SHOWN),
    cap: {
      enabled: capOn === true,
      minutes: taskCap.minutesOf(task),
      effectiveMinutes: limit.minutes,
      ceilingMinutes: ceiling,
      raised: capOn === true && limit.raised,
      default: taskCap.DEFAULT_MINUTES, min: taskCap.MIN_MINUTES, max: taskCap.MAX_MINUTES, step: taskCap.STEP_MINUTES,
    },
    coverage: { complete: reasons.length === 0, reasons },
  };
}

module.exports = { taskMetrics, routeOf, familyOf, CLI_NAMES };
