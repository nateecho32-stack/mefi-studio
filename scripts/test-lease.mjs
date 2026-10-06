#!/usr/bin/env node
// Mefi's Studio AI+ — test runs that take turns on one PC.
//
// Several Claude Code, Codex and Studio sessions gate this repository at the
// same time, each from its own worktree. One `npm test` starts up to 15 Node
// suites at once on the owner's 16-thread laptop, then two live Electron
// windows. On 2026-10-05 two agents and a gate together left 12 MB free: git
// and Electron failed to start (0xC0000142), 22 git suites failed for that
// reason alone, and a gate ran 2 h 14 min. This module makes the heavy stages
// take turns across every worktree and clone on the machine:
//
// - The lease board is one machine-wide folder, never inside a worktree:
//   %LOCALAPPDATA%\MefiStudio\test-lease on Windows, the temp folder
//   elsewhere, or MEFI_TEST_LEASE_DIR.
// - Each waiter and holder is one small JSON file, rewritten every 30 s as a
//   heartbeat. A file whose process is gone, or whose heartbeat is ten
//   minutes old, no longer counts, and the next reader deletes it.
// - Two lanes: "windows" (suites that drive real Electron windows, one run
//   at a time on the machine) and "suites" (the parallel Node stage, two at
//   a time).
// - First come, first served: waiters start in the order they arrived.
// - Nobody waits forever: after MEFI_TEST_LEASE_MAX_WAIT_MIN minutes (60 by
//   default) a waiter runs anyway and names the holder that looked stuck.
//
// A turn also has an end: a stage that runs past its limit (MEFI_TEST_STAGE_LIMIT_MIN;
// 120 minutes for the parallel stage, 90 for the Electron lane, 30 for each
// exclusive fixture) is stopped with everything it started. On 2026-10-06 an
// Electron fixture whose own kill timer never landed (29 MB free) held the
// Electron lane for nine hours, and every other run's windows waited on it.
//
// MEFI_TEST_LEASE=off turns all of it off. `node scripts/test-lease.mjs`
// prints the board; `node scripts/test-lease.mjs run [--lane windows|suites]
// -- <command>` runs one command under a lease, and `npm run test:one --
// tests/x.test.mjs` picks the lane from what the files launch.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANES = Object.freeze({
  windows: Object.freeze({ capacity: 1, label: "the Electron lane" }),
  suites: Object.freeze({ capacity: 2, label: "the parallel Node suites" }),
});

export const LEASE_DEFAULTS = Object.freeze({
  beatMs: 30_000,
  staleMs: 10 * 60_000,
  pollMs: 2_000,
  noticeMs: 30_000,
  maxWaitMs: 60 * 60_000,
  // A file that does not parse is a write still landing; after this long it
  // is a leftover and the reader removes it.
  tornMs: 60_000,
});

const LEASE_FILE = /^(windows|suites)~(\d{13})~(\d+)~([0-9a-f]{8})\.json$/;

export function leaseOff(env = process.env) {
  return /^(off|0|false|no)$/i.test(String(env.MEFI_TEST_LEASE ?? "").trim());
}

export function leaseDir(env = process.env, platform = process.platform) {
  if (env.MEFI_TEST_LEASE_DIR) return path.resolve(env.MEFI_TEST_LEASE_DIR);
  if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "MefiStudio", "test-lease");
  return path.join(os.tmpdir(), "mefi-studio-test-lease");
}

// A process this user cannot signal still exists: kill(pid, 0) throws EPERM
// for it, and reading that as "gone" would hand its lane to someone else.
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function minutesSince(iso, now) {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 60_000)) : null;
}

