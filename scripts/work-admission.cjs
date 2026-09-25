// One admission path for new work. Every surface that puts work on the board
// (chat, the composer, Work on it, a split answer, the roster filers, request
// promotion, handoffs, delegation, approved plans and saved ideas) asks the same
// question here before it writes: is this work already represented? The ladder
// runs from the strongest evidence to the weakest (a stable identity, then the
// whole brief, then the title key against unfinished work), and every new card
// is built from one skeleton.
//
// Pure module: no Electron, no filesystem, no network, no clock reads. The
// caller injects `now` and id allocation and runs this inside the board gateway
// (mutateBoard), so the answer and the write share one lock.
"use strict";

const { createHash } = require("node:crypto");

// chat-work.cjs reads its title key from this module, so the brief matcher is
// loaded on first use rather than at require time (a require cycle otherwise).
let chatWorkModule = null;
const chatWork = () => (chatWorkModule ??= require("./chat-work.cjs"));

const TASK_COLOR = "#e6c98d";
// The longest title a new card keeps: chat, the composer, promotion and the
// chat model's create_task all clip there (the brief keeps every word).
const TITLE_MAX = 90;
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
const text = (value) => String(value ?? "").trim();
const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// ---- keys ----------------------------------------------------------------------

// "Work on it" titles a card with the label it points at (`Work on "X"`) while
// the underlying work may already be titled "X". A title clipped before its
// closing quote, or with its label cut to "…", no longer carries the whole
// label; the prompt it was queued with still does ("Work on \"X\". Queued …").
const WRAPPED = /^work on\s+["'‘’“”]([\s\S]+?)["'‘’“”][.!?]*$/i;
const OPENED = /^work on\s+["'‘’“”]([\s\S]*)$/i;
const QUEUED = /^Work on "([^\n]+?)"\. Queued (?:with|from)\b/;

function workLabel(title, prompt = "") {
  const raw = text(title);
  const wrapped = WRAPPED.exec(raw);
  const opened = wrapped ? null : OPENED.exec(raw);
  if (!wrapped && !opened) return raw;
  if (!wrapped || /…$/.test(wrapped[1])) {
    const queued = QUEUED.exec(text(prompt));
    if (queued) return queued[1];
  }
  return wrapped ? wrapped[1] : opened[1];
}

// Titles are matched loosely: case, punctuation and run-on whitespace carry no
// meaning, so "Fix the auditor" and "fix the auditor." are one key. NFKD makes
// precomposed and combining spellings (and full-width forms) one key, and
// letters, marks and digits of every script survive, so a non-Latin title never
// keys to "" and "botón" and "botín" stay apart. ASCII takes the old fast path,
// which gives the same answer for it.
function titleKey(title, prompt = "") {
  const label = workLabel(title, prompt);
  if (!/[^\x00-\x7f]/.test(label)) return label.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return label.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// ---- liveness --------------------------------------------------------------------

// The one "is this still work" predicate: anything not closed, whatever
// intermediate state (open, queued, running, held, verifying) it is in.
const CLOSED = new Set(["done", "closed", "complete", "completed", "archived", "absorbed", "dismissed", "rejected", "cancelled", "canceled"]);
function isOpenWork(status) {
  return !CLOSED.has(text(status).toLowerCase());
}

// The one "does this card still stand for its work" rule the roster's intake
// (requestBaseline, queueRequests), promotion and compaction share: any card
// not archived. A done card means the work happened, so until the keeper
// archives it (tidyDoneAfterHours) the same finding filed again is that card's.
// Intake used to count only unfinished cards while promotion and compaction
// counted done ones too, so a re-filed finding was admitted, refused, absorbed
// and filed again on every pass. The owner's explicit asks (Work on it) count
// only unfinished work (isOpenWork).
function standsOnBoard(row) {
  return Boolean(row) && text(row.status).toLowerCase() !== "archived";
}

// ---- identity ---------------------------------------------------------------------

// A split's identity is the card it was split from and the note it was split
// with, never its "Follow-up: X" title: a second split of the same card with a
// different note is new work. A row saved before splitKey existed hashes its
// brief, which is the note it was created with.
function splitKeyOf(row) {
  if (!text(row?.splitFrom)) return "";
  return text(row.splitKey) || digest(String(row.prompt ?? row.title ?? ""));
}

// Work on it and the overseer's stale-session rescue are ABOUT their target;
// a chat card that merely had a node focused is not, so its target is context,
// not identity.
const TARGET_KINDS = new Set(["work-on", "rescue"]);
const aboutTarget = (row) => TARGET_KINDS.has(row?.origin?.kind) || /^Work on "[^\n]+"\. Queued with Work on it\b/.test(String(row?.prompt ?? ""));

const sameHandoff = (a, b) => (a.handoffId && b.handoffId)
  ? a.handoffId === b.handoffId && a.fromRun === b.fromRun
  : a.fromRun === b.fromRun && titleKey(a.originalTitle ?? a.title) === titleKey(b.originalTitle ?? b.title);

// Each identity says which rows carry it, when two such rows are the same work,
// and whether a match must still be unfinished. A DECISIVE identity is the
// whole answer: similar wording never substitutes unrelated work for it. A
// target is not decisive: a Work on it row still meets the work its label names.
const IDENTITIES = [
  { kind: "coordinator", decisive: true, has: (row) => Boolean(text(row?.delegation?.fromRun)),
    same: (a, b) => a.delegation.fromRun === b.delegation.fromRun && a.delegation.scope === b.delegation.scope
      && JSON.stringify(a.delegation.childTaskIds) === JSON.stringify(b.delegation.childTaskIds) },
  { kind: "delegation", decisive: true, has: (row) => Boolean(row?.delegatedFrom && text(row.id)), same: (a, b) => a.id === b.id },
  { kind: "handoff", decisive: true, has: (row) => Boolean(text(row?.fromRun) && !row.delegatedFrom), same: sameHandoff },
  { kind: "planning", decisive: true, has: (row) => Boolean(text(row?.planningId) && text(row?.planningTaskId)),
    same: (a, b) => a.planningId === b.planningId && a.planningTaskId === b.planningTaskId },
  { kind: "split", decisive: true, open: true, has: (row) => Boolean(text(row?.splitFrom)),
    same: (a, b) => a.splitFrom === b.splitFrom && splitKeyOf(a) === splitKeyOf(b) },
  { kind: "target", decisive: false, open: true, has: (row) => Boolean(text(row?.target?.kind) && text(row?.target?.id) && aboutTarget(row)),
    same: (a, b) => a.target.kind === b.target.kind && a.target.id === b.target.id },
];

const identityOf = (row) => IDENTITIES.find((identity) => identity.has(row)) ?? null;
const hasDecisiveIdentity = (row) => Boolean(identityOf(row)?.decisive);

// true: the same work by identity; false: both carry that identity and it
// differs, so they are different work whatever their wording; null: nothing to
// compare, the later rungs decide.
function sameIdentity(a, b) {
  const identity = identityOf(a);
  if (!identity || !b || typeof b !== "object" || !identity.has(b)) return null;
  return identity.same(a, b);
}

// ---- the ladder --------------------------------------------------------------------

const familyOf = (row) => [row, ...rows(row?.members)];
const sameProject = (item, incoming) => !incoming?.projectId || !item?.projectId || item.projectId === incoming.projectId;
const liveJob = (job) => job && (!job.finished || job.settlementPending);

// Is `candidate` already represented on `board` ({ tasks, requests }, either
// may be left out to keep a collection out of the comparison)? Returns
// { kind: "task" | "request" | "worker", item }, { kind: "ambiguous", items }
// (a named title more than one unrelated card carries), or null.
//
// 1. Stable identity: target, split note, handoff, delegation or plan ids.
// 2. The whole brief, with chat-work's semantics (scripts/chat-work.cjs); the
//    model's reading (`details`) is never compared.
// 3. The title key against unfinished work, or whatever `titles` counts:
//    promotion counts done cards too, the request inbox counts every row.
function represented(board = {}, candidate = {}, { jobs = [], briefs = true, titles = null } = {}) {
  const tasks = rows(board?.tasks).filter((item) => sameProject(item, candidate));
  // An inbox row promotion already turned into a card (promotedTo) waits only
  // for compaction to drop it: its card stands for the work, so the copy
  // neither blocks a new ask once that card is closed nor is matched itself.
  const requests = rows(board?.requests).filter((item) => sameProject(item, candidate) && !text(item.promotedTo));
  const workers = rows(jobs).filter(liveJob);
  const identity = identityOf(candidate);
  let comparable = () => true;
  if (identity) {
    const matches = (row) => identity.has(row) && identity.same(candidate, row) && (!identity.open || isOpenWork(row.status));
    for (const [kind, items] of [["task", tasks], ["request", requests]]) {
      const item = items.find((row) => familyOf(row).some(matches));
      if (item) return { kind, item };
    }
    const worker = workers.find((job) => job.ref && typeof job.ref === "object" && matches(job.ref));
    if (worker) return { kind: "worker", item: worker };
    if (identity.decisive) return null;
    // Rows carrying a different identity of this kind are other work.
    comparable = (row) => !familyOf(row).some((member) => identity.has(member));
  }
  if (briefs) {
    const { details: _reading, origin: _origin, ...compared } = candidate;
    const found = chatWork().findExistingChatWork({
      tasks: tasks.filter(comparable),
      requests: requests.filter(comparable),
      jobs: workers.filter((job) => comparable(job.ref && typeof job.ref === "object" ? job.ref : job)),
    }, compared);
    if (found) return found;
  }
  if (titles === false) return null;
  const key = titleKey(candidate.title, candidate.prompt);
  if (!key) return null;
  const counts = typeof titles === "function" ? titles : (item) => isOpenWork(item.status);
  for (const [kind, items] of [["task", tasks], ["request", requests]]) {
    const item = items.find((row) => comparable(row) && counts(row, kind)
      && familyOf(row).some((member) => titleKey(member.title, member.prompt) === key));
    if (item) return { kind, item };
  }
  return null;
}

// ---- the card skeleton ---------------------------------------------------------------

// Who asked for a card and how it arrived, which ranking reads: `by: "owner"`
// is the owner's own work (chat, the composer, Work on it, a split answer, an
// approved plan, an idea promoted by hand) whatever its `source` says.
function originOf(value) {
  if (!value || typeof value !== "object") return null;
  const kind = text(value.kind).slice(0, 24);
  const by = text(value.by).slice(0, 24);
  return kind && by ? { kind, by } : null;
}

// ---- inbox requests ------------------------------------------------------------------

// The inbox rows the owner writes through the Explorer: an ask typed into its
// inbox ("manual") and the drafts of a checkpoint the owner chose to expand.
// Every other inbox source is a roster filer's.
const OWNER_REQUEST_SOURCES = new Set(["manual", "expand"]);

// What a request's card carries as its origin: its own when it has one, else
// who filed it. An older build saved owner rows without an origin, so their
// source still names the owner (scripts/policy.mjs ranks by: "owner" in the
// owner band). Promotion, the composer and the legacy migration all use it, so
// a card ranks alike whichever way it left the inbox.
function requestOrigin(request = {}) {
  return originOf(request?.origin) ?? { kind: "request", by: OWNER_REQUEST_SOURCES.has(request?.source) ? "owner" : String(request?.source || "a-eyes") };
}

// The title a request is known by: its own, else the first line of its brief
// clipped to the card cap. The Explorer inbox saved a typed ask as a prompt
// alone, and promotion skipped every row without a title, so such an ask never
// became a card and never ran.
function requestTitle(request = {}) {
  const own = text(request?.title);
  if (own) return own;
  const line = String(request?.prompt ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.slice(0, TITLE_MAX).trim();
}

// The one task skeleton: identity, status open, color, timestamps, logs, ideas
// and refs, the project stamp, the split key and the origin. Claims and run
// state never ride onto a new card.
function taskRow(candidate = {}, { now, id = null, allocateId = null, origin = null, log = "task created", project = null } = {}) {
  const at = Number(now);
  if (!Number.isFinite(at)) throw new TypeError("taskRow: now is required");
  const { status: _status, runId: _runId, lease: _lease, runningAt: _runningAt, ...rest } = candidate;
  const rowId = text(id) || text(candidate.id) || (typeof allocateId === "function" ? text(allocateId()) : "");
  if (!rowId) throw new TypeError("taskRow: an id or allocateId is required");
  const row = {
    ...(project?.id != null ? { projectId: project.id } : {}),
    ...(project?.path ? { projectPath: project.path } : {}),
    ...rest,
    id: rowId,
    title: text(candidate.title),
    prompt: String(candidate.prompt ?? ""),
    status: "open",
    color: candidate.color ?? TASK_COLOR,
    createdAt: Number(candidate.createdAt ?? candidate.at) || at,
    updatedAt: at,
    logs: [...rows(candidate.logs), ...(log ? [{ at, kind: "status", text: String(log) }] : [])].slice(-40),
    ideas: Array.isArray(candidate.ideas) ? candidate.ideas : [],
    refs: Array.isArray(candidate.refs) ? candidate.refs : [],
  };
  if (text(row.splitFrom) && !text(row.splitKey)) row.splitKey = splitKeyOf(row);
  const stamped = originOf(origin) ?? originOf(candidate.origin);
  if (stamped) row.origin = stamped;
  else delete row.origin;
  return row;
}

// Admit one task: refused when it cannot be a card, the existing work when the
// ladder finds it, otherwise the new row, placed at the front of the board (or
// the back, for work that keeps its plan's order). `lineage` fields (split,
// handoff, delegation) are part of the candidate's identity; `match` fields
// (a conversation's resolved title or named card) are compared, never saved;
// `inbox: false` leaves the request inbox out of the comparison.
function admitTask(board, candidate = {}, { origin = null, lineage = null, match = null, inbox = true, jobs = [], now, allocateId = null, briefs = true, titles = null, log = "task created", project = null, place = "front" } = {}) {
  if (!board || typeof board !== "object") return { refused: true, reason: "There is no board to add the task to." };
  const merged = { ...candidate, ...(lineage && typeof lineage === "object" ? lineage : {}) };
  if (!text(merged.title)) return { refused: true, reason: "A task needs a title." };
  if (origin && !merged.origin) merged.origin = origin;
  const compared = match && typeof match === "object" ? { ...merged, ...match } : merged;
  const existing = represented(inbox ? board : { tasks: board.tasks }, compared, { jobs, briefs, titles });
  if (existing) return { existing };
  const row = taskRow(merged, { now, allocateId, origin, log, project });
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  if (tasks.some((task) => task?.id === row.id)) return { refused: true, reason: "A task with this identity is already on the board." };
  board.tasks = place === "back" ? [...tasks, row] : [row, ...tasks];
  return { created: row };
}

module.exports = {
  TASK_COLOR, TITLE_MAX, workLabel, titleKey, isOpenWork, standsOnBoard, splitKeyOf, sameHandoff, sameIdentity, hasDecisiveIdentity,
  represented, originOf, OWNER_REQUEST_SOURCES, requestOrigin, requestTitle, taskRow, admitTask,
};
