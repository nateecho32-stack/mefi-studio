// `Run Mefi's Studio AI+.cmd` really runs on a source checkout. cmd.exe
// parses a parenthesized block whole before running any of it, so the
// unescaped ")" in the setup hint's "(needs Node 24 and npm)" closed its
// block early and every checkout without the portable build aborted with
// ": was unexpected at this time." (exit 255), Electron installed or not.
// Each case runs a scratch copy of the launcher's own bytes with `start`
// stubbed to `echo`, so the would-be launch prints instead of opening a
// window. The copy also runs with LF endings (a GitHub source zip has no
// autocrlf), because goto label lookup is the part LF files can break.
// Run: node --test tests/launcher_cmd.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = "Run Mefi's Studio AI+.cmd";
const windowsOnly = { skip: process.platform !== "win32" && "cmd.exe launcher" };

function stubbedLauncher() {
  const source = readFileSync(path.join(studio, LAUNCHER), "latin1");
  const stubbed = source.replace(/^([ \t]*)start /gm, "$1echo start ");
  assert.notEqual(stubbed, source, "the launcher no longer launches with `start`; update this stub");
  return stubbed;
}

const ENDINGS = {
  "as checked out": (text) => text,
  "LF endings": (text) => text.replace(/\r\n/g, "\n"),
};

// A root with spaces and parentheses, like "Program Files (x86)", so %ROOT%
// in the echoed hints and launch lines is exercised too.
function scratchRoot(t, ending, files = []) {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "mefi launcher (x86) ")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, LAUNCHER), ENDINGS[ending](stubbedLauncher()), "latin1");
  for (const file of files) {
    const [parts, content] = Array.isArray(file) ? [file, ""] : [file.path, file.content];
    const full = path.join(root, ...parts);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const DEV_EXE = ["node_modules", "electron", "dist", "electron.exe"];
// Electron 44's installer stand-ins: one fetches the binary, one fails.
const INSTALL_JS = ["node_modules", "electron", "install.js"];
const fetchingInstaller = {
  path: INSTALL_JS,
  content: 'const fs = require("fs"), path = require("path");\n'
    + 'fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });\n'
    + 'fs.writeFileSync(path.join(__dirname, "dist", "electron.exe"), "");\n',
};
const failingInstaller = { path: INSTALL_JS, content: 'console.error("offline"); process.exit(1);\n' };
const PACKAGED_EXE = ["dist", "Mefi Studio AI+", "Mefi Studio AI+.exe"];

// cmd /s /c strips the outer quotes and runs the rest as typed, the way a
// double-click or a terminal would. `pause` gets a key from stdin.
function runLauncher(root, args = "") {
  const command = `""${path.join(root, LAUNCHER)}"${args ? ` ${args}` : ""}"`;
  const run = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
    cwd: tmpdir(),
    encoding: "utf8",
    input: "\r\n",
    timeout: 30000,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  assert.ifError(run.error);
  const output = `${run.stdout}${run.stderr}`;
  assert.doesNotMatch(output, /was unexpected at this time/, output);
  return { status: run.status, stdout: run.stdout, output };
}

for (const ending of Object.keys(ENDINGS)) {
  test(`without Electron the launcher prints the setup steps and exits 1 (${ending})`, windowsOnly, (t) => {
    const root = scratchRoot(t, ending);
    const run = runLauncher(root);
    assert.equal(run.status, 1, run.output);
    assert.match(run.stdout, /Mefi's Studio AI\+ is not installed yet\./);
    assert.ok(run.stdout.includes("Run once from a terminal (needs Node 24 and npm):"), run.stdout);
    assert.ok(run.stdout.includes(`cd /d "${root}"`), run.stdout);
    assert.match(run.stdout, /^ +npm ci\r?$/m);
    assert.match(run.stdout, /^ +npm run build-booklet\r?$/m);
    assert.doesNotMatch(run.stdout, /^start /m, "nothing launches");
  });

  test(`with Electron installed it starts the source checkout (${ending})`, windowsOnly, (t) => {
    const root = scratchRoot(t, ending, [DEV_EXE]);
    const launch = `start "Mefi's Studio AI+" "${path.join(root, ...DEV_EXE)}" .`;
    for (const args of ["", "--flag=a)b"]) {
      const run = runLauncher(root, args);
      assert.equal(run.status, 0, run.output);
      assert.ok(run.stdout.includes(args ? `${launch} ${args}` : launch), run.stdout);
      assert.doesNotMatch(run.stdout, /not installed/);
    }
  });

  // Electron 44 left npm ci without a binary, so the launcher fetches it once
  // instead of repeating "run npm ci" after the user already did.
  test(`with the Electron package but no binary it fetches the binary, then starts (${ending})`, windowsOnly, (t) => {
    const root = scratchRoot(t, ending, [fetchingInstaller]);
    const run = runLauncher(root);
    assert.equal(run.status, 0, run.output);
    assert.match(run.stdout, /Downloading Electron once/);
    assert.ok(run.stdout.includes(`start "Mefi's Studio AI+" "${path.join(root, ...DEV_EXE)}" .`), run.stdout);
  });

  test(`a failed Electron fetch falls back to the setup steps (${ending})`, windowsOnly, (t) => {
    const root = scratchRoot(t, ending, [failingInstaller]);
    const run = runLauncher(root);
    assert.equal(run.status, 1, run.output);
    assert.match(run.stdout, /Mefi's Studio AI\+ is not installed yet\./);
    assert.doesNotMatch(run.stdout, /^start /m, "nothing launches");
  });

  // The portable build's arguments arrive through %*, which is expanded
  // before a block is parsed: a ")" in one used to end the block the same way.
  test(`the portable build wins and passes its arguments through (${ending})`, windowsOnly, (t) => {
    const root = scratchRoot(t, ending, [DEV_EXE, PACKAGED_EXE]);
    const run = runLauncher(root, "--flag=a)b");
    assert.equal(run.status, 0, run.output);
    assert.ok(run.stdout.includes(`start "" "${path.join(root, ...PACKAGED_EXE)}" --flag=a)b`), run.stdout);
    assert.doesNotMatch(run.stdout, /Mefi's Studio AI\+" "/, "the source checkout is not started too");
  });
}
