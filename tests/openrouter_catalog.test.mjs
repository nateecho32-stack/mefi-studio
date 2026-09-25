import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../scripts/openrouter-catalog.cjs";

const row = (id, { output = ["text"], pricing = { prompt: "0", completion: "0" } } = {}) => ({
  id, name: id, context_length: 200000,
  architecture: { input_modalities: ["text"], output_modalities: output }, pricing,
});

test("OpenRouter picker keeps chat models, with the free router and free endpoints first", () => {
  const models = catalog.chatModels({ data: [
    row("openai/gpt-chat", { pricing: { prompt: "0.000001", completion: "0.000002" } }),
    row("google/music", { output: ["text", "audio"] }),
    row("nvidia/embed", { output: ["embeddings"] }),
    row("openai/gpt-chat:batch"),
    row("qwen/qwen3.8-27b:free"), row("openrouter/free"),
  ] });
  assert.deepEqual(models.map((model) => model.id), ["openrouter/free", "qwen/qwen3.8-27b:free", "openai/gpt-chat"]);
  assert.deepEqual(models.map((model) => model.free), [true, true, false]);
});

test("OpenRouter roster is cached and a failed refresh keeps the last usable list", async () => {
  let calls = 0;
  let time = 0;
  const list = catalog.createCatalog({ now: () => time, fetchImpl: async (url) => {
    calls++;
    assert.match(url, /input_modalities=text&output_modalities=text/);
    return calls === 1 ? { ok: true, json: async () => ({ data: [row("openrouter/free")] }) } : { ok: false, status: 503 };
  } });
  assert.equal((await list()).models[0].id, "openrouter/free");
  time = 1000;
  assert.equal((await list()).cached, true);
  assert.equal(calls, 1);
  const failed = await list({ refresh: true });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.models.map((model) => model.id), ["openrouter/free"]);
});
