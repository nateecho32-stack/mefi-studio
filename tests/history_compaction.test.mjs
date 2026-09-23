// contextHistory compaction for completed cards (scripts/task-context.cjs
// compactHistory), the "compacted" revision kind that lets the board gateway
// keep a shorter history (recordTaskRevision, mutateBoard's revisionKinds),
// and the keeper pass that compacts finished cards past the tidy clock
// (main.cjs assistantKeeperJob). Kept entries are never rewritten or
// renumbered, so a card's contextVersion, saveTaskEdits' baseline lookup and
// the legacy fast path all behave as before. Disposable temp folders only; no
// store, no live board.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as eyes from "../scripts/eyes.mjs";
import * as assistant from "../scripts/assistant.mjs";

const require = createRequire(import.meta.url);
const backlog = require("../scripts/backlog.cjs");
const taskContext = require("../scripts/task-context.cjs");
const { createProjects } = require("../scripts/projects.cjs");
const { snapshotTask, recordTaskRevision, taskHistory, restoreTaskRevision, compactHistory } = taskContext;

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

// A card recorded the way the gateway records it: one revision per change.
function build(base, patches, start) {
  let row = recordTaskRevision(base, { now: start });
  patches.forEach((patch, index) => {
    row = recordTaskRevision({ ...row, ...patch }, { previous: row, now: start + (index + 1) * MIN });
  });
  return row;
}
// Nine revisions: log noise before any attempt (e2, e3), a first attempt r1
// (e4, e5), a brief edit with a second attempt r2 (e6), remaining work (e7),
// the verifier (e8) and the completion (e9). Compaction keeps e1 (first), e3
// (the last before any attempt), e5 (the last of r1), e6 (brief changed), e7
// (remaining changed) and e9 (last); it drops e2, e4 and e8.
const KEPT = [0, 2, 4, 5, 6, 8];
function finishedCard(base = {}, start = NOW - 48 * HOUR) {
  const log = (count) => Array.from({ length: count }, (_, index) => ({ at: start + index, kind: "status", text: `line ${index + 1}` }));
  return build({ id: "task_done", title: "Wire the banner", prompt: "Brief A", status: "open", logs: [], createdAt: start, updatedAt: start, ...base }, [
    { logs: log(1) },
    { logs: log(2) },
    { logs: log(3), lastAttempt: { runId: "r1", result: "first try" } },
    { verification: { state: "unverified", reason: "no checks" } },
    { prompt: "Brief B", lastAttempt: { runId: "r2", result: "second try" } },
    { remaining: ["tests"] },
    { verification: { state: "verified", reason: "tests pass" } },
    { status: "done", doneAt: start + 9 * MIN, logs: log(4) },
  ], start);
}

