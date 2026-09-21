"use strict";

// Live-Chromium execution of the eyes log-tail acceptance: the shipped
// renderer/boot.js poll guard and the shipped renderer/eyes.js refreshLog tick
// and visibilitychange listener are extracted from disk at runtime and run in
// a real Electron renderer (never a paraphrase), the window is hidden and
// shown exactly once — a real visibility toggle through Electron's window
// visibility, not a stubbed flag — and the eyesLog fetch calls are counted
// with timestamps: visible cadence, zero fetches while hidden, exactly one
// immediate snap-back fetch on show, then the baseline cadence with no doubled
// count (a leaked interval or listener would double it). Throttling stays at
// the production default, so the page behaves exactly like the running app:
// the hidden pause is corroborated both by the fetch counts and by the guard
// itself reporting the poll timer torn down while hidden and live again after
// show — timer throttling cannot fake that teardown.
// Run: node --test tests/eyes_toggle_electron.test.mjs

const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.MEFI_LOG_TOGGLE_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated log-toggle fixture directory is required");
const studio = path.resolve(__dirname, "..", "..");
const report = {
  electron: process.versions.electron,
  backgroundThrottling: true,
  probeIntervalMs: 300,
  consoleErrors: [],
  timeline: [],
  fetches: [],
};

app.setName("Studio Log Tail Toggle Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
// Chromium's Windows visibility tracking drives document.hidden; make sure it
// is active rather than inherited-disabled (same as the occlusion probe).
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
  else console.log("Log tail toggle fixture passed");
  process.exitCode = failure ? 1 : 0;
  app.quit();
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

const PROBE_MS = 300;

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    backgroundColor: "#101014",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // production-default throttling: document.hidden must flip on hide
    },
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => {
    const level = typeof detail === "object" ? detail.level : detail;
    const message = String(typeof detail === "object" ? detail.message : oldMessage);
    if (level === "error" || level === 3) report.consoleErrors.push(message);
  });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Probe renderer exited: ${detail.reason}`)));
  const run = (source) => contents.executeJavaScript(`(async()=>{${source}})()`, true);
  const pageState = async (label) => {
    const state = await run("return { hidden: document.hidden, fetches: window.__fetches ? window.__fetches.length : null, pollLive: window.MefiBoot ? window.MefiBoot.pollActive('eyes.log') : null };");
    state.at = Date.now();
    state.windowMinimized = !window.isDestroyed() && window.isMinimized();
    report.timeline.push({ at: state.at, label, ...state });
    return state;
  };
  const waitFor = async (predicate, deadline, what) => {
    const limit = Date.now() + deadline;
    let state = null;
    while (Date.now() < limit) {
      state = await pageState(what);
      if (predicate(state)) return state;
      await pause(100);
    }
    throw new Error(`${what}: condition never held within ${deadline}ms (last=${JSON.stringify(state)})`);
  };

  await window.loadURL("data:text/html,<title>log-tail-toggle</title><body></body>");
  window.show();
  window.focus();
  await waitFor((state) => state.hidden === false, 10000, "visible");

  // Inject the shipped boot.js verbatim: it defines window.MefiBoot on a blank page.
  const bootSource = fs.readFileSync(path.join(studio, "renderer", "boot.js"), "utf8");
  await contents.executeJavaScript(bootSource, true);
  report.mefiBootLoaded = await run("return Boolean(window.MefiBoot && window.MefiBoot.pollStart);");
  assert.ok(report.mefiBootLoaded, "shipped boot.js must define window.MefiBoot.pollStart on the probe page");

  // Extract the shipped eyes.js log tail pieces verbatim and pin the shipped cadence.
  const eyesSource = fs.readFileSync(path.join(studio, "renderer", "eyes.js"), "utf8");
  report.shippedCadenceMs = (eyesSource.match(/pollStart\("eyes\.log", refreshLog, (\d+)\)/) || [])[1];
  assert.equal(report.shippedCadenceMs, "5000", "shipped eyes.js must register the log tail at 5000ms");
  const refreshLogSource = (eyesSource.match(/async function refreshLog\(\) \{[\s\S]*?\n  \}/) || [])[0];
  assert.ok(refreshLogSource, "shipped eyes.js must contain refreshLog");
  const listenerBody = (eyesSource.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/) || [])[1];
  assert.ok(listenerBody, "shipped eyes.js must contain the log tail visibilitychange listener");

  // Wire the shipped tick and listener against a counting eyesLog stub. The
  // counting stub replaces the bridge only; every gate and fetch decision is
  // shipped code. Each fetch stamps document.hidden at call time.
  await run(`
    window.__fetches = [];
    window.mefiStudio = { eyesLog: async () => {
      window.__fetches.push({ at: Date.now(), hidden: document.hidden });
      return { ok: true, text: "tail line " + window.__fetches.length };
    } };
    const state = { mode: "log" };
    const els = { tab: { hidden: false }, log: { textContent: "", scrollTop: 0, scrollHeight: 0 } };
    window.__elsLog = els.log;
    ${refreshLogSource}
    document.addEventListener("visibilitychange", () => { ${listenerBody} });
    window.MefiBoot.pollStart("eyes.log", refreshLog, ${PROBE_MS});
    return window.MefiBoot.pollActive("eyes.log");
  `);
  assert.ok(await run("return window.MefiBoot.pollActive('eyes.log')"), "the log tail poll must be live after registration");

  // Phase 1 — visible baseline: the cadence fetches once per interval.
  const baselineStart = await pageState("baseline-start");
  await pause(1100);
  const baselineEnd = await pageState("baseline-end");
  report.baseline = {
    start: baselineStart.fetches,
    end: baselineEnd.fetches,
    fetches: baselineEnd.fetches - baselineStart.fetches,
    spanMs: baselineEnd.at - baselineStart.at,
  };
  assert.ok(report.baseline.fetches >= 2, `visible cadence must fetch at least twice over ~1.1s at ${PROBE_MS}ms (got ${report.baseline.fetches})`);

  // Phase 2 — the single visibility toggle: hide the window, the canonical
  // user-visible-to-invisible transition that flips document.hidden.
  // (Minimize alone does not flip visibility on this Electron build without
  // native occlusion tracking reporting it, so hide/show is the deterministic
  // real toggle; window.hide() is exactly how the app's own renderer-recovery
  // path makes a window invisible.)
  const beforeHide = (await pageState("pre-hide")).fetches;
  window.hide();
  await waitFor((state) => state.hidden === true, 5000, "hidden-after-hide");
  report.hiddenState = await pageState("hidden");
  assert.equal(report.hiddenState.windowMinimized, false, "the window must be hidden, not minimized");
  assert.equal(report.hiddenState.pollLive, false, "the guard must tear the poll interval down while hidden — throttling cannot fake this");
  await pause(1200); // four probe intervals' worth of hidden time
  const hiddenStill = await pageState("hidden-still");
  assert.equal(hiddenStill.pollLive, false, "the poll must stay torn down for the whole hidden stretch");
  const afterHide = hiddenStill.fetches;
  report.hidden = { before: beforeHide, after: afterHide, fetches: afterHide - beforeHide, spanMs: 1200 };
  assert.equal(report.hidden.fetches, 0, `a hidden window must fetch nothing across ${report.hidden.spanMs}ms (got ${report.hidden.fetches})`);

  // Phase 3 — show: the shipped listener snaps exactly one immediate fetch.
  // The snap is measured from the fetch log's timestamps, not a wall-clock
  // window: the guard restarts its interval inside the same visibilitychange
  // dispatch, so its first tick lands PROBE_MS after show — under a busy
  // machine a count sampled after that tick would mistake it for a second
  // snap. A genuine duplicate (a double-registered listener) stamps a second
  // fetch within milliseconds of the snap and still fails here.
  window.show();
  await waitFor((state) => state.hidden === false, 5000, "visible-after-show");
  await waitFor((state) => (state.fetches ?? 0) > afterHide, 5000, "resume-snap-landed");
  const shownState = await pageState("resume-snap");
  assert.equal(shownState.pollLive, true, "the guard must hold exactly one live interval again after show");
  const fetchLog = await run("return window.__fetches;");
  const snap = fetchLog[afterHide]; // the first post-show fetch is the event-driven snap
  const bunched = fetchLog.filter((fetch, index) => index > afterHide && fetch.at - snap.at < PROBE_MS / 2);
  const afterResume = fetchLog.length;
  report.resume = { before: afterHide, after: afterResume, immediateFetches: 1 + bunched.length, snapGapMs: bunched.length ? Math.min(...bunched.map((fetch) => fetch.at - snap.at)) : null };
  assert.equal(report.resume.immediateFetches, 1, `show must snap exactly one immediate refresh (got ${report.resume.immediateFetches})`);

  // Phase 4 — resumed cadence: baseline rate, never doubled. A leaked second
  // interval or a double-registered listener would roughly double this count.
  await pause(1200);
  const finalState = await pageState("resumed-cadence");
  report.resumedCadence = {
    start: afterResume,
    end: finalState.fetches,
    fetches: finalState.fetches - afterResume,
    spanMs: 1200,
  };
  assert.ok(report.resumedCadence.fetches >= 3, `the resumed cadence must tick ~once per ${PROBE_MS}ms (got ${report.resumedCadence.fetches} over ${report.resumedCadence.spanMs}ms)`);
  assert.ok(report.resumedCadence.fetches <= 6, `the resumed cadence must not be doubled by a leaked interval or listener (got ${report.resumedCadence.fetches}, baseline rate would be ~4)`);
  assert.ok(await run("return window.MefiBoot.pollActive('eyes.log');"), "exactly one live poll remains registered after the toggle");

  // Every recorded fetch happened while visible — none slipped through hidden.
  report.fetches = await run("return window.__fetches;");
  const hiddenFetches = report.fetches.filter((fetch) => fetch.hidden);
  assert.deepEqual(hiddenFetches, [], `no fetch may be stamped while hidden (got ${JSON.stringify(hiddenFetches)})`);
  const times = report.fetches.map((fetch) => fetch.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "fetch timestamps must be monotonic");
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  report.fetchGapMs = { min: Math.min(...gaps), max: Math.max(...gaps) };
  // The duplicate signature is a near-zero gap: two fetches a few ms apart
  // mean a double-registered listener. The snap-back fetch and the first
  // interval tick legitimately sit up to about one interval apart on show.
  assert.ok(report.fetchGapMs.min >= PROBE_MS / 2, `fetches must never bunch (min gap ${report.fetchGapMs.min}ms at ${PROBE_MS}ms cadence)`);

  await finish();
}).catch(finish);
