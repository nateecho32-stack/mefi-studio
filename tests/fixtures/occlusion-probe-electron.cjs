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
// explicit reason; the record carries foreground-window identity (Win32
// GetForegroundWindow plus both windows' hwnds and the page's per-sample
// hasFocus stamps) so a dead tracker is distinguishable from a failed focus
// steal, and every foreground snapshot embeds a self-describing `session`
// block (WTSGetActiveConsoleSessionId, WTSConnectState, input-desktop
// openability/lock state, GetLastInputInfo idle ms) so even a NULL-foreground
// record says what kind of desktop it was taken on; the strict occlusion
// assertions only run when real
// occlusion was actually observed (or rAF provably went silent under cover).
// Opt-in alternate strict-phase signal (MEFI_OCCLUSION_PROXY=visibility,
// default off): on occlusion-unsupported desktops hide()/show() may exercise
// the downstream occluded-phase branch, but they prove "not rendered", never
// "covered" — hide is not coverage. Proxy results are therefore reported
// under `occlusionProxy` with the signal named, and `occluded` stays reserved
// for real native occlusion; promoting the proxy to a sanctioned occlusion
// signal is a contract change still awaiting owner sign-off.
// The cover window gets the mirror-image guard: an externally closed cover
// mid-measure un-occludes the probe, rAF legitimately resumes, and the strict
// occluded-phase asserts would hard-fail on exactly the recovery behavior the
// fixture itself proves — interference, not regression. The fixture listens
// for the cover's own "closed" event (self-requested destroys are flagged so
// they never trigger), records `coverLost` diagnostics — phase, trigger,
// cover/probe state, how occlusion was detected, measured rAF growth, Win32
// foreground identity, timeline tail, and the suppressed failure verbatim —
// and exits cleanly so the test skips with an explicit reason, exactly like
// `windowLost` and `occlusionUnsupported`.
// External window destruction is handled the same way as an inert tracker:
// something outside the fixture killing the probe window mid-phase (user,
// shell, cleanup tooling) would otherwise surface as a bare "Object has been
// destroyed" throw from whatever window/webContents access ran next — only
// render-process-gone was handled. The fixture listens for the window's own
// "closed" event as a proactive signal and recognizes the destroyed-access
// error at the shared finish() exit (check-then-use guards are TOCTOU against
// external destruction), records `windowLost` diagnostics — phase, trigger,
// window/cover state, Win32 foreground identity, timeline tail — and exits
// cleanly so the test can skip with an explicit reason, exactly like
// `occlusionUnsupported`.

const { app, BrowserWindow, screen } = require("electron");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
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
let probeWindow = null;
let coverWindow = null;
let currentPhase = "startup";
let windowClosedSignal = null;
let coverClosedSignal = null;
let coverClosedPhase = null;
let coverTeardownStarted = false;

