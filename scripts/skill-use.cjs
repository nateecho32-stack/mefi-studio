// How each skill is used, and where. A skill (a project's SKILL.md, one in the home
// folder, or one built into Studio: builtin-skills.cjs) can be used three ways in
// each of three places:
//
//   places  chat      the conversation (the companion seat; Talk it over)
//           agents    Studio's own helper models: planning, sizing, reviews, the desk
//           builders  the coding workers (Claude Code, Codex, OpenCode, Studio's builder prompt)
//
//   uses    always    its instructions ride every request in that place
//           auto      it is listed by name and description, and the model loads it with
//                     the use_skill tool when a request fits (agent-tools.cjs)
//           call      only when the owner names it: /name in a message or a task's words
//
// With nothing saved, a skill small enough to load by itself (16,000 characters) is
// "auto" everywhere and a bigger one is "call"; the built-in answer styles are "call",
// except ELI5, which is the chat's style (DEFAULT_STYLE). Each place also has a switch
// for picking skills by itself at all (`auto`); off, every "auto" skill there acts as
// "call". The team's own per-agent picks (settings.agentSkills, Agents › Seats and
// models) still apply on top: those are always on for that one agent.
//
// Stored as settings.skillUse = { skills: { [name]: { chat?, agents?, builders? } },
// auto: { chat, agents, builders } }. Only choices that differ from the default are
// kept, by skill NAME, so a choice follows a skill of that name into every project.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const PLACES = Object.freeze(["chat", "agents", "builders"]);
const USES = Object.freeze(["always", "auto", "call"]);
const DEFAULT_STYLE = "eli5";
// Every agent role, by the place its skills come from.
const ROLE_PLACES = Object.freeze({ companion: "chat", builder: "builders", routine: "agents", heavy: "agents", scout: "agents", overseer: "agents", lead: "agents", desk: "agents" });
const LIMITS = Object.freeze({
  // Always-on skills share one budget per request (the same 16,000 characters and
  // eight skills a team's own picks have: agent-addons.cjs).
  alwaysChars: 16000, alwaysCount: 8,
  // What a model is offered to load by itself: the first 24 by name order, each
  // description clipped, the whole list kept short.
  catalogCount: 24, catalogDescription: 160, catalogChars: 4000,
  // A skill bigger than this never loads by itself (skill-format.cjs AUTO_LOAD_CHARS).
  autoChars: 16000,
  // What one answer may load with use_skill.
  loadChars: 16000,
  overrides: 300,
});
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLACE_WORDS = Object.freeze({ chat: "the chat", agents: "Studio's helper agents", builders: "the builders" });
const USE_WORDS = Object.freeze({ always: "Always on", auto: "When it fits", call: "Only when called" });

const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The place an agent role's skills come from. */
const placeOf = (role) => ROLE_PLACES[role] || "agents";

/** A saved settings.skillUse as the rest of this module reads it; anything unknown is dropped. */
function normalize(value) {
  const out = { skills: {}, auto: { chat: true, agents: true, builders: true } };
  if (!record(value)) return out;
  if (record(value.auto)) for (const place of PLACES) if (typeof value.auto[place] === "boolean") out.auto[place] = value.auto[place];
  if (record(value.skills)) {
    for (const [name, uses] of Object.entries(value.skills).slice(0, LIMITS.overrides)) {
      if (!NAME.test(name) || !record(uses)) continue;
      const kept = {};
      for (const place of PLACES) if (USES.includes(uses[place])) kept[place] = uses[place];
      if (Object.keys(kept).length) out.skills[name] = kept;
    }
  }
  return out;
}

