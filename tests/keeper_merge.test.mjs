// The keeper's write-back. tidy() and the audit pass run inside one board
// mutation; what they say about the assistant state (node folders, memory
// notes, stale asks, housekeeping) lands after the awaited board write, merged
// folder by folder, so a note or an answer written meanwhile is never lost, and
// a pass whose project was switched away writes nothing back at all.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import backlog from "../scripts/backlog.cjs";

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const log = (at, text) => ({ at, kind: "status", text });
// Four attempts that each ended unverified for the same reason: a verify loop.
const looping = (from) => Array.from({ length: 4 }, (_, index) => [
  log(from + index * 10 * MIN, "run finished (exit 0) — awaiting verification"),
  log(from + index * 10 * MIN + MIN, "unverified — no attributable edits and no named checks · retry 1/3"),
]).flat();
const folderNote = (state, id, text, at, kind = "run") => assistant.applyNodeContext(state, { target: { kind: "task", id: `task:${id}` }, kind, role: kind === "note" ? "owner" : "executor", text, at });

function keeperHost({ tasks = [], folders = [], questions = [], housekeeping = {}, prefs = {}, module = assistant, backlogModule = backlog, checkpoints = undefined } = {}) {
  const stores = { checkpoints: checkpoints === undefined ? undefined : structuredClone(checkpoints) };
  let state = { ...assistant.emptyState(NOW - HOUR), projectId: "project-a" };
  for (const [id, text, at, kind] of folders) state = folderNote(state, id, text, at, kind);
  state.questions = structuredClone(questions);
  state.housekeeping = { ...state.housekeeping, ...housekeeping };
  state.prefs = { ...state.prefs, ...prefs };
  let board = { tasks: structuredClone(tasks), requests: [], ideas: [] };
  let during = null;
  const logs = [], errors = [], emitted = [];
  const env = vm.createContext({
    console,
    assistantState: state,
    assistantCache: { store: null, audit: null, duplicateScan: null },
    projects: { current: () => ({ id: "project-a" }) },
    backlog: backlogModule,
    consumeReviewedTaskGroups: async () => {},
    getAssistant: async () => module,
    getEyes: async () => ({
      readJson: async (key, fallback) => (stores[key] === undefined ? fallback : structuredClone(stores[key])),
      writeJson: async (key, value) => { stores[key] = structuredClone(value); },
    }),
    CHECKPOINTS_PATH: "checkpoints",
    // The gateway: a synchronous mutator, then the awaited view write — the
    // window in which the rest of the app keeps writing assistant state.
    mutateBoard: async (mutator) => {
      const working = structuredClone(board);
      const patch = mutator(working) ?? {};
      const next = { tasks: patch.tasks ?? working.tasks, requests: patch.requests ?? working.requests, ideas: patch.ideas ?? working.ideas };
      const written = ["tasks", "requests", "ideas"].filter((key) => JSON.stringify(next[key]) !== JSON.stringify(board[key]));
      board = structuredClone(next);
      await Promise.resolve();
      if (during) await during(env);
      return { ...patch, ...next, written };
    },
    send() {},
    assistantLog: (kind, text) => logs.push({ kind, text }),
    logError: (text) => errors.push(text),
    assistantEmit: (event) => emitted.push(plain(event)),
    assistantVisit: async () => {},
    taskTarget: (id) => ({ kind: "task", id: `task:${id}` }),
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    FOLDED_NODE: { kind: "folded", id: "__folded__" },
  });
  vm.runInContext([
    section("async function assistantKeeperJob(", "// Structural equality for plain JSON state"),
    section("// Structural equality for plain JSON state", "// briefer:"),
  ].join("\n"), env);
  return {
    env, logs, errors, emitted,
    get state() { return env.assistantState; },
    board: () => structuredClone(board),
    stores,
    whileWriting(fn) { during = fn; },
    run: (entry = null) => env.assistantKeeperJob(NOW, entry),
  };
}

test("a checkpoint written while the board write is in flight survives the keeper's checkpoint tidy", async () => {
  // 52 notes on one session: tidy keeps the newest 50. Meanwhile a run adds
  // a note to it and a new session gets its first one.
  const note = (index) => ({ at: NOW - (60 - index) * MIN, text: `note ${index}` });
  const h = keeperHost({ checkpoints: { ses_long: Array.from({ length: 52 }, (_, index) => note(index)) } });
  h.whileWriting(() => {
    h.stores.checkpoints.ses_long.push({ at: NOW + 1, text: "added meanwhile" });
    h.stores.checkpoints.ses_new = [{ at: NOW + 2, text: "a new session" }];
  });
  await h.run();
  const saved = h.stores.checkpoints;
  assert.equal(saved.ses_long.length, 51, "tidy's trim of the two oldest, plus the note added meanwhile");
  assert.deepEqual(saved.ses_long.slice(0, 2).map((row) => row.text), ["note 2", "note 3"]);
  assert.equal(saved.ses_long.at(-1).text, "added meanwhile");
  assert.deepEqual(saved.ses_new, [{ at: NOW + 2, text: "a new session" }]);
});

