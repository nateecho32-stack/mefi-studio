import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import community from "../scripts/community.cjs";

// scripts/community.cjs decides when the weekly Discord card is due, when a
// linked account is re-checked and what the link unlocks. Every function takes
// `now`, so nothing here reads the clock or waits.

const {
  DAY, GRACE_MS, CHECK_EVERY_MS, FIRST_PROMPT_MS, PROMPT_EVERY_MS, BACKOFF_EVERY_MS, BACKOFF_AFTER,
  GUILD_ID, INVITE_URL, SCOPES, FORK_COPY, AGENT_PROMPT,
  normalize, promptDue, applyPrompt, checkDue, nextCheckAfterFailure, recordCheck, entitlement,
  linkTarget, isAllowedDiscordUrl, pkce, authorizeUrl, publicStatus, signature,
} = community;

const HOUR = DAY / 24;
const T0 = 1_800_000_000_000;
const state = ({ firstSeenAt = T0, lastShownAt = null, snoozeUntil = null, never = false, shown = 0, link = null } = {}) =>
  ({ firstSeenAt, prompt: { lastShownAt, snoozeUntil, never, shown }, link });
const link = (overrides = {}) => ({
  userId: "111", username: "mefi", globalName: "Mefi", roles: ["900"], joinedAt: null,
  linkedAt: T0, checkedAt: T0, lastOkAt: T0, nextCheckAt: T0 + CHECK_EVERY_MS, state: "ok", failures: 0, ...overrides,
});

test("the constants match the shared contract", () => {
  assert.equal(GUILD_ID, "1345380333302059129");
  assert.equal(INVITE_URL, "https://discord.gg/xgfKc5pVxG");
  assert.equal(community.CLIENT_ID, "");
  assert.deepEqual([...community.REDIRECT_PORTS], [53134, 53135, 53136]);
  assert.deepEqual([...SCOPES], ["identify", "guilds.members.read"]);
  assert.equal(community.SELF_UNLOCKED, false, "the shipped app must not unlock itself; forks flip this");
  assert.deepEqual(community.ROLE_PERKS, {});
  assert.deepEqual(community.PERKS, { premium: { label: "Void collection", detail: "4 themes and 3 node styles" } });
  assert.equal(DAY, 86_400_000);
  assert.equal(GRACE_MS, 14 * DAY);
  assert.equal(CHECK_EVERY_MS, 7 * DAY);
  assert.equal(FIRST_PROMPT_MS, 3 * DAY);
  assert.equal(PROMPT_EVERY_MS, 7 * DAY);
  assert.equal(BACKOFF_EVERY_MS, 30 * DAY);
  assert.equal(BACKOFF_AFTER, 4);
  assert.equal(community.CHECK_THROTTLE_MS, 60_000);
  assert.equal(FORK_COPY, "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.");
  assert.equal(AGENT_PROMPT, "In my fork of Mefi's Studio AI+, set SELF_UNLOCKED to true in scripts/community.cjs so the Void collection themes and node styles unlock without Discord, then run npm run check and npm test.");
});

test("normalize tolerates garbage and keeps only the contract's fields", () => {
  const empty = { firstSeenAt: null, prompt: { lastShownAt: null, snoozeUntil: null, never: false, shown: 0 }, link: null };
  for (const raw of [undefined, null, 0, "x", [], [1, 2], true, () => {}, { prompt: "no", link: "no" }, { link: { userId: "" } }]) {
    assert.deepEqual(normalize(raw), empty, `normalize(${JSON.stringify(raw)})`);
  }
  const messy = normalize({
    firstSeenAt: "yesterday", extra: 1,
    prompt: { lastShownAt: -5, snoozeUntil: Number.NaN, never: "yes", shown: 2.5 },
    link: {
      userId: " 42\u0000 ", username: 7, globalName: "", roles: ["1", "1", 2, "", null, "3"], joinedAt: Infinity,
      state: "haunted", failures: -1, accessToken: "abc", refreshToken: "def",
    },
  });
  assert.deepEqual(messy, {
    firstSeenAt: null,
    prompt: { lastShownAt: null, snoozeUntil: null, never: false, shown: 0 },
    link: {
      userId: "42", username: "", globalName: null, roles: ["1", "3"], joinedAt: null, linkedAt: null,
      checkedAt: null, lastOkAt: null, nextCheckAt: null, state: "offline", failures: 0,
    },
  });
  assert.ok(!("accessToken" in messy.link) && !("refreshToken" in messy.link), "a stray token never survives into settings");
  const clean = state({ lastShownAt: T0, shown: 2, link: link() });
  assert.deepEqual(normalize(normalize(clean)), normalize(clean), "normalize is idempotent");
  assert.deepEqual(normalize(clean), clean);
});

