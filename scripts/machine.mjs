// Mefi's Studio AI+ — machine coordination.
//
// Reads the repo's own test lease records and the live LOVE process table so
// agents can see each other's test runs and wait their turn. The resource
// manager (main.cjs) uses classify() to find strays, hangs and over-age runs.
//
// Read-only: lease files are never pruned here (the runners own that).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import studioPaths from "./paths.cjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { repoRoot: DEFAULT_ROOT } = studioPaths.resolveStudioPaths({ studioRoot: STUDIO });

export const TEST_MARKERS = ["lua_quality_runner", ".codex_smoke", "TRIPPY_LUA_QUALITY_CHECK", "[test]", "invoke-love", "feature-smoke"];
export const LEASE_MAX_AGE_HOURS = 6;

export const WORKER_CAPACITY_DEFAULTS = Object.freeze({
  sampleMs: 150,
  cacheMs: 750,
  lagBusyMs: 100,
  lagCriticalMs: 300,
  lagRecoveryMs: 40,
  pressureSamples: 2,
  recoverySamples: 2,
  // The latch releases after recoverySamples readings at or under
  // lagRecoveryMs. A machine that settles between the two lines (41-99 ms,
  // common on a loaded laptop) never got there, so the hold outlived the
  // spike for good. After this long with every reading under lagBusyMs the
  // latch releases anyway; a busy reading restarts the clock.
  lagMaxHoldMs: 3 * 60 * 1000,
  // Admission floor tuning: the host machine genuinely sits at 474–585 MB
  // free, so the old 256+256=512 MB sum nondeterministically blocked starts
  // whenever free memory dipped under it — a memory hold, not a lag hold.
  // 200 MB keeps a desktop reserve for the Studio shell + OS, 240 MB covers
  // one more LOVE worker, and the 440 MB total clears the observed 474 MB
  // floor with margin. Current workers already appear in the measurement.
  desktopReserveMemoryMB: 200,
  workerMemoryMB: 240,
  // Two-tier memory admission: a small shortfall (free memory below the
  // desktopReserve+worker sum but at or above memorySevereFloorMB) still
  // holds by default; the explicit memoryWarnOverride flag demotes exactly
  // that band to a distinct warning and admits the start. The severe floor
  // never yields — below 300 MB free another LOVE worker could push the host
  // into thrashing, so the override must not bypass it.
  memorySevereFloorMB: 300,
  memoryWarnOverride: false,
  // Severe-memory parallelism cap: an under-floor reading latches a cap that
  // keeps admission closed until free memory recovers past the floor by this
  // margin. 300 + 150 = 450 MB sits just above the 440 MB admission sum, so
  // the cap lifts exactly when a start would clear normal admission anyway —
  // a host idling near the floor with several workers no longer flaps a
  // start in and out on every oscillation across 300 MB. Engaging the latch
  // and releasing it each take severeCapSamples consecutive readings: the
  // host was observed swinging 197 -> 526 -> 354 MB across both boundaries
  // on solitary samples, and single-sample thresholds let that flicker
  // toggle the cap per reading.
  memorySevereReleaseMarginMB: 150,
  severeCapSamples: 2,
});

