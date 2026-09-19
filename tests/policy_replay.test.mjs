// The Policy Lab's replay engine (build brief PR2): masked observations that
// cannot see the future, UNSUPPORTED for invented selections, represented
// costs charged on reveal, obligations preserved when a branch stops, and
// datasets no policy can mutate.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_POLICY, defineConfigPolicy } from "../scripts/policy.mjs";
import { buildEpisodes, readEvents } from "../scripts/experience.mjs";
import { readReceipts } from "../scripts/receipts.mjs";
import { maskAudit, runReplay } from "../scripts/replay.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "policy-demo");

async function fixtureEpisodes() {
  const [events, receipts] = await Promise.all([readEvents(path.join(FIXTURE, "experience.jsonl")), readReceipts(path.join(FIXTURE, "receipts.jsonl"))]);
  return { events, receipts, episodes: buildEpisodes(events, { receipts }) };
}

const RETRY_2 = defineConfigPolicy("retry-2", { withinBandOrder: "age", failureSlipBands: 0, maxAttemptsPerIntent: 2, concurrency: 1 });

// ---- masking: the policy cannot see the future --------------------------------

test("replay observations carry no outcomes and never leave the offered frontier", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const replay = runReplay(tar, BASELINE_POLICY, { now: 0 });
  assert.ok(replay.steps.length >= 3);
  for (const step of replay.steps) {
    assert.equal(step.maskAudit.pass, true, `step ${step.step} leaked: ${step.maskAudit.violations.join("; ")}`);
  }
  // the observation the policy saw on step 0 offers ONLY the root attempt
  const first = replay.steps[0];
  assert.equal(first.observation.actions.length, 1);
  assert.equal(first.observation.actions[0].id, "run_101");
  // and the revealed summary starts empty: no hindsight, no future scores
  assert.deepEqual(first.observation.revealed, {});
});

test("maskAudit itself flags outcome keys and off-frontier actions", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const root = tar.nodes.find((node) => node.attemptId === "run_101");
  const sneaky = { actions: [{ id: "run_101", outcome: "failed", trust: "trusted" }, { id: "run_999" }], revealed: {} };
  const audit = maskAudit(sneaky, tar, [root]);
  assert.equal(audit.pass, false);
  assert.ok(audit.violations.some((line) => line.includes('"outcome"')));
  assert.ok(audit.violations.some((line) => line.includes("run_999")));
});

// ---- unsupported selections: no invented rewards, no free work -----------------

test("an invented selection returns UNSUPPORTED and gains nothing", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  // a policy that names an attempt it was never offered (a known-later one)
  const cheater = { id: "cheater" };
  const cheat = (policy, observation) =>
    observation.decisionId.endsWith("_0")
      ? { policyId: policy.id, order: ["run_104"], batch: ["run_104"], concurrency: 1, reason: "i can see the future" }
      : { policyId: policy.id, order: [], batch: [], concurrency: 0, reason: "done" };
  const replay = runReplay(tar, cheater, { decideFn: cheat, now: 0 });
  assert.equal(replay.steps[0].status, "unsupported");
  assert.equal(replay.metrics.unsupported, 1);
  assert.equal(replay.metrics.revealedNodes, 0, "nothing was revealed by an invented pick");
  assert.equal(replay.metrics.chargedMs, 0, "no represented cost was charged for invented work");
  assert.deepEqual(replay.finalState.trustedIntents, [], "no obligation was verified by an invented pick");
  assert.deepEqual(replay.finalState.outstandingIntents, tar.intents, "the obligation is still outstanding");
});

test("a policy stuck on an already-revealed node hits unsupported and is stopped", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  // always names the ROOT attempt, even after it was revealed and left the
  // frontier — the replay must not hand it a second outcome
  const stubborn = { id: "stubborn" };
  const stuck = () => ({ policyId: "stubborn", order: ["run_101"], batch: ["run_101"], concurrency: 1, reason: "again" });
  const replay = runReplay(tar, stubborn, { decideFn: stuck, now: 0 });
  assert.equal(replay.steps[0].status, "revealed");
  assert.equal(replay.steps[1].status, "unsupported");
  assert.equal(replay.metrics.revealedNodes, 1, "the root was revealed exactly once");
  assert.equal(replay.metrics.chargedMs, 240000, "and charged exactly once");
  assert.equal(replay.stoppedReason, "unsupported-loop");
});

