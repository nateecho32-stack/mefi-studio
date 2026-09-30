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
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { createDom } from "./fixtures/renderer-dom.mjs";

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

// A temp folder under C:\Users\John Smith used to turn Studio tools off for
// every run (the path was refused rather than quoted); Codex reads the same
// servers from the returned table as -c overrides.
test("builder configs are written under a temp path with spaces and apostrophes, with the server table for Codex", () => fixture(async (root) => {
  const dir = path.join(root, "John's temp & 50%");
  await fs.mkdir(dir);
  const deskClaude = path.join(dir, "desk-claude.json");
  await fs.writeFile(deskClaude, JSON.stringify({ mcpServers: { mefi_desk: { command: "fixture", args: [], env: { MEFI_DESK_TOKEN: "t" } } } }));
  const script = fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url));
  const files = await configs.prepare({ root, settings: {}, desk: { claude: deskClaude }, script, dir, node: "C:\\Mefi's Studio AI+\\Mefi's Studio AI+.exe" });
  try {
    assert.ok(files, "the attachment is prepared, not refused");
    assert.ok(files.claude.startsWith(dir));
    assert.deepEqual(Object.keys(files.servers).sort(), ["mefi_desk", "mefi_tools"]);
    assert.equal(files.servers.mefi_tools.command, "C:\\Mefi's Studio AI+\\Mefi's Studio AI+.exe");
    assert.deepEqual(files.servers.mefi_tools.args, [script]);
    assert.equal(files.servers.mefi_tools.env.MEFI_TOOLS_CONFIG, path.join(files.folder, "policy.json"));
    assert.deepEqual(JSON.parse(await fs.readFile(files.claude, "utf8")).mcpServers, files.servers, "the table is the one Claude Code reads");
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
  const heard = [];
  const result = await context.seatFetch("companion", "System", "Question", 1000, { onTool: (tool) => heard.push(`${tool.name}:${tool.ok}`), fallback: async (system) => {
    prompts.push(system);
    return { ok: true, text: prompts.length === 1 ? '{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"README.md"}}]}' : '{"answer":"Complete"}' };
  } });
  assert.deepEqual(skills, ["companion"]); assert.equal(result.ok, true); assert.equal(result.toolTrace[0].ok, true);
  assert.deepEqual(heard, ["project_read:true"], "a caller hears each tool turn (Vibe shows the lead's while it sizes)");
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

test("the Studio MCP server and client report the app's own version", () => fixture(async (root) => {
  const { version } = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const file = path.join(root, "policy.json");
  await fs.writeFile(file, JSON.stringify({ root, policy: { webSearch: false, projectRead: true, mcpTools: [] } }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url))], { env: { ...process.env, MEFI_TOOLS_CONFIG: file }, stdio: ["pipe", "pipe", "ignore"] });
  try {
    const reply = new Promise((resolve, reject) => {
      let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += chunk; const at = buffer.indexOf("\n"); if (at >= 0) resolve(JSON.parse(buffer.slice(0, at))); });
      child.once("error", reject);
      setTimeout(() => reject(new Error("no initialize reply")), 10000).unref();
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    assert.deepEqual((await reply).result.serverInfo, { name: "mefi-tools", version });
  } finally { child.kill(); }
  // The client's initialize names the app too (agent-mcp.cjs, for every configured server).
  const client = await fs.readFile(new URL("../scripts/agent-mcp.cjs", import.meta.url), "utf8");
  assert.match(client, /clientInfo: \{ name: "mefi-studio", version: VERSION \}/);
  assert.doesNotMatch(client, /version: "\d+\.\d+\.\d+"/, "no hard-coded version");
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

// 2026-09-29 dogfood: Zen gpt-6-luna answered Vibe's Talk with these two
// replies, and Studio showed them as Mefi's answer (the whole-text parse failed).
const LEAKED = [
  '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"site:nateecho32-stack.github.io mefi-studio roadmap planned"}}]} TS{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"site:nateecho32-stack.github.io mefi-studio roadmap planned"}}]}',
  '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"mefi studio roadmap planned items"}}]} malembe\n1',
];
test("tool envelopes wrapped in stray text, code fences or repeats still run, once each", () => fixture(async (root) => {
  await fs.writeFile(path.join(root, "README.md"), "Roadmap facts");
  const settings = { agentTools: { companion: { webRead: false, projectRead: true } } };
  const replies = [...LEAKED, '```json\n{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"README.md"}}]}\n```', '{"studio_tool_calls":[{"name":"project_read","arguments":{"path":"README.md"}}]}\n\nThe roadmap plans nothing yet.'];
  for (const reply of replies) {
    const prompts = [];
    const result = await tools.run({ root, role: "companion", settings, system: "Answer plainly", user: "What is planned?", braveKey: "", fetchImpl: async () => new Response(rss), call: async (system) => { prompts.push(system); return { ok: true, text: prompts.length === 1 ? reply : "Planned: the Fleet page." }; } });
    assert.equal(result.text, "Planned: the Fleet page.", reply); assert.equal(prompts.length, 2, reply);
    assert.deepEqual(result.toolTrace.map((item) => item.ok), [true], "a repeated identical call runs once");
    assert.match(prompts[1], /Untrusted tool transcript/);
  }
  assert.equal(tools.toolRequests(LEAKED[0]).calls.length, 1);
}));
test("a reply that still asks for tools is never returned as the answer", () => fixture(async (root) => {
  const base = { root, role: "companion", settings: {}, user: "What is planned?", braveKey: "", fetchImpl: async () => new Response(rss) };
  // Budget spent: one last turn without tools gives the answer.
  const prompts = [];
  const answered = await tools.run({ ...base, system: "Answer plainly", call: async (system) => { prompts.push(system); return { ok: true, text: /Studio tools are finished/.test(system) ? "Planned: the Fleet page." : LEAKED[prompts.length % 2] }; } });
  assert.equal(answered.text, "Planned: the Fleet page."); assert.equal(prompts.length, 6); assert.equal(answered.toolTrace.length, 4);
  assert.doesNotMatch(prompts[5], /Available tools/); assert.match(prompts[5], /Untrusted tool transcript/);
  // The last turn asks again: a clean failure the callers already handle.
  const stubborn = await tools.run({ ...base, system: "s", call: async () => ({ ok: true, text: LEAKED[1] }) });
  assert.equal(stubborn.ok, false); assert.equal(stubborn.text, undefined); assert.match(stubborn.error, /gave no final answer/);
  assert.equal(JSON.stringify(stubborn).includes("studio_tool_calls"), false);
  // An envelope that does not parse goes straight to the tool-less turn.
  let turns = 0;
  const cut = await tools.run({ ...base, system: "s", call: async () => ({ ok: true, text: ++turns === 1 ? '{"studio_tool_calls":[{"name":"web_search","arguments":{"query":"road' : "Final." }) });
  assert.equal(cut.text, "Final."); assert.equal(turns, 2); assert.equal(cut.toolTrace.length, 0);
  // Five calls in one turn: three run, the rest are reported as skipped.
  const asks = [];
  const many = await tools.run({ ...base, system: "s", call: async (system) => { asks.push(system); return { ok: true, text: asks.length === 1 ? JSON.stringify({ studio_tool_calls: [1, 2, 3, 4, 5].map((n) => ({ name: "web_search", arguments: { query: `q${n}` } })) }) : "Done." }; } });
  assert.equal(many.text, "Done."); assert.equal(many.toolTrace.length, 3); assert.match(asks[1], /"skipped":2/);
}));
test("plain answers that mention JSON are returned unchanged", () => fixture(async (root) => {
  for (const text of ['Send {"type":"json"}; studio_tool_calls is only Studio\'s internal format.', '{"answer":"Use {\\"a\\":1} here"}', "```json\n{\"items\":[\"Fleet page\"]}\n```"]) {
    let turns = 0;
    const result = await tools.run({ root, role: "companion", settings: {}, system: "s", user: "u", call: async () => { turns++; return { ok: true, text, observationId: "o" }; } });
    assert.equal(result.text, text); assert.equal(result.observationId, "o"); assert.equal(turns, 1);
  }
}));

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const page = (body, type = "text/html; charset=utf-8", status = 200) => new Response(body, { status, headers: { "content-type": type } });
test("web_read is its own switch, on by default like search, and offered to the model only when allowed", async () => {
  assert.equal(tools.policy({}, "companion").webRead, true);
  assert.equal(tools.validate({ companion: { webRead: false } }), null); assert.ok(tools.validate({ companion: { webRead: "off" } }));
  assert.deepEqual((await tools.definitions({}, "companion")).map((tool) => tool.name), ["web_search", "web_read"]);
  const off = { agentTools: { companion: { webRead: false } } };
  assert.deepEqual((await tools.definitions(off, "companion")).map((tool) => tool.name), ["web_search"]);
  // A role the owner took off the web before web_read existed stays off it.
  const offline = { agentTools: { companion: { webSearch: false } } };
  assert.equal(tools.policy(offline, "companion").webRead, false);
  assert.deepEqual((await tools.definitions(offline, "companion")).map((tool) => tool.name), []);
  await assert.rejects(tools.execute("web_read", { url: "https://example.com/" }, { settings: offline, role: "companion", lookup: publicDns, fetchImpl: async () => page("x") }), /not allowed/);
  assert.deepEqual((await tools.definitions({ agentTools: { companion: { webSearch: false, webRead: true } } }, "companion")).map((tool) => tool.name), ["web_read"]);
  await assert.rejects(tools.execute("web_read", { url: "https://example.com/" }, { settings: off, role: "companion", lookup: publicDns, fetchImpl: async () => page("x") }), /not allowed/);
  let seen;
  await tools.run({ role: "companion", settings: {}, system: "s", user: "u", call: async (system) => { seen = system; return { ok: true, text: "Done" }; } });
  assert.match(seen, /"name":"web_read"/);
});
test("web_read refuses local, private and metadata addresses before any request", async () => {
  let requests = 0; const fetchImpl = async () => { requests++; return page("x"); };
  for (const url of ["http://127.0.0.1/", "http://2130706433/", "http://[::1]:3000/", "http://localhost:8787/", "http://studio.localhost/", "http://10.0.0.5/", "http://172.16.4.1/", "http://192.168.1.1/", "http://100.64.0.1/", "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/", "http://[::]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://metadata.google.internal/", "http://168.63.129.16/"]) {
    await assert.rejects(tools.readPage(url, { fetchImpl, lookup: publicDns }), /public internet addresses/, url);
  }
  for (const address of ["127.0.0.1", "192.168.0.10", "::1", "fd12:3456::1", "169.254.169.254", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:c0a8:101::1"]) {
    await assert.rejects(tools.readPage("https://rebind.example/", { fetchImpl, lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }] }), /public internet addresses/, address);
  }
  await assert.rejects(tools.readPage("https://mixed.example/", { fetchImpl, lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }] }), /public internet addresses/);
  await assert.rejects(tools.readPage("https://user:secret@example.com/", { fetchImpl, lookup: publicDns }), /user name or password/);
  for (const url of ["file:///C:/Windows/win.ini", "ftp://example.com/", "javascript:alert(1)", "example.com", ""]) await assert.rejects(tools.readPage(url, { fetchImpl, lookup: publicDns }), undefined, url);
  assert.equal(requests, 0);
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(tools.blocked(address), false, address);
  // A name that resolves publicly for the check but locally for the socket is refused when it connects.
  let lookups = 0;
  await assert.rejects(tools.readPage("http://rebind.example:9/", { lookup: async () => [{ address: lookups++ ? "127.0.0.1" : "93.184.216.34", family: 4 }] }), /public internet addresses/);
  assert.equal(lookups, 2);
});
test("web_read handles redirects itself, re-checking each hop, at most five", async () => {
  const redirect = (location) => new Response(null, { status: 302, headers: { location } });
  const hops = [];
  await assert.rejects(tools.readPage("https://example.com/start", { lookup: async (host) => [{ address: host === "evil.example" ? "192.168.0.1" : "93.184.216.34", family: 4 }], fetchImpl: async (url) => { hops.push(url); return url.endsWith("/start") ? redirect("http://evil.example/admin") : page("router admin"); } }), /public internet addresses/);
  assert.deepEqual(hops, ["https://example.com/start"]);
  await assert.rejects(tools.readPage("https://example.com/start", { lookup: publicDns, fetchImpl: async () => redirect("http://127.0.0.1:8787/") }), /public internet addresses/);
  let count = 0;
  await assert.rejects(tools.readPage("https://example.com/0", { lookup: publicDns, fetchImpl: async () => redirect(`/${++count}`) }), /more than five/);
  assert.equal(count, 6);
  const moved = await tools.readPage("https://example.com/old#top", { lookup: publicDns, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, "manual"); assert.doesNotMatch(JSON.stringify(options.headers), /cookie|authorization|token|key/i);
    return url === "https://example.com/old" ? redirect("/new?x=1") : page("<title>New</title><p>Moved here</p>");
  } });
  assert.equal(moved.url, "https://example.com/new?x=1"); assert.equal(moved.title, "New"); assert.equal(moved.text, "Moved here"); assert.match(moved.note, /Untrusted/);
});
test("web_read reads text types only and stops at 512 KB, returning about 12,000 characters at most", async () => {
  for (const type of ["image/png", "application/octet-stream", "application/pdf", ""]) {
    await assert.rejects(tools.readPage("https://example.com/file", { lookup: publicDns, fetchImpl: async () => new Response(new Uint8Array([120]), { headers: type ? { "content-type": type } : {} }) }), /reads text\/html/, type || "untyped");
  }
  await assert.rejects(tools.readPage("https://example.com/gone", { lookup: publicDns, fetchImpl: async () => page("gone", "text/html", 404) }), /HTTP 404/);
  let pulled = 0; const chunk = new TextEncoder().encode("word ".repeat(13107));
  const body = new ReadableStream({ pull(controller) { if (pulled >= 4000000) { controller.close(); return; } pulled += chunk.length; controller.enqueue(chunk); } });
  const big = await tools.readPage("https://example.com/big.txt", { lookup: publicDns, fetchImpl: async () => new Response(body, { headers: { "content-type": "text/plain" } }) });
  assert.equal(big.truncated, true); assert.ok(pulled <= 512000 + 2 * chunk.length, `read ${pulled} bytes`);
  assert.ok(JSON.stringify(big).length <= 12000); assert.match(big.text, /^word word/); assert.equal(big.part, 1); assert.ok(big.parts > 50);
  const json = await tools.readPage("https://example.com/data.json", { lookup: publicDns, fetchImpl: async () => page(JSON.stringify({ items: ["a", "b"] }, null, 2), "application/json") });
  assert.equal(json.text, '{"items":["a","b"]}'); assert.equal(json.parts, undefined);
});
// The live roadmap page's "Planned" section starts near character 26,000.
test("web_read pages a long page in parts cut at line ends, and the loop passes the part through", () => fixture(async (root) => {
  const lines = Array.from({ length: 900 }, (_, n) => `Item ${String(n).padStart(3, "0")}: ${"planned work ".repeat(3).trim()}`);
  const text = lines.join("\n"), options = { lookup: publicDns, fetchImpl: async () => page(text, "text/markdown") };
  const first = await tools.readPage("https://example.com/notes.md", options);
  assert.equal(first.part, 1); assert.equal(first.truncated, false);
  const all = [first.text];
  for (let part = 2; part <= first.parts; part++) {
    const next = await tools.readPage("https://example.com/notes.md", { ...options, part });
    assert.equal(next.part, part); assert.match(next.text, /^Item \d{3}: /); assert.ok(JSON.stringify(next).length <= 12000);
    all.push(next.text);
  }
  assert.equal(all.join(""), text, "the parts rejoin to the whole page");
  await assert.rejects(tools.readPage("https://example.com/notes.md", { ...options, part: first.parts + 1 }), new RegExp(`has ${first.parts} parts`));
  await assert.rejects(tools.readPage("https://example.com/notes.md", { ...options, part: 0 }), /whole number/);
  const prompts = [];
  const result = await tools.run({ root, role: "companion", settings: {}, system: "s", user: "What is planned in https://example.com/notes.md?", ...options, call: async (system) => {
    prompts.push(system);
    return { ok: true, text: prompts.length === 1 ? '{"studio_tool_calls":[{"name":"web_read","arguments":{"url":"https://example.com/notes.md","part":3}}]}' : "Item 899 is planned." };
  } });
  assert.equal(result.text, "Item 899 is planned."); assert.deepEqual(result.toolTrace, [{ name: "web_read", ok: true }]);
  assert.match(prompts[1], /\\"part\\":3/); assert.match(prompts[1], /Untrusted web page content/);
}));
test("web_read turns HTML into text, keeping <noscript> and dropping scripts, styles and comments", async () => {
  const html = `<!doctype html><html><head><title>Mefi &amp; Studio · Roadmap</title><meta name="description" content="What's next"><style>.x{color:red}</style><script>window.secret = "token";</script></head><body><nav>Home</nav><!-- hidden note --><main><h1>Roadmap</h1><div id="app"></div><noscript><ul><li>Fleet page</li><li>Friends&nbsp;2.0 &#8212; rooms</li></ul></noscript></main><svg><text>icon</text></svg></body></html>`;
  const result = await tools.readPage("https://example.com/roadmap.html", { lookup: publicDns, fetchImpl: async () => page(html) });
  assert.equal(result.title, "Mefi & Studio · Roadmap"); assert.equal(result.description, "What's next");
  assert.equal(result.text, "Home\nRoadmap\n- Fleet page\n- Friends 2.0 — rooms");
  assert.equal(result.truncated, false); assert.equal(result.parts, undefined);
});
test("a thin JavaScript page gets up to three of its own JSON files, never another origin's", async () => {
  const html = `<html><head><title>Roadmap</title><link rel="alternate" type="application/json" href="/feed.json"><link rel="alternate" type="application/json" href="https://tracker.example/x.json"></head><body><div id="app" data-roadmap="assets/roadmap.json" data-other="https://cdn.example/other.json"></div><script>fetch("./data/extra.json").then((r) => r.json()); fetch('/data/fourth.json');</script></body></html>`;
  const asked = [];
  const result = await tools.readPage("https://site.example/mefi/roadmap.html", { lookup: publicDns, fetchImpl: async (url) => {
    asked.push(url);
    if (url.endsWith(".html")) return page(html);
    return url.endsWith("roadmap.json") ? page(JSON.stringify({ planned: [{ title: "Fleet page" }] }, null, 2), "application/json") : page("missing", "text/html", 404);
  } });
  assert.deepEqual(asked, ["https://site.example/mefi/roadmap.html", "https://site.example/mefi/assets/roadmap.json", "https://site.example/feed.json", "https://site.example/mefi/data/extra.json"]);
  assert.equal(result.title, "Roadmap");
  assert.equal(result.text, 'JSON data from https://site.example/mefi/assets/roadmap.json:\n{"planned":[{"title":"Fleet page"}]}\n\nJSON data from https://site.example/feed.json could not be read: The page returned HTTP 404.\n\nJSON data from https://site.example/mefi/data/extra.json could not be read: The page returned HTTP 404.');
  // Unquoted attributes, token lists and an empty href (which must not mean the page itself).
  asked.length = 0;
  const loose = await tools.readPage("https://site.example/app.html", { lookup: publicDns, fetchImpl: async (url) => {
    asked.push(url);
    return url.endsWith(".html") ? page("<meta name=description content='Plain words'><link rel='alternate nofollow' type=application/feed+json href=feed.json><link rel=alternate type=application/json href=''>") : page("{}", "application/json");
  } });
  assert.deepEqual(asked, ["https://site.example/app.html", "https://site.example/feed.json"]); assert.equal(loose.description, "Plain words");
});

