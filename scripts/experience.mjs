// Mefi's Studio AI+ — the Policy Lab's experience store (build brief PR1).
//
// An APPEND-ONLY event log beside the task board: what was known (decision
// observations), what was chosen (attempts and their lineage), and what
// happened (outcomes, receipts, costs). The board is live state — cards get
// claimed, merged, archived, hidden. Experience is experiment truth: clearing
// a card, compacting the queue or tidying the house must never erase the
// history policies are evaluated on, which is why it lives in its own
// data/policy-lab/ store nothing else writes.
//
// Cost honesty: unknown telemetry is recorded as null and counted as unknown,
// never zero. A child handoff's attempt joins its parent's episode, so the
// whole chain's cost is charged to the root goal — delegation cannot hide
// unfinished work or cost.
//
// Pure module: file appends are serialized per path, reads tolerate a torn
// tail line, and no function here mutates the board stores.

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalHash, intentKeyOf } from "./policy.mjs";
import { receiptsByAttempt, receiptTrust } from "./receipts.mjs";

export const EVENT_KINDS = Object.freeze(["decision", "attempt-start", "attempt-finish", "verification", "jev-proposal"]);

export const EXPERIENCE_SCHEMA = 1;

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const intOrZero = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// ---- event validation -----------------------------------------------------------

const REQUIRED = Object.freeze({
  decision: ["decisionId", "policy", "observation"],
  "attempt-start": ["attemptId", "intentKey", "workItem"],
  "attempt-finish": ["attemptId", "intentKey", "outcome"],
  verification: ["attemptId", "receiptId", "state"],
  // The Jev shadow intake's proposal: what was compared, what the classifier
  // answered, and the conservative action it PROPOSED (never applied).
  "jev-proposal": ["proposalId", "observation", "candidate", "question", "answer", "proposedAction"],
});

export function validateEvent(event) {
  if (!isPlainObject(event)) return { ok: false, errors: ["event must be an object"] };
  const errors = [];
  if (event.schema !== EXPERIENCE_SCHEMA) errors.push(`schema must be ${EXPERIENCE_SCHEMA}`);
  if (!EVENT_KINDS.includes(event.kind)) errors.push(`kind must be one of ${EVENT_KINDS.join(", ")}`);
  if (!Number.isFinite(Number(event.at)) || Number(event.at) < 0) errors.push("at must be a non-negative number");
  for (const field of REQUIRED[event.kind] ?? []) {
    if (event[field] === undefined || event[field] === null || event[field] === "") errors.push(`${event.kind}: missing "${field}"`);
  }
  if (event.kind === "decision") {
    if (!isPlainObject(event.policy) || !event.policy.id || !event.policy.hash) errors.push("decision: policy identity (id + hash) required");
    if (!isPlainObject(event.observation) || !Array.isArray(event.observation.actions)) errors.push("decision: observation.actions required");
  }
  if (event.kind === "attempt-finish" && !["reported-done", "failed"].includes(event.outcome)) {
    errors.push('attempt-finish: outcome must be "reported-done" or "failed"');
  }
  if (event.kind === "verification" && !["verified", "unverified", "failed"].includes(event.state)) {
    errors.push('verification: state must be verified, unverified or failed');
  }
  if (event.kind === "jev-proposal" && (typeof event.answer !== "string" || typeof event.proposedAction !== "string")) {
    errors.push("jev-proposal: answer and proposedAction must be strings");
  }
  return { ok: errors.length === 0, errors };
}

// ---- the append-only store ------------------------------------------------------

const appendChains = new Map();

export async function appendEvent(file, event) {
  const check = validateEvent(event);
  if (!check.ok) throw new Error(`experience event rejected: ${check.errors.join("; ")}`);
  const prior = appendChains.get(file) ?? Promise.resolve();
  const run = prior.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  });
  appendChains.set(file, run.catch(() => {}));
  return run;
}

export async function readEvents(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (validateEvent(parsed).ok) events.push(parsed);
    } catch {
      // A torn tail line (crash mid-append) is skipped, not fatal.
    }
  }
  return events;
}

