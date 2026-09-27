import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import tools from "../scripts/agent-tools.cjs";
import profiles from "../scripts/agent-profiles.cjs";
import configs from "../scripts/agent-tool-configs.cjs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

async function fixture(fn) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "mefi-tool-test-"));
  try { await fn(root); } finally { assert.equal(path.dirname(root), temp); await fs.rm(root, { recursive: true, force: true }); }
}
const rss = '<rss><channel><item><title>Current docs</title><link>https://example.com/docs?a=1&amp;b=2</link><description>Source excerpt</description></item></channel></rss>';
test("tools are scoped, validated and captured with each agent configuration", async () => {
  const settings = { agentTools: { companion: { webSearch: false, projectRead: true, mcpTools: ["docs/search"] } } };
  assert.equal(profiles.validate(settings), null);
  const snapshot = profiles.capture(settings, "p"); settings.agentTools.companion.webSearch = true;
  assert.equal(tools.policy(snapshot.configuration, "companion").webSearch, false);
  assert.equal(tools.policy(snapshot.configuration, "desk").projectRead, false);
  for (const agentTools of [{ nope: {} }, { companion: { shell: true } }, { companion: { webSearch: "false" } }, { companion: { mcpTools: ["docs/*"] } }]) assert.ok(profiles.validate({ agentTools }));
  await assert.rejects(tools.execute("web_search", { query: "docs" }, { settings: snapshot.configuration, role: "companion" }), /not allowed/);
});
test("web search returns real source fields, hides keys and rejects failures and oversized responses", async () => {
  let url;
  const result = await tools.search("current docs", { braveKey: "", fetchImpl: async (address, options) => { url = address; assert.equal(options.redirect, "error"); return new Response(rss); } });
  assert.match(url, /format=rss/); assert.equal(result.results[0].url, "https://example.com/docs?a=1&b=2");
  const brave = await tools.search("docs", { braveKey: "fixture-key", fetchImpl: async (address, options) => { assert.equal(options.headers["X-Subscription-Token"], "fixture-key"); return Response.json({ web: { results: [{ title: "Docs", url: "https://example.com", description: "Current" }] } }); } });
  assert.equal(JSON.stringify(brave).includes("fixture-key"), false);
  await assert.rejects(tools.search("docs", { fetchImpl: async () => new Response("x", { status: 429 }) }), /429/);
  await assert.rejects(tools.search("docs", { fetchImpl: async () => new Response("x".repeat(512001)) }), /too large/);
  await assert.rejects(tools.search("docs", { braveKey: "", fetchImpl: async () => new Response("blocked") }), /no usable results/);
});
test("project reads reject traversal, hidden state, aliases into state and large or binary files", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "Project facts");
  await fs.mkdir(path.join(root, "data")); await fs.writeFile(path.join(root, "data", "private.txt"), "secret");
  await fs.symlink(path.join(root, "data"), path.join(root, "alias"), "junction");
  assert.equal((await tools.readProject(root, "README.md")).text, "Project facts");
  for (const file of ["../outside", "data/private.txt", "alias/private.txt", ".env", "C:/Windows/win.ini", "README.md:stream"]) await assert.rejects(tools.readProject(root, file));
  await fs.writeFile(path.join(root, "large.txt"), "x".repeat(32001)); await assert.rejects(tools.readProject(root, "large.txt"), /32 KB/);
}));
test("tool turns execute allowed requests, preserve final formats and never expand permissions", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "untrusted facts");
  let turns = 0;
  const result = await tools.run({ root, role: "desk", settings: { agentTools: { desk: { webSearch: false, projectRead: true } } }, system: "Return final JSON", user: "Question", call: async (system) => {
    turns++;
    if (turns === 1) return { ok: true, text: JSON.stringify({ studio_tool_calls: [{ name: "project_read", arguments: { path: "README.md" } }, { name: "web_search", arguments: { query: "secret" } }] }) };
    assert.match(system, /untrusted facts/); assert.match(system, /not allowed/);
    return { ok: true, text: '{"answer":"Done"}', observationId: "final" };
  } });
  assert.equal(result.text, '{"answer":"Done"}'); assert.equal(turns, 2);
  assert.deepEqual(result.toolTrace.map((item) => item.ok), [true, false]);
  const loop = await tools.run({ root, role: "desk", settings: {}, system: "s", user: "u", fetchImpl: async () => new Response(rss), braveKey: "", call: async () => ({ ok: true, text: '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"docs"}}]}' }) });
  assert.equal(loop.ok, false); assert.equal(loop.toolTrace.length, 4);
}));
test("stdio MCP initializes, discovers, calls only configured tools and times out", () => fixture(async (root) => {
  const script = path.join(root, "server.cjs"), config = path.join(root, "mcp.json");
  await fs.writeFile(script, `const readline = require('node:readline'); readline.createInterface({input:process.stdin}).on('line', line => { const m=JSON.parse(line); if(m.id === undefined) return; if(m.method === 'tools/call' && m.params.arguments.wait) return; const result=m.method==='initialize'?{protocolVersion:'2025-06-18'}:m.method==='tools/list'?{tools:[{name:'lookup'}]}:{content:[{type:'text',text:m.params.arguments.query}]}; console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result})); });`);
  await fs.writeFile(config, JSON.stringify({ servers: { docs: { command: process.execPath, args: [script], tools: [{ name: "lookup", description: "Find docs", inputSchema: { type: "object" } }] } } }));
  const settings = { agentTools: { desk: { webSearch: false, mcpTools: ["docs/lookup"] } } };
  const catalog = await tools.mcp.catalog(config); assert.equal(catalog.length, 1); assert.equal(JSON.stringify(catalog).includes(script), false);
  const context = { root, settings, role: "desk", mcpFile: config };
  assert.equal((await tools.execute("mcp__docs__lookup", { query: "docs" }, context)).content[0].text, "docs");
  await assert.rejects(tools.execute("mcp__docs__lookup", {}, { ...context, role: "companion" }), /not allowed/);
  await assert.rejects(tools.execute("mcp__docs__lookup", { wait: true }, { ...context, timeoutMs: 150 }), /timed out/);
}));
test("builder configs retain the desk alongside Studio tools and remove captured policy on cleanup", () => fixture(async (root) => {
  const deskOpen = path.join(root, "desk-open.json"), deskClaude = path.join(root, "desk-claude.json");
  await fs.writeFile(deskOpen, JSON.stringify({ mcp: { mefi_desk: { enabled: true } } }));
  await fs.writeFile(deskClaude, JSON.stringify({ mcpServers: { mefi_desk: { command: "fixture" } } }));
  const files = await configs.prepare({ root, settings: { agentTools: { builder: { webSearch: false } } }, desk: { opencode: deskOpen, claude: deskClaude }, script: fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url)) });
  try {
    const open = JSON.parse(await fs.readFile(files.opencode, "utf8")); assert.ok(open.mcp.mefi_desk); assert.ok(open.mcp.mefi_tools);
    const captured = JSON.parse(await fs.readFile(path.join(files.folder, "policy.json"), "utf8")); assert.equal(captured.policy.webSearch, false);
  } finally { await configs.remove(files); }
  await assert.rejects(fs.stat(files.folder), /ENOENT/);
}));

