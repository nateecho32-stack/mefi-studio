import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import test from "node:test";
import plan from "../scripts/chatgpt-plan.cjs";

// scripts/chatgpt-plan.cjs against fake OpenAI servers on 127.0.0.1: a fake
// authorize step that redirects to Studio's loopback callback, a token
// endpoint that checks PKCE, a JWKS whose key (made here by node:crypto) signs
// the test ID tokens, /v1/models and a streaming /v1/responses. The "browser"
// is the injected openBrowser. No real network is reached.

const {
  createChatGptPlan, authorizeUrl, requestBody, parseSse, createSseParser, mapError, modelsFrom, verifyIdToken,
  ERROR_CODES, REJECTED_FIELDS, REFRESH_FATAL, SCOPES, PLAN_SCOPE, REGISTRATION_CLIENT_ID, RESOURCE, MANAGE_USAGE_URL, AGENT_NAME,
} = plan;

const ISSUER = "https://auth.openai.com";
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const HOST_ID = `urn:uuid:${UUID}`;
const ISSUED = "oaiapp_test123";
const SUBJECT = "user-abc";
const EMAIL = "owner@example.com";
const FULL_SCOPE = SCOPES.join(" ");
const NO_PLAN_SCOPE = SCOPES.filter((scope) => scope !== PLAN_SCOPE).join(" ");

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (publicKey, kid) => ({ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });
const JWK = jwkOf(keys.publicKey, "k1");
const sec = () => Math.floor(Date.now() / 1000);

