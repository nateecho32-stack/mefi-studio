import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_LIMITS, limitsFromPlan, aggregateUsage, opencodeWindows, parseOpencodeUsage, describeOpencodeStatus,
  canonicalProvider, providerInfo, normalizeStoreUsage, mergeLedgers,
  parseOpenrouterKey, parseOpenrouterCredits, parseGatewayCredits, parseZaiQuota, describeAccountStatus,
  parseCliJson, parseClaudeCliResult, parseGrokCliResult, parseAntigravityCliResult, parseCodexCliResult,
  parseClaudeUsage, parseCodexRateLimits, parseCodexRollout, parseGrokBilling, parseAntigravityUsage,
} = require("../scripts/usage-tracker.cjs");

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
const turn = (overrides = {}) => ({
  id: `msg-${Math.random().toString(16).slice(2)}`,
  sessionId: "ses-1",
  directory: "C:/proj",
  agent: "build",
  at: localTime(2026, 9, 20, 10, 0),
  completedAt: localTime(2026, 9, 20, 10, 1),
  provider: "opencode-go",
  model: "deepseek-v4.1-flash",
  cost: 0.0012,
  tokens: { input: 1000, output: 200, reasoning: 50, cacheRead: 4000, cacheWrite: 0, total: 5250 },
  finish: "stop",
  error: null,
  ...overrides,
});

test("plan limits come from the catalog and fall back to the published Go caps", () => {
  assert.deepEqual(limitsFromPlan({ window5hUSD: 12, weekUSD: 30, monthUSD: 60 }), DEFAULT_LIMITS);
  assert.deepEqual(limitsFromPlan({ window5hUSD: 15, weekUSD: 0, monthUSD: -1 }), { rolling: 15, weekly: 30, monthly: 60 });
  assert.deepEqual(limitsFromPlan(null), DEFAULT_LIMITS);
});

test("provider ids from every source resolve to one shared key", () => {
  assert.equal(canonicalProvider("opencode"), "opencode-go", "the Studio assistant's opencode route bills Go");
  assert.equal(canonicalProvider("opencode", "opencode-store"), "opencode-zen", "OpenCode's store writes opencode for Zen sessions");
  assert.equal(canonicalProvider("opencode-go", "opencode-store"), "opencode-go");
  assert.equal(canonicalProvider("mefi-zai", "opencode-store"), "zai", "the Studio-managed provider is the z.ai plan");
  assert.equal(canonicalProvider(" ZAI "), "zai");
  assert.equal(canonicalProvider("vercel"), "gateway");
  assert.equal(canonicalProvider("zen"), "opencode-zen");
  assert.equal(canonicalProvider("anthropic"), "claude");
  assert.equal(canonicalProvider("Somebody New"), "somebody-new", "an unknown id passes through as its own key");
  assert.deepEqual(providerInfo("somebody-new"), { key: "somebody-new", label: "somebody-new", kind: "unknown", account: null });
  assert.equal(providerInfo("zai").kind, "plan");
  assert.equal(providerInfo("openrouter").kind, "metered");
  assert.equal(providerInfo("lmstudio").kind, "local");
  assert.equal(providerInfo(canonicalProvider(undefined)).label, "Unknown provider");
});

test("store turns become ledger records with each account's billing rule applied", () => {
  const rows = normalizeStoreUsage([
    turn({ id: "go" }),
    turn({ id: "plan", provider: "mefi-zai", model: "glm-5.3-flash", cost: 0 }),
    turn({ id: "zen-free", provider: "opencode", model: "nemotron-free", cost: 0 }),
    turn({ id: "aborted", error: "MessageAbortedError", cost: 0, tokens: { input: 0, output: 0, total: 0 }, completedAt: null }),
    turn({ id: "failed", provider: "openrouter", error: "APIError", cost: 0, tokens: { input: 0, output: 0 } }),
    turn({ id: "new", provider: "someone-else", cost: 0 }),
    turn({ id: "no-time", at: null }),
    null,
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["store:go", "store:plan", "store:zen-free", "store:aborted", "store:failed", "store:new"]);
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId["store:go"].provider, "opencode-go");
  assert.equal(byId["store:go"].origin, "opencode-cli");
  assert.equal(byId["store:go"].costUsd, 0.0012);
  assert.equal(byId["store:go"].tokenUsage.totalTokens, 5250);
  assert.equal(byId["store:go"].tokenUsage.cacheReadTokens, 4000);
  assert.equal(byId["store:go"].elapsedMs, 60000);
  assert.equal(byId["store:plan"].provider, "zai");
  assert.equal(byId["store:plan"].costUsd, null, "a plan never prices a call: zero stays unknown, not free");
  assert.equal(byId["store:zen-free"].provider, "opencode-zen");
  assert.equal(byId["store:zen-free"].costUsd, 0, "a metered account's zero is a free model");
  assert.equal(byId["store:aborted"].status, "cancelled");
  assert.equal(byId["store:aborted"].costUsd, 0, "no tokens, no cost, wherever it ran");
  assert.equal(byId["store:failed"].status, "error");
  assert.equal(byId["store:failed"].errorKind, "unknown");
  assert.equal(byId["store:new"].costUsd, null, "an unknown account with tokens and no price stays unknown");
  assert.equal(byId["store:new"].providerId, "someone-else");
});