// Every lease file of every lane, sorted by arrival, each marked live or
// stale. Stale and long-torn files are deleted on the way (best effort: a
// file another reader already removed is fine).
export async function readBoard({ dir = leaseDir(), now = Date.now(), alive = pidAlive, staleMs = LEASE_DEFAULTS.staleMs, tornMs = LEASE_DEFAULTS.tornMs, prune = true } = {}) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return { dir, entries: [], live: [], stale: [] };
    throw error;
  }
  const entries = [];
  for (const name of names) {
    const match = LEASE_FILE.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    let record = null;
    try {
      record = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      const info = await stat(file).catch(() => null);
      if (prune && info && now - info.mtimeMs > tornMs) await unlink(file).catch(() => {});
      continue;
    }
    const beat = Date.parse(record.beatUtc ?? record.startedUtc ?? "");
    const pid = Number(record.pid ?? match[3]);
    const gone = !alive(pid);
    const silent = !Number.isFinite(beat) || now - beat > staleMs;
    entries.push({
      ...record,
      name,
      file,
      lane: match[1],
      ticket: Number(match[2]),
      pid,
      state: record.state === "holding" ? "holding" : "waiting",
      stale: gone || silent,
      staleReason: gone ? "process gone" : silent ? "no heartbeat" : null,
    });
  }
  entries.sort((a, b) => a.ticket - b.ticket || a.name.localeCompare(b.name));
  const stale = entries.filter((entry) => entry.stale);
  if (prune) for (const entry of stale) await unlink(entry.file).catch(() => {});
  return { dir, entries, live: entries.filter((entry) => !entry.stale), stale };
}

// Whether the entry `id` may start in its lane now: fewer holders than the
// lane's capacity, and no more waiters ahead of it than the free places.
export function admits(board, id, lanes = LANES) {
  const me = board.live.find((entry) => entry.id === id);
  if (!me) return { ok: false, ahead: [], holders: [] };
  const capacity = lanes[me.lane]?.capacity ?? 1;
  const holders = board.live.filter((entry) => entry.lane === me.lane && entry.state === "holding" && entry.id !== id);
  const waiting = board.live.filter((entry) => entry.lane === me.lane && entry.state === "waiting");
  const position = waiting.findIndex((entry) => entry.id === id);
  const ahead = position > 0 ? waiting.slice(0, position) : [];
  return { ok: me.state === "holding" || (holders.length < capacity && position >= 0 && position < capacity - holders.length), ahead, holders };
}

export function describeEntry(entry, now = Date.now()) {
  const minutes = minutesSince(entry.state === "holding" ? entry.heldUtc ?? entry.startedUtc : entry.startedUtc, now);
  const what = entry.label || entry.lane;
  const state = entry.state === "holding" ? "running" : "waiting";
  return `${entry.tree || "?"} (${what}, ${state} ${minutes ?? "?"} min, pid ${entry.pid})`;
}

export function describeBoard(board, now = Date.now(), lanes = LANES) {
  const lines = [];
  for (const [lane, spec] of Object.entries(lanes)) {
    const live = board.live.filter((entry) => entry.lane === lane);
    if (!live.length) {
      lines.push(`${lane}: free (${spec.label}, ${spec.capacity} at a time)`);
      continue;
    }
    lines.push(`${lane}: ${spec.label}, ${spec.capacity} at a time`);
    for (const entry of live) lines.push(`  ${entry.state === "holding" ? "running" : "waiting"}  ${describeEntry(entry, now)}`);
  }
  if (board.stale?.length) lines.push(`(${board.stale.length} leftover lease file(s) from ended runs were cleared)`);
  return lines;
}

