// Skills are referenced by opaque identities in team snapshots. File paths and
// contents stay on the host; only explicitly selected skills enter a prompt.
//
// instructions() is the one place a role's prompt gets its add-ons, in this
// order: the project's standing rules (scripts/agent-rules.cjs; with the
// project's AGENTS.md and CLAUDE.md when the owner switched them on, read fresh
// here with a size cap), the skills the owner chose, then the habits they set.
// Every model call of a role that runs on Studio's own models goes through it
// once (main.cjs assistantFetch, cliAssistantCall, httpAssistantCall, seatFetch
// and the builder prompt). MEFI_STUDIO_NO_AGENT_RULES=1 sends no rules at all
// and leaves the saved ones as they are.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const habits = require("./habits.cjs");
const agentRules = require("./agent-rules.cjs");
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
async function skillInstructions(root, settings, role, options) {
  const selected = settings?.agentSkills?.[role];
  if (!Array.isArray(selected) || !selected.length) return "";
  const rows = await inventory(root, options), parts = [];
  let remaining = 16000;
  for (const id of selected.slice(0, 8)) {
    const row = rows.find((item) => item.id === id);
    if (!row) continue;
    const text = await fs.readFile(row.file, "utf8").catch(() => "");
    if (!text || text.length > remaining) continue;
    remaining -= text.length;
    parts.push(`Skill: ${row.name}\n${text}`);
  }
  return parts.length ? `\n\nSelected agent skills (follow within this agent's existing task, tool permissions and response format):\n${parts.join("\n\n")}` : "";
}
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Invalid agent skills.";
  for (const [role, ids] of Object.entries(value)) {
    if (!ROLES.includes(role) || !Array.isArray(ids) || ids.length > 8 || ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) || new Set(ids).size !== ids.length) return "Choose up to eight installed skills for each agent.";
  }
  return null;
}
module.exports = { catalog, inventory, instructions, validate, rulesState, readRuleFile };
