// Guard tests for scripts/setup-window.cjs, the visible PowerShell window that
// Set up this PC (Sign in to GitHub among its steps) and a coding CLI's
// install and sign-in run in. The window has to be a real console: spawned
// straight from Studio with stdio "ignore", PowerShell's input and output were
// NUL, the window stayed blank and gh, with no terminal, never showed its
// one-time code or opened the browser. The last test opens a real window
// (minimized, Windows only) and asks the PowerShell in it, and a native child
// of it, whether they have a terminal.
//
// Run: npm run test:one -- tests/setup_window.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_TITLE, setupWindowCall, openSetupWindow } = require("../scripts/setup-window.cjs");

const decoded = (call) => Buffer.from(call.args.at(-1), "base64").toString("utf16le");

test("a setup window is PowerShell started by cmd's start, in a console of its own", () => {
  const env = { PATH: "C:/bin" };
  const call = setupWindowCall("Write-Host 'hello'", { title: "Mefi Studio: Sign in to GitHub", cwd: "C:/code/app", env });
  assert.equal(call.command, "cmd.exe", "the shape scripts/platform.cjs knows as a terminal window");
  assert.deepEqual(call.args.slice(0, 6), ["/d", "/s", "/c", "start", '"Mefi Studio: Sign in to GitHub"', "/wait"], "start takes the quoted title, and /wait keeps cmd until the window closes");
  assert.deepEqual(call.args.slice(6, -1), ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
  assert.equal(decoded(call), "Write-Host 'hello'", "the script rides -EncodedCommand as UTF-16LE base64");
  assert.match(call.args.at(-1), /^[A-Za-z0-9+/=]+$/, "base64 holds none of cmd's special characters");
  assert.equal(call.options.windowsHide, false, "the owner sees the window");
  assert.equal(call.options.detached, true, "cmd itself opens no console; start gives PowerShell its own");
  assert.equal(call.options.stdio, "ignore");
  assert.equal(call.options.windowsVerbatimArguments, true, "the title's quotes reach cmd as written");
  assert.equal(call.options.cwd, "C:/code/app");
  assert.equal(call.options.env, env);
  assert.equal(setupWindowCall("").args[4], `"${DEFAULT_TITLE}"`);
});

test("a title is plain words, never something cmd would read", () => {
  for (const title of ["", " leading space", 'say "hi"', "a & b", "50%", "a | b", "a ^ b", "a < b", "a > b", "two\nlines", "x".repeat(81)]) {
    assert.throws(() => setupWindowCall("", { title }), /plain words/, JSON.stringify(title));
  }
  assert.doesNotThrow(() => setupWindowCall("", { title: "Mefi Studio: Claude Code sign-in" }));
});

test("openSetupWindow hands back the child once it started, and a failed start rejects", async () => {
  const calls = [];
  const started = await openSetupWindow((command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }, "exit", { title: "Mefi Studio: Install Git" });
  assert.equal(calls.length, 1);
  assert.ok(started instanceof EventEmitter);
  assert.equal(calls[0].args[4], '"Mefi Studio: Install Git"');
  await assert.rejects(openSetupWindow(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", new Error("spawn cmd.exe ENOENT")));
    return child;
  }, "exit"), /ENOENT/);
});

test("the real window is a terminal for PowerShell and for the tools it runs", { skip: process.platform !== "win32" && "Windows only", timeout: 90_000 }, async () => {
  const box = mkdtempSync(path.join(tmpdir(), "mefi-setup-window-"));
  try {
    // What gh checks before it shows a code or opens a browser: a console on
    // all three streams. The window's PowerShell answers for itself, and a
    // second powershell.exe, a console program like gh, for the tools it runs.
    const streams = (file) => `@{ input = [Console]::IsInputRedirected; output = [Console]::IsOutputRedirected; error = [Console]::IsErrorRedirected } | ConvertTo-Json -Compress | Set-Content -LiteralPath '${path.join(box, file).replace(/'/g, "''")}'`;
    const script = [
      "$ErrorActionPreference = 'Stop'",
      streams("shell.json"),
      `& powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(streams("tool.json"), "utf16le").toString("base64")}`,
    ].join("\n");
    const call = setupWindowCall(script, { title: "Mefi Studio: setup window test", cwd: tmpdir(), env: process.env });
    // Minimized, so the test takes no focus; the console and its handles are the same.
    call.args.splice(call.args.indexOf("/wait"), 0, "/min");
    const child = spawn(call.command, call.args, call.options);
    const closed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("the window did not close within 80 s")); }, 80_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(closed, 0, "cmd waited for the window and closed with it");
    const read = (file) => JSON.parse(readFileSync(path.join(box, file), "utf8").replace(/^\uFEFF/, ""));
    const terminal = { input: false, output: false, error: false };
    assert.deepEqual(read("shell.json"), terminal, "PowerShell reads and writes the window, not NUL");
    assert.deepEqual(read("tool.json"), terminal, "a console program it runs (gh) gets the window too");
  } finally {
    rmSync(box, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
