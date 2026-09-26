"use strict";

// Public search only: never execute page scripts or expose their markup to the UI.
function searchResults(html) {
  const match = /(?:var\s+)?ytInitialData\s*=\s*(\{[^\n]*?\});?\s*<\/script>/.exec(html);
  let data;
  if (match) { try { data = JSON.parse(match[1]); } catch {} }
  if (!data) {
    const escaped = /(?:var\s+)?ytInitialData\s*=\s*'((?:\\.|[^'\\])*)'/.exec(html);
    if (escaped) {
      try { data = JSON.parse(escaped[1].replace(/\\x([\da-f]{2})|\\u([\da-f]{4})|\\([\\'"/])/gi, (_all, hex, unicode, literal) => literal || String.fromCharCode(parseInt(hex || unicode, 16)))); } catch {}
    }
  }
  const results = [], seen = new Set();
  const label = value => String(value?.simpleText || value?.runs?.map(run => run.text || "").join("") || "").slice(0, 240);
  const stack = data ? [data] : [];
  let visited = 0;
  while (stack.length && results.length < 20 && visited++ < 60000) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    const video = value.videoRenderer;
    if (video && /^[\w-]{11}$/.test(video.videoId) && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      const title = label(video.title);
      if (title) results.push({ id: video.videoId, title, channel: label(video.ownerText || video.longBylineText), duration: label(video.lengthText), url: `https://www.youtube.com/watch?v=${video.videoId}` });
    }
    const children = Object.values(value);
    for (let i = children.length - 1; i >= 0; i--) if (children[i] && typeof children[i] === "object") stack.push(children[i]);
  }
  return results;
}

function createYouTubeExplorer(getWindow, fetchPage = globalThis.fetch) {
  let busy = false;
  return async (event, query) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: "Search is unavailable here." };
    if (typeof query !== "string" || !query.trim() || query.length > 160) return { ok: false, error: "Enter a search up to 160 characters." };
    if (busy) return { ok: false, error: "A search is already running." };
    busy = true;
    try {
      const response = await fetchPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`, { signal: AbortSignal.timeout(12000), redirect: "error", headers: { "Accept-Language": "en-US,en;q=0.9" } });
      if (!response.ok) throw new Error("Search unavailable");
      const reader = response.body.getReader();
      const chunks = []; let length = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 4_000_000) throw new Error("Search response too large"); chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel().catch(() => {}); }
      const results = searchResults(Buffer.concat(chunks).toString("utf8"));
      return results.length ? { ok: true, results } : { ok: false, error: "YouTube did not return videos. Try another search, or paste a video link above." };
    } catch { return { ok: false, error: "YouTube search is unavailable. Try again, or paste a video link above." }; }
    finally { busy = false; }
  };
}
module.exports = { searchResults, createYouTubeExplorer };