// Each of these pages took seconds to minutes in one regex before 2026-09-29;
// Studio reads pages in the main process, so a scan must stay linear.
test("web_read scans hostile pages in linear time", async () => {
  const fill = (unit, head = "", tail = "", size = 512000) => head + unit.repeat(Math.floor((size - head.length - tail.length) / unit.length)) + tail;
  const refs = Array.from({ length: 16000 }, (_, n) => ` data-a='${String(n).padStart(5, "0")}.json'`).join("");
  for (const [name, body, type = "text/html", at = "https://example.com/x"] of [
    ["one 512 KB <link rel=rel=…>", fill("rel=", "<link ", ">")],
    ["many <link rel=rel=…> tags", fill(`<link ${"rel=".repeat(450)}>`)],
    ["fetch(\".json?.json?…", fill(".json?", "<p>x</p><script>fetch(\"", "</script>", 64000)],
    ["data-a=\".json?.json?…#\"", fill(".json?", "<div data-a=\"", "#\"></div>", 128000)],
    ["a run of spaces inside a line", fill(" ", "a", "b", 32000), "text/plain"],
    ["16,000 distinct same-origin JSON refs under a long path", `<i${refs}></i>`, "text/html", `https://example.com/${"d/".repeat(950)}x`],
  ]) {
    const started = performance.now();
    await tools.readPage(at, { lookup: publicDns, fetchImpl: async (url) => url === at ? page(body, type) : page("{}", "application/json") });
    const took = performance.now() - started;
    assert.ok(took < 1000, `${name}: ${Math.round(took)} ms`);
  }
});

