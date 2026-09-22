import test from "node:test";
import assert from "node:assert/strict";
import * as scanner from "../scripts/first-scan.mjs";
import * as mapper from "../scripts/first-map.mjs";
import * as judge from "../scripts/choice-judge.mjs";
import { createFirstRunService, MAP_FILE, MAP_TITLE } from "../scripts/first-run-service.mjs";

const VERBOSE = ["opencode/nemotron-3.5-lightning-free", JSON.stringify({
  id: "nemotron-3.5-lightning-free", providerID: "opencode", name: "Nemotron 3.5 Lightning Free", status: "active",
  cost: { input: 0, output: 0 }, limit: { context: 262144, output: 262144 }, capabilities: { toolcall: true, reasoning: true, input: { text: true }, output: { text: true } }, release_date: "2026-08-11",
})].join("\n");
const AUTH = "┌  Credentials ~/.local/share/opencode/auth.json\n●  OpenCode Go api\n└  1 credentials\n";

const MAP_REPLY = {
  summary: "A tiny sample project.",
  areas: [{ name: "src", path: "src", what: "One module." }],
  entryPoints: ["README.md"],
  checks: [{ name: "test", command: "node --test", seen: "package.json" }],
  risks: [],
  firstTasks: [{ title: "Add a test for add()", why: "None exists.", check: "node --test passes", files: ["src/math.js"] }],
};
const event = (type, part = {}, extra = {}) => JSON.stringify({ type, timestamp: 1, sessionID: "ses_map", part: { type: type.replace("_", "-"), ...part }, ...extra });
const RUN_OK = [
  event("step_start"),
  event("tool_use", { tool: "glob", state: { status: "completed", title: "**/*" } }),
  event("tool_use", { tool: "read", state: { status: "completed", title: "README.md" } }),
  event("text", { text: `Here is the map.\n${JSON.stringify(MAP_REPLY)}` }),
  event("step_finish", { reason: "stop", tokens: { input: 900, output: 120, reasoning: 10 }, cost: 0 }),
].join("\n") + "\n";
const RUN_REFUSED = JSON.stringify({ type: "error", sessionID: "ses_x", error: { name: "APIError", data: { message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode", statusCode: 403 } } }) + "\n";

function harness({ settings = {}, exec, projectOpen = true, ideas = [], analyze = async () => ({ inventory: { files: 3 } }), assistant = { ok: false }, smoke = false, autoSetup = null } = {}) {
  const state = { settings: structuredClone(settings), writes: [], ideas: structuredClone(ideas), ideaWrites: [], mapFiles: [], sent: [], progress: [], logs: [], calls: [] };
  const scanOutputs = {
    "where opencode": "C:\\Users\\me\\AppData\\Roaming\\npm\\opencode\n", "opencode --version": "1.18.31\n", "opencode auth list": AUTH,
    "opencode models": "opencode/nemotron-3.5-lightning-free\nopencode-go/glm-5.3-flash\n", "opencode models --verbose opencode": VERBOSE, "opencode agent list": "build (primary)\nplan (primary)\n",
  };
  const defaultExec = async (command, args, options) => {
    state.calls.push({ command, args, options });
    const key = `${command} ${args.join(" ")}`;
    if (key in scanOutputs) return { code: 0, stdout: scanOutputs[key], stderr: "", timedOut: false, error: null };
    return { code: 1, stdout: "", stderr: "unknown", timedOut: false, error: null };
  };
  const service = createFirstRunService({
    scanner, mapper, judge,
    readSettings: async () => structuredClone(state.settings),
    writeSettings: async (next) => { state.settings = structuredClone(next); state.writes.push(structuredClone(next)); },
    decryptKey: (settings, field) => (settings?.[field] ? "secret" : null),
    assistantRoute: async () => assistant,
    autoSetup,
    projects: { current: () => ({ id: "project_1", name: "probe", path: "C:\\probe" }), open: () => projectOpen },
    analyzeProject: analyze,
    runEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{"snapshot":false}' }),
    readIdeas: async () => structuredClone(state.ideas),
    writeIdeas: async (rows) => { state.ideas = structuredClone(rows); state.ideaWrites.push(rows.length); },
    writeMapFile: async (name, value) => state.mapFiles.push({ name, value }),
    send: (channel, payload) => state.sent.push({ channel, size: Array.isArray(payload) ? payload.length : null }),
    progress: (payload) => state.progress.push(payload),
    log: (line) => state.logs.push(line),
    exec: async (command, args, options) => {
      state.calls.push({ command, args, options });
      if (exec && command === "opencode" && args[0] === "run") return exec(command, args, options);
      return defaultExec(command, args, options);
    },
    env: { PATH: "x" }, platform: "win32", now: () => 5000, smoke, mapTimeoutMs: 1234,
  });
  return { service, state };
}

test("scan runs the scanner through the injected exec, merges the Studio's keys and returns a slim scan plus the plan", async () => {
  const { service, state } = harness({ settings: { gatewayApiKeyEncrypted: "x" } });
  const first = service.scan();
  const second = service.scan();
  assert.equal(first, second, "a scan in flight is shared");
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.scan.modelIds, undefined);
  assert.equal(result.scan.modelCount, 2);
  assert.equal(result.plan.opencode.version, "1.18.31");
  assert.equal(result.plan.explorer.model, "opencode/nemotron-3.5-lightning-free");
  assert.equal(result.plan.judge.kind, "jev");
  assert.deepEqual(result.prefs, { allowFreeTraining: true, preferFree: false, assistantRoute: false });
  assert.ok(state.progress.some((item) => item.kind === "scan" && item.step?.id === "locate"));
  assert.ok(state.calls.every((call) => call.options.env.NO_COLOR === "1"));
  assert.deepEqual(state.writes, [], "a scan never writes settings");
  const status = await service.status();
  assert.equal(status.scanned, true);
  assert.equal(status.firstRun, null);
});

test("apply needs a scan, writes the first-run record and only the routing fields the plan justifies", async () => {
  const { service, state } = harness({ settings: { executorModels: { grok: "grok-4" } } });
  assert.match((await service.apply()).error, /Run the first scan/);
  await service.scan();
  const result = await service.apply({ prefs: { preferFree: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, ["firstRun", "executorCli", "executorModels.opencode"]);
  assert.equal(state.settings.executorCli, "opencode");
  assert.deepEqual(state.settings.executorModels, { grok: "grok-4", opencode: "opencode/nemotron-3.5-lightning-free" });
  assert.equal(state.settings.modelSelection, undefined);
  assert.equal(state.settings.firstRun.builder.free, true);
  assert.equal(state.settings.firstRun.preferFree, true);
  assert.equal(state.settings.firstRun.explorer.model, "opencode/nemotron-3.5-lightning-free");
  // No Jev key and no assistant route: the free model judges batch work.
  assert.equal(state.settings.firstRun.judge.kind, "opencode-free");
  assert.equal(state.settings.firstRun.judge.model, "opencode/nemotron-3.5-lightning-free");
  assert.ok(result.notes.some((note) => /choose the Free coding tier/.test(note)));
  assert.ok(result.notes.some((note) => /stand-in judge is saved/.test(note)));
  // Declining free-tier data removes the free builder again and clears the saved model.
  const declined = await service.apply({ prefs: { allowFreeTraining: false } });
  assert.deepEqual(declined.applied, ["firstRun", "executorModels.opencode"]);
  assert.deepEqual(state.settings.executorModels, { grok: "grok-4" });
  assert.equal(state.settings.firstRun.allowFreeTraining, false);
  assert.equal(state.settings.firstRun.explorer.model, null);
});

test("apply keeps a different builder CLI and turns Jev selection on only when a Jev key exists", async () => {
  const { service, state } = harness({ settings: { executorCli: "claude", jevApiKeyEncrypted: "x", modelSelection: "fixed" } });
  await service.scan();
  const result = await service.apply();
  assert.equal(state.settings.executorCli, "claude");
  assert.ok(result.applied.includes("modelSelection"));
  assert.equal(state.settings.modelSelection, "jev");
  assert.equal(state.settings.firstRun.judge.kind, "jev");
});

test("map refuses to run without a project, a scan, an explorer, or while another map runs", async () => {
  const closed = harness({ projectOpen: false });
  assert.equal((await closed.service.map()).reason, "no-project");
  const { service } = harness();
  assert.equal((await service.map()).reason, "no-scan");
  assert.equal((await service.map({ projectId: "project_2" })).reason, "project-changed");
  const bare = harness({ settings: { firstRun: { explorer: { model: null, reason: "No free model and no linked provider." }, providers: { paid: [] } } } });
  const refused = await bare.service.map();
  assert.equal(refused.reason, "no-explorer");
  assert.match(refused.error, /No free model/);
  const missing = harness({ settings: { firstRun: { explorer: { model: "opencode/x-free" }, providers: { paid: [] }, opencode: { installed: false } } } });
  assert.equal((await missing.service.map()).reason, "no-opencode");
  const smoke = harness({ smoke: true });
  assert.equal((await smoke.service.map()).reason, "unavailable");
  assert.equal((await smoke.service.scan()).ok, false);
});

test("map spawns the stock plan agent in the project, streams progress, saves ideas and the map file", async () => {
  let spawned = null;
  const exec = async (_command, _args, options) => {
    options.onSpawn({ pid: 42 });
    spawned = options;
    for (const line of RUN_OK.split("\n").filter(Boolean)) options.onData(line + "\n");
    return { code: 1, stdout: RUN_OK, stderr: "", timedOut: false, error: null };
  };
  const { service, state } = harness({ exec, ideas: [{ id: "idea_keep", title: "Keep me", status: "keep" }] });
  await service.scan();
  await service.apply();
  const result = await service.map({ projectId: "project_1" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.summary, "1 area, 1 entry point, 1 check, 1 first task saved as ideas.");
  assert.deepEqual(result.ideas, { added: 1, updated: 0, total: 2 });
  assert.equal(result.sessionId, "ses_map");
  assert.equal(result.model, "opencode/nemotron-3.5-lightning-free");
  assert.deepEqual(result.tokens, { input: 900, output: 120, reasoning: 10 });
  const run = state.calls.find((call) => call.args[0] === "run");
  assert.deepEqual(run.args, ["run", "--format", "json", "--agent", "plan", "--model", "opencode/nemotron-3.5-lightning-free", "--title", MAP_TITLE, "--dir", "C:\\probe"]);
  assert.equal(run.options.cwd, "C:\\probe");
  assert.equal(run.options.timeoutMs, 1234);
  assert.equal(run.options.env.OPENCODE_CONFIG_CONTENT, '{"snapshot":false}');
  assert.equal(run.options.env.PATH, "x");
  assert.match(run.options.input, /mapping the project "probe"/);
  assert.match(run.options.input, /Files inspected: 3/);
  assert.equal(spawned.onSpawn, run.options.onSpawn);
  assert.equal(state.ideas.length, 2);
  assert.equal(state.ideas[1].source, "first-map");
  assert.equal(state.ideas[1].projectId, "project_1");
  assert.deepEqual(state.sent, [{ channel: "eyes:ideas", size: 2 }]);
  assert.equal(state.mapFiles[0].name, MAP_FILE);
  assert.equal(state.mapFiles[0].value.map.summary, "A tiny sample project.");
  const phases = state.progress.filter((item) => item.kind === "map").map((item) => item.phase);
  assert.equal(phases[0], "start");
  assert.equal(phases.at(-1), "done");
  assert.ok(state.progress.some((item) => item.kind === "map" && /^glob|^read/.test(item.step ?? "")));
  const status = await service.status();
  assert.equal(status.mapping.running, false);
  assert.equal(status.lastMaps.project_1.ok, true);
  // A second map updates the same idea instead of duplicating it.
  const again = await service.map();
  assert.deepEqual(again.ideas, { added: 0, updated: 1, total: 2 });
});

test("map reports a free-tier refusal, a timeout, a start failure and an unparsable reply as closed failures", async () => {
  const run = (payload) => async () => payload;
  const refused = harness({ exec: run({ code: 1, stdout: RUN_REFUSED, stderr: "", timedOut: false, error: null }), settings: { firstRun: { explorer: { model: "opencode/nemotron-3.5-lightning-free" }, providers: { paid: [] } } } });
  const refusal = await refused.service.map();
  assert.equal(refusal.reason, "free-tier-refused");
  assert.match(refusal.error, /customizes the plan agent/);
  assert.equal(refused.state.ideaWrites.length, 0);
  const timed = harness({ exec: run({ code: null, stdout: event("step_start") + "\n", stderr: "", timedOut: true, error: "timed out" }), settings: { firstRun: { explorer: { model: "opencode/nemotron-3.5-lightning-free" }, providers: { paid: [] } } } });
  assert.equal((await timed.service.map()).reason, "timeout");
  const dead = harness({ exec: run({ code: null, stdout: "", stderr: "", timedOut: false, error: "spawn opencode ENOENT" }), settings: { firstRun: { explorer: { model: "opencode/nemotron-3.5-lightning-free" }, providers: { paid: [] } } } });
  assert.match((await dead.service.map()).error, /could not start/);
  const prose = harness({ exec: run({ code: 0, stdout: event("text", { text: "I could not map this folder." }) + "\n", stderr: "", timedOut: false, error: null }), settings: { firstRun: { explorer: { model: "opencode/nemotron-3.5-lightning-free" }, providers: { paid: [] } } } });
  const unparsable = await prose.service.map();
  assert.equal(unparsable.reason, "unparsable");
  assert.match(unparsable.textTail, /could not map/);
  assert.equal((await prose.service.status()).lastMaps.project_1.ok, false);
});

test("assist asks the linked assistant model, folds the map in, and falls back to built-in guidance when the reply is unusable", async () => {
  const assistModule = await import("../scripts/setup-assist.mjs");
  const chats = [];
  const advice = { summary: "You are mapped; connect a key next.", stops: { connections: "Save a Jev key for routing.", create: "Start with the add() test." }, firstTask: { title: "Add a test for add()", brief: "Write one test. Check: node --test passes." } };
  const exec = async (_command, _args, options) => {
    for (const line of RUN_OK.split("\n").filter(Boolean)) options.onData(line + "\n");
    return { code: 0, stdout: RUN_OK, stderr: "", timedOut: false, error: null };
  };
  const { service, state } = harness({ exec, settings: { firstRun: { explorer: { model: "opencode/nemotron-3.5-lightning-free", free: true }, builder: { model: null }, judge: { kind: "assistant" }, providers: { paid: ["opencode-go"], linked: ["opencode-go"], freeCount: 1 }, opencode: { installed: true, version: "1.18.31" } } } });
  Object.assign(service, {});
  const withChat = createFirstRunService({
    scanner, mapper, judge, assistModule,
    readSettings: async () => structuredClone(state.settings), writeSettings: async () => {},
    projects: { current: () => ({ id: "project_1", name: "probe", path: "C:\\probe" }), open: () => true },
    analyzeProject: async () => ({ inventory: { files: 3, sourceFiles: 1, testFiles: 0, languages: [{ name: "JavaScript" }], checks: [] } }),
    readMapFile: async () => ({ map: MAP_REPLY }),
    assistantChat: async (system, user) => { chats.push({ system, user }); return { ok: true, text: `Sure: ${JSON.stringify(advice)}`, model: "deepseek-v4.1-flash" }; },
    exec, now: () => 7000,
  });
  const first = withChat.assist({ progress: { done: [true, true, true, false, false, false, false] } });
  assert.equal(first, withChat.assist(), "an assist in flight is shared");
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.via, "assistant");
  assert.equal(result.model, "deepseek-v4.1-flash");
  assert.deepEqual(result.advice.stops, advice.stops);
  assert.equal(result.advice.firstTask.title, "Add a test for add()");
  assert.deepEqual(result.warnings, []);
  assert.match(chats[0].system, /remaining stops: connections, create, monitor, review/);
  assert.match(chats[0].user, /First map summary: A tiny sample project\./);
  assert.match(chats[0].user, /Local scan: 3 files/);
  // An unusable reply keeps the built-in guidance, flagged as such.
  const broken = createFirstRunService({
    scanner, mapper, judge, assistModule,
    readSettings: async () => structuredClone(state.settings), writeSettings: async () => {},
    projects: { current: () => ({ id: "project_1", name: "probe", path: "C:\\probe" }), open: () => true },
    assistantChat: async () => ({ ok: true, text: "I cannot help with that." }), exec,
  });
  const fallback = await broken.assist({ progress: {} });
  assert.equal(fallback.via, "static");
  assert.equal(fallback.advice.source, "static");
  assert.match(fallback.advice.stops.workspace, /is selected/);
  assert.ok(fallback.warnings.some((note) => /built-in guidance/.test(note)));
  // Without a saved setup there is nothing to plan from.
  const bare = harness();
  assert.match((await bare.service.assist()).error, /Run the first scan/);
});

test("assist uses the free explorer through opencode run when the judge is not the assistant", async () => {
  const assistModule = await import("../scripts/setup-assist.mjs");
  const advice = { summary: "Map it next.", stops: { map: "Map probe with the free explorer." }, firstTask: null };
  const runs = [];
  const exec = async (command, args, options) => {
    runs.push({ command, args, options });
    const text = JSON.stringify({ type: "text", sessionID: "ses_a", part: { type: "text", text: JSON.stringify(advice) } });
    return { code: 0, stdout: `${text}\n`, stderr: "", timedOut: false, error: null };
  };
  const service = createFirstRunService({
    scanner, mapper, judge, assistModule,
    readSettings: async () => ({ firstRun: { explorer: { model: "opencode/mimo-v2.5-free", free: true }, builder: { model: "opencode/mimo-v2.5-free", free: true }, judge: { kind: "opencode-free", model: "opencode/mimo-v2.5-free" }, providers: { paid: [], linked: [], freeCount: 1 }, opencode: { installed: true } } }),
    writeSettings: async () => {},
    projects: { current: () => ({ id: "project_1", name: "probe", path: "C:\\probe" }), open: () => true },
    runEnv: () => ({ OPENCODE_CONFIG_CONTENT: '{"snapshot":false}' }), env: { PATH: "x" }, exec,
  });
  const result = await service.assist({ progress: { done: [true, true] } });
  assert.equal(result.ok, true);
  assert.equal(result.via, "opencode-free");
  assert.equal(result.model, "opencode/mimo-v2.5-free");
  assert.deepEqual(result.advice.stops, { map: "Map probe with the free explorer." });
  assert.deepEqual(runs[0].args.slice(0, 7), ["run", "--format", "json", "--agent", "plan", "--model", "opencode/mimo-v2.5-free"]);
  assert.ok(runs[0].args.includes("--dir"));
  assert.equal(runs[0].options.env.OPENCODE_CONFIG_CONTENT, '{"snapshot":false}');
  assert.match(runs[0].options.input, /setup assistant inside Mefi's Studio/);
});

test("a paid explorer runs on OpenCode's default model and cancel kills the running child", async () => {
  let killed = null;
  const originalKill = scanner.killTree;
  let resolveRun;
  const exec = async (_command, _args, options) => {
    options.onSpawn({ pid: 7, kill: () => { killed = 7; } });
    return new Promise((resolve) => { resolveRun = resolve; });
  };
  const { service, state } = harness({ exec, settings: { firstRun: { explorer: { model: null, reason: "paid" }, providers: { paid: ["opencode-go"] } } }, });
  const pending = service.map();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await service.status()).mapping.running, true);
  const busy = await service.map();
  assert.equal(busy.reason, "busy");
  const cancel = service.cancel();
  assert.equal(cancel.cancelled, true);
  resolveRun({ code: null, stdout: "", stderr: "", timedOut: false, error: "killed" });
  const result = await pending;
  assert.equal(result.reason, "cancelled");
  const run = state.calls.find((call) => call.args[0] === "run");
  assert.ok(!run.args.includes("--model"));
  assert.equal(originalKill, scanner.killTree);
  assert.equal(service.cancel().cancelled, false);
  void killed;
});

test("the scan carries auto setup's plan without writing, and Use this setup runs it for real", async () => {
  const runs = [];
  const summary = "Assistant on Claude Code CLI, fixed model defaults, builders on OpenCode.";
  const autoSetup = async (options = {}) => {
    runs.push(options);
    if (options.apply === false) return { ok: true, applied: false, planned: true, summary, notes: ["OpenCode CLI found: builders run through it."], changes: { provider: "claude" } };
    return { ok: true, applied: true, summary, notes: ["OpenCode CLI found: builders run through it."], changes: { provider: "claude" } };
  };
  const { service, state } = harness({ autoSetup });
  const scan = await service.scan();
  assert.deepEqual(runs, [{ apply: false }], "the scan only plans");
  assert.equal(scan.autoSetup.planned, true);
  assert.equal(scan.autoSetup.summary, summary);
  assert.deepEqual(state.writes, [], "a scan never writes settings");
  const result = await service.apply();
  assert.deepEqual(runs, [{ apply: false }, { apply: true }], "Use this setup applies it once");
  assert.ok(result.applied.includes("autoSetup"), "an applied pass is reported");
  assert.deepEqual(result.autoSetup.changes, { provider: "claude" });
  assert.match(result.notes.join(" "), /Auto setup: Assistant on Claude Code CLI/);
  assert.match(result.summary, /^Explorer /, "a usable OpenCode keeps the scan's own summary");
});

test("auto setup that throws or finds nothing never blocks the first-run apply", async () => {
  const { service, state } = harness({ autoSetup: async () => { throw new Error("where.exe exploded"); } });
  const scan = await service.scan();
  assert.equal(scan.autoSetup.ok, false);
  assert.match(scan.autoSetup.error, /where\.exe exploded/);
  const result = await service.apply();
  assert.equal(result.ok, true);
  assert.ok(!result.applied.includes("autoSetup"));
  assert.equal(state.writes.length, 1, "the first-run record is still written once");
  const nothing = harness({ autoSetup: async () => ({ ok: false, error: "Nothing to set up yet - save a key or install a CLI." }) });
  await nothing.service.scan();
  const applied = await nothing.service.apply();
  assert.equal(applied.ok, true);
  assert.doesNotMatch(applied.notes.join(" "), /Nothing to set up/, "a usable OpenCode does not need the auto-setup excuse");
  const status = await nothing.service.status();
  assert.equal(status.autoSetup, null, "status mirrors the settings record, absent here");
});

test("status mirrors the first-launch auto-setup record the host saved", async () => {
  const record = { at: 99, automatic: true, summary: "Assistant on z.ai GLM, fixed model defaults, builders on OpenCode.", notes: [] };
  const { service } = harness({ settings: { autoSetup: record } });
  const status = await service.status();
  assert.deepEqual(status.autoSetup, record);
  assert.equal(status.firstRun, null);
});
