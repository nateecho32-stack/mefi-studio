// settings.json is one file many writers share: every read-modify-write rides
// main.cjs updateSettings, and a file that stops parsing is copied aside and
// never rewritten from an empty view. The real readSettings / writeSettings /
// updateSettings / settingsFromDisk and the startup project read run here
// against a temporary userData folder; only the project store is a stub.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import authStore from "../scripts/auth-store.cjs";

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};

async function host(initial) {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-settings-"));
  const file = path.join(dir, "settings.json");
  if (initial !== undefined) await writeFile(file, initial);
  const logs = [];
  let savedProjects = {};
  const env = vm.createContext({
    path, readFile, readFileSync, writeFileSync, authStore,
    SETTINGS_PATH: file, AUTH_PATH: path.join(dir, "auth.json"),
    projects: { saved: () => savedProjects },
    logLine: (line) => logs.push(line),
    console: { error: (line) => logs.push(line) },
  });
  vm.runInContext(section("const settingsDisk =", "const projects = createProjects("), env);
  vm.runInContext(section("async function readSettings(", "function send(channel, payload)"), env);
  // The startup read is an object property in main.cjs; lift it as one.
  vm.runInContext(`var startup = {${section("  saved: (() => {", "  isDirectory:")}};`, env);
  savedProjects = env.startup.saved ?? {};
  return {
    dir, file, logs, env,
    update: (mutate) => env.updateSettings(mutate),
    // Through JSON: the view is built in the vm realm, the expectations here.
    read: async () => JSON.parse(JSON.stringify(await env.readSettings())),
    disk: async () => JSON.parse(await readFile(file, "utf8")),
    broken: async () => (await readdir(dir)).filter((name) => /^settings\.broken-.+\.json$/.test(name)),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("two concurrent updateSettings calls both land", async () => {
  const h = await host(JSON.stringify({ ui: { theme: "dark" }, projects: { active: "studio" } }));
  try {
    // Fired together: without one queue both would read the same file and the
    // later write would drop the earlier change.
    await Promise.all([
      h.update((settings) => { settings.ui = { ...settings.ui, blurMenu: false }; }),
      h.update((settings) => { settings.machine = { memoryWarn: 80 }; }),
      h.update((settings) => { settings.ui = { ...settings.ui, useWeb: true }; }),
    ]);
    const saved = await h.disk();
    assert.deepEqual(saved.ui, { theme: "dark", blurMenu: false, useWeb: true }, "both ui toggles and the untouched pref survive");
    assert.deepEqual(saved.machine, { memoryWarn: 80 });
    assert.deepEqual(saved.projects, { active: "studio" }, "the project list the startup read loaded is written back");
  } finally {
    await h.cleanup();
  }
});

test("a refused or failing change writes nothing and does not stall the queue", async () => {
  const h = await host(JSON.stringify({ ui: { theme: "dark" } }));
  try {
    const before = await readFile(h.file, "utf8");
    const view = await h.update((settings) => { settings.ui = { theme: "light" }; return false; });
    assert.equal(view.ui.theme, "light", "the caller still gets the view it edited");
    assert.equal(await readFile(h.file, "utf8"), before, "returning false writes nothing");
    await assert.rejects(h.update(() => { throw new Error("refused"); }), /refused/);
    await h.update((settings) => { settings.ui = { ...settings.ui, later: true }; });
    assert.deepEqual((await h.disk()).ui, { theme: "dark", later: true }, "the next save still runs");
  } finally {
    await h.cleanup();
  }
});

test("a missing settings.json is a fresh install: {} and the first save creates it", async () => {
  const h = await host(undefined);
  try {
    assert.deepEqual(await h.read(), {});
    await h.update((settings) => { settings.ui = { theme: "dark" }; });
    assert.deepEqual(await h.disk(), { ui: { theme: "dark" }, projects: {} });
    assert.deepEqual(await h.broken(), [], "nothing was broken, so nothing is copied aside");
    assert.deepEqual(h.logs, []);
  } finally {
    await h.cleanup();
  }
});

test("a corrupt settings.json at launch is copied aside and the next save cannot wipe it", async () => {
  // A torn write: the preferences and the project list are in there, unparseable.
  const torn = '{"ui":{"theme":"dark","blurMenu":false},"projects":{"active":"game","list":[{"id":"game","path":"C:/work/ga';
  const h = await host(torn);
  try {
    const copies = await h.broken();
    assert.equal(copies.length, 1, "the unreadable bytes are preserved beside the file");
    assert.equal(await readFile(path.join(h.dir, copies[0]), "utf8"), torn);
    assert.match(h.logs.join("\n"), /settings\.json is unreadable .*copied it to .*settings\.broken-/, "the startup read reports the copy");

    await h.update((settings) => { settings.ui = { ...settings.ui, useWeb: true }; });
    assert.equal(await readFile(h.file, "utf8"), torn, "no save rewrites the file (and its project list) from an empty view");
    assert.match(h.logs.at(-1), /change kept until restart only: settings\.json is unreadable/, "a held save says so");
    assert.deepEqual((await h.read()).ui, { useWeb: true }, "the session keeps its own change in memory");
    assert.equal((await h.broken()).length, 1, "re-reading the same bytes copies them once");

    // The owner repairs the file: it wins over what the session held.
    await writeFile(h.file, JSON.stringify({ ui: { theme: "dark" }, projects: { active: "game" } }));
    assert.deepEqual((await h.read()).ui, { theme: "dark" });
    await h.update((settings) => { settings.ui = { ...settings.ui, useWeb: true }; });
    assert.deepEqual((await h.disk()).ui, { theme: "dark", useWeb: true }, "saves reach the repaired file again");
  } finally {
    await h.cleanup();
  }
});

test("a file that breaks mid-session is copied aside and the next save merges onto the last good copy", async () => {
  const h = await host(JSON.stringify({ ui: { theme: "dark", blurMenu: false }, assistant: { proactive: false }, projects: { active: "game" } }));
  try {
    await h.update((settings) => { settings.ui = { ...settings.ui, useTree: false }; });
    await writeFile(h.file, "");
    assert.deepEqual((await h.read()).ui, { theme: "dark", blurMenu: false, useTree: false }, "the view falls back to the last copy written");
    assert.equal((await h.broken()).length, 1, "an empty (torn) file is preserved too");
    assert.match(h.logs.join("\n"), /settings\.json is unreadable/);

    await h.update((settings) => { settings.machine = { memoryWarn: 70 }; });
    const saved = await h.disk();
    assert.deepEqual(saved.ui, { theme: "dark", blurMenu: false, useTree: false }, "every preference survives the next toggle");
    assert.deepEqual(saved.assistant, { proactive: false });
    assert.deepEqual(saved.machine, { memoryWarn: 70 });
    assert.deepEqual(saved.projects, { active: "game" }, "the project list is not wiped");
  } finally {
    await h.cleanup();
  }
});

test("valid JSON that is not an object is treated as broken, never as {}", async () => {
  const h = await host("null");
  try {
    assert.deepEqual(await h.read(), {});
    assert.equal((await h.broken()).length, 1);
    await h.update((settings) => { settings.ui = { theme: "dark" }; });
    assert.equal(await readFile(h.file, "utf8"), "null", "held, not written");
  } finally {
    await h.cleanup();
  }
});

test("every settings writer in main.cjs goes through updateSettings", () => {
  const calls = [...main.matchAll(/await writeSettings\(/g)].map((match) => main.slice(0, match.index).split("\n").length);
  const queue = section("function updateSettings(", "function send(channel, payload)");
  assert.equal(calls.length, 1, `writeSettings is awaited only inside updateSettings (lines ${calls.join(", ")})`);
  assert.ok(queue.includes("await writeSettings(settings)"), "the one direct write is the queue's");
  assert.doesNotMatch(main, /catch \{ return \{\}; \}[^\n]*SETTINGS_PATH|SETTINGS_PATH[^\n]*catch \{ return \{\}; \}/, "no settings read swallows a failure as {}");
});
