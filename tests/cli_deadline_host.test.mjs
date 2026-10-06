// Give-ups kill the child: a caller that stops waiting for a CLI text call
// before cli-text's own 180 s (the Jev stand-in, the Daily editor, the chat,
// the outside-work check) hands its deadline down, so cli-text kills the CLI's
// process tree then. main.cjs's cliAssistantCall, assistantFetch, seatFetch and
// the provider breaker run here in vms with a hand-turned clock and stubbed
// completions; nothing starts a CLI or reaches a provider.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import providerBreakers from "../scripts/provider-breaker.cjs";
import profiles from "../scripts/agent-profiles.cjs";
import * as choiceJudge from "../scripts/choice-judge.mjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const DATA_ONLY_CLIS = new Set(["claude", "codex", "grok", "antigravity"]);
const ROUTE = { ok: true, provider: "claude", model: "", cli: true };
const TIMED_OUT = "claude timed out. Check its sign-in and usage limit in Connections.";

test("the breaker's null outcome records nothing: the count stands and a probe's turn passes on", () => {
  let now = 0;
  const breaker = providerBreakers.createBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, now: () => now });
  breaker.enter("claude").settle(false);
  breaker.enter("claude").settle(null);
  assert.equal(breaker.state("claude"), "closed");
  assert.equal(breaker.snapshot().claude.failures, 1, "the abandoned call is not a failure");
  breaker.enter("claude").settle(false);
  assert.equal(breaker.state("claude"), "open", "two real failures still pause the route");
  now = 1000;
  const probe = breaker.enter("claude");
  assert.equal(probe.reason, "half-open");
  assert.equal(breaker.enter("claude").allowed, false, "one probe at a time");
  probe.settle(null);
  assert.equal(breaker.state("claude"), "half-open", "an abandoned probe neither closes nor re-opens the circuit");
  const next = breaker.enter("claude");
  assert.equal(next.allowed, true, "the next call takes the probe's turn");
  assert.equal(next.reason, "half-open");
});

// cliAssistantCall with the real breaker, over a stubbed completion. The
// completion stands in for cli-text: it moves the clock by however long the
// CLI ran (its own timeoutMs when it is killed).
function cliHost({ completion, fallback = false, turn = null } = {}) {
  let now = 1_000_000;
  const calls = [], ledger = [], logs = [], http = [];
  const context = vm.createContext({
    crypto,
    Date: class extends Date { static now() { return now; } },
    createBreaker: providerBreakers.createBreaker,
    AUTO_PROVIDER_NAMES: { claude: "Claude Code CLI", zai: "z.ai GLM" },
    logLine: (line) => logs.push(line),
    projects: { current: () => ({ id: "p" }), active: () => ({ id: "p" }) },
    assistantState: { ai: {} },
    recordModelCall: async (row) => { ledger.push(row); },
    readSettings: async () => ({ aiAutoFallback: fallback }),
    autoFallbackEnabled: (settings) => settings.aiAutoFallback === true,
    resolveAiRoute: async () => ({ ok: true, provider: "zai", endpoint: "https://zai.invalid", apiKey: "k", model: "glm" }),
    httpAssistantCall: async (...args) => { http.push(args); return { ok: true, text: "keyed answer", model: "glm" }; },
    claudeCompletion: async (_system, _user, _model, options) => { calls.push(options); return completion(options, (ms) => { now += ms; }); },
    ...(turn ? { cliAccountTurn: turn } : {}),
  });
  vm.runInContext([
    section("async function cliAssistantCall(", "// The HTTP half of assistantFetch"),
    section("// Circuit breakers for the host's own model calls", "function normalizeBriefing("),
  ].join("\n"), context);
  return { context, calls, ledger, logs, http, state: () => vm.runInContext("providerBreaker.state('claude')", context) };
}

