// The updater's bridge from Electron builds to Rust-host builds
// (docs/rust-migration.md, stage 1). The helper that installs a build is
// written by the build being replaced, so an Electron install must already
// know how to take a host build: pick its zip, check it carries node.exe,
// stop the host program and its engine before copying, start the new build
// with none of the old engine's host variables, drop the Chromium runtime the
// host does not use, and put all of it back when the host build never reports
// healthy. The rehearsals run the real PowerShell helper against scratch
// folders with .cmd stand-ins for the programs (Windows only).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELECTRON_RUNTIME,
  appExecutable,
  buildApplyScript,
  buildRollbackScript,
  checkForRelease,
  describeRelease,
  releaseAssetName,
  runningHost,
  runtimeLeftovers,
  selectAsset,
  stageUpdate,
  writeApplyScript,
  writeRollbackScript,
  zipDirectory,
} from "../scripts/release-updater.mjs";
import safety from "../scripts/update-safety.cjs";

const IS_WINDOWS = process.platform === "win32";
const NODE = process.execPath;
const APP = "Mefi Studio AI+";
const REPO = "owner/repo";

async function exists(file) {
  return stat(file).then(() => true, () => false);
}

async function read(file) {
  return (await readFile(file, "utf8")).replace(/^\uFEFF/, "").trim();
}

async function lay(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

function release(tag, hosts) {
  const assets = [];
  for (const host of hosts) {
    const name = releaseAssetName(tag, { host });
    assets.push({ id: assets.length + 1, name, size: 2048, url: `https://api.github.com/repos/${REPO}/releases/assets/${assets.length + 1}`, digest: `sha256:${"a".repeat(64)}` });
    assets.push({ id: assets.length + 1, name: `${name}.sha256`, size: 90, url: `https://api.github.com/repos/${REPO}/releases/assets/${assets.length + 1}` });
  }
  return { tag_name: tag, name: tag, published_at: "2026-10-01T00:00:00Z", prerelease: false, assets };
}

test("each host has its own zip name, and a copy prefers its own host but takes the other", async () => {
  assert.equal(releaseAssetName("v0.5.0"), "Mefi-Studio-AI+-v0.5.0-win32-x64.zip", "the Electron name is the one every installed copy looks for");
  assert.equal(releaseAssetName("v0.5.0", { host: "tauri" }), "Mefi-Studio-AI+-v0.5.0-win32-x64-tauri.zip");
  assert.equal(releaseAssetName("v0.5.0", { host: "nonsense" }), releaseAssetName("v0.5.0"));

  assert.equal(runningHost({}, { electron: "44.4.1" }), "electron");
  assert.equal(runningHost({ MEFI_STUDIO_HOST: "tauri" }, { node: "24.15.0" }), "tauri", "main.cjs under the Rust host runs on plain Node with this mark");
  assert.equal(runningHost({ MEFI_STUDIO_HOST: "tauri" }, { electron: "44.4.1" }), "electron", "Electron is Electron whatever the environment says");
  assert.equal(runningHost({}, { node: "24.15.0" }), "electron");

  const both = release("v0.5.0", ["electron", "tauri"]);
  assert.equal(selectAsset(both, { host: "electron" }).asset.name, releaseAssetName("v0.5.0"));
  assert.equal(selectAsset(both, { host: "tauri" }).asset.name, releaseAssetName("v0.5.0", { host: "tauri" }));
  assert.equal(selectAsset(both, { host: "tauri" }).checksum.name, `${releaseAssetName("v0.5.0", { host: "tauri" })}.sha256`);
  const hostOnly = release("v0.5.0", ["tauri"]);
  assert.deepEqual({ name: selectAsset(hostOnly, { host: "electron" }).asset.name, host: selectAsset(hostOnly, { host: "electron" }).host }, { name: releaseAssetName("v0.5.0", { host: "tauri" }), host: "tauri" }, "an Electron install moves to a host-only release");
  assert.equal(selectAsset(release("v0.5.0", ["electron"]), { host: "tauri" }).host, "electron", "a host install can still take an Electron release");
  assert.equal(describeRelease(hostOnly, { host: "electron" }).asset.host, "tauri");

  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => hostOnly });
  const checked = await checkForRelease({ repo: REPO, currentVersion: "0.4.6", fetchImpl, host: "electron" });
  assert.equal(checked.ok, true, checked.error);
  assert.equal(checked.update.asset.name, releaseAssetName("v0.5.0", { host: "tauri" }));
});

