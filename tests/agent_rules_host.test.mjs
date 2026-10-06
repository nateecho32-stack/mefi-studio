// Project rules (ZA8) at main.cjs's call sites: every role's model call gets
// the rules block exactly once, whichever function carries it (assistantFetch,
// cliAssistantCall, httpAssistantCall, seatFetch, the builder prompt), and the
// coding CLIs that read AGENTS.md and CLAUDE.md themselves get the owner's text
// only. The real host functions run in a vm against stubs for the model, the
// settings and the project folder; the rules, the files and the tool loop are
// the real modules. tests/agent_rules.test.mjs holds the rules themselves.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { executorHost } from "./fixtures/host_executor.mjs";

const require = createRequire(import.meta.url);
const tools = require("../scripts/agent-tools.cjs");
const profiles = require("../scripts/agent-profiles.cjs");
const addons = require("../scripts/agent-addons.cjs");
const { scrubOutbound } = require("../scripts/redaction.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const between = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `main.cjs still holds ${from}`);
  return source.slice(start, end);
};
async function project(fn) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, "mefi-rules-host-"));
  try {
    await writeFile(path.join(root, "AGENTS.md"), "AGENTS-FILE-CONTENT");
    await writeFile(path.join(root, "CLAUDE.md"), "CLAUDE-FILE-CONTENT");
    await fn(root);
  } finally { assert.equal(path.dirname(root), temp); await rm(root, { recursive: true, force: true }); }
}
const RULES = { text: "OWNER-RULE-TEXT", agents: true, claude: true };
const count = (text, needle) => text.split(needle).length - 1;
// What a model was sent: the rules block once, and each file once.
function assertOnce(system, label) {
  assert.equal(count(system, "Project rules the owner wrote"), 1, `${label}: the rules heading, once`);
  assert.equal(count(system, "OWNER-RULE-TEXT"), 1, `${label}: the owner's text, once`);
  assert.equal(count(system, "AGENTS-FILE-CONTENT"), 1, `${label}: AGENTS.md, once`);
  assert.equal(count(system, "CLAUDE-FILE-CONTENT"), 1, `${label}: CLAUDE.md, once`);
}
const withoutKillSwitch = async (fn) => {
  const before = process.env.MEFI_STUDIO_NO_AGENT_RULES;
  delete process.env.MEFI_STUDIO_NO_AGENT_RULES;
  try { await fn(); } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_AGENT_RULES; else process.env.MEFI_STUDIO_NO_AGENT_RULES = before; }
};

// The model-call functions of the host, as main.cjs has them, over a stubbed wire.
function host(root, settings) {
  const sent = [];
  const context = vm.createContext({
    agentTools: tools, agentProfiles: profiles, agentAddons: addons, scrubOutbound, logLine() {},
    projectRoot: () => root, readSettings: async () => settings, readAgentSettings: async () => profiles.effective(settings, "project", profiles.current()),
    projects: { current: () => ({ id: "project" }), active: () => ({ id: "project" }) },
    assistantState: null, DATA_ONLY_CLIS: new Set(["claude", "codex", "grok", "antigravity"]), applyModelRouting: async (route) => route,
    ZAI_MODEL_HEAVY: "zai-heavy", ZEN_MODEL_HEAVY: "zen-heavy", ZEN_MODEL_ROUTINE: "zen-routine",
    providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider() {}, assistantSessionId: async () => "s", providerSkipped: () => ({ ok: false }),
    resolveAiRoute: async () => ({ ok: true, provider: "custom", model: "fixture", endpoint: "http://fixture.invalid", apiKey: "k", fallbacks: [] }),
    decryptKey: () => "zen-key", zenEndpoint: () => "http://zen.invalid",
    chatCompletion: async (_endpoint, _key, model, body) => { sent.push({ model, system: body.messages[0].content, user: body.messages[1].content }); return { ok: true, text: `answer ${sent.length}`, model }; },
  });
  vm.runInContext(between("async function assistantFetch(", "// Circuit breakers for the host's own model calls"), context);
  vm.runInContext(between("const SEAT_DEFAULTS", "// ---- the Policy Lab's observation-only recorder"), context);
  return { context, sent };
}

