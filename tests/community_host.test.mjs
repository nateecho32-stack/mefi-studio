import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import community from "../scripts/community.cjs";

// The host half of the Discord community link: main.cjs's "Discord community
// link" block and its community:* handlers, run in a vm against the real rules
// module, a fake Discord (the scripts/discord-oauth.cjs surface), an in-memory
// settings.json and userData folder, a fake keystore and a hand-turned clock.
// Nothing here opens a socket or a browser.

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}
const block = section("// ---- Discord community link: the Void collection perks", "// ---- end of the Discord community link");
// The handlers sit at the end of registerIpc, one line each.
const handlers = (() => {
  const from = source.indexOf("  // ---- Community ----");
  assert.ok(from > 0, "registerIpc has a Community block");
  const lines = [];
  for (const line of source.slice(from).split("\n").slice(1)) {
    if (line === "}") break;
    if (line.startsWith('  ipcMain.handle("community:')) lines.push(line);
  }
  return lines.join("\n");
})();

const { DAY, GRACE_MS, CHECK_EVERY_MS, FIRST_PROMPT_MS, CHECK_THROTTLE_MS, GUILD_ID, INVITE_URL } = community;
const HOUR = DAY / 24;
const T0 = 1_800_000_000_000;
const CLIENT = "1234567890123456789";
const USER_DATA = path.join("fixture", "userData");
const AUTH_FILE = path.join(USER_DATA, "community-auth.json");
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done)); };

const savedLink = (overrides = {}) => ({
  userId: "42", username: "mefi", globalName: "Mefi", roles: ["900"], joinedAt: null,
  linkedAt: T0, checkedAt: T0, lastOkAt: T0, nextCheckAt: T0 + CHECK_EVERY_MS, state: "ok", failures: 0, ...overrides,
});
const encrypted = (token) => Buffer.from(`enc:${token}`).toString("base64");

