import test from "node:test";
import assert from "node:assert/strict";
import { completedRequestTask } from "../scripts/task-history.mjs";
import { compact } from "../scripts/assistant.mjs";

const request = {
  title: "Improve the project picker", prompt: "Keep the selected project visible", at: 100,
  projectId: "project-a", projectPath: "C:/projects/a", source: "chat", runId: "run-1",
  lastAttempt: { runId: "run-1", at: 200, code: 0, sessionId: "session-1", result: { parts: { done: "Added picker" } } },
};
const verdict = { state: "verified", reason: "1 changed file in the attempt's session" };

test("verified inbox work becomes durable, project-scoped task history with its evidence", () => {
  const original = structuredClone(request);
  const task = completedRequestTask(request, verdict, { now: 300, changedFiles: 1, receiptId: "receipt-1" });
  assert.equal(task.status, "done");
  assert.equal(task.doneAt, 300);
  assert.equal(task.createdAt, 100);
  assert.equal(task.projectId, "project-a");
  assert.equal(task.projectPath, "C:/projects/a");
  assert.equal(task.lastAttempt.result.parts.done, "Added picker");
  assert.equal(task.verification.evidenceKind, "runner-observed-edits");
  assert.equal(task.verificationReceiptId, "receipt-1");
  assert.deepEqual(task.refs, [{ kind: "session", title: "Worker session", detail: "session-1" }]);
  assert.deepEqual(request, original, "building history must not mutate the inbox record");
  assert.equal(task.runId, undefined, "a completed card must not retain a live claim");
});

test("the same verified attempt yields the same history identity on repeated settlement", () => {
  const first = completedRequestTask(request, verdict, { now: 300 });
  const next = completedRequestTask(request, verdict, { now: 900 });
  assert.equal(first.id, next.id);
  assert.notEqual(first.id, completedRequestTask({ ...request, lastAttempt: { runId: "run-2" } }, verdict).id);
});

test("a successful worker exit alone never creates a completed task", () => {
  for (const result of [null, {}, { state: "unverified" }, { state: "failed" }]) {
    assert.equal(completedRequestTask(request, result), null);
  }
});

test("old requests retain project identity and distinguish worker-reported checks", () => {
  const old = { title: "Test the picker", at: 10, projectPath: "C:/projects/a" };
  const task = completedRequestTask(old, { ...verdict, evidence: { namedChecks: true } });
  assert.equal(task.verification.evidenceKind, "worker-named-checks");
  assert.notEqual(task.id, completedRequestTask({ ...old, projectPath: "C:/projects/b" }, verdict).id);
  assert.equal(completedRequestTask({}, verdict), null);
});

test("housekeeping preserves distinct completed attempts with the same title", () => {
  const first = completedRequestTask(request, verdict, { now: 300 });
  const second = completedRequestTask({ ...request, lastAttempt: { ...request.lastAttempt, runId: "run-2" } }, verdict, { now: 400 });
  const duplicate = { ...second, id: "duplicate-card", status: "archived" };
  const result = compact({ requests: [], tasks: [first, second, duplicate], ideas: [], now: 500 });
  assert.equal(result.tasks.length, 2, "only the duplicate stamp of run-2 is removed");
  assert.deepEqual(result.tasks.map((task) => task.lastAttempt.runId).sort(), ["run-1", "run-2"]);
});

test("manual completions with the same title retain distinct task history", () => {
  const tasks = [
    { id: "one", title: "Publish weekly update", status: "done", doneAt: 100 },
    { id: "two", title: "Publish weekly update", status: "archived", doneAt: 200 },
  ];
  const result = compact({ tasks, now: 300 });
  assert.equal(result.tasks.length, 2);
});
