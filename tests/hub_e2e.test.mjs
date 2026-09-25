import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import hubClient from "../scripts/hub-client.cjs";

// End to end across the two repositories: Studio's real scripts/hub-client.cjs
// (three members, real fetch and real WebSockets) against the Void Engine
// Bot's real hub server and WebSocket layer on 127.0.0.1, with the bot's fake
// Discord and manual clock, then the bot's real /nowplaying command reading
// what Studio shared. The bot is a separate repository, so this runs only when
// MEFI_STUDIO_BOT_ROOT names a checkout of it (with its node_modules) and is
// skipped otherwise:
//   MEFI_STUDIO_BOT_ROOT="C:/path/to/Void Engine Bot" node --test tests/hub_e2e.test.mjs

const ROOT = process.env.MEFI_STUDIO_BOT_ROOT;
const present = Boolean(ROOT) && existsSync(path.join(ROOT, "src", "rooms", "listen.mjs"));

test("listen together and /nowplaying, Studio client against the real hub", { skip: present ? false : "set MEFI_STUDIO_BOT_ROOT to a Void Engine Bot checkout" }, async () => {
  const bot = (file) => import(pathToFileURL(path.join(ROOT, file)).href);
  const { hubSetup, makeRoom, addMember, allowToken, threadOf, OWNER, ALICE, BOB } = await bot("test/helpers/hub.mjs");
  const { createHubServer } = await bot("src/http/server.mjs");
  const { attachWs } = await bot("src/http/ws.mjs");
  const { createNowPlaying } = await bot("src/nowplaying.mjs");
  const nowplayingCommand = await bot("src/commands/nowplaying.mjs");
  const { fakeInteraction } = await bot("test/helpers/engagement.mjs");
  const realWait = (ms) => new Promise((done) => setTimeout(done, ms));
  async function until(check, what, ms = 5000) {
    const end = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await realWait(25);
    }
  }
  const t = hubSetup();
  const nowPlaying = createNowPlaying({ clock: t.clock });
  const server = createHubServer({ config: t.config, services: { sessions: t.sessions, rooms: t.rooms, fanout: t.fanout, store: t.store }, clock: t.clock, log: t.log, hubState: t.hubState, registerClaimRoutes: null });
  const ws = attachWs(server, { services: { rooms: t.rooms, fanout: t.fanout, listen: t.listen, nowPlaying }, sessions: t.sessions, clock: t.clock, log: t.log });
  const address = await server.start(0);
  const url = `http://127.0.0.1:${address.port}`;
  const room = await makeRoom(t, { name: "Friday jam" });
  await addMember(t, room, ALICE);
  await addMember(t, room, BOB);
  function studio(userId) {
    const events = [];
    const client = hubClient.createHubClient({ url, now: () => t.clock.now(), getAccessToken: async () => ({ ok: true, token: allowToken(t, userId) }), onEvent: (event) => events.push(event) });
    const listens = () => events.filter((event) => event.type === "listen");
    return { client, events, listens, lastListen: () => listens().at(-1) };
  }
  const owner = studio(OWNER);
  const alice = studio(ALICE);
  const stranger = studio(BOB);
  try {
    await owner.client.connect(); await alice.client.connect();
    await until(() => owner.client.status().state === 'ready' && alice.client.status().state === 'ready', 'both Studios ready');
    assert.equal(owner.client.status().user.id, OWNER);
    // two Studios trade their Discord tokens for hub sessions and reach ready over a real WebSocket

    const rooms = await alice.client.rooms();
    assert.ok(rooms.ok && rooms.rooms.some((item) => item.id === room.id && item.you === 'member'), JSON.stringify(rooms));
    // GET /v1/rooms lists the room for a member

    owner.client.subscribe(room.id); alice.client.subscribe(room.id);
    await until(() => owner.listens().length && alice.listens().length, 'listen snapshots');
    assert.equal(alice.lastListen().session, null);
    // subscribing answers with a listen snapshot (nothing playing)

    const started = await owner.client.listen(room.id, { action: 'start', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', label: 'YouTube video', provider: 'youtube', positionMs: 0 });
    assert.deepEqual({ ...started }, { ok: true });
    const live = await until(() => alice.lastListen()?.session, "alice hears the owner's session");
    assert.equal(live.host.id, OWNER); assert.equal(live.playing, true); assert.equal(live.provider, 'youtube');
    assert.equal(owner.lastListen().session.id, live.id, 'the host gets the same frame');
    // the owner starts a YouTube session: ack, and both Studios receive it with the host and playing

    const refused = await alice.client.listen(room.id, { action: 'pause' });
    assert.deepEqual({ ...refused }, { ok: false, reason: 'not-yours', retryAfter: undefined });
    const hijack = await alice.client.listen(room.id, { action: 'start', url: 'https://vimeo.com/76979871', label: 'Vimeo video', provider: 'vimeo' });
    assert.equal(hijack.reason, 'not-yours');
    // a member who didn't start it can't pause or replace it (nack not-yours)

    const lan = await owner.client.listen(room.id, { action: 'start', url: 'https://192.168.1.1/cam.mp4', label: 'Video file', provider: 'file' });
    assert.equal(lan.reason, 'bad-link');
    // a file on a private network address is refused by the hub (bad-link)

    t.clock.advanceSync(5_000);
    const paused = await owner.client.listen(room.id, { action: 'pause', positionMs: 5_000 });
    assert.equal(paused.ok, true);
    const still = await until(() => { const s = alice.lastListen()?.session; return s && !s.playing ? s : null; }, 'the pause');
    assert.equal(still.positionMs, 5_000);
    // the host pauses at 5 s and the follower gets playing: false at 5000 ms

    const threadId = threadOf(t, room.id);
    const notice = await until(() => t.discord.messagesIn(threadId).find((message) => /listening together/i.test(message.content ?? '')), "the thread's notice", 8000);
    assert.match(notice.content, /Owner Olga/);
    // the room's Discord thread got one notice for the session

    await stranger.client.connect();
    await until(() => stranger.client.status().state === 'ready', 'bob ready');
    stranger.client.subscribe(room.id);
    const joined = await until(() => stranger.lastListen()?.session, 'a late joiner snapshot');
    assert.equal(joined.positionMs, 5_000); assert.equal(joined.playing, false);
    // a member who subscribes later gets the paused session in the snapshot

    alice.client.setNowPlaying({ label: 'Groove Salad', provider: 'radio' });
    await until(() => nowPlaying.get(ALICE), 'the share to land');
    const shared = nowPlaying.get(ALICE);
    assert.equal(shared.track.label, 'Groove Salad'); assert.equal(shared.track.provider, 'radio');
    // alice's Studio shares what it plays; the hub's store holds it

    const self = fakeInteraction({ commandName: 'nowplaying', user: { id: BOB, username: 'bob', globalName: 'Bob', bot: false }, options: { member: ALICE } });
    await nowplayingCommand.handle(self.interaction, { services: { nowPlaying }, adapter: t.discord.adapter, clock: t.clock, log: t.log, config: t.config });
    const reply = self.calls.at(-1).body;
    assert.match(JSON.stringify(reply.embeds), /Groove Salad/);
    assert.ok(!(Number(reply.flags) & 64), 'a shared track is answered publicly');
    // /nowplaying member:Alice shows her station publicly

    const stopped = await owner.client.listen(room.id, { action: 'stop' });
    assert.equal(stopped.ok, true);
    await until(() => alice.lastListen()?.session === null && stranger.lastListen()?.session === null, 'the stop');
    // stop reaches every follower as session: null

    await alice.client.disconnect();
    await until(() => alice.client.status().state === 'off', 'alice off');
    await realWait(200);
    assert.ok(nowPlaying.get(ALICE), 'kept through the grace period');
    t.clock.advanceSync(3 * 60_000);
    assert.equal(nowPlaying.get(ALICE), null, 'gone once the grace after the last socket closed has passed');
    // alice closes Studio: her share is dropped after the 2-minute grace
  } finally {
    for (const member of [owner, alice, stranger]) { try { await member.client.disconnect(); } catch {} }
    ws.close(); server.closeAllConnections(); await server.stop();
  }
});