function host({ keystore = true, env = { MEFI_STUDIO_DISCORD_CLIENT_ID: CLIENT }, settings = {}, authFile = null, rules = community, oauth = {}, flags = {} } = {}) {
  let now = T0;
  let stored = plain(settings);
  const disk = new Map();
  if (authFile) disk.set(AUTH_FILE, JSON.stringify(authFile));
  const sent = [], opened = [], logs = [], calls = [], timers = [], registered = new Map();
  let rotation = 1;
  const member = { answer: "ok" };
  const discord = {
    authorize: async (options) => {
      calls.push({ name: "authorize", options });
      if (oauth.authorize) return oauth.authorize(options);
      return {
        ok: true,
        tokens: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: now + CHECK_EVERY_MS, scope: "identify guilds.members.read" },
        user: { id: "42", username: "mefi", globalName: "Mefi" },
        member: { roles: ["900"], joined_at: "2026-01-02T03:04:05.000Z" },
      };
    },
    refresh: async (options) => {
      calls.push({ name: "refresh", clientId: options.clientId, refreshToken: options.refreshToken });
      if (oauth.refresh) return oauth.refresh(options);
      rotation += 1;
      return { ok: true, tokens: { accessToken: `at-${rotation}`, refreshToken: `rt-${rotation}`, expiresAt: now + CHECK_EVERY_MS, scope: "" } };
    },
    fetchMember: async (options) => {
      // What was on disk at the moment the access token was first used.
      const blob = disk.has(AUTH_FILE) ? JSON.parse(disk.get(AUTH_FILE)).refreshTokenEncrypted : null;
      calls.push({ name: "fetchMember", accessToken: options.accessToken, guildId: options.guildId, savedRefresh: blob ? Buffer.from(blob, "base64").toString().slice(4) : null });
      if (oauth.fetchMember) return oauth.fetchMember(options);
      const user = { id: "42", username: "mefi", globalName: "Mefi" };
      if (member.answer === "ok") return { ok: true, user, member: { roles: ["900", "901"], joined_at: "2026-01-02T03:04:05.000Z" } };
      if (member.answer === "not-member") return { ok: false, error: "not-member", user };
      return { ok: false, error: member.answer };
    },
    revoke: async (options) => {
      calls.push({ name: "revoke", clientId: options.clientId, token: options.token });
      return { ok: true };
    },
  };
  const context = vm.createContext({
    path, Buffer, AbortController, URL,
    Date: class extends Date { static now() { return now; } },
    process: { env },
    app: { getPath: (name) => (name === "userData" ? USER_DATA : "elsewhere") },
    SMOKE: false, CAPTURE: false, CLI_MODE: false, ...flags,
    community: rules,
    discordOAuth: rules ? discord : null,
    readSettings: async () => plain(stored) ?? {},
    writeSettings: async (next) => { stored = plain(next); },
    settingsDisk: { queue: Promise.resolve() },
    authStore: { atomicWriteJson: async (file, payload) => { disk.set(file, JSON.stringify(payload, null, 2)); } },
    readFile: async (file) => {
      if (!disk.has(file)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return disk.get(file);
    },
    rm: async (file) => { disk.delete(file); },
    safeStorage: {
      isEncryptionAvailable: () => keystore,
      encryptString: (text) => Buffer.from(`enc:${text}`),
      decryptString: (buffer) => {
        const text = buffer.toString();
        if (!text.startsWith("enc:")) throw new Error("not ours");
        return text.slice(4);
      },
    },
    shell: { openExternal: async (url) => { opened.push(url); } },
    send: (channel, payload) => sent.push({ channel, payload: plain(payload) }),
    logLine: (line) => logs.push(line),
    setTimeout: (fn, ms) => { const timer = { kind: "timeout", fn, ms, unref() { this.unrefed = true; } }; timers.push(timer); return timer; },
    setInterval: (fn, ms) => { const timer = { kind: "interval", fn, ms, unref() { this.unrefed = true; } }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    clearInterval: (timer) => { if (timer) timer.cleared = true; },
    ipcMain: { handle: (name, handler) => registered.set(name, handler) },
  });
  vm.runInContext(`${block}\n${handlers}\n${section("function updateSettings(", "function send(channel, payload)")}`, context);
  return {
    context, disk, sent, opened, logs, calls, timers, member,
    get settings() { return plain(stored); },
    get now() { return now; },
    advance: (ms) => { now += ms; },
    at: (value) => { now = value; },
    invoke: async (name, payload) => {
      assert.ok(registered.has(name), `${name} is registered`);
      return plain(await registered.get(name)({}, payload));
    },
    run: (expression) => vm.runInContext(expression, context),
    tick: async () => plain(await vm.runInContext("communityWatchTick()", context)),
    count: (name) => calls.filter((call) => call.name === name).length,
    savedRefresh: () => {
      if (!disk.has(AUTH_FILE)) return null;
      return Buffer.from(JSON.parse(disk.get(AUTH_FILE)).refreshTokenEncrypted, "base64").toString().slice(4);
    },
  };
}

const linkedHost = (options = {}) => host({
  settings: { community: { firstSeenAt: T0 - 30 * DAY, prompt: { lastShownAt: null, snoozeUntil: null, never: false, shown: 0 }, link: savedLink() } },
  authFile: { refreshTokenEncrypted: encrypted("rt-1") },
  ...options,
});

test("the host registers exactly the seven community channels", () => {
  const h = host();
  for (const name of ["community:status", "community:link", "community:link-cancel", "community:check", "community:unlink", "community:prompt", "community:open"]) {
    assert.ok(handlers.includes(`ipcMain.handle("${name}"`), name);
  }
  assert.equal(handlers.split("\n").length, 7);
  assert.equal(h.run("COMMUNITY_AUTH_PATH"), AUTH_FILE, "the refresh token has its own file beside settings.json, not auth.json");
});

test("status stamps firstSeenAt once and the card waits out the first three days", async () => {
  const h = host();
  const first = await h.invoke("community:status");
  assert.equal(first.ok, true);
  assert.equal(h.settings.community.firstSeenAt, T0);
  assert.equal(first.status.available, true);
  assert.equal(first.status.configured, true);
  assert.equal(first.status.linked, false);
  assert.equal(first.status.prompt.due, false, "no card on the first day");
  assert.equal(first.status.inviteUrl, INVITE_URL);
  h.advance(FIRST_PROMPT_MS);
  const later = await h.invoke("community:status");
  assert.equal(h.settings.community.firstSeenAt, T0, "firstSeenAt is written once");
  assert.equal(later.status.prompt.due, true);
  const shown = await h.invoke("community:prompt", { action: "shown" });
  assert.equal(shown.status.prompt.due, false);
  assert.equal(h.settings.community.prompt.shown, 1);
  assert.equal((await h.invoke("community:prompt", { action: "explode" })).error, "action");
  assert.equal((await h.invoke("community:prompt", null)).error, "action");
  assert.equal(h.calls.length, 0, "the card cadence never reaches the network");
});

test("community:prompt accepts exactly the rules module's PROMPT_ACTIONS", async () => {
  const actions = [...community.PROMPT_ACTIONS];
  assert.deepEqual(plain(host().run("[...COMMUNITY_PROMPT_ACTIONS]")), actions, "the gate is built from the export");
  const narrowed = host({ rules: { ...community, PROMPT_ACTIONS: Object.freeze(["never"]) } });
  assert.deepEqual(plain(narrowed.run("[...COMMUNITY_PROMPT_ACTIONS]")), ["never"], "main follows the module's list, not a copy");
  assert.equal((await narrowed.invoke("community:prompt", { action: "shown" })).error, "action");
  // A rules module that predates the export: the literal fallback must match it.
  const older = { ...community };
  delete older.PROMPT_ACTIONS;
  assert.deepEqual(plain(host({ rules: older }).run("[...COMMUNITY_PROMPT_ACTIONS]")), actions);
  const h = host();
  for (const action of actions) assert.equal((await h.invoke("community:prompt", { action })).ok, true, action);
});

test("linking keeps the link in settings, the refresh token encrypted apart, and no token crosses IPC", async () => {
  const h = host();
  const reply = await h.invoke("community:link");
  assert.equal(reply.ok, true);
  assert.equal(reply.status.linked, true);
  assert.equal(reply.status.linking, false);
  assert.equal(reply.status.state, "ok");
  assert.deepEqual(reply.status.user, { id: "42", username: "mefi", globalName: "Mefi" });
  assert.deepEqual(reply.status.entitlement, { premium: true, perks: ["premium"], validUntil: T0 + GRACE_MS, reason: "member" });

  const [authorize] = h.calls;
  assert.equal(authorize.options.clientId, CLIENT);
  assert.equal(authorize.options.guildId, GUILD_ID);
  assert.deepEqual([...authorize.options.ports], [53134, 53135, 53136]);
  await assert.rejects(authorize.options.openExternal("https://evil.example/oauth2/authorize"), "only a Discord URL reaches the browser");
  await authorize.options.openExternal("https://discord.com/oauth2/authorize?client_id=1");
  assert.deepEqual(h.opened, ["https://discord.com/oauth2/authorize?client_id=1"]);

  assert.equal(h.settings.community.link.userId, "42");
  assert.deepEqual(h.settings.community.link.roles, ["900"]);
  assert.equal(h.savedRefresh(), "rt-1");
  assert.ok(!h.disk.get(AUTH_FILE).includes("rt-1"), "the file holds ciphertext only");
  for (const text of [JSON.stringify(h.settings), JSON.stringify(reply), JSON.stringify(h.sent)]) {
    assert.ok(!/at-1|rt-1|accessToken|refreshToken/.test(text), `no token: ${text.slice(0, 80)}`);
  }
  assert.ok(h.sent.some((event) => event.channel === "community:event" && event.payload.linking === true), "the renderer hears linking:true while the browser is open");
  assert.ok(!h.logs.join("\n").includes("rt-1"));
});

test("a login that is not a member still links, locked, so Check now can notice a join", async () => {
  const h = host({
    oauth: {
      authorize: async () => ({ ok: false, error: "not-member", tokens: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: T0 + DAY }, user: { id: "42", username: "mefi", globalName: null } }),
    },
  });
  const reply = await h.invoke("community:link");
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "not-member");
  assert.equal(reply.status.linked, true);
  assert.equal(reply.status.entitlement.premium, false);
  assert.equal(reply.status.entitlement.reason, "not-member");
  assert.equal(h.savedRefresh(), "rt-1");
  assert.equal(h.count("revoke"), 0, "a not-member login is kept, not handed back");
});