// ---- represented costs and coverage ---------------------------------------------

test("revealing a continuation charges its recorded cost; unknown cost is counted as unknown", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const baseline = runReplay(tar, BASELINE_POLICY, { now: 0 });
  assert.equal(baseline.metrics.revealedNodes, 4);
  assert.equal(baseline.metrics.chargedMs, 240000 + 300000 + 180000 + 200000);
  assert.equal(baseline.metrics.unknownCosts, 0);
  // a cost-budgeted replay stops and reports itself censored
  const censored = runReplay(tar, BASELINE_POLICY, { now: 0, maxCostMs: 300000 });
  assert.equal(censored.censored, true);
  assert.equal(censored.stoppedReason, "cost-budget");
  assert.ok(censored.metrics.coverage < 1);
});

test("retry-cap-2 reveals half the holdout chain, spends less, keeps the obligation outstanding", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const capped = runReplay(tar, RETRY_2, { now: 0 });
  assert.equal(capped.stoppedReason, "retry-budget-exhausted");
  assert.equal(capped.metrics.revealedNodes, 2);
  assert.equal(capped.metrics.chargedMs, 240000 + 300000);
  assert.equal(capped.metrics.unexploredNodes, 2);
  // stopping the branch PRESERVES the parent goal: still owed, not dropped
  assert.deepEqual(capped.finalState.outstandingIntents, ["restore tar torch and stick catalog descriptions"]);
  assert.deepEqual(capped.finalState.trustedIntents, []);
});

// ---- determinism and dataset immutability ---------------------------------------

test("replay is deterministic and never mutates the episode dataset", async () => {
  const { episodes } = await fixtureEpisodes();
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const before = structuredClone(tar);
  const one = runReplay(tar, RETRY_2, { now: 0 });
  const two = runReplay(tar, RETRY_2, { now: 0 });
  assert.deepEqual(one, two);
  const baselineOne = runReplay(tar, BASELINE_POLICY, { now: 0 });
  runReplay(tar, RETRY_2, { now: 0 });
  assert.deepEqual(tar, before, "two policies replayed over one dataset left it untouched");
  assert.equal(baselineOne.metrics.steps > 0, true);
});

// ---- baseline parity on recorded picks -------------------------------------------

test("the baseline policy follows the recorded chain (recording-parity)", async () => {
  const { episodes } = await fixtureEpisodes();
  // every fixture decision selected its own action; replaying with the
  // baseline must reveal the same attempts the recorder saw selected
  const tar = episodes.find((episode) => episode.rootIntentKey === "restore tar torch and stick catalog descriptions");
  const replay = runReplay(tar, BASELINE_POLICY, { now: 0 });
  assert.deepEqual(
    replay.steps.filter((step) => step.status === "revealed").map((step) => step.attemptId),
    ["run_101", "run_102", "run_103", "run_104"]
  );
});

// ---- handoff lineage replays as a tree --------------------------------------------

test("a handed-off child joins the frontier only after its parent is revealed", async () => {
  const { episodes } = await fixtureEpisodes();
  const docs = episodes.find((episode) => episode.rootIntentKey === "update testruns documentation for the new checks");
  const replay = runReplay(docs, RETRY_2, { now: 0 });
  const revealedOrder = replay.steps.filter((step) => step.status === "revealed").map((step) => step.attemptId);
  assert.deepEqual(revealedOrder, ["run_301", "run_302"]);
  // both obligations verified by trusted receipts; nothing outstanding
  assert.deepEqual(replay.finalState.trustedIntents.sort(), ["document the new budget rows", "update testruns documentation for the new checks"].sort());
  assert.deepEqual(replay.finalState.outstandingIntents, []);
});
