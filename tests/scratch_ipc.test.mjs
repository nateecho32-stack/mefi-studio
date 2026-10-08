// main.cjs "Scratch tier" (docs/plans/scratch-tier.md WP2), sliced by its
// markers into a vm with stubs for the host: a store opens on first use, per
// project, never at launch, on the JavaScript host unless the Rust factory
// answers; scratch:stats answers the page's picture (without opening a store
// unless asked), scratch:compact pushes scratch:state, scratch:set saves
// settings.scratch through patchFrom; MEFI_STUDIO_NO_SCRATCH=1 keeps every
// store closed and MEFI_SCRATCH_DIR moves the folder unless it is inside
// OneDrive. Then the wiring: the preload's sanitised methods, main's handlers
// (the IPC audit's rule: every invoke has one), registerIpc calling in, and
// the quit hook.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const main = await read("main.cjs");
const preload = await read("preload.cjs");
const start = main.indexOf("// ---- Scratch tier ----");
const end = main.indexOf("// ---- end of the scratch tier ----", start);
assert.ok(start > 0 && end > start, "main.cjs still has the Scratch tier block");
const block = main.slice(start, end);
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));

function host({ env = {}, settings = {}, localDir, rust = null, projectId = "proj-a" } = {}) {
  const handlers = new Map();
  const sent = [];
  const logged = [];
  let saved = { ...settings };
  const context = {
    require: mainRequire, console, Promise, Date, Map, Set, String, Number, Object, Array, JSON, Error, Boolean, Math,
    process: { env: { ...env, ...(localDir ? { MEFI_STUDIO_LOCAL_DIR: localDir } : {}) }, platform: process.platform, pid: process.pid, kill: process.kill.bind(process) },
    path, os,
    app: { getPath: () => path.join(localDir ?? os.tmpdir(), "userData") },
    SMOKE: false, CAPTURE: false,
    optionalHelper: (_request, load) => load(),
    rustModules: rust,
    readSettings: async () => structuredClone(saved),
    updateSettings: async (mutate) => { const next = structuredClone(saved); await mutate(next); saved = next; return next; },
    projects: { active: () => ({ id: projectId }), current: () => ({ id: projectId }) },
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: (line) => logged.push(line),
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
  vm.createContext(context);
  vm.runInContext(`${block}\nglobalThis.__scratch = { scratchFor, scratchView, scratchRegisterIpc, scratchCloseAll, scratchStores };`, context);
  context.__scratch.scratchRegisterIpc();
  return {
    // Objects made inside the vm have its own prototypes: answers come back as plain copies.
    context, handlers, sent, logged, settings: () => JSON.parse(JSON.stringify(saved)),
    call: async (channel, payload) => JSON.parse(JSON.stringify(await handlers.get(channel)({}, payload))),
    setProject: (id) => { projectId = id; },
    ...context.__scratch,
  };
}

let tmp;
test.before(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), "scratch-ipc-")); });
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

test("the three channels are registered; a look does not open a store, the page's first look does, per project, on the JavaScript host", async () => {
  const h = host({ localDir: tmp });
  assert.deepEqual([...h.handlers.keys()], ["scratch:stats", "scratch:compact", "scratch:set"]);
  const quiet = await h.call("scratch:stats", { open: false });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.enabled, true);
  assert.equal(quiet.stats, null, "nothing opened");
  assert.equal(quiet.line, "Scratch: not open yet");
  assert.equal(quiet.host, null);
  assert.deepEqual(quiet.prefs, { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, saved: { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, embeddings: "off", gpu: "off" }, forced: null, refused: null });
  assert.equal(h.scratchStores.size, 0, "a look without `open` makes no store");
  const first = await h.call("scratch:stats", { open: true });
  assert.equal(first.ok, true);
  assert.equal(first.host, "js");
  assert.equal(first.dir, path.join(tmp, "scratch", "proj-a"));
  assert.equal(first.line, "Scratch: 0 MB of 512 MB, 0 keys, no lookups yet, never compacted");
  assert.deepEqual((await readdir(path.join(tmp, "scratch", "proj-a"))).sort(), ["blobs", "scratch.lock"]);
  const store = await h.scratchFor("proj-a");
  assert.equal(store, await h.scratchFor("proj-a"), "memoised per project");
  assert.equal((await store.put({ key: "run/r1/out", text: "parked output" })).ok, true);
  // Another project: its own folder and store.
  h.setProject("proj-b");
  const other = await h.call("scratch:stats", { open: true });
  assert.equal(other.dir, path.join(tmp, "scratch", "proj-b"));
  assert.notEqual(await h.scratchFor("proj-b"), store);
  assert.equal(h.scratchStores.size, 2);
  assert.ok(h.logged.some((line) => line === "[scratch] open for project proj-a on the js host: 0 keys"), h.logged.join("\n"));
  assert.ok(h.logged.every((line) => !line.includes(tmp)), "no path in a log line");
  await h.scratchCloseAll();
  assert.equal(h.scratchStores.size, 0);
  assert.deepEqual(await readdir(path.join(tmp, "scratch", "proj-a")), ["blobs", "index.json", "index.jsonl"], "closing wrote the checkpoint and gave the lock back");
});

