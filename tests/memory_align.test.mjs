import test from "node:test";
import assert from "node:assert/strict";
import {
  FOLDER_LIMITS,
  alignMemory,
  applyMemoryDelta,
  applyNodeContext,
  auditPass,
  clearNodeFolder,
  compileMemory,
  emptyState,
  inferMemoryCell,
  lessonGroups,
  nodeFolderLines,
  nodeKeyOf,
  normalizeNodeFolders,
  normalizeState,
  overseerMerge,
  tidy,
} from "../scripts/assistant.mjs";

// Memory kept in step with the board: run lines that only claim a run ended are
// observations, the keeper writes the board's verdict into the task's folder
// once, one task has one folder, session echoes do not crowd out the rest, and
// the overseer's playbook folds rewordings and retires stale status lessons.

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const run = (text, at, extra = {}) => ({ at, kind: "run", role: "executor", text, ...extra });
const claimText = (title) => `autopilot "${title}" — finished, verifying (exit 0)`;
// A folder as the old code stored a claim: filed as a verification.
const legacyClaim = (title, at) => ({ updatedAt: at, entries: [run(claimText(title), at, { cell: "ver", confidence: 0.85 })] });
const key = (id) => `task:task:${id}`;

test("a run that only says it ended is an observation; verdicts keep their cells", () => {
  assert.equal(inferMemoryCell("run", claimText("Wire the retry")), "obs");
  assert.equal(inferMemoryCell("run", 'autopilot "Wire the retry" — finished, awaiting verification (exit 0)'), "obs");
  assert.equal(inferMemoryCell("run", 'autopilot "Wire the retry" — stopped on request — progress saved (exit ?)'), "obs", "a stopped run did not fail and did not finish");
  assert.equal(inferMemoryCell("run", "autopilot finished — done (exit 0)"), "ver", "pinned: a done line is a verification");
  assert.equal(inferMemoryCell("run", "autopilot run failed (exit 1)"), "rsk", "pinned: a failed run is a risk");
});

test("alignment relabels a stored claim, capped at the unverified confidence", () => {
  const folders = { [key("task_a")]: legacyClaim("Wire the retry", T0) };
  const tasks = [{ id: "task_a", status: "active", runId: "run_1" }];
  const delta = alignMemory({ nodeFolders: folders, tasks, now: T0 + HOUR });
  assert.deepEqual(delta.relabel, [{ key: key("task_a"), at: T0, text: claimText("Wire the retry"), cell: "obs", confidence: 0.7 }]);
  assert.deepEqual(delta.append, [], "a running card has no verdict yet");
  const state = applyMemoryDelta({ ...emptyState(T0), nodeFolders: folders }, delta);
  const [entry] = state.nodeFolders[key("task_a")].entries;
  assert.equal(entry.cell, "obs");
  assert.ok(entry.confidence <= 0.7);
  assert.deepEqual(alignMemory({ nodeFolders: state.nodeFolders, tasks, now: T0 + 2 * HOUR }).relabel, [], "relabelled once");
});

