// "Use for the whole studio" (main.cjs setup:cli-use, scripts/cli-setup.cjs
// singleProviderEverywhere): the Studio defaults and every project team saved
// on this PC move to the one subscription, each project keeping its own rules
// and name, and the reply counts the project teams it switched. The pure
// helpers run on their own; the IPC handler runs as main.cjs has it, in a vm
// with the settings store, the CLI probe and the push stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import cliSetup from "../scripts/cli-setup.cjs";
import profiles from "../scripts/agent-profiles.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
// Values made inside the vm have that realm's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

const GAME_RULES = { text: "Never touch the save files under saves/.", agents: true };
// A PC with three projects: two saved a team of their own, the third follows
// the defaults. A stray "project_none" entry is not a project.
function studio() {
  return {
    aiProvider: "zen", aiRoleProviders: { routine: "zen", heavy: "zai" }, aiAutoProviders: ["zen", "zai"], aiAutoFallback: true, executorCli: "opencode",
    // Per-kind-of-job routes (a newer team field) to another tool.
    agentKinds: { "coding-explore": { cli: "codex", model: "gpt-6-luna" } },
    agentRules: { text: "Studio-wide rule." },
    zenApiKeyEncrypted: "saved-key-stays",
    agentTeams: {
      version: 1, revision: 4,
      presets: [{ id: "preset_a", name: "Saved preset", configuration: { aiProvider: "zai" } }],
      projects: {
        project_game: { name: "Game team", configuration: { aiProvider: "openrouter", aiRoleProviders: { routine: "openrouter", heavy: "zen" }, aiAutoProviders: ["openrouter", "zen"], aiAutoFallback: true, executorCli: "codex", agentSeats: { lead: { provider: "zen", model: "gpt-6.1-sol", effort: "medium", fast: false } }, agentKinds: { "coding-explore": { cli: "grok", model: "grok-5" } }, agentRules: GAME_RULES } },
        project_site: { name: "Project team", configuration: { aiProvider: "zai", executorCli: "grok", aiModelsByProvider: { claude: { routine: "claude-haiku-5", heavy: "claude-opus-5" } } } },
        project_none: { name: "Stray", configuration: { aiProvider: "zai" } },
      },
    },
  };
}
const SEATS = ["lead", "desk", "companion", "scout", "overseer"];
function assertOneProvider(configuration, provider, label) {
  assert.equal(configuration.aiProvider, provider, label);
  assert.deepEqual(plain(configuration.aiRoleProviders), { routine: provider, heavy: provider }, label);
  assert.deepEqual(plain(configuration.aiAutoProviders), [provider], label);
  assert.equal(configuration.aiAutoFallback, false, `${label}: nothing else answers`);
  assert.equal(configuration.executorCli, provider, label);
  assert.equal("agentKinds" in configuration, false, `${label}: no kind of job is routed to another tool`);
  assert.deepEqual(Object.keys(configuration.agentSeats).sort(), [...SEATS].sort(), label);
  assert.ok(SEATS.every((seat) => configuration.agentSeats[seat].provider === provider), `${label}: every seat`);
  assert.equal(profiles.validate(profiles.extract(plain(configuration))), null, `${label}: still a valid team`);
}

test("every saved project team takes the subscription, keeping its own rules and name", () => {
  const settings = studio();
  const before = structuredClone(settings);
  const switched = cliSetup.singleProviderEverywhere(settings, "claude", profiles);
  assert.equal(switched, 2, "the two project teams, not the stray placeholder");
  assertOneProvider(settings, "claude", "Studio defaults");
  assert.deepEqual(settings.agentRules, before.agentRules, "the defaults keep their rules");
  assert.equal(settings.zenApiKeyEncrypted, "saved-key-stays", "keys are device settings and stay");
  const { projects } = settings.agentTeams;
  assertOneProvider(projects.project_game.configuration, "claude", "game team");
  assertOneProvider(projects.project_site.configuration, "claude", "site team");
  assert.deepEqual(projects.project_game.configuration.agentRules, GAME_RULES, "a project's rules are its own words and never change here");
  assert.equal("agentRules" in projects.project_site.configuration, false, "a project without rules does not pick up the defaults' rules");
  assert.deepEqual([projects.project_game.name, projects.project_site.name], ["Game team", "Project team"]);
  // Each team is rewritten from its own saved copy: the site's own Claude models fill its seats.
  assert.equal(projects.project_site.configuration.agentSeats.companion.model, "claude-haiku-5");
  assert.equal(projects.project_site.configuration.agentSeats.lead.model, "claude-opus-5");
  assert.equal(projects.project_game.configuration.agentSeats.lead.model, "claude-opus-5-5", "a team with no Claude models of its own takes the subscription's tier models");
  assert.deepEqual(projects.project_none, before.agentTeams.projects.project_none, "the placeholder entry is left alone");
  assert.deepEqual(settings.agentTeams.presets, before.agentTeams.presets, "saved presets are templates, not teams in use");
  assert.equal(settings.agentTeams.revision, 6, "one revision bump per team rewritten, as agentProfiles.update does");
  // A project that inherits the defaults follows them; an Agents draft opened before the switch is stale.
  assert.equal(profiles.view(settings, "project_docs").inherited, true);
  assert.equal(profiles.view(settings, "project_docs").configuration.aiProvider, "claude");
  const draft = profiles.mutate(settings, { action: "save", scope: "project", revision: 4, configuration: { aiProvider: "zen" } }, { projectId: "project_game" });
  assert.equal(draft.stale, true, "the old draft cannot save the old providers back");
});

