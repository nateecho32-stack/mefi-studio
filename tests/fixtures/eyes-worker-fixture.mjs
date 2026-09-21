// A stand-in for scripts/eyes.mjs that the eyes worker can host: the same
// export names as the real store reads, with behaviours a test can provoke.
// Nothing here opens a database.
import { threadId } from "node:worker_threads";

// Busy-waits so the caller can prove its own event loop kept turning.
export function listSessions({ busyMs = 0, limit = 40 } = {}) {
  const until = performance.now() + Number(busyMs);
  while (performance.now() < until) { /* hold this thread, not the caller's */ }
  return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({ id: `s${index}`, threadId, busyMs }));
}

// Never answers: the client's timeout has to end the wait and restart the worker.
export function listTodos() {
  return new Promise(() => {});
}

// Ends the worker thread mid-read: pending calls must reject, the next call must respawn.
export function listChanges() {
  process.exit(3);
}

// Echoes its arguments so serialization round-trips can be checked.
export function activitySince(args) {
  return { echoed: args, threadId };
}

// Throws like a missing store would.
export function collisions() {
  const error = new Error("OpenCode database not found at /nowhere");
  error.code = "ENOENT";
  throw error;
}

// A result that cannot cross the thread boundary.
export function filePresence() {
  return { fn: () => {} };
}

// Not a store read: never callable through the worker.
export function openDb() {
  throw new Error("opened on the wrong thread");
}
