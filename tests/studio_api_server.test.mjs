// The Studio API's endpoint (scripts/studio-api-server.cjs) on a real loopback
// socket, and the app side that calls it (scripts/studio-link.mjs: the MCP
// server's protocol and the command line): only the key gets in; a web page
// (an Origin, Sec-Fetch-Site or a rebinding Host) never does; bodies are
// checked before `handle` runs; calls are limited per minute; the fixed port
// falls back to any free one; the key file is written whole and removed only
// by the Studio that wrote it; and the MCP tools and commands reach the right
// routes with the app's name.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { callStudio, handleMessage, parseArgs, runCli, TOOLS, loopbackUrl, keyFile } from "../scripts/studio-link.mjs";

const require = createRequire(import.meta.url);
const server = require("../scripts/studio-api-server.cjs");
const rules = require("../scripts/studio-api.cjs");

async function endpoint({ port = 0, handle, now } = {}) {
  const calls = [];
  const token = server.newKey();
  const api = server.createApiServer({ token, port, now, handle: handle ?? (async (request) => { calls.push(request); return { text: `did ${request.route}`, data: request.fields }; }) });
  const { url, port: bound } = await api.start();
  return { api, token, url, port: bound, calls };
}

// A raw request, so the test controls every header (fetch would add its own).
function raw(port, { method = "GET", path: route = "/v1/status", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: route, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on("error", reject);
    if (body !== null) request.write(typeof body === "string" ? body : JSON.stringify(body));
    request.end();
  });
}

test("only the key gets in, and no web page ever does", async (t) => {
  const { api, token, port, calls } = await endpoint();
  t.after(() => api.stop());
  const key = { authorization: `Bearer ${token}` };
  assert.equal((await raw(port)).status, 401, "no key");
  assert.equal((await raw(port, { headers: { authorization: "Bearer nope" } })).status, 401, "a wrong key");
  const ok = await raw(port, { headers: key });
  assert.deepEqual([ok.status, ok.body], [200, { ok: true, text: "did status", data: {} }]);
  assert.equal(ok.headers["access-control-allow-origin"], undefined, "no CORS");
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal((await raw(port, { headers: { "x-mefi-token": token } })).status, 200, "the other header works too");
  assert.equal((await raw(port, { headers: { ...key, origin: "https://evil.example" } })).status, 403, "a page's fetch carries an Origin");
  assert.equal((await raw(port, { headers: { ...key, "sec-fetch-site": "cross-site" } })).status, 403, "a page's navigation carries Sec-Fetch-Site");
  assert.equal((await raw(port, { headers: { ...key, host: `evil.example:${port}` } })).status, 421, "a rebinding name is refused before the key is read");
  assert.equal((await raw(port, { headers: { ...key, host: `localhost:${port}` } })).status, 200);
  assert.equal(calls.length, 3, "only the three good calls reached handle");
  // Node's own fetch (what studio-link.mjs uses) is let in.
  const fetched = await fetch(`http://127.0.0.1:${port}/v1/hello`, { headers: key });
  assert.equal(fetched.status, 200);
});

test("bodies are checked before handle runs, and the app names itself", async (t) => {
  const { api, token, port, calls } = await endpoint();
  t.after(() => api.stop());
  const key = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  assert.deepEqual((await raw(port, { method: "GET", path: "/v1/say", headers: key })).status, 405);
  assert.equal((await raw(port, { method: "POST", path: "/v1/say", headers: key, body: "{not json" })).status, 400);
  assert.equal((await raw(port, { method: "POST", path: "/v1/say", headers: key, body: [1, 2] })).status, 400);
  const empty = await raw(port, { method: "POST", path: "/v1/say", headers: key, body: { text: "  " } });
  assert.deepEqual([empty.status, empty.body.error], [400, "Send the message in `text`."]);
  const big = await raw(port, { method: "POST", path: "/v1/notify", headers: key, body: { text: "x".repeat(rules.BODY_MAX + 10) } }).catch((error) => ({ status: error.code }));
  assert.ok([413, "ECONNRESET", "EPIPE"].includes(big.status), `an over-size body is cut off (${big.status})`);
  const said = await raw(port, { method: "POST", path: "/v1/say", headers: { ...key, "x-mefi-app": "Claude\t Code" }, body: { text: "Add dark mode" } });
  assert.equal(said.status, 200);
  assert.deepEqual(calls.map(({ route, app, fields }) => ({ route, app, fields })), [{ route: "say", app: "Claude Code", fields: { text: "Add dark mode" } }]);
  assert.equal((await raw(port, { path: "/v1/nothing", headers: key })).status, 404);
});

