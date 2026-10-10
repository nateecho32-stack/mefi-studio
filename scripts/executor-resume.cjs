// Local recovery context, separate from completion evidence. A checkpoint never
// approves work or counts as a successful attempt.
const backlog = require("./backlog.cjs");
const rows = (value) => Array.isArray(value) ? value : [];
const text = (value, limit) => String(value ?? "").slice(0, limit);
const LOG_LIMIT = 40;

// One bounded card-log append. Reassigns row.logs (never pushes into a shared
// array) and keeps the text as given.
function appendLog(row, line, { at = Date.now(), kind = "status" } = {}) {
  row.logs = [...rows(row.logs), { at, kind, text: String(line) }].slice(-LOG_LIMIT);
  return row;
}

// A coding CLI's own session (scripts/cli-stream.cjs applyEvent: the id Claude
// Code was started under, Codex's thread) with the route facts a later attempt
// must match to resume it, and the run's token totals. `sessionId` stays the
// OpenCode session the watchdog, the verifier and Open session read; these are
// bounded copies beside it, never the live objects.
function cliSessionRecord(session) {
  if (!session?.id) return null;
  return {
    cli: text(session.cli, 20) || null, id: text(session.id, 100), model: text(session.model, 120),
    ...(session.reportedModel ? { reportedModel: text(session.reportedModel, 120) } : {}),
    account: session.account ? text(session.account, 80) : null, cwd: session.cwd ? text(session.cwd, 400) : null,
    at: Number.isFinite(session.at) ? session.at : null,
    ...(session.resumed === true ? { resumed: true } : {}),
  };
}
// The run's journal (scripts/run-journal.cjs): where the builder's output is
// kept on disk and how far this engine had read it, so a relaunched engine
// reads on from there. Absent when the run writes to pipes.
function journalRecord(journal) {
  if (!journal?.path) return null;
  const offset = Number(journal.offset);
  return { path: text(journal.path, 600), offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0, format: journal.format === "claude" || journal.format === "codex" ? journal.format : null };
}
function usageRecord(usage) {
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return usage ? { input: count(usage.input), output: count(usage.output), cacheRead: count(usage.cacheRead), cacheCreate: count(usage.cacheCreate) } : null;
}

function checkpoint(entry, now = Date.now()) {
  const prior = entry.resumeCheckpoint;
  return {
    version: 1, runId: entry.id, projectId: entry.projectId, projectPath: entry.projectPath,
    ...(entry.agentConfiguration ? { agentConfiguration: structuredClone(entry.agentConfiguration) } : {}),
    pid: entry.ownerPid, workerPid: entry.pid || null, startedAt: entry.startedAt, at: now,
    scope: backlog.buildScope(entry.ref), pending: false,
    sessionId: entry.sessionId || null,
    ...(entry.cliSession?.id ? { cliSession: cliSessionRecord(entry.cliSession) } : {}),
    ...(entry.cliUsage ? { usage: usageRecord(entry.cliUsage) } : {}),
    ...(entry.journal?.path ? { journal: journalRecord(entry.journal) } : {}),
    progress: Number.isFinite(entry.progress) ? Math.max(0, Math.min(1, entry.progress)) : null,
    todos: rows(entry.todos ?? prior?.todos).filter(Boolean).slice(0, 40).map((todo) => ({ content: text(todo.content, 500), status: text(todo.status, 40) })),
    outputTail: rows(entry.outputTail?.length ? entry.outputTail : prior?.outputTail).slice(-8).map((line) => text(line, 500)),
    result: entry.resultNote ? { raw: text(entry.resultNote.raw, 1600) } : null,
    ...(prior ? { previousRunId: prior.runId, previousSessionId: prior.sessionId || prior.previousSessionId || null } : {}),
  };
}

function held(row, { pid, isAlive }) {
  const owner = row?.lease?.pid;
  // Unknown/access-denied is still ownership, never permission to duplicate.
  if (Number.isInteger(owner) && owner > 0 && owner !== pid && isAlive(owner) !== false) return true;
  const worker = row?.runProgress?.workerPid;
  return Number.isInteger(worker) && worker > 0 && isAlive(worker) !== false;
}

// A long-lived launch (a preview server, a watch loop) never reports completion
// in the session store, so its Bash tool would otherwise stay "running" forever
// and the live card would report a worker hanging on it. Cap the observation:
// past the bounded wait the tool is reported settled — not running and not a
// success — so the card shows a clear timeout instead of an endless timer. The
// cap reads the tool's own identity and start time, so a tool that finishes
// normally is dropped by the store first and a replacement tool starts its own
// wait; a stale timeout can never settle a newer run. settleActiveTool is the
// pure display half; retireTimedOutTool is the half that ends the process.
const ACTIVE_TOOL_SETTLE_MS = 15 * 60 * 1000;

