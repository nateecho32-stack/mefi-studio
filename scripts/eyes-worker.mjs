// The eyes worker: hosts scripts/eyes.mjs on a worker thread and answers the
// store reads the main process used to run inline.
//
// node:sqlite is synchronous, so every read of the OpenCode store blocked the
// Electron main process for as long as the query took — 138 ms warm and up to
// 2.6 s cold for one session listing on a 17 GB store, 10 s and more for a
// full scan — and the OS window went "Not Responding" while it waited. Here
// the same functions run unchanged; only the thread differs. The client
// (scripts/eyes-client.cjs) owns the message protocol, the allowlist and the
// restart policy; this file only dispatches.
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { EYES_WORKER_METHODS } from "./eyes-client.cjs";

const { modulePath, version = 0 } = workerData ?? {};
if (!parentPort || typeof modulePath !== "string" || !modulePath) {
  throw new TypeError("eyes-worker must be started by scripts/eyes-client.cjs with a module path");
}
// The version query mirrors main.cjs's loadModule: a live update that swaps
// scripts/eyes.mjs restarts the worker with a new version, so the import is
// never served from a stale ESM cache.
const eyes = await import(`${pathToFileURL(modulePath).href}?v=${version}`);
const allowed = new Set(EYES_WORKER_METHODS);

function describe(error) {
  return {
    message: String(error?.message ?? error),
    name: typeof error?.name === "string" ? error.name : "Error",
    ...(error?.code !== undefined ? { code: error.code } : {}),
  };
}

parentPort.on("message", async (message) => {
  const { id, method, args } = message && typeof message === "object" ? message : {};
  if (!Number.isInteger(id)) return;
  try {
    if (!allowed.has(method) || typeof eyes[method] !== "function") {
      throw new TypeError(`eyes worker: ${String(method)} is not a store read`);
    }
    const result = await eyes[method](args ?? {});
    parentPort.postMessage({ type: "result", id, result });
  } catch (error) {
    // A result that cannot cross the thread boundary lands here too (a
    // DataCloneError from postMessage): the caller still gets a rejection.
    parentPort.postMessage({ type: "error", id, error: describe(error) });
  }
});
parentPort.postMessage({ type: "ready", version });