function sign(claims, { key = keys.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${signature}`;
}
const claimsFor = (clientId, extra = {}) => ({ iss: ISSUER, aud: clientId, sub: SUBJECT, email: EMAIL, iat: sec(), exp: sec() + 3600, ...extra });

const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => resolve(raw));
});
const s256 = (verifier) => crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");

// Response handlers for /v1/responses.
const sse = (events, { status = 200, hang = false } = {}) => (req, res) => {
  res.writeHead(status, { "content-type": "text/event-stream", "x-request-id": "req_test" });
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  if (!hang) res.end();
};
const reply = (status, body, headers = {}) => (req, res) => {
  res.writeHead(status, { "content-type": "application/json", "x-request-id": "req_test", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const USAGE = { input_tokens: 12, output_tokens: 5, total_tokens: 17, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 } };
const OK_EVENTS = [
  { type: "response.created", response: { model: "gpt-6.1-sol", status: "in_progress" } },
  { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Think" },
  { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "ing." },
  { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "More." },
  { type: "response.output_text.delta", delta: "Hello, " },
  { type: "response.output_text.delta", delta: "world!" },
  { type: "response.completed", response: { model: "gpt-6.1-sol", status: "completed", usage: USAGE } },
];
const ok = () => sse(OK_EVENTS);

async function fakeOpenAI() {
  const fake = {
    calls: [],
    authorize: null,
    codes: new Map(),
    keys: [JWK],
    tokenScope: FULL_SCOPE,
    refreshes: 0,
    consent: (params) => ({ code: "CODE-1", state: params.state, scope: FULL_SCOPE, client_id: params.client_id === REGISTRATION_CLIENT_ID ? ISSUED : undefined }),
    idClaims: (entry) => claimsFor(entry.clientId, { nonce: entry.nonce }),
    onRefresh: (form, n) => [200, { access_token: `AT-${n + 1}`, refresh_token: `RT-${n + 1}`, id_token: sign(claimsFor(form.get("client_id"))), token_type: "Bearer", expires_in: 3600, scope: FULL_SCOPE }],
    modelsReply: { models: [] },
    responses: [],
    count: (path, method) => fake.calls.filter((call) => call.path === path && (!method || call.method === method)).length,
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const raw = await readBody(req);
    fake.calls.push({ method: req.method, path: url.pathname, headers: req.headers, body: raw });
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && url.pathname === "/authorize") {
      const params = Object.fromEntries(url.searchParams);
      fake.authorize = params;
      const answer = fake.consent(params);
      if (answer.code) fake.codes.set(answer.code, { challenge: params.code_challenge, nonce: params.nonce, clientId: answer.client_id ?? params.client_id, redirectUri: params.redirect_uri });
      const query = new URLSearchParams(Object.entries(answer).filter(([key, value]) => value !== undefined && key !== "path"));
      const target = new URL(params.redirect_uri);
      if (answer.path) target.pathname = answer.path;
      res.writeHead(302, { location: `${target.href}?${query}` });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      if (form.get("grant_type") === "authorization_code") {
        const entry = fake.codes.get(form.get("code"));
        if (!entry || s256(form.get("code_verifier") ?? "") !== entry.challenge || form.get("client_id") !== entry.clientId
          || form.get("redirect_uri") !== entry.redirectUri || form.get("resource") !== RESOURCE) return json(400, { error: "invalid_grant" });
        fake.codes.delete(form.get("code"));
        return json(200, { access_token: "AT-1", refresh_token: "RT-1", id_token: sign(fake.idClaims(entry)), token_type: "Bearer", expires_in: 3600, scope: fake.tokenScope });
      }
      if (form.get("grant_type") === "refresh_token") {
        fake.refreshes += 1;
        const [status, body] = fake.onRefresh(form, fake.refreshes);
        return json(status, body);
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (req.method === "POST" && url.pathname === "/revoke") return json(200, {});
    if (req.method === "GET" && url.pathname === "/jwks") return json(200, { keys: fake.keys });
    if (req.method === "GET" && url.pathname === "/v1/models") return json(200, fake.modelsReply);
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      const handler = fake.responses.shift() ?? ok();
      return handler(req, res, JSON.parse(raw));
    }
    return json(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fake.endpoints = { authorize: `${base}/authorize`, token: `${base}/token`, revoke: `${base}/revoke`, jwks: `${base}/jwks`, models: `${base}/v1/models`, responses: `${base}/v1/responses` };
  fake.close = () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  fake.bodies = (path) => fake.calls.filter((call) => call.path === path).map((call) => call.body);
  return fake;
}

// A browser that follows the fake authorize redirect back to the callback.
const follow = (url) => fetch(url).then((response) => response.text());

function signedInRecord({ expiresAt = Date.now() + 3600_000, planUsage = true } = {}) {
  return {
    version: 1, hostId: HOST_ID, welcomed: true,
    account: { clientId: ISSUED, email: EMAIL, subject: SUBJECT, scopes: planUsage ? [...SCOPES] : SCOPES.filter((scope) => scope !== PLAN_SCOPE), planUsage, signedInAt: Date.now() },
    tokens: { accessToken: "AT-1", refreshToken: "RT-1", idToken: sign(claimsFor(ISSUED)), expiresAt, savedAt: Date.now() },
  };
}

function makePlan(fake, { record = null, openBrowser = follow, sleep, ...deps } = {}) {
  const store = { record: record ? JSON.parse(JSON.stringify(record)) : null, saves: 0 };
  const logs = [];
  const sleeps = [];
  const instance = createChatGptPlan({
    fetch: globalThis.fetch, endpoints: fake.endpoints, openBrowser,
    randomUUID: () => UUID,
    save: async (next) => { store.record = JSON.parse(JSON.stringify(next)); store.saves += 1; },
    load: async () => store.record,
    log: (line) => logs.push(line),
    sleep: sleep ?? (async (ms) => { sleeps.push(ms); }),
    ...deps,
  });
  return { plan: instance, store, logs, sleeps };
}

// A GET with an exact Host header; fetch() would not let the test forge one.
function get(url, { host } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: "GET", headers: host ? { host } : {}, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(check, ms = 5_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const noSecrets = (lines, secrets) => {
  const text = lines.join("\n");
  for (const secret of secrets) assert.ok(!text.includes(secret), `the log must not carry ${secret}`);
};

// ---- pure helpers ----------------------------------------------------------------

test("authorizeUrl builds the registration request and the returning one", () => {
  const base = { hostId: HOST_ID, redirectUri: "http://127.0.0.1:1455/callback", state: "s".repeat(43), nonce: "n".repeat(43), challenge: "c".repeat(43) };
  const first = new URL(authorizeUrl(base));
  assert.equal(`${first.origin}${first.pathname}`, "https://auth.openai.com/api/accounts/authorize");
  const params = Object.fromEntries(first.searchParams);
  assert.deepEqual(params, {
    client_id: "dynamic_agent_client", response_type: "code", redirect_uri: "http://127.0.0.1:1455/callback",
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", resource: "https://api.openai.com/v1",
    state: base.state, nonce: base.nonce, code_challenge: base.challenge, code_challenge_method: "S256", ext_agent_host_id: HOST_ID,
    agent_name_hint: "Mefi's Studio AI+",
  });
  assert.ok(!first.search.includes("+"), "spaces are %20, never a bare +");

  const again = Object.fromEntries(new URL(authorizeUrl({ ...base, clientId: ISSUED, loginHint: EMAIL })).searchParams);
  assert.equal(again.client_id, ISSUED);
  assert.equal(again.agent_name_hint, undefined, "a returning sign-in omits agent_name_hint");
  assert.equal(again.ext_agent_host_id, HOST_ID);
  assert.equal(again.login_hint, EMAIL);
  const hinted = Object.fromEntries(new URL(authorizeUrl({ ...base, clientId: ISSUED, loginHint: EMAIL, idTokenHint: "a.b.c" })).searchParams);
  assert.equal(hinted.id_token_hint, "a.b.c");
  assert.equal(hinted.login_hint, undefined);

  assert.throws(() => authorizeUrl({ ...base, redirectUri: "http://localhost:1455/callback" }), /127\.0\.0\.1/);
  assert.throws(() => authorizeUrl({ ...base, redirectUri: "http://127.0.0.1:1455/auth/callback" }), /callback/);
  assert.throws(() => authorizeUrl({ ...base, hostId: EMAIL }), /hostId/, "a host id is opaque, never an email");
  assert.throws(() => authorizeUrl({ ...base, state: "" }), /state/);
});

test("requestBody sends stream and store, moves system text to instructions and drops rejected fields", () => {
  const body = requestBody({
    model: "gpt-6.1-sol", temperature: 0.2, max_tokens: 100, reasoning_effort: "low", service_tier: "priority",
    messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "tool", content: "x" }],
    tools: [{ type: "web_search" }, { type: "image_generation" }, { type: "file_search" }, { type: "mcp", server_url: "https://x" }, { type: "computer_use_preview" }],
    extra: Object.fromEntries([...REJECTED_FIELDS.map((field) => [field, 1]), ["stream", false], ["store", true], ["model", "other"], ["text", { verbosity: "low" }]]),
  });
  assert.deepEqual(body, {
    text: { verbosity: "low" },
    model: "gpt-6.1-sol",
    input: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }],
    instructions: "Be brief.",
    reasoning: { effort: "low", summary: "auto" },
    service_tier: "priority",
    tools: [{ type: "web_search" }],
    stream: true,
    store: false,
  });
  for (const field of REJECTED_FIELDS) assert.equal(field in body, false, `${field} must not be sent`);

  const plain = requestBody({ model: "m", instructions: "Rules", input: "Question" });
  assert.deepEqual(plain, { model: "m", input: [{ role: "user", content: "Question" }], instructions: "Rules", stream: true, store: false });
  const fromItems = requestBody({ model: "m", input: [{ role: "system", content: [{ type: "input_text", text: "Sys" }] }, { role: "developer", content: "Dev" }, { role: "user", content: "Q" }], summary: null, effort: "high" });
  assert.equal(fromItems.instructions, "Sys");
  assert.deepEqual(fromItems.input.map((item) => item.role), ["developer", "user"], "an explicit system item never reaches input");
  assert.deepEqual(fromItems.reasoning, { effort: "high" });
  const scrubbed = requestBody({ model: "m", messages: [{ role: "user", content: "C:\\Users\\me\\x" }] }, { scrub: (text) => text.replace("C:\\Users\\me", "~") });
  assert.equal(scrubbed.input[0].content, "~\\x");
  assert.throws(() => requestBody({ messages: [{ role: "user", content: "x" }] }), /model/);
  assert.throws(() => requestBody({ model: "m", messages: [{ role: "system", content: "only" }] }), /input/);
});

test("parseSse reads events across chunk boundaries and line endings", () => {
  const events = parseSse(": keep-alive\r\nevent: response.output_text.delta\r\ndata: {\"delta\":\"a\"}\r\n\r\ndata: line one\ndata: line two\n\ndata: [DONE]\n\n");
  assert.deepEqual(events, [
    { event: "response.output_text.delta", data: "{\"delta\":\"a\"}", json: { delta: "a" } },
    { event: "message", data: "line one\nline two", json: null },
  ]);
  const parser = createSseParser();
  const got = [];
  for (const chunk of ["event: x\r", "\ndata: {\"n\":", "1}\r", "\n\r", "\nevent: y\ndata: {}"]) got.push(...parser.push(chunk));
  got.push(...parser.end());
  assert.deepEqual(got.map((event) => [event.event, event.json]), [["x", { n: 1 }], ["y", {}]], "a \\r\\n split across chunks is one line break");
  assert.throws(() => createSseParser({ maxBuffer: 8 }).push("data: 0123456789"), /too long/);
});

test("mapError maps every structured code, bare statuses and detail bodies", () => {
  const expected = {
    subscription_sharing_user_not_eligible: ["eligibility", 403, false],
    subscription_sharing_usage_limit_exceeded: ["limit", 429, false],
    subscription_sharing_usage_unavailable: ["unavailable", 503, true],
    subscription_sharing_unsupported_capability: ["unsupported", 400, false],
    subscription_sharing_route_not_supported: ["unsupported", 403, false],
    subscription_sharing_invalid_user: ["auth", 401, false],
    subscription_sharing_user_unavailable: ["unavailable", 503, true],
  };
  for (const [code, [kind, status, retryable]] of Object.entries(expected)) {
    const mapped = mapError({ status, body: { error: { code, message: "why", param: code.includes("capability") ? "tools[0]" : undefined } } });
    assert.equal(mapped.ok, false);
    assert.equal(mapped.errorKind, kind, code);
    assert.equal(mapped.code, code);
    assert.equal(mapped.status, status);
    assert.equal(mapped.retryable, retryable, code);
    assert.match(mapped.error, /^ChatGPT plan: /);
    // The same code in a response.failed event (no HTTP status) maps the same.
    assert.equal(mapError({ code }).errorKind, kind);
    assert.equal(mapError({ code }).status, status);
  }
  assert.equal(mapError({ status: 429, body: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }).manageUsageUrl, MANAGE_USAGE_URL);
  assert.equal(mapError({ code: "subscription_sharing_invalid_user" }).reauth, true);
  assert.equal(mapError({ status: 400, body: { error: { code: "subscription_sharing_unsupported_capability", param: "service_tier" } } }).param, "service_tier");
  assert.equal(mapError({ status: 403, body: { error: { code: "chatpass_v2_scope_not_authorized" } } }).errorKind, "auth");
  // {"detail": ...} is diagnostic text, never a machine-readable code.
  const detail = mapError({ status: 403, body: "{\"detail\":\"subscription_sharing_usage_limit_exceeded is not you\"}" });
  assert.equal(detail.errorKind, "eligibility");
  assert.equal(detail.code, "http_403");
  assert.match(detail.error, /is not you/);
  assert.deepEqual([401, 403, 429, 500, 503, 400, 408, 0].map((status) => mapError({ status }).errorKind), ["auth", "eligibility", "limit", "unavailable", "unavailable", "unsupported", "timeout", "network"]);
  assert.equal(mapError({ status: 500 }).retryable, false, "only 503 retries");
  assert.equal(mapError({ status: 503 }).retryable, true);
  assert.equal(mapError({ status: 429, retryAfterMs: 5000 }).retryAfterMs, 5000);
  assert.equal(mapError({ status: 502, body: "<html>bad gateway</html>" }).errorKind, "unavailable");
});

test("modelsFrom keeps listed models in the server's order", () => {
  const models = modelsFrom({ models: [
    { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" },
    { slug: "hidden", display_name: "Hidden", visibility: "hide" },
    { slug: "gpt-6-luna", visibility: "list", description: "Fast" },
    { display_name: "no slug", visibility: "list" },
  ] });
  assert.deepEqual(models, [{ slug: "gpt-6.1-sol", name: "GPT-6.1 Sol" }, { slug: "gpt-6-luna", name: "gpt-6-luna", description: "Fast" }]);
  assert.deepEqual(modelsFrom({ data: [{ id: "x" }] }), []);
});

test("verifyIdToken checks the signature, issuer, audience, expiry and nonce", () => {
  const good = claimsFor(ISSUED, { nonce: "N1" });
  const check = (token, extra = {}) => verifyIdToken(token, { keys: [JWK], clientId: ISSUED, nonce: "N1", ...extra });
  assert.equal(check(sign(good)).ok, true);
  assert.equal(check(sign(good)).claims.sub, SUBJECT);
  assert.equal(check(sign(good, { key: stranger.privateKey })).code, "signature");
  assert.equal(check(sign(good, { kid: "k9" })).code, "kid");
  assert.equal(check(sign(good, { alg: "HS256" })).code, "alg");
  assert.equal(check(`${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(good)).toString("base64url")}.`).code, "alg");
  assert.equal(check(sign({ ...good, iss: "https://evil.example" })).code, "issuer");
  assert.equal(check(sign({ ...good, aud: "oaiapp_other" })).code, "audience");
  assert.equal(check(sign({ ...good, aud: [ISSUED, "x"], azp: "x" })).code, "audience");
  assert.equal(check(sign({ ...good, exp: sec() - 3600 })).code, "expired");
  assert.equal(check(sign({ ...good, nonce: "N2" })).code, "nonce");
  assert.equal(check(sign({ ...good, nonce: undefined })).code, "nonce");
  assert.equal(check("not-a-jwt").code, "malformed");
});

// ---- sign-in -----------------------------------------------------------------------

test("a first sign-in registers, verifies the ID token and keeps only the issued client id", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, store, logs } = makePlan(fake);
    const result = await chatgpt.signIn();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.account, { email: EMAIL, subject: SUBJECT, clientId: ISSUED, hostId: HOST_ID, planUsage: true });
    assert.equal(result.welcome, true, "the first sign-in with plan usage shows the one-time welcome");

    const sent = fake.authorize;
    assert.equal(sent.client_id, REGISTRATION_CLIENT_ID);
    assert.equal(sent.agent_name_hint, AGENT_NAME);
    assert.equal(sent.ext_agent_host_id, HOST_ID);
    assert.equal(sent.response_type, "code");
    assert.equal(sent.scope, FULL_SCOPE);
    assert.equal(sent.resource, RESOURCE);
    assert.equal(sent.code_challenge_method, "S256");
    assert.match(sent.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.ok(sent.state && sent.nonce && sent.state !== sent.nonce);
    const exchange = new URLSearchParams(fake.bodies("/token")[0]);
    assert.equal(exchange.get("grant_type"), "authorization_code");
    assert.equal(exchange.get("client_id"), ISSUED, "the code is exchanged under the issued id");
    assert.equal(exchange.get("redirect_uri"), sent.redirect_uri);
    assert.equal(exchange.get("client_secret"), null, "public client");

    assert.equal(store.record.account.clientId, ISSUED);
    assert.equal(store.record.tokens.accessToken, "AT-1");
    assert.equal(store.record.hostId, HOST_ID);
    assert.ok(!JSON.stringify(store.record).includes(REGISTRATION_CLIENT_ID), "dynamic_agent_client is never saved");
    noSecrets(logs, ["AT-1", "RT-1", "CODE-1", EMAIL, sent.state]);
    await assert.rejects(get(sent.redirect_uri), "the callback listener is closed after the sign-in");

    const shown = await chatgpt.status();
    assert.equal(shown.signedIn, true);
    assert.equal(shown.planUsage, true);
    assert.equal(shown.email, EMAIL);
    assert.ok(!JSON.stringify(shown).includes("AT-1") && !JSON.stringify(shown).includes("RT-1"), "status never carries a token");

    const again = await chatgpt.signIn();
    assert.equal(again.ok, true);
    assert.equal(again.welcome, false, "the welcome is shown once");
    assert.equal(fake.authorize.client_id, ISSUED);
    assert.equal(fake.authorize.agent_name_hint, undefined);
    assert.equal(fake.authorize.ext_agent_host_id, HOST_ID, "the host id is stable");
    assert.equal(fake.authorize.login_hint, EMAIL);
    assert.equal(fake.authorize.id_token_hint, undefined, "no ID token rides the browser URL");
    assert.notEqual(fake.authorize.state, sent.state, "fresh state per attempt");
  } finally {
    await fake.close();
  }
});

test("a callback with the wrong state, path or host is refused and the wait goes on", async () => {
  const fake = await fakeOpenAI();
  try {
    let opened = null;
    const { plan: chatgpt } = makePlan(fake, { openBrowser: (url) => { opened = url; } });
    const pending = chatgpt.signIn();
    await waitFor(() => opened);
    const params = new URL(opened).searchParams;
    const callback = new URL(params.get("redirect_uri"));
    const port = callback.port;
    assert.equal(await get(`${callback.href}?code=X&state=wrong`), 400);
    assert.equal(await get(`${callback.href}?error=access_denied&state=wrong`), 400, "a forged error cannot end the flow");
    assert.equal(await get(`http://127.0.0.1:${port}/auth/callback?code=X&state=${params.get("state")}`), 404);
    assert.equal(await get(`${callback.href}?code=X&state=${params.get("state")}`, { host: `localhost:${port}` }), 400);
    assert.equal((await chatgpt.status()).signingIn, true);
    assert.equal((await chatgpt.signIn()).errorKind, "busy", "one sign-in at a time");
    await follow(opened);
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    await fake.close();
  }
});

