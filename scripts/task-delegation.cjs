// A coordinator may split an owned task into durable implementation slices.
// This pure module runs inside the board mutation gateway. Children use the
// ordinary executor, approval, file-claim and verification paths.
const { createHash } = require("node:crypto");
const { buildScope } = require("./backlog.cjs");
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownKeys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const boundedText = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value.trim() : null;
const requestKey = (ref) => ref.id ? `id:${String(ref.id)}` : `request:${digest([ref.at ?? null, ref.prompt ?? null, ref.fromRun ?? null, ref.handoffId ?? null])}`;

function canPlan(ref) {
  return Boolean(object(ref) && !ref.delegation && !ref.delegatedFrom && !ref.handoffId && !ref.fromRun && !ref.parentTaskId
    && !(Number(ref.depth) > 0) && !ref.runProgress?.pending && !ref.interruptedAttempt && !ref.resumeCheckpoint);
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

function admit(board, { kind, ref, entry, plan, scope, now = Date.now() } = {}) {
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
  if (parent.runId !== entry.id || !canPlan({ ...parent, runProgress: entry.resumeCheckpoint ?? null })) return rejected("The parent claim or scope changed");
  if (kind === "task" && !parent.id) return rejected("The parent task has no stable identity");
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const parentTaskId = kind === "task" ? parent.id : null;
  const parentRequestKey = kind === "request" ? requestKey(parent) : null;
  const identity = [entry.projectId ?? parent.projectId ?? null, parentTaskId ?? parentRequestKey, scope];
  const projectId = parent.projectId ?? entry.projectId;
  const projectPath = parent.projectPath ?? entry.projectPath;
  const children = normalized.subtasks.map((subtask, index) => ({
    id: `task_delegate_${digest([...identity, index]).slice(0, 24)}`,
    title: subtask.title, prompt: subtask.prompt, files: subtask.files, acceptance: subtask.acceptance,
    status: "open", source: "agent", parent: String(parent.title ?? "").slice(0, 90), parentTaskId,
    fromRun: entry.id, depth: (Number(parent.depth) || 0) + 1,
    ...(projectId != null ? { projectId } : {}), ...(projectPath ? { projectPath } : {}),
    ...(parent.pin === true ? { pin: true, ...(parent.pinAt != null ? { pinAt: parent.pinAt } : {}) } : {}),
    delegatedFrom: { parentTaskId, ...(parentRequestKey ? { parentRequestKey } : {}), scope,
      parentTitle: String(parent.title ?? "").slice(0, 160), parentPrompt: String(parent.prompt ?? parent.description ?? "").slice(0, 24000) },
    createdAt: now, updatedAt: now,
    logs: [{ at: now, kind: "status", text: `Subtask delegated from ${String(parent.title || "the shared task").slice(0, 90)}` }],
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
      const part = plan.subtasks[index];
      const child = {
        id: snapshot.id, title: part.title, prompt: part.prompt, files: part.files, acceptance: part.acceptance,
        status: "open", source: "agent", parent: String(parent.title ?? snapshot.parent ?? "").slice(0, 90),
        parentTaskId: kind === "task" ? parent.id : null, fromRun: saved.fromRun,
        depth: Math.min(3, Math.max(1, Number(snapshot.depth) || 1)),
        ...(snapshot.projectId != null ? { projectId: snapshot.projectId } : {}), ...(snapshot.projectPath ? { projectPath: snapshot.projectPath } : {}),
        ...(snapshot.pin === true ? { pin: true, ...(snapshot.pinAt != null ? { pinAt: snapshot.pinAt } : {}) } : {}),
        delegatedFrom: { parentTaskId: kind === "task" ? parent.id : null,
          ...(snapshot.delegatedFrom.parentRequestKey ? { parentRequestKey: snapshot.delegatedFrom.parentRequestKey } : {}),
          scope: saved.scope, parentTitle: String(parent.title ?? "").slice(0, 160), parentPrompt: String(parent.prompt ?? parent.description ?? "").slice(0, 24000) },
        createdAt: Number(snapshot.createdAt) || now, updatedAt: now,
        logs: [{ at: now, kind: "status", text: "Recovered the saved subtask admission after an interrupted board save" }],
      };
      additions.push(child); present.add(child.id);
    }
  }
  if (additions.length) board.tasks = [...additions, ...tasks];
  return { recovered: additions.length, changed: additions.length > 0 };
}

module.exports = { canPlan, parsePlan, admit, reconcile };