test("a grant whose user or member read fails, or that is canceled after the exchange, is revoked and nothing is kept", async () => {
  const granted = { accessToken: "at-9", refreshToken: "rt-9", expiresAt: T0 + DAY, scope: "identify guilds.members.read" };
  for (const answer of [
    { ok: false, error: "network", tokens: granted },
    { ok: false, error: "rate-limit", retryAfterMs: 5000, tokens: granted },
    { ok: false, error: "auth", tokens: granted },
    { ok: false, error: "canceled", tokens: granted },
  ]) {
    const h = host({ oauth: { authorize: async () => answer } });
    const reply = await h.invoke("community:link");
    assert.equal(reply.ok, false, answer.error);
    assert.equal(reply.error, answer.error);
    assert.equal(reply.retryAfterMs, answer.retryAfterMs);
    assert.deepEqual(h.calls.filter((call) => call.name === "revoke").map(({ clientId, token }) => ({ clientId, token })), [{ clientId: CLIENT, token: "rt-9" }], `${answer.error}: the orphan grant is revoked`);
    assert.equal(h.disk.has(AUTH_FILE), false, answer.error);
    assert.equal(h.settings.community?.link ?? null, null, answer.error);
    assert.equal(h.run("communityTokens"), null, `${answer.error}: nothing kept in memory`);
    assert.ok(!/at-9|rt-9/.test(JSON.stringify(reply)), "no token crosses IPC");
  }

  // Link again from the relink state: the old link and its saved token stay; only the new grant goes.
  const relink = linkedHost({ oauth: { authorize: async () => ({ ok: false, error: "network", tokens: granted }) } });
  const reply = await relink.invoke("community:link");
  assert.equal(reply.error, "network");
  assert.deepEqual(relink.calls.filter((call) => call.name === "revoke").map((call) => call.token), ["rt-9"]);
  assert.equal(relink.savedRefresh(), "rt-1");
  assert.equal(relink.settings.community.link.userId, "42");

  // A grant with no refresh token is handed back by its access token.
  const bare = host({ oauth: { authorize: async () => ({ ok: false, error: "network", tokens: { accessToken: "at-9", refreshToken: null, expiresAt: null } }) } });
  await bare.invoke("community:link");
  assert.deepEqual(bare.calls.filter((call) => call.name === "revoke").map((call) => call.token), ["at-9"]);
});

