import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const code = source.slice(source.indexOf("async function chatCompletion("), source.indexOf("// The Grok CLI", source.indexOf("async function chatCompletion(")));
function fixture(response) {
  const recorded = [];
  const context = vm.createContext({ crypto, AbortController, setTimeout, clearTimeout,
    fetch: async () => response,
    recordModelCall: async (entry) => { recorded.push(structuredClone(entry)); },
  });
  vm.runInContext(code, context);
  return { recorded, call: (body = {}) => context.chatCompletion("https://fixture.invalid", "secret-key", "requested-model",
    { model: "requested-model", reasoning_effort: "low", messages: [{ role: "user", content: "private prompt" }], ...body },
    { provider: "fixture-provider", taskType: "ideas" }) };
}
test("real call metadata captures reported usage and model identity without private content", async () => {
  const f = fixture({ ok: true, json: async () => ({ model: "resolved-model", usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost_usd: 0.004 },
    choices: [{ message: { content: "private response", reasoning_content: "private reasoning" }, finish_reason: "stop" }] }) });
  const result = await f.call();
  assert.equal(result.ok, true);
  assert.equal(f.recorded.length, 1);
  const row = f.recorded[0];
  assert.equal(row.id, result.observationId);
  assert.equal(row.model, "resolved-model");
  assert.equal(row.provider, "fixture-provider");
  assert.equal(row.taskType, "ideas");
  assert.equal(row.tokenUsage.totalTokens, 30);
  assert.equal(row.costUsd, 0.004);
  assert.equal(row.requestedEffort, "low");
  assert.equal(row.appliedEffort, null, "requested effort is not claimed as provider-confirmed effort");
  assert.ok(row.elapsedMs >= 0);
  assert.doesNotMatch(JSON.stringify(row), /secret-key|private|fixture.invalid/);
});
test("missing provider billing is unknown even when the request succeeds", async () => {
  const f = fixture({ ok: true, json: async () => ({ choices: [{ message: { content: "answer" } }] }) });
  await f.call();
  assert.equal(f.recorded[0].costUsd, null);
  assert.equal(f.recorded[0].tokenUsage.totalTokens, null);
});
test("failed calls retain error categories without retaining raw server messages", async () => {
  const f = fixture({ ok: false, status: 429, text: async () => "private quota detail" });
  const result = await f.call();
  assert.equal(result.ok, false);
  assert.equal(f.recorded[0].status, "error");
  assert.equal(f.recorded[0].errorKind, "quota");
  assert.equal(f.recorded[0].costUsd, null);
  assert.doesNotMatch(JSON.stringify(f.recorded), /private quota detail/);
});
test("unusable replies retain their reported tokens as a failed attempt", async () => {
  const f = fixture({ ok: true, json: async () => ({ usage: { prompt_tokens: 8, completion_tokens: 100, total_tokens: 108 }, choices: [{ message: { content: "" }, finish_reason: "length" }] }) });
  const result = await f.call();
  assert.equal(result.errorKind, "validation");
  assert.equal(f.recorded[0].status, "error");
  assert.equal(f.recorded[0].tokenUsage.totalTokens, 108);
});
