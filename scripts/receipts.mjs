// Mefi's Studio AI+ — runner-produced verification receipts (build brief PR0).
//
// "The run said done" is a worker's claim. A RECEIPT is the studio's own
// record of what its trusted verification pass observed: which attempt, which
// acceptance specification, which evaluator decided, what evidence existed,
// and what the result was. Receipts are append-only and immutable — the
// learning layer (the Policy Lab) may read them, never write them.
//
// The trust split is the point (build brief, "Verification prerequisite"):
// the board's verifyCompletion() can still settle a card on worker-NAMED
// checks. That is a display/settlement decision. For LEARNING, only
// runner-observed evidence counts as a positive label:
//
//   trust "trusted"      — the runner observed session-attributed file changes
//                          and the acceptance contract was satisfied. A
//                          positive completion label for policy evaluation.
//   trust "self-reported"— the worker's own prose named checks; the runner
//                          observed nothing. NEVER a positive learning label.
//   trust null           — failed, unverified, or missing evidence.
//
// Unknown facts stay unknown: a receipt records null cost fields rather than
// zeroes, so missing telemetry cannot make a policy look efficient.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalHash, intentKeyOf, sha256Hex } from "./policy.mjs";

export const RECEIPT_SCHEMA = 1;

// Different work needs different evidence. The contract names which
// acceptance rules apply; a test-only job may legitimately make zero edits,
// visual/release approval stays an operator decision whatever the checks say.
export const RECEIPT_CONTRACTS = Object.freeze(["implementation", "test-only", "audit", "performance", "visual"]);

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const intOrZero = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);

// The acceptance specification hashed at verification time: what the work
// item owed when the attempt claimed it. The prompt is hashed, not stored —
// exported datasets must not carry chat text or secrets.
export function acceptanceSpec({ title = "", prompt = "", remaining = [] } = {}) {
  const owed = (Array.isArray(remaining) ? remaining : []).filter((item) => typeof item === "string" && item.trim()).map((item) => clipText(item, 120));
  const spec = {
    title: clipText(title, 160),
    promptSha256: sha256Hex(String(prompt ?? "")),
    remaining: owed,
  };
  return { ...spec, sha256: canonicalHash(spec) };
}

// Derive the evidence kind from what the runner actually observed. The worker
// believing it ran checks is evidence about the worker, not about the work.
export function evidenceKind({ state = "", changedFiles = 0, hasSession = false, namedChecks = false } = {}) {
  if (state === "verified" && hasSession && intOrZero(changedFiles) > 0) return "runner-observed-edits";
  if (state === "verified" && namedChecks) return "worker-named-checks";
  return "none";
}

// Build a receipt from the verification pass's own inputs. `verdict` is the
// verifyCompletion() result — the evaluator that decided, versioned by its
// source hash so a changed verifier is a new experimental condition, never a
// silent one. Returns null when the inputs do not identify an attempt.
export function buildReceipt({
  attemptId = null,
  decisionId = null,
  workItem = {},
  contract = "implementation",
  attempt = {},
  verdict = null,
  changedFiles = 0,
  remaining = [],
  evaluator = {},
  now = 0,
} = {}) {
  const runId = clipText(attemptId, 80);
  if (!runId) return null;
  if (!verdict || typeof verdict !== "object" || !verdict.state) return null;
  const title = clipText(workItem.title ?? attempt.title, 160);
  const prompt = String(workItem.prompt ?? "");
  const spec = acceptanceSpec({ title, prompt, remaining });
  const namedChecks = Boolean(verdict.evidence?.namedChecks);
  const kind = evidenceKind({ state: verdict.state, changedFiles, hasSession: Boolean(attempt.sessionId), namedChecks });
  const receipt = {
    schema: RECEIPT_SCHEMA,
    id: `rcp_${sha256Hex(`${runId}|${verdict.state}|${intOrZero(now)}`).slice(0, 16)}`,
    at: intOrZero(now),
    attemptId: runId,
    decisionId: decisionId ? clipText(decisionId, 80) : null,
    workItem: {
      kind: workItem.kind === "request" ? "request" : "task",
      id: clipText(workItem.id, 64) || null,
      intentKey: clipText(workItem.intentKey ?? intentKeyOf(title), 120) || null,
      title,
      contract: RECEIPT_CONTRACTS.includes(contract) ? contract : "implementation",
    },
    acceptance: { sha256: spec.sha256, remaining: spec.remaining },
    evaluator: {
      name: clipText(evaluator.name, 60) || "verifyCompletion",
      version: clipText(evaluator.version, 40) || "1",
      sourceSha256: clipText(evaluator.sourceSha256, 64) || null,
    },
    check: {
      id: "verifyCompletion",
      input: {
        verdictOk: verdict.evidence?.verdictOk === true,
        changedFiles: intOrZero(changedFiles),
        hasSession: Boolean(attempt.sessionId),
        outstanding: Boolean(verdict.evidence?.outstanding),
        namedChecks,
      },
      result: verdict.state,
      reason: clipText(verdict.reason, 200),
    },
    evidence: {
      kind,
      changedFiles: intOrZero(changedFiles),
      sessionId: clipText(attempt.sessionId, 80) || null,
      outstandingObligations: spec.remaining.length,
    },
    // The board's settlement verdict, recorded verbatim. Learning labels come
    // from receiptTrust() below, not from this field.
    result: verdict.state,
    cost: { modelCalls: null, tokens: null, providerCost: null, testExecutions: null },
  };
  receipt.trust = receiptTrust(receipt);
  return receipt;
}

// The learning label. "trusted" requires the runner to have observed the
// evidence itself; a worker's named checks are never a positive label; a
// failed or unproven verdict is never positive either way.
export function receiptTrust(receipt) {
  if (!receipt || receipt.schema !== RECEIPT_SCHEMA) return null;
  if (receipt.result !== "verified") return null;
  if (receipt.evidence?.kind === "runner-observed-edits" && intOrZero(receipt.evidence?.outstandingObligations) === 0) return "trusted";
  if (receipt.evidence?.kind === "worker-named-checks") return "self-reported";
  return null;
}

// Convenience for scoring: the label an evaluation may count.
export function receiptLabel(receipt) {
  const trust = receiptTrust(receipt);
  if (trust === "trusted") return "verified";
  if (trust === "self-reported") return "reported";
  if (!receipt) return null;
  return receipt.result === "failed" ? "failed" : "unverified";
}

// ---- the append-only receipt store ---------------------------------------------
// One JSON line per receipt; appends are serialized per file so concurrent
// verification passes cannot interleave half a line. Duplicate ids (the same
// attempt re-verified after a dwell) are the reader's to reconcile: last wins.

const appendChains = new Map();

export async function appendReceipt(file, receipt) {
  if (!receipt || typeof receipt !== "object") throw new TypeError("appendReceipt: receipt required");
  const prior = appendChains.get(file) ?? Promise.resolve();
  const run = prior.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(receipt)}\n`, "utf8");
  });
  appendChains.set(file, run.catch(() => {}));
  return run;
}

export async function readReceipts(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const receipts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && parsed.schema === RECEIPT_SCHEMA) receipts.push(parsed);
    } catch {
      // A torn tail line (crash mid-append) is skipped, not fatal.
    }
  }
  return receipts;
}

// Receipts by attempt id, last write winning — the runner may re-verify an
// attempt as its evidence matures; the newest observation is the current one.
export function receiptsByAttempt(receipts) {
  const map = new Map();
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (receipt?.attemptId) map.set(receipt.attemptId, receipt);
  }
  return map;
}