test("each board verdict lands once over two passes, and no folder's updatedAt moves", () => {
  const titles = { verified: "Ship it", manual: "Hand-closed", unverified: "Try once", failed: "Parked by the verifier", broken: "Keeps failing", held: "Loops", stopped: "Stopped mid-run" };
  const folders = Object.fromEntries(Object.entries(titles).map(([id, title], index) => [key(id), legacyClaim(title, T0 + index * MIN)]));
  const tasks = [
    { id: "verified", status: "done", doneAt: T0 + HOUR, verification: { state: "verified", reason: "2 changed file(s) in the attempt's session" } },
    { id: "manual", status: "done", doneAt: T0 + HOUR, verification: { state: "manual" } },
    { id: "unverified", status: "open", verification: { state: "unverified", reason: "no attributable edits and no named checks" } },
    { id: "failed", status: "open", verifyAttempts: 3, verification: { state: "failed", reason: "outstanding obligations remain" } },
    { id: "broken", status: "open", runFailures: 5 },
    { id: "held", status: "open", loopGuard: { v: 1, at: T0, kind: "attempts", count: 6, reason: "recorded checks failed", by: "keeper" } },
    { id: "stopped", status: "open", runProgress: { pending: true } },
  ];
  const now = T0 + 2 * HOUR;
  const first = alignMemory({ nodeFolders: folders, tasks, now });
  const appended = Object.fromEntries(first.append.map((row) => [row.key.slice("task:task:".length), `${row.entry.cell} ${row.entry.text}`]));
  assert.deepEqual(appended, {
    verified: "ver verified done — 2 changed file(s) in the attempt's session",
    manual: "obs marked done — not verified",
    unverified: "rsk not verified — no attributable edits and no named checks",
    failed: "rsk parked — outstanding obligations remain",
    broken: "rsk parked — 5 attempts failed",
    held: "rsk loop guard — recorded checks failed",
    stopped: "obs stopped — resumes from saved progress",
  });
  assert.ok(first.append.every((row) => row.entry.at === now && row.entry.kind === "agent" && row.entry.role === "keeper"));
  assert.deepEqual(first.settle.map((row) => [row.key, row.settled]).sort(), [[key("manual"), "done"], [key("verified"), "done"]]);

  const state = applyMemoryDelta({ ...emptyState(T0), nodeFolders: folders }, first);
  for (const [name, folder] of Object.entries(state.nodeFolders)) assert.equal(folder.updatedAt, folders[name].updatedAt, `${name}: the keeper's note is not a fresh touch`);
  const unverified = state.nodeFolders[key("unverified")].entries;
  assert.equal(unverified[0].superseded, true, "the claim the verifier contradicted is superseded");
  assert.equal(state.nodeFolders[key("verified")].entries[0].superseded, false, "a verified claim was right, so it stands");

  const second = alignMemory({ nodeFolders: state.nodeFolders, tasks, now: now + HOUR });
  assert.deepEqual(second, { relabel: [], append: [], settle: [] }, "a second pass has nothing to add");
  assert.equal(applyMemoryDelta(state, first).nodeFolders[key("unverified")].entries.length, 2, "re-applying the same delta appends nothing");
});

test("a later claim that fails verification again is contradicted again", () => {
  const tasks = [{ id: "again", status: "open", verification: { state: "unverified", reason: "no attributable edits and no named checks" } }];
  let state = { ...emptyState(T0), nodeFolders: { [key("again")]: legacyClaim("Try again", T0) } };
  state = applyMemoryDelta(state, alignMemory({ nodeFolders: state.nodeFolders, tasks, now: T0 + HOUR }));
  state = applyNodeContext(state, { key: key("again"), kind: "run", role: "executor", text: claimText("Try again"), at: T0 + 2 * HOUR }, T0 + 2 * HOUR);
  const delta = alignMemory({ nodeFolders: state.nodeFolders, tasks, now: T0 + 3 * HOUR });
  assert.equal(delta.append.length, 1, "the new claim is the newest entry again, so the verdict is written again");
  state = applyMemoryDelta(state, delta);
  const entries = state.nodeFolders[key("again")].entries;
  assert.equal(entries.at(-1).text, "not verified — no attributable edits and no named checks");
  assert.equal(entries.filter((entry) => !entry.superseded && entry.text.startsWith("not verified")).length, 1, "the older copy of the verdict is superseded, not left standing");
});

test("owner notes are never relabelled or superseded by the keeper", () => {
  const note = { at: T0, kind: "note", text: `keep: ${claimText("Wire the retry")} was a fluke`, cell: "dec" };
  const folders = { [key("task_a")]: { updatedAt: T0 + MIN, entries: [note, run(claimText("Wire the retry"), T0 + MIN, { cell: "ver" })] } };
  const tasks = [{ id: "task_a", status: "open", verification: { state: "unverified", reason: "the run did not report success" } }];
  const delta = alignMemory({ nodeFolders: folders, tasks, now: T0 + HOUR });
  assert.equal(delta.relabel.length, 1);
  assert.equal(delta.relabel[0].at, T0 + MIN, "only the run line is relabelled");
  const state = applyMemoryDelta({ ...emptyState(T0), nodeFolders: folders }, delta);
  const [owner, claim] = state.nodeFolders[key("task_a")].entries;
  assert.equal(owner.superseded, false, "the contradiction names the claim text, and the owner's note quotes it, but the owner's words stand");
  assert.equal(owner.cell, "dec");
  assert.equal(claim.superseded, true);
  const forged = applyMemoryDelta(state, { relabel: [{ key: key("task_a"), at: T0, text: note.text, cell: "obs", confidence: 0.1 }] });
  assert.equal(forged, state, "a relabel aimed at an owner note is refused");
});

