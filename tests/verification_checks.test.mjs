import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { isVerificationCommand, summarizeObservedChecks, verifyCompletion, scheduleVerificationOnDone, projectBaseCheck, loveHarnessCheckCommand, repoCheckCommand, claimedCommitHash } from "../scripts/assistant.mjs";

const check = (command = "npm test", extra = {}) => ({ command, status: "completed", exitCode: 0, startedAt: 1000, finishedAt: 2000, passed: true, ...extra });

test("commit evidence settles commit-only deliverables without loosening ordinary rules", () => {
  // The loop case: a commit task edits nothing itself — changedFiles: 0 after
  // a real commit is the success shape, not a false negative.
  const claim = { verdictOk: true, hasSession: true, changedFiles: 0, resultNote: { parts: { done: "committed 3198c4d Add rail accounting test", remaining: "none" } } };
  assert.equal(claimedCommitHash(claim.resultNote.parts), "3198c4d");
  assert.equal(claimedCommitHash({ commit: "5caa1360e11d2a7b8c9f0d1e2a3b4c5d6e7f8a9b" }), "5caa1360e11d2a7b8c9f0d1e2a3b4c5d6e7f8a9b");
  assert.equal(claimedCommitHash({ done: "rail accounting test landed" }), null, "no commit word, no claim");
  assert.equal(claimedCommitHash({ commit: "not-a-hash" }), null);
  assert.equal(claimedCommitHash({}), null);
  assert.equal(verifyCompletion(claim).state, "unverified", "a commit claim alone is not evidence");
  assert.equal(verifyCompletion({ ...claim, commit: { hash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", clean: true } }).state, "unverified", "the observed hash must match the claim");
  assert.equal(verifyCompletion({ ...claim, commit: { hash: "3198c4d", clean: null } }).state, "unverified", "an unreadable path status never accepts");
  const dirty = verifyCompletion({ ...claim, commit: { hash: "3198c4dab12cd34ef56", clean: false } });
  assert.equal(dirty.state, "unverified");
  assert.match(dirty.reason, /uncommitted changes/);
  const landed = verifyCompletion({ ...claim, commit: { hash: "3198c4dab12cd34ef56", clean: true } });
  assert.equal(landed.state, "verified");
  assert.equal(landed.evidence.commit.hash, "3198c4dab12cd34ef56");
  assert.match(landed.reason, /clean path status/);
  // The gate stays shut for everything that always failed.
  assert.equal(verifyCompletion({ ...claim, verdictOk: false, commit: { hash: "3198c4d", clean: true } }).state, "unverified");
  assert.equal(verifyCompletion({ ...claim, hasSession: false, commit: { hash: "3198c4d", clean: true } }).state, "unverified");
  assert.equal(verifyCompletion({ ...claim, remaining: ["regression test"], commit: { hash: "3198c4d", clean: true } }).state, "unverified");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "committed 3198c4d", tests: "npm test failed" } }, commit: { hash: "3198c4d", clean: true } }).state, "unverified");
  assert.equal(verifyCompletion({ verdictOk: true, changedFiles: 0, hasSession: true }).state, "unverified", "no claim and no observation still fails");
});

test("scoped-none remaining text is not an outstanding obligation", () => {
  const claim = { verdictOk: true, hasSession: true, changedFiles: 0, resultNote: { parts: { done: "committed 3198c4d Add rail accounting test", remaining: "none in scope" } } };
  assert.equal(verifyCompletion(claim).reason, "commit claimed but the runner observed no matching commit", "the prior loop shape no longer trips the outstanding gate");
  const landed = verifyCompletion({ ...claim, commit: { hash: "3198c4dab12cd34ef56", clean: true } });
  assert.equal(landed.state, "verified");
  assert.match(landed.reason, /clean path status/);
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "nothing within this scope." } } }).reason, "no attributable edits and no named checks");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "no remaining work in scope" } } }).reason, "no attributable edits and no named checks");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none of the tests pass" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in the other module" } } }).reason, "outstanding obligations remain");
});

