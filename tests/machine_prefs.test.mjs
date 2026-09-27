// machine:set feeds the resource manager that stops runaway test runs. It
// used to spread whatever the renderer sent into settings.machine; now it
// keeps the five fields the manager reads, each type- and range-checked.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf('  ipcMain.handle("machine:get"');
const handlers = source.slice(start, source.indexOf("  // taskkill /t /f takes the whole tree", start));
assert.ok(handlers.includes('ipcMain.handle("machine:set"'), "the machine handlers must be found");
const defaults = source.slice(source.indexOf("const MACHINE_DEFAULTS"), source.indexOf("\n", source.indexOf("const MACHINE_DEFAULTS")));

function host(initial = {}) {
  const state = { settings: structuredClone(initial) };
  const found = new Map();
  const context = vm.createContext({
    readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => { const next = structuredClone(state.settings); mutate(next); state.settings = structuredClone(next); return structuredClone(next); },
    ipcMain: { handle: (channel, fn) => found.set(channel, fn) },
  });
  vm.runInContext(`${defaults}\n${handlers}`, context);
  return { state, set: (prefs) => found.get("machine:set")({}, prefs), get: () => found.get("machine:get")({}) };
}

test("machine:set keeps only the resource manager's fields, rounded", async () => {
  const h = host();
  const result = await h.set({ autoKill: false, idleSeconds: 600.4, maxAgeMinutes: 30, maxMemMB: 2048, memoryWarnOverride: true, shell: "rm -rf", __proto__: { polluted: true } });
  assert.equal(result.ok, true);
  assert.deepEqual(h.state.settings.machine, { autoKill: false, idleSeconds: 600, maxAgeMinutes: 30, maxMemMB: 2048, memoryWarnOverride: true });
});

test("machine:set refuses wrong types and out-of-range values, writing nothing", async () => {
  const h = host({ machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } });
  for (const bad of [{ autoKill: "no" }, { idleSeconds: 5 }, { maxAgeMinutes: 0 }, { maxMemMB: "lots" }, { memoryWarnOverride: 1 }]) {
    const result = await h.set(bad);
    assert.equal(result.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(h.state.settings.machine, { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 });
  const read = await h.get();
  assert.equal(read.machine.idleSeconds, 240);
});
