// Bounded stdio MCP client. Only device-configured executables are started;
// model input supplies a tool name and arguments, never a command or path.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const CONFIG = path.join(os.homedir(), ".mefi-studio", "mcp.json");
const safeName = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
async function servers(file = CONFIG) {
  try {
    if ((await fs.stat(file)).size > 128000) return [];
    const config = JSON.parse(await fs.readFile(file, "utf8"));
    return Object.entries(config.servers || {}).filter(([id, row]) => safeName(id) && row && typeof row.command === "string" && row.command.length < 1000 && Array.isArray(row.args || []) && (row.args || []).every((arg) => typeof arg === "string") && Array.isArray(row.tools) && row.tools.length <= 32 && row.tools.every((tool) => safeName(tool.name))).slice(0, 16).map(([id, row]) => ({ ...row, id }));
  } catch { return []; }
}
async function catalog(file) {
  return (await servers(file)).flatMap((server) => server.tools.map((tool) => ({ id: `${server.id}/${tool.name}`, name: tool.name, server: server.id, description: String(tool.description || "Configured MCP tool").slice(0, 300), inputSchema: tool.inputSchema || { type: "object" } })));
}
async function call(server, name, args, { timeoutMs = 20000 } = {}) {
  if (!server.tools.some((tool) => tool.name === name)) throw new Error("MCP tool is not configured.");
  // Environment values are references to existing device variables, not secrets
  // copied into team presets or the renderer. Do not inherit provider keys.
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TEMP", "TMP", ...(server.envKeys || [])]) {
    if (typeof key === "string" && process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawn(server.command, server.args || [], { env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let sequence = 0, buffer = "", closed = false, bytes = 0;
  const pending = new Map();
  const fail = (error) => { closed = true; for (const item of pending.values()) item.reject(error); pending.clear(); };
  const write = (value) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`);
  child.on("error", () => fail(new Error("MCP server could not start.")));
  child.on("exit", () => fail(new Error("MCP server exited.")));
  child.stdin.on("error", () => fail(new Error("MCP input closed.")));
  child.stderr.on("data", () => {});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 512000) { fail(new Error("MCP output limit exceeded.")); child.kill(); return; }
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.method && message.id !== undefined) { write({ id: message.id, error: { code: -32601, message: "Client requests are not supported." } }); continue; }
      const item = pending.get(message.id); if (!item) continue;
      pending.delete(message.id);
      if (message.error) item.reject(new Error("MCP request failed.")); else item.resolve(message.result);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error("MCP connection closed."));
    const id = ++sequence; pending.set(id, { resolve, reject }); write({ id, method, params });
  });
  const timer = setTimeout(() => { fail(new Error("MCP request timed out.")); child.kill(); }, timeoutMs);
  try {
    const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mefi-studio", version: "0.4.3" } });
    if (!["2024-11-05", "2025-03-26", "2025-06-18"].includes(init?.protocolVersion)) throw new Error("Unsupported MCP protocol version.");
    write({ method: "notifications/initialized" });
    let cursor, found = false;
    for (let page = 0; page < 8; page++) {
      const list = await request("tools/list", cursor ? { cursor } : {});
      found ||= list?.tools?.some((tool) => tool.name === name) === true;
      cursor = list?.nextCursor; if (found || !cursor) break;
    }
    if (!found) throw new Error("Configured MCP tool is unavailable on this server.");
    return await request("tools/call", { name, arguments: args });
  } finally {
    clearTimeout(timer); fail(new Error("MCP connection closed.")); child.stdin.end(); child.kill();
  }
}
module.exports = { CONFIG, servers, catalog, call };
