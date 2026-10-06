// The upgraded tool loop (scripts/agent-tools.cjs): use_skill puts a loaded skill beside the system
// prompt and never in the untrusted transcript, calls of one turn run side by side, a connector on for a
// place reaches that place's agents, and a connector's pictures are named, not pasted. The coding
// worker's tool server (scripts/agent-tools-mcp.cjs) offers the same skills and keeps the run's values.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tools = require("../scripts/agent-tools.cjs");
const configs = require("../scripts/agent-tool-configs.cjs");
const format = require("../scripts/skill-format.cjs");
const PROXY = fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url));

async function fixture(fn) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "mefi-tool-skills-"));
  try { await fn(root); } finally { tools.useSkills(null); tools.useMcp({}); assert.equal(path.dirname(root), temp); await fs.rm(root, { recursive: true, force: true }); }
}
const SKILL_TEXT = "Always reproduce the bug first. SKILL-SECRET-PHRASE";
const provider = (offered = [{ name: "bug-triage", description: "Reproduce a bug first", title: "bug-triage" }]) => ({
  catalog: async () => offered,
  load: async ({ name }) => { if (!offered.some((row) => row.name === name)) throw new Error("There is no skill named that to load."); return { name, text: `${SKILL_TEXT} (${name})` }; },
});

test("use_skill is offered with the skills' names, and a loaded skill joins the instructions, not the transcript", () => fixture(async (root) => {
  tools.useSkills(provider());
  const defs = await tools.definitions({ agentTools: { lead: { webSearch: false, webRead: false } } }, "lead", { root });
  const tool = defs.find((entry) => entry.name === "use_skill");
  assert.ok(tool); assert.deepEqual(tool.inputSchema.properties.name.enum, ["bug-triage"]); assert.match(tool.description, /bug-triage: Reproduce a bug first/);
  assert.equal((await tools.definitions({}, "lead", { root, skills: false })).some((entry) => entry.name === "use_skill"), false);
  const systems = [];
  const result = await tools.run({ root, role: "lead", settings: { agentTools: { lead: { webSearch: false, webRead: false } } }, system: "Return JSON", user: "Fix the crash", call: async (system) => {
    systems.push(system);
    if (systems.length === 1) return { ok: true, text: '{"studio_tool_calls":[{"name":"use_skill","arguments":{"name":"bug-triage"}}]}' };
    if (systems.length === 2) return { ok: true, text: '{"studio_tool_calls":[{"name":"use_skill","arguments":{"name":"bug-triage"}},{"name":"use_skill","arguments":{"name":"nope"}}]}' };
    return { ok: true, text: '{"answer":"done"}' };
  } });
  assert.equal(result.text, '{"answer":"done"}');
  assert.deepEqual(result.skillsLoaded, ["bug-triage"]);
  assert.deepEqual(result.toolTrace, [{ name: "use_skill", ok: true, skill: "bug-triage" }, { name: "use_skill", ok: true, skill: "bug-triage" }, { name: "use_skill", ok: false, skill: "nope" }]);
  assert.match(systems[0], /load it with use_skill before answering/);
  const loadedAt = systems[1].indexOf("Skills loaded for this request"), transcriptAt = systems[1].indexOf("Untrusted tool transcript");
  assert.ok(loadedAt > 0 && loadedAt < transcriptAt, "the skill sits with the instructions, before the transcript");
  assert.equal(systems[1].split("SKILL-SECRET-PHRASE").length, 2, "its text is there once, not again in the transcript");
  assert.match(systems[2], /already loaded/);
  assert.equal(systems[2].split("SKILL-SECRET-PHRASE").length, 2, "loading it twice adds nothing");
}));

test("loaded skills share one budget per answer", () => fixture(async (root) => {
  const offered = [{ name: "a", description: "A" }, { name: "b", description: "B" }];
  tools.useSkills({ catalog: async () => offered, load: async ({ name }) => ({ name, text: name.repeat(9000) }) });
  const systems = [];
  const result = await tools.run({ root, role: "desk", settings: { agentTools: { desk: { webSearch: false, webRead: false } } }, system: "s", user: "u", call: async (system) => {
    systems.push(system);
    return systems.length === 1 ? { ok: true, text: '{"studio_tool_calls":[{"name":"use_skill","arguments":{"name":"a"}},{"name":"use_skill","arguments":{"name":"b"}}]}' } : { ok: true, text: "final" };
  } });
  assert.deepEqual(result.skillsLoaded, ["a"]);
  assert.deepEqual(result.toolTrace.map((entry) => entry.ok), [true, false]);
  assert.match(systems[1], /No room for another skill/);
}));

