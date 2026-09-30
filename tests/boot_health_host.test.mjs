import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { rollbackFolder } from "../scripts/release-updater.mjs";

const require = createRequire(import.meta.url);
const updateSafety = require("../scripts/update-safety.cjs");

// main.cjs's "Release updates: the safety net" block, run against stubs. What
// matters: the boot record is written for a packaged build only, the renderer
// (or the 45 second fallback) stamps it once, an update that did not stand is
// announced once, and the Roll back path refuses whenever it should.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const start = source.indexOf("// ---- Release updates: the safety net");
const end = source.indexOf("// ---- Discord community link: the Void Engine server", start);
assert.ok(start > 0 && end > start, "the safety net block is where this suite slices it");

const ROOT = "C:\\Users\\me\\Portable\\Mefi Studio AI+\\resources\\app";
const INSTALL = "C:\\Users\\me\\Portable\\Mefi Studio AI+";
const LOCAL = "C:\\Users\\me\\AppData\\Local";
const KEY = updateSafety.installKey(INSTALL);
const BACKUP = `${LOCAL}\\MefiStudio\\rollback\\${KEY}`;

// Objects built inside the vm context carry another realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

function host({ packaged = true, flags = {}, files = {}, env = {}, jobs = [], child = null, installExists = true, state = "current" } = {}) {
  const calls = { writes: [], removed: [], published: [], logs: [], timers: [], spawned: [], exited: 0, settings: 0, resumes: 0, stopped: [], scripts: [] };
  const fsFiles = new Map(Object.entries(files));
  const releaseModule = {
    rollbackFolder,
    stagedBuildWritesHealth: async (_root, writes) => writes(fsFiles.get("staged-main") ?? ""),
    writeRollbackScript: async (file, options) => { calls.scripts.push({ file, options }); },
  };
  const context = vm.createContext({
    SMOKE: Boolean(flags.SMOKE), CAPTURE: Boolean(flags.CAPTURE), CLI_MODE: Boolean(flags.CLI_MODE),
    STUDIO_ROOT: ROOT,
    path: path.win32,
    updateSafety,
    app: { isPackaged: packaged, getVersion: () => "0.4.6", getPath: () => "C:\\Temp", releaseSingleInstanceLock: () => {}, exit: () => { calls.exited += 1; } },
    process: { env: { LOCALAPPDATA: LOCAL, ComSpec: "cmd.exe", ...env }, platform: "win32", execPath: `${INSTALL}\\Mefi Studio AI+.exe`, pid: 4321 },
    mkdirSync: () => {},
    writeFileSync: (file, text) => calls.writes.push({ file, text }),
    existsSync: (file) => (installExists ? true : !String(file).endsWith("install")),
    readFile: async (file) => { if (fsFiles.has(file)) return fsFiles.get(file); throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
    rm: async (file) => { calls.removed.push(file); },
    mkdir: async () => {},
    logLine: (line) => calls.logs.push(line),
    setTimeout: (callback, ms) => { const timer = { callback, ms, unref() {} }; calls.timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    Date,
    Number,
    getReleaseUpdater: async () => releaseModule,
    releaseState: { state, latest: null },
    releaseApplyInFlight: false,
    releasePrevious: null,
    releaseStatus: () => ({ state: "status" }),
    publishRelease: (patch, options) => { calls.published.push({ patch, options }); return {}; },
    activeChild: child,
    autopilot: { jobs },
    updateSettings: async (fn) => { calls.settings += 1; fn({}); },
    window: null,
    saveResume: async () => { calls.resumes += 1; },
    stopReleaseWatch: () => calls.stopped.push("release"),
    stopUpdateWatch: () => calls.stopped.push("update"),
    stopEyesWatch: () => calls.stopped.push("eyes"),
    stopMachineWatch: () => calls.stopped.push("machine"),
    stopCommunityWatch: () => calls.stopped.push("community"),
    stopAssistant: () => calls.stopped.push("assistant"),
    quoteWindowsCmdArg: (value) => `"${value}"`,
    spawn: (command, args, options) => { calls.spawned.push({ command, args, options }); return { pid: 777, unref() {} }; },
    Promise,
    JSON,
    String,
  });
  vm.runInContext(source.slice(start, end), context);
  const read = (expression) => vm.runInContext(expression, context);
  return { context, calls, read, files: fsFiles };
}

test("a packaged boot writes its record, and the renderer stamps it once", () => {
  const h = host();
  assert.deepEqual(plain(h.context.bootHealthy("renderer")), { ok: true, recorded: false }, "nothing before the boot began");
  h.context.bootHealthStart();
  assert.equal(h.calls.writes.length, 1);
  assert.equal(h.calls.writes[0].file, `${ROOT}\\data\\boot-health.json`);
  const first = JSON.parse(h.calls.writes[0].text);
  assert.equal(first.version, "0.4.6");
  assert.equal(first.healthyAt, null);
  h.context.bootHealthy("renderer");
  h.context.bootHealthy("fallback");
  assert.equal(h.calls.writes.length, 2, "the second report changes nothing and rewrites nothing");
  assert.equal(JSON.parse(h.calls.writes[1].text).via, "renderer");
  assert.ok(JSON.parse(h.calls.writes[1].text).healthyAt >= first.startedAt);
});

test("no record for a development run, smoke, capture or a CLI mode", () => {
  for (const options of [{ packaged: false }, { flags: { SMOKE: true } }, { flags: { CAPTURE: true } }, { flags: { CLI_MODE: true } }]) {
    const h = host(options);
    h.context.bootHealthStart();
    assert.equal(h.calls.writes.length, 0, JSON.stringify(options));
  }
});

test("a shell that never reports is counted healthy 45 seconds after its window loaded, and only once", () => {
  const h = host();
  h.context.bootHealthStart();
  h.context.bootHealthWatch();
  h.context.bootHealthWatch();
  assert.equal(h.calls.timers.length, 1, "one fallback timer, however many loads");
  assert.equal(h.calls.timers[0].ms, updateSafety.HEALTHY_FALLBACK_MS);
  h.calls.timers[0].callback();
  const stamped = JSON.parse(h.calls.writes.at(-1).text);
  assert.equal(stamped.via, "fallback");
});

test("the renderer's report cancels the fallback", () => {
  const h = host();
  h.context.bootHealthStart();
  h.context.bootHealthWatch();
  h.context.bootHealthy("renderer");
  assert.equal(h.calls.timers[0].cleared, true);
});

test("the helper is told to save this build, and to watch the new one only if it can report", async () => {
  const h = host({ files: { "staged-main": 'writeFileSync(path.join(root, "data", "boot-health.json"))' } });
  const plan = await h.context.releaseSafetyPlan({ module: await h.context.getReleaseUpdater(), prepared: { payloadRoot: "C:\\stage" }, installRoot: INSTALL });
  assert.deepEqual(plain(plan), { backupRoot: BACKUP, from: "0.4.6", resultPath: `${ROOT}\\data\\update-result.json`, healthPath: `${ROOT}\\data\\boot-health.json`, watch: true });

  const silent = host({ files: { "staged-main": "// an older build" } });
  const unwatched = await silent.context.releaseSafetyPlan({ module: await silent.context.getReleaseUpdater(), prepared: { payloadRoot: "C:\\stage" }, installRoot: INSTALL });
  assert.equal(unwatched.watch, false, "copied, but not watched: it could not raise the flag");
  assert.equal(unwatched.backupRoot, BACKUP);

  const off = host({ env: { MEFI_STUDIO_NO_ROLLBACK: "1" } });
  assert.equal(await off.context.releaseSafetyPlan({ module: await off.context.getReleaseUpdater(), prepared: {}, installRoot: INSTALL }), null, "the kill switch leaves the plain swap");

  const nowhere = host({ env: { LOCALAPPDATA: "" } });
  assert.equal(await nowhere.context.releaseSafetyPlan({ module: await nowhere.context.getReleaseUpdater(), prepared: {}, installRoot: INSTALL }), null, "no local app-data folder, no backup");
});

test("a boot after an update that did not stand announces it once and removes the record", async () => {
  const result = { ok: false, rolledBack: true, stage: "boot", from: "0.4.5", to: "0.4.6", at: 5 };
  const h = host({ files: { [`${ROOT}\\data\\update-result.json`]: JSON.stringify(result) } });
  await h.context.releaseSafetyBoot();
  assert.deepEqual(h.calls.removed, [`${ROOT}\\data\\update-result.json`]);
  const note = h.calls.published.find((entry) => entry.patch.rollback);
  assert.match(note.patch.rollback.message, /v0\.4\.6 did not start properly, so Studio went back to v0\.4\.5/);
  assert.equal(note.patch.state, undefined, "the release state itself is left alone");
  assert.equal(note.options.force, true);

  const quiet = host();
  await quiet.context.releaseSafetyBoot();
  assert.ok(!quiet.calls.published.some((entry) => entry.patch.rollback), "no record, no note");
});

test("the saved copy is found only while it describes this install and this build", async () => {
  const good = JSON.stringify(updateSafety.backupManifest({ from: "0.4.5", to: "0.4.6", installRoot: INSTALL, at: 3 }));
  const h = host({ files: { [`${BACKUP}\\manifest.json`]: good } });
  await h.context.releaseScanPrevious();
  assert.deepEqual(plain(h.read("releasePrevious")), { from: "0.4.5", to: "0.4.6", at: 3 });

  const stale = JSON.stringify(updateSafety.backupManifest({ from: "0.4.4", to: "0.4.5", installRoot: INSTALL, at: 3 }));
  const old = host({ files: { [`${BACKUP}\\manifest.json`]: stale } });
  await old.context.releaseScanPrevious();
  assert.equal(old.read("releasePrevious"), null, "a copy from an earlier update is not offered");

  const dev = host({ packaged: false, files: { [`${BACKUP}\\manifest.json`]: good } });
  await dev.context.releaseScanPrevious();
  assert.equal(dev.read("releasePrevious"), null, "development has nothing to roll back");
});

test("Roll back refuses without a saved copy, mid-update, with builders running or in a non-packaged run", async () => {
  const none = host();
  assert.match((await none.context.releaseRollback()).error, /no saved version/);
  assert.equal(none.calls.exited, 0);

  const ready = async (overrides) => {
    const h = host(overrides);
    vm.runInContext(`releasePrevious = { from: "0.4.5", to: "0.4.6", at: 1 }`, h.context);
    return h;
  };
  const busy = await ready({ jobs: [{ finished: false }] });
  assert.match((await busy.context.releaseRollback()).error, /1 build job\(s\) still running/);
  const dev = await ready({ packaged: false });
  assert.match((await dev.context.releaseRollback()).error, /portable Windows build/);
  const applying = await ready({ state: "applying" });
  assert.match((await applying.context.releaseRollback()).error, /already in progress/);
  const game = await ready({ child: { exitCode: null } });
  assert.match((await game.context.releaseRollback()).error, /Love2D is running/);
  const gone = await ready({ installExists: false });
  assert.match((await gone.context.releaseRollback()).error, /no longer on disk/);
  assert.equal(gone.read("releaseApplyInFlight"), false, "a refusal frees the flag for the next try");
});

test("Roll back writes the restore helper, stops the watchers, launches it through start and exits", async () => {
  const h = host();
  vm.runInContext(`releasePrevious = { from: "0.4.5", to: "0.4.6", at: 1 }`, h.context);
  h.context.setTimeout = (callback) => { callback(); return { unref() {} }; };
  const result = await h.context.releaseRollback();
  assert.equal(result.ok, true);
  assert.equal(result.version, "0.4.5");
  const { options } = h.calls.scripts[0];
  assert.deepEqual({ restoreVersion: options.restoreVersion, replacedVersion: options.replacedVersion, pid: options.pid }, { restoreVersion: "0.4.5", replacedVersion: "0.4.6", pid: 4321 });
  assert.equal(options.safety.backupRoot, BACKUP);
  assert.equal(options.safety.resultPath, `${ROOT}\\data\\update-result.json`);
  assert.deepEqual(h.calls.stopped, ["release", "update", "eyes", "machine", "community", "assistant"]);
  assert.equal(h.calls.resumes, 1, "the restored build comes back where this one was");
  const spawned = h.calls.spawned[0];
  assert.match(spawned.args.at(-1), /^"start "" powershell\.exe .*"-File" ".*rollback-update\.ps1""$/);
  assert.equal(spawned.options.detached, true);
  assert.equal(spawned.options.windowsVerbatimArguments, true);
  assert.equal(h.calls.exited, 1);
});
