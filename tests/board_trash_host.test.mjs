// The host side of Recently deleted (main.cjs "Board trash"): the block, the
// gateway's beforeWrite, deleteTask, and the channels, sliced out of main.cjs
// and run against a real temp folder for the trash file and an in-memory board.
// What is pinned: every delete path (tasks:delete, tasks:action delete,
// ideas:action delete and clean) keeps the record BEFORE the board write that
// removes it; a copy that cannot be written stops the delete; a restore puts
// the record back at its place and never over a card that is there; and
// MEFI_STUDIO_NO_BOARD_TRASH=1 gives the old delete-for-good behaviour back.
//
// Run: node --test tests/board_trash_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import backlog from "../scripts/backlog.cjs";
import taskContext from "../scripts/task-context.cjs";
import taskDelegation from "../scripts/task-delegation.cjs";
import * as assistant from "../scripts/assistant.mjs";

const require = createRequire(import.meta.url);
const boardTrash = require("../scripts/board-trash.cjs");
const { applyIdeaAction } = require("../scripts/idea-actions.cjs");
const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = main.indexOf(start);
  const to = main.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return main.slice(from, to);
};
const copy = (value) => JSON.parse(JSON.stringify(value));

const GATEWAY = section("const isThenable =", "// Drop a claim this run still owns.");
const TASKS = section("function queuedWorkCount(", "function workTitleKey(");
const BLOCK = section("// ---- Board trash: Recently deleted tasks and ideas", "// ---- end of Board trash ----");
const CHANNELS = section("  // ---- Board trash channels (the", "  // ---- end of Board trash channels ----");
const IDEAS_ACTION = section('  ipcMain.handle("ideas:action"', "  // A view's list is merged by id");
const TASKS_DELETE = section('  ipcMain.handle("tasks:delete"', '  ipcMain.handle("tasks:action"');

const task = (id, extra = {}) => ({ id, title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: 10, updatedAt: 10, ...extra });
// A card with the saved brief history a real one carries (two recorded revisions).
const withHistory = (row) => {
  const first = taskContext.recordTaskRevision(row, { previous: null, kind: "saved", now: 20 });
  return taskContext.recordTaskRevision({ ...first, prompt: `${row.prompt} (edited)` }, { previous: first, kind: "edited", now: 30 });
};
const idea = (id, extra = {}) => ({ id, title: `Idea ${id}`, detail: `Detail ${id}`, status: "new", read: false, at: 5, ...extra });