test("handle's own failures become answers, never a dropped socket", async (t) => {
  const { api, token, port } = await endpoint({ handle: async ({ route }) => {
    if (route === "status") return { ok: false, status: 409, text: "No project is open." };
    throw new Error("boom");
  } });
  t.after(() => api.stop());
  const key = { authorization: `Bearer ${token}` };
  assert.deepEqual(await raw(port, { headers: key }).then(({ status, body }) => [status, body]), [409, { ok: false, text: "No project is open." }]);
  const thrown = await raw(port, { path: "/v1/needs", headers: key });
  assert.deepEqual([thrown.status, thrown.body.error], [500, "Studio could not do that: boom"]);
});

test("calls are limited per minute, the ones that start work more tightly", async (t) => {
  let clock = 0;
  const { api, token, port } = await endpoint({ now: () => clock });
  t.after(() => api.stop());
  const key = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  for (let index = 0; index < rules.RATE.work; index += 1) assert.equal((await raw(port, { method: "POST", path: "/v1/say", headers: key, body: { text: "hi" } })).status, 200);
  const held = await raw(port, { method: "POST", path: "/v1/say", headers: key, body: { text: "hi" } });
  assert.deepEqual([held.status, held.headers["retry-after"]], [429, "60"]);
  assert.equal((await raw(port, { headers: key })).status, 200, "looking still works");
  clock += 61 * 1000;
  assert.equal((await raw(port, { method: "POST", path: "/v1/say", headers: key, body: { text: "hi" } })).status, 200, "a minute later work is let in again");
});

test("the fixed port falls back to a free one, and a new key takes effect at once", async (t) => {
  const first = await endpoint();
  t.after(() => first.api.stop());
  const second = await endpoint({ port: first.port });
  t.after(() => second.api.stop());
  assert.notEqual(second.port, first.port, "the held port is not fought over");
  assert.equal(second.api.running(), true);
  const next = server.newKey();
  second.api.rekey(next);
  assert.equal((await raw(second.port, { headers: { authorization: `Bearer ${second.token}` } })).status, 401, "the old key is gone");
  assert.equal((await raw(second.port, { headers: { authorization: `Bearer ${next}` } })).status, 200);
  assert.throws(() => second.api.rekey("short"), /not a key/);
  await second.api.stop();
  assert.equal(second.api.running(), false);
  await assert.rejects(raw(second.port, { headers: { authorization: `Bearer ${next}` } }), /ECONNREFUSED/);
});

test("the key file is written whole and removed only by the Studio whose key it holds", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "nested", "studio-api.json");
  assert.equal(server.keyFilePath({ MEFI_STUDIO_API_FILE: file }), file);
  assert.equal(server.keyFilePath({}, "C:\\Users\\Jo"), path.join("C:\\Users\\Jo", ".mefi-studio", "studio-api.json"));
  assert.equal(await server.readKeyFile(file), null);
  const mine = server.newKey(), theirs = server.newKey();
  await server.writeKeyFile(file, { url: "http://127.0.0.1:1", token: theirs });
  assert.equal(await server.removeKeyFile(file, mine), false, "another Studio's file stays");
  assert.equal((await server.readKeyFile(file)).token, theirs);
  assert.equal(await server.removeKeyFile(file, theirs), true);
  assert.equal(await server.readKeyFile(file), null);
  await writeFile(file, JSON.stringify({ token: "not-a-key" }));
  assert.equal(await server.readKeyFile(file), null, "a file that is not Studio's is not read as a key");
});

test("studio-link: reads the key file at every call, calls only loopback, and says plainly when Studio is off", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-link-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "studio-api.json");
  const env = { MEFI_STUDIO_API_FILE: file };
  assert.equal(keyFile(env), file);
  const off = await callStudio("/v1/status", { env });
  assert.equal(off.ok, false);
  assert.match(off.text, /turn on Settings › Other apps/);
  assert.equal(loopbackUrl("http://127.0.0.1:4000/x"), "http://127.0.0.1:4000");
  assert.equal(loopbackUrl("http://evil.example:4000"), null);
  assert.equal(loopbackUrl("https://127.0.0.1:4000"), null);
  await writeFile(file, JSON.stringify({ url: "http://evil.example:80", token: server.newKey() }));
  assert.equal((await callStudio("/v1/status", { env, fetchImpl: () => { throw new Error("must not call"); } })).ok, false, "a key file pointing away from this PC is never followed");
  const { api, token, url, calls } = await endpoint();
  t.after(() => api.stop());
  await writeFile(file, JSON.stringify({ url, token }));
  const answer = await callStudio("/v1/tasks", { env, method: "POST", body: { title: "Add dark mode", detail: "tokens" }, app: "Codex" });
  assert.deepEqual(answer, { ok: true, text: "did task", data: { title: "Add dark mode", detail: "tokens" } });
  assert.equal(calls.at(-1).app, "Codex");
  await api.stop();
  assert.match((await callStudio("/v1/status", { env })).text, /isn't reachable/, "a closed Studio reads as off, not as an error dump");
});

