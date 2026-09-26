import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tracker = require("../scripts/usage-tracker.cjs");
const { EYES_WORKER_METHODS } = require("../scripts/eyes-client.cjs");
const mainSource = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const modelLabSource = await readFile(new URL("../renderer/model-lab.js", import.meta.url), "utf8");
const idleSource = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const trackerSource = await readFile(new URL("../renderer/tracker.js", import.meta.url), "utf8");
const buildSource = await readFile(new URL("../scripts/build-booklet.mjs", import.meta.url), "utf8");
const projectsSource = await readFile(new URL("../scripts/projects.cjs", import.meta.url), "utf8");
// The builders' command lines live in the pure executor core (cliInvocation).
const executorCoreSource = await readFile(new URL("../scripts/executor-core.cjs", import.meta.url), "utf8");

const code = mainSource.slice(mainSource.indexOf("const OPENCODE_USAGE_URL"), mainSource.indexOf("async function usageTrackerLimits()"));
const accountCode = mainSource.slice(mainSource.indexOf("const ACCOUNT_READ_TIMEOUT_MS"), mainSource.indexOf("async function usageAccounts("));
assert.ok(mainSource.indexOf("async function usageAccounts(") > mainSource.indexOf("const ACCOUNT_READ_TIMEOUT_MS"), "the account readers' slice anchors are in order");
const payload = { usage: { rolling: { status: "ok", percent: 12, resetsAt: "2026-08-22T17:00:00Z" }, weekly: { status: "ok", percent: 34 }, monthly: { status: "ok", percent: 56 } } };

function fixture({ key = "test-key", fetchImpl = null } = {}) {
  const calls = [];
  const context = vm.createContext({
    Date, AbortController, setTimeout, clearTimeout,
    readSettings: async () => (key ? { apiKeyEncrypted: "encrypted" } : {}),
    decryptKey: (settings, field) => (settings?.[field] ? key : null),
    parseOpencodeUsage: tracker.parseOpencodeUsage,
    describeOpencodeStatus: tracker.describeOpencodeStatus,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    },
  });
  vm.runInContext(code, context);
  return { calls, read: context.fetchOpencodeUsage };
}
const jsonResponse = (body, status) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

// The account readers for the other providers, run against a scripted fetch.
function accountFixture(routes, extra = {}) {
  const calls = [];
  const context = vm.createContext({
    Date, AbortController, setTimeout, clearTimeout, Map, String, Number, Promise,
    describeAccountStatus: tracker.describeAccountStatus,
    parseOpenrouterKey: tracker.parseOpenrouterKey,
    parseOpenrouterCredits: tracker.parseOpenrouterCredits,
    parseGatewayCredits: tracker.parseGatewayCredits,
    parseZaiQuota: tracker.parseZaiQuota,
    parseClaudeUsage: tracker.parseClaudeUsage,
    parseCodexRateLimits: tracker.parseCodexRateLimits,
    parseCodexRollout: tracker.parseCodexRollout,
    parseGrokBilling: tracker.parseGrokBilling,
    parseAntigravityUsage: tracker.parseAntigravityUsage,
    ...extra,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const route = routes[url];
      if (!route) return jsonResponse({ error: { message: "no route" } }, 404);
      if (typeof route === "function") return route(options);
      return jsonResponse(route.body, route.status ?? 200);
    },
  });
  vm.runInContext(accountCode, context);
  return { calls, context };
}

test("no saved key is a plain state and sends no request", async () => {
  const f = fixture({ key: null });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "no-key");
  assert.equal(f.calls.length, 0);
});

test("the account read uses the saved key as a bearer token and caches the success", async () => {
  const f = fixture();
  const first = await f.read();
  assert.equal(first.ok, true);
  assert.equal(first.usage.rolling.percent, 12);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://opencode.ai/zen/go/v1/usage");
  assert.equal(f.calls[0].options.headers.authorization, "Bearer test-key");
  const cached = await f.read();
  assert.equal(cached.ok, true);
  assert.equal(f.calls.length, 1, "a fresh success is not re-fetched");
  await f.read({ maxAgeMs: 0 });
  assert.equal(f.calls.length, 2, "an expired cache re-fetches");
});

