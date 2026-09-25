// The 0.4.0 seats (main.cjs seatChoice): the lead and the desk answer on GPT 6
// Sol through Zen at medium reasoning effort unless the owner's
// settings.agentSeats say otherwise. Lifted from main.cjs with its constant.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import profiles from "../scripts/agent-profiles.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const heavy = source.match(/const ZEN_MODEL_HEAVY = "([^"]+)";/)[1];
const routine = source.match(/const ZEN_MODEL_ROUTINE = "([^"]+)";/)[1];
const context = vm.createContext({ ZEN_MODEL_HEAVY: heavy, ZEN_MODEL_ROUTINE: routine });
vm.runInContext(source.slice(source.indexOf("const SEAT_DEFAULTS"), source.indexOf("async function seatFetch(")), context);
const seatChoice = vm.runInContext("seatChoice", context);

test("both seats default to GPT 6 Sol on Zen at medium effort", () => {
  assert.equal(heavy, "gpt-6-sol");
  for (const seat of ["lead", "desk"]) assert.deepEqual({ ...seatChoice({}, seat) }, { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false });
  assert.deepEqual({ ...seatChoice(null, "unknown") }, { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false });
});

test("the companion and scout default to Luna on Zen's fast tier", () => {
  assert.deepEqual({ ...seatChoice({}, "companion") }, { provider: "zen", model: "gpt-6-luna", effort: "medium", fast: true });
  assert.deepEqual({ ...seatChoice({}, "scout") }, { provider: "zen", model: "gpt-6-luna", effort: "low", fast: true });
});

test("a saved seat overrides model and effort, and a bad effort falls back", () => {
  const settings = { agentSeats: { lead: { model: "gpt-6-luna", effort: "high" }, desk: { effort: "turbo" } } };
  assert.deepEqual({ ...seatChoice(settings, "lead") }, { provider: "zen", model: "gpt-6-luna", effort: "high", fast: false });
  assert.deepEqual({ ...seatChoice(settings, "desk") }, { provider: "zen", model: "gpt-6-sol", effort: "medium", fast: false });
  assert.equal(seatChoice({ agentSeats: { lead: { provider: "auto" } } }, "lead").provider, "auto");
});

test("a seat can run at max effort on Zen's fast tier", () => {
  const settings = { agentSeats: { desk: { model: "gpt-6-luna", effort: "max", fast: true }, lead: { effort: "xhigh", fast: "yes" } } };
  assert.deepEqual({ ...seatChoice(settings, "desk") }, { provider: "zen", model: "gpt-6-luna", effort: "max", fast: true });
  assert.deepEqual({ ...seatChoice(settings, "lead") }, { provider: "zen", model: "gpt-6-sol", effort: "xhigh", fast: false });
});

test("seats select other providers without leaking their route into the rest of the team", async () => {
  for (const provider of ["openrouter", "zai", "opencode", "claude", "lmstudio", "custom"]) {
    const settings = { aiProvider: "zen", aiModels: { heavy: "old-model" }, agentSeats: { companion: { provider, model: "selected-model", effort: "", fast: false } } };
    const calls = [], options = [];
    const host = vm.createContext({
      ZEN_MODEL_HEAVY: heavy, ZEN_MODEL_ROUTINE: routine, agentProfiles: profiles,
      projects: { current: () => ({ id: "project" }) }, readSettings: async () => settings,
      readAgentSettings: async () => profiles.effective(settings, "project", profiles.current()),
      DATA_ONLY_CLIS: new Set(["claude"]), scrubOutbound: (value) => value,
      resolveAiRoute: async (role, allowed) => { options.push(allowed); const config = profiles.current().configuration; return { ok: true, provider: config.aiRoleProviders[role], model: config.aiModelsByProvider[provider][role], cli: provider === "claude" }; },
      httpAssistantCall: async (...args) => { calls.push(args); return { ok: true }; }, cliAssistantCall: async (...args) => { calls.push(args); return { ok: true }; },
    });
    vm.runInContext(source.slice(source.indexOf("const SEAT_DEFAULTS"), source.indexOf("// ---- the Policy Lab's observation-only recorder")), host);
    assert.equal((await host.seatFetch("companion", "System", "Message")).ok, true);
    assert.equal(calls[0][0].provider, provider); assert.equal(calls[0][0].model, "selected-model");
    assert.deepEqual([...options[0].allowCli], ["claude"]);
    assert.equal(settings.aiProvider, "zen"); assert.equal(settings.aiModels.heavy, "old-model");
    assert.equal(profiles.current(), null);
  }
});

test("seat validation rejects unsupported fast mode and coding-only CLIs", () => {
  assert.equal(profiles.validate({ agentSeats: { companion: { provider: "openrouter", model: "openai/gpt-6-fixture", effort: "high", fast: false, modelsByProvider: { zen: "gpt-6-luna" } } } }), null);
  assert.match(profiles.validate({ agentSeats: { companion: { provider: "openrouter", model: "openai/gpt-fixture", fast: true } } }), /Fast mode/);
  assert.match(profiles.validate({ agentSeats: { companion: { provider: "codex" } } }), /text-only/);
  assert.equal(seatChoice({ agentSeats: { companion: { provider: "openrouter" } } }, "companion").fast, false);
});

test("an inherited seat retains its own skills without adopting the route role's skills", async () => {
  const settings = { agentSeats: { desk: { provider: "auto" } } }, calls = [];
  const host = vm.createContext({ ZEN_MODEL_HEAVY: heavy, ZEN_MODEL_ROUTINE: routine,
    agentProfiles: profiles, projects: { current: () => ({ id: "p" }) }, readSettings: async () => settings,
    readAgentSettings: async () => settings, projectRoot: () => "/fixture", scrubOutbound: (text) => text,
    agentAddons: { instructions: async (_root, _settings, role) => { assert.equal(role, "desk"); return "\nDesk skill"; } },
    assistantFetch: async (...args) => { calls.push(args); return { ok: true }; },
  });
  vm.runInContext(source.slice(source.indexOf("const SEAT_DEFAULTS"), source.indexOf("// ---- the Policy Lab's observation-only recorder")), host);
  await host.seatFetch("desk", "System", "Help");
  assert.equal(calls[0][0], "System\nDesk skill"); assert.equal(calls[0][3].skillRole, null);
  await host.seatFetch("desk", "System", "Help", 1000, { fallback: (system, fromSeat) => { assert.equal(system, "System\nDesk skill"); assert.equal(fromSeat, true); return { ok: true }; } });
});

test("preload carries supported Fast and effort choices for every configured seat", async () => {
  let bridge;
  const sent = [];
  const electron = { contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) }, ipcRenderer: { invoke: (...args) => { sent.push(args); return Promise.resolve({ ok: true }); }, on() {} }, webUtils: {} };
  const page = { require: () => electron };
  vm.runInNewContext(await readFile(new URL("../preload.cjs", import.meta.url), "utf8"), page);
  bridge = page.mefiStudio;
  for (const seat of ["lead", "desk", "companion", "scout", "overseer"]) {
    await bridge.brainSettingsSave({ seats: { [seat]: { provider: "zen", model: "gpt-6-sol", effort: "max", fast: true } } });
    assert.equal(sent.at(-1)[0], "brain:settings-save");
    assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1)[1].seats[seat])), { model: "gpt-6-sol", effort: "max", fast: true, provider: "zen" });
  }
});
