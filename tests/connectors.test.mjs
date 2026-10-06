// Connectors: the MCP client's approval states, discovery, kept connections and HTTP transport
// (scripts/agent-mcp.cjs), and Team › Connectors' host module (scripts/connectors.cjs): add, approve,
// test, change, remove, the encrypted values, and importing from other apps' settings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mcp = require("../scripts/agent-mcp.cjs");
const connectors = require("../scripts/connectors.cjs");

const SERVER = `const readline = require('node:readline');
let count = 0;
const tools = [{ name: 'count', description: 'Count calls', inputSchema: { type: 'object' } }, { name: 'whoami', description: 'Says the token' }, { name: 'slow', description: 'Never answers' }, { name: 'shot', description: 'A picture' }, { name: 'bad name!' }];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', serverInfo: { name: 'fixture', version: '1.2.3' } };
  else if (m.method === 'tools/list') result = m.params && m.params.cursor ? { tools: tools.slice(3) } : { tools: tools.slice(0, 3), nextCursor: 'p2' };
  else if (m.params.name === 'count') result = { content: [{ type: 'text', text: String(++count) + ':' + process.pid }] };
  else if (m.params.name === 'whoami') result = { content: [{ type: 'text', text: process.env.FIXTURE_TOKEN || 'none' }] };
  else if (m.params.name === 'slow') return;
  else if (m.params.name === 'shot') result = { content: [{ type: 'image', data: 'A'.repeat(4000), mimeType: 'image/png' }, { type: 'text', text: 'took it' }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});`;

async function fixture(fn) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "mefi-connectors-"));
  try {
    const script = path.join(root, "server.cjs");
    await fs.writeFile(script, SERVER);
    await fn({ root, script, file: path.join(root, "home", ".mefi-studio", "mcp.json") });
  } finally { assert.equal(path.dirname(root), temp); await fs.rm(root, { recursive: true, force: true }); }
}
const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value)); };
// A stand-in for safeStorage: reversible, and never the plain value on disk.
const encrypt = (value) => Buffer.from(`enc:${[...value].reverse().join("")}`).toString("base64");
const decrypt = (value) => { const text = Buffer.from(value, "base64").toString(); if (!text.startsWith("enc:")) throw new Error("bad"); return [...text.slice(4)].reverse().join(""); };

test("a server is used only when it is ready: approved as it is, or written by hand, and switched on", () => fixture(async ({ script, file }) => {
  const base = { command: process.execPath, args: [script], tools: [{ name: "count" }, { name: "whoami" }] };
  const approved = { ...base, approval: { fingerprint: mcp.fingerprint(base), at: 1 } };
  await write(file, { servers: {
    hand: base, approved, pending: { ...base, pending: true }, changed: { ...approved, args: [script, "--other"] }, off: { ...base, enabled: false },
    "bad id!": base, nocommand: { args: [] }, toomany: { ...base, args: Array(65).fill("x") }, http: { transport: "http", url: "http://example.com/mcp" }, local: { transport: "http", url: "http://127.0.0.1:9/mcp" },
    places: { ...base, places: ["chat", "nowhere"], off: ["whoami"] },
  } });
  const rows = await mcp.rows(file);
  const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));
  assert.deepEqual(status, { hand: "ready", approved: "ready", pending: "needs-approval", changed: "changed", off: "off", local: "ready", places: "ready" });
  assert.deepEqual((await mcp.servers(file)).map((row) => row.id), ["hand", "approved", "local", "places"]);
  const catalog = await mcp.catalog(file);
  assert.deepEqual(catalog.filter((tool) => tool.server === "places").map((tool) => [tool.name, tool.places]), [["count", ["chat"]]], "tools the owner turned off are not offered; unknown places are dropped");
  // The fingerprint is what runs: not the title, the tools or the switches.
  assert.equal(mcp.fingerprint(base), mcp.fingerprint({ ...base, title: "x", tools: [], enabled: false, places: ["chat"] }));
  assert.notEqual(mcp.fingerprint(base), mcp.fingerprint({ ...base, envKeys: ["TOKEN"] }));
  assert.notEqual(mcp.fingerprint(base), mcp.fingerprint({ ...base, command: "other" }));
}));

