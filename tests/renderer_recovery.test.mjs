import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { attachRendererRecovery } = require("../scripts/renderer-recovery.cjs");

function fixture(options = {}) {
  let time = 1000;
  let quitting = false;
  let closed = false;
  let crashed = false;
  let loads = 0;
  let sequence = 0;
  const pending = new Map();
  const records = [];
  const blocked = [];
  const window = new EventEmitter();
  const contents = new EventEmitter();
  window.webContents = contents;
  window.isDestroyed = contents.isDestroyed = () => closed;
  contents.isCrashed = () => crashed;
  const recovery = attachRendererRecovery({
    window, load: () => { loads += 1; return options.load?.(); },
    isQuitting: () => quitting, log: (record) => records.push(record), onBlocked: (details) => { blocked.push(details); return options.onBlocked?.(details); },
    now: () => time,
    schedule: (callback, delay) => { const id = ++sequence; pending.set(id, { callback, at: time + delay }); return id; },
    cancel: (id) => pending.delete(id),
  });
  return {
    window, contents, recovery, records, blocked, pending,
    loads: () => loads,
    crash: (reason = "crashed", exitCode = -1) => { crashed = true; contents.emit("render-process-gone", {}, { reason, exitCode }); },
    loaded: () => { crashed = false; contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }); contents.emit("did-finish-load"); },
    quit: () => { quitting = true; },
    close: () => { closed = true; window.emit("closed"); },
    advance: (ms) => { time += ms; },
    flush: async () => {
      const [id, timer] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (timer) { pending.delete(id); time = Math.max(time, timer.at); timer.callback(); }
      await Promise.resolve(); await Promise.resolve();
    },
  };
}

test("a crashed renderer reloads only after the event finishes and records a bounded diagnostic", async () => {
  const f = fixture();
  f.crash("oom", -1073741819);
  assert.equal(f.loads(), 0);
  assert.equal(f.pending.size, 1);
  assert.deepEqual(f.records[0], { component: "renderer-recovery", event: "failure", at: 1000, reason: "oom", exitCode: -1073741819 });
  await f.flush();
  assert.equal(f.loads(), 1);
  assert.equal(f.recovery.status().state, "recovering");
  f.loaded();
  assert.equal(f.recovery.status().state, "healthy");
  assert.equal(f.recovery.retry(), false, "opening a healthy window must not reload it");
});

test("two recoveries within a minute cap the loop even when each renderer briefly loaded", async () => {
  const f = fixture();
  for (let attempt = 0; attempt < 2; attempt += 1) { f.crash(); await f.flush(); f.loaded(); }
  f.crash();
  assert.equal(f.loads(), 2);
  assert.equal(f.pending.size, 0);
  assert.equal(f.blocked.length, 1);
  assert.equal(f.recovery.status().state, "blocked");
  f.crash();
  assert.equal(f.blocked.length, 1, "duplicate failures cannot stack native prompts");
  assert.equal(f.blocked[0].retry(), true);
  await f.flush();
  f.loaded();
  assert.equal(f.loads(), 3, "an explicit Reload remains available after automatic recovery stops");
  f.crash();
  assert.equal(f.pending.size, 0, "manual reload does not erase the rolling automatic cap");
  f.advance(60001);
  f.crash(); await f.flush();
  assert.equal(f.loads(), 4, "automatic recovery becomes available after the bounded window");
});

test("only main-frame failures recover and diagnostic data never includes page URLs or error text", async () => {
  const f = fixture();
  const sensitive = "https://fixture.invalid/?token=private";
  f.contents.emit("did-fail-load", {}, -105, sensitive, sensitive, false);
  f.contents.emit("did-fail-load", {}, -3, sensitive, sensitive, true);
  assert.equal(f.pending.size, 0);
  f.contents.emit("did-fail-load", {}, -6, sensitive, sensitive, true);
  await f.flush();
  assert.equal(f.loads(), 1);
  assert.equal(f.records[0].errorCode, -6);
  assert.equal(JSON.stringify(f.records).includes("private"), false);
  f.crash(sensitive, 3);
  assert.equal(f.recovery.status().failure.reason, "unknown");
});