test("merged ledgers keep their origins apart and never double count", () => {
  const now = localTime(2026, 9, 20, 21, 0);
  const merged = mergeLedgers({
    studio: [observation({ at: localTime(2026, 9, 20, 9, 0) }), observation({ at: localTime(2026, 9, 20, 9, 30), provider: "lmstudio", model: "local", costUsd: null })],
    store: [turn({ id: "a", at: localTime(2026, 9, 20, 10, 0) }), turn({ id: "b", provider: "mefi-zai", at: localTime(2026, 9, 19, 10, 0), cost: 0 })],
  });
  assert.equal(merged.length, 4);
  const report = aggregateUsage(merged, { now });
  assert.equal(report.totals.calls, 4);
  assert.deepEqual(report.totals.origins, { studio: 2, "opencode-cli": 2 });
  assert.equal(report.origins.studio.calls, 2);
  assert.equal(report.origins["opencode-cli"].calls, 2);
  const go = report.providers.find((row) => row.provider === "opencode-go");
  assert.deepEqual(go.providerIds, ["opencode", "opencode-go"], "the assistant route and the store's id meet under one key");
  assert.deepEqual(go.origins, { studio: 1, "opencode-cli": 1 });
  assert.equal(go.label, "OpenCode Go");
  assert.equal(go.usage.costUsd.known, 0.2512);
  assert.equal(go.today.calls, 2);
  const local = report.providers.find((row) => row.provider === "lmstudio");
  assert.equal(local.usage.costUsd.known, 0, "a local server's missing cost is zero, not unknown");
  assert.equal(report.days[0].day, "2026-09-20");
  assert.deepEqual(report.days[0].providers.map((row) => [row.provider, row.calls]), [["opencode-go", 2], ["lmstudio", 1]]);
  assert.equal(report.days[1].providers[0].provider, "zai");
  assert.equal(report.today.calls, 3);
  assert.equal(report.models.find((row) => row.model === "local").label, "LM Studio (local)");
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
  assert.deepEqual(report.providers.map((row) => row.provider), ["opencode-go", "zai"]);
  assert.equal(report.providers[0].calls, 2);
  assert.equal(report.providers[0].models, 2);
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
  assert.equal(report.provider, "opencode-go");
});