test("every exported function takes a garbage options bag, null included, without throwing", () => {
  // A `= {}` default covers undefined only; null used to reach the destructuring.
  const calls = { promptDue, applyPrompt, checkDue, nextCheckAfterFailure, recordCheck, entitlement, authorizeUrl, publicStatus };
  for (const [name, fn] of Object.entries(calls)) {
    for (const bad of [undefined, null, 0, "x", [], true]) {
      assert.doesNotThrow(() => fn(bad), `${name}(${JSON.stringify(bad)})`);
      // nextCheckAfterFailure falls back to the clock, so two calls may be a millisecond apart.
      if (name !== "nextCheckAfterFailure") assert.deepEqual(fn(bad), fn(), `${name}(${JSON.stringify(bad)}) answers like no options at all`);
    }
  }
  assert.equal(promptDue(null), false);
  assert.deepEqual(applyPrompt(null), normalize(null));
  assert.equal(checkDue(null), false);
  assert.equal(recordCheck(null), null);
  assert.deepEqual(entitlement(null), { premium: false, perks: [], validUntil: null, reason: "unlinked" });
  assert.equal(publicStatus(null).linked, false);
  assert.ok(Number.isFinite(nextCheckAfterFailure(null)));
});

test("promptDue: first-run grace, weekly cadence, snooze, back-off, never and entitled", () => {
  const rows = [
    ["never seen yet", state({ firstSeenAt: null }), T0 + 10 * DAY, false, false],
    ["inside the first three days", state(), T0 + FIRST_PROMPT_MS - 1, false, false],
    ["exactly three days in", state(), T0 + FIRST_PROMPT_MS, false, true],
    ["shown six days ago", state({ lastShownAt: T0 + 3 * DAY, shown: 1 }), T0 + 9 * DAY, false, false],
    ["shown a week ago", state({ lastShownAt: T0 + 3 * DAY, shown: 1 }), T0 + 10 * DAY, false, true],
    ["a week but still snoozed", state({ lastShownAt: T0 + 3 * DAY, shown: 1, snoozeUntil: T0 + 12 * DAY }), T0 + 10 * DAY, false, false],
    ["snooze has run out", state({ lastShownAt: T0 + 3 * DAY, shown: 1, snoozeUntil: T0 + 12 * DAY }), T0 + 12 * DAY, false, true],
    ["three ignored showings: still weekly", state({ lastShownAt: T0 + 3 * DAY, shown: BACKOFF_AFTER - 1 }), T0 + 10 * DAY, false, true],
    ["four ignored showings: a week is too soon", state({ lastShownAt: T0 + 3 * DAY, shown: BACKOFF_AFTER }), T0 + 10 * DAY, false, false],
    ["four ignored showings: thirty days", state({ lastShownAt: T0 + 3 * DAY, shown: BACKOFF_AFTER }), T0 + 33 * DAY, false, true],
    ["never", state({ never: true }), T0 + 100 * DAY, false, false],
    ["entitled (boolean)", state(), T0 + 100 * DAY, true, false],
    ["entitled (object)", state(), T0 + 100 * DAY, { premium: true }, false],
    ["an object without premium is not entitled", state(), T0 + 100 * DAY, { premium: false }, true],
  ];
  for (const [name, saved, now, entitled, expected] of rows) {
    assert.equal(promptDue({ state: saved, now, entitled }), expected, name);
  }
  assert.equal(promptDue({ state: state(), now: "later" }), false, "a garbage clock never shows the card");
  assert.equal(promptDue(), false);
  assert.equal(promptDue({ state: null, now: T0 }), false);
});