test("honest denials naming a repo/code/implementation scope are not outstanding obligations", () => {
  const claim = { verdictOk: true, hasSession: true, changedFiles: 0, resultNote: { parts: { done: "work landed", remaining: "none in repo scope" } } };
  for (const remaining of [
    "none in repo scope",
    "none in the repository",
    "none in repository scope",
    "none in code scope",
    "none in the code",
    "none within the implementation",
    "nothing in this implementation's scope",
    "none in this repository's scope.",
    "None In Repo Scope",
  ]) {
    assert.notEqual(
      verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining } } }).reason,
      "outstanding obligations remain",
      remaining,
    );
  }
  // The relaxation stays scoped: an unrelated qualifier still owes work, and
  // a denial with a trailing clause is not swallowed by a bare scope word.
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in the other module" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in the repo's other module" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in the implementation backlog" } } }).reason, "outstanding obligations remain");
});

test("owner-side remaining notes are handoffs, not outstanding obligations", () => {
  const claim = { verdictOk: true, hasSession: true, changedFiles: 0, resultNote: { parts: { done: "work landed", remaining: "none in repo scope" } } };
  for (const remaining of [
    "none in repo scope (handed off to the owner)",
    "none in repo scope (owner-only: the stale acceptance lives in Studio's task store)",
    "none in repo scope (owner only: flip the landing cards)",
    "none in repo scope (owner-side board hygiene: flip the two cards)",
    "none (owner's responsibility: reword the delegated acceptance)",
    "none for this card (owner-only wording left to the board owner)",
    "none in repo scope (owner/bookkeeping: the stored acceptance lives in Studio's task store)",
    "none in repo scope (owner / bookkeeping: the stale acceptance is the owner's to flip)",
    "none in repo scope (owner's bookkeeping: the stored acceptance lives in Studio's task store)",
    "none for this card (owner's bookkeeping left to the board owner)",
  ]) {
    assert.notEqual(
      verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining } } }).reason,
      "outstanding obligations remain",
      remaining,
    );
  }
  // The owner marker only discharges a denial of this scope: a genuine
  // obligation phrased without a denial, and a leftover handed to the owner
  // but named against another module, both stay outstanding. A bare
  // "bookkeeping" does not name a lane, so it stays outstanding too, and an
  // explicit rejection of the lane is not an acceptance of it.
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "the owner still has to migrate the store" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in the other module (owner-only)" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in repo scope (bookkeeping in the other module)" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in repo scope (owner rejected the bookkeeping lane)" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ ...claim, resultNote: { parts: { done: "work landed", remaining: "none in repo scope (bookkeeping: owner)" } } }).reason, "outstanding obligations remain");
});

test("done+verified retries with 0 changed files discharge on a green scoped-check rerun", () => {
  // The documented collision-delegate loop shapes: verification-only
  // attempts whose scoped checks re-ran green over already-landed work, with
  // scoped-denial remaining prose the reader must not read as an obligation.
  for (const remaining of ["none within this subtask's scope", "none in scope (parent handles final integration)", "none for this card"]) {
    const verdict = verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, observedChecks: [check()], resultNote: { parts: { done: "re-verified the merged state", remaining } } });
    assert.equal(verdict.state, "verified", remaining);
    assert.match(verdict.reason, /recorded check\(s\) passed/);
  }
  // The literal done+verified retry: the card verified once (priorVerified),
  // the retry re-ran its scoped checks green, changed nothing, and only the
  // remaining prose is unfamiliar — the rerun is the changed-file evidence.
  const retried = verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, priorVerified: true, observedChecks: [check()], resultNote: { parts: { done: "scoped checks re-ran green", remaining: "the odd handoff phrasing the denial reader cannot know" } } });
  assert.equal(retried.state, "verified");
  assert.match(retried.reason, /discharges the done\+verified retry/);
  assert.equal(retried.evidence.rerunDischarges, true);
  assert.equal(retried.evidence.priorVerified, true);
  // The discharge is not blanket: without the prior verified card the same
  // retry stays an obligation, a red rerun never discharges, a handed-on
  // remaining list still gates, and a rerun with no recorded execution
  // proves nothing.
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, observedChecks: [check()], resultNote: { parts: { done: "scoped checks re-ran green", remaining: "the odd handoff phrasing the denial reader cannot know" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, priorVerified: true, observedChecks: [check("npm test", { exitCode: 1, passed: false })], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "recorded checks failed in the attempt's session");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, priorVerified: true, observedChecks: [check()], remaining: ["a follow-up"], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 0, priorVerified: true, resultNote: { parts: { done: "no rerun recorded", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain");
  // The named alternative evidence: a TESTRUNS row is the retry's own
  // documentation of the rerun, so ledger-only edits discharge like 0 files.
  // A code file changed, a ledger claim that does not cover every file, and
  // an ordinary (never-verified) card with only a ledger row all stay
  // outstanding.
  const ledgerRetried = verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, ledgerChanges: 1, priorVerified: true, observedChecks: [check()], resultNote: { parts: { done: "TESTRUNS row documents the green rerun", remaining: "the odd handoff phrasing the denial reader cannot know" } } });
  assert.equal(ledgerRetried.state, "verified");
  assert.match(ledgerRetried.reason, /only the ledger row changed/);
  assert.equal(ledgerRetried.evidence.rerunDischarges, true);
  assert.equal(ledgerRetried.evidence.ledgerChanges, 1);
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, ledgerChanges: 0, priorVerified: true, observedChecks: [check()], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 2, ledgerChanges: 1, priorVerified: true, observedChecks: [check()], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, ledgerChanges: 1, observedChecks: [check()], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 1, ledgerChanges: 5, priorVerified: true, observedChecks: [check()], resultNote: { parts: { done: "x", remaining: "odd phrasing" } } }).reason, "outstanding obligations remain", "a claim larger than the file count never over-discharges");
});

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

