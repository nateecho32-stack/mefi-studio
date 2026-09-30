// Studio's own model probes: small, fixed, synthetic tasks, one per task kind,
// each with a strict output format and a deterministic scorer. They are
// measured evidence of Studio's own, kept apart from the runner-verified task
// wins and losses in the model ledger, and weaker than them: a probe is a
// minute of synthetic work, not a verified task.
//
// This module holds the probe set, the scorers, the results store's shape and
// the summary routing reads. It never calls a model and never decides when to
// run: the host runs probes only when the owner clicks Run probes. The scorers
// for the code-writing probes run the model's code in a child `node` process,
// in a fresh temp folder, with a timeout and an environment that carries no
// keys, proxies or tokens (runNode below; tests inject their own).
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROBE_KINDS = Object.freeze(["planning", "structuring", "coding", "writing", "commits", "tests", "setup"]);
export const PROBE_MAX_TOKENS = 1500;
export const PROBE_RUNS_KEPT = 5;
export const PROBE_TIMEOUT_MS = 15000;
const STORE_SCHEMA = 1;
const MAX_REPLY = 20000;

const check = (name, ok, detail = "") => ({ name, ok: Boolean(ok), detail: String(detail).slice(0, 160) });
function verdict(checks) {
  const passed = checks.filter((item) => item.ok).length;
  return { passed: checks.length > 0 && passed === checks.length, score: checks.length ? Math.round((passed / checks.length) * 1000) / 1000 : 0, checks };
}
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value.slice(0, MAX_REPLY) : "";

