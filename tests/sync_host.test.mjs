import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// main.cjs's "Multi-PC sync" block in a vm, against a fake scripts/sync.mjs:
// a look never pulls or pushes, one sync runs at a time, a look during a sync
// of the same folder shares its answer, and a failure to load comes back as an
// answer instead of a rejection. Then the bridge: preload.cjs's syncStatus and
// syncRun reach their handlers, and the project gate holds both.

const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Multi-PC sync: Friends › Your PCs");
const to = main.indexOf("// ---- end of multi-PC sync", from);
assert.ok(from > 0 && to > from, "main.cjs has a Multi-PC sync block");
const block = main.slice(from, to);
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function host({ fail = null } = {}) {
  const calls = [];
  const gates = [];
  let root = "C:/projects/one";
  const context = vm.createContext({
    Promise,
    projectRoot: () => root,
    loadModule: async (rel) => {
      assert.equal(rel, "scripts/sync.mjs");
      if (fail) throw new Error(fail);
      return {
        sync: (folder, options) => new Promise((resolve) => {
          const call = { folder, options: { ...options }, resolve: (extra = {}) => resolve({ ok: true, headline: `synced ${folder}`, folder, options: call.options, ...extra }) };
          calls.push(call);
          gates.push(call);
        }),
      };
    },
  });
  vm.runInContext(`${block}\nthis.api = { syncProject };`, context);
  return { api: context.api, calls, setRoot: (value) => { root = value; } };
}

test("a look fetches only; Sync this PC pulls and pushes", async () => {
  const h = host();
  const look = h.api.syncProject(false);
  await flush();
  assert.deepEqual(h.calls[0].options, { pull: false, push: false });
  h.calls[0].resolve();
  assert.equal((await look).headline, "synced C:/projects/one");
  const run = h.api.syncProject(true);
  await flush();
  assert.deepEqual(h.calls[1].options, { pull: true, push: true });
  h.calls[1].resolve();
  await run;
});

test("a look during a sync of the same folder shares its answer", async () => {
  const h = host();
  const run = h.api.syncProject(true);
  await flush();
  const look = h.api.syncProject(false);
  await flush();
  assert.equal(h.calls.length, 1, "no second git run");
  h.calls[0].resolve({ actions: [{ kind: "pushed", commits: 2 }] });
  const [ran, looked] = await Promise.all([run, look]);
  assert.equal(looked, ran);
});

test("a sync asked for during another waits its turn, and another folder never shares an answer", async () => {
  const h = host();
  const look = h.api.syncProject(false);
  await flush();
  const run = h.api.syncProject(true);
  await flush();
  assert.equal(h.calls.length, 1, "the run waits for the look");
  h.calls[0].resolve();
  await look;
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].options, { pull: true, push: true });
  h.setRoot("C:/projects/two");
  const other = h.api.syncProject(false);
  await flush();
  assert.equal(h.calls.length, 2, "still waiting on the run");
  h.calls[1].resolve();
  await run;
  await flush();
  assert.equal(h.calls[2].folder, "C:/projects/two");
  h.calls[2].resolve();
  assert.equal((await other).folder, "C:/projects/two");
});

test("a sync module that cannot load answers instead of rejecting, and frees the next call", async () => {
  const h = host({ fail: "missing module" });
  const result = await h.api.syncProject(true);
  assert.equal(result.ok, false);
  assert.equal(result.headline, "Sync could not run: missing module");
  assert.equal(result.lines.length, 0);
  assert.equal((await h.api.syncProject(false)).ok, false, "a later call runs again");
});

test("the bridge reaches both handlers with no payload, and the project gate holds them", async () => {
  const invoked = [];
  const page = {
    require: () => ({
      contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
      ipcRenderer: { invoke: async (channel, ...args) => { invoked.push([channel, args]); return { ok: true }; }, on: () => {} },
    }),
  };
  vm.runInNewContext(preload, page);
  await page.mefiStudio.syncStatus({ root: "C:/elsewhere" });
  await page.mefiStudio.syncRun("C:/elsewhere");
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [["sync:status", []], ["sync:run", []]], "the renderer cannot choose the folder");
  assert.match(main, /ipcMain\.handle\("sync:status", async \(\) => syncProject\(false\)\);/);
  assert.match(main, /ipcMain\.handle\("sync:run", async \(\) => syncProject\(true\)\);/);
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  const channels = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  assert.doesNotMatch(prefixes, /"sync:"/, "sync:* waits for a project switch");
  assert.doesNotMatch(channels, /"sync:/);
});
