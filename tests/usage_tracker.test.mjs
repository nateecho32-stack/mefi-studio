import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_LIMITS, limitsFromPlan, aggregateUsage, opencodeWindows, parseOpencodeUsage, describeOpencodeStatus } = require("../scripts/usage-tracker.cjs");

const localTime = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const observation = (overrides = {}) => ({
  id: `obs-${Math.random().toString(16).slice(2)}`,
  at: localTime(2026, 9, 20),
  provider: "opencode",
  model: "deepseek-v4.1-flash",
  taskType: "routine",
  status: "ok",
  tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  costUsd: 0.25,
  ...overrides,
});

test("plan limits come from the catalog and fall back to the published Go caps", () => {
  assert.deepEqual(limitsFromPlan({ window5hUSD: 12, weekUSD: 30, monthUSD: 60 }), DEFAULT_LIMITS);
  assert.deepEqual(limitsFromPlan({ window5hUSD: 15, weekUSD: 0, monthUSD: -1 }), { rolling: 15, weekly: 30, monthly: 60 });
  assert.deepEqual(limitsFromPlan(null), DEFAULT_LIMITS);
});

test("daily buckets use the local calendar and keep unknown values explicit", () => {
  const now = localTime(2026, 9, 20, 21, 0);
  const report = aggregateUsage([
    observation({ at: localTime(2026, 9, 20, 9, 0), costUsd: 0.25 }),
    observation({ at: localTime(2026, 9, 20, 11, 30), costUsd: null, tokenUsage: { inputTokens: 10, outputTokens: null, totalTokens: 10 } }),
    observation({ at: localTime(2026, 9, 19, 23, 50), costUsd: 0.1, status: "error" }),
  ], { now });
  assert.equal(report.days.length, 2);
  assert.equal(report.days[0].day, "2026-09-20");
  assert.equal(report.days[0].calls, 2);
  assert.equal(report.days[0].usage.costUsd.known, 0.25);
  assert.equal(report.days[0].usage.costUsd.unknownRecords, 1);
  assert.equal(report.days[0].usage.outputTokens.known, 50);
  assert.equal(report.days[0].usage.outputTokens.unknownRecords, 1);
  assert.equal(report.days[1].day, "2026-09-19");
  assert.equal(report.days[1].errors, 1);
  assert.equal(report.totals.calls, 3);
  assert.equal(report.totals.usage.costUsd.known, 0.35);
  assert.equal(report.totals.usage.costUsd.unknownRecords, 1);
  assert.equal(report.today.calls, 2);
  assert.equal(report.week.calls, 3);
  assert.equal(report.month.calls, 3);
  assert.deepEqual(report.range.from, localTime(2026, 9, 19, 23, 50));
});

test("provider and model totals stay separate and sorted by volume", () => {
  const report = aggregateUsage([
    observation({ provider: "opencode", model: "a" }),
    observation({ provider: "opencode", model: "b" }),
    observation({ provider: "zai", model: "glm-5.3" }),
  ], { now: localTime(2026, 9, 20) });
  assert.deepEqual(report.providers.map((row) => row.provider), ["opencode", "zai"]);
  assert.equal(report.providers[0].calls, 2);
  assert.equal(report.models.length, 3);
  assert.equal(report.month.calls, 3);
});

test("OpenCode Go windows only count recorded Go calls and keep unknown costs out of the spend", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  const hour = 3600000;
  const report = opencodeWindows([
    observation({ at: now - 2 * hour, costUsd: 3 }),
    observation({ at: now - 6 * hour, costUsd: 2 }),
    observation({ at: now - 2 * hour, costUsd: null }),
    observation({ at: now - 2 * hour, provider: "zai", costUsd: 9 }),
  ], { now });
  assert.equal(report.rolling.spentUsd, 3);
  assert.equal(report.rolling.knownRecords, 1);
  assert.equal(report.rolling.unknownRecords, 1);
  assert.equal(report.rolling.calls, 2);
  assert.equal(report.rolling.percent, 25);
  assert.equal(report.rolling.resetsAt, now - 2 * hour + 5 * hour);
  assert.equal(report.weekly.spentUsd, 5);
  assert.equal(report.monthly.spentUsd, 5);
  assert.equal(report.calls, 3);
});

test("weekly and monthly windows follow the provider's UTC boundaries", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  const report = opencodeWindows([
    observation({ at: Date.parse("2026-09-13T23:00:00Z"), costUsd: 1 }),
    observation({ at: Date.parse("2026-09-14T00:30:00Z"), costUsd: 2 }),
    observation({ at: Date.parse("2026-08-31T10:00:00Z"), costUsd: 4 }),
    observation({ at: Date.parse("2026-09-01T00:00:00Z"), costUsd: 8 }),
  ], { now });
  assert.equal(report.weekly.spentUsd, 2);
  assert.equal(report.weekly.resetsAt, Date.parse("2026-09-21T00:00:00Z"));
  assert.equal(report.monthly.spentUsd, 11, "September records count even when the weekly window excludes them");
  assert.equal(report.monthly.resetsAt, Date.parse("2026-10-01T00:00:00Z"));
});

test("an empty ledger still reports its windows honestly", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  const report = opencodeWindows([], { now });
  assert.equal(report.rolling.spentUsd, null);
  assert.equal(report.rolling.percent, null);
  assert.equal(report.rolling.resetsAt, null);
  assert.equal(report.rolling.unknownRecords, 0);
  assert.equal(report.limits.rolling, 12);
});

test("the account usage reply is normalized and rejected when unusable", () => {
  const parsed = parseOpencodeUsage({ usage: {
    rolling: { status: "ok", percent: 12, resetsAt: "2026-08-22T17:00:00Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "not a date" },
    monthly: { status: "ok", percent: 56 },
  } });
  assert.deepEqual(parsed.rolling, { status: "ok", percent: 12, resetsAt: "2026-08-22T17:00:00Z" });
  assert.equal(parsed.weekly.status, "rate-limited");
  assert.equal(parsed.weekly.resetsAt, null);
  assert.equal(parsed.monthly.resetsAt, null);
  assert.throws(() => parseOpencodeUsage({ usage: { rolling: { percent: 1 }, weekly: { percent: 1 } } }), /monthly window/);
  assert.throws(() => parseOpencodeUsage({ usage: { rolling: { percent: -3 }, weekly: { percent: 1 }, monthly: { percent: 1 } } }), /no usable percent/);
  assert.throws(() => parseOpencodeUsage({}), /no usage windows/);
});

test("status errors explain the account state without echoing a credential or raw body", () => {
  assert.match(describeOpencodeStatus(401, "anything"), /rejected the saved Go key/);
  assert.match(describeOpencodeStatus(403, ""), /no OpenCode Go subscription/);
  assert.match(describeOpencodeStatus(429, ""), /rate-limiting/);
  const message = describeOpencodeStatus(500, JSON.stringify({ error: { message: "upstream\nfailure key sk-secret-123" } }));
  assert.match(message, /upstream failure/);
  assert.doesNotMatch(message, /[\u0000-\u001f]/);
  assert.doesNotMatch(describeOpencodeStatus(500, "echo test-key now", "test-key"), /test-key/);
  assert.ok(describeOpencodeStatus(500, "x".repeat(400)).length <= "OpenCode usage could not be read (HTTP 500): ".length + 160, "long bodies are clipped");
});
