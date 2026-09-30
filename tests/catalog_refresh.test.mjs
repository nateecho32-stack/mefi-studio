import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshCatalog } from "../scripts/refresh-models.mjs";

const logger = { log() {}, error() {} };
const rosterUrl = "https://opencode.ai/zen/go/v1/models";
const metadataUrl = "https://models.dev/api.json";
const savedModel = {
  id: "known-model",
  name: "Known Model",
  vendor: "Test vendor",
  onRoster: true,
  pricing: {
    default: { input: 1.5, output: 6, cacheRead: 0, cacheWrite: 2, condition: "Cached source price" },
    variants: [{ name: "large context", input: 3, output: 12 }],
  },
  limits: { context: 200000, output: 16000 },
  capabilities: {
    reasoning: true, toolCall: true, attachment: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    openWeights: false, providerNpm: "@ai-sdk/openai-compatible",
  },
  releaseDate: "2026-01-01",
  knowledge: "2025-12",
};
const liveMetadata = {
  name: "Fresh Model", family: "New vendor", cost: { input: 3, output: 9, cache_read: 0 },
  limit: { context: 300000, output: 24000 }, reasoning: false, tool_call: true,
  attachment: true, modalities: { input: ["text", "image"], output: ["text"] },
  open_weights: true, provider: { npm: "@ai-sdk/openai-compatible" },
  release_date: "2026-03-01", knowledge: "2026-02",
};

async function fixture(t, { models = [savedModel], curatedModels = {}, curatedExtra = {}, savedExtra = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "catalog-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const curated = {
    schemaVersion: 1, plan: { name: "Fixture", sources: { seedDate: "2026-01-01" } },
    taskPresets: [], privacyScores: {}, models: curatedModels,
    endpoints: { compat: { label: "Fixture compatibility endpoint", path: "https://invalid.test/v1" } },
    endpointMap: {}, ...curatedExtra,
  };
  const catalogPath = path.join(dataDir, "models.json");
  await writeFile(path.join(dataDir, "curated.json"), JSON.stringify(curated));
  await writeFile(catalogPath, JSON.stringify({ models, hash: "old-hash", rosterHash: "old-roster-hash", ...savedExtra }));
  return { root, dataDir, catalogPath, curated };
}

function response(value) { return { ok: true, json: async () => value }; }
function sources({ roster = ["known-model"], metadata = { "known-model": liveMetadata } } = {}) {
  return async (url) => {
    assert.ok([rosterUrl, metadataUrl].includes(url));
    return response(url === rosterUrl ? { data: roster.map((id) => ({ id })) } : { "opencode-go": { models: metadata } });
  };
}

function assertCachedMetadata(model) {
  assert.equal(model.name, savedModel.name);
  assert.equal(model.vendor, savedModel.vendor);
  assert.deepEqual(model.pricing, savedModel.pricing);
  assert.deepEqual(model.variants, savedModel.pricing.variants);
  assert.deepEqual(model.limits, savedModel.limits);
  assert.deepEqual(model.capabilities, savedModel.capabilities);
  assert.equal(model.releaseDate, savedModel.releaseDate);
  assert.equal(model.knowledge, savedModel.knowledge);
  assert.equal(model.endpoint.kind, "compat");
}

test("refresh starts both independent sources before either response completes", async (t) => {
  const f = await fixture(t);
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, options) => {
    started.push(url);
    assert.equal(options.signal.aborted, false);
    if (started.length === 2) release();
    await gate;
    return sources()(url);
  };
  const result = await refreshCatalog({ root: f.root, fetchImpl, logger, timeoutMs: 1000 });
  assert.deepEqual(started, [rosterUrl, metadataUrl]);
  assert.equal(result.sources.roster.ok, true);
  assert.equal(result.sources.catalog.ok, true);
  assert.equal(result.models[0].name, "Fresh Model");
  assert.equal(result.models[0].pricing.default.cacheRead, 0);
  assert.deepEqual(JSON.parse(await readFile(f.catalogPath, "utf8")), result);
});