test("web_read cuts parts by their escaped length, so quote-dense JSON loses nothing", async () => {
  const data = Array.from({ length: 2500 }, (_, n) => ({ id: n, title: `Item "${n}"\t😀`, path: `C:\\work\\${n}\\"quoted"`, note: "\u0001" }));
  const options = { lookup: publicDns, fetchImpl: async () => page(JSON.stringify(data), "application/json") };
  const first = await tools.readPage("https://example.com/data.json", options), all = [];
  assert.ok(first.parts > 10);
  for (let part = 1; part <= first.parts; part++) {
    const next = part === 1 ? first : await tools.readPage("https://example.com/data.json", { ...options, part });
    const size = JSON.stringify(next).length;
    assert.ok(size <= 11500, `part ${part}: ${size}`); assert.equal(next.truncated, false, `part ${part}`);
    assert.doesNotMatch(JSON.stringify(next), /\\ud[89ab]/i, `part ${part} splits no emoji`);
    all.push(next.text);
  }
  assert.equal(all.join(""), JSON.stringify(data), "the parts rejoin to the whole file");
});

test("web_read opens only links from the request or earlier results, never ones the model makes up", () => fixture(async (root) => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.includes("bing.com")) return new Response("<rss><channel><item><title>Found</title><link>https://found.example/article</link><description>x</description></item></channel></rss>");
    if (url === "https://example.com/docs") return new Response(null, { status: 302, headers: { location: "/docs/v2" } });
    if (url === "https://example.com/docs/v2") return page('<div id="app" data-src="data.json"></div><p>Mirror: https://linked.example/page</p><a href="https://linked.example/a">a</a>');
    if (url === "https://example.com/docs/data.json") return page('{"planned":["Fleet page"]}', "application/json");
    return page("<p>Article</p>");
  };
  const turns = [
    // The request's own link (fragment ignored), an address the model made up, a search.
    [["web_read", { url: "https://example.com/docs#intro" }], ["web_read", { url: "https://collector.example/?q=board" }], ["web_search", { query: "docs" }]],
    // The page's final URL, its JSON file and the search result.
    [["web_read", { url: "https://example.com/docs/v2" }], ["web_read", { url: "https://example.com/docs/data.json" }], ["web_read", { url: "https://found.example/article" }]],
    // Links that only the page's own text names.
    [["web_read", { url: "https://linked.example/page" }], ["web_read", { url: "https://linked.example/a" }]],
  ];
  const prompts = [];
  const result = await tools.run({ root, role: "companion", settings: {}, system: "Answer plainly", user: "Summarize https://example.com/docs.", braveKey: "", lookup: publicDns, fetchImpl, call: async (system) => {
    prompts.push(system);
    const calls = turns[prompts.length - 1];
    return { ok: true, text: calls ? JSON.stringify({ studio_tool_calls: calls.map(([name, args]) => ({ name, arguments: args })) }) : "The Fleet page is planned." };
  } });
  assert.equal(result.text, "The Fleet page is planned.");
  assert.deepEqual(result.toolTrace.map((item) => item.ok), [true, false, true, true, true, true, false, false]);
  assert.equal(asked.some((url) => /collector|linked/.test(url)), false, "a refused address is never requested");
  assert.match(prompts[1], /web_read opens only links named in the request/);
}));

