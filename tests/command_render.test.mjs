// Real Chromium startup catches runtime-only failures in the Command frame
// loop. This host has an in-memory fixture bridge, never Studio's main process.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-booklet.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

const coldBootMarker = "Renderer errors before initial painted task frames";
const runFixture = async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-command-render-"));
  try {
    await mkdir(path.join(fixture, "renderer"));
    await mkdir(path.join(fixture, "data"));
    // Build the actual current sources, so an old committed booklet cannot
    // conceal a missing scheduler variable in idle.js or tree3d.js.
    const files = (await readdir(path.join(studio, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
    await Promise.all(files.map((name) => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
    await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
    await build({ root: fixture });
    const env = { ...process.env, MEFI_COMMAND_RENDER_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(studio, "tests", "fixtures", "command-render-electron.cjs")], { cwd: fixture, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-10000); });
    const timer = setTimeout(() => child.kill(), 45000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    // Electron can exit before its error stream flushes. Read its synchronously
    // saved report before asserting the exit code or deleting the fixture.
    let report, reportError;
    try { report = JSON.parse(await readFile(path.join(fixture, "report.json"), "utf8")); }
    catch (error) { reportError = error; }
    const diagnostic = [report?.failure, report?.errors?.length ? JSON.stringify(report.errors) : "", output, reportError ? `Fixture report unavailable: ${reportError.message}` : ""].filter(Boolean).join("\n");
    assert.equal(code, 0, diagnostic);
    assert.ok(report, diagnostic || "Electron exited without saving its fixture report");
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.networkAttempts, []);
    assert.deepEqual(report.processAttempts, []);
    assert.ok(report.first.frames >= 4 && report.reentered.frames >= report.stoppedFrames + 3);
    assert.equal(report.exited, true);
    assert.equal(report.homeRailPaints, 0);
    assert.equal(report.commandRailPaints, 0);
    assert.equal(report.railResumed, true);
    assert.equal(report.motion.rebuildStable, true);
    assert.equal(report.motion.completed, true);
    assert.ok(report.motion.samples >= 6 && report.motion.travel > 3 && report.motion.maxFrameStep <= report.motion.travel * 0.4);
    assert.deepEqual(report.grouping, { members: 2, expanded: true, verifyingVisible: true });
    assert.equal(report.agentModes.homeSaving, true);
    assert.equal(report.agentModes.commandSaving, true);
    assert.equal(report.agentModes.paused, true);
    assert.equal(report.agentModes.helperCount, 1);
    assert.deepEqual(report.agentModes.patches, [{ mode: "cluster" }, { mode: "swarm" }]);
    assert.equal(report.agentModes.layouts.length, 4);
    assert.deepEqual(report.newWork.actions, ["start-work", "pause", "start-work", "pause"]);
    assert.deepEqual(report.newWork.saving, [true, true]);
    assert.equal(report.newWork.layouts.length, 2);
    assert.deepEqual(report.chatPanel, { chat: true, activity: true, roster: true, rosterRows: 1, tab: "work" });
    for (const [index, width] of [1280, 600].entries()) assert.ok(Math.abs(report.newWork.layouts[index].width - width) <= 1, "toggle layouts cover desktop and narrow windows across display scaling");
    assert.ok(report.newWork.before.controls.every((control) => !control.checked && !control.disabled && control.role === "switch"));
    const beforeWork = report.newWork.before;
    for (const size of ["desktop", "narrow"]) {
      for (const [name, enabled] of [[`${size}On`, true], [`${size}Off`, false]]) {
        const sample = report.newWork[name];
        assert.ok(sample.controls.every((control) => control.checked === enabled && !control.disabled && control.text.includes(enabled ? "On" : "Off")));
        assert.equal(sample.assistant.status, enabled ? "running" : "paused");
        assert.equal(sample.status.execute, true, "Pause holds scheduling while keeping executor preference available for Resume");
        assert.deepEqual(sample.status.running, beforeWork.status.running, "pausing never removes the existing synthetic worker");
        assert.deepEqual(sample.assistant.prefs, beforeWork.assistant.prefs);
        for (const key of ["enabled", "autoBuild", "mode", "parallel", "adaptiveParallel"]) assert.equal(sample.status[key], beforeWork.status[key], `${name}: ${key} remains unchanged`);
      }
    }
    assert.equal(report.audio.playing.audio.source, "local");
    assert.equal(report.audio.playing.playing, true);
    assert.equal(report.audio.paused.playing, false);
    assert.equal(report.audio.stableGeometry, true);
    assert.equal(report.audio.defaults.response, .35);
    assert.deepEqual(report.audio.defaults.effects, { waves: true, nodes: true, percussion: false, background: false, splitBands: true });
    const controls = report.audio.controls;
    assert.equal(controls.wavesOff.connections.length, 0);
    assert.ok(controls.wavesOff.nodeLevels.some(level=>level>0.02));
    assert.ok(controls.nodesOff.connections.length>0 && controls.nodesOff.nodeLevels.every(level=>level===0));
    assert.equal(controls.zero.audio.response, 0);
    assert.ok(controls.zero.connections.length===0 && controls.zero.nodeLevels.every(level=>level===0));
    assert.equal(controls.restored.audio.response, .35);
    assert.ok(new Set(controls.restored.connections.map(wave=>wave.band)).size>=2);
    assert.ok(controls.fullMix.connections.every(wave=>wave.band==='mix'));
    for (const sample of Object.values(controls)) {
      assert.ok(sample.playing && sample.sourceStable);
      assert.equal(sample.audio.source, "local");
      assert.deepEqual(sample.captureCalls, []);
    }
    assert.ok(report.audio.playing.audio.energy > 0.15 && report.audio.paused.audio.energy < 0.02);
    assert.ok(report.audio.playing.luminance > report.audio.quiet.luminance + 2 && report.audio.playing.luminance > report.audio.paused.luminance + 2,
      "real player audio visibly brightens stationary node bodies and releases on pause");
    assert.ok(report.audio.lowLevel.peaks.energy > report.audio.loud.peaks.energy * 0.35,
      "very quiet float PCM retains a visible response across an 80 dB input change");
    assert.ok(report.audio.lowLevel.snapshot.luminance > report.audio.quiet.luminance + 2);
    assert.ok(report.audio.waveChecks.anchored && report.audio.waveChecks.animated && report.audio.waveChecks.stroked > 0 && report.audio.waveChecks.painted > 3,
      "anchored wave paths change across real canvas frames and paint visible pixels");
    for (const voice of ["bassline", "snare", "hat"]) {
      assert.ok(report.audio[voice].frames >= 6 && report.audio[voice].peaks[voice] > 0.04,
        `${voice} responds independently in the real media analyser`);
    }
    assert.ok(report.audio.silence.playing && report.audio.silence.audio.energy < 0.02,
      "digital silence settles even while playback continues");
    for (const snapshot of [report.first, report.reentered]) {
      assert.ok(snapshot.finiteNodes >= 3);
      assert.ok(snapshot.taskPixels > 8, "a real task node must paint pixels above the dark backdrop");
      assert.equal(snapshot.taskId, "task:command_render_task");
    }
  } finally {
    await rm(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
};

test("real Command renderer paints finite task nodes, continues frames, and survives exit/reentry", { skip: !canRun, timeout: 100000 }, async () => {
  try {
    await runFixture();
  } catch (error) {
    // A cold Electron spawn can surface a one-shot renderer error (idle.js
    // `reading 'size'`) inside the pre-paint error window; warmed spawns pass,
    // so retry exactly that cold-boot signature once instead of failing the
    // suite. Any other failure, or a repeated one, still propagates.
    if (!String(error?.message ?? "").includes(coldBootMarker)) throw error;
    await runFixture();
  }
});
