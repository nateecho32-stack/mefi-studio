// main.cjs's "model community feed and probes" block, sliced into a sandbox:
// the feed is fetched at most every six hours into user data (a temp folder
// here), a failed fetch keeps the last good copy, no feed is an ordinary
// state, and a probe run starts only on an enabled model, goes tool-less and
// pinned through the resolved route, records each call as probe-<kind> from
// source "probe", keeps its results in user data and stops when cancelled.
// No network, no real user data, no model.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (await readFile(path.join(root, "main.cjs"), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const requireFromMain = createRequire(path.join(root, "main.cjs"));
const authStore = requireFromMain("./scripts/auth-store.cjs");

const FEED = { schema: 1, generatedAt: "2026-09-28T18:00:00.000Z", models: [{ key: "zhipuai/glm-5.3", provider: "zhipuai", id: "glm-5.3", forumThread: "https://discord.com/channels/1/2",
  claims: [{ taskKind: "planning", polarity: "strength", tier: "observed", text: "Kept a ten-step plan consistent.", reporters: 2 }] }] };
const REPLIES = {
  planning: JSON.stringify({ steps: [{ id: 1, action: "Default tags to [] for old notes", files: ["src/store.mjs"], verify: "node --test", covers: ["R3"] }, { id: 2, action: "Add --tag", files: ["src/cli.mjs"], verify: "run notes add", covers: ["R1", "R2"] }] }),
  writing: "Studio 0.5 adds a Probes button under Models. Probes run only when you click it, each probe uses at most 1,500 output tokens, and Studio keeps the last 5 runs per model.",
  commits: "Add probes",
};

