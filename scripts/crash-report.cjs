// Mefi's Studio AI+ — Report a problem, and the prompt after a crash.
//
// Two jobs, both about what Studio may say about itself when something went
// wrong, and both without leaving this PC:
//
//   1. The bundle. Five small files built from plain inputs, each redacted the
//      same way, that the owner reads in full before anything is saved as a
//      zip: manifest.json (Studio's version, the install, the OS, the model
//      and builder in use), tasks-summary.json (one line per task), a trace
//      tail (the last 1,000 rows), the builders' recent output, and, when
//      Studio closed unexpectedly, what it wrote down then. What is NEVER in
//      it is written down too (NEVER_INCLUDED) and tested against the file
//      list: settings.json, the sign-in files, the vault, screenshots and
//      evidence, project files. Nothing here uploads or sends anything.
//      Redaction is scripts/redaction.cjs's scrubOutbound (keys, secret
//      assignments, home folders) plus this PC's user and PC names, e-mail and
//      network addresses, more token shapes, the project's and Studio's
//      folders, and long drive paths cut to their last two steps; and
//      "replace task titles with numbers" swaps every task title, and the
//      project's name, for Task N and Project 1 wherever it appears.
//
//   2. The session record. main.cjs keeps a small marker while Studio runs
//      (running, then closed with a reason) and appends a row to
//      data/crash.jsonl when the window dies or hangs. The next start reads
//      the marker: a session that never closed is a crash, unless it ended in
//      a way Studio itself chose (a quit, an update restart, a roll back,
//      Windows signing out), and a development run that was simply killed is
//      not one either. judgeSession says which, and whether to prompt.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected).

"use strict";

const { scrubOutbound } = require("./redaction.cjs");

// ---- what a report holds -----------------------------------------------------------------

const FILES = Object.freeze([
  { name: "manifest.json", about: "Studio version, install kind, the model and builder in use" },
  { name: "tasks-summary.json", about: "One line per task: state, builder and checks" },
  { name: "trace-tail.log", about: "The last 1,000 trace rows, with paths and keys removed" },
  { name: "builders.log", about: "Recent builder output, redacted the same way" },
  { name: "crash.jsonl", about: "What Studio wrote down when it closed unexpectedly", optional: true },
]);

// What no report ever carries, and why: shown to the owner beside the file list.
const NEVER_INCLUDED = Object.freeze([
  { name: "settings.json", why: "Holds your project paths" },
  { name: "auth.json and community-auth.json", why: "Hold a Discord ID and a PIN hash" },
  { name: "The vault", why: "Holds keys and sign-ins" },
  { name: "Screenshots and evidence", why: "They can show secrets on screen" },
  { name: "Your project's files", why: "Only a summary of tasks is included" },
]);

const LIMITS = Object.freeze({ traceRows: 1000, builderLines: 400, builderRuns: 12, tasks: 300, crashRows: 50, line: 500, title: 80, fileBytes: 256 * 1024 });
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const CRASH_KINDS = Object.freeze(["renderer-gone", "renderer-unresponsive", "main-exception", "gpu-gone", "no-clean-exit", "update-rolled-back"]);