async function writeAtomic(file, body) {
  const temp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, body);
  // Windows refuses a rename onto a file another process has open for the
  // moment it takes to read it; the reader is done a few ms later.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      if (attempt >= 20 || !["EPERM", "EACCES", "EBUSY"].includes(error?.code)) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 10));
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for a place in `lane`, then holds it until release(). Returns
// { id, lane, waitedMs, forced, release(), update(fields) }. With the lease
// switched off, or when the board folder cannot be written, it returns at
// once with `skipped` set and release() does nothing.
export async function acquire({
  lane,
  label = "",
  tree = process.cwd(),
  width = null,
  dir = leaseDir(),
  env = process.env,
  pid = process.pid,
  now = () => Date.now(),
  alive = pidAlive,
  wait = sleep,
  log = (line) => console.log(line),
  lanes = LANES,
  ...overrides
} = {}) {
  if (!lanes[lane]) throw new Error(`test-lease: unknown lane ${lane}`);
  const options = { ...LEASE_DEFAULTS, ...overrides };
  const envWait = Number(env.MEFI_TEST_LEASE_MAX_WAIT_MIN);
  if (Number.isFinite(envWait) && envWait >= 0 && overrides.maxWaitMs == null) options.maxWaitMs = envWait * 60_000;
  const nothing = { id: null, lane, waitedMs: 0, forced: false, skipped: true, release: async () => {}, releaseSync: () => {}, update: async () => {} };
  if (leaseOff(env)) return { ...nothing, reason: "MEFI_TEST_LEASE is off" };
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    log(`test-lease: running without a lease, the board folder ${dir} could not be made (${error?.code ?? error?.message})`);
    return { ...nothing, reason: "no board folder" };
  }
  const arrived = now();
  const id = `${lane}~${String(arrived).padStart(13, "0")}~${pid}~${randomBytes(4).toString("hex")}`;
  const file = path.join(dir, `${id}.json`);
  const record = {
    id,
    lane,
    state: "waiting",
    pid,
    tree: path.resolve(tree),
    label,
    width,
    host: os.hostname(),
    startedUtc: new Date(arrived).toISOString(),
    beatUtc: new Date(arrived).toISOString(),
  };
  const save = async () => {
    record.beatUtc = new Date(now()).toISOString();
    await writeAtomic(file, `${JSON.stringify(record)}\n`);
  };
  try {
    await save();
  } catch (error) {
    log(`test-lease: running without a lease, ${file} could not be written (${error?.code ?? error?.message})`);
    return { ...nothing, reason: "board not writable" };
  }
  let released = false;
  const releaseSync = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    process.off("exit", releaseSync);
    try { unlinkSync(file); } catch { /* already gone */ }
  };
  // The heartbeat keeps the file fresh while the holder's event loop runs;
  // the process-gone test covers a holder that is killed outright.
  const beat = setInterval(() => { save().catch(() => {}); }, options.beatMs);
  beat.unref?.();
  process.on("exit", releaseSync);

  let forced = false;
  let lastNotice = -Infinity;
  for (;;) {
    const board = await readBoard({ dir, now: now(), alive, staleMs: options.staleMs, tornMs: options.tornMs });
    if (!board.live.some((entry) => entry.id === id)) {
      // Someone pruned this file (a clock jump made it look silent): put it
      // back. It keeps its arrival time, so its place in line too.
      await save().catch(() => {});
      await wait(options.pollMs);
      continue;
    }
    const verdict = admits(board, id, lanes);
    if (verdict.ok) break;
    const waited = now() - arrived;
    if (waited >= options.maxWaitMs) {
      forced = true;
      const stuck = verdict.holders.map((entry) => describeEntry(entry, now())).join("; ") || "nobody";
      log(`test-lease: waited ${Math.round(waited / 60_000)} min for ${lanes[lane].label}; running anyway. Holder(s) that looked stuck: ${stuck}`);
      break;
    }
    if (now() - lastNotice >= options.noticeMs) {
      lastNotice = now();
      const holders = verdict.holders.map((entry) => describeEntry(entry, now())).join("; ");
      log(`test-lease: waiting for ${lanes[lane].label}${holders ? `, held by ${holders}` : ""}` +
        `${verdict.ahead.length ? `; ${verdict.ahead.length} ahead of this run` : ""} (waited ${Math.round(waited / 1000)} s)`);
    }
    await wait(options.pollMs);
  }
  record.state = "holding";
  record.heldUtc = new Date(now()).toISOString();
  await save().catch(() => {});
  const waitedMs = now() - arrived;
  return {
    id,
    lane,
    file,
    waitedMs,
    forced,
    skipped: false,
    release: async () => releaseSync(),
    releaseSync,
    update: async (fields = {}) => {
      Object.assign(record, fields);
      await save().catch(() => {});
    },
  };
}

