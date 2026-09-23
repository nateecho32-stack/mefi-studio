// Attempt history for one task, read from the executor ledger
// (data/executor-log.jsonl). Every run writes a "start" row, may write
// "fallback" rows, and ends with "finish" or "release"; all carry the run's
// runId and, for task runs, the task id. The ledger is append-only and trimmed
// from the front, so an attempt can be missing its start (trimmed) or its end
// (still running, or the done log was cleared — clearing keeps start rows).
// Pure module: no Electron, no filesystem, no network, no clock reads. The
// host reads the ledger and passes its text in.

const ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
const TAIL_LINES = 40;

const text = (value, max) => (typeof value === "string" && value ? value.replace(ANSI, "").slice(0, max) : null);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

function parseRows(ledger) {
  const rows = [];
  for (const line of String(ledger ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row === "object" && typeof row.runId === "string" && row.runId) rows.push(row);
  }
  return rows;
}

function outcomeOf(attempt) {
  if (attempt.finishedAt != null) {
    if (attempt.stopped) return "stopped";
    return attempt.ok ? "finished-ok" : "failed";
  }
  if (attempt.release) return "released";
  return "unrecorded";
}

// { taskId } lists that task's attempts; { sessionId } resolves the task a
// worker session belonged to first. Newest first, at most `limit`.
function attemptsFromLedger(ledger, { taskId = null, sessionId = null, limit = 20 } = {}) {
  const rows = parseRows(ledger);
  let target = typeof taskId === "string" && taskId ? taskId : null;
  if (!target && typeof sessionId === "string" && sessionId) {
    const hit = rows.findLast((row) => row.event === "finish" && row.sessionId === sessionId && typeof row.task === "string" && row.task);
    target = hit?.task ?? null;
  }
  if (!target) return { taskId: null, attempts: [] };
  const byRun = new Map();
  for (const row of rows) {
    if (row.task !== target) continue;
    const at = number(row.at);
    let attempt = byRun.get(row.runId);
    if (!attempt) {
      attempt = { runId: row.runId, taskId: target, title: null, startedAt: null, via: null, pid: null, fallbacks: [], finishedAt: null, ok: null, code: null, error: null, stopped: false, startKilled: false, sawDone: false, sessionId: null, seconds: null, result: null, tail: [], release: null, firstAt: at };
      byRun.set(row.runId, attempt);
    }
    attempt.title = text(row.title, 160) ?? attempt.title;
    if (row.event === "start") {
      attempt.startedAt = at;
      attempt.via = text(row.via, 80);
      attempt.pid = number(row.pid);
    } else if (row.event === "fallback") {
      attempt.fallbacks.push({ at, reason: text(row.reason, 120) });
    } else if (row.event === "finish") {
      attempt.finishedAt = at;
      attempt.ok = row.ok === true;
      attempt.code = number(row.code);
      attempt.error = text(row.error, 200);
      attempt.stopped = row.stopped === true;
      attempt.startKilled = row.startKilled === true;
      attempt.sawDone = row.sawDone === true;
      attempt.sessionId = text(row.sessionId, 200);
      attempt.seconds = number(row.seconds);
      attempt.result = text(row.result, 2000);
      attempt.tail = (Array.isArray(row.tail) ? row.tail : []).map((line) => text(line, 400)).filter(Boolean).slice(-TAIL_LINES);
    } else if (row.event === "release") {
      attempt.release = { at, reason: text(row.reason, 120), heldMs: number(row.heldMs) };
    }
  }
  const cap = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const attempts = [...byRun.values()]
    .map(({ firstAt, ...attempt }) => ({ ...attempt, startedAt: attempt.startedAt ?? firstAt, outcome: outcomeOf(attempt) }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, cap);
  return { taskId: target, attempts };
}

module.exports = { attemptsFromLedger };
