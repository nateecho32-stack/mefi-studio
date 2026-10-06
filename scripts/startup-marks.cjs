"use strict";
// Launch timings from both processes, on one timeline: milliseconds since the
// main process started (its performance.timeOrigin). main.cjs's "Startup
// marks" block makes the collector as its first statement and marks app
// ready, the window's creation, dom-ready and did-finish-load. The page's
// half (renderer/startup-marks.js) marks when the booklet's script began,
// DOMContentLoaded, each launch-gate step's start and settle, and the gate's
// release, and sends them once over startup:marks with its own timeOrigin,
// which puts them on the same timeline. Chromium's own entries ride along:
// when the booklet file finished arriving, first paint and first contentful
// paint.
//
// Each page's marks become one [startup] line in the studio log (Trace), and
// the first page's also a JSON report when the launch asked for one
// (--startup-report <file>, --startup-report=<file> or
// MEFI_STUDIO_STARTUP_REPORT=<file>; see docs/performance.md). A later page is
// a reload, which Trace times from its own navigation instead.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time
// is injected). The host passes now, log and write.

const LIMITS = Object.freeze({ marks: 48, steps: 16, name: 40, horizonMs: 10 * 60 * 1000 });
const NAME = /^[a-z][a-z0-9-]*$/;
const MAIN_MARKS = Object.freeze(["main", "ready", "window", "dom-ready", "did-finish-load"]);
// How a mark reads in the Trace line, in the order the line lists them.
const LABELS = Object.freeze([
  ["ready", "app ready"],
  ["window", "window"],
  ["html", "page read"],
  ["first-paint", "first paint"],
  ["script", "script"],
  ["dcl", "DOMContentLoaded"],
]);

const round = (value) => Math.round(value * 10) / 10;
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** The report file a launch asked for: argv first, then the environment; null for none. */
function reportPath(argv = [], env = {}) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--startup-report") {
      const next = args[index + 1];
      return next && !next.startsWith("--") ? next : null;
    }
    if (arg.startsWith("--startup-report=")) return arg.slice("--startup-report=".length) || null;
  }
  const named = String(env?.MEFI_STUDIO_STARTUP_REPORT ?? "").trim();
  return named || null;
}

/**
 * A page's marks as sent over startup:marks, checked and bounded, or null.
 * Times are milliseconds since the page's own timeOrigin (epoch ms).
 */
function normalizePage(payload) {
  if (!payload || typeof payload !== "object" || !finite(payload.origin) || payload.origin <= 0) return null;
  const marks = {};
  for (const [name, at] of Object.entries(payload.marks ?? {}).slice(0, LIMITS.marks)) {
    if (name.length <= LIMITS.name && NAME.test(name) && finite(at) && at >= 0 && at <= LIMITS.horizonMs) marks[name] = round(at);
  }
  const steps = [];
  for (const step of Array.isArray(payload.steps) ? payload.steps.slice(0, LIMITS.steps) : []) {
    const id = String(step?.id ?? "");
    if (!id || id.length > LIMITS.name || !NAME.test(id)) continue;
    const start = finite(step.start) && step.start >= 0 && step.start <= LIMITS.horizonMs ? round(step.start) : null;
    const end = finite(step.end) && step.end >= 0 && step.end <= LIMITS.horizonMs ? round(step.end) : null;
    const tries = Number.isInteger(step.tries) && step.tries > 0 ? Math.min(step.tries, 99) : 1;
    steps.push({ id, start, end, ok: typeof step.ok === "boolean" ? step.ok : null, tries });
  }
  return { origin: payload.origin, marks, steps, complete: payload.complete !== false };
}

/**
 * One report on one timeline. `main` holds the main-process marks (ms since
 * `origin`); a page's marks move onto it by the gap between the two
 * timeOrigins. With `relative`, everything counts from the page's navigation
 * instead (a reload, whose main marks belong to an earlier page).
 */