test("duplicate crash/load notifications and rejected reload promises schedule one next attempt", async () => {
  const f = fixture({ load: () => Promise.reject(Object.assign(new Error("secret file path"), { errno: -6 })) });
  f.crash();
  f.contents.emit("did-fail-load", {}, -6, "secret", "secret", true);
  assert.equal(f.pending.size, 1);
  await f.flush();
  assert.equal(f.loads(), 1);
  assert.equal(f.pending.size, 1);
  await f.flush();
  assert.equal(f.loads(), 2);
  assert.equal(f.pending.size, 0);
  assert.equal(f.blocked.length, 1);
  assert.equal(JSON.stringify(f.records).includes("secret"), false);
});

test("successful load supersedes a pending timer and any late rejection", async () => {
  let rejectLoad;
  const f = fixture({ load: () => new Promise((_resolve, reject) => { rejectLoad = reject; }) });
  f.crash(); f.loaded(); await f.flush();
  assert.equal(f.loads(), 0);
  f.crash(); await f.flush(); f.loaded();
  rejectLoad(new Error("stale"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.recovery.status().state, "healthy");
  assert.equal(f.pending.size, 0);
});

test("Chromium's error-page load is not mistaken for successful recovery", async () => {
  const f = fixture();
  f.contents.emit("did-fail-load", {}, -6, "ignored", "ignored", true);
  f.contents.emit("did-finish-load");
  assert.equal(f.recovery.status().state, "failed");
  assert.equal(f.pending.size, 1);
  f.contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  f.contents.emit("did-finish-load");
  assert.equal(f.recovery.status().state, "failed", "subframe loads cannot clear a main-frame failure");
  await f.flush(); f.loaded();
  assert.equal(f.recovery.status().state, "healthy");
});

test("clean exit, application quit and window disposal never resurrect a renderer", async () => {
  const clean = fixture(); clean.crash("clean-exit", 0); await clean.flush();
  assert.equal(clean.loads(), 0);
  const quitting = fixture(); quitting.crash(); quitting.quit(); await quitting.flush();
  assert.equal(quitting.loads(), 0);
  assert.equal(quitting.recovery.retry(), false);
  const closing = fixture(); closing.crash(); closing.close(); await closing.flush();
  assert.equal(closing.loads(), 0);
  assert.equal(closing.recovery.status().state, "disposed");
  assert.equal(closing.contents.listenerCount("render-process-gone"), 0);
  assert.equal(closing.contents.listenerCount("did-fail-load"), 0);
  assert.equal(closing.recovery.retry(), false);
});

test("a hidden background window stays recoverable and rejected native prompts stay handled", async () => {
  const f = fixture({ onBlocked: async () => { throw new Error("native prompt unavailable"); } });
  f.window.emit("close", { defaultPrevented: true }); // background mode parks the window instead of destroying it.
  for (let count = 0; count < 3; count += 1) { f.crash(); await f.flush(); f.loaded(); }
  assert.equal(f.loads(), 2);
  assert.equal(f.blocked.length, 1);
  assert.ok(f.records.some((record) => record.event === "notification-failed"));
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
test("isolated Electron renderer crashes recover twice, stop at the cap, and accept manual reload", {
  skip: process.platform !== "win32" || !existsSync(electron), timeout: 60000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-renderer-recovery-"));
  try {
    const env = { ...process.env, MEFI_RECOVERY_FIXTURE_DIR: dir };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(root, "tests", "fixtures", "renderer-recovery-electron.cjs")], { cwd: dir, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => child.kill(), 45000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, output);
    const report = JSON.parse(await readFile(path.join(dir, "report.json"), "utf8"));
    assert.equal(report.crashes, 3);
    assert.equal(report.automaticReloads, 2);
    assert.equal(report.manualReloads, 2);
    assert.equal(report.blocked, 2);
    assert.equal(report.text, "Recovery fixture ready");
    assert.equal(new Set(report.rendererPids).size, report.rendererPids.length);
    assert.ok(report.diagnostics.some((record) => record.reason === "main-frame-load-failed"));
    assert.ok(report.diagnostics.filter((record) => record.event === "failure").every((record) => !Object.hasOwn(record, "url") && !Object.hasOwn(record, "message")));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
});
