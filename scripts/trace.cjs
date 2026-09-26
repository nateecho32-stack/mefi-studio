// Mefi's Studio AI+ — Trace: Build's log viewer over Studio's own channels.
//
// Before this, the only logs were a plain <pre> of the studio log in Agents ›
// Providers, OpenCode's log tail in Activity and the Command feed. Trace puts
// them side by side as channels — the studio log, the assistant's log, the
// executor's run ledger, OpenCode's log and the renderer's warnings — with
// one reader: search, a tail, sources and levels to filter by, problems only.
//
// This module holds the rules: a bounded ring for the lines the host keeps in
// memory, how a line's level and source are read, how each channel's rows
// become the same shape, and the query. The host feeds it and serves it
// (main.cjs trace:channels / trace:read).
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const LIMITS = Object.freeze({ ring: 5000, line: 4000, tail: 2000, query: 200 });
const TAILS = Object.freeze([100, 250, 1000, 2000]);

// ---- a bounded ring ----------------------------------------------------------------
/** A ring of the newest `limit` rows, with the byte size of what it holds. */
function ring(limit = LIMITS.ring) {
  const rows = [];
  let bytes = 0;
  let dropped = 0;
  return {
    push(row) {
      rows.push(row);
      bytes += String(row?.text ?? "").length;
      while (rows.length > limit) { bytes -= String(rows.shift()?.text ?? "").length; dropped += 1; }
    },
    rows: () => rows.slice(),
    size: () => bytes,
    count: () => rows.length,
    dropped: () => dropped,
    clear() { rows.length = 0; bytes = 0; },
  };
}

// ---- reading a line --------------------------------------------------------------------
const ERROR = /\[error\]|\b(?:error|errors|failed|failure|fatal|exception|crash(?:ed)?|refused|denied|unhandled|ENOENT|EPERM|EACCES|ECONNREFUSED|traceback)\b/i;
const WARN = /\[warn(?:ing)?\]|\b(?:warn(?:ing)?|retry(?:ing)?|retried|timed? ?out|skipped|stale|held|stuck|parked|dropped|degraded|fallback|slow)\b/i;
/** error | warn | info, from the words in a line (a stated level wins). */
function levelOf(text, stated = null) {
  const said = String(stated ?? "").toLowerCase();
  if (["error", "fatal", "3"].includes(said)) return "error";
  if (["warn", "warning", "2"].includes(said)) return "warn";
  const line = String(text ?? "");
  if (ERROR.test(line)) return "error";
  if (WARN.test(line)) return "warn";
  return "info";
}
/** The "[agents]"-style tag a studio log line starts with, or the channel's own name. */
function sourceOf(text, fallback = "studio") {
  const match = /^\s*\[([a-z][\w.:-]{0,40})\]/i.exec(String(text ?? ""));
  if (!match) return fallback;
  const tag = match[1].toLowerCase();
  // Role-scoped tags ("tools:lead") file under their family.
  return tag.split(":")[0];
}
const clip = (value) => { const text = String(value ?? "").replace(/\r/g, ""); return text.length > LIMITS.line ? `${text.slice(0, LIMITS.line)}…` : text; };
const at = (value) => { const number = Number(value); if (Number.isFinite(number) && number > 0) return number; const parsed = Date.parse(value ?? ""); return Number.isFinite(parsed) ? parsed : null; };

// ---- each channel's rows, in one shape: { at, level, source, text } ---------------------
function studioRow(text, now) {
  const line = clip(text);
  return { at: now ?? null, level: levelOf(line), source: sourceOf(line), text: line };
}
function assistantRow(entry) {
  const text = clip(entry?.text);
  const kind = String(entry?.kind ?? "note");
  return { at: at(entry?.at), level: kind === "error" ? "error" : levelOf(text), source: String(entry?.role || kind).slice(0, 40), text: `${kind}: ${text}` };
}
// One run-ledger row (data/executor-log.jsonl): start, fallback, finish, release.
function executorRow(line) {
  let row = line;
  if (typeof line === "string") { try { row = JSON.parse(line); } catch { return null; } }
  if (!row || typeof row !== "object") return null;
  // {at, event: start | fallback | finish | release, runId, title, via, ok, error, seconds, reason}
  const kind = String(row.event ?? row.kind ?? row.type ?? "row");
  const title = row.title ?? row.taskTitle ?? "";
  const via = row.via ?? [row.route ?? row.cli ?? row.provider, row.model].filter(Boolean).join(" · ");
  const outcome = kind === "finish" ? `${row.ok === false ? "failed" : row.ok === true ? "ok" : "ended"}${Number.isFinite(row.seconds) ? ` in ${row.seconds}s` : ""}${row.error ? ` · ${String(row.error).slice(0, 200)}` : ""}`
    : row.reason ?? row.error ?? "";
  const text = clip([kind, title ? `"${String(title).slice(0, 120)}"` : "", via, outcome ? `→ ${typeof outcome === "string" ? outcome : JSON.stringify(outcome)}` : ""].filter(Boolean).join("  "));
  const bad = row.ok === false || Boolean(row.error) || row.startKilled === true || /fail|killed|timeout|lost/i.test(`${kind} ${row.reason ?? ""}`);
  return { at: at(row.at ?? row.time ?? row.ts), level: bad ? "error" : kind === "release" || kind === "fallback" ? "warn" : "info", source: kind.slice(0, 40), text };
}
// OpenCode's own log lines: "INFO  2026-09-26T10:00:00 +12ms service=session ...".
function opencodeRow(line) {
  const text = clip(line);
  if (!text.trim()) return null;
  const match = /^\s*(INFO|WARN|ERROR|DEBUG)\s+(\S+)/.exec(text);
  const service = /\bservice=([\w.-]+)/.exec(text)?.[1] ?? "opencode";
  return { at: match ? at(match[2]) : null, level: levelOf(text, match?.[1]), source: service.slice(0, 40), text };
}
function rendererRow(entry) {
  const text = clip(entry?.text);
  return { at: at(entry?.at), level: levelOf(text, entry?.level), source: String(entry?.source || "renderer").slice(0, 40), text };
}

// ---- the query ------------------------------------------------------------------------
/**
 * Filter and tail one channel's rows (oldest first in, newest last):
 * { rows, total, matched, counts: {error, warn, info}, sources: [[name, n]] }.
 * Counts and sources describe the whole channel so the chips stay put while
 * a filter narrows the rows.
 */
function query(rows, { tail = 250, text = "", problems = false, level = null, sources = null } = {}) {
  const all = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const counts = { error: 0, warn: 0, info: 0 };
  const bySource = new Map();
  for (const row of all) {
    counts[row.level] = (counts[row.level] || 0) + 1;
    bySource.set(row.source, (bySource.get(row.source) || 0) + 1);
  }
  const needle = String(text ?? "").trim().toLowerCase().slice(0, LIMITS.query);
  const wanted = Array.isArray(sources) && sources.length ? new Set(sources) : null;
  const matched = all.filter((row) => (!problems || row.level !== "info")
    && (!level || row.level === level)
    && (!wanted || wanted.has(row.source))
    && (!needle || `${row.source} ${row.text}`.toLowerCase().includes(needle)));
  const count = Math.max(1, Math.min(LIMITS.tail, Math.floor(Number(tail) || 250)));
  return {
    rows: matched.slice(-count),
    total: all.length,
    matched: matched.length,
    counts,
    sources: [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}

module.exports = { LIMITS, TAILS, ring, levelOf, sourceOf, studioRow, assistantRow, executorRow, opencodeRow, rendererRow, query };
