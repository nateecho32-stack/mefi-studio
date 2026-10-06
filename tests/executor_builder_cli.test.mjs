// The non-default builder CLIs on the real dispatch path (spawnNextJob in the
// executor host fixture) and the heavier retry's model choice (main.cjs's
// tier helpers in a vm). No real CLI, file or model request.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { executorHost } from "./fixtures/host_executor.mjs";

const codexHarness = createRequire(import.meta.url)("../scripts/codex-harness.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
// The host's own model-id filters, as the command lines use them.
const filters = section("function cliModelArg(", "// The Claude Code CLI as an assistant route") + section("function agyModelArg(", "// The Antigravity CLI as an assistant route");
const boardTask = (id, extra = {}) => ({ id, title: `Fixture card ${id}`, prompt: `Build ${id} as its brief says.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });
const settled = async (h) => { for (let turn = 0; turn < 20 && h.autopilot.jobs.length; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
const opencodeFallback = { cli: "opencode", via: "opencode default", modelArgs: "", env: {} };

// Spawns seen by the fixture, with their options (it keeps only the child).
function recordSpawns(h) {
  const seen = [];
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => {
    if (command !== "taskkill") seen.push({ command, args, options });
    return spawn(command, args, options);
  };
  return seen;
}

// The guided installer's `npm install --global @xai-official/grok` leaves
// grok.cmd on PATH, and Node cannot spawn a .cmd without a shell: every Grok
// run failed ENOENT while where.exe reported the CLI installed.
test("a grok installed as npm's grok.cmd runs through cmd.exe, its brief in a prompt file removed when the run ends", async () => {
  const h = executorHost({ tasks: [boardTask("grok")] });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => ({ via: "grok cli", cli: "grok", grok: true, model: "grok-4", modelArgs: "", env: {} });
  const shim = "C:\\Users\\John Smith\\AppData\\Roaming\\npm\\grok.cmd";
  h.env.windowsShim = (name) => (name === "grok" ? shim : null);
  const seen = recordSpawns(h);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, "cmd.exe");
  assert.equal(seen[0].options.windowsVerbatimArguments, true, "the line is quoted by windows-command-line, not re-escaped by Node");
  assert.ok(seen[0].args[3].startsWith(`""${shim}" --output-format plain --always-approve`), seen[0].args[3]);
  assert.ok(seen[0].args[3].includes(" -m grok-4 --prompt-file "), seen[0].args[3]);
  assert.equal(entry.promptFile, path.join(path.dirname(h.env.projectDataPath("tasks")), "task-runs", `${entry.id}.prompt.txt`));
  assert.ok(seen[0].args[3].includes(entry.promptFile), "the command line names the file, never the brief");
  const brief = h.runFiles().get(entry.promptFile);
  assert.match(brief, /Build grok as its brief says\./);
  assert.match(brief, /MEFI_JOB_DONE/);
  assert.ok(!seen[0].args[3].includes("Build grok"), "the brief is not on the command line");
  assert.equal(h.starts[0].child.prompt, undefined, "grok reads no prompt on stdin");
  await h.finish("grok");
  assert.equal(h.runFiles().has(entry.promptFile), false, "the prompt file goes with the run");
});

// The Codex route over `codex app-server` (scripts/codex-harness.cjs): the
// host wraps the child in the harness facade with the run's plan, writes no
// prompt on stdin (the facade sends it as the turn), and a server that never
// got going runs the same attempt once more over `codex exec`, on the same
// claim, before any OpenCode fallback.
test("a Codex route runs over codex app-server, and a server that cannot start retries the attempt over codex exec", async () => {
  const h = executorHost({ tasks: [boardTask("cx")] });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => ({ via: "codex cli", cli: "codex", codex: true, model: "gpt-6.1-sol", codexHarness: "app-server", modelArgs: "", env: {}, opencode: opencodeFallback });
  const wrapped = [];
  h.env.codexHarness = { ...codexHarness, wrapChild: (child, plan) => {
    const facade = Object.assign(new EventEmitter(), { pid: child.pid, stdout: child.stdout, stderr: child.stderr, stdin: child.stdin, codex: {} });
    wrapped.push({ child, plan, facade });
    return facade;
  } };
  const seen = recordSpawns(h);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(seen.length, 1);
  assert.match(seen[0].args.join(" "), /codex app-server/);
  assert.equal(wrapped.length, 1, "the app-server child is wrapped");
  assert.equal(wrapped[0].plan.model, "gpt-6.1-sol");
  assert.match(wrapped[0].plan.prompt, /Build cx as its brief says\./);
  assert.equal(wrapped[0].plan.approvalPolicy, "never");
  assert.equal(h.starts[0].child.prompt, undefined, "the harness owns the server's stdin");
  wrapped[0].facade.emit("error", Object.assign(new Error("codex app-server could not start: no answer to initialize"), { code: codexHarness.START_FAILED }));
  assert.equal(seen.length, 2, "one retry");
  assert.match(seen[1].args.join(" "), /codex exec --dangerously-bypass-approvals-and-sandbox/);
  assert.match(h.starts[1].child.prompt, /Build cx as its brief says\./, "exec reads the brief on stdin");
  assert.equal(wrapped.length, 1, "the retry is not wrapped");
  assert.equal(h.autopilot.jobs[0].codexExecOnly, true);
  assert.equal(h.autopilot.jobs[0].fallbackTried, undefined, "OpenCode is still the run's last resort");
  await h.finish("cx");
});

test("an app server that exits during its handshake (a Codex without app-server) also retries over codex exec", async () => {
  const h = executorHost({ tasks: [boardTask("old")] });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => ({ via: "codex cli", cli: "codex", codex: true, model: "", codexHarness: "app-server", modelArgs: "", env: {}, opencode: opencodeFallback });
  const wrapped = [];
  h.env.codexHarness = { ...codexHarness, wrapChild: (child, plan) => {
    const facade = Object.assign(new EventEmitter(), { pid: child.pid, stdout: child.stdout, stderr: child.stderr, stdin: child.stdin, codex: { startFailed: false } });
    wrapped.push({ child, plan, facade });
    return facade;
  } };
  const seen = recordSpawns(h);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  wrapped[0].facade.codex.startFailed = true;
  wrapped[0].facade.stderr.emit("data", "error: unrecognized subcommand 'app-server'\n");
  wrapped[0].facade.emit("close", 2);
  assert.equal(seen.length, 2, "one retry, not an OpenCode fallback");
  assert.match(seen[1].args.join(" "), /codex exec /);
  assert.equal(h.autopilot.jobs[0].codexExecOnly, true);
  assert.equal(h.autopilot.jobs[0].fallbackTried, undefined);
  // The retry is exec: a second failure there is the run's own, not another retry.
  await h.finish("old");
});

test("a grok that is a native binary still spawns directly, with the same prompt file", async () => {
  const h = executorHost({ tasks: [boardTask("native")] });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => ({ via: "grok cli", cli: "grok", grok: true, model: "", modelArgs: "", env: {}, opencode: opencodeFallback });
  h.env.windowsShim = () => null;
  const direct = [];
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => {
    if (command === "grok") { direct.push({ args, options }); return spawn("cmd.exe", ["/d", "/s", "/c", "fixture grok"], options); }
    return spawn(command, args, options);
  };
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0].args.slice(-2), ["--prompt-file", h.autopilot.jobs[0].promptFile]);
  assert.equal(direct[0].options.windowsVerbatimArguments, undefined);
});

