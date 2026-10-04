"use strict";

// The hidden capture window (scripts/evidence-window.cjs) in a real Chromium.
// A local page is served on 127.0.0.1, a second local server stands for "the
// rest of the world" (another port, so another origin), and the capture takes a
// real offscreen PNG of the first. It checks what a person would rely on: the
// picture is exactly 1280 x 800 and not blank, the window never showed and had
// no Node, nothing was requested from any other origin (an image, a script and a
// fetch on the page all point there, and so does a redirect), a page that never
// answers is given up on at the limit, a non-local address opens no window, and
// no window is left. It writes report.json and the PNGs into the fixture folder.
const { app, BrowserWindow, nativeImage } = require("electron");
const http = require("node:http");
const fs = require("node:fs"), path = require("node:path");
const root = process.env.MEFI_EVIDENCE_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated evidence fixture directory is required");
const report = { errors: [], windows: [], hits: { other: [] }, results: {} };
app.setName("Evidence Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) { const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory); }
app.disableHardwareAcceleration();
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
// The capture window closes after every shot; the fixture goes on (the app's own handler decides for Studio).
app.on("window-all-closed", () => {});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

app.whenReady().then(async () => {
  // The world outside the preview: any request that reaches it is a leak.
  const other = http.createServer((request, response) => { report.hits.other.push(request.url); response.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); response.end("hi"); });
  const otherPort = await listen(other);
  // A page that never answers.
  const stuck = http.createServer(() => { /* held open on purpose */ });
  const stuckPort = await listen(stuck);
  let previewPort = 0;
  const preview = http.createServer((request, response) => {
    if (request.url === "/redirect") { response.writeHead(302, { location: `http://127.0.0.1:${otherPort}/landed` }); response.end(); return; }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const blocks = Array.from({ length: 48 }, (_, index) => `<i style="background:hsl(${(index * 37) % 360} 70% 55%)">${index}</i>`).join("");
    response.end(`<!doctype html><meta charset="utf-8"><title>Preview fixture</title>
<style>html,body{margin:0;background:#fff;font:600 28px system-ui,sans-serif;color:#123}
h1{margin:0;padding:40px;background:linear-gradient(90deg,#0a3d62,#38ada9);color:#fff;font-size:44px}
main{display:grid;grid-template-columns:repeat(8,1fr);gap:12px;padding:24px}
i{display:grid;place-items:center;height:120px;border-radius:12px;color:#fff;font-style:normal}</style>
<h1>Sprint notes</h1><main>${blocks}</main>
<img alt="" src="http://127.0.0.1:${otherPort}/tracker.png"><script src="http://127.0.0.1:${otherPort}/tracker.js"></script>
<script>fetch("http://127.0.0.1:${otherPort}/beacon").catch(() => {}); document.title = "loaded";</script>`);
  });
  previewPort = await listen(preview);
  const address = (port, suffix = "/") => `http://127.0.0.1:${port}${suffix}`;
  const allowFor = (port) => ({ host: `127.0.0.1:${port}`, secure: false, origin: address(port, "") });
  app.on("browser-window-created", (_event, window) => {
    const preferences = window.webContents.getLastWebPreferences?.() ?? {};
    report.windows.push({ visible: window.isVisible(), focusable: window.isFocusable?.(), offscreen: window.webContents.isOffscreen?.() === true, sandbox: preferences.sandbox === true, nodeIntegration: preferences.nodeIntegration === true, contextIsolation: preferences.contextIsolation === true, preload: Boolean(preferences.preload) });
  });
  const { createEvidenceWindow } = require(path.join(process.env.MEFI_STUDIO_ROOT, "scripts", "evidence-window.cjs"));
  const capture = createEvidenceWindow({ electron: require("electron"), log: () => {} }).capture;
  const summarize = (result) => (result.ok ? { ok: true, bytes: result.png.length } : { ok: false, error: result.error });

  // 1. The preview: a real picture, exactly 1280 x 800, not blank.
  const started = Date.now();
  const shot = await capture(address(previewPort), { allow: allowFor(previewPort), timeoutMs: 20000, settleMs: 400 });
  report.results.preview = { ...summarize(shot), ms: Date.now() - started };
  if (shot.ok) {
    fs.writeFileSync(path.join(root, "preview.png"), shot.png);
    const image = nativeImage.createFromBuffer(shot.png);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const colors = new Set();
    let nonWhite = 0;
    for (let at = 0; at < bitmap.length; at += 4) {
      const key = (bitmap[at] << 16) | (bitmap[at + 1] << 8) | bitmap[at + 2];
      if (key !== 0xffffff) nonWhite += 1;
      if (colors.size < 512) colors.add(key);
    }
    report.results.preview.decoded = { width: size.width, height: size.height, colors: colors.size, nonWhiteShare: Math.round((nonWhite / (bitmap.length / 4)) * 1000) / 1000 };
  }
  report.results.windowsAfterPreview = BrowserWindow.getAllWindows().length;

  // 2. A redirect to another origin is stopped: no picture, and the other origin heard nothing.
  const redirected = await capture(address(previewPort, "/redirect"), { allow: allowFor(previewPort), timeoutMs: 8000, settleMs: 200 });
  report.results.redirect = summarize(redirected);

  // 3. A page that never answers is given up on at the limit.
  const tick = Date.now();
  const never = await capture(address(stuckPort), { allow: allowFor(stuckPort), timeoutMs: 1500, settleMs: 200 });
  report.results.stuck = { ...summarize(never), ms: Date.now() - tick };

  // 4. An address that is not this PC's own opens no window at all.
  const before = report.windows.length;
  const remote = await capture("http://example.com/", { allow: { host: "example.com", secure: false, origin: "http://example.com" }, timeoutMs: 3000 });
  report.results.remote = { ...summarize(remote), windowsMade: report.windows.length - before };
  const mismatch = await capture(address(previewPort), { allow: allowFor(otherPort), timeoutMs: 3000 });
  report.results.mismatch = { ...summarize(mismatch), windowsMade: report.windows.length - before };

  report.results.windowsAtEnd = BrowserWindow.getAllWindows().length;
  finish();
}).catch(finish);
