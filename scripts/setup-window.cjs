"use strict";

// The setup windows Studio opens when the owner asks: Set up this PC's steps
// (scripts/pc-setup.cjs, Sign in to GitHub among them) and a coding CLI's
// install and sign-in (scripts/cli-setup.cjs). Each is a visible PowerShell
// console running one of Studio's fixed scripts, sent -EncodedCommand.
//
// The window opens through cmd's `start`, which gives PowerShell a console of
// its own and that console as its input and output. Until 2026-10-06 both
// modules spawned PowerShell directly with stdio "ignore": from Studio, which
// has no console, that also opened a window, but PowerShell's input and output
// were NUL. The window stayed blank, Read-Host returned at once, and gh, with
// no terminal to talk to, neither showed its one-time code nor opened the
// browser, so Sign in to GitHub could never finish (and a CLI's sign-in fared
// no better). `/wait` keeps cmd running until the window closes, so the
// caller still hears `close`; cmd itself is detached and opens no window of
// its own. The arguments go to cmd verbatim: the title is quoted here and
// checked to be plain words, and the encoded script is base64, which holds
// none of cmd's special characters. scripts/platform.cjs knows this
// `cmd.exe /d /s /c start` shape and refuses it off Windows.
// Guarded by tests/setup_window.test.mjs, which also opens a real window.

const DEFAULT_TITLE = "Mefi Studio setup";
const PLAIN_TITLE = /^[A-Za-z0-9][A-Za-z0-9 .:+-]{0,79}$/;

function setupWindowCall(script, { title = DEFAULT_TITLE, cwd, env } = {}) {
  if (!PLAIN_TITLE.test(String(title))) throw new Error("A setup window's title must be plain words.");
  const encoded = Buffer.from(String(script ?? ""), "utf16le").toString("base64");
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "start", `"${title}"`, "/wait", "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    options: { cwd, env, windowsHide: false, detached: true, stdio: "ignore", windowsVerbatimArguments: true },
  };
}

// The child once Windows has started it; the caller listens for `close`. A
// launch that fails rejects with the spawn error.
async function openSetupWindow(spawn, script, options = {}) {
  const call = setupWindowCall(script, options);
  const child = spawn(call.command, call.args, call.options);
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  return child;
}

module.exports = { DEFAULT_TITLE, setupWindowCall, openSetupWindow };