test("applyPrompt: shown, snooze, never, reset and joined", () => {
  const now = T0 + 10 * DAY;
  const base = state({ lastShownAt: T0 + 3 * DAY, shown: 3, snoozeUntil: T0 + 4 * DAY, never: true, link: link() });
  assert.deepEqual(applyPrompt({ state: base, action: "shown", now }).prompt,
    { lastShownAt: now, snoozeUntil: T0 + 4 * DAY, never: true, shown: 4 });
  assert.deepEqual(applyPrompt({ state: base, action: "snooze", now }).prompt,
    { lastShownAt: T0 + 3 * DAY, snoozeUntil: now + PROMPT_EVERY_MS, never: true, shown: 3 });
  assert.equal(applyPrompt({ state: state(), action: "never", now }).prompt.never, true);
  assert.deepEqual(applyPrompt({ state: base, action: "reset", now }).prompt,
    { lastShownAt: T0 + 3 * DAY, snoozeUntil: null, never: false, shown: 0 });
  assert.deepEqual(applyPrompt({ state: base, action: "joined", now }).prompt,
    { lastShownAt: T0 + 3 * DAY, snoozeUntil: now + DAY, never: true, shown: 0 });
  assert.deepEqual(applyPrompt({ state: base, action: "shown", now }).link, base.link, "the link rides through untouched");

  assert.deepEqual(applyPrompt({ state: base, action: "explode", now }), normalize(base), "an unknown action changes nothing");
  assert.deepEqual(applyPrompt({ state: base, action: "shown", now: null }), normalize(base), "neither does a garbage clock");
  const frozen = Object.freeze({ ...base, prompt: Object.freeze({ ...base.prompt }) });
  assert.doesNotThrow(() => applyPrompt({ state: frozen, action: "shown", now }), "the input is never mutated");
  assert.deepEqual(applyPrompt(), normalize(null));

  // Four ignored showings push the next one to thirty days; joining starts the count over.
  let saved = state();
  for (const day of [3, 10, 17, 24]) saved = applyPrompt({ state: saved, action: "shown", now: T0 + day * DAY });
  assert.equal(promptDue({ state: saved, now: T0 + 31 * DAY }), false);
  assert.equal(promptDue({ state: saved, now: T0 + 54 * DAY }), true);
  saved = applyPrompt({ state: saved, action: "joined", now: T0 + 54 * DAY });
  assert.equal(promptDue({ state: saved, now: T0 + 54 * DAY + DAY - 1 }), false);
});

test("PROMPT_ACTIONS is exported, frozen, and names exactly the actions applyPrompt acts on", () => {
  // main.cjs builds its community:prompt gate from this list.
  const { PROMPT_ACTIONS } = community;
  assert.deepEqual([...PROMPT_ACTIONS], ["shown", "snooze", "never", "reset", "joined"]);
  assert.ok(Object.isFrozen(PROMPT_ACTIONS), "nobody can widen the gate at run time");
  const now = T0 + 10 * DAY;
  const base = state({ lastShownAt: T0 + 3 * DAY, shown: 3, snoozeUntil: T0 + 4 * DAY });
  for (const action of PROMPT_ACTIONS) {
    assert.notDeepEqual(applyPrompt({ state: base, action, now }), normalize(base), `${action} changes the card state`);
  }
  for (const action of ["explode", "Shown", "SNOOZE", "", null, undefined, 1, "__proto__", "toString"]) {
    assert.deepEqual(applyPrompt({ state: base, action, now }), normalize(base), `${String(action)} is not an action`);
  }
});

