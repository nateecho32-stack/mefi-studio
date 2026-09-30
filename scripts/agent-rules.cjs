// Standing rules for a project's agents: what the owner wrote in Agents › Team
// (the "Rules" card), plus two switches that also read the project's own
// AGENTS.md and CLAUDE.md. Stored as settings.agentRules = { text, agents,
// claude }, a team field like agentSkills and agentHabits (agent-profiles.cjs:
// a project team keeps its own copy, a project with no team follows the Studio
// defaults, and a run keeps the rules it started with).
//
// This module is the rules themselves: the limits, the check a save goes
// through, the block a prompt gets, what that block costs and who receives it.
// agent-addons.cjs reads the two files (with a size cap, fresh for every
// prompt) and puts the block into every prompt of a role that runs on Studio's
// own models; the coding CLIs (Claude Code, Codex, OpenCode) read AGENTS.md and
// CLAUDE.md themselves, so they only ever get the owner's own text.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

/** The most the owner's own text may hold. Longer is refused, never cut. */
const LIMIT = 4000;
/** The most of each project file that goes into a prompt (characters). */
const FILE_CAP = 8000;
/** The two project files the switches can add, in the order they are sent. */
const FILES = Object.freeze([
  Object.freeze({ key: "agents", name: "AGENTS.md", note: "the project's own agent notes" }),
  Object.freeze({ key: "claude", name: "CLAUDE.md", note: "Claude Code's project notes" }),
]);
/** The builder CLIs that read those files on their own. */
const CLI_READS_FILES = Object.freeze(["opencode", "claude", "codex"]);

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** Line endings as a text box holds them: a CRLF pasted or read is one line break. */
const lines = (text) => String(text ?? "").replace(/\r\n?/g, "\n");
// Tab and line breaks are text; the rest of C0, DEL and the bidi controls are
// not (an invisible reordering in a rule the owner cannot see).
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const number = (value) => Number(value).toLocaleString("en-US");

/** About how many prompt tokens a text costs (four characters a token, as habits.cjs counts). */
const tokens = (text) => Math.ceil(String(text ?? "").length / 4);

/** An error for a malformed settings.agentRules (or a rules save), or null. */
function validate(value) {
  if (!record(value)) return "Rules are a text and two file switches.";
  for (const key of Object.keys(value)) if (!["text", "agents", "claude"].includes(key)) return `Unknown rules setting: ${key}`;
  if (value.text !== undefined && typeof value.text !== "string") return "The rules text must be text.";
  for (const file of FILES) if (value[file.key] !== undefined && typeof value[file.key] !== "boolean") return `Also reading ${file.name} must be on or off.`;
  const text = lines(value.text);
  if (CONTROL.test(text)) return "The rules text cannot hold control or direction characters.";
  if (text.length > LIMIT) return `The rules are ${number(text.length)} characters and the limit is ${number(LIMIT)}. Nothing was cut. Trim it, or move the detail into AGENTS.md and switch that file on.`;
  return null;
}

/**
 * The canonical rules to store or send, or null when there is nothing to say
 * (no text and both switches off) or the value is not valid. Line endings are
 * LF and trailing blank space goes; the text is never shortened otherwise.
 */
function normalize(value) {
  if (!record(value) || validate(value)) return null;
  const text = lines(value.text).replace(/\s+$/, "");
  const rules = { text, agents: value.agents === true, claude: value.claude === true };
  return text || rules.agents || rules.claude ? rules : null;
}

/** Whether Studio puts the project files into this role's prompt. */
function deliversFiles(role, cli) {
  return !(role === "builder" && CLI_READS_FILES.includes(cli));
}

