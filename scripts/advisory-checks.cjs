// Advisory checks: the lint, typecheck and build a project already has, run
// after a builder attempt and shown on the Checks tab under "Advisory, never
// blocks Done" (docs/architecture.md "Attempt review"). They are a second
// opinion for the person reading the result. They never decide anything: a
// failed one does not fail a task, hold it back or change its Done state; the
// project's own check (Overseer verification) stays the only judge.
//
// This module holds what needs no machine: which commands a project has (from
// what the host found on disk), which of them run on their own, how a run's
// answer is read into one of ok / warn / bad / skipped with a short detail,
// and how output is trimmed for a page or a builder. scripts/advisory-checks-host.cjs
// finds the facts and runs the commands.
//
// The table is small on purpose and only names commands that read the project:
//   package.json scripts   typecheck (typecheck, type-check, check:types, tsc,
//                          test:types, types), lint (lint, lint:check, eslint;
//                          never one that fixes files) and build (build)
//   pyproject / ruff.toml  ruff check .          mypy config   mypy .
//   Cargo.toml             cargo check           go.mod        go vet ./...
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads.
"use strict";

const LIMITS = Object.freeze({
  // One check of an attempt, all the checks of an attempt, and one run_check call by a builder.
  checkMs: 120000,
  totalMs: 240000,
  toolMs: 90000,
  // What is kept of a command's output while it runs, and what is handed on.
  outputBytes: 256 * 1024,
  tailLines: 40,
  tailChars: 1500,
  toolChars: 4000,
  detailChars: 160,
});

const ID = /^[a-z][a-z0-9-]{0,30}$/;
const SCRIPT = /^[A-Za-z][A-Za-z0-9:_-]{0,39}$/;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const stripAnsi = (text) => String(text ?? "").replace(ANSI, "");

const TYPECHECK_SCRIPTS = Object.freeze(["typecheck", "type-check", "check:types", "tsc", "test:types", "types"]);
const LINT_SCRIPTS = Object.freeze(["lint", "lint:check", "eslint"]);

// A script that changes files on its own is not a check.
const FIXES_FILES = /(^|\s)--fix\b|--write\b|\bprettier\b[^&|;]*\s-w\b/;
const npm = (name) => ({ exe: "npm", args: ["run", name], display: `npm run ${name}` });
const direct = (exe, args) => ({ exe, args, display: [exe, ...args].join(" ") });

const firstScript = (scripts, names) => names.find((name) => typeof scripts?.[name] === "string" && scripts[name].trim() && SCRIPT.test(name));

// What the host found on disk: { packageJson, names: [top-level file names], pyproject: text|null, setupCfg: text|null }.
// Returns the project's advisory commands: { id, label, kind, command, auto, writes, skip? }.
function detect(given) {
  const facts = given && typeof given === "object" ? given : {};
  const found = [];
  const names = new Set((Array.isArray(facts.names) ? facts.names : []).map((name) => String(name).toLowerCase()));
  const scripts = facts.packageJson && typeof facts.packageJson === "object" ? facts.packageJson.scripts : null;
  if (scripts && typeof scripts === "object") {
    const type = firstScript(scripts, TYPECHECK_SCRIPTS);
    if (type) found.push({ id: "typecheck", label: "Typecheck", kind: "typecheck", command: npm(type), auto: true, writes: false });
    const lint = firstScript(scripts, LINT_SCRIPTS);
    if (lint) {
      const fixes = FIXES_FILES.test(String(scripts[lint]));
      found.push({ id: "lint", label: "Lint", kind: "lint", command: npm(lint), auto: !fixes, writes: false, ...(fixes ? { skip: "Its lint script fixes files, so Studio does not run it." } : {}) });
    }
    const build = firstScript(scripts, ["build"]);
    if (build) found.push({ id: "build", label: "Build", kind: "build", command: npm(build), auto: false, writes: true });
  }
  const pyproject = typeof facts.pyproject === "string" ? facts.pyproject : "";
  const setupCfg = typeof facts.setupCfg === "string" ? facts.setupCfg : "";
  if (names.has("ruff.toml") || names.has(".ruff.toml") || /^\s*\[tool\.ruff[\].]/m.test(pyproject)) found.push({ id: "ruff", label: "Lint (ruff)", kind: "lint", command: direct("ruff", ["check", "."]), auto: true, writes: false });
  if (names.has("mypy.ini") || /^\s*\[tool\.mypy[\].]/m.test(pyproject) || /^\s*\[mypy[\]:]/m.test(setupCfg)) found.push({ id: "mypy", label: "Typecheck (mypy)", kind: "typecheck", command: direct("mypy", ["."]), auto: true, writes: false });
  if (names.has("cargo.toml")) found.push({ id: "cargo-check", label: "Cargo check", kind: "typecheck", command: direct("cargo", ["check", "--message-format", "short"]), auto: false, writes: false });
  if (names.has("go.mod")) found.push({ id: "go-vet", label: "Go vet", kind: "lint", command: direct("go", ["vet", "./..."]), auto: true, writes: false });
  return found;
}

// Which checks run by themselves after an attempt: the ones marked auto, and the
// build too when the owner turned that on. Everything else is offered to run now.
function planAuto(checks, prefs = {}) {
  const list = Array.isArray(checks) ? checks : [];
  return list.filter((check) => !check.skip && (check.auto || (check.kind === "build" && prefs.advisoryBuild === true)));
}

