// Legacy inbox rows from direct request execution, moved onto the task path.
// Only board tasks run now: an inbox request reaches a worker by promotion
// (main.cjs promoteRequestsToTasks), so the executor, its settlement and the
// verifier handle one kind of work. Rows an older build left mid-run are
// migrated once, inside the housekeeping mutation (autopilotHousekeepingPass),
// which is why this stays pure and synchronous.
import { createHash } from "node:crypto";
import workAdmission from "./work-admission.cjs";

const text = (value) => typeof value === "string" ? value : "";
const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clip = (value, max) => {
  const line = text(value).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
// What promotion keeps (main.cjs promoteRequestsToTasks): the request's own
// source, and its origin from the one helper promotion stamps with, so a
// migrated card ranks and reads like a promoted one.
const originFor = (request) => workAdmission.requestOrigin(request);

// A "verifying" row becomes the awaiting_verification task its verdict now
// settles through: the attempt (lastAttempt, runId, runProgress), the
// overseer's check (verificationRun), the obligations (remaining), what it was
// pointed at (target, sessions), the pin and the brief all ride along. A
// reported success ends the failure streak, as the task path's settle does.
function verifyingTask(request, { now, projectId, projectPath, title }) {
  const { status: _status, lease: _lease, runningAt: _runningAt, ...kept } = request;
  for (const name of ["lastRunError", "runFailures", "startFailures", "providerFailures", "nextRunAt"]) delete kept[name];
  const attempt = object(request.lastAttempt) ? request.lastAttempt : {};
  // One card per attempt: the same row seen again maps to the same id.
  const identity = attempt.runId || request.runId || JSON.stringify([
    request.projectId ?? request.projectPath ?? projectId ?? "", request.id ?? "", title, text(request.prompt), request.at ?? null, attempt.at ?? null,
  ]);
  const task = {
    ...kept,
    id: `task_${createHash("sha256").update(`legacy-request:${identity}`).digest("hex").slice(0, 16)}`,
    title,
    prompt: text(request.prompt),
    status: "awaiting_verification",
    color: "#e6c98d",
    origin: originFor(request),
    createdAt: Number(request.createdAt ?? request.at) || now,
    updatedAt: now,
    logs: [
      ...(Array.isArray(request.logs) ? request.logs : []),
      { at: now, kind: "status", text: "moved from the request inbox to the board — its finished run awaits verification" },
    ].slice(-40),
    ideas: Array.isArray(request.ideas) ? request.ideas : [],
    refs: Array.isArray(request.refs) ? request.refs : [],
  };
  if (!task.projectId && projectId) task.projectId = projectId;
  if (!task.projectPath && projectPath) task.projectPath = projectPath;
  return task;
}

// A direct run's checkpoint on an inbox row: kept as saved progress but no
// longer pending (promotion skips a pending row, and no request resumes on its
// own now), and kept as interruptedAttempt, which promotion carries onto the
// task and task-context quotes in its worker's brief, so the task continues
// from what the lost run left instead of starting blind. A row going back to
// the inbox is stamped requeuedAt, which the age prunes (housekeepingSweep,
// compact) read as its filing time: the sweep runs in the same mutation, and
// an auto-filed row filed more than 48 hours ago was deleted there, checkpoint
// and all, before promotion could take it.
function savedProgress(row, now) {
  const progress = row.runProgress;
  return {
    runProgress: { ...progress, pending: false },
    interruptedAttempt: object(row.interruptedAttempt) ? row.interruptedAttempt : { ...progress, pending: true, interruptedAt: Number(progress.interruptedAt) || now },
  };
}

// requests: the inbox as read inside the board lock. liveRuns: run ids a live
// owner still holds (this process's jobs, and claims a live process's lease
// covers). Returns the inbox without the migrated rows (a verifying row stays
// until its task is on the board), the tasks to add, the board tasks to
// replace (relinked), one note per migrated row, and changed (false: the same
// array came back).
//   "verifying"  → an awaiting_verification task (verifyingTask), in two
//                  phases: the task is added and the row kept, and a later pass
//                  that finds the task on the board drops the row. The file
//                  store writes the inbox before the tasks, so moving both in
//                  one mutation lost the finished attempt whenever the tasks
//                  write failed after the inbox write (or the app quit between
//                  them). A delegation coordinator's children were admitted
//                  under the request, so they name no parent task: each child
//                  in its delegation (same scope, no parent task yet) is
//                  relinked to the new task id, as promotion relinks a
//                  promoted coordinator's children.
//   "running"    → a claim no live owner holds goes back to the inbox with its
//                  checkpoint (status, runId, lease and runningAt stripped), so
//                  promotion turns it into a task. A lease without a usable pid
//                  is left to the sweep's lease timeout, as recovery leaves it.
//   a pending checkpoint on an unclaimed row (a stopped or recovered direct
//                  run) is kept the same way (savedProgress).
export function migrateLegacyRequests(requests, { tasks = [], liveRuns = new Set(), now = Date.now(), projectId = null, projectPath = null } = {}) {
  const rows = Array.isArray(requests) ? requests : [];
  const board = Array.isArray(tasks) ? tasks : [];
  const taken = new Set(board.map((task) => task?.id).filter(Boolean));
  // Duck-typed: the caller's Set may come from another realm (a vm host).
  const live = typeof liveRuns?.has === "function" ? liveRuns : new Set();
  const added = [];
  const notes = [];
  const kept = [];
  const relinked = new Map();
  const relink = (coordinator) => {
    const delegation = coordinator.delegation;
    if (!object(delegation) || !Array.isArray(delegation.childTaskIds)) return 0;
    const ids = new Set(delegation.childTaskIds);
    let count = 0;
    for (const child of board) {
      if (!object(child) || !ids.has(child.id) || child.parentTaskId || relinked.has(child.id) || child.delegatedFrom?.scope !== delegation.scope) continue;
      relinked.set(child.id, { ...child, parentTaskId: coordinator.id, delegatedFrom: { ...child.delegatedFrom, parentTaskId: coordinator.id } });
      count += 1;
    }
    return count;
  };
  let changed = false;
  for (const request of rows) {
    if (!object(request)) { kept.push(request); continue; }
    const title = workAdmission.requestTitle(request).slice(0, 90) || "Queued request";
    const named = clip(title, 60);
    if (request.status === "verifying") {
      const task = verifyingTask(request, { now, projectId, projectPath, title });
      changed = true;
      const children = relink(task);
      const lineage = children ? `; its ${children} delegated task${children === 1 ? "" : "s"} now name${children === 1 ? "s" : ""} it` : "";
      if (taken.has(task.id)) {
        // Phase two: the task is saved, so the row can go.
        notes.push(`legacy request "${named}" was verifying; its task ${task.id} is already on the board${lineage}`);
        continue;
      }
      // Phase one: the task is added and the row stays until a pass sees it.
      taken.add(task.id);
      added.push(task);
      kept.push(request);
      notes.push(`legacy request "${named}" was verifying; moved to the board as task ${task.id}, awaiting verification${lineage}`);
      continue;
    }
    if (request.status === "running") {
      const lease = request.lease;
      if ((request.runId && live.has(request.runId)) || (object(lease) && !(Number.isInteger(lease.pid) && lease.pid > 0))) {
        kept.push(request);
        continue;
      }
      const { status: _status, runId, lease: _lease, runningAt: _runningAt, ...next } = request;
      // The run was lost mid-attempt: its checkpoint is an interrupted
      // attempt now, whatever an earlier pass stamped there.
      if (object(next.runProgress)) Object.assign(next, savedProgress({ runProgress: next.runProgress }, now));
      next.requeuedAt = now;
      kept.push(next);
      changed = true;
      notes.push(`legacy request "${named}" was running (${runId || "no run id"}) with no live worker; back in the inbox for promotion`);
      continue;
    }
    if (!request.runId && object(request.runProgress) && request.runProgress.pending === true) {
      kept.push({ ...request, ...savedProgress(request, now), requeuedAt: now });
      changed = true;
      notes.push(`legacy request "${named}" held a resume checkpoint; kept as saved progress so promotion can take it`);
      continue;
    }
    kept.push(request);
  }
  return { requests: changed ? kept : rows, tasks: added, relinked: [...relinked.values()], notes, changed };
}