test("the watcher reaches Discord only when a check is due, and saves the rotated token before using it", async () => {
  const h = linkedHost();
  h.advance(HOUR);
  await h.tick();
  assert.equal(h.calls.length, 0, "not due: no request at all");

  h.at(T0 + CHECK_EVERY_MS);
  await h.tick();
  assert.deepEqual(h.calls.map((call) => call.name), ["refresh", "fetchMember"]);
  assert.equal(h.calls[0].refreshToken, "rt-1");
  assert.equal(h.calls[0].clientId, CLIENT);
  assert.equal(h.calls[1].accessToken, "at-2");
  assert.equal(h.calls[1].guildId, GUILD_ID);
  assert.equal(h.calls[1].savedRefresh, "rt-2", "the rotated refresh token was on disk before the access token was used");
  const link = h.settings.community.link;
  assert.equal(link.checkedAt, T0 + CHECK_EVERY_MS);
  assert.equal(link.lastOkAt, T0 + CHECK_EVERY_MS);
  assert.equal(link.nextCheckAt, T0 + 2 * CHECK_EVERY_MS);
  assert.deepEqual(link.roles, ["900", "901"]);

  h.advance(HOUR);
  await h.tick();
  assert.equal(h.count("fetchMember"), 1, "checked: not due again for a week");
});

test("a failed check keeps the perks through the grace period; not-member takes them at once", async () => {
  const h = linkedHost();
  h.member.answer = "network";
  h.at(T0 + CHECK_EVERY_MS + DAY);
  const offline = await h.tick();
  assert.equal(offline.state, "offline");
  assert.equal(offline.entitlement.premium, true);
  assert.equal(offline.entitlement.reason, "grace");
  assert.equal(offline.nextCheckAt, T0 + CHECK_EVERY_MS + DAY + HOUR, "retries after an hour");

  h.at(T0 + GRACE_MS);
  const expired = await h.tick();
  assert.equal(expired.entitlement.premium, false);
  assert.equal(expired.entitlement.reason, "expired");
  assert.equal(h.sent.at(-1).payload.entitlement.premium, false, "the renderer is told when grace runs out");

  const gone = linkedHost();
  gone.member.answer = "not-member";
  gone.at(T0 + CHECK_EVERY_MS);
  const revoked = await gone.tick();
  assert.equal(revoked.entitlement.premium, false);
  assert.equal(revoked.entitlement.reason, "not-member");
  assert.deepEqual(revoked.roles, []);

  const refused = linkedHost({ oauth: { refresh: async () => ({ ok: false, error: "auth" }) } });
  refused.at(T0 + CHECK_EVERY_MS);
  const relink = await refused.tick();
  assert.equal(relink.state, "relink");
  assert.equal(relink.entitlement.reason, "grace", "a refused grant lasts until grace runs out");
  assert.equal(refused.count("fetchMember"), 0);
});

test("unlink revokes at Discord, then deletes the link, the auth file and the tokens in memory", async () => {
  const h = host();
  await h.invoke("community:link");
  assert.ok(h.disk.has(AUTH_FILE));
  const reply = await h.invoke("community:unlink");
  assert.equal(reply.ok, true);
  assert.equal(reply.revoked, true);
  assert.deepEqual(h.calls.filter((call) => call.name === "revoke").map(({ clientId, token }) => ({ clientId, token })), [{ clientId: CLIENT, token: "rt-1" }]);
  assert.equal(h.disk.has(AUTH_FILE), false);
  assert.equal(h.settings.community.link, null);
  assert.equal(h.run("communityTokens"), null);
  assert.equal(reply.status.linked, false);
  assert.equal(reply.status.entitlement.reason, "unlinked");
  assert.equal(h.settings.community.firstSeenAt, T0, "the card cadence survives an unlink");
});

test("an unlink during a check waits for it, revokes the rotated token and drops the check's answer", async () => {
  const gate = deferred();
  const h = linkedHost({ oauth: { fetchMember: () => gate.promise } });
  h.at(T0 + CHECK_EVERY_MS);
  const check = h.tick();
  await settle();
  assert.equal(h.savedRefresh(), "rt-2", "the check already rotated and saved the token");
  const unlink = h.invoke("community:unlink");
  await settle();
  assert.equal(h.count("revoke"), 0, "the unlink waits for the check in flight");
  gate.resolve({ ok: true, user: { id: "42", username: "mefi" }, member: { roles: ["900"] } });
  const reply = await unlink;
  await check;
  assert.equal(reply.ok, true);
  assert.deepEqual(h.calls.filter((call) => call.name === "revoke").map((call) => call.token), ["rt-2"], "the live token is the one revoked");
  assert.equal(h.disk.has(AUTH_FILE), false);
  assert.equal(h.settings.community.link, null, "the check's answer did not resurrect the link");
});

