// MCP adapter for coding workers; the saved policy is captured at dispatch.
"use strict";
const fs = require("node:fs/promises");
const tools = require("./agent-tools.cjs");
// The app's own version, from the package.json beside scripts/.
const VERSION = (() => { try { return String(require("../package.json").version || "0.0.0"); } catch { return "0.0.0"; } })();
async function serve() {
  const config = JSON.parse(await fs.readFile(process.env.MEFI_TOOLS_CONFIG, "utf8"));
  // A coding worker has its own file listing and search: project_list and
  // project_search are for Studio's own models, so this server never offers them.
  const context = { root: config.root, settings: { agentTools: { builder: config.policy } }, role: "builder", worker: true };
  const definitions = await tools.definitions(context.settings, context.role, { worker: true });
  let buffer = "", chain = Promise.resolve();
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  async function handle(message) {
    if (message.id === undefined) return;
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mefi-tools", version: VERSION } };
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
