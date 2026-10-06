// Per-run tool attachments for the workers with supported MCP injection:
// OpenCode's config file (OPENCODE_CONFIG), Claude Code's --mcp-config file,
// and the server table (`servers`) Codex takes as -c overrides. A temp folder
// under C:\Users\John Smith is fine: the executor quotes the path for cmd.exe
// (executorCore.cliInvocation), where it used to turn Studio tools off.
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const tools = require("./agent-tools.cjs");
// `review` says whether the builder-only tools run_check and project_logs are on ({ advisory }); `logs` is the text
// of the preview output Studio has captured so far, which becomes preview.log beside the policy for project_logs to
// read (updateLogs keeps it current while the run lasts). The whole folder goes when the run ends.
//
// The connector tools the worker may use are settled here, once: the team's picks and every tool of a connector that
// is on for builders (agent-tools.cjs connectorTools). `envFor(server)` gives the values the owner saved for a
// connector (Team › Connectors, kept encrypted by the host); they ride the run's private policy file (mode 0600, gone
// when the run ends) like the desk's token, never Codex's command line. `skills` is settings.skillUse plus the team's
// own picks for the builder, so the worker's use_skill offers what Studio's builder prompt would.
async function prepare({ root, settings, desk, script, dir = os.tmpdir(), node = process.execPath, review = null, logs = null, envFor = null, mcpFile = undefined }) {
  const folder = await fs.mkdtemp(path.join(dir, "mefi-tools-"));
  const files = { folder, opencode: path.join(folder, "opencode.json"), claude: path.join(folder, "claude.json"), servers: null, logs: null };
  try {
    const config = path.join(folder, "policy.json");
    if (typeof logs === "string") {
      files.logs = path.join(folder, "preview.log");
      await fs.writeFile(files.logs, logs, { mode: 0o600, flag: "wx" });
    }
    const policy = tools.policy(settings, "builder");
    const connectors = await tools.connectorTools(settings, "builder", { mcpFile }).catch(() => []);
    policy.mcpTools = connectors.map((tool) => tool.id);
    const connectorEnv = {};
    if (typeof envFor === "function") {
      const ids = [...new Set(connectors.map((tool) => tool.server))];
      const ready = ids.length ? await tools.mcp.servers(mcpFile) : [];
      for (const server of ready.filter((row) => ids.includes(row.id))) {
        const env = await Promise.resolve(envFor(server)).catch(() => null);
        if (env && typeof env === "object" && Object.keys(env).length) connectorEnv[server.id] = env;
      }
    }
    const skills = { use: settings?.skillUse ?? null, picked: Array.isArray(settings?.agentSkills?.builder) ? settings.agentSkills.builder : [] };
    files.connectors = policy.mcpTools.length;
    await fs.writeFile(config, JSON.stringify({ root, policy, skills, ...(Object.keys(connectorEnv).length ? { connectorEnv } : {}), ...(review ? { review: { advisory: review.advisory !== false } } : {}), ...(files.logs ? { logs: files.logs } : {}) }), { mode: 0o600, flag: "wx" });
    const env = { MEFI_TOOLS_CONFIG: config, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    const open = desk?.opencode ? JSON.parse(await fs.readFile(desk.opencode, "utf8")) : {};
    const claude = desk?.claude ? JSON.parse(await fs.readFile(desk.claude, "utf8")) : {};
    open.mcp = { ...open.mcp, mefi_tools: { type: "local", command: [node, script], environment: env, enabled: true } };
    claude.mcpServers = { ...claude.mcpServers, mefi_tools: { command: node, args: [script], env } };
    await fs.writeFile(files.opencode, JSON.stringify(open), { mode: 0o600, flag: "wx" });
    await fs.writeFile(files.claude, JSON.stringify(claude), { mode: 0o600, flag: "wx" });
    files.servers = claude.mcpServers;
    return files;
  } catch (error) { await remove(files); throw error; }
}
// The preview output changed: the file project_logs reads is replaced whole (a reader never sees half of it).
async function updateLogs(files, text) {
  if (!files?.logs || typeof text !== "string" || !path.basename(files.folder ?? "").startsWith("mefi-tools-")) return false;
  const temp = `${files.logs}.${process.pid}.tmp`;
  try { await fs.writeFile(temp, text, { mode: 0o600 }); await fs.rename(temp, files.logs); return true; } catch { await fs.rm(temp, { force: true }).catch(() => {}); return false; }
}
async function remove(files) {
  if (!files?.folder || !path.basename(files.folder).startsWith("mefi-tools-")) return;
  for (const name of ["policy.json", "opencode.json", "claude.json", "preview.log", `preview.log.${process.pid}.tmp`]) await fs.rm(path.join(files.folder, name), { force: true }).catch(() => {});
  await fs.rmdir(files.folder).catch(() => {});
}
// Folders a run left behind (Studio was closed or killed while a builder ran): its policy file can hold the values a
// connector needed, so at start Studio removes every mefi-tools-* folder older than `olderThanMs` (a run is killed long
// before that), leaving any folder a run of another Studio window might still use alone. { removed } is how many went.
async function sweep({ dir = os.tmpdir(), olderThanMs = 6 * 60 * 60 * 1000, now = Date.now() } = {}) {
  let removed = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^mefi-tools-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const folder = path.join(dir, entry.name);
    const info = await fs.stat(folder).catch(() => null);
    if (!info || now - info.mtimeMs < olderThanMs) continue;
    await remove({ folder });
    if (!(await fs.stat(folder).catch(() => null))) removed += 1;
  }
  return { removed };
}
module.exports = { prepare, remove, updateLogs, sweep };
