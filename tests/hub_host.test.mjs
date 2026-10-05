import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// main.cjs's "Rooms hub" block in a vm: how it hands the hub client a Discord
// access token (never refreshing on its own, so it cannot race the community
// watcher's token rotation), what hub:status adds, and that every hub:*
// channel preload.cjs invokes has a handler that the project gate lets through.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Rooms hub: listen together and now playing");
const to = main.indexOf("// ---- end of the rooms hub", from);
assert.ok(from > 0 && to > from, "main.cjs has a Rooms hub block");
const block = main.slice(from, to);
const T0 = 1_800_000_000_000;
const MARGIN = 5 * 60 * 1000;

function host({ link = { userId: "42" }, tokens = null, clientId = "1234567890", check, client = {} } = {}) {
  const sent = [], checks = [];
  let created = null;
  const context = vm.createContext({
    Date: { now: () => T0 }, process: { env: {} }, Boolean, Number, Object,
    community: {}, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: MARGIN, communityTokens: tokens,
    communityClientId: () => clientId,
    communityRead: async () => ({ state: { link } }),
    checkCommunity: async () => { checks.push(1); return check ? check(context) : { ok: true }; },
    publishCommunity: async () => ({}),
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: () => {},
    require: () => null,
    optionalHelper: () => ({
      configuredUrl: () => "https://hub.example.test",
      createHubClient: (options) => { created = options; return { status: () => ({ configured: true, state: "off", error: null, user: null, readOnly: false, paused: false, rooms: [] }), ...client }; },
    }),
  });
  vm.runInContext(`${block}\nthis.api = { hubAccessToken, hubStatus, hubInstance, hubSubscribe };`, context);
  return { api: context.api, context, sent, checks, created: () => created };
}

test("the renderer holds rooms as Rooms or Listen together, never as the cowork claims", async () => {
  const seen = [];
  const h = host({ client: {
    subscribe: (roomId, holder) => { seen.push(["subscribe", roomId, holder]); return true; },
    unsubscribe: (roomId, holder) => { seen.push(["unsubscribe", roomId, holder]); return true; },
  } });
  await h.api.hubSubscribe("room_a", true, "rooms");
  await h.api.hubSubscribe("room_a", false, "together");
  await h.api.hubSubscribe("room_a", false, "cowork");
  await h.api.hubSubscribe("room_a", true, undefined);
  assert.deepEqual(seen, [["subscribe", "room_a", "rooms"], ["unsubscribe", "room_a", "together"], ["unsubscribe", "room_a", "default"], ["subscribe", "room_a", "default"]],
    "a renderer that names the cowork hold releases only its own default hold");
  assert.match(preload, /hubSubscribe: \(roomId, on = true, holder = null\) => ipcRenderer\.invoke\("hub:subscribe", \{[^}]*holder: typeof holder === "string" \? holder : null \}\)/);
  assert.match(main, /ipcMain\.handle\("hub:subscribe", async \(_event, payload\) => hubSubscribe\(payload\?\.roomId, payload\?\.on !== false, payload\?\.holder\)\);/);
});

test("a live Discord access token is handed over as is", async () => {
  const h = host({ tokens: { accessToken: "live", expiresAt: T0 + MARGIN + 60_000 } });
  assert.deepEqual({ ...(await h.api.hubAccessToken()) }, { ok: true, token: "live" });
  assert.equal(h.checks.length, 0, "no refresh, no check");
});

test("a stale token is renewed through the community check, never by the hub itself", async () => {
  const h = host({ tokens: { accessToken: "old", expiresAt: T0 + 1_000 }, check: (context) => { context.communityTokens = { accessToken: "fresh", expiresAt: T0 + 3_600_000 }; return { ok: true }; } });
  assert.deepEqual({ ...(await h.api.hubAccessToken()) }, { ok: true, token: "fresh" });
  assert.equal(h.checks.length, 1);
  const refused = host({ tokens: null, check: () => ({ ok: false, error: "not-member" }) });
  assert.deepEqual({ ...(await refused.api.hubAccessToken()) }, { ok: false, error: "not-member" });
});

