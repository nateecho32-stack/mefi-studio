"use strict";

function browserURL(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw.trim())) return null;
  let text = raw.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(text) || /^[\w.-]+:\d+(?:[/?#]|$)/.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Websites are child views of Studio, never new windows. Only Studio's main
// frame can control this sandboxed view; websites have no preload or Node.
function createMediaBrowser({ electron, getWindow }) {
  const { WebContentsView, session, shell } = electron;
  let current = null, browserSession = null;
  const trusted = event => {
    const owner = getWindow();
    return Boolean(owner && !owner.isDestroyed() && event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame);
  };
  const state = entry => {
    const contents = entry.view.webContents;
    return { url: entry.url, title: contents.getTitle() || "Media browser", loading: contents.isLoading(),
      back: contents.navigationHistory.canGoBack(), forward: contents.navigationHistory.canGoForward(),
      muted: contents.isAudioMuted(), error: entry.error };
  };
  const publish = entry => {
    if (current !== entry || entry.owner.isDestroyed() || entry.view.webContents.isDestroyed()) return;
    entry.owner.webContents.send("media-browser:state", state(entry));
  };
  function close() {
    const entry = current;
    if (!entry) return;
    current = null;
    entry.owner.removeListener("closed", close);
    if (!entry.owner.isDestroyed()) {
      entry.owner.webContents.removeListener("did-start-navigation", entry.onNavigate);
      entry.owner.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  }
  function navigate(entry, raw) {
    const url = browserURL(raw);
    if (!url) return { ok: false, error: "Enter an http or https web address." };
    entry.url = url; entry.error = "";
    entry.view.setVisible(entry.visible);
    void entry.view.webContents.loadURL(url).catch(error => {
      if (error.code === "ERR_ABORTED" || current !== entry || entry.url !== url) return;
      entry.error = "This page could not load. Try Reload or Open in browser."; publish(entry);
    });
    publish(entry); return { ok: true, state: state(entry) };
  }
  function create() {
    if (!browserSession) {
      browserSession = session.fromPartition("persist:mefi-media-browser");
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      browserSession.setPermissionCheckHandler(() => false);
      browserSession.on("will-download", event => {
        event.preventDefault();
        if (current) { current.error = "To download this file, use Open in browser."; publish(current); }
      });
    }
    const owner = getWindow();
    const view = new WebContentsView({ webPreferences: { session: browserSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false } });
    const entry = { owner, view, url: "", error: "", visible: false };
    current = entry;
    view.setVisible(false); owner.contentView.addChildView(view);
    owner.on("closed", close);
    entry.onNavigate = (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) close(); };
    owner.webContents.on("did-start-navigation", entry.onNavigate);
    const contents = view.webContents;
    const guard = (event, legacyURL) => {
      if (!browserURL(event.url ?? legacyURL)) { event.preventDefault(); entry.error = "This link needs another app. Use Open in browser."; publish(entry); }
    };
    for (const name of ["will-navigate", "will-redirect", "will-frame-navigate"]) contents.on(name, guard);
    contents.setWindowOpenHandler(({ url }) => {
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
    contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && (input.control || input.meta) && input.key.toLowerCase() === "l") {
        event.preventDefault(); owner.webContents.focus(); owner.webContents.send("media-browser:focus-address");
      }
    });
    return entry;
  }
  function layout(entry, payload) {
    const box = payload.bounds;
    if (!payload.visible || !box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 1 || box.height < 1) {
      entry.visible = false; entry.view.setVisible(false); return;
    }
    const [width, height] = entry.owner.getContentSize(), zoom = entry.owner.webContents.getZoomFactor();
    const x = Math.max(0, Math.min(width, Math.round(box.x * zoom)));
    const y = Math.max(0, Math.min(height, Math.round(box.y * zoom)));
    const right = Math.max(x, Math.min(width, Math.round((box.x + box.width) * zoom)));
    const bottom = Math.max(y, Math.min(height, Math.round((box.y + box.height) * zoom)));
    entry.visible = right > x && bottom > y;
    entry.view.setBounds({ x, y, width: right - x, height: bottom - y });
    entry.view.setVisible(entry.visible && Boolean(entry.url));
  }
  async function open(event, raw = "") {
    if (!trusted(event)) return { ok: false, error: "Open media from Studio." };
    if (raw !== "" && !browserURL(raw)) return { ok: false, error: "Enter an http or https web address." };
    const entry = current || create();
    return raw ? navigate(entry, raw) : { ok: true, state: state(entry) };
  }
  async function command(event, payload = {}) {
    if (!trusted(event)) return { ok: false, error: "Media browser controls are unavailable." };
    if (payload?.action === "close") { close(); return { ok: true }; }
    const entry = current;
    if (!entry) return { ok: false, error: "Open the media browser first." };
    const contents = entry.view.webContents, history = contents.navigationHistory;
    switch (payload?.action) {
      case "state": return { ok: true, state: state(entry) };
      case "layout": layout(entry, payload); return { ok: true };
      case "navigate": return navigate(entry, payload.url);
      case "back": if (history.canGoBack()) history.goBack(); break;
      case "forward": if (history.canGoForward()) history.goForward(); break;
      case "reload": if (entry.url) return navigate(entry, entry.url); break;
      case "stop": contents.stop(); break;
      case "mute": contents.setAudioMuted(!contents.isAudioMuted()); break;
      case "external": {
        const url = browserURL(entry.url);
        if (!url) return { ok: false, error: "Open a page first." };
        try { await shell.openExternal(url); } catch { return { ok: false, error: "Could not open your browser." }; }
        break;
      }
      default: return { ok: false, error: "Unknown media browser action." };
    }
    publish(entry); return { ok: true, state: state(entry) };
  }
  return { open, command, close };
}

module.exports = { browserURL, createMediaBrowser };
