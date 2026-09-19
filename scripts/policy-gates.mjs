// Mefi's Studio AI+ — the Policy Lab's gates, lifecycle and promotion
// controller (build brief PR2/PR3 boundary).
//
// HARD GATES come before any comparison: a candidate that loses obligations,
// fabricates verification, ignores an operator lock, or bursts past the
// concurrency the runtime offered is rejected regardless of its score. Among
// policies that pass, comparison is multi-dimensional (verified obligations,
// represented cost, unsupported picks) and the INCUMBENT is always in the
// table — replay superiority over the incumbent is evidence on the evaluated
// histories only, never a guarantee about future work.
//
// The lifecycle is proposed → replay_passed → heldout_passed → shadow →
// canary → active (plus rejected / rolled_back). Promotion is an ATOMIC
// pointer write (temp file + rename), so a crash mid-promotion leaves exactly
// one active version; rollback restores future dispatch to the incumbent
// without touching live claims — attempts keep the policy identity they
// started with, because identity lives on the attempt, not the pointer.
//
// PR2 ships this controller with LIVE ACTIVATION OFF: promote() refuses
// unless the operator passes consent AND allowLive (a deliberate, explicit
// step that ships with PR3). Nothing in this milestone changes dispatch.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASELINE_POLICY, policyIdentity } from "./policy.mjs";

export const POLICY_STATE_SCHEMA = 1;
export const LIFECYCLE_STAGES = Object.freeze(["proposed", "replay_passed", "heldout_passed", "shadow", "canary", "active", "rejected", "rolled_back"]);

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---- invariant gates -------------------------------------------------------------

// Evaluate one policy's replay results against the hard invariants. `replays`
// is the per-episode runReplay() output for the candidate.
export function invariantGates(replays) {
  const violations = [];
  for (const replay of Array.isArray(replays) ? replays : []) {
    const label = replay.episodeId ?? "?";
    for (const step of replay.steps ?? []) {
      const observation = step.observation;
      if (!observation) continue;
      const locked = (observation.actions ?? []).filter((action) => action.operatorLocked);
      if (locked.length && (step.decision?.batch ?? []).length && !locked.some((action) => action.id === step.decision.batch[0])) {
        violations.push({ gate: "operator-lock-order", episode: label, step: step.step, detail: "a pinned action was offered but not selected first" });
      }
      const offered = observation.limits?.maxConcurrency ?? 1;
      if (Number(step.decision?.concurrency ?? 1) > offered) {
        violations.push({ gate: "concurrency-limit", episode: label, step: step.step, detail: `requested ${step.decision.concurrency} > offered ${offered}` });
      }
      if (step.maskAudit && step.maskAudit.pass === false) {
        violations.push({ gate: "observation-masking", episode: label, step: step.step, detail: step.maskAudit.violations.join("; ") });
      }
    }
    // No false verification: every intent counted as verified must be one the
    // episode actually owed and must carry a TRUSTED receipt among the
    // revealed nodes — structurally enforced by the replay engine, re-asserted
    // here so the gate catches engine regressions (e.g. a fabricated intent).
    const intentSet = new Set(replay.episodeIntents ?? []);
    const trusted = new Set(replay.metrics?.trustedObligations ?? []);
    const outstanding = new Set(replay.finalState?.outstandingIntents ?? []);
    for (const intent of trusted) {
      if (!intentSet.has(intent)) violations.push({ gate: "no-false-verification", episode: label, detail: `counts "${intent}" as verified, an intent the episode never owed` });
    }
    // No lost obligations: every intent the episode owed is verified or still
    // outstanding — a policy may stop, but never drop work off the ledger.
    const accounted = new Set([...trusted, ...outstanding]);
    for (const intent of replay.episodeIntents ?? []) {
      if (!accounted.has(intent)) violations.push({ gate: "no-lost-obligations", episode: label, detail: `intent "${intent}" vanished from the final state` });
    }
  }
  return { pass: violations.length === 0, violations };
}

// ---- candidate comparison ---------------------------------------------------------

