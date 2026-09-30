// A time limit for one attempt of one task: how many minutes a builder may run
// before Studio stops it, and the arithmetic that turns the limit into the
// executor's timer.
//
// The limit is the owner's ("Stop an attempt after 25 min" in the task's Usage
// tab). It is stored on the task record as `capMinutes` beside the other
// per-task settings, in steps of 5 from 5 to 240, and 25 when nothing was set.
// It can only SHORTEN a run: the timer is min(EXECUTOR_KILL_MS, capMs), because
// the app's own hard kill (main.cjs EXECUTOR_KILL_MS, 25 minutes) stays the
// ceiling that the supervisor, the update drain and the wedge sweep are all
// measured from. A stored limit above the ceiling is kept, and takes effect the
// day the ceiling is raised; until then the host says so instead of pretending.
//
// A run that reaches its limit is stopped the way the owner's Stop stops it
// (main.cjs stopExecutorJob): progress is saved, nothing is charged to the card
// or to the model, and the card waits for the owner (an ownerHold of kind
// "limit") instead of starting the same attempt again by itself. The run that
// hits the app's own hard kill with no limit in force ("budget") is a failure
// as it always was, so MEFI_STUDIO_NO_TASK_CAP=1 gives back exactly that.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const MINUTE_MS = 60000;
const DEFAULT_MINUTES = 25;
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;
const STEP_MINUTES = 5;
// The worker is told 60% of its limit as the budget to plan for (15 of the
// default 25 minutes, which is what it has always been told), never under two.
const TOLD_SHARE = 0.6;
const TOLD_FLOOR_MINUTES = 2;

/** The switch: MEFI_STUDIO_NO_TASK_CAP=1 turns limits off, and nothing else does. The host passes process.env. */
function enabled(env) {
  return String(env?.MEFI_STUDIO_NO_TASK_CAP ?? "") !== "1";
}

/**
 * Minutes from anywhere (a stepper, a saved row, an IPC payload) as a valid
 * limit: the nearest multiple of 5 inside 5..240. A value that is not a finite
 * number is not a limit at all (null). `clamped` says whether it had to move.
 */
function snap(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return null;
  const stepped = Math.round(number / STEP_MINUTES) * STEP_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, stepped));
}

/** What `tasks:cap` does with the minutes it was given: { ok, minutes, clamped } or { ok: false, error }. */
function normalize(value) {
  const minutes = snap(value);
  if (minutes === null) return { ok: false, error: `Choose a limit from ${MIN_MINUTES} to ${MAX_MINUTES} minutes.` };
  const asked = typeof value === "string" ? Number(value) : value;
  return { ok: true, minutes, clamped: minutes !== asked };
}

/** The limit a task record holds, or the default. A row edited by hand to nonsense reads as the default. */
function minutesOf(task) {
  const saved = task && typeof task === "object" ? task.capMinutes : undefined;
  return snap(saved) ?? DEFAULT_MINUTES;
}

/** One press of the stepper: `direction` +1 or -1, held inside `max` (the ceiling the host reports) and the range. */
function step(current, direction, max = MAX_MINUTES) {
  const from = snap(current) ?? DEFAULT_MINUTES;
  const ceiling = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, snap(max) ?? MAX_MINUTES));
  const to = from + (direction < 0 ? -STEP_MINUTES : STEP_MINUTES);
  return Math.min(ceiling, Math.max(MIN_MINUTES, snap(to)));
}

/**
 * How long one attempt may run, and what ends it.
 *  - `killMs`: the app's hard limit (EXECUTOR_KILL_MS).
 *  - `task` or `capMinutes`: the owner's limit (the default when neither is set).
 *  - `on`: false when the switch is off, which is the old behaviour exactly: the
 *    hard kill alone, and a failure when it fires.
 * `ms` is min(killMs, capMs). `byCap` is true when the LIMIT is what ends the run
 * (its limit is no longer than the hard kill): then the run is stopped like the
 * owner's Stop. Otherwise the hard kill is the end, as before. `minutes` is the
 * limit in force in minutes, and `raised` says the owner asked for more than the
 * hard kill allows.
 */
function limit({ killMs, task = null, capMinutes = null, on = true } = {}) {
  const kill = Number.isFinite(killMs) && killMs > 0 ? killMs : DEFAULT_MINUTES * MINUTE_MS;
  const asked = snap(capMinutes) ?? minutesOf(task);
  if (!on) return { ms: kill, byCap: false, minutes: Math.round(kill / MINUTE_MS), asked, raised: false };
  const capMs = asked * MINUTE_MS;
  return { ms: Math.min(kill, capMs), byCap: capMs <= kill, minutes: Math.round(Math.min(kill, capMs) / MINUTE_MS), asked, raised: capMs > kill };
}

/** The longest limit the stepper can offer while the app's hard kill is `killMs`. */
function ceilingMinutes(killMs) {
  const kill = Number.isFinite(killMs) && killMs > 0 ? killMs : DEFAULT_MINUTES * MINUTE_MS;
  return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.floor(kill / MINUTE_MS / STEP_MINUTES) * STEP_MINUTES));
}

/** The minutes a worker is told it has (promptTail's budget), from the base budget and the run's own limit. */
function toldBudgetMinutes(baseMinutes, limitMs) {
  const base = Number.isFinite(baseMinutes) && baseMinutes > 0 ? baseMinutes : 15;
  if (!Number.isFinite(limitMs) || limitMs <= 0) return base;
  const scaled = Math.max(TOLD_FLOOR_MINUTES, Math.floor((limitMs / MINUTE_MS) * TOLD_SHARE));
  return Math.min(base, scaled);
}

/** The words for a stop at the limit, in the run's log and on the card. */
function stopReason(minutes) {
  return `stopped at the time limit (${minutes} min)`;
}

/** The hold the stopped card carries, so it waits for the owner. `kind` lets the card say the app stopped it, not the owner. */
function holdFor({ minutes, now }) {
  return { at: now, kind: "limit", minutes, reason: stopReason(minutes) };
}

module.exports = {
  MINUTE_MS, DEFAULT_MINUTES, MIN_MINUTES, MAX_MINUTES, STEP_MINUTES,
  enabled, snap, normalize, minutesOf, step, limit, ceilingMinutes, toldBudgetMinutes, stopReason, holdFor,
};
