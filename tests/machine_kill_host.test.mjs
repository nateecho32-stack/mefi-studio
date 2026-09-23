import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

// main.cjs's machine:kill handler. taskkill /t /f removes a whole tree, so the
// pid the renderer sends must name a row the machine panel offers a stop for:
// a LÖVE process in the latest scan that is a test run or has a killable
// verdict. Anything else is refused without spawning.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const start = source.indexOf('  ipcMain.handle("machine:kill",');
const end = source.indexOf("\n  // ---- live update", start);
assert.ok(start > 0 && end > start, "the machine:kill handler is where this suite slices it");

const row = (pid, status, test) => ({ pid, status, test, killable: ["orphan", "hang", "over-age"].includes(status), name: "lovec.exe" });
const SCAN = {
  processes: [
    row(310, "healthy", true), // a running test: the panel shows its ×
    row(311, "orphan", false), // the resource manager would kill it itself
    row(312, "other", false), // the owner's own LÖVE session
    row(313, "fat", false),
  ],
};

function host({ scan = async () => SCAN } = {}) {
  const calls = { spawned: [], scans: 0, logs: [] };
  let handler = null;
  const context = vm.createContext({
    ipcMain: { handle: (channel, fn) => { if (channel === "machine:kill") handler = fn; } },
    readMachineStatus: async () => { calls.scans += 1; return scan(); },
    spawn: (command, args, options) => { calls.spawned.push({ command, args, options }); return { on() { return this; } }; },
    logLine: (line) => calls.logs.push(line),
    machineReadCache: { at: 1, status: SCAN },
  });
  vm.runInContext(source.slice(start, end), context);
  assert.equal(typeof handler, "function");
  return { kill: (pid) => handler({}, { pid }), calls, context };
}

test("a pid outside the latest scan is refused and nothing is spawned", async () => {
  const { kill, calls } = host();
  const result = await kill(4); // the System process
  assert.equal(result.ok, false);
  assert.match(result.error, /pid 4 is not a LOVE test run/);
  assert.deepEqual(calls.spawned, []);
  assert.equal(calls.scans, 1);
});

test("a LÖVE process the panel offers no stop for is refused", async () => {
  for (const pid of [312, 313]) {
    const { kill, calls } = host();
    assert.equal((await kill(pid)).ok, false, `pid ${pid}`);
    assert.deepEqual(calls.spawned, [], `pid ${pid}`);
  }
});

test("a test run or a killable verdict is killed hidden, and the next read rescans", async () => {
  for (const pid of [310, 311, "310"]) {
    const { kill, calls, context } = host();
    assert.deepEqual(JSON.parse(JSON.stringify(await kill(pid))), { ok: true }, `pid ${pid}`);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.spawned)), [
      { command: "taskkill", args: ["/pid", String(pid), "/t", "/f"], options: { windowsHide: true, stdio: "ignore" } },
    ]);
    assert.equal(context.machineReadCache, null, "the killed row does not linger in the cached scan");
  }
});

test("a malformed pid is refused before any scan", async () => {
  for (const pid of [undefined, null, 0, -310, 1.5, "abc", "310; calc"]) {
    const { kill, calls } = host();
    assert.equal((await kill(pid)).error, "pid required", String(pid));
    assert.equal(calls.scans, 0);
    assert.deepEqual(calls.spawned, []);
  }
});

test("a failed scan refuses the kill instead of trusting the renderer", async () => {
  const { kill, calls } = host({ scan: async () => { throw new Error("powershell unavailable"); } });
  const result = await kill(310);
  assert.equal(result.ok, false);
  assert.match(result.error, /machine scan failed: powershell unavailable/);
  assert.deepEqual(calls.spawned, []);
});

// A taskkill spawned without windowsHide flashes a console window, and one
// without stdio "ignore" leaves pipes nobody reads.
test("every taskkill main.cjs spawns runs hidden with its stdio ignored", () => {
  const lines = source.split("\n").filter((line) => line.includes('spawn("taskkill"'));
  assert.ok(lines.length >= 6, `found ${lines.length} taskkill spawns`);
  for (const line of lines) {
    assert.ok(line.includes("windowsHide: true") && line.includes('stdio: "ignore"'), line.trim());
  }
});
