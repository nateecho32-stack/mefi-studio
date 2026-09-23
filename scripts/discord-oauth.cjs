// Mefi's Studio AI+ — the Discord login behind the Void collection perks.
//
// A network module, and deliberately not a pure one: it opens a loopback HTTP
// server for the OAuth redirect and talks to discord.com. Everything it reaches
// for is injectable (fetch, http, openExternal, the clock, the timeout and an
// AbortSignal), so the tests drive a real loopback server with a fake Discord.
// The rules that decide what an answer means live in scripts/community.cjs.
//
// The flow is OAuth2 authorization code with PKCE (S256) for a public client:
//
//   1. community.pkce() makes the verifier, the challenge and a `state`.
//   2. A server bound to 127.0.0.1 only, on the first free registered port,
//      serves GET /callback and nothing else. It checks the Host header (a
//      DNS-rebinding page arrives under its own name), accepts exactly one
//      callback, and gives up after five minutes.
//   3. The browser opens the hard-coded authorize URL (scopes identify and
//      guilds.members.read), and Discord redirects back with a code.
//   4. `state` is compared in constant time (a wrong one is refused and the
//      wait goes on), the browser gets a static page with no script, and the
//      server closes.
//   5. The code is exchanged at /oauth2/token WITHOUT a client secret: the app
//      is a public client, and a secret shipped in an MIT client is no secret.
//   6. /users/@me and /users/@me/guilds/{guild}/member say who the user is and
//      whether they are in the Void Engine server (404 means they are not).
//
// Every POST the community feature makes lives in this file (the token
// exchange, refresh and revoke), which keeps tests/outbound_privacy.test.mjs's
// count of POSTs in main.cjs honest. Tokens go back to the host and are never
// logged. Once the code exchange has succeeded Discord has granted, so
// authorize() returns the tokens with every answer from then on, failures
// included (a user or member read that failed, a cancel mid-read): the host
// hands any grant it does not record back through revoke(), and Unlink revokes
// the one it did. The host keeps the access token in memory and encrypts the
// refresh token with safeStorage. No function here throws: authorize, refresh
// and fetchMember answer a failure as { ok: false, error } with one of the
// codes in ERRORS, and revoke answers only { ok }.

"use strict";

const crypto = require("node:crypto");
const nodeHttp = require("node:http");
const community = require("./community.cjs");

const API_BASE = "https://discord.com/api/v10";
const TOKEN_URL = `${API_BASE}/oauth2/token`;
const REVOKE_URL = `${API_BASE}/oauth2/token/revoke`;
const USER_URL = `${API_BASE}/users/@me`;
const memberUrl = (guildId) => `${API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`;

const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
const AUTHORIZE_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TIMER_MS = 2_147_483_647;

const ERRORS = Object.freeze(["canceled", "timeout", "port-busy", "state", "auth", "network", "not-member", "rate-limit", "not-configured"]);

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const failure = (error, extra) => ({ ok: false, error, ...(extra ?? {}) });
const form = (fields) => new URLSearchParams(fields).toString();
const digest = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest();

// ---- the page the browser lands on -------------------------------------------

function page(message) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"color-scheme\" content=\"light dark\">"
    + "<title>Mefi's Studio AI+</title></head>"
    + "<body style=\"font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 1rem;text-align:center\">"
    + `<p>${message}</p></body></html>`;
}
const PAGE_OK = page("You can return to Mefi's Studio AI+. Studio finishes linking your Discord account on its own; this tab can be closed.");
const PAGE_FAIL = page("Linking did not finish. You can return to Mefi's Studio AI+ and try again from Settings.");

function reply(res, status, ok) {
  const body = ok ? PAGE_OK : PAGE_FAIL;
  try {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Connection: "close",
    });
    res.end(body);
  } catch { /* the browser went away; nothing to tell it */ }
}

// ---- HTTP helpers ------------------------------------------------------------

function clockOf(now) {
  if (typeof now === "function") return now;
  if (typeof now === "number" && Number.isFinite(now)) return () => now;
  return Date.now;
}

function timeoutOf(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_TIMER_MS) : fallback;
}

// The caller's signal (cancel) and a per-request timeout, so a stalled
// connection cannot hold the host's in-flight check forever.
function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
}