test("checkDue compares against nextCheckAt, else checkedAt plus a week", () => {
  const rows = [
    ["no link", null, T0 + 100 * DAY, false],
    ["garbage link", { userId: 5 }, T0 + 100 * DAY, false],
    ["before nextCheckAt", link({ nextCheckAt: T0 + HOUR }), T0 + HOUR - 1, false],
    ["at nextCheckAt", link({ nextCheckAt: T0 + HOUR }), T0 + HOUR, true],
    ["no nextCheckAt, checked six days ago", link({ nextCheckAt: null }), T0 + 6 * DAY, false],
    ["no nextCheckAt, checked a week ago", link({ nextCheckAt: null }), T0 + CHECK_EVERY_MS, true],
    ["never checked", link({ nextCheckAt: null, checkedAt: null }), T0, true],
  ];
  for (const [name, saved, now, expected] of rows) assert.equal(checkDue({ link: saved, now }), expected, name);
  assert.equal(checkDue({ link: link(), now: "soon" }), false);
  assert.equal(checkDue(), false);
});

test("nextCheckAfterFailure backs off 1 h, 6 h, then daily, and honours a longer Retry-After", () => {
  const rows = [
    [undefined, undefined, HOUR], [0, undefined, HOUR], [1, undefined, HOUR], [2, undefined, 6 * HOUR],
    [3, undefined, 24 * HOUR], [9, undefined, 24 * HOUR], ["x", undefined, HOUR],
    [1, 5_000, HOUR], [1, 3 * HOUR, 3 * HOUR], [3, 2 * DAY, 2 * DAY],
    [1, 365 * DAY, CHECK_EVERY_MS], [1, Number.NaN, HOUR], [1, "9999999", HOUR],
  ];
  for (const [failures, retryAfterMs, delay] of rows) {
    assert.equal(nextCheckAfterFailure({ failures, now: T0, retryAfterMs }), T0 + delay, `failures ${failures}, retryAfter ${retryAfterMs}`);
  }
  assert.doesNotThrow(() => nextCheckAfterFailure());
});

test("recordCheck folds each kind of answer into the link", () => {
  const now = T0 + 8 * DAY;
  const before = link({ roles: ["900"], failures: 2, state: "offline" });

  const ok = recordCheck({ link: before, now, result: { ok: true, user: { id: "111", username: "mefi2", global_name: "Mefi Two" }, member: { roles: ["901", "902"], joined_at: "2026-01-02T03:04:05.000Z" } } });
  assert.deepEqual(ok, {
    ...before, username: "mefi2", globalName: "Mefi Two", roles: ["901", "902"], joinedAt: Date.parse("2026-01-02T03:04:05.000Z"),
    checkedAt: now, lastOkAt: now, nextCheckAt: now + CHECK_EVERY_MS, state: "ok", failures: 0,
  });

  const gone = recordCheck({ link: before, now, result: { ok: false, error: "not-member" } });
  assert.equal(gone.state, "not-member");
  assert.deepEqual(gone.roles, []);
  assert.equal(gone.lastOkAt, before.lastOkAt, "lastOkAt only moves on a good answer");
  assert.equal(gone.checkedAt, now);

  const auth = recordCheck({ link: before, now, result: { ok: false, error: "auth" } });
  assert.equal(auth.state, "relink");
  assert.deepEqual(auth.roles, ["900"], "roles stay until grace runs out");
  assert.equal(auth.lastOkAt, before.lastOkAt);

  const offline = recordCheck({ link: before, now, result: { ok: false, error: "network" } });
  assert.equal(offline.state, "offline");
  assert.equal(offline.failures, 3);
  assert.equal(offline.nextCheckAt, now + 24 * HOUR, "the third failure waits a day");
  assert.equal(offline.lastOkAt, before.lastOkAt);

  const limited = recordCheck({ link: link(), now, result: { ok: false, error: "rate-limit", retryAfterMs: 2 * HOUR } });
  assert.equal(limited.state, "offline");
  assert.equal(limited.failures, 1);
  assert.equal(limited.nextCheckAt, now + 2 * HOUR, "Retry-After beats the one-hour first step");

  // The first authorize has no link yet: a named user starts one.
  const fresh = recordCheck({ link: null, now, result: { ok: true, user: { id: "222", username: "new" }, member: { roles: ["5"], joined_at: null } } });
  assert.equal(fresh.userId, "222");
  assert.equal(fresh.linkedAt, now);
  assert.equal(fresh.state, "ok");
  const outsider = recordCheck({ link: null, now, result: { ok: false, error: "not-member", user: { id: "333", username: "out" }, tokens: { accessToken: "a", refreshToken: "r" } } });
  assert.equal(outsider.state, "not-member");
  assert.equal(outsider.userId, "333");
  assert.ok(!JSON.stringify(outsider).includes("refreshToken"), "tokens never enter the link");
  const relinked = recordCheck({ link: before, now, result: { ok: true, user: { id: "444", username: "other" }, member: { roles: [] } } });
  assert.equal(relinked.userId, "444");
  assert.equal(relinked.linkedAt, now, "a different account is a new link");

  assert.equal(recordCheck({ link: null, now, result: { ok: false, error: "network" } }), null);
  assert.deepEqual(recordCheck({ link: before, now, result: "garbage" }), before, "a non-object answer changes nothing");
  assert.equal(recordCheck(), null);
});

