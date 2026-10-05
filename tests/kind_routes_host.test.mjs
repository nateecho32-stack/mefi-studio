// Which model does which kind of job (main.cjs "Which model does which kind
// of job", sliced into a vm with the real model-kinds, model-ladder and
// agent-profiles): the report card the Team page reads, Studio's own trial for
// a clearly weak kind, how a finished trial is kept or dropped, and that the
// routes land in the team's settings.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const modelKinds = require("../scripts/model-kinds.cjs");
const modelLadder = require("../scripts/model-ladder.cjs");
const agentProfiles = require("../scripts/agent-profiles.cjs");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

let serial = 0;
const row = (model, taskType, outcome, extra = {}) => ({ id: `o${serial += 1}`, provider: "opencode", model, taskType, source: "worker", outcome, at: 1000 + serial, ...extra });
const many = (count, ...args) => Array.from({ length: count }, () => row(...args));
const flash = () => [
  ...many(52, "deepseek-v4.1-flash", "coding-implement", "verified"), ...many(25, "deepseek-v4.1-flash", "coding-implement", "failed"),
  ...many(8, "deepseek-v4.1-flash", "coding-explore", "verified"), ...many(36, "deepseek-v4.1-flash", "coding-explore", "failed"),
];

function host({ settings = {}, rows = flash(), onPath = ["claude"], signedIn = { claude: true, codex: false } } = {}) {
  const state = { settings: structuredClone({ executorCli: "opencode", executorModels: { opencode: "opencode-go/deepseek-v4.1-flash" }, modelSelection: "jev", ...settings }) };
  const history = [], logs = [];
  const env = vm.createContext({
    modelKinds, modelLadder, agentProfiles, path, console, process: { platform: "win32", env: {} },
    STUDIO_ROOT: "C:/studio", projectDataPath: (file) => file, modelPerformanceStores: new Map(), createModelPerformanceStore: () => ({ read: async () => ({ observations: rows }) }),
    modelPerformanceStore: () => ({ read: async () => ({ observations: rows }) }),
    projects: { current: () => ({ id: "project_none" }), list: () => ({ projects: [] }), dataPath: (file) => file },
    readAgentSettings: async () => structuredClone(state.settings), readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => { const next = structuredClone(state.settings); if (mutate(next) !== false) state.settings = next; return state.settings; },
    spawn: (command, args) => { const child = new EventEmitter(); setImmediate(() => child.emit("close", onPath.includes(args[0]) ? 0 : 1)); return child; },
    cliSignedIn: (id) => signedIn[id] ?? null,
    heavyRetryModel: () => null, BUILDER_CLIS: ["grok", "claude", "codex", "antigravity"],
    normalizeExecutorTier: (value) => ["auto", "free", "fast", "heavy"].includes(value) ? value : "auto",
    executorModelOverride: (settings, cli) => String(settings.executorModels?.[cli] ?? ""),
    executorTierDefaults: () => ({ free: { model: "" }, fast: { model: "" }, heavy: { model: "" } }),
    executorTierZai: () => false, ZAI_MODEL_ROUTINE: "glm-5.3-flash", ASSISTANT_MODEL: "deepseek-v4.1-flash",
    logLine: (line) => logs.push(line), pushAutopilotHistory: (kind, text) => history.push([kind, text]),
  });
  vm.runInContext(section("// The model id a builder route runs, as the CLI names it", "// What worked before for this kind of job on this model")
    + section("function workerLedgerIdentity(", "// The verifier's verdict on an attempt")
    + section("// ---- Which model does which kind of job", "// A route its provider refuses"), env);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  return { env, state, history, logs, rows, report: async () => plain(await env.teamReport(state.settings)), route: async (kind) => plain(await env.kindRouteFor(kind)) };
}

test("the report card names the worker's weak kind and suggests trying Sonnet on the Claude login first", async () => {
  const h = host();
  const report = await h.report();
  assert.equal(report.checked, 121);
  assert.deepEqual(report.builder, { cli: "opencode", model: "opencode-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" });
  assert.deepEqual(report.models[0].kinds.map((kind) => [kind.taskType, kind.verdict]), [["coding-implement", "good"], ["coding-explore", "weak"]]);
  assert.deepEqual(report.suggestions.map((item) => [item.taskType, item.to.cli, item.to.model]), [["coding-explore", "claude", "sonnet"]]);
  assert.deepEqual(report.untried.map((item) => item.name), ["Sonnet", "DeepSeek V4 Pro", "Opus"]);
  assert.deepEqual(report.thinking, { mode: "auto", climb: true, askMax: true, explore: true });
});

