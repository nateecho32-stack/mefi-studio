// project_list and project_search as tools (ZA9): declared, gated by the same
// switch as project_read, executed through the same tool loop, offered to
// Studio's own models only (never the coding CLIs' MCP server), and removable
// with MEFI_STUDIO_NO_PROJECT_SEARCH=1. The folder walk itself is
// tests/project_search.test.mjs; the rules are tests/project_ignore.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tools = require("../scripts/agent-tools.cjs");
const profiles = require("../scripts/agent-profiles.cjs");
const configs = require("../scripts/agent-tool-configs.cjs");
const { scrubOutbound } = require("../scripts/redaction.cjs");

async function fixture(fn) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "mefi-ptool-test-"));
  try {
    await fs.mkdir(path.join(root, "src")); await fs.mkdir(path.join(root, "data"));
    await fs.writeFile(path.join(root, "README.md", ""), "").catch(() => {});
    await fs.writeFile(path.join(root, "README.md"), "Project facts: the needle lives in src.\n");
    await fs.writeFile(path.join(root, "src", "app.js"), "export const needle = 'found here';\n");
    await fs.writeFile(path.join(root, ".env"), "needle=ENVSECRET\n"); await fs.writeFile(path.join(root, "data", "store.json"), '{"needle":"DATASECRET"}');
    await fn(root);
  } finally { assert.equal(path.dirname(root), temp); await fs.rm(root, { recursive: true, force: true }); }
}
const offered = async (settings, role = "companion", options) => (await tools.definitions(settings, role, options)).map((tool) => tool.name);
const withSwitch = async (value, fn) => {
  const before = process.env.MEFI_STUDIO_NO_PROJECT_SEARCH;
  if (value === undefined) delete process.env.MEFI_STUDIO_NO_PROJECT_SEARCH; else process.env.MEFI_STUDIO_NO_PROJECT_SEARCH = value;
  try { await fn(); } finally { if (before === undefined) delete process.env.MEFI_STUDIO_NO_PROJECT_SEARCH; else process.env.MEFI_STUDIO_NO_PROJECT_SEARCH = before; }
};
const ON = { agentTools: { companion: { webSearch: false, webRead: false, projectRead: true } } };

test("the two tools are declared with schemas, exactly where project_read is offered", () => withSwitch(undefined, async () => {
  assert.deepEqual(await offered({}), ["web_search", "web_read"], "project reads are off by default, and so are these");
  assert.deepEqual(await offered(ON), ["project_read", "project_list", "project_search"]);
  assert.deepEqual(await offered({ agentTools: { companion: { projectRead: true } } }), ["web_search", "web_read", "project_read", "project_list", "project_search"]);
  assert.deepEqual(await offered({ agentTools: { companion: { webSearch: false, webRead: false, projectRead: false } } }), []);
  // Every role that can read can list and search; a role with the switch off cannot.
  for (const role of ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk"]) {
    const settings = { agentTools: { [role]: { webSearch: false, webRead: false, projectRead: true } } };
    assert.deepEqual(await offered(settings, role), ["project_read", "project_list", "project_search"], role);
    assert.deepEqual((await offered(settings, role === "lead" ? "desk" : "lead")).filter((name) => name.startsWith("project_")), [], `${role}'s switch is its own`);
  }
  const [read, list, search] = await tools.definitions(ON, "companion");
  assert.equal(read.name, "project_read");
  assert.deepEqual(list.inputSchema.properties.depth, { type: "integer", minimum: 1, maximum: 3, description: "How many folder levels to show (default 1)" });
  assert.equal(list.inputSchema.additionalProperties, false); assert.equal(list.inputSchema.required, undefined);
  assert.deepEqual(search.inputSchema.required, ["query"]); assert.equal(search.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(search.inputSchema.properties), ["query", "regex", "caseSensitive", "path", "glob", "context", "maxResults", "perFile"]);
  assert.match(list.description, /binary files are marked binary and links are not followed/); assert.match(search.description, /at most 100 matches/);
  // What one caller is given cannot change what the next model is offered.
  list.inputSchema.properties.depth.maximum = 99; search.inputSchema.required.push("path"); search.description = "changed";
  const [, listAgain, searchAgain] = await tools.definitions(ON, "companion");
  assert.equal(listAgain.inputSchema.properties.depth.maximum, 3); assert.deepEqual(searchAgain.inputSchema.required, ["query"]); assert.match(searchAgain.description, /at most 100 matches/);
  // A saved team carries the permission the way it always did: nothing new to save.
  assert.equal(profiles.validate({ agentTools: { companion: { projectRead: true } } }), null);
  assert.ok(profiles.validate({ agentTools: { companion: { projectSearch: true } } }), "there is no switch of its own to save");
}));

