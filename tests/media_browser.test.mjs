import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
    getZoomFactor() { return this.zoom || 1; }
    async loadURL(url) { this.url = url; this.mainFrame.url = url; this.loads = (this.loads || 0) + 1; }
    close() { this.destroyed = true; }
  }
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new Contents(); this.children = []; this.contentView = { addChildView: view => this.children.push(view), removeChildView: view => { this.children = this.children.filter(child => child !== view); } }; windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); } isMinimized() { return false; }
    getContentSize() { return [800, 600]; } isAlwaysOnTop() { return Boolean(this.pinned); }
    setAlwaysOnTop(value) { this.pinned = value; } show() {} focus() {}
    close() { this.destroyed = true; this.emit("closed"); }
  }
  class View { constructor(options) { this.options = options; this.webContents = new Contents(); views.push(this); } setVisible(value) { this.visible = value; } setBounds(bounds) { this.bounds = bounds; } }
  const browserSession = new EventEmitter();
  browserSession.setPermissionRequestHandler = fn => { browserSession.permission = fn; };
  browserSession.setPermissionCheckHandler = fn => { browserSession.check = fn; };
  const owner = new Window();
  const service = createMediaBrowser({ getWindow: () => owner, electron: {
    BrowserWindow: class { constructor() { throw new Error("Media must stay in Studio"); } }, WebContentsView: View, session: { fromPartition: () => browserSession }, shell: { openExternal: async url => opened.push(url) },
  } });
  const event = contents => ({ sender: contents, senderFrame: contents.mainFrame });
  return { service, owner, windows, views, opened, event, browserSession };
}

test("Only Studio's main frame controls its child view; no extra window or website preload exists", async () => {
  const h = harness();
  assert.equal((await h.service.open({ sender: {}, senderFrame: {} }, "https://example.com")).ok, false);
  assert.equal((await h.service.open(h.event(h.owner.webContents), "file:///C:/private")).ok, false);
  assert.equal(h.windows.length, 1);
  await h.service.open(h.event(h.owner.webContents), "https://example.com");
  const view = h.views[0], toolbar = h.event(h.owner.webContents);
  assert.deepEqual(h.owner.children, [view]);
  assert.equal(view.visible, false, "wait for the renderer's viewport bounds");
  assert.equal(view.options.webPreferences.preload, undefined);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal((await h.service.command(h.event(view.webContents), { action: "mute" })).ok, false);
  assert.equal((await h.service.command({ ...toolbar, senderFrame: { url: toolbar.senderFrame.url } }, { action: "mute" })).ok, false);
  await h.service.command(toolbar, { action: "mute" }); assert.equal(view.webContents.muted, true);
  await h.service.command(toolbar, { action: "external" }); assert.deepEqual(h.opened, ["https://example.com/"]);
  await h.service.open(h.event(h.owner.webContents), "https://example.com/next"); assert.equal(h.windows.length, 1); assert.equal(h.views.length, 1);
  assert.equal(view.webContents.url, "https://example.com/next");
  h.service.close(); assert.equal(view.webContents.isDestroyed(), true); assert.deepEqual(h.owner.children, []);
  await h.service.open(h.event(h.owner.webContents)); assert.equal(h.windows.length, 1);
  h.owner.close(); assert.equal(h.views[1].webContents.isDestroyed(), true);
});

test("Embedded bounds follow Studio zoom, clip to its window, and hiding keeps playback alive", async () => {
  const h = harness(), event = h.event(h.owner.webContents);
  await h.service.open(event, "https://example.com");
  const view = h.views[0]; h.owner.webContents.zoom = 1.5;
  const layout = bounds => h.service.command(event, { action: "layout", visible: true, bounds });
  await layout({ x: 100, y: 80, width: 400, height: 250 });
  assert.deepEqual(view.bounds, { x: 150, y: 120, width: 600, height: 375 }); assert.equal(view.visible, true);
  await layout({ x: 500, y: 300, width: 400, height: 250 });
  assert.deepEqual(view.bounds, { x: 750, y: 450, width: 50, height: 150 });
  await h.service.command(event, { action: "layout", visible: true, bounds: { x: 100, y: 80, width: 400, height: 250 }, clip: { x: 130, y: 180, width: 370, height: 150 } });
  assert.deepEqual(view.bounds, { x: 195, y: 270, width: 555, height: 225 }, "partial clipping keeps the page inside the visible panel region");
  await h.service.command(event, { action: "layout", visible: false });
  assert.equal(view.visible, false); assert.equal(view.webContents.isDestroyed(), false);
  await layout({ x: 0, y: 0, width: 100, height: 100 });
  assert.equal(view.visible, true); assert.equal(view.webContents.loads, 1);
  await layout({ x: NaN, y: 0, width: 100, height: 100 }); assert.equal(view.visible, false);
  h.owner.webContents.emit("did-start-navigation", {}, "file:///studio", false, true);
  assert.equal(view.webContents.isDestroyed(), true); assert.deepEqual(h.owner.children, []);
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
