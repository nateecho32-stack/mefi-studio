import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, rename, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fs = require("node:fs/promises");
const { normalizeObservation, normalizeRating, selectEffort, nextEffort, snapshotPerformance, createModelPerformanceStore } = require("../scripts/model-performance.cjs");

const observation = (id, extra = {}) => ({ id, provider: "subscription", model: "model-a", status: "ok", taskType: "coding", elapsedMs: 1000, at: 100, ...extra });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-performance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "performance.json");
  return { filePath, store: createModelPerformanceStore({ filePath, now: () => 100, ...options }) };
}

test("empty candidates have no invented speed, quality, price, or rank", () => {
  const view = snapshotPerformance({ observations: [], ratings: [] }, { candidates: [{ provider: "existing", model: "new-model" }], now: 100 });
  assert.equal(view.calls, 0);
  assert.deepEqual(view.range, { from: null, to: null });
  assert.deepEqual(view.usage.costUsd, { known: null, knownRecords: 0, unknownRecords: 0 });
  const model = view.models[0];
  assert.equal(model.score, null);
  assert.equal(model.rank, null);
  assert.equal(model.latencyMs.p50, null);
  assert.equal(model.quality.human.mean, null);
  assert.equal(model.evidence, "unobserved");
});

test("observations retain only measured metadata and keep unsupported effort/usage unknown", () => {
  const row = normalizeObservation(observation("one", {
    prompt: "private request", response: "private answer", apiKey: "secret", endpoint: "private-url", error: "private error",
    costUsd: "0", tokenUsage: { inputTokens: 20, outputTokens: "12", totalTokens: -1, cacheReadTokens: 3.5 },
    requestedEffort: "low", appliedEffort: "provider-magic", firstTokenMs: 2000,
  }));
  assert.equal(row.costUsd, null);
  assert.deepEqual(row.tokenUsage, { inputTokens: 20, outputTokens: null, totalTokens: null, cacheReadTokens: null, cacheWriteTokens: null });
  assert.equal(row.requestedEffort, "low");
  assert.equal(row.appliedEffort, null, "requested effort is never assumed applied");
  assert.equal(row.firstTokenMs, null, "a first token after completion is unusable evidence");
  for (const field of ["prompt", "response", "apiKey", "endpoint", "error"]) assert.equal(field in row, false);
  assert.throws(() => normalizeObservation(observation("one", { model: "" })), /Invalid model/);
});

test("concurrent writes from two store instances survive restart without lost calls", async (t) => {
  const { filePath, store } = await fixture(t);
  const other = createModelPerformanceStore({ filePath });
  await Promise.all(Array.from({ length: 25 }, (_, i) => (i % 2 ? other : store).record(observation(`run-${i}`, { at: 100 + i, tokenUsage: { inputTokens: i, totalTokens: i + 10 } }))));
  const view = await createModelPerformanceStore({ filePath }).snapshot();
  assert.equal(view.calls, 25);
  assert.equal(view.lifetime.calls, 25);
  assert.equal(view.usage.inputTokens.known, 300);
  assert.equal(view.usage.outputTokens.known, null);
  assert.equal(view.usage.outputTokens.unknownRecords, 25);
  assert.deepEqual(view.range, { from: 100, to: 124 });
});

test("observation ids are idempotent, conflict-safe, and not exposed as mutable store state", async (t) => {
  const { filePath, store } = await fixture(t);
  const first = await store.record(observation("once"));
  first.observation.model = "tampered";
  assert.equal((await store.record(observation("once"))).duplicate, true);
  await assert.rejects(store.record(observation("once", { elapsedMs: 2 })), /cannot be reused/);
  assert.equal((await store.snapshot()).lifetime.calls, 1);
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).observations[0].model, "model-a");
});

test("human and model quality stay separate, and editing a rating cannot inflate sample count", async (t) => {
  const { store } = await fixture(t);
  await store.record(observation("rated"));
  await store.rate({ observationId: "rated", authority: "human", score: 0, note: "Failed my review" });
  await store.rate({ observationId: "rated", authority: "model", judgeModel: "judge-one", score: 5 });
  await store.rate({ observationId: "rated", authority: "model", judgeModel: "judge-two", score: 3 });
  let row = (await store.snapshot()).models[0];
  assert.deepEqual(row.quality.human, { count: 1, mean: 0 });
  assert.deepEqual(row.quality.model, { count: 1, mean: 4 }, "two judges still reviewed only one result");
  const changed = await store.rate({ observationId: "rated", authority: "human", score: 2 });
  assert.equal(changed.updated, true);
  row = (await store.snapshot()).models[0];
  assert.deepEqual(row.quality.human, { count: 1, mean: 2 });
  assert.deepEqual(row.quality.model, { count: 1, mean: 4 });
  assert.throws(() => normalizeRating({ observationId: "rated", authority: "model", score: 5 }), /judge model/);
  await assert.rejects(store.rate({ observationId: "missing", authority: "human", score: 5 }), /no longer available/);
  assert.throws(() => normalizeRating({ observationId: "rated", authority: "human", score: 6 }), /between 0 and 5/);
});

