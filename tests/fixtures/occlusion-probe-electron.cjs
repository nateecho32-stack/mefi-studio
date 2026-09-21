"use strict";

// Live-Chromium proof of the occlusion probe in main.cjs measureWorkerLag:
// loads the real renderer/booklet.html so the page CSP applies, proves the
// blob worker constructs under it, then covers the window with a second
// always-on-top window (native Windows occlusion — never minimize) and proves
// rAF goes silent while the worker / MessageChannel channel still answers and
// the probe classifies the reading as ~0 lag instead of the 1000ms sentinel.
// The probe expression itself is extracted from main.cjs at runtime so this
// fixture always exercises the shipped code, never a paraphrase.
// On desktops where the native occlusion tracker never engages — the cover
// shown focused yet rAF stays loud behind it, or the mirror case where
// document.hidden reads true while frames keep flowing — the fixture reports
// `occlusionUnsupported` and exits cleanly so the test can skip with an
// explicit reason; the strict occlusion assertions only run when real
// occlusion was actually observed (or rAF provably went silent under cover).

const { app, BrowserWindow, screen } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.MEFI_OCCLUSION_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated occlusion fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = {
  electron: process.versions.electron,
  backgroundThrottling: true,
  consoleErrors: [],
  cspViolations: [],
};