test("entitlement: self, unlinked, member, grace boundary, not-member, expired, role perks", () => {
  const selfish = entitlement({ link: null, now: T0, selfUnlocked: true });
  assert.deepEqual(selfish, { premium: true, perks: ["premium"], validUntil: null, reason: "self" });
  assert.deepEqual(entitlement({ link: null, now: T0, selfUnlocked: true, rolePerks: { 9: ["halo"] } }).perks, ["premium", "halo"],
    "the fork switch unlocks every perk, role perks included");

  assert.deepEqual(entitlement({ link: null, now: T0 }), { premium: false, perks: [], validUntil: null, reason: "unlinked" });
  assert.deepEqual(entitlement({ link: "junk", now: T0 }).reason, "unlinked");
  assert.deepEqual(entitlement({ link: link(), now: T0 + DAY }), { premium: true, perks: ["premium"], validUntil: T0 + GRACE_MS, reason: "member" });
  assert.equal(entitlement({ link: link({ state: "session" }), now: T0 + DAY }).reason, "member");
  assert.deepEqual(entitlement({ link: link({ state: "offline" }), now: T0 + 10 * DAY }),
    { premium: true, perks: ["premium"], validUntil: T0 + GRACE_MS, reason: "grace" });
  assert.equal(entitlement({ link: link({ state: "relink" }), now: T0 + 10 * DAY }).reason, "grace", "a refused grant keeps perks until grace ends");
  assert.equal(entitlement({ link: link({ state: "offline" }), now: T0 + GRACE_MS - 1 }).premium, true, "one millisecond inside grace");
  assert.deepEqual(entitlement({ link: link({ state: "offline" }), now: T0 + GRACE_MS }),
    { premium: false, perks: [], validUntil: T0 + GRACE_MS, reason: "expired" }, "exactly GRACE_MS is expired");
  assert.equal(entitlement({ link: link(), now: T0 + GRACE_MS }).reason, "expired", "even an ok link must be re-checked within grace");
  assert.deepEqual(entitlement({ link: link({ state: "not-member" }), now: T0 + 1 }),
    { premium: false, perks: [], validUntil: null, reason: "not-member" }, "leaving the server revokes at once");
  assert.equal(entitlement({ link: link({ lastOkAt: null }), now: T0 }).reason, "expired");
  assert.equal(entitlement({ link: link(), now: "now" }).premium, false, "a garbage clock grants nothing");

  const rolePerks = { 900: ["halo", "premium"], 901: ["halo", "aurora"], 902: "not-a-list" };
  assert.deepEqual(entitlement({ link: link({ roles: ["900", "901", "902", "999", "__proto__", "constructor", "toString"] }), now: T0, rolePerks }).perks,
    ["premium", "halo", "aurora"], "role perks merge after premium without duplicates, and inherited keys are not roles");
  assert.deepEqual(entitlement({ link: link({ roles: ["901"] }), now: T0 + GRACE_MS, rolePerks }).perks, [], "no perks once expired");
  assert.deepEqual(entitlement({ link: link({ roles: ["901"] }), now: T0 }).perks, ["premium"], "the shipped ROLE_PERKS is empty");
});

