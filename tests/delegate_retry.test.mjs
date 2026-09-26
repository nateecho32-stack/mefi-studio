// A card re-armed FOR the owner (the desk, or the assistant under the owner's
// permission mode): unlike the owner's own Try again, it never lifts the
// owner's stop, keeps the loop ledger, the duplicate link and the approval,
// leaves a parked card two failures from parking again, and spends a per-card
// budget kept on the card itself so a restart does not reset it.
import test from "node:test";
import assert from "node:assert/strict";
import backlog from "../scripts/backlog.cjs";

const { delegateRetry, delegatedRetries, retryTask, workState, DELEGATE_PER_DAY } = backlog;
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const parked = (extra = {}) => ({
  id: "task_1", title: "Add the retry banner", status: "open", runFailures: 5, lastRunError: "exit 1", nextRunAt: NOW + HOUR,
  loopLedger: { v: 1, at: NOW - HOUR, n: 3, reasons: { same: 3 } }, duplicateOf: "task_0", buildApproval: { version: 1, scope: "abc", approvedAt: 1 },
  logs: [], ...extra,
});

test("a delegated re-arm opens a parked card but keeps every brake the owner's retry lifts", () => {
  const result = delegateRetry(parked(), NOW, { by: "desk", kind: "run-failed" });
  assert.equal(result.ok, true);
  const next = result.task;
  assert.equal(next.status, "open");
  assert.equal(next.runFailures, 3, "two failures from parking again");
  assert.equal(next.nextRunAt, undefined);
  assert.equal(next.lastRunError, undefined);
  assert.deepEqual(next.loopLedger, { v: 1, at: NOW - HOUR, n: 3, reasons: { same: 3 } });
  assert.equal(next.duplicateOf, "task_0");
  assert.deepEqual(next.buildApproval, { version: 1, scope: "abc", approvedAt: 1 });
  assert.equal(next.pin, undefined, "never pinned ahead of the owner's own work");
  assert.deepEqual(next.assistantRetries, [{ at: NOW, by: "desk", kind: "run-failed" }]);
  assert.match(next.logs.at(-1).text, /Re-armed for you by the desk/);
  // The owner's own Try again, by contrast, lifts all of it.
  const owner = retryTask(parked(), NOW);
  assert.equal(owner.runFailures, undefined);
  assert.equal(owner.buildApproval, undefined);
  assert.equal(owner.pin, true);
});

test("the owner's stop is theirs alone", () => {
  const result = delegateRetry(parked({ ownerHold: { at: NOW - HOUR, reason: "wait" } }), NOW);
  assert.equal(result.ok, false);
  assert.equal(result.held, true);
  assert.equal(workState(parked({ runFailures: 0, ownerHold: { at: 1 } }), NOW).blockedBy, "owner");
});

test("running, finished or missing work is not re-armed", () => {
  assert.equal(delegateRetry(null, NOW).ok, false);
  assert.equal(delegateRetry(parked({ status: "active" }), NOW).ok, false);
  assert.equal(delegateRetry(parked({ runId: "run_1" }), NOW).ok, false);
  assert.equal(delegateRetry(parked({ status: "done" }), NOW).ok, false);
  assert.equal(delegateRetry(parked({ status: "archived" }), NOW).ok, false);
});

test("a card re-armed for the owner twice today waits for the owner; the budget rolls with the day", () => {
  let task = parked();
  for (let index = 0; index < DELEGATE_PER_DAY; index += 1) {
    const result = delegateRetry(task, NOW + index * HOUR);
    assert.equal(result.ok, true);
    task = { ...result.task, runFailures: 5 };
  }
  const spent = delegateRetry(task, NOW + 3 * HOUR);
  assert.equal(spent.ok, false);
  assert.equal(spent.budget, true);
  assert.equal(delegatedRetries(task, NOW + 3 * HOUR).length, DELEGATE_PER_DAY);
  assert.equal(delegateRetry(task, NOW + 26 * HOUR).ok, true, "a day later it may be re-armed again");
});

test("only a verification answer re-opens failed verification with bounded attempts", () => {
  const task = parked({ runFailures: 0, verifyAttempts: 3, verification: { state: "failed" }, verificationReceiptId: "r1" });
  const unrelated = delegateRetry(task, NOW, { kind: "scope" }).task;
  assert.deepEqual(unrelated.verification, task.verification);
  assert.equal(unrelated.verifyAttempts, 3);
  assert.equal(unrelated.verificationReceiptId, "r1");
  const next = delegateRetry(task, NOW, { kind: "verify" }).task;
  assert.equal(next.verification, undefined);
  assert.equal(next.verificationReceiptId, undefined);
  assert.equal(next.verifyAttempts, 1);
  assert.equal(workState({ ...next, duplicateOf: undefined }, NOW).stage, "ready");
});

test("a delegated retry preserves both keeper and owner loop holds, even when a caller requests lifting them", () => {
  const looped = parked({ runFailures: 0, loopGuard: { v: 1, at: NOW, by: "keeper", count: 4 } });
  assert.ok(delegateRetry(looped, NOW, { liftLoop: false }).task.loopGuard, "a plain try again leaves it");
  assert.deepEqual(delegateRetry(looped, NOW, { liftLoop: true }).task.loopGuard, looped.loopGuard);
  const owners = parked({ runFailures: 0, loopGuard: { v: 1, at: NOW, by: "owner", kind: "family" } });
  assert.ok(delegateRetry(owners, NOW, { liftLoop: true }).task.loopGuard, "the owner's own hold stays");
});
