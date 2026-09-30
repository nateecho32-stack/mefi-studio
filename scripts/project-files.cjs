// The open project's files by name, for the @ picker. Names only: no contents are
// read except the .gitignore files that decide what is left out.
//
// What is listed is what Studio's own read tool could read, so the picker never
// offers a path the model would be refused: hidden paths (anything with a part that
// starts with a dot), folders called data, dist or node_modules, credential-looking
// files (.pem, .key, .db, credentials.json, settings.json) and, besides, build, out,
// coverage and __pycache__, and whatever the project's .gitignore files ignore
// (scripts/gitignore-lite.cjs). A link is never followed or listed, so nothing
// outside the project can appear: only what readdir returns under the root is named.
//
// The folder is walked breadth first, shallow files first, within bounds: 30,000
// files, 6,000 folders, 12 levels and 1.5 seconds (the factory's `limits` lower them for a test). A project bigger than that is
// searched as far as it was read, and the answer says so (`truncated`). The list is
// kept for 15 seconds so typing does not walk the tree again for each key.
//
// `resolve` answers a different question, for a message that names a path by hand:
// which of these paths are files that exist inside the project, through real folders
// only, and that the picker rules would allow. Nothing else is referred to.
//
// Host module: the project root, the filesystem and the clock come in through the
// factory. Nothing here throws to its caller.
//
// The rules that keep a path in or out are ONE function, `excluded`, so a shared
// project-ignore module can replace it (the oracle test in tests/project_files.test.mjs
// holds it to what agent-tools.cjs readProject refuses).

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const gitignore = require("./gitignore-lite.cjs");
const mentions = require("./mentions.cjs");

const MAX_FILES = 30000;
const MAX_DIRS = 6000;
const MAX_DEPTH = 12;
const BUDGET_MS = 1500;
const FRESH_MS = 15000;
const MAX_QUERY = 120;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;
const IGNORE_FILE_BYTES = 64 * 1024;
const SKIPPED_FOLDERS = new Set(["build", "out", "coverage", "__pycache__"]);

/** True for a project-relative path the read tool refuses, so the picker does not offer it either. */
function excluded(relative) {
  return relative.split(/[\\/]/).some((part) => part.startsWith(".") || /^(data|dist|node_modules)$/i.test(part))
    || /(?:\.pem|\.key|\.db|credentials\.json|settings\.json)$/i.test(relative);
}

