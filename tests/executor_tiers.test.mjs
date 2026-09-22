import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

// Coding tiers: the executor route resolved per tier and per builder CLI.
// The slices are the same pure sections executor_parallel loads — the tier
// helpers sit between executorModelOverride and the auto-setup planner.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

function host(settings, { clis = ["opencode", "grok", "claude", "codex", "antigravity"], zai = true } = {}) {
  const logs = [], history = [];
  const installed = new Set(clis);
  const env = vm.createContext({
    process: { env: {} },
    AI_PROVIDERS: ["auto", "zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    AI_AUTO_PROVIDERS: ["zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    readSettings: async () => settings,
    zaiOpencodeEnv: async () => (zai ? { OPENCODE_CONFIG_CONTENT: '{"provider":{"mefi-zai":{}}}', MEFI_ZAI_API_KEY: "fixture" } : null),
    grokCliAvailable: async () => installed.has("grok"),
    claudeCliAvailable: async () => installed.has("claude"),
    codexCliAvailable: async () => installed.has("codex"),
    antigravityCliAvailable: async () => installed.has("antigravity"),
    logLine: (line) => logs.push(line),
    pushAutopilotHistory: (kind, note) => history.push([kind, note]),
  });
  vm.runInContext(
    section("function executorModelOverride(", "// Auto setup:") +
    section("function executorOpencodeEnv(", "// Which route an autopilot") +
    section("async function executorRunEnv()", "async function assistantFetch("),
    env,
  );
  // Objects born inside the vm have their own prototypes; compare by shape.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return { env, logs, history, route: () => env.executorRunEnv(), defaults: (cli, options) => plain(env.executorTierDefaults(settings, cli, options)) };
}
const config = (route) => JSON.parse(route.env.OPENCODE_CONFIG_CONTENT);

test("Auto keeps the previous route untouched: the pinned override, the free first-scan pick and the z.ai default", async () => {
  const pinned = await host({ aiProvider: "auto", executorModels: { opencode: "opencode/nemotron-3.5-lightning-free" }, firstRun: { builder: { free: true, model: "opencode/nemotron-3.5-lightning-free" } } }, { zai: false }).route();
  assert.equal(pinned.modelArgs, " --model opencode/nemotron-3.5-lightning-free");
  assert.equal(pinned.parallelCap, 1, "a free pick still runs one at a time under Auto");
  assert.equal(pinned.tier, undefined, "Auto stamps no tier on the route");
  const zai = await host({ aiProvider: "auto" }).route();
  assert.equal(zai.modelProvider, "zai", "Auto still hands the z.ai run to Jev's per-task selection");
  assert.equal(zai.model, "glm-5.3-flash");
});

test("Auto runs any model the owner pins, on the z.ai route too; only the first scan's free pick yields to the plan", async () => {
  const pinned = await host({ aiProvider: "zai", executorModels: { opencode: "opencode-go/deepseek-v4.1-flash" } }).route();
  assert.equal(pinned.cli, "opencode");
  assert.equal(pinned.modelArgs, " --model opencode-go/deepseek-v4.1-flash", "the pin is the owner's choice of model and account");
  assert.equal(pinned.modelProvider, undefined, "a pinned builder is not re-routed to the GLM pair");
  assert.equal(pinned.parallelCap, null, "a paid pin keeps the full pool");
  const scanned = await host({ aiProvider: "zai", executorModels: { opencode: "opencode/nemotron-3.5-lightning-free" }, firstRun: { builder: { free: true, model: "opencode/nemotron-3.5-lightning-free" } } }).route();
  assert.equal(scanned.modelProvider, "zai", "the scan's free suggestion does not displace the coding plan");
  assert.equal(scanned.model, "glm-5.3-flash");
});

test("Fast and Heavy pin the z.ai GLM pair on the coding plan and skip per-task selection", async () => {
  const fast = await host({ aiProvider: "auto", executorTier: "fast" }).route();
  assert.equal(fast.cli, "opencode");
  assert.equal(fast.model, "mefi-zai/glm-5.3-flash");
  assert.equal(fast.modelArgs, " --model mefi-zai/glm-5.3-flash");
  assert.equal(fast.modelProvider, undefined, "a pinned tier is not re-routed by Jev");
  assert.equal(fast.tier, "fast");
  assert.ok(config(fast).provider["mefi-zai"], "the managed provider rides the run");
  assert.equal(config(fast).snapshot, false);
  const heavy = await host({ aiProvider: "zai", executorTier: "heavy" }).route();
  assert.equal(heavy.model, "mefi-zai/glm-5.3");
  assert.match(heavy.via, /heavy tier/);
});

test("a tier on OpenCode's own account never borrows the z.ai key, and z.ai-only without a key fails loudly", async () => {
  const own = await host({ aiProvider: "opencode", executorTier: "heavy" }).route();
  assert.equal(own.cli, "opencode");
  assert.equal(own.modelArgs, "", "no saved heavy model on the Go account: the CLI default runs");
  assert.match(own.via, /heavy tier \(no model saved\)/);
  assert.equal(config(own).provider?.["mefi-zai"], undefined, "an explicit OpenCode pick never injects mefi-zai");
  const keyless = await host({ aiProvider: "zai", executorTier: "fast" }, { zai: false }).route();
  assert.equal(keyless.error, "AI routing is z.ai-only but no z.ai key is saved");
  const managed = await host({ aiProvider: "auto", executorTier: "fast", executorTierModels: { opencode: { fast: "mefi-zai/glm-5.3-flash" } } }, { zai: false }).route();
  assert.match(managed.error, /Fast on the z\.ai plan but no z\.ai key is saved/);
});

test("Free runs the first scan's free model one worker at a time and refuses to fall back to a billed default", async () => {
  const scanned = await host({ aiProvider: "auto", executorTier: "free", firstRun: { builder: { free: true, model: "opencode/nemotron-3.5-lightning-free" } } }).route();
  assert.equal(scanned.model, "opencode/nemotron-3.5-lightning-free");
  assert.equal(scanned.free, true);
  assert.equal(scanned.parallelCap, 1);
  assert.equal(config(scanned).provider?.["mefi-zai"], undefined, "a free Zen model needs no plan key");
  assert.match(scanned.via, /free tier, one at a time/);
  const none = await host({ aiProvider: "auto", executorTier: "free" }).route();
  assert.match(none.error, /Coding tier is Free but no free model is saved for OpenCode/);
  const legacy = await host({ aiProvider: "auto", executorTier: "free", executorModels: { opencode: "opencode/kimi-k2.5-free" } }).route();
  assert.equal(legacy.model, "opencode/kimi-k2.5-free", "a free id pinned before tiers existed still counts as the free model");
});

test("a saved tier model wins over the built-in default and must be provider/model on OpenCode", async () => {
  const saved = await host({ aiProvider: "auto", executorTier: "heavy", executorTierModels: { opencode: { heavy: "opencode/kimi-k3" } } }).route();
  assert.equal(saved.model, "opencode/kimi-k3");
  assert.equal(config(saved).provider?.["mefi-zai"], undefined, "a Go-roster id rides OpenCode's own account, not the plan");
  const bad = host({ aiProvider: "auto", executorTier: "fast", executorTierModels: { opencode: { fast: "glm-5.3-flash" } } });
  const route = await bad.route();
  assert.equal(route.model, "mefi-zai/glm-5.3-flash", "an id without a provider prefix is ignored and the built-in default runs");
  assert.ok(bad.logs.some((line) => /fast tier model for opencode must be provider\/model/.test(line)), "and the feed says so");
});

test("CLI builders take the tier model: Claude Code's aliases, a saved Codex id, and Free refused without one", async () => {
  const claude = await host({ aiProvider: "auto", executorCli: "claude", executorTier: "heavy" }).route();
  assert.equal(claude.cli, "claude");
  assert.equal(claude.model, "opus");
  assert.equal(claude.tier, "heavy");
  assert.match(claude.via, /claude cli · heavy tier \(opus\)/);
  assert.equal(claude.opencode.cli, "opencode", "the opencode fallback route still rides along");
  const fast = await host({ aiProvider: "auto", executorCli: "claude", executorTier: "fast" }).route();
  assert.equal(fast.model, "sonnet");
  const codex = await host({ aiProvider: "auto", executorCli: "codex", executorTier: "fast", executorTierModels: { codex: { fast: "gpt-5.5-codex" } } }).route();
  assert.equal(codex.cli, "codex");
  assert.equal(codex.codex, true);
  assert.equal(codex.model, "gpt-5.5-codex");
  const plain = await host({ aiProvider: "auto", executorCli: "codex", executorTier: "heavy" }).route();
  assert.equal(plain.model, "", "no built-in Codex model: the CLI default runs");
  assert.match(plain.via, /heavy tier \(CLI default\)/);
  const free = await host({ aiProvider: "auto", executorCli: "grok", executorTier: "free" }).route();
  assert.match(free.error, /Coding tier is Free but no free model is saved for grok/);
  const pinned = await host({ aiProvider: "auto", executorCli: "codex", executorModels: { codex: "o5-codex" } }).route();
  assert.equal(pinned.model, "o5-codex", "Auto keeps the pinned per-CLI override");
});

test("a missing builder CLI still falls back to the opencode route, tier and all", async () => {
  const h = host({ aiProvider: "auto", executorCli: "codex", executorTier: "fast" }, { clis: ["opencode"] });
  const route = await h.route();
  assert.equal(route.cli, "opencode");
  assert.equal(route.model, "mefi-zai/glm-5.3-flash");
  assert.match(route.via, /codex missing/);
  assert.deepEqual(h.history, [["fallback", "codex CLI not found — builders on opencode"]]);
});

test("executorTierDefaults says where each tier's model comes from, and the same answer feeds Settings", () => {
  const h = host({ executorTierModels: { claude: { heavy: "claude-opus-5" } }, firstRun: { builder: { free: true, model: "opencode/nemotron-3.5-lightning-free" } } });
  assert.deepEqual(h.defaults("opencode", { zai: true }), {
    free: { model: "opencode/nemotron-3.5-lightning-free", source: "first-scan" },
    fast: { model: "mefi-zai/glm-5.3-flash", source: "zai" },
    heavy: { model: "mefi-zai/glm-5.3", source: "zai" },
  });
  assert.deepEqual(h.defaults("opencode", { zai: false }).fast, { model: "", source: "cli-default" });
  assert.deepEqual(h.defaults("claude"), { free: { model: "", source: "none" }, fast: { model: "sonnet", source: "alias" }, heavy: { model: "claude-opus-5", source: "saved" } });
  assert.deepEqual(h.defaults("codex"), { free: { model: "", source: "none" }, fast: { model: "", source: "cli-default" }, heavy: { model: "", source: "cli-default" } });
  assert.equal(h.env.normalizeExecutorTier("heavy"), "heavy");
  assert.equal(h.env.normalizeExecutorTier("premium"), "auto", "an unknown tier can never wedge the route");
});
