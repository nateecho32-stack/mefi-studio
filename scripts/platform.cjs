// Every child process Studio starts goes through this spawn. On Windows the
// calls reach node:child_process untouched: a shell command runs through
// cmd.exe, a CLI is located with where.exe and a process tree is removed with
// taskkill. Those three are the only host-specific spawns in the app, so on
// Linux and macOS this wrapper translates exactly those and passes everything
// else (grok, agy, gh, electron, LÖVE) straight through. The call sites keep
// their Windows shape, which is also what the executor fixtures assert.
const child_process = require("node:child_process");
const { EventEmitter } = require("node:events");

const SHELL = "cmd.exe";
const LOCATE = "where.exe";
const KILL = "taskkill";

function isShellCall(command, args) {
  return command === SHELL && Array.isArray(args) && args[0] === "/d" && args[1] === "/s" && args[2] === "/c" && typeof args[3] === "string";
}

function isLocateCall(command, args) {
  return command === LOCATE && Array.isArray(args) && args.length === 1 && typeof args[0] === "string";
}

function isKillCall(command, args) {
  return command === KILL && Array.isArray(args) && args[0] === "/pid" && /^\d+$/.test(String(args[1] ?? ""));
}

// A child that fails before it starts, the way a missing tool would: the
// error event fires on the next tick so listeners attached after spawn see it.
function failedChild(message, code) {
  const child = Object.assign(new EventEmitter(), { pid: null, killed: false, kill() { this.killed = true; } });
  process.nextTick(() => child.emit("error", Object.assign(new Error(message), { code })));
  return child;
}

// taskkill's contract as the app relies on it: close 0 when the whole tree is
// gone, a non-zero close when it could not be removed. A tree that is already
// gone counts as removed — that is the state the caller wants.
function killTreeChild(pid, kill) {
  const child = Object.assign(new EventEmitter(), { pid: null, killed: false, kill() { this.killed = true; } });
  process.nextTick(() => {
    let code = 0;
    try {
      // A shell spawned by this module is detached, so its pid names a process
      // group and the negative pid removes the group (the CLI and its children).
      kill(-pid, "SIGKILL");
    } catch (groupError) {
      if (groupError?.code !== "ESRCH") {
        try {
          kill(pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") code = 1;
        }
      }
    }
    child.emit("close", code);
  });
  return child;
}

function createSpawn({ platform = process.platform, spawnImpl = child_process.spawn, kill = process.kill.bind(process) } = {}) {
  if (platform === "win32") return spawnImpl;
  return function spawn(command, args, options) {
    if (isShellCall(command, args)) {
      // `start "title" cmd /k <cli>` opens a console window; there is no host
      // window to open one in, so the caller gets the same failure a missing
      // tool would raise and logs it.
      if (args[3] === "start") return failedChild("opening a terminal window is only supported on Windows", "ENOTSUP");
      return spawnImpl("/bin/sh", ["-c", args[3]], { ...(options ?? {}), detached: true });
    }
    if (isLocateCall(command, args)) return spawnImpl("which", [args[0]], options);
    if (isKillCall(command, args)) return killTreeChild(Number(args[1]), kill);
    return spawnImpl(command, args, options);
  };
}

module.exports = { spawn: createSpawn(), createSpawn, IS_WINDOWS: process.platform === "win32" };