test("catalog token limits reject malformed metadata and preserve numeric controls", async (t) => {
  const values = ["<img src=x onerror=alert(1)>", "200000", { tokens: 200000 }, [200000], true, -1, Infinity, NaN];
  const metadata = Object.fromEntries(values.map((value, index) => [`invalid-${index}`, { ...liveMetadata, limit: { context: value, output: value } }]));
  metadata.control = { ...liveMetadata, limit: { context: 200000, output: 0 } };
  metadata.zero = { ...liveMetadata, limit: { context: 0, output: 16000 } };
  const f = await fixture(t, { models: [] });
  const result = await refreshCatalog({ root: f.root, logger, fetchImpl: sources({ roster: Object.keys(metadata), metadata }) });
  assert.deepEqual(result.models.find((model) => model.id === "control").limits, { context: 200000, output: 0 });
  assert.deepEqual(result.models.find((model) => model.id === "zero").limits, { context: 0, output: 16000 });
  for (let index = 0; index < values.length; index++) {
    assert.deepEqual(result.models.find((model) => model.id === `invalid-${index}`).limits, { context: null, output: null });
    for (const field of ["context", "output"]) assert.ok(result.warnings.some((warning) => warning.includes(`invalid-${index}`) && warning.includes(field) && warning.includes("finite nonnegative number")));
  }
  assert.deepEqual(JSON.parse(await readFile(f.catalogPath, "utf8")).models.map((model) => model.limits), result.models.map((model) => model.limits));
});

test("offline and failed-source rebuilds discard malformed cached token limits", async (t) => {
  for (const offline of [true, false]) {
    await t.test(offline ? "offline" : "failed metadata", async (t) => {
      const unsafe = { ...savedModel, id: "unsafe", limits: { context: "<svg onload=alert(1)>", output: { tokens: 16000 } } };
      const f = await fixture(t, { models: [savedModel, unsafe] });
      const result = await refreshCatalog({ root: f.root, offline, logger, fetchImpl: async (url) => {
        if (offline) assert.fail("offline refresh must not fetch");
        if (url === metadataUrl) throw new Error("fixture offline");
        return response({ data: [{ id: savedModel.id }, { id: unsafe.id }] });
      } });
      assertCachedMetadata(result.models.find((model) => model.id === savedModel.id));
      assert.deepEqual(result.models.find((model) => model.id === unsafe.id).limits, { context: null, output: null });
      assert.ok(result.warnings.some((warning) => warning.includes("unsafe") && warning.includes("context")));
      assert.ok(result.warnings.some((warning) => warning.includes("unsafe") && warning.includes("output")));
    });
  }
});

test("offline rebuild preserves known prices, variants, capabilities and provider endpoints", async (t) => {
  const f = await fixture(t);
  const result = await refreshCatalog({
    root: f.root, offline: true, logger,
    fetchImpl() { assert.fail("offline refresh must not make network requests"); },
  });
  assertCachedMetadata(result.models[0]);
  assert.equal(result.sources.mode, "offline");
  assert.equal(result.models[0].onRoster, true);
  const again = await refreshCatalog({ root: f.root, offline: true, logger });
  assert.equal(again.hash, result.hash, "repeated offline refreshes retain the complete payload");
});

test("failed metadata preserves the cache while a successful roster applies additions/removals", async (t) => {
  const f = await fixture(t);
  const result = await refreshCatalog({ root: f.root, logger, fetchImpl: async (url) => {
    if (url === metadataUrl) throw new Error("fixture offline");
    return response({ data: [{ id: "new-model" }] });
  } });
  assertCachedMetadata(result.models.find((m) => m.id === "known-model"));
  assert.equal(result.models.find((m) => m.id === "known-model").onRoster, false);
  assert.equal(result.models.find((m) => m.id === "new-model").onRoster, true);
  assert.equal(result.models.find((m) => m.id === "new-model").pricing, null);
  assert.equal(result.sources.roster.ok, true);
  assert.equal(result.sources.catalog.ok, false);
  assert.ok(result.warnings.some((warning) => warning.includes("used the committed catalog")));
});

