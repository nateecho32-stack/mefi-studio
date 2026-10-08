import assert from "node:assert/strict";
import test from "node:test";
import { ECONOMY } from "../relay/src/economy.mjs";
import { COWORK, FIRST_MONDAY, JAM, THEMES, TOGETHER, WEEK_MS, coworkSlot, jamWindow, nextCoworkStart, splitPool, themeFor, weekOf } from "../relay/src/events.mjs";
import { CREDIT_REASONS, hubFrame } from "../relay/src/protocol.mjs";
import { ALICE, BOB, CARA, MOD, NEWBIE, connectAll, makeRelay, member, rawSocket, until } from "./fixtures/relay-harness.mjs";

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

test("a jam's pool pays showcase rewards first, then 50/30/20 to entries with three votes or more, 40 a vote at most", () => {
  const ranked = [
    { userId: "a", votes: 5, players: 6 },
    { userId: "b", votes: 3, players: 3 },
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
  // A big pot does not make three votes worth 220 credits: 40 a vote at most.
  const capped = Object.fromEntries(splitPool(450, [{ userId: "x", votes: 3, players: 0 }, { userId: "y", votes: 9, players: 0 }]).map((payout) => [payout.userId, payout]));
  assert.equal(capped.x.amount, 3 * JAM.placePerVote);
  assert.equal(capped.y.amount, Math.min(Math.floor(450 * 0.3), 9 * JAM.placePerVote));
  // Someone who took a place lately sits this one's places out; the next entry moves up, and their showcase reward stays.
  const rested = Object.fromEntries(splitPool(100, [{ userId: "a", votes: 9, players: 4, resting: true }, { userId: "b", votes: 3, players: 0 }]).map((payout) => [payout.userId, payout]));
  assert.equal(rested.a.why, "showcase");
  assert.equal(rested.a.place, null);
  assert.equal(rested.b.place, 1);
});

test("the community budget grows with the members seen this week, and plays and stars keep their own amounts", async () => {
  const clock = { at: mondayMorning() };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  for (const token of ["tok-alice", "tok-bob", "tok-cara", "tok-newbie"]) await as(token, "GET", "/v1/me");
  const events = await as("tok-alice", "GET", "/v1/events");
  // The new member (two hours in the server) signed in too, and does not count: second accounts cannot grow the pot.
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

test("the Build Jam: enter until Saturday, vote only for what you played, hidden votes, prizes a day after voting closes", async () => {
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
  for (const token of ["tok-alice", "tok-cara", "tok-mod"]) {
    await playFor(as, clock, token, bob);
    await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: BOB.id });
  }
  // A new member plays but cannot vote (a week in the server first).
  await playFor(as, clock, "tok-newbie", alice);
  assert.equal((await as("tok-newbie", "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).reason, "standing");

  const running = await as("tok-cara", "GET", "/v1/events");
  assert.ok(running.jam.entries.every((entry) => entry.votes === undefined), "votes stay hidden while the jam runs");
  assert.deepEqual(running.jam.entries.map((entry) => [entry.user.id, entry.players, entry.voted, entry.played]), [[ALICE.id, 3, true, true], [BOB.id, 3, true, true]]);
  assert.equal(running.jam.you.votesLeft, JAM.votesPerMember - 2);

  // Saturday: no more entries, voting goes on.
  clock.at = jamWindow(weekOf(clock.at)).entriesUntil + HOUR;
  assert.equal((await as("tok-cara", "POST", `/v1/events/${jamId}/entry`, { projectId: alice })).reason, "entries-closed");
  assert.equal((await as("tok-alice", "GET", "/v1/events")).jam.phase, "voting");

  const before = Object.fromEntries(await Promise.all(["tok-alice", "tok-bob"].map(async (token) => [token, (await as(token, "GET", "/v1/me")).credits.balance])));
  // Next Monday: voting closes, and the results wait a day for a moderator's look.
  const ends = jamWindow(weekOf(clock.at)).endsAt;
  clock.at = ends + MINUTE;
  await relay.runAlarm();
  const waiting = await as("tok-alice", "GET", "/v1/events");
  assert.notEqual(waiting.jam.id, jamId, "next week's jam is open");
  assert.equal(waiting.jam.resultsAt, waiting.jam.endsAt + JAM.reviewMs, "and says when its own results come");
  assert.deepEqual([waiting.lastJam, waiting.reviewing], [null, { id: jamId, theme: listed.jam.theme, resultsAt: ends + JAM.reviewMs }]);
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, before["tok-alice"], "nothing is paid during the review");
  // Tuesday: the alarm pays the results.
  clock.at = ends + JAM.reviewMs + MINUTE;
  await relay.runAlarm();
  const after = await as("tok-alice", "GET", "/v1/events");
  assert.equal(after.reviewing, null);
  assert.equal(after.lastJam.id, jamId);
  const results = Object.fromEntries(after.lastJam.results.map((payout) => [payout.userId, payout]));
  const pool = after.lastJam.pool;
  assert.ok(pool >= ECONOMY.jamPoolMin && pool <= ECONOMY.jamPoolMax, `pool ${pool}`);
  assert.equal(results[ALICE.id].place, 1);
  assert.equal(results[BOB.id].place, 2, "three votes is enough for a place");
  // Both were played by three: a showcase reward each, then the places from the rest, 40 credits a vote at most.
  const showcase = Math.min(JAM.showcaseAmount, Math.floor((pool * JAM.showcaseShareMax) / 2));
  const rest = pool - 2 * showcase;
  assert.equal(results[ALICE.id].amount, showcase + Math.min(Math.floor(rest * 0.5), 3 * JAM.placePerVote), "Alice: a showcase reward and first place");
  assert.equal(results[BOB.id].amount, showcase + Math.min(Math.floor(rest * 0.3), 3 * JAM.placePerVote));
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance - before["tok-alice"], results[ALICE.id].paid);
  assert.equal(results[ALICE.id].paid, results[ALICE.id].amount, "a prize is outside the daily cap");
  assert.equal((await as("tok-bob", "GET", "/v1/me")).credits.balance - before["tok-bob"], results[BOB.id].amount);
  // Running the alarm again pays nothing twice.
  await relay.runAlarm();
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance - before["tok-alice"], results[ALICE.id].amount);
  // A prize place rests for two jams: next week's places go to someone else.
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
  assert.deepEqual({ ...room }, { kind: "cowork", listed: 0, owner_id: null }, "not in the room list, where a request to join would go to nobody");

  for (const token of ["tok-alice", "tok-bob", "tok-cara"]) assert.equal((await as(token, "POST", `/v1/events/${eventId}/join`)).status, 200, token);
  assert.equal((await as("tok-newbie", "POST", `/v1/events/${eventId}/join`)).reason, "new-member", "a day in the server first, so fresh accounts cannot fill the room");
  // Alice keeps the room open, Bob has Studio connected on another page (that counts: a restart mid-hour reconnects by
  // itself), the new member is connected but not in the room, and Cara joined but never connected.
  const sockets = [await present(relay, "tok-alice", roomId), await present(relay, "tok-bob"), await present(relay, "tok-newbie")];
  const before = Object.fromEntries(await Promise.all(["tok-alice", "tok-bob", "tok-cara", "tok-newbie"].map(async (token) => [token, (await as(token, "GET", "/v1/me")).credits.balance])));
  for (const offset of [...COWORK.checksAt, COWORK.lengthMs]) {
    clock.at = start + offset;
    for (const socket of sockets) await socket.renew();
    await relay.runAlarm();
  }
  const done = relay.sql("SELECT status, checks_done, results FROM events WHERE id = ?", eventId)[0];
  assert.equal(done.status, "closed");
  assert.equal(done.checks_done, 3);
  assert.equal(JSON.parse(done.results).attended, 2, "two were seen at two checks or more");
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

test("the alarm never wakes the relay every second, and a paused relay makes and pays nothing", async () => {
  const day = Math.floor(mondayMorning() / DAY);
  const start = day * DAY + 10 * HOUR;
  const clock = { at: start - 5 * MINUTE };
  const relay = makeRelay({ now: () => clock.at });
  const as = api(relay);
  await as("tok-alice", "GET", "/v1/events");
  await relay.runAlarm();
  assert.ok(relay.alarmAt() >= clock.at + MINUTE - 1, `inside the hour's opening minutes the next alarm is a minute away, not a second (${relay.alarmAt() - clock.at} ms)`);
  clock.at = start + 15 * MINUTE + 1;
  await relay.runAlarm();
  assert.ok(relay.alarmAt() > clock.at + 1000, "after a look, the next alarm is the next look");
  // Paused: GET /v1/events reads, and makes no jam and no co-work room.
  const pausedClock = { at: start + 5 * MINUTE };
  const paused = makeRelay({ now: () => pausedClock.at, env: { PAUSED: "true" } });
  const read = await api(paused)("tok-alice", "GET", "/v1/events");
  assert.equal(read.status, 200);
  assert.equal(read.jam, null);
  assert.equal(read.cowork, null);
  await paused.runAlarm();
  assert.equal(paused.sql("SELECT COUNT(*) AS n FROM events")[0].n, 0);
  assert.equal(paused.sql("SELECT COUNT(*) AS n FROM rooms WHERE owner_id IS NULL AND id <> 'lobby'")[0].n, 0);
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
  relay.sql("INSERT INTO together_ticks (day, user_id, ticks, partner_id, last_at) VALUES (?, ?, 1, ?, ?)", Math.floor(clock.at / DAY), MOD.id, CARA.id, clock.at);
  relay.sql("INSERT INTO events (id, kind, title, theme, starts_at, ends_at, status, pool, results) VALUES ('jam_w1', 'jam', 'Build Jam: Old', 'Old', 0, 1, 'closed', 60, ?)",
    JSON.stringify({ votes: { [CARA.id]: 3 }, payouts: [{ userId: CARA.id, name: "Cara", place: 1, amount: 30, paid: 30, projectId: "proj_old", why: "place" }] }));
  assert.equal((await as("tok-cara", "POST", "/v1/me/forget")).status, 200);
  const kept = relay.sql("SELECT results FROM events WHERE id = 'jam_w1'")[0].results;
  assert.ok(!kept.includes(CARA.id) && !kept.includes("Cara"), `no id or name left in the results: ${kept}`);
  assert.match(kept, /a former member/);
  assert.equal(relay.sql("SELECT partner_id FROM together_ticks WHERE user_id = ?", MOD.id)[0].partner_id, null, "nobody else's ticks name them");
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM event_entries WHERE user_id = ?", CARA.id)[0].n, 0);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM together_ticks WHERE user_id = ?", CARA.id)[0].n, 0);
  assert.ok(NEWBIE.id && BOB.id);
});

// Discord ids made `daysAgo` days ago (a snowflake carries its own time), and a join date that many days back.
const idFrom = (daysAgo, n = 1) => (((BigInt(Date.now() - daysAgo * DAY) - 1_420_070_400_000n) << 22n) + BigInt(n)).toString();
const joined = (daysAgo, hours = 0) => ({ joined_at: new Date(Date.now() - daysAgo * DAY + hours * HOUR).toISOString() });
const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFGH";

test("a jam's votes from one batch of accounts count once, so three of them cannot buy a place; moderators see every vote, take a voter out and pay", async () => {
  const clock = { at: mondayMorning() };
  const calls = [];
  // Three accounts made a day apart that joined the server two hours apart: most likely one person's.
  const batch = [0, 1, 2].map((n) => ({ token: `tok-x${n}`, user: { id: idFrom(400 - n, n + 1), username: `x${n}`, global_name: `X${n}` }, member: joined(20, 2 * n) }));
  const DAN = { id: "200000000000000021", username: "dan", global_name: "Dan" };
  const EVE = { id: "200000000000000022", username: "eve", global_name: "Eve" };
  const relay = makeRelay({
    now: () => clock.at, fetchCalls: calls, env: { MOD_ALERT_WEBHOOK: WEBHOOK },
    discord: { ...Object.fromEntries(batch.map((one) => [one.token, { user: one.user, member: one.member }])), "tok-dan": { user: DAN }, "tok-eve": { user: EVE } },
  });
  const as = api(relay);
  const jamId = (await as("tok-alice", "GET", "/v1/events")).jam.id;
  const alice = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  const bob = (await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/tiny-farm", title: "Tiny Farm" })).project.id;
  await as("tok-alice", "POST", `/v1/events/${jamId}/entry`, { projectId: alice });
  await as("tok-bob", "POST", `/v1/events/${jamId}/entry`, { projectId: bob });
  for (const token of ["tok-cara", "tok-mod", "tok-dan"]) {
    await playFor(as, clock, token, alice);
    assert.equal((await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id })).status, 200);
  }
  for (const token of [...batch.map((one) => one.token), "tok-eve"]) {
    await playFor(as, clock, token, bob);
    assert.equal((await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: BOB.id })).status, 200, `${token} votes for Bob`);
  }
  assert.equal((await as("tok-bob", "GET", "/v1/admin/jam")).status, 403, "moderators only");
  const look = (await as("tok-mod", "GET", "/v1/admin/jam")).jam;
  assert.deepEqual([look.id, look.status, look.entries.map((entry) => [entry.user.id, entry.votes])], [jamId, "entries", [[ALICE.id, 3], [BOB.id, 2]]], "Bob's four votes count as two");
  const bobVoters = look.entries[1].voters;
  assert.deepEqual(bobVoters.map((voter) => [voter.name, voter.batch, voter.counted, voter.why]), [["X0", "A", true, null], ["X1", "A", false, "same-batch"], ["X2", "A", false, "same-batch"], ["Eve", null, true, null]]);
  assert.ok(bobVoters.every((voter) => Number.isFinite(voter.accountCreatedAt) && Number.isFinite(voter.joinedAt)), "with when each account was made and joined");
  assert.deepEqual(look.payouts.filter((payout) => payout.place).map((payout) => [payout.userId, payout.place]), [[ALICE.id, 1]], "no place for Bob: two votes");

  // A moderator takes Eve's votes out, and she cannot vote in this jam again.
  assert.equal((await as("tok-mod", "DELETE", `/v1/admin/jam/${jamId}/votes/${EVE.id}`)).removed, 1);
  assert.equal((await as("tok-eve", "POST", `/v1/events/${jamId}/votes`, { userId: BOB.id })).reason, "barred");
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM audit WHERE kind = 'event-votes-void' AND target_id = ? AND room_id = ?`, EVE.id, jamId)[0].n, 1);

  // Voting closes: the jam waits a day for a look, and the moderators' channel hears about it, naming nobody.
  const ends = jamWindow(weekOf(clock.at)).endsAt;
  clock.at = ends + MINUTE;
  await relay.runAlarm();
  const line = calls.find((call) => call.webhook)?.webhook;
  assert.ok(line, "a line went to the webhook");
  assert.match(line.content, /voting closed for the Build Jam ".+": 2 entries, 4 votes that count\. 2 votes came from accounts made and joined together/);
  assert.deepEqual(line.allowed_mentions, { parse: [] });
  assert.ok(!line.content.includes(ALICE.id) && !line.content.includes("X0"), "no names, no ids");
  const waiting = (await as("tok-mod", "GET", "/v1/admin/jam")).jam;
  assert.deepEqual([waiting.id, waiting.status, waiting.resultsAt], [jamId, "review", ends + JAM.reviewMs]);
  assert.equal((await as("tok-cara", "POST", `/v1/admin/jam/${jamId}/release`)).status, 403);
  const before = (await as("tok-alice", "GET", "/v1/me")).credits.balance;
  assert.equal((await as("tok-mod", "POST", `/v1/admin/jam/${jamId}/release`)).status, 200);
  await relay.runAlarm();
  const after = await as("tok-alice", "GET", "/v1/events");
  assert.equal(after.lastJam.id, jamId, "paid before its day was out");
  assert.deepEqual(after.lastJam.results.filter((payout) => payout.place).map((payout) => [payout.userId, payout.place]), [[ALICE.id, 1]]);
  assert.ok((await as("tok-alice", "GET", "/v1/me")).credits.balance > before);
  assert.equal((await as("tok-mod", "POST", `/v1/admin/jam/${jamId}/release`)).reason, "closed");
});

test("the jam switch holds a closed jam's prizes past its day of review; back on, they pay", async () => {
  const clock = { at: mondayMorning() };
  const DAN = { id: "200000000000000021", username: "dan", global_name: "Dan" };
  const relay = makeRelay({ now: () => clock.at, discord: { "tok-dan": { user: DAN } } });
  const as = api(relay);
  const jamId = (await as("tok-alice", "GET", "/v1/events")).jam.id;
  const alice = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  await as("tok-alice", "POST", `/v1/events/${jamId}/entry`, { projectId: alice });
  for (const token of ["tok-bob", "tok-cara", "tok-dan"]) await playFor(as, clock, token, alice);
  const before = (await as("tok-alice", "GET", "/v1/me")).credits.balance;
  await as("tok-mod", "POST", "/v1/admin/credits/switches", { key: "jam", on: false });
  const ends = jamWindow(weekOf(clock.at)).endsAt;
  clock.at = ends + MINUTE;
  await relay.runAlarm();
  clock.at = ends + JAM.reviewMs + HOUR;
  await relay.runAlarm();
  const held = await as("tok-alice", "GET", "/v1/events");
  assert.deepEqual([held.lastJam, held.reviewing], [null, { id: jamId, theme: held.reviewing.theme, resultsAt: null }], "past its day, still held, with no time to promise");
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, before);
  assert.equal((await as("tok-mod", "POST", `/v1/admin/jam/${jamId}/release`)).reason, "held");
  assert.equal((await as("tok-mod", "GET", "/v1/admin/jam")).jam.held, true);
  await as("tok-mod", "POST", "/v1/admin/credits/switches", { key: "jam", on: true });
  assert.ok(relay.alarmAt() <= clock.at + MINUTE, "switching it back on wakes the relay soon");
  await relay.runAlarm();
  const paid = await as("tok-alice", "GET", "/v1/events");
  assert.equal(paid.lastJam.id, jamId);
  assert.equal(paid.lastJam.results[0].why, "showcase", "played by three: the showcase reward");
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, before + paid.lastJam.results[0].paid);
});

test("only members in good standing may enter the jam", async () => {
  const clock = { at: mondayMorning() };
  const YOUNG = { id: idFrom(10, 7), username: "young", global_name: "Young" };
  const relay = makeRelay({ now: () => clock.at, discord: { "tok-young": { user: YOUNG } } });
  const as = api(relay);
  const jamId = (await as("tok-young", "GET", "/v1/events")).jam.id;
  const project = (await as("tok-young", "POST", "/v1/projects", { url: "https://young.itch.io/first", title: "First" })).project.id;
  const refused = await as("tok-young", "POST", `/v1/events/${jamId}/entry`, { projectId: project });
  assert.deepEqual([refused.status, refused.reason, refused.hold], [403, "standing", "new-account"]);
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM event_entries")[0].n, 0);
});

test("Studio's client: a moderator's switches and jam review, a forgotten giver taken back, and when a jam's results come", async () => {
  const clock = { at: mondayMorning() };
  const ALT = { id: "200000000000000031", username: "alt", global_name: "Alt" };
  const relay = makeRelay({ now: () => clock.at, discord: { "tok-alt": { user: ALT } } });
  const as = api(relay);
  const mod = member(relay, "tok-mod");
  const alice = member(relay, "tok-alice");
  await connectAll(mod, alice);
  // The switches.
  assert.deepEqual(await mod.client.modSwitches(), { ok: true, off: [] });
  assert.deepEqual(await mod.client.modSwitch("plays", false), { ok: true, off: ["plays"] });
  assert.deepEqual(await mod.client.modSwitch("nope", false), { ok: false, error: "bad-request" });
  assert.equal((await alice.client.modSwitches()).ok, false, "a member gets nothing");
  const project = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  const play = await as("tok-bob", "POST", `/v1/projects/${project}/play`);
  clock.at += 2 * MINUTE + 1;
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${project}/played`, { token: play.token })).why, "paused");
  await mod.client.modSwitch("plays", true);

  // A jam: an entry, three votes, and the moderator's look while it runs.
  const jamId = (await as("tok-alice", "GET", "/v1/events")).jam.id;
  await as("tok-alice", "POST", `/v1/events/${jamId}/entry`, { projectId: project });
  for (const token of ["tok-bob", "tok-cara", "tok-alt"]) {
    await playFor(as, clock, token, project);
    await as(token, "POST", `/v1/events/${jamId}/votes`, { userId: ALICE.id });
  }
  const look = await mod.client.modJam();
  assert.deepEqual([look.ok, look.jam.id, look.jam.status, look.jam.held, look.jam.entries[0].votes, look.jam.entries[0].voters.length], [true, jamId, "entries", false, 3, 3]);
  assert.deepEqual(look.jam.entries[0].voters.map((voter) => [voter.name, voter.counted, voter.why, voter.batch]), [["Bob", true, null, null], ["Cara", true, null, null], ["Alt", true, null, null]]);
  assert.equal(look.jam.entries[0].project.title, "Void Runner");
  assert.deepEqual(await mod.client.modJamVoid(jamId, CARA.id), { ok: true });
  assert.equal((await mod.client.modJam()).jam.entries[0].votes, 2);
  assert.deepEqual(await mod.client.modJamVoid("jam w", CARA.id), { ok: false, error: "bad-request" });

  // Voting closes: the client says when the results come; the moderator pays them now.
  const ends = jamWindow(weekOf(clock.at)).endsAt;
  clock.at = ends + MINUTE;
  await relay.runAlarm();
  // A week on the relay's clock: their sessions ran out and the alarm closed the sockets, so Studio connects again.
  await connectAll(mod, alice);
  const page = await alice.client.events();
  assert.equal(page.ok, true, JSON.stringify(page));
  assert.deepEqual(page.reviewing, { id: jamId, theme: page.reviewing.theme, resultsAt: ends + JAM.reviewMs });
  assert.equal(page.jam.resultsAt, page.jam.endsAt + JAM.reviewMs);
  assert.equal((await mod.client.modJam()).jam.status, "review");
  assert.deepEqual(await mod.client.modJamRelease(jamId), { ok: true });
  await relay.runAlarm();
  assert.equal((await alice.client.events()).lastJam.id, jamId);

  // A giver who used Forget me since: the review gives an id that names nobody, and taking back works with it.
  await as("tok-alt", "POST", "/v1/me/forget");
  const review = await mod.client.modReview(ALICE.id);
  const gone = review.givers.find((giver) => giver.forgotten);
  assert.match(gone?.id ?? "", /^gone:[A-Za-z0-9_-]{16}$/);
  assert.equal(gone.name, "a member who used Forget me");
  const taken = await mod.client.modRevoke(ALICE.id, { from: gone.id });
  assert.deepEqual([taken.ok, taken.revoked], [true, gone.amount]);
  assert.deepEqual(await mod.client.modRevoke(ALICE.id, { from: "gone:x" }), { ok: false, error: "bad-request" });
  for (const one of [mod, alice]) await one.client.disconnect();
});

