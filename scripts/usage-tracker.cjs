"use strict";

// Local usage accounting across every provider Studio connects, plus the
// shapes needed to read each provider's own account. Pure data in, pure data
// out: this module never calls a provider and never sees a credential.
//
// Two ledgers feed one report. The Studio ledger (scripts/model-performance.cjs)
// holds the calls the app made itself: assistant HTTP routes, the CLI routes,
// Jev and the speed probes. The OpenCode store holds one row per assistant
// turn of every coding session the builders ran, with the provider, model,
// tokens and the cost OpenCode computed (scripts/eyes.mjs usageLedger). They
// are merged here, tagged by origin, and never double count: a call is either
// something Studio sent or a turn OpenCode ran, never both.
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const DEFAULT_LIMITS = Object.freeze({ rolling: 12, weekly: 30, monthly: 60 });
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"];
const ORIGINS = Object.freeze({ studio: "studio", cli: "opencode-cli" });

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value) => (number(value) !== null && value > 0 ? value : null);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const text = (value, max = 160) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// One row per provider the app can connect: the assistant routes
// (main.cjs AI_PROVIDERS), the Jev routes (scripts/decision-client.mjs) and
// the provider ids OpenCode's own store writes for coding sessions. `kind`
// decides what a zero cost means: a metered account prices every call (zero
// is a free model), a plan or subscription bills nothing per call (zero is
// "not priced", never "free"), and a local server has no bill at all.
// `account` names the live reading the host can make: over a saved key
// (windows, quota, key, credits), through the provider's own CLI login
// (limits), or against the local server (local).
const PROVIDERS = Object.freeze([
  { key: "opencode-go", label: "OpenCode Go", kind: "plan", account: "windows", aliases: ["opencode-go", "go"] },
  { key: "opencode-zen", label: "OpenCode Zen", kind: "metered", account: null, aliases: ["opencode-zen", "zen"] },
  { key: "zai", label: "z.ai GLM", kind: "plan", account: "quota", aliases: ["zai", "z.ai", "mefi-zai", "zhipu", "zhipuai", "bigmodel"] },
  { key: "openrouter", label: "OpenRouter", kind: "metered", account: "key", aliases: ["openrouter"] },
  { key: "gateway", label: "Vercel AI Gateway", kind: "metered", account: "credits", aliases: ["gateway", "vercel", "ai-gateway", "vercel-ai-gateway"] },
  { key: "typesafe", label: "TypeSafe Jev API", kind: "metered", account: null, aliases: ["typesafe", "jev"] },
  { key: "claude", label: "Claude Code CLI", kind: "subscription", account: "limits", aliases: ["claude", "claude-code", "anthropic"] },
  { key: "grok", label: "Grok CLI", kind: "subscription", account: "limits", aliases: ["grok", "xai", "x-ai"] },
  { key: "codex", label: "Codex CLI", kind: "subscription", account: "limits", aliases: ["codex", "codex-cli", "openai-codex"] },
  { key: "antigravity", label: "Antigravity CLI", kind: "subscription", account: "limits", aliases: ["antigravity", "agy"] },
  { key: "google", label: "Google Gemini", kind: "metered", account: null, aliases: ["google", "gemini", "google-vertex", "vertex"] },
  { key: "openai", label: "OpenAI", kind: "metered", account: null, aliases: ["openai"] },
  { key: "lmstudio", label: "LM Studio (local)", kind: "local", account: "local", aliases: ["lmstudio", "lm-studio"] },
  { key: "ollama", label: "Ollama (local)", kind: "local", account: null, aliases: ["ollama"] },
  { key: "custom", label: "Custom endpoint", kind: "custom", account: null, aliases: ["custom"] },
]);
const ALIASES = new Map();
for (const row of PROVIDERS) for (const alias of row.aliases) ALIASES.set(alias, row.key);

function providerSlug(value) {
  return text(value, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "unknown";
}
// "opencode" names two accounts: the Studio assistant's HTTP route bills
// OpenCode Go, while OpenCode's store writes "opencode" for Zen sessions and
// "opencode-go" for Go sessions. The source of the id settles which.
function canonicalProvider(value, source = "studio") {
  const slug = providerSlug(value);
  if (slug === "opencode") return source === "opencode-store" ? "opencode-zen" : "opencode-go";
  return ALIASES.get(slug) ?? slug;
}
function providerInfo(key) {
  const row = PROVIDERS.find((entry) => entry.key === key);
  if (row) return { key: row.key, label: row.label, kind: row.kind, account: row.account };
  return { key, label: key === "unknown" ? "Unknown provider" : key, kind: "unknown", account: null };
}

function limitsFromPlan(plan) {
  return {
    rolling: positive(plan?.window5hUSD) ?? DEFAULT_LIMITS.rolling,
    weekly: positive(plan?.weekUSD) ?? DEFAULT_LIMITS.weekly,
    monthly: positive(plan?.monthUSD) ?? DEFAULT_LIMITS.monthly,
  };
}

// What a stored cost means depends on who bills. Only a metered or local
// account can truthfully report zero; a plan or subscription never prices a
// call, so its zero stays unknown and is counted, never guessed. A turn that
// produced no tokens (an abort, an error before the first token) cost nothing
// wherever it ran.
function storeCost(cost, tokens, kind) {
  const value = number(cost);
  if (value !== null && value > 0) return value;
  if (!tokens) return 0;
  return kind === "metered" || kind === "local" ? 0 : null;
}

// One assistant turn from OpenCode's store, in the shape of a ledger record.
function normalizeStoreUsage(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object" || number(row.at) === null || !row.id) continue;
    const provider = canonicalProvider(row.provider, "opencode-store");
    const info = providerInfo(provider);
    const tokens = row.tokens && typeof row.tokens === "object" ? row.tokens : {};
    const input = count(tokens.input), output = count(tokens.output), reasoning = count(tokens.reasoning);
    const cacheRead = count(tokens.cacheRead), cacheWrite = count(tokens.cacheWrite);
    const total = Number.isSafeInteger(tokens.total) && tokens.total >= 0 ? tokens.total : input + output + reasoning + cacheRead + cacheWrite;
    const failure = text(row.error, 80);
    const aborted = /abort|cancel/i.test(failure);
    const completedAt = number(row.completedAt);
    out.push({
      id: `store:${text(row.id, 120)}`,
      at: row.at,
      origin: ORIGINS.cli,
      provider,
      providerId: providerSlug(row.provider),
      model: text(row.model, 160) || "unknown",
      sessionId: row.sessionId ? text(row.sessionId, 120) : null,
      agent: row.agent ? text(row.agent, 40) : null,
      directory: row.directory ? text(row.directory, 400) : null,
      taskType: row.agent ? providerSlug(row.agent) : "coding-session",
      source: "worker",
      status: failure ? (aborted ? "cancelled" : "error") : "ok",
      errorKind: failure && !aborted ? "unknown" : null,
      elapsedMs: completedAt !== null && completedAt >= row.at ? completedAt - row.at : null,
      tokenUsage: { inputTokens: input, outputTokens: output, reasoningTokens: reasoning, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, totalTokens: total },
      costUsd: storeCost(row.cost, total, info.kind),
    });
  }
  return out;
}

