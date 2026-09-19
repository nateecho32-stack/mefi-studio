// Mefi's Studio AI+ — OpenCode Go catalog refresh.
//
// Merges three sources into data/models.json (the committed catalog):
//   1. Live Go roster        https://opencode.ai/zen/go/v1/models
//   2. models.dev metadata   https://models.dev/api.json  (provider "opencode-go")
//   3. Curated seed          data/curated.json            (docs pricing/limits, quality, verdicts)
//
// Curated data always wins over fetched data; fetched data fills gaps.
// Offline mode (--offline) rebuilds from the committed catalog + curated seed.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const CATALOG_PATH = path.join(DATA_DIR, "models.json");

const ROSTER_URL = "https://opencode.ai/zen/go/v1/models";
const MODELS_DEV_URL = "https://models.dev/api.json";
const PROVIDER = "opencode-go";
const FETCH_TIMEOUT_MS = 20000;

const offline = process.argv.includes("--offline");
const checkOnly = process.argv.includes("--check");

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "mefi-studio/0.1 (+catalog refresh)" },
    });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return await response.json();
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

function buildRecord(id, { curated, catalogEntry, onRoster, warnings }) {
  const seed = curated.models[id] ?? {};
  const meta = catalogRecord(catalogEntry);
  const pricing = seed.pricing ?? (meta.cost
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

async function loadCatalogFromModelsDev() {
  const api = await fetchJson(MODELS_DEV_URL);
  const provider = api?.[PROVIDER];
  if (!provider?.models) throw new Error(`models.dev has no provider ${PROVIDER}`);
  return provider.models;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const curated = JSON.parse(await readFile(path.join(DATA_DIR, "curated.json"), "utf8"));
  const warnings = [];

  let rosterIds = [];
  let catalog = {};
  let rosterOk = false;
  let catalogOk = false;

  if (offline) {
    const committed = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    rosterIds = committed.models.filter((m) => m.onRoster).map((m) => m.id);
    catalog = Object.fromEntries(
      committed.models.map((m) => [
        m.id,
        {
          name: m.name,
          family: m.vendor,
          cost: null,
          limit: m.limits,
          reasoning: m.capabilities?.reasoning,
          tool_call: m.capabilities?.toolCall,
          attachment: m.capabilities?.attachment,
          modalities: m.capabilities?.modalities,
          open_weights: m.capabilities?.openWeights,
          release_date: m.releaseDate,
          knowledge: m.knowledge,
        },
      ])
    );
    console.log(`offline: ${rosterIds.length} roster ids from the committed catalog`);
  } else {
    try {
      const roster = await fetchJson(ROSTER_URL);
      rosterIds = (roster.data ?? []).map((entry) => entry.id);
      rosterOk = true;
    } catch (error) {
      warnings.push(`live roster fetch failed: ${error.message}`);
      console.error(`! live roster fetch failed: ${error.message}`);
    }
    try {
      catalog = await loadCatalogFromModelsDev();
      catalogOk = true;
    } catch (error) {
      warnings.push(`models.dev fetch failed: ${error.message}`);
      console.error(`! models.dev fetch failed: ${error.message}`);
    }
    if (!rosterOk || !catalogOk) {
      const committed = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
      if (!rosterIds.length) rosterIds = committed.models.filter((m) => m.onRoster).map((m) => m.id);
      if (!catalogOk) {
        for (const model of committed.models) {
          catalog[model.id] ??= {
            name: model.name,
            family: model.vendor,
            limit: model.limits,
            release_date: model.releaseDate,
            knowledge: model.knowledge,
          };
        }
      }
      warnings.push("used the committed catalog as fallback for failed sources");
    }
  }

  const rosterSet = new Set(rosterIds);
  const ids = [...new Set([...rosterIds, ...Object.keys(catalog), ...Object.keys(curated.models)])].sort();
  const models = ids.map((id) => buildRecord(id, { curated, catalogEntry: catalog[id], onRoster: rosterSet.has(id), warnings }));

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
    const committed = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    if (committed.rosterHash !== document.rosterHash) {
      console.error(`roster changed:\n  catalog  ${committed.rosterHash}\n  live     ${document.rosterHash}`);
      process.exit(1);
    }
    console.log("roster unchanged");
    return;
  }

  await writeFile(CATALOG_PATH, JSON.stringify(document, null, 2) + "\n");
  console.log(`catalog updated (${models.length} models, hash ${document.hash.slice(0, 12)})`);

  const undocumented = models.filter((m) => m.onRoster && !m.listed).map((m) => m.id);
  if (undocumented.length) console.log(`roster-only models: ${undocumented.join(", ")}`);
  for (const warning of warnings) console.log(`warn: ${warning}`);
  console.log(`wrote ${path.relative(ROOT, CATALOG_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
