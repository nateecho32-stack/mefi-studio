// main.cjs "Other apps" (docs/studio-api.md) in a vm, on a real loopback socket
// and a scratch key file: off by default, the switch opens and closes the
// endpoint and the key file, the key survives a restart and New key replaces
// it at once, a message to Mefi is the owner's chat marked with the app's name,
// a task is filed with origin.via "app" (held for the OK), a note reaches the
// page, every call lands in the log without its words, the setup prompt names
// this PC's folders, and the Claude Code skill is saved only over its own copy.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { callStudio } from "../scripts/studio-link.mjs";

const require = createRequire(import.meta.url);
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Other apps: the Studio API (docs/studio-api.md)");
const to = main.indexOf("// ---- end of other apps", from);
assert.ok(from > 0 && to > from, "main.cjs has an Other apps block");
const block = main.slice(from, to);
const settingsFrom = main.indexOf("function updateSettings(mutate) {");
const settingsBlock = main.slice(settingsFrom, main.indexOf("\nfunction send(", settingsFrom));
const plain = (value) => JSON.parse(JSON.stringify(value));

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-apps-host-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, "home", ".mefi-studio", "studio-api.json");
  const previous = process.env.MEFI_STUDIO_API_FILE;
  process.env.MEFI_STUDIO_API_FILE = keyFile;
  t.after(() => { if (previous === undefined) delete process.env.MEFI_STUDIO_API_FILE; else process.env.MEFI_STUDIO_API_FILE = previous; });
  return { dir, keyFile, env: { MEFI_STUDIO_API_FILE: keyFile } };
}

