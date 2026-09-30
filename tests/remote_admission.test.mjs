// Work asked for from Discord waits for the owner's OK in every permission
// mode (docs/remote.md, autonomy.remoteWork reads origin.via "remote"). This
// runs the real chat create_task path (main.cjs assistantChatAction into
// assistantCreateTask) through the real admission gate
// (scripts/work-admission.cjs): tests/remote_gate.test.mjs stubs
// assistantCreateTask, and the admission gate's origin kept only kind and by,
// so Discord work was saved without `via` and ran unapproved under Auto.
//
// Run: node --test tests/remote_admission.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const autonomy = require("../scripts/autonomy.cjs");
const backlog = require("../scripts/backlog.cjs");
const remote = require("../scripts/remote.cjs");
const workAdmission = require("../scripts/work-admission.cjs");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const functionSource = (name) => {
  const start = main.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `main.cjs defines ${name}`);
  return main.slice(start, main.indexOf("\n}\n", start) + 3);
};

function studio() {
  const board = { tasks: [], requests: [], ideas: [] };
  const context = vm.createContext({
    String, Number, Math, Array, Set, Promise, JSON, Object,
    crypto, workAdmission, remoteRules: remote,
    projects: { current: () => ({ id: "p1" }) }, projectRoot: () => "C:/p1",
    mutateBoard: async (change) => change(board),
    autopilot: { jobs: [] }, taskDelegation: {}, logLine: () => {},
    assistantTaskAdmitted: async () => {}, assistantAskForWork: () => {},
    getEyes: async () => ({ readJson: async () => board.tasks }), TASKS_PATH: "tasks.json",
  });
  vm.runInContext(`${functionSource("assistantCreateTask")}\n${functionSource("assistantChatAction")}\nthis.chat = assistantChatAction;`, context);
  return { board, chat: (action, options) => context.chat(action, options) };
}

const approval = (task, tasks, level) => backlog.workState(task, Date.now(), { tasks, approve: (item) => autonomy.needsApproval(item, { level, elevated: {}, tasks }) }).stage;

test("a card filed from Discord keeps its remote origin on the board and waits for the owner's OK in every mode", async () => {
  const { board, chat } = studio();
  const fromDiscord = await chat({ kind: "create_task", title: "Add dark mode", ownerText: "Add dark mode please" }, { remote: true });
  assert.equal(fromDiscord.ok, true);
  const saved = board.tasks.find((task) => task.id === fromDiscord.created.id);
  assert.deepEqual({ ...saved.origin }, { kind: "chat", by: "owner", via: "remote" });
  for (const level of autonomy.LEVELS) {
    assert.equal(autonomy.needsApproval(saved, { level, elevated: { "agent-filed": false }, tasks: board.tasks }), true, level);
    assert.equal(approval(saved, board.tasks, level), "approval", `${level}: it waits for approval before any worker takes it`);
  }
  const fromStudio = await chat({ kind: "create_task", title: "Tidy menus", ownerText: "Tidy menus" });
  const own = board.tasks.find((task) => task.id === fromStudio.created.id);
  assert.deepEqual({ ...own.origin }, { kind: "chat", by: "owner" }, "the owner's chat in Studio has no via");
  assert.equal(approval(own, board.tasks, "auto"), "ready", "and builds under Auto as before");
});

test("the admission gate keeps where work came from, and an inbox row carries it onto its card", () => {
  const origin = { ...remote.ORIGIN };
  assert.deepEqual({ ...workAdmission.taskRow({ title: "x" }, { now: 1, id: "t", origin }).origin }, origin);
  assert.deepEqual({ ...workAdmission.taskRow({ title: "x", origin }, { now: 1, id: "t" }).origin }, origin);
  assert.deepEqual({ ...workAdmission.requestOrigin({ source: "manual", origin }) }, origin);
  const board = { tasks: [], requests: [] };
  const { created } = workAdmission.admitTask(board, { title: "Add dark mode", prompt: "Add dark mode" }, { origin, now: 1, allocateId: () => "t1" });
  assert.equal(autonomy.remoteWork(created, { tasks: board.tasks }), true);
  assert.equal("via" in workAdmission.taskRow({ title: "y" }, { now: 1, id: "y", origin: { kind: "chat", by: "owner" } }).origin, false, "no via is invented");
});