// Runs fn() while holding a place in `lane`; the place is given back even
// when fn throws.
export async function withLease(options, fn) {
  const lease = await acquire(options);
  try {
    return await fn(lease);
  } finally {
    await lease.release();
  }
}

// How many Node suites the parallel stage should run at once. Node's own
// default is one per hardware thread less one: 15 on the owner's laptop,
// which with ~0.7 GB free pushed git and Electron past what Windows could
// start. Below `fullMB` free the width shrinks by `perSuiteMB` a suite,
// never under `min`. MEFI_TEST_WIDTH sets it outright.
export function suggestWidth({ freeMB, threads, env = process.env, reserveMB = 400, perSuiteMB = 80, min = 4 } = {}) {
  const forced = Number.parseInt(env.MEFI_TEST_WIDTH ?? "", 10);
  if (Number.isInteger(forced) && forced > 0) return forced;
  const ceiling = Math.max(1, Math.floor(Number(threads) || 1) - 1);
  if (!Number.isFinite(freeMB)) return ceiling;
  const byMemory = Math.floor((freeMB - reserveMB) / perSuiteMB);
  return Math.max(Math.min(min, ceiling), Math.min(ceiling, byMemory));
}

// How many Electron fixtures the windows lane runs at once: two (the old
// fixed width) while the machine has room for two windows, else one.
export function suggestWindowWidth({ freeMB, env = process.env, roomMB = 900 } = {}) {
  const forced = Number.parseInt(env.MEFI_TEST_WINDOW_WIDTH ?? "", 10);
  if (Number.isInteger(forced) && forced > 0) return forced;
  return Number.isFinite(freeMB) && freeMB < roomMB ? 1 : 2;
}

export const freeMemoryMB = () => os.freemem() / (1024 * 1024);

/** How long a stage may run before the runner stops it, in minutes, by kind of stage. */
export const STAGE_LIMITS_MIN = Object.freeze({ suites: 120, windows: 90, exclusive: 30 });

export function stageLimitMs(kind, env = process.env) {
  const forced = Number(env.MEFI_TEST_STAGE_LIMIT_MIN);
  if (env.MEFI_TEST_STAGE_LIMIT_MIN != null && env.MEFI_TEST_STAGE_LIMIT_MIN !== "" && Number.isFinite(forced) && forced > 0) return Math.round(forced * 60_000);
  return (STAGE_LIMITS_MIN[kind] ?? STAGE_LIMITS_MIN.suites) * 60_000;
}