test("the Go estimate counts coding turns on Go but neither Zen nor the z.ai plan", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  const hour = 3600000;
  const merged = mergeLedgers({
    studio: [observation({ at: now - hour, costUsd: 3 })],
    store: [
      turn({ id: "go", at: now - hour, cost: 1 }),
      turn({ id: "zen", at: now - hour, provider: "opencode", cost: 5 }),
      turn({ id: "plan", at: now - hour, provider: "mefi-zai", cost: 0 }),
    ],
  });
  const report = opencodeWindows(merged, { now });
  assert.equal(report.rolling.calls, 2);
  assert.equal(report.rolling.spentUsd, 4);
  assert.equal(report.calls, 2);
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

test("the other providers' readings are normalized and refused when unusable", () => {
  const key = parseOpenrouterKey({ data: { label: "sk-or-v1-au7...890", limit: 100, limit_remaining: 74.5, limit_reset: "monthly", usage: 25.5, usage_daily: 1.5, usage_weekly: 10, usage_monthly: 25.5, is_free_tier: false } });
  assert.equal(key.usage, 25.5);
  assert.equal(key.limit, 100);
  assert.equal(key.limitRemaining, 74.5);
  assert.equal(key.percent, 25.5);
  assert.equal(key.usageDaily, 1.5);
  assert.equal(key.isFreeTier, false);
  assert.equal(parseOpenrouterKey({ data: { usage: 3, limit: null } }).percent, null, "no key limit means no percentage");
  assert.throws(() => parseOpenrouterKey({ data: {} }), /no usable usage/);
  assert.throws(() => parseOpenrouterKey({}), /no data/);
  assert.deepEqual(parseOpenrouterCredits({ data: { total_credits: 100.5, total_usage: 25.75 } }), { totalCredits: 100.5, totalUsage: 25.75, remaining: 74.75, balance: 74.75 });
  assert.deepEqual(parseOpenrouterCredits({ data: { total_credits: 5, total_usage: 5.02 } }), { totalCredits: 5, totalUsage: 5.02, remaining: 0, balance: 5 - 5.02 }, "an overdrawn account keeps its sign");
  assert.throws(() => parseOpenrouterCredits({ data: { total_credits: 1 } }), /no usable totals/);
  const free = parseOpenrouterKey({ data: { usage: 0.11, limit: null, is_free_tier: true, is_management_key: false, free_model_daily_requests: { used: 12, limit: 50, remaining: 38 }, byok_usage: 0, expires_at: null } });
  assert.deepEqual(free.freeDaily, { used: 12, limit: 50, remaining: 38 }, "the free-model allowance is read");
  assert.equal(free.isManagementKey, false);
  assert.equal(free.byokUsage, 0);
  assert.equal(parseOpenrouterKey({ data: { usage: 1, free_model_daily_requests: { used: "x" } } }).freeDaily, null, "an unusable allowance is left out");
  assert.deepEqual(parseGatewayCredits({ balance: "95.50", total_used: "4.50" }), { balance: 95.5, totalUsed: 4.5 }, "the REST sample carries strings");
  assert.deepEqual(parseGatewayCredits({ balance: 12, total_used: 0 }), { balance: 12, totalUsed: 0 });
  assert.throws(() => parseGatewayCredits({ total_used: "1" }), /no usable balance/);
  const quota = parseZaiQuota({ data: { level: "pro", limits: [
    { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 40.5, nextResetTime: Date.parse("2026-09-21T15:00:00Z") },
    { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 12, nextResetTime: 0 },
    { type: "TIME_LIMIT", percentage: 3, currentValue: 12 },
  ] } });
  assert.equal(quota.level, "pro");
  assert.equal(quota.plan, "tokens");
  assert.deepEqual(quota.rolling, { percent: 40.5, resetsAt: "2026-09-21T15:00:00.000Z", used: null, limit: null, remaining: null, measure: "tokens", minutes: 300 });
  assert.deepEqual(quota.weekly, { percent: 12, resetsAt: null, used: null, limit: null, remaining: null, measure: "tokens", minutes: 10080 });
  assert.equal(quota.tools.percent, 3);
  assert.equal(quota.tools.measure, "calls");
  assert.equal(parseZaiQuota({ limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 150 }] }).rolling.percent, 100, "a percentage past the cap is clamped");
  assert.throws(() => parseZaiQuota({ data: {} }), /no limits/);
  assert.throws(() => parseZaiQuota({ data: { limits: [{ type: "OTHER" }] } }), /no recognisable window \(types: OTHER\)/, "the refusal names what it saw");
  // z.ai refuses a key with HTTP 200 and an envelope: that is an auth failure, named, not a changed shape
  assert.throws(() => parseZaiQuota({ code: 401, msg: "token expired or incorrect", success: false }), (error) => error.code === "auth" && /z\.ai rejected the saved key \(401\): token expired or incorrect\. Save a current key/.test(error.message));
  assert.throws(() => parseZaiQuota({ code: 1001, msg: "Authentication parameter not received in Header, unable to authenticate", success: false }), (error) => error.code === "auth" && /rejected the saved key \(1001\)/.test(error.message));
  assert.throws(() => parseZaiQuota({ code: 500, msg: "busy", success: false }), (error) => error.code === "http" && /could not be read \(code 500\): busy/.test(error.message));
});

// A live Lite reply after z.ai moved coding plans to credits (2026-07-30),
// verbatim from a public report on 2026-09-21: CREDIT_LIMIT rows only.
const zaiCreditReply = () => ({ code: 200, msg: "Operation successful", success: true, data: { level: "lite", limits: [
  { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 23, remaining: 1976, percentage: 1, nextResetTime: 1790033645897 },
  { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 268, remaining: 9731, percentage: 2, nextResetTime: 1790292019984 },
] } });

