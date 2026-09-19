// Mefi's Studio AI+ — Analyzer engine.
//
// Drop a file or an idea and this picks it apart with pure local analysis:
//   files  -> what it is, composition, outline, markers, referenced-but-missing paths
//   ideas  -> keyword coverage across the work tree: new / related / already implemented
// The UI runs this in "read time": every drop analyzes immediately, no key needed.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import studioPaths from "./paths.cjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { repoRoot: DEFAULT_ROOT } = studioPaths.resolveStudioPaths({ studioRoot: STUDIO });

const LANGUAGE = {
  ".lua": "Lua",
  ".py": "Python",
  ".js": "JavaScript",
  ".mjs": "JavaScript (ESM)",
  ".cjs": "JavaScript (CJS)",
  ".ts": "TypeScript",
  ".json": "JSON",
  ".md": "Markdown",
  ".css": "CSS",
  ".html": "HTML",
  ".ps1": "PowerShell",
  ".cmd": "Batch",
  ".bat": "Batch",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".txt": "Text",
};

const STOPWORDS = new Set(
  ("the and for with that this from into about they them their will would should could what when where which while have has had" +
    " add added adding make makes making use uses used using new now out over more most some any all not but also just like" +
    " work works working run runs running file files idea ideas code base base-only can cant don't wont doesnt").split(/\s+/)
);

const SCAN_DIRS = ["renderer", "scripts", "tests", "game", "render", "ui", "worldgen", "save", "tools", "dev", "docs", ".codex_smoke"];
const SKIP = /node_modules|[\\/]build[\\/]|[\\/]\.git[\\/]|[\\/]assets[\\/]|[\\/]logs[\\/]/;

function languageOf(filePath) {
  return LANGUAGE[path.extname(filePath).toLowerCase()] ?? "File";
}

function outlineOf(text, ext) {
  const outline = [];
  const lines = text.split("\n");
  const push = (lineNumber, label) => {
    if (outline.length < 40) outline.push({ line: lineNumber, label: label.trim().slice(0, 90) });
  };
  if (ext === ".md") {
    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.*)/);
      if (match) push(index + 1, `${"·".repeat(match[1].length > 3 ? 3 : match[1].length)} ${match[2]}`);
    });
  } else if ([".lua", ".js", ".mjs", ".cjs", ".ts"].includes(ext)) {
    lines.forEach((line, index) => {
      const fn = line.match(/^\s*(?:local\s+)?function\s+([\w.:]+)/) ?? line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      const assignment = line.match(/^\s*(?:local\s+)?(?:const|let|var)?\s*([A-Za-z_][\w.]*)\s*=\s*(?:function|\{)/);
      if (fn) push(index + 1, `fn ${fn[1]}`);
      else if (assignment && outline.length < 40) push(index + 1, assignment[1]);
    });
  } else if (ext === ".json") {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of Object.keys(parsed).slice(0, 30)) push(1, `${key}`);
      } else if (Array.isArray(parsed)) {
        push(1, `array of ${parsed.length}`);
      }
    } catch {
      push(1, "(does not parse)");
    }
  } else if (ext === ".css") {
    lines.forEach((line, index) => {
      const section = line.match(/\/\* -+ (.*) -+ \*\//);
      const selector = line.match(/^([.#][\w-]+[^{]*)\{/);
      if (section) push(index + 1, `section: ${section[1]}`);
      else if (selector) push(index + 1, selector[1].trim().slice(0, 60));
    });
  }
  return outline;
}

function compositionOf(text) {
  const lines = text.split("\n");
  let blank = 0;
  let comment = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) blank += 1;
    else if (trimmed.startsWith("--") || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("<!--")) comment += 1;
  }
  const total = Math.max(1, lines.length);
  return {
    lines: lines.length,
    code: total - blank - comment,
    comment,
    blank,
    codePercent: Math.round(((total - blank - comment) / total) * 100),
    commentPercent: Math.round((comment / total) * 100),
  };
}

function markersOf(text) {
  const markers = [];
  text.split("\n").forEach((line, index) => {
    const match = line.match(/\b(TODO|FIXME|XXX|HACK)\b[:\s]*(.*)/);
    if (match && markers.length < 20) markers.push({ level: match[1], line: index + 1, text: match[2].trim().slice(0, 100) });
  });
  return markers;
}

async function referencedPaths(text, root) {
  const refs = [...text.matchAll(/[\w./-]+\.(?:lua|py|js|mjs|cjs|md|json|css|ps1|cmd|html)\b/g)].map((match) => match[0]);
  const unique = [...new Set(refs)].slice(0, 40);
  const results = [];
  for (const ref of unique) {
    const candidates = [path.join(root, ref), path.join(STUDIO, ref)];
    let found = false;
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        found = true;
        break;
      } catch {}
    }
    results.push({ ref, found });
  }
  return results;
}

