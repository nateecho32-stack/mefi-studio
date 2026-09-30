// project_list and project_search: how Studio's own models look through a
// project's files (agent-tools.cjs offers them wherever project reads are on).
// Pure Node with bounded reads: no shell, no ripgrep, no git. A call names a
// folder or file inside the open project, and everything it returns is
// judged by scripts/project-ignore.cjs: hidden and private files and folders
// are never opened or named, .gitignore and the built-in noise folders are
// skipped, symlinks are never followed, and every limit below holds whatever
// the project looks like (a huge tree, a huge file, a hostile pattern).
//
// The collaborators come through the factory (the file system, the clock, the
// platform, the limits, the scrubber), so a suite can shrink a limit or stop
// the clock instead of building a huge project.

"use strict";

const nodeFs = require("node:fs");
const nodeFsp = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { containsPath } = require("./path-scope.cjs");
const ignore = require("./project-ignore.cjs");
const { maskCredentials, maskHome } = require("./redaction.cjs");

const LIMITS = Object.freeze({
  outputChars: 10000,     // what one call returns, as JSON: it stays under the tool loop's 12,000-character slice
  listDefault: 120, listMax: 300, depthMax: 3,
  visit: 20000,           // directory entries looked at in one call
  files: 5000,            // files a search reads
  fileBytes: 512 * 1024,  // a bigger file is skipped, not read
  totalBytes: 24 * 1024 * 1024,
  lineChars: 4000,        // a longer line is cut before it is matched
  excerpt: 200, context: 160,
  resultsDefault: 30, resultsMax: 100, perFileDefault: 5, perFileMax: 20, contextMax: 3,
  queryChars: 300, regexMs: 250, callMs: 10000,
  ignoreBytes: 64 * 1024, sniffBytes: 512, batch: 8,
});

const NO_ROOT = "No project is open.";
// A key is a file with the header on a line of its own; a document that quotes the words in a sentence is not one.
const KEY_HEAD = /^[ \t]*-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m;
const OPEN_FLAGS = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0) | (nodeFs.constants.O_NONBLOCK || 0);
const byName = (a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0; };
const count = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// A whole-number argument, or the default when it is left out.
function whole(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return number;
}
function flag(value, name) {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new Error(`${name} must be true or false.`);
  return value;
}

// Scans a file's text with a caller's regular expression inside a vm context
// with a timeout, so a pattern that backtracks without end is stopped, not run
// on the main process. It takes the whole text (a string crosses the boundary
// cheaply; an array of lines would cost an access check per line) and returns
// line and column pairs. Lines are cut to `max` characters before they are matched.
const SCAN = new vm.Script("(function () { const re = new RegExp(source, flags), lines = text.split(/\\r?\\n/), hits = []; for (let i = 0; i < lines.length && hits.length < cap * 2; i += 1) { const found = re.exec(lines[i].length > max ? lines[i].slice(0, max) : lines[i]); if (found) hits.push(i, found.index); } return hits; })()");