test("unknown or partial cost cannot masquerade as free work or improve a ranking", async (t) => {
  const { store } = await fixture(t);
  await store.record(observation("a", { model: "free-reported", costUsd: 0, tokenUsage: { outputTokens: 10 } }));
  await store.record(observation("b", { model: "unknown", elapsedMs: 1000 }));
  let view = await store.snapshot();
  assert.equal(view.models.find((row) => row.model === "unknown").costUsd.mean, null);
  assert.equal(view.models.find((row) => row.model === "free-reported").costUsd.mean, 0);
  assert.equal(view.ranking.metrics.includes("cost"), false);
  assert.equal(view.ranking.metrics.includes("quality"), false, "success is not a quality rating");
  assert.equal(view.models[0].score, view.models[1].score);
  assert.deepEqual(view.usage.costUsd, { known: 0, knownRecords: 1, unknownRecords: 1 });
  await store.record(observation("c", { model: "free-reported", costUsd: null }));
  view = await store.snapshot({ candidates: [{ model: "free-reported", provider: "subscription" }] });
  assert.equal(view.ranking.metrics.includes("cost"), false, "one priced call does not price unknown calls");
});

test("errors and cancelled calls do not become fast successful samples", async (t) => {
  const { store } = await fixture(t);
  await store.record(observation("ok", { tokenUsage: { outputTokens: 100 } }));
  await store.record(observation("bad", { status: "error", elapsedMs: 5, errorKind: "auth" }));
  await store.record(observation("cancelled", { status: "cancelled", elapsedMs: 1 }));
  const row = (await store.snapshot()).models[0];
  assert.equal(row.errorRate, 0.5);
  assert.equal(row.cancelled, 1);
  assert.equal(row.latencyMs.count, 1);
  assert.equal(row.latencyMs.p50, 1000);
  assert.equal(row.throughput.p50, 100);
  assert.equal(row.quality.human.mean, null);
});

test("task strengths and effort records stay scoped to their task and provider", async (t) => {
  const { store } = await fixture(t);
  await store.record(observation("code", { requestedEffort: "low", appliedEffort: "low" }));
  await store.record(observation("write", { taskType: "writing", elapsedMs: 3000, requestedEffort: "high", appliedEffort: null }));
  await store.record(observation("other-provider", { provider: "other", elapsedMs: 50 }));
  await store.rate({ observationId: "code", authority: "human", score: 5 });
  await store.rate({ observationId: "write", authority: "human", score: 1 });
  let view = await store.snapshot();
  const model = view.models.find((row) => row.provider === "subscription");
  assert.equal(model.taskStrengths.find((row) => row.taskType === "coding").quality.human.mean, 5);
  assert.equal(model.taskStrengths.find((row) => row.taskType === "writing").quality.human.mean, 1);
  assert.equal(model.efforts.length, 2);
  assert.equal(model.efforts.find((row) => row.requestedEffort === "high").appliedEffort, null);
  view = await store.snapshot({ taskType: "writing" });
  assert.equal(view.calls, 1);
  assert.equal(view.models[0].latencyMs.p50, 3000);
  assert.equal(view.lifetime.calls, 3, "lifetime usage explicitly remains across all task types");
});

test("retention drops old details and ratings but preserves lifetime measured usage", async (t) => {
  const { filePath, store } = await fixture(t, { maxRecords: 2 });
  await store.record(observation("old", { at: 1, costUsd: 0.5, tokenUsage: { totalTokens: 20 } }));
  await store.rate({ observationId: "old", authority: "human", score: 5 });
  await store.record(observation("unknown", { at: 2 }));
  await store.record(observation("new", { at: 3, costUsd: 0, tokenUsage: { totalTokens: 30 } }));
  const view = await createModelPerformanceStore({ filePath, maxRecords: 2 }).snapshot();
  assert.equal(view.calls, 2);
  assert.equal(view.retention.dropped, 1);
  assert.equal(view.lifetime.calls, 3);
  assert.deepEqual(view.lifetime.usage.costUsd, { known: 0.5, knownRecords: 2, unknownRecords: 1 });
  assert.deepEqual(view.lifetime.usage.totalTokens, { known: 50, knownRecords: 2, unknownRecords: 1 });
  assert.deepEqual(view.lifetime.range, { from: 1, to: 3 });
  assert.equal((await store.read()).ratings.length, 0);
});

