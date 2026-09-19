// Mefi's Studio AI+ — the always-on assistant: pure logic for the service.
//
// Everything here is a function of its inputs and an explicit `now`: state
// normalisation, tree organisation, housekeeping (tidy), intent routing, the
// keyless local replies and the tree summary. main.cjs owns the files, the
// timers, IPC and the AI call; this module never touches a file, the network
// or the store, so the Python contract can drive it through the --fixture CLI
// (the only file read below is the fixture itself).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ACTIVE_WINDOW_MS = 15 * MINUTE; // a session touched this recently is active
const RAIL_WINDOW_MS = 14 * DAY; // the rail's own rule: older sessions are not drawn at all
const REPLY_MAX_CHARS = 600;

export const ASSISTANT_MODEL = "deepseek-v4.1-flash";
export const CAPS = { messages: 200, log: 300, fixes: 100, work: 40 };
export const DEFAULT_POLICY = { foldAfterMinutes: 60, staleAfterHours: 24, maxSessions: 8, maxTodosPerSession: 14 };
export const PARALLEL_MAX = 12;
export const AI_PARALLEL_MAX = 6;
export const DEFAULT_PREFS = { proactive: true, keepAwake: true, background: true, backlogMode: false, foldAfterMinutes: 60, staleAfterHours: 24, tidyDoneAfterHours: 24, parallel: 8, aiParallel: 4 };
const PREF_RANGES = { parallel: [1, PARALLEL_MAX], aiParallel: [1, AI_PARALLEL_MAX] }; // integer prefs clamped into a range
export const INTENTS = ["status", "tasks", "ideas", "collisions", "machine", "agents", "suggest", "tidy", "fix", "organize", "pause", "resume", "resume-work", "help", "request", "chat", "overseer", "compact", "builder", "log"];
export const ACTION_KINDS = ["idle", "tick", "audit", "brief", "fix", "tidy", "organize", "message", "overseer"];
export const LOG_KINDS = ["tick", "message", "reply", "fix", "tidy", "organize", "audit", "brief", "collision", "machine", "error", "control", "overseer", "think"];
export const THINKING_KEEP = 8; // committed inner-monologue bubbles kept in the thread
export const FIX_KINDS = ["data", "catalog", "requests", "process", "build", "overseer"];
export const PROBLEM_KINDS = ["update-held", "store-unavailable", "ai-offline", "audit", "collision", "machine", "work-stale", "overseer", "executor"];
// Open problems pull their owner onto the next tick so a collision or audit
// error is worked on as soon as it appears, not when that role's cadence next
// elapses. ai-offline is omitted: no role can mint a key.
export const PROBLEM_ROLES = {
  collision: "watcher",
  "store-unavailable": "watcher",
  audit: "auditor",
  "update-held": "auditor",
  machine: "machine",
  executor: "foreman",
  "work-stale": "foreman",
  overseer: "improver",
};
// The work journal: in-flight jobs only, written to disk at every start and
// finish so a crash leaves the truth on disk for the next boot to restart.
export const WORK_KINDS = ["responder", "improve", "grow", "explore", "expand", "audit", "brief", "ideas", "reference", "analyzer", "overseer", "compact", "dispatch"];
export const WORK_STALE_MS = 10 * MINUTE; // a journal entry older than this is a `work-stale` problem
export const WORK_MAX_ATTEMPTS = 3; // a job restarted this often is dropped
const KIND_ROLES = { responder: "responder", improve: "improver", grow: "grower", explore: "improver", expand: "grower", audit: "auditor", brief: "briefer", ideas: "ideas", reference: "reference", analyzer: "reference", overseer: "overseer", compact: "compactor", dispatch: "foreman" };
export const TIDY_LIMITS = { doneIdeaHours: 24, unreadIdeas: 120, autoRequestDays: 3, requests: 200, checkpointDays: 14, checkpointsPerSession: 50 };

// ---- node context folders ----------------------------------------------------
// Every work node (session, todo, task) carries a small folder of saved
// context: what an agent did there, what the chat settled, what the owner
// pinned. The responder reads the focused node's folder when it answers, and
// the keeper cleans a folder out once its node is done — the same clocks that
// archive the task and drop the checkpoints.
export const FOLDER_LIMITS = { entries: 8, folders: 24, text: 220, entryDays: 7 };
export const FOLDER_KINDS = ["note", "chat", "agent", "run"];
const FOLDER_NODE_KINDS = new Set(["session", "todo", "task"]);
// Recall-style typed cells on top of a folder entry. `kind` is how the line
// got there (chat, a run, an agent, a pin); `cell` is what it *is* — a
// decision, an observation, a belief, a risk, a verification. Compile ranks
// by cell, recency and the current prompt, and a later write with the same
// title key supersedes the older one instead of leaving two competing facts.
export const MEMORY_CELLS = ["dec", "obs", "bel", "rsk", "ver"];
const MEMORY_CELL_WEIGHT = { ver: 5, dec: 4, rsk: 4, bel: 3, obs: 2 };

// The agent pool: one job per role, in roster order. cadenceMs 0 = on demand
// (a message, a UI action); `ai` jobs also count against prefs.aiParallel.
export const AGENT_ROLES = [
  // The watcher only reorganises the tree. At 30 s it ran 4x more than every
  // other role put together and owned a pool slot a third of the time, which
  // is what made the roster look like a watcher loop with nothing behind it.
  { role: "watcher", cadenceMs: 2 * MINUTE, ai: false },
  { role: "machine", cadenceMs: 2 * MINUTE, ai: false },
  { role: "auditor", cadenceMs: 5 * MINUTE, ai: false },
  { role: "keeper", cadenceMs: 10 * MINUTE, ai: false },
  // Keyless, and deliberately brisk: it is the role that keeps the queue
  // runnable, so the executor always has something clean to pick up.
  { role: "compactor", cadenceMs: 7 * MINUTE, ai: false },
  // The foreman hands work out. The auto builder files requests and owns the
  // child processes; deciding WHAT runs belongs to the assistant, so this is
  // the only role that fills an executor slot. Brisk cadence: it is the
  // heartbeat that keeps the builders fed.
  { role: "foreman", cadenceMs: MINUTE, ai: false },
  // Reads the activity log, thinks in the assistant box, and kicks the
  // foreman when the board is idle and a real pick is waiting. Proactive
  // off holds it (dueRoles); no key required — the plan is local.
  { role: "thinker", cadenceMs: MINUTE, ai: false },
  { role: "briefer", cadenceMs: 5 * MINUTE, ai: true },
  { role: "overseer", cadenceMs: 15 * MINUTE, ai: false },
  // The build half of the roster. These were on-demand only, so they had never
  // run once: the app watched itself all day and proposed nothing. On a cadence
  // they each end by queueing real requests for the executor.
  { role: "improver", cadenceMs: 20 * MINUTE, ai: true },
  { role: "ideas", cadenceMs: 30 * MINUTE, ai: true },
  { role: "grower", cadenceMs: 45 * MINUTE, ai: true },
  { role: "responder", cadenceMs: 0, ai: false },
  { role: "reference", cadenceMs: 0, ai: false },
];
export const AGENT_STATUSES = ["idle", "queued", "running", "done", "error"];
const ROLE_VERBS = { watcher: "watching", machine: "scanning", auditor: "auditing", keeper: "tidying", compactor: "compacting the queue", foreman: "handing out work", thinker: "thinking", briefer: "briefing", overseer: "overseeing", responder: "replying", improver: "improving", grower: "growing", ideas: "scanning ideas", reference: "gathering references" };
const ROLE_ACTION_KINDS = { watcher: "organize", machine: "fix", auditor: "audit", keeper: "tidy", compactor: "tidy", foreman: "tick", thinker: "tick", briefer: "brief", overseer: "overseer", responder: "message", improver: "brief", grower: "brief", ideas: "brief", reference: "brief" };
// A cadence counts as elapsed at 90%, so a job that started a few seconds into
// the previous tick still lines up with the next one instead of skipping it.
const CADENCE_TOLERANCE = 0.9;

// Request sources the app itself writes; "manual" (and anything unknown) is the
// owner's and is never removed. "machine" is not in the contract's list but is
// produced by the resource manager, so it counts as auto here.
const AUTO_SOURCES = new Set(["collision", "fix", "audit", "duplicate", "uncommitted", "improver", "grow", "chat", "machine", "overseer"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const num = (value, fallback = 0) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback);
const str = (value, fallback = "") => (typeof value === "string" ? value : fallback);
const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
const clampTail = (list, cap) => (list.length > cap ? list.slice(list.length - cap) : list);
const uniqueStrings = (value) => [...new Set(asArray(value).filter((item) => typeof item === "string" && item))];
const basename = (file) => String(file ?? "").split(/[\\/]/).pop() || "";
const plural = (count, noun, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;

// Worth ordering shared by queued requests and open tasks when the tidy pass
// ranks what to keep and what the executor should take next: the owner's own
// words — a hand ask or a chat ask — outrank auto-filed upkeep, and work
// already on the board outranks a request still waiting to be filed. Ties
// fall through to recency at the call sites, so equal worth keeps the stable
// (oldest-first) order of the store.
function taskPriority(item) {
  if (!isObject(item)) return 0;
  if (item.source === "manual" || item.source === "chat") return 4; // the owner's words
  if (item.status === "open") return 2; // already on the board
  return 0; // auto-filed upkeep
}

function clip(text, max) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

function ago(minutes) {
  const m = num(minutes, 0);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function relative(ms) {
  if (ms < 1000) return "now";
  if (ms < MINUTE) return `in ${Math.round(ms / 1000)}s`;
  if (ms < HOUR) return `in ${Math.round(ms / MINUTE)}m`;
  return `in ${Math.round(ms / HOUR)}h`;
}

function normalizePolicy(policy) {
  const source = isObject(policy) ? policy : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_POLICY)) {
    const value = source[key];
    out[key] = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  }
  return out;
}

function normalizePrefs(prefs) {
  const source = isObject(prefs) ? prefs : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_PREFS)) {
    const value = source[key];
    if (typeof fallback === "boolean") out[key] = bool(value, fallback);
    else if (PREF_RANGES[key]) {
      const [low, high] = PREF_RANGES[key];
      out[key] = typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback;
    } else out[key] = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  }
  return out;
}

// Where an agent works on the tree: `{ kind, id }` node references (session,
// todo, task, assistant, root, folded…), a visited list and a 0–1 progress.
const normalizeTarget = (value) => (isObject(value) && typeof value.kind === "string" && value.kind && typeof value.id === "string" && value.id ? { kind: value.kind, id: value.id } : null);
// The node the user pointed the assistant at from a tree: a target plus the
// label the click saw and when it landed.
const normalizeFocus = (value) =>
  isObject(value) && typeof value.kind === "string" && value.kind && typeof value.id === "string" && value.id
    ? { kind: value.kind, id: value.id, label: str(value.label).slice(0, 120), at: num(value.at, 0) }
    : null;
const normalizeTargets = (value) => asArray(value).map(normalizeTarget).filter(Boolean).slice(0, 24);
const normalizeProgress = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null);
const NO_PLACE = { target: null, targets: [], progress: null };

const emptyAgent = (role) => ({ role, status: "idle", since: 0, lastRunAt: 0, lastMs: 0, runs: 0, text: "", error: null, ...NO_PLACE });
const emptyPool = (prefs = DEFAULT_PREFS) => ({ parallel: prefs.parallel, aiParallel: prefs.aiParallel, running: 0, queued: 0 });

function normalizeAgentRow(role, row) {
  return {
    role,
    status: oneOf(row.status, AGENT_STATUSES, "idle"),
    since: num(row.since, 0),
    lastRunAt: num(row.lastRunAt, 0),
    lastMs: num(row.lastMs, 0),
    runs: Math.floor(num(row.runs, 0)),
    text: str(row.text).slice(0, 200),
    error: typeof row.error === "string" && row.error ? row.error.slice(0, 300) : null,
    target: normalizeTarget(row.target),
    targets: normalizeTargets(row.targets),
    progress: normalizeProgress(row.progress),
  };
}

// The roster always has exactly one row per AGENT_ROLES entry, in order:
// unknown roles are dropped, missing ones added. A queued or running row read
// back from disk becomes idle (and loses its place) — the process that ran it
// is gone; done/error rows keep where they worked.
function normalizeAgents(raw) {
  return normalizeAgentsKeepingLive(raw).map((row) => (row.status === "running" || row.status === "queued" ? { ...row, status: "idle", ...NO_PLACE } : row));
}

// The organize policy is the tree half of the prefs.
export function policyFromPrefs(prefs, policy = {}) {
  const source = normalizePrefs(prefs);
  return normalizePolicy({ ...DEFAULT_POLICY, ...(isObject(policy) ? policy : {}), foldAfterMinutes: source.foldAfterMinutes, staleAfterHours: source.staleAfterHours });
}

export function emptyState(now = Date.now()) {
  return {
    version: 1,
    status: "running",
    startedAt: now,
    heartbeatAt: 0,
    tickCount: 0,
    nextTickAt: 0,
    intervalMs: 30000,
    ai: { keyPresent: false, online: false, lastOkAt: 0, lastError: null, failures: 0, backoffUntil: 0, model: ASSISTANT_MODEL },
    action: { kind: "idle", text: "idle", since: now },
    lastError: null,
    messages: [],
    log: [],
    thinking: null,
    fixes: [],
    organization: {
      updatedAt: 0,
      policy: { ...DEFAULT_POLICY },
      order: [],
      active: [],
      stale: [],
      folded: [],
      counts: { sessions: 0, active: 0, stale: 0, folded: 0, hiddenTodos: 0 },
    },
    housekeeping: { lastAt: 0, tasksArchived: 0, ideasPruned: 0, requestsCleared: 0, checkpointsDropped: 0, foldersCleaned: 0, lastText: "" },
    problems: [],
    unread: 0,
    prefs: { ...DEFAULT_PREFS },
    pool: emptyPool(),
    agents: AGENT_ROLES.map(({ role }) => emptyAgent(role)),
    intel: [],
    work: [],
    overseer: emptyOverseer(),
    focus: null,
    nodeFolders: {},
    closedAt: 0,
    resumed: null,
  };
}

function normalizeWorkEntry(entry, now = 0) {
  if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.kind !== "string" || !entry.kind) return null;
  return {
    id: entry.id,
    kind: entry.kind,
    role: str(entry.role) || KIND_ROLES[entry.kind] || entry.kind,
    payload: isObject(entry.payload) ? entry.payload : {},
    taskId: typeof entry.taskId === "string" && entry.taskId ? entry.taskId : null,
    sessionId: typeof entry.sessionId === "string" && entry.sessionId ? entry.sessionId : null,
    text: str(entry.text).slice(0, 200),
    startedAt: num(entry.startedAt, 0) || now,
    attempts: Math.max(1, Math.floor(num(entry.attempts, 1))),
    status: oneOf(entry.status, ["running", "queued"], "running"),
    target: normalizeTarget(entry.target),
    targets: normalizeTargets(entry.targets),
    progress: normalizeProgress(entry.progress),
  };
}

function normalizeResumed(raw) {
  if (!isObject(raw)) return null;
  return {
    at: num(raw.at, 0),
    jobs: asArray(raw.jobs).filter((job) => typeof job === "string").map((job) => job.slice(0, 120)),
    closedForMs: num(raw.closedForMs, 0),
  };
}

function normalizeMessage(entry, index) {
  if (!isObject(entry) || typeof entry.text !== "string") return null;
  const at = num(entry.at, 0);
  return {
    id: str(entry.id) || `msg_${at}_${index}`,
    at,
    role: oneOf(entry.role, ["user", "assistant", "thinking"], "user"),
    text: entry.text,
    via: oneOf(entry.via, ["ai", "local"], "local"),
    intent: oneOf(entry.intent, INTENTS, "chat"),
  };
}

function normalizeLog(entry) {
  if (!isObject(entry) || typeof entry.text !== "string" || typeof entry.kind !== "string" || !entry.kind) return null;
  return { at: num(entry.at, 0), kind: entry.kind, text: entry.text };
}

function normalizeThinking(raw) {
  if (!isObject(raw) || typeof raw.text !== "string") return null;
  const text = raw.text.trim().slice(0, 400);
  if (!text) return null;
  return { text, at: num(raw.at, 0), role: str(raw.role).slice(0, 24) || "thinker" };
}

// Live thought plus a committed inner-monologue bubble. Thinking never
// bumps unread: it is the agent talking to itself in the assistant box.
export function applyThought(state, thought, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  const source = typeof thought === "string" ? { text: thought } : isObject(thought) ? thought : {};
  const text = clip(source.text, 400);
  if (!text) return current;
  const at = num(source.at, 0) || now;
  const role = str(source.role).slice(0, 24) || "thinker";
  const thinking = { text, at, role };
  const entry = normalizeMessage({ id: str(source.id) || `msg_think_${at}`, at, role: "thinking", text, via: "local", intent: "chat" }, asArray(current.messages).length);
  const messages = [...asArray(current.messages).map(normalizeMessage).filter(Boolean), entry].filter(Boolean);
  const indexes = messages.map((message, index) => (message.role === "thinking" ? index : -1)).filter((index) => index >= 0);
  const drop = indexes.length > THINKING_KEEP ? new Set(indexes.slice(0, indexes.length - THINKING_KEEP)) : null;
  return { ...current, thinking, messages: clampTail(drop ? messages.filter((_, index) => !drop.has(index)) : messages, CAPS.messages) };
}

export function clearThought(state, role = null, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  if (!current.thinking) return current;
  if (role && current.thinking.role !== role) return current;
  return { ...current, thinking: null };
}

function normalizeFix(entry) {
  if (!isObject(entry) || typeof entry.text !== "string" || typeof entry.kind !== "string" || !entry.kind) return null;
  return { at: num(entry.at, 0), kind: entry.kind, text: entry.text, ok: bool(entry.ok, true) };
}

function normalizeProblem(entry) {
  if (!isObject(entry) || typeof entry.kind !== "string" || !entry.kind) return null;
  return { kind: entry.kind, text: str(entry.text), since: num(entry.since, 0) };
}

// A valid state from anything: null, a partial file, junk keys, wrong types.
// Known fields are coerced, unknown ones dropped, arrays clamped to CAPS.
export function normalizeState(raw, now = Date.now()) {
  const state = emptyState(now);
  if (!isObject(raw)) return state;
  try {
    state.status = oneOf(raw.status, ["running", "paused"], "running");
    state.startedAt = num(raw.startedAt, now);
    state.heartbeatAt = num(raw.heartbeatAt, 0);
    state.tickCount = Math.floor(num(raw.tickCount, 0));
    state.nextTickAt = num(raw.nextTickAt, 0);
    state.intervalMs = num(raw.intervalMs, 0) || 30000;
    const ai = isObject(raw.ai) ? raw.ai : {};
    state.ai = {
      keyPresent: bool(ai.keyPresent, false),
      online: bool(ai.online, false),
      lastOkAt: num(ai.lastOkAt, 0),
      lastError: typeof ai.lastError === "string" && ai.lastError ? ai.lastError.slice(0, 300) : null,
      failures: Math.floor(num(ai.failures, 0)),
      backoffUntil: num(ai.backoffUntil, 0),
      model: str(ai.model) || ASSISTANT_MODEL,
    };
    const action = isObject(raw.action) ? raw.action : {};
    state.action = { kind: oneOf(action.kind, ACTION_KINDS, "idle"), text: str(action.text, "idle"), since: num(action.since, now) };
    state.lastError =
      isObject(raw.lastError) && typeof raw.lastError.text === "string" ? { at: num(raw.lastError.at, 0), text: raw.lastError.text.slice(0, 500) } : null;
    state.messages = clampTail(asArray(raw.messages).map(normalizeMessage).filter(Boolean), CAPS.messages);
    state.log = clampTail(asArray(raw.log).map(normalizeLog).filter(Boolean), CAPS.log);
    state.thinking = normalizeThinking(raw.thinking);
    state.fixes = clampTail(asArray(raw.fixes).map(normalizeFix).filter(Boolean), CAPS.fixes);
    const organization = isObject(raw.organization) ? raw.organization : {};
    const counts = isObject(organization.counts) ? organization.counts : {};
    state.organization = {
      updatedAt: num(organization.updatedAt, 0),
      policy: normalizePolicy(organization.policy),
      order: uniqueStrings(organization.order),
      active: uniqueStrings(organization.active),
      stale: uniqueStrings(organization.stale),
      folded: uniqueStrings(organization.folded),
      counts: Object.fromEntries(Object.keys(state.organization.counts).map((key) => [key, Math.floor(num(counts[key], 0))])),
    };
    const housekeeping = isObject(raw.housekeeping) ? raw.housekeeping : {};
    state.housekeeping = {
      lastAt: num(housekeeping.lastAt, 0),
      tasksArchived: Math.floor(num(housekeeping.tasksArchived, 0)),
      ideasPruned: Math.floor(num(housekeeping.ideasPruned, 0)),
      requestsCleared: Math.floor(num(housekeeping.requestsCleared, 0)),
      checkpointsDropped: Math.floor(num(housekeeping.checkpointsDropped, 0)),
      foldersCleaned: Math.floor(num(housekeeping.foldersCleaned, 0)),
      lastText: str(housekeeping.lastText),
    };
    state.problems = asArray(raw.problems).map(normalizeProblem).filter(Boolean);
    state.unread = Math.floor(num(raw.unread, 0));
    state.prefs = normalizePrefs(raw.prefs);
    state.agents = normalizeAgents(raw.agents);
    state.intel = asArray(raw.intel).map(normalizeIntelRow).filter(Boolean).slice(0, INTEL_CAP);
    state.pool = emptyPool(state.prefs); // nothing runs or waits in a freshly loaded state
    state.work = clampTail(asArray(raw.work).map((entry) => normalizeWorkEntry(entry, 0)).filter(Boolean), CAPS.work);
    state.overseer = normalizeOverseer(raw.overseer);
    state.focus = normalizeFocus(raw.focus);
    state.nodeFolders = normalizeNodeFolders(raw.nodeFolders);
    state.closedAt = num(raw.closedAt, 0);
    state.resumed = normalizeResumed(raw.resumed);
    return state;
  } catch {
    return emptyState(now);
  }
}

const byNewest = (a, b) => num(b.timeUpdated, 0) - num(a.timeUpdated, 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isOpenTodo = (todo) => todo.status !== "completed" && todo.status !== "cancelled";

// Classify the root sessions the rail shows into active / working / stale /
// folded and hand the renderer a display order. Deterministic for a given now.
export function organize({ sessions = [], todos = [], now = Date.now(), policy = {} } = {}) {
  const rules = normalizePolicy({ ...DEFAULT_POLICY, ...(isObject(policy) ? policy : {}) });
  const roots = asArray(sessions)
    .filter((session) => isObject(session) && typeof session.id === "string" && !session.parentId && num(session.timeUpdated, 0) > now - RAIL_WINDOW_MS)
    .sort(byNewest);
  const bySession = new Map();
  for (const todo of asArray(todos)) {
    if (!isObject(todo) || typeof todo.sessionId !== "string") continue;
    if (!bySession.has(todo.sessionId)) bySession.set(todo.sessionId, []);
    bySession.get(todo.sessionId).push(todo);
  }
  const active = [];
  const working = [];
  const stale = [];
  const folded = [];
  let staleQuietMs = 0; // the staliest stale session's quiet time, for the overseer digest
  for (const session of roots) {
    const list = bySession.get(session.id) ?? [];
    const sinceUpdate = now - num(session.timeUpdated, 0);
    const open = list.filter(isOpenTodo);
    const inProgress = open.some((todo) => todo.status === "in_progress");
    if (sinceUpdate < ACTIVE_WINDOW_MS || (inProgress && sinceUpdate < rules.staleAfterHours * HOUR)) active.push(session.id);
    // Pending todos can be a roadmap for a later phase. Only work that was
    // actually started is stale; otherwise an old, intentionally paused
    // roadmap keeps generating false A-Eyes warnings.
    else if (inProgress && sinceUpdate >= rules.staleAfterHours * HOUR) {
      stale.push(session.id);
      if (sinceUpdate > staleQuietMs) staleQuietMs = sinceUpdate;
    }
    else if (!open.length && sinceUpdate >= rules.foldAfterMinutes * MINUTE) folded.push(session.id);
    else if (!inProgress && sinceUpdate >= rules.staleAfterHours * HOUR) folded.push(session.id);
    else working.push(session.id);
  }
  const foldedSet = new Set(folded);
  let hiddenTodos = 0;
  for (const [sessionId, list] of bySession) if (foldedSet.has(sessionId)) hiddenTodos += list.length;
  return {
    updatedAt: now,
    policy: rules,
    order: [...active, ...working, ...stale].slice(0, rules.maxSessions),
    active,
    stale,
    folded,
    // Outside counts on purpose: it moves every tick, and sameOrganization
    // must not redraw the tree each time it does. The overseer digest reads it.
    staleQuietMin: staleQuietMs ? Math.round(staleQuietMs / MINUTE) : 0,
    counts: { sessions: roots.length, active: active.length, stale: stale.length, folded: folded.length, hiddenTodos },
  };
}

// True when two organize() results would draw the same tree (updatedAt ignored).
export function sameOrganization(a, b) {
  const pick = (org) => {
    const source = isObject(org) ? org : {};
    return JSON.stringify({ order: source.order ?? [], active: source.active ?? [], stale: source.stale ?? [], folded: source.folded ?? [], counts: source.counts ?? {} });
  };
  return pick(a) === pick(b);
}

// ---- the overseer: the R&D layer above the assistant ------------------------
// It never runs the assistant's jobs; it reviews how the assistant is doing
// them — roster health, reply mix, fix success, open problems, the work
// journal — and writes what it learns into a playbook (state.overseer) that
// survives restarts and sharpens every pass: a finding that repeats becomes a
// lesson whose hits grow, and the previous digest is kept so trends, not
// snapshots, drive the next review.
export const OVERSEER_LIMITS = { lessons: 24, directives: 40, findings: 8, scores: 12 };
// Pref keys the overseer may move on its own, each clamped to a safe band; the
// clamps keep the tuning reversible and away from the pool's edges.
export const OVERSEER_TUNABLES = { foldAfterMinutes: [15, 240], staleAfterHours: [6, 72], tidyDoneAfterHours: [6, 72], parallel: [1, PARALLEL_MAX], aiParallel: [1, AI_PARALLEL_MAX] };
const OVERSEER_HEALTHS = ["good", "fair", "poor"];
const OVERSEER_SEVERITIES = ["info", "warn", "critical"];
const OVERSEER_DIRECTIVE_KINDS = ["pref", "request", "lesson", "finding"];

export function emptyOverseer() {
  return { reviews: 0, lastReviewAt: 0, lastSummary: "", score: null, health: "unknown", findings: [], lessons: [], directives: [], scores: [], digest: null };
}

const normalizeOverseerFinding = (entry) =>
  isObject(entry) && str(entry.title).trim()
    ? { severity: oneOf(entry.severity, OVERSEER_SEVERITIES, "info"), title: clip(entry.title, 80), detail: clip(entry.detail, 240), persisting: bool(entry.persisting, false) }
    : null;
const normalizeOverseerLesson = (entry) =>
  isObject(entry) && str(entry.text).trim()
    ? { text: clip(entry.text, 200), hits: Math.max(1, Math.floor(num(entry.hits, 1))), firstAt: num(entry.firstAt, 0), lastAt: num(entry.lastAt, 0), source: oneOf(entry.source, ["local", "ai"], "local") }
    : null;
const normalizeOverseerDirective = (entry) =>
  isObject(entry) && str(entry.text).trim()
    ? { at: num(entry.at, 0), kind: oneOf(entry.kind, OVERSEER_DIRECTIVE_KINDS, "finding"), text: clip(entry.text, 240) }
    : null;

// A valid overseer slice from anything. lessons/directives/scores keep their
// newest entries; findings are only the last review's set.
export function normalizeOverseer(raw) {
  const source = isObject(raw) ? raw : {};
  const score = Number(source.score);
  return {
    reviews: Math.floor(num(source.reviews, 0)),
    lastReviewAt: num(source.lastReviewAt, 0),
    lastSummary: clip(source.lastSummary, 240),
    score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
    health: oneOf(source.health, OVERSEER_HEALTHS, "unknown"),
    findings: clampTail(asArray(source.findings).map(normalizeOverseerFinding).filter(Boolean), OVERSEER_LIMITS.findings),
    lessons: clampTail(asArray(source.lessons).map(normalizeOverseerLesson).filter(Boolean), OVERSEER_LIMITS.lessons),
    directives: clampTail(asArray(source.directives).map(normalizeOverseerDirective).filter(Boolean), OVERSEER_LIMITS.directives),
    scores: clampTail(
      asArray(source.scores)
        .map((entry) => (isObject(entry) && Number.isFinite(Number(entry.score)) ? { at: num(entry.at, 0), score: Math.min(100, Math.max(0, Math.round(Number(entry.score)))) } : null))
        .filter(Boolean),
      OVERSEER_LIMITS.scores,
    ),
    digest: isObject(source.digest) ? source.digest : null,
  };
}

// The telemetry a review reads. Pure: same state + now, same digest.
export function overseerDigest(state, now = Date.now()) {
  const current = isObject(state) ? state : {};
  const agents = asArray(current.agents).filter((row) => isObject(row) && typeof row.role === "string");
  const log = asArray(current.log).filter((entry) => isObject(entry));
  const messages = asArray(current.messages).filter((entry) => isObject(entry));
  const fixes = asArray(current.fixes).filter((entry) => isObject(entry));
  const work = asArray(current.work).filter((entry) => isObject(entry));
  const problems = asArray(current.problems).filter((entry) => isObject(entry));
  const ai = isObject(current.ai) ? current.ai : {};
  const housekeeping = isObject(current.housekeeping) ? current.housekeeping : {};
  const organization = isObject(current.organization) ? current.organization : {};
  const orgCounts = isObject(organization.counts) ? organization.counts : {};
  let unanswered = 0;
  for (const message of messages.slice().reverse()) {
    if (message.role === "assistant") break;
    if (message.role === "thinking") continue;
    if (message.role === "user") unanswered += 1;
  }
  return {
    at: now,
    ticks: Math.floor(num(current.tickCount, 0)),
    status: str(current.status, "running"),
    roster: agents.map((row) => ({ role: row.role, status: str(row.status, "idle"), runs: Math.floor(num(row.runs, 0)), lastMs: Math.round(num(row.lastMs, 0)), error: str(row.error) || null })),
    errorRoles: agents.filter((row) => row.status === "error").map((row) => row.role),
    logErrors: log.filter((entry) => entry.kind === "error").length,
    problems: { count: problems.length, kinds: problems.map((entry) => str(entry.kind)).filter(Boolean), aged: problems.filter((entry) => now - num(entry.since, 0) > HOUR).length },
    fixes: { total: fixes.length, failed: fixes.filter((entry) => entry.ok === false).length },
    replies: {
      ai: messages.filter((entry) => entry.role === "assistant" && entry.via === "ai").length,
      local: messages.filter((entry) => entry.role === "assistant" && entry.via !== "ai").length,
      unanswered,
    },
    work: { inFlight: work.length, stale: work.filter((entry) => now - num(entry.startedAt, 0) > WORK_STALE_MS).length },
    // The tree's own shape: sessions gone quiet mid-work are the review's
    // window into what the assistants on this machine left hanging.
    sessions: {
      stale: Math.floor(num(orgCounts.stale, 0)),
      active: Math.floor(num(orgCounts.active, 0)),
      folded: Math.floor(num(orgCounts.folded, 0)),
      staleQuietMin: Math.round(num(organization.staleQuietMin, 0)),
    },
    housekeeping: {
      lastAt: num(housekeeping.lastAt, 0),
      ageMin: num(housekeeping.lastAt, 0) ? Math.round((now - num(housekeeping.lastAt, 0)) / MINUTE) : null,
      cleared: Math.floor(num(housekeeping.tasksArchived, 0) + num(housekeeping.ideasPruned, 0) + num(housekeeping.requestsCleared, 0)),
    },
    ai: { keyPresent: bool(ai.keyPresent, false), online: bool(ai.online, false), failures: Math.floor(num(ai.failures, 0)), backoffMin: Math.max(0, Math.round((num(ai.backoffUntil, 0) - now) / MINUTE)) },
    prefs: normalizePrefs(current.prefs),
    intel: intelLines(current, now, { limit: 6, maxAgeMs: 30 * MINUTE }),
    builders: (() => {
      const rows = asArray(current.intel)
        .map(normalizeIntelRow)
        .filter((row) => row && row.role === "builder" && now - row.at <= 30 * MINUTE);
      return { reports: rows.length, fails: rows.filter((row) => row.facts?.ok === false).length };
    })(),
  };
}

// The deterministic pass — runs keyless, so the overseer keeps working while
// the AI is offline. Findings come from the digest alone; a finding that was
// already there last review is marked persisting and becomes a lesson (a
// confirmed pattern). The two pref rules below are the only knobs it reaches
// for on its own.
export function overseerReview(digest, overseer = null) {
  const d = isObject(digest) ? digest : {};
  const previous = isObject(overseer) ? overseer : {};
  const prevFindings = new Set(asArray(previous.findings).map((entry) => str(entry?.title)));
  const prevDigest = isObject(previous.digest) ? previous.digest : null;
  const findings = [];
  const add = (severity, title, detail = "") => findings.push({ severity, title: clip(title, 80), detail: clip(detail, 240), persisting: prevFindings.has(title) });
  for (const role of asArray(d.errorRoles).slice(0, 4)) add("warn", `${role} failing`, `the ${role} agent ended its last run in error`);
  if (num(d.problems?.count, 0)) add(d.problems.count >= 3 ? "warn" : "info", `${plural(d.problems.count, "open problem")}`, `${d.problems.kinds.slice(0, 4).join(", ")}${num(d.problems.aged, 0) ? ` · ${d.problems.aged} over 1h old` : ""}`);
  if (num(d.replies?.unanswered, 0)) add("warn", "unanswered messages", `${plural(d.replies.unanswered, "user message")} still waiting on a reply`);
  if (num(d.fixes?.failed, 0)) add("warn", "self-fixes failing", `${d.fixes.failed} of ${d.fixes.total} recorded fixes failed`);
  if (num(d.work?.stale, 0)) add("warn", "jobs stuck in flight", `${plural(d.work.stale, "journal job")} older than ${Math.round(WORK_STALE_MS / MINUTE)} min`);
  if (num(d.builders?.fails, 0)) add("warn", "builders reporting failures", `${plural(d.builders.fails, "failed run")} in the last half hour`);
  if (num(d.sessions?.stale, 0))
    add("warn", "stale sessions waiting", `${plural(num(d.sessions.stale), "session")} quiet with work in progress · oldest ${ago(num(d.sessions.staleQuietMin, 0))} · the repair pass files resume work`);
  if (num(d.ai?.failures, 0) >= 2) add("warn", "AI link failing", `${d.ai.failures} consecutive failure(s)${d.ai.backoffMin ? ` · backoff ${d.ai.backoffMin}m` : ""}`);
  else if (!d.ai?.keyPresent) add("info", "no API key", "replies and briefs are local-only until a key is saved");
  if (prevDigest && num(prevDigest.logErrors, 0) < num(d.logErrors, 0)) add("warn", "errors rising", `error log entries ${prevDigest.logErrors} → ${d.logErrors} since the last review`);
  if (d.housekeeping?.ageMin !== null && num(d.housekeeping?.ageMin, 0) > 4 * 60) add("info", "housekeeping stale", `last tidy ${ago(d.housekeeping.ageMin)}`);
  const weights = { critical: 25, warn: 12, info: 4 };
  const score = Math.max(0, Math.min(100, 100 - findings.reduce((sum, entry) => sum + (weights[entry.severity] ?? 4), 0)));
  const health = score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
  const lessons = findings.filter((entry) => entry.persisting && entry.severity !== "info").map((entry) => `${entry.title}: ${entry.detail}`);
  const prefs = {};
  if (num(d.ai?.failures, 0) >= 3 && num(d.prefs?.aiParallel, 1) > 1) prefs.aiParallel = d.prefs.aiParallel - 1;
  if (num(d.work?.stale, 0) >= 2 && num(d.prefs?.parallel, 1) < OVERSEER_TUNABLES.parallel[1]) prefs.parallel = d.prefs.parallel + 1;
  const upgrades = [];
  for (const role of asArray(d.errorRoles).slice(0, 2))
    upgrades.push({ title: `Fix the ${role} role`, prompt: `A-Eyes overseer: the ${role} agent ended its last run in error — read agents[].error in data/eyes-assistant.json, fix the root cause in main.cjs or scripts/assistant.mjs, keep tools/test_mefi_studio_assistant.py green.` });
  for (const kind of asArray(d.problems?.kinds).slice(0, 2)) {
    const role = PROBLEM_ROLES[kind];
    upgrades.push({
      title: `Resolve ${String(kind).replace(/-/g, " ")}`,
      prompt: role
        ? `A-Eyes overseer: open problem "${kind}" — send the ${role} to resolve it, then verify the problem is gone.`
        : `A-Eyes overseer: open problem "${kind}" — diagnose and resolve it.`,
    });
  }
  if (num(d.replies?.unanswered, 0)) upgrades.push({ title: "Drain the message queue", prompt: "A-Eyes overseer: user messages went unanswered — check the responder/pendingWork wiring in main.cjs and add a fixture case to tools/test_mefi_studio_assistant.py." });
  if (num(d.builders?.fails, 0))
    upgrades.push({
      title: "Unstick failed builder runs",
      prompt: "A-Eyes overseer: a builder reported a failed run — read the last intel.builder finding, diagnose the failure, and either retry the task or file a narrower follow-up so the queue keeps moving.",
    });
  const summary = findings.length ? `${health} · ${findings[0].title.toLowerCase()}${findings.length > 1 ? ` · +${findings.length - 1} more` : ""}` : "good · the workflow is healthy";
  return { summary, score, health, findings: findings.slice(0, OVERSEER_LIMITS.findings), lessons, prefs, upgrades: upgrades.slice(0, 4) };
}

const ROLE_SET = new Set(AGENT_ROLES.map((entry) => entry.role));
const TALK_SKIP = new Set(["overseer", "responder"]); // overseer never summons itself; unanswered mail is resumed, not a blank responder job

function wakeRole(roles, seen, role) {
  const name = str(role);
  if (!name || TALK_SKIP.has(name) || !ROLE_SET.has(name) || seen.has(name)) return;
  seen.add(name);
  roles.push(name);
}

// What the overseer says to the assistant, and which roles the assistant
// should send to fix it. Operational findings wake the owning scout;
// unanswered mail is flagged so the host restarts those replies; a healthy
// review with nothing repaired stays quiet so the thread is not spammed.
export function overseerTalk(review, { repaired = [], digest = null } = {}) {
  const findings = asArray(isObject(review) ? review.findings : null).filter(isObject);
  const fixed = asArray(repaired).filter((item) => typeof item === "string" && item);
  const roles = [];
  const seen = new Set();
  let resumeUnanswered = false;
  for (const role of asArray(digest?.errorRoles)) wakeRole(roles, seen, role);
  for (const kind of asArray(digest?.problems?.kinds)) wakeRole(roles, seen, PROBLEM_ROLES[kind]);
  for (const finding of findings) {
    const title = str(finding.title).toLowerCase();
    const failing = title.match(/^(\S+) failing$/);
    if (failing) wakeRole(roles, seen, failing[1]);
    if (/unanswered/.test(title)) resumeUnanswered = true;
    if (/stuck in flight|builders reporting|stale session/.test(title)) wakeRole(roles, seen, "foreman");
    if (/housekeeping/.test(title)) wakeRole(roles, seen, "keeper");
    const detail = str(finding.detail);
    for (const kind of Object.keys(PROBLEM_ROLES)) {
      if (detail.includes(kind) || title.includes(kind.replace(/-/g, " "))) wakeRole(roles, seen, PROBLEM_ROLES[kind]);
    }
  }
  if (!findings.length && !fixed.length) return { say: "", reply: "", roles: [], dispatch: false, organize: false, resumeUnanswered: false };
  const findingBits = findings.slice(0, 3).map((entry) => `${entry.title}${entry.detail ? ` (${clip(entry.detail, 50)})` : ""}`);
  const say = clip(
    fixed.length
      ? `I repaired ${fixed.slice(0, 3).join(", ")}${fixed.length > 3 ? ` +${fixed.length - 3}` : ""}${findingBits.length ? ` — still seeing: ${findingBits.join("; ")}` : "."}`
      : `I found ${findingBits.join("; ") || clip(str(review?.summary), 120) || "something off"}.`,
    REPLY_MAX_CHARS,
  );
  const reply = clip(
    roles.length
      ? `On it — sending ${roles.join(", ")} to fix ${clip(str(findings[0]?.title) || "that", 40)}.`
      : resumeUnanswered
        ? "On it — draining the unanswered messages now."
        : findings.length
          ? `Noted: ${clip(str(findings[0]?.title), 50)}. I'll keep watching.`
          : `Got it — ${clip(fixed[0], 60)}.`,
    REPLY_MAX_CHARS,
  );
  return {
    say,
    reply,
    roles,
    dispatch: roles.includes("foreman") || findings.some((entry) => /builder|stuck|stale session|queue/i.test(str(entry.title))),
    organize: findings.some((entry) => /stale session|tree|organiz/i.test(str(entry.title))),
    resumeUnanswered,
  };
}

// Validate a tune request (local review or AI) against OVERSEER_TUNABLES:
// unknown keys and non-numbers are rejected, values clamped, no-ops dropped.
export function overseerTune(prefs, tune) {
  const current = normalizePrefs(prefs);
  const source = isObject(tune) ? tune : {};
  const patch = {};
  const applied = [];
  const rejected = [];
  for (const [key, value] of Object.entries(source)) {
    const range = OVERSEER_TUNABLES[key];
    if (!range || !Number.isFinite(Number(value))) {
      rejected.push(key);
      continue;
    }
    const next = Math.min(range[1], Math.max(range[0], Math.round(Number(value))));
    if (next === current[key]) continue;
    patch[key] = next;
    applied.push({ key, from: current[key], to: next });
  }
  return { prefs: { ...current, ...patch }, applied, rejected };
}

// Fold one review into the playbook: lessons dedupe on their text (repeats
// raise hits — the memory of what keeps going wrong), the score history rolls,
// and directives record what the review actually did (prefs tuned, requests
// filed) so the next pass never re-issues open work.
export function overseerMerge(overseer, review, now = Date.now(), { digest = null, via = "local", directives = [] } = {}) {
  const base = normalizeOverseer(overseer);
  const source = isObject(review) ? review : {};
  const lessons = [...base.lessons];
  for (const item of asArray(source.lessons)) {
    const text = clip(typeof item === "string" ? item : item?.text, 200);
    if (!text) continue;
    const key = text.toLowerCase();
    const existing = lessons.find((entry) => entry.text.toLowerCase() === key);
    if (existing) {
      existing.hits += 1;
      existing.lastAt = now;
      if (via === "ai") existing.source = "ai";
    } else lessons.push({ text, hits: 1, firstAt: now, lastAt: now, source: via === "ai" ? "ai" : "local" });
  }
  lessons.sort((a, b) => b.hits - a.hits || b.lastAt - a.lastAt);
  const score = Number.isFinite(Number(source.score)) ? Math.min(100, Math.max(0, Math.round(Number(source.score)))) : base.score;
  return {
    reviews: base.reviews + 1,
    lastReviewAt: now,
    lastSummary: clip(source.summary, 240) || base.lastSummary,
    score,
    health: oneOf(source.health, OVERSEER_HEALTHS, base.health === "unknown" ? "fair" : base.health),
    findings: clampTail(asArray(source.findings).map(normalizeOverseerFinding).filter(Boolean), OVERSEER_LIMITS.findings),
    lessons: lessons.slice(0, OVERSEER_LIMITS.lessons),
    directives: clampTail([...base.directives, ...asArray(directives).map((entry) => normalizeOverseerDirective({ at: now, ...(isObject(entry) ? entry : {}) })).filter(Boolean)], OVERSEER_LIMITS.directives),
    scores: clampTail(score === null ? base.scores : [...base.scores, { at: now, score }], OVERSEER_LIMITS.scores),
    digest: digest ?? base.digest,
  };
}

// Roles that own an open problem and have not run since it appeared. Cadence
// still applies after that first attempt; queued/running rows stay skipped.
export function rolesForProblems(state, now = Date.now()) {
  const current = isObject(state) ? state : {};
  const rows = new Map(asArray(current.agents).filter((row) => isObject(row) && typeof row.role === "string").map((row) => [row.role, row]));
  const due = [];
  const seen = new Set();
  for (const problem of asArray(current.problems).filter(isObject)) {
    const role = PROBLEM_ROLES[str(problem.kind)];
    if (!role || seen.has(role)) continue;
    const row = rows.get(role);
    if (row && (row.status === "queued" || row.status === "running")) continue;
    const lastRunAt = num(row?.lastRunAt, 0);
    const appeared = num(problem.since, 0);
    if (lastRunAt && (!appeared || lastRunAt >= appeared)) continue;
    seen.add(role);
    due.push(role);
  }
  return due;
}

// Cadence roles whose interval elapsed since their last start (or that never
// ran), in roster order; queued/running roles are never re-enqueued, and AI
// roles (the briefer) wait for proactive mode, a key and the end of a backoff.
// An open problem pulls its owner due immediately the first time.
export function dueRoles(state, now = Date.now(), prefs = null) {
  const current = isObject(state) ? state : {};
  const rules = normalizePrefs({ ...DEFAULT_PREFS, ...(isObject(current.prefs) ? current.prefs : {}), ...(isObject(prefs) ? prefs : {}) });
  const rows = new Map(asArray(current.agents).filter((row) => isObject(row) && typeof row.role === "string").map((row) => [row.role, row]));
  const ai = isObject(current.ai) ? current.ai : {};
  const problemDue = new Set(rolesForProblems(current, now));
  const due = [];
  for (const { role, cadenceMs, ai: needsAi } of AGENT_ROLES) {
    if (!cadenceMs) continue;
    const row = rows.get(role);
    if (row && (row.status === "queued" || row.status === "running")) continue;
    const lastRunAt = num(row?.lastRunAt, 0);
    const cadenceElapsed = !lastRunAt || now - lastRunAt >= cadenceMs * CADENCE_TOLERANCE;
    if (!cadenceElapsed && !problemDue.has(role)) continue;
    if (needsAi && (!rules.proactive || !ai.keyPresent || now < num(ai.backoffUntil, 0))) continue;
    // The thinker is the proactive inner monologue: off the switch, it
    // stays quiet. No key required — it reads the log locally.
    if (role === "thinker" && !rules.proactive) continue;
    due.push(role);
  }
  return due;
}

// One roster transition (queued → running → done | error, or back to idle).
// Returns a new state: the row, pool counts and `action` are recomputed; an
// unknown role or status leaves the state untouched.
export function applyAgentEvent(state, event) {
  const current = isObject(state) ? state : emptyState();
  const source = isObject(event) ? event : {};
  const status = oneOf(source.status, AGENT_STATUSES, null);
  if (!status || !AGENT_ROLES.some((entry) => entry.role === source.role)) return current;
  const at = num(source.at, 0) || Date.now();
  const text = typeof source.text === "string" ? source.text.slice(0, 200) : null;
  const errorText = typeof source.error === "string" && source.error ? source.error.slice(0, 300) : null;
  const roster = normalizeAgentsKeepingLive(current.agents);
  const agents = roster.map((row) => {
    if (row.role !== source.role) return row;
    const elapsed = row.since && (row.status === "running" || row.status === "queued") ? Math.max(0, at - row.since) : 0;
    const next = { ...row, status, since: at };
    // Where it works: queued/running keep the row's place, done keeps the visited
    // list (target cleared, progress complete), error clears target and progress,
    // idle clears everything — and any field the event carries wins.
    if (status === "queued") Object.assign(next, { text: text ?? "queued", error: null, progress: null });
    else if (status === "running") Object.assign(next, { lastRunAt: at, text: text ?? ROLE_VERBS[row.role] ?? "running", error: null });
    else if (status === "done") Object.assign(next, { lastMs: num(source.ms, 0) || elapsed, runs: row.runs + 1, text: text ?? row.text, error: null, target: null, progress: 1 });
    else if (status === "error") Object.assign(next, { lastMs: num(source.ms, 0) || elapsed, runs: row.runs + 1, error: errorText ?? text ?? "failed", text: text ?? errorText ?? "failed", target: null, progress: null });
    else Object.assign(next, { text: text ?? row.text, ...NO_PLACE });
    if (Object.hasOwn(source, "target")) next.target = normalizeTarget(source.target);
    if (Object.hasOwn(source, "targets")) next.targets = normalizeTargets(source.targets);
    if (Object.hasOwn(source, "progress")) next.progress = normalizeProgress(source.progress);
    return next;
  });
  const running = agents.filter((row) => row.status === "running");
  const prefs = normalizePrefs(current.prefs);
  const pool = { parallel: prefs.parallel, aiParallel: prefs.aiParallel, running: running.length, queued: agents.filter((row) => row.status === "queued").length };
  const action = running.length
    ? { kind: ROLE_ACTION_KINDS[running[0].role] ?? "tick", text: running.map((row) => ROLE_VERBS[row.role] ?? row.role).join(" · "), since: Math.min(...running.map((row) => row.since || at)) }
    : { kind: "idle", text: "idle", since: at };
  return { ...current, agents, pool, action };
}

// The live roster (queued/running kept) with the same shape guarantees as normalizeAgents.
function normalizeAgentsKeepingLive(raw) {
  const rows = new Map(asArray(raw).filter((row) => isObject(row) && typeof row.role === "string").map((row) => [row.role, row]));
  return AGENT_ROLES.map(({ role }) => (rows.has(role) ? normalizeAgentRow(role, rows.get(role)) : emptyAgent(role)));
}

// What a boot (or a "resume the work" message) has to restart. Reads the RAW
// saved state on purpose: normalizeState turns running/queued agent rows idle,
// so the host calls this first. `exclude` skips message ids or texts: the
// message currently being answered is not "unanswered", and its own responder
// journal entry (payload.messageId or id job_reply_<id>) is not interrupted.
export function pendingWork(rawState, now = Date.now(), { exclude = [] } = {}) {
  const source = isObject(rawState) ? rawState : {};
  const skip = new Set(asArray(exclude).filter((item) => typeof item === "string" && item));
  const ownJob = (entry) => skip.has(str(entry.payload.messageId)) || (entry.id.startsWith("job_reply_") && skip.has(entry.id.slice("job_reply_".length)));
  const heartbeatAt = num(source.heartbeatAt, 0);
  const jobs = asArray(source.work)
    .map((entry) => normalizeWorkEntry(entry, heartbeatAt))
    .filter((entry) => entry && !ownJob(entry))
    .map((entry) => ({ ...entry, reason: "interrupted" }));
  const unanswered = [];
  for (const [index, raw] of asArray(source.messages).entries()) {
    const message = normalizeMessage(raw, index);
    if (!message) continue;
    if (message.role === "assistant") unanswered.length = 0;
    else if (message.role === "thinking") continue;
    else if (!skip.has(message.id) && !skip.has(message.text)) unanswered.push({ id: message.id, at: message.at, text: message.text });
  }
  const live = new Set(
    asArray(source.agents)
      .filter((row) => isObject(row) && (row.status === "running" || row.status === "queued"))
      .map((row) => row.role)
  );
  return {
    closedForMs: heartbeatAt ? Math.max(0, now - heartbeatAt) : 0,
    jobs,
    unanswered,
    interruptedRoles: AGENT_ROLES.map(({ role }) => role).filter((role) => live.has(role)),
  };
}

// Journal add/update (same id replaces in place) or remove ({ id, done: true }).
// Returns a new state; an entry without id/kind leaves the state untouched.
export function applyWork(state, entry, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  if (!isObject(entry) || typeof entry.id !== "string" || !entry.id) return current;
  const work = asArray(current.work).filter(isObject);
  if (entry.done === true) {
    const kept = work.filter((item) => item.id !== entry.id);
    return kept.length === work.length ? current : { ...current, work: kept };
  }
  const next = normalizeWorkEntry(entry, now);
  if (!next) return current;
  const index = work.findIndex((item) => item.id === next.id);
  const merged = index >= 0 ? work.map((item, at) => (at === index ? next : item)) : [...work, next];
  return { ...current, work: clampTail(merged, CAPS.work) };
}

// ---- agent intel: what each scout reported home to the assistant ----------
// Every role job ends by handing its finding to the assistant node — the one
// main agent that plans and dispatches the builders. Intel is one bounded row
// per role (latest wins), so the digest stays a roster-sized snapshot, not an
// unbounded feed. "builder" is not a roster seat — it is an executor run
// reporting home the same way a scout does.
export const INTEL_ROLES = [...AGENT_ROLES.map((entry) => entry.role), "builder"];
const INTEL_ROLE_SET = new Set(INTEL_ROLES);
const INTEL_CAP = INTEL_ROLES.length;
const INTEL_TEXT_MAX = 160;
const INTEL_FACTS_MAX = 8;
const INTEL_FACT_VALUE_MAX = 60;

const normalizeIntelFacts = (value) => {
  if (!isObject(value)) return {};
  const facts = {};
  for (const [key, raw] of Object.entries(value).slice(0, INTEL_FACTS_MAX)) {
    if (typeof key !== "string" || !key) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) facts[key] = raw;
    else if (typeof raw === "boolean") facts[key] = raw;
    else if (typeof raw === "string" && raw.trim()) facts[key] = raw.trim().slice(0, INTEL_FACT_VALUE_MAX);
  }
  return facts;
};