// A line the page shows for a check that did not run, and why.
function placeholder(check, prefs = {}) {
  if (check.skip) return { id: check.id, label: check.label, status: "skipped", detail: check.skip, ms: 0 };
  if (check.kind === "build" && prefs.advisoryBuild !== true) return { id: check.id, label: check.label, status: "skipped", detail: "Not run on its own, because a build writes files. Run it now.", ms: 0 };
  if (!check.auto) return { id: check.id, label: check.label, status: "skipped", detail: "Not run on its own. Run it now.", ms: 0 };
  return { id: check.id, label: check.label, status: "skipped", detail: "Not run yet.", ms: 0 };
}

// ---- reading a run -------------------------------------------------------------------------------

// The lines worth keeping of a command's output: no colour codes, no blank tail, each line and the whole bounded.
function trimOutput(text, { lines = LIMITS.tailLines, chars = LIMITS.tailChars } = {}) {
  const kept = stripAnsi(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "").slice(0, 400));
  while (kept.length && !kept[kept.length - 1]) kept.pop();
  let out = kept.slice(-Math.max(1, lines)).join("\n");
  if (out.length > chars) out = `…${out.slice(out.length - chars + 1)}`;
  return out;
}

// Errors and warnings a tool says it found: from the summary line each well-known tool prints.
function countProblems(output) {
  const text = stripAnsi(output);
  const eslint = /(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/.exec(text);
  if (eslint) return { errors: Number(eslint[2]), warnings: Number(eslint[3]) };
  const found = [...text.matchAll(/\bFound (\d+) errors?\b/g)];
  if (found.length) return { errors: Number(found.at(-1)[1]), warnings: null };
  const cargoWarnings = [...text.matchAll(/generated (\d+) warnings?/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  const cargoPrevious = /due to (\d+) previous errors?/.exec(text);
  if (cargoPrevious || cargoWarnings || /\berror\[E\d+\]|could not compile/.test(text)) {
    return { errors: cargoPrevious ? Number(cargoPrevious[1]) : (text.match(/\berror\[E\d+\]/g) ?? []).length || null, warnings: cargoWarnings || null };
  }
  const tsc = (text.match(/\berror TS\d+:/g) ?? []).length;
  if (tsc) return { errors: tsc, warnings: null };
  const vet = (text.match(/^\S+\.go:\d+(?::\d+)?:/gm) ?? []).length;
  if (vet) return { errors: vet, warnings: null };
  return { errors: null, warnings: null };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const seconds = (ms) => (ms < 950 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(ms < 9950 ? 1 : 0)} s`);
const clip = (text, max = LIMITS.detailChars) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// The run's answer as one line for the card: { id, label, status: ok | warn | bad | skipped, detail, ms }.
// `raw`: { id, label, kind, exitCode, timedOut, spawnError, output, ms, skipped }.
function normalize(raw = {}) {
  const base = { id: String(raw.id ?? ""), label: String(raw.label ?? raw.id ?? ""), ms: Math.max(0, Math.round(Number(raw.ms) || 0)) };
  if (raw.skipped) return { ...base, status: "skipped", detail: clip(String(raw.skipped)), ms: 0 };
  if (raw.spawnError) {
    const missing = /ENOENT|not found|not recognized/i.test(String(raw.spawnError));
    return { ...base, status: "skipped", detail: missing ? `${raw.command ?? "The tool"} is not installed here.` : "It could not be started.", ms: 0 };
  }
  const tail = trimOutput(raw.output);
  if (raw.timedOut) return { ...base, status: "warn", detail: `Stopped after ${seconds(base.ms)}: it needs longer than Studio waits.`, ...(tail ? { tail } : {}) };
  const counts = countProblems(raw.output);
  if (raw.exitCode === 0) {
    if (counts.warnings > 0) return { ...base, status: "warn", detail: plural(counts.warnings, "warning"), ...(tail ? { tail } : {}) };
    return { ...base, status: "ok", detail: raw.kind === "build" ? seconds(base.ms) : raw.kind === "typecheck" ? "0 errors" : raw.kind === "lint" ? "clean" : "passed" };
  }
  const detail = counts.errors > 0 ? plural(counts.errors, "error") : `Failed (exit ${Number.isInteger(raw.exitCode) ? raw.exitCode : "?"})`;
  return { ...base, status: "bad", detail, ...(tail ? { tail } : {}) };
}

// The worst status among results, for a badge: bad, then warn, then ok; skipped ones do not count.
function worst(results) {
  const list = (Array.isArray(results) ? results : []).filter((row) => row && row.status !== "skipped");
  if (!list.length) return null;
  return list.some((row) => row.status === "bad") ? "bad" : list.some((row) => row.status === "warn") ? "warn" : "ok";
}

// What run_check hands a builder: the line, plus the end of the output.
function toolResult(normalized, output) {
  return { id: normalized.id, label: normalized.label, status: normalized.status, detail: normalized.detail, ms: normalized.ms, output: trimOutput(output, { lines: 80, chars: LIMITS.toolChars }) };
}

// The last lines of a log for project_logs: no colour codes, nothing over the caps, a count that says what was cut.
function logLines(text, wanted, { max = 200 } = {}) {
  const count = Math.max(1, Math.min(max, Math.floor(Number(wanted)) || 60));
  const all = stripAnsi(text).replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "").slice(0, 500));
  while (all.length && !all[all.length - 1]) all.pop();
  return { lines: all.slice(-count), total: all.length, cut: Math.max(0, all.length - count) };
}

const NOTHING_LOGGED = "Nothing captured: Studio has no output from a project preview or dev server to show. It only keeps the output of a preview it started itself.";

module.exports = {
  LIMITS, ID, SCRIPT, TYPECHECK_SCRIPTS, LINT_SCRIPTS, NOTHING_LOGGED,
  stripAnsi, detect, planAuto, placeholder, trimOutput, countProblems, normalize, worst, toolResult, logLines,
};