// A board in memory, a trash file in a real temp folder, the sliced host code
// wired to both. `order` says which file each write went to, and what the trash
// held the moment a board file was written.
async function host(t, { tasks = [], ideas = [], projectId = "project-a" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-trash-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 }));
  const board = { tasks: copy(tasks), requests: [], ideas: copy(ideas) };
  const project = { id: projectId, path: "C:/fixture" };
  const state = { project, failTrashWrite: false, failBoardWrite: null, boardMutateCalls: 0, storeOn: false };
  const logs = [];
  const order = [];
  const effects = [];
  const trashFile = (id = state.project.id) => path.join(root, "projects", id, "board-trash.json");
  const readTrash = (id) => (existsSync(trashFile(id)) ? JSON.parse(readFileSync(trashFile(id), "utf8")) : null);
  const projects = {
    current: () => state.project,
    open: () => state.project,
    dataPath: (file, chosen = state.project) => path.join(root, "projects", chosen.id, path.basename(file)),
    run: (chosen, fn) => fn(),
  };
  const eyes = {
    readJson: async (key, fallback) => (key in board ? copy(board[key]) : fallback),
    writeJson: async (key, value) => {
      if (String(key).endsWith("board-trash.json")) {
        if (state.failTrashWrite) throw new Error("disk full");
        const target = projects.dataPath(key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(value));
        order.push("trash");
        return { ok: true };
      }
      if (state.failBoardWrite === key) throw new Error("board write failed");
      const held = readTrash();
      order.push({ key, trashItems: held ? held.items.map((item) => `${item.kind}:${item.id}`) : [], tasksBefore: board.tasks.map((row) => row.id) });
      board[key] = copy(value);
      return { ok: true };
    },
    boardEnabled: () => state.storeOn,
    boardMutate: async (fn) => { state.boardMutateCalls += 1; const draft = copy(board); const out = fn(draft, null); return { ...out, written: [] }; },
  };
  let chain = Promise.resolve();
  const autopilot = { jobs: [] };
  const handlers = new Map();
  const env = vm.createContext({
    Date, console, backlog, taskContext, taskDelegation, boardTrash, applyIdeaAction, structuredClone, path, readFile, writeFile, process: { env: {} },
    autopilot, projects, STUDIO_ROOT: root, TASKS_PATH: "tasks", REQUESTS_PATH: "requests", IDEAS_PATH: "ideas",
    getEyes: async () => eyes,
    withBoardLock: (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; },
    send: () => {},
    logLine: (line) => logs.push(String(line)),
    refreshAutopilotQueue: async () => { effects.push("refresh"); },
    assistantAskForWork: (reason) => effects.push(reason),
    emitAutopilot: () => {},
    compareWork: (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
    workTitleKey: (value) => String(value ?? "").toLowerCase(),
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    assistantState: { status: "paused", prefs: {}, agents: [] },
    machineLagGate: null,
    getAssistant: async () => assistant,
    ensureAssistant: async () => ({ status: "paused", prefs: {}, agents: [] }),
    setAutopilot: async () => {}, assistantPause: async () => {}, assistantResume: async () => {},
    autopilotHousekeeping: async () => {}, classifyPendingWork: async () => ({ ok: true }), promoteRequestsToTasks: async () => {},
    saveAssistant: async () => {}, assistantLog: () => {},
  });
  vm.runInContext(GATEWAY, env);
  vm.runInContext(TASKS, env);
  vm.runInContext(BLOCK, env);
  vm.runInContext(`${TASKS_DELETE}\n${CHANNELS}\n${IDEAS_ACTION}`, env);
  return {
    env, board, state, logs, order, effects, autopilot, handlers, root, trashFile, readTrash,
    call: async (channel, payload) => copy(await handlers.get(channel)({}, payload)),
    ids: (key = "tasks") => board[key].map((row) => row.id),
    setEnv: (name, value) => { if (value === undefined) delete env.process.env[name]; else env.process.env[name] = value; },
  };
}

test("the block, its channels and its bridge entries are where the other host tests look", () => {
  assert.match(main, /const boardTrash = require\("\.\/scripts\/board-trash\.cjs"\);/);
  assert.equal((main.match(/ipcMain\.handle\("tasks:undelete"/g) ?? []).length, 1);
  assert.equal((main.match(/ipcMain\.handle\("board:trash"/g) ?? []).length, 1);
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  const channels = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]/)[1];
  assert.doesNotMatch(prefixes, /"board:"|"tasks:"/, "they act on the open project, so a project switch waits for them");
  assert.doesNotMatch(channels, /tasks:undelete|board:trash/);
  assert.match(preload, /^  tasksUndelete: \(payload\) => ipcRenderer\.invoke\("tasks:undelete", payload \?\? \{\}\),$/m);
  assert.match(preload, /^  boardTrash: \(payload\) => ipcRenderer\.invoke\("board:trash", payload \?\? \{\}\),$/m);
  // The gateway option is optional: every other caller passes the mutator alone.
  assert.match(main, /async function mutateBoard\(mutator, options = \{\}\)/);
  assert.ok(main.indexOf("// ---- Board trash: Recently deleted") > main.indexOf("function workTitleKey("), "the block sits after workTitleKey, outside the slices the older host suites cut");
});