// ---- episode construction ------------------------------------------------------
// An episode is one root goal's attempt tree: retries of the same intent AND
// handed-off children (different intent, linked by the spawning run) belong to
// the same root, so evaluation splits by whole problem, never by attempt.
// Lineage sources are explicit and recorded:
//   "fromRun"     — the handoff request carried the spawning run id.
//   "parentTitle" — a promoted handoff kept only the parent's title; it links
//                   by the shared intent key of that title (heuristic, marked).
//   "retry"       — same intent key, no parent: a fresh claim of the same work.
//   "root"        — a new goal.

function attemptTreeParentId(attempt, previousByIntent, previousByAttempt) {
  if (attempt.parentAttemptId && previousByAttempt.has(attempt.parentAttemptId)) {
    return { treeParentId: attempt.parentAttemptId, lineageSource: "fromRun" };
  }
  if (attempt.parentTitleKey && previousByIntent.has(attempt.parentTitleKey)) {
    return { treeParentId: previousByIntent.get(attempt.parentTitleKey), lineageSource: "parentTitle" };
  }
  if (previousByIntent.has(attempt.intentKey)) {
    return { treeParentId: previousByIntent.get(attempt.intentKey), lineageSource: "retry" };
  }
  return { treeParentId: null, lineageSource: "root" };
}

