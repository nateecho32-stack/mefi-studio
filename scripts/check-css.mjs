import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const css = blankComments(cssText);
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
  const usage = "usage: node scripts/check-css.mjs <base.css> <candidate.css>\n       node scripts/check-css.mjs [--git <ref>] [file.css]  (default: --git HEAD renderer/styles.css)";
  let gitRef = null;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--git") {
      if (!argv[i + 1]) { console.error(usage); return 2; }
      gitRef = argv[++i];
    } else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log(usage);
      return 0;
    } else files.push(argv[i]);
  }
  if (files.length > 2 || (gitRef && files.length > 1)) { console.error(usage); return 2; }

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
