import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf("let machineReadInFlight");
const end = source.indexOf("// Resource manager:", start);
assert.ok(start > 0 && end > start);
function host(scan) {
  let time = 1000;
  const context = vm.createContext({ Date: { now: () => time }, resourcePass: scan });
  vm.runInContext(source.slice(start, end), context);
  return { read: context.readMachineStatus, advance: (ms) => { time += ms; } };
}

test("concurrent machine UI readers share a scan, reuse briefly, then refresh", async () => {
  let finish, calls = 0;
  const { read, advance } = host(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); });
  const first = read();
  assert.equal(read(), first);
  finish({ running: [42] }); await first;
  assert.deepEqual(await read(), { running: [42] });
  assert.equal(calls, 1);
  advance(2000);
  const next = read(); assert.equal(calls, 2);
  finish({ running: [] }); await next;
});

test("resource enforcement bypasses the UI cache; failed reads can retry", async () => {
  const calls = [];
  let fail = true;
  const { read } = host(async (options) => {
    calls.push(options.kill);
    if (fail) { fail = false; throw new Error("scan failed"); }
    return { scan: calls.length };
  });
  await assert.rejects(read(), /scan failed/);
  assert.equal((await read()).scan, 2);
  assert.equal((await read({ kill: true })).scan, 3);
  assert.deepEqual(calls, [false, false, true]);
});