export function buildEpisodes(events, { receipts = [] } = {}) {
  const byAttempt = receiptsByAttempt(receipts);
  const attempts = new Map(); // attemptId -> working node
  const decisions = new Map(); // decisionId -> decision event
  for (const event of Array.isArray(events) ? events : []) {
    if (!isPlainObject(event)) continue;
    if (event.kind === "decision" && event.decisionId) decisions.set(event.decisionId, event);
    if (event.kind === "attempt-start") {
      const id = clipText(event.attemptId, 80);
      if (!id) continue;
      attempts.set(id, {
        attemptId: id,
        decisionId: event.decisionId ? clipText(event.decisionId, 80) : null,
        parentAttemptId: event.parentAttemptId ? clipText(event.parentAttemptId, 80) : null,
        parentTitleKey: event.parentTitle ? intentKeyOf(event.parentTitle) : null,
        intentKey: clipText(event.intentKey, 120),
        workItem: isPlainObject(event.workItem) ? event.workItem : {},
        actionId: clipText(event.actionId, 64) || null,
        depth: intOrZero(event.depth),
        at: intOrZero(event.at),
        outcome: null,
        verification: null,
        handoffs: [],
        result: null,
        cost: null,
        treeParentId: null,
        lineageSource: "root",
        action: null,
      });
    }
  }
  const trustOf = (attemptId) => {
    const receipt = byAttempt.get(attemptId);
    return receipt ? receiptTrust(receipt) : null;
  };
  for (const event of Array.isArray(events) ? events : []) {
    if (!isPlainObject(event)) continue;
    if (event.kind === "attempt-finish") {
      const node = attempts.get(clipText(event.attemptId, 80));
      if (!node) continue;
      node.outcome = event.outcome === "reported-done" ? "reported-done" : "failed";
      node.exitCode = Number.isFinite(Number(event.exitCode)) ? Number(event.exitCode) : null;
      node.sawDone = event.sawDone === true;
      node.sessionId = event.sessionId ? clipText(event.sessionId, 80) : null;
      node.durationMs = Number.isFinite(Number(event.durationMs)) && Number(event.durationMs) >= 0 ? Math.floor(Number(event.durationMs)) : null;
      node.handoffs = (Array.isArray(event.handoffs) ? event.handoffs : [])
        .filter((item) => isPlainObject(item) && item.title)
        .map((item) => ({ title: clipText(item.title, 90), intentKey: clipText(item.intentKey, 120) || intentKeyOf(item.title) }));
      node.result = isPlainObject(event.result) ? event.result : null;
      node.cost = isPlainObject(event.cost) ? event.cost : null;
    }
    if (event.kind === "verification") {
      const node = attempts.get(clipText(event.attemptId, 80));
      if (!node) continue;
      const receipt = byAttempt.get(node.attemptId);
      node.verification = {
        state: event.state,
        trust: receipt ? receiptTrust(receipt) : event.trust === "trusted" || event.trust === "self-reported" ? event.trust : null,
        receiptId: clipText(event.receiptId, 40),
        remaining: Array.isArray(event.remaining) ? event.remaining.map((item) => clipText(item, 120)) : [],
        at: intOrZero(event.at),
      };
    }
  }
  // The action descriptor each policy saw when the attempt was chosen, from
  // the attempt's own decision event (fallback: a minimal descriptor from the
  // work item — marked order 0, band 1, age 0).
  for (const node of attempts.values()) {
    const decision = node.decisionId ? decisions.get(node.decisionId) : null;
    const actions = decision?.observation?.actions ?? [];
    const match = actions.find((action) => action && (node.actionId ? action.id === node.actionId : intentKeyOf(action.title ?? "") === node.intentKey));
    node.action = match
      ? { ...match }
      : {
          id: node.actionId ?? node.attemptId,
          intentKey: node.intentKey,
          kind: node.workItem.kind === "request" ? "request" : "task",
          title: clipText(node.workItem.title, 90),
          band: 1,
          operatorLocked: false,
          age: 0,
          runFailures: 0,
          failureCategory: null,
          depth: node.depth,
          order: 0,
        };
  }
  // Chronological walk assigns episodes + retry/handoff tree edges.
  const ordered = [...attempts.values()].sort((a, b) => a.at - b.at || (a.attemptId < b.attemptId ? -1 : 1));
  const episodes = new Map(); // episodeId -> episode
  const episodeByAttempt = new Map();
  const previousByIntent = new Map();
  for (const node of ordered) {
    const link = attemptTreeParentId(node, previousByIntent, attempts);
    node.treeParentId = link.treeParentId;
    node.lineageSource = link.lineageSource;
    previousByIntent.set(node.intentKey, node.attemptId);
    let episode = link.treeParentId ? episodeByAttempt.get(link.treeParentId) : undefined;
    if (!episode) {
      const episodeId = `ep_${clipText(node.intentKey, 60) || node.attemptId}`;
      episode = episodes.get(episodeId) ?? null;
      if (!episode) {
        episode = { episodeId, rootIntentKey: node.intentKey, startedAt: node.at, lastAt: node.at, attempts: [], nodes: new Map() };
        episodes.set(episodeId, episode);
      }
    }
    episode.attempts.push(node.attemptId);
    episode.nodes.set(node.attemptId, node);
    episode.lastAt = Math.max(episode.lastAt, node.at);
    episodeByAttempt.set(node.attemptId, episode);
  }
  const out = [];
  for (const episode of episodes.values()) {
    const nodes = episode.attempts.map((id) => episode.nodes.get(id));
    const intents = [...new Set(nodes.map((node) => node.intentKey))];
    const trustedIntents = new Set(nodes.filter((node) => node.verification?.trust === "trusted").map((node) => node.intentKey));
    const reportedIntents = new Set(
      nodes.filter((node) => node.verification?.trust === "self-reported").map((node) => node.intentKey).filter((key) => !trustedIntents.has(key))
    );
    const costMs = nodes.reduce((sum, node) => sum + (node.cost?.durationMs ?? node.durationMs ?? 0), 0);
    const unknownCosts = nodes.filter((node) => (node.cost ? node.cost.durationMs === null || node.cost.durationMs === undefined : node.durationMs === null)).length;
    out.push({
      episodeId: episode.episodeId,
      rootIntentKey: episode.rootIntentKey,
      startedAt: episode.startedAt,
      lastAt: episode.lastAt,
      intents,
      attemptIds: episode.attempts,
      nodes,
      roots: nodes.filter((node) => !node.treeParentId).map((node) => node.attemptId),
      terminal: {
        trustedIntents: [...trustedIntents],
        reportedIntents: [...reportedIntents],
        unresolvedIntents: intents.filter((key) => !trustedIntents.has(key)),
      },
      costMs,
      unknownCosts,
    });
  }
  out.sort((a, b) => a.startedAt - b.startedAt || (a.episodeId < b.episodeId ? -1 : 1));
  return out;
}