test("web_read keeps a link that ends in a parenthesis when prose wraps it", () => fixture(async (root) => {
  const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return page("<p>Foo</p>"); };
  let turn = 0;
  const result = await tools.run({ root, role: "companion", settings: {}, system: "Answer plainly", user: "Read it (see https://en.wikipedia.org/wiki/Foo_(bar)).", braveKey: "", lookup: publicDns, fetchImpl, call: async () => {
    turn++;
    return { ok: true, text: turn === 1 ? JSON.stringify({ studio_tool_calls: [{ name: "web_read", arguments: { url: "https://en.wikipedia.org/wiki/Foo_(bar)" } }] }) : "Foo." };
  } });
  assert.deepEqual(result.toolTrace.map((item) => item.ok), [true]);
  assert.deepEqual(asked, ["https://en.wikipedia.org/wiki/Foo_(bar)"]);
}));

test("web_read refuses this PC's own addresses in any spelling, read afresh on each call", async () => {
  const own = [{ address: "127.0.0.1", family: "IPv4" }, { address: "93.184.216.35", family: "IPv4" }, { address: "2001:4860:4860::8844", family: "IPv6" }];
  const interfaces = () => ({ Loopback: own.slice(0, 1), Ethernet: own.slice(1) });
  let requests = 0; const fetchImpl = async () => { requests++; return page("<p>ok</p>"); };
  for (const address of ["93.184.216.35", "::ffff:93.184.216.35", "2001:4860:4860:0:0:0:0:8844", "2001:4860:4860::8844%12"]) {
    await assert.rejects(tools.readPage("https://mine.example/", { fetchImpl, interfaces, lookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }] }), /public internet addresses/, address);
  }
  for (const url of ["http://93.184.216.35/", "http://[2001:4860:4860::8844]/", "http://[::ffff:5db8:d823]/"]) await assert.rejects(tools.readPage(url, { fetchImpl, interfaces, lookup: publicDns }), /public internet addresses/, url);
  assert.equal(requests, 0);
  assert.equal((await tools.readPage("https://example.com/", { fetchImpl, interfaces, lookup: publicDns })).text, "ok");
  own.push({ address: "93.184.216.34", family: "IPv4" });
  await assert.rejects(tools.readPage("https://example.com/", { fetchImpl, interfaces, lookup: publicDns }), /public internet addresses/, "an address this PC just took");
});