test("a nonce the ID token does not repeat fails the sign-in and hands the grant back", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.idClaims = (entry) => claimsFor(entry.clientId, { nonce: "someone-elses-nonce" });
    const { plan: chatgpt, store } = makePlan(fake);
    const result = await chatgpt.signIn();
    assert.equal(result.ok, false);
    assert.equal(result.errorKind, "auth");
    assert.equal(result.code, "id_token_nonce");
    const revoke = new URLSearchParams(fake.bodies("/revoke")[0]);
    assert.equal(revoke.get("token"), "RT-1");
    assert.equal(revoke.get("token_type_hint"), "refresh_token");
    assert.equal(revoke.get("client_id"), ISSUED);
    assert.equal(store.record?.tokens ?? null, null);
    assert.equal((await chatgpt.status()).signedIn, false);
  } finally {
    await fake.close();
  }
});

test("an ID token signed by an unknown key is refused after one JWKS refetch", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.keys = [jwkOf(stranger.publicKey, "k0")];
    const { plan: chatgpt } = makePlan(fake);
    const missing = await chatgpt.signIn();
    assert.equal(missing.code, "id_token_kid");
    assert.equal(fake.count("/jwks"), 2, "an unknown kid refetches the key set once");
    fake.keys = [jwkOf(stranger.publicKey, "k1")];
    const forged = await chatgpt.signIn();
    assert.equal(forged.code, "id_token_signature");
  } finally {
    await fake.close();
  }
});

