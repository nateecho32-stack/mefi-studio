import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import platform from "../scripts/platform.cjs";
import credentials from "../scripts/credentials.cjs";
import { processSnapshot } from "../scripts/machine.mjs";

const { createSpawn } = platform;

function recorder() {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return Object.assign(new EventEmitter(), { pid: 4242 });
  };
  return { calls, spawnImpl };
}

const shellArgs = (command) => ["/d", "/s", "/c", command];
const killArgs = (pid) => ["/pid", String(pid), "/t", "/f"];
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

test("on Windows every call reaches node's spawn untouched", () => {
  const { calls, spawnImpl } = recorder();
  // An inherited environment holding no Studio credentials, whatever the
  // machine running this suite happens to export.
  const spawn = createSpawn({ platform: "win32", spawnImpl, env: {} });
  spawn("cmd.exe", shellArgs("opencode run --auto"), { cwd: "C:/repo", windowsHide: true });
  spawn("where.exe", ["claude"], { windowsHide: true });
  spawn("taskkill", killArgs(77), { windowsHide: true, stdio: "ignore" });
  assert.deepEqual(calls.map((call) => call.command), ["cmd.exe", "where.exe", "taskkill"]);
  assert.deepEqual(calls[0].args, shellArgs("opencode run --auto"));
  assert.deepEqual(calls[0].options, { cwd: "C:/repo", windowsHide: true });
  assert.deepEqual(calls[2].args, killArgs(77));
});

// A headless install hands Studio its keys as MEFI_STUDIO_* variables. Coding
// workers run repository-driven commands with approvals bypassed, and none of
// them reads those names, so no child may inherit them.
test("Studio's own credentials never reach a child, on either platform", () => {
  for (const host of ["win32", "linux"]) {
    const { calls, spawnImpl } = recorder();
    const inherited = {
      PATH: "C:/bin", GH_TOKEN: "shared-gh", OPENROUTER_API_KEY: "shared-or", MEFI_STUDIO_GAME_ROOT: "C:/game",
      MEFI_STUDIO_ZAI_KEY: "own-zai", mefi_studio_github_token: "own-gh",
    };
    const spawn = createSpawn({ platform: host, spawnImpl, kill: () => {}, env: inherited });
    spawn("cmd.exe", shellArgs("opencode run --auto"), { cwd: "C:/repo" });
    assert.deepEqual(calls[0].options.env,
      { PATH: "C:/bin", GH_TOKEN: "shared-gh", OPENROUTER_API_KEY: "shared-or", MEFI_STUDIO_GAME_ROOT: "C:/game" },
      `${host}: own names withheld (case-insensitively), shared names and settings kept`);
    assert.equal(calls[0].options.cwd, "C:/repo");
    assert.equal(inherited.MEFI_STUDIO_ZAI_KEY, "own-zai", "Studio's own environment is left alone");
  }
});

test("an environment the caller passes is filtered the same way, not mutated, and keeps what it hands over", () => {
  const { calls, spawnImpl } = recorder();
  const spawn = createSpawn({ platform: "win32", spawnImpl, env: {} });
  // MEFI_ZAI_API_KEY is the z.ai key deliberately handed to the mefi-zai
  // provider under its own name; only Studio's own names are withheld.
  const options = { env: { A: "1", MEFI_STUDIO_JEV_KEY: "own", MEFI_ZAI_API_KEY: "handed-over" }, windowsHide: true };
  spawn("cmd.exe", shellArgs("opencode run --auto"), options);
  assert.deepEqual(calls[0].options, { env: { A: "1", MEFI_ZAI_API_KEY: "handed-over" }, windowsHide: true });
  assert.deepEqual(options, { env: { A: "1", MEFI_STUDIO_JEV_KEY: "own", MEFI_ZAI_API_KEY: "handed-over" }, windowsHide: true });
});

test("with nothing to withhold, the caller's options object reaches spawn as passed", () => {
  const { calls, spawnImpl } = recorder();
  const spawn = createSpawn({ platform: "win32", spawnImpl, env: { PATH: "C:/bin", GH_TOKEN: "x" } });
  const options = { cwd: "C:/repo", windowsHide: true };
  spawn("cmd.exe", shellArgs("opencode run --auto"), options);
  spawn("where.exe", ["claude"]);
  assert.equal(calls[0].options, options, "the same object, not a copy");
  assert.equal(calls[1].options, undefined);
});