const openCard = { id: "task_open", title: "Add the retry banner", status: "open", updatedAt: NOW - HOUR, logs: [], verification: { state: "unverified", reason: "no attributable edits and no named checks" } };

test("a folder note written while the board write is in flight survives the keeper's write-back", async () => {
  const h = keeperHost({
    tasks: [openCard],
    folders: [["task_open", 'autopilot "Add the retry banner" — finished, verifying (exit 0)', NOW - 30 * MIN], ["task_gone", "a card that left the board", NOW - 20 * MIN]],
  });
  h.whileWriting((env) => {
    env.assistantState = folderNote(env.assistantState, "task_open", "keep the banner red", NOW + 1, "note");
    env.assistantState = folderNote(env.assistantState, "task_new", "a run started meanwhile", NOW + 2);
  });
  const result = await h.run();
  assert.equal(result.ok, true);
  const folders = h.state.nodeFolders;
  assert.equal(folders["task:task:task_gone"], undefined, "tidy's clean-up of an untouched folder lands");
  assert.ok(folders["task:task:task_new"], "a folder created during the write is kept");
  const texts = folders["task:task:task_open"].entries.map((entry) => entry.text);
  assert.ok(texts.includes("keep the banner red"), "the owner's note written during the write is kept");
  assert.ok(texts.some((text) => text.startsWith("not verified — ")), "the audit's verdict is applied onto the live folder");
  assert.equal(h.state.housekeeping.foldersCleaned, 1);
  assert.ok(h.state.housekeeping.memoryAligned >= 1);
});

test("an answer given while the board write is in flight survives; stale open asks are superseded", async () => {
  const ask = (id, taskId) => ({ id, at: NOW - HOUR, kind: "question", source: "issue", title: `about ${taskId}`, status: "open", context: { taskId }, options: [{ id: "retry", label: "Try again" }], answer: null });
  const h = keeperHost({
    tasks: [openCard, { id: "task_done", title: "Finished card", status: "done", doneAt: NOW - HOUR, updatedAt: NOW - HOUR, logs: [], verification: { state: "verified" } }],
    questions: [ask("q_done", "task_done"), ask("q_gone", "task_gone"), ask("q_open", "task_open")],
  });
  h.whileWriting((env) => {
    const question = env.assistantState.questions.find((entry) => entry.id === "q_done");
    question.status = "answered";
    question.answer = { at: NOW + 1, optionId: "retry", label: "Try again", text: null, via: "option" };
  });
  await h.run();
  const byId = Object.fromEntries(h.state.questions.map((question) => [question.id, question]));
  assert.equal(byId.q_done.status, "answered", "the owner's answer is not overwritten");
  assert.equal(byId.q_done.answer.optionId, "retry");
  assert.equal(byId.q_gone.status, "superseded", "an open ask about a card that left the board");
  assert.equal(byId.q_open.status, "open", "an ask about open work stays");
  assert.equal(h.state.housekeeping.questionsSuperseded, 1);
  assert.deepEqual(h.emitted.map((event) => [event.kind, event.id, event.status]), [["question", "q_gone", "superseded"]]);
});

test("a project switch during the board write leaves the other project's assistant state alone", async () => {
  const tasks = [{ ...openCard, verification: undefined, logs: looping(NOW - 2 * HOUR) }];
  const setup = { tasks, folders: [["task_gone", "a card that left the board", NOW - 20 * MIN]], housekeeping: { loopArmedAt: NOW - 3 * HOUR } };
  for (const switchAway of [
    (env) => { env.assistantState = { ...assistant.emptyState(NOW), projectId: "project-b" }; },
    (env, entry) => { entry.abandoned = true; },
  ]) {
    const h = keeperHost(setup);
    const entry = { role: "keeper" };
    let other = null;
    h.whileWriting((env) => { switchAway(env, entry); other = plain(env.assistantState); });
    const result = await h.run(entry);
    assert.equal(result.ok, true);
    assert.match(result.text, /project changed, nothing written back/);
    assert.deepEqual(plain(h.state), other, "folders, asks and housekeeping are untouched");
    assert.deepEqual(plain(result.messages), [], "the new project's compactor hears nothing");
    assert.ok(h.board().tasks[0].loopGuard, "the board write itself landed on its own board");
    assert.equal(h.logs.length, 0);
  }
});