test("without chatgpt.tokens.use.direct the sign-in is kept and plan usage is off", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.tokenScope = NO_PLAN_SCOPE;
    fake.consent = (params) => ({ code: "CODE-1", state: params.state, scope: NO_PLAN_SCOPE, client_id: ISSUED });
    const { plan: chatgpt } = makePlan(fake);
    const result = await chatgpt.signIn();
    assert.equal(result.ok, true);
    assert.equal(result.account.planUsage, false);
    assert.equal(result.welcome, false, "no 'You're using your ChatGPT plan' without plan usage");
    const shown = await chatgpt.status();
    assert.equal(shown.signedIn, true);
    assert.equal(shown.planUsage, false);
    const answer = await chatgpt.respond({ model: "gpt-6.1-sol", input: "Hi" });
    assert.equal(answer.errorKind, "eligibility");
    assert.equal(answer.code, "plan_usage_disabled");
    assert.equal(fake.count("/v1/responses"), 0, "no inference without the scope");
  } finally {
    await fake.close();
  }
});

test("access_denied, a missing registration, a timeout and a cancel each end the sign-in", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.consent = (params) => ({ error: "access_denied", state: params.state });
    let result = await makePlan(fake).plan.signIn();
    assert.equal(result.errorKind, "canceled");
    assert.equal(result.code, "access_denied");
    assert.equal(fake.count("/token"), 0, "a denied sign-in exchanges nothing");

    fake.consent = (params) => ({ code: "CODE-1", state: params.state, scope: FULL_SCOPE });
    result = await makePlan(fake).plan.signIn();
    assert.equal(result.code, "no_client_id", "a registration must come back with its issued client id");

    result = await makePlan(fake, { openBrowser: () => {} }).plan.signIn({ timeoutMs: 100 });
    assert.equal(result.errorKind, "timeout");

    let opened = null;
    const controller = new AbortController();
    const first = makePlan(fake, { openBrowser: (url) => { opened = url; } });
    const pending = first.plan.signIn({ signal: controller.signal });
    await waitFor(() => opened);
    controller.abort();
    result = await pending;
    assert.equal(result.errorKind, "canceled");
    await assert.rejects(get(new URL(opened).searchParams.get("redirect_uri")), "a canceled sign-in closes its listener");

    opened = null;
    const second = makePlan(fake, { openBrowser: (url) => { opened = url; } });
    const waiting = second.plan.signIn();
    await waitFor(() => opened);
    assert.equal(second.plan.cancel(), true);
    assert.equal((await waiting).errorKind, "canceled");
    assert.equal(second.plan.cancel(), false);
  } finally {
    await fake.close();
  }
});

