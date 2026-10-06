// The host's "Skills and connectors everywhere" block (main.cjs): the real block run against a real temporary
// project, the real skill catalog and policy, the real connectors module on a temporary home, with only settings,
// the window and Electron's encryption replaced. skills:use / skills:set-use (the Skills page and the chat's style
// picker), skills:copy-builtin, chat:tools (the message box's chip), chatUsed (the chips under a reply), the
// connectors:* calls with MEFI_STUDIO_NO_CONNECTORS=1, and the tool loop's skill provider.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));
const addons = mainRequire("./scripts/agent-addons.cjs");
const tools = mainRequire("./scripts/agent-tools.cjs");
const format = mainRequire("./scripts/skill-format.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function host({ settings = {}, env = {}, skills = {} } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "mefi-skills-connectors-host-"));
  const project = path.join(base, "project"), userData = path.join(base, "userData"), home = path.join(base, "home");
  await mkdir(project, { recursive: true }); await mkdir(userData, { recursive: true }); await mkdir(home, { recursive: true });
  // The real catalog, with an empty home folder in place of this PC's.
  const withHome = (options) => ({ home, ...(options ?? {}) });
  const scopedAddons = { ...addons, skillCatalog: (root, options) => addons.skillCatalog(root, withHome(options)), autoSkills: (root, settings, role, options) => addons.autoSkills(root, settings, role, withHome(options)), loadSkill: (root, settings, role, name, options) => addons.loadSkill(root, settings, role, name, withHome(options)), alwaysNames: (root, settings, role, options) => addons.alwaysNames(root, settings, role, withHome(options)) };
  for (const [name, [description, body]] of Object.entries(skills)) {
    await mkdir(path.join(project, ".agents", "skills", name), { recursive: true });
    await writeFile(path.join(project, ".agents", "skills", name, "SKILL.md"), format.build({ name, description, body }));
  }
  const current = { settings: structuredClone(settings) };
  const sent = [], created = [];
  const context = vm.createContext({
    require: mainRequire, process: { env: { ...env } }, Buffer, Promise, console, path, structuredClone,
    projects: { open: () => ({ id: "p1" }) }, projectRoot: () => project,
    readSettings: async () => structuredClone(current.settings), readAgentSettings: async () => structuredClone(current.settings),
    updateSettings: async (change) => { const next = structuredClone(current.settings); if (change(next) !== false) current.settings = next; return structuredClone(current.settings); },
    send: (channel, data) => sent.push([channel, plain(data)]),
    agentAddons: scopedAddons, agentTools: tools,
    app: { getPath: () => userData, on: () => {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`x${value}`), decryptString: (buffer) => buffer.toString().slice(1) },
    resolveGithubToken: async () => null,
    skillsHost: () => ({ create: async (draft) => { created.push(draft); return { ok: true, skill: { name: draft.name } }; } }),
  });
  vm.runInContext(section("// ---- Skills and connectors everywhere", "// ---- end of skills and connectors everywhere"), context);
  return { context, project, sent, created, settings: () => current.settings, done: async () => { tools.useSkills(null); tools.useMcp({}); addons.forget(); await rm(base, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); } };
}

test("the Skills page's view: every skill with its use in each place, and the chat's style", async () => {
  const h = await host({ skills: { "bug-triage": ["Reproduce a bug first", "TRIAGE"] } });
  try {
    const view = plain(await h.context.skillUseView());
    assert.equal(view.ok, true);
    assert.deepEqual(view.places, ["chat", "agents", "builders"]);
    assert.deepEqual(view.chatStyle, ["eli5"], "ELI5 is the chat's style with nothing saved");
    const triage = view.skills.find((skill) => skill.name === "bug-triage");
    assert.deepEqual([triage.scope, triage.uses], ["project", { chat: "auto", agents: "auto", builders: "auto" }]);
    const eli5 = view.skills.find((skill) => skill.name === "eli5");
    assert.deepEqual([eli5.scope, eli5.kind, eli5.uses.chat, eli5.defaults.chat], ["builtin", "style", "always", "always"]);
    assert.equal(view.styles.length >= 5, true);
    assert.equal(JSON.stringify(view).includes(h.project), false, "no folder goes to the page");
  } finally { await h.done(); }
});

test("skills:set-use: the style picker, one skill's use, a place's switch, and refusals that change nothing", async () => {
  const h = await host({ skills: { "bug-triage": ["Reproduce a bug first", "TRIAGE"] } });
  try {
    let view = plain(await h.context.setSkillUse({ style: "brief" }));
    assert.deepEqual(view.chatStyle, ["brief"]);
    assert.deepEqual(h.settings().skillUse, { skills: { eli5: { chat: "call" }, brief: { chat: "always" } } });
    assert.deepEqual(h.sent.at(-1), ["settings:changed", { skills: true }], "every open view hears it");
    view = plain(await h.context.setSkillUse({ style: null }));
    assert.deepEqual(view.chatStyle, [], "plain answers");
    view = plain(await h.context.setSkillUse({ style: "eli5" }));
    assert.equal(h.settings().skillUse, undefined, "back to the defaults keeps nothing in settings");
    view = plain(await h.context.setSkillUse({ name: "bug-triage", place: "builders", use: "always" }));
    assert.equal(view.skills.find((skill) => skill.name === "bug-triage").uses.builders, "always");
    view = plain(await h.context.setSkillUse({ place: "chat", auto: false }));
    assert.equal(view.auto.chat, false);
    assert.equal(view.skills.find((skill) => skill.name === "bug-triage").uses.chat, "call");
    const before = structuredClone(h.settings());
    for (const bad of [{ style: "pirate" }, { place: "desk", auto: true }, { name: "../x", place: "chat", use: "always" }, { name: "bug-triage", place: "chat", use: "sometimes" }]) {
      const result = plain(await h.context.setSkillUse(bad));
      assert.equal(result.ok, false, JSON.stringify(bad));
    }
    assert.deepEqual(h.settings(), before, "a refusal writes nothing");
    // The chat's own prompt follows the choice.
    await h.context.setSkillUse({ style: "teach-me" });
    const prompt = await addons.instructions(h.project, h.settings(), "companion");
    assert.match(prompt, /Skill: teach-me/); assert.doesNotMatch(prompt, /Skill: eli5/);
  } finally { await h.done(); }
});