test("a card action during a check survives the check's write", async () => {
  const gate = deferred();
  const h = linkedHost({ oauth: { fetchMember: () => gate.promise } });
  h.at(T0 + CHECK_EVERY_MS);
  const check = h.tick();
  await settle();
  const never = await h.invoke("community:prompt", { action: "never" });
  assert.equal(never.status.prompt.never, true);
  gate.resolve({ ok: false, error: "network" });
  await check;
  const saved = h.settings.community;
  assert.equal(saved.prompt.never, true, "the check re-read settings before writing");
  assert.equal(saved.link.state, "offline");
  assert.equal(saved.link.checkedAt, T0 + CHECK_EVERY_MS);
});

test("community:event is pushed only when the public signature changes", async () => {
  const h = host();
  await h.tick();
  await h.tick();
  assert.equal(h.sent.length, 1, "the first status is pushed once");
  await h.invoke("community:prompt", { action: "never" });
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].payload.prompt.never, true);
  await h.tick();
  h.advance(HOUR);
  await h.tick();
  assert.equal(h.sent.length, 2, "an hour passing with nothing to show pushes nothing");
  assert.ok(h.sent.every((event) => event.channel === "community:event"));
});

test("community:open opens only the hard-coded Discord targets", async () => {
  const h = host();
  assert.equal((await h.invoke("community:open", { target: "invite" })).ok, true);
  assert.equal((await h.invoke("community:open", { target: "server" })).ok, true);
  assert.deepEqual(h.opened, [INVITE_URL, `https://discord.com/channels/${GUILD_ID}`]);
  for (const target of ["https://evil.example", "javascript:alert(1)", "file:///C:/Windows/System32/calc.exe", "https://discord.gg/other", "", null, 42, {}]) {
    const reply = await h.invoke("community:open", { target });
    assert.equal(reply.ok, false, String(target));
    assert.equal(reply.error, "target");
  }
  assert.equal((await h.invoke("community:open", null)).error, "target");
  assert.equal(h.opened.length, 2, "nothing else reached the shell");
});

test("without a client id nothing tries to log in", async () => {
  const h = host({ env: {} });
  const status = await h.invoke("community:status");
  assert.equal(status.status.configured, false);
  const link = await h.invoke("community:link");
  assert.equal(link.ok, false);
  assert.equal(link.error, "not-configured");
  assert.equal(link.status.configured, false);
  assert.equal((await h.invoke("community:check")).error, "not-configured");
  assert.equal(h.calls.length, 0);
  assert.equal(host({ env: { MEFI_STUDIO_DISCORD_CLIENT_ID: "not-an-id" } }).run("communityClientId()"), "");
  assert.equal(host({ env: { MEFI_STUDIO_DISCORD_CLIENT_ID: ` ${CLIENT} ` } }).run("communityClientId()"), CLIENT);
});

test("Check now runs at most once a minute", async () => {
  const h = host();
  assert.equal((await h.invoke("community:check")).error, "unlinked");
  await h.invoke("community:link");
  const first = await h.invoke("community:check");
  assert.equal(first.ok, true);
  assert.equal(first.status.checkedAt, T0);
  h.advance(CHECK_THROTTLE_MS / 2);
  const throttled = await h.invoke("community:check");
  assert.equal(throttled.ok, false);
  assert.equal(throttled.error, "throttled");
  assert.equal(throttled.status.linked, true);
  assert.equal(h.count("fetchMember"), 1);
  h.advance(CHECK_THROTTLE_MS / 2);
  assert.equal((await h.invoke("community:check")).ok, true);
  assert.equal(h.count("fetchMember"), 2);
  assert.equal(h.count("refresh"), 0, "a live access token from this session is used as is");
});

test("without a keystore the link lives for this session only", async () => {
  const h = host({ keystore: false });
  const reply = await h.invoke("community:link");
  assert.equal(reply.ok, true);
  assert.equal(reply.status.linked, true);
  assert.equal(reply.status.state, "session");
  assert.equal(reply.status.entitlement.reason, "member");
  assert.equal(h.disk.has(AUTH_FILE), false, "nothing is written");
  assert.equal(h.settings.community.link, null, "settings.json keeps the cadence only");
  h.advance(CHECK_THROTTLE_MS);
  const check = await h.invoke("community:check");
  assert.equal(check.status.state, "session");
  const unlink = await h.invoke("community:unlink");
  assert.equal(unlink.status.linked, false);
  assert.equal(h.calls.filter((call) => call.name === "revoke")[0].token, "rt-1");
});