test("a stopped run is no claim, and an earlier attempt's verdict does not answer a later claim", () => {
  const id = "task_s";
  const verdict = { state: "unverified", reason: "no attributable edits and no named checks", at: T0 + MIN };
  let tasks = [{ id, title: "Wire it", status: "open", verification: verdict, logs: [] }];
  let state = { ...emptyState(T0), nodeFolders: { [key(id)]: { updatedAt: T0, entries: [run(claimText("Wire it"), T0)] } } };
  state = applyMemoryDelta(state, alignMemory({ nodeFolders: state.nodeFolders, tasks, now: T0 + HOUR }));
  // Attempt 2 is stopped by a restart: the card keeps attempt 1's verdict.
  const stop = 'autopilot "Wire it" — stopped on request — progress saved (exit ?)';
  state = applyNodeContext(state, { key: key(id), kind: "run", role: "executor", text: stop, at: T0 + 2 * HOUR }, T0 + 2 * HOUR);
  tasks = [{ ...tasks[0], runProgress: { pending: true } }];
  const audit = auditPass({ tasks, nodeFolders: state.nodeFolders, now: T0 + 3 * HOUR, armedAt: T0 });
  assert.deepEqual(audit.memoryDelta.append.map((row) => row.entry.text), ["stopped — resumes from saved progress"], "the old verdict is not repeated against the stop");
  assert.equal(audit.findings[0].issue, null, "a stop is not the run's own claim");
  state = applyMemoryDelta(state, audit.memoryDelta);
  const entries = state.nodeFolders[key(id)].entries;
  assert.equal(entries.find((entry) => entry.text === stop).superseded, false, "the stop record stands");
  assert.equal(entries.filter((entry) => entry.text.startsWith("not verified")).length, 1);

  // Attempt 3 finishes; until its own verdict arrives, attempt 1's says nothing about it.
  state = applyNodeContext(state, { key: key(id), kind: "run", role: "executor", text: claimText("Wire it"), at: T0 + 4 * HOUR }, T0 + 4 * HOUR);
  tasks = [{ id, title: "Wire it", status: "open", verification: verdict, logs: [] }];
  assert.deepEqual(alignMemory({ nodeFolders: state.nodeFolders, tasks, now: T0 + 5 * HOUR }).append, []);
  assert.equal(auditPass({ tasks, nodeFolders: state.nodeFolders, now: T0 + 5 * HOUR, armedAt: T0 }).findings[0].issue, null);
  const done = [{ ...tasks[0], status: "done", doneAt: T0 + 5 * HOUR, verification: { state: "verified", reason: "ok", at: T0 + MIN } }];
  assert.deepEqual(alignMemory({ nodeFolders: state.nodeFolders, tasks: done, now: T0 + 5 * HOUR }).append, [], "nor does an old verified verdict");
  const answered = alignMemory({ nodeFolders: state.nodeFolders, tasks: [{ ...tasks[0], verification: { ...verdict, at: T0 + 4 * HOUR + MIN } }], now: T0 + 5 * HOUR });
  assert.deepEqual(answered.append.map((row) => [row.entry.text, row.entry.contradicts]), [["not verified — no attributable edits and no named checks", claimText("Wire it")]]);

  // A title that says "verifying" does not make a failed run a claim.
  const titled = { [key("task_t")]: { updatedAt: T0, entries: [run('autopilot "Fix the verifying spinner" — failed (exit 1)', T0)] } };
  assert.deepEqual(alignMemory({ nodeFolders: titled, tasks: [{ id: "task_t", status: "open", verification: verdict }], now: T0 + HOUR }).append, []);
});