// Admission reads are deliberately independent of the slow process/lease scan.
// A short timer measures how promptly the host can respond. CPU counters are
// sampled over that same interval for information; CPU use does not gate work.
export function createWorkerCapacitySampler({
  cpus = () => os.cpus(),
  freemem = () => os.freemem(),
  totalmem = () => os.totalmem(),
  clock = () => Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ...limits
} = {}) {
  const options = { ...WORKER_CAPACITY_DEFAULTS, ...limits };
  let cached = null;
  let inFlight = null;
  let pendingRendererLagMs = null;
  let lagPressure = false;
  let highSamples = 0;
  let recoverySamples = 0;
  // While the lag latch is on: when readings last went under lagBusyMs.
  let calmSince = null;
  let severeMemoryCap = false;
  let severeCapLowSamples = 0;
  let severeCapHighSamples = 0;

  function cpuTotals() {
    try {
      const rows = cpus();
      if (!Array.isArray(rows) || !rows.length) return null;
      let total = 0, idle = 0;
      for (const row of rows) {
        const times = row?.times;
        const values = [times?.user, times?.nice, times?.sys, times?.idle, times?.irq];
        if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
        total += values.reduce((sum, value) => sum + value, 0);
        idle += times.idle;
      }
      return { total, idle, count: rows.length };
    } catch {
      return null;
    }
  }

  function memoryMB(read) {
    try {
      const bytes = read();
      return Number.isFinite(bytes) && bytes >= 0 ? bytes / (1024 * 1024) : null;
    } catch {
      return null;
    }
  }

  async function sample(now, memoryWarnOverride = null) {
    const baseline = cpuTotals();
    const startedAt = clock();
    await wait(options.sampleMs);
    const elapsed = clock() - startedAt;
    const hostLagMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(0, elapsed - options.sampleMs) : null;
    const rendererLagMs = pendingRendererLagMs;
    const lagReadings = [hostLagMs, rendererLagMs].filter((value) => value !== null);
    const lagMs = lagReadings.length ? Math.max(...lagReadings) : null;
    const sampledAt = now + (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0);
    const current = cpuTotals();
    const totalDelta = current && baseline ? current.total - baseline.total : 0;
    const idleDelta = current && baseline ? current.idle - baseline.idle : -1;
    const cpuPercent = current && baseline && current.count === baseline.count &&
      totalDelta > 0 && idleDelta >= 0 && idleDelta <= totalDelta
      ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : null;
    const availableMemoryMB = memoryMB(freemem);
    const totalMemoryMB = memoryMB(totalmem);
    const memoryKnown = totalMemoryMB > 0 && availableMemoryMB !== null && availableMemoryMB <= totalMemoryMB;
    // Latch the severe-memory parallelism cap with boundary hysteresis:
    // severeCapSamples consecutive under-floor readings engage it, the same
    // number of consecutive readings past the floor plus release margin
    // release it, and recovery-band readings hold the latch while resetting
    // both streaks — so solitary dips or blips cannot toggle it. The hold
    // that consumes the latch lives in the wrapper, where each caller's
    // live worker count is known.
    if (memoryKnown) {
      if (availableMemoryMB < options.memorySevereFloorMB) {
        severeCapHighSamples = 0;
        severeCapLowSamples += 1;
        if (severeCapLowSamples >= options.severeCapSamples) severeMemoryCap = true;
      } else if (availableMemoryMB >= options.memorySevereFloorMB + options.memorySevereReleaseMarginMB) {
        severeCapLowSamples = 0;
        severeCapHighSamples += 1;
        if (severeCapHighSamples >= options.severeCapSamples) severeMemoryCap = false;
      } else {
        severeCapLowSamples = 0;
        severeCapHighSamples = 0;
      }
    }
    // Keep a modest emergency reserve and room for one more worker. A share
    // of total RAM unnecessarily blocks healthy machines with several GB free;
    // current workers already appear in the available-memory measurement.
    const requiredMemoryMB = memoryKnown
      ? Math.ceil(options.desktopReserveMemoryMB + options.workerMemoryMB) : null;

    if (lagMs === null) {
      highSamples = 0;
      recoverySamples = 0;
    } else if (lagMs >= options.lagBusyMs) {
      highSamples += 1;
      recoverySamples = 0;
      calmSince = null;
      if (lagMs >= options.lagCriticalMs || highSamples >= options.pressureSamples) lagPressure = true;
    } else {
      highSamples = 0;
      recoverySamples = lagMs <= options.lagRecoveryMs ? recoverySamples + 1 : 0;
      if (lagPressure && calmSince === null) calmSince = sampledAt;
      if (recoverySamples >= options.recoverySamples) lagPressure = false;
      if (lagPressure && sampledAt - calmSince >= options.lagMaxHoldMs) lagPressure = false;
      if (!lagPressure) calmSince = null;
    }

    const memoryPressure = memoryKnown && availableMemoryMB < requiredMemoryMB;
    // Classify the shortfall tier before deciding the hold: "small" sits
    // between the severe floor and the admission sum, "severe" is below the
    // floor. The override (per call, else the sampler default) applies only
    // to the small band; unknown readings never reach it.
    const overrideRequested = typeof memoryWarnOverride === "boolean"
      ? memoryWarnOverride
      : options.memoryWarnOverride === true;
    const memoryShortfall = !memoryPressure ? null
      : availableMemoryMB < options.memorySevereFloorMB ? "severe" : "small";
    const memoryOverridden = memoryShortfall === "small" && overrideRequested;
    let reason = null;
    let memoryWarning = null;
    if (lagMs === null || !memoryKnown) {
      const missing = [lagMs === null ? "responsiveness" : null, !memoryKnown ? "memory" : null].filter(Boolean).join(" and ");
      reason = `Waiting for machine ${missing} readings before starting another worker.`;
    } else if (memoryPressure && !memoryOverridden) {
      reason = memoryShortfall === "severe"
        ? `Machine memory is critically low (${Math.floor(availableMemoryMB)} MB available; ${options.memorySevereFloorMB} MB severe floor) — refusing another worker even with the memory override.`
        : `Machine memory is low (${Math.floor(availableMemoryMB)} MB available; ${requiredMemoryMB} MB needed before another worker).`;
    } else {
      if (memoryOverridden) {
        memoryWarning = `Machine memory is low (${Math.floor(availableMemoryMB)} MB available; ${requiredMemoryMB} MB needed before another worker) — starting on the explicit memory override.`;
      }
      if (lagPressure) {
        // A latched hold clears after recoverySamples consecutive responsive
        // readings. The latest reading may already be healthy (even 0 ms), so
        // cite the pending readings — never the healthy sample — as the hold.
        const progress = Math.min(recoverySamples, options.recoverySamples);
        const lagNote = lagMs >= options.lagBusyMs ? ` after ${Math.round(lagMs)} ms lag` : "";
        reason = `Waiting for machine responsiveness to recover (${progress} of ${options.recoverySamples} responsive readings needed${lagNote}).`;
        if (calmSince !== null) {
          const left = Math.max(0, Math.ceil((options.lagMaxHoldMs - (sampledAt - calmSince)) / 1000));
          reason += ` Lag is back below the busy line; if it stays there, the hold lifts in ${left} s.`;
        }
      }
    }
    // Structured hold classification so consumers can tell a memory gate from
    // a responsiveness gate without parsing reason text: "memory" is a small
    // required-vs-available shortfall hold, "memory-severe" is the gap under
    // the severe floor (never overrideable), "lag" is the latched
    // responsiveness hold, "unknown" covers missing readings, and null means
    // admission is clear (an overridden small shortfall reports its distinct
    // warning in resources.memoryWarning instead of a hold). The wrapper adds
    // "memory-cap" — the latched severe-memory parallelism cap — on top of a
    // clear or overridden verdict while the recovery band holds.
    const holdKind = (lagMs === null || !memoryKnown) ? "unknown"
      : memoryPressure && !memoryOverridden ? (memoryShortfall === "severe" ? "memory-severe" : "memory")
      : lagPressure ? "lag"
      : null;
    return {
      canStart: reason === null,
      reason,
      resources: { lagMs, hostLagMs, rendererLagMs, lagPressure, cpuPercent, availableMemoryMB, totalMemoryMB, requiredMemoryMB, sampledAt, memoryPressure, memoryShortfall, memoryWarning, holdKind, memorySevereCapped: severeMemoryCap },
    };
  }

  // A final admission check after claiming work bypasses the settled cache;
  // concurrent checks still share one interval instead of measuring in a burst.
  // memoryWarnOverride (boolean, or null to defer to the sampler default)
  // demotes a small memory shortfall to a warning; it never lifts the
  // severe floor or an unknown-memory hold.
  return async function workerCapacity({ running = 0, now = clock(), force = false, lagMs = null, memoryWarnOverride = null } = {}) {
    const rendererLagMs = Number.isFinite(lagMs) && lagMs >= 0 ? lagMs : null;
    if (force || !cached || rendererLagMs !== cached.resources.rendererLagMs || now < cached.resources.sampledAt || now - cached.resources.sampledAt >= options.cacheMs) {
      if (!inFlight) {
        pendingRendererLagMs = rendererLagMs;
        inFlight = sample(now, memoryWarnOverride).then((result) => { cached = result; return result; }).finally(() => { inFlight = null; });
      } else if (rendererLagMs !== null) {
        pendingRendererLagMs = Math.max(pendingRendererLagMs ?? 0, rendererLagMs);
      }
      await inFlight;
    }
    // The severe-memory parallelism cap applies per call: a cached sample
    // serves callers with different live worker counts, and the cap pins
    // admission only while at least one worker already runs — a cap that
    // starved the pool below one would deadlock the queue. Like the floor it
    // protects, the cap is never overrideable; it exists to stop the
    // admit/release oscillation right above the severe floor.
    const runningCount = Math.max(0, Number(running) || 0);
    const verdict = { ...cached, resources: { ...cached.resources, running: runningCount } };
    if (verdict.canStart === true && verdict.resources.memorySevereCapped === true && runningCount >= 1) {
      const releaseMB = Math.floor(options.memorySevereFloorMB + options.memorySevereReleaseMarginMB);
      return {
        canStart: false,
        reason: `Machine memory is recovering from the severe floor (${Math.floor(verdict.resources.availableMemoryMB)} MB available; ${releaseMB} MB needed) — worker parallelism stays capped at ${runningCount} until free memory recovers.`,
        resources: { ...verdict.resources, holdKind: "memory-cap", memoryWarning: null },
      };
    }
    return verdict;
  };
}