// The overseer's own queued run is judged with the worker's recorded checks
// (latest wins across both), but the reason says who actually ran the check.
test("the verdict reason names who ran the counted check", () => {
  const overseer = verifyCompletion({ verdictOk: true, hasSession: true, overseerChecks: [check("npm run check")] });
  assert.equal(overseer.state, "verified");
  assert.equal(overseer.reason, "1 recorded check(s) passed in the overseer's verification run");
  assert.deepEqual(overseer.evidence.observedChecks, { total: 1, passed: 1, failed: 0, pending: 0 }, "the merged summary keeps its shape");
  assert.deepEqual(overseer.evidence.overseerChecks, { total: 1, passed: 1, failed: 0, pending: 0 });
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check()] }).reason, "1 recorded check(s) passed in the attempt's session");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check()], overseerChecks: [check("npm run check")] }).reason, "2 recorded check(s) passed in the attempt's session and the overseer's run");
  const superseded = verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check("npm test", { exitCode: 1, passed: false })], overseerChecks: [check("npm test", { startedAt: 3000 })] });
  assert.equal(superseded.state, "verified", "the overseer's later run of the same command wins");
  assert.equal(superseded.reason, "1 recorded check(s) passed in the overseer's verification run");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 2, overseerChecks: [check("npm run check", { exitCode: 1, passed: false })] }).reason, "recorded checks failed in the overseer's verification run");
  assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check("npm test", { exitCode: 1, passed: false })], overseerChecks: [check("npm run check", { exitCode: 1, passed: false })] }).reason, "recorded checks failed in the attempt's session and the overseer's verification run");
  // A session failure the overseer's later green run of the same command
  // superseded is not blamed: the only live failure is the overseer's own.
  const blamed = verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check("npm run check", { exitCode: 1, passed: false, startedAt: 5 })], overseerChecks: [check("npm run check", { startedAt: 3000 }), check("node --test tests/x.test.mjs", { startedAt: 3000, exitCode: 1, passed: false })] });
  assert.equal(blamed.state, "unverified");
  assert.equal(blamed.reason, "recorded checks failed in the overseer's verification run");
  assert.equal(verifyCompletion({ verdictOk: true, overseerChecks: [check("npm run check")] }).state, "unverified", "an overseer run needs an attributed session, like the worker's own checks");
});

test("missing and truncated command metadata never fabricates a passing check", () => {
  for (const row of [check("npm test", { commandTruncated: true }), check("npm test", { startedAt: 0 }), check("npm test", { passed: null }), check("npm test", { exitCode: "0" })]) {
    assert.equal(verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [row] }).state, "unverified");
  }
});