const normalizeIntelRow = (row) => {
  if (!isObject(row) || !INTEL_ROLE_SET.has(row.role)) return null;
  const text = str(row.text).trim().slice(0, INTEL_TEXT_MAX);
  if (!text) return null;
  return { role: row.role, at: num(row.at, 0), text, facts: normalizeIntelFacts(row.facts) };
};

// One report home: the row for that role is replaced and the array re-sorts
// newest first. An unknown role or an empty finding leaves the state alone.
export function applyIntel(state, event) {
  const current = isObject(state) ? state : emptyState();
  const row = normalizeIntelRow(isObject(event) ? event : {});
  if (!row || !row.text) return current;
  const intel = asArray(current.intel)
    .map(normalizeIntelRow)
    .filter(Boolean)
    .filter((entry) => entry.role !== row.role);
  intel.push(row);
  intel.sort((a, b) => b.at - a.at || (a.role < b.role ? -1 : 1));
  return { ...current, intel: intel.slice(0, INTEL_CAP) };
}

// The digest the main agent plans from: fresh findings, newest first, one
// line each. Stale rows (default older than 30 minutes) drop out — a plan
// built on yesterday's scan is worse than no plan.
export function intelLines(state, now = Date.now(), { limit = 6, maxAgeMs = 30 * MINUTE } = {}) {
  return asArray(isObject(state) ? state.intel : null)
    .map(normalizeIntelRow)
    .filter(Boolean)
    .filter((row) => row.text && (!maxAgeMs || now - row.at <= maxAgeMs))
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(1, limit))
    .map((row) => `${row.role} · ${row.text} (${ago(Math.max(0, (now - row.at) / MINUTE))})`);
}

// A working agent (roster scout or executor builder) reports home. The
// assistant records the finding, thinks it through as the overseer, and
// says whether to wake the overseer / foreman. Pure: same report, same
// decision. Failures always wake the overseer; successes stay on the intel
// board unless follow-up work was handed on.
export function hearReport(state, report, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  const source = isObject(report) ? report : {};
  const role = INTEL_ROLE_SET.has(str(source.role)) ? str(source.role) : "builder";
  const ok = source.ok !== false;
  const title = clip(str(source.title), 70);
  const finding = clip(str(source.text) || (ok ? `finished "${title}"` : `failed "${title}"`), INTEL_TEXT_MAX);
  if (!finding) return { state: current, finding: "", reply: "", wakeOverseer: false, wakeForeman: false };
  const handed = Math.floor(num(source.handed, 0));
  let next = applyIntel(current, { role, at: now, text: finding, facts: { ok, title, handed } });
  const reply = ok
    ? `Builder reported: finished "${title || "the job"}"${handed ? ` · ${handed} follow-up(s) handed on` : ""}.`
    : `Builder reported: failed "${title || "the job"}". ${clip(str(source.error) || "no done line", 80)} Looking at it.`;
  next = applyThought(next, { text: reply, role: "overseer", at: now }, now);
  return { state: next, finding, reply: clip(reply, REPLY_MAX_CHARS), wakeOverseer: !ok, wakeForeman: !ok || handed > 0 };
}

// The folder the way the chat and the cards read it: newest first, one line
// each — "run · executor · autopilot "fix ipc" — done · 2h ago".
export function nodeFolderLines(folders, target, { limit = 4, now = Date.now() } = {}) {
  const key = typeof target === "string" ? target : nodeKeyOf(target);
  const folder = key && isObject(folders) ? folders[key] : null;
  return asArray(folder?.entries)
    .filter(isObject)
    .slice(-Math.max(1, limit))
    .reverse()
    .map((entry) => `${entry.kind}${entry.role ? ` · ${entry.role}` : ""} · ${entry.text} · ${ago(Math.max(0, (now - num(entry.at, now)) / MINUTE))}`);
}

// `session:<id>` / `todo:<id>` / `task:<id>` — the folder key of a node target
// ({ kind, id } as the tree and the focus use them). Null when the node kind
// carries no folder.
export function nodeKeyOf(target) {
  return isObject(target) && FOLDER_NODE_KINDS.has(target.kind) && typeof target.id === "string" && target.id ? `${target.kind}:${target.id}` : null;
}

export function inferMemoryCell(kind, text, role) {
  const body = String(text ?? "");
  if (kind === "run") return /\bfail|\berror\b|gave up|exit [^0]/i.test(body) ? "rsk" : "ver";
  if (role === "overseer") return /\brisk\b|\bstale\b|\bfail/i.test(body) ? "rsk" : "bel";
  if (kind === "note" || (kind === "chat" && /\bdecid(?:ed|e)|going with|we will\b/i.test(body))) return "dec";
  return "obs";
}

const normalizeFolderEntry = (entry) => {
  if (!isObject(entry) || typeof entry.text !== "string" || !entry.text.trim()) return null;
  const kind = oneOf(entry.kind, FOLDER_KINDS, "note");
  const role = str(entry.role).slice(0, 24) || null;
  const text = clip(entry.text, FOLDER_LIMITS.text);
  const cell = oneOf(entry.cell, MEMORY_CELLS, inferMemoryCell(kind, text, role));
  const claimed = typeof entry.confidence === "number" && Number.isFinite(entry.confidence) ? Math.min(1, Math.max(0.1, entry.confidence)) : cell === "ver" ? 0.85 : 0.6;
  // Unverified claims cannot enter above 0.7 — the Recall gate's attenuation.
  const confidence = cell === "ver" ? claimed : Math.min(claimed, 0.7);
  return {
    at: num(entry.at, 0),
    kind,
    role,
    text,
    cell,
    confidence,
    superseded: entry.superseded === true,
    contradicts: str(entry.contradicts).slice(0, 80) || null,
  };
};

const normalizeFolder = (folder) => {
  if (!isObject(folder)) return null;
  const raw = asArray(folder.entries).map(normalizeFolderEntry).filter(Boolean);
  if (!raw.length) return null;
  const entries = clampTail(raw, FOLDER_LIMITS.entries);
  return { updatedAt: num(folder.updatedAt, entries[entries.length - 1].at), entries };
};

// A valid folder map from anything: junk keys and empty folders dropped, every
// folder clamped to its newest entries, the map itself capped to the folders
// touched most recently.
export function normalizeNodeFolders(raw) {
  const source = isObject(raw) ? raw : {};
  const kept = [];
  for (const [key, folder] of Object.entries(source)) {
    if (!key.includes(":")) continue;
    const clean = normalizeFolder(folder);
    if (clean) kept.push([key, clean]);
  }
  kept.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(kept.slice(0, FOLDER_LIMITS.folders));
}

// One context entry lands on a node's folder: newest last, the cap keeps the
// newest, and an exact repeat of the newest line replaces it (a run that
// reports the same thing twice is one note, not two).
export function applyNodeContext(state, entry, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  const source = isObject(entry) ? entry : {};
  const key = typeof source.key === "string" && source.key.includes(":") ? source.key : nodeKeyOf(source.target);
  const clean = normalizeFolderEntry({
    at: num(source.at, now) || now,
    kind: source.kind,
    role: source.role,
    text: str(source.text),
    cell: source.cell,
    confidence: source.confidence,
    superseded: source.superseded,
    contradicts: source.contradicts,
  });
  if (!key || !clean) return current;
  const folders = normalizeNodeFolders(current.nodeFolders);
  const folder = folders[key] ? { updatedAt: folders[key].updatedAt, entries: [...folders[key].entries] } : { updatedAt: 0, entries: [] };
  const last = folder.entries[folder.entries.length - 1];
  if (last && last.kind === clean.kind && last.text === clean.text) folder.entries[folder.entries.length - 1] = { ...clean, superseded: false };
  else {
    const incomingKey = compactKey(clean.text);
    const contra = compactKey(clean.contradicts);
    for (const existing of folder.entries) {
      if (existing.superseded) continue;
      const existingKey = compactKey(existing.text);
      if (incomingKey && existingKey === incomingKey) existing.superseded = true;
      else if (contra && (existingKey === contra || existing.text.toLowerCase().includes(String(clean.contradicts).toLowerCase()))) existing.superseded = true;
    }
    folder.entries.push(clean);
  }
  folder.entries = clampTail(folder.entries, FOLDER_LIMITS.entries);
  folder.updatedAt = clean.at;
  folders[key] = folder;
  return { ...current, nodeFolders: normalizeNodeFolders(folders) };
}

// The write gate Recall-style: one way into a folder. Same bounds as
// applyNodeContext; the cell/confidence/contradicts fields ride along.
export function admitMemory(state, proposal, now = Date.now()) {
  return applyNodeContext(state, proposal, now);
}

// Push memory: compile a budgeted mini-index against the current prompt.
// Ranked by cell weight, focus, token overlap and recency. Superseded rows
// stay in the list flagged [SUPERSEDED?] so the agent cannot act on a stale
// title the way a similarity search would.
export function compileMemory({ query = "", folders = null, lessons = null, focus = null, now = Date.now(), limit = 6 } = {}) {
  const q = compactKey(query);
  const tokens = new Set(q.split(" ").filter((token) => token.length > 2));
  const focusKey = nodeKeyOf(focus);
  const cells = [];
  for (const [key, folder] of Object.entries(isObject(folders) ? folders : {})) {
    for (const entry of asArray(folder?.entries)) {
      const mem = normalizeFolderEntry(entry);
      if (!mem) continue;
      const hay = compactKey(`${mem.text} ${key}`);
      let score = MEMORY_CELL_WEIGHT[mem.cell] ?? 1;
      if (key === focusKey) score += 5;
      if (mem.superseded) score -= 6;
      for (const token of tokens) if (hay.includes(token)) score += 2;
      const ageMin = Math.max(0, (now - mem.at) / MINUTE);
      score += ageMin < 60 ? 2 : ageMin < 24 * 60 ? 1 : 0;
      cells.push({
        ...mem,
        folder: key,
        score,
        handle: `${mem.cell}_${String(mem.at || 0).toString(36).slice(-4)}`,
      });
    }
  }
  for (const lesson of asArray(lessons)) {
    const text = clip(typeof lesson === "string" ? lesson : str(lesson?.text || lesson?.title), FOLDER_LIMITS.text);
    if (!text) continue;
    const hay = compactKey(text);
    let score = MEMORY_CELL_WEIGHT.bel;
    for (const token of tokens) if (hay.includes(token)) score += 2;
    cells.push({ cell: "bel", kind: "agent", role: "overseer", text, at: 0, superseded: false, confidence: 0.6, folder: "playbook", score, handle: "bel_play" });
  }
  cells.sort((a, b) => b.score - a.score || b.at - a.at);
  const picked = cells.slice(0, Math.max(1, limit));
  const primer = picked.map((cell) => `${cell.handle} "${clip(cell.text, 70)}"${cell.superseded ? " [SUPERSEDED?]" : ""}`);
  const flags = picked.filter((cell) => cell.superseded).map((cell) => cell.handle);
  return { primer, flags, cells: picked, dig: flags.length > 0 };
}

// The owner (or the keeper) empties one folder. A folder that holds nothing is
// not kept — the map only ever lists folders with content.
export function clearNodeFolder(state, target, now = Date.now()) {
  const current = isObject(state) ? state : emptyState(now);
  const key = typeof target === "string" ? target : nodeKeyOf(target);
  if (!key || !isObject(current.nodeFolders) || !current.nodeFolders[key]) return current;
  const folders = { ...current.nodeFolders };
  delete folders[key];
  return { ...current, nodeFolders: folders };
}

function duration(ms) {
  const total = Math.max(0, Math.round(num(ms, 0) / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} h ${restMinutes} m` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

// A text that already carries quotes (`gather for task "…"`) is not wrapped again.
const quoted = (text) => (text.includes('"') ? clip(text, 60) : `"${clip(text, 40)}"`);
const describeWork = (entry) => (entry.kind === "responder" ? `reply to ${quoted(entry.text)}` : `${entry.kind}${entry.text ? ` ${quoted(entry.text)}` : ""}`);

// One line per restarted item: unanswered replies, bare interrupted roles not
// covered by a journal entry, then the journal entries themselves.
function describePending(pending) {
  const source = isObject(pending) ? pending : {};
  const jobs = asArray(source.jobs).filter(isObject);
  const covered = new Set(jobs.map((job) => job.role));
  const items = [
    ...asArray(source.unanswered).filter(isObject).map((message) => `reply to "${clip(message.text, 40)}"`),
    ...asArray(source.interruptedRoles).filter((role) => typeof role === "string" && !covered.has(role)),
    ...jobs.map(describeWork),
  ];
  return [...new Set(items)];
}

// The boot line for the log, the thread and the toast.
export function resumeSummary(pending) {
  const source = isObject(pending) ? pending : {};
  const closed = num(source.closedForMs, 0) > 0 ? `closed for ${duration(source.closedForMs)}` : "no previous heartbeat";
  const items = describePending(source);
  if (!items.length) return `${closed} · nothing to restart`;
  const shown = items.slice(0, 6);
  const more = items.length - shown.length;
  return clip(`${closed} · restarting ${plural(items.length, "job")}: ${shown.join(", ")}${more ? ` +${more} more` : ""}`, 300);
}

const stampOf = (item) => num(item.updatedAt, num(item.at, 0));

function tidyTasks(tasks, now, hours, report) {
  const cutoff = now - hours * HOUR;
  let touched = false;
  const next = tasks.map((task) => {
    if (!isObject(task) || task.status !== "done") return task;
    const updatedAt = num(task.updatedAt, num(task.createdAt, 0));
    if (!updatedAt || updatedAt >= cutoff) return task; // no timestamp at all: age unknown, leave it
    touched = true;
    report.tasksArchived += 1;
    return { ...task, status: "archived", doneAt: num(task.doneAt, 0) || updatedAt || num(task.createdAt, now) || now, logs: [...asArray(task.logs), { at: now, kind: "status", text: "archived by the assistant" }] };
  });
  return touched ? next : tasks;
}

function tidyIdeas(ideas, now, report) {
  // Ideas are durable work and history. Age, read state, and queue size are
  // not evidence that a note was implemented; only an explicit delete removes
  // it. Bound admission to the builder instead of truncating the saved inbox.
  return ideas;
}

function sessionIdsOf(value) {
  const rows = isObject(value) && value.sessions != null ? asArray(value.sessions) : asArray(value);
  return uniqueStrings(rows.map((entry) => (typeof entry === "string" ? entry : str(entry?.sessionId)))).sort();
}

function sessionSetKey(value) {
  return sessionIdsOf(value).join("|");
}

function requestFileList(value) {
  return uniqueStrings([value?.file, ...asArray(value?.files)]);
}

function liveCollisionIndex(collisions) {
  const files = new Set();
  const pairs = new Set();
  for (const entry of collisions) {
    const row = isObject(entry) ? entry : { file: entry };
    for (const file of collisionFiles(row)) files.add(file);
    const key = sessionSetKey(row);
    if (key) pairs.add(key);
  }
  return { files, pairs };
}

function collisionRequestLive(request, live) {
  if (requestFileList(request).some((file) => live.files.has(file))) return true;
  const key = sessionSetKey(request);
  return Boolean(key) && live.pairs.has(key);
}

function preferCollisionRequest(candidate, current) {
  const candAt = num(candidate.at, 0);
  const curAt = num(current.at, 0);
  if (candAt !== curAt) return candAt > curAt;
  return requestFileList(candidate).length > requestFileList(current).length;
}

function mergeCollisionRequest(winner, other) {
  const files = uniqueStrings([...requestFileList(winner), ...requestFileList(other)]);
  const sessions = sessionIdsOf(winner).length ? sessionIdsOf(winner) : sessionIdsOf(other);
  const owner = str(winner.owner) || str(other.owner) || null;
  if (
    files.length === requestFileList(winner).length &&
    files.every((file, index) => file === requestFileList(winner)[index]) &&
    owner === (str(winner.owner) || null)
  ) {
    return winner;
  }
  return { ...winner, files, file: winner.file || files[0] || other.file, sessions, owner };
}

function tidyRequests(requests, { now, collisions, audit, duplicates }, report) {
  const findings = isObject(audit) && Array.isArray(audit.findings) ? audit.findings.map((finding) => str(finding?.message)).filter(Boolean) : null;
  // A grouped collision's representative file is the newest one; leftover
  // per-file alerts still count as live if they share a file or the same
  // session pair.
  const live = Array.isArray(collisions) ? liveCollisionIndex(collisions) : null;
  const scannedDupes = isObject(duplicates) && Array.isArray(duplicates.scanned)
    ? new Set(duplicates.scanned.filter((file) => typeof file === "string"))
    : null;
  const dirtyDupes = isObject(duplicates) && Array.isArray(duplicates.findings)
    ? new Set(duplicates.findings.map((row) => (isObject(row) ? row.file : row)).filter((file) => typeof file === "string"))
    : null;
  const cutoff = now - TIDY_LIMITS.autoRequestDays * DAY;
  const protectedRequest = (request) => !isObject(request) || request.source === "chat" || !AUTO_SOURCES.has(request.source) || request.status === "running" || request.status === "verifying";
  let removed = 0;
  let kept = requests.filter((request) => {
    if (protectedRequest(request)) return true;
    const prompt = str(request.prompt);
    if (request.source === "audit" && findings && !findings.some((message) => prompt.includes(message))) return false;
    if (request.source === "collision" && live && !collisionRequestLive(request, live)) return false;
    if (request.source === "duplicate" && scannedDupes && scannedDupes.has(request.file) && dirtyDupes && !dirtyDupes.has(request.file)) return false;
    const at = num(request.at, 0);
    if (at && at < cutoff) return false;
    return true;
  });
  removed += requests.length - kept.length;
  // Exact duplicate prompts: keep the newest auto copy (or every manual one).
  const seen = new Map();
  for (const request of kept) {
    if (!isObject(request) || typeof request.prompt !== "string") continue;
    const entry = seen.get(request.prompt) ?? { manual: false, newest: null };
    if (protectedRequest(request)) entry.manual = true;
    else if (!entry.newest || num(request.at, 0) > num(entry.newest.at, 0)) entry.newest = request;
    seen.set(request.prompt, entry);
  }
  const deduped = kept.filter((request) => {
    if (protectedRequest(request) || typeof request.prompt !== "string") return true;
    const entry = seen.get(request.prompt);
    return !entry.manual && entry.newest === request;
  });
  removed += kept.length - deduped.length;
  kept = deduped;
  report.requestsCleared += removed;
  return removed ? kept : requests;
}

function tidyCheckpoints(checkpoints, sessions, now, report) {
  const known = Array.isArray(sessions) ? new Set(sessions.map((session) => (isObject(session) ? session.id : null)).filter(Boolean)) : null;
  const cutoff = now - TIDY_LIMITS.checkpointDays * DAY;
  let touched = false;
  const next = {};
  for (const [sessionId, list] of Object.entries(checkpoints)) {
    if (!Array.isArray(list)) {
      next[sessionId] = list;
      continue;
    }
    const newest = list.reduce((max, note) => Math.max(max, isObject(note) ? num(note.at, 0) : 0), 0);
    if (known && !known.has(sessionId) && newest < cutoff) {
      report.checkpointsDropped += Math.max(1, list.length);
      touched = true;
      continue;
    }
    if (list.length > TIDY_LIMITS.checkpointsPerSession) {
      const keep = new Set(list.slice().sort((a, b) => (isObject(b) ? num(b.at, 0) : 0) - (isObject(a) ? num(a.at, 0) : 0)).slice(0, TIDY_LIMITS.checkpointsPerSession));
      next[sessionId] = list.filter((note) => keep.has(note));
      report.checkpointsDropped += list.length - next[sessionId].length;
      touched = true;
      continue;
    }
    next[sessionId] = list;
  }
  return touched ? next : checkpoints;
}

// ---- the compactor: keep the queue small and runnable ------------------------
// The keeper prunes by age. The compactor works on shape instead: the same job
// asked for five times is one job, a request for something already on the board
// is nothing, and a task parked on a backoff that has expired is work waiting to
// be picked up. It never deletes anything a human asked for that is not a
// duplicate, and it never touches a running claim.
export const COMPACT_LIMITS = {
  reviveAfterHours: 6, // legacy setting; exhausted attempts now need an explicit retry
  maxFailures: 5, // matches the executor's own skip threshold
  keepRequests: 60, // legacy display budget; never truncates persisted work
  // An auto-filed request is a snapshot of a problem the filing pass re-checks
  // every tick — unclaimed this long, the snapshot moved on. The pass files it
  // again if the problem is still there, so expiring loses nothing and keeps
  // the backlog a list of what is worth doing now, not what was worth doing.
  // A missing `at` is already stale: resume/overseer snapshots that never got
  // a clock would otherwise sit forever.
  staleRequestHours: 12,
  // Accepted plans do not expire while waiting in the backlog. A caller may
  // explicitly dissolve old groups with a finite limit; their work is restored.
  stalePlanHours: Infinity,
  // Ideas pile up faster than anyone reads them (51 unread was normal), so the
  // compactor folds them into plans: a tag shared by this many new ideas is a
  // theme worth one task, not N notes nobody will open.
  planMinIdeas: 3,
  maxPlansPerPass: 2, // a burst of ideas becomes a couple of plans, not twenty tasks
  planIdeaCap: 8, // how many ideas one plan carries into its prompt
  planTaskCap: 8, // how many open tasks one AI-review plan may absorb
  // Legacy scheduling budget. Overflow remains saved; execution owns admission.
  maxSelfMaintenance: 6,
};

// A task about the assistant's own machinery rather than the app it builds.
const SELF_MAINTENANCE_TITLE = /^(?:overseer|assistant|a-eyes)\s*:/i;
export const isSelfMaintenance = (item) => SELF_MAINTENANCE_TITLE.test(String(item?.title ?? ""));

// Titles are matched loosely so "Fix the auditor role" and "fix the auditor
// role." collapse; punctuation and run-on whitespace carry no meaning here.
// The same title key the executor's spawn guard uses to keep one copy of a
// job in flight — exported so main never grows a second normaliser.
export const compactKey = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function collisionFiles(collision) {
  const files = asArray(collision?.files).map(str).filter(Boolean);
  if (files.length) return files;
  return str(collision?.file) ? [str(collision.file)] : [];
}

function workFiles(job) {
  const files = [];
  const add = (value) => {
    if (typeof value === "string" && value.trim()) files.push(value.trim());
  };
  add(job?.file);
  for (const file of asArray(job?.files)) add(file);
  add(job?.ref?.file);
  for (const file of asArray(job?.ref?.files)) add(file);
  // Board tasks store paths on `refs` (`kind: "file"`), not a top-level `file`.
  for (const row of [...asArray(job?.refs), ...asArray(job?.ref?.refs)]) {
    if (!isObject(row)) continue;
    if (str(row.kind) && str(row.kind) !== "file") continue;
    add(row.file || row.path || row.title);
  }
  return uniqueStrings(files);
}

function explicitFiles(job) {
  return workFiles(job);
}

export function filesOverlap(a, b) {
  const left = uniqueStrings(a);
  const right = uniqueStrings(b);
  if (!left.length || !right.length) return false;
  return left.some((file) => right.some((item) => sameFile(file, item)));
}

export function claimedFiles(jobs = []) {
  const files = [];
  for (const job of asArray(jobs)) {
    if (!isObject(job) || job.finished) continue;
    files.push(...explicitFiles(job));
  }
  return uniqueStrings(files);
}

function sameFile(a, b) {
  const left = String(a ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const right = String(b ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`) || basename(left) === basename(right);
}

