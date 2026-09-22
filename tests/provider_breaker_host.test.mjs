import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import providerBreakers from "../scripts/provider-breaker.cjs";

// The real host call path — assistantFetch, httpAssistantCall with its breaker
// helpers, and chatCompletion — run against a stubbed transport and a hand-
// turned clock. Nothing here reaches a provider, a key or a CLI.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}

const refused = () => ({ ok: false, status: 401, text: async () => '{"error":{"code":"401","message":"token expired or incorrect"}}' });
const answer = (content = "Fixture answer") => ({ ok: true, json: async () => ({ model: "reported", usage: {}, choices: [{ message: { content } }] }) });

const ZAI = "https://zai.invalid/chat";
const GO = "https://opencode.invalid/chat";
const zaiRoute = (fallbacks = []) => ({ ok: true, provider: "zai", endpoint: ZAI, apiKey: "zai-key", model: "glm-flash", fallbacks });
const goRoute = () => ({ provider: "opencode", endpoint: GO, apiKey: "go-key", model: "go-model" });

function host({ replies = {}, cliRoute = null } = {}) {
  let now = 1_000_000;
  const dialled = [], logs = [], spawned = [];
  const queues = Object.fromEntries(Object.entries(replies).map(([endpoint, list]) => [endpoint, [...list]]));
  const context = vm.createContext({
    crypto, AbortController, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    createBreaker: providerBreakers.createBreaker,
    AUTO_PROVIDER_NAMES: { zai: "z.ai GLM", opencode: "OpenCode Go", grok: "Grok CLI" },
    ZAI_MODEL_HEAVY: "glm-heavy",
    logLine: (line) => logs.push(line),
    projects: { current: () => ({ id: "p" }), active: () => ({ id: "p" }) },
    assistantState: { ai: {} },
    assistantSessionId: async () => "session",
    applyModelRouting: async (route) => route,
    recordModelCall: async () => {},
    scrubOutbound: (text) => text,
    fetch: async (endpoint) => {
      dialled.push(endpoint);
      const next = queues[endpoint]?.shift();
      assert.ok(next, `unexpected call to ${endpoint}`);
      return next();
    },
    // assistantFetch asks for the CLI route first and, when that fails or is
    // paused, for the keyed HTTP routes with allowCli: false.
    resolveAiRoute: async (_role, { allowCli = true } = {}) => (allowCli && cliRoute ? cliRoute : zaiRoute([goRoute()])),
    grokCompletion: async () => { spawned.push("grok"); return { ok: false, error: "grok cli timed out" }; },
    claudeCompletion: async () => assert.fail("not this CLI"),
    codexCompletion: async () => assert.fail("not this CLI"),
    antigravityCompletion: async () => assert.fail("not this CLI"),
  });
  vm.runInContext([
    section("async function chatCompletion(", "// The Grok CLI"),
    section("async function assistantFetch(", "// The HTTP half of assistantFetch"),
    section("async function httpAssistantCall(", "function normalizeBriefing("),
  ].join("\n"), context);
  return {
    context, dialled, logs, spawned,
    http: (route) => context.httpAssistantCall(route, "system", "user", 100, { taskType: "routine", role: "routine" }),
    fetchReply: () => context.assistantFetch("system", "user", 100, { role: "routine" }),
    advance: (ms) => { now += ms; },
    reset: () => vm.runInContext("providerBreaker.reset()", context),
  };
}

test("three refusals pause the primary and the fallback answers without dialling it", async () => {
  const h = host({ replies: { [ZAI]: [refused, refused, refused], [GO]: [answer, answer, answer, answer] } });
  for (let i = 0; i < 3; i += 1) assert.equal((await h.http(zaiRoute([goRoute()]))).ok, true, "the fallback answers each time");
  assert.deepEqual(h.dialled, [ZAI, GO, ZAI, GO, ZAI, GO]);
  assert.ok(h.logs.some((line) => /z\.ai GLM paused for 30s after 3 failures in a row: assistant HTTP 401/.test(line)), h.logs.join("\n"));

  h.dialled.length = 0;
  const reply = await h.http(zaiRoute([goRoute()]));
  assert.equal(reply.ok, true);
  assert.deepEqual(h.dialled, [GO], "a paused route is not re-dialled");
});