// OS-level window identity for the diagnostic records: hwnd values for our
// own windows plus who actually holds Win32 foreground at record time. This
// separates "the cover held foreground and the tracker simply never engaged"
// from "the focus steal never landed" — and, for windowLost, who held the
// desktop when the window died. GetForegroundWindow legitimately returns
// NULL on some desktops (observed live on this one), and that observation is
// itself the diagnosis, so the NULL case is reported, not treated as an
// error. Every snapshot — NULL foreground included — also carries a
// `session` block so the record is self-describing about the desktop it was
// taken on: the active console session id, the session's WTSConnectState,
// whether the input desktop is openable (locked/secure desktop) plus its
// name, and GetLastInputInfo-based idle time (a headless/unattended desktop
// reads a huge idleMs, which explains a NULL foreground at a glance).
function nativeWindowHandle(browserWindow) {
  try {
    const buffer = browserWindow.getNativeWindowHandle();
    const value = buffer.byteLength >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
    return `0x${value.toString(16)}`;
  } catch {
    return null;
  }
}
function snapshotForeground() {
  if (process.platform !== "win32") return Promise.resolve(null);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class FgProbe { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount); [DllImport(\"kernel32.dll\")] public static extern uint WTSGetActiveConsoleSessionId(); [DllImport(\"kernel32.dll\")] public static extern uint GetTickCount(); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; } [DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii); [DllImport(\"wtsapi32.dll\", SetLastError=true)] public static extern bool WTSQuerySessionInformation(IntPtr hServer, int sessionId, int infoClass, out IntPtr ppBuffer, out int pBytesReturned); [DllImport(\"wtsapi32.dll\")] public static extern void WTSFreeMemory(IntPtr pMemory); [DllImport(\"user32.dll\", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access); [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder lpInfo, int nLength, out int lpnLengthNeeded); [DllImport(\"user32.dll\", SetLastError=true)] public static extern bool CloseDesktop(IntPtr hDesktop); }'",
    "$session = [ordered]@{ consoleSessionId = [FgProbe]::WTSGetActiveConsoleSessionId() }",
    "$session.connectState = $null; $session.connectStateError = $null",
    "$wtsBuf = [IntPtr]::Zero; $wtsLen = 0",
    "if ([FgProbe]::WTSQuerySessionInformation([IntPtr]::Zero, -1, 8, [ref]$wtsBuf, [ref]$wtsLen)) { $session.connectState = [Runtime.InteropServices.Marshal]::ReadByte($wtsBuf); [void][FgProbe]::WTSFreeMemory($wtsBuf) } else { $session.connectStateError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }",
    "$connectStateNames = @{0 = 'Active'; 1 = 'Connected'; 2 = 'ConnectQuery'; 3 = 'Shadow'; 4 = 'Disconnected'; 5 = 'Idle'; 6 = 'Listen'; 7 = 'Reset'; 8 = 'Down'}",
    "$session.connectStateName = $null; if ($null -ne $session.connectState) { $session.connectStateName = $connectStateNames[[int]$session.connectState] }",
    "$session.inputDesktop = $null; $session.inputDesktopLocked = $null; $session.inputDesktopError = $null",
    "$inputDesktop = [FgProbe]::OpenInputDesktop(0, $false, 1)",
    "$session.inputDesktopLocked = ($inputDesktop -eq [IntPtr]::Zero)",
    "if ($inputDesktop -eq [IntPtr]::Zero) { $session.inputDesktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $nameSb = New-Object System.Text.StringBuilder 256; $nameLen = 0; if ([FgProbe]::GetUserObjectInformation($inputDesktop, 2, $nameSb, 256, [ref]$nameLen)) { $session.inputDesktop = $nameSb.ToString() } else { $session.inputDesktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }; [void][FgProbe]::CloseDesktop($inputDesktop) }",
    "$lii = New-Object \"FgProbe+LASTINPUTINFO\"",
    "$lii.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][FgProbe+LASTINPUTINFO])",
    "$session.idleMs = $null",
    "if ([FgProbe]::GetLastInputInfo([ref]$lii)) { $idle = [int64][FgProbe]::GetTickCount() - [int64]$lii.dwTime; if ($idle -lt 0) { $idle += 4294967296 }; $session.idleMs = $idle }",
    "$h = [FgProbe]::GetForegroundWindow()",
    "if ($h -eq [IntPtr]::Zero) { Write-Output ([ordered]@{ hwnd = '0x0'; title = $null; pid = $null; process = $null; session = $session } | ConvertTo-Json -Compress -Depth 4); exit 0 }",
    "$owner = [uint32]0",
    "[void][FgProbe]::GetWindowThreadProcessId($h, [ref]$owner)",
    "$sb = New-Object System.Text.StringBuilder 512",
    "[void][FgProbe]::GetWindowText($h, $sb, 512)",
    "$name = ''",
    "try { $name = (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch {}",
    "$obj = [ordered]@{ hwnd = ('0x{0:x}' -f $h.ToInt64()); title = $sb.ToString(); pid = $owner; process = $name; session = $session }",
    "Write-Output ($obj | ConvertTo-Json -Compress -Depth 4)",
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) return resolve({ error: String(error.message || error) });
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch (parseError) {
        resolve({ error: `unparseable snapshot ${String(stdout).slice(0, 200)}: ${parseError}` });
      }
    });
  });
}

