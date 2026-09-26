// A coordinator may split an owned task into durable implementation slices.
// This pure module runs inside the board mutation gateway. Children use the
// ordinary executor, approval, file-claim and verification paths.
const { createHash } = require("node:crypto");
const { buildScope } = require("./backlog.cjs");
const { taskRow } = require("./work-admission.cjs");
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownKeys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const boundedText = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value.trim() : null;
const requestKey = (ref) => ref.id ? `id:${String(ref.id)}` : `request:${digest([ref.at ?? null, ref.prompt ?? null, ref.fromRun ?? null, ref.handoffId ?? null])}`;

function canPlan(ref, { nest = false, maxDepth = 3 } = {}) {
  if (!object(ref) || ref.delegation || ref.handoffId || ref.runProgress?.pending || ref.interruptedAttempt || ref.resumeCheckpoint) return false;
  const lineage = Boolean(ref.delegatedFrom || ref.fromRun || ref.parentTaskId || Number(ref.depth) > 0);
  if (!lineage) return true;
  // Nested delegation (roadmap 0.4.0 M2, the owner's agentBrain.nestedDelegation
  // switch): a delegated slice may split its own part — never a hand-off or a
  // follow-up — and never at the depth cap, so a family stays maxDepth deep.
  return Boolean(nest === true && object(ref.delegatedFrom) && ref.parentTaskId && (Number(ref.depth) || 0) + 1 < maxDepth);
}