test("failed roster uses cached membership and fresh metadata prices", async (t) => {
  const f = await fixture(t);
  const result = await refreshCatalog({ root: f.root, logger, fetchImpl: async (url) => {
    if (url === rosterUrl) return { ok: false, status: 503 };
    return sources()(url);
  } });
  assert.equal(result.models[0].onRoster, true);
  assert.equal(result.models[0].name, "Fresh Model");
  assert.equal(result.models[0].pricing.default.input, 3);
  assert.equal(result.models[0].capabilities.reasoning, false);
  assert.equal(result.sources.roster.ok, false);
  assert.equal(result.sources.catalog.ok, true);
});

test("curated overrides still win when rebuilding from cached metadata", async (t) => {
  const price = { default: { input: 2, output: 8, cacheRead: 0 } };
  const f = await fixture(t, { curatedModels: {
    "known-model": { docsName: "Curated name", pricing: price, typical: { input: 1000, cached: 1000, output: 500 } },
  } });
  const result = await refreshCatalog({ root: f.root, offline: true, logger });
  assert.equal(result.models[0].name, "Curated name");
  assert.deepEqual(result.models[0].pricing, price);
  assert.equal(result.models[0].typicalCostUSD, 0.006);
});

test("a valid empty roster stays empty when metadata fails", async (t) => {
  const f = await fixture(t);
  const result = await refreshCatalog({ root: f.root, logger, fetchImpl: async (url) => {
    if (url === metadataUrl) throw new Error("fixture offline");
    return response({ data: [] });
  } });
  assert.equal(result.sources.roster.ok, true);
  assert.equal(result.sources.roster.count, 0);
  assert.equal(result.models[0].onRoster, false);
});

test("malformed successful responses fall back without erasing existing metadata", async (t) => {
  for (const [name, roster, models] of [
    ["missing fields", {}, null],
    ["wrong containers", { data: {} }, []],
    ["invalid entries", { data: [{ id: null }] }, { invalid: null }],
  ]) {
    await t.test(name, async (t) => {
      const f = await fixture(t);
      const result = await refreshCatalog({ root: f.root, logger, fetchImpl: async (url) =>
        response(url === rosterUrl ? roster : { "opencode-go": { models } }),
      });
      assert.equal(result.sources.roster.ok, false);
      assert.equal(result.sources.catalog.ok, false);
      assert.equal(result.models[0].onRoster, true);
      assertCachedMetadata(result.models[0]);
    });
  }
});

test("timeouts bound both pending connection and body reads, and abort both sources", async (t) => {
  const f = await fixture(t);
  const signals = [];
  const result = await refreshCatalog({ root: f.root, logger, timeoutMs: 20, fetchImpl: (url, { signal }) => {
    signals.push(signal);
    // Deliberately ignore abort: the refresh still must return the saved catalog.
    if (url === rosterUrl) return new Promise(() => {});
    return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
  } });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(result.sources.roster.ok, false);
  assert.equal(result.sources.catalog.ok, false);
  assert.equal(result.warnings.filter((warning) => warning.includes("timed out after 20 ms")).length, 2);
  assertCachedMetadata(result.models[0]);
});

test("atomic replacement preserves the previous catalog while a reader holds it open", async (t) => {
  const f = await fixture(t);
  const oldText = await readFile(f.catalogPath, "utf8");
  const reader = await open(f.catalogPath, "r");
  try {
    if (process.platform === "win32") {
      await assert.rejects(refreshCatalog({ root: f.root, logger, fetchImpl: sources() }), { code: "EPERM" });
      assert.equal(await readFile(f.catalogPath, "utf8"), oldText);
    } else {
      const result = await refreshCatalog({ root: f.root, logger, fetchImpl: sources() });
      assert.deepEqual(JSON.parse(await readFile(f.catalogPath, "utf8")), result);
    }
    assert.equal(await reader.readFile("utf8"), oldText, "the old inode must not be overwritten in place");
    assert.deepEqual((await readdir(f.dataDir)).sort(), ["curated.json", "models.json"]);
  } finally {
    await reader.close();
  }
  const result = await refreshCatalog({ root: f.root, logger, fetchImpl: sources() });
  assert.deepEqual(JSON.parse(await readFile(f.catalogPath, "utf8")), result);
});