function sessionRow(entry) {
  if (typeof entry === "string" && entry) return { sessionId: entry, edits: 0, lastEdit: 0, active: false, files: [] };
  if (!isObject(entry) || !str(entry.sessionId)) return null;
  return {
    sessionId: str(entry.sessionId),
    edits: num(entry.edits, 0),
    lastEdit: num(entry.lastEdit, 0),
    active: entry.active === true,
    files: uniqueStrings(asArray(entry.files).map(str).filter(Boolean)),
  };
}

function pickSessionOwner(entries) {
  return (
    [...entries].sort(
      (a, b) =>
        (b.edits ?? 0) - (a.edits ?? 0) ||
        (b.lastEdit ?? 0) - (a.lastEdit ?? 0) ||
        String(a.sessionId).localeCompare(String(b.sessionId))
    )[0]?.sessionId ?? null
  );
}

function ownershipRows(entry) {
  return asArray(entry?.ownership)
    .filter(isObject)
    .map((row) => ({ file: str(row.file), owner: str(row.owner) || null }))
    .filter((row) => row.file);
}

function matchesWorkFiles(files, named, hay) {
  if (!files.length) return false;
  if (named.length) return files.some((file) => named.some((item) => sameFile(file, item)));
  return files.some((file) => {
    const name = compactKey(basename(file));
    return name.length >= 3 && hay.includes(name);
  });
}

function presenceAsCollision(row) {
  const file = str(row?.file);
  const owner = str(row?.owner) || null;
  const ownership = ownershipRows(row);
  return {
    file,
    files: file ? [file] : [],
    owner,
    ownership: ownership.length ? ownership : file ? [{ file, owner }] : [],
    sessions: asArray(row?.editors).length ? row.editors : asArray(row?.sessions),
    active: true,
  };
}

// Words that show up in every collaboration prompt; matching on them would
// flag every live session as a peer implementation.
const COLLAB_STOP = new Set([
  "about", "after", "already", "another", "before", "clobber", "clobbering", "could",
  "detect", "feature", "file", "files", "from", "have", "implement", "implementation",
  "implementations", "ideas", "instead", "integrate", "into", "live", "missing",
  "other", "pieces", "plan", "rather", "session", "sessions", "should", "their",
  "there", "these", "this", "that", "with", "work", "would", "when", "concurrent",
  "uncommitted",
]);

function collabNeedles(job) {
  return compactKey(`${str(job?.title)} ${str(job?.prompt)}`)
    .split(" ")
    .filter((word) => word.length >= 5 && !COLLAB_STOP.has(word));
}

function sessionTodoText(session, todosById) {
  const nested = asArray(session?.todos).map((todo) => (isObject(todo) ? str(todo.content) : str(todo)));
  const extra = asArray(todosById.get(str(session?.id || session?.sessionId))).map((todo) => str(todo.content ?? todo));
  return [...nested, ...extra].filter(Boolean).join(" ");
}

function overlappingSessions(job, sessions, todos = []) {
  const needles = collabNeedles(job);
  if (!needles.length) return [];
  const todosById = new Map();
  for (const todo of asArray(todos).filter(isObject)) {
    const id = str(todo.sessionId);
    if (!id) continue;
    const list = todosById.get(id) ?? [];
    list.push(todo);
    todosById.set(id, list);
  }
  const hits = [];
  const seen = new Set();
  for (const session of asArray(sessions).filter(isObject)) {
    const id = str(session.id || session.sessionId);
    if (!id || session.parentId || seen.has(id)) continue;
    const hay = compactKey(`${str(session.title)} ${sessionTodoText(session, todosById)}`);
    if (!needles.some((word) => hay.includes(word))) continue;
    seen.add(id);
    hits.push({
      sessionId: id,
      title: str(session.title),
      edits: num(session.edits, 0),
      active: session.active === true,
      files: [],
    });
  }
  return hits;
}

// Live file editors block a colliding pick; a pin, a chat ask, or a
// collision-resolution job still runs (with adopt advice) so the queue
// cannot park itself on someone else's uncommitted buffer.
export function shouldHoldWork(collab, work = {}) {
  if (!isObject(collab) || collab.action !== "defer") return false;
  // A sibling executor job already claimed the file — even a pin waits.
  if (str(collab.reason) === "claimed") return true;
  if (str(work.source) === "collision") return false;
  if (work.pin === true || work.ref?.pin === true) return false;
  if (str(work.source) === "chat") return false;
  return true;
}

// Peer-session collaboration: given a piece of work, live file collisions,
// who is editing each file right now, and live session titles/todos, decide
// whether to adopt another session's implementation, wait on a live editor,
// or proceed. Title overlap is "they already built this feature" (adopt);
// a live editor on the same file is "do not merge yet" (defer). Presence
// catches a single live editor before a second session turns it into a
// collision. The executor prepends `advice` and skips a defer pick so a
// parallel run does not clobber uncommitted work another session has on disk.
export function collaborate({ work = null, collisions = [], presence = [], sessions = [], todos = [], uncommitted = [] } = {}) {
  const empty = { action: "proceed", owner: null, peers: [], liveEditors: [], files: [], ownership: [], collaborating: false, advice: "", featurePeers: [], handoff: false };
  const job = isObject(work) ? work : {};
  const named = workFiles(job);
  const hay = compactKey(`${str(job.title)} ${str(job.prompt)}`);
  const groups = [...asArray(collisions).filter(isObject), ...asArray(presence).filter(isObject).map(presenceAsCollision)].filter(
    (collision) => matchesWorkFiles(collisionFiles(collision), named, hay)
  );
  const featurePeers = overlappingSessions(job, sessions, todos);
  const dirty = asArray(uncommitted).filter((row) => isObject(row) && matchesWorkFiles(collisionFiles(row), named, hay));
  const headBit = dirty.length
    ? ` HEAD does not have this feature — ${dirty
        .slice(0, 2)
        .map((row) => basename(row.file) || row.file)
        .join(", ")} ${dirty.length === 1 ? "exists" : "exist"} only as uncommitted changes. Do not assume committed HEAD contains this work.`
    : "";
  if (!groups.length && !featurePeers.length) {
    if (!dirty.length) return empty;
    return { ...empty, files: uniqueStrings(dirty.flatMap(collisionFiles)), advice: headBit.trim() };
  }

  const files = uniqueStrings(groups.flatMap(collisionFiles));
  const ownership = [];
  const seenOwn = new Set();
  const peers = [];
  const liveEditors = [];
  const seen = new Set();
  let owner = null;
  for (const collision of groups) {
    if (!owner && str(collision.owner)) owner = str(collision.owner);
    for (const row of ownershipRows(collision)) {
      const key = row.file.replace(/[\\/]+/g, "/").toLowerCase();
      if (seenOwn.has(key)) continue;
      seenOwn.add(key);
      ownership.push(row);
    }
    const groupActive = collision.active === true;
    for (const raw of asArray(collision.sessions)) {
      const row = sessionRow(raw);
      if (!row) continue;
      const flag = isObject(raw) && typeof raw.active === "boolean" ? raw.active : null;
      // An explicit idle owner stays idle even when a peer keeps the group live.
      // Missing flags fall back to the group so legacy rows still defer.
      const active = flag === null ? groupActive : flag;
      const rowFiles = row.files.length ? row.files : collisionFiles(collision);
      if (!seen.has(row.sessionId)) {
        seen.add(row.sessionId);
        const peer = { sessionId: row.sessionId, edits: row.edits, lastEdit: row.lastEdit, active, files: rowFiles };
        peers.push(peer);
        if (active) liveEditors.push(peer);
      } else {
        const existing = peers.find((peer) => peer.sessionId === row.sessionId);
        if (existing) {
          existing.edits = Math.max(existing.edits, row.edits);
          existing.lastEdit = Math.max(existing.lastEdit, row.lastEdit);
          existing.files = uniqueStrings([...existing.files, ...rowFiles]);
          if (active && !existing.active) {
            existing.active = true;
            liveEditors.push(existing);
          }
        }
      }
    }
  }
  if (!owner) owner = str(featurePeers[0]?.sessionId) || pickSessionOwner(peers);
  const splitOwners = uniqueStrings(ownership.map((row) => row.owner).filter(Boolean));
  const disjoint =
    !ownership.length &&
    peers.length > 1 &&
    peers.every((peer) => peer.files.length) &&
    peers.every((peer, index) =>
      peers.every((other, otherIndex) => index === otherIndex || !peer.files.some((file) => other.files.some((item) => sameFile(file, item))))
    );
  const collaborating = splitOwners.length > 1 || disjoint;
  // A collision-resolution job is the one assigned to clean this up, so it
  // still runs (with adopt advice) instead of parking itself forever.
  const resolving = str(job.source) === "collision";
  const action = liveEditors.length && !resolving ? "defer" : peers.length || featurePeers.length ? "adopt" : "proceed";
  const labels = files.slice(0, 3).map((file) => basename(file) || file);
  const extra = files.length > 3 ? ` +${files.length - 3} more` : "";
  const fileBit = labels.length ? ` on ${labels.join(", ")}${extra}` : "";
  const perFile = ownership.map((row) => `${basename(row.file) || row.file} -> ${row.owner}`).join("; ");
  const feature = featurePeers[0];
  const ownerBit = collaborating
    ? `${peers.map((entry) => entry.sessionId).slice(0, 3).join(" and ")} are collaborating on this feature${fileBit}${perFile ? ` — per file: ${perFile}` : ""}`
    : feature && (!owner || owner === feature.sessionId)
      ? `${feature.sessionId}${feature.title ? ` "${feature.title}"` : ""} already looks like it implemented this${fileBit}`
      : owner
        ? `${owner} already implemented this${fileBit}`
        : `Peer sessions ${peers.map((entry) => entry.sessionId).slice(0, 3).join(", ")} already edited${fileBit}`;
  const adoptBit = collaborating
    ? " Keep the files you own and adopt missing pieces on the rest; do not clobber."
    : " — adopt that work and integrate missing pieces; do not clobber.";
  const liveIds = liveEditors.map((entry) => entry.sessionId).slice(0, 3);
  const liveBit = liveIds.length
    ? ` ${liveIds.join(", ")} ${liveIds.length === 1 ? "is" : "are"} actively editing${fileBit} right now — do not merge or overwrite until they stop; integrate their live edits instead.`
    : "";
  const ownerRow = peers.find((peer) => peer.sessionId === owner);
  const handoff = groups.some((group) => group.handoff === true) || Boolean(owner && ownerRow && ownerRow.active !== true);
  const handoffBit = handoff && owner
    ? ` Owner ${owner} is marked inactive; confirm handoff before further edits.`
    : "";
  const advice = `${ownerBit}${adoptBit}${liveBit}${handoffBit}${headBit}`.trim();
  return { action, owner: owner || null, peers, liveEditors, files, ownership, collaborating, advice, featurePeers, handoff };
}

// Spawn-loop file claim: the same live-editor check as collaborate(), plus
// in-memory claims from sibling executor jobs. A hit is `defer` so the
// dispatcher skips this pick and tries the next — it must not park the pool,
// and it must not write a lease file (that hung dispatch on OneDrive).
export function claimWork({ work = null, collisions = [], presence = [], sessions = [], todos = [], uncommitted = [], jobs = [] } = {}) {
  const collab = collaborate({ work, collisions, presence, sessions, todos, uncommitted });
  const named = uniqueStrings([...explicitFiles(isObject(work) ? work : {}), ...collab.files]);
  const held = claimedFiles(jobs);
  const blockers = named.length && held.length ? held.filter((file) => named.some((item) => sameFile(file, item))) : [];
  if (blockers.length) {
    const labels = blockers.slice(0, 3).map((file) => basename(file) || file);
    const extra = blockers.length > 3 ? ` +${blockers.length - 3} more` : "";
    return {
      ...collab,
      action: "defer",
      reason: "claimed",
      files: named,
      held: blockers,
      advice: `Another in-flight job already claimed ${labels.join(", ")}${extra} — wait for that claim to drop instead of editing the same file.`,
    };
  }
  return { ...collab, reason: collab.action, files: named, held: [] };
}

// How much history an entry carries — the survivor of a duplicate collapse, so
// the copy that has been worked on wins over a fresh empty clone.
const compactWeight = (item) => asArray(item?.logs).length * 2 + asArray(item?.refs).length + asArray(item?.ideas).length;
// "Live" = not finished. awaiting_verification counts: the run came back but
// nothing has proven the obligations are satisfied yet, so the card is still
// open work the board must not duplicate or drop.
const isLiveTask = (task) => task?.status === "open" || task?.status === "active" || task?.status === "awaiting_verification";
const isFinishedTask = (task) => task?.status === "done" || task?.status === "archived";

// Dependencies name stable task IDs. A title/theme match cannot authorize
// deleting either an edge's source or its target; grouping would also change
// the prerequisites of the runnable work unless those edges were rewritten.
function dependencyProtectedIds(tasks) {
  const protectedIds = new Set();
  for (const task of asArray(tasks)) {
    const dependencies = asArray(task?.dependsOn).map(str).filter(Boolean);
    if (dependencies.length && task?.id) protectedIds.add(str(task.id));
    for (const id of dependencies) protectedIds.add(id);
  }
  return protectedIds;
}

// Idea-fold plans are titled "Plan: <theme> — N ideas"; the AI review folds
// open tasks the same way, as "Plan: <theme> — N tasks". The count is how many
// notes were scooped that pass, not a different job, so "Plan: catalog — 6 ideas"
// and "Plan: catalog — 4 ideas" collapse to one theme — and an idea plan and a
// task plan on the same theme are one job too.
export function planThemeKey(title) {
  const match = str(title).match(/^plan:\s*(.+?)\s+[—–-]\s+\d+\s+(?:ideas?|tasks?)$/i);
  return match ? compactKey(match[1]) : null;
}

// Ownership fence for settlement. A run may settle a record only when the
// board still names its run id as the owner — a stale completion (the claim
// was re-queued, repaired, or taken over while the run was out) must not
// close or fail someone else's attempt. A record with no owner at all is
// nobody's to settle either, except an inbox row, which has no owner until
// claimed: the caller passes `requireOwner` false for the "ok" path there,
// where removing an unclaimed duplicate of finished work is idempotent.
export function ownershipFence(record, runId, { requireOwner = true } = {}) {
  if (!record || !runId) return false;
  if (record.runId === runId) return true;
  if (!record.runId && !requireOwner) return true;
  return false;
}

// Briefing-filed Fix: tickets word the same subsystem differently
// ("Duplicate root-cause sessions" vs "Stalled duplicate-session triage").
// CompactKey cannot see that they are one job; this family key can.
function isFixTicket(item) {
  if (str(item?.source) === "fix" || str(item?.alertTitle)) return true;
  return /^fix\s*:/i.test(str(item?.title));
}

// The family alone is too broad to authorize a delete: every "duplicate"
// ticket on the board would collapse into one job even when they aim at
// different files. The named targets scope the family — two tickets share a
// theme only when they are the same kind of problem about the same files (or
// when neither names any).
export function fixThemeKey(item) {
  const hay = compactKey(`${item?.alertTitle ?? ""} ${item?.title ?? ""} ${item?.prompt ?? ""}`);
  if (!hay) return null;
  let family = null;
  if (/\b(duplicat\w*|overlap\w*|collid\w*|collision\w*|redundant|root cause|same subsystem)\b/.test(hay)) family = "fix:dup";
  else if (/\b(stale|stalled|in progress)\b/.test(hay)) family = "fix:stale";
  if (!family) return null;
  const files = uniqueStrings([...asArray(item?.problemFiles), str(item?.file)].map(str).filter(Boolean).map(sameFileLabel)).sort();
  return files.length ? `${family}:${files.slice(0, 4).join("+")}` : family;
}

// Basename of a path, normalized the way sameFile compares them, so theme
// keys agree across forward/backward slashes and relative/absolute paths.
function sameFileLabel(file) {
  const norm = String(file ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const index = norm.lastIndexOf("/");
  return index >= 0 ? norm.slice(index + 1) : norm;
}

function pickRicherTask(task, previous) {
  if (!previous) return task;
  const held = Boolean(task.runId);
  const previousHeld = Boolean(previous.runId);
  if (held !== previousHeld) return held ? task : previous;
  if (compactWeight(task) !== compactWeight(previous)) return compactWeight(task) > compactWeight(previous) ? task : previous;
  if (asArray(task.ideas).length !== asArray(previous.ideas).length) {
    return asArray(task.ideas).length > asArray(previous.ideas).length ? task : previous;
  }
  const stamp = (item) => num(item.updatedAt, num(item.doneAt, num(item.createdAt, 0)));
  return stamp(task) >= stamp(previous) ? task : previous;
}

// Rebuild a folded plan's prompt from the idea records it now carries, so a
// merged (or relinked) plan's prompt names every surviving obligation — not
// just the lines the winning copy happened to be folded with. Returns null
// when the records cannot improve on the stored prompt (no idea rows for the
// added members).
function rebuildPlanPrompt(task, ideasById) {
  const lines = [];
  for (const id of asArray(task.ideas).map(str)) {
    const idea = ideasById.get(id);
    if (!idea) continue;
    lines.push(`${lines.length + 1}. ${str(idea.title)}${idea.detail ? ` — ${str(idea.detail)}` : ""}`);
  }
  if (lines.length < 2) return null;
  const theme = planThemeKey(task.title) ?? "collected";
  return `Work through these ${theme} ideas the assistant collected. Do the ones that still make sense and say why you skipped any.\n${lines.join("\n")}`;
}

// Same rebuild for an AI-grouped task plan: the obligation set comes from the
// plan's `members` snapshots (complete prompts), so a merged membership list
// still shows the builder everything the group accepted — not a stale
// summary that predates the merge.
function rebuildTaskGroupPrompt(task) {
  const members = asArray(task.members).filter((member) => isObject(member) && str(member.id));
  if (members.length < 2) return null;
  const theme = planThemeKey(task.title) ?? "collected";
  const lines = members.map((member, index) => `${index + 1}. ${clip(str(member.title), 80)}${member.prompt ? ` — ${clip(str(member.prompt), 400)}` : ""}`);
  return `Work through these ${theme} tasks the AI review grouped. Do the ones that still make sense and say why you skipped any.\n${lines.join("\n")}`;
}

// Rewire idea → task links after a merge/drop. keepPlanned keeps the idea
// claimed by its (surviving) plan; otherwise the idea goes back to visible
// "new" with the dead plan id kept as provenance (reopenOf) so nothing it
// said is lost — expiration retires the card, never the accepted work. Each
// return-to-visible counts as one fold attempt; after two, the note stays a
// plain readable idea instead of being re-folded forever.
function applyRelink(ideas, relink, { keepPlanned = false, at = Date.now() } = {}) {
  if (!relink.size) return ideas;
  return ideas.map((idea) => {
    const nextTask = relink.get(str(idea.id));
    if (!nextTask) return idea;
    if (keepPlanned) return { ...idea, taskId: nextTask, read: true };
    const { taskId, ...rest } = idea;
    return {
      ...rest,
      status: "new",
      read: false,
      reopenOf: taskId ?? nextTask,
      reopenedAt: at,
      foldAttempts: num(idea.foldAttempts, 0) + 1,
    };
  });
}

// Fold loose ideas into plans. An idea is a candidate while it is still `new`
// and carries no task; the theme is the tag the most candidates share, and the
// plan is one task that names every idea under it. Returns the new plan tasks
// and the ideas restamped — nothing is deleted, an idea just stops being loose.
// An idea whose plan already expired gets two fold attempts (foldAttempts,
// stamped by the expiry relink) before it stays a plain readable note —
// otherwise expiring a plan and re-folding the same notes would mint the same
// card forever.
//
// IDs come from the injected allocator: planIdeas and planTaskGroups run in
// the SAME compact() pass with the same `now`, and each owning a private
// `task_plan_<time>_<n>` counter minted identical ids for different jobs —
// the id claims, lookups and idea links conflate. One allocator spans the
// whole mutation (see compact).
function planIdeas(ideas, tasks, now, rules, excludeIds = new Set(), allocateId = null) {
  // Chat-source notes are session dumps, not a theme to plan.
  const candidates = ideas.filter((idea) => {
    if (idea.status !== "new" || idea.taskId || !str(idea.title)) return false;
    if (idea.source === "chat") return false;
    if (excludeIds.has(str(idea.id))) return false;
    if (num(idea.foldAttempts, 0) >= 2) return false;
    return true;
  });
  if (candidates.length < rules.planMinIdeas) return { plans: [], ideas, promoted: 0 };
  // Titles already on the board, so a plan is never created twice. Theme keys
  // count too: "Plan: catalog — 6 ideas" already covers catalog, so a later
  // pass must not mint "Plan: catalog — 4 ideas" beside it.
  const taken = new Set();
  for (const task of tasks.filter(isLiveTask)) {
    const key = compactKey(task.title);
    if (key) taken.add(key);
    const theme = planThemeKey(task.title);
    if (theme) taken.add(theme);
  }

  const byTag = new Map();
  for (const idea of candidates) {
    for (const tag of uniqueStrings(idea.tags).slice(0, 6)) {
      const key = compactKey(tag);
      if (!key) continue;
      if (!byTag.has(key)) byTag.set(key, { tag, ideas: [] });
      byTag.get(key).ideas.push(idea);
    }
  }
  // Oldest themes and members first: a stream of new suggestions must not
  // keep work that was already waiting at the back of the queue forever.
  const themes = [...byTag.values()]
    .filter((group) => group.ideas.length >= rules.planMinIdeas)
    .sort((a, b) => Math.min(...a.ideas.map((idea) => num(idea.at, 0))) - Math.min(...b.ideas.map((idea) => num(idea.at, 0))) || b.ideas.length - a.ideas.length);

  const plans = [];
  const stamped = new Map(); // idea id -> plan id, so one idea joins one plan only
  for (const theme of themes) {
    if (plans.length >= rules.maxPlansPerPass) break;
    const members = theme.ideas.filter((idea) => !stamped.has(idea.id)).sort((a, b) => num(a.at, 0) - num(b.at, 0)).slice(0, rules.planIdeaCap);
    if (members.length < rules.planMinIdeas) continue;
    const title = `Plan: ${theme.tag} — ${plural(members.length, "idea")}`;
    if (taken.has(compactKey(title)) || taken.has(compactKey(theme.tag))) continue;
    const id = allocateId ? allocateId() : `task_plan_${now.toString(36)}_${plans.length}`;
    const lines = members.map((idea, index) => `${index + 1}. ${str(idea.title)}${idea.detail ? ` — ${str(idea.detail)}` : ""}`);
    plans.push({
      id,
      title,
      prompt: `Work through these ${theme.tag} ideas the assistant collected. Do the ones that still make sense and say why you skipped any.\n${lines.join("\n")}`,
      status: "open",
      color: "#e6c98d",
      source: "a-eyes",
      createdAt: now,
      updatedAt: now,
      logs: [{ at: now, kind: "status", text: `plan folded from ${plural(members.length, "idea")} tagged "${theme.tag}"` }],
      ideas: members.map((idea) => idea.id),
      refs: [],
    });
    for (const idea of members) stamped.set(idea.id, id);
    taken.add(compactKey(title));
    taken.add(compactKey(theme.tag));
  }
  if (!plans.length) return { plans: [], ideas, promoted: 0 };
  return {
    plans,
    promoted: stamped.size,
    ideas: ideas.map((idea) => (stamped.has(idea.id) ? { ...idea, status: "planned", taskId: stamped.get(idea.id), read: true } : idea)),
  };
}

// The AI review's task groups: open tasks the exact-title keys cannot see are
// one job ("Session collision queue" vs "Collaboration collision queue") fold
// into one plan the same way loose ideas do.
//
// Grouping must never erase accepted work, so the source obligations survive
// two ways:
//   • each member row STAYS on the board as a durable `absorbed` record —
//     full prompt, refs, priority, provenance — pointing at its plan via
//     absorbedInto (the executor never picks it: only "open" runs);
//   • the plan carries `members`, a complete snapshot of every obligation
//     (full prompts, not the clipped prompt lines), so expiring or losing the
//     grouping restores the original tasks instead of leaving nothing.
// Member ideas are rewired to the plan while it lives. Only open, unclaimed,
// non-plan tasks resolve; a name the board does not carry is ignored (the
// model paraphrases), a group that resolves to a single task is not a group,
// and a theme that already has a plan is never re-minted. IDs come from the
// shared allocator (see compact).
function obligationSnapshot(task) {
  return {
    id: str(task.id),
    title: str(task.title),
    prompt: str(task.prompt),
    refs: asArray(task.refs),
    ideas: uniqueStrings(asArray(task.ideas).map(str)),
    ...(asArray(task.dependsOn).length ? { dependsOn: asArray(task.dependsOn).map(str) } : {}),
    ...(task.contextHistory ? { contextHistory: task.contextHistory } : {}),
    ...(task.color ? { color: str(task.color) } : {}),
    ...(task.source ? { source: str(task.source) } : {}),
    ...(task.file ? { file: str(task.file) } : {}),
    ...(asArray(task.files).length ? { files: asArray(task.files).map(str) } : {}),
    ...(task.priority != null ? { priority: task.priority } : {}),
    ...(task.depth != null ? { depth: task.depth } : {}),
    ...(task.parent ? { parent: str(task.parent) } : {}),
    ...(task.owner ? { owner: str(task.owner) } : {}),
    ...(asArray(task.sessions).length ? { sessions: asArray(task.sessions).map(str) } : {}),
    ...(task.problemFamily ? { problemFamily: str(task.problemFamily) } : {}),
    ...(asArray(task.problemFiles).length ? { problemFiles: asArray(task.problemFiles).map(str) } : {}),
    createdAt: num(task.createdAt, 0),
    updatedAt: num(task.updatedAt, 0),
  };
}

function planTaskGroups(tasks, ideas, groups, now, rules, allocateId = null) {
  const foldable = new Map();
  const protectedIds = dependencyProtectedIds(tasks);
  for (const task of asArray(tasks)) {
    if (!task || task.status !== "open" || task.runId || str(task.id).startsWith("task_plan_") || protectedIds.has(str(task.id))) continue;
    const key = compactKey(task.title);
    if (key) foldable.set(key, task);
  }
  const taken = new Set();
  for (const task of asArray(tasks)) {
    if (!isLiveTask(task)) continue;
    const key = compactKey(task.title);
    if (key) taken.add(key);
    const theme = planThemeKey(task.title);
    if (theme) taken.add(theme);
  }

  const plans = [];
  const absorb = new Map(); // member task -> plan id
  const folded = new Set(); // task ids absorbed this pass
  const relink = new Map(); // idea id -> surviving plan id
  for (const group of asArray(groups).filter(isObject)) {
    if (plans.length >= rules.maxPlansPerPass) break;
    const theme = compactKey(group.title);
    if (!theme || taken.has(theme)) continue;
    const members = [];
    for (const name of asArray(group.tasks).map(str)) {
      const task = foldable.get(compactKey(name));
      if (!task || folded.has(str(task.id))) continue;
      members.push(task);
      if (members.length >= rules.planTaskCap) break;
    }
    if (members.length < 2) continue;
    const id = allocateId ? allocateId() : `task_plan_${now.toString(36)}_${plans.length}`;
    // The plan's prompt carries each obligation in full (clipped for the
    // builder's budget only); the complete bodies ride in members and on the
    // absorbed rows. The old 120-char clip discarded acceptance criteria and
    // file scopes with no recoverable record behind them.
    const lines = members.map((task, index) => `${index + 1}. ${clip(str(task.title), 80)}${task.prompt ? ` — ${clip(str(task.prompt), 400)}` : ""}`);
    plans.push({
      id,
      title: `Plan: ${theme} — ${plural(members.length, "task")}`,
      prompt: `Work through these ${theme} tasks the AI review grouped. Do the ones that still make sense and say why you skipped any.\n${lines.join("\n")}`,
      status: "open",
      color: "#e6c98d",
      source: "a-eyes",
      createdAt: now,
      updatedAt: now,
      logs: [{ at: now, kind: "status", text: `plan folded from ${plural(members.length, "task")} the AI review grouped` }],
      ideas: uniqueStrings(members.flatMap((task) => asArray(task.ideas).map(str))),
      members: members.map(obligationSnapshot),
      mergedFrom: members.map((task) => str(task.id)),
      refs: [],
    });
    for (const task of members) {
      folded.add(str(task.id));
      absorb.set(task, id);
      for (const ideaId of asArray(task.ideas).map(str)) relink.set(ideaId, id);
    }
    taken.add(theme);
    taken.add(compactKey(plans[plans.length - 1].title));
  }
  if (!plans.length) return { plans: [], tasks, ideas, absorbed: 0 };
  // Members stay on the board as absorbed records of the plan that holds
  // their work — visible, prunable-by-rule, and restorable.
  const absorbedTasks = asArray(tasks).map((task) => {
    const planId = absorb.get(task);
    if (!planId) return task;
    return {
      ...task,
      status: "absorbed",
      absorbedInto: planId,
      updatedAt: now,
      logs: [...asArray(task.logs), { at: now, kind: "status", text: `absorbed into ${planId} — the grouping holds this work until it runs or dissolves` }].slice(-40),
    };
  });
  return {
    plans,
    tasks: absorbedTasks,
    absorbed: absorb.size,
    ideas: applyRelink(ideas, relink, { keepPlanned: true, at: now }),
  };
}

export function compact({ requests = [], tasks = [], ideas = [], collisions = null, now = Date.now(), limits = {}, taskGroups = null, allocateId = null, promoteIdeas = true } = {}) {
  const rules = { ...COMPACT_LIMITS, ...(isObject(limits) ? limits : {}) };
  const inRequests = asArray(requests).filter(isObject);
  const inTasks = asArray(tasks).filter(isObject);
  const inIdeas = asArray(ideas).filter(isObject);
  const protectedIds = dependencyProtectedIds(inTasks);
  const report = { duplicateRequests: 0, duplicateTasks: 0, duplicateIdeas: 0, absorbed: 0, revived: 0, unblocked: 0, stale: 0, resolved: 0, trimmed: 0, planned: 0, plans: [], taskPlanned: 0, taskPlans: [], choresDropped: 0, plansDropped: 0, relinked: 0, runnable: 0, reviewed: null };
  const ideasById = new Map(inIdeas.filter((idea) => str(idea.id)).map((idea) => [idea.id, idea]));
  // The ideas store evolves alongside the tasks in this pass (dedupe, plan
  // stamps, relinks), so it is declared up here where merges need it.
  let outIdeas = inIdeas;
  // Ideas relinked THIS pass (plan expired, dangling link repaired) must not
  // re-fold in the same breath — dropping a plan and immediately re-minting it
  // from the same notes is the churn the fold cap exists to stop. They become
  // fold candidates again on a later pass, within the fold-attempt cap.
  const reopenedThisPass = new Set();

  // 1. Tasks first: collapse duplicate live titles, richest copy wins — and a
  //    task the executor is holding (runId set) is never a casualty. Two held
  //    copies of one title are two live attempts: keep both and let the claim
  //    system sort them out rather than "dedupe" a running job out of
  //    existence. The executor's live-title guard makes the pair transient.
  const liveByKey = new Map();
  const bothClaimed = new Set();
  for (const task of inTasks) {
    if (!isLiveTask(task) || !compactKey(task.title)) continue;
    const key = compactKey(task.title);
    const existing = liveByKey.get(key);
    if (existing && existing.runId && task.runId) {
      bothClaimed.add(key);
      continue;
    }
    liveByKey.set(key, pickRicherTask(task, existing));
  }
  const survivors = new Set(liveByKey.values());
  let outTasks = inTasks.filter((task) => {
    if (protectedIds.has(str(task.id))) return true;
    if (!isLiveTask(task) || !compactKey(task.title) || survivors.has(task)) return true;
    return bothClaimed.has(compactKey(task.title));
  });
  report.duplicateTasks = inTasks.length - outTasks.length;

  // Duplicate completion stamps collapse, but separate completed attempts are
  // history: repeating a task's title must not erase an earlier result.
  {
    const finishedKey = (task) => {
      const title = compactKey(task.title);
      if (task.lastAttempt?.runId) return `${title}|attempt:${task.lastAttempt.runId}`;
      if (task.id) return `${title}|record:${task.id}`;
      return title;
    };
    const finishedByKey = new Map();
    for (const task of outTasks) {
      if (!isFinishedTask(task) || !compactKey(task.title)) continue;
      const key = finishedKey(task);
      finishedByKey.set(key, pickRicherTask(task, finishedByKey.get(key)));
    }
    const keepFinished = new Set(finishedByKey.values());
    const before = outTasks.length;
    outTasks = outTasks.filter((task) => protectedIds.has(str(task.id)) || !isFinishedTask(task) || !compactKey(task.title) || keepFinished.has(task));
    report.duplicateTasks += before - outTasks.length;
  }

  // Idea-fold plans for the same theme ("Plan: catalog — 6 ideas" vs
  // "Plan: catalog — 4 ideas") are one job. Keep the richest live copy, carry
  // the dropped plan's idea ids, REWRITE each merged idea's taskId to the
  // survivor, and rebuild the survivor's prompt from the surviving obligation
  // set — a merged membership list means nothing if the builder never sees
  // the merged obligations, and a stale taskId means an idea stranded on a
  // plan that no longer exists. A claimed plan is never a casualty. Task-group
  // plans merge the same way: their `members` obligation snapshots and their
  // absorbed rows (which point at the plan via absorbedInto) follow the
  // survivor, so absorption never orphans a source obligation.
  {
    const groups = new Map();
    for (const task of outTasks) {
      if (!isLiveTask(task) || task.runId || protectedIds.has(str(task.id))) continue;
      const theme = planThemeKey(task.title);
      if (!theme) continue;
      const members = groups.get(theme);
      if (members) members.push(task);
      else groups.set(theme, [task]);
    }
    const drop = new Set();
    const replace = new Map();
    const relink = new Map(); // idea id -> surviving plan id
    const planRemap = new Map(); // dropped plan id -> surviving plan id
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      let winner = members[0];
      for (const task of members.slice(1)) winner = pickRicherTask(task, winner);
      let mergedIds = [...asArray(winner.ideas)];
      let mergedFrom = [...asArray(winner.mergedFrom).map(str)];
      let mergedMembers = asArray(winner.members).filter((member) => isObject(member) && str(member.id));
      for (const task of members) {
        if (task === winner) continue;
        drop.add(task);
        mergedFrom.push(str(task.id));
        planRemap.set(str(task.id), str(winner.id));
        for (const id of asArray(task.ideas).map(str)) {
          if (!mergedIds.includes(id)) mergedIds.push(id);
          relink.set(id, winner.id);
        }
        for (const member of asArray(task.members).filter((row) => isObject(row) && str(row.id))) {
          if (!mergedMembers.some((row) => str(row.id) === str(member.id))) mergedMembers.push(member);
        }
      }
      if (drop.has(winner)) continue; // unreachable; kept for symmetry
      const merged = { ...winner, ideas: mergedIds };
      if (mergedMembers.length >= 2) merged.members = mergedMembers;
      if (mergedFrom.length > asArray(winner.mergedFrom).length) {
        merged.mergedFrom = uniqueStrings(mergedFrom);
        merged.logs = [...asArray(winner.logs), { at: now, kind: "status", text: `absorbed ${plural(members.length - 1, "duplicate plan")} of the same theme` }].slice(-40);
        merged.updatedAt = now;
      }
      const rebuilt = rebuildPlanPrompt(merged, ideasById) ?? (mergedMembers.length >= 2 ? rebuildTaskGroupPrompt(merged) : null);
      if (rebuilt) merged.prompt = rebuilt;
      replace.set(winner, merged);
      report.duplicateTasks += members.length - 1;
    }
    if (drop.size) {
      outTasks = outTasks
        .filter((task) => !drop.has(task))
        .map((task) => {
          const replaced = replace.get(task) ?? task;
          const target = replaced?.absorbedInto != null ? planRemap.get(str(replaced.absorbedInto)) : null;
          return target ? { ...replaced, absorbedInto: target } : replaced;
        });
      if (relink.size) {
        outIdeas = applyRelink(inIdeas, relink, { keepPlanned: true });
        report.relinked += relink.size;
      }
    }
  }

  // Fix: tickets for the same problem family ("duplicate sessions" vs
  // "subsystem overlap") are one job even when the titles differ. A claimed
  // run holds the family so a second stream cannot start beside it.
  {
    const claimedThemes = new Set();
    for (const task of outTasks) {
      if (!isLiveTask(task) || !task.runId || !isFixTicket(task)) continue;
      const theme = fixThemeKey(task);
      if (theme) claimedThemes.add(theme);
    }
    const groups = new Map();
    const drop = new Set();
    for (const task of outTasks) {
      if (!isLiveTask(task) || task.runId || !isFixTicket(task) || protectedIds.has(str(task.id))) continue;
      const theme = fixThemeKey(task);
      if (!theme) continue;
      if (claimedThemes.has(theme)) {
        drop.add(task);
        continue;
      }
      const members = groups.get(theme);
      if (members) members.push(task);
      else groups.set(theme, [task]);
    }
    report.duplicateTasks += drop.size;
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      let winner = members[0];
      for (const task of members.slice(1)) winner = pickRicherTask(task, winner);
      for (const task of members) {
        if (task !== winner) drop.add(task);
      }
      report.duplicateTasks += members.length - 1;
    }
    if (drop.size) outTasks = outTasks.filter((task) => !drop.has(task));
  }

  // 2. Unpark transient backoffs. Exhausted or failed verification attempts
  //    need an explicit retry; a clock must not restart a paid failure loop.
  outTasks = outTasks.map((task) => {
    if (task.status !== "open") return task;
    if (exhaustedAttempts(task, rules.maxFailures)) return task;
    if (task.nextRunAt && task.nextRunAt <= now) {
      report.unblocked += 1;
      const { nextRunAt, ...rest } = task;
      return rest;
    }
    return task;
  });

  // 3. Keep queued upkeep tasks. Scheduling limits control how many run;
  //    deleting overflow hid unfinished obligations with no way to recover.

  // 3b. Explicitly requested expiry of old, unclaimed groups DISSOLVES them,
  //     never erases it: idea plans relink their ideas back to visible "new"
  //     (with the dead plan id kept as reopenOf, foldAttempts capping the
  //     re-fold); task-group plans restore their members — the absorbed rows
  //     flip back to open, and any member whose absorbed row is gone is
  //     rebuilt from the plan's obligation snapshot. The old behavior deleted
  //     an expired grouping and relinked only its ideas, so plain tasks with
  //     no ideas vanished from the board entirely. A claimed plan is
  //     untouchable.
  const expiredPlanThemes = new Set();
  {
    const cutoff = now - rules.stalePlanHours * HOUR;
    const expired = [];
    const before = outTasks.length;
    outTasks = outTasks.filter((task) => {
      if (!isLiveTask(task) || task.runId || !planThemeKey(task.title) || protectedIds.has(str(task.id))) return true;
      const stamp = num(task.createdAt, num(task.updatedAt, 0));
      if (!stamp || stamp >= cutoff) return true;
      expired.push(task);
      return false;
    });
    report.plansDropped = before - outTasks.length;
    if (expired.length) {
      const restoreRelink = new Map(); // idea id -> restored member task id (stays planned)
      const reopenRelink = new Map(); // idea id -> dead plan id (back to visible new)
      for (const plan of expired) {
        const planId = str(plan.id);
        expiredPlanThemes.add(planThemeKey(plan.title));
        const members = asArray(plan.members).filter((member) => isObject(member) && str(member.id));
        const memberIds = new Set(members.map((member) => str(member.id)));
        const restoredFromRows = new Set();
        // Absorbed rows of this plan go back to open work...
        outTasks = outTasks.map((task) => {
          if (!task || task.status !== "absorbed" || str(task.absorbedInto) !== planId) return task;
          restoredFromRows.add(str(task.id));
          const { absorbedInto, runId, lastAttempt, verification, nextRunAt, ...rest } = task;
          return {
            ...rest,
            status: "open",
            updatedAt: now,
            logs: [...asArray(task.logs), { at: now, kind: "status", text: `plan ${planId} expired — grouping dissolved, task restored` }].slice(-40),
          };
        });
        // ...and members whose absorbed row is gone are rebuilt from the
        // plan's own obligation snapshot.
        const missing = members.filter((member) => !restoredFromRows.has(str(member.id)));
        if (missing.length) {
          outTasks = [
            ...missing.map((member) => ({
              ...member,
              status: "open",
              color: member.color ?? "#e6c98d",
              source: member.source ?? "a-eyes",
              createdAt: num(member.createdAt, now),
              updatedAt: now,
              logs: [{ at: now, kind: "status", text: `plan ${planId} expired — restored from the grouping's obligation snapshot` }],
            })),
            ...outTasks,
          ];
        }
        // Ideas follow their obligation: a member's ideas stay planned against
        // the restored task; ideas the grouping held directly go back to new.
        const ideasByMember = new Map();
        for (const member of members) {
          for (const ideaId of asArray(member.ideas).map(str)) ideasByMember.set(ideaId, str(member.id));
        }
        for (const idea of outIdeas) {
          if (str(idea?.taskId) !== planId) continue;
          const memberId = ideasByMember.get(str(idea.id));
          if (memberId) restoreRelink.set(str(idea.id), memberId);
          else reopenRelink.set(str(idea.id), planId);
        }
      }
      if (restoreRelink.size) {
        outIdeas = applyRelink(outIdeas, restoreRelink, { keepPlanned: true, at: now });
        report.relinked += restoreRelink.size;
      }
      if (reopenRelink.size) {
        outIdeas = applyRelink(outIdeas, reopenRelink, { at: now });
        for (const id of reopenRelink.keys()) reopenedThisPass.add(id);
        report.relinked += reopenRelink.size;
      }
    }
  }

  // 3c. Dangling links from older passes (a manual cleanup, a crash between
  //     writes): any idea pointing at a task id that is not on the board goes
  //     back to visible "new". This is the repair that reconciles a backlog
  //     left inconsistent by earlier versions — it runs every pass, so a
  //     stranded idea can never hide again.
  {
    const taskIds = new Set(outTasks.map((task) => str(task?.id)).filter(Boolean));
    const relink = new Map();
    for (const idea of outIdeas) {
      const linked = str(idea?.taskId);
      if (linked && !taskIds.has(linked)) relink.set(str(idea.id), linked);
    }
    if (relink.size) {
      outIdeas = applyRelink(outIdeas, relink, { at: now });
      for (const id of relink.keys()) reopenedThisPass.add(id);
      report.relinked += relink.size;
    }
  }

  // 4. Ideas: collapse the duplicates, then fold what is left into plans. A tag
  //    several new ideas share is a theme, and a theme is one task worth doing
  //    rather than a dozen notes that stay unread. Promoted ideas are stamped
  //    with their plan so the next pass leaves them alone.
  const ideaSeen = new Set();
  const dedupedIdeas = [];
  for (const idea of outIdeas) {
    const key = `${compactKey(idea.title)}|${compactKey(idea.detail)}`;
    if (key && ideaSeen.has(key) && idea.status === "new" && !idea.taskId) {
      report.duplicateIdeas += 1;
      continue;
    }
    if (key) ideaSeen.add(key);
    dedupedIdeas.push(idea);
  }
  outIdeas = dedupedIdeas;

  // Idea-fold plans first (their titles land in report.plans; 4b appends the
  // AI review's task plans there too), then the task groups. ONE id allocator
  // spans both generators: they run in the same pass with the same `now`, and
  // two private `task_plan_<time>_<n>` counters minted the same id for two
  // different jobs, conflating claims, lookups and idea links.
  let ideaPlanCount = 0;
  const planIdTaken = new Set(outTasks.map((task) => str(task?.id)).filter(Boolean));
  let planSeq = 0;
  const nextPlanId =
    typeof allocateId === "function"
      ? allocateId
      : () => {
          let id;
          do {
            id = `task_plan_${now.toString(36)}_${planSeq++}`;
          } while (planIdTaken.has(id));
          planIdTaken.add(id);
          return id;
        };
  const planned = promoteIdeas ? planIdeas(outIdeas, outTasks, now, rules, reopenedThisPass, nextPlanId) : { plans: [], ideas: outIdeas, promoted: 0 };
  if (planned.plans.length) {
    outTasks = [...planned.plans, ...outTasks];
    outIdeas = planned.ideas;
    report.planned = planned.promoted;
    report.plans = planned.plans.map((task) => task.title);
    ideaPlanCount = planned.plans.length;
  }

  // 4b. The AI review's groups: near-duplicate open tasks that one title key
  //     cannot see fold into a plan, their obligations carried in full (prompt
  //     lines, member snapshots, absorbed rows) and their ideas relinked. Only
  //     the AI pass proposes groups; without them this is a no-op, so the
  //     local cadence never folds on a guess. A theme that expired THIS pass
  //     is not re-minted in the same breath it was dissolved.
  if (Array.isArray(taskGroups) && taskGroups.length) {
    const freshGroups = expiredPlanThemes.size
      ? taskGroups.filter((group) => !expiredPlanThemes.has(compactKey(group?.title)))
      : taskGroups;
    const grouped = planTaskGroups(outTasks, outIdeas, freshGroups, now, rules, nextPlanId);
    if (grouped.plans.length) {
      outTasks = [...grouped.plans, ...grouped.tasks];
      outIdeas = grouped.ideas;
      report.taskPlanned = grouped.absorbed;
      report.taskPlans = grouped.plans.map((task) => task.title);
      report.plans = [...report.plans, ...report.taskPlans];
    }
  }

  // 5. Requests: drop duplicates, then drop anything already on the board —
  //    live or done. Done titles stay taken so a leftover request cannot re-run
  //    work that just succeeded (same rule as spawnNextJob's liveBoard).
  const boardKeys = new Set(
    outTasks.filter((task) => task.status !== "archived").map((task) => compactKey(task.title)).filter(Boolean),
  );
  const boardThemes = new Set();
  for (const task of outTasks) {
    if (task.status === "archived" || !isFixTicket(task)) continue;
    const theme = fixThemeKey(task);
    if (theme) boardThemes.add(theme);
  }
  const seen = new Set();
  const seenThemes = new Set();
  for (const request of inRequests) {
    if ((request.status !== "running" && request.status !== "verifying") || !isFixTicket(request)) continue;
    const theme = fixThemeKey(request);
    if (theme) seenThemes.add(theme);
  }
  let outRequests = [];
  for (const request of inRequests) {
    // A claim in flight — or one mid-verification — is never touched.
    if (request.status === "running" || request.status === "verifying") {
      outRequests.push(request);
      continue;
    }
    const key = compactKey(request.title) || compactKey(request.prompt);
    if (!key) {
      outRequests.push(request);
      continue;
    }
    if (seen.has(key)) {
      report.duplicateRequests += 1;
      continue;
    }
    if (boardKeys.has(key)) {
      report.absorbed += 1;
      continue;
    }
    const theme = isFixTicket(request) ? fixThemeKey(request) : null;
    if (theme && seenThemes.has(theme)) {
      report.duplicateRequests += 1;
      continue;
    }
    if (theme && boardThemes.has(theme)) {
      report.absorbed += 1;
      continue;
    }
    seen.add(key);
    if (theme) seenThemes.add(theme);
    outRequests.push(request);
  }

  // Same two sessions collaborating on one feature often queue one alert
  // per file; those are one ownership conflict. Collapse them to the newest
  // copy and merge the file lists. A running claim holds its pair. A shared
  // session on two different partners stays two requests.
  {
    const runningKeys = new Set();
    for (const request of outRequests) {
      if ((request.status === "running" || request.status === "verifying") && request.source === "collision") {
        const key = sessionSetKey(request);
        if (key) runningKeys.add(key);
      }
    }
    const groups = new Map();
    const drop = new Set();
    for (const request of outRequests) {
      if (request.status === "running" || request.status === "verifying" || request.source !== "collision") continue;
      const key = sessionSetKey(request);
      if (!key) continue;
      if (runningKeys.has(key)) {
        drop.add(request);
        continue;
      }
      const members = groups.get(key);
      if (members) members.push(request);
      else groups.set(key, [request]);
    }
    const replace = new Map();
    report.duplicateRequests += drop.size;
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      let winner = members[0];
      for (const request of members.slice(1)) {
        if (preferCollisionRequest(request, winner)) winner = request;
      }
      let merged = winner;
      for (const request of members) {
        if (request === winner) continue;
        drop.add(request);
        merged = mergeCollisionRequest(merged, request);
      }
      if (merged !== winner) replace.set(winner, merged);
      report.duplicateRequests += members.length - 1;
    }
    if (drop.size) outRequests = outRequests.filter((request) => !drop.has(request)).map((request) => replace.get(request) ?? request);
  }

  // Resolved collision alerts: when the filing pass handed us the live set,
  // an unclaimed collision request whose files and session pair are gone is
  // a snapshot that moved on. A generic overseer "Resolve collision" is the
  // same upkeep twice — drop it whenever we know the collision state; the
  // specific per-file request is the real work while it lasts.
  if (Array.isArray(collisions)) {
    const live = liveCollisionIndex(collisions);
    const before = outRequests.length;
    outRequests = outRequests.filter((request) => {
      if (request.status === "running" || request.status === "verifying") return true;
      if (request.source === "collision" && !collisionRequestLive(request, live)) return false;
      if (request.source === "overseer" && /^overseer:\s*resolve collision/i.test(str(request.title))) return false;
      return true;
    });
    report.resolved = before - outRequests.length;
  }

  // 6. The review. Auto-filed requests expire: the pass that wrote one
  //    re-checks every tick and files it again while the problem is still
  //    there, so an unclaimed one this old is a snapshot that moved on. The
  //    owner's requests never expire here — the keeper's three-day rule is
  //    their only clock — and a claim in flight or mid-verification is never
  //    touched.
  const staleCutoff = now - rules.staleRequestHours * HOUR;
  const fresh = outRequests.filter((request) => {
    if (request.status === "running" || request.status === "verifying") return true;
    if (request.source === "chat" || !AUTO_SOURCES.has(request.source)) return true;
    const at = num(request.at, 0);
    return at >= staleCutoff;
  });
  report.stale = outRequests.length - fresh.length;

  // Bound runnable admissions rather than destroying requests over a cap.
  const capped = fresh;

  // 7. What could start right now, if the executor had a free slot — and the
  //    pick it would take, so the pass reports the review it just did.
  const waiting = capped.filter(
    (request) =>
      request.status !== "running" &&
      request.status !== "verifying" &&
      !(request.nextRunAt && request.nextRunAt > now) &&
      !exhaustedAttempts(request, rules.maxFailures),
  );
  const open = outTasks.filter((task) => task.status === "open" && !task.runId && !(task.nextRunAt && task.nextRunAt > now) && !exhaustedAttempts(task, rules.maxFailures));
  report.runnable = waiting.length + open.length;
  const top = [...waiting, ...open].sort((a, b) => taskPriority(b) - taskPriority(a))[0];
  report.reviewed = { queued: waiting.length, open: open.length, next: top ? clip(str(top.title) || str(top.prompt), 70) || null : null };

  const bits = [];
  if (report.duplicateTasks) bits.push(`${plural(report.duplicateTasks, "duplicate task")}`);
  if (report.duplicateRequests) bits.push(`${plural(report.duplicateRequests, "duplicate request")}`);
  if (report.absorbed) bits.push(`${report.absorbed} already on the board`);
  if (report.stale) bits.push(`${plural(report.stale, "stale request")} expired`);
  if (report.resolved) bits.push(`${plural(report.resolved, "resolved request")} dropped`);
  if (report.revived) bits.push(`${plural(report.revived, "task")} revived`);
  if (report.unblocked) bits.push(`${plural(report.unblocked, "backoff")} elapsed`);
  if (report.trimmed) bits.push(`${report.trimmed} trimmed`);
  if (report.choresDropped) bits.push(`${plural(report.choresDropped, "upkeep chore")} shelved`);
  if (report.plansDropped) bits.push(`${plural(report.plansDropped, "leftover plan")} dropped`);
  if (report.relinked) bits.push(`${plural(report.relinked, "idea")} relinked`);
  if (report.duplicateIdeas) bits.push(`${plural(report.duplicateIdeas, "duplicate idea")}`);
  if (report.planned) bits.push(`${plural(report.planned, "idea")} planned into ${plural(ideaPlanCount, "task")}`);
  if (report.taskPlanned) bits.push(`${plural(report.taskPlanned, "task")} grouped into ${plural(report.taskPlans.length, "plan")}`);
  report.text = bits.length ? `${bits.join(", ")} · ${plural(report.runnable, "job")} runnable` : `nothing to compact · ${plural(report.runnable, "job")} runnable`;

  return {
    requests: capped,
    tasks: outTasks,
    ideas: outIdeas,
    report,
    requestsChanged: capped.length !== inRequests.length,
    tasksChanged:
      report.duplicateTasks > 0 ||
      report.revived > 0 ||
      report.unblocked > 0 ||
      report.plans.length > 0 ||
      report.taskPlanned > 0 ||
      report.choresDropped > 0 ||
      report.plansDropped > 0,
    ideasChanged: report.duplicateIdeas > 0 || report.planned > 0 || report.relinked > 0,
  };
}