// A probe window destroyed by something outside the fixture (user close,
// shell, cleanup tooling) surfaces wherever the next window/webContents
// access happens — executeJavaScript, isVisible, focus, any call site — as a
// bare "Object has been destroyed" throw. Recognizing it at the shared
// finish() exit covers every current and future call site and is TOCTOU-proof
// where per-call isDestroyed() checks are not; the window's own "closed"
// event is the proactive twin that fires before any access can throw.
function destroyedWindowError(error) {
  const message = String((error && error.message) || error || "");
  // The third pattern matches assertProbeAlive's destroyed branch, which can
  // beat both the native throw and the "closed" event to finish() by a tick.
  return /object has been destroyed/i.test(message)
    || /webcontents? .*(?:is|has been) destroyed/i.test(message)
    || /probe window destroyed during/i.test(message);
}
async function windowLostRecord(trigger) {
  const record = {
    reason: `probe window destroyed externally during the ${currentPhase} phase`,
    trigger: String(trigger),
    phase: currentPhase,
    windowDestroyed: probeWindow ? probeWindow.isDestroyed() : null,
    windowHandle: probeWindow && !probeWindow.isDestroyed() ? nativeWindowHandle(probeWindow) : null,
    coverDestroyed: coverWindow ? coverWindow.isDestroyed() : null,
    coverVisible: coverWindow && !coverWindow.isDestroyed() ? coverWindow.isVisible() : null,
    coverHandle: coverWindow && !coverWindow.isDestroyed() ? nativeWindowHandle(coverWindow) : null,
    timelineTail: Array.isArray(report.occlusionTimeline) ? report.occlusionTimeline.slice(-8) : null,
  };
  record.foreground = await snapshotForeground();
  return record;
}
// The cover-window twin of windowLostRecord: who held the desktop when the
// cover died, how occlusion had been detected, what rAF growth was measured
// (or that the measure never ran), and — when a strict assert had already
// fired because the dying cover un-occluded the probe — the suppressed
// failure verbatim so nothing is silently discarded.
async function coverLostRecord(trigger, suppressedFailure) {
  const record = {
    reason: `cover window destroyed externally during the ${currentPhase} phase`,
    trigger: String(trigger),
    closedDuringPhase: coverClosedPhase,
    phase: currentPhase,
    coverDestroyed: coverWindow ? coverWindow.isDestroyed() : null,
    windowDestroyed: probeWindow ? probeWindow.isDestroyed() : null,
    windowVisible: probeWindow && !probeWindow.isDestroyed() ? probeWindow.isVisible() : null,
    windowHandle: probeWindow && !probeWindow.isDestroyed() ? nativeWindowHandle(probeWindow) : null,
    occlusionDetection: report.occluded?.detection ?? null,
    measuredRafGrowth: report.occluded?.rafGrowth ?? null,
    timelineTail: Array.isArray(report.occlusionTimeline) ? report.occlusionTimeline.slice(-8) : null,
  };
  if (suppressedFailure) record.suppressedFailure = String(suppressedFailure);
  record.foreground = await snapshotForeground();
  return record;
}
async function finish(error) {
  if (finished) return;
  finished = true;
  let failure = error ? (error.stack || String(error)) : null;
  // External destruction becomes a diagnostic record + clean exit for a
  // skip, never a bare hard fail; a genuine non-destruction failure still
  // fails, and the closed-signal path only applies when nothing else did.
  if (failure && destroyedWindowError(error)) {
    report.windowLost = await windowLostRecord((error && error.message) || error);
    failure = null;
  } else if (failure && coverClosedSignal) {
    // The cover died externally mid-measure, so the probe resumed painting
    // and a strict occluded-phase assert fired on the recovery behavior the
    // fixture itself proves. Record the interference (with the suppressed
    // failure preserved verbatim) and skip; only the cover's own teardown
    // sets coverTeardownStarted, so a fixture-requested destroy never lands
    // here.
    report.coverLost = await coverLostRecord(coverClosedSignal, failure);
    failure = null;
  } else if (!failure && windowClosedSignal) {
    report.windowLost = await windowLostRecord(windowClosedSignal);
  } else if (!failure && coverClosedSignal) {
    report.coverLost = await coverLostRecord(coverClosedSignal, null);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  if (failure) report.failure = failure;
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (failure) console.error(failure);
  else if (report.windowLost) console.log(`Probe window destroyed externally (test will skip): ${report.windowLost.reason} — trigger: ${report.windowLost.trigger}`);
  else if (report.coverLost) console.log(`Cover window destroyed externally (test will skip): ${report.coverLost.reason} — trigger: ${report.coverLost.trigger}`);
  else if (report.occlusionUnsupported) console.log(`Occlusion capability absent on this desktop (test will skip): ${report.occlusionUnsupported.reason}`);
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
  probeWindow = window;
  contents.setAudioMuted(true);
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => {
    const level = typeof detail === "object" ? detail.level : detail;
    const message = String(typeof detail === "object" ? detail.message : oldMessage);
    if (level === "error" || level === 3) report.consoleErrors.push(message);
    if (/Content Security Policy|worker-src|Refused to (?:create|load)/i.test(message)) report.cspViolations.push(message);
  });
  let rendererGone = null;
  contents.on("render-process-gone", (_event, detail) => { rendererGone = detail?.reason ?? "unknown"; finish(new Error(`Probe renderer exited: ${detail.reason}`)); });
  const assertProbeAlive = (phase) => {
    if (window.isDestroyed() || contents.isDestroyed()) {
      // The render-process-gone handler can lose the race to the next
      // executeJavaScript call, which would only surface as an opaque
      // "Object has been destroyed"; name the real cause instead.
      throw new Error(rendererGone ? `Probe renderer exited during ${phase}: ${rendererGone}` : `Probe window destroyed during ${phase}`);
    }
  };
  // Proactive half of the external-destruction guard: when something outside
  // the fixture closes the probe window mid-phase, record it and exit
  // cleanly before whatever window/webContents access runs next can throw a
  // bare "Object has been destroyed". finish()'s own destroy loop sets
  // `finished` first, so self-inflicted closes never take this path.
  window.on("closed", () => {
    if (finished) return;
    windowClosedSignal = `probe window "closed" event during the ${currentPhase} phase (not requested by the fixture)`;
    finish();
  });
  const run = (source) => contents.executeJavaScript(`(async()=>{${source}})()`, true);

  // Same classification as main.cjs around the awaited probe: the renderer's
  // own frame chain gets a 50ms allowance, the unthrottled channel gets 200ms,
  // and the sentinel stands only when neither aliveness channel ever answered.
  async function runProbe() {
    const startedAt = Date.now();
    const answered = await contents.executeJavaScript(`(${probeExpression})`, true);
    const wallMs = Date.now() - startedAt;
    let lagMs;
    if (answered?.frames === true) {
      const framesMs = Number(answered.framesMs);
      lagMs = Number.isFinite(framesMs) ? Math.max(0, framesMs - 50) : Math.max(0, wallMs - 50);
    }
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

  // OS-level identity helpers live at module scope (shared by the
  // occlusionUnsupported and windowLost records); see nativeWindowHandle
  // and snapshotForeground above.

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
  currentPhase = "visible";
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
  currentPhase = "cover-wait";
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
  coverWindow = cover;
  // Proactive half of the cover interference guard, mirroring the probe
  // window's "closed" handler: when something outside the fixture closes the
  // cover mid-phase, record it and exit cleanly before the strict
  // occluded-phase asserts can fail on the resumed rAF. Only the fixture's
  // own teardown sets coverTeardownStarted, so self-inflicted destroys
  // (visibility proxy, recovery) never take this path; finish()'s destroy
  // loop sets `finished` first, covering end-of-run closes the same way.
  cover.on("closed", () => {
    if (finished || coverTeardownStarted) return;
    coverClosedSignal = `cover window "closed" event during the ${currentPhase} phase (not requested by the fixture)`;
    coverClosedPhase = currentPhase;
    finish();
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
  let reassertions = 0;
  let occluded = null;
  while (Date.now() < deadline) {
    // A stray click can hand foreground (and the tracker's exemption) to the
    // probe window mid-wait; keep re-raising the cover like the visible phase
    // re-raises the probe.
    if (Date.now() - reasserted > 2000) {
      reasserted = Date.now();
      reassertions += 1;
      if (!cover.isDestroyed()) { cover.moveTop(); app.focus({ steal: true }); cover.focus(); }
    }
    assertProbeAlive("the occlusion wait");
    const state = await run("return { hidden: document.hidden, visibility: document.visibilityState, ticks: window.__rafTicks|0, focused: document.hasFocus() };");
    report.occlusionTimeline.push({ at: Date.now(), ...state });
    if ((state.hidden && trustHidden) || (state.ticks === lastTicks && Date.now() - lastChange >= 1500)) {
      occluded = { ...state, signal: state.hidden && trustHidden ? "document.hidden" : "raf-silence" };
      break;
    }
    if (state.ticks !== lastTicks) { lastTicks = state.ticks; lastChange = Date.now(); }
    await pause(200);
  }
  // Opt-in visibility proxy for the strict phase (default off): mirrors the
  // occluded-phase measurements using hide()/show() instead of a cover. Every
  // result is namespaced under `occlusionProxy` — the phase is "not rendered",
  // not occlusion — and the report never fills `occluded` from it.
  async function runVisibilityProxy() {
    currentPhase = "visibility-proxy";
    const proxy = {
      signal: "visibility",
      contract: "hide()/show() prove not-rendered, not covered; this record never claims occlusion",
    };
    if (!cover.isDestroyed()) { coverTeardownStarted = true; cover.destroy(); }
    await pause(300);
    window.hide();
    const flipDeadline = Date.now() + 10000;
    let state = null;
    while (Date.now() < flipDeadline) {
      state = await run("return { hidden: document.hidden, visibility: document.visibilityState, ticks: window.__rafTicks|0, focused: document.hasFocus() };");
      if (state.hidden) break;
      await pause(200);
    }
    proxy.windowState = { visible: window.isVisible(), minimized: window.isMinimized() };
    proxy.hidden = state?.hidden === true;
    if (!proxy.hidden) {
      proxy.failed = `document.hidden never flipped within 10s after hide() (state=${JSON.stringify(state)})`;
      return proxy;
    }
    await pause(700);
    proxy.rafBefore = await run("return window.__rafTicks|0;");
    await pause(3000);
    proxy.rafAfter = await run("return window.__rafTicks|0;");
    proxy.rafGrowth = proxy.rafAfter - proxy.rafBefore;
    proxy.state = await run("return { hidden: document.hidden, visibility: document.visibilityState, focused: document.hasFocus() };");
    proxy.probeSamples = await sampleProbe();
    proxy.probe = bestSample(proxy.probeSamples);
    proxy.worker = await run("return window.__workerProbe();");
    proxy.messageChannelMs = await run("return window.__messageChannelProbe();");
    window.show();
    window.focus();
    const recoverDeadline = Date.now() + 10000;
    const baseline = proxy.rafAfter;
    while (Date.now() < recoverDeadline) {
      const after = await run("return { hidden: document.hidden, ticks: window.__rafTicks|0 };");
      if (after.ticks > baseline + 5) { proxy.recovered = after; break; }
      await pause(200);
    }
    return proxy;
  }
  if (!occluded) {
    // Some desktops never engage Chromium's native occlusion tracker at all:
    // the cover is shown focused, the probe window stays visible (never
    // minimized), yet rAF keeps painting behind the cover no matter how long
    // it waits (RDP sessions and some compositors behave this way). That is
    // an environment capability, not an app regression — report it so the
    // test can skip with an explicit reason instead of failing every run,
    // and leave enough diagnostics to tell "tracker never engaged" from
    // "the cover never covered": hwnd identity for both windows, who held
    // Win32 foreground at give-up time (NULL is a real observation here, not
    // an error), and whether the page itself saw focus across the wait (the
    // timeline's focused stamps) — cover-foreground + page-focus=false means
    // the tracker was simply inert; page-focus=true throughout means the
    // focus steal never landed.
    report.occlusionUnsupported = {
      reason: trustHidden
        ? "cover shown focused but visibility never flipped and rAF never went silent within 15s"
        : "visibility signal already unreliable in the visible phase (hidden=true while frames flowed) and rAF never went silent under the cover within 15s",
      coverVisible: !cover.isDestroyed() && cover.isVisible(),
      windowState: { visible: window.isVisible(), minimized: window.isMinimized() },
      visibilitySignalReliable: trustHidden,
      coverHandle: nativeWindowHandle(cover),
      probeHandle: nativeWindowHandle(window),
      foreground: await snapshotForeground(),
      reassertions,
      timelineTail: report.occlusionTimeline.slice(-8),
    };
    if (process.env.MEFI_OCCLUSION_PROXY === "visibility") {
      report.occlusionProxy = await runVisibilityProxy();
    } else {
      report.occlusionProxyDeclined = "MEFI_OCCLUSION_PROXY not set to \"visibility\"; the occluded phase is untested on this desktop (hide()/show() never satisfy the coverage contract without owner sign-off)";
    }
    return finish();
  }
  currentPhase = "occluded-measure";
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
  currentPhase = "recovery";
  coverTeardownStarted = true;
  cover.destroy();
  const recoverDeadline = Date.now() + 10000;
  const baseline = report.occluded.rafAfter;
  let recovered = null;
  let nudged = false;
  let nudgeAt = 0;
  while (Date.now() < recoverDeadline) {
    assertProbeAlive("the recovery wait");
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
