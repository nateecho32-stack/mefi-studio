"use strict";

const providerSetups = require("./provider-setups.cjs");

// Only these vendor-owned commands can be launched by the setup IPC. Neither
// commands nor URLs are accepted from the renderer. See docs/cli-setup.md.
const CLIS = Object.freeze([
  { id: "codex", name: "Codex", cmd: "codex", package: "@openai/codex", login: "codex login", docs: "https://developers.openai.com/codex/cli", site: "https://openai.com/codex", plans: "https://openai.com/chatgpt/pricing" },
  { id: "claude", name: "Claude Code", cmd: "claude", install: "irm https://claude.ai/install.ps1 | iex", login: "claude auth login", docs: "https://code.claude.com/docs/en/setup", site: "https://claude.com/product/claude-code", plans: "https://claude.com/pricing" },
  { id: "grok", name: "Grok", cmd: "grok", package: "@xai-official/grok", login: "grok login", docs: "https://docs.x.ai/build/cli/reference", site: "https://x.ai/grok", plans: "https://grok.com/plans" },
  { id: "antigravity", name: "Antigravity", cmd: "agy", install: "irm https://antigravity.google/cli/install.ps1 | iex", login: "agy", docs: "https://www.antigravity.google/docs/cli/install/", site: "https://antigravity.google", plans: "https://one.google.com/about/google-ai-plans/" },
  { id: "opencode", name: "OpenCode", cmd: "opencode", package: "opencode-ai", login: "opencode auth login", docs: "https://opencode.ai/docs/", site: "https://opencode.ai", plans: "https://opencode.ai/go" },
]);
// Key-only providers have no tool to install: the guide just opens their pages.
// Fixed here, like the CLIs' pages, so the renderer never hands over a URL.
const LINK_ONLY = Object.freeze([
  { id: "openrouter", name: "OpenRouter", site: "https://openrouter.ai", plans: "https://openrouter.ai/models", keys: "https://openrouter.ai/keys" },
]);
const PAGE_ACTIONS = Object.freeze(["site", "plans", "keys"]);
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
  // Per-kind-of-job routes to other tools would break "only this provider".
  delete settings.agentKinds;
  // A provider with a verified tier map gets its models picked, not left blank:
  // heavy seats (lead, desk, overseer) take Opus, companion and scout take
  // Haiku, and builders take Sonnet for changes. Every seat starts at low effort.
  const plan = providerSetups.planFor(provider);
  if (plan) {
    // A tier the owner already picked for this provider keeps its model; only blanks are filled.
    const saved = settings.aiModelsByProvider?.[provider] || {};
    settings.aiModelsByProvider = { ...(settings.aiModelsByProvider || {}), [provider]: { heavy: saved.heavy || plan.heavy.model, routine: saved.routine || plan.quick.model } };
    // Builders on the Auto tier use executorModel (main.cjs executorModelOverride), so they
    // take Sonnet 5.5 for changes. Haiku takes no reasoning effort (model-ladder cliEfforts),
    // so its seats keep none.
    settings.executorModel = plan.routine.model;
    settings.agentSeats = Object.fromEntries(["lead", "desk", "companion", "scout", "overseer"].map((seat) => {
      const tier = seat === "companion" || seat === "scout" ? "routine" : "heavy";
      return [seat, { provider, model: settings.aiModelsByProvider[provider][tier], effort: tier === "heavy" ? plan.heavy.effort : "", fast: false }];
    }));
  }
  return settings;
}

// "Use for the whole studio" means every project: the Studio defaults and each
// team a project saved of its own (settings.agentTeams.projects) take the one
// subscription, and a project that inherits the defaults follows them.
// `profiles` is scripts/agent-profiles.cjs. Its update() rewrites a team from
// that team's own saved copy, so a project keeps its rules (singleProvider
// never touches agentRules, which are the project's own words) and its name,
// and every rewrite bumps the teams' revision: an Agents draft opened before
// this is refused as stale instead of saving the old providers back.
// Returns how many project teams were switched.
function singleProviderEverywhere(settings, provider, profiles = null) {
  singleProvider(settings, provider);
  if (!profiles) return 0;
  let switched = 0;
  for (const projectId of profiles.projectTeams(settings)) {
    if (profiles.update(settings, projectId, (team) => { singleProvider(team, provider); }) === null) switched += 1;
  }
  return switched;
}

// What setup says afterwards, counting the project teams it switched.
function wholeStudioMessage(provider, teams = 0) {
  const name = CLIS.find((cli) => cli.id === provider)?.name ?? provider;
  const reach = teams === 1 ? ", including the one project that has its own team" : teams > 1 ? `, including the ${teams} projects that have their own team` : "";
  return `${name} now handles chat, mapping, planning, every agent seat and coding across the studio${reach}. Its model access and usage limits still apply.`;
}