// A machine with no coding CLI at all routes to OpenCode, and every start
// failed "'opencode' is not recognized…" until the card parked.
test("with no coding tool installed the OpenCode route refuses before the claim and says what to install", async () => {
  for (const installed of [false, true]) {
    const h = executorHost({ tasks: [boardTask("bare")] });
    h.env.executorRunEnv = async () => ({ ...opencodeFallback });
    h.env.opencodeCliAvailable = async () => installed;
    const seen = recordSpawns(h);
    if (installed) {
      assert.equal(await h.env.spawnNextJob(), "spawned");
      continue;
    }
    assert.equal(await h.env.spawnNextJob(), "route");
    assert.deepEqual(seen, [], "nothing was started");
    assert.equal(h.board().tasks[0].status, "open", "the card was never claimed");
    assert.equal(h.board().tasks[0].runFailures ?? 0, 0, "and no attempt was charged");
    assert.match(h.autopilot.lastError, /^No coding tool is installed\. Install OpenCode, Claude Code or Codex under Team › Providers\.$/);
  }
});

// For a Claude- or Codex-only owner the fallback ran `opencode run`, failed
// with "'opencode' is not recognized", and that line replaced the real error.
test("without OpenCode installed a CLI builder has no fallback, and its own error stays on the card", async () => {
  for (const installed of [false, true]) {
    const h = executorHost({ tasks: [boardTask("solo")] });
    vm.runInContext(filters, h.env);
    h.env.executorRunEnv = async () => ({ via: "claude cli", cli: "claude", claude: true, model: "", modelArgs: "", env: {}, opencode: { ...opencodeFallback } });
    h.env.opencodeCliAvailable = async () => installed;
    assert.equal(await h.env.spawnNextJob(), "spawned");
    const first = h.starts[0].child;
    first.stderr.emit("data", "Error: Invalid API key · Please run /login\n");
    first.emit("close", 1);
    await settled(h);
    if (installed) {
      assert.equal(h.starts.length, 2, "with OpenCode installed a CLI that never started still falls back");
      continue;
    }
    assert.equal(h.starts.length, 1, "nothing else was started");
    assert.equal(h.records.some((row) => row?.event === "fallback"), false);
    const card = h.board().tasks[0];
    assert.match(String(card.lastAttempt?.tail ?? ""), /Invalid API key/, "the CLI's own words are the attempt's last words");
    assert.ok(!JSON.stringify(card).includes("not recognized"));
  }
});

