// readSettings' memory (scripts/settings-cache.cjs and main.cjs's "Settings
// cache" block): a hit answers from a clone while both files keep their stat,
// and nothing a writer does can leave the old view behind. The pure rules run
// on fake stats; the real readSettings / readSettingsFiles / writeSettings /
// updateSettings slice then runs with the cache on, over real files.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import autonomy from "../scripts/autonomy.cjs";
import authStore from "../scripts/auth-store.cjs";
import cacheModule from "../scripts/settings-cache.cjs";

const { createSettingsCache, RACY_MS } = cacheModule;
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};
const flush = async () => { for (let count = 0; count < 20; count += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Two fake files by name. A stat is { dev, ino, size, mtimeNs, mtimeMs } as
// stat({ bigint: true }) gives it; null is a missing file, an Error a failed stat.
const statOf = (ms, { size = 120, ino = 7 } = {}) => ({ dev: 1n, ino: BigInt(ino), size: BigInt(size), mtimeNs: BigInt(ms) * 1000000n, mtimeMs: BigInt(ms) });
const LONG_AGO = 1000;
const NOW = LONG_AGO + 60 * 60 * 1000;
function disk(initial) {
  const files = new Map(Object.entries(initial));
  return {
    stat: async (file) => {
      const found = files.get(file);
      if (found instanceof Error) throw found;
      if (!found) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
      return found;
    },
    set: (file, value) => files.set(file, value),
  };
}
function counted(values, { cacheable = true } = {}) {
  const reader = { reads: 0, next: values };
  reader.read = async () => {
    reader.reads += 1;
    return { value: structuredClone(typeof reader.next === "function" ? reader.next() : reader.next), cacheable };
  };
  return reader;
}

test("a hit answers from memory, with its own copy for every caller", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  const reader = counted({ ui: { theme: "dark" }, zenApiKeyEncrypted: "AA==" });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => NOW });
  const first = await cache.get();
  const second = await cache.get();
  assert.equal(reader.reads, 1, "the second call reads neither file");
  assert.deepEqual(second, first);
  assert.notEqual(second, first, "never the same object twice");
  first.ui.theme = "light";
  second.ui.theme = "violet";
  assert.equal((await cache.get()).ui.theme, "dark", "a caller's edit never reaches the kept copy or another caller");
  assert.deepEqual(cache.stats(), { hits: 2, misses: 1, joins: 0, stores: 1, invalidations: 0, cached: true });
});

test("a changed mtime, size or inode on either file reads both again", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  const reader = counted({ n: 1 });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => NOW });
  await cache.get();
  const changes = [
    ["settings", statOf(LONG_AGO + 1)],
    ["settings", { ...statOf(LONG_AGO + 1), mtimeNs: statOf(LONG_AGO + 1).mtimeNs + 1n }],
    ["settings", statOf(LONG_AGO + 1, { size: 121 })],
    ["auth", statOf(LONG_AGO, { ino: 8 })],
    ["auth", null],
  ];
  let expected = 1;
  for (const [file, value] of changes) {
    files.set(file, value);
    await cache.get();
    await cache.get();
    expected += 1;
    assert.equal(reader.reads, expected, `a new ${file} stat (${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item)}) reads once, then hits`);
  }
});

test("invalidate() reads again even when neither stat moved", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  const reader = counted({ ui: { theme: "dark" } });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => NOW });
  await cache.get();
  reader.next = { ui: { theme: "light" } };
  cache.invalidate();
  assert.equal((await cache.get()).ui.theme, "light", "a same-size write inside one timestamp tick still shows");
  assert.equal(reader.reads, 2);
  await cache.get();
  assert.equal(reader.reads, 2, "and the fresh view is kept");
});

test("a read that says it is not cacheable (unreadable settings, a migration, a lost auth read) is never kept", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  const reader = counted({ ui: {} }, { cacheable: false });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => NOW });
  for (let count = 0; count < 3; count += 1) await cache.get();
  assert.equal(reader.reads, 3);
  assert.equal(cache.stats().cached, false);
});