test("discover finds a server's tools page by page and leaves out names Studio can't use", () => fixture(async ({ script }) => {
  const found = await mcp.discover({ id: "fixture", command: process.execPath, args: [script] }, { timeoutMs: 20000 });
  assert.deepEqual(found.tools.map((tool) => tool.name), ["count", "whoami", "slow", "shot"]);
  assert.deepEqual(found.skipped, ["bad name!"]);
  assert.deepEqual(found.serverInfo, { name: "fixture", version: "1.2.3" });
  assert.equal(found.protocolVersion, "2025-06-18");
  assert.deepEqual(found.tools[1].inputSchema, { type: "object" });
  await assert.rejects(mcp.discover({ id: "gone", command: path.join(path.dirname(script), "no-such-program.exe"), args: [] }, { timeoutMs: 30000 }), /was not found on this PC/);
  await assert.rejects(mcp.discover({ id: "quits", command: process.execPath, args: ["-e", "console.error('boom: missing key'); process.exit(3)"] }, { timeoutMs: 30000 }), /stopped before it answered\. It said: boom: missing key/);
}));

test("a pool keeps one connection per server between calls, and lets go when it changes, idles or times out", () => fixture(async ({ script }) => {
  const server = { id: "fixture", command: process.execPath, args: [script], tools: [{ name: "count" }, { name: "whoami" }, { name: "slow" }], envKeys: ["FIXTURE_TOKEN"] };
  const seen = [];
  const pool = mcp.createPool({ idleMs: 400, envFor: async (row) => { seen.push(row.id); return { FIXTURE_TOKEN: "saved-value" }; } });
  try {
    const first = (await pool.call(server, "count", {})).content[0].text;
    const second = (await pool.call(server, "count", {})).content[0].text;
    assert.equal(first.split(":")[0], "1"); assert.equal(second.split(":")[0], "2", "the same process answered: state carried over");
    assert.equal(first.split(":")[1], second.split(":")[1]);
    assert.equal((await pool.call(server, "whoami", {})).content[0].text, "saved-value");
    assert.deepEqual(seen, ["fixture"], "the saved values were asked for once, when it started");
    // Calls side by side share the connection.
    const both = await Promise.all([pool.call(server, "count", {}), pool.call(server, "count", {})]);
    assert.deepEqual(both.map((reply) => reply.content[0].text.split(":")[1]), [first.split(":")[1], first.split(":")[1]]);
    // A changed definition starts it again.
    const changed = { ...server, args: [script, "--again"] };
    const fresh = (await pool.call(changed, "count", {})).content[0].text;
    assert.equal(fresh.split(":")[0], "1"); assert.notEqual(fresh.split(":")[1], first.split(":")[1]);
    assert.equal(pool.size(), 1);
    // A call that times out drops the connection: its state is unknown.
    await assert.rejects(pool.call(changed, "slow", {}, { timeoutMs: 150 }), /timed out/);
    assert.equal(pool.size(), 0);
    assert.equal((await pool.call(changed, "count", {})).content[0].text.split(":")[0], "1");
    await assert.rejects(pool.call(changed, "missing", {}), /unavailable/);
    // Quiet for longer than idleMs: closed (polled, so a loaded machine is not a failure).
    for (const deadline = Date.now() + 10000; pool.size() && Date.now() < deadline;) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(pool.size(), 0);
  } finally { pool.closeAll(); }
}));

test("one-shot calls carry saved values, and execute hands them over from a worker's run", () => fixture(async ({ script }) => {
  const server = { id: "fixture", command: process.execPath, args: [script], tools: [{ name: "whoami" }], envKeys: ["FIXTURE_TOKEN"] };
  assert.equal((await mcp.call(server, "whoami", {}, { env: { FIXTURE_TOKEN: "given" } })).content[0].text, "given");
  assert.equal((await mcp.call(server, "whoami", {}, { env: { "BAD KEY": "x" } })).content[0].text, "none", "only proper setting names are passed");
  await assert.rejects(mcp.call(server, "count", {}), /not configured/);
}));

