import assert from "node:assert/strict";
import test from "node:test";
import { ECONOMY } from "../relay/src/economy.mjs";
import { COWORK, FIRST_MONDAY, JAM, THEMES, TOGETHER, WEEK_MS, coworkSlot, jamWindow, nextCoworkStart, splitPool, themeFor, weekOf } from "../relay/src/events.mjs";
import { CREDIT_REASONS, hubFrame } from "../relay/src/protocol.mjs";
import { ALICE, BOB, CARA, MOD, NEWBIE, makeRelay, rawSocket, until } from "./fixtures/relay-harness.mjs";

// Community events the relay runs by itself (relay/src/events.mjs) and the
// daily community budget they draw on (relay/src/economy.mjs): the weekly
// Build Jam, co-work hours and building together. Every reward goes through
// credits.award(): both sides in good standing, paid once, under the caps.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Monday 01:00 UTC of this week: a jam has just opened and no co-work hour is near.
const mondayMorning = () => FIRST_MONDAY + weekOf(Date.now()) * WEEK_MS + HOUR;

function api(relay) {
  const tokens = new Map();
  async function as(token, method, path, body, retried = false) {
    if (!tokens.has(token)) {
      const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
      tokens.set(token, (await answer.json()).session);
    }
    const headers = { authorization: `Bearer ${tokens.get(token)}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const answer = await relay.fetch(`http://127.0.0.1:8787${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // A session lasts 15 minutes; after the test's clock jumps, sign in again as Studio does.
    if (answer.status === 401 && !retried) {
      tokens.delete(token);
      return as(token, method, path, body, true);
    }
    return { status: answer.status, ...(await answer.json()) };
  }
  return as;
}

/** A member with Studio connected (a raw socket that said hello), with a room open when one is named, renewing when told. */
async function present(relay, token, roomId = null) {
  const raw = await rawSocket(relay, token);
  raw.send({ type: "hello", session: raw.session, protocol: 1 });
  await until(() => raw.of("ready").length, `${token} ready`);
  if (roomId) {
    raw.send({ type: "subscribe", roomId });
    await until(() => raw.frames.some((frame) => frame.type === "presence" && frame.roomId === roomId), `${token} in ${roomId}`);
  }
  return {
    ...raw,
    // The test clock jumps further than a session lasts: hand the socket a fresh one, as Studio does on its own timer.
    async renew() {
      const answer = await relay.fetch("http://127.0.0.1:8787/v1/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: token }) });
      raw.send({ type: "renew", session: (await answer.json()).session });
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

async function playFor(as, clock, token, projectId) {
  const play = await as(token, "POST", `/v1/projects/${projectId}/play`);
  clock.at += 2 * MINUTE + 1;
  return as(token, "POST", `/v1/projects/${projectId}/played`, { token: play.token });
}

test("themes, jam weeks and co-work slots follow the UTC calendar", () => {
  const week = weekOf(Date.UTC(2026, 9, 7, 12)); // a Wednesday
  const jam = jamWindow(week);
  assert.equal(new Date(jam.startsAt).getUTCDay(), 1, "a jam opens on a Monday");
  assert.equal(new Date(jam.startsAt).getUTCHours(), 0);
  assert.equal(jam.entriesUntil - jam.startsAt, 5 * DAY, "entries close on Saturday");
  assert.equal(jam.endsAt - jam.startsAt, WEEK_MS);
  assert.equal(jam.id, `jam_w${week}`);
  assert.equal(themeFor(week + THEMES.length), themeFor(week), "the themes go round");
  assert.notEqual(themeFor(week + 1), themeFor(week));
  const ten = Date.UTC(2026, 9, 7, 10);
  assert.equal(coworkSlot(ten - 11 * MINUTE), null, "a co-work hour opens ten minutes early, not more");
  assert.deepEqual(coworkSlot(ten - 5 * MINUTE), { id: `cowork_d${Math.floor(ten / DAY)}h10`, startsAt: ten, endsAt: ten + HOUR });
  assert.equal(coworkSlot(ten + HOUR), null);
  assert.equal(nextCoworkStart(ten), Date.UTC(2026, 9, 7, 18));
  assert.equal(nextCoworkStart(Date.UTC(2026, 9, 7, 19)), Date.UTC(2026, 9, 8, 2), "after the last hour, tomorrow's first");
  assert.deepEqual(COWORK.hoursUtc, [2, 10, 18]);
});

test("a jam's pool pays showcase rewards first, then 50/30/20 to entries with two votes or more", () => {
  const ranked = [
    { userId: "a", votes: 5, players: 6 },
    { userId: "b", votes: 2, players: 3 },
    { userId: "c", votes: 1, players: 4 },
    { userId: "d", votes: 0, players: 1 },
  ];
  const paid = Object.fromEntries(splitPool(100, ranked).map((payout) => [payout.userId, payout]));
  assert.deepEqual(Object.keys(paid).sort(), ["a", "b", "c"]);
  assert.equal(paid.c.amount, 5, "c played by four: a showcase reward, but one vote is no place");
  assert.equal(paid.c.why, "showcase");
  assert.equal(paid.a.place, 1);
  assert.equal(paid.a.amount, 5 + Math.floor(85 * 0.5));
  assert.equal(paid.b.place, 2);
  assert.equal(paid.b.amount, 5 + Math.floor(85 * 0.3));
  const crowd = Array.from({ length: 20 }, (_, index) => ({ userId: `p${index}`, votes: 0, players: 3 }));
  const thin = splitPool(60, crowd);
  assert.ok(thin.every((payout) => payout.amount === Math.floor((60 * JAM.showcaseShareMax) / 20)), "many showcase rewards share at most 30% of the pool");
  assert.ok(thin.reduce((sum, payout) => sum + payout.amount, 0) <= 60);
});

test("the community budget grows with the members seen this week, and plays and stars keep their own amounts", async () => {
  const clock = { at: mondayMorning() };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  for (const token of ["tok-alice", "tok-bob", "tok-cara"]) await as(token, "GET", "/v1/me");
  const events = await as("tok-alice", "GET", "/v1/events");
  assert.equal(events.status, 200);
  assert.deepEqual(events.budget, { day: Math.floor(clock.at / DAY), budget: ECONOMY.basePerDay + 3 * ECONOMY.perActiveMember, paid: 0, left: ECONOMY.basePerDay + 3 * ECONOMY.perActiveMember, active: 3 });
  // A play still pays its fixed amounts and does not touch the community budget.
  const shared = await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner", kind: "game" });
  assert.deepEqual((await playFor(as, clock, "tok-bob", shared.project.id)).credited, { owner: 5, you: 2 });
  assert.equal((await as("tok-alice", "GET", "/v1/events")).budget.paid, 0);
  // The day's active count is fixed once read: a member who shows up later counts from tomorrow.
  await as("tok-mod", "GET", "/v1/me");
  assert.equal((await as("tok-alice", "GET", "/v1/events")).budget.active, 3);
  assert.ok(CREDIT_REASONS.includes("jam") && CREDIT_REASONS.includes("together") && CREDIT_REASONS.includes("cowork"));
  assert.equal(hubFrame("credits", { balance: 1, lifetime: 1, today: 1, delta: 4, reason: "together", rank: "spark" }).reason, "together");
});

test("the Build Jam: enter until Saturday, vote only for what you played, hidden votes, prizes on Monday", async () => {
  const clock = { at: mondayMorning() };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  const listed = await as("tok-alice", "GET", "/v1/events");
  const jamId = listed.jam.id;
  assert.equal(listed.jam.phase, "entries");
  assert.equal(listed.jam.theme, themeFor(weekOf(clock.at)));
  assert.equal(listed.jam.nextTheme, themeFor(weekOf(clock.at) + 1));
  assert.equal(listed.jam.pool, ECONOMY.jamPoolMin, "on the first day the pool starts at its floor");

  const alice = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner", kind: "game" })).project.id;
  const bob = (await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/tiny-farm", title: "Tiny Farm", kind: "game" })).project.id;
  assert.equal((await as("tok-alice", "POST", `/v1/events/${jamId}/entry`, { projectId: bob })).reason, "not-yours");
  assert.equal((await as("tok-alice", "POST", `/v1/events/${jamId}/entry`, { projectId: alice })).status, 200);
  assert.equal((await as("tok-bob", "POST", `/v1/events/${jamId}/entry`, { projectId: bob })).status, 200);

  // Votes: only for an entry you played during the jam, never your own, three at most.
  assert.equal((await as("tok-cara", "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).reason, "play-first");
  for (const token of ["tok-cara", "tok-bob", "tok-mod"]) {
    await playFor(as, clock, token, alice);
    assert.equal((await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).status, 200, `${token} votes for Alice`);
  }
  assert.equal((await as("tok-alice", "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).reason, "self");
  for (const token of ["tok-alice", "tok-cara"]) {
    await playFor(as, clock, token, bob);
    await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: BOB.id });
  }
  // A new member plays but cannot vote (a week in the server first).
  await playFor(as, clock, "tok-newbie", alice);
  assert.equal((await as("tok-newbie", "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).reason, "standing");

  const running = await as("tok-cara", "GET", "/v1/events");
  assert.ok(running.jam.entries.every((entry) => entry.votes === undefined), "votes stay hidden while the jam runs");
  assert.deepEqual(running.jam.entries.map((entry) => [entry.user.id, entry.players, entry.voted, entry.played]), [[ALICE.id, 3, true, true], [BOB.id, 2, true, true]]);
  assert.equal(running.jam.you.votesLeft, JAM.votesPerMember - 2);

  // Saturday: no more entries, voting goes on.
  clock.at = jamWindow(weekOf(clock.at)).entriesUntil + HOUR;
  assert.equal((await as("tok-cara", "POST", `/v1/events/${jamId}/entry`, { projectId: alice })).reason, "entries-closed");
  assert.equal((await as("tok-alice", "GET", "/v1/events")).jam.phase, "voting");

  const before = Object.fromEntries(await Promise.all(["tok-alice", "tok-bob"].map(async (token) => [token, (await as(token, "GET", "/v1/me")).credits.balance])));
  // Next Monday: the alarm pays the results.
  clock.at = jamWindow(weekOf(clock.at)).endsAt + MINUTE;
  await relay.runAlarm();
  const after = await as("tok-alice", "GET", "/v1/events");
  assert.notEqual(after.jam.id, jamId, "next week's jam is open");
  assert.equal(after.lastJam.id, jamId);
  const results = Object.fromEntries(after.lastJam.results.map((payout) => [payout.userId, payout]));
  const pool = after.lastJam.pool;
  assert.ok(pool >= ECONOMY.jamPoolMin && pool <= ECONOMY.jamPoolMax, `pool ${pool}`);
  assert.equal(results[ALICE.id].place, 1);
  assert.equal(results[BOB.id].place, 2, "two votes is enough for a place");
  const showcase = Math.min(JAM.showcaseAmount, Math.floor((pool * JAM.showcaseShareMax) / 1));
  assert.equal(results[ALICE.id].amount, showcase + Math.floor((pool - showcase) * 0.5), "Alice: played by three, a showcase reward and first place");
  assert.equal(results[BOB.id].amount, Math.floor((pool - showcase) * 0.3));
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance - before["tok-alice"], results[ALICE.id].paid);
  assert.equal(results[ALICE.id].paid, results[ALICE.id].amount, "a prize is outside the daily cap");
  assert.equal((await as("tok-bob", "GET", "/v1/me")).credits.balance - before["tok-bob"], results[BOB.id].amount);
  // Running the alarm again pays nothing twice.
  await relay.runAlarm();
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance - before["tok-alice"], results[ALICE.id].amount);
  const rows = relay.sql(`SELECT actor_id, target_id, kind, amount FROM credit_events WHERE kind = 'jam'`);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.actor_id === `event:${jamId}`), "the giver of a prize is the event");
  // A moderator's review names the event, and its prizes never look like farming.
  const review = await as("tok-mod", "GET", `/v1/admin/credits/${ALICE.id}`);
  assert.ok(review.givers.some((giver) => giver.name === "a community event" && giver.id === null));
  const flags = await as("tok-mod", "GET", "/v1/admin/credits/flags");
  assert.ok(!flags.flags.some((flag) => flag.id === ALICE.id && flag.top.id?.startsWith?.("event:")));
});

test("a co-work hour: the relay opens the room, looks three times, pays who stayed with others, then closes it", async () => {
  const day = Math.floor(mondayMorning() / DAY);
  const start = day * DAY + 10 * HOUR;
  const clock = { at: start - 5 * MINUTE };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  const listed = await as("tok-alice", "GET", "/v1/events");
  assert.equal(listed.cowork.id, `cowork_d${day}h10`);
  assert.equal(listed.cowork.started, false);
  const eventId = listed.cowork.id;
  const roomId = listed.cowork.roomId;
  assert.ok(roomId, "the room is open ten minutes early");
  const room = relay.sql("SELECT kind, listed, owner_id FROM rooms WHERE id = ?", roomId)[0];
  assert.deepEqual({ ...room }, { kind: "cowork", listed: 1, owner_id: null });

  for (const token of ["tok-alice", "tok-bob", "tok-cara", "tok-newbie"]) assert.equal((await as(token, "POST", `/v1/events/${eventId}/join`)).status, 200, token);
  // Alice keeps the room open, Bob has Studio connected on another page (that counts: a restart mid-hour reconnects by
  // itself), the new member keeps it open too, and Cara joined but never connected.
  const sockets = [await present(relay, "tok-alice", roomId), await present(relay, "tok-bob"), await present(relay, "tok-newbie", roomId)];
  const before = Object.fromEntries(await Promise.all(["tok-alice", "tok-bob", "tok-cara", "tok-newbie"].map(async (token) => [token, (await as(token, "GET", "/v1/me")).credits.balance])));
  for (const offset of [...COWORK.checksAt, COWORK.lengthMs]) {
    clock.at = start + offset;
    for (const socket of sockets) await socket.renew();
    await relay.runAlarm();
  }
  const done = relay.sql("SELECT status, checks_done, results FROM events WHERE id = ?", eventId)[0];
  assert.equal(done.status, "closed");
  assert.equal(done.checks_done, 3);
  assert.equal(JSON.parse(done.results).attended, 3, "three were seen at two checks or more");
  const gained = async (token) => (await as(token, "GET", "/v1/me")).credits.balance - before[token];
  assert.equal(await gained("tok-alice"), COWORK.amount);
  assert.equal(await gained("tok-bob"), COWORK.amount);
  assert.equal(await gained("tok-cara"), 0, "joining without being there pays nothing");
  assert.equal(await gained("tok-bob"), COWORK.amount, "connected on any page counts");
  assert.equal(await gained("tok-newbie"), 0, "a new member earns nothing yet");
  const paid = relay.sql(`SELECT actor_id, target_id FROM credit_events WHERE kind = 'cowork' AND amount > 0 ORDER BY target_id`);
  assert.deepEqual(paid.map((row) => [row.target_id, row.actor_id]), [[ALICE.id, BOB.id], [BOB.id, ALICE.id]], "the giver is the other member who was there, so the pair limit applies");
  assert.equal(relay.sql("SELECT status FROM rooms WHERE id = ?", roomId)[0].status, "closed", "the room closes at the end of the hour");
  assert.equal((await as("tok-alice", "POST", `/v1/events/${eventId}/join`)).reason, "over");
  assert.equal((await as("tok-alice", "GET", "/v1/events")).budget.paid, 2 * COWORK.amount, "co-work hours draw on the community budget");
});

test("one member alone in a co-work hour earns nothing", async () => {
  const day = Math.floor(mondayMorning() / DAY);
  const start = day * DAY + 18 * HOUR;
  const clock = { at: start };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  const { cowork } = await as("tok-alice", "GET", "/v1/events");
  await as("tok-alice", "POST", `/v1/events/${cowork.id}/join`);
  const alone = await present(relay, "tok-alice", cowork.roomId);
  for (const offset of [...COWORK.checksAt, COWORK.lengthMs]) {
    clock.at = start + offset;
    await alone.renew();
    await relay.runAlarm();
  }
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM credit_events WHERE kind = 'cowork' AND amount > 0`)[0].n, 0);
});

test("building together: members in a co-work room at once earn once a day after three looks, under the pair limit", async () => {
  const clock = { at: mondayMorning() + 3 * HOUR };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  const room = await as("tok-alice", "POST", "/v1/rooms", { kind: "cowork", name: "Alice builds", policy: "invite", listed: false });
  assert.equal(room.status, 201, JSON.stringify(room));
  const roomId = room.room.id;
  const code = await as("tok-alice", "GET", `/v1/rooms/${roomId}/code`);
  assert.equal((await as("tok-bob", "POST", "/v1/join", { code: code.code })).status, 200);
  const sockets = [await present(relay, "tok-alice", roomId), await present(relay, "tok-bob", roomId)];
  const balance = async (token) => (await as(token, "GET", "/v1/me")).credits.balance;
  const start = { alice: await balance("tok-alice"), bob: await balance("tok-bob") };
  for (let look = 1; look <= TOGETHER.ticksNeeded + 1; look += 1) {
    clock.at += TOGETHER.everyMs + MINUTE;
    for (const socket of sockets) await socket.renew();
    await relay.runAlarm();
    const ticks = (await as("tok-alice", "GET", "/v1/events")).together.ticks;
    assert.equal(ticks, Math.min(look, TOGETHER.ticksNeeded));
  }
  assert.equal(await balance("tok-alice") - start.alice, TOGETHER.amount, "once a day, however long they stay");
  assert.equal(await balance("tok-bob") - start.bob, TOGETHER.amount);
  const rows = relay.sql(`SELECT actor_id, target_id FROM credit_events WHERE kind = 'together' ORDER BY target_id`);
  assert.deepEqual(rows.map((row) => [row.target_id, row.actor_id]), [[ALICE.id, BOB.id], [BOB.id, ALICE.id]]);
  // Looking twice within ten minutes counts once.
  const ticksBefore = relay.sql("SELECT SUM(ticks) AS n FROM together_ticks")[0].n;
  await relay.runAlarm();
  assert.equal(relay.sql("SELECT SUM(ticks) AS n FROM together_ticks")[0].n, ticksBefore);
});

test("Forget me takes a member's entries, votes and ticks with it", async () => {
  const clock = { at: mondayMorning() };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  const { jam } = await as("tok-cara", "GET", "/v1/events");
  const project = (await as("tok-cara", "POST", "/v1/projects", { url: "https://cara.itch.io/glow", title: "Glow" })).project.id;
  await as("tok-cara", "POST", `/v1/events/${jam.id}/entry`, { projectId: project });
  relay.sql("INSERT INTO together_ticks (day, user_id, ticks, partner_id, last_at) VALUES (?, ?, 1, ?, ?)", Math.floor(clock.at / DAY), CARA.id, MOD.id, clock.at);
  assert.equal((await as("tok-cara", "POST", "/v1/me/forget")).status, 200);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM event_entries WHERE user_id = ?", CARA.id)[0].n, 0);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM together_ticks WHERE user_id = ?", CARA.id)[0].n, 0);
  assert.ok(NEWBIE.id && BOB.id);
});
