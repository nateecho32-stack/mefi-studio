// The scout (main.cjs lunaContextPointer) waits 8 s for a model to pick a
// task's starting file. A coding CLI cannot start and answer in that time, so
// a scout whose route is a CLI makes no call at all and the task keeps its
// local matches; the log says so once per run, not once per task. Zen and the
// other HTTP routes go on as before. The real seat choice, seatCli and the
// scout run in a vm with the model calls and settings stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import cliSetup from "../scripts/cli-setup.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const DATA_ONLY_CLIS = new Set(["claude", "codex", "grok", "antigravity"]);
const REFS = { files: ["src/router.js", "src/handler.js"], code: [{ file: "src/handler.js", snippet: "export function handle()" }] };
const ANSWER = '{"index":1,"why":"The handler is here."}';

function scoutHost(settings, { route = null, zenKey = null } = {}) {
  const logs = [], seatCalls = [], direct = [], resolved = [];
  const context = vm.createContext({
    setTimeout, clearTimeout,
    ZEN_MODEL_HEAVY: "gpt-6.1-sol", ZEN_MODEL_ROUTINE: "gpt-6-luna", DATA_ONLY_CLIS,
    readAgentSettings: async () => settings, readSettings: async () => settings,
    decryptKey: (_settings, field) => (field === "zenApiKeyEncrypted" ? zenKey : null),
    resolveAiRoute: async (role, options) => { resolved.push({ role, options }); return route ?? { ok: false, error: "no route in this fixture" }; },
    logLine: (line) => logs.push(line), scrubOutbound: (text) => text,
    providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider() {},
    zenEndpoint: () => "https://zen.invalid/v1/responses",
    chatCompletion: async (...args) => { direct.push(args); return { ok: true, text: ANSWER, model: "gpt-6-luna" }; },
  });
  vm.runInContext([
    source.match(/^const AI_PROVIDERS = .*$/m)[0],
    source.match(/^const AI_AUTO_PROVIDERS = .*$/m)[0],
    section("function roleProvider(", "// Zen sends OpenAI's models"),
    section("const SEAT_DEFAULTS", "// ---- the Policy Lab's observation-only recorder"),
    section("// A scout on a coding CLI is said in the log once per run", "async function attachTaskRefs("),
  ].join("\n"), context);
  // The seat call itself, observed.
  context.seatFetch = async (...args) => { seatCalls.push(args); return { ok: true, text: ANSWER, model: "glm-5.3" }; };
  return { context, logs, seatCalls, direct, resolved };
}

test("after Use for the whole studio, the scout starts no CLI for any task and says so once", async () => {
  for (const provider of ["claude", "codex", "grok", "antigravity"]) {
    const h = scoutHost(cliSetup.singleProvider({}, provider));
    for (let task = 0; task < 3; task += 1) assert.equal(await h.context.lunaContextPointer(`Fix the handler ${task}`, REFS), null, provider);
    assert.equal(h.seatCalls.length, 0, `${provider}: no seat call`);
    assert.equal(h.direct.length, 0, `${provider}: no direct call`);
    assert.equal(h.resolved.length, 0, `${provider}: the seat names its CLI, nothing to resolve`);
    assert.deepEqual(h.logs, [`[scout] the scout seat rides the ${provider} CLI, which cannot answer within the scout's 8 s: tasks keep their local code matches and no ${provider} call is made for them`], "once per run, not once per task");
  }
});

test("an auto or keyless Zen scout skips the call when the heavy route it would take is a CLI", async () => {
  const onClaude = scoutHost({ agentSeats: { scout: { provider: "auto" } }, aiRoleProviders: { heavy: "claude" } });
  assert.equal(await onClaude.context.lunaContextPointer("Fix the handler", REFS), null);
  assert.equal(onClaude.seatCalls.length + onClaude.resolved.length, 0);
  const keyless = scoutHost({ agentSeats: { scout: { provider: "zen" } }, aiProvider: "codex" });
  assert.equal(await keyless.context.lunaContextPointer("Fix the handler", REFS), null, "a Zen scout with no key rides the heavy route, here Codex");
  assert.equal(keyless.seatCalls.length, 0);
  assert.match(keyless.logs[0], /the codex CLI/);
  // Auto all the way down: the route the heavy role resolves to decides.
  const autoCli = scoutHost({ agentSeats: { scout: { provider: "auto" } } }, { route: { ok: true, provider: "grok", cli: true, model: "" } });
  assert.equal(await autoCli.context.lunaContextPointer("Fix the handler", REFS), null);
  assert.deepEqual(autoCli.resolved.map((row) => row.role), ["heavy"]);
  assert.equal(autoCli.seatCalls.length, 0);
  const autoHttp = scoutHost({ agentSeats: { scout: { provider: "auto" } } }, { route: { ok: true, provider: "zai", endpoint: "https://zai.invalid", apiKey: "k", model: "glm-5.3" } });
  const pointer = await autoHttp.context.lunaContextPointer("Fix the handler", REFS);
  assert.equal(pointer.title, "Start with src/handler.js", "an HTTP heavy route still points");
  assert.equal(autoHttp.seatCalls.length, 1);
  assert.equal(autoHttp.logs.length, 0);
});

test("Zen and the other HTTP scouts work exactly as before", async () => {
  const zen = scoutHost({}, { zenKey: "zen-key" });
  const pointer = await zen.context.lunaContextPointer("Fix the handler", REFS);
  assert.equal(pointer.title, "Start with src/handler.js");
  assert.equal(zen.direct.length, 1, "the default scout asks Luna on Zen directly");
  assert.equal(zen.direct[0][4].timeoutMs, 8000);
  assert.equal(zen.seatCalls.length + zen.resolved.length, 0);
  for (const provider of ["openrouter", "zai", "opencode", "lmstudio", "custom", "chatgpt"]) {
    const h = scoutHost({ agentSeats: { scout: { provider } } });
    assert.equal((await h.context.lunaContextPointer("Fix the handler", REFS)).title, "Start with src/handler.js", provider);
    assert.equal(h.seatCalls.length, 1, provider);
    assert.equal(h.seatCalls[0][0], "scout");
    assert.equal(h.seatCalls[0][4].timeoutMs, 8000, `${provider}: the same short deadline`);
    assert.equal(h.logs.length, 0);
  }
});

test("a scout switched off still makes no call and resolves nothing", async () => {
  const h = scoutHost({ ...cliSetup.singleProvider({}, "claude"), agentBrain: { contextScout: false } });
  assert.equal(await h.context.lunaContextPointer("Fix the handler", REFS), null);
  assert.equal(h.logs.length + h.seatCalls.length + h.resolved.length, 0);
  assert.equal(await h.context.lunaContextPointer("Fix the handler", { files: [] }), null, "no local matches, nothing to choose from");
});