test("tasks:delete keeps the whole record BEFORE the board write that removes it", async (t) => {
  const record = withHistory(task("b", { notes: "keep me", refs: [{ kind: "file", detail: "a.js" }] }));
  assert.equal(record.contextHistory.entries.length, 2);
  const h = await host(t, { tasks: [task("a"), record, task("c")] });
  const out = await h.call("tasks:delete", { taskId: "b", projectId: "project-a" });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(h.ids(), ["a", "c"]);
  assert.deepEqual(out.trashed.map(({ kind, id, title }) => [kind, id, title]), [["task", "b", "Task b"]]);
  assert.ok(out.trashed[0].deletedAt > 0);
  assert.equal("record" in out.trashed[0], false, "the reply names what was kept; it does not carry the record");
  // The trash was written first, and it already held the card when the board file went.
  assert.equal(h.order[0], "trash");
  const boardWrite = h.order.find((entry) => entry.key === "tasks");
  assert.deepEqual(boardWrite.trashItems, ["task:b"], "at the moment the task file was written the trash already held the card");
  assert.deepEqual(boardWrite.tasksBefore, ["a", "b", "c"], "and the card was still on the board");
  const stored = h.readTrash();
  assert.equal(stored.version, 1);
  assert.equal(stored.items.length, 1);
  const [item] = stored.items;
  assert.equal(item.kind, "task");
  assert.equal(item.by, "owner");
  assert.equal(item.via, "tasks:delete");
  assert.equal(item.index, 1);
  assert.equal(item.afterId, "a");
  assert.deepEqual(item.record.contextHistory, record.contextHistory, "the whole record, saved history included");
  assert.equal(item.record.notes, "keep me");
  assert.ok(h.logs.some((line) => /^\[board\] kept 1 deleted task in Recently deleted \(b\)/.test(line)));
});

test("a task a worker holds is refused and nothing is kept for it", async (t) => {
  const h = await host(t, { tasks: [task("busy", { status: "active", runId: "run_1" }), task("free")] });
  const refused = await h.call("tasks:delete", { taskId: "busy", projectId: "project-a" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Wait for the worker/);
  assert.deepEqual(h.ids(), ["busy", "free"]);
  assert.equal(h.readTrash(), null, "no delete, so no trash file");
  h.autopilot.jobs.push({ taskId: "free" });
  assert.equal((await h.call("tasks:delete", { taskId: "free", projectId: "project-a" })).ok, false);
  assert.equal(h.readTrash(), null);
  assert.equal((await h.call("tasks:delete", { taskId: "ghost", projectId: "project-a" })).ok, false);
  assert.equal((await h.call("tasks:delete", { taskId: "free", projectId: "project-b" })).ok, false, "a stale project is refused before anything");
  assert.equal(h.readTrash(), null);
});

test("tasks:action delete goes through the same path", async (t) => {
  const h = await host(t, { tasks: [task("a"), task("b")] });
  const out = await h.env.taskAction({ action: "delete", taskId: "a", projectId: "project-a" });
  assert.equal(out.ok, true);
  assert.deepEqual(h.ids(), ["b"]);
  assert.deepEqual(h.readTrash().items.map((item) => `${item.kind}:${item.id}:${item.via}`), ["task:a:tasks:delete"]);
});

test("a copy that cannot be written stops the delete: the card stays and the reply says why", async (t) => {
  const h = await host(t, { tasks: [task("a"), task("b")] });
  h.state.failTrashWrite = true;
  const out = await h.call("tasks:delete", { taskId: "a", projectId: "project-a" });
  assert.equal(out.ok, false);
  assert.match(out.error, /Nothing was deleted: Studio could not keep a copy in Recently deleted first \(disk full\)/);
  assert.deepEqual(h.ids(), ["a", "b"], "the card is still on the board");
  assert.equal(h.order.some((entry) => entry.key === "tasks"), false, "the board file was never written");
  assert.ok(h.logs.some((line) => /Recently deleted failed to keep 1 task, so nothing was deleted: disk full/.test(line)));
  // It works again once the disk does.
  h.state.failTrashWrite = false;
  assert.equal((await h.call("tasks:delete", { taskId: "a", projectId: "project-a" })).ok, true);
  assert.deepEqual(h.ids(), ["b"]);
});

test("a delete whose board write fails leaves the card, and the copy kept for it is taken out again", async (t) => {
  const h = await host(t, { tasks: [task("a"), task("b")] });
  h.state.failBoardWrite = "tasks";
  await assert.rejects(h.env.deleteTask({ taskId: "a", projectId: "project-a" }), /board write failed/);
  assert.deepEqual(h.ids(), ["a", "b"], "the card is still on the board");
  assert.deepEqual(h.readTrash().items, [], "and Recently deleted does not offer to restore a card that was never deleted");
  assert.equal(h.order.filter((entry) => entry === "trash").length, 2, "the copy was written first, as always, and taken out again once the failure was known");
  assert.equal(h.order[0], "trash");
});

test("a copy left behind by a crash between the two writes is not lost, and says the card is still there", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  // The trash write landed and the process died before the board write: the file has the copy, the board still has the card.
  await h.env.boardTrashStore().keep(boardTrash.removed("task", h.board.tasks, [], { by: "owner", via: "tasks:delete" }));
  assert.deepEqual(h.ids(), ["a"]);
  const listed = await h.call("board:trash", { projectId: "project-a" });
  assert.deepEqual(listed.items.map((row) => [row.id, row.restorable, row.reason]), [["a", false, "already-there"]]);
  const back = await h.call("tasks:undelete", { taskId: "a", projectId: "project-a" });
  assert.equal(back.ok, false);
  assert.match(back.error, /already on the board again/);
  assert.deepEqual(h.ids(), ["a"]);
  assert.equal(h.readTrash().items.length, 1, "the copy stays");
});

