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

function host({ link = { userId: "42" }, tokens = null, clientId = "1234567890", check } = {}) {
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
      createHubClient: (options) => { created = options; return { status: () => ({ configured: true, state: "off", error: null, user: null, readOnly: false, paused: false, rooms: [] }) }; },
    }),
  });
  vm.runInContext(`${block}\nthis.api = { hubAccessToken, hubStatus, hubInstance };`, context);
  return { api: context.api, context, sent, checks, created: () => created };
}

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
