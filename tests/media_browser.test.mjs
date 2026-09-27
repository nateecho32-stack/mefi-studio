import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { browserURL, createMediaBrowser } from "../scripts/media-browser.cjs";

test("Mini browser accepts web addresses, ports and fragments, rejecting executable and credential URLs", () => {
  assert.equal(browserURL(" example.com/live#play "), "https://example.com/live#play");
  assert.equal(browserURL("http://localhost:8000/audio"), "http://localhost:8000/audio");
  for (const raw of [null, {}, "", "some words", "javascript:alert(1)", "data:text/html,hello", "file:///C:/private", "spotify:track:abc", "https://user:pass@example.com", "https://exam\nple.com", `https://x.test/${"x".repeat(8192)}`]) assert.equal(browserURL(raw), null, String(raw));
});

function harness() {
  const windows = [], views = [], opened = [];
  class Contents extends EventEmitter {
    constructor() { super(); this.mainFrame = { url: "" }; this.url = ""; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false }; }
    isDestroyed() { return Boolean(this.destroyed); }
    setWindowOpenHandler(fn) { this.popup = fn; }
    getTitle() { return "Fixture"; } isLoading() { return false; } isAudioMuted() { return Boolean(this.muted); }
    setAudioMuted(value) { this.muted = value; }
    send() {} focus() {} stop() {}
    async loadURL(url) { this.url = url; this.mainFrame.url = url; }
    close() { this.destroyed = true; }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.contentView = { addChildView() {} }; windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); } isMinimized() { return false; }
    getContentSize() { return [800, 600]; } isAlwaysOnTop() { return Boolean(this.pinned); }
    setAlwaysOnTop(value) { this.pinned = value; } show() {} focus() {}
    async loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; }
    close() { this.destroyed = true; this.emit("closed"); }
  }
  class View { constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); } setVisible() {} setBounds(bounds) { this.bounds = bounds; } }
  const browserSession = new EventEmitter();
  browserSession.setPermissionRequestHandler = fn => { browserSession.permission = fn; };
  browserSession.setPermissionCheckHandler = fn => { browserSession.check = fn; };
  const owner = new Window();
  const service = createMediaBrowser({ root: path.resolve("."), getWindow: () => owner, electron: {
    BrowserWindow: Window, WebContentsView: View, session: { fromPartition: () => browserSession }, shell: { openExternal: async url => opened.push(url) },
  } });
  const event = contents => ({ sender: contents, senderFrame: contents.mainFrame });
  return { service, owner, windows, views, opened, event, browserSession };
}

test("Only owner and toolbar main frames can open/control the browser; remote pages have no preload", async () => {
  const h = harness();
  assert.equal((await h.service.open({ sender: {}, senderFrame: {} }, "https://example.com")).ok, false);
  assert.equal((await h.service.open(h.event(h.owner.webContents), "file:///C:/private")).ok, false);
  assert.equal(h.windows.length, 1);
  await h.service.open(h.event(h.owner.webContents), "https://example.com");
  const popup = h.windows[1], view = h.views[0], toolbar = h.event(popup.webContents);
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal((await h.service.command(h.event(view.webContents), { action: "pin" })).ok, false);
  assert.equal((await h.service.command({ ...toolbar, senderFrame: { url: toolbar.senderFrame.url } }, { action: "pin" })).ok, false);
  await h.service.command(toolbar, { action: "pin" }); assert.equal(popup.pinned, true);
  await h.service.command(toolbar, { action: "pin" }); assert.equal(popup.pinned, false);
  await h.service.command(toolbar, { action: "mute" }); assert.equal(view.webContents.muted, true);
  await h.service.command(toolbar, { action: "external" }); assert.deepEqual(h.opened, ["https://example.com/"]);
  await h.service.open(h.event(h.owner.webContents), "https://example.com/next"); assert.equal(h.windows.length, 2);
  assert.equal(view.webContents.url, "https://example.com/next");
  h.service.close(); assert.equal(view.webContents.isDestroyed(), true);
  await h.service.open(h.event(h.owner.webContents)); assert.equal(h.windows.length, 3);
});

test("Navigation, popups, downloads and device permissions stay within the isolated browser", async () => {
  const h = harness(); await h.service.open(h.event(h.owner.webContents));
  const contents = h.views[0].webContents;
  for (const name of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
    let blocked = false;
    contents.emit(name, { url: "file:///C:/private", preventDefault() { blocked = true; } });
    assert.equal(blocked, true);
  }
  assert.deepEqual(contents.popup({ url: "javascript:alert(1)" }), { action: "deny" });
  assert.equal(contents.url, "");
  assert.deepEqual(contents.popup({ url: "https://example.com/new" }), { action: "deny" });
  await Promise.resolve();
  assert.equal(contents.url, "https://example.com/new");
  let allowed; h.browserSession.permission(contents, "media", value => { allowed = value; }); assert.equal(allowed, false);
  assert.equal(h.browserSession.check(contents, "notifications"), false);
  let prevented = false; h.browserSession.emit("will-download", { preventDefault() { prevented = true; } }); assert.equal(prevented, true);
  h.service.close();
});
