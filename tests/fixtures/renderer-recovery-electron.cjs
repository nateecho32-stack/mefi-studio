"use strict";

// A separate Electron host with one disposable renderer. Never imports Studio's
// main process, opens its stores, launches agents, or contacts the network.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { attachRendererRecovery } = require("../../scripts/renderer-recovery.cjs");
const root = process.env.MEFI_RECOVERY_FIXTURE_DIR;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated fixture directory is required");
app.setName("Studio Renderer Recovery Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir);
}
app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition, label) => {
  const deadline = Date.now() + 7000;
  while (!condition()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await sleep(20); }
};
let quitting = false;
app.on("before-quit", () => { quitting = true; });

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(data:|file:|devtools:)/.test(details.url) }));
  const window = new BrowserWindow({ show: false, width: 500, height: 300, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const contents = window.webContents;
  const page = "data:text/html;charset=utf-8," + encodeURIComponent('<!doctype html><title>Isolated recovery fixture</title><p id="ready">Recovery fixture ready</p>');
  const report = { crashes: 0, automaticReloads: 0, manualReloads: 0, blocked: 0, rendererPids: [], diagnostics: [] };
  const recovery = attachRendererRecovery({
    window, load: () => window.loadURL(page), isQuitting: () => quitting,
    delayMs: 20,
    log: (record) => {
      report.diagnostics.push(record);
      fs.appendFileSync(path.join(root, "diagnostics.jsonl"), JSON.stringify(record) + "\n");
      if (record.event === "reload") report[record.manual ? "manualReloads" : "automaticReloads"] += 1;
    },
    onBlocked: () => { report.blocked += 1; },
  });
  await window.loadURL(page);
  report.rendererPids.push(contents.getOSProcessId());
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    contents.forcefullyCrashRenderer(); report.crashes += 1;
    await until(() => report.automaticReloads === attempt && recovery.status().state === "healthy", `automatic reload ${attempt}`);
    assert.equal(await contents.executeJavaScript("document.getElementById('ready').textContent"), "Recovery fixture ready");
    report.rendererPids.push(contents.getOSProcessId());
  }
  contents.forcefullyCrashRenderer(); report.crashes += 1;
  await until(() => recovery.status().state === "blocked", "automatic cap");
  await sleep(100);
  assert.equal(report.automaticReloads, 2);
  assert.equal(recovery.retry(), true);
  await until(() => report.manualReloads === 1 && recovery.status().state === "healthy", "manual reload after cap");
  report.rendererPids.push(contents.getOSProcessId());
  await window.loadFile(path.join(root, "missing-fixture.html")).catch(() => {});
  await until(() => report.blocked === 2, "real main-frame load failure");
  assert.equal(recovery.retry(), true);
  await until(() => report.manualReloads === 2 && recovery.status().state === "healthy", "manual reload after load failure");
  report.text = await contents.executeJavaScript("document.getElementById('ready').textContent");
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  recovery.dispose();
  quitting = true;
  window.destroy();
  console.log("Renderer recovery fixture passed");
  app.exit(0);
}).catch((error) => { console.error(error.stack); app.exit(1); });
