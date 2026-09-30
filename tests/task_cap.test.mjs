// The per-task time limit's pure half (scripts/task-cap.cjs): the clamp and the
// steps, the timer arithmetic min(EXECUTOR_KILL_MS, capMs), the switch, the
// words. The host half (the timer, the stop path, the IPC) is
// tests/task_cap_host.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const cap = createRequire(import.meta.url)("../scripts/task-cap.cjs");
const KILL = 25 * 60000;

test("a limit is 5 to 240 minutes in steps of 5, and 25 when nothing was set", () => {
  assert.deepEqual([cap.MIN_MINUTES, cap.MAX_MINUTES, cap.STEP_MINUTES, cap.DEFAULT_MINUTES], [5, 240, 5, 25]);
  for (const [given, snapped] of [[25, 25], [5, 5], [240, 240], [7, 5], [8, 10], [22.4, 20], [22.6, 25], [1, 5], [0, 5], [-40, 5], [241, 240], [10000, 240], ["30", 30], [" 45 ", 45]]) {
    assert.equal(cap.snap(given), snapped, `${JSON.stringify(given)} reads as ${snapped}`);
  }
  for (const nothing of [undefined, null, NaN, Infinity, -Infinity, "", "  ", "abc", "12abc", {}, [], [30], true]) {
    assert.equal(cap.snap(nothing), null, `${JSON.stringify(nothing)} is not a limit`);
  }
});

test("normalize says whether the owner's number had to move, and refuses what is not a number", () => {
  assert.deepEqual(cap.normalize(30), { ok: true, minutes: 30, clamped: false });
  assert.deepEqual(cap.normalize("30"), { ok: true, minutes: 30, clamped: false });
  assert.deepEqual(cap.normalize(33), { ok: true, minutes: 35, clamped: true });
  assert.deepEqual(cap.normalize(2), { ok: true, minutes: 5, clamped: true });
  assert.deepEqual(cap.normalize(999), { ok: true, minutes: 240, clamped: true });
  const refused = cap.normalize("soon");
  assert.equal(refused.ok, false);
  assert.match(refused.error, /5 to 240 minutes/);
  assert.equal(cap.normalize(undefined).ok, false);
});

test("a task's limit is what its record holds, or 25 when the record holds nothing usable", () => {
  assert.equal(cap.minutesOf({ capMinutes: 40 }), 40);
  assert.equal(cap.minutesOf({ capMinutes: 41 }), 40, "a hand-edited row is snapped, not trusted");
  assert.equal(cap.minutesOf({}), 25);
  assert.equal(cap.minutesOf(null), 25);
  assert.equal(cap.minutesOf({ capMinutes: "long" }), 25);
  assert.equal(cap.minutesOf({ capMinutes: null }), 25);
});

test("the stepper moves by 5 and stays inside the range and inside the ceiling it is given", () => {
  assert.equal(cap.step(25, 1), 30);
  assert.equal(cap.step(25, -1), 20);
  assert.equal(cap.step(5, -1), 5, "not under 5");
  assert.equal(cap.step(240, 1), 240, "not over 240");
  assert.equal(cap.step(20, 1, 25), 25);
  assert.equal(cap.step(25, 1, 25), 25, "the app's own ceiling stops it");
  assert.equal(cap.step(undefined, 1), 30, "no value starts from the default");
  assert.equal(cap.step("nonsense", -1), 20);
});

test("the timer is min(EXECUTOR_KILL_MS, capMs): a shorter limit ends the run, a longer one never does", () => {
  assert.deepEqual(cap.limit({ killMs: KILL, task: { capMinutes: 10 } }), { ms: 10 * 60000, byCap: true, minutes: 10, asked: 10, raised: false });
  assert.equal(cap.limit({ killMs: KILL, task: { capMinutes: 5 } }).ms, 300000);
  // The default limit equals the hard kill: the LIMIT ends the run, so it is a stop, not a failure.
  assert.deepEqual(cap.limit({ killMs: KILL, task: {} }), { ms: KILL, byCap: true, minutes: 25, asked: 25, raised: false });
  // A limit above the app's hard kill cannot lengthen the run: the hard kill ends it, as before, and the report says so.
  assert.deepEqual(cap.limit({ killMs: KILL, task: { capMinutes: 60 } }), { ms: KILL, byCap: false, minutes: 25, asked: 60, raised: true });
  // A hard kill that is not a whole number of minutes is honoured to the millisecond.
  assert.equal(cap.limit({ killMs: 600000, task: {} }).ms, 600000);
  assert.equal(cap.limit({ killMs: 600000, task: {} }).byCap, false, "the fixture's 10 minute kill is shorter than the default limit, so it stays the hard kill");
  // capMinutes overrides the record (a limit the owner changed while the run was live).
  assert.equal(cap.limit({ killMs: KILL, task: { capMinutes: 10 }, capMinutes: 15 }).ms, 15 * 60000);
  // Junk in, sane out: no killMs falls back to 25 minutes.
  assert.equal(cap.limit({ task: { capMinutes: 30 } }).ms, KILL);
  assert.equal(cap.limit().ms, KILL);
});

test("with the switch off the hard kill alone ends the run, whatever the record says", () => {
  assert.deepEqual(cap.limit({ killMs: KILL, task: { capMinutes: 10 }, on: false }), { ms: KILL, byCap: false, minutes: 25, asked: 10, raised: false });
  assert.equal(cap.enabled({}), true);
  assert.equal(cap.enabled({ MEFI_STUDIO_NO_TASK_CAP: "1" }), false, "MEFI_STUDIO_NO_TASK_CAP=1 is the switch");
  assert.equal(cap.enabled({ MEFI_STUDIO_NO_TASK_CAP: "0" }), true);
  assert.equal(cap.enabled({ MEFI_STUDIO_NO_TASK_CAP: "" }), true);
  assert.equal(cap.enabled(undefined), true);
});

test("the ceiling the stepper offers follows the hard kill and never leaves the range", () => {
  assert.equal(cap.ceilingMinutes(KILL), 25);
  assert.equal(cap.ceilingMinutes(10 * 60000), 10);
  assert.equal(cap.ceilingMinutes(3 * 60000), 5, "not under the smallest limit");
  assert.equal(cap.ceilingMinutes(10 * 3600000), 240, "not over the largest");
  assert.equal(cap.ceilingMinutes(NaN), 25);
});

test("the worker is told 60% of its limit as its budget, 15 of the default 25, never more than before and never under 2", () => {
  assert.equal(cap.toldBudgetMinutes(15, KILL), 15, "the default limit tells the worker what it was always told");
  assert.equal(cap.toldBudgetMinutes(15, 10 * 60000), 6);
  assert.equal(cap.toldBudgetMinutes(15, 5 * 60000), 3);
  assert.equal(cap.toldBudgetMinutes(15, 60000), 2, "a floor");
  assert.equal(cap.toldBudgetMinutes(15, 240 * 60000), 15, "a longer limit never promises more than the usual budget");
  assert.equal(cap.toldBudgetMinutes(15, undefined), 15);
  assert.equal(cap.toldBudgetMinutes(undefined, KILL), 15);
});

test("a stop at the limit has its own words and a hold that says the app stopped it", () => {
  assert.equal(cap.stopReason(25), "stopped at the time limit (25 min)");
  assert.deepEqual(cap.holdFor({ minutes: 10, now: 1234 }), { at: 1234, kind: "limit", minutes: 10, reason: "stopped at the time limit (10 min)" });
});
