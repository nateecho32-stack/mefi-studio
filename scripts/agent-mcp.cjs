// Bounded MCP client. Only device-configured servers are started: a program the
// owner put in ~/.mefi-studio/mcp.json (by hand, or through Team › Connectors,
// scripts/connectors.cjs) or an HTTP address the owner approved there. Model
// input supplies a tool name and arguments, never a command, an address or a path.
//
// A server in the file is used only when it is ready:
//  - not `pending` (added but not approved yet);
//  - its `approval.fingerprint` still matches what it runs (fingerprint()): a
//    command, arguments, environment names or address changed since the owner
//    approved it means it waits for approval again. A server written by hand
//    with no approval at all is the owner's own act and is used as before;
//  - not switched off (`enabled: false`).
// Its tools are the ones it declared or Studio found when it was tested
// (discover), less the ones the owner turned off (`off`). `places` says which
// kinds of agent get them without being picked one by one (agent-tools.cjs).
//
// Two ways to call: call() starts the server, calls once and stops it, as Studio
// always did; createPool() keeps one connection per server open between calls
// (a browser that was opened stays open for the next click), closes it after a
// quiet spell, when its definition changes, and on closeAll(). Studio's own
// models use a pool in the main process; a coding worker's tool server
// (agent-tools-mcp.cjs) keeps one for the length of its run.
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { existsSync } = require("node:fs");
const { buildWindowsCmdArgs, resolveComSpec } = require("./windows-command-line.cjs");
const CONFIG = path.join(os.homedir(), ".mefi-studio", "mcp.json");
// The app's own version, from the package.json beside scripts/.
const VERSION = (() => { try { return String(require("../package.json").version || "0.0.0"); } catch { return "0.0.0"; } })();
const PROTOCOLS = Object.freeze(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
const PLACES = Object.freeze(["chat", "agents", "builders"]);
const LIMITS = Object.freeze({ servers: 32, tools: 128, args: 64, argChars: 4000, envKeys: 32, description: 300, schemaChars: 8000, lineBytes: 4 * 1024 * 1024, fileBytes: 512000 });
// Names an object would read from its prototype are never a server's or a tool's.
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const safeName = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value) && !RESERVED.has(value);
const envName = (value) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// An HTTP server's address: https anywhere, plain http only on this PC.
function httpAddress(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.href;
  return null;
}
// One declared or discovered tool, bounded; null when its name can not be used.
function cleanTool(tool) {
  if (!record(tool) || !safeName(tool.name)) return null;
  let schema = record(tool.inputSchema) ? tool.inputSchema : { type: "object" };
  try { if (JSON.stringify(schema).length > LIMITS.schemaChars) schema = { type: "object" }; } catch { schema = { type: "object" }; }
  return { name: tool.name, description: String(tool.description || "").replace(/\s+/g, " ").trim().slice(0, LIMITS.description), inputSchema: schema };
}
/** What a server runs, as a short hash: an approval is for exactly this. */
function fingerprint(row = {}) {
  const transport = row.transport === "http" ? "http" : "stdio";
  const shape = transport === "http"
    ? { t: transport, u: String(row.url ?? ""), h: Object.entries(record(row.headerKeys) ? row.headerKeys : {}).map(([key, value]) => `${key}=${value}`).sort() }
    : { t: transport, c: String(row.command ?? ""), a: Array.isArray(row.args) ? row.args.map(String) : [], e: (Array.isArray(row.envKeys) ? row.envKeys.filter(envName) : []).slice().sort() };
  return crypto.createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 32);
}
// One row of the file as Studio reads it, or null when it can not be a server at all.
function readRow(id, row) {
  if (!safeName(id) || !record(row)) return null;
  const transport = row.transport === "http" ? "http" : "stdio";
  const out = { ...row, id, transport };
  if (transport === "http") {
    out.url = httpAddress(row.url);
    if (!out.url) return null;
    out.headerKeys = Object.fromEntries(Object.entries(record(row.headerKeys) ? row.headerKeys : {}).filter(([header, key]) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header) && envName(key)).slice(0, 8));
    out.envKeys = [];
  } else {
    if (typeof row.command !== "string" || !row.command.trim() || row.command.length >= 1000) return null;
    const args = row.args ?? [];
    if (!Array.isArray(args) || args.length > LIMITS.args || !args.every((arg) => typeof arg === "string" && arg.length <= LIMITS.argChars)) return null;
    out.args = [...args];
    out.envKeys = (Array.isArray(row.envKeys) ? row.envKeys : []).filter(envName).slice(0, LIMITS.envKeys);
  }
  out.tools = (Array.isArray(row.tools) ? row.tools : []).slice(0, LIMITS.tools).map(cleanTool).filter(Boolean);
  out.places = (Array.isArray(row.places) ? row.places : []).filter((place) => PLACES.includes(place));
  out.off = (Array.isArray(row.off) ? row.off : []).filter(safeName);
  out.fingerprint = fingerprint(out);
  out.status = row.pending === true ? "needs-approval"
    : record(row.approval) && row.approval.fingerprint !== out.fingerprint ? "changed"
      : row.enabled === false ? "off" : "ready";
  return out;
}
async function readConfig(file = CONFIG) {
  try {
    if ((await fs.stat(file)).size > LIMITS.fileBytes) return null;
    const config = JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
    return record(config) ? config : null;
  } catch { return null; }
}
/** Every server in the file with its status (ready, needs-approval, changed, off), for Team › Connectors. */
async function rows(file = CONFIG) {
  const config = await readConfig(file);
  if (!record(config?.servers)) return [];
  return Object.entries(config.servers).slice(0, LIMITS.servers).map(([id, row]) => readRow(id, row)).filter(Boolean);
}
/** The servers Studio may start: ready ones only. */
async function servers(file = CONFIG) {
  return (await rows(file)).filter((row) => row.status === "ready");
}
// A configured command that is a batch shim on Windows ("npx" is npx.cmd):
// Node refuses to spawn .cmd/.bat without a shell (EINVAL), so the server
// never started. Only a shim goes through cmd.exe; an .exe still runs direct.
// Resolution follows the PATH order, .com/.exe before .bat/.cmd in each folder.
function windowsShim(command, env, platform = process.platform) {
  if (platform !== "win32") return null;
  const ext = path.win32.extname(command).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") return command;
  if (ext) return null;
  const dirs = /[\\/]/.test(command) ? [""] : String(env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    // The host join: on Windows it is the win32 one, and a test resolving the
    // win32 rule elsewhere still finds the files it wrote.
    const base = dir ? path.join(dir, command) : command;
    if (existsSync(`${base}.com`) || existsSync(`${base}.exe`)) return null;
    for (const shim of [".bat", ".cmd"]) if (existsSync(base + shim)) return base + shim;
  }
  return null;
}
/** The tools Studio may offer from ready servers: { id: "server/tool", name, server, description, inputSchema, places }. */
async function catalog(file) {
  return (await servers(file)).flatMap((server) => server.tools.filter((tool) => !server.off.includes(tool.name)).map((tool) => ({ id: `${server.id}/${tool.name}`, name: tool.name, server: server.id, description: String(tool.description || "Configured MCP tool").slice(0, 300), inputSchema: tool.inputSchema || { type: "object" }, places: [...server.places] })));
}

