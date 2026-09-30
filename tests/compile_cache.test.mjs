// Node's compile cache at the top of main.cjs: on by default, before the first
// require so every module benefits, switched off by MEFI_STUDIO_NO_COMPILE_CACHE=1,
// and harmless where Node has no such function.
//
// Run: node --test tests/compile_cache.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const line = main.split("\n").find((row) => row.startsWith("try { if (process.env.MEFI_STUDIO_NO_COMPILE_CACHE"));
assert.ok(line, "the compile cache line is in main.cjs");

function run({ env = {}, enable = () => "enabled", missing = false } = {}) {
  const calls = [];
  const module = missing ? {} : { enableCompileCache: (...args) => { calls.push(args); return enable(); } };
  const context = vm.createContext({ process: { env }, require: (name) => { assert.equal(name, "node:module"); return module; } });
  vm.runInContext(line, context);
  return calls;
}

test("the cache is enabled with Node's default folder unless it is switched off", () => {
  assert.deepEqual(run(), [[]], "on by default, with no folder of its own");
  assert.deepEqual(run({ env: { MEFI_STUDIO_NO_COMPILE_CACHE: "1" } }), [], "the switch turns it off");
  assert.deepEqual(run({ env: { MEFI_STUDIO_NO_COMPILE_CACHE: "0" } }), [[]], "only 1 turns it off");
});

test("a Node with no compile cache, or one that throws, never stops the launch", () => {
  assert.doesNotThrow(() => run({ missing: true }));
  assert.doesNotThrow(() => run({ enable: () => { throw new Error("no writable folder"); } }));
});

test("it comes before the first require of the file, so every module benefits", () => {
  const at = main.indexOf(line);
  const firstRequire = main.search(/\brequire\(/);
  // The only require before it is the one inside the line itself.
  assert.ok(at < main.indexOf('optionalHelper(\n  "./scripts/platform.cjs"'), "before the platform helper");
  assert.equal(main.slice(0, at).includes("require("), false, "no require before it (the comments above only talk about them)");
  assert.ok(firstRequire >= at);
});
