// Mefi's Studio AI+ — the Policy Lab (build brief PR2).
//
// Offline evaluation ONLY: bounded candidate configurations replayed against
// immutable recorded episodes, gated, compared with the incumbent on a
// held-out split, and written out as a reproducible report artifact. The lab
// has no production-write permissions — it never claims work, never spawns a
// coding agent, never touches the board stores — and its report says so.
//
// Honest numbers only: every metric in the report is measured on the
// evaluated histories (named source: live store or fixture), trusted labels
// come only from runner-produced receipts, and replay superiority is labeled
// as evidence on those histories, not a promise about future work. With no
// recorded episodes the report says exactly that and claims nothing.
//
// CLI:
//   node scripts/policy-lab.mjs                    # evaluate the live store
//   node scripts/policy-lab.mjs --fixture <dir>    # evaluate a fixture dataset
//   node scripts/policy-lab.mjs --out <dir>        # where reports land
// Replay consumes no model calls; candidate generation is a local grid. Both
// facts are recorded in the report's budget block.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_POLICY, POLICY_CONFIG_SPEC, defineConfigPolicy, policyIdentity } from "./policy.mjs";
import { buildEpisodes, exportDataset, readBudget, readEvents, splitEpisodes } from "./experience.mjs";
import { readReceipts } from "./receipts.mjs";
import { runReplay } from "./replay.mjs";
import { compareWithIncumbent, invariantGates } from "./policy-gates.mjs";

export const POLICY_LAB_VERSION = 1;
export const REPORT_SCHEMA = 1;

const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_LAB_DIR = path.join(STUDIO_ROOT, "data", "policy-lab");

// ---- bounded candidate generation ----------------------------------------------
// A small grid inside the allowlisted clamps — every candidate is a validated
// config policy, generated deterministically, capped so the lab stays a lab
// and not a search engine. The incumbent (baseline) is always index 0 and is
// never absent from an evaluation.

export function generateCandidates({ maxCandidates = 12 } = {}) {
  const candidates = [BASELINE_POLICY];
  const seen = new Set([policyIdentity(BASELINE_POLICY).hash]);
  for (const maxAttemptsPerIntent of [2, 3]) {
    for (const failureSlipBands of [0, 1]) {
      for (const withinBandOrder of ["age", "failures-then-age"]) {
        if (candidates.length >= maxCandidates) break;
        const policy = defineConfigPolicy(`retry-${maxAttemptsPerIntent}-slip-${failureSlipBands}-${withinBandOrder === "age" ? "age" : "failfirst"}`, {
          withinBandOrder,
          failureSlipBands,
          maxAttemptsPerIntent,
          concurrency: POLICY_CONFIG_SPEC.concurrency.default,
        });
        const hash = policyIdentity(policy).hash;
        if (seen.has(hash)) continue;
        seen.add(hash);
        candidates.push(policy);
      }
    }
  }
  return candidates.slice(0, maxCandidates);
}

// ---- evaluation -------------------------------------------------------------------

function aggregateReplays(replays) {
  return {
    episodes: replays.length,
    trustedObligations: replays.reduce((sum, replay) => sum + (replay.metrics?.trustedObligations?.length ?? 0), 0),
    reportedObligations: replays.reduce((sum, replay) => sum + (replay.metrics?.reportedObligations?.length ?? 0), 0),
    outstandingObligations: replays.reduce((sum, replay) => sum + (replay.metrics?.outstandingObligations?.length ?? 0), 0),
    chargedMs: replays.reduce((sum, replay) => sum + (replay.metrics?.chargedMs ?? 0), 0),
    wastedRetryMs: replays.reduce((sum, replay) => sum + (replay.metrics?.wastedRetryMs ?? 0), 0),
    unknownCostSteps: replays.reduce((sum, replay) => sum + (replay.metrics?.unknownCosts ?? 0), 0),
    unsupported: replays.reduce((sum, replay) => sum + (replay.metrics?.unsupported ?? 0), 0),
    unexploredNodes: replays.reduce((sum, replay) => sum + (replay.metrics?.unexploredNodes ?? 0), 0),
    censoredDecisions: replays.filter((replay) => replay.censored).length,
    coverage: replays.length ? replays.reduce((sum, replay) => sum + (replay.metrics?.coverage ?? 0), 0) / replays.length : 0,
  };
}