test("a caller's deadline reaches the CLI, and a CLI stopped there is neither a failure nor retried", async () => {
  const onSpawn = () => {};
  const h = cliHost({ fallback: true, completion: (options, advance) => { advance(options.timeoutMs); return { ok: false, error: TIMED_OUT }; } });
  for (let index = 0; index < 4; index += 1) {
    const reply = await h.context.cliAssistantCall(ROUTE, "system", "user", 600, { taskType: "judge", timeoutMs: 15000, onSpawn });
    assert.equal(reply.ok, false);
    assert.equal(reply.abandoned, true);
    assert.equal(reply.error, "claude timed out after 15 s, when its caller stopped waiting");
  }
  assert.deepEqual(h.calls.map((options) => options.timeoutMs), [15000, 15000, 15000, 15000], "cli-text kills the CLI at the caller's deadline");
  assert.ok(h.calls.every((options) => options.onSpawn === onSpawn), "the caller hears each child");
  assert.equal(h.state(), "closed", "four abandoned calls pause nothing: a slow answer is not an outage");
  assert.deepEqual(h.ledger.map((row) => [row.status, row.errorKind, row.taskType]), Array(4).fill(["cancelled", null, "judge"]), "kept in the ledger as cancelled, not as errors");
  assert.equal(h.http.length, 0, "no keyed retry for a caller that is gone");
});

test("with no deadline a CLI keeps cli-text's own limit and a timeout still counts against the route", async () => {
  const h = cliHost({ completion: (_options, advance) => { advance(180000); return { ok: false, error: TIMED_OUT }; } });
  for (let index = 0; index < 3; index += 1) {
    const reply = await h.context.cliAssistantCall(ROUTE, "system", "user", 600, { taskType: "planning-spec" });
    assert.equal(reply.error, TIMED_OUT);
    assert.equal(reply.abandoned, undefined);
  }
  assert.ok(h.calls.every((options) => !("timeoutMs" in options)), "cli-text's 180 s default applies");
  assert.equal(h.state(), "open");
  assert.ok(h.logs.some((line) => line.startsWith("[assistant] Claude Code CLI paused for 30s after 3 failures in a row")), h.logs.join("\n"));
  assert.deepEqual(h.ledger.map((row) => row.status), ["error", "error", "error"]);
});

test("a quick failure under a deadline is the CLI's own and may still fall back", async () => {
  const h = cliHost({ fallback: true, completion: (_options, advance) => { advance(2000); return { ok: false, error: "claude cli failed (exit 1): Not logged in" }; } });
  const reply = await h.context.cliAssistantCall(ROUTE, "system", "user", 600, { taskType: "conversation", timeoutMs: 15000 });
  assert.equal(reply.text, "keyed answer");
  assert.equal(h.http.length, 1);
  assert.deepEqual(plain(h.ledger.map((row) => [row.status, row.errorKind])), [["error", "cli"]]);
});

test("each login gets what is left of the deadline, and none is started with under a second left", async () => {
  // cliAccountTurn's contract: the next login is asked when one reports its usage limit.
  const turn = async (_provider, call) => {
    const first = await call({});
    return first.ok || !/limit/.test(first.error) ? first : call({ env: { CLAUDE_CONFIG_DIR: "C:/logins/work" } });
  };
  const limit = "claude error: You've hit your limit · resets 3pm (UTC)";
  const h = cliHost({ turn, completion: (options, advance) => {
    if (!options.env) { advance(4000); return { ok: false, error: limit }; }
    return { ok: true, text: "answered on Work", model: "claude" };
  } });
  const reply = await h.context.cliAssistantCall(ROUTE, "system", "user", 600, { taskType: "judge", timeoutMs: 15000 });
  assert.equal(reply.text, "answered on Work");
  assert.deepEqual(h.calls.map((options) => options.timeoutMs), [15000, 11000]);
  assert.equal(h.calls[1].env.CLAUDE_CONFIG_DIR, "C:/logins/work");
  const late = cliHost({ turn, completion: (_options, advance) => { advance(14500); return { ok: false, error: limit }; } });
  const gone = await late.context.cliAssistantCall(ROUTE, "system", "user", 600, { taskType: "judge", timeoutMs: 15000 });
  assert.equal(gone.abandoned, true);
  assert.equal(gone.error, "claude was not started: its caller had stopped waiting");
  assert.equal(late.calls.length, 1, "the second login was never started");
  assert.equal(late.state(), "closed");
});