test("a built-in style is copied into the project as a skill it can edit", async () => {
  const h = await host();
  try {
    assert.equal(plain(await h.context.copyBuiltinSkill({ name: "eli5" })).ok, true);
    assert.equal(h.created[0].name, "eli5"); assert.match(h.created[0].body, /five-year-old/);
    assert.equal(format.check(h.created[0]).ok, true);
    assert.equal(plain(await h.context.copyBuiltinSkill({ name: "nope" })).ok, false);
  } finally { await h.done(); }
});

test("chat:tools says what the chip shows: the style, what it can pick, its tools and connectors", async () => {
  const h = await host({ skills: { "bug-triage": ["Reproduce a bug first", "TRIAGE"] }, settings: { agentTools: { companion: { webSearch: true, webRead: false } } } });
  try {
    const view = plain(await h.context.chatToolsView());
    assert.equal(view.ok, true);
    assert.deepEqual(view.style, ["eli5"]);
    assert.equal(view.styles.find((style) => style.name === "eli5").short, "ELI5");
    assert.equal(view.auto, true);
    assert.deepEqual(view.picks.map((pick) => pick.name), ["bug-triage"]);
    assert.deepEqual(view.tools, { webSearch: true, webRead: false, projectRead: false });
    assert.ok(Array.isArray(view.connectors));
    assert.equal(view.editable, true);
  } finally { await h.done(); }
});

test("chatUsed names the reply's skills and tools for the chips under it, but not the answer style the box's chip shows", async () => {
  const h = await host({ skills: { "house-rules": ["Our team's conventions", "RULES"] }, settings: { skillUse: { skills: { "house-rules": { chat: "always" } } } } });
  try {
    const used = plain(await h.context.chatUsed({ skillsLoaded: ["bug-triage"], toolTrace: [{ name: "web_search", ok: true }, { name: "web_search", ok: true }, { name: "use_skill", ok: true, skill: "bug-triage" }, { name: "mcp__github__list_issues", ok: false }] }));
    assert.deepEqual(used, [
      { kind: "skill", name: "house-rules", label: "house-rules" },
      { kind: "skill", name: "bug-triage", label: "bug-triage", loaded: true },
      { kind: "tool", name: "web_search", label: "Searched the web", ok: true, count: 2 },
      { kind: "tool", name: "mcp__github__list_issues", label: "github: list issues", ok: false },
    ]);
    await h.context.setSkillUse({ name: "house-rules", place: "chat", use: "default" });
    assert.equal(await h.context.chatUsed({ toolTrace: [] }), null, "nothing used, no chips: ELI5 is on, and shown by the box's chip");
  } finally { await h.done(); }
});

test("connectors:* answer through the module, and MEFI_STUDIO_NO_CONNECTORS=1 leaves only reading", async () => {
  const h = await host({ env: { MEFI_STUDIO_NO_CONNECTORS: "1" } });
  try {
    const listed = plain(await h.context.connectorCall("list"));
    assert.equal(listed.ok, true); assert.equal(listed.off, true);
    for (const name of ["add", "addFeatured", "approve", "test", "update", "remove", "setSecret", "importFrom"]) {
      const refused = plain(await h.context.connectorCall(name, { id: "x", name: "x", line: "npx x" }));
      assert.deepEqual(refused, { ok: false, off: true, error: "Changing connectors is switched off on this PC." }, name);
    }
    assert.equal(plain(await h.context.connectorCall("candidates")).ok, true);
  } finally { await h.done(); }
});

test("the tool loop's skill provider is the host's: a role is offered what its place may pick", async () => {
  const h = await host({ skills: { "bug-triage": ["Reproduce a bug first", "TRIAGE-BODY"] } });
  try {
    const defs = await tools.definitions({ agentTools: { lead: { webSearch: false, webRead: false } } }, "lead", { root: h.project });
    assert.deepEqual(defs.find((tool) => tool.name === "use_skill")?.inputSchema.properties.name.enum, ["bug-triage"]);
    const loaded = await tools.execute("use_skill", { name: "bug-triage" }, { root: h.project, settings: {}, role: "lead" });
    assert.match(loaded.text, /TRIAGE-BODY/);
    await assert.rejects(tools.execute("use_skill", { name: "eli5" }, { root: h.project, settings: {}, role: "lead" }), /no skill named/i, "a style is only called, never loaded by itself");
  } finally { await h.done(); }
});

test("the block registers the skills provider and kept connections, and MEFI_STUDIO_NO_MCP_POOL=1 starts a server for each call", async () => {
  const pooled = await host();
  try { assert.deepEqual(plain(tools.registered()), { skills: true, pooled: true, envFor: false }); } finally { await pooled.done(); }
  const single = await host({ env: { MEFI_STUDIO_NO_MCP_POOL: "1" } });
  try { assert.deepEqual(plain(tools.registered()), { skills: true, pooled: false, envFor: true }, "one-shot calls, still with the saved values"); } finally { await single.done(); }
});
