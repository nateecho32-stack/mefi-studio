import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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

const code = mainSource.slice(mainSource.indexOf("const OPENCODE_USAGE_URL"), mainSource.indexOf("async function usageTrackerLimits()"));
const accountCode = mainSource.slice(mainSource.indexOf("const ACCOUNT_READ_TIMEOUT_MS"), mainSource.indexOf("async function usageAccounts()"));
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
function accountFixture(routes) {
  const calls = [];
  const context = vm.createContext({
    Date, AbortController, setTimeout, clearTimeout, Map, String, Number, Promise,
    describeAccountStatus: tracker.describeAccountStatus,
    parseOpenrouterKey: tracker.parseOpenrouterKey,
    parseOpenrouterCredits: tracker.parseOpenrouterCredits,
    parseGatewayCredits: tracker.parseGatewayCredits,
    parseZaiQuota: tracker.parseZaiQuota,
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
  assert.deepEqual((await managed.context.readOpenrouterAccount("or-key")).credits, { totalCredits: 100, totalUsage: 25.5, remaining: 74.5 });
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
  assert.match(shape.error, /no limits/);
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
  assert.match(preloadSource, /usageAccounts: \(\) => ipcRenderer\.invoke\("usage:accounts"/);
  assert.match(mainSource, /require\("\.\/scripts\/usage-tracker\.cjs"\)/);
  assert.match(mainSource, /ipcMain\.handle\("usage:tracker"/);
  assert.match(mainSource, /ipcMain\.handle\("opencode:credits"/);
  assert.match(mainSource, /ipcMain\.handle\("usage:accounts"/);
  assert.match(mainSource, /modelPerformanceStore\(\)\.read\(\)/);
  assert.match(mainSource, /mergeLedgers\(\{ studio: state\.observations, store: store\.rows \}\)/, "both ledgers feed one report");
  assert.match(mainSource, /eyes\.usageLedger\(\{ since: now - USAGE_LEDGER_DAYS \* 86400000, now \}\)/, "coding sessions come from the store reader");
  assert.match(buildSource, /readFile\(path\.join\(RENDERER, "tracker\.js"\), "utf8"\)/);
  assert.match(buildSource, /modelLab, tracker, tree/);
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
  assert.match(mainSource, /tokenUsage: cli\.tokenUsage \?\? \{\}, costUsd: cli\.costUsd \?\? null/, "the CLI observation records what the reply reported");
  assert.match(mainSource, /async function chargeJevCall\(result, purpose, route = null\)/);
  const charge = mainSource.slice(mainSource.indexOf("async function chargeJevCall"), mainSource.indexOf("async function runJevIntake"));
  assert.match(charge, /recordModelCall\(\{ id: crypto\.randomUUID\(\), model: result\.model \?\? "jev", provider: JEV_ROUTE_PROVIDERS\[route\] \?\? "jev"/);
  assert.match(charge, /costUsd: null/, "no Jev route prices a call in its reply");
  assert.match(mainSource, /chargeJevCall\(result, "jev-shadow-intake", route\)/);
  assert.match(mainSource, /chargeJevCall\(result, "jev-connection-check", route\)/);
  assert.match(mainSource, /chargeJevCall\(result, "jev-model-routing", jevRoute\)/);
  // The builders keep their text protocol: their sentinel parsing reads plain stdout.
  assert.match(mainSource, /claude -p --output-format text --dangerously-skip-permissions/);
});

test("both surfaces exist in the template and are driven by the tracker module", () => {
  for (const id of ["model-lab-tab-tracker", "model-lab-tracker", "model-lab-tracker-body", "model-lab-tracker-refresh", "cmd-usage", "cmd-usage-body", "cmd-usage-toggle", "cmd-usage-refresh", "cmd-usage-open"]) {
    assert.match(template, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(template, /aria-label="Usage across connected providers"/);
  assert.match(trackerSource, /window\.MefiUsageTracker = \{ refresh, tick, open, openTab, init \}/);
  assert.match(trackerSource, /bridge\.usageTracker\(\)/);
  assert.match(trackerSource, /bridge\.opencodeCredits/);
  assert.match(trackerSource, /bridge\.usageAccounts/);
  assert.match(modelLabSource, /\["rankings", "usage", "context", "tracker", "compare"\]/);
  assert.match(modelLabSource, /window\.MefiUsageTracker\?\.refresh\?\.\(\)/);
  assert.match(idleSource, /window\.MefiUsageTracker\?\.open\?\.\(\)/);
  assert.match(idleSource, /MefiUsageTracker\?\.tick\?\.\(\)/);
});
