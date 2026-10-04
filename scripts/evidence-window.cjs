"use strict";
// The hidden window behind before and after shots (docs/architecture.md
// "Attempt review"). It opens the project preview's own local address in an
// offscreen window nobody sees, waits for the page to settle, takes a PNG of
// exactly 1280 x 800 and closes the window. Electron is handed in, so this
// module has no `require("electron")` of its own and a fixture can drive it
// with the real thing (tests/fixtures/evidence-capture-electron.cjs).
//
// The window is built to be harmless:
//   - offscreen, never shown, never focused, no taskbar entry, muted;
//   - sandboxed, no Node, context isolation on, no preload, no plugins;
//   - its own in-memory session, so it shares no cookie or login with Studio
//     or the preview windows, and nothing it stores outlives the shot;
//   - only the preview's own origin (and data: / blob: pieces of the page)
//     may be requested, navigation or redirect elsewhere is stopped, pop-ups,
//     downloads and every permission are refused;
//   - one hard time limit for the whole capture; at the limit the window is
//     destroyed and there is no shot.
// A capture never throws: it answers { ok, png } or { ok: false, error }.
const rules = require("./attempt-evidence.cjs");

function createEvidenceWindow({ electron, log = () => {}, random = () => require("node:crypto").randomBytes(6).toString("hex") } = {}) {
  const { BrowserWindow, session } = electron ?? {};
  // One window at a time: a pool of runs starting together takes its shots in turn.
  let tail = Promise.resolve();

  async function one(url, { width = rules.LIMITS.width, height = rules.LIMITS.height, timeoutMs = rules.LIMITS.timeoutMs, settleMs = rules.LIMITS.settleMs, allow = null } = {}) {
    const address = rules.loopback(url);
    if (!address || !allow?.host || allow.host !== address.host) return { ok: false, error: "not a local address" };
    if (typeof BrowserWindow !== "function" || !session?.fromPartition) return { ok: false, error: "no window available" };
    let window = null;
    let partition = null;
    let timer = null;
    let over = false;
    const wait = (ms) => new Promise((resolve) => { const id = setTimeout(resolve, ms); id.unref?.(); });
    try {
      // No "persist:" prefix: an in-memory session that is gone with the window.
      partition = session.fromPartition(`mefi-evidence-${random()}`);
      partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !rules.allowRequest(details.url, allow) }));
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler(() => false);
      partition.on("will-download", (event) => event.preventDefault());
      window = new BrowserWindow({
        show: false, width, height, useContentSize: true, frame: false, skipTaskbar: true, focusable: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        backgroundColor: "#ffffff", paintWhenInitiallyHidden: true,
        webPreferences: {
          offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true,
          allowRunningInsecureContent: false, plugins: false, webviewTag: false, spellcheck: false, enableWebSQL: false, backgroundThrottling: false,
          autoplayPolicy: "user-gesture-required", session: partition,
        },
      });
      const contents = window.webContents;
      contents.setAudioMuted(true);
      try { contents.setFrameRate(10); } catch { /* an older Electron has no such call for this mode */ }
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      for (const event of ["will-navigate", "will-redirect", "will-frame-navigate"]) contents.on(event, (details, target) => {
        const to = typeof target === "string" ? target : details?.url;
        if (!rules.allowRequest(to, allow)) details?.preventDefault?.();
      });
      const limit = new Promise((resolve) => { timer = setTimeout(() => { over = true; resolve({ ok: false, error: "timed out" }); }, timeoutMs); timer.unref?.(); });
      const work = (async () => {
        await contents.loadURL(address.url);
        if (over) return { ok: false, error: "timed out" };
        // A shot is of the page, not of a scroll bar (Studio hides them everywhere too).
        await contents.insertCSS("html { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; }").catch(() => {});
        // A page says it loaded before its fonts and first paint are in: give it a moment, and ask for its fonts.
        await Promise.race([contents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true", true).catch(() => true), wait(Math.min(2000, settleMs * 2))]);
        await wait(settleMs);
        if (over) return { ok: false, error: "timed out" };
        let image = await contents.capturePage();
        const size = image.getSize();
        if (!size.width || !size.height) return { ok: false, error: "the window painted nothing" };
        if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: "best" });
        const png = image.toPNG();
        return png?.length ? { ok: true, png } : { ok: false, error: "no picture" };
      })().catch((error) => ({ ok: false, error: String(error?.message ?? error).replace(/https?:\/\/\S+/g, "<address>").slice(0, 120) }));
      return await Promise.race([work, limit]);
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 120) };
    } finally {
      clearTimeout(timer);
      try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* already gone */ }
      try { await partition?.clearStorageData?.(); await partition?.clearCache?.(); partition?.closeAllConnections?.(); } catch { /* the session goes with the window */ }
    }
  }

  function capture(url, options = {}) {
    const next = tail.then(() => one(url, options), () => one(url, options));
    tail = next.then(() => {}, () => {});
    return next.then((result) => { if (!result.ok) log(`[review] shot not taken (${String(result.error ?? "unknown").slice(0, 60)})`); return result; });
  }

  return { capture };
}

module.exports = { createEvidenceWindow };
