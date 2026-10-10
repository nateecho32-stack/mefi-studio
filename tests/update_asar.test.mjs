import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = fileURLToPath(new URL("../", import.meta.url));
const electron = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(electron) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("Electron stages portable ASAR files as raw bytes and can restage them", { skip: !canRun, timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-update-asar-"));
  const env = { ...process.env, MEFI_UPDATE_ASAR_FIXTURE: root, MEFI_UPDATE_ASAR_MODULE: path.join(studio, "scripts", "release-updater.mjs") };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(studio, "tests", "fixtures", "update-asar-electron.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-8000); });
  const timer = setTimeout(() => child.kill(), 45000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 0, output);
    assert.match(output, /ASAR portable staging passed/);
  } finally {
    clearTimeout(timer);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("mefi-update-asar-"));
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