test("a write that lands during a read never leaves the old view behind", async () => {
  // Another process writes: the stat moves while the read is in flight.
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  let gate = deferred(), reads = 0, onDisk = "old";
  const cache = createSettingsCache({
    files: ["settings", "auth"], stat: files.stat, now: () => NOW,
    read: async () => { reads += 1; const seen = onDisk; await gate.promise; return { value: { version: seen }, cacheable: true }; },
  });
  const during = cache.get();
  await flush();
  onDisk = "new";
  files.set("settings", statOf(LONG_AGO + 5));
  gate.resolve();
  assert.equal((await during).version, "old", "the overlapping call may see either; it saw the old");
  assert.equal((await cache.get()).version, "new", "the next call reads the new file");
  assert.equal(reads, 2);

  // This process writes: invalidate() mid-read, and the stat never moves.
  const same = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  gate = deferred(); reads = 0; onDisk = "old";
  const own = createSettingsCache({
    files: ["settings", "auth"], stat: same.stat, now: () => NOW,
    read: async () => { reads += 1; const seen = onDisk; await gate.promise; return { value: { version: seen }, cacheable: true }; },
  });
  const overlapping = own.get();
  await flush();
  own.invalidate(); // writeSettings, before the write
  onDisk = "new";
  own.invalidate(); // and after it
  const joiner = own.get();
  await flush();
  assert.equal(reads, 2, "a call after the write does not join the read that began before it");
  gate.resolve();
  assert.equal((await overlapping).version, "old");
  assert.equal((await joiner).version, "new");
  assert.equal((await own.get()).version, "new", "the pre-write read was never kept");
  assert.equal(reads, 2, "the post-write read was");
});

test("a missing file is a key of its own; any other stat failure is never cached", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: null });
  const reader = counted({ ui: {} });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => NOW });
  await cache.get();
  await cache.get();
  assert.equal(reader.reads, 1, "a fresh install with no auth.json still hits");
  files.set("auth", statOf(LONG_AGO));
  await cache.get();
  assert.equal(reader.reads, 2, "the auth file appearing is a change");
  files.set("auth", Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }));
  await cache.get();
  await cache.get();
  assert.equal(reader.reads, 4, "a stat that fails for another reason proves nothing");
  assert.equal(cache.stats().cached, false);
});

test("a file modified within the racy window is not trusted until it ages", async () => {
  let now = LONG_AGO + 10;
  const files = disk({ settings: statOf(LONG_AGO), auth: null });
  const reader = counted({ ui: {} });
  const cache = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read, now: () => now });
  await cache.get();
  await cache.get();
  assert.equal(reader.reads, 2, "FAT keeps mtimes to 2 s: a same-size write in that window could keep the stat");
  now = LONG_AGO + RACY_MS;
  await cache.get();
  await cache.get();
  assert.equal(reader.reads, 3, "once the file is older than the window, its stat is trusted");
  const clockless = createSettingsCache({ files: ["settings", "auth"], stat: files.stat, read: reader.read });
  await clockless.get();
  await clockless.get();
  assert.equal(reader.reads, 4, "without a clock the stat alone decides");
});

test("concurrent misses on one stat share one read, and each caller gets its own copy", async () => {
  const files = disk({ settings: statOf(LONG_AGO), auth: statOf(LONG_AGO) });
  const gate = deferred();
  let reads = 0;
  const cache = createSettingsCache({
    files: ["settings", "auth"], stat: files.stat, now: () => NOW,
    read: async () => { reads += 1; await gate.promise; return { value: { ui: { theme: "dark" } }, cacheable: true }; },
  });
  const calls = [cache.get(), cache.get(), cache.get()];
  await flush();
  gate.resolve();
  const views = await Promise.all(calls);
  assert.equal(reads, 1, "the launch's burst of IPC reads costs one read");
  assert.equal(new Set(views).size, 3, "three separate objects");
  views[0].ui.theme = "light";
  assert.deepEqual(views.slice(1).map((view) => view.ui.theme), ["dark", "dark"]);
  assert.equal(cache.stats().joins, 2);
});

test("hasContent: an auth file larger than {} that read as no keys was a failed read", async () => {
  const files = disk({ empty: statOf(LONG_AGO, { size: 2 }), keys: statOf(LONG_AGO, { size: 900 }), gone: null, locked: Object.assign(new Error("EBUSY"), { code: "EBUSY" }) });
  const cache = createSettingsCache({ files: [], stat: files.stat, read: async () => ({ value: {} }) });
  assert.equal(await cache.hasContent("empty"), false);
  assert.equal(await cache.hasContent("keys"), true);
  assert.equal(await cache.hasContent("gone"), false);
  assert.equal(await cache.hasContent("locked"), true, "unknown counts as holding something, so nothing is kept");
});

// ---- the real host slice, with the cache on -------------------------------------