function createProjectSearch({ fs = nodeFsp, now = () => Date.now(), platform = process.platform, limits = {}, scrub = (text) => maskHome(maskCredentials(text)) } = {}) {
  const cap = { ...LIMITS, ...limits };
  const fold = platform === "win32";
  const sandbox = vm.createContext(Object.create(null));

  // The folder or file a call names, resolved: refused unless it is inside the project and not private.
  async function locate(root, value) {
    if (typeof root !== "string" || !root) throw new Error(NO_ROOT);
    const clean = ignore.cleanPath(value);
    if (clean.error) throw new Error(clean.error);
    if (clean.relative && ignore.denied(clean.relative)) throw new Error(ignore.NOT_ALLOWED);
    const base = await fs.realpath(root).catch(() => null);
    if (!base) throw new Error("The project folder is not available.");
    let real = base;
    if (clean.parts.length) {
      real = await fs.realpath(path.join(base, ...clean.parts)).catch(() => null);
      if (!real) throw new Error("That path does not exist in the project.");
      if (!containsPath(base, real)) throw new Error(ignore.NOT_ALLOWED);
    }
    const relative = path.relative(base, real).split(path.sep).join("/");
    if (relative && ignore.denied(relative)) throw new Error(ignore.NOT_ALLOWED);
    return { base, real, relative, parts: relative ? relative.split("/") : [] };
  }

  // A small text file, whole, or "" (the .gitignore of a folder). Only what fits, only text.
  async function small(file, max) {
    let handle;
    try {
      handle = await fs.open(file, OPEN_FLAGS);
      const info = await handle.stat();
      if (!info.isFile() || info.size > max) return "";
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
      return buffer.includes(0) ? "" : buffer.subarray(0, bytesRead).toString("utf8");
    } catch { return ""; } finally { await handle?.close().catch(() => {}); }
  }
  // The ignore files that apply from the project's folder down to (not including) the folder a walk starts in.
  async function startSets(at) {
    const sets = [];
    const exclude = await small(path.join(at.base, ".git", "info", "exclude"), cap.ignoreBytes);
    if (exclude) sets.push({ base: "", rules: ignore.parseIgnore(exclude) });
    for (let depth = 0; depth < at.parts.length; depth += 1) {
      const text = await small(path.join(at.base, ...at.parts.slice(0, depth), ".gitignore"), cap.ignoreBytes);
      if (text) sets.push({ base: at.parts.slice(0, depth).join("/"), rules: ignore.parseIgnore(text) });
    }
    return sets;
  }

  // Everything below a folder, in name order, skipping what a model never sees. Yields
  // { kind: "dir" | "file" | "link", rel, name, deep } (deep: 1 for the folder's own children);
  // `state` collects what was left out and why the walk stopped.
  async function* walk(state, real, rel, sets, deep, options) {
    let entries;
    try { entries = await fs.readdir(real, { withFileTypes: true }); } catch { state.skipped.unreadable += 1; return; }
    const own = entries.find((entry) => entry.name === ".gitignore" && entry.isFile());
    let here = sets;
    if (own) { const text = await small(path.join(real, ".gitignore"), cap.ignoreBytes); if (text) here = [...sets, { base: rel, rules: ignore.parseIgnore(text) }]; }
    const level = rel ? rel.split("/").length : 0;
    entries.sort(options.dirsFirst ? (a, b) => (b.isDirectory() - a.isDirectory()) || byName(a, b) : byName);
    for (const entry of entries) {
      if (state.stop) return;
      if ((state.visited += 1) > cap.visit) { state.stop = "entries"; return; }
      if (now() > state.deadline) { state.stop = "time"; return; }
      const name = entry.name, child = rel ? `${rel}/${name}` : name;
      if (ignore.denied(name)) { state.skipped.private += 1; continue; }
      if (entry.isSymbolicLink()) { state.skipped.links += 1; if (options.links) yield { kind: "link", rel: child, name, deep }; continue; }
      const dir = entry.isDirectory();
      if (!dir && !entry.isFile()) continue;
      if (dir && ignore.skipsFolder(name, level)) { state.skipped.ignored += 1; continue; }
      if (ignore.ignoredBy(here, child, dir, fold)) { state.skipped.ignored += 1; continue; }
      if (dir) {
        yield { kind: "dir", rel: child, name, deep };
        if (deep < options.depth) yield* walk(state, path.join(real, name), child, here, deep + 1, options);
      } else yield { kind: "file", rel: child, name, deep };
    }
  }
  const newState = () => ({ visited: 0, stop: null, deadline: now() + cap.callMs, skipped: { ignored: 0, private: 0, links: 0, unreadable: 0, binary: 0, large: 0 } });
  const leftOut = (skipped, keys) => Object.fromEntries(keys.filter((key) => skipped[key] > 0).map((key) => [key, skipped[key]]));

  // ---- project_list ---------------------------------------------------------------------

  // A file's size, and whether it is text: by its name, else by its first bytes.
  async function describe(base, entry) {
    const file = path.join(base, ...entry.rel.split("/"));
    let handle;
    try {
      handle = await fs.open(file, OPEN_FLAGS);
      const info = await handle.stat();
      if (!info.isFile()) return null;
      let binary = ignore.binaryName(entry.name);
      if (!binary && info.size) {
        const buffer = Buffer.alloc(Math.min(info.size, cap.sniffBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        binary = buffer.subarray(0, bytesRead).includes(0);
      }
      return { path: entry.rel, type: binary ? "binary" : "file", bytes: info.size };
    } catch { return null; } finally { await handle?.close().catch(() => {}); }
  }
  async function pool(items, size, task) {
    const out = new Array(items.length);
    for (let at = 0; at < items.length; at += size) await Promise.all(items.slice(at, at + size).map(async (item, index) => { out[at + index] = await task(item); }));
    return out;
  }

  /** The files and folders under a folder of the project, as { path, type, bytes }: type is dir, file, binary or link. */
  async function list(root, args = {}) {
    const depth = whole(args.depth, 1, 1, cap.depthMax, "depth");
    const limit = whole(args.limit, cap.listDefault, 1, cap.listMax, "limit");
    const at = await locate(root, args.path);
    const info = await fs.stat(at.real).catch(() => null);
    if (!info?.isDirectory()) throw new Error("That path is a file, not a folder. Read it with project_read.");
    const state = newState(), found = [];
    for await (const entry of walk(state, at.real, at.relative, await startSets(at), 1, { depth, dirsFirst: true, links: true })) {
      found.push(entry);
      if (found.length > limit) { state.stop ||= "limit"; break; }
    }
    const shown = found.slice(0, limit);
    const rows = await pool(shown, 16, (entry) => (entry.kind === "file" ? describe(at.base, entry) : { path: entry.rel, type: entry.kind }));
    const out = { path: at.relative || ".", entries: [], shown: 0 };
    let used = JSON.stringify(out).length + 200;
    let cut = state.stop === "limit" || found.length > limit;
    for (const row of rows) {
      if (!row) { state.skipped.unreadable += 1; continue; }
      const size = JSON.stringify(row).length + 1;
      if (used + size > cap.outputChars) { cut = true; break; }
      used += size; out.entries.push(row);
    }
    out.shown = out.entries.length;
    if (cut || state.stop) out.truncated = true;
    const left = leftOut(state.skipped, ["ignored", "private", "unreadable"]);
    if (Object.keys(left).length) out.skipped = left;
    if (cut || state.stop) out.note = state.stop === "entries" || state.stop === "time"
      ? `Stopped early after looking at ${count(state.visited, "entry", "entries")}. List a subfolder to see more.`
      : `Showing the first ${count(out.shown, "entry", "entries")}. List a subfolder, or lower depth, to see the rest.`;
    else if (!out.entries.length) out.note = "Nothing to show: the folder is empty, or holds only hidden, private or ignored files.";
    return out;
  }

  // ---- project_search -------------------------------------------------------------------

  // A file's text if it is small, readable text that is not a private key, else why not.
  async function readText(file) {
    let handle;
    try {
      handle = await fs.open(file, OPEN_FLAGS);
      const info = await handle.stat();
      if (!info.isFile()) return { skip: "unreadable" };
      if (info.size > cap.fileBytes) return { skip: "large" };
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
      const body = buffer.subarray(0, bytesRead);
      if (body.subarray(0, 8000).includes(0)) return { skip: "binary" };
      const text = body.toString("utf8");
      // A key saved under an ordinary name is still a key.
      if (KEY_HEAD.test(text.slice(0, 4000))) return { skip: "private" };
      return { text, bytes: bytesRead };
    } catch { return { skip: "unreadable" }; } finally { await handle?.close().catch(() => {}); }
  }
  // A line, or the stretch of it around the match when it is long.
  function excerpt(text, at, size) {
    if (text.length <= size) return text.trimEnd();
    const start = Math.max(0, Math.min(at - 40, text.length - size));
    return `${start > 0 ? "…" : ""}${text.slice(start, start + size).trimEnd()}${start + size < text.length ? "…" : ""}`;
  }
  const clean = (text) => scrub(text);

  /** Matches for a literal or a regular expression in the project's text files, with a little context. */
  async function search(root, args = {}) {
    const query = args.query;
    if (typeof query !== "string" || !query.trim() || query.length > cap.queryChars) throw new Error(`query must be 1 to ${cap.queryChars} characters.`);
    if (/[\r\n]/.test(query)) throw new Error("query must be one line: a search matches within a single line.");
    const regex = flag(args.regex, "regex"), sensitive = flag(args.caseSensitive, "caseSensitive");
    const context = whole(args.context, 0, 0, cap.contextMax, "context");
    const maxResults = whole(args.maxResults, cap.resultsDefault, 1, cap.resultsMax, "maxResults");
    const perFile = whole(args.perFile, cap.perFileDefault, 1, cap.perFileMax, "perFile");
    const filter = ignore.globFilter(args.glob, { fold });
    if (filter.error) throw new Error(filter.error);
    const flags = sensitive ? "" : "i";
    if (regex) {
      let compiled;
      try { compiled = new RegExp(query, flags); } catch (error) { throw new Error(`The pattern is not a valid regular expression: ${String(error.message).split(": ").at(-1)}.`); }
      if (compiled.test("")) throw new Error("That pattern matches an empty line, so it would match every line. Make it more specific.");
    }
    const needle = sensitive ? query : query.toLowerCase();
    const at = await locate(root, args.path);
    const info = await fs.stat(at.real).catch(() => null);
    if (!info) throw new Error("That path does not exist in the project.");
    const state = newState();
    // One file, or every file under the folder.
    async function* files() {
      if (info.isFile()) { yield { kind: "file", rel: at.relative, name: path.basename(at.real) }; return; }
      yield* walk(state, at.real, at.relative, await startSets(at), 1, { depth: 40, links: false });
    }
    const out = { query, mode: regex ? "regex" : "literal", results: [], matches: 0, files: 0, searched: 0 };
    let used = JSON.stringify({ ...out, truncated: true, skipped: { binary: 99999, large: 99999 }, note: "x".repeat(260) }).length;
    let bytes = 0, halt = null;
    const iterator = files()[Symbol.asyncIterator]();
    // The lines of `text` that match, as [line, column] pairs (one more than `perFile`, to know there are more).
    const hits = (text) => {
      const found = [];
      if (regex) {
        sandbox.text = text; sandbox.source = query; sandbox.flags = flags; sandbox.cap = perFile + 1; sandbox.max = cap.lineChars;
        let pairs;
        try { pairs = SCAN.runInContext(sandbox, { timeout: cap.regexMs }); }
        catch (error) { throw new Error(error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "That pattern is too slow to run safely (it backtracks heavily). Use a simpler pattern, or a literal search." : `The pattern could not be run: ${error?.message ?? error}`); }
        for (let i = 0; i < pairs.length; i += 2) found.push([pairs[i], pairs[i + 1]]);
        return found;
      }
      // Most files do not hold the text at all: one pass over the whole file says so before it is split into lines.
      if (!(sensitive ? text : text.toLowerCase()).includes(needle)) return found;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && found.length <= perFile; i += 1) {
        const line = lines[i].length > cap.lineChars ? lines[i].slice(0, cap.lineChars) : lines[i];
        const index = (sensitive ? line : line.toLowerCase()).indexOf(needle);
        if (index >= 0) found.push([i, index]);
      }
      return found;
    };
    outer: for (;;) {
      const batch = [];
      while (batch.length < cap.batch) {
        const next = await iterator.next();
        if (next.done) break;
        if (next.value.kind !== "file" || !filter.test(next.value.rel)) continue;
        if (ignore.binaryName(next.value.name)) { state.skipped.binary += 1; continue; }
        batch.push(next.value);
        if (state.visited > cap.visit || state.stop) break;
      }
      if (!batch.length) break;
      const texts = await Promise.all(batch.map((entry) => readText(path.join(at.base, ...entry.rel.split("/")))));
      for (const [index, entry] of batch.entries()) {
        const read = texts[index];
        if (read.skip) { state.skipped[read.skip] += 1; continue; }
        if (out.searched >= cap.files) { halt = "files"; break outer; }
        if ((bytes += read.bytes) > cap.totalBytes) { halt = "bytes"; break outer; }
        out.searched += 1;
        const found = hits(read.text);
        if (found.length) {
          const lines = read.text.split(/\r?\n/);
          for (const [line] of found) if (lines[line].length > cap.lineChars) lines[line] = lines[line].slice(0, cap.lineChars);
          const group = { file: entry.rel, matches: [] };
          let groupUsed = JSON.stringify({ file: entry.rel, matches: [], more: true }).length + 1, added = 0;
          for (const [line, column] of found) {
            if (added >= perFile) { group.more = true; break; }
            const match = { line: line + 1, text: clean(excerpt(lines[line], column, cap.excerpt)) };
            if (context) {
              const before = lines.slice(Math.max(0, line - context), line).map((text) => clean(excerpt(text, 0, cap.context))), after = lines.slice(line + 1, line + 1 + context).map((text) => clean(excerpt(text, 0, cap.context)));
              if (before.length) match.before = before;
              if (after.length) match.after = after;
            }
            const size = JSON.stringify(match).length + 1;
            if (used + groupUsed + size > cap.outputChars) { halt = "output"; break; }
            groupUsed += size; group.matches.push(match); added += 1;
            if (out.matches + added >= maxResults) { halt = "results"; break; }
          }
          if (group.matches.length) { out.results.push(group); out.files += 1; out.matches += group.matches.length; used += groupUsed; }
          if (halt) break outer;
        }
        if (now() > state.deadline) { halt = "time"; break outer; }
      }
      if (state.stop) break;
    }
    // A walk's own stop (too many entries, too long) is a reason too.
    halt ||= state.stop === "entries" || state.stop === "time" ? state.stop : null;
    if (halt) out.truncated = true;
    const left = leftOut(state.skipped, ["binary", "large", "private", "unreadable"]);
    if (Object.keys(left).length) out.skipped = left;
    const reasons = { results: `Stopped at ${count(out.matches, "match", "matches")}. Narrow the search with path or glob, or a more specific query.`, output: "Stopped because the result reached its size limit. Narrow the search with path or glob, or a more specific query.",
      files: `Stopped after reading ${count(cap.files, "file")}. Search a subfolder, or give a glob such as *.js.`, bytes: "Stopped after reading a lot of text. Search a subfolder, or give a glob such as *.js.",
      time: "Stopped because the search took too long. Search a subfolder, or give a glob such as *.js.", entries: "Stopped because the project has too many entries to walk in one call. Search a subfolder." };
    if (halt) out.note = reasons[halt];
    else if (!out.matches) out.note = `No matches in ${count(out.searched, "text file")}. .gitignore rules, hidden and private files, binary files and files over ${Math.round(cap.fileBytes / 1024)} KB are not searched.`;
    return out;
  }

  return { list, search, locate };
}

module.exports = { createProjectSearch, LIMITS };