test("concurrent readers share one in-flight request", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ fetchImpl: () => gate.then(() => jsonResponse(payload, 200)) });
  const first = f.read();
  const second = f.read();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(f.calls.length, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("a rejected key keeps the explanation and never returns the credential", async () => {
  const f = fixture({ fetchImpl: () => jsonResponse({ error: { message: "Unauthorized" } }, 401) });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "auth");
  assert.match(result.error, /rejected the saved Go key/);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
});

test("a provider error that echoes the key is redacted before it reaches the renderer", async () => {
  const f = fixture({ fetchImpl: () => jsonResponse({ error: { message: "rejected test-key" } }, 500) });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "http");
  assert.match(result.error, /redacted/);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
});

test("a transport failure is reported as a network state, not a spend", async () => {
  const f = fixture({ fetchImpl: () => { throw new Error("socket closed"); } });
  const result = await f.read();
  assert.equal(result.ok, false);
  assert.equal(result.code, "network");
  assert.match(result.error, /socket closed/);
});

test("OpenRouter is read from the key endpoint; the balance is added only when the key may see it", async () => {
  const keyBody = { data: { label: "k", usage: 25.5, limit: 100, limit_remaining: 74.5, usage_daily: 1, usage_weekly: 2, usage_monthly: 3, is_free_tier: false } };
  const refused = accountFixture({
    "https://openrouter.ai/api/v1/key": { body: keyBody },
    "https://openrouter.ai/api/v1/credits": { body: { error: { message: "Only management keys can perform this operation" } }, status: 403 },
  });
  const result = await refused.context.readOpenrouterAccount("or-key");
  assert.equal(result.ok, true);
  assert.equal(result.key.usage, 25.5);
  assert.equal(result.key.limitRemaining, 74.5);
  assert.equal(result.credits, null, "an ordinary key stands on its own usage");
  assert.equal(refused.calls[0].options.headers.authorization, "Bearer or-key");
  const managed = accountFixture({
    "https://openrouter.ai/api/v1/key": { body: keyBody },
    "https://openrouter.ai/api/v1/credits": { body: { data: { total_credits: 100, total_usage: 25.5 } } },
  });
  assert.deepEqual((await managed.context.readOpenrouterAccount("or-key")).credits, { totalCredits: 100, totalUsage: 25.5, remaining: 74.5, balance: 74.5 });
  const rejected = accountFixture({ "https://openrouter.ai/api/v1/key": { body: { error: { message: "bad or-key" } }, status: 401 } });
  const failure = await rejected.context.readOpenrouterAccount("or-key");
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "auth");
  assert.doesNotMatch(JSON.stringify(failure), /or-key/);
});

test("the gateway balance is read as numbers whichever way the reply spells them", async () => {
  const f = accountFixture({ "https://ai-gateway.vercel.sh/v1/credits": { body: { balance: "95.50", total_used: "4.50" } } });
  const result = await f.context.readGatewayAccount("gw-key");
  assert.equal(result.ok, true);
  assert.deepEqual(result.credits, { balance: 95.5, totalUsed: 4.5 });
  assert.equal(f.calls[0].options.headers.authorization, "Bearer gw-key");
  const odd = accountFixture({ "https://ai-gateway.vercel.sh/v1/credits": { body: { hello: 1 } } });
  const shape = await odd.context.readGatewayAccount("gw-key");
  assert.equal(shape.ok, false);
  assert.equal(shape.code, "shape");
});

test("z.ai's quota is read the way its own plugin reads it and refused when the shape changes", async () => {
  const f = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": { body: { data: { level: "pro", limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 40, nextResetTime: 1789999999000 }] } } } });
  const result = await f.context.readZaiAccount("zai-key");
  assert.equal(result.ok, true);
  assert.equal(result.quota.rolling.percent, 40);
  assert.equal(f.calls[0].options.headers.authorization, "zai-key", "the raw key, no bearer prefix");
  assert.equal(f.calls[0].options.headers["accept-language"], "en-US,en");
  const changed = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": { body: { data: { something: "else" } } } });
  const shape = await changed.context.readZaiAccount("zai-key");
  assert.equal(shape.ok, false);
  assert.equal(shape.code, "shape");
  assert.match(shape.error, /no limits/);
  // a refused key arrives as HTTP 200 with an envelope; the reader reports it as an auth failure
  const refused = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": { body: { code: 401, msg: "token expired or incorrect", success: false } } });
  const auth = await refused.context.readZaiAccount("zai-key");
  assert.equal(auth.ok, false);
  assert.equal(auth.code, "auth");
  assert.match(auth.error, /z\.ai rejected the saved key \(401\)/);
  const down = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": () => { throw new Error("dns failed for zai-key"); } });
  const network = await down.context.readZaiAccount("zai-key");
  assert.equal(network.code, "network");
  assert.doesNotMatch(JSON.stringify(network), /zai-key/);
});

