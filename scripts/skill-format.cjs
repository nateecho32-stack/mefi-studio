// The shape of a skill: one SKILL.md whose front matter names it and says when to
// use it, with the instructions below. What the Skills page saves, what the @ # /
// picker lists and what an import must meet all come from here, so the rules are
// written once.
//
// A skill lives at <project>/.agents/skills/<name>/SKILL.md. The name is the
// folder and is the /command; it is lowercase letters, numbers and dashes, up to
// 64 characters. The file is at most 32,000 bytes because that is what the
// inventory (agent-addons.cjs) accepts: a bigger SKILL.md would save and then
// never be listed. Agents load a skill by themselves only while the skills they
// have chosen fit in 16,000 characters; a bigger one still works when it is
// called by name, and the page says so.
//
// Front matter other than name and description (another tool's `allowed-tools`,
// say) is kept exactly as it was found, so editing a skill here loses nothing.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const DIR = ".agents/skills";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BYTES = 32000;
const READ_BYTES = 64 * 1024;
const MAX_DESCRIPTION = 300;
const AUTO_LOAD_CHARS = 16000;
const DESCRIBE_CHARS = 140;

const NAME_PROBLEM = "Use lowercase letters, numbers and dashes, up to 64 characters.";
// A folder with one of these names can not be made on Windows, so a skill can not have one.
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const RESERVED_PROBLEM = "Windows keeps that name for itself. Choose another.";

/** What is wrong with a name, in a sentence; null when it is a good one. */
function nameProblem(name) {
  if (typeof name !== "string" || !name) return "Give the skill a name.";
  if (!NAME_PATTERN.test(name)) return NAME_PROBLEM;
  return RESERVED.test(name) ? RESERVED_PROBLEM : null;
}

const fileOf = (name) => `${DIR}/${name}/SKILL.md`;
const bytesOf = (text) => Buffer.byteLength(String(text ?? ""), "utf8");
const clip = (text, limit) => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text);

// A front-matter value as one line: plain, 'single' or "double" quoted, or a > or | block.
function scalar(lines) {
  const first = String(lines[0] ?? "").replace(/^[^:]*:/, "").trim();
  const rest = lines.slice(1);
  if (/^[>|][+-]?$/.test(first)) return rest.map((line) => line.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const joined = [first, ...rest.map((line) => line.trim())].filter((part) => part !== "").join(" ").trim();
  if (/^".*"$/s.test(joined)) { try { return String(JSON.parse(joined)).replace(/\s+/g, " ").trim(); } catch { return joined.slice(1, -1).replace(/\s+/g, " ").trim(); } }
  if (/^'.*'$/s.test(joined)) return joined.slice(1, -1).replace(/''/g, "'").replace(/\s+/g, " ").trim();
  return joined.replace(/\s+/g, " ").trim();
}

/**
 * Read a SKILL.md: { frontMatter, name, description, body, extra }. `extra` is the other front-matter
 * entries, verbatim. A file with no front matter (or an unclosed one) is all body.
 */
function parse(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const empty = { frontMatter: false, name: "", description: "", body: source, extra: "" };
  if (!/^---[ \t]*\n/.test(source)) return empty;
  const lines = source.split("\n");
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) if (/^---[ \t]*$/.test(lines[index])) { close = index; break; }
  if (close < 0) return empty;
  // Entries: a line that starts with a key begins one; indented lines and list items belong to the one before.
  const entries = [];
  for (const line of lines.slice(1, close)) {
    const key = /^([A-Za-z_][\w-]*)\s*:/.exec(line);
    if (key) entries.push({ key: key[1], lines: [line] });
    else if (entries.length) entries[entries.length - 1].lines.push(line);
  }
  let name = "", description = "";
  const extra = [];
  for (const entry of entries) {
    if (entry.key === "name") name = scalar(entry.lines);
    else if (entry.key === "description") description = scalar(entry.lines);
    else extra.push(...entry.lines);
  }
  const body = lines.slice(close + 1).join("\n").replace(/^\n/, "");
  return { frontMatter: true, name, description, body, extra: extra.join("\n").replace(/\s+$/, "") };
}

