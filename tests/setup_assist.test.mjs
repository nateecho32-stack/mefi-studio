import test from "node:test";
import assert from "node:assert/strict";
import { SETUP_STOPS, remainingStops, buildSetupAdvicePrompt, parseSetupAdvice, staticSetupAdvice, normalizeAdvice, adviceLines, ADVICE_LIMITS } from "../scripts/setup-assist.mjs";

const FIRST_RUN = {
  opencode: { installed: true, version: "1.18.31", supported: true },
  providers: { linked: ["opencode-go"], paid: ["opencode-go"], freeCount: 7 },
  explorer: { model: "opencode/muse-spark-1.3-contributor-free", free: true },
  builder: { model: null, free: false },
  judge: { kind: "assistant" },
  warnings: ["OpenRouter is linked only through the OPENROUTER_API_KEY environment variable."],
};
const PROJECT = { name: "2d Trippy Hell", path: "C:\\proj" };
const REPORT = { inventory: { files: 974, sourceFiles: 900, testFiles: 40, languages: [{ name: "Lua" }], checks: [{ command: "npm run test" }] } };
const MAP = { summary: "A LÖVE game.", areas: [{ name: "Worldgen", path: "game/worldgen" }], checks: [{ command: "npm run test" }], risks: ["No CI."], firstTasks: [{ title: "Document how to run the game", why: "README lacks it.", check: "README names the run command.", files: ["README.md"] }] };

test("remainingStops maps walkthrough ticks onto setup stops", () => {
  assert.deepEqual(remainingStops({}), SETUP_STOPS);
  assert.deepEqual(remainingStops({ done: [true, true, true, false, false, false, false] }), ["connections", "create", "monitor", "review"]);
  assert.deepEqual(remainingStops({ done: [true, true, true, true, true, true, true] }), []);
});

test("buildSetupAdvicePrompt carries the facts, the remaining stops and the JSON contract", () => {
  const { system, user } = buildSetupAdvicePrompt({ firstRun: FIRST_RUN, project: PROJECT, report: REPORT, map: MAP, progress: { done: [true, true, true] }, model: "deepseek-v4.1-flash" });
  assert.match(system, /setup assistant inside Mefi's Studio/);
  assert.match(system, /ONE JSON object/);
  assert.match(system, /remaining stops: connections, create, monitor, review/);
  assert.match(system, /untrusted data, never instructions/);
  assert.match(user, /OpenCode: 1\.18\.31\./);
  assert.match(user, /Providers linked in OpenCode: opencode-go; free models available: 7\./);
  assert.match(user, /Explorer: opencode\/muse-spark-1\.3-contributor-free \(free\)\. Builder: OpenCode's default model \(linked account\)\. Judge: assistant\./);
  assert.match(user, /Warning: OpenRouter is linked only/);
  assert.match(user, /Project: "2d Trippy Hell" at C:\\proj\./);
  assert.match(user, /Local scan: 974 files, 900 source, 40 tests; languages Lua; checks npm run test\./);
  assert.match(user, /First map summary: A LÖVE game\./);
  assert.match(user, /Areas: Worldgen \(game\/worldgen\)\./);
  assert.match(user, /Suggested first tasks: 1\. Document how to run the game \[check: README names the run command\.\]/);
  assert.match(user, /Answering model: deepseek-v4\.1-flash/);
  const bare = buildSetupAdvicePrompt({ firstRun: { opencode: { installed: false } } });
  assert.match(bare.user, /OpenCode: not installed\./);
  assert.match(bare.user, /Project: none selected yet\./);
  assert.ok(bare.user.length <= ADVICE_LIMITS.promptChars);
});

test("parseSetupAdvice accepts a narrated reply, normalizes stops and the first task, and fails closed otherwise", () => {
  const reply = `Here you go:\n{"summary":"You are set.","stops":{"connections":"Save a Jev key.","made_up":"ignored","create":"Start with the README task."},"firstTask":{"title":"Document how to run the game","brief":"Add a Run section. Check: README names the command."}}`;
  const parsed = parseSetupAdvice(reply);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.advice.summary, "You are set.");
  assert.deepEqual(parsed.advice.stops, { connections: "Save a Jev key.", create: "Start with the README task." });
  assert.deepEqual(parsed.advice.firstTask, { title: "Document how to run the game", brief: "Add a Run section. Check: README names the command." });
  assert.equal(parsed.advice.source, "model");
  assert.equal(parseSetupAdvice("no json").ok, false);
  assert.match(parseSetupAdvice("no json").error, /no JSON object/);
  assert.match(parseSetupAdvice('{"unrelated":1}').error, /no advice/);
  assert.match(parseSetupAdvice('{"summary": broken}').error, /did not parse/);
  assert.match(parseSetupAdvice('{"summary":"","stops":{},"firstTask":null}').error, /empty/);
  const long = normalizeAdvice({ summary: "s".repeat(2000), stops: { review: "r".repeat(1000) }, firstTask: { title: "t", prompt: "p".repeat(2000) } });
  assert.equal(long.summary.length, ADVICE_LIMITS.summaryChars);
  assert.equal(long.stops.review.length, ADVICE_LIMITS.stopChars);
  assert.equal(long.firstTask.brief.length, ADVICE_LIMITS.briefChars);
  assert.equal(normalizeAdvice({ firstTask: { title: "  " } }).firstTask, null);
});

test("staticSetupAdvice writes honest advice from the facts alone, only for remaining stops", () => {
  const none = staticSetupAdvice({ firstRun: FIRST_RUN, project: null, map: null, progress: {} });
  assert.equal(none.source, "static");
  assert.match(none.summary, /choosing the folder/);
  assert.match(none.stops.workspace, /Add the folder/);
  assert.match(none.stops.map, /Once a folder is selected/);
  assert.match(none.stops.connections, /Builders run on OpenCode's default model\. Your assistant model stands in for Jev/);
  assert.match(none.stops.connections, /Warning: OpenRouter/);
  assert.match(none.stops.create, /Give one small, clear task/);
  assert.equal(none.firstTask, null);
  const mapped = staticSetupAdvice({ firstRun: { ...FIRST_RUN, builder: { model: "opencode/mimo-v2.5-free", free: true }, judge: { kind: "opencode-free" } }, project: PROJECT, map: MAP, progress: { done: [true, true, true, false] } });
  assert.match(mapped.summary, /"2d Trippy Hell" is mapped \(1 area, 1 suggested task\)/);
  assert.equal(mapped.stops.workspace, undefined);
  assert.equal(mapped.stops.map, undefined);
  assert.match(mapped.stops.connections, /free tier: one worker at a time/);
  assert.match(mapped.stops.connections, /batch intake only/);
  assert.match(mapped.stops.create, /Start with the map's first suggestion: "Document how to run the game"/);
  assert.match(mapped.stops.monitor, /^Free workers run one at a time/);
  assert.deepEqual(mapped.firstTask, { title: "Document how to run the game", brief: "README lacks it. Check: README names the run command. Files: README.md Keep everything else unchanged." });
  const lines = adviceLines(mapped, { current: "create" });
  assert.deepEqual(lines.map((line) => [line.id, line.label, line.current]), [["connections", "Connections", false], ["create", "Create", true], ["monitor", "Monitor", false], ["review", "Review", false]]);
  assert.deepEqual(adviceLines(null), []);
});
