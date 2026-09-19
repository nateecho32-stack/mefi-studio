import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
const { createProjects, projectFromPath, containsPath } = createRequire(import.meta.url)("../scripts/projects.cjs");
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start) + start.length));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-projects-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const studio = path.join(root, "studio"), other = path.join(root, "other project");
  await mkdir(path.join(studio, "data"), { recursive: true });
  await mkdir(other);
  const projects = createProjects({ defaultRoot: studio, studioRoot: studio, isDirectory: (file) => { try { return statSync(file).isDirectory(); } catch { return false; } } });
  const secondary = projects.add(other);
  const eyes = {
    async readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; } },
    async writeJson(file, data) { await writeFile(file, JSON.stringify(data)); return { ok: true }; },
  };
  return { root, studio, other, projects, secondary, eyes, file: path.join(studio, "data", "eyes-tasks.json") };
}

test("project identities survive restart, reject relative roots and deduplicate folders", async (t) => {
  const f = await fixture(t);
  assert.equal(f.projects.add(f.other).id, f.secondary.id);
  assert.equal(f.projects.list().projects.length, 2);
  assert.throws(() => f.projects.add("relative-folder"), /absolute/);
  f.projects.select(f.secondary.id);
  const restored = createProjects({ defaultRoot: f.studio, studioRoot: f.studio, saved: f.projects.saved() });
  assert.equal(restored.active().id, f.secondary.id);
  assert.equal(projectFromPath(f.other).id, f.secondary.id);
  assert.equal(containsPath(f.other, `${f.other}-neighbor`), false);
});

test("legacy data stays byte-identical when adding and selecting another project", async (t) => {
  const f = await fixture(t);
  const original = '[{"id":"old","status":"done","title":"Legacy finished work"}]';
  await writeFile(f.file, original);
  const legacy = f.projects.active();
  f.projects.select(f.secondary.id);
  const scoped = f.projects.eyes(f.eyes);
  assert.deepEqual(await scoped.readJson(f.file, []), []);
  await scoped.writeJson(f.file, [{ id: "new", title: "Different work", status: "open" }]);
  assert.equal(await readFile(f.file, "utf8"), original);
  const rows = await scoped.readJson(f.file, []);
  assert.equal(rows[0].projectId, f.secondary.id);
  assert.equal(rows[0].projectPath, f.other);
  assert.equal(f.projects.dataPath(f.projects.dataPath(f.file)), f.projects.dataPath(f.file), "resolved paths are idempotent");
  assert.equal(f.projects.dataPath(path.join(f.studio, "data", "models.json")), path.join(f.studio, "data", "models.json"));
  f.projects.select(legacy.id);
  assert.equal((await f.projects.eyes(f.eyes).readJson(f.file, []))[0].id, "old");
  assert.equal(await readFile(f.file, "utf8"), original, "reading legacy metadata is nonmutating");
});

test("an explicit workspace override on restart cannot reassign the original legacy board", async (t) => {
  const f = await fixture(t);
  const legacy = f.projects.active();
  const restored = createProjects({ defaultRoot: f.other, preferredRoot: f.other, studioRoot: f.studio, saved: f.projects.saved() });
  assert.equal(restored.active().path, f.other);
  assert.equal(restored.active().legacy, undefined);
  assert.equal(restored.find(legacy.id).legacy, true);
  assert.equal(restored.dataPath(f.file, restored.find(legacy.id)), f.file);
  assert.notEqual(restored.dataPath(f.file), f.file, "the new root receives its own board instead of inheriting unrelated tasks");
});

test("captured async work and store facade retain their project through a selection change", async (t) => {
  const f = await fixture(t);
  const ready = deferred();
  const first = f.projects.active();
  const oldFacade = f.projects.eyes(f.eyes);
  let rootUsed;
  const pending = f.projects.run(first, async () => {
    await ready.promise;
    rootUsed = f.projects.current().path;
    await oldFacade.writeJson(f.file, [{ id: "first", title: "First project" }]);
  });
  f.projects.select(f.secondary.id);
  await f.projects.eyes(f.eyes).writeJson(f.file, [{ id: "second", title: "Second project" }]);
  ready.resolve();
  await pending;
  assert.equal(rootUsed, first.path);
  assert.equal((await f.projects.eyes(f.eyes).readJson(f.file, []))[0].id, "second");
  assert.equal((await oldFacade.readJson(f.file, []))[0].id, "first");
});