test("link-cancel ends an open login without storing anything", async () => {
  const h = host({
    oauth: {
      authorize: (options) => new Promise((resolve) => options.signal.addEventListener("abort", () => resolve({ ok: false, error: "canceled" }), { once: true })),
    },
  });
  assert.equal((await h.invoke("community:link-cancel")).error, "not-linking");
  const pending = h.invoke("community:link");
  await settle();
  assert.equal((await h.invoke("community:status")).status.linking, true);
  assert.equal((await h.invoke("community:link")).error, "busy", "one login at a time");
  const canceled = await h.invoke("community:link-cancel");
  assert.equal(canceled.ok, true);
  const reply = await pending;
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "canceled");
  assert.equal(reply.status.linked, false);
  assert.equal(reply.status.linking, false);
  assert.equal(h.disk.has(AUTH_FILE), false);
});

// Wraps one of the host's stand-ins (a vm global, or a method of one) so a
// test can fail, stall or watch that call; `around` gets the original first.
function wrap(owner, name, around) {
  const inner = owner[name];
  owner[name] = (...args) => around(inner, ...args);
}
const revokes = (h) => h.calls.filter((call) => call.name === "revoke").map(({ clientId, token }) => ({ clientId, token }));
const fsError = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });
const grantFor = (user, member = { roles: ["900"] }) => async () => ({
  ok: true, tokens: { accessToken: "at-9", refreshToken: "rt-9", expiresAt: T0 + DAY, scope: "identify guilds.members.read" }, user, member,
});

test("a grant Studio fails to keep is handed back, and nothing of it stays in memory or on disk", async () => {
  // The token file cannot be written (the keystore write or the rename fails).
  const unwritable = host({ settings: { community: { firstSeenAt: T0 } } });
  wrap(unwritable.context.authStore, "atomicWriteJson", async (write, file, payload) => {
    if (file === AUTH_FILE) throw fsError("EPERM", "operation not permitted, rename");
    return write(file, payload);
  });
  const reply = await unwritable.invoke("community:link");
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "storage");
  assert.equal(reply.status.linked, false);
  assert.equal(reply.status.linking, false);
  assert.deepEqual(revokes(unwritable), [{ clientId: CLIENT, token: "rt-1" }], "the grant goes back to Discord");
  assert.equal(unwritable.run("communityTokens"), null, "the pair communityKeep put in memory is gone again");
  assert.equal(unwritable.disk.has(AUTH_FILE), false);
  assert.equal(unwritable.settings.community.link ?? null, null);
  assert.ok(!/at-1|rt-1/.test(JSON.stringify(reply)), "no token crosses IPC");
  assert.ok(unwritable.logs.some((line) => line.includes("EPERM")), "the failure is logged");
  assert.ok(!unwritable.logs.join("\n").includes("rt-1"), "the token is not");

  // Linking again over a working link: the new token reached the file, then
  // settings.json refused the record. The old link, its token file and its
  // grant stay; only the new grant goes.
  const relink = linkedHost({ oauth: { authorize: grantFor({ id: "77", username: "other", globalName: null }, { roles: [] }) } });
  wrap(relink.context, "writeSettings", async (write, next) => {
    if (next.community?.link?.userId === "77") throw fsError("EBUSY", "resource busy or locked, rename");
    return write(next);
  });
  const refused = await relink.invoke("community:link");
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "storage");
  assert.deepEqual(revokes(relink).map((call) => call.token), ["rt-9"]);
  assert.equal(relink.savedRefresh(), "rt-1", "the old grant's token is back in the file");
  assert.equal(relink.settings.community.link.userId, "42");
  assert.equal(refused.status.user.id, "42");
  assert.equal(relink.run("communityTokens"), null, "memory is as it was");
  relink.at(T0 + CHECK_EVERY_MS);
  await relink.tick();
  assert.equal(relink.calls.find((call) => call.name === "refresh")?.refreshToken, "rt-1", "and the old link still checks");
  assert.equal(relink.settings.community.link.lastOkAt, T0 + CHECK_EVERY_MS);

  // No keystore: the session-only link does not stay in memory either.
  const session = host({ keystore: false, settings: { community: { firstSeenAt: T0 } } });
  wrap(session.context, "writeSettings", async () => { throw fsError("EPERM", "operation not permitted, open"); });
  const lost = await session.invoke("community:link");
  assert.equal(lost.error, "storage");
  assert.equal(lost.status.linked, false);
  assert.equal(session.run("communitySession"), null);
  assert.equal(session.run("communityTokens"), null);
  assert.deepEqual(revokes(session).map((call) => call.token), ["rt-1"]);

  // A login whose user cannot be recorded is handed back too.
  const nameless = host({ settings: { community: { firstSeenAt: T0 } }, oauth: { authorize: grantFor({ id: "\u0000" }) } });
  const unnamed = await nameless.invoke("community:link");
  assert.equal(unnamed.error, "auth");
  assert.deepEqual(revokes(nameless).map((call) => call.token), ["rt-9"]);
  assert.equal(nameless.disk.has(AUTH_FILE), false);
  assert.equal(nameless.run("communityTokens"), null);
});