// ---- connections --------------------------------------------------------------------------------
const timedOut = (message) => Object.assign(new Error(message), { timedOut: true });
// A server's own error words, short, with anything that looks like a key masked.
const plainTail = (text, limit = 300) => String(text ?? "").replace(/\s+/g, " ").replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "…").trim().slice(-limit);
// Environment values are references to existing device variables, plus the values
// the owner saved for this server (passed in as `env`, never read from the file).
// Provider keys and the rest of Studio's environment are not inherited.
function serverEnv(server, env = {}) {
  const out = {};
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "WINDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "ComSpec", ...(server.envKeys || [])]) {
    if (typeof key === "string" && process.env[key] !== undefined) out[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(record(env) ? env : {})) if (envName(key) && typeof value === "string") out[key] = value;
  return out;
}
function startProblem(server, error) {
  if (error?.code === "ENOENT") {
    const program = path.basename(String(server.command ?? ""));
    const hint = /^(npx|npm|node)(\.cmd|\.exe)?$/i.test(program) ? " Install Node.js, then try again." : /^(uvx|uv)(\.exe)?$/i.test(program) ? " Install uv (docs.astral.sh/uv), then try again." : " Use the full path to the program.";
    return new Error(`${program || "That program"} was not found on this PC.${hint}`);
  }
  return new Error("MCP server could not start.");
}
// One stdio connection, initialized: resolves when the server answered initialize.
function connectStdio(server, { env = {}, timeoutMs = 30000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const fullEnv = serverEnv(server, env);
    const shim = windowsShim(server.command, fullEnv);
    let child;
    try {
      child = shim
        ? spawnImpl(resolveComSpec(fullEnv), buildWindowsCmdArgs(shim, server.args || []), { env: fullEnv, windowsHide: true, windowsVerbatimArguments: true, stdio: ["pipe", "pipe", "pipe"] })
        : spawnImpl(server.command, server.args || [], { env: fullEnv, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) { reject(startProblem(server, error)); return; }
    // Through cmd.exe, kill() would end only cmd and orphan the server.
    const end = () => {
      if (!shim || !child.pid) { try { child.kill(); } catch { /* already gone */ } return; }
      try { spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); } catch { try { child.kill(); } catch { /* already gone */ } }
    };
    const endSync = () => {
      if (!shim || !child.pid) { try { child.kill(); } catch { /* already gone */ } return; }
      try { spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore", timeout: 5000 }); } catch { try { child.kill(); } catch { /* already gone */ } }
    };
    let sequence = 0, buffer = "", closed = false, stderr = "", info = null;
    const pending = new Map(), closers = new Set(), notices = new Set();
    const fail = (error) => {
      if (closed) return;
      closed = true;
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
      pending.clear();
      for (const listener of closers) { try { listener(error); } catch { /* a listener never breaks the close */ } }
      if (!info) reject(error);
    };
    const write = (value) => { if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`); };
    child.on("error", (error) => fail(startProblem(server, error)));
    // "close", not "exit": the last answer a server printed before it ended is still read.
    child.on("close", () => fail(new Error(info ? "MCP server exited." : `The connector stopped before it answered.${stderr.trim() ? ` It said: ${plainTail(stderr)}` : ""}`)));
    child.stdin.on("error", () => fail(new Error("MCP input closed.")));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > LIMITS.lineBytes) { fail(new Error("MCP output limit exceeded.")); end(); return; }
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.method && message.id !== undefined) {
          // A server may ask whether the client is still there; nothing else is offered to it.
          if (message.method === "ping") write({ id: message.id, result: {} });
          else write({ id: message.id, error: { code: -32601, message: "Client requests are not supported." } });
          continue;
        }
        if (message.method) { for (const listener of notices) { try { listener(message); } catch { /* ignore */ } } continue; }
        const item = pending.get(message.id); if (!item) continue;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(`MCP request failed${message.error.message ? `: ${plainTail(message.error.message, 200)}` : "."}`)); else item.resolve(message.result);
      }
    });
    const request = (method, params, { timeoutMs: limit = 60000 } = {}) => new Promise((done, refuse) => {
      if (closed) return refuse(new Error("MCP connection closed."));
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); refuse(timedOut("MCP request timed out.")); }, Math.max(1, limit));
      pending.set(id, { resolve: done, reject: refuse, timer }); write({ id, method, params });
    });
    const session = {
      transport: "stdio",
      get info() { return info; },
      alive: () => !closed,
      request,
      notify: (method, params) => write({ method, ...(params ? { params } : {}) }),
      listTools: (options) => listAll(request, options),
      close: () => { if (closed) return; fail(new Error("MCP connection closed.")); try { child.stdin.end(); } catch { /* closed */ } end(); },
      closeSync: () => { fail(new Error("MCP connection closed.")); endSync(); },
      onClose: (listener) => { closers.add(listener); return () => closers.delete(listener); },
      onNotice: (listener) => { notices.add(listener); return () => notices.delete(listener); },
      stderr: () => plainTail(stderr),
    };
    request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mefi-studio", version: VERSION } }, { timeoutMs })
      .then((init) => {
        if (!PROTOCOLS.includes(init?.protocolVersion)) throw new Error(`The connector speaks an MCP version Studio does not know (${String(init?.protocolVersion ?? "none").slice(0, 20)}).`);
        info = { protocolVersion: init.protocolVersion, serverInfo: record(init.serverInfo) ? { name: String(init.serverInfo.name ?? "").slice(0, 80), version: String(init.serverInfo.version ?? "").slice(0, 40) } : null, ms: Date.now() - started };
        write({ method: "notifications/initialized" });
        resolve(session);
      })
      .catch((error) => {
        const problem = error?.timedOut ? timedOut(`The connector did not answer within ${Math.round(timeoutMs / 1000)} seconds.${stderr.trim() ? ` It said: ${plainTail(stderr)}` : ""}`) : error;
        reject(problem); session.close();
      });
  });
}
// Every tool a session offers, page by page (at most eight pages).
async function listAll(request, { timeoutMs = 30000 } = {}) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 8; page++) {
    const list = await request("tools/list", cursor ? { cursor } : {}, { timeoutMs });
    if (Array.isArray(list?.tools)) tools.push(...list.tools.filter(record));
    cursor = list?.nextCursor; if (!cursor) break;
  }
  return tools;
}
// Server-sent events: the JSON-RPC message answering `id`, read as it streams.
async function readEvents(response, id, max = LIMITS.lineBytes) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", data = [], bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > max) throw new Error("MCP output limit exceeded.");
      buffer += decoder.decode(value, { stream: true });
      let at;
      while ((at = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + (buffer[at] === "\r" ? 2 : 1));
        if (line === "") {
          if (data.length) {
            let message; try { message = JSON.parse(data.join("\n")); } catch { message = null; }
            data = [];
            for (const item of Array.isArray(message) ? message : [message]) if (item && item.id === id && !item.method) return item;
          }
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  throw new Error("The connector closed the stream without answering.");
}
// One Streamable HTTP connection (MCP 2025-03-26 and later), initialized. Headers
// carry values the owner saved (headerKeys names which), never a model's words.
async function connectHttp(server, { env = {}, timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const url = httpAddress(server.url);
  if (!url) throw new Error("That address can not be used: Studio reads https:// addresses, or http:// on this PC.");
  const base = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": `mefi-studio/${VERSION}` };
  for (const [header, key] of Object.entries(record(server.headerKeys) ? server.headerKeys : {})) {
    const value = env?.[key] ?? process.env[key];
    if (typeof value !== "string" || !value || /[\r\n]/.test(value)) continue;
    // A bare token saved for Authorization is sent the way such servers expect it.
    base[header] = header.toLowerCase() === "authorization" && !/\s/.test(value.trim()) ? `Bearer ${value.trim()}` : value;
  }
  let session = null, protocol = null, closed = false, sequence = 0, info = null;
  const closers = new Set();
  const headers = () => ({ ...base, ...(session ? { "Mcp-Session-Id": session } : {}), ...(protocol ? { "MCP-Protocol-Version": protocol } : {}) });
  async function post(message, limit) {
    if (closed) throw new Error("MCP connection closed.");
    const signal = AbortSignal.timeout(Math.max(1, limit));
    let response;
    try { response = await fetchImpl(url, { method: "POST", headers: headers(), body: JSON.stringify({ jsonrpc: "2.0", ...message }), signal, redirect: "error" }); }
    catch (error) { throw signal.aborted ? timedOut("MCP request timed out.") : new Error(`The connector could not be reached (${String(error?.cause?.code || error?.message || "network error").slice(0, 60)}).`); }
    const given = response.headers.get("mcp-session-id");
    if (given && !session && /^[\x21-\x7e]{1,200}$/.test(given)) session = given;
    if (message.id === undefined) { await response.body?.cancel?.().catch(() => {}); return null; }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel?.().catch(() => {}); throw new Error(`The connector refused Studio (HTTP ${response.status}). Check the key saved for it.`); }
    if (!response.ok) { await response.body?.cancel?.().catch(() => {}); throw new Error(`The connector answered HTTP ${response.status}.`); }
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    let reply;
    try {
      if (type.includes("text/event-stream")) reply = await readEvents(response, message.id);
      else {
        const text = await response.text();
        if (text.length > LIMITS.lineBytes) throw new Error("MCP output limit exceeded.");
        const parsed = JSON.parse(text);
        reply = (Array.isArray(parsed) ? parsed : [parsed]).find((item) => item?.id === message.id);
      }
    } catch (error) { throw signal.aborted ? timedOut("MCP request timed out.") : error; }
    if (!reply) throw new Error("The connector's answer did not match the question.");
    if (reply.error) throw new Error(`MCP request failed${reply.error.message ? `: ${plainTail(reply.error.message, 200)}` : "."}`);
    return reply.result;
  }
  const request = (method, params, { timeoutMs: limit = 60000 } = {}) => post({ id: ++sequence, method, params }, limit);
  const close = () => {
    if (closed) return;
    closed = true;
    for (const listener of closers) { try { listener(new Error("MCP connection closed.")); } catch { /* ignore */ } }
    if (session) fetchImpl(url, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(3000), redirect: "error" }).then((response) => response.body?.cancel?.(), () => {}).catch(() => {});
  };
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mefi-studio", version: VERSION } }, { timeoutMs }).catch((error) => {
    throw error?.timedOut ? timedOut(`The connector did not answer within ${Math.round(timeoutMs / 1000)} seconds.`) : error;
  });
  if (!PROTOCOLS.includes(init?.protocolVersion)) { close(); throw new Error(`The connector speaks an MCP version Studio does not know (${String(init?.protocolVersion ?? "none").slice(0, 20)}).`); }
  protocol = init.protocolVersion;
  info = { protocolVersion: protocol, serverInfo: record(init.serverInfo) ? { name: String(init.serverInfo.name ?? "").slice(0, 80), version: String(init.serverInfo.version ?? "").slice(0, 40) } : null, ms: Date.now() - started };
  await post({ method: "notifications/initialized" }, 10000).catch(() => {});
  return {
    transport: "http",
    get info() { return info; },
    alive: () => !closed,
    request,
    notify: (method, params) => { post({ method, ...(params ? { params } : {}) }, 10000).catch(() => {}); },
    listTools: (options) => listAll(request, options),
    close, closeSync: close,
    onClose: (listener) => { closers.add(listener); return () => closers.delete(listener); },
    onNotice: () => () => {},
    stderr: () => "",
  };
}
/** An open, initialized connection to a server (stdio or HTTP). */
function connect(server, options = {}) {
  return server?.transport === "http" ? connectHttp(server, options) : connectStdio(server, options);
}

/**
 * One call: start the server, check the tool is still there, call it, stop it. `options.pool`
 * (createPool) keeps the connection instead. `options.env` adds the values the owner saved for it.
 */
async function call(server, name, args, { timeoutMs = 20000, env = {}, pool = null, spawnImpl, fetchImpl } = {}) {
  if (!(server.tools || []).some((tool) => tool.name === name)) throw new Error("MCP tool is not configured.");
  if (pool) return pool.call(server, name, args, { timeoutMs: Math.max(timeoutMs, 30000) });
  // One deadline for the whole call: each step gets what is left of it.
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1, deadline - Date.now());
  let session = null;
  try {
    session = await connect(server, { env, timeoutMs: left(), ...(spawnImpl ? { spawnImpl } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
    const tools = await session.listTools({ timeoutMs: left() });
    if (!tools.some((tool) => tool.name === name)) throw new Error("Configured MCP tool is unavailable on this server.");
    return await session.request("tools/call", { name, arguments: args }, { timeoutMs: left() });
  } catch (error) {
    if (error?.timedOut) throw timedOut("MCP request timed out.");
    throw error;
  } finally { session?.close(); }
}

/**
 * Start a server, ask it for its tools and stop it: what Team › Connectors' Test does.
 * { ms, protocolVersion, serverInfo, tools: [cleaned], skipped: [names Studio can not use] }.
 */
async function discover(server, { timeoutMs = 120000, env = {}, spawnImpl, fetchImpl } = {}) {
  const started = Date.now();
  let session = null;
  try {
    session = await connect(server, { env, timeoutMs, ...(spawnImpl ? { spawnImpl } : {}), ...(fetchImpl ? { fetchImpl } : {}) });
    const listed = await session.listTools({ timeoutMs: Math.max(5000, timeoutMs - (Date.now() - started)) });
    const tools = [], skipped = [];
    for (const tool of listed) {
      const clean = cleanTool(tool);
      if (clean && tools.length < LIMITS.tools && !tools.some((item) => item.name === clean.name)) tools.push(clean);
      else skipped.push(String(tool?.name ?? "").slice(0, 60));
    }
    return { ms: Date.now() - started, protocolVersion: session.info?.protocolVersion ?? null, serverInfo: session.info?.serverInfo ?? null, tools, skipped };
  } finally { session?.close(); }
}

/**
 * Connections kept open between calls, one per server. `envFor(server)` gives the values the owner
 * saved for a server when it starts. A connection closes after `idleMs` with nothing to do, when the
 * server's definition changes (another fingerprint), after a call that timed out (its state is
 * unknown), and on close()/closeAll(). At most `max` stay open; the one quiet the longest goes first.
 */
function createPool({ idleMs = 120000, max = 6, envFor = null, connectImpl = connect, startupMs = 30000 } = {}) {
  const open = new Map();
  function drop(entry) {
    if (open.get(entry.id) === entry) open.delete(entry.id);
    clearTimeout(entry.timer);
    entry.dropped = true;
    if (entry.session) entry.session.close();
    else entry.ready?.then((session) => session.close(), () => {});
  }
  function entryFor(server) {
    const print = fingerprint(server);
    let entry = open.get(server.id);
    if (entry && (entry.print !== print || (entry.session && !entry.session.alive()))) { drop(entry); entry = null; }
    if (entry) return entry;
    while (open.size >= max) {
      const quiet = [...open.values()].filter((item) => !item.busy).sort((a, b) => a.used - b.used)[0];
      if (!quiet) break;
      drop(quiet);
    }
    entry = { id: server.id, print, busy: 0, used: Date.now(), timer: null, tools: null, session: null, dropped: false };
    entry.ready = (async () => connectImpl(server, { env: envFor ? (await envFor(server)) || {} : {}, timeoutMs: startupMs }))();
    entry.ready.then((session) => {
      if (entry.dropped) { session.close(); return; }
      entry.session = session;
      session.onClose(() => { if (open.get(entry.id) === entry) open.delete(entry.id); });
      session.onNotice?.((message) => { if (message?.method === "notifications/tools/list_changed") entry.tools = null; });
    }, () => { if (open.get(entry.id) === entry) open.delete(entry.id); });
    open.set(server.id, entry);
    return entry;
  }
  async function call(server, name, args, { timeoutMs = 60000 } = {}) {
    const entry = entryFor(server);
    entry.busy += 1; clearTimeout(entry.timer); entry.used = Date.now();
    try {
      const session = await entry.ready;
      if (!entry.tools?.has(name)) entry.tools = new Set((await session.listTools({ timeoutMs })).map((tool) => tool.name));
      if (!entry.tools.has(name)) throw new Error("Configured MCP tool is unavailable on this server.");
      return await session.request("tools/call", { name, arguments: args }, { timeoutMs });
    } catch (error) {
      if (error?.timedOut || !entry.session?.alive?.()) drop(entry);
      throw error;
    } finally {
      entry.busy -= 1; entry.used = Date.now();
      if (!entry.busy && open.get(entry.id) === entry) {
        entry.timer = setTimeout(() => { if (!entry.busy) drop(entry); }, idleMs);
        entry.timer.unref?.();
      }
    }
  }
  return {
    call,
    close: (id) => { const entry = open.get(id); if (entry) drop(entry); },
    closeAll: () => { for (const entry of [...open.values()]) drop(entry); },
    // For a process that is exiting: every server and what it started end now.
    closeAllSync: () => { for (const entry of [...open.values()]) { if (open.get(entry.id) === entry) open.delete(entry.id); entry.dropped = true; clearTimeout(entry.timer); entry.session?.closeSync?.(); } },
    ids: () => [...open.keys()],
    size: () => open.size,
  };
}

module.exports = { CONFIG, PLACES, LIMITS, PROTOCOLS, VERSION, servers, rows, catalog, call, discover, connect, createPool, fingerprint, windowsShim, httpAddress, cleanTool, readConfig, safeName, envName };