test("a completed card keeps its first and last entries, brief changes, restores and each attempt's last entry", () => {
  const card = finishedCard();
  const before = structuredClone(card);
  const entries = card.contextHistory.entries;
  assert.equal(entries.length, 9);
  const out = compactHistory(card, { now: NOW });
  assert.equal(out.dropped, 3);
  assert.notEqual(out.task, card);
  assert.notEqual(out.task.contextHistory, card.contextHistory, "a new history object, never the prior one");
  const kept = out.task.contextHistory.entries;
  assert.deepEqual(kept.map((entry) => entry.revision), KEPT.map((index) => index + 1), "revisions are never renumbered");
  KEPT.forEach((index, at) => assert.equal(kept[at], entries[index], `entry ${index + 1} is the same object`));
  assert.equal(out.task.contextHistory.version, 1);
  assert.deepEqual(out.task.contextHistory.compacted, { at: NOW, dropped: 3 });
  assert.ok(out.bytesBefore > out.bytesAfter && out.bytesAfter > 0, `${out.bytesBefore} > ${out.bytesAfter}`);
  // Measured as the board file writes it (indented, two levels deep), so the
  // saving reported is what the file loses.
  const onDisk = (history) => Buffer.byteLength(JSON.stringify([{ contextHistory: history }], null, 2));
  assert.equal(out.bytesBefore, onDisk(card.contextHistory));
  assert.equal(out.bytesAfter, onDisk(out.task.contextHistory));
  assert.equal(out.bytesBefore - out.bytesAfter, Buffer.byteLength(JSON.stringify([card], null, 2)) - Buffer.byteLength(JSON.stringify([out.task], null, 2)), "the saving is exactly what the board file loses");
  assert.equal(out.task.contextHistory.entries.at(-1).revision, card.contextHistory.entries.at(-1).revision, "contextVersion is unchanged");
  assert.deepEqual(card, before, "the input card is not changed");
  const { contextHistory: _history, ...body } = out.task;
  const { contextHistory: _before, ...cardBody } = card;
  assert.deepEqual(body, cardBody, "only the history changes");

  // A restore is kept even when it restored the brief the card already had.
  const restored = restoreTaskRevision(card, entries[8].id, { now: NOW - HOUR }).task;
  const later = recordTaskRevision({ ...restored, logs: [...restored.logs, { at: NOW - HOUR + 1, text: "reviewed" }] }, { previous: restored, now: NOW - HOUR + 1 });
  const again = compactHistory(later, { now: NOW });
  assert.ok(again.task.contextHistory.entries.some((entry) => entry.kind === "restored"), "the restore entry is kept");
  assert.equal(again.task.contextHistory.entries.find((entry) => entry.kind === "restored").revision, 10);
});

test("a brief field cleared to null and one left out are different briefs, so both are kept", () => {
  // e2 sets `note: null` (a form cleared the field) with nothing else in the
  // brief changing: restoring e1 deletes the field, restoring e2 writes null,
  // so dropping e2 would lose a brief the owner could restore.
  const card = build({ id: "task_null", title: "Clear the note", prompt: "Brief", status: "open", logs: [], createdAt: NOW - 48 * HOUR, updatedAt: NOW - 48 * HOUR }, [
    { note: null, logs: [{ at: 1, text: "cleared" }] },
    { logs: [{ at: 1, text: "cleared" }, { at: 2, text: "noise" }] },
    { logs: [{ at: 1, text: "cleared" }, { at: 2, text: "noise" }, { at: 3, text: "more" }] },
    { status: "done", doneAt: NOW - 47 * HOUR },
  ], NOW - 48 * HOUR);
  const entries = card.contextHistory.entries;
  assert.equal(Object.hasOwn(entries[0].snapshot, "note"), false);
  assert.equal(entries[1].snapshot.note, null);
  const out = compactHistory(card, { now: NOW });
  assert.ok(out.task.contextHistory.entries.includes(entries[1]), "the null brief is kept");
  assert.ok(!out.task.contextHistory.entries.includes(entries[2]), "log noise under the same brief still goes");
});

test("open work, unfinished archives and short histories come back as the same task; archived-complete cards compact", () => {
  const card = finishedCard();
  for (const status of [{ status: "open" }, { status: "awaiting_verification" }, { status: "archived", doneAt: undefined, verification: undefined }]) {
    const row = { ...card, ...status };
    const out = compactHistory(row, { now: NOW });
    assert.equal(out.task, row, JSON.stringify(status));
    assert.deepEqual([out.dropped, out.bytesBefore, out.bytesAfter], [0, 0, 0]);
  }
  const short = { ...card, contextHistory: { version: 1, entries: card.contextHistory.entries.slice(0, 3) } };
  assert.equal(compactHistory(short, { now: NOW }).task, short, "under four entries");
  const entries = card.contextHistory.entries;
  for (const odd of [{ id: "revision_x", revision: "ten", snapshot: { id: card.id } }, { ...entries[1], snapshot: { ...entries[1].snapshot, id: "task_other" } }]) {
    const unknown = { ...card, contextHistory: { version: 1, entries: [...entries.slice(0, 5), odd, ...entries.slice(5)] } };
    assert.equal(compactHistory(unknown, { now: NOW }).task, unknown, "a history this module did not write");
  }
  assert.equal(compactHistory(null).task, null);
  const archived = { ...card, status: "archived", doneAt: undefined, verification: undefined, completionFromTaskId: "task_other" };
  assert.equal(compactHistory(archived, { now: NOW }).dropped, 3, "archived as another card's completion counts as done");
});