// A host build's zip as package-release.mjs writes it, staged by an install.
async function hostZip(root, { node = true, version = "0.5.0" } = {}) {
  const content = path.join(root, "content");
  await lay(content, {
    [`${APP}.exe`]: "the Rust host program",
    ...(node ? { "node.exe": "node" } : {}),
    "resources/app/main.cjs": 'const p = path.join(STUDIO_ROOT, "data", "boot-health.json");',
    "resources/app/preload.cjs": "// preload",
    "resources/app/renderer/booklet.html": "<html></html>",
    "resources/app/package.json": JSON.stringify({ name: "mefi-studio", productName: "Mefi's Studio AI+", version, main: "main.cjs" }),
  });
  const zipPath = path.join(root, releaseAssetName(version, { host: "tauri" }));
  await zipDirectory(content, zipPath, { rootName: APP });
  await rm(content, { recursive: true, force: true });
  return zipPath;
}

test("an install stages a host build only when it carries node.exe, and only into an install folder", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-host-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const install = path.join(root, "install", APP);
  await lay(install, { [`${APP}.exe`]: "electron", "icudtl.dat": "icu", "resources/app/main.cjs": "installed" });

  const staged = await stageUpdate({ zipPath: await hostZip(path.join(root, "good")), stagingDir: path.join(root, "staging"), installRoot: install, expectedVersion: "0.5.0" });
  assert.equal(staged.host, "tauri");
  assert.equal(staged.exePath, path.join(install, `${APP}.exe`), "the program to start is the host program, under the name the Electron build used");

  await assert.rejects(stageUpdate({ zipPath: await hostZip(path.join(root, "bare"), { node: false }), stagingDir: path.join(root, "staging-bare"), installRoot: install, expectedVersion: "0.5.0" }), /carries no runtime: neither Electron's files nor node\.exe/);
  // Under the Rust host the install folder is node.exe's folder: a Node kept
  // anywhere else must never receive a copy of Studio.
  const nodeFolder = path.join(root, "nodejs");
  await mkdir(nodeFolder, { recursive: true });
  await assert.rejects(stageUpdate({ zipPath: await hostZip(path.join(root, "elsewhere")), stagingDir: path.join(root, "staging-elsewhere"), installRoot: nodeFolder, expectedVersion: "0.5.0" }), /does not hold Studio \(resources\/app\/main\.cjs\)/);
});