async function host(initial, { auth } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-settings-cache-"));
  const file = path.join(dir, "settings.json");
  const authFile = path.join(dir, "auth.json");
  if (initial !== undefined) await writeFile(file, initial);
  if (auth !== undefined) await writeFile(authFile, auth);
  let diskReads = 0;
  const logs = [];
  const env = vm.createContext({
    autonomy, autonomySettings: autonomy.migrate({}), path, readFileSync, writeFileSync, authStore,
    readFile: (target, ...rest) => { if (target === file) diskReads += 1; return readFile(target, ...rest); },
    SETTINGS_PATH: file, AUTH_PATH: authFile,
    projects: { saved: () => ({}) },
    logLine: (line) => logs.push(line),
    console: { error: (line) => logs.push(line) },
  });
  vm.runInContext(section("const settingsDisk =", "const projects = createProjects("), env);
  vm.runInContext(section("function rememberAutonomySettings(", "function send(channel, payload)"), env);
  // The files are written moments before they are read, so the racy guard (a
  // pure-rules case above) would hold every one; without a clock the stat decides.
  env.settingsCache = createSettingsCache({ files: [file, authFile], stat: (target) => stat(target, { bigint: true }), read: () => env.readSettingsFiles() });
  return {
    dir, file, authFile, logs, env,
    reads: () => diskReads,
    read: async () => JSON.parse(JSON.stringify(await env.readSettings())),
    update: (mutate) => env.updateSettings(mutate),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("host: repeated reads hit, a save shows at once, and an edit from outside is seen", async () => {
  const h = await host(JSON.stringify({ ui: { theme: "dark" } }));
  try {
    assert.deepEqual((await h.read()).ui, { theme: "dark" });
    await h.read();
    await h.read();
    assert.equal(h.reads(), 1, "three readSettings calls, one read of settings.json");
    await h.update((settings) => { settings.ui = { ...settings.ui, blurMenu: false }; });
    assert.deepEqual((await h.read()).ui, { theme: "dark", blurMenu: false }, "writeSettings invalidated the kept view");
    const afterSave = h.reads();
    await h.read();
    assert.equal(h.reads(), afterSave, "and the saved view is kept again");
    // Another process (a --set-key run, an editor) rewrites the file.
    await writeFile(h.file, JSON.stringify({ ui: { theme: "light", edited: "outside" } }));
    assert.deepEqual((await h.read()).ui, { theme: "light", edited: "outside" });
    const view = await h.env.readSettings();
    view.ui.theme = "mutated";
    assert.equal((await h.read()).ui.theme, "light", "a caller's edit never reaches the next caller");
    assert.equal(h.env.autonomySettings && typeof h.env.autonomySettings, "object", "every answer still passes through rememberAutonomySettings");
  } finally {
    await h.cleanup();
  }
});

test("host: two concurrent updateSettings calls both land with the cache on", async () => {
  const h = await host(JSON.stringify({ ui: { theme: "dark" }, projects: { active: "studio" } }));
  try {
    await h.read();
    await Promise.all([
      h.update((settings) => { settings.ui = { ...settings.ui, blurMenu: false }; }),
      h.update((settings) => { settings.machine = { memoryWarn: 80 }; }),
      h.update((settings) => { settings.ui = { ...settings.ui, useWeb: true }; }),
    ]);
    const saved = JSON.parse(await readFile(h.file, "utf8"));
    assert.deepEqual(saved.ui, { theme: "dark", blurMenu: false, useWeb: true });
    assert.deepEqual(saved.machine, { memoryWarn: 80 });
  } finally {
    await h.cleanup();
  }
});

test("host: an unreadable settings.json is never kept, and the repaired file wins", async () => {
  const h = await host('{"ui":{"theme":"dark"');
  try {
    await h.read();
    await h.read();
    assert.equal(h.reads(), 2, "the fallback view is read again on every call");
    await writeFile(h.file, JSON.stringify({ ui: { theme: "dark", repaired: true } }));
    assert.deepEqual((await h.read()).ui, { theme: "dark", repaired: true });
    await h.read();
    assert.equal(h.reads(), 3, "a readable file is kept again");
  } finally {
    await h.cleanup();
  }
});

test("host: an auth file with content that reads as no keys is never kept", async () => {
  const h = await host(JSON.stringify({ ui: {} }), { auth: "{not json yet" });
  try {
    assert.equal((await h.read()).zenApiKeyEncrypted, undefined);
    await h.read();
    assert.equal(h.reads(), 2, "an auth read that lost its keys is not remembered as 'no keys saved'");
    await writeFile(h.authFile, JSON.stringify({ zenApiKeyEncrypted: "AA==" }));
    assert.equal((await h.read()).zenApiKeyEncrypted, "AA==");
    await h.read();
    assert.equal(h.reads(), 3, "a good auth read is kept");
  } finally {
    await h.cleanup();
  }
});

test("host: a missing settings.json is a fresh install, kept until the first save creates it", async () => {
  const h = await host(undefined);
  try {
    assert.deepEqual(await h.read(), {});
    await h.read();
    assert.equal(h.reads(), 1, "readFile is tried (ENOENT) only on the first call");
    await h.update((settings) => { settings.ui = { theme: "dark" }; });
    assert.deepEqual((await h.read()).ui, { theme: "dark" });
  } finally {
    await h.cleanup();
  }
});

// ---- where main.cjs hooks it in -------------------------------------------------

test("main.cjs: the cache is behind MEFI_STUDIO_SETTINGS_CACHE=0 and keyed on bigint stats of both files", () => {
  const block = section("// ---- Settings cache ---", "// ---- end of the settings cache ---");
  assert.match(block, /const settingsCache = process\.env\.MEFI_STUDIO_SETTINGS_CACHE === "0" \? null/);
  assert.ok(block.includes("files: [SETTINGS_PATH, AUTH_PATH]"));
  assert.ok(block.includes("stat: (file) => stat(file, { bigint: true })"));
  assert.ok(block.includes("read: () => readSettingsFiles()"));
  assert.ok(main.indexOf("// ---- Settings cache ---") < main.indexOf("const settingsDisk ="), "outside the settings_queue slices, which run without it");
  const read = section("async function readSettings()", "// Both files as they are on disk");
  assert.ok(read.includes('if (typeof settingsCache !== "undefined" && settingsCache) return rememberAutonomySettings(await settingsCache.get());'));
  assert.ok(read.includes("return rememberAutonomySettings((await readSettingsFiles()).value);"), "without the cache every call reads, as before");
});

test("main.cjs: every write to settings.json or auth.json invalidates the cache", () => {
  const writes = [...main.matchAll(/(atomicWriteJson|writeAuthStore)\((SETTINGS_PATH|AUTH_PATH)/g)];
  assert.ok(writes.length >= 4, "writeSettings' two writes and the migration's two");
  for (const write of writes) {
    const start = main.lastIndexOf("\nasync function ", write.index);
    const end = main.indexOf("\n}\n", write.index);
    const body = main.slice(start, end);
    const name = /async function (\w+)/.exec(body)[1];
    assert.ok(body.includes("settingsCache.invalidate()"), `${name} writes ${write[2]} and must invalidate the settings cache`);
  }
  const write = section("async function writeSettings(", "// One verdict for every settings.json read");
  const invalidations = [...write.matchAll(/settingsCache\.invalidate\(\)/g)].map((match) => match.index);
  assert.equal(invalidations.length, 2);
  assert.ok(invalidations[0] < write.indexOf("atomicWriteJson(SETTINGS_PATH"), "before the files change");
  assert.ok(invalidations[1] > write.indexOf("writeAuthStore(AUTH_PATH"), "and after");
});

test("main.cjs: under the Rust host readSettings answers from Rust's store and never from the cache", async () => {
  const read = section("async function readSettings()", "// Both files as they are on disk");
  assert.ok(read.indexOf("const rust = rustSettings();") < read.indexOf("settingsCache.get()"), "Rust's store is asked first");
  const calls = [];
  const env = vm.createContext({
    rememberAutonomySettings: (value) => value,
    rustSettings: () => ({ read: async () => { calls.push("rust"); return { from: "rust" }; } }),
    settingsCache: { get: async () => { calls.push("cache"); return { from: "cache" }; } },
    readSettingsFiles: async () => { calls.push("files"); return { value: { from: "files" } }; },
  });
  vm.runInContext(`${read}\nthis.readSettings = readSettings;`, env);
  assert.deepEqual(await env.readSettings(), { from: "rust" });
  env.rustSettings = () => false;
  assert.deepEqual(await env.readSettings(), { from: "cache" }, "the Electron build reads through the cache");
  env.settingsCache = null;
  assert.deepEqual(await env.readSettings(), { from: "files" }, "and with MEFI_STUDIO_SETTINGS_CACHE=0 reads both files");
  assert.deepEqual(calls, ["rust", "cache", "files"]);
  const write = section("async function writeSettings(", "// One verdict for every settings.json read");
  assert.ok(write.indexOf("settingsCache.invalidate()") < write.indexOf("const rust = rustSettings();"), "a write under the host still forgets the Electron view first");
});
