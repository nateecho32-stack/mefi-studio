import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildApplyScript, writeApplyScript, writeRollbackScript } from "../scripts/release-updater.mjs";
import safety from "../scripts/update-safety.cjs";

// A rehearsal of the in-app update against a scratch portable folder. The
// helper is the real PowerShell script main.cjs hands to Windows; the "app" it
// starts is a .cmd stand-in that either raises the health flag or does not.
// Until now only the script's text was pinned, so the first live update was the
// first time anything ran it. Windows only: the helper is PowerShell + robocopy.
const IS_WINDOWS = process.platform === "win32";
const NODE = process.execPath;

async function exists(file) {
  return stat(file).then(() => true, () => false);
}

async function read(file) {
  return (await readFile(file, "utf8")).replace(/^﻿/, "").trim();
}

// The stand-in app. `mode` is what version 2.0.0 does when started.
function runCmd(version, mode) {
  const log = '"%~dp0resources\\app\\data\\launch-log.txt"';
  const health = '"%~dp0resources\\app\\data\\boot-health.json"';
  return [
    "@echo off",
    `echo [%*] >> ${log}`,
    ...(mode === "good" ? [`"${NODE}" "%~dp0resources\\app\\report.cjs" ${health} ${version}`, "exit /b 0"] : []),
    ...(mode === "crash" ? ["exit /b 1"] : []),
    ...(mode === "hang" ? ["ping -n 40 127.0.0.1 >nul", "exit /b 0"] : []),
  ].join("\r\n") + "\r\n";
}

const REPORT = [
  "const [healthPath, version] = process.argv.slice(2);",
  "const now = Date.now();",
  'require("node:fs").writeFileSync(healthPath, JSON.stringify({ v: 1, version, pid: process.pid, startedAt: now, healthyAt: now, via: "test" }));',
  "",
].join("\n");

async function lay(root, dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

// One scratch world: an installed 1.0.0 (a name with a space and a non-ASCII
// letter, because the owner's folders are like that), a staged 2.0.0, and the
// paths the helper is told about.
async function world(t, mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-rehearsal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const install = path.join(root, "Portable Zoë", "Mefi Studio AI+");
  const staged = path.join(root, "staging", "Mefi Studio AI+");
  await lay(root, install, {
    "run.cmd": runCmd("1.0.0", "good"),
    "resources/app/version.txt": "1.0.0",
    "resources/app/report.cjs": REPORT,
    "resources/app/data/state.txt": "the owner's live state",
  });
  await lay(root, staged, {
    "run.cmd": runCmd("2.0.0", mode),
    "resources/app/version.txt": "2.0.0",
    "resources/app/report.cjs": REPORT,
    "resources/app/added-by-2.txt": "only in 2.0.0",
    "resources/app/data/ignored.txt": "the release ships a data folder; it must never land",
  });
  const data = path.join(install, "resources", "app", "data");
  const paths = {
    root,
    install,
    staged,
    data,
    exe: path.join(install, "run.cmd"),
    backupRoot: path.join(root, "rollback", "abc12345"),
    resultPath: path.join(data, "update-result.json"),
    healthPath: path.join(data, "boot-health.json"),
    launchLog: path.join(data, "launch-log.txt"),
    log: path.join(root, "helper.log"),
  };
  return paths;
}

// A pid that is already gone: the helper's Wait-Process then returns at once.
function goneProcess() {
  const child = spawnSync(NODE, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(child.stdout);
}

function safetyOptions(w, extra = {}) {
  return {
    backupRoot: w.backupRoot,
    from: "1.0.0",
    resultPath: w.resultPath,
    healthPath: w.healthPath,
    watch: true,
    waitSeconds: 6,
    exitGraceSeconds: 2,
    windowStyle: "Hidden",
    ...extra,
  };
}

function runHelper(scriptPath) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { encoding: "utf8", timeout: 150000, windowsHide: true });
  assert.equal(result.status, 0, `the helper ran to the end\n${result.stderr}`);
}

async function apply(w, options = {}) {
  const script = path.join(w.root, "apply-update.ps1");
  await writeApplyScript(script, {
    sourceRoot: w.staged,
    installRoot: w.install,
    exePath: w.exe,
    pid: goneProcess(),
    version: "2.0.0",
    cleanupRoot: path.join(w.root, "cleanup"),
    logPath: w.log,
    safety: safetyOptions(w, options.safety ?? {}),
  });
  runHelper(script);
}