test("real host seat fallback keeps the seat's skills and permissions across research turns", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "Seat research evidence");
  const source = await fs.readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const settings = { agentSeats: { companion: { provider: "auto" } }, agentTools: { companion: { webSearch: false, projectRead: true }, heavy: { webSearch: false, projectRead: false } } };
  const prompts = [], skills = [];
  const context = vm.createContext({
    agentTools: tools, agentProfiles: profiles, ZEN_MODEL_HEAVY: "fixture", ZEN_MODEL_ROUTINE: "fixture", projects: { current: () => ({ id: "p" }) },
    readSettings: async () => settings, readAgentSettings: async () => settings, projectRoot: () => root, scrubOutbound: (value) => value, logLine: () => {},
    agentAddons: { instructions: async (_root, _settings, role) => { skills.push(role); return "\nCompanion skill"; } },
  });
  vm.runInContext(source.slice(source.indexOf("const SEAT_DEFAULTS"), source.indexOf("// ---- the Policy Lab's observation-only recorder")), context);
  const result = await context.seatFetch("companion", "System", "Question", 1000, { fallback: async (system) => {
    prompts.push(system);
    return { ok: true, text: prompts.length === 1 ? '{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"README.md"}}]}' : '{"answer":"Complete"}' };
  } });
  assert.deepEqual(skills, ["companion"]); assert.equal(result.ok, true); assert.equal(result.toolTrace[0].ok, true);
  assert.match(prompts[1], /Seat research evidence/); assert.equal(prompts[1].split("Companion skill").length, 2);
}));

test("the coding worker MCP adapter executes the captured policy over real stdio", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "Worker research evidence");
  const file = path.join(root, "policy.json"), previous = process.env.MEFI_TOOLS_CONFIG;
  await fs.writeFile(file, JSON.stringify({ root, policy: { webSearch: false, projectRead: true, mcpTools: [] } }));
  process.env.MEFI_TOOLS_CONFIG = file;
  const server = { command: process.execPath, args: [fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url))], envKeys: ["MEFI_TOOLS_CONFIG"], tools: [{ name: "project_read" }, { name: "web_search" }] };
  try {
    const result = await tools.mcp.call(server, "project_read", { path: "README.md" });
    assert.match(result.content[0].text, /Worker research evidence/);
    await assert.rejects(tools.mcp.call(server, "web_search", { query: "docs" }), /unavailable/);
  } finally { if (previous === undefined) delete process.env.MEFI_TOOLS_CONFIG; else process.env.MEFI_TOOLS_CONFIG = previous; }
}));

test("real direct HTTP path executes tool turns through provider fallback and keeps final JSON", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "HTTP research evidence");
  const source = await fs.readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const settings = { agentTools: { routine: { webSearch: false, projectRead: true } } }, requests = [];
  const context = vm.createContext({ agentTools: tools, projectRoot: () => root, readAgentSettings: async () => settings, scrubOutbound: (value) => value, logLine() {},
    applyModelRouting: async (route) => route, ZAI_MODEL_HEAVY: "zai", providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider() {}, assistantState: null,
    chatCompletion: async (_endpoint, _key, model, body) => { requests.push({ model, body }); if (model === "primary") return { ok: false, error: "Unavailable" }; return { ok: true, text: requests.length === 2 ? '{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"README.md"}}]}' : '{"answer":"Researched"}' }; },
  });
  vm.runInContext(source.slice(source.indexOf("async function httpAssistantCall("), source.indexOf("// Circuit breakers for the host's own model calls")), context);
  const result = await context.httpAssistantCall({ provider: "custom", model: "primary", fallbacks: [{ provider: "custom", model: "fallback" }] }, "Return JSON", "Question", 1000);
  assert.equal(result.text, '{"answer":"Researched"}'); assert.equal(requests.length, 4); assert.equal(result.toolTrace[0].ok, true);
  assert.match(requests[3].body.messages[0].content, /HTTP research evidence/);
}));
