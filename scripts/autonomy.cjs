// One permission vocabulary for dispatch, the desk and chat. Pure: callers
// provide settings and the board; this module never saves or performs a choice.
// Pure module: no Electron, no filesystem, no network, no clock reads.
"use strict";

const { hasBuildApproval } = require("./backlog.cjs");
const LEVELS = Object.freeze(["ask", "accept", "auto", "elevated"]);
const DEFAULT_LEVEL = "auto";
const ELEVATED = Object.freeze([
  { id: "grant", label: "Granting reach", blurb: "Letting an agent touch more than its task allows.", warn: "Automatic grants can widen access to your files and tools." },
  { id: "risk", label: "Irreversible changes", blurb: "Changes that may be difficult or impossible to undo.", warn: "Automatic risk decisions can approve destructive changes." },
  { id: "drop-owned", label: "Closing your work", blurb: "Dropping or closing a task you created." },
  { id: "agent-filed", label: "Work agents propose", blurb: "In Elevated only, ask before starting agent-proposed tasks. Auto starts these tasks automatically." },
  { id: "pricier-model", label: "A pricier model", blurb: "Retrying with a heavier model or a larger budget." },
  { id: "real-world", label: "Real-world to-dos", blurb: "Things only a person can do, kept in your For you list." },
].map(Object.freeze));
const RETRY_KINDS = Object.freeze(["blocked", "check-failed", "verify", "run-failed"]);
const rows = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

function migrate(settings = {}) {
  const saved = object(settings.autonomy);
  return {
    level: LEVELS.includes(saved.level) ? saved.level : (settings.autopilot ?? settings.ui?.autopilot)?.autoBuild === false ? "ask" : DEFAULT_LEVEL,
    elevated: Object.fromEntries(ELEVATED.map(({ id }) => [id, saved.elevated?.[id] !== false])),
  };
}

function normalize(value = {}) { return migrate({ autonomy: value }); }
function sameProject(a, b) {
  return !(a.projectId && b.projectId && a.projectId !== b.projectId)
    && !(a.projectPath && b.projectPath && String(a.projectPath).replace(/\\/g, "/").toLowerCase() !== String(b.projectPath).replace(/\\/g, "/").toLowerCase());
}

// Acceptance is bound to the saved scope. Only genuine delegation and split
// links inherit it; a worker's generic handoff does not authorize new work.
function accepted(task, { tasks = [] } = {}, visited = new Set()) {
  if (!task || visited.has(task.id)) return false;
  if (hasBuildApproval(task)) return true;
  visited.add(task.id);
  const parentId = task.splitFrom || task.parentTaskId;
  if (!parentId) return false;
  const parent = rows(tasks).find((row) => row?.id === parentId && sameProject(task, row));
  if (!parent) return false;
  const linked = task.splitFrom === parent.id || rows(parent.delegation?.childTaskIds).includes(task.id);
  return linked && accepted(parent, { tasks }, visited);
}

// The owner's own work: a card they created, or an actual split or delegated
// slice of one (the same links acceptance follows). Under Auto and Elevated
// the owner's card builds without an approval, so its slices must too:
// otherwise the parent waits on its slices and the slices wait on the owner.
function ownerWork(task, { tasks = [] } = {}, visited = new Set()) {
  if (!task || visited.has(task.id)) return false;
  if (task.origin?.by === "owner" || hasBuildApproval(task)) return true;
  visited.add(task.id);
  const parentId = task.splitFrom || task.parentTaskId;
  if (!parentId) return false;
  const parent = rows(tasks).find((row) => row?.id === parentId && sameProject(task, row));
  if (!parent) return false;
  const linked = task.splitFrom === parent.id || rows(parent.delegation?.childTaskIds).includes(task.id);
  return linked && ownerWork(parent, { tasks }, visited);
}

function needsApproval(task, { level = DEFAULT_LEVEL, elevated = {}, tasks = [] } = {}) {
  if (accepted(task, { tasks })) return false;
  if (level === "ask" || level === "accept") return true;
  if (level === "auto") return false;
  return elevated["agent-filed"] !== false && !ownerWork(task, { tasks });
}