test("tasks:undelete puts the record back where it was, whole, and takes it off the list", async (t) => {
  const record = withHistory(task("b", { notes: "keep me", dependsOn: [] }));
  const h = await host(t, { tasks: [task("a"), record, task("c"), task("d")] });
  assert.equal((await h.call("tasks:delete", { taskId: "b", projectId: "project-a" })).ok, true);
  h.board.tasks.unshift(task("new-first"));
  const back = await h.call("tasks:undelete", { taskId: "b", projectId: "project-a" });
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.restored, { kind: "task", id: "b", title: "Task b" });
  assert.deepEqual(h.ids(), ["new-first", "a", "b", "c", "d"], "right after the card it followed");
  assert.deepEqual(h.board.tasks[2], record, "the record comes back as it was, saved history and all");
  assert.equal(back.task.id, "b");
  assert.equal(back.task.contextHistory, undefined, "the reply is the board's view, without the saved history");
  assert.equal(back.tasks.length, 5);
  assert.equal(h.board.tasks[2].contextHistory.entries.length, 2, "no revision is added to the restored card's history");
  assert.deepEqual(h.readTrash().items, []);
  assert.ok(h.effects.includes("a deleted task was put back"));
  const again = await h.call("tasks:undelete", { taskId: "b", projectId: "project-a" });
  assert.equal(again.ok, false);
  assert.match(again.error, /not in Recently deleted any more/);
  assert.deepEqual(h.ids(), ["new-first", "a", "b", "c", "d"]);
});

test("a restore never overwrites a card that is there again, says so, and keeps the copy", async (t) => {
  const h = await host(t, { tasks: [task("a", { title: "Original" })] });
  assert.equal((await h.call("tasks:delete", { taskId: "a", projectId: "project-a" })).ok, true);
  // The same id is admitted again (a follow-up regenerated from its saved record).
  h.board.tasks.push(task("a", { title: "Made again", prompt: "newer words" }));
  const back = await h.call("tasks:undelete", { taskId: "a", projectId: "project-a" });
  assert.equal(back.ok, false);
  assert.match(back.error, /“Original” is already on the board again, so the deleted copy was not put over it\. It stays in Recently deleted\./);
  assert.equal(h.board.tasks.length, 1);
  assert.equal(h.board.tasks[0].title, "Made again", "the card that is there is untouched");
  assert.equal(h.readTrash().items[0].record.title, "Original", "and the deleted copy is still kept");
  assert.equal(h.order.filter((entry) => entry.key === "tasks").length, 1, "only the delete wrote the board");
});

test("a restore says when the card waits for a prerequisite that is gone", async (t) => {
  const h = await host(t, { tasks: [task("base"), task("child", { dependsOn: ["base"] })] });
  assert.equal((await h.call("tasks:delete", { taskId: "child", projectId: "project-a" })).ok, true);
  assert.equal((await h.call("tasks:delete", { taskId: "base", projectId: "project-a" })).ok, true);
  const back = await h.call("tasks:undelete", { taskId: "child", projectId: "project-a" });
  assert.equal(back.ok, true);
  assert.match(back.warning, /waits for a task that is no longer on the board/);
  assert.deepEqual(h.board.tasks[0].dependsOn, ["base"], "the record is not edited to hide it");
});