test("with trying other models on, Studio starts one trial for a clearly weak kind and says so", async () => {
  const h = host();
  const route = await h.route("coding-explore");
  assert.deepEqual([route.cli, route.model, route.by, route.trial.size], ["claude", "sonnet", "studio", 5]);
  assert.deepEqual(route.trial.baseline, { wins: 8, losses: 36 });
  assert.equal(h.state.settings.agentKinds["coding-explore"].cli, "claude", "the trial is saved in the team's settings");
  assert.match(h.history.at(-1)[1], /^Trying Sonnet on the next 5 exploring a codebase jobs: DeepSeek V4\.1 Flash passes 8 of 44 of them \(18%\)\.$/);
  assert.equal(await h.route("coding-implement"), null, "a kind it does well stays on the usual model");
  const again = await h.route("coding-explore");
  assert.equal(again.trial.from, route.trial.from, "the running trial is reused, not restarted");
  assert.equal(h.history.length, 1);
});

test("a finished trial is kept when the new model did clearly better, and dropped when it did not", async () => {
  const kept = host();
  const trial = await kept.route("coding-explore");
  kept.rows.push(...Array.from({ length: 4 }, () => row("sonnet", "coding-explore", "verified", { provider: "claude", at: trial.trial.from + 1 })), row("sonnet", "coding-explore", "failed", { provider: "claude", at: trial.trial.from + 2 }));
  const after = await kept.route("coding-explore");
  assert.deepEqual([after.cli, after.model, after.trial, after.kept.wins, after.kept.losses], ["claude", "sonnet", null, 4, 1]);
  assert.match(kept.history.at(-1)[1], /^Kept Sonnet for exploring a codebase jobs: it passed 4 of 5\.$/);
  const dropped = host();
  const second = await dropped.route("coding-explore");
  dropped.rows.push(...Array.from({ length: 5 }, () => row("sonnet", "coding-explore", "failed", { provider: "claude", at: second.trial.from + 1 })));
  assert.equal(await dropped.route("coding-explore"), null);
  assert.equal(dropped.state.settings.agentKinds, undefined, "the route is gone from the settings");
  assert.match(dropped.history.at(-1)[1], /not clearly better, so those jobs go back to the usual model/);
});

test("with trying other models off, or models chosen by hand, Studio starts nothing on its own", async () => {
  assert.equal(await host({ settings: { agentThinking: { explore: false } } }).route("coding-explore"), null);
  assert.equal(await host({ settings: { modelSelection: "fixed" } }).route("coding-explore"), null);
  assert.equal((await host({ onPath: [] }).route("coding-explore"))?.model, "opencode-go/deepseek-v4-pro", "no Claude Code here: the worker's own stronger model is tried");
});

test("with one provider for the whole studio, only that tool's own models are offered", async () => {
  const sonnetWeak = [...many(4, "sonnet", "coding-explore", "verified", { provider: "claude" }), ...many(12, "sonnet", "coding-explore", "failed", { provider: "claude" })];
  const settings = { aiAutoFallback: false, aiAutoProviders: ["claude"], executorCli: "claude", executorModels: { claude: "sonnet" } };
  const held = host({ settings, rows: sonnetWeak, onPath: ["claude", "codex"], signedIn: { claude: true, codex: true } });
  const report = await held.report();
  assert.deepEqual(report.suggestions.map((item) => [item.to.cli, item.to.model]), [["claude", "opus"]]);
  assert.ok(report.untried.every((item) => item.cli === "claude"), "Codex is not offered while Claude Code runs the whole studio");
  const open = host({ settings: { executorCli: "claude", executorModels: { claude: "sonnet" } }, rows: sonnetWeak, onPath: ["claude", "codex"], signedIn: { claude: true, codex: true } });
  assert.ok((await open.report()).untried.some((item) => item.cli === "codex"), "without that hold, Codex is a candidate too");
});

test("an owner's route is used as it is, and its trial is judged the same way", async () => {
  const h = host({ settings: { agentKinds: { "coding-explore": { cli: "claude", model: "opus", by: "owner", trial: null, kept: { at: 1, wins: 0, losses: 0 } } } } });
  const route = await h.route("coding-explore");
  assert.deepEqual([route.cli, route.model, route.by, route.trial], ["claude", "opus", "owner", null]);
  const report = await h.report();
  assert.deepEqual(report.kinds["coding-explore"], { cli: "claude", model: "opus", name: "Opus", label: "Exploring a codebase", by: "owner", trial: null, kept: { at: 1, wins: 0, losses: 0 } });
  assert.deepEqual(report.suggestions, [], "a routed kind gets no suggestion");
});
