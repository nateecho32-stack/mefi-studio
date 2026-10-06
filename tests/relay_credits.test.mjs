import assert from "node:assert/strict";
import test from "node:test";
import { GUARD, accountCreatedAt, rankFor, specialRanks, projectLink } from "../relay/src/credits.mjs";
import { ALICE, BOB, CARA, MOD, makeRelay } from "./fixtures/relay-harness.mjs";

// Credits, ranks and the project hub on the relay (relay/src/credits.mjs):
// sharing is free and pays nothing; a play of someone else's project pays
// both the maker and the player under daily caps; spent on a day at the top
// of the hub. Then every way to farm them that we know of, closed.

const DAY = 86_400_000;
// An hour into a UTC day, so a test's few minutes never cross midnight by accident.
const morning = () => Math.floor(Date.now() / DAY) * DAY + 3_600_000;
// A Discord id made `daysAgo` days ago (a snowflake carries its own time).
const idFrom = (daysAgo, n = 1) => (((BigInt(Date.now() - daysAgo * DAY) - 1_420_070_400_000n) << 22n) + BigInt(n)).toString();
const FRESH = { id: idFrom(5), username: "fresh", global_name: "Fresh" };

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

test("ranks follow lifetime credits; special ranks are Discord roles in a fixed order", () => {
  assert.equal(rankFor(0).key, "spark");
  assert.deepEqual(rankFor(49).next, { key: "ember", name: "Ember", at: 50 });
  assert.equal(rankFor(200).key, "flame");
  assert.equal(rankFor(10_000).key, "void");
  assert.equal(rankFor(10_000).next, null);
  assert.deepEqual(specialRanks(["regular", "builder", "nope"], true), ["mod", "builder", "regular"]);
  assert.equal(projectLink("https://bit.ly/abc"), null, "no link shorteners");
  assert.equal(projectLink("http://example.com/game"), null);
  assert.equal(projectLink("https://192.168.0.10/game"), null, "no home-network addresses");
  assert.deepEqual(projectLink("https://nate.itch.io/ruins-runner"), { href: "https://nate.itch.io/ruins-runner", host: "nate.itch.io" });
});

test("sharing pays nothing; a two-minute play pays maker and player; a star pays the maker; never your own", async () => {
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const shared = await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner", blurb: "A tiny platformer", kind: "game" });
  assert.equal(shared.status, 201);
  assert.equal(shared.credited, 0, "sharing is free and pays nothing by itself");
  assert.equal((await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Again" })).reason, "already-shared");
  const projectId = shared.project.id;

  // Alice plays her own: counted for nobody.
  const own = await as("tok-alice", "POST", `/v1/projects/${projectId}/play`);
  clock += 3 * 60_000;
  assert.deepEqual((await as("tok-alice", "POST", `/v1/projects/${projectId}/played`, { token: own.token })).credited, { owner: 0, you: 0 });

  // Bob plays: too soon, then after two minutes it counts for both of them.
  const play = await as("tok-bob", "POST", `/v1/projects/${projectId}/play`);
  assert.equal(play.url, "https://alice.itch.io/void-runner");
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${projectId}/played`, { token: play.token })).reason, "too-soon");
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${projectId}/played`, { token: `${play.token.split(".")[0]}.AAAAAAAAAAAAAAAAAAAAAA` })).reason, "token", "a forged token is refused");
  clock += 2 * 60_000 + 1;
  const finished = await as("tok-bob", "POST", `/v1/projects/${projectId}/played`, { token: play.token });
  assert.deepEqual(finished.credited, { owner: 5, you: 2 });
  assert.equal(finished.counted, true);
  const again = await as("tok-bob", "POST", `/v1/projects/${projectId}/played`, { token: play.token });
  assert.deepEqual(again.credited, { owner: 0, you: 0 }, "the same play the same day pays nothing more");

  assert.equal((await as("tok-alice", "POST", `/v1/projects/${projectId}/star`)).reason, "self");
  await as("tok-bob", "POST", `/v1/projects/${projectId}/star`);
  await as("tok-bob", "DELETE", `/v1/projects/${projectId}/star`);
  const restar = await as("tok-bob", "POST", `/v1/projects/${projectId}/star`);
  assert.equal(restar.project.stars, 1);

  const alice = await as("tok-alice", "GET", "/v1/me");
  assert.deepEqual(alice.credits, { balance: 8, lifetime: 8, today: 8, todayCap: 60 }, "5 played + 3 starred; sharing and the re-star paid nothing");
  assert.equal(alice.rank.key, "spark");
  assert.equal(alice.streak.days, 1);
  const bob = await as("tok-bob", "GET", "/v1/me");
  assert.equal(bob.credits.balance, 2);

  const card = await as("tok-bob", "GET", `/v1/members/${ALICE.id}/card`);
  assert.equal(card.member.name, "Alice");
  assert.equal(card.member.credits, undefined, "a card never shows a balance");
  assert.equal(card.member.projects[0].title, "Void Runner");
});

