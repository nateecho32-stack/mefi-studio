import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir, readdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = fileURLToPath(new URL("../", import.meta.url));
const executable = path.join(studio, "node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
test("Mini browser navigates pages that forbid embedding, isolates sites, fits narrow windows and destroys playback on close", {
  skip: !existsSync(executable) || (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY), timeout: 120000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-browser-"));
  try {
    const env = { ...process.env, MEFI_BROWSER_FIXTURE: root }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests/fixtures/media-browser-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-12000); });
    const timer = setTimeout(() => child.kill(), 90000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report; try { report = JSON.parse(await readFile(path.join(root, "report.json"), "utf8")); } catch {}
    if (process.env.MEFI_MEDIA_CAPTURE_DIR && path.isAbsolute(process.env.MEFI_MEDIA_CAPTURE_DIR)) {
      await mkdir(process.env.MEFI_MEDIA_CAPTURE_DIR, { recursive: true });
      for (const name of (await readdir(root)).filter(name => name.endsWith(".png"))) await copyFile(path.join(root, name), path.join(process.env.MEFI_MEDIA_CAPTURE_DIR, name));
    }
    assert.equal(code, 0, `${report?.failure || "No browser report"}\n${output}`);
    assert.equal(report.passed, true);
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("mefi-browser-"));
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