// The per-user folders vendor installers use. Studio's own PATH refresh
// (main.cjs refreshProcessPath) adds the same ones, so a CLI whose installer
// did not update the user PATH is still found here and signed in right away.
const INSTALL_FOLDERS = Object.freeze(["$env:USERPROFILE\\.local\\bin", "$env:LOCALAPPDATA\\agy\\bin", "$env:APPDATA\\npm", "$env:USERPROFILE\\.grok\\bin"]);
const refreshPathScript = `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path + ';' + (@(${INSTALL_FOLDERS.map((folder) => `"${folder}"`).join(", ")}) -join ';')`;
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
    // Studio re-reads PATH itself when this window closes, so a restart is
    // never the fix; a command still missing here needs its installer rerun.
    lines.push(refreshPathScript, `if (-not (Get-Command ${cli.cmd} -ErrorAction SilentlyContinue)) { throw 'Installation finished, but the ${cli.cmd} command was not found. Close this window: Studio refreshes your installed tools. If ${cli.name} is still missing, choose Install and sign in again or open Setup instructions.' }`);
  }
  lines.push(`Write-Host 'Sign in to ${cli.name} using the window or browser below. Then close this window and choose Check connection in Studio.'`, cli.login);
  return lines.join("\n");
}

// `closed` hears about a finished setup window once `refresh` has re-read
// PATH, so the host can tell the guide to re-detect tools at the right time.
// A sign-in may name one of the extra logins (`account`, an id only): the
// host's `loginEnv` answers with that login's folder variable, so the CLI
// signs in there and the renderer never hands over a path.
function createCliSetup({ spawn, openExternal, refresh = async () => {}, closed = () => {}, platform = process.platform, cwd, env = () => process.env, loginEnv = async () => null }) {
  const running = new Set();
  async function action(payload) {
    const { id, action, account = null } = payload || {};
    if (PAGE_ACTIONS.includes(action)) {
      const page = [...CLIS, ...LINK_ONLY].find((item) => item.id === id)?.[action];
      if (!page) return { ok: false, error: "That provider has no such page." };
      await openExternal(page);
      return { ok: true };
    }
    const cli = CLIS.find((item) => item.id === id);
    if (!cli || !["install", "login", "docs"].includes(action)) return { ok: false, error: "Unknown CLI setup action." };
    if (action === "docs") { await openExternal(cli.docs); return { ok: true }; }
    if (platform !== "win32") return { ok: false, error: "Guided installation currently runs on Windows. Open the setup instructions for this platform." };
    let extra = null;
    if (account) {
      if (action !== "login") return { ok: false, error: "An added login can only be signed in; install the tool itself from its main login." };
      extra = await loginEnv(id, account);
      if (!extra) return { ok: false, error: "That login is not saved." };
    }
    const key = account ? `${id}:${account}` : id;
    if (running.has(key)) return { ok: false, error: "A setup window for this tool is already open. Finish or close that window first." };
    running.add(key);
    try {
      const script = `try {\n${setupScript(id, action)}\n} catch { Write-Host $_.Exception.Message -ForegroundColor Red }\nRead-Host 'Press Enter to close this setup window'`;
      // A console of its own (setup-window.cjs, loaded on first use): a CLI's sign-in needs a terminal to ask in. Its close still re-checks.
      const { openSetupWindow } = require("./setup-window.cjs");
      const child = await openSetupWindow(spawn, script, { title: `Mefi Studio: ${cli.name} ${action === "login" ? "sign-in" : "setup"}`, cwd, env: extra ? { ...env(), ...extra } : env() });
      child.once("close", () => {
        running.delete(key);
        void Promise.resolve().then(() => refresh()).catch(() => {}).then(() => { try { closed({ id, action, ...(account ? { account } : {}) }); } catch {} });
      });
      child.unref();
      return { ok: true, launched: true, message: account
        ? `Sign in to the other ${cli.name} account in the setup window and browser, then close that window and choose Check.`
        : `Finish ${cli.name} setup in the setup window and browser, then close that window. Studio refreshes your installed tools when it closes (or choose Refresh installed tools); then choose Check connection.` };
    } catch (error) { running.delete(key); return { ok: false, error: `Could not open setup: ${error.message}` }; }
  }
  return { action };
}

module.exports = { CLIS, LINK_ONLY, SUBSCRIPTIONS, INSTALL_FOLDERS, singleProvider, singleProviderEverywhere, wholeStudioMessage, setupScript, createCliSetup };
