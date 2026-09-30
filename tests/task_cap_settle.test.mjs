// What a stop at the time limit leaves behind, in the pure modules that read it:
// the card the settle writes, the ledger row, the attempt history, the words the
// board and the notices use, the loop guard's classifier, and the model's record.
// A limit stop is the owner's stop path with its own reason; nothing is charged.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { classifyOutcomeLine } from "../scripts/assistant.mjs";

const require = createRequire(import.meta.url);
const core = require("../scripts/executor-core.cjs");
const backlog = require("../scripts/backlog.cjs");
const oversight = require("../scripts/task-oversight.cjs");
const cap = require("../scripts/task-cap.cjs");
const { attemptsFromLedger } = require("../scripts/task-attempts.cjs");

const NOW = 1_700_000_000_000;
const hold = cap.holdFor({ minutes: 25, now: NOW });
const run = (more = {}) => ({ id: "run_1_1", startedAt: NOW - 25 * 60000, handoffs: [], outputTail: ["editing"], outputLog: ["editing"], sawDone: false, spoke: true, capStop: { minutes: 25, at: NOW }, ownerHold: hold, ...more });
const settleOptions = { now: NOW, maxHandoffs: 3, startGrace: 5, clip: (text, max) => String(text).slice(0, max) };
const task = (more = {}) => ({ id: "t1", title: "Wire the retry button", status: "active", runId: "run_1_1", runFailures: 2, ...more });
const stopped = (more = {}) => core.settleAttemptRow(task(more.task), { ok: false, userStop: true, code: 1, errorMessage: "stopped at the time limit (25 min)", attempt: { runId: "run_1_1" }, run: run(more.run) }, settleOptions);

test("the settle of a limit stop saves progress, charges nothing and holds the card for the owner with a reason of its own", () => {
  const row = stopped();
  assert.equal(row.status, "open");
  assert.equal(row.runId, undefined);
  assert.equal(row.runFailures, 2, "the failures it had are neither added to nor reset");
  assert.equal(row.nextRunAt, undefined, "no backoff: nothing failed");
  assert.equal(row.lastRunError, undefined);
  assert.equal(row.lastAttempt, undefined, "a stop is not filed as failure evidence");
  assert.equal(row.runProgress.pending, true);
  assert.deepEqual(row.ownerHold, hold);
  assert.equal(row.ownerHold.kind, "limit");
  assert.equal(row.logs.at(-1).text, "stopped at the time limit (25 min) (unfinished) — progress saved, nothing failed; held for you");
  // A run that had already reported done says so, and an asked-for resume cancels the hold as it does for the owner's stop.
  assert.match(stopped({ run: { sawDone: true } }).logs.at(-1).text, /\(run had reported done\)/);
  const resumed = stopped({ run: { resumeRequested: true } });
  assert.equal(resumed.ownerHold, undefined);
  assert.equal(resumed.pin, true);
  assert.match(resumed.logs.at(-1).text, /ready to resume$/);
});

test("an owner's own stop keeps its old words exactly", () => {
  const row = core.settleAttemptRow(task(), { ok: false, userStop: true, code: 1, errorMessage: "stopped by you", attempt: { runId: "run_1_1" }, run: run({ capStop: undefined, ownerHold: { at: NOW, reason: "stopped by you" } }) }, settleOptions);
  assert.equal(row.logs.at(-1).text, "stopped on request (unfinished) — progress saved; held for you");
  assert.deepEqual(row.ownerHold, { at: NOW, reason: "stopped by you" });
});

test("the ledger row of a limit stop carries the limit, and only a limit stop does", () => {
  const job = { kind: "task", ref: { id: "t1" }, title: "T" };
  const base = { job, ok: false, code: 1, errorMessage: "stopped at the time limit (25 min)", userStop: true, now: NOW, doneMark: "MEFI_JOB_DONE" };
  const limited = core.finishLogRecord({ run: run(), ...base });
  assert.equal(limited.stopped, true);
  assert.equal(limited.limitMinutes, 25);
  const plain = core.finishLogRecord({ run: run({ capStop: undefined }), ...base, errorMessage: "stopped by you" });
  assert.equal("limitMinutes" in plain, false, "an owner's stop has no limit key at all");
  const failed = core.finishLogRecord({ run: run(), ...base, userStop: false, errorMessage: "killed after budget" });
  assert.equal("limitMinutes" in failed, false, "a hard kill is not a limit stop");
});