test("the calls of one turn run side by side, and their results keep the order they were asked in", () => fixture(async (root) => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams.get("q");
    started.push(query);
    if (started.length === 2) release();
    await gate;
    if (query === "second") await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(`<rss><channel><item><title>${query}</title><link>https://example.com/${query}</link><description>d</description></item></channel></rss>`);
  };
  const systems = [];
  const result = await Promise.race([
    tools.run({ root, role: "lead", settings: {}, braveKey: "", fetchImpl, system: "s", user: "u", call: async (system) => {
      systems.push(system);
      return systems.length === 1 ? { ok: true, text: '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"second"}},{"name":"web_search","arguments":{"query":"first"}}]}' } : { ok: true, text: "final" };
    } }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("the second call waited for the first: they did not run side by side")), 5000)),
  ]);
  assert.equal(result.text, "final");
  assert.deepEqual(started.sort(), ["first", "second"]);
  const transcript = systems[1].slice(systems[1].indexOf("Untrusted tool transcript"));
  assert.ok(transcript.indexOf("example.com/second") < transcript.indexOf("example.com/first"), "results in the order asked");
}));

test("a connector on for a place reaches that place's agents, after the team's own picks, sixteen at most", () => fixture(async (root) => {
  const file = path.join(root, "mcp.json");
  const many = Array.from({ length: 20 }, (_, index) => ({ name: `tool_${index}` }));
  await fs.writeFile(file, JSON.stringify({ servers: { chatty: { command: "x", tools: [{ name: "ask" }], places: ["chat"] }, builds: { command: "y", tools: many, places: ["builders", "agents"] }, picked: { command: "z", tools: [{ name: "only" }] } } }));
  const names = async (role, settings = {}, options = {}) => (await tools.definitions(settings, role, { mcpFile: file, ...options })).filter((tool) => tool.mcpId).map((tool) => tool.mcpId);
  assert.deepEqual(await names("companion", { agentTools: { companion: { webSearch: false } } }), ["chatty/ask"]);
  assert.deepEqual(await names("lead"), many.slice(0, 16).map((tool) => `builds/${tool.name}`));
  const withPick = await names("builder", { agentTools: { builder: { mcpTools: ["picked/only"] } } });
  assert.equal(withPick.length, 16); assert.equal(withPick[0], "picked/only", "the team's pick comes first");
  assert.deepEqual(await names("builder", { agentTools: { builder: { mcpTools: ["picked/only"] } } }, { places: false }), ["picked/only"]);
  await assert.rejects(tools.execute("mcp__chatty__ask", {}, { root, settings: {}, role: "lead", mcpFile: file }), /not allowed/);
  // The run's policy file settles the list once, with the team's pick and the builders' connectors.
  const files = await configs.prepare({ root, settings: { agentTools: { builder: { mcpTools: ["picked/only"] } }, skillUse: { auto: { builders: false } } }, script: PROXY, mcpFile: file, envFor: async (server) => (server.id === "builds" ? { BUILD_TOKEN: "v" } : {}) });
  try {
    const policy = JSON.parse(await fs.readFile(path.join(files.folder, "policy.json"), "utf8"));
    assert.equal(policy.policy.mcpTools.length, 16); assert.equal(policy.policy.mcpTools[0], "picked/only");
    assert.deepEqual(policy.connectorEnv, { builds: { BUILD_TOKEN: "v" } });
    assert.deepEqual(policy.skills, { use: { auto: { builders: false } }, picked: [] });
  } finally { await configs.remove(files); }
}));

test("a connector's pictures are named, not pasted, in what a model reads", () => {
  assert.deepEqual(tools.compactMcp({ content: [{ type: "image", data: "A".repeat(4096), mimeType: "image/png" }, { type: "text", text: "took it" }, { type: "resource", resource: { text: "file text" } }, { type: "resource_link", uri: "file:///x" }] }),
    { text: "[image image/png, about 3 KB, not shown]\n\ntook it\n\nfile text\n\n[link: file:///x]" });
  assert.deepEqual(tools.compactMcp({ isError: true, content: [{ type: "text", text: "nope" }] }), { isError: true, text: "nope" });
  assert.equal(tools.compactMcp("plain"), "plain");
});