test("z.ai's credit plans are read from their counts, and an empty plan list is a state, not a failure", () => {
  const now = 1790020000000;
  const quota = parseZaiQuota(zaiCreditReply(), { now });
  assert.equal(quota.level, "lite");
  assert.equal(quota.plan, "credits");
  assert.equal(quota.empty, false);
  assert.deepEqual(quota.rolling, { percent: 1.2, resetsAt: "2026-09-21T23:34:05.897Z", used: 23, limit: 2000, remaining: 1976, measure: "credits", minutes: 300 }, "the counts beat the server's rounded percentage");
  assert.equal(quota.weekly.percent, 2.7);
  assert.equal(quota.weekly.limit, 10000);
  assert.equal(quota.tools, null, "credit plans charge tools in credits and send no tool row");
  assert.deepEqual(quota.other, []);
  // numbers that arrive as strings are still numbers
  const strings = parseZaiQuota({ data: { limits: [{ type: "CREDIT_LIMIT", unit: "3", number: "5", usage: "2000", currentValue: "402", nextResetTime: String(now + 3600000) }] } }, { now });
  assert.equal(strings.rolling.percent, 20.1);
  assert.equal(strings.rolling.remaining, 1598);
  // a five-hour reset further off than five hours is impossible and dropped
  const far = parseZaiQuota({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 1, nextResetTime: now + 10 * 3600000 }] } }, { now });
  assert.equal(far.rolling.resetsAt, null);
  // a legacy plan: token windows by percentage, the tool quota by its counts
  const legacy = parseZaiQuota({ code: 200, success: true, data: { planName: "Pro", limits: [
    { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 25, nextResetTime: now + 3600000 },
    { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 9, nextResetTime: now + 86400000 },
    { type: "TIME_LIMIT", unit: 5, number: 1, usage: 1000, currentValue: 224, remaining: 776, percentage: 22, usageDetails: [{ modelCode: "search-prime", usage: 210 }] },
  ] } }, { now });
  assert.equal(legacy.level, "pro");
  assert.equal(legacy.plan, "tokens");
  assert.equal(legacy.tools.percent, 22.4);
  assert.equal(legacy.tools.minutes, null, "unit 5 is only a month on the tool row");
  // an unfamiliar window length is kept as another window, not dropped
  const odd = parseZaiQuota({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 1, number: 30, usage: 100, currentValue: 50 }] } }, { now });
  assert.equal(odd.rolling, null);
  assert.equal(odd.other[0].minutes, 43200);
  assert.equal(odd.other[0].percent, 50);
  // a team plan (or a key with no coding plan) lists nothing
  const team = parseZaiQuota({ code: 200, msg: "ok", success: true, data: { limits: [], level: "pro" } }, { now });
  assert.deepEqual(team, { level: "pro", plan: null, empty: true, rolling: null, weekly: null, tools: null, other: [] });
  assert.throws(() => parseZaiQuota({ data: { limits: [{ type: "NEW_LIMIT", unit: 3, number: 5, percentage: 1 }, { type: "OTHER" }] } }, { now }), /no recognisable window \(types: NEW_LIMIT, OTHER\)/);
});

// Claude Code's get_usage body as the installed 2.1.280 answered it on
// 2026-09-22 (limit fields only; the rest of the reply is ignored).
const claudeUsageBody = () => ({
  subscription_type: "max", rate_limits_available: true, session: {}, behaviors: {},
  rate_limits: {
    five_hour: { utilization: 88, resets_at: "2026-09-23T01:10:00.296623+00:00", limit_dollars: null },
    seven_day: { utilization: 24, resets_at: "2026-09-28T11:00:00.296646+00:00" },
    seven_day_opus: null, seven_day_sonnet: null, seven_day_oauth_apps: null, tangelo: { opaque: true },
    model_scoped: [{ display_name: "Fable", utilization: 0, resets_at: "2026-09-28T11:00:00+00:00" }],
    limits: [
      { kind: "session", group: "session", percent: 88, resets_at: "2026-09-23T01:10:00.296623+00:00", severity: "warning", is_active: true },
      { kind: "weekly_all", group: "weekly", percent: 24, resets_at: "2026-09-28T11:00:00.296646+00:00", severity: "normal", is_active: false },
      { kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: "2026-09-28T11:00:00+00:00", severity: "normal", is_active: false, scope: { model: { display_name: "Fable" } } },
    ],
    extra_usage: { is_enabled: false, utilization: null },
  },
});

test("Claude Code's usage reply becomes plan windows classified by kind, never by label", () => {
  const now = Date.parse("2026-09-23T00:00:00Z");
  const limits = parseClaudeUsage(claudeUsageBody(), { now });
  assert.equal(limits.plan, "max");
  assert.equal(limits.available, true);
  assert.equal(limits.blocked, false);
  assert.deepEqual(limits.windows.map((window) => [window.id, window.short, window.label, window.percent, window.severity]), [
    ["5h", "5h", "5-hour session", 88, "warning"],
    ["week", "Wk", "Weekly · all models", 24, "normal"],
    ["week:fable", "Fable", "Weekly · Fable", 0, "normal"],
  ]);
  assert.equal(limits.windows[0].resetsAt, "2026-09-23T01:10:00.296Z");
  assert.equal(limits.windows[2].scope, "Fable");
  // an older reply without limits[] falls back to the named windows
  const body = claudeUsageBody();
  delete body.rate_limits.limits;
  body.rate_limits.seven_day_opus = { utilization: 100, resets_at: "2026-09-28T11:00:00Z" };
  const named = parseClaudeUsage(body, { now });
  assert.deepEqual(named.windows.map((window) => [window.short, window.percent]), [["5h", 88], ["Wk", 24], ["Opus", 100], ["Fable", 0]]);
  assert.equal(named.blocked, true, "a spent window blocks");
  // a past reset reads as reset, not as the stale percentage
  const later = parseClaudeUsage(claudeUsageBody(), { now: Date.parse("2026-09-23T02:00:00Z") });
  assert.equal(later.windows[0].percent, 0);
  assert.equal(later.windows[0].reset, true);
  // an API-key login has no plan windows: a state with a note, not an error
  const keyed = parseClaudeUsage({ subscription_type: null, rate_limits_available: false }, { now });
  assert.equal(keyed.available, false);
  assert.deepEqual(keyed.windows, []);
  assert.match(keyed.note, /not available for this login/);
  assert.throws(() => parseClaudeUsage({ rate_limits_available: true, rate_limits: {} }, { now }), /no plan windows/);
  assert.throws(() => parseClaudeUsage(null), /no usage reply/);
});