function host({ dir, settings = {}, projectOpen = true, held = false, snapshot = null, needs = { total: 0, items: [] } } = {}) {
  let saved = { studioApi: settings };
  const calls = [], sent = [], lines = [];
  const studioRoot = path.join(dir, "app");
  const context = vm.createContext({
    Date, Math, JSON, Number, String, Array, Object, Map, Set, Promise, Boolean, Error,
    process, path, existsSync, readFile, writeFile, mkdir, stat, setTimeout,
    os: { homedir: () => path.join(dir, "home"), release: () => "10.0.26200" },
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    optionalHelper: (_request, load) => load(),
    require: (name) => require(name.replace(/^\.\/scripts\//, "../scripts/")),
    app: { isPackaged: false, getVersion: () => "0.4.5", getPath: () => path.join(dir, "userData") },
    STUDIO_ROOT: studioRoot, SOURCE_ROOT: studioRoot,
    readSettings: async () => JSON.parse(JSON.stringify(saved)),
    settingsDisk: { queue: Promise.resolve() },
    writeSettings: async (value) => { saved = JSON.parse(JSON.stringify(value)); },
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: (line) => lines.push(line),
    projects: { open: () => (projectOpen ? { id: "p1", name: "Quillfold" } : null) },
    projectRoot: () => path.join(dir, "Quillfold"),
    agentsSnapshot: async () => snapshot,
    assistantNeedsYouDigest: async () => needs,
    assistantPause: async () => { calls.push(["pause"]); },
    releaseStartupHold: async () => { calls.push(["release"]); context.autopilot.held = false; },
    assistantControl: async (action) => { calls.push(["control", action]); },
    autopilot: { held },
    assistantMessage: async (text, options) => { calls.push(["message", text, plain(options)]); return { ok: true, reply: { text: `Mefi: got "${text}".` } }; },
    assistantCreateTask: async (fields) => { calls.push(["create", plain(fields)]); return { created: { id: "t7", title: fields.title }, existing: null }; },
    assistantAskForWork: (reason) => { calls.push(["ask", reason]); },
  });
  vm.runInContext(`${settingsBlock}\n${block}\nthis.api = { studioApiApply, studioApiSet, studioApiStatus, studioApiRekey, studioApiPrompt, studioApiSkill, studioApiHandle, server: () => studioApiServer, log: studioApiLog };`, context);
  return { api: context.api, calls, sent, lines, saved: () => saved, studioRoot };
}

test("off by default: nothing listens and no key file is written", async (t) => {
  const { dir, keyFile } = await scratch(t);
  const h = host({ dir });
  await h.api.studioApiApply();
  const status = await h.api.studioApiStatus();
  assert.deepEqual([status.ok, status.settings, status.running, status.url], [true, { on: false }, false, null]);
  assert.equal(existsSync(keyFile), false);
  assert.equal(status.keyFile, keyFile);
  assert.match(status.connect.claudeCode, /^claude mcp add --scope user mefi-studio -- node ".+\/app\/scripts\/studio-link\.mjs" mcp$/);
  assert.equal("token" in status, false, "the key never goes to the page");
  assert.ok(!JSON.stringify(status).includes("token"), "not even nested");
});

test("the switch opens the endpoint with a key file, apps reach it, and off closes it and deletes the file", async (t) => {
  const { dir, keyFile, env } = await scratch(t);
  const h = host({ dir, snapshot: { project: "Quillfold", state: "running", headline: "1 agent working", working: [], needsYou: 0, done: [], failed: [] } });
  t.after(() => h.api.server()?.stop());
  const on = await h.api.studioApiSet({ on: true });
  assert.deepEqual([on.settings, on.running], [{ on: true }, true]);
  assert.deepEqual(h.saved().studioApi, { on: true });
  const file = JSON.parse(await readFile(keyFile, "utf8"));
  assert.match(file.token, /^[a-f0-9]{48}$/);
  assert.equal(file.url, on.url);
  assert.equal(file.version, "0.4.5");
  const hello = await callStudio("/v1/hello", { env, app: "Claude Code" });
  assert.equal(hello.text, "Mefi's Studio AI+ 0.4.5 is here, with Quillfold open.");
  const status = await callStudio("/v1/status", { env });
  assert.match(status.text, /^\*\*Quillfold\*\* · 1 agent working/);
  assert.deepEqual(plain(h.api.log.map(({ app, route, ok }) => ({ app, route, ok }))), [{ app: "An app", route: "status", ok: true }, { app: "Claude Code", route: "hello", ok: true }]);
  await new Promise((done) => setTimeout(done, 400));
  const events = h.sent.filter(([channel]) => channel === "studio-api:event").length;
  assert.ok(events >= 1 && events <= 2, `Settings hears about the calls, coalesced (${events})`);
  const off = await h.api.studioApiSet({ on: false });
  assert.deepEqual([off.settings, off.running], [{ on: false }, false]);
  assert.equal(existsSync(keyFile), false, "off deletes the key");
  assert.match((await callStudio("/v1/status", { env })).text, /isn't reachable/);
});

test("the key survives a restart, and New key replaces it at once", async (t) => {
  const { dir, keyFile, env } = await scratch(t);
  const first = host({ dir, settings: { on: true } });
  await first.api.studioApiApply();
  const before = JSON.parse(await readFile(keyFile, "utf8")).token;
  await first.api.server().stop(); // the app quits: the file stays
  const second = host({ dir, settings: { on: true } });
  t.after(() => second.api.server()?.stop());
  await second.api.studioApiApply();
  assert.equal(JSON.parse(await readFile(keyFile, "utf8")).token, before, "a script set up before keeps working");
  assert.equal((await callStudio("/v1/hello", { env })).ok, true);
  const rekeyed = await second.api.studioApiRekey();
  assert.match(rekeyed.message, /^New key saved/);
  const after = JSON.parse(await readFile(keyFile, "utf8"));
  assert.notEqual(after.token, before);
  assert.equal(after.url, rekeyed.url);
  const stale = await fetch(`${after.url}/v1/hello`, { headers: { authorization: `Bearer ${before}` } });
  assert.equal(stale.status, 401, "the old key stops at once");
  assert.equal((await callStudio("/v1/hello", { env })).ok, true, "apps that read the file carry on");
  const closed = host({ dir });
  assert.equal((await closed.api.studioApiRekey()).ok, false, "no new key while closed");
});

test("a message is the owner's chat marked with the app; a task is held for the OK; a note reaches the page", async (t) => {
  const { dir } = await scratch(t);
  const h = host({ dir });
  const said = await h.api.studioApiHandle({ route: "say", fields: { text: "Add dark mode" }, app: "Claude Code" });
  assert.equal(said.text, 'Mefi: got "Add dark mode".');
  assert.deepEqual(h.calls[0], ["message", "Add dark mode", { app: "Claude Code" }]);
  const task = await h.api.studioApiHandle({ route: "task", fields: { title: "Add search", detail: "Fuzzy, over titles" }, app: "Codex" });
  assert.equal(task.text, 'Filed "Add search". It waits for the owner\'s OK in Studio, because it came from Codex.');
  const [, fields] = h.calls.find(([kind]) => kind === "create");
  assert.deepEqual(fields.origin, { kind: "chat", by: "owner", via: "app" });
  assert.equal(fields.prompt, "Add search\n\nFuzzy, over titles");
  assert.match(fields.details, /^Filed by Codex through Studio's API/);
  assert.ok(h.calls.some(([kind]) => kind === "ask"), "the queue hears about it");
  const note = await h.api.studioApiHandle({ route: "notify", fields: { text: "Build finished", title: "", level: "done" }, app: "Claude Code" });
  assert.equal(note.text, "Shown in Studio.");
  const notice = h.sent.find(([channel]) => channel === "studio-api:notice")[1];
  assert.deepEqual({ ...notice, at: 0 }, { at: 0, app: "Claude Code", title: "", text: "Build finished", level: "done" });
  await h.api.studioApiHandle({ route: "pause", fields: {}, app: "x" });
  await h.api.studioApiHandle({ route: "resume", fields: {}, app: "x" });
  assert.deepEqual(h.calls.filter(([kind]) => ["pause", "control", "release"].includes(kind)), [["pause"], ["control", "start-work"]]);
  assert.deepEqual(plain(h.api.log.map(({ route, note: kept }) => [route, kept ?? null])), [["resume", null], ["pause", null], ["notify", "done"], ["task", "filed"], ["say", null]]);
  assert.ok(!JSON.stringify(plain(h.api.log)).includes("dark mode"), "the log keeps no words");
});

test("with no project open, a message and a task are refused plainly", async (t) => {
  const { dir } = await scratch(t);
  const h = host({ dir, projectOpen: false });
  const said = await h.api.studioApiHandle({ route: "say", fields: { text: "hi" }, app: "x" });
  assert.deepEqual([said.ok, said.status], [false, 409]);
  assert.match(said.text, /No project is open in Studio/);
  assert.equal((await h.api.studioApiHandle({ route: "task", fields: { title: "x", detail: "" }, app: "x" })).status, 409);
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.log[0].ok, false);
});

test("the setup prompt and GET /v1/setup name this PC's folders, local docs when they are there", async (t) => {
  const { dir } = await scratch(t);
  const h = host({ dir });
  await mkdir(path.join(h.studioRoot, "docs"), { recursive: true });
  await writeFile(path.join(h.studioRoot, "docs", "architecture.md"), "#");
  const { prompt } = await h.api.studioApiPrompt();
  assert.ok(prompt.includes(`- Studio's folder: ${h.studioRoot} (a source checkout; run it with \`npm start\` there)`));
  assert.ok(prompt.includes(`- Studio's settings and data: ${path.join(dir, "userData")}`));
  assert.ok(prompt.includes(`- The project open in Studio: ${path.join(dir, "Quillfold")}`));
  assert.ok(prompt.includes(`${path.join(h.studioRoot, "docs", "architecture.md")} (how Studio works`), "a local doc by its path");
  assert.ok(prompt.includes("https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/studio-api.md"), "a missing one on GitHub");
  const setup = await h.api.studioApiHandle({ route: "setup", fields: {}, app: "Codex" });
  assert.equal(setup.text, prompt, "an app reads the same prompt the card copies");
  assert.equal(setup.data.folders.app, h.studioRoot);
  assert.match(setup.data.skill, /^---\nname: mefi-studio\n/);
});

test("the Claude Code skill is saved to ~/.claude/skills, but never over someone else's skill", async (t) => {
  const { dir } = await scratch(t);
  const h = host({ dir });
  const file = path.join(dir, "home", ".claude", "skills", "mefi-studio", "SKILL.md");
  const copied = await h.api.studioApiSkill({ save: false });
  assert.equal(existsSync(file), false, "copying writes nothing");
  const saved = await h.api.studioApiSkill({ save: true });
  assert.deepEqual([saved.ok, saved.file], [true, file]);
  assert.equal(await readFile(file, "utf8"), copied.text);
  assert.equal((await h.api.studioApiSkill({ save: true })).ok, true, "its own copy is refreshed");
  await writeFile(file, "---\nname: someone-else\n---\n");
  const refused = await h.api.studioApiSkill({ save: true });
  assert.equal(refused.ok, false);
  assert.equal(await readFile(file, "utf8"), "---\nname: someone-else\n---\n");
});

test("the kill switch keeps the door closed, and the bridge passes only the switch", async (t) => {
  const { dir, keyFile } = await scratch(t);
  process.env.MEFI_STUDIO_NO_APP_API = "1";
  t.after(() => { delete process.env.MEFI_STUDIO_NO_APP_API; });
  const h = host({ dir, settings: { on: true } });
  await h.api.studioApiApply();
  const status = await h.api.studioApiStatus();
  assert.deepEqual([status.killed, status.running], [true, false]);
  assert.equal(existsSync(keyFile), false);
  const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  const invoked = [];
  const page = { require: () => ({ contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) }, ipcRenderer: { invoke: async (channel, ...args) => { invoked.push([channel, plain(args)]); return { ok: true }; }, on: () => {} } }) };
  vm.runInNewContext(preload, page);
  await page.mefiStudio.studioApiSet({ on: true, token: "x", port: 1 });
  await page.mefiStudio.studioApiSet({ on: "yes" });
  await page.mefiStudio.studioApiSkill({ save: "yes", path: "C:/Windows" });
  assert.deepEqual(invoked, [["studio-api:set", [{ on: true }]], ["studio-api:set", [{}]], ["studio-api:skill", [{ save: false }]]]);
  assert.match(main, /const APP_WIDE_PREFIXES = \[[^\]]*"studio-api:"/, "it belongs to this PC, not to the open project");
  for (const channel of ["status", "set", "rekey", "prompt", "skill"]) assert.match(main, new RegExp(`ipcMain\\.handle\\("studio-api:${channel}"`), channel);
  assert.match(main, /const HELD_WHILE_HIDDEN = new Set\(\[[^\]]*"studio-api:event", "studio-api:notice"\]\);/, "a note sent while Studio is hidden waits for the window instead of toasting unseen");
});