test("replacement recovers when a short-lived Windows reader releases the file", { skip: process.platform !== "win32" }, async (t) => {
  const f = await fixture(t);
  const reader = await open(f.catalogPath, "r");
  let closed;
  const release = new Promise((resolve, reject) => {
    closed = setTimeout(() => reader.close().then(resolve, reject), 60);
  });
  try {
    const result = await refreshCatalog({ root: f.root, logger, fetchImpl: sources() });
    await release;
    assert.deepEqual(JSON.parse(await readFile(f.catalogPath, "utf8")), result);
    assert.deepEqual((await readdir(f.dataDir)).sort(), ["curated.json", "models.json"]);
  } finally {
    clearTimeout(closed);
    await reader.close();
  }
});

test("failed replacement removes its temporary file and leaves the destination intact", async (t) => {
  const f = await fixture(t);
  await rm(f.catalogPath);
  await mkdir(f.catalogPath);
  await writeFile(path.join(f.catalogPath, "keep.txt"), "untouched");
  await assert.rejects(refreshCatalog({ root: f.root, logger, fetchImpl: sources() }));
  assert.equal(await readFile(path.join(f.catalogPath, "keep.txt"), "utf8"), "untouched");
  assert.deepEqual((await readdir(f.dataDir)).sort(), ["curated.json", "models.json"]);
});

test("roster checks never write, deduplicate ids and report actual membership changes", async (t) => {
  const f = await fixture(t);
  const initial = await refreshCatalog({ root: f.root, logger, fetchImpl: sources() });
  const saved = await readFile(f.catalogPath, "utf8");
  const unchanged = await refreshCatalog({ root: f.root, logger, checkOnly: true,
    fetchImpl: sources({ roster: ["known-model", "known-model"] }),
  });
  assert.equal(unchanged.rosterHash, initial.rosterHash);
  assert.equal(unchanged.sources.roster.count, 1);
  assert.equal(await readFile(f.catalogPath, "utf8"), saved);
  await assert.rejects(refreshCatalog({ root: f.root, logger, checkOnly: true,
    fetchImpl: sources({ roster: ["new-model"] }),
  }), /roster changed/);
  assert.equal(await readFile(f.catalogPath, "utf8"), saved);
});

// ---- providerModels: the routes Studio uses outside Go ----