test("a restore for the wrong project, an empty id or a missing item is refused", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  assert.equal((await h.call("tasks:undelete", { taskId: "a", projectId: "project-b" })).ok, false);
  assert.match((await h.call("tasks:undelete", { projectId: "project-a" })).error, /Choose a deleted task/);
  assert.match((await h.call("tasks:undelete", { taskId: "never", projectId: "project-a" })).error, /not in Recently deleted any more/);
  assert.equal(h.readTrash(), null, "reading a list that is not there creates nothing");
});

test("ideas:action delete and clean keep the ideas first; restore puts one back at its place", async (t) => {
  const h = await host(t, { ideas: [idea("i1"), idea("i2", { status: "done" }), idea("i3"), idea("i4", { status: "done" })] });
  const removed = await h.call("ideas:action", { action: "delete", ideaId: "i3", projectId: "project-a" });
  assert.equal(removed.ok, true, removed.error);
  assert.deepEqual(removed.ideas.map((row) => row.id), ["i1", "i2", "i4"]);
  assert.deepEqual(removed.trashed.map((row) => [row.kind, row.id]), [["idea", "i3"]]);
  assert.equal(h.order[0], "trash");
  assert.deepEqual(h.order.find((entry) => entry.key === "ideas").trashItems, ["idea:i3"], "the trash held it when the ideas file was written");
  const cleaned = await h.call("ideas:action", { action: "clean", ideaIds: ["i2", "i4"], projectId: "project-a" });
  assert.equal(cleaned.ok, true);
  assert.deepEqual(h.ids("ideas"), ["i1"]);
  assert.deepEqual(cleaned.trashed.map((row) => row.id).sort(), ["i2", "i4"]);
  const stored = h.readTrash().items;
  assert.deepEqual(stored.map((item) => `${item.id}:${item.via}`).sort(), ["i2:ideas:action:clean", "i3:ideas:action:delete", "i4:ideas:action:clean"]);
  const i3 = stored.find((item) => item.id === "i3");
  assert.equal(i3.index, 2);
  assert.equal(i3.afterId, "i2");
  assert.deepEqual(i3.record, idea("i3"));
  // The record comes from the list, never from the caller: a forged one is ignored.
  const back = await h.call("ideas:action", { action: "restore", ideaId: "i3", projectId: "project-a", record: { id: "i3", title: "Forged" }, index: 0 });
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.restored, { kind: "idea", id: "i3", title: "Idea i3" });
  assert.deepEqual(h.board.ideas.map((row) => row.id), ["i1", "i3"], "its old predecessor is gone, so its old index stands, held inside the list");
  assert.equal(h.board.ideas[1].title, "Idea i3");
  assert.deepEqual(h.readTrash().items.map((item) => item.id).sort(), ["i2", "i4"]);
  assert.match((await h.call("ideas:action", { action: "restore", ideaId: "i3", projectId: "project-a" })).error, /not in Recently deleted any more/);
  assert.match((await h.call("ideas:action", { action: "restore", projectId: "project-a" })).error, /Choose a deleted idea/);
});

test("the other idea actions do not touch the trash", async (t) => {
  const h = await host(t, { ideas: [idea("i1")] });
  for (const action of ["read", "keep", "done"]) assert.equal((await h.call("ideas:action", { action, ideaId: "i1", projectId: "project-a" })).ok, true);
  assert.equal((await h.call("ideas:action", { action: "add", title: "New", detail: "words", source: "owner", projectId: "project-a" })).ok, true);
  assert.equal(h.readTrash(), null);
  assert.equal(h.order.includes("trash"), false);
  assert.equal((await h.call("ideas:action", { action: "delete", ideaId: "i1", projectId: "project-b" })).ok, false);
});

test("ideas restore is refused over an idea that is there again", async (t) => {
  const h = await host(t, { ideas: [idea("i1", { title: "Saved thought" })] });
  await h.call("ideas:action", { action: "delete", ideaId: "i1", projectId: "project-a" });
  h.board.ideas.push(idea("i1", { title: "Saved again" }));
  const back = await h.call("ideas:action", { action: "restore", ideaId: "i1", projectId: "project-a" });
  assert.equal(back.ok, false);
  assert.match(back.error, /“Saved thought” is already in your ideas again/);
  assert.equal(h.board.ideas.length, 1);
  assert.equal(h.readTrash().items.length, 1);
});

