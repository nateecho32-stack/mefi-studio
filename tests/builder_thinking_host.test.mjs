// How hard a coding attempt thinks (main.cjs "How hard a coding attempt
// thinks", sliced into a vm with the real scripts/model-ladder.cjs): Auto
// starts light, a card that missed thinks one step harder per miss, after two
// misses a stronger model takes it, the owner's own picks keep their model,
// and the ledger can move a kind of job's start.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const modelLadder = require("../scripts/model-ladder.cjs");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

const VERBOSE_GO = [
  "opencode-go/deepseek-v4.1-flash",
  JSON.stringify({ id: "deepseek-v4.1-flash", variants: { low: {}, high: {}, max: {} } }, null, 2),
  "opencode-go/deepseek-v4-pro",
  JSON.stringify({ id: "deepseek-v4-pro", variants: { high: {}, max: {} } }, null, 2),
].join("\n");

// What each CLI's --help lists on this fixture PC.
const HELP = { claude: "  --effort <level>   Effort level (low, medium, high, xhigh, max)", opencode: "  --variant   model variant (provider-specific reasoning effort)" };
function host({ settings = {}, heavy = null, observations = [], codexCache = null, help = HELP, processEnv = {} } = {}) {
  const logs = [], spawns = [];
  const spawnExec = async (command, args) => {
    spawns.push([command, ...args]);
    if (args.includes("--help")) return { code: 0, stdout: help[command] ?? "" };
    return { code: 0, stdout: VERBOSE_GO };
  };
  const env = vm.createContext({
    modelLadder, path, os: { homedir: () => "C:/Users/fixture" }, process: { env: processEnv }, console,
    readAgentSettings: async () => settings, readSettings: async () => settings,
    heavyRetryModel: () => heavy,
    zaiOpencodeEnv: async () => null, executorOpencodeEnv: () => ({ OPENCODE: "1" }),
    logLine: (line) => logs.push(line), assistantClip: (text, limit) => String(text).slice(0, limit),
    loadModule: async () => ({ spawnExec }),
    modelPerformanceStore: () => ({ read: async () => ({ observations }) }),
    readFile: async () => { if (!codexCache) throw new Error("no cache"); return JSON.stringify(codexCache); },
  });
  vm.runInContext(section("// Puts another model on this attempt's route in place", "// Whether \"Try again with a heavier model\" can change anything")
    + section("function workerLedgerIdentity(", "// The verifier's verdict on an attempt"), env);
  const think = async (route, ref = {}, options = {}) => {
    const runRoute = { ...route };
    const thinking = await env.builderThinking(runRoute, { title: "Fix the save button", ref }, { workKind: "coding-implement", ...options });
    return { runRoute, thinking: JSON.parse(JSON.stringify(thinking)) };
  };
  return { env, think, logs, spawns };
}
const claude = () => ({ cli: "claude", model: "sonnet", via: "claude cli · sonnet" });
const go = () => ({ cli: "opencode", model: "opencode-go/deepseek-v4.1-flash", modelArgs: " --model opencode-go/deepseek-v4.1-flash", via: "opencode-go/deepseek-v4.1-flash" });

test("on Auto a fresh card thinks light, and each miss steps it up", async () => {
  const h = host({ heavy: "opus" });
  const first = await h.think(claude());
  assert.equal(first.runRoute.effort, "low");
  assert.equal(first.runRoute.model, "sonnet");
  assert.deepEqual([first.thinking.level, first.thinking.source, first.thinking.misses, first.thinking.stronger], ["light", "auto", 0, null]);
  const second = await h.think(claude(), { runFailures: 1 });
  assert.equal(second.runRoute.effort, "medium");
  assert.equal(second.runRoute.model, "sonnet", "one miss only thinks harder");
  assert.match(h.logs.at(-1), /missed 1 time: this attempt runs balanced thinking/);
});

test("after two misses the Heavy tier's model takes the card, and the next miss thinks harder on it", async () => {
  const h = host({ heavy: "opus" });
  const third = await h.think(claude(), { runFailures: 1, verifyAttempts: 1, lastAttempt: { runId: "run_7_1" } });
  assert.equal(third.runRoute.model, "opus");
  assert.equal(third.runRoute.effort, "medium");
  assert.equal(third.runRoute.via, "claude cli · opus · stronger model after 2 misses");
  assert.equal(third.thinking.stronger, "opus");
  assert.equal(third.thinking.after, "run_7_1", "the ledger row can name the attempt it steps up from");
  const fourth = await h.think(claude(), { runFailures: 3 });
  assert.equal(fourth.runRoute.effort, "high");
  const fifth = await h.think(claude(), { runFailures: 4 });
  assert.equal(fifth.runRoute.effort, "high", "Max waits for the owner");
  assert.equal(fifth.thinking.held, "max");
  assert.match(h.logs.at(-1), /Max thinking waits for you/);
});

test("the owner's own model pick stays; only the thinking steps", async () => {
  const h = host({ heavy: "opus" });
  const owned = await h.think(claude(), { runFailures: 2 }, { ownerPick: "its heavier retry asked for that model" });
  assert.equal(owned.runRoute.model, "sonnet");
  assert.equal(owned.runRoute.effort, "high", "with no model step to take, two misses think two steps harder");
  assert.equal(owned.thinking.stronger, null);
});