function header(response, name) {
  const headers = response?.headers;
  if (headers && typeof headers.get === "function") return headers.get(name);
  if (object(headers)) {
    const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name);
    return key == null ? null : headers[key];
  }
  return null;
}

async function readJson(response) {
  try {
    if (typeof response?.text === "function") {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    }
    if (typeof response?.json === "function") return await response.json();
  } catch { /* an unreadable body is treated as no body */ }
  return null;
}

// Discord sends Retry-After in seconds (possibly fractional) and repeats it as
// `retry_after` in the JSON body.
function retryAfterMs(response, body) {
  for (const raw of [header(response, "retry-after"), object(body) ? body.retry_after : null]) {
    if (raw == null || raw === "") continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }
  return null;
}

// 401/403 and an OAuth error body (invalid_grant, invalid_client) mean the
// grant is no good and the user has to link again; 429 is a rate limit; the
// rest (5xx, odd statuses) is treated as a transient network problem.
function failureFor(response, body) {
  const status = Number(response?.status) || 0;
  if (status === 429) {
    const wait = retryAfterMs(response, body);
    return wait == null ? failure("rate-limit") : failure("rate-limit", { retryAfterMs: wait });
  }
  if (status === 401 || status === 403) return failure("auth");
  if (status === 400 && object(body) && typeof body.error === "string") return failure("auth");
  return failure("network");
}

async function call(fetchImpl, url, init, signal, timeoutMs) {
  if (typeof fetchImpl !== "function") return { failed: failure("network") };
  try {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: requestSignal(signal, timeoutMs) });
    if (!response || typeof response !== "object") return { failed: failure("network") };
    return { response, body: await readJson(response) };
  } catch {
    return { failed: failure(signal instanceof AbortSignal && signal.aborted ? "canceled" : "network") };
  }
}