test("an idea delete whose copy cannot be written leaves the idea", async (t) => {
  const h = await host(t, { ideas: [idea("i1"), idea("i2")] });
  h.state.failTrashWrite = true;
  const out = await h.call("ideas:action", { action: "delete", ideaId: "i1", projectId: "project-a" });
  assert.equal(out.ok, false);
  assert.match(out.error, /Nothing was deleted/);
  assert.deepEqual(h.ids("ideas"), ["i1", "i2"]);
});

test("board:trash lists what can be put back, newest first, without the records", async (t) => {
  const h = await host(t, { tasks: [task("t1", { status: "done" })], ideas: [idea("i1")] });
  await h.call("tasks:delete", { taskId: "t1", projectId: "project-a" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await h.call("ideas:action", { action: "delete", ideaId: "i1", projectId: "project-a" });
  const listed = await h.call("board:trash", { projectId: "project-a" });
  assert.equal(listed.ok, true);
  assert.equal(listed.enabled, true);
  assert.equal(listed.keptDays, 30);
  assert.equal(listed.max, 50);
  assert.equal(listed.projectId, "project-a");
  assert.deepEqual(listed.items.map((row) => [row.kind, row.id, row.title, row.status, row.restorable, row.by, row.via]), [
    ["idea", "i1", "Idea i1", "new", true, "owner", "ideas:action:delete"],
    ["task", "t1", "Task t1", "done", true, "owner", "tasks:delete"],
  ]);
  assert.ok(listed.items.every((row) => !("record" in row) && row.expiresAt - row.deletedAt === 30 * 24 * 60 * 60 * 1000));
  assert.deepEqual((await h.call("board:trash", { projectId: "project-a", kinds: ["idea"] })).items.map((row) => row.id), ["i1"]);
  assert.equal((await h.call("board:trash", { projectId: "project-b" })).ok, false);
  assert.deepEqual((await h.call("board:trash", {})).items.length, 2, "the project id is optional");
});

test("each project keeps its own list, in a file beside its own board", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  await h.call("tasks:delete", { taskId: "a", projectId: "project-a" });
  h.state.project = { id: "project-b", path: "C:/other" };
  h.board.tasks = [task("b")];
  await h.call("tasks:delete", { taskId: "b", projectId: "project-b" });
  assert.deepEqual(h.readTrash("project-a").items.map((item) => item.id), ["a"]);
  assert.deepEqual(h.readTrash("project-b").items.map((item) => item.id), ["b"]);
  assert.deepEqual((await h.call("board:trash", { projectId: "project-b" })).items.map((row) => row.id), ["b"]);
  h.state.project = { id: "project-a", path: "C:/fixture" };
  assert.deepEqual((await h.call("board:trash", { projectId: "project-a" })).items.map((row) => row.id), ["a"]);
  assert.match(path.relative(h.root, h.trashFile("project-a")), /projects[\\/]project-a[\\/]board-trash\.json$/);
});

test("fifty-one deletes keep fifty, oldest dropped first, and the log says so", async (t) => {
  const many = Array.from({ length: 51 }, (_, n) => task(`t${String(n).padStart(2, "0")}`));
  const h = await host(t, { tasks: many });
  for (const row of many) {
    const out = await h.call("tasks:delete", { taskId: row.id, projectId: "project-a" });
    assert.equal(out.ok, true, out.error);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const items = h.readTrash().items;
  assert.equal(items.length, 50);
  assert.equal(items[0].id, "t50");
  assert.equal(items.at(-1).id, "t01", "the first one deleted is the one that fell out");
  assert.ok(h.logs.some((line) => /let go of 1 older/.test(line)));
  assert.equal(h.board.tasks.length, 0);
});

test("a delete that removes more than the list can hold says how many it could not keep", async (t) => {
  const h = await host(t, { ideas: Array.from({ length: 60 }, (_, n) => idea(`i${n}`, { status: "done" })) });
  const out = await h.call("ideas:action", { action: "clean", ideaIds: Array.from({ length: 60 }, (_, n) => `i${n}`), projectId: "project-a" });
  assert.equal(out.ok, true);
  assert.equal(out.trashed.length, 50);
  assert.equal(out.notKept, 10);
  assert.equal(h.board.ideas.length, 0, "the clean itself is what the owner asked for");
});

test("MEFI_STUDIO_NO_BOARD_TRASH=1 gives the old behaviour back: deletes are for good and nothing is read or written", async (t) => {
  const h = await host(t, { tasks: [task("a"), task("b")], ideas: [idea("i1"), idea("i2", { status: "done" })] });
  h.setEnv("MEFI_STUDIO_NO_BOARD_TRASH", "1");
  const deleted = await h.call("tasks:delete", { taskId: "a", projectId: "project-a" });
  assert.equal(deleted.ok, true);
  assert.equal("trashed" in deleted, false, "nothing was kept, so the reply says nothing was");
  assert.deepEqual(h.ids(), ["b"]);
  const idea1 = await h.call("ideas:action", { action: "delete", ideaId: "i1", projectId: "project-a" });
  assert.equal(idea1.ok, true);
  assert.equal("trashed" in idea1, false);
  assert.equal((await h.call("ideas:action", { action: "clean", ideaIds: ["i2"], projectId: "project-a" })).ok, true);
  assert.deepEqual(h.ids("ideas"), []);
  assert.equal(h.readTrash(), null, "no file was written");
  assert.equal(h.order.includes("trash"), false);
  const listed = await h.call("board:trash", { projectId: "project-a" });
  assert.deepEqual([listed.ok, listed.enabled, listed.items], [true, false, []]);
  const back = await h.call("tasks:undelete", { taskId: "a", projectId: "project-a" });
  assert.equal(back.ok, false);
  assert.match(back.error, /switched off/);
  assert.match((await h.call("ideas:action", { action: "restore", ideaId: "i1", projectId: "project-a" })).error, /switched off/);
  // Anything other than "1" leaves it on.
  h.setEnv("MEFI_STUDIO_NO_BOARD_TRASH", "0");
  h.board.tasks.push(task("c"));
  assert.equal((await h.call("tasks:delete", { taskId: "c", projectId: "project-a" })).trashed.length, 1);
  h.setEnv("MEFI_STUDIO_NO_BOARD_TRASH", undefined);
  h.board.tasks.push(task("d"));
  assert.equal((await h.call("tasks:delete", { taskId: "d", projectId: "project-a" })).trashed.length, 1);
});

test("with the switch on, items already kept stay in the file for when it is lifted", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  await h.call("tasks:delete", { taskId: "a", projectId: "project-a" });
  h.setEnv("MEFI_STUDIO_NO_BOARD_TRASH", "1");
  assert.equal((await h.call("board:trash", { projectId: "project-a" })).items.length, 0);
  assert.equal(h.readTrash().items.length, 1, "switching it off never deletes what was kept");
  h.setEnv("MEFI_STUDIO_NO_BOARD_TRASH", undefined);
  assert.equal((await h.call("tasks:undelete", { taskId: "a", projectId: "project-a" })).ok, true);
});

test("mutateBoard's beforeWrite runs in the lock before any file, only for an accepted change, and a throw writes nothing", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  const seen = [];
  await h.env.mutateBoard((board) => { board.tasks.push(task("b")); }, { beforeWrite: async ({ before, after }) => { seen.push([before.tasks.map((row) => row.id), after.tasks.map((row) => row.id), h.order.length]); } });
  assert.deepEqual(seen, [[["a"], ["a", "b"], 0]], "it sees the rows as read and the rows about to be written, before any write");
  assert.deepEqual(h.ids(), ["a", "b"]);
  // A refused change never reaches it.
  const refused = await h.env.mutateBoard(() => ({ ok: false, error: "no" }), { beforeWrite: async () => { seen.push("refused ran"); } });
  assert.equal(refused.ok, false);
  assert.equal(seen.length, 1);
  // A throw abandons the write and reaches the caller.
  const before = copy(h.board);
  await assert.rejects(h.env.mutateBoard((board) => { board.tasks.length = 0; }, { beforeWrite: async () => { throw new Error("keep failed"); } }), /keep failed/);
  assert.deepEqual(h.board, before);
  // The gateway still queues the next write after that.
  await h.env.mutateBoard((board) => { board.tasks.push(task("c")); });
  assert.deepEqual(h.ids(), ["a", "b", "c"]);
});