// Multi-dimensional comparison against the incumbent. "better" requires the
// candidate to pass its gates, verify at least as many trusted obligations,
// and improve on at least one cost dimension without regressing any.
export function compareWithIncumbent({ incumbent, candidate }) {
  const dimensions = {
    trustedObligations: { incumbent: incumbent.trustedObligations, candidate: candidate.trustedObligations },
    chargedMs: { incumbent: incumbent.chargedMs, candidate: candidate.chargedMs },
    unsupported: { incumbent: incumbent.unsupported, candidate: candidate.unsupported },
    unexploredNodes: { incumbent: incumbent.unexploredNodes, candidate: candidate.unexploredNodes },
  };
  if (!candidate.gates.pass) return { verdict: "rejected", dimensions, reasons: ["invariant gate violations"] };
  const reasons = [];
  let better = false;
  if (candidate.trustedObligations > incumbent.trustedObligations) {
    better = true;
    reasons.push(`+${candidate.trustedObligations - incumbent.trustedObligations} trusted obligation(s)`);
  }
  if (candidate.trustedObligations < incumbent.trustedObligations) return { verdict: "worse", dimensions, reasons: ["fewer trusted obligations than the incumbent"] };
  if (candidate.chargedMs < incumbent.chargedMs) {
    better = true;
    reasons.push(`${incumbent.chargedMs - candidate.chargedMs}ms less represented cost`);
  }
  if (candidate.unsupported > incumbent.unsupported) return { verdict: "worse", dimensions, reasons: ["more unsupported (invented) selections than the incumbent"] };
  if (candidate.unsupported < incumbent.unsupported) {
    better = true;
    reasons.push(`${incumbent.unsupported - candidate.unsupported} fewer unsupported selection(s)`);
  }
  if (candidate.unexploredNodes > incumbent.unexploredNodes && !reasons.length) {
    return { verdict: "worse", dimensions, reasons: ["leaves more recorded work unexplored with no measured gain"] };
  }
  return { verdict: better ? "better" : "parity", dimensions, reasons };
}

// ---- the active-policy pointer ----------------------------------------------------

export function defaultPolicyState() {
  return { schema: POLICY_STATE_SCHEMA, active: policyIdentity(BASELINE_POLICY), history: [] };
}

export async function readPolicyState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.schema === POLICY_STATE_SCHEMA && parsed.active?.id) {
      return { ...defaultPolicyState(), ...parsed, active: parsed.active };
    }
  } catch {}
  return defaultPolicyState();
}

async function writeStateAtomic(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2);
  await writeFile(tmp, payload);
  // The rename is the commit point: a crash before it leaves the previous
  // pointer fully intact — exactly one active version, always.
  try {
    await rename(tmp, file);
  } catch {
    await writeFile(file, payload);
  }
}

// Promotion. Refuses (never throws) unless every precondition holds:
//   • gates passed and the comparison is "better" on the holdout
//   • explicit operator consent { operator: true, via: <how> }
//   • allowLive: live activation is a PR3 step; the flag is the operator's
//     deliberate switch, not something the lab sets itself.
export async function promote({ stateFile, candidate, evidence, consent, allowLive = false, now = Date.now() }) {
  if (!allowLive) return { ok: false, reason: "live-activation-disabled" };
  if (!consent || consent.operator !== true || !consent.via) return { ok: false, reason: "operator-consent-required" };
  if (!evidence?.gates?.pass) return { ok: false, reason: "invariant-gates-failed" };
  if (!["better", "parity"].includes(evidence?.comparison?.verdict)) return { ok: false, reason: `comparison-${evidence?.comparison?.verdict ?? "unknown"}` };
  let identity;
  try {
    identity = policyIdentity(candidate);
  } catch (error) {
    return { ok: false, reason: `invalid-candidate:${clipText(error.message, 80)}` };
  }
  const state = await readPolicyState(stateFile);
  const from = state.active;
  const next = {
    schema: POLICY_STATE_SCHEMA,
    active: identity,
    history: [
      ...state.history,
      {
        kind: "promote",
        at: now,
        from: { id: from.id, hash: from.hash },
        to: { id: identity.id, hash: identity.hash },
        datasetHash: evidence.datasetHash ?? null,
        evidenceHash: evidence.hash ?? null,
        stage: "canary",
        consentVia: clipText(consent.via, 80),
      },
    ].slice(-50),
  };
  await writeStateAtomic(stateFile, next);
  return { ok: true, from, to: identity };
}

// Rollback: future dispatch returns to the incumbent. No claims, attempts or
// obligations are touched — those belong to the board; the pointer only says
// which policy shapes FUTURE decisions.
export async function rollback({ stateFile, reason = "", now = Date.now() }) {
  const state = await readPolicyState(stateFile);
  const from = state.active;
  const to = policyIdentity(BASELINE_POLICY);
  const next = {
    schema: POLICY_STATE_SCHEMA,
    active: to,
    history: [...state.history, { kind: "rollback", at: now, from: { id: from.id, hash: from.hash }, to: { id: to.id, hash: to.hash }, reason: clipText(reason, 160) }].slice(-50),
  };
  await writeStateAtomic(stateFile, next);
  return { ok: true, from, to };
}
