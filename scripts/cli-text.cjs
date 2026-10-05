"use strict";
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("./platform.cjs");
const { buildWindowsCmdArgs } = require("./windows-command-line.cjs");
const { effortArgs } = require("./model-ladder.cjs");

const PROVIDERS = ["claude", "codex", "grok", "antigravity"];
// How hard the model thinks (scripts/model-ladder.cjs effortArgs): Claude
// Code's --effort and Codex's model_reasoning_effort. Grok and Antigravity take
// none, and an effort a CLI does not take is left off rather than refused.
function argumentsFor(provider, model = "", effort = "") {
  if (!PROVIDERS.includes(provider)) throw new Error("Unknown text CLI.");
  if (model && !/^[A-Za-z0-9 ._()/:-]{1,120}$/.test(model)) throw new Error("Invalid CLI model.");
  const selected = model ? ["--model", model] : [];
  const thinking = effort ? effortArgs(provider, effort) : [];
  if (provider === "claude") return ["-p", "--output-format", "json", "--strict-mcp-config", "--tools=", "--permission-mode", "dontAsk", "--no-session-persistence", ...selected, ...thinking];
  if (provider === "codex") return ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--color", "never", "-s", "read-only",
    "-c", "approval_policy=never", "-c", "web_search=disabled", "-c", "mcp_servers={}", "-c", "apps._default.enabled=false",
    ...["shell_tool", "unified_exec", "multi_agent", "hooks", "apps", "js_repl", "apply_patch_freeform", "image_generation", "computer_use"].flatMap((key) => ["-c", `features.${key}=false`]), ...thinking, ...selected, "-"];
  if (provider === "grok") return ["--output-format", "json", "--tools=", "--deny", "MCPTool", "--permission-mode", "dontAsk", "--no-subagents", "--disable-web-search", "--no-memory", "--no-plan", "--max-turns", "1", ...selected];
  return ["--agent", "mefi-text", "--input-format", "stream-json", "--output-format", "stream-json", ...selected];
}

// Text calls never run in the project directory. Antigravity receives no
// prompt until its init event confirms the no-tools agent actually loaded.
// A CLI too old for these controls fails visibly; never retry without them.
// `env` adds to the inherited environment: the folder of a second Claude
// Code or Codex login (scripts/cli-accounts.cjs).
async function run({ provider, system, user, model = "", effort = "", timeoutMs = 180000, onSpawn, spawnImpl = spawn, tempRoot = os.tmpdir(), platform = process.platform, env = null }) {
  let root;
  try {
    const args = argumentsFor(provider, model, effort);
    root = await mkdtemp(path.join(tempRoot, "mefi-text-"));
    if (provider === "grok") {
      const prompt = path.join(root, "prompt.txt");
      await writeFile(prompt, `${system}\n\n${user}`);
      args.push("--prompt-file", prompt);
    }
    if (provider === "antigravity") {
      const agents = path.join(root, ".agents", "agents");
      await mkdir(agents, { recursive: true });
      await writeFile(path.join(agents, "mefi-text.md"), "---\nname: mefi-text\ndescription: Answer Studio text requests without native tools.\nmainAgent: true\nsubagent: false\ntools: []\nmcpServers: []\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nAnswer using only the supplied text.\n");
    }
    const command = provider === "antigravity" ? "agy" : provider;
    return await new Promise((resolve) => {
      let child, timer, done = false, stdout = "", stderr = "", buffer = "", initialized = false, bytes = 0;
      const stop = () => {
        if (!child?.pid) return;
        if (platform === "win32") { const killer = spawnImpl("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); killer.on("error", () => {}); }
        else child.kill("SIGKILL");
      };
      const finish = (result) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, ...result }); };
      const extra = env && Object.keys(env).length ? { env: { ...process.env, ...env } } : {};
      try {
        child = platform === "win32" ? spawnImpl("cmd.exe", buildWindowsCmdArgs(command, args), { cwd: root, windowsHide: true, windowsVerbatimArguments: true, stdio: ["pipe", "pipe", "pipe"], ...extra })
          : spawnImpl(command, args, { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...extra });
        onSpawn?.(child);
        timer = setTimeout(() => { stop(); finish({ code: null, error: `${provider} timed out. Check its sign-in and usage limit in Connections.`, timedOut: true }); }, timeoutMs);
        child.on("error", (error) => finish({ code: null, error: error.message }));
        child.stdin?.on("error", () => {});
        child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
        child.stdout?.on("data", (chunk) => {
          if (done) return;
          bytes += Buffer.byteLength(chunk);
          if (bytes > 2000000) { stop(); finish({ code: null, error: "CLI response exceeded the size limit." }); return; }
          if (provider !== "antigravity") { stdout += chunk; return; }
          buffer += chunk;
          let at;
          while ((at = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
            let event; try { event = JSON.parse(line); } catch { continue; }
            if (event.event === "init" && !initialized) {
              if (event.init?.agent !== "mefi-text" || !Array.isArray(event.init?.tools) || event.init.tools.length) {
                stop(); finish({ code: null, error: "Antigravity did not enable its no-tools agent. Update Antigravity in setup and check the connection again." }); return;
              }
              initialized = true;
              child.stdin.end(JSON.stringify({ event: "user", message: { content: `${system}\n\n${user}` } }) + "\n");
            }
            if (event.event === "result") stdout = JSON.stringify(event.result);
          }
        });
        child.on("close", (code) => finish({ code, error: provider === "antigravity" && !initialized ? "Antigravity did not confirm its text-only session. Update it and retry." : null }));
        if (provider !== "antigravity") child.stdin.end(`${system}\n\n${user}`);
      } catch (error) { stop(); finish({ code: null, error: error.message }); }
    });
  } catch (error) { return { code: null, stdout: "", stderr: "", error: error.message }; }
  finally { if (root) await rm(root, { recursive: true, force: true }).catch(() => {}); }
}
module.exports = { argumentsFor, run };