// ---- the idea-scan delta -------------------------------------------------------
// The ideas pass used to hold the whole ideas array across its AI call and
// write its stale copy back afterwards — wiping any `planned` stamp or taskId
// the compactor had landed in the meantime, which re-promoted the same work.
// The scan now collects only ADDITIONS outside the lock, then re-reads the
// latest store inside it and applies this validated delta: rows that still do
// not exist are prepended; every existing row passes through untouched, so a
// late scan can never revert promotion, claims, or a human's edits.
//
// Identity is deliberately two-key: the 120-char detail prefix the old scan
// used, plus the compact title key. A paraphrase that changes either one still
// matches on the other, and `sourceKey` (the candidate line the idea came
// from) catches the same note re-scanned verbatim.
export const ideaIdentityKeys = (idea) => {
  const keys = [];
  const detail = String(idea?.detail ?? "").toLowerCase().slice(0, 120);
  if (detail) keys.push(`d:${detail}`);
  const title = compactKey(idea?.title);
  if (title) keys.push(`t:${title}`);
  const sourceKey = str(idea?.sourceKey);
  if (sourceKey) keys.push(`s:${sourceKey}`);
  return keys;
};

export function mergeIdeas(existing, additions, { cap = 400 } = {}) {
  const current = asArray(existing).filter(isObject);
  const seen = new Set();
  for (const idea of current) for (const key of ideaIdentityKeys(idea)) seen.add(key);
  const fresh = [];
  for (const addition of asArray(additions).filter(isObject)) {
    const keys = ideaIdentityKeys(addition);
    if (!keys.length) continue;
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    fresh.push(addition);
  }
  if (!fresh.length) return { ideas: current, added: 0 };
  // `cap` remains accepted for old callers, but ingestion must never evict
  // existing obligations or pretend an accepted addition was saved when it
  // was sliced off. Builder admission, not storage, is bounded.
  return { ideas: [...fresh, ...current], added: fresh.length };
}

export function exhaustedAttempts(item, maxFailures = 5) {
  return num(item?.runFailures, 0) >= maxFailures || num(item?.verifyAttempts, 0) >= VERIFY_MAX_ATTEMPTS || item?.verification?.state === "failed";
}

export function backlogIdeaEligible(idea, { explicit = false } = {}) {
  return isObject(idea) && Boolean(str(idea.id).trim()) && Boolean(str(idea.title).trim()) && !idea.taskId &&
    (idea.status == null || idea.status === "new" || idea.status === "keep" || (explicit && ["accepted", "planned"].includes(idea.status))) &&
    (explicit || idea.source !== "chat" || idea.status === "keep");
}

// Admit a few durable, standalone tasks when the user asks to drain ideas.
// Old notes and twice-expired folds remain actionable. Every body and reference
// is retained, and repeat passes are idempotent through both directions of the
// task/idea link. Call under the board gateway so those links persist together.
export function promoteIdeaBacklog({ tasks = [], ideas = [], now = Date.now(), limit = 3, ideaIds = null } = {}) {
  let outTasks = asArray(tasks).filter(isObject).map((task) => ({ ...task }));
  const current = asArray(ideas).filter(isObject);
  const requested = Array.isArray(ideaIds) ? new Set(ideaIds.map(String)) : null;
  const count = Math.max(0, Math.min(20, Math.floor(Number.isFinite(limit) ? limit : 3)));
  const candidates = current.filter((idea) => backlogIdeaEligible(idea, { explicit: Boolean(requested) }) && (!requested || requested.has(str(idea.id))))
    .sort((a, b) => num(a.at, num(a.createdAt, 0)) - num(b.at, num(b.createdAt, 0)) || str(a.id).localeCompare(str(b.id)));
  const changes = new Map();
  const taskIds = [];
  const usedIds = new Set(outTasks.map((task) => str(task.id)));
  let serial = 0;
  for (const idea of candidates) {
    if (changes.size >= count) break;
    const body = str(idea.detail).trim() || str(idea.title).trim();
    const same = outTasks.find((task) => asArray(task.ideas).includes(idea.id) ||
      (compactKey(task.title) === compactKey(idea.title) && compactKey(task.ideaDetail ?? task.prompt) === compactKey(body)));
    let target = same;
    if (!target) {
      let id;
      do { id = `task_idea_${now.toString(36)}_${serial++}`; } while (usedIds.has(id));
      usedIds.add(id);
      // A similar title alone is not authority to discard a different idea.
      // Distinguish the card so legacy title-based queue guards preserve it.
      const collision = outTasks.some((task) => isLiveTask(task) && compactKey(task.title) === compactKey(idea.title));
      target = {
        id, title: `${str(idea.title).trim()}${collision ? ` (idea ${str(idea.id)})` : ""}`,
        prompt: `Work on this saved idea in the selected project. Check existing work first, implement the applicable requirements, and report checks plus anything still remaining.\n\n${str(idea.title).trim()}\n${body}`,
        ideaDetail: body, status: "open", source: "idea", color: "#e6c98d",
        createdAt: now, updatedAt: now, backlogAt: num(idea.at, num(idea.createdAt, now)),
        ideas: [idea.id], refs: asArray(idea.refs),
        ...(idea.projectId ? { projectId: idea.projectId } : {}),
        ...(idea.projectPath ? { projectPath: idea.projectPath } : {}),
        ...(idea.file ? { file: idea.file } : {}),
        ...(Array.isArray(idea.files) ? { files: [...idea.files] } : {}),
        logs: [{ at: now, kind: "status", text: "Saved idea added to the work queue" }],
      };
      outTasks = [...outTasks, target];
    } else if (!asArray(target.ideas).includes(idea.id)) {
      target = { ...target, ideas: [...asArray(target.ideas), idea.id] };
      outTasks = outTasks.map((task) => task.id === target.id ? target : task);
    }
    changes.set(idea.id, { ...idea, status: isFinishedTask(target) ? "done" : "planned", taskId: target.id, read: true, updatedAt: now });
    taskIds.push(target.id);
  }
  return { tasks: outTasks, ideas: current.map((idea) => changes.get(idea.id) ?? idea), promoted: changes.size, taskIds: uniqueStrings(taskIds), changed: changes.size > 0 };
}

// ---- the executor's result protocol ---------------------------------------------
// The verdict sentinel is matched STRICTLY: the line must start with the mark,
// not merely contain it. A run that quotes the protocol back ("never print
// MEFI_JOB_DONE until…") or mentions it in prose used to flip the whole job to
// done. A short trailing note is allowed ("MEFI_JOB_DONE — catalog rewritten");
// anything before the mark, or a long sentence after it, is not a verdict.
export const EXECUTOR_DONE_MARK_TEXT = "MEFI_JOB_DONE";
export function isDoneMarkerLine(line, mark = EXECUTOR_DONE_MARK_TEXT) {
  const flat = String(line ?? "").trim();
  if (!flat.startsWith(mark)) return false;
  const rest = flat.slice(mark.length);
  return rest.trim().length <= 48;
}

// A run may attach one structured result line naming what it finished and what
// remains, so settlement carries the worker's own account of the obligations
// instead of only an anonymous success marker:
//   MEFI_RESULT: done: tar torch + stick copy; remaining: catalog contract; ran tools/test_sets world
// Parsed leniently — it is evidence attached to the attempt, never the
// verdict itself.
export function parseExecutorResult(line, mark = "MEFI_RESULT:") {
  const flat = String(line ?? "").trim();
  const index = flat.indexOf(mark);
  if (index === -1) return null;
  const body = flat.slice(index + mark.length).trim();
  if (!body || body.length > 300) return null;
  const parts = {};
  for (const chunk of body.split(/;+/)) {
    const [key, ...rest] = chunk.split(/:+/);
    const name = String(key ?? "").trim().toLowerCase();
    const value = rest.join(":").trim();
    if (name && value) parts[name] = value.slice(0, 200);
  }
  return { raw: body.slice(0, 300), parts };
}

// ---- completion verification ------------------------------------------------------
// "The run said done" is a claim, not evidence. Verification is decided by the
// attempt's acceptance contract:
//   • partial work (a nonempty remaining list, or the worker's own
//     MEFI_RESULT "remaining:" text) is never verified;
//   • a session-attributed attempt needs the store to show its edits — a
//     test/audit-only attempt may instead name the checks it ran;
//   • an attempt with NO session cannot borrow the verdict: without edits the
//     worker must at least name the checks it ran, or completion stays
//     unverified;
//   • a reported check FAILURE ("tests: failed") is never evidence.
// Missing evidence stays `unverified` and the attempt is retried on a bounded
// budget (VERIFY_MAX_ATTEMPTS); past the bound the state is `failed` and the
// caller parks the card instead of scheduling the same unproven run forever.
export const VERIFY_MAX_ATTEMPTS = 3;

const checkReports = (parts) => [parts?.tests, parts?.ran, parts?.verified, parts?.audit].map((value) => str(value).trim()).filter(Boolean);
const reportedCheckFailure = (parts) => checkReports(parts).some((text) => /\b(?:fail(?:ed|ures?)?|errors?|broken)\b/i.test(
  text.replace(/\b(?:0|zero|no)\s+(?:fail(?:ed|ures?)?|errors?)\b/gi, ""),
));
const noRemainingWork = (text) => /^(?:none|nothing|nil|n\/a|no (?:remaining|outstanding) (?:work|tasks?|items?|obligations?))[.!\s]*$/i.test(text);
const namesCheck = (text) => !/^(?:none|nothing|n\/a|not (?:run|tested)|skipped|unavailable|pending|passed|ok|done)[.!\s]*$/i.test(text)
  && !/\b(?:not run|not tested|did not run|didn't run|could not run|couldn't run|unable to run|skipped)\b/i.test(text);

export function verifyCompletion({ verdictOk = false, changedFiles = 0, hasSession = false, remaining = [], resultNote = null, priorAttempts = 0 } = {}) {
  const parts = (resultNote && isObject(resultNote) ? resultNote.parts : null) ?? {};
  const namedChecks = checkReports(parts).some(namesCheck);
  const remainingText = str(parts.remaining);
  const outstanding = (remainingText.length > 0 && !noRemainingWork(remainingText)) || asArray(remaining).length > 0;
  const evidence = {
    verdictOk: verdictOk === true,
    changedFiles: Math.max(0, Number(changedFiles) || 0),
    hasSession: hasSession === true,
    namedChecks,
    outstanding,
  };
  const fail = (reason) => {
    const attemptNo = Math.max(0, Number(priorAttempts) || 0) + 1;
    return attemptNo >= VERIFY_MAX_ATTEMPTS ? { state: "failed", reason, evidence, attemptNo } : { state: "unverified", reason, evidence, attemptNo };
  };
  const pass = (reason) => ({ state: "verified", reason, evidence });
  if (reportedCheckFailure(parts)) return fail("the attempt reported failing checks");
  if (!evidence.verdictOk) return fail("the run did not report success");
  if (outstanding) return fail("outstanding obligations remain");
  if (evidence.hasSession) {
    if (evidence.changedFiles > 0) return pass(`${evidence.changedFiles} changed file(s) in the attempt's session`);
    if (evidence.namedChecks) return pass("no edits, but the attempt named the checks it ran");
    return fail("no attributable edits and no named checks");
  }
  if (evidence.namedChecks) return pass("no session, but the attempt named the checks it ran");
  return fail("no session and no named checks");
}

// A run that has registered no OpenCode session and printed nothing is not
// working — it is the startup wedge (N same-second `opencode run` starts
// colliding on the shared store once sat silent for the whole kill budget).
// Speaking OR owning a session both prove liveness; neither within the start
// budget means the executor should kill the run and treat it as infrastructure.
export function isWedgedStart({ spoke = false, sessionId = null, ageMs = 0, budgetMs = 0 } = {}) {
  return !spoke && !sessionId && ageMs >= budgetMs && budgetMs > 0;
}

// ---- the ingestion cursor --------------------------------------------------------
// The ideas pass processes each piece of chat material ONCE. The cursor is the
// (time_created, part id) position of the newest source row a successful pass
// consumed — a keyset tuple, not a bare timestamp. Rows are fetched
// oldest-first after the cursor with an id tiebreak, so duplicate timestamps
// across a page boundary cannot skip or repeat material. Callers persist the
// cursor only when the pass succeeded (the AI extraction completed), so a
// failed pass re-reads its window (the delta merge makes reprocessing
// harmless) and a successful one never rescans old material. A bare numeric
// legacy cursor (timestamp only) is accepted and upgraded.
export function advanceCursor(rows, cursor = { at: 0, id: "" }) {
  const seed = cursor && typeof cursor === "object" ? cursor : { at: Number(cursor) || 0, id: "" };
  let bestAt = num(seed.at, 0);
  let bestId = str(seed.id);
  for (const row of asArray(rows)) {
    const at = num(row?.at, 0);
    const id = str(row?.id);
    if (at > bestAt || (at === bestAt && id > bestId)) {
      bestAt = at;
      bestId = id;
    }
  }
  return { at: bestAt, id: bestId };
}

// ---- the autopilot housekeeping sweep ------------------------------------------
// The pure core of the executor's housekeeping pass (main.cjs persists the
// result): claims whose run is gone go back on the pile, finished tasks move
// to the archive, and same-title live copies collapse.
// Every rule here spares a live claim — a task or request a run still holds
// is never pruned, capped, or deduped away.
//
// Ownership is durable, not just a process list: a claim carries a lease
// ({ pid, at }) stamped at claim time and refreshed by the owning process.
// A claim whose run id is not in THIS process's live set is only requeued
// when the lease is ours (our own dead run) or stale beyond leaseStaleMs
// (another app instance died mid-run) — a fresh foreign lease is someone
// else's live attempt, and requeueing it is how two processes double-ran one
// task.
const DEFAULT_LEASE_STALE_MS = 30 * MINUTE;

function leaseHeldElsewhere(row, { pid, now, leaseStaleMs }) {
  const lease = row?.lease;
  if (!isObject(lease) || !Number.isFinite(lease.at)) return false; // no lease stamp: pre-lease record, old rules
  if (lease.pid === pid) return false; // ours — liveRuns decides
  return now - lease.at < leaseStaleMs;
}

export function housekeepingSweep({ requests = [], tasks = [], liveRuns = new Set(), now = Date.now(), prefs = {}, pid = (typeof process !== "undefined" && process.pid) || 0, leaseStaleMs = DEFAULT_LEASE_STALE_MS } = {}) {
  const rules = normalizePrefs({ ...DEFAULT_PREFS, ...(isObject(prefs) ? prefs : {}) });
  const report = { requestsRequeued: 0, requestsPruned: 0, tasksReopened: 0, tasksArchived: 0, backlogCapped: 0, duplicateTasks: 0, absorbedRestored: 0, absorbedArchived: 0 };

  // Requests: a running claim whose run died (quit, crash, lost close) is
  // re-queued — unless a fresh lease says another process still owns it — and
  // a row mid-verification belongs to its verification pass, not the queue.
  // An unclaimed auto-filed request this old is a snapshot that moved on —
  // but the owner's requests (chat, manual, anything the compactor does not
  // treat as auto) never expire on a clock.
  const requestCutoff = now - 48 * HOUR;
  let outRequests = asArray(requests).filter(isObject).map((request) => {
    if (request.status === "verifying") return request;
    if (request.status !== "running" || liveRuns.has(request.runId) || leaseHeldElsewhere(request, { pid, now, leaseStaleMs })) return request;
    report.requestsRequeued += 1;
    const next = { ...request };
    delete next.status;
    delete next.runId;
    delete next.runningAt;
    delete next.lease;
    return next;
  });
  const beforePrune = outRequests.length;
  outRequests = outRequests.filter((request) => {
    if (request.status === "running" || request.status === "verifying") return true;
    if (str(request.source) === "chat" || !AUTO_SOURCES.has(request.source)) return true;
    return !(num(request.at, 0) && num(request.at, 0) < requestCutoff);
  });
  report.requestsPruned = beforePrune - outRequests.length;

  // Tasks: a stuck "active" (no live run behind the runId) reopens. Manually
  // activated tasks carry no runId and are never touched. A fresh foreign
  // lease blocks the reopen the same way it blocks request requeues.
  let outTasks = asArray(tasks).filter(isObject).map((task) => ({ ...task }));
  for (const task of outTasks) {
    if (task.status !== "active" || !task.runId || liveRuns.has(task.runId)) continue;
    if (leaseHeldElsewhere(task, { pid, now, leaseStaleMs })) continue;
    task.status = "open";
    delete task.runId;
    delete task.lease;
    task.updatedAt = now;
    task.logs = [...asArray(task.logs), { at: now, kind: "status", text: "autopilot run lost — reopened" }].slice(-40);
    report.tasksReopened += 1;
  }

  // Absorbed member rows follow their grouping: a plan that is gone (expired
  // elsewhere, manually deleted) restores its members to open work; a plan
  // that finished archives them. Without this, absorbed rows outlive their
  // plan as invisible zombies or vanish with work still outstanding.
  {
    const plansById = new Map(outTasks.filter((task) => str(task?.id)).map((task) => [str(task.id), task]));
    for (const task of outTasks) {
      if (task.status !== "absorbed") continue;
      const plan = plansById.get(str(task.absorbedInto));
      if (plan && plan.status !== "done" && plan.status !== "archived") continue;
      if (!plan) {
        const goneId = str(task.absorbedInto);
        task.status = "open";
        task.updatedAt = now;
        delete task.absorbedInto;
        delete task.runId;
        delete task.lastAttempt;
        delete task.verification;
        delete task.nextRunAt;
        delete task.lease;
        task.logs = [...asArray(task.logs), { at: now, kind: "status", text: `grouping ${goneId || "(gone)"} is no longer on the board — task restored` }].slice(-40);
        report.absorbedRestored += 1;
      } else {
        task.status = "archived";
        task.updatedAt = now;
        task.doneAt = num(plan.doneAt, num(plan.updatedAt, now));
        task.completionFromTaskId = str(plan.id);
        if (plan.verification) task.verification = { ...plan.verification, inheritedFromTaskId: str(plan.id) };
        delete task.absorbedInto;
        task.logs = [...asArray(task.logs), { at: now, kind: "status", text: `grouping ${str(plan.id)} finished — archived with it` }].slice(-40);
        report.absorbedArchived += 1;
      }
    }
  }

  // Completed work moves to the archive while retaining results and evidence.
  // A card mid-verification or with a live claim never ages out.
  const doneCutoff = now - rules.tidyDoneAfterHours * HOUR;
  outTasks = outTasks.map((task) => {
    const stamp = num(task.updatedAt, num(task.doneAt, num(task.createdAt, 0)));
    if (task.status !== "done" || task.runId || !stamp || stamp >= doneCutoff) return task;
    report.tasksArchived += 1;
    return { ...task, status: "archived", doneAt: num(task.doneAt, 0) || stamp || now };
  });
  // No queue-length truncation: all accepted backlog tasks remain available.

  // Same-title copies collapse to the keeper. A claimed row is never dropped
  // (it is live work); when a claimed copy shares a title with unclaimed
  // copies, the claim wins and the unclaimed stragglers go. Only two or more
  // claimed copies of one title — two live attempts, which the executor's
  // title guard resolves — are left entirely alone.
  const beforeDedup = outTasks.length;
  const protectedIds = dependencyProtectedIds(outTasks);
  const byTitle = new Map();
  const claimCount = new Map();
  for (const task of outTasks) {
    if (!isLiveTask(task)) continue;
    const key = compactKey(task?.title);
    if (!key) continue;
    if (task.runId) {
      claimCount.set(key, (claimCount.get(key) ?? 0) + 1);
      continue;
    }
    const existing = byTitle.get(key);
    if (!existing || num(task.updatedAt, 0) > num(existing.updatedAt, 0)) byTitle.set(key, task);
  }
  outTasks = outTasks.filter((task) => {
    if (protectedIds.has(str(task.id))) return true;
    if (!isLiveTask(task)) return true;
    const key = compactKey(task?.title);
    if (!key) return true;
    if (task.runId) return true; // a live claim is never housekept away
    // Unclaimed: keep only when no claim holds the title and this is the
    // freshest unclaimed copy.
    return !claimCount.has(key) && byTitle.get(key) === task;
  });
  report.duplicateTasks = beforeDedup - outTasks.length;

  return { requests: outRequests, tasks: outTasks, report };
}

// ---- the overseer's stale-session rescue -------------------------------------
// A stale session — work left in progress and quiet past the stale horizon —
// is the tree's silent rot: the organisation dims it and nothing ever picks it
// back up. The repair pass turns each one into a resume request the executor
// can run: oldest first, capped per pass, and never a duplicate of a request
// in the inbox, a dispatched one still in the dedupe history, or a task on the
// board (all matched on the shared compactKey of their titles).
export const RESCUE_LIMITS = { perPass: 2, promptTodos: 4 };
export function staleRescues({ sessions = null, todos = [], policy = {}, existing = [], tasks = [], now = Date.now(), limit = RESCUE_LIMITS.perPass } = {}) {
  const rules = normalizePolicy({ ...DEFAULT_POLICY, ...(isObject(policy) ? policy : {}) });
  const bySession = new Map();
  for (const todo of asArray(todos)) {
    if (!isObject(todo) || typeof todo.sessionId !== "string" || !isOpenTodo(todo)) continue;
    if (!bySession.has(todo.sessionId)) bySession.set(todo.sessionId, []);
    bySession.get(todo.sessionId).push(todo);
  }
  const taken = new Set(
    asArray(existing)
      .concat(asArray(tasks))
      .map((item) => compactKey(str(item?.title)))
      .filter(Boolean),
  );
  const rescues = [];
  for (const session of asArray(sessions)) {
    if (!isObject(session) || typeof session.id !== "string" || !session.id || session.parentId) continue;
    const open = bySession.get(session.id) ?? [];
    const running = open.find((todo) => todo.status === "in_progress" && str(todo.content));
    if (!running) continue;
    const quietMinutes = Math.floor(Math.max(0, now - num(session.timeUpdated, 0)) / MINUTE);
    if (quietMinutes < rules.staleAfterHours * 60) continue;
    const title = str(session.title) || session.id;
    const requestTitle = clip(`Resume: ${title}`, 90);
    const key = compactKey(requestTitle);
    if (!key || taken.has(key)) continue;
    const pending = open.filter((todo) => todo !== running && str(todo.content)).slice(0, RESCUE_LIMITS.promptTodos);
    rescues.push({
      id: session.id,
      title,
      quietMinutes,
      todo: str(running.content),
      pending: Math.max(0, open.length - 1),
      request: {
        title: requestTitle,
        prompt: clip(
          `A-Eyes overseer: session "${title}" went quiet ${ago(quietMinutes)} with "${str(running.content)}" still in progress. ` +
            `Pick the work back up: finish that todo${pending.length ? `, then ${pending.map((todo) => `"${clip(str(todo.content), 50)}"`).join(", ")}` : ""}.`,
          400,
        ),
      },
    });
    taken.add(key);
  }
  return rescues.sort((a, b) => b.quietMinutes - a.quietMinutes).slice(0, Math.max(0, limit));
}

