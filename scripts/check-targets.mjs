// The coverage stage of `npm run check` (`npm run check:targets`). It fails
// when the check chain has gone stale or a file slipped past it:
//   - a node target named by `check`, or by any other npm script, is missing;
//   - a `scripts/*.mjs` or `renderer/*.js` source, or package.json's `main`,
//     is reached neither by a `node --check` in the chain nor by the
//     in-process syntax pass (scripts/check-syntax.mjs), which covers every
//     source it discovers;
//   - package.json or a data/*.json file starts with a UTF-8 BOM;
//   - a tracked text file (read from the git index) holds a raw control
//     character or a bidi control.
// `--package <dir>` audits another package root. Guarded by
// tests/check_targets.test.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTargets } from "./check-syntax.mjs";

export function extractCheckTargets(checkScript) {
  const targets = [];
  const re = /node\s+--check\s+([^\s&|;]+)/g;
  let m;
  while ((m = re.exec(checkScript)) !== null) {
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  return targets;
}

export function extractNodeRefs(scriptValue) {
  const refs = [];
  for (const raw of String(scriptValue).split("&&")) {
    const seg = raw.trim();
    if (!/^node(\s|$)/.test(seg)) continue;
    const args = seg.split(/\s+/).slice(1);
    let i = 0;
    while (i < args.length && args[i].startsWith("--")) i += 1;
    const file = args[i];
    if (!file || file.startsWith("-") || file.includes("*") || file.includes('"')) continue;
    if (!refs.includes(file)) refs.push(file);
  }
  return refs;
}

// UTF-8 BOM bytes: PowerShell 5.x's Out-File/Set-Content emit these by
// default, and a BOM in front of JSON breaks JSON.parse and Python's
// json.loads (which then fails whole unittest modules in setUpClass).
function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

export function findBommedJson(packageRoot) {
  const files = ["package.json"];
  const dataDir = join(packageRoot, "data");
  if (existsSync(dataDir)) {
    for (const name of readdirSync(dataDir)) {
      if (name.endsWith(".json")) files.push(`data/${name}`);
    }
  }
  const bommed = [];
  for (const rel of files) {
    const abs = join(packageRoot, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    if (hasUtf8Bom(readFileSync(abs))) bommed.push(rel);
  }
  return bommed;
}

// Raw control characters and bidi controls in a text source. One NUL makes
// git store the file as binary (`Bin` in --stat, no text diff or merge) and
// ripgrep skip it; ESC and the rest are invisible in review; the bidi
// embeddings, overrides and isolates (U+202A-202E, U+2066-2069) can make code
// read differently than it runs. Sources spell them as escapes: \u001b, \0.
const RAW_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const TEXT_SOURCE = /(?:\.(?:[cm]?js|ts|json|jsonl|md|html?|css|py|ps1|cmd|bat|sh|ya?ml|toml|txt|svg|xml|example)|(?:^|\/)(?:\.gitignore|\.gitattributes|\.editorconfig|LICENSE))$/i;
const CONTROL_HITS_PER_FILE = 5;

// The regular files a git index (versions 2-4) lists, or null for anything
// this reader does not handle (a split index, SHA-256 object names, a torn
// file) so the caller asks git instead. Reading the index costs under a
// millisecond; spawning `git ls-files` costs about a second on a busy machine.
export function indexedFiles(buf) {
  if (buf.length < 32 || buf.toString("latin1", 0, 4) !== "DIRC") return null;
  const version = buf.readUInt32BE(4);
  if (version < 2 || version > 4) return null;
  const end = buf.length - 20; // SHA-1 trailer
  const files = new Set();
  let off = 12;
  let name = ""; // latin1, so v4's byte counts line up with string lengths
  for (let left = buf.readUInt32BE(8); left > 0; left -= 1) {
    if (off + 62 > end) return null;
    const mode = buf.readUInt32BE(off + 24);
    const flags = buf.readUInt16BE(off + 60);
    let at = off + 62 + (flags & 0x4000 ? 2 : 0);
    let kept = "";
    if (version === 4) {
      // v4 drops a byte count off the end of the previous name, then appends.
      let c = buf[at++];
      let strip = c & 127;
      while (c & 128) {
        c = buf[at++];
        strip = ((strip + 1) << 7) | (c & 127);
      }
      if (strip > name.length) return null;
      kept = name.slice(0, name.length - strip);
    }
    const nul = buf.indexOf(0, at);
    if (nul < 0 || nul >= end) return null;
    name = kept + buf.toString("latin1", at, nul);
    if ((flags & 0xfff) !== 0xfff && (flags & 0xfff) !== name.length) return null;
    off = version === 4 ? nul + 1 : off + ((nul - off + 8) & ~7); // NUL-padded to 8 bytes
    if (mode >>> 12 === 0o10) files.add(Buffer.from(name, "latin1").toString("utf8"));
  }
  for (; off + 8 <= end; off += 8 + buf.readUInt32BE(off + 4)) {
    if (buf.toString("latin1", off, off + 4) === "link") return null; // entries live in a shared index
  }
  return off === end ? [...files] : null;
}

function indexPath(packageRoot) {
  if (process.env.GIT_DIR || process.env.GIT_INDEX_FILE) return null;
  const dotGit = join(packageRoot, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return join(dotGit, "index");
    const gitdir = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    return gitdir ? join(resolve(packageRoot, gitdir), "index") : null; // a linked worktree
  } catch {
    return null;
  }
}

function readIndex(packageRoot) {
  const path = indexPath(packageRoot);
  try {
    return path ? indexedFiles(readFileSync(path)) : null;
  } catch {
    return null;
  }
}

// The text files git tracks. A package root that is not a work tree root (a
// fixture, an unpacked copy) falls back to the sources the syntax pass covers.
export function trackedTextFiles(packageRoot) {
  let listed = readIndex(packageRoot);
  if (!listed && existsSync(join(packageRoot, ".git"))) {
    try {
      listed = execFileSync("git", ["ls-files", "-z"], { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 16 << 20 }).split("\0");
    } catch {}
  }
  if (!listed) return [...discoverTargets(packageRoot), "package.json"].filter((rel) => existsSync(join(packageRoot, rel)));
  return listed.filter((rel) => rel && TEXT_SOURCE.test(rel));
}

// { file, line, column, code } for the first few raw controls in each file.
export function findRawControls(packageRoot, files = trackedTextFiles(packageRoot)) {
  const found = [];
  const each = new RegExp(RAW_CONTROL.source, "g");
  for (const rel of files) {
    let text;
    try {
      text = readFileSync(join(packageRoot, rel), "utf8");
    } catch {
      continue; // deleted in the work tree, or a submodule directory
    }
    if (!RAW_CONTROL.test(text)) continue;
    each.lastIndex = 0;
    let hits = 0;
    for (let m; hits < CONTROL_HITS_PER_FILE && (m = each.exec(text)) !== null; hits += 1) {
      const before = text.slice(0, m.index);
      const line = before.split("\n").length;
      const code = `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
      found.push({ file: rel.split("\\").join("/"), line, column: m.index - before.lastIndexOf("\n"), code });
    }
  }
  return found;
}

function readPackageJson(packageRoot) {
  const text = readFileSync(join(packageRoot, "package.json"), "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

// The in-process syntax pass (scripts/check-syntax.mjs) covers every source
// it discovers, so a chain that runs it needs no per-file `node --check`.
const SYNTAX_PASS = /(?:^|&&|\|\||;)\s*node\s+(?:-\S+\s+)*scripts\/check-syntax\.mjs(?=\s|$)/;

export function audit(packageRoot, checkScript) {
  const targets = extractCheckTargets(checkScript);
  const referenced = new Set(targets.map((t) => t.split("\\").join("/")));
  const missing = [];
  for (const rel of targets) {
    const abs = resolve(packageRoot, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) missing.push(rel);
  }
  const syntaxPass = SYNTAX_PASS.test(checkScript);
  const discovered = syntaxPass ? discoverTargets(packageRoot) : [];
  if (syntaxPass && !existsSync(join(packageRoot, "scripts", "check-syntax.mjs"))) missing.push("scripts/check-syntax.mjs");
  for (const rel of discovered) referenced.add(rel);

  const pkg = readPackageJson(packageRoot);
  const scriptMissing = [];
  // Every script's `node <file>` targets are checked, `check` included: its
  // `node --check` targets are already owned by the pass above, so those are
  // skipped here and a missing file is named once. The rest of the chain
  // (the syntax pass, the sibling gates) is caught here instead of at run time.
  const checkedTargets = new Set(targets.map((t) => t.split("\\").join("/")));
  for (const [name, value] of Object.entries(pkg.scripts || {})) {
    for (const rel of extractNodeRefs(value)) {
      if (name === "check" && checkedTargets.has(rel.split("\\").join("/"))) continue;
      const abs = resolve(packageRoot, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) scriptMissing.push({ script: name, path: rel });
    }
  }

  const unreferenced = [];
  for (const [dir, ext] of [["scripts", ".mjs"], ["renderer", ".js"]]) {
    const dirAbs = join(packageRoot, dir);
    if (!existsSync(dirAbs)) {
      missing.push(dir + "/");
      continue;
    }
    for (const name of readdirSync(dirAbs)) {
      if (!name.endsWith(ext)) continue;
      const rel = `${dir}/${name}`;
      if (!referenced.has(rel)) unreferenced.push(rel);
    }
  }

  const mainEntry = pkg.main;
  if (mainEntry && /\.(cjs|js|mjs)$/.test(mainEntry) && !referenced.has(mainEntry.split("\\").join("/"))) {
    unreferenced.push(mainEntry);
  }

  return { targets, discovered, missing, scriptMissing, unreferenced, bommed: findBommedJson(packageRoot), controls: findRawControls(packageRoot) };
}

export function main(argv = process.argv.slice(2)) {
  let packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgIdx = argv.indexOf("--package");
  if (pkgIdx !== -1 && argv[pkgIdx + 1]) packageRoot = resolve(argv[pkgIdx + 1]);
  const pkg = readPackageJson(packageRoot);
  const checkScript = pkg.scripts && pkg.scripts.check;
  if (!checkScript) {
    console.error("check-targets: no scripts.check in package.json");
    return 1;
  }
  const { targets, discovered, missing, scriptMissing, unreferenced, bommed, controls } = audit(packageRoot, checkScript);
  for (const rel of bommed) {
    console.error(`check-targets: UTF-8 BOM in ${rel} (rewrite the file as UTF-8 without BOM)`);
  }
  for (const { file, line, column, code } of controls) {
    console.error(`check-targets: raw ${code} in ${file}:${line}:${column} (write it as an escape, \\u${code.slice(2).toLowerCase()})`);
  }
  for (const rel of missing) {
    console.error(`check-targets: MISSING target referenced by "check": ${rel}`);
  }
  for (const { script, path } of scriptMissing) {
    console.error(`check-targets: MISSING node target in script "${script}": ${path}`);
  }
  for (const rel of unreferenced) {
    console.error(`check-targets: NOT covered by "check" (add node --check ${rel}): ${rel}`);
  }
  if (bommed.length > 0 || controls.length > 0 || missing.length > 0 || scriptMissing.length > 0 || unreferenced.length > 0) {
    const controlFiles = new Set(controls.map(({ file }) => file)).size;
    console.error(`check-targets: ${bommed.length} bommed, ${controlFiles} with raw controls, ${missing.length + scriptMissing.length} missing, ${unreferenced.length} uncovered`);
    return 1;
  }
  const covered = new Set([...targets, ...discovered]).size;
  console.log(`check-targets: ok (${covered} targets${discovered.length ? `, ${discovered.length} through the syntax pass` : ""}, full coverage)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main());
}