// codex app-server's account/rateLimits/read, as 0.154.0 answered it on
// 2026-09-22: a Pro account with only a weekly window, spent.
const codexLive = () => ({
  ordinaryUsageAllowed: false,
  rateLimits: { limitId: "codex", planType: "pro", primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1790437552 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: "0" }, rateLimitReachedType: "rate_limit_reached" },
  rateLimitsByLimitId: { codex: { limitId: "codex", planType: "pro", primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1790437552 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: "0" } } },
  rateLimitResetCredits: null, accountId: "acct", rateLimitUpsell: null,
});
const rolloutLine = (timestamp, rateLimits) => JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: rateLimits } });

test("Codex windows are classified by length from the live read and from session rollouts", () => {
  const now = Date.parse("2026-09-22T20:00:00Z");
  const live = parseCodexRateLimits(codexLive(), { now });
  assert.equal(live.plan, "pro");
  assert.equal(live.blocked, true);
  assert.deepEqual(live.windows.map((window) => [window.id, window.short, window.percent, window.resetsAt]), [["week", "Wk", 100, "2026-09-26T15:45:52.000Z"]], "a lone weekly window in the primary slot is still the weekly window");
  assert.deepEqual(live.credits, { hasCredits: false, unlimited: false, balance: 0 });
  // five hours and a week, the older Plus pattern, sort shortest first
  const both = parseCodexRateLimits({ rateLimits: { primary: { usedPercent: 12.5, windowDurationMins: 10080, resetsAt: 1790437552 }, secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1790040000 } } }, { now });
  assert.deepEqual(both.windows.map((window) => window.short), ["5h", "Wk"]);
  assert.equal(both.blocked, false);
  // a free plan's 30-day window, and an unfamiliar length
  assert.equal(parseCodexRateLimits({ primary: { used_percent: 3, window_minutes: 43200, resets_at: 1791000000 } }, { now }).windows[0].short, "Mo");
  assert.equal(parseCodexRateLimits({ primary: { used_percent: 3, window_minutes: 720 } }, { now }).windows[0].label, "12-hour window");
  // a snapshot taken before its reset: the window has emptied since
  const stale = parseCodexRateLimits({ plan_type: "plus", primary: { used_percent: 100, window_minutes: 10080, resets_at: 1790000000 } }, { now, observedAt: 1789500000000, source: "rollout" });
  assert.equal(stale.windows[0].percent, 0);
  assert.equal(stale.windows[0].reset, true);
  assert.equal(stale.blocked, false);
  assert.equal(stale.source, "rollout");
  assert.equal(stale.asOf, 1789500000000);
  // legacy shapes: resets relative to the event, and the flat pre-2025-09 fields
  const relative = parseCodexRateLimits({ primary: { used_percent: 50, window_minutes: 300, resets_in_seconds: 3600 } }, { now, observedAt: now - 600000 });
  assert.equal(relative.windows[0].resetsAt, new Date(now - 600000 + 3600000).toISOString());
  assert.equal(parseCodexRateLimits({ primary_used_percent: 70, primary_window_minutes: 300 }, { now }).windows[0].percent, 70);
  // no windows at all (an API key, another provider): a note, not a failure
  const none = parseCodexRateLimits({ rateLimits: { limitId: "codex", primary: null, secondary: null } }, { now });
  assert.deepEqual(none.windows, []);
  assert.match(none.note, /no plan windows/);
  assert.throws(() => parseCodexRateLimits(null), /no rate-limit reply/);
});

test("a rollout tail yields its newest main-lane snapshot with a window, never the prompts around it", () => {
  const codex = (percent, minutes = 10080) => ({ limit_id: "codex", limit_name: null, primary: { used_percent: percent, window_minutes: minutes, resets_at: 1790437552 }, secondary: null, credits: null, plan_type: "pro", rate_limit_reached_type: null });
  const chunk = [
    "tial line cut by the tail read {\"token_count\" \"rate_limits\"",
    rolloutLine("2026-09-20T04:00:00.000Z", codex(93)),
    JSON.stringify({ timestamp: "2026-09-20T04:04:00.000Z", type: "response_item", payload: { type: "message", content: "a prompt that mentions token_count and rate_limits" } }),
    rolloutLine("2026-09-20T04:05:21.460Z", codex(100)),
    rolloutLine("2026-09-20T04:05:21.800Z", { limit_id: "premium", primary: null, secondary: null, plan_type: null }),
    rolloutLine("2026-09-20T04:05:22.000Z", { limit_id: "codex", primary: null, secondary: null, plan_type: "pro" }),
    "",
  ].join("\n");
  const found = parseCodexRollout(chunk);
  assert.equal(found.observedAt, Date.parse("2026-09-20T04:05:21.460Z"), "the premium lane and a header-less event are skipped");
  assert.equal(found.snapshot.primary.used_percent, 100);
  assert.equal(found.planType, "pro");
  // ordered by event time, not by position in the file
  const shuffled = [rolloutLine("2026-09-20T05:00:00.000Z", codex(20)), rolloutLine("2026-09-20T04:00:00.000Z", codex(90))].join("\n");
  assert.equal(parseCodexRollout(shuffled, { fromStart: true }).snapshot.primary.used_percent, 20);
  assert.equal(parseCodexRollout(shuffled).snapshot.primary.used_percent, 90, "without fromStart the first line is the cut one and is dropped");
  assert.equal(parseCodexRollout("nothing here\n{\"type\":\"session_meta\"}", { fromStart: true }), null);
});