test("compaction is idempotent, picks up revisions recorded after it, and stamps a history with nothing to drop once", () => {
  const first = compactHistory(finishedCard(), { now: NOW });
  assert.equal(compactHistory(first.task, { now: NOW + MIN }).task, first.task, "a second pass changes nothing");
  // A revision recorded later: the entry before it was the last of r2 and is
  // now dropped; the stamp keeps the running total.
  const touched = recordTaskRevision({ ...first.task, logs: [...first.task.logs, { at: NOW + HOUR, text: "archived by the assistant" }] }, { previous: first.task, now: NOW + HOUR });
  assert.equal(touched.contextHistory.entries.length, 7);
  const second = compactHistory(touched, { now: NOW + 2 * HOUR });
  assert.equal(second.dropped, 1);
  assert.deepEqual(second.task.contextHistory.compacted, { at: NOW + 2 * HOUR, dropped: 4 });
  assert.deepEqual(second.task.contextHistory.entries.map((entry) => entry.revision), [1, 3, 5, 6, 7, 10]);

  // Every entry a brief change: nothing to drop, stamped once.
  const edits = build({ id: "task_edits", title: "Edits", prompt: "v1", status: "open" }, [{ prompt: "v2" }, { prompt: "v3" }, { prompt: "v4", status: "done", doneAt: NOW - HOUR }], NOW - 2 * HOUR);
  const stamped = compactHistory(edits, { now: NOW });
  assert.equal(stamped.dropped, 0);
  assert.notEqual(stamped.task, edits);
  assert.deepEqual(stamped.task.contextHistory.compacted, { at: NOW, dropped: 0 });
  assert.equal(stamped.task.contextHistory.entries.length, 4);
  assert.equal(compactHistory(stamped.task, { now: NOW + MIN }).task, stamped.task);
});

test("recordTaskRevision keeps a compacted history only as kind \"compacted\", only when it drops entries and nothing else", () => {
  const card = finishedCard();
  const out = compactHistory(card, { now: NOW });
  const accepted = recordTaskRevision(out.task, { previous: card, kind: "compacted", now: NOW });
  assert.equal(accepted, out.task, "taken as supplied");
  assert.equal(accepted.contextHistory.entries.length, 6, "no revision appended");
  assert.notEqual(accepted.contextHistory, card.contextHistory);
  assert.equal(recordTaskRevision(out.task, { previous: card, now: NOW }).contextHistory, card.contextHistory, "any other kind discards the shorter history, as before");

  const entries = card.contextHistory.entries;
  const kept = out.task.contextHistory.entries;
  const forged = { ...kept[2], hash: "0".repeat(64) };
  for (const [label, list] of [
    ["out of order", [kept[0], kept[2], kept[1], ...kept.slice(3)]],
    ["first dropped", entries.slice(1)],
    ["last dropped", entries.slice(0, -1)],
    ["an entry not in the prior history", [kept[0], kept[1], forged, ...kept.slice(3)]],
    ["longer than the prior history", [...entries, entries.at(-1)]],
    ["empty", []],
  ]) {
    const row = { ...out.task, contextHistory: { version: 1, entries: list } };
    const result = recordTaskRevision(row, { previous: card, kind: "compacted", now: NOW });
    assert.equal(result.contextHistory, card.contextHistory, label);
  }
  // Compacted and changed in one mutation: recorded the ordinary way, so the
  // change gets its revision and the compaction waits for another pass.
  const changed = recordTaskRevision({ ...out.task, title: "Renamed" }, { previous: card, kind: "compacted", now: NOW });
  assert.equal(changed.contextHistory.entries.length, 10);
  assert.equal(changed.contextHistory.entries.slice(0, 9).every((entry, index) => entry === entries[index]), true);
  assert.deepEqual([changed.contextHistory.entries[9].revision, changed.contextHistory.entries[9].kind], [10, "updated"]);
  assert.equal(changed.contextHistory.compacted, undefined, "the discarded compaction leaves no stamp");
  // A later revision keeps the stamp of the history it extends.
  const later = recordTaskRevision({ ...accepted, title: "Renamed later" }, { previous: accepted, now: NOW + 1 });
  assert.equal(later.contextHistory.entries.length, 7);
  assert.deepEqual(later.contextHistory.compacted, { at: NOW, dropped: 3 });
});

