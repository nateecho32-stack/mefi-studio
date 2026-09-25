// Mefi's Studio AI+ — the client for the Void Engine rooms hub.
//
// The hub is the "void-hub" half of the Void Engine Bot repository, and its
// docs/protocol.md is the contract this file follows: Studio trades the
// member's Discord access token (from the community link, which main.cjs
// holds) for a 15-minute hub session, opens one WebSocket, and speaks JSON
// frames on it. Studio uses two things from it today:
//
//   - Listen together: a room's shared player. `subscribe` a room and the hub
//     answers with its `listen` session (or null); `listen` frames start,
//     pause, resume, seek and stop it, and every change comes back to every
//     subscriber as a `listen` frame.
//   - Now playing: with the member's say-so, `nowPlaying` tells the hub what
//     Studio is playing, so the bot's /nowplaying can show it on Discord.
//
// Like scripts/discord-oauth.cjs this is a network module, and everything it
// reaches for is injected: fetch, the WebSocket class, the clock and the
// timers, and getAccessToken (the host's, which refreshes the Discord grant
// when it has to). No function here throws. Tokens and hub sessions never
// leave this module except in the requests that need them, and are never
// logged. The renderer only ever sees status(), rooms and the frames' public
// fields.

"use strict";

const PROTOCOL_VERSION = 1;
// The hub's public address. It is filled once the hub has one; until then the
// feature reports "not configured". MEFI_STUDIO_HUB_URL wins, so a maintainer
// can point a build at a test hub (http is accepted only on loopback).
const HUB_URL = "";
const SESSION_MARGIN_MS = 60_000;
const PRESENCE_EVERY_MS = 30_000;
const ACK_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000, 60_000]);
// What a listen session may carry: the Links player's embeds and plain files.
const LISTEN_PROVIDERS = Object.freeze(["youtube", "spotify", "soundcloud", "vimeo", "discord", "file"]);
// What /nowplaying may show: the same, plus a radio station or local music.
const NOW_PLAYING_PROVIDERS = Object.freeze([...LISTEN_PROVIDERS, "radio", "local"]);
const LISTEN_ACTIONS = Object.freeze(["start", "play", "pause", "seek", "stop"]);
const MAX_POSITION_MS = 86_400_000;
const STATES = Object.freeze(["off", "connecting", "ready", "offline", "error"]);

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SNOWFLAKE = /^\d{17,20}$/;
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/;

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const line = (value, max) => (typeof value === "string" && value.trim() && value.length <= max && ONE_LINE.test(value) ? value : null);
const count = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);

