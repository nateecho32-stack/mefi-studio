// Mefi's Studio AI+ — the companion as a pet: how it carries itself.
//
// The owner chooses how the companion behaves, from straight work to friendly
// and expressive. A personality is a preset for a few presentation switches
// (little faces, idle play, roaming) and the manner chat replies take; each
// switch can be changed afterwards. A personality never changes what the
// companion may do: permissions, the queue and approvals stay where they are.
//
// The bond counts the time spent together, pets and playdates, so the
// companion can remember being looked after. Pets count at most once every
// few seconds: stroking it for a minute is one moment, not a thousand.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time
// is injected).

"use strict";

const PERSONALITIES = Object.freeze(["focused", "balanced", "playful"]);
const DEFAULT_PERSONALITY = "balanced";

// What each personality sets when the owner picks it. Speech bubbles carry
// work news (the welcome-back digest), so every personality keeps them.
const PRESETS = Object.freeze({
  focused: Object.freeze({ expressions: false, antics: false, roaming: false }),
  balanced: Object.freeze({ expressions: true, antics: false, roaming: true }),
  playful: Object.freeze({ expressions: true, antics: true, roaming: true }),
});

const PERSONALITY_INFO = Object.freeze({
  focused: Object.freeze({ label: "Straight work", says: "Short, plain answers. No small talk, faces or wandering." }),
  balanced: Object.freeze({ label: "Balanced", says: "Warm and to the point. Reacts when things happen." }),
  playful: Object.freeze({ label: "Friendly & expressive", says: "Chatty and playful: little faces, idle play and celebrations." }),
});

const PET_EVERY_MS = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COUNT = 1_000_000;

const num = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : 0);
const count = (value) => Math.max(0, Math.min(MAX_COUNT, Math.floor(num(value))));

function normalizePersonality(value) {
  return PERSONALITIES.includes(value) ? value : DEFAULT_PERSONALITY;
}

/** The switches a personality turns on or off, as a patch for the saved prefs. */
function presetFor(personality) {
  return { personality: normalizePersonality(personality), ...PRESETS[normalizePersonality(personality)] };
}

/**
 * The presentation switches as saved, each falling back to the personality's
 * preset when the owner never set it.
 */
function presentation(saved = {}) {
  const personality = normalizePersonality(saved?.personality);
  const preset = PRESETS[personality];
  const pick = (key) => (typeof saved?.[key] === "boolean" ? saved[key] : preset[key]);
  return { personality, expressions: pick("expressions"), antics: pick("antics") };
}

// ---- the bond ------------------------------------------------------------------

function normalizeBond(raw, now) {
  const at = num(now);
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const since = num(value.since) > 0 && num(value.since) <= at ? num(value.since) : at;
  return { since, pets: count(value.pets), playdates: count(value.playdates), lastPetAt: Math.min(num(value.lastPetAt), at) };
}

/**
 * The bond after one moment together. `event` is "pet" or "playdate"; a pet
 * inside PET_EVERY_MS of the last one is the same pet. Returns the bond and
 * whether it changed (so the host saves only a change).
 */
function recordBond(raw, event, now) {
  const at = num(now);
  const bond = normalizeBond(raw, at);
  if (event === "pet") {
    if (bond.lastPetAt && at - bond.lastPetAt < PET_EVERY_MS) return { bond, changed: false };
    return { bond: { ...bond, pets: Math.min(MAX_COUNT, bond.pets + 1), lastPetAt: at }, changed: true };
  }
  if (event === "playdate") return { bond: { ...bond, playdates: Math.min(MAX_COUNT, bond.playdates + 1) }, changed: true };
  return { bond, changed: false };
}

/** "Together 12 days · 40 pets · 3 playdates", or "We just met" on day one. */
function bondLine(raw, now) {
  const bond = normalizeBond(raw, now);
  const days = Math.floor((num(now) - bond.since) / DAY_MS);
  const parts = [days < 1 ? "We just met" : `Together ${days} day${days === 1 ? "" : "s"}`];
  if (bond.pets) parts.push(`${bond.pets} pet${bond.pets === 1 ? "" : "s"}`);
  if (bond.playdates) parts.push(`${bond.playdates} playdate${bond.playdates === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

module.exports = {
  PERSONALITIES,
  DEFAULT_PERSONALITY,
  PRESETS,
  PERSONALITY_INFO,
  PET_EVERY_MS,
  normalizePersonality,
  presetFor,
  presentation,
  normalizeBond,
  recordBond,
  bondLine,
};