// A name the picker can put in a message and read back: no quote, no control character.
const speakable = (name) => name.length <= 200 && !/[\u0000-\u001f"]/.test(name);

const lower = (text) => text.toLowerCase();
function scattered(text, query) {
  let at = -1, gaps = 0;
  for (const char of query) {
    const next = text.indexOf(char, at + 1);
    if (next < 0) return null;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

/**
 * How well a file matches a query, null for no match, higher is better. A name beats a path; an exact name beats
 * a start, a start beats a middle, a substring beats letters scattered in order. Shallow and short win a tie.
 */
function score(entry, query) {
  if (!query) return 100 - entry.depth * 5;
  const hasSlash = query.includes("/");
  if (!hasSlash) {
    if (entry.lname === query) return 1000;
    if (entry.lname.startsWith(query)) return 900 - entry.lname.length / 100;
    const inName = entry.lname.indexOf(query);
    if (inName >= 0) return 800 - inName - entry.lname.length / 100;
  }
  const inPath = entry.lpath.indexOf(query);
  if (inPath >= 0) return 700 - inPath / 10 - entry.lpath.length / 100;
  if (!hasSlash) { const gaps = scattered(entry.lname, query); if (gaps !== null) return 500 - gaps - entry.lname.length / 100; }
  const gaps = scattered(entry.lpath, query);
  return gaps === null ? null : 300 - gaps / 10 - entry.lpath.length / 200;
}

/** The best `limit` of `entries` for `query`. */
function rank(entries, query, limit = DEFAULT_LIMIT) {
  const q = lower(String(query ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").slice(0, MAX_QUERY));
  const scored = [];
  for (const entry of entries) { const value = score(entry, q); if (value !== null) scored.push({ entry, value }); }
  scored.sort((a, b) => b.value - a.value || a.entry.depth - b.entry.depth || (a.entry.lpath < b.entry.lpath ? -1 : a.entry.lpath > b.entry.lpath ? 1 : a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));
  return scored.slice(0, limit).map(({ entry }) => entry);
}

function createProjectFiles({ root, fs = fsp, now = Date.now, limits = {} } = {}) {
  if (typeof root !== "function") throw new TypeError("createProjectFiles needs a project root function");
  const bound = { files: MAX_FILES, dirs: MAX_DIRS, depth: MAX_DEPTH, budgetMs: BUDGET_MS, freshMs: FRESH_MS, ...limits };
  let cache = null, building = null;

  async function readIgnore(folder) {
    try {
      const info = await fs.lstat(folder);
      if (!info.isFile() || info.size > IGNORE_FILE_BYTES) return null;
      return gitignore.parse(await fs.readFile(folder, "utf8"));
    } catch { return null; }
  }

  async function walk(base) {
    const started = now();
    const entries = [];
    let dirs = 0, truncated = false;
    const queue = [{ rel: "", depth: 0, rules: [] }];
    while (queue.length) {
      if (entries.length >= bound.files || dirs >= bound.dirs || now() - started > bound.budgetMs) { truncated = true; break; }
      const { rel, depth, rules } = queue.shift();
      dirs += 1;
      let dirents;
      try { dirents = await fs.readdir(rel ? path.join(base, ...rel.split("/")) : base, { withFileTypes: true }); } catch { continue; }
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // A .gitignore in this folder joins the rules for it and everything below.
      let here = rules;
      if (dirents.some((dirent) => dirent.name === ".gitignore" && dirent.isFile())) {
        const parsed = await readIgnore(path.join(rel ? path.join(base, ...rel.split("/")) : base, ".gitignore"));
        if (parsed?.length) here = [...rules, { base: rel, match: gitignore.matcher(parsed) }];
      }
      const ignored = (childRel, isDirectory) => {
        let verdict = null;
        for (const item of here) {
          // A rule set travels only down its own folder, so the path is always inside its base.
          const inside = item.base ? childRel.slice(item.base.length + 1) : childRel;
          const answer = item.match(inside, isDirectory);
          if (answer !== null) verdict = answer;
        }
        return verdict === true;
      };
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue;
        const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
        if (excluded(childRel) || !speakable(dirent.name)) continue;
        if (dirent.isDirectory()) {
          if (SKIPPED_FOLDERS.has(dirent.name) || depth + 1 >= bound.depth || ignored(childRel, true)) continue;
          queue.push({ rel: childRel, depth: depth + 1, rules: here });
        } else if (dirent.isFile()) {
          if (childRel.length > 300 || ignored(childRel, false)) continue;
          entries.push({ path: childRel, name: dirent.name, dir: rel, depth, lname: lower(dirent.name), lpath: lower(childRel) });
        }
      }
    }
    return { entries, truncated: truncated || queue.length > 0 };
  }

  async function index() {
    const given = root();
    if (!given) return null;
    let real;
    try { real = await fs.realpath(given); } catch { return null; }
    if (cache && cache.root === real && now() - cache.at < bound.freshMs) return cache;
    if (building && building.root === real) return building.promise;
    const promise = walk(real).then((built) => { cache = { root: real, at: now(), ...built }; return cache; }).finally(() => { if (building?.promise === promise) building = null; });
    building = { root: real, promise };
    return promise;
  }

  /** { ok, files: [{ path, name, dir }], truncated, scanned } for a query (empty: the shallowest files). */
  async function search({ query = "", limit = DEFAULT_LIMIT } = {}) {
    try {
      const built = await index();
      if (!built) return { ok: false, error: "Open a project first." };
      const count = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_LIMIT));
      const top = rank(built.entries, typeof query === "string" ? query : "", count);
      return { ok: true, files: top.map(({ path: file, name, dir }) => ({ path: file, name, dir })), truncated: built.truncated, scanned: built.entries.length };
    } catch (error) {
      return { ok: false, error: `The project's files could not be listed (${String(error?.code || error?.message || "unknown").slice(0, 60)}).` };
    }
  }

  /** Of these mentioned paths, the ones that are files inside the project, through real folders, that the picker would offer. */
  async function resolve(paths) {
    const given = root();
    if (!given || !Array.isArray(paths)) return [];
    let real;
    try { real = await fs.realpath(given); } catch { return []; }
    const found = [];
    // Sixteen are looked at, so a few bad ones in a row do not hide the good ones; eight are kept.
    for (const candidate of paths.slice(0, mentions.MAX_FILES * 2)) {
      if (found.length >= mentions.MAX_FILES) break;
      const clean = mentions.cleanPath(candidate);
      if (!clean || excluded(clean) || !speakable(clean) || found.includes(clean)) continue;
      try {
        const parts = clean.split("/");
        let current = real, ok = true;
        for (let index = 0; index < parts.length && ok; index += 1) {
          current = path.join(current, parts[index]);
          const info = await fs.lstat(current);
          ok = index === parts.length - 1 ? info.isFile() : info.isDirectory();
        }
        if (ok) found.push(clean);
      } catch { /* not there: not referred to */ }
    }
    return found;
  }

  /** Forget the kept list (the next search walks again). */
  function forget() { cache = null; }

  return { search, resolve, forget };
}

module.exports = { createProjectFiles, excluded, rank, score, MAX_FILES, MAX_DIRS, MAX_DEPTH, BUDGET_MS, FRESH_MS, DEFAULT_LIMIT, MAX_LIMIT };