test("the helper names the host program, never node.exe, and clears the old engine's host variables", async (t) => {
  const install = "C:\\Users\\O'Brien\\Portable\\Mefi Studio AI+";
  assert.equal(appExecutable(`${install}\\node.exe`, install), `${install}\\Mefi Studio AI+.exe`, "under the Rust host process.execPath is node.exe");
  assert.equal(appExecutable(`${install}\\NODE.EXE`, install), `${install}\\Mefi Studio AI+.exe`);
  assert.equal(appExecutable(`${install}\\Mefi Studio AI+.exe`, install), `${install}\\Mefi Studio AI+.exe`);
  assert.equal(appExecutable("C:\\x\\run.cmd", install), "C:\\x\\run.cmd");

  const rollback = buildRollbackScript({ installRoot: install, exePath: `${install}\\node.exe`, pid: 9, restoreVersion: "0.4.6", replacedVersion: "0.5.0", safety: { backupRoot: "C:\\L\\rollback\\ab", resultPath: "C:\\D\\update-result.json" } });
  assert.ok(rollback.includes("$exe = 'C:\\Users\\O''Brien\\Portable\\Mefi Studio AI+\\Mefi Studio AI+.exe'"), "Roll back from a host build starts the restored program, not Node");
  const apply = buildApplyScript({ sourceRoot: "C:\\S", installRoot: install, exePath: `${install}\\Mefi Studio AI+.exe`, pid: 7, version: "0.5.0", prune: ["icudtl.dat", "locales", "resources/default_app.asar", "..\\escape"] });
  for (const script of [apply, rollback]) {
    assert.match(script, /'MEFI_STUDIO_HOST', 'MEFI_HOST_PIPE', 'MEFI_HOST_TOKEN', 'MEFI_HOST_INFO', 'MEFI_STUDIO_ROOT', 'ELECTRON_RUN_AS_NODE'.*SetEnvironmentVariable\(\$name, \$null, 'Process'\)/);
    assert.match(script, /\$engineExe = Join-Path \$target 'node\.exe'/);
    assert.match(script, /Get-Process -Name \$names/, "it waits for the program and node.exe started from the install");
    assert.ok(script.indexOf("Wait-Process") < script.indexOf("InstallProcs }"), "after the pid it was handed");
  }
  assert.ok(apply.indexOf("catalog robocopy exit") < apply.indexOf("Join-Path $target 'icudtl.dat'"), "the Chromium runtime goes only after the new build is copied");
  assert.match(apply, /Remove-Item -LiteralPath \(Join-Path \$target 'resources\\default_app\.asar'\) -Recurse -Force/);
  assert.ok(!apply.includes("escape"), "a name that climbs out of the install is never removed");
  assert.ok(!buildApplyScript({ sourceRoot: "C:\\S", installRoot: install, exePath: "x", pid: 1 }).includes("Electron runtime"), "nothing is removed unless named");

  // writeApplyScript works the list out from the folders themselves.
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-host-prune-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const electron = path.join(root, "install");
  const host = path.join(root, "staged");
  await lay(electron, { "icudtl.dat": "", "resources.pak": "", "LICENSE": "", "locales/en-US.pak": "", "resources/app/main.cjs": "" });
  await lay(host, { "node.exe": "", "LICENSE": "a license the host build ships itself", "resources/app/main.cjs": "" });
  assert.deepEqual(await runtimeLeftovers(host, electron), ["icudtl.dat", "locales", "resources.pak"]);
  assert.deepEqual(await runtimeLeftovers(electron, host), [], "an Electron build never removes anything");
  const script = path.join(root, "apply.ps1");
  await writeApplyScript(script, { sourceRoot: host, installRoot: electron, exePath: path.join(electron, `${APP}.exe`), pid: 1, version: "0.5.0" });
  assert.match(await readFile(script, "utf8"), /Join-Path \$target 'locales'/);
  assert.ok(ELECTRON_RUNTIME.includes("v8_context_snapshot.bin"));
});

const ELECTRON_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "electron", "dist");

test("every file of the Electron runtime the packager copies is one the bridge knows", { skip: !IS_WINDOWS && "Electron's Windows runtime" }, async (t) => {
  if (!(await exists(ELECTRON_DIST))) return t.skip("no Electron runtime in this checkout");
  const shipped = (await readdir(ELECTRON_DIST)).filter((name) => !["electron.exe", "debug.log", "resources"].includes(name));
  for (const name of shipped) assert.ok(ELECTRON_RUNTIME.includes(name), `${name} would be left behind in a host install`);
});

// ---- rehearsals --------------------------------------------------------------

