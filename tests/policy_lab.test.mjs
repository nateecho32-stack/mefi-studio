// The Policy Lab itself and its deployment gates (build brief PR2): invariant
// gates hard-reject unsafe candidates, the incumbent is always in the
// comparison, promotion is consented + atomic + crash-safe, rollback changes
// future dispatch only, reports are reproducible and honest, and the recorder
// wiring in main.cjs stays observation-only.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_POLICY, defineConfigPolicy } from "../scripts/policy.mjs";
import { buildEpisodes, readEvents } from "../scripts/experience.mjs";
import { readReceipts } from "../scripts/receipts.mjs";
import { runReplay } from "../scripts/replay.mjs";
import { compareWithIncumbent, defaultPolicyState, invariantGates, promote, readPolicyState, rollback } from "../scripts/policy-gates.mjs";
import { evaluatePolicy, generateCandidates, renderReportMarkdown, runLab, writeReport } from "../scripts/policy-lab.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(STUDIO, "tests", "fixtures", "policy-demo");
const scratch = () => mkdtempSync(path.join(os.tmpdir(), "policy-lab-test-"));

async function fixtureData() {
  const [events, receipts] = await Promise.all([readEvents(path.join(FIXTURE, "experience.jsonl")), readReceipts(path.join(FIXTURE, "receipts.jsonl"))]);
  return { events, receipts, episodes: buildEpisodes(events, { receipts }) };
}

// ---- gates ----------------------------------------------------------------------