test("with no project teams only the defaults change, and no revision is spent", () => {
  const settings = { aiProvider: "zen", agentTeams: { version: 1, revision: 2, projects: {}, presets: [] } };
  assert.equal(cliSetup.singleProviderEverywhere(settings, "codex", profiles), 0);
  assertOneProvider(settings, "codex", "defaults");
  assert.equal(settings.agentTeams.revision, 2);
  assert.equal(cliSetup.singleProviderEverywhere({}, "grok", null), 0, "a host without agent profiles switches the defaults alone");
  assert.deepEqual(profiles.projectTeams({}), []);
  assert.deepEqual(profiles.projectTeams(studio()), ["project_game", "project_site"]);
});

test("the message names the tool and counts the project teams in plain words", () => {
  const tail = "Its model access and usage limits still apply.";
  assert.equal(cliSetup.wholeStudioMessage("claude", 0), `Claude Code now handles chat, mapping, planning, every agent seat and coding across the studio. ${tail}`);
  assert.equal(cliSetup.wholeStudioMessage("codex", 1), `Codex now handles chat, mapping, planning, every agent seat and coding across the studio, including the one project that has its own team. ${tail}`);
  assert.equal(cliSetup.wholeStudioMessage("antigravity", 3), `Antigravity now handles chat, mapping, planning, every agent seat and coding across the studio, including the 3 projects that have their own team. ${tail}`);
});

// main.cjs's handler, run as written.
function handlerHost(settings, installed = ["claude"]) {
  const handlers = new Map(), sent = [];
  const state = { settings, resets: 0, writes: 0 };
  const context = vm.createContext({
    Date,
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    cliSetup, agentProfiles: profiles,
    codingCliStatus: async () => ["claude", "codex", "grok", "antigravity"].map((id) => ({ id, installed: installed.includes(id) })),
    updateSettings: async (mutate) => {
      const next = structuredClone(state.settings);
      if (mutate(next) !== false) { state.settings = next; state.writes += 1; }
      return state.settings;
    },
    providerBreaker: { reset: () => { state.resets += 1; } },
    send: (channel, payload) => sent.push([channel, payload]),
  });
  vm.runInContext(section('  ipcMain.handle("setup:cli-use",', "  // Several logins per coding CLI (the block beside cliAccountTurn)"), context);
  return { use: handlers.get("setup:cli-use"), state, sent };
}

test("setup:cli-use switches the defaults and every project team, and says how many", async () => {
  const host = handlerHost(studio());
  const reply = plain(await host.use(null, "claude"));
  assert.deepEqual({ ok: reply.ok, provider: reply.provider, projects: reply.projects }, { ok: true, provider: "claude", projects: 2 });
  assert.equal(reply.message, cliSetup.wholeStudioMessage("claude", 2));
  assert.match(reply.message, /including the 2 projects that have their own team/);
  const saved = host.state.settings;
  assertOneProvider(saved, "claude", "saved defaults");
  for (const id of ["project_game", "project_site"]) assertOneProvider(saved.agentTeams.projects[id].configuration, "claude", id);
  assert.deepEqual(saved.agentTeams.projects.project_game.configuration.agentRules, GAME_RULES);
  // firstRun is written as before: the scan, the builder and the judge all on the subscription.
  assert.equal(saved.firstRun.version, 1);
  assert.deepEqual(plain(saved.firstRun.explorer), { transport: "assistant", provider: "claude", model: null, reason: "Use the selected subscription with the local project scan." });
  assert.deepEqual(plain(saved.firstRun.builder), { cli: "claude", model: null });
  assert.equal(saved.firstRun.judge.kind, "assistant");
  assert.equal(host.state.writes, 1, "one settings transaction");
  assert.equal(host.state.resets, 1, "the breakers start fresh for the new route");
  assert.deepEqual(plain(host.sent), [["settings:changed", { source: "subscription-setup" }]]);
});

test("setup:cli-use refuses an unknown or missing tool and changes nothing", async () => {
  const host = handlerHost(studio(), []);
  assert.deepEqual(plain(await host.use(null, "opencode")), { ok: false, error: "Choose a subscription CLI." });
  assert.deepEqual(plain(await host.use(null, "codex")), { ok: false, error: "Install this tool before using it." });
  assert.equal(host.state.writes, 0);
  assert.deepEqual(plain(host.state.settings), plain(studio()));
  assert.equal(host.sent.length, 0);
});