test("MEFI_STUDIO_NO_SCRATCH=1 keeps every store closed and the page says so; so does the saved switch", async () => {
  const off = host({ localDir: tmp, env: { MEFI_STUDIO_NO_SCRATCH: "1" } });
  const view = await off.call("scratch:stats", { open: true });
  assert.equal(view.enabled, false);
  assert.equal(view.prefs.forced, "MEFI_STUDIO_NO_SCRATCH");
  assert.equal(view.line, "Scratch: off for this launch (MEFI_STUDIO_NO_SCRATCH=1)");
  assert.equal(await off.scratchFor("proj-a"), null);
  assert.deepEqual(await off.call("scratch:compact"), { ok: false, error: "Scratch is off, so there is nothing to compact." });
  assert.deepEqual(off.sent, []);
  const saved = host({ localDir: tmp, settings: { scratch: { enabled: false } } });
  assert.equal((await saved.call("scratch:stats", { open: true })).line, "Scratch: off");
  assert.equal(await saved.scratchFor("proj-a"), null);
});

test("compact pushes scratch:state with the fresh line; set saves settings.scratch, refuses odd values and pushes too", async () => {
  const h = host({ localDir: path.join(tmp, "set") });
  const store = await h.scratchFor("proj-a");
  await store.put({ key: "run/r1/a", text: "one" });
  await store.put({ key: "run/r1/b", text: "two" });
  await store.evict({ prefix: "run/r1/a" });
  const compacted = await h.call("scratch:compact");
  assert.equal(compacted.ok, true);
  assert.equal(compacted.removed, 1);
  assert.match(compacted.line, /^Scratch: 0 MB of 512 MB, 1 key, no lookups yet, compacted just now$/);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0][0], "scratch:state");
  assert.equal(h.sent[0][1].line, compacted.line);
  assert.equal(h.sent[0][1].projectId, "proj-a");
  const set = await h.call("scratch:set", { capMB: 1024, agentTools: false, historyBodies: false, gpu: "auto" });
  assert.equal(set.ok, true);
  assert.deepEqual(h.settings().scratch, { capMB: 1024, agentTools: false, historyBodies: false });
  assert.equal(set.prefs.capMB, 1024);
  assert.equal(set.prefs.agentTools, false);
  assert.equal(h.sent.at(-1)[0], "scratch:state");
  assert.deepEqual(await h.call("scratch:set", { capMB: 3 }), { ok: false, error: "The cap is a whole number of MB from 64 to 65536." });
  assert.deepEqual(await h.call("scratch:set", {}), { ok: false, error: "Choose what to change." });
  const line = (await h.call("scratch:set", { enabled: false })).line;
  assert.equal(line, "Scratch: off", "the switch answers at once; the open store closes with Studio");
  await h.scratchCloseAll();
});

test("MEFI_SCRATCH_DIR moves the folder; inside OneDrive it is refused and the local folder is used, and the page can say why", async () => {
  const moved = host({ localDir: tmp, env: { MEFI_SCRATCH_DIR: path.join(tmp, "elsewhere") } });
  const view = await moved.call("scratch:stats", { open: true });
  assert.equal(view.dir, path.join(tmp, "elsewhere", "scratch", "proj-a"));
  await moved.scratchCloseAll();
  const refused = host({ localDir: tmp, env: { MEFI_SCRATCH_DIR: path.join(tmp, "OneDrive", "scratch") }, projectId: "proj-c" });
  const fallback = await refused.call("scratch:stats", { open: true });
  assert.equal(fallback.dir, path.join(tmp, "scratch", "proj-c"));
  assert.equal(fallback.prefs.refused.reason, "onedrive");
  await refused.scratchCloseAll();
});