// A synthetic episode whose frontier FORKS: one root handing off two children,
// so a step offers two actions at once (the fixture episodes are all chains).
function forkedEpisode() {
  const action = (id, intentKey, extra = {}) => ({
    id,
    intentKey,
    kind: "task",
    title: id,
    band: 2,
    operatorLocked: false,
    age: 0,
    runFailures: 0,
    failureCategory: null,
    depth: 0,
    order: 0,
    ...extra,
  });
  const node = (attemptId, intentKey, treeParentId, at, extra = {}) => ({
    attemptId,
    intentKey,
    treeParentId,
    at,
    action: action(attemptId, intentKey),
    outcome: "reported-done",
    verification: null,
    handoffs: [],
    result: null,
    cost: { durationMs: 100, modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
    durationMs: 100,
    ...extra,
  });
  return {
    episodeId: "ep_fork",
    rootIntentKey: "root goal",
    startedAt: 1000,
    lastAt: 4000,
    intents: ["root goal", "child one", "child two"],
    attemptIds: ["run_root", "run_c1", "run_c2"],
    nodes: [
      node("run_root", "root goal", null, 1000, { outcome: "failed" }),
      node("run_c1", "child one", "run_root", 2000, { action: action("run_c1", "child one", { operatorLocked: true, pinAt: 5 }) }),
      node("run_c2", "child two", "run_root", 3000),
    ],
    roots: ["run_root"],
    terminal: { trustedIntents: [], reportedIntents: [], unresolvedIntents: ["root goal", "child one", "child two"] },
    costMs: 300,
    unknownCosts: 0,
  };
}

test("a candidate that ignores an operator lock is hard-rejected", () => {
  const episode = forkedEpisode();
  const unlocker = { id: "unlocker" };
  // step 0 offers the root (only choice); step 1 offers the pinned child and
  // its sibling — the policy deliberately takes the UNPINNED sibling first.
  const ignoreLocks = (policy, observation) => {
    const pick = observation.actions.find((action) => !action.operatorLocked) ?? observation.actions[0];
    return { policyId: policy.id, order: observation.actions.map((action) => action.id), batch: [pick.id], concurrency: 1, reason: "locks are for other policies" };
  };
  const gates = invariantGates([runReplay(episode, unlocker, { decideFn: ignoreLocks, now: 0 })]);
  assert.equal(gates.pass, false);
  assert.ok(gates.violations.some((violation) => violation.gate === "operator-lock-order"));
  // the baseline, shown the same fork, takes the pin first and passes
  assert.equal(invariantGates([runReplay(episode, BASELINE_POLICY, { now: 0 })]).pass, true);
});

test("a candidate that bursts past the offered concurrency is rejected", () => {
  const episode = forkedEpisode();
  const wide = { id: "wide" };
  const burst = (policy, observation) => ({ policyId: policy.id, order: observation.actions.map((action) => action.id), batch: observation.actions.slice(0, 1).map((action) => action.id), concurrency: 12, reason: "more is faster" });
  const gates = invariantGates([runReplay(episode, wide, { decideFn: burst, now: 0 })]);
  assert.equal(gates.pass, false);
  assert.ok(gates.violations.some((violation) => violation.gate === "concurrency-limit"));
});

test("a replay that loses an obligation from its final accounting is rejected", async () => {
  const { episodes } = await fixtureData();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const baselineReplay = runReplay(tar, BASELINE_POLICY, { now: 0 });
  // sabotage: an intent vanishes from both verified and outstanding
  const doctored = { ...baselineReplay, finalState: { ...baselineReplay.finalState, outstandingIntents: [] }, metrics: { ...baselineReplay.metrics, outstandingObligations: [] } };
  const gates = invariantGates([doctored]);
  assert.equal(gates.pass, false);
  assert.ok(gates.violations.some((violation) => violation.gate === "no-lost-obligations"));
});

test("candidates and incumbent compare multi-dimensionally; verified work cannot be traded away", async () => {
  const incumbent = { trustedObligations: 3, chargedMs: 1000, unsupported: 0, unexploredNodes: 0, gates: { pass: true } };
  const cheaperButIncomplete = compareWithIncumbent({ incumbent, candidate: { trustedObligations: 2, chargedMs: 10, unsupported: 0, unexploredNodes: 5, gates: { pass: true } } });
  assert.equal(cheaperButIncomplete.verdict, "worse");
  const unsafe = compareWithIncumbent({ incumbent, candidate: { trustedObligations: 9, chargedMs: 1, unsupported: 0, unexploredNodes: 0, gates: { pass: false } } });
  assert.equal(unsafe.verdict, "rejected");
  const better = compareWithIncumbent({ incumbent, candidate: { trustedObligations: 3, chargedMs: 400, unsupported: 0, unexploredNodes: 2, gates: { pass: true } } });
  assert.equal(better.verdict, "better");
});

// ---- the lab run -----------------------------------------------------------------

test("the lab always includes the incumbent, evaluates bounded candidates, and issues held-out verdicts", async () => {
  const { events, receipts } = await fixtureData();
  const report = runLab({ events, receipts, source: "fixture:policy-demo", now: 42 });
  assert.equal(report.episodes, 4);
  assert.deepEqual(report.split, { train: 3, holdout: 1 });
  assert.equal(report.evaluations[0].policy.kind, "baseline");
  assert.ok(report.evaluations.length >= 2);
  assert.ok(report.evaluations.length <= 12, "candidate roster stays bounded");
  // the milestone claim, on the fixture: a retry cap avoided repeated retries
  // on the held-out episode without losing any trusted obligation
  const retryTwo = report.comparisons.find((comparison) => comparison.policy.id === "retry-2-slip-0-age");
  assert.equal(retryTwo.verdict.verdict, "better");
  assert.ok(retryTwo.verdict.reasons.some((line) => line.includes("less represented cost")));
  // honest boundaries are stated in the artifact
  const markdown = renderReportMarkdown(report);
  assert.match(markdown, /No live dispatch changes were made/);
  assert.match(markdown, /not a guarantee of improvement on future work/);
  assert.match(markdown, /never rewarded/);
});

test("self-reported evidence is reported but never counted as verified progress", async () => {
  const { episodes } = await fixtureData();
  const docs = episodes.find((episode) => episode.rootIntentKey === "run world smoke after contract tests");
  const evaluation = evaluatePolicy(BASELINE_POLICY, [docs], { now: 0 });
  assert.equal(evaluation.aggregate.reportedObligations, 1, "the named-checks finish shows up as reported");
  assert.equal(evaluation.aggregate.trustedObligations, 0, "and never as verified");
  assert.equal(evaluation.aggregate.outstandingObligations, 1);
});

test("an empty store produces an honest no-episodes report with no claims", () => {
  const report = runLab({ events: [], receipts: [], source: "live-store", now: 42 });
  assert.equal(report.episodes, 0);
  assert.ok(report.note.includes("nothing is claimed"));
  const markdown = renderReportMarkdown(report);
  assert.match(markdown, /No live dispatch changes were made/);
  assert.doesNotMatch(markdown, /better|worse|savings/i);
});

test("reports are reproducible artifacts: same inputs, same bytes", async () => {
  const dir = scratch();
  try {
    const { events, receipts } = await fixtureData();
    const one = runLab({ events, receipts, source: "fixture:policy-demo", now: 42 });
    const two = runLab({ events, receipts, source: "fixture:policy-demo", now: 42 });
    const first = await writeReport(one, path.join(dir, "a"), { now: 42 });
    const second = await writeReport(two, path.join(dir, "b"), { now: 42 });
    assert.equal(first.sha256, second.sha256);
    assert.equal(readFileSync(first.jsonPath, "utf8"), readFileSync(second.jsonPath, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("candidate generation is bounded, validated and deterministic", () => {
  const one = generateCandidates();
  const two = generateCandidates();
  assert.deepEqual(one, two);
  assert.equal(one[0].kind, "baseline");
  assert.ok(one.length <= 12);
  for (const policy of one) assert.doesNotThrow(() => defineConfigPolicy(policy.id, policy.config));
});

// ---- promotion, crash-safety, rollback -------------------------------------------

test("promotion refuses without live activation, without consent, and for unsafe candidates", async () => {
  const dir = scratch();
  try {
    const stateFile = path.join(dir, "active-policy.json");
    const candidate = defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 });
    const evidence = { gates: { pass: true }, comparison: { verdict: "better" }, datasetHash: "x", hash: "y" };
    assert.equal((await promote({ stateFile, candidate, evidence, consent: { operator: true, via: "test" }, allowLive: false })).ok, false, "PR2: live activation is disabled");
    const noConsent = await promote({ stateFile, candidate, evidence, consent: null, allowLive: true });
    assert.equal(noConsent.ok, false);
    assert.equal(noConsent.reason, "operator-consent-required");
    const unsafe = await promote({ stateFile, candidate, evidence: { gates: { pass: false }, comparison: { verdict: "better" } }, consent: { operator: true, via: "test" }, allowLive: true });
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.reason, "invariant-gates-failed");
    // nothing was written along the way
    assert.deepEqual(await readPolicyState(stateFile), defaultPolicyState());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a crash during promotion leaves exactly one active version", async () => {
  const dir = scratch();
  const realNow = Date.now;
  try {
    const stateFile = path.join(dir, "active-policy.json");
    const candidate = defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 });
    const evidence = { gates: { pass: true }, comparison: { verdict: "better" }, datasetHash: "x", hash: "y" };
    // first promotion succeeds
    const ok = await promote({ stateFile, candidate, evidence, consent: { operator: true, via: "test" }, allowLive: true, now: 100 });
    assert.equal(ok.ok, true);
    const promoted = (await readPolicyState(stateFile)).active;
    // simulate a crash BEFORE the commit point: pin the clock so the next
    // write's temp path is predictable, and park a directory where the temp
    // file would go — the payload write fails, the rename never happens
    const frozenAt = 123456;
    Date.now = () => frozenAt;
    const blockedTmp = `${stateFile}.tmp-${process.pid}-${frozenAt}`;
    await import("node:fs/promises").then((fs) => fs.mkdir(blockedTmp, { recursive: true }));
    const poisoned = defineConfigPolicy("poison", { maxAttemptsPerIntent: 3 });
    await assert.rejects(promote({ stateFile, candidate: poisoned, evidence, consent: { operator: true, via: "test" }, allowLive: true }));
    // the pointer still names exactly one active version: the last good one
    const state = await readPolicyState(stateFile);
    assert.equal(state.active.id, promoted.id);
    assert.equal(state.active.hash, promoted.hash);
    assert.equal(state.history.length, 1, "the crashed promotion left no history entry");
  } finally {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rollback restores future dispatch to the incumbent without touching claims", async () => {
  const dir = scratch();
  try {
    const stateFile = path.join(dir, "active-policy.json");
    const candidate = defineConfigPolicy("retry-2", { maxAttemptsPerIntent: 2 });
    const evidence = { gates: { pass: true }, comparison: { verdict: "better" }, datasetHash: "x", hash: "y" };
    await promote({ stateFile, candidate, evidence, consent: { operator: true, via: "test" }, allowLive: true, now: 100 });
    const rolled = await rollback({ stateFile, reason: "regression observed", now: 200 });
    assert.equal(rolled.ok, true);
    const state = await readPolicyState(stateFile);
    assert.equal(state.active.id, "baseline");
    // the history keeps both transitions — attribution survives rollback
    assert.deepEqual(state.history.map((entry) => entry.kind), ["promote", "rollback"]);
    // attempts keep the policy identity they started with: nothing in the
    // state file rewrites experience records
    const experienceFile = path.join(dir, "experience.jsonl");
    writeFileSync(experienceFile, JSON.stringify({ schema: 1, at: 1, kind: "verification", attemptId: "run_1", receiptId: "rcp_1", state: "verified" }) + "\n");
    await rollback({ stateFile, reason: "again", now: 300 });
    const events = await readEvents(experienceFile);
    assert.equal(events.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the recorder wiring stays observation-only (main.cjs source pins) ------------

test("main.cjs delegates ranking to the baseline port with an inline fallback", async () => {
  const source = readFileSync(path.join(STUDIO, "main.cjs"), "utf8");
  assert.match(source, /policyBaselinePort \? policyBaselinePort\.compare\(a, b\) : fallbackCompareWork\(a, b\)/);
  assert.match(source, /warmPolicyBaseline\(policyModule\)/);
  // the fallback preserves the frozen rules verbatim
  assert.match(source, /if \(item\?\.pin\) return 5;/);
  assert.match(source, /if \(String\(task\?\.id \?\? ""\)\.startsWith\("task_plan_"\)\) return 3;/);
});

test("the recorder is passive: no dispatch path reads it, failures are swallowed, smoke stays silent", async () => {
  const source = readFileSync(path.join(STUDIO, "main.cjs"), "utf8");
  // recorded AFTER the pick — the decision event carries stopReason/deferred
  assert.match(source, /Computed after the pick/);
  // every policyRecord append is fire-and-forget
  const records = source.match(/policyRecord\(/g) ?? [];
  const awaited = source.match(/await policyRecord\(/g) ?? [];
  assert.ok(records.length >= 4, "decision, attempt-start, attempt-finish and verification are recorded");
  assert.equal(awaited.length, 0, "no dispatch path ever waits on the recorder");
  assert.match(source, /if \(SMOKE \|\| CAPTURE \|\| CLI_MODE\) return;/);
  // receipts are appended AFTER the housekeeping transaction, never inside it
  assert.match(source, /receiptsModule\.appendReceipt\(RECEIPTS_PATH, receipt\)\.catch\(\(\) => \{\}\)/);
  // live activation stays off: the pointer only annotates records
  assert.match(source, /live activation is disabled — dispatch stays on the baseline/);
  assert.match(source, /policyIdentity\(policy\.BASELINE_POLICY\)/);
});

test("claims stay under the board gateway — the lab has no write path into dispatch", async () => {
  const source = readFileSync(path.join(STUDIO, "main.cjs"), "utf8");
  // the only mutateBoard call in spawnNextJob is the claim the executor
  // already made; policy recording never appears inside a mutator
  const claimBlock = source.slice(source.indexOf("async function spawnNextJob"), source.indexOf("async function runExecutorHandoffs"));
  assert.match(claimBlock, /The claim is one transactional mutation/);
  assert.doesNotMatch(claimBlock, /mutateBoard\(.*policy/);
  // the experience store lives in its own directory nothing else writes
  assert.match(source, /data", "policy-lab"/);
  assert.match(source, /Nothing else writes here/);
});
