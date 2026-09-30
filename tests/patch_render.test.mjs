// renderer/patch.js (MefiPatch.morph) in a real renderer: a repaint that keeps
// node identity, focus, drafts, scroll, open <details>, players and frames, and
// refuses unsafe markup (tests/fixtures/patch-electron.cjs runs every case in one
// page and this file reads the verdicts back).
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

const EXPECTED = [
  "text and attributes change in place",
  "unkeyed siblings keep their nodes when one is added at the end",
  "a different tag is replaced",
  "keyed rows keep their nodes through a reorder, an insert and a removal",
  "an id is a key too",
  "a focused field keeps focus and what was typed while the markup is unchanged, and follows the app when the app changes its mind",
  "a textarea draft survives a repaint and is replaced when the app changes the text",
  "a checkbox and a select keep the person's choice until the markup changes",
  "scroll position survives a repaint of the list it is in",
  "a details keeps the state the person put it in until the app changes its own opinion",
  "a kept player is the same node, untouched inside, through a move and a repaint of its neighbours",
  "a moved frame is not reloaded and a moved field keeps its focus (Node.moveBefore)",
  "attributes a script owns are left alone",
  "inline handlers, javascript: links, srcdoc and scripts never reach a live node",
  "an element or a fragment is a source too",
  "a thousand keyed rows repaint quickly and keep every node",
  "the morph of nothing changes nothing",
];

test("MefiPatch keeps what the person is using through a repaint", { skip: !canRun, timeout: 120000 }, async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-patch-"));
  try {
    const env = { ...process.env, MEFI_PATCH_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "patch-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
    }, 100000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    let report;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); } catch { /* reported below */ }
    assert.equal(code, 0, `${report?.failure || "No report"}\n${output}`);
    assert.deepEqual(report.errors, [], "no console errors");
    assert.deepEqual(Object.keys(report.results), EXPECTED, "every case ran, in order");
    for (const [name, verdict] of Object.entries(report.results)) assert.ok(verdict.ok, `${name}: ${JSON.stringify(verdict.detail)}`);
    assert.equal(report.moveBefore, true, "this Chromium has Node.moveBefore, which the frame and focus cases rely on");
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("mefi-patch-"));
    await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
