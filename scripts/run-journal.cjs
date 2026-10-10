// The run journal (docs/plans/scratch-tier.md, WP0-B): a builder's output goes
// to a file instead of a pipe, so the builder outlives the engine that
// started it, and a relaunched engine (a live update, a crash, the owner's
// restart) picks the run up where the checkpoint left it instead of killing or
// orphaning it. This module holds the rules; run-journal-host.cjs does the
// file reads and the tailing, and main.cjs "Run journal" wires both into
// spawnNextJob, the boot pass and the updater's restart gate.
//
// - `journalName`, `journalRecord`: what a checkpoint says about the journal
//   ({ path, offset, format }), bounded, so an older checkpoint without one
//   still reads.
// - `splitLines`, `readTail`: the file's bytes as the lines wire() has always
//   read, a torn last line kept back until it ends; the verdict a tail holds.
// - `adoptable`: whether a row an earlier engine left is one this engine can
//   re-attach (a live worker pid and a journal) or settle (a dead pid whose
//   journal carries the verdict).
// - `adoptedEntry`: the in-flight job built from such a row's checkpoint.
// - `alreadySettled`, `alreadyLogged`: the side-effects-once rule: a settle
//   the old engine ran (recorded on the card, accepted by the owner, in the
//   history snapshots) is never repeated, and a finish already in
//   executor-log.jsonl is never logged twice.
// - `adoptableJob`, `restartSafe`: the updater's gate: a restart goes ahead
//   when every running job can be adopted.
// - `adoptEnabled`: the kill switch, MEFI_STUDIO_NO_RUN_ADOPT=1 or
//   settings.executor.adoptRuns: false, which keeps today's behaviour (pipes,
//   and the updater waiting for builds to end).
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const SAFE_ID = /[^A-Za-z0-9_-]/g;
const RESULT_MARK = "MEFI_RESULT:";
// What a checkpoint keeps of the journal: its path, how far the engine had
// read it, and the stream format the decoder needs (null for plain text).
const FORMATS = new Set(["claude", "codex"]);
// A tail is read for its verdict from at most this many bytes before its end.
const TAIL_SCAN_MAX = 512 * 1024;

const text = (value, max) => String(value ?? "").slice(0, max);
const rows = (value) => (Array.isArray(value) ? value : []);

// `<runId>.out`: the run id as a file name, letters, digits, dash and
// underscore only. A run id that leaves nothing is refused.
function journalName(runId) {
  const safe = String(runId ?? "").replace(SAFE_ID, "").slice(0, 80);
  if (!safe) throw new TypeError("journalName needs a run id");
  return `${safe}.out`;
}

// The checkpoint's bounded copy of a run's journal facts, or null when the
// run has no journal (the switch off, or an older checkpoint).
function journalRecord(journal) {
  if (!journal || typeof journal !== "object" || typeof journal.path !== "string" || !journal.path) return null;
  const offset = Number(journal.offset);
  return {
    path: text(journal.path, 600),
    offset: Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0,
    format: FORMATS.has(journal.format) ? journal.format : null,
  };
}

// Complete lines out of `carry + chunk`, and what is left unterminated. CRLF
// and LF both end a line; a lone CR inside a line is kept (a spinner's redraw
// is one line, as wire() reads it). The remainder is bounded to 64 KiB, as
// wire() bounds a line that never ends.
function splitLines(carry, chunk, { lineMax = 65536 } = {}) {
  const whole = `${carry ?? ""}${chunk ?? ""}`;
  const pieces = whole.split("\n");
  const rest = pieces.pop();
  const lines = pieces.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)).map((line) => (line.length > lineMax ? line.slice(0, lineMax) : line));
  return { lines, rest: rest.length > lineMax ? rest.slice(0, lineMax) : rest };
}

