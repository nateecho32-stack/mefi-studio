// Skills on disk: the host half of the Skills page. List, read, save, create,
// delete, import and export the skills of the open project, and nothing else.
//
// The only place this writes inside a project is <project>/.agents/skills/<name>/
// SKILL.md. The caller hands over a NAME (lowercase letters, numbers and dashes;
// skill-format.cjs) and never a path: every path is built here from the project
// root and a checked name. Nothing is followed through a link: .agents, .agents/
// skills and the skill's own folder must be real folders, and a SKILL.md that is
// a link is not a skill (the inventory, agent-addons.cjs, skips it too).
//
//  - save     replaces an existing skill; its other front-matter keys are kept.
//  - create   and import never overwrite: a skill is a new folder (made with mkdir,
//             which fails if the folder is there, even for two made at the same
//             moment) and the file goes into it.
//  - every write is a temporary file and a rename; a save that replaces text and
//    a delete first keep the old text in a safety folder the host names (outside
//    the project), ten per skill, and refuse to go on when that copy can not be made.
//  - import reads a folder the owner chose in a dialog and takes its SKILL.md
//    only, held to exactly the rules of save; export writes a folder or a zip to
//    a place the owner chose.
//
// Host module: every collaborator (the project root, the filesystem, the safety
// folder, the zip writer, the inventory) comes in through the factory. Nothing
// here throws to its caller: a refusal is { ok: false, error }.

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const format = require("./skill-format.cjs");

const MAX_LISTED = 200;
const KEEP_BACKUPS = 10;
const OFF = "Editing skills is switched off on this PC.";
const INVENTORY_DIRS = [".agents/skills", ".claude/skills", ".codex/skills", ".opencode/skills", ".config/opencode/skills"];

class Refusal extends Error {
  constructor(message, extra = {}) { super(message); this.extra = extra; }
}
const refuse = (message, extra) => new Refusal(message, extra);
const exists = (name) => refuse(`A skill named ${name} already exists. Studio never overwrites one.`, { exists: true });