async function host({ settings = {}, fetchImpl = null, reply = null } = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), "mefi-community-host-"));
  let now = Date.UTC(2026, 8, 28, 12);
  const fetches = [], calls = [], sent = [], logs = [];
  const active = new AsyncLocalStorage();
  const answer = reply ?? (async (route, system, user, maxTokens, options) => {
    const kind = options.taskType.replace("probe-", "");
    return { ok: true, text: REPLIES[kind] ?? "", model: route.model };
  });
  const record = (cli) => async (route, system, user, maxTokens, options) => {
    calls.push({ cli, route: { ...route }, maxTokens, options: { ...options }, toolless: active.getStore() === true, system, user });
    return answer(route, system, user, maxTokens, options, env);
  };
  const env = {
    path, crypto, process, Promise, JSON, Object, Array, String, Number, Math, Set, Map,
    Date: class extends Date { static now() { return now; } },
    require: requireFromMain, readFile, authStore, app: { getPath: (name) => { assert.equal(name, "userData"); return userData; } },
    STUDIO_ROOT: root, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    loadModule: (rel) => import(pathToFileURL(path.join(root, rel)).href),
    fetch: async (url, init) => {
      fetches.push(url);
      if (fetchImpl) return fetchImpl(url, init);
      return new Response("", { status: 404 });
    },
    logLine: (line) => logs.push(line), send: (channel, payload) => sent.push({ channel, payload: JSON.parse(JSON.stringify(payload)) }),
    readSettings: async () => JSON.parse(JSON.stringify(settings)),
    decryptKey: (saved, name) => saved.keys?.[name] ?? null,
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", claude: "Claude Code CLI" },
    ZAI_MODEL_ROUTINE: "glm-5.3-flash", ZAI_MODEL_HEAVY: "glm-5.3", ASSISTANT_MODEL: "deepseek-v4.1-flash", ZEN_MODEL_ROUTINE: "gpt-6-luna", ZEN_MODEL_HEAVY: "gpt-6-sol", OPENROUTER_MODEL: "openrouter/free",
    ZAI_ENDPOINT: "https://zai.invalid/chat", ASSISTANT_ENDPOINT: "https://go.invalid/chat", OPENROUTER_ENDPOINT: "https://or.invalid/chat",
    zenEndpoint: (model) => `https://zen.invalid/${model}`, normalizeCompatEndpoint: (value) => typeof value === "string" && value ? value : null, normalizeLmStudioEndpoint: () => "http://127.0.0.1:1234/v1/chat/completions",
    DATA_ONLY_CLIS: new Set(["claude", "codex", "grok", "antigravity"]),
    claudeCliAvailable: async () => settings.cli === "claude", codexCliAvailable: () => false, grokCliAvailable: async () => false, antigravityCliAvailable: async () => { throw new Error("no agy"); },
    agentTools: { active },
    httpAssistantCall: record(false), cliAssistantCall: record(true),
  };
  vm.createContext(env);
  vm.runInContext([section("const SEAT_DEFAULTS = Object.freeze({", "// `onTool` also hears each tool turn"), section("// ---- model community feed and probes", "let speedMeasurementWrites")].join("\n"), env);
  return {
    env, fetches, calls, sent, logs, userData,
    advance: (ms) => { now += ms; },
    inflight: () => vm.runInContext("modelCommunityRefreshing", env),
    saved: async (name) => JSON.parse(await readFile(path.join(userData, name), "utf8")),
    cleanup: () => rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("no feed is an ordinary state, and routing never waits on the network", async () => {
  const h = await host();
  try {
    assert.equal(await h.env.modelCommunityForRouting(), null);
    await h.inflight();
    assert.equal(h.fetches.length, 1, "a first read starts one background fetch");
    assert.equal(h.fetches[0], "https://nateecho32-stack.github.io/mefi-studio/data/model-community.json");
    const view = await h.env.modelCommunityView({ provider: "zai", model: "glm-5.3" });
    assert.deepEqual([view.hasFeed, view.missing, view.lastError, view.match], [false, true, null, null]);
    assert.equal(await h.env.modelCommunityForRouting(), null);
    await h.inflight();
    assert.equal(h.fetches.length, 1, "no second fetch inside six hours");
    const saved = await h.saved("model-community.json");
    assert.equal(saved.missing, true);
  } finally { await h.cleanup(); }
});

test("a fetched feed lands in user data, and a failed fetch keeps the last good copy", async () => {
  let respond = () => new Response(JSON.stringify(FEED), { status: 200, headers: { etag: "\"v1\"" } });
  const h = await host({ fetchImpl: (url, init) => respond(url, init) });
  try {
    await h.env.refreshModelCommunity();
    const view = await h.env.modelCommunityView({ provider: "zai", model: "mefi-zai/glm-5.3" });
    assert.equal(view.hasFeed, true);
    assert.equal(view.match.row.key, "zhipuai/glm-5.3");
    assert.equal(view.match.row.forumThread, "https://discord.com/channels/1/2");
    const saved = await h.saved("model-community.json");
    assert.equal(saved.feed.models.length, 1);
    assert.ok(!(await readFile(path.join(root, "data", "models.json"), "utf8")).includes("model-community"), "nothing goes to the repo's data/");
    // Refresh inside a minute is a no-op; after it the ETag goes along.
    await h.env.refreshModelCommunity({ force: true });
    assert.equal(h.fetches.length, 1);
    h.advance(61_000);
    let sentTag = null;
    respond = (_url, init) => { sentTag = init.headers["if-none-match"]; return new Response("boom", { status: 503 }); };
    const after = await h.env.refreshModelCommunity({ force: true });
    assert.equal(sentTag, "\"v1\"");
    assert.match(after.lastError, /HTTP 503/);
    assert.equal(after.feed.models.length, 1, "the old copy stays");
    h.advance(61_000);
    respond = () => new Response("{\"schema\": 2, \"models\": []}", { status: 200 });
    const wrong = await h.env.refreshModelCommunity({ force: true });
    assert.match(wrong.lastError, /schema 1/);
    assert.equal(wrong.feed.models.length, 1);
    // Routing reads the saved copy after a restart.
    const again = await host({ fetchImpl: () => assert.fail("fresh enough, no fetch") });
    try {
      await rm(again.userData, { recursive: true, force: true });
      again.env.app.getPath = () => h.userData;
      assert.equal((await again.env.modelCommunityForRouting()).models[0].key, "zhipuai/glm-5.3");
    } finally { await again.cleanup(); }
  } finally { await h.cleanup(); }
});

test("a probe run refuses a model the owner has not enabled and calls nothing", async () => {
  const h = await host({ settings: { keys: { zaiApiKeyEncrypted: "zai-key" } } });
  try {
    for (const target of [{ provider: "opencode", model: "deepseek-v4.1-flash" }, { provider: "zai", model: "some-other-model" }, { provider: "claude", model: "claude-default" }, {}]) {
      const result = await h.env.runModelProbes(target);
      assert.equal(result.ok, false, JSON.stringify(target));
    }
    assert.equal(h.calls.length, 0);
    const view = await h.env.modelProbesView({});
    assert.ok(view.targets.some((item) => item.provider === "zai" && item.model === "glm-5.3"));
    assert.ok(!view.targets.some((item) => item.provider === "opencode"), "no Go key, no Go models");
  } finally { await h.cleanup(); }
});

test("an enabled model runs each probe tool-less and pinned, and its results are kept in user data", async () => {
  const h = await host({ settings: { keys: { zaiApiKeyEncrypted: "zai-key" } } });
  try {
    const result = await h.env.runModelProbes({ provider: "zai", model: "glm-5.3", kinds: ["planning", "writing", "commits", "vibes"] });
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.results), ["planning", "writing", "commits"]);
    assert.equal(result.results.writing.passed, true);
    assert.equal(result.results.commits.passed, false);
    assert.deepEqual(h.calls.map((call) => call.options.taskType), ["probe-planning", "probe-writing", "probe-commits"]);
    for (const call of h.calls) {
      assert.equal(call.cli, false);
      assert.equal(call.toolless, true, "no tools and no skills reach a probe");
      assert.equal(call.options.source, "probe");
      assert.equal(call.options.pinned, true, "the router never swaps the probed model");
      assert.deepEqual([call.route.model, call.route.endpoint, call.route.fallbacks.length], ["glm-5.3", "https://zai.invalid/chat", 0]);
      assert.ok(call.maxTokens <= 1500);
      assert.doesNotMatch(call.user + call.system, /zai-key/);
    }
    const saved = await h.saved("model-probes.json");
    assert.equal(saved.models["zai::glm-5.3"].kinds.planning.length, 1);
    const view = await h.env.modelProbesView({ provider: "zai", model: "glm-5.3" });
    assert.equal(view.runs.writing[0].passed, true);
    assert.equal(view.running, null);
    const states = h.sent.filter((event) => event.channel === "models:probe-progress").map((event) => `${event.payload.state}:${event.payload.kind ?? ""}`);
    assert.deepEqual(states, ["running:planning", "scored:planning", "running:writing", "scored:writing", "running:commits", "scored:commits", "done:"]);
  } finally { await h.cleanup(); }
});

