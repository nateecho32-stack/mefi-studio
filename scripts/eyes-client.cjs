"use strict";
// The eyes worker client: runs scripts/eyes.mjs's OpenCode-store reads on a
// worker thread (scripts/eyes-worker.mjs) and hands the main process a
// promise per read.
//
// Why a thread and not the main process: node:sqlite is synchronous, and the
// store is large (17.7 GB, 121k tool parts measured 2026-09-21). One session
// listing took 138 ms warm and 0.8-2.6 s cold, one assistantFacts call
// 140-280 ms, and a full-table scan 10-14 s; every one of them froze the
// Electron main process and, past a few seconds, put "Not Responding" in the
// window title. The same reads on a worker left the main event loop under
// 23 ms during a 14 s scan. Why a thread and not a process: the host machine
// sits at a few hundred MB free, and a worker isolate costs a fraction of a
// second Node process. The protocol is one message per call, so a
// utilityProcess could replace the Worker later without touching a caller.
//
// Contract:
//   call(method, args) -> Promise<result>   only EYES_WORKER_METHODS
//   restart(reason)                          drop the worker; the next call respawns it
//   setVersion(n)                            live update swapped eyes.mjs: restart on a new version
//   close()                                  final; every later call rejects
//   status()                                 { running, pending, version, spawns, calls, failures, restarts }
// A pending call rejects when the worker dies or the timeout passes; a
// timeout also restarts the worker, because a read still running would hold
// every later call behind it. The worker is unref'd while idle so a CLI
// launch or a test process can exit without closing it explicitly.
const path = require("node:path");
const { Worker } = require("node:worker_threads");

// Every store read the main process makes through the facade
// (scripts/projects.cjs) or directly. Pure helpers (requestsFromCollisions,
// uncommittedOnly, parsePorcelain...) and the fs-backed readers (readJson,
// listPngs, tailLog...) stay in-process; they never touch the database.
// gitPorcelain is here because it is a synchronous git spawn with an 8 s
// timeout: the worker absorbs that wait too.
const EYES_WORKER_METHODS = Object.freeze([
  "listSessions",
  "listSessionIds",
  "sessionDirectory",
  "findRunSession",
  "listChanges",
  "listSessionChecks",
  "listTodos",
  "activitySince",
  "collisions",
  "filePresence",
  "listChatTexts",
  "assistantFacts",
  "gitPorcelain",
  "closeReadDb",
]);
const DEFAULT_TIMEOUT_MS = 90_000;

function rebuildError(shape) {
  const error = new Error(String(shape?.message ?? "store read failed"));
  if (typeof shape?.name === "string" && shape.name) error.name = shape.name;
  if (shape?.code !== undefined) error.code = shape.code;
  return error;
}

function createEyesClient({
  studioRoot,
  modulePath = path.join(studioRoot, "scripts", "eyes.mjs"),
  workerPath = path.join(studioRoot, "scripts", "eyes-worker.mjs"),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = () => {},
  // Test seam: build the Worker (same options) so a fixture can observe it.
  spawnWorker = (file, options) => new Worker(file, options),
} = {}) {
  let worker = null;
  let generation = 0;
  let version = 0;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const stats = { spawns: 0, calls: 0, failures: 0, restarts: 0 };

  function note(line) {
    try { log(`[eyes-worker] ${line}`); } catch { /* logging never breaks a read */ }
  }
  function settle(id, outcome) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    outcome(entry);
    if (!pending.size && worker) worker.unref();
  }
  function failAll(reason) {
    stats.failures += pending.size;
    for (const id of [...pending.keys()]) settle(id, (entry) => entry.reject(new Error(`${entry.method}: ${reason}`)));
  }
  function drop(instance, reason) {
    if (worker !== instance) return;
    worker = null;
    generation += 1;
    failAll(reason);
  }
  function ensureWorker() {
    if (worker) return worker;
    if (closed) throw new Error("eyes worker client is closed");
    const own = ++generation;
    const instance = spawnWorker(workerPath, { workerData: { modulePath, version } });
    stats.spawns += 1;
    instance.on("message", (message) => {
      if (own !== generation || !message || typeof message !== "object") return;
      if (message.type === "result") settle(message.id, (entry) => entry.resolve(message.result));
      else if (message.type === "error") settle(message.id, (entry) => entry.reject(rebuildError(message.error)));
    });
    instance.on("error", (error) => {
      if (own !== generation) return;
      note(`error: ${error?.message ?? error}`);
      drop(instance, `worker error: ${error?.message ?? error}`);
    });
    instance.on("exit", (code) => {
      if (own !== generation) return;
      if (pending.size) note(`exited with code ${code} while ${pending.size} read(s) were pending`);
      drop(instance, `worker exited (${code})`);
    });
    worker = instance;
    instance.unref();
    return instance;
  }
  function restart(reason = "restart") {
    const instance = worker;
    if (!instance) return;
    stats.restarts += 1;
    worker = null;
    generation += 1;
    failAll(`worker restarted (${reason})`);
    Promise.resolve(instance.terminate()).catch(() => {});
  }
  function call(method, args = {}) {
    if (!EYES_WORKER_METHODS.includes(method)) return Promise.reject(new TypeError(`eyes worker: ${String(method)} is not a store read`));
    return new Promise((resolve, reject) => {
      let instance;
      try { instance = ensureWorker(); } catch (error) { reject(error); return; }
      const id = ++sequence;
      stats.calls += 1;
      const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        stats.failures += 1;
        entry.reject(new Error(`${method}: store read timed out after ${timeoutMs} ms`));
        note(`${method} timed out after ${timeoutMs} ms; restarting the worker`);
        restart("timeout");
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, method });
      instance.ref();
      try {
        instance.postMessage({ id, method, args });
      } catch (error) {
        // Arguments that cannot cross the thread boundary (a DataCloneError)
        // fail this read only; the worker stays up.
        settle(id, (entry) => entry.reject(error));
      }
    });
  }
  function setVersion(next) {
    const value = Number(next) || 0;
    if (value === version) return;
    version = value;
    restart("module changed");
  }
  async function close() {
    closed = true;
    const instance = worker;
    worker = null;
    generation += 1;
    failAll("client closed");
    if (instance) await Promise.resolve(instance.terminate()).catch(() => {});
  }
  return {
    call,
    restart,
    setVersion,
    close,
    status: () => ({ running: Boolean(worker), pending: pending.size, version, ...stats }),
  };
}

// The object the main process reads the store through: the module's own
// exports, with every store read replaced by the worker call of the same
// name. openDb is removed on purpose: a synchronous handle on the main
// thread is exactly the freeze this layer exists to end.
function wrapEyes(module, client, { methods = EYES_WORKER_METHODS } = {}) {
  const wrapped = Object.create(null);
  Object.assign(wrapped, module);
  for (const method of methods) {
    if (typeof module[method] !== "function") continue;
    wrapped[method] = (args = {}) => client.call(method, args);
  }
  wrapped.openDb = () => {
    throw new Error("openDb is unavailable on the main process: store reads run on the eyes worker");
  };
  wrapped.eyesWorkerStatus = () => client.status();
  return wrapped;
}

module.exports = { createEyesClient, wrapEyes, EYES_WORKER_METHODS, DEFAULT_TIMEOUT_MS };
