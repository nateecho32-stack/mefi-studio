// The setup helper (renderer/setup-helper.js): one sheet for every agent
// setting. It opens by itself once per REVISION (first run or update), hands
// on to the walkthrough, and every control saves through the host call its
// setting already has. The real file runs here in the shared fake DOM
// against a stand-in bridge that records each call.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/setup-helper.js", import.meta.url), "utf8");
const settle = async () => { for (let turn = 0; turn < 24; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const P = "p1";

function bridge({ team = {}, inherited = true, stale = 0 } = {}) {
  // Copied into this realm: objects built inside the vm carry its own
  // prototypes, which deepStrictEqual would refuse.
  const calls = { rows: [], push(row) { this.rows.push(JSON.parse(JSON.stringify(row))); }, filter(fn) { return this.rows.filter(fn); }, find(fn) { return this.rows.find(fn); } };
  let revision = 4;
  let configuration = { aiProvider: "auto", executorCli: "opencode", executorTier: "auto", ...team };
  const view = (scope) => ({ ok: true, projectId: P, revision, inherited: scope === "defaults" ? true : inherited, name: "Studio defaults", scope,
    configuration: JSON.parse(JSON.stringify(configuration)), presets: [], skills: [{ id: "s1", name: "Release notes", scope: "project" }],
    mcpTools: [{ id: "fs.read", server: "fs", name: "read", description: "Read a file" }], habits: [{ id: "test-changes", title: "Test changes", fires: "when it finishes a change", fallback: "touched", variants: [{ id: "always", text: "Always test." }, { id: "touched", text: "Test what you touched." }], costs: { touched: { brief: 9, full: 24 } } }], seats: {}, choices: {}, routing: { executorTierDefaults: {} } });
  const api = {
    agentsState: async ({ scope }) => { calls.push(["agentsState", scope]); return view(scope); },
    agentsSave: async (payload) => {
      calls.push(["agentsSave", JSON.parse(JSON.stringify(payload))]);
      if (stale > 0) { stale -= 1; revision += 1; return { ok: false, stale: true, error: "Agent settings changed." }; }
      if (payload.revision !== revision) return { ok: false, stale: true, error: "stale" };
      configuration = payload.configuration; revision += 1;
      return view(payload.scope);
    },
    getAiRouting: async () => ({ provider: "auto", executorCli: "opencode", hasZen: false, autoProviders: ["zai", "opencode"], lmStudioEndpoint: "http://127.0.0.1:1234/v1", customEndpoint: "" }),
    getApiKey: async (which) => ({ saved: which === "zen", encrypted: true, via: which === "zen" ? "settings" : null }),
    setApiKey: async (key, which) => { calls.push(["setApiKey", which, key ? "set" : "cleared"]); return { ok: true }; },
    setAiRouting: async (patch) => { calls.push(["setAiRouting", patch]); return { ok: true }; },
    cliSetupStatus: async () => ({ ok: true, selected: "auto", clis: [{ id: "codex", name: "Codex", installed: true, subscription: true }, { id: "opencode", name: "OpenCode", installed: false }] }),
    cliSetupCheck: async (id) => { calls.push(["cliSetupCheck", id]); return { ok: true, message: "Codex answered." }; },
    cliSetupUse: async (id) => { calls.push(["cliSetupUse", id]); return { ok: true }; },
    assistantState: async () => ({ ok: true, state: { status: "running", prefs: { proactive: true, parallel: 8, aiParallel: 4, backlogMode: true } } }),
    assistantStatus: async () => ({ ok: true, status: { enabled: true, execute: true, minutes: 5, parallel: 2, adaptiveParallel: false, mode: "swarm" } }),
    assistantAutopilot: async (prefs) => { calls.push(["assistantAutopilot", prefs]); return { ok: true }; },
    assistantPrefs: async (patch) => { calls.push(["assistantPrefs", patch]); return { ok: true }; },
    backlogStatus: async () => ({ ok: true, draining: true }),
    backlogControl: async (payload) => { calls.push(["backlogControl", payload.action]); return { ok: true }; },
    machineGet: async () => ({ ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }),
    machineSet: async (patch) => { calls.push(["machineSet", patch]); return { ok: true }; },
    updateStatus: async () => ({ ok: true, status: { auto: true } }),
    companionState: async () => ({ ok: true, scope: "project" }),
    prefsGet: async () => ({ ok: true, prefs: {} }),
    jevStatus: async () => ({ enabled: true, route: "zen", routes: { zen: false } }),
    onSettingsChanged: () => {},
  };
  return { api, calls };
}

function load({ store = {}, search = "", options = {} } = {}) {
  const { api, calls } = bridge(options);
  const { document } = createDom();
  const registered = [];
  const events = [];
  const controls = { rows: [], push(row) { this.rows.push(JSON.parse(JSON.stringify(row))); }, at(index) { return this.rows.at(index); } };
  const saved = new Map(Object.entries(store));
  const window = {
    location: { search },
    addEventListener() {}, dispatchEvent: (event) => { events.push([event.type, event.detail]); return true; },
    mefiStudio: api,
    MefiNav: { register: (dest) => { registered.push(dest); return dest; }, claim: (id) => calls.push(["claim", id]), release: (id) => calls.push(["release", id]) },
    MefiWorkspace: { activeProjectId: () => P },
    MefiAgentControls: {
      snapshot: () => ({ newWork: true, enabled: false, parallel: 2, adaptiveParallel: false }),
      refresh: async () => ({ newWork: true, enabled: false, parallel: 2, adaptiveParallel: false }),
      set: async (name, value) => { controls.push([name, value]); return { ok: true }; },
    },
  };
  const localStorage = {
    getItem: (key) => (saved.has(key) ? saved.get(key) : null), setItem: (key, value) => saved.set(key, String(value)),
    get length() { return saved.size; }, key: (index) => [...saved.keys()][index] ?? null,
  };
  const context = vm.createContext({
    window, document, console, localStorage, setTimeout, clearTimeout, setImmediate,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(source, context);
  const helper = window.MefiSetupHelper;
  const overlay = () => document.body.children.find((node) => node.id === "setup-helper-overlay");
  const content = () => overlay()?.querySelector("#setup-helper-content");
  const byText = (root, text, selector = "button") => root.querySelectorAll(selector).find((node) => node.textContent.includes(text));
  const toggleNamed = (text) => content().querySelectorAll(".setup-helper-toggle").find((row) => row.textContent.includes(text))?.querySelector("input");
  return { window, helper, calls, events, registered, controls, saved, overlay, content, byText, toggleNamed };
}

test("the helper registers one sheet destination and a Search entry per section, named by concept", () => {
  const { registered, helper } = load();
  const sheet = registered.find((dest) => dest.id === "setup-helper");
  assert.equal(sheet.kind, "overlay");
  assert.equal(sheet.layer, "sheet");
  assert.equal(sheet.element, "setup-helper-overlay");
  assert.deepEqual(Array.from(helper.sections(), (row) => row.id), ["welcome", "providers", "team", "routing", "run", "permissions", "tools", "system", "look", "finish"]);
  for (const id of helper.sections().map((row) => row.id)) assert.ok(registered.some((dest) => dest.id === `setup-helper:${id}` && dest.kind === "action"), `Search reaches ${id}`);
});

test("a fresh profile gets the helper first; closing it marks this revision seen and hands on to the walkthrough", async () => {
  const { helper, calls, saved } = load();
  let walked = 0;
  assert.equal(helper.startup({ then: () => { walked += 1; } }), true);
  await settle();
  assert.equal(helper.isOpen(), true);
  assert.deepEqual(calls.find((row) => row[0] === "claim"), ["claim", "setup-helper"]);
  helper.close();
  assert.equal(walked, 1, "the walkthrough's own startup runs once the helper closes");
  assert.equal(saved.get("mefiStudio.setupHelper.seen"), helper.REVISION);
  assert.equal(helper.startup({ then: () => { walked += 1; } }), false, "a seen revision never reopens by itself");
  assert.equal(walked, 1);
});

test("a returning profile sees it once after the update; diagnostic launches never do", async () => {
  const returning = load({ store: { "mefiStudio.commandHome": "1" } });
  assert.equal(returning.helper.startup(), true);
  await settle();
  assert.match(returning.content().textContent, /New in this version/);
  assert.match(returning.content().textContent, /Void collection/);
  const capture = load({ search: "?capture=1" });
  assert.equal(capture.helper.startup(), false);
  assert.equal(capture.overlay(), undefined, "a capture never even builds the sheet");
});

test("team changes save the whole team for the chosen scope, and a stale revision reloads and reapplies once", async () => {
  const { helper, calls, content } = load({ options: { team: { modelSelection: "auto", agentBrain: { deskResolves: true, deskTool: false } }, stale: 1 } });
  helper.open("run");
  await settle();
  const deskTool = content().querySelectorAll(".setup-helper-toggle").find((row) => row.textContent.includes("Let workers ask the desk")).querySelector("input");
  deskTool.checked = true;
  await deskTool.trigger("change");
  await settle();
  const saves = calls.filter((row) => row[0] === "agentsSave");
  assert.equal(saves.length, 2, "the first save met a newer revision, so it reloaded and saved again");
  const last = saves.at(-1)[1];
  assert.equal(last.action, "save");
  assert.equal(last.scope, "defaults", "an inheriting project edits the Studio defaults");
  assert.equal(last.projectId, P);
  assert.equal(last.configuration.agentBrain.deskTool, true);
  assert.equal(last.configuration.modelSelection, "jev", "the brain map's old \"auto\" is cleaned so validation passes");
  assert.equal("deskResolves" in last.configuration.agentBrain, false, "the switch nothing reads is not written back");
});

test("the run section drives the queue through MefiAgentControls and the backlog through its own control", async () => {
  const { helper, calls, controls, toggleNamed, byText, content } = load();
  helper.open("run");
  await settle();
  const queue = toggleNamed("Run the queue on its own");
  queue.checked = true;
  await queue.trigger("change");
  await settle();
  assert.deepEqual(controls.at(-1), ["enabled", true]);
  await byText(content(), "Stop working through the backlog").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "backlogControl").at(-1), ["backlogControl", "stop"]);
  const compact = toggleNamed("Compact finished history");
  compact.checked = false;
  await compact.trigger("change");
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "assistantPrefs").at(-1), ["assistantPrefs", { compactHistory: false }]);
});