// A Studio ledger record with its provider resolved to the shared key. A
// local server never bills, so its missing cost is zero rather than unknown.
function fromStudio(row) {
  const provider = canonicalProvider(row.provider, "studio");
  const info = providerInfo(provider);
  const usage = row.tokenUsage && typeof row.tokenUsage === "object" ? row.tokenUsage : {};
  return {
    ...row,
    origin: ORIGINS.studio,
    provider,
    providerId: providerSlug(row.provider),
    tokenUsage: { ...usage, reasoningTokens: number(usage.reasoningTokens) },
    costUsd: number(row.costUsd) ?? (info.kind === "local" ? 0 : null),
  };
}

function mergeLedgers({ studio = [], store = [] } = {}) {
  const own = (Array.isArray(studio) ? studio : []).filter((row) => row && number(row.at) !== null).map(fromStudio);
  return [...own, ...normalizeStoreUsage(store)];
}

function usageOf(rows) {
  const field = (read) => {
    let known = null, knownRecords = 0;
    for (const row of rows) {
      const value = number(read(row));
      if (value === null) continue;
      known = (known ?? 0) + value;
      knownRecords += 1;
    }
    return { known, knownRecords, unknownRecords: rows.length - knownRecords };
  };
  return Object.fromEntries([
    ...TOKEN_FIELDS.map((key) => [key, field((row) => row.tokenUsage?.[key])]),
    ["costUsd", field((row) => row.costUsd)],
  ]);
}

function originsOf(rows) {
  const origins = { [ORIGINS.studio]: 0, [ORIGINS.cli]: 0 };
  for (const row of rows) origins[row.origin === ORIGINS.cli ? ORIGINS.cli : ORIGINS.studio] += 1;
  return origins;
}

function totals(rows) {
  return {
    calls: rows.length,
    errors: rows.filter((row) => row.status === "error").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
    origins: originsOf(rows),
    usage: usageOf(rows),
  };
}

function dayKeyOf(at) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function startOfLocalDay(at) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
function startOfUtcWeek(at) {
  const date = new Date(at);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday);
}
function startOfNextUtcWeek(at) {
  return startOfUtcWeek(at + 7 * DAY_MS);
}
function startOfUtcMonth(at) {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}
function startOfNextUtcMonth(at) {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

// A running totals() for one bucket. Rows are added in ledger order and each
// usage field sums exactly as usageOf does (the first known value lands on
// 0, and the sum stays null until one does), so a bucket fed row by row reads
// the same numbers, to the last bit, as totals() over the same rows. Sums
// live in a Float64Array: a plain array seeded with null boxed every addition.
const USAGE_KEYS = [...TOKEN_FIELDS, "costUsd"];
function tally() {
  return { calls: 0, errors: 0, cancelled: 0, studio: 0, cli: 0, sums: new Float64Array(USAGE_KEYS.length), records: new Int32Array(USAGE_KEYS.length) };
}
function tallyRow(bucket, row, values, known) {
  bucket.calls += 1;
  if (row.status === "error") bucket.errors += 1;
  if (row.status === "cancelled") bucket.cancelled += 1;
  if (row.origin === ORIGINS.cli) bucket.cli += 1;
  else bucket.studio += 1;
  for (let index = 0; index < values.length; index += 1) {
    if (!known[index]) continue;
    bucket.sums[index] += values[index];
    bucket.records[index] += 1;
  }
}
function tallied(bucket) {
  return {
    calls: bucket.calls,
    errors: bucket.errors,
    cancelled: bucket.cancelled,
    origins: { [ORIGINS.studio]: bucket.studio, [ORIGINS.cli]: bucket.cli },
    usage: Object.fromEntries(USAGE_KEYS.map((key, index) => [key, { known: bucket.records[index] ? bucket.sums[index] : null, knownRecords: bucket.records[index], unknownRecords: bucket.calls - bucket.records[index] }])),
  };
}

// Day buckets use the machine's local calendar; the Go plan's weekly and
// monthly windows are UTC, matching the provider's own reset boundaries.
// Records that arrive without an origin are Studio ledger rows.
// One pass feeds every bucket the report shows (the windows, both origins,
// each day and its providers, each provider and model with their windows);
// filtering and totalling the whole ledger once per bucket cost 110 ms on the
// main process at 22k records, every time the Usage panel refreshed.
function aggregateUsage(observations, { now = Date.now(), days = 14 } = {}) {
  const all = (Array.isArray(observations) ? observations : [])
    .filter((row) => row && number(row.at) !== null)
    .map((row) => (row.origin ? row : fromStudio(row)));
  const ordered = all.slice().sort((a, b) => a.at - b.at);
  const limit = Math.max(1, Math.min(90, Math.round(number(days) ?? 14)));
  const starts = [startOfLocalDay(now), now - 7 * DAY_MS, now - 30 * DAY_MS];
  const windowTallies = () => [tally(), tally(), tally()];
  const values = new Float64Array(USAGE_KEYS.length);
  const known = new Uint8Array(USAGE_KEYS.length);
  const tallyWindows = (buckets, row) => {
    if (row.at > now) return;
    for (let index = 0; index < starts.length; index += 1) if (row.at >= starts[index]) tallyRow(buckets[index], row, values, known);
  };
  const windowsOf = (buckets) => ({ today: tallied(buckets[0]), week: tallied(buckets[1]), month: tallied(buckets[2]) });
  const whole = tally();
  const wholeWindows = windowTallies();
  const origins = { [ORIGINS.studio]: tally(), [ORIGINS.cli]: tally() };
  const dayBuckets = new Map();
  const providerBuckets = new Map();
  // Models in first-seen order of provider::model, looked up per provider so
  // no key string is built per row.
  const modelList = [];
  // The ledger is in time order, so rows share a local day in long runs: the
  // day's bucket is kept with its [start, end) and only a row outside it
  // formats a day key.
  let day = null, dayStart = Infinity, dayEnd = -Infinity;
  for (const row of ordered) {
    for (let index = 0; index < USAGE_KEYS.length; index += 1) {
      const value = number(index === USAGE_KEYS.length - 1 ? row.costUsd : row.tokenUsage?.[USAGE_KEYS[index]]);
      known[index] = value === null ? 0 : 1;
      values[index] = value ?? 0;
    }
    tallyRow(whole, row, values, known);
    tallyWindows(wholeWindows, row);
    tallyRow(origins[row.origin === ORIGINS.cli ? ORIGINS.cli : ORIGINS.studio], row, values, known);
    if (!(row.at >= dayStart && row.at < dayEnd)) {
      const dayKey = dayKeyOf(row.at);
      day = dayBuckets.get(dayKey);
      if (!day) dayBuckets.set(dayKey, (day = { bucket: tally(), providers: new Map() }));
      const date = new Date(row.at);
      dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    }
    tallyRow(day.bucket, row, values, known);
    let dayProvider = day.providers.get(row.provider);
    if (!dayProvider) day.providers.set(row.provider, (dayProvider = tally()));
    tallyRow(dayProvider, row, values, known);
    let provider = providerBuckets.get(row.provider);
    if (!provider) providerBuckets.set(row.provider, (provider = { bucket: tally(), windows: windowTallies(), ids: new Set(), models: new Set(), byModel: new Map() }));
    tallyRow(provider.bucket, row, values, known);
    tallyWindows(provider.windows, row);
    if (row.providerId) provider.ids.add(row.providerId);
    if (row.model) provider.models.add(row.model);
    const modelKey = String(row.model || "unknown");
    let model = provider.byModel.get(modelKey);
    if (!model) {
      provider.byModel.set(modelKey, (model = { provider: row.provider, model: row.model || "unknown", bucket: tally(), windows: windowTallies() }));
      modelList.push(model);
    }
    tallyRow(model.bucket, row, values, known);
    tallyWindows(model.windows, row);
  }
  const daysList = [...dayBuckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([day, entry]) => ({
      day, ...tallied(entry.bucket),
      providers: [...entry.providers]
        .map(([provider, bucket]) => ({ provider, ...providerInfo(provider), ...tallied(bucket) }))
        .sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider)),
    }));
  return {
    generatedAt: now,
    days: daysList,
    ...windowsOf(wholeWindows),
    totals: tallied(whole),
    range: { from: ordered.length ? ordered[0].at : null, to: ordered.length ? ordered[ordered.length - 1].at : null },
    origins: Object.fromEntries(Object.values(ORIGINS).map((origin) => [origin, tallied(origins[origin])])),
    providers: [...providerBuckets]
      .map(([provider, entry]) => ({
        provider, ...providerInfo(provider),
        providerIds: [...entry.ids],
        models: entry.models.size,
        ...tallied(entry.bucket), ...windowsOf(entry.windows),
      }))
      .sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider)),
    models: modelList
      .map((entry) => ({ provider: entry.provider, label: providerInfo(entry.provider).label, model: entry.model, ...tallied(entry.bucket), ...windowsOf(entry.windows) }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
  };
}