test("the legacy fast path answers the same before and after compaction", () => {
  // Entries hashed the way the older FIELDS list did: status and runId were
  // snapshotted, as on the frozen 2d Trippy Hell board.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const legacyEntry = (revision, task) => {
    const snapshot = { ...snapshotTask(task), status: task.status, ...(task.runId ? { runId: task.runId } : {}) };
    const hash = createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex");
    return { id: `revision_${revision}_${hash.slice(0, 16)}`, revision, at: NOW - 10 * HOUR + revision, kind: "updated", note: "", hash, snapshot };
  };
  const base = { id: "task_legacy", title: "Legacy card", prompt: "Brief", logs: [] };
  const states = [
    { ...base, status: "open" },
    { ...base, status: "active", runId: "r1" },
    { ...base, status: "active", runId: "r1", logs: [{ at: 1, text: "working" }] },
    { ...base, status: "awaiting_verification", logs: [{ at: 1, text: "working" }], lastAttempt: { runId: "r1" } },
    { ...base, status: "done", doneAt: NOW - 9 * HOUR, logs: [{ at: 1, text: "working" }], lastAttempt: { runId: "r1" }, verification: { state: "verified" } },
  ];
  const card = { ...states.at(-1), contextHistory: { version: 1, entries: states.map((state, index) => legacyEntry(index + 1, state)) } };
  const heartbeat = (row) => recordTaskRevision({ ...row, updatedAt: NOW }, { previous: row, now: NOW });
  assert.equal(heartbeat(card).contextHistory, card.contextHistory, "before: no catch-up revision");

  const out = compactHistory(card, { now: NOW });
  assert.ok(out.dropped > 0);
  const saved = recordTaskRevision(out.task, { previous: card, kind: "compacted", now: NOW });
  assert.equal(saved, out.task, "a legacy latest entry that still matches the card accepts the compaction");
  assert.equal(saved.contextHistory.entries.at(-1), card.contextHistory.entries.at(-1), "the latest entry is kept unchanged");
  assert.equal(heartbeat(saved).contextHistory, saved.contextHistory, "after: still no catch-up revision");
  const edited = recordTaskRevision({ ...saved, title: "Legacy card, renamed" }, { previous: saved, now: NOW + 1 });
  assert.equal(edited.contextHistory.entries.at(-1).revision, 6);
  assert.equal(edited.contextHistory.entries.at(-1).snapshot.status, undefined);
});

test("history pages and restores still work on a compacted card; a dropped revision is gone", () => {
  const card = finishedCard();
  const compacted = compactHistory(card, { now: NOW }).task;
  const page = taskHistory(compacted, { limit: 4 });
  assert.deepEqual(page.entries.map((entry) => entry.revision), [9, 7, 6, 5]);
  assert.equal(page.hasMore, true);
  assert.deepEqual(taskHistory(compacted, { before: page.nextBefore }).entries.map((entry) => entry.revision), [3, 1]);
  const first = compacted.contextHistory.entries[0];
  const restored = restoreTaskRevision(compacted, first.id, { now: NOW });
  assert.equal(restored.ok, true);
  assert.equal(restored.task.prompt, "Brief A");
  assert.equal(restored.task.status, "done", "completion is never rolled back");
  assert.deepEqual([restored.task.contextHistory.entries.at(-1).revision, restored.task.contextHistory.entries.at(-1).kind], [10, "restored"]);
  assert.deepEqual(restored.task.contextHistory.compacted, { at: NOW, dropped: 3 }, "the stamp rides along");
  const dropped = card.contextHistory.entries[1];
  assert.equal(restoreTaskRevision(compacted, dropped.id, { now: NOW }).ok, false);
});

