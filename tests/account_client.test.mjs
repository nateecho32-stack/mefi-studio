import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import native from "../scripts/account-client.cjs";
const T = 1800000000000, A = "studio:12345678-1234-4abc-8abc-123456789abc", AP = "accounts.canonical.1";
const session = (id = A) => ({ accountSession: "a".repeat(64), expiresAt: T + 3600000, actorProtocol: AP, user: { id, name: "Member" }, state: "admitted", socialAccess: true, waitlistPosition: null });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
function harness({ enabled = true, origin = "https://hub.example.test", encryption = true, stored = null, reply, open, write, changed } = {}) {
  const calls = [], saves = [], events = [], servers = [], timers = []; let clock = T, started;
  const http = { createServer(handler) { const server = { handler, closed: false, once() {}, listen(options, callback) { this.options = options; callback(); }, address: () => ({ port: 54001 }), close() { this.closed = true; }, closeAllConnections() {}, closeIdleConnections() {} }; servers.push(server); return server; } };
  const deliver = (query) => { const res = { code: null, writeHead(code) { this.code = code; }, end() {} }; servers.at(-1).handler({ method: "GET", headers: { host: "127.0.0.1:54001" }, url: "/studio-account/callback?" + query }, res); return res.code; };
  const client = native.createAccountClient({
    origin, enabled, canEncrypt: () => encryption, now: () => clock, readStored: () => stored,
    writeStored: async (value) => { await write?.(value); saves.push(structuredClone(value)); }, protect: (value) => Buffer.from(value).toString("base64"), unprotect: (value) => Buffer.from(value, "base64").toString(),
    getDiscordAccessToken: async () => ({ ok: true, token: "discord_fixture" }), onChange: (s) => { events.push(s); changed?.(s); },
    http, randomBytes: (size) => Buffer.alloc(size, 4), setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout() {},
    openExternal: async (url) => { if (open) return open({ url, deliver, started }); deliver("state=" + started.deliveryState + "&handoff=" + "b".repeat(64)); },
    fetch: async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body); calls.push({ path, body, ...init });
      if (path.endsWith("/start")) started = body;
      const custom = await reply?.(path, body);
      if (custom) return custom;
      const data = path.endsWith("/start") ? { requestId: "signin_" + "c".repeat(32), authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture", expiresAt: T + 300000 } : session();
      return new Response(JSON.stringify(data));
    },
  });
  return { client, calls, saves, events, servers, deliver, timers, expire: () => { clock += 3600001; } };
}
test("native Google stays unavailable without rollout flag, explicit HTTPS origin or encryption", async () => {
  for (const options of [{ enabled: false }, { origin: "" }, { origin: "http://localhost:8787" }, { encryption: false }]) {
    const h = harness(options); assert.equal((await h.client.signIn()).error, "unavailable"); assert.equal(h.calls.length, 0); assert.equal(h.servers.length, 0);
  }
});
test("native flow uses ephemeral exclusive loopback, PKCE and encrypted-only persistence", async () => {
  const h = harness(); assert.equal((await h.client.signIn()).ok, true);
  assert.deepEqual(h.servers[0].options, { host: "127.0.0.1", port: 0, exclusive: true }); assert.equal(h.servers[0].closed, true);
  const start = JSON.parse(h.calls[0].body), redeem = JSON.parse(h.calls[1].body);
  assert.equal(start.codeChallenge, crypto.createHash("sha256").update(redeem.codeVerifier).digest("base64url"));
  assert.match(start.deliveryState, /^[a-f0-9]{64}$/); assert.equal(start.returnUri, "http://127.0.0.1:54001/studio-account/callback");
  assert.ok(h.calls.every((c) => c.redirect === "error" && c.cache === "no-store" && c.headers.Origin === "https://hub.example.test"));
  assert.equal((await h.client.accountSession()).accountSession, session().accountSession);
  assert.doesNotMatch(JSON.stringify([...h.events, h.client.status(), ...h.saves]), /accountSession|aaaaaaaaaaaaaaaa|codeVerifier|handoff/);
});
test("forged or duplicate native states do not consume a valid callback", async () => {
  const h = harness({ open: ({ deliver, started }) => {
    assert.equal(deliver("state=" + "0".repeat(64) + "&error=access_denied"), 400);
    assert.equal(deliver("state=" + started.deliveryState + "&state=" + started.deliveryState + "&handoff=" + "b".repeat(64)), 400);
    assert.equal(deliver("state=" + started.deliveryState + "&handoff=" + "b".repeat(64)), 200);
    assert.equal(deliver("state=" + started.deliveryState + "&handoff=" + "b".repeat(64)), 410);
  } }); assert.equal((await h.client.signIn()).ok, true); assert.equal(h.calls.filter((c) => c.path.endsWith("/redeem")).length, 1);
});
test("cancel closes loopback and never redeems; selected account mode does not revert", async () => {
  const h = harness({ open: async () => {} }); const pending = h.client.signIn(); await flush(); await h.client.cancel();
  assert.equal((await pending).error, "canceled"); assert.equal(h.servers[0].closed, true);
  assert.equal(h.client.status().selected, true); assert.equal(h.calls.some((c) => c.path.endsWith("/redeem")), false);
});
test("expiry removes account authority without silently using Discord", async () => {
  const h = harness(); await h.client.signIn(); h.expire();
  assert.equal((await h.client.accountSession()).error, "expired"); assert.equal(h.client.status().selected, true);
  assert.equal(h.saves.at(-1).encrypted, null); assert.equal(h.calls.some((c) => c.path.includes("discord")), false);
});
test("explicit linking exchanges Discord only on request and rejects another final actor", async () => {
  const h = harness({ reply: (path) => path.endsWith("/redeem") ? new Response(JSON.stringify(session("studio:87654321-4321-4abc-9abc-cba987654321"))) : null });
  assert.equal((await h.client.signIn({ link: true })).error, "auth");
  assert.equal(h.calls[0].path, "/v1/auth/discord/exchange");
  assert.ok(h.calls.every((c) => c.headers.Origin === "https://hub.example.test"));
  assert.equal(JSON.parse(h.calls[1].body).linkSession, session().accountSession);
  assert.equal(h.client.status().linked, false);
});
test("unknown bootstrap marker and hostile Google URLs are rejected", () => {
  assert.equal(native.sessionOf({ ...session(), actorProtocol: "accounts.canonical.2" }, T), null);
  for (const url of ["https://accounts.google.com.evil.test/o/oauth2/v2/auth", "https://accounts.google.com@evil.test/o/oauth2/v2/auth", "https://accounts.google.com/o/oauth2/v2/auth#token", "http://accounts.google.com/o/oauth2/v2/auth"]) assert.equal(native.authorizationUrl(url), null);
});
test("link cancellation preserves an existing encrypted account, while sign-out explicitly clears it", async () => {
  const stored = { selected: true, origin: "https://hub.example.test", encrypted: Buffer.from(JSON.stringify(session())).toString("base64") };
  const h = harness({ stored, open: async () => {} }); const pending = h.client.signIn({ link: true }); await flush(); await h.client.cancel(); await pending;
  assert.equal(h.client.status().linked, true); assert.equal((await h.client.accountSession()).accountSession, session().accountSession);
  await h.client.signOut(); assert.equal(h.saves.at(-1).encrypted, null); assert.equal(h.client.status().selected, true);
  await h.client.useDiscord(); assert.equal(h.client.status().selected, false);
});
test("broker v2 admission projection is strict and never admits a contradictory waitlist session", () => {
  const waiting = { ...session(), state: "waitlisted", socialAccess: false, waitlistPosition: 1001 };
  assert.equal(native.sessionOf(waiting, T).waitlistPosition, 1001);
  for (const patch of [{ state: "revoked" }, { socialAccess: true }, { waitlistPosition: null }, { waitlistPosition: 0 }, { waitlistPosition: -1 }, { waitlistPosition: 1.5 }, { waitlistPosition: Number.MAX_SAFE_INTEGER + 1 }]) assert.equal(native.sessionOf({ ...waiting, ...patch }, T), null);
  for (const patch of [{ socialAccess: false }, { waitlistPosition: 1 }]) assert.equal(native.sessionOf({ ...session(), ...patch }, T), null);
  const old = session(); delete old.state; delete old.socialAccess; delete old.waitlistPosition;
  assert.equal(native.sessionOf(old, T), null);
});

