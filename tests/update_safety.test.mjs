import test from "node:test";
import assert from "node:assert/strict";
import safety from "../scripts/update-safety.cjs";
import { rollbackFolder, buildApplyScript, buildRollbackScript } from "../scripts/release-updater.mjs";

test("a boot record is stamped healthy once and the first stamp stands", () => {
  const started = safety.beginBoot({ version: "0.4.5", pid: 42, now: 1000 });
  assert.deepEqual(started, { v: 1, version: "0.4.5", pid: 42, startedAt: 1000, healthyAt: null, via: null });
  const healthy = safety.reportHealthy(started, { via: "renderer", now: 2500 });
  assert.equal(healthy.healthyAt, 2500);
  assert.equal(safety.reportHealthy(healthy, { via: "fallback", now: 60000 }), healthy, "a later report changes nothing");
  assert.equal(safety.reportHealthy(null, { now: 1 }), null);
});

test("the helper's verdict needs this launch's stamp on the expected version", () => {
  const record = { v: 1, version: "0.4.6", pid: 1, startedAt: 5000, healthyAt: 6000, via: "renderer" };
  assert.equal(safety.healthVerdict(record, { version: "0.4.6", launchedAt: 4000 }), "healthy");
  assert.equal(safety.healthVerdict(record, { version: "0.4.6", launchedAt: 7000 }), "absent", "a stamp from before this launch is not evidence");
  assert.equal(safety.healthVerdict(record, { version: "0.4.5", launchedAt: 4000 }), "absent", "another version's record is not evidence");
  assert.equal(safety.healthVerdict({ ...record, healthyAt: null }, { version: "0.4.6", launchedAt: 4000 }), "starting");
  assert.equal(safety.healthVerdict("not json", { version: "0.4.6", launchedAt: 0 }), "absent");
  assert.equal(safety.healthVerdict(`\uFEFF${JSON.stringify(record)}`, { version: "0.4.6", launchedAt: 4000 }), "healthy", "a byte order mark does not hide a record");
});

test("a saved copy is offered only while it describes this install and this build", () => {
  const manifest = safety.backupManifest({ from: "0.4.5", to: "0.4.6", installRoot: "C:\\Users\\Zoë\\Mefi Studio AI+", at: 9 });
  const here = { installRoot: "c:/users/zoë/Mefi Studio AI+/", version: "0.4.6" };
  assert.deepEqual(safety.usableBackup(manifest, here), { from: "0.4.5", to: "0.4.6", at: 9 }, "case, slashes and a trailing separator do not matter");
  assert.equal(safety.usableBackup(manifest, { ...here, installRoot: "D:\\Other copy" }), null, "another install never inherits it");
  assert.equal(safety.usableBackup(manifest, { ...here, version: "0.4.7" }), null, "a later update replaced the reason for it");
  assert.equal(safety.usableBackup(manifest, { ...here, version: "v0.4.5" }), null, "restoring the build that is already running is nothing");
  assert.equal(safety.usableBackup("{", here), null);
  assert.equal(safety.usableBackup(JSON.stringify({ from: "", installRoot: "x" }), here), null);
});

test("an update that did not stand reads as one plain sentence", () => {
  const backup = safety.describeResult({ ok: false, stage: "backup", from: "0.4.5", to: "0.4.6" });
  assert.match(backup, /did not install v0\.4\.6: it could not back up this version first, so nothing changed/);
  assert.match(safety.describeResult({ ok: false, rolledBack: true, stage: "boot", from: "0.4.5", to: "0.4.6" }), /v0\.4\.6 did not start properly, so Studio went back to v0\.4\.5/);
  assert.match(safety.describeResult({ ok: false, rolledBack: true, rollbackFailed: true, stage: "boot", from: "0.4.5", to: "0.4.6" }), /going back to v0\.4\.5 did not finish/);
  assert.equal(safety.describeResult({ ok: false, rolledBack: true, stage: "manual", from: "0.4.5", to: "0.4.6" }), "Went back to v0.4.5.");
  assert.equal(safety.describeResult({ ok: true }), null, "a good update writes nothing and says nothing");
  assert.equal(safety.describeResult("garbage"), null);
  assert.equal(safety.parseResult(JSON.stringify({ ok: false, stage: "elsewhere", reason: "a\u0000b" })).stage, null, "an unknown stage is dropped");
  assert.equal(safety.parseResult(JSON.stringify({ ok: false, reason: "a\u0000b" })).reason, "a b", "control characters never reach the page");
});

