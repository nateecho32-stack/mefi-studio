// Mefi's Studio AI+ — the Policy Lab's policy contract (build brief PR1).
//
// A scheduling POLICY here is a validated, bounded configuration plus the one
// fixed decision function in this module — never free-form code loaded into
// Electron's main process. The runtime (main.cjs) computes what is ELIGIBLE
// (dependencies, ownership, machine lease, operator pause); a policy only
// ranks eligible actions and recommends a batch. Operator rules are inputs a
// policy cannot move: a paused executor always yields an empty batch, locked
// (pinned) actions always sort first, and requested concurrency is clamped to
// the maximum the runtime supplied.
//
// The BASELINE policy is a line-for-line port of the ordering that used to
// live inline in main.cjs (taskPriority / workPriority / compareWork), so the
// live ranking is frozen behind an interface with zero behavior change until
// controlled activation ships. tests/policy.test.mjs pins the parity.
//
// Pure module: no Electron, no network, no clock reads (time is injected), so
// the same observation and seed always produce the same decision.

import { createHash } from "node:crypto";
import { compactKey } from "./assistant.mjs";

export const POLICY_SCHEMA = 1;

// ---- the operator's worth bands (NOT learned) --------------------------------------
// Extracted verbatim from main.cjs's taskPriority: the band an action sits in
// is assigned by deterministic rules (who asked, what kind of card it is), and
// every policy — baseline or candidate — receives it as an immutable input.
export const SELF_MAINTENANCE = /^(?:overseer|assistant|a-eyes)\s*:/i;
export const BAND = Object.freeze({ PIN: 5, CHAT: 4, PLAN: 3, EYES: 2, PLAIN: 1, SELF_MAINTENANCE: 0 });

export function baselineTaskPriority(task) {
  const title = String(task?.title ?? "");
  if (SELF_MAINTENANCE.test(title)) return BAND.SELF_MAINTENANCE; // the assistant's own upkeep, last
  if (task?.source === "chat") return BAND.CHAT; // the user asked for this by hand
  if (String(task?.id ?? "").startsWith("task_plan_")) return BAND.PLAN; // a folded plan is real, scoped work
  if (task?.source === "a-eyes" || task?.source === "collision") return BAND.EYES; // briefed/audited/collision work
  return BAND.PLAIN;
}

export function baselineWorkPriority(item) {
  if (item?.pin) return BAND.PIN;
  return baselineTaskPriority(item);
}

// One ordering across the inbox and the board: worth first, then — inside a
// band — the oldest piece of work. Pins break their tie by recency instead.
// main.cjs delegates here (with its inline copy as the load-failure fallback),
// so this function must stay byte-compatible with the frozen live behavior.
export function baselineCompareWork(a, b) {
  const ap = baselineWorkPriority(a);
  const bp = baselineWorkPriority(b);
  if (ap !== bp) return bp - ap;
  if (a?.pin && b?.pin) return (b.pinAt ?? 0) - (a.pinAt ?? 0);
  const aAge = a?.at ?? a?.createdAt ?? a?.updatedAt ?? 0;
  const bAge = b?.at ?? b?.createdAt ?? b?.updatedAt ?? 0;
  return aAge - bAge;
}

// ---- stable identities --------------------------------------------------------

export function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function canonicalHash(value) {
  return sha256Hex(canonicalJson(value));
}

// The identity two paraphrases of one piece of work share. compactKey is the
// SAME normaliser the board's compactor, promotion and executor guards use, so
// "the same work" means one thing across the board and the lab.
export function intentKeyOf(title) {
  return compactKey(title);
}

// Board tasks carry ids; inbox requests do not (their identity is the
// at + prompt pair the claim re-checks), so requests get a deterministic
// fingerprint id for the recorder and the replay tree.
export function workActionId(kind, ref) {
  if (kind === "task" && ref?.id) return String(ref.id);
  const seed = `${ref?.at ?? 0}:${ref?.prompt ?? ref?.title ?? ""}`;
  return `req_${sha256Hex(seed).slice(0, 16)}`;
}

// ---- the observation (what a policy may see) -----------------------------------
// Built from ELIGIBLE actions only, plus the history the policy has already
// been shown (revealed attempt summaries). Pure and idempotent: building the
// same observation twice cannot invent actions or inflate obligations — the
// output is a function of the inputs and nothing else.

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const countOrZero = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);