test("waitlisted authority stays encrypted for same-account linking but cannot supply a hub credential", async () => {
  const waiting = { ...session(), state: "waitlisted", socialAccess: false, waitlistPosition: 1001 };
  const h = harness({ reply: (path) => path.endsWith("/start") ? null : new Response(JSON.stringify(waiting)) });
  assert.equal((await h.client.signIn()).ok, true);
  assert.equal(h.client.status().linked, true); assert.equal(h.client.status().socialAccess, false);
  assert.equal(h.client.status().waitlistPosition, 1001);
  assert.deepEqual(await h.client.accountSession(), { ok: false, error: "waitlisted" });
  assert.equal((await h.client.signIn({ link: true })).ok, true);
  const starts = h.calls.filter((call) => call.path.endsWith("/start"));
  assert.equal(JSON.parse(starts[1].body).linkSession, waiting.accountSession);
  assert.equal(h.calls.some((call) => call.path === "/v1/session" || call.path.includes("discord")), false);
  assert.doesNotMatch(JSON.stringify(h.events), /accountSession|codeVerifier|handoff/);
});
test("canceling an explicit legacy Discord link preserves its prior selected mode without automatic fallback", async () => {
  const h = harness({ open: async () => {} });
  const pending = h.client.signIn({ link: true }); await flush(); await h.client.cancel(); await pending;
  assert.equal(h.client.status().selected, false);
  assert.equal((await h.client.accountSession()).error, "not-linked");
  assert.equal(h.calls.filter(call => call.path === "/v1/auth/discord/exchange").length, 1);
  assert.equal(h.calls.some(call => call.path.endsWith("/redeem")), false);
});
test("real broker legacy migration refusals preserve saved mode and authority without fallback", async () => {
  for (const code of ["legacy_account_migration_required", "legacy_wallet_migration_required"]) {
    for (const existing of [false, true]) {
      const stored = existing ? { selected: true, origin: "https://hub.example.test", encrypted: Buffer.from(JSON.stringify(session())).toString("base64") } : null;
      const h = harness({ stored, reply: () => new Response(JSON.stringify({ error: code }), { status: 401 }) });
      const result = await h.client.signIn({ link: true });
      assert.equal(result.error, code); assert.equal(h.client.status().error, code);
      assert.equal(h.client.status().selected, existing);
      assert.equal(h.client.status().linked, existing);
      if (existing) assert.equal((await h.client.accountSession()).accountSession, session().accountSession);
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].path, existing ? "/v1/auth/google/start" : "/v1/auth/discord/exchange");
      assert.equal(h.calls.some(call => call.path === "/v1/session" || call.path.endsWith("/redeem")), false);
    }
    const stored = { selected: true, origin: "https://hub.example.test", encrypted: Buffer.from(JSON.stringify(session())).toString("base64") };
    const h = harness({ stored, reply: () => new Response(JSON.stringify({ error: { code } }), { status: 401 }) });
    assert.equal((await h.client.signIn()).error, code);
    assert.equal((await h.client.accountSession()).accountSession, session().accountSession);
    assert.equal(h.client.status().selected, true);
  }
});