/** An error for a malformed settings.skillUse, or null. */
function validate(value) {
  if (!record(value)) return "Invalid skill settings.";
  for (const key of Object.keys(value)) if (!["skills", "auto"].includes(key)) return "Unknown skill setting.";
  if (value.auto !== undefined) {
    if (!record(value.auto)) return "Invalid skill settings.";
    for (const [place, on] of Object.entries(value.auto)) if (!PLACES.includes(place) || typeof on !== "boolean") return "Skills pick themselves in the chat, for agents or for builders, on or off.";
  }
  if (value.skills !== undefined) {
    if (!record(value.skills)) return "Invalid skill settings.";
    const entries = Object.entries(value.skills);
    if (entries.length > LIMITS.overrides) return `Studio keeps choices for up to ${LIMITS.overrides} skills.`;
    for (const [name, uses] of entries) {
      if (!NAME.test(name)) return "A skill's name is lowercase letters, numbers and dashes.";
      if (!record(uses)) return "Invalid skill settings.";
      for (const [place, use] of Object.entries(uses)) if (!PLACES.includes(place) || !USES.includes(use)) return "Choose always, when it fits or only when called, for the chat, agents or builders.";
    }
  }
  return null;
}

const tooBig = (skill) => Number(skill?.chars) > LIMITS.autoChars;

/** What a skill does in a place when the owner has not chosen. `skill` is { name, kind, chars }. */
function defaultUse(skill, place) {
  if (skill?.kind === "style") return place === "chat" && skill.name === DEFAULT_STYLE ? "always" : "call";
  return tooBig(skill) ? "call" : "auto";
}

/**
 * What a skill does in a place: the owner's choice, else the default. "auto" falls back to "call"
 * when the place's switch is off or the skill is too big to load by itself.
 */
function useOf(value, skill, place) {
  const policy = value?.skills && value?.auto ? value : normalize(value);
  const chosen = policy.skills[skill?.name]?.[place] ?? defaultUse(skill, place);
  if (chosen === "auto" && (policy.auto[place] === false || tooBig(skill))) return "call";
  return chosen;
}

/**
 * Which skills of a catalog an agent role gets: { place, always, auto }. `catalog` is in the order a
 * name resolves (agent-addons.cjs skillCatalog: the project's, the home folder's, then Studio's own);
 * the first skill of each name is the one that counts. `except` names skills the role already has
 * another way (a team's own picks), which are left out of both lists.
 */
function plan(value, catalog, role, { except = [] } = {}) {
  const policy = normalize(value), place = placeOf(role);
  const skip = new Set(except), seen = new Set();
  const always = [], auto = [];
  for (const skill of Array.isArray(catalog) ? catalog : []) {
    if (!skill?.name || seen.has(skill.name)) continue;
    seen.add(skill.name);
    if (skip.has(skill.name)) continue;
    const use = useOf(policy, skill, place);
    if (use === "always") always.push(skill);
    else if (use === "auto") auto.push(skill);
  }
  return { place, always, auto: auto.slice(0, LIMITS.catalogCount) };
}

/**
 * The always-on skills that fit one request: `found` is [{ name, text }] in plan order; the first eight
 * that fit 16,000 characters together. `room` and `count` are what is left after the team's own picks.
 * { used: [{ name, text }], skipped: [{ name, reason }] }.
 */
function fitAlways(found, { room = LIMITS.alwaysChars, count = LIMITS.alwaysCount } = {}) {
  const used = [], skipped = [];
  for (const item of Array.isArray(found) ? found : []) {
    const chars = String(item?.text ?? "").length;
    if (!item?.name || !chars) continue;
    if (used.length >= count) { skipped.push({ name: item.name, reason: "limit" }); continue; }
    if (chars > room) { skipped.push({ name: item.name, reason: "room" }); continue; }
    room -= chars;
    used.push(item);
  }
  return { used, skipped };
}

const clip = (text, limit) => {
  const words = String(text ?? "").replace(/\s+/g, " ").trim();
  return words.length > limit ? `${words.slice(0, limit - 1).trimEnd()}…` : words;
};

/** The block of always-on skills for a prompt, or "" when there are none. */
function alwaysBlock(used, place) {
  const list = (Array.isArray(used) ? used : []).filter((item) => item?.name && item?.text);
  if (!list.length) return "";
  return `\n\nSkills the owner turned on for ${PLACE_WORDS[place] || "this agent"} (follow them within this agent's existing task, tool permissions and response format):\n${list.map((item) => `Skill: ${item.name}\n${item.text}`).join("\n\n")}`;
}

