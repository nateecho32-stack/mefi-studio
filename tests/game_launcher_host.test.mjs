import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import windowsCommandLine from "../scripts/windows-command-line.cjs";

// The real runCmd / runGameScript from main.cjs, launched through a real
// cmd.exe against a checkout shaped like the default one: a folder with a space
// in its name holding scripts whose names carry spaces and parentheses. Both
// launchers used to fail here with '\"...\Run Game (LOVE2D).cmd\"' is not
// recognized, because the hand-quoted path was re-escaped by Node.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}

function launcher(gameRoot) {
  const launched = [];
  const context = vm.createContext({
    path, existsSync, spawn, GAME_ROOT: gameRoot,
    buildWindowsCmdArgs: windowsCommandLine.buildWindowsCmdArgs,
    // streamChild pipes a launch into the studio log; here it hands the child
    // to the test, which waits for it to finish.
    streamChild: (child, label) => {
      let output = "";
      child.stdout?.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      child.stderr?.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
      launched.push({ label, done: new Promise((resolve) => child.on("close", (code) => resolve({ code, output: output.trim() }))) });
    },
  });
  vm.runInContext(section("function runCmd(", "async function runSpeedProbe("), context);
  return { context, launched };
}

const windowsOnly = { skip: process.platform !== "win32" ? "the launchers are Windows .cmd scripts" : false };

test("both game launchers start from a checkout whose path has spaces", windowsOnly, async () => {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-game-"));
  try {
    const gameRoot = path.join(base, "2d Trippy Hell");
    mkdirSync(gameRoot);
    for (const name of ["Run Game (LOVE2D).cmd", "Run Dev Tool (LOVE2D).cmd"]) {
      writeFileSync(path.join(gameRoot, name), "@echo off\r\necho RAN %~nx0 [%*]\r\n");
    }
    const { context, launched } = launcher(gameRoot);

    assert.deepEqual({ ...context.runGameScript("game", "Run Game (LOVE2D).cmd") }, { ok: true });
    assert.deepEqual({ ...context.runGameScript("smoke", "Run Dev Tool (LOVE2D).cmd", ["--smoke"]) }, { ok: true });

    const [game, smoke] = await Promise.all(launched.map((entry) => entry.done));
    assert.deepEqual(game, { code: 0, output: "RAN Run Game (LOVE2D).cmd []" });
    assert.deepEqual(smoke, { code: 0, output: "RAN Run Dev Tool (LOVE2D).cmd [--smoke]" }, "the flag arrives as its own argument");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a checkout path cmd cannot carry is refused, not launched", () => {
  // `%` would expand inside cmd's view of an executable path, so the command
  // token is refused outright; the IPC caller gets an error to show, not a
  // throw and not a mangled launch.
  const { context, launched } = launcher("C:\\fixture\\100%OS% Hell");
  const result = context.runCmd("game", "C:\\fixture\\100%OS% Hell\\Run Game (LOVE2D).cmd");
  assert.equal(result.ok, false);
  assert.match(result.error, /^cannot launch Run Game \(LOVE2D\)\.cmd: Executable path must not contain/);
  assert.equal(launched.length, 0);
});

test("no checkout configured, or a missing script, is reported before any spawn", () => {
  const unset = launcher(undefined);
  assert.match(unset.context.runGameScript("game", "Run Game (LOVE2D).cmd").error, /Set MEFI_STUDIO_GAME_ROOT/);
  const empty = launcher(path.join(tmpdir(), "mefi-no-such-checkout"));
  assert.match(empty.context.runGameScript("game", "Run Game (LOVE2D).cmd").error, /^game launcher missing at /);
  assert.equal(unset.launched.length + empty.launched.length, 0);
});
