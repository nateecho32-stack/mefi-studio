// Mefi's Studio AI+ — the Policy Lab's recorded-tree replay (build brief PR2).
//
// Replay re-runs a candidate policy against a RECORDED episode tree and never
// against live work: no coding-agent executions, no board writes, no spawns.
// The boundaries the build brief demands are structural here:
//
//   MASKING      — a policy sees only the frontier (recorded continuations
//                  whose parents it has already revealed) plus summaries of
//                  what it revealed. Outcomes, receipts and future scores are
//                  never in the observation; maskAudit() proves it per step.
//   UNSUPPORTED  — selecting anything not on the frontier returns
//                  UNSUPPORTED: no invented outcome, no reward, no free work.
//   COST         — revealing a recorded continuation charges its represented
//                  execution cost; unknown cost is counted as unknown, not 0.
//   CHRONOLOGY   — siblings are offered in recorded order (chronological
//                  revelation); a policy cannot cherry-pick by future label
//                  because it cannot see one.
//   OBLIGATIONS  — stopping a branch leaves its intent OUTSTANDING in the
//                  final state. Nothing is silently resolved or dropped.
//
// Deterministic: the same episode, policy and budgets always produce the same
// transcript (injected clock, stable sorts, no randomness).

import { buildObservation, decide as decideDefault, normalizeAction } from "./policy.mjs";

export const REPLAY_SCHEMA = 1;

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Fields that must never appear in an observation — they describe outcomes,
// not choices. maskAudit walks the serialized observation for them and for
// ids of attempts the policy has not been shown.
const FORBIDDEN_KEYS = new Set(["outcome", "result", "exitCode", "receipt", "receiptId", "trust", "state", "verified", "handoffs", "cost", "durationMs", "sawDone"]);

export function frontierOf(episode, revealed) {
  const revealedSet = new Set(revealed);
  return episode.nodes
    .filter((node) => !revealedSet.has(node.attemptId) && (!node.treeParentId || revealedSet.has(node.treeParentId)))
    .sort((a, b) => a.at - b.at || (a.attemptId < b.attemptId ? -1 : 1));
}

export function revealedSummary(episode, revealed) {
  const revealedSet = new Set(revealed);
  const summary = {};
  for (const node of episode.nodes) {
    if (!revealedSet.has(node.attemptId)) continue;
    const key = node.intentKey;
    const row = summary[key] ?? (summary[key] = { attempts: 0, failures: 0, trustedVerified: false, spentMs: 0 });
    row.attempts += 1;
    if (node.outcome === "failed") row.failures += 1;
    if (node.verification?.trust === "trusted") row.trustedVerified = true;
    row.spentMs += node.cost?.durationMs ?? node.durationMs ?? 0;
  }
  return summary;
}

// Prove an observation carries no future: none of the outcome-bearing keys,
// and no attempt id that is not on the offered frontier.
export function maskAudit(observation, episode, frontier) {
  const violations = [];
  const walk = (value, trail) => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${trail}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) violations.push(`forbidden key "${key}" at ${trail}`);
      walk(child, `${trail}.${key}`);
    }
  };
  walk(observation, "observation");
  const offered = new Set((frontier ?? []).map((node) => node.action?.id).filter(Boolean));
  for (const action of observation?.actions ?? []) {
    if (!offered.has(action.id)) violations.push(`action "${action.id}" is not on the offered frontier`);
  }
  return { pass: violations.length === 0, violations };
}