test("with stepping up off, a card that keeps missing runs like its first try", async () => {
  const h = host({ heavy: "opus", settings: { agentThinking: { climb: false } } });
  const late = await h.think(claude(), { runFailures: 3 });
  assert.equal(late.runRoute.model, "sonnet");
  assert.equal(late.runRoute.effort, "low");
});

test("a fixed team mode keeps its thinking and still moves the model", async () => {
  const h = host({ heavy: "opus", settings: { agentThinking: { mode: "balanced" } } });
  assert.equal((await h.think(claude())).runRoute.effort, "medium");
  const stuck = await h.think(claude(), { runFailures: 2 });
  assert.equal(stuck.runRoute.effort, "medium");
  assert.equal(stuck.runRoute.model, "opus");
});

test("the owner's builder effort is where every card starts", async () => {
  const h = host({ settings: { agentEfforts: { builder: "high" } } });
  const run = await h.think(claude());
  assert.equal(run.runRoute.effort, "high");
  assert.equal(run.thinking.source, "owner");
});

test("OpenCode sends a variant only once it knows the model's, and Go's flash steps up to its full sibling", async () => {
  const h = host();
  const unknown = await h.think(go());
  assert.equal(unknown.runRoute.effort, undefined, "no guessing: the first attempt runs without a variant");
  await tick(); await tick();
  assert.deepEqual(h.spawns, [["opencode", "run", "--help"], ["opencode", "models", "opencode-go", "--verbose"]]);
  const known = await h.think(go());
  assert.equal(known.runRoute.effort, "low");
  const balanced = await h.think(go(), { runFailures: 1 });
  assert.equal(balanced.runRoute.effort, "high", "balanced on a model without medium goes up to high");
  const stuck = await h.think(go(), { runFailures: 2 });
  assert.equal(stuck.runRoute.model, "opencode-go/deepseek-v4-pro");
  assert.equal(stuck.runRoute.modelArgs, " --model opencode-go/deepseek-v4-pro");
  assert.equal(stuck.runRoute.effort, "high");
  assert.equal(h.spawns.length, 2, "the help and the variants are read once and kept");
});

test("a CLI whose --help lacks the flag, or the kill switch, sends no thinking but still steps up a model", async () => {
  const old = host({ heavy: "opus", help: { claude: "  --model <model>" } });
  const run = await old.think(claude(), { runFailures: 2 });
  assert.equal(run.runRoute.effort, undefined, "an older Claude Code would fail on --effort");
  assert.equal(run.runRoute.model, "opus");
  assert.match(old.logs.join("\n"), /claude does not list --effort/);
  const off = host({ heavy: "opus", processEnv: { MEFI_STUDIO_THINKING_OFF: "1" } });
  assert.equal((await off.think(claude())).runRoute.effort, undefined);
  assert.equal(off.spawns.length, 0, "the kill switch never even asks");
});

test("a routed Go pick is matched under its opencode-go name", async () => {
  const h = host();
  await h.think(go()); await tick(); await tick();
  const routed = await h.think({ cli: "opencode", modelProvider: "opencode", model: "deepseek-v4.1-flash", modelArgs: " --model opencode-go/deepseek-v4.1-flash", via: "opencode-go/deepseek-v4.1-flash" });
  assert.equal(routed.runRoute.effort, "low");
});

test("Codex fits the thinking to the levels its own model cache lists", async () => {
  const h = host({ codexCache: { models: [{ slug: "gpt-6-luna", supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }] }] } });
  const run = await h.think({ cli: "codex", model: "gpt-6-luna", via: "codex cli · gpt-6-luna" });
  assert.equal(run.runRoute.effort, "medium", "light on a model whose weakest level is medium sends medium");
  const plain = await host().think({ cli: "codex", model: "", via: "codex cli" });
  assert.equal(plain.runRoute.effort, "low", "no cache: Codex's usual levels");
});

test("Grok and Antigravity take no thinking flag but still step up a model", async () => {
  const h = host({ heavy: "grok-5-heavy" });
  const grok = await h.think({ cli: "grok", model: "grok-5", via: "grok cli · grok-5" }, { runFailures: 2 });
  assert.equal(grok.runRoute.effort, undefined);
  assert.equal(grok.runRoute.model, "grok-5-heavy");
});

test("what worked before for this kind of job moves its start", async () => {
  const row = (outcome, effort) => ({ provider: "claude", model: "sonnet", taskType: "coding-implement", outcome, requestedEffort: effort, appliedEffort: effort });
  const observations = [row("failed", "low"), row("failed", "low"), row("failed", "low"), row("verified", "high"), row("verified", "high")];
  const run = await host({ observations }).think(claude());
  assert.equal(run.runRoute.effort, "high");
  assert.equal(run.thinking.source, "learned");
  const fixed = await host({ observations, settings: { agentThinking: { mode: "light" } } }).think(claude());
  assert.equal(fixed.runRoute.effort, "low", "a fixed team mode ignores what was learned");
});