function classify({ question, approval, parked, task, option, action, kind } = {}) {
  const item = question ?? approval ?? parked ?? {};
  const issueKind = item.context?.issueKind ?? item.issueKind ?? kind;
  const chosen = option?.action ?? action ?? item.action ?? {};
  const verb = chosen.action ?? chosen.kind ?? option?.id;
  if (issueKind === "permission" || verb === "grant") return "grant";
  if (issueKind === "risk" || verb === "proceed") return "risk";
  if (issueKind === "capability" || verb === "retry-deep") return "pricier-model";
  if (issueKind === "owner" || verb === "acknowledge") return "real-world";
  if (["drop", "mark_done", "close", "archive"].includes(verb) && task?.origin?.by === "owner") return "drop-owned";
  if (approval && task?.origin?.by !== "owner") return "agent-filed";
  return null;
}

function canDelegate(question, { elevated = {}, affirmed = false, task = null, option = null } = {}) {
  if (!question || question.context?.raisedBy === "desk") return false;
  if (["chat", "chat-confirm"].includes(question.source) && !affirmed) return false;
  // Whether work done outside Studio already covers a card (outside-work.cjs)
  // is judged from changes Studio never watched: closing, dropping or
  // re-running the card stays the owner's call in every mode.
  if (question.source === "relevance") return false;
  const category = classify({ question, task, option });
  return !category || elevated[category] === false;
}

function route({ level = DEFAULT_LEVEL, elevated = {}, item = {}, task = null, accepted: isAccepted = false, confidence = null, learned = null, option = null, affirmed = false } = {}) {
  if (!LEVELS.includes(level)) level = DEFAULT_LEVEL;
  if (task?.ownerHold || task?.autonomyBudgetHold || task?.loopGuard?.by === "owner" || item.context?.undoneFrom) return "owner";
  const question = item.question ?? (item.options ? item : null);
  const category = classify({ question, task, option, approval: item.kind === "approval" ? item : null, parked: item.kind === "parked" ? item : null });
  if (category && elevated[category] !== false) return "owner";
  if (question && !canDelegate(question, { elevated, task, option, affirmed })) return "owner";
  if (item.kind === "approval") return "owner"; // approval is the owner's acceptance, never guessed
  if (level === "ask") return "advise";
  const family = question?.source === "family";
  const manualResult = item.kind === "review" || item.sessionless === true || item.context?.sessionless === true;
  if (level === "accept" && (family || manualResult || !isAccepted)) return "owner";
  const strong = Number(learned?.share) >= 0.7 && Number(learned?.n) >= 4;
  const verb = option?.action?.action ?? option?.action?.choice ?? option?.id;
  const disagrees = strong && verb && verb !== learned.verb;
  if (level === "auto" && (confidence !== null && Number(confidence) < 0.7 || disagrees)) return "advise";
  if (level === "elevated" && confidence !== null && Number(confidence) < 0.7) return "mefi-safe";
  return "mefi";
}

// Only runner-recorded, named checks for this exact sessionless attempt count.
// Model prose claiming that tests passed cannot supply completion evidence.
function sessionless(task = {}) {
  const attempt = task.lastAttempt ?? {}, run = task.verificationRun ?? {};
  const eligible = !attempt.sessionId && ["claude", "codex", "grok", "antigravity"].includes(attempt.route)
    && task.verification?.state === "failed" && /leave no session/.test(task.verification?.reason ?? "");
  const matches = attempt.runId && run.key && String(run.key).split(":").includes(String(attempt.runId));
  const checks = rows(run.results);
  const allPassed = checks.length > 0 && checks.every((check) => typeof check.command === "string" && check.command.trim()
    && check.exitCode === 0 && check.ok === true && !check.timedOut && !check.unavailable && !check.relocated);
  const parts = attempt.result?.parts ?? {};
  const unfinished = rows(task.remaining).length > 0 || task.handoffState?.pending > 0
    || parts.owner && !/^(?:none|n\/a|no|0)[.!]?$/i.test(String(parts.owner).trim())
    || parts.remaining && !/^(?:none|n\/a|nothing|no(?:ne)? remaining(?: work)?|0)[.!]?$/i.test(String(parts.remaining).trim());
  return { eligible, canConfirm: Boolean(eligible && matches && allPassed && !unfinished && attempt.code === 0),
    runId: attempt.runId ?? null, checks: checks.filter((row) => row?.command).map((row) => String(row.command).slice(0, 160)) };
}

function issueOverlay(level, mapPolicy = {}, { accepted: isAccepted = false } = {}) {
  return { ...mapPolicy, auto: level === "ask" || level === "accept" && !isAccepted ? [] : [...RETRY_KINDS] };
}

module.exports = { LEVELS, DEFAULT_LEVEL, ELEVATED, RETRY_KINDS, migrate, normalize, accepted, ownerWork, needsApproval, classify, canDelegate, route, sessionless, issueOverlay };
