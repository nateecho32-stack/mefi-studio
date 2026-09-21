import test from "node:test";
import assert from "node:assert/strict";
import {
  stripAnsi, parseVersion, parseAuthList, parseModelList, parseVerboseModels, parseAgentList, normalizeModelRecord,
  classifyModel, rankFreeModels, planFirstRun, runFirstScan, spawnExec, commandLine, providerIdOf, SCAN_COMMANDS, FREE_TIER_NOTES,
} from "../scripts/first-scan.mjs";

// Fixtures are the real `opencode` 1.18.31 output captured on 2026-09-21,
// escape codes and box glyphs included. Only provider names and variable
// names appear — the credential store itself is never read.
const ESC = "\u001b";
const AUTH_LIST = [
  `${ESC}[0m\r`,
  `${ESC}[90m┌${ESC}[39m  Credentials ${ESC}[90m~\\.local\\share\\opencode\\auth.json`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[34m●${ESC}[39m  OpenCode Go ${ESC}[90mapi`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[90m└${ESC}[39m  1 credentials`,
  "",
  `${ESC}[90m┌${ESC}[39m  Environment`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[34m●${ESC}[39m  OpenCode Zen ${ESC}[90mOPENCODE_API_KEY`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[34m●${ESC}[39m  OpenRouter ${ESC}[90mOPENROUTER_API_KEY`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[34m●${ESC}[39m  OpenCode Go ${ESC}[90mOPENCODE_API_KEY`,
  `${ESC}[90m│${ESC}[39m`,
  `${ESC}[90m└${ESC}[39m  3 environment variables`,
  "",
].join("\n");

const MODELS = ["opencode/big-pickle", "opencode/claude-sonnet-5", "opencode/nemotron-3.5-lightning-free", "opencode-go/glm-5.3-flash", "openrouter/openai/gpt-5.4-mini", "opencode/big-pickle", "not a model line"].join("\n");

const AGENTS = [
  "build (primary)", "  [", "  {", '    "permission": "*",', '    "action": "allow",', '    "pattern": "*"', "  }", "  ]",
  "compaction (primary)", "  []", "explore (subagent)", "  []", "general (subagent)", "  []", "plan (primary)", "  []", "summary (primary)", "title (primary)",
].join("\n");

const record = (id, extra = {}) => JSON.stringify({
  id: id.split("/")[1], providerID: id.split("/")[0], name: extra.name ?? id, status: extra.status ?? "active",
  cost: extra.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: extra.limit ?? { context: 262144, output: 32768 },
  capabilities: { temperature: true, reasoning: true, attachment: false, toolcall: extra.toolcall ?? true, input: { text: true, image: extra.image ?? false }, output: { text: true } },
  release_date: extra.release_date ?? "2026-08-11", variants: {},
}, null, 2);

const VERBOSE = [
  "opencode/big-pickle", record("opencode/big-pickle", { name: "Big Pickle", release_date: "2025-10-17", limit: { context: 200000, output: 32000 } }),
  "opencode/gpt-5.4-mini", record("opencode/gpt-5.4-mini", { name: "GPT-5.4 Mini", cost: { input: 0.25, output: 2 } }),
  "opencode/nemotron-3.5-lightning-free", record("opencode/nemotron-3.5-lightning-free", { name: "Nemotron 3.5 Lightning Free", release_date: "2026-08-11", limit: { context: 262144, output: 262144 } }),
  "opencode/muse-spark-1.3-contributor-free", record("opencode/muse-spark-1.3-contributor-free", { name: "Muse Spark 1.3 Free", release_date: "2026-09-02", limit: { context: 1048576, output: 131072 }, image: true }),
  "opencode/ling-3.0-tiny-free", record("opencode/ling-3.0-tiny-free", { name: "Ling-3.0-tiny Free", status: "deprecated", release_date: "2026-08-06" }),
  "opencode/ling-2.6-flash-free", record("opencode/ling-2.6-flash-free", { name: "Ling 2.6 Flash Free", toolcall: false, release_date: "2026-04-21" }),
  "opencode/broken-free", "{ this is not json",
].join("\n");

test("stripAnsi removes colour codes and keeps box glyphs and text", () => {
  assert.equal(stripAnsi(`${ESC}[34m●${ESC}[39m  OpenCode Go ${ESC}[90mapi`), "●  OpenCode Go api");
  assert.equal(stripAnsi(undefined), "");
});

test("parseVersion reads the semver triple out of any banner", () => {
  assert.deepEqual(parseVersion("1.18.31\n"), { version: "1.18.31", major: 1, minor: 18, patch: 31 });
  assert.deepEqual(parseVersion(`${ESC}[1mopencode v0.9.2${ESC}[0m`), { version: "0.9.2", major: 0, minor: 9, patch: 2 });
  assert.equal(parseVersion("no version here"), null);
});

test("parseAuthList separates the credential store from environment variables and dedupes providers", () => {
  const auth = parseAuthList(AUTH_LIST);
  assert.equal(auth.credentialsPath, "~\\.local\\share\\opencode\\auth.json");
  assert.deepEqual(auth.credentials, [{ provider: "opencode-go", name: "OpenCode Go", kind: "api", source: "credentials" }]);
  assert.deepEqual(auth.environment.map((item) => [item.provider, item.variable]), [["opencode", "OPENCODE_API_KEY"], ["openrouter", "OPENROUTER_API_KEY"], ["opencode-go", "OPENCODE_API_KEY"]]);
  assert.deepEqual(auth.providers, ["opencode-go", "opencode", "openrouter"]);
  assert.deepEqual(auth.counts, { credentials: 1, environment: 3 });
});

test("parseAuthList tolerates an empty store, unknown providers and missing sections", () => {
  const empty = parseAuthList("┌  Credentials ~/.local/share/opencode/auth.json\n│\n└  0 credentials\n");
  assert.deepEqual(empty.providers, []);
  assert.equal(empty.counts.credentials, 0);
  const odd = parseAuthList("┌  Credentials /tmp/auth.json\n●  Some Future Vendor oauth\n●  SoloName\n└  2 credentials");
  assert.deepEqual(odd.credentials.map((item) => [item.provider, item.kind]), [["some-future-vendor", "oauth"], ["soloname", null]]);
  assert.deepEqual(parseAuthList(""), { credentialsPath: null, credentials: [], environment: [], providers: [], counts: { credentials: null, environment: null } });
  assert.equal(providerIdOf("GitHub Copilot"), "github-copilot");
  assert.equal(providerIdOf("  "), null);
});

test("parseModelList keeps provider/model ids only, once each, and parseAgentList reads name and mode", () => {
  const models = parseModelList(MODELS);
  assert.deepEqual(models.map((item) => item.id), ["opencode/big-pickle", "opencode/claude-sonnet-5", "opencode/nemotron-3.5-lightning-free", "opencode-go/glm-5.3-flash", "openrouter/openai/gpt-5.4-mini"]);
  assert.deepEqual(models[3], { id: "opencode-go/glm-5.3-flash", provider: "opencode-go", model: "glm-5.3-flash" });
  assert.deepEqual(parseAgentList(AGENTS), [
    { name: "build", mode: "primary" }, { name: "compaction", mode: "primary" }, { name: "explore", mode: "subagent" },
    { name: "general", mode: "subagent" }, { name: "plan", mode: "primary" }, { name: "summary", mode: "primary" }, { name: "title", mode: "primary" },
  ]);
});

test("parseVerboseModels pairs each id with its JSON record and survives a broken block", () => {
  const models = parseVerboseModels(VERBOSE);
  assert.equal(models.length, 7);
  const nemotron = models.find((item) => item.model === "nemotron-3.5-lightning-free");
  assert.equal(nemotron.parsed, true);
  assert.equal(nemotron.provider, "opencode");
  assert.equal(nemotron.tools, true);
  assert.deepEqual(nemotron.limit, { context: 262144, output: 262144 });
  assert.deepEqual(nemotron.inputModalities, ["text"]);
  assert.equal(nemotron.releaseDate, "2026-08-11");
  const broken = models.find((item) => item.model === "broken-free");
  assert.equal(broken.parsed, false);
  assert.equal(broken.tools, null);
  assert.equal(broken.cost.input, null);
  assert.equal(normalizeModelRecord("opencode/x", { release_date: "soon" }).releaseDate, null);
});

test("classifyModel: zero cost or a -free suffix is free; deprecated and tool-less models are not usable", () => {
  const models = parseVerboseModels(VERBOSE);
  const by = (model) => classifyModel(models.find((item) => item.model === model));
  assert.deepEqual(by("nemotron-3.5-lightning-free"), { free: true, kind: "free", deprecated: false, trainsOnData: true, usable: true });
  assert.deepEqual(by("muse-spark-1.3-contributor-free"), { free: true, kind: "contributor", deprecated: false, trainsOnData: true, usable: true });
  assert.deepEqual(by("big-pickle"), { free: true, kind: "stealth", deprecated: false, trainsOnData: true, usable: true });
  assert.deepEqual(by("gpt-5.4-mini"), { free: false, kind: null, deprecated: false, trainsOnData: null, usable: false });
  assert.equal(by("ling-3.0-tiny-free").usable, false);
  assert.equal(by("ling-3.0-tiny-free").deprecated, true);
  assert.equal(by("ling-2.6-flash-free").usable, false);
  // A bare id from the plain list still counts as free by name, tools unknown.
  assert.deepEqual(classifyModel(normalizeModelRecord("opencode/mimo-v2.5-free", {})), { free: true, kind: "free", deprecated: false, trainsOnData: true, usable: true });
});

test("rankFreeModels puts usable, tool-capable, newest, largest-context models first", () => {
  const ranked = rankFreeModels(parseVerboseModels(VERBOSE));
  assert.deepEqual(ranked.map((item) => item.model), [
    "muse-spark-1.3-contributor-free", "nemotron-3.5-lightning-free", "big-pickle", "broken-free", "ling-3.0-tiny-free", "ling-2.6-flash-free",
  ]);
  assert.equal(ranked[0].rank, 1);
  assert.match(ranked[0].why, /free and active · tool calls · released 2026-09-02 · 1024k context/);
  assert.match(ranked.at(-1).why, /no tool calls/);
  assert.deepEqual(rankFreeModels(undefined), []);
});

const scanWith = (overrides = {}) => ({
  cli: { installed: true, path: "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode", version: "1.18.31", major: 1, ok: true },
  auth: parseAuthList(AUTH_LIST),
  models: parseVerboseModels(VERBOSE),
  agents: parseAgentList(AGENTS),
  errors: [],
  ...overrides,
});

test("planFirstRun: paid plan linked → free explorer, paid builder with a free alternative, Jev judge when keyed", () => {
  const plan = planFirstRun({ scan: scanWith(), keys: { opencode: true, gateway: true } });
  assert.equal(plan.ok, true);
  assert.equal(plan.opencode.supported, true);
  assert.deepEqual(plan.providers.paid, ["opencode-go", "openrouter"]);
  assert.equal(plan.explorer.model, "opencode/muse-spark-1.3-contributor-free");
  assert.equal(plan.explorer.agent, "plan");
  assert.equal(plan.explorer.parallel, 1);
  assert.equal(plan.builder.model, null);
  assert.equal(plan.builder.free, false);
  assert.equal(plan.builder.alternative.model, "opencode/muse-spark-1.3-contributor-free");
  assert.equal(plan.judge.kind, "jev");
  assert.ok(plan.disclosures.includes(FREE_TIER_NOTES.training));
  assert.ok(plan.disclosures.some((note) => /contributor model/.test(note)));
  // The environment-only Zen and OpenRouter links are flagged: a Start-menu launch does not inherit them.
  assert.equal(plan.warnings.filter((note) => /environment variable/.test(note)).length, 2);
  assert.ok(plan.warnings.some((note) => /deprecated/.test(note)));
});

test("planFirstRun: nothing linked → free explorer and free serialized builder, free judge for batch work only", () => {
  const scan = scanWith({ auth: parseAuthList("") });
  const plan = planFirstRun({ scan, keys: {} });
  assert.equal(plan.builder.model, "opencode/muse-spark-1.3-contributor-free");
  assert.equal(plan.builder.parallel, 1);
  assert.equal(plan.builder.alternative, null);
  assert.deepEqual(plan.judge, {
    kind: "opencode-free", model: "opencode/muse-spark-1.3-contributor-free", suitableFor: ["intake", "triage"],
    reason: "No Jev key and no assistant route: Muse Spark 1.3 Free judges through `opencode run`. It is too slow for per-call model routing, so routing keeps fixed defaults.",
  });
  assert.ok(plan.nextSteps.some((step) => /link a paid provider/i.test(step)));
  assert.ok(plan.nextSteps.some((step) => /Save a Jev key, or an assistant key/.test(step)));
});

test("planFirstRun: a Studio assistant key makes the assistant the judge; preferFree flips the builder", () => {
  const scan = scanWith();
  const plan = planFirstRun({ scan, keys: { zai: true }, prefs: { preferFree: true } });
  assert.equal(plan.judge.kind, "assistant");
  assert.deepEqual(plan.judge.suitableFor, ["routing", "intake", "triage"]);
  assert.equal(plan.builder.free, true);
  assert.equal(plan.builder.alternative.model, null);
  assert.match(plan.builder.alternative.reason, /OpenCode Go/);
  // A saved Zen key is itself a Jev route (paid pin), so Jev is the judge and
  // the free Jev variant is offered as a next step.
  const zen = planFirstRun({ scan, keys: { zen: true } });
  assert.equal(zen.judge.kind, "jev");
  assert.ok(zen.nextSteps.some((step) => /jev-1\.13-free/.test(step)));
});

test("planFirstRun: declining free-tier data collection removes every free recommendation", () => {
  const plan = planFirstRun({ scan: scanWith(), prefs: { allowFreeTraining: false } });
  assert.equal(plan.explorer.model, null);
  assert.equal(plan.explorer.free, false);
  assert.match(plan.explorer.reason, /OpenCode Go/);
  assert.equal(plan.builder.alternative, null);
  assert.equal(plan.judge.kind, "fixed");
  assert.deepEqual(plan.disclosures, []);
  assert.ok(plan.warnings.some((note) => /declined/.test(note)));
  const bare = planFirstRun({ scan: scanWith({ auth: parseAuthList(""), models: [] }), prefs: { allowFreeTraining: false } });
  assert.equal(bare.explorer.model, null);
  assert.match(bare.explorer.reason, /needs one of them/);
  assert.equal(bare.builder.parallel, 0);
  assert.ok(bare.nextSteps.some((step) => /Sign in to OpenCode Zen/.test(step)));
});

test("planFirstRun: no CLI, or a 0.x CLI, blocks explorer and builder and says what to do", () => {
  const missing = planFirstRun({ scan: { cli: { installed: false }, auth: parseAuthList(""), models: [], agents: [] } });
  assert.equal(missing.ok, false);
  assert.equal(missing.explorer.model, null);
  assert.equal(missing.builder.parallel, 0);
  assert.equal(missing.judge.kind, "fixed");
  assert.match(missing.nextSteps[0], /Install the OpenCode CLI/);
  const old = planFirstRun({ scan: scanWith({ cli: { installed: true, version: "0.9.2", major: 0 } }), keys: { gateway: true } });
  assert.equal(old.ok, false);
  assert.equal(old.opencode.supported, false);
  assert.ok(old.warnings.some((note) => /opencode upgrade/.test(note)));
  assert.equal(old.explorer.model, null);
  assert.equal(old.judge.kind, "jev");
  const silent = planFirstRun({ scan: scanWith({ cli: { installed: true, version: null, major: null } }) });
  assert.ok(silent.warnings.some((note) => /did not report a version/.test(note)));
});

function fakeExec(outputs, calls) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    const key = `${command} ${args.join(" ")}`;
    const canned = outputs[key];
    if (typeof canned === "function") return canned();
    if (canned == null) return { code: 1, stdout: "", stderr: `${key}: not found`, timedOut: false, error: null };
    return { code: 0, stdout: canned, stderr: "", timedOut: false, error: null };
  };
}

test("runFirstScan spawns every step in order with colour off and folds partial failures into the scan", async () => {
  const calls = [];
  const exec = fakeExec({
    "where opencode": "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode\r\nC:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd\r\n",
    "opencode --version": "1.18.31\n",
    "opencode auth list": AUTH_LIST,
    "opencode models": MODELS,
    "opencode models --verbose opencode": VERBOSE,
    "opencode agent list": () => ({ code: null, stdout: "", stderr: "", timedOut: true, error: "timed out after 20000 ms" }),
  }, calls);
  const steps = [];
  const scan = await runFirstScan({ exec, env: { PATH: "x" }, platform: "win32", timeoutMs: 20000, onStep: (step) => steps.push(step.id) });
  assert.deepEqual(steps, ["locate", "version", "auth", "models", "verbose", "agents"]);
  assert.deepEqual(calls.map((call) => call.command), ["where", "opencode", "opencode", "opencode", "opencode", "opencode"]);
  assert.equal(calls[0].options.env.NO_COLOR, "1");
  assert.equal(calls[0].options.env.FORCE_COLOR, "0");
  assert.equal(calls[0].options.env.PATH, "x");
  assert.equal(calls[1].options.timeoutMs, 20000);
  assert.deepEqual(scan.cli, { installed: true, path: "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode", version: "1.18.31", major: 1, ok: true });
  assert.deepEqual(scan.auth.providers, ["opencode-go", "opencode", "openrouter"]);
  assert.equal(scan.modelIds.length, 5);
  assert.equal(scan.models.length, 7);
  assert.deepEqual(scan.agents, []);
  assert.deepEqual(scan.errors, [{ step: "agents", error: "timed out after 20000 ms", stderr: null }]);
  assert.equal(scan.steps.at(-1).timedOut, true);
  assert.equal(typeof scan.ms, "number");
  const plan = planFirstRun({ scan });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.errors, scan.errors);
});

test("runFirstScan stops after the locate step when opencode is not on PATH, and uses which off Windows", async () => {
  const calls = [];
  const scan = await runFirstScan({ exec: fakeExec({}, calls), platform: "linux" });
  assert.deepEqual(calls.map((call) => `${call.command} ${call.args.join(" ")}`), ["which opencode"]);
  assert.equal(scan.cli.installed, false);
  assert.deepEqual(scan.errors, [{ step: "locate", error: "exit 1", stderr: "which opencode: not found" }]);
  assert.deepEqual(SCAN_COMMANDS.locate("darwin"), ["which", ["opencode"]]);
});

test("runFirstScan falls back to plain ids when the verbose roster fails, and can skip verbose entirely", async () => {
  const outputs = { "where opencode": "C:\\opencode.cmd", "opencode --version": "1.18.31", "opencode auth list": AUTH_LIST, "opencode models": MODELS, "opencode agent list": AGENTS };
  const scan = await runFirstScan({ exec: fakeExec(outputs, []), platform: "win32" });
  assert.deepEqual(scan.models.map((item) => item.id), ["opencode/big-pickle", "opencode/claude-sonnet-5", "opencode/nemotron-3.5-lightning-free"]);
  assert.equal(scan.models[0].tools, null);
  const plan = planFirstRun({ scan });
  assert.equal(plan.explorer.model, "opencode/nemotron-3.5-lightning-free");
  assert.ok(scan.errors.some((item) => item.step === "verbose"));
  const calls = [];
  await runFirstScan({ exec: fakeExec(outputs, calls), platform: "win32", verbose: false });
  assert.ok(!calls.some((call) => call.args.includes("--verbose")));
});

test("commandLine quotes paths for cmd.exe and refuses anything cmd.exe could reinterpret", () => {
  assert.equal(commandLine("opencode", ["models", "--verbose", "opencode"]), "opencode models --verbose opencode");
  assert.equal(commandLine("opencode", ["run", "--dir", "C:\\Coding Projects\\app", "--model", "opencode/nemotron-3.5-lightning-free"]), 'opencode run --dir "C:\\Coding Projects\\app" --model opencode/nemotron-3.5-lightning-free');
  assert.equal(commandLine("opencode", ["--dir", "C:\\100% done\\app"]), 'opencode --dir "C:\\100% done\\app"');
  assert.throws(() => commandLine("opencode", ["--title", 'say "hi"']), /unsafe argument/);
  assert.throws(() => commandLine("opencode", ["--dir", "C:\\%TEMP%\\x"]), /unsafe argument/);
  assert.throws(() => commandLine("opencode", ["--title", "line\nbreak"]), /unsafe argument/);
});

test("spawnExec resolves with a result for a missing command instead of throwing", async () => {
  const result = await spawnExec("mefi-first-scan-no-such-command-xyz", ["--version"], { timeoutMs: 15000 });
  assert.equal(result.timedOut, false);
  assert.ok(result.error !== null || result.code !== 0);
});
