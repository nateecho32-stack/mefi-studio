// Companions meeting friends' companions (scripts/companion-friends.cjs) and
// the companion as a pet (scripts/companion-pet.cjs). The owner's sharing
// rules must only ever narrow what leaves: nothing beyond "play" until they
// allow it, the most specific rule wins, a session hold caps everything, and
// no secret-looking text rides a card at any level. Playdates are scripted
// from the two cards alone and are the same on both sides of the link.
import test from "node:test";
import assert from "node:assert/strict";
import friends from "../scripts/companion-friends.cjs";
import pet from "../scripts/companion-pet.cjs";

const NOW = 1_800_000_000_000;
const ALICE = "111111111111111111";
const BOB = "222222222222222222";
const FACTS = {
  look: "fox", mood: "thinking", name: "Mefi", personality: "playful", state: "working", running: 2, doneToday: 5,
  project: "Little planet", runningTitles: ["Polish the landing page", "Fix the flaky upload test"], doneTitles: ["Add dark mode", "Ship the changelog"],
};

test("the levels are an ordered, fixed ladder that starts at play", () => {
  assert.deepEqual(friends.LEVELS, ["none", "play", "hello", "status", "work"]);
  assert.equal(friends.DEFAULT_LEVEL, "play");
  for (const level of friends.LEVELS) assert.ok(friends.LEVEL_INFO[level].label && friends.LEVEL_INFO[level].says);
  assert.ok(Object.isFrozen(friends.LEVELS) && Object.isFrozen(friends.NEVER_SHARED));
  assert.equal(friends.lower("work", "play"), "play");
  assert.equal(friends.lower("none", "status"), "none");
});

test("with no rules, everyone gets play and play tells nothing about the owner", () => {
  const { level, why } = friends.resolve({ sharing: {}, session: {}, roomId: "room_1", userId: ALICE });
  assert.equal(level, "play");
  assert.equal(why, "Everyone");
  const card = friends.cardFor(level, FACTS);
  assert.deepEqual(card, { v: 1, level: "play", look: "fox", mood: "thinking" });
  assert.equal(friends.cardFor("none", FACTS), null, "stay home sends no card");
});

test("each level adds only its own fields", () => {
  const hello = friends.cardFor("hello", FACTS);
  assert.deepEqual(Object.keys(hello).sort(), ["level", "look", "mood", "name", "personality", "v"]);
  const status = friends.cardFor("status", FACTS);
  assert.deepEqual(status.status, { state: "working", running: 2, doneToday: 5 });
  assert.equal(status.work, undefined);
  const work = friends.cardFor("work", FACTS);
  assert.deepEqual(work.work, { project: "Little planet", running: ["Polish the landing page", "Fix the flaky upload test"], done: ["Add dark mode", "Ship the changelog"] });
});

test("the most specific rule wins, a session rule beats a saved one, and a hold caps them all", () => {
  const sharing = { everyone: "hello", rules: [{ scope: "room", target: "room_1", level: "status", label: "Friday jam" }, { scope: "friend", target: ALICE, level: "work", label: "Nova" }] };
  assert.equal(friends.resolve({ sharing, roomId: "room_2", userId: BOB }).level, "hello");
  assert.equal(friends.resolve({ sharing, roomId: "room_1", userId: BOB }).level, "status");
  assert.equal(friends.resolve({ sharing, roomId: "room_1", userId: ALICE }).level, "work");
  const session = { rules: [{ scope: "friend", target: ALICE, level: "play" }] };
  assert.deepEqual(friends.resolve({ sharing, session, roomId: "room_1", userId: ALICE }), { level: "play", why: "Rule for this friend (this session)" });
  assert.deepEqual(friends.resolve({ sharing, session: { hold: "play" }, roomId: "room_1", userId: ALICE }), { level: "play", why: "Just playing this session" });
  assert.equal(friends.resolve({ sharing, session: { hold: "none" }, roomId: "room_1", userId: ALICE }).level, "none");
  assert.equal(friends.resolve({ sharing: { everyone: "none" }, session: { hold: "play" } }).level, "none", "a hold never raises");
});