function relativeFile(value) {
  const file = boundedText(value, 500);
  if (!file || /[\u0000-\u001f<>:"|?*]/.test(file)) return null;
  const normalized = file.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git"
    || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null;
  return normalized;
}

function normalizePlan(value) {
  if (!ownKeys(value, ["summary", "subtasks"])) return null;
  const summary = boundedText(value.summary, 1200);
  if (!summary || !Array.isArray(value.subtasks) || value.subtasks.length < 2 || value.subtasks.length > 3) return null;
  const subtasks = [];
  const titles = new Set();
  for (const row of value.subtasks) {
    if (!ownKeys(row, ["title", "prompt", "files", "acceptance"])) return null;
    const title = boundedText(row.title, 90), prompt = boundedText(row.prompt, 6000);
    if (!title || !prompt || titles.has(title.toLowerCase()) || !Array.isArray(row.files) || !row.files.length || row.files.length > 20
      || !Array.isArray(row.acceptance) || !row.acceptance.length || row.acceptance.length > 10) return null;
    const files = row.files.map(relativeFile), acceptance = row.acceptance.map((line) => boundedText(line, 600));
    if (files.some((file) => !file) || acceptance.some((line) => !line)) return null;
    const uniqueFiles = [...new Map(files.map((file) => [file.toLowerCase(), file])).values()];
    titles.add(title.toLowerCase());
    subtasks.push({ title, prompt, files: uniqueFiles, acceptance });
  }
  return { summary, subtasks };
}

function parsePlan(text) {
  if (typeof text !== "string" || text.length > 30000) return null;
  try { return normalizePlan(JSON.parse(text)); } catch { return null; }
}

function sameProject(parent, ref, entry) {
  const ids = [parent.projectId, ref.projectId, entry.projectId].filter((value) => value != null);
  if (new Set(ids).size > 1) return false;
  const paths = [parent.projectPath, ref.projectPath, entry.projectPath].filter(Boolean)
    .map((value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
  return new Set(paths).size <= 1;
}

// One delegated slice as a card, the same for a fresh admission and for the
// recovery of a saved one: the admission module's skeleton plus the lineage
// the prerequisite gate and the parent's integration read.
function childRow({ id, subtask, parent, parentTaskId, parentRequestKey = null, scope, fromRun, depth, projectId, projectPath, pin = false, pinAt = null, thinkerPin = null, createdAt, now, log }) {
  return taskRow({
    id, title: subtask.title, prompt: subtask.prompt, files: subtask.files, acceptance: subtask.acceptance,
    source: "agent", parent: String(parent.title ?? "").slice(0, 90), parentTaskId, fromRun, depth,
    ...(projectId != null ? { projectId } : {}), ...(projectPath ? { projectPath } : {}),
    // A pin the thinker set stays the thinker's on its slices (thinkerPin
    // equal to pinAt), so they are not counted as the owner's work.
    ...(pin === true ? { pin: true, ...(pinAt != null ? { pinAt } : {}), ...(pinAt != null && thinkerPin === pinAt ? { thinkerPin } : {}) } : {}),
    delegatedFrom: { parentTaskId, ...(parentRequestKey ? { parentRequestKey } : {}), scope,
      parentTitle: String(parent.title ?? "").slice(0, 160), parentPrompt: String(parent.prompt ?? parent.description ?? "").slice(0, 24000) },
    createdAt,
  }, { now, log, origin: { kind: "delegation", by: "agent" } });
}

function admit(board, { kind, ref, entry, plan, scope, now = Date.now(), nest = false, maxDepth = 3 } = {}) {
  const rejected = (reason) => ({ admitted: false, added: 0, childTaskIds: [], reason });
  if (!object(board) || !["task", "request"].includes(kind) || !object(ref) || !entry?.id || typeof scope !== "string") return rejected("Invalid task delegation");
  const normalized = normalizePlan(plan);
  if (!normalized) return rejected("A valid scoped subtask plan is required");
  const collection = kind === "task" ? board.tasks : board.requests;
  const parent = (Array.isArray(collection) ? collection : []).find((row) => object(row)
    && (kind === "task" ? row.id === ref.id : requestKey(row) === requestKey(ref)));
  if (!parent || !sameProject(parent, ref, entry)) return rejected("The parent task belongs to another project or is missing");
  if (buildScope(parent) !== scope) return rejected("The parent scope changed");
  if (parent.delegation?.fromRun === entry.id && parent.delegation.scope === scope) {
    if (parent.delegation.version !== 1 || !Array.isArray(parent.delegation.childTaskIds)) return rejected("The saved delegation is incomplete");
    return { admitted: true, added: 0, childTaskIds: [...parent.delegation.childTaskIds], parent };
  }
  // The host has just checkpointed this claim. Only the saved continuation
  // from before the claim can identify an interrupted implementation run.
  if (parent.runId !== entry.id || !canPlan({ ...parent, runProgress: entry.resumeCheckpoint ?? null }, { nest, maxDepth })) return rejected("The parent claim or scope changed");
  if (kind === "task" && !parent.id) return rejected("The parent task has no stable identity");
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const parentTaskId = kind === "task" ? parent.id : null;
  const parentRequestKey = kind === "request" ? requestKey(parent) : null;
  const identity = [entry.projectId ?? parent.projectId ?? null, parentTaskId ?? parentRequestKey, scope];
  const projectId = parent.projectId ?? entry.projectId;
  const projectPath = parent.projectPath ?? entry.projectPath;
  const children = normalized.subtasks.map((subtask, index) => childRow({
    id: `task_delegate_${digest([...identity, index]).slice(0, 24)}`, subtask, parent, parentTaskId, parentRequestKey, scope,
    fromRun: entry.id, depth: (Number(parent.depth) || 0) + 1, projectId, projectPath, pin: parent.pin, pinAt: parent.pinAt, thinkerPin: parent.thinkerPin,
    createdAt: now, now, log: `Subtask delegated from ${String(parent.title || "the shared task").slice(0, 90)}`,
  }));
  // A partially written or unrelated row must never be replaced. The board
  // transaction writes the complete family together, so ordinary replay is
  // handled by the parent's saved delegation above.
  if (children.some((child) => tasks.some((task) => task?.id === child.id))) return rejected("A delegated task identity is already present");
  const childTaskIds = children.map((child) => child.id);
  const admissions = children.map(({ logs, delegatedFrom, ...child }) => {
    const { parentPrompt, ...lineage } = delegatedFrom;
    return { ...child, delegatedFrom: lineage };
  });
  parent.delegation = { version: 1, childTaskIds, summary: normalized.summary, scope, fromRun: entry.id, admissions,
    ...(projectId != null ? { projectId } : {}), ...(projectPath ? { projectPath } : {}) };
  if (kind === "task") parent.status = "open";
  else delete parent.status;
  for (const key of ["runId", "lease", "runningAt", "runProgress"]) delete parent[key];
  parent.updatedAt = now;
  parent.logs = [...(Array.isArray(parent.logs) ? parent.logs : []), { at: now, kind: "status", text: `Delegated ${children.length} subtasks; integration waits for their verified results` }].slice(-40);
  board.tasks = [...children, ...tasks];
  return { admitted: true, added: children.length, childTaskIds, parent };
}

// File fallback can save the request coordinator before its task-file write
// succeeds. Its immutable admission snapshots recover those exact children;
// missing children without snapshots remain blocked rather than invented.
function reconcile(board, { now = Date.now() } = {}) {
  if (!object(board)) return { recovered: 0, changed: false };
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const present = new Set(tasks.map((task) => task?.id).filter(Boolean));
  const additions = [];
  const parents = [...tasks.map((parent) => ({ kind: "task", parent })),
    ...(Array.isArray(board.requests) ? board.requests : []).map((parent) => ({ kind: "request", parent }))];
  for (const { kind, parent } of parents) {
    if (!object(parent) || parent.absorbedInto || ["done", "archived", "absorbed"].includes(parent.status)) continue;
    const saved = parent.delegation;
    if (saved?.version !== 1 || typeof saved.fromRun !== "string" || !saved.fromRun || typeof saved.scope !== "string" || !/^[a-f0-9]{64}$/.test(saved.scope)
      || !Array.isArray(saved.childTaskIds) || !Array.isArray(saved.admissions) || !sameProject(parent, parent, saved)) continue;
    const ids = saved.childTaskIds;
    if (ids.length < 2 || ids.length > 3 || ids.some((id) => typeof id !== "string" || !/^task_delegate_[a-f0-9]{24}$/.test(id)) || new Set(ids).size !== ids.length || saved.admissions.length !== ids.length) continue;
    // Promotion can leave its inbox copy until compaction. The durable task
    // coordinator owns recovery from then on, including when already done.
    if (kind === "request" && tasks.some((task) => task?.delegation?.version === 1
      && task.delegation.fromRun === saved.fromRun && task.delegation.scope === saved.scope
      && Array.isArray(task.delegation.childTaskIds) && task.delegation.childTaskIds.length === ids.length
      && ids.every((id) => task.delegation.childTaskIds.includes(id)) && sameProject(task, parent, saved))) continue;
    const snapshots = saved.admissions;
    const plan = normalizePlan({ summary: saved.summary, subtasks: snapshots.map((row) => ({
      title: row?.title, prompt: row?.prompt, files: row?.files, acceptance: row?.acceptance,
    })) });
    if (!plan || snapshots.some((row, index) => !object(row) || row.id !== ids[index] || row.fromRun !== saved.fromRun
      || row.delegatedFrom?.scope !== saved.scope || row.delegatedFrom.parentTaskId !== row.parentTaskId
      || !sameProject(row, parent, saved)
      || (row.parentTaskId ? kind !== "task" || row.parentTaskId !== parent.id : typeof row.delegatedFrom.parentRequestKey !== "string" || !row.delegatedFrom.parentRequestKey))) continue;
    for (const [index, snapshot] of snapshots.entries()) {
      // Even a foreign or malformed row with this ID must not be overwritten.
      // The ordinary prerequisite gate exposes it as missing or unfinished.
      if (present.has(snapshot.id)) continue;
      const child = childRow({
        id: snapshot.id, subtask: plan.subtasks[index], parent: { ...parent, title: parent.title ?? snapshot.parent },
        parentTaskId: kind === "task" ? parent.id : null, parentRequestKey: snapshot.delegatedFrom.parentRequestKey, scope: saved.scope,
        fromRun: saved.fromRun, depth: Math.min(3, Math.max(1, Number(snapshot.depth) || 1)),
        projectId: snapshot.projectId, projectPath: snapshot.projectPath, pin: snapshot.pin, pinAt: snapshot.pinAt, thinkerPin: snapshot.thinkerPin,
        createdAt: Number(snapshot.createdAt) || now, now, log: "Recovered the saved subtask admission after an interrupted board save",
      });
      additions.push(child); present.add(child.id);
    }
  }
  if (additions.length) board.tasks = [...additions, ...tasks];
  return { recovered: additions.length, changed: additions.length > 0 };
}

// "Mefi sizes it" (Vibe's box, scripts/request-sizing.cjs): the owner's own
// card is split into steps when it is admitted, before any worker claims it.
// The steps are the card's delegated slices, so they take every path a
// delegated slice takes (the "Shared task assignment" brief, the prerequisite
// gate, verification) and the card waits for them, then runs as the final
// integration and check. They are the owner's work (origin by "owner"), pinned
// with the card, and may wait on earlier steps. One transaction writes the
// whole family, so there is nothing half-admitted to recover later.
function admitIntake(board, { parentId, plan, now = Date.now() } = {}) {
  const rejected = (reason) => ({ admitted: false, added: 0, childTaskIds: [], reason });
  if (!object(board) || !Array.isArray(board.tasks) || typeof parentId !== "string" || !object(plan) || !Array.isArray(plan.steps)) return rejected("Invalid intake split");
  const parent = board.tasks.find((row) => object(row) && row.id === parentId);
  if (!parent) return rejected("The card to split is not on the board");
  if (parent.delegation || parent.runId || parent.lease || (parent.status && parent.status !== "open")) return rejected("The card is already running or split");
  const steps = plan.steps;
  if (steps.length < 2 || steps.length > 6) return rejected("A split needs two to six steps");
  const scope = buildScope(parent);
  const ids = steps.map((step, index) => `task_intake_${digest([parent.id, scope, index, step.title]).slice(0, 24)}`);
  if (ids.some((id) => board.tasks.some((task) => task?.id === id))) return rejected("A step with this identity is already on the board");
  const idOf = new Map(steps.map((step, index) => [step.id, ids[index]]));
  const lineage = { parentTaskId: parent.id, scope, intake: true, parentTitle: String(parent.title ?? "").slice(0, 160) };
  const children = steps.map((step, index) => taskRow({
    id: ids[index], title: step.title, prompt: step.prompt, acceptance: [...step.acceptance],
    dependsOn: (step.dependsOn || []).map((dep) => idOf.get(dep)).filter(Boolean),
    source: parent.source ?? "chat", parent: String(parent.title ?? "").slice(0, 90), parentTaskId: parent.id, depth: 1,
    ...(parent.projectId != null ? { projectId: parent.projectId } : {}), ...(parent.projectPath ? { projectPath: parent.projectPath } : {}),
    ...(parent.pin === true ? { pin: true, ...(parent.pinAt != null ? { pinAt: parent.pinAt } : {}) } : {}),
    delegatedFrom: { ...lineage, parentPrompt: String(parent.prompt ?? "").slice(0, 24000) },
    intakeStep: { index: index + 1, of: steps.length },
    createdAt: now,
  }, { now, log: `Step ${index + 1} of ${steps.length} for ${String(parent.title || "your request").slice(0, 90)}`, origin: { kind: "intake", by: "owner" } }));
  parent.delegation = {
    version: 1, intake: true, childTaskIds: ids, summary: String(plan.summary ?? "").slice(0, 400), scope, fromRun: `intake:${parent.id}`,
    // The steps as admitted, for the pipeline view's titles (pipelines.cjs).
    admissions: children.map(({ logs, delegatedFrom, ...child }) => { const { parentPrompt, ...kept } = delegatedFrom; return { ...child, delegatedFrom: kept }; }),
    ...(parent.projectId != null ? { projectId: parent.projectId } : {}), ...(parent.projectPath ? { projectPath: parent.projectPath } : {}),
  };
  parent.updatedAt = now;
  parent.logs = [...(Array.isArray(parent.logs) ? parent.logs : []), { at: now, kind: "status", text: `Split into ${children.length} steps; this card runs the final integration and check once they are verified` }].slice(-40);
  board.tasks = [...children, ...board.tasks];
  return { admitted: true, added: children.length, childTaskIds: ids, parent };
}

// Undo an intake split in one board transaction. Ordinary drop refuses a
// prerequisite, so dropping the children one at a time can never undo it.
function collapseIntake(board, { parentId, jobs = [], now = Date.now() } = {}) {
  const parent = board.tasks.find((task) => task.id === parentId);
  if (!parent?.delegation?.intake) return { ok: false, error: "This task is no longer split into steps." };
  const ids = new Set(parent.delegation.childTaskIds);
  const children = board.tasks.filter((task) => ids.has(task.id));
  const family = [parent, ...children];
  if (family.some((task) => task.runId || task.lease || ["active", "running", "awaiting_verification", "verifying"].includes(task.status) || jobs.some((job) => job.taskId === task.id))) {
    return { ok: false, error: "Let the running steps and checks finish before making this one task." };
  }
  if (children.length !== ids.size || children.some((task) => task.parentTaskId !== parentId || task.delegatedFrom?.scope !== parent.delegation.scope)) return { ok: false, error: "The saved steps changed. Reload this project before merging them." };
  const pending = children.filter((task) => !["done", "archived"].includes(task.status));
  const pendingIds = new Set(pending.map((task) => task.id));
  if (board.tasks.some((task) => task.id !== parentId && !ids.has(task.id) && !["done", "archived"].includes(task.status) && [...(task.dependsOn || []), ...(task.delegation?.childTaskIds || [])].some((id) => pendingIds.has(id)))) return { ok: false, error: "Other tasks depend on these steps. Remove their prerequisite links first." };
  for (const task of pending) {
    task.status = "archived";
    task.dropped = { at: now, by: "owner" };
    task.updatedAt = now;
    for (const field of ["pin", "pinAt", "buildApproval", "nextRunAt"]) delete task[field];
    task.logs = [...(task.logs || []), { at: now, kind: "status", text: "Dropped when you made the request one task" }].slice(-40);
  }
  delete parent.delegation;
  delete parent.buildApproval;
  parent.updatedAt = now;
  parent.logs = [...(parent.logs || []), { at: now, kind: "status", text: "Made one task; completed steps are kept and unstarted steps are dropped" }].slice(-40);
  return { ok: true, revisionKind: "edited", revisionNote: "Request made one task" };
}

module.exports = { canPlan, parsePlan, admit, admitIntake, collapseIntake, reconcile };
