import test from "node:test";
import assert from "node:assert/strict";
import { parseExecutorResult } from "../scripts/assistant.mjs";
import { executorHost } from "./fixtures/host_executor.mjs";

test("saved result text echoed by a tool is not a new worker result", () => {
  for (const line of [
    '    "text": "MEFI_RESULT: done: old attempt; remaining: old obligation",',
    '"MEFI_RESULT: done: old attempt; remaining: none",',
    "Previous output: MEFI_RESULT: done: old attempt; remaining: none",
    "Print MEFI_RESULT: done: <finished>; remaining: <unfinished>",
    "> MEFI_RESULT: done: quoted attempt; remaining: none",
  ]) assert.equal(parseExecutorResult(line), null, line);
});

test("standalone result lines retain plain and terminal-colored CLI compatibility", () => {
  for (const line of [
    "MEFI_RESULT: done: current work; remaining: none",
    "  MEFI_RESULT: done: current work; remaining: none  ",
    "\u001b[32mMEFI_RESULT: done: current work; remaining: none\u001b[0m",
  ]) {
    assert.deepEqual(parseExecutorResult(line), {
      raw: "done: current work; remaining: none",
      parts: { done: "current work", remaining: "none" },
    });
  }
});

test("the host ignores an echoed saved result before recording the current completion", async () => {
  const h = executorHost({ tasks: [{ id: "result-fixture", title: "Implement fixture", prompt: "Implement the fixture", status: "open", createdAt: 1 }] });
  h.wake(); await h.pump();
  await h.finish("result-fixture", { lines: [
    '    "text": "MEFI_RESULT: done: old attempt; remaining: old obligation",',
    "MEFI_RESULT: done: current implementation; remaining: none",
    "MEFI_JOB_DONE",
  ] });
  let saved = h.board().tasks[0];
  assert.equal(saved.status, "awaiting_verification");
  assert.deepEqual(saved.lastAttempt.result.parts, { done: "current implementation", remaining: "none" });
  h.advance(31000); await h.pump();
  saved = h.board().tasks[0];
  assert.equal(saved.status, "done", "the current result can verify against the fixture's recorded edits");
  assert.equal(saved.verifyAttempts, undefined);
  assert.equal(h.starts.length, 1, "stale echoed obligations do not cause another build");
});

test("ignoring an echoed success cannot erase a current unfinished obligation", async () => {
  const h = executorHost({ tasks: [{ id: "unfinished-fixture", title: "Implement fixture", prompt: "Implement the fixture", status: "open", createdAt: 1 }] });
  h.wake(); await h.pump();
  await h.finish("unfinished-fixture", { lines: [
    '    "text": "MEFI_RESULT: done: old success; remaining: none",',
    "MEFI_RESULT: done: current partial work; remaining: actual missing feature",
    "MEFI_JOB_DONE",
  ] });
  h.advance(31000); await h.pump();
  const saved = h.board().tasks[0];
  assert.equal(saved.lastAttempt.result.parts.remaining, "actual missing feature");
  assert.equal(saved.status, "open");
  assert.equal(saved.verification.reason, "outstanding obligations remain");
  assert.equal(saved.verifyAttempts, 1);
});
