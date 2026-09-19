// Regenerates the Policy Lab demo fixture dataset (experience.jsonl +
// receipts.jsonl). The committed files ARE the fixture — this script exists so
// the dataset can be rebuilt deterministically and its shape can be read in
// one place. Run from mefi-studio/:
//
//   node tests/fixtures/policy-demo/generate.mjs
//
// The dataset models four recorded episodes (chronological order C, D, B, A —
// A is newest so the chronological holdout picks it up):
//
//   C "update testruns documentation for the new checks" — attempt 1 verified
//     by runner-observed edits, plus one HANDED-OFF child intent ("document
//     the new budget rows", lineage fromRun) also trusted-verified. Charges
//     roll up to the episode.
//   D "run world smoke after contract tests" — failed once, then a run whose
//     only evidence is worker-NAMED checks: self-reported, never a positive
//     learning label. Intent stays unresolved.
//   B "register v5 storeys in the world carve" — failed once, then verified
//     by runner-observed edits on attempt 2.
//   A "restore tar torch and stick catalog descriptions" (the holdout) — four
//     attempts: fail, unverified (outstanding obligations), fail, and a
//     punctuation/case paraphrase whose named-checks-only finish is
//     self-reported. Never trusted-verified: the repeated retries are exactly
//     the waste a bounded retry policy should learn to avoid.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent } from "../../../scripts/experience.mjs";
import { appendReceipt, buildReceipt } from "../../../scripts/receipts.mjs";
import { intentKeyOf } from "../../../scripts/policy.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXPERIENCE = path.join(DIR, "experience.jsonl");
const RECEIPTS = path.join(DIR, "receipts.jsonl");

const BASELINE = { id: "baseline", version: 1, kind: "baseline", hash: "3f9a1c2b7d8e4f605a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6708" };
const EVALUATOR = { name: "verifyCompletion", version: "3", sourceSha256: "fixture-evaluator-sha256" };

let seq = 0;
const events = [];
const receipts = [];

function decision({ id, at, intent, title, actionId, age = 0, runFailures = 0, kind = "task", band = 2 }) {
  events.push({
    schema: 1,
    at,
    seq: (seq += 1),
    kind: "decision",
    decisionId: id,
    policy: BASELINE,
    observation: {
      actions: [{ id: actionId, intentKey: intent, kind, title, band, operatorLocked: false, age, runFailures, failureCategory: runFailures > 0 ? "task" : null, depth: 0, order: 0 }],
      limits: { maxConcurrency: 1, paused: false, machineBusy: false },
      eligibleCount: 1,
    },
    recommended: [actionId],
    selected: actionId,
    deferredCount: 0,
  });
}

