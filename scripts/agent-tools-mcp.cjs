// MCP adapter for coding workers; the saved policy is captured at dispatch.
"use strict";
const fs = require("node:fs/promises");
const tools = require("./agent-tools.cjs");
async function serve() {
  const config = JSON.parse(await fs.readFile(process.env.MEFI_TOOLS_CONFIG, "utf8"));
  const context = { root: config.root, settings: { agentTools: { builder: config.policy } }, role: "builder" };
  const definitions = await tools.definitions(context.settings, context.role);
  let buffer = "", chain = Promise.resolve();
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  async function handle(message) {
    if (message.id === undefined) return;
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mefi-tools", version: "0.4.3" } };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools: definitions.map(({ mcpId, ...tool }) => tool) };
    else if (message.method === "tools/call") {
      try { result = { content: [{ type: "text", text: JSON.stringify(await tools.execute(message.params?.name, message.params?.arguments || {}, context)).slice(0, 12000) }] }; }
      catch (error) { result = { isError: true, content: [{ type: "text", text: error.message }] }; }
    } else return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not supported" } });
    send({ jsonrpc: "2.0", id: message.id, result });
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk; if (buffer.length > 64000) { process.exitCode = 1; process.stdin.destroy(); return; }
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      chain = chain.then(() => handle(message)).catch(() => {});
    }
  });
  process.stdin.on("end", () => { chain.finally(() => { process.exitCode = 0; }); });
}
if (require.main === module) serve().catch(() => { process.exitCode = 1; });
