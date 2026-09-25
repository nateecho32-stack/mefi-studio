// Durable work delegated by a finished executor attempt. This module only
// transforms Studio board records; it never runs a worker or a model call.
const crypto = require("node:crypto");
const { completedTask, droppedTask, workState } = require("./backlog.cjs");
// Handed-on work is admitted by its identity (the run and the admission id),
// with the one admission module's title key and identity rule.
const { titleKey, sameHandoff } = require("./work-admission.cjs");
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
const handoffId = (runId, index) => `handoff_${crypto.createHash("sha256").update(`${runId}:${index}`).digest("hex").slice(0, 24)}`;

// Every run is a board task's (dispatch is task-only), so the job's card is
// the parent.
function captureTaskHandoffs(entry, job, { now = Date.now(), maxDepth = 3, limit = 3 } = {}) {
  if (!entry?.id || Number(entry.depth) >= maxDepth) return [];
  return rows(entry.handoffs).slice(0, limit).filter((item) => String(item.title ?? "").trim() && String(item.prompt ?? "").trim()).map((item, index) => ({
    id: handoffId(entry.id, index), handoffId: handoffId(entry.id, index),
    title: String(item.title).trim(), originalTitle: String(item.title).trim(), prompt: String(item.prompt).trim(),
    source: "agent", at: now, depth: (Number(entry.depth) || 0) + 1,
    parent: String(job?.title ?? "").slice(0, 90), parentTaskId: job?.ref?.id ?? null,
    fromRun: entry.id,
  }));
}

const matchesHandoff = (row, obligation) => sameHandoff(row, obligation);

function representedTasksOf(tasks) {
  const represented = [...rows(tasks)], ids = new Set(represented.map((row) => row.id));
  // A grouped snapshot represents its saved child even if the separate
  // absorbed row was lost. The live/done plan controls that child's state.
  for (const plan of rows(tasks)) for (const member of rows(plan.members)) {
    if (!plan.id || !member.id || ids.has(member.id) || !member.handoffId || !member.fromRun) continue;
    represented.push({ ...member, absorbedInto: plan.id }); ids.add(member.id);
  }
  return represented;
}

function admitTaskHandoffs({ tasks = [], requests = [] }, obligations = []) {
  const next = [...requests]; let added = 0;
  const representedTasks = representedTasksOf(tasks);
  for (const obligation of rows(obligations)) {
    if (!obligation.handoffId || !obligation.fromRun || !obligation.title || !obligation.prompt) continue;
    if ([...representedTasks, ...rows(next)].some((row) => matchesHandoff(row, obligation))) continue;
    const originalTitle = String(obligation.originalTitle ?? obligation.title);
    const displayTitle = originalTitle.slice(0, 90);
    const unrelated = [...representedTasks, ...rows(next)].filter((row) => !matchesHandoff(row, obligation));
    // Existing title heuristics must not confuse a new delegated obligation
    // with unrelated work. Pick the display name inside the board mutation;
    // the immutable original title and admission ID keep parent resolution
    // exact and prevent repeated recovery from adding another suffix.
    const collides = unrelated.some((row) => titleKey(String(row.title ?? "").slice(0, 90)) === titleKey(displayTitle));
    const suffix = ` — follow-up ${String(obligation.handoffId).slice(-6)}`;
    const title = collides ? displayTitle.slice(0, 90 - suffix.length).trimEnd() + suffix : displayTitle;
    next.push({ ...obligation, originalTitle, title, origin: obligation.origin ?? { kind: "handoff", by: "agent" } }); added += 1;
  }
  return { requests: next, added };
}

