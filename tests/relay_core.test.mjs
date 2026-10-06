import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createChat, idTime } from "../relay/src/chat.mjs";
import { CLIENT_FRAMES, HUB_FRAMES, PROTOCOL_VERSION, parseClientFrame } from "../relay/src/protocol.mjs";
import { readConfig } from "../relay/src/sessions.mjs";
import { hmacKey, randomBytes } from "../relay/src/util.mjs";
import { ALICE, BOB, makeRelay, member, connectAll, rawSocket, until } from "./fixtures/relay-harness.mjs";

// The relay's pieces on their own: the message ids and signatures, sign-in
// refusals, the Worker's routing, forget-me, upkeep, and what the relay must
// never keep or say (relay/README.md, "What the relay keeps").

const relayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "relay");
const post = (relay, pathname, body, headers = {}) => relay.fetch(`http://127.0.0.1:8787${pathname}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("message ids look like Discord snowflakes, carry their time and prove their author", async () => {
  let clock = 1_800_000_000_000;
  const chat = createChat({ key: await hmacKey(randomBytes(32)), now: () => clock });
  const first = await chat.makeId("room_a", ALICE.id);
  const second = await chat.makeId("room_a", ALICE.id);
  assert.match(first, /^\d{17,20}$/);
  assert.notEqual(first, second, "two ids in the same millisecond still differ");
  assert.equal(idTime(first), clock);
  assert.equal(await chat.isAuthor(first, "room_a", ALICE.id), true);
  assert.equal(await chat.isAuthor(first, "room_a", BOB.id), false);
  assert.equal(await chat.isAuthor(first, "room_b", ALICE.id), false, "an id is bound to its room");
  clock += 1000;
  const message = await chat.build("room_a", { id: first, author: { id: ALICE.id, name: "Alice" }, text: "hi" });
  assert.equal(await chat.checkSig("room_a", message), true);
  assert.equal(await chat.checkSig("room_a", { ...message, text: "bye" }), false);
  assert.equal(await chat.checkSig("room_b", message), false);
});

test("the protocol keeps the hub's v1 frames and adds only feature-gated ones", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  for (const type of ["hello", "renew", "subscribe", "unsubscribe", "send", "edit", "delete", "presence", "ping", "listen", "nowPlaying"]) assert.ok(CLIENT_FRAMES[type], type);
  for (const type of ["ready", "message", "messageUpdate", "messageDelete", "presence", "joinRequest", "invite", "membership", "room", "claims", "listen", "ack", "nack", "hubState", "error", "pong"]) assert.ok(HUB_FRAMES[type], type);
  assert.equal(parseClientFrame(JSON.stringify({ type: "companion", roomId: "room_a", card: { v: 1, blob: "x".repeat(9000) } })).ok, false, "a companion card over 8 KB is refused");
  assert.equal(parseClientFrame(JSON.stringify({ type: "send", roomId: "room_a", text: "x", nonce: "n1", extra: "dropped" })).frame.extra, undefined);
  assert.equal(parseClientFrame("x".repeat(17 * 1024)).code, "tooLarge");
});

test("config: only snowflakes count, and a fake Discord is honoured on loopback only", () => {
  const config = readConfig({ STUDIO_APP_ID: "123", MOD_ROLE_IDS: "300000000000000001, nope", ROLE_IDS_JSON: '{"room_host":"300000000000000002","bad key":"1"}', DISCORD_API_BASE: "https://evil.example" });
  assert.equal(config.studioAppId, "");
  assert.deepEqual(config.modRoleIds, ["300000000000000001"]);
  assert.deepEqual({ ...config.roleIds }, { room_host: "300000000000000002" });
  assert.equal(config.apiBase, "https://discord.com/api/v10");
  assert.equal(readConfig({ DISCORD_API_BASE: "http://127.0.0.1:8799" }).apiBase, "http://127.0.0.1:8799");
});

test("sign-in refusals: wrong app, missing scope, not in the server, Discord down", async () => {
  const calls = [];
  const relay = makeRelay({ fetchCalls: calls });
  const status = async (token) => {
    const answer = await post(relay, "/v1/session", { accessToken: token });
    return [answer.status, (await answer.json()).error ?? "ok"];
  };
  assert.deepEqual(await status("tok-other-app"), [401, "unauthorized"]);
  assert.deepEqual(await status("tok-no-scope"), [401, "unauthorized"]);
  assert.deepEqual(await status("tok-stranger"), [403, "not-member"]);
  assert.deepEqual(await status("unknown"), [401, "unauthorized"]);
  assert.deepEqual(await status("tok-alice"), [200, "ok"]);

  // A renewal with the same token does not ask Discord who it is again.
  const before = calls.filter((call) => call.path.endsWith("/oauth2/@me")).length;
  assert.deepEqual(await status("tok-alice"), [200, "ok"]);
  assert.equal(calls.filter((call) => call.path.endsWith("/oauth2/@me")).length, before);

  // Discord down: a member checked recently still gets in; someone new does not.
  const down = makeRelay({ discord: { "tok-alice": { user: ALICE, down: true } } });
  const answer = await post(down, "/v1/session", { accessToken: "tok-alice" });
  assert.equal(answer.status, 503);
});

test("the Worker routes: health, 404 outside /v1, size and method limits, JSON errors", async () => {
  const relay = makeRelay();
  const health = await (await relay.fetch("http://127.0.0.1:8787/v1/health")).json();
  assert.deepEqual(health, { ok: true, protocol: 1, service: "mefi-relay", studioAppId: "100000000000000001" });
  assert.equal((await relay.fetch("http://127.0.0.1:8787/admin")).status, 404);
  assert.equal((await relay.fetch("http://127.0.0.1:8787/v1/rooms", { method: "PATCH" })).status, 405);
  const big = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json", "content-length": "20000" }, body: "x".repeat(20000) });
  assert.equal(big.status, 413);
  const text = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });
  assert.equal(text.status, 415);
  const noAuth = await relay.fetch("http://127.0.0.1:8787/v1/rooms");
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.headers.get("content-type"), /application\/json/);
});

test("WebSocket rules: hello first, one protocol, a cap on sockets per member", async () => {
  const relay = makeRelay();
  const early = await rawSocket(relay, "tok-alice");
  early.send({ type: "subscribe", roomId: "room_a" });
  await until(() => early.socket.readyState === 3, "closed for speaking before hello");
  const wrong = await rawSocket(relay, "tok-alice");
  wrong.send({ type: "hello", session: wrong.session, protocol: 2 });
  await until(() => wrong.socket.readyState === 3, "closed for the wrong protocol");

  const sockets = [];
  for (let index = 0; index < 6; index += 1) {
    const one = await rawSocket(relay, "tok-bob");
    one.send({ type: "hello", session: one.session, protocol: 1 });
    sockets.push(one);
    await until(() => one.of("ready").length || one.socket.readyState === 3, "an answer");
  }
  assert.equal(sockets.filter((one) => one.of("ready").length).length, 5, "five sockets per member");
  for (const one of sockets) one.socket.close();
});

test("forget me removes the member everywhere and closes their rooms", async () => {
  const relay = makeRelay();
  const alice = member(relay, "tok-alice");
  const bob = member(relay, "tok-bob");
  await connectAll(alice, bob);
  const made = await alice.client.createRoom({ kind: "cowork", name: "Gone soon", policy: "request", listed: true });
  const asked = await bob.client.requestJoin(made.room.id);
  await alice.client.decide(asked.request.id, "approve");
  await alice.client.claim(made.room.id, { machineId: "pc-a", paths: ["a.txt"], runId: "r" });

  const answer = await relay.fetch("http://127.0.0.1:8787/v1/me/forget", { method: "POST", headers: { authorization: `Bearer ${(await (await post(relay, "/v1/session", { accessToken: "tok-alice" })).json()).session}` } });
  assert.equal(answer.status, 200);
  for (const [table, column] of [["members", "user_id"], ["room_members", "user_id"], ["leases", "member_id"], ["token_cache", "user_id"]]) {
    assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, ALICE.id)[0].n, 0, table);
  }
  assert.equal(relay.sql("SELECT status FROM rooms WHERE id = ?", made.room.id)[0].status, "closed");
  await until(() => alice.client.status().state !== "ready", "alice's sockets closed");
  await alice.client.disconnect();
  await bob.client.disconnect();
});

test("upkeep and the alarm: retention runs once a day and the next alarm is always set", async () => {
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  await relay.hub.ready;
  relay.sql("INSERT INTO tombstones (message_id, room_id, at) VALUES ('1556701055531801106', 'room_x', ?)", clock - 8 * 86_400_000);
  relay.sql("INSERT INTO reports (id, room_id, message_id, reporter_id, reason, created_at) VALUES ('rep_1', 'room_x', '1', '2', 'x', ?)", clock - 31 * 86_400_000);
  await relay.runAlarm();
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM tombstones")[0].n, 0);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM reports")[0].n, 0);
  assert.ok(relay.alarmAt() > clock, "the next alarm is scheduled");
  assert.ok(relay.alarmAt() <= clock + 86_400_000 + 60_000, "at least once a day");
});

test("the relay's source keeps no logs, no Node-only APIs and no secrets", () => {
  const sources = readdirSync(path.join(relayRoot, "src")).filter((name) => name.endsWith(".mjs"));
  for (const name of sources) {
    const text = readFileSync(path.join(relayRoot, "src", name), "utf8");
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(text), `${name} logs`);
    assert.ok(!/from ['"]node:|(?<!Array)Buffer\./.test(text), `${name} uses a Node-only API`);
    assert.ok(!/cf-connecting-ip['"]\)[^;\n]*store\.run/.test(text), `${name} stores an IP`);
  }
  const toml = readFileSync(path.join(relayRoot, "wrangler.toml"), "utf8");
  assert.match(toml, /\[observability\]\s*\nenabled = false/);
  assert.match(toml, /new_sqlite_classes = \["Hub"\]/);
  assert.ok(!/^\s*\w*(SECRET|TOKEN|PASSWORD|KEY)\w*\s*=/im.test(toml), "no secret in wrangler.toml");
});