test("LÖVE harness runner invocations count as check evidence", () => {
  for (const command of [
    '& "C:\\Program Files\\LOVE\\love.exe" test\\runner',
    '"C:\\Program Files\\LOVE\\love.exe" test\\runner',
    "love.exe test\\runner",
    "love.exe \"test folder\"",
  ]) {
    assert.equal(isVerificationCommand(command), true, command);
  }
  assert.equal(isVerificationCommand('& "C:\\Program Files\\LOVE\\love.exe" test\\runner && echo passed'), false, "a chained runner is not a direct check");
  assert.equal(isVerificationCommand("love.exe"), false, "a runner with no target proves nothing");
});

test("LÖVE projects schedule the harness runner as their base check", () => {
  const love = loveHarnessCheckCommand();
  assert.ok(love.includes("love.exe"), love);
  assert.ok(love.includes("result.txt"), love);
  assert.ok(love.includes("PASS*"), love);
  assert.equal(projectBaseCheck({ hasPackageJson: false, hasLoveHarness: true }), love);
  assert.equal(projectBaseCheck({ hasPackageJson: true, hasLoveHarness: true }), "npm run check");
  assert.equal(projectBaseCheck({ hasPackageJson: false, hasLoveHarness: false }), null);
  assert.equal(projectBaseCheck(), "npm run check");
  const task = { id: "t1", title: "lua work", projectPath: "C:/demo" };
  const done = "MEFI_RESULT: done: suite green; remaining: none";
  const job = scheduleVerificationOnDone({
    resultNote: done, task, attemptKey: "run_1_a", queue: [],
    baseCheck: projectBaseCheck({ hasPackageJson: false, hasLoveHarness: true }),
  });
  assert.equal(job.commands[0], love);
  assert.equal(job.commands.length, 1, "a LÖVE task with no focused tests schedules only the harness run");
  assert.equal(job.projectPath, "C:/demo", "the job runs in its own card's project");
  const npmJob = scheduleVerificationOnDone({ resultNote: done, task, attemptKey: "run_2_a", queue: [] });
  assert.equal(npmJob.commands[0], "npm run check", "the default base check stays npm run check");
  assert.equal(scheduleVerificationOnDone({ resultNote: done, task: { id: "t3", title: "pathless" }, attemptKey: "run_4_a", queue: [] }).projectPath, null, "a pathless row leaves the cwd to the runner's active root");
});

test("new projects choose only observed local checks and never invent npm scripts", () => {
  assert.equal(projectBaseCheck({ hasPackageJson: false, nodeTestFile: "tests.js" }), 'node --test "tests.js"');
  assert.equal(projectBaseCheck({ hasPackageJson: true, packageScripts: { test: "node --test" } }), "npm test");
  assert.equal(projectBaseCheck({ hasPackageJson: true, packageScripts: { check: "node scripts/check.js", test: "node --test" } }), "npm run check");
  assert.equal(projectBaseCheck({ hasPackageJson: true, packageScripts: {} }), null);
  assert.equal(projectBaseCheck({ hasPackageJson: false }), null);
  assert.equal(projectBaseCheck({ hasPackageJson: false, nodeTestFile: 'tests.js" && echo success' }), null);
  const task = { id: "new-project", projectPath: "C:/new-project" };
  const resultNote = "MEFI_RESULT: done: built game; remaining: none";
  const unavailable = scheduleVerificationOnDone({ task, resultNote, queue: [], baseCheck: null });
  assert.deepEqual(unavailable.commands, [], "known absent checks never restore the legacy npm default");
  const local = scheduleVerificationOnDone({ task, resultNote, queue: [], baseCheck: projectBaseCheck({ hasPackageJson: false, nodeTestFile: "tests.js" }) });
  assert.deepEqual(local.commands, ['node --test "tests.js"']);
  assert.equal(isVerificationCommand(local.commands[0]), true);
  const blocked = { command: "Project verification", unavailable: true, startedAt: 1000, status: "error", exitCode: null, passed: false };
  const verdict = verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 4, overseerChecks: [blocked] });
  assert.equal(verdict.state, "unverified");
  assert.equal(verdict.evidence.overseerChecks.failed, 1, "missing project checks cannot be silently ignored in favor of edited files");
  assert.equal(summarizeObservedChecks([{ ...blocked, status: "completed", exitCode: 0, passed: true }]).passed, 0);
});