test("corrupt ledger failures preserve the file and do not poison subsequent operations", async (t) => {
  const { filePath, store } = await fixture(t);
  await writeFile(filePath, "{torn");
  await assert.rejects(store.record(observation("unsafe")), /existing data was preserved/);
  assert.equal(await readFile(filePath, "utf8"), "{torn");
  await writeFile(filePath, JSON.stringify({ version: 1, observations: [], ratings: [] }));
  await store.record(observation("recovered"));
  assert.equal((await store.snapshot()).calls, 1);
  const broken = await store.read();
  broken.lifetime.usage.costUsd.knownRecords = 10;
  await writeFile(filePath, JSON.stringify(broken));
  await assert.rejects(store.record(observation("bad-totals")), /Invalid usage totals/);
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).observations.length, 1);
});

test("effort starts at a supported low level and escalates only bounded reasoning/validation feedback", () => {
  const supportedEfforts = ["high", "low", "medium"];
  assert.equal(selectEffort({ supportedEfforts }), "low");
  assert.equal(selectEffort({ supportedEfforts: ["unknown"] }), null);
  assert.deepEqual(nextEffort({ supportedEfforts, currentEffort: "low", feedback: "validation" }), { effort: "medium", escalate: true, reason: "validation" });
  assert.equal(nextEffort({ supportedEfforts, currentEffort: "medium", feedback: { kind: "reasoning" }, escalations: 1 }).effort, "high");
  for (const feedback of ["transport", "auth", "quota", "timeout", "http", null]) {
    assert.equal(nextEffort({ supportedEfforts, currentEffort: "low", feedback }).escalate, false);
  }
  assert.equal(nextEffort({ supportedEfforts, currentEffort: "low", feedback: "reasoning", escalations: 2 }).escalate, false);
  assert.equal(nextEffort({ supportedEfforts, currentEffort: "high", feedback: "reasoning" }).escalate, false);
  assert.equal(nextEffort({ supportedEfforts, currentEffort: "ultra", feedback: "reasoning" }).effort, null);
  assert.equal(nextEffort({ supportedEfforts, currentEffort: "low", feedback: "reasoning", maxEscalations: 0 }).escalate, false);
});

test("unchanged snapshots reuse ledger reads and summaries while reporting the current time", async (t) => {
  let clock = 100;
  const { filePath, store } = await fixture(t, { now: () => clock });
  await store.record(observation("cached", { requestedEffort: "low" }));
  const originalRead = fs.readFile;
  let reads = 0, effortPartitions = 0;
  t.mock.method(fs, "readFile", async (...args) => {
    if (args[0] === filePath) reads += 1;
    return originalRead(...args);
  });
  const originalStringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (...args) => {
    if (Array.isArray(args[0]) && args[0][0] === "low" && args[0][1] === null) effortPartitions += 1;
    return originalStringify(...args);
  });
  const first = await store.snapshot();
  assert.ok(effortPartitions > 0, "the first snapshot computes its effort summary");
  const partitionsAfterFirst = effortPartitions;
  clock = 200;
  assert.deepEqual(await store.snapshot(), { ...first, generatedAt: 200 });
  assert.equal(effortPartitions, partitionsAfterFirst, "an unchanged snapshot does not recompute effort groups");
  for (const taskType of ["coding", "writing", "coding", null]) await store.snapshot({ taskType });
  await store.read();
  assert.equal(reads, 1, "filtering and repeated reads do not reread unchanged ledger bytes");
});

test("cached reads and summaries are detached, including recent usage, ratings and lifetime totals", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.record(observation("safe", { tokenUsage: { totalTokens: 12 } }));
  await store.rate({ observationId: "safe", authority: "human", score: 4, note: "Original" });
  const expected = await store.snapshot();
  const returned = await store.snapshot();
  returned.models[0].samples = 999;
  returned.recent[0].tokenUsage.totalTokens = 999;
  returned.recent[0].ratings.human[0].note = "Tampered";
  returned.lifetime.calls = 999;
  const read = await store.read();
  read.observations.length = 0;
  read.ratings[0].score = 0;
  read.lifetime.usage.totalTokens.known = 999;
  assert.deepEqual(await store.snapshot(), expected);
  await store.record(observation("next"));
  assert.equal((await store.snapshot()).lifetime.calls, 2);
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).ratings[0].note, "Original");
});

