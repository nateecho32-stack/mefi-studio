// settings.json and auth.json, JavaScript (main.cjs readSettings /
// writeSettings / settingsFromDisk with scripts/auth-store.cjs, run from
// main.cjs's own text as tests/settings_queue.test.mjs does) against Rust
// (crates/mefi-core settings, docs/rust-migration.md stage 2): the same
// steps on two identical userData folders give the same views, the same
// bytes in both files, the same copies of a broken file and the same log
// lines; and the credential rules (credentials.cjs), the auth split, JSON's
// own spelling and the project identity rules (projects.cjs) answer alike.
// Needs npm run host:core; skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const autonomy = require("../scripts/autonomy.cjs");
const authStore = require("../scripts/auth-store.cjs");
const credentials = require("../scripts/credentials.cjs");
const { createProjects, projectFromPath } = require("../scripts/projects.cjs");
const { createSettingsCache } = require("../scripts/settings-cache.cjs");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const CONST = (value) => ({ $mefi: "const", value });
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const values = (answers) => answers.map((answer) => (answer.ok ? answer.value : { thrown: answer.error }));

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main boundary: ${start}`);
  return main.slice(from, to);
};

const SAVED = { activeId: "project_0123456789abcdef", legacyPath: "C:\\Studio", items: [{ id: "project_0123456789abcdef", name: "app", path: "C:\\app" }] };

// main.cjs's own settings code, on one folder. With `cache`, readSettings
// answers through the settings cache the way main.cjs builds it (bigint stats
// of both files; no clock, so the stat alone decides, as in settings_cache).
function jsStore(dir, { cache = false } = {}) {
  const logs = [];
  const env = vm.createContext({
    autonomy, autonomySettings: autonomy.migrate({}), path, readFile, readFileSync, writeFileSync, authStore,
    SETTINGS_PATH: path.join(dir, "settings.json"), AUTH_PATH: path.join(dir, "auth.json"),
    projects: { saved: () => SAVED },
    logLine: (line) => logs.push(line),
    console: { error: (line) => logs.push(line) },
  });
  vm.runInContext(section("const settingsDisk =", "const projects = createProjects("), env);
  vm.runInContext(section("function rememberAutonomySettings(", "function send(channel, payload)"), env);
  if (cache) env.settingsCache = createSettingsCache({ files: [env.SETTINGS_PATH, env.AUTH_PATH], stat: (file) => stat(file, { bigint: true }), read: () => env.readSettingsFiles() });
  // A top-level const is not a property of the context: hand the health out.
  vm.runInContext("globalThis.settingsHealth = settingsDisk;", env);
  return { env, logs };
}

// What a folder holds after the steps, and the log, with the folder and the time taken out.
function outcome(dir, logs) {
  const read = (name) => (existsSync(path.join(dir, name)) && statSync(path.join(dir, name)).isFile() ? readFileSync(path.join(dir, name), "utf8") : null);
  const broken = readdirSync(dir).filter((name) => /^settings\.broken-.+\.json$/.test(name)).sort().map((name) => read(name));
  const words = (line) => line.split(dir).join("<dir>")
    .replace(/settings\.broken-[^ )]+?\.json/g, "settings.broken-<time>.json")
    .replace(/is unreadable \(.*\); copied it to/, "is unreadable (<why>); copied it to")
    .replace(/is unreadable \(.*\) and could not be copied aside: .*/, "is unreadable (<why>) and could not be copied aside")
    .replace(/could not be read: .*/, "could not be read: <why>");
  return { settings: read("settings.json"), auth: read("auth.json"), broken, logs: logs.map(words) };
}

// Steps: ["read"], ["write", next], ["put", name, text], ["dir", name]. The same on both folders.
async function scenario(t, label, files, steps, { seed = null } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-settings-parity-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dirs = { js: path.join(base, "js"), rs: path.join(base, "rs"), cached: path.join(base, "cached") };
  const apply = (dir, step) => {
    if (step[0] === "put") writeFileSync(path.join(dir, step[1]), step[2]);
    if (step[0] === "dir") mkdirSync(path.join(dir, step[1]), { recursive: true });
  };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) apply(dir, text === null ? ["dir", name] : ["put", name, text]);
  }

  const runJs = async (dir, options) => {
    const store = jsStore(dir, options);
    if (seed) Object.assign(store.env.settingsHealth, seed(dir));
    const answers = [];
    for (const step of steps) {
      if (step[0] === "read") answers.push(plain(await store.env.readSettings().catch((error) => ({ thrown: true, message: String(error?.message) }))));
      else if (step[0] === "write") answers.push(plain(await store.env.writeSettings(step[1]).catch((error) => ({ thrown: true, message: String(error?.message) }))));
      else apply(dir, step);
    }
    return { store, answers };
  };
  const { store: js, answers: expected } = await runJs(dirs.js);
  // The settings cache (MEFI_STUDIO_SETTINGS_CACHE, on by default) in front of
  // the same code: the same views, files and log, so Rust's equality holds for
  // the Electron build as shipped. Rust's store answers itself under the host.
  const cached = await runJs(dirs.cached, { cache: true });
  const noDir = (result) => JSON.parse(JSON.stringify(result).split(JSON.stringify(dirs.cached).slice(1, -1)).join("<dir>").split(JSON.stringify(dirs.js).slice(1, -1)).join("<dir>"));
  assert.deepEqual(noDir(cached.answers), noDir(expected), `${label}: the cached reads`);
  assert.deepEqual(outcome(dirs.cached, cached.store.logs), outcome(dirs.js, js.logs), `${label}: the files and the log with the cache on`);

  // Rust: one process per run of calls; the file's health crosses as the next run's seed.
  const context = { settingsPath: path.join(dirs.rs, "settings.json"), authPath: path.join(dirs.rs, "auth.json"), projects: SAVED, log: { $mefi: "fn", id: 1 } };
  let carried = seed ? seed(dirs.rs) : null;
  const answers = [];
  const logs = [];
  let batch = [];
  const flush = () => {
    if (!batch.length) return;
    const calls = batch.map(([name, ...args], index) => ({ function: `settings.${name}`, args: [{ ...context, ...(index === 0 && carried ? { seed: carried } : {}) }, ...args] }));
    calls.push({ function: "settings.health", args: [context] });
    const got = rust(calls);
    const health = got.pop().value;
    for (const answer of got) {
      for (const call of answer.called ?? []) logs.push(call.args[0]);
      answers.push(answer.ok ? plain(answer.value) : { thrown: true });
    }
    carried = health;
    batch = [];
  };
  for (const step of steps) {
    if (step[0] === "read") batch.push(["read"]);
    else if (step[0] === "write") batch.push(["write", step[1]]);
    else { flush(); apply(dirs.rs, step); }
  }
  flush();

  const reads = steps.filter((step) => step[0] === "read" || step[0] === "write");
  reads.forEach((step, index) => {
    const want = expected[index]?.thrown ? { thrown: true } : expected[index];
    assert.deepEqual(answers[index], want, `${label}: step ${index} (${step[0]})`);
  });
  const left = { js: outcome(dirs.js, js.logs), rs: outcome(dirs.rs, logs) };
  assert.deepEqual(left.rs, left.js, `${label}: the files and the log`);
  return left.js;
}

test("settings store: the same steps on two userData folders leave the same views, files, copies and log", { skip }, async (t) => {
  const fresh = await scenario(t, "fresh install", {}, [
    ["read"],
    ["write", { ui: { theme: "dark" }, zaiApiKeyEncrypted: "AA==", projects: { stale: true } }],
    ["read"],
    ["write", { ui: { theme: "light" }, githubTokenEncrypted: "BB==" }],
    ["write", { ui: { theme: "light" } }],
    ["write", { ui: {} }],
    ["read"],
  ]);
  assert.equal(fresh.auth, "{}", "a key removed from the view leaves auth.json too");
  assert.match(fresh.settings, /"projects": \{\n {4}"activeId"/, "the project list goes with every save");

  const legacy = await scenario(t, "legacy keys in settings.json", {
    "settings.json": JSON.stringify({ theme: "dark", apiKeyEncrypted: "K1", projects: { items: [] }, githubTokenEncrypted: null, z: 1 }),
    "auth.json": JSON.stringify({ zenApiKeyEncrypted: "Z", apiKeyEncrypted: "OLD", other: 5 }),
  }, [["read"], ["read"], ["write", { theme: "light", apiKeyEncrypted: "K2" }]]);
  assert.ok(!legacy.settings.includes("Encrypted"), "the keys left the preferences file");

  const never = await scenario(t, "broken, never good", { "settings.json": '{"ui": {' }, [
    ["read"],
    ["write", { ui: { a: 1 } }],
    ["read"],
    ["put", "settings.json", "[1,2]"],
    ["read"],
    ["write", { x: 1, openrouterApiKeyEncrypted: "OR" }],
    ["put", "settings.json", '{"ok":true}'],
    ["read"],
    ["write", { ok: false }],
    ["read"],
  ]);
  assert.equal(never.broken.length, 2, "each new broken text is copied aside once");

  const once = await scenario(t, "good, then broken", { "settings.json": '{"ui":{"a":1}}' }, [
    ["read"],
    ["put", "settings.json", '{"ui":'],
    ["read"],
    ["read"],
    ["write", { ui: { b: 2 } }],
    ["read"],
  ]);
  assert.equal(once.broken.length, 1);

  await scenario(t, "a folder where the file should be", { "settings.json": null }, [["read"], ["read"], ["write", { a: 1 }], ["read"]]);
  await scenario(t, "byte order mark", { "settings.json": "\uFEFF{}" }, [["read"], ["write", {}]]);
  await scenario(t, "empty file", { "settings.json": "" }, [["read"], ["read"]]);
  await scenario(t, "auth.json alone", { "auth.json": '{"zaiApiKeyEncrypted":"AA==","x":1}' }, [["read"], ["write", { theme: 1, zaiApiKeyEncrypted: "AA==" }]]);
  await scenario(t, "auth.json unreadable", { "settings.json": '{"a":1}', "auth.json": "not json" }, [["read"], ["write", { a: 2 }]]);
  await scenario(t, "spelling: integer keys, escapes, numbers", {
    "settings.json": '{"b":1,"10":2,"2":3,"01":4,"s":"\\u00e9\\u0001\\n\\"\\t\\\\/\\u2028","f":1.5,"big":1e21,"neg":-0.0,"exp":1E-7,"whole":2.0,"nested":{"z":[],"a":{},"l":[1,[2,{"k":null}],true]}}',
  }, [["read"], ["write", { b: 1, 10: 2, 2: 3, s: "é\u0001\n\"\t\\/\u2028", f: 1.5, big: 1e21, exp: 1e-7, nested: { z: [], a: {}, l: [1, [2, { k: null }], true] } }]]);
  await scenario(t, "seeded from the startup read", { "settings.json": "x" }, [["read"], ["write", { later: true }], ["read"]], {
    seed: (dir) => ({ good: '{"from":"seed","apiKeyEncrypted":"S"}', held: null, broken: "x", copy: path.join(dir, "settings.broken-earlier.json"), unreadable: true }),
  });
  await scenario(t, "seeded with held saves only", { "settings.json": "y" }, [["read"], ["write", { more: 1 }]], {
    seed: () => ({ good: null, held: '{"held":true}', broken: "y", copy: null, unreadable: true }),
  });
});

test("settings rules: credentials, the auth split, JSON spelling and project identity answer alike", { skip }, () => {
  const cases = [];
  const add = (label, fn, args, expected) => cases.push([label, { function: `settings.${fn}`, args }, plain(expected)]);
  add("authFields", "keys.authFields", [], authStore.authFields());
  add("envKeys", "keys.envKeys", [], credentials.ENV_KEYS);
  const envs = [{}, { MEFI_STUDIO_ZEN_KEY: " own " }, { OPENCODE_API_KEY: "shared" }, { OPENCODE_ZEN_API_KEY: "  ", OPENCODE_API_KEY: "second" }, { GH_TOKEN: "", GITHUB_TOKEN: "gh" }, { MEFI_STUDIO_KEY: "k", AI_GATEWAY_API_KEY: "g" }];
  for (const field of [...Object.keys(credentials.ENV_KEYS), "unknownField"]) {
    for (const env of envs) {
      add(`ownKey ${field}`, "keys.ownKey", [field, env], credentials.ownKey(field, env));
      add(`sharedKey ${field}`, "keys.sharedKey", [field, env], credentials.sharedKey(field, env));
      add(`envKey ${field}`, "keys.envKey", [field, env], credentials.envKey(field, env));
      for (const [settings, encryptionAvailable] of [[{}, true], [{ [field]: "blob" }, true], [{ [field]: "blob" }, false], [{ [field]: "" }, true], [null, true]]) {
        add(`keySource ${field}`, "keys.keySource", [settings, field, { env, encryptionAvailable }], credentials.keySource(settings, field, { env, encryptionAvailable }));
        add(`hasKey ${field}`, "keys.hasKey", [settings, field, { env, encryptionAvailable }], credentials.hasKey(settings, field, { env, encryptionAvailable }));
      }
    }
  }
  for (const settings of [{}, { theme: "dark", zaiApiKeyEncrypted: "AA==", githubTokenEncrypted: "BB==", routing: { provider: "zai" } }, { apiKeyEncrypted: null, z: 1, a: 2 }, { 3: "x", apiKeyEncrypted: "k", 1: "y" }]) {
    add("auth.split", "auth.split", [settings], authStore.splitAuthFields(settings));
    add("auth.merge", "auth.merge", [settings, { zaiApiKeyEncrypted: "NEW", notAField: "x", apiKeyEncrypted: "K" }], authStore.mergeAuthFields(settings, { zaiApiKeyEncrypted: "NEW", notAField: "x", apiKeyEncrypted: "K" }));
  }
  const shapes = [null, true, 0, -0, 1.5, 1e21, 1e-7, 123456789012, -42, "é\u0001\u001f\n\"\\\u2028\u00ff", [], {}, [1, [], {}, "x"], { b: 1, 10: 2, 2: 3, "01": 4, 4294967294: 5, 4294967295: 6, nested: { z: [null], a: {} } }];
  for (const value of shapes) {
    add(`stringify ${JSON.stringify(value)}`, "stringify", [value, ""], JSON.stringify(value));
    add(`stringify pretty ${JSON.stringify(value)}`, "stringify", [value, "  "], JSON.stringify(value, null, 2));
  }

  const base = mkdtempSync(path.join(tmpdir(), "mefi-projects-parity-"));
  try {
    const at = (name) => path.join(base, name);
    for (const name of ["studio", "app", "lib", "other", "studio/data"]) mkdirSync(at(name), { recursive: true });
    for (const [value, options] of [[at("app"), {}], [at("app") + path.sep, { name: "Named" }], [at("app"), { name: "x".repeat(120), legacy: true, explicit: true }], ["relative/app", {}], [42, {}], [path.parse(base).root, {}], [at("app").toUpperCase(), {}]]) {
      let expected;
      try { expected = projectFromPath(value, options); } catch (error) { expected = { thrown: error.message }; }
      add(`fromPath ${value}`, "projects.fromPath", [value, options], expected);
    }
    const id = (folder) => projectFromPath(at(folder)).id;
    const saved = {
      activeId: id("lib"), legacyPath: at("studio"),
      items: [{ path: at("studio") }, { path: at("app"), name: "App" }, { path: at("lib"), explicit: true }, { path: at("gone") }, null, { path: "relative" }, { path: at("app"), explicit: true }],
    };
    const runs = [
      [{ defaultRoot: at("studio"), studioRoot: at("studio"), saved }, ["list", "saved", "active", "open", "hasProjects", ["find", id("app")], ["find", id("studio")], ["dataPath", at("studio/data/eyes-tasks.json")], ["dataPath", at("studio/data/models.json")], ["dataPath", at("studio/data/projects/x.json")], ["dataPath", at("elsewhere.json")],
        ["add", at("other")], ["add", at("gone")], ["add", "relative"], ["select", id("other")], ["select", id("gone")], ["select", "nope"], ["remove", id("other")], "active", ["remove", id("other")], ["add", at("studio")], "list", ["remove", id("studio")], "list", "saved"]],
      [{ defaultRoot: at("studio"), studioRoot: at("studio"), saved: {} }, ["list", "saved", "active", "open", "hasProjects", ["dataPath", at("studio/data/a.json")], ["add", at("app")], "open", ["remove", id("app")], "active"]],
      [{ defaultRoot: at("studio"), studioRoot: at("studio"), saved: { ...saved, activeId: id("gone") }, preferredRoot: at("other") }, ["list", "active", "saved"]],
      [{ defaultRoot: at("studio"), studioRoot: at("studio"), saved: { items: [{ path: at("studio"), explicit: true }, { path: at("gone") }], activeId: 5 } }, ["list", "active", "saved"]],
    ];
    for (const [options, steps] of runs) {
      const projects = createProjects({ ...options, isDirectory: (root) => { try { return statSync(root).isDirectory(); } catch { return false; } } });
      const expected = steps.map((step) => {
        const [op, arg] = Array.isArray(step) ? step : [step];
        try {
          if (op === "dataPath") return projects.dataPath(arg, projects.active());
          const value = typeof projects[op] === "function" ? projects[op](arg) : undefined;
          return value === undefined ? null : value;
        } catch (error) { return { thrown: error.message }; }
      });
      add(`projects ${JSON.stringify(options.saved).slice(0, 40)}`, "projects.run", [options, steps.map((step) => (Array.isArray(step) ? { op: step[0], arg: step[1] } : { op: step }))], expected);
    }
    const answers = values(rust(cases.map(([, call]) => call)));
    cases.forEach(([label, , expected], index) => assert.deepEqual(answers[index], expected, label));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