test("daily caps, new members, and the hub list", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const ids = [];
  for (let n = 0; n < 3; n += 1) ids.push((await as("tok-alice", "POST", "/v1/projects", { url: `https://alice.itch.io/game-${n}`, title: `Game ${n}` })).project.id);
  assert.equal((await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/game-9", title: "One more" })).reason, "daily-shares");
  assert.equal((await as("tok-newbie", "POST", "/v1/projects", { url: "https://newbie.itch.io/x", title: "X" })).reason, "links-not-allowed");

  // Bob plays all three: each counts as a play, but Alice earns 5 once today
  // from Bob, and Bob earns 2 once today from Alice, whichever project it was.
  const paid = [];
  for (const id of ids) {
    const play = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
    clock += 2 * 60_000 + 1;
    const done = await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token });
    paid.push([done.counted, done.credited.owner, done.credited.you]);
  }
  assert.deepEqual(paid, [[true, 5, 2], [true, 0, 0], [true, 0, 0]], "one player is worth one play a day to a maker, not one per project");
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 5);
  // A new member's play pays nobody and does not count toward Top.
  const play = await as("tok-newbie", "POST", `/v1/projects/${ids[0]}/play`);
  clock += 2 * 60_000 + 1;
  const newbie = await as("tok-newbie", "POST", `/v1/projects/${ids[0]}/played`, { token: play.token });
  assert.deepEqual(newbie.credited, { owner: 0, you: 0 });
  assert.equal(newbie.counted, false);
  const me = await as("tok-newbie", "GET", "/v1/me");
  assert.equal(me.canEarn, false);
  assert.equal(me.hold.reason, "new-member");

  const list = await as("tok-bob", "GET", "/v1/projects?view=top");
  assert.equal(list.projects.length, 3);
  assert.deepEqual(list.projects.map((project) => project.plays), [1, 1, 1]);
});

test("young accounts and new members neither give nor earn, and their plays and stars do not count", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock, discord: { "tok-fresh": { user: FRESH } } });
  const as = api(relay);
  assert.ok(Date.now() - accountCreatedAt(FRESH.id) < GUARD.accountAgeMs, "a 5-day-old Discord account");
  const shared = await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" });
  const id = shared.project.id;
  for (const token of ["tok-fresh", "tok-week"]) {
    const play = await as(token, "POST", `/v1/projects/${id}/play`);
    clock += 2 * 60_000 + 1;
    const done = await as(token, "POST", `/v1/projects/${id}/played`, { token: play.token });
    assert.deepEqual([done.counted, done.credited], [false, { owner: 0, you: 0 }], token);
    const starred = await as(token, "POST", `/v1/projects/${id}/star`);
    assert.equal(starred.project.stars, 0, `${token}: a star is kept for them, not counted`);
  }
  assert.equal((await as("tok-fresh", "GET", "/v1/me")).hold.reason, "new-account");
  assert.equal((await as("tok-week", "GET", "/v1/me")).hold.reason, "new-member");
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 0);
  await as("tok-week", "DELETE", `/v1/projects/${id}/star`);
  assert.equal(relay.sql("SELECT stars FROM projects WHERE id = ?", id)[0].stars, 0, "taking back an uncounted star never goes below zero");

  // A maker in bad standing earns nothing, and neither does the player of their project.
  relay.sql("UPDATE members SET suspended_until = ? WHERE user_id = ?", clock + DAY, ALICE.id);
  const play = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
  clock += 2 * 60_000 + 1;
  const done = await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token });
  assert.deepEqual([done.counted, done.credited], [true, { owner: 0, you: 0 }], "a suspended maker's project still counts the play, and pays no one");
});