test("an assistant.mjs without auditPass tidies exactly as before", async () => {
  const { auditPass, applyMemoryDelta, ...older } = assistant;
  assert.equal(typeof auditPass, "function");
  assert.equal(typeof applyMemoryDelta, "function");
  const tasks = [{ ...openCard, logs: looping(NOW - 2 * HOUR) }];
  const h = keeperHost({ module: older, tasks, folders: [["task_open", 'autopilot "Add the retry banner" — finished, verifying (exit 0)', NOW - 30 * MIN], ["task_gone", "a card that left the board", NOW - 20 * MIN]], housekeeping: { loopArmedAt: NOW - 3 * HOUR } });
  const result = await h.run();
  assert.equal(result.ok, true);
  assert.deepEqual(h.board().tasks, tasks, "no ledger and no hold");
  assert.equal(h.state.nodeFolders["task:task:task_gone"], undefined, "tidy's folder clean-up still lands");
  assert.equal(h.state.nodeFolders["task:task:task_open"].entries.length, 1, "no memory notes are aligned");
  const { housekeeping } = h.state;
  assert.equal(housekeeping.lastText, "cleaned 1 node folder");
  assert.equal(housekeeping.loopArmedAt, NOW - 3 * HOUR, "the arm time is kept, not moved");
  assert.deepEqual([housekeeping.loopsHeld, housekeeping.wouldHold, housekeeping.memoryAligned, housekeeping.questionsSuperseded], [0, 0, 0, 0]);
  assert.deepEqual(h.errors, []);
});

test("a failing audit pass never fails the keeper: tidy's result lands and the failure is logged", async () => {
  const broken = { ...assistant, auditPass: () => { throw new Error("fixture audit bug"); } };
  const tasks = [{ ...openCard, logs: looping(NOW - 2 * HOUR) }];
  const h = keeperHost({ module: broken, tasks, folders: [["task_gone", "a card that left the board", NOW - 20 * MIN]], housekeeping: { loopArmedAt: NOW - 3 * HOUR } });
  const result = await h.run();
  assert.equal(result.ok, true);
  assert.deepEqual(h.errors, ["audit pass failed: fixture audit bug"]);
  assert.deepEqual(h.board().tasks, tasks);
  assert.equal(h.state.nodeFolders["task:task:task_gone"], undefined);
  assert.equal(h.state.housekeeping.lastText, "cleaned 1 node folder");
});

test("holds are stamped only on a host whose backlog honours them, and the arm time is set once", async () => {
  const tasks = [{ ...openCard, verification: undefined, logs: looping(NOW - 2 * HOUR) }];
  // A first pass arms the guard: history before it is never charged.
  const first = keeperHost({ tasks });
  await first.run();
  assert.equal(first.state.housekeeping.loopArmedAt, NOW);
  assert.equal(first.board().tasks[0].loopGuard, undefined);
  // Armed earlier, on a host without the hold contract: counted, not stamped.
  const older = keeperHost({ tasks, backlogModule: { ...backlog, LOOP_HOLD: undefined }, housekeeping: { loopArmedAt: NOW - 3 * HOUR } });
  await older.run();
  assert.equal(older.board().tasks[0].loopGuard, undefined);
  assert.equal(older.board().tasks[0].loopLedger.n, 4);
  assert.equal(older.state.housekeeping.wouldHold, 1);
  assert.match(older.state.housekeeping.lastText, /would hold 1 looping card/);
  // This host: held, and the board says why.
  const h = keeperHost({ tasks, housekeeping: { loopArmedAt: NOW - 3 * HOUR } });
  await h.run();
  const held = h.board().tasks[0];
  assert.equal(held.loopGuard.by, "keeper");
  assert.equal(backlog.workState(held, NOW).blockedBy, "loop");
  assert.equal(h.state.housekeeping.loopsHeld, 1);
  assert.equal(h.state.housekeeping.loopArmedAt, NOW - 3 * HOUR, "the arm time never moves once set");
  assert.match(h.state.housekeeping.lastText, /^held 1 looping card/);
  assert.ok(h.logs.some((row) => row.kind === "tidy" && row.text.startsWith("held 1 looping card")));
});

test("the loop guard switched off releases the keeper's holds and disarms", async () => {
  const hold = { v: 1, at: NOW - HOUR, kind: "attempts", count: 6, reason: "run failed exit N", remedy: "Read the last attempts, edit or split the brief, then choose Try again.", by: "keeper" };
  const h = keeperHost({ tasks: [{ ...openCard, verification: undefined, loopGuard: hold }], prefs: { loopGuard: false }, housekeeping: { loopArmedAt: NOW - 3 * HOUR } });
  await h.run();
  assert.equal(h.board().tasks[0].loopGuard, undefined);
  assert.equal(h.state.housekeeping.loopArmedAt, 0, "switching it back on charges nothing logged while it was off");
  assert.match(h.state.housekeeping.lastText, /released 1 loop hold/);
});
