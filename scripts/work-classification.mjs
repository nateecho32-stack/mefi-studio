// Mefi's Studio AI+ — Jev question builders and conservative interpretation.
//
// Pure module: builds the narrowly scoped questions (no network), retrieves
// the comparison candidates a classifier is shown, and maps validated answers
// onto PROPOSED dispositions. Nothing here touches the board, the queue, or
// any store — callers (the shadow intake in main.cjs) record the proposal and
// nothing else.
//
// Rules from the classifier advisory that are structural here:
//  • Each question's prompt names the observation and the candidate IN THE
//    TEXT — the model never sees question ids, so "compare A to B" must name
//    A and B, not point at them.
//  • Retrieval comes first: a classifier can only judge candidates retrieval
//    actually surfaced. Title-key words select the small candidate set;
//    nothing is sent when nothing overlaps.
//  • Categories, not similarity scores: the relationship labels distinguish
//    duplicates from added requirements from unrelated work, and ambiguity
//    resolves to "keep separate" — a confident guess must never merge two
//    obligations or drop one.
//
// Classification is a present-tense judgment; the Policy Lab is what measures
// over time whether acting on these judgments helped. Jev proposes; the
// runtime disposes.

import { intentKeyOf } from "./policy.mjs";

// ---- retrieval: the candidate a classifier may compare against --------------------
// Deterministic keyword retrieval over compact-key tokens (the SAME
// normaliser the board uses). Returns the single best existing item by
// shared-word count, or null when fewer than two meaningful words overlap —
// a near-zero-overlap observation is unrelated often enough that spending a
// classification call to confirm it is waste. Ties keep the store's order.

export function retrieveCandidate({ title, existing = [] } = {}) {
  const tokensOf = (value) => intentKeyOf(value).split(" ").filter((token) => token.length > 2);
  const wanted = new Set(tokensOf(title));
  if (!wanted.size) return null;
  let best = null;
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item?.title) continue;
    const words = tokensOf(item.title);
    const overlap = words.filter((word) => wanted.has(word)).length;
    if (overlap < 2) continue;
    if (!best || overlap > best.overlap) best = { item, overlap };
  }
  return best;
}

export const RELATIONSHIP_OPTIONS = Object.freeze([
  "same_obligation",
  "adds_scope",
  "related_but_distinct",
  "conflicts_with_existing",
  "unrelated",
  "insufficient_context",
]);

export const MESSAGE_KINDS = Object.freeze(["planned_action", "progress", "claimed_resolution", "observed_problem", "explicit_request"]);

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---- question 1: does an incoming observation belong to existing work? ----------

export function relationshipQuestion({ observation = {}, candidate = {} } = {}) {
  const observed = clip(observation.text ?? observation.title, 400);
  const existing = clip(candidate.title, 200);
  const status = clip(candidate.status, 40) || "unknown";
  const owed = Array.isArray(candidate.remaining) ? candidate.remaining.map((item) => clip(item, 120)) : [];
  const prompt = [
    `A NEW OBSERVATION arrived from ${clip(observation.source, 40) || "an unknown source"}: "${observed}".`,
    `An EXISTING work item is already tracked: "${existing}" (status: ${status}${owed.length ? `, still owed: ${owed.join("; ")}` : ""}).`,
    "Decide what the observation is relative to the existing work item:",
    "• same_obligation — the observation describes the very outcome the existing item already owes; it is more evidence for it, not new work.",
    "• adds_scope — the observation names an additional requirement or acceptance condition the existing item does not yet cover.",
    "• related_but_distinct — the observation touches the same subsystem or files but describes a separate obligation that must stay its own work item.",
    "• conflicts_with_existing — the observation contradicts or would undo the existing item's goal.",
    "• unrelated — no meaningful relationship.",
    "• insufficient_context — the state given does not show enough to judge.",
  ].join(" ");
  const stateContext = [
    `observation source: ${clip(observation.source, 40) || "unknown"}`,
    `observation text: ${observed}`,
    `existing title: ${existing}`,
    `existing status: ${status}`,
    owed.length ? `existing outstanding obligations: ${owed.join("; ")}` : "existing outstanding obligations: (none listed)",
  ].join("\n");
  return { question: { id: "observation_relationship", type: "choice", prompt, options: [...RELATIONSHIP_OPTIONS] }, stateContext };
}

// The conservative mapping. Only same_obligation may ever ATTACH the
// observation to existing work (as an observation — never a merge of
// records); only adds_scope may propose a linked follow-up. Everything else
// keeps work separate, including every uncertain answer.
export function interpretRelationship(answer) {
  const choice = answer?.choice;
  switch (choice) {
    case "same_obligation":
      return { action: "attach-observation", mergesRecords: false, reason: "the observation is more evidence for the existing obligation; attach it, do not create work" };
    case "adds_scope":
      return { action: "propose-linked-follow-up", mergesRecords: false, reason: "a new acceptance condition: propose it as a linked follow-up, never expand a claim mid-run" };
    case "related_but_distinct":
      return { action: "keep-separate", mergesRecords: false, reason: "shared vocabulary is not a shared obligation; admit as its own item" };
    case "conflicts_with_existing":
      return { action: "flag-conflict", mergesRecords: false, reason: "route to a human/review path; automation must not resolve the contradiction" };
    case "unrelated":
      return { action: "keep-separate", mergesRecords: false, reason: "no relationship; ordinary admission" };
    default:
      // includes insufficient_context and anything unexpected
      return { action: "hold-for-review", mergesRecords: false, reason: "uncertain classification: preserve the observation for later review" };
  }
}

// ---- question 2: what KIND of agent message is this? ------------------------------

export function messageKindQuestion({ text = "", source = "" } = {}) {
  const message = clip(text, 600);
  const prompt = [
    `An AGENT MESSAGE arrived from ${clip(source, 40) || "an unknown sender"}: "${message}".`,
    "Classify what the message IS (not whether it is true):",
    "• planned_action — the agent says what it intends to do next.",
    "• progress — the agent reports work underway, with no completion claim.",
    "• claimed_resolution — the agent asserts the work is finished or fixed. This is a CLAIM for the verification path to inspect, not a fact.",
    "• observed_problem — the agent reports a problem, failure, or blocker it noticed.",
    "• explicit_request — the agent asks for work to be done or a decision made.",
  ].join(" ");
  const stateContext = `message source: ${clip(source, 40) || "unknown"}\nmessage text: ${message}`;
  return { question: { id: "message_kind", type: "choice", prompt, options: [...MESSAGE_KINDS] }, stateContext };
}

// Routing proposal per kind. A claimed_resolution routes to verification
// evidence — it is never itself proof. An observed_problem attaches to the
// existing intent or enters triage; it never auto-creates a fix.
export function interpretMessageKind(answer) {
  const choice = answer?.choice;
  switch (choice) {
    case "planned_action":
      return { action: "journal", reason: "intent, not outcome: record on the attempt journal" };
    case "progress":
      return { action: "journal", reason: "update the attempt journal" };
    case "claimed_resolution":
      return { action: "route-to-verification", reason: "the claim asks the verification path to inspect evidence; it is not evidence" };
    case "observed_problem":
      return { action: "attach-or-triage", reason: "attach to the existing intent or enter triage; do not auto-file a new job" };
    case "explicit_request":
      return { action: "admit-request", reason: "enter admission under the sender's authorization rules" };
    default:
      return { action: "hold-for-review", reason: "uncertain classification: a human or retry decides" };
  }
}