test("connections save keys and endpoints on their own calls, and a subscription is used only after its check", async () => {
  const { helper, calls, content, byText } = load();
  helper.open("providers");
  await settle();
  const use = byText(content(), "Use for the whole studio");
  assert.equal(use.disabled, true, "use waits for a passing connection check");
  await byText(content(), "Check connection").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "cliSetupCheck").at(-1), ["cliSetupCheck", "codex"]);
  const lmStudio = content().querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "LM Studio server");
  lmStudio.value = "http://127.0.0.1:9999/v1";
  await byText(lmStudio.parentNode, "Save").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "setAiRouting").at(-1), ["setAiRouting", { lmStudioEndpoint: "http://127.0.0.1:9999/v1" }], "only the endpoint, so the host keeps it device-wide");
  const zai = content().querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "z.ai key");
  zai.value = "zai-test-key";
  await byText(zai.parentNode, "Save key").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "setApiKey").at(-1), ["setApiKey", "zai", "set"]);
});

test("more than one login: each login's state, add then sign in, check and remove through the accounts calls", async () => {
  const { window, helper, calls, content, byText } = load();
  const view = { ok: true, providers: [
    { id: "claude", name: "Claude Code", installed: true, max: 6, accounts: [
      { id: "claude-main", label: "Main login", main: true, limited: true, untilText: "3:00 PM", answering: false },
      { id: "claude-a1b2", label: "Work", main: false, limited: false, answering: true },
    ] },
    { id: "codex", name: "Codex", installed: false, max: 6, accounts: [{ id: "codex-main", label: "Main login", main: true, limited: false, answering: true }] },
  ] };
  Object.assign(window.mefiStudio, {
    cliAccounts: async () => view,
    cliAccountAdd: async (payload) => { calls.push(["cliAccountAdd", payload]); return { ...view, ok: true, account: { id: "claude-c3d4", provider: "claude", label: payload.label } }; },
    cliAccountLogin: async (id) => { calls.push(["cliAccountLogin", id]); return { ok: true, message: "Sign-in window opened." }; },
    cliAccountCheck: async (id) => { calls.push(["cliAccountCheck", id]); return { ok: true, message: "Work answered." }; },
    cliAccountRemove: async (id) => { calls.push(["cliAccountRemove", id]); return { ok: true, message: "Work removed." }; },
  });
  helper.open("providers");
  await settle();
  const card = () => content().querySelectorAll("section").find((node) => node.textContent.includes("More than one login"));
  assert.ok(card(), "the card shows for an installed Claude Code");
  assert.doesNotMatch(card().textContent, /Codex/, "a tool that is not installed and holds one login is left out");
  const rows = () => card().querySelectorAll(".setup-helper-login");
  assert.deepEqual(rows().map((row) => row.dataset.state), ["limited", "answering"]);
  assert.match(rows()[0].textContent, /Topped out until 3:00 PM/);
  assert.match(rows()[1].textContent, /Answering now/);
  assert.equal(byText(rows()[0], "Remove"), undefined, "the main login cannot be removed");
  const name = card().querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "Name for the new Claude Code login");
  name.value = "Side";
  await byText(card(), "Add a Claude Code login").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "cliAccountAdd").at(-1), ["cliAccountAdd", { provider: "claude", label: "Side" }]);
  assert.deepEqual(calls.filter((row) => row[0] === "cliAccountLogin").at(-1), ["cliAccountLogin", "claude-c3d4"], "a new login goes straight to its sign-in window");
  await byText(rows()[1], "Check").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "cliAccountCheck").at(-1), ["cliAccountCheck", "claude-a1b2"]);
  await byText(rows()[1], "Remove").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "cliAccountRemove").at(-1), ["cliAccountRemove", "claude-a1b2"]);
  await byText(rows()[0], "Sign in").click();
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "cliAccountLogin").at(-1), ["cliAccountLogin", "claude-main"]);
});

