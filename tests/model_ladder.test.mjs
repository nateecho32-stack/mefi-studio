import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// How hard a model thinks and when a stuck coding job moves to a stronger
// model (scripts/model-ladder.cjs): the team's choices with their defaults,
// the effort words each route takes, the climb from one miss to the next, and
// what the ledger says worked before.
const require = createRequire(import.meta.url);
const ladder = require("../scripts/model-ladder.cjs");

test("the team's thinking choices default to Auto, stepping up, Max asked, exploring", () => {
  assert.deepEqual(ladder.thinking({}), { mode: "auto", climb: true, askMax: true, explore: true });
  assert.deepEqual(ladder.thinking({ agentThinking: { mode: "deep", climb: false, askMax: false, explore: false } }), { mode: "deep", climb: false, askMax: false, explore: false });
  assert.deepEqual(ladder.thinking({ agentThinking: { mode: "max", climb: "yes" } }), { mode: "auto", climb: true, askMax: true, explore: true }, "a value the page never offers falls back");
  assert.equal(ladder.validate({ mode: "light", climb: true }), null);
  assert.match(ladder.validate({ mode: "max" }), /auto, light, balanced or deep/);
  assert.match(ladder.validate({ speed: 1 }), /Unknown thinking setting/);
  assert.match(ladder.validate({ askMax: "on" }), /askMax must be on or off/);
  assert.match(ladder.validate([]), /must be an object/);
});

test("effort words read as levels, and levels as the word routes send", () => {
  assert.equal(ladder.levelOf("minimal"), "light");
  assert.equal(ladder.levelOf("low"), "light");
  assert.equal(ladder.levelOf("medium"), "balanced");
  assert.equal(ladder.levelOf("xhigh"), "deep");
  assert.equal(ladder.levelOf("ultra"), "max");
  assert.equal(ladder.levelOf("deep"), "deep");
  assert.equal(ladder.levelOf("loud"), null);
  assert.equal(ladder.effortOf("balanced"), "medium");
  assert.equal(ladder.effortOf("high"), "high");
});