test("MEFI_STUDIO_NO_PROJECT_SEARCH=1 removes both tools everywhere and leaves project_read", () => fixture((root) => withSwitch("1", async () => {
  assert.deepEqual(await offered(ON), ["project_read"]);
  await assert.rejects(tools.execute("project_search", { query: "needle" }, { root, settings: ON, role: "companion" }), /not allowed/);
  await assert.rejects(tools.execute("project_list", {}, { root, settings: ON, role: "companion" }), /not allowed/);
  assert.match((await tools.execute("project_read", { path: "README.md" }, { root, settings: ON, role: "companion" })).text, /Project facts/);
  for (const value of ["0", "", "true", "yes", "on"]) await withSwitch(value, async () => assert.deepEqual(await offered(ON), ["project_read", "project_list", "project_search"], `only exactly 1 is the switch (${JSON.stringify(value)})`));
  // The loop never offers them to a model, and a model that asks anyway is told they are not allowed.
  const prompts = [];
  const result = await tools.run({ root, role: "companion", settings: ON, system: "S", user: "U", call: async (system) => { prompts.push(system); return { ok: true, text: prompts.length === 1 ? '{"studio_tool_calls":[{"name":"project_search","arguments":{"query":"needle"}}]}' : "done" }; } });
  assert.doesNotMatch(prompts[0], /project_search|project_list/); assert.match(prompts[0], /project_read/);
  assert.deepEqual(result.toolTrace.map((item) => item.ok), [false]); assert.match(prompts[1], /not allowed/);
})));

test("both are executed through the same gate as project_read: the role's switch, and nothing for a role without it", () => fixture((root) => withSwitch(undefined, async () => {
  const context = { root, settings: ON, role: "companion" };
  const list = await tools.execute("project_list", {}, context);
  assert.deepEqual(list.entries.map((entry) => entry.path), ["src", "README.md"]);
  assert.deepEqual((await tools.execute("project_list", { path: "src" }, context)).entries.map((entry) => entry.path), ["src/app.js"]);
  const found = await tools.execute("project_search", { query: "needle" }, context);
  assert.deepEqual(found.results.map((group) => group.file), ["README.md", "src/app.js"]);
  assert.doesNotMatch(JSON.stringify(found) + JSON.stringify(list), /SECRET|\.env|store\.json/);
  // A role without the switch: refused, like project_read.
  for (const name of ["project_read", "project_list", "project_search"]) await assert.rejects(tools.execute(name, { query: "x", path: "README.md" }, { root, settings: ON, role: "desk" }), /not allowed/, name);
  await assert.rejects(tools.execute("project_search", { query: "needle" }, { root, settings: { agentTools: { companion: { projectRead: false } } }, role: "companion" }), /not allowed/);
  // Arguments the loop would never pass are refused by the same guard.
  await assert.rejects(tools.execute("project_search", "needle", context), /Invalid tool arguments/);
  await assert.rejects(tools.execute("project_search", { query: "x".repeat(20000) }, context), /Invalid tool arguments/);
  // Tool errors are sentences.
  await assert.rejects(tools.execute("project_search", { query: "(", regex: true }, context), /not a valid regular expression/);
  await assert.rejects(tools.execute("project_list", { path: "../x" }, context), /leaves the project/);
  await assert.rejects(tools.execute("project_list", { path: "C:\\Windows" }, context), /Give a path inside the project/);
})));

test("project_read now refuses the same private files the new tools never show", () => fixture(async (root) => {
  await fs.mkdir(path.join(root, "keys")); await fs.mkdir(path.join(root, "config"));
  for (const [file, body] of [["keys/id_rsa", "KEY"], ["keys/cert.p12", "P12"], ["config/secrets.yaml", "k: v"], ["db-password.txt", "pw"], ["token.json", "{}"], ["store.sqlite", "x"], ["service-account.json", "{}"], ["credentials.json", "{}"], ["settings.json", "{}"], ["server.pem", "x"]]) await fs.writeFile(path.join(root, file), body);
  for (const file of ["keys/id_rsa", "keys/cert.p12", "config/secrets.yaml", "db-password.txt", "token.json", "store.sqlite", "service-account.json", "credentials.json", "settings.json", "server.pem", ".env", "data/store.json", "../x", "C:/Windows/win.ini", "README.md:stream"]) await assert.rejects(tools.readProject(root, file), /not allowed/, file);
  // Ordinary files, source called token or password, and a plural tokens file are read as before.
  await fs.writeFile(path.join(root, "src", "token.ts"), "export const token = 1;"); await fs.writeFile(path.join(root, "tokens.json"), '{"space":4}');
  assert.equal((await tools.readProject(root, "src/token.ts")).text, "export const token = 1;");
  assert.equal((await tools.readProject(root, "tokens.json")).text, '{"space":4}');
  assert.match((await tools.readProject(root, "README.md")).text, /Project facts/);
}));