// assistantFetch over stubbed halves, with a tool loop that takes two turns.
function fetchHost(route, { rounds = 1 } = {}) {
  let now = 5_000_000, inside = false;
  const cli = [], http = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    DATA_ONLY_CLIS, scrubOutbound: (text) => text, logLine() {}, projectRoot: () => "/fixture", readAgentSettings: async () => ({}),
    agentTools: { active: { getStore: () => inside }, run: async ({ call }) => {
      inside = true;
      try { let reply; for (let index = 0; index < rounds; index += 1) { if (index) now += 6000; reply = await call("system", "user"); } return reply; } finally { inside = false; }
    } },
    resolveAiRoute: async () => route,
    cliAssistantCall: async (...args) => { cli.push(args); now += 5000; return { ok: true, text: "cli" }; },
    httpAssistantCall: async (...args) => { http.push(args); return { ok: true, text: "http" }; },
  });
  vm.runInContext(section("async function assistantFetch(", "// The CLI half of assistantFetch"), context);
  return { context, cli, http };
}

test("assistantFetch keeps one deadline across the tool loop's turns, for a CLI route only", async () => {
  const looped = fetchHost(ROUTE, { rounds: 2 });
  await looped.context.assistantFetch("system", "user", 600, { role: "routine", taskType: "judge", timeoutMs: 15000 });
  assert.deepEqual(looped.cli.map((args) => args[4].timeoutMs), [15000, 4000], "the second turn gets what the first left");
  const keyed = fetchHost({ ok: true, provider: "zai", endpoint: "https://zai.invalid", apiKey: "k", model: "glm" });
  await keyed.context.assistantFetch("system", "user", 600, { timeoutMs: 15000 });
  assert.equal("timeoutMs" in keyed.http[0][4], false, "an HTTP route keeps its own abort");
  const open = fetchHost(ROUTE);
  await open.context.assistantFetch("system", "user", 600, { role: "heavy" });
  assert.equal(open.cli[0][4].timeoutMs, null, "no deadline unless the caller has one");
});

// seatFetch's choices, with the model halves stubbed.
function seatHost(seat) {
  const settings = { agentSeats: { companion: { model: "", effort: "", fast: false, ...seat } } };
  const cli = [], http = [], fetched = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return 9_000_000; } },
    ZEN_MODEL_HEAVY: "gpt-6.1-sol", ZEN_MODEL_ROUTINE: "gpt-6-luna",
    agentProfiles: profiles, projects: { current: () => ({ id: "project" }) },
    readSettings: async () => settings, readAgentSettings: async () => profiles.effective(settings, "project", profiles.current()),
    DATA_ONLY_CLIS, scrubOutbound: (text) => text, decryptKey: () => null,
    resolveAiRoute: async () => { const provider = profiles.current().configuration.aiRoleProviders.heavy; return { ok: true, provider, model: "", cli: DATA_ONLY_CLIS.has(provider) }; },
    cliAssistantCall: async (...args) => { cli.push(args); return { ok: true }; },
    httpAssistantCall: async (...args) => { http.push(args); return { ok: true }; },
    assistantFetch: async (...args) => { fetched.push(args); return { ok: true }; },
  });
  vm.runInContext(section("const SEAT_DEFAULTS", "// ---- the Policy Lab's observation-only recorder"), context);
  return { context, cli, http, fetched };
}

test("seatFetch hands a caller's CLI deadline to a seat on a CLI and leaves HTTP seats their own limit", async () => {
  const onCli = seatHost({ provider: "claude" });
  await onCli.context.seatFetch("companion", "system", "message", 1500, { cliTimeoutMs: 90000 });
  assert.equal(onCli.cli[0][4].timeoutMs, 90000);
  assert.equal(onCli.cli[0][4].taskType, "seat-companion");
  await onCli.context.seatFetch("companion", "system", "message", 1500);
  assert.equal(onCli.cli[1][4].timeoutMs, null, "a seat call with no deadline keeps cli-text's own");
  const keyed = seatHost({ provider: "openrouter" });
  await keyed.context.seatFetch("companion", "system", "message", 1500, { cliTimeoutMs: 90000 });
  assert.equal(keyed.http[0][4].timeoutMs, 120000, "an HTTP seat keeps its per-call limit");
  const auto = seatHost({ provider: "auto" });
  await auto.context.seatFetch("companion", "system", "message", 1500, { cliTimeoutMs: 90000 });
  assert.equal(auto.fetched[0][3].timeoutMs, 90000, "an auto seat on the heavy route carries it to assistantFetch");
});

