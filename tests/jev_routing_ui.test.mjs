import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
// The shared renderer DOM stand-in, so a template restructure lands in one
// place instead of nineteen private copies. See tests/fixtures/renderer-dom.mjs.
import { Element } from "./fixtures/renderer-dom.mjs";


const source = await readFile(new URL("../renderer/booklet.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const studio = source.slice(source.indexOf("  function initStudio()"), source.indexOf("  // ---- wire up ----"));
// The save handlers announce a saved connection through this IIFE-scoped
// helper, which sits above initStudio; the slice below starts inside it, so
// pull the definition in alongside the studio body.
const announce = source.slice(source.indexOf("  const noteConnectionSaved"), source.indexOf("  // Global toasts"));
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function environment(overrides = {}, bridge = {}) {
  const ids = new Map(); const writes = []; const logs = [];
    for (const match of template.matchAll(/\bid="([^"]+)"/g)) ids.set(match[1], new Element());
  const settings = { provider: "auto", autoProviders: ["zai", "opencode"], autoFallback: false, models: {}, executorCli: "opencode", executorModel: "", modelSelection: "jev", jevConfigured: false, jevRoute: "vercel", routingDecision: null, ...overrides };
  let reads = 0;
  const saved = [];
  const routeLabels = { vercel: "Vercel AI Gateway", typesafe: "TypeSafe Jev API", zen: "OpenCode Zen", openrouter: "OpenRouter" };
  const routeModels = { vercel: "typesafe-ai/jev", typesafe: "jev-1.13.0", zen: "jev-1.13", openrouter: "typesafe/jev-1.13" };
  const api = {
    launchStudio() {}, onStudioLog() {},
    getApiKey: async () => ({ saved: true }),
    setApiKey: async (_key, provider) => {
      saved.push(provider);
      if (["gateway", "jev", "zen", "openrouter"].includes(provider)) settings.jevConfigured = true;
      return { ok: true };
    },
    jevStatus: async () => ({
      enabled: false, configured: settings.jevConfigured, route: settings.jevRoute,
      routeLabel: routeLabels[settings.jevRoute],
      routes: { vercel: settings.jevConfigured, typesafe: false, zen: false, openrouter: false },
      model: routeModels[settings.jevRoute],
    }),
    jevSetEnabled: async () => ({ ok: true }),
    jevSetRoute: async (route) => { settings.jevRoute = route; return { ok: true }; },
    cliStatus: async () => [],
    getAiRouting: async () => { reads += 1; return structuredClone(settings); },
    setAiRouting: async (payload) => { writes.push(structuredClone(payload)); Object.assign(settings, payload); return { ok: true }; },
    ...bridge,
  };
  const document = { getElementById: (id) => ids.get(id) || null, createElement: (tag) => new Element(tag), querySelectorAll: () => [] };
  const context = vm.createContext({ document, window: { mefiStudio: api }, state: { doc: { models: [] } }, updateSpeedModels() {}, studioLog: (line) => logs.push(line) });
  vm.runInContext(`${announce}\n${studio}\ninitStudio();`, context);
  return { get: (id) => ids.get(id), settings, writes, saved, api, logs, reads: () => reads };
}

test("Jev mode without a gateway key shows its fallback and keeps configured overrides", async () => {
  const env = environment({ models: { routine: "explicit-model", heavy: "explicit-heavy" } }); await flush();
  assert.equal(env.get("ai-model-selection").value, "jev");
  assert.equal(env.get("ai-model-routine").value, "explicit-model");
  assert.equal(env.get("ai-model-heavy").value, "explicit-heavy");
  assert.match(env.get("ai-routing-status").textContent, /waiting for a Jev key.*usual defaults/);
  assert.match(env.get("ai-routing-decision").textContent, /No selection recorded/);
  assert.equal(env.get("ai-routing-evidence").hidden, true);
  assert.equal(env.reads(), 1);
  assert.deepEqual(env.writes, []);
});

test("selection mode saves independently of provider and refreshing preserves unsaved model text", async () => {
  const env = environment({ provider: "zai", jevConfigured: true }); await flush();
  env.get("ai-model-heavy").value = "unsaved-heavy";
  env.get("ai-model-selection").value = "fixed";
  await env.get("ai-model-selection").trigger("change");
  assert.deepEqual(env.writes, [{ modelSelection: "fixed" }]);
  assert.equal(env.settings.provider, "zai");
  assert.match(env.get("ai-routing-status").textContent, /Fixed defaults enabled/);
  await env.get("ai-routing-refresh").trigger("click");
  assert.equal(env.get("ai-model-heavy").value, "unsaved-heavy");
  assert.equal(env.writes.length, 1, "refresh does not request a model or change settings");
});

test("saving the gateway key refreshes routing readiness independently of intake classification", async () => {
  const env = environment(); await flush();
  env.get("jev-key").value = "fixture-key";
  await env.get("save-jev-key").trigger("click");
  assert.equal(env.get("jev-key").value, "");
  assert.match(env.get("ai-routing-status").textContent, /Jev model selection ready/);
  assert.equal(env.get("jev-enabled").checked, false);
  assert.equal(env.writes.length, 0);
  assert.equal(env.reads(), 2);
});

test("the Jev route saves through IPC and each route stores its own key", async () => {
  const env = environment({ jevRoute: "typesafe" }); await flush();
  assert.equal(env.get("jev-route").value, "typesafe");
  assert.match(env.get("jev-key").placeholder, /TypeSafe Jev API key/);
  assert.match(env.get("jev-status").textContent, /TypeSafe Jev API/);
  env.get("jev-key").value = "fixture-typesafe-key";
  await env.get("save-jev-key").trigger("click");
  assert.deepEqual(env.saved, ["jev"], "the direct route saves the Jev API key field");
  assert.equal(env.settings.jevRoute, "typesafe", "saving a key never switches the route");
  env.get("jev-route").value = "vercel";
  await env.get("jev-route").trigger("change");
  assert.equal(env.settings.jevRoute, "vercel", "route changes save through jev:set-route");
  assert.deepEqual(env.writes, [], "the route is not part of the AI routing patch");
  assert.match(env.get("jev-key").placeholder, /Vercel gateway API key/);
  env.get("jev-key").value = "fixture-gateway-key";
  await env.get("save-jev-key").trigger("click");
  assert.deepEqual(env.saved, ["jev", "gateway"], "the gateway route saves the gateway key field");
  for (const [route, label, placeholder, field] of [
    ["zen", "OpenCode Zen", /OpenCode Zen API key/, "zen"],
    ["openrouter", "OpenRouter", /OpenRouter API key/, "openrouter"],
  ]) {
    env.get("jev-route").value = route;
    await env.get("jev-route").trigger("change");
    assert.equal(env.settings.jevRoute, route);
    assert.match(env.get("jev-key").placeholder, placeholder, `${label} names its own key field`);
    assert.match(env.get("jev-status").textContent, new RegExp(label));
    env.get("jev-key").value = `fixture-${route}-key`;
    await env.get("save-jev-key").trigger("click");
    assert.equal(env.saved.at(-1), field, `${label} saves its own key field`);
  }
});

test("last model selection separates reported measurements, missing values and catalog estimates", async () => {
  const env = environment({ jevConfigured: true, routingDecision: {
    provider: "opencode", model: "fixture-model", taskType: "planning", method: "jev", at: 1700000000000,
    reason: "<b>Chosen for the task</b>",
    evidence: { measured: { task: { samples: 2, latencyMs: { median: 1234 }, throughputTokensPerSecond: { median: 12.5 }, costUsd: { mean: null }, quality: { human: { meanOutOf5: 4 }, model: { meanOutOf5: null } } } }, catalog: { quality: { index: 51 }, pricingEstimate: { default: { input: 0.5, output: 2, condition: "off-peak" } } } },
  } }); await flush();
  assert.match(env.get("ai-routing-decision").textContent, /Jev selected · opencode \/ fixture-model · planning/);
  assert.match(env.get("ai-routing-decision").textContent, /<b>Chosen for the task<\/b>/);
  assert.equal(env.get("ai-routing-decision").innerHTML, undefined, "remote text is never interpreted as HTML");
  const text = env.get("ai-routing-evidence").textContent;
  assert.match(text, /this task type, 2 calls.*1\.23 s.*12\.5 tokens\/s/);
  assert.match(text, /reported cost unknown.*human rating 4\.0\/5.*model rating unknown/);
  assert.match(text, /catalog price estimate: \$0\.5 input \/ \$2 output per million tokens \(off-peak\)/);
  assert.doesNotMatch(text, /reported cost \$0/);
});

test("latest status read wins, failures are visible, and the refresh control recovers", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const env = environment({}, { getAiRouting: () => (++reads === 1 ? first : second).promise });
  const refresh = env.get("ai-routing-refresh").trigger("click");
  second.resolve({ provider: "grok", modelSelection: "jev", jevConfigured: true }); await refresh;
  first.resolve({ provider: "auto", modelSelection: "fixed" }); await flush();
  assert.match(env.get("ai-routing-status").textContent, /Grok CLI uses your explicit model/);
  env.api.getAiRouting = async () => { throw new Error("offline"); };
  await env.get("ai-routing-refresh").trigger("click");
  assert.match(env.get("ai-routing-status").textContent, /status unavailable/);
  assert.equal(env.get("ai-routing-refresh").disabled, false);
});

test("worker evidence identifies HTTP-only timing and incomplete billing coverage", async () => {
  const env = environment({ routingDecision: {
    provider: "zai", model: "fixture-worker", taskType: "coding", method: "jev", reason: "Suitable model",
    evidence: { measured: { overall: { samples: 4, costUsd: { samples: 1, mean: 0.04, unknownRecords: 3 } } }, catalog: { quality: { index: 51, source: "AA", version: "4.0" } } },
  } }); await flush();
  const text = env.get("ai-routing-evidence").textContent;
  assert.match(text, /mean reported cost \$0\.04 \(1 reported, 3 unknown\)/);
  assert.match(text, /Catalog quality: 51 \(AA 4\.0\)/);
  assert.match(text, /catalog price estimate: unknown/);
  assert.match(text, /Studio HTTP requests; CLI worker timing and billing are not measured/);
});

test("failed routing saves expose an error without claiming the new mode is active", async () => {
  const env = environment({}, { setAiRouting: async () => ({ ok: false, error: "storage unavailable" }) }); await flush();
  env.get("ai-model-selection").value = "fixed";
  await env.get("ai-model-selection").trigger("change");
  assert.match(env.get("ai-routing-status").textContent, /Could not save routing: storage unavailable.*saved selection is unchanged/);
  assert.equal(env.settings.modelSelection, "jev");
});

test("auto setup reports the host summary, its reasons, and re-reads the applied routing", async () => {
  let runs = 0;
  const env = environment({}, {
    autoSetup: async () => {
      runs += 1;
      return { ok: true, applied: true, summary: "Assistant on z.ai GLM, Jev model selection, builders on OpenCode.", notes: ["z.ai key found: the assistant uses your z.ai plan.", "Jev gateway key found: task-aware model selection is on."] };
    },
  }); await flush();
  await env.get("auto-setup").trigger("click");
  assert.equal(runs, 1);
  const text = env.get("auto-setup-status").textContent;
  assert.match(text, /Assistant on z\.ai GLM, Jev model selection, builders on OpenCode\./);
  assert.match(text, /z\.ai key found.*task-aware model selection is on/);
  assert.equal(env.get("auto-setup").disabled, false, "the control recovers after the host call");
  assert.equal(env.reads(), 2, "the controls re-read the routing the host applied");
});

test("auto setup refuses honestly when nothing is connected and never claims success", async () => {
  const env = environment({}, { autoSetup: async () => ({ ok: false, error: "Nothing to set up yet - save a z.ai or OpenCode Go key." }) }); await flush();
  await env.get("auto-setup").trigger("click");
  assert.match(env.get("auto-setup-status").textContent, /could not finish: Nothing to set up yet/);
  assert.doesNotMatch(env.get("auto-setup-status").textContent, /Assistant on/);
  assert.equal(env.reads(), 1, "a refused setup does not pretend routing changed");
});

test("auto setup holds its control while the host call is in flight and ignores extra clicks", async () => {
  const pending = deferred();
  let runs = 0;
  const env = environment({}, { autoSetup: () => { runs += 1; return pending.promise; } }); await flush();
  const click = env.get("auto-setup").trigger("click");
  await flush();
  assert.equal(env.get("auto-setup").disabled, true);
  assert.match(env.get("auto-setup-status").textContent, /Checking saved keys/);
  await env.get("auto-setup").trigger("click");
  assert.equal(runs, 1, "a second click while the first is pending is ignored");
  pending.resolve({ ok: true, summary: "Already set up - assistant on z.ai GLM." });
  await click; await flush();
  assert.equal(env.get("auto-setup").disabled, false);
  assert.match(env.get("auto-setup-status").textContent, /Already set up/);
});

test("the setup overview mirrors saved keys, model selection and installed CLIs without new probes", async () => {
  const env = environment(
    { provider: "zai", hasZai: true, hasOpenCode: false, jevConfigured: true, modelSelection: "jev" },
    { cliStatus: async () => [{ id: "opencode", name: "OpenCode", installed: true }, { id: "grok", name: "Grok", installed: false }] },
  ); await flush();
  assert.match(env.get("setup-assistant").textContent, /z\.ai GLM · key saved/);
  assert.match(env.get("setup-selection").textContent, /Jev · task fit, speed & cost/);
  assert.match(env.get("setup-builders").textContent, /OpenCode installed/);
  assert.equal(env.reads(), 1);
  assert.equal(env.writes.length, 0, "the overview is read-only");
});

test("CLI, local and custom providers explain themselves and save their endpoints", async () => {
  const claude = environment({ provider: "claude" }); await flush();
  assert.match(claude.get("ai-routing-status").textContent, /Claude Code CLI uses your explicit model/);
  assert.equal(claude.get("setup-assistant").textContent, "Claude Code CLI · CLI login");

  const antigravity = environment({ provider: "antigravity" }, { cliStatus: async () => [{ id: "antigravity", name: "Antigravity", installed: true }] }); await flush();
  assert.match(antigravity.get("ai-routing-status").textContent, /Antigravity CLI uses your explicit model/);
  assert.equal(antigravity.get("setup-assistant").textContent, "Antigravity CLI · CLI login");
  assert.match(antigravity.get("provider-readiness").textContent, /CLI installed/);

  const missing = environment({ provider: "antigravity" }, { cliStatus: async () => [{ id: "antigravity", name: "Antigravity", installed: false }] }); await flush();
  assert.match(missing.get("provider-readiness").textContent, /CLI not found — you can still save its model/);

  const local = environment({ provider: "lmstudio", lmStudioEndpoint: "http://127.0.0.1:1234/v1/chat/completions" }); await flush();
  assert.match(local.get("ai-routing-status").textContent, /LM Studio answers from the local server/);
  assert.equal(local.get("lmstudio-endpoint").value, "http://127.0.0.1:1234/v1/chat/completions");
  local.get("lmstudio-endpoint").value = "http://127.0.0.1:5555/v1";
  await local.get("lmstudio-endpoint").trigger("change");
  assert.deepEqual(local.writes, [{ lmStudioEndpoint: "http://127.0.0.1:5555/v1" }]);

  const custom = environment({ provider: "custom", hasCustom: true, customEndpoint: "https://api.example.com/v1/chat/completions" }); await flush();
  assert.match(custom.get("ai-routing-status").textContent, /custom endpoint answers with the saved key/);
  assert.equal(custom.get("setup-assistant").textContent, "Custom endpoint · key saved");
  custom.get("custom-endpoint").value = "";
  await custom.get("custom-endpoint").trigger("change");
  assert.deepEqual(custom.writes, [{ customEndpoint: "" }]);
});

test("models follow the selected provider and save into that provider's own slot", async () => {
  const settings = {
    provider: "zai", hasZai: true, hasOpenCode: false, modelSelection: "jev", jevConfigured: false, autoFallback: false,
    autoProviders: ["zai", "opencode"],
    executorCli: "opencode", executorModel: "", routingDecision: null,
    models: { routine: "global-routine", heavy: "global-heavy" },
    providerModels: { zai: { routine: "glm-scoped" }, grok: { routine: "grok-4" } },
  };
  const env = environment({}, {
    getAiRouting: async () => structuredClone(settings),
    setAiRouting: async (payload) => {
      env.writes.push(structuredClone(payload));
      if (payload.providerModels) {
        for (const [provider, roles] of Object.entries(payload.providerModels)) settings.providerModels[provider] = { ...(settings.providerModels[provider] ?? {}), ...roles };
      } else {
        Object.assign(settings, payload);
      }
      return { ok: true };
    },
  });
  await flush();
  assert.equal(env.get("ai-model-routine").value, "glm-scoped", "the provider's saved model wins");
  assert.equal(env.get("ai-model-heavy").value, "global-heavy", "an unset provider role shows the role-wide fallback");

  env.get("ai-model-routine").value = "glm-new";
  await env.get("ai-model-routine").trigger("change");
  assert.deepEqual(env.writes[0], { providerModels: { zai: { routine: "glm-new" } } });

  env.get("ai-provider").value = "grok";
  await env.get("ai-provider").trigger("change");
  assert.deepEqual(env.writes[1], { provider: "grok" });
  assert.equal(env.get("ai-model-routine").value, "grok-4", "switching provider loads that provider's model");
  assert.equal(env.get("ai-model-heavy").value, "", "CLI routes never inherit the role-wide fallback");

  env.get("ai-model-routine").value = "grok-5";
  await env.get("ai-model-routine").trigger("change");
  assert.deepEqual(env.writes[2], { providerModels: { grok: { routine: "grok-5" } } });

  env.get("ai-provider").value = "auto";
  await env.get("ai-provider").trigger("change");
  assert.equal(env.get("ai-model-routine").value, "global-routine", "auto keeps the role-wide overrides");
  env.get("ai-model-routine").value = "global-new";
  await env.get("ai-model-routine").trigger("change");
  assert.deepEqual(env.writes[4], { models: { routine: "global-new" } });
});

test("builder models are saved per CLI", async () => {
  const env = environment({ provider: "auto", executorCli: "grok", executorModel: "grok-4" }); await flush();
  assert.equal(env.get("executor-model").value, "grok-4");
  env.get("executor-model").value = "grok-5";
  await env.get("executor-model").trigger("change");
  assert.deepEqual(env.writes, [{ executorModels: { grok: "grok-5" } }]);
  env.get("executor-cli").value = "antigravity";
  await env.get("executor-cli").trigger("change");
  assert.deepEqual(env.writes[1], { executorCli: "antigravity" });
});

test("the coding tier saves on its own and the model field follows the tier and the builder", async () => {
  const executorTierDefaults = {
    opencode: { free: { model: "opencode/nemotron-3.5-lightning-free", source: "first-scan" }, fast: { model: "mefi-zai/glm-5.3-flash", source: "zai" }, heavy: { model: "mefi-zai/glm-5.3", source: "zai" } },
    claude: { free: { model: "", source: "none" }, fast: { model: "sonnet", source: "alias" }, heavy: { model: "opus", source: "alias" } },
    codex: { free: { model: "", source: "none" }, fast: { model: "", source: "cli-default" }, heavy: { model: "", source: "cli-default" } },
  };
  const env = environment({ executorCli: "opencode", executorModel: "", executorTier: "fast", executorTierModels: { opencode: {} }, executorTierDefaults }); await flush();
  assert.equal(env.get("executor-tier").value, "fast");
  assert.equal(env.get("executor-model-label").textContent, "Fast model");
  assert.equal(env.get("executor-model").value, "", "no saved fast model: the field is empty and the placeholder says what runs");
  assert.match(env.get("executor-model").placeholder, /mefi-zai\/glm-5\.3-flash · on your z\.ai plan/);
  const status = () => env.get("executor-tier-status").textContent;
  assert.match(status(), /Fast tier: OpenCode runs mefi-zai\/glm-5\.3-flash/);
  assert.doesNotMatch(status(), /leaves no session/, "OpenCode builders are verified from their own sessions");
  assert.match(status(), /Free → opencode\/nemotron-3\.5-lightning-free \(from the first scan\)/);
  assert.match(status(), /Heavy → mefi-zai\/glm-5\.3 \(on your z\.ai plan\)/);
  env.get("executor-model").value = "mefi-zai/glm-5.3";
  await env.get("executor-model").trigger("change");
  assert.deepEqual(env.writes[0], { executorTierModels: { opencode: { fast: "mefi-zai/glm-5.3" } } }, "a tier model saves under its CLI and tier");
  env.get("executor-tier").value = "heavy";
  await env.get("executor-tier").trigger("change");
  assert.deepEqual(env.writes[1], { executorTier: "heavy" });
  assert.equal(env.get("executor-model-label").textContent, "Heavy model");
  assert.match(env.get("executor-model").placeholder, /mefi-zai\/glm-5\.3 · on your z\.ai plan/);
  env.get("executor-cli").value = "claude";
  await env.get("executor-cli").trigger("change");
  assert.deepEqual(env.writes[2], { executorCli: "claude" });
  assert.match(env.get("executor-model").placeholder, /opus · Claude Code alias/, "switching builders shows that CLI's own tier default");
  assert.match(status(), /Heavy tier: Claude Code runs opus/);
  assert.match(status(), /Claude Code leaves no session Studio can check, so its finished tasks wait for you to confirm them\./);
  env.get("executor-tier").value = "free";
  await env.get("executor-tier").trigger("change");
  assert.match(status(), /Free tier: no free model is saved for Claude Code, so builds wait/);
  env.get("executor-cli").value = "codex";
  await env.get("executor-cli").trigger("change");
  env.get("executor-tier").value = "auto";
  await env.get("executor-tier").trigger("change");
  assert.equal(env.get("executor-model-label").textContent, "Pinned model");
  assert.match(status(), /Auto: Codex runs the pinned model or its CLI default/);
  env.get("executor-model").value = "gpt-5.5-codex";
  await env.get("executor-model").trigger("change");
  assert.deepEqual(env.writes.at(-1), { executorModels: { codex: "gpt-5.5-codex" } }, "Auto keeps the pinned per-CLI override");
});

test("the auto order renders as a numbered preference list and saves whole-list edits", async () => {
  const env = environment({ provider: "auto", autoProviders: ["zai", "grok", "opencode"] }); await flush();
  const list = env.get("auto-order-list");
  assert.deepEqual(list.children.map((row) => row.dataset.provider), ["zai", "grok", "opencode"]);
  assert.deepEqual(list.children.map((row) => row.children[0].textContent), ["1", "2", "3"], "positions show the effective order");
  assert.deepEqual(list.children.map((row) => row.children[1].textContent), ["z.ai GLM", "Grok CLI", "OpenCode Go"]);
  assert.equal(list.children[0].children[2].disabled, true, "the first entry cannot move up");
  assert.equal(list.children[2].children[3].disabled, true, "the last entry cannot move down");
  await list.children[1].children[2].trigger("click");
  assert.deepEqual(env.writes, [{ autoProviders: ["grok", "zai", "opencode"] }]);
  assert.deepEqual(env.get("auto-order-list").children.map((row) => row.dataset.provider), ["grok", "zai", "opencode"], "the reordered list is re-read from the host");
});

test("each role picks its own provider and its model field follows that provider", async () => {
  const env = environment({ provider: "zai", roleProviders: { routine: "zen", heavy: "claude" }, providerModels: { zen: { routine: "gpt-6-luna" }, claude: { heavy: "claude-opus-5-5" }, zai: { routine: "zai-routine", heavy: "zai-heavy" } } }); await flush();
  assert.equal(env.get("ai-role-routine").value, "zen");
  assert.equal(env.get("ai-role-heavy").value, "claude");
  assert.equal(env.get("ai-model-routine").value, "gpt-6-luna", "the routine field edits the provider routine answers through");
  assert.equal(env.get("ai-model-heavy").value, "claude-opus-5-5");
  assert.match(env.get("ai-routing-status").textContent, /Heavy passes answer via Claude Code CLI; Routine passes answer via OpenCode Zen\./);
  env.get("ai-model-heavy").value = "claude-opus-5";
  await env.get("ai-model-heavy").trigger("change");
  assert.deepEqual(env.writes.at(-1), { providerModels: { claude: { heavy: "claude-opus-5" } } }, "a heavy model saves under the heavy role's provider, not the main pick");
  env.get("ai-role-heavy").value = "";
  await env.get("ai-role-heavy").trigger("change");
  assert.deepEqual(env.writes.at(-1), { roleProviders: { heavy: "" } }, "Same as above clears the role");
});

test("role fields name their provider, show what runs when empty, and Zen reads as a keyed route", async () => {
  const env = environment({ provider: "zen", hasZen: true, zenKeySource: "env", roleProviders: { routine: "", heavy: "claude" },
    roleModels: { routine: { provider: "zen", model: "gpt-6-luna", source: "default" }, heavy: { provider: "claude", model: "", source: "provider" } } }); await flush();
  assert.equal(env.get("model-scope-note").textContent, "on OpenCode Zen");
  assert.equal(env.get("model-heavy-scope").textContent, "on Claude Code CLI");
  assert.equal(env.get("ai-model-routine").placeholder, "gpt-6-luna · default", "the placeholder is the model that runs");
  assert.equal(env.get("ai-model-heavy").placeholder, "CLI default");
  assert.equal(env.get("ai-role-routine").children[0].textContent, "Same as above — OpenCode Zen", "Same as above names the main pick");
  assert.match(env.get("provider-readiness").textContent, /^key saved — this provider's saved model applies/, "Zen is a keyed route, not a missing CLI");
  assert.equal(env.get("zen-key-status").textContent, "key from environment");
  assert.equal(env.get("setup-assistant").textContent, "OpenCode Zen · key saved · plans on Claude Code CLI");
  env.get("zen-key").value = "fixture-zen-key";
  const reads = env.reads();
  await env.get("save-zen-key").trigger("click");
  assert.deepEqual(env.saved, ["zen"], "the tile saves the one Zen credential");
  assert.equal(env.get("zen-key").value, "");
  assert.ok(env.reads() > reads, "a Zen save re-reads routing");
});

test("the auto order adds and removes providers and never leaves it empty", async () => {
  const env = environment({ provider: "auto", autoProviders: ["zai"] }); await flush();
  const add = env.get("auto-order-add");
  assert.deepEqual(add.children.map((option) => option.value), ["opencode", "zen", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"], "the picker lists exactly the missing providers");
  add.value = "opencode";
  await env.get("auto-order-add-button").trigger("click");
  assert.deepEqual(env.writes, [{ autoProviders: ["zai", "opencode"] }]);
  const list = env.get("auto-order-list");
  assert.deepEqual(list.children.map((row) => row.dataset.provider), ["zai", "opencode"]);
  await list.children[0].children[4].trigger("click");
  assert.deepEqual(env.writes[1], { autoProviders: ["opencode"] });
  assert.equal(env.get("auto-order-add-button").disabled, false, "removing frees the provider for the picker again");
  await env.get("auto-order-list").children[0].children[4].trigger("click");
  assert.equal(env.writes.length, 2, "the last provider cannot be removed");
});

test("the fallback switch saves the generalized auto fallback and auto readiness names the order", async () => {
  const env = environment(
    { provider: "auto", autoProviders: ["opencode", "zai", "custom"], hasZai: true, hasOpenCode: false, hasCustom: false },
    { getApiKey: async (which) => ({ saved: which === "zai" }) },
  ); await flush();
  assert.equal(env.get("ai-fallback").checked, false);
  assert.equal(env.get("setup-assistant").textContent, "Auto (your order) · will use z.ai GLM");
  assert.match(env.get("provider-readiness").textContent, /auto order: OpenCode Go \(unavailable\) → z\.ai GLM → Custom endpoint \(unavailable\)/);
  env.get("ai-fallback").checked = true;
  await env.get("ai-fallback").trigger("change");
  assert.deepEqual(env.writes, [{ autoFallback: true }]);
});
