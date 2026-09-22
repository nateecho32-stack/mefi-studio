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

// The result line stripped colour; the verdict sentinel did not. A CLI that
// wraps its last line then exits non-zero had its report thrown away and the
// card charged a failure with a retry backoff.
test("a colour-wrapped verdict sentinel is still the run's verdict", async () => {
  const h = executorHost({ tasks: [{ id: "ansi-fixture", title: "Implement fixture", prompt: "Implement the fixture", status: "open", createdAt: 1 }] });
  h.wake(); await h.pump();
  await h.finish("ansi-fixture", { code: 1, lines: [
    "MEFI_RESULT: done: current implementation; remaining: none",
    "[32mMEFI_JOB_DONE[0m",
  ] });
  const saved = h.board().tasks[0];
  assert.equal(saved.status, "awaiting_verification", "the CLI's colour is not the worker's answer");
  assert.equal(saved.lastAttempt.sawDone, true);
  assert.equal(saved.runFailures, undefined, "a reported success is never also a charged failure");
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

// The documented collision-delegate loop: a card that already verified done
// once is retried, its faithful scoped-check rerun changes 0 files (the work
// landed before pickup), and the green rerun must discharge the obligation
// instead of reopening the card forever.
test("a done+verified retry with 0 changed files discharges on its green scoped rerun", async () => {
  const h = executorHost({ tasks: [{ id: "reverify-fixture", title: "Re-verify landed work", prompt: "Re-verify the landed work", status: "open", createdAt: 1,
    logs: [{ at: 1, kind: "status", text: "verified — sentinel seen, 3 changed file(s)" }] }] });
  h.wake(); await h.pump();
  await h.finish("reverify-fixture", { lines: [
    "MEFI_RESULT: done: scoped checks re-ran green over the landed work; remaining: the odd handoff phrasing the denial reader cannot know",
    "MEFI_JOB_DONE",
  ], files: [], observedChecks: [{ command: "npm run check", status: "completed", exitCode: 0, startedAt: 900000, finishedAt: 950000, passed: true }] });
  h.advance(31000); await h.pump();
  const saved = h.board().tasks[0];
  assert.equal(saved.status, "done", "the fresh green scoped-check rerun discharges the done+verified retry");
  assert.match(saved.verification.reason, /discharges the done\+verified retry/);
  assert.equal(saved.verifiedOnce, true, "the durable prior-verified stamp survives for later retries");
  assert.equal(saved.verifyAttempts, undefined);
  assert.equal(h.starts.length, 1, "a discharged retry does not loop into another build");
});

// The requirement's named alternative evidence: the retry's only edit is the
// TESTRUNS row documenting its green rerun. The ledger row is documentation,
// not landed code, so it discharges exactly like the 0-file retry — while a
// retry that also touches a code file stays an outstanding obligation.
test("a done+verified retry whose only change is a TESTRUNS row discharges on its green scoped rerun", async () => {
  const h = executorHost({ tasks: [{ id: "ledger-fixture", title: "Re-verify landed work", prompt: "Re-verify the landed work", status: "open", createdAt: 1, logs: [{ at: 1, kind: "status", text: "verified — sentinel seen, 3 changed file(s)" }] }] });
  h.wake(); await h.pump();
  await h.finish("ledger-fixture", { lines: [
    "MEFI_RESULT: done: TESTRUNS row records the green scoped rerun; remaining: the odd handoff phrasing the denial reader cannot know",
    "MEFI_JOB_DONE",
  ], files: [{ file: "TESTRUNS.md", status: "completed" }], observedChecks: [{ command: "npm run check", status: "completed", exitCode: 0, startedAt: 900000, finishedAt: 950000, passed: true }] });
  h.advance(31000); await h.pump();
  let saved = h.board().tasks[0];
  assert.equal(saved.status, "done", "the ledger row is the changed-file the retry verifier accepts");
  assert.match(saved.verification.reason, /only the ledger row changed/);
  assert.equal(h.starts.length, 1, "no re-run loop for a ledger-only retry");
  const code = executorHost({ tasks: [{ id: "code-fixture", title: "Re-verify landed work", prompt: "Re-verify the landed work", status: "open", createdAt: 1, logs: [{ at: 1, kind: "status", text: "verified — sentinel seen, 3 changed file(s)" }] }] });
  code.wake(); await code.pump();
  await code.finish("code-fixture", { lines: [
    "MEFI_RESULT: done: touched the code again; remaining: the odd handoff phrasing the denial reader cannot know",
    "MEFI_JOB_DONE",
  ], files: [{ file: "src/feature.js", status: "completed" }, { file: "TESTRUNS.md", status: "completed" }], observedChecks: [{ command: "npm run check", status: "completed", exitCode: 0, startedAt: 900000, finishedAt: 950000, passed: true }] });
  code.advance(31000); await code.pump();
  saved = code.board().tasks[0];
  assert.equal(saved.status, "open", "a non-ledger file change keeps the obligation outstanding");
  assert.equal(saved.verification.reason, "outstanding obligations remain");
});