test("no link, or a build without the Discord client, answers before any check", async () => {
  const unlinked = host({ link: null });
  assert.deepEqual({ ...(await unlinked.api.hubAccessToken()) }, { ok: false, error: "not-linked" });
  assert.equal(unlinked.checks.length, 0);
  const unconfigured = host({ clientId: "" });
  assert.deepEqual({ ...(await unconfigured.api.hubAccessToken()) }, { ok: false, error: "not-configured" });
});

test("hub:status adds whether Discord is linked; client events reach the renderer as hub:event", async () => {
  const h = host();
  const status = await h.api.hubStatus();
  assert.equal(status.linked, true); assert.equal(status.communityConfigured, true); assert.equal(status.configured, true);
  h.created().onEvent({ type: "status", status: { state: "ready" } });
  assert.deepEqual(h.sent.map(([channel]) => channel), ["hub:event"]);
  assert.equal(h.created().getAccessToken, h.api.hubAccessToken, "the client asks the host for tokens");
});

test("every hub:* channel the preload invokes is handled in main and app-wide", () => {
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\("(hub:[a-z-]+)"/g)].map((match) => match[1]);
  const handled = new Set([...main.matchAll(/ipcMain\.handle\("(hub:[a-z-]+)"/g)].map((match) => match[1]));
  assert.ok(invoked.length >= 7);
  for (const channel of invoked) assert.ok(handled.has(channel), `${channel} has a handler`);
  assert.match(main, /const APP_WIDE_PREFIXES = \[[^\]]*"hub:"/, "rooms belong to the member, not to the open project");
  assert.match(preload, /onHubEvent: \(callback\) => ipcRenderer\.on\("hub:event"/);
});

// Connection details (Settings › Community): the link app id and hub address
// saved in settings, used at once, with the environment still winning.
import { createRequire } from "node:module";
const requireHere = createRequire(import.meta.url);
const communityRules = requireHere("../scripts/community.cjs");
const hubClientModule = requireHere("../scripts/hub-client.cjs");
const APP = "1400000000000000001";

function setupHost({ saved, env = {}, reachable = true, status = 200, answer = { ok: true, protocol: 1, paused: false } } = {}) {
  let settings = saved === undefined ? {} : { communitySetup: saved };
  const fetches = [], published = [], logs = [];
  let disconnected = 0;
  const context = vm.createContext({
    process: { env }, AbortController, setTimeout, clearTimeout,
    community: communityRules, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: MARGIN, communityTokens: null,
    communityClientId: () => String(env.MEFI_STUDIO_DISCORD_CLIENT_ID || context.communitySetup().clientId || ""),
    communityRead: async () => ({ state: { link: null } }),
    checkCommunity: async () => ({ ok: true }),
    publishCommunity: async (options) => { published.push(options); return { configured: true }; },
    send: () => {}, logLine: (line) => logs.push(line), require: () => null,
    SETTINGS_PATH: "settings.json",
    readFileSync: () => JSON.stringify(settings),
    updateSettings: async (mutate) => { const next = JSON.parse(JSON.stringify(settings)); await mutate(next); settings = next; return next; },
    fetch: async (url) => { fetches.push(url); if (!reachable) throw new Error("connect ECONNREFUSED"); return { ok: status === 200, status, json: async () => answer }; },
    optionalHelper: () => ({ ...hubClientModule, createHubClient: (options) => ({ url: options.url, status: () => ({ configured: Boolean(options.url), state: "off", error: null, user: null, readOnly: false, paused: false, rooms: [] }), disconnect: async () => { disconnected += 1; } }) }),
  });
  vm.runInContext(`${block}\nthis.api = { communitySetupView, communitySetupSave, hubInstance, communitySetup };`, context);
  return { api: context.api, settings: () => settings, fetches, published, logs, disconnected: () => disconnected };
}
const plainCopy = (value) => JSON.parse(JSON.stringify(value));

test("connection details save, answer at once and say whether the hub is there", async () => {
  const h = setupHost();
  assert.deepEqual(plainCopy(h.api.communitySetupView()), { ok: true, clientId: "", hubUrl: "", environment: { clientId: false, hubUrl: false }, linkReady: false, hubReady: false });
  const saved = plainCopy(await h.api.communitySetupSave({ clientId: APP, hubUrl: "https://hub.example.com/" }));
  assert.equal(saved.ok, true);
  assert.deepEqual([saved.clientId, saved.hubUrl, saved.linkReady, saved.hubReady], [APP, "https://hub.example.com", true, true]);
  assert.deepEqual(saved.health, { ok: true, protocol: 1, paused: false });
  assert.deepEqual(h.fetches, ["https://hub.example.com/v1/health"]);
  assert.deepEqual(plainCopy(h.settings().communitySetup), { clientId: APP, hubUrl: "https://hub.example.com" });
  assert.deepEqual(plainCopy(h.published), [{ force: true }], "the Community card repaints with Link my Discord");
  assert.ok(!h.logs.join("\n").includes(APP) && !h.logs.join("\n").includes("hub.example.com"), "the log says what changed, not the values");
});

test("a new hub address drops the old client; the next one uses it", async () => {
  const h = setupHost({ saved: { clientId: APP, hubUrl: "https://old.example.com" } });
  assert.equal(h.api.hubInstance().url, "https://old.example.com");
  await h.api.communitySetupSave({ clientId: APP, hubUrl: "https://new.example.com" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.disconnected(), 1);
  assert.equal(h.api.hubInstance().url, "https://new.example.com");
  await h.api.communitySetupSave({ clientId: "", hubUrl: "https://new.example.com" });
  assert.equal(h.disconnected(), 1, "the same address keeps its client");
});

test("bad values are refused with the reason and nothing is saved; empty values clear", async () => {
  const h = setupHost({ saved: { clientId: APP, hubUrl: "https://hub.example.com" } });
  const refused = plainCopy(await h.api.communitySetupSave({ clientId: "abc", hubUrl: "http://hub.example.com/rooms" }));
  assert.equal(refused.ok, false);
  assert.match(refused.errors.clientId, /17 to 20 digits/);
  assert.match(refused.errors.hubUrl, /https:\/\//);
  assert.deepEqual(plainCopy(h.settings().communitySetup), { clientId: APP, hubUrl: "https://hub.example.com" }, "left as it was");
  assert.equal(h.fetches.length, 0);
  await h.api.communitySetupSave({ clientId: "", hubUrl: "" });
  assert.equal("communitySetup" in h.settings(), false, "cleared from settings");
  assert.deepEqual([h.api.communitySetupView().linkReady, h.api.communitySetupView().hubReady], [false, false]);
});

test("the environment still wins, and an unreachable hub is saved with the reason", async () => {
  const env = { MEFI_STUDIO_HUB_URL: "http://127.0.0.1:8787", MEFI_STUDIO_DISCORD_CLIENT_ID: APP };
  const h = setupHost({ env, reachable: false });
  const saved = plainCopy(await h.api.communitySetupSave({ clientId: "", hubUrl: "https://hub.example.com" }));
  assert.deepEqual(saved.environment, { clientId: true, hubUrl: true });
  assert.equal(h.api.hubInstance().url, "http://127.0.0.1:8787", "a maintainer's test hub wins");
  assert.equal(saved.health.ok, false);
  assert.match(saved.health.error, /could not reach the rooms service/);
  const wrong = setupHost({ status: 404, answer: null });
  assert.match((await wrong.api.communitySetupSave({ hubUrl: "https://example.com" })).health.error, /not as a Void Engine hub \(HTTP 404\)/);
});

test("a hub that names its link app fills in the link app ID when only its address was given", async () => {
  const h = setupHost({ answer: { ok: true, protocol: 1, paused: false, studioAppId: APP } });
  const saved = plainCopy(await h.api.communitySetupSave({ clientId: "", hubUrl: "https://hub.example.com" }));
  assert.deepEqual([saved.clientId, saved.linkReady, saved.health.appId], [APP, true, APP]);
  assert.deepEqual(plainCopy(h.settings().communitySetup), { clientId: APP, hubUrl: "https://hub.example.com" });
  const typed = setupHost({ answer: { ok: true, protocol: 1, paused: false, studioAppId: "1500000000000000002" } });
  assert.equal((await typed.api.communitySetupSave({ clientId: APP, hubUrl: "https://hub.example.com" })).clientId, APP, "a typed ID is never replaced");
  const odd = setupHost({ answer: { ok: true, protocol: 1, studioAppId: "not-an-id" } });
  assert.equal((await odd.api.communitySetupSave({ hubUrl: "https://hub.example.com" })).clientId, "");
});

test("room history: this PC keeps what it saw, answers the relay's asks from it, and Rooms reads pages from it", async () => {
  const { createRequire } = await import("node:module");
  const roomHistory = createRequire(import.meta.url)("../scripts/room-history.cjs");
  const sent = [];
  const replies = [];
  const asks = [];
  let created = null;
  const message = (n) => ({ id: String(1556701055531801000n + BigInt(n)), author: { id: "200000000000000001", name: "Alice", viaStudio: true }, text: `m${n}`, createdAt: T0 - 1000 + n, editedAt: null, mentions: [], attachments: [], replyTo: null, truncated: false, sig: "abcdefghijklmnopqrstuv" });
  const client = {
    status: () => ({ configured: true, state: "ready", error: null, user: { id: "200000000000000002", name: "Me" }, readOnly: false, paused: false, rooms: ["room_a"], history: true }),
    historyReply: (requestId, messages, hasMore) => { replies.push({ requestId, ids: messages.map((item) => item.id), hasMore }); return true; },
    historyAsk: async (roomId, before) => { asks.push([roomId, before]); return { ok: true }; },
    messages: async () => ({ ok: true, messages: [], hasMore: false }),
    report: async (...args) => ({ ok: true, args }),
  };
  const context = vm.createContext({
    Date: { now: () => T0 }, process: { env: {} }, Boolean, Number, Object, String, Buffer, JSON, Array,
    setTimeout: () => 1, clearTimeout: () => {},
    path: { join: (...parts) => parts.join("/") }, app: { getPath: () => "/user-data" },
    readFileSync: () => { throw new Error("no file yet"); },
    safeStorage: { isEncryptionAvailable: () => false }, authStore: { atomicWriteJson: async () => {} },
    community: {}, discordOAuth: {}, COMMUNITY_ACCESS_MARGIN_MS: MARGIN, communityTokens: null,
    communityClientId: () => "1234567890", communityRead: async () => ({ state: { link: { userId: "42" } } }), checkCommunity: async () => ({ ok: true }), publishCommunity: async () => ({}),
    send: (channel, payload) => sent.push([channel, payload]), logLine: () => {}, require: () => null,
    optionalHelper: (file) => (file.includes("room-history") ? roomHistory : {
      configuredUrl: () => "https://hub.example.test",
      createHubClient: (options) => { created = options; return client; },
    }),
  });
  vm.runInContext(`${block}\nthis.api = { hubInstance, hubRoom };`, context);
  context.api.hubInstance();
  for (let n = 0; n < 3; n += 1) created.onEvent({ type: "message", roomId: "room_a", message: message(n) });
  assert.equal(sent.filter(([, event]) => event.type === "message").length, 3, "messages still reach Rooms");

  created.onEvent({ type: "historyRequest", roomId: "room_a", requestId: "hist_1", before: null });
  assert.deepEqual(replies, [{ requestId: "hist_1", ids: [message(0).id, message(1).id, message(2).id], hasMore: false }], "the relay's ask is answered from this PC's copy");
  assert.equal(sent.some(([, event]) => event.type === "historyRequest"), false, "and never reaches the renderer");

  created.onEvent({ type: "history", roomId: "room_a", messages: [message(5)], hasMore: false });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), ["hub:event", { type: "historyFill", roomId: "room_a" }], "a filled gap tells Rooms to reload");

  const page = await context.api.hubRoom("messages", ["room_a"]);
  assert.deepEqual(page.messages.map((item) => item.text), ["m0", "m1", "m2", "m5"]);
  assert.deepEqual(asks, [["room_a", null]], "opening a room asks the room for what this PC missed");

  const reported = await context.api.hubRoom("report", ["room_a", message(1).id, "spam"]);
  assert.equal(reported.args[3].sig, "abcdefghijklmnopqrstuv", "a report carries this PC's signed copy");

  created.onEvent({ type: "membership", roomId: "room_a", userId: "200000000000000002", state: "left" });
  assert.equal((await context.api.hubRoom("messages", ["room_a"])).messages.length, 0, "leaving a room forgets its copy");
});
