import assert from "node:assert/strict";
import test from "node:test";
import { rankFor, specialRanks, projectLink } from "../relay/src/credits.mjs";
import { ALICE, BOB, makeRelay } from "./fixtures/relay-harness.mjs";

// Credits, ranks and the project hub on the relay (relay/src/credits.mjs):
// sharing is free and pays nothing; a play of someone else's project pays
// both the maker and the player, once per play per day under daily caps;
// spent on a day at the top of the hub.

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
  let clock = Date.now();
  const relay = makeRelay({ now: () => clock });
  const as = api(relay);
  const ids = [];
  for (let n = 0; n < 3; n += 1) ids.push((await as("tok-alice", "POST", "/v1/projects", { url: `https://alice.itch.io/game-${n}`, title: `Game ${n}` })).project.id);
  assert.equal((await as("tok-alice", "POST", "/v1/projects", { url: "https://alice.itch.io/game-9", title: "One more" })).reason, "daily-shares");
  assert.equal((await as("tok-newbie", "POST", "/v1/projects", { url: "https://newbie.itch.io/x", title: "X" })).reason, "links-not-allowed");

  // Bob plays all three: Alice earns 5 each, Bob 2 each.
  for (const id of ids) {
    const play = await as("tok-bob", "POST", `/v1/projects/${id}/play`);
    clock += 2 * 60_000 + 1;
    await as("tok-bob", "POST", `/v1/projects/${id}/played`, { token: play.token });
  }
  assert.equal((await as("tok-alice", "GET", "/v1/me")).credits.balance, 15, "3 plays by bob, 5 each; sharing paid nothing");
  // A new member's play is counted but pays nobody.
  const play = await as("tok-newbie", "POST", `/v1/projects/${ids[0]}/play`);
  clock += 2 * 60_000 + 1;
  const newbie = await as("tok-newbie", "POST", `/v1/projects/${ids[0]}/played`, { token: play.token });
  assert.deepEqual(newbie.credited, { owner: 0, you: 0 });
  assert.equal(newbie.counted, true);

  const list = await as("tok-bob", "GET", "/v1/projects?view=top");
  assert.equal(list.projects.length, 3);
  assert.equal(list.projects[0].plays, 2);
});

test("featuring spends 100 credits for a day, one per owner, three at once, with a cooldown", async () => {
  let clock = Date.now();
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
