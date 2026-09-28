import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// Several logins per coding CLI (scripts/cli-accounts.cjs): which logins a
// provider has, the environment each runs under, which one answers, and how a
// topped-out login's reset is read from its own words or its usage reading.
const require = createRequire(import.meta.url);
const accounts = require("../scripts/cli-accounts.cjs");

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 28, 13, 20, 30); // 28 Sep 2026, 13:20:30 UTC
const home = (name) => path.resolve(`/logins/${name}`);

test("the main login comes first and the saved extra logins follow, cleaned", () => {
  const settings = { cliAccounts: [
    { id: "claude-a1b2", provider: "claude", label: "Work", home: home("a") },
    { id: "codex-c3d4", provider: "codex", label: "", home: home("c") },
    { id: "claude-e5f6", provider: "claude", label: "  Side\nproject  ", home: home("e") },
    { id: "claude-bad!", provider: "claude", home: home("x") }, // malformed id
    { id: "codex-9999", provider: "claude", home: home("y") }, // id names another provider
    { id: "claude-main", provider: "claude", home: home("z") }, // the main login's id is reserved
    { id: "claude-7777", provider: "claude", home: "relative/folder" },
    { id: "claude-8888", provider: "claude", home: home("a").toUpperCase() }, // the same folder twice
    { id: "grok-1234", provider: "grok", home: home("g") },
    { id: "claude-a1b2", provider: "claude", home: home("dup") }, // duplicate id
  ] };
  const claude = accounts.accountsFor(settings, "claude");
  assert.deepEqual(claude.map((row) => [row.id, row.label, row.main]), [
    ["claude-main", "Main login", true], ["claude-a1b2", "Work", false], ["claude-e5f6", "Side project", false],
  ]);
  assert.deepEqual(accounts.accountsFor(settings, "codex").map((row) => [row.id, row.label]), [["codex-main", "Main login"], ["codex-c3d4", "Login 2"]]);
  assert.deepEqual(accounts.accountsFor(settings, "grok"), [], "only Claude Code and Codex hold several logins");
  assert.equal(accounts.hasExtra({}, "claude"), false);
  assert.equal(accounts.hasExtra(settings, "claude"), true);
});

test("each provider keeps at most five extra logins", () => {
  const saved = Array.from({ length: 7 }, (_, index) => ({ id: `claude-00${index}0`, provider: "claude", home: home(`n${index}`) }));
  assert.equal(accounts.accountsFor({ cliAccounts: saved }, "claude").length, 1 + accounts.MAX_EXTRA);
  const full = accounts.addAccount(saved, { provider: "claude", id: "claude-ffff", home: home("more") });
  assert.equal(full.ok, false);
  assert.match(full.error, /already has 5 extra logins/);
});

test("a login's environment names its folder; the main login inherits the environment", () => {
  const [main, extra] = accounts.accountsFor({ cliAccounts: [{ id: "claude-a1b2", provider: "claude", home: home("a") }] }, "claude");
  assert.deepEqual(accounts.accountEnv(main), {});
  assert.deepEqual(accounts.accountEnv(extra), { CLAUDE_CONFIG_DIR: home("a") });
  const [, codex] = accounts.accountsFor({ cliAccounts: [{ id: "codex-a1b2", provider: "codex", home: home("c") }] }, "codex");
  assert.deepEqual(accounts.accountEnv(codex), { CODEX_HOME: home("c") });
  assert.deepEqual(accounts.accountEnv(null), {});
  assert.equal(accounts.accountTag(extra), "Claude Code · Login 2");
});

test("adding and removing a login returns the new saved list without the main login", () => {
  const added = accounts.addAccount([], { provider: "claude", id: "claude-a1b2", home: home("a"), label: "Work" });
  assert.equal(added.ok, true);
  assert.deepEqual(added.accounts, [{ id: "claude-a1b2", provider: "claude", label: "Work", home: home("a") }]);
  assert.equal(accounts.addAccount([], { provider: "grok", id: "grok-a1b2", home: home("g") }).ok, false);
  assert.equal(accounts.addAccount(added.accounts, { provider: "claude", id: "claude-c3d4", home: home("a") }).ok, false, "one folder, one login");
  const removed = accounts.removeAccount(added.accounts, "claude-a1b2");
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.accounts, []);
  assert.equal(removed.account.home, home("a"));
  assert.equal(accounts.removeAccount([], "claude-main").ok, false, "the main login is not removable");
});