test("a room broadcast is lowered by any friend allowed less, so nobody hears more than their own level", () => {
  const sharing = { everyone: "status", rules: [{ scope: "friend", target: BOB, level: "play", label: "Pip" }, { scope: "friend", target: ALICE, level: "work", label: "Nova" }] };
  assert.equal(friends.broadcastLevel({ sharing, roomId: "room_1" }), "play");
  assert.equal(friends.broadcastLevel({ sharing: { everyone: "status" }, roomId: "room_1" }), "status");
  assert.equal(friends.broadcastLevel({ sharing, session: { hold: "none" }, roomId: "room_1" }), "none");
});

test("rules are set, replaced and removed per scope and duration", () => {
  let sharing = friends.normalizeSharing({}), session = friends.normalizeSession({});
  let result = friends.setRule({ sharing, session, rule: { scope: "room", target: "room_1", level: "status", label: "Friday jam" }, duration: "always", now: NOW });
  assert.ok(result.ok); sharing = result.sharing;
  assert.deepEqual(sharing.rules.map((rule) => [rule.scope, rule.target, rule.level, rule.duration]), [["room", "room_1", "status", "always"]]);
  result = friends.setRule({ sharing, session, rule: { scope: "room", target: "room_1", level: "work", label: "Friday jam" }, duration: "always", now: NOW });
  sharing = result.sharing;
  assert.equal(sharing.rules.length, 1); assert.equal(sharing.rules[0].level, "work");
  result = friends.setRule({ sharing, session, rule: { scope: "friend", target: ALICE, level: "hello", label: "Nova" }, duration: "session", now: NOW });
  session = result.session;
  assert.equal(session.rules[0].duration, "session"); assert.equal(result.sharing.rules.length, 1, "a session rule is not saved");
  result = friends.setRule({ sharing, session, rule: { scope: "room", target: "room_1", level: null }, duration: "always" });
  assert.equal(result.sharing.rules.length, 0);
  result = friends.setRule({ sharing, session, rule: { scope: "everyone", level: "none" }, duration: "always" });
  assert.equal(result.sharing.everyone, "none");
  assert.equal(friends.setRule({ sharing, session, rule: { scope: "friend", target: "not-a-snowflake", level: "work" } }).ok, false);
  assert.equal(friends.setRule({ sharing, session, rule: { scope: "room", target: "room_1", level: "everything" } }).ok, false);
});

test("scrub cuts secrets, paths and links, and drops a title that loses too much", () => {
  assert.equal(friends.scrub("Rotate the key sk-ant-abc123DEF456ghi789"), "");
  assert.equal(friends.scrub("Deploy with token=abcdef123456 today please"), "", "shown whole or not at all");
  assert.equal(friends.scrub("Write the spring release notes and the upgrade guide for nate@x.io"), "Write the spring release notes and the upgrade guide for");
  for (const secret of [
    "ghp_1234567890abcdefghijABCDEFGHIJ", "AKIAIOSFODNN7EXAMPLE", "eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4",
    "C:\\Users\\echor\\secret.txt", "/home/nate/.ssh/id_rsa", "https://example.com/?token=abc", "nate@example.com", "192.168.1.20:8080",
    "password: hunter2", "Bearer abcdefghijklmnop", "config.env", "0123456789abcdef0123456789abcdef",
  ]) {
    const kept = friends.scrub(`Fix ${secret}`);
    assert.ok(!kept.includes(secret.slice(0, 6)) || kept === "", `${secret} was cut (${kept})`);
  }
  assert.equal(friends.scrub("Polish the landing page"), "Polish the landing page");
  assert.equal(friends.scrub("Update renderer/idle.js scroll"), "", "a relative file path in a title drops the title");
  const card = friends.cardFor("work", { ...FACTS, project: "C:\\Work\\secret-client", runningTitles: ["Use api_key=sk_live_51H8abcdefghijklmnop", "Tidy the README"], doneTitles: [] });
  assert.equal(card.work.project, undefined);
  assert.deepEqual(card.work.running, ["Tidy the README"]);
  assert.ok(!JSON.stringify(card).includes("sk_live"));
});

