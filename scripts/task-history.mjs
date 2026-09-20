// Keep a verified inbox request on the task board after the inbox releases it.
// This is local history, with the same evidence as the verifier's decision.
import { createHash } from "node:crypto";
import { evidenceKind } from "./receipts.mjs";

const text = (value) => typeof value === "string" ? value : "";
const stamp = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;

export function completedRequestTask(request, verdict, { now = Date.now(), changedFiles = 0, receiptId = null } = {}) {
  if (!request || verdict?.state !== "verified") return null;
  const attempt = request.lastAttempt ?? {};
  const title = text(request.title) || text(request.prompt).slice(0, 90);
  if (!title) return null;
  // A second verifier pass over the same attempt produces the same card.
  // Include project identity in old records that predate run IDs.
  const identity = attempt.runId || request.runId || JSON.stringify([
    request.projectId ?? request.projectPath ?? request.projectRoot ?? "", request.id ?? "", title,
    text(request.prompt), request.at ?? null, attempt.at ?? null,
  ]);
  const doneAt = stamp(now);
  const task = {
    id: `task_history_${createHash("sha256").update(String(identity)).digest("hex").slice(0, 20)}`,
    title,
    prompt: text(request.prompt),
    status: "done",
    source: request.source ?? "request",
    color: "#57ff9a",
    createdAt: stamp(request.at, stamp(attempt.at, doneAt)),
    updatedAt: doneAt,
    doneAt,
    lastAttempt: { ...attempt },
    verification: {
      state: "verified", at: doneAt, reason: text(verdict.reason),
      sentinel: attempt.sawDone === true, exit: attempt.code ?? null,
      changedFiles: Math.max(0, Number(changedFiles) || 0),
      evidenceKind: evidenceKind({ state: verdict.state, changedFiles, hasSession: Boolean(attempt.sessionId), namedChecks: verdict.evidence?.namedChecks, observedChecks: verdict.evidence?.observedChecks }),
      ...(verdict.evidence?.observedChecks ? { checks: Object.fromEntries(["passed", "failed", "pending"].map((key) => [key, Math.max(0, Number(verdict.evidence.observedChecks[key]) || 0)])) } : {}),
    },
    logs: [
      ...(Array.isArray(request.logs) ? request.logs : []),
      { at: doneAt, kind: "status", text: `verified — ${text(verdict.reason) || "completion checks passed"}` },
    ].slice(-40),
    refs: [...(Array.isArray(request.refs) ? request.refs : [])],
    ideas: [...(Array.isArray(request.ideas) ? request.ideas : [])],
    completedFrom: "request",
  };
  for (const key of ["projectId", "projectPath", "projectRoot", "projectName"]) if (request[key]) task[key] = request[key];
  if (receiptId) task.verificationReceiptId = receiptId;
  if (attempt.sessionId && !task.refs.some((ref) => ref.kind === "session" && ref.detail === attempt.sessionId)) {
    task.refs.push({ kind: "session", title: "Worker session", detail: attempt.sessionId });
  }
  return task;
}