// A local estimate of the OpenCode Go dollar windows from recorded calls only:
// the assistant's Go route and every coding-session turn OpenCode ran on Go.
// Costs the provider did not report stay unknown; they are counted, never
// guessed, so the estimate can only ever be lower than real account usage.
function opencodeWindows(observations, { now = Date.now(), limits = DEFAULT_LIMITS } = {}) {
  const resolved = {
    rolling: positive(limits?.rolling) ?? DEFAULT_LIMITS.rolling,
    weekly: positive(limits?.weekly) ?? DEFAULT_LIMITS.weekly,
    monthly: positive(limits?.monthly) ?? DEFAULT_LIMITS.monthly,
  };
  const rows = (Array.isArray(observations) ? observations : []).filter((row) => row && number(row.at) !== null
    && canonicalProvider(row.provider, row.origin === ORIGINS.cli ? "opencode-store" : "studio") === "opencode-go");
  const windowOf = (key, from, to, resetsAt) => {
    const entries = rows.filter((row) => row.at >= from && row.at < to);
    const cost = usageOf(entries).costUsd;
    const limitUsd = resolved[key];
    return {
      key, limitUsd, from, to, resetsAt,
      calls: entries.length,
      spentUsd: cost.known,
      knownRecords: cost.knownRecords,
      unknownRecords: cost.unknownRecords,
      percent: cost.known === null ? null : Math.round((cost.known / limitUsd) * 1000) / 10,
    };
  };
  const rollingStart = now - 5 * HOUR_MS;
  const rollingEntries = rows.filter((row) => row.at >= rollingStart && row.at <= now);
  const oldest = rollingEntries.length ? Math.min(...rollingEntries.map((row) => row.at)) : null;
  return {
    provider: "opencode-go",
    limits: resolved,
    rolling: windowOf("rolling", rollingStart, now + 1, oldest === null ? null : oldest + 5 * HOUR_MS),
    weekly: windowOf("weekly", startOfUtcWeek(now), startOfNextUtcWeek(now), startOfNextUtcWeek(now)),
    monthly: windowOf("monthly", startOfUtcMonth(now), startOfNextUtcMonth(now), startOfNextUtcMonth(now)),
    calls: rows.length,
  };
}

// ---- account readings ---------------------------------------------------
// Each parser turns one provider's own reply into a small, typed shape and
// throws when the reply cannot be trusted, so a changed API is reported as
// "could not be read" rather than shown as a number.

function parseOpencodeUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") throw new Error("The OpenCode usage reply has no usage windows");
  const read = (key) => {
    const row = usage[key];
    if (!row || typeof row !== "object") throw new Error(`The OpenCode usage reply is missing its ${key} window`);
    const percent = number(row.percent);
    if (percent === null || percent < 0) throw new Error(`The OpenCode ${key} window has no usable percent`);
    const resetsAt = typeof row.resetsAt === "string" && Number.isFinite(new Date(row.resetsAt).getTime()) ? row.resetsAt : null;
    return { status: typeof row.status === "string" && row.status ? row.status.slice(0, 40) : "unknown", percent, resetsAt };
  };
  return { rolling: read("rolling"), weekly: read("weekly"), monthly: read("monthly") };
}

