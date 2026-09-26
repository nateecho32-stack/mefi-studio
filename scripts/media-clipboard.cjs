"use strict";

// Clipboard offers belong to the focused Studio frame. Arbitrary clipboard
// text is never returned to the renderer; it only receives a bounded web URL.
function createMediaClipboardReader(getWindow, clipboard) {
  return event => {
    const window = getWindow();
    if (!window || window.isDestroyed() || !window.isFocused() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false };
    try {
      const text = clipboard.readText().trim();
      if (!text || text.length > 8192 || /\s/.test(text)) return { ok: true, url: "" };
      const url = new URL(text);
      return { ok: true, url: /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : "" };
    } catch { return { ok: true, url: "" }; }
  };
}

module.exports = { createMediaClipboardReader };