test("the assistant's routine and planning roles carry the rules once, through assistantFetch and the direct calls", () => withoutKillSwitch(() => project(async (root) => {
  for (const role of ["routine", "heavy"]) {
    const { context, sent } = host(root, { agentRules: RULES });
    const result = await context.assistantFetch("SYSTEM", "USER", 100, { role });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assertOnce(sent[0].system, `assistantFetch ${role}`);
    assert.ok(sent[0].system.startsWith("SYSTEM"), "the rules are appended, the caller's own prompt comes first");
    assert.doesNotMatch(sent[0].user, /OWNER-RULE-TEXT/, "the rules go in the system prompt, never in the person's message");
  }
  // A caller that reaches the HTTP half directly (planning, brain drafts, the analyzer) is served there, once.
  for (const role of ["routine", "heavy"]) {
    const { context, sent } = host(root, { agentRules: RULES });
    const route = { ok: true, provider: "custom", model: "fixture", endpoint: "http://fixture.invalid", apiKey: "k", fallbacks: [] };
    await context.httpAssistantCall(route, "SYSTEM", "USER", 100, { taskType: "planning-spec", role });
    assertOnce(sent[0].system, `httpAssistantCall ${role}`);
  }
  // The CLI half, through its own completion stub: also once.
  {
    const { context } = host(root, { agentRules: RULES });
    const prompts = [];
    context.claudeCompletion = async (system) => { prompts.push(system); return { ok: true, text: "answer", model: "claude" }; };
    context.recordModelCall = async () => {}; context.autoFallbackEnabled = () => false; context.crypto = { randomUUID: () => "id" };
    await context.cliAssistantCall({ provider: "claude", model: "claude", cli: true }, "SYSTEM", "USER", 100, { role: "heavy", taskType: "planning-plan" });
    assert.equal(prompts.length, 1);
    assertOnce(prompts[0], "cliAssistantCall heavy");
  }
  // A caller that opts out of skills (skillRole: null, a classifier) gets none of the add-ons, as before.
  const quiet = host(root, { agentRules: RULES });
  await quiet.context.assistantFetch("SYSTEM", "USER", 100, { taskType: "relevance", skillRole: null });
  assert.doesNotMatch(quiet.sent[0].system, /OWNER-RULE-TEXT|Project rules/);
  // With no rules set, nothing changes for anyone.
  const none = host(root, {});
  await none.context.assistantFetch("SYSTEM", "USER", 100, { role: "heavy" });
  assert.doesNotMatch(none.sent[0].system, /Project rules|Project file/);
})));

test("every seat carries the rules once, on Zen, on a fallback route and through the tool loop", () => withoutKillSwitch(() => project(async (root) => {
  for (const seat of ["lead", "desk", "companion", "scout", "overseer"]) {
    // A seat on its own Zen route.
    const zen = host(root, { agentSeats: { [seat]: { provider: "zen" } }, agentRules: RULES });
    const answered = await zen.context.seatFetch(seat, "SEAT-SYSTEM", "USER", 100);
    assert.equal(answered.ok, true, seat);
    assert.equal(zen.sent.length, 1, `${seat}: one model call`);
    assertOnce(zen.sent[0].system, `seat ${seat} on zen`);
    // A seat whose provider is out falls back to its caller's route: the seat's prompt goes along, not a second copy.
    const fell = host(root, { agentSeats: { [seat]: { provider: "auto" } }, agentRules: RULES });
    const prompts = [];
    await fell.context.seatFetch(seat, "SEAT-SYSTEM", "USER", 100, { fallback: async (system) => { prompts.push(system); return { ok: true, text: "answer" }; } });
    assert.equal(prompts.length, 1, seat);
    assertOnce(prompts[0], `seat ${seat} on the fallback`);
    // And with nothing to fall back to, assistantFetch answers it without adding a second block.
    const bare = host(root, { agentSeats: { [seat]: { provider: "auto" } }, agentRules: RULES });
    await bare.context.seatFetch(seat, "SEAT-SYSTEM", "USER", 100);
    assert.equal(bare.sent.length, 1, seat);
    assertOnce(bare.sent[0].system, `seat ${seat} through assistantFetch`);
  }
  // A research turn (the tool loop asks for a file, then answers) still carries them once on each round.
  const settings = { agentSeats: { lead: { provider: "zen" } }, agentTools: { lead: { webSearch: false, webRead: false, projectRead: true } }, agentRules: RULES };
  const looped = host(root, settings);
  let turns = 0;
  looped.context.chatCompletion = async (_e, _k, model, body) => { turns++; looped.sent.push({ system: body.messages[0].content }); return { ok: true, text: turns === 1 ? '{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"AGENTS.md"}}]}' : "final", model }; };
  const result = await looped.context.seatFetch("lead", "SEAT-SYSTEM", "USER", 100);
  assert.equal(result.text, "final"); assert.equal(looped.sent.length, 2);
  for (const [round, call] of looped.sent.entries()) {
    assert.equal(count(call.system, "Project rules the owner wrote"), 1, `round ${round + 1}`);
    assert.equal(count(call.system, "OWNER-RULE-TEXT"), 1, `round ${round + 1}`);
  }
  // Rules the owner saved for another agent's project settings reach only the team that holds them (a project with no team follows the defaults).
  const other = host(root, { agentTeams: { version: 1, revision: 1, projects: { project: { name: "Team", configuration: { agentRules: { text: "TEAM-RULE" } } } }, presets: [] }, agentRules: { text: "DEFAULT-RULE" } });
  await other.context.seatFetch("desk", "S", "U", 100, { fallback: async (system) => { other.sent.push({ system }); return { ok: true, text: "x" }; } });
  assert.match(other.sent[0].system, /TEAM-RULE/); assert.doesNotMatch(other.sent[0].system, /DEFAULT-RULE/);
})));