test("a pending heavier retry reroutes that attempt only, after routing and before the claim", async () => {
  const decided = { decisions: [{ at: 5, choice: "retry-deep", kind: "capability" }], lastAttempt: { startedAt: 2, at: 4 } };
  const h = executorHost({ tasks: [boardTask("deep", { createdAt: 1, ...decided }), boardTask("plain", { createdAt: 2 })], parallel: 2 });
  h.env.executorRunEnv = async () => ({ via: "opencode default", cli: "opencode", modelArgs: "", env: {} });
  const asked = [];
  h.env.heavyRetryRoute = async (route) => {
    asked.push(route.via);
    route.model = "mefi-zai/glm-5.3";
    route.modelArgs = " --model mefi-zai/glm-5.3";
    route.via = "mefi-zai/glm-5.3 · heavier retry";
    return route.model;
  };
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.deepEqual(asked, ["opencode default"], "only the card with the pending decision is rerouted");
  assert.deepEqual(h.starts.map((start) => start.taskId).sort(), ["deep", "plain"]);
  assert.ok(h.logs.some((line) => line.includes("run via mefi-zai/glm-5.3 · heavier retry") && line.includes("Fixture card deep")), h.logs.join("\n"));
  assert.ok(h.logs.some((line) => line.includes("run via opencode default") && line.includes("Fixture card plain")));
});

// Antigravity's models are display names; the id pattern the other CLIs'
// subtask models pass refused them, and the subtask ran the default instead.
test("a subtask's Antigravity display-name model reaches agy's command line", async () => {
  for (const [model, expected] of [["Gemini 3.1 Pro (High)", "Gemini 3.1 Pro (High)"], ["x & calc", null]]) {
    const h = executorHost({ tasks: [boardTask("sub", { delegatedFrom: { parentTaskId: "parent", scope: "s" } })] });
    vm.runInContext(filters, h.env);
    h.env.readAgentSettings = async () => ({ agentSubtasks: { cli: "auto", model } });
    h.env.executorRunEnv = async () => ({ via: "antigravity cli", cli: "antigravity", antigravity: true, model: "", modelArgs: "", env: {} });
    const direct = [];
    const spawn = h.env.spawn;
    h.env.spawn = (command, args, options) => {
      if (command === "agy") { direct.push(args); return spawn("cmd.exe", ["/d", "/s", "/c", "fixture agy"], options); }
      return spawn(command, args, options);
    };
    assert.equal(await h.env.spawnNextJob(), "spawned");
    assert.equal(direct.length, 1);
    if (expected) assert.deepEqual(direct[0].slice(0, 2), ["--model", expected]);
    else assert.equal(direct[0].includes("--model"), false, "a model agyModelArg refuses never reaches the command line");
    if (expected) assert.match(h.autopilot.jobs[0].routeLabel ?? "", /antigravity/);
  }
});