test("with nowhere to fall back, a paused route fails fast and says why", async () => {
  const h = host({ replies: { [ZAI]: [refused, refused, refused] } });
  for (let i = 0; i < 3; i += 1) await h.http(zaiRoute());
  h.dialled.length = 0;
  const reply = await h.http(zaiRoute());
  assert.equal(reply.ok, false);
  assert.equal(reply.skipped, true);
  assert.equal(reply.errorKind, "paused");
  assert.match(reply.error, /^z\.ai GLM paused after repeated failures, retrying in 30s \(last failure: assistant HTTP 401/);
  assert.deepEqual(h.dialled, [], "nothing was sent");
});

test("an unusable reply proves the route alive and never pauses it", async () => {
  const empty = () => answer("");
  const h = host({ replies: { [ZAI]: [empty, empty, empty, empty, answer] } });
  for (let i = 0; i < 4; i += 1) assert.equal((await h.http(zaiRoute())).errorKind, "validation");
  assert.equal((await h.http(zaiRoute())).ok, true, "still dialled after four empty replies");
  assert.equal(h.dialled.length, 5);
});

test("after the pause one probe goes through and a success resumes the route", async () => {
  const h = host({ replies: { [ZAI]: [refused, refused, refused, answer, answer] } });
  for (let i = 0; i < 3; i += 1) await h.http(zaiRoute());

  h.advance(29_999);
  assert.equal((await h.http(zaiRoute())).skipped, true, "still paused a millisecond early");

  h.advance(1);
  const probe = await h.http(zaiRoute());
  assert.equal(probe.ok, true);
  assert.ok(h.logs.includes("[assistant] z.ai GLM answering again"), h.logs.join("\n"));
  assert.equal((await h.http(zaiRoute())).ok, true);
});

test("a route that keeps failing its probes is paused again", async () => {
  const h = host({ replies: { [ZAI]: [refused, refused, refused, refused, refused] } });
  for (let i = 0; i < 3; i += 1) await h.http(zaiRoute());
  h.advance(30_000);
  assert.equal((await h.http(zaiRoute())).skipped, undefined, "the first probe is dialled");
  assert.equal((await h.http(zaiRoute())).skipped, undefined, "one failed probe is tolerated");
  assert.equal((await h.http(zaiRoute())).skipped, true, "the second failed probe pauses it again");
  assert.ok(h.logs.some((line) => line.startsWith("[assistant] z.ai GLM still failing, paused for another 30s")), h.logs.join("\n"));
});

test("a reset — a saved key or routing change — lifts the pause at once", async () => {
  const h = host({ replies: { [ZAI]: [refused, refused, refused, answer] } });
  for (let i = 0; i < 3; i += 1) await h.http(zaiRoute());
  assert.equal((await h.http(zaiRoute())).skipped, true);
  h.reset();
  assert.equal((await h.http(zaiRoute())).ok, true, "tried immediately after the reset");
});

test("a paused CLI route is not spawned and the keyed fallback answers", async () => {
  const cliRoute = { ok: true, cli: true, provider: "grok", model: "grok-model" };
  const h = host({ cliRoute, replies: { [ZAI]: [answer, answer, answer, answer] } });
  for (let i = 0; i < 3; i += 1) assert.equal((await h.fetchReply()).ok, true, "HTTP answers each failed CLI turn");
  assert.equal(h.spawned.length, 3);
  assert.ok(h.logs.some((line) => line.startsWith("[assistant] Grok CLI paused for 30s")), h.logs.join("\n"));

  const reply = await h.fetchReply();
  assert.equal(reply.ok, true);
  assert.equal(h.spawned.length, 3, "the paused CLI was not spawned a fourth time");
});