test("under the Rust host the factory's store is used; switched off, the JavaScript host is", async () => {
  const calls = [];
  const fake = { host: "rust", open: async () => { calls.push("open"); return { ok: true, keys: 3 }; }, stats: async () => ({ ok: true, bytes: 5 * 1024 * 1024, capBytes: 512 * 1024 * 1024, keys: 3, hits: 9, misses: 1, lastCompactAt: null }), close: async () => ({ ok: true }) };
  const rust = { factory: (name, collaborators) => { calls.push([name, collaborators]); return name === "scratch" ? fake : null; } };
  const h = host({ localDir: tmp, rust, projectId: "proj-r" });
  const view = await h.call("scratch:stats", { open: true });
  assert.equal(view.host, "rust");
  assert.equal(view.line, "Scratch: 5 MB of 512 MB, 3 keys, 90% hits, never compacted");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["scratch", { dir: path.join(tmp, "scratch", "proj-r"), capMB: 512 }]);
  assert.equal(calls[1], "open");
  const off = host({ localDir: tmp, rust: { factory: () => null }, projectId: "proj-s" });
  assert.equal((await off.call("scratch:stats", { open: true })).host, "js", "MEFI_STUDIO_RUST_OFF=scratch answers null from the factory, so the JavaScript host serves");
  await h.scratchCloseAll();
  await off.scratchCloseAll();
});

test("a store that does not open answers null, is logged without a path, and fails nothing else", async () => {
  const broken = { factory: () => ({ host: "rust", open: async () => ({ ok: false, reason: "locked" }) }) };
  const h = host({ localDir: tmp, rust: broken, projectId: "proj-x" });
  assert.equal(await h.scratchFor("proj-x"), null);
  const view = await h.call("scratch:stats", { open: true });
  assert.equal(view.ok, true);
  assert.equal(view.stats, null);
  assert.ok(h.logged.some((line) => line === "[scratch] the store for project proj-x did not open (locked)"), h.logged.join("\n"));
  const throwing = { factory: () => ({ host: "rust", open: async () => { throw new Error(`cannot map ${tmp}`); } }) };
  const t = host({ localDir: tmp, rust: throwing, projectId: "proj-y" });
  assert.equal(await t.scratchFor("proj-y"), null);
  assert.equal((await t.call("scratch:compact")).ok, false);
});

// ---- the wiring ---------------------------------------------------------------------------------
test("the bridge sanitises the three invokes and the push, and main handles each channel from registerIpc", () => {
  assert.match(preload, /scratchStats: \(options\) => ipcRenderer\.invoke\("scratch:stats", \{ open: options\?\.open === true \}\)/);
  assert.match(preload, /scratchCompact: \(\) => ipcRenderer\.invoke\("scratch:compact"\)/);
  assert.match(preload, /scratchSet: \(patch\) => ipcRenderer\.invoke\("scratch:set", \{\n\s+\.\.\.\(typeof patch\?\.enabled === "boolean"/);
  assert.match(preload, /\.\.\.\(Number\.isInteger\(patch\?\.capMB\) \? \{ capMB: patch\.capMB \} : \{\}\),/);
  assert.match(preload, /\.\.\.\(patch\?\.historyBodies === "auto" \|\| typeof patch\?\.historyBodies === "boolean" \? \{ historyBodies: patch\.historyBodies \} : \{\}\),/);
  assert.match(preload, /onScratchState: \(callback\) => ipcRenderer\.on\("scratch:state", \(_event, state\) => callback\(state\)\)/);
  for (const channel of ["scratch:stats", "scratch:compact", "scratch:set"]) assert.ok(block.includes(`ipcMain.handle("${channel}"`), `main handles ${channel}`);
  assert.ok(block.includes('send("scratch:state", view)'), "the push is named for the IPC audit");
  assert.match(main, /ipcMain\.handle\("resources:set"[^\n]*\n[^\n]*\n\s+if \(typeof scratchRegisterIpc === "function"\) scratchRegisterIpc\(\);/);
  assert.match(main, /if \(typeof scratchCloseAll === "function"\) \{ try \{ scratchCloseAll\(\)\.catch\(\(\) => \{\}\); \} catch \{/, "the quit hook closes every store");
  // Loaded on first use, never at launch: no store, rules or host module is required at module scope.
  assert.doesNotMatch(block, /^const \w+ = require\("\.\/scripts\/scratch/m);
  assert.doesNotMatch(main.slice(0, start) + main.slice(end), /require\("\.\/scripts\/scratch-(rules|host)\.cjs"\)/);
});
