// Skills are referenced by opaque identities in team snapshots. File paths and
// contents stay on the host; only skills the owner turned on, or a model loads
// from the list it is offered, enter a prompt.
//
// instructions() is the one place a role's prompt gets its add-ons, in this
// order: the project's standing rules (scripts/agent-rules.cjs; with the
// project's AGENTS.md and CLAUDE.md when the owner switched them on, read fresh
// here with a size cap), the skills the team picked for this agent, the skills
// that are always on in its place (scripts/skill-use.cjs: the chat's answer
// style, say), the skills a task names with /name, then the habits they set.
// Every model call of a role that runs on Studio's own models goes through it
// once (main.cjs assistantFetch, cliAssistantCall, httpAssistantCall, seatFetch
// and the builder prompt). MEFI_STUDIO_NO_AGENT_RULES=1 sends no rules at all
// and leaves the saved ones as they are.
//
// The skills a model may load by itself are not in the prompt: the tool loop
// offers them through use_skill (agent-tools.cjs), with autoSkills() as its list
// and loadSkill() as the only way to read one.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const habits = require("./habits.cjs");
const agentRules = require("./agent-rules.cjs");
// Loaded on first use: none of them is needed to start Studio.
const lazy = (file) => { let loaded = null; return () => (loaded ??= require(file)); };
const builtinsLib = lazy("./builtin-skills.cjs"), skillUseLib = lazy("./skill-use.cjs"), formatLib = lazy("./skill-format.cjs"), mentionsLib = lazy("./mentions.cjs");
// MEFI_STUDIO_NO_SKILL_USE=1: no skill is always on by its place (the chat's style included), none is
// offered to load by itself, and a task's /name brings nothing. The team's own per-agent picks still apply.
const skillUseOff = () => process.env.MEFI_STUDIO_NO_SKILL_USE === "1";
const { containsPath } = require("./path-scope.cjs");
const ROLES = ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk", "builder"];
async function inventory(root, { home = os.homedir() } = {}) {
  const rows = [];
  for (const [scope, base] of [["project", root], ["user", home]]) {
    if (!base) continue;
    for (const relative of [".agents/skills", ".claude/skills", ".codex/skills", scope === "user" ? ".config/opencode/skills" : ".opencode/skills"]) {
      const dir = path.resolve(base, relative);
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.slice(0, 100)) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const file = path.join(dir, entry.name, "SKILL.md");
        const info = await fs.lstat(file).catch(() => null);
        if (!info?.isFile() || info.size > 32000) continue;
        const id = crypto.createHash("sha256").update(`${scope}:${relative}/${entry.name}`).digest("hex").slice(0, 24);
        rows.push({ id, name: entry.name, scope, file });
      }
    }
  }
  return rows;
}
async function catalog(root, options) {
  return (await inventory(root, options)).map(({ file, ...row }) => row);
}
// Each SKILL.md's text, kept while its size and time stay the same: a skill list
// is read on every model call, and only a file that changed is read again.
const texts = new Map();
const TEXTS_KEPT = 300;
async function fileText(file) {
  const info = await fs.stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 32000) return "";
  const kept = texts.get(file);
  if (kept && kept.size === info.size && kept.mtimeMs === info.mtimeMs) return kept.text;
  const text = (await fs.readFile(file, "utf8").catch(() => "")).replace(/^﻿/, "");
  texts.delete(file);
  texts.set(file, { size: info.size, mtimeMs: info.mtimeMs, text });
  while (texts.size > TEXTS_KEPT) texts.delete(texts.keys().next().value);
  return text;
}
const builtinId = (name) => crypto.createHash("sha256").update(`builtin:${name}`).digest("hex").slice(0, 24);
// A folder name that can stand in a prompt and a tool's list as a skill's name: the rule choices are kept under too.
const listable = (name) => skillUseLib().validName(name);
// Every skill an agent can be given, one per name, in the order a name resolves: the
// project's own (.agents first, then other tools' folders), the home folder's, then
// the ones built into Studio. Each row: { id, name, scope, kind, title, description,
// chars } plus where its text is (`file` for the host, `text` for a built-in); a row
// never leaves the host with its file.
async function skillCatalog(root, options = {}) {
  const rows = [], seen = new Set();
  for (const row of await inventory(root, options).catch(() => [])) {
    if (seen.has(row.name) || !listable(row.name)) continue;
    const text = await fileText(row.file);
    if (!text) continue;
    seen.add(row.name);
    const parsed = formatLib().parse(text);
    // A project's or the home folder's copy of one of Studio's answer styles is still that style (Copy to this project).
    const style = builtinsLib().get(row.name)?.kind === "style" ? builtinsLib().get(row.name) : null;
    rows.push({ id: row.id, name: row.name, scope: row.scope, kind: style ? "style" : "skill", title: style ? style.title : row.name, description: formatLib().describe(text), chars: text.length, file: row.file, ...(parsed.description ? {} : { undescribed: true }) });
  }
  for (const skill of builtinsLib().list()) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    rows.push({ id: builtinId(skill.name), name: skill.name, scope: "builtin", kind: skill.kind, title: skill.title, description: skill.description, chars: skill.text.length, text: skill.text });
  }
  return rows;
}
// A catalog row's text: a built-in carries it, a file is read (through the same keeper).
async function skillText(row) {
  if (typeof row?.text === "string") return row.text;
  return row?.file ? fileText(row.file) : "";
}
// The team's picks for this agent with their text, as the prompt sends them: the first eight that fit 16,000 characters.
async function pickedSkills(root, settings, role, options) {
  const selected = settings?.agentSkills?.[role];
  if (!Array.isArray(selected) || !selected.length) return [];
  const rows = await inventory(root, options), out = [];
  let remaining = 16000;
  for (const id of selected.slice(0, 8)) {
    const row = rows.find((item) => item.id === id);
    if (!row) continue;
    const text = await fs.readFile(row.file, "utf8").catch(() => "");
    if (!text || text.length > remaining) continue;
    remaining -= text.length;
    out.push({ name: row.name, text });
  }
  return out;
}
// What the team's picks leave of the always-on budget.
const roomAfter = (picked) => ({ room: 16000 - picked.reduce((sum, item) => sum + item.text.length, 0), count: 8 - picked.length });
// The names a team picked for this agent (settings.agentSkills), so the other lists leave them out.
async function pickedNames(root, settings, role, options) {
  const selected = settings?.agentSkills?.[role];
  if (!Array.isArray(selected) || !selected.length) return [];
  const rows = await inventory(root, options).catch(() => []);
  return selected.slice(0, 8).map((id) => rows.find((row) => row.id === id)?.name).filter(Boolean);
}
// Whether a place can have a skill on all the time at all, before any file is read:
// the chat's default style, or a choice the owner saved.
function anyAlways(settings, role) {
  if (skillUseOff()) return false;
  const skillUse = skillUseLib();
  const place = skillUse.placeOf(role), policy = skillUse.normalize(settings?.skillUse);
  if (place === "chat" && policy.skills[skillUse.DEFAULT_STYLE]?.chat === undefined) return true;
  return Object.values(policy.skills).some((uses) => uses[place] === "always");
}
// The skills that are always on for a role, with their text, within what is left of the budget.
async function alwaysSkills(root, settings, role, options = {}, { room, count } = {}) {
  if (!anyAlways(settings, role)) return { used: [], skipped: [] };
  const picked = await pickedNames(root, settings, role, options);
  const { always } = skillUseLib().plan(settings?.skillUse, await skillCatalog(root, options), role, { except: picked });
  const found = [];
  for (const row of always) { const text = await skillText(row); if (text) found.push({ name: row.name, text }); }
  return skillUseLib().fitAlways(found, { room, count });
}
/** The names of the skills always on for a role, as its prompt carries them: the team's picks, then its place's in what is left. */
async function alwaysNames(root, settings, role, options = {}) {
  const picked = await pickedSkills(root, settings, role, options).catch(() => []);
  return [...picked.map((item) => item.name), ...(await alwaysSkills(root, settings, role, options, roomAfter(picked))).used.map((item) => item.name)];
}
/**
 * The skills a role's model may load by itself (use_skill): [{ name, title, description, scope, chars }],
 * without the ones it already has always on. Empty when nothing fits or the place's switch is off.
 */
