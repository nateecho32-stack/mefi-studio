// What a message points at, read on the host: @file, #"a task" and /skill. The
// same reading as renderer/composer-picker.js, which shows it as chips under the
// box while the person types; tests/composer_picker.test.mjs holds the two
// together on one table of messages.
//
//   @src/app.js  @"a file with spaces.md"   a project file. A bare @word counts
//                                            only when it looks like a path (it has
//                                            a . or a / in it), so "thanks @sam" is
//                                            not a file; a quoted one always is.
//   #"Fix the sidebar"                       a task, by its title.
//   /bug-triage                              a skill, only one the project has.
//
// Each starts a word (after a space, or at the start). A file becomes a line that
// names it, never its contents; a skill becomes that skill's own text, inside a
// budget (skillSection). This module only reads and words; main.cjs ("Mentions in
// a message") looks the files and skills up.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const MAX_FILES = 8;
const MAX_SKILLS = 4;
const SKILL_BUDGET_CHARS = 16000;

const FILE = /(^|\s)@(?:"([^"\n]{1,300})"|([^\s"]{1,300}))/g;
const TASK = /(^|\s)#"([^"\n]{1,200})"/g;
const SKILL = /(^|\s)\/([a-z0-9][a-z0-9-]{0,63})(?=$|[\s.,;:!?)\]}])/g;

/**
 * Everything a message mentions, in the order it says it: [{ kind: "file" | "task" | "skill", text }].
 * `skills` are the names the project has; a /word that is not one of them is not a mention.
 */
function parse(text, { skills = [] } = {}) {
  const source = String(text ?? "");
  const found = [];
  for (const match of source.matchAll(FILE)) {
    const path = (match[2] ?? match[3] ?? "").replace(/[.,;:!?)\]}'"]+$/, "");
    if (path && (match[2] !== undefined || /[/.\\]/.test(path))) found.push({ at: match.index + match[1].length, kind: "file", text: path });
  }
  for (const match of source.matchAll(TASK)) found.push({ at: match.index + match[1].length, kind: "task", text: match[2] });
  const known = new Set(skills);
  for (const match of source.matchAll(SKILL)) if (known.has(match[2])) found.push({ at: match.index + match[1].length, kind: "skill", text: match[2] });
  const seen = new Set();
  return found.sort((a, b) => a.at - b.at).filter((row) => { const key = `${row.kind}:${row.text}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(({ kind, text: label }) => ({ kind, text: label }));
}

/**
 * A mentioned path as a project-relative path with / separators, or null when it could point anywhere but
 * inside the project: absolute, a drive, a stream (a colon), a .. or a . part, an empty part, a control character.
 */
function cleanPath(raw) {
  const path = String(raw ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.length > 300 || /[\u0000-\u001f"]/.test(path)) return null;
  if (path.startsWith("/") || path.includes(":")) return null;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** The project files a message names, cleaned and without repeats: at most eight. */
function files(text) {
  const out = [];
  for (const mention of parse(text)) {
    if (mention.kind !== "file") continue;
    const path = cleanPath(mention.text);
    if (path && !out.includes(path)) out.push(path);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/**
 * The /names a message uses, before anyone has checked them against the project's skills, in order and
 * without repeats. `asked` is true when the name is one somebody plainly meant as a skill (it starts the
 * message, or it has a dash like bug-triage), which is when a missing one is worth saying so.
 */
function skillCalls(text) {
  const source = String(text ?? "");
  const lead = source.length - source.trimStart().length;
  const out = [];
  for (const match of source.matchAll(SKILL)) {
    const name = match[2];
    if (out.some((row) => row.name === name)) continue;
    out.push({ name, asked: match.index + match[1].length === lead || name.includes("-") });
  }
  return out;
}

/** The sentence that goes with the message when it names project files: their names, never their contents. */
function fileLine(paths) {
  const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
  return list.length ? `The owner's message points at ${list.length === 1 ? "this project file" : "these project files"}: ${list.join(", ")}. Only the name${list.length === 1 ? " is" : "s are"} given here, not the contents; read ${list.length === 1 ? "it" : "them"} only if your tools allow it.` : "";
}

/**
 * The skills' own text, added to what the model is told, inside a budget. `found` is [{ name, text }] in the
 * order they were called. The first fits whatever its size (a skill over 16,000 characters "only loads when
 * called", and this is that call); later ones must fit what is left of SKILL_BUDGET_CHARS, and at most four
 * are added. { text, used: [names], skipped: [{ name, reason: "room" | "limit", chars, room }] }.
 */
function skillSection(found, { budget = SKILL_BUDGET_CHARS, max = MAX_SKILLS } = {}) {
  let room = budget;
  const used = [], skipped = [];
  for (const item of Array.isArray(found) ? found : []) {
    const chars = String(item?.text ?? "").length;
    if (!item?.name || !chars) continue;
    if (used.length >= max) { skipped.push({ name: item.name, reason: "limit", chars, room }); continue; }
    if (used.length && chars > room) { skipped.push({ name: item.name, reason: "room", chars, room }); continue; }
    room = Math.max(0, room - chars);
    used.push(item);
  }
  const text = used.length ? `\n\nSkills the owner asked for by name in this message (follow them within this agent's existing task, tool permissions and response format):\n${used.map((item) => `Skill: ${item.name}\n${item.text}`).join("\n\n")}` : "";
  return { text, used: used.map((item) => item.name), skipped };
}

/** One plain sentence per thing that did not reach the model, for the reply to say. */
function notes({ missing = [], skipped = [] } = {}) {
  const said = [];
  const names = (list) => list.map((name) => `/${name}`).join(", ");
  if (missing.length) said.push(`I couldn't find ${missing.length === 1 ? "a skill" : "skills"} named ${names(missing)} in this project, so I answered without ${missing.length === 1 ? "it" : "them"}.`);
  const room = skipped.filter((item) => item.reason === "room");
  if (room.length) said.push(`${names(room.map((item) => item.name))} ${room.length === 1 ? "is" : "are"} too long to add to this message along with the others (${room.map((item) => item.chars.toLocaleString("en-US")).join(", ")} characters; ${Math.max(0, room[0].room).toLocaleString("en-US")} left of ${SKILL_BUDGET_CHARS.toLocaleString("en-US")}), so I answered without ${room.length === 1 ? "it" : "them"}.`);
  const limit = skipped.filter((item) => item.reason === "limit");
  if (limit.length) said.push(`A message carries at most ${MAX_SKILLS} skills, so I left out ${names(limit.map((item) => item.name))}.`);
  return said;
}

module.exports = { MAX_FILES, MAX_SKILLS, SKILL_BUDGET_CHARS, parse, cleanPath, files, skillCalls, fileLine, skillSection, notes };