// What a journal's tail says: its complete lines (a torn last line is not one
// yet), whether the verdict sentinel is on a line of its own, the first
// MEFI_RESULT line, and the last line that is neither. `isDone` and
// `parseResult` are the host's strict readers (assistant.isDoneMarkerLine,
// assistant.parseExecutorResult) when it has them.
function readTail(body, { doneMark = "MEFI_JOB_DONE", isDone = null, parseResult = null, torn = true } = {}) {
  const source = String(body ?? "");
  const scanned = source.length > TAIL_SCAN_MAX ? source.slice(-TAIL_SCAN_MAX) : source;
  const { lines, rest } = splitLines("", scanned);
  if (!torn && rest.trim()) lines.push(rest);
  let sawDone = false;
  let resultLine = null;
  let lastWords = null;
  for (const raw of lines) {
    const line = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
    if (!line) continue;
    const done = typeof isDone === "function" ? isDone(raw, doneMark) === true : line === doneMark;
    if (done) { sawDone = true; continue; }
    const result = typeof parseResult === "function" ? parseResult(raw) : (line.startsWith(RESULT_MARK) ? { raw: line } : null);
    if (result && !resultLine) { resultLine = result.raw ?? line; continue; }
    if (!line.startsWith(RESULT_MARK) && !line.startsWith(doneMark)) lastWords = line;
  }
  return { lines, rest, sawDone, resultLine, lastWords };
}

// The kill switch: MEFI_STUDIO_NO_RUN_ADOPT=1, or settings.executor.adoptRuns
// set to false, keeps today's pipes and the updater's wait.
function adoptEnabled(settings, env = {}) {
  if (env?.MEFI_STUDIO_NO_RUN_ADOPT === "1") return false;
  return settings?.executor?.adoptRuns !== false;
}

// Whether a board row an earlier engine left can be picked up: its checkpoint
// is the run's own, names a journal, and its worker pid is alive ("alive") or
// gone ("dead", adopted only when `verdict` says the journal holds the run's
// verdict: the CLI finished while no engine was watching). A row this engine
// already owns, or whose owner is still running, is not a candidate.
function adoptable(row, { ownerPid, isAlive, ownedRuns = null, verdict = null } = {}) {
  if (!row?.runId || typeof row.runId !== "string") return { ok: false, reason: "no run" };
  if (ownedRuns && typeof ownedRuns.has === "function" && ownedRuns.has(row.runId)) return { ok: false, reason: "owned" };
  const saved = row.runProgress;
  if (!saved || saved.runId !== row.runId) return { ok: false, reason: "no checkpoint" };
  if (saved.pending === true) return { ok: false, reason: "already interrupted" };
  const journal = journalRecord(saved.journal);
  if (!journal) return { ok: false, reason: "no journal" };
  const owner = Number(row.lease?.pid ?? saved.pid);
  if (Number.isInteger(owner) && owner > 0 && owner !== ownerPid && isAlive(owner) === true) return { ok: false, reason: "owner alive" };
  const worker = Number(saved.workerPid);
  if (!Number.isInteger(worker) || worker <= 0) return { ok: false, reason: "no worker pid" };
  const alive = isAlive(worker);
  if (alive !== false) return { ok: true, reason: alive === true ? "alive" : "unknown", worker, journal };
  if (typeof verdict === "function" ? verdict(row.runId) === true : verdict === true) return { ok: true, reason: "dead", worker, journal };
  return { ok: false, reason: "worker gone" };
}