export function runReplay(episode, policy, { decideFn, maxSteps = 64, maxCostMs = Number.POSITIVE_INFINITY, now = 0 } = {}) {
  if (!episode || !Array.isArray(episode.nodes) || !episode.nodes.length) {
    throw new TypeError("runReplay: an episode with at least one attempt is required");
  }
  const decide = decideFn ?? ((pol, observation) => decideDefault(pol, observation));
  const revealed = [];
  const revealedSet = new Set();
  const steps = [];
  let chargedMs = 0;
  let unknownCosts = 0;
  let unsupported = 0;
  let censored = false;
  let stoppedReason = "exhausted";
  let decisionClock = now;

  const reveal = (node) => {
    revealedSet.add(node.attemptId);
    revealed.push(node.attemptId);
    const cost = node.cost?.durationMs ?? node.durationMs ?? null;
    if (cost === null) unknownCosts += 1;
    else chargedMs += cost;
  };

  for (let step = 0; step < maxSteps; step += 1) {
    const frontier = frontierOf(episode, revealed);
    if (!frontier.length) {
      stoppedReason = steps.length && steps[steps.length - 1].status === "unsupported" ? "unsupported-loop" : "exhausted";
      break;
    }
    const actions = frontier.map((node, index) => normalizeAction({ ...node.action, order: index }));
    const observation = buildObservation({
      projectId: "replay",
      episodeId: episode.episodeId,
      decisionId: `rp_${episode.episodeId}_${step}`,
      at: decisionClock,
      actions,
      revealed: revealedSummary(episode, revealed),
      limits: { maxConcurrency: 1, paused: false, machineBusy: false },
    });
    const audit = maskAudit(observation, episode, frontier);
    let decision;
    try {
      decision = decide(policy, observation);
    } catch (error) {
      stoppedReason = `policy-error:${clipText(error.message, 80)}`;
      steps.push({ step, status: "policy-error", error: clipText(error.message, 160), observation, maskAudit: audit });
      censored = true;
      break;
    }
    const pick = Array.isArray(decision?.batch) && decision.batch.length ? String(decision.batch[0]) : null;
    if (!pick) {
      stoppedReason = clipText(decision?.reason, 60) || "policy-stop";
      steps.push({ step, status: "stopped", reason: stoppedReason, decision, observation, maskAudit: audit });
      break;
    }
    const node = frontier.find((item) => item.action?.id === pick);
    if (!node) {
      unsupported += 1;
      steps.push({ step, status: "unsupported", selected: pick, decision, observation, maskAudit: audit });
      if (unsupported >= Math.max(4, Math.floor(maxSteps / 2))) {
        stoppedReason = "unsupported-loop";
        break;
      }
      continue;
    }
    reveal(node);
    decisionClock += 1;
    steps.push({ step, status: "revealed", selected: pick, attemptId: node.attemptId, intentKey: node.intentKey, decision, observation, maskAudit: audit });
    if (chargedMs >= maxCostMs) {
      stoppedReason = "cost-budget";
      censored = true;
      break;
    }
  }
  if (steps.length >= maxSteps && stoppedReason === "exhausted" && frontierOf(episode, revealed).length) {
    stoppedReason = "step-budget";
    censored = true;
  }
  const revealedNodes = episode.nodes.filter((node) => revealedSet.has(node.attemptId));
  const trustedIntents = new Set(revealedNodes.filter((node) => node.verification?.trust === "trusted").map((node) => node.intentKey));
  const reportedIntents = new Set(
    revealedNodes.filter((node) => node.verification?.trust === "self-reported").map((node) => node.intentKey).filter((key) => !trustedIntents.has(key))
  );
  const outstandingIntents = episode.intents.filter((key) => !trustedIntents.has(key));
  const wastedMs = revealedNodes
    .filter((node) => !trustedIntents.has(node.intentKey))
    .reduce((sum, node) => sum + (node.cost?.durationMs ?? node.durationMs ?? 0), 0);
  return {
    schema: REPLAY_SCHEMA,
    episodeId: episode.episodeId,
    episodeIntents: [...episode.intents],
    policyId: policy?.id ?? null,
    steps,
    stoppedReason,
    censored,
    metrics: {
      steps: steps.length,
      revealedNodes: revealed.length,
      totalNodes: episode.nodes.length,
      coverage: episode.nodes.length ? revealed.length / episode.nodes.length : 0,
      unexploredNodes: episode.nodes.length - revealed.length,
      unsupported,
      chargedMs,
      unknownCosts,
      wastedRetryMs: wastedMs,
      trustedObligations: [...trustedIntents],
      reportedObligations: [...reportedIntents],
      outstandingObligations: outstandingIntents,
    },
    finalState: {
      revealed: [...revealed],
      trustedIntents: [...trustedIntents],
      reportedIntents: [...reportedIntents],
      // Every intent the episode owed is accounted for: verified or still
      // outstanding. Stopping a branch preserves the parent goal.
      outstandingIntents,
    },
  };
}