// Folders clean out on the same clocks as everything else. Entries older than
// FOLDER_LIMITS.entryDays drop from every folder; a folder that ends up empty
// goes with them; a task's folder goes when the task has left the board or is
// done/archived past the tidy clock ("cleaned up after done"); a session or
// todo folder goes when the session has left the store and the folder has been
// quiet as long as the checkpoints wait. `foldersCleaned` counts the folder
// keys removed.
function tidyNodeFolders(folders, { sessions, tasks, now, staleHours }, report) {
  const source = isObject(folders) ? folders : {};
  const entryCutoff = now - FOLDER_LIMITS.entryDays * DAY;
  const quietCutoff = now - TIDY_LIMITS.checkpointDays * DAY;
  const doneCutoff = now - Math.max(1, staleHours) * HOUR;
  const known = Array.isArray(sessions) ? new Set(sessions.map((session) => (isObject(session) ? session.id : null)).filter(Boolean)) : null;
  const board = new Map(asArray(tasks).filter((task) => isObject(task) && typeof task.id === "string").map((task) => [task.id, task]));
  let cleaned = 0;
  const out = {};
  for (const [key, folder] of Object.entries(source)) {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    const entries = asArray(folder?.entries).filter((entry) => isObject(entry) && entry.at >= entryCutoff);
    const drop =
      !FOLDER_NODE_KINDS.has(kind) ||
      !entries.length ||
      (kind === "task" &&
        (() => {
          // Tree ids for tasks are `task:<board id>` (the focus and the rail
          // both add the prefix), so the board lookup strips it — and accepts
          // a bare board id in case a writer skipped the prefix.
          const boardId = id.startsWith("task:") ? id.slice("task:".length) : id;
          const task = board.get(boardId) ?? board.get(id);
          if (!task) return true;
          const stamp = num(task.updatedAt, num(task.doneAt, num(folder?.updatedAt, 0)));
          return (task.status === "done" || task.status === "archived") && (!stamp || stamp < doneCutoff);
        })()) ||
      ((kind === "session" || kind === "todo") && known !== null && !known.has(kind === "todo" ? id.split(":")[0] : id) && num(folder?.updatedAt, 0) < quietCutoff);
    if (drop) {
      cleaned += 1;
      continue;
    }
    out[key] = { ...folder, entries };
  }
  const kept = Object.entries(out).sort((a, b) => num(b[1]?.updatedAt, 0) - num(a[1]?.updatedAt, 0)).slice(0, FOLDER_LIMITS.folders);
  cleaned += Math.max(0, Object.keys(out).length - kept.length);
  report.foldersCleaned = cleaned;
  return normalizeNodeFolders(Object.fromEntries(kept));
}

// Housekeeping over the data files. Conservative: a collection that was not
// handed in (null, not an array/object) comes back as its empty fallback and is
// NOT reported as changed; manual requests and non-done tasks are never touched.
export function tidy({ tasks, ideas, requests, checkpoints, nodeFolders = null, sessions = null, collisions = null, audit = null, duplicates = null, now = Date.now(), prefs = {} } = {}) {
  const rules = normalizePrefs({ ...DEFAULT_PREFS, ...(isObject(prefs) ? prefs : {}) });
  const report = { tasksArchived: 0, ideasPruned: 0, requestsCleared: 0, checkpointsDropped: 0, foldersCleaned: 0, text: "" };
  const out = {
    tasks: Array.isArray(tasks) ? tidyTasks(tasks, now, rules.tidyDoneAfterHours, report) : [],
    ideas: Array.isArray(ideas) ? tidyIdeas(ideas, now, report) : [],
    requests: Array.isArray(requests) ? tidyRequests(requests, { now, collisions, audit, duplicates }, report) : [],
    checkpoints: isObject(checkpoints) ? tidyCheckpoints(checkpoints, sessions, now, report) : {},
    nodeFolders: isObject(nodeFolders) ? tidyNodeFolders(nodeFolders, { sessions, tasks, now, staleHours: rules.tidyDoneAfterHours }, report) : {},
  };
  const differs = (before, after) => before != null && JSON.stringify(before) !== JSON.stringify(after);
  const changed = differs(tasks, out.tasks) || differs(ideas, out.ideas) || differs(requests, out.requests) || differs(checkpoints, out.checkpoints) || differs(nodeFolders, out.nodeFolders);
  const parts = [];
  if (report.tasksArchived) parts.push(`archived ${plural(report.tasksArchived, "done task")}`);
  if (report.ideasPruned) parts.push(`pruned ${plural(report.ideasPruned, "idea")}`);
  if (report.requestsCleared) parts.push(`cleared ${plural(report.requestsCleared, "request")}`);
  if (report.checkpointsDropped) parts.push(`dropped ${plural(report.checkpointsDropped, "checkpoint")}`);
  if (report.foldersCleaned) parts.push(`cleaned ${plural(report.foldersCleaned, "node folder")}`);
  report.text = parts.length ? parts.join(" · ") : "nothing to tidy";
  return { ...out, report, changed };
}

// Work verbs instruct the assistant to do something; query verbs ask it to
// look something up. Both can open an instruction (the `imperative` check in
// classifyIntent), but only a query verb may fall through to a query intent.
const DO_VERBS = new Set([
  "add", "make", "build", "write", "create", "implement", "change", "update", "remove", "refactor",
  "rename", "move", "wire", "draw", "fix", "work", "do", "handle", "upgrade", "finish", "complete", "address", "tackle", "run",
  "continue", "begin", "spawn", "delegate", "review", "use", "test", "keep", "focus",
  // "start work on the pending tasks" used to match the tasks *query* and come
  // back as a list, because none of these were imperatives.
  "start", "get", "go", "pick", "take", "improve", "ship", "clear", "close", "knock", "crank", "push", "attack", "sort",
]);
const QUERY_VERBS = new Set(["check", "look", "investigate", "find", "show"]);
// Verbs that can only mean "write code". They short-circuit every rule below,
// so "improve the tree view" is a build request and not an order to reorganise
// the tree, and "build the ideas panel" does not read as an ideas question.
const BUILD_VERBS = new Set(["build", "implement", "add", "create", "write", "improve", "upgrade", "refactor", "wire", "draw", "rename", "make", "ship"]);
const IMPERATIVES = new Set([...DO_VERBS, ...QUERY_VERBS]);
// Intents that only report state. A work verb in front of one ("work on the
// agent task", "fix the ideas list") is an instruction, not a question.
const QUERY_INTENTS = new Set(["status", "tasks", "ideas", "collisions", "machine", "agents", "log"]);
const INTENT_RULES = [
  ["resume-work", /\b(?:restart|resume|continue|retry|redo|pick up|carry on|keep going)\b.*\b(?:work|jobs?|interrupted|left off)\b|\binterrupted (?:work|jobs?)\b/],
  // The Auto Builder feed: mentioning the builder (or its feed) asks about
  // that machinery, so the reply reads the executor's own facts — what is
  // building, what is queued, why it is held, what the feed log says. It sits
  // ahead of the query rules because "the builder is running 3 jobs" would
  // otherwise land on the machine intent and lose the feed digest. A cleaning
  // phrasing rides the same intent and ends in a compactor pass.
  ["builder", /\b(?:auto ?builders?|builders?|build feed|the feed|feed log|builder log)\b/],
  // The assistant's own activity log, distinct from the Auto Builder feed.
  ["log", /\b(?:activity log|read the log|assistant log|whats in the log|show (?:me )?the log|the log)\b/],
  ["status", /\b(status|brief|briefing|summary|summar[iy][sz]e|whats happening|what is happening|working on|update)\b/],
  // "what should I work on" asks for a pick, not the task list — so it sits
  // ahead of the tasks rule. It is never an order either: "suggest" is not a
  // work verb and the intent stays out of QUERY_INTENTS, so even "pick
  // something to work on" answers with picks instead of queueing itself.
  ["suggest", /\b(suggest\w*|recommend\w*|what should i|what can i|what to (?:work|do|build|tackle|fix)|next (?:task|thing|step)|where to (?:start|begin)|pick (?:a task|something|work)|anything to (?:do|work|build)|something to (?:do|work|build)|what needs (?:doing|work|attention|fixing))\b/],
  ["tasks", /\b(tasks?|todos?|open work)\b|\b(?:what|show|list|see|did)\b.*\b(?:got done|done|finished|completed|accomplish\w*)\b/],
  ["ideas", /\b(ideas?)\b/],
  ["collisions", /\b(collisions?|conflicts?|overlaps?|overlapping)\b/],
  ["machine", /\b(machine|tests?|running|process(?:es)?|leases?)\b/],
  // A bare "what are the agents doing" reports the roster; with an imperative
  // in front ("use the agents", "work with sub agents") QUERY_INTENTS routes
  // it to a request like every other query intent.
  ["agents", /\b(agents?|roster|sub.?agents?|workers?|helpers?)\b/],
  // Queue cleaning is its own intent, not tidy: "clear up the queue" asks the
  // compactor to collapse the backlog and hand the next pick to the foreman —
  // the keeper's tidy knows nothing about the queue at all. Both directions
  // match ("clean the queue" and "the queue is a mess"), and a statement
  // counts as a request for action here because that is what the pass is for.
  ["compact", /(?=.*\b(?:queue|backlog|inbox|requests?)\b)(?=.*\b(?:clear|clean|tidy|compact\w*|dedupe|drain|empty|purge|prune|shrink|trim|sort|fix|mess|stuck|bloated)\b)/],
  ["tidy", /\b(clean|cleanup|cleaning|tidy|tidying|clear|prune|archive)\b/],
  ["fix", /\b(fix|fixes|fixing|repair|problems?|broken|heal)\b/],
  ["organize", /\b(organi[sz]\w*|tree|fold|layout)\b/],
  ["overseer", /\b(overseer|oversee\w*|self.?improv\w*|improve yourself|improve the assistant|assistants? health|workflow health)\b/],
  ["pause", /\b(pause|stop)\b/],
  ["resume", /\b(resume|start|continue)\b/],
  ["help", /\b(help|what can you do|commands)\b/],
];

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keyword routing, case- and punctuation-insensitive, whole words only. An
// instruction that opens with an imperative verb becomes a request; "update"
// leading a sentence is that verb, not a status question. A work verb in
// front of a query keyword ("work on the agent task", "run the tests") is an
// instruction too — the keyword describes the target, not the question.
export function classifyIntent(text) {
  const flat = normalizeText(text);
  if (!flat) return "chat";
  const words = flat.replace(/^(?:(?:please|pls|hey|hi|ok|okay|can you|could you|would you|will you)\s+)+/, "").split(" ");
  const imperative = words.length > 1 && IMPERATIVES.has(words[0]);
  if (imperative && BUILD_VERBS.has(words[0])) return "request";
  const searchable = imperative && words[0] === "update" ? words.slice(1).join(" ") : flat;
  for (const [intent, pattern] of INTENT_RULES) {
    if (!pattern.test(searchable)) continue;
    if (imperative && DO_VERBS.has(words[0]) && QUERY_INTENTS.has(intent)) return "request";
    return intent;
  }
  return imperative ? "request" : "chat";
}

// The keyless answer: grounded in `facts` and `state` only, never invented.
const STOP_WORDS = new Set(["that", "this", "with", "from", "into", "have", "what", "when", "where", "then", "than", "them", "they", "your", "please", "about", "would", "could", "should", "there", "their", "make", "need", "want", "like", "just", "some", "also", "look", "into"]);
const keywords = (text) => new Set(normalizeText(text).split(" ").filter((word) => word.length >= 4 && !STOP_WORDS.has(word)));
const overlap = (needles, text) => [...keywords(text)].filter((word) => needles.has(word)).length;
const titleOf = (item, fallback = "untitled") => clip(str(item?.title) || str(item?.id).slice(0, 12) || fallback, 40);
const sessionLine = (session) => `"${titleOf(session)}"${typeof session.updatedMinutesAgo === "number" ? ` (${ago(session.updatedMinutesAgo)})` : ""}`;
const isActiveFact = (session) => num(session.updatedMinutesAgo, Infinity) < 15 || asArray(session.todos).some((todo) => todo?.status === "in_progress");

function relatedFacts(text, { sessions, tasks, collisions, requests }, limit = 2) {
  const needles = keywords(text);
  if (!needles.size) return [];
  const scored = [];
  for (const session of sessions ?? []) {
    const score = overlap(needles, `${session.title ?? ""} ${asArray(session.todos).map((todo) => todo?.content ?? "").join(" ")}`);
    if (score) scored.push({ score, recency: -num(session.updatedMinutesAgo, 0), text: `session ${sessionLine(session)}` });
  }
  for (const task of tasks ?? []) {
    const score = overlap(needles, task.title);
    if (score) scored.push({ score, recency: num(task.updatedAt, 0) / 1e15, text: `task "${titleOf(task)}" (${str(task.status, "open")})` });
  }
  for (const request of requests ?? []) {
    const score = overlap(needles, request.title);
    if (score) scored.push({ score, recency: num(request.at, 0) / 1e15, text: `queued request "${titleOf(request)}"` });
  }
  for (const collision of collisions ?? []) {
    const score = overlap(needles, basename(collision.file).replace(/[._-]/g, " "));
    if (score) scored.push({ score, recency: 0, text: `collision on ${basename(collision.file)}` });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.recency - a.recency)
    .slice(0, limit)
    .map((entry) => entry.text);
}

function aiNote(state) {
  const ai = isObject(state?.ai) ? state.ai : null;
  return ai && ai.online === false && typeof ai.lastError === "string" && ai.lastError ? ` AI offline (${clip(ai.lastError, 60)}).` : "";
}

function serviceLine(state, now) {
  if (!state) return "";
  const problems = asArray(state.problems).length;
  if (state.status === "paused") return `Service paused · ${plural(problems, "open problem")}.`;
  return `Service running · tick ${Math.floor(num(state.tickCount, 0))} · next ${num(state.nextTickAt, 0) ? relative(num(state.nextTickAt, 0) - now) : "soon"} · ${plural(problems, "open problem")}.`;
}

function compactStatus({ sessions, collisions, tasks, ideas }) {
  const parts = [];
  if (sessions) parts.push(`${plural(sessions.length, "session")}, ${sessions.filter(isActiveFact).length} active`);
  if (collisions) parts.push(plural(collisions.length, "collision"));
  if (tasks) parts.push(plural(tasks.filter((task) => task.status === "open" || task.status === "active").length, "open task"));
  if (ideas) parts.push(plural(ideas.filter((idea) => !idea.read).length, "unread idea"));
  return parts.length ? `Right now: ${parts.join(", ")}.` : "I could not read the store right now.";
}

// Ranked next-work picks, grounded in the facts alone — nothing is invented.
// A live collision and real audit errors outrank board work; a task the user
// filed by hand outranks the assistant's own upkeep chores (the same order the
// executor picks with); the request inbox outranks loose ideas; and a session
// that went quiet mid-todo is worth resuming. The suggest intent, greetings
// and the AI payload all read this same list.
export function suggestWork({ sessions = null, tasks = null, ideas = null, requests = null, collisions = null, uncommitted = null, audit = null, now = Date.now(), limit = 5 } = {}) {
  const picks = [];
  const push = (kind, title, reason, rank) => {
    const label = clip(title, 70);
    if (label && !picks.some((pick) => pick.title === label)) picks.push({ kind, title: label, reason: clip(reason, 80), rank });
  };
  for (const entry of asArray(collisions).filter(isObject).slice(0, 2)) {
    const fileCount = collisionFiles(entry).length;
    const where = fileCount > 1 ? plural(fileCount, "file") : "one file";
    const split = uniqueStrings(ownershipRows(entry).map((row) => row.owner).filter(Boolean)).length > 1;
    push(
      "collision",
      basename(entry.file) || str(entry.file),
      `${plural(asArray(entry.sessions).length, "session")} editing ${where}${str(entry.owner) ? `, ${str(entry.owner)} owns it` : ""}${split ? ", collaborating" : ""}${entry.handoff ? ", confirm handoff" : ""}`,
      100
    );
  }
  for (const entry of asArray(uncommitted).filter(isObject).slice(0, 2))
    push(
      "uncommitted",
      basename(entry.file) || str(entry.file),
      "exists only as uncommitted changes — not in committed HEAD",
      90
    );
  if (num(audit?.errors, 0)) push("audit", `${plural(num(audit.errors), "audit error")} to fix`, "the auditor found real errors", 95);
  for (const session of asArray(sessions).filter(isObject)) {
    const open = asArray(session.todos).filter((todo) => todo?.status === "in_progress");
    if (open.length && num(session.updatedMinutesAgo, 0) >= 60)
      push("session", session.title, `went quiet with "${clip(open[0].content, 40)}" in progress`, 80);
  }
  for (const request of asArray(requests).filter((entry) => isObject(entry) && entry.status !== "running").slice(0, 2))
    push("request", str(request.title) || clip(str(request.prompt), 60), "waiting in the request inbox", 75);
  const rankTask = (task) =>
    SELF_MAINTENANCE_TITLE.test(str(task.title)) ? 10 : str(task.source) === "chat" ? 65 : String(task.id).startsWith("task_plan_") ? 55 : str(task.source) === "a-eyes" ? 45 : 35;
  const open = asArray(tasks)
    .filter((task) => isObject(task) && task.status === "open" && !(num(task.nextRunAt, 0) > now) && !exhaustedAttempts(task))
    .sort((a, b) => rankTask(b) - rankTask(a) || num(a.createdAt, num(a.updatedAt, 0)) - num(b.createdAt, num(b.updatedAt, 0)));
  for (const task of open.slice(0, 3)) {
    const rank = rankTask(task);
    push("task", task.title, rank === 65 ? "you asked for this" : rank === 10 ? "assistant upkeep" : "open on the board", rank);
  }
  const unread = asArray(ideas).filter((idea) => isObject(idea) && !idea.read && (idea.status === "new" || idea.status == null));
  if (unread.length) push("idea", str(unread[0].title), `${plural(unread.length, "unread idea")} waiting`, 20);
  return picks.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

// What the executor is doing, as one line. facts.executor is null when the
// autopilot snapshot was not gathered, so the line only appears with data.
function executorLine(executor, readiness = null) {
  const source = isObject(executor) ? executor : null;
  if (!source) return null;
  const running = asArray(source.running).filter((job) => isObject(job) && !job.finished);
  const lines = [running.length
    ? `Building now (${running.length}/${Math.max(running.length, num(source.parallel, 1))} worker slots): ${running.slice(0, 3).map((job) => `"${clip(job.title, 40)}"`).join(", ")}.`
    : "No build worker is running."];
  const counts = isObject(readiness?.counts) ? readiness.counts : null;
  if (counts) {
    lines.push(`${plural(num(counts.readyTasks, 0), "task")} and ${plural(num(counts.readyRequests, 0), "request")} ready in one ranked queue.`);
    const holds = [["review", "awaiting verification"], ["waiting", "waiting for prerequisites"], ["blocked", "need review"], ["cooling", "cooling down"]]
      .filter(([key]) => num(counts[key], 0) > 0).map(([key, label]) => `${num(counts[key], 0)} ${label}`);
    if (holds.length) lines.push(`Other saved work: ${holds.join("; ")}.`);
  } else if (num(source.queued, 0)) lines.push(`${plural(num(source.queued), "work item")} queued; detailed readiness is unavailable.`);
  if (readiness?.paused || source.enabled === false) lines.push(`New workers are paused${running.length ? "; current workers can finish" : ""}.`);
  else if (str(readiness?.waiting || source.waiting)) lines.push(`Dispatch waiting: ${clip(str(readiness?.waiting || source.waiting), 140)}.`);
  else if (!running.length && num(counts?.ready, num(source.queued, 0)) > 0) lines.push("Ready work is waiting for the dispatcher; a worker start has not been confirmed.");
  return lines.join(" ");
}

function activityLogRows(log, limit = 6) {
  return asArray(log)
    .filter((entry) => isObject(entry) && str(entry.text) && str(entry.kind) !== "tick")
    .slice(-Math.max(1, limit));
}

function activityLogLine(log, limit = 4) {
  const rows = activityLogRows(log, limit);
  return rows.length ? `Log: ${rows.map((entry) => clip(str(entry.text), 70)).join("; ")}.` : null;
}

const ACTIONABLE_PICKS = new Set(["task", "request", "collision", "audit", "session"]);

// What the thinker says in the assistant box, and whether it should start
// work. Grounded in the activity log and ranked picks; never invents a job.
export function thinkPlan({ log = [], suggestions = [], executor = null, lastThought = "", overseer = null, organization = null } = {}) {
  const logRows = activityLogRows(log, 8);
  const picks = asArray(suggestions).filter((entry) => isObject(entry) && str(entry.title));
  const top = picks[0] ?? null;
  const running = asArray(executor?.running).filter(isObject);
  const queued = Math.floor(num(executor?.queued, 0));
  const waiting = str(executor?.waiting);
  const enabled = !executor || executor.enabled !== false;
  const findings = asArray(isObject(overseer) ? overseer.findings : null).filter(isObject);
  const counts = isObject(organization?.counts) ? organization.counts : {};
  const bits = [];
  if (logRows.length) bits.push(`log: ${logRows.slice(-3).map((row) => clip(str(row.text), 64)).join("; ")}`);
  else bits.push("log is quiet");
  if (num(counts.sessions, 0) || num(counts.stale, 0) || num(counts.active, 0))
    bits.push(`tree ${num(counts.active, 0)} active · ${num(counts.stale, 0)} stale · ${num(counts.folded, 0)} folded`);
  if (findings.length) bits.push(`overseer: ${clip(str(findings[0].title), 40)}${findings.length > 1 ? ` +${findings.length - 1}` : ""}`);
  if (running.length) bits.push(`building ${running.slice(0, 2).map((job) => `"${clip(str(job.title), 36)}"`).join(", ")}`);
  else if (!enabled) bits.push("executor is off");
  else if (waiting) bits.push(`held: ${clip(waiting, 48)}`);
  else bits.push(queued ? `idle · ${plural(queued, "request")} waiting` : "executor idle");
  if (top) bits.push(`could work on "${clip(top.title, 50)}" (${clip(str(top.reason), 40)})`);
  const thinking = clip(bits.join(" · "), 280) || "looking at the board";
  const started = (title) => {
    const label = clip(title, 50);
    return Boolean(lastThought && label && String(lastThought).includes(`starting work on "${label}"`));
  };
  const idle = enabled && !waiting && !running.length;
  let act = null;
  if (idle && top && ACTIONABLE_PICKS.has(str(top.kind)) && !started(top.title)) {
    act = { kind: "dispatch", title: clip(top.title, 70), reason: clip(str(top.reason), 80), pick: str(top.kind) };
  } else if (idle && queued > 0 && !started("the queue") && !(top && started(top.title))) {
    act = { kind: "dispatch", title: "the queue", reason: `${plural(queued, "request")} waiting`, pick: "queue" };
  }
  return { thinking, act, pick: top };
}

// Small talk, not an order: greetings and "how are you" get a greeting back
// plus the lay of the land and a pick — never "kept in the thread" boilerplate.
const GREETING = /^(?:hi|hello|hey|yo|howdy|hiya|sup|greetings|morning|evening|afternoon|good (?:morning|afternoon|evening|day)|how are you|hows it going|how is it going|whats up)\b/;
// The rest of the small talk. These stay the "chat" intent — the reply just
// stops reading like a form letter, and a bare yes resolves against what was
// actually offered instead of queueing the word "yes" as a task.
const THANKS = /^(?:thanks|thank you|thx|ty|cheers|much appreciated|appreciate it)\b/;
const FAREWELL = /^(?:bye|goodbye|good ?night|see (?:you|ya)\b|later|gtg|cya|talk later)\b/;
const IDENTITY = /^(?:(?:who|what) are you|whats? your name|who is this)\b/;
const AFFIRM = /^(?:yes|yeah|yep|yup|ok|okay|alright|sure|aye|absolutely|definitely|sounds good|works for me|go ahead|go for it|do it|please do|lets do it|let's do it|why not)(?:[\s!.,]+(?:please|yes|yeah|yep|ok|okay|sure|go|ahead|for|do|it|that|them|lets|let's|first|second|third|one|two|three))*[\s!.,]*$/;
const NEGATE = /^(?:no|nope|nah|not now|maybe later|later|never ?mind|forget it|cancel|skip it|leave it|dont bother|don't bother)\b/;
const DESCRIBE = /^(?:tell me (?:more )?about|talk (?:to me )?about|what about|how about|whats?|describe|more about|more on|details? (?:on|about|of)|explain)\s+(.+)$/;

// What the assistant last put on the table: quoted titles in its most recent
// replies — the list "yes", "work on it" and "the second one" resolve against.
// A reply only counts as an offer when it invited a next step; a status dump
// full of quoted names does not turn "yes" into a build order.
const OFFER_LINE = /could work on|say work on|top pick|want me to|shall i|pick one|or name your own|say the word|queue it/i;
const quoteTitles = (line) => [
  ...new Set(
    [...String(line ?? "").matchAll(/"([^"<>\n]{2,80})"/g)]
      .map((match) => match[1])
      .filter((title) => !/^(?:work on|say |focused|reply to|jobs?:)/i.test(title)),
  ),
];

function lastAssistantText(state) {
  const message = [...asArray(state?.messages)].reverse().find((entry) => isObject(entry) && entry.role === "assistant" && typeof entry.text === "string");
  return message ? message.text : "";
}

// Titles quoted by the latest reply that asked for a decision.
function pendingOffers(state) {
  const last = lastAssistantText(state);
  return last && OFFER_LINE.test(last) ? quoteTitles(last) : [];
}

// Titles quoted by the newest reply that carried any — "it" lands here when no
// explicit offer is on the table.
function lastQuoted(state) {
  for (const entry of [...asArray(state?.messages)].reverse()) {
    if (!isObject(entry) || entry.role !== "assistant") continue;
    const titles = quoteTitles(entry.text);
    if (titles.length) return titles;
  }
  return [];
}

const ORDINAL_INDEX = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4, last: -1 };
const ordinalAt = (flat) => {
  const match = flat.match(/\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b/) ?? flat.match(/\boption\s+([1-5])\b/);
  if (!match) return null;
  return match[1].length === 1 ? Number(match[1]) - 1 : ORDINAL_INDEX[match[1]];
};
const pickAt = (list, index) => (index === -1 ? asArray(list)[asArray(list).length - 1] : asArray(list)[index]) ?? null;

// "work on it" carries no subject of its own: once the leading verb chain is
// stripped, only a pronoun or an ordinal is left. Anything richer is a real
// instruction with its own words.
const VAGUE_PRONOUNS = new Set(["", "it", "that", "this", "them", "one", "same", "that one", "this one", "the one", "the same", "same thing", "the other one"]);
const VAGUE_ORDINAL = /^(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|option\s+\d)\s*(?:one|option|pick)?$/;
const FILLER_WORDS = new Set(["please", "pls", "on", "at", "the", "a", "an", "for", "with", "away", "ahead", "out", "up", "just", "now", "then", "all", "of"]);
const isVagueTail = (tail) => VAGUE_PRONOUNS.has(tail) || VAGUE_ORDINAL.test(tail);

function tailAfter(flat, verbs) {
  const words = String(flat ?? "").split(" ").filter(Boolean);
  let index = 0;
  while (index < words.length && ((verbs && IMPERATIVES.has(words[index])) || FILLER_WORDS.has(words[index]))) index += 1;
  return words.slice(index).join(" ");
}

function vagueSubject(flat) {
  const tail = tailAfter(flat, true);
  return isVagueTail(tail) ? { vague: true, index: ordinalAt(tail) } : { vague: false, index: null };
}

// Where "it" lands: the offers on the table first, then (for loose follow-ups)
// whatever the last reply quoted, then the node the user clicked, then the top
// pick — never an invented title.
function resolveSubject({ index = null, state, picks, focused, loose = false }) {
  const offers = pendingOffers(state);
  if (index !== null) {
    const title = pickAt(offers, index) ?? pickAt(asArray(picks).map((pick) => pick.title), index);
    return title ? { title, via: "offer" } : null;
  }
  if (offers.length) return { title: offers[0], via: "offer" };
  if (loose) {
    const quoted = lastQuoted(state);
    if (quoted.length) return { title: quoted[0], via: "quote" };
  }
  if (focused) return { title: str(focused.label) || focused.id, via: "focus" };
  const top = asArray(picks)[0];
  return top ? { title: top.title, via: "pick" } : null;
}

const describeSubject = (flat) => {
  const match = flat.match(DESCRIBE);
  return match ? match[1].replace(/^(?:is|are|was|were|the|a|an|that|this|so|really|exactly)\s+/, "").trim() : null;
};

// The fact a subject names, as the best-scored real entity — like relatedFacts
// but returning the hit itself so it can be described, not just echoed.
function matchFact(subject, { sessions, tasks, ideas, requests, collisions }) {
  const needles = keywords(subject);
  if (!needles.size) return null;
  const scored = [];
  const push = (kind, item, score, recency) => {
    if (score > 0) scored.push({ kind, item, score, recency });
  };
  for (const session of sessions ?? []) push("session", session, overlap(needles, `${session.title ?? ""} ${asArray(session.todos).map((todo) => todo?.content ?? "").join(" ")}`), -num(session.updatedMinutesAgo, 0));
  for (const task of tasks ?? []) push("task", task, overlap(needles, task.title), num(task.updatedAt, 0) / 1e15);
  for (const request of requests ?? []) push("request", request, overlap(needles, request.title), num(request.at, 0) / 1e15);
  for (const idea of ideas ?? []) push("idea", idea, overlap(needles, idea.title), 0);
  for (const collision of collisions ?? []) push("collision", collision, overlap(needles, basename(collision.file).replace(/[._-]/g, " ")), 0);
  return scored.sort((a, b) => b.score - a.score || b.recency - a.recency)[0] ?? null;
}

// An exact title hit beats a fuzzy one when the subject is already canonical —
// a resolved offer names a real thing or nothing.
function exactFact(title, { sessions, tasks, ideas, requests, collisions }) {
  const wanted = String(title ?? "").toLowerCase();
  if (!wanted) return null;
  const exact = (list, name) => asArray(list).find((item) => isObject(item) && str(name(item)).toLowerCase() === wanted);
  const kinds = [
    ["task", tasks, (item) => item.title],
    ["request", requests, (item) => item.title],
    ["idea", ideas, (item) => item.title],
    ["session", sessions, (item) => item.title],
    ["collision", collisions, (item) => basename(item.file)],
  ];
  for (const [kind, list, name] of kinds) {
    const item = exact(list, name);
    if (item) return { kind, item };
  }
  return null;
}

function describeEntry(kind, item, now) {
  if (kind === "session") {
    const todos = asArray(item.todos);
    const open = todos.filter(isOpenTodo);
    const running = todos.filter((todo) => todo?.status === "in_progress");
    const bits = [`updated ${ago(item.updatedMinutesAgo)}`];
    if (item.agent) bits.push(`agent ${item.agent}`);
    bits.push(todos.length ? `${plural(open.length, "open todo")}${running.length ? ` — "${clip(running[0].content, 40)}" in progress` : ""}` : "no todos");
    return `Session "${titleOf(item)}" — ${bits.join("; ")}.`;
  }
  if (kind === "task") {
    const bits = [str(item.status, "open")];
    if (item.source) bits.push(`from ${item.source}`);
    if (num(item.nextRunAt, 0) > now) bits.push(`cooling down ${relative(num(item.nextRunAt) - now)}`);
    if (num(item.runFailures, 0)) bits.push(plural(num(item.runFailures), "failed run"));
    return `Task "${titleOf(item)}" — ${bits.join(", ")}. Say "work on ${clip(item.title, 30)}" and I queue it.`;
  }
  if (kind === "request") return `Queued request "${titleOf(item)}" — ${str(item.status) || "waiting"}, from ${str(item.source, "manual")}${num(item.at) ? `, filed ${ago((now - num(item.at)) / MINUTE)}` : ""}.`;
  if (kind === "idea") return `Idea "${titleOf(item)}" — ${str(item.status, "new")}${item.read ? "" : ", unread"}. The Ideas inbox has it; Keep or Make task manages it there.`;
  if (kind === "collision") {
    const n = collisionFiles(item).length;
    const where = n > 1 ? plural(n, "file") : "the same file";
    const extra = n > 1 ? ` +${n - 1} more` : "";
    return `Collision on ${basename(item.file)}${extra} — ${plural(asArray(item.sessions).length, "session")} editing ${where}${str(item.owner) ? `, ${str(item.owner)} owns it` : ""}${item.handoff ? "; owner inactive, confirm handoff" : ""}. Check the recent diffs before both keep going.`;
  }
  return "";
}

// "tell me about X", "the second one?", "what about it": a chat line pointing
// at something real gets a description, not a kept-in-the-thread shrug. Null
// means the subject matched nothing — the caller's fallback still applies.
function describeAnswer(flat, { sessions, tasks, ideas, requests, collisions, focused, picks, state, now }) {
  const subject = describeSubject(flat);
  const index = ordinalAt(flat);
  const bareOrdinal = index !== null && /^(?:(?:the|that|this|and|what about|how about)\s+)*(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last|option\s+\d)\s*(?:one|option|pick)?$/.test(flat);
  if (subject === null && !bareOrdinal) return null;
  const tail = subject === null ? "" : tailAfter(subject, false);
  let title = subject;
  let resolved = null;
  if (bareOrdinal || subject === null || isVagueTail(tail)) {
    resolved = resolveSubject({ index: bareOrdinal ? index : ordinalAt(tail), state, picks, focused, loose: true });
    if (!resolved) return ["Which one? Nothing was offered and nothing is focused — name it and I describe it."];
    title = resolved.title;
  }
  if (resolved) {
    const direct = exactFact(title, { sessions, tasks, ideas, requests, collisions });
    if (direct) return [describeEntry(direct.kind, direct.item, now)];
    const where = { offer: "the pick on the table", quote: "what we were just talking about", focus: "the node you pointed me at", pick: "the top pick" }[resolved.via] ?? "the pick";
    return [`"${clip(title, 60)}" is ${where} — say "work on it" and I queue it.`];
  }
  const hit = matchFact(title ?? flat, { sessions, tasks, ideas, requests, collisions });
  return hit ? [describeEntry(hit.kind, hit.item, now)] : null;
}

