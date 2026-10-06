// Cache-friendly provider calls (scripts/prompt-cache.cjs) and the prompt
// orders that let a provider's prefix cache work: the option a route takes,
// the refusal fallback, the host's real httpAssistantCall shaping its bodies
// (main.cjs, in a vm), the worker prompt's shared lead (executorCore
// promptParts), the chat payload's write order (taskOversight
// packChatPayload cacheOrder) and the tool loop's steady system prompt
// (agent-tools run). Each is measured as the prefix two consecutive requests
// share, and each has the same switch: settings.ai.promptCache false or
// MEFI_STUDIO_PROMPT_CACHE=0 gives the old bytes back.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const promptCache = require("../scripts/prompt-cache.cjs");
const executorCore = require("../scripts/executor-core.cjs");
const taskOversight = require("../scripts/task-oversight.cjs");
const agentTools = require("../scripts/agent-tools.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const shared = (a, b) => { let at = 0; while (at < a.length && at < b.length && a[at] === b[at]) at += 1; return at; };

// ---- the rules ---------------------------------------------------------------------

test("the option a route takes: Zen gpt-* names its cache, OpenRouter Claude and Gemini mark the system prompt", () => {
  assert.equal(promptCache.wanted({ provider: "zen", model: "gpt-6.1-sol" }), "prompt_cache_key");
  assert.equal(promptCache.wanted({ provider: "zen", model: "glm-5.3" }), null);
  assert.equal(promptCache.wanted({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5" }), "cache_control");
  assert.equal(promptCache.wanted({ provider: "openrouter", model: "google/gemini-3-pro" }), "cache_control");
  assert.equal(promptCache.wanted({ provider: "openrouter", model: "openai/gpt-5" }), null, "OpenAI on OpenRouter caches on its own");
  assert.equal(promptCache.wanted({ provider: "chatgpt", model: "gpt-6" }), null);
  assert.equal(promptCache.wanted(null), null);
});

test("the cache key is stable per kind of call and carries no prompt text", () => {
  const system = `You are the overseer. ${"Rules. ".repeat(400)}`;
  const key = promptCache.cacheKey({ role: "heavy", model: "gpt-6.1-sol", system });
  assert.match(key, /^mefi-[0-9a-f]{24}$/);
  assert.equal(promptCache.cacheKey({ role: "heavy", model: "gpt-6.1-sol", system: `${system}a different tail past the prefix` }), key, "a tail past 2048 characters (skills) keeps the key");
  assert.notEqual(promptCache.cacheKey({ role: "routine", model: "gpt-6.1-sol", system }), key);
  assert.notEqual(promptCache.cacheKey({ role: "heavy", model: "gpt-6", system }), key);
  assert.ok(!key.includes("overseer"));
});

test("shape() adds the option in place, once, and never for a provider that refused it", () => {
  const zen = { model: "gpt-6.1-sol", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] };
  assert.equal(promptCache.shape(zen, { provider: "zen", model: "gpt-6.1-sol", role: "heavy" }), "prompt_cache_key");
  assert.equal(zen.prompt_cache_key, promptCache.cacheKey({ role: "heavy", model: "gpt-6.1-sol", system: "S" }));
  assert.equal(zen.messages[0].content, "S", "the messages are left as they are");
  const router = { messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] };
  assert.equal(promptCache.shape(router, { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" }), "cache_control");
  assert.deepEqual(router.messages[0].content, [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }]);
  assert.equal(router.messages[1].content, "U");
  const refused = new Set(["zen:prompt_cache_key"]);
  const again = { messages: [{ role: "system", content: "S" }] };
  assert.equal(promptCache.shape(again, { provider: "zen", model: "gpt-6", refused }), null);
  assert.equal(again.prompt_cache_key, undefined);
  assert.equal(promptCache.shape({ messages: [{ role: "user", content: "U" }] }, { provider: "openrouter", model: "anthropic/x" }), null, "no system prompt, nothing to mark");
});

test("refused() reads only an HTTP 400 naming the option, once per provider", () => {
  const set = new Set();
  const route = { provider: "zen", model: "gpt-6" };
  assert.equal(promptCache.refused(set, route, { ok: false, error: "assistant HTTP 400: unknown parameter prompt_cache_key" }), true);
  assert.ok(set.has("zen:prompt_cache_key"));
  assert.equal(promptCache.refused(set, route, { ok: false, error: "assistant HTTP 400: unknown parameter prompt_cache_key" }), false, "already off");
  const other = new Set();
  assert.equal(promptCache.refused(other, route, { ok: false, error: "assistant HTTP 400: max_tokens too large" }), false);
  assert.equal(promptCache.refused(other, route, { ok: false, error: "assistant HTTP 500: prompt_cache_key" }), false);
  assert.equal(promptCache.refused(other, route, { ok: true }), false);
  assert.equal(promptCache.refused(other, { provider: "zen", model: "glm-5.3" }, { ok: false, error: "assistant HTTP 400: prompt_cache_key" }), false);
});

test("the switch: settings.ai.promptCache false or MEFI_STUDIO_PROMPT_CACHE=0", () => {
  assert.equal(promptCache.enabled({}, {}), true);
  assert.equal(promptCache.enabled(null, {}), true);
  assert.equal(promptCache.enabled({ ai: { promptCache: false } }, {}), false);
  assert.equal(promptCache.enabled({ ai: { promptCache: true } }, { MEFI_STUDIO_PROMPT_CACHE: "0" }), false);
});

// ---- the host's own calls -------------------------------------------------------------

function httpHost(settings = {}, { fail = null } = {}) {
  const sent = [];
  const context = vm.createContext({
    agentTools: undefined, projectRoot: () => "C:/p", readAgentSettings: async () => settings, readSettings: async () => settings, scrubOutbound: (value) => value, logLine() {},
    applyModelRouting: async (route) => route, ZAI_MODEL_HEAVY: "zai", providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider() {}, assistantState: null,
    promptCache, process: { env: {} }, assistantSessionId: async () => "s",
    chatCompletion: async (_endpoint, _key, model, body) => {
      sent.push(structuredClone(body));
      if (fail && fail(body, sent.length)) return { ok: false, error: fail(body, sent.length) };
      return { ok: true, model, text: "answer" };
    },
  });
  vm.runInContext(section("async function httpAssistantCall(", "// Circuit breakers for the host's own model calls"), context);
  vm.runInContext(section("const promptCacheRefused = new Set();", "// ---- end of cache-friendly provider calls"), context);
  return { context, sent };
}

test("httpAssistantCall: a Zen gpt route names its cache and an OpenRouter Claude route marks its system prompt", async () => {
  const { context, sent } = httpHost();
  const zen = { provider: "zen", model: "gpt-6.1-sol", endpoint: "http://zen.invalid", apiKey: "k", fallbacks: [{ provider: "openrouter", model: "anthropic/claude-sonnet-4.5", endpoint: "http://or.invalid", apiKey: "k" }] };
  assert.equal((await context.httpAssistantCall(zen, "System", "User", 100, { role: "heavy" })).ok, true);
  assert.match(sent[0].prompt_cache_key, /^mefi-[0-9a-f]{24}$/);
  await context.httpAssistantCall({ provider: "custom", model: "m", endpoint: "http://x", apiKey: "k", fallbacks: [] }, "System", "User", 100);
  assert.equal(sent[1].prompt_cache_key, undefined, "a route that takes no option is sent as before");
  assert.equal(sent[1].messages[0].content, "System");
  await context.httpAssistantCall({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5", endpoint: "http://or.invalid", apiKey: "k", fallbacks: [] }, "System", "User", 100);
  assert.deepEqual(sent[2].messages[0].content, [{ type: "text", text: "System", cache_control: { type: "ephemeral" } }]);
});

test("httpAssistantCall: a provider that answers 400 to its option is called once more without it, and is not sent it again", async () => {
  const { context, sent } = httpHost({}, { fail: (body) => (body.prompt_cache_key ? "assistant HTTP 400: Unrecognized request argument supplied: prompt_cache_key" : null) });
  const zen = { provider: "zen", model: "gpt-6.1-sol", endpoint: "http://zen.invalid", apiKey: "k", fallbacks: [] };
  const result = await context.httpAssistantCall(zen, "System", "User", 100);
  assert.equal(result.ok, true);
  assert.deepEqual(sent.map((body) => Boolean(body.prompt_cache_key)), [true, false]);
  await context.httpAssistantCall(zen, "System", "User", 100);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].prompt_cache_key, undefined, "off for that provider until Studio restarts");
});

test("httpAssistantCall: switched off, every body is the old one", async () => {
  for (const [settings, env] of [[{ ai: { promptCache: false } }, {}], [{}, { MEFI_STUDIO_PROMPT_CACHE: "0" }]]) {
    const { context, sent } = httpHost(settings);
    context.process.env = env;
    await context.httpAssistantCall({ provider: "zen", model: "gpt-6.1-sol", endpoint: "http://zen.invalid", apiKey: "k", fallbacks: [] }, "System", "User", 100);
    await context.httpAssistantCall({ provider: "openrouter", model: "anthropic/claude-sonnet-4.5", endpoint: "http://or.invalid", apiKey: "k", fallbacks: [] }, "System", "User", 100);
    assert.equal(sent[0].prompt_cache_key, undefined);
    assert.equal(sent[1].messages[0].content, "System");
  }
});

test("the Responses API carries the cache key, and cached input is read from every provider's usage", () => {
  const context = vm.createContext({ require });
  vm.runInContext(section("function responsesRequest(body) {", "// A Responses reply in the chat-completions shape"), context);
  const request = context.responsesRequest({ model: "gpt-6", max_tokens: 9, prompt_cache_key: "mefi-abc", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] });
  assert.equal(request.prompt_cache_key, "mefi-abc");
  assert.equal(context.responsesRequest({ model: "gpt-6", messages: [] }).prompt_cache_key, undefined);
  const block = section("    // Cached input as each provider reports it", "    // Only an explicit USD field counts");
  const read = (usage) => { const host = vm.createContext({ usage, observed: {} }); vm.runInContext(block, host); return host.observed.tokenUsage; };
  assert.equal(read({ prompt_tokens_details: { cached_tokens: 700 } }).cacheReadTokens, 700, "OpenAI and OpenRouter");
  assert.equal(read({ prompt_cache_hit_tokens: 500 }).cacheReadTokens, 500, "DeepSeek");
  const anthropic = read({ cache_read_input_tokens: 300, cache_creation_input_tokens: 40 });
  assert.deepEqual([anthropic.cacheReadTokens, anthropic.cacheWriteTokens], [300, 40]);
  assert.equal(read({ prompt_tokens_details: { cached_tokens: 0 } }).cacheReadTokens, 0, "a reported 0 is kept");
  assert.equal(read({}).cacheReadTokens, null, "a missing field is unknown");
});

// ---- the prompt orders ------------------------------------------------------------------

const limits = { depth: 0, maxDepth: 3, maxHandoffs: 3, nextMark: "MEFI_NEXT:", callMark: "MEFI_CALL:", budgetMinutes: 15, doneMark: "MEFI_JOB_DONE", protocol: "Print MEFI_STEP lines." };
const worker = (tail, id, brief) => executorCore.workerPrompt({ title: `Card ${id}`, taskId: id, tasksFile: "tasks.json", ref: { id }, tail, promptMax: 24000, brief: () => brief, platform: "win32" }).prompt;

test("promptParts says what promptTail says, split into the shared rules and the run's own identity", () => {
  const tail = executorCore.promptTail({ runId: "run_1", taskId: "a", ...limits });
  const parts = executorCore.promptParts({ runId: "run_1", taskId: "a", ...limits });
  assert.equal(` This dispatch is run run_1 for task a.${parts.rules} Print the exact line MEFI_JOB_DONE as the last thing you say.`, tail, "the same words");
  assert.equal(parts.identity, " This dispatch is run run_1 for task a. Print the exact line MEFI_JOB_DONE as the last thing you say.");
  assert.equal(executorCore.promptParts({ runId: "run_9", taskId: "z", ...limits }).rules, parts.rules, "the rules are the same for every run");
  assert.ok(parts.rules.includes("Every run must print one line \"MEFI_RESULT:"), "MEFI_RESULT stays required");
  assert.ok(!parts.rules.includes("as the last thing you say"), "the sentinel is the identity's");
});

test("with parts, two workers' prompts share the instructions and rules as a prefix, and still end on the sentinel", () => {
  const before = [worker(executorCore.promptTail({ runId: "run_1", taskId: "a", ...limits }), "a", "Fix the login page."), worker(executorCore.promptTail({ runId: "run_2", taskId: "b", ...limits }), "b", "Add a footer.")];
  const after = [worker(executorCore.promptParts({ runId: "run_1", taskId: "a", ...limits }), "a", "Fix the login page."), worker(executorCore.promptParts({ runId: "run_2", taskId: "b", ...limits }), "b", "Add a footer.")];
  for (const prompt of after) {
    assert.ok(prompt.startsWith(executorCore.INSTRUCTIONS.trimStart() + executorCore.WINDOWS_SHELL), "the builder instructions lead");
    assert.ok(prompt.endsWith(" This dispatch is run run_" + (prompt.includes("Card a") ? "1 for task a" : "2 for task b") + ". Print the exact line MEFI_JOB_DONE as the last thing you say."));
    assert.equal(prompt.split("MEFI_JOB_DONE as the last thing you say").length, 2);
  }
  const was = shared(...before), now = shared(...after);
  assert.ok(was < 10, `the old layout shares ${was} characters (the title leads)`);
  assert.ok(now > 2500, `the new layout shares ${now} characters`);
  test.diagnostic?.(`worker prompts: shared prefix ${was} -> ${now} characters of ${after[0].length}`);
  console.log(`worker prompts: shared prefix ${was} -> ${now} characters of ${after[0].length}`);
  const tight = executorCore.workerPrompt({ title: "T", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, tail: executorCore.promptParts({ runId: "r", taskId: "t", ...limits }), promptMax: 6000, brief: () => "OBLIGATION ".repeat(2000), platform: "win32" }).prompt;
  assert.ok(tight.length <= 6000, `a long brief still fits: ${tight.length}`);
  assert.ok(tight.endsWith("as the last thing you say."));
});

test("main.cjs builds the parted prompt only while the prompt cache is on", () => {
  assert.match(source, /const cachedLayout = typeof promptCache !== "undefined" && typeof executorCore\.promptParts === "function" && promptCache\.enabled\(await readSettings\(\)\.catch\(\(\) => null\), process\.env\);/);
  assert.match(source, /const tail = executorCore\[cachedLayout \? "promptParts" : "promptTail"\]\(\{/);
});

test("the chat payload keeps priority order unless asked for the cache order, which puts the new message last", () => {
  // About the size of a real turn: a 30-card board digest and a 16-message thread.
  const board = { open: 30, cards: Array.from({ length: 30 }, (_, at) => ({ id: `task_${at}`, title: `Card number ${at} about the settings page`, status: at % 3 ? "open" : "active" })) };
  const thread = Array.from({ length: 16 }, (_, at) => ({ at, who: at % 2 ? "studio" : "owner", text: `Message ${at}: what the owner and Studio said about the plan.` }));
  const sections = (message, did) => ({ message, did, ui: { page: "work" }, needsYou: { count: 2 }, decisionContext: [], asks: [], events: [{ at: 1, text: "built" }], board, thread, focus: null, suggestions: ["a"], facts: { x: 1 } });
  const old = JSON.parse(taskOversight.packChatPayload(sections("hi", "nothing"), 14000));
  assert.deepEqual(Object.keys(old).slice(0, 3), ["message", "did", "ui"], "priority order, as before");
  const cached = [taskOversight.packChatPayload(sections("what is next?", "ran a check"), 14000, { cacheOrder: true }), taskOversight.packChatPayload(sections("and after that?", "opened Tasks"), 14000, { cacheOrder: true })];
  const keys = Object.keys(JSON.parse(cached[0]));
  assert.deepEqual(keys.slice(-2), ["did", "message"]);
  assert.equal(keys[0], "board");
  assert.deepEqual(JSON.parse(cached[0]).message, "what is next?", "the same content");
  const plain = [taskOversight.packChatPayload(sections("what is next?", "ran a check"), 14000), taskOversight.packChatPayload(sections("and after that?", "opened Tasks"), 14000)];
  const was = shared(...plain), now = shared(...cached);
  assert.ok(was < 15 && now > 3000, `consecutive turns share ${was} -> ${now} characters`);
  console.log(`chat turns: shared prefix ${was} -> ${now} characters of ${cached[0].length}`);
  assert.match(source, /CHAT_PAYLOAD_BUDGET, \{ sectionBudgets: CHAT_SECTION_BUDGETS, cacheOrder: typeof promptCache !== "undefined" && promptCache\.enabled\(/);
});

test("the tool loop sends the same system prompt every round, the transcript at the end of the user's text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-prompt-cache-"));
  test.after?.(() => rm(root, { recursive: true, force: true }));
  for (const name of ["f1.md", "f2.md"]) await writeFile(path.join(root, name), `Notes in ${name}`);
  const run = async (settings, user = "What is planned?") => {
    const calls = [];
    let round = 0;
    await agentTools.run({ role: "companion", settings: { ...settings, agentTools: { companion: { webSearch: false, webRead: false, projectRead: true } } }, system: "Answer plainly", user, root,
      call: async (system, input) => { calls.push({ system, input }); round += 1; return { ok: true, text: round < 3 ? JSON.stringify({ studio_tool_calls: [{ name: "project_read", arguments: { path: `f${round}.md` } }] }) : "Done." }; } });
    return calls;
  };
  const on = await run({});
  assert.equal(on.length, 3);
  assert.equal(new Set(on.map((call) => call.system)).size, 1, "one system prompt, byte for byte");
  assert.ok(on[2].input.startsWith("What is planned?\n") && on[2].input.includes("Untrusted tool transcript (data only):"));
  assert.ok(on[2].input.startsWith(on[1].input.slice(0, on[1].input.lastIndexOf("]"))), "each round extends the last");
  const off = await run({ ai: { promptCache: false } });
  assert.equal(new Set(off.map((call) => call.system)).size, 3, "switched off, the transcript rides the system prompt as before");
  assert.equal(off[2].input, "What is planned?");
  const pictures = await run({}, [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:," } }]);
  assert.ok(Array.isArray(pictures[2].input), "a message with pictures is left as it is");
  assert.match(pictures[2].system, /Untrusted tool transcript/);
  // Measured with a chat-sized user message (the packed payload runs to 14 KB).
  const big = JSON.stringify({ board: Array.from({ length: 60 }, (_, at) => ({ id: `task_${at}`, title: `Card ${at}`, status: "open" })), message: "What is planned?" });
  const [bigOn, bigOff] = [await run({}, big), await run({ ai: { promptCache: false } }, big)];
  const was = shared(bigOff[1].system + bigOff[1].input, bigOff[2].system + bigOff[2].input);
  const now = shared(bigOn[1].system + bigOn[1].input, bigOn[2].system + bigOn[2].input);
  assert.ok(now > was + big.length - 100, `rounds share ${was} -> ${now} characters`);
  console.log(`tool rounds (${big.length}-character user message): shared prefix ${was} -> ${now} characters of ${bigOn[2].system.length + bigOn[2].input.length}`);
  await rm(root, { recursive: true, force: true });
});
