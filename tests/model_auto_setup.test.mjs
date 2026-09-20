import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Auto setup is a pure planner: it sees saved-key flags and CLI install
// results, decides the same settings the Studio controls write, and returns
// reasons. No filesystem, process or network boundary is involved here.
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("function planAutoSetup(");
const to = main.indexOf("// Pick who pays", from);
assert.ok(from >= 0 && to > from, "planAutoSetup must exist in main.cjs");
const context = vm.createContext({});
vm.runInContext(main.slice(from, to), context);
const planAutoSetup = context.planAutoSetup;
const plain = (value) => JSON.parse(JSON.stringify(value));

const cli = (id, installed) => ({ id, name: id, installed, source: installed ? `C:\\bin\\${id}.exe` : null });

test("auto setup prefers the saved z.ai key and explains every choice", () => {
  const plan = planAutoSetup({
    settings: {},
    keys: { zai: true, opencode: true, gateway: false },
    clis: [cli("opencode", true)],
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "zai", modelSelection: "fixed" });
  assert.deepEqual(plain(plan.active), { provider: "zai", modelSelection: "fixed", executorCli: "opencode" });
  const notes = plan.notes.join(" ");
  assert.match(notes, /z\.ai key found/);
  assert.match(notes, /No Jev gateway key/);
  assert.match(notes, /OpenCode CLI found/);
  assert.doesNotMatch(notes, /OpenCode Go key found/, "the unused OpenCode key is not the reported route");
});

test("a gateway key enables Jev selection and a missing OpenCode CLI moves builders to Grok", () => {
  const plan = planAutoSetup({
    settings: { aiProvider: "zai", modelSelection: "jev", executorCli: "opencode" },
    keys: { opencode: true, gateway: true },
    clis: [cli("grok", true)],
  });
  assert.deepEqual(plain(plan.changes), { provider: "opencode", executorCli: "grok" });
  assert.equal(plan.active.modelSelection, "jev");
  const notes = plan.notes.join(" ");
  assert.match(notes, /OpenCode Go key found/);
  assert.match(notes, /task-aware model selection is on/);
  assert.match(notes, /builders run through Grok/);
});

test("a Grok-only machine configures the CLI login route without inventing a key", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [cli("grok", true)] });
  assert.equal(plan.ok, true);
  assert.deepEqual(plain(plan.changes), { provider: "grok", modelSelection: "fixed", executorCli: "grok" });
  assert.match(plan.notes.join(" "), /Grok CLI's own login/);
  assert.doesNotMatch(plan.notes.join(" "), /key found/);
});

test("an empty machine is refused with guidance instead of a partial configuration", () => {
  const plan = planAutoSetup({ settings: {}, keys: {}, clis: [] });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /save a z\.ai or OpenCode Go key, or install the Grok CLI/);
  assert.equal(plan.changes, undefined);
});

test("an already-configured machine reports no changes and keeps the current builder", () => {
  const plan = planAutoSetup({
    settings: { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode" },
    keys: { zai: true, gateway: false },
    clis: [cli("opencode", true)],
  });
  assert.deepEqual(plain(plan.changes), {});
  assert.deepEqual(plain(plan.active), { provider: "zai", modelSelection: "fixed", executorCli: "opencode" });
});

test("an inert OpenCode fallback is turned off and the input settings are never mutated", () => {
  const settings = { aiProvider: "zai", modelSelection: "fixed", executorCli: "opencode", aiFallbackOpenCode: true };
  const plan = planAutoSetup({ settings, keys: { zai: true, gateway: false }, clis: [cli("opencode", true)] });
  assert.deepEqual(plain(plan.changes), { fallbackOpenCode: false });
  assert.match(plan.notes.join(" "), /fallback turned off/);
  assert.equal(settings.aiFallbackOpenCode, true, "the planner describes changes; the host applies them");
});

test("no detected builder leaves the saved executor alone and says so", () => {
  const plan = planAutoSetup({
    settings: { executorCli: "grok" },
    keys: { zai: true, gateway: false },
    clis: [],
  });
  assert.equal(plan.active.executorCli, "grok");
  assert.equal(plan.changes.executorCli, undefined);
  assert.match(plan.notes.join(" "), /No builder CLI detected/);
});