test("the withheld names are exactly credentials.cjs's own names", () => {
  // platform.cjs matches a pattern so it never depends on the optional
  // credentials helper; this pins the pattern to that helper's list.
  const own = Object.values(credentials.OWN_KEYS);
  const shared = Object.values(credentials.SHARED_KEYS).flat();
  const settings = ["MEFI_STUDIO_REPO", "MEFI_STUDIO_GAME_ROOT", "MEFI_STUDIO_BOARD_DB", "MEFI_STUDIO_PORT", "MEFI_STUDIO_UPDATE_REPO",
    "MEFI_STUDIO_NO_LIVE_UPDATE", "MEFI_STUDIO_WORKTREE_RUNS", "MEFI_STUDIO_WORKTREE_NPM_CI", "MEFI_STUDIO_MEMORY_WARN_OVERRIDE"];
  assert.equal(own.length, 8, "a new own credential needs this list and the pattern checked");
  const { calls, spawnImpl } = recorder();
  const inherited = Object.fromEntries([...own, ...shared, ...settings].map((name) => [name, "value"]));
  createSpawn({ platform: "win32", spawnImpl, env: inherited })("cmd.exe", shellArgs("x"), {});
  assert.deepEqual(Object.keys(calls[0].options.env).sort(), [...shared, ...settings].sort());
});

test("on Linux a cmd.exe command runs through /bin/sh in its own process group with the same options", () => {
  const { calls, spawnImpl } = recorder();
  const spawn = createSpawn({ platform: "linux", spawnImpl });
  const options = { cwd: "/work/repo", env: { A: "1" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] };
  spawn("cmd.exe", shellArgs("claude -p --output-format text"), options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/bin/sh");
  assert.deepEqual(calls[0].args, ["-c", "claude -p --output-format text"]);
  assert.deepEqual(calls[0].options, { ...options, detached: true });
  assert.deepEqual(options, { cwd: "/work/repo", env: { A: "1" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }, "the caller's options object is not mutated");
});

test("on Linux where.exe becomes which and other commands pass through", () => {
  const { calls, spawnImpl } = recorder();
  const spawn = createSpawn({ platform: "linux", spawnImpl });
  spawn("where.exe", ["grok"], { windowsHide: true });
  spawn("grok", ["--output-format", "plain"], { cwd: "/work" });
  spawn("gh", ["auth", "token"], {});
  assert.deepEqual(calls.map((call) => [call.command, call.args]), [
    ["which", ["grok"]],
    ["grok", ["--output-format", "plain"]],
    ["gh", ["auth", "token"]],
  ]);
});

test("on Linux opening a console window fails like a missing tool instead of running a stray shell", async () => {
  const { calls, spawnImpl } = recorder();
  const spawn = createSpawn({ platform: "linux", spawnImpl });
  const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "Mefi Claude Code", "cmd", "/k", "claude"], { detached: true, stdio: "ignore" });
  const error = await once(child, "error");
  assert.equal(error.code, "ENOTSUP");
  assert.equal(calls.length, 0);
});

test("on Linux taskkill removes the process group and reports taskkill's exit contract", async () => {
  const kills = [];
  const spawn = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: (pid, signal) => kills.push([pid, signal]) });
  const child = spawn("taskkill", killArgs(4242), { windowsHide: true, stdio: "ignore" });
  assert.equal(child.pid, null);
  assert.equal(await once(child, "close"), 0);
  assert.deepEqual(kills, [[-4242, "SIGKILL"]]);
});