// One eligible action, masked to the bounded fields a policy may read. No
// outcome, receipt or future field ever appears here.
export function normalizeAction(action) {
  const source = action && typeof action === "object" ? action : {};
  const at = countOrZero(source.at);
  const age = Number.isFinite(Number(source.age)) && Number(source.age) >= 0 ? Math.floor(Number(source.age)) : 0;
  const out = {
    id: clipText(source.id, 64) || `act_${canonicalHash(source).slice(0, 12)}`,
    intentKey: clipText(source.intentKey, 120),
    kind: source.kind === "request" ? "request" : "task",
    title: clipText(source.title, 90),
    band: Math.min(BAND.PIN, Math.max(BAND.SELF_MAINTENANCE, countOrZero(source.band))),
    operatorLocked: source.operatorLocked === true,
    age,
    runFailures: Math.min(99, countOrZero(source.runFailures)),
    failureCategory: ["infra", "task", "verification"].includes(source.failureCategory) ? source.failureCategory : null,
    depth: Math.min(9, countOrZero(source.depth)),
    order: countOrZero(source.order),
  };
  if (source.pinAt) out.pinAt = countOrZero(source.pinAt);
  return out;
}

// Revealed history per intent — only intents whose attempts the policy has
// already been shown. Counts and costs, never outcomes of unselected work.
export function normalizeRevealed(revealed) {
  const source = revealed && typeof revealed === "object" ? revealed : {};
  const out = {};
  for (const [key, row] of Object.entries(source)) {
    if (!row || typeof row !== "object") continue;
    const entry = {
      attempts: countOrZero(row.attempts),
      failures: countOrZero(row.failures),
      trustedVerified: row.trustedVerified === true,
      spentMs: countOrZero(row.spentMs),
    };
    if (entry.attempts || entry.failures || entry.trustedVerified || entry.spentMs) out[clipText(key, 120)] = entry;
  }
  return out;
}

export function normalizeLimits(limits) {
  const source = limits && typeof limits === "object" ? limits : {};
  return {
    maxConcurrency: Math.min(12, Math.max(1, countOrZero(source.maxConcurrency) || 1)),
    paused: source.paused === true,
    machineBusy: source.machineBusy === true,
  };
}

export function buildObservation({ projectId = "studio", episodeId = null, decisionId = null, at = 0, actions = [], revealed = {}, limits = {}, maxActions = 40 } = {}) {
  const list = (Array.isArray(actions) ? actions : []).map(normalizeAction).slice(0, maxActions);
  return Object.freeze({
    schema: POLICY_SCHEMA,
    projectId: clipText(projectId, 64),
    episodeId: episodeId ? clipText(episodeId, 140) : null,
    decisionId: decisionId ? clipText(decisionId, 80) : null,
    at: countOrZero(at),
    actions: Object.freeze(list),
    revealed: Object.freeze(normalizeRevealed(revealed)),
    limits: Object.freeze(normalizeLimits(limits)),
  });
}

// ---- policy definitions --------------------------------------------------------

// The allowlisted tunables. Everything else a policy might want to touch is
// either an operator rule (not offered) or not exposed in the observation.
// Bounded numerics + allowlisted enums only; validatePolicyConfig enforces the
// clamps and rejects unknown keys so a candidate can never smuggle a rule in.
export const POLICY_CONFIG_SPEC = Object.freeze({
  withinBandOrder: Object.freeze({ enum: Object.freeze(["age", "failures-then-age", "stable"]), default: "age" }),
  failureSlipBands: Object.freeze({ min: 0, max: 2, step: 1, default: 0 }),
  maxAttemptsPerIntent: Object.freeze({ min: 0, max: 5, step: 1, default: 0 }), // 0 = unlimited (baseline)
  concurrency: Object.freeze({ min: 1, max: 4, step: 1, default: 1 }),
});

export const BASELINE_POLICY = Object.freeze({
  schema: POLICY_SCHEMA,
  id: "baseline",
  version: 1,
  kind: "baseline",
  config: Object.freeze({
    withinBandOrder: "age",
    failureSlipBands: 0,
    maxAttemptsPerIntent: 0,
    concurrency: 1,
  }),
});

export function validatePolicyConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const errors = [];
  for (const key of Object.keys(source)) {
    if (!POLICY_CONFIG_SPEC[key]) errors.push(`unknown tunable "${key}"`);
  }
  const out = {};
  for (const [key, spec] of Object.entries(POLICY_CONFIG_SPEC)) {
    const value = source[key];
    if (spec.enum) {
      if (value === undefined) out[key] = spec.default;
      else if (!spec.enum.includes(value)) errors.push(`"${key}" must be one of ${spec.enum.join(", ")}`);
      else out[key] = value;
      continue;
    }
    if (value === undefined) {
      out[key] = spec.default;
      continue;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || Math.floor(num) !== num) {
      errors.push(`"${key}" must be an integer`);
      out[key] = spec.default;
      continue;
    }
    if (num < spec.min || num > spec.max || (num - spec.min) % spec.step !== 0) {
      errors.push(`"${key}" must be within [${spec.min}, ${spec.max}] in steps of ${spec.step}`);
      out[key] = spec.default;
      continue;
    }
    out[key] = num;
  }
  return { ok: errors.length === 0, config: out, errors };
}