function attempt({ id, decisionId, at, intent, title, durationMs, outcome, sessionId, runFailures = 0, parentAttemptId = null, handoffs = [], result = null }) {
  events.push({
    schema: 1,
    at,
    seq: (seq += 1),
    kind: "attempt-start",
    attemptId: id,
    decisionId,
    parentAttemptId,
    intentKey: intent,
    actionId: id,
    workItem: { kind: "task", id: `task_${id}`, title, promptSha256: `sha-${id}`, promptChars: 120 },
    depth: parentAttemptId ? 1 : 0,
    claim: { runId: id, leaseAt: at },
    route: { via: "mefi-zai/glm-5.3-flash", cli: "opencode" },
  });
  events.push({
    schema: 1,
    at: at + durationMs,
    seq: (seq += 1),
    kind: "attempt-finish",
    attemptId: id,
    intentKey: intent,
    outcome,
    exitCode: outcome === "failed" ? 1 : 0,
    sawDone: outcome !== "failed",
    spoke: true,
    sessionId,
    durationMs,
    handoffs,
    result,
    cost: { durationMs, modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
  });
}

function receipt({ attemptId, at, intent, title, verdict, changedFiles, remaining = [] }) {
  const built = buildReceipt({
    attemptId,
    workItem: { kind: "task", id: `task_${attemptId}`, title, prompt: "fixture prompt" },
    contract: "implementation",
    attempt: { sessionId: `ses_${attemptId}`, sawDone: true, code: 0 },
    verdict,
    changedFiles,
    remaining,
    evaluator: EVALUATOR,
    now: at,
  });
  if (built) receipts.push(built);
  events.push({
    schema: 1,
    at,
    seq: (seq += 1),
    kind: "verification",
    attemptId,
    intentKey: intent,
    receiptId: built?.id ?? "rcp_missing",
    state: verdict.state,
    trust: built?.trust ?? null,
    remaining,
  });
}

// ---- Episode C (oldest): verified with a handed-off child -----------------------
const C_INTENT = "update testruns documentation for the new checks";
const C_CHILD = "document the new budget rows";
decision({ id: "dec_c1", at: 1000, intent: C_INTENT, title: "Update TESTRUNS documentation for the new checks", actionId: "run_301", age: 5400000 });
attempt({
  id: "run_301",
  decisionId: "dec_c1",
  at: 2000,
  intent: C_INTENT,
  title: "Update TESTRUNS documentation for the new checks",
  durationMs: 90000,
  outcome: "reported-done",
  sessionId: "ses_301",
  handoffs: [{ title: "Document the new budget rows", intentKey: C_CHILD }],
});
receipt({
  attemptId: "run_301",
  at: 96000,
  intent: C_INTENT,
  title: "Update TESTRUNS documentation for the new checks",
  verdict: { state: "verified", reason: "2 changed file(s) in the attempt's session", evidence: { verdictOk: true, changedFiles: 2, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 2,
});
decision({ id: "dec_c2", at: 100000, intent: C_CHILD, title: "Document the new budget rows", actionId: "run_302", age: 60000 });
attempt({
  id: "run_302",
  decisionId: "dec_c2",
  at: 101000,
  intent: C_CHILD,
  title: "Document the new budget rows",
  durationMs: 60000,
  outcome: "reported-done",
  sessionId: "ses_302",
  parentAttemptId: "run_301",
});
receipt({
  attemptId: "run_302",
  at: 165000,
  intent: C_CHILD,
  title: "Document the new budget rows",
  verdict: { state: "verified", reason: "1 changed file(s) in the attempt's session", evidence: { verdictOk: true, changedFiles: 1, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 1,
});

// ---- Episode D: named-checks-only is self-reported, never verified --------------
const D_INTENT = "run world smoke after contract tests";
decision({ id: "dec_d1", at: 300000, intent: D_INTENT, title: "Run world smoke after contract tests", actionId: "run_401", age: 3600000 });
attempt({ id: "run_401", decisionId: "dec_d1", at: 301000, intent: D_INTENT, title: "Run world smoke after contract tests", durationMs: 120000, outcome: "failed", sessionId: "ses_401" });
receipt({
  attemptId: "run_401",
  at: 425000,
  intent: D_INTENT,
  title: "Run world smoke after contract tests",
  verdict: { state: "failed", reason: "the run did not report success", evidence: { verdictOk: false, changedFiles: 0, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 0,
});
decision({ id: "dec_d2", at: 500000, intent: D_INTENT, title: "Run world smoke after contract tests", actionId: "run_402", age: 5600000, runFailures: 1 });
attempt({ id: "run_402", decisionId: "dec_d2", at: 501000, intent: D_INTENT, title: "Run world smoke after contract tests", durationMs: 110000, outcome: "reported-done", sessionId: "ses_402" });
receipt({
  attemptId: "run_402",
  at: 615000,
  intent: D_INTENT,
  title: "Run world smoke after contract tests",
  verdict: { state: "verified", reason: "no edits, but the attempt named the checks it ran", evidence: { verdictOk: true, changedFiles: 0, hasSession: true, namedChecks: true, outstanding: false } },
  changedFiles: 0,
});

// ---- Episode B: verified on attempt 2 -------------------------------------------
const B_INTENT = "register v5 storeys in the world carve";
decision({ id: "dec_b1", at: 800000, intent: B_INTENT, title: "Register V5 storeys in the world carve", actionId: "run_201", age: 7200000 });
attempt({ id: "run_201", decisionId: "dec_b1", at: 801000, intent: B_INTENT, title: "Register V5 storeys in the world carve", durationMs: 150000, outcome: "failed", sessionId: "ses_201" });
receipt({
  attemptId: "run_201",
  at: 955000,
  intent: B_INTENT,
  title: "Register V5 storeys in the world carve",
  verdict: { state: "failed", reason: "the run did not report success", evidence: { verdictOk: false, changedFiles: 0, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 0,
});
decision({ id: "dec_b2", at: 1000000, intent: B_INTENT, title: "Register V5 storeys in the world carve", actionId: "run_202", age: 9200000, runFailures: 1 });
attempt({ id: "run_202", decisionId: "dec_b2", at: 1001000, intent: B_INTENT, title: "Register V5 storeys in the world carve", durationMs: 260000, outcome: "reported-done", sessionId: "ses_202" });
receipt({
  attemptId: "run_202",
  at: 1270000,
  intent: B_INTENT,
  title: "Register V5 storeys in the world carve",
  verdict: { state: "verified", reason: "3 changed file(s) in the attempt's session", evidence: { verdictOk: true, changedFiles: 3, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 3,
});

// ---- Episode A (newest — the holdout): four attempts, never trusted-verified ----
const A_INTENT = "restore tar torch and stick catalog descriptions";
const A_TITLE = "Restore tar torch and stick catalog descriptions";
decision({ id: "dec_a1", at: 2000000, intent: A_INTENT, title: A_TITLE, actionId: "run_101", age: 86400000 });
attempt({ id: "run_101", decisionId: "dec_a1", at: 2001000, intent: A_INTENT, title: A_TITLE, durationMs: 240000, outcome: "failed", sessionId: "ses_101" });
receipt({
  attemptId: "run_101",
  at: 2250000,
  intent: A_INTENT,
  title: A_TITLE,
  verdict: { state: "failed", reason: "the run did not report success", evidence: { verdictOk: false, changedFiles: 0, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 0,
});
decision({ id: "dec_a2", at: 2400000, intent: A_INTENT, title: A_TITLE, actionId: "run_102", age: 90600000, runFailures: 1 });
attempt({ id: "run_102", decisionId: "dec_a2", at: 2401000, intent: A_INTENT, title: A_TITLE, durationMs: 300000, outcome: "reported-done", sessionId: "ses_102" });
receipt({
  attemptId: "run_102",
  at: 2710000,
  intent: A_INTENT,
  title: A_TITLE,
  verdict: { state: "unverified", reason: "outstanding obligations remain", evidence: { verdictOk: true, changedFiles: 2, hasSession: true, namedChecks: false, outstanding: true } },
  changedFiles: 2,
  remaining: ["regression test for missing descriptions"],
});
decision({ id: "dec_a3", at: 2900000, intent: A_INTENT, title: A_TITLE, actionId: "run_103", age: 99600000, runFailures: 2 });
attempt({ id: "run_103", decisionId: "dec_a3", at: 2901000, intent: A_INTENT, title: A_TITLE, durationMs: 180000, outcome: "failed", sessionId: "ses_103" });
receipt({
  attemptId: "run_103",
  at: 3090000,
  intent: A_INTENT,
  title: A_TITLE,
  verdict: { state: "failed", reason: "the run did not report success", evidence: { verdictOk: false, changedFiles: 0, hasSession: true, namedChecks: false, outstanding: false } },
  changedFiles: 0,
});
// The paraphrase: different case and punctuation, SAME compact key — the
// board's own identity rule, so it must join the same episode and split.
decision({ id: "dec_a4", at: 3300000, intent: A_INTENT, title: "RESTORE tar-torch and stick catalog descriptions!", actionId: "run_104", age: 103680000, runFailures: 3 });
attempt({ id: "run_104", decisionId: "dec_a4", at: 3301000, intent: A_INTENT, title: "RESTORE tar-torch and stick catalog descriptions!", durationMs: 200000, outcome: "reported-done", sessionId: "ses_104" });
receipt({
  attemptId: "run_104",
  at: 3510000,
  intent: A_INTENT,
  title: "RESTORE tar-torch and stick catalog descriptions!",
  verdict: { state: "verified", reason: "no edits, but the attempt named the checks it ran", evidence: { verdictOk: true, changedFiles: 0, hasSession: true, namedChecks: true, outstanding: false } },
  changedFiles: 0,
});

// Sanity: the paraphrase really is the same intent key (the fixture's premise).
if (intentKeyOf("RESTORE tar-torch and stick catalog descriptions!") !== A_INTENT) {
  throw new Error("fixture premise broken: the paraphrase title must share the intent key");
}

// Write deterministically: the events were built in chronological order
// already, so a stable re-sort only guards against future edits.
events.sort((a, b) => a.at - b.at || a.seq - b.seq);
await mkdir(DIR, { recursive: true });
await writeFile(EXPERIENCE, "");
await writeFile(RECEIPTS, "");
for (const event of events) await appendEvent(EXPERIENCE, event);
for (const receipt of receipts) await appendReceipt(RECEIPTS, receipt);
console.log(`[policy-demo] wrote ${events.length} events and ${receipts.length} receipts to ${DIR}`);