test("a tree that is already gone counts as removed; a live process that refuses the group signal is killed by pid", async () => {
  const gone = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: () => { throw Object.assign(new Error("no such process"), { code: "ESRCH" }); } });
  assert.equal(await once(gone("taskkill", killArgs(4242)), "close"), 0);

  const kills = [];
  const noGroup = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: (pid, signal) => {
    kills.push([pid, signal]);
    if (pid < 0) throw Object.assign(new Error("not permitted"), { code: "EPERM" });
  } });
  assert.equal(await once(noGroup("taskkill", killArgs(9)), "close"), 0);
  assert.deepEqual(kills, [[-9, "SIGKILL"], [9, "SIGKILL"]]);

  const stuck = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: () => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); } });
  assert.equal(await once(stuck("taskkill", killArgs(9)), "close"), 1, "a tree that could not be removed is reported, so the caller retries");
});

// main.cjs removes the LÖVE child and every autopilot group from
// process.on("exit"), and Node abandons the nextTick queue the moment an exit
// handler returns. A signal deferred to a tick would never leave the building.
test("the group signal goes out synchronously, so a kill from an exit handler still lands", () => {
  const kills = [];
  const spawn = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: (pid, signal) => kills.push([pid, signal]) });
  spawn("taskkill", killArgs(4242), { windowsHide: true, stdio: "ignore" });
  assert.deepEqual(kills, [[-4242, "SIGKILL"]], "signalled during the call, with no tick awaited");
});

test("a pid that can only be a mistake is refused instead of signalled", async () => {
  const kills = [];
  const spawn = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: (pid, signal) => kills.push([pid, signal]) });
  // kill(0) signals every process in the caller's own group and pid 1 is init:
  // either would take the app, or the whole session, down with the target.
  for (const pid of [0, 1]) {
    assert.equal(await once(spawn("taskkill", killArgs(pid)), "close"), 1, `pid ${pid} is refused`);
  }
  assert.deepEqual(kills, [], "nothing was signalled");
});

// Both stubs stand in for a spawn, so the members main.cjs touches on a real
// child have to be there: a missing one throws a TypeError and loses the
// failure the call site was written to report.
test("a stubbed child carries the ChildProcess members its call site uses", async () => {
  const spawn = createSpawn({ platform: "linux", spawnImpl: recorder().spawnImpl, kill: () => {} });

  const consoleWindow = spawn("cmd.exe", ["/d", "/s", "/c", "start", "Mefi Claude Code", "cmd", "/k", "claude"], { detached: true, stdio: "ignore" });
  const refused = once(consoleWindow, "error");
  // main.cjs logs the refusal through an error listener and then unrefs.
  assert.equal(consoleWindow.unref(), consoleWindow, "unref is a no-op that returns the child");
  assert.equal(consoleWindow.stdout, null, "the streams match a stdio: \"ignore\" spawn");
  assert.equal((await refused).code, "ENOTSUP");

  const killer = spawn("taskkill", killArgs(4242), { windowsHide: true, stdio: "ignore" });
  // main.cjs kills this one when its own 15 s timeout wins the race.
  assert.equal(killer.kill(), true);
  assert.equal(killer.killed, true);
  assert.equal(await once(killer, "close"), 0);
});

test("the exported spawn on this host matches the platform it runs on", () => {
  assert.equal(platform.IS_WINDOWS, process.platform === "win32");
  assert.equal(typeof platform.spawn, "function");
});

