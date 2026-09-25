// Every child process Studio starts goes through this spawn. On Windows the
// calls reach node:child_process untouched apart from the environment rule
// below: a shell command runs through cmd.exe, a CLI is located with where.exe
// and a process tree is removed with taskkill. Those three are the only
// host-specific spawns in the app, so on Linux and macOS this wrapper
// translates exactly those and passes everything else (grok, agy, gh,
// electron, LÖVE) straight through. The call sites keep their Windows shape,
// which is also what the executor fixtures assert.
//
// The one thing no child receives is Studio's own credentials. A headless or
// container install hands Studio its keys as MEFI_STUDIO_*_KEY / _TOKEN
// variables, and nothing else sets those names (scripts/credentials.cjs); a
// child that needs a key is given it under its own name — MEFI_ZAI_API_KEY for
// the mefi-zai provider, ZAI_API_KEY for the speed probe. Yet every coding
// worker used to inherit all of them while running repository-driven commands
// with its approvals bypassed, so they are withheld from every child. Names
// another tool also reads (GH_TOKEN, OPENROUTER_API_KEY) are kept, because a
// worker may legitimately use them, and the rest of the environment passes
// through: an allowlist, which BetterC0de's childEnvironment.ts uses, would
// strip variables the builder CLIs rely on. With nothing to withhold, the
// caller's options object reaches node's spawn as it was passed.
const child_process = require("node:child_process");
const { EventEmitter } = require("node:events");

// A pattern rather than an import from credentials.cjs, which main.cjs loads
// as an optional helper: a missing credentials.cjs must not stop every spawn.
// tests/platform_spawn.test.mjs pins it to that module's list instead.
const STUDIO_CREDENTIAL = /^MEFI_STUDIO_[A-Z0-9_]*(KEY|TOKEN)$/;

// The caller's options with Studio's credentials removed from the child's
// environment: from the env it passed, or else from the one the child would
// inherit. Windows variable names are case-insensitive, so the match is too.
function withholdCredentials(options, inherited) {
  const source = options?.env ?? inherited ?? {};
  const names = Object.keys(source);
  const withheld = (name) => STUDIO_CREDENTIAL.test(name.toUpperCase());
  if (!names.some(withheld)) return options;
  const env = {};
  for (const name of names) if (!withheld(name)) env[name] = source[name];
  return { ...(options ?? {}), env };
}

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

// Enough of a ChildProcess for the call sites that never reach a real one.
// The stubs stand in for a spawn, so they carry the members the callers touch
// on the result of one: main.cjs unrefs the terminal-window child and kills
// the taskkill child on its timeout, and a missing member there would throw a
// TypeError instead of producing the failure the caller is written to handle.
// The streams are null, as they are for a `stdio: "ignore"` spawn.
function stubChild() {
  return Object.assign(new EventEmitter(), {
    pid: null,
    exitCode: null,
    signalCode: null,
    killed: false,
    connected: false,
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null],
    kill() { this.killed = true; return true; },
    unref() { return this; },
    ref() { return this; },
    disconnect() {},
  });
}

// A child that fails before it starts, the way a missing tool would: the
// error event fires on the next tick so listeners attached after spawn see it.
function failedChild(message, code) {
  const child = stubChild();
  process.nextTick(() => child.emit("error", Object.assign(new Error(message), { code })));
  return child;
}

// taskkill's contract as the app relies on it: close 0 when the whole tree is
// gone, a non-zero close when it could not be removed. A tree that is already
// gone counts as removed — that is the state the caller wants.
function killTreeChild(pid, kill) {
  const child = stubChild();
  // The signal goes out now, not on a later tick. main.cjs removes the LÖVE
  // child and every autopilot group from process.on("exit"), and Node abandons
  // the nextTick queue the moment an exit handler returns, so a deferred kill
  // would never fire there and quitting would orphan every detached tree.
  // Only the close event, which needs a listener attached after spawn returns,
  // waits for the tick.
  const code = killTree(pid, kill);
  process.nextTick(() => child.emit("close", code));
  return child;
}

// 0 when nothing of the tree is left, 1 when it could not be removed.
function killTree(pid, kill) {
  // pid 0 is "every process in my own group" and pid 1 is init: a pid that low
  // is a bad argument, never a child of ours, and signalling it would take the
  // app down with it.
  if (!Number.isInteger(pid) || pid <= 1) return 1;
  let code = 1;
  // A shell spawned by this module is detached, so its pid names a process
  // group and the negative pid removes the group (the CLI and its children).
  // A pid that leads no group — anything passed straight through — still has
  // to die, so the direct signal is the fallback.
  for (const target of [-pid, pid]) {
    try {
      kill(target, "SIGKILL");
      return 0;
    } catch (error) {
      // Nothing under that name: already gone, which is the state the caller
      // wants, though the narrower target is still worth trying. Anything else
      // (EPERM) is a real refusal to report.
      code = error?.code === "ESRCH" ? 0 : 1;
    }
  }
  return code;
}

// node's spawn also takes (command, options): an object in the args slot is
// the options, and a third argument is then ignored. This module hands node
// its filtered options in the third slot, so that shape used to give the
// child Studio's whole environment; it is read the way node reads it instead.
function callShape(args, options) {
  if (args !== null && typeof args === "object" && !Array.isArray(args)) return [[], args];
  return [args, options];
}

function createSpawn({ platform = process.platform, spawnImpl = child_process.spawn, kill = process.kill.bind(process), env = process.env } = {}) {
  if (platform === "win32") {
    return (command, args, options) => {
      [args, options] = callShape(args, options);
      return spawnImpl(command, args, withholdCredentials(options, env));
    };
  }
  return function spawn(command, args, options) {
    [args, options] = callShape(args, options);
    options = withholdCredentials(options, env);
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

module.exports = { spawn: createSpawn(), createSpawn, withholdCredentials, IS_WINDOWS: process.platform === "win32" };
