// The Policy Lab's evidence layer (build brief PR0/PR1): append-only event
// storage, runner-produced receipts and their trust labels, episode trees
// with handoff/retry lineage, paraphrase-safe evaluation splits, and read-only
// dataset export. Unknown cost stays unknown, never zero.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendEvent,
  buildEpisodes,
  exportDataset,
  readEvents,
  splitEpisodes,
  spendBudget,
  readBudget,
  validateEvent,
} from "../scripts/experience.mjs";
import { acceptanceSpec, appendReceipt, buildReceipt, readReceipts, receiptLabel, receiptTrust, receiptsByAttempt } from "../scripts/receipts.mjs";
import { intentKeyOf } from "../scripts/policy.mjs";

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "policy-lab-test-"));

// ---- receipts: the acceptance contract decides, the runner's eyes count -----

const evaluator = { name: "verifyCompletion", version: "3", sourceSha256: "abc123" };
const work = { kind: "task", id: "task_1", title: "Fix the tar torch descriptions", prompt: "the full prompt text" };

test("a runner-observed edit with a clean verdict is a trusted positive label", () => {
  const receipt = buildReceipt({
    attemptId: "run_1",
    workItem: work,
    attempt: { sessionId: "ses_1", sawDone: true, code: 0 },
    verdict: { state: "verified", reason: "3 changed file(s)", evidence: { verdictOk: true, changedFiles: 3, hasSession: true, namedChecks: false, outstanding: false } },
    changedFiles: 3,
    remaining: [],
    evaluator,
    now: 1000,
  });
  assert.equal(receiptTrust(receipt), "trusted");
  assert.equal(receiptLabel(receipt), "verified");
  assert.equal(receipt.evidence.kind, "runner-observed-edits");
});

test("historical worker-named check receipts are never a learning positive", () => {
  const receipt = buildReceipt({
    attemptId: "run_2",
    workItem: work,
    attempt: { sessionId: "ses_2", sawDone: true, code: 0 },
    verdict: { state: "verified", reason: "no edits, but the attempt named the checks it ran", evidence: { verdictOk: true, changedFiles: 0, hasSession: true, namedChecks: true, outstanding: false } },
    changedFiles: 0,
    remaining: [],
    evaluator,
    now: 1000,
  });
  assert.equal(receipt.evidence.kind, "worker-named-checks");
  assert.equal(receiptTrust(receipt), "self-reported");
  assert.equal(receiptLabel(receipt), "reported");
});

test("recorded passing checks produce a trusted test-only receipt without leaking command output", () => {
  const receipt = buildReceipt({ attemptId: "recorded-run", workItem: work, contract: "test-only", attempt: { sessionId: "recorded-session" },
    verdict: { state: "verified", evidence: { observedChecks: { total: 1, passed: 1, failed: 0, pending: 0, command: "private command", outputExcerpt: "private output" } } }, now: 1 });
  assert.equal(receipt.evidence.kind, "runner-observed-checks");
  assert.equal(receiptTrust(receipt), "trusted");
  assert.equal(receiptLabel(receipt), "verified");
  assert.deepEqual(receipt.evidence.checks, { passed: 1, failed: 0, pending: 0 });
  assert.equal(JSON.stringify(receipt).includes("private"), false);
  for (const checks of [{ passed: 1, failed: 1, pending: 0 }, { passed: 1, failed: 0, pending: 1 }, { passed: 0, failed: 0, pending: 0 }]) {
    assert.equal(receiptTrust({ ...receipt, evidence: { ...receipt.evidence, checks } }), null);
  }
  assert.equal(receiptTrust({ ...receipt, evidence: { ...receipt.evidence, outstandingObligations: 1 } }), null);
});