test("cancel stops after the probe in flight, a second run is refused, and a failed call is no score", async () => {
  let h;
  const reply = async (route, system, user, maxTokens, options) => {
    if (options.taskType === "probe-planning") {
      assert.equal((await h.env.runModelProbes({ provider: "zai", model: "glm-5.3" })).ok, false, "one run at a time");
      h.env.cancelModelProbes();
      return { ok: false, error: "HTTP 500" };
    }
    return { ok: true, text: "x" };
  };
  h = await host({ settings: { keys: { zaiApiKeyEncrypted: "zai-key" } }, reply });
  try {
    const result = await h.env.runModelProbes({ provider: "zai", model: "glm-5.3", kinds: ["planning", "writing"] });
    assert.equal(result.cancelled, true);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(plain(result.results), {}, "the cancelled probe's reply is not scored");
    assert.equal(h.sent.at(-1).payload.state, "cancelled");
    const failing = await host({ settings: { keys: { zaiApiKeyEncrypted: "zai-key" } }, reply: async () => ({ ok: false, error: "HTTP 500" }) });
    try {
      const run = await failing.env.runModelProbes({ provider: "zai", model: "glm-5.3", kinds: ["writing"] });
      assert.deepEqual(plain([run.results.writing.score, run.results.writing.error]), [null, "HTTP 500"]);
    } finally { await failing.cleanup(); }
  } finally { await h.cleanup(); }
});

test("a CLI is probed data-only on its own login, with no fallback to another model", async () => {
  const h = await host({ settings: { cli: "claude" } });
  try {
    const view = await h.env.modelProbesView({});
    assert.deepEqual(plain(view.targets.map((item) => [item.provider, item.model])), [["claude", "claude-default"]]);
    const result = await h.env.runModelProbes({ provider: "claude", model: "claude-default", kinds: ["writing"] });
    assert.equal(result.ok, true);
    assert.equal(h.calls[0].cli, true);
    assert.equal(h.calls[0].options.fallback, false);
    assert.equal(h.calls[0].route.model, "", "the CLI's own default model");
    assert.equal(h.calls[0].toolless, true);
  } finally { await h.cleanup(); }
});

test("nothing in Studio starts a probe run but its IPC handler", () => {
  const uses = [...source.matchAll(/runModelProbes\(/g)].length;
  assert.equal(uses, 2, "the declaration and the models:probe-run handler");
  assert.match(source, /ipcMain\.handle\("models:probe-run", async \(_event, payload = \{\}\) => \{\n    try \{ return await runModelProbes\(payload\); \}/);
});
