import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { commitEvidence } from "../scripts/eyes.mjs";
import { verifyCompletion } from "../scripts/assistant.mjs";
import { buildReceipt, evidenceKind, receiptTrust } from "../scripts/receipts.mjs";

const execFileP = promisify(execFile);

test("commitEvidence observes a real commit and the clean path status", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "commit-evidence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (file, args) => execFileP("git", ["-C", path.join(dir, file), ...args]);
  const init = async (file) => {
    await mkdir(path.join(dir, file), { recursive: true });
    await git(file, ["init", "-q"]);
    await git(file, ["-c", "user.email=studio@example.com", "-c", "user.name=Studio Test", "commit", "--allow-empty", "-q", "-m", "seed"]);
    await git(file, ["config", "user.email", "studio@example.com"]);
    await git(file, ["config", "user.name", "Studio Test"]);
  };
  await init("repo");

  const hash = (await git("repo", ["rev-parse", "HEAD"])).stdout.trim();
  const short = hash.slice(0, 10);

  const observed = commitEvidence({ root: path.join(dir, "repo"), hash: short });
  assert.equal(observed.hash, hash, "an abbreviated claim resolves to the full commit");
  assert.equal(observed.clean, true, "an untouched repo path is clean");
  assert.equal(observed.error ?? null, null);

  await mkdir(path.join(dir, "repo", "src"), { recursive: true });
  await writeFile(path.join(dir, "repo", "src", "rail.js"), "export const accounting = 1;\n");
  const untrackedScope = commitEvidence({ root: path.join(dir, "repo"), hash, paths: ["src/rail.js"] });
  assert.equal(untrackedScope.clean, false, "the task's scoped path is dirty before the commit");

  await git("repo", ["add", "src/rail.js"]);
  await git("repo", ["commit", "-q", "-m", "rail accounting test"]);
  const landed = commitEvidence({ root: path.join(dir, "repo"), hash: short, paths: ["src/rail.js"] });
  assert.equal(landed.hash, hash);
  assert.equal(landed.clean, true, "the scoped path is clean after the commit");

  await writeFile(path.join(dir, "repo", "src", "rail.js"), "export const accounting = 2;\n");
  await writeFile(path.join(dir, "repo", "unrelated.txt"), "other session's work\n");
  const scoped = commitEvidence({ root: path.join(dir, "repo"), hash: short, paths: ["src/rail.js"] });
  assert.equal(scoped.clean, false, "a modified scoped file is not clean");
  const whole = commitEvidence({ root: path.join(dir, "repo"), hash: short });
  assert.equal(whole.clean, false, "an unscoped check sees the whole tree");

  assert.equal(commitEvidence({ root: path.join(dir, "repo"), hash: "beefbeef" }).hash, null, "a hash that resolves to nothing is no evidence");
  assert.equal(commitEvidence({ root: path.join(dir, "repo"), hash: "not-a-hash" }).hash, null);
  assert.equal(commitEvidence({ root: null, hash: short }).hash, null);
  const failedStatus = commitEvidence({ root: path.join(dir, "repo"), hash: short, run: (command, args) => (args.includes("status") ? { status: 128, stdout: "" } : { status: 0, stdout: `${hash}\n` }) });
  assert.equal(failedStatus.clean, null, "a failed status read is unknown, never clean");
});

test("the evaluator accepts a runner-observed commit and receipts trust it", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "commit-evidence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const git = (args) => execFileP("git", ["-C", dir, ...args]);
  await git(["init", "-q"]);
  await git(["-c", "user.email=studio@example.com", "-c", "user.name=Studio Test", "commit", "--allow-empty", "-q", "-m", "Commit the rail accounting test"]);
  const hash = (await git(["rev-parse", "HEAD"])).stdout.trim();

  const claim = { verdictOk: true, hasSession: true, changedFiles: 0, resultNote: { parts: { done: `committed ${hash.slice(0, 9)} rail accounting test`, remaining: "none" } } };
  assert.equal(verifyCompletion(claim).state, "unverified", "the claim alone still fails");
  const verdict = verifyCompletion({ ...claim, commit: commitEvidence({ root: dir, hash: hash.slice(0, 9) }) });
  assert.equal(verdict.state, "verified");
  assert.equal(verdict.evidence.commit.hash, hash);

  const kind = evidenceKind({ state: verdict.state, changedFiles: 0, hasSession: true, namedChecks: false, observedChecks: verdict.evidence.observedChecks, commit: verdict.evidence.commit });
  assert.equal(kind, "runner-observed-commit");
  const receipt = buildReceipt({
    attemptId: "run_commit_1",
    workItem: { title: "Commit the rail accounting test", prompt: "commit the staged work" },
    attempt: { sessionId: "ses_commit" },
    verdict,
    changedFiles: 0,
    remaining: [],
    evaluator: { name: "verifyCompletion", version: "3", sourceSha256: "abc" },
    now: 5,
  });
  assert.equal(receipt.trust, "trusted", "a runner-observed commit is a positive learning label");
  assert.equal(receipt.evidence.kind, "runner-observed-commit");
  assert.equal(receipt.evidence.commit.hash, hash);

  await writeFile(path.join(dir, "leftover.txt"), "partial commit\n");
  const dirty = verifyCompletion({ ...claim, commit: commitEvidence({ root: dir, hash: hash.slice(0, 9) }) });
  assert.equal(dirty.state, "unverified");
  assert.match(dirty.reason, /uncommitted changes/);
  const dirtyReceipt = buildReceipt({
    attemptId: "run_commit_2",
    workItem: { title: "Commit the rail accounting test", prompt: "commit the staged work" },
    attempt: { sessionId: "ses_commit" },
    verdict: dirty,
    changedFiles: 0,
    remaining: [],
    evaluator: { name: "verifyCompletion", version: "3", sourceSha256: "abc" },
    now: 6,
  });
  assert.equal(dirtyReceipt.trust, null);
});
