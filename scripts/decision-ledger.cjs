// Saved automatic decisions and reversible task fields.
// Pure module: no Electron, no filesystem, no network, no clock reads.
"use strict";

const FIELDS = Object.freeze(["status", "nextRunAt", "lastRunError", "runId", "lease", "runFailures", "startFailures", "providerFailures", "verification", "verificationReceiptId", "verifyAttempts", "doneAt", "pin", "pinAt", "buildApproval", "loopGuard", "ownerHold", "duplicateOf", "familyDecision", "churnDecision", "decisions", "logs", "grants", "updatedAt"]);
const rows = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function snapshot(tasks, ids) {
  const wanted = new Set(ids);
  return rows(tasks).filter((task) => wanted.has(task.id)).map((task) => ({ id: task.id, fields: clone(Object.fromEntries(FIELDS.filter((key) => task[key] !== undefined).map((key) => [key, task[key]]))) }));
}

function held(task) { return Boolean(task?.runId || task?.lease || ["active", "running", "verifying", "awaiting_verification"].includes(task?.status)); }

function restore(tasks, decision, now) {
  const before = rows(decision.before), after = rows(decision.after);
  const affected = new Set([...before.map((row) => row.id), ...rows(decision.createdTaskIds)]);
  const busy = rows(tasks).filter((task) => affected.has(task.id) && held(task));
  if (busy.length) return { ok: true, pending: true, tasks: tasks.map((task) => affected.has(task.id) ? { ...task, autonomyUndo: decision.id } : task) };
  const conflicts = [];
  const result = tasks.map((task) => {
    if (!affected.has(task.id)) return task;
    const original = before.find((row) => row.id === task.id);
    const applied = after.find((row) => row.id === task.id);
    if (!original) {
      // A split that has already run is kept: undo must not erase its work.
      if (task.lastAttempt || task.doneAt || task.ownerHold) { conflicts.push(task.id); return task; }
      return { ...task, status: "archived", dropped: { at: now, by: "undo", reason: "Automatic split undone" }, autonomyUndo: null };
    }
    const next = { ...task };
    for (const key of FIELDS) {
      if (equal(original.fields[key], applied?.fields?.[key])) continue;
      // Keep subsequent edits and worker evidence. Undo affects only the
      // fields still bearing this decision's own value.
      if (!equal(task[key], applied?.fields?.[key])) { if (!["logs", "updatedAt", "status", "runId", "lease"].includes(key)) conflicts.push(`${task.id}:${key}`); continue; }
      if (original.fields[key] === undefined) delete next[key];
      else next[key] = clone(original.fields[key]);
    }
    delete next.autonomyUndo;
    next.logs = [...rows(next.logs), { at: now, kind: "decision", text: "You undid Mefi's decision; its ask is open again." }].slice(-40);
    next.updatedAt = now;
    // assistantRetries deliberately stays: Undo never refunds automatic budgets.
    return next;
  });
  return { ok: true, tasks: result, conflicts: [...new Set(conflicts)], pending: false };
}

function normalize(rowsIn) {
  return rows(rowsIn).filter((row) => row && typeof row.id === "string" && Number.isFinite(row.at)).slice(-300).map((row) => ({
    ...clone(row), before: rows(row.before).slice(0, 40), after: rows(row.after).slice(0, 40), createdTaskIds: rows(row.createdTaskIds).slice(0, 20),
    reason: String(row.reason ?? "").slice(0, 400), label: String(row.label ?? "").slice(0, 120),
  }));
}

module.exports = { FIELDS, snapshot, restore, held, normalize };