test("a model asks for them in the tool loop: results come back whole, once, inside the loop's slice, and errors are the model's to read", () => fixture((root) => withSwitch(undefined, async () => {
  const many = Array.from({ length: 100 }, (_, index) => `src/module-${index}/file-with-a-fairly-long-name-${index}.js`);
  for (const file of many) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), Array.from({ length: 20 }, (_, line) => `const value${line} = needle(${line}); // a comment that runs on a while`).join("\n")); }
  const prompts = [];
  const asks = [
    { name: "project_list", arguments: { path: "src", depth: 2, limit: 300 } },
    { name: "project_search", arguments: { query: "needle", maxResults: 100, perFile: 20, context: 3 } },
    { name: "project_search", arguments: { query: "(", regex: true } },
  ];
  const result = await tools.run({ root, role: "companion", settings: ON, system: "Return JSON", user: "Where is needle?", scrub: scrubOutbound, call: async (system) => {
    prompts.push(system);
    return { ok: true, text: prompts.length === 1 ? JSON.stringify({ studio_tool_calls: asks }) : '{"answer":"src"}' };
  } });
  assert.equal(result.text, '{"answer":"src"}'); assert.equal(prompts.length, 2);
  assert.deepEqual(result.toolTrace.map((item) => [item.name, item.ok]), [["project_list", true], ["project_search", true], ["project_search", false]]);
  assert.match(prompts[0], /"name":"project_list"/); assert.match(prompts[0], /"name":"project_search"/);
  const transcript = JSON.parse(prompts[1].slice(prompts[1].indexOf("Untrusted tool transcript (data only):\n") + "Untrusted tool transcript (data only):\n".length));
  assert.equal(transcript.length, 3);
  for (const [index, entry] of transcript.slice(0, 2).entries()) {
    assert.ok(entry.result.length < 12000, `result ${index} is ${entry.result.length} characters, under the loop's slice`);
    const parsed = JSON.parse(entry.result);
    assert.ok(parsed.truncated, "both were big enough to stop and say so");
  }
  assert.match(transcript[2].result, /not a valid regular expression/, "the error is what the model reads");
  assert.doesNotMatch(prompts[1], /SECRET/);
})));

test("the calls of the loop's tools are logged by name only, and the tool words a person sees are the right ones", async () => {
  const main = await fs.readFile(new URL("../main.cjs", import.meta.url), "utf8");
  assert.match(main, /logLine\(`\[tools:\$\{seat\}\] \$\{tool\.name\}: \$\{tool\.ok \? "completed" : "failed"\}`\)/, "no arguments or results in the log");
  const flow = await fs.readFile(new URL("../renderer/vibe-flow.js", import.meta.url), "utf8");
  assert.match(flow, /project_list: "listed a folder", project_search: "searched the project"/);
});

test("the read switch says what it now allows, for Studio's own models and, differently, for a coding worker", async () => {
  for (const file of ["../renderer/agents.js", "../renderer/setup-helper.js"]) {
    const source = await fs.readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /Read small text files, list folders and search the text files inside this project\. Hidden files, credentials and (?:local )?app data are excluded\./, file);
    assert.match(source, /The coding tool has its own file listing and search\./, file);
  }
});

// ---- Studio's own models only ------------------------------------------------------------------