test("the kill switch keeps every model call as it was before rules", () => project(async (root) => {
  const before = process.env.MEFI_STUDIO_NO_AGENT_RULES;
  try {
    process.env.MEFI_STUDIO_NO_AGENT_RULES = "1";
    const { context, sent } = host(root, { agentRules: RULES, agentSeats: { lead: { provider: "zen" } } });
    await context.assistantFetch("SYSTEM", "USER", 100, { role: "heavy" });
    await context.seatFetch("lead", "SEAT-SYSTEM", "USER", 100);
    assert.equal(sent.length, 2);
    for (const call of sent) assert.doesNotMatch(call.system, /OWNER-RULE-TEXT|Project rules|FILE-CONTENT/);
  } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_AGENT_RULES; else process.env.MEFI_STUDIO_NO_AGENT_RULES = before; }
}));

// The builder's prompt is built in spawnNextJob; its route says which CLI runs it.
// The host's own model-id filters are what a CLI's command line uses.
const filters = between("function cliModelArg(", "// The Claude Code CLI as an assistant route") + between("function agyModelArg(", "// The Antigravity CLI as an assistant route");
async function builderPrompt(root, route, settings = { agentRules: RULES }) {
  const h = executorHost({ tasks: [{ id: "build", title: "Fixture card", prompt: "Build the fixture.", status: "open", createdAt: 1, files: ["src/build.js"] }] });
  vm.runInContext(filters, h.env);
  // Grok is a .cmd shim the host runs through cmd.exe, and Antigravity's agy is spawned directly: the fixture takes both.
  h.env.windowsShim = (name) => (name === "grok" ? "C:\\Users\\John Smith\\AppData\\Roaming\\npm\\grok.cmd" : null);
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => (command === "agy" ? spawn("cmd.exe", ["/d", "/s", "/c", "fixture agy"], options) : spawn(command, args, options));
  h.env.agentAddons = addons; h.env.scrubOutbound = scrubOutbound; h.env.readAgentSettings = async () => settings; h.env.projectRoot = () => root;
  h.env.executorRunEnv = async () => ({ via: `${route.cli} fixture`, modelArgs: "", env: {}, ...route });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  return entry.promptFile ? h.runFiles().get(entry.promptFile) : h.starts[0].child.prompt;
}

test("a builder on Claude Code, Codex or OpenCode gets the owner's text, never the files it reads itself", () => withoutKillSwitch(() => project(async (root) => {
  for (const route of [{ cli: "claude", claude: true }, { cli: "codex", codex: true }, { cli: "opencode" }]) {
    const prompt = await builderPrompt(root, route);
    assert.equal(count(prompt, "OWNER-RULE-TEXT"), 1, `${route.cli}: the owner's text, once`);
    assert.equal(count(prompt, "Project rules the owner wrote"), 1, route.cli);
    assert.doesNotMatch(prompt, /AGENTS-FILE-CONTENT|CLAUDE-FILE-CONTENT|Project file/, `${route.cli} reads those files itself`);
    assert.match(prompt, /Build the fixture\./, "the task is still in it");
    assert.ok(prompt.indexOf("Project rules") < prompt.indexOf("Build the fixture."), "the rules come before the brief");
  }
})));