test("real broker cancellation delivery closes the native callback without redeeming", async () => {
  const h = harness({ open: ({ deliver, started }) => {
    assert.equal(deliver("state=" + started.deliveryState + "&error=signin-cancelled"), 200);
  } });
  assert.equal((await h.client.signIn()).error, "canceled");
  assert.equal(h.servers[0].closed, true);
  assert.equal(h.calls.some(call => call.path.endsWith("/redeem")), false);
});
const deferredWrite = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function savingCandidate({ linked = false, onWrite, changed } = {}) {
  const blocked = deferredWrite(), entered = deferredWrite(), candidate = { ...session(), accountSession: "d".repeat(64) };
  const stored = linked ? { selected: true, origin: "https://hub.example.test", encrypted: Buffer.from(JSON.stringify(session())).toString("base64") } : null;
  let held = false;
  const h = harness({ stored, changed,
    reply: path => path.endsWith("/redeem") ? new Response(JSON.stringify(candidate)) : null,
    write: async value => {
      const saved = value.encrypted ? JSON.parse(Buffer.from(value.encrypted, "base64").toString()) : null;
      if (!held && saved?.accountSession === candidate.accountSession) { held = true; entered.resolve(); await blocked.promise; } await onWrite?.(value);
    },
  });
  return { ...h, candidate, entered: entered.promise, release: () => blocked.resolve(),
    persisted: () => { const saved = h.saves.at(-1); return saved?.encrypted ? JSON.parse(Buffer.from(saved.encrypted, "base64").toString()) : null; } };
}

