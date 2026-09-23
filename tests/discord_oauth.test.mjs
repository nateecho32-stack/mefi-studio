import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";
import oauth from "../scripts/discord-oauth.cjs";

// scripts/discord-oauth.cjs against a real loopback server and a fake Discord.
// The "browser" is the injected openExternal: it reads the authorize URL and
// requests the redirect the way Discord would send the user back. Ports are
// free high ports picked per test, never the registered 53134-53136.

const { authorize, refresh, fetchMember, revoke, TOKEN_URL, REVOKE_URL, USER_URL, memberUrl } = oauth;
const GUILD = "1345380333302059129";
const CLIENT = "555000555";
const T_NOW = 1_800_000_000_000;

const listenOn = (port = 0) => new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => res.end("occupied"));
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => resolve(server));
});
const closeServer = (server) => new Promise((resolve) => server.close(() => resolve()));
async function freePort() {
  const server = await listenOn();
  const { port } = server.address();
  await closeServer(server);
  return port;
}

// A GET with an exact Host header; fetch() would not let the test forge one.
function get(url, { host, method = "GET" } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: target.hostname, port: target.port, path: target.pathname + target.search, method,
      headers: host ? { host } : {}, agent: false,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// The browser's response lands just after authorize() settles; poll for it
// rather than sleep a fixed time, since the full suite runs files in parallel.
async function waitFor(check, ms = 5_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting for the browser's response");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const json = (status, body, headers = {}) => ({ status, body, headers });
const DISCORD_OK = {
  [`POST ${TOKEN_URL}`]: json(200, { access_token: "AT-1", token_type: "Bearer", expires_in: 604800, refresh_token: "RT-1", scope: "identify guilds.members.read" }),
  [`GET ${USER_URL}`]: json(200, { id: "111", username: "mefi", global_name: "Mefi", avatar: null }),
  [`GET ${memberUrl(GUILD)}`]: json(200, { roles: ["900", "901"], joined_at: "2026-01-02T03:04:05.000Z", nick: null }),
};

// Records every call; answers from a "METHOD url" table with real Responses.
function fakeDiscord(overrides = {}) {
  const routes = { ...DISCORD_OK, ...overrides };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, headers: init.headers ?? {}, body: init.body ?? null, redirect: init.redirect });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    const answer = typeof route === "function" ? await route(init) : route;
    if (answer instanceof Error) throw answer;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
  };
  return { fetch, calls };
}

// The browser: follows the authorize URL back to the loopback redirect.
function browser({ tamper = (query) => query, host, before } = {}) {
  const visits = [];
  const opened = [];
  const openExternal = (url) => {
    opened.push(url);
    const authorizeAt = new URL(url);
    const redirect = authorizeAt.searchParams.get("redirect_uri");
    const query = tamper({ code: "CODE-1", state: authorizeAt.searchParams.get("state") });
    const target = `${redirect}?${new URLSearchParams(query)}`;
    (async () => {
      if (before) await before(redirect, visits);
      visits.push(await get(target, { host }));
    })().catch((error) => visits.push({ error }));
  };
  return { openExternal, visits, opened };
}

const form = (body) => Object.fromEntries(new URLSearchParams(body));