app.setName("Studio Occlusion Probe Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
// Chromium's Windows occlusion tracker is the mechanism measureWorkerLag is
// built around; make sure it is active rather than inherited-disabled.
app.commandLine.appendSwitch("enable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => {});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
async function finish(error) {
  if (finished) return;
  finished = true;
  let failure = error ? (error.stack || String(error)) : null;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  if (failure) report.failure = failure;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (failure) console.error(failure);
  else console.log("Occlusion probe fixture passed");
  process.exitCode = failure ? 1 : 0;
  app.quit();
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

const mainSource = fs.readFileSync(path.join(studio, "main.cjs"), "utf8");
const marker = "answered = await rendererValue(`";
const markerAt = mainSource.indexOf(marker);
assert.ok(markerAt >= 0, "measureWorkerLag probe template not found in main.cjs");
const probeBegin = markerAt + marker.length;
const probeEnd = mainSource.indexOf("`, null, 1000)", probeBegin);
assert.ok(probeEnd > probeBegin, "measureWorkerLag probe template end not found in main.cjs");
const probeExpression = mainSource.slice(probeBegin, probeEnd);

app.whenReady().then(async () => {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const probeLeft = bounds.x + 60;
  const probeTop = bounds.y + 60;
  const window = new BrowserWindow({
    x: probeLeft,
    y: probeTop,
    width: Math.min(900, bounds.width - 120),
    height: Math.min(640, bounds.height - 120),
    show: false,
    backgroundColor: "#101014",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: false,
      backgroundThrottling: true,
    },
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => {
    const level = typeof detail === "object" ? detail.level : detail;
    const message = String(typeof detail === "object" ? detail.message : oldMessage);
    if (level === "error" || level === 3) report.consoleErrors.push(message);
    if (/Content Security Policy|worker-src|Refused to (?:create|load)/i.test(message)) report.cspViolations.push(message);
  });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Probe renderer exited: ${detail.reason}`)));
  const run = (source) => contents.executeJavaScript(`(async()=>{${source}})()`, true);

  // Same classification as main.cjs around the awaited probe: frames get a
  // 50ms allowance, the unthrottled channel gets 200ms, and the sentinel
  // stands only when neither aliveness channel ever answered.
  async function runProbe() {
    const startedAt = Date.now();
    const answered = await contents.executeJavaScript(`(${probeExpression})`, true);
    const wallMs = Date.now() - startedAt;
    let lagMs;
    if (answered?.frames === true) lagMs = Math.max(0, wallMs - 50);
    else if (Number.isFinite(answered?.workerDriftMs)) lagMs = Math.max(0, answered.workerDriftMs - 200, wallMs - 200);
    else lagMs = 1000;
    return { answered, wallMs, lagMs };
  }

  // Parallel test files load the CPU, inflating the IPC wall time and worker
  // timer drift that lagMs subtracts, so one instantaneous occluded sample can
  // read hundreds of ms (612ms seen under the full suite) on a healthy window.
  // Resample a few times and judge on the cleanest reading: contention is
  // bursty so a healthy window lands a <100ms sample early (the loop exits),
  // while the failures this probe exists to catch — throttling regression
  // (frames answer), wedged page (sentinel) — fail on every single sample, so
  // retries cannot mask them. Every sample is reported for diagnosis.
  async function sampleProbe() {
    const samples = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await pause(400);
      const sample = await runProbe();
      samples.push(sample);
      if (sample.lagMs < 100) break;
    }
    return samples;
  }
  const bestSample = (samples) => samples.reduce((best, sample) => (sample.lagMs < best.lagMs ? sample : best));

  await window.loadFile(path.join(studio, "renderer", "booklet.html"));

  // Raise and focus so nothing already on the desktop counts as occluding the
  // probe window before the fixture's own cover window exists.
  window.show();
  window.focus();

  report.csp = await run(`
    window.__rafTicks = 0;
    window.__rafLoop = () => { window.__rafTicks += 1; requestAnimationFrame(window.__rafLoop); };
    requestAnimationFrame(window.__rafLoop);
    window.__workerProbe = () => new Promise((resolve) => {
      const t0 = Date.now();
      let settled = false;
      const done = (result) => { if (!settled) { settled = true; resolve(result); } };
      setTimeout(() => done({ constructed: false, driftMs: null, wallMs: Date.now() - t0 }), 900);
      try {
        const src = "const t0 = Date.now(); setTimeout(() => postMessage(Date.now() - t0), 150);";
        const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        worker.onmessage = (event) => { try { worker.terminate(); } catch {} done({ constructed: true, driftMs: Number(event.data), wallMs: Date.now() - t0 }); };
        worker.onerror = (event) => { try { worker.terminate(); } catch {} done({ constructed: false, refused: String(event.message || "worker error"), wallMs: Date.now() - t0 }); };
      } catch (error) { done({ constructed: false, refused: String(error) }); }
    });
    window.__messageChannelProbe = () => new Promise((resolve) => {
      const t0 = Date.now();
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { try { channel.port1.close(); channel.port2.close(); } catch {} resolve(Date.now() - t0); };
      channel.port2.postMessage(0);
    });
    return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null;
  `);
  assert.ok(report.csp && /worker-src[^;]*blob:/.test(report.csp), `booklet.html CSP must allow blob workers, got: ${report.csp}`);

  // Phase 1 — visible: rAF advances, frames answer, worker constructs. Wait
  // for the compositor to actually start producing frames (software rendering
  // a 30k-line page can take a moment) instead of a fixed settle.
  const visibleDeadline = Date.now() + 10000;
  let visibleState = null;
  let raised = 0;
  while (Date.now() < visibleDeadline) {
    visibleState = await run("return { hidden: document.hidden, visibility: document.visibilityState, ticks: window.__rafTicks|0, focused: document.hasFocus() };");
    if (visibleState.ticks >= 5 && !visibleState.hidden) break;
    if (Date.now() - raised > 2000) { raised = Date.now(); window.moveTop(); window.focus(); }
    await pause(200);
  }
  report.visible = {
    state: visibleState,
    windowState: { visible: window.isVisible(), minimized: window.isMinimized() },
  };
  assert.ok(visibleState.ticks >= 5, `rAF must advance while visible (state=${JSON.stringify(visibleState)}, window=${JSON.stringify(report.visible.windowState)})`);
  if (visibleState.hidden) {
    // Frames keep flowing while the tracker claims the window is hidden —
    // the mirror image of the cover that never engages the tracker. The
    // visibility signal is unreliable on this desktop: record it, keep the
    // frames-flow baseline (a page that stops painting still fails the
    // assert above), and disable hidden-based occlusion detection below so
    // a pre-flipped flag cannot fake an occlusion hit.
    report.visible.visibilitySignalReliable = false;
  } else {
    assert.equal(visibleState.hidden, false, `visible phase must not start occluded: ${JSON.stringify(visibleState)}`);
    report.visible.visibilitySignalReliable = true;
  }
  report.visible.probeSamples = await sampleProbe();
  report.visible.probe = bestSample(report.visible.probeSamples);
  assert.equal(report.visible.probe.answered?.frames, true, `visible probe must answer via frames, got ${JSON.stringify(report.visible.probe)}`);
  assert.ok(report.visible.probe.lagMs < 100, `visible probe lag should be ~0, got ${report.visible.probe.lagMs}ms (samples=${JSON.stringify(report.visible.probeSamples.map((sample) => sample.lagMs))})`);
  report.visible.worker = await run("return window.__workerProbe();");
  assert.equal(report.visible.worker.constructed, true, `blob worker must construct under the page CSP, got ${JSON.stringify(report.visible.worker)}`);
  assert.ok(report.visible.worker.driftMs >= 100 && report.visible.worker.driftMs < 600, `blob worker timer drift implausible: ${JSON.stringify(report.visible.worker)}`);
  report.visible.messageChannelMs = await run("return window.__messageChannelProbe();");
  assert.ok(Number.isFinite(report.visible.messageChannelMs) && report.visible.messageChannelMs < 200, `MessageChannel round trip too slow: ${report.visible.messageChannelMs}ms`);

  // Phase 2 — occluded: cover the probe window with an always-on-top window
  // spanning the whole display. The probe window stays visible (never
  // minimized); only native occlusion changes its compositor state. The cover
  // must take the OS focus (a focusable cover shown focused, like a real
  // window covering the app) and overlap past the frame edges: the foreground
  // window is exempt from occlusion throttling and pixel-exact bounds can
  // leave an uncovered seam, so a cover that never takes focus never engages
  // the tracker and the probe would keep painting behind it.
  const cover = new BrowserWindow({
    x: bounds.x - 40,
    y: bounds.y - 40,
    width: bounds.width + 80,
    height: bounds.height + 80,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#12233a",
  });
  await cover.loadURL("data:text/html,<title>occluder</title><body style=\"background:#12233a\"></body>");
  cover.show();
  cover.moveTop();
  // Windows' foreground lock denies SetForegroundWindow to a background
  // process, so a plain cover.focus() can be a no-op; the tracker exempts the
  // foreground window and the probe would then keep painting behind the cover
  // forever (seen live: 60fps rAF under a fully covering always-on-top window).
  // app.focus({ steal: true }) is the sanctioned foreground grab.
  app.focus({ steal: true });
  cover.focus();

  // Occlusion can arrive as document.hidden (native occlusion tracking) and
  // always shows up as rAF silence; wait for either, bounded — but only trust
  // the hidden flag when the visible phase proved it reliable. The timeline
  // records what the page actually saw, so a miss is diagnosable.
  const trustHidden = report.visible.visibilitySignalReliable !== false;
  report.occlusionTimeline = [];
  const deadline = Date.now() + 15000;
  let lastTicks = -1;
  let lastChange = Date.now();
  let reasserted = 0;
  let occluded = null;
  while (Date.now() < deadline) {
    // A stray click can hand foreground (and the tracker's exemption) to the
    // probe window mid-wait; keep re-raising the cover like the visible phase
    // re-raises the probe.
    if (Date.now() - reasserted > 2000) {
      reasserted = Date.now();
      if (!cover.isDestroyed()) { cover.moveTop(); app.focus({ steal: true }); cover.focus(); }
    }
    const state = await run("return { hidden: document.hidden, visibility: document.visibilityState, ticks: window.__rafTicks|0 };");
    report.occlusionTimeline.push({ at: Date.now(), ...state });
    if ((state.hidden && trustHidden) || (state.ticks === lastTicks && Date.now() - lastChange >= 1500)) {
      occluded = { ...state, signal: state.hidden && trustHidden ? "document.hidden" : "raf-silence" };
      break;
    }
    if (state.ticks !== lastTicks) { lastTicks = state.ticks; lastChange = Date.now(); }
    await pause(200);
  }
  if (!occluded) {
    // Some desktops never engage Chromium's native occlusion tracker at all:
    // the cover is shown focused, the probe window stays visible (never
    // minimized), yet rAF keeps painting behind the cover no matter how long
    // it waits (RDP sessions and some compositors behave this way). That is
    // an environment capability, not an app regression — report it so the
    // test can skip with an explicit reason instead of failing every run,
    // and leave enough diagnostics to tell "tracker never engaged" from
    // "the cover never covered".
    report.occlusionUnsupported = {
      reason: trustHidden
        ? "cover shown focused but visibility never flipped and rAF never went silent within 15s"
        : "visibility signal already unreliable in the visible phase (hidden=true while frames flowed) and rAF never went silent under the cover within 15s",
      coverVisible: !cover.isDestroyed() && cover.isVisible(),
      windowState: { visible: window.isVisible(), minimized: window.isMinimized() },
      visibilitySignalReliable: trustHidden,
      timelineTail: report.occlusionTimeline.slice(-8),
    };
    return finish();
  }
  report.occluded = {
    detection: occluded,
    windowState: { visible: window.isVisible(), minimized: window.isMinimized() },
  };
  assert.equal(report.occluded.windowState.minimized, false, "occlusion must be coverage, not minimize");
  await pause(700);
  report.occluded.rafBefore = await run("return window.__rafTicks|0;");
  await pause(3000);
  report.occluded.rafAfter = await run("return window.__rafTicks|0;");
  report.occluded.rafGrowth = report.occluded.rafAfter - report.occluded.rafBefore;
  report.occluded.state = await run("return { hidden: document.hidden, visibility: document.visibilityState, focused: document.hasFocus() };");
  report.occluded.probeSamples = await sampleProbe();
  report.occluded.probe = bestSample(report.occluded.probeSamples);
  report.occluded.worker = await run("return window.__workerProbe();");
  report.occluded.messageChannelMs = await run("return window.__messageChannelProbe();");

  // The contract under test: rAF silent, unthrottled channel answering, and
  // the probe reporting ~0 lag instead of the 1000ms sentinel.
  assert.equal(report.occluded.rafGrowth, 0, `rAF must stay silent while occluded (growth=${report.occluded.rafGrowth})`);
  for (const [index, sample] of report.occluded.probeSamples.entries()) {
    assert.notEqual(sample.answered?.frames, true, `occluded probe sample ${index + 1}/${report.occluded.probeSamples.length} must not answer via frames: ${JSON.stringify(sample)}`);
    assert.ok(Number.isFinite(sample.answered?.workerDriftMs), `occluded probe sample ${index + 1} must answer via the unthrottled channel: ${JSON.stringify(sample)}`);
  }
  assert.ok(report.occluded.probe.lagMs < 100, `occluded probe must read ~0 lag on the cleanest of ${report.occluded.probeSamples.length} samples, got ${report.occluded.probe.lagMs}ms (sentinel would be 1000, samples=${JSON.stringify(report.occluded.probeSamples.map((sample) => sample.lagMs))})`);
  assert.equal(report.occluded.worker.constructed, true, `blob worker must still construct while occluded: ${JSON.stringify(report.occluded.worker)}`);
  assert.ok(Number.isFinite(report.occluded.messageChannelMs) && report.occluded.messageChannelMs < 200, `occluded MessageChannel round trip too slow: ${report.occluded.messageChannelMs}ms`);

  // Phase 3 — recovery: uncovering must bring rAF back, proving the silence
  // was real occlusion and not a wedged page. A stray topmost desktop window
  // can keep the region covered after the cover dies, so nudge the probe
  // window above everything if frames stay silent.
  cover.destroy();
  const recoverDeadline = Date.now() + 10000;
  const baseline = report.occluded.rafAfter;
  let recovered = null;
  let nudged = false;
  let nudgeAt = 0;
  while (Date.now() < recoverDeadline) {
    const state = await run("return { hidden: document.hidden, visibility: document.visibilityState, ticks: window.__rafTicks|0 };");
    // Frames resuming is the recovery proof; the visibility flag itself can
    // lag the native tracker, so it is recorded, not required.
    if (state.ticks > baseline + 5) { recovered = { ...state, nudged }; break; }
    if (!nudged && Date.now() - nudgeAt > 2000) { nudged = true; nudgeAt = Date.now(); window.setAlwaysOnTop(true, "screen-saver"); window.moveTop(); window.focus(); }
    await pause(200);
  }
  report.recovered = recovered;
  assert.ok(recovered, `rAF must resume after the cover is removed (nudged=${nudged}, last=${JSON.stringify(await run("return { hidden: document.hidden, ticks: window.__rafTicks|0 };"))})`);

  await finish();
}).catch(finish);
