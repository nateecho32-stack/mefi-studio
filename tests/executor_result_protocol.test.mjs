import test from "node:test";
import assert from "node:assert/strict";
import { parseExecutorResult, verifyCompletion } from "../scripts/assistant.mjs";
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

// A long report used to be dropped whole, and with it the card's result, its
// named checks and the overseer's verification run.
test("a start-anchored result line over 300 characters is clipped, not dropped", () => {
  const line = `MEFI_RESULT: done: ${"verified every poll owner on disk ".repeat(12)}; remaining: none; ran: npm run check`;
  assert.ok(line.length > 300);
  const parsed = parseExecutorResult(line);
  assert.ok(parsed, "a long line still parses");
  assert.ok(parsed.raw.length <= 300);
  assert.equal(parsed.parts.done.length, 200);
  assert.equal(parsed.parts.remaining, "none");
  assert.equal(parsed.parts.ran, "npm run check");
  assert.equal(parseExecutorResult(`> ${line}`), null, "the start anchor still rejects a quoted echo");
});

// The result line stripped colour; the verdict sentinel did not. A CLI that
// wraps its last line then exits non-zero had its report thrown away and the
// card charged a failure with a retry backoff.
test("a colour-wrapped verdict sentinel is still the run's verdict", async () => {
  const h = executorHost({ tasks: [{ id: "ansi-fixture", title: "Implement fixture", prompt: "Implement the fixture", status: "open", createdAt: 1 }] });
  h.wake(); await h.pump();
  await h.finish("ansi-fixture", { code: 1, lines: [
    "MEFI_RESULT: done: current implementation; remaining: none",
    "\u001b[32mMEFI_JOB_DONE\u001b[0m",
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

// The owner lane. What only the owner can do (the board, Studio's task store,
// another session's files) is neither work this task still owes nor a
// hand-off: it goes under owner:, reaches the owner once as an "owner" issue,
// and never fails verification. The remaining-prose reader is not widened.
const ownerTask = (id, extra = {}) => ({ id, title: "Follow-up 2: TESTRUNS append helper", prompt: "Verify the append helper", status: "open", createdAt: 1, ...extra });
const settleRaises = () => new Promise((resolve) => setImmediate(resolve));
function raisingHost(options) {
  const h = executorHost(options);
  const raised = [];
  h.env.assistantRaiseIssue = async (issue) => { raised.push(issue); return null; };
  return { h, raised };
}

test("the worker prompt teaches the owner: part of the result line", async () => {
  const h = executorHost({ tasks: [ownerTask("task_prompt_fixture")] });
  h.wake(); await h.pump();
  const prompt = h.starts[0].child.prompt;
  assert.ok(prompt.includes("MEFI_RESULT: done: <what you finished>; remaining: <what this task still owes, or none>; owner: <what only the owner can do, or leave it out>"));
  assert.ok(prompt.includes("Anything only the owner can do (board changes, Studio's task store, another session's files) goes under owner:, never under remaining: or MEFI_NEXT."));
  // The cmd.exe route turns double quotes into spaces.
  assert.match(prompt, /Use\W+owner\W+for something only the owner can do/);
  assert.match(prompt, /\|verify\|owner> ::/);
  assert.match(prompt, /Print the exact line MEFI_JOB_DONE as the last thing you say\.$/);
});

test("an owner: part is raised as the owner's, after the run's own asks, with the card's chain", async () => {
  const { h, raised } = raisingHost({ tasks: [ownerTask("task_owner_fixture", { splitFrom: "task_parent_fixture", splitDepth: 2 })] });
  h.wake(); await h.pump();
  await h.finish("task_owner_fixture", { lines: [
    "MEFI_ASK: scope :: the reader has to be written too",
    "MEFI_RESULT: done: the helper is verified; remaining: none; owner: reword the stored acceptance",
    "MEFI_JOB_DONE",
  ] });
  await settleRaises();
  assert.deepEqual(raised.map((issue) => [issue.kind, issue.title]), [["scope", "the reader has to be written too"], ["owner", "reword the stored acceptance"]]);
  const owner = raised[1];
  assert.equal(owner.source, "worker");
  assert.equal(owner.taskId, "task_owner_fixture");
  assert.equal(owner.taskTitle, "Follow-up 2: TESTRUNS append helper");
  assert.equal(owner.runId, h.starts[0].runId);
  assert.equal(owner.splitFrom, "task_parent_fixture");
  assert.equal(owner.splitDepth, 2);
  assert.equal(raised[0].splitDepth, 2, "a MEFI_ASK carries the chain too, so its card offers Split only where it can land");
  // The owner's part is no obligation of this card: it verifies.
  h.advance(31000); await h.pump();
  const saved = h.board().tasks[0];
  assert.equal(saved.lastAttempt.result.parts.owner, "reword the stored acceptance");
  assert.equal(saved.status, "done");
  assert.equal(saved.verification.evidence?.outstanding ?? false, false);
  // A denial asks nothing.
  const { h: quiet, raised: none } = raisingHost({ tasks: [ownerTask("task_quiet_fixture")] });
  quiet.wake(); await quiet.pump();
  await quiet.finish("task_quiet_fixture", { lines: ["MEFI_RESULT: done: all of it; remaining: none; owner: none", "MEFI_JOB_DONE"] });
  await settleRaises();
  assert.deepEqual(none, []);
});

test("remaining: none beside an owner: part is not outstanding; the same leftover under remaining: still is", () => {
  const resultNote = parseExecutorResult("MEFI_RESULT: done: the helper; remaining: none; owner: reword the stored acceptance");
  assert.deepEqual(resultNote.parts, { done: "the helper", remaining: "none", owner: "reword the stored acceptance" });
  const verdict = verifyCompletion({ verdictOk: true, changedFiles: 1, hasSession: true, resultNote });
  assert.equal(verdict.evidence.outstanding, false);
  assert.equal(verdict.state, "verified");
  const owed = verifyCompletion({ verdictOk: true, changedFiles: 1, hasSession: true, resultNote: parseExecutorResult("MEFI_RESULT: done: the helper; remaining: reword the stored acceptance") });
  assert.equal(owed.evidence.outstanding, true);
  assert.equal(owed.reason, "outstanding obligations remain");
});

test("a ';' inside brackets stays in its field, and a clipped field keeps its closing bracket", () => {
  const resultNote = parseExecutorResult("MEFI_RESULT: done: the helper; remaining: none (owner-only: flip task_a; reword task_b); ran: npm run check [a; b]");
  assert.deepEqual(resultNote.parts, { done: "the helper", remaining: "none (owner-only: flip task_a; reword task_b)", ran: "npm run check [a; b]" });
  const verdict = verifyCompletion({ verdictOk: true, changedFiles: 1, hasSession: true, resultNote });
  assert.equal(verdict.evidence.outstanding, false, "the aside's second clause is not a second remaining item");
  const long = parseExecutorResult(`MEFI_RESULT: done: x; remaining: none (owner-only: ${"reword the stored acceptance ".repeat(10)})`);
  assert.equal(long.parts.remaining.length, 200);
  assert.ok(long.parts.remaining.endsWith(")"), "the clip closes the aside it cut");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 1, hasSession: true, resultNote: long }).evidence.outstanding, false);
  // Unbalanced text is not repaired or re-split beyond the brackets it opened.
  assert.deepEqual(parseExecutorResult("MEFI_RESULT: done: a) b; remaining: none").parts, { done: "a) b", remaining: "none" });
});

test("a run the owner or the host stopped raises none of its asks", async () => {
  const { h, raised } = raisingHost({ tasks: [ownerTask("task_stopped_fixture")] });
  h.wake(); await h.pump();
  // How Stop all and a project switch mark the runs they end.
  h.autopilot.jobs.find((job) => job.taskId === "task_stopped_fixture").stopUser = true;
  await h.finish("task_stopped_fixture", { code: 1, lines: [
    "MEFI_ASK: owner :: flip task_landing_fixture1 to done",
    "MEFI_RESULT: done: half of it; remaining: the rest; owner: flip the landing card",
  ] });
  await settleRaises();
  assert.deepEqual(raised, []);
  assert.equal(h.board().tasks[0].status, "open", "it resumes from its checkpoint");
  assert.equal(h.board().tasks[0].runFailures, undefined);
});

test("the live map's per-run cap bounds how many asks one run raises", async () => {
  const lines = ["MEFI_ASK: scope :: one", "MEFI_ASK: missing :: two", "MEFI_ASK: conflict :: three", "MEFI_JOB_DONE"];
  const { h, raised } = raisingHost({ tasks: [ownerTask("task_cap_fixture")] });
  // The rules as the issue lane last read them.
  h.env.issuePolicySeen = { perRun: 1 };
  h.wake(); await h.pump();
  await h.finish("task_cap_fixture", { lines });
  await settleRaises();
  assert.deepEqual(raised.map((issue) => issue.title), ["one"]);
  // With nothing read yet the module's cap stands.
  const { h: fresh, raised: all } = raisingHost({ tasks: [ownerTask("task_nocap_fixture")] });
  fresh.wake(); await fresh.pump();
  await fresh.finish("task_nocap_fixture", { lines });
  await settleRaises();
  assert.deepEqual(all.map((issue) => issue.title), ["one", "two", "three"]);
});