test("the attempt history reads the limit back: stopped, at the limit, and how long it was", () => {
  const ledger = [
    { event: "start", runId: "run_1_1", task: "t1", title: "T", via: "opencode", at: 1 },
    { event: "finish", runId: "run_1_1", task: "t1", ok: false, code: 1, stopped: true, limitMinutes: 10, error: "stopped at the time limit (10 min)", seconds: 600, at: 2 },
    { event: "start", runId: "run_2_1", task: "t1", title: "T", via: "opencode", at: 3 },
    { event: "finish", runId: "run_2_1", task: "t1", ok: false, code: 1, stopped: true, error: "stopped by you", seconds: 30, at: 4 },
    { event: "start", runId: "run_3_1", task: "t1", title: "T", via: "opencode", at: 5 },
    { event: "finish", runId: "run_3_1", task: "t1", ok: false, code: 1, error: "killed after budget", seconds: 1500, at: 6 },
  ].map((row) => JSON.stringify(row)).join("\n");
  const attempts = attemptsFromLedger(ledger, { taskId: "t1" }).attempts;
  const byRun = Object.fromEntries(attempts.map((attempt) => [attempt.runId, attempt]));
  assert.deepEqual([byRun.run_1_1.outcome, byRun.run_1_1.stoppedAtLimit, byRun.run_1_1.limitMinutes], ["stopped", true, 10]);
  assert.deepEqual([byRun.run_2_1.outcome, byRun.run_2_1.stoppedAtLimit, byRun.run_2_1.limitMinutes], ["stopped", false, null]);
  assert.deepEqual([byRun.run_3_1.outcome, byRun.run_3_1.stoppedAtLimit], ["failed", false], "the hard kill is still a failure");
});

test("a limit stop is never a loss for the model, and the hard kill still is", () => {
  const end = { ok: false, spoke: true, ageMs: 25 * 60000 };
  assert.equal(core.attemptLedgerOutcome({ ...end, userStop: true, endKind: "stopped" }), null, "the owner's stop path: not counted against the model");
  assert.equal(core.attemptLedgerOutcome({ ...end, userStop: false, endKind: "budget" }, { errorMessage: "killed after budget" }), "failed", "the hard kill with no limit in force: as before");
  assert.deepEqual(core.classifyRunEnd({ ...end, userStop: true, endKind: "stopped" }), { branch: "stopped", infra: false, ownFailure: false });
});

test("the board and the notices say the app stopped it at its limit, and the owner's word resumes it", () => {
  const row = { id: "t1", title: "Wire the retry button", status: "open", ownerHold: hold, runProgress: { pending: true, interruptedAt: NOW } };
  const state = backlog.workState(row, NOW);
  assert.equal(state.stage, "blocked");
  assert.equal(state.blockedBy, "owner");
  assert.equal(state.reason, "Stopped at the time limit (25 min) — progress saved; say \"work on it\" or \"try again\" to continue");
  const before = { id: "t1", title: "Wire the retry button", status: "active", runId: "run_1_1" };
  const first = oversight.taskEvents(null, [before], { now: NOW, isOwned: () => true });
  const second = oversight.taskEvents(first.index, [row], { now: NOW, isOwned: () => true });
  assert.deepEqual(second.events.map((event) => [event.kind, event.text]), [["stopped", "\"Wire the retry button\" reached its time limit (25 min) and was stopped — progress saved, nothing failed; it waits for you. Say \"work on it\" or \"try again\" to carry on."]]);
  const digest = oversight.boardDigest({ tasks: [row], now: NOW });
  assert.equal(digest.needsYou[0].need, "stopped");
  assert.match(digest.needsYou[0].reason, /^Stopped at the time limit \(25 min\)/);
  // The owner's word (try again) releases it like any other hold.
  const again = backlog.retryTask(row, NOW);
  assert.equal(again.ownerHold, undefined);
  assert.equal(backlog.workState(again, NOW).stage, "ready");
  // An owner's own stop keeps its old words.
  const own = oversight.taskEvents(first.index, [{ ...row, ownerHold: { at: NOW, reason: "stopped in chat" } }], { now: NOW, isOwned: () => true });
  assert.match(own.events[0].text, /^Stopped "Wire the retry button" — progress saved; it waits for you\./);
});

test("the loop guard's ledger ignores a limit stop the way it ignores the owner's stop", () => {
  assert.deepEqual(classifyOutcomeLine("stopped at the time limit (25 min) (unfinished) — progress saved, nothing failed; held for you"), { kind: "ignored", reason: "stopped at the time limit" });
  assert.deepEqual(classifyOutcomeLine("stopped on request (unfinished) — progress saved; held for you"), { kind: "ignored", reason: "stopped on request" });
  assert.equal(classifyOutcomeLine("autopilot run failed (exit 1) · killed after budget · retry 1/5").kind, "run", "the hard kill still counts");
});
