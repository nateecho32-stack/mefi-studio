import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import executorActivity from "../scripts/executor-activity.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
function host() {
  const context = new AsyncLocalStorage(), handlers = {}, listeners = {}, calls = [], reads = [], sent = [];
  let active = { id: "p1", path: "C:/fixture/project-one" };
  const service = Object.fromEntries(["status", "start", "open", "stop"].map((action) => [action, async (project, options) => { calls.push({ action, project, options }); return { ok: true, projectId: project.id, phase: "stopped" }; }]));
  service.closeAll = async () => { calls.push({ action: "closeAll" }); };
  service.disposeSync = () => calls.push({ action: "disposeSync" });
  const webContents = { mainFrame: {} }, window = { webContents, isDestroyed: () => false };
  const env = vm.createContext({
    require: () => ({ createProjectPreview: (options) => { service.options = options; return service; } }),
    projects: { active: () => active, current: () => context.getStore() || active, open: () => true, run: (project, callback) => context.run(project, callback) },
    projectSwitching: false, executorActivity, window, TASKS_PATH: "tasks",
    autopilot: { jobs: [{ projectId: "p1", outputTail: ["worker http://127.0.0.1:3010/"] }, { projectId: "p2", outputTail: ["other http://127.0.0.1:9999/"] }] },
    getEyes: async () => { const project = context.getStore() || active; return { readJson: async () => { reads.push(project.id); return [{ id: "task1", updatedAt: 2, logs: [{ text: "saved http://127.0.0.1:3000/" }] }]; } }; },
    shell: { openExternal: async (url) => calls.push({ action: "shell", url }) }, send: (...args) => sent.push(args),
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    app: { on: (name, fn) => { listeners[name] = fn; }, quit: () => calls.push({ action: "quit" }) },
    process: { on: (name, fn) => { listeners[name] = fn; } },
  });
  vm.runInContext(section("// ---- Project app previews:", "// Catalogs are shared across projects."), env);
  env.registerProjectPreviewIpc();
  return { env, service, handlers, listeners, calls, reads, sent, event: { sender: webContents, senderFrame: webContents.mainFrame }, active: (next) => { active = next; } };
}

test("preview bridge reads current-project evidence and rejects stale projects and foreign renderers", async () => {
  const h = host();
  await h.handlers["project-preview:status"](h.event, { projectId: "p1" });
  assert.deepEqual(h.reads, ["p1"]);
  assert.equal(h.calls[0].action, "status");
  assert.equal(h.calls[0].project.id, "p1");
  assert.match(h.calls[0].options.urls.join(" "), /:3010.*:3000/);
  assert.doesNotMatch(h.calls[0].options.urls.join(" "), /9999/);
  assert.equal((await h.handlers["project-preview:start"](h.event, { projectId: "p2" })).ok, false);
  assert.equal((await h.handlers["project-preview:start"]({ sender: {} }, { projectId: "p1" })).ok, false);
  assert.equal((await h.handlers["project-preview:start"]({ ...h.event, senderFrame: {} }, { projectId: "p1" })).ok, false);
  assert.equal(h.calls.length, 1, "refused controls cannot start or probe anything");
});

test("a project switch during an awaited evidence read cannot start a preview in the wrong folder", async () => {
  const h = host(); let release;
  h.env.getEyes = async () => ({ readJson: () => new Promise((resolve) => { release = resolve; }) });
  const pending = h.handlers["project-preview:start"](h.event, { projectId: "p1" });
  await new Promise((resolve) => setImmediate(resolve));
  h.active({ id: "p2", path: "C:/fixture/project-two" }); release([]);
  assert.equal((await pending).ok, false); assert.equal(h.calls.length, 0);
});

test("project adoption awaits owned preview cleanup before changing project state and preserves stop failures", async () => {
  const h = host(), previous = { id: "p1", path: "C:/fixture/project-one" };
  h.env.projectPreviewService();
  h.service.stop = async (project, options) => { h.calls.push({ action: "stop", project, options }); return { ok: false, error: "owned process still stopping" }; };
  vm.runInContext(section("async function adoptProject(", "// Only a running build"), h.env);
  await assert.rejects(h.env.adoptProject(previous, { id: "p2" }), /owned process still stopping/);
  assert.equal(h.calls[0].project, previous); assert.equal(h.calls[0].options.cleanup, true);
});

test("quit drains preview ownership once and app.exit has an owned-process cleanup fallback", async () => {
  const h = host(); h.env.projectPreviewService();
  let release, prevented = 0;
  h.service.closeAll = () => new Promise((resolve) => { h.calls.push({ action: "closeAll" }); release = resolve; });
  const event = { preventDefault: () => prevented++ };
  h.listeners["before-quit"](event); h.listeners["before-quit"](event);
  assert.equal(prevented, 2); assert.equal(h.calls.filter((call) => call.action === "closeAll").length, 1);
  assert.equal((await h.handlers["project-preview:start"](h.event, { projectId: "p1" })).ok, false);
  release(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.at(-1).action, "quit"); h.listeners["before-quit"](event); assert.equal(prevented, 2);
  h.listeners.exit(); assert.equal(h.calls.at(-1).action, "disposeSync");
});

test("preload exposes only explicit preview controls and its status event", async () => {
  const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
  const invokes = [], events = [];
  const page = { require: () => ({ contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) }, ipcRenderer: { invoke: (...args) => invokes.push(args), on: (...args) => events.push(args) }, webUtils: {} }) };
  vm.runInNewContext(preload, page);
  const api = page.mefiStudio;
  api.projectPreviewStatus({ projectId: "p1" }); api.projectPreviewStart({ projectId: "p1" }); api.projectPreviewOpen({ projectId: "p1" }); api.projectPreviewStop({ projectId: "p1" }); api.onProjectPreview(() => {});
  assert.deepEqual(invokes.map(([name]) => name), ["project-preview:status", "project-preview:start", "project-preview:open", "project-preview:stop"]);
  assert.equal(events[0][0], "project-preview:changed");
});