export function evaluatePolicy(policy, episodes, { maxStepsPerEpisode = 64, now = 0 } = {}) {
  const identity = policyIdentity(policy);
  const replays = episodes.map((episode) => runReplay(episode, policy, { maxSteps: maxStepsPerEpisode, now }));
  const gates = invariantGates(replays);
  return {
    policy: identity,
    replays: replays.map((replay) => ({ ...replay, steps: replay.steps.map((step) => ({ ...step, observation: undefined })) })),
    aggregate: aggregateReplays(replays),
    gates,
  };
}

// ---- the lab run ------------------------------------------------------------------

export function runLab({
  events = [],
  receipts = [],
  candidates = null,
  holdoutFraction = 1 / 3,
  source = "live-store",
  now = 0,
  maxStepsPerEpisode = 64,
} = {}) {
  const dataset = exportDataset(events, receipts);
  const episodes = buildEpisodes(events, { receipts });
  const roster = candidates?.length ? candidates : generateCandidates();
  const incumbentPolicy = roster[0] && roster[0].kind === "baseline" ? roster[0] : BASELINE_POLICY;
  const base = {
    labVersion: POLICY_LAB_VERSION,
    schema: REPORT_SCHEMA,
    generatedAt: now,
    source,
    datasetHash: dataset.datasetHash,
    budget: { modelCallsSpentByLab: 0, note: "offline replay: no model calls, no coding-agent executions" },
    activePolicyUnchanged: true,
    liveActivationStage: "disabled-until-PR3",
  };
  if (!episodes.length) {
    return {
      ...base,
      episodes: 0,
      note: "no recorded episodes in this dataset — recording is observation-only; nothing was evaluated and nothing is claimed",
      evaluations: [],
      comparisons: [],
      split: { train: 0, holdout: 0 },
    };
  }
  const split = splitEpisodes(episodes, { holdoutFraction });
  const evaluations = roster.map((policy) => {
    const onTrain = evaluatePolicy(policy, split.train, { now, maxStepsPerEpisode });
    const onHoldout = evaluatePolicy(policy, split.holdout, { now, maxStepsPerEpisode });
    return { policy: onTrain.policy, gates: onHoldout.gates, train: onTrain.aggregate, holdout: onHoldout.aggregate, replayDetails: onHoldout.replays };
  });
  const incumbent = evaluations.find((row) => row.policy.kind === "baseline") ?? evaluations[0];
  const hasHoldout = split.holdout.length > 0;
  const comparisons = evaluations
    .filter((row) => row.policy.id !== incumbent.policy.id)
    .map((row) => ({
      policy: row.policy,
      verdict: hasHoldout
        ? compareWithIncumbent({
            incumbent: { ...incumbent.holdout, gates: incumbent.gates },
            candidate: { ...row.holdout, gates: row.gates },
          })
        : { verdict: "not-evaluated", dimensions: {}, reasons: ["no held-out episodes — at least two recorded episodes are needed before a comparison means anything"] },
    }));
  return {
    ...base,
    episodes: episodes.length,
    split: { train: split.train.length, holdout: split.holdout.length },
    episodeSummaries: episodes.map((episode) => ({
      episodeId: episode.episodeId,
      attempts: episode.attemptIds.length,
      intents: episode.intents.length,
      trusted: episode.terminal.trustedIntents.length,
      reported: episode.terminal.reportedIntents.length,
      unresolved: episode.terminal.unresolvedIntents.length,
      costMs: episode.costMs,
      unknownCosts: episode.unknownCosts,
    })),
    evaluations,
    comparisons,
  };
}

// ---- the report artifact -----------------------------------------------------------