// Ends a process and everything it started. On Windows that is taskkill /T
// (an Electron fixture is a grandchild of the stage, and a plain kill leaves
// it running); it is tried three times, since a starved machine can fail to
// start taskkill itself. Elsewhere, and as the last resort, SIGKILL. -> stopped?
export function killTree(pid, { platform = process.platform, spawnSyncImpl = spawnSync, kill = process.kill.bind(process) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === "win32") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ran = spawnSyncImpl("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 30_000 });
      if (ran?.status === 0) return true;
    }
  }
  try {
    kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

// A test file that drives a real Electron window: the same reading
// scripts/run-node-tests.mjs uses to put a suite in the Electron lane.
export const LAUNCHES_ELECTRON = /-electron\.cjs|electron[\\/]dist|require\("electron"\)/;

export function laneForFiles(files, read = (file) => readFileSync(file, "utf8")) {
  for (const file of files) {
    if (!/\.test\.mjs$/.test(file)) continue;
    try {
      if (LAUNCHES_ELECTRON.test(read(file))) return "windows";
    } catch {
      // a file that cannot be read is node --test's error to report
    }
  }
  return "suites";
}

export function parseRunArgs(argv) {
  const split = argv.indexOf("--");
  const own = split >= 0 ? argv.slice(0, split) : argv;
  const command = split >= 0 ? argv.slice(split + 1) : [];
  const laneAt = own.indexOf("--lane");
  const lane = laneAt >= 0 ? own[laneAt + 1] : "auto";
  const testFiles = own.includes("--test-files");
  return { lane, command, testFiles };
}

async function runCommand(argv) {
  const { lane: asked, command, testFiles } = parseRunArgs(argv);
  if (!command.length) {
    console.error("usage: node scripts/test-lease.mjs run [--lane windows|suites|auto] [--test-files] -- <command> [args]");
    return 2;
  }
  // --test-files: the arguments are test files (and flags) for `node --test`,
  // and the run's suite timings join the machine's record.
  const timingsModule = testFiles ? await import("./test-timings.mjs") : null;
  const samples = testFiles ? path.join(os.tmpdir(), `mefi-test-one-${process.pid}-${randomBytes(4).toString("hex")}.jsonl`) : null;
  const reporters = testFiles ? [
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    `--test-reporter=${new URL("./test-timings.mjs", import.meta.url).href}`, `--test-reporter-destination=${samples}`,
  ] : [];
  const full = testFiles ? [process.execPath, "--test", ...reporters, ...command] : command;
  const lane = asked === "auto" ? laneForFiles(full.filter((arg) => /\.test\.mjs$/.test(arg))) : asked;
  if (!LANES[lane]) {
    console.error(`test-lease: unknown lane ${lane} (windows, suites or auto)`);
    return 2;
  }
  const label = full.filter((arg) => /\.test\.mjs$/.test(arg)).map((arg) => path.basename(arg, ".test.mjs")).join(", ") || path.basename(full[0]);
  return await withLease({ lane, label }, async (lease) => {
    if (lease.waitedMs >= 1000) console.log(`test-lease: ${LANES[lane].label} is free after ${Math.round(lease.waitedMs / 1000)} s`);
    const child = spawn(full[0], full.slice(1), { stdio: "inherit", shell: false, windowsHide: false });
    const code = await new Promise((resolve) => {
      child.once("error", (error) => {
        console.error(`test-lease: could not start ${full[0]}: ${error.message}`);
        resolve(1);
      });
      child.once("close", (status, signal) => resolve(status ?? (signal ? 1 : 0)));
    });
    if (timingsModule) {
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      await timingsModule.recordRun(samples, { root }).catch(() => {});
      await unlink(samples).catch(() => {});
    }
    return code;
  });
}

async function cli(argv) {
  if (argv[0] === "run") return await runCommand(argv.slice(1));
  if (argv.length && !["status", "--status", "--slowest"].includes(argv[0])) {
    console.error("usage: node scripts/test-lease.mjs [status|--slowest] | run [--lane windows|suites|auto] [--test-files] -- <command>");
    return 2;
  }
  const dir = leaseDir();
  if (leaseOff()) console.log("test-lease: MEFI_TEST_LEASE is off in this shell; runs started from it take no turns");
  const board = await readBoard({ dir });
  console.log(`test-lease board: ${dir}`);
  for (const line of describeBoard(board)) console.log(line);
  console.log(`free memory: ${Math.round(freeMemoryMB())} MB; the parallel stage would run ${suggestWidth({ freeMB: freeMemoryMB(), threads: os.availableParallelism() })} suites at a time, the Electron lane ${suggestWindowWidth({ freeMB: freeMemoryMB() })}`);
  if (argv[0] === "--slowest") {
    const { readTimings, slowest, timingsFile } = await import("./test-timings.mjs");
    const rows = slowest(await readTimings(), 25);
    console.log(`slowest suites on this PC (${timingsFile()}):`);
    for (const row of rows) console.log(`  ${(row.ms / 1000).toFixed(1).padStart(6)} s  ${row.suite}${row.passed ? "" : "  (failed last time)"}`);
    if (!rows.length) console.log("  none recorded yet: they are recorded by npm test and npm run test:one");
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A Ctrl+C or a stop request still gives the place back.
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
    try { process.on(signal, () => process.exit(130)); } catch { /* not on this platform */ }
  }
  cli(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`test-lease: ${error?.message ?? error}`);
    process.exit(1);
  });
}
