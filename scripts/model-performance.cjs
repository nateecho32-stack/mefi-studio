"use strict";

// Local, measured evidence only. This module never calls a provider, selects an
// account, or persists prompts/results/credentials. The host supplies observed
// outcomes; a successful transport is not a quality rating or a verified task.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const VERSION = 1;
const EFFORT_LEVELS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const ERROR_KINDS = new Set(["transport", "timeout", "quota", "auth", "http", "empty", "invalid", "validation", "reasoning", "tool", "verification", "unknown"]);
const TOKEN_FIELDS = ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"];
const locks = new Map();
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const clip = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
const number = (value, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const integer = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const effort = (value) => EFFORT_LEVELS.includes(value) ? value : null;
const slug = (value, fallback = "unknown") => clip(value, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
const keyOf = (provider, model) => `${provider}::${model}`;

function identifier(value, name, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new TypeError(`Invalid ${name}`);
  return value.trim();
}

function normalizeObservation(input, now = Date.now()) {
  if (!object(input)) throw new TypeError("An observation is required");
  if (!["ok", "error", "cancelled"].includes(input.status)) throw new TypeError("Invalid observation status");
  const tokenUsage = {};
  for (const field of TOKEN_FIELDS) tokenUsage[field] = integer(input.tokenUsage?.[field]);
  const elapsedMs = number(input.elapsedMs, 86400000);
  const reportedFirst = number(input.firstTokenMs, 86400000);
  return {
    id: identifier(input.id, "observation id"),
    at: number(input.at) ?? now,
    provider: identifier(input.provider, "provider", 60),
    model: identifier(input.model, "model"),
    taskType: slug(input.taskType),
    role: input.role ? slug(input.role) : null,
    source: ["request", "planning", "demo", "probe", "worker"].includes(input.source) ? input.source : "request",
    status: input.status,
    errorKind: input.status === "error" ? ERROR_KINDS.has(input.errorKind) ? input.errorKind : "unknown" : null,
    elapsedMs,
    firstTokenMs: reportedFirst !== null && (elapsedMs === null || reportedFirst <= elapsedMs) ? reportedFirst : null,
    tokenUsage,
    costUsd: number(input.costUsd),
    requestedEffort: effort(input.requestedEffort),
    appliedEffort: effort(input.appliedEffort),
    escalationOf: input.escalationOf ? identifier(input.escalationOf, "escalation id") : null,
    escalationReason: ["reasoning", "validation"].includes(input.escalationReason) ? input.escalationReason : null,
    comparisonId: input.comparisonId ? identifier(input.comparisonId, "comparison id") : null,
    // The attempt this call belongs to, when one was in scope. It is what
    // joins Studio's own calls to a task: the worker's turns are keyed by
    // session in OpenCode's store, and these are keyed by run.
    runId: input.runId ? identifier(input.runId, "run id") : null,
  };
}

function normalizeRating(input, now = Date.now()) {
  if (!object(input) || !["human", "model"].includes(input.authority)) throw new TypeError("Rating authority must be human or model");
  const score = number(input.score, 5);
  if (score === null) throw new TypeError("Rating score must be between 0 and 5");
  return {
    observationId: identifier(input.observationId, "observation id"),
    authority: input.authority,
    score,
    at: number(input.at) ?? now,
    judgeModel: input.authority === "model" ? identifier(input.judgeModel, "judge model") : null,
    judgeProvider: input.authority === "model" && input.judgeProvider ? identifier(input.judgeProvider, "judge provider", 60) : null,
    note: clip(input.note, 240),
  };
}

const ratingKey = (rating) => JSON.stringify([rating.observationId, rating.authority, rating.judgeProvider, rating.judgeModel]);
function selectEffort({ supportedEfforts = [] } = {}) {
  return EFFORT_LEVELS.find((level) => Array.isArray(supportedEfforts) && supportedEfforts.includes(level)) ?? null;
}
function nextEffort({ supportedEfforts = [], currentEffort = null, feedback = null, escalations = 0, maxEscalations = 2 } = {}) {
  const supported = EFFORT_LEVELS.filter((level) => Array.isArray(supportedEfforts) && supportedEfforts.includes(level));
  const current = supported.includes(currentEffort) ? currentEffort : null;
  const stay = (reason) => ({ effort: current, escalate: false, reason });
  if (!current) return stay("unsupported-effort");
  const kind = typeof feedback === "string" ? feedback : feedback?.kind;
  if (!["reasoning", "validation"].includes(kind)) return stay("feedback-does-not-justify-effort");
  const limit = Math.min(5, integer(maxEscalations) ?? 2);
  if ((integer(escalations) ?? 0) >= limit) return stay("escalation-limit");
  const next = supported[supported.indexOf(current) + 1];
  return next ? { effort: next, escalate: true, reason: kind } : stay("highest-supported-effort");
}

function stats(values) {
  const data = values.filter((value) => number(value) !== null).sort((a, b) => a - b);
  const percentile = (fraction) => data.length ? data[Math.max(0, Math.ceil(data.length * fraction) - 1)] : null;
  return { count: data.length, mean: data.length ? data.reduce((sum, value) => sum + value, 0) / data.length : null, p50: percentile(0.5), p95: percentile(0.95) };
}
function usageOf(rows) {
  const field = (get) => {
    const known = rows.map(get).filter((value) => number(value) !== null);
    return { known: known.length ? known.reduce((sum, value) => sum + value, 0) : null, knownRecords: known.length, unknownRecords: rows.length - known.length };
  };
  return Object.fromEntries([...TOKEN_FIELDS.map((key) => [key, field((row) => row.tokenUsage?.[key])]), ["costUsd", field((row) => row.costUsd)]]);
}
function rangeOf(rows) {
  return { from: rows.length ? Math.min(...rows.map((row) => row.at)) : null, to: rows.length ? Math.max(...rows.map((row) => row.at)) : null };
}
function qualityOf(rows, ratings, authority) {
  const scores = [];
  for (const row of rows) {
    const entries = (ratings.get(row.id) ?? []).filter((rating) => rating.authority === authority);
    if (entries.length) scores.push(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length);
  }
  return { count: scores.length, mean: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null };
}
function measurements(rows, ratings) {
  const complete = rows.filter((row) => row.status !== "cancelled");
  const successes = rows.filter((row) => row.status === "ok");
  const errors = rows.filter((row) => row.status === "error");
  return {
    samples: rows.length, successes: successes.length, errors: errors.length, cancelled: rows.length - complete.length,
    errorRate: complete.length ? errors.length / complete.length : null,
    latencyMs: stats(successes.map((row) => row.elapsedMs)),
    firstTokenMs: stats(successes.map((row) => row.firstTokenMs)),
    // Non-streamed throughput includes request latency; it is not generation-only speed.
    throughput: stats(successes.map((row) => row.elapsedMs > 0 && row.tokenUsage.outputTokens !== null ? row.tokenUsage.outputTokens * 1000 / row.elapsedMs : null)),
    costUsd: stats(rows.map((row) => row.costUsd)),
    quality: { human: qualityOf(rows, ratings, "human"), model: qualityOf(rows, ratings, "model") },
    usage: usageOf(rows), range: rangeOf(rows),
  };
}

function snapshotPerformance(state, { taskType = null, candidates = null, qualitySource = "human", weights = {}, now = Date.now() } = {}) {
  const filter = taskType ? slug(taskType) : null;
  const observations = (state?.observations ?? []).filter((row) => !filter || row.taskType === filter);
  const ratings = new Map();
  for (const row of state?.ratings ?? []) {
    if (!ratings.has(row.observationId)) ratings.set(row.observationId, []);
    ratings.get(row.observationId).push(row);
  }
  const identities = new Map();
  for (const item of Array.isArray(candidates) ? candidates : observations) {
    if (!item?.provider || !item?.model) continue;
    const provider = identifier(item.provider, "provider", 60), model = identifier(item.model, "model");
    identities.set(keyOf(provider, model), { provider, model });
  }
  // Partition once rather than scanning the complete ledger for every model,
  // then scanning each model again for every task and effort combination.
  const grouped = new Map();
  for (const row of observations) {
    const key = keyOf(row.provider, row.model);
    if (!identities.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, { rows: [], tasks: new Map(), efforts: new Map() });
    const group = grouped.get(key);
    group.rows.push(row);
    if (!group.tasks.has(row.taskType)) group.tasks.set(row.taskType, []);
    group.tasks.get(row.taskType).push(row);
    const effortKey = JSON.stringify([row.requestedEffort, row.appliedEffort]);
    if (!group.efforts.has(effortKey)) group.efforts.set(effortKey, []);
    group.efforts.get(effortKey).push(row);
  }
  const models = [...identities].map(([key, identity]) => {
    const group = grouped.get(key), rows = group?.rows ?? [];
    const taskStrengths = [...(group?.tasks ?? [])].map(([taskType, entries]) => ({ taskType, ...measurements(entries, ratings) }));
    const efforts = [...(group?.efforts ?? [])].map(([, entries]) => ({ requestedEffort: entries[0].requestedEffort, appliedEffort: entries[0].appliedEffort, ...measurements(entries, ratings) }));
    return { key, ...identity, ...measurements(rows, ratings), taskStrengths, efforts, score: null, rank: null, evidence: rows.length >= 3 ? "observed" : rows.length ? "limited" : "unobserved" };
  });
  const authority = qualitySource === "model" ? "model" : "human";
  const defaults = { quality: 0.45, speed: 0.25, reliability: 0.2, cost: 0.1 };
  const metricWeights = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, number(weights?.[key], 1) ?? fallback]));
  const valueOf = {
    quality: (row) => row.quality[authority].mean,
    speed: (row) => row.latencyMs.p50,
    reliability: (row) => row.errorRate,
    // Partial known costs are displayed but cannot pretend to describe all calls.
    cost: (row) => row.usage.costUsd.unknownRecords === 0 ? row.costUsd.mean : null,
  };
  const measured = models.filter((row) => row.successes + row.errors > 0);
  // Rank on the same dimensions for every observed model. Otherwise missing
  // ratings or unknown billing could accidentally become an advantage.
  const metrics = Object.keys(defaults).filter((key) => metricWeights[key] > 0 && measured.length && measured.every((row) => valueOf[key](row) !== null));
  const weight = metrics.reduce((sum, key) => sum + metricWeights[key], 0);
  const bounds = Object.fromEntries(metrics.filter((key) => key === "speed" || key === "cost").map((key) => {
    const values = measured.map(valueOf[key]);
    return [key, { low: Math.min(...values), high: Math.max(...values) }];
  }));
  for (const row of measured) {
    if (!weight) continue;
    const score = metrics.reduce((sum, key) => {
      const value = valueOf[key](row);
      let normalized;
      if (key === "quality") normalized = value / 5;
      else if (key === "reliability") normalized = 1 - value;
      else {
        const { low, high } = bounds[key];
        normalized = low === high ? 0.5 : (high - value) / (high - low);
      }
      return sum + normalized * metricWeights[key];
    }, 0) / weight;
    row.score = Math.round(score * 1000) / 10;
  }
  models.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.samples - a.samples || a.key.localeCompare(b.key));
  let rank = 0, previous = null;
  models.forEach((row, index) => { if (row.score !== null) { if (row.score !== previous) rank = index + 1; row.rank = rank; previous = row.score; } });
  return {
    version: VERSION, generatedAt: now, taskType: filter, calls: observations.length, range: rangeOf(observations), usage: usageOf(observations),
    lifetime: state?.lifetime ?? { calls: observations.length, range: rangeOf(observations), usage: usageOf(observations) },
    retention: { limit: state?.retention?.limit ?? null, dropped: state?.retention?.dropped ?? 0 },
    ranking: { qualitySource: authority, metrics, weights: metricWeights, notes: ["Measured local runs; task mix may differ.", "Unknown dimensions are excluded from every model's score.", "Throughput includes request latency; quality is explicitly rated."] },
    models,
    recent: observations.slice().sort((a, b) => b.at - a.at).slice(0, 50).map((row) => ({ ...row, ratings: { human: (ratings.get(row.id) ?? []).filter((rating) => rating.authority === "human"), model: (ratings.get(row.id) ?? []).filter((rating) => rating.authority === "model") } })),
  };
}

