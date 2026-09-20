import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assistant = await import("../scripts/assistant.mjs");
const { claimWork, shouldHoldWork, finishedClaims } = assistant;

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");

// A finished session whose edits are still dirty vs HEAD (the uncommitted
// row shape scripts/eyes.mjs uncommittedOnly() produces).
const finishedSession = { id: "ses_owner", title: "Resolve main.cjs collision", finished: true };
const activeSession = { id: "ses_live", title: "Live editor", finished: false };
const dirtyRow = (file, sessions) => ({ file, path: file, untracked: false, sessions, titles: [], warning: "HEAD does not have this work" });

test("a task whose file scope matches a finished session's uncommitted edits is held for verification", () => {
  const decision = claimWork({
    work: { title: "Dedupe dispatch", files: ["main.cjs"] },
    sessions: [finishedSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [],
  });
  assert.equal(decision.action, "defer");
  assert.equal(decision.reason, "finished-uncommitted");
  assert.deepEqual(decision.held, ["main.cjs"]);
  assert.deepEqual(decision.owners, ["ses_owner"]);
  assert.match(decision.advice, /ses_owner/);
  assert.match(decision.advice, /uncommitted/);
  assert.match(decision.advice, /verification/);
  // The dispatcher must skip this pick and the log must name the hold.
  assert.equal(shouldHoldWork(decision, { source: "task" }), true);
});

test("path spelling and scope differences still collide (normalized file match)", () => {
  const decision = claimWork({
    work: { title: "Windows spelling", files: ["MAIN.CJS"] },
    sessions: [finishedSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [],
  });
  assert.equal(decision.reason, "finished-uncommitted");
});

test("the same edits from an active session do not trigger the finished hold", () => {
  const decision = claimWork({
    work: { title: "Dedupe dispatch", files: ["main.cjs"] },
    sessions: [activeSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_live"])],
    jobs: [],
  });
  assert.notEqual(decision.reason, "finished-uncommitted");
});

test("committed work (no uncommitted row) releases the hold", () => {
  const decision = claimWork({
    work: { title: "Dedupe dispatch", files: ["main.cjs"] },
    sessions: [finishedSession],
    uncommitted: [],
    jobs: [],
  });
  assert.notEqual(decision.reason, "finished-uncommitted");
});

test("a cleared session releases the hold even while the file is still dirty", () => {
  const decision = claimWork({
    work: { title: "Dedupe dispatch", files: ["main.cjs"] },
    sessions: [],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [],
  });
  assert.notEqual(decision.reason, "finished-uncommitted");
});

test("non-overlapping scope is never held (no false positive)", () => {
  const decision = claimWork({
    work: { title: "Other file", files: ["renderer/styles.css"] },
    sessions: [finishedSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [],
  });
  assert.notEqual(decision.reason, "finished-uncommitted");
});

test("collision-resolution jobs still run through a finished-uncommitted hold", () => {
  const decision = claimWork({
    work: { title: "Resolve collision", source: "collision", files: ["main.cjs"] },
    sessions: [finishedSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [],
  });
  assert.equal(decision.reason, "finished-uncommitted");
  assert.equal(shouldHoldWork(decision, { source: "collision" }), false, "the assigned cleanup crew must not be parked");
});

test("a sibling in-flight job's claim still wins over the finished hold", () => {
  const decision = claimWork({
    work: { title: "Second pick", files: ["main.cjs"] },
    sessions: [finishedSession],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"])],
    jobs: [{ id: "j1", files: ["main.cjs"] }],
  });
  assert.equal(decision.reason, "claimed");
});

test("finishedClaims stays silent without a file scope", () => {
  assert.deepEqual(finishedClaims({ work: { title: "no files" }, sessions: [finishedSession], uncommitted: [dirtyRow("main.cjs", ["ses_owner"])] }), []);
});

// The task record exactly as a failed verification leaves it (main.cjs reopen:
// status "open", verification.state "unverified", verifyAttempts counted, the
// failed attempt's session on lastAttempt).
const retryTask = (over = {}) => ({
  id: "task_retry",
  title: "Fix the held work",
  status: "open",
  verification: { state: "unverified", at: 1, reason: "recorded checks failed in the attempt's session" },
  verifyAttempts: 1,
  lastAttempt: { sessionId: "ses_owner", code: 0, sawDone: true },
  ...over,
});
const decide = (work, over = {}) =>
  claimWork({ work, sessions: [finishedSession], uncommitted: [dirtyRow("main.cjs", ["ses_owner"])], jobs: [], ...over });

test("the task's own failed-verification fix run is exempt from its own attempt's hold", () => {
  const decision = decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask() });
  assert.equal(decision.action, "proceed");
  assert.notEqual(decision.reason, "finished-uncommitted");
  assert.deepEqual(decision.fixRetry?.owners, ["ses_owner"]);
  assert.deepEqual(decision.fixRetry?.files, ["main.cjs"]);
  assert.equal(shouldHoldWork(decision, { source: "task" }), false, "the exempt pick is not held");
});

test("the exemption is evidence-keyed, not title-keyed", () => {
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask({ lastAttempt: { sessionId: "ses_other" } }) }), { source: "task" }), true, "another session's edits still hold");
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask({ verification: { state: "verified" } }) }), { source: "task" }), true, "a verified verdict keeps commit-first");
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask({ verification: { state: "failed" } }) }), { source: "task" }), true, "a parked task (budget gone) still holds");
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask({ verifyAttempts: 0 }) }), { source: "task" }), true, "a task verification never judged still holds");
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: retryTask({ lastAttempt: {} }) }), { source: "task" }), true, "no attempt session on record still holds");
  assert.equal(shouldHoldWork(decide({ title: "Fix the held work", files: ["main.cjs"], ref: null }), { source: "task" }), true, "work without a task ref still holds");
});

test("one foreign holder alongside the own attempt still holds the shared file", () => {
  const decision = claimWork({
    work: { title: "Fix", files: ["main.cjs", "side.cjs"], ref: retryTask() },
    sessions: [finishedSession, { id: "ses_peer", title: "Peer work", finished: true }],
    uncommitted: [dirtyRow("main.cjs", ["ses_owner"]), dirtyRow("side.cjs", ["ses_owner", "ses_peer"])],
    jobs: [],
  });
  assert.equal(decision.reason, "finished-uncommitted");
  assert.deepEqual(decision.held, ["side.cjs"], "only the foreign-held file defers; the own-attempt file is dropped from the hold");
});

test("the exemption does not bypass an in-flight sibling claim", () => {
  const decision = decide({ title: "Fix", files: ["main.cjs"], ref: retryTask() }, { jobs: [{ id: "j1", files: ["main.cjs"] }] });
  assert.equal(decision.reason, "claimed");
});

test("main.cjs dispatch consults the hold and logs it with the owning session", () => {
  assert.match(main, /decision\?\.reason === "claimed"/, "the dispatcher defers picks whose files a sibling job holds");
  assert.match(main, /shouldHoldWork\(decision, next\)/, "the dispatcher consults shouldHoldWork");
  assert.match(main, /finished-uncommitted/, "the dispatcher knows the finished-uncommitted hold");
  assert.match(main, /held for verification: finished session/, "the skip log names the hold and the owning session");
  assert.match(main, /claim\?\.fixRetry/, "the dispatcher notices a fix-retry pick");
  assert.match(main, /fix retry "/, "the fix-retry pass is logged so retry chains stay visible");
});