test("the keeper's notes never push the owner's words out of a full folder", () => {
  const owner = { at: T0, kind: "note", role: "owner", text: "Do not touch the updater; keep the old poll", cell: "dec" };
  const steps = Array.from({ length: 6 }, (_, i) => ({ at: T0 + (i + 1) * MIN, kind: "agent", role: "executor", text: `step ${i} observed`, cell: "obs" }));
  const claim = run(claimText("Wire retry"), T0 + 7 * MIN);
  const folders = { [key("full")]: { updatedAt: T0 + 7 * MIN, entries: [owner, ...steps, claim] } };
  const tasks = [{
    id: "full",
    title: "Wire retry",
    status: "open",
    verification: { state: "unverified", reason: "no attributable edits and no named checks", at: T0 + 8 * MIN },
    runProgress: { pending: true },
    loopGuard: { v: 1, at: T0, kind: "attempts", count: 6, reason: "recorded checks failed", by: "keeper" },
  }];
  const delta = alignMemory({ nodeFolders: folders, tasks, now: T0 + HOUR });
  assert.equal(delta.append.length, 3);
  const state = applyMemoryDelta({ ...emptyState(T0), nodeFolders: folders }, delta);
  assert.deepEqual(state.nodeFolders[key("full")].entries.map((entry) => entry.text), [
    owner.text,
    "step 3 observed",
    "step 4 observed",
    "step 5 observed",
    claim.text,
    "loop guard — recorded checks failed",
    "not verified — no attributable edits and no named checks",
    "stopped — resumes from saved progress",
  ], "the oldest agent lines make room; the owner's decision stays");
  assert.equal(state.nodeFolders[key("full")].entries[0].superseded, false);

  // Seven owner notes leave one slot: one note fills it and keeps it.
  const pinned = Array.from({ length: 7 }, (_, i) => ({ at: T0 + i * MIN, kind: "note", role: "owner", text: `owner rule ${i}`, cell: "dec" }));
  const tight = { [key("full")]: { updatedAt: T0 + 7 * MIN, entries: [...pinned, claim] } };
  const first = alignMemory({ nodeFolders: tight, tasks, now: T0 + HOUR });
  assert.deepEqual(first.append.map((row) => row.entry.text), ["loop guard — recorded checks failed"]);
  const tightState = applyMemoryDelta({ ...emptyState(T0), nodeFolders: tight }, first);
  const kept = tightState.nodeFolders[key("full")].entries;
  assert.deepEqual([kept.length, kept.filter((entry) => entry.kind === "note").length, kept.at(-1).text], [FOLDER_LIMITS.entries, 7, "loop guard — recorded checks failed"]);
  assert.deepEqual(alignMemory({ nodeFolders: tightState.nodeFolders, tasks, now: T0 + 2 * HOUR }).append, [], "the note holds its slot; the others do not churn it out");
  const forced = applyMemoryDelta({ ...emptyState(T0), nodeFolders: tight }, delta);
  assert.deepEqual(forced.nodeFolders[key("full")].entries.map((entry) => entry.text), [...pinned.map((entry) => entry.text), "loop guard — recorded checks failed"], "a delta asking for more than fits drops the extra notes");
  const owned = { [key("full")]: { updatedAt: T0 + 7 * MIN, entries: [...pinned, { ...owner, at: T0 + 7 * MIN }] } };
  assert.deepEqual(alignMemory({ nodeFolders: owned, tasks, now: T0 + HOUR }).append, [], "a folder the owner filled takes no notes");
  const ownedState = { ...emptyState(T0), nodeFolders: owned };
  assert.equal(applyMemoryDelta(ownedState, delta).nodeFolders[key("full")].entries.filter((entry) => entry.kind === "note").length, 8);
});

test("the delta skips folders that no longer exist and never recreates them", () => {
  const state = { ...emptyState(T0), nodeFolders: { [key("kept")]: legacyClaim("Kept", T0) } };
  const delta = {
    relabel: [{ key: key("gone"), at: T0, text: claimText("Gone"), cell: "obs", confidence: 0.7 }],
    append: [{ key: key("gone"), entry: { at: T0, kind: "agent", role: "keeper", text: "marked done — not verified", cell: "obs" } }],
    settle: [{ key: key("gone"), settled: "done" }],
  };
  assert.equal(applyMemoryDelta(state, delta), state);
  assert.equal(applyMemoryDelta(state, { relabel: [], append: [], settle: [] }), state);
  assert.equal(applyMemoryDelta(null, delta), null);
});

