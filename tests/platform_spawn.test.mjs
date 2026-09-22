import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import test from "node:test";
import platform from "../scripts/platform.cjs";
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
  const spawn = createSpawn({ platform: "win32", spawnImpl });
  spawn("cmd.exe", shellArgs("opencode run --auto"), { cwd: "C:/repo", windowsHide: true });
  spawn("where.exe", ["claude"], { windowsHide: true });
  spawn("taskkill", killArgs(77), { windowsHide: true, stdio: "ignore" });
  assert.deepEqual(calls.map((call) => call.command), ["cmd.exe", "where.exe", "taskkill"]);
  assert.deepEqual(calls[0].args, shellArgs("opencode run --auto"));
  assert.deepEqual(calls[0].options, { cwd: "C:/repo", windowsHide: true });
  assert.deepEqual(calls[2].args, killArgs(77));
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
  assert.equal(await once(gone("taskkill", killArgs(1)), "close"), 0);

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

test("a host without ps yields an empty snapshot instead of an error", async () => {
  const spawnImpl = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
    process.nextTick(() => child.emit("error", new Error("ENOENT")));
    return child;
  };
  assert.deepEqual(await processSnapshot({ platform: "linux", spawnImpl }), []);
});
