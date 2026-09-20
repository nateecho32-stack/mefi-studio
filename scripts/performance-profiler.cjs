// Opt-in, in-memory host diagnostics. No payloads, paths, logs, or process IDs
// leave this module; polling and timing storage exist only during a capture.
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");

const LIMITS = Object.freeze({
  sampleIntervalMs: 1000,
  hostLagResolutionMs: 20,
  maxSamples: 120,
  maxSpans: 128,
  spanSamples: 120,
  maxIncidents: 60,
  maxProcesses: 32,
  hostLagThresholdMs: 50,
  slowIpcThresholdMs: 100,
});
const PROCESS_TYPES = new Set([
  "Browser", "Tab", "Utility", "Zygote", "Sandbox helper", "GPU",
  "Pepper Plugin", "Pepper Plugin Broker", "Unknown",
]);
const finiteNonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const rounded = (value) => value === null ? null : Math.round(value * 100) / 100;
function boundedPush(rows, row, limit) {
  rows.push(row);
  if (rows.length > limit) rows.shift();
}

function createPerformanceProfiler({
  now = () => performance.now(),
  wallNow = () => Date.now(),
  getAppMetrics = () => [],
  memoryUsage = () => process.memoryUsage(),
  createLoopDelay = () => monitorEventLoopDelay({ resolution: LIMITS.hostLagResolutionMs }),
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  let recording = false;
  let startedAt = null;
  let origin = 0;
  let elapsedMs = 0;
  let lastSampleAt = 0;
  let generation = 0;
  let timer = null;
  let loopDelay = null;
  let ownerCleanup = null;
  let previousProcesses = new Set();
  const samples = [];
  const spans = new Map();
  const incidents = [];
  const attached = new WeakSet();

  function elapsed() {
    return Math.max(0, now() - origin);
  }

  function incident(kind, name, durationMs) {
    boundedPush(incidents, { at: rounded(elapsed()), kind, name, durationMs: rounded(durationMs) }, LIMITS.maxIncidents);
  }

  function sample(initial = false) {
    if (!recording) return;
    const at = elapsed();
    let hostLagMs = initial ? 0 : Math.max(0, at - lastSampleAt - LIMITS.sampleIntervalMs);
    // A one-second timer alone misses stalls that end before its deadline.
    // The opt-in histogram also catches those shorter stalls; subtract its
    // normal sampling interval so an idle loop reports approximately zero.
    try {
      const maxDelay = finiteNonnegative(loopDelay?.max);
      if (!initial && maxDelay !== null) hostLagMs = Math.max(hostLagMs, maxDelay / 1e6 - LIMITS.hostLagResolutionMs);
      loopDelay?.reset();
    } catch { /* Timer drift remains available if the histogram is unsupported. */ }
    lastSampleAt = at;
    let metrics = [];
    let rssMB = null;
    try { metrics = getAppMetrics(); } catch { /* A process can exit during sampling. */ }
    try {
      const bytes = finiteNonnegative(memoryUsage()?.rss);
      rssMB = bytes === null ? null : bytes / (1024 * 1024);
    } catch { /* Missing metrics are explicit nulls, never plausible zeroes. */ }
    const seen = new Set();
    const processes = (Array.isArray(metrics) ? metrics : []).slice(0, LIMITS.maxProcesses).map((metric) => {
      const identity = metric?.pid;
      const warmed = !initial && identity != null && previousProcesses.has(identity);
      if (identity != null) seen.add(identity);
      const workingSetKB = finiteNonnegative(metric?.memory?.workingSetSize);
      return {
        type: PROCESS_TYPES.has(metric?.type) ? metric.type : "Unknown",
        cpuPercent: warmed ? rounded(finiteNonnegative(metric?.cpu?.percentCPUUsage)) : null,
        memoryMB: workingSetKB === null ? null : rounded(workingSetKB / 1024),
      };
    });
    previousProcesses = seen;
    const cpuPercent = processes.length && processes.every((row) => row.cpuPercent !== null)
      ? rounded(processes.reduce((sum, row) => sum + row.cpuPercent, 0)) : null;
    boundedPush(samples, { at: rounded(at), hostLagMs: rounded(hostLagMs), cpuPercent, rssMB: rounded(rssMB), processes }, LIMITS.maxSamples);
    if (hostLagMs >= LIMITS.hostLagThresholdMs) incident("host-lag", "Host event loop", hostLagMs);
  }

  function snapshot() {
    return {
      recording,
      startedAt,
      elapsedMs: rounded(recording ? elapsed() : elapsedMs),
      samples: samples.map((row) => ({ ...row, processes: row.processes.map((entry) => ({ ...entry })) })),
      spans: [...spans.values()].map((row) => {
        const sorted = [...row.durations].sort((a, b) => a - b);
        return {
          name: row.name, count: row.count, totalMs: rounded(row.totalMs),
          meanMs: rounded(row.totalMs / row.count),
          p95Ms: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]),
          maxMs: rounded(row.maxMs), errors: row.errors,
        };
      }).sort((a, b) => b.totalMs - a.totalMs),
      incidents: incidents.map((row) => ({ ...row })),
      limits: { ...LIMITS },
    };
  }

  function clearCapture() {
    generation += 1;
    samples.length = 0;
    spans.clear();
    incidents.length = 0;
    previousProcesses.clear();
    elapsedMs = 0;
    origin = now();
    lastSampleAt = 0;
    startedAt = recording ? wallNow() : null;
  }

  function releaseOwner() {
    if (ownerCleanup) ownerCleanup();
    ownerCleanup = null;
  }

  function stop() {
    if (recording) elapsedMs = elapsed();
    recording = false;
    generation += 1;
    if (timer !== null) cancel(timer);
    timer = null;
    try { loopDelay?.disable(); } catch { /* Shutdown is best effort. */ }
    loopDelay = null;
    releaseOwner();
    return snapshot();
  }

  function watchOwner(owner) {
    if (!owner || typeof owner.on !== "function") return;
    const navigation = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) stop();
    };
    owner.on("destroyed", stop);
    owner.on("render-process-gone", stop);
    owner.on("did-start-navigation", navigation);
    ownerCleanup = () => {
      owner.removeListener("destroyed", stop);
      owner.removeListener("render-process-gone", stop);
      owner.removeListener("did-start-navigation", navigation);
    };
  }

  function start(owner) {
    stop();
    recording = true;
    clearCapture();
    watchOwner(owner);
    try { loopDelay = createLoopDelay(); loopDelay.enable(); } catch { loopDelay = null; }
    sample(true);
    timer = schedule(sample, LIMITS.sampleIntervalMs);
    timer?.unref?.();
    return snapshot();
  }

  function reset() {
    clearCapture();
    if (recording) {
      if (timer !== null) cancel(timer);
      sample(true);
      timer = schedule(sample, LIMITS.sampleIntervalMs);
      timer?.unref?.();
    }
    return snapshot();
  }

  function control(action, owner) {
    if (action === "start") return { ok: true, ...start(owner) };
    if (action === "stop") return { ok: true, ...stop() };
    if (action === "reset") return { ok: true, ...reset() };
    return { ok: false, error: "Unknown performance profiler action." };
  }

  function failedResult(value) {
    // Read only the data property. Diagnostics must never invoke result getters.
    try { return value != null && Object.getOwnPropertyDescriptor(value, "ok")?.value === false; }
    catch { return false; }
  }

  function finish(name, startAt, capture, failed) {
    if (!recording || capture !== generation) return;
    const durationMs = Math.max(0, now() - startAt);
    let row = spans.get(name);
    if (!row) {
      if (spans.size >= LIMITS.maxSpans) return;
      row = { name, count: 0, totalMs: 0, maxMs: 0, errors: 0, durations: [] };
      spans.set(name, row);
    }
    row.count += 1;
    row.totalMs += durationMs;
    row.maxMs = Math.max(row.maxMs, durationMs);
    row.errors += failed ? 1 : 0;
    boundedPush(row.durations, durationMs, LIMITS.spanSamples);
    if (durationMs >= LIMITS.slowIpcThresholdMs) incident("slow-ipc", name, durationMs);
    else if (failed) incident("ipc-error", name, durationMs);
  }

  function wrap(name, handler) {
    if (name.startsWith("performance:")) return handler;
    return function measuredHandler(...args) {
      if (!recording) return handler.apply(this, args);
      const capture = generation;
      const startAt = now();
      let result;
      try {
        result = handler.apply(this, args);
        if (result != null && typeof result.then === "function") {
          return Promise.resolve(result).then(
            (value) => { finish(name, startAt, capture, failedResult(value)); return value; },
            (error) => { finish(name, startAt, capture, true); throw error; },
          );
        }
      } catch (error) {
        finish(name, startAt, capture, true);
        throw error;
      }
      finish(name, startAt, capture, failedResult(result));
      return result;
    };
  }

  function attachIpc(ipcMain) {
    if (attached.has(ipcMain)) return;
    attached.add(ipcMain);
    const register = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => register(channel, wrap(channel, handler));
  }

  return { control, snapshot, start, stop, reset, wrap, attachIpc };
}

module.exports = { createPerformanceProfiler, LIMITS };
