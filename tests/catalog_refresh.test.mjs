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

async function fixture(t, { models = [savedModel], curatedModels = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "catalog-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const curated = {
    schemaVersion: 1, plan: { name: "Fixture", sources: { seedDate: "2026-01-01" } },
    taskPresets: [], privacyScores: {}, models: curatedModels,
    endpoints: { compat: { label: "Fixture compatibility endpoint", path: "https://invalid.test/v1" } },
    endpointMap: {},
  };
  const catalogPath = path.join(dataDir, "models.json");
  await writeFile(path.join(dataDir, "curated.json"), JSON.stringify(curated));
  await writeFile(catalogPath, JSON.stringify({ models, hash: "old-hash", rosterHash: "old-roster-hash" }));
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