test("Streamable HTTP: a session id, events or JSON, a saved header and a plain refusal", async () => {
  const seen = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push({ method: request.method, session: request.headers["mcp-session-id"] ?? null, auth: request.headers.authorization ?? null, protocol: request.headers["mcp-protocol-version"] ?? null });
      if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
      if (request.headers.authorization !== "Bearer right") { response.writeHead(401); response.end(); return; }
      const message = JSON.parse(body);
      if (message.id === undefined) { response.writeHead(202); response.end(); return; }
      if (message.method === "initialize") { response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "session-1" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "remote", version: "9" } } })); return; }
      if (message.method === "tools/list") {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: {} })}\n\n`);
        response.end(`data: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "lookup", description: "Look it up" }] } })}\n\n`);
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `found ${message.params.arguments.q}` }] } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    const remote = { id: "remote", transport: "http", url, headerKeys: { Authorization: "REMOTE_AUTH" }, tools: [{ name: "lookup" }] };
    const found = await mcp.discover(remote, { env: { REMOTE_AUTH: "Bearer right" }, timeoutMs: 20000 });
    assert.deepEqual(found.tools.map((tool) => tool.name), ["lookup"]);
    assert.deepEqual(found.serverInfo, { name: "remote", version: "9" });
    assert.equal((await mcp.call(remote, "lookup", { q: "docs" }, { env: { REMOTE_AUTH: "Bearer right" } })).content[0].text, "found docs");
    assert.equal((await mcp.call(remote, "lookup", { q: "bare" }, { env: { REMOTE_AUTH: "right" } })).content[0].text, "found bare", "a bare token saved for Authorization is sent as a Bearer token");
    assert.equal(seen[0].session, null);
    assert.ok(seen.slice(1).filter((row) => row.method === "POST").every((row) => row.session === "session-1" || row.session === null));
    assert.ok(seen.some((row) => row.protocol === "2025-06-18"), "the agreed version is sent after initialize");
    assert.ok(seen.every((row) => row.auth === "Bearer right"));
    await assert.rejects(mcp.discover(remote, { env: { REMOTE_AUTH: "Bearer wrong" }, timeoutMs: 20000 }), /refused Studio \(HTTP 401\)/);
    await assert.rejects(mcp.discover({ ...remote, url: "http://example.com/mcp" }, { timeoutMs: 1000 }), /https/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("Team › Connectors: add, approve what was read, test, change and remove", () => fixture(async ({ root, script, file }) => {
  const host = connectors.createConnectors({ file, home: path.join(root, "home"), secretFile: path.join(root, "data", "connector-secrets.json"), encrypt, decrypt, backups: () => path.join(root, "data", "backups"), now: () => 1000, env: {}, testTimeoutMs: 20000,
    fallbackEnv: (key) => (key === "GITHUB_PERSONAL_ACCESS_TOKEN" ? "studio-github" : null) });
  // A hand-written server is kept exactly as it is through every change.
  await write(file, { other: "kept", servers: { hand: { command: process.execPath, args: [script], tools: [{ name: "count" }], note: "mine" } } });
  const added = await host.add({ name: "Fixture", line: `"${process.execPath}" "${script}" --flag`, envKeys: ["FIXTURE_TOKEN"], values: { FIXTURE_TOKEN: "s3cret" }, places: ["chat", "builders"] });
  assert.equal(added.ok, true, added.error);
  assert.equal(added.server.id, "fixture"); assert.equal(added.server.status, "needs-approval");
  assert.deepEqual(added.server.args, [script, "--flag"]); assert.deepEqual(added.server.saved, ["FIXTURE_TOKEN"]); assert.deepEqual(added.server.missing, []);
  assert.equal((await fs.readFile(file, "utf8")).includes("s3cret"), false, "a value never goes into mcp.json");
  assert.equal((await fs.readFile(path.join(root, "data", "connector-secrets.json"), "utf8")).includes("s3cret"), false, "and is encrypted where it is kept");
  assert.equal((await host.add({ name: "fixture", line: "npx x" })).ok, false, "a name is never taken twice");
  assert.match((await host.add({ name: "x", line: "npx \"unclosed" })).error, /the way you would type it/);
  assert.match((await host.test({ id: "fixture" })).error, /Approve it first/);
  assert.equal((await mcp.servers(file)).some((row) => row.id === "fixture"), false, "pending: never started");
  // Approving needs the fingerprint the page showed.
  assert.match((await host.approve({ id: "fixture", fingerprint: "stale" })).error, /changed since you looked/);
  const approved = await host.approve({ id: "fixture", fingerprint: added.server.fingerprint });
  assert.equal(approved.server.status, "ready"); assert.equal(approved.server.approvedAt, 1000);
  const tested = await host.test({ id: "fixture" });
  assert.equal(tested.ok, true, tested.error);
  assert.deepEqual(tested.tools.map((tool) => tool.name), ["count", "whoami", "slow", "shot"]);
  assert.equal(tested.server.tested.found, 4); assert.equal(tested.server.tested.skipped, 1);
  assert.equal((await host.envFor({ id: "fixture", envKeys: ["FIXTURE_TOKEN"] })).FIXTURE_TOKEN, "s3cret");
  // Tools off, places, switched off.
  let changed = await host.update({ id: "fixture", off: ["slow"], places: ["builders"] });
  assert.deepEqual(changed.server.tools.filter((tool) => tool.off).map((tool) => tool.name), ["slow"]);
  assert.deepEqual((await mcp.catalog(file)).filter((tool) => tool.server === "fixture").map((tool) => tool.name), ["count", "whoami", "shot"]);
  changed = await host.update({ id: "fixture", enabled: false });
  assert.equal(changed.server.status, "off"); assert.equal((await mcp.servers(file)).some((row) => row.id === "fixture"), false);
  assert.equal((await host.update({ id: "fixture", enabled: true })).server.status, "ready");
  assert.equal((await host.update({ id: "fixture", places: ["desk"] })).ok, false);
  // A value: replaced, forgotten, refused for a setting it does not use.
  assert.equal((await host.setSecret({ id: "fixture", key: "FIXTURE_TOKEN", value: "new" })).ok, true);
  assert.equal((await host.envFor({ id: "fixture", envKeys: ["FIXTURE_TOKEN"] })).FIXTURE_TOKEN, "new");
  assert.match((await host.setSecret({ id: "fixture", key: "OTHER", value: "x" })).error, /does not use OTHER/);
  assert.deepEqual((await host.setSecret({ id: "fixture", key: "FIXTURE_TOKEN", value: "" })).server.missing, ["FIXTURE_TOKEN"]);
  // Studio's own GitHub sign-in stands in for a GitHub token.
  const github = await host.addFeatured({ id: "github" });
  assert.equal(github.server.status, "needs-approval"); assert.deepEqual(github.server.standIns, ["GITHUB_PERSONAL_ACCESS_TOKEN"]); assert.deepEqual(github.server.missing, []);
  assert.equal((await host.envFor({ id: "github", envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"] })).GITHUB_PERSONAL_ACCESS_TOKEN, "studio-github");
  assert.equal((await host.list()).featured.find((entry) => entry.id === "github").added, true);
  // A changed command waits for approval again.
  const config = JSON.parse(await fs.readFile(file, "utf8"));
  config.servers.fixture.args.push("--more");
  await write(file, config);
  assert.equal((await host.list()).servers.find((row) => row.id === "fixture").status, "changed");
  // Remove keeps a copy and forgets the values.
  assert.equal((await host.remove({ id: "fixture" })).ok, true);
  assert.equal((await fs.readdir(path.join(root, "data", "backups"))).length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "data", "connector-secrets.json"), "utf8")).servers, {});
  const left = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(left.other, "kept"); assert.equal(left.servers.hand.note, "mine"); assert.equal(left.servers.fixture, undefined);
  assert.equal((await host.remove({ id: "fixture" })).ok, false);
}));

test("without safe storage a value is refused, never written in plain text", () => fixture(async ({ root, file }) => {
  const host = connectors.createConnectors({ file, home: path.join(root, "home"), secretFile: null, env: {} });
  const added = await host.add({ name: "plain", line: "npx some-server", values: { TOKEN: "x" } });
  assert.match(added.error, /can't keep that value safely/);
  assert.equal((await host.list()).secretsSafe, false);
}));

test("import finds other apps' servers, never loads them by itself and brings values only when asked", () => fixture(async ({ root, file }) => {
  const home = path.join(root, "home"), appData = path.join(root, "appdata"), project = path.join(root, "project");
  await fs.mkdir(project, { recursive: true });
  await write(path.join(home, ".claude.json"), { mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] }, docs: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer from-claude" } }, old: { type: "sse", url: "https://mcp.example.com/sse" } },
    projects: { [project.replace(/\\/g, "/")]: { mcpServers: { local: { command: "node", args: ["server.js"], env: { API_KEY: "claude-key", OTHER: "${env:OTHER}" } } } }, "C:/elsewhere": { mcpServers: { foreign: { command: "nope" } } } } });
  await write(path.join(appData, "Claude", "claude_desktop_config.json"), { mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } } });
  await write(path.join(appData, "Code", "User", "mcp.json"), `{\n  // VS Code keeps comments\n  "servers": { "fetch": { "type": "stdio", "command": "uvx", "args": ["mcp-server-fetch"], }, },\n}`);
  await write(path.join(home, ".codex", "config.toml"), `model = "gpt"\n[mcp_servers.context7]\ncommand = "npx"\nargs = [\n  "-y",\n  "@upstash/context7-mcp", # docs\n]\n[mcp_servers.context7.env]\nCONTEXT7_KEY = 'codex-key'\n[profiles.x]\ncommand = "ignored"\n`);
  await write(path.join(home, ".config", "opencode", "opencode.json"), { mcp: { browser: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"], environment: { HEADLESS: "1" } } } });
  await write(path.join(project, ".mcp.json"), { mcpServers: { sentry: { command: "npx", args: ["-y", "@sentry/mcp-server"] } } });
  const host = connectors.createConnectors({ file, home, appData, projectRoot: () => project, secretFile: path.join(root, "data", "secrets.json"), encrypt, decrypt, backups: () => path.join(root, "data", "backups"), env: {}, platform: "win32" });
  const found = await host.candidates();
  assert.equal(found.ok, true, found.error);
  const byName = Object.fromEntries(found.candidates.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(byName).sort(), ["browser", "context7", "docs", "fetch", "local", "memory", "old", "sentry"]);
  assert.match(byName.memory.source, /Claude Code/); assert.equal(byName.memory.alsoIn.length, 1, "the same server in two apps is listed once");
  assert.equal(byName.local.hasValues, true); assert.deepEqual(byName.local.envKeys, ["API_KEY", "OTHER"]);
  assert.equal(byName.context7.line, "npx -y @upstash/context7-mcp"); assert.equal(byName.context7.hasValues, true);
  assert.equal(byName.browser.line, "npx -y @playwright/mcp@latest");
  assert.equal(byName.old.supported, false); assert.match(byName.old.why, /SSE/);
  assert.equal(byName.docs.transport, "http"); assert.equal(byName.docs.supported, true);
  assert.equal(JSON.stringify(found).includes("claude-key") || JSON.stringify(found).includes("from-claude"), false, "values never reach the page");
  // Bring three in, values for two of them; the unsupported one is skipped with a reason.
  const result = await host.importFrom({ keys: [byName.local.key, byName.docs.key, byName.memory.key, byName.old.key, "gone"], values: true });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.added.sort(), ["docs", "local", "memory"]);
  assert.deepEqual(result.valuesKept.sort(), ["docs", "local"]);
  assert.deepEqual(result.skipped.map((item) => item.key ?? item.name).length, 2);
  const listed = (await host.list()).servers;
  assert.ok(listed.every((row) => row.status === "needs-approval"), "imported ones wait for approval");
  assert.equal((await host.envFor(listed.find((row) => row.id === "local"))).API_KEY, "claude-key");
  assert.deepEqual(listed.find((row) => row.id === "local").missing, ["OTHER"], "a placeholder was not a value");
  const docs = listed.find((row) => row.id === "docs");
  assert.equal(docs.transport, "http"); assert.equal((await host.envFor({ id: "docs", headerKeys: docs.headerKeys })).DOCS_AUTHORIZATION, "Bearer from-claude");
  // Importing again makes a second copy only on purpose; the candidates say what is already in.
  assert.equal((await host.candidates()).candidates.find((item) => item.name === "memory").added, "memory");
  const again = await host.importFrom({ keys: [byName.memory.key] });
  assert.deepEqual(again.added, ["memory-2"]);
  assert.equal((await host.importFrom({ keys: [] })).ok, false);
}));