export const workerCapacity = createWorkerCapacitySampler();

// Bounded machine-status history. The live status file used to keep only the
// latest tick, so a restart's very first sample was overwritten before an
// observer could read it. These helpers keep a compact, oldest-first ring of
// ticks alongside the unchanged latest-status fields: the first post-restart
// tick (fresh process => empty ring) is marked `first` and is never trimmed,
// while only the most recent (limit - 1) later ticks are retained, so the
// ring stays bounded no matter how long the app runs.
export const MACHINE_STATUS_HISTORY_LIMIT = 20;

export function machineStatusSample(status = {}) {
  const resources = status.capacity?.resources ?? {};
  return {
    updatedAt: status.updatedAt ?? null,
    reason: status.reason ?? null,
    canStart: status.capacity?.canStart ?? null,
    wait: status.wait ?? null,
    holdKind: resources.holdKind ?? null,
    lagMs: resources.lagMs ?? null,
    availableMemoryMB: resources.availableMemoryMB ?? null,
    memoryPressure: resources.memoryPressure ?? null,
    busy: status.leases?.busy ?? null,
    totalWidth: status.leases?.totalWidth ?? null,
    running: Array.isArray(status.running) ? status.running.length : null,
    lines: status.lines ?? null,
  };
}

export function appendMachineStatusHistory(history = [], status = {}, { limit = MACHINE_STATUS_HISTORY_LIMIT } = {}) {
  const cap = Math.max(2, Math.floor(Number(limit) || MACHINE_STATUS_HISTORY_LIMIT));
  const prior = Array.isArray(history) ? history : [];
  const sample = machineStatusSample(status);
  if (prior.length === 0) sample.first = true;
  const ring = prior.concat([sample]);
  // Oldest-first: the first post-restart entry stays pinned at index 0, the
  // rest is a sliding window over the most recent ticks.
  while (ring.length > cap) {
    if (ring[0]?.first === true) ring.splice(1, 1);
    else ring.shift();
  }
  return ring;
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function leaseStatus({ repoRoot = DEFAULT_ROOT, now = Date.now(), alive = isPidAlive } = {}) {
  const dir = path.join(repoRoot, "tools", "logs", "_lease");
  let files = [];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    // Fail open only when no runner has created the lease board yet. An
    // unreadable board (EACCES/EPERM/…) may be hiding an exclusive holder, so
    // the original error must reach the foreman's fail-closed lease path.
    if (error?.code !== "ENOENT") throw error;
    return { busy: false, exclusive: false, totalWidth: 0, holders: [] };
  }
  const holders = [];
  for (const name of files) {
    let record;
    try {
      record = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch {
      continue; // half-written file: the runner will prune it
    }
    const startedAt = Date.parse(record.startedUtc ?? "");
    const ageHours = Number.isFinite(startedAt) ? (now - startedAt) / 3600000 : 0;
    const holderAlive = record.pid ? alive(record.pid) : false;
    holders.push({
      id: record.id ?? name,
      pid: record.pid,
      width: Number(record.width ?? 1),
      exclusive: Boolean(record.exclusive),
      label: record.label ?? "",
      agent: record.agent ?? "",
      ageMinutes: Math.round(ageHours * 60),
      alive: holderAlive,
      stale: !holderAlive || ageHours > LEASE_MAX_AGE_HOURS,
    });
  }
  const live = holders.filter((holder) => !holder.stale);
  return {
    busy: live.length > 0,
    exclusive: live.some((holder) => holder.exclusive),
    totalWidth: live.reduce((sum, holder) => sum + holder.width, 0),
    holders: live,
    staleHolders: holders.filter((holder) => holder.stale),
  };
}

export function isTestProcess(row) {
  const commandLine = String(row.commandLine ?? "");
  return TEST_MARKERS.some((marker) => commandLine.includes(marker));
}

// ps prints cpu time as [[dd-]hh:]mm:ss.
function parsePsTime(value) {
  const [days, clock] = String(value).includes("-") ? String(value).split("-") : ["0", String(value)];
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return ((Number(days) * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

// The same rows the Windows query yields, read from ps. Only LÖVE processes
// are listed, exactly as the CIM filter does, so classify() sees one shape.
async function posixProcessSnapshot({ ps, spawnImpl, now }) {
  return await new Promise((resolve) => {
    const child = spawnImpl(ps, ["-eo", "pid=,ppid=,etimes=,time=,rss=,comm=,args="]);
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.on("close", () => {
      const at = now();
      const rows = [];
      for (const line of output.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
        if (!match || !/^lovec?(?:\.exe)?$/i.test(match[6])) continue;
        rows.push({
          pid: Number(match[1]),
          parentPid: Number(match[2]),
          name: match[6],
          commandLine: match[7].trim(),
          startedAt: at - Number(match[3]) * 1000,
          cpuMs: parsePsTime(match[4]),
          memMB: Math.round(Number(match[5]) / 1024),
        });
      }
      resolve(rows);
    });
    child.on("error", () => resolve([]));
  });
}

// Whether tasklist lists a LÖVE process: true, false, or null when tasklist
// itself could not answer (the CIM query then runs as before).
function windowsLoveRunning({ tasklist = "tasklist", spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawnImpl(tasklist, ["/FI", "IMAGENAME eq love*", "/FO", "CSV", "/NH"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && output.trim() ? /^"lovec?\.exe",/im.test(output) : null));
  });
}

export async function processSnapshot({ powershell = "powershell", ps = "ps", tasklist = "tasklist", platform = process.platform, spawnImpl = spawn, now = Date.now } = {}) {
  if (platform !== "win32") return await posixProcessSnapshot({ ps, spawnImpl, now });
  // Starting PowerShell for the CIM query took 0.7-0.8 s on every Machine
  // scan, and most scans find no LÖVE process at all. tasklist filtered to
  // love* answers in about half that (measured 2026-09-23 on the 16 GB
  // laptop), so the CIM query only runs when there is something to read.
  if (await windowsLoveRunning({ tasklist, spawnImpl }) === false) return [];
  const script =
    "Get-CimInstance Win32_Process -Filter \\\"Name='lovec.exe' OR Name='love.exe'\\\" | " +
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize | ConvertTo-Json -Compress";
  return await new Promise((resolve) => {
    const child = spawnImpl(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output.trim() || "[]");
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        resolve(
          rows.map((row) => ({
            pid: row.ProcessId,
            parentPid: row.ParentProcessId,
            name: row.Name,
            commandLine: row.CommandLine ?? "",
            startedAt: Date.parse(String(row.CreationDate ?? "")),
            cpuMs: Math.round(((row.KernelModeTime ?? 0) + (row.UserModeTime ?? 0)) / 10000),
            memMB: Math.round((row.WorkingSetSize ?? 0) / (1024 * 1024)),
          }))
        );
      } catch {
        resolve([]);
      }
    });
    child.on("error", () => resolve([]));
  });
}