/** The body of the first fenced block, or the whole reply when it has none. */
export function unfence(reply) {
  const body = text(reply).trim();
  const fenced = /```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/.exec(body);
  return (fenced ? fenced[1] : body).trim();
}

/** Parse the one JSON object a reply should be, tolerating a fence or prose around it. */
export function jsonOf(reply) {
  const body = unfence(reply);
  for (const candidate of [body, body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)]) {
    try {
      const value = JSON.parse(candidate);
      if (isObject(value)) return value;
    } catch { /* try the next shape */ }
  }
  return null;
}

// ---- the sandbox --------------------------------------------------------------

// Imports a probe's code may not reach for: the network, other processes,
// threads, and the file system. Checked before anything runs.
const FORBIDDEN_CODE = /\b(child_process|worker_threads|cluster|dgram|net|tls|https?|http2|dns|inspector|vm|fs|fs\/promises)\b["']|\bfetch\s*\(|\bprocess\.(env|exit|kill|binding|dlopen)\b|\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/;
export function forbiddenCode(source) {
  const match = FORBIDDEN_CODE.exec(String(source ?? ""));
  return match ? match[0] : null;
}

// The child sees PATH and the Windows basics, nothing else: no keys, tokens,
// proxies or NODE_OPTIONS from the host.
function childEnv(extra = {}) {
  const env = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) if (process.env[name]) env[name] = process.env[name];
  return { ...env, NO_COLOR: "1", ...extra };
}

/**
 * Write `files` into a fresh temp folder, run `node <args>` there, and remove
 * the folder. Resolves { code, stdout, stderr, timedOut }; never rejects.
 * `execPath`/`env` let the Electron host run itself as Node.
 */
export async function runNode({ files = {}, args = [], timeoutMs = PROBE_TIMEOUT_MS, execPath = process.execPath, env = {} } = {}) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "mefi-probe-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      if (!/^(?!.*\.\.)[a-z0-9_-][a-z0-9_.-]*(\/[a-z0-9_-][a-z0-9_.-]*)?\.m?js$/i.test(name)) return { code: null, stdout: "", stderr: `refused file name ${name}`, timedOut: false };
      await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
      await writeFile(path.join(folder, name), String(content), "utf8");
    }
    return await new Promise((resolve) => {
      let stdout = "", stderr = "", timedOut = false, settled = false;
      const child = spawn(execPath, args, { cwd: folder, env: childEnv(env), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      const cap = (value, chunk) => (value + chunk).slice(-20000);
      child.stdout.on("data", (chunk) => { stdout = cap(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = cap(stderr, chunk); });
      const finish = (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); };
      child.on("error", (error) => { stderr += String(error?.message ?? error); finish(null); });
      child.on("close", (code) => finish(code));
    });
  } finally {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
}

// The last line of a harness's stdout, as JSON.
function harnessResult(run) {
  const line = String(run?.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
  try { return JSON.parse(line); } catch { return null; }
}

// ---- the probes ---------------------------------------------------------------

const SYSTEM = "You are being evaluated on a small, self-contained task. Follow the output format exactly. Do not ask questions and do not add commentary outside the requested format.";

const PLANNING_FILES = ["src/cli.mjs", "src/store.mjs", "test/store.test.mjs", "README.md"];
const planning = {
  kind: "planning",
  title: "Plan a three-requirement change",
  user: [
    "A small Node.js command-line notes tool has these files: src/cli.mjs (argument parsing), src/store.mjs (reads and writes notes.json), test/store.test.mjs (node:test tests), README.md.",
    "Plan this change. Requirements:",
    "R1: `notes add \"text\" --tag <name>` stores a tag with the note.",
    "R2: `notes list --tag <name>` lists only notes with that tag.",
    "R3: tags persist in notes.json, and an existing notes.json written before tags existed still loads.",
    "Return only JSON, no fence: {\"steps\":[{\"id\":1,\"action\":\"what to change\",\"files\":[\"src/store.mjs\"],\"verify\":\"how to check this step\",\"covers\":[\"R1\"]}]}",
    "Use 2 to 10 steps. Name only the files listed above, or new files under src/ or test/ ending in .mjs.",
  ].join("\n"),
  score(reply) {
    const plan = jsonOf(reply);
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const checks = [check("json-steps", steps.length >= 2 && steps.length <= 10, `${steps.length} steps`)];
    const nonEmpty = (value) => typeof value === "string" && value.trim().length > 3;
    checks.push(check("step-fields", steps.length > 0 && steps.every((step) => nonEmpty(step?.action) && Array.isArray(step?.files) && step.files.length > 0 && step.files.every((file) => typeof file === "string") && nonEmpty(step?.verify)), "each step has an action, files and a verification"));
    const allowed = (file) => PLANNING_FILES.includes(file) || /^(src|test)\/[a-z0-9_.-]+\.mjs$/i.test(file);
    const files = steps.flatMap((step) => Array.isArray(step?.files) ? step.files : []);
    const invented = files.filter((file) => typeof file !== "string" || !allowed(file));
    checks.push(check("known-files", files.length > 0 && !invented.length, invented.length ? `unexpected: ${invented.slice(0, 3).join(", ")}` : "only the named files"));
    const covered = new Set(steps.flatMap((step) => Array.isArray(step?.covers) ? step.covers.map((item) => String(item).toUpperCase().trim()) : []));
    const missing = ["R1", "R2", "R3"].filter((id) => !covered.has(id));
    checks.push(check("covers-requirements", !missing.length, missing.length ? `missing ${missing.join(", ")}` : "R1, R2 and R3 covered"));
    checks.push(check("concrete-verification", steps.length > 0 && steps.every((step) => /\b(test|node|npm|run|assert|expect|check|list|add)\b/i.test(String(step?.verify ?? ""))), "each verification names a command or test"));
    const legacy = steps.some((step) => /\b(old|older|existing|legacy|missing|without tags?|no tags?|default|backward|migrat)/i.test(`${step?.action ?? ""} ${step?.verify ?? ""}`));
    checks.push(check("old-files-load", legacy, "a step handles notes.json written before tags"));
    return verdict(checks);
  },
};