export async function analyzeFile(filePath, { root = DEFAULT_ROOT } = {}) {
  const text = await readFile(filePath, "utf8");
  const info = await stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const composition = compositionOf(text);
  const outline = outlineOf(text, ext);
  const markers = markersOf(text);
  const references = await referencedPaths(text, root);
  const missing = references.filter((reference) => !reference.found);
  const findings = [];

  findings.push({ kind: "what", text: `${languageOf(filePath)} · ${composition.lines} lines · ${(info.size / 1024).toFixed(1)} KB · modified ${new Date(info.mtimeMs).toLocaleString()}` });
  if (outline.length) findings.push({ kind: "content", text: `${outline.length} outline entries (${outline.slice(0, 3).map((entry) => entry.label).join(" / ")}${outline.length > 3 ? " …" : ""})` });
  if (markers.length) findings.push({ kind: "markers", text: `${markers.length} TODO/FIXME markers` });
  if (references.length) {
    findings.push({
      kind: "references",
      text: missing.length
        ? `${missing.length} of ${references.length} referenced paths do not exist (${missing.slice(0, 4).map((entry) => entry.ref).join(", ")})`
        : `all ${references.length} referenced paths exist in the work tree`,
    });
  }
  if (composition.commentPercent < 3 && composition.lines > 200) findings.push({ kind: "style", text: `only ${composition.commentPercent}% comments across ${composition.lines} lines` });
  if (/[\u2014\u2013]/.test(text)) findings.push({ kind: "style", text: "contains em/en dashes (the repo style bans them in player-facing copy)" });

  return {
    kind: "file",
    path: filePath,
    name: path.basename(filePath),
    language: languageOf(filePath),
    bytes: info.size,
    modified: info.mtimeMs,
    composition,
    outline,
    markers,
    references,
    findings,
    analyzedAt: new Date().toISOString(),
  };
}

function keywordsOf(text) {
  const words = (text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((word) => !STOPWORDS.has(word));
  return [...new Set(words)].slice(0, 14);
}

async function scanTree(root, keywords) {
  const hits = [];
  const keywordHits = Object.fromEntries(keywords.map((keyword) => [keyword, 0]));
  let scanned = 0;
  async function walk(dir, depth) {
    if (depth > 5 || scanned > 600 || hits.length > 80) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length > 80 || scanned > 600) return;
      const full = path.join(dir, entry.name);
      if (SKIP.test(full) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!/\.(lua|py|js|mjs|cjs|md|json|css|ps1)$/.test(entry.name)) continue;
      const relative = path.relative(root, full).replace(/\\/g, "/");
      for (const keyword of keywords) {
        if (relative.toLowerCase().includes(keyword)) {
          hits.push({ keyword, file: relative, line: 0, snippet: "(file name match)" });
          keywordHits[keyword] += 1;
        }
      }
      try {
        const info = await stat(full);
        if (info.size > 260000) continue;
        const text = await readFile(full, "utf8");
        scanned += 1;
        const lines = text.split("\n");
        for (const keyword of keywords) {
          if (hits.length > 80) break;
          for (let index = 0; index < lines.length; index += 1) {
            if (lines[index].toLowerCase().includes(keyword)) {
              hits.push({ keyword, file: relative, line: index + 1, snippet: lines[index].trim().slice(0, 110) });
              keywordHits[keyword] += 1;
              break;
            }
          }
        }
      } catch {}
    }
  }
  for (const dir of SCAN_DIRS) await walk(path.join(root, dir), 0);
  return { hits, keywordHits, scanned };
}

export async function verifyIdea(text, { root = DEFAULT_ROOT } = {}) {
  const keywords = keywordsOf(text);
  const { hits, keywordHits, scanned } = await scanTree(root, keywords);
  const files = [...new Set(hits.map((hit) => hit.file))];
  const covered = keywords.filter((keyword) => keywordHits[keyword] > 0);
  const uncovered = keywords.filter((keyword) => keywordHits[keyword] === 0);
  const verdict = files.length === 0 ? "new" : files.length <= 2 ? "related work exists" : "likely already implemented";
  const coverage = Math.round((covered.length / Math.max(1, keywords.length)) * 100);
  const references = await referencedPaths(text, root);
  return {
    kind: "idea",
    text,
    keywords,
    keywordHits,
    coverage,
    verdict,
    scanned,
    hits: hits.slice(0, 40),
    files: files.slice(0, 20),
    uncovered,
    references,
    suggestions: [
      files.length ? `Read first: ${files.slice(0, 4).join(", ")}` : "No direct hits: this looks new — write the request and note the files you expect to touch.",
      uncovered.length ? `Uncovered keywords: ${uncovered.slice(0, 6).join(", ")}` : "Every keyword has evidence somewhere in the tree.",
    ],
    analyzedAt: new Date().toISOString(),
  };
}

async function cli() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : DEFAULT_ROOT;
  const fileIndex = args.indexOf("--file");
  const ideaIndex = args.indexOf("--idea");
  if (fileIndex >= 0) {
    console.log(JSON.stringify(await analyzeFile(args[fileIndex + 1], { root }), null, 2));
    return;
  }
  if (ideaIndex >= 0) {
    console.log(JSON.stringify(await verifyIdea(args[ideaIndex + 1], { root }), null, 2));
    return;
  }
  console.error("usage: node scripts/analyzer.mjs --file <path> | --idea <text> [--root <repo>]");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