test("a returning sign-in that comes back as another account is refused", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.idClaims = (entry) => claimsFor(entry.clientId, { nonce: entry.nonce, sub: "someone-else" });
    const { plan: chatgpt, store } = makePlan(fake, { record: signedInRecord() });
    const result = await chatgpt.signIn();
    assert.equal(result.code, "account_mismatch");
    assert.equal(store.record.tokens.accessToken, "AT-1", "the saved account's credentials are not replaced");
  } finally {
    await fake.close();
  }
});

// ---- models and inference -------------------------------------------------------------

test("listModels asks with the bearer token and keeps listed models in order", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.modelsReply = { models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" }, { slug: "internal", visibility: "hide" }] };
    const { plan: chatgpt } = makePlan(fake, { record: signedInRecord() });
    assert.deepEqual(await chatgpt.listModels(), { ok: true, models: [{ slug: "gpt-6.1-sol", name: "GPT-6.1 Sol" }] });
    assert.equal(fake.calls.find((call) => call.path === "/v1/models").headers.authorization, "Bearer AT-1");
    await chatgpt.listModels();
    assert.equal(fake.count("/v1/models"), 1, "the list is cached");
    await chatgpt.listModels({ force: true });
    assert.equal(fake.count("/v1/models"), 2);
  } finally {
    await fake.close();
  }
});