test("one task has one folder: bare keys merge into task:task:<id>", () => {
  const bare = { updatedAt: T0 + 2 * MIN, entries: [{ at: T0 + 2 * MIN, kind: "chat", text: "chat says ship it" }, run(claimText("X"), T0, { cell: "ver" })] };
  const canonical = { updatedAt: T0 + MIN, entries: [run(claimText("X"), T0, { cell: "ver" }), { at: T0 + MIN, kind: "agent", role: "reference", text: "gathered 3 code hits" }] };
  const merged = normalizeNodeFolders({ "task:task_x": bare, "task:task:task_x": canonical });
  assert.deepEqual(Object.keys(merged), ["task:task:task_x"]);
  assert.deepEqual(merged["task:task:task_x"].entries.map((entry) => entry.at), [T0, T0 + MIN, T0 + 2 * MIN], "time order, the exact repeat once");
  assert.equal(merged["task:task:task_x"].updatedAt, T0 + 2 * MIN);
  assert.deepEqual(normalizeState({ nodeFolders: { "task:task_x": bare } }, T0).nodeFolders["task:task:task_x"].entries.length, 2, "a saved legacy key loads merged");

  assert.equal(nodeKeyOf({ kind: "task", id: "task_x" }), "task:task:task_x");
  assert.equal(nodeKeyOf({ kind: "task", id: "task:task_x" }), "task:task:task_x");
  assert.equal(nodeKeyOf({ kind: "session", id: "ses_1" }), "session:ses_1");
  let state = applyNodeContext(emptyState(T0), { key: "task:task_x", kind: "chat", text: "from the chat", at: T0 }, T0);
  state = applyNodeContext(state, { target: { kind: "task", id: "task:task_x" }, kind: "run", role: "executor", text: claimText("X"), at: T0 + MIN }, T0 + MIN);
  assert.deepEqual(Object.keys(state.nodeFolders), ["task:task:task_x"]);
  assert.equal(state.nodeFolders["task:task:task_x"].entries.length, 2);
  assert.equal(nodeFolderLines(state.nodeFolders, "task:task_x", { now: T0 + MIN }).length, 2, "a bare key reads the canonical folder");
  assert.equal(nodeFolderLines({ "task:task_x": bare }, { kind: "task", id: "task:task_x" }, { now: T0 }).length, 2, "and a canonical key reads a map saved before the merge");
  const cleared = clearNodeFolder({ ...emptyState(T0), nodeFolders: { "task:task_x": bare, "session:ses_1": bare } }, { kind: "task", id: "task:task_x" });
  assert.deepEqual(Object.keys(cleared.nodeFolders), ["session:ses_1"], "clearing the task clears its legacy spelling too");

  const tidied = tidy({ tasks: [{ id: "task_x", status: "open" }], nodeFolders: { "task:task_x": bare, "task:task:task_x": canonical }, now: T0 + HOUR });
  assert.deepEqual(Object.keys(tidied.nodeFolders), ["task:task:task_x"]);
  assert.equal(tidied.report.foldersCleaned, 0, "a merge is not a clean-up");
});

test("session echoes are evicted first, and only above the folder cap", () => {
  const folder = (at) => ({ updatedAt: at, entries: [{ at, kind: "run", role: "executor", text: `run at ${at}` }] });
  // 18 sessions (newest) and 6 tasks (oldest): exactly at the cap, nothing goes.
  const atCap = {};
  for (let i = 0; i < 18; i += 1) atCap[`session:ses_${i}`] = folder(T0 + (100 + i) * MIN);
  for (let i = 0; i < 6; i += 1) atCap[key(`task_${i}`)] = folder(T0 + i * MIN);
  assert.equal(Object.keys(normalizeNodeFolders(atCap)).length, FOLDER_LIMITS.folders);
  assert.deepEqual(Object.keys(normalizeNodeFolders(atCap)).sort(), Object.keys(atCap).sort());

  // Two more task folders push it over: the two oldest session folders go
  // (newest-first cut would have dropped the two oldest tasks instead).
  const over = { ...atCap, [key("task_6")]: folder(T0 + 6 * MIN), [key("task_7")]: folder(T0 + 7 * MIN) };
  const kept = Object.keys(normalizeNodeFolders(over));
  assert.equal(kept.length, FOLDER_LIMITS.folders);
  assert.ok(!kept.includes("session:ses_0") && !kept.includes("session:ses_1"), "the oldest session echoes are evicted");
  assert.ok(Array.from({ length: 8 }, (_, i) => key(`task_${i}`)).every((name) => kept.includes(name)), "every task folder stays");

  // The newest six session folders are never evicted ahead of other folders.
  const crowded = {};
  for (let i = 0; i < 6; i += 1) crowded[`session:ses_${i}`] = folder(T0 + i * MIN);
  for (let i = 0; i < 20; i += 1) crowded[key(`task_${i}`)] = folder(T0 + (100 + i) * MIN);
  const cut = Object.keys(normalizeNodeFolders(crowded));
  assert.equal(cut.length, FOLDER_LIMITS.folders);
  assert.ok(!cut.includes("session:ses_0") && !cut.includes("session:ses_1"), "with no spare sessions, the plain oldest-first cut applies");

  const tidied = tidy({ tasks: Array.from({ length: 8 }, (_, i) => ({ id: `task_${i}`, status: "open" })), nodeFolders: over, now: T0 + 200 * MIN });
  assert.equal(tidied.report.foldersCleaned, 2, "evictions show in the tidy report");
  assert.match(tidied.report.text, /cleaned 2 node folders/);
});

