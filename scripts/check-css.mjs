// Cascade gates for the renderer stylesheets. A stylesheet is reduced to its
// cascade winners: the last value for each (at-rule context, selector,
// property, !important) key. Four modes:
//   <base.css> <candidate.css>  the two files keep identical winners.
//   [--git <ref>] [file.css]    the working copy against a git ref (default
//                               HEAD and renderer/styles.css), so an
//                               intentional deletion reads as a difference.
//   --merge [--ours|--theirs|--base <ref>] [file.css]
//                               a resolved styles.css merge keeps every
//                               winner either side changed from the merge
//                               base; exits 0 (MERGE-CSS-SKIP) when no merge
//                               is in progress.
//   --unused [--allow cls,...] [file.css ...]
//                               every class a winner-bearing selector names
//                               appears in the other renderer html, js and
//                               css files (never the generated booklet.html).
// `npm run check` runs --merge and --unused. Line endings are folded before
// any comparison, and no file is ever rewritten.
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Line-ending divergence is never a cascade change: autocrlf checkouts keep a
// CRLF working copy against LF git blobs, so fold CR variants to LF before any
// winner comparison (in-memory only — files are never rewritten).
const normalizeEol = (cssText) => cssText.replace(/\r\n?/g, "\n");

function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function parseNodes(css, from = 0, to = css.length) {
  const nodes = [];
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(css[i])) i++;
    if (i >= to) break;
    const headerStart = i;
    const brace = css.indexOf("{", i);
    if (brace === -1 || brace >= to) break;
    const semi = css.indexOf(";", i);
    if (semi !== -1 && semi < brace) { i = semi + 1; continue; }
    let depth = 0, j = brace, inStr = null;
    for (; j < to; j++) {
      const c = css[j];
      if (inStr) { if (c === inStr && css[j - 1] !== "\\") inStr = null; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    const header = css.slice(headerStart, brace).trim();
    if (!header) throw new Error("empty selector header parsed at offset " + brace);
    nodes.push({ header, start: headerStart, braceStart: brace, end: j + 1, isAt: header.startsWith("@") });
    i = j + 1;
  }
  return nodes;
}

