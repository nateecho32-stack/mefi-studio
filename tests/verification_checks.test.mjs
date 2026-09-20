import test from "node:test";
import assert from "node:assert/strict";
import { isVerificationCommand, summarizeObservedChecks, verifyCompletion } from "../scripts/assistant.mjs";

const check = (command = "npm test", extra = {}) => ({ command, status: "completed", exitCode: 0, startedAt: 1000, finishedAt: 2000, passed: true, ...extra });

test("only recognizable direct check commands provide check evidence", () => {
  for (const command of ["npm test", "npm run check", "node --test tests/board.test.mjs", "python -m unittest discover -s tools", "python tools/verify_command.py", 'cd "C:/my project" && npm test', "cargo test"]) {
    assert.equal(isVerificationCommand(command), true, command);
  }
  for (const command of ["echo npm test", 'Write-Output "npm test passed"', "npm test || true", "npm test; exit 0", "npm test | cat", "node --version", "git status", 'powershell -Command "npm test; exit 0"', "npm install", "npm test\necho passed"]) {
    assert.equal(isVerificationCommand(command), false, command);
  }
});

test("worker-named checks cannot substitute for recorded executions", () => {
  const claim = { verdictOk: true, resultNote: { parts: { tests: "npm test passed" } } };
  assert.equal(verifyCompletion(claim).state, "unverified");
  assert.equal(verifyCompletion({ ...claim, hasSession: true, changedFiles: 2 }).state, "unverified");
  assert.equal(verifyCompletion({ ...claim, hasSession: true, observedChecks: [check()] }).state, "verified");
  assert.equal(verifyCompletion({ ...claim, observedChecks: [check()] }).state, "unverified", "a check needs an attributed session");
  assert.equal(verifyCompletion({ ...claim, hasSession: true, observedChecks: [check("echo npm test")] }).state, "unverified");
});

test("latest outcome of each check wins without concealing another failed check", () => {
  const failed = check("npm test", { exitCode: 1, passed: false });
  const fixed = check("npm test", { startedAt: 3000 });
  assert.deepEqual(summarizeObservedChecks([fixed, failed]), { total: 1, passed: 1, failed: 0, pending: 0 });
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [fixed, failed] }).state, "verified");
  const otherFailure = check("npm run check", { exitCode: 2, passed: false });
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 9, observedChecks: [fixed, otherFailure] }).state, "unverified");
  const pending = check("npm test", { startedAt: 4000, status: "running", exitCode: null, passed: null });
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [fixed, pending] }).state, "unverified");
});

test("missing and truncated command metadata never fabricates a passing check", () => {
  for (const row of [check("npm test", { commandTruncated: true }), check("npm test", { startedAt: 0 }), check("npm test", { passed: null }), check("npm test", { exitCode: "0" })]) {
    assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [row] }).state, "unverified");
  }
});