function settleActiveTool(tool, now = Date.now(), { maxMs = ACTIVE_TOOL_SETTLE_MS } = {}) {
  if (!tool || typeof tool !== "object") return null;
  if (!["running", "pending"].includes(tool.status)) return null;
  const startedAt = Number(tool.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return tool;
  if (now - startedAt < Math.max(1, Number(maxMs) || ACTIVE_TOOL_SETTLE_MS)) return tool;
  return { ...tool, status: "timed_out", timedOut: true };
}

// The display cap alone leaves the long-lived launch alive: the preview server
// the timed-out Bash tool spawned is still in the worker's process tree and
// would outlive its session (holding its port and memory) after the card has
// already reported the tool stopped. The first time a tool crosses its own
// bounded wait, stop the run: entry.stop removes the worker's whole process
// tree (taskkill /t /f on Windows, kill -pgid elsewhere), which takes the
// server with it. The transition is latched per tool id, so repeated polls
// never re-stop a replacement tool or a run already ending; a tool that
// finishes normally is dropped by the store before it can be retired, and a
// newer tool starts its own wait.
function retireTimedOutTool(entry, tool, now = Date.now(), { maxMs = ACTIVE_TOOL_SETTLE_MS } = {}) {
  const settled = settleActiveTool(tool, now, { maxMs });
  if (!settled || settled.timedOut !== true || !entry || typeof entry !== "object") return settled;
  if ((entry.toolTimeout?.id ?? null) === (settled.id ?? null)) return settled;
  entry.toolTimeout = { id: settled.id ?? null, at: now };
  if (typeof entry.stop === "function") {
    try { entry.stop("long-lived tool did not finish; terminated its process tree", false, "tool-timeout"); }
    catch {}
  }
  return settled;
}

function recover(row, { liveRuns, pid, now = Date.now(), isAlive }) {
  if (!row?.runId || !["active", "running"].includes(row.status) || liveRuns.has(row.runId) || held(row, { pid, isAlive })) return row;
  // Legacy foreign leases without a usable process identity retain the old
  // lease timeout rule; only known-dead owners can bypass that wait.
  if (row.lease && (!Number.isInteger(row.lease.pid) || row.lease.pid <= 0)) return row;
  const saved = row.runProgress?.runId === row.runId ? row.runProgress : {
    version: 1, runId: row.runId, startedAt: row.runningAt || row.lease?.at || row.updatedAt,
    projectId: row.projectId, projectPath: row.projectPath, scope: backlog.buildScope(row),
  };
  const progress = { ...saved, pending: true, interruptedAt: now };
  const next = appendLog({ ...row, runProgress: progress, interruptedAttempt: progress, updatedAt: now },
    "Studio resumed interrupted work from its saved progress", { at: now });
  if (row.status === "active") next.status = "open";
  else delete next.status;
  delete next.runId;
  delete next.lease;
  delete next.runningAt;
  return next;
}

function compare(a, b) {
  // Explicit Do next choices still win. Otherwise finish the interrupted set
  // before admitting unrelated work, most recently started first.
  if (a.pin || b.pin) return 0;
  const aSaved = a.runProgress?.pending === true, bSaved = b.runProgress?.pending === true;
  if (aSaved !== bSaved) return aSaved ? -1 : 1;
  return aSaved ? (Number(b.runProgress.startedAt) || 0) - (Number(a.runProgress.startedAt) || 0) : 0;
}

function brief(row, maxChars = 2200) {
  const saved = row?.runProgress?.pending ? row.runProgress : null;
  if (!saved) return "";
  const details = [
    `CONTINUE INTERRUPTED WORK. Previous run: ${saved.runId}.`,
    "Inspect the existing edits, preserve completed work, and continue the unfinished steps. Saved output is context, not proof that tests passed. Verify the final result.",
    saved.sessionId || saved.previousSessionId ? `Previous session: ${saved.sessionId || saved.previousSessionId}.` : "",
    Number.isFinite(saved.progress) ? `Last reported progress: ${Math.round(saved.progress * 100)}%.` : "",
    saved.scope && saved.scope !== backlog.buildScope(row) ? "The brief has changed; follow the current requirements and recheck saved progress against them." : "",
    ...rows(saved.todos).filter(Boolean).map((todo) => `[${todo.status}] ${todo.content}`),
    // Quoted, so no saved line begins with a protocol mark: a CLI that echoes
    // its prompt (codex exec) would otherwise replay the old run's
    // MEFI_JOB_DONE, MEFI_RESULT and MEFI_NEXT lines as this run's own.
    ...[saved.result?.raw, ...rows(saved.outputTail)].filter(Boolean).map((line) => `> ${line}`),
  ].filter(Boolean);
  return details.join("\n").slice(0, maxChars);
}

// ---- resuming the CLI's own session (docs/plans/scratch-tier.md, WP0-C) ----
// An outage (a provider down, the PC asleep, a killed CLI) ends with the run
// finished, not restarted from zero: when the previous attempt's CLI session
// matches the route the next attempt takes, that attempt resumes the session
// (`claude -p --resume`, `codex exec resume`, `opencode run --session`) with
// a short recovery prompt instead of the whole brief. brief() above stays the
// fallback when nothing can be resumed, or when the resumed process exits
// without speaking.
const RECOVERY_MAX = 1200;
const CLI_ROUTES = new Set(["claude", "codex", "grok", "antigravity"]);
const SESSION_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const sameDir = (a, b) => String(a ?? "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase() === String(b ?? "").replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();

// The kill switches: MEFI_STUDIO_NO_SESSION_RESUME=1, or
// settings.executor.resumeSessions set to false.
function resumeEnabled(settings, env = {}) {
  if (env?.MEFI_STUDIO_NO_SESSION_RESUME === "1") return false;
  return settings?.executor?.resumeSessions !== false;
}

// Whether the saved checkpoint's session can be resumed on this route:
// { ok, cli, id } when the CLI, the model, the login and the folder all match
// (an OpenCode run resumes its store session; it keeps no cliSession), else
// { ok: false, reason }. Grok and Antigravity have no resume.
function resumable(checkpoint, route) {
  if (!checkpoint || typeof checkpoint !== "object") return { ok: false, reason: "no checkpoint" };
  const cli = CLI_ROUTES.has(route?.cli) ? route.cli : "opencode";
  const session = checkpoint.cliSession;
  if (session?.id) {
    if (session.cli !== cli) return { ok: false, reason: `the session is ${session.cli ?? "unknown"}, the route is ${cli}` };
    if (cli !== "claude" && cli !== "codex") return { ok: false, reason: `${cli} has no resume` };
    if (!SESSION_ID.test(String(session.id))) return { ok: false, reason: "session id not usable" };
    if (String(session.model ?? "") !== String(route?.model ?? "")) return { ok: false, reason: "model changed" };
    if ((session.account ?? null) !== (route?.account ?? null)) return { ok: false, reason: "login changed" };
    if (session.cwd && route?.cwd && !sameDir(session.cwd, route.cwd)) return { ok: false, reason: "folder changed" };
    return { ok: true, cli, id: String(session.id) };
  }
  if (cli === "opencode" && checkpoint.sessionId && SESSION_ID.test(String(checkpoint.sessionId))) {
    if (checkpoint.cwd && route?.cwd && !sameDir(checkpoint.cwd, route.cwd)) return { ok: false, reason: "folder changed" };
    return { ok: true, cli, id: String(checkpoint.sessionId) };
  }
  return { ok: false, reason: cli === "grok" || cli === "antigravity" ? `${cli} has no resume` : "no session to resume" };
}

// The recovery prompt a resumed session gets instead of the whole brief: what
// was interrupted and where it stood, the workspace as it was left, verify
// before redoing, no repeated commits, then finish and report. Budgeted to
// RECOVERY_MAX; the todo list gives way first.
function recoveryPrompt(checkpoint, { reason = "", max = RECOVERY_MAX, doneMark = "MEFI_JOB_DONE" } = {}) {
  const saved = checkpoint ?? {};
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const head = `CONTINUE INTERRUPTED WORK IN THIS SAME SESSION. Your previous run${saved.runId ? ` (${text(saved.runId, 60)})` : ""} was interrupted${why ? ` (${why})` : ""}; this resumes it.`;
  const progress = Number.isFinite(saved.progress) ? `Last reported progress: ${Math.round(saved.progress * 100)}%.` : "";
  const todos = rows(saved.todos).filter((todo) => todo?.content);
  const done = todos.filter((todo) => todo.status === "completed").map((todo) => text(todo.content, 80));
  const open = todos.filter((todo) => todo.status !== "completed").map((todo) => `${todo.status === "in_progress" ? "[in progress] " : ""}${text(todo.content, 80)}`);
  const tail = [
    "The workspace is as you left it. Verify what is already done before redoing it, and do not repeat commits that are already in `git log`.",
    `Finish the remaining steps, then report one MEFI_RESULT: line (done: ...; remaining: ...) and print ${doneMark} on its own line, as your brief says.`,
  ];
  const fixed = [head, progress, ...tail].filter(Boolean);
  const room = Math.max(0, max - fixed.join("\n").length - 2);
  const steps = [];
  if (done.length) steps.push(`Done: ${done.join("; ")}.`);
  if (open.length) steps.push(`Still open: ${open.join("; ")}.`);
  const stepsText = steps.join("\n").slice(0, room);
  return [head, progress, stepsText, ...tail].filter(Boolean).join("\n").slice(0, max);
}

module.exports = { checkpoint, held, recover, compare, brief, appendLog, settleActiveTool, retireTimedOutTool, ACTIVE_TOOL_SETTLE_MS, cliSessionRecord, usageRecord, journalRecord, resumable, resumeEnabled, recoveryPrompt, RECOVERY_MAX };
