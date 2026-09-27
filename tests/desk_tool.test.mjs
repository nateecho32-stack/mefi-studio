// The desk as a tool a running worker calls and waits on (roadmap 0.4.0 M4):
// the MCP server (scripts/desk-mcp.mjs), Studio's loopback endpoint
// (scripts/desk-server.cjs), the per-run config files, the command lines that
// carry them (executorCore.cliInvocation) and the host's awaitable askDesk.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TOOL, handleMessage, deskAsker, loopbackUrl } from "../scripts/desk-mcp.mjs";
import deskServer from "../scripts/desk-server.cjs";
import core from "../scripts/executor-core.cjs";
import host from "../scripts/agent-brain-host.cjs";

const SCRIPT = fileURLToPath(new URL("../scripts/desk-mcp.mjs", import.meta.url));

test("the MCP server speaks the handshake, lists one tool and forwards a call", async () => {
  const asked = [];
  const ask = async (question) => { asked.push(question); return { ok: true, answer: "Split it into state, view and keys." }; };
  const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, { ask });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, { ask }), null);
  assert.deepEqual((await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { ask })).result.tools, [TOOL]);
  const call = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask_desk", arguments: { question: "  how do I split it?  ", detail: "tried one file" } } }, { ask });
  assert.equal(call.result.content[0].text, "Split it into state, view and keys.");
  assert.equal(call.result.isError, false);
  assert.deepEqual(asked, [{ question: "how do I split it?", detail: "tried one file" }]);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm_rf" } }, { ask })).error.code, -32602);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 5, method: "resources/list" }, { ask })).error.code, -32601);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ask_desk", arguments: {} } }, { ask })).result.isError, true);
  const broken = await handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ask_desk", arguments: { question: "q" } } }, { ask: async () => { throw new Error("socket hang up"); } });
  assert.match(broken.result.content[0].text, /could not be reached.*MEFI_HELP: q/);
});

test("the asker only ever calls a 127.0.0.1 desk, with the token and the run", async () => {
  assert.equal(loopbackUrl("http://127.0.0.1:5123/desk"), "http://127.0.0.1:5123/desk");
  assert.equal(loopbackUrl("http://example.com/desk"), null);
  assert.equal(loopbackUrl("https://127.0.0.1/desk"), null);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, answer: "yes" }) }; };
  const ask = deskAsker({ MEFI_DESK_URL: "http://127.0.0.1:5123/desk", MEFI_DESK_TOKEN: "tok", MEFI_DESK_TASK: "t1", MEFI_DESK_RUN: "r1" }, fetchImpl);
  assert.deepEqual(await ask({ question: "q", detail: "" }), { ok: true, answer: "yes" });
  assert.equal(calls[0].init.headers["x-mefi-desk-token"], "tok");
  assert.deepEqual(JSON.parse(calls[0].init.body), { taskId: "t1", runId: "r1", question: "q", detail: "" });
  const nowhere = deskAsker({ MEFI_DESK_URL: "http://evil.test/desk" }, fetchImpl);
  assert.equal((await nowhere({ question: "q" })).ok, false);
  assert.equal(calls.length, 1, "a non-loopback address is never called");
});

test("the loopback server answers only POST /desk with the token, within a size limit", async () => {
  const handled = [];
  const server = deskServer.createDeskServer({ handle: async (request) => { handled.push(request); return { ok: true, answer: "parts: a, b" }; } });
  const { url, token } = await server.start();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/desk$/);
    const post = (body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    assert.equal((await post({ question: "q" })).status, 403);
    assert.equal((await post({ question: "q" }, { "x-mefi-desk-token": "wrong" })).status, 403);
    assert.equal((await post({ question: " " }, { "x-mefi-desk-token": token })).status, 400);
    assert.equal((await fetch(url.replace("/desk", "/other"))).status, 404);
    const ok = await post({ taskId: "t1", runId: "r1", question: "how?", detail: "x".repeat(900) }, { "x-mefi-desk-token": token });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, answer: "parts: a, b", escalated: false });
    assert.equal(handled[0].detail.length, 600);
    await post({ question: "q", pad: "y".repeat(40 * 1024) }, { "x-mefi-desk-token": token }).then((res) => res.status, () => "closed");
    assert.equal(handled.length, 1, "an oversized body is dropped");
  } finally {
    await server.stop();
  }
});