test("Grok's billing pool and Antigravity's usage groups become plan windows", () => {
  const now = Date.parse("2026-09-22T20:00:00Z");
  // grok 1.0.40's _x.ai/billing on 2026-09-22 (money fields are cents; {} is zero)
  const grok = parseGrokBilling({ config: { creditUsagePercent: 100, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-09-17T23:11:37.803130+00:00", end: "2026-09-24T23:11:37.803130+00:00" }, onDemandCap: {}, onDemandUsed: {}, prepaidBalance: {}, isUnifiedBillingUser: true } }, { now });
  assert.deepEqual(grok.windows.map((window) => [window.id, window.short, window.label, window.percent, window.resetsAt]), [["week", "Wk", "Weekly credits", 100, "2026-09-24T23:11:37.803Z"]]);
  assert.equal(grok.blocked, true);
  assert.deepEqual(grok.credits, { prepaidUsd: 0, onDemandCapUsd: 0, onDemandUsedUsd: 0 });
  const topped = parseGrokBilling({ subscriptionTier: "SuperGrok", config: { creditUsagePercent: 100, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-24T23:11:37Z" }, prepaidBalance: { val: 500 } } }, { now });
  assert.equal(topped.blocked, false, "prepaid credit keeps a full pool usable");
  assert.equal(topped.plan, "SuperGrok");
  assert.equal(topped.credits.prepaidUsd, 5);
  const legacy = parseGrokBilling({ config: { monthlyLimit: { val: 2000 }, used: { val: 500 }, billingPeriodEnd: "2026-10-01T00:00:00Z" } }, { now });
  assert.deepEqual(legacy.windows.map((window) => [window.short, window.percent]), [["Cr", 25]]);
  assert.match(parseGrokBilling({ config: {} }, { now }).note, /no credit usage/);
  assert.throws(() => parseGrokBilling({}), /no config/);
  // agy 1.2.6's /usage in print mode (a third-party capture; agy is not installed here)
  const agy = parseAntigravityUsage(`Checking for updates...\n${JSON.stringify({ status: "SUCCESS", num_turns: 0, command: { name: "usage", data: { groups: [
    { name: "Gemini Models", buckets: [{ id: "gemini-weekly", window: "weekly", remaining_fraction: 0, reset_time: "2026-09-24T00:02:21Z" }] },
    { name: "Claude and GPT models", buckets: [{ id: "3p-weekly", window: "weekly", remaining_fraction: 1, reset_time: "2026-09-29T20:00:00Z" }] },
  ] } } })}`, { now });
  assert.deepEqual(agy.windows.map((window) => [window.id, window.short, window.label, window.percent, window.resetsAt]), [
    ["gemini-weekly", "Gemini", "Gemini Models · weekly", 100, "2026-09-24T00:02:21.000Z"],
    ["3p-weekly", "Claude", "Claude and GPT models · weekly", 0, null],
  ], "a full bucket's reset moves on every read and is not shown");
  assert.equal(agy.blocked, true);
  assert.throws(() => parseAntigravityUsage(JSON.stringify({ status: "ERROR" })), /no usage groups/);
  assert.equal(providerInfo("claude").account, "limits");
  assert.equal(providerInfo("lmstudio").account, "local");
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
  assert.match(describeAccountStatus("OpenRouter", 401), /OpenRouter rejected the saved key/);
  assert.match(describeAccountStatus("Vercel AI Gateway", 403), /refused this key/);
  assert.doesNotMatch(describeAccountStatus("z.ai", 500, JSON.stringify({ message: "bad key abc-123" }), "abc-123"), /abc-123/);
  assert.match(describeAccountStatus("z.ai", 500, JSON.stringify({ message: "bad key abc-123" }), "abc-123"), /redacted/);
});

test("CLI replies yield the text and the tokens, and never an invented cost", () => {
  const claude = parseClaudeCliResult(JSON.stringify({ type: "result", subtype: "success", is_error: false, duration_ms: 1234, num_turns: 1, result: "the answer", session_id: "s",
    total_cost_usd: 0.0123, usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 1, cache_read_input_tokens: 90 },
    modelUsage: { "claude-opus-4-1": { inputTokens: 5, outputTokens: 7, cacheReadInputTokens: 90, cacheCreationInputTokens: 1, costUSD: 0.0123 } } }));
  assert.equal(claude.ok, true);
  assert.equal(claude.text, "the answer");
  assert.equal(claude.model, "claude-opus-4-1");
  assert.deepEqual(claude.tokenUsage, { inputTokens: 5, outputTokens: 7, cacheReadTokens: 90, cacheWriteTokens: 1, reasoningTokens: null, totalTokens: 103 });
  assert.equal(claude.costUsd, null, "a subscription run is not billed per call");
  assert.equal(claude.equivalentUsd, 0.0123);
  assert.equal(claude.elapsedMs, 1234);
  const failed = parseClaudeCliResult(`banner line\n${JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"], usage: { input_tokens: 1, output_tokens: 0 } })}`);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /error_during_execution: boom/);
  assert.equal(failed.tokenUsage.inputTokens, 1, "a failed run still reports what it consumed");
  assert.equal(parseClaudeCliResult("plain text reply"), null, "a text reply is not mistaken for a JSON one");
  assert.equal(parseClaudeCliResult(JSON.stringify({ text: "not a claude result" })), null);

  const grok = parseGrokCliResult(JSON.stringify({ text: "hi", stopReason: "end_turn", usage: { input_tokens: 7210, cache_read_input_tokens: 41000, cache_creation_input_tokens: 0, output_tokens: 1893, reasoning_tokens: 412, total_tokens: 50103 },
    modelUsage: { "grok-4.6": { inputTokens: 7210, outputTokens: 1893, costUSD: 0.01268905 } }, total_cost_usd: 0.01268905 }));
  assert.equal(grok.ok, true);
  assert.equal(grok.model, "grok-4.6");
  assert.equal(grok.tokenUsage.totalTokens, 50103);
  assert.equal(grok.tokenUsage.reasoningTokens, 412);
  assert.equal(grok.costUsd, 0.01268905, "a complete reported cost is a receipt");
  assert.equal(parseGrokCliResult(JSON.stringify({ text: "hi", usage: { input_tokens: 1, output_tokens: 1 }, cost_is_partial: true, total_cost_usd: 0.5 })).costUsd, null, "a partial cost is not a receipt");
  assert.equal(parseGrokCliResult(JSON.stringify({ text: "hi", usage: { input_tokens: 1, output_tokens: 1 } })).costUsd, null, "an absent cost is unreported, never free");
  const grokError = parseGrokCliResult(JSON.stringify({ type: "error", message: "quota exhausted" }));
  assert.equal(grokError.ok, false);
  assert.equal(grokError.error, "quota exhausted");
  assert.equal(parseGrokCliResult("plain"), null);

  const agy = parseAntigravityCliResult(JSON.stringify({ conversation_id: "c", status: "ok", response: "done", error: "", duration_seconds: 2, usage: { input_tokens: 10, output_tokens: 4, thinking_tokens: 3, cache_read_tokens: 6, total_tokens: 23 } }));
  assert.equal(agy.ok, true);
  assert.equal(agy.text, "done");
  assert.deepEqual(agy.tokenUsage, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: null, reasoningTokens: 3, totalTokens: 23 });
  assert.equal(agy.costUsd, null);
  assert.equal(parseAntigravityCliResult(JSON.stringify({ response: "", error: "permission denied" })).ok, false);
  assert.equal(parseAntigravityCliResult("plain"), null);
  assert.deepEqual(parseCliJson("  \n{\"a\":1}\n"), { a: 1 }, "whitespace around the object is ignored");
  assert.deepEqual(parseCliJson("noise before\n{\"a\":1}"), { a: 1 });
  assert.equal(parseCliJson("[1,2]"), null, "an array is not a reply object");
});

test("the Codex CLI event stream yields the agent message and the turn's tokens, never a price", () => {
  const stream = [
    "Reading prompt from stdin...",
    JSON.stringify({ type: "thread.started", thread_id: "t" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { id: "i1", type: "command_execution", command: "ls" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "the answer" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 30 } }),
  ].join("\n");
  const codex = parseCodexCliResult(stream);
  assert.equal(codex.ok, true);
  assert.equal(codex.text, "the answer");
  assert.equal(codex.model, null, "the stream names no model");
  assert.equal(codex.costUsd, null, "a login-billed run reports no price");
  assert.deepEqual(codex.tokenUsage, { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 150 }, "cached tokens sit inside input_tokens, so the total is input + output");
  assert.equal(providerInfo("codex").label, "Codex CLI");
  assert.equal(providerInfo("codex").kind, "subscription");
  const failed = parseCodexCliResult(`${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({ type: "turn.failed", error: { message: "rate limited" } })}`);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "rate limited");
  const silent = parseCodexCliResult(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 0 } }));
  assert.equal(silent.ok, false, "a turn with no agent message is not a reply");
  assert.equal(parseCodexCliResult("plain text reply"), null, "a text reply is not mistaken for the event stream");
  assert.equal(parseCodexCliResult(""), null);
});