test("the small readers: command lines, ids, JSON with comments and Codex's TOML", () => {
  assert.deepEqual(connectors.parseLine(`npx -y @scope/server --dir "C:\\My Projects\\app" 'single quoted' ""`), { command: "npx", args: ["-y", "@scope/server", "--dir", "C:\\My Projects\\app", "single quoted", ""] });
  assert.deepEqual(connectors.parseLine(`"C:\\Program Files\\nodejs\\node.exe" server.js`), { command: "C:\\Program Files\\nodejs\\node.exe", args: ["server.js"] });
  assert.deepEqual(connectors.parseLine(`say "a \\"quote\\""`), { command: "say", args: ["a \"quote\""] });
  for (const bad of ["", "   ", "\"open", "a\nb"]) assert.equal(connectors.parseLine(bad), null, JSON.stringify(bad));
  const line = connectors.displayLine("C:\\Program Files\\x.exe", ["--name", "two words", "say \"hi\""]);
  assert.deepEqual(connectors.parseLine(line), { command: "C:\\Program Files\\x.exe", args: ["--name", "two words", "say \"hi\""] });
  assert.equal(connectors.idFrom("My GitHub!"), "my-github"); assert.equal(connectors.idFrom("***"), "");
  assert.deepEqual(JSON.parse(connectors.stripJsonc(`{ "a": "http://x // not a comment", /* gone */ "b": [1, 2,], }`)), { a: "http://x // not a comment", b: [1, 2] });
  assert.deepEqual(connectors.parseCodexToml(`[mcp_servers."my server"]\ncommand = 'C:\\Tools\\s.exe'\nargs = ["--x", "y"]\nenv = { A = "1", B = 'two' }\nenabled = false\n[mcp_servers.b]\nurl = "https://x.dev/mcp"\nbearer_token_env_var = "B_TOKEN"`),
    { "my server": { command: "C:\\Tools\\s.exe", args: ["--x", "y"], env: { A: "1", B: "two" }, enabled: false }, b: { url: "https://x.dev/mcp", bearer_token_env_var: "B_TOKEN" } });
  const remote = connectors.fromOther("b", { url: "https://x.dev/mcp", bearer_token_env_var: "B_TOKEN" }, "Codex");
  assert.deepEqual([remote.transport, remote.headerKeys, remote.supported], ["http", { Authorization: "B_TOKEN" }, true]);
});