export function renderReportMarkdown(report) {
  const lines = [];
  lines.push("# Policy Lab replay report");
  lines.push("");
  lines.push(`- Generated: ${new Date(report.generatedAt || 0).toISOString()}`);
  lines.push(`- Dataset source: ${report.source} (${report.episodes} episode(s), hash \`${String(report.datasetHash).slice(0, 16)}…\`)`);
  lines.push(`- Split: ${report.split.train} train / ${report.split.holdout} held-out (whole root intents, chronological)`);
  lines.push(`- Lab budget: ${report.budget.modelCallsSpentByLab} model call(s) — ${report.budget.note}`);
  lines.push("");
  if (!report.episodes) {
    lines.push(report.note);
    lines.push("");
    lines.push("No live dispatch changes were made. The active policy is unchanged (baseline).");
    return lines.join("\n");
  }
  const useHoldout = report.split.holdout > 0;
  lines.push(useHoldout ? "## Candidate comparison (held-out episodes)" : "## Candidate comparison (training episodes — no holdout yet)");
  lines.push("");
  if (!useHoldout) lines.push("_Fewer than two recorded episodes: nothing is held out, so these numbers are diagnostics on the training set and NO comparison verdict is issued._");
  lines.push("");
  lines.push("| policy | trusted obligations | reported only | outstanding | charged cost (ms) | wasted retry (ms) | unsupported | unexplored | coverage |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.evaluations) {
    const m = useHoldout ? row.holdout : row.train;
    lines.push(
      `| ${row.policy.id}${row.policy.kind === "baseline" ? " (incumbent)" : ""} | ${m.trustedObligations} | ${m.reportedObligations} | ${m.outstandingObligations} | ${m.chargedMs} | ${m.wastedRetryMs} | ${m.unsupported} | ${m.unexploredNodes} | ${(m.coverage * 100).toFixed(0)}% |`
    );
  }
  lines.push("");
  lines.push("## Verdicts vs the incumbent (held-out)");
  lines.push("");
  if (!report.comparisons.length) lines.push("- (no candidates in this run)");
  for (const comparison of report.comparisons) {
    const reasons = comparison.verdict.reasons.length ? comparison.verdict.reasons.join("; ") : "no measured difference";
    lines.push(`- **${comparison.policy.id}**: ${comparison.verdict.verdict} — ${reasons}. Gates: ${comparison.verdict.verdict === "rejected" ? "violated" : "passed"}.`);
  }
  lines.push("");
  lines.push("## Boundaries");
  lines.push("");
  lines.push("- Replay is evidence on the evaluated histories only; it is not a guarantee of improvement on future work.");
  lines.push("- Positive completion labels count only runner-observed (trusted) receipts; worker-named checks are reported, never rewarded.");
  lines.push("- Concurrency is fixed at 1 in replay; any parallelism claim would be simulation and is not made here.");
  lines.push(`- Censored (budget-truncated) replays: ${report.evaluations.reduce((sum, row) => sum + row.holdout.censoredDecisions, 0)}.`);
  lines.push("");
  lines.push("**No live dispatch changes were made by this run.** The active policy is unchanged (baseline); promotion is a separate, operator-consented step that stays disabled until controlled activation ships.");
  return lines.join("\n");
}

export async function writeReport(report, outDir, { now = report.generatedAt } = {}) {
  await mkdir(outDir, { recursive: true });
  const stamp = new Date(now || 0).toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `${stamp}-policy-lab-report.json`);
  const mdPath = path.join(outDir, `${stamp}-policy-lab-report.md`);
  const payload = JSON.stringify(report, null, 2);
  await writeFile(jsonPath, payload, "utf8");
  await writeFile(mdPath, renderReportMarkdown(report), "utf8");
  return { jsonPath, mdPath, sha256: createHash("sha256").update(payload).digest("hex") };
}

// ---- CLI ---------------------------------------------------------------------------

export async function loadDataset(dir) {
  const [events, receipts] = await Promise.all([readEvents(path.join(dir, "experience.jsonl")), readReceipts(path.join(dir, "receipts.jsonl"))]);
  return { events, receipts };
}

async function cli(argv = process.argv.slice(2)) {
  let fixture = null;
  let outDir = path.join(DEFAULT_LAB_DIR, "reports");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") fixture = argv[(index += 1)];
    else if (argv[index] === "--out") outDir = argv[(index += 1)];
  }
  const storeDir = fixture ?? DEFAULT_LAB_DIR;
  const { events, receipts } = await loadDataset(storeDir);
  const budget = await readBudget(path.join(DEFAULT_LAB_DIR, "budget.json")).catch(() => ({ spent: { modelCalls: 0 } }));
  const report = runLab({ events, receipts, source: fixture ? `fixture:${path.basename(fixture)}` : "live-store", now: Date.now() });
  report.budget.globalImprovementBudget = budget.spent ?? { modelCalls: 0 };
  const written = await writeReport(report, outDir);
  console.log(`[policy-lab] ${report.episodes} episode(s) from ${report.source} · ${report.evaluations.length} polic(ies) evaluated`);
  for (const comparison of report.comparisons) console.log(`[policy-lab] ${comparison.policy.id}: ${comparison.verdict.verdict} — ${comparison.verdict.reasons.join("; ") || "no measured difference"}`);
  console.log(`[policy-lab] report: ${written.mdPath}`);
  console.log(`[policy-lab] artifact sha256: ${written.sha256.slice(0, 16)}…`);
  console.log("[policy-lab] no live dispatch changes were made; the active policy is unchanged (baseline)");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[policy-lab] failed: ${error.message}`);
      process.exit(2);
    }
  );
}
