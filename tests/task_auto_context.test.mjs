import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
};

test("new task writes gather context once and honor the automatic reference switch", async () => {
  let enabled = true;
  const gathered = [], observed = [];
  const env = vm.createContext({
    queueMicrotask, Promise,
    readSettings: async () => ({ ui: { autoReference: enabled } }),
    ensureAssistant: async () => ({}),
    assistantGatherTaskReferences: (id, text) => gathered.push({ id, text }),
    assistantObserveTasks: (tasks) => observed.push(tasks.length),
    logError: (error) => { throw new Error(error); },
  });
  vm.runInContext(section("function boardWritten(", "// Drop a claim"), env);
  const task = { id: "new", title: "Fix navigation", prompt: "Keep keyboard focus visible" };
  env.boardWritten({ written: ["tasks"], tasks: [task], newTaskIds: ["new"] }, null);
  await new Promise(setImmediate);
  assert.deepEqual(gathered, [{ id: "new", text: "Fix navigation\n\nKeep keyboard focus visible" }]);
  env.boardWritten({ written: ["tasks"], tasks: [task], newTaskIds: [] }, null);
  enabled = false;
  env.boardWritten({ written: ["tasks"], tasks: [{ id: "other", title: "Other" }], newTaskIds: ["other"] }, null);
  await new Promise(setImmediate);
  assert.equal(gathered.length, 1);
  assert.equal(observed.length, 3);
});

test("Luna context pointer can select only a real local file", async () => {
  const calls = [], settled = [];
  let reply = '{"index":1,"why":"The matching handler is here."}';
  const env = vm.createContext({
    ZEN_MODEL_ROUTINE: "gpt-6-luna",
    readSettings: async () => ({}), decryptKey: () => "fixture-key",
    seatChoice: () => ({ provider: "zen", model: "gpt-6-luna", effort: "low", fast: true }),
    providerBreaker: { enter: () => ({ allowed: true }) },
    zenEndpoint: () => "https://example.test/responses", scrubOutbound: (value) => value,
    chatCompletion: async (...args) => { calls.push(args); return { ok: true, text: reply }; },
    settleProvider: (...args) => settled.push(args),
  });
  vm.runInContext(section("async function lunaContextPointer(", "async function attachTaskRefs("), env);
  const refs = { files: ["src/a.js", "src/b.js"], code: [{ file: "src/b.js", snippet: "matching handler" }] };
  const pointer = await env.lunaContextPointer("Fix handler", refs);
  assert.equal(pointer.title, "Start with src/b.js");
  assert.equal(calls[0][3].reasoning_effort, "low");
  assert.equal(calls[0][4].timeoutMs, 8000);
  assert.equal(settled.length, 1);
  reply = '{"index":9,"why":"invented"}';
  assert.equal(await env.lunaContextPointer("Fix handler", refs), null);
});

test("a selected alternate scout ranks only gathered files within the short deadline", async () => {
  const calls = [];
  const env = vm.createContext({
    setTimeout, clearTimeout,
    readSettings: async () => ({}),
    seatChoice: () => ({ provider: "openrouter", model: "chosen-scout" }),
    scrubOutbound: (value) => value,
    seatFetch: async (...args) => { calls.push(args); return { ok: true, text: '{"index":0,"why":"The task entry is here."}' }; },
  });
  vm.runInContext(section("async function lunaContextPointer(", "async function attachTaskRefs("), env);
  const pointer = await env.lunaContextPointer("Update entry", { files: ["src/entry.js"] });
  assert.equal(pointer.title, "Start with src/entry.js");
  assert.equal(calls[0][0], "scout");
  assert.equal(calls[0][4].timeoutMs, 8000);
});