function tokensFrom(body, clock, previousRefreshToken = null) {
  if (!object(body) || typeof body.access_token !== "string" || !body.access_token) return null;
  const expiresIn = Number(body.expires_in);
  let issuedAt = Number(clock());
  if (!Number.isFinite(issuedAt)) issuedAt = Date.now();
  return {
    accessToken: body.access_token,
    // Discord rotates the refresh token on every use; the host must save the
    // new one before it uses the access token.
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : previousRefreshToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? issuedAt + expiresIn * 1000 : null,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

function userFrom(body) {
  if (!object(body) || (typeof body.id !== "string" && typeof body.id !== "number")) return null;
  const id = String(body.id);
  if (!id) return null;
  return {
    id,
    username: typeof body.username === "string" ? body.username : "",
    globalName: typeof body.global_name === "string" && body.global_name ? body.global_name : null,
  };
}

function memberFrom(body) {
  if (!object(body)) return null;
  return {
    roles: Array.isArray(body.roles) ? body.roles.filter((role) => typeof role === "string") : [],
    joined_at: typeof body.joined_at === "string" ? body.joined_at : null,
  };
}

const clientIdOf = (value) => (typeof value === "string" ? value.trim() : "");

// ---- the Discord API calls -----------------------------------------------------

// Who the token belongs to and whether they are in the guild. A 404 from the
// member endpoint (Discord's code 10004, "Unknown Guild") means "not a member";
// the user still comes back so the host can show who is linked.
async function fetchMember({ accessToken, guildId = community.GUILD_ID, fetch: fetchImpl = globalThis.fetch, signal, requestTimeoutMs } = {}) {
  if (typeof accessToken !== "string" || !accessToken) return failure("auth");
  const guild = typeof guildId === "string" || typeof guildId === "number" ? String(guildId).trim() : "";
  if (!/^\d{1,25}$/.test(guild)) return failure("not-configured");
  const timeoutMs = timeoutOf(requestTimeoutMs, REQUEST_TIMEOUT_MS);
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  const me = await call(fetchImpl, USER_URL, { method: "GET", headers }, signal, timeoutMs);
  if (me.failed) return me.failed;
  if (!me.response.ok) return failureFor(me.response, me.body);
  const user = userFrom(me.body);
  if (!user) return failure("network");

  const seat = await call(fetchImpl, memberUrl(guild), { method: "GET", headers }, signal, timeoutMs);
  if (seat.failed) return seat.failed;
  if (seat.response.status === 404) return failure("not-member", { user });
  if (!seat.response.ok) return failureFor(seat.response, seat.body);
  const member = memberFrom(seat.body);
  if (!member) return failure("network");
  return { ok: true, user, member };
}

async function exchangeCode({ clientId, code, redirectUri, verifier, fetchImpl, signal, clock, timeoutMs }) {
  const body = form({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
  const sent = await call(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  }, signal, timeoutMs);
  if (sent.failed) return sent.failed;
  if (!sent.response.ok) return failureFor(sent.response, sent.body);
  const tokens = tokensFrom(sent.body, clock);
  return tokens ? { ok: true, tokens } : failure("auth");
}

// Trades a refresh token for a new pair. No client secret (public client);
// Discord answers invalid_grant for a revoked or already-rotated token.
async function refresh({ clientId = community.CLIENT_ID, refreshToken, fetch: fetchImpl = globalThis.fetch, signal, now, requestTimeoutMs } = {}) {
  const client = clientIdOf(clientId);
  if (!client) return failure("not-configured");
  if (typeof refreshToken !== "string" || !refreshToken) return failure("auth");
  const sent = await call(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form({ client_id: client, grant_type: "refresh_token", refresh_token: refreshToken }),
  }, signal, timeoutOf(requestTimeoutMs, REQUEST_TIMEOUT_MS));
  if (sent.failed) return sent.failed;
  if (!sent.response.ok) return failureFor(sent.response, sent.body);
  const tokens = tokensFrom(sent.body, clockOf(now), refreshToken);
  return tokens ? { ok: true, tokens } : failure("auth");
}

// Unlinking revokes the grant at Discord (revoking either token ends both)
// before the host deletes its copy, as Discord's developer terms ask.
async function revoke({ clientId = community.CLIENT_ID, token, fetch: fetchImpl = globalThis.fetch, signal, requestTimeoutMs } = {}) {
  const client = clientIdOf(clientId);
  if (!client || typeof token !== "string" || !token) return { ok: false };
  const sent = await call(fetchImpl, REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form({ token, token_type_hint: "refresh_token", client_id: client }),
  }, signal, timeoutOf(requestTimeoutMs, REQUEST_TIMEOUT_MS));
  return { ok: Boolean(!sent.failed && sent.response.ok) };
}

// ---- the loopback redirect -------------------------------------------------------

function listen(http, port, handler) {
  return new Promise((resolve) => {
    let server;
    try { server = http.createServer(handler); } catch { resolve(null); return; }
    const refused = () => {
      try { server.close(); } catch { /* never listened */ }
      resolve(null);
    };
    server.once("error", refused);
    try {
      server.listen(port, LOOPBACK_HOST, () => {
        server.removeListener("error", refused);
        resolve(server);
      });
    } catch {
      refused();
    }
  });
}

function shut(server) {
  if (!server) return;
  try {
    server.close();
    // The callback's own connection carries `Connection: close` and ends after
    // its response; anything idle (a browser's speculative socket) goes now.
    server.closeIdleConnections?.();
  } catch { /* already closed */ }
}

async function authorize(options = {}) {
  const {
    clientId = community.CLIENT_ID,
    guildId = community.GUILD_ID,
    ports = community.REDIRECT_PORTS,
    scopes = community.SCOPES,
    openExternal,
    fetch: fetchImpl = globalThis.fetch,
    http = nodeHttp,
    signal,
    timeoutMs = AUTHORIZE_TIMEOUT_MS,
    onListening,
    now,
    randomBytes,
    requestTimeoutMs,
  } = object(options) ? options : {};

  const client = clientIdOf(clientId);
  if (!client || typeof openExternal !== "function" || !http || typeof http.createServer !== "function") return failure("not-configured");
  const aborted = () => signal instanceof AbortSignal && signal.aborted;
  if (aborted()) return failure("canceled");

  const clock = clockOf(now);
  const requestTimeout = timeoutOf(requestTimeoutMs, REQUEST_TIMEOUT_MS);
  const { verifier, challenge, state } = community.pkce(randomBytes);
  const expected = digest(state);

  let settle;
  const outcome = new Promise((resolve) => { settle = resolve; });
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    settle(value);
  };

  let port = 0;
  const handler = (req, res) => {
    // Only a browser that came to 127.0.0.1:<port> by that name gets past here;
    // anything else is refused without ending the wait for the real callback.
    if (settled) return reply(res, 410, false);
    if (req.method !== "GET" || req.headers.host !== `${LOOPBACK_HOST}:${port}`) return reply(res, 400, false);
    let url;
    try { url = new URL(req.url, `http://${LOOPBACK_HOST}:${port}`); } catch { return reply(res, 400, false); }
    if (url.pathname !== CALLBACK_PATH) return reply(res, 404, false);

    // The one callback. `state` first, so a forged `error=` cannot end the flow:
    // a hit with the wrong state (a web page's <img>, a local process, an old
    // callback tab reloaded from an earlier attempt) is refused and the wait
    // goes on. Only the right state, the timeout or a cancel ends it.
    const given = url.searchParams.get("state") ?? "";
    if (!crypto.timingSafeEqual(digest(given), expected)) return reply(res, 400, false);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      reply(res, 200, false);
      return finish(failure(error === "access_denied" ? "canceled" : "auth"));
    }
    reply(res, 200, true);
    return finish({ ok: true, code });
  };

  let server = null;
  const candidates = (Array.isArray(ports) ? ports : []).filter((entry) => Number.isInteger(entry) && entry > 0 && entry < 65536);
  for (const candidate of candidates) {
    server = await listen(http, candidate, handler);
    if (server) { port = candidate; break; }
  }
  if (!server) return failure("port-busy");

  const timer = setTimeout(() => finish(failure("timeout")), timeoutOf(timeoutMs, AUTHORIZE_TIMEOUT_MS));
  const onAbort = () => finish(failure("canceled"));
  if (signal instanceof AbortSignal) signal.addEventListener("abort", onAbort, { once: true });
  server.on("error", () => finish(failure("network")));
  if (aborted()) onAbort();

  const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
  const url = community.authorizeUrl({ clientId: client, redirectUri, challenge, state, scopes });
  try { onListening?.({ port, redirectUri, url }); } catch { /* an observer's error is not the flow's */ }
  // If the browser cannot be opened the user has no way to finish.
  Promise.resolve().then(() => openExternal(url)).catch(() => finish(failure("canceled")));

  let hit;
  try {
    hit = await outcome;
  } finally {
    clearTimeout(timer);
    if (signal instanceof AbortSignal) signal.removeEventListener("abort", onAbort);
    shut(server);
  }
  if (!hit.ok) return hit;
  if (aborted()) return failure("canceled");

  let exchanged = null;
  try {
    exchanged = await exchangeCode({ clientId: client, code: hit.code, redirectUri, verifier, fetchImpl, signal, clock, timeoutMs: requestTimeout });
    if (!exchanged.ok) return exchanged;
    const checked = await fetchMember({ accessToken: exchanged.tokens.accessToken, guildId, fetch: fetchImpl, signal, requestTimeoutMs: requestTimeout });
    if (checked.ok) return { ok: true, tokens: exchanged.tokens, user: checked.user, member: checked.member };
    // Not a member is still a completed login: the host stores the link (and
    // the tokens) so "Check now" can notice when the user joins.
    if (checked.error === "not-member") return { ok: false, error: "not-member", tokens: exchanged.tokens, user: checked.user };
    // Discord has granted by now, so every later failure (network, rate-limit,
    // auth, a cancel mid-fetch) carries the tokens too: the host revokes a
    // grant it will not record instead of leaving it active at Discord.
    return { ...checked, tokens: exchanged.tokens };
  } catch {
    return exchanged?.ok ? failure("network", { tokens: exchanged.tokens }) : failure("network");
  }
}

module.exports = {
  API_BASE, TOKEN_URL, REVOKE_URL, USER_URL, memberUrl, LOOPBACK_HOST, CALLBACK_PATH, AUTHORIZE_TIMEOUT_MS, ERRORS,
  authorize, refresh, fetchMember, revoke,
};
