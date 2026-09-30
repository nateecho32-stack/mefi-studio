// The numbered taskbar icon in the Chromium the app ships: the PNGs
// scripts/badge-icon.cjs draws are decoded by Electron's own
// nativeImage.createFromBuffer (what win.setOverlayIcon is given) and come back
// as exactly the pixels that were drawn, at both sizes. tests/badge_icon.test.mjs
// reads the same PNGs back with a decoder written from the format; this is the
// proof that the real one agrees. Skipped where Electron cannot open a window
// (no display); it is one of the Electron suites the fast run leaves out.
//
// Run: node --test tests/badge_icon_electron.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("Electron's own image decoder reads the drawn overlay icons back exactly, at 16 and 32 px", { skip: !canRun && "Electron cannot open a window here" }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "mefi-badge-icon-"));
  try {
    const env = { ...process.env, MEFI_BADGE_FIXTURE: folder };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = process.platform === "linux" ? ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] : [];
    const child = spawn(executable, [...args, path.join(studio, "tests", "fixtures", "badge-icon-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-6000); });
    const timer = setTimeout(() => child.kill(), 60000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report = null;
    try { report = JSON.parse(await readFile(path.join(folder, "report.json"), "utf8")); } catch { /* reported below */ }
    assert.ok(report, `Electron wrote no report (exit ${code})\n${output}`);
    assert.equal(report.failure, null, report.failure ?? "");
    assert.equal(code, 0);
    assert.deepEqual(report.pictures.map((p) => [p.count, p.size]), [[1, 16], [7, 16], [42, 16], [99, 16], [3, 32], [99, 32]]);
    for (const p of report.pictures) {
      assert.equal(p.empty, false, `${p.count} at ${p.size}: decoded`);
      assert.deepEqual([p.width, p.height], [p.size, p.size], `${p.count} at ${p.size}: the size survives`);
      assert.equal(p.bytes, p.size * p.size * 4);
      assert.equal(p.mismatches, 0, `${p.count} at ${p.size}: every pixel is the drawn one`);
    }
  } finally {
    assert.equal(path.dirname(folder), path.resolve(tmpdir()));
    await rm(folder, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
