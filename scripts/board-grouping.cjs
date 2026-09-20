// Explicit reviewed group requests are applied by the live host's board
// transaction. Scope hashes fence edits; durable operation stamps fence replay.
const { buildScope, dependencyIds } = require("./backlog.cjs");
const key = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function validateManifest(manifest) {
  if (!manifest || typeof manifest.operationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(manifest.operationId)) throw new Error("A reviewed grouping needs a unique operationId.");
  if (!Array.isArray(manifest.groups) || !manifest.groups.length || manifest.groups.length > 30) throw new Error("A reviewed grouping needs one to thirty groups.");
  const seen = new Set();
  for (const group of manifest.groups) {
    if (!group || typeof group.title !== "string" || !group.title.trim() || group.title.length > 120 ||
        !Array.isArray(group.taskIds) || group.taskIds.length < 2 || group.taskIds.length > 8 ||
        !Array.isArray(group.tasks) || group.tasks.length !== group.taskIds.length ||
        !Array.isArray(group.fingerprints) || group.fingerprints.length !== group.taskIds.length) throw new Error("Every reviewed group needs a title and two to eight task IDs, exact titles and scope fingerprints.");
    group.taskIds.forEach((id, index) => {
      if (typeof id !== "string" || !id || seen.has(id) || typeof group.tasks[index] !== "string" || !/^[a-f0-9]{64}$/.test(group.fingerprints[index])) throw new Error("Reviewed task identities must be unique and include valid scope fingerprints.");
      seen.add(id);
    });
  }
  return manifest;
}

function applyReviewedGroups({ tasks = [], ideas = [], manifest, manifestHash, heldTaskIds = [], now = Date.now(), groupTasks } = {}) {
  validateManifest(manifest);
  const operationId = manifest.operationId;
  const existing = tasks.filter((task) => task?.groupingOperationId === operationId && Array.isArray(task.members));
  if (existing.length) {
    if (existing.some((task) => task.groupingManifestHash !== manifestHash)) throw new Error("This operationId was already used for a different reviewed grouping.");
    return { tasks, ideas, operationId, alreadyApplied: true, absorbed: existing.reduce((count, plan) => count + plan.members.length, 0),
      plans: existing.map((plan) => ({ id: plan.id, title: plan.title, taskIds: plan.members.map((member) => member.id) })), skipped: [] };
  }
  const held = new Set(heldTaskIds), protectedIds = new Set();
  for (const task of tasks) {
    const dependencies = dependencyIds(task);
    if (task?.planningId || task?.handoffId || task?.fromRun || dependencies.length) protectedIds.add(task.id);
    for (const id of dependencies) protectedIds.add(id);
  }
  let outTasks = tasks, outIdeas = ideas, absorbed = 0;
  const plans = [], skipped = [];
  for (const group of manifest.groups) {
    let reason = null;
    for (let index = 0; index < group.taskIds.length; index += 1) {
      const id = group.taskIds[index], matching = outTasks.filter((task) => task?.id === id), task = matching[0];
      if (matching.length !== 1 || task.title !== group.tasks[index] || buildScope(task) !== group.fingerprints[index]) { reason = "A reviewed task was removed, renamed or its requirements changed."; break; }
      if (task.status !== "open" || task.runId || task.lease || held.has(id)) { reason = "A reviewed task is held by a worker or is no longer open."; break; }
      if (protectedIds.has(id) || String(id).startsWith("task_plan_") || task.runFailures > 0 || task.verifyAttempts > 0 || task.nextRunAt > now || task.verification?.state === "failed") { reason = "A reviewed task has prerequisites, handoff lineage, prior failures or a retry hold."; break; }
      if (outTasks.filter((item) => item?.status === "open" && key(item.title) === key(task.title)).length !== 1) { reason = "A reviewed title is ambiguous on the current board."; break; }
    }
    if (reason) { skipped.push({ title: group.title, taskIds: group.taskIds, reason }); continue; }
    const result = groupTasks({ tasks: outTasks, ideas: outIdeas, groups: [group], now, limits: { maxPlansPerPass: 1 } });
    if (result.absorbed !== group.taskIds.length || result.plans.length !== 1) {
      skipped.push({ title: group.title, taskIds: group.taskIds, reason: "The existing grouping rules no longer allow this complete group." });
      continue;
    }
    const plan = result.plans[0];
    outTasks = result.tasks.map((task) => task.id === plan.id ? { ...task, groupingOperationId: operationId, groupingManifestHash: manifestHash } : task);
    outIdeas = result.ideas;
    absorbed += result.absorbed;
    plans.push({ id: plan.id, title: plan.title, taskIds: group.taskIds });
  }
  return { tasks: outTasks, ideas: outIdeas, operationId, absorbed, plans, skipped };
}

module.exports = { fingerprint: buildScope, validateManifest, applyReviewedGroups };
