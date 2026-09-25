// Work events (0.4.0 M1): one append-only work-events.jsonl per project,
// beside executor-log.jsonl. The ledger says a run started and finished; this
// stream says what happened in between (steps, agents out and home, reports,
// help asked and answered, files read and edited, stage moves, mail), so the
// tree can animate from events and a recorded day can be replayed. See
// docs/roadmap-0.4.0.md section M1.
//
// Recording never breaks a run: append resolves null on any failure. Appends
// to one file ride one chain per process, however many stores point at it, so
// the trim below never races a row. The file is trimmed like the ledger: the
// first append per process cuts it to its last lines once it passes the cap.
// Nothing here is read on the hot path; read() is for replay and review.

"use strict";

const path = require("node:path");
const { appendFile, mkdir, readFile, rename, rm, stat, writeFile } = require("node:fs/promises");

const KINDS = Object.freeze([
  "step.start",
  "step.finish",
  "step.grow",
  "step.fold",
  "agent.out",
  "agent.home",
  "report",
  "help.ask",
  "help.answer",
  "file.read",
  "file.edit",
  "stage",
  "mail",
  "pipeline",
]);
const KIND_SET = new Set(KINDS);

const ID_FIELDS = ["taskId", "runId", "step", "role", "agent", "from", "to", "model", "effort", "stage", "prev"];
const MAX_PARENTS = 4;
const MAX_FILES = 40;

// Worker output reaches titles and texts; its colour codes would survive the
// control-character strip as "[0m" litter, so they go first.
const COLOUR = /\u001b\[[0-?]*[ -\/]*[@-~]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;

// A cut between a surrogate pair would store half a character.
function clip(value, max) {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

function clean(value, max, { collapse = false } = {}) {
  if (typeof value !== "string") return null;
  let out = value.replace(COLOUR, "");
  // Collapse before the strip, so a newline becomes a space, not a join.
  if (collapse) out = out.replace(/\s+/g, " ");
  out = clip(out.replace(CONTROL, "").trim(), max);
  return out || null;
}

function strings(value, max, limit, { unique = false } = {}) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    const text = clean(item, max);
    if (!text || (unique && out.includes(text))) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out.length ? out : null;
}

function normalizeEvent(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !KIND_SET.has(raw.kind)) return null;
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) && raw.at > 0
    ? raw.at
    : (Number.isFinite(now) ? now : Date.now());
  const event = { v: 1, at, kind: raw.kind };
  for (const field of ID_FIELDS) {
    const value = clean(raw[field], 80);
    if (value) event[field] = value;
  }
  const title = clean(raw.title, 160, { collapse: true });
  if (title) event.title = title;
  const text = clean(raw.text, 200, { collapse: true });
  if (text) event.text = text;
  const parents = strings(raw.parents, 80, MAX_PARENTS);
  if (parents) event.parents = parents;
  const files = strings(raw.files, 260, MAX_FILES, { unique: true });
  if (files) event.files = files;
  if (typeof raw.count === "number" && Number.isFinite(raw.count)) event.count = raw.count;
  if (typeof raw.ok === "boolean") event.ok = raw.ok;
  const project = clean(raw.project, 80);
  if (project) event.project = project;
  return event;
}

// A line without its own time cannot be placed in a replay, so it is skipped
// rather than stamped with the time it happened to be read.
function parseLines(text) {
  const events = [];
  for (const line of String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== "object" || !(typeof row.at === "number" && Number.isFinite(row.at) && row.at > 0)) continue;
    const event = normalizeEvent(row, { now: row.at });
    if (event) events.push(event);
  }
  return events;
}

// Local midnight to the next local midnight, so a DST day is 23 or 25 hours.
function dayBounds(day) {
  const match = typeof day === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const start = new Date(2000, 0, 1);
  start.setFullYear(year, month, date);
  if (start.getFullYear() !== year || start.getMonth() !== month || start.getDate() !== date) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { since: start.getTime(), until: end.getTime() };
}

const within = (at, since, until) => Number.isFinite(at) && at >= since && at < until;
const lower = (value) => (value == null || Number.isNaN(Number(value)) ? -Infinity : Number(value));
const upper = (value) => (value == null || Number.isNaN(Number(value)) ? Infinity : Number(value));

// Per resolved file, for the whole process: a second store on the same file
// shares the chain, and the size check runs once.
const chains = new Map();
const sized = new Set();

async function trimFile(file, maxBytes, keepLines) {
  const temp = `${file}.trim`;
  try {
    if ((await stat(file)).size <= maxBytes) return;
    const kept = (await readFile(file, "utf8")).split("\n").filter((row) => row.trim()).slice(-keepLines);
    await writeFile(temp, `${kept.join("\n")}\n`, "utf8");
    await rename(temp, file);
  } catch {
    await rm(temp, { force: true }).catch(() => {});
  }
}