test("two installs keep separate copies, and the folder is outside %TEMP% and the install", () => {
  const a = safety.installKey("C:\\Users\\me\\Portable\\Mefi Studio AI+");
  assert.equal(a, safety.installKey("c:/users/me/portable/mefi studio ai+/"), "the same install, however it is spelled");
  assert.notEqual(a, safety.installKey("D:\\Portable\\Mefi Studio AI+"));
  assert.match(a, /^[0-9a-f]{8}$/);
  const folder = rollbackFolder("C:\\Users\\me\\Portable\\Mefi Studio AI+", { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, safety.installKey);
  assert.equal(folder, `C:\\Users\\me\\AppData\\Local\\MefiStudio\\rollback\\${a}`);
  assert.equal(rollbackFolder("C:\\x", {}, safety.installKey), null, "no local app-data folder, no backup");
});

test("only a build whose main.cjs still raises the health flag is watched", () => {
  assert.equal(safety.releaseWritesHealth('const p = path.join(root, "data", "boot-health.json");'), true);
  assert.equal(safety.releaseWritesHealth("// an older build"), false);
  assert.equal(safety.releaseWritesHealth(undefined), false);
});

test("the safety option adds the backup, the watch and the rollback to the apply helper, and nothing else changes", () => {
  const base = { sourceRoot: "C:\\S", installRoot: "C:\\Users\\O'Brien\\Mefi", exePath: "C:\\Users\\O'Brien\\Mefi\\Mefi.exe", pid: 7, version: "0.4.6", cleanupRoot: "C:\\Temp\\u", logPath: "C:\\Temp\\u\\log" };
  const plain = buildApplyScript(base);
  const guarded = buildApplyScript({ ...base, safety: { backupRoot: "C:\\L\\rollback\\ab", from: "0.4.5", resultPath: "C:\\D\\update-result.json", healthPath: "C:\\D\\boot-health.json", watch: true } });
  assert.ok(!/backupRoot|Rollback|healthPath/.test(plain), "no safety option, no safety code");
  // The relaunch line is the one thing the watch replaces: it starts the build itself.
  for (const line of plain.split("\r\n").filter((line) => /robocopy|Wait-Process|resources|Remove-Item/.test(line))) {
    assert.ok(guarded.includes(line), `the plain swap's line survives: ${line}`);
  }
  assert.match(guarded, /'--released', '0\.4\.6'/, "the watch starts the new build with the release flag");
  assert.match(guarded, /Robo @\(\(Q \$target\), \(Q \$backupInstall\)/, "the running build is copied before anything is replaced");
  assert.ok(guarded.indexOf("backing up") < guarded.indexOf("copying "), "the backup comes first");
  assert.match(guarded, /\/XD', \(Q \$dataDir\)/, "the owner's data is never in the copy");
  assert.match(guarded, /if \(\$code -lt 8\)/, "robocopy's success codes are 0-7");
  assert.match(guarded, /function Rollback/);
  assert.match(guarded, /'\/MIR'/, "a rollback removes what the update added");
  assert.match(guarded, /taskkill\.exe \/PID \$proc\.Id \/T \/F/, "a hung build is stopped with its children");
  assert.match(guarded, /Rollback 'the new build did not start properly'/);
  assert.ok(guarded.includes("O''Brien"), "apostrophes stay doubled");
  const noWatch = buildApplyScript({ ...base, safety: { backupRoot: "C:\\L", from: "0.4.5", resultPath: "C:\\D\\r.json", healthPath: "C:\\D\\h.json", watch: false } });
  assert.match(noWatch, /backing up/);
  assert.ok(!/function Boot|function Rollback/.test(noWatch), "a build that cannot report is copied but not watched");
  assert.match(noWatch, /'--released', '0.4.6'/);
});

test("the restore helper mirrors the saved copy, records it and starts the restored build", () => {
  const script = buildRollbackScript({
    installRoot: "C:\\Mefi",
    exePath: "C:\\Mefi\\Mefi.exe",
    pid: 9,
    restoreVersion: "0.4.5",
    replacedVersion: "0.4.6",
    cleanupRoot: "C:\\Temp\\rb",
    safety: { backupRoot: "C:\\L\\rollback\\ab", resultPath: "C:\\Mefi\\resources\\app\\data\\update-result.json" },
  });
  assert.match(script, /Wait-Process -Id \$pidToWait -Timeout 180/);
  assert.match(script, /'\/MIR'.*'\/XD', \(Q \$dataDir\)/, "mirrored, with the owner's data excluded");
  assert.match(script, /stage = 'manual'/);
  assert.match(script, /'--rolled-back', \$fromVersion/);
  assert.match(script, /\$fromVersion = '0\.4\.5'/);
  assert.match(script, /\$toVersion = '0\.4\.6'/);
  assert.match(script, /Remove-Item -LiteralPath \$backupRoot/, "the saved copy is dropped once restored");
});
