// Guards scripts/test-lease.mjs: test runs from different worktrees and
// sessions on one PC take turns per lane, first come first served, and a run
// that died or went silent never holds a lane.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANES, STAGE_LIMITS_MIN, acquire, admits, describeBoard, killTree, laneForFiles, leaseDir, leaseOff, parseRunArgs, pidAlive, readBoard,
  stageLimitMs, suggestWidth, suggestWindowWidth, withLease,
} from "../scripts/test-lease.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = () => {};
const fast = { pollMs: 10, noticeMs: 60_000, beatMs: 60_000, log: quiet };

async function board(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-lease-test-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

test("the board lives in one machine-wide folder, never in a worktree", () => {
  assert.equal(leaseDir({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32"), path.join("C:\\Users\\me\\AppData\\Local", "MefiStudio", "test-lease"));
  assert.equal(leaseDir({}, "linux"), path.join(os.tmpdir(), "mefi-studio-test-lease"));
  assert.equal(leaseDir({ MEFI_TEST_LEASE_DIR: "somewhere", LOCALAPPDATA: "x" }, "win32"), path.resolve("somewhere"));
  assert.equal(leaseOff({ MEFI_TEST_LEASE: "off" }), true);
  assert.equal(leaseOff({ MEFI_TEST_LEASE: "0" }), true);
  assert.equal(leaseOff({}), false);
  assert.equal(LANES.windows.capacity, 1, "one Electron lane on the machine at a time");
  assert.equal(LANES.suites.capacity, 2);
});

test("a second run waits for the lane and starts the moment the first gives it back", async (t) => {
  const dir = await board(t);
  const first = await acquire({ lane: "windows", label: "first", dir, env: {}, ...fast });
  assert.equal(first.skipped, false);
  let secondStarted = false;
  const second = acquire({ lane: "windows", label: "second", dir, env: {}, pid: process.pid, ...fast }).then((lease) => {
    secondStarted = true;
    return lease;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(secondStarted, false, "the lane holds one run");
  const view = await readBoard({ dir });
  assert.deepEqual(view.live.map((entry) => [entry.label, entry.state]), [["first", "holding"], ["second", "waiting"]]);
  await first.release();
  const lease = await second;
  assert.equal(secondStarted, true);
  assert.ok(lease.waitedMs >= 100);
  await lease.release();
  assert.deepEqual(await readdir(dir), [], "nothing is left behind");
});

test("waiters start in the order they arrived, and the parallel lane holds two", async (t) => {
  const dir = await board(t);
  const order = [];
  let clock = 1_000_000;
  const now = () => (clock += 1);
  const holder = await acquire({ lane: "windows", label: "holder", dir, env: {}, now, ...fast });
  const waiters = [];
  for (const label of ["a", "b", "c"]) {
    waiters.push(acquire({ lane: "windows", label, dir, env: {}, now, ...fast }).then(async (lease) => {
      order.push(label);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await lease.release();
    }));
    // Each one is in line before the next arrives.
    for (let tries = 0; tries < 100 && !(await readBoard({ dir, now: now() })).live.some((entry) => entry.label === label); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(order, [], "nobody starts while the holder runs");
  await holder.release();
  await Promise.all(waiters);
  assert.deepEqual(order, ["a", "b", "c"]);

  const one = await acquire({ lane: "suites", dir, env: {}, ...fast });
  const two = await acquire({ lane: "suites", dir, env: {}, ...fast });
  let third = false;
  const pending = acquire({ lane: "suites", dir, env: {}, ...fast }).then((lease) => { third = true; return lease; });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(third, false, "two parallel stages at a time");
  await one.release();
  await (await pending).release();
  await two.release();
});

test("a holder whose process is gone, or whose heartbeat stopped, no longer holds the lane", async (t) => {
  const dir = await board(t);
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  await writeFile(path.join(dir, `windows~${String(Date.now() - 5000).padStart(13, "0")}~424242~deadbeef.json`),
    JSON.stringify({ id: "windows~dead", lane: "windows", state: "holding", pid: 424242, tree: "C:\\wt\\gone", startedUtc: old, beatUtc: new Date().toISOString() }));
  await writeFile(path.join(dir, `windows~${String(Date.now() - 4000).padStart(13, "0")}~${process.pid}~cafef00d.json`),
    JSON.stringify({ id: "windows~silent", lane: "windows", state: "holding", pid: process.pid, tree: "C:\\wt\\silent", startedUtc: old, beatUtc: old }));
  const alive = (pid) => pid === process.pid;
  const view = await readBoard({ dir, alive, prune: false });
  assert.deepEqual(view.stale.map((entry) => entry.staleReason), ["process gone", "no heartbeat"]);
  const lease = await acquire({ lane: "windows", dir, env: {}, alive, ...fast });
  assert.ok(lease.waitedMs < 2000, "the leftovers did not hold the lane");
  await lease.release();
  assert.deepEqual(await readdir(dir), [], "the leftovers were cleared");
});

test("nobody waits forever: after the limit a run starts anyway and names the holder that looked stuck", async (t) => {
  const dir = await board(t);
  const holder = await acquire({ lane: "windows", label: "stuck gate", dir, env: {}, ...fast });
  const lines = [];
  const lease = await acquire({ lane: "windows", dir, env: {}, ...fast, maxWaitMs: 60, log: (line) => lines.push(line) });
  assert.equal(lease.forced, true);
  assert.match(lines.join("\n"), /running anyway[\s\S]*stuck gate/);
  await lease.release();
  await holder.release();
  const envLimited = acquire({ lane: "windows", dir, env: { MEFI_TEST_LEASE_MAX_WAIT_MIN: "0" }, ...fast });
  assert.equal((await envLimited).forced, false, "a free lane starts without forcing");
  await (await envLimited).release();
});

test("switched off, or with no writable board, a run starts at once and writes nothing", async (t) => {
  const dir = await board(t);
  const off = await acquire({ lane: "windows", dir, env: { MEFI_TEST_LEASE: "off" }, ...fast });
  assert.equal(off.skipped, true);
  assert.deepEqual(await readdir(dir), []);
  const blocker = path.join(dir, "a-file");
  await writeFile(blocker, "not a folder");
  const lines = [];
  const unwritable = await acquire({ lane: "windows", dir: path.join(blocker, "board"), env: {}, ...fast, log: (line) => lines.push(line) });
  assert.equal(unwritable.skipped, true);
  assert.match(lines.join("\n"), /running without a lease/);
  await unwritable.release();
});

test("withLease gives the turn back when the work throws", async (t) => {
  const dir = await board(t);
  await assert.rejects(withLease({ lane: "suites", dir, env: {}, ...fast }, async () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(await readdir(dir), []);
});

test("admits() reads capacity, holders and the queue", () => {
  const live = [
    { id: "h", lane: "windows", state: "holding" },
    { id: "w1", lane: "windows", state: "waiting" },
    { id: "s1", lane: "suites", state: "waiting" },
  ];
  assert.equal(admits({ live }, "w1").ok, false);
  assert.equal(admits({ live }, "s1").ok, true);
  assert.equal(admits({ live: live.slice(1) }, "w1").ok, true);
  assert.equal(admits({ live }, "missing").ok, false);
});

test("the parallel stage narrows with free memory, never under four, and MEFI_TEST_WIDTH decides outright", () => {
  assert.equal(suggestWidth({ freeMB: 8000, threads: 16, env: {} }), 15, "plenty of memory: Node's own default");
  assert.equal(suggestWidth({ freeMB: 1200, threads: 16, env: {} }), 10);
  assert.equal(suggestWidth({ freeMB: 700, threads: 16, env: {} }), 4, "the owner's laptop on a busy day");
  assert.equal(suggestWidth({ freeMB: 100, threads: 16, env: {} }), 4);
  assert.equal(suggestWidth({ freeMB: 100, threads: 2, env: {} }), 1, "a two-thread runner keeps Node's width of one");
  assert.equal(suggestWidth({ freeMB: Number.NaN, threads: 4, env: {} }), 3, "no reading: Node's default");
  assert.equal(suggestWidth({ freeMB: 700, threads: 16, env: { MEFI_TEST_WIDTH: "12" } }), 12);
  assert.equal(suggestWindowWidth({ freeMB: 2000, env: {} }), 2);
  assert.equal(suggestWindowWidth({ freeMB: 600, env: {} }), 1);
  assert.equal(suggestWindowWidth({ freeMB: 600, env: { MEFI_TEST_WINDOW_WIDTH: "2" } }), 2);
});

test("a run picks the Electron lane when a file it runs drives a window", () => {
  const sources = { "tests/a_render.test.mjs": 'spawn(electron, [path.join(studio, "tests", "fixtures", "a-render-electron.cjs")])', "tests/b.test.mjs": "plain" };
  const read = (file) => sources[file];
  assert.equal(laneForFiles(["tests/b.test.mjs"], read), "suites");
  assert.equal(laneForFiles(["tests/b.test.mjs", "tests/a_render.test.mjs"], read), "windows");
  assert.equal(laneForFiles([path.join(studio, "tests", "occlusion_probe.test.mjs")]), "windows", "the real occlusion probe is a window suite");
  assert.deepEqual(parseRunArgs(["--lane", "windows", "--", "node", "x"]), { lane: "windows", command: ["node", "x"], testFiles: false });
  assert.deepEqual(parseRunArgs(["--test-files", "--", "tests/x.test.mjs"]), { lane: "auto", command: ["tests/x.test.mjs"], testFiles: true });
});

test("the board reads as plain lines: who runs, who waits, where from", () => {
  const now = Date.parse("2026-10-06T02:00:00Z");
  const lines = describeBoard({
    live: [
      { lane: "windows", state: "holding", tree: "C:\\wt\\scaling", label: "npm test: Electron fixtures", pid: 7, heldUtc: "2026-10-06T01:48:00Z", startedUtc: "2026-10-06T01:40:00Z" },
      { lane: "windows", state: "waiting", tree: "C:\\wt\\coop", label: "shell_render", pid: 8, startedUtc: "2026-10-06T01:58:00Z" },
    ],
    stale: [{}],
  }, now);
  assert.match(lines[0], /^windows: the Electron lane, 1 at a time/);
  assert.match(lines[1], /running {2}C:\\wt\\scaling \(npm test: Electron fixtures, running 12 min, pid 7\)/);
  assert.match(lines[2], /waiting {2}C:\\wt\\coop \(shell_render, waiting 2 min, pid 8\)/);
  assert.match(lines[3], /^suites: free/);
  assert.match(lines[4], /1 leftover lease file/);
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(0), false);
});

test("two processes: a command run under the lease holds the Electron lane until it exits", { timeout: 60_000 }, async (t) => {
  const dir = await board(t);
  const env = { ...process.env, MEFI_TEST_LEASE_DIR: dir, MEFI_TEST_LEASE: "" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ["scripts/test-lease.mjs", "run", "--lane", "windows", "--", process.execPath, "-e", "setTimeout(() => process.exit(3), 1500)"], { cwd: studio, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.once("close", resolve));
  // Wait until the child holds the lane.
  for (let tries = 0; tries < 200; tries += 1) {
    const view = await readBoard({ dir });
    if (view.live.some((entry) => entry.state === "holding")) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  // The other process gives the lane back from its exit handler, a moment
  // before this one hears it close, so the wait itself is the evidence.
  const lease = await acquire({ lane: "windows", dir, env: {}, ...fast, pollMs: 20 });
  assert.ok(lease.waitedMs >= 1000, `the lane opened only once the other process was done (waited ${lease.waitedMs} ms; ${output})`);
  assert.equal(lease.forced, false);
  await lease.release();
  assert.equal(await exited, 3, "the command's exit code passes through");
  assert.deepEqual(await readdir(dir), []);
});

test("a stage has an end: past its limit the runner stops it with everything it started", () => {
  assert.deepEqual({ ...STAGE_LIMITS_MIN }, { suites: 120, windows: 90, exclusive: 30 });
  assert.equal(stageLimitMs("windows", {}), 90 * 60_000);
  assert.equal(stageLimitMs("exclusive", {}), 30 * 60_000);
  assert.equal(stageLimitMs("anything else", {}), 120 * 60_000);
  assert.equal(stageLimitMs("windows", { MEFI_TEST_STAGE_LIMIT_MIN: "0.5" }), 30_000);
  assert.equal(stageLimitMs("windows", { MEFI_TEST_STAGE_LIMIT_MIN: "nonsense" }), 90 * 60_000);
  // Windows: taskkill /T, tried again when a starved machine cannot start it, and a plain kill as the last resort.
  const calls = [];
  const failing = (command, args) => { calls.push([command, ...args]); return { status: 1 }; };
  const killed = [];
  assert.equal(killTree(4242, { platform: "win32", spawnSyncImpl: failing, kill: (pid, signal) => killed.push([pid, signal]) }), true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ["taskkill", "/PID", "4242", "/T", "/F"]);
  assert.deepEqual(killed, [[4242, "SIGKILL"]]);
  const once = [];
  assert.equal(killTree(7, { platform: "win32", spawnSyncImpl: (command, args) => { once.push(args); return { status: 0 }; }, kill: () => { throw new Error("not reached"); } }), true);
  assert.equal(once.length, 1);
  assert.equal(killTree(7, { platform: "linux", spawnSyncImpl: () => { throw new Error("no taskkill here"); }, kill: () => {} }), true);
  assert.equal(killTree(0, { platform: "win32" }), false);
});