test("OpenCode sessions, chat, todos and changes stay inside the selected folder", async (t) => {
  const f = await fixture(t);
  const rows = [{ id: "mine", directory: f.studio }, { id: "nested", directory: path.join(f.studio, "src") }, { id: "neighbor", directory: `${f.studio}-neighbor` }, { id: "other", directory: f.other }];
  const activity = rows.map((row) => ({ sessionId: row.id }));
  const changes = [...activity, { sessionId: "mine", file: path.join(f.other, "private.js") }];
  let factsInput;
  const facade = f.projects.eyes({ ...f.eyes, listSessions: () => rows, listTodos: () => activity, listChanges: () => changes, listChatTexts: () => activity, activitySince: () => activity, assistantFacts: (input) => { factsInput = input; return { sessions: input.sessions, collisions: [] }; } });
  assert.deepEqual(facade.listSessions().map((row) => row.id), ["mine", "nested"]);
  for (const method of ["listTodos", "listChanges", "listChatTexts", "activitySince"]) assert.deepEqual(facade[method]().map((row) => row.sessionId), ["mine", "nested"]);
  assert.deepEqual(facade.assistantFacts().sessions.map((row) => row.id), ["mine", "nested"]);
  for (const key of ["changes", "todos"]) assert.deepEqual(factsInput[key].map((row) => row.sessionId), ["mine", "nested"], `${key} injected into fact assembly are project-scoped before any counts or summaries are calculated`);
  assert.equal(factsInput.root, f.studio);
});

test("invalid saved project falls back to legacy without losing the saved list", async (t) => {
  const f = await fixture(t);
  f.projects.select(f.secondary.id);
  const saved = f.projects.saved();
  await rm(f.other, { recursive: true });
  assert.throws(() => f.projects.select(f.secondary.id), /unavailable/);
  const restored = createProjects({ defaultRoot: f.studio, studioRoot: f.studio, saved, isDirectory: existsSync });
  assert.equal(restored.active().legacy, true);
  assert.equal(restored.list().projects.length, 2);
});

test("real host refuses a project change during a live build and keeps its identity", async (t) => {
  const f = await fixture(t);
  const first = f.projects.active().id;
  const context = vm.createContext({
    projects: f.projects, projectSwitching: false, autopilot: { jobs: [{ title: "building" }] },
    projectOperations: 0, projectAgentJobs: 0, projectBoardWrites: 0,
    pool: { running: new Map(), queue: [] }, assistantTickInFlight: null, assistantTickDemand: null,
    autopilotPassInFlight: null, executorFillInFlight: null, assistantWriting: null, assistantLoading: null, machineReadInFlight: null,
  });
  vm.runInContext(section("function projectBusyReason()", "function registerIpc()"), context);
  const result = await context.selectProject(f.secondary.id);
  assert.equal(result.ok, false);
  assert.match(result.error, /running build/);
  assert.equal(result.activeId, first);
  assert.equal(f.projects.active().id, first);
});

test("real IPC wrapper binds a pending handler to its original project", async (t) => {
  const f = await fixture(t), wait = deferred();
  const handlers = new Map();
  const context = vm.createContext({ projects: f.projects, projectSwitching: false, projectOperations: 0, originalIpcHandle: (name, callback) => handlers.set(name, callback), ipcMain: {} });
  vm.runInContext(section("function handleProjectIpc(", 'app.setName('), context);
  context.handleProjectIpc("tasks:fixture", async () => { await wait.promise; return f.projects.current().path; });
  const pending = handlers.get("tasks:fixture")({});
  assert.equal(context.projectOperations, 1);
  f.projects.select(f.secondary.id);
  wait.resolve();
  assert.equal(await pending, f.studio);
  assert.equal(context.projectOperations, 0);
  context.projectSwitching = true;
  assert.equal((await handlers.get("tasks:fixture")({})).ok, false);
});