async function launches(w) {
  // The stand-in app may still be writing when the helper exits.
  for (let waited = 0; waited < 5000 && !(await exists(w.launchLog)); waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
  return (await exists(w.launchLog)) ? (await read(w.launchLog)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

test("a good update replaces the build, keeps the owner's data, saves the old build and reports healthy", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  await apply(w);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "2.0.0");
  assert.ok(await exists(path.join(w.install, "resources", "app", "added-by-2.txt")));
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state", "resources/app/data is never touched");
  assert.equal(await exists(path.join(w.data, "ignored.txt")), false, "the release's own data folder is not copied");
  assert.deepEqual(await launches(w), ["[--released 2.0.0]"], "started once, with the release flag");
  assert.equal(await exists(w.resultPath), false, "a good update leaves no failure record");

  const health = safety.parseHealth(await read(w.healthPath));
  assert.equal(safety.healthVerdict(health, { version: "2.0.0", launchedAt: 0 }), "healthy");

  const manifest = safety.parseManifest(await read(path.join(w.backupRoot, "manifest.json")));
  assert.deepEqual({ from: manifest.from, to: manifest.to }, { from: "1.0.0", to: "2.0.0" });
  assert.deepEqual(safety.usableBackup(manifest, { installRoot: w.install, version: "2.0.0" })?.from, "1.0.0");
  assert.equal(await read(path.join(w.backupRoot, "install", "resources", "app", "version.txt")), "1.0.0", "the old build is saved");
  assert.equal(await exists(path.join(w.backupRoot, "install", "resources", "app", "data")), false, "the owner's data is not copied into the backup");
  assert.equal(await exists(path.join(w.root, "cleanup")), false);
});

test("a build that exits at once is tried twice, then the old build comes back", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "crash");
  await apply(w);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0", "the old build is restored");
  assert.equal(await exists(path.join(w.install, "resources", "app", "added-by-2.txt")), false, "files the update added are removed");
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state", "the owner's data survives the rollback");
  assert.deepEqual(await launches(w), ["[--released 2.0.0]", "[--released 2.0.0]", "[--rolled-back 1.0.0]"]);
  const result = safety.parseResult(await read(w.resultPath));
  assert.deepEqual({ rolledBack: result.rolledBack, stage: result.stage, from: result.from, to: result.to }, { rolledBack: true, stage: "boot", from: "1.0.0", to: "2.0.0" });
  assert.match(safety.describeResult(result), /v2\.0\.0 did not start properly, so Studio went back to v1\.0\.0/);
  assert.equal(await exists(w.backupRoot), false, "the saved copy is spent once it has been restored");
});

test("a build that hangs without reporting is stopped and rolled back", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "hang");
  await apply(w, { safety: { waitSeconds: 4 } });
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0");
  assert.equal(safety.parseResult(await read(w.resultPath)).rolledBack, true);
  assert.equal((await launches(w)).at(-1), "[--rolled-back 1.0.0]");
});

test("a backup that cannot be made skips the update and starts the current build", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  // The backup folder sits under a file, so it can never be created.
  const blocker = path.join(w.root, "blocker");
  await writeFile(blocker, "not a folder");
  await apply(w, { safety: { backupRoot: path.join(blocker, "rollback") } });
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0", "nothing was replaced");
  assert.equal(await exists(path.join(w.install, "resources", "app", "added-by-2.txt")), false);
  const result = safety.parseResult(await read(w.resultPath));
  assert.deepEqual({ stage: result.stage, from: result.from, to: result.to }, { stage: "backup", from: "1.0.0", to: "2.0.0" });
  assert.match(safety.describeResult(result), /could not back up this version first, so nothing changed/);
  assert.deepEqual(await launches(w), ["[]"], "the current build starts again, with no release flag");
});

test("Roll back restores the saved build after a good update", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  await apply(w);
  const manifest = safety.usableBackup(await read(path.join(w.backupRoot, "manifest.json")), { installRoot: w.install, version: "2.0.0" });
  assert.ok(manifest, "the backup is offered while it describes this install");

  const script = path.join(w.root, "rollback.ps1");
  await writeRollbackScript(script, {
    installRoot: w.install,
    exePath: w.exe,
    pid: goneProcess(),
    restoreVersion: manifest.from,
    replacedVersion: "2.0.0",
    logPath: w.log,
    safety: { backupRoot: w.backupRoot, resultPath: w.resultPath, windowStyle: "Hidden" },
  });
  runHelper(script);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0");
  assert.equal(await exists(path.join(w.install, "resources", "app", "added-by-2.txt")), false);
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state");
  assert.equal((await launches(w)).at(-1), "[--rolled-back 1.0.0]");
  assert.equal(safety.parseResult(await read(w.resultPath)).stage, "manual");
  assert.equal(await exists(w.backupRoot), false);
});

test("without the safety option the helper is the plain swap: no backup, no waiting", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  const script = path.join(w.root, "apply-plain.ps1");
  await writeApplyScript(script, { sourceRoot: w.staged, installRoot: w.install, exePath: w.exe, pid: goneProcess(), version: "2.0.0", logPath: w.log, safety: { windowStyle: "Hidden" } });
  const text = await readFile(script, "utf8");
  assert.ok(!/backupRoot|Rollback/.test(text), "the plain helper carries none of the safety code");
  runHelper(script);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "2.0.0");
  assert.equal(await exists(w.backupRoot), false);
});

test("the helper script is written with a byte order mark so PowerShell reads non-ASCII paths", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  const script = path.join(w.root, "bom.ps1");
  await writeApplyScript(script, { sourceRoot: w.staged, installRoot: w.install, exePath: w.exe, pid: 1, version: "2.0.0" });
  const bytes = await readFile(script);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(buildApplyScript({ sourceRoot: "a", installRoot: "b", exePath: "c", pid: 1 }).startsWith("$ErrorActionPreference"), "the text itself carries no mark");
});