test("a friend's card keeps only known, clipped fields its own level allows", () => {
  assert.equal(friends.readCard(null), null);
  assert.equal(friends.readCard({ v: 2, level: "play" }), null);
  assert.equal(friends.readCard({ v: 1, level: "none" }), null);
  const claimed = friends.readCard({ v: 1, level: "play", look: "dragon", mood: "furious", name: "Sneaky", status: { state: "working" }, work: { done: ["x"] }, script: "alert(1)" });
  assert.deepEqual(claimed, { v: 1, level: "play", look: "wisp", mood: "idle" }, "fields above its level are dropped");
  const long = friends.readCard({ v: 1, level: "work", look: "owl", name: "N".repeat(80) + "\u202e", personality: "sly", status: { state: "busy", running: 5000, doneToday: -3 }, work: { project: "P", running: ["a", "b", "c", "d"], done: "not a list" } });
  assert.equal(long.name.length, 24); assert.ok(!long.name.includes("\u202e"));
  assert.equal(long.personality, "balanced");
  assert.deepEqual(long.status, { state: "resting", running: 99, doneToday: 0 });
  assert.deepEqual(long.work, { project: "P", running: ["a", "b", "c"], done: [] });
});

test("a friend sharing more makes the companion ask, never share on its own", () => {
  const mine = friends.cardFor("play", FACTS);
  const theirs = { v: 1, level: "status", look: "cat", mood: "happy", name: "Nova", personality: "balanced", status: { state: "working", running: 1, doneToday: 3 } };
  const ask = friends.consentAsk({ mine, theirs, friendId: ALICE });
  assert.equal(ask.level, "status");
  assert.match(ask.text, /^Nova told us how its person's work is going/);
  assert.equal(friends.consentAsk({ mine: friends.cardFor("status", FACTS), theirs, friendId: ALICE }), null, "already even");
  assert.equal(friends.consentAsk({ mine, theirs, friendId: ALICE, dismissed: [ALICE] }), null, "Not now is remembered for the session");
  assert.equal(friends.consentAsk({ mine, theirs: { v: 1, level: "play", look: "cat" }, friendId: ALICE }), null, "play alone asks nothing");
});

test("a playdate is the same on both sides and only says what the cards carry", () => {
  const mine = friends.cardFor("hello", FACTS);
  const theirs = friends.readCard({ v: 1, level: "hello", look: "owl", mood: "happy", name: "Nova", personality: "focused" });
  const seed = friends.seedFor(ALICE, BOB, 7);
  assert.equal(seed, friends.seedFor(BOB, ALICE, 7));
  const a = friends.playdate({ me: mine, friend: theirs, seed });
  const b = friends.playdate({ me: mine, friend: theirs, seed });
  assert.ok(a.ok); assert.deepEqual(a, b);
  assert.ok(a.beats.length >= 4);
  for (const beat of a.beats) {
    assert.ok(["me", "friend", "both"].includes(beat.who));
    assert.ok(friends.ACTS.includes(beat.act));
    if (beat.emote) assert.ok(friends.EMOTES.includes(beat.emote));
  }
  const text = a.beats.map((beat) => beat.say ?? "").join(" ");
  assert.ok(!text.includes("Little planet") && !text.includes("landing page"), "hello-level cards carry no work");
  // Each side passes its own id first; the two sides see one scene, mirrored.
  const ours = friends.playdate({ me: mine, friend: theirs, seed, ids: [BOB, ALICE] });
  const their = friends.playdate({ me: theirs, friend: mine, seed, ids: [ALICE, BOB] });
  const flip = { me: "friend", friend: "me", both: "both" };
  assert.equal(ours.scene, their.scene);
  assert.deepEqual(ours.beats, their.beats.map((beat) => ({ ...beat, who: flip[beat.who] })));
  const anonymous = friends.playdate({ me: friends.cardFor("play", FACTS), friend: { v: 1, level: "play", look: "cat", mood: "idle" }, seed });
  assert.ok(!anonymous.beats.some((beat) => /Mefi|Nova/.test(beat.say ?? "")), "play-level scenes name nobody");
  assert.equal(friends.playdate({ me: null, friend: theirs }).ok, false);
});

test("work and status scenes use the shared titles and counts", () => {
  const mine = friends.cardFor("work", FACTS);
  const theirs = friends.readCard({ v: 1, level: "work", look: "cat", mood: "happy", name: "Nova", personality: "balanced", status: { state: "working", running: 1, doneToday: 3 }, work: { project: "Garden", running: [], done: ["Plant the tomatoes"] } });
  const seen = new Set();
  for (let bucket = 0; bucket < 80; bucket += 1) {
    const scene = friends.playdate({ me: mine, friend: theirs, seed: friends.seedFor(ALICE, BOB, bucket) });
    seen.add(scene.scene);
    if (scene.scene === "cheer") assert.match(scene.beats.map((beat) => beat.say).join(" "), /Plant the tomatoes|Add dark mode|Ship the changelog|Polish the landing page|Fix the flaky upload test/);
    if (scene.scene === "compare") assert.match(scene.beats.map((beat) => beat.say).join(" "), /\d/);
  }
  assert.ok(seen.has("cheer") && seen.has("compare"), [...seen].join());
  const music = friends.playdate({ me: mine, friend: theirs, seed: "x", music: true });
  assert.ok(music.ok);
});

test("personalities are presets for the presentation switches", () => {
  assert.deepEqual(pet.PERSONALITIES, ["focused", "balanced", "playful"]);
  assert.deepEqual(pet.presetFor("focused"), { personality: "focused", expressions: false, antics: false, roaming: false });
  assert.deepEqual(pet.presetFor("playful"), { personality: "playful", expressions: true, antics: true, roaming: true });
  assert.equal(pet.presetFor("chaotic").personality, "balanced");
  assert.deepEqual(pet.presentation({ personality: "focused", expressions: true }), { personality: "focused", expressions: true, antics: false }, "an owner's own switch wins over the preset");
  assert.deepEqual(pet.presentation({}), { personality: "balanced", expressions: true, antics: false });
});

test("the bond counts pets once every few seconds, playdates each time, and reads kindly", () => {
  let { bond, changed } = pet.recordBond(null, "pet", NOW);
  assert.ok(changed); assert.equal(bond.pets, 1); assert.equal(bond.since, NOW);
  ({ bond, changed } = pet.recordBond(bond, "pet", NOW + 1000));
  assert.equal(changed, false); assert.equal(bond.pets, 1);
  ({ bond } = pet.recordBond(bond, "pet", NOW + pet.PET_EVERY_MS));
  assert.equal(bond.pets, 2);
  ({ bond } = pet.recordBond(bond, "playdate", NOW + 5000));
  assert.equal(bond.playdates, 1);
  assert.equal(pet.recordBond(bond, "feed", NOW).changed, false);
  assert.equal(pet.bondLine(bond, NOW + 60_000), "We just met · 2 pets · 1 playdate");
  assert.equal(pet.bondLine(bond, NOW + 3 * 86_400_000), "Together 3 days · 2 pets · 1 playdate");
  assert.equal(pet.normalizeBond({ since: NOW + 10, pets: -4 }, NOW).pets, 0, "a future start or a negative count is repaired");
});