test("normal background mode switches between cadence ticks and reloads its own conversation", async (t) => {
  const f = await fixture(t);
  const first = f.projects.active();
  const oldState = { status: "running", messages: [{ role: "user", text: "First project context" }] };
  const savedState = { status: "paused", messages: [{ role: "user", text: "Second project context" }] };
  const assistantFile = path.join(f.studio, "data", "eyes-assistant.json");
  await f.projects.eyes(f.eyes, f.secondary).writeJson(assistantFile, savedState);
  const sends = [], scheduled = [], cleared = [];
  const context = vm.createContext({
    projects: f.projects, projectSwitching: false, autopilot: { jobs: [], execute: false },
    projectOperations: 0, projectAgentJobs: 0, projectBoardWrites: 0,
    pool: { running: new Map(), queue: [] }, assistantTickInFlight: null, assistantTickDemand: null,
    autopilotPassInFlight: null, executorFillInFlight: null, assistantWriting: null, assistantLoading: null, machineReadInFlight: null,
    assistantState: oldState, assistantTimer: 77, assistantSaveTimer: 78, assistantEmitTimer: 79, assistantEmitPending: null,
    assistantPending: null, assistantSavedAt: 1, assistantLoop: true, machineReadCache: { old: true }, eyesLastTs: 0,
    assistantCache: { store: { old: true }, ingest: { newMaterial: true } },
    TASKS_PATH: f.file, REQUESTS_PATH: path.join(f.studio, "data", "eyes-requests.json"), IDEAS_PATH: path.join(f.studio, "data", "eyes-feature-ideas.json"),
    mkdir, statSync, path,
    clearTimeout: (id) => cleared.push(id),
    assistantWrite: () => f.projects.eyes(f.eyes).writeJson(assistantFile, context.assistantState),
    ensureAssistant: async () => { context.assistantState = await f.projects.eyes(f.eyes).readJson(assistantFile, { status: "running", messages: [] }); },
    readSettings: async () => ({}), writeSettings: async () => {},
    getEyes: async () => f.projects.eyes(f.eyes), send: (name, data) => sends.push([name, data]),
    emitAutopilot() {}, assistantSchedule: () => scheduled.push(f.projects.current().id),
  });
  vm.runInContext(section("function projectBusyReason()", "function registerIpc()"), context);
  assert.equal(context.projectBusyReason(), null, "a pending cadence timer does not lock the project selector");
  const result = await context.selectProject(f.secondary.id);
  assert.equal(result.ok, true);
  assert.equal(result.activeId, f.secondary.id);
  assert.equal(context.assistantState.messages[0].text, "Second project context");
  assert.deepEqual(JSON.parse(await readFile(assistantFile, "utf8")), oldState, "previous conversation saved to its original store");
  assert.deepEqual(scheduled, [f.secondary.id]);
  assert.deepEqual(cleared, [77, 78, 79]);
  assert.equal(context.projectSwitching, false);
  assert.equal(context.machineReadCache, null);
  assert.equal(context.assistantCache.ingest, undefined);
  assert.equal(sends.find(([channel]) => channel === "eyes:assistant")[1].state.projectId, f.secondary.id);
  const back = await context.selectProject(first.id);
  assert.equal(back.ok, true);
  assert.equal(context.assistantState.messages[0].text, "First project context");
});

test("a stalled assistant response body times out instead of retaining a project job indefinitely", async () => {
  const reading = deferred();
  let abortDeadline, cleared = 0;
  const context = vm.createContext({
    AbortController,
    setTimeout: (callback) => { abortDeadline = callback; return 1; },
    clearTimeout: () => { cleared += 1; },
    fetch: async (_url, { signal }) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("response body timeout")), { once: true });
        reading.resolve();
      }),
    }),
  });
  vm.runInContext(section("async function chatCompletion(", "// The Grok CLI"), context);
  const pending = context.chatCompletion("https://fixture.invalid", "fixture-key", "fixture-model", { model: "fixture-model" });
  await reading.promise;
  assert.equal(cleared, 0, "headers alone must not clear the request deadline");
  abortDeadline();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /response body timeout/);
  assert.equal(cleared, 1);
});