// ---- redaction ---------------------------------------------------------------------------------

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A folder matches with either separator, wherever the real path has one.
const folderPattern = (folder) => new RegExp(String(folder).replace(/[\\/]+$/, "").split(/[\\/]/).map(escapeRegExp).join("[\\\\/]"), "gi");
const TOKEN_SHAPES = /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const DRIVE_PATH = /\b[A-Za-z]:[\\/](?:[^\s"'<>|?*\\/]+[\\/])+[^\s"'<>|?*\\/]*/g;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

/**
 * A function that redacts one string. `roots` are [{ path, label }] (the
 * project folder, Studio's own, this PC's home), `names` [{ name, label }]
 * (this PC's user name and PC name), and `titles` [{ title, label }] task
 * titles (and the project's name) to swap for their numbers; every one is
 * optional. Titles go first, so a title that holds a path or a name is gone
 * before the rest looks at it.
 */
function makeScrubber({ roots = [], names = [], titles = [] } = {}) {
  const folders = roots.filter((root) => root && typeof root.path === "string" && root.path.replace(/[\\/]+$/, "").length >= 4)
    .sort((a, b) => b.path.length - a.path.length).map((root) => [folderPattern(root.path), String(root.label ?? "<folder>")]);
  const words = names.filter((item) => item && typeof item.name === "string" && item.name.trim().length >= 3)
    .sort((a, b) => b.name.length - a.name.length)
    .map((item) => [new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(item.name.trim())}(?![A-Za-z0-9])`, "gi"), String(item.label ?? "<name>")]);
  const replaced = titles.filter((item) => item && typeof item.title === "string" && item.title.trim().length >= 4)
    .sort((a, b) => b.title.length - a.title.length).map((item) => [new RegExp(escapeRegExp(item.title.trim()).replace(/\s+/g, "\\s+"), "gi"), String(item.label)]);
  return (value) => {
    let text = String(value ?? "").replace(ANSI, "").replace(CONTROL, "");
    if (!text) return "";
    for (const [pattern, label] of replaced) text = text.replace(pattern, label);
    for (const [pattern, label] of folders) text = text.replace(pattern, label);
    // scrubOutbound masks a key's shape and then the assignment it sits in, which
    // can leave "[redacted] credential]"; one plain mark reads better.
    text = scrubOutbound(text)
      .replace(/\[redacted\] credential\]/g, "[redacted]")
      .replace(TOKEN_SHAPES, "[redacted credential]")
      .replace(EMAIL, "<email>")
      .replace(IPV4, "<address>");
    for (const [pattern, label] of words) text = text.replace(pattern, label);
    // Whatever absolute path is left keeps only its last two steps.
    return text.replace(DRIVE_PATH, (path) => {
      const parts = path.split(/[\\/]/).filter(Boolean);
      return parts.length > 3 ? `<path>\\${parts.slice(-2).join("\\")}` : path;
    });
  };
}

// ---- building the files ----------------------------------------------------------------------------

const oneLine = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const iso = (at) => (Number.isFinite(Number(at)) && Number(at) > 0 ? new Date(Number(at)).toISOString().replace(/\.\d{3}Z$/, "Z") : "");
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

// A text log kept under the file cap by dropping its oldest lines, and saying so.
function capLines(lines, maxBytes) {
  let bytes = 0;
  let from = lines.length;
  while (from > 0 && bytes + Buffer.byteLength(lines[from - 1]) + 1 <= maxBytes) { from -= 1; bytes += Buffer.byteLength(lines[from]) + 1; }
  return from > 0 ? { cut: from, lines: [`# ${from} older line${from === 1 ? "" : "s"} left out to keep this file under ${Math.round(maxBytes / 1024)} KB`, ...lines.slice(from)] } : { cut: 0, lines };
}

function checksOf(checks) {
  if (!checks || typeof checks !== "object") return "none";
  const total = count(checks.total);
  const failed = count(checks.failed);
  return total ? `${count(checks.passed)}/${total}${failed ? `, ${failed} failed` : ""}` : "none";
}

/**
 * The files of a report, from plain inputs:
 *   studio { version, install }, os { platform, release, arch },
 *   runtime { electron, chrome, node }, route { provider, models },
 *   builder { cli, tier }, project { name },
 *   tasks [{ id, title, status, verification, builder, updatedAt }] (newest first),
 *   trace [{ at, level, source, text }] (oldest first),
 *   builderRuns [{ at, runId, taskId, title, ok, code, seconds, tail: [line] }] (oldest first),
 *   crashRows [row], scrub { roots: [{ path, label }], names: [{ name, label }] }, now.
 * Options: replaceTitles (Task N and Project 1 instead of names) and
 * includeCrash. Answers { files: [{ name, about, text, bytes, truncated }],
 * total, replacedTitles }.
 */
function buildBundle(input = {}, { replaceTitles = false, includeCrash = true } = {}) {
  const now = Number(input.now) || 0;
  const tasks = (Array.isArray(input.tasks) ? input.tasks : []).filter((task) => task && typeof task === "object").slice(0, LIMITS.tasks);
  const projectName = oneLine(input.project?.name, 120);
  const numbered = replaceTitles === true;
  const labelOf = new Map(tasks.map((task, index) => [String(task.id ?? index), `Task ${index + 1}`]));
  const titles = numbered ? [...tasks.map((task, index) => ({ title: oneLine(task.title, 200), label: `Task ${index + 1}` })), { title: projectName, label: "Project 1" }] : [];
  const scrub = makeScrubber({ roots: input.scrub?.roots, names: input.scrub?.names, titles });
  const clean = (value, max = LIMITS.line) => oneLine(scrub(value), max);

  const files = [];
  const add = (name, text, extra = {}) => {
    const meta = FILES.find((file) => file.name === name);
    files.push({ name, about: meta.about, text, bytes: Buffer.byteLength(text), ...extra });
  };

  // manifest.json
  const counts = { total: tasks.length, running: 0, review: 0, done: 0 };
  for (const task of tasks) {
    if (task.status === "active" || task.status === "running") counts.running += 1;
    else if (task.status === "awaiting_verification") counts.review += 1;
    else if (task.status === "done") counts.done += 1;
  }
  const rows = includeCrash ? bundleCrashRows(input.crashRows, { now }) : [];
  const manifest = {
    studio: clean(input.studio?.version, 40),
    install: clean(input.studio?.install, 40),
    built: iso(now),
    os: { platform: clean(input.os?.platform, 20), release: clean(input.os?.release, 40), arch: clean(input.os?.arch, 20) },
    runtime: { electron: clean(input.runtime?.electron, 30), chrome: clean(input.runtime?.chrome, 30), node: clean(input.runtime?.node, 30) },
    project: numbered ? "Project 1" : clean(projectName, 120),
    route: {
      provider: clean(input.route?.provider, 40),
      models: Object.fromEntries(Object.entries(input.route?.models && typeof input.route.models === "object" ? input.route.models : {}).slice(0, 6).map(([role, model]) => [clean(role, 30), clean(model, 80)])),
    },
    builder: { cli: clean(input.builder?.cli, 40), tier: clean(input.builder?.tier, 40) },
    tasks: counts,
    crashes: rows.length,
    titlesReplaced: numbered,
  };
  add("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

  // tasks-summary.json: one line per task inside a JSON array.
  const lines = tasks.map((task, index) => {
    const state = [oneLine(task.status, 30) || "open", task.verification?.state ? `(${oneLine(task.verification.state, 20)})` : ""].filter(Boolean).join(" ");
    return JSON.stringify({
      task: numbered ? labelOf.get(String(task.id ?? index)) : clean(task.title, LIMITS.title),
      state,
      builder: task.builder ? clean(task.builder, 80) : null,
      checks: checksOf(task.verification?.checks),
      updated: iso(task.updatedAt) || null,
    });
  });
  add("tasks-summary.json", lines.length ? `[\n${lines.map((line) => `  ${line}`).join(",\n")}\n]\n` : "[]\n");

  // trace-tail.log
  const trace = (Array.isArray(input.trace) ? input.trace : []).filter((row) => row && typeof row === "object").slice(-LIMITS.traceRows)
    .map((row) => `${iso(row.at) || "-"}  ${oneLine(row.level, 5).padEnd(5)}  ${clean(row.source, 30)}  ${clean(row.text)}`);
  const traceCapped = capLines(trace, LIMITS.fileBytes);
  add("trace-tail.log", traceCapped.lines.length ? `${traceCapped.lines.join("\n")}\n` : "# Studio has logged nothing yet in this session\n", { truncated: traceCapped.cut > 0 });

  // builders.log: the last few runs' own words, newest run last.
  const blocks = [];
  for (const run of (Array.isArray(input.builderRuns) ? input.builderRuns : []).filter((item) => item && typeof item === "object").slice(-LIMITS.builderRuns)) {
    const name = numbered ? (labelOf.get(String(run.taskId ?? "")) ?? "a task") : clean(run.title, LIMITS.title);
    const verdict = run.ok === true ? "ok" : run.ok === false ? "failed" : "ended";
    blocks.push(`# ${iso(run.at) || "-"}  ${clean(run.runId, 40)}  "${name}"  ${verdict}${run.code == null ? "" : `  code ${count(run.code)}`}${run.seconds ? `  ${count(run.seconds)}s` : ""}`);
    for (const line of (Array.isArray(run.tail) ? run.tail : []).slice(-40)) blocks.push(`  ${clean(line)}`);
  }
  const builderLines = capLines(blocks.slice(-LIMITS.builderLines), LIMITS.fileBytes);
  add("builders.log", builderLines.lines.length ? `${builderLines.lines.join("\n")}\n` : "# no builder has finished a run yet, so there is no output to show\n", { truncated: blocks.length > LIMITS.builderLines || builderLines.cut > 0 });

  // crash.jsonl: only when there is something Studio wrote down, and the owner did not switch it off.
  if (rows.length) add("crash.jsonl", `${rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" ? clean(value, 200) : value])))).join("\n")}\n`);

  return { files, total: files.reduce((sum, file) => sum + file.bytes, 0), replacedTitles: numbered };
}

// ---- Studio's own record of a bad ending ---------------------------------------------------------------

const BOOKKEEPING = new Set(["prompted", "dismissed"]);

/** One row for data/crash.jsonl: only known fields, every string kept short. */
function crashRow({ now, kind, detail = "", session = null, version = "", exitCode = null, origin = "" } = {}) {
  return {
    at: Number(now) || 0,
    kind: CRASH_KINDS.includes(kind) ? kind : BOOKKEEPING.has(kind) ? kind : "no-clean-exit",
    ...(detail ? { detail: oneLine(detail, 200) } : {}),
    ...(Number.isFinite(Number(session)) && session !== null ? { session: Number(session) } : {}),
    ...(version ? { version: oneLine(version, 40) } : {}),
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
    ...(origin ? { origin: oneLine(origin, 40) } : {}),
  };
}

/** Rows from the file's text; a torn or foreign line is skipped, never thrown. */
function parseRows(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row === "object" && !Array.isArray(row) && Number(row.at) > 0 && typeof row.kind === "string") rows.push(crashRow({ now: row.at, kind: row.kind, detail: row.detail, session: row.session ?? null, version: row.version, exitCode: Number.isInteger(row.exitCode) ? row.exitCode : null, origin: row.origin }));
  }
  return rows;
}

/** The rows worth keeping: at most `max`, none older than a week. */
function keepRows(rows, { now, max = LIMITS.crashRows, keepMs = KEEP_MS } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => Number(row?.at) > 0 && (!Number(now) || Number(now) - row.at <= keepMs)).slice(-max);
}
const serializeRows = (rows) => (rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "");

/** What goes in crash.jsonl of a report: the crash rows of the last week, not the bookkeeping. */
function bundleCrashRows(rows, { now } = {}) {
  return keepRows(rows, { now, max: LIMITS.crashRows }).filter((row) => CRASH_KINDS.includes(row.kind));
}

// ---- the session marker ---------------------------------------------------------------------------------

const REASONS = Object.freeze(["quit", "exit", "session-end", "update", "rollback"]);

/** The marker a launch writes: this process is running. */
function beginSession({ now, pid, version = "", install = "source" } = {}) {
  return { v: 1, state: "running", pid: Number.isInteger(pid) ? pid : 0, startedAt: Number(now) || 0, version: oneLine(version, 40), install: install === "portable" ? "portable" : "source" };
}

/** The marker after a closing Studio chose: null when it is not running (a second call changes nothing). */
function endSession(marker, { now, why = "quit" } = {}) {
  if (!marker || marker.state !== "running") return null;
  return { ...marker, state: "closed", endedAt: Number(now) || 0, why: REASONS.includes(why) ? why : "quit" };
}

/** A marker from the file's text, or null when it is not one. */
function parseMarker(text) {
  let value = null;
  try { value = typeof text === "string" ? JSON.parse(text.replace(/^﻿/, "")) : text; } catch { return null; }
  if (!value || typeof value !== "object" || !["running", "closed"].includes(value.state) || !(Number(value.startedAt) > 0)) return null;
  return {
    v: 1, state: value.state, pid: Number.isInteger(value.pid) ? value.pid : 0, startedAt: Number(value.startedAt), version: oneLine(value.version, 40),
    install: value.install === "portable" ? "portable" : "source",
    ...(value.state === "closed" ? { endedAt: Number(value.endedAt) || 0, why: REASONS.includes(value.why) ? value.why : "quit" } : {}),
  };
}

/**
 * Whether the session before this one ended badly, and whether to say so.
 * `previous` is the marker it left, `pid` this process, `rows` data/crash.jsonl,
 * `updateResult` what an installing helper left after an update that did not
 * stand (update-safety parseResult). Answers { crashed, prompt, kind, at,
 * session, why }:
 *   - no marker, a closed one, or this very process: not a crash;
 *   - an update that did not stand and was rolled back: a crash, recorded, but
 *     the owner is already told about the update, so no prompt;
 *   - a development run that was simply stopped and wrote nothing bad down:
 *     not a crash (the owner works from source all day);
 *   - anything else still "running": a crash, with the kind of the last thing
 *     that session wrote down, or "no-clean-exit".
 */
function judgeSession(previous, { pid, rows = [], updateResult = null } = {}) {
  const none = { crashed: false, prompt: false, kind: null, at: 0, session: 0, why: "" };
  if (!previous || typeof previous !== "object") return none;
  if (previous.state === "closed") return { ...none, why: previous.why ?? "quit" };
  if (previous.state !== "running" || (Number.isInteger(pid) && previous.pid === pid)) return none;
  const mine = (Array.isArray(rows) ? rows : []).filter((row) => row.session === previous.startedAt && CRASH_KINDS.includes(row.kind));
  const last = mine[mine.length - 1] ?? null;
  const base = { crashed: true, session: previous.startedAt, at: last?.at ?? previous.startedAt, recorded: Boolean(last) };
  if (updateResult && updateResult.rolledBack === true) return { ...base, prompt: false, kind: "update-rolled-back", why: "update" };
  if (previous.install === "source" && !last) return { ...none, why: "source-run" };
  return { ...base, prompt: true, kind: last?.kind ?? "no-clean-exit", why: "" };
}

module.exports = {
  FILES, NEVER_INCLUDED, LIMITS, KEEP_MS, CRASH_KINDS, REASONS,
  makeScrubber, buildBundle,
  crashRow, parseRows, keepRows, serializeRows, bundleCrashRows,
  beginSession, endSession, parseMarker, judgeSession,
};