// ---- the heavier retry's model --------------------------------------------------

function tierHost(settings, { zai = true, goLinked = null } = {}) {
  const logs = [];
  const env = vm.createContext({
    process: { env: {} },
    AI_PROVIDERS: ["auto", "zai", "opencode", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"],
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3",
    readSettings: async () => settings,
    zaiOpencodeEnv: async () => (zai ? { OPENCODE_CONFIG_CONTENT: '{"provider":{"mefi-zai":{}}}', MEFI_ZAI_API_KEY: "fixture" } : null),
    opencodeGoProbe: { checkedAt: 0, linked: goLinked, pending: null },
    logLine: (line) => logs.push(line),
  });
  vm.runInContext(
    section("function executorModelOverride(", "// Auto setup:") +
    section("function executorOpencodeEnv(", "// Which route an autopilot") +
    filters +
    section("// \"Try again with a heavier model\" (the retry-deep answer)", "// One spawn: pick, claim and launch"),
    env,
  );
  return { env, logs };
}
const route = (extra) => ({ modelArgs: "", env: {}, ...extra });

test("a heavier retry runs the builder's Heavy-tier model, whatever its tier and selection", async () => {
  const claude = route({ cli: "claude", claude: true, model: "sonnet", via: "claude cli · fast tier (sonnet)" });
  assert.equal(await tierHost({ executorCli: "claude", executorTier: "fast", modelSelection: "fixed" }).env.heavyRetryRoute(claude), "opus");
  assert.equal(claude.model, "opus");
  assert.match(claude.via, /claude cli · opus · heavier retry/);
  const codex = route({ cli: "codex", codex: true, model: "" });
  assert.equal(await tierHost({ executorCli: "codex", executorTierModels: { codex: { heavy: "gpt-6-pro" } } }).env.heavyRetryRoute(codex), "gpt-6-pro", "the owner's saved Heavy model");
  const agy = route({ cli: "antigravity", antigravity: true, model: "" });
  assert.equal(await tierHost({ executorCli: "antigravity", executorTierModels: { antigravity: { heavy: "Gemini 3.1 Pro (High)" } } }).env.heavyRetryRoute(agy), "Gemini 3.1 Pro (High)", "a display name passes agyModelArg");
  // OpenCode on the coding plan: the z.ai heavy model, with its provider beside the run.
  const open = route({ cli: "opencode", model: "opencode/x-free", modelArgs: " --model opencode/x-free", free: true, parallelCap: 1 });
  const { env, logs } = tierHost({ aiProvider: "auto", zaiApiKeyEncrypted: "k", executorTier: "free", executorTierModels: { opencode: { free: "opencode/x-free" } } });
  assert.equal(await env.heavyRetryRoute(open), "mefi-zai/glm-5.3");
  assert.equal(open.modelArgs, " --model mefi-zai/glm-5.3");
  assert.equal(JSON.parse(open.env.OPENCODE_CONFIG_CONTENT).snapshot, false);
  assert.equal(open.env.MEFI_ZAI_API_KEY, "fixture");
  assert.equal(open.free, false);
  assert.equal(open.parallelCap, null);
  assert.ok(logs.some((line) => line.includes("heavier retry")));
});

test("a heavier retry changes nothing where no heavier model exists", async () => {
  for (const [settings, cli] of [
    [{ executorCli: "codex" }, "codex"],
    [{ executorCli: "grok", executorTier: "fast" }, "grok"],
    [{ executorCli: "antigravity" }, "antigravity"],
    [{ executorCli: "claude", executorTier: "heavy" }, "claude"],
    [{ aiProvider: "opencode" }, "opencode"],
    [{ executorCli: "codex", executorTier: "fast", executorTierModels: { codex: { fast: "gpt-6", heavy: "gpt-6" } } }, "codex"],
  ]) {
    const runRoute = route({ cli, model: "m", via: "before" });
    assert.equal(await tierHost(settings, { zai: false }).env.heavyRetryRoute(runRoute), null, JSON.stringify(settings));
    assert.equal(runRoute.via, "before", "the route is left alone");
  }
  const managed = route({ cli: "opencode", model: "opencode/x" });
  assert.equal(await tierHost({ aiProvider: "auto", zaiApiKeyEncrypted: "k" }, { zai: false }).env.heavyRetryRoute(managed), null, "a z.ai model is never named without the key beside it");
});

test("the heavier retry is offered only where it can change the model", async () => {
  const offered = (settings, options) => tierHost(settings, options).env.heavierRetryOnOffer();
  assert.equal(await offered({ executorCli: "claude" }), true, "Claude Code's Heavy default is opus");
  assert.equal(await offered({ executorCli: "claude", executorTier: "heavy" }), false, "already on the Heavy tier");
  assert.equal(await offered({ executorCli: "codex" }), false, "no Heavy default for Codex");
  assert.equal(await offered({ executorCli: "codex", executorTierModels: { codex: { heavy: "gpt-6-pro" } } }), true);
  assert.equal(await offered({ executorCli: "grok" }), false);
  assert.equal(await offered({ executorCli: "antigravity" }), false);
  assert.equal(await offered({ aiProvider: "auto", zaiApiKeyEncrypted: "k" }), true, "OpenCode on the coding plan");
  assert.equal(await offered({ aiProvider: "opencode" }, { goLinked: true }), true, "OpenCode Go on Auto routes the deep shape");
  assert.equal(await offered({ aiProvider: "opencode", modelSelection: "fixed" }, { goLinked: true }), false, "Fixed selection keeps the default");
  assert.equal(await offered({ aiProvider: "opencode", executorModels: { opencode: "opencode/pinned" } }, { goLinked: true }), false, "a pinned builder is never re-routed");
  assert.equal(await offered({ aiProvider: "opencode" }, { goLinked: false }), false, "OpenCode's own account with no Heavy model");
});

// Codex takes Studio's tool server (as -c overrides); the desk stays with the
// two CLIs that read a config file, since Codex could carry its token only on
// a command line. Grok and Antigravity take no per-run MCP config at all.
test("the setup screen lets a Codex builder choose Studio tools, but not the desk", async () => {
  const agents = (await readFile(new URL("../renderer/agents.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const from = agents.indexOf("  function addonPanel("), to = agents.indexOf("  function agentRow(");
  assert.ok(from > 0 && to > from, "addonPanel slice");
  const made = [];
  const node = (tag, cls = "", text = "") => {
    const el = { tag, cls, text, children: [], dataset: {}, append(...items) { this.children.push(...items); }, addEventListener() {} };
    made.push(el);
    return el;
  };
  const context = vm.createContext({ node, field: (title, control, note) => ({ title, control, note }), button: (text) => ({ text }), say() {}, dirty() {}, refreshRows() {}, $: () => null, window: {} });
  vm.runInContext(`${agents.slice(from, to)}; this.addonPanel = addonPanel;`, context);
  for (const [provider, tools, desk] of [["codex", true, false], ["claude", true, true], ["opencode", true, true], ["grok", false, false], ["antigravity", false, false]]) {
    made.length = 0;
    context.addonPanel("builder", "Builder", provider, {}, { skills: [], mcpTools: [] });
    const input = (id) => made.find((el) => el.tag === "input" && el.id === id);
    assert.equal(input("agent-builder-tool-webSearch").disabled, !tools, `${provider}: Studio tools`);
    assert.equal(input("agent-builder-desk-tool").disabled, !desk, `${provider}: the desk`);
  }
});