const MESSY_MODULE = [
  "var counter = 0;",
  "function fmtDate(d) { counter++; return d.toISOString().slice(0, 10); }",
  "function addDays(d, n) { counter++; const r = new Date(d.getTime()); r.setUTCDate(r.getUTCDate() + n); return r; }",
  "function slugify(s) { counter++; return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, \"-\").replace(/^-|-$/g, \"\"); }",
  "function titleCase(s) { counter++; return String(s).split(\" \").map((w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(\" \"); }",
  "function cents(amount) { counter++; return Math.round(amount * 100); }",
  "function formatMoney(c) { counter++; return \"$\" + (c / 100).toFixed(2); }",
  "function calls() { return counter; }",
  "module.exports = { fmtDate, addDays, slugify, titleCase, cents, formatMoney, calls };",
].join("\n");
const GROUPS = [["fmtDate", "addDays"], ["slugify", "titleCase"], ["cents", "formatMoney"]];
const STRUCTURING_HARNESS = [
  "const paths = JSON.parse(process.argv[2]);",
  "const found = {};",
  "const mods = [];",
  "for (const file of paths) {",
  "  const mod = await import(new URL(file, import.meta.url).href);",
  "  mods.push(mod);",
  "  for (const name of Object.keys(mod)) (found[name] ??= []).push(file);",
  "}",
  "const fn = (name) => mods.map((mod) => mod[name]).find((value) => typeof value === \"function\");",
  "const results = {};",
  "const tryIt = (name, run) => { try { results[name] = run() === true; } catch { results[name] = false; } };",
  "tryIt(\"fmtDate\", () => fn(\"fmtDate\")(new Date(Date.UTC(2026, 0, 5))) === \"2026-01-05\");",
  "tryIt(\"addDays\", () => fn(\"addDays\")(new Date(Date.UTC(2026, 0, 30)), 3).toISOString().slice(0, 10) === \"2026-02-02\");",
  "tryIt(\"slugify\", () => fn(\"slugify\")(\"  Hello, World! \") === \"hello-world\");",
  "tryIt(\"titleCase\", () => fn(\"titleCase\")(\"hELLO wORLD\") === \"Hello World\");",
  "tryIt(\"cents\", () => fn(\"cents\")(19.99) === 1999);",
  "tryIt(\"formatMoney\", () => fn(\"formatMoney\")(1999) === \"$19.99\");",
  "console.log(JSON.stringify({ found, results }));",
].join("\n");
const structuring = {
  kind: "structuring",
  title: "Split a messy module by concern",
  user: [
    "Split this CommonJS module into ES modules grouped by concern (dates, strings, money).",
    "Keep every function's name and behaviour. Use named exports only (no default export, no module.exports).",
    "Remove the call counter and the calls() function: nothing uses them. Keep no module-level mutable state.",
    "",
    MESSY_MODULE,
    "",
    "Return only JSON, no fence: {\"modules\":[{\"path\":\"src/dates.mjs\",\"exports\":[\"fmtDate\"],\"code\":\"export function fmtDate(d) { ... }\"}]}",
    "Paths must look like src/<name>.mjs. Use 2 to 5 modules.",
  ].join("\n"),
  async score(reply, { runNode: run = runNode } = {}) {
    const plan = jsonOf(reply);
    const modules = Array.isArray(plan?.modules) ? plan.modules : [];
    const checks = [check("json-modules", modules.length >= 2 && modules.length <= 5, `${modules.length} modules`)];
    const valid = modules.every((mod) => typeof mod?.path === "string" && /^src\/[a-z0-9_-]+\.mjs$/i.test(mod.path) && typeof mod?.code === "string" && mod.code.length < 8000);
    const unique = new Set(modules.map((mod) => mod?.path)).size === modules.length;
    checks.push(check("paths", modules.length > 0 && valid && unique, "src/<name>.mjs, unique"));
    const code = modules.map((mod) => String(mod?.code ?? "")).join("\n");
    const forbidden = forbiddenCode(code);
    checks.push(check("no-module-exports", modules.length > 0 && !/module\.exports|export\s+default/.test(code), "named exports only"));
    checks.push(check("no-mutable-state", modules.length > 0 && !/^\s*(let|var)\s/m.test(code) && !/\bcounter\b/.test(code), "no module-level let/var, counter removed"));
    let harness = null;
    if (valid && unique && modules.length && !forbidden) {
      const files = Object.fromEntries(modules.map((mod) => [mod.path.replace(/\.mjs$/i, ".mjs"), mod.code]));
      files["harness.mjs"] = STRUCTURING_HARNESS;
      harness = harnessResult(await run({ files, args: ["harness.mjs", JSON.stringify(modules.map((mod) => `./${mod.path}`))] }));
    }
    const found = isObject(harness?.found) ? harness.found : {};
    const names = GROUPS.flat();
    const once = names.every((name) => Array.isArray(found[name]) && found[name].length === 1);
    checks.push(check("exports-once", once && !found.calls, once ? (found.calls ? "calls() still exported" : "each function exported once") : forbidden ? `refused: ${forbidden}` : "a function is missing or exported twice"));
    const together = GROUPS.every((group) => group.every((name) => Array.isArray(found[name]) && found[name][0] === found[group[0]]?.[0]))
      && new Set(GROUPS.map((group) => found[group[0]]?.[0])).size === GROUPS.length;
    checks.push(check("cohesion", together, "dates, strings and money each in their own module"));
    const behaviour = isObject(harness?.results) && names.every((name) => harness.results[name] === true);
    checks.push(check("behaviour", behaviour, behaviour ? "all six functions behave as before" : `failed: ${names.filter((name) => harness?.results?.[name] !== true).join(", ") || "harness did not run"}`));
    return verdict(checks);
  },
};