test("the host observes package scripts and root tests in the selected project's folder", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = source.indexOf("function baseCheckForProject(");
  const end = source.indexOf("const VERIFICATION_COMMAND_BUDGET_MS", start);
  const root = path.resolve("fixture-fresh-project");
  const present = new Set([path.join(root, "tests.js")]);
  let packageValue = {};
  const env = vm.createContext({ path, projectRoot: () => root, assistantModule: { projectBaseCheck },
    existsSync: (file) => present.has(file), readFileSync: (file) => { assert.equal(file, path.join(root, "package.json")); return JSON.stringify(packageValue); },
  });
  vm.runInContext(source.slice(start, end), env);
  assert.equal(env.baseCheckForProject(null), 'node --test "tests.js"');
  present.delete(path.join(root, "tests.js"));
  assert.equal(env.baseCheckForProject(root), null);
  present.add(path.join(root, "package.json"));
  assert.equal(env.baseCheckForProject(root), null, "a package without scripts is not a check");
  packageValue = { scripts: { test: "node tests.js" } };
  assert.equal(env.baseCheckForProject(root), "npm test");
});

test("a repo-named check script counts as check evidence when invoked wholesale", () => {
  for (const command of [
    'powershell -NoProfile -ExecutionPolicy Bypass -File "test\\run-check.ps1"',
    'powershell -NoProfile -File test/run-check.ps1',
    'pwsh -NoProfile -ExecutionPolicy RemoteSigned -File "tools/check_build.ps1"',
    "powershell -File verify_tree.ps1",
  ]) {
    assert.equal(isVerificationCommand(command), true, command);
  }
  for (const command of [
    "powershell -File evil.ps1", // basename is not check-shaped
    "powershell -File tools/report.ps1", // neither is this one
    'powershell -NoProfile -File test/run-check.ps1 | Out-Null', // piped tail
    'powershell -Command "npm test" -File test/run-check.ps1', // -Command is not a safe host flag
    "powershell", // no script at all
  ]) {
    assert.equal(isVerificationCommand(command), false, command);
  }
});

test("LÖVE projects prefer the tracked repo check over the derived harness command", () => {
  const wrapper = repoCheckCommand({});
  assert.ok(wrapper.includes("run-check.ps1"), wrapper);
  assert.ok(wrapper.startsWith("powershell"), wrapper);
  assert.equal(repoCheckCommand({ file: null }), wrapper, "a null file falls back to the standard wrapper");
  assert.equal(projectBaseCheck({ hasPackageJson: false, hasRepoCheck: true }), wrapper);
  assert.equal(projectBaseCheck({ hasPackageJson: false, hasRepoCheck: true, repoCheckFile: "test\\run-check.ps1" }), repoCheckCommand({ file: "test\\run-check.ps1" }));
  assert.equal(projectBaseCheck({ hasPackageJson: true, hasRepoCheck: true }), "npm run check", "pkg wins over wrapper");
  assert.equal(projectBaseCheck({ hasPackageJson: false, hasRepoCheck: false, hasLoveHarness: true }), loveHarnessCheckCommand(), "no wrapper falls back to the harness");
  const task = { id: "t2", title: "lua work", projectPath: "C:/demo" };
  const done = "MEFI_RESULT: done: suite green; remaining: none";
  const job = scheduleVerificationOnDone({
    resultNote: done, task, attemptKey: "run_3_a", queue: [],
    baseCheck: projectBaseCheck({ hasPackageJson: false, hasRepoCheck: true }),
  });
  assert.equal(job.commands[0], wrapper);
  assert.equal(isVerificationCommand(job.commands[0]), true, "the scheduled wrapper run is recorded check evidence");
});