export function localReply({ text = "", intent, facts = null, state = null, now = Date.now() } = {}) {
  const kind = INTENTS.includes(intent) ? intent : classifyIntent(text);
  const source = isObject(facts) ? facts : {};
  const list = (value) => (Array.isArray(value) ? value.filter(isObject) : null);
  const sessions = list(source.sessions);
  const collisions = list(source.collisions);
  const tasks = list(source.tasks);
  const ideas = list(source.ideas);
  const requests = list(source.requests);
  const executor = isObject(source.executor) ? source.executor : null;
  const log = list(source.log);
  const machine = isObject(source.machine) ? source.machine : null;
  const audit = isObject(source.audit) ? source.audit : null;
  const update = isObject(source.update) ? source.update : null;
  const current = isObject(state) ? state : null;
  // The node a tree click pointed at: named when a request or chat line matches
  // nothing else, and carried into the queued request as context by main.
  const focused = isObject(current?.focus) && current.focus.id ? current.focus : null;
  const focusLine = focused ? `Focused: ${focused.kind} "${clip(focused.label || focused.id, 40)}".` : null;
  // What the focused node's folder holds: the saved context rides the reply
  // when the exchange is about that node.
  const folderLines = asArray(source.focusFolder?.lines).filter((line) => typeof line === "string" && line);
  const folderLine =
    focused && folderLines.length ? `Folder: ${plural(num(source.focusFolder.count, folderLines.length), "note")} — ${folderLines[0]}.` : null;
  // Push memory: a compiled mini-index of typed cells, not a search the
  // reply has to remember to run. Chat and request intents carry it; a
  // superseded row sets Dig so acting on a stale title is not an option.
  const compiled =
    source.memory && Array.isArray(source.memory.primer)
      ? source.memory
      : compileMemory({
          query: `${text} ${focused?.label ?? ""}`,
          folders: current?.nodeFolders ?? null,
          lessons: asArray(current?.overseer?.lessons).map((row) => (isObject(row) ? row.text : row)),
          focus: focused,
          now,
          limit: 5,
        });
  const memoryLine =
    (kind === "chat" || kind === "request") && compiled.primer?.length
      ? `Memory: ${compiled.primer.slice(0, 3).join("; ")}${compiled.dig ? ". Dig: a remembered fact was superseded — check it before acting." : "."}`
      : null;
  const actions = [];
  const lines = [];
  // A resolved follow-up ("yes", "work on it") queues a different title than
  // the words the user typed; main builds the inbox request from this.
  let request = null;
  switch (kind) {
    case "status": {
      if (sessions) {
        const active = sessions.filter(isActiveFact);
        lines.push(`${plural(sessions.length, "session")} in the tree, ${active.length} active${active.length ? `: ${active.slice(0, 2).map(sessionLine).join(", ")}` : ""}.`);
      } else lines.push("Could not read the session store.");
      if (collisions) lines.push(collisions.length ? `${plural(collisions.length, "collision")}: ${collisions.slice(0, 2).map((entry) => basename(entry.file)).join(", ")}.` : "No collisions.");
      const missing = list(source.uncommitted);
      if (missing?.length) lines.push(`${plural(missing.length, "uncommitted feature")} not in HEAD: ${missing.slice(0, 2).map((row) => basename(row.file) || row.file).join(", ")}.`);
      if (tasks || ideas) {
        const bits = [];
        if (tasks) bits.push(plural(tasks.filter((task) => task.status === "open" || task.status === "active").length, "open task"));
        if (ideas) bits.push(plural(ideas.filter((idea) => !idea.read).length, "unread idea"));
        lines.push(`${bits.join(", ")}.`);
      }
      if (machine) {
        const running = asArray(machine.running).length;
        lines.push(machine.wait ? `Machine busy${running ? ` (${plural(running, "test process")})` : ""} — wait before starting a run.` : running ? `${plural(running, "test process")} running.` : "Machine quiet.");
      }
      if (audit) lines.push(num(audit.errors, 0) || num(audit.warnings, 0) ? `Audit: ${plural(num(audit.errors, 0), "error")}, ${plural(num(audit.warnings, 0), "warning")}.` : "Audit clean.");
      if (update?.phase === "held") lines.push(`Live update held${update.reason ? `: ${clip(update.reason, 80)}` : ""}.`);
      const executing = executorLine(executor, source.backlog);
      if (executing) lines.push(executing);
      const activity = activityLogLine(log ?? source.log, 3);
      if (activity) lines.push(activity);
      const work = asArray(current?.work ?? source.work).filter(isObject);
      if (work.length) lines.push(`Working on ${plural(work.length, "job")}: ${work.slice(0, 4).map(describeWork).join(", ")}${work.length > 4 ? ` +${work.length - 4} more` : ""}.`);
      const live = asArray(current?.agents).filter((row) => isObject(row) && (row.status === "running" || row.status === "queued"));
      if (live.length) lines.push(`Agents busy: ${live.slice(0, 5).map((row) => `${row.role} (${row.status})`).join(", ")}${live.length > 5 ? ` +${live.length - 5}` : ""}.`);
      const resumed = isObject(current?.resumed) ? current.resumed : null;
      if (resumed && asArray(resumed.jobs).length && now - num(resumed.at, 0) < 10 * MINUTE) lines.push(`Restarted ${plural(resumed.jobs.length, "interrupted job")} at boot.`);
      lines.push(serviceLine(current, now) + aiNote(current));
      break;
    }
    case "resume-work": {
      actions.push("resume-work");
      // The message being answered is the newest user message with this text; its
      // id keeps its own responder journal entry out of the "interrupted" list.
      const own = asArray(current?.messages).filter((message) => isObject(message) && message.role === "user" && message.text === text).pop();
      const items = describePending(pendingWork(current, now, { exclude: [text, own?.id] }));
      lines.push(items.length ? `Re-queuing ${plural(items.length, "job")} now: ${items.slice(0, 6).join(", ")}${items.length > 6 ? ` +${items.length - 6} more` : ""}.` : "Nothing is interrupted right now: no jobs in flight and no unanswered messages.");
      const resumed = isObject(current?.resumed) ? current.resumed : null;
      if (resumed) lines.push(asArray(resumed.jobs).length ? `Last boot restarted ${plural(resumed.jobs.length, "job")} after being closed for ${duration(resumed.closedForMs)}.` : "Last boot found nothing to restart.");
      break;
    }
    case "tasks": {
      if (!tasks) lines.push("Could not read the task board.");
      else {
        const open = tasks.filter((task) => task.status === "open" || task.status === "active");
        const done = tasks.filter((task) => task.status === "done").length;
        const archived = tasks.filter((task) => task.status === "archived").length;
        const finished = tasks
          .filter((task) => task.status === "done" || task.status === "archived")
          .sort((a, b) => num(b.doneAt ?? b.updatedAt, 0) - num(a.doneAt ?? a.updatedAt, 0));
        lines.push(`${plural(open.length, "open task")}${open.length ? `: ${open.slice(0, 5).map((task) => `"${titleOf(task)}"${task.status === "active" ? " (active)" : ""}`).join(", ")}` : ""}. ${done} done, ${archived} archived${finished.length ? ` — latest: ${finished.slice(0, 3).map((task) => `"${titleOf(task)}"`).join(", ")}` : ""}. The Done filter on the board lists them with a what-was-done digest.`);
      }
      if (sessions) {
        const todos = sessions.flatMap((session) => asArray(session.todos).filter(isObject));
        const pending = todos.filter((todo) => todo.status === "pending").length;
        const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
        lines.push(`Sessions carry ${plural(pending, "pending todo")} and ${inProgress} in progress.`);
      }
      const pick = suggestWork({ ...source, now })[0];
      if (pick) lines.push(`Top pick: "${pick.title}" (${pick.reason}) — say work on it and I queue it.`);
      break;
    }
    case "suggest": {
      const picks = suggestWork({ ...source, now });
      if (picks.length) {
        lines.push(`Best next work: ${picks.slice(0, 4).map((entry) => `"${entry.title}" (${entry.reason})`).join(", ")}.`);
        lines.push('Say "work on <title>" and I queue it to the inbox and send the roster out.');
      } else {
        lines.push("The board is clear: no open tasks, nothing in the request inbox, nothing stale.");
        lines.push("Name what you want built and it goes straight to the executor.");
      }
      if (executor?.enabled === false) lines.push("The executor is off, so queued work waits until it is switched back on.");
      break;
    }
    case "agents": {
      const roster = asArray(current?.agents).filter(isObject);
      if (!roster.length) {
        lines.push("The roster has not loaded yet.");
        break;
      }
      const live = roster.filter((row) => row.status === "running" || row.status === "queued");
      lines.push(`${plural(roster.length, "agent")} on the roster — ${live.length ? `live: ${live.map((row) => `${row.role} (${row.status})`).join(", ")}` : "all idle"}.`);
      const ran = roster
        .filter((row) => num(row.lastRunAt, 0) > 0)
        .sort((a, b) => num(b.lastRunAt, 0) - num(a.lastRunAt, 0))
        .slice(0, 4);
      if (ran.length)
        lines.push(
          `Latest runs: ${ran.map((row) => `${row.role} ${ago((now - num(row.lastRunAt, 0)) / MINUTE)}${row.status === "error" ? ` — ${clip(row.error || "failed", 40)}` : ""}`).join(", ")}.`,
        );
      const errored = roster.filter((row) => row.status === "error");
      if (errored.length) lines.push(`In error: ${errored.map((row) => `${row.role} — ${clip(row.error || "failed", 50)}`).join(", ")}.`);
      const fresh = roster.filter((row) => !num(row.lastRunAt, 0) && !num(row.runs, 0)).map((row) => row.role);
      if (fresh.length) lines.push(`Never run: ${fresh.join(", ")}.`);
      const intel = intelLines(current, now, { limit: 3 });
      if (intel.length) lines.push(`Reported home: ${intel.join("; ")}.`);
      const executing = executorLine(executor, source.backlog);
      if (executing) lines.push(executing);
      lines.push("A work instruction queues it and sends the roster out with it.");
      break;
    }
    case "ideas": {
      if (!ideas) lines.push("Could not read the ideas list.");
      else {
        const unread = ideas.filter((idea) => !idea.read);
        const accepted = ideas.filter((idea) => idea.status === "accepted").length;
        const done = ideas.filter((idea) => idea.status === "done").length;
        lines.push(`${plural(ideas.length, "idea")}, ${unread.length} unread${unread.length ? `: ${unread.slice(0, 3).map((idea) => `"${titleOf(idea)}"`).join(", ")}` : ""}. ${accepted} accepted, ${done} done.`);
      }
      break;
    }
    case "collisions": {
      if (!collisions) lines.push("Could not read the collision list.");
      else if (!collisions.length) lines.push("No file collisions in the last hour.");
      else {
        lines.push(`${plural(collisions.length, "collision")} in the last hour: ${collisions.slice(0, 3).map((entry) => {
          const n = collisionFiles(entry).length;
          const extra = n > 1 ? ` +${n - 1} more` : "";
          return `${basename(entry.file)}${extra} (${plural(asArray(entry.sessions).length, "session")}${str(entry.owner) ? `, owner ${str(entry.owner)}` : ""})`;
        }).join(", ")}.`);
        lines.push("Check the recent diffs before both sessions keep editing.");
      }
      const live = asArray(source.presence).filter((row) => isObject(row) && (asArray(row.editors).length || asArray(row.sessions).length));
      if (live.length) {
        lines.push(
          `Live editors: ${live
            .slice(0, 4)
            .map((row) => `${basename(row.file)} (${(asArray(row.editors).length ? asArray(row.editors) : asArray(row.sessions)).map((entry) => (isObject(entry) ? entry.sessionId : entry)).filter(Boolean).join(", ")})`)
            .join("; ")}.`
        );
      }
      const missing = asArray(source.uncommitted).filter((row) => isObject(row) && str(row.file));
      if (missing.length) {
        lines.push(
          `Uncommitted-only (not in HEAD): ${missing
            .slice(0, 3)
            .map((row) => basename(row.file) || row.file)
            .join(", ")}.`
        );
      }
      break;
    }
    case "machine": {
      if (!machine) lines.push("Could not read the machine state.");
      else {
        const running = asArray(machine.running).filter(isObject);
        const summary = asArray(machine.lines).filter((line) => typeof line === "string" && line).join(" · ");
        if (summary) lines.push(`${summary}.`);
        if (running.length) lines.push(`${plural(running.length, "test process")} running: ${running.slice(0, 3).map((row) => `pid ${row.pid} ${str(row.status, "?")} (${Math.round(num(row.ageMinutes, 0))}m)`).join(", ")}.`);
        else if (!summary) lines.push("No test processes running.");
        if (machine.wait) lines.push("Wait before starting another test run.");
      }
      break;
    }
    case "compact": {
      actions.push("compact");
      lines.push("Reviewing the task board and request inbox for duplicate or already represented work. Eligible tasks and requests share one ranked queue; dispatch is requested when new workers are enabled.");
      const executing = executorLine(executor, source.backlog);
      if (executing) lines.push(executing);
      break;
    }
    case "tidy": {
      actions.push("tidy");
      const hours = num(current?.prefs?.tidyDoneAfterHours, DEFAULT_PREFS.tidyDoneAfterHours);
      const last = str(current?.housekeeping?.lastText);
      lines.push(`Running a tidy pass now: done tasks older than ${hours} h are archived, saved ideas kept, resolved audit and collision requests cleared, old checkpoints dropped.`);
      lines.push(`Last pass: ${last || "none yet"}.`);
      break;
    }
    case "fix": {
      actions.push("fix");
      const problems = asArray(current?.problems).filter(isObject);
      const owners = [...new Set(problems.map((problem) => PROBLEM_ROLES[str(problem.kind)]).filter(Boolean))];
      lines.push("Running a fix pass now: data files, model catalog, held updates.");
      if (problems.length) {
        lines.push(`Open problems (${problems.length}): ${problems.slice(0, 3).map((problem) => clip(problem.text || problem.kind, 80)).join("; ")}.`);
        if (owners.length) lines.push(`Dispatching ${owners.join(", ")} to resolve them.`);
      } else lines.push("No open problems right now.");
      break;
    }
    case "organize": {
      actions.push("organize");
      const organization = isObject(current?.organization) ? current.organization : null;
      const counts = organization && num(organization.updatedAt, 0) && isObject(organization.counts) ? organization.counts : null;
      const policy = normalizePolicy(organization?.policy);
      lines.push("Reorganising the tree now.");
      if (counts) lines.push(`${plural(num(counts.sessions, 0), "session")}: ${num(counts.active, 0)} active, ${num(counts.stale, 0)} stale, ${num(counts.folded, 0)} folded (${plural(num(counts.hiddenTodos, 0), "todo")} hidden in the cluster).`);
      else if (sessions) lines.push(`${plural(sessions.length, "session")} in the tree, ${sessions.filter(isActiveFact).length} active; no pass has run yet.`);
      lines.push(`Finished sessions fold after ${policy.foldAfterMinutes} min; pending work untouched for ${policy.staleAfterHours} h goes stale.`);
      break;
    }
    case "overseer": {
      actions.push("overseer");
      const overseer = isObject(current?.overseer) ? current.overseer : null;
      const reviews = Math.floor(num(overseer?.reviews, 0));
      if (!reviews)
        lines.push("Asking the overseer for its first review now — it scores my recent work, tunes the roster prefs inside safe bounds, files upgrade requests and keeps a playbook it sharpens every pass.");
      else
        lines.push(
          `Running review #${reviews + 1} now. Last (${ago((now - num(overseer.lastReviewAt, 0)) / MINUTE)}): ${overseer.lastSummary || "no summary"} · score ${overseer.score ?? "?"} · ${plural(asArray(overseer.lessons).length, "lesson")} in the playbook.`,
        );
      break;
    }
    case "pause": {
      if (current?.status === "paused") lines.push("The service is already paused. Say resume to start the ticks again.");
      else {
        actions.push("pause");
        lines.push("Pausing the service: no ticks, tidying or briefs until you say resume. Messages still get answered.");
      }
      break;
    }
    case "resume": {
      if (current && current.status !== "paused") lines.push(`The service is already running. ${serviceLine(current, now)}`);
      else {
        actions.push("resume");
        lines.push("Resuming the service — a tick runs right away.");
      }
      break;
    }
    case "help": {
      lines.push("Ask me about: status, tasks, ideas, collisions, machine, agents, the log.");
      lines.push('Ask "what should I work on" and I pick from the board, the request inbox and quiet sessions.');
      lines.push("I can tidy, fix, organize, pause, resume, and resume the work — and clear the queue when the backlog needs collapsing.");
      lines.push("The overseer sits above me — ask it to review the workflow and it scores my work, tunes prefs and files upgrades.");
      lines.push("My agents: overseer, watcher, machine, auditor, keeper, thinker, briefer, improver, grower, ideas, reference — an instruction queues it to the request inbox and sends the whole roster out.");
      break;
    }
    case "log": {
      const activity = activityLogLine(log ?? source.log, 6);
      lines.push(activity || "The activity log is empty so far.");
      const feedLog = asArray(executor?.history).filter((entry) => isObject(entry) && str(entry.text));
      if (feedLog.length) lines.push(`Builder feed: ${feedLog.slice(0, 4).map((entry) => clip(str(entry.text), 70)).join("; ")}.`);
      const executing = executorLine(executor, source.backlog);
      if (executing) lines.push(executing);
      const live = current?.thinking?.text ? clip(str(current.thinking.text), 80) : null;
      if (live) lines.push(`Thinking: ${live}.`);
      const pick = suggestWork({ ...source, now })[0];
      if (pick) lines.push(`Could work on "${pick.title}" (${pick.reason}) — say work on it and I queue it.`);
      break;
    }
    case "request": {
      // A vague instruction ("work on it", "do that", "the second one") has no
      // subject of its own: queueing those words would build nothing, so the
      // follow-up is resolved to something real before it is queued at all.
      const flat = normalizeText(text);
      const vague = vagueSubject(flat);
      const tail = tailAfter(flat, true);
      const resolved = vague.vague && tail !== "" ? resolveSubject({ index: vague.index, state: current, picks: suggestWork({ ...source, now }), focused, loose: true }) : null;
      if (vague.vague && tail !== "" && !resolved) {
        lines.push("Work on what, exactly? Nothing was offered, nothing is focused and the board has no clear pick — name it and I queue it.");
        break;
      }
      if (!resolved && !keywords(tail).size) {
        // Nothing in the message actually names work — "test test", "do do",
        // "check this out": a bare verb chain is chatter, not an instruction.
        // Read it, offer, and let a yes queue the quoted title through the
        // normal follow-up path instead of guessing a pick to start.
        lines.push(`That doesn't name anything to work on — it reads like chatter, not an instruction. Want me to queue "${clip(text, 60)}" anyway? Say yes and I will, or tell me what you actually meant.`);
        if (focusLine) lines.push(focusLine);
        if (folderLine) lines.push(folderLine);
        if (memoryLine) lines.push(memoryLine);
        break;
      }
      actions.push("queue-request", "agents");
      if (resolved) {
        request = { title: clip(resolved.title, 60), prompt: `Work on "${resolved.title}". Queued from the assistant chat — the user said "${clip(text, 140)}".` };
        const where = { offer: "the pick on the table", quote: "what we were just talking about", focus: "the node you pointed at", pick: "the top pick" }[resolved.via] ?? "the pick";
        lines.push(`On it — "${clip(resolved.title, 60)}" is ${where}, on the task board as the next piece of work and the roster goes out with it.`);
        lines.push(aiNote(current).trim());
      } else {
        const related = relatedFacts(text, { sessions, tasks, collisions, requests });
        lines.push(`Kept in the thread and put on the task board as the next piece of work: "${clip(text, 80)}". The roster goes out with it: watcher, machine, auditor, keeper, briefer, improver, grower, ideas, reference.`);
        lines.push(related.length ? `Related right now: ${related.join(" · ")}.` : (focusLine ?? "Nothing in the current sessions matches it yet."));
        if (folderLine) lines.push(folderLine);
        if (memoryLine) lines.push(memoryLine);
        lines.push(aiNote(current).trim());
      }
      break;
    }
    case "builder": {
      // The Auto Builder feed, read back in words: what is building, what is
      // waiting, why dispatch is held, and what the feed log has been saying.
      // A cleaning ask rides the same intent and ends in a compactor pass —
      // duplicates collapse, board-absorbed asks fold away, the foreman gets
      // the next pick.
      const cleans = /\b(clean|cleanup|clear|tidy|dedupe|drain|fix|manage|sort|shrink|trim|prune)\b/.test(normalizeText(text));
      if (!executor) {
        lines.push("Could not read the Auto Builder state.");
        break;
      }
      lines.push(executorLine(executor, source.backlog));
      const feedLog = asArray(executor.history).filter((entry) => isObject(entry) && str(entry.text));
      if (feedLog.length) lines.push(`Feed log: ${feedLog.slice(0, 4).map((entry) => clip(str(entry.text), 70)).join("; ")}.`);
      if (cleans) {
        actions.push("compact");
        lines.push("Reviewing duplicate and already represented work now. This requests a dispatch check; it does not confirm that a worker has started.");
      } else {
        lines.push('The Live work panel shows confirmed worker starts. Say "clean up the builder" to review the queue.');
      }
      break;
    }
    default: {
      const flat = normalizeText(text);
      if (GREETING.test(flat)) {
        // Small talk: greet, report the lay of the land, offer real next work.
        lines.push("Hello.");
        lines.push(compactStatus({ sessions, collisions, tasks, ideas }));
        if (focusLine) lines.push(focusLine);
        const picks = suggestWork({ ...source, now });
        lines.push(
          picks.length
            ? `Could work on: ${picks.slice(0, 3).map((entry) => `"${entry.title}"`).join(", ")} — say work on one or name your own.`
            : "The board is clear — name something to build.",
        );
        // A greeting still answers the click: the node the user pointed the
        // assistant at is what they are most likely about to ask about.
        if (focusLine) lines.push(focusLine);
        if (folderLine) lines.push(folderLine);
        if (memoryLine) lines.push(memoryLine);
        lines.push("Say help for what I can answer directly.");
      } else if (IDENTITY.test(flat)) {
        lines.push("I'm the studio assistant — I watch the agents and sessions sharing this machine, tidy their work and queue yours to the executor.");
        lines.push(compactStatus({ sessions, collisions, tasks, ideas }));
        lines.push('Ask "what should I work on" for a pick, or help for the rest.');
      } else if (THANKS.test(flat)) {
        lines.push("Anytime.");
        lines.push(compactStatus({ sessions, collisions, tasks, ideas }));
      } else if (FAREWELL.test(flat)) {
        lines.push(
          current?.status === "paused"
            ? "See you — the service stays paused until you say resume."
            : "See you — the service keeps its cadence while you're away: ticks, tidy and the roster carry on.",
        );
      } else if (NEGATE.test(flat)) {
        lines.push('No problem — leaving it. Ask "what should I work on" whenever you want a pick.');
      } else if (AFFIRM.test(flat)) {
        // A bare yes only builds when the last reply actually offered work —
        // then it is the shortest possible "work on it".
        const offers = pendingOffers(current);
        if (offers.length) {
          const index = ordinalAt(flat) ?? 0;
          const title = pickAt(offers, index);
          if (title) {
            actions.push("queue-request", "agents");
            request = { title: clip(title, 60), prompt: `Work on "${title}". Queued from the assistant chat — the user confirmed with "${clip(text, 140)}".` };
            lines.push(`On it — "${clip(title, 60)}" is on the task board as the next piece of work and the roster is out with it.`);
            lines.push(aiNote(current).trim());
          } else {
            lines.push(`I only offered ${plural(offers.length, "pick")} — name one of those and I queue it.`);
          }
        } else {
          lines.push("Alright.");
          const picks = suggestWork({ ...source, now });
          lines.push(picks.length ? `Could work on "${picks[0].title}" — say the word.` : compactStatus({ sessions, collisions, tasks, ideas }));
        }
      } else {
        const described = describeAnswer(flat, { sessions, tasks, ideas, requests, collisions, focused, picks: suggestWork({ ...source, now }), state: current, now });
        if (described) lines.push(...described);
        else {
          const related = relatedFacts(text, { sessions, tasks, collisions, requests });
          lines.push("Kept in the thread.");
          lines.push(related.length ? `Related: ${related.join(" · ")}.` : (focusLine ?? compactStatus({ sessions, collisions, tasks, ideas })));
          if (folderLine) lines.push(folderLine);
          if (memoryLine) lines.push(memoryLine);
          lines.push(aiNote(current).trim());
          lines.push('Try "tell me about <something>" or "what should I work on" — say help for the full list.');
        }
      }
    }
  }
  return { text: clip(lines.filter(Boolean).join(" "), REPLY_MAX_CHARS), actions, request };
}

// 0, then 5, 10, 20, 40 minutes, capped at an hour.
export function nextBackoffMs(failures) {
  const count = Math.floor(num(failures, 0));
  if (count <= 0) return 0;
  return Math.min(60, 5 * 2 ** (count - 1)) * MINUTE;
}

const BUSY_TEXT = { audit: "auditing…", brief: "briefing…", fix: "fixing…", tidy: "tidying…", organize: "organising…", message: "replying…", tick: "ticking…" };

// The assistant node's label for the tree and the tray: relative times only.
export function summarizeForTree(state, now = Date.now()) {
  const label = "Assistant";
  if (!isObject(state)) return { label, sublabel: "no state", tone: "offline", pulse: false };
  if (state.status === "paused") return { label, sublabel: "paused", tone: "paused", pulse: false };
  const working = asArray(state.agents).filter((row) => isObject(row) && row.status === "running");
  if (working.length >= 2) return { label, sublabel: `${working.length} agents working`, tone: "busy", pulse: true };
  if (working.length === 1) return { label, sublabel: `${ROLE_VERBS[working[0].role] ?? working[0].role}…`, tone: "busy", pulse: true };
  const action = isObject(state.action) ? state.action : {};
  if (BUSY_TEXT[action.kind]) return { label, sublabel: BUSY_TEXT[action.kind], tone: "busy", pulse: true };
  const pulse = now - num(state.heartbeatAt, 0) < 5000;
  const housekeeping = isObject(state.housekeeping) ? state.housekeeping : {};
  const tidied = ["tasksArchived", "ideasPruned", "requestsCleared", "checkpointsDropped", "foldersCleaned"].reduce((sum, key) => sum + num(housekeeping[key], 0), 0);
  if (tidied > 0 && now - num(housekeeping.lastAt, 0) < 2 * MINUTE) return { label, sublabel: `tidied ${plural(tidied, "item")}`, tone: "ok", pulse: true };
  const ai = isObject(state.ai) ? state.ai : {};
  if (ai.keyPresent && !ai.online && typeof ai.lastError === "string" && ai.lastError) {
    return { label, sublabel: `AI offline · ${clip(ai.lastError.split("\n")[0], 40)}`, tone: "offline", pulse };
  }
  const problems = asArray(state.problems).filter(isObject);
  if (problems.length) return { label, sublabel: `${plural(problems.length, "problem")} · ${problems[0].kind}`, tone: "warn", pulse };
  const focus = normalizeFocus(state.focus);
  if (focus) return { label, sublabel: `focused on ${clip(focus.label || focus.id, 40)}`, tone: "ok", pulse };
  if (!ai.keyPresent) return { label, sublabel: "AI offline · no key", tone: "offline", pulse };
  const next = num(state.nextTickAt, 0);
  return { label, sublabel: `running · next ${next ? relative(next - now) : "soon"}`, tone: "ok", pulse };
}

// The facts shape localReply reads, from the raw store rows. main.cjs builds
// the same shape (each source guarded, null when unreadable); the CLI uses it.
export function buildFacts({ sessions = null, todos = null, collisions = null, presence = null, uncommitted = null, tasks = null, ideas = null, requests = null, executor = null, backlog = null, machine = null, audit = null, briefing = null, update = null, work = null, resumed = null, focus = null, nodeFolders = null, lessons = null, log = null, query = "", now = Date.now() } = {}) {
  const todoRows = asArray(todos).filter((todo) => isObject(todo) && typeof todo.sessionId === "string");
  const focusRow = normalizeFocus(focus);
  const folderKey = focusRow ? nodeKeyOf(focusRow) : null;
  const folder = folderKey && isObject(nodeFolders) ? nodeFolders[folderKey] : null;
  const compiled = compileMemory({
    query: query || focusRow?.label || "",
    folders: nodeFolders,
    lessons,
    focus: focusRow,
    now,
    limit: 6,
  });
  return {
    focus: focusRow,
    focusFolder: folder
      ? { key: folderKey, count: asArray(folder.entries).filter(isObject).length, lines: nodeFolderLines(nodeFolders, folderKey, { limit: 4, now }) }
      : null,
    memory: compiled.primer.length ? { primer: compiled.primer, flags: compiled.flags, dig: compiled.dig } : null,
    sessions: Array.isArray(sessions)
      ? sessions
          .filter((session) => isObject(session) && typeof session.id === "string" && !session.parentId && num(session.timeUpdated, 0) > now - RAIL_WINDOW_MS)
          .sort(byNewest)
          .slice(0, 12)
          .map((session) => ({
            id: session.id,
            title: str(session.title) || session.id,
            agent: str(session.agent),
            updatedMinutesAgo: Math.round((now - num(session.timeUpdated, 0)) / MINUTE),
            todos: todoRows
              .filter((todo) => todo.sessionId === session.id)
              .slice(0, DEFAULT_POLICY.maxTodosPerSession)
              .map((todo) => ({ content: str(todo.content), status: str(todo.status, "pending") })),
          }))
      : null,
    collisions: Array.isArray(collisions)
      ? collisions.filter(isObject).map((entry) => {
          const sessions = asArray(entry.sessions).map(sessionRow).filter(Boolean);
          return {
            file: str(entry.file),
            files: uniqueStrings(collisionFiles(entry)),
            owner: str(entry.owner) || null,
            active: entry.active === true,
            collaborating: entry.collaborating === true,
            activeSessions: uniqueStrings(
              asArray(entry.activeSessions).length
                ? asArray(entry.activeSessions)
                : sessions.filter((row) => row.active).map((row) => row.sessionId)
            ),
            ownership: ownershipRows(entry),
            handoff:
              entry.handoff === true ||
              Boolean(str(entry.owner) && sessions.some((row) => row.sessionId === str(entry.owner) && row.active === false)),
            sessions,
          };
        })
      : null,
    presence: Array.isArray(presence)
      ? presence
          .filter(isObject)
          .map((row) => ({
            file: str(row.file),
            owner: str(row.owner) || null,
            colliding: row.colliding === true,
            editors: (asArray(row.editors).length ? asArray(row.editors) : asArray(row.sessions)).map(sessionRow).filter(Boolean),
          }))
          .filter((row) => row.file)
      : null,
    uncommitted: Array.isArray(uncommitted)
      ? uncommitted
          .filter(isObject)
          .map((row) => ({
            file: str(row.file),
            path: str(row.path),
            untracked: row.untracked === true,
            sessions: uniqueStrings(asArray(row.sessions)),
            titles: uniqueStrings(asArray(row.titles)),
            warning: str(row.warning),
          }))
          .filter((row) => row.file)
      : null,
    tasks: Array.isArray(tasks)
      ? tasks
          .filter(isObject)
          .slice(0, 40)
          .map((task) => ({
            id: str(task.id),
            title: str(task.title),
            status: str(task.status, "open"),
            source: str(task.source),
            createdAt: num(task.createdAt, 0),
            updatedAt: num(task.updatedAt, 0),
            nextRunAt: num(task.nextRunAt, 0),
            runFailures: Math.floor(num(task.runFailures, 0)),
          }))
      : null,
    requests: Array.isArray(requests)
      ? requests
          .filter(isObject)
          .slice(0, 40)
          .map((request) => ({ title: str(request.title) || clip(str(request.prompt), 60), source: str(request.source, "manual"), status: str(request.status), at: num(request.at, 0), pinned: Boolean(request.pin) }))
      : null,
    backlog: isObject(backlog) && isObject(backlog.counts) ? {
      counts: Object.fromEntries(["ready", "readyTasks", "readyRequests", "running", "review", "waiting", "blocked", "cooling", "done"].map((key) => [key, Math.max(0, Math.floor(num(backlog.counts[key], 0)))])),
      paused: backlog.paused === true, waiting: clip(str(backlog.waiting), 180) || null,
      totalTasks: Math.max(0, Math.floor(num(backlog.totalTasks, 0))), totalRequests: Math.max(0, Math.floor(num(backlog.totalRequests, 0))),
      next: asArray(backlog.next).filter(isObject).slice(0, 3).map((row) => ({ title: clip(str(row.title), 100), kind: str(row.kind) })),
    } : null,
    executor: isObject(executor)
      ? {
          enabled: bool(executor.enabled, true),
          waiting: str(executor.waiting) || null,
          queued: Math.floor(num(executor.queued, 0)),
          parallel: Math.max(1, Math.floor(num(executor.parallel, 1))),
          lastAsk: str(executor.lastAsk) || null,
          running: asArray(executor.running)
            .filter(isObject)
            .map((job) => ({ title: clip(str(job.title), 60), minutes: Math.round(num(job.minutes, 0)) })),
          history: asArray(executor.history)
            .filter(isObject)
            .slice(0, 8)
            .map((entry) => ({ kind: str(entry.kind), text: clip(str(entry.text), 90), at: num(entry.at, 0) })),
        }
      : null,
    ideas: Array.isArray(ideas) ? ideas.filter(isObject).map((idea) => ({ title: str(idea.title), status: str(idea.status, "new"), read: Boolean(idea.read) })) : null,
    machine: isObject(machine) ? machine : null,
    audit: isObject(audit) ? audit : null,
    briefing: isObject(briefing) ? briefing : null,
    update: isObject(update) ? update : null,
    work: asArray(work)
      .map((entry) => normalizeWorkEntry(entry, now))
      .filter(Boolean)
      .map(({ id, kind, role, text, taskId, sessionId, startedAt, attempts, status }) => ({ id, kind, role, text, taskId, sessionId, startedMinutesAgo: Math.round((now - startedAt) / MINUTE), attempts, status })),
    resumed: normalizeResumed(resumed),
    log: Array.isArray(log)
      ? activityLogRows(log, 12).map((entry) => ({ kind: str(entry.kind), text: clip(str(entry.text), 90), at: num(entry.at, 0) }))
      : null,
  };
}

// One fixture in, everything out: what the Python contract pins.
export function runFixture(fixture) {
  const source = isObject(fixture) ? fixture : {};
  const now = num(source.now, 0) || Date.now();
  const prefs = normalizePrefs({ ...DEFAULT_PREFS, ...(isObject(source.prefs) ? source.prefs : {}) });
  const loaded = normalizeState(source.state ?? null, now);
  loaded.prefs = normalizePrefs({ ...loaded.prefs, ...(isObject(source.prefs) ? source.prefs : {}) });
  loaded.pool = emptyPool(loaded.prefs);
  const due = dueRoles(loaded, now);
  const pending = pendingWork(source.state ?? null, now); // on the raw state, as the host does at boot
  const afterAgents = asArray(source.agentEvents).reduce((acc, event) => applyAgentEvent(acc, event), loaded);
  let state = asArray(source.workEvents).reduce((acc, event) => applyWork(acc, event, now), afterAgents);
  // Node context folders: entries land (and clear) the way the service does.
  state = asArray(source.nodeContext).reduce(
    (acc, entry) => (isObject(entry) && entry.clear ? clearNodeFolder(acc, entry.target ?? entry.key, now) : applyNodeContext(acc, entry, now)),
    state,
  );
  const organization = organize({ sessions: source.sessions, todos: source.todos, now, policy: policyFromPrefs(prefs, source.policy) });
  // The host's watcher keeps the organization on the state fresh and the
  // overseer digest reads it from there — mirror that before reviewing.
  state.organization = organization;
  const rescues = staleRescues({ sessions: source.sessions, todos: source.todos, policy: organization.policy, existing: source.requests, tasks: source.tasks, now });
  const cleaned = tidy({
    tasks: source.tasks,
    ideas: source.ideas,
    requests: source.requests,
    checkpoints: source.checkpoints,
    nodeFolders: state.nodeFolders,
    sessions: source.sessions,
    collisions: source.collisions,
    audit: source.audit,
    now,
    prefs,
  });
  const facts = isObject(source.facts) ? source.facts : buildFacts({ ...source, log: source.log ?? state.log, focus: state.focus, nodeFolders: state.nodeFolders, lessons: state.overseer?.lessons, work: state.work, resumed: state.resumed, now });
  const messages = asArray(source.messages).map((text) => String(text ?? ""));
  const intents = messages.map(classifyIntent);
  const replies = messages.map((text, index) => localReply({ text, intent: intents[index], facts, state, now }));
  const suggestions = suggestWork({ ...facts, now });
  const digest = overseerDigest(state, now);
  const review = overseerReview(digest, state.overseer);
  const overseer = {
    normalized: state.overseer,
    digest,
    review,
    merged: overseerMerge(state.overseer, review, now, { digest }),
    tune: overseerTune(state.prefs, isObject(source.overseerTune) ? source.overseerTune : {}),
  };
  return {
    now,
    organization,
    tidy: { report: cleaned.report, changed: cleaned.changed, tasks: cleaned.tasks, ideas: cleaned.ideas, requests: cleaned.requests, checkpoints: cleaned.checkpoints, nodeFolders: cleaned.nodeFolders },
    nodeFolders: state.nodeFolders,
    intents,
    replies,
    facts,
    suggestions,
    rescues,
    overseer,
    backoff: [0, 1, 2, 3, 4, 5].map(nextBackoffMs),
    dueRoles: due,
    dueRolesAfter: dueRoles(state, now),
    pendingWork: pending,
    resumeSummary: resumeSummary(pending),
    state,
    summary: summarizeForTree(state, now),
    collaboration: collaborate({
      work: { title: "Fix crafting.lua recipes", prompt: "merge uncommitted crafting.lua", file: "C:\\repo\\game\\crafting.lua" },
      collisions: source.collisions,
    }),
  };
}