function addLifetime(lifetime, row) {
  const one = usageOf([row]);
  return {
    calls: lifetime.calls + 1,
    range: { from: lifetime.range.from === null ? row.at : Math.min(lifetime.range.from, row.at), to: lifetime.range.to === null ? row.at : Math.max(lifetime.range.to, row.at) },
    usage: Object.fromEntries(Object.entries(one).map(([key, value]) => {
      const old = lifetime.usage[key];
      const knownRecords = old.knownRecords + value.knownRecords;
      return [key, { known: knownRecords ? (old.known ?? 0) + (value.known ?? 0) : null, knownRecords, unknownRecords: old.unknownRecords + value.unknownRecords }];
    })),
  };
}

function normalizeLifetime(input) {
  const fail = () => { throw new Error("Invalid usage totals in the model performance ledger"); };
  if (!object(input) || integer(input.calls) === null || !object(input.range) || !object(input.usage)) fail();
  const from = number(input.range.from), to = number(input.range.to);
  if (input.calls ? from === null || to === null || from > to : input.range.from !== null || input.range.to !== null) fail();
  const usage = {};
  for (const key of [...TOKEN_FIELDS, "costUsd"]) {
    const entry = input.usage[key];
    if (!object(entry) || integer(entry.knownRecords) === null || integer(entry.unknownRecords) === null || entry.knownRecords + entry.unknownRecords !== input.calls) fail();
    if (entry.knownRecords ? number(entry.known) === null : entry.known !== null) fail();
    usage[key] = { known: entry.known, knownRecords: entry.knownRecords, unknownRecords: entry.unknownRecords };
  }
  return { calls: input.calls, range: { from, to }, usage };
}