test("cancel during redeemed credential persistence cannot expose or retain the candidate", async () => {
  for (const linked of [false, true]) {
    const h = savingCandidate({ linked }), pending = h.client.signIn({ link: linked });
    await h.entered;
    assert.equal(h.client.status().signingIn, true);
    assert.equal(h.client.status().linked, linked);
    const grant = await h.client.accountSession();
    assert.equal(grant.accountSession, linked ? session().accountSession : undefined);
    if (!linked) assert.equal(grant.error, "signing-in");
    let canceled = false;
    const cancel = h.client.cancel().then(value => { canceled = true; return value; });
    await flush(); assert.equal(canceled, false);
    h.release();
    const [result, canceledResult] = await Promise.all([pending, cancel]);
    assert.equal(result.error, "canceled"); assert.equal(canceledResult.status.signingIn, false);
    assert.equal(h.client.status().selected, true);
    assert.equal(h.client.status().linked, linked);
    assert.equal(h.persisted()?.accountSession, linked ? session().accountSession : undefined);
    assert.equal(h.events.some(event => event.signingIn && event.user?.id !== session().user.id && event.linked), false);
  }
});

test("later explicit Discord selection or sign-out wins over a canceled persistence rollback", async () => {
  for (const action of ["useDiscord", "signOut"]) {
    const h = savingCandidate({ linked: true }), pending = h.client.signIn({ link: true });
    await h.entered; const cancel = h.client.cancel(), later = h.client[action]();
    h.release(); await Promise.all([pending, cancel, later]);
    const expected = action === "signOut";
    assert.equal(h.client.status().selected, expected);
    assert.equal(h.client.status().linked, false);
    assert.equal(h.saves.at(-1).selected, expected); assert.equal(h.persisted(), null);
    assert.equal(h.calls.filter(call => call.path.includes("discord")).length, 0);
  }
});

test("closing during candidate persistence rolls it back without publishing new authority", async () => {
  const h = savingCandidate({ linked: true }), pending = h.client.signIn({ link: true });
  await h.entered; h.client.close(); h.release();
  assert.equal((await pending).error, "canceled");
  assert.equal(h.client.status().configured, false); assert.equal(h.client.status().linked, false);
  assert.equal(h.persisted().accountSession, session().accountSession);
});

test("real main cancel action waits for encrypted cleanup and never reconnects a candidate", async () => {
  const { readFile } = await import("node:fs/promises"), vm = await import("node:vm");
  const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const start = main.indexOf("async function studioAccountAction(");
  const actionSource = main.slice(start, main.indexOf("\n}\n", start) + 3);
  for (const linked of [false, true]) {
    const h = savingCandidate({ linked }), connected = [];
    const context = vm.createContext({
      studioAccountActionGeneration: 0, studioAccount: () => h.client, Object,
      studioAccountLinked: async () => h.client.status().linked,
      hubConnect: async () => { connected.push(await h.client.accountSession()); },
    });
    vm.runInContext(actionSource, context);
    const pending = context.studioAccountAction(linked ? "linkGoogle" : "google");
    await h.entered; const cancel = context.studioAccountAction("cancel"); await flush();
    assert.equal(connected.length, 0);
    h.release(); const [oldAction] = await Promise.all([pending, cancel]);
    assert.equal(oldAction.error, "superseded");
    assert.equal(connected.length, linked ? 1 : 0);
    assert.ok(connected.every(grant => grant.accountSession === session().accountSession));
    assert.equal(h.persisted()?.accountSession, linked ? session().accountSession : undefined);
  }
});
test("actual main replacement waits for retired storage and rejects late writes or callbacks", async () => {
  const { readFile } = await import("node:fs/promises"), vm = await import("node:vm");
  const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const source = name => { const start = main.search(new RegExp("^(?:async )?function " + name + "\\(", "m")); assert.ok(start >= 0); return main.slice(start, main.indexOf("\n}\n", start) + 3); };
  let disk = null, oldCallback, newer;
  const old = savingCandidate({ linked: true, onWrite: value => { disk = structuredClone(value); }, changed: status => oldCallback?.(status) });
  const callbacks = [], events = [];
  const context = vm.createContext({
    studioAccountClient: null, studioAccountClientEpoch: 0, studioAccountActionGeneration: 0,
    studioAccountRetirement: Promise.resolve(), studioAccountQuitReady: false, studioAccountQuitPending: false,
    communitySetupCache: { hubUrl: "https://hub.example.test" }, hubClient: null, pcsMemo: null,
    communityHubUrl: () => context.communitySetupCache.hubUrl,
    process: { env: { MEFI_STUDIO_GOOGLE_SIGNIN: "1" } }, communityKeystore: () => true,
    readFileSync: () => JSON.stringify(disk), STUDIO_ACCOUNT_AUTH_PATH: "/fixture/authority",
    authStore: { atomicWriteJson: async (_path, value) => { disk = structuredClone(value); } },
    safeStorage: {}, shell: {}, hubAccessToken() {}, roomHistoryScopes: { select() {} }, roomHistoryStore: null,
    billingBrowserLinks: new Map(), commerceBrowserLinks: new Map(), send: (...args) => events.push(args),
    friendsHear() {}, pcsHear() {}, clearTimeout, Promise,
    studioAccountModule: { createAccountClient(options) {
      callbacks.push(options.onChange);
      if (callbacks.length === 1) { oldCallback = options.onChange; return old.client; }
      newer = harness({ origin: options.origin, stored: disk,
        reply: path => path.endsWith("/redeem") ? new Response(JSON.stringify({ ...session("studio:87654321-4321-4abc-9abc-cba987654321"), accountSession: "e".repeat(64) })) : null,
        write: value => { disk = structuredClone(value); }, changed: options.onChange,
      });
      return newer.client;
    } },
  });
  vm.runInContext(["studioAccount", "retireStudioAccount", "communitySetupReload"].map(source).join("\n"), context);
  const account = context.studioAccount(), signingIn = account.signIn({ link: true });
  await old.entered;
  let replaced = false;
  const replacing = context.communitySetupReload({ hubUrl: "https://next.example.test" }).then(() => { replaced = true; });
  await flush();
  assert.equal(replaced, false); assert.equal(context.studioAccount(), old.client); assert.equal(callbacks.length, 1);
  assert.equal((await old.client.useDiscord()).error, "unavailable"); assert.equal((await old.client.signOut()).error, "unavailable");
  const oldEvents = old.events.length;
  old.release(); await Promise.all([signingIn, replacing]);
  assert.equal(old.events.length, oldEvents, "retired cleanup cannot publish");
  assert.equal(context.studioAccountClient, null);
  const replacement = context.studioAccount(); assert.equal(callbacks.length, 2);
  assert.equal((await replacement.signIn()).ok, true);
  assert.equal(JSON.parse(Buffer.from(disk.encrypted, "base64").toString()).accountSession, "e".repeat(64));
  const activeHub = { disconnect: async () => { throw new Error("retired callback must not disconnect new hub"); } };
  context.hubClient = activeHub; const count = events.length, saved = structuredClone(disk);
  callbacks[0]({ linked: true, user: session().user, error: null });
  assert.equal(context.hubClient, activeHub); assert.equal(events.length, count);
  assert.equal((await old.client.signOut()).error, "unavailable"); await flush();
  assert.deepEqual(disk, saved); assert.equal((await replacement.accountSession()).accountSession, "e".repeat(64));
});