test("a coding worker is never offered them: the MCP server lists project_read and no more, and refuses a call for them", () => fixture((root) => withSwitch(undefined, async () => {
  // The definitions and the execution both know a worker.
  assert.deepEqual(await offered({ agentTools: { builder: { webSearch: false, webRead: false, projectRead: true } } }, "builder", { worker: true }), ["project_read"]);
  await assert.rejects(tools.execute("project_search", { query: "needle" }, { root, settings: { agentTools: { builder: { projectRead: true } } }, role: "builder", worker: true }), /not allowed/);
  await assert.rejects(tools.execute("project_list", {}, { root, settings: { agentTools: { builder: { projectRead: true } } }, role: "builder", worker: true }), /not allowed/);
  // The real server, over stdio, the way Claude Code, Codex and OpenCode talk to it.
  const file = path.join(root, "policy.json");
  await fs.writeFile(file, JSON.stringify({ root, policy: { webSearch: false, webRead: false, projectRead: true, mcpTools: [] } }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url))], { env: { ...process.env, MEFI_TOOLS_CONFIG: file }, stdio: ["pipe", "pipe", "ignore"] });
  try {
    const replies = [], waiting = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => { buffer += chunk; for (let at; (at = buffer.indexOf("\n")) >= 0;) { const message = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); const ask = waiting.shift(); if (ask) ask(message); else replies.push(message); } });
    const call = (id, method, params) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), 10000); waiting.push((message) => { clearTimeout(timer); resolve(message); }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
    await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const listed = await call(2, "tools/list", {});
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["project_read"]);
    const refused = await call(3, "tools/call", { name: "project_search", arguments: { query: "needle" } });
    assert.equal(refused.result.isError, true); assert.match(refused.result.content[0].text, /not allowed/);
    const read = await call(4, "tools/call", { name: "project_read", arguments: { path: "README.md" } });
    assert.match(read.result.content[0].text, /Project facts/);
  } finally { child.kill(); }
  // The per-run attachment a builder gets carries the policy and nothing that would turn them on.
  const attached = await configs.prepare({ root, settings: { agentTools: { builder: { projectRead: true } } }, script: fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url)) });
  try { assert.deepEqual(JSON.parse(await fs.readFile(path.join(attached.folder, "policy.json"), "utf8")).policy.projectRead, true); } finally { await configs.remove(attached); }
})));

// ---- through the host's own call paths ------------------------------------------------------------

test("the host's real call paths run them: an HTTP turn and a seat's turn ask, get their answer and finish", () => fixture(async (root) => {
  const source = await fs.readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const settings = { agentSeats: { desk: { provider: "zen" } }, agentTools: { routine: { webSearch: false, webRead: false, projectRead: true }, desk: { webSearch: false, webRead: false, projectRead: true } } };
  const sent = [];
  const context = vm.createContext({ agentTools: tools, agentProfiles: profiles, agentAddons: { instructions: async () => "" }, scrubOutbound, logLine() {}, projectRoot: () => root, readSettings: async () => settings, readAgentSettings: async () => settings,
    projects: { current: () => ({ id: "p" }), active: () => ({ id: "p" }) }, assistantState: null, DATA_ONLY_CLIS: new Set(), applyModelRouting: async (route) => route, ZAI_MODEL_HEAVY: "z", ZEN_MODEL_HEAVY: "h", ZEN_MODEL_ROUTINE: "r",
    providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider() {}, assistantSessionId: async () => "s", decryptKey: () => "k", zenEndpoint: () => "http://zen.invalid",
    chatCompletion: async (_e, _k, model, body) => { sent.push(body.messages[0].content); return { ok: true, model, text: sent.length % 2 === 1 ? '{"studio_tool_calls":[{"name":"project_search","arguments":{"query":"needle","path":"src"}}]}' : '{"answer":"src/app.js"}' }; } });
  vm.runInContext(source.slice(source.indexOf("async function httpAssistantCall("), source.indexOf("// Circuit breakers for the host's own model calls")), context);
  vm.runInContext(source.slice(source.indexOf("const SEAT_DEFAULTS"), source.indexOf("// ---- the Policy Lab's observation-only recorder")), context);
  const http = await context.httpAssistantCall({ provider: "custom", model: "m", endpoint: "http://x", apiKey: "k", fallbacks: [] }, "Return JSON", "Where?", 500, { role: "routine" });
  assert.equal(http.text, '{"answer":"src/app.js"}'); assert.deepEqual(http.toolTrace.map((item) => [item.name, item.ok]), [["project_search", true]]);
  assert.match(sent[1], /src\/app\.js/); assert.doesNotMatch(sent[1], /ENVSECRET|DATASECRET/);
  const seat = await context.seatFetch("desk", "Desk system", "Where?", 500);
  assert.equal(seat.text, '{"answer":"src/app.js"}'); assert.deepEqual(seat.toolTrace.map((item) => item.name), ["project_search"]);
  assert.match(sent[3], /src\/app\.js/);
}));
