"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

function browserURL(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw.trim())) return null;
  let text = raw.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Only the local toolbar has a bridge. Sites live in a separate sandboxed
// WebContentsView, with their own session and no Studio preload or IPC access.
function createMediaBrowser({ electron, getWindow, root }) {
  const { BrowserWindow, WebContentsView, session, shell } = electron;
  const page = path.join(root, "renderer", "media-browser.html");
  const pageURL = pathToFileURL(page).href;
  let current = null, browserSession = null;
  const trusted = (event, contents) => Boolean(contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame);
  const state = (entry) => {
    const contents = entry.view.webContents;
    return { url: entry.url, title: contents.getTitle() || "Media browser", loading: contents.isLoading(),
      back: contents.navigationHistory.canGoBack(), forward: contents.navigationHistory.canGoForward(),
      pinned: entry.pinned, muted: contents.isAudioMuted(), error: entry.error };
  };
  const publish = (entry) => {
    if (current !== entry || entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) return;
    entry.window.webContents.send("media-browser:state", state(entry));
  };
  function navigate(entry, raw) {
    const url = browserURL(raw);
    if (!url) return { ok: false, error: "Enter an http or https web address." };
    entry.url = url; entry.error = "";
    entry.view.setVisible(true);
    void entry.view.webContents.loadURL(url).catch(error => {
      if (error.code === "ERR_ABORTED" || current !== entry || entry.url !== url) return;
      entry.error = "This page could not load. Try Reload or Open in browser."; publish(entry);
    });
    publish(entry);
    return { ok: true };
  }
  function create() {
    if (!browserSession) {
      browserSession = session.fromPartition("persist:mefi-media-browser");
      browserSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "fullscreen"));
      browserSession.setPermissionCheckHandler((_contents, permission) => permission === "fullscreen");
      browserSession.on("will-download", event => {
        event.preventDefault();
        if (current) { current.error = "To download this file, use Open in browser."; publish(current); }
      });
    }
    const popup = new BrowserWindow({ width: 960, height: 680, minWidth: 480, minHeight: 360, show: false,
      title: "Media browser · Mefi's Studio AI+", backgroundColor: "#10191d", autoHideMenuBar: true,
      webPreferences: { preload: path.join(root, "scripts", "media-browser-preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    const view = new WebContentsView({ webPreferences: { session: browserSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false } });
    const entry = { window: popup, view, url: "", error: "", pinned: false };
    current = entry;
    popup.contentView.addChildView(view); view.setVisible(false);
    const resize = () => { const [width, height] = popup.getContentSize(); view.setBounds({ x: 0, y: 112, width, height: Math.max(0, height - 112) }); };
    resize(); popup.on("resize", resize);
    popup.on("always-on-top-changed", (_event, pinned) => { entry.pinned = pinned; publish(entry); });
    popup.on("closed", () => {
      if (current === entry) current = null;
      // Child views are not destroyed with a BrowserWindow automatically.
      if (!view.webContents.isDestroyed()) view.webContents.close();
    });
    popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    popup.webContents.on("will-navigate", event => event.preventDefault());
    popup.webContents.on("will-redirect", event => event.preventDefault());
    popup.webContents.on("did-finish-load", () => publish(entry));
    const contents = view.webContents;
    const guard = (event, legacyURL) => {
      if (!browserURL(event.url ?? legacyURL)) { event.preventDefault(); entry.error = "This link needs another app. Use Open in browser."; publish(entry); }
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    contents.on("will-frame-navigate", guard);
    contents.setWindowOpenHandler(({ url }) => {
      // Finish denying the new window before navigating the existing view.
      if (browserURL(url)) queueMicrotask(() => { if (current === entry) navigate(entry, url); });
      return { action: "deny" };
    });
    for (const name of ["did-start-loading", "did-stop-loading", "page-title-updated", "audio-state-changed"]) contents.on(name, () => publish(entry));
    const navigated = (_event, url) => { if (browserURL(url)) { entry.url = url; entry.error = ""; } publish(entry); };
    contents.on("did-navigate", navigated);
    contents.on("did-navigate-in-page", (event, url, main) => { if (main) navigated(event, url); });
    contents.on("did-fail-load", (_event, code, _description, _url, main) => {
      if (main && code !== -3) { entry.error = "This page could not load. Try Reload or Open in browser."; publish(entry); }
    });
    contents.on("render-process-gone", () => { entry.error = "The page stopped responding. Reload to try again."; publish(entry); });
    const keys = (event, input) => {
      if (input.type !== "keyDown") return;
      if ((input.control || input.meta) && input.key.toLowerCase() === "l") {
        event.preventDefault(); popup.webContents.focus(); popup.webContents.send("media-browser:focus-address");
      }
    };
    contents.on("before-input-event", keys); popup.webContents.on("before-input-event", keys);
    void popup.loadFile(page).then(() => { if (!popup.isDestroyed()) popup.show(); }).catch(() => { if (!popup.isDestroyed()) popup.close(); });
    return entry;
  }
  async function open(event, raw = "") {
    const owner = getWindow();
    if (!owner || owner.isDestroyed() || !trusted(event, owner.webContents)) return { ok: false, error: "Open media from Studio." };
    if (raw !== "" && !browserURL(raw)) return { ok: false, error: "Enter an http or https web address." };
    const entry = current || create();
    if (entry.window.isMinimized()) entry.window.restore();
    entry.window.show(); entry.window.focus();
    return raw ? navigate(entry, raw) : { ok: true };
  }
  async function command(event, payload = {}) {
    const entry = current;
    if (!entry || !trusted(event, entry.window.webContents) || event.senderFrame.url !== pageURL) return { ok: false, error: "Media browser controls are unavailable." };
    const contents = entry.view.webContents;
    const history = contents.navigationHistory;
    switch (payload?.action) {
      case "state": return { ok: true, state: state(entry) };
      case "navigate": return navigate(entry, payload.url);
      case "back": if (history.canGoBack()) history.goBack(); break;
      case "forward": if (history.canGoForward()) history.goForward(); break;
      case "reload": if (entry.url) { entry.error = ""; return navigate(entry, entry.url); } break;
      case "stop": contents.stop(); break;
      // Keep the requested/event state: on Windows the native getter can
      // report false even after Electron emits always-on-top-changed(true).
      case "pin": entry.pinned = !entry.pinned; entry.window.setAlwaysOnTop(entry.pinned); break;
      case "mute": contents.setAudioMuted(!contents.isAudioMuted()); break;
      case "external": {
        const url = browserURL(entry.url);
        if (!url) return { ok: false, error: "Open a page first." };
        try { await shell.openExternal(url); } catch { return { ok: false, error: "Could not open your browser." }; }
        break;
      }
      default: return { ok: false, error: "Unknown media browser action." };
    }
    publish(entry); return { ok: true };
  }
  const close = () => { if (current && !current.window.isDestroyed()) current.window.close(); };
  return { open, command, close };
}

module.exports = { browserURL, createMediaBrowser };