test("the Jev stand-in hands the judge's own limit to the assistant call", async () => {
  const calls = [];
  const context = vm.createContext({
    loadModule: async (name) => { assert.equal(name, "scripts/choice-judge.mjs"); return choiceJudge; },
    assistantFetch: async (_system, _user, _maxTokens, options) => { calls.push(options); return { ok: true, text: JSON.stringify({ answers: { same: { choice: "yes" } } }), model: "claude" }; },
  });
  vm.runInContext(section("async function standInJudge(", "async function applyModelRouting("), context);
  for (const [purpose, ms] of [["intake", 15000], ["routing", 4000]]) {
    const judge = await context.standInJudge({ firstRun: { judge: { kind: "assistant" } } }, purpose);
    const result = await judge.classify({ questions: [{ id: "same", type: "choice", prompt: "Is the new request the same work as the open card?", options: ["yes", "no"] }], state: { request: "Fix the scheduler" } });
    assert.equal(result.ok, true, purpose);
    assert.equal(calls.at(-1).timeoutMs, ms, `${purpose}: the judge's ${ms} ms reaches the call`);
    assert.equal(calls.at(-1).taskType, "judge");
  }
});

test("the Daily editor's deadline stops a CLI editor, and an HTTP editor keeps its own abort", async () => {
  const text = section("    edit: async (system, user, { timeoutMs = null } = {}) => {", "    extraItems: () => dailyNewsStudioItems(),").trim().replace(/^edit: /, "").replace(/,$/, "");
  let route = ROUTE;
  const cli = [], http = [], active = [];
  const context = vm.createContext({
    Date: class extends Date { static now() { return 7_000_000; } },
    DATA_ONLY_CLIS,
    resolveAiRoute: async (role, options) => { assert.equal(role, "routine"); assert.equal(options.allowCli, DATA_ONLY_CLIS); return route; },
    cliAssistantCall: async (...args) => { cli.push(args); return { ok: true, text: "edited" }; },
    httpAssistantCall: async (...args) => { http.push(args); return { ok: true, text: "edited" }; },
    agentTools: { active: { run: (store, fn) => { active.push(store); return fn(); } } },
  });
  const edit = vm.runInContext(`(${text})`, context);
  assert.equal(await edit("system", "headlines", { timeoutMs: 60000 }), "edited");
  assert.equal(cli[0][4].timeoutMs, 60000);
  assert.equal(cli[0][4].taskType, "daily-news");
  assert.deepEqual(active, [true], "still no Studio tools for untrusted headlines");
  route = { ok: true, provider: "zai", endpoint: "https://zai.invalid", apiKey: "k", model: "glm" };
  await edit("system", "headlines", { timeoutMs: 60000 });
  assert.equal("timeoutMs" in http[0][4], false);
});

test("the chat and the outside-work check hand their limits down too", () => {
  const chat = section("async function assistantOverseerTurn(", "  // A picture on the message rides a scope");
  assert.match(chat, /seatFetch\("companion", chatSystem, body, 1500, \{ fallback: \(system = chatSystem, _fromSeat = false, input = body\) => assistantFetch\(system, input, 1500, \{ taskType: "conversation", allowCli: DATA_ONLY_CLIS, skillRole: null, timeoutMs: budgetMs \}\), cliTimeoutMs: budgetMs \}\)/, "the companion's fallback keeps the tool transcript (input) and the reply budget");
  assert.match(chat, /: assistantFetch\(chatSystem, body, 1500, \{ taskType: "conversation", allowCli: DATA_ONLY_CLIS, timeoutMs: budgetMs \}\)/);
  assert.match(source, /assistantFetch\(prompt\.system, prompt\.user, 1500, \{ taskType: "relevance", allowCli: DATA_ONLY_CLIS, skillRole: null, timeoutMs: OUTSIDE_CHECK_TIMEOUT_MS \}\)/);
  assert.match(source, /setTimeout\(\(\) => resolve\(\{ ok: false, timedOut: true \}\), OUTSIDE_CHECK_TIMEOUT_MS\)/, "the same limit the check races");
});