test("a plan's usage limit is told apart from rate limits and outages", () => {
  for (const line of [
    "Claude AI usage limit reached|1790100000",
    "5-hour limit reached ∙ resets 3pm",
    "You've hit your limit · resets 3pm (Europe/London)",
    "You’ve hit your usage limit. Upgrade to Pro or try again in 4 days 3 hours",
    "ERROR: You've hit your usage limit. Try again later.",
    "claude error: Session limit reached",
    "Opus weekly limit reached ∙ resets Oct 9, 10am",
    "\u001b[91mError: Usage limit reached for this month\u001b[0m",
    "You're out of extra usage · resets 5pm",
  ]) assert.equal(accounts.isUsageLimit(line), true, line);
  for (const line of [
    "Error: Rate limit reached for requests",
    "API Error: 429 Too Many Requests",
    "overloaded_error",
    "Cannot connect to API",
    "npm test failed",
    "",
    null,
  ]) assert.equal(accounts.isUsageLimit(line), false, String(line));
});

test("the reset is read from each shape the CLIs print", () => {
  const at = (...parts) => Date.UTC(...parts);
  assert.equal(accounts.resetFrom("Claude AI usage limit reached|1790100000", 1790000000000), 1790100000000, "epoch seconds");
  assert.equal(accounts.resetFrom("5-hour limit reached ∙ resets 3pm (UTC)", NOW), at(2026, 8, 28, 15, 0));
  assert.equal(accounts.resetFrom("You've hit your limit · resets 11am (UTC)", NOW), at(2026, 8, 29, 11, 0), "a time already past today is tomorrow's");
  assert.equal(accounts.resetFrom("resets 3:30pm (America/New_York)", NOW), at(2026, 8, 28, 19, 30), "in the zone the message names");
  assert.equal(accounts.resetFrom("resets 12am (UTC)", NOW), at(2026, 8, 29, 0, 0));
  assert.equal(accounts.resetFrom("Opus weekly limit reached ∙ resets Oct 3, 2pm (UTC)", NOW), at(2026, 9, 3, 14, 0));
  assert.equal(accounts.resetFrom("Weekly limit reached ∙ resets Sep 30 at 9:15am (UTC)", NOW), at(2026, 8, 30, 9, 15));
  assert.equal(accounts.resetFrom("try again at Sep 29th, 2026 3:05 PM (UTC)", NOW), at(2026, 8, 29, 15, 5));
  assert.equal(accounts.resetFrom("You've hit your usage limit. Upgrade to Pro or try again in 4 days 3 hours", NOW), NOW + (4 * 24 + 3) * HOUR);
  assert.equal(accounts.resetFrom("try again in 45 minutes", NOW), NOW + 45 * MINUTE);
  assert.equal(accounts.resetFrom("Your limit will reset at 2026-09-28 18:00:00 (UTC)", NOW), at(2026, 8, 28, 18, 0));
  assert.equal(accounts.resetFrom("You've hit your usage limit. Try again later.", NOW), null, "no reset named");
  assert.equal(accounts.resetFrom("try again in 30 days", NOW), null, "further than a weekly window is a misreading");
  assert.equal(accounts.resetFrom("Claude AI usage limit reached|1000000000", NOW), null, "a reset in the past");
});

test("a reset with no zone named is read on this machine's clock", () => {
  const local = new Date(NOW);
  const target = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 15, 0).getTime();
  const expected = target > NOW ? target : new Date(local.getFullYear(), local.getMonth(), local.getDate() + 1, 15, 0).getTime();
  assert.equal(accounts.resetFrom("5-hour limit reached ∙ resets 3pm", NOW), expected);
});