test("respond streams text, reasoning and usage and sends only what the route accepts", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, logs } = makePlan(fake, { record: signedInRecord() });
    const deltas = [];
    const result = await chatgpt.respond({
      model: "gpt-6.1-sol", effort: "low", serviceTier: "priority", onDelta: (delta) => deltas.push(delta),
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Say hello" }],
      extra: { metadata: { a: 1 }, user: "u", temperature: 1, max_output_tokens: 9 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, "Hello, world!");
    assert.equal(result.reasoning, "Thinking.\nMore.");
    assert.equal(result.model, "gpt-6.1-sol");
    assert.equal(result.finish, "completed");
    assert.equal(result.provider, "chatgpt");
    assert.equal(result.costUsd, null, "a plan call is not a metered receipt");
    assert.deepEqual(result.usage, USAGE);
    assert.deepEqual(result.tokenUsage, { inputTokens: 12, outputTokens: 5, totalTokens: 17, cacheReadTokens: 2, reasoningTokens: 3 });
    assert.equal(result.requestId, "req_test");
    assert.deepEqual(deltas.map((delta) => `${delta.type}:${delta.delta}`), ["reasoning:Think", "reasoning:ing.", "reasoning:More.", "text:Hello, ", "text:world!"]);

    const call = fake.calls.find((entry) => entry.path === "/v1/responses");
    assert.equal(call.headers.authorization, "Bearer AT-1");
    const body = JSON.parse(call.body);
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.instructions, "Be brief.");
    assert.deepEqual(body.input, [{ role: "user", content: "Say hello" }]);
    assert.deepEqual(body.reasoning, { effort: "low", summary: "auto" });
    assert.equal(body.service_tier, "priority");
    for (const field of ["metadata", "user", "temperature", "max_output_tokens"]) assert.equal(field in body, false, field);
    noSecrets(logs, ["AT-1", "RT-1"]);
  } finally {
    await fake.close();
  }
});

test("a completed reply read from the final response object when no deltas came", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(sse([{ type: "response.completed", response: { model: "m", status: "completed", usage: USAGE, output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "why" }] },
      { type: "message", content: [{ type: "output_text", text: "from output" }] },
    ] } }]));
    const result = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(result.text, "from output");
    assert.equal(result.reasoning, "why");
    fake.responses.push(sse([{ type: "response.completed", response: { model: "m", status: "completed" } }]));
    const empty = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(empty.errorKind, "validation");
  } finally {
    await fake.close();
  }
});

test("every structured error code maps to its kind, with retries only for 503s and a renewal for 401s", async () => {
  const fake = await fakeOpenAI();
  try {
    for (const [code, { kind, status, retryable }] of Object.entries(ERROR_CODES)) {
      fake.calls.length = 0;
      fake.refreshes = 0;
      fake.responses = [reply(status, { error: { code, message: "m" } }), reply(status, { error: { code, message: "m" } }), reply(status, { error: { code, message: "m" } })];
      const { plan: chatgpt, sleeps } = makePlan(fake, { record: signedInRecord() });
      const result = await chatgpt.respond({ model: "m", input: "q" });
      assert.equal(result.ok, false, code);
      assert.equal(result.errorKind, kind, code);
      assert.equal(result.code, code);
      const attempts = fake.count("/v1/responses");
      if (retryable) {
        assert.equal(attempts, 3, `${code}: the first try and two bounded retries`);
        assert.deepEqual(sleeps, [1000, 2000]);
      } else if (status === 401) {
        assert.equal(attempts, 2, `${code}: renewed once, then asked again`);
        assert.equal(fake.refreshes, 1);
        assert.equal(result.reauth, true);
        assert.equal((await chatgpt.status()).needsSignIn, true);
      } else {
        assert.equal(attempts, 1, `${code}: never retried`);
      }
      assert.ok(!("emitted" in result));
    }
  } finally {
    await fake.close();
  }
});

