"use strict";
const electron = require("electron");
const { app, BrowserWindow, ipcMain, webContents } = electron;
const { createMediaBrowser } = require("../../scripts/media-browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const root = process.env.MEFI_BROWSER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("Isolated fixture required");
for (const key of ["userData", "sessionData", "crashDumps"]) { const dir = path.join(root, key); fs.mkdirSync(dir); app.setPath(key, dir); }
app.disableHardwareAcceleration();
const report = {};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { const deadline = Date.now() + 20000; while (Date.now() < deadline) { if (await fn()) return; await pause(100); } throw new Error("Browser fixture timed out"); }
function finish(error) { if (error) report.failure = error.stack; fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report)); app.exit(error ? 1 : 0); }
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/second#playing" }); res.end(); return; }
    res.writeHead(200, { "Content-Type": "text/html", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" });
    res.end(`<!doctype html><title>${req.url.startsWith("/second") ? "Second" : "Fixture radio"}</title><body style="background:#1c3533;color:#d7f5e8;font:24px system-ui;padding:35px"><h1>Fixture radio</h1><p>A website that refuses embedding.</p><a href="/second">Next page</a></body>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const service = createMediaBrowser({ electron, getWindow: () => owner, root: path.resolve(__dirname, "../..") });
  ipcMain.handle("media-browser:command", service.command);
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame };
  await service.open(event);
  const popup = BrowserWindow.getAllWindows().find(win => win !== owner);
  await until(() => popup.webContents.getURL().endsWith("media-browser.html") && !popup.webContents.isLoading());
  const run = code => popup.webContents.executeJavaScript(code);
  await until(async () => await run("Boolean(window.mediaBrowser)"));
  fs.writeFileSync(path.join(root, "browser-welcome.png"), (await popup.capturePage()).toPNG());
  assert.equal((await run(`window.mediaBrowser.command('navigate', ${JSON.stringify(`${base}/first`)})`)).ok, true);
  const remote = webContents.getAllWebContents().find(contents => contents !== owner.webContents && contents !== popup.webContents);
  await until(() => remote.getURL() === `${base}/first` && !remote.isLoading());
  assert.equal(await remote.executeJavaScript("document.title"), "Fixture radio");
  assert.equal(await run("document.querySelector('.browser-welcome').hidden"), true);
  fs.writeFileSync(path.join(root, "browser-remote-page.png"), (await remote.capturePage()).toPNG());
  assert.equal(await remote.executeJavaScript("typeof window.mefiStudio + ':' + typeof window.mediaBrowser + ':' + typeof require"), "undefined:undefined:undefined");
  assert.equal((await service.command({ sender: remote, senderFrame: remote.mainFrame }, { action: "pin" })).ok, false);
  await run(`window.mediaBrowser.command('navigate', ${JSON.stringify(`${base}/redirect`)})`);
  await until(() => remote.getURL() === `${base}/second#playing` && !remote.isLoading());
  await until(async () => (await run("document.getElementById('browser-address').value")) === `${base}/second#playing`);
  await run("window.mediaBrowser.command('back')");
  await until(() => remote.getURL() === `${base}/first` && !remote.isLoading());
  await run("window.mediaBrowser.command('forward')");
  await until(() => remote.getURL() === `${base}/second#playing` && !remote.isLoading());
  report.pinEvents = [];
  popup.on("always-on-top-changed", (_event, value) => report.pinEvents.push(value));
  assert.equal((await run("window.mediaBrowser.command('pin')")).ok, true);
  await until(async () => await run("document.getElementById('browser-pin').getAttribute('aria-pressed') === 'true'"));
  assert.deepEqual(report.pinEvents, [true]);
  await run("window.mediaBrowser.command('pin')");
  await until(async () => await run("document.getElementById('browser-pin').getAttribute('aria-pressed') === 'false'"));
  // Some Windows desktops immediately clear the OS topmost flag without an
  // event; verify the toggle can still be turned off in the toolbar.
  await run("window.mediaBrowser.command('mute')"); assert.equal(remote.isAudioMuted(), true);
  assert.equal((await run("window.mediaBrowser.command('navigate', 'file:///C:/private')")).ok, false);
  await remote.executeJavaScript("window.open('/popup', '_blank'); void 0", true);
  await until(() => remote.getURL() === `${base}/popup` && !remote.isLoading());
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  for (const width of [960, 480]) {
    popup.setContentSize(width, 540); await pause(200);
    assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true);
    fs.writeFileSync(path.join(root, `browser-page-${width}.png`), (await popup.capturePage()).toPNG());
  }
  server.close();
  await run(`window.mediaBrowser.command('navigate', ${JSON.stringify(`${base}/offline`)})`);
  await until(async () => await run("document.getElementById('browser-status').dataset.error === 'true'"));
  service.close(); await until(() => remote.isDestroyed());
  await service.open(event); assert.equal(BrowserWindow.getAllWindows().length, 2);
  service.close(); owner.destroy(); report.passed = true; finish();
}).catch(finish);