export function policyIdentity(policy) {
  const source = policy && typeof policy === "object" ? policy : {};
  const kind = source.kind === "baseline" ? "baseline" : "config";
  if (kind === "baseline") {
    return Object.freeze({
      id: BASELINE_POLICY.id,
      version: BASELINE_POLICY.version,
      kind,
      config: BASELINE_POLICY.config,
      hash: canonicalHash({ id: BASELINE_POLICY.id, version: BASELINE_POLICY.version, kind, config: BASELINE_POLICY.config }),
    });
  }
  const validated = validatePolicyConfig(source.config);
  if (!validated.ok) throw new Error(`invalid policy config: ${validated.errors.join("; ")}`);
  const id = clipText(source.id, 48) || `config-${canonicalHash(validated.config).slice(0, 8)}`;
  const version = Math.max(1, countOrZero(source.version) || 1);
  return Object.freeze({
    id,
    version,
    kind,
    config: Object.freeze(validated.config),
    hash: canonicalHash({ id, version, kind, config: validated.config }),
  });
}

export function defineConfigPolicy(id, config) {
  const identity = policyIdentity({ id, version: 1, kind: "config", config });
  return Object.freeze({ schema: POLICY_SCHEMA, id: identity.id, version: identity.version, kind: "config", config: identity.config, hash: identity.hash });
}

// ---- the decision function -----------------------------------------------------
// The ONE code path every policy runs, baseline and candidates alike. Same
// observation + same policy identity ⇒ same decision, always: no clock, no
// randomness, stable tie-breaks (recorded order last).

export function decide(policy, observation) {
  const identity = policyIdentity(policy);
  const config = identity.config;
  const limits = normalizeLimits(observation?.limits);
  const actions = (Array.isArray(observation?.actions) ? observation.actions : []).map(normalizeAction);
  if (limits.paused) {
    return { schema: POLICY_SCHEMA, policyId: identity.id, policyHash: identity.hash, order: [], batch: [], concurrency: 0, reason: "operator-pause" };
  }
  // Operator locks first, always, in the operator's own order (newest pin
  // first) — no tunable can bury a pinned card.
  const locked = actions.filter((action) => action.operatorLocked).sort((a, b) => (b.pinAt ?? 0) - (a.pinAt ?? 0) || a.order - b.order);
  const unlocked = actions.filter((action) => !action.operatorLocked);
  const revealed = normalizeRevealed(observation?.revealed);
  const slip = Math.min(POLICY_CONFIG_SPEC.failureSlipBands.max, Math.max(0, config.failureSlipBands));
  const cap = config.maxAttemptsPerIntent > 0 ? config.maxAttemptsPerIntent : Number.POSITIVE_INFINITY;
  const rankKey = (action) => {
    const hasFailures = action.runFailures > 0 || (revealed[action.intentKey]?.failures ?? 0) > 0 ? 1 : 0;
    return Math.min(BAND.PIN, action.band - slip * hasFailures);
  };
  const withinBand = (a, b) => {
    // Age is now-minus-created, so "oldest first" (compareWork's ascending
    // timestamp sort) is DESCENDING age — the trap the parity test pins.
    if (config.withinBandOrder === "failures-then-age") {
      const af = a.runFailures + (revealed[a.intentKey]?.failures ?? 0);
      const bf = b.runFailures + (revealed[b.intentKey]?.failures ?? 0);
      if (af !== bf) return af - bf;
      if (a.age !== b.age) return b.age - a.age;
      return a.order - b.order;
    }
    if (config.withinBandOrder === "stable") return a.order - b.order;
    if (a.age !== b.age) return b.age - a.age; // baseline: oldest first inside a band
    return a.order - b.order;
  };
  const sorted = unlocked.sort((a, b) => rankKey(b) - rankKey(a) || withinBand(a, b));
  // A retry-capped action stays VISIBLE (order) but is demoted past every
  // other unlocked action; when only capped work remains the honest answer is
  // an empty batch — stop retrying, leave the obligation outstanding.
  const capped = (action) => (revealed[action.intentKey]?.attempts ?? 0) >= cap;
  const notCapped = sorted.filter((action) => !capped(action));
  const cappedOnly = sorted.filter(capped);
  const order = [...locked, ...notCapped, ...cappedOnly].map((action) => action.id);
  if (notCapped.length === 0 && locked.length === 0) {
    return { schema: POLICY_SCHEMA, policyId: identity.id, policyHash: identity.hash, order, batch: [], concurrency: 0, reason: cappedOnly.length ? "retry-budget-exhausted" : "no-eligible-action" };
  }
  const batch = [order[0]];
  return {
    schema: POLICY_SCHEMA,
    policyId: identity.id,
    policyHash: identity.hash,
    order,
    batch,
    concurrency: Math.min(config.concurrency, limits.maxConcurrency),
    reason: locked.length ? "operator-pin" : `band-rank:${config.withinBandOrder}`,
  };
}