test("a usage limit pauses later calls without reaching OpenAI and never falls back", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(reply(429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }, { "retry-after": "120" }));
    const first = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(first.errorKind, "limit");
    assert.equal(first.retryAfterMs, 120_000);
    assert.equal(first.manageUsageUrl, MANAGE_USAGE_URL);
    assert.ok(first.limitedUntil > Date.now());
    const second = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(second.errorKind, "limit");
    assert.equal(second.toppedOut, true, "a paused plan makes no call");
    assert.equal(fake.count("/v1/responses"), 1);
    assert.equal((await chatgpt.status()).limited, true);
    assert.equal(chatgpt.clearLimit(), true);
    assert.equal((await chatgpt.respond({ model: "m", input: "q" })).ok, true);
    assert.equal(fake.calls.filter((call) => call.path !== "/v1/responses").length, 0, "nothing else is dialled");
  } finally {
    await fake.close();
  }
});

test("stream failures: response.failed, error events, a cut stream, an incomplete reply and a detail body", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "part" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "m" } } }]));
    assert.equal((await chatgpt.respond({ model: "m", input: "q" })).errorKind, "limit");
    chatgpt.clearLimit();

    fake.responses.push(sse([{ type: "error", code: "subscription_sharing_unsupported_capability", message: "no", param: "tools[0]" }]));
    const unsupported = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(unsupported.errorKind, "unsupported");
    assert.equal(unsupported.param, "tools[0]");

    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "half" }]));
    const cut = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(cut.errorKind, "network");
    assert.equal(cut.code, "stream_ended", "success only on response.completed");
    assert.equal(cut.partial, "half");

    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "so" }, { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" } } }]));
    const incomplete = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.code, "incomplete_content_filter");

    fake.responses.push(reply(403, { detail: "Workspace policy blocks this app." }));
    const policy = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(policy.errorKind, "eligibility");
    assert.match(policy.error, /Workspace policy/);

    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "x" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_unavailable" } } }]));
    const before = fake.count("/v1/responses");
    const late = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(late.errorKind, "unavailable");
    assert.equal(fake.count("/v1/responses") - before, 1, "no retry once output was streamed");
  } finally {
    await fake.close();
  }
});

test("503s retry twice at most, then answer; a retry that succeeds is a success", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, sleeps } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(reply(503, { error: { code: "subscription_sharing_user_unavailable" } }), reply(503, "{\"detail\":\"busy\"}"));
    const result = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(result.ok, true);
    assert.equal(fake.count("/v1/responses"), 3);
    assert.deepEqual(sleeps, [1000, 2000]);
    fake.responses.push(reply(503, {}, { "retry-after": "60" }));
    const long = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(long.errorKind, "unavailable");
    assert.equal(long.retryAfterMs, 60_000, "a long Retry-After is handed back, not slept on");
    assert.equal(fake.count("/v1/responses"), 4);
  } finally {
    await fake.close();
  }
});

test("a 401 renews the token once and asks again with the new one", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, store } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(reply(401, { error: { code: "subscription_sharing_invalid_user" } }));
    const result = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(result.ok, true);
    const auth = fake.calls.filter((call) => call.path === "/v1/responses").map((call) => call.headers.authorization);
    assert.deepEqual(auth, ["Bearer AT-1", "Bearer AT-2"]);
    assert.equal(store.record.tokens.refreshToken, "RT-2");
  } finally {
    await fake.close();
  }
});

// ---- refresh -------------------------------------------------------------------------------

test("an expiring token is refreshed once for concurrent calls and replaced as a whole", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, store } = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() + 30_000 }) });
    const results = await Promise.all([chatgpt.respond({ model: "m", input: "a" }), chatgpt.respond({ model: "m", input: "b" }), chatgpt.listModels()]);
    assert.ok(results.every((result) => result.ok), JSON.stringify(results));
    assert.equal(fake.refreshes, 1, "single-flight refresh");
    const form = new URLSearchParams(fake.bodies("/token")[0]);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("client_id"), ISSUED);
    assert.equal(form.get("refresh_token"), "RT-1");
    assert.equal(form.get("resource"), RESOURCE);
    assert.deepEqual(fake.calls.filter((call) => call.path === "/v1/responses").map((call) => call.headers.authorization), ["Bearer AT-2", "Bearer AT-2"]);
    assert.equal(store.record.tokens.accessToken, "AT-2");
    assert.equal(store.record.tokens.refreshToken, "RT-2");
    assert.ok(store.record.tokens.expiresAt > Date.now() + 3000_000, "the expiry moves with the tokens");
  } finally {
    await fake.close();
  }
});

