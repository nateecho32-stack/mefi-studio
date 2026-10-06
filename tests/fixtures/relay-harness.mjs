// Shared set-up for the relay suites: the relay under Node (relay/node/adapter.mjs)
// with a scripted Discord, and Studio's real scripts/hub-client.cjs as each member.

import { createRequire } from "node:module";
import { createNodeRelay } from "../../relay/node/adapter.mjs";

const require = createRequire(import.meta.url);
export const hubClient = require("../../scripts/hub-client.cjs");

export const HOST_ROLE = "300000000000000001";
export const MOD_ROLE = "300000000000000002";
export const ALICE = { id: "200000000000000001", username: "alice", global_name: "Alice" };
export const BOB = { id: "200000000000000002", username: "bob", global_name: "Bob" };
export const CARA = { id: "200000000000000003", username: "cara", global_name: "Cara" };
export const NEWBIE = { id: "200000000000000004", username: "newbie" };
export const MOD = { id: "200000000000000005", username: "mod", global_name: "Mod" };

const day = 86_400_000;
export const DISCORD = {
  "tok-alice": { user: ALICE, member: { roles: [HOST_ROLE] } },
  "tok-bob": { user: BOB },
  "tok-cara": { user: CARA },
  "tok-newbie": { user: NEWBIE, member: { joined_at: new Date(Date.now() - 2 * 3_600_000).toISOString() } },
  "tok-mod": { user: MOD, member: { roles: [MOD_ROLE] } },
  "tok-stranger": { user: { id: "200000000000000009", username: "stranger" }, member: null },
  "tok-other-app": { user: { id: "200000000000000010", username: "other" }, appId: "100000000000000099" },
  "tok-no-scope": { user: { id: "200000000000000011", username: "noscope" }, scopes: ["identify"] },
  "tok-week": { user: { id: "200000000000000012", username: "week" }, member: { joined_at: new Date(Date.now() - 3 * day).toISOString() } },
};

export function makeRelay(options = {}) {
  return createNodeRelay({
    env: { ROLE_IDS_JSON: JSON.stringify({ room_host: HOST_ROLE }), MOD_ROLE_IDS: MOD_ROLE, ...(options.env ?? {}) },
    discord: { ...DISCORD, ...(options.discord ?? {}) },
    fetchCalls: options.fetchCalls ?? [],
    now: options.now,
  });
}

/** One member's Studio: the real hub client against the relay, recording every event. */
export function member(relay, token) {
  const events = [];
  const client = hubClient.createHubClient({
    url: "http://127.0.0.1:8787",
    fetch: relay.fetch,
    WebSocket: relay.WebSocket,
    getAccessToken: async () => ({ ok: true, token }),
    onEvent: (event) => events.push(event),
  });
  return { client, events, of: (type) => events.filter((event) => event.type === type) };
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function until(check, what, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

/** Connect each member and wait until every socket is ready. */
export async function connectAll(...members) {
  for (const one of members) await one.client.connect();
  await until(() => members.every((one) => one.client.status().state === "ready"), "every member ready");
}

/** A raw socket that speaks frames directly (for frames hub-client does not send yet). */
export async function rawSocket(relay, token) {
  const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
  const { session } = await answer.json();
  const socket = new relay.WebSocket("ws://127.0.0.1:8787/v1/ws");
  const frames = [];
  socket.onmessage = (event) => frames.push(JSON.parse(event.data));
  await until(() => socket.readyState === 1, "socket open");
  return { socket, frames, session, send: (frame) => socket.send(JSON.stringify(frame)), of: (type) => frames.filter((frame) => frame.type === type) };
}