test("main.cjs delegates the base-check decision to projectBaseCheck and judges pathless rows against projectRoot", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = main.indexOf("function baseCheckForProject(");
  assert.ok(start > 0, "main.cjs defines baseCheckForProject");
  // main.cjs is CRLF on disk; find the function's closing brace either way.
  const end = main.slice(start).search(/\r?\n\}\r?\n/);
  assert.ok(end > 0, "baseCheckForProject has a closing brace");
  const body = main.slice(start, start + end);
  assert.match(body, /assistantModule\?\.projectBaseCheck/, "the shipped chooser is the tested pure function, not a second copy of its rules");
  assert.doesNotMatch(body, /return "npm run check"/, "main.cjs never hardcodes the npm default beside the pure chooser");
  assert.match(body, /\|\| projectRoot\(\)/, "a row without a project path is judged against the same root the runner uses as cwd");
  for (const flag of ["hasPackageJson", "hasRepoCheck", "hasLoveHarness"]) assert.match(body, new RegExp(`shape\\.${flag} = existsSync\\(`), `${flag} is observed on disk`);
});

// The LÖVE harness is the overseer's own command: it pipes love.exe and reads
// result.txt, a shape the filter for a worker's shell history rejects. Its
// result was dropped, so a failing suite never blocked and a passing one
// never counted.
test("the overseer's own harness run counts, and only the overseer's run can carry that trust", () => {
  const harness = loveHarnessCheckCommand();
  assert.equal(isVerificationCommand(harness), false, "a worker typing the same line still proves nothing");
  const failed = verifyCompletion({ verdictOk: true, hasSession: true, changedFiles: 2, overseerChecks: [check(harness, { exitCode: 1, passed: false })] });
  assert.equal(failed.state, "unverified");
  assert.equal(failed.reason, "recorded checks failed in the overseer's verification run");
  const passed = verifyCompletion({ verdictOk: true, hasSession: true, overseerChecks: [check(harness)] });
  assert.equal(passed.state, "verified");
  assert.equal(passed.reason, "1 recorded check(s) passed in the overseer's verification run");
  const smuggled = verifyCompletion({ verdictOk: true, hasSession: true, observedChecks: [check(harness, { runnerIssued: true })] });
  assert.equal(smuggled.state, "unverified", "a session row cannot mark itself runner-issued");
  assert.equal(summarizeObservedChecks([check(harness)]).total, 0);
});

// A parent that handed its leftovers on: once every hand-off settles, its
// remaining prose names delegated work. A worker's summary rarely repeats a
// follow-up's exact title, so title equality alone left such a parent failing
// on work its follow-ups had already finished.
test("settled hand-offs discharge the remaining prose they describe, and nothing more", () => {
  const base = { verdictOk: true, hasSession: true, changedFiles: 3, observedChecks: [check()] };
  const two = ["Renderer toggle for the memory warn override", "Full `npm test` + `npm run audit` sweep"];
  const note = (remaining) => ({ parts: { done: "adopted the memory-admission rework", remaining } });
  assert.equal(verifyCompletion({ ...base, handedOff: 2, resolvedHandoffs: two, remaining: [], resultNote: note("renderer override toggle, full-suite sweep") }).state, "verified");
  assert.equal(verifyCompletion({ ...base, handedOff: 1, resolvedHandoffs: two.slice(0, 1), remaining: [], resultNote: note("the one npm test once the tree is committed and quiet.") }).state, "verified");
  const reason = (args) => verifyCompletion({ ...base, ...args }).reason;
  assert.equal(reason({ resolvedHandoffs: two, remaining: [], resultNote: note("renderer override toggle, full-suite sweep") }), "outstanding obligations remain", "without recorded hand-offs the prose still binds");
  assert.equal(reason({ handedOff: 2, resolvedHandoffs: two.slice(0, 1), remaining: [two[1]], resultNote: note("toggle, sweep") }), "outstanding obligations remain", "an unsettled hand-off still binds");
  assert.equal(reason({ handedOff: 2, resolvedHandoffs: two.slice(0, 1), remaining: [], resultNote: note("toggle, sweep") }), "outstanding obligations remain", "every hand-off must have settled");
  assert.equal(reason({ handedOff: 1, resolvedHandoffs: two.slice(0, 1), remaining: [], resultNote: note("literal first-tick capture + restart decision") }), "outstanding obligations remain", "prose naming more items than were handed on");
  assert.equal(reason({ handedOff: 1, resolvedHandoffs: two.slice(0, 1), remaining: [], resultNote: note("owner-only store row relocation") }), "outstanding obligations remain", "owner-only work is never a hand-off");
});