test("the happy path: PKCE exchange without a secret, then user and member", async () => {
  const busy = await listenOn();
  const free = await freePort();
  const discord = fakeDiscord();
  const page = browser();
  const listened = [];
  const bound = [];
  const recordingHttp = {
    createServer(handler) {
      const server = http.createServer(handler);
      const listen = server.listen.bind(server);
      server.listen = (...args) => { bound.push(args.slice(0, 2)); return listen(...args); };
      return server;
    },
  };
  try {
    const result = await authorize({
      clientId: CLIENT, guildId: GUILD, ports: [busy.address().port, free], openExternal: page.openExternal,
      fetch: discord.fetch, http: recordingHttp, now: () => T_NOW, onListening: (info) => listened.push(info),
    });

    assert.deepEqual(result, {
      ok: true,
      tokens: { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: T_NOW + 604800 * 1000, scope: "identify guilds.members.read" },
      user: { id: "111", username: "mefi", globalName: "Mefi" },
      member: { roles: ["900", "901"], joined_at: "2026-01-02T03:04:05.000Z" },
    });

    // It skipped the busy port and bound the free one, on loopback only.
    assert.deepEqual(bound.map(([, host]) => host), ["127.0.0.1", "127.0.0.1"]);
    assert.equal(listened.length, 1);
    assert.equal(listened[0].port, free);
    assert.equal(listened[0].redirectUri, `http://127.0.0.1:${free}/callback`);
    assert.equal(page.opened[0], listened[0].url);

    const authorizeAt = new URL(page.opened[0]);
    assert.equal(authorizeAt.origin + authorizeAt.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(authorizeAt.searchParams.get("client_id"), CLIENT);
    assert.equal(authorizeAt.searchParams.get("scope"), "identify guilds.members.read");
    assert.equal(authorizeAt.searchParams.get("code_challenge_method"), "S256");

    // The exchange: a form POST with the verifier matching the challenge, and no secret.
    assert.deepEqual(discord.calls.map((call) => `${call.method} ${call.url}`), [`POST ${TOKEN_URL}`, `GET ${USER_URL}`, `GET ${memberUrl(GUILD)}`]);
    const exchange = discord.calls[0];
    assert.equal(exchange.headers["Content-Type"], "application/x-www-form-urlencoded");
    const sent = form(exchange.body);
    assert.deepEqual(Object.keys(sent).sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
    assert.equal(sent.client_id, CLIENT);
    assert.equal(sent.grant_type, "authorization_code");
    assert.equal(sent.code, "CODE-1");
    assert.equal(sent.redirect_uri, `http://127.0.0.1:${free}/callback`);
    assert.match(sent.code_verifier, /^[A-Za-z0-9_-]{64}$/);
    assert.equal(createHash("sha256").update(sent.code_verifier).digest("base64url"), authorizeAt.searchParams.get("code_challenge"));
    assert.ok(!/client_secret/.test(exchange.body), "a public client never sends a secret");
    for (const call of discord.calls.filter((entry) => entry.method === "POST")) {
      assert.ok([TOKEN_URL, REVOKE_URL].includes(call.url), `POST only to the token and revoke URLs, not ${call.url}`);
    }
    for (const call of discord.calls.filter((entry) => entry.method === "GET")) {
      assert.equal(call.headers.Authorization, "Bearer AT-1");
      assert.equal(call.redirect, "error", "a redirect could carry the bearer token to another host");
    }

    // The browser got the static page, and the server is gone.
    await waitFor(() => page.visits.length > 0);
    const [visit] = page.visits;
    assert.equal(visit.status, 200);
    assert.equal(visit.headers["cache-control"], "no-store");
    assert.match(visit.headers["content-type"], /^text\/html/);
    assert.match(visit.headers["content-security-policy"], /default-src 'none'/);
    assert.match(visit.body, /You can return to Mefi's Studio AI\+/);
    assert.ok(!/<script/i.test(visit.body), "the page runs no script");
    await assert.rejects(get(`http://127.0.0.1:${free}/callback`), /ECONNREFUSED/, "one hit, then the server closes");
  } finally {
    await closeServer(busy);
  }
});

test("a callback with the wrong state is refused without ending the wait for the real one", async () => {
  const discord = fakeDiscord();
  const forged = [];
  const page = browser({
    before: async (redirect) => {
      const port = new URL(redirect).port;
      // What a web page's <img> or an old callback tab sends: the right Host, the wrong state.
      forged.push(await get(`${redirect}?error=access_denied&state=forged`, { host: `127.0.0.1:${port}` }));
      forged.push(await get(`${redirect}?code=STOLEN&state=forged-state`));
      forged.push(await get(`${redirect}?code=STOLEN`));
    },
  });
  const result = await authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: page.openExternal, fetch: discord.fetch });
  assert.deepEqual(forged.map((visit) => visit.status), [400, 400, 400], "a wrong or missing state is refused");
  assert.match(forged[0].body, /You can return to Mefi's Studio AI\+/);
  assert.equal(result.ok, true, "the real callback still completes the link");
  const exchanges = discord.calls.filter((call) => call.method === "POST");
  assert.equal(exchanges.length, 1);
  assert.equal(form(exchanges[0].body).code, "CODE-1", "a forged code is never exchanged");

  // With only a forged hit, nothing but the timeout or a cancel ends the wait.
  const quiet = fakeDiscord();
  const controller = new AbortController();
  const lone = browser({ tamper: (query) => ({ ...query, state: "forged-state" }) });
  let ended = false;
  const pending = authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: lone.openExternal, fetch: quiet.fetch, signal: controller.signal })
    .finally(() => { ended = true; });
  await waitFor(() => lone.visits.length > 0);
  assert.equal(lone.visits[0].status, 400);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ended, false, "the forged hit did not end the flow");
  controller.abort();
  assert.deepEqual(await pending, { ok: false, error: "canceled" });
  assert.deepEqual(quiet.calls, [], "no token request without the right state");
});

