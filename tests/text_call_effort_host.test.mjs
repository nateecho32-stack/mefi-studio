// How hard a text call on Claude Code or Codex thinks (main.cjs textCallEffort
// and cliAssistantCall, sliced into a vm with the real agent-profiles and
// model-ladder): a seat's own effort, else the role's, else the team's
// thinking (Auto starts light), fitted to what the CLI takes, sent with the
// call and written to the ledger row.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const agentProfiles = require("../scripts/agent-profiles.cjs");
const modelLadder = require("../scripts/model-ladder.cjs");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

function host(settings = {}) {
  const calls = [], rows = [];
  const answer = (provider) => async (system, user, model, options) => { calls.push({ provider, model, effort: options?.effort ?? "" }); return { ok: true, text: "READY", model: model || `${provider}-default` }; };
  const env = vm.createContext({
    agentProfiles, modelLadder, crypto, console,
    readAgentSettings: async () => settings, readSettings: async () => settings,
    providerBreaker: { enter: () => ({ allowed: true }) }, settleProvider: () => {}, providerSkipped: () => ({ ok: false }),
    claudeCompletion: answer("claude"), codexCompletion: answer("codex"),
    grokCompletion: answer("grok"), antigravityCompletion: answer("antigravity"),
    recordModelCall: async (row) => { rows.push(row); },
    assistantState: null, projects: { current: () => ({ id: "p" }), active: () => ({ id: "p" }) },
    autoFallbackEnabled: () => false, logLine: () => {},
  });
  vm.runInContext(section("// How hard a text call on Claude Code or Codex thinks", "// The HTTP half of assistantFetch"), env);
  const call = async (route, options = {}) => {
    await env.cliAssistantCall({ ok: true, cli: true, ...route }, "system", "user", 400, options);
    return { sent: calls.at(-1), row: JSON.parse(JSON.stringify(rows.at(-1))) };
  };
  return { call };
}

test("Auto sends light thinking to Claude Code and Codex, and the ledger row says so", async () => {
  const h = host();
  const claude = await h.call({ provider: "claude", model: "opus" });
  assert.equal(claude.sent.effort, "low");
  assert.deepEqual([claude.row.requestedEffort, claude.row.appliedEffort], ["low", "low"]);
  assert.equal((await h.call({ provider: "codex", model: "" })).sent.effort, "low");
});

test("a fixed team mode, then a role's own effort, then the caller's own word decide", async () => {
  assert.equal((await host({ agentThinking: { mode: "deep" } }).call({ provider: "claude", model: "opus" })).sent.effort, "high");
  const role = host({ agentThinking: { mode: "deep" }, agentEfforts: { heavy: "medium" } });
  assert.equal((await role.call({ provider: "claude", model: "opus" }, { role: "heavy" })).sent.effort, "medium", "the role's saved effort beats the team mode");
  assert.equal((await role.call({ provider: "claude", model: "opus" }, { role: "heavy", effort: "max" })).sent.effort, "max", "a seat's own effort beats both");
  assert.equal((await host().call({ provider: "claude", model: "opus" }, { effort: "minimal" })).sent.effort, "low", "a word Claude Code does not take is fitted up");
});

test("Haiku, Grok and Antigravity get no thinking flag and no effort in the ledger", async () => {
  const h = host();
  const haiku = await h.call({ provider: "claude", model: "claude-haiku-4-5" });
  assert.equal(haiku.sent.effort, "");
  assert.equal(haiku.row.requestedEffort, undefined);
  assert.equal((await h.call({ provider: "grok", model: "grok-5" })).sent.effort, "");
});