test("each account reading is cached and concurrent readers share one request", async () => {
  let reads = 0;
  const f = accountFixture({ "https://ai-gateway.vercel.sh/v1/credits": () => { reads += 1; return jsonResponse({ balance: 5, total_used: 1 }, 200); } });
  const { cachedAccountRead, readGatewayAccount } = f.context;
  const [a, b] = await Promise.all([cachedAccountRead("gateway", () => readGatewayAccount("k")), cachedAccountRead("gateway", () => readGatewayAccount("k"))]);
  assert.equal(reads, 1);
  assert.equal(a.ok, true);
  assert.equal(b.credits.balance, 5);
  assert.ok(a.at > 0, "the reading is stamped");
  await cachedAccountRead("gateway", () => readGatewayAccount("k"));
  assert.equal(reads, 1, "a fresh success is not re-fetched");
  await cachedAccountRead("gateway", () => readGatewayAccount("k"), { maxAgeMs: 0 });
  assert.equal(reads, 2, "an expired reading re-fetches");
  const thrown = await cachedAccountRead("broken", async () => { throw new Error("no way"); });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.code, "network");
});

test("the bridge, the IPC handlers and the bundle all carry the tracker", () => {
  assert.match(preloadSource, /usageTracker: \(\) => ipcRenderer\.invoke\("usage:tracker"/);
  assert.match(preloadSource, /opencodeCredits: \(\) => ipcRenderer\.invoke\("opencode:credits"/);
  assert.match(preloadSource, /usageAccounts: \(options = \{\}\) => ipcRenderer\.invoke\("usage:accounts", \{ probe: options\?\.probe === true \}\)/, "the renderer says when someone is looking, and nothing else crosses");
  assert.match(mainSource, /usageAccounts\(\{ probe: options\?\.probe === true \}\)/);
  assert.match(mainSource, /const APP_WIDE_CHANNELS = new Set\(\["usage:accounts", "opencode:credits"/, "account readings never hold up a project switch");
  assert.match(mainSource, /require\("\.\/scripts\/usage-tracker\.cjs"\)/);
  assert.match(mainSource, /ipcMain\.handle\("usage:tracker"/);
  assert.match(mainSource, /ipcMain\.handle\("opencode:credits"/);
  assert.match(mainSource, /ipcMain\.handle\("usage:accounts"/);
  assert.match(mainSource, /modelPerformanceStore\(\)\.read\(\)/);
  assert.match(mainSource, /mergeLedgers\(\{ studio: state\.observations, store: store\.rows \}\)/, "both ledgers feed one report");
  assert.match(mainSource, /eyes\.usageLedger\(\{ since: now - USAGE_LEDGER_DAYS \* 86400000, now \}\)/, "coding sessions come from the store reader");
  assert.match(buildSource, /readFile\(path\.join\(RENDERER, "tracker\.js"\), "utf8"\)/);
  assert.match(buildSource, /modelLab, tracker, nodeStyles, tree/);
});

test("the store read is a worker method and the project facade scopes it", () => {
  assert.ok(EYES_WORKER_METHODS.includes("usageLedger"), "the usage ledger never runs on the main thread");
  assert.match(projectsSource, /scoped\.usageLedger = async \(options = \{\}\) => \{\s*const result = await eyes\.usageLedger\(\{ \.\.\.options, root: project\.path \}\)/);
});

test("every route that can report usage does: CLI JSON replies and Jev charges reach the ledger", () => {
  assert.match(mainSource, /claude -p --output-format json --tools= --permission-mode dontAsk --no-session-persistence/, "the Claude assistant route prints its usage");
  assert.match(mainSource, /\["--prompt-file", tmp, "--output-format", "json", "--permission-mode", "dontAsk"\]/, "the Grok assistant route prints its usage");
  assert.match(mainSource, /args\.push\("--output-format", "json", "-p"\)/, "the Antigravity assistant route prints its usage");
  assert.match(mainSource, /resolve\(cliReply\("claude", parseClaudeCliResult\(text\), text/);
  assert.match(mainSource, /resolve\(cliReply\("grok", parseGrokCliResult\(text\), text/);
  assert.match(mainSource, /resolve\(cliReply\("antigravity", parseAntigravityCliResult\(text\), text/);
  assert.match(mainSource, /codex exec --json --ephemeral --skip-git-repo-check --color never -s read-only/, "the Codex assistant route prints its usage as JSONL, read-only");
  assert.match(mainSource, /resolve\(cliReply\("codex", parseCodexCliResult\(text\), text/);
  assert.match(mainSource, /tokenUsage: cli\.tokenUsage \?\? \{\}, costUsd: cli\.costUsd \?\? null/, "the CLI observation records what the reply reported");
  assert.match(mainSource, /async function chargeJevCall\(result, purpose, route = null\)/);
  const charge = mainSource.slice(mainSource.indexOf("async function chargeJevCall"), mainSource.indexOf("async function runJevIntake"));
  assert.match(charge, /recordModelCall\(\{ id: crypto\.randomUUID\(\), model: result\.model \?\? "jev", provider: JEV_ROUTE_PROVIDERS\[route\] \?\? "jev"/);
  assert.match(charge, /costUsd: null/, "no Jev route prices a call in its reply");
  assert.match(mainSource, /chargeJevCall\(result, "jev-shadow-intake", route\)/);
  assert.match(mainSource, /chargeJevCall\(result, "jev-connection-check", route\)/);
  assert.match(mainSource, /chargeJevCall\(result, "jev-model-routing", jevRoute\)/);
  // The builders keep their text protocol: their sentinel parsing reads plain stdout.
  assert.match(executorCoreSource, /claude -p --output-format text --dangerously-skip-permissions/);
  assert.match(executorCoreSource, /codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --color never/);
});

test("both surfaces exist in the template and are driven by the tracker module", () => {
  for (const id of ["model-lab-tab-tracker", "model-lab-tracker", "model-lab-tracker-body", "model-lab-tracker-refresh", "cmd-usage-pop", "cmd-usage-body", "cmd-usage-toggle", "cmd-usage-brief", "cmd-usage-dot", "cmd-usage-refresh", "cmd-usage-open"]) {
    assert.match(template, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(template, /aria-label="Usage across connected providers"/);
  assert.match(trackerSource, /window\.MefiUsageTracker = \{ refresh, tick, open, openTab, init(?:, [^}]*)? \}/);
  assert.match(trackerSource, /bridge\.usageTracker\(\)/);
  assert.match(trackerSource, /bridge\.opencodeCredits/);
  assert.match(trackerSource, /bridge\.usageAccounts/);
  assert.match(modelLabSource, /\["rankings", "usage", "context", "tracker", "compare"\]/);
  assert.match(modelLabSource, /window\.MefiUsageTracker\?\.refresh\?\.\(\)/);
  assert.match(idleSource, /window\.MefiUsageTracker\?\.open\?\.\(\)/);
  assert.match(idleSource, /MefiUsageTracker\?\.tick\?\.\(\)/);
});

test("z.ai's credit-plan reply reaches the panel as windows with their credit counts", async () => {
  const body = { code: 200, msg: "Operation successful", success: true, data: { level: "lite", limits: [
    { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 402, remaining: 1597, percentage: 20, nextResetTime: Date.now() + 3600000 },
    { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 5207, remaining: 4792, percentage: 52, nextResetTime: Date.now() + 86400000 },
  ] } };
  const f = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": { body } });
  const result = await f.context.readZaiAccount("zai-key");
  assert.equal(result.ok, true);
  assert.equal(result.quota.plan, "credits");
  assert.equal(result.quota.rolling.percent, 20.1);
  assert.equal(result.quota.rolling.limit, 2000);
  assert.equal(result.quota.weekly.percent, 52.1);
  const team = accountFixture({ "https://api.z.ai/api/monitor/usage/quota/limit": { body: { code: 200, success: true, data: { limits: [], level: "pro" } } } });
  const empty = await team.context.readZaiAccount("zai-key");
  assert.equal(empty.ok, true, "a key with no plan windows is read, not failed");
  assert.equal(empty.quota.empty, true);
});

// ---- the CLI plan probes, against a scripted child process -----------------
// A fake child speaks the probe's protocol: every line the host writes is
// recorded, and `script` answers it. Nothing real is spawned.
function fakeChild(script) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.written = [];
  child.ended = false;
  child.reply = (message) => child.stdout.emit("data", `${JSON.stringify(message)}\n`);
  child.exit = (code = 0) => {
    child.exitCode = code;
    child.emit("close", code);
  };
  child.stdin = {
    write(line) {
      const message = JSON.parse(line);
      child.written.push(message);
      queueMicrotask(() => script?.(message, child));
    },
    end() { child.ended = true; },
    on() {},
  };
  return child;
}
// Values made inside the vm carry its realm's prototypes; compare their data.
const plain = (value) => JSON.parse(JSON.stringify(value));
function probeFixture(script, { platform = "win32" } = {}) {
  const spawned = [];
  const children = [];
  const spawn = (command, args, options) => {
    spawned.push({ command, args, options });
    if (command === "taskkill") return { on() {} };
    const child = fakeChild(script);
    children.push(child);
    return child;
  };
  const f = accountFixture({}, { spawn, path, Buffer, os: { tmpdir: () => "C:/tmp", homedir: () => "C:/home" }, process: { platform, env: {} }, JSON, Set, queueMicrotask });
  return { ...f, spawned, children };
}
const claudeBody = { subscription_type: "max", rate_limits_available: true, rate_limits: { limits: [
  { kind: "session", group: "session", percent: 88, resets_at: new Date(Date.now() + 3600000).toISOString(), severity: "warning" },
  { kind: "weekly_all", group: "weekly", percent: 24, resets_at: new Date(Date.now() + 5 * 86400000).toISOString(), severity: "normal" },
] }, session: { cwd: "C:/private/path" } };

test("Claude Code is asked for get_usage on its stream-json channel and never for a model turn", async () => {
  const f = probeFixture((message, child) => {
    if (message.type === "control_request") child.reply({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response: claudeBody } });
  });
  const result = await f.context.probeClaudeUsage();
  assert.equal(result.ok, true);
  assert.equal(result.limits.plan, "max");
  assert.deepEqual(result.limits.windows.map((window) => [window.short, window.percent]), [["5h", 88], ["Wk", 24]]);
  assert.ok(result.limits.asOf > 0);
  assert.equal(f.spawned[0].command, "cmd.exe");
  assert.deepEqual(plain(f.spawned[0].args), ["/d", "/s", "/c", "claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --strict-mcp-config --tools= --permission-mode dontAsk"]);
  assert.equal(f.spawned[0].options.cwd, "C:/tmp", "the probe runs outside the project");
  assert.deepEqual(plain(f.children[0].written), [{ type: "control_request", request_id: "mefi-usage", request: { subtype: "get_usage", skip_behaviors: true } }], "one control request and nothing else - no prompt");
  assert.equal(f.children[0].ended, true, "the CLI is asked to leave once it answered");
  assert.doesNotMatch(JSON.stringify(result), /private/, "nothing but the limits is kept");
  // an error control response is named
  const refused = probeFixture((message, child) => child.reply({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error: "get_usage is not supported in this context" } }));
  const failure = await refused.context.probeClaudeUsage();
  assert.equal(failure.ok, false);
  assert.equal(failure.code, "unavailable");
  assert.match(failure.error, /Claude Code could not report usage: get_usage is not supported/);
});

test("Codex is asked through app-server's rate-limit read after the initialize handshake", async () => {
  const live = { ordinaryUsageAllowed: false, rateLimits: { limitId: "codex", planType: "pro", primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: Math.round(Date.now() / 1000) + 86400 }, secondary: null } };
  const f = probeFixture((message, child) => {
    if (message.id === 1) {
      child.reply({ method: "remoteControl/status/changed", params: {} });
      child.reply({ id: 1, result: { userAgent: "codex" } });
    } else if (message.id === 2) child.reply({ id: 2, result: live });
  });
  const result = await f.context.probeCodexLimits();
  assert.equal(result.ok, true);
  assert.equal(result.limits.blocked, true);
  assert.deepEqual(result.limits.windows.map((window) => [window.short, window.percent]), [["Wk", 100]]);
  assert.deepEqual(plain(f.spawned[0].args), ["/d", "/s", "/c", "codex app-server"]);
  assert.deepEqual(f.children[0].written.map((message) => message.method), ["initialize", "initialized", "account/rateLimits/read"]);
  assert.deepEqual(plain(f.children[0].written[2].params), { excludeResetCreditDetails: true }, "reset credits are never touched");
  const unsigned = probeFixture((message, child) => {
    if (message.id === 1) child.reply({ id: 1, result: {} });
    else if (message.id === 2) child.reply({ id: 2, error: { code: -32600, message: "chatgpt authentication required to read rate limits" } });
  });
  const failure = await unsigned.context.probeCodexLimits();
  assert.equal(failure.code, "auth");
  assert.match(failure.error, /needs a ChatGPT login/);
});

test("Grok is asked for billing over ACP and its lingering process tree is ended once it answered", async () => {
  const f = probeFixture((message, child) => {
    if (message.id === 0) {
      child.reply({ jsonrpc: "2.0", id: 0, result: { protocolVersion: 1 } });
      child.reply({ jsonrpc: "2.0", method: "_x.ai/mcp/servers_updated", params: {} });
    } else if (message.id === 1) child.reply({ jsonrpc: "2.0", id: 1, result: { config: { creditUsagePercent: 42, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: new Date(Date.now() + 86400000).toISOString() } } } });
  });
  const result = await f.context.probeGrokBilling();
  assert.equal(result.ok, true);
  assert.deepEqual(result.limits.windows.map((window) => [window.label, window.percent]), [["Weekly credits", 42]]);
  assert.equal(f.spawned[0].command, "grok", "spawned without a shell so Windows finds xAI's grok.exe");
  assert.deepEqual(plain(f.spawned[0].args), ["agent", "stdio"]);
  assert.deepEqual(f.children[0].written.map((message) => message.method), ["initialize", "_x.ai/billing"]);
  assert.deepEqual(plain(f.spawned.at(-1)), { command: "taskkill", args: ["/pid", "4242", "/t", "/f"], options: { windowsHide: true, stdio: "ignore" } }, "grok does not exit on end of input, so its tree is ended");
  const unsigned = probeFixture((message, child) => {
    if (message.id === 0) child.reply({ jsonrpc: "2.0", id: 0, result: {} });
    else child.reply({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error", data: "Billing data requires auth with grok.com" } });
  });
  assert.equal((await unsigned.context.probeGrokBilling()).code, "auth");
});

test("a CLI that never answers is timed out and its tree ended; one that exits early is named", async () => {
  const silent = probeFixture(() => {});
  const timeout = await silent.context.cliExchange({ label: "Silent CLI", command: "silent", start: (send) => send({ id: 1 }), onLine: () => {}, timeoutMs: 20 });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, "timeout");
  assert.match(timeout.error, /Silent CLI did not report usage/);
  assert.equal(silent.spawned.at(-1).command, "taskkill");
  const quitter = probeFixture((message, child) => child.exit(1));
  const early = await quitter.context.probeCodexLimits();
  assert.equal(early.code, "unavailable");
  assert.match(early.error, /Codex exited \(1\) without reporting usage/);
  const elsewhere = probeFixture(() => {}, { platform: "linux" });
  let killed = false;
  const result = elsewhere.context.cliExchange({ label: "Quiet", command: "quiet", start: () => {}, onLine: () => {}, timeoutMs: 20 });
  elsewhere.children[0].kill = () => { killed = true; };
  await result;
  assert.equal(killed, true, "off Windows the child itself is killed");
});

test("CLI plan readings are cached, refreshed in the background, single-flight, and never started without a look", async () => {
  const f = probeFixture(() => {});
  const { cliPlanReading } = f.context;
  let runs = 0;
  let release;
  const run = () => { runs += 1; return new Promise((resolve) => { release = () => resolve({ ok: true, limits: { windows: [] } }); }); };
  const idle = cliPlanReading("claude", run, { allow: false });
  assert.deepEqual(plain(idle), { result: null, refreshing: false });
  assert.equal(runs, 0, "no look, no probe");
  const first = cliPlanReading("claude", run, { allow: true });
  assert.equal(first.refreshing, true);
  assert.equal(first.result, null, "the caller is answered at once, not after the probe");
  await Promise.resolve();
  assert.equal(cliPlanReading("claude", run, { allow: true }).refreshing, true);
  assert.equal(runs, 1, "one probe per CLI in flight");
  release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = cliPlanReading("claude", run, { allow: true });
  assert.equal(fresh.result.ok, true);
  assert.equal(fresh.refreshing, false);
  assert.equal(runs, 1, "a fresh reading is not re-probed");
  // no more than two probes run at once; the third waits its turn
  const gates = [];
  const slow = (id) => () => { runs += 1; return new Promise((resolve) => gates.push(() => resolve({ ok: false, code: "unavailable", error: `${id} failed` }))); };
  const before = runs;
  cliPlanReading("codex", slow("codex"), { allow: true });
  cliPlanReading("grok", slow("grok"), { allow: true });
  cliPlanReading("antigravity", slow("antigravity"), { allow: true });
  await Promise.resolve();
  assert.equal(runs - before, 2, "concurrency is capped at two");
  gates.shift()();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs - before, 3, "the queued probe starts when a slot frees");
  gates.forEach((open) => open());
  await new Promise((resolve) => setTimeout(resolve, 5));
  const failed = cliPlanReading("codex", slow("codex"), { allow: true });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.refreshing, false, "a failure is kept for a minute before it is tried again");
});

test("Codex rollouts stand in with the newest snapshot of the last eight days, read from their tails", async () => {
  const now = new Date(2026, 8, 22, 20, 0).getTime();
  const root = "C:/home/.codex";
  const dayDir = (daysBack) => {
    const day = new Date(2026, 8, 22 - daysBack);
    return path.join(root, "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
  };
  const line = (timestamp, percent, limitId = "codex") => JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: { limit_id: limitId, primary: limitId === "codex" ? { used_percent: percent, window_minutes: 10080, resets_at: Math.round(now / 1000) + 86400 } : null, secondary: null, plan_type: "pro" } } });
  const files = {
    [path.join(dayDir(2), "rollout-2026-09-20T04-00-00-a.jsonl")]: { mtimeMs: now, text: `${line("2026-09-20T04:00:00Z", 93)}\n${line("2026-09-20T04:05:00Z", 100)}\n${line("2026-09-20T04:05:01Z", 0, "premium")}\n` },
    [path.join(dayDir(0), "rollout-2026-09-22T09-00-00-b.jsonl")]: { mtimeMs: now - 3600000, text: `${line("2026-09-19T09:00:00Z", 12)}\n` },
    [path.join(dayDir(9), "rollout-2026-09-13T09-00-00-c.jsonl")]: { mtimeMs: now + 1, text: `${line("2026-09-22T19:00:00Z", 1)}\n` },
  };
  const reads = [];
  const fsApi = {
    readdir: async (dir) => {
      const names = Object.keys(files).filter((file) => path.dirname(file) === dir).map((file) => path.basename(file));
      if (!names.length) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return [...names, "notes.txt"];
    },
    stat: async (file) => ({ size: Buffer.byteLength(files[file].text), mtimeMs: files[file].mtimeMs }),
    readRange: async (file, start, length) => { reads.push({ file, start, length }); return Buffer.from(files[file].text).subarray(start, start + length).toString("utf8"); },
  };
  const f = probeFixture(() => {});
  const result = await f.context.readCodexRollouts({ now, fsApi, root });
  assert.equal(result.ok, true);
  assert.equal(result.limits.source, "rollout");
  assert.equal(result.limits.asOf, Date.parse("2026-09-20T04:05:00Z"), "decided by event time, not the rewritten file's mtime; the premium lane is skipped");
  assert.equal(result.limits.windows[0].percent, 100);
  assert.equal(result.limits.plan, "pro");
  assert.ok(reads.every((read) => !read.file.includes("2026-09-13")), "a rollout older than eight days is never opened");
  const again = reads.length;
  await f.context.readCodexRollouts({ now, fsApi, root });
  assert.equal(reads.length, again, "an unchanged rollout is not read twice");
  const none = await f.context.readCodexRollouts({ now, fsApi: { ...fsApi, readdir: async () => { throw new Error("ENOENT"); } }, root });
  assert.equal(none.ok, false);
  assert.match(none.error, /No Codex session in the last 8 days/);
});

test("only a Zen reply's own cost is recorded as a price", () => {
  assert.match(mainSource, /const zenCost = provider === "zen" && payload\.cost !== null/, "Go replies carry cost \"0\" for a plan and are never priced from it");
  assert.match(mainSource, /if \(observed\.costUsd === null && Number\.isFinite\(zenCost\) && zenCost >= 0\) observed\.costUsd = zenCost;/);
  assert.match(mainSource, /model: payload\.model,\r?\n    cost: payload\.cost,/, "the Responses reply keeps Zen's cost on its way back");
});