function selfTestFixture() {
  const now = 1_800_000_000_000;
  const ses = (id, minutesAgo, extra = {}) => ({ id, parentId: null, title: `Session ${id}`, agent: "build", model: { id: "x" }, timeCreated: now - (minutesAgo + 60) * MINUTE, timeUpdated: now - minutesAgo * MINUTE, ...extra });
  const todo = (sessionId, content, status, position) => ({ sessionId, content, status, position });
  return {
    now,
    sessions: [
      ses("ses_active", 2),
      ses("ses_progress", 5 * 60),
      ses("ses_working", 3 * 60),
      ses("ses_stale", 30 * 60),
      ses("ses_done", 2 * 60),
      ses("ses_empty", 90),
      ses("ses_child", 1, { parentId: "ses_active" }),
      ses("ses_ancient", 20 * 24 * 60),
    ],
    todos: [
      todo("ses_active", "Wire the crafting bench", "pending", 0),
      todo("ses_progress", "Steam achievements audit", "in_progress", 0),
      todo("ses_working", "Draw the tide pool fish", "pending", 0),
      todo("ses_stale", "Rename the swamp biome", "in_progress", 0),
      todo("ses_done", "Polish the booklet", "completed", 0),
      todo("ses_done", "Ship the booklet", "cancelled", 1),
    ],
    tasks: [
      { id: "task_old_done", title: "Old finished task", prompt: "x", status: "done", createdAt: now - 3 * DAY, updatedAt: now - 30 * HOUR, logs: [{ at: now - 30 * HOUR, kind: "status", text: "done" }], ideas: [], refs: [] },
      { id: "task_fresh_done", title: "Fresh finished task", prompt: "x", status: "done", createdAt: now - DAY, updatedAt: now - 2 * HOUR, logs: [], ideas: [], refs: [] },
      { id: "task_open", title: "Crafting bench recipes", prompt: "x", status: "open", createdAt: now - 3 * DAY, updatedAt: now - 40 * HOUR, logs: [], ideas: [], refs: [] },
    ],
    ideas: [
      { id: "idea_accepted_old", title: "Accepted a while ago", status: "accepted", read: true, at: now - 30 * HOUR },
      { id: "idea_done_fresh", title: "Done just now", status: "done", read: true, updatedAt: now - HOUR, at: now - 3 * DAY },
      { id: "idea_new", title: "Glowing tide pools", status: "new", read: false, at: now - HOUR },
      { id: "idea_keep", title: "Keep this one", status: "keep", read: false, at: now - 5 * DAY },
    ],
    requests: [
      { title: "Audit: ipc", prompt: "A-Eyes auditor found a error: preload invokes \"x:y\" but main.cjs has no handler. Fix it.", area: "ipc", source: "audit", at: now - HOUR },
      { title: "Audit: dom", prompt: "A-Eyes auditor found a error: renderer looks up #gone but the template has no such id. Fix it.", area: "dom", source: "audit", at: now - HOUR },
      { title: "Resolve collision: crafting.lua", prompt: "A-Eyes collision: C:\\repo\\game\\crafting.lua is being edited by 2 sessions.", file: "C:\\repo\\game\\crafting.lua", sessions: ["ses_active", "ses_working"], source: "collision", at: now - HOUR },
      { title: "Resolve collision: old.lua", prompt: "A-Eyes collision: C:\\repo\\game\\old.lua is being edited by 2 sessions.", file: "C:\\repo\\game\\old.lua", sessions: ["ses_stale", "ses_done"], source: "collision", at: now - HOUR },
      { title: "Owner note", prompt: "Please keep the swamp tar torches.", source: "manual", at: now - 10 * DAY },
      { title: "Old chat", prompt: "add a night mode", source: "chat", at: now - 4 * DAY },
      { title: "Fix: dup", prompt: "A-Eyes warn alert: same thing.", source: "fix", at: now - 2 * HOUR },
      { title: "Fix: dup", prompt: "A-Eyes warn alert: same thing.", source: "fix", at: now - 3 * HOUR },
    ],
    checkpoints: {
      ses_active: [{ note: "keep me", at: now - HOUR, source: "x", files: [], png: null }],
      ses_gone_old: [{ note: "old", at: now - 20 * DAY, source: "x", files: [], png: null }, { note: "older", at: now - 21 * DAY, source: "x", files: [], png: null }],
      ses_gone_fresh: [{ note: "fresh", at: now - DAY, source: "x", files: [], png: null }],
      ses_working: Array.from({ length: 60 }, (_, index) => ({ note: `note ${index}`, at: now - index * HOUR, source: "x", files: [], png: null })),
    },
    collisions: [{ file: "C:\\repo\\game\\crafting.lua", owner: "ses_active", active: true, sessions: [{ sessionId: "ses_active", edits: 2, active: true }, { sessionId: "ses_working", edits: 1, active: true }] }],
    audit: { ok: false, errors: 1, warnings: 0, findings: [{ level: "error", area: "ipc", message: "preload invokes \"x:y\" but main.cjs has no handler" }] },
    machine: { wait: false, lines: ["no active test leases"], running: [] },
    executor: { enabled: true, running: [{ title: "Fix the ipc handler", minutes: 2 }], queued: 3, waiting: null },
    prefs: { tidyDoneAfterHours: 24 },
    overseerTune: { staleAfterHours: 200, parallel: 2, nonsense: 9, tidyDoneAfterHours: "x" },
    state: {
      status: "running",
      tickCount: 41,
      nextTickAt: now + 2 * MINUTE,
      heartbeatAt: now - 1000,
      ai: { keyPresent: false },
      junk: true,
      prefs: { parallel: 99, aiParallel: 0 },
      agents: [
        { role: "watcher", status: "running", since: now - 5000, lastRunAt: now - 10000, runs: 3 },
        { role: "machine", status: "done", lastRunAt: now - 119000, runs: 1, text: "no strays" },
        { role: "auditor", status: "queued", lastRunAt: now - HOUR },
        { role: "ghost", status: "running" },
      ],
      work: [
        { id: "job_improve", kind: "improve", payload: { focus: "explorer" }, text: "improve the explorer column", startedAt: now - 3 * HOUR, attempts: 1, status: "running", target: { kind: "session", id: "ses_active" }, targets: [{ kind: "session", id: "ses_active" }, "junk", { kind: "todo" }, { kind: "assistant", id: "__assistant__" }], progress: 0.5 },
        { id: "job_ref", kind: "reference", taskId: "task_open", payload: { text: "crafting bench" }, text: "gather for task \"Crafting bench recipes\"", startedAt: now - 3 * HOUR, status: "queued" },
        { id: "", kind: "junk" },
      ],
      messages: [
        { id: "m1", at: now - 4 * HOUR, role: "user", text: "status", intent: "status" },
        { id: "m2", at: now - 4 * HOUR + 1, role: "assistant", text: "6 sessions.", via: "local", intent: "status" },
        { id: "m3", at: now - 3 * HOUR, role: "user", text: "please check the swamp torches", intent: "request" },
      ],
      resumed: { at: now - DAY, jobs: ["improve"], closedForMs: 5 * MINUTE },
      overseer: {
        reviews: 2,
        lastReviewAt: now - 2 * HOUR,
        lastSummary: "fair · ai link failing",
        score: 72,
        health: "fair",
        findings: [{ severity: "warn", title: "AI link failing", detail: "earlier pass" }],
        lessons: [{ text: "AI link failing: 2 consecutive failure(s)", hits: 1, firstAt: now - DAY, lastAt: now - 2 * HOUR, source: "ai" }, "junk", { text: "" }],
        directives: [{ at: now - 2 * HOUR, kind: "pref", text: "aiParallel 2→1" }, { nope: true }],
        scores: [{ at: now - DAY, score: 80 }, { at: now - 2 * HOUR, score: 72 }, "junk"],
        digest: { logErrors: 0 },
      },
    },
    workEvents: [
      { id: "job_improve", done: true },
      { id: "job_ref", kind: "reference", text: "gather for task \"Crafting bench recipes\"", attempts: 2, status: "running", startedAt: now - 3 * HOUR },
      { id: "job_new", kind: "responder", text: "please check the swamp torches", startedAt: now },
      { id: "job_bad" },
    ],
    agentEvents: [
      { role: "watcher", status: "running", at: now + 1000, target: { kind: "session", id: "ses_active" }, targets: [{ kind: "session", id: "ses_active" }, { kind: "session", id: "ses_stale" }], progress: 0.5 },
      { role: "auditor", status: "queued", at: now + 1000 },
      { role: "auditor", status: "running", at: now + 2000, text: "auditing the wiring", target: { kind: "assistant", id: "__assistant__" }, targets: [{ kind: "assistant", id: "__assistant__" }], progress: null },
      { role: "watcher", status: "done", at: now + 2400, text: "6 sessions · 2 folded", target: null, targets: [{ kind: "session", id: "ses_active" }, { kind: "session", id: "ses_stale" }], progress: 1 },
      { role: "briefer", status: "error", at: now + 3000, error: "HTTP 429", ms: 900 },
      { role: "keeper", status: "running", at: now + 4000 },
    ],
    messages: [
      "Status?",
      "What's happening",
      "Any open tasks",
      "ideas!",
      "Collisions?",
      "is the machine busy",
      "clean up please",
      "Fix the problems",
      "organise the tree",
      "pause",
      "resume",
      "help",
      "Add a night mode to the booklet",
      "Update the README for the crafting bench",
      "how are you today",
      "restart the interrupted work",
      "Resume the work!",
      "pick up where you left off",
      "what are you working on?",
      "Work on the upgrade this app so that the agent task I made",
      "Continue working on existing tasks using sub agents until done",
      "oversee the assistant",
      "hello",
      "tell me about the swamp torches",
      "what should I work on",
      "what are the agents doing",
    ],
  };
}

