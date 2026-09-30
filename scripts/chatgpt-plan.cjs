// Mefi's Studio AI+ — the "ChatGPT plan" provider: Sign in with ChatGPT, then
// Responses API calls paid for by the owner's ChatGPT plan instead of a
// metered API key. The spec is OpenAI's open-source token-sharing preview
// (developers.openai.com/siwc/token-sharing-open-source and its sign-in,
// profiles-and-sessions, models-and-inference, errors-and-recovery and
// preview-limitations pages). Studio is MIT, public and runs locally, which is
// the case the preview admits without an interest form.
//
// A network module like scripts/discord-oauth.cjs: every outside reach (fetch,
// the loopback server, the browser, randomness, the clock, the store, the log,
// the backoff sleep) is injected, so tests/chatgpt_plan.test.mjs drives the
// whole flow against fake servers on 127.0.0.1 with no real network.
//
// Sign-in (OAuth authorization code + PKCE S256, public client, no secret):
//   1. The install's ext_agent_host_id ("urn:uuid:…", opaque, never an email)
//      is made once and kept. The first sign-in registers with client_id
//      "dynamic_agent_client" and agent_name_hint; the callback returns the
//      issued client_id ("oaiapp_…"), which every later sign-in, refresh and
//      revoke uses. "dynamic_agent_client" itself is never saved.
//   2. A server bound to 127.0.0.1 only listens BEFORE the browser opens and
//      serves exactly GET /callback (Host header checked, state compared in
//      constant time; a wrong state or path is refused and the wait goes on).
//   3. The code is exchanged at the token endpoint with the verifier and the
//      exact redirect_uri. The ID token is verified against OpenAI's JWKS
//      (RS256; iss https://auth.openai.com, aud = the issued client_id, exp,
//      nonce). A returning sign-in must come back as the same `sub`.
//   4. Plan usage needs the granted scope chatgpt.tokens.use.direct. Without
//      it the sign-in is kept and plan usage is marked off; respond() then
//      answers "eligibility" without calling OpenAI.
//
// Tokens: the whole saved record goes through the injected save(record), and
// the host encrypts it (main.cjs uses Electron safeStorage). Nothing here logs
// a token, an email or the authorize URL, and no token ever rides a URL
// (id_token_hint is supported by authorizeUrl() but signIn() sends login_hint
// instead, so no ID token lands in the browser's history). Refreshes are
// single-flight and replace the access, refresh and ID tokens and the expiry
// in one assignment; an unusable refresh token (invalid_grant and friends)
// clears the tokens and asks for a new sign-in.
//
// Inference: POST /v1/responses with "stream": true and "store": false, built
// by requestBody() from an allow-list (the preview's rejected fields and
// unsupported hosted tools never leave). Success is counted only on
// response.completed. Errors map onto Studio's kinds (mapError); only 503s are
// retried, twice at most, with bounded backoff, and never after a delta was
// streamed. OpenAI never moves a refused call to other billing, and neither
// does this module: a limit is answered as a limit.

"use strict";

const crypto = require("node:crypto");
const nodeHttp = require("node:http");

