// Skills are referenced by opaque identities in team snapshots. File paths and
// contents stay on the host; only explicitly selected skills enter a prompt.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
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
async function instructions(root, settings, role, options) {
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
module.exports = { catalog, instructions, validate };