function selfTest() {
  const result = runFixture(selfTestFixture());
  const failures = [];
  const expect = (condition, label) => {
    if (!condition) failures.push(label);
  };
  const org = result.organization;
  expect(JSON.stringify(org.active) === JSON.stringify(["ses_active", "ses_progress"]), `active ${JSON.stringify(org.active)}`);
  expect(JSON.stringify(org.folded) === JSON.stringify(["ses_empty", "ses_done"]), `folded ${JSON.stringify(org.folded)}`);
  expect(JSON.stringify(org.stale) === JSON.stringify(["ses_stale"]), `stale ${JSON.stringify(org.stale)}`);
  expect(JSON.stringify(org.order) === JSON.stringify(["ses_active", "ses_progress", "ses_working", "ses_stale"]), `order ${JSON.stringify(org.order)}`);
  expect(org.counts.sessions === 6 && org.counts.hiddenTodos === 2, `counts ${JSON.stringify(org.counts)}`);
  expect(org.staleQuietMin === 30 * 60, `staleQuietMin ${org.staleQuietMin}`);
  const report = result.tidy.report;
  expect(report.tasksArchived === 1 && result.tidy.tasks[0].status === "archived" && result.tidy.tasks[1].status === "done", `tasks ${JSON.stringify(report)}`);
  expect(report.ideasPruned === 0 && result.tidy.ideas.length === 4, `ideas ${JSON.stringify(report)}`);
  expect(report.requestsCleared === 3 && result.tidy.requests.length === 5, `requests ${JSON.stringify(report)} ${result.tidy.requests.length}`);
  expect(result.tidy.requests.some((request) => request.source === "manual"), "manual request kept");
  expect(report.checkpointsDropped === 12 && !result.tidy.checkpoints.ses_gone_old && result.tidy.checkpoints.ses_working.length === 50, `checkpoints ${JSON.stringify(report)}`);
  expect(result.tidy.changed === true, "changed");
  const again = tidy({ ...result.tidy, sessions: selfTestFixture().sessions, collisions: selfTestFixture().collisions, audit: selfTestFixture().audit, now: result.now });
  expect(again.changed === false && again.report.text === "nothing to tidy", `idempotent ${JSON.stringify(again.report)}`);
  const wanted = ["status", "status", "tasks", "ideas", "collisions", "machine", "tidy", "fix", "organize", "pause", "resume", "help", "request", "request", "chat", "resume-work", "resume-work", "resume-work", "status", "request", "request", "overseer", "chat", "chat", "suggest", "agents"];
  expect(JSON.stringify(result.intents) === JSON.stringify(wanted), `intents ${JSON.stringify(result.intents)}`);
  const reply = (index) => result.replies[index].text;
  expect(reply(0).includes("6 sessions") && reply(0).includes("1 collision") && reply(0).includes("tick 41"), `status reply: ${reply(0)}`);
  expect(reply(0).includes('Building now (1/1 worker slots): "Fix the ipc handler"'), `status names the executor job: ${reply(0)}`);
  expect(reply(12).includes("put on the task board") && result.replies[12].actions.includes("queue-request"), `request reply: ${reply(12)}`);
  expect(reply(13).includes("Crafting bench recipes") || reply(13).includes("crafting.lua"), `related facts: ${reply(13)}`);
  expect(reply(11).includes("tidy") && reply(11).includes("pause"), `help reply: ${reply(11)}`);
  expect(reply(22).includes("Hello") && reply(22).includes("Say help"), `a greeting gets status plus a pick, not boilerplate: ${reply(22)}`);
  expect(reply(23).includes("Session ses_stale") && reply(23).includes("Rename the swamp biome"), `plain chat describes the focus instead of shrugging: ${reply(23)}`);
  expect(reply(24).includes("crafting.lua") && result.replies[24].actions.length === 0, `suggest reply names the top pick and dispatches nothing: ${reply(24)}`);
  expect(reply(25).includes("briefer") && reply(25).includes("HTTP 429") && result.replies[25].actions.length === 0, `agents reply reports the roster: ${reply(25)}`);
  expect(result.suggestions[0]?.kind === "collision" && result.suggestions[0]?.title === "crafting.lua", `suggestions ranked ${JSON.stringify(result.suggestions)}`);
  expect(result.replies.every((entry) => entry.text.length <= REPLY_MAX_CHARS && entry.text.length > 0), "reply lengths");
  expect(JSON.stringify(result.backoff) === JSON.stringify([0, 300000, 600000, 1200000, 2400000, 3600000]), `backoff ${JSON.stringify(result.backoff)}`);
  expect(result.state.tickCount === 41 && result.state.junk === undefined && result.state.ai.model === ASSISTANT_MODEL, "normalizeState");
  const weak = localReply({ text: "test test", intent: "request", facts: selfTestFixture(), state: normalizeState(selfTestFixture().state, result.now), now: result.now });
  expect(weak.actions.length === 0 && weak.text.includes('"test test"') && /say yes/i.test(weak.text), `a bare verb chain offers before it queues: ${weak.text}`);
  const yes = localReply({ text: "yes", intent: "chat", facts: selfTestFixture(), state: { ...normalizeState(selfTestFixture().state, result.now), messages: [{ role: "assistant", text: weak.text, at: result.now }] }, now: result.now });
  expect(yes.actions.includes("queue-request") && yes.request?.title === "test test", `yes queues the offered title: ${yes.text}`);
  const loaded = normalizeState(selfTestFixture().state, result.now);
  expect(loaded.agents.map((row) => row.role).join(",") === AGENT_ROLES.map((entry) => entry.role).join(","), "roster order and completeness");
  expect(loaded.agents[0].status === "idle" && loaded.agents[2].status === "idle" && loaded.agents[0].runs === 3, "stale running/queued rows become idle");
  expect(loaded.prefs.parallel === PARALLEL_MAX && loaded.prefs.aiParallel === 1 && loaded.pool.parallel === PARALLEL_MAX && loaded.pool.running === 0, `pool prefs ${JSON.stringify(loaded.pool)}`);
  expect(JSON.stringify(result.dueRoles) === JSON.stringify(["machine", "auditor", "keeper", "compactor", "foreman", "thinker", "overseer"]), `dueRoles ${JSON.stringify(result.dueRoles)}`);
  const collisionDue = dueRoles({ ...loaded, problems: [{ kind: "collision", since: result.now, text: "crafting.lua" }] }, result.now);
  expect(collisionDue[0] === "watcher" && collisionDue.includes("machine"), `open problems pull their owner due ${JSON.stringify(collisionDue)}`);
  const alreadyTried = dueRoles({ ...loaded, problems: [{ kind: "collision", since: result.now - HOUR, text: "crafting.lua" }] }, result.now);
  expect(!alreadyTried.includes("watcher"), "a problem the watcher already ran against does not jump the cadence");
  const keyed = { ...loaded, ai: { ...loaded.ai, keyPresent: true, backoffUntil: 0 } };
  expect(dueRoles(keyed, result.now).includes("briefer") && !dueRoles(keyed, result.now, { proactive: false }).includes("briefer") && !dueRoles({ ...keyed, ai: { ...keyed.ai, backoffUntil: result.now + MINUTE } }, result.now).includes("briefer"), "briefer gating");
  expect(dueRoles(keyed, result.now).includes("thinker") && !dueRoles(keyed, result.now, { proactive: false }).includes("thinker"), "thinker waits for proactive, keyless");
  expect(dueRoles(keyed, result.now, { proactive: false }).includes("overseer"), "the overseer runs 24/7 — proactive off never holds it");
  const after = result.state;
  const row = (role) => after.agents.find((entry) => entry.role === role);
  expect(after.pool.running === 2 && after.pool.queued === 0 && after.action.text === "auditing · tidying" && after.action.since === result.now + 2000, `pool after events ${JSON.stringify(after.pool)} ${JSON.stringify(after.action)}`);
  expect(row("watcher").status === "done" && row("watcher").runs === 4 && row("watcher").lastMs === 1400 && row("watcher").lastRunAt === result.now + 1000, `watcher row ${JSON.stringify(row("watcher"))}`);
  expect(row("briefer").status === "error" && row("briefer").error === "HTTP 429" && row("briefer").lastMs === 900 && row("briefer").runs === 1, `briefer row ${JSON.stringify(row("briefer"))}`);
  expect(result.summary.sublabel === "2 agents working" && result.summary.tone === "busy" && result.summary.pulse === true, `summary ${JSON.stringify(result.summary)}`);
  const one = applyAgentEvent(after, { role: "keeper", status: "done", at: result.now + 5000 });
  expect(one.pool.running === 1 && one.action.text === "auditing" && summarizeForTree(one, result.now).sublabel === "auditing…", `one running ${JSON.stringify(one.action)}`);
  const none = applyAgentEvent(one, { role: "auditor", status: "done", at: result.now + 6000, text: "1 error" });
  expect(none.pool.running === 0 && none.action.kind === "idle" && summarizeForTree(none, result.now).sublabel === "AI offline · no key", `idle again ${JSON.stringify(none.action)}`);
  expect(applyAgentEvent(none, { role: "ghost", status: "running", at: 1 }) === none && applyAgentEvent(none, { role: "watcher", status: "weird", at: 1 }) === none, "unknown role or status is ignored");
  expect(JSON.stringify(result.dueRolesAfter) === JSON.stringify(["machine", "compactor", "foreman", "thinker", "overseer"]), `dueRolesAfter (watcher just started, auditor/keeper live) ${JSON.stringify(result.dueRolesAfter)}`);
  // the compactor: duplicates collapse, requests already on the board are
  // absorbed, expired backoffs are unparked, live claims survive untouched
  {
    const hour = 60 * MINUTE;
    const at = result.now;
    const compacted = compact({
      now: at,
      tasks: [
        { id: "t1", title: "Wire the ideas panel", status: "open", logs: [{ at }], createdAt: at - hour },
        { id: "t2", title: "wire the ideas panel.", status: "open", createdAt: at },
        { id: "t3", title: "Held job", status: "active", runId: "run_1" },
        { id: "t4", title: "Held job", status: "open", createdAt: at },
        { id: "t5", title: "Parked", status: "open", nextRunAt: at - MINUTE },
        { id: "t6", title: "Burnt out", status: "open", runFailures: 5, updatedAt: at - 7 * hour },
        { id: "t7", title: "Still cooling", status: "open", nextRunAt: at + MINUTE },
        { id: "t8", title: "Old news", status: "done" },
      ],
      requests: [
        { title: "Wire the ideas panel", prompt: "a", at },
        { title: "Something new", prompt: "b", at },
        { title: "something new", prompt: "c", at },
        { title: "Running already", prompt: "d", at, status: "running" },
      ],
    });
    const ids = compacted.tasks.map((task) => task.id);
    expect(ids.includes("t1") && !ids.includes("t2"), `duplicate task collapses to the one with history ${JSON.stringify(ids)}`);
    expect(ids.includes("t3") && !ids.includes("t4"), "a task the executor holds always survives the collapse");
    expect(ids.includes("t8"), "a lone done task is kept, not treated as a live duplicate");
    expect(!compacted.tasks.find((task) => task.id === "t5").nextRunAt, "an elapsed backoff is cleared");
    expect(compacted.tasks.find((task) => task.id === "t7").nextRunAt === at + MINUTE, "a live backoff is left alone");
    const revived = compacted.tasks.find((task) => task.id === "t6");
    expect(revived.runFailures === 5, `an exhausted task waits for explicit retry ${JSON.stringify(revived)}`);
    const titles = compacted.requests.map((request) => request.title);
    expect(!titles.includes("Wire the ideas panel"), "a request already on the board is absorbed");
    expect(titles.filter((title) => title.toLowerCase() === "something new").length === 1, `duplicate requests collapse ${JSON.stringify(titles)}`);
    expect(titles.includes("Running already"), "a request in flight is never dropped");
    expect(compacted.report.duplicateTasks === 2 && compacted.report.absorbed === 1 && compacted.report.duplicateRequests === 1, `compact report ${JSON.stringify(compacted.report)}`);
    expect(compacted.report.revived === 0 && compacted.report.unblocked === 1, `revive/unblock ${JSON.stringify(compacted.report)}`);
    expect(compacted.requestsChanged && compacted.tasksChanged, "a pass that changed both stores says so");
    // the review: an unclaimed auto request expires (the filing pass re-files
    // it while the problem lasts), chat and manual asks never do, and the
    // report names the pick the executor would take next
    const reviewed = compact({
      now: at,
      tasks: [],
      requests: [
        { title: "Fix the stale audit row", prompt: "a", source: "audit", at: at - 13 * hour },
        { title: "Fix the fresh audit row", prompt: "b", source: "audit", at },
        { title: "The one asked for by hand", prompt: "c", source: "chat", at: at - 13 * hour },
        { title: "Owner request", prompt: "d", source: "manual", at: at - 13 * hour },
        { title: "Claimed already", prompt: "e", source: "audit", at: at - 13 * hour, status: "running" },
      ],
    });
    const reviewedTitles = reviewed.requests.map((request) => request.title);
    expect(!reviewedTitles.includes("Fix the stale audit row"), `an unclaimed auto request expires ${JSON.stringify(reviewedTitles)}`);
    expect(reviewedTitles.includes("Fix the fresh audit row") && reviewedTitles.includes("Owner request"), `fresh and manual requests survive ${JSON.stringify(reviewedTitles)}`);
    expect(reviewedTitles.includes("The one asked for by hand"), "a chat ask never expires in the compactor");
    expect(reviewedTitles.includes("Claimed already"), "a claim in flight never expires");
    expect(reviewed.report.stale === 1, `stale count ${JSON.stringify(reviewed.report)}`);
    expect(reviewed.report.reviewed?.queued === 3 && reviewed.report.reviewed?.next === "The one asked for by hand", `the review names the top pick ${JSON.stringify(reviewed.report.reviewed)}`);
    // the cap cuts lowest worth first, not whatever sat at the tail of the file
    const pile = compact({
      now: at,
      tasks: [],
      limits: { keepRequests: 3 },
      requests: [
        { title: "fresh chore", prompt: "1", source: "overseer", at },
        { title: "fresh chore 2", prompt: "2", source: "audit", at },
        { title: "fresh chore 3", prompt: "3", source: "fix", at },
        { title: "old hand ask", prompt: "4", source: "chat", at: at - 9 * hour },
      ],
    });
    const pileTitles = pile.requests.map((request) => request.title);
    expect(pileTitles.includes("old hand ask"), `worth beats position: the chat ask survives ${JSON.stringify(pileTitles)}`);
    expect(pileTitles.length === 4 && pile.report.trimmed === 0, `backlog requests survive admission caps ${JSON.stringify(pile.report)}`);
    // ideas fold into plans: the shared tag is the theme, promoted ideas stop
    // being loose, and a second pass has nothing left to do with them
    const idea = (id, title, tags, status) => ({ id, title, detail: `${title} detail`, tags, at, status: status ?? "new" });
    const withIdeas = compact({
      now: at,
      tasks: [],
      requests: [],
      ideas: [
        idea("i1", "Stat icon check", ["testing", "icons"]),
        idea("i2", "Biome seam check", ["testing", "worldgen"]),
        idea("i3", "Budget rows for checks", ["testing"]),
        idea("i4", "Stat icon check", ["testing"]),
        idea("i5", "Only two of these", ["ui"]),
        idea("i6", "Also ui", ["ui"]),
        idea("i7", "Already handled", ["testing"], "planned"),
      ],
    });
    const plans = withIdeas.tasks.filter((task) => String(task.id).startsWith("task_plan_"));
    expect(plans.length === 1 && plans[0].title.startsWith("Plan: testing"), `one plan for the shared tag ${JSON.stringify(plans.map((task) => task.title))}`);
    expect(withIdeas.report.duplicateIdeas === 1, `the repeated idea title collapses ${JSON.stringify(withIdeas.report)}`);
    expect(plans[0].ideas.length === 3 && plans[0].prompt.includes("Stat icon check"), `the plan names its ideas ${JSON.stringify(plans[0].ideas)}`);
    const promoted = withIdeas.ideas.filter((entry) => entry.status === "planned" && entry.taskId === plans[0].id);
    expect(promoted.length === 3, `promoted ideas carry the plan ${JSON.stringify(withIdeas.ideas.map((entry) => entry.status))}`);
    expect(withIdeas.ideas.find((entry) => entry.id === "i5").status === "new", "a tag under the threshold stays loose");
    expect(withIdeas.ideas.find((entry) => entry.id === "i7").taskId === undefined, "an idea already planned is not a candidate");
    expect(withIdeas.ideasChanged && withIdeas.tasksChanged, "planning changes both stores");
    const again = compact({ now: at, tasks: withIdeas.tasks, requests: [], ideas: withIdeas.ideas });
    expect(!again.report.planned, `a second pass re-plans nothing ${JSON.stringify(again.report)}`);
    // the assistant's own upkeep is capped, oldest kept, claimed ones untouchable
    const chore = (id, age, extra) => ({ id, title: `Overseer: chore ${id}`, status: "open", createdAt: at - age, ...extra });
    const capped = compact({
      now: at,
      requests: [],
      tasks: [
        chore("c1", 8 * MINUTE),
        chore("c2", 7 * MINUTE),
        chore("c3", 6 * MINUTE),
        chore("c4", 5 * MINUTE),
        chore("c5", 4 * MINUTE),
        chore("c6", 3 * MINUTE),
        chore("c7", 2 * MINUTE),
        chore("c8", MINUTE, { runId: "run_live" }),
        { id: "real", title: "Finish the terrain wiring", status: "open", createdAt: at },
      ],
      limits: { maxSelfMaintenance: 3 },
    });
    const keptIds = capped.tasks.map((task) => task.id);
    expect(capped.report.choresDropped === 0 && capped.tasks.length === 9, `overflow chores remain in the backlog ${JSON.stringify(capped.report)}`);
    expect(keptIds.includes("c1") && keptIds.includes("c2") && keptIds.includes("c3"), `the oldest chores stay ${JSON.stringify(keptIds)}`);
    expect(keptIds.includes("c8"), "a claimed chore is never shelved, cap or not");
    expect(keptIds.includes("real"), "app work is not upkeep and is never capped");
    expect(isSelfMaintenance({ title: "Overseer: x" }) && !isSelfMaintenance({ title: "Finish the mining pass" }), "self-maintenance is matched by title");
    // leftover inbox titles matching a finished task are absorbed, not re-run
    const finished = compact({
      now: at,
      tasks: [{ id: "d1", title: "Wire the constellation", status: "done", updatedAt: at }],
      requests: [
        { title: "Wire the constellation", prompt: "again", source: "overseer", at },
        { title: "Still needed", prompt: "b", source: "overseer", at },
      ],
    });
    expect(!finished.requests.some((request) => request.title === "Wire the constellation"), `a request for a done task is absorbed ${JSON.stringify(finished.requests)}`);
    expect(finished.report.absorbed === 1 && finished.requests.some((request) => request.title === "Still needed"), `only the finished title is absorbed ${JSON.stringify(finished.report)}`);
    const dupDone = compact({
      now: at,
      tasks: [
        { id: "d1", title: "Wire the constellation", status: "done", updatedAt: at - hour },
        { id: "d2", title: "wire the constellation.", status: "done", updatedAt: at },
        { id: "d3", title: "Wire the constellation", status: "archived", updatedAt: at - 2 * hour },
      ],
      requests: [],
    });
    expect(dupDone.tasks.length === 3, `separate manually finished records retain their history ${JSON.stringify(dupDone.tasks.map((task) => task.id))}`);
    const noStamp = compact({
      now: at,
      tasks: [],
      requests: [
        { title: "Resume: old session", prompt: "x", source: "overseer" },
        { title: "Fresh overseer", prompt: "y", source: "overseer", at },
      ],
    });
    expect(!noStamp.requests.some((request) => String(request.title).startsWith("Resume")), `an unstamped auto request expires ${JSON.stringify(noStamp.requests)}`);
    expect(noStamp.requests.some((request) => request.title === "Fresh overseer") && noStamp.report.stale === 1, `a stamped auto request survives ${JSON.stringify(noStamp.report)}`);
    const plansDup = compact({
      now: at,
      tasks: [
        { id: "p1", title: "Plan: catalog — 4 ideas", status: "open", ideas: ["a", "b", "c", "d"], createdAt: at - hour },
        { id: "p2", title: "Plan: catalog — 6 ideas", status: "open", ideas: ["a", "b", "c", "d", "e", "f"], logs: [{ at }, { at }], createdAt: at },
        { id: "p3", title: "Plan: world — 3 ideas", status: "open", ideas: ["x", "y", "z"], createdAt: at },
        { id: "p4", title: "Plan: catalog — 3 ideas", status: "open", ideas: ["g"], runId: "run_plan", createdAt: at },
      ],
      requests: [],
    });
    const planTitles = plansDup.tasks.map((task) => task.title);
    expect(planTitles.filter((title) => /^Plan: catalog/.test(title)).length === 2, `claimed catalog plan stays, unclaimed dupes collapse ${JSON.stringify(planTitles)}`);
    expect(planTitles.includes("Plan: world — 3 ideas"), "a unique plan theme is kept");
    const keptCatalog = plansDup.tasks.find((task) => task.id === "p2");
    expect(keptCatalog && keptCatalog.ideas.includes("a") && keptCatalog.ideas.includes("f"), `the surviving plan keeps its ideas ${JSON.stringify(keptCatalog?.ideas)}`);
    expect(plansDup.tasks.some((task) => task.id === "p4"), "a claimed plan is never collapsed");
    const clean = compact({ now: at, tasks: [{ id: "t1", title: "One", status: "open" }], requests: [] });
    expect(!clean.requestsChanged && !clean.tasksChanged && clean.report.runnable === 1, `a clean queue is left alone ${JSON.stringify(clean.report)}`);
    const cooling = compact({
      now: at,
      tasks: [],
      requests: [
        { title: "Cooling request", prompt: "x", source: "agent", at, nextRunAt: at + MINUTE, runFailures: 1 },
        { title: "Ready request", prompt: "y", source: "agent", at },
      ],
    });
    expect(cooling.report.runnable === 1 && cooling.report.reviewed?.next === "Ready request", `a request on backoff is not runnable ${JSON.stringify(cooling.report)}`);
    const pairDup = compact({
      now: at,
      tasks: [],
      requests: [
        { title: "Resolve collision: a.lua", prompt: "a", file: "C:/fixture/a.lua", files: ["C:/fixture/a.lua"], sessions: ["ses_a", "ses_b"], source: "collision", at: at - 1000 },
        { title: "Resolve collision: b.lua", prompt: "b", file: "C:/fixture/b.lua", files: ["C:/fixture/b.lua"], sessions: ["ses_b", "ses_a"], owner: "ses_a", source: "collision", at },
        { title: "Resolve collision: c.lua", prompt: "c", file: "C:/fixture/c.lua", sessions: ["ses_a", "ses_c"], source: "collision", at },
        { title: "Resolve collision: running.lua", prompt: "d", file: "C:/fixture/d.lua", sessions: ["ses_d", "ses_e"], source: "collision", at, status: "running" },
        { title: "Resolve collision: running-peer.lua", prompt: "e", file: "C:/fixture/e.lua", sessions: ["ses_e", "ses_d"], source: "collision", at },
      ],
    });
    const pairTitles = pairDup.requests.map((request) => request.title);
    expect(pairTitles.includes("Resolve collision: b.lua") && !pairTitles.includes("Resolve collision: a.lua"), `same session pair collapses to the newest ${JSON.stringify(pairTitles)}`);
    const keptPair = pairDup.requests.find((request) => request.title === "Resolve collision: b.lua");
    expect(keptPair && keptPair.files.includes("C:/fixture/a.lua") && keptPair.files.includes("C:/fixture/b.lua") && keptPair.owner === "ses_a", `collapsed pair merges files and keeps ownership ${JSON.stringify(keptPair)}`);
    expect(pairTitles.includes("Resolve collision: c.lua"), "a shared session on a different partner stays two requests");
    expect(pairTitles.includes("Resolve collision: running.lua") && !pairTitles.includes("Resolve collision: running-peer.lua"), `a running claim holds its session pair ${JSON.stringify(pairTitles)}`);
    const twoFixes = compact({
      now: at,
      tasks: [],
      requests: [
        { title: "Fix: Duplicate root-cause sessions", prompt: "redundant work streams", source: "fix", alertTitle: "Duplicate root-cause sessions", at: at - 1000 },
        { title: "Fix: Stalled duplicate-session triage", prompt: "same stalled-session root-cause", source: "fix", alertTitle: "Stalled duplicate-session triage", at },
      ],
    });
    expect(twoFixes.requests.length === 1 && twoFixes.report.duplicateRequests === 1, `disjoint-session same-theme fixes collapse ${JSON.stringify(twoFixes.requests.map((request) => request.title))}`);
    const themeDup = compact({
      now: at,
      tasks: [
        { id: "f1", title: "Fix: Duplicate root-cause sessions", status: "open", source: "a-eyes", createdAt: at - 1000 },
        { id: "f2", title: "Fix: Stalled duplicate-session triage", status: "open", source: "a-eyes", createdAt: at },
        { id: "f3", title: "Fix: Idle camera drift", status: "open", source: "a-eyes", createdAt: at },
        { id: "f4", title: "Fix: eyes.mjs subsystem overlap", status: "open", source: "a-eyes", runId: "run_fix", createdAt: at },
      ],
      requests: [
        { title: "Fix: Duplicate root-cause sessions", prompt: "Both address stalled/duplicate session root causes", source: "fix", alertTitle: "Duplicate root-cause sessions", at },
        { title: "Fix: Idle framing still drifting", prompt: "renderer/idle.js camera", source: "fix", alertTitle: "Idle framing still drifting", at },
      ],
    });
    expect(!themeDup.tasks.some((task) => task.id === "f1" || task.id === "f2"), "unclaimed same-theme Fix: tasks collapse behind a claimed one");
    expect(themeDup.tasks.some((task) => task.id === "f4") && themeDup.tasks.some((task) => task.id === "f3"), "a claimed dup-session fix and a different subsystem stay");
    expect(!themeDup.requests.some((request) => /duplicate root-cause/i.test(request.title)), "a board task holding the theme absorbs the matching Fix: request");
    expect(themeDup.requests.some((request) => request.title === "Fix: Idle framing still drifting"), "a different subsystem still queues");
    // leftover unclaimed idea-fold plans drop; claimed and fresh ones stay;
    // chat dumps and old notes do not mint a new plan; resolved collision
    // alerts drop when the live set is known.
    const leftover = compact({
      now: at,
      tasks: [
        { id: "oldplan", title: "Plan: catalog — 6 ideas", status: "open", source: "a-eyes", createdAt: at - 13 * hour, ideas: ["old1"] },
        { id: "freshplan", title: "Plan: ui — 3 ideas", status: "open", source: "a-eyes", createdAt: at, ideas: ["new1"] },
        { id: "heldplan", title: "Plan: worldgen — 3 ideas", status: "open", source: "a-eyes", createdAt: at - 13 * hour, runId: "run_1", ideas: ["held1"] },
        { id: "human", title: "Polish the dream mode", status: "open", createdAt: at - 13 * hour },
      ],
      ideas: [
        { id: "c1", title: "The queue shows both collisions", detail: "x", tags: ["queue"], at, status: "new", source: "chat" },
        { id: "c2", title: "Another chat dump", detail: "y", tags: ["queue"], at, status: "new", source: "chat" },
        { id: "c3", title: "Third chat dump", detail: "z", tags: ["queue"], at, status: "new", source: "chat" },
        { id: "oldai", title: "Old tar torch note", detail: "x", tags: ["catalog"], at: at - 13 * hour, status: "new", source: "ai" },
        { id: "oldai2", title: "Old catalog two", detail: "x", tags: ["catalog"], at: at - 13 * hour, status: "new", source: "ai" },
        { id: "oldai3", title: "Old catalog three", detail: "x", tags: ["catalog"], at: at - 13 * hour, status: "new", source: "ai" },
      ],
      requests: [],
    });
    const leftoverIds = leftover.tasks.map((task) => task.id);
    expect(leftoverIds.includes("oldplan"), `a waiting plan is durable ${JSON.stringify(leftoverIds)}`);
    expect(leftoverIds.includes("freshplan") && leftover.tasks.find((task) => task.id === "freshplan").status === "open", "a fresh plan stays open");
    expect(leftover.tasks.find((task) => task.id === "heldplan")?.status === "open", "a claimed plan is never dropped");
    expect(leftover.tasks.find((task) => task.id === "human")?.status === "open", "human work is not an idea-fold plan");
    expect(!leftover.tasks.some((task) => /^Plan: queue/.test(task.title)), `chat dumps do not mint a plan ${JSON.stringify(leftover.tasks.map((task) => task.title))}`);
    expect(leftover.report.plansDropped === 0, `plansDropped ${JSON.stringify(leftover.report)}`);
    const resolved = compact({
      now: at,
      collisions: [{ file: "C:/repo/live.lua", files: ["C:/repo/live.lua"], sessions: ["ses_a", "ses_b"] }],
      requests: [
        { title: "Resolve collision: live.lua", prompt: "a", file: "C:/repo/live.lua", files: ["C:/repo/live.lua"], sessions: ["ses_a", "ses_b"], source: "collision", at },
        { title: "Resolve collision: gone.lua", prompt: "b", file: "C:/repo/gone.lua", files: ["C:/repo/gone.lua"], sessions: ["ses_c", "ses_d"], source: "collision", at },
        { title: "Overseer: Resolve collision", prompt: "send the watcher", source: "overseer", at },
        { title: "Still needed", prompt: "c", source: "overseer", at },
      ],
      tasks: [],
    });
    const resolvedTitles = resolved.requests.map((request) => request.title);
    expect(resolvedTitles.includes("Resolve collision: live.lua") && !resolvedTitles.includes("Resolve collision: gone.lua"), `resolved collision alerts drop ${JSON.stringify(resolvedTitles)}`);
    expect(!resolvedTitles.includes("Overseer: Resolve collision") && resolvedTitles.includes("Still needed"), `a generic overseer collision chore drops when the live set is known ${JSON.stringify(resolvedTitles)}`);
  }
  {
    const heardFail = hearReport(emptyState(result.now), { role: "builder", ok: false, title: "Wire the executor", text: "failed \"Wire the executor\" · no MEFI_JOB_DONE", error: "no MEFI_JOB_DONE" }, result.now);
    expect(heardFail.wakeOverseer && heardFail.wakeForeman && heardFail.state.intel[0]?.role === "builder" && heardFail.state.intel[0]?.facts?.ok === false, `a failed builder wakes the overseer ${JSON.stringify(heardFail)}`);
    expect(heardFail.state.thinking?.role === "overseer" && /failed/.test(heardFail.reply), `the overseer thinks the failure through ${heardFail.reply}`);
    const heardOk = hearReport(heardFail.state, { role: "builder", ok: true, title: "Wire the executor", handed: 0 }, result.now + 1000);
    expect(!heardOk.wakeOverseer && heardOk.state.intel[0]?.facts?.ok === true, "a clean finish stays on the intel board");
    const heardHand = hearReport(emptyState(result.now), { role: "builder", ok: true, title: "Split the work", handed: 2 }, result.now);
    expect(!heardHand.wakeOverseer && heardHand.wakeForeman && /follow-up/.test(heardHand.reply), `a handoff wakes the foreman ${heardHand.reply}`);
    const digestFail = overseerDigest(heardFail.state, result.now);
    expect(digestFail.builders.fails === 1 && digestFail.builders.reports === 1, `digest counts builder fails ${JSON.stringify(digestFail.builders)}`);
    const reviewFail = overseerReview(digestFail);
    expect(reviewFail.findings.some((entry) => entry.title === "builders reporting failures"), `overseer names builder failures ${JSON.stringify(reviewFail.findings)}`);
    const talkFail = overseerTalk(reviewFail, { digest: digestFail });
    expect(talkFail.roles.includes("foreman") && talkFail.dispatch && /found/.test(talkFail.say) && /On it/.test(talkFail.reply), `overseer tells the assistant to unstick builders ${JSON.stringify(talkFail)}`);
    const talkQuiet = overseerTalk({ health: "good", summary: "good · the workflow is healthy", findings: [] });
    expect(!talkQuiet.say && !talkQuiet.roles.length && !talkQuiet.dispatch, "a healthy review stays quiet");
    const talkFix = overseerTalk({ findings: [] }, { repaired: ["un-parked the executor"] });
    expect(/repaired/.test(talkFix.say) && /Got it/.test(talkFix.reply), `a repair is spoken even without findings ${talkFix.say}`);
  }
  const pending = result.pendingWork;
  expect(pending.closedForMs === 1000 && pending.jobs.length === 2 && pending.jobs.every((job) => job.reason === "interrupted"), `pendingWork jobs ${JSON.stringify(pending)}`);
  expect(pending.jobs[1].role === "reference" && pending.jobs[1].taskId === "task_open" && pending.jobs[1].attempts === 1 && pending.jobs[1].status === "queued", `job defaults ${JSON.stringify(pending.jobs[1])}`);
  expect(pending.unanswered.length === 1 && pending.unanswered[0].id === "m3" && JSON.stringify(pending.interruptedRoles) === JSON.stringify(["watcher", "auditor"]), `unanswered/roles ${JSON.stringify(pending)}`);
  expect(result.resumeSummary === 'closed for 1 s · restarting 5 jobs: reply to "please check the swamp torches", watcher, auditor, improve "improve the explorer column", reference gather for task "Crafting bench recipes"', `resumeSummary ${result.resumeSummary}`);
  expect(resumeSummary({ closedForMs: (2 * 60 + 13) * MINUTE, jobs: [], unanswered: [], interruptedRoles: [] }) === "closed for 2 h 13 m · nothing to restart", "resumeSummary empty");
  expect(resumeSummary(pendingWork({ heartbeatAt: result.now - 3 * DAY - 4 * HOUR, work: [{ id: "a", kind: "audit", role: "auditor" }], agents: [{ role: "auditor", status: "running" }] }, result.now)) === "closed for 3 d 4 h · restarting 1 job: audit", "resumeSummary covers the role of a journal entry once");
  expect(loaded.work.length === 2 && loaded.work[0].attempts === 1 && loaded.work[1].status === "queued" && loaded.resumed.jobs[0] === "improve" && loaded.closedAt === 0, `normalizeState keeps the journal ${JSON.stringify(loaded.work)}`);
  const journal = after.work;
  expect(journal.length === 2 && journal[0].id === "job_ref" && journal[0].attempts === 2 && journal[0].status === "running" && journal[1].id === "job_new" && journal[1].role === "responder", `applyWork add/update/remove ${JSON.stringify(journal)}`);
  const full = Array.from({ length: 45 }, (_, index) => ({ id: `job_${index}`, kind: "brief", startedAt: index })).reduce((acc, entry) => applyWork(acc, entry, result.now), loaded);
  expect(full.work.length === 40 && full.work[0].id === "job_5" && full.work[39].id === "job_44", `applyWork cap keeps the newest tail ${full.work.length} ${full.work[0].id}`);
  expect(applyWork(full, { done: true }) === full && applyWork(full, { id: "job_x" }) === full, "applyWork ignores junk");
  const statusReply = result.replies[0].text;
  expect(statusReply.includes('Working on 2 jobs: reference gather for task "Crafting bench recipes", reply to "please check the swamp torches"'), `status lists the journal: ${statusReply}`);
  const resumeReply = result.replies[15];
  expect(resumeReply.actions.includes("resume-work") && resumeReply.text.includes("Re-queuing 4 jobs now") && resumeReply.text.includes('reply to "please check the swamp torches"') && !resumeReply.text.includes("restart the interrupted work") && resumeReply.text.includes("Last boot restarted 1 job after being closed for 5 m"), `resume-work reply: ${resumeReply.text}`);
  expect(result.replies[18].text.includes("Working on 2 jobs"), `working-on question is a status reply: ${result.replies[18].text}`);
  const facts = buildFacts({ work: after.work, resumed: after.resumed, now: result.now });
  expect(facts.work.length === 2 && facts.work[0].startedMinutesAgo === 180 && facts.resumed.closedForMs === 5 * MINUTE, `facts carry the journal ${JSON.stringify(facts.work)}`);
  const improve = pending.jobs[0];
  expect(improve.target?.id === "ses_active" && improve.targets.length === 2 && improve.targets[1].kind === "assistant" && improve.progress === 0.5 && pending.jobs[1].target === null && pending.jobs[1].targets.length === 0 && pending.jobs[1].progress === null, `journal keeps its place ${JSON.stringify(improve)}`);
  expect(loaded.work[0].target?.id === "ses_active" && loaded.work[0].progress === 0.5, "normalizeState keeps journal places");
  expect(row("watcher").target === null && row("watcher").targets.length === 2 && row("watcher").progress === 1 && row("auditor").target?.kind === "assistant" && row("auditor").progress === null, `roster places ${JSON.stringify(row("watcher"))}`);
  const failed = applyAgentEvent(after, { role: "auditor", status: "error", at: result.now + 5000, error: "boom" });
  const failedRow = failed.agents.find((entry) => entry.role === "auditor");
  expect(failedRow.target === null && failedRow.targets.length === 1 && failedRow.progress === null, `error keeps the visited list ${JSON.stringify(failedRow)}`);
  const idled = applyAgentEvent(failed, { role: "auditor", status: "idle", at: result.now + 6000 });
  const idleRow = idled.agents.find((entry) => entry.role === "auditor");
  expect(idleRow.target === null && idleRow.targets.length === 0 && idleRow.progress === null, "idle clears the place");
  const hopped = applyAgentEvent(after, { role: "keeper", status: "running", at: result.now + 5000, target: { kind: "task", id: "task_open" }, progress: 0.25 });
  const keeper = hopped.agents.find((entry) => entry.role === "keeper");
  expect(keeper.target?.id === "task_open" && keeper.progress === 0.25 && keeper.targets.length === 0, `event fields win ${JSON.stringify(keeper)}`);
  expect(normalizeState({ agents: [{ role: "watcher", status: "running", target: { kind: "session", id: "x" }, targets: [{ kind: "session", id: "x" }], progress: 0.3 }, { role: "machine", status: "done", targets: [{ kind: "root", id: "__root__" }], progress: 1 }] }, 10).agents.slice(0, 2).every((entry, index) => (index === 0 ? entry.target === null && entry.targets.length === 0 && entry.progress === null : entry.targets.length === 1 && entry.progress === 1)), "load: a reset row loses its place, a done row keeps it");
  const ownState = { ...none, work: [{ id: "job_reply_m9", kind: "responder", payload: { messageId: "m9" }, text: "resume the work" }], messages: [{ id: "m9", at: 1, role: "user", text: "resume the work" }] };
  const ownReply = localReply({ text: "resume the work", intent: "resume-work", facts: null, state: ownState, now: result.now });
  expect(ownReply.text.includes("Nothing is interrupted right now") && ownReply.actions.includes("resume-work"), `own responder job is not interrupted: ${ownReply.text}`);
  const otherReply = localReply({ text: "resume the work", intent: "resume-work", facts: null, state: { ...ownState, work: [...ownState.work, { id: "job_reply_m1", kind: "responder", payload: { messageId: "m1" }, text: "older question" }] }, now: result.now });
  expect(otherReply.text.includes("Re-queuing 1 job now") && otherReply.text.includes('reply to "older question"'), `other responder jobs still count: ${otherReply.text}`);
  const garbage = normalizeState({ status: "weird", messages: "nope", ai: 5, log: [1, { kind: "tick", text: "ok" }], prefs: { proactive: "yes", foldAfterMinutes: -3 } }, 10);
  expect(garbage.status === "running" && garbage.messages.length === 0 && garbage.log.length === 1 && garbage.prefs.proactive === true && garbage.prefs.foldAfterMinutes === 60, "garbage state");
  expect(classifyIntent("read the log") === "log" && classifyIntent("what's in the log") === "log" && classifyIntent("the builder log") === "builder", `log intent ${classifyIntent("read the log")}`);
  const logReply = localReply({
    text: "read the log",
    intent: "log",
    facts: { log: [{ kind: "audit", text: "audit: 1 error(s)" }, { kind: "error", text: "AI offline: HTTP 429" }], executor: { enabled: true, running: [], queued: 1, history: [{ kind: "pass", text: "2 queued" }] } },
    now: result.now,
  });
  expect(logReply.text.includes("audit: 1 error") && logReply.text.includes("AI offline") && logReply.text.includes("2 queued"), `log reply ${logReply.text}`);
  const planIdle = thinkPlan({
    log: [{ kind: "audit", text: "audit: 1 error(s)" }],
    suggestions: [{ kind: "audit", title: "1 audit error to fix", reason: "the auditor found real errors" }],
    executor: { enabled: true, running: [], queued: 0 },
    lastThought: "",
  });
  expect(planIdle.thinking.includes("audit") && planIdle.act?.kind === "dispatch" && planIdle.act.title.includes("audit"), `thinkPlan idle ${JSON.stringify(planIdle)}`);
  const planBusy = thinkPlan({
    log: [{ kind: "audit", text: "audit: 1 error(s)" }],
    suggestions: [{ kind: "audit", title: "1 audit error to fix", reason: "the auditor found real errors" }],
    executor: { enabled: true, running: [{ title: "Fix the ipc handler" }], queued: 0 },
    lastThought: "",
  });
  expect(!planBusy.act && planBusy.thinking.includes("building"), `thinkPlan busy ${JSON.stringify(planBusy)}`);
  const planRepeat = thinkPlan({
    log: [{ kind: "audit", text: "audit: 1 error(s)" }],
    suggestions: [{ kind: "audit", title: "1 audit error to fix", reason: "the auditor found real errors" }],
    executor: { enabled: true, running: [], queued: 0 },
    lastThought: `${planIdle.thinking} — starting work on "${planIdle.act.title}".`,
  });
  expect(!planRepeat.act, "thinkPlan does not re-dispatch the same pick");
  const thought = applyThought(emptyState(result.now), { text: "looking at the log: audit: 1 error", role: "thinker" }, result.now);
  expect(thought.thinking?.text.includes("audit") && thought.messages[0]?.role === "thinking" && thought.unread === 0, "applyThought lands in the thread without unread");
  expect(normalizeState({ thinking: "nope" }, 10).thinking === null && normalizeState({ thinking: { text: "hi", at: 5, role: "thinker" } }, 10).thinking.text === "hi", "thinking normalises");
  const overseer = result.overseer;
  expect(overseer.normalized.reviews === 2 && overseer.normalized.score === 72 && overseer.normalized.lessons.length === 1 && overseer.normalized.lessons[0].hits === 1 && overseer.normalized.directives.length === 1 && overseer.normalized.scores.length === 2, `overseer normalized ${JSON.stringify(overseer.normalized)}`);
  expect(overseer.digest.errorRoles.join(",") === "briefer" && overseer.digest.replies.unanswered === 1 && overseer.digest.work.stale === 1 && overseer.digest.ai.keyPresent === false, `overseer digest ${JSON.stringify(overseer.digest.errorRoles)}`);
  expect(overseer.digest.sessions.stale === 1 && overseer.digest.sessions.active === 2 && overseer.digest.sessions.folded === 2 && overseer.digest.sessions.staleQuietMin === 1800, `overseer digest sessions ${JSON.stringify(overseer.digest.sessions)}`);
  expect(overseer.review.score === 48 && overseer.review.health === "poor" && overseer.review.findings.length === 5 && overseer.review.findings[0].title === "briefer failing" && overseer.review.lessons.length === 0 && overseer.review.upgrades.length === 2, `overseer review ${JSON.stringify(overseer.review)}`);
  const talked = overseerTalk(overseer.review, { digest: overseer.digest });
  expect(talked.roles.includes("briefer") && talked.roles.includes("foreman") && talked.resumeUnanswered && /briefer failing/.test(talked.say) && /On it/.test(talked.reply), `overseer talks the fixture review to the assistant ${JSON.stringify(talked)}`);
  const planOverseer = thinkPlan({ log: [], suggestions: [], executor: { enabled: true, running: [{ title: "x" }], queued: 0 }, overseer: { findings: [{ title: "auditor failing" }] } });
  expect(planOverseer.thinking.includes("overseer: auditor failing") && !planOverseer.act, `thinkPlan hears the overseer while busy ${planOverseer.thinking}`);
  expect(overseer.review.findings.some((entry) => entry.title === "stale sessions waiting" && entry.persisting === false && /30h ago/.test(entry.detail)), `the stale finding names the quiet time ${JSON.stringify(overseer.review.findings)}`);
  expect(overseer.merged.reviews === 3 && overseer.merged.score === 48 && overseer.merged.scores.length === 3 && overseer.merged.lessons.length === 1, `overseer merged ${JSON.stringify({ reviews: overseer.merged.reviews, score: overseer.merged.score })}`);
  expect(overseer.tune.applied.length === 2 && overseer.tune.applied[0].key === "staleAfterHours" && overseer.tune.applied[0].to === 72 && overseer.tune.rejected.join(",") === "nonsense,tidyDoneAfterHours", `overseer tune ${JSON.stringify(overseer.tune)}`);
  // A finding that survives into the next review becomes a lesson; the same
  // lesson reviewed again only raises its hit count — the playbook sharpens
  // instead of growing.
  const second = overseerReview(overseer.digest, overseer.merged);
  expect(second.findings.every((entry) => entry.persisting) && second.lessons.length === 4, `persisting findings become lessons ${JSON.stringify(second.lessons)}`);
  const merged2 = overseerMerge(overseer.merged, second, result.now + 1000);
  expect(merged2.lessons.length === 5 && merged2.reviews === 4 && merged2.lessons[0].text.startsWith("briefer failing"), `merge adds lessons ${JSON.stringify(merged2.lessons.map((entry) => entry.text))}`);
  const merged3 = overseerMerge(merged2, second, result.now + 2000);
  expect(merged3.lessons.length === 5 && merged3.lessons[0].hits === 2 && merged3.reviews === 5, "repeat lessons raise hits");
  const rawOverseer = normalizeOverseer({ reviews: "x", score: 999, health: "weird", lessons: [null, { text: "keep me", hits: -2 }], findings: "nope", scores: [{ score: "no" }, { score: 50 }] });
  expect(rawOverseer.reviews === 0 && rawOverseer.score === 100 && rawOverseer.health === "unknown" && rawOverseer.lessons.length === 1 && rawOverseer.lessons[0].hits === 1 && rawOverseer.scores.length === 1, `overseer garbage ${JSON.stringify(rawOverseer)}`);
  expect(result.replies[21].actions.includes("overseer") && result.replies[21].text.includes("review #3") && result.replies[21].text.includes("playbook"), `overseer reply: ${result.replies[21].text}`);
  // the stale-session rescue: the repair pass turns each stale session into a
  // resume request — oldest first, capped, deduped against what is filed
  {
    const fixture = selfTestFixture();
    const rescues = staleRescues({ sessions: fixture.sessions, todos: fixture.todos, existing: fixture.requests, tasks: fixture.tasks, now: result.now });
    expect(rescues.length === 1 && rescues[0].id === "ses_stale" && rescues[0].title === "Session ses_stale" && rescues[0].todo === "Rename the swamp biome" && rescues[0].quietMinutes === 1800 && rescues[0].pending === 0, `rescues plan the stale sessions ${JSON.stringify(rescues)}`);
    expect(rescues[0].request.title === "Resume: Session ses_stale" && rescues[0].request.prompt.includes('"Rename the swamp biome" still in progress') && rescues[0].request.prompt.includes("30h ago"), `rescue request shape ${JSON.stringify(rescues[0]?.request)}`);
    expect(staleRescues({ sessions: fixture.sessions, todos: fixture.todos, existing: [...fixture.requests, rescues[0].request], tasks: fixture.tasks, now: result.now }).length === 0, "a filed rescue does not refire");
    const older = { id: "ses_stale_older", parentId: null, title: "Marsh drainage", timeUpdated: result.now - 40 * 60 * MINUTE };
    const extra = { sessionId: "ses_stale_older", content: "Drain the marsh", status: "in_progress", position: 0 };
    const pending = { sessionId: "ses_stale_older", content: "Mark the marsh trails", status: "pending", position: 1 };
    const two = staleRescues({ sessions: [...fixture.sessions, older], todos: [...fixture.todos, extra, pending], now: result.now });
    expect(two.length === 2 && two[0].id === "ses_stale_older" && two[0].quietMinutes === 2400 && two[0].pending === 1, `oldest first ${JSON.stringify(two.map((entry) => [entry.id, entry.quietMinutes]))}`);
    expect(two[0].request.prompt.includes('then "Mark the marsh trails"'), `the prompt carries the pending todos ${two[0].request.prompt}`);
    expect(staleRescues({ sessions: [...fixture.sessions, older], todos: [...fixture.todos, extra], now: result.now, limit: 1 }).map((entry) => entry.id).join(",") === "ses_stale_older", "the pass is capped at its limit");
    expect(result.rescues.length === 1 && result.rescues[0].id === "ses_stale", `the fixture payload plans the same rescue ${JSON.stringify(result.rescues)}`);
  }
  // Push memory (Recall-style): typed cells, a write gate that supersedes, a
  // compile primer that flags the stale title instead of ranking it as fresh.
  {
    const target = { kind: "task", id: "task:task_open" };
    let memState = emptyState(result.now);
    memState = admitMemory(memState, { target, kind: "run", role: "executor", text: 'autopilot "Wire the retry" — done (exit 0)', at: result.now - HOUR }, result.now - HOUR);
    memState = admitMemory(memState, { target, kind: "run", role: "executor", text: 'autopilot "Wire the retry" — failed (exit 1)', at: result.now, contradicts: "done (exit 0)" }, result.now);
    const folder = memState.nodeFolders["task:task:task_open"];
    expect(folder && folder.entries.length === 2 && folder.entries[0].superseded === true && folder.entries[1].cell === "rsk", `admit supersedes the prior run ${JSON.stringify(folder)}`);
    expect(inferMemoryCell("run", "autopilot finished — done (exit 0)") === "ver" && inferMemoryCell("run", "autopilot run failed (exit 1)") === "rsk", "run verdicts become verifications or risks");
    const compiled = compileMemory({ query: "retry path", folders: memState.nodeFolders, focus: target, now: result.now, limit: 4 });
    expect(compiled.dig && compiled.primer.some((line) => /SUPERSEDED/.test(line)), `compile flags the superseded fact ${JSON.stringify(compiled)}`);
    expect(result.facts.memory && Array.isArray(result.facts.memory.primer), `facts carry a pushed primer ${JSON.stringify(result.facts.memory)}`);
  }
  // Peer-session collaboration: adopt an existing implementation, defer when
  // a live session is still editing the same file, and ignore unrelated work.
  {
    const group = {
      file: "C:/repo/mefi-studio/main.cjs",
      files: ["C:/repo/mefi-studio/main.cjs"],
      owner: "ses_peer",
      sessions: [
        { sessionId: "ses_peer", edits: 5, active: true },
        { sessionId: "ses_other", edits: 2, active: true },
      ],
      active: true,
    };
    const adopt = collaborate({
      work: { title: "Wire the parallel executor", prompt: "merge uncommitted main.cjs", file: "C:/repo/mefi-studio/main.cjs" },
      collisions: [{ ...group, sessions: [{ sessionId: "ses_peer", edits: 5 }, { sessionId: "ses_other", edits: 2 }], active: false }],
    });
    expect(adopt.action === "adopt" && adopt.owner === "ses_peer" && adopt.liveEditors.length === 0 && /adopt that work/.test(adopt.advice) && !/actively editing/.test(adopt.advice), `adopt peer work ${JSON.stringify(adopt)}`);
    const live = collaborate({
      work: { title: "Wire the parallel executor", prompt: "merge uncommitted main.cjs", file: "main.cjs" },
      collisions: [group],
    });
    expect(live.action === "defer" && live.liveEditors.length === 2 && /actively editing/.test(live.advice) && /do not merge or overwrite/.test(live.advice), `live editors defer a merge ${JSON.stringify(live)}`);
    const resolving = collaborate({
      work: { title: "Resolve collision: main.cjs", prompt: "two sessions", file: "C:/repo/mefi-studio/main.cjs", source: "collision" },
      collisions: [group],
    });
    expect(resolving.action === "adopt" && /actively editing/.test(resolving.advice), `a collision job still runs ${JSON.stringify(resolving)}`);
    const unrelated = collaborate({
      work: { title: "Draw the tide pool fish", prompt: "sprite pass" },
      collisions: [group],
    });
    expect(unrelated.action === "proceed" && unrelated.advice === "", `unrelated work is left alone ${JSON.stringify(unrelated)}`);
    expect(result.collaboration.action === "defer" && result.collaboration.owner === "ses_active", `fixture collaboration ${JSON.stringify(result.collaboration)}`);
    const liveSolo = collaborate({
      work: { title: "Patch new.lua", prompt: "tweak new.lua", file: "C:/fixture/new.lua" },
      collisions: [],
      presence: [{ file: "C:/fixture/new.lua", owner: "ses_a", colliding: false, editors: [{ sessionId: "ses_a", edits: 3, active: true }] }],
    });
    expect(liveSolo.action === "defer" && liveSolo.owner === "ses_a" && liveSolo.liveEditors.length === 1 && /actively editing/.test(liveSolo.advice), `single live editor defers ${JSON.stringify(liveSolo)}`);
    const handedGroup = {
      file: "C:/fixture/handoff.lua",
      files: ["C:/fixture/handoff.lua"],
      owner: "ses_c",
      handoff: true,
      active: true,
      sessions: [
        { sessionId: "ses_c", edits: 3, active: false },
        { sessionId: "ses_d", edits: 1, active: true },
      ],
    };
    const handed = collaborate({
      work: { title: "Patch handoff.lua", prompt: "fixture", file: "C:/fixture/handoff.lua" },
      collisions: [handedGroup],
    });
    expect(handed.action === "defer" && handed.handoff === true && handed.liveEditors.length === 1 && handed.liveEditors[0].sessionId === "ses_d" && /marked inactive/.test(handed.advice) && /confirm handoff/.test(handed.advice), `inactive owner handoff ${JSON.stringify(handed)}`);
    const handedResolve = collaborate({
      work: { title: "Resolve collision: handoff.lua", prompt: "fixture", file: "C:/fixture/handoff.lua", source: "collision" },
      collisions: [handedGroup],
    });
    expect(handedResolve.action === "adopt" && handedResolve.handoff === true && /confirm handoff/.test(handedResolve.advice), `collision job confirms handoff ${JSON.stringify(handedResolve)}`);
    const idlePresence = collaborate({
      work: { title: "Patch new.lua", prompt: "tweak new.lua", file: "C:/fixture/new.lua" },
      presence: [{ file: "C:/other.lua", owner: "ses_a", editors: [{ sessionId: "ses_a", edits: 1, active: true }] }],
    });
    expect(idlePresence.action === "proceed" && idlePresence.advice === "", `presence on another file is ignored ${JSON.stringify(idlePresence)}`);
    const split = collaborate({
      work: { title: "Split the feature", prompt: "a.lua and b.lua", files: ["C:/fixture/a.lua", "C:/fixture/b.lua"] },
      collisions: [{
        file: "C:/fixture/a.lua",
        files: ["C:/fixture/a.lua", "C:/fixture/b.lua"],
        owner: "ses_a",
        ownership: [
          { file: "C:/fixture/a.lua", owner: "ses_a" },
          { file: "C:/fixture/b.lua", owner: "ses_b" },
        ],
        sessions: [
          { sessionId: "ses_a", edits: 5, active: false, files: ["C:/fixture/a.lua"] },
          { sessionId: "ses_b", edits: 2, active: false, files: ["C:/fixture/b.lua"] },
        ],
        active: false,
      }],
    });
    expect(
      split.action === "adopt" &&
        split.collaborating === true &&
        split.owner === "ses_a" &&
        split.peers.find((peer) => peer.sessionId === "ses_a")?.files.join(",") === "C:/fixture/a.lua" &&
        /collaborating on this feature/.test(split.advice) &&
        /a.lua -> ses_a/.test(split.advice) &&
        /b.lua -> ses_b/.test(split.advice) &&
        /Keep the files you own/.test(split.advice),
      `split ownership is collaboration ${JSON.stringify(split)}`
    );
    const grouped = {
      file: "C:/repo/mefi-studio/main.cjs",
      files: ["C:/repo/mefi-studio/main.cjs", "C:/repo/mefi-studio/scripts/eyes.mjs"],
      owner: "ses_peer",
      sessions: [
        { sessionId: "ses_peer", edits: 5, active: false },
        { sessionId: "ses_other", edits: 2, active: false },
      ],
      active: false,
    };
    const secondary = collaborate({
      work: { title: "Add temporal overlap", prompt: "edit eyes.mjs", file: "C:/repo/mefi-studio/scripts/eyes.mjs" },
      collisions: [grouped],
    });
    expect(secondary.action === "adopt" && secondary.owner === "ses_peer" && secondary.files.includes("C:/repo/mefi-studio/scripts/eyes.mjs"), `grouped collision matches a secondary file ${JSON.stringify(secondary)}`);
    const peerFeature = collaborate({
      work: { title: "Wire the parallel executor", prompt: "fill the remaining gaps" },
      sessions: [{ id: "ses_peer", title: "Wire the parallel executor" }],
    });
    expect(peerFeature.action === "adopt" && peerFeature.owner === "ses_peer" && peerFeature.liveEditors.length === 0 && /already looks like it implemented this/.test(peerFeature.advice), `session title overlap adopts ${JSON.stringify(peerFeature)}`);
    expect(shouldHoldWork(peerFeature, { title: "Wire the parallel executor" }) === false, "adopt does not hold the pick");
    const viaRefs = collaborate({
      work: { title: "Patch new.lua", prompt: "tweak the fixture", refs: [{ kind: "file", title: "C:/fixture/new.lua" }] },
      presence: [{ file: "C:/fixture/new.lua", owner: "ses_a", colliding: false, editors: [{ sessionId: "ses_a", edits: 3, active: true }] }],
    });
    expect(viaRefs.action === "defer" && viaRefs.owner === "ses_a", `board-task refs match live editors ${JSON.stringify(viaRefs)}`);
    expect(shouldHoldWork(viaRefs, { title: "Patch new.lua" }) === true, "live editors hold a plain pick");
    expect(shouldHoldWork(viaRefs, { title: "Patch new.lua", source: "chat" }) === false, "a chat ask still runs");
    expect(shouldHoldWork(viaRefs, { title: "Patch new.lua", pin: true }) === false, "a pin still runs");
    expect(shouldHoldWork(viaRefs, { title: "Resolve collision: new.lua", source: "collision" }) === false, "a collision job still runs");
    const dirtyOnly = collaborate({
      work: { title: "Wire the parallel executor", prompt: "merge uncommitted main.cjs", file: "C:/repo/mefi-studio/main.cjs" },
      uncommitted: [{ file: "C:/repo/mefi-studio/main.cjs" }],
    });
    expect(/uncommitted changes/.test(dirtyOnly.advice) && dirtyOnly.action === "proceed", `uncommitted HEAD warning ${JSON.stringify(dirtyOnly)}`);
    const viaTodos = collaborate({
      work: { title: "Drain the marsh", prompt: "finish the drainage" },
      sessions: [{ id: "ses_stale", title: "Marsh drainage" }],
      todos: [{ sessionId: "ses_stale", content: "Drain the marsh", status: "in_progress" }],
    });
    expect(viaTodos.action === "adopt" && viaTodos.owner === "ses_stale", `todo overlap adopts ${JSON.stringify(viaTodos)}`);
    const held = claimWork({
      work: { title: "Patch main.cjs", prompt: "tweak main.cjs", file: "C:/repo/mefi-studio/main.cjs" },
      jobs: [{ title: "other", files: ["C:\\repo\\mefi-studio\\main.cjs"] }],
    });
    expect(held.action === "defer" && held.reason === "claimed" && /already claimed/.test(held.advice), `in-flight file claim ${JSON.stringify(held)}`);
    const free = claimWork({
      work: { title: "Patch idle.js", prompt: "tweak idle.js", file: "C:/repo/mefi-studio/renderer/idle.js" },
      jobs: [{ title: "other", files: ["C:/repo/mefi-studio/main.cjs"] }],
    });
    expect(free.action === "proceed" && free.reason === "proceed", `unrelated claim ${JSON.stringify(free)}`);
    const released = claimedFiles([{ files: ["a.js"], finished: true }, { files: ["b.js"] }]);
    expect(released.length === 1 && /b\.js$/.test(released[0]), `finished jobs release ${JSON.stringify(released)}`);
    const liveClaim = claimWork({
      work: { title: "Wire the parallel executor", prompt: "merge uncommitted main.cjs", file: "main.cjs" },
      collisions: [group],
    });
    expect(liveClaim.action === "defer" && liveClaim.reason === "defer", `live editors still defer ${JSON.stringify(liveClaim)}`);
    const resolveHeld = claimWork({
      work: { title: "Resolve collision: main.cjs", prompt: "two sessions", file: "C:/repo/mefi-studio/main.cjs", source: "collision" },
      collisions: [group],
      jobs: [{ files: ["C:/repo/mefi-studio/main.cjs"] }],
    });
    expect(resolveHeld.action === "defer" && resolveHeld.reason === "claimed", `a collision job still waits on a live claim ${JSON.stringify(resolveHeld)}`);
    const resolveLive = claimWork({
      work: { title: "Resolve collision: main.cjs", prompt: "two sessions", file: "C:/repo/mefi-studio/main.cjs", source: "collision" },
      collisions: [group],
    });
    expect(resolveLive.action === "adopt" && /actively editing/.test(resolveLive.advice), `a collision job still runs against live editors ${JSON.stringify(resolveLive)}`);
    expect(shouldHoldWork(liveClaim, { source: "a-eyes" }) === true, "autopilot work holds for a live editor");
    expect(shouldHoldWork(liveClaim, { source: "chat" }) === false && shouldHoldWork(liveClaim, { source: "collision" }) === false, "chat and collision jobs still run against live editors");
    expect(shouldHoldWork(held, { source: "chat", pin: true }) === true, "a sibling file claim holds even a pin");
    const headOnly = collaborate({
      work: { title: "Wire the parallel executor", prompt: "finish the executor", file: "C:/repo/mefi-studio/main.cjs" },
      uncommitted: [{ file: "C:/repo/mefi-studio/main.cjs", warning: "HEAD does not have parallel executor", sessions: ["ses_peer"] }],
    });
    expect(headOnly.action === "proceed" && /HEAD does not have this feature/.test(headOnly.advice) && /uncommitted/.test(headOnly.advice), `uncommitted HEAD warning ${JSON.stringify(headOnly)}`);
    const headIdle = collaborate({
      work: { title: "Draw the tide pool fish", prompt: "sprite pass" },
      uncommitted: [{ file: "C:/repo/mefi-studio/main.cjs", warning: "HEAD missing" }],
    });
    expect(headIdle.action === "proceed" && headIdle.advice === "", `unrelated uncommitted is ignored ${JSON.stringify(headIdle)}`);
    const headAdopt = collaborate({
      work: { title: "Wire the parallel executor", prompt: "merge uncommitted main.cjs", file: "C:/repo/mefi-studio/main.cjs" },
      collisions: [{ ...group, sessions: [{ sessionId: "ses_peer", edits: 5, active: false }, { sessionId: "ses_other", edits: 2, active: false }], active: false }],
      uncommitted: [{ file: "C:/repo/mefi-studio/main.cjs", sessions: ["ses_peer"] }],
    });
    expect(headAdopt.action === "adopt" && /HEAD does not have this feature/.test(headAdopt.advice), `adopt plus HEAD warning ${JSON.stringify(headAdopt)}`);
  }
  {
    const requests = [
      { title: "Duplicate declarations: main.cjs", prompt: "two foo()", file: "C:/repo/mefi-studio/main.cjs", source: "duplicate", at: result.now },
      { title: "Duplicate declarations: idle.js", prompt: "two bar()", file: "C:/repo/mefi-studio/renderer/idle.js", source: "duplicate", at: result.now },
      { title: "Owner note", prompt: "keep", source: "manual", at: result.now },
    ];
    const cleaned = tidy({
      requests,
      duplicates: { scanned: ["C:/repo/mefi-studio/main.cjs", "C:/repo/mefi-studio/renderer/idle.js"], findings: [{ file: "C:/repo/mefi-studio/renderer/idle.js", duplicates: [{ name: "bar", lines: [1, 4] }] }] },
      now: result.now,
    });
    expect(
      cleaned.requests.length === 2 &&
        cleaned.requests.some((request) => request.file === "C:/repo/mefi-studio/renderer/idle.js") &&
        cleaned.requests.some((request) => request.source === "manual") &&
        !cleaned.requests.some((request) => request.file === "C:/repo/mefi-studio/main.cjs"),
      `resolved duplicate requests drop ${JSON.stringify(cleaned.requests)}`
    );
  }
  {
    const facts = buildFacts({
      collisions: [
        {
          file: "C:/fixture/main.lua",
          files: ["C:/fixture/main.lua", "C:/fixture/shared.lua"],
          owner: "ses_a",
          active: true,
          ownership: [{ file: "C:/fixture/main.lua", owner: "ses_b" }],
          sessions: [
            { sessionId: "ses_a", edits: 3, active: true, files: ["C:/fixture/shared.lua"] },
            { sessionId: "ses_b", edits: 1, active: false, files: ["C:/fixture/main.lua"] },
          ],
        },
      ],
      now: result.now,
    });
    const row = facts.collisions[0];
    expect(
      row.owner === "ses_a" && row.active === true && row.activeSessions.join(",") === "ses_a" && row.ownership[0].owner === "ses_b" && row.files.join(",") === "C:/fixture/main.lua,C:/fixture/shared.lua",
      `facts surface owner/activeSessions ${JSON.stringify(row)}`
    );
    expect(
      row.sessions[0].files.join(",") === "C:/fixture/shared.lua" && row.sessions[1].files.join(",") === "C:/fixture/main.lua",
      `facts copy each session's actual files ${JSON.stringify(row.sessions)}`
    );
    const picks = suggestWork({ collisions: facts.collisions, now: result.now });
    expect(picks[0]?.reason.includes("ses_a owns it") && picks[0]?.reason.includes("2 files"), `suggestWork names the owner and grouped files ${JSON.stringify(picks)}`);
    expect(row.handoff === false, `a live owner is not a handoff ${JSON.stringify(row)}`);
    const handedFacts = buildFacts({
      collisions: [{
        file: "C:/fixture/handoff.lua",
        owner: "ses_c",
        active: true,
        sessions: [
          { sessionId: "ses_c", edits: 3, active: false },
          { sessionId: "ses_d", edits: 1, active: true },
        ],
      }],
      now: result.now,
    });
    expect(handedFacts.collisions[0].handoff === true && handedFacts.collisions[0].activeSessions.join(",") === "ses_d", `facts handoff ${JSON.stringify(handedFacts.collisions[0])}`);
    const handedPicks = suggestWork({ collisions: handedFacts.collisions, now: result.now });
    expect(handedPicks[0]?.reason.includes("confirm handoff"), `suggestWork handoff ${JSON.stringify(handedPicks)}`);
  }
  {
    const groupedTidy = tidy({
      tasks: [],
      ideas: [],
      requests: [
        { title: "Resolve collision: extra.lua", prompt: "x", file: "C:/fixture/extra.lua", files: ["C:/fixture/extra.lua"], sessions: ["ses_a", "ses_b"], source: "collision", at: result.now },
        { title: "Resolve collision: gone.lua", prompt: "y", file: "C:/fixture/gone.lua", sessions: ["ses_x", "ses_y"], source: "collision", at: result.now },
      ],
      checkpoints: {},
      collisions: [{
        file: "C:/fixture/main.lua",
        files: ["C:/fixture/main.lua", "C:/fixture/extra.lua"],
        sessions: [{ sessionId: "ses_a" }, { sessionId: "ses_b" }],
      }],
      now: result.now,
    });
    const groupedTitles = groupedTidy.requests.map((request) => request.title);
    expect(groupedTitles.includes("Resolve collision: extra.lua") && !groupedTitles.includes("Resolve collision: gone.lua"), `tidy keeps a grouped secondary file ${JSON.stringify(groupedTitles)}`);
    const rotated = tidy({
      tasks: [],
      ideas: [],
      checkpoints: {},
      requests: [
        { title: "Resolve collision: oldname.lua", prompt: "x", file: "C:/fixture/oldname.lua", sessions: ["ses_a", "ses_b"], source: "collision", at: result.now },
      ],
      collisions: [{
        file: "C:/fixture/newname.lua",
        files: ["C:/fixture/newname.lua"],
        sessions: [{ sessionId: "ses_a" }, { sessionId: "ses_b" }],
      }],
      now: result.now,
    });
    expect(rotated.requests.some((request) => request.title === "Resolve collision: oldname.lua"), `tidy keeps a live session pair when the representative file rotated ${JSON.stringify(rotated.requests)}`);
  }
  return { ok: failures.length === 0, failures, checks: 180 };
}

async function cli() {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf("--fixture");
  if (fixtureIndex >= 0) {
    const fixture = JSON.parse(await readFile(args[fixtureIndex + 1], "utf8"));
    console.log(JSON.stringify(runFixture(fixture), null, 2));
    return;
  }
  if (args.includes("--self-test")) {
    const verdict = selfTest();
    console.log(JSON.stringify(verdict, null, 2));
    process.exit(verdict.ok ? 0 : 1);
  }
  console.error("usage: node scripts/assistant.mjs --fixture <json> | --self-test");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