test("one member can make another earn at most 15 credits a week, and stars pay a maker once a week", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const first = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/one", title: "One" })).project.id;
  const second = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/two", title: "Two" })).project.id;
  const playDay = async () => {
    const play = await as("tok-bob", "POST", `/v1/projects/${first}/play`);
    clock += 2 * 60_000 + 1;
    return (await as("tok-bob", "POST", `/v1/projects/${first}/played`, { token: play.token })).credited.owner;
  };
  const day1 = await playDay();
  const star1 = (await as("tok-bob", "GET", "/v1/me")).credits; // Bob's own side, for later
  await as("tok-bob", "POST", `/v1/projects/${first}/star`);
  await as("tok-bob", "POST", `/v1/projects/${second}/star`);
  await as("tok-bob", "DELETE", `/v1/projects/${first}/star`);
  await as("tok-bob", "POST", `/v1/projects/${first}/star`);
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 8, "a play (5) and one star (3): a second project, unstarring or starring again pays nothing more this week");
  assert.equal(relay.sql("SELECT stars FROM projects WHERE id = ?", first)[0].stars, 1, "the star itself still counts for the project");
  // Remove the project and share the same link again: still no second star pay.
  await as("tok-alice", "DELETE", `/v1/projects/${second}`);
  const again = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/two", title: "Two again" })).project.id;
  await as("tok-bob", "POST", `/v1/projects/${again}/star`);
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 8);

  const days = [day1];
  for (let n = 0; n < 3; n += 1) { clock += DAY; days.push(await playDay()); }
  assert.deepEqual(days, [5, 5, 2, 0], "8 + 5 + 2 = 15 from Bob this week, then nothing");
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.lifetime, 15);
  assert.ok(star1.balance >= 2);
  clock += 4 * DAY + 1;
  assert.equal(await playDay(), 5, "a week on, Bob's plays count again");
});

test("a play token pays for the day it started only, and play starts and stars are rate-limited", async () => {
  let clock = Math.floor(Date.now() / DAY) * DAY + DAY - 5 * 60_000; // five minutes to midnight
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const id = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  const play = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
  clock += 3 * 60_000;
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token })).credited.owner, 5);
  clock += 5 * 60_000; // past midnight, same token
  const twice = await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token });
  assert.deepEqual([twice.counted, twice.credited], [false, { owner: 0, you: 0 }], "the same play cannot count on both sides of midnight");

  let refused = null;
  for (let n = 0; n < GUARD.playStartsPerHour + 2 && !refused; n += 1) {
    const answer = await as("tok-cara", "POST", `/v1/projects/${id}/play`);
    if (answer.status === 429) refused = answer;
  }
  assert.equal(refused?.error, "rate-limited", "starting plays over and over is refused");
  let starRefused = null;
  for (let n = 0; n < GUARD.starsPerHour + 2 && !starRefused; n += 1) {
    const answer = await as("tok-bob", "POST", `/v1/projects/${id}/star`);
    if (answer.status === 429) starRefused = answer;
    else await as("tok-bob", "DELETE", `/v1/projects/${id}/star`);
  }
  assert.equal(starRefused?.error, "rate-limited", "starring over and over is refused too");
});

test("Forget me cannot reset a limit: the account is held for 30 days and what it gave still counts", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const id = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  const playOnce = async () => {
    const play = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
    clock += 2 * 60_000 + 1;
    return as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token });
  };
  assert.equal((await playOnce()).credited.owner, 5);
  await as("tok-bob", "POST", "/v1/me/forget");
  clock += 1000; // a session made in the same millisecond as Forget me is revoked with it
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_events WHERE actor_id = ? OR target_id = ?", BOB.id, BOB.id)[0].n, 0, "nothing names Bob any more");
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM credit_events WHERE actor_id LIKE 'gone:%' AND target_id = ?`, ALICE.id)[0].n, 1, "what Bob gave Alice still counts against her limits, under a fingerprint");
  const back = await playOnce();
  assert.deepEqual(back.credited, { owner: 0, you: 0 }, "signed in again the same day: nothing");
  const me = await as("tok-bob", "GET", "/v1/me");
  assert.equal(me.hold.reason, "forgot-me");
  assert.equal(me.hold.until, relay.sql("SELECT until FROM credit_holds")[0].until);
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 5);
  clock += 31 * DAY;
  relay.sql("UPDATE meta SET value = '0' WHERE key = 'upkeep_at'");
  await relay.runAlarm();
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM credit_holds")[0].n, 0, "the hold goes after 30 days");
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM credit_events WHERE actor_id LIKE 'gone:%'`)[0].n, 0, "and so do the fingerprinted rows, after a week");
  assert.equal((await playOnce()).credited.owner, 5, "after the hold, Bob counts again");
});

