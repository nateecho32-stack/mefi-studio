import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Auto setup is a pure planner: it sees saved-key flags and CLI install
// results, decides the same settings the Studio controls write, and returns
// reasons. No filesystem, process or network boundary is involved here.
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("function normalizeAutoProviders(");
const to = main.indexOf("// Pick who pays", from);
assert.ok(from >= 0 && to > from, "planAutoSetup must exist in main.cjs");
const context = vm.createContext({ AI_AUTO_PROVIDERS: ["zai", "opencode", "zen", "openrouter", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"] });
vm.runInContext(main.slice(from, to), context);
const planAutoSetup = context.planAutoSetup;
const plain = (value) => JSON.parse(JSON.stringify(value));

const cli = (id, installed) => ({ id, name: id, installed, source: installed ? `C:\\bin\\${id}.exe` : null });

for (const provider of ["codex", "claude", "grok", "antigravity"]) test(`auto setup keeps the chosen ${provider} subscription even when other providers exist`, () => {
  const plan = planAutoSetup({ settings: { aiProvider: provider, executorCli: "opencode" }, keys: { zai: true, zen: true }, clis: [cli(provider, true), cli("opencode", true)] });
  assert.equal(plan.active.provider, provider);
  assert.equal(plan.active.executorCli, provider);
  assert.equal(plan.active.modelSelection, "fixed");
});

test("auto setup prefers the saved z.ai key and explains every choice", () => {
  const plan = planAutoSetup({
    settings: {},
    keys: { zai: true, opencode: true, gateway: false },
    clis: [cli("opencode", true)],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "zai", modelSelection: "fixed" });
  assert.deepEqual(plain(plan.active), { provider: "zai", modelSelection: "fixed", executorCli: "opencode" });
  const notes = plan.notes.join(" ");
  assert.match(notes, /z\.ai key found/);
  assert.match(notes, /No Jev (gateway )?key/);
  assert.match(notes, /OpenCode CLI found/);
  assert.doesNotMatch(notes, /OpenCode Go key found/, "the unused OpenCode key is not the reported route");
});

test("a gateway key enables Jev selection and a missing OpenCode CLI moves builders to Grok", () => {
  const plan = planAutoSetup({
    settings: { aiProvider: "zai", modelSelection: "jev", executorCli: "opencode" },
    keys: { opencode: true, gateway: true },
    clis: [cli("grok", true)],
  });
  assert.deepEqual(plain(plan.changes), { provider: "opencode", executorCli: "grok" });
  assert.equal(plan.active.modelSelection, "jev");
  const notes = plan.notes.join(" ");
  assert.match(notes, /OpenCode Go key found/);
  assert.match(notes, /task-aware model selection is on/);
  assert.match(notes, /builders run through Grok/);
});

test("every Jev route's key enables task-aware selection", () => {
  for (const keys of [{ zai: true, jev: true }, { zai: true, gateway: true }, { zai: true, zen: true }, { zai: true, openrouter: true }]) {
    const plan = planAutoSetup({ settings: {}, keys, clis: [cli("opencode", true)] });
    assert.equal(plan.active.modelSelection, "jev");
    assert.match(plan.notes.join(" "), /Jev key found: task-aware model selection is on/);
  }
  const none = planAutoSetup({ settings: {}, keys: { zai: true }, clis: [cli("opencode", true)] });
  assert.equal(none.active.modelSelection, "fixed");
  assert.match(none.notes.join(" "), /No Jev key/);
});

test("an OpenRouter key alone sets up the free router as the assistant default", () => {
  const plan = planAutoSetup({ settings: {}, keys: { openrouter: true }, clis: [] });
  assert.equal(plan.ok, true);
  assert.equal(plan.active.provider, "openrouter");
  assert.equal(plan.active.modelSelection, "jev");
  assert.equal(plan.changes.jevRoute, "openrouter");
  assert.match(plan.notes.join(" "), /free models router by default/);
});

test("a Grok-only machine configures the CLI login route without inventing a key", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [cli("grok", true)] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "grok", modelSelection: "fixed", executorCli: "grok" });
  assert.match(plan.notes.join(" "), /Grok CLI's own login/);
  assert.doesNotMatch(plan.notes.join(" "), /key found/);
});

test("a Claude-only machine configures the subscription route and Claude builders", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [cli("claude", true)] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "claude", modelSelection: "fixed", executorCli: "claude" });
  const notes = plan.notes.join(" ");
  assert.match(notes, /Claude Code CLI's own subscription login/);
  assert.match(notes, /builders run through Claude Code/);
  assert.doesNotMatch(notes, /key found/);
});