function buildReport({ origin, main = {}, page, about = {}, relative = false }) {
  const gap = page.origin - origin;
  const aligned = !relative && finite(origin) && Math.abs(gap) <= LIMITS.horizonMs;
  const shift = aligned ? gap : 0;
  const at = (value) => (finite(value) ? round(value + shift) : null);
  const timeline = [];
  if (aligned) for (const name of MAIN_MARKS) if (finite(main[name])) timeline.push([name, round(main[name])]);
  timeline.push(["navigation", aligned ? round(gap) : 0]);
  for (const [name, value] of Object.entries(page.marks)) if (!MAIN_MARKS.includes(name)) timeline.push([name, at(value)]);
  timeline.sort((a, b) => a[1] - b[1]);
  const marks = Object.fromEntries(timeline);
  const steps = page.steps.map((step) => ({
    id: step.id, start: at(step.start), end: at(step.end),
    ms: finite(step.start) && finite(step.end) ? round(step.end - step.start) : null,
    ok: step.ok, tries: step.tries,
  }));
  const whole = (value) => (finite(value) ? Math.round(value) : null);
  const chooser = finite(marks.choose) && finite(marks.chosen) ? whole(marks.chosen - marks.choose) : null;
  return {
    version: 1,
    ...(aligned ? { launchedAt: new Date(origin).toISOString() } : {}),
    about,
    timeline: aligned ? "ms since the main process started" : "ms since the page's navigation started",
    marks,
    steps,
    complete: page.complete,
    summary: {
      ready: whole(marks.ready),
      firstPaint: whole(marks["first-paint"] ?? marks["first-contentful-paint"]),
      release: whole(marks.release),
      gate: finite(marks.gate) && finite(marks.release) ? whole(marks.release - marks.gate) : null,
      chooser,
    },
  };
}

/** The one Trace line for a report. */
function formatLine(report, { reload = false } = {}) {
  const ms = (value) => `${Math.round(value)}`;
  const release = report.marks.release;
  const head = finite(release)
    ? `released ${ms(release)} ms after ${reload ? "navigation" : "launch"}${report.complete ? "" : " (partial)"}`
    : `no release yet${report.complete ? "" : " (partial)"}`;
  const parts = [head];
  for (const [name, label] of LABELS) if (finite(report.marks[name])) parts.push(`${label} ${ms(report.marks[name])}`);
  const steps = report.steps.map((step) => `${step.id}${step.ok === false ? " failed" : ""}${finite(step.ms) ? ` ${ms(step.ms)}` : ""}${step.tries > 1 ? ` (${step.tries} tries)` : ""}`);
  if (steps.length) parts.push(`gate: ${steps.join(", ")}`);
  if (finite(report.summary?.chooser) && report.summary.chooser >= 1) parts.push(`launch screen ${ms(report.summary.chooser)}`);
  return `[startup] ${reload ? "page reload: " : ""}${parts.join(" · ")} ms`;
}

/**
 * createStartupMarks({ origin, now, log, write, argv, env, about })
 *   origin  the main process's performance.timeOrigin (epoch ms)
 *   now     () => ms since origin (performance.now)
 *   log     (line) => void: the studio log
 *   write   (file, report) => Promise: the report file, when the launch asked
 *   argv / env   where --startup-report / MEFI_STUDIO_STARTUP_REPORT are read
 *   about   () => { version, electron, ... } for the report
 * Creating it marks "main".
 */
function createStartupMarks({ origin, now, log = () => {}, write = null, argv = [], env = {}, about = () => ({}) } = {}) {
  if (typeof now !== "function") throw new TypeError("startup marks need a clock");
  const main = {};
  const file = reportPath(argv, env);
  let pages = 0;
  let first = null;

  function mark(name) {
    if (MAIN_MARKS.includes(name) && !finite(main[name])) main[name] = round(now());
  }
  mark("main");

  // The window's webContents: created now, its first dom-ready and load.
  function watch(contents) {
    mark("window");
    contents?.once?.("dom-ready", () => mark("dom-ready"));
    contents?.once?.("did-finish-load", () => mark("did-finish-load"));
  }

  function receive(payload) {
    const page = normalizePage(payload);
    if (!page) return { ok: false, error: "Startup marks need the page's timeOrigin." };
    pages += 1;
    const reload = pages > 1;
    let info = {};
    try { info = about() ?? {}; } catch { /* the report goes out without it */ }
    const report = buildReport({ origin, main, page, about: info, relative: reload });
    log(formatLine(report, { reload }));
    if (!reload) {
      first = report;
      if (file && typeof write === "function") {
        Promise.resolve()
          .then(() => write(file, report))
          .catch((error) => log(`[startup] writing the startup report to ${file} failed: ${String(error?.message ?? error).slice(0, 200)}`));
      }
    }
    return { ok: true, reload };
  }

  return { mark, watch, receive, report: () => first, file: () => file, marks: () => ({ ...main }) };
}

module.exports = { createStartupMarks, reportPath, normalizePage, buildReport, formatLine, LIMITS, MAIN_MARKS };
