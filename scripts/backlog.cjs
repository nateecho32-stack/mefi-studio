// One eligibility vocabulary for dispatch and the project workbench. Pure:
// reading a backlog never changes work, retries it, or starts a model call.
const { createHash } = require("node:crypto");
const key = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];

// Approval names the saved work, not an editable status flag. Include nested
// obligations and references; claim timestamps and run telemetry are not scope.
const BUILD_SCOPE_FIELDS = ["id", "projectId", "projectPath", "title", "prompt", "description", "details", "note", "notes", "context", "handoff", "ideaDetail", "refs", "files", "file", "ideas", "dependsOn", "members", "remaining", "blockers", "acceptance", "acceptanceCriteria", "requirements", "constraints", "scope", "sessions", "problemFiles", "source", "parent", "parentRunId", "fromRun", "handoffId", "depth", "planningId", "planningSpecId", "planningTaskId"];
function buildScope(item) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;
  const scope = Object.fromEntries(BUILD_SCOPE_FIELDS.filter((name) => item?.[name] !== undefined).map((name) => [name, item[name]]));
  return createHash("sha256").update(JSON.stringify(canonical(scope))).digest("hex");
}

function hasBuildApproval(item) {
  return item?.buildApproval?.version === 1 && item.buildApproval.scope === buildScope(item);
}

function buildAllowed(item, { autoBuild = true } = {}) {
  return autoBuild !== false || hasBuildApproval(item);
}