// OpenRouter's key reading (GET /api/v1/key): USD spent on this key, the
// key's own spending limit when one is set, and the free-tier flag. Credits
// need a management key and are read separately when that succeeds.
function parseOpenrouterKey(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object") throw new Error("The OpenRouter key reply has no data");
  const usage = number(data.usage);
  if (usage === null || usage < 0) throw new Error("The OpenRouter key reply has no usable usage");
  const money = (value) => (number(value) !== null && value >= 0 ? value : null);
  const limit = money(data.limit);
  const remaining = money(data.limit_remaining);
  // Free-model requests carry their own daily allowance (50 a day under $10
  // of purchased credit, 1000 above it), which is the whole story for a key
  // on an account with no credits.
  const daily = data.free_model_daily_requests;
  const freeDaily = daily && typeof daily === "object" && count(daily.used) === daily.used && count(daily.limit) === daily.limit && daily.limit > 0
    ? { used: daily.used, limit: daily.limit, remaining: count(daily.remaining) === daily.remaining ? daily.remaining : Math.max(0, daily.limit - daily.used) }
    : null;
  return {
    label: text(data.label, 60) || null,
    usage,
    usageDaily: money(data.usage_daily),
    usageWeekly: money(data.usage_weekly),
    usageMonthly: money(data.usage_monthly),
    limit,
    limitRemaining: remaining,
    limitReset: text(data.limit_reset, 40) || null,
    percent: limit && limit > 0 ? Math.round((Math.min(usage, limit) / limit) * 1000) / 10 : null,
    isFreeTier: data.is_free_tier === true,
    isManagementKey: data.is_management_key === true,
    freeDaily,
    expiresAt: text(data.expires_at, 40) || null,
    byokUsage: money(data.byok_usage),
  };
}
// `remaining` stays clamped for the older readers; `balance` keeps its sign so
// an account that has spent past its credit says so instead of reading $0.
function parseOpenrouterCredits(payload) {
  const data = payload?.data;
  if (!data || typeof data !== "object") throw new Error("The OpenRouter credits reply has no data");
  const totalCredits = number(data.total_credits), totalUsage = number(data.total_usage);
  if (totalCredits === null || totalUsage === null || totalCredits < 0 || totalUsage < 0) throw new Error("The OpenRouter credits reply has no usable totals");
  return { totalCredits, totalUsage, remaining: Math.max(0, totalCredits - totalUsage), balance: totalCredits - totalUsage };
}

// Vercel AI Gateway (GET /v1/credits): the documented REST sample carries the
// dollar amounts as strings while the SDK types them as numbers.
function parseGatewayCredits(payload) {
  const money = (value) => {
    const parsed = typeof value === "string" ? Number(value.trim()) : value;
    return number(parsed) !== null && parsed >= 0 ? parsed : null;
  };
  const balance = money(payload?.balance);
  if (balance === null) throw new Error("The AI Gateway credits reply has no usable balance");
  return { balance, totalUsed: money(payload?.total_used) };
}