test("partial work, failed checks, missing sessions and failed verdicts are not positives", () => {
  const mk = (verdict, changedFiles, remaining) =>
    buildReceipt({ attemptId: "run_x", workItem: work, attempt: { sessionId: "ses_x" }, verdict, changedFiles, remaining, evaluator, now: 1 });
  const partial = mk({ state: "unverified", reason: "outstanding obligations remain", evidence: { verdictOk: true, changedFiles: 2, hasSession: true, namedChecks: false, outstanding: true } }, 2, ["a regression test"]);
  assert.equal(receiptLabel(partial), "unverified");
  assert.equal(partial.acceptance.remaining.length, 1);
  const failed = mk({ state: "failed", reason: "the attempt reported failing checks", evidence: { verdictOk: false, changedFiles: 0, hasSession: true, namedChecks: false, outstanding: false } }, 0, []);
  assert.equal(receiptLabel(failed), "failed");
  // a sessionless run with nothing observable has evidence kind "none"
  const blind = buildReceipt({
    attemptId: "run_y",
    workItem: work,
    attempt: { sessionId: null },
    verdict: { state: "verified", reason: "no session, but the attempt named the checks it ran", evidence: { verdictOk: true, changedFiles: 0, hasSession: false, namedChecks: true, outstanding: false } },
    changedFiles: 0,
    remaining: [],
    evaluator,
    now: 1,
  });
  assert.equal(blind.evidence.kind, "worker-named-checks");
  assert.equal(receiptTrust(blind), "self-reported");
  // no attempt id, no receipt — missing evidence is missing, not positive
  assert.equal(buildReceipt({ attemptId: null, verdict: { state: "verified" }, workItem: work }), null);
  assert.equal(receiptLabel(null), null);
});

test("acceptance specs hash the prompt instead of storing it; unknown cost stays null", () => {
  const spec = acceptanceSpec({ title: "T", prompt: "secret chat text", remaining: ["one"] });
  assert.equal(spec.promptSha256.length, 64);
  assert.ok(!JSON.stringify(spec).includes("secret chat text"));
  const receipt = buildReceipt({
    attemptId: "run_3",
    workItem: work,
    attempt: { sessionId: "ses_3" },
    verdict: { state: "verified", reason: "1 changed file(s)", evidence: { verdictOk: true, changedFiles: 1, hasSession: true, namedChecks: false, outstanding: false } },
    changedFiles: 1,
    evaluator,
    now: 5,
  });
  assert.equal(receipt.cost.modelCalls, null);
  assert.equal(receipt.cost.providerCost, null);
  assert.equal(receipt.evaluator.sourceSha256, "abc123");
});

// ---- the append-only stores ------------------------------------------------------