test("linkTarget maps names to hard-coded URLs only", () => {
  assert.equal(linkTarget("invite"), INVITE_URL);
  assert.equal(linkTarget("server"), `https://discord.com/channels/${GUILD_ID}`);
  for (const name of ["https://evil.example", "INVITE", "", null, undefined, 1, {}, "__proto__", "toString"]) {
    assert.equal(linkTarget(name), null, `linkTarget(${String(name)})`);
  }
  assert.ok(isAllowedDiscordUrl(linkTarget("invite")) && isAllowedDiscordUrl(linkTarget("server")));
});

test("isAllowedDiscordUrl: https, exact hosts, no userinfo or ports", () => {
  const allowed = [
    "https://discord.gg/xgfKc5pVxG", "https://discord.com/channels/1", "https://www.discord.com/", "https://discord.com",
    "https://discord.com?x=1", "https://discord.com#top", "HTTPS://Discord.com/x",
  ];
  for (const url of allowed) assert.equal(isAllowedDiscordUrl(url), true, url);
  const refused = [
    "http://discord.gg/xgfKc5pVxG", "https://discord.com.evil.com/", "https://evildiscord.com/", "https://evil.com/discord.com",
    "https://user@discord.com/", "https://user:pw@discord.com/", "https://evil.com@discord.com/", "https://discord.com:8443/",
    "https://discord.com:443/", "https://discord.com./", "https://cdn.discord.com/", "https://discordapp.com/",
    "javascript:alert(1)", "javascript://discord.com/%0aalert(1)", "file:///C:/x", "data:text/html,hi", "//discord.com/x",
    "https://discord%2ecom/", "https://disc\nord.com/", " https://discord.com/", "https://discord.com/\t", "https:\\\\discord.com\\x",
    "", null, undefined, 42, {}, `https://discord.com/${"a".repeat(3000)}`,
  ];
  for (const url of refused) assert.equal(isAllowedDiscordUrl(url), false, JSON.stringify(url));
});

test("pkce makes a 64-character verifier and its S256 challenge", () => {
  const first = pkce();
  assert.match(first.verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.equal(first.challenge, createHash("sha256").update(first.verifier).digest("base64url"));
  assert.match(first.state, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(pkce().verifier, first.verifier);

  const fixed = pkce((size) => Buffer.alloc(size, 7));
  assert.equal(fixed.verifier, Buffer.alloc(48, 7).toString("base64url"));
  assert.equal(fixed.challenge, createHash("sha256").update(fixed.verifier).digest("base64url"));
  assert.equal(fixed.state, Buffer.alloc(24, 7).toString("base64url"));
  for (const broken of [() => { throw new Error("no entropy"); }, () => Buffer.alloc(1), () => "abc", "not a function"]) {
    const made = pkce(broken);
    assert.match(made.verifier, /^[A-Za-z0-9_-]{64}$/, "a broken source falls back to the system one");
  }
});

test("authorizeUrl carries exactly the PKCE authorize parameters", () => {
  const url = new URL(authorizeUrl({ clientId: "123", redirectUri: "http://127.0.0.1:53134/callback", challenge: "abc-_", state: "st" }));
  assert.equal(url.origin + url.pathname, "https://discord.com/oauth2/authorize");
  assert.deepEqual([...url.searchParams.keys()], ["response_type", "client_id", "scope", "redirect_uri", "state", "code_challenge", "code_challenge_method"]);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code", client_id: "123", scope: "identify guilds.members.read", redirect_uri: "http://127.0.0.1:53134/callback",
    state: "st", code_challenge: "abc-_", code_challenge_method: "S256",
  });
  const raw = authorizeUrl({ clientId: "123", redirectUri: "http://127.0.0.1:53134/callback", challenge: "c", state: "s" });
  assert.match(raw, /scope=identify%20guilds\.members\.read/, "spaces are %20, not +");
  assert.match(raw, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A53134%2Fcallback/);
  assert.ok(!/client_secret/.test(raw));
  assert.equal(new URL(authorizeUrl({ clientId: "1", scopes: ["identify"] })).searchParams.get("scope"), "identify");
  assert.doesNotThrow(() => authorizeUrl());
  assert.doesNotThrow(() => authorizeUrl({ clientId: {}, scopes: "x" }));
});