function createStore({ file, maxBytes = 4 * 1024 * 1024, keepLines = 20000 } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("createStore needs a file path");
  const target = path.resolve(file);
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 4 * 1024 * 1024;
  const keep = Number.isFinite(keepLines) && keepLines >= 1 ? Math.floor(keepLines) : 20000;

  function append(raw) {
    let event = null;
    let line = null;
    try {
      event = normalizeEvent(raw);
      if (event) line = `${JSON.stringify(event)}\n`;
    } catch {
      event = null;
    }
    if (!event) return Promise.resolve(null);
    const run = (chains.get(target) ?? Promise.resolve()).then(async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await appendFile(target, line, "utf8");
      if (!sized.has(target)) {
        sized.add(target);
        await trimFile(target, cap, keep);
      }
      return event;
    }).catch(() => null);
    chains.set(target, run);
    return run;
  }

  // Waits for the appends already queued, so a read sees every event handed
  // to append before it. A malformed day matches nothing.
  async function read({ since, until, day, taskId, kinds, limit = 5000 } = {}) {
    let from = lower(since);
    let to = upper(until);
    if (day != null) {
      const bounds = dayBounds(day);
      if (!bounds) return [];
      from = bounds.since;
      to = bounds.until;
    }
    const wanted = kinds == null ? null : new Set(Array.isArray(kinds) ? kinds : [kinds]);
    const count = limit === Infinity ? Infinity : (Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 5000);
    await (chains.get(target) ?? Promise.resolve()).catch(() => {});
    let text = "";
    try {
      text = await readFile(target, "utf8");
    } catch {
      return [];
    }
    const matches = parseLines(text).filter((event) => within(event.at, from, to)
      && (taskId == null || event.taskId === taskId)
      && (!wanted || wanted.has(event.kind)));
    return count === Infinity || matches.length <= count ? matches : matches.slice(-count);
  }

  return { file: target, append, read };
}

function summarize(events) {
  const list = (Array.isArray(events) ? events : []).filter((event) => event && typeof event === "object" && KIND_SET.has(event.kind));
  const counts = new Map();
  const tasks = new Set();
  let firstAt = null;
  let lastAt = null;
  for (const event of list) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    if (typeof event.taskId === "string" && event.taskId) tasks.add(event.taskId);
    if (Number.isFinite(event.at)) {
      if (firstAt == null || event.at < firstAt) firstAt = event.at;
      if (lastAt == null || event.at > lastAt) lastAt = event.at;
    }
  }
  // KINDS order, so two summaries print alike whatever order events came in.
  const byKind = {};
  for (const kind of KINDS) if (counts.has(kind)) byKind[kind] = counts.get(kind);
  return {
    total: list.length,
    byKind,
    tasks: tasks.size,
    agentsOut: counts.get("agent.out") ?? 0,
    agentsHome: counts.get("agent.home") ?? 0,
    firstAt,
    lastAt,
  };
}

// The host reads the ledger as text, so JSONL text is taken as well as rows.
function ledgerRows(rows) {
  if (Array.isArray(rows)) return rows;
  if (typeof rows !== "string") return [];
  const out = [];
  for (const line of rows.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function ledgerCounts(rows, { since = -Infinity, until = Infinity } = {}) {
  const from = lower(since);
  const to = upper(until);
  let starts = 0;
  let finishes = 0;
  for (const row of ledgerRows(rows)) {
    if (!row || typeof row !== "object" || !within(Number(row.at), from, to)) continue;
    if (row.event === "start") starts += 1;
    else if (row.event === "finish") finishes += 1;
  }
  return { starts, finishes };
}

// agent.out pairs with the ledger's "start" row and agent.home with its
// "finish" row, not "release": a claim released before its worker started
// never went out.
function compareWithLedger(events, rows, { since, until } = {}) {
  const from = lower(since);
  const to = upper(until);
  let out = 0;
  let home = 0;
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !within(Number(event.at), from, to)) continue;
    if (event.kind === "agent.out") out += 1;
    else if (event.kind === "agent.home") home += 1;
  }
  const ledger = ledgerCounts(rows, { since: from, until: to });
  const diff = { out: out - ledger.starts, home: home - ledger.finishes };
  return { ok: diff.out === 0 && diff.home === 0, events: { out, home }, ledger, diff };
}

module.exports = {
  KINDS,
  normalizeEvent,
  createStore,
  dayBounds,
  summarize,
  ledgerCounts,
  compareWithLedger,
  parseLines,
};