test("without the accounts bridge the connections page reads as before", async () => {
  const { helper, content } = load();
  helper.open("providers");
  await settle();
  assert.equal(content().querySelectorAll("section").some((node) => node.textContent.includes("More than one login")), false);
});

test("machine limits save one validated field at a time", async () => {
  const { helper, calls, content } = load();
  helper.open("system");
  await settle();
  const idle = content().querySelectorAll("input").find((input) => input.getAttribute("aria-label") === "Idle seconds before stopping");
  idle.value = "600";
  await idle.trigger("change");
  await settle();
  assert.deepEqual(calls.filter((row) => row[0] === "machineSet").at(-1), ["machineSet", { idleSeconds: 600 }]);
  idle.value = "5";
  await idle.trigger("change");
  await settle();
  assert.equal(calls.filter((row) => row[0] === "machineSet").length, 1, "an out-of-range value is refused before it reaches the host");
});

test("quick setup walks only connect, permissions and finish; Next on the last step closes", async () => {
  const { helper, overlay, content } = load();
  helper.open("welcome");
  await settle();
  await content().querySelectorAll(".setup-helper-choice").find((choice) => choice.dataset.value === "quick").click();
  const next = overlay().querySelector("#setup-helper-next");
  const walked = [];
  for (let step = 0; step < 4 && helper.isOpen(); step += 1) {
    await next.click(); await settle();
    walked.push(helper.section());
  }
  assert.deepEqual(walked, ["providers", "permissions", "finish", null]);
  assert.equal(helper.isOpen(), false);
});

test("connected() reports the last connections read so the walkthrough can skip its scan stop", async () => {
  const { helper } = load();
  assert.equal(helper.connected(), null, "nothing read yet");
  helper.open("welcome");
  await settle();
  assert.equal(helper.connected(), false, "no key, no CLI route and no local server in this bridge");
});

test("habits save per agent through the team, with the chosen variant and mode", async () => {
  const { helper, calls, content } = load();
  helper.open("tools");
  await settle();
  const mode = content().querySelectorAll("select").find((node) => node.getAttribute("aria-label") === "Test changes: off, brief or full");
  mode.value = "brief";
  await mode.trigger("change");
  await settle();
  const saved = calls.filter((row) => row[0] === "agentsSave").at(-1)[1];
  assert.deepEqual(saved.configuration.agentHabits, { routine: { "test-changes": { variant: "touched", mode: "brief" } } });
});
