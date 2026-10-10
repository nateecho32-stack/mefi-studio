// A finished attempt keeps the model and CLI it ran on (scripts/executor-core.cjs
// attemptRecord), so the next try of a missed card can stay on that model.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const executorCore = require("../scripts/executor-core.cjs");

const base = { job: { title: "Fix the save button" }, code: 1, now: 1000, maxDepth: 3, maxHandoffs: 3 };

test("an attempt record names the model and CLI it ran on", () => {
  const run = { id: "run_1", startedAt: 900, routeLabel: "claude cli · sonnet", routeModel: "sonnet", routeCli: "claude" };
  const record = executorCore.attemptRecord({ ...base, run });
  assert.equal(record.model, "sonnet");
  assert.equal(record.cli, "claude");
  assert.equal(record.route, "claude cli · sonnet");
});

test("an attempt with no known model records none", () => {
  const record = executorCore.attemptRecord({ ...base, run: { id: "run_2", startedAt: 900 } });
  assert.equal("model" in record, false);
  assert.equal("cli" in record, false);
});

const modelLadder = require("../scripts/model-ladder.cjs");

test("a missed card is pinned to the model its last attempt ran on, on the same CLI", () => {
  const missed = { lastModel: "sonnet", lastCli: "claude", cli: "claude", currentModel: "haiku", missed: true, ownerPick: false };
  assert.equal(modelLadder.keptModel(missed), "sonnet");
});

test("nothing is pinned before a miss, for an owner's pick, on another CLI, or when already on that model", () => {
  const base = { lastModel: "sonnet", lastCli: "claude", cli: "claude", currentModel: "haiku", missed: true, ownerPick: false };
  assert.equal(modelLadder.keptModel({ ...base, missed: false }), null, "no miss yet");
  assert.equal(modelLadder.keptModel({ ...base, ownerPick: true }), null, "the owner's pick stays");
  assert.equal(modelLadder.keptModel({ ...base, cli: "codex" }), null, "another CLI runs it");
  assert.equal(modelLadder.keptModel({ ...base, currentModel: "sonnet" }), null, "already on it");
  assert.equal(modelLadder.keptModel({ ...base, lastModel: "" }), null, "no recorded model");
  assert.equal(modelLadder.keptModel({ ...base, lastCli: "" }), null, "no recorded CLI");
});