export const CLASSIFY_DEFAULTS = { idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 };

// Pure classification for one scan. `previousCpu` maps pid -> cpuMs from the
// prior scan; a test process whose CPU has not moved for idleSeconds is hung.
export function classify({ processes = [], previousCpu = new Map(), now = Date.now(), limits = {}, parentAlive = isPidAlive } = {}) {
  const options = { ...CLASSIFY_DEFAULTS, ...limits };
  const verdicts = [];
  for (const row of processes) {
    const test = isTestProcess(row);
    const ageMinutes = Number.isFinite(row.startedAt) ? (now - row.startedAt) / 60000 : 0;
    // Map keys survive JSON as strings; accept both key shapes.
    const previous = previousCpu instanceof Map ? previousCpu.get(row.pid) ?? previousCpu.get(String(row.pid)) : previousCpu?.[row.pid];
    const noProgressSeconds = previous == null ? 0 : previous === row.cpuMs ? options.idleSeconds : 0;
    let status = test ? "healthy" : "other";
    if (!parentAlive(row.parentPid)) status = "orphan";
    else if (test && noProgressSeconds >= options.idleSeconds) status = "hang";
    else if (test && ageMinutes > options.maxAgeMinutes) status = "over-age";
    else if (row.memMB > options.maxMemMB) status = "fat";
    verdicts.push({
      pid: row.pid,
      parentPid: row.parentPid,
      name: row.name,
      test,
      status,
      ageMinutes: Math.round(ageMinutes),
      memMB: row.memMB,
      cpuMs: row.cpuMs,
      killable: ["orphan", "hang", "over-age"].includes(status),
      commandLine: String(row.commandLine ?? "").slice(0, 300),
    });
  }
  return { verdicts, killable: verdicts.filter((verdict) => verdict.killable) };
}