// ---- evaluation splits ----------------------------------------------------------
// Whole root intents move together: every attempt, handoff descendant and
// paraphrase of one problem shares its episode, so a differently-worded copy
// of a training problem can never appear in the holdout. Chronological split:
// train on the past, hold out the newest third (at least one episode once
// there are two).

export function splitEpisodes(episodes, { holdoutFraction = 1 / 3 } = {}) {
  const sorted = [...(Array.isArray(episodes) ? episodes : [])].sort((a, b) => a.startedAt - b.startedAt || (a.episodeId < b.episodeId ? -1 : 1));
  const fraction = Math.min(0.5, Math.max(0, Number(holdoutFraction) || 0));
  const holdoutCount = sorted.length >= 2 ? Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * fraction))) : 0;
  const train = sorted.slice(0, sorted.length - holdoutCount);
  const holdout = sorted.slice(sorted.length - holdoutCount);
  // Paraphrase safety net: identical root intent keys cannot sit on both
  // sides. buildEpisodes already groups them into one episode; this asserts
  // the invariant rather than silently repairing a caller's hand-built split.
  const trainRoots = new Set(train.map((episode) => episode.rootIntentKey));
  for (const episode of holdout) {
    if (trainRoots.has(episode.rootIntentKey)) throw new Error(`split leak: "${episode.rootIntentKey}" appears in both train and holdout`);
  }
  return { train, holdout };
}

// ---- dataset export -------------------------------------------------------------
// A read-only snapshot for offline evaluation. Events already store hashes,
// not prompt bodies; the export additionally drops nothing but adds a content
// hash, and NEVER writes back — repairing a corrupted export regenerates it
// from the store; it cannot modify experiment truth.

export function exportDataset(events, receipts = []) {
  const eventsClone = structuredClone(Array.isArray(events) ? events : []);
  const receiptsClone = structuredClone(Array.isArray(receipts) ? receipts : []);
  const dataset = {
    schema: EXPERIENCE_SCHEMA,
    events: eventsClone,
    receipts: receiptsClone,
  };
  return { ...dataset, datasetHash: canonicalHash({ events: eventsClone, receipts: receiptsClone }) };
}

// ---- the global improvement budget ----------------------------------------------
// Every policy-development resource spend — candidate generation calls, live
// validation runs — is charged to ONE ledger next to the experience store, so
// "self-improvement" has a visible price. PR2's offline replay spends nothing;
// the ledger exists so later stages cannot quietly lose the accounting.

export const BUDGET_SCHEMA = 1;

export async function readBudget(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (isPlainObject(parsed) && parsed.schema === BUDGET_SCHEMA) return parsed;
  } catch {}
  return { schema: BUDGET_SCHEMA, spent: { modelCalls: 0, tokens: 0, providerCost: 0 }, entries: [] };
}

export async function spendBudget(file, { purpose = "", modelCalls = 0, tokens = 0, providerCost = 0, note = "", now = 0 } = {}) {
  const budget = await readBudget(file);
  const entry = {
    at: intOrZero(now) || Date.now(),
    purpose: clipText(purpose, 80),
    modelCalls: intOrZero(modelCalls),
    tokens: intOrZero(tokens),
    providerCost: Number(providerCost) || 0,
    note: clipText(note, 160),
  };
  const next = {
    schema: BUDGET_SCHEMA,
    spent: {
      modelCalls: intOrZero(budget.spent?.modelCalls) + entry.modelCalls,
      tokens: intOrZero(budget.spent?.tokens) + entry.tokens,
      providerCost: (Number(budget.spent?.providerCost) || 0) + entry.providerCost,
    },
    entries: [...(Array.isArray(budget.entries) ? budget.entries : []).slice(-199), entry],
  };
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  try {
    await rename(tmp, file);
  } catch {
    await writeFile(file, JSON.stringify(next, null, 2));
  }
  return next;
}