test("the MCP server: tools list, the client's name reaches Studio's log, and errors are tool errors", async () => {
  const sent = [];
  const call = async (route, options) => { sent.push([route, options]); return route === "/v1/needs" ? { ok: false, text: "Studio isn't reachable." } : { ok: true, text: `ok ${route}`, data: { n: 1 } }; };
  const session = {};
  const init = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } }, { call, session });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "mefi-studio");
  assert.equal(session.app, "claude-code");
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, { call, session }), null);
  const listed = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { call, session });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["studio_status", "studio_needs", "studio_made", "studio_message", "studio_add_task", "studio_notify", "studio_setup_info", "studio_control"]);
  for (const tool of listed.result.tools) assert.equal(tool.inputSchema.type, "object", tool.name);
  const message = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "studio_message", arguments: { text: "hello" } } }, { call, session });
  assert.equal(message.result.isError, false);
  assert.equal(message.result.content[0].text, 'ok /v1/say\n\n```json\n{\n  "n": 1\n}\n```');
  assert.deepEqual(sent.at(-1), ["/v1/say", { method: "POST", body: { text: "hello" }, timeoutMs: 200000, app: "claude-code" }]);
  const task = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "studio_add_task", arguments: { title: "Add search" } } }, { call, session });
  assert.equal(task.result.isError, false);
  assert.deepEqual(sent.at(-1)[1].body, { title: "Add search", detail: "" });
  const failed = await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "studio_needs", arguments: {} } }, { call, session });
  assert.deepEqual([failed.result.isError, failed.result.content[0].text], [true, "Studio isn't reachable."]);
  const control = await handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "studio_control", arguments: { action: "explode" } } }, { call, session });
  assert.equal(control.result.isError, true);
  await handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "studio_control", arguments: { action: "pause" } } }, { call, session });
  assert.deepEqual(sent.at(-1).slice(0, 1), ["/v1/pause"]);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "rm_rf" } }, { call, session })).error.code, -32602);
  assert.equal((await handleMessage({ jsonrpc: "2.0", id: 9, method: "resources/list" }, { call, session })).error.code, -32601);
  assert.equal(TOOLS.length, 8);
});

test("the command line: each command reaches its route, --json prints the answer, and mistakes exit 2", async () => {
  assert.deepEqual(parseArgs(["task", "Add", "search", "--detail", "fast", "--json"]), { command: "task", words: ["Add", "search"], flags: { detail: "fast", json: true } });
  const sent = [], out = [], err = [];
  const call = async (route, options) => { sent.push([route, options.method ?? "GET", options.body ?? null, options.app]); return { ok: route !== "/v1/needs", text: `answer ${route}`, data: { route } }; };
  const run = (argv, extra = {}) => runCli(argv, { env: {}, out: (text) => out.push(text), err: (text) => err.push(text), call, ...extra });
  assert.equal(await run(["status"]), 0);
  assert.equal(await run(["needs"]), 1, "a refusal exits 1");
  assert.equal(await run(["say", "Add", "dark", "mode", "--app", "Stream Deck"]), 0);
  assert.equal(await run(["say", "-"], { stdin: async () => "from stdin\n" }), 0);
  assert.equal(await run(["task", "Add search", "--detail", "fast"]), 0);
  assert.equal(await run(["notify", "Build", "done", "--level", "done"]), 0);
  assert.equal(await run(["resume", "--json"]), 0);
  assert.deepEqual(sent, [
    ["/v1/status", "GET", null, "Command line"],
    ["/v1/needs", "GET", null, "Command line"],
    ["/v1/say", "POST", { text: "Add dark mode" }, "Stream Deck"],
    ["/v1/say", "POST", { text: "from stdin\n" }, "Command line"],
    ["/v1/tasks", "POST", { title: "Add search", detail: "fast" }, "Command line"],
    ["/v1/notify", "POST", { text: "Build done", title: "", level: "done" }, "Command line"],
    ["/v1/resume", "POST", null, "Command line"],
  ]);
  assert.deepEqual(JSON.parse(out.at(-1)), { ok: true, text: "answer /v1/resume", data: { route: "/v1/resume" } });
  assert.equal(err[0], "answer /v1/needs", "a refusal goes to stderr");
  assert.equal(await run(["say"]), 2);
  assert.equal(await run(["frobnicate"]), 2);
  assert.equal(await run([]), 2);
  assert.match(out.at(-1), /^Talk to Mefi's Studio AI\+ on this PC\./);
  assert.equal(await run(["--help"]), 0);
  const skill = await runCli(["skill"], { env: { MEFI_STUDIO_APP: "Hook" }, out: (text) => out.push(text), err: () => {}, call: async (route, options) => ({ ok: true, text: "", data: { skill: `---\nname: mefi-studio\n${options.app}\n` } }) });
  assert.equal(skill, 0);
  assert.equal(out.at(-1), "---\nname: mefi-studio\nHook");
});