test("each coding CLI takes its own effort words", () => {
  assert.deepEqual(ladder.cliEfforts("claude", "opus"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(ladder.cliEfforts("claude", "claude-haiku-4-5"), [], "Haiku takes no effort");
  assert.deepEqual(ladder.cliEfforts("codex", ""), ["low", "medium", "high", "xhigh"]);
  assert.deepEqual(ladder.cliEfforts("codex", "gpt-6.1-sol", { codexLevels: { "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max", "ultra"] } }), ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(ladder.cliEfforts("opencode", "opencode-go/deepseek-v4.1-flash"), [], "unknown variants are never guessed");
  assert.deepEqual(ladder.cliEfforts("opencode", "opencode-go/deepseek-v4.1-flash", { opencodeVariants: { "opencode-go/deepseek-v4.1-flash": ["max", "low", "high"] } }), ["low", "high", "max"]);
  assert.deepEqual(ladder.cliEfforts("grok", "grok-4.7"), []);
  assert.deepEqual(ladder.cliEfforts("antigravity", "Gemini 3.1 Pro (High)"), []);
});

test("a wanted effort fits the nearest one the model takes, never weaker", () => {
  const flash = ["low", "high", "max"];
  assert.equal(ladder.fitEffort(flash, "low"), "low");
  assert.equal(ladder.fitEffort(flash, "medium"), "high", "balanced on a model without medium goes up, not down");
  assert.equal(ladder.fitEffort(flash, "balanced"), "high", "a level name works too");
  assert.equal(ladder.fitEffort(["low", "medium"], "max"), "medium", "the strongest it has when the wanted one is past it");
  assert.equal(ladder.fitEffort(["low", "medium", "high", "ultra"], "max"), "high", "ultra is never reached for");
  assert.equal(ladder.fitEffort(["low", "ultra"], "ultra"), "ultra");
  assert.equal(ladder.fitEffort([], "low"), null);
  assert.equal(ladder.fitEffort(flash, "loud"), null);
});

test("each coding CLI gets its own effort flag", () => {
  assert.deepEqual(ladder.effortArgs("claude", "high"), ["--effort", "high"]);
  assert.deepEqual(ladder.effortArgs("claude", "minimal"), [], "a word Claude Code does not take is left out");
  assert.deepEqual(ladder.effortArgs("codex", "low"), ["-c", "model_reasoning_effort=low"]);
  assert.deepEqual(ladder.effortArgs("opencode", "max"), ["--variant", "max"]);
  assert.deepEqual(ladder.effortArgs("grok", "high"), []);
  assert.deepEqual(ladder.effortArgs("claude", "high; rm -rf"), [], "only fixed words reach a command line");
});

test("thinking starts from the owner's pick, then the team's mode, then what worked, then light", () => {
  assert.deepEqual(ladder.startLevel({ mode: "auto", explicit: "medium", learned: "deep" }), { level: "balanced", source: "owner" });
  assert.deepEqual(ladder.startLevel({ mode: "deep", learned: "balanced" }), { level: "deep", source: "team" });
  assert.deepEqual(ladder.startLevel({ mode: "auto", learned: "balanced" }), { level: "balanced", source: "learned" });
  assert.deepEqual(ladder.startLevel({ mode: "auto", learned: "max" }), { level: "light", source: "auto" }, "Max is never learned into");
  assert.deepEqual(ladder.startLevel({}), { level: "light", source: "auto" });
});

test("on Auto a stuck card moves up a model tier first, and thinks harder only at the top", () => {
  const run = (misses, extra = {}) => ladder.builderStep({ mode: "auto", climb: true, askMax: true, misses, start: "light", hasStronger: true, ...extra });
  assert.deepEqual(run(0), { level: "light", stronger: false, held: null, reason: null });
  assert.deepEqual(run(1), { level: "light", stronger: true, held: null, reason: "stronger-model" });
  assert.deepEqual(run(2), { level: "light", stronger: true, held: null, reason: "stronger-model" });
  assert.deepEqual(run(4), { level: "light", stronger: true, held: null, reason: "stronger-model" });
  // At the top tier there is no stronger model: thinking climbs, Max waits for the owner.
  const top = (misses, extra = {}) => ladder.builderStep({ mode: "auto", climb: true, askMax: true, misses, start: "light", hasStronger: false, ...extra });
  assert.deepEqual(top(1), { level: "balanced", stronger: false, held: null, reason: "thinks-harder" });
  assert.deepEqual(top(3), { level: "deep", stronger: false, held: "max", reason: "thinks-harder" });
  assert.deepEqual(top(3, { askMax: false }), { level: "max", stronger: false, held: null, reason: "thinks-harder" });
});

test("with no stronger model the card only thinks harder", () => {
  const run = (misses) => ladder.builderStep({ mode: "auto", misses, hasStronger: false });
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => run(n).level), ["light", "balanced", "deep", "deep"].concat(["deep"]));
  assert.equal(run(2).stronger, false);
  assert.equal(run(3).held, "max");
});

test("a fixed team mode keeps its thinking and only moves the model", () => {
  const run = (misses) => ladder.builderStep({ mode: "balanced", misses, start: "balanced", hasStronger: true });
  assert.deepEqual([0, 1, 2, 3].map((n) => [run(n).level, run(n).stronger]), [["balanced", false], ["balanced", true], ["balanced", true], ["balanced", true]]);
  assert.equal(run(2).reason, "stronger-model");
});

test("with stepping up off, every retry runs like the first", () => {
  for (const misses of [0, 1, 2, 4]) assert.deepEqual(ladder.builderStep({ mode: "auto", climb: false, misses, start: "light", hasStronger: true }), { level: "light", stronger: false, held: null, reason: null });
});