// The in-flight job an adopted row becomes: the shape spawnNextJob's entry has
// (what finish(), the checkpoint, the card and the renderer read), filled from
// the checkpoint, with no child process (`child: null`) and the pid to watch.
function adoptedEntry(row, { now, ownerPid, journal, worker }) {
  const saved = row.runProgress ?? {};
  const outputTail = rows(saved.outputTail).map((line) => text(line, 500)).slice(-8);
  const startedAt = Number(saved.startedAt) || Number(/^run_(\d+)_/.exec(row.runId)?.[1]) || now;
  const session = saved.cliSession && typeof saved.cliSession === "object" ? { ...saved.cliSession } : null;
  return {
    adopted: true,
    adoptedAt: now,
    mode: "swarm",
    studioMode: "swarm",
    modeRevision: 0,
    ...(saved.agentConfiguration ? { agentConfiguration: structuredClone(saved.agentConfiguration) } : {}),
    projectId: row.projectId ?? saved.projectId ?? null,
    projectPath: row.projectPath ?? saved.projectPath ?? null,
    id: row.runId,
    kind: "task",
    workKind: null,
    title: String(row.title ?? ""),
    source: row.source ?? null,
    ref: row,
    files: rows(row.files),
    file: rows(row.files)[0] ?? row.file ?? null,
    child: null,
    pid: worker,
    ownerPid,
    resumeCheckpoint: null,
    startedAt,
    attachedAt: startedAt,
    sessionId: saved.sessionId ?? null,
    taskId: row.id,
    progress: Number.isFinite(saved.progress) ? saved.progress : null,
    todos: rows(saved.todos).filter(Boolean).map((todo) => ({ content: text(todo.content, 500), status: text(todo.status, 40) })),
    ...(session ? { cliSession: session } : {}),
    ...(saved.usage ? { cliUsage: { ...saved.usage } } : {}),
    liveStream: journal.format ? { format: journal.format, cli: session?.cli ?? journal.format, model: session?.model ?? "", account: session?.account ?? null, cwd: session?.cwd ?? null } : null,
    liveProgress: Boolean(journal.format),
    journal: { ...journal },
    finished: false,
    outputTail,
    outputLog: [...outputTail],
    startKilled: false,
    sawDone: false,
    resultNote: null,
    spoke: outputTail.length > 0,
    spokeOut: outputTail.length > 0,
    bufferedOutput: false,
    handoffs: [],
    calls: new Set(),
    issues: [],
    worktree: null,
    depth: Number(row.depth) || 0,
    routeLabel: session?.cli ?? journal.format ?? null,
  };
}

// The side-effects-once rule, in two halves. A settle the old engine ran
// before it died is on the card already: lastAttempt names the run, the
// owner accepted the attempt, or a history snapshot was taken after that
// settle. Any of them means the card must not be settled again.
function alreadySettled(row, runId) {
  if (!row || !runId) return false;
  if (row.lastAttempt?.runId === runId) return true;
  if (rows(row.acceptedAttempts).some((item) => item?.runId === runId)) return true;
  const history = Array.isArray(row.contextHistory) ? row.contextHistory : rows(row.contextHistory?.entries);
  return history.some((entry) => entry?.runId === runId || entry?.snapshot?.lastAttempt?.runId === runId);
}
// The durable executor log's finish record is written before the card's
// settle (finish() in main.cjs logs first, then writes the board), so its
// presence means only that the finish line must not be logged twice, never
// that the card was settled.
function alreadyLogged(logRecords, runId) {
  return Boolean(runId) && rows(logRecords).some((record) => record?.event === "finish" && record.runId === runId);
}

// A running job the next engine can pick up: it writes a journal, its worker
// has a pid, it is not ending (no settle in flight, no stop under way).
function adoptableJob(entry) {
  if (!entry || entry.finished || entry.finishing || entry.settlementPending || entry.stopping) return false;
  if (!entry.journal?.path || !(Number(entry.pid) > 0)) return false;
  return true;
}

// The updater's rule: with nothing running a restart goes ahead as today;
// with jobs running it goes ahead only when every one of them is adoptable.
function restartSafe(jobs, { enabled = true } = {}) {
  const list = rows(jobs);
  if (!list.length) return true;
  if (!enabled) return false;
  return list.every(adoptableJob);
}

module.exports = { journalName, journalRecord, splitLines, readTail, adoptEnabled, adoptable, adoptedEntry, alreadySettled, alreadyLogged, adoptableJob, restartSafe, FORMATS, TAIL_SCAN_MAX };