const ISSUER = "https://auth.openai.com";
const ENDPOINTS = Object.freeze({
  authorize: `${ISSUER}/api/accounts/authorize`,
  token: `${ISSUER}/api/accounts/oauth/token`,
  revoke: `${ISSUER}/api/accounts/oauth/revoke`,
  jwks: `${ISSUER}/.well-known/jwks.json`,
  models: "https://api.openai.com/v1/models",
  responses: "https://api.openai.com/v1/responses",
});
const RESOURCE = "https://api.openai.com/v1";
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME = "Mefi's Studio AI+";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = Object.freeze(["openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE]);
const MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";
const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
const PROVIDER_ID = "chatgpt";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const RESPOND_TIMEOUT_MS = 120_000;
// An access token this close to its expiry is refreshed before use.
const REFRESH_MARGIN_MS = 60_000;
const CLOCK_SKEW_MS = 120_000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const MODELS_TTL_MS = 5 * 60 * 1000;
// Two retries after the first 503, 1 s then 2 s; a Retry-After longer than the
// cap is not waited on here (the caller gets it as retryAfterMs).
const RETRY_503_MAX = 2;
const RETRY_503_BASE_MS = 1_000;
const RETRY_503_CAP_MS = 8_000;
// The route names no reset time for a usage limit; calls pause this long.
const LIMIT_PAUSE_MS = 15 * 60 * 1000;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_SSE_BUFFER = 8 * 1024 * 1024;

// preview-limitations: fields the ChatGPT plan route refuses outright.
const REJECTED_FIELDS = Object.freeze([
  "background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt",
  "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id",
]);
// Hosted tools the route does not run.
const UNSUPPORTED_TOOLS = Object.freeze(["image_generation", "file_search", "code_interpreter", "computer_use_preview", "computer_use", "computer", "mcp", "tool_search"]);
// Fields requestBody() owns; an `extra` bag cannot override them.
const OWNED_FIELDS = Object.freeze(["model", "input", "instructions", "stream", "store", "reasoning", "service_tier", "tools"]);
// A refresh answered with one of these means the refresh token is gone.
const REFRESH_FATAL = Object.freeze(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

// errors-and-recovery: each structured code, the kind Studio handles it as,
// the HTTP status it arrives with, and whether a bounded retry is allowed.
const ERROR_CODES = Object.freeze({
  subscription_sharing_user_not_eligible: Object.freeze({ kind: "eligibility", status: 403 }),
  subscription_sharing_usage_limit_exceeded: Object.freeze({ kind: "limit", status: 429 }),
  subscription_sharing_usage_unavailable: Object.freeze({ kind: "unavailable", status: 503, retryable: true }),
  subscription_sharing_unsupported_capability: Object.freeze({ kind: "unsupported", status: 400 }),
  subscription_sharing_route_not_supported: Object.freeze({ kind: "unsupported", status: 403 }),
  subscription_sharing_invalid_user: Object.freeze({ kind: "auth", status: 401 }),
  subscription_sharing_user_unavailable: Object.freeze({ kind: "unavailable", status: 503, retryable: true }),
  chatpass_v2_scope_not_authorized: Object.freeze({ kind: "auth", status: 403 }),
  chatpass_v2_invalid_authorization_context: Object.freeze({ kind: "auth", status: 403 }),
});
const ERROR_KINDS = Object.freeze(["limit", "auth", "eligibility", "unsupported", "unavailable", "timeout", "network", "canceled", "validation"]);

const KIND_TEXT = Object.freeze({
  limit: "Usage limit reached. Review your plan or this app's limit in ChatGPT settings.",
  auth: "Your ChatGPT sign-in is not accepted. Continue with ChatGPT to sign in again.",
  eligibility: "ChatGPT plan usage is not available for this account or workspace.",
  unsupported: "The ChatGPT plan route does not support this request.",
  unavailable: "ChatGPT plan usage is temporarily unavailable. Try again shortly.",
  timeout: "The ChatGPT plan call timed out.",
  network: "The ChatGPT plan call did not reach OpenAI.",
  canceled: "The ChatGPT plan call was canceled.",
  validation: "ChatGPT answered, but the reply was unusable.",
});

// ---- small helpers -------------------------------------------------------------

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value.trim() : "");
const clip = (value, max = 200) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const form = (fields) => new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
const digest = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest();
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

function failure(errorKind, code, error, extra) {
  return { ok: false, errorKind, code, error: error || KIND_TEXT[errorKind] || "ChatGPT plan call failed.", ...(extra ?? {}) };
}

function clockOf(now) {
  if (typeof now === "function") return () => Number(now());
  if (typeof now === "number" && Number.isFinite(now)) return () => now;
  return Date.now;
}

function timeoutOf(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_TIMER_MS) : fallback;
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

// Retry-After in seconds or as an HTTP date; null when absent or unreadable.
function retryAfterOf(value, nowMs = Date.now()) {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function validHostId(value) {
  return typeof value === "string" && value.length <= 512
    && /^(?:urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|urn:ietf:params:oauth:jwk-thumbprint:[A-Za-z0-9-]+:[A-Za-z0-9_-]+|did:key:[A-Za-z0-9]+)$/i.test(value);
}

// An issued client id; the registration entry point is never one.
function validClientId(value) {
  return typeof value === "string" && value !== REGISTRATION_CLIENT_ID && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
}

function validRedirectUri(value) {
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/callback$/.exec(String(value ?? ""));
  return Boolean(match) && Number(match[1]) > 0 && Number(match[1]) < 65536;
}

function scopeList(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string" && entry).map((entry) => entry.trim());
  return String(value ?? "").split(/[\s+]+/).map((entry) => entry.trim()).filter(Boolean);
}

// ---- PKCE, state and nonce -------------------------------------------------------

function pkce(randomBytes = crypto.randomBytes) {
  const bytes = (size) => {
    try {
      const out = typeof randomBytes === "function" ? randomBytes(size) : null;
      if ((Buffer.isBuffer(out) || out instanceof Uint8Array) && out.length === size) return Buffer.from(out);
    } catch { /* fall through to the system source */ }
    return crypto.randomBytes(size);
  };
  const verifier = base64url(bytes(48)); // 64 base64url characters
  const challenge = crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge, state: base64url(bytes(32)), nonce: base64url(bytes(32)) };
}

// ---- the authorize URL (pure) ------------------------------------------------------

// Registration (client_id "dynamic_agent_client") sends agent_name_hint; a
// returning sign-in sends the issued id and omits it. Both send the install's
// host id. Throws on input that would build a URL OpenAI must refuse.
function authorizeUrl(options = {}) {
  const source = object(options) ? options : {};
  const clientId = str(source.clientId) || REGISTRATION_CLIENT_ID;
  const register = clientId === REGISTRATION_CLIENT_ID;
  if (!register && !validClientId(clientId)) throw new TypeError("clientId is not an issued client id");
  if (!validHostId(source.hostId)) throw new TypeError("hostId must be an opaque urn:uuid:, jwk-thumbprint or did:key id");
  if (!validRedirectUri(source.redirectUri)) throw new TypeError("redirectUri must be http://127.0.0.1:<port>/callback");
  for (const key of ["state", "nonce", "challenge"]) if (!/^[A-Za-z0-9_-]{16,256}$/.test(String(source[key] ?? ""))) throw new TypeError(`${key} is missing`);
  const params = [
    ["client_id", clientId],
    ["response_type", "code"],
    ["redirect_uri", source.redirectUri],
    ["scope", (Array.isArray(source.scopes) ? source.scopes : SCOPES).join(" ")],
    ["resource", RESOURCE],
    ["state", source.state],
    ["nonce", source.nonce],
    ["code_challenge", source.challenge],
    ["code_challenge_method", "S256"],
    ["ext_agent_host_id", source.hostId],
  ];
  if (register) params.push(["agent_name_hint", clip(source.agentName || AGENT_NAME, 80)]);
  const idTokenHint = str(source.idTokenHint);
  const loginHint = str(source.loginHint);
  if (idTokenHint) params.push(["id_token_hint", idTokenHint]);
  else if (loginHint) params.push(["login_hint", clip(loginHint, 320)]);
  const endpoint = str(source.endpoint) || ENDPOINTS.authorize;
  return `${endpoint}?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

// ---- ID tokens ------------------------------------------------------------------------

function decodeJwt(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) return null;
  try {
    const headerJson = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!object(headerJson) || !object(payload)) return null;
    return { header: headerJson, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
  } catch {
    return null;
  }
}

function audienceIncludes(aud, clientId) {
  return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
}

function emailOf(claims) {
  if (typeof claims?.email === "string" && claims.email) return claims.email;
  const profile = claims?.["https://api.openai.com/profile"];
  return typeof profile?.email === "string" && profile.email ? profile.email : null;
}

// Verifies an ID token against a JWKS key list: RS256 only, the key named by
// `kid`, then iss, aud (and azp when present), exp and nonce. Returns
// { ok, claims } or { ok: false, code } with code "kid" when the key is not
// in the list (the caller refetches the JWKS once).
function verifyIdToken(token, options = {}) {
  const { keys = [], clientId, nonce, now = Date.now(), issuer = ISSUER, skewMs = CLOCK_SKEW_MS } = object(options) ? options : {};
  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, code: "malformed" };
  if (jwt.header.alg !== "RS256") return { ok: false, code: "alg" };
  const candidates = (Array.isArray(keys) ? keys : []).filter((key) => object(key) && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
  const jwk = jwt.header.kid ? candidates.find((key) => key.kid === jwt.header.kid) : candidates.length === 1 ? candidates[0] : null;
  if (!jwk) return { ok: false, code: "kid" };
  let verified = false;
  try {
    const key = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
    verified = crypto.verify("RSA-SHA256", Buffer.from(jwt.signingInput, "ascii"), key, jwt.signature);
  } catch {
    verified = false;
  }
  if (!verified) return { ok: false, code: "signature" };
  const claims = jwt.payload;
  const at = Number(now);
  if (claims.iss !== issuer) return { ok: false, code: "issuer" };
  if (!clientId || !audienceIncludes(claims.aud, clientId)) return { ok: false, code: "audience" };
  if (claims.azp !== undefined && claims.azp !== clientId) return { ok: false, code: "audience" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 + skewMs < at) return { ok: false, code: "expired" };
  if (typeof claims.iat === "number" && claims.iat * 1000 - skewMs > at) return { ok: false, code: "issued-in-future" };
  if (nonce !== undefined && nonce !== null) {
    const given = typeof claims.nonce === "string" ? claims.nonce : "";
    if (!crypto.timingSafeEqual(digest(given), digest(nonce)) || !given) return { ok: false, code: "nonce" };
  }
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, code: "subject" };
  return { ok: true, claims };
}

// ---- the Responses request (pure) ----------------------------------------------------

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n");
  return "";
}

function scrubContent(content, scrub) {
  if (typeof scrub !== "function") return content;
  if (typeof content === "string") return scrub(content);
  if (Array.isArray(content)) return content.map((part) => (object(part) && typeof part.text === "string" ? { ...part, text: scrub(part.text) } : part));
  return content;
}

// The body sent to /v1/responses, from chat-style messages (system messages
// become `instructions`: the route rejects explicit system items) or from
// instructions + input. Built from an allow-list: model, input, instructions,
// reasoning, service_tier, supported tools, plus an `extra` bag stripped of
// every rejected or owned field. "stream": true and "store": false always.
// A chat-completions body (httpAssistantCall's) can be passed as-is:
// temperature and max_tokens are dropped, reasoning_effort and service_tier
// are carried over.
function requestBody(options = {}, { scrub = null } = {}) {
  const source = object(options) ? options : {};
  const model = str(source.model);
  if (!model) throw new TypeError("a model slug is required");
  const instructions = [];
  if (typeof source.instructions === "string" && source.instructions.trim()) instructions.push(source.instructions.trim());
  const input = [];
  const take = (item) => {
    if (!object(item)) return;
    if (item.role === "system") { const text = contentText(item.content).trim(); if (text) instructions.push(text); return; }
    if (item.role !== undefined && !["user", "assistant", "developer"].includes(item.role)) return;
    if (item.role === undefined && item.type === undefined) return;
    input.push(item.role ? { ...item, content: scrubContent(item.content ?? "", scrub) } : item);
  };
  if (Array.isArray(source.messages)) {
    for (const message of source.messages) if (object(message)) take({ role: message.role, content: message.content });
  }
  if (typeof source.input === "string" && source.input) input.push({ role: "user", content: scrubContent(source.input, scrub) });
  else if (Array.isArray(source.input)) source.input.forEach(take);
  if (!input.length) throw new TypeError("the request has no input");

  const body = {};
  if (object(source.extra)) {
    for (const [key, value] of Object.entries(source.extra)) {
      if (!REJECTED_FIELDS.includes(key) && !OWNED_FIELDS.includes(key) && value !== undefined) body[key] = clone(value);
    }
  }
  body.model = model;
  body.input = input;
  if (instructions.length) body.instructions = instructions.join("\n\n");
  const effort = str(source.effort) || str(source.reasoning_effort) || str(source.reasoning?.effort);
  if (effort && /^[a-z]{1,16}$/.test(effort)) {
    const summary = source.summary === null ? null : str(source.summary) || str(source.reasoning?.summary) || "auto";
    body.reasoning = summary ? { effort, summary } : { effort };
  }
  const tier = str(source.serviceTier) || str(source.service_tier);
  if (tier && /^[a-z_-]{1,32}$/.test(tier)) body.service_tier = tier;
  if (Array.isArray(source.tools)) {
    const tools = source.tools.filter((tool) => object(tool) && typeof tool.type === "string" && !UNSUPPORTED_TOOLS.includes(tool.type)).map(clone);
    if (tools.length) body.tools = tools;
  }
  for (const field of REJECTED_FIELDS) delete body[field];
  body.stream = true;
  body.store = false;
  return body;
}

// ---- Server-Sent Events (pure) ----------------------------------------------------------

// An incremental SSE parser: push(text) returns the events completed by that
// chunk, end() flushes the last one. Lines may end in \n, \r\n or \r (a \r at
// the very end of a chunk waits for the next one, so a split \r\n is one
// break). Comments are skipped; `data` lines join with \n; each event carries
// its JSON when the data parses, and "[DONE]" is dropped.
function createSseParser({ maxBuffer = MAX_SSE_BUFFER } = {}) {
  let buffer = "";
  let event = "";
  let data = [];
  const dispatch = (out) => {
    if (data.length) {
      const text = data.join("\n");
      if (text !== "[DONE]") {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        out.push({ event: event || "message", data: text, json });
      }
    }
    event = "";
    data = [];
  };
  const line = (text, out) => {
    if (text === "") return dispatch(out);
    if (text.startsWith(":")) return undefined;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return undefined;
  };
  return {
    push(chunk) {
      buffer += String(chunk ?? "");
      const out = [];
      for (;;) {
        const index = buffer.search(/\r\n|\n|\r/);
        if (index === -1) break;
        if (buffer[index] === "\r" && index === buffer.length - 1) break; // maybe half of \r\n
        const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
        const text = buffer.slice(0, index);
        buffer = buffer.slice(index + width);
        line(text, out);
      }
      if (buffer.length > maxBuffer) throw new RangeError("an SSE line is too long");
      return out;
    },
    end() {
      const out = [];
      if (buffer) {
        const rest = buffer.replace(/\r$/, "");
        buffer = "";
        for (const text of rest.split(/\r\n|\n|\r/)) line(text, out);
      }
      dispatch(out);
      return out;
    },
  };
}

function parseSse(text) {
  const parser = createSseParser({ maxBuffer: Infinity });
  return [...parser.push(String(text ?? "")), ...parser.end()];
}

// ---- errors (pure) --------------------------------------------------------------------

function errorFields(body) {
  if (typeof body === "string") {
    const text = body.trim();
    if (!text) return {};
    try { return errorFields(JSON.parse(text)); } catch { return { message: text }; }
  }
  if (!object(body)) return {};
  if (object(body.error)) return { code: str(body.error.code), message: str(body.error.message), param: str(body.error.param) };
  if (typeof body.error === "string") return { code: str(body.error), message: str(body.error_description) || str(body.message) };
  if (object(body.response) && object(body.response.error)) return errorFields({ error: body.response.error });
  // Direct-route admission answers {"detail": "..."}: diagnostic text, never
  // a machine-readable code.
  if (typeof body.detail === "string") return { message: body.detail };
  if (object(body.detail)) return errorFields(body.detail);
  return { code: str(body.code), message: str(body.message), param: str(body.param) };
}

function kindForStatus(status) {
  if (status === 401) return "auth";
  if (status === 403) return "eligibility";
  if (status === 429) return "limit";
  if (status === 408) return "timeout";
  if ([400, 404, 405, 409, 413, 415, 422].includes(status)) return "unsupported";
  if (status >= 500) return "unavailable";
  return "network";
}

// One failure in Studio's shape from an HTTP status and/or an error body (a
// JSON error object, {"detail": ...}, a response.failed event's error, or raw
// text). The structured subscription_sharing_* codes decide the kind; the
// status decides it otherwise.
function mapError(input = {}) {
  const source = object(input) ? input : {};
  const fields = errorFields(source.body);
  const code = str(source.code) || fields.code || "";
  const message = str(source.message) || fields.message || "";
  const param = str(source.param) || fields.param || "";
  const known = code ? ERROR_CODES[code] : null;
  const status = Number(source.status) || known?.status || 0;
  const errorKind = known ? known.kind : kindForStatus(status);
  const retryable = known ? known.retryable === true : status === 503;
  const detail = [param ? `param ${param}` : "", message].filter(Boolean).join(": ");
  const result = failure(errorKind, code || (status ? `http_${status}` : "unknown_error"),
    `ChatGPT plan: ${KIND_TEXT[errorKind]}${detail ? ` (${clip(detail, 200)})` : ""}`, { retryable });
  if (status) result.status = status;
  if (param) result.param = param;
  const wait = num(source.retryAfterMs);
  if (wait !== null && wait >= 0) result.retryAfterMs = wait;
  if (errorKind === "limit") result.manageUsageUrl = MANAGE_USAGE_URL;
  if (code === "subscription_sharing_invalid_user") result.reauth = true;
  return result;
}

// ---- model list and reply shaping (pure) -------------------------------------------------

// The catalog answers a `models` array in the server's order; only entries
// with visibility "list" are shown, by display_name, and called by slug.
function modelsFrom(body) {
  const list = Array.isArray(body?.models) ? body.models : [];
  return list.filter((entry) => object(entry) && entry.visibility === "list" && typeof entry.slug === "string" && entry.slug.trim())
    .map((entry) => {
      const model = { slug: entry.slug.trim(), name: str(entry.display_name) || entry.slug.trim() };
      if (str(entry.description)) model.description = clip(entry.description, 300);
      return model;
    });
}

function outputText(response) {
  const items = Array.isArray(response?.output) ? response.output : [];
  return items.filter((item) => item?.type === "message").flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((part) => part?.type === "output_text").map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

function outputReasoning(response) {
  const items = Array.isArray(response?.output) ? response.output : [];
  return items.filter((item) => item?.type === "reasoning").flatMap((item) => (Array.isArray(item.summary) ? item.summary : []))
    .map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean).join("\n");
}

function tokenUsageOf(usage) {
  const source = object(usage) ? usage : {};
  return {
    inputTokens: num(source.input_tokens), outputTokens: num(source.output_tokens), totalTokens: num(source.total_tokens),
    cacheReadTokens: num(source.input_tokens_details?.cached_tokens), reasoningTokens: num(source.output_tokens_details?.reasoning_tokens),
  };
}

// ---- the browser's landing page ------------------------------------------------------------

function page(message) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"color-scheme\" content=\"light dark\">"
    + "<title>Mefi's Studio AI+</title></head>"
    + "<body style=\"font:16px/1.5 system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 1rem;text-align:center\">"
    + `<p>${message}</p></body></html>`;
}
const PAGE_OK = page("You can return to Mefi's Studio AI+. Studio finishes signing in with ChatGPT on its own; this tab can be closed.");
const PAGE_FAIL = page("Signing in did not finish. You can return to Mefi's Studio AI+ and try again from Setup.");

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
  } catch { /* the browser went away */ }
}

function listen(createServer, port, handler) {
  return new Promise((resolve) => {
    let server;
    try { server = createServer(handler); } catch { resolve(null); return; }
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
    server.closeIdleConnections?.();
  } catch { /* already closed */ }
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener?.("abort", onAbort); resolve(); }, Math.max(0, Math.min(ms, MAX_TIMER_MS)));
    const onAbort = () => { clearTimeout(timer); reject(new Error("aborted")); };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// ---- the saved record ----------------------------------------------------------------------

// { version, hostId, welcomed, account: { clientId, email, subject, issuer,
// scopes, planUsage, signedInAt, signInNeeded }, tokens: { accessToken,
// refreshToken, idToken, expiresAt, savedAt } }. Anything malformed is
// dropped rather than trusted; "dynamic_agent_client" is never an account's id.
function normalizeRecord(raw) {
  const source = object(raw) ? raw : {};
  const record = { version: 1, hostId: validHostId(source.hostId) ? source.hostId : null, welcomed: source.welcomed === true, account: null, tokens: null };
  const account = source.account;
  if (object(account) && validClientId(account.clientId) && typeof account.subject === "string" && account.subject) {
    record.account = {
      clientId: account.clientId,
      email: typeof account.email === "string" && account.email ? account.email : null,
      subject: account.subject,
      issuer: ISSUER,
      scopes: scopeList(account.scopes),
      planUsage: account.planUsage === true,
      signedInAt: num(account.signedInAt),
      signInNeeded: account.signInNeeded === true,
    };
    const tokens = source.tokens;
    if (object(tokens) && typeof tokens.accessToken === "string" && tokens.accessToken) {
      record.tokens = {
        accessToken: tokens.accessToken,
        refreshToken: typeof tokens.refreshToken === "string" && tokens.refreshToken ? tokens.refreshToken : null,
        idToken: typeof tokens.idToken === "string" && tokens.idToken ? tokens.idToken : null,
        expiresAt: num(tokens.expiresAt),
        savedAt: num(tokens.savedAt),
      };
    }
  }
  return record;
}

function tokensFrom(body, nowMs, previous = null) {
  if (!object(body) || typeof body.access_token !== "string" || !body.access_token) return null;
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : previous?.refreshToken ?? null,
    idToken: typeof body.id_token === "string" && body.id_token ? body.id_token : previous?.idToken ?? null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
    savedAt: nowMs,
  };
}

function oauthCode(body) {
  if (!object(body)) return "";
  if (typeof body.error === "string") return body.error;
  if (object(body.error)) return str(body.error.code) || str(body.error.type);
  return str(body.code) || str(body.error_code);
}

// ---- the provider -------------------------------------------------------------------------------

function createChatGptPlan(options = {}) {
  const deps = object(options) ? options : {};
  const fetchImpl = typeof deps.fetch === "function" ? deps.fetch : globalThis.fetch;
  const createServer = typeof deps.createServer === "function" ? deps.createServer : nodeHttp.createServer;
  const openBrowser = typeof deps.openBrowser === "function" ? deps.openBrowser : null;
  const randomBytes = typeof deps.randomBytes === "function" ? deps.randomBytes : crypto.randomBytes;
  const randomUUID = typeof deps.randomUUID === "function" ? deps.randomUUID : crypto.randomUUID;
  const now = clockOf(deps.now);
  const log = typeof deps.log === "function" ? (line) => { try { deps.log(line); } catch { /* the log is not the flow */ } } : () => {};
  const sleep = typeof deps.sleep === "function" ? deps.sleep : defaultSleep;
  const scrub = typeof deps.scrub === "function" ? deps.scrub : null;
  const endpoints = { ...ENDPOINTS, ...(object(deps.endpoints) ? deps.endpoints : {}) };
  const ports = (Array.isArray(deps.ports) && deps.ports.length ? deps.ports : [0]).filter((port) => Number.isInteger(port) && port >= 0 && port < 65536);
  const agentName = str(deps.agentName) || AGENT_NAME;
  const requestTimeoutMs = timeoutOf(deps.requestTimeoutMs, REQUEST_TIMEOUT_MS);
  const retryBaseMs = timeoutOf(deps.retryBaseMs, RETRY_503_BASE_MS);
  const limitPauseMs = timeoutOf(deps.limitPauseMs, LIMIT_PAUSE_MS);

  let record = null;
  let loading = null;
  let signing = null;
  let refreshing = null;
  let limit = null;
  let modelsCache = null;
  let jwksCache = null;
  let saving = Promise.resolve();

  async function ready() {
    if (record) return record;
    if (!loading) {
      loading = (async () => {
        let raw = null;
        try { raw = typeof deps.load === "function" ? await deps.load() : null; } catch (error) {
          log(`[chatgpt-plan] the saved sign-in could not be read: ${clip(error?.message, 120)}`);
        }
        if (!record) record = normalizeRecord(raw);
        return record;
      })();
    }
    return loading;
  }

  // Every write is the whole record, in order; a failed write is logged and
  // the in-memory copy stays the live one (a refresh has already retired the
  // previous refresh token, so memory must not roll back).
  function persist() {
    const snapshot = clone(record);
    saving = saving.then(async () => {
      if (typeof deps.save !== "function") return;
      try { await deps.save(snapshot); } catch (error) {
        log(`[chatgpt-plan] the sign-in could not be saved: ${clip(error?.message, 120)}`);
      }
    });
    return saving;
  }

  async function hostId() {
    const saved = await ready();
    if (!saved.hostId) {
      let id = "";
      try { id = String(randomUUID()); } catch { id = ""; }
      saved.hostId = validHostId(`urn:uuid:${id}`) ? `urn:uuid:${id}` : `urn:uuid:${crypto.randomUUID()}`;
      await persist();
    }
    return saved.hostId;
  }

  const publicAccount = () => {
    const account = record?.account;
    return account ? { email: account.email, subject: account.subject, clientId: account.clientId, hostId: record.hostId, planUsage: account.planUsage } : null;
  };

  function clearTokens(signInNeeded) {
    record.tokens = null;
    if (record.account) record.account.signInNeeded = signInNeeded === true;
    modelsCache = null;
  }

  // One outside call with a per-request timeout beside the caller's signal.
  async function call(url, init, signal, timeoutMs = requestTimeoutMs) {
    if (typeof fetchImpl !== "function") return { failed: failure("network", "no_fetch") };
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetchImpl(url, { ...init, redirect: "error", signal: combined });
      if (!response || typeof response !== "object") return { failed: failure("network", "no_response") };
      let text = "";
      try { text = typeof response.text === "function" ? await response.text() : ""; } catch { text = ""; }
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      return { response, body, text };
    } catch {
      if (signal instanceof AbortSignal && signal.aborted) return { failed: failure("canceled", "canceled") };
      if (timeout.aborted) return { failed: failure("timeout", "timeout") };
      return { failed: failure("network", "network_error") };
    }
  }

  async function jwks(signal, { force = false } = {}) {
    if (!force && jwksCache && now() - jwksCache.at < JWKS_TTL_MS) return { ok: true, keys: jwksCache.keys };
    const sent = await call(endpoints.jwks, { method: "GET", headers: { Accept: "application/json" } }, signal);
    if (sent.failed) return sent.failed;
    const keys = sent.response.ok && Array.isArray(sent.body?.keys) ? sent.body.keys.filter(object) : null;
    if (!keys) return failure("network", "jwks_unavailable", "OpenAI's signing keys could not be read.");
    jwksCache = { at: now(), keys };
    return { ok: true, keys };
  }

  async function revokeToken(clientId, refreshToken, signal) {
    if (!validClientId(clientId) || typeof refreshToken !== "string" || !refreshToken) return false;
    const sent = await call(endpoints.revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form({ token: refreshToken, token_type_hint: "refresh_token", client_id: clientId }),
    }, signal);
    return Boolean(!sent.failed && sent.response.ok);
  }

  // ---- sign-in ----

  function signIn(signInOptions = {}) {
    const opts = object(signInOptions) ? signInOptions : {};
    if (signing) return Promise.resolve(failure("busy", "sign_in_in_progress", "A ChatGPT sign-in is already waiting in your browser."));
    const controller = new AbortController();
    const outer = opts.signal instanceof AbortSignal ? opts.signal : null;
    const onOuter = () => controller.abort();
    if (outer) { if (outer.aborted) controller.abort(); else outer.addEventListener("abort", onOuter, { once: true }); }
    const entry = { controller, promise: null };
    signing = entry;
    entry.promise = runSignIn(opts, controller.signal)
      .catch((error) => failure("network", "sign_in_failed", `Signing in with ChatGPT failed: ${clip(error?.message, 160)}`))
      .finally(() => {
        outer?.removeEventListener("abort", onOuter);
        if (signing === entry) signing = null;
      });
    return entry.promise;
  }

  function cancel() {
    if (!signing) return false;
    signing.controller.abort();
    return true;
  }

  async function runSignIn(opts, signal) {
    const saved = await ready();
    if (!openBrowser || typeof fetchImpl !== "function" || typeof createServer !== "function") return failure("unavailable", "not_configured", "Signing in with ChatGPT is not available in this build.");
    if (signal.aborted) return failure("canceled", "canceled", "Sign-in canceled.");
    const host = await hostId();
    const returning = saved.account && opts.newAccount !== true ? saved.account : null;
    const clientId = returning ? returning.clientId : REGISTRATION_CLIENT_ID;
    const secrets = pkce(randomBytes);
    const expected = digest(secrets.state);

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
      if (settled) return reply(res, 410, false);
      if (req.method !== "GET" || req.headers.host !== `${LOOPBACK_HOST}:${port}`) return reply(res, 400, false);
      let url;
      try { url = new URL(req.url, `http://${LOOPBACK_HOST}:${port}`); } catch { return reply(res, 400, false); }
      if (url.pathname !== CALLBACK_PATH) return reply(res, 404, false);
      // State first: a hit without the right state (a stray page, an old tab)
      // is refused and the wait goes on; only the real callback ends it.
      const given = url.searchParams.get("state") ?? "";
      if (!crypto.timingSafeEqual(digest(given), expected)) return reply(res, 400, false);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        reply(res, 200, false);
        if (error === "access_denied") return finish(failure("canceled", "access_denied", "Sign-in was canceled in the browser."));
        return finish(failure("auth", clip(error || "no_code", 80), `ChatGPT did not complete the sign-in${error ? ` (${clip(error, 80)})` : ""}.`));
      }
      reply(res, 200, true);
      return finish({ ok: true, code, clientId: url.searchParams.get("client_id"), scope: url.searchParams.get("scope") });
    };

    let server = null;
    for (const candidate of ports) {
      server = await listen(createServer, candidate, handler);
      if (server) { port = server.address()?.port || candidate; break; }
    }
    if (!server || !port) return failure("unavailable", "port_busy", "Studio could not open a local port for the sign-in.");

    const timer = setTimeout(() => finish(failure("timeout", "timeout", "The sign-in was not finished in time.")), timeoutOf(opts.timeoutMs, SIGN_IN_TIMEOUT_MS));
    const onAbort = () => finish(failure("canceled", "canceled", "Sign-in canceled."));
    signal.addEventListener("abort", onAbort, { once: true });
    server.on("error", () => finish(failure("network", "server_error")));
    if (signal.aborted) onAbort();

    const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
    let url;
    try {
      url = authorizeUrl({
        endpoint: endpoints.authorize, clientId, hostId: host, redirectUri, state: secrets.state, nonce: secrets.nonce, challenge: secrets.challenge,
        agentName, loginHint: str(opts.loginHint) || (returning?.email ?? ""),
      });
    } catch (error) {
      finish(failure("unavailable", "bad_request", clip(error?.message, 160)));
    }
    // The listener is up; only now does the browser open.
    if (url) Promise.resolve().then(() => openBrowser(url)).catch(() => finish(failure("unavailable", "browser_failed", "Studio could not open your browser.")));

    let hit;
    try {
      hit = await outcome;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      shut(server);
    }
    if (!hit.ok) return hit;
    if (signal.aborted) return failure("canceled", "canceled", "Sign-in canceled.");

    let issued = clientId;
    if (!returning) {
      if (!validClientId(hit.clientId)) return failure("auth", "no_client_id", "ChatGPT did not return an app registration for Studio.");
      issued = hit.clientId;
    } else if (hit.clientId && hit.clientId !== clientId) {
      return failure("auth", "client_mismatch", "ChatGPT answered for a different app registration.");
    }

    const exchanged = await call(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form({ grant_type: "authorization_code", client_id: issued, code: hit.code, code_verifier: secrets.verifier, redirect_uri: redirectUri, resource: RESOURCE }),
    }, signal);
    if (exchanged.failed) return exchanged.failed;
    if (!exchanged.response.ok) {
      const code = oauthCode(exchanged.body) || `http_${exchanged.response.status}`;
      return failure(exchanged.response.status >= 500 ? "unavailable" : "auth", clip(code, 80), `ChatGPT refused the sign-in code (${clip(code, 80)}). Try again.`);
    }
    const tokens = tokensFrom(exchanged.body, now());
    if (!tokens) return failure("auth", "no_tokens", "ChatGPT's token reply was incomplete.");
    const drop = async (result) => {
      // A grant Studio will not keep is handed back rather than left active.
      await revokeToken(issued, tokens.refreshToken, null).catch(() => false);
      return result;
    };
    if (!tokens.idToken) return drop(failure("auth", "no_id_token", "ChatGPT's token reply had no ID token."));

    let keys = await jwks(signal);
    if (!keys.ok) return drop(keys);
    let verdict = verifyIdToken(tokens.idToken, { keys: keys.keys, clientId: issued, nonce: secrets.nonce, now: now() });
    if (!verdict.ok && verdict.code === "kid") {
      keys = await jwks(signal, { force: true });
      if (!keys.ok) return drop(keys);
      verdict = verifyIdToken(tokens.idToken, { keys: keys.keys, clientId: issued, nonce: secrets.nonce, now: now() });
    }
    if (!verdict.ok) return drop(failure("auth", `id_token_${verdict.code}`, "ChatGPT's ID token did not check out; the sign-in was not kept."));
    const claims = verdict.claims;
    if (returning && claims.sub !== returning.subject) return drop(failure("auth", "account_mismatch", "That is a different ChatGPT account from the one Studio signed in with. Sign out first to switch accounts."));

    const granted = scopeList(typeof exchanged.body.scope === "string" ? exchanged.body.scope : hit.scope);
    const planUsage = granted.includes(PLAN_SCOPE);
    record.account = {
      clientId: issued, email: emailOf(claims) ?? returning?.email ?? null, subject: claims.sub, issuer: ISSUER,
      scopes: granted, planUsage, signedInAt: now(), signInNeeded: false,
    };
    record.tokens = tokens;
    const welcome = planUsage && !record.welcomed;
    if (planUsage) record.welcomed = true;
    limit = null;
    modelsCache = null;
    await persist();
    log(`[chatgpt-plan] signed in${returning ? "" : " (new app registration)"}; ChatGPT plan usage ${planUsage ? "on" : "not granted"}`);
    return { ok: true, account: publicAccount(), welcome };
  }

  // ---- tokens ----

  const stillValid = (tokens) => Boolean(tokens?.accessToken) && (tokens.expiresAt === null || tokens.expiresAt - now() > 5_000);

  async function refreshNow() {
    const account = record.account;
    const tokens = record.tokens;
    if (!account || !tokens) return failure("auth", "signed_out", "Sign in with ChatGPT first.");
    if (!tokens.refreshToken) {
      if (stillValid(tokens)) return { ok: true, accessToken: tokens.accessToken, planUsage: account.planUsage };
      clearTokens(true);
      await persist();
      return failure("auth", "no_refresh_token", KIND_TEXT.auth, { reauth: true });
    }
    const sent = await call(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: tokens.refreshToken, resource: RESOURCE }),
    }, null);
    if (sent.failed) {
      if (stillValid(tokens)) return { ok: true, accessToken: tokens.accessToken, planUsage: account.planUsage };
      return sent.failed;
    }
    if (!sent.response.ok) {
      const status = sent.response.status;
      const code = oauthCode(sent.body);
      if (REFRESH_FATAL.includes(code) || code === "invalid_client" || (status === 401 && !code)) {
        clearTokens(true);
        // A client id OpenAI no longer knows (the app was removed in ChatGPT
        // settings) cannot be fixed by signing in with it again: the next
        // sign-in registers afresh.
        if (code === "invalid_client") record.account = null;
        await persist();
        log(`[chatgpt-plan] refresh refused (${clip(code || `http_${status}`, 60)}); a new sign-in is needed`);
        return failure("auth", clip(code || `http_${status}`, 80), "Your ChatGPT sign-in has ended. Continue with ChatGPT to sign in again.", { reauth: true });
      }
      if (stillValid(tokens)) return { ok: true, accessToken: tokens.accessToken, planUsage: account.planUsage };
      return failure(status >= 500 ? "unavailable" : "network", clip(code || `http_${status}`, 80), "Your ChatGPT sign-in could not be renewed just now.");
    }
    const next = tokensFrom(sent.body, now(), tokens);
    if (!next) return stillValid(tokens) ? { ok: true, accessToken: tokens.accessToken, planUsage: account.planUsage } : failure("network", "bad_refresh_reply");
    if (next.idToken && next.idToken !== tokens.idToken) {
      // Straight from the token endpoint over TLS: the claims must still name
      // this registration and this account.
      const claims = decodeJwt(next.idToken)?.payload;
      if (!claims || claims.iss !== ISSUER || !audienceIncludes(claims.aud, account.clientId) || claims.sub !== account.subject) {
        clearTokens(true);
        await persist();
        return failure("auth", "account_mismatch", "The renewed ChatGPT sign-in named a different account; sign in again.", { reauth: true });
      }
    }
    if (typeof sent.body.scope === "string") {
      account.scopes = scopeList(sent.body.scope);
      account.planUsage = account.scopes.includes(PLAN_SCOPE);
    }
    record.tokens = next; // access, refresh and ID token and the expiry, together
    await persist();
    return { ok: true, accessToken: next.accessToken, planUsage: account.planUsage };
  }

  // The access token to use now, refreshed first when it is within a minute
  // of expiring (or `force`). Concurrent callers share one refresh.
  async function ensureFresh({ signal, force = false } = {}) {
    const saved = await ready();
    if (!saved.account || !saved.tokens) return failure("auth", "signed_out", "Sign in with ChatGPT first.", saved.account?.signInNeeded ? { reauth: true } : undefined);
    const expiresAt = saved.tokens.expiresAt;
    if (!force && !refreshing && (expiresAt === null || expiresAt - now() > REFRESH_MARGIN_MS)) {
      return { ok: true, accessToken: saved.tokens.accessToken, planUsage: saved.account.planUsage };
    }
    if (!refreshing) refreshing = refreshNow().catch(() => failure("network", "refresh_failed")).finally(() => { refreshing = null; });
    const pending = refreshing;
    if (!(signal instanceof AbortSignal)) return pending;
    if (signal.aborted) return failure("canceled", "canceled");
    return new Promise((resolve) => {
      const onAbort = () => resolve(failure("canceled", "canceled"));
      signal.addEventListener("abort", onAbort, { once: true });
      pending.then((result) => { signal.removeEventListener("abort", onAbort); resolve(result); });
    });
  }

  // ---- status, sign-out, limits ----

  async function status() {
    const saved = await ready();
    const at = now();
    const account = saved.account;
    const signedIn = Boolean(account && saved.tokens);
    const limited = Boolean(limit && limit.until > at);
    return {
      ok: true,
      provider: PROVIDER_ID,
      signedIn,
      signingIn: Boolean(signing),
      email: signedIn ? account.email : null,
      planUsage: signedIn && account.planUsage === true,
      needsSignIn: Boolean(account && !saved.tokens && account.signInNeeded),
      limited,
      limitedUntil: limited ? limit.until : null,
      manageUsageUrl: MANAGE_USAGE_URL,
    };
  }

  // Revokes the refresh token at OpenAI (best effort; 200 even for a dead
  // one), then forgets the tokens. The registration (issued client id, email,
  // subject) is kept for the next sign-in unless `forget`.
  async function signOut({ forget = false, signal } = {}) {
    const saved = await ready();
    cancel();
    const account = saved.account;
    const tokens = saved.tokens;
    let revoked = false;
    if (account && tokens?.refreshToken) revoked = await revokeToken(account.clientId, tokens.refreshToken, signal instanceof AbortSignal ? signal : null);
    saved.tokens = null;
    if (saved.account) saved.account.signInNeeded = false;
    if (forget) saved.account = null;
    limit = null;
    modelsCache = null;
    await persist();
    log(`[chatgpt-plan] signed out${revoked ? " (revoked at OpenAI)" : ""}`);
    return { ok: true, revoked };
  }

  function clearLimit() {
    const had = Boolean(limit);
    limit = null;
    return had;
  }

  // ---- models ----

  async function listModels({ signal, force = false } = {}) {
    const fresh = await ensureFresh({ signal });
    if (!fresh.ok) return fresh;
    if (!force && modelsCache && now() - modelsCache.at < MODELS_TTL_MS) return { ok: true, models: clone(modelsCache.list) };
    const sent = await call(endpoints.models, { method: "GET", headers: { Authorization: `Bearer ${fresh.accessToken}`, Accept: "application/json" } }, signal instanceof AbortSignal ? signal : null);
    if (sent.failed) return sent.failed;
    if (!sent.response.ok) return mapError({ status: sent.response.status, body: sent.body ?? sent.text, retryAfterMs: retryAfterOf(header(sent.response, "retry-after"), now()) });
    const list = modelsFrom(sent.body);
    modelsCache = { at: now(), list };
    return { ok: true, models: clone(list) };
  }

  // ---- inference ----

  function emit(onDelta, delta) {
    if (typeof onDelta !== "function") return;
    try { onDelta(delta); } catch { /* a listener's error is not the call's */ }
  }

  function handleEvent(evt, state, onDelta) {
    const data = evt.json;
    if (!object(data)) return;
    const type = str(data.type) || evt.event;
    if (type === "response.created" || type === "response.in_progress") {
      if (str(data.response?.model)) state.model = data.response.model;
    } else if (type === "response.output_text.delta") {
      if (typeof data.delta === "string" && data.delta) {
        state.text += data.delta;
        state.emitted = true;
        emit(onDelta, { type: "text", delta: data.delta });
      }
    } else if (type === "response.reasoning_summary_text.delta") {
      if (typeof data.delta === "string" && data.delta) {
        const key = `${data.item_id ?? ""}:${data.summary_index ?? 0}`;
        if (state.reasoning && state.summaryKey !== key) state.reasoning += "\n";
        state.summaryKey = key;
        state.reasoning += data.delta;
        state.emitted = true;
        emit(onDelta, { type: "reasoning", delta: data.delta });
      }
    } else if (type === "response.completed") {
      state.terminal = { kind: "completed", response: object(data.response) ? data.response : {} };
    } else if (type === "response.incomplete") {
      state.terminal = { kind: "incomplete", response: object(data.response) ? data.response : {} };
    } else if (type === "response.failed") {
      state.terminal = { kind: "failed", error: object(data.response?.error) ? data.response.error : {} };
    } else if (type === "error") {
      state.terminal = { kind: "failed", error: object(data.error) ? data.error : data };
    }
  }

  function finished(state, requestId) {
    const terminal = state.terminal;
    if (!terminal) return failure("network", "stream_ended", "ChatGPT plan: the stream ended before response.completed.", { emitted: state.emitted, partial: state.text, requestId });
    if (terminal.kind === "failed") {
      const error = terminal.error ?? {};
      return { ...mapError({ code: error.code, message: error.message, param: error.param }), emitted: state.emitted, requestId };
    }
    const response = terminal.response ?? {};
    if (terminal.kind === "incomplete") {
      const reason = clip(response.incomplete_details?.reason || "incomplete", 60);
      return failure("validation", `incomplete_${reason}`, `ChatGPT plan: the reply stopped before it finished (${reason}).`, { emitted: state.emitted, partial: state.text || outputText(response), requestId });
    }
    const text = state.text || outputText(response);
    const reasoning = state.reasoning || outputReasoning(response);
    const model = str(response.model) || state.model;
    const usage = object(response.usage) ? clone(response.usage) : {};
    const base = { model, usage, tokenUsage: tokenUsageOf(usage), costUsd: null, requestId, provider: PROVIDER_ID };
    // A reasoning model can spend the whole budget thinking; like
    // chatCompletion, reasoning that holds the JSON stands in for the text.
    if (!text.trim() && reasoning.includes("{")) return { ok: true, text: reasoning, reasoning, finish: str(response.status) || "completed", ...base };
    if (!text.trim()) return failure("validation", "empty_reply", `ChatGPT plan: empty reply (reasoning=${reasoning.length} chars).`, { ...base, emitted: state.emitted });
    return { ok: true, text, reasoning, finish: str(response.status) || "completed", ...base };
  }

  async function streamOnce(body, accessToken, { signal, deadline, onDelta }) {
    const remaining = deadline - now();
    if (remaining <= 0) return failure("timeout", "timeout", KIND_TEXT.timeout, { emitted: false });
    const timeout = AbortSignal.timeout(Math.min(remaining, MAX_TIMER_MS));
    const combined = signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
    const stopped = (state) => (signal instanceof AbortSignal && signal.aborted
      ? failure("canceled", "canceled", KIND_TEXT.canceled, { emitted: state.emitted, partial: state.text })
      : failure("timeout", "timeout", KIND_TEXT.timeout, { emitted: state.emitted, partial: state.text }));
    const state = { text: "", reasoning: "", model: body.model, emitted: false, summaryKey: null, terminal: null };
    let response;
    try {
      response = await fetchImpl(endpoints.responses, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: combined,
        redirect: "error",
      });
    } catch {
      return combined.aborted ? stopped(state) : failure("network", "network_error", KIND_TEXT.network, { emitted: false });
    }
    const requestId = str(header(response, "x-request-id")) || null;
    if (!response.ok) {
      let text = "";
      try { text = await response.text(); } catch { text = ""; }
      return { ...mapError({ status: response.status, body: text, retryAfterMs: retryAfterOf(header(response, "retry-after"), now()) }), emitted: false, requestId };
    }
    if (/application\/json/i.test(String(header(response, "content-type") || ""))) {
      // Not a stream: a whole response object (or an error) came back.
      let json = null;
      try { json = JSON.parse(await response.text()); } catch { json = null; }
      if (object(json) && json.status === "completed") state.terminal = { kind: "completed", response: json };
      else if (object(json) && json.status === "incomplete") state.terminal = { kind: "incomplete", response: json };
      else if (object(json) && (object(json.error) || json.status === "failed")) state.terminal = { kind: "failed", error: object(json.error) ? json.error : {} };
      return finished(state, requestId);
    }
    const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
    if (!reader) return failure("network", "no_stream", "ChatGPT plan: the reply had no stream.", { emitted: false, requestId });
    const decoder = new TextDecoder("utf-8");
    const parser = createSseParser();
    try {
      while (!state.terminal) {
        const { done, value } = await reader.read();
        const events = done ? [...parser.push(decoder.decode()), ...parser.end()] : parser.push(decoder.decode(value, { stream: true }));
        for (const evt of events) {
          handleEvent(evt, state, onDelta);
          if (state.terminal) break;
        }
        if (done) break;
      }
    } catch {
      if (combined.aborted) return { ...stopped(state), requestId };
      return failure("network", "stream_error", "ChatGPT plan: the stream broke off.", { emitted: state.emitted, partial: state.text, requestId });
    } finally {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already closed */ }
    }
    return finished(state, requestId);
  }

  // One Responses call on the owner's ChatGPT plan, in the result shape
  // chatCompletion's callers read: { ok: true, text, reasoning, finish,
  // model, usage, tokenUsage, costUsd: null } or { ok: false, errorKind,
  // code, error, retryAfterMs?, ... }.
  async function respond(respondOptions = {}) {
    const opts = object(respondOptions) ? respondOptions : {};
    const startedAt = now();
    const signal = opts.signal instanceof AbortSignal ? opts.signal : null;
    const deadline = startedAt + timeoutOf(opts.timeoutMs, RESPOND_TIMEOUT_MS);
    const done = (result) => {
      const { emitted: _emitted, ...rest } = result;
      return { provider: PROVIDER_ID, model: str(opts.model) || null, ...rest, elapsedMs: Math.max(0, now() - startedAt) };
    };
    const saved = await ready();
    if (limit && limit.until > now()) {
      return done(failure("limit", limit.code, limit.error, { retryAfterMs: limit.until - now(), limitedUntil: limit.until, toppedOut: true, manageUsageUrl: MANAGE_USAGE_URL }));
    }
    if (!saved.account || !saved.tokens) return done(failure("auth", "signed_out", "Sign in with ChatGPT first.", saved.account?.signInNeeded ? { reauth: true } : undefined));
    if (!saved.account.planUsage) return done(failure("eligibility", "plan_usage_disabled", "ChatGPT plan usage was not granted for this sign-in. Continue with ChatGPT again and allow it."));
    let body;
    try {
      body = requestBody(opts, { scrub });
    } catch (error) {
      return done(failure("unsupported", "bad_request", `ChatGPT plan: ${clip(error?.message, 160)}`));
    }
    if (signal?.aborted) return done(failure("canceled", "canceled"));
    let fresh = await ensureFresh({ signal });
    if (!fresh.ok) return done(fresh);
    if (!fresh.planUsage) return done(failure("eligibility", "plan_usage_disabled", "ChatGPT plan usage was not granted for this sign-in."));
    let token = fresh.accessToken;
    let renewed = false;
    let retries = 0;
    for (;;) {
      const result = await streamOnce(body, token, { signal, deadline, onDelta: opts.onDelta });
      if (result.ok) return done(result);
      // A 401 before any output: renew once and ask again.
      if (result.status === 401 && !renewed && !result.emitted) {
        renewed = true;
        fresh = await ensureFresh({ signal, force: true });
        if (!fresh.ok) return done(fresh);
        token = fresh.accessToken;
        continue;
      }
      if (result.status === 401) {
        clearTokens(true);
        await persist();
        log("[chatgpt-plan] the ChatGPT route refused the renewed sign-in; a new sign-in is needed");
        return done({ ...result, reauth: true });
      }
      if (result.errorKind === "unavailable" && result.retryable && !result.emitted && retries < RETRY_503_MAX) {
        retries += 1;
        const wait = result.retryAfterMs ?? Math.min(RETRY_503_CAP_MS, retryBaseMs * 2 ** (retries - 1));
        if (wait > RETRY_503_CAP_MS || now() + wait >= deadline) return done(result);
        try { await sleep(wait, signal ?? undefined); } catch { return done(failure("canceled", "canceled")); }
        if (signal?.aborted) return done(failure("canceled", "canceled"));
        continue;
      }
      if (result.errorKind === "limit") {
        const until = now() + (result.retryAfterMs ?? limitPauseMs);
        limit = { until, code: result.code, error: result.error };
        log("[chatgpt-plan] usage limit reached; ChatGPT plan calls pause until it resets");
        return done({ ...result, limitedUntil: until });
      }
      return done(result);
    }
  }

  return { signIn, cancel, status, signOut, ensureFresh, listModels, respond, clearLimit, account: () => clone(publicAccount()) };
}

module.exports = {
  ISSUER, ENDPOINTS, RESOURCE, REGISTRATION_CLIENT_ID, AGENT_NAME, PLAN_SCOPE, SCOPES, MANAGE_USAGE_URL, LOOPBACK_HOST, CALLBACK_PATH, PROVIDER_ID,
  REJECTED_FIELDS, UNSUPPORTED_TOOLS, REFRESH_FATAL, ERROR_CODES, ERROR_KINDS, RETRY_503_MAX,
  createChatGptPlan, authorizeUrl, requestBody, parseSse, createSseParser, mapError, modelsFrom, verifyIdToken, decodeJwt, pkce, normalizeRecord, retryAfterOf,
};