test("an Antigravity-only machine configures the agy login route and Antigravity builders", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [cli("antigravity", true)] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "antigravity", modelSelection: "fixed", executorCli: "antigravity" });
  const notes = plan.notes.join(" ");
  assert.match(notes, /Antigravity CLI's own Google account login/);
  assert.match(notes, /builders run through Antigravity/);
  assert.doesNotMatch(notes, /key found/);
});

test("a Codex-only machine configures the ChatGPT login route and Codex builders", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [cli("codex", true)] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "codex", modelSelection: "fixed", executorCli: "codex" });
  const notes = plan.notes.join(" ");
  assert.match(notes, /Codex CLI's own ChatGPT login/);
  assert.match(notes, /builders run through Codex/);
  assert.doesNotMatch(notes, /key found/);
});

test("Claude Code outranks Codex as the fallback builder when both are installed and OpenCode is not", () => {
  const plan = planAutoSetup({ settings: {}, keys: { zai: true }, clis: [cli("codex", true), cli("claude", true)] });
  assert.equal(plan.active.provider, "zai", "a saved key still leads the assistant route");
  assert.equal(plan.active.executorCli, "claude");
  assert.match(plan.notes.join(" "), /Claude Code CLI found: builders run through Claude Code/);
});

test("a machine with no keys or CLIs is still set up from a local server or custom endpoint", () => {
  const local = planAutoSetup({ settings: {}, keys: {}, clis: [], local: { lmstudio: true } });
  assert.equal(local.ok, true);
  assert.deepEqual(plain(local.changes), { provider: "lmstudio", modelSelection: "fixed" });
  assert.match(local.notes.join(" "), /LM Studio is reachable/);
  const custom = planAutoSetup({ settings: {}, keys: { custom: true }, clis: [], local: { custom: true } });
  assert.equal(custom.active.provider, "custom");
  assert.match(custom.notes.join(" "), /custom endpoint answers/);
  assert.equal(planAutoSetup({ settings: {}, keys: {}, clis: [], local: {} }).ok, false, "nothing detected is still refused honestly");
});

test("an empty machine is refused with guidance instead of a partial configuration", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [] });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /save a z\.ai.*key/);
  assert.equal(plan.changes, undefined);
});