test("a wrong Host, a wrong path or a POST is refused without ending the wait", async () => {
  const discord = fakeDiscord();
  const refused = [];
  const page = browser({
    before: async (redirect) => {
      const port = new URL(redirect).port;
      refused.push(await get(`${redirect}?code=x&state=y`, { host: `evil.example:${port}` }));
      refused.push(await get(`${redirect}?code=x&state=y`, { host: `localhost:${port}` }));
      refused.push(await get(`http://127.0.0.1:${port}/favicon.ico`));
      refused.push(await get(`${redirect}?code=x&state=y`, { method: "POST" }));
    },
  });
  const result = await authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: page.openExternal, fetch: discord.fetch });
  assert.deepEqual(refused.map((visit) => visit.status), [400, 400, 404, 400]);
  assert.equal(result.ok, true, "the real callback still completes the link");
  assert.equal(discord.calls.filter((call) => call.method === "POST").length, 1);
});

test("the wait times out and closes the server", async () => {
  const port = await freePort();
  const opened = [];
  const started = Date.now();
  const result = await authorize({ clientId: CLIENT, ports: [port], openExternal: (url) => opened.push(url), fetch: fakeDiscord().fetch, timeoutMs: 60 });
  assert.deepEqual(result, { ok: false, error: "timeout" });
  assert.ok(Date.now() - started < 5_000);
  assert.equal(opened.length, 1);
  await assert.rejects(get(`http://127.0.0.1:${port}/callback`), /ECONNREFUSED/);
});

test("every registered port busy is port-busy, and nothing opens", async () => {
  const servers = await Promise.all([listenOn(), listenOn(), listenOn()]);
  try {
    const opened = [];
    const result = await authorize({ clientId: CLIENT, ports: servers.map((server) => server.address().port), openExternal: (url) => opened.push(url), fetch: fakeDiscord().fetch });
    assert.deepEqual(result, { ok: false, error: "port-busy" });
    assert.deepEqual(opened, []);
    assert.deepEqual(await authorize({ clientId: CLIENT, ports: [], openExternal: () => {} }), { ok: false, error: "port-busy" });
    assert.deepEqual(await authorize({ clientId: CLIENT, ports: "53134", openExternal: () => {} }), { ok: false, error: "port-busy" });
  } finally {
    await Promise.all(servers.map(closeServer));
  }
});

test("the signal cancels the wait, before or during it", async () => {
  const early = new AbortController();
  early.abort();
  assert.deepEqual(await authorize({ clientId: CLIENT, ports: [await freePort()], openExternal: () => {}, signal: early.signal }), { ok: false, error: "canceled" });

  const port = await freePort();
  const during = new AbortController();
  const result = await authorize({ clientId: CLIENT, ports: [port], openExternal: () => setTimeout(() => during.abort(), 10), signal: during.signal, fetch: fakeDiscord().fetch });
  assert.deepEqual(result, { ok: false, error: "canceled" });
  await assert.rejects(get(`http://127.0.0.1:${port}/callback`), /ECONNREFUSED/);

  const denied = browser({ tamper: ({ state }) => ({ error: "access_denied", error_description: "The user denied", state }) });
  const discord = fakeDiscord();
  assert.deepEqual(await authorize({ clientId: CLIENT, ports: [await freePort()], openExternal: denied.openExternal, fetch: discord.fetch }),
    { ok: false, error: "canceled" }, "pressing Cancel on Discord's page is a cancel");
  assert.deepEqual(discord.calls, []);

  assert.deepEqual(await authorize({ clientId: CLIENT, ports: [await freePort()], openExternal: () => Promise.reject(new Error("no browser")) }),
    { ok: false, error: "canceled" }, "a browser that never opened cannot finish");
});

