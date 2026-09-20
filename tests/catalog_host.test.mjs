import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function createCatalogFileReader("), source.indexOf("function registerIpc("));
const catalogHandlers = source.slice(source.indexOf('  ipcMain.handle("catalog:read"'), source.indexOf('  ipcMain.handle("studio:launch"'));
const speedHandler = source.slice(source.indexOf('  ipcMain.handle("speed:measurements-read"'), source.indexOf('  ipcMain.handle("eyes:pick-png"'));
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  const files = new Map();
  const handlers = new Map();
  const children = [];
  const logs = [];
  const counts = { stats: 0, reads: 0 };
  let readGate = null;
  let spawnError = null;
  const context = vm.createContext({
    path, STUDIO_ROOT: path.resolve("catalog-fixture"),
    process: { execPath: "fixture-electron", env: {} },
    stat: async (filePath) => {
      counts.stats += 1;
      const file = files.get(path.basename(filePath));
      if (!file) throw new Error("ENOENT");
      return { ...file.info };
    },
    readFile: async (filePath) => {
      counts.reads += 1;
      const content = files.get(path.basename(filePath))?.content;
      const gate = readGate;
      readGate = null;
      if (gate) await gate;
      return content;
    },
    spawn: (_execPath, args, options) => {
      if (spawnError) { const error = spawnError; spawnError = null; throw error; }
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      children.push({ child, args, options });
      return child;
    },
    logLine: (line) => logs.push(line),
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  });
  vm.runInContext(`${helpers}\n${catalogHandlers}\n${speedHandler}`, context);
  const readers = vm.runInContext("({ catalogDocument, speedMeasurementDocument })", context);
  return {
    files, handlers, children, logs, counts, ...readers,
    put(name, value, info = {}) {
      files.set(name, { content: JSON.stringify(value), info: { mtimeMs: 1, ctimeMs: 1, size: 100, ino: 1, ...info } });
    },
    gateNextRead: (promise) => { readGate = promise; },
    failNextSpawn: () => { spawnError = new Error("spawn unavailable"); },
    read: () => handlers.get("catalog:read")(),
    refresh: () => handlers.get("catalog:refresh")(),
    measurements: () => handlers.get("speed:measurements-read")(),
  };
}

test("catalog readers share concurrent I/O and reuse unchanged parsed documents", async () => {
  const f = fixture();
  f.put("models.json", { models: [{ id: "first" }] });
  const gate = deferred();
  f.gateNextRead(gate.promise);
  const requests = Array.from({ length: 24 }, () => f.read());
  await flush();
  assert.equal(f.counts.stats, 1);
  assert.equal(f.counts.reads, 1);
  gate.resolve();
  const results = await Promise.all(requests);
  assert.equal(results[0].models[0].id, "first");
  for (const result of results) assert.equal(result, results[0]);
  for (let i = 0; i < 10; i += 1) assert.equal(await f.read(), results[0]);
  assert.equal(f.counts.stats, 11, "each later request checks for external changes");
  assert.equal(f.counts.reads, 1, "unchanged files are not reread or reparsed");
});

test("catalog cache notices file replacements and edits even with preserved mtime and size", async () => {
  const f = fixture();
  f.put("models.json", { revision: 1 });
  await f.read();
  f.put("models.json", { revision: 2 }, { ctimeMs: 2 });
  assert.equal((await f.read()).revision, 2);
  f.put("models.json", { revision: 3 }, { ctimeMs: 2, ino: 2 });
  assert.equal((await f.read()).revision, 3);
  assert.equal(f.counts.reads, 3);
});

test("refresh invalidation prevents an older in-flight read from replacing the new cache", async () => {
  const f = fixture();
  f.put("models.json", { revision: 1 });
  const gate = deferred();
  f.gateNextRead(gate.promise);
  const old = f.read();
  await flush();
  f.put("models.json", { revision: 2 });
  f.catalogDocument.invalidate();
  assert.equal((await f.read()).revision, 2);
  gate.resolve();
  assert.equal((await old).revision, 1);
  assert.equal((await f.read()).revision, 2);
  assert.equal(f.counts.reads, 2);
});

test("missing or malformed documents reject and can recover on the next read", async () => {
  const f = fixture();
  await assert.rejects(f.read(), /ENOENT/);
  f.put("models.json", { revision: 1 });
  f.files.get("models.json").content = "{";
  await assert.rejects(f.read(), /JSON/);
  f.put("models.json", { revision: 2 });
  assert.equal((await f.read()).revision, 2);
  f.files.delete("models.json");
  await assert.rejects(f.read(), /ENOENT/);
});

test("optional speed metadata stays empty when missing and detects later measurements", async () => {
  const f = fixture();
  assert.equal(JSON.stringify(await f.measurements()), '{"ok":true,"measurements":{}}');
  f.put("speed-measurements.json", { fast: { tokensPerSecond: 50 } });
  assert.equal((await f.measurements()).measurements.fast.tokensPerSecond, 50);
  await f.measurements();
  assert.equal(f.counts.reads, 1);
  f.put("speed-measurements.json", { fast: { tokensPerSecond: 75 } });
  f.speedMeasurementDocument.invalidate();
  assert.equal((await f.measurements()).measurements.fast.tokensPerSecond, 75);
});

test("concurrent refresh requests launch once and invalidate the catalog on completion", async () => {
  const f = fixture();
  f.put("models.json", { revision: 1 });
  await f.read();
  const requests = Array.from({ length: 20 }, () => f.refresh());
  await flush();
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].options.windowsHide, true);
  assert.equal(f.children[0].options.env.ELECTRON_RUN_AS_NODE, "1");
  f.put("models.json", { revision: 2 });
  f.children[0].child.stdout.emit("data", "updated\n");
  f.children[0].child.emit("close", 0);
  const results = await Promise.all(requests);
  assert.ok(results.every((result) => result.ok && result.output === "updated\n"));
  assert.equal(f.logs.length, 1);
  assert.equal((await f.read()).revision, 2);
  const next = f.refresh();
  await flush();
  assert.equal(f.children.length, 2);
  f.children[1].child.emit("close", 0);
  assert.equal((await next).ok, true);
});

test("failed refresh children settle once and allow a later retry", async () => {
  const f = fixture();
  const first = f.refresh();
  const concurrent = f.refresh();
  await flush();
  f.children[0].child.emit("error", new Error("could not start"));
  const result = await first;
  assert.equal(result.ok, false);
  assert.equal(result.error, "could not start");
  assert.equal(await concurrent, result);
  f.children[0].child.emit("close", -1);
  const retry = f.refresh();
  await flush();
  assert.equal(f.children.length, 2);
  f.children[1].child.stderr.emit("data", "offline\n");
  f.children[1].child.emit("close", 1);
  assert.equal((await retry).code, 1);
  assert.equal(f.logs.length, 1);
  const recovered = f.refresh();
  await flush();
  f.children[2].child.emit("close", 0);
  assert.equal((await recovered).ok, true);
});

test("synchronous refresh launch failures also clear the shared request", async () => {
  const f = fixture();
  f.failNextSpawn();
  assert.equal((await f.refresh()).error, "spawn unavailable");
  const retry = f.refresh();
  await flush();
  assert.equal(f.children.length, 1);
  f.children[0].child.emit("close", 0);
  assert.equal((await retry).ok, true);
});
