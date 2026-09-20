"use strict";

// Local usage accounting for recorded model calls, plus the shapes needed to
// read OpenCode Go's own account windows. Pure data in, pure data out: this
// module never calls a provider and never sees a credential.
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const DEFAULT_LIMITS = Object.freeze({ rolling: 12, weekly: 30, monthly: 60 });
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"];

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value) => (number(value) !== null && value > 0 ? value : null);

function limitsFromPlan(plan) {
  return {
    rolling: positive(plan?.window5hUSD) ?? DEFAULT_LIMITS.rolling,
    weekly: positive(plan?.weekUSD) ?? DEFAULT_LIMITS.weekly,
    monthly: positive(plan?.monthUSD) ?? DEFAULT_LIMITS.monthly,
  };
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

function totals(rows) {
  return {
    calls: rows.length,
    errors: rows.filter((row) => row.status === "error").length,
    cancelled: rows.filter((row) => row.status === "cancelled").length,
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

// Day buckets use the machine's local calendar; the Go plan's weekly and
// monthly windows are UTC, matching the provider's own reset boundaries.
function aggregateUsage(observations, { now = Date.now(), days = 14 } = {}) {
  const all = (Array.isArray(observations) ? observations : []).filter((row) => row && number(row.at) !== null);
  const ordered = all.slice().sort((a, b) => a.at - b.at);
  const buckets = new Map();
  for (const row of ordered) {
    const key = dayKeyOf(row.at);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const limit = Math.max(1, Math.min(90, Math.round(number(days) ?? 14)));
  const daysList = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([day, entries]) => ({ day, ...totals(entries) }));
  const since = (from) => totals(ordered.filter((row) => row.at >= from && row.at <= now));
  const grouped = (read) => {
    const map = new Map();
    for (const row of ordered) {
      const key = read(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  };
  return {
    generatedAt: now,
    days: daysList,
    today: since(startOfLocalDay(now)),
    week: since(now - 7 * DAY_MS),
    month: since(now - 30 * DAY_MS),
    totals: totals(ordered),
    range: { from: ordered.length ? ordered[0].at : null, to: ordered.length ? ordered[ordered.length - 1].at : null },
    providers: [...grouped((row) => row.provider || "unknown")]
      .map(([provider, entries]) => ({ provider, ...totals(entries) }))
      .sort((a, b) => b.calls - a.calls || a.provider.localeCompare(b.provider)),
    models: [...grouped((row) => `${row.provider || "unknown"}::${row.model || "unknown"}`)]
      .map(([, entries]) => ({ provider: entries[0].provider || "unknown", model: entries[0].model || "unknown", ...totals(entries) }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
  };
}

// A local estimate of the OpenCode Go dollar windows from recorded calls only.
// Costs the provider did not report stay unknown; they are counted, never
// guessed, so the estimate can only ever be lower than real account usage.
function opencodeWindows(observations, { now = Date.now(), limits = DEFAULT_LIMITS } = {}) {
  const resolved = {
    rolling: positive(limits?.rolling) ?? DEFAULT_LIMITS.rolling,
    weekly: positive(limits?.weekly) ?? DEFAULT_LIMITS.weekly,
    monthly: positive(limits?.monthly) ?? DEFAULT_LIMITS.monthly,
  };
  const rows = (Array.isArray(observations) ? observations : []).filter((row) => row?.provider === "opencode" && number(row.at) !== null);
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
    provider: "opencode",
    limits: resolved,
    rolling: windowOf("rolling", rollingStart, now + 1, oldest === null ? null : oldest + 5 * HOUR_MS),
    weekly: windowOf("weekly", startOfUtcWeek(now), startOfNextUtcWeek(now), startOfNextUtcWeek(now)),
    monthly: windowOf("monthly", startOfUtcMonth(now), startOfNextUtcMonth(now), startOfNextUtcMonth(now)),
    calls: rows.length,
  };
}

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

function describeOpencodeStatus(status, body = "", secret = null) {
  if (status === 401) return "OpenCode rejected the saved Go key (401). Save a current key in Settings.";
  if (status === 403) return "This key has no OpenCode Go subscription (403). Check the plan or the key.";
  if (status === 429) return "OpenCode is rate-limiting usage reads (429). Try again in a minute.";
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = String(parsed?.error?.message ?? parsed?.message ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
  } catch {
    detail = String(body ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
  }
  if (secret) detail = detail.split(String(secret)).join("[redacted]");
  return `OpenCode usage could not be read (HTTP ${status})${detail ? `: ${detail}` : ""}`;
}

module.exports = { DEFAULT_LIMITS, limitsFromPlan, aggregateUsage, opencodeWindows, parseOpencodeUsage, describeOpencodeStatus };