test("the real transport stops a decompression bomb at 512 KB decoded, refuses unknown encodings and times out a slow body", async () => {
  const bombs = { gzip: zlib.gzipSync(Buffer.alloc(8e6, 97)), br: zlib.brotliCompressSync(Buffer.alloc(8e6, 97)) };
  const drips = new Set();
  const server = http.createServer((request, response) => {
    const name = request.url.slice(1);
    if (bombs[name]) { response.writeHead(200, { "content-type": "text/plain", "content-encoding": name }); response.end(bombs[name]); return; }
    if (name === "zstd") { response.writeHead(200, { "content-type": "text/plain", "content-encoding": "zstd" }); response.end("x"); return; }
    response.writeHead(200, { "content-type": "text/plain" }); response.write("x");
    const drip = setInterval(() => response.write("x"), 200); drips.add(drip);
    response.on("close", () => clearInterval(drip));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, base = `http://studio-test.example:${port}`;
  // Stands in for publicAddresses, which rightly refuses this loopback server.
  const check = async () => [{ address: "127.0.0.1", family: 4 }];
  try {
    await assert.rejects(tools.readPage(`http://127.0.0.1:${port}/gzip`), /public internet addresses/);
    for (const name of Object.keys(bombs)) {
      const bombed = await tools.readPage(`${base}/${name}`, { check });
      assert.equal(bombed.truncated, true, name); assert.equal(bombed.parts, Math.ceil(512000 / 9000), `${name}: 512,000 decoded characters, not 8 MB`);
      assert.match(bombed.text, /^a{9000}$/);
    }
    await assert.rejects(tools.readPage(`${base}/zstd`, { check }), /unsupported content encoding/);
    const started = performance.now();
    await assert.rejects(tools.readPage(`${base}/drip`, { check, timeoutMs: 1000 }), /did not answer within 1 second/);
    assert.ok(performance.now() - started < 5000);
  } finally { for (const drip of drips) clearInterval(drip); server.closeAllConnections(); server.close(); }
});

test("the Read web pages switches follow Search the web until the owner sets them", async () => {
  // Settings › Agents (renderer/agents.js addonPanel), run on its own.
  const agents = (await fs.readFile(new URL("../renderer/agents.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const from = agents.indexOf("  function addonPanel("), to = agents.indexOf("  function agentRow(");
  assert.ok(from > 0 && to > from, "addonPanel slice");
  const made = [];
  const node = (tag) => { const el = { tag, children: [], dataset: {}, listeners: {}, append(...items) { this.children.push(...items); }, addEventListener(type, fn) { this.listeners[type] = fn; } }; made.push(el); return el; };
  const context = vm.createContext({ node, field: (title, control, note) => ({ title, control, note }), button: (text) => ({ text }), say() {}, dirty() {}, refreshRows() {}, $: () => null, window: {} });
  vm.runInContext(`${agents.slice(from, to)}; this.addonPanel = addonPanel;`, context);
  const panel = (agentTools) => {
    made.length = 0; const config = { agentTools };
    context.addonPanel("companion", "Companion", "zen", config, { skills: [], mcpTools: [] });
    const box = (key) => made.find((el) => el.id === `agent-companion-tool-${key}`);
    const flip = (key, value) => { box(key).checked = value; box(key).listeners.change(); };
    return { config, box, flip };
  };
  assert.equal(panel({}).box("webRead").checked, true);
  assert.equal(panel({ companion: { webSearch: false } }).box("webRead").checked, false, "a role taken off the web stays off it");
  assert.equal(panel({ companion: { webSearch: false, webRead: true } }).box("webRead").checked, true);
  const live = panel({});
  live.flip("webSearch", false);
  assert.equal(live.box("webRead").checked, false, "the unset switch follows search");
  assert.deepEqual(JSON.parse(JSON.stringify(live.config.agentTools.companion)), { webSearch: false }, "and saves nothing of its own");
  live.flip("webRead", false); live.flip("webSearch", true);
  assert.equal(live.box("webRead").checked, false, "once set, it keeps the owner's choice");
  // The setup helper's Tools section (renderer/setup-helper.js) in the shared fake DOM.
  const source = await fs.readFile(new URL("../renderer/setup-helper.js", import.meta.url), "utf8");
  const settle = async () => { for (let turn = 0; turn < 24; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
  async function helper(agentTools) {
    let configuration = { executorCli: "opencode", agentTools }, revision = 1; const saves = [];
    const view = () => ({ ok: true, projectId: "p1", revision, inherited: true, scope: "defaults", name: "Studio defaults", configuration: JSON.parse(JSON.stringify(configuration)), presets: [], skills: [], mcpTools: [], habits: [], seats: {}, choices: {}, routing: { executorTierDefaults: {} } });
    const calls = { agentsState: async () => view(), agentsSave: async (payload) => { saves.push(JSON.parse(JSON.stringify(payload.configuration.agentTools))); configuration = payload.configuration; revision += 1; return view(); }, onSettingsChanged() {} };
    const api = new Proxy(calls, { get: (target, key) => target[key] ?? (async () => ({ ok: true })) });
    const { document } = createDom();
    const window = { location: { search: "" }, addEventListener() {}, dispatchEvent: () => true, mefiStudio: api, MefiNav: { register: (dest) => dest, claim() {}, release() {} }, MefiWorkspace: { activeProjectId: () => "p1" } };
    vm.runInContext(source, vm.createContext({ window, document, console, localStorage: { getItem: () => null, setItem() {}, length: 0, key: () => null }, setTimeout, clearTimeout, setImmediate, CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } } }));
    window.MefiSetupHelper.open("tools"); await settle();
    const content = document.body.children.find((el) => el.id === "setup-helper-overlay").querySelector("#setup-helper-content");
    const toggle = (text) => content.querySelectorAll(".setup-helper-toggle").find((row) => row.textContent.includes(text)).querySelector("input");
    return { toggle, saves };
  }
  assert.equal((await helper({ routine: { webSearch: false } })).toggle("Read web pages").checked, false);
  assert.equal((await helper({ routine: { webSearch: false, webRead: true } })).toggle("Read web pages").checked, true);
  const sheet = await helper({});
  assert.equal(sheet.toggle("Read web pages").checked, true);
  sheet.toggle("Search the web").checked = false; await sheet.toggle("Search the web").trigger("change"); await settle();
  assert.equal(sheet.toggle("Read web pages").checked, false, "the unset switch follows search");
  assert.deepEqual(sheet.saves, [{ routine: { webSearch: false } }]);
});
