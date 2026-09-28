// GPU-on performance probe for a seeded booklet (make_probe.cjs output).
//   electron.exe probe.cjs   (env PROBE_DIR=<dir holding the html files>, PLAN=<plan.json>, OUT=<result.json>)
// The window is real (hardware compositing, like the app) but placed off every
// display and never focused; native occlusion is off so it keeps drawing.
// A plan is a list of scenes: { name, page, query, setup, settleMs, measureMs, trace }.
// Never pass a URL on argv: electron.exe exits on Windows before the script runs.
const { app, BrowserWindow, screen, contentTracing, nativeImage } = require("electron");
const shots = new Map();
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const DIR = process.env.PROBE_DIR;
const PLAN = JSON.parse(fs.readFileSync(process.env.PLAN, "utf8").replace(/^﻿/, ""));
const OUT = process.env.OUT;
const LOG = OUT.replace(/\.json$/, ".log");
fs.writeFileSync(LOG, "");
const log = (...parts) => { const line = parts.map((p) => typeof p === "string" ? p : JSON.stringify(p)).join(" "); fs.appendFileSync(LOG, line + "\n"); };
const USER_DATA = path.join(path.dirname(OUT), "probe-userdata");
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
app.setPath("userData", USER_DATA);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  });
});

// Sum of this pid's 3D engine utilization, one value per second.
function gpuSampler(pid, seconds) {
  const cmd = `$ErrorActionPreference='SilentlyContinue'; $s = Get-Counter -Counter '\\GPU Engine(pid_${pid}_*engtype_3D)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds}; foreach ($x in $s) { [math]::Round((($x.CounterSamples | Measure-Object CookedValue -Sum).Sum), 2) }`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  return new Promise((resolve) => child.on("close", () => resolve(out.split(/\r?\n/).map(Number).filter((n) => Number.isFinite(n)))));
}
function cpuByType() {
  const byType = {};
  for (const m of app.getAppMetrics()) byType[m.type] = (byType[m.type] || 0) + (m.cpu.cumulativeCPUUsage || 0);
  return byType;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
// Each scene destroys its window before the next opens one.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((d) => d.bounds.x));
  const primary = screen.getPrimaryDisplay();
  log("displays", displays.map((d) => ({ b: d.bounds, s: d.scaleFactor })));
  const results = [];
  for (const scene of PLAN) {
    const width = scene.width || 1536, height = scene.height || 930;
    const win = new BrowserWindow({ x: left - width - 200, y: 40, width, height, useContentSize: true, show: false, skipTaskbar: true, focusable: false, backgroundColor: "#050507", webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false, partition: "probe-" + scene.name + "-" + Date.now(), backgroundThrottling: false } });
    win.webContents.on("console-message", (_e, level, message) => { if ((typeof level === "object" ? level.level : level) === "error" || level >= 3) log("console", scene.name, String(typeof level === "object" ? level.message : message).slice(0, 300)); });
    win.webContents.on("will-prevent-unload", (event) => event.preventDefault());
    win.showInactive();
    const run = (body) => win.webContents.executeJavaScript(`(async () => { ${body} })()`, true);
    const step = async (label, body) => {
      try { const result = await run(body); log(scene.name, label, "->", JSON.stringify(result ?? null).slice(0, 400)); return result; }
      catch (error) { log(scene.name, label, "FAILED", error?.message || error); return null; }
    };
    try {
      await win.loadURL(`${BASE}${scene.page}?${scene.query || ""}`);
      for (let i = 0; i < 90; i++) {
        const gate = await run(`document.hasFocus = () => true; const b = document.getElementById("boot-layer"); const c = document.getElementById("boot-continue");
          const gone = !b || b.hidden || getComputedStyle(b).display === "none" || getComputedStyle(b).visibility === "hidden" || Number(getComputedStyle(b).opacity) === 0;
          if (gone) return "gone";
          if (c && c.offsetParent !== null && !c.disabled) { c.click(); return "clicked"; }
          return "wait";`);
        if (gate === "gone") break;
        await wait(400);
      }
      await wait(1000);
      await step("close walkthrough", `window.MefiOnboarding?.close?.(); return true;`);
      if (scene.setup) await step("setup", scene.setup);
      await wait(scene.settleMs ?? 3000);
      const state = await step("state", `return { vibe: !!window.MefiVibe?.isActive?.(), command: !!window.MefiIdle?.isActive?.(), workspace: !!window.MefiWorkspace?.isActive?.(), sheet: document.body.dataset.sheet || null, motion: document.documentElement.dataset.motion, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight, dom: document.getElementsByTagName("*").length, anims: document.getAnimations().filter(a => a.playState === "running").length, idle: window.MefiIdle?.status?.() && { nodeStyle: window.MefiIdle.status().nodeStyle, view: window.MefiIdle.status().view } };`);
      if (scene.shot) {
        await run(`await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true;`);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(path.dirname(OUT), `${scene.shot}.png`), image.toPNG());
        const size = image.getSize(), bitmap = image.toBitmap();
        shots.set(scene.shot, { size, bitmap });
        let diff = null;
        const other = scene.compare && shots.get(scene.compare);
        if (other && other.bitmap.length === bitmap.length) {
          let changed = 0, big = 0, max = 0, sum = 0;
          const heat = Buffer.alloc(bitmap.length);
          for (let i = 0; i < bitmap.length; i += 4) {
            const d = Math.max(Math.abs(bitmap[i] - other.bitmap[i]), Math.abs(bitmap[i + 1] - other.bitmap[i + 1]), Math.abs(bitmap[i + 2] - other.bitmap[i + 2]));
            if (d > 0) changed++;
            if (d > 8) big++;
            if (d > max) max = d;
            sum += d;
            const v = Math.min(255, d * 8);
            heat[i] = v; heat[i + 1] = v; heat[i + 2] = v; heat[i + 3] = 255;
          }
          const px = bitmap.length / 4;
          diff = { against: scene.compare, changedShare: +(changed / px).toFixed(5), over8Share: +(big / px).toFixed(5), max, meanAbs: +(sum / px).toFixed(4) };
          fs.writeFileSync(path.join(path.dirname(OUT), `${scene.shot}-vs-${scene.compare}.png`), nativeImage.createFromBitmap(heat, size).toPNG());
        }
        log("SHOT", scene.shot, size, diff);
        results.push({ name: scene.name, shot: scene.shot, diff });
        if (scene.shotOnly) { win.destroy(); await wait(600); continue; }
      }
      const measureMs = scene.measureMs ?? 8000;
      const gpuPid = app.getAppMetrics().find((m) => m.type === "GPU")?.pid;
      const rendererPid = win.webContents.getOSProcessId();
      const gpuPromise = gpuPid ? gpuSampler(gpuPid, Math.max(2, Math.round(measureMs / 1000) - 1)) : Promise.resolve([]);
      await wait(1200); // Get-Counter start-up
      if (scene.trace) await contentTracing.startRecording({ included_categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "blink", "cc", "gpu", "viz", "benchmark", "v8.execute", "blink.animations", "disabled-by-default-devtools.timeline.invalidationTracking"], excluded_categories: ["*"] });
      const cpu0 = cpuByType(), rendererCpu0 = app.getAppMetrics().find((m) => m.pid === rendererPid)?.cpu.cumulativeCPUUsage ?? 0;
      await run(`window.__perf.start(); return true;`);
      if (scene.during) await step("during", scene.during);
      const t0 = Date.now();
      await wait(Math.max(0, measureMs - 1200 - (Date.now() - t0)));
      const frames = await run(`return window.__perf.stop();`);
      const cpu1 = cpuByType(), rendererCpu1 = app.getAppMetrics().find((m) => m.pid === rendererPid)?.cpu.cumulativeCPUUsage ?? 0;
      const secs = frames.seconds;
      let tracePath = null;
      if (scene.trace) tracePath = await contentTracing.stopRecording(path.join(path.dirname(OUT), `${scene.name}.trace.json`));
      const gpu = await gpuPromise;
      const cpu = Object.fromEntries(Object.keys(cpu1).map((k) => [k, +(((cpu1[k] - (cpu0[k] || 0)) / secs) * 100).toFixed(1)]));
      const result = { name: scene.name, state, frames, cpuCorePct: cpu, rendererCorePct: +(((rendererCpu1 - rendererCpu0) / secs) * 100).toFixed(1), gpu3dPct: { median: median(gpu), samples: gpu }, tracePath };
      results.push(result);
      log("RESULT", result);
    } catch (error) {
      log(scene.name, "scene failed", error?.stack || error);
      results.push({ name: scene.name, error: String(error?.message || error) });
    }
    win.destroy();
    await wait(800);
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  server.close();
  app.exit(0);
}).catch((error) => { log("fatal", error?.stack || error); app.exit(1); });