test("publicStatus has the STATUS shape and never carries a token", () => {
  const now = T0 + 5 * DAY;
  const saved = {
    ...state({ link: { ...link(), accessToken: "AT-secret-value", refreshToken: "RT-secret-value", token: "T-secret" } }),
    tokens: { accessToken: "AT-secret-value" }, refreshTokenEncrypted: "RTE-secret",
  };
  const status = publicStatus({ state: saved, now, clientId: "123" });
  assert.deepEqual(Object.keys(status), [
    "available", "configured", "linked", "linking", "selfUnlocked", "user", "roles", "state", "entitlement",
    "checkedAt", "lastOkAt", "nextCheckAt", "prompt", "inviteUrl", "serverUrl", "forkCopy", "agentPrompt",
  ]);
  assert.deepEqual(status, {
    available: true, configured: true, linked: true, linking: false, selfUnlocked: false,
    user: { id: "111", username: "mefi", globalName: "Mefi" }, roles: ["900"], state: "ok",
    entitlement: { premium: true, perks: ["premium"], validUntil: T0 + GRACE_MS, reason: "member" },
    checkedAt: T0, lastOkAt: T0, nextCheckAt: T0 + CHECK_EVERY_MS,
    prompt: { due: false, never: false, snoozeUntil: null },
    inviteUrl: INVITE_URL, serverUrl: `https://discord.com/channels/${GUILD_ID}`, forkCopy: FORK_COPY, agentPrompt: AGENT_PROMPT,
  });
  const json = JSON.stringify(status);
  assert.ok(!/secret/i.test(json), "no token value survives");
  const keys = [];
  JSON.parse(json, (key, value) => { keys.push(key); return value; });
  assert.deepEqual(keys.filter((key) => /token|secret|encrypted/i.test(key)), [], "no token-shaped key survives");

  const unlinked = publicStatus({ state: null, now, clientId: "" });
  assert.equal(unlinked.configured, false);
  assert.equal(unlinked.linked, false);
  assert.equal(unlinked.user, null);
  assert.deepEqual(unlinked.roles, []);
  assert.equal(unlinked.state, null);
  assert.equal(unlinked.entitlement.reason, "unlinked");
  assert.equal(unlinked.prompt.due, false, "no firstSeenAt yet, so no card");
  assert.equal(publicStatus({ state: state(), now: T0 + FIRST_PROMPT_MS }).prompt.due, true);
  assert.equal(publicStatus({ state: state(), now: T0 + FIRST_PROMPT_MS, available: false }).prompt.due, false);
  assert.equal(publicStatus({ state: state(), now: T0 + FIRST_PROMPT_MS, selfUnlocked: true }).prompt.due, false, "self-unlocked is entitled");
  assert.equal(publicStatus({ state: state(), now: T0, linking: true, clientId: " " }).linking, true);
  assert.equal(publicStatus({ state: state(), now: T0, clientId: " " }).configured, false);
  assert.doesNotThrow(() => publicStatus());
});

test("signature moves on visible changes only", () => {
  const now = T0 + DAY;
  const base = publicStatus({ state: state({ link: link() }), now, clientId: "1" });
  assert.equal(signature(base), signature(structuredClone(base)));
  assert.equal(signature(base), signature({ ...base, forkCopy: "other", agentPrompt: "other", inviteUrl: "x" }), "constant copy is not a change");
  for (const change of [
    { linked: false }, { linking: true }, { state: "offline" }, { roles: ["1", "2"] },
    { entitlement: { ...base.entitlement, premium: false } }, { entitlement: { ...base.entitlement, validUntil: 1 } },
    { prompt: { ...base.prompt, due: true } }, { user: { ...base.user, username: "renamed" } }, { nextCheckAt: 5 },
  ]) {
    assert.notEqual(signature({ ...base, ...change }), signature(base), JSON.stringify(change));
  }
  for (const garbage of [undefined, null, 1, "x", [], { roles: [1n] }]) assert.equal(typeof signature(garbage), "string");
  assert.ok(!signature(publicStatus({ state: { link: { ...link(), refreshToken: "RT-x" } }, now })).includes("RT-x"));
});