export function describe(status) {
  const lines = [];
  if (status.capacity) {
    const { resources = {}, canStart, reason } = status.capacity;
    const usage = [];
    if (Number.isFinite(resources.lagMs)) usage.push(`${Math.round(resources.lagMs)} ms response lag`);
    if (Number.isFinite(resources.cpuPercent)) usage.push(`CPU ${Math.round(resources.cpuPercent)}%`);
    if (Number.isFinite(resources.availableMemoryMB)) usage.push(`${Math.floor(resources.availableMemoryMB)} MB RAM available`);
    if (usage.length) lines.push(usage.join(", "));
    if (!canStart && reason) lines.push(reason);
    // The latched severe-memory cap outlives its active hold: with no worker
    // running (or once the hold reason stops applying) admission may be clear
    // while the latch still caps parallelism, so the summary must say so
    // instead of reading as a fully free machine.
    if (resources.memorySevereCapped === true && resources.holdKind !== "memory-cap") lines.push("Severe-memory parallelism cap still latched — new worker starts stay capped until free memory recovers.");
    if (resources.memoryWarning) lines.push(resources.memoryWarning);
  }
  if (status.leases?.exclusive) lines.push(`EXCLUSIVE lease held by ${status.leases.holders[0]?.label || status.leases.holders[0]?.agent || "?"} — wait for it to finish`);
  else if (status.leases?.busy) lines.push(`${status.leases.holders.length} lease holder(s) at width ${status.leases.totalWidth}: ${status.leases.holders.map((holder) => holder.label || holder.agent).join(", ")}`);
  else lines.push("no active test leases");
  const running = (status.processes ?? []).filter((entry) => entry.test);
  if (running.length) lines.push(`${running.length} LOVE test process(es) running`);
  if (status.actions?.length) lines.push(`${status.actions.length} resource action(s) in the last pass`);
  return lines.join(" · ");
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes("--scan")) {
    const leases = await leaseStatus();
    const processes = await processSnapshot();
    const { verdicts, killable } = classify({ processes });
    console.log(JSON.stringify({ leases, processes: verdicts, killable: killable.map((entry) => entry.pid) }, null, 2));
    return;
  }
  const fixtureIndex = args.indexOf("--classify-fixture");
  if (fixtureIndex >= 0) {
    const fixture = JSON.parse(await readFile(args[fixtureIndex + 1], "utf8"));
    const previousCpu = new Map(Object.entries(fixture.previousCpu ?? {}));
    const parentAlive = (pid) => Boolean(fixture.aliveParents?.[pid]);
    console.log(JSON.stringify(classify({ processes: fixture.processes ?? [], previousCpu, now: fixture.now ?? Date.now(), limits: fixture.limits ?? {}, parentAlive }), null, 2));
    return;
  }
  const leaseIndex = args.indexOf("--leases-fixture");
  if (leaseIndex >= 0) {
    const fixture = JSON.parse(await readFile(args[leaseIndex + 1], "utf8"));
    const result = await leaseStatus({
      repoRoot: fixture.repoRoot,
      alive: (pid) => Boolean(fixture.alivePids?.[pid]),
      now: fixture.now ?? Date.now(),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.error("usage: node scripts/machine.mjs --scan | --classify-fixture <f> | --leases-fixture <dir>");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
