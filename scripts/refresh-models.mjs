// Mefi's Studio AI+ — OpenCode Go catalog refresh.
//
// Merges three sources into data/models.json (the committed catalog):
//   1. Live Go roster        https://opencode.ai/zen/go/v1/models
//   2. models.dev metadata   https://models.dev/api.json  (provider "opencode-go")
//   3. Curated seed          data/curated.json            (docs pricing/limits, quality, verdicts)
//
// Curated data always wins over fetched data; fetched data fills gaps.
// Offline mode (--offline) rebuilds from the committed catalog + curated seed.

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

  if (!onRoster && !seed.listed) warnings.push(`${id}: documented/known but not on the live roster`);
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
  return models;
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
      catalog = catalogResult.value;
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

  const payload = {
    schemaVersion: curated.schemaVersion ?? 1,
    plan: curated.plan,
    taskPresets: curated.taskPresets,
    privacyScores: curated.privacyScores,
    models,
  };

  const document = {
    ...payload,
    generatedAt: new Date().toISOString(),
    hash: hashOf(payload),
    rosterHash: hashOf([...rosterIds].sort()),
    sources: {
      roster: { url: ROSTER_URL, ok: rosterOk, count: rosterIds.length },
      catalog: { url: MODELS_DEV_URL, ok: catalogOk, provider: PROVIDER },
      curatedSeed: curated.plan?.sources?.seedDate ?? null,
      mode: offline ? "offline" : "live",
    },
    warnings,
  };

  if (checkOnly) {
    const saved = await readCommitted();
    if (saved.rosterHash !== document.rosterHash) {
      throw new Error(`roster changed:\n  catalog  ${saved.rosterHash}\n  live     ${document.rosterHash}`);
    }
    logger.log("roster unchanged");
    return document;
  }

  await replaceCatalog(catalogPath, document);
  logger.log(`catalog updated (${models.length} models, hash ${document.hash.slice(0, 12)})`);

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