test("an already-configured machine reports no changes and keeps the current builder", () => {
  const plan = planAutoSetup({
    settings: { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode" },
    keys: { zai: true, gateway: false },
    clis: [cli("opencode", true)],
  });
  assert.deepEqual(plain(plan.changes), {});
  assert.deepEqual(plain(plan.active), { provider: "zai", modelSelection: "fixed", executorCli: "opencode" });
});

test("an armed fallback with no second usable provider is turned off and the input settings are never mutated", () => {
  const settings = { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode", aiAutoFallback: true };
  const plan = planAutoSetup({ settings, keys: { zai: true, gateway: false }, clis: [] });
  assert.deepEqual(plain(plan.changes), { autoFallback: false });
  assert.match(plan.notes.join(" "), /fallback turned off/);
  assert.equal(settings.aiAutoFallback, true, "the planner describes changes; the host applies them");
});

test("an armed fallback stays while the auto order lists a second usable provider", () => {
  const settings = { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode", aiAutoFallback: true };
  const plan = planAutoSetup({ settings, keys: { zai: true, opencode: true }, clis: [cli("opencode", true)] });
  assert.deepEqual(plain(plan.changes), {});
  assert.doesNotMatch(plan.notes.join(" "), /fallback turned off/);
  const narrowed = planAutoSetup({ settings: { ...settings, aiAutoProviders: ["zai"] }, keys: { zai: true, opencode: true }, clis: [cli("opencode", true)] });
  assert.deepEqual(plain(narrowed.changes), { autoFallback: false }, "only providers in the saved order can be the second leg");
});

test("the legacy aiFallbackOpenCode flag still arms the auto fallback", () => {
  const plan = planAutoSetup({
    settings: { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode", aiFallbackOpenCode: true },
    keys: { zai: true, opencode: true },
    clis: [cli("opencode", true)],
  });
  assert.deepEqual(plain(plan.changes), {});
  assert.doesNotMatch(plan.notes.join(" "), /fallback turned off/);
});

test("no detected builder leaves the saved executor alone and says so", () => {
  const plan = planAutoSetup({
    settings: { executorCli: "grok" },
    keys: { zai: true, gateway: false },
    clis: [],
  });
  assert.equal(plan.active.executorCli, "grok");
  assert.equal(plan.changes.executorCli, undefined);
  assert.match(plan.notes.join(" "), /No builder CLI detected/);
});

test("only a pristine settings file lets the first launch run auto setup by itself", () => {
  const needs = context.firstLaunchNeedsSetup;
  assert.equal(typeof needs, "function", "firstLaunchNeedsSetup must sit beside the planner in main.cjs");
  assert.equal(needs({}), true);
  assert.equal(needs(undefined), true);
  assert.equal(needs({ zaiApiKeyEncrypted: "x", aiModels: { routine: "glm" } }), true, "a saved key alone is not a configuration choice");
  for (const saved of [{ aiProvider: "zai" }, { executorCli: "claude" }, { modelSelection: "fixed" }, { firstRun: { version: 1 } }, { autoSetup: { at: 1 } }]) {
    assert.equal(needs(saved), false, `${Object.keys(saved)[0]} hands control back to Settings`);
  }
});

test("an OpenCode Zen key alone sets up the assistant, and Jev rides that same key", () => {
  const plan = planAutoSetup({ settings: {}, keys: { zen: true }, clis: [cli("opencode", true)] });
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.active.provider, "zen");
  assert.equal(plan.changes.jevRoute, "zen", "Jev leaves the keyless Vercel default for the route whose key is here");
  assert.equal(plan.active.modelSelection, "jev");
  const notes = plan.notes.join(" ");
  assert.match(notes, /OpenCode Zen key found: the assistant bills your Zen balance/);
  assert.match(notes, /Jev is connected, but task-aware selection only covers z\.ai GLM and OpenCode Go work/, "the note never claims per-task picks Zen cannot get");
  assert.match(notes, /Jev rides your OpenCode Zen key/);
  const both = planAutoSetup({ settings: {}, keys: { zen: true, openrouter: true }, clis: [] });
  assert.equal(both.active.provider, "zen", "the Zen key leads OpenRouter for the assistant");
  assert.equal(both.changes.jevRoute, "zen");
});

test("Jev is only 'on' when the route it answers on has its key, and a saved route is never moved", () => {
  const typesafe = planAutoSetup({ settings: {}, keys: { zai: true, jev: true }, clis: [] });
  assert.equal(typesafe.changes.jevRoute, "typesafe");
  const gateway = planAutoSetup({ settings: {}, keys: { zai: true, gateway: true, zen: true }, clis: [] });
  assert.equal(gateway.changes.jevRoute, undefined, "the gateway key keeps the default route");
  const pinned = planAutoSetup({ settings: { jevRoute: "vercel" }, keys: { zai: true, zen: true }, clis: [] });
  assert.equal(pinned.changes.jevRoute, undefined, "the owner's saved route stays");
  assert.equal(pinned.active.modelSelection, "fixed", "and with no key on it, Jev is not claimed");
  assert.match(pinned.notes.join(" "), /No Jev key required/);
  const openrouter = planAutoSetup({ settings: {}, keys: { openrouter: true }, clis: [] });
  assert.match(openrouter.notes.join(" "), /OpenRouter keeps its default or saved model/, "OpenRouter's note is as accurate as Zen's");
  const zai = planAutoSetup({ settings: {}, keys: { zai: true, zen: true }, clis: [] });
  assert.match(zai.notes.join(" "), /task-aware model selection is on for z\.ai GLM models/);
});

test("a keyless local server is set up: a saved custom endpoint, or Ollama on its default port", () => {
  const ollama = planAutoSetup({ settings: {}, keys: {}, clis: [], local: { ollama: true } });
  assert.equal(ollama.ok, true);
  assert.equal(ollama.active.provider, "custom");
  assert.equal(ollama.changes.customEndpoint, "http://127.0.0.1:11434/v1");
  assert.match(ollama.notes.join(" "), /Ollama is running on this machine/);
  const saved = planAutoSetup({ settings: { customEndpoint: "http://127.0.0.1:8080/v1" }, keys: {}, clis: [], local: { custom: true, ollama: true } });
  assert.equal(saved.active.provider, "custom");
  assert.equal(saved.changes.customEndpoint, undefined, "an endpoint the owner saved is never replaced");
  const lmstudio = planAutoSetup({ settings: {}, keys: {}, clis: [], local: { lmstudio: true, ollama: true } });
  assert.equal(lmstudio.active.provider, "lmstudio", "LM Studio still leads a local Ollama");
  assert.match(planAutoSetup({ settings: {}, keys: {}, clis: [] }).error, /OpenCode Zen.*LM Studio or Ollama/);
});

test("a Zen key is a second usable leg for the armed fallback", () => {
  const plan = planAutoSetup({ settings: { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode", aiAutoFallback: true, aiAutoProviders: ["zai", "zen"] }, keys: { zai: true, zen: true }, clis: [cli("opencode", true)] });
  assert.equal(plan.changes.autoFallback, undefined);
});
