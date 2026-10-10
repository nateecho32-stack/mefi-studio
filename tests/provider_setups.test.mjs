// Per-provider setups (scripts/provider-setups.cjs): a single set-up subscription
// gets its tier models picked for it, every tier starts at low effort, and a
// provider without a verified tier map gets no automatic setup.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const setups = require("../scripts/provider-setups.cjs");

test("Claude's tiers are the official 5.5 ids: Opus for heavy work, Sonnet for changes, Haiku for routine work", () => {
  assert.deepEqual(setups.tierModelsFor("claude"), { heavy: "claude-opus-5-5", routine: "claude-sonnet-5-5", quick: "claude-haiku-5-5" });
});

test("every tier starts at low effort", () => {
  assert.deepEqual(setups.planFor("claude"), {
    heavy: { model: "claude-opus-5-5", effort: "low" },
    routine: { model: "claude-sonnet-5-5", effort: "low" },
    quick: { model: "claude-haiku-5-5", effort: "low" },
  });
});

test("the automatic setup applies only when exactly one verified provider is set up", () => {
  assert.equal(setups.singleSetupProvider(["claude"]), "claude");
  assert.equal(setups.singleSetupProvider(["claude", "codex"]), null, "two providers: the owner picks");
  assert.equal(setups.singleSetupProvider(["codex"]), null, "no verified tier map for codex yet");
  assert.equal(setups.singleSetupProvider([]), null);
  assert.equal(setups.singleSetupProvider(["claude", "claude"]), "claude", "duplicates count once");
});

test("a provider without a verified map has no plan and no tiers", () => {
  assert.equal(setups.tierModelsFor("zai"), null);
  assert.equal(setups.planFor("zai"), null);
  assert.equal(setups.tierModelsFor("constructor"), null, "inherited names are not providers");
});