test("a change with a beforeWrite takes the file path even when the store is on; one without still takes the store", async (t) => {
  const h = await host(t, { tasks: [task("a")] });
  h.state.storeOn = true;
  await h.env.mutateBoard((board) => { board.tasks.push(task("b")); });
  assert.equal(h.state.boardMutateCalls, 1, "an ordinary change goes to the store");
  await h.env.mutateBoard((board) => { board.tasks.push(task("c")); }, { beforeWrite: async () => {} });
  assert.equal(h.state.boardMutateCalls, 1, "a change that must keep something first cannot await inside a store transaction");
  assert.ok(h.ids().includes("c"));
});

test("a follow-up the owner deletes still settles for its parent, and Recently deleted keeps it", async (t) => {
  const handed = { handoffId: "handoff_a", fromRun: "run_p", title: "Wire it", originalTitle: "Wire it", prompt: "Wire it." };
  const parent = { id: "parent", title: "Parent", status: "awaiting_verification", runId: "run_p", remaining: ["Wire it"], lastAttempt: { runId: "run_p", handoffs: [handed] } };
  const h = await host(t, { tasks: [parent, { ...handed, id: "child", status: "open" }] });
  assert.equal((await h.call("tasks:delete", { taskId: "child", projectId: "project-a" })).ok, true);
  assert.deepEqual(h.board.tasks[0].droppedHandoffs, ["handoff_a"], "the delete still records the dropped hand-off on the parent");
  assert.equal(h.readTrash().items[0].record.handoffId, "handoff_a");
  // Put back, the follow-up is the parent's again (a card that exists is waited on, whatever the record says).
  assert.equal((await h.call("tasks:undelete", { taskId: "child", projectId: "project-a" })).ok, true);
  assert.deepEqual(h.ids(), ["parent", "child"]);
});