// The hub's address as its two schemes, or null. https anywhere; http only on
// 127.0.0.1 or localhost (a hub run on this machine). No path, query,
// credentials or fragment.
function hubAddress(raw) {
  let url;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  const http = `${url.protocol}//${url.host}`;
  return { http, ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/v1/ws` };
}

function configuredUrl(env = process.env) {
  return String(env?.MEFI_STUDIO_HUB_URL || HUB_URL || "").trim();
}

// A link a session may carry: https, at most 2048 characters, no credentials.
function listenUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function user(value) {
  if (!object(value) || !SNOWFLAKE.test(String(value.id))) return null;
  return { id: String(value.id), name: typeof value.name === "string" ? value.name.slice(0, 100) : "" };
}

// A hub `listen` session as Studio uses it, or null when it is not one.
function listenSession(value) {
  if (!object(value)) return null;
  const url = listenUrl(value.url);
  const label = line(value.label, 120);
  const host = user(value.host);
  const positionMs = count(value.positionMs, MAX_POSITION_MS);
  if (!OPAQUE_ID.test(String(value.id)) || !url || !label || !host || positionMs == null) return null;
  if (!LISTEN_PROVIDERS.includes(value.provider) || typeof value.playing !== "boolean") return null;
  if (!Number.isFinite(value.updatedAt) || !Number.isFinite(value.startedAt)) return null;
  // `title` is the hub's own lookup (oEmbed) and may arrive a moment later.
  const title = value.title == null ? null : line(value.title, 200);
  return { id: value.id, url, label, title, provider: value.provider, host, playing: value.playing, positionMs, startedAt: value.startedAt, updatedAt: value.updatedAt };
}

function roomSummary(value) {
  if (!object(value) || !OPAQUE_ID.test(String(value.id)) || !line(value.name, 80)) return null;
  return {
    id: value.id, name: value.name, kind: value.kind === "cowork" ? "cowork" : "hangout",
    status: ["active", "locked", "closed"].includes(value.status) ? value.status : "active",
    you: typeof value.you === "string" ? value.you : "none",
    ownerId: SNOWFLAKE.test(String(value.ownerId)) ? String(value.ownerId) : null,
    memberCount: count(value.memberCount, 1000) ?? 0,
  };
}

// What Studio tells /nowplaying: a label, and a link when there is one.
function nowPlayingTrack(value) {
  if (value == null) return null;
  if (!object(value)) return null;
  const label = line(value.label, 120);
  if (!label || !NOW_PLAYING_PROVIDERS.includes(value.provider)) return null;
  const url = value.url == null ? null : listenUrl(value.url);
  if (value.url != null && !url) return null;
  return { label, provider: value.provider, ...(url ? { url } : {}) };
}

function createHubClient(options = {}) {
  const {
    url = configuredUrl(),
    getAccessToken = async () => ({ ok: false, error: "auth" }),
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: SocketImpl = globalThis.WebSocket,
    now = () => Date.now(),
    setTimeout: later = globalThis.setTimeout,
    clearTimeout: cancel = globalThis.clearTimeout,
    setInterval: every = globalThis.setInterval,
    clearInterval: stopEvery = globalThis.clearInterval,
    onEvent = () => {},
    log = () => {},
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = options;
  const address = hubAddress(url);
  let state = "off";
  let error = null;
  let wanted = false;
  let session = null; // { token, expiresAt, user, readOnly }
  let socket = null;
  let generation = 0;
  let backoff = 0;
  let retryTimer = null;
  let renewTimer = null;
  let presenceTimer = null;
  let paused = false;
  let nonceSeq = 0;
  let nowPlaying = null;
  let opening = null;
  const rooms = new Set();
  const pending = new Map(); // nonce -> { resolve, timer }

  const emit = (event) => { try { onEvent(event); } catch {} };
  function status() {
    return {
      configured: Boolean(address), state, error,
      user: session?.user ?? null, readOnly: Boolean(session?.readOnly), paused,
      rooms: [...rooms],
    };
  }
  function setState(next, nextError = null) {
    if (!STATES.includes(next)) return;
    if (state === next && error === nextError) return;
    state = next; error = nextError;
    emit({ type: "status", status: status() });
  }
  const clearTimer = (timer) => { if (timer) cancel(timer); return null; };

  async function request(method, path, body, token) {
    if (!address || typeof fetchImpl !== "function") return { ok: false, error: "not-configured" };
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = later(() => controller?.abort(), requestTimeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(`${address.http}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller?.signal });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.ok && object(data) && data.ok !== false) return { ok: true, status: res.status, data };
      const code = object(data) && typeof data.error === "string" ? data.error : res.status === 401 ? "unauthorized" : "failed";
      return { ok: false, status: res.status, error: code, reason: object(data) && typeof data.reason === "string" ? data.reason : undefined, retryAfter: object(data) && Number.isFinite(data.retryAfter) ? data.retryAfter : undefined };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      cancel(timer);
    }
  }

  // Trades the Discord access token for a hub session. The Discord token is
  // sent once per session and dropped; the hub never keeps it either.
  async function openSession() {
    let grant;
    try { grant = await getAccessToken(); } catch { grant = null; }
    if (!grant?.ok || typeof grant.token !== "string" || !grant.token) return { ok: false, error: grant?.error === "not-configured" ? "not-linked" : grant?.error || "not-linked" };
    const answer = await request("POST", "/v1/session", { accessToken: grant.token });
    if (!answer.ok) return { ok: false, error: answer.status === 401 ? "auth" : answer.error === "not-member" || answer.status === 403 ? "not-member" : answer.error === "rate-limited" ? "rate-limited" : "network", retryAfter: answer.retryAfter };
    const data = answer.data;
    const who = user(data.user);
    if (typeof data.session !== "string" || !data.session || !Number.isFinite(data.expiresAt) || !who) return { ok: false, error: "network" };
    return { ok: true, session: { token: data.session, expiresAt: data.expiresAt, user: who, readOnly: data.readOnly === true } };
  }

  function scheduleRenew() {
    renewTimer = clearTimer(renewTimer);
    if (!session) return;
    const wait = Math.max(5_000, session.expiresAt - now() - SESSION_MARGIN_MS);
    renewTimer = later(() => { renewTimer = null; void renew(); }, wait);
  }
  async function renew() {
    const mine = generation;
    const fresh = await openSession();
    if (mine !== generation || !wanted) return;
    if (!fresh.ok) {
      if (fresh.error === "auth" || fresh.error === "not-member" || fresh.error === "not-linked") { drop(); setState("error", fresh.error); return; }
      renewTimer = later(() => { renewTimer = null; void renew(); }, 30_000);
      return;
    }
    session = fresh.session;
    send({ type: "renew", session: session.token });
    scheduleRenew();
  }

  function send(frame) {
    if (!socket || socket.readyState !== 1) return false;
    try { socket.send(JSON.stringify(frame)); return true; } catch { return false; }
  }

  function settleAll(reason) {
    for (const [nonce, entry] of pending) { cancel(entry.timer); entry.resolve({ ok: false, reason }); pending.delete(nonce); }
  }

  function drop() {
    generation += 1;
    retryTimer = clearTimer(retryTimer);
    renewTimer = clearTimer(renewTimer);
    if (presenceTimer) { stopEvery(presenceTimer); presenceTimer = null; }
    settleAll("offline");
    const closing = socket;
    socket = null;
    if (closing) { try { closing.close(1000, "bye"); } catch {} }
  }

  function retry(delay) {
    retryTimer = clearTimer(retryTimer);
    if (!wanted) return;
    const wait = Number.isFinite(delay) ? delay : BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
    backoff += 1;
    retryTimer = later(() => { retryTimer = null; void open(); }, wait);
  }

  async function open() {
    if (!wanted || opening) return opening;
    opening = (async () => {
      drop();
      const mine = generation;
      if (!address) { setState("error", "not-configured"); return; }
      if (typeof SocketImpl !== "function") { setState("error", "unsupported"); return; }
      setState(state === "ready" ? "offline" : "connecting");
      if (!session || session.expiresAt - now() < SESSION_MARGIN_MS) {
        const fresh = await openSession();
        if (mine !== generation || !wanted) return;
        if (!fresh.ok) {
          session = null;
          if (fresh.error === "network" || fresh.error === "rate-limited") { setState("offline", fresh.error); retry(fresh.retryAfter); }
          else setState("error", fresh.error);
          return;
        }
        session = fresh.session;
      }
      let ws;
      try { ws = new SocketImpl(address.ws); } catch { setState("offline", "network"); retry(); return; }
      socket = ws;
      ws.onopen = () => { if (socket === ws) send({ type: "hello", session: session.token, protocol: PROTOCOL_VERSION }); };
      ws.onmessage = (event) => { if (socket === ws) receive(event?.data); };
      ws.onerror = () => {};
      ws.onclose = (event) => { if (socket === ws) closed(Number(event?.code) || 1006); };
    })();
    try { await opening; } finally { opening = null; }
  }

  function closed(code) {
    socket = null;
    if (presenceTimer) { stopEvery(presenceTimer); presenceTimer = null; }
    renewTimer = clearTimer(renewTimer);
    settleAll("offline");
    if (!wanted) { setState("off"); return; }
    log(`[hub] socket closed ${code}`);
    if (code === 4001 || code === 4005) { session = null; setState("offline", "session"); retry(backoff ? undefined : 0); return; }
    if (code === 4002) { setState("error", "version"); return; }
    if (code === 4004) { setState("offline", "too-many-sockets"); retry(60_000); return; }
    setState("offline", "network");
    retry();
  }

  function receive(data) {
    let frame;
    try { frame = JSON.parse(typeof data === "string" ? data : String(data)); } catch { return; }
    if (!object(frame) || typeof frame.type !== "string") return;
    switch (frame.type) {
      case "ready": {
        backoff = 0;
        const who = user(frame.user);
        if (who && session) session.user = who;
        if (session) session.readOnly = frame.readOnly === true;
        paused = frame.paused === true;
        setState("ready");
        emit({ type: "status", status: status() });
        for (const roomId of rooms) { send({ type: "subscribe", roomId }); send({ type: "presence", roomId }); }
        // The hub forgets a share when the member's last socket closes.
        if (nowPlaying) sendNowPlaying();
        if (presenceTimer) stopEvery(presenceTimer);
        presenceTimer = every(() => { for (const roomId of rooms) send({ type: "presence", roomId }); }, PRESENCE_EVERY_MS);
        scheduleRenew();
        return;
      }
      case "listen": {
        if (!OPAQUE_ID.test(String(frame.roomId))) return;
        const current = frame.session == null ? null : listenSession(frame.session);
        if (frame.session != null && !current) return;
        emit({ type: "listen", roomId: frame.roomId, session: current, sentAt: Number.isFinite(frame.sentAt) ? frame.sentAt : null, receivedAt: now() });
        return;
      }
      case "presence":
        if (OPAQUE_ID.test(String(frame.roomId)) && Array.isArray(frame.inStudio)) emit({ type: "presence", roomId: frame.roomId, inStudio: frame.inStudio.filter((id) => SNOWFLAKE.test(String(id))).slice(0, 100) });
        return;
      case "room": {
        const room = roomSummary(frame.room);
        if (room) emit({ type: "room", room });
        return;
      }
      case "membership":
        if (OPAQUE_ID.test(String(frame.roomId)) && ["joined", "left", "removed", "closed"].includes(frame.state)) emit({ type: "membership", roomId: frame.roomId, userId: String(frame.userId ?? ""), state: frame.state });
        return;
      case "hubState":
        paused = frame.paused === true;
        emit({ type: "status", status: status() });
        return;
      case "ack":
      case "nack": {
        const entry = pending.get(frame.nonce);
        if (!entry) return;
        pending.delete(frame.nonce);
        cancel(entry.timer);
        entry.resolve(frame.type === "ack" ? { ok: true } : { ok: false, reason: typeof frame.reason === "string" ? frame.reason : "failed", retryAfter: Number.isFinite(frame.retryAfter) ? frame.retryAfter : undefined });
        return;
      }
      case "error":
        emit({ type: "hubError", code: typeof frame.code === "string" ? frame.code : "unknown" });
        return;
      default:
    }
  }

  function withAck(frame) {
    if (state !== "ready") return Promise.resolve({ ok: false, reason: "offline" });
    nonceSeq = (nonceSeq + 1) % 1e9;
    const nonce = `st${now().toString(36)}${nonceSeq.toString(36)}`;
    return new Promise((resolve) => {
      const timer = later(() => { if (pending.delete(nonce)) resolve({ ok: false, reason: "timeout" }); }, ACK_TIMEOUT_MS);
      pending.set(nonce, { resolve, timer });
      if (!send({ ...frame, nonce })) { cancel(timer); pending.delete(nonce); resolve({ ok: false, reason: "offline" }); }
    });
  }

  function sendNowPlaying() {
    send(nowPlaying ? { type: "nowPlaying", track: nowPlaying } : { type: "nowPlaying", track: null });
  }

  return {
    status,
    // Opens (or keeps) the connection. Idempotent; resolves once the first
    // attempt has an answer, which status() then reports.
    async connect() {
      if (!address) { setState("error", "not-configured"); return status(); }
      wanted = true;
      if (state === "ready" || state === "connecting" || opening) return status();
      backoff = 0;
      await open();
      return status();
    },
    // Closes the socket and ends the hub session. Rooms and the now-playing
    // share are forgotten, so a later connect starts clean.
    async disconnect() {
      wanted = false;
      const token = session?.token;
      drop();
      session = null;
      rooms.clear();
      nowPlaying = null;
      setState("off");
      if (token) await request("DELETE", "/v1/session", undefined, token);
      return status();
    },
    async rooms() {
      if (!session) return { ok: false, error: state === "error" ? error : "offline" };
      let answer = await request("GET", "/v1/rooms", undefined, session.token);
      if (!answer.ok && answer.status === 401) {
        const fresh = await openSession();
        if (!fresh.ok) return { ok: false, error: fresh.error };
        session = fresh.session;
        answer = await request("GET", "/v1/rooms", undefined, session.token);
      }
      if (!answer.ok) return { ok: false, error: answer.error };
      const list = Array.isArray(answer.data.rooms) ? answer.data.rooms.map(roomSummary).filter(Boolean) : [];
      return { ok: true, rooms: list };
    },
    subscribe(roomId) {
      if (!OPAQUE_ID.test(String(roomId))) return false;
      rooms.add(roomId);
      if (state === "ready") { send({ type: "subscribe", roomId }); send({ type: "presence", roomId }); }
      return true;
    },
    unsubscribe(roomId) {
      if (!rooms.delete(roomId)) return false;
      send({ type: "unsubscribe", roomId });
      return true;
    },
    // Starts or steers a room's shared player; answers { ok } or { ok: false, reason }.
    listen(roomId, fields = {}) {
      if (!OPAQUE_ID.test(String(roomId)) || !LISTEN_ACTIONS.includes(fields.action)) return Promise.resolve({ ok: false, reason: "bad-request" });
      const frame = { type: "listen", roomId, action: fields.action };
      if (fields.action === "start") {
        const url = listenUrl(fields.url);
        const label = line(fields.label, 120);
        if (!url || !label || !LISTEN_PROVIDERS.includes(fields.provider)) return Promise.resolve({ ok: false, reason: "bad-link" });
        Object.assign(frame, { url, label, provider: fields.provider });
      }
      if (fields.positionMs != null) {
        const position = Math.round(Number(fields.positionMs));
        if (!Number.isFinite(position)) return Promise.resolve({ ok: false, reason: "bad-request" });
        frame.positionMs = Math.max(0, Math.min(MAX_POSITION_MS, position));
      } else if (fields.action === "seek") return Promise.resolve({ ok: false, reason: "bad-request" });
      return withAck(frame);
    },
    // The track /nowplaying may show, or null to stop sharing. Kept and
    // re-sent after a reconnect; only a change goes out.
    setNowPlaying(track) {
      const next = nowPlayingTrack(track);
      if (track != null && !next) return false;
      if (JSON.stringify(next) === JSON.stringify(nowPlaying)) return true;
      nowPlaying = next;
      if (state === "ready") sendNowPlaying();
      return true;
    },
  };
}

module.exports = {
  PROTOCOL_VERSION, HUB_URL, LISTEN_PROVIDERS, NOW_PLAYING_PROVIDERS, LISTEN_ACTIONS, BACKOFF_MS, PRESENCE_EVERY_MS, SESSION_MARGIN_MS,
  hubAddress, configuredUrl, listenSession, nowPlayingTrack, roomSummary, createHubClient,
};
