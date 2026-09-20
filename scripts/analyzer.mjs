// Mefi's Studio AI+ — Analyzer engine.
//
// Drop a file or an idea and this picks it apart with pure local analysis:
//   files  -> what it is, composition, outline, markers, referenced-but-missing paths
//   ideas  -> keyword coverage across the work tree: new / related / already implemented
// The UI runs this in "read time": every drop analyzes immediately, no key needed.

import { readFile, readdir, stat, lstat, realpath, open, opendir } from "node:fs/promises";
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
  const verdict = files.length === 0 ? "new" : "related work exists";
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

// Project onboarding deliberately uses a separate, bounded scanner. Old plans
// are claims to investigate, and source-text matches are never a completion test.
export const PROJECT_LIMITS = Object.freeze({ entries: 6000, files: 1200, depth: 10, fileBytes: 160000, totalBytes: 8000000, plans: 40, itemsPerPlan: 30, items: 240, references: 12, evidence: 4 });
const PROJECT_SKIP = new Set(["node_modules", "vendor", "vendors", "build", "dist", "target", "out", "coverage", "__pycache__", "venv", "env", "data", "private", "secrets", "credentials", "logs", "backups", "cache", "temp", "tmp", "packages-cache"]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".lua", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".vue", ".svelte", ".html", ".css", ".scss", ".sh", ".ps1"]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const PROJECT_LANGUAGES = { ...LANGUAGE, ".jsx": "JavaScript", ".tsx": "TypeScript", ".rs": "Rust", ".go": "Go", ".rb": "Ruby", ".java": "Java", ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".cpp": "C++", ".h": "C/C++", ".hpp": "C++", ".cs": "C#", ".php": "PHP", ".vue": "Vue", ".svelte": "Svelte", ".scss": "SCSS", ".sh": "Shell" };
const PLAN_NAME = /(?:^|[\/_. -])(?:plans?|roadmaps?|todos?|designs?|specs?|specifications?|backlogs?|milestones?)(?:$|[\/_. -])/i;
const GENERIC_PLAN_WORDS = new Set("implement implementation completed complete done verify verified tests test feature features project application app add create build support ensure provide enable allow update change check user users system plan task phase step first then new old needs should must behavior acceptance criteria src lib index main function return const async export import public private string number boolean true false null undefined module require class div span button text value name type props code file files path source document docs readme md js ts py lua json".split(" "));
const projectRelative = (root, file) => path.relative(root, file).replace(/\\/g, "/");
const insideProject = (root, file) => { const relative = path.relative(root, file); return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)); };
const privateName = (name) => name.startsWith(".") || /(?:^|[._-])(?:credentials?|secrets?|passwords?|tokens?|api[-_]?keys?|id_rsa|id_ed25519)(?:[._-]|$)/i.test(name) || /\.(?:pem|key|p12|pfx|db|sqlite\d*|log|bak|env)$/i.test(name);
const excludedPart = (part) => PROJECT_SKIP.has(part.toLowerCase()) || privateName(part);
const isTestFile = (file) => /(?:^|\/)(?:tests?|__tests__|specs?|fixtures)(?:\/|$)|(?:^|[._-])(?:test|spec)(?:[._-]|$)/i.test(file);
const isSourceFile = (file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()) && !isTestFile(file) && !/(?:^|\/)(?:docs?|documentation)(?:\/|$)/i.test(file);

function safeExcerpt(value, max = 220) {
  return String(value ?? "")
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?(?:-----END [\s\S]*?PRIVATE KEY-----|$)/g, "[redacted private key]")
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9_]{16,}|AKIA[A-Z0-9]{16})\b/g, "[redacted credential]")
    .replace(/((?:password|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*)(?:["'][^"'\r\n]*["']|[^\s,;}]+)/gi, "$1[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .trim().slice(0, max);
}

function projectKeywords(value) {
  const words = String(value).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
  return [...new Set(words.filter((word) => !STOPWORDS.has(word) && !GENERIC_PLAN_WORDS.has(word)))].slice(0, 18);
}