test("an owner who starts at deep stays there unless Max is allowed", () => {
  assert.equal(ladder.builderStep({ mode: "auto", misses: 1, start: "deep", hasStronger: false }).level, "deep");
  assert.equal(ladder.builderStep({ mode: "auto", misses: 1, start: "deep", hasStronger: false }).held, "max");
  assert.equal(ladder.builderStep({ mode: "auto", misses: 1, start: "deep", hasStronger: false, askMax: false }).level, "max");
});

test("the ledger moves a kind of job's start only on a clear record", () => {
  const key = { provider: "opencode", model: "opencode-go/deepseek-v4.1-flash", taskType: "coding-explore" };
  const row = (outcome, effort, extra = {}) => ({ ...key, outcome, requestedEffort: effort, appliedEffort: effort, ...extra });
  const lightLosses = [row("failed", "low"), row("failed", "low"), row("failed", "low"), row("verified", "low")];
  assert.equal(ladder.learnedStart([...lightLosses, row("verified", "high"), row("verified", "high")], key), "deep", "light kept losing and deep kept winning");
  assert.equal(ladder.learnedStart([...lightLosses, row("verified", "medium"), row("failed", "medium"), row("verified", "medium")], key), "balanced");
  assert.equal(ladder.learnedStart([row("verified", "low"), row("failed", "low"), row("verified", "low"), row("verified", "high"), row("verified", "high")], key), null, "light wins often enough");
  assert.equal(ladder.learnedStart([row("failed", "low"), row("failed", "low"), row("verified", "high"), row("verified", "high")], key), null, "two light losses are too thin a record");
  assert.equal(ladder.learnedStart([...lightLosses, row("verified", "high", { taskType: "coding-implement" }), row("verified", "high", { taskType: "coding-implement" })], key), null, "another kind of job says nothing");
  assert.equal(ladder.learnedStart([...lightLosses.map((entry) => ({ ...entry, requestedEffort: null, appliedEffort: null })), row("verified", "high"), row("verified", "high")], key), null, "rows that name no effort do not count");
  assert.equal(ladder.learnedStart([...lightLosses, row("verified", "high"), { ...row("verified", "high"), outcome: undefined }], key), null, "unsettled rows do not count");
});

test("OpenCode's verbose model list and Codex's model cache read as each model's effort words", () => {
  const verbose = [
    "\u001b[1mopencode-go/deepseek-v4.1-flash\u001b[0m",
    JSON.stringify({ id: "deepseek-v4.1-flash", variants: { low: {}, high: {}, max: {}, turbo: {} } }, null, 2),
    "opencode-go/kimi-k3",
    JSON.stringify({ id: "kimi-k3" }, null, 2),
    "opencode-go/broken",
    "{ not json",
  ].join("\r\n");
  assert.deepEqual(ladder.parseOpencodeModels(verbose), { "opencode-go/deepseek-v4.1-flash": ["low", "high", "max"], "opencode-go/kimi-k3": [] });
  assert.deepEqual(ladder.parseOpencodeModels("opencode-go/a\nopencode-go/b\n"), {}, "the short list names no variants, so nothing is known");
  assert.deepEqual(ladder.codexLevelsFrom({ models: [
    { slug: "gpt-6.1-sol", supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }, { effort: "weird" }] },
    { id: "gpt-6-luna", supported_reasoning_levels: ["medium", "high"] },
    { slug: "no-levels" },
  ] }), { "gpt-6.1-sol": ["low", "ultra"], "gpt-6-luna": ["medium", "high"] });
  assert.deepEqual(ladder.codexLevelsFrom(null), {});
});

test("a builder with no Heavy model of its own steps up within its family", () => {
  assert.equal(ladder.strongerSibling("opencode-go/deepseek-v4.1-flash"), "opencode-go/deepseek-v4-pro");
  assert.equal(ladder.strongerSibling("sonnet"), "opus");
  assert.equal(ladder.strongerSibling("opus"), null);
  assert.equal(ladder.strongerSibling(""), null);
  assert.equal(ladder.wordsFor("medium"), "balanced thinking");
  assert.equal(ladder.wordsFor(null), "the model's own thinking");
});