test("an unusable refresh token clears the sign-in and asks for a new one", async () => {
  const fake = await fakeOpenAI();
  try {
    for (const code of REFRESH_FATAL) {
      fake.onRefresh = () => [400, code === "refresh_token_reused" ? { error: { code, message: "reused" } } : { error: code }];
      fake.calls.length = 0;
      const { plan: chatgpt, store, logs } = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() - 1000 }) });
      const result = await chatgpt.respond({ model: "m", input: "q" });
      assert.equal(result.errorKind, "auth", code);
      assert.equal(result.code, code);
      assert.equal(result.reauth, true);
      assert.equal(store.record.tokens, null, `${code}: tokens cleared`);
      assert.equal(store.record.account.clientId, ISSUED, "the registration stays for the next sign-in");
      const shown = await chatgpt.status();
      assert.equal(shown.signedIn, false);
      assert.equal(shown.needsSignIn, true);
      assert.equal(fake.count("/v1/responses"), 0);
      noSecrets(logs, ["RT-1", "AT-1"]);
    }

    fake.onRefresh = () => [401, { error: "invalid_client" }];
    const { plan: removed, store } = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() - 1000 }) });
    assert.equal((await removed.respond({ model: "m", input: "q" })).code, "invalid_client");
    assert.equal(store.record.account, null, "a client id OpenAI no longer knows is forgotten, so the next sign-in registers");
  } finally {
    await fake.close();
  }
});

test("a transient refresh failure keeps the tokens and uses one that is still valid", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.onRefresh = () => [503, { error: "temporarily_unavailable" }];
    const soon = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() + 30_000 }) });
    const answered = await soon.plan.respond({ model: "m", input: "q" });
    assert.equal(answered.ok, true);
    assert.equal(fake.calls.find((call) => call.path === "/v1/responses").headers.authorization, "Bearer AT-1");

    const expired = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() - 1000 }) });
    const refused = await expired.plan.respond({ model: "m", input: "q" });
    assert.equal(refused.errorKind, "unavailable");
    assert.equal(expired.store.record.tokens.refreshToken, "RT-1", "a transient failure never clears the sign-in");
  } finally {
    await fake.close();
  }
});

test("a refreshed ID token for another account is refused", async () => {
  const fake = await fakeOpenAI();
  try {
    fake.onRefresh = (form) => [200, { access_token: "AT-X", refresh_token: "RT-X", id_token: sign(claimsFor(form.get("client_id"), { sub: "intruder" })), expires_in: 3600 }];
    const { plan: chatgpt, store } = makePlan(fake, { record: signedInRecord({ expiresAt: Date.now() - 1000 }) });
    const result = await chatgpt.respond({ model: "m", input: "q" });
    assert.equal(result.code, "account_mismatch");
    assert.equal(store.record.tokens, null);
  } finally {
    await fake.close();
  }
});

// ---- time, cancel, sign-out ------------------------------------------------------------------

test("a stalled stream times out and a caller's cancel stops it", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt } = makePlan(fake, { record: signedInRecord() });
    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "slow" }], { hang: true }));
    const stalled = await chatgpt.respond({ model: "m", input: "q", timeoutMs: 300 });
    assert.equal(stalled.errorKind, "timeout");
    assert.equal(stalled.partial, "slow");

    fake.responses.push(sse([{ type: "response.output_text.delta", delta: "wait" }], { hang: true }));
    const controller = new AbortController();
    const pending = chatgpt.respond({ model: "m", input: "q", signal: controller.signal, onDelta: () => controller.abort() });
    const canceled = await pending;
    assert.equal(canceled.errorKind, "canceled");
    const before = fake.count("/v1/responses");
    const early = new AbortController();
    early.abort();
    assert.equal((await chatgpt.respond({ model: "m", input: "q", signal: early.signal })).errorKind, "canceled");
    assert.equal(fake.count("/v1/responses"), before, "an aborted call is never sent");
  } finally {
    await fake.close();
  }
});

test("sign-out revokes the refresh token and keeps the registration unless told to forget it", async () => {
  const fake = await fakeOpenAI();
  try {
    const { plan: chatgpt, store } = makePlan(fake, { record: signedInRecord() });
    const out = await chatgpt.signOut();
    assert.deepEqual(out, { ok: true, revoked: true });
    const form = new URLSearchParams(fake.bodies("/revoke")[0]);
    assert.deepEqual(Object.fromEntries(form), { token: "RT-1", token_type_hint: "refresh_token", client_id: ISSUED });
    assert.equal(store.record.tokens, null);
    assert.equal(store.record.account.clientId, ISSUED);
    const shown = await chatgpt.status();
    assert.equal(shown.signedIn, false);
    assert.equal(shown.needsSignIn, false, "a chosen sign-out is not an expired one");
    assert.equal((await chatgpt.respond({ model: "m", input: "q" })).errorKind, "auth");
    await chatgpt.signOut({ forget: true });
    assert.equal(store.record.account, null);
    assert.equal(store.record.hostId, HOST_ID, "the host id outlives the account");
  } finally {
    await fake.close();
  }
});

test("a saved record that names dynamic_agent_client or carries junk is not trusted", async () => {
  const fake = await fakeOpenAI();
  try {
    const record = signedInRecord();
    record.account.clientId = REGISTRATION_CLIENT_ID;
    const { plan: chatgpt } = makePlan(fake, { record });
    assert.equal((await chatgpt.status()).signedIn, false);
    const junk = makePlan(fake, { record: { hostId: "owner@example.com", account: "x", tokens: 5 } });
    assert.equal((await junk.plan.status()).signedIn, false);
    const result = await junk.plan.signIn();
    assert.equal(result.ok, true);
    assert.equal(fake.authorize.ext_agent_host_id, HOST_ID, "an email-shaped host id is replaced by an opaque one");
  } finally {
    await fake.close();
  }
});