// z.ai's coding-plan quota (GET /api/monitor/usage/quota/limit). The endpoint
// is what z.ai's own usage plugin calls, not a documented API. Since
// 2026-07-30 the coding plans bill in credits: the five-hour and weekly rows
// arrive as CREDIT_LIMIT with the cap in `usage` and the spend in
// `currentValue`. Legacy plans still send TOKENS_LIMIT rows (a percentage
// only) and a TIME_LIMIT row for the monthly tool quota. Rows are told apart
// by unit and number (3/5 is five hours, 6/1 one week), never by position,
// and a reply the parser cannot place is refused rather than guessed at.
const numeric = (value) => number(typeof value === "string" && value.trim() ? Number(value) : value);
const ZAI_PLAN_TYPES = new Set(["CREDIT_LIMIT", "TOKENS_LIMIT"]);
const ZAI_UNIT_MINUTES = { 1: 1440, 3: 60, 6: 10080 };
const ZAI_MEASURES = { CREDIT_LIMIT: "credits", TOKENS_LIMIT: "tokens", TIME_LIMIT: "calls" };
function zaiWindow(row, now) {
  const cap = numeric(row.usage), current = numeric(row.currentValue), left = numeric(row.remaining);
  const used = current !== null && current >= 0 ? current : cap !== null && left !== null ? Math.max(0, cap - left) : null;
  // The counts are more precise than the server's rounded percentage.
  let percent = cap !== null && cap > 0 && used !== null ? (used / cap) * 100 : numeric(row.percentage);
  if (percent === null || percent < 0) return null;
  percent = Math.min(100, Math.round(percent * 10) / 10);
  const unit = numeric(row.unit), span = numeric(row.number);
  const minutes = row.type !== "TIME_LIMIT" && span !== null && span > 0 && ZAI_UNIT_MINUTES[unit] ? span * ZAI_UNIT_MINUTES[unit] : null;
  // z.ai has reported five-hour resets further off than five hours; an
  // impossible reset is dropped rather than shown.
  let reset = numeric(row.nextResetTime);
  if (reset !== null && (reset <= 0 || !Number.isFinite(new Date(reset).getTime()) || (minutes === 300 && reset > now + 5 * HOUR_MS + 60000))) reset = null;
  return {
    percent,
    resetsAt: reset === null ? null : new Date(reset).toISOString(),
    used,
    limit: cap,
    remaining: left ?? (cap !== null && used !== null ? Math.max(0, cap - used) : null),
    measure: ZAI_MEASURES[row.type] ?? "tokens",
    minutes,
  };
}
function parseZaiQuota(payload, { now = Date.now() } = {}) {
  // z.ai answers a refused or expired key with HTTP 200 and an envelope
  // ({ code: 401, msg, success: false }; 1001 when no key reached it), so the
  // refusal is read from the body and named as such, not as a changed shape.
  if (payload && typeof payload === "object" && payload.success === false) {
    const code = number(payload.code);
    const message = text(payload.msg ?? payload.message ?? "", 160);
    const refused = code === 401 || code === 1001;
    const error = new Error(refused
      ? `z.ai rejected the saved key (${code})${message ? `: ${message}` : ""}. Save a current key in Settings.`
      : `z.ai usage could not be read (code ${code ?? "?"})${message ? `: ${message}` : ""}`);
    error.code = refused ? "auth" : "http";
    throw error;
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const limits = Array.isArray(data?.limits) ? data.limits : null;
  if (!limits) throw new Error("The z.ai quota reply has no limits");
  const level = text(data?.level ?? data?.planName ?? data?.plan ?? "", 20).toLowerCase() || null;
  const rows = limits.filter((entry) => entry && typeof entry === "object");
  // A team plan, or a key with no coding plan, answers with an empty list:
  // a real state with nothing to draw, not a changed reply.
  if (!rows.length) return { level, plan: null, empty: true, rolling: null, weekly: null, tools: null, other: [] };
  const windows = rows.filter((row) => ZAI_PLAN_TYPES.has(row.type)).map((row) => zaiWindow(row, now)).filter(Boolean);
  const toolRow = rows.filter((row) => row.type === "TIME_LIMIT").pop();
  const tools = toolRow ? zaiWindow(toolRow, now) : null;
  const rolling = windows.find((window) => window.minutes === 300) ?? null;
  const weekly = windows.find((window) => window.minutes === 10080) ?? null;
  if (!windows.length && !tools) {
    const types = [...new Set(rows.map((row) => text(row.type, 24) || "untyped"))].join(", ");
    throw new Error(`The z.ai quota reply has no recognisable window (types: ${types})`);
  }
  return {
    level,
    plan: windows.some((window) => window.measure === "credits") ? "credits" : windows.length ? "tokens" : null,
    empty: false,
    rolling,
    weekly,
    tools,
    other: windows.filter((window) => window !== rolling && window !== weekly),
  };
}

function describeAccountStatus(label, status, body = "", secret = null) {
  if (status === 401) return `${label} rejected the saved key (401). Save a current key in Settings.`;
  if (status === 403) return `${label} refused this key (403). Check the plan, the key's permissions or the subscription.`;
  if (status === 429) return `${label} is rate-limiting usage reads (429). Try again in a minute.`;
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = text(parsed?.error?.message ?? parsed?.message ?? "", 160);
  } catch {
    detail = text(body, 160);
  }
  if (secret) detail = detail.split(String(secret)).join("[redacted]");
  return `${label} usage could not be read (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

function describeOpencodeStatus(status, body = "", secret = null) {
  if (status === 401) return "OpenCode rejected the saved Go key (401). Save a current key in Settings.";
  if (status === 403) return "This key has no OpenCode Go subscription (403). Check the plan or the key.";
  if (status === 429) return "OpenCode is rate-limiting usage reads (429). Try again in a minute.";
  return describeAccountStatus("OpenCode", status, body, secret);
}

// ---- CLI replies --------------------------------------------------------
// The CLI assistant routes print JSON in their headless modes - one object
// for Claude Code, Grok and Antigravity, one event per line for Codex - and
// each carries the reply text and the tokens the run consumed. The reader is
// deliberately forgiving about the envelope (a CLI that prints a banner line
// first still counts) and strict about the numbers.
function cliInteger(...values) {
  for (const value of values) if (Number.isSafeInteger(value) && value >= 0) return value;
  return null;
}
function parseCliJson(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return null;
  const start = raw.indexOf("{");
  if (start < 0) return null;
  for (const candidate of [raw, raw.slice(start), raw.slice(raw.lastIndexOf("\n{") + 1)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}
function cliTokenUsage(usage, { cacheRead = [], cacheWrite = [], reasoning = [] } = {}) {
  if (!usage || typeof usage !== "object") return {};
  const inputTokens = cliInteger(usage.input_tokens, usage.inputTokens, usage.prompt_tokens);
  const outputTokens = cliInteger(usage.output_tokens, usage.outputTokens, usage.completion_tokens);
  const cacheReadTokens = cliInteger(...cacheRead.map((key) => usage[key]));
  const cacheWriteTokens = cliInteger(...cacheWrite.map((key) => usage[key]));
  const reasoningTokens = cliInteger(...reasoning.map((key) => usage[key]));
  const total = cliInteger(usage.total_tokens, usage.totalTokens);
  const parts = [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens].filter((value) => value !== null);
  return {
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens,
    totalTokens: total ?? (inputTokens !== null && outputTokens !== null ? parts.reduce((sum, value) => sum + value, 0) : null),
  };
}
// Claude Code: { type: "result", subtype, is_error, result, usage, modelUsage,
// total_cost_usd }. The cost is the CLI's client-side estimate at list price,
// not a bill (the route rides the owner's subscription), so only the tokens
// are recorded and the estimate travels separately as `equivalentUsd`.
function parseClaudeCliResult(stdout) {
  const parsed = parseCliJson(stdout);
  if (!parsed || parsed.type !== "result") return null;
  const modelUsage = parsed.modelUsage && typeof parsed.modelUsage === "object" ? parsed.modelUsage : {};
  const models = Object.keys(modelUsage).filter((key) => key && modelUsage[key] && typeof modelUsage[key] === "object");
  const summed = models.length ? {
    input_tokens: models.reduce((sum, key) => sum + count(modelUsage[key].inputTokens), 0),
    output_tokens: models.reduce((sum, key) => sum + count(modelUsage[key].outputTokens), 0),
    cache_read_input_tokens: models.reduce((sum, key) => sum + count(modelUsage[key].cacheReadInputTokens), 0),
    cache_creation_input_tokens: models.reduce((sum, key) => sum + count(modelUsage[key].cacheCreationInputTokens), 0),
  } : parsed.usage;
  const errors = Array.isArray(parsed.errors) ? parsed.errors.map((entry) => text(entry, 160)).filter(Boolean) : [];
  const failed = parsed.is_error === true || parsed.subtype !== "success";
  return {
    ok: !failed && typeof parsed.result === "string",
    text: typeof parsed.result === "string" ? parsed.result : "",
    error: failed ? `${text(parsed.subtype, 60) || "error"}${errors.length ? `: ${errors[0]}` : ""}` : null,
    model: models.length === 1 ? text(models[0], 120) : null,
    tokenUsage: cliTokenUsage(summed, { cacheRead: ["cache_read_input_tokens"], cacheWrite: ["cache_creation_input_tokens"] }),
    costUsd: null,
    equivalentUsd: positive(parsed.total_cost_usd),
    elapsedMs: number(parsed.duration_ms),
  };
}
// Grok CLI: { text, stopReason, usage, modelUsage, total_cost_usd? }. The
// cost is stamped only when xAI reported a complete price (API-key traffic);
// a login-pooled run omits it, and a partial one says so. Absent means
// unreported, never free.
function parseGrokCliResult(stdout) {
  const parsed = parseCliJson(stdout);
  if (!parsed) return null;
  if (parsed.type === "error") return { ok: false, text: "", error: text(parsed.message, 200) || "grok error", model: null, tokenUsage: {}, costUsd: null };
  if (typeof parsed.text !== "string") return null;
  const modelUsage = parsed.modelUsage && typeof parsed.modelUsage === "object" ? parsed.modelUsage : {};
  const models = Object.keys(modelUsage).filter((key) => key && modelUsage[key] && typeof modelUsage[key] === "object");
  const complete = parsed.cost_is_partial !== true && parsed.usage_is_incomplete !== true;
  const cost = number(parsed.total_cost_usd);
  return {
    ok: true,
    text: parsed.text,
    error: null,
    model: models.length === 1 ? text(models[0], 120) : null,
    tokenUsage: cliTokenUsage(parsed.usage, { cacheRead: ["cache_read_input_tokens"], cacheWrite: ["cache_creation_input_tokens"], reasoning: ["reasoning_tokens"] }),
    costUsd: complete && cost !== null && cost >= 0 ? cost : null,
  };
}
// Antigravity CLI: { response, status, error, usage: { input_tokens,
// output_tokens, thinking_tokens, cache_read_tokens, total_tokens } }; no cost.
function parseAntigravityCliResult(stdout) {
  const parsed = parseCliJson(stdout);
  if (!parsed || typeof parsed.response !== "string") return null;
  const failed = typeof parsed.error === "string" && parsed.error.trim().length > 0;
  return {
    ok: !failed && parsed.response.trim().length > 0,
    text: parsed.response,
    error: failed ? text(parsed.error, 200) : null,
    model: null,
    tokenUsage: cliTokenUsage(parsed.usage, { cacheRead: ["cache_read_tokens"], reasoning: ["thinking_tokens"] }),
    costUsd: null,
  };
}

// Codex CLI (`codex exec --json`): one JSON event per line - thread.started,
// turn.started, item.started/updated/completed (the reply is the last
// completed agent_message item's text), turn.completed carrying usage
// { input_tokens, cached_input_tokens, output_tokens }, and turn.failed or
// error carrying a message. The stream names no model and no cost (the route
// rides the owner's ChatGPT login or API key), so both stay unknown. Codex
// counts cached tokens inside input_tokens, so the total is input + output
// rather than the sum the other CLIs' separate cache counters need.
function parseCodexCliResult(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return null;
  let sawEvent = false;
  let reply = "";
  let failure = null;
  let usage = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    if (!event || typeof event !== "object" || typeof event.type !== "string") continue;
    sawEvent = true;
    const item = event.item && typeof event.item === "object" ? event.item : null;
    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") reply = item.text;
    else if (event.type === "turn.completed" && event.usage && typeof event.usage === "object") usage = event.usage;
    else if (event.type === "turn.failed") failure = text(event.error?.message ?? event.error, 200) || "turn failed";
    else if (event.type === "error") failure = text(event.message ?? event.error?.message ?? event.error, 200) || "codex error";
  }
  if (!sawEvent) return null;
  const input = cliInteger(usage?.input_tokens);
  const output = cliInteger(usage?.output_tokens);
  const normalized = usage ? { ...usage, total_tokens: input !== null && output !== null ? input + output : usage.total_tokens } : null;
  return {
    ok: !failure && reply.trim().length > 0,
    text: reply,
    error: failure,
    model: null,
    tokenUsage: cliTokenUsage(normalized, { cacheRead: ["cached_input_tokens"] }),
    costUsd: null,
  };
}

// ---- plan windows the coding CLIs report -----------------------------------
// Claude Code, Codex, Grok and Antigravity each know their own plan's windows
// and answer for them over their own login: the host asks the CLI (never a
// credential file) and these parsers turn every answer into one shape,
//   Limits = { plan, source, asOf, windows, blocked, available, note }
// with each window { id, short, label, percent, resetsAt, severity, scope,
// minutes }. `short` is the compact bar's label, `label` the long one.
// Windows sort shortest first, so a five-hour window always leads.
const isoTime = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null;
};
const SEVERITIES = new Set(["normal", "warning", "critical"]);
function limitWindow({ id, short, label, percent, resetsAt = null, severity = null, scope = null, minutes = null }) {
  const value = numeric(percent);
  if (value === null || value < 0) return null;
  return {
    id: text(id, 60) || "window",
    short: text(short, 6) || "Now",
    label: text(label, 60) || text(id, 60) || "Current window",
    percent: Math.min(100, Math.round(value * 10) / 10),
    resetsAt: isoTime(resetsAt),
    severity: SEVERITIES.has(severity) ? severity : null,
    scope: scope ? text(scope, 40) : null,
    minutes: numeric(minutes),
  };
}
function limitsOf(windows, extra = {}) {
  const list = windows.filter(Boolean)
    .map((window, index) => ({ window, index }))
    .sort((a, b) => (a.window.minutes ?? Infinity) - (b.window.minutes ?? Infinity) || a.index - b.index)
    .map(({ window }) => window);
  return {
    plan: null, source: "cli", asOf: null, available: true, note: null,
    ...extra,
    windows: list,
    blocked: typeof extra.blocked === "boolean" ? extra.blocked : list.some((window) => window.percent >= 100),
  };
}
// A window whose reset has already passed has emptied since the reading was
// taken; it reads as reset, never as the stale percentage.
function markResets(windows, now) {
  for (const window of windows) {
    if (window && window.resetsAt && Date.parse(window.resetsAt) <= now) {
      window.percent = 0;
      window.reset = true;
    }
  }
  return windows;
}

// Claude Code answers a `get_usage` control request on its stream-json
// channel with the same body its /usage screen draws: `rate_limits.limits[]`
// rows classified by `kind` (session, weekly_all, weekly_scoped with the
// model's display name), percent 0-100 and an ISO reset. Older replies carry
// only the named windows (five_hour, seven_day, seven_day_opus/_sonnet with
// `utilization`) and `model_scoped[]`. An API-key, Bedrock or Vertex login
// has no plan windows at all, which is a state, not a failure.
const CLAUDE_KINDS = {
  session: { id: "5h", short: "5h", label: "5-hour session", minutes: 300 },
  weekly_all: { id: "week", short: "Wk", label: "Weekly · all models", minutes: 10080 },
};
const claudeScoped = (name) => ({ id: `week:${name.toLowerCase()}`, short: name.slice(0, 6), label: `Weekly · ${name}`, minutes: 10080, scope: name });
function parseClaudeUsage(body, { now = Date.now() } = {}) {
  if (!body || typeof body !== "object") throw new Error("Claude Code sent no usage reply");
  const plan = text(body.subscription_type, 24).toLowerCase() || null;
  if (body.rate_limits_available === false) {
    return limitsOf([], { plan, available: false, note: "Plan windows are not available for this login (API key, Bedrock or Vertex)." });
  }
  const limits = body.rate_limits && typeof body.rate_limits === "object" ? body.rate_limits : {};
  let windows = [];
  if (Array.isArray(limits.limits) && limits.limits.length) {
    windows = limits.limits.filter((row) => row && typeof row === "object").map((row) => {
      const name = text(row.scope?.model?.display_name ?? row.scope?.surface?.display_name ?? "", 40);
      const group = row.group === "weekly" ? { short: "Wk", minutes: 10080 } : row.group === "session" ? { short: "5h", minutes: 300 } : { short: text(row.kind, 6), minutes: null };
      const shape = CLAUDE_KINDS[row.kind] ?? (name ? claudeScoped(name) : { id: text(row.kind, 40), label: text(row.kind, 40).replace(/_/g, " "), ...group });
      return limitWindow({ ...shape, percent: row.percent, resetsAt: row.resets_at, severity: row.severity });
    });
  } else {
    const named = [
      ["five_hour", CLAUDE_KINDS.session], ["seven_day", CLAUDE_KINDS.weekly_all],
      ["seven_day_opus", claudeScoped("Opus")], ["seven_day_sonnet", claudeScoped("Sonnet")],
    ];
    windows = named.map(([key, shape]) => (limits[key] && typeof limits[key] === "object" ? limitWindow({ ...shape, percent: limits[key].utilization, resetsAt: limits[key].resets_at }) : null));
    for (const row of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
      const name = text(row?.display_name, 40);
      if (name) windows.push(limitWindow({ ...claudeScoped(name), percent: row.utilization, resetsAt: row.resets_at }));
    }
  }
  const result = limitsOf(markResets(windows.filter(Boolean), now), { plan });
  if (!result.windows.length) throw new Error("Claude Code reported no plan windows");
  return result;
}

// Codex reports its plan windows two ways: live, from `codex app-server`'s
// account/rateLimits/read (camelCase, `resetsAt` in epoch seconds), and after
// the fact in every session rollout's token_count events (snake_case; older
// builds wrote `resets_in_seconds` relative to the event, older still a flat
// `primary_used_percent`). Which slot a window sits in means nothing - Plus
// and Pro accounts now carry only a weekly window, in `primary` - so windows
// are classified by their length. `ordinaryUsageAllowed: false` is the live
// read saying the plan is spent; the rollouts leave `rate_limit_reached_type`
// null even at 100%, so there a full window is the only signal.
const CODEX_WINDOWS = {
  300: { id: "5h", short: "5h", label: "5-hour window" },
  10080: { id: "week", short: "Wk", label: "Weekly window" },
  43200: { id: "month", short: "Mo", label: "30-day window" },
};
function codexWindow(raw, observedAt) {
  if (!raw || typeof raw !== "object") return null;
  const minutes = numeric(raw.windowDurationMins ?? raw.window_minutes);
  const hours = minutes !== null && minutes > 0 ? Math.round(minutes / 60) : null;
  const shape = CODEX_WINDOWS[minutes] ?? (hours ? { id: `${minutes}m`, short: `${hours}h`, label: `${hours}-hour window` } : { id: "window", short: "Now", label: "Current window" });
  const seconds = numeric(raw.resetsAt ?? raw.resets_at);
  const relative = numeric(raw.resets_in_seconds);
  const reset = seconds !== null && seconds > 0 ? seconds * 1000 : relative !== null && observedAt !== null ? observedAt + relative * 1000 : null;
  return limitWindow({ ...shape, minutes, percent: raw.usedPercent ?? raw.used_percent, resetsAt: reset });
}
function parseCodexRateLimits(input, { now = Date.now(), observedAt = null, source = "cli" } = {}) {
  if (!input || typeof input !== "object") throw new Error("Codex sent no rate-limit reply");
  const live = "rateLimits" in input || "rateLimitsByLimitId" in input;
  const snapshot = live ? input.rateLimitsByLimitId?.codex ?? input.rateLimits : input;
  const empty = "Codex reported no plan windows (an API-key login or another provider).";
  if (!snapshot || typeof snapshot !== "object") return limitsOf([], { source, asOf: observedAt, note: empty, blocked: input.ordinaryUsageAllowed === false });
  const flat = !snapshot.primary && !snapshot.secondary && numeric(snapshot.primary_used_percent) !== null;
  const windows = flat
    ? [codexWindow({ used_percent: snapshot.primary_used_percent, window_minutes: snapshot.primary_window_minutes }, observedAt),
      codexWindow({ used_percent: snapshot.secondary_used_percent, window_minutes: snapshot.secondary_window_minutes }, observedAt)]
    : [codexWindow(snapshot.primary, observedAt), codexWindow(snapshot.secondary, observedAt)];
  markResets(windows.filter(Boolean), now);
  const creditsRaw = snapshot.credits && typeof snapshot.credits === "object" ? snapshot.credits : null;
  const credits = creditsRaw ? {
    hasCredits: (creditsRaw.hasCredits ?? creditsRaw.has_credits) === true,
    unlimited: creditsRaw.unlimited === true,
    balance: numeric(creditsRaw.balance),
  } : null;
  const result = limitsOf(windows, {
    plan: text(snapshot.planType ?? snapshot.plan_type, 24).toLowerCase() || null,
    source, asOf: observedAt, credits,
    blocked: input.ordinaryUsageAllowed === false || windows.some((window) => window && window.percent >= 100),
  });
  if (!result.windows.length) result.note = empty;
  return result;
}
// The newest main-lane snapshot in a rollout's tail. A tail read usually
// starts mid-line, so its first line is dropped unless the read began at the
// top of the file. Only token_count lines are parsed; everything else in a
// rollout (the prompts, the replies) is skipped unread. The last event is not
// always the useful one: a `premium` lane or a header-less provider writes
// null windows, so the newest snapshot with a window wins, by event time.
function parseCodexRollout(chunk, { fromStart = false } = {}) {
  const lines = String(chunk ?? "").split(/\r?\n/);
  if (!fromStart) lines.shift();
  let best = null, planType = null, planAt = -Infinity;
  for (const line of lines) {
    if (!line.includes("\"token_count\"") || !line.includes("\"rate_limits\"")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const limits = event?.payload?.type === "token_count" ? event.payload.rate_limits : null;
    if (!limits || typeof limits !== "object") continue;
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) continue;
    const plan = text(limits.plan_type, 24).toLowerCase();
    if (plan && at >= planAt) { planType = plan; planAt = at; }
    if (limits.limit_id && limits.limit_id !== "codex") continue;
    const hasWindow = [limits.primary, limits.secondary].some((window) => window && typeof window === "object") || numeric(limits.primary_used_percent) !== null;
    if (hasWindow && (!best || at >= best.observedAt)) best = { snapshot: limits, observedAt: at };
  }
  return best ? { ...best, planType } : null;
}

// Grok's `_x.ai/billing` extension (over `grok agent stdio`) returns the
// credit pool its login draws on: one usage percent for the current period
// (weekly for unified billing) plus prepaid and on-demand money in cents
// ({ val }, where {} is zero). A full pool with prepaid credit or on-demand
// headroom left is not blocked. `monthlyLimit`/`used` are the deprecated
// shape, read only when the percent is missing.
function parseGrokBilling(result, { now = Date.now() } = {}) {
  const config = result?.config;
  if (!config || typeof config !== "object") throw new Error("The Grok billing reply has no config");
  const usd = (value) => {
    const cents = value && typeof value === "object" ? numeric(value.val ?? 0) : numeric(value);
    return cents === null ? null : cents / 100;
  };
  const period = config.currentPeriod && typeof config.currentPeriod === "object" ? config.currentPeriod : {};
  const kind = String(period.type ?? "").toUpperCase();
  const shape = kind.includes("WEEK") ? { id: "week", short: "Wk", label: "Weekly credits", minutes: 10080 }
    : kind.includes("MONTH") ? { id: "month", short: "Mo", label: "Monthly credits", minutes: 43200 }
      : kind.includes("DAY") ? { id: "day", short: "Day", label: "Daily credits", minutes: 1440 }
        : { id: "period", short: "Cr", label: "Credits" };
  let percent = numeric(config.creditUsagePercent);
  if (percent === null) {
    const limit = usd(config.monthlyLimit), used = usd(config.used);
    if (limit !== null && limit > 0 && used !== null) percent = (used / limit) * 100;
  }
  const window = percent === null ? null : limitWindow({ ...shape, percent, resetsAt: period.end ?? config.billingPeriodEnd ?? null });
  markResets([window], now);
  const credits = { prepaidUsd: usd(config.prepaidBalance), onDemandCapUsd: usd(config.onDemandCap), onDemandUsedUsd: usd(config.onDemandUsed) };
  const spare = (credits.prepaidUsd ?? 0) > 0 || (credits.onDemandCapUsd ?? 0) > (credits.onDemandUsedUsd ?? 0);
  return limitsOf([window], {
    plan: text(result.subscriptionTier, 40) || null,
    credits,
    blocked: Boolean(window && window.percent >= 100 && !spare),
    note: window ? null : "Grok reported no credit usage for this period.",
  });
}

// Antigravity's `/usage` command in print mode: model groups, each with
// buckets carrying the fraction left and a reset. A full bucket's reset moves
// on every read, so it is not shown.
function parseAntigravityUsage(stdout, { now = Date.now() } = {}) {
  const parsed = parseCliJson(stdout);
  const groups = parsed?.command?.data?.groups;
  if (!parsed || parsed.status !== "SUCCESS" || !Array.isArray(groups) || !groups.length) throw new Error("Antigravity reported no usage groups");
  const windows = [];
  for (const group of groups) {
    const name = text(group?.name, 40);
    for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
      const left = numeric(bucket?.remaining_fraction);
      if (left === null) continue;
      const period = text(bucket.window, 20).toLowerCase();
      const minutes = period === "weekly" ? 10080 : period === "daily" ? 1440 : null;
      windows.push(limitWindow({
        id: text(bucket.id, 60) || `${name}-${period}`,
        short: name.split(/\s+/)[0] || (period === "weekly" ? "Wk" : period),
        label: `${name || "Models"} · ${period || "window"}`,
        minutes,
        percent: (1 - Math.min(1, Math.max(0, left))) * 100,
        resetsAt: left >= 1 ? null : bucket.reset_time,
        scope: name || null,
      }));
    }
  }
  const result = limitsOf(markResets(windows.filter(Boolean), now), {});
  if (!result.windows.length) throw new Error("Antigravity reported no usage groups");
  return result;
}

// ---- one unit of work, across both ledgers ---------------------------------
// "What did this task cost" has two halves and they live in different stores:
// the turns the coding worker ran (OpenCode's store, keyed by session) and the
// calls Studio made itself (the model-performance ledger, keyed by run). Both
// are already merged and origin-tagged by mergeLedgers, so scoping is a filter
// rather than a third accounting path.
//
// An attempt is a session plus the window it ran in. The window matters: a
// session is reused across attempts, so without it a retry would be charged
// its predecessor's turns.
function scopeUsage(rows, attempts = []) {
  const windows = (Array.isArray(attempts) ? attempts : []).filter((attempt) => attempt && (attempt.sessionId || attempt.runId));
  if (!windows.length) return [];
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    windows.some((attempt) => {
      if (attempt.runId && row.runId && row.runId === attempt.runId) return true;
      if (!attempt.sessionId || row.sessionId !== attempt.sessionId) return false;
      const since = number(attempt.since), until = number(attempt.until);
      if (since === null || until === null) return false;
      const at = number(row.at);
      return at !== null && at >= since && at <= until;
    }),
  );
}

// The rollup a card shows. Same known/unknown discipline as the daily report:
// a plan or subscription prices nothing per call, so those rows raise
// unknownRecords rather than contributing a zero that would read as "free".
function rollupUsage(rows, attempts = []) {
  return totals(scopeUsage(rows, attempts));
}

const compactCount = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value));

// "in 12.3k · cached 1.1k · out 2.1k · $0.0400", or "unpriced" where the
// provider bills no per-call cost. Never prints $0.00 for an unpriced call.
function formatUsage(summary) {
  const usage = summary?.usage ?? summary ?? {};
  const known = (key) => usage?.[key]?.known ?? null;
  const parts = [];
  const input = known("inputTokens");
  if (input !== null) parts.push(`in ${compactCount(input)}`);
  const cached = known("cacheReadTokens");
  if (cached) parts.push(`cached ${compactCount(cached)}`);
  const written = known("cacheWriteTokens");
  if (written) parts.push(`cache-wr ${compactCount(written)}`);
  const output = known("outputTokens");
  if (output !== null) parts.push(`out ${compactCount(output)}`);
  const cost = known("costUsd");
  const unpriced = usage?.costUsd?.unknownRecords ?? 0;
  if (cost !== null && cost > 0) parts.push(`$${cost.toFixed(4)}`);
  else if (unpriced > 0) parts.push("unpriced");
  else if (cost !== null) parts.push("$0.0000");
  return parts.join(" · ");
}

module.exports = {
  DEFAULT_LIMITS, PROVIDERS, ORIGINS, TOKEN_FIELDS,
  scopeUsage, rollupUsage, formatUsage,
  canonicalProvider, providerInfo, providerSlug,
  limitsFromPlan, normalizeStoreUsage, mergeLedgers, aggregateUsage, opencodeWindows,
  parseOpencodeUsage, parseOpenrouterKey, parseOpenrouterCredits, parseGatewayCredits, parseZaiQuota,
  describeAccountStatus, describeOpencodeStatus,
  parseCliJson, parseClaudeCliResult, parseGrokCliResult, parseAntigravityCliResult, parseCodexCliResult,
  parseClaudeUsage, parseCodexRateLimits, parseCodexRollout, parseGrokBilling, parseAntigravityUsage,
};