test("a builder on Grok or Antigravity, which Studio cannot count on to read the files, gets them", () => withoutKillSwitch(() => project(async (root) => {
  for (const route of [{ cli: "grok", grok: true, model: "grok-4" }, { cli: "antigravity", antigravity: true }]) {
    const prompt = await builderPrompt(root, route);
    assertOnce(prompt, route.cli);
    assert.match(prompt, /Build the fixture\./);
  }
})));

test("a builder with no rules, or with the kill switch on, gets the prompt it always did", () => project(async (root) => {
  const before = process.env.MEFI_STUDIO_NO_AGENT_RULES;
  try {
    delete process.env.MEFI_STUDIO_NO_AGENT_RULES;
    for (const route of [{ cli: "claude", claude: true }, { cli: "grok", grok: true }]) {
      const plain = await builderPrompt(root, route, {});
      assert.doesNotMatch(plain, /Project rules|Project file|FILE-CONTENT/, route.cli);
      process.env.MEFI_STUDIO_NO_AGENT_RULES = "1";
      const killed = await builderPrompt(root, route);
      assert.equal(killed, plain, `${route.cli}: the switch gives back exactly the plain prompt`);
      delete process.env.MEFI_STUDIO_NO_AGENT_RULES;
    }
  } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_AGENT_RULES; else process.env.MEFI_STUDIO_NO_AGENT_RULES = before; }
}));

test("the team's rules are the run's: a builder started under a snapshot keeps them when the settings change", () => withoutKillSwitch(() => project(async (root) => {
  const settings = { agentRules: { text: "RULES-AT-DISPATCH" } };
  const snapshot = profiles.capture(settings, "project");
  settings.agentRules = { text: "RULES-LATER" };
  const running = profiles.effective(settings, "project", snapshot);
  const prompt = await builderPrompt(root, { cli: "claude", claude: true }, running);
  assert.match(prompt, /RULES-AT-DISPATCH/); assert.doesNotMatch(prompt, /RULES-LATER/);
})));

test("main.cjs sends the card what it needs and takes the rules-only save, without touching the provider breaker for it", () => {
  assert.match(source, /const rulesInfo = await agentAddons\.rulesState\(projectRoot\(\), \{ files: scope !== "defaults" \}\)/);
  assert.match(source, /mcpTools, habits, rulesInfo,/, "agents:state returns it");
  assert.match(source, /const allowed = preset \? \["preset-save", "preset-delete", "apply"\] : \["save", "inherit", "rules"\];/);
  assert.match(source, /if \(payload\.action !== "rules"\) providerBreaker\.reset\(\);/);
  // The builder's prompt reads the run's own team (captured at dispatch) with how the owner uses skills today,
  // and the task's words, so a /skill-name in them brings that skill (agent-addons.cjs namedSkills).
  assert.match(source, /const builderSettings = entry\.agentConfiguration\?\.configuration \? \{ \.\.\.entry\.agentConfiguration\.configuration, skillUse: typeof readSettings === "function" \? \(await readSettings\(\)\.catch\(\(\) => \(\{\}\)\)\)\?\.skillUse : undefined \} : await readAgentSettings\(\);/);
  assert.match(source, /const ownerWords = job\.ref\?\.origin\?\.by === "owner" && typeof job\.ref\?\.prompt === "string" \? job\.ref\.prompt : "";/, "only words the owner wrote can name a skill for the builder");
  assert.match(source, /agentAddons\.instructions\(projectRoot\(\), builderSettings, "builder", \{ cli: runRoute\?\.cli, text: ownerWords \}\)/);
  // Every other call site names its own role and passes no CLI: nothing else can be given "the CLI reads it".
  const sites = [...source.matchAll(/agentAddons\.instructions\(([^\n]*)\)\)/g)].map((match) => match[1]);
  assert.equal(sites.length, 5, "assistantFetch, cliAssistantCall, httpAssistantCall, seatFetch and the builder: no sixth caller has gone unchecked");
  assert.equal(sites.filter((site) => site.includes("cli:")).length, 1);
});