// The stand-in program logs its arguments and what it sees of the host link.
function runCmd(version, mode) {
  const log = '"%~dp0resources\\app\\data\\launch-log.txt"';
  const health = '"%~dp0resources\\app\\data\\boot-health.json"';
  return [
    "@echo off",
    `echo [%*] host=[%MEFI_STUDIO_HOST%%MEFI_STUDIO_ROOT%] >> ${log}`,
    ...(mode === "good" ? [`"${NODE}" "%~dp0resources\\app\\report.cjs" ${health} ${version}`, "exit /b 0"] : []),
    ...(mode === "crash" ? ["exit /b 1"] : []),
  ].join("\r\n") + "\r\n";
}

const REPORT = [
  "const [healthPath, version] = process.argv.slice(2);",
  "const now = Date.now();",
  'require("node:fs").writeFileSync(healthPath, JSON.stringify({ v: 1, version, pid: process.pid, startedAt: now, healthyAt: now, via: "test" }));',
  "",
].join("\n");

const CHROMIUM = { "icudtl.dat": "icu", "resources.pak": "pak", "v8_context_snapshot.bin": "v8", "LICENSE": "electron license", "ffmpeg.dll": "ffmpeg", "locales/en-US.pak": "en-US" };

// An installed Electron 1.0.0 and a staged host build 2.0.0.
async function world(t, mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-host-bridge-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const install = path.join(root, "Portable Zoë", APP);
  const staged = path.join(root, "staging", APP);
  await lay(install, {
    "run.cmd": runCmd("1.0.0", "good"),
    ...CHROMIUM,
    "resources/app/version.txt": "1.0.0",
    "resources/app/report.cjs": REPORT,
    "resources/app/data/state.txt": "the owner's live state",
  });
  await lay(staged, {
    "run.cmd": runCmd("2.0.0", mode),
    "node.exe": "the host build's node",
    "resources/app/version.txt": "2.0.0",
    "resources/app/report.cjs": REPORT,
  });
  const data = path.join(install, "resources", "app", "data");
  return {
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
}

function goneProcess() {
  return Number(spawnSync(NODE, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
}

// The old engine's environment: what main.cjs under the Rust host hands its helper.
function runHelper(scriptPath) {
  const env = { ...process.env, MEFI_STUDIO_HOST: "tauri", MEFI_HOST_PIPE: "\\\\.\\pipe\\gone", MEFI_STUDIO_ROOT: "C:\\elsewhere", ELECTRON_RUN_AS_NODE: "1" };
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { encoding: "utf8", timeout: 150000, windowsHide: true, env });
  assert.equal(result.status, 0, `the helper ran to the end\n${result.stderr}`);
}

async function apply(w, safetyOptions = {}) {
  const script = path.join(w.root, "apply-update.ps1");
  await writeApplyScript(script, {
    sourceRoot: w.staged,
    installRoot: w.install,
    exePath: w.exe,
    pid: goneProcess(),
    version: "2.0.0",
    cleanupRoot: path.join(w.root, "cleanup"),
    logPath: w.log,
    safety: { backupRoot: w.backupRoot, from: "1.0.0", resultPath: w.resultPath, healthPath: w.healthPath, watch: true, waitSeconds: 6, exitGraceSeconds: 2, windowStyle: "Hidden", ...safetyOptions },
  });
  runHelper(script);
}

async function launches(w) {
  for (let waited = 0; waited < 5000 && !(await exists(w.launchLog)); waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
  return (await exists(w.launchLog)) ? (await read(w.launchLog)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

test("an Electron install takes a host build: node.exe in, Chromium out, data kept, no host link inherited", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  await apply(w);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "2.0.0");
  assert.equal(await read(path.join(w.install, "node.exe")), "the host build's node");
  for (const name of Object.keys(CHROMIUM)) assert.equal(await exists(path.join(w.install, name)), false, `${name} is gone from the install`);
  assert.equal(await exists(path.join(w.install, "locales")), false);
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state");
  assert.deepEqual(await launches(w), ["[--released 2.0.0] host=[]"], "started once, and MEFI_STUDIO_HOST from the old engine did not follow it");
  assert.equal(await exists(w.resultPath), false);
  assert.equal(safety.healthVerdict(await read(w.healthPath), { version: "2.0.0", launchedAt: 0 }), "healthy");
  // The saved copy is the whole Electron build, so Roll back can bring it back.
  assert.equal(await read(path.join(w.backupRoot, "install", "icudtl.dat")), "icu");
  assert.equal(await read(path.join(w.backupRoot, "install", "locales", "en-US.pak")), "en-US");
  assert.equal(await exists(path.join(w.backupRoot, "install", "node.exe")), false);
});

test("a host build that never reports healthy gives the Electron build back whole", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "crash");
  await apply(w);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0");
  for (const [name, content] of Object.entries(CHROMIUM)) assert.equal(await read(path.join(w.install, name)), content, `${name} is restored`);
  assert.equal(await exists(path.join(w.install, "node.exe")), false, "the host build's node.exe goes with it");
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state");
  assert.deepEqual(await launches(w), ["[--released 2.0.0] host=[]", "[--released 2.0.0] host=[]", "[--rolled-back 1.0.0] host=[]"], "an Electron build restarted from a host engine would load the host shim and stop");
  const result = safety.parseResult(await read(w.resultPath));
  assert.deepEqual({ rolledBack: result.rolledBack, stage: result.stage, from: result.from, to: result.to }, { rolledBack: true, stage: "boot", from: "1.0.0", to: "2.0.0" });
});

test("the helper waits for an engine still running from the install's node.exe before replacing it", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  // A host install: the engine is the install's own node.exe, still running.
  await copyFile(NODE, path.join(w.install, "node.exe"));
  const engine = spawn(path.join(w.install, "node.exe"), ["-e", "setTimeout(() => {}, 3000)"], { stdio: "ignore", windowsHide: true });
  t.after(() => { try { engine.kill(); } catch {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const script = path.join(w.root, "apply-plain.ps1");
  await writeApplyScript(script, { sourceRoot: w.staged, installRoot: w.install, exePath: w.exe, pid: goneProcess(), version: "2.0.0", logPath: w.log, safety: { windowStyle: "Hidden" } });
  runHelper(script);
  const log = await read(w.log);
  assert.match(log, /waiting for 1 process\(es\) still running from the install folder/);
  assert.match(log, /robocopy exit [0-7]\b/, `the copy went through once the engine had gone\n${log}`);
  assert.equal(await read(path.join(w.install, "node.exe")), "the host build's node");
  assert.equal(engine.exitCode ?? (await new Promise((resolve) => engine.once("exit", resolve))), 0, "the engine ended on its own; the helper never stops it");
});

test("Roll back from a host build restores the Electron build and starts it clean", { skip: !IS_WINDOWS }, async (t) => {
  const w = await world(t, "good");
  await apply(w);
  const manifest = safety.usableBackup(await read(path.join(w.backupRoot, "manifest.json")), { installRoot: w.install, version: "2.0.0" });
  assert.equal(manifest?.from, "1.0.0");
  const script = path.join(w.root, "rollback.ps1");
  await writeRollbackScript(script, { installRoot: w.install, exePath: w.exe, pid: goneProcess(), restoreVersion: "1.0.0", replacedVersion: "2.0.0", logPath: w.log, safety: { backupRoot: w.backupRoot, resultPath: w.resultPath, windowStyle: "Hidden" } });
  runHelper(script);
  assert.equal(await read(path.join(w.install, "resources", "app", "version.txt")), "1.0.0");
  assert.equal(await read(path.join(w.install, "icudtl.dat")), "icu");
  assert.equal(await exists(path.join(w.install, "node.exe")), false);
  assert.equal(await read(path.join(w.data, "state.txt")), "the owner's live state");
  assert.equal((await launches(w)).at(-1), "[--rolled-back 1.0.0] host=[]");
  assert.equal(safety.parseResult(await read(w.resultPath)).stage, "manual");
});
