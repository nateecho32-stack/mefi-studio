"use strict";
const electron = require("electron");
const { app, BrowserWindow, ipcMain, session } = electron;
const { createMediaBrowser } = require("../../scripts/media-browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const root = process.env.MEFI_BROWSER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("Isolated fixture required");
for (const key of ["userData", "sessionData", "crashDumps"]) { const dir = path.join(root, key); fs.mkdirSync(dir); app.setPath(key, dir); }
app.disableHardwareAcceleration(); app.commandLine.appendSwitch("force-device-scale-factor", "1");
const report = { phase: "startup", loads: 0 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { const deadline = Date.now() + 12000; while (Date.now() < deadline) { if (await fn()) return; await pause(100); } throw new Error(`Browser fixture timed out: ${report.phase}`); }
let finished = false;
function finish(error) { if (finished) return; finished = true; if (error) report.failure = error.stack; fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report)); app.exit(error ? 1 : 0); }
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/second#playing" }); res.end(); return; }
    if (req.url !== "/favicon.ico") report.loads++;
    res.writeHead(200, { "Content-Type": "text/html", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" });
    res.end(`<!doctype html><title>${req.url.startsWith("/second") ? "Second" : "Fixture radio"}</title><body style="margin:0;background:#1c3533;color:#d7f5e8;font:20px system-ui;padding:25px"><h1>Fixture radio</h1><p>A website inside Studio.</p><a href="/second">Next page</a></body>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
  const owner = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: {
    preload: path.join(__dirname, "media-browser-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const service = createMediaBrowser({ electron, getWindow: () => owner });
  ipcMain.handle("media-browser:open", service.open); ipcMain.handle("media-browser:command", service.command);
  const run = code => owner.webContents.executeJavaScript(code, true);
  const capture = async (contents, name) => {
    for (let attempt = 0; ; attempt++) {
      await pause(250);
      try { fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); return; }
      catch (error) { if (attempt >= 2 || !String(error).includes("UnknownVizError")) throw error; }
    }
  };
  const click = id => run(`document.getElementById(${JSON.stringify(id)}).click()`);
  await owner.loadFile(path.join(root, "renderer/booklet.html"), { query: { capture: "1" } });
  owner.showInactive();
  await run("window.mefiStudio=window.fixtureMediaBridge; window.MefiNav.go('command'); window.MefiMusic.openAudio(); document.getElementById('music-browser-launch').click();");
  report.phase = "welcome";
  await until(async () => await run("!document.querySelector('.music-browser').hidden && !document.getElementById('media-window').hidden"));
  await until(async () => await run("(()=>{const a=document.getElementById('media-window').getBoundingClientRect(),b=document.getElementById('music-video-stage').getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.x-b.x)<1})()"));
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  const view = owner.contentView.children.find(child => child.webContents && child.webContents !== owner.webContents), remote = view.webContents;
  await capture(owner.webContents, "browser-welcome.png");
  const design = await run("(()=>{const stage=document.getElementById('music-video-stage'),queue=document.querySelector('.music-link-queue'),player=document.getElementById('media-window'),layout=document.querySelector('.music-video-layout');const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};return {stage:box(stage),queue:box(queue),player:box(player),watching:box(stage.parentElement),columns:getComputedStyle(layout).gridTemplateColumns,selected:[...document.querySelectorAll('.music-tab')].map(n=>[n.textContent,n.getAttribute('aria-selected')])}})()");
  assert.ok(design.stage.right <= design.queue.x + 1, `Video and queue must not overlap: ${JSON.stringify(design)}`);
  await run(`window.MefiMusic.playLink(${JSON.stringify(`${base}/first`)})`);
  report.phase = "page visible";
  await until(async () => {
    report.page = { url: remote.getURL(), loading: remote.isLoading(), visible: view.getVisible(), bounds: view.getBounds(), dom: await run("(()=>{const v=document.getElementById('browser-viewport'),p=document.getElementById('media-window'),r=v.getBoundingClientRect();return {hidden:document.hidden, player:p.outerHTML.slice(0,450),viewport:{x:r.x,y:r.y,width:r.width,height:r.height},top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300),notice:document.querySelector('.music-notice')?.textContent}})()") };
    return remote.getURL() === `${base}/first` && !remote.isLoading() && view.getVisible();
  }).catch(error => { error.message += ` ${JSON.stringify(report.page)}`; throw error; });
  assert.equal(await remote.executeJavaScript("document.title"), "Fixture radio");
  assert.equal(await remote.executeJavaScript("typeof window.mefiStudio + ':' + typeof require"), "undefined:undefined");
  assert.equal((await service.command({ sender: remote, senderFrame: remote.mainFrame }, { action: "mute" })).ok, false);
  const navigate = url => run(`document.getElementById('browser-address').value=${JSON.stringify(url)};document.getElementById('browser-form').requestSubmit();`);
  await navigate(`${base}/redirect`); report.phase = "history";
  await until(() => remote.getURL() === `${base}/second#playing` && !remote.isLoading());
  await until(async () => (await run("document.getElementById('browser-address').value")) === `${base}/second#playing`);
  await click("browser-back"); await until(() => remote.getURL() === `${base}/first` && !remote.isLoading());
  await click("browser-forward"); await until(() => remote.getURL() === `${base}/second#playing` && !remote.isLoading());
  await click("browser-mute"); await until(() => remote.isAudioMuted());
  await remote.executeJavaScript("window.open('/popup','_blank');void 0", true);
  await until(() => remote.getURL() === `${base}/popup` && !remote.isLoading());
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  const loads = report.loads;
  report.phase = "minimize and restore";
  await click("browser-minimize"); await until(() => !view.getVisible());
  assert.equal(remote.isDestroyed(), false);
  await run("window.MefiMusic.openAudio(); document.getElementById('music-link-show').click(); window.MefiMusic.closeAudio();");
  await until(() => view.getVisible());
  report.phase = "move";
  const before = view.getBounds();
  await run("document.getElementById('browser-move').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));");
  await until(() => view.getBounds().x < before.x);
  report.phase = "overlay";
  await run("const overlay=document.createElement('div');overlay.id='fixture-overlay';overlay.style='position:fixed;inset:0;z-index:9999;background:#222';document.body.append(overlay);");
  await until(() => !view.getVisible());
  await run("document.getElementById('fixture-overlay').remove()"); await until(() => view.getVisible());
  for (const width of [1440, 600]) {
    report.phase = `layout ${width}`; owner.setContentSize(width, 900); await pause(300);
    await until(async () => {
      const box = await run("(()=>{const b=document.getElementById('browser-viewport').getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()");
      const native = view.getBounds(); return Object.keys(native).every(key => Math.abs(native[key] - box[key]) <= 1);
    });
    assert.equal(await run("document.querySelector('.music-browser-address').scrollWidth<=document.querySelector('.music-browser-address').clientWidth"), true);
    await capture(owner.webContents, `browser-studio-${width}.png`);
    await capture(remote, `browser-website-${width}.png`);
  }
  report.phase = "zoom"; owner.webContents.setZoomFactor(1.25); await pause(300);
  await until(async () => {
    const x = await run("document.getElementById('browser-viewport').getBoundingClientRect().x"); return Math.abs(view.getBounds().x - x * 1.25) <= 1;
  });
  assert.equal(report.loads, loads, "movement, resize and hiding must preserve the page");
  await navigate("file:///C:/private");
  await until(async () => await run("document.getElementById('browser-status').dataset.error === 'true'"));
  assert.equal(remote.getURL(), `${base}/popup`);
  report.phase = "close"; await click("browser-close"); await until(() => remote.isDestroyed());
  assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(owner.isDestroyed(), false);
  await click("music-browser-launch");
  await until(() => owner.contentView.children.some(child => child.webContents && child.webContents !== owner.webContents));
  const replacement = owner.contentView.children.find(child => child.webContents && child.webContents !== owner.webContents).webContents;
  await run("window.MefiMusic.setSource('local')"); await until(() => replacement.isDestroyed());
  service.close(); owner.destroy(); server.close(); report.passed = true; finish();
}).catch(finish);