test("an unconfigured client never listens", async () => {
  for (const clientId of ["", "   ", undefined, null, 42]) {
    const opened = [];
    assert.deepEqual(await authorize({ clientId, ports: [await freePort()], openExternal: (url) => opened.push(url) }), { ok: false, error: "not-configured" });
    assert.deepEqual(opened, []);
  }
  assert.deepEqual(await authorize({ clientId: CLIENT, ports: [await freePort()] }), { ok: false, error: "not-configured" }, "no openExternal");
  assert.deepEqual(await authorize(), { ok: false, error: "not-configured" }, "the shipped CLIENT_ID is empty");
  assert.deepEqual(await authorize("garbage"), { ok: false, error: "not-configured" });
});

test("not a member (404, code 10004) still returns the tokens and the user", async () => {
  const discord = fakeDiscord({ [`GET ${memberUrl(GUILD)}`]: json(404, { message: "Unknown Guild", code: 10004 }) });
  const page = browser();
  const result = await authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: page.openExternal, fetch: discord.fetch, now: T_NOW });
  assert.deepEqual(result, {
    ok: false, error: "not-member",
    tokens: { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: T_NOW + 604800 * 1000, scope: "identify guilds.members.read" },
    user: { id: "111", username: "mefi", globalName: "Mefi" },
  });
});

test("error mapping: 401/403 auth, 429 rate-limit with Retry-After, a throw is network", async () => {
  const flow = async (overrides) => authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: browser().openExternal, fetch: fakeDiscord(overrides).fetch, now: T_NOW });
  // After the code exchange Discord has granted, so a failure carries the tokens for the host to revoke.
  const tokens = { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: T_NOW + 604800 * 1000, scope: "identify guilds.members.read" };

  assert.deepEqual(await flow({ [`GET ${USER_URL}`]: json(401, { message: "401: Unauthorized", code: 0 }) }), { ok: false, error: "auth", tokens });
  assert.deepEqual(await flow({ [`POST ${TOKEN_URL}`]: json(400, { error: "invalid_grant" }) }), { ok: false, error: "auth" });
  assert.deepEqual(await flow({ [`GET ${memberUrl(GUILD)}`]: json(429, { message: "You are being rate limited.", retry_after: 1.5, global: false }, { "Retry-After": "2" }) }),
    { ok: false, error: "rate-limit", retryAfterMs: 2000, tokens });
  assert.deepEqual(await flow({ [`POST ${TOKEN_URL}`]: new TypeError("fetch failed") }), { ok: false, error: "network" });
  assert.deepEqual(await flow({ [`GET ${USER_URL}`]: json(502, null) }), { ok: false, error: "network", tokens });
  assert.deepEqual(await flow({ [`GET ${memberUrl(GUILD)}`]: new Error("ECONNRESET") }), { ok: false, error: "network", tokens });

  // A cancel that lands while /users/@me is in flight: canceled, and the grant comes back to revoke.
  const controller = new AbortController();
  const aborting = fakeDiscord({ [`GET ${USER_URL}`]: () => { controller.abort(); throw new DOMException("aborted", "AbortError"); } });
  assert.deepEqual(await authorize({ clientId: CLIENT, guildId: GUILD, ports: [await freePort()], openExternal: browser().openExternal, fetch: aborting.fetch, now: T_NOW, signal: controller.signal }),
    { ok: false, error: "canceled", tokens });

  const direct = (overrides) => fetchMember({ accessToken: "AT", guildId: GUILD, fetch: fakeDiscord(overrides).fetch });
  assert.deepEqual(await direct({}), { ok: true, user: { id: "111", username: "mefi", globalName: "Mefi" }, member: { roles: ["900", "901"], joined_at: "2026-01-02T03:04:05.000Z" } });
  assert.deepEqual(await direct({ [`GET ${memberUrl(GUILD)}`]: json(403, { message: "Missing Access", code: 50001 }) }), { ok: false, error: "auth" });
  assert.deepEqual(await direct({ [`GET ${USER_URL}`]: json(429, { retry_after: 0.25 }) }), { ok: false, error: "rate-limit", retryAfterMs: 250 },
    "the body's retry_after when the header is missing");
  assert.deepEqual(await direct({ [`GET ${USER_URL}`]: json(429, {}) }), { ok: false, error: "rate-limit" });
  assert.deepEqual(await direct({ [`GET ${memberUrl(GUILD)}`]: new Error("ECONNRESET") }), { ok: false, error: "network" });
  assert.deepEqual(await direct({ [`GET ${memberUrl(GUILD)}`]: json(404, { code: 10004 }) }),
    { ok: false, error: "not-member", user: { id: "111", username: "mefi", globalName: "Mefi" } });
  assert.deepEqual(await fetchMember({ accessToken: "", fetch: fakeDiscord().fetch }), { ok: false, error: "auth" });
  assert.deepEqual(await fetchMember({ accessToken: "AT", guildId: "../../evil", fetch: fakeDiscord().fetch }), { ok: false, error: "not-configured" });
  assert.deepEqual(await fetchMember({ accessToken: "AT", guildId: GUILD, fetch: "nope" }), { ok: false, error: "network" });
});