// The gateway's file path on the real reader, as tests/board_gateway.test.mjs
// runs it, with saveTaskEdits beside it.
const gateway = section("const isThenable = (value) =>", "// Drop a claim this run still owns.");
async function gatewayHarness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-compaction-"));
  const projects = createProjects({ defaultRoot: dir, studioRoot: dir, isDirectory: () => true });
  const scoped = projects.eyes(eyes);
  const project = projects.current();
  let revisions = 0;
  const context = vm.createContext({
    console, structuredClone, Buffer,
    getEyes: async () => scoped,
    withBoardLock: (fn) => fn(),
    send: () => {},
    taskView: (task) => task,
    backlog,
    taskContext: { ...taskContext, recordTaskRevision: (...args) => { revisions += 1; return taskContext.recordTaskRevision(...args); } },
    projects: { current: () => project },
    projectRoot: () => project.path,
    REQUESTS_PATH: path.join(dir, "eyes-requests.json"),
    TASKS_PATH: path.join(dir, "eyes-tasks.json"),
    IDEAS_PATH: path.join(dir, "eyes-feature-ideas.json"),
  });
  vm.runInContext(`${gateway}\n${section("async function saveTaskEdits(rows)", "function workTitleKey(")}`, context);
  const stamp = { projectId: project.id, projectPath: project.path };
  return {
    context, dir, project, stamp,
    tasksFile: path.join(dir, "eyes-tasks.json"),
    seed: (rows) => writeFile(path.join(dir, "eyes-tasks.json"), JSON.stringify(rows, null, 2)),
    rows: async () => JSON.parse(await readFile(path.join(dir, "eyes-tasks.json"), "utf8")),
    revisions: () => revisions,
    reset: () => { revisions = 0; },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}
const written = (result) => [...(result.written ?? [])];

test("the gateway keeps a history its mutator compacted only for the rows it marks, and the memo still skips them after", async () => {
  const h = await gatewayHarness();
  try {
    const card = finishedCard(h.stamp);
    const open = build({ id: "task_open", title: "Open card", prompt: "Brief", status: "open", ...h.stamp }, [{ logs: [{ at: 1, text: "a" }] }], NOW - HOUR);
    await h.seed([card, open]);
    const { mutateBoard } = h.context;
    await mutateBoard(() => ({})); // a fresh parse is hashed once
    const ids = card.contextHistory.entries.map((entry) => entry.id);

    // Unmarked: the shorter history is discarded, as before this change.
    h.reset();
    const unmarked = await mutateBoard((board) => { board.tasks[0] = compactHistory(board.tasks[0], { now: NOW }).task; return {}; });
    assert.deepEqual(written(unmarked), []);
    assert.equal((await h.rows())[0].contextHistory.entries.length, 9);
    // Another per-row kind is not honoured.
    const other = await mutateBoard((board) => { board.tasks[0] = compactHistory(board.tasks[0], { now: NOW }).task; return { revisionKinds: { task_done: "restored" } }; });
    assert.deepEqual(written(other), []);

    h.reset();
    let priorHistory = null;
    const marked = await mutateBoard((board) => {
      priorHistory = board.tasks[0].contextHistory;
      board.tasks[0] = compactHistory(board.tasks[0], { now: NOW }).task;
      return { revisionKinds: { task_done: "compacted" } };
    });
    assert.deepEqual(written(marked), ["tasks"]);
    assert.equal(h.revisions(), 1, "only the compacted row is recorded");
    const saved = (await h.rows())[0];
    assert.deepEqual(saved.contextHistory.entries.map((entry) => entry.id), KEPT.map((index) => ids[index]));
    assert.deepEqual(saved.contextHistory.compacted, { at: NOW, dropped: 3 });
    assert.equal((await h.rows())[1].contextHistory.entries.length, 2, "the other row is untouched");
    assert.notEqual(marked.tasks[0].contextHistory, priorHistory, "a new history object");

    // The next passes: nothing written, nothing re-hashed.
    h.reset();
    assert.deepEqual(written(await mutateBoard(() => ({}))), []);
    assert.deepEqual(written(await mutateBoard(() => ({}))), []);
    assert.equal(h.revisions(), 0);

    // Restore through the gateway on the compacted card.
    const restored = await mutateBoard((board) => {
      const out = taskContext.restoreTaskRevision(board.tasks[0], board.tasks[0].contextHistory.entries[0].id, { now: NOW + MIN });
      board.tasks[0] = out.task;
      return { revisionNote: "Restored" };
    });
    assert.deepEqual(written(restored), ["tasks"]);
    const after = (await h.rows())[0];
    assert.equal(after.prompt, "Brief A");
    assert.deepEqual(after.contextHistory.entries.map((entry) => entry.revision), [1, 3, 5, 6, 7, 9, 10]);
  } finally {
    await h.close();
  }
});