test("a usage reading tops a login out only on a full window that covers every model", () => {
  const window = (percent, resetsAt, extra = {}) => ({ percent, resetsAt: new Date(resetsAt).toISOString(), ...extra });
  const full = accounts.readingLimit({ windows: [window(100, NOW + 2 * HOUR), window(64, NOW + 3 * 24 * HOUR)] }, NOW);
  assert.deepEqual(full, { limited: true, until: NOW + 2 * HOUR });
  const both = accounts.readingLimit({ windows: [window(100, NOW + 2 * HOUR), window(100, NOW + 3 * 24 * HOUR)] }, NOW);
  assert.equal(both.until, NOW + 3 * 24 * HOUR, "the login is back only when every full window has reset");
  assert.deepEqual(accounts.readingLimit({ windows: [window(100, NOW + HOUR, { scope: "Opus" }), window(40, NOW + HOUR)] }, NOW), { limited: false, until: null }, "a model-scoped window leaves the rest usable");
  assert.deepEqual(accounts.readingLimit({ windows: [window(100, NOW + HOUR, { reset: true })] }, NOW), { limited: false, until: null });
  assert.deepEqual(accounts.readingLimit({ windows: [], blocked: true }, NOW), { limited: true, until: null }, "spent with no reset named");
  assert.deepEqual(accounts.readingLimit({ available: false, windows: [] }, NOW), { limited: false, until: null });
  assert.deepEqual(accounts.readingLimit(null, NOW), { limited: false, until: null });
});

test("work fills the first login that is not topped out, and every login out names the first reset", () => {
  const logins = accounts.accountsFor({ cliAccounts: [
    { id: "claude-a1b2", provider: "claude", label: "Work", home: home("a") },
    { id: "claude-c3d4", provider: "claude", label: "Side", home: home("c") },
  ] }, "claude");
  assert.equal(accounts.pick(logins, {}, NOW).account.id, "claude-main");
  let marks = accounts.markLimited({}, "claude-main", { now: NOW, until: NOW + 2 * HOUR, reason: "5-hour limit reached" });
  assert.equal(accounts.pick(logins, marks, NOW).account.id, "claude-a1b2");
  marks = accounts.markLimited(marks, "claude-a1b2", { now: NOW, until: NOW + HOUR, reason: "limit" });
  marks = accounts.markLimited(marks, "claude-c3d4", { now: NOW, until: NOW + 3 * HOUR, reason: "limit" });
  const out = accounts.pick(logins, marks, NOW);
  assert.equal(out.account, null);
  assert.equal(out.soonest, NOW + HOUR);
  const later = accounts.pick(logins, marks, NOW + HOUR + 1);
  assert.equal(later.account.id, "claude-a1b2", "a login is back once its reset passes");
  assert.equal(later.soonest, null);
  const rows = accounts.describe(logins, marks, NOW);
  assert.deepEqual(rows.map((row) => [row.id, row.limited, row.until]), [["claude-main", true, NOW + 2 * HOUR], ["claude-a1b2", true, NOW + HOUR], ["claude-c3d4", true, NOW + 3 * HOUR]]);
});

test("a mark with no reset is tried again after half an hour, and marks are held to sane bounds", () => {
  const unknown = accounts.markLimited({}, "claude-main", { now: NOW, reason: "You've hit your usage limit" })["claude-main"];
  assert.equal(unknown.until, NOW + accounts.RECHECK_MS);
  assert.equal(unknown.known, false);
  assert.equal(accounts.markLimited({}, "x", { now: NOW, until: NOW + 1000 }).x.until, NOW + MINUTE, "at least a minute");
  assert.equal(accounts.markLimited({}, "x", { now: NOW, until: NOW + 30 * 24 * HOUR }).x.until, NOW + accounts.MAX_LIMIT_MS);
  assert.equal(accounts.markLimited({}, "x", { now: NOW, until: NOW + HOUR, reason: "a".repeat(400) }).x.reason.length, 200);
  const marks = { a: { until: NOW + HOUR, since: NOW, reason: "r", source: "run", known: true }, b: { until: NOW - 1 }, c: { until: NOW + HOUR }, junk: "x" };
  assert.deepEqual(Object.keys(accounts.pruneMarks(marks, NOW)), ["a", "c"]);
  assert.deepEqual(Object.keys(accounts.pruneMarks(marks, NOW, new Set(["a"]))), ["a"], "a mark for a removed login goes");
  assert.deepEqual(accounts.clearLimit({ a: marks.a }, "a"), {});
});