test("a Cancel that lands after the grant is kept but before its link is recorded hands the grant back", async () => {
  for (const stall of ["the token file write", "the record's settings read"]) {
    const h = host({ settings: { community: { firstSeenAt: T0 } } });
    const gate = deferred();
    let kept = false;
    wrap(h.context.authStore, "atomicWriteJson", async (write, file, payload) => {
      await write(file, payload);
      if (file !== AUTH_FILE) return;
      kept = true;
      if (stall === "the token file write") await gate.promise;
    });
    wrap(h.context, "readSettings", async (read) => {
      if (kept && stall === "the record's settings read") {
        kept = false;
        await gate.promise;
      }
      return read();
    });
    const pending = h.invoke("community:link");
    await settle();
    assert.equal(h.savedRefresh(), "rt-1", `${stall}: keep has written the token file`);
    assert.equal(h.settings.community.link ?? null, null, `${stall}: the record has not landed`);
    const cancel = h.invoke("community:link-cancel");
    await settle();
    gate.resolve();
    const [canceled, reply] = await Promise.all([cancel, pending]);
    assert.equal(canceled.ok, true, stall);
    assert.equal(reply.ok, false, stall);
    assert.equal(reply.error, "canceled", stall);
    assert.equal(reply.status.linked, false, stall);
    assert.equal(reply.status.linking, false, stall);
    assert.deepEqual(revokes(h), [{ clientId: CLIENT, token: "rt-1" }], `${stall}: the grant goes back`);
    assert.equal(h.disk.has(AUTH_FILE), false, `${stall}: the token file is put back as it was (absent)`);
    assert.equal(h.run("communityTokens"), null, stall);
    assert.equal(h.settings.community.link ?? null, null, stall);
  }
});

test("a Cancel while the link waits out a check hands the new grant back and keeps the pair the check rotated", async () => {
  const gate = deferred();
  let refreshes = 0;
  const h = linkedHost({
    oauth: {
      authorize: grantFor({ id: "42", username: "mefi", globalName: "Mefi" }),
      refresh: async () => {
        refreshes += 1;
        if (refreshes === 2) await gate.promise;
        const n = refreshes + 1;
        return { ok: true, tokens: { accessToken: `at-${n}`, refreshToken: `rt-${n}`, expiresAt: h.now + CHECK_EVERY_MS, scope: "" } };
      },
    },
  });
  // The first check leaves a pair in memory; by the second, its access token has run out.
  h.at(T0 + CHECK_EVERY_MS);
  await h.tick();
  assert.equal(h.run("communityTokens.refreshToken"), "rt-2");
  h.at(T0 + 2 * CHECK_EVERY_MS);
  const check = h.tick();
  await settle();
  assert.equal(refreshes, 2, "the second check is trading rt-2 for a new pair");
  const pending = h.invoke("community:link");
  await settle();
  const cancel = h.invoke("community:link-cancel");
  await settle();
  gate.resolve();
  await check;
  const [canceled, reply] = await Promise.all([cancel, pending]);
  assert.equal(canceled.ok, true);
  assert.equal(reply.error, "canceled");
  assert.deepEqual(revokes(h).map((call) => call.token), ["rt-9"], "only the new grant goes back");
  assert.equal(h.run("communityTokens.refreshToken"), "rt-3", "the pair the check rotated during the wait stays in memory, not the retired rt-2");
  assert.equal(h.savedRefresh(), "rt-3");
  assert.equal(h.settings.community.link.userId, "42");
});

test("without the rules module the feature reports itself unavailable", async () => {
  const h = host({ rules: null });
  const status = await h.invoke("community:status");
  assert.equal(status.ok, true);
  assert.equal(status.status.available, false);
  assert.equal(status.status.entitlement.premium, false);
  assert.equal(status.status.prompt.due, false);
  for (const name of ["community:link", "community:link-cancel", "community:check", "community:unlink"]) {
    const reply = await h.invoke(name);
    assert.equal(reply.ok, false, name);
    assert.equal(reply.error, "unavailable", name);
    assert.equal(reply.status.available, false, name);
  }
  assert.equal((await h.invoke("community:open", { target: "invite" })).error, "unavailable");
  assert.equal((await h.invoke("community:prompt", { action: "never" })).error, "unavailable");
  assert.equal(h.opened.length, 0);
  assert.deepEqual(plain(h.run("startCommunityWatch()")), { ok: true, running: false });
});

test("the watcher starts once, unref'd, never in smoke, capture or CLI runs, and is silent while unlinked", async () => {
  for (const flag of ["SMOKE", "CAPTURE", "CLI_MODE"]) {
    const quiet = host({ flags: { [flag]: true } });
    assert.deepEqual(plain(quiet.run("startCommunityWatch()")), { ok: true, running: false }, flag);
    assert.equal(quiet.timers.length, 0, flag);
  }
  const h = host();
  assert.deepEqual(plain(h.run("startCommunityWatch()")), { ok: true, running: true });
  assert.deepEqual(plain(h.run("startCommunityWatch()")), { ok: true, running: true }, "a second start is a no-op");
  assert.deepEqual(h.timers.map(({ kind, ms, unrefed }) => ({ kind, ms, unrefed })), [
    { kind: "timeout", ms: 15_000, unrefed: true },
    { kind: "interval", ms: 60 * 60 * 1000, unrefed: true },
  ]);
  await h.timers[0].fn();
  await settle();
  assert.equal(h.calls.length, 0, "no link, no request");
  assert.equal(h.settings.community.firstSeenAt, T0, "the first tick starts the card's clock");
});