// A description as a front-matter value: plain when nothing in it could be read as YAML, else double-quoted.
function yamlValue(text) {
  const plain = /^[A-Za-z0-9(][^\n]*$/.test(text) && !/(^|\s)#|:\s|:$|["'\\`{}[\],&*!|>%@]/.test(text) && !/^(true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9._]*)$/i.test(text) && text === text.trim();
  return plain ? text : JSON.stringify(text);
}

/** The file for a skill. The body loses trailing space and ends with one newline. */
function build({ name, description, body, extra = "" }) {
  const head = [`name: ${name}`, `description: ${yamlValue(String(description ?? "").trim())}`];
  const more = String(extra ?? "").replace(/\s+$/, "");
  return `---\n${head.join("\n")}${more ? `\n${more}` : ""}\n---\n\n${String(body ?? "").replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
}

/**
 * The validation a save, a create and an import all share. { ok, problems: [{ field, message }], text, bytes }:
 * `text` is the file that would be written, and `bytes` its size.
 */
function check({ name, description, body, extra = "" } = {}) {
  const problems = [];
  const bad = nameProblem(name);
  if (bad) problems.push({ field: "name", message: bad });
  const about = typeof description === "string" ? description.trim() : "";
  if (!about) problems.push({ field: "description", message: "Say when to use it, in one line an agent can match a task against." });
  else if (about.length > MAX_DESCRIPTION) problems.push({ field: "description", message: `Keep the description to ${MAX_DESCRIPTION} characters.` });
  else if (/[\r\n]/.test(about)) problems.push({ field: "description", message: "Keep the description to one line." });
  else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(about)) problems.push({ field: "description", message: "The description has a character that is not text." });
  const words = typeof body === "string" ? body : "";
  if (!words.trim()) problems.push({ field: "body", message: "Write the instructions." });
  else if (words.includes("\u0000")) problems.push({ field: "body", message: "Instructions are text; this has a character that is not." });
  // A character is at least a byte, so a body longer than the limit is over it before anything is built.
  const oversize = words.length > MAX_BYTES;
  const text = problems.length || oversize ? "" : build({ name, description: about, body: words, extra });
  const bytes = text ? bytesOf(text) : oversize ? words.length : bytesOf(words);
  if (oversize || (text && bytes > MAX_BYTES)) problems.push({ field: "body", message: `This skill is ${(bytes / 1024).toFixed(1)} KB; the most is ${Math.round(MAX_BYTES / 1000)} KB.` });
  return { ok: problems.length === 0, problems, text: problems.length ? "" : text, bytes };
}

/** What the picker shows beside a skill: its description, else the first line that says something; one line. */
function describe(text) {
  const parsed = parse(text);
  if (parsed.description) return clip(parsed.description, DESCRIBE_CHARS);
  for (const line of parsed.body.split("\n")) {
    const words = line.replace(/^\s*(?:#{1,6}|[-*>]|\d+[.)])\s*/, "").trim();
    if (words) return clip(words, DESCRIBE_CHARS);
  }
  return "";
}

// A few to start from: short, plain, and each one a skill the page would accept as it stands.
const STARTERS = Object.freeze([
  { name: "bug-triage", description: "Reproduce a bug, find the cause and propose the smallest fix.",
    body: "1. Read the report and the files it names. Say in one line what should happen and what happens instead.\n2. Reproduce it: run the project's own check or the smallest command that shows the problem. If it does not reproduce, say so and stop.\n3. Find the cause before changing anything. Name the file and line.\n4. Propose the smallest change that fixes it, and the test that would have caught it.\n5. Report what you ran and what you saw. Do not claim a fix you did not run." },
  { name: "review-a-change", description: "Review a diff for bugs, missing tests and surprises before it is approved.",
    body: "1. Read the whole diff first, then the files around each change.\n2. List anything that can break: edge cases, errors that are swallowed, changes of behaviour nobody asked for.\n3. Check that every changed behaviour has a test, and that the test would fail without the change.\n4. Say what is good, what must change and what is only a suggestion. Keep each point to two lines.\n5. End with one word: approve, or changes needed." },
  { name: "release-notes", description: "Turn a changelog section into short release notes in plain words.",
    body: "1. Read the changelog section and the commits it covers.\n2. Write one bullet for each change a person using the app would notice. Say what changed for them, not how it was built.\n3. Put the most important change first. Leave out anything internal.\n4. Keep the notes under 15 lines and do not promise what is not in the release." },
  { name: "explain-this-code", description: "Explain how a file or function works, and what depends on it.",
    body: "1. Read the file or function, then find what calls it and what it calls.\n2. Explain in plain words what it does and why it exists, then walk through the main path step by step.\n3. Point out anything surprising: hidden state, ordering that matters, limits.\n4. Finish with where to look if it breaks." },
]);

module.exports = { DIR, NAME_PATTERN, NAME_PROBLEM, MAX_BYTES, READ_BYTES, MAX_DESCRIPTION, AUTO_LOAD_CHARS, DESCRIBE_CHARS, STARTERS, nameProblem, fileOf, bytesOf, parse, build, check, describe };
