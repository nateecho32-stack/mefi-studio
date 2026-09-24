// Durable task revisions and resumable briefs. Pure: callers persist the
// returned task under the project board lock. History is append-only; only
// reads and model-facing summaries are bounded, never the saved source text.
// Run-claim state (status, runId, leases, progress) is not brief context and
// is not snapshotted.
const { createHash } = require("node:crypto");
const { dependencyIds, completedTask } = require("./backlog.cjs");

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" ? value : "";
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const FIELDS = ["id", "projectId", "projectPath", "projectName", "title", "prompt", "description", "details", "note", "notes", "context", "handoff", "ideaDetail", "refs", "files", "file", "ideas", "dependsOn", "delegation", "delegatedFrom", "parentTaskId", "members", "absorbedInto", "interruptedAttempt", "lastAttempt", "verification", "verificationReceiptId", "remaining", "blockers", "lastRunError", "runFailures", "verifyAttempts", "doneAt", "completionFromTaskId", "planningId", "planningSpecId", "planningTaskId", "acceptance", "logs", "source", "parent", "parentRunId", "depth", "createdAt"];
const RESTORABLE = ["title", "prompt", "description", "details", "note", "notes", "context", "handoff", "ideaDetail", "refs", "files", "file", "dependsOn"];

function snapshotTask(task) {
  const result = {};
  for (const key of FIELDS) if (task?.[key] !== undefined) result[key] = copy(task[key]);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (snapshot) => createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
const entriesOf = (task) => rows(task?.contextHistory?.entries).filter((entry) => object(entry) && object(entry.snapshot) && entry.snapshot.id === task?.id && typeof entry.id === "string" && Number.isInteger(entry.revision));
const historyEntries = (task) => task?.contextHistory?.version === 1 && Array.isArray(task.contextHistory.entries) ? task.contextHistory.entries : [];

// A latest entry hashed under an older FIELDS list (one that still carried
// status/runId) is compared through the current list, so upgraded boards do
// not gain a catch-up revision on every row at their first mutation. An
// entry already on the current list cannot match here, so it is not re-hashed.
// The old list could not record absorbedInto, so an absorbed legacy entry
// borrows the live value instead of reading as a change.
function legacyMatch(entry, task, hash) {
  if (!entry?.snapshot || !Object.keys(entry.snapshot).some((key) => !FIELDS.includes(key))) return false;
  const legacy = entry.snapshot.status === "absorbed" && task.absorbedInto !== undefined && !Object.hasOwn(entry.snapshot, "absorbedInto")
    ? { ...entry.snapshot, absorbedInto: task.absorbedInto }
    : entry.snapshot;
  return digest(snapshotTask(legacy)) === hash;
}

// Whether `entries` is `prior` with entries dropped and nothing else: the same
// first and last entry, and every entry one of the prior's, by id and hash, in
// order. Saved bodies are never compared.
function compactionOf(entries, prior) {
  if (!entries.length || !prior.length || entries.length > prior.length) return false;
  const same = (a, b) => a === b || (object(a) && object(b) && typeof a.id === "string" && a.id === b.id && a.hash === b.hash);
  if (!same(entries[0], prior[0]) || !same(entries[entries.length - 1], prior[prior.length - 1])) return false;
  let at = 0;
  for (const entry of entries) {
    while (at < prior.length && !same(entry, prior[at])) at += 1;
    if (at >= prior.length) return false;
    at += 1;
  }
  return true;
}

function recordTaskRevision(task, { previous = null, kind = "updated", note = "", now = Date.now() } = {}) {
  if (!object(task) || !task.id) return task;
  const snapshot = snapshotTask(task);
  const hash = digest(snapshot);
  const supplied = historyEntries(task);
  const prior = previous?.id === task.id ? historyEntries(previous) : [];
  const priorLatest = prior[prior.length - 1];
  // A history compactHistory shortened is kept as supplied, with no revision
  // appended, when it only drops prior entries and the card is still what its
  // latest entry says. Checked before the fast paths below, which would hand
  // back the prior history. Anything else is recorded the ordinary way, and
  // that discards the shorter history.
  if (kind === "compacted") {
    if (priorLatest && compactionOf(supplied, prior) && (priorLatest.hash === hash || legacyMatch(priorLatest, task, hash))) return task;
    kind = "updated";
  }
  // The trusted current store is enough for a no-op. Do not serialize, copy,
  // or walk years of old snapshots just because a heartbeat refreshed a lease.
  if (kind !== "restored" && priorLatest?.hash === hash) {
    return task.contextHistory === previous.contextHistory ? task : { ...task, contextHistory: previous.contextHistory };
  }
  if (kind !== "restored" && legacyMatch(priorLatest, task, hash)) return task.contextHistory === previous.contextHistory ? task : { ...task, contextHistory: previous.contextHistory };
  // Preserve a revision already appended by restoreTaskRevision when the board
  // gateway records that mutation too. Compare IDs/hashes, never whole saved
  // bodies. The gateway must strip client-supplied history before calling us.
  const extendsPrior = supplied.length >= prior.length && prior.every((entry, index) => entry === supplied[index] || (entry.id === supplied[index]?.id && entry.hash === supplied[index]?.hash));
  const existing = extendsPrior ? supplied : prior;
  const latest = existing[existing.length - 1];
  if (kind !== "restored" && latest?.hash === hash) return extendsPrior ? task : { ...task, contextHistory: previous.contextHistory };
  // Unchanged entries are immutable values shared by successive revisions.
  // Only the newly recorded snapshot gets copied, never the historical tree.
  const entries = [...existing];
  const append = (snapshot, eventKind, eventNote, at) => {
    const revision = (entries[entries.length - 1]?.revision ?? 0) + 1;
    const hash = digest(snapshot);
    entries.push({ id: `revision_${revision}_${hash.slice(0, 16)}`, revision, at, kind: eventKind, note: text(eventNote).slice(0, 600), hash, snapshot });
  };
  // Existing legacy cards acquire a baseline before their first mutation, so
  // the first edit does not make the original requirements unrecoverable.
  if (!entries.length && object(previous) && previous.id === task.id) {
    append(snapshotTask(previous), "saved", "Context before its first recorded change", Number(previous.updatedAt || previous.createdAt) || now);
  }
  const currentLatest = entries[entries.length - 1];
  if (!currentLatest || (currentLatest.hash || digest(currentLatest.snapshot)) !== hash || kind === "restored") append(snapshot, kind, note, now);
  if (entries.length === existing.length && extendsPrior && task.contextHistory) return task;
  const { contextHistory, ...body } = task;
  // A compaction stamp stays with the history it describes.
  const stamp = (extendsPrior ? contextHistory : previous?.contextHistory)?.compacted;
  return { ...copy(body), contextHistory: { version: 1, entries, ...(object(stamp) ? { compacted: stamp } : {}) } };
}

function taskHistory(task, { limit = 40, before = null } = {}) {
  const count = Math.max(1, Math.min(100, Math.floor(Number(limit) || 40)));
  const ordered = entriesOf(task).slice().sort((a, b) => b.revision - a.revision);
  const beforeRevision = before == null ? Infinity : Number(before);
  const candidates = ordered.filter((entry) => entry.revision < beforeRevision);
  const selected = candidates.slice(0, count);
  return { entries: copy(selected), hasMore: candidates.length > selected.length, nextBefore: candidates.length > selected.length ? selected[selected.length - 1]?.revision ?? null : null };
}

function restoreTaskRevision(task, revisionId, { now = Date.now() } = {}) {
  if (!object(task)) return { ok: false, error: "Task not found." };
  if (task.runId || ["active", "running", "verifying", "awaiting_verification"].includes(task.status)) return { ok: false, error: "Wait for the current run and verification before restoring its brief." };
  const entry = entriesOf(task).find((row) => row.id === revisionId);
  if (!entry || entry.snapshot.id !== task.id) return { ok: false, error: "Saved revision not found for this task." };
  // Restore only editable context. Current attempt evidence, completion status,
  // task/project identity and execution claims can never be rolled backwards.
  const restored = { ...task, updatedAt: now };
  for (const key of RESTORABLE) {
    if (entry.snapshot[key] === undefined) delete restored[key];
    else restored[key] = copy(entry.snapshot[key]);
  }
  return { ok: true, task: recordTaskRevision(restored, { previous: task, kind: "restored", note: `Restored brief from revision ${entry.revision}. Files and run results were not changed.`, now }) };
}

// History compaction for finished work. Most of a completed card's revisions
// record log lines, claims and verifier churn, never a different brief. Kept:
// the first entry (the baseline saveTaskEdits falls back to), the last (its
// revision is the card's contextVersion), every restore, every entry whose
// restorable brief or `remaining` differs from the entry kept before it, and
// the last entry of each attempt (lastAttempt.runId). Kept entries are the same
// objects, never renumbered or re-hashed; the history is a new object stamped
// `compacted: { at, dropped }` (dropped is the running total), because the
// board gateway memoizes rows by history identity. A history with nothing to
// drop is still stamped once, so the keeper does not read it again. Open work,
// a history under COMPACT_MIN_ENTRIES entries, and one compacted with no
// revision since come back as the same task. Bytes are the history's JSON,
// measured only when it changes (0 and 0 otherwise). The caller persists the
// result through recordTaskRevision with kind "compacted".
const COMPACT_MIN_ENTRIES = 4;
const COMPACT_KEYS = [...RESTORABLE, "remaining"];
function compactHistory(task, { now = Date.now() } = {}) {
  const unchanged = { task, dropped: 0, bytesBefore: 0, bytesAfter: 0 };
  if (!object(task) || !completedTask(task)) return unchanged;
  const history = task.contextHistory;
  const entries = historyEntries(task);
  if (entries.length < COMPACT_MIN_ENTRIES) return unchanged;
  // A history this module did not write is left as it is.
  if (entries.some((entry) => !object(entry) || !object(entry.snapshot) || entry.snapshot.id !== task.id || typeof entry.id !== "string" || !Number.isInteger(entry.revision))) return unchanged;
  const stamp = object(history.compacted) ? history.compacted : null;
  if (stamp && Number(stamp.at) >= Number(entries[entries.length - 1].at)) return unchanged;
  // A field set to null and a field left out are different briefs to restore
  // (restore writes the one and deletes the other), so they compare apart.
  const briefOf = (entry) => JSON.stringify(canonical(COMPACT_KEYS.map((key) => (Object.hasOwn(entry.snapshot, key) ? [entry.snapshot[key]] : []))));
  const runOf = (entry) => JSON.stringify(entry.snapshot.lastAttempt?.runId ?? null);
  const lastOfRun = new Map(entries.map((entry, index) => [runOf(entry), index]));
  const kept = [];
  let brief = null;
  entries.forEach((entry, index) => {
    const own = briefOf(entry);
    if (index === 0 || index === entries.length - 1 || entry.kind === "restored" || own !== brief || lastOfRun.get(runOf(entry)) === index) {
      kept.push(entry);
      brief = own;
    }
  });
  const dropped = entries.length - kept.length;
  if (!dropped && stamp) return unchanged;
  const next = { ...history, entries: kept, compacted: { at: now, dropped: Math.max(0, Math.floor(Number(stamp?.dropped) || 0)) + dropped } };
  // Measured the way the board file is written (indented, the history two
  // levels deep in the row list), so the saving is what the file loses.
  const size = (value) => Buffer.byteLength(JSON.stringify([{ contextHistory: value }], null, 2));
  return { task: { ...task, contextHistory: next }, dropped, bytesBefore: size(history), bytesAfter: size(next) };
}

// Structured sections go to the model as compact JSON: indentation was about a
// third of their characters, and it spent the brief's budget on whitespace.
function renderValue(value) {
  if (Array.isArray(value) && !value.length) return "";
  if (object(value) && !Object.values(value).some((entry) => renderValue(entry))) return "";
  if (typeof value === "string") return value;
  return value == null ? "" : JSON.stringify(value);
}

function buildTaskHandoff(task, { tasks = [], maxChars = 24000, contextPath = null } = {}) {
  const cap = Math.max(120, Math.min(100000, Math.floor(Number(maxChars) || 24000)));
  if (cap < 1000) {
    const ending = `\n[Excerpt; read the full saved brief${contextPath ? ` in ${contextPath}` : " in Studio task history"}. Task ID: ${text(task?.id)}.]`;
    const body = `${text(task?.title)}\n${text(task?.prompt) || text(task?.ideaDetail)}`;
    return `${body.slice(0, Math.max(0, cap - ending.length))}${ending}`.slice(0, cap);
  }
  const sections = [];
  const historyCount = historyEntries(task).length;
  const footer = `Context history\n${historyCount} saved revision${historyCount === 1 ? "" : "s"}. Earlier requirements and attempt evidence remain in Studio's task history. Restoring a brief changes saved context, never repository files.`;
  const add = (label, value, limit) => {
    const source = renderValue(value).trim();
    if (!source) return;
    const remaining = cap - footer.length - 2 - sections.join("\n\n").length - label.length - 6;
    const budget = Math.min(limit, remaining);
    if (budget < 80) return;
    const suffix = "\n[Excerpt; full saved context remains in Studio task history.]";
    sections.push(`${label}\n${source.length > budget ? source.slice(0, Math.max(0, budget - suffix.length)) + suffix : source}`);
  };
  add("STUDIO TASK HANDOFF", `Task: ${text(task?.title)} (${text(task?.id)})\nProject: ${text(task?.projectPath) || text(task?.projectName) || text(task?.projectId)}${contextPath ? `\nFull saved task context: read ${contextPath} and select task ID ${text(task?.id)}: a read-only copy of the saved record whose contextHistory preserves earlier briefs and run evidence, with its grouped members and dependencies. Read the full requirements there when an excerpt is marked below or the task is grouped. Do not rewrite Studio's task store from the worker.` : ""}\nContinue from the evidence below. Inspect the current files before changing them, preserve other agents' work, and verify prior claims. Saved notes and worker reports are context, not proof of completion.`, 1200);
  add("Current requirements", task?.prompt || task?.description || task?.ideaDetail, Math.floor(cap * .4));
  if (task?.delegatedFrom) add("Shared task assignment", `Implement only this subtask's scope and owned files. Other builders may be working in this project; preserve their changes. Report concrete results and validation evidence to the Assistant. The parent task performs final integration. Parent task: ${text(task.parentTaskId) || text(task.delegatedFrom.parentTaskId) || "see saved delegation lineage"}.`, 700);
  if (task?.delegation) add("Integrate delegated work", "The Assistant delegated implementation parts of this task to the child builders listed in Dependency outputs. Inspect their actual changes and evidence, finish any gaps within the original scope, integrate the parts and validate the complete result. Child completion alone never completes this parent. Do not delegate these parts again.", 700);
  // Decisions the owner already made about THIS task, ahead of everything a
  // previous attempt merely reported: an agent that asked a question and was
  // answered must start from the answer, not re-litigate it. A grant recorded
  // here widens this task only — it is not a standing permission.
  const decisions = rows(task?.decisions).slice(-6);
  if (decisions.length || rows(task?.grants).length) {
    add("Decisions already made — follow these", {
      ...(decisions.length ? { decisions } : {}),
      ...(rows(task?.grants).length ? { grantedForThisTaskOnly: task.grants } : {}),
    }, Math.floor(cap * .08));
  }
  add("Work still remaining", task?.remaining, Math.floor(cap * .1));
  add("Interrupted attempt — saved progress, not completion evidence", task?.interruptedAttempt, Math.floor(cap * .1));
  add("Blockers / last error", { ...(task?.blockers ? { blockers: task.blockers } : {}), ...(task?.lastRunError ? { lastRunError: task.lastRunError } : {}), ...(task?.verification ? { verification: task.verification } : {}) }, Math.floor(cap * .1));
  add("Previous attempt — reported findings, checks and remaining work", task?.lastAttempt, Math.floor(cap * .14));
  const byId = new Map(rows(tasks).filter(object).map((row) => [row.id, row]));
  if (task?.delegatedFrom) {
    const parent = byId.get(task.parentTaskId || task.delegatedFrom.parentTaskId);
    add("Shared objective and constraints — context only, implement your assigned subtask", parent?.prompt || task.delegatedFrom.parentPrompt, Math.floor(cap * .1));
  }
  // A split card's brief is the ask it was split out for; the card it came
  // from holds the requirement that ask belongs to. Its worker used to start
  // with none of that. Context only: the split card builds its own brief.
  if (task?.splitFrom) {
    const parent = byId.get(task.splitFrom);
    add(`Split from ${parent ? `"${text(parent.title)}" (${text(parent.id)})` : text(task.splitFrom)} — context only, build this card's brief`, parent ? {
      requirement: text(parent.prompt || parent.description || parent.ideaDetail).slice(0, 1500),
      ...(rows(parent.decisions).length ? { decisions: rows(parent.decisions).slice(-6) } : {}),
      ...(parent.remaining ? { remaining: parent.remaining } : {}),
      ...(parent.lastAttempt?.result ? { lastResult: parent.lastAttempt.result } : {}),
    } : "The card this was split from is no longer on the board; do not assume its scope.", Math.floor(cap * .1));
  }
  const dependencies = dependencyIds(task).map((id) => {
    const source = byId.get(id);
    return source ? { id, title: source.title, status: source.status, result: source.lastAttempt?.result ?? null, verification: source.verification ?? null, remaining: source.remaining ?? [], refs: source.refs ?? [] } : { id, status: "missing", warning: "Required task is unavailable; do not assume it is complete." };
  });
  add("Dependency outputs", dependencies.length ? dependencies : null, Math.floor(cap * .13));
  add("Acceptance checks", task?.acceptance ?? task?.acceptanceCriteria, Math.floor(cap * .08));
  add("Saved references and file scope", { refs: task?.refs ?? [], files: task?.files ?? [], ...(task?.file ? { file: task.file } : {}) }, Math.floor(cap * .08));
  add("Saved notes / handoff", { ...(task?.notes ? { notes: task.notes } : {}), ...(task?.context ? { context: task.context } : {}), ...(task?.handoff ? { handoff: task.handoff } : {}) }, Math.floor(cap * .05));
  add("Recent work log", rows(task?.logs).slice(-12), Math.floor(cap * .05));
  sections.push(footer);
  return sections.join("\n\n").slice(0, cap);
}

// A collision's saved file scope copies session edit records verbatim, and
// those records keep a file's OLD absolute path after the project moved —
// every dispatched worker then burns its run hunting a ghost path that no
// longer exists. resolveStaleFileScope re-derives the scope from the
// filesystem: a path that still exists is kept as saved; a missing one is
// re-anchored to the same basename under the task's project root (the caller
// supplies the bounded locator); an entry that cannot be re-anchored is kept
// and reported rather than dropped, so no saved obligation silently loses its
// file. Pure with respect to saved state: the filesystem is injected, and
// with no existence checker injected the saved scope is trusted unchanged.
function resolveStaleFileScope(task, { exists = null, locate = null } = {}) {
  const savedFiles = rows(task?.files).map(text).filter(Boolean);
  const savedFile = text(task?.file);
  const paths = [...new Set(savedFiles.concat(savedFile ? [savedFile] : []))];
  const untouched = { changed: false, files: savedFiles, ...(savedFile ? { file: savedFile } : {}), healed: [], missing: [] };
  if (!paths.length || typeof exists !== "function") return untouched;
  const resolved = new Map();
  const healed = [], missing = [];
  for (const entry of paths) {
    if (exists(entry)) { resolved.set(entry, entry); continue; }
    const base = entry.split(/[\\/]/).pop();
    const found = typeof locate === "function" ? locate(base, task) : null;
    if (found && found !== entry && exists(found)) {
      resolved.set(entry, found);
      healed.push({ from: entry, to: found });
    } else {
      resolved.set(entry, entry);
      missing.push(entry);
    }
  }
  const files = [...new Set(savedFiles.map((entry) => resolved.get(entry)))];
  const file = savedFile ? resolved.get(savedFile) : undefined;
  const changed = healed.length > 0;
  return { changed, files, ...(file ? { file } : {}), healed, missing };
}

module.exports = { snapshotTask, recordTaskRevision, taskHistory, restoreTaskRevision, compactHistory, buildTaskHandoff, resolveStaleFileScope };
