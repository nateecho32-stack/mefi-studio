import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_LIMITS, limitsFromPlan, aggregateUsage, opencodeWindows, parseOpencodeUsage, describeOpencodeStatus,
  canonicalProvider, providerInfo, normalizeStoreUsage, mergeLedgers,
  parseOpenrouterKey, parseOpenrouterCredits, parseGatewayCredits, parseZaiQuota, describeAccountStatus,
  parseCliJson, parseClaudeCliResult, parseGrokCliResult, parseAntigravityCliResult,
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
  assert.deepEqual(parseOpenrouterCredits({ data: { total_credits: 100.5, total_usage: 25.75 } }), { totalCredits: 100.5, totalUsage: 25.75, remaining: 74.75 });
  assert.throws(() => parseOpenrouterCredits({ data: { total_credits: 1 } }), /no usable totals/);
  assert.deepEqual(parseGatewayCredits({ balance: "95.50", total_used: "4.50" }), { balance: 95.5, totalUsed: 4.5 }, "the REST sample carries strings");
  assert.deepEqual(parseGatewayCredits({ balance: 12, total_used: 0 }), { balance: 12, totalUsed: 0 });
  assert.throws(() => parseGatewayCredits({ total_used: "1" }), /no usable balance/);
  const quota = parseZaiQuota({ data: { level: "pro", limits: [
    { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 40.5, nextResetTime: Date.parse("2026-09-21T15:00:00Z") },
    { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 12, nextResetTime: 0 },
    { type: "TIME_LIMIT", percentage: 3, currentValue: 12 },
  ] } });
  assert.equal(quota.level, "pro");
  assert.deepEqual(quota.rolling, { percent: 40.5, resetsAt: "2026-09-21T15:00:00.000Z" });
  assert.deepEqual(quota.weekly, { percent: 12, resetsAt: null });
  assert.equal(quota.tools.percent, 3);
  assert.equal(parseZaiQuota({ limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 150 }] }).rolling.percent, 100, "a percentage past the cap is clamped");
  assert.throws(() => parseZaiQuota({ data: {} }), /no limits/);
  assert.throws(() => parseZaiQuota({ data: { limits: [{ type: "OTHER" }] } }), /no recognisable window/);
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