// Trimmed models.dev entries recorded on 2026-09-28; no test touches the network.
const recorded = JSON.parse(await readFile(new URL("./fixtures/models-dev-routes.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-09-28T12:00:00Z");
const providerRoutes = {
  note: "fixture",
  claude: { label: "Claude Code", provider: "anthropic", priceProvider: "anthropic", pinned: ["claude-opus-5-5"], ids: ["claude-opus-5-5", "claude-sonnet-4-5", "claude-gone-1"] },
  zen: { label: "OpenCode Zen", provider: "openai", priceProvider: "opencode", servedBy: "opencode", pinned: ["gpt-6-luna"], ids: ["gpt-6-luna", "gpt-5.6"] },
  zai: { label: "z.ai Coding Plan", provider: "zai-coding-plan", priceProvider: "zai", ids: ["glm-5.3", "glm-5.3-highspeed"] },
};
function routeSources(api = recorded) {
  return async (url) => {
    assert.ok([rosterUrl, metadataUrl].includes(url));
    if (url === rosterUrl) return response({ data: [{ id: "known-model" }] });
    return response({ ...api, "opencode-go": { models: { "known-model": liveMetadata } } });
  };
}
const routeWarnings = (result) => result.warnings.filter((warning) => warning.startsWith("providerModels"));

test("providerModels rebuilds each Studio route from models.dev with the curated id list", async (t) => {
  const f = await fixture(t, { curatedExtra: { providerRoutes } });
  const result = await refreshCatalog({ root: f.root, logger, now: NOW, fetchImpl: routeSources() });
  assert.deepEqual(Object.keys(result.providerModels), ["claude", "zen", "zai"], "one list per route; the note is not a route");
  assert.deepEqual(result.providerModels.claude[0], {
    id: "claude-opus-5-5", name: "Claude Opus 5.5", family: "claude-opus", releaseDate: "2026-09-22", knowledge: "2026-06",
    limits: { context: 1000000, output: 128000 },
    cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    capabilities: { reasoning: true, toolCall: true, attachment: true, modalities: { input: ["text", "image", "pdf"], output: ["text"] }, openWeights: false },
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    studioRoute: "claude",
  });
  assert.deepEqual(result.providerModels.claude.map((row) => row.id), ["claude-opus-5-5", "claude-sonnet-4-5"], "newest first; an id models.dev lacks is dropped");
  assert.equal(result.providerModels.claude[1].reasoningEfforts, null);
  assert.deepEqual(result.providerModels.zen.find((row) => row.id === "gpt-6-luna").cost, { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }, "Zen rows carry Zen's price");
  assert.equal(result.providerModels.zen.find((row) => row.id === "gpt-5.6").cost, null, "no Zen price is never a guessed one");
  assert.deepEqual(result.providerModels.zai.map((row) => [row.id, row.cost?.input ?? null]), [["glm-5.3", 1.4], ["glm-5.3-highspeed", null]], "plan rows show the pay-as-you-go list price, not the plan's zero");
  assert.deepEqual(routeWarnings(result).sort(), [
    "providerModels.claude: claude-gone-1 is not on models.dev anthropic",
    "providerModels.zen: gpt-5.6 is not listed under models.dev opencode",
    "providerModels.zen: models.dev openai lists gpt-6-sol (released 2026-09-22) that curated providerRoutes does not track",
  ], "dated snapshots and models the route does not serve are not reported as untracked");
  assert.deepEqual(result.sources.providerModels.routes.zen, { provider: "openai", priceProvider: "opencode", servedBy: "opencode", count: 2, source: "models.dev" });
  assert.equal(result.sources.providerModels.ok, true);
  assert.deepEqual(Object.keys(result.models[0]).sort(), [
    "avoidFor", "capabilities", "endpoint", "id", "knowledge", "legacy", "limits", "listed", "name", "onRoster", "premium", "pricing",
    "privacy", "quality", "releaseDate", "rosterAlias", "tags", "typical", "typicalCostUSD", "usage", "useFor", "variants", "vendor", "verdict", "experimental",
  ].sort(), "Go rows keep their exact shape");

  const repriced = structuredClone(recorded);
  repriced.opencode.models["gpt-6-luna"].cost.input = 0.2;
  const again = await refreshCatalog({ root: f.root, logger, now: NOW, fetchImpl: routeSources(repriced) });
  assert.notEqual(again.hash, result.hash, "providerModels is part of the hashed payload, so the catalog page re-renders");
  assert.equal(again.rosterHash, result.rosterHash);
});

test("providerModels warns about stale ids unless Studio pins them", async (t) => {
  const f = await fixture(t, { curatedExtra: { providerRoutes: { claude: { ...providerRoutes.claude, ids: ["claude-opus-5-5", "claude-sonnet-4-5"] } } } });
  const later = Date.parse("2026-10-05T00:00:00Z");
  const result = await refreshCatalog({ root: f.root, logger, now: later, fetchImpl: routeSources() });
  assert.deepEqual(routeWarnings(result), ["providerModels.claude: claude-sonnet-4-5 (released 2025-09-29) is over 12 months old; drop it from curated providerRoutes"]);
  assert.equal(result.providerModels.claude.length, 2, "a stale id is reported, never silently removed");
  const pinned = await fixture(t, { curatedExtra: { providerRoutes: { claude: { ...providerRoutes.claude, pinned: ["claude-sonnet-4-5"], ids: ["claude-sonnet-4-5"] } } } });
  const kept = await refreshCatalog({ root: pinned.root, logger, now: later, fetchImpl: routeSources() });
  assert.deepEqual(routeWarnings(kept).filter((warning) => warning.includes("12 months")), []);
});

test("offline and failed-metadata refreshes rebuild providerModels from the committed catalog", async (t) => {
  const f = await fixture(t, { curatedExtra: { providerRoutes } });
  const live = await refreshCatalog({ root: f.root, logger, now: NOW, fetchImpl: routeSources() });
  const offline = await refreshCatalog({ root: f.root, logger, now: NOW, offline: true,
    fetchImpl() { assert.fail("offline refresh must not make network requests"); },
  });
  assert.deepEqual(offline.providerModels, live.providerModels);
  assert.equal(offline.hash, live.hash, "an offline rebuild keeps the payload and its hash");
  assert.equal(offline.sources.providerModels.ok, false);
  assert.equal(offline.sources.providerModels.routes.claude.source, "committed");
  assert.deepEqual(routeWarnings(offline), ["providerModels.claude: claude-gone-1 is not in the committed catalog"]);

  const failed = await refreshCatalog({ root: f.root, logger, now: NOW, fetchImpl: async (url) => {
    if (url === metadataUrl) throw new Error("fixture offline");
    return response({ data: [{ id: "known-model" }] });
  } });
  assert.deepEqual(failed.providerModels, live.providerModels, "a models.dev outage keeps the committed rows");

  const curatedPath = path.join(f.dataDir, "curated.json");
  const curated = JSON.parse(await readFile(curatedPath, "utf8"));
  curated.providerRoutes.claude.ids = ["claude-opus-5-5", "claude-sonnet-4-5"];
  curated.providerRoutes.zen.ids = ["gpt-6-luna", "gpt-6-sol"];
  await writeFile(curatedPath, JSON.stringify(curated));
  const narrowed = await refreshCatalog({ root: f.root, logger, now: NOW, offline: true });
  assert.deepEqual(narrowed.providerModels.zen.map((row) => row.id), ["gpt-6-luna"], "offline follows the curated list and never invents rows");
  assert.deepEqual(routeWarnings(narrowed), ["providerModels.zen: gpt-6-sol is not in the committed catalog"]);
});

test("offline refresh without committed providerModels says so and writes empty routes", async (t) => {
  const f = await fixture(t, { curatedExtra: { providerRoutes } });
  const result = await refreshCatalog({ root: f.root, logger, now: NOW, offline: true });
  assert.deepEqual(result.providerModels, { claude: [], zen: [], zai: [] });
  assert.deepEqual(routeWarnings(result), ["providerModels: the committed catalog has none yet; run a live refresh"]);
});

test("the committed seed covers the live roster honestly and names Studio's routed models", async () => {
  const curated = JSON.parse(await readFile(new URL("../data/curated.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../data/models.json", import.meta.url), "utf8"));
  const unseeded = catalog.models.filter((model) => model.onRoster && !curated.models[model.id]?.docsName).map((model) => model.id);
  assert.deepEqual(unseeded, [], "every roster model has a curated entry");
  for (const [id, seed] of Object.entries(curated.models)) {
    const quality = seed.quality ?? { index: null, declared: "none" };
    if (quality.index != null) assert.ok(["AA", "AA*"].includes(quality.declared), `${id}: an index needs its declared source`);
    else assert.equal(quality.declared, "none", `${id}: no index means declared none`);
  }
  for (const id of ["gpt-6-luna", "grok-4.7", "mimo-v2.6-flash", "mimo-v2.6-pro", "longcat-2.5-preview-free", "space-bunny-free"]) {
    assert.equal(curated.models[id]?.listed, true, `${id} is documented on Go`);
    assert.deepEqual(curated.models[id].quality, { index: null, declared: "none", benchmarks: [] }, `${id}: no benchmark was published, so none is claimed`);
    assert.match(curated.models[id].verdict, /No published benchmark|No benchmark|benchmarks and end date are unpublished/);
  }
  assert.equal(curated.models["deepseek-v4.1-flash"].promo, null, "the Sep 20 promo is over");
  for (const [route, spec] of Object.entries(curated.providerRoutes).filter(([name]) => name !== "note")) {
    assert.ok(spec.pinned.every((id) => spec.ids.includes(id)), `${route}: pinned ids are part of the list`);
    assert.deepEqual(catalog.providerModels[route].map((row) => row.id).sort(), [...spec.ids].sort(), `${route}: the catalog carries exactly the seeded ids`);
    assert.ok(catalog.providerModels[route].every((row) => row.studioRoute === route));
  }
  const tracked = new Set(Object.values(catalog.providerModels).flat().map((row) => row.id));
  for (const id of ["claude-opus-5-5", "gpt-6-sol", "gpt-6-luna", "glm-5.3", "glm-5.3-flash"]) assert.ok(tracked.has(id), `${id} is named by Studio and tracked`);
});
