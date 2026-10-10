"use strict";
// Native-only broker transport. The private service proves identity; the renderer
// sees public status, never callback parameters, verifier or account credentials.
const crypto = require("node:crypto"), http = require("node:http");
const { ACTOR_PROTOCOL, actorId } = require("./actor-contract.cjs");
const HEX = /^[a-f0-9]{64}$/, REQUEST = /^signin_[a-f0-9]{32}$/, CALLBACK = "/studio-account/callback";
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const safeError = (value) => ["unavailable", "unsupported", "auth", "not-member", "expired", "flow_used", "canceled", "identity_already_linked", "admission_migration_required", "legacy_account_migration_required", "legacy_wallet_migration_required", "rate-limited"].includes(value) ? value : "network";
function originOf(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" ? u.origin : null; } catch { return null; }
}
function sessionOf(value, now) {
  return keys(value, ["accountSession", "expiresAt", "actorProtocol", "user", "state", "socialAccess", "waitlistPosition"]) && typeof value.accountSession === "string" && HEX.test(value.accountSession)
    && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + 3600000
    && (value.state === "admitted" && value.socialAccess === true && value.waitlistPosition === null
      || value.state === "waitlisted" && value.socialAccess === false && Number.isSafeInteger(value.waitlistPosition) && value.waitlistPosition > 0)
    && value.actorProtocol === ACTOR_PROTOCOL && keys(value.user, ["id", "name"]) && actorId(value.user.id)
    && typeof value.user.name === "string" && value.user.name.length <= 100 && !/[\x00-\x1f\x7f]/.test(value.user.name)
    ? { accountSession: value.accountSession, expiresAt: value.expiresAt, actorProtocol: ACTOR_PROTOCOL, user: { ...value.user }, state: value.state, socialAccess: value.socialAccess, waitlistPosition: value.waitlistPosition } : null;
}
function authorizationUrl(value) {
  if (typeof value !== "string" || value.length > 8192 || /[\s\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "accounts.google.com" && !u.port && !u.username && !u.password
      && u.pathname === "/o/oauth2/v2/auth" && !u.hash ? value : null;
  } catch { return null; }
}
async function readJson(response) {
  const length = response.headers?.get?.("content-length");
  if (length != null && (!/^\d+$/.test(length) || Number(length) > 16384)) return null;
  if (!response.body || typeof response.body.getReader !== "function") return null;
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 16384) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; } finally { reader.releaseLock?.(); }
}
function createAccountClient({
  origin, enabled = false, canEncrypt = () => false, readStored = () => null, writeStored = async () => {},
  protect, unprotect, openExternal, getDiscordAccessToken, onChange = () => {},
  fetch: fetchImpl = globalThis.fetch, http: httpImpl = http, now = Date.now,
  randomBytes = crypto.randomBytes, setTimeout: later = setTimeout, clearTimeout: cancelTimer = clearTimeout,
} = {}) {
  const base = originOf(origin);
  let selected = false, record = null, running = null, generation = 0, lastError = null, closed = false, storageQueue = Promise.resolve();
  let initializing = true, initialization = Promise.resolve();
  const restore = saved => {
    if (closed) return;
    selected = saved?.selected === true;
    if (selected && saved.origin === base && typeof saved.encrypted === "string" && canEncrypt()) record = sessionOf(JSON.parse(unprotect(saved.encrypted)), now());
  };
  const loadFailed = () => { if (!closed) { lastError = "storage"; selected = true; } };
  try {
    const saved = readStored();
    if (saved && typeof saved.then === "function") {
      // Unknown saved mode cannot temporarily select legacy Discord.
      selected = true;
      initialization = Promise.resolve(saved).then(restore).catch(loadFailed).finally(() => { initializing = false; });
    } else { restore(saved); initializing = false; }
  } catch { loadFailed(); initializing = false; }
  const configured = () => Boolean(!closed && !initializing && enabled && base && typeof openExternal === "function" && canEncrypt());
  function status() {
    const live = configured() && record && record.expiresAt > now() ? record : null;
    return { available: true, configured: configured(), selected, linked: Boolean(live),
      signingIn: Boolean(running), user: live ? { ...live.user } : null,
      state: live?.state ?? null, socialAccess: live?.socialAccess === true, waitlistPosition: live?.waitlistPosition ?? null,
      expiresAt: record?.expiresAt ?? null, error: lastError };
  }
  function publish() { if (closed) return; try { onChange(status()); } catch {} }
  function save(nextRecord = record, nextSelected = selected) {
    const value = { version: 1, selected: nextSelected, origin: base, encrypted: nextRecord ? protect(JSON.stringify(nextRecord)) : null };
    storageQueue = storageQueue.catch(() => {}).then(() => writeStored(value));
    return storageQueue;
  }
  async function forget(error = null, keepSelected = true) {
    const mine = ++generation; running?.controller.abort(); record = null; selected = keepSelected; lastError = error;
    try { await save(); } catch { if (mine === generation) lastError = "storage"; }
    publish();
  }
  async function accountSession() {
    if (initializing) await initialization;
    if (!configured()) return { ok: false, error: "unavailable" };
    if (!selected) return { ok: false, error: "not-linked" };
    if (running && !record) return { ok: false, error: "signing-in" }; if (!record || record.expiresAt <= now()) { await forget("expired"); return { ok: false, error: "expired" }; }
    if (record.socialAccess !== true) return { ok: false, error: "waitlisted" };
    return { ok: true, accountSession: record.accountSession };
  }
  async function post(route, body, signal) {
    const controller = new AbortController(), timer = later(() => controller.abort(), 15000);
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetchImpl(base + route, { method: "POST", redirect: "error", cache: "no-store",
        signal: controller.signal, headers: { Accept: "application/json", "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
      const value = await readJson(response);
      return response.ok ? { ok: true, value } : { ok: false, error: response.status === 404 || response.status === 503 ? "unavailable" : safeError(value?.error?.code ?? value?.error) };
    } catch { return { ok: false, error: signal?.aborted ? "canceled" : "network" }; }
    finally { cancelTimer(timer); signal?.removeEventListener("abort", abort); }
  }
  async function signIn({ link = false } = {}) {
    if (initializing) {
      const beforeLoad = generation; await initialization;
      if (beforeLoad !== generation) return { ok: false, error: "canceled", status: status() };
    }
    if (running) return { ok: false, error: "busy", status: status() };
    if (!configured()) return { ok: false, error: "unavailable", status: status() };
    const controller = new AbortController(), mine = ++generation;
    const previousSelected = selected, previous = record && record.expiresAt > now() ? record : null;
    let committed = false;
    let finish; const done = new Promise(resolve => { finish = resolve; });
    const flow = { controller, done }; running = flow; lastError = null;
    let server = null, timer = null, stopWait = null, callbackDone = false, linkRecord = link ? previous : null;
    const current = () => mine === generation && !controller.signal.aborted;
    const close = () => { try { server?.close(); server?.closeAllConnections?.(); } catch {} };
    const fail = (error) => { if (mine === generation) lastError = error; return { ok: false, error }; };
    const reply = (res, code, message) => {
      res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer", Connection: "close" }); res.end(message);
    };
    const abort = () => { close(); stopWait?.({ error: "canceled" }); };
    controller.signal.addEventListener("abort", abort, { once: true });
    try {
      // Explicit switch enters account mode before awaits. Linking preserves the
      // existing account, and never touches the encrypted Discord refresh grant.
      selected = true; record = link ? previous : null; await save(); publish();
      if (!current()) return fail("canceled");
      if (link && !linkRecord) {
        const grant = await getDiscordAccessToken?.();
        if (!current()) return fail("canceled");
        if (!grant?.ok || typeof grant.token !== "string") return fail("not-linked");
        const exchanged = await post("/v1/auth/discord/exchange", { accessToken: grant.token }, controller.signal);
        if (!current()) return fail("canceled");
        if (!exchanged.ok) return fail(exchanged.error);
        linkRecord = sessionOf(exchanged.value, now()); if (!linkRecord) return fail("auth");
      }
      const deliveryState = randomBytes(32).toString("hex"), codeVerifier = randomBytes(48).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      let port = 0;
      const callback = new Promise((resolve) => { stopWait = resolve; });
      const handler = (req, res) => {
        if (!current() || callbackDone) return reply(res, 410, "This sign-in has ended.");
        const localOrigin = "http://127.0.0.1:" + port;
        if (req.method !== "GET" || req.headers.host !== "127.0.0.1:" + port || typeof req.url !== "string" || req.url.length > 512) return reply(res, 400, "Invalid callback.");
        let u; try { u = new URL(req.url, localOrigin); } catch { return reply(res, 400, "Invalid callback."); }
        if (u.origin !== localOrigin || u.pathname !== CALLBACK || u.hash) return reply(res, 404, "Not found.");
        const query = [...u.searchParams.keys()], state = u.searchParams.get("state");
        if (query.length !== 2 || new Set(query).size !== 2 || !query.includes("state") || !query.some((k) => k === "handoff" || k === "error")
          || typeof state !== "string" || !HEX.test(state) || !crypto.timingSafeEqual(Buffer.from(state, "hex"), Buffer.from(deliveryState, "hex"))) return reply(res, 400, "Invalid callback.");
        const handoff = u.searchParams.get("handoff"), error = u.searchParams.get("error");
        if (handoff !== null ? !HEX.test(handoff) : typeof error !== "string" || !/^[a-z_]{1,64}$/.test(error) && error !== "signin-cancelled") return reply(res, 400, "Invalid callback.");
        callbackDone = true; reply(res, 200, "You can return to Studio.");
        stopWait(handoff ? { handoff } : { error: "canceled" });
        try { server.close(); server.closeIdleConnections?.(); } catch {}
      };
      server = httpImpl.createServer(handler);
      const listening = await new Promise((resolve) => {
        server.once("error", () => resolve(false));
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => resolve(true));
      });
      if (!listening || !current()) return fail(current() ? "unavailable" : "canceled");
      port = server.address()?.port; if (!Number.isInteger(port) || port < 1024 || port > 65535) return fail("unavailable");
      const started = await post("/v1/auth/google/start", { returnUri: "http://127.0.0.1:" + port + CALLBACK, deliveryState, codeChallenge, ...(linkRecord ? { linkSession: linkRecord.accountSession } : {}) }, controller.signal);
      if (!current()) return fail("canceled");
      if (!started.ok) return fail(started.error);
      const start = started.value;
      if (!keys(start, ["requestId", "authorizationUrl", "expiresAt"]) || typeof start.requestId !== "string" || !REQUEST.test(start.requestId) || !authorizationUrl(start.authorizationUrl)
        || !Number.isSafeInteger(start.expiresAt) || start.expiresAt <= now() || start.expiresAt > now() + 300000) return fail("auth");
      timer = later(() => stopWait({ error: "expired" }), start.expiresAt - now());
      await openExternal(start.authorizationUrl);
      if (!current()) return fail("canceled");
      const delivered = await callback;
      if (!current()) return fail("canceled");
      if (delivered.error) return fail(delivered.error);
      const redeemed = await post("/v1/auth/google/redeem", { requestId: start.requestId, handoff: delivered.handoff, codeVerifier, ...(linkRecord ? { linkSession: linkRecord.accountSession } : {}) }, controller.signal);
      if (!current()) return fail("canceled");
      if (!redeemed.ok) return fail(redeemed.error);
      const next = sessionOf(redeemed.value, now());
      if (!next || linkRecord && next.user.id !== linkRecord.user.id) return fail("auth");
      // Persist the candidate without publishing it as usable authority.
      await save(next, true);
      if (!current()) return fail("canceled");
      record = next; selected = true; committed = true;
      return { ok: true };
    } catch { if (mine === generation) record = link ? previous : null; return fail(controller.signal.aborted ? "canceled" : "network"); }
    finally {
      close(); cancelTimer(timer); controller.signal.removeEventListener("abort", abort);
      if (mine === generation && !committed) {
        if (link || previousSelected && ["legacy_account_migration_required", "legacy_wallet_migration_required"].includes(lastError)) { record = previous; selected = previousSelected; }
        // This rollback snapshot is queued before any later explicit selection.
        try { await save(); } catch { if (mine === generation) { record = null; lastError = "storage"; } }
      }
      // Success has no second persistence await after its commit fence.
      if (running === flow) running = null;
      if (mine === generation) publish();
      finish();
    }
  }
  return Object.freeze({ status, accountSession, signIn, ready: () => initialization, isReady: () => !initializing && !closed,
    cancel: async () => { if (initializing) generation++; const flow = running; flow?.controller.abort(); if (flow) await flow.done; return { ok: true, status: status() }; },
    signOut: async () => { if (initializing) await initialization; if (closed) return { ok: false, error: "unavailable", status: status() }; await forget(); return { ok: true, status: status() }; },
    useDiscord: async () => { if (initializing) await initialization; if (closed) return { ok: false, error: "unavailable", status: status() }; await forget(null, false); return { ok: true, status: status() }; },
    close: () => { closed = true; const flow = running; if (flow) flow.controller.abort(); else { generation++; record = null; } return Promise.all([initialization, flow?.done]).then(() => storageQueue.catch(() => {})); },
  });
}
module.exports = { createAccountClient, sessionOf, authorizationUrl, originOf };