function createSkills({ root, fs = fsp, enabled = () => true, backups = null, now = Date.now, randomId = () => crypto.randomBytes(6).toString("hex"), inventory = null, zip = null } = {}) {
  if (typeof root !== "function") throw new TypeError("createSkills needs a project root function");

  const lstat = async (target) => {
    try { return await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null; throw error; }
  };

  // The project's real root and where its skills live.
  async function project() {
    const given = root();
    if (!given) throw refuse("Open a project first.");
    let real;
    try { real = await fs.realpath(given); } catch { throw refuse("The project folder can't be reached."); }
    return { real, base: path.join(real, ".agents", "skills") };
  }

  // .agents and .agents/skills, as real folders. A link, or a file where a folder should be, is refused.
  async function skillsFolder(real, { create }) {
    let current = real;
    for (const [part, label] of [[".agents", ".agents"], ["skills", format.DIR]]) {
      current = path.join(current, part);
      let info = await lstat(current);
      if (!info) {
        if (!create) return null;
        try { await fs.mkdir(current); } catch (error) { if (error?.code !== "EEXIST") throw error; }
        info = await lstat(current);
      }
      if (info?.isSymbolicLink()) throw refuse(`${label} is a link, and Studio does not write through links.`);
      if (!info?.isDirectory()) throw refuse(`${label} is not a folder.`);
    }
    return current;
  }

  // One skill's SKILL.md as text, when it is a real file of a size that can be read.
  async function readSkill(folder) {
    const file = path.join(folder, "SKILL.md");
    const info = await lstat(file);
    if (!info || !info.isFile()) return null;
    if (info.size > format.READ_BYTES) return { file, info, tooBig: true, text: "" };
    return { file, info, text: (await fs.readFile(file, "utf8")).replace(/^﻿/, "").replace(/\r\n?/g, "\n") };
  }

  // One skill that exists, through real folders only: a skill's folder that is a link is not a skill.
  async function locate(real, base, name) {
    if (!(await skillsFolder(real, { create: false }))) return null;
    const info = await lstat(path.join(base, name));
    return info && info.isDirectory() ? readSkill(path.join(base, name)) : null;
  }

  function rowOf(name, found) {
    const parsed = found.tooBig ? null : format.parse(found.text);
    const bytes = found.info.size;
    let problem = format.nameProblem(name);
    if (!problem && found.tooBig) problem = `This file is ${(bytes / 1024).toFixed(0)} KB; it is too big to open here (the most is ${Math.round(format.MAX_BYTES / 1000)} KB).`;
    else if (!problem && bytes > format.MAX_BYTES) problem = `This file is ${(bytes / 1024).toFixed(1)} KB. Agents skip anything over ${Math.round(format.MAX_BYTES / 1000)} KB; shorten it to use it.`;
    else if (!problem && !parsed.frontMatter) problem = "It has no front matter. Saving adds a name and a description.";
    else if (!problem && parsed.name && parsed.name !== name) problem = `Its front matter names it ${parsed.name}, but its folder is ${name}. Saving makes them agree.`;
    else if (!problem && !parsed.description) problem = "It has no description, so nothing tells an agent when to use it.";
    return {
      name, bytes, updatedAt: Math.round(found.info.mtimeMs), path: format.fileOf(name),
      description: parsed ? (parsed.description || format.describe(found.text)) : "",
      editable: !format.nameProblem(name) && !found.tooBig,
      loadsByItself: bytes <= format.AUTO_LOAD_CHARS,
      ...(problem ? { problem } : {}),
    };
  }

  async function entry(base, name) {
    const folder = path.join(base, name);
    const info = await lstat(folder);
    if (!info || !info.isDirectory()) return null;
    const found = await readSkill(folder);
    return found ? rowOf(name, found) : null;
  }

  // Replaced text and deleted skills are kept aside first, ten per skill, outside the project.
  async function keepCopy(name, text) {
    const place = typeof backups === "function" ? backups() : null;
    if (!place) return;
    try {
      const folder = path.join(place, name);
      await fs.mkdir(folder, { recursive: true });
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
      await fs.writeFile(path.join(folder, `${stamp}-${randomId().slice(0, 4)}.md`), text, { mode: 0o600, flag: "wx" });
      const kept = (await fs.readdir(folder)).filter((file) => file.endsWith(".md")).sort();
      for (const old of kept.slice(0, Math.max(0, kept.length - KEEP_BACKUPS))) await fs.rm(path.join(folder, old), { force: true }).catch(() => {});
    } catch {
      throw refuse("Studio could not keep a copy of the current file first, so nothing was changed.");
    }
  }

  // Temporary file, then rename; Windows may hold the target for a moment.
  async function replaceFile(file, bytes) {
    const temporary = `${file}.tmp-${randomId()}`;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx" });
      for (let attempt = 0; ; attempt += 1) {
        try { await fs.rename(temporary, file); return; } catch (error) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt >= 4) throw error;
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  const gate = () => { if (!enabled()) throw refuse(OFF, { off: true }); };
  const named = (value) => {
    const name = typeof value === "string" ? value : "";
    const problem = format.nameProblem(name);
    if (problem) throw refuse(problem, { field: "name" });
    return name;
  };
  const refusal = (result) => refuse(result.problems[0].message, { problems: result.problems, field: result.problems[0].field });

  // What every public call does with a failure: a refusal is its own words, anything else a plain sentence.
  const safely = (work) => async (...args) => {
    try { return await work(...args); } catch (error) {
      if (error instanceof Refusal) return { ok: false, error: error.message, ...error.extra };
      return { ok: false, error: `That could not be done (${String(error?.code || error?.message || "unknown").slice(0, 80)}).` };
    }
  };

  // The skills the inventory finds somewhere else (other tools' folders, the owner's home): named, not edited here.
  async function others(real, base) {
    if (typeof inventory !== "function") return [];
    try {
      const rows = await inventory(real);
      return rows.filter((row) => path.dirname(path.dirname(row.file)) !== base).slice(0, MAX_LISTED).map((row) => {
        const folder = path.dirname(path.dirname(row.file)).replace(/\\/g, "/");
        return { name: row.name, scope: row.scope, source: INVENTORY_DIRS.find((dir) => folder.endsWith(`/${dir}`)) ?? "" };
      });
    } catch { return []; }
  }

  const list = safely(async () => {
    const { real, base } = await project();
    const limits = { maxBytes: format.MAX_BYTES, autoLoadChars: format.AUTO_LOAD_CHARS, maxDescription: format.MAX_DESCRIPTION, namePattern: format.NAME_PATTERN.source, nameProblem: format.NAME_PROBLEM };
    let folder = null, blocked = "";
    try { folder = await skillsFolder(real, { create: false }); } catch (error) { if (error instanceof Refusal) blocked = error.message; else throw error; }
    const skills = [];
    if (folder) {
      const dirents = (await fs.readdir(folder, { withFileTypes: true }).catch(() => [])).filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith(".")).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const dirent of dirents.slice(0, MAX_LISTED)) {
        try { const row = await entry(folder, dirent.name); if (row) skills.push(row); } catch { /* one unreadable folder does not hide the rest */ }
      }
    }
    const have = new Set(skills.map((skill) => skill.name));
    return {
      ok: true, dir: format.DIR, skills, others: await others(real, base), limits, writable: enabled(), ...(blocked ? { blocked } : {}),
      starters: format.STARTERS.filter((starter) => !have.has(starter.name)).map((starter) => ({ ...starter })),
    };
  });

  const read = safely(async (value) => {
    const name = named(value);
    const { real, base } = await project();
    const found = await locate(real, base, name);
    if (!found) throw refuse(`There is no skill named ${name}.`, { missing: true });
    if (found.tooBig) throw refuse("That file is too big to open here.", { tooBig: true });
    const parsed = format.parse(found.text);
    return { ok: true, name, description: parsed.description, body: parsed.body, hasExtra: Boolean(parsed.extra), frontMatter: parsed.frontMatter, bytes: found.info.size, path: format.fileOf(name), skill: rowOf(name, found) };
  });

  const save = safely(async (draft = {}) => {
    gate();
    const name = named(draft?.name);
    const { real, base } = await project();
    const found = await locate(real, base, name);
    if (!found) throw refuse(`There is no skill named ${name} to save. Create it first.`, { missing: true });
    if (found.tooBig) throw refuse("That file is too big to open here, so it is not replaced.", { tooBig: true });
    const before = format.parse(found.text);
    const result = format.check({ name, description: draft.description, body: draft.body, extra: before.extra });
    if (!result.ok) throw refusal(result);
    if (result.text === found.text) return { ok: true, unchanged: true, skill: rowOf(name, found) };
    await keepCopy(name, found.text);
    await replaceFile(found.file, result.text);
    return { ok: true, skill: await entry(base, name) };
  });

  const create = safely(async (draft = {}) => {
    gate();
    const name = named(draft?.name);
    const result = format.check({ name, description: draft.description, body: draft.body });
    if (!result.ok) throw refusal(result);
    const { real, base } = await project();
    await skillsFolder(real, { create: true });
    const folder = path.join(base, name);
    if (await lstat(folder)) throw exists(name);
    try { await fs.mkdir(folder); } catch (error) { if (error?.code === "EEXIST") throw exists(name); throw error; }
    try { await replaceFile(path.join(folder, "SKILL.md"), result.text); } catch (error) { await fs.rmdir(folder).catch(() => {}); throw error; }
    return { ok: true, skill: await entry(base, name) };
  });

  const remove = safely(async (value) => {
    gate();
    const name = named(value);
    const { real, base } = await project();
    const found = await locate(real, base, name);
    if (!found) throw refuse(`There is no skill named ${name}.`, { missing: true });
    if (found.tooBig) throw refuse("That file is too big to open here, so it is not deleted.", { tooBig: true });
    await keepCopy(name, found.text);
    await fs.unlink(found.file);
    // Only the file goes. A folder that holds anything else stays, and is said to.
    const left = await fs.readdir(path.join(base, name)).catch(() => []);
    if (!left.length) await fs.rmdir(path.join(base, name)).catch(() => {});
    return { ok: true, name, keptFiles: left.length };
  });

  // A folder the owner chose: its SKILL.md, held to exactly the rules of save, added as a new skill.
  const importFrom = safely(async (chosen) => {
    gate();
    if (typeof chosen !== "string" || !path.isAbsolute(chosen)) throw refuse("Choose a folder to import.");
    let source;
    try { source = await fs.realpath(chosen); } catch { throw refuse("That folder can't be opened."); }
    if (!(await lstat(source))?.isDirectory()) throw refuse("Choose a folder, not a file.");
    const found = await readSkill(source);
    if (!found) throw refuse("That folder has no SKILL.md.");
    if (found.tooBig) throw refuse(`SKILL.md is too big; the most is ${Math.round(format.MAX_BYTES / 1000)} KB.`);
    if (found.text.includes("\u0000")) throw refuse("SKILL.md is not a text file.");
    const parsed = format.parse(found.text);
    if (!parsed.frontMatter) throw refuse("SKILL.md has no front matter. It needs a name and a description between two --- lines.");
    const name = parsed.name;
    const result = format.check({ name, description: parsed.description, body: parsed.body, extra: parsed.extra });
    if (!result.ok) throw refuse(`SKILL.md: ${result.problems[0].message}`, { problems: result.problems, field: result.problems[0].field });
    // The file goes in as it was written, once it is known to meet the rules.
    const bytes = Buffer.from(found.text, "utf8");
    if (bytes.length > format.MAX_BYTES) throw refuse(`SKILL.md is ${(bytes.length / 1024).toFixed(1)} KB; the most is ${Math.round(format.MAX_BYTES / 1000)} KB.`);
    const { real, base } = await project();
    await skillsFolder(real, { create: true });
    const folder = path.join(base, name);
    if (await lstat(folder)) throw exists(name);
    try { await fs.mkdir(folder); } catch (error) { if (error?.code === "EEXIST") throw exists(name); throw error; }
    try { await replaceFile(path.join(folder, "SKILL.md"), bytes); } catch (error) { await fs.rmdir(folder).catch(() => {}); throw error; }
    const others = (await fs.readdir(source).catch(() => [])).filter((file) => file !== "SKILL.md").length;
    return { ok: true, skill: await entry(base, name), skipped: others };
  });

  // To a place the owner chose: a new folder holding SKILL.md, or a zip of the skill.
  const exportTo = safely(async ({ name: value, target, kind = "folder" } = {}) => {
    const name = named(value);
    if (typeof target !== "string" || !path.isAbsolute(target)) throw refuse("Choose where to save it.");
    const { real, base } = await project();
    const found = await locate(real, base, name);
    if (!found) throw refuse(`There is no skill named ${name}.`, { missing: true });
    if (found.tooBig) throw refuse("That file is too big to open here.", { tooBig: true });
    const bytes = await fs.readFile(found.file);
    if (kind === "zip") {
      if (typeof zip !== "function") throw refuse("Zip files can't be made here.");
      const file = /\.zip$/i.test(target) ? target : `${target}.zip`;
      const temporary = `${file}.part-${randomId()}`;
      try {
        await zip(path.join(base, name), temporary, { rootName: name, include: (relative) => relative === "SKILL.md" });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      return { ok: true, where: file, kind: "zip" };
    }
    try { await fs.mkdir(target); } catch (error) {
      if (error?.code === "EEXIST") throw refuse("That folder already exists. Choose a new name; nothing is replaced.", { exists: true });
      if (error?.code === "ENOENT") throw refuse("The folder to put it in does not exist.");
      throw error;
    }
    try { await replaceFile(path.join(target, "SKILL.md"), bytes); } catch (error) { await fs.rmdir(target).catch(() => {}); throw error; }
    return { ok: true, where: target, kind: "folder" };
  });

  return { list, read, save, create, delete: remove, importFrom, exportTo, enabled, OFF };
}

module.exports = { createSkills, OFF, KEEP_BACKUPS, MAX_LISTED };