test("a row compacted and changed in one mutation keeps its change and its full history", async () => {
  const h = await gatewayHarness();
  try {
    const card = finishedCard(h.stamp);
    await h.seed([card]);
    const { mutateBoard } = h.context;
    const result = await mutateBoard((board) => {
      board.tasks[0] = { ...compactHistory(board.tasks[0], { now: NOW }).task, title: "Renamed" };
      return { revisionKinds: { task_done: "compacted" } };
    });
    assert.deepEqual(written(result), ["tasks"]);
    const saved = (await h.rows())[0];
    assert.equal(saved.title, "Renamed");
    assert.equal(saved.contextHistory.entries.length, 10);
    assert.equal(saved.contextHistory.compacted, undefined);
  } finally {
    await h.close();
  }
});

test("a details form opened at a revision compaction dropped fails safe; one at a kept revision still saves", async () => {
  const h = await gatewayHarness();
  try {
    const card = finishedCard(h.stamp);
    await h.seed([compactHistory(card, { now: NOW }).task]);
    const { saveTaskEdits } = h.context;
    const formAt = (entry) => ({ ...entry.snapshot, contextVersion: entry.revision });
    const stale = await saveTaskEdits([{ ...formAt(card.contextHistory.entries[7]), title: "Edited in an old form" }]);
    assert.equal(stale.ok, false);
    assert.match(stale.error, /A task changed while these details were open/);
    assert.equal((await h.rows())[0].title, "Wire the banner");

    const older = await saveTaskEdits([{ ...formAt(card.contextHistory.entries[6]), title: "Edited at a kept revision" }]);
    assert.equal(older.ok, true, older.error);
    const rows = await h.rows();
    assert.equal(rows[0].title, "Edited at a kept revision");
    const latest = rows[0].contextHistory.entries.at(-1);
    assert.deepEqual([latest.revision, latest.kind], [10, "edited"]);
    const fresh = await saveTaskEdits([{ ...formAt(latest), notes: "Saved at the latest revision" }]);
    assert.equal(fresh.ok, true, fresh.error);
    assert.equal((await h.rows())[0].notes, "Saved at the latest revision");
  } finally {
    await h.close();
  }
});