test("cached summaries refresh after another store writes observations or ratings", async (t) => {
  const { filePath, store } = await fixture(t);
  const other = createModelPerformanceStore({ filePath });
  await store.record(observation("first"));
  await store.snapshot();
  await other.record(observation("second", { taskType: "writing" }));
  assert.equal((await store.snapshot()).calls, 2);
  await other.rate({ observationId: "first", authority: "human", score: 5 });
  assert.deepEqual((await store.snapshot()).models[0].quality.human, { count: 1, mean: 5 });
  await store.rate({ observationId: "first", authority: "human", score: 1 });
  assert.deepEqual((await store.snapshot()).models[0].quality.human, { count: 1, mean: 1 });
});

test("external same-length edits, replacements, corruption and removal invalidate cached data", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.record(observation("external"));
  await utimes(filePath, 10, 10);
  await store.snapshot();
  const original = await readFile(filePath, "utf8"), metadata = await stat(filePath, { bigint: true });
  await writeFile(filePath, original.replace('"model-a"', '"model-b"'));
  await utimes(filePath, 10, 10);
  const edited = await stat(filePath, { bigint: true });
  assert.equal(edited.size, metadata.size);
  assert.equal(edited.mtimeNs, metadata.mtimeNs);
  assert.equal((await store.snapshot()).models[0].model, "model-b", "ctime detects edits even when size and mtime are restored");
  const replacement = `${filePath}.replacement`;
  await writeFile(replacement, original.replace('"model-a"', '"model-c"'));
  await rename(replacement, filePath);
  assert.equal((await store.snapshot()).models[0].model, "model-c");
  await writeFile(filePath, "{torn");
  await assert.rejects(store.snapshot(), /existing data was preserved/);
  await assert.rejects(store.snapshot(), /existing data was preserved/, "a failed read cannot fall back to an old summary");
  await rm(filePath);
  assert.equal((await store.snapshot()).calls, 0);
  await writeFile(filePath, original);
  assert.equal((await store.snapshot()).models[0].model, "model-a");
});

test("a failed atomic save cannot leave an unpersisted rating in the cache", async (t) => {
  const { filePath, store } = await fixture(t);
  await store.record(observation("unsaved"));
  const expected = await store.snapshot();
  const originalRename = fs.rename;
  const mockedRename = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === filePath) throw new Error("Fixture rename failure");
    return originalRename(...args);
  });
  await assert.rejects(store.rate({ observationId: "unsaved", authority: "human", score: 5 }), /Fixture rename failure/);
  mockedRename.mock.restore();
  assert.deepEqual(await store.snapshot(), expected);
  await store.rate({ observationId: "unsaved", authority: "human", score: 2 });
  assert.equal((await store.snapshot()).models[0].quality.human.mean, 2);
});

test("model grouping examines identities a bounded number of times regardless of model count", () => {
  let identityReads = 0;
  const observations = Array.from({ length: 400 }, (_, index) => {
    const row = normalizeObservation(observation(`group-${index}`, {
      model: `model-${index % 40}`, taskType: `task-${Math.floor(index / 40) % 5}`,
      requestedEffort: index % 2 ? "low" : "high", tokenUsage: { outputTokens: index },
    }));
    Object.defineProperty(row, "provider", { enumerable: true, get: () => { identityReads += 1; return "subscription"; } });
    return row;
  });
  const view = snapshotPerformance({ observations, ratings: [] }, { now: 100 });
  assert.equal(view.models.length, 40);
  assert.equal(view.models.every((model) => model.samples === 10 && model.taskStrengths.length === 5), true);
  assert.ok(identityReads <= observations.length * 4, `identity reads should grow with calls, not calls × models: ${identityReads}`);
});

test("custom candidates, weights and quality source do not reuse incompatible cached rankings", async (t) => {
  const { store } = await fixture(t);
  await store.record(observation("fast", { model: "fast", elapsedMs: 100 }));
  await store.record(observation("slow", { model: "slow", elapsedMs: 1000 }));
  await store.rate({ observationId: "fast", authority: "human", score: 1 });
  await store.rate({ observationId: "slow", authority: "human", score: 5 });
  await store.rate({ observationId: "fast", authority: "model", judgeModel: "judge", score: 5 });
  await store.rate({ observationId: "slow", authority: "model", judgeModel: "judge", score: 0 });
  const normal = await store.snapshot();
  assert.equal(normal.models[0].model, "slow");
  assert.equal((await store.snapshot({ qualitySource: "model" })).models[0].model, "fast");
  const speed = await store.snapshot({ weights: { quality: 0, speed: 1, reliability: 0, cost: 0 } });
  assert.equal(speed.models[0].model, "fast");
  const selected = await store.snapshot({ candidates: [{ provider: "subscription", model: "new" }] });
  assert.equal(selected.models.length, 1);
  assert.equal(selected.models[0].evidence, "unobserved");
  assert.deepEqual(await store.snapshot(), normal);
});