function createModelPerformanceStore({ filePath, now = Date.now, maxRecords = 10000 } = {}) {
  const file = path.resolve(identifier(filePath, "performance file", 2000));
  const limit = Math.max(1, Math.min(50000, integer(maxRecords) ?? 10000));
  const empty = () => ({ version: VERSION, observations: [], ratings: [], retention: { limit, dropped: 0 }, lifetime: { calls: 0, range: { from: null, to: null }, usage: usageOf([]) } });
  let cached = null;
  const snapshots = new Map();
  const invalidate = () => { cached = null; snapshots.clear(); };
  // Checking metadata on every operation also notices another store instance,
  // replacement, deletion and same-length edits without a polling delay.
  const revision = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  const serialized = (run) => {
    const result = (locks.get(file) ?? Promise.resolve()).then(run);
    const settled = result.then(() => {}, () => {});
    locks.set(file, settled);
    settled.then(() => { if (locks.get(file) === settled) locks.delete(file); });
    return result;
  };
  async function load({ mutable = false } = {}) {
    let raw, before;
    try {
      before = revision(await fs.stat(file, { bigint: true }));
      if (cached?.revision === before) return mutable ? copy(cached.state) : cached.state;
      invalidate();
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    }
    catch (error) { invalidate(); if (error.code === "ENOENT") return empty(); throw new Error("Could not read the model performance ledger; existing data was preserved", { cause: error }); }
    if (raw?.version !== VERSION || !Array.isArray(raw.observations) || !Array.isArray(raw.ratings)) throw new Error("Unsupported model performance ledger; existing data was preserved");
    const observations = raw.observations.map((row) => normalizeObservation(row, 0));
    const ids = new Set(observations.map((row) => row.id));
    if (ids.size !== observations.length) throw new Error("Duplicate observation ids in the model performance ledger");
    const ratings = raw.ratings.map((row) => normalizeRating(row, 0)).filter((row) => ids.has(row.observationId));
    const lifetime = normalizeLifetime(raw.lifetime ?? { calls: observations.length, range: rangeOf(observations), usage: usageOf(observations) });
    if (lifetime.calls < observations.length) throw new Error("Invalid retained model performance counts");
    const state = { version: VERSION, observations, ratings, retention: { limit, dropped: integer(raw.retention?.dropped) ?? 0 }, lifetime };
    // Do not associate a read with metadata from a concurrent external rewrite.
    try { if (!mutable && revision(await fs.stat(file, { bigint: true })) === before) cached = { revision: before, state }; }
    catch { /* The next operation retries a fresh read. */ }
    return state;
  }
  async function save(state) {
    invalidate();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try { await fs.writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  return {
    read: () => serialized(async () => copy(await load())),
    snapshot: (options = {}) => serialized(async () => {
      const state = await load();
      const generatedAt = now();
      // The UI uses these two filters. Keep at most eight summaries; callers
      // requesting custom candidate sets or weights still get a fresh result.
      const key = options.candidates == null && options.weights == null ? JSON.stringify([options.taskType ? slug(options.taskType) : null, options.qualitySource === "model" ? "model" : "human"]) : null;
      let result = key === null ? null : snapshots.get(key);
      if (!result) result = snapshotPerformance(state, { ...options, now: generatedAt });
      if (key !== null && cached?.state === state) {
        snapshots.delete(key);
        snapshots.set(key, result);
        if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
      }
      return { ...copy(result), generatedAt };
    }),
    record: (input) => serialized(async () => {
      const state = await load({ mutable: true });
      const existing = input?.id ? state.observations.find((row) => row.id === input.id) : null;
      const observation = normalizeObservation({ ...input, id: input?.id ?? randomUUID(), at: input?.at ?? existing?.at ?? now() }, now());
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(observation)) throw new Error("An observation id cannot be reused for different measurements");
        return { observation: copy(existing), duplicate: true };
      }
      state.observations.push(observation);
      state.lifetime = addLifetime(state.lifetime, observation);
      if (state.observations.length > limit) {
        state.retention.dropped += state.observations.length - limit;
        state.observations = state.observations.slice(-limit);
        const kept = new Set(state.observations.map((row) => row.id));
        state.ratings = state.ratings.filter((row) => kept.has(row.observationId));
      }
      await save(state);
      return { observation: copy(observation), duplicate: false };
    }),
    rate: (input) => serialized(async () => {
      const state = await load({ mutable: true });
      const rating = normalizeRating(input, now());
      if (!state.observations.some((row) => row.id === rating.observationId)) throw new Error("That observation is no longer available for rating");
      const index = state.ratings.findIndex((row) => ratingKey(row) === ratingKey(rating));
      if (index >= 0) state.ratings[index] = rating;
      else {
        if (state.ratings.filter((row) => row.observationId === rating.observationId).length >= 10) throw new Error("This observation already has ten separate ratings");
        state.ratings.push(rating);
      }
      await save(state);
      return { rating: copy(rating), updated: index >= 0 };
    }),
  };
}

module.exports = { VERSION, EFFORT_LEVELS, normalizeObservation, normalizeRating, selectEffort, nextEffort, snapshotPerformance, createModelPerformanceStore };