function splitSelectorList(header) {
  const out = [];
  let depth = 0, cur = "", inStr = null;
  for (const c of header) {
    if (inStr) { cur += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const selKey = (header) => splitSelectorList(header).sort().join("|||");

function parseDecls(body) {
  const decls = [];
  let depth = 0, inStr = null, cur = "";
  for (const c of body) {
    if (inStr) { cur += c; if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && depth === 0) { decls.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) decls.push(cur);
  return decls.map((d) => {
    const idx = d.indexOf(":");
    if (idx === -1) return null;
    const prop = d.slice(0, idx).trim().toLowerCase();
    let val = d.slice(idx + 1).trim();
    const important = /!\s*important\s*$/i.test(val);
    if (important) val = val.replace(/!\s*important\s*$/i, "").trim();
    return { prop, val, important };
  }).filter(Boolean);
}

export function cascadeWinners(cssText) {
  const css = blankComments(normalizeEol(cssText));
  const winners = new Map();
  let seq = 0;
  (function walk(from, to, ctx) {
    for (const nd of parseNodes(css, from, to)) {
      if (nd.header.startsWith("@keyframes")) continue;
      if (nd.isAt) walk(nd.braceStart + 1, nd.end - 1, ctx + nd.header.replace(/\s+/g, " ") + "::");
      else {
        const key = ctx + selKey(nd.header);
        for (const D of parseDecls(css.slice(nd.braceStart + 1, nd.end - 1))) {
          const k = key + "##" + D.prop + "##" + (D.important ? "!" : "-");
          winners.set(k, { val: D.val, seq: seq++ });
        }
      }
    }
  })(0, css.length, "");
  return winners;
}

export function compareWinners(baseWinners, headWinners) {
  const problems = [];
  for (const [k, v] of baseWinners) {
    const w = headWinners.get(k);
    if (!w) problems.push({ kind: "missing", key: k, base: v.val });
    else if (w.val !== v.val) problems.push({ kind: "changed", key: k, base: v.val, head: w.val });
  }
  for (const k of headWinners.keys()) {
    if (!baseWinners.has(k)) problems.push({ kind: "new", key: k });
  }
  return { problems, totalBase: baseWinners.size, totalHead: headWinners.size };
}

export function cascadeEquivalence(baseText, headText) {
  return compareWinners(cascadeWinners(baseText), cascadeWinners(headText));
}

export function selectorClasses(selector) {
  const classes = new Set();
  for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(match[1]);
  return [...classes];
}

// The usage side of findUnusedSelectors: every word-like token, and every
// literal a template interpolation composes class names from (the word run
// before `${`, spaces or tabs between, trailing hyphens dropped). Parts may be
// texts or earlier indexes; the result is their union, which is exactly the
// index of the texts joined by line breaks, because neither a token nor a
// prefix can cross one. Callers checking several sheets against one shared
// corpus index each file once instead of re-reading megabytes per sheet (the
// auditor did that on the main process every pass: 350 ms). The prefix scan
// walks back from each `${` rather than running /([\w-]+)[ \t]*\$\{/g, which
// retried the word class at every letter of the corpus.
const WORD_CHAR = /[\w-]/;
export function usageIndex(parts) {
  const tokens = new Set();
  const prefixes = new Set();
  for (const part of [].concat(parts)) {
    if (part && typeof part === "object") {
      for (const token of part.tokens) tokens.add(token);
      for (const prefix of part.prefixes) prefixes.add(prefix);
      continue;
    }
    const text = String(part ?? "");
    for (const token of text.match(/[\w-]+/g) ?? []) tokens.add(token);
    for (let at = text.indexOf("${"); at !== -1; at = text.indexOf("${", at + 2)) {
      let end = at;
      while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
      let start = end;
      while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
      if (start < end) prefixes.add(text.slice(start, end).replace(/-+$/, ""));
    }
  }
  return { tokens, prefixes: [...prefixes] };
}

export function findUnusedSelectors(cssText, usageText, { allow = [] } = {}) {
  const css = blankComments(cssText);
  const { tokens: usage, prefixes: dynamicPrefixes } = typeof usageText === "string" ? usageIndex(usageText) : usageText;
  const composed = (name) => dynamicPrefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
  const allowed = new Set(allow);
  const unused = [];
  (function walk(from, to) {
    for (const node of parseNodes(css, from, to)) {
      if (node.header.startsWith("@keyframes")) continue;
      if (node.isAt) { walk(node.braceStart + 1, node.end - 1); continue; }
      if (parseDecls(css.slice(node.braceStart + 1, node.end - 1)).length === 0) continue;
      for (const selector of splitSelectorList(node.header)) {
        const classes = selectorClasses(selector);
        const missing = classes.filter((name) => !usage.has(name) && !allowed.has(name) && !composed(name));
        if (classes.length > 0 && missing.length > 0) {
          unused.push({ selector, missing, line: css.slice(0, node.start).split("\n").length });
        }
      }
    }
  })(0, css.length);
  return unused;
}

// Collision-resolution gate: after a styles.css merge conflict, every winner
// key at least one side diverged from the merge base on must be honored by
// the resolution — a one-sided change/addition survives with that side's
// value, a one-sided deletion stays deleted, and a both-sides change may pick
// either side's value (recorded as a decision) but never the base value.
const fmtWinner = (v) => (v === undefined ? "(absent)" : v);

export function mergeResolution(baseText, oursText, theirsText, resolvedText) {
  const base = cascadeWinners(baseText);
  const ours = cascadeWinners(oursText);
  const theirs = cascadeWinners(theirsText);
  const resolved = cascadeWinners(resolvedText);
  const problems = [];
  const decisions = [];
  const diverged = { ours: 0, theirs: 0 };
  const keys = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  for (const key of keys) {
    const intentOf = (map) => {
      const val = map.has(key) ? map.get(key).val : undefined;
      if (!base.has(key)) return val === undefined ? null : { kind: "add", val };
      if (val === undefined) return { kind: "delete" };
      if (val !== base.get(key).val) return { kind: "change", val };
      return null;
    };
    const o = intentOf(ours);
    const t = intentOf(theirs);
    if (!o && !t) continue;
    if (o) diverged.ours++;
    if (t) diverged.theirs++;
    const rv = resolved.has(key) ? resolved.get(key).val : undefined;
    const realized = (intent) => (intent.kind === "delete" ? rv === undefined : rv === intent.val);
    const baseVal = base.has(key) ? base.get(key).val : undefined;
    if (o && t) {
      const same = o.kind === t.kind && o.val === t.val;
      if (same) {
        if (realized(o)) continue;
      } else {
        if (realized(o)) { decisions.push({ key, picked: "ours", value: fmtWinner(o.val) }); continue; }
        if (realized(t)) { decisions.push({ key, picked: "theirs", value: fmtWinner(t.val) }); continue; }
      }
      problems.push({ kind: "unresolved", key, base: fmtWinner(baseVal), ours: fmtWinner(o.val), theirs: fmtWinner(t.val), resolved: fmtWinner(rv) });
    } else {
      const active = o || t;
      const side = o ? "ours" : "theirs";
      if (!realized(active)) {
        problems.push({
          kind: active.kind === "delete" ? "undeleted" : "dropped",
          key, side, base: fmtWinner(baseVal), [side]: fmtWinner(active.val), resolved: fmtWinner(rv)
        });
      }
    }
  }
  return { problems, decisions, diverged, keys: keys.size };
}

function shortRef(ref) {
  return /^[0-9a-f]{7,40}$/.test(ref) ? ref.slice(0, 8) : ref;
}

function readMergeHead() {
  try {
    const gitPath = execFileSync("git", ["rev-parse", "--git-path", "MERGE_HEAD"], { encoding: "utf8" }).trim();
    const abs = path.isAbsolute(gitPath) ? gitPath : path.resolve(process.cwd(), gitPath);
    return readFileSync(abs, "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function runMerge(files, refs) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = path.resolve(files[0] || path.join(root, "renderer", "styles.css"));
  const oursRef = refs.ours || "HEAD";
  const theirsRef = refs.theirs || readMergeHead();
  if (!theirsRef) {
    console.log("MERGE-CSS-SKIP: no merge in progress — nothing to check (pass --theirs <ref> to audit a branch pair)");
    return 0;
  }
  let baseRef = refs.base;
  if (!baseRef) {
    try {
      baseRef = execFileSync("git", ["merge-base", oursRef, theirsRef], { encoding: "utf8" }).trim();
    } catch (err) {
      console.error(`check-css: cannot compute merge base of ${oursRef} and ${theirsRef}: ${err.message}`);
      return 2;
    }
  }
  let baseText;
  let oursText;
  let theirsText;
  let resolvedText;
  try {
    baseText = readGitBlob(baseRef, target);
    oursText = readGitBlob(oursRef, target);
    theirsText = readGitBlob(theirsRef, target);
    resolvedText = await readFile(target, "utf8");
  } catch (err) {
    console.error(`check-css: cannot read merge sides of ${path.relative(process.cwd(), target)}: ${err.message}`);
    return 2;
  }
  console.log(`MERGE-CSS: ${path.relative(process.cwd(), target)} base=${shortRef(baseRef)} ours=${shortRef(oursRef)} theirs=${shortRef(theirsRef)}`);
  if (/^<{7}/m.test(resolvedText)) {
    console.log("MERGE-CSS-CONFLICT: conflict markers still present in the working copy — resolve them first");
    return 1;
  }
  const { problems, decisions, diverged } = mergeResolution(baseText, oursText, theirsText, resolvedText);
  for (const p of problems) {
    if (p.kind === "dropped") console.log(`MERGE-LOST ${p.side} winner "${p.key}": ${p.side}=${p[p.side]} resolved=${p.resolved} (base=${p.base})`);
    else if (p.kind === "undeleted") console.log(`MERGE-UNDELETED ${p.side} winner "${p.key}": ${p.side} deleted it but resolved=${p.resolved}`);
    else console.log(`MERGE-UNRESOLVED winner "${p.key}": ours=${p.ours} theirs=${p.theirs} resolved=${p.resolved} (base=${p.base})`);
  }
  for (const d of decisions) console.log(`MERGE-DECISION winner "${d.key}": kept ${d.picked}=${d.value}`);
  if (problems.length > 0) {
    console.log(`MERGE-CSS-CONFLICT: ${problems.length} diverged winner key(s) not honored by the resolution (ours ${diverged.ours}, theirs ${diverged.theirs} diverged from the merge base)`);
    return 1;
  }
  console.log(`MERGE-CSS-RESOLVED: resolution honors every diverged winner (ours ${diverged.ours}, theirs ${diverged.theirs} diverged from the merge base, ${decisions.length} both-sides decision(s))`);
  return 0;
}

async function runUnused(targets, allow) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let sheets = targets;
  if (!sheets.length) {
    const renderer = path.join(root, "renderer");
    let names;
    try {
      names = await readdir(renderer);
    } catch (err) {
      console.error(`check-css: cannot read ${renderer}: ${err.message}`);
      return 2;
    }
    sheets = names.filter((name) => name.endsWith(".css")).map((name) => path.join(renderer, name)).sort();
  }
  let dead = 0;
  // Each sibling file is read and indexed once for every sheet that counts it.
  const indexes = new Map();
  const indexOf = (file) => {
    if (!indexes.has(file)) indexes.set(file, readFile(file, "utf8").then((text) => usageIndex(text)));
    return indexes.get(file);
  };
  for (const target of sheets.map((file) => path.resolve(file))) {
    let cssText;
    let siblings;
    try {
      cssText = await readFile(target, "utf8");
      // renderer/booklet.html is generated by build-booklet.mjs and bakes in a
      // copy of every stylesheet and script. Counting it as sibling usage lets
      // a stale baked copy mask classes already dropped from its sources, so
      // the artifact stays out of the usage corpus. Its template, the renderer
      // scripts and the sibling stylesheets already carry every class the
      // booklet can legitimately use.
      siblings = (await readdir(path.dirname(target))).filter(
        (name) => /\.(?:html|js|css)$/.test(name) && name !== "booklet.html" && path.resolve(path.dirname(target), name) !== target
      );
    } catch (err) {
      console.error(`check-css: cannot read ${target}: ${err.message}`);
      return 2;
    }
    const usage = usageIndex(await Promise.all(siblings.map((name) => indexOf(path.join(path.dirname(target), name)))));
    for (const hit of findUnusedSelectors(cssText, usage, { allow })) {
      dead++;
      console.log(`UNUSED-SELECTOR ${path.relative(process.cwd(), target)}:${hit.line}: ${hit.selector} (missing ${hit.missing.join(" ")})`);
    }
  }
  if (dead > 0) {
    console.log(`UNUSED-SELECTORS: ${dead} winner-bearing selector(s) whose classes appear in no renderer html/js/css usage`);
    return 1;
  }
  console.log(`ALL-SELECTORS-USED: every class selector appears in renderer html/js/css usage (${sheets.length} stylesheet(s))`);
  return 0;
}

function formatProblems(problems) {
  for (const p of problems) {
    if (p.kind === "missing") console.log("MISSING WINNER IN CANDIDATE:", p.key, JSON.stringify(p.base));
    else if (p.kind === "changed") console.log("DIFFERENT WINNER:", p.key, "base=", JSON.stringify(p.base), "candidate=", JSON.stringify(p.head));
    else console.log("NEW WINNER IN CANDIDATE:", p.key);
  }
}

function readGitBlob(gitRef, repoPath) {
  const rel = path.relative(process.cwd(), repoPath).split("\\").join("/");
  return execFileSync("git", ["show", `${gitRef}:${rel}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

export async function main(argv = process.argv.slice(2)) {
  const usage = "usage: node scripts/check-css.mjs <base.css> <candidate.css>\n       node scripts/check-css.mjs [--git <ref>] [file.css]  (default: --git HEAD renderer/styles.css)\n       node scripts/check-css.mjs --merge [--ours <ref>] [--theirs <ref>] [--base <ref>] [file.css]\n            (default: renderer/styles.css; ours HEAD, theirs MERGE_HEAD, base their merge base)\n       node scripts/check-css.mjs --unused [--allow cls,...] [file.css ...]  (default: renderer/*.css)";
  let gitRef = null;
  let unusedMode = false;
  let mergeMode = false;
  let allow = [];
  const refs = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--git") {
      if (!argv[i + 1]) { console.error(usage); return 2; }
      gitRef = argv[++i];
    } else if (argv[i] === "--merge") {
      mergeMode = true;
    } else if (argv[i] === "--ours" || argv[i] === "--theirs" || argv[i] === "--base") {
      if (!argv[i + 1]) { console.error(usage); return 2; }
      refs[argv[i].slice(2)] = argv[++i];
    } else if (argv[i] === "--unused") {
      unusedMode = true;
    } else if (argv[i] === "--allow") {
      if (!argv[i + 1]) { console.error(usage); return 2; }
      allow = argv[++i].split(",").map((name) => name.trim()).filter(Boolean);
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log(usage);
      return 0;
    } else files.push(argv[i]);
  }
  if (files.length > 2 || (gitRef && files.length > 1) || (mergeMode && (files.length > 1 || gitRef || unusedMode)) || (unusedMode && mergeMode)) { console.error(usage); return 2; }
  if (unusedMode) return runUnused(files, allow);
  if (mergeMode) return runMerge(files, refs);

  let baseText;
  let candidateText;
  if (files.length === 2) {
    try {
      baseText = await readFile(files[0], "utf8");
      candidateText = await readFile(files[1], "utf8");
    } catch (err) {
      console.error(`check-css: cannot read input: ${err.message}`);
      return 2;
    }
  } else {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const abs = path.resolve(files[0] || path.join(root, "renderer", "styles.css"));
    try {
      baseText = readGitBlob(gitRef || "HEAD", abs);
      candidateText = await readFile(abs, "utf8");
    } catch (err) {
      console.error(`check-css: cannot read ${gitRef || "HEAD"} or working copy of ${abs}: ${err.message}`);
      return 2;
    }
  }

  const { problems, totalBase, totalHead } = cascadeEquivalence(baseText, candidateText);
  formatProblems(problems);
  if (problems.length > 0) {
    console.log(`CASCADE-DIVERGED: ${problems.length} mismatch(es) across ${totalBase} base / ${totalHead} candidate winner keys`);
    return 1;
  }
  console.log(`CASCADE-EQUIVALENT: winners identical for all ${totalBase} (context,prop,importance) keys`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error("check-css: " + (err && err.stack || err));
    process.exit(2);
  });
}