// aggregateUsage feeds every bucket in one pass. This is the report written
// the plain way (filter the ledger per bucket, total each one), kept here as
// the reference: sums must match to the last bit and every list must keep its
// order, over ties, future rows, unknown fields and fractional costs.
function referenceReport(observations, { now, days = 14 }) {
  const TOKENS = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"];
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const field = (rows, read) => {
    let known = null, knownRecords = 0;
    for (const row of rows) { const value = num(read(row)); if (value === null) continue; known = (known ?? 0) + value; knownRecords += 1; }
    return { known, knownRecords, unknownRecords: rows.length - knownRecords };
  };
  const totals = (rows) => ({
    calls: rows.length,
    errors: rows.filter((row) => row.status === "error").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    origins: { studio: rows.filter((row) => row.origin !== "opencode-cli").length, "opencode-cli": rows.filter((row) => row.origin === "opencode-cli").length },
    usage: Object.fromEntries([...TOKENS.map((key) => [key, field(rows, (row) => row.tokenUsage?.[key])]), ["costUsd", field(rows, (row) => row.costUsd)]]),
  });
  const group = (rows, key) => { const map = new Map(); for (const row of rows) { const k = key(row); if (!map.has(k)) map.set(k, []); map.get(k).push(row); } return [...map]; };
  const ordered = observations.slice().sort((a, b) => a.at - b.at);
  const midnight = (at) => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const dayKey = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const windows = (rows) => Object.fromEntries([["today", midnight(now)], ["week", now - 7 * 86400000], ["month", now - 30 * 86400000]].map(([name, from]) => [name, totals(rows.filter((row) => row.at >= from && row.at <= now))]));
  const byCalls = (a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider);
  return {
    generatedAt: now,
    days: group(ordered, (row) => dayKey(row.at)).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, days)
      .map(([day, rows]) => ({ day, ...totals(rows), providers: group(rows, (row) => row.provider).map(([provider, entries]) => ({ provider, ...providerInfo(provider), ...totals(entries) })).sort(byCalls) })),
    ...windows(ordered),
    totals: totals(ordered),
    range: { from: ordered[0]?.at ?? null, to: ordered.at(-1)?.at ?? null },
    origins: { studio: totals(ordered.filter((row) => row.origin !== "opencode-cli")), "opencode-cli": totals(ordered.filter((row) => row.origin === "opencode-cli")) },
    providers: group(ordered, (row) => row.provider).map(([provider, rows]) => ({
      provider, ...providerInfo(provider),
      providerIds: [...new Set(rows.map((row) => row.providerId).filter(Boolean))],
      models: new Set(rows.map((row) => row.model).filter(Boolean)).size,
      ...totals(rows), ...windows(rows),
    })).sort(byCalls),
    models: group(ordered, (row) => `${row.provider}::${row.model || "unknown"}`)
      .map(([, rows]) => ({ provider: rows[0].provider, label: providerInfo(rows[0].provider).label, model: rows[0].model || "unknown", ...totals(rows), ...windows(rows) }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
  };
}

test("the one-pass report matches the per-bucket totals to the last bit", () => {
  const now = localTime(2026, 9, 22, 17, 10);
  let seed = 11;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const providers = ["opencode", "zai", "openrouter", "claude", "lmstudio"];
  const studio = Array.from({ length: 600 }, (_, index) => observation({
    at: now - Math.floor(rand() * 40 * 86400000) + (index % 9 === 0 ? 3600000 : 0),
    provider: providers[index % providers.length],
    model: index % 13 === 0 ? "" : `model-${index % 7}`,
    status: index % 17 === 0 ? "error" : index % 23 === 0 ? "cancelled" : "ok",
    costUsd: index % 5 === 0 ? null : rand() * 0.03,
    tokenUsage: { inputTokens: Math.floor(rand() * 9000), outputTokens: index % 4 ? Math.floor(rand() * 900) : null, totalTokens: rand() * 1e4 },
  }));
  const store = Array.from({ length: 600 }, (_, index) => turn({ id: `t${index}`, at: now - (index % 50) * 3600000, provider: providers[(index * 3) % providers.length], cost: index % 3 ? rand() * 0.01 : 0 }));
  const merged = mergeLedgers({ studio, store });
  for (const days of [14, 3, 90]) {
    const report = aggregateUsage(merged, { now, days });
    assert.equal(JSON.stringify(report), JSON.stringify(referenceReport(merged, { now, days })), `days=${days}`);
  }
});