test("the jam's own rules can be switched off should one misfire: no day of review, and each vote of a batch counted", async () => {
  const clock = { at: mondayMorning() };
  const batch = [0, 1, 2].map((n) => ({ token: `tok-x${n}`, user: { id: idFrom(400 - n, n + 1), username: `x${n}`, global_name: `X${n}` }, member: joined(20, 2 * n) }));
  const relay = makeRelay({ now: () => clock.at, discord: Object.fromEntries(batch.map((one) => [one.token, { user: one.user, member: one.member }])) });
  const as = api(relay);
  for (const key of ["batches", "review"]) assert.equal((await as("tok-mod", "POST", "/v1/admin/credits/switches", { key, on: false })).status, 200);
  const jamId = (await as("tok-bob", "GET", "/v1/events")).jam.id;
  const bob = (await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/tiny-farm", title: "Tiny Farm" })).project.id;
  await as("tok-bob", "POST", `/v1/events/${jamId}/entry`, { projectId: bob });
  for (const one of batch) {
    await playFor(as, clock, one.token, bob);
    await as(one.token, "POST", `/v1/events/${jamId}/votes`, { userId: BOB.id });
  }
  const look = (await as("tok-mod", "GET", "/v1/admin/jam")).jam;
  assert.deepEqual([look.entries[0].votes, look.entries[0].voters.map((voter) => [voter.counted, voter.batch])], [3, [[true, null], [true, null], [true, null]]], "every vote counts, with no batch letters");
  const page = await as("tok-bob", "GET", "/v1/events");
  assert.equal(page.jam.resultsAt, page.jam.endsAt, "no day of review to wait for");
  clock.at = jamWindow(weekOf(clock.at)).endsAt + MINUTE;
  await relay.runAlarm();
  const after = await as("tok-bob", "GET", "/v1/events");
  assert.deepEqual([after.reviewing, after.lastJam?.id, after.lastJam?.results.find((payout) => payout.place)?.userId], [null, jamId, BOB.id], "paid when voting closed");
});
