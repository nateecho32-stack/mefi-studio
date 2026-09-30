"use strict";

// Public YouTube data only: never execute page scripts or expose their markup
// to the UI. A search, a video's "more like this" list, and the next page of
// either come back as plain ids and strings, with an opaque token for the
// page after. Tokens are only ever the ones this module handed out.
const PAGE_LIMIT = 4_000_000;
const PAGE_RESULTS = 40;
const ORIGIN = "https://www.youtube.com";

function initialData(html) {
  const match = /(?:var\s+)?ytInitialData\s*=\s*(\{[^\n]*?\});?\s*<\/script>/.exec(html);
  let data;
  if (match) { try { data = JSON.parse(match[1]); } catch {} }
  if (!data) {
    const escaped = /(?:var\s+)?ytInitialData\s*=\s*'((?:\\.|[^'\\])*)'/.exec(html);
    if (escaped) {
      try { data = JSON.parse(escaped[1].replace(/\\x([\da-f]{2})|\\u([\da-f]{4})|\\([\\'"/])/gi, (_all, hex, unicode, literal) => literal || String.fromCharCode(parseInt(hex || unicode, 16)))); } catch {}
    }
  }
  return data || null;
}
const label = value => String(value?.simpleText || value?.content || value?.runs?.map(run => run.text || "").join("") || "").slice(0, 240);
// A "lockup" is the newer card YouTube uses for related videos.
function lockupVideo(lockup) {
  if (!/^[\w-]{11}$/.test(lockup?.contentId || "") || (lockup.contentType && lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")) return null;
  const meta = lockup.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
  let duration = "";
  const stack = [lockup.contentImage];
  for (let visited = 0; stack.length && !duration && visited < 400; visited++) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (typeof value.thumbnailBadgeViewModel?.text === "string") duration = value.thumbnailBadgeViewModel.text;
    for (const child of Object.values(value)) if (child && typeof child === "object") stack.push(child);
  }
  return { id: lockup.contentId, title: label(meta?.title), channel: label(rows[0]?.metadataParts?.[0]?.text), duration: /^\d{1,2}(?::\d{2}){1,2}$/.test(duration) ? duration : "" };
}
// Every video card, and the next page's token, in a parsed page or answer.
function collect(data, skip = null) {
  const results = [], seen = new Set(skip ? [skip] : []);
  let more = null;
  const stack = data ? [data] : [];
  let visited = 0;
  // Past the result cap the walk goes on, for the next page's token.
  while (stack.length && visited++ < 120000) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    const video = value.videoRenderer || value.compactVideoRenderer;
    let found = null;
    if (video && /^[\w-]{11}$/.test(video.videoId)) found = { id: video.videoId, title: label(video.title), channel: label(video.ownerText || video.longBylineText || video.shortBylineText), duration: label(video.lengthText) };
    else if (value.lockupViewModel) found = lockupVideo(value.lockupViewModel);
    if (found?.title && !seen.has(found.id) && results.length < PAGE_RESULTS) { seen.add(found.id); results.push({ ...found, url: `${ORIGIN}/watch?v=${found.id}` }); }
    const token = value.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && /^[\w%=-]{8,4096}$/.test(token)) more = token;
    const children = Object.values(value);
    for (let i = children.length - 1; i >= 0; i--) if (children[i] && typeof children[i] === "object") stack.push(children[i]);
  }
  return { results, more };
}
function searchResults(html) { return collect(initialData(html)).results.slice(0, 20); }

function createYouTubeExplorer(getWindow, fetchPage = globalThis.fetch) {
  // The request in flight: a newer one replaces it rather than waiting.
  let running = null;
  // Page tokens handed out, newest last: { endpoint, version }.
  const issued = new Map();
  const remember = (token, endpoint, version) => {
    if (!token) return null;
    issued.set(token, { endpoint, version });
    while (issued.size > 24) issued.delete(issued.keys().next().value);
    return token;
  };
  async function read(response) {
    if (!response.ok) throw new Error("YouTube unavailable");
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > PAGE_LIMIT) throw new Error("Response too large"); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks).toString("utf8");
  }
  const headers = { "Accept-Language": "en-US,en;q=0.9" };
  // request: a search (a string), { related: videoId } or { more: token }.
  return async (event, request) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: "Search is unavailable here." };
    const ask = typeof request === "string" ? { query: request } : request && typeof request === "object" && !Array.isArray(request) ? request : {};
    let task;
    if (typeof ask.more === "string") {
      const known = issued.get(ask.more);
      if (!known) return { ok: false, error: "That list has no more videos." };
      task = { kind: "more", token: ask.more, ...known };
    } else if (typeof ask.related === "string") {
      if (!/^[\w-]{11}$/.test(ask.related)) return { ok: false, error: "That is not a YouTube video." };
      task = { kind: "related", id: ask.related };
    } else if (typeof ask.query === "string" && ask.query.trim() && ask.query.length <= 160) task = { kind: "search", query: ask.query.trim() };
    else return { ok: false, error: "Enter a search up to 160 characters." };
    running?.abort();
    const controller = new AbortController();
    running = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    try {
      let page, endpoint, version;
      if (task.kind === "more") {
        const response = await fetchPage(`${ORIGIN}/youtubei/v1/${task.endpoint}?prettyPrint=false`, { method: "POST", signal, redirect: "error",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: task.version || "2.20250101.00.00", hl: "en", gl: "US" } }, continuation: task.token }) });
        page = collect(JSON.parse(await read(response)));
        ({ endpoint, version } = task);
      } else {
        const url = task.kind === "search" ? `${ORIGIN}/results?search_query=${encodeURIComponent(task.query)}` : `${ORIGIN}/watch?v=${task.id}`;
        const html = await read(await fetchPage(url, { signal, redirect: "error", headers }));
        const data = initialData(html);
        // A watch page also pages its comments: read only the side column.
        page = task.kind === "related" ? collect(data?.contents?.twoColumnWatchNextResults?.secondaryResults ?? data, task.id) : collect(data);
        endpoint = task.kind === "search" ? "search" : "next";
        version = /"INNERTUBE_CLIENT_VERSION":"([\w.-]{1,40})"/.exec(html)?.[1] || null;
      }
      if (running !== controller) return { ok: false, error: "A newer search replaced this one." };
      const more = remember(page.more, endpoint, version);
      if (!page.results.length) return { ok: false, error: task.kind === "more" ? "That is everything YouTube offered here." : "YouTube did not return videos. Try another search, or paste a video link." };
      return { ok: true, results: page.results, more };
    } catch {
      if (running !== controller) return { ok: false, error: "A newer search replaced this one." };
      return { ok: false, error: "YouTube is unavailable right now. Try again, or paste a video link." };
    } finally { if (running === controller) running = null; }
  };
}
module.exports = { searchResults, collect, createYouTubeExplorer };
