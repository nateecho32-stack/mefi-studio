// Per-run tool attachments for the two workers with supported MCP injection.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { SAFE_PATH } = require("./desk-server.cjs");
const tools = require("./agent-tools.cjs");
async function prepare({ root, settings, desk, script, dir = os.tmpdir(), node = process.execPath }) {
  const folder = await fs.mkdtemp(path.join(dir, "mefi-tools-"));
  if (!SAFE_PATH.test(folder)) { await fs.rmdir(folder); throw new Error("Studio tools need a temporary path without shell metacharacters or spaces."); }
  const files = { folder, opencode: path.join(folder, "opencode.json"), claude: path.join(folder, "claude.json") };
  try {
    const config = path.join(folder, "policy.json");
    await fs.writeFile(config, JSON.stringify({ root, policy: tools.policy(settings, "builder") }), { mode: 0o600, flag: "wx" });
    const env = { MEFI_TOOLS_CONFIG: config, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    const open = desk?.opencode ? JSON.parse(await fs.readFile(desk.opencode, "utf8")) : {};
    const claude = desk?.claude ? JSON.parse(await fs.readFile(desk.claude, "utf8")) : {};
    open.mcp = { ...open.mcp, mefi_tools: { type: "local", command: [node, script], environment: env, enabled: true } };
    claude.mcpServers = { ...claude.mcpServers, mefi_tools: { command: node, args: [script], env } };
    await fs.writeFile(files.opencode, JSON.stringify(open), { mode: 0o600, flag: "wx" });
    await fs.writeFile(files.claude, JSON.stringify(claude), { mode: 0o600, flag: "wx" });
    return files;
  } catch (error) { await remove(files); throw error; }
}
async function remove(files) {
  if (!files?.folder || !path.basename(files.folder).startsWith("mefi-tools-")) return;
  for (const name of ["policy.json", "opencode.json", "claude.json"]) await fs.rm(path.join(files.folder, name), { force: true }).catch(() => {});
  await fs.rmdir(files.folder).catch(() => {});
}
module.exports = { prepare, remove };
