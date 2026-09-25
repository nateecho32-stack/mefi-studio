"use strict";
// Full renderer, isolated profile, no application host or real provider traffic.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_MEDIA_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated media fixture directory is required");
const report = { errors: [], playerLoads: 0, layouts: [] };
for (const key of ["userData", "sessionData", "crashDumps"]) { const directory = path.join(root, key); fs.mkdirSync(directory); app.setPath(key, directory); }
app.setName("Studio Media Fixture"); app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) report.failure = error.stack || String(error);
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
app.whenReady().then(async () => {
  // Answer the actual official embed URL locally. Reloads increment this
  // counter, so an unchanged iframe node alone cannot conceal playback resets.
  session.defaultSession.protocol.handle("https", request => {
    if (request.url.startsWith("https://www.youtube-nocookie.com/embed/")) {
      report.playerLoads++;
      return new Response('<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 70% 20%,#afccb2,transparent 45%),linear-gradient(165deg,#506e91 35%,#68887f 36%,#193635 70%,#142426);color:white;font:16px system-ui"><div style="text-align:center;text-shadow:0 2px 10px #000"><div style="font-size:36px">▶</div>Media preview<div style="font-size:11px;margin-top:10px">Isolated playback fixture</div></div></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Fixture blocks external requests", { status: 403 });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/");
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = code => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const rect = () => run("const r=document.getElementById('media-window').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};");
  const mouse = async (x, y, type = "mouseMove") => { contents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type !== "mouseMove" ? { button: "left", clickCount: 1 } : {}) }); await sleep(70); };
  const capture = async name => { await sleep(220); fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); };
  const layout = async () => {
    const result = await run("const r=document.getElementById('media-window').getBoundingClientRect();return {width:innerWidth,contained:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,controlsFit:[...document.querySelectorAll('.media-window-controls button')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom;})};");
    report.layouts.push(result); assert.ok(result.contained && result.controlsFit, JSON.stringify(result));
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await run("window.MefiNav.go('studio',{category:'audio'});window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:false});window.fixtureMedia=window.MefiMusic.linkElement().element;");
  await sleep(450);
  report.borderless = await run("const w=document.getElementById('media-window');return w.parentElement===document.body&&!w.hidden&&getComputedStyle(w).borderTopWidth==='0px'&&getComputedStyle(document.querySelector('.media-window-controls')).opacity==='0'&&w.contains(window.fixtureMedia);");
  assert.ok(report.borderless, "player is a borderless body surface with hidden idle controls");
  await layout(); await capture("media-window-rest.png");
  let before = await rect(); await mouse(before.x + 50, before.y + 80); await sleep(220);
  report.hover = await run("return getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1';"); assert.ok(report.hover);
  await capture("media-window-hover.png");
  const handle = await run("const r=document.getElementById('media-window-move').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};");
  await mouse(handle.x, handle.y); await mouse(handle.x, handle.y, "mouseDown"); await mouse(handle.x - 160, handle.y - 100); await mouse(handle.x - 160, handle.y - 100, "mouseUp");
  let after = await rect(); report.drag = Math.abs(after.x - (before.x - 160)) < 2 && Math.abs(after.y - (before.y - 100)) < 2; assert.ok(report.drag, JSON.stringify({ before, after }));
  before = after;
  await mouse(before.x + before.width - 5, before.y + before.height - 5); await mouse(before.x + before.width - 5, before.y + before.height - 5, "mouseDown");
  await mouse(before.x + before.width + 59, before.y + before.height + 31); await mouse(before.x + before.width + 59, before.y + before.height + 31, "mouseUp");
  after = await rect(); report.resize = Math.abs(after.width - before.width - 64) < 2 && Math.abs(after.height - before.height - 36) < 2; assert.ok(report.resize, JSON.stringify({ before, after }));
  await run("document.getElementById('media-window-minimize').click();"); report.minimize = (await rect()).height === 44;
  await run("document.getElementById('music-link-show').click();window.MefiNav.go('workspace');");
  assert.equal(await run("return window.fixtureMedia===window.MefiMusic.linkElement().element&&!document.getElementById('media-window').hidden;"), true);
  await run("window.MefiNav.go('studio',{category:'general'});document.activeElement.blur();document.documentElement.dataset.motion='on';");
  await mouse(10, 10); await sleep(1850); before = await rect();
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${before.x - 40},clientY:${before.y + 70},pointerType:'mouse'}));`);
  await sleep(260);
  after = await rect(); report.dodge = after.x !== before.x || after.y !== before.y; assert.ok(report.dodge, JSON.stringify({ before, after }));
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${after.x + after.width + 40},clientY:${after.y + 70},pointerType:'mouse'}));`);
  report.follow = JSON.stringify(await rect()) === JSON.stringify(after); assert.ok(report.follow);
  await run("document.getElementById('media-window-pin').click();document.activeElement.blur();");
  await mouse(10, 10); await sleep(2600);
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:0,clientY:0,pointerType:'mouse'}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:${after.x - 40},clientY:${after.y + 70},pointerType:'mouse'}));`);
  report.pin = JSON.stringify(await rect()) === JSON.stringify(after); assert.ok(report.pin);
  window.setSize(600, 560); await sleep(300); await layout();
  const compact = await rect(); await mouse(compact.x + 50, compact.y + 75); await capture("media-window-compact.png");
  assert.equal(await run("return window.fixtureMedia===window.MefiMusic.linkElement().element;"), true);
  assert.equal(report.playerLoads, 1);
  await run("document.getElementById('media-window-close').click();");
  report.closed = await run("return document.getElementById('media-window').hidden&&window.MefiMusic.linkElement()===null&&!window.fixtureMedia.isConnected;");
  assert.ok(report.closed); assert.deepEqual(report.errors, []);
  finish();
}).catch(finish);