test("events round-trip; invalid events are refused; a torn tail is skipped", async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, "experience.jsonl");
    const good = { schema: 1, at: 1, seq: 1, kind: "verification", attemptId: "run_1", receiptId: "rcp_1", state: "verified" };
    await appendEvent(file, good);
    await assert.rejects(
      appendEvent(file, { schema: 1, at: 2, kind: "decision" }),
      /rejected/,
      "a decision without a policy identity and observation is refused"
    );
    await assert.rejects(appendEvent(file, { schema: 1, at: 3, kind: "attempt-finish", attemptId: "r", intentKey: "k", outcome: "vibes" }), /outcome/);
    const events = await readEvents(file);
    assert.equal(events.length, 1);
    // simulate a crash mid-append: a torn last line must not break reads
    writeFileSync(file, `${"x".repeat(10)}`, { flag: "a" });
    assert.equal((await readEvents(file)).length, 1);
    // receipts: same guarantees
    const rfile = path.join(dir, "receipts.jsonl");
    const receipt = buildReceipt({
      attemptId: "run_1",
      workItem: work,
      attempt: { sessionId: "s" },
      verdict: { state: "verified", reason: "ok", evidence: { verdictOk: true, changedFiles: 1, hasSession: true, namedChecks: false, outstanding: false } },
      changedFiles: 1,
      evaluator,
      now: 1,
    });
    await appendReceipt(rfile, receipt);
    const receipts = await readReceipts(rfile);
    assert.equal(receipts.length, 1);
    assert.equal(receiptsByAttempt(receipts).get("run_1").id, receipt.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- jev-proposal events: validated, and invisible to episodes --------------------

test("a jev-proposal event validates, a malformed one is refused, and episodes ignore proposals", async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, "experience.jsonl");
    const proposal = {
      schema: 1,
      at: 500,
      seq: 9,
      kind: "jev-proposal",
      proposalId: "jev_1_0",
      observation: { title: "Restore tar torch catalog descriptions", source: "chat" },
      candidate: { kind: "task", title: "Restore tar torch and stick catalog descriptions" },
      question: "observation_relationship",
      answer: "same_obligation",
      proposedAction: "attach-observation",
      retrieval: { overlapTokens: 4 },
      model: "typesafe-ai/jev",
      elapsedMs: 675,
    };
    await appendEvent(file, proposal);
    await assert.rejects(
      appendEvent(file, { ...proposal, seq: 10, answer: 42 }),
      /answer and proposedAction must be strings/,
      "a numeric answer is refused"
    );
    await assert.rejects(appendEvent(file, { ...proposal, seq: 11, proposedAction: undefined }), /rejected/);
    // episode construction ignores proposal events entirely: the attempt tree
    // built from a log with proposals is identical to one without
    const attempt = {
      schema: 1,
      at: 1000,
      seq: 20,
      kind: "attempt-start",
      attemptId: "run_9",
      decisionId: "dec_9",
      intentKey: "some goal",
      workItem: { kind: "task", id: "t9", title: "Some goal" },
      depth: 0,
    };
    const withAttempt = path.join(dir, "with-attempt.jsonl");
    for (const event of [proposal, attempt]) await appendEvent(withAttempt, event);
    const withProposal = buildEpisodes(await readEvents(withAttempt), { receipts: [] });
    const withoutProposal = buildEpisodes([attempt], { receipts: [] });
    assert.deepEqual(withProposal.map((episode) => episode.attemptIds), withoutProposal.map((episode) => episode.attemptIds));
    assert.equal(withProposal.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- episodes: lineage, paraphrase identity, descendant cost ---------------------

function fixtureEvents() {
  const intent = "restore tar torch catalog descriptions";
  const events = [];
  const push = (event) => events.push({ schema: 1, seq: events.length + 1, ...event });
  const start = (id, at, intentKey, title, extra = {}) =>
    push({ kind: "attempt-start", at, attemptId: id, intentKey, actionId: id, workItem: { kind: "task", id: `t_${id}`, title }, ...extra });
  const finish = (id, at, intentKey, durationMs, outcome = "failed") =>
    push({
      kind: "attempt-finish",
      at,
      attemptId: id,
      intentKey,
      outcome,
      exitCode: outcome === "failed" ? 1 : 0,
      sawDone: outcome !== "failed",
      spoke: true,
      sessionId: `s_${id}`,
      durationMs,
      handoffs: [],
      result: null,
      cost: { durationMs, modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
    });
  // episode 1: fail -> retry (same intent) -> paraphrase title retry; plus one
  // handed-off child with a DIFFERENT intent, linked by fromRun
  start("run_a1", 1000, intent, "Restore tar torch catalog descriptions");
  finish("run_a1", 1000 + 100, intent, 100);
  start("run_a2", 2000, intent, "Restore tar torch catalog descriptions");
  finish("run_a2", 2000 + 200, intent, 200, "reported-done");
  // the paraphrase shares the compact key, so it joins the SAME episode
  start("run_a3", 3000, intent, "RESTORE tar-torch catalog descriptions!");
  finish("run_a3", 3000 + 300, intent, 300);
  start("run_c1", 4000, "document the follow-up", "Document the follow-up", { parentAttemptId: "run_a3" });
  finish("run_c1", 4000 + 400, "document the follow-up", 400, "reported-done");
  // episode 2: unrelated, later
  start("run_b1", 5000, "a different goal", "A different goal");
  finish("run_b1", 5000 + 500, "a different goal", 500);
  return events;
}

test("retries, paraphrases and handoff children join one episode with tree edges", () => {
  const episodes = buildEpisodes(fixtureEvents(), { receipts: [] });
  assert.equal(episodes.length, 2);
  const main = episodes.find((episode) => episode.rootIntentKey === "restore tar torch catalog descriptions");
  assert.deepEqual(main.attemptIds, ["run_a1", "run_a2", "run_a3", "run_c1"]);
  const byId = new Map(main.nodes.map((node) => [node.attemptId, node]));
  assert.deepEqual(
    main.nodes.map((node) => [node.attemptId, node.treeParentId, node.lineageSource]),
    [
      ["run_a1", null, "root"],
      ["run_a2", "run_a1", "retry"],
      ["run_a3", "run_a2", "retry"],
      ["run_c1", "run_a3", "fromRun"],
    ]
  );
  assert.deepEqual(main.intents.sort(), ["document the follow-up", "restore tar torch catalog descriptions"].sort());
  // the whole chain's cost is charged to the episode — handoffs cannot hide it
  assert.equal(main.costMs, 100 + 200 + 300 + 400);
  // unknown costs (null durations) are counted, not zeroed
  const events = fixtureEvents();
  const childFinish = events.find((event) => event.kind === "attempt-finish" && event.attemptId === "run_c1");
  childFinish.cost.durationMs = null;
  childFinish.durationMs = null;
  const rerun = buildEpisodes(events, { receipts: [] })[0];
  assert.equal(rerun.unknownCosts, 1);
  assert.equal(rerun.costMs, 600, "unknown contributes 0 to the sum but is flagged");
  assert.equal(intentKeyOf("RESTORE tar-torch catalog descriptions!"), intentKeyOf("Restore tar torch catalog descriptions"));
});

// ---- splits: whole root intents, no paraphrase leakage ---------------------------

test("splits keep whole root intents together and hold out the newest third", () => {
  const episodes = [];
  for (let index = 0; index < 9; index += 1) {
    episodes.push({ episodeId: `ep_${index}`, rootIntentKey: `goal ${index}`, startedAt: index * 1000, intents: [`goal ${index}`], attemptIds: [index], nodes: [] });
  }
  const { train, holdout } = splitEpisodes(episodes, { holdoutFraction: 1 / 3 });
  assert.equal(train.length, 6);
  assert.equal(holdout.length, 3);
  assert.deepEqual(holdout.map((episode) => episode.episodeId), ["ep_6", "ep_7", "ep_8"], "newest episodes are held out");
  const trainRoots = new Set(train.map((episode) => episode.rootIntentKey));
  for (const episode of holdout) assert.equal(trainRoots.has(episode.rootIntentKey), false);
  // a hand-assembled dataset whose duplicate roots straddle the boundary is
  // REFUSED — the same problem can never sit on both sides under two names
  const straddling = [
    { episodeId: "ep_a", rootIntentKey: "shared goal", startedAt: 1000, intents: [], attemptIds: [], nodes: [] },
    { episodeId: "ep_b", rootIntentKey: "unrelated", startedAt: 2000, intents: [], attemptIds: [], nodes: [] },
    { episodeId: "ep_c", rootIntentKey: "shared goal", startedAt: 3000, intents: [], attemptIds: [], nodes: [] },
  ];
  assert.throws(() => splitEpisodes(straddling, { holdoutFraction: 1 / 3 }), /split leak/);
});

// ---- export: read-only, prompt-free, hash-stable --------------------------------

test("exportDataset is a read-only snapshot that never carries prompt bodies", async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, "experience.jsonl");
    const events = fixtureEvents();
    for (const event of events) await appendEvent(file, event);
    const receipts = [
      buildReceipt({
        attemptId: "run_a2",
        workItem: { kind: "task", id: "t", title: "Restore tar torch catalog descriptions", prompt: "SECRET PROMPT BODY" },
        attempt: { sessionId: "s" },
        verdict: { state: "verified", reason: "ok", evidence: { verdictOk: true, changedFiles: 2, hasSession: true, namedChecks: false, outstanding: false } },
        changedFiles: 2,
        evaluator,
        now: 1,
      }),
    ];
    const dataset = exportDataset(await readEvents(file), receipts);
    assert.ok(!JSON.stringify(dataset).includes("SECRET PROMPT BODY"));
    assert.equal(dataset.datasetHash, exportDataset(await readEvents(file), receipts).datasetHash);
    // mutating the export cannot touch experiment truth
    dataset.events.length = 0;
    assert.equal((await readEvents(file)).length, fixtureEvents().length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the improvement budget ledger -----------------------------------------------

test("every lab spend lands in one global budget ledger", async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, "budget.json");
    await spendBudget(file, { purpose: "candidate-generation", modelCalls: 2, tokens: 4000, now: 100 });
    await spendBudget(file, { purpose: "live-validation", modelCalls: 1, now: 200 });
    const budget = await readBudget(file);
    assert.equal(budget.spent.modelCalls, 3);
    assert.equal(budget.spent.tokens, 4000);
    assert.deepEqual(budget.entries.map((entry) => entry.purpose), ["candidate-generation", "live-validation"]);
    // a corrupt ledger reads as empty rather than crashing the lab
    writeFileSync(path.join(dir, "broken.json"), "{not json");
    assert.equal((await readBudget(path.join(dir, "broken.json"))).spent.modelCalls, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