test("the worker's tool server offers the builders' skills and passes a connector's picture on", () => fixture(async (root) => {
  await fs.mkdir(path.join(root, ".agents", "skills", "bug-triage"), { recursive: true });
  await fs.writeFile(path.join(root, ".agents", "skills", "bug-triage", "SKILL.md"), format.build({ name: "bug-triage", description: "Reproduce a bug first", body: "TRIAGE-STEPS" }));
  const server = path.join(root, "server.cjs");
  await fs.writeFile(server, `const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => { const m = JSON.parse(line); if (m.id === undefined) return;
  const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18' } : m.method === 'tools/list' ? { tools: [{ name: 'shot' }] } : { content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }, { type: 'text', text: process.env.SHOT_TOKEN || 'no token' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); });`);
  const home = path.join(root, "home");
  const mcpFile = path.join(home, ".mefi-studio", "mcp.json");
  await fs.mkdir(path.dirname(mcpFile), { recursive: true });
  await fs.writeFile(mcpFile, JSON.stringify({ servers: { camera: { command: process.execPath, args: [server], envKeys: ["SHOT_TOKEN"], tools: [{ name: "shot" }], places: ["builders"] } } }));
  const policy = path.join(root, "policy.json");
  await fs.writeFile(policy, JSON.stringify({ root, policy: { webSearch: false, webRead: false, projectRead: false, mcpTools: ["camera/shot"] }, skills: { use: null, picked: [] }, connectorEnv: { camera: { SHOT_TOKEN: "saved-token" } } }));
  // The worker's server reads the device file from its home folder.
  const child = spawn(process.execPath, [PROXY], { env: { ...process.env, MEFI_TOOLS_CONFIG: policy, USERPROFILE: home, HOME: home }, stdio: ["pipe", "pipe", "ignore"] });
  const replies = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf("\n")) >= 0) { const message = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); replies.get(message.id)?.(message); } });
  const ask = (id, method, params) => new Promise((resolve, reject) => { replies.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); setTimeout(() => reject(new Error(`no answer to ${method}`)), 15000).unref(); });
  try {
    await ask(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const listed = (await ask(2, "tools/list", {})).result.tools.map((tool) => tool.name);
    assert.ok(listed.includes("use_skill") && listed.includes("mcp__camera__shot"), listed.join(", "));
    const loaded = (await ask(3, "tools/call", { name: "use_skill", arguments: { name: "bug-triage" } })).result;
    assert.match(loaded.content[0].text, /^Skill: bug-triage\n[\s\S]*TRIAGE-STEPS/);
    const shot = (await ask(4, "tools/call", { name: "mcp__camera__shot", arguments: {} })).result;
    assert.deepEqual(shot.content, [{ type: "image", data: "QUJD", mimeType: "image/png" }, { type: "text", text: "saved-token" }]);
    const refused = (await ask(5, "tools/call", { name: "use_skill", arguments: { name: "nope" } })).result;
    assert.equal(refused.isError, true);
  } finally { child.stdin.end(); await new Promise((resolve) => { child.once("exit", resolve); setTimeout(() => { child.kill(); resolve(); }, 5000).unref(); }); }
}));

test("MEFI_STUDIO_SERIAL_TOOLS=1 runs a turn's calls one after another", () => fixture(async (root) => {
  const events = [];
  const fetchImpl = async (url) => {
    const query = new URL(url).searchParams.get("q");
    events.push(`start:${query}`);
    await new Promise((resolve) => setTimeout(resolve, query === "slow" ? 40 : 1));
    events.push(`end:${query}`);
    return new Response(`<rss><channel><item><title>${query}</title><link>https://example.com/${query}</link><description>d</description></item></channel></rss>`);
  };
  const before = process.env.MEFI_STUDIO_SERIAL_TOOLS;
  try {
    process.env.MEFI_STUDIO_SERIAL_TOOLS = "1";
    let turns = 0;
    await tools.run({ root, role: "lead", settings: {}, braveKey: "", fetchImpl, system: "s", user: "u", call: async () => (++turns === 1 ? { ok: true, text: '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"slow"}},{"name":"web_search","arguments":{"query":"fast"}}]}' } : { ok: true, text: "final" }) });
    assert.deepEqual(events, ["start:slow", "end:slow", "start:fast", "end:fast"]);
  } finally { if (before === undefined) delete process.env.MEFI_STUDIO_SERIAL_TOOLS; else process.env.MEFI_STUDIO_SERIAL_TOOLS = before; }
}));
