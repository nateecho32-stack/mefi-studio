"use strict";
// Per-provider setups: when a subscription is the only one set up, the Studio
// picks each tier's model for it, so nobody has to choose one by hand. The
// owner's rules (2026-10-07): every role starts at low effort; Opus 5.5 takes
// big tasks and planning, Sonnet 5.5 changes, Haiku 5.5 tasks and routine work;
// a stuck job moves up a tier (scripts/model-ladder.cjs), never sideways.
//
// Only providers whose model ids are verified are listed. A provider with no
// entry gets no automatic setup, and the owner picks its models as before.
//
// Pure module: no Electron, no filesystem, no network.

const TIERS = Object.freeze(["heavy", "routine", "quick"]);

// tier -> model id, per provider. "heavy" is Opus 5.5 (big tasks, planning),
// "routine" Sonnet 5.5 (changes), "quick" Haiku 5.5 (tasks and routine work).
const PROVIDER_TIERS = Object.freeze({
  claude: Object.freeze({ heavy: "claude-opus-5-5", routine: "claude-sonnet-5-5", quick: "claude-haiku-5-5" }),
});

// Effort every tier starts at. Escalation goes up a model tier first, and
// effort only rises on the top tier (scripts/model-ladder.cjs builderStep).
const START_EFFORT = Object.freeze({ heavy: "low", routine: "low", quick: "low" });

// The tier models for one provider, or null when no verified map exists.
function tierModelsFor(provider) {
  const map = Object.prototype.hasOwnProperty.call(PROVIDER_TIERS, provider) ? PROVIDER_TIERS[provider] : null;
  return map ? { ...map } : null;
}

// Which providers are set up. `configured` is a list of provider ids the host
// has a working login or key for. The automatic setup applies only when exactly
// one provider is configured and it has a verified tier map.
function singleSetupProvider(configured = []) {
  const list = [...new Set((Array.isArray(configured) ? configured : []).filter((id) => typeof id === "string" && id))];
  if (list.length !== 1) return null;
  return tierModelsFor(list[0]) ? list[0] : null;
}

// The per-tier plan for a provider: model and starting effort for each tier.
// Null when there is nothing verified to pick.
function planFor(provider) {
  const models = tierModelsFor(provider);
  if (!models) return null;
  return Object.fromEntries(TIERS.map((tier) => [tier, { model: models[tier], effort: START_EFFORT[tier] }]));
}

// Which tier each seat uses: the lead, desk and overseer think hard (heavy), and
// the companion and scout do quick work (quick).
const SEAT_TIER = Object.freeze({ lead: "heavy", desk: "heavy", overseer: "heavy", companion: "quick", scout: "quick" });

// The seat's default for a provider the user set up: its tier's model, with the
// starting effort where the model takes one (Haiku takes none). Null when the
// seat or provider has no verified tier.
function seatPlanFor(provider, seat) {
  const tier = Object.prototype.hasOwnProperty.call(SEAT_TIER, seat) ? SEAT_TIER[seat] : null;
  const plan = tier ? planFor(provider) : null;
  if (!plan) return null;
  const effort = tier === "heavy" ? plan[tier].effort : "";
  return { provider, model: plan[tier].model, effort, fast: false };
}

module.exports = { TIERS, PROVIDER_TIERS, START_EFFORT, SEAT_TIER, tierModelsFor, singleSetupProvider, planFor, seatPlanFor };
