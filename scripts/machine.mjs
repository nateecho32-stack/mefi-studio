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
import studioPaths from "./paths.cjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { repoRoot: DEFAULT_ROOT } = studioPaths.resolveStudioPaths({ studioRoot: STUDIO });

export const TEST_MARKERS = ["lua_quality_runner", ".codex_smoke", "TRIPPY_LUA_QUALITY_CHECK", "[test]", "invoke-love", "feature-smoke"];
export const LEASE_MAX_AGE_HOURS = 6;

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
  } catch {
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

export async function processSnapshot({ powershell = "powershell" } = {}) {
  const script =
    "Get-CimInstance Win32_Process -Filter \\\"Name='lovec.exe' OR Name='love.exe'\\\" | " +
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize | ConvertTo-Json -Compress";
  return await new Promise((resolve) => {
    const child = spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
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