async function autoSkills(root, settings, role, options = {}) {
  if (skillUseOff()) return [];
  const catalogRows = await skillCatalog(root, options);
  const except = [...await pickedNames(root, settings, role, options), ...(await alwaysSkills(root, settings, role, options)).used.map((item) => item.name)];
  return skillUseLib().plan(settings?.skillUse, catalogRows, role, { except }).auto.map(({ name, title, description, scope, chars }) => ({ name, title, description, scope, chars }));
}
/** One skill a role's model asked for with use_skill: only one it was offered. { name, text }, or it throws. */
async function loadSkill(root, settings, role, name, options = {}) {
  const wanted = String(name ?? "").trim();
  const offered = await autoSkills(root, settings, role, options);
  if (!offered.some((row) => row.name === wanted)) throw new Error(offered.length ? `There is no skill named ${wanted.slice(0, 64) || "that"} to load. Load one of: ${offered.map((row) => row.name).join(", ")}.` : "No skills can be loaded here.");
  const row = (await skillCatalog(root, options)).find((item) => item.name === wanted);
  const text = await skillText(row);
  if (!text) throw new Error(`The skill ${wanted} could not be read.`);
  if (text.length > skillUseLib().LIMITS.loadChars) throw new Error(`The skill ${wanted} is too big to load by itself.`);
  return { name: wanted, text };
}
// The project's rules, then the role's chosen skills, then its habits
// (scripts/habits.cjs). `options.cli` names the coding CLI when the prompt is a
// builder's: those tools read AGENTS.md and CLAUDE.md themselves.
async function instructions(root, settings, role, options = {}) {
  return `${await ruleInstructions(root, settings, role, options)}${await skillInstructions(root, settings, role, options)}${habits.instructions(settings?.agentHabits?.[role])}`;
}
const rulesOff = () => process.env.MEFI_STUDIO_NO_AGENT_RULES === "1";
// Enough bytes for FILE_CAP characters of any UTF-8 text; a bigger file is read
// this far only, so a huge or growing file never costs more than this.
const FILE_BYTES = agentRules.FILE_CAP * 3 + 4;
// One of the project's own notes files, as far as the cap: a symlink is followed
// only to a file inside the project, and a folder, a binary or a missing file
// says why it was not read instead of throwing.
async function readRuleFile(root, name) {
  const base = await fs.realpath(root).catch(() => null);
  if (!base) return { found: false };
  const link = path.join(base, name);
  let info = await fs.lstat(link).catch(() => null);
  if (!info) return { found: false };
  let file = link;
  if (info.isSymbolicLink()) {
    file = await fs.realpath(link).catch(() => null);
    if (!file || !containsPath(base, file)) return { found: true, problem: "outside" };
    info = await fs.stat(file).catch(() => null);
  }
  if (!info?.isFile()) return { found: true, problem: "not-a-file" };
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(Math.min(info.size, FILE_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    if (head.includes(0)) return { found: true, bytes: info.size, problem: "binary" };
    let text = agentRules.lines(head.toString("utf8").replace(/^\uFEFF/, ""));
    let capped = info.size > bytesRead;
    if (text.length > agentRules.FILE_CAP) {
      capped = true;
      // Back to a line end when one is near, and never half of a surrogate pair.
      const line = text.lastIndexOf("\n", agentRules.FILE_CAP);
      text = text.slice(0, line > agentRules.FILE_CAP * 0.75 ? line : agentRules.FILE_CAP);
      if ((text.charCodeAt(text.length - 1) & 0xfc00) === 0xd800) text = text.slice(0, -1);
    }
    return { found: true, bytes: info.size, text, capped };
  } catch { return { found: true, problem: "unreadable" }; }
  finally { await handle?.close().catch(() => {}); }
}
const readRuleFiles = async (root, keys) => Object.fromEntries(await Promise.all(agentRules.FILES.filter((file) => keys.includes(file.key)).map(async (file) => [file.key, await readRuleFile(root, file.name)])));
async function ruleInstructions(root, settings, role, options = {}) {
  if (rulesOff()) return "";
  const chosen = agentRules.normalize(settings?.agentRules);
  if (!chosen) return "";
  const keys = agentRules.FILES.filter((file) => chosen[file.key]).map((file) => file.key);
  const files = root && keys.length && agentRules.deliversFiles(role, options?.cli) ? await readRuleFiles(root, keys) : {};
  return agentRules.block(chosen, { role, cli: options?.cli, files });
}
// What Agents › Team shows beside the rules: the limits, what each project file
// is right now (both are read, switched on or not, so the owner sees what
// switching one on would add), each section's fixed cost and who receives what.
// `files` is false for the Studio defaults, which have no one folder to read.
async function rulesState(root, { files = true } = {}) {
  const info = { limit: agentRules.LIMIT, fileCap: agentRules.FILE_CAP, disabled: rulesOff(), overhead: agentRules.overhead(), readers: agentRules.readers(), files: null };
  if (!files || !root) return info;
  const read = await readRuleFiles(root, agentRules.FILES.map((file) => file.key));
  info.files = Object.fromEntries(agentRules.FILES.map((file) => {
    const one = read[file.key] || { found: false };
    const same = file.key !== "agents" && one.text && read.agents?.text && agentRules.lines(one.text).trim() === agentRules.lines(read.agents.text).trim() ? "agents" : null;
    return [file.key, { name: file.name, note: file.note, found: one.found === true, problem: one.problem || null, bytes: one.bytes ?? 0, used: agentRules.used(file.key, one), capped: one.capped === true, same }];
  }));
  return info;
}
// The team's picks for this agent, then the skills always on in its place, within one
// budget of 16,000 characters and eight skills, then the skills a task names (/name in
// `options.text`) within their own: the same budget a /name in a chat message has
// (mentions.cjs). A skill is in the prompt once, whichever way it came.
async function skillInstructions(root, settings, role, options) {
  const picked = await pickedSkills(root, settings, role, options);
  const have = new Set(picked.map((item) => item.name));
  let out = picked.length ? `\n\nSelected agent skills (follow within this agent's existing task, tool permissions and response format):\n${picked.map((item) => `Skill: ${item.name}\n${item.text}`).join("\n\n")}` : "";
  const always = await alwaysSkills(root, settings, role, options, roomAfter(picked)).catch(() => ({ used: [] }));
  for (const item of always.used) have.add(item.name);
  if (always.used.length) out += skillUseLib().alwaysBlock(always.used, skillUseLib().placeOf(role));
  out += await namedSkills(root, options, have);
  return out;
}
// The skills a task's own words name with /name, as a chat message's do.
async function namedSkills(root, options = {}, have = new Set()) {
  if (skillUseOff() || typeof options?.text !== "string" || !options.text.includes("/")) return "";
  // Only a plain call counts (it starts the words, or the name has a dash like /bug-triage): "the /test route" is prose.
  const calls = mentionsLib().skillCalls(options.text.slice(0, 20000)).filter((call) => call.asked && !have.has(call.name));
  if (!calls.length) return "";
  const rows = await skillCatalog(root, options).catch(() => []);
  const found = [];
  for (const call of calls) {
    const row = rows.find((item) => item.name === call.name);
    const text = row ? await skillText(row) : "";
    if (text) found.push({ name: row.name, text });
  }
  const { used } = skillUseLib().fitAlways(found, { room: 16000, count: 4 });
  return used.length ? `\n\nSkills the owner named in this task (follow them within this agent's existing task, tool permissions and response format):\n${used.map((item) => `Skill: ${item.name}\n${item.text}`).join("\n\n")}` : "";
}
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid agent skills.";
  for (const [role, ids] of Object.entries(value)) {
    if (!ROLES.includes(role) || !Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) || new Set(ids).size !== ids.length) return "Choose up to eight installed skills for each agent.";
  }
  return null;
}
/** Forget the kept skill texts. The host never needs to (a text is read again when its size or time changes); a test
 * that rewrites a file within one clock tick does. */
function forget() { texts.clear(); }
module.exports = { catalog, inventory, instructions, validate, rulesState, readRuleFile, skillCatalog, skillText, alwaysNames, autoSkills, loadSkill, forget };