test("stopCommunityWatch clears both timers, and a tick already under way reaches neither Discord nor the window", async () => {
  const h = linkedHost();
  h.at(T0 + CHECK_EVERY_MS); // a check is due
  assert.deepEqual(plain(h.run("startCommunityWatch()")), { ok: true, running: true });
  const [first, hourly] = h.timers;
  const gate = deferred();
  wrap(h.context, "readSettings", async (read) => {
    await gate.promise;
    return read();
  });
  const underway = first.fn();
  await settle();
  assert.deepEqual(plain(h.run("stopCommunityWatch()")), { ok: true, running: false });
  assert.equal(first.cleared, true, "the first-check timeout is cleared");
  assert.equal(hourly.cleared, true, "the hourly interval is cleared");
  assert.equal(h.run("communityWatch"), null);
  gate.resolve();
  await underway;
  await settle();
  assert.equal(h.calls.length, 0, "the tick under way started no check");
  assert.equal(h.sent.length, 0, "and pushed nothing");
  assert.deepEqual(plain(h.run("stopCommunityWatch()")), { ok: true, running: false }, "a second stop is harmless");

  // A later start is a fresh watch; the stopped one's callback stays inert.
  assert.deepEqual(plain(h.run("startCommunityWatch()")), { ok: true, running: true });
  assert.equal(h.timers.length, 4);
  await first.fn();
  await settle();
  assert.equal(h.calls.length, 0);
  await h.timers[2].fn();
  await settle();
  assert.deepEqual(h.calls.map((call) => call.name), ["refresh", "fetchMember"]);
  assert.equal(h.sent.at(-1).channel, "community:event");
});

test("the watch stops with the others when the last window closes and before a release update applies", () => {
  const closing = section('app.on("window-all-closed"', "\n});");
  assert.ok(closing.includes("stopReleaseWatch();") && closing.includes("stopCommunityWatch();"), "closing the last window stops it");
  const applying = section("async function applyReleaseUpdate(", "\n}\n");
  const stop = applying.indexOf("stopCommunityWatch();");
  assert.ok(stop > 0 && stop < applying.indexOf("app.exit(0)"), "a release update stops it before the app exits");
});

test("community:* is app-wide: the project gate lets it through untouched", () => {
  const registered = new Map();
  const context = vm.createContext({ projects: {}, projectSwitching: true, projectOperations: 0, originalIpcHandle: (name, callback) => registered.set(name, callback), ipcMain: {} });
  vm.runInContext(section("function handleProjectIpc(", "app.setName("), context);
  const handler = async () => ({ ok: true });
  context.handleProjectIpc("community:status", handler);
  context.handleProjectIpc("tasks:list", handler);
  assert.equal(registered.get("community:status"), handler, "registered as is, never wrapped");
  assert.notEqual(registered.get("tasks:list"), handler, "project channels stay gated");
});

test("shell:open lets only http and https links out", async () => {
  const registered = new Map();
  const opened = [];
  const context = vm.createContext({
    URL,
    shell: { openExternal: async (url) => { opened.push(url); } },
    ipcMain: { handle: (name, callback) => registered.set(name, callback) },
  });
  vm.runInContext(section('  ipcMain.handle("shell:open"', '  ipcMain.handle("shell:reveal"'), context);
  const open = registered.get("shell:open");
  const spotify = `https://open.spotify.com/search/${encodeURIComponent("lofi beats")}`;
  assert.deepEqual(plain(await open({}, spotify)), { ok: true }, "renderer/music.js Spotify search keeps working");
  assert.deepEqual(plain(await open({}, "http://example.com/page?q=1")), { ok: true }, "renderer/tasks.js web hits keep working");
  for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:privacy", "mailto:a@b.c", "vbscript:x", "\\\\server\\share", "C:\\Windows\\notepad.exe", "not a url", "", null, 42, { href: "https://x" }, `https://x/${"a".repeat(9000)}`]) {
    const reply = plain(await open({}, url));
    assert.equal(reply.ok, false, String(url).slice(0, 60));
  }
  assert.deepEqual(opened, [spotify, "http://example.com/page?q=1"]);
});

test("the assistant loop never calls into the community code", () => {
  for (const [start, end] of [["function enqueue(role, job", "\nfunction "], ["function assistantStart(entry)", "\nfunction "], ["function assistantSettle(entry", "\nfunction "]]) {
    const body = section(start, end);
    assert.ok(!/community/i.test(body), `${start} stays free of community code, so the vm-host suites need no new stubs`);
  }
});