test("on a POSIX host a translated shell can really be started and its group killed", { skip: process.platform === "win32" && "POSIX process groups" }, async () => {
  const spawn = createSpawn({ platform: process.platform, spawnImpl: realSpawn });
  const child = spawn("cmd.exe", shellArgs("sleep 30"), { stdio: "ignore" });
  await new Promise((resolve) => child.once("spawn", resolve));
  const killer = spawn("taskkill", killArgs(child.pid), { windowsHide: true, stdio: "ignore" });
  assert.equal(await once(killer, "close"), 0);
  const [code, signal] = await new Promise((resolve) => child.once("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal])));
  assert.ok(code !== 0 || signal === "SIGKILL", "the shell did not survive its own removal");
});

test("the Linux process snapshot reads LÖVE processes from ps with the Windows row shape", async () => {
  const output = [
    "  310   1  125 00:00:02 20480 love /usr/bin/love /work/game",
    "  311 310   60 01:02:03 4096 lovec lovec --smoke",
    "  400   1  999 00:00:10 8192 node node scripts/serve.mjs",
    "",
  ].join("\n");
  const spawnImpl = (command, args) => {
    assert.equal(command, "ps");
    assert.deepEqual(args, ["-eo", "pid=,ppid=,etimes=,time=,rss=,comm=,args="]);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
    process.nextTick(() => { child.stdout.emit("data", output); child.emit("close", 0); });
    return child;
  };
  const rows = await processSnapshot({ platform: "linux", spawnImpl, now: () => 1_000_000_000 });
  assert.deepEqual(rows, [
    { pid: 310, parentPid: 1, name: "love", commandLine: "/usr/bin/love /work/game", startedAt: 1_000_000_000 - 125_000, cpuMs: 2000, memMB: 20 },
    { pid: 311, parentPid: 310, name: "lovec", commandLine: "lovec --smoke", startedAt: 1_000_000_000 - 60_000, cpuMs: 3_723_000, memMB: 4 },
  ]);
});

// The shim postdates builds that are already installed. A real update carries
// it (scripts/updater.mjs holds a payload until every local require resolves,
// and the portable swap copies the whole tree), but an install that arrived
// some other way must still launch.
test("the host falls back to node's own spawn when the shim is missing", async () => {
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const from = main.indexOf("const { spawn } = optionalHelper(");
  assert.ok(from > 0, "the shim is loaded through the guard");
  const guarded = main.slice(from, main.indexOf("const { existsSync", from));
  assert.ok(guarded.includes('require("./scripts/platform.cjs")'), "the require is written out so the updater's scanner sees it");
  assert.ok(guarded.includes('{ spawn: require("node:child_process").spawn }'), "Windows behaviour without the shim is what it always was");
  const guard = main.slice(main.indexOf("function optionalHelper("), main.indexOf("const { spawn } = optionalHelper("));
  assert.ok(guard.includes('error?.code !== "MODULE_NOT_FOUND"'), "only a missing module is absorbed");
  assert.ok(guard.includes("String(error?.message ?? \"\").includes(request)"), "a module missing inside the helper still throws");
});

test("a host without ps yields an empty snapshot instead of an error", async () => {
  const spawnImpl = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
    process.nextTick(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  assert.deepEqual(await processSnapshot({ platform: "linux", spawnImpl }), []);
});

test("on Windows the CIM query runs only when tasklist shows a LÖVE process", async () => {
  const fake = (outputs) => {
    const spawned = [];
    const spawnImpl = (command, args) => {
      spawned.push(command);
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
      const out = outputs[command];
      process.nextTick(() => {
        if (out === undefined) { child.emit("error", new Error("ENOENT")); return; }
        child.stdout.emit("data", out);
        child.emit("close", 0);
      });
      return child;
    };
    return { spawnImpl, spawned };
  };
  const idle = fake({ tasklist: '"System Idle Process","0","Services","0","8 K"\r\n"node.exe","400","Console","1","90,112 K"\r\n' });
  assert.deepEqual(await processSnapshot({ platform: "win32", spawnImpl: idle.spawnImpl }), []);
  assert.deepEqual(idle.spawned, ["tasklist"], "no PowerShell when nothing LÖVE is running");
  const running = fake({
    tasklist: '"lovec.exe","311","Console","1","4,096 K"\r\n',
    powershell: JSON.stringify({ ProcessId: 311, ParentProcessId: 1, Name: "lovec.exe", CommandLine: "lovec --smoke", CreationDate: "2026-09-23T10:00:00Z", KernelModeTime: 10000, UserModeTime: 20000, WorkingSetSize: 4194304 }),
  });
  const rows = await processSnapshot({ platform: "win32", spawnImpl: running.spawnImpl });
  assert.deepEqual(running.spawned, ["tasklist", "powershell"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pid, 311);
  assert.equal(rows[0].cpuMs, 3);
  const unknown = fake({ powershell: "[]" });
  assert.deepEqual(await processSnapshot({ platform: "win32", spawnImpl: unknown.spawnImpl }), []);
  assert.deepEqual(unknown.spawned, ["tasklist", "powershell"], "a tasklist that cannot answer falls back to the CIM query");
});
