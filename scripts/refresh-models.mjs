// Mefi's Studio AI+ — OpenCode Go catalog refresh.
//
// Merges three sources into data/models.json (the committed catalog):
//   1. Live Go roster        https://opencode.ai/zen/go/v1/models
//   2. models.dev metadata   https://models.dev/api.json  (provider "opencode-go")
//   3. Curated seed          data/curated.json            (docs pricing/limits, quality, verdicts)
//
// Curated data always wins over fetched data; fetched data fills gaps.
// Offline mode (--offline) rebuilds from the committed catalog + curated seed.
//
// providerModels tracks the models Studio routes to outside Go (Claude Code,
// Zen's OpenAI models, the z.ai plan). curated.providerRoutes names each
// route's models.dev provider and its explicit id list; rows are rebuilt from
// models.dev, or from the committed catalog offline or when models.dev fails.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROSTER_URL = "https://opencode.ai/zen/go/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const PROVIDER = "opencode-go";
const FETCH_TIMEOUT_MS = 20000;

async function fetchJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  try {
    // Bound both the connection and body read, even if a transport ignores abort.
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { "user-agent": "mefi-studio/0.1 (+catalog refresh)" },
        });
        if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
        return response.json();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${url} timed out after ${timeoutMs} ms`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashOf(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function prettifyId(id) {
  return id
    .split("-")
    .map((part) => (part.length <= 3 && /^[a-z]+$/i.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function typicalRequestCost(typical, pricing) {
  if (!typical || !pricing) return null;
  const input = typical.input ?? 0;
  const cached = typical.cached ?? 0;
  const output = typical.output ?? 0;
  const cacheRead = pricing.cacheRead ?? pricing.input;
  return Number(
    ((input * pricing.input + cached * cacheRead + output * pricing.output) / 1e6).toFixed(6)
  );
}

function catalogRecord(entry) {
  return {
    cost: entry?.cost ?? null,
    limit: entry?.limit ?? null,
    reasoning: entry?.reasoning ?? null,
    toolCall: entry?.tool_call ?? null,
    attachment: entry?.attachment ?? null,
    modalities: entry?.modalities ?? null,
    openWeights: entry?.open_weights ?? null,
    releaseDate: entry?.release_date ?? null,
    knowledge: entry?.knowledge ?? null,
    modelsDevName: entry?.name ?? null,
    family: entry?.family ?? null,
    providerNpm: entry?.provider?.npm ?? null,
  };
}

function endpointFor(id, curated, meta) {
  const kindByModel = {};
  for (const [kind, ids] of Object.entries(curated.endpointMap ?? {})) {
    for (const modelId of ids) kindByModel[modelId] = kind;
  }
  const byNpm = {
    "@ai-sdk/openai": "openai",
    "@ai-sdk/anthropic": "anthropic",
    "@ai-sdk/openai-compatible": "compat",
  };
  const kind = kindByModel[id] ?? byNpm[meta.providerNpm] ?? null;
  if (!kind || !curated.endpoints?.[kind]) return null;
  return { kind, ...curated.endpoints[kind] };
}

function buildRecord(id, { curated, catalogEntry, previousRecord, onRoster, warnings }) {
  const seed = curated.models[id] ?? {};
  const meta = catalogRecord(catalogEntry);
  const pricing = seed.pricing ?? previousRecord?.pricing ?? (meta.cost
    ? {
        default: {
          input: meta.cost.input,
          output: meta.cost.output,
          cacheRead: meta.cost.cache_read ?? meta.cost.input,
          cacheWrite: meta.cost.cache_write ?? null,
          condition: "models.dev list price",
        },
      }
    : null);

  // A seeded legacy model leaving the roster is expected, not news.
  if (!onRoster && !seed.listed && !seed.legacy) warnings.push(`${id}: documented/known but not on the live roster`);
  if (onRoster && !seed.docsName) warnings.push(`${id}: on the live roster with no curated entry`);

  const record = {
    id,
    name: seed.docsName ?? meta.modelsDevName ?? prettifyId(id),
    vendor: seed.vendor ?? meta.family ?? "Unknown",
    onRoster,
    listed: seed.listed ?? false,
    legacy: seed.legacy ?? false,
    premium: seed.premium ?? false,
    experimental: seed.experimental ?? false,
    rosterAlias: seed.rosterAlias ?? null,
    tags: seed.tags ?? [],
    pricing,
    variants: pricing?.variants ?? [],
    typical: seed.typical ?? null,
    typicalCostUSD: typicalRequestCost(seed.typical, pricing?.default),
    limits: {
      context: meta.limit?.context ?? null,
      output: meta.limit?.output ?? null,
    },
    capabilities: {
      reasoning: meta.reasoning,
      toolCall: meta.toolCall,
      attachment: meta.attachment,
      modalities: meta.modalities,
      openWeights: meta.openWeights,
      providerNpm: meta.providerNpm,
    },
    usage: {
      monthlyCapUSD: seed.monthlyCapUSD ?? null,
      monthlyCapBaseUSD: seed.monthlyCapBaseUSD ?? null,
      promo: seed.promo ?? null,
      requests: seed.requests ?? null,
      unlimited: seed.monthlyCapUSD === "unlimited",
    },
    privacy: seed.privacy ?? null,
    quality: seed.quality ?? { index: null, declared: "none", benchmarks: [] },
    endpoint: endpointFor(id, curated, meta),
    verdict: seed.verdict ?? null,
    useFor: seed.useFor ?? [],
    avoidFor: seed.avoidFor ?? [],
    releaseDate: meta.releaseDate,
    knowledge: meta.knowledge,
  };

  if (record.quality.index != null && !["AA", "AA*"].includes(record.quality.declared)) {
    warnings.push(`${id}: quality index without a declared source`);
  }
  return record;
}

function validId(id) {
  return typeof id === "string" && id.trim().length > 0;
}

async function loadRoster(options) {
  const roster = await fetchJson(ROSTER_URL, options);
  if (!Array.isArray(roster?.data) || roster.data.some((entry) => !validId(entry?.id))) {
    throw new Error("live roster has no valid data array");
  }
  return [...new Set(roster.data.map((entry) => entry.id))];
}

async function loadCatalogFromModelsDev(options) {
  const api = await fetchJson(MODELS_DEV_URL, options);
  const models = api?.[PROVIDER]?.models;
  if (!models || typeof models !== "object" || Array.isArray(models)
    || Object.entries(models).some(([id, entry]) => !validId(id) || !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`models.dev has no valid models for provider ${PROVIDER}`);
  }
  return { models, api };
}

// ---- providerModels: Studio's routes outside Go ----

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function routesOf(curated) {
  return Object.entries(isRecord(curated.providerRoutes) ? curated.providerRoutes : {})
    .filter(([, spec]) => isRecord(spec) && validId(spec.provider) && Array.isArray(spec.ids));
}

function providerTable(api, provider) {
  const models = validId(provider) ? api?.[provider]?.models : null;
  return isRecord(models) ? models : null;
}

function reasoningEffortsOf(entry) {
  const options = Array.isArray(entry?.reasoning_options) ? entry.reasoning_options : [];
  const effort = options.find((option) => option?.type === "effort" && Array.isArray(option.values));
  return effort ? effort.values.filter((value) => typeof value === "string") : null;
}

function providerRouteRow(id, entry, priceEntry, route) {
  const cost = isRecord(priceEntry?.cost) ? priceEntry.cost : null;
  return {
    id,
    name: entry.name ?? prettifyId(id),
    family: entry.family ?? null,
    releaseDate: entry.release_date ?? null,
    knowledge: entry.knowledge ?? null,
    limits: { context: entry.limit?.context ?? null, output: entry.limit?.output ?? null },
    cost: cost ? { input: cost.input ?? null, output: cost.output ?? null, cacheRead: cost.cache_read ?? null, cacheWrite: cost.cache_write ?? null } : null,
    capabilities: {
      reasoning: entry.reasoning ?? null,
      toolCall: entry.tool_call ?? null,
      attachment: entry.attachment ?? null,
      modalities: entry.modalities ?? null,
      openWeights: entry.open_weights ?? null,
    },
    reasoningEfforts: reasoningEffortsOf(entry),
    studioRoute: route,
  };
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// `api` is the whole models.dev document, or null offline / when it failed;
// `saved` is the committed catalog's providerModels (or null).
function buildProviderModels({ curated, api, saved, now, warnings }) {
  const providerModels = {};
  const routes = {};
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 12);
  const staleBefore = yearAgo.toISOString().slice(0, 10);
  const newSince = isoDay(now - 90 * 86400000);
  if (!api && routesOf(curated).length && !isRecord(saved)) {
    warnings.push("providerModels: the committed catalog has none yet; run a live refresh");
  }
  for (const [route, spec] of routesOf(curated)) {
    const ids = [...new Set(spec.ids.filter(validId))];
    const pinned = new Set(Array.isArray(spec.pinned) ? spec.pinned : []);
    const table = api ? providerTable(api, spec.provider) : null;
    const prices = api ? providerTable(api, spec.priceProvider ?? spec.provider) : null;
    const served = api && spec.servedBy ? providerTable(api, spec.servedBy) : null;
    if (api && !table) warnings.push(`providerModels.${route}: models.dev has no provider ${spec.provider}; kept the committed rows`);
    if (api && spec.servedBy && !served) warnings.push(`providerModels.${route}: models.dev has no provider ${spec.servedBy} to confirm what the route serves`);
    const savedRows = new Map((Array.isArray(saved?.[route]) ? saved[route] : [])
      .filter((row) => isRecord(row) && validId(row.id)).map((row) => [row.id, row]));
    const rows = [];
    for (const id of ids) {
      const entry = table?.[id];
      if (isRecord(entry)) {
        if (served && !served[id]) warnings.push(`providerModels.${route}: ${id} is not listed under models.dev ${spec.servedBy}`);
        rows.push(providerRouteRow(id, entry, prices?.[id] ?? null, route));
        continue;
      }
      if (table) warnings.push(`providerModels.${route}: ${id} is not on models.dev ${spec.provider}`);
      const previous = savedRows.get(id);
      if (previous) rows.push({ ...previous, studioRoute: route });
      else if (!table && isRecord(saved)) warnings.push(`providerModels.${route}: ${id} is not in the committed catalog`);
    }
    rows.sort((a, b) => String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? "")) || a.id.localeCompare(b.id));
    for (const row of rows) {
      if (row.releaseDate && row.releaseDate < staleBefore && !pinned.has(row.id)) {
        warnings.push(`providerModels.${route}: ${row.id} (released ${row.releaseDate}) is over 12 months old; drop it from curated providerRoutes`);
      }
    }
    // Keep the explicit list honest: a recent model the provider lists (and
    // the route serves) that the seed leaves out is reported, never added.
    if (table && (!spec.servedBy || served)) {
      for (const [id, entry] of Object.entries(table)) {
        if (ids.includes(id) || !isRecord(entry) || entry.status === "deprecated" || /-\d{8}$/.test(id)) continue;
        if (served && !served[id]) continue;
        if (typeof entry.release_date === "string" && entry.release_date >= newSince) {
          warnings.push(`providerModels.${route}: models.dev ${spec.provider} lists ${id} (released ${entry.release_date}) that curated providerRoutes does not track`);
        }
      }
    }
    providerModels[route] = rows;
    routes[route] = {
      provider: spec.provider,
      priceProvider: spec.priceProvider ?? spec.provider,
      servedBy: spec.servedBy ?? null,
      count: rows.length,
      source: table ? "models.dev" : "committed",
    };
  }
  return { providerModels, routes };
}

function previousMetadata(model) {
  return {
    name: model.name,
    family: model.vendor,
    limit: model.limits,
    reasoning: model.capabilities?.reasoning,
    tool_call: model.capabilities?.toolCall,
    attachment: model.capabilities?.attachment,
    modalities: model.capabilities?.modalities,
    open_weights: model.capabilities?.openWeights,
    provider: { npm: model.capabilities?.providerNpm },
    release_date: model.releaseDate,
    knowledge: model.knowledge,
  };
}

async function replaceCatalog(catalogPath, document) {
  // A unique sibling prevents concurrent refreshes from sharing a temporary file.
  // Readers keep the last complete catalog until the fully flushed replacement is ready.
  const tempPath = `${catalogPath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    const file = await open(tempPath, "wx");
    try {
      await file.writeFile(JSON.stringify(document, null, 2) + "\n", "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tempPath, catalogPath);
        break;
      } catch (error) {
        // Windows can briefly deny replacement while the renderer reads the file.
        if (process.platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 4) throw error;
        await delay(20 * (attempt + 1));
      }
    }
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function refreshCatalog({
  root = ROOT,
  offline = false,
  checkOnly = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
  logger = console,
  now = Date.now(),
} = {}) {
  const dataDir = path.join(root, "data");
  const catalogPath = path.join(dataDir, "models.json");
  await mkdir(dataDir, { recursive: true });
  const curated = JSON.parse(await readFile(path.join(dataDir, "curated.json"), "utf8"));
  const warnings = [];

  let committed;
  async function readCommitted() {
    if (!committed) {
      committed = JSON.parse(await readFile(catalogPath, "utf8"));
      if (!Array.isArray(committed?.models) || committed.models.some((model) => !validId(model?.id))) {
        throw new Error("committed catalog has no valid models array");
      }
    }
    return committed;
  }

  let rosterIds = [];
  let catalog = {};
  let modelsDev = null;
  let previousRecords = new Map();
  let rosterOk = false;
  let catalogOk = false;

  if (offline) {
    const saved = await readCommitted();
    rosterIds = saved.models.filter((m) => m.onRoster).map((m) => m.id);
    previousRecords = new Map(saved.models.map((m) => [m.id, m]));
    catalog = Object.fromEntries(saved.models.map((m) => [m.id, previousMetadata(m)]));
    logger.log(`offline: ${rosterIds.length} roster ids from the committed catalog`);
  } else {
    const options = { fetchImpl, timeoutMs: Math.min(FETCH_TIMEOUT_MS, Math.max(1, Number(timeoutMs) || FETCH_TIMEOUT_MS)) };
    // Independent sources share one timeout window instead of adding their delays.
    const [rosterResult, catalogResult] = await Promise.allSettled([
      loadRoster(options),
      loadCatalogFromModelsDev(options),
    ]);
    if (rosterResult.status === "fulfilled") {
      rosterIds = rosterResult.value;
      rosterOk = true;
    } else {
      const error = rosterResult.reason;
      warnings.push(`live roster fetch failed: ${error.message}`);
      logger.error(`! live roster fetch failed: ${error.message}`);
    }
    if (catalogResult.status === "fulfilled") {
      catalog = catalogResult.value.models;
      modelsDev = catalogResult.value.api;
      catalogOk = true;
    } else {
      const error = catalogResult.reason;
      warnings.push(`models.dev fetch failed: ${error.message}`);
      logger.error(`! models.dev fetch failed: ${error.message}`);
    }
    if (!rosterOk || !catalogOk) {
      const saved = await readCommitted();
      if (!rosterOk) rosterIds = saved.models.filter((m) => m.onRoster).map((m) => m.id);
      if (!catalogOk) {
        previousRecords = new Map(saved.models.map((m) => [m.id, m]));
        catalog = Object.fromEntries(saved.models.map((m) => [m.id, previousMetadata(m)]));
      }
      warnings.push("used the committed catalog as fallback for failed sources");
    }
  }

  const rosterSet = new Set(rosterIds);
  const ids = [...new Set([...rosterIds, ...Object.keys(catalog), ...Object.keys(curated.models)])].sort();
  const models = ids.map((id) => buildRecord(id, {
    curated, catalogEntry: catalog[id], previousRecord: previousRecords.get(id), onRoster: rosterSet.has(id), warnings,
  }));

  // Committed rows stand in for any route models.dev could not supply.
  let savedProviderModels = null;
  if (routesOf(curated).length) {
    try {
      savedProviderModels = (await readCommitted()).providerModels ?? null;
    } catch {
      savedProviderModels = null;
    }
  }
  const provider = buildProviderModels({ curated, api: modelsDev, saved: savedProviderModels, now, warnings });

  // providerModels is in the hash: the catalog page re-renders only when the
  // hash moves, and no consumer pins the hash to the Go rows alone.
  const payload = {
    schemaVersion: curated.schemaVersion ?? 1,
    plan: curated.plan,
    taskPresets: curated.taskPresets,
    privacyScores: curated.privacyScores,
    models,
    providerModels: provider.providerModels,
  };

  const document = {
    ...payload,
    generatedAt: new Date(now).toISOString(),
    hash: hashOf(payload),
    rosterHash: hashOf([...rosterIds].sort()),
    sources: {
      roster: { url: ROSTER_URL, ok: rosterOk, count: rosterIds.length },
      catalog: { url: MODELS_DEV_URL, ok: catalogOk, provider: PROVIDER },
      providerModels: { url: MODELS_DEV_URL, ok: Boolean(modelsDev), routes: provider.routes },
      curatedSeed: curated.plan?.sources?.seedDate ?? null,
      mode: offline ? "offline" : "live",
    },
    warnings,
  };

  if (checkOnly) {
    // A failed fetch falls back to the committed roster, whose hash always
    // matches: that is no evidence the live roster is unchanged.
    if (!offline && !rosterOk) throw new Error("roster check failed: the live roster could not be fetched");
    const saved = await readCommitted();
    if (saved.rosterHash !== document.rosterHash) {
      throw new Error(`roster changed:\n  catalog  ${saved.rosterHash}\n  live     ${document.rosterHash}`);
    }
    logger.log("roster unchanged");
    return document;
  }

  await replaceCatalog(catalogPath, document);
  logger.log(`catalog updated (${models.length} models, hash ${document.hash.slice(0, 12)})`);
  const routeCounts = Object.entries(provider.routes).map(([route, info]) => `${route} ${info.count} (${info.source})`);
  if (routeCounts.length) logger.log(`providerModels: ${routeCounts.join(", ")}`);

  const undocumented = models.filter((m) => m.onRoster && !m.listed).map((m) => m.id);
  if (undocumented.length) logger.log(`roster-only models: ${undocumented.join(", ")}`);
  for (const warning of warnings) logger.log(`warn: ${warning}`);
  logger.log(`wrote ${path.relative(root, catalogPath)}`);
  return document;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshCatalog({ offline: process.argv.includes("--offline"), checkOnly: process.argv.includes("--check") })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