test("refresh rotates the token without a secret; invalid_grant is auth", async () => {
  const discord = fakeDiscord({ [`POST ${TOKEN_URL}`]: json(200, { access_token: "AT-2", refresh_token: "RT-2", expires_in: 3600, scope: "identify" }) });
  assert.deepEqual(await refresh({ clientId: CLIENT, refreshToken: "RT-1", fetch: discord.fetch, now: () => T_NOW }),
    { ok: true, tokens: { accessToken: "AT-2", refreshToken: "RT-2", expiresAt: T_NOW + 3_600_000, scope: "identify" } });
  assert.equal(discord.calls.length, 1);
  assert.equal(discord.calls[0].method, "POST");
  assert.equal(discord.calls[0].url, TOKEN_URL);
  assert.deepEqual(form(discord.calls[0].body), { client_id: CLIENT, grant_type: "refresh_token", refresh_token: "RT-1" });
  assert.ok(!/client_secret/.test(discord.calls[0].body));

  const kept = fakeDiscord({ [`POST ${TOKEN_URL}`]: json(200, { access_token: "AT-3", expires_in: 60 }) });
  assert.equal((await refresh({ clientId: CLIENT, refreshToken: "RT-1", fetch: kept.fetch })).tokens.refreshToken, "RT-1",
    "no rotation in the answer keeps the old refresh token");

  for (const [answer, expected] of [
    [json(400, { error: "invalid_grant" }), { ok: false, error: "auth" }],
    [json(401, { error: "invalid_client" }), { ok: false, error: "auth" }],
    [json(429, {}, { "retry-after": "7" }), { ok: false, error: "rate-limit", retryAfterMs: 7000 }],
    [json(500, null), { ok: false, error: "network" }],
    [json(200, { token_type: "Bearer" }), { ok: false, error: "auth" }],
    [new Error("offline"), { ok: false, error: "network" }],
  ]) {
    assert.deepEqual(await refresh({ clientId: CLIENT, refreshToken: "RT-1", fetch: fakeDiscord({ [`POST ${TOKEN_URL}`]: answer }).fetch }), expected);
  }
  assert.deepEqual(await refresh({ clientId: "", refreshToken: "RT-1", fetch: discord.fetch }), { ok: false, error: "not-configured" });
  assert.deepEqual(await refresh({ clientId: CLIENT, refreshToken: "", fetch: discord.fetch }), { ok: false, error: "auth" });
  assert.deepEqual(await refresh(), { ok: false, error: "not-configured" });
});

test("revoke posts the refresh token to the revoke URL", async () => {
  const discord = fakeDiscord({ [`POST ${REVOKE_URL}`]: json(200, {}) });
  assert.deepEqual(await revoke({ clientId: CLIENT, token: "RT-1", fetch: discord.fetch }), { ok: true });
  assert.equal(discord.calls.length, 1);
  assert.equal(discord.calls[0].url, REVOKE_URL);
  assert.equal(discord.calls[0].method, "POST");
  assert.equal(discord.calls[0].headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(form(discord.calls[0].body), { token: "RT-1", token_type_hint: "refresh_token", client_id: CLIENT });
  assert.ok(!/client_secret/.test(discord.calls[0].body));

  assert.deepEqual(await revoke({ clientId: CLIENT, token: "RT-1", fetch: fakeDiscord({ [`POST ${REVOKE_URL}`]: json(401, {}) }).fetch }), { ok: false });
  assert.deepEqual(await revoke({ clientId: CLIENT, token: "RT-1", fetch: fakeDiscord({ [`POST ${REVOKE_URL}`]: new Error("offline") }).fetch }), { ok: false });
  const untouched = fakeDiscord();
  assert.deepEqual(await revoke({ clientId: CLIENT, token: "", fetch: untouched.fetch }), { ok: false });
  assert.deepEqual(await revoke({ clientId: "", token: "RT-1", fetch: untouched.fetch }), { ok: false });
  assert.deepEqual(untouched.calls, []);
});