test("ideas:action add hands Search's owner idea through: stored as one from you, and the reply carries what the toast needs", async (t) => {
  const h = await host(t, { ideas: [idea("older")] });
  const out = await h.call("ideas:action", { action: "add", source: "owner", title: "Let the tree dim when nothing runs", detail: "Let the tree dim when nothing runs", projectId: "project-a" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.added, true);
  assert.match(out.idea.id, /^idea_owner_[0-9a-f]{24}$/);
  assert.equal(out.idea.title, "Let the tree dim when nothing runs");
  assert.deepEqual(h.ids("ideas"), [out.idea.id, "older"], "newest first, the rest untouched");
  const stored = h.board.ideas[0];
  assert.deepEqual([stored.source, stored.suggestedBy, stored.status, stored.read], ["owner", "owner", "new", true], "one from you, already read, waiting for you to decide");
  assert.equal("trashed" in out, false, "an add keeps nothing in Recently deleted");
  assert.equal(h.readTrash(), null);
  // The same words again are the same idea: nothing is added, and the reply says so.
  const again = await h.call("ideas:action", { action: "add", source: "owner", title: "Let the tree dim when nothing runs", detail: "Let the tree dim when nothing runs", projectId: "project-a" });
  assert.equal(again.ok, true);
  assert.equal(again.added, false);
  assert.equal(again.idea.id, out.idea.id);
  assert.equal(h.board.ideas.length, 2);
  // Without the owner source it is still Mefi's suggestion from chat.
  const chat = await h.call("ideas:action", { action: "add", title: "A chat note", detail: "From chat", projectId: "project-a" });
  assert.match(chat.idea.id, /^idea_mefi_/);
  assert.equal(h.board.ideas[0].source, "chat");
  assert.equal(h.board.ideas[0].read, false);
  // A stale project is refused before anything is written.
  assert.equal((await h.call("ideas:action", { action: "add", source: "owner", title: "x", detail: "y", projectId: "project-b" })).ok, false);
  assert.equal(h.board.ideas.length, 3);
});

test("nothing else in the host block reaches the network or the assistant", () => {
  assert.doesNotMatch(BLOCK, /\bfetch\(|https?:\/\/|require\("electron"\)/);
  assert.deepEqual(readdirSync(tmpdir()).filter((name) => name === "board-trash.json"), [], "no file lands outside a project's data folder");
});