test("a name an object keeps for itself never reaches a prototype: not from a config file, not from the page", () => fixture(async ({ root, file }) => {
  const parsed = connectors.parseCodexToml(`[mcp_servers.__proto__]\ncommand = "evil"\n[mcp_servers.ok]\ncommand = "x"\nenv = { __proto__ = "y", A = "1" }\n[mcp_servers.ok.__proto__]\npolluted = "yes"\n[mcp_servers.constructor]\ncommand = "no"`);
  assert.deepEqual(parsed, { ok: { command: "x", env: { A: "1" } } });
  assert.equal(({}).command, undefined); assert.equal(({}).polluted, undefined); assert.equal(({}).constructor, Object);
  await write(file, `{ "servers": { "__proto__": { "command": "evil", "tools": [{ "name": "x" }] }, "constructor": { "command": "no" }, "fine": { "command": "ok", "tools": [{ "name": "__proto__" }, { "name": "go" }] } } }`);
  assert.deepEqual((await mcp.rows(file)).map((row) => row.id), ["fine"]);
  assert.deepEqual((await mcp.catalog(file)).map((tool) => tool.name), ["go"]);
  const host = connectors.createConnectors({ file, home: path.join(root, "home"), env: {} });
  for (const id of ["__proto__", "constructor", "toString", "missing"]) {
    assert.equal((await host.update({ id, enabled: false })).ok, false, id);
    assert.equal((await host.remove({ id })).ok, false, id);
  }
  assert.equal(({}).enabled, undefined, "nothing was set on Object.prototype");
}));