// The keeper on the real gateway: tidy, the audit, then compaction, in one
// mutation.
async function keeperHarness({ prefs = {} } = {}) {
  const h = await gatewayHarness();
  const logs = [], errors = [];
  let state = { ...assistant.emptyState(NOW - HOUR), projectId: h.project.id };
  state.prefs = { ...state.prefs, ...prefs };
  state.housekeeping = { ...state.housekeeping, loopArmedAt: NOW - HOUR };
  Object.assign(h.context, {
    assistantState: state,
    assistantCache: { store: null, audit: null, duplicateScan: null },
    consumeReviewedTaskGroups: async () => {},
    getAssistant: async () => assistant,
    CHECKPOINTS_PATH: path.join(h.dir, "eyes-checkpoints.json"),
    assistantLog: (kind, text) => logs.push({ kind, text }),
    logError: (text) => errors.push(text),
    assistantEmit: () => {},
    assistantVisit: async () => {},
    taskTarget: (id) => ({ kind: "task", id: `task:${id}` }),
    assistantClip: (value, max) => String(value ?? "").slice(0, max),
    FOLDED_NODE: { kind: "folded", id: "__folded__" },
  });
  vm.runInContext([
    section("async function assistantKeeperJob(", "// Structural equality for plain JSON state"),
    section("// Structural equality for plain JSON state", "// briefer:"),
  ].join("\n"), h.context);
  return { ...h, logs, errors, state: () => h.context.assistantState, run: (at = NOW) => h.context.assistantKeeperJob(at, null) };
}

test("the keeper compacts finished cards past the tidy clock that its pass left alone, and reports it", async () => {
  const h = await keeperHarness();
  try {
    const archivedLong = finishedCard({ id: "task_archived", ...h.stamp }, NOW - 72 * HOUR);
    const rows = [
      // Done 48 hours ago: tidy archives it this pass, so it compacts next pass.
      finishedCard({ id: "task_done", ...h.stamp }, NOW - 48 * HOUR),
      // Archived as done long ago and untouched: compacts this pass.
      { ...archivedLong, status: "archived" },
      // Finished an hour ago: inside the tidy clock.
      finishedCard({ id: "task_recent", ...h.stamp }, NOW - HOUR - 10 * MIN),
      // Open work never compacts.
      { ...finishedCard({ id: "task_open", ...h.stamp }, NOW - 72 * HOUR), status: "open", doneAt: undefined },
    ];
    await h.seed(rows);
    await h.run();
    assert.deepEqual(h.errors, []);
    let saved = Object.fromEntries((await h.rows()).map((row) => [row.id, row]));
    assert.equal(saved.task_archived.contextHistory.entries.length, 6);
    assert.equal(saved.task_done.status, "archived", "tidy archived it");
    assert.equal(saved.task_done.contextHistory.compacted, undefined, "a row this pass changed is not compacted");
    assert.equal(saved.task_recent.contextHistory.compacted, undefined);
    assert.equal(saved.task_open.contextHistory.compacted, undefined);
    let housekeeping = h.state().housekeeping;
    assert.equal(housekeeping.historyCompacted, 1);
    assert.ok(housekeeping.historyBytesSaved > 0);
    assert.match(housekeeping.lastText, /^archived 1 done task · compacted the history of 1 finished card \(\d+ KB saved\)/);
    const onDisk = (history) => Buffer.byteLength(JSON.stringify([{ contextHistory: history }], null, 2));
    assert.equal(housekeeping.historyBytesSaved, onDisk(archivedLong.contextHistory) - onDisk(saved.task_archived.contextHistory));

    await h.run(NOW + MIN);
    saved = Object.fromEntries((await h.rows()).map((row) => [row.id, row]));
    assert.ok(saved.task_done.contextHistory.entries.length < 10);
    assert.equal(saved.task_done.contextHistory.compacted.at, NOW + MIN);
    housekeeping = h.state().housekeeping;
    assert.equal(housekeeping.historyCompacted, 1);
    assert.match(housekeeping.lastText, /^compacted the history of 1 finished card/);

    const settled = await readFile(h.tasksFile, "utf8");
    await h.run(NOW + 2 * MIN);
    assert.equal(await readFile(h.tasksFile, "utf8"), settled, "a third pass writes nothing");
    assert.equal(h.state().housekeeping.historyCompacted, 0);
    assert.doesNotMatch(h.state().housekeeping.lastText, /compacted/);
    const reloaded = assistant.normalizeState(plain(h.state()), NOW);
    assert.equal(reloaded.housekeeping.historyCompacted, 0);
    assert.equal(typeof reloaded.housekeeping.historyBytesSaved, "number");
  } finally {
    await h.close();
  }
});