test("a settled folder reaches only its own task's primer", () => {
  const folders = {
    [key("task_done")]: { updatedAt: T0, entries: [run('autopilot "Retry banner" — done (exit 0)', T0)] },
    [key("task_open")]: { updatedAt: T0, entries: [run('autopilot "Retry path" — done (exit 0)', T0)] },
  };
  const tasks = [{ id: "task_done", status: "archived", doneAt: T0, verification: { state: "verified", reason: "ok" } }, { id: "task_open", status: "open" }];
  const delta = alignMemory({ nodeFolders: folders, tasks, now: T0 + HOUR });
  assert.deepEqual(delta.settle, [{ key: key("task_done"), settled: "archived" }]);
  const state = applyMemoryDelta({ ...emptyState(T0), nodeFolders: folders }, delta);
  assert.equal(state.nodeFolders[key("task_done")].settled, "archived");
  assert.equal(normalizeState(JSON.parse(JSON.stringify(state)), T0).nodeFolders[key("task_done")].settled, "archived", "settled survives a reload");
  const other = compileMemory({ query: "retry banner", folders: state.nodeFolders, focus: { kind: "task", id: "task:task_open" }, now: T0 + HOUR });
  assert.ok(other.cells.every((cell) => cell.folder !== key("task_done")), "finished work stays out of another job's primer");
  const own = compileMemory({ query: "retry banner", folders: state.nodeFolders, focus: { kind: "task", id: "task:task_done" }, now: T0 + HOUR });
  assert.ok(own.cells.some((cell) => cell.folder === key("task_done")), "its own job still sees it");
  const reopened = alignMemory({ nodeFolders: state.nodeFolders, tasks: [{ id: "task_done", status: "open" }, tasks[1]], now: T0 + 2 * HOUR });
  assert.deepEqual(reopened.settle, [{ key: key("task_done"), settled: null }], "a reopened card's folder is unsettled");
  assert.equal(applyMemoryDelta(state, reopened).nodeFolders[key("task_done")].settled, undefined);
  const written = applyNodeContext(state, { key: key("task_done"), kind: "chat", text: "one more thing", at: T0 + 3 * HOUR }, T0 + 3 * HOUR);
  assert.equal(written.nodeFolders[key("task_done")].settled, "archived", "a new note keeps the mark until the keeper next looks");
});

test("memoryAlign off returns an empty delta from the audit pass", () => {
  const folders = { [key("task_a")]: legacyClaim("A", T0) };
  const tasks = [{ id: "task_a", status: "done", doneAt: T0, verification: { state: "verified", reason: "ok" } }];
  const on = auditPass({ tasks, nodeFolders: folders, now: T0 + HOUR });
  assert.equal(on.report.memoryAligned, 3, "relabel, verdict and settle");
  assert.match(on.text, /aligned 3 memory notes/);
  const off = auditPass({ tasks, nodeFolders: folders, now: T0 + HOUR, prefs: { memoryAlign: false } });
  assert.deepEqual(off.memoryDelta, { relabel: [], append: [], settle: [] });
  assert.equal(off.report.memoryAligned, 0);
});