/** The use_skill tool's own description: what it does and the skills it can load, short. */
function catalogLine(auto) {
  const rows = [];
  let room = LIMITS.catalogChars;
  for (const skill of (Array.isArray(auto) ? auto : []).slice(0, LIMITS.catalogCount)) {
    const line = `${skill.name}: ${clip(skill.description || skill.title || "", LIMITS.catalogDescription) || "no description"}`;
    if (line.length + 2 > room) break;
    room -= line.length + 2;
    rows.push(line);
  }
  return rows.length ? `Load the full instructions of one of the owner's skills when the request matches what it is for, then follow them within your task and response format. Skills: ${rows.join("; ")}.` : "";
}

/** A new settings.skillUse with one skill's use in one place changed ("default" forgets the choice). */
function setUse(value, { name, place, use }) {
  const policy = normalize(value);
  if (!NAME.test(String(name ?? "")) || !PLACES.includes(place)) return policy;
  const current = { ...(policy.skills[name] ?? {}) };
  if (use === "default") delete current[place];
  else if (USES.includes(use)) current[place] = use;
  else return policy;
  if (Object.keys(current).length) policy.skills[name] = current; else delete policy.skills[name];
  return compact(policy);
}

/** A new settings.skillUse with a place's "pick skills by itself" switch set. */
function setAuto(value, { place, on }) {
  const policy = normalize(value);
  if (PLACES.includes(place) && typeof on === "boolean") policy.auto[place] = on;
  return compact(policy);
}

/**
 * A new settings.skillUse whose chat style is `style` (a style's name, or null for none): that style is
 * always on in the chat and every other style is only used when called. `styles` are the style skills
 * ({ name, kind: "style" }) the choice is made among.
 */
function setStyle(value, { style = null, styles = [] } = {}) {
  let policy = normalize(value);
  for (const skill of Array.isArray(styles) ? styles : []) {
    if (!skill?.name) continue;
    const wanted = skill.name === style ? "always" : "call";
    // A choice that matches the default is forgotten, so the file keeps only what differs.
    policy = setUse(policy, { name: skill.name, place: "chat", use: wanted === defaultUse(skill, "chat") ? "default" : wanted });
  }
  return policy;
}

/** The chat's styles in force, by name, in the order `styles` lists them. */
function chatStyles(value, styles) {
  return (Array.isArray(styles) ? styles : []).filter((skill) => skill?.name && useOf(value, skill, "chat") === "always").map((skill) => skill.name);
}

// Drop what equals the defaults: no empty skills, and the auto switches only when one is off.
function compact(policy) {
  const out = { skills: {}, auto: {} };
  for (const [name, uses] of Object.entries(policy.skills)) if (Object.keys(uses).length) out.skills[name] = { ...uses };
  for (const place of PLACES) if (policy.auto[place] === false) out.auto[place] = false;
  if (!Object.keys(out.auto).length) delete out.auto;
  return out;
}

/** Each catalog skill as the Skills page shows it: its use in each place, and whether that is the default. */
function summary(value, catalog) {
  const policy = normalize(value), seen = new Set(), rows = [];
  for (const skill of Array.isArray(catalog) ? catalog : []) {
    if (!skill?.name || seen.has(skill.name)) continue;
    seen.add(skill.name);
    const uses = {}, chosen = {};
    for (const place of PLACES) { uses[place] = useOf(policy, skill, place); chosen[place] = policy.skills[skill.name]?.[place] ?? null; }
    rows.push({ name: skill.name, uses, chosen, defaults: Object.fromEntries(PLACES.map((place) => [place, defaultUse(skill, place)])) });
  }
  return { auto: { ...policy.auto }, rows };
}

module.exports = { PLACES, USES, DEFAULT_STYLE, ROLE_PLACES, LIMITS, PLACE_WORDS, USE_WORDS, placeOf, normalize, validate, defaultUse, useOf, plan, fitAlways, alwaysBlock, catalogLine, setUse, setAuto, setStyle, chatStyles, summary };