function planExcerpt(value, limitations, max = 700) {
  if (String(value ?? "").length > max) limitations.add(`Long plan text was shortened to ${max} characters per field; consult the original plan for the full wording.`);
  return safeExcerpt(value, max);
}

async function projectInventory(root, limitations) {
  const files = [], textFiles = [];
  let entriesSeen = 0, bytesRead = 0, truncated = false;
  const warn = (message) => limitations.add(message);
  async function inspect(dir, entry) {
    const full = path.join(dir, entry.name), relative = projectRelative(root, full);
    try {
      const canonical = await realpath(full);
      if (!insideProject(root, canonical)) { warn("Paths resolving outside the selected project were skipped."); return; }
      if (!entry.isFile()) return;
      const info = await lstat(full);
      if (!info.isFile() || info.isSymbolicLink()) return;
      const ext = path.extname(entry.name).toLowerCase();
      const document = DOCUMENT_EXTENSIONS.has(ext), source = isSourceFile(relative), test = isTestFile(relative) && SOURCE_EXTENSIONS.has(ext);
      const file = { file: relative, source, test, document, bytes: info.size };
      files.push(file);
      if (!source && !test && !document && entry.name !== "package.json" && !["Cargo.toml", "pyproject.toml", "go.mod", "Makefile", "CMakeLists.txt"].includes(entry.name)) return;
      if (info.size > PROJECT_LIMITS.fileBytes) { warn(`Files larger than ${PROJECT_LIMITS.fileBytes} bytes were inventoried without reading their content.`); return; }
      if (bytesRead + info.size > PROJECT_LIMITS.totalBytes) { warn(`Content scan truncated at ${PROJECT_LIMITS.totalBytes} bytes; some inventoried files were not read.`); return; }
      const handle = await open(full, "r");
      try {
        // Read at most the cap even when a file grows after its stat.
        const buffer = Buffer.alloc(Math.min(info.size + 1, PROJECT_LIMITS.fileBytes + 1));
        const result = await handle.read(buffer, 0, buffer.length, 0);
        bytesRead += result.bytesRead;
        if (result.bytesRead > info.size) warn("Files changed during the scan; refresh analysis after editing finishes.");
        if (result.bytesRead > PROJECT_LIMITS.fileBytes) return;
        const text = buffer.subarray(0, result.bytesRead).toString("utf8");
        if (text.includes("\0")) return;
        textFiles.push({ ...file, text, lines: text.split(/\r?\n/) });
      } finally { await handle.close(); }
    } catch (error) { warn(`Could not inspect ${safeExcerpt(relative, 120)} (${error.code || "read error"}).`); }
  }
  // Breadth-first by depth: a directory's own files are read before its
  // subdirectories, so a plan at the top of a huge checkout is inventoried
  // before one deep tree can exhaust the file, entry or byte budgets. Every
  // existing cap still bounds the scan and the limitations still say so.
  const queue = [[root, 0]];
  while (queue.length && !truncated) {
    const [dir, depth] = queue.shift();
    let directory;
    try {
      // Streaming directory iteration prevents one huge folder from defeating
      // the entry bound before any files have been analyzed.
      directory = await opendir(dir);
      for await (const entry of directory) {
        if (++entriesSeen > PROJECT_LIMITS.entries || files.length >= PROJECT_LIMITS.files) {
          warn(`Scan truncated at ${PROJECT_LIMITS.files} files or ${PROJECT_LIMITS.entries} directory entries; absence of evidence is inconclusive.`);
          truncated = true;
          break;
        }
        if (excludedPart(entry.name)) continue;
        if (entry.isSymbolicLink()) { warn("Symbolic links and junctions were skipped; linked files are not evidence."); continue; }
        if (entry.isDirectory()) {
          if (depth + 1 > PROJECT_LIMITS.depth) { warn(`Directory depth limit (${PROJECT_LIMITS.depth}) reached; deeper files were not inspected.`); continue; }
          const full = path.join(dir, entry.name);
          try {
            const canonical = await realpath(full);
            if (!insideProject(root, canonical)) { warn("Paths resolving outside the selected project were skipped."); continue; }
          } catch { /* the directory's own listing reports an unreadable path */ }
          queue.push([full, depth + 1]);
          continue;
        }
        await inspect(dir, entry);
      }
    } catch (error) { warn(`Could not read directory ${safeExcerpt(projectRelative(root, dir) || ".", 120)} (${error.code || "read error"})`); }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  textFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { files, textFiles };
}

function planItems(text, limitations) {
  const items = [];
  const prose = [];
  let fenced = false;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (/^\s*(?:```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const checked = raw.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]\s+(.+)/);
    const bullet = raw.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)/);
    const todo = raw.match(/^\s*(?:TODO|FIXME|NEXT|DONE)\s*:\s*(.+)/i);
    if (checked || bullet || todo) {
      if (items.length >= PROJECT_LIMITS.itemsPerPlan) { limitations.add(`Plan items were truncated to ${PROJECT_LIMITS.itemsPerPlan} per plan.`); break; }
      items.push({ text: planExcerpt(checked?.[2] || bullet?.[1] || todo?.[1], limitations), line: index + 1, claimedComplete: !!checked && checked[1].toLowerCase() === "x" || /^\s*DONE\s*:/i.test(raw) });
    } else if (raw.trim() && !/^\s*(?:#|\||<!--)/.test(raw)) {
      if (prose.length < PROJECT_LIMITS.itemsPerPlan) prose.push({ text: planExcerpt(raw, limitations), line: index + 1, claimedComplete: false });
      else limitations.add(`Plan items were truncated to ${PROJECT_LIMITS.itemsPerPlan} per plan.`);
    }
  }
  // A prose-only design is still a useful intent to compare with this checkout.
  if (!items.length) items.push(...prose);
  return items;
}

function collectProjectPlans(textFiles, savedPlans, projectId, limitations) {
  const plans = [];
  const filePlans = [];
  const append = (plan) => {
    if (plans.length >= PROJECT_LIMITS.plans) { limitations.add(`Plan discovery truncated to ${PROJECT_LIMITS.plans} documents and saved plans.`); return; }
    plans.push(plan);
  };
  for (const file of textFiles) {
    if (!file.document) continue;
    const headings = file.lines.filter((line) => /^#{1,6}\s+/.test(line));
    if (!PLAN_NAME.test(file.file) && !headings.some((line) => /\b(?:roadmap|implementation plan|project plan|todo|next steps|backlog)\b/i.test(line))) continue;
    filePlans.push({ id: `file:${file.file}`, title: safeExcerpt(headings[0]?.replace(/^#+\s*/, "") || path.basename(file.file), 180), source: file.file, sourceType: "file", line: 1, items: planItems(file.text, limitations) });
  }
  if (!Array.isArray(savedPlans)) { limitations.add("Saved plans were unavailable or invalid."); savedPlans = []; }
  for (const plan of savedPlans.slice(0, PROJECT_LIMITS.plans)) {
    if (!plan || typeof plan !== "object") continue;
    if (plan.projectId && plan.projectId !== projectId) { limitations.add("Saved plans belonging to another project were excluded."); continue; }
    const pieces = [plan.destination, plan.spec?.text, plan.text, plan.content].filter((value) => typeof value === "string").map((value) => {
      if (value.length > PROJECT_LIMITS.fileBytes) limitations.add(`Saved plan content truncated to ${PROJECT_LIMITS.fileBytes} characters per plan.`);
      return value.slice(0, PROJECT_LIMITS.fileBytes);
    });
    let text = pieces.join("\n\n");
    if (text.length > PROJECT_LIMITS.fileBytes) { text = text.slice(0, PROJECT_LIMITS.fileBytes); limitations.add(`Saved plan content truncated to ${PROJECT_LIMITS.fileBytes} characters per plan.`); }
    let items = planItems(text, limitations);
    if (Array.isArray(plan.spec?.tasks) && plan.spec.tasks.length) {
      const tasks = plan.spec.tasks.slice(0, PROJECT_LIMITS.itemsPerPlan).filter((task) => task && typeof task === "object").map((task) => {
        const acceptance = Array.isArray(task.acceptance) ? task.acceptance : typeof task.acceptance === "string" ? [task.acceptance] : [];
        if (acceptance.length > 6) limitations.add("Saved task acceptance criteria truncated to six per task.");
        return { text: planExcerpt(`${String(task.title || "").slice(0, 180)}: ${String(task.prompt || "").slice(0, PROJECT_LIMITS.fileBytes)}`, limitations), acceptance: acceptance.slice(0, 6).map((criterion) => planExcerpt(criterion, limitations, 400)), line: 0, claimedComplete: false };
      });
      if (tasks.length + items.length > PROJECT_LIMITS.itemsPerPlan) limitations.add(`Plan items were truncated to ${PROJECT_LIMITS.itemsPerPlan} per plan.`);
      items = [...tasks, ...items].slice(0, PROJECT_LIMITS.itemsPerPlan);
      if (plan.spec.tasks.length > PROJECT_LIMITS.itemsPerPlan) limitations.add(`Plan items were truncated to ${PROJECT_LIMITS.itemsPerPlan} per plan.`);
    }
    const openQuestions = (Array.isArray(plan.questions) ? plan.questions : []).filter((item) => item && item.status !== "resolved");
    for (const question of openQuestions.slice(0, Math.max(0, PROJECT_LIMITS.itemsPerPlan - items.length))) items.push({ text: planExcerpt(question.question, limitations), line: 0, claimedComplete: false, decision: true });
    if (!items.length) items = [{ text: safeExcerpt(plan.title || "Review saved plan", 700), line: 0, claimedComplete: false }];
    const decisions = (Array.isArray(plan.questions) ? plan.questions : []).filter((question) => question?.status === "resolved");
    if (decisions.length > 12) limitations.add("Saved planning decisions truncated to twelve per plan.");
    const context = {
      destination: planExcerpt(plan.destination, limitations, 1600),
      outOfScope: planExcerpt(plan.outOfScope, limitations, 1600),
      decisions: decisions.slice(0, 12).map((question) => ({ question: planExcerpt(question.question, limitations), resolution: planExcerpt(question.resolution, limitations) })),
    };
    append({ id: `studio:${safeExcerpt(plan.id || plans.length, 160)}`, title: safeExcerpt(plan.title || "Saved plan", 180), source: "Studio plan", sourceType: "studio", sourceStatus: safeExcerpt(plan.status || "planning", 40), context, line: 0, items });
  }
  if (savedPlans.length > PROJECT_LIMITS.plans) limitations.add(`Saved plan discovery truncated to ${PROJECT_LIMITS.plans} plans.`);
  for (const plan of filePlans) append(plan);
  let remaining = PROJECT_LIMITS.items;
  for (const plan of plans) {
    if (plan.items.length > remaining) limitations.add(`Combined plan items truncated to ${PROJECT_LIMITS.items}; omitted items need a separate review.`);
    plan.items = plan.items.slice(0, remaining);
    remaining -= plan.items.length;
  }
  return plans;
}

function referencesInPlan(text, limitations) {
  const refs = [];
  // Keep traversal and Windows drive prefixes intact so they can be rejected,
  // instead of accidentally matching the harmless-looking tail of a path.
  const pattern = /(?:[A-Za-z]:[\\/]|[\\/]{1,2})?(?:\.{1,2}[\\/])?(?:[\w@.-]+[\\/])*[\w@.-]+\.(?:lua|py|js|mjs|cjs|jsx|ts|tsx|md|mdx|txt|rst|json|css|scss|ps1|cmd|html|rs|go|java|kt|swift|c|cpp|h|hpp|cs|php|vue|svelte|toml|yaml|yml)\b/g;
  const localText = text.replace(/https?:\/\/[^\s)>]+/gi, " ");
  for (const match of localText.matchAll(pattern)) {
    if (/^(?:node|next|vue|nuxt|react|express|d3|three|ember|backbone|angular|knockout|p5|nest)\.js$/i.test(match[0])) continue;
    if (!refs.includes(match[0])) refs.push(match[0]);
    if (refs.length > PROJECT_LIMITS.references) { limitations.add(`Path references truncated to ${PROJECT_LIMITS.references} per plan item.`); break; }
  }
  return refs.slice(0, PROJECT_LIMITS.references);
}

async function resolvePlanReference(root, ref, source) {
  const normalized = ref.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(ref)) return { ref, found: false, status: "outside-project" };
  const candidates = [...new Set([path.resolve(root, normalized), ...(source !== "Studio plan" ? [path.resolve(root, path.dirname(source), normalized)] : [])])];
  const statuses = new Set();
  for (const candidate of candidates) {
    if (!insideProject(root, candidate)) { statuses.add("outside-project"); continue; }
    const parts = projectRelative(root, candidate).split("/");
    if (parts.some(excludedPart)) { statuses.add("excluded"); continue; }
    let current = root, excluded = false;
    try {
      for (const part of parts) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink()) { excluded = true; break; }
      }
      if (excluded || !insideProject(root, await realpath(candidate))) { statuses.add("excluded"); continue; }
      if ((await stat(candidate)).isFile()) return { ref, found: true, status: "present", file: projectRelative(root, candidate) };
      statuses.add("missing");
    } catch (error) { statuses.add(["ENOENT", "ENOTDIR"].includes(error.code) ? "missing" : "unreadable"); }
  }
  return { ref, found: false, status: ["unreadable", "excluded", "missing", "outside-project"].find((status) => statuses.has(status)) || "missing" };
}

function planEvidence(plans, textFiles) {
  const itemQuery = (item) => [item.text, ...(item.acceptance || [])].join(" ");
  const wanted = new Set(plans.flatMap((plan) => plan.items.flatMap((item) => projectKeywords(itemQuery(item)))));
  const index = new Map([...wanted].map((word) => [word, []]));
  for (const file of textFiles.filter((item) => item.source)) {
    // Documents and test fixtures are deliberately excluded from source proof.
    // Discard obvious comment-only lines; remaining matches are only "related".
    for (const [line, raw] of file.lines.entries()) {
      if (!raw.trim() || /^\s*(?:\/\/|\/\*|\*|--|#|<!--)/.test(raw)) continue;
      const words = new Set(projectKeywords(raw));
      for (const word of words) {
        const hits = index.get(word);
        if (hits && hits.length < 16) hits.push({ file: file.file, line: line + 1, snippet: safeExcerpt(raw) });
      }
    }
  }
  for (const plan of plans) for (const item of plan.items) {
    const ranked = new Map();
    for (const word of projectKeywords(itemQuery(item))) for (const hit of index.get(word) || []) {
      const key = `${hit.file}:${hit.line}`, existing = ranked.get(key);
      ranked.set(key, { hit, score: (existing?.score || 0) + 1 });
    }
    item.evidence = [...ranked.values()].sort((a, b) => b.score - a.score || a.hit.file.localeCompare(b.hit.file) || a.hit.line - b.hit.line).slice(0, PROJECT_LIMITS.evidence).map((entry) => entry.hit);
  }
}

function projectChecks(textFiles) {
  const packageFile = textFiles.find((file) => file.file === "package.json");
  if (!packageFile) return [];
  try {
    const pkg = JSON.parse(packageFile.text), scripts = pkg.scripts || {};
    const manager = /^(pnpm|yarn|bun)@/.exec(pkg.packageManager || "")?.[1] || "npm";
    return Object.keys(scripts).filter((name) => /^(?:test|check|lint|typecheck|verify|audit)(?::[\w-]+)?$/.test(name) && typeof scripts[name] === "string").slice(0, 8).map((name) => ({ name, command: `${manager} run ${name}` }));
  } catch { return []; }
}

function startingPointsFor(inventory, plans) {
  const candidates = [];
  for (const plan of plans) for (const item of plan.items) {
    const missing = item.references.filter((ref) => ref.status === "missing");
    const unsupported = item.claimedComplete && !item.evidence.length;
    const priority = missing.length ? 100 : unsupported ? 90 : item.decision ? 80 : !item.claimedComplete && item.evidence.length ? 70 : !item.claimedComplete ? 60 : 30;
    const origin = plan.sourceType === "file" ? [{ file: plan.source, line: item.line || 1, snippet: item.text }] : [];
    const scopeReminder = plan.context?.outOfScope || plan.context?.decisions?.length ? " Honor the plan's recorded decisions and scope boundaries." : "";
    candidates.push({
      priority,
      title: safeExcerpt(missing.length ? `Reconcile missing paths: ${missing.map((ref) => ref.ref).join(", ")}` : item.claimedComplete ? `Verify completed claim: ${item.text}` : item.decision ? `Resolve decision: ${item.text}` : `Continue: ${item.text}`, 140),
      reason: missing.length ? `${plan.title} references ${missing.length} missing file${missing.length === 1 ? "" : "s"}. The plan may be stale or the work may still be needed.` : unsupported ? `${plan.title} marks this complete, but the inspected source contains no related implementation evidence.` : item.evidence.length ? `${plan.title} describes this work and related source exists. Confirm its current behavior before extending it.` : `This intent in ${plan.title} has no related source evidence in this scan.`,
      firstStep: (missing.length ? `Locate any replacement for ${missing[0].ref}; reconcile the plan with this checkout before implementing it.` : item.evidence.length ? `Read ${item.evidence[0].file}:${item.evidence[0].line}, compare it with the plan, and identify one observable gap.` : `Review “${item.text.slice(0, 170)}” and define one small user-visible outcome with an acceptance check.`) + scopeReminder,
      acceptance: item.acceptance?.length ? `Run and record these planned acceptance checks: ${item.acceptance.join("; ")}` : "Record the current behavior and an observable pass/fail check; update the plan only after that check is run.",
      evidence: [...origin, ...item.evidence].slice(0, 5),
    });
  }
  if (!plans.length) candidates.push({ priority: 80, title: inventory.sourceFiles ? "Write a baseline plan for this project" : "Define the first working slice", reason: inventory.sourceFiles ? "No prior plans were found in the inspected project. Start from its existing behavior." : "No source files were found in the inspected project.", firstStep: inventory.entryPoints.length ? `Read ${inventory.entryPoints.slice(0, 3).join(", ")} and describe the project's purpose, one core flow, and the next gap.` : "Write a short README with the intended user, the problem to solve, and the smallest end-to-end flow.", acceptance: "One clear outcome, explicit scope, and a concrete acceptance example are recorded before implementation.", evidence: [] });
  if (!inventory.testFiles) candidates.push({ priority: 50, title: "Establish a repeatable baseline check", reason: "No test source files were found in the inspected project.", firstStep: inventory.checks.length ? `Inspect the declared ${inventory.checks[0].command} command, then run the documented check and record its result.` : "Document how to start the project and add one smoke check for its core flow.", acceptance: "A fresh checkout has a documented command and one observable success or failure result.", evidence: [] });
  if (!candidates.length) candidates.push({ priority: 40, title: "Confirm the current project baseline", reason: "No actionable plan items were extracted from the inspected project.", firstStep: "Read the entry points and test instructions, run the documented checks, and capture one concrete improvement.", acceptance: "Record the current test result and a scoped next change with an acceptance check.", evidence: [] });
  return candidates.sort((a, b) => b.priority - a.priority).slice(0, 6).map(({ priority, ...point }) => point);
}

export async function analyzeProject({ root = DEFAULT_ROOT, plans: savedPlans = [], projectId = null } = {}) {
  if (typeof root !== "string" || !root.trim()) throw new Error("Choose a project folder before analyzing it.");
  let canonical;
  try { canonical = await realpath(path.resolve(root)); if (!(await stat(canonical)).isDirectory()) throw new Error(); }
  catch { throw new Error("The selected project folder is unavailable."); }
  const limitations = new Set(["Static local analysis only: file presence and related text do not verify implementation or runtime behavior; no commands or tests were run.", "Hidden, dependency, build, private, data, log and credential paths are excluded. Missing evidence can reflect exclusions or scan limits."]);
  const { files, textFiles } = await projectInventory(canonical, limitations);
  const plans = collectProjectPlans(textFiles, savedPlans, projectId, limitations);
  planEvidence(plans, textFiles);
  for (const plan of plans) {
    for (const item of plan.items) {
      item.references = await Promise.all(referencesInPlan([item.text, ...(item.acceptance || [])].join(" "), limitations).map((ref) => resolvePlanReference(canonical, ref, plan.source)));
      item.status = item.references.some((ref) => ref.status === "missing") ? "missing-reference" : item.evidence.length ? "related" : item.claimedComplete ? "unverified" : "open";
    }
    plan.status = plan.items.some((item) => item.status === "missing-reference") ? "missing-reference" : plan.items.some((item) => item.status === "unverified") ? "unverified" : plan.items.some((item) => item.status === "related") ? "related" : "open";
  }
  const languages = new Map();
  for (const file of files.filter((entry) => entry.source)) { const name = PROJECT_LANGUAGES[path.extname(file.file).toLowerCase()] || "Source"; languages.set(name, (languages.get(name) || 0) + 1); }
  const inventory = { files: files.length, sourceFiles: files.filter((file) => file.source).length, testFiles: files.filter((file) => file.test).length, documents: files.filter((file) => file.document).length, languages: [...languages].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), entryPoints: files.filter(({ file }) => /(?:^|\/)(?:README(?:\.[\w]+)?|package\.json|Cargo\.toml|pyproject\.toml|go\.mod|Makefile|CMakeLists\.txt|(?:main|index|app|server)\.(?:[cm]?js|jsx|tsx?|py|lua|go|rs|html))$/i.test(file)).slice(0, 12).map((file) => file.file), checks: projectChecks(textFiles) };
  const items = plans.flatMap((plan) => plan.items);
  return { kind: "project", name: path.basename(canonical), projectId, analyzedAt: new Date().toISOString(), summary: { files: files.length, plans: plans.length, items: items.length, related: items.filter((item) => item.status === "related").length, missingReferences: items.flatMap((item) => item.references).filter((ref) => ref.status === "missing").length, claimedComplete: items.filter((item) => item.claimedComplete).length, unverified: items.filter((item) => item.status === "unverified").length, open: items.filter((item) => item.status === "open").length }, inventory, plans, startingPoints: startingPointsFor(inventory, plans), limitations: [...limitations] };
}

async function cli() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : DEFAULT_ROOT;
  const fileIndex = args.indexOf("--file");
  const ideaIndex = args.indexOf("--idea");
  if (args.includes("--project")) {
    console.log(JSON.stringify(await analyzeProject({ root }), null, 2));
    return;
  }
  if (fileIndex >= 0) {
    console.log(JSON.stringify(await analyzeFile(args[fileIndex + 1], { root }), null, 2));
    return;
  }
  if (ideaIndex >= 0) {
    console.log(JSON.stringify(await verifyIdea(args[ideaIndex + 1], { root }), null, 2));
    return;
  }
  console.error("usage: node scripts/analyzer.mjs --project | --file <path> | --idea <text> [--root <repo>]");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