test("the keeper compacts at most 20 cards a pass, oldest first, and none with the compactHistory pref off", async () => {
  const h = await keeperHarness();
  try {
    const rows = Array.from({ length: 23 }, (_, index) => {
      const card = finishedCard({ id: `task_${String(index).padStart(2, "0")}`, ...h.stamp }, NOW - (100 - index) * HOUR);
      return { ...card, status: "archived" };
    });
    await h.seed(rows);
    await h.run();
    const first = await h.rows();
    const compacted = first.filter((row) => row.contextHistory.compacted).map((row) => row.id);
    assert.equal(compacted.length, 20);
    assert.deepEqual(compacted, rows.slice(0, 20).map((row) => row.id), "the oldest first");
    assert.equal(h.state().housekeeping.historyCompacted, 20);
    await h.run(NOW + MIN);
    assert.equal((await h.rows()).filter((row) => row.contextHistory.compacted).length, 23);
    assert.equal(h.state().housekeeping.historyCompacted, 3);
  } finally {
    await h.close();
  }
  const off = await keeperHarness({ prefs: { compactHistory: false } });
  try {
    const card = { ...finishedCard({ id: "task_old", ...off.stamp }, NOW - 72 * HOUR), status: "archived" };
    await off.seed([card]);
    const before = await readFile(off.tasksFile, "utf8");
    await off.run();
    assert.equal(await readFile(off.tasksFile, "utf8"), before);
    assert.equal(off.state().housekeeping.historyCompacted, 0);
  } finally {
    await off.close();
  }
});

test("the compactHistory pref defaults on and survives a reload", () => {
  assert.equal(assistant.DEFAULT_PREFS.compactHistory, true);
  assert.equal(assistant.emptyState(NOW).prefs.compactHistory, true);
  assert.equal(assistant.normalizeState({ prefs: { compactHistory: false } }, NOW).prefs.compactHistory, false);
  assert.equal(assistant.normalizeState({ prefs: { compactHistory: "no" } }, NOW).prefs.compactHistory, true);
  const state = assistant.normalizeState({ housekeeping: { historyCompacted: 3.7, historyBytesSaved: 4096, lastText: "x" } }, NOW);
  assert.deepEqual([state.housekeeping.historyCompacted, state.housekeeping.historyBytesSaved], [3, 4096]);
  assert.deepEqual([assistant.emptyState(NOW).housekeeping.historyCompacted, assistant.emptyState(NOW).housekeeping.historyBytesSaved], [0, 0]);
});

test("the memory audit reports what compaction could drop and writes nothing", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-audit-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const rows = [finishedCard(), { ...finishedCard({ id: "task_open" }), status: "open" }];
  await writeFile(path.join(dir, "eyes-tasks.json"), `${JSON.stringify(rows, null, 2)}\n`);
  await writeFile(path.join(dir, "eyes-assistant.json"), `${JSON.stringify({ prefs: { compactHistory: false } }, null, 2)}\n`);
  const snapshot = async () => Promise.all((await readdir(dir)).sort().map(async (name) => `${name} ${createHash("sha256").update(await readFile(path.join(dir, name))).digest("hex")}`));
  const before = await snapshot();
  const result = spawnSync(process.execPath, [path.join(studio, "tools", "memory_audit.mjs"), "--data", dir, "--now", String(NOW)], { cwd: studio, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\nhistory: 1 completed card could drop 3 revisions \(\d+ KB\) · compaction is off \(the compactHistory pref\)$/m);
  assert.deepEqual(await snapshot(), before);
});
