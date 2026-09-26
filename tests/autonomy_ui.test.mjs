import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createDom } from "./fixtures/renderer-dom.mjs";
const source = await readFile(new URL("../renderer/autonomy-ui.js", import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const plain = (value) => JSON.parse(JSON.stringify(value));
async function fixture() {
  const { document } = createDom();
  const calls = [], events = new Map();
  const config = { ok: true, projectId: "p", level: "auto", elevated: { grant: true, risk: true }, categories: [{ id: "grant", label: "Granting reach", blurb: "More access", warn: "This may widen file access." }, { id: "risk", label: "Irreversible changes", warn: "This may destroy data." }], decisions: [{ id: "d", label: "Retry", reason: "The connection recovered" }], todos: [{ id: "todo", text: "Connect the test device" }] };
  const learning = { ok: true, projectId: "p", decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: { project: [{ kind: "scope", n: 5, verbs: [{ verb: "narrow", share: .8 }] }], global: [] }, skills: { project: [{ taskType: "fix", model: "Fixture model", wins: 8, losses: 2, n: 10, p: .75 }], global: [] } };
  const api = {
    autonomyState: async () => structuredClone(config), learningState: async () => structuredClone(learning),
    autonomySet: async (value) => { calls.push(["set", plain(value)]); config.level = value.level || config.level; Object.assign(config.elevated, value.elevated); return structuredClone(config); },
    learningSet: async (value) => { calls.push(["learning", plain(value)]); if (value.decisions) Object.assign(learning.decisions, value.decisions); if (value.models) learning.models = value.models; return { ok: true }; },
    learningForget: async (value) => { calls.push(["forget", plain(value)]); learning.profiles.project = []; return { ok: true }; },
    autonomyUndo: async (value) => { calls.push(["undo", plain(value)]); config.decisions[0].undoPending = true; return { ok: true, pending: true }; },
    autonomyTodo: async (value) => { calls.push(["todo", plain(value)]); config.todos[0].doneAt = 1; return { ok: true }; },
  };
  const window = { mefiStudio: api, MefiWorkspace: { activeProjectId: () => "p" }, MefiNav: { register: (value) => calls.push(["register", value.id]) }, addEventListener: (name, fn) => events.set(name, fn), dispatchEvent() {} };
  vm.runInContext(source, vm.createContext({ window, document, CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args?.detail; } } }));
  await window.MefiAutonomy.refresh({ learning: true });
  return { window, document, calls, api, config, learning, ui: window.MefiAutonomy };
}

test("permission mode controls share saved state and the palette points at them", async () => {
  const h = await fixture(), a = h.document.createElement("div"), b = h.document.createElement("div");
  h.ui.mount(a, { id: "vibe-autonomy" }); h.ui.mount(b, { full: true });
  assert.equal(a.querySelector("#vibe-autonomy").textContent, "Auto");
  assert.ok(h.calls.some((row) => row[0] === "register" && row[1] === "settings:autonomy"));
  const accept = b.querySelectorAll(".autonomy-mode")[1]; await accept.click(); await settle();
  assert.equal(h.config.level, "accept");
  assert.equal(a.querySelector("#vibe-autonomy").textContent, "Accept per task");
  assert.equal(b.querySelectorAll(".autonomy-mode")[1].getAttribute("aria-checked"), "true");
});

test("each high-risk switch requires its inline warning before changing host policy", async () => {
  const h = await fixture(), root = h.document.createElement("div"); h.ui.mount(root, { full: true });
  const box = root.querySelector(".autonomy-elevated input"); box.checked = false; await box.trigger("change");
  assert.equal(h.calls.filter((row) => row[0] === "set").length, 0);
  assert.equal(box.checked, true);
  assert.match(root.querySelector(".autonomy-warning").textContent, /widen file access/);
  await root.querySelector(".autonomy-warning button").click(); await settle();
  assert.deepEqual(h.calls.find((row) => row[0] === "set")[1], { elevated: { grant: false }, confirmed: ["grant"] });
  assert.equal(h.config.elevated.grant, false);
});

test("learning scopes and forgetting are explicit and model strengths show measured counts", async () => {
  const h = await fixture(), root = h.document.createElement("div"); h.ui.mount(root, { full: true });
  const scopes = root.querySelectorAll("select"); scopes[1].value = "off"; await scopes[1].trigger("change"); await settle();
  assert.equal(h.learning.models, "off");
  await root.querySelector(".autonomy-preference button").click(); await settle();
  assert.deepEqual(h.calls.find((row) => row[0] === "forget")[1], { projectId: "p", scope: "project", kind: "scope", verb: "narrow" });
  const table = h.document.createElement("div"); h.ui.skills(table);
  assert.match(table.textContent, /Fixture model75%10/);
  assert.match(h.ui.best(), /8 of 10/);
});

test("history explains saved choices, reports pending Undo, and scopes human to-do actions", async () => {
  const h = await fixture(), root = h.document.createElement("div"); h.ui.history(root, h.ui.state());
  assert.match(root.textContent, /The connection recovered/);
  await root.querySelector(".autonomy-decision button").click(); await settle();
  assert.deepEqual(h.calls.find((row) => row[0] === "undo")[1], { id: "d", projectId: "p" });
  h.ui.history(root, h.ui.state()); assert.match(root.textContent, /Undo waits for the worker/);
  await root.querySelector(".autonomy-todo button").click(); await settle();
  assert.deepEqual(h.calls.find((row) => row[0] === "todo")[1], { id: "todo", action: "done", projectId: "p" });
});

test("failed saves keep the saved control value and show the failure on that control", async () => {
  const h = await fixture(), root = h.document.createElement("div"); h.ui.mount(root, { full: true });
  h.api.autonomySet = async () => ({ ok: false, error: "Settings could not be written" });
  await root.querySelectorAll(".autonomy-mode")[0].click(); await settle();
  assert.equal(h.config.level, "auto");
  assert.equal(root.querySelectorAll(".autonomy-mode")[2].getAttribute("aria-checked"), "true");
  assert.match(root.querySelector(".autonomy-note").textContent, /Settings could not be written/);
  assert.equal(h.ui.outcome({ dispatch: { held: true, message: "Waiting for approval" } }, "Started"), "Waiting for approval");
});
