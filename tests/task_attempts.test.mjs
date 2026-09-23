import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { attemptsFromLedger } = require("../scripts/task-attempts.cjs");

const ledger = (...rows) => rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n");

const history = ledger(
  { at: 100, event: "start", runId: "run_100_1", kind: "task", task: "task-a", title: "Fix save", via: "opencode/glm", pid: 11 },
  { at: 160, event: "finish", runId: "run_100_1", kind: "task", task: "task-a", title: "Fix save", ok: true, code: 0, error: null, sawDone: true, sessionId: "ses_one", seconds: 60, result: "done: saved", tail: ["\u001b[0m$ npm test", "ok 3", "MEFI_JOB_DONE"] },
  { at: 200, event: "start", runId: "run_200_2", kind: "task", task: "task-a", title: "Fix save", via: "claude", pid: 12 },
  { at: 205, event: "fallback", runId: "run_200_2", kind: "task", task: "task-a", title: "Fix save", reason: "exited silently" },
  { at: 290, event: "finish", runId: "run_200_2", kind: "task", task: "task-a", title: "Fix save", ok: false, code: 1, error: "tests failed", sessionId: "ses_two", seconds: 90, tail: [] },
  { at: 300, event: "start", runId: "run_300_3", kind: "task", task: "task-b", title: "Other task", via: "grok", pid: 13 },
  { at: 400, event: "start", runId: "run_400_4", kind: "task", task: "task-a", title: "Fix save", via: "opencode/glm", pid: 14 },
  { at: 410, event: "release", runId: "run_300_3", kind: "task", task: "task-b", title: "Other task", reason: "user stop", heldMs: 110 },
  { at: 500, event: "start", runId: "run_500_5", kind: "request", task: null, title: "A request", via: "opencode", pid: 15 },
  '{"at":600,"event":"start","runId":"run_600_6","task":"task-a"', // torn final append
);

test("groups one task's ledger rows into attempts, newest first", () => {
  const { taskId, attempts } = attemptsFromLedger(history, { taskId: "task-a" });
  assert.equal(taskId, "task-a");
  assert.deepEqual(attempts.map((attempt) => attempt.runId), ["run_400_4", "run_200_2", "run_100_1"]);
  const [live, failed, passed] = attempts;
  assert.equal(live.outcome, "unrecorded", "a start with no end is not assumed to be running or failed");
  assert.equal(live.via, "opencode/glm");
  assert.equal(failed.outcome, "failed");
  assert.deepEqual(failed.fallbacks, [{ at: 205, reason: "exited silently" }]);
  assert.equal(failed.error, "tests failed");
  assert.equal(passed.outcome, "finished-ok");
  assert.equal(passed.sessionId, "ses_one");
  assert.equal(passed.startedAt, 100);
  assert.equal(passed.finishedAt, 160);
  assert.deepEqual(passed.tail, ["$ npm test", "ok 3", "MEFI_JOB_DONE"], "terminal colour codes are stripped");
});

test("release, stop and trimmed starts keep their own outcome", () => {
  const released = attemptsFromLedger(history, { taskId: "task-b" }).attempts[0];
  assert.equal(released.outcome, "released");
  assert.deepEqual(released.release, { at: 410, reason: "user stop", heldMs: 110 });
  const trimmed = attemptsFromLedger(ledger(
    { at: 50, event: "finish", runId: "run_1_1", task: "task-c", ok: false, stopped: true, sessionId: "s" },
  ), { taskId: "task-c" }).attempts[0];
  assert.equal(trimmed.outcome, "stopped");
  assert.equal(trimmed.startedAt, 50, "a start trimmed off the ledger falls back to the first row seen");
});

test("a session id resolves the task its run served", () => {
  const found = attemptsFromLedger(history, { sessionId: "ses_two" });
  assert.equal(found.taskId, "task-a");
  assert.equal(found.attempts.length, 3);
  assert.deepEqual(attemptsFromLedger(history, { sessionId: "ses_unknown" }), { taskId: null, attempts: [] });
  assert.deepEqual(attemptsFromLedger(history, {}), { taskId: null, attempts: [] });
});

test("bad input and limits stay bounded", () => {
  assert.deepEqual(attemptsFromLedger(null, { taskId: "task-a" }), { taskId: "task-a", attempts: [] });
  assert.deepEqual(attemptsFromLedger("not json\n{}\n[1]", { taskId: "task-a" }).attempts, []);
  assert.equal(attemptsFromLedger(history, { taskId: "task-a", limit: 1 }).attempts.length, 1);
  const long = ledger({ at: 1, event: "finish", runId: "run_long", task: "task-d", ok: true, tail: Array.from({ length: 90 }, (_, index) => `line ${index}`) });
  const [attempt] = attemptsFromLedger(long, { taskId: "task-d" }).attempts;
  assert.equal(attempt.tail.length, 40);
  assert.equal(attempt.tail.at(-1), "line 89");
});