test("moderators see where a member's credits came from and take back farmed ones for good", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const id = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  for (const token of ["tok-bob", "tok-cara"]) {
    const play = await as(token, "POST", `/v1/projects/${id}/play`);
    clock += 2 * 60_000 + 1;
    await as(token, "POST", `/v1/projects/${id}/played`, { token: play.token });
  }
  await as("tok-bob", "POST", `/v1/projects/${id}/star`);
  assert.equal((await as("tok-bob", "GET", `/v1/admin/credits/${ALICE.id}`)).status, 403, "moderators only");
  const review = await as("tok-mod", "GET", `/v1/admin/credits/${ALICE.id}`);
  assert.equal(review.total, 13);
  assert.deepEqual(review.givers.map((giver) => [giver.name, giver.amount, giver.share]), [["Bob", 8, 62], ["Cara", 5, 38]]);
  assert.equal(review.member.standing.ok, true);
  assert.equal(review.credits.lifetime, 13);

  const revoked = await as("tok-mod", "POST", `/v1/admin/credits/${ALICE.id}/revoke`, { from: BOB.id });
  assert.equal(revoked.revoked, 8);
  assert.deepEqual([revoked.credits.balance, revoked.credits.lifetime], [5, 5], "off the balance and the lifetime total, so the rank too");
  assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM audit WHERE kind = 'credits-revoke' AND actor_id = ?`, MOD.id)[0].n, 1);
  // The same play cannot pay again.
  const replay = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
  clock += 2 * 60_000 + 1;
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: replay.token })).credited.owner, 0);
  assert.equal((await as("tok-mod", "POST", `/v1/admin/credits/${ALICE.id}/revoke`, { days: 0 })).status, 400);
});

test("moderators get a farming list and project reports; Studio learns who moderates", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  assert.equal((await as("tok-mod", "GET", "/v1/me")).moderator, true);
  assert.equal((await as("tok-bob", "GET", "/v1/me")).moderator, false);
  const mine = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/one", title: "One" })).project.id;
  const his = (await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/two", title: "Two" })).project.id;
  // Alice and Bob trade: each plays and stars the other's project, two days running.
  for (let day = 0; day < 2; day += 1) {
    for (const [token, id] of [["tok-bob", mine], ["tok-alice", his]]) {
      const play = await as(token, "POST", `/v1/projects/${id}/play`);
      clock += 2 * 60_000 + 1;
      await as(token, "POST", `/v1/projects/${id}/played`, { token: play.token });
      if (day === 0) await as(token, "POST", `/v1/projects/${id}/star`);
    }
    clock += DAY;
  }
  // Cara got 40 credits from one account.
  await as("tok-cara", "GET", "/v1/me");
  const helper = "200000000000000077";
  for (let n = 0; n < 8; n += 1) relay.sql("INSERT INTO credit_events (actor_id, target_id, kind, ref, uniq, day, amount, at) VALUES (?, ?, 'played', NULL, ?, 0, 5, ?)", helper, CARA.id, `t${n}`, clock - n * DAY);
  assert.equal((await as("tok-bob", "GET", "/v1/admin/credits/flags")).status, 403, "moderators only");
  const flags = await as("tok-mod", "GET", "/v1/admin/credits/flags");
  const byName = Object.fromEntries(flags.flags.map((flag) => [flag.name, flag]));
  assert.equal(byName.Cara.why, "one-giver");
  assert.equal(byName.Cara.total, 40);
  assert.equal(byName.Cara.top.share, 100);
  assert.equal(byName.Alice.why, "mutual");
  assert.deepEqual(byName.Alice.mutual.map((other) => other.name), ["Bob"]);
  assert.equal(byName.Bob.why, "mutual");

  // Reporting a project: once per member, never your own, with its card for the moderators.
  assert.equal((await as("tok-alice", "POST", `/v1/projects/${mine}/report`, { reason: "mine" })).reason, "self");
  assert.equal((await as("tok-cara", "POST", `/v1/projects/${mine}/report`, { reason: "Spam or a broken link" })).status, 202);
  await as("tok-cara", "POST", `/v1/projects/${mine}/report`, { reason: "again" });
  const reports = await as("tok-mod", "GET", "/v1/admin/reports");
  const report = reports.reports.find((item) => item.kind === "project");
  assert.deepEqual([report.projectId, report.author.id, report.reporter.id, report.reason, report.text], [mine, ALICE.id, CARA.id, "Spam or a broken link", "One · https://alice.itch.io/one"]);
  assert.equal(reports.reports.filter((item) => item.kind === "project").length, 1, "once per member");
  assert.equal((await as("tok-mod", "DELETE", `/v1/projects/${mine}`)).ok, true, "a moderator can take it off");
  assert.equal((await as("tok-mod", "POST", `/v1/admin/reports/${report.id}/resolve`)).ok, true);
});

test("featuring spends 100 credits for a day, one per owner, three at once, with a cooldown", async () => {
  let clock = morning();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const shared = await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" });
  const id = shared.project.id;
  const poor = await as("tok-alice", "POST", `/v1/projects/${id}/feature`);
  assert.equal(poor.reason, "credits");
  relay.sql("INSERT INTO accounts (user_id, balance, lifetime) VALUES (?, 250, 250) ON CONFLICT (user_id) DO UPDATE SET balance = 250", ALICE.id);
  const featured = await as("tok-alice", "POST", `/v1/projects/${id}/feature`);
  assert.equal(featured.balance, 150);
  assert.equal(featured.featuredUntil, clock + 86_400_000);
  assert.equal((await as("tok-alice", "POST", `/v1/projects/${id}/feature`)).reason, "one-featured");
  assert.equal((await as("tok-bob", "POST", `/v1/projects/${id}/feature`)).status, 403, "only the owner features");
  const hub = await as("tok-bob", "GET", "/v1/projects");
  assert.equal(hub.featured[0].id, id);
  clock += 86_400_000 + 1;
  assert.equal((await as("tok-alice", "POST", `/v1/projects/${id}/feature`)).reason, "cooldown");
  assert.equal((await as("tok-bob", "GET", "/v1/projects")).featured.length, 0, "a feature ends after a day");
  // Removing it and sharing the same link again does not skip the week.
  await as("tok-alice", "DELETE", `/v1/projects/${id}`);
  const again = (await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" })).project.id;
  assert.equal((await as("tok-alice", "POST", `/v1/projects/${again}/feature`)).reason, "cooldown", "one feature a week per owner");
  clock += 7 * DAY;
  assert.equal((await as("tok-alice", "POST", `/v1/projects/${again}/feature`)).ok, true);
});

test("forget me removes credits, projects and stars; idle projects leave after 90 days", async () => {
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const shared = await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/void-runner", title: "Void Runner" });
  await as("tok-bob", "POST", "/v1/projects", { url: "https://bob.itch.io/thing", title: "Thing" });
  await as("tok-bob", "POST", `/v1/projects/${shared.project.id}/star`);
  const forgotten = await as("tok-bob", "POST", "/v1/me/forget");
  assert.equal(forgotten.forgotten.projects, 1);
  for (const [table, column] of [["accounts", "user_id"], ["projects", "owner_id"], ["stars", "user_id"], ["credit_events", "target_id"], ["credit_events", "actor_id"]]) {
    assert.equal(relay.sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, BOB.id)[0].n, 0, `${table}.${column}`);
  }
  assert.equal(relay.sql("SELECT stars FROM projects WHERE id = ?", shared.project.id)[0].stars, 0, "bob's star is taken back");

  clock += 91 * 86_400_000;
  relay.sql("UPDATE meta SET value = '0' WHERE key = 'upkeep_at'");
  await relay.runAlarm();
  assert.equal(relay.sql("SELECT COUNT(*) AS n FROM projects")[0].n, 0, "a project nobody played for 90 days leaves the hub");
});