function dependencyIds(item) {
  const explicit = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
  const delegated = item?.delegation?.version === 1 && Array.isArray(item.delegation.childTaskIds) ? item.delegation.childTaskIds : [];
  return [...new Set([...explicit, ...delegated].filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
}

function completedTask(task) {
  return task?.status === "done" || (task?.status === "archived" && Boolean(task.doneAt || task.verification?.state === "verified" || task.completionFromTaskId));
}

function dependencyState(item, tasks = []) {
  const projectId = item?.projectId ?? item?.delegation?.projectId;
  const projectPath = item?.projectPath ?? item?.delegation?.projectPath;
  const normalizedPath = (value) => String(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const inProject = (task) => !(projectId != null && task.projectId != null && task.projectId !== projectId)
    && !(projectPath && task.projectPath && normalizedPath(task.projectPath) !== normalizedPath(projectPath));
  const byId = new Map(rows(tasks).filter(inProject).map((task) => [task.id, task]));
  const ids = dependencyIds(item);
  const dependencies = ids.map((id) => {
    const task = byId.get(id);
    return { id, title: task?.title || id, status: task?.status || "missing", done: completedTask(task) };
  });
  if (!ids.length) return { dependencies };
  const missing = dependencies.filter((task) => task.status === "missing");
  if (missing.length) return { stage: "blocked", reason: `Missing prerequisite: ${missing.map((task) => task.title).join(", ")}`, dependencies, blockedBy: "dependencies", canRetry: false };
  const visiting = new Set();
  const visited = new Set();
  const cyclic = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = id === item.id ? item : byId.get(id);
    if (dependencyIds(task).some(cyclic)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (cyclic(item.id)) return { stage: "blocked", reason: "Prerequisites form a cycle. Remove a link before this work can start.", dependencies, blockedBy: "dependencies", canRetry: false };
  const waiting = dependencies.filter((task) => !task.done);
  if (waiting.length) return { stage: "waiting", reason: `Waiting for ${waiting.map((task) => task.title).join(", ")} to finish successfully`, dependencies, blockedBy: "dependencies", canRetry: false };
  return { dependencies };
}

function validateDependencies(tasks, taskId, dependsOn) {
  if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)) return { ok: false, error: "Prerequisites must be task IDs from this project." };
  const item = rows(tasks).find((task) => task.id === taskId);
  if (!item) return { ok: false, error: "Choose a task from this project." };
  const next = { ...item, dependsOn: dependencyIds({ dependsOn }) };
  if (next.dependsOn.includes(taskId)) return { ok: false, error: "A task cannot depend on itself." };
  const state = dependencyState(next, tasks);
  if (state.stage === "blocked") return { ok: false, error: state.reason };
  return { ok: true, dependsOn: next.dependsOn };
}

function workState(item, now = Date.now(), { tasks = null, autoBuild = true } = {}) {
  if (item.absorbedInto) return { stage: "grouped", reason: "Included in a task group", groupId: item.absorbedInto };
  if (item.status === "done" || item.status === "archived") return { stage: "done", reason: item.status === "archived" ? "Archived completion" : "Completed" };
  if (item.status === "awaiting_verification" || item.status === "verifying") {
    if (item.handoffState?.pending > 0) return { stage: item.handoffState.state === "blocked" ? "blocked" : "waiting", reason: item.handoffState.reason || "Waiting for delegated work to finish", blockedBy: "handoffs", canRetry: false, childTaskIds: item.handoffState.childTaskIds ?? [] };
    if (item.delegation && Array.isArray(tasks)) {
      const delegated = dependencyState(item, tasks);
      if (delegated.stage) return delegated;
    }
    return { stage: "review", reason: "Run finished; checking its completion evidence" };
  }
  if (item.status === "active" || item.status === "running") return { stage: "running", reason: "A worker holds this task" };
  const dependency = Array.isArray(tasks) ? dependencyState(item, tasks) : { dependencies: [] };
  if (dependency.stage) return dependency;
  if (item.verification?.state === "failed" || Number(item.verifyAttempts) >= 3) {
    const attempts = Math.max(0, Number(item.verifyAttempts) || 0);
    return { stage: "blocked", reason: `Completion could not be verified${attempts ? ` after ${attempts} attempt${attempts === 1 ? "" : "s"}` : ""}. Review the result, then retry.` };
  }
  if (Number(item.runFailures) >= 5) return { stage: "blocked", reason: `${Number(item.runFailures)} attempts failed. Review the error, then retry.` };
  if (Number(item.nextRunAt) > now) return { stage: "cooling", reason: "Waiting before another attempt", retryAt: Number(item.nextRunAt) };
  if (item.status && item.status !== "open" && item.status !== "pending" && item.status !== "queued") return { stage: "blocked", reason: `Held (${String(item.status).slice(0, 40)})` };
  if (!buildAllowed(item, { autoBuild })) return { stage: "approval", reason: "Verify first: review this task and approve its build", canApprove: true, buildScope: buildScope(item), ...dependency };
  return { stage: "ready", reason: item.pin ? "You chose this to go next" : "Ready for an available worker", ...dependency };
}

function summarizeBacklog({ tasks = [], requests = [], ideas = [], jobs = [], compare, ideaEligible, now = Date.now(), paused = false, draining = false, waiting = null, lastError = null, parkedUntil = 0, autoBuild = true } = {}) {
  const board = rows(tasks);
  const heldIds = new Set(rows(jobs).map((job) => job.taskId).filter(Boolean));
  const taskStates = board.map((task) => ({ id: task.id, kind: "task", title: String(task.title ?? "Untitled task"), dependencies: dependencyState(task, board).dependencies, ...(heldIds.has(task.id) ? { stage: "running", reason: "A worker is building this task" } : workState(task, now, { tasks: board, autoBuild })) }));
  const represented = new Set(board.filter((task) => task.status !== "archived").map((task) => key(task.title)).filter(Boolean));
  const uniqueRequests = rows(requests).filter((request) => {
    const titleKey = key(request.title || request.prompt);
    if (titleKey && represented.has(titleKey)) return false;
    if (titleKey) represented.add(titleKey);
    return true;
  });
  const requestStates = uniqueRequests.map((request, index) => ({ id: request.id ?? `request_${index}`, kind: "request", title: String(request.title || request.prompt || "Queued request").slice(0, 120), ...workState(request, now, { tasks: board, autoBuild }) }));
  const all = [...taskStates, ...requestStates];
  const counts = Object.fromEntries(["ready", "running", "review", "blocked", "cooling", "done", "grouped", "waiting", "approval"].map((stage) => [stage, all.filter((row) => row.stage === stage).length]));
  counts.requests = requestStates.filter((item) => item.stage !== "done").length;
  const pendingIdeas = rows(ideas).filter((idea) => !idea.taskId && (!idea.status || ["new", "keep"].includes(idea.status)));
  counts.ideas = pendingIdeas.length;
  counts.eligibleIdeas = pendingIdeas.filter((idea) => typeof ideaEligible === "function" ? ideaEligible(idea) : Boolean(idea.id && idea.title && (idea.source !== "chat" || idea.status === "keep"))).length;
  counts.ideaNotes = counts.ideas - counts.eligibleIdeas;
  const ordered = [...board.map((ref, index) => ({ ref, state: taskStates[index] })), ...uniqueRequests.map((ref, index) => ({ ref, state: requestStates[index] }))]
    .filter(({ state }) => state.stage === "ready")
    .sort((a, b) => typeof compare === "function" ? compare(a.ref, b.ref) : (a.ref.createdAt ?? a.ref.at ?? 0) - (b.ref.createdAt ?? b.ref.at ?? 0));
  const retryTimes = all.map((row) => row.retryAt).filter(Number.isFinite);
  if (Number(parkedUntil) > now) retryTimes.push(Number(parkedUntil));
  const nextRetryAt = retryTimes.length ? Math.min(...retryTimes) : null;
  const hold = Number(parkedUntil) > now ? "Worker startup is cooling down after repeated failures" : paused ? "Paused. Current workers can finish; new work will wait." : waiting || (lastError && !counts.running ? String(lastError).slice(0, 240) : null);
  const summary = hold || (counts.running ? `${counts.running} building · ${counts.ready} ready next` : counts.ready ? `${counts.ready} ready to work on` : counts.approval ? `${counts.approval} tasks waiting for your approval` : counts.review ? `${counts.review} finished attempts awaiting verification` : counts.eligibleIdeas ? `${counts.eligibleIdeas} ideas ready to become tasks` : counts.blocked ? `${counts.blocked} tasks need your review` : counts.waiting ? `${counts.waiting} tasks waiting for prerequisites` : counts.cooling ? `${counts.cooling} tasks waiting before retry` : "Existing work is caught up");
  return { counts, taskStates, next: ordered.slice(0, 8).map(({ state }) => state), blocked: all.filter((row) => row.stage === "blocked").slice(0, 40), approval: all.filter((row) => row.stage === "approval").slice(0, 40), autoBuild: autoBuild !== false, paused, draining, mode: draining ? "backlog" : "balanced", waiting: hold, summary, nextRetryAt };
}

function retryTask(task, now = Date.now()) {
  const next = { ...task, status: "open", updatedAt: now, pin: true, pinAt: now };
  for (const name of ["runFailures", "nextRunAt", "lastRunError", "verifyAttempts", "verification", "verificationReceiptId", "doneAt", "runId", "lease", "buildApproval"]) delete next[name];
  // lastAttempt, remaining, refs, and logs are evidence, not retry switches.
  next.logs = [...rows(task.logs), { at: now, kind: "status", text: "Retry requested — previous result and remaining work retained" }].slice(-40);
  return next;
}

module.exports = { workState, summarizeBacklog, retryTask, dependencyState, dependencyIds, completedTask, validateDependencies, buildScope, hasBuildApproval, buildAllowed };