// Parents are awaiting_verification tasks only. A "verifying" inbox row (an
// older build's direct run) is not one: housekeeping migrates it into an
// awaiting_verification task before this runs (scripts/task-history.mjs), and
// that task follows the same children by run and handoff identity.
function reconcileTaskHandoffs({ tasks = [], requests = [], now = Date.now() } = {}) {
  let nextRequests = [...requests];
  let changed = false, recovered = 0;
  const waitingTaskIds = new Set();
  // Group snapshots are durable obligations too. If an absorbed member row
  // was lost, its plan still represents the saved lineage and must not race
  // a regenerated copy of the same admitted child.
  const representedTasks = representedTasksOf(tasks);
  const byId = new Map(representedTasks.map((row) => [row.id, row]));
  const effectiveTask = (row) => {
    const seen = new Set();
    while (row?.absorbedInto && byId.has(row.absorbedInto) && !seen.has(row.id)) {
      seen.add(row.id); row = byId.get(row.absorbedInto);
    }
    return row;
  };
  const reconcile = (parent) => {
    if (!parent || parent.status !== "awaiting_verification") return parent;
    const runId = parent.lastAttempt?.runId;
    if (!runId) return parent;
    let obligations = rows(parent.lastAttempt?.handoffs).filter((row) => row.fromRun === runId && row.handoffId);
    // Legacy attempts saved titles and child lineage but not an admission
    // snapshot. Follow only actual matching children; never invent scope.
    if (!obligations.length) obligations = (Array.isArray(parent.remaining) ? parent.remaining : []).map((title) =>
      [...representedTasks, ...rows(nextRequests)].find((row) => row.fromRun === runId && titleKey(row.originalTitle ?? row.title) === titleKey(title))
    ).filter(Boolean);
    if (!obligations.length) return parent;
    let pending = 0, blocked = 0;
    const resolvedTitles = new Set(), droppedTitles = [], childIds = [];
    // The owner's word settles an obligation too: a follow-up they dropped
    // (closed unfinished), or deleted, which the host records on this parent
    // (droppedHandoffs) so the recovery below never re-admits it. The record
    // stands in only for a card that is gone: a dropped card reopened is
    // waited on again.
    const droppedIds = new Set(Array.isArray(parent.droppedHandoffs) ? parent.droppedHandoffs : []);
    for (const obligation of obligations) {
      const children = representedTasks.filter((row) => matchesHandoff(row, obligation));
      if (children.some((row) => completedTask(effectiveTask(row)))) {
        resolvedTitles.add(titleKey(obligation.originalTitle ?? obligation.title)); childIds.push(...children.filter((row) => completedTask(effectiveTask(row))).map((row) => row.id));
        continue;
      }
      if (children.length ? children.every((row) => droppedTask(effectiveTask(row))) : Boolean(obligation.handoffId && droppedIds.has(obligation.handoffId))) {
        resolvedTitles.add(titleKey(obligation.originalTitle ?? obligation.title)); droppedTitles.push(obligation.originalTitle ?? obligation.title);
        childIds.push(...children.map((row) => row.id));
        continue;
      }
      let queued = rows(nextRequests).filter((row) => matchesHandoff(row, obligation));
      if (!children.length && !queued.length) {
        // Only full persisted admission records may regenerate missing work.
        const admitted = admitTaskHandoffs({ tasks, requests: nextRequests }, [obligation]);
        nextRequests = admitted.requests; recovered += admitted.added; changed ||= admitted.added > 0;
        queued = rows(nextRequests).filter((row) => matchesHandoff(row, obligation));
      }
      pending += 1;
      const represented = children.length ? children : queued;
      if (!represented.length || represented.every((row) => workState(effectiveTask(row), now, { tasks }).stage === "blocked")) blocked += 1;
      childIds.push(...children.map((row) => row.id));
    }
    const original = Array.isArray(parent.remaining) ? parent.remaining : [];
    const remaining = original.filter((title) => !resolvedTitles.has(titleKey(title)));
    const handoffState = {
      state: blocked ? "blocked" : pending ? "waiting" : "complete",
      pending, blocked, childTaskIds: [...new Set(childIds)],
      resolvedTitles: obligations.filter((row) => resolvedTitles.has(titleKey(row.originalTitle ?? row.title))).map((row) => row.originalTitle ?? row.title),
      ...(droppedTitles.length ? { droppedTitles } : {}),
      reason: blocked ? `${blocked} delegated task${blocked === 1 ? " needs" : "s need"} review before this parent can finish` : pending ? `Waiting for ${pending} delegated task${pending === 1 ? "" : "s"} to finish` : droppedTitles.length ? `Delegated work has finished or was dropped by you (${droppedTitles.length} dropped)` : "Delegated work has finished",
    };
    if (pending) waitingTaskIds.add(parent.id);
    if (JSON.stringify(remaining) === JSON.stringify(original) && JSON.stringify(handoffState) === JSON.stringify(parent.handoffState)) return parent;
    changed = true;
    return { ...parent, remaining, handoffState };
  };
  const nextTasks = tasks.map(reconcile);
  return { tasks: nextTasks, requests: nextRequests, waitingTaskIds, changed, recovered };
}

module.exports = { captureTaskHandoffs, admitTaskHandoffs, reconcileTaskHandoffs };