const CODING_HARNESS = [
  "import { mergeIntervals } from \"./solution.mjs\";",
  "const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);",
  "const results = {};",
  "const tryIt = (name, run) => { try { results[name] = run() === true; } catch { results[name] = false; } };",
  "const throwsType = (run) => { try { run(); return false; } catch (error) { return error instanceof TypeError; } };",
  "tryIt(\"merges-overlaps\", () => same(mergeIntervals([[1, 3], [2, 6], [8, 10]]), [[1, 6], [8, 10]]));",
  "tryIt(\"merges-touching\", () => same(mergeIntervals([[1, 2], [2, 3]]), [[1, 3]]));",
  "tryIt(\"sorts-input\", () => same(mergeIntervals([[8, 9], [1, 4], [3, 5]]), [[1, 5], [8, 9]]));",
  "tryIt(\"empty\", () => same(mergeIntervals([]), []));",
  "tryIt(\"contained\", () => same(mergeIntervals([[1, 10], [2, 3], [4, 5]]), [[1, 10]]));",
  "tryIt(\"no-mutation\", () => { const input = [[5, 6], [1, 2]]; mergeIntervals(input); return same(input, [[5, 6], [1, 2]]); });",
  "tryIt(\"rejects-non-array\", () => throwsType(() => mergeIntervals(\"1-2\")));",
  "tryIt(\"rejects-reversed\", () => throwsType(() => mergeIntervals([[3, 1]])));",
  "console.log(JSON.stringify({ results }));",
].join("\n");
const CODING_CASES = ["merges-overlaps", "merges-touching", "sorts-input", "empty", "contained", "no-mutation", "rejects-non-array", "rejects-reversed"];
const coding = {
  kind: "coding",
  title: "Implement a small pure function",
  user: [
    "Write an ES module that exports `mergeIntervals(list)`.",
    "- `list` is an array of [start, end] integer pairs with start <= end.",
    "- Return a new array of merged intervals sorted by start. Overlapping or touching intervals merge ([1,2] and [2,3] become [1,3]).",
    "- Do not mutate the input.",
    "- Throw a TypeError when `list` is not an array or a pair has start > end.",
    "Return only the module source code. No explanation. Use no imports.",
  ].join("\n"),
  async score(reply, { runNode: run = runNode } = {}) {
    const code = unfence(reply);
    const forbidden = forbiddenCode(code);
    const checks = [check("exports-function", /export\s+(function\s+mergeIntervals\b|const\s+mergeIntervals\b|\{[^}]*\bmergeIntervals\b)/.test(code), "exports mergeIntervals"), check("no-forbidden-code", !forbidden, forbidden ? `refused: ${forbidden}` : "no imports, I/O or process access")];
    const harness = !forbidden && checks[0].ok ? harnessResult(await run({ files: { "solution.mjs": code, "harness.mjs": CODING_HARNESS }, args: ["harness.mjs"] })) : null;
    for (const name of CODING_CASES) checks.push(check(name, harness?.results?.[name] === true, harness ? "" : "did not run"));
    return verdict(checks);
  },
};

