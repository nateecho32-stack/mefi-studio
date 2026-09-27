"use strict";

// Only these vendor-owned commands can be launched by the setup IPC. Neither
// commands nor URLs are accepted from the renderer. See docs/cli-setup.md.
const CLIS = Object.freeze([
  { id: "codex", name: "Codex", cmd: "codex", package: "@openai/codex", login: "codex login", docs: "https://developers.openai.com/codex/cli" },
  { id: "claude", name: "Claude Code", cmd: "claude", install: "irm https://claude.ai/install.ps1 | iex", login: "claude auth login", docs: "https://code.claude.com/docs/en/setup" },
  { id: "grok", name: "Grok", cmd: "grok", package: "@xai-official/grok", login: "grok login", docs: "https://docs.x.ai/build/cli/reference" },
  { id: "antigravity", name: "Antigravity", cmd: "agy", install: "irm https://antigravity.google/cli/install.ps1 | iex", login: "agy", docs: "https://www.antigravity.google/docs/cli/install/" },
  { id: "opencode", name: "OpenCode", cmd: "opencode", package: "opencode-ai", login: "opencode auth login", docs: "https://opencode.ai/docs/" },
]);
const SUBSCRIPTIONS = Object.freeze(["codex", "claude", "grok", "antigravity"]);

function singleProvider(settings, provider) {
  if (!SUBSCRIPTIONS.includes(provider)) throw new Error("Choose a supported subscription CLI.");
  settings.aiProvider = provider;
  settings.aiRoleProviders = { routine: provider, heavy: provider };
  settings.aiAutoProviders = [provider];
  settings.aiAutoFallback = false;
  settings.aiFallbackOpenCode = false;
  settings.modelSelection = "fixed";
  settings.executorCli = provider;
  settings.executorTier = "auto";
  // Old unscoped model names and seat overrides must not redirect a new setup.
  settings.aiModels = {};
  settings.executorModel = "";
  settings.agentEfforts = {};
  settings.agentSeats = Object.fromEntries(["lead", "desk", "companion", "scout", "overseer"].map((seat) => [seat, {
    provider, model: settings.aiModelsByProvider?.[provider]?.[seat === "companion" || seat === "scout" ? "routine" : "heavy"] || "", effort: "", fast: false,
  }]));
  settings.agentSubtasks = { cli: "auto", model: "" };
  return settings;
}

const refreshPathScript = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path";
function setupScript(id, action) {
  const cli = CLIS.find((item) => item.id === id);
  if (!cli || !["install", "login"].includes(action)) throw new Error("Unknown CLI setup action.");
  const lines = ["$ErrorActionPreference = 'Stop'", refreshPathScript];
  if (action === "install") {
    if (cli.package) {
      lines.push("if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {",
        "  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js LTS from https://nodejs.org, then click Install again.' }",
        "  winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements",
        "  if ($LASTEXITCODE -ne 0) { throw 'Node.js installation did not finish. Retry or install Node.js from https://nodejs.org.' }",
        `  ${refreshPathScript}`, "}",
        `npm.cmd install --global ${cli.package}`,
        "if ($LASTEXITCODE -ne 0) { throw 'The CLI installation did not finish. Check the message above and retry.' }");
    } else lines.push(cli.install);
    lines.push(refreshPathScript, `if (-not (Get-Command ${cli.cmd} -ErrorAction SilentlyContinue)) { throw 'Installation finished, but the CLI is not on PATH yet. Restart Studio and check again.' }`);
  }
  lines.push(`Write-Host 'Sign in to ${cli.name} using the window or browser below. Then return to Studio and choose Check connection.'`, cli.login);
  return lines.join("\n");
}

function createCliSetup({ spawn, openExternal, refresh = async () => {}, platform = process.platform, cwd, env = () => process.env }) {
  const running = new Set();
  async function action(payload) {
    const { id, action } = payload || {};
    const cli = CLIS.find((item) => item.id === id);
    if (!cli || !["install", "login", "docs"].includes(action)) return { ok: false, error: "Unknown CLI setup action." };
    if (action === "docs") { await openExternal(cli.docs); return { ok: true }; }
    if (platform !== "win32") return { ok: false, error: "Guided installation currently runs on Windows. Open the setup instructions for this platform." };
    if (running.has(id)) return { ok: false, error: "A setup window for this tool is already open. Finish or close that window first." };
    running.add(id);
    try {
      const script = `try {\n${setupScript(id, action)}\n} catch { Write-Host $_.Exception.Message -ForegroundColor Red }\nRead-Host 'Press Enter to close this setup window'`;
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd, env: env(), windowsHide: false, detached: true, stdio: "ignore" });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.once("close", () => { running.delete(id); void refresh().catch(() => {}); });
      child.unref();
      return { ok: true, launched: true, message: `Finish ${cli.name} setup in the terminal and browser, then choose Check connection here.` };
    } catch (error) { running.delete(id); return { ok: false, error: `Could not open setup: ${error.message}` }; }
  }
  return { action };
}

module.exports = { CLIS, SUBSCRIPTIONS, singleProvider, setupScript, createCliSetup };