test("actual native quit gate waits for account persistence cleanup before retrying quit", async () => {
  const { readFile } = await import("node:fs/promises"), vm = await import("node:vm");
  const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const source = name => { const start = main.indexOf("function " + name + "("); return main.slice(start, main.indexOf("\n}\n", start) + 3); };
  const h = savingCandidate({ linked: true }), pending = h.client.signIn({ link: true });
  await h.entered; let prevented = 0, quits = 0;
  const context = vm.createContext({
    studioAccountClient: h.client, studioAccountClientEpoch: 0, studioAccountActionGeneration: 0,
    studioAccountRetirement: Promise.resolve(), studioAccountQuitReady: false, studioAccountQuitPending: false,
    app: { quit: () => quits++ }, Promise,
  });
  vm.runInContext(source("retireStudioAccount") + "\n" + source("studioAccountQuit"), context);
  const event = { preventDefault: () => prevented++ };
  assert.equal(context.studioAccountQuit(event), true); assert.equal(context.studioAccountQuit(event), true);
  await flush(); assert.equal(quits, 0); assert.equal(prevented, 2);
  h.release(); await pending; await context.studioAccountRetirement; await flush();
  assert.equal(quits, 1); assert.equal(h.persisted().accountSession, session().accountSession);
  assert.equal(context.studioAccountQuit(event), false);
});
test("retirement drains a later queued sign-out write after the superseded sign-in ends", async () => {
  const laterWrite = deferredWrite(), entered = deferredWrite();
  const h = savingCandidate({ linked: true, onWrite: async value => {
    if (value.encrypted === null) { entered.resolve(); await laterWrite.promise; }
  } });
  const signIn = h.client.signIn({ link: true }); await h.entered;
  const signOut = h.client.signOut(); let retired = false;
  const closing = h.client.close().then(() => { retired = true; });
  h.release(); await entered.promise; await flush();
  assert.equal(retired, false, "flow completion alone is not the final storage drain");
  laterWrite.resolve(); await Promise.all([signIn, signOut, closing]);
  assert.equal(retired, true); assert.equal(h.saves.at(-1).encrypted, null);
  assert.equal(h.client.status().linked, false);
});