test("rewordings of one lesson fold into the newest wording with their hits summed", () => {
  const base = {
    lessons: [
      { text: "Back off AI calls after 429s; backoff beats retry storms.", hits: 35, firstAt: T0 - 5 * HOUR, lastAt: T0 - HOUR, source: "ai" },
      { text: "builders reporting failures: 2 failed runs in the last half hour", hits: 8, firstAt: T0 - 9 * HOUR, lastAt: T0 - 2 * HOUR },
      { text: "cluster-reviewer failing: the cluster-reviewer agent ended its last run in error", hits: 60, firstAt: T0 - DAY, lastAt: T0 - HOUR },
    ],
  };
  const review = {
    findings: [{ severity: "warn", title: "builders reporting failures", detail: "3 failed runs in the last half hour" }, { severity: "warn", title: "cluster-planner failing", detail: "x" }, { severity: "warn", title: "cluster-reviewer failing", detail: "y" }],
    lessons: ["builders reporting failures: 3 failed runs in the last half hour", "cluster-planner failing: the cluster-planner agent ended its last run in error", "Back off AI calls after 429s; backoff beats retry storms!"],
  };
  const merged = overseerMerge(base, review, T0, { via: "local" });
  const texts = merged.lessons.map((lesson) => `${lesson.text} ×${lesson.hits}`);
  assert.ok(texts.includes("builders reporting failures: 3 failed runs in the last half hour ×9"), `the newest wording keeps the summed hits: ${texts.join(" | ")}`);
  assert.ok(!texts.some((text) => text.startsWith("builders reporting failures: 2")), "the older count is folded away");
  assert.ok(texts.includes("cluster-planner failing: the cluster-planner agent ended its last run in error ×1"), "another role's failure is another lesson");
  assert.ok(texts.includes("cluster-reviewer failing: the cluster-reviewer agent ended its last run in error ×60"));
  assert.equal(merged.lessons.find((lesson) => lesson.text.startsWith("Back off")).hits, 36, "an exact repeat still just raises hits");
  const folded = merged.lessons.find((lesson) => lesson.text.startsWith("builders"));
  assert.equal(folded.firstAt, T0 - 9 * HOUR, "the family's first sighting is kept");
  assert.deepEqual(lessonGroups(base.lessons).map((group) => group.length), [1, 1, 1], "unrelated lessons stay apart");
});

test("a local-finding lesson retires after four quiet merges; an AI lesson never does", () => {
  let overseer = {
    lessons: [
      { text: "jobs stuck in flight: 1 journal job older than 10 min", hits: 12, firstAt: T0 - HOUR, lastAt: T0 - HOUR },
      { text: "Serialise main.cjs edits through one named worker; collisions cluster there.", hits: 3, firstAt: T0 - HOUR, lastAt: T0 - HOUR, source: "ai" },
      { text: "AI link failing: 2 consecutive failure(s)", hits: 2, firstAt: T0 - HOUR, lastAt: T0 - HOUR, source: "ai" },
    ],
  };
  const quietReview = { findings: [{ severity: "warn", title: "AI link failing", detail: "2 consecutive failure(s)" }], lessons: [] };
  for (let i = 1; i <= 3; i += 1) {
    overseer = overseerMerge(overseer, quietReview, T0 + i * MIN);
    assert.equal(overseer.lessons.find((lesson) => lesson.text.startsWith("jobs stuck")).quiet, i, `quiet merge ${i}`);
  }
  // The finding comes back once: the counter starts over.
  overseer = overseerMerge(overseer, { findings: [{ severity: "warn", title: "jobs stuck in flight", detail: "2 journal jobs older than 10 min" }], lessons: [] }, T0 + 4 * MIN);
  assert.equal(overseer.lessons.find((lesson) => lesson.text.startsWith("jobs stuck")).quiet, 0);
  for (let i = 5; i <= 8; i += 1) overseer = overseerMerge(overseer, quietReview, T0 + i * MIN);
  const texts = overseer.lessons.map((lesson) => lesson.text);
  assert.ok(!texts.some((text) => text.startsWith("jobs stuck")), "four merges without its finding retire the snapshot");
  assert.ok(texts.includes("Serialise main.cjs edits through one named worker; collisions cluster there."), "an AI lesson never retires this way");
  assert.ok(texts.includes("AI link failing: 2 consecutive failure(s)"), "a local lesson whose finding persists stays");
  assert.equal(overseer.lessons.find((lesson) => lesson.text.startsWith("AI link")).quiet, 0);
});
