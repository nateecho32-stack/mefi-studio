// MCP adapter for coding workers; the saved policy is captured at dispatch.
//
// The run's policy file (agent-tool-configs.cjs prepare) says which of Studio's
// tools this worker has, which connector tools it may use (settled when the run
// started: `policy.mcpTools`), the values saved for those connectors
// (`connectorEnv`), and how the owner's skills are used by builders (`skills`):
// the ones a builder may load by itself come through use_skill, read from the
// project, the home folder or Studio's own. Connector servers stay open for the
// length of the run (agent-mcp.cjs createPool) and end with it.
"use strict";
const fs = require("node:fs/promises");
const tools = require("./agent-tools.cjs");
const mcp = require("./agent-mcp.cjs");
// The app's own version, from the package.json beside scripts/.
const VERSION = (() => { try { return String(require("../package.json").version || "0.0.0"); } catch { return "0.0.0"; } })();
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// A connector's answer passed on as it came (its pictures too), bounded: text parts are cut at 12,000
// characters together, and at most four pictures of 2 MB each go through.
function passOn(result) {
  const content = [];
  let room = 12000, pictures = 0;
  for (const part of Array.isArray(result?.content) ? result.content.slice(0, 40) : []) {
    if (part?.type === "text" && typeof part.text === "string") {
      if (room <= 0) continue;
      content.push({ type: "text", text: part.text.slice(0, room) }); room -= part.text.length;
    } else if (part?.type === "image" && typeof part.data === "string" && part.data.length <= 2 * 1024 * 1024 && pictures < 4) {
      content.push({ type: "image", data: part.data, mimeType: String(part.mimeType || "image/png").slice(0, 60) }); pictures += 1;
    } else if (part?.type === "resource" && typeof part.resource?.text === "string" && room > 0) {
      content.push({ type: "text", text: part.resource.text.slice(0, room) }); room -= part.resource.text.length;
    }
  }
  if (!content.length) content.push({ type: "text", text: JSON.stringify(result ?? null).slice(0, 12000) });
  return { content, ...(result?.isError ? { isError: true } : {}) };
}
async function serve() {
  const config = JSON.parse(await fs.readFile(process.env.MEFI_TOOLS_CONFIG, "utf8"));
  const connectorEnv = record(config.connectorEnv) ? config.connectorEnv : {};
  // MEFI_STUDIO_NO_MCP_POOL=1: every call starts its server and stops it, as before kept connections.
  const pooled = process.env.MEFI_STUDIO_NO_MCP_POOL !== "1";
  const pool = pooled ? mcp.createPool({ idleMs: 10 * 60 * 1000, max: 8, envFor: (server) => (record(connectorEnv[server.id]) ? connectorEnv[server.id] : {}) }) : null;
  tools.useMcp({ pool });
  // How builders use the owner's skills, as the run started with it.
  if (record(config.skills)) {
    const addons = require("./agent-addons.cjs");
    const skillSettings = { skillUse: config.skills.use, agentSkills: { builder: Array.isArray(config.skills.picked) ? config.skills.picked : [] } };
    tools.useSkills({
      catalog: ({ root }) => addons.autoSkills(root, skillSettings, "builder"),
      load: ({ root, name }) => addons.loadSkill(root, skillSettings, "builder", name),
    });
  }
  // A coding worker has its own file listing and search: project_list and
  // project_search are for Studio's own models, so this server never offers them.
  // `review` (whether run_check and project_logs are on) and `logs` (the preview output file) come from the run's policy file.
  const context = { root: config.root, settings: { agentTools: { builder: config.policy }, ...(config.review ? { review: config.review } : {}) }, role: "builder", worker: true, places: false, connectorEnv, logs: typeof config.logs === "string" ? config.logs : null };
  const definitions = await tools.definitions(context.settings, context.role, { worker: true, places: false, root: context.root });
  let buffer = "", chain = Promise.resolve();
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  async function handle(message) {
    if (message.id === undefined) return;
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mefi-tools", version: VERSION } };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools: definitions.map(({ mcpId, ...tool }) => tool) };
    else if (message.method === "tools/call") {
      const name = message.params?.name;
      try {
        const output = await tools.execute(name, message.params?.arguments || {}, context);
        result = typeof name === "string" && name.startsWith("mcp__") ? passOn(output)
          : name === "use_skill" ? { content: [{ type: "text", text: `Skill: ${output.skill}\n${output.text}` }] }
            : { content: [{ type: "text", text: JSON.stringify(output).slice(0, 12000) }] };
      }
      catch (error) { result = { isError: true, content: [{ type: "text", text: error.message }] }; }
    } else return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not supported" } });
    send({ jsonrpc: "2.0", id: message.id, result });
  }
  // The run is over when the worker closes this server's input: its connectors end with it.
  const finish = () => { try { pool?.closeAllSync(); } catch { /* nothing left to close */ } };
  process.once("exit", finish);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk; if (buffer.length > 64000) { process.exitCode = 1; process.stdin.destroy(); finish(); return; }
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      chain = chain.then(() => handle(message)).catch(() => {});
    }
  });
  process.stdin.on("end", () => { chain.finally(() => { pool?.closeAll(); process.exitCode = 0; }); });
}
if (require.main === module) serve().catch(() => { process.exitCode = 1; });
module.exports = { passOn };