const WRITING_FACTS = [
  ["probes-under-models", /\bprobes?\b/i, /\bmodels\b/i],
  ["runs-on-click", /\b(click|clicked|clicking|on demand|when you (run|ask|press|choose|start))\b/i],
  ["token-cap", /\b1,?500\b/, /\btokens?\b/i],
  // "last 5 runs", "five most recent runs"; the 5 in "0.5" does not count.
  ["keeps-five-runs", /(?:^|[^\d.,])(?:5|five)\s+(?:[a-z-]+\s+){0,3}runs?\b/i],
];
const WRITING_BANNED = [/\b(daily|weekly|nightly|hourly)\b/i, /\bschedul/i, /\bfree\b/i, /\bbeta\b/i, /\b\d+(\.\d+)?\s?%/, /\b(?!0\.5\b)\d+\.\d+(\.\d+)?\b/, /\b(10|ten|3|three|20|twenty)\s+runs?\b/i, /\b(windows|macos|linux)\b/i];
const writing = {
  kind: "writing",
  title: "State four facts in a short paragraph",
  user: [
    "Write one release-notes paragraph for Studio 0.5 that states these four facts and nothing else:",
    "1. A Probes button now appears under Models.",
    "2. Probes run only when you click it.",
    "3. Each probe uses at most 1,500 output tokens.",
    "4. Studio keeps the last 5 runs per model.",
    "At most 80 words. Plain text: one paragraph, no heading, no list, no quotation marks around it.",
  ].join("\n"),
  score(reply) {
    const body = text(reply).trim();
    const words = body.split(/\s+/).filter(Boolean).length;
    const checks = [
      check("one-paragraph", body && !/\n\s*\n/.test(body) && !/^\s*([-*#>]|\d+[.)])\s/m.test(body), "no blank lines, headings or list markers"),
      check("word-limit", words > 0 && words <= 80, `${words} words`),
    ];
    for (const [name, ...patterns] of WRITING_FACTS) checks.push(check(name, patterns.every((pattern) => pattern.test(body))));
    const invented = WRITING_BANNED.map((pattern) => pattern.exec(body)?.[0]).filter(Boolean);
    checks.push(check("no-invented-facts", !invented.length, invented.length ? `invented: ${invented.slice(0, 3).join(", ")}` : "nothing beyond the four facts"));
    return verdict(checks);
  },
};

const NON_IMPERATIVE = /^(added|adds|adding|updated|updates|updating|fixed|fixes|fixing|implemented|implements|implementing|created|creates|creating|introduced|introduces|introducing|changed|changes|changing|removed|removes|removing|this|these|the|a|an|wip)$/i;
const commits = {
  kind: "commits",
  title: "Write a commit message for a described diff",
  user: [
    "Write the git commit message for this change. The diff touches four files:",
    "- renderer/model-lab.js (+40 -3): adds a Probes panel with Run and Cancel buttons.",
    "- main.cjs (+60): a new models:probe-run IPC handler that runs the probes one at a time.",
    "- preload.cjs (+2): exposes modelProbeRun and modelProbeCancel to the renderer.",
    "- tests/model_probes.test.mjs (+120): new tests for the probe scorers.",
    "Return only the commit message: a subject line, a blank line, then a body wrapped at 72 characters. No code fence, no quotes, no trailers.",
  ].join("\n"),
  score(reply) {
    const body = text(reply).replace(/^```[a-z]*\s*\n|\n```\s*$/gi, "").replace(/\r\n/g, "\n").trim();
    const lines = body.split("\n");
    const subject = lines[0] ?? "";
    const first = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").split(/\s+/)[0] ?? "";
    const bodyLines = lines.slice(2);
    const covered = [/\b(main|ipc|handler|probe-run)\b/i, /\bpreload\b/i, /\btests?\b/i, /\b(model-lab|panel|button|ui|renderer)\b/i].filter((pattern) => pattern.test(lines.slice(1).join(" "))).length;
    return verdict([
      check("subject-length", subject.length > 0 && subject.length <= 72, `${subject.length} characters`),
      check("imperative", /^[A-Za-z]/.test(first) && !NON_IMPERATIVE.test(first) && !/(ed|ing)$/i.test(first), `starts with "${first.slice(0, 20)}"`),
      check("names-area", /\b(probes?|models?)\b/i.test(subject), "the subject names the probes or Models"),
      check("no-trailing-period", subject.length > 0 && !/\.$/.test(subject)),
      check("blank-line", lines.length >= 3 && lines[1] === "", "a blank second line"),
      check("body-wrapped", bodyLines.some((line) => line.trim()) && bodyLines.every((line) => line.length <= 72), "body lines at most 72 characters"),
      check("body-covers-change", covered >= 3, `${covered} of 4 parts described`),
    ]);
  },
};

const DURATION_CORRECT = [
  "export function parseDuration(text) {",
  "  if (typeof text !== \"string\") return null;",
  "  const value = text.trim();",
  "  if (/^\\d+$/.test(value)) return Number(value);",
  "  const match = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(value);",
  "  if (!match || !value) return null;",
  "  const [, h = \"0\", m = \"0\", s = \"0\"] = match;",
  "  return Number(h) * 3600 + Number(m) * 60 + Number(s);",
  "}",
].join("\n");
// Two plausible bugs a useful test suite must catch.
const DURATION_BUGS = {
  "hours-as-minutes": DURATION_CORRECT.replace("Number(h) * 3600", "Number(h) * 60"),
  "zero-for-invalid": DURATION_CORRECT.replace("if (!match || !value) return null;", "if (!match || !value) return 0;"),
};
const tests = {
  kind: "tests",
  title: "Write tests that catch real bugs",
  user: [
    "Write a node:test test file for this function. The file will be saved as probe.test.mjs next to duration.mjs.",
    "",
    DURATION_CORRECT,
    "",
    "Behaviour: \"90s\" -> 90, \"5m\" -> 300, \"2h\" -> 7200, \"1h30m\" -> 5400, \"45\" -> 45 (plain seconds); anything invalid (\"\", \"abc\", \"5x\", a non-string) -> null.",
    "Import it with: import { parseDuration } from \"./duration.mjs\";",
    "Use node:test and node:assert/strict. No other imports. Return only the test file's source code.",
  ].join("\n"),
  async score(reply, { runNode: run = runNode } = {}) {
    const code = unfence(reply);
    const forbidden = forbiddenCode(code.replace(/from\s+["'](node:test|node:assert(\/strict)?|\.\/duration\.mjs)["']/g, ""));
    const shaped = /from\s+["']node:test["']/.test(code) && /from\s+["']\.\/duration\.mjs["']/.test(code) && /\bparseDuration\b/.test(code);
    const checks = [check("test-file", shaped, "imports node:test and ./duration.mjs"), check("no-forbidden-code", !forbidden, forbidden ? `refused: ${forbidden}` : "no I/O, network or process access")];
    const runWith = async (implementation) => run({ files: { "duration.mjs": implementation, "probe.test.mjs": code }, args: ["--test", "--test-reporter=dot", "probe.test.mjs"] });
    if (shaped && !forbidden) {
      const good = await runWith(DURATION_CORRECT);
      checks.push(check("passes-correct", good.code === 0 && !good.timedOut, good.timedOut ? "timed out" : `exit ${good.code}`));
      for (const [name, implementation] of Object.entries(DURATION_BUGS)) {
        const bad = await runWith(implementation);
        checks.push(check(`catches-${name}`, good.code === 0 && bad.code !== 0 && bad.code !== null && !bad.timedOut, bad.timedOut ? "timed out" : `exit ${bad.code}`));
      }
    } else {
      for (const name of ["passes-correct", ...Object.keys(DURATION_BUGS).map((bug) => `catches-${bug}`)]) checks.push(check(name, false, "did not run"));
    }
    return verdict(checks);
  },
};

const setup = {
  kind: "setup",
  title: "Set up a small Node service",
  user: [
    "Set up a new Node.js 24 web service. Its entry file is server.mjs and it uses ES modules and express version 5.",
    "Tests use the built-in node:test runner (no test framework dependency). It reads PORT and DATABASE_URL from the environment.",
    "Return only JSON, no fence, with exactly these keys:",
    "{\"packageJson\": {the package.json object}, \"gitignore\": [\"one .gitignore line per entry\"], \"envExample\": {\"NAME\": \"example value\"}}",
    "Commit-safe: .env must be ignored, .env.example must not be, and example values must not look like real credentials.",
  ].join("\n"),
  score(reply) {
    const plan = jsonOf(reply);
    const pkg = isObject(plan?.packageJson) ? plan.packageJson : null;
    const ignore = Array.isArray(plan?.gitignore) ? plan.gitignore.filter((line) => typeof line === "string").map((line) => line.trim()) : [];
    const env = isObject(plan?.envExample) ? plan.envExample : null;
    const scripts = isObject(pkg?.scripts) ? pkg.scripts : {};
    const deps = isObject(pkg?.dependencies) ? pkg.dependencies : {};
    const devDeps = isObject(pkg?.devDependencies) ? pkg.devDependencies : {};
    const ignored = (name) => ignore.some((line) => line === name || line === `/${name}` || line === `${name}/` || line === `/${name}/` || (line.endsWith("*") && name.startsWith(line.replace(/^\//, "").slice(0, -1))));
    const unignored = (name) => ignore.includes(`!${name}`);
    const envValues = env ? Object.values(env).map((value) => String(value ?? "")) : [];
    return verdict([
      check("json-shape", Boolean(pkg && env && ignore.length), "packageJson, gitignore and envExample"),
      check("esm", pkg?.type === "module"),
      check("engines-node-24", /^>=\s*24(\.\d+){0,2}$/.test(String(pkg?.engines?.node ?? "").trim()), String(pkg?.engines?.node ?? "missing")),
      check("start-script", /\bnode\s+(\.\/)?server\.mjs\b/.test(String(scripts.start ?? ""))),
      check("test-script", /\bnode\s+--test\b/.test(String(scripts.test ?? ""))),
      check("dependencies", /^[\^~]?5(\.|$)/.test(String(deps.express ?? "")) && Object.keys(deps).length === 1 && Object.keys(devDeps).length === 0, `${Object.keys(deps).join(", ") || "none"}${Object.keys(devDeps).length ? ` + dev ${Object.keys(devDeps).join(", ")}` : ""}`),
      check("gitignore", ignored("node_modules") && ignored(".env") && (!ignored(".env.example") || unignored(".env.example")), "node_modules and .env ignored, .env.example kept"),
      check("env-example", Boolean(env) && Object.hasOwn(env, "PORT") && Object.hasOwn(env, "DATABASE_URL") && Object.keys(env).length <= 4 && envValues.every((value) => !/:[^:@/\s]+@/.test(value) && !/[A-Za-z0-9+/_-]{32,}/.test(value)), "PORT and DATABASE_URL, no credential-looking values"),
    ]);
  },
};

export const PROBES = Object.freeze([planning, structuring, coding, writing, commits, tests, setup].map((probe) => Object.freeze({ ...probe, system: SYSTEM, maxTokens: PROBE_MAX_TOKENS })));
export const probeFor = (kind) => PROBES.find((probe) => probe.kind === kind) ?? null;

/** Score one reply; a scorer that throws scores 0 with the reason. */
export async function scoreProbe(kind, reply, options = {}) {
  const probe = probeFor(kind);
  if (!probe) return { passed: false, score: 0, checks: [check("known-probe", false, kind)] };
  try { return await probe.score(text(reply), options); }
  catch (error) { return { passed: false, score: 0, checks: [check("scorer", false, error?.message ?? String(error))] }; }
}

// ---- the results store --------------------------------------------------------
// userData/model-probes.json: { schema: 1, models: { "provider::model": {
//   provider, model, kinds: { <kind>: [run, ...newest first, at most 5] } } } }
// A run is { at, passed, score (0-1, or null when the call itself failed),
// checks: [{ name, ok, detail }], elapsedMs, error }.

const keyOf = (provider, model) => `${provider}::${model}`;
const idOk = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
function normalizeRun(run) {
  if (!isObject(run) || !Number.isFinite(run.at)) return null;
  const score = typeof run.score === "number" && run.score >= 0 && run.score <= 1 ? run.score : null;
  return {
    at: run.at, passed: run.passed === true && score !== null, score,
    checks: (Array.isArray(run.checks) ? run.checks : []).slice(0, 16).filter(isObject).map((item) => check(String(item.name ?? "").slice(0, 40), item.ok === true, typeof item.detail === "string" ? item.detail : "")),
    elapsedMs: Number.isFinite(run.elapsedMs) && run.elapsedMs >= 0 ? run.elapsedMs : null,
    error: typeof run.error === "string" && run.error ? run.error.slice(0, 200) : null,
  };
}

/** A clean store from whatever was on disk. */
export function normalizeProbeStore(value) {
  const store = { schema: STORE_SCHEMA, models: {} };
  if (!isObject(value) || value.schema !== STORE_SCHEMA || !isObject(value.models)) return store;
  for (const entry of Object.values(value.models).slice(0, 200)) {
    if (!isObject(entry) || !idOk(entry.provider, 60) || !idOk(entry.model, 160)) continue;
    const kinds = {};
    for (const kind of PROBE_KINDS) {
      const runs = (Array.isArray(entry.kinds?.[kind]) ? entry.kinds[kind] : []).map(normalizeRun).filter(Boolean).slice(0, PROBE_RUNS_KEPT);
      if (runs.length) kinds[kind] = runs;
    }
    store.models[keyOf(entry.provider, entry.model)] = { provider: entry.provider, model: entry.model, kinds };
  }
  return store;
}

/** The store with one more run, keeping the newest PROBE_RUNS_KEPT per kind. */
export function recordProbeRun(store, { provider, model, kind, run }) {
  const next = normalizeProbeStore(store);
  const clean = normalizeRun(run);
  if (!clean || !PROBE_KINDS.includes(kind) || !idOk(provider, 60) || !idOk(model, 160)) return next;
  const key = keyOf(provider, model);
  const entry = next.models[key] ?? { provider, model, kinds: {} };
  entry.kinds[kind] = [clean, ...(entry.kinds[kind] ?? [])].slice(0, PROBE_RUNS_KEPT);
  next.models[key] = entry;
  return next;
}

/** One model's runs per kind, newest first. */
export function probeRunsFor(store, { provider, model } = {}) {
  return normalizeProbeStore(store).models[keyOf(provider, model)]?.kinds ?? {};
}

/**
 * What routing reads: per requested kind, the scored runs (a failed call is
 * not a score) with their mean and the latest one. Null when there is none.
 */
export function probeSummary(store, { provider, model, kinds = [] } = {}) {
  const runs = probeRunsFor(store, { provider, model });
  const out = {};
  for (const kind of Array.isArray(kinds) ? kinds : []) {
    const scored = (runs[kind] ?? []).filter((run) => run.score !== null);
    if (!scored.length) continue;
    const latest = scored[0];
    out[kind] = {
      runs: scored.length, passedRuns: scored.filter((run) => run.passed).length,
      meanScore: Math.round((scored.reduce((sum, run) => sum + run.score, 0) / scored.length) * 1000) / 1000,
      latest: { at: latest.at, passed: latest.passed, score: latest.score, checksPassed: latest.checks.filter((item) => item.ok).length, checksTotal: latest.checks.length },
    };
  }
  return Object.keys(out).length ? { source: "studio-probe-measurements", kinds: out } : null;
}

export const _internals = { MESSY_MODULE, DURATION_CORRECT, DURATION_BUGS, STRUCTURING_HARNESS, CODING_HARNESS };