// Who receives what, for the "Who reads what" list. The prompt and the list
// come from this one table, so the list cannot say something the prompt does not do.
const READERS = Object.freeze([
  { id: "assistant", title: "Assistant", detail: "Chat, checks, plans, briefs and reviews", roles: ["routine", "heavy"], files: true },
  { id: "lead", title: "Lead, desk and overseer", detail: "Delegate work, help workers and review progress", roles: ["lead", "desk", "overseer"], files: true },
  { id: "companion", title: "Companion and scout", detail: "Talk with you, and pick a starting file", roles: ["companion", "scout"], files: true },
  { id: "builder-studio", title: "Builders on Grok or Antigravity", detail: "Studio adds the files for them; these tools are not known to read them", roles: ["builder"], clis: ["grok", "antigravity"], files: true },
  { id: "builder-cli", title: "Builders on Claude Code, Codex or OpenCode", detail: "They already read AGENTS.md and CLAUDE.md themselves", roles: ["builder"], clis: [...CLI_READS_FILES], files: false },
].map((row) => Object.freeze(row)));
const readers = () => READERS.map((row) => ({ ...row, roles: [...row.roles], ...(row.clis ? { clis: [...row.clis] } : {}) }));

const TEXT_HEADING = "Project rules the owner wrote for this project (follow them within this agent's task, tool permissions and response format):";
const fileHeading = (file) => `Project file ${file.name} (${file.note}, read fresh for this request):`;
const section = (heading, body) => `\n\n${heading}\n${body}`;

/**
 * What one project file adds, from what the host read of it ({ text, capped,
 * bytes }): null when there is nothing to send. A file cut at the cap says so
 * at its end, so a model never takes half a file for the whole.
 */
function fileSection(file, read) {
  const body = lines(read?.text).trim();
  if (!body) return null;
  const clip = read.capped ? `\n[Only the first ${number(body.length)} characters of ${file.name} (${(read.bytes / 1024).toFixed(1)} KB) are included here.]` : "";
  return { key: file.key, heading: fileHeading(file), body: body + clip };
}

/**
 * The sections a prompt gets: the owner's text, then each switched-on file that
 * was read. `files` is { agents, claude }, each a host read or absent. A file
 * with exactly the text of an earlier one is sent once (CLAUDE.md is often a
 * copy or link of AGENTS.md).
 */
function sections(rules, files = {}) {
  const chosen = normalize(rules);
  if (!chosen) return [];
  const out = [];
  if (chosen.text) out.push({ key: "text", heading: TEXT_HEADING, body: chosen.text });
  const seen = new Set();
  for (const file of FILES) {
    if (!chosen[file.key]) continue;
    const found = fileSection(file, files?.[file.key]);
    if (!found) continue;
    const identity = lines(files[file.key].text).trim();
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(found);
  }
  return out;
}

/** The characters a project file adds to a prompt (its section without the heading), 0 when it adds none. */
function used(key, read) {
  const file = FILES.find((item) => item.key === key);
  return file ? fileSection(file, read)?.body.length ?? 0 : 0;
}

/**
 * The block appended to a prompt, or "" when there is nothing to add. A role
 * whose tool reads the project files itself (deliversFiles) gets the owner's
 * text only. `files` is what the host read; it is not looked at for such a role.
 */
function block(rules, { role, cli, files } = {}) {
  const wanted = deliversFiles(role, cli) ? files : {};
  return sections(rules, wanted).map((item) => section(item.heading, item.body)).join("");
}

/** What the rules cost in a prompt for this role: the characters and the tokens (four characters each). */
function cost(rules, options = {}) {
  const text = block(rules, options);
  return { chars: text.length, tokens: tokens(text) };
}

/**
 * The characters each section adds around its own content, so a screen can
 * count a draft the way the prompt does: overhead + the text's or file's
 * characters, then four to a token.
 */
const overhead = () => ({ text: section(TEXT_HEADING, "").length, ...Object.fromEntries(FILES.map((file) => [file.key, section(fileHeading(file), "").length])) });

module.exports = { LIMIT, FILE_CAP, FILES, CLI_READS_FILES, tokens, validate, normalize, deliversFiles, readers, sections, used, block, cost, overhead, lines };