test("a worker CLI reaches the desk end to end through the stdio MCP server", async () => {
  const server = deskServer.createDeskServer({ handle: async (request) => ({ ok: true, answer: `desk: ${request.question} (${request.taskId}/${request.runId})` }) });
  const address = await server.start();
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, MEFI_DESK_URL: address.url, MEFI_DESK_TOKEN: address.token, MEFI_DESK_TASK: "t9", MEFI_DESK_RUN: "run_9" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const replies = [];
    let buffer = "";
    const waitFor = (id) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply ${id}`)), 10000);
      const check = () => { const found = replies.find((row) => row.id === id); if (found) { clearTimeout(timer); resolve(found); } else setTimeout(check, 10); };
      check();
    });
    child.stdout.on("data", (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf("\n")) >= 0) { replies.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); } });
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    assert.equal((await waitFor(1)).result.serverInfo.name, "mefi-desk");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask_desk", arguments: { question: "which part first?" } } });
    assert.equal((await waitFor(2)).result.content[0].text, "desk: which part first? (t9/run_9)");
  } finally {
    child.kill();
    await server.stop();
  }
});

test("per-run config files name the server for OpenCode and Claude Code, and are removed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "desktool-"));
  try {
    const files = await deskServer.writeRunConfigs({ url: "http://127.0.0.1:1/desk", token: "tok", taskId: "t1", runId: "run_1:x", script: "C:/app/scripts/desk-mcp.mjs", node: "C:/node.exe", electron: true, dir });
    assert.ok(files);
    const open = JSON.parse(await readFile(files.opencode, "utf8"));
    assert.deepEqual(open.mcp.mefi_desk.command, ["C:/node.exe", "C:/app/scripts/desk-mcp.mjs"]);
    assert.equal(open.mcp.mefi_desk.environment.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(open.mcp.mefi_desk.environment.MEFI_DESK_RUN, "run_1:x");
    const claude = JSON.parse(await readFile(files.claude, "utf8"));
    assert.equal(claude.mcpServers.mefi_desk.env.MEFI_DESK_TOKEN, "tok");
    assert.ok(!path.basename(files.claude).includes(":"), "the run id is cleaned for the file name");
    await deskServer.removeRunConfigs(files);
    await assert.rejects(stat(files.opencode));
    assert.equal(await deskServer.writeRunConfigs({ url: "u", token: "t", runId: "r", script: "s", dir: "C:\\Program Files\\x" }), null, "a path with spaces is never used");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the command lines carry the config only for Claude Code and OpenCode, and only a safe path", () => {
  const route = { env: { A: "1" }, modelArgs: "", model: null };
  const desk = { claude: "C:\\Temp\\mefi-desk-r-claude.json", opencode: "C:\\Temp\\mefi-desk-r-opencode.json" };
  const claude = core.cliInvocation(route, "claude", "p", { desk });
  assert.match(claude.args.at(-1), / --mcp-config C:\\Temp\\mefi-desk-r-claude\.json$/);
  const opencode = core.cliInvocation(route, "opencode", "p", { desk });
  assert.equal(opencode.env.OPENCODE_CONFIG, desk.opencode);
  assert.equal(opencode.env.A, "1");
  assert.equal(route.env.OPENCODE_CONFIG, undefined, "the route's own env is not changed");
  assert.equal(core.cliInvocation(route, "codex", "p", { desk }).args.at(-1).includes("mcp"), false);
  assert.equal(core.cliInvocation(route, "grok", "p", { desk }).env, route.env);
  const unsafe = { claude: "C:\\Temp dir\\x.json & calc", opencode: "C:\\a b\\x.json" };
  assert.doesNotMatch(core.cliInvocation(route, "claude", "p", { desk: unsafe }).args.at(-1), /mcp-config/);
  assert.equal(core.cliInvocation(route, "opencode", "p", { desk: unsafe }).env.OPENCODE_CONFIG, undefined);
  assert.equal(core.cliInvocation(route, "opencode", "p").env, route.env, "no desk, no change");
});

test("askDesk waits for the desk's answer, folds repeats and hands escalations back as text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "askdesk-"));
  const replies = [
    { ok: true, text: '{"answer":"Do the store first.","parts":["store","view"],"escalate":false,"reason":""}' },
    { ok: true, text: '{"answer":"","parts":[],"escalate":true,"reason":"only the owner knows the budget"}' },
  ];
  const raised = [];
  const brain = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), seatFetch: async () => replies.shift(), raiseIssue: async (raw) => { raised.push(raw); } });
  try {
    const first = await brain.askDesk({ taskId: "t1", runId: "r1", question: "what first?" });
    assert.equal(first.ok, true);
    assert.match(first.answer, /Do the store first\. Parts: 1\) store 2\) view/);
    const again = await brain.askDesk({ taskId: "t1", runId: "r1", question: "What first" });
    assert.match(again.answer, /Do the store first/, "a repeat gets the earlier answer without a new call");
    const owner = await brain.askDesk({ taskId: "t1", runId: "r1", question: "how much may I spend?" });
    assert.equal(owner.ok, false);
    assert.equal(owner.escalated, true);
    assert.match(owner.answer, /sent to them/);
    assert.equal(raised.length, 1);
    assert.equal((await brain.askDesk({ taskId: "", question: "x" })).ok, false);
  } finally {
    await brain.flush();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("review fix: a token header of the right length in odd bytes is refused, never thrown", async () => {
  const server = deskServer.createDeskServer({ handle: async () => ({ ok: true, answer: "x" }) });
  const { url, token } = await server.start();
  try {
    const http = await import("node:http");
    const odd = Buffer.from("é".repeat(token.length / 2), "utf8").toString("latin1").slice(0, token.length);
    const status = await new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = http.request({ host: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { "content-type": "application/json", "x-mefi-desk-token": odd } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end(JSON.stringify({ question: "q" }));
    });
    assert.equal(status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { "x-mefi-desk-token": token, "content-type": "application/json" }, body: JSON.stringify({ question: "q" }) })).status, 200, "the server is still up");
  } finally {
    await server.stop();
  }
});
