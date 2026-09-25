// The one admission path for new work (scripts/work-admission.cjs): the
// Unicode-aware title key, the "is this still work" predicate, the card
// skeleton and the represented() ladder every creation path runs.
//
// Run: node --test tests/work_admission.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import workAdmission from "../scripts/work-admission.cjs";
import * as assistant from "../scripts/assistant.mjs";

const { titleKey, workLabel, isOpenWork, represented, taskRow, admitTask, sameIdentity, hasDecisiveIdentity, splitKeyOf } = workAdmission;
const queuedPrompt = (label, kind = "session", id = "ses_1") => `Work on "${label}". Queued with Work on it — the user pointed at ${kind} (id: ${id}).`;

test("the title key keeps accented and non-Latin letters and gives ASCII the old key", () => {
  // compactKey (the key promotion, compaction and the spawn guard read) keyed
  // both of these to "a adir bot n", and an all-Chinese title to "".
  assert.notEqual(assistant.compactKey("Añadir botón"), assistant.compactKey("Añadir botín"));
  assert.equal(assistant.compactKey("修复登录"), "修复登录");
  assert.equal(titleKey("Añadir botón"), titleKey("Añadir botón"), "precomposed and combining spellings are one key");
  assert.equal(titleKey("ＦＩＸ　login"), "fix login", "full-width forms fold to their ASCII key");
  assert.equal(titleKey("Fix the auditor."), "fix the auditor");
  assert.equal(titleKey("Fix the auditor."), titleKey("fix   THE auditor!"));
  assert.equal(assistant.compactKey("Fix: don't stall"), "fix don t stall", "ASCII keys are unchanged");
  assert.equal(titleKey("!!! — ???"), "", "punctuation alone keys to nothing");
});

test("a Work on it title keys to its label, even when the title lost its closing quote", () => {
  assert.equal(titleKey('Work on "Add search button"'), "add search button");
  assert.equal(titleKey("Work on “Add search button”"), "add search button");
  assert.equal(titleKey('Work on "Add "Export" button"'), 'add export button');
  const label = "Post-commit quiet-tree gate rerun after the landing of the shared bytes";
  // Clipped at 60 characters before the label was clipped inside the quotes.
  const clipped = `Work on "${label}"`.slice(0, 60);
  assert.equal(titleKey(clipped, queuedPrompt(label)), titleKey(label), "the prompt it was queued with carries the whole label");
  assert.equal(titleKey(`Work on "${label.slice(0, 49)}…"`, queuedPrompt(label)), titleKey(label), "a label clipped with … is read from the prompt too");
  assert.equal(workLabel(clipped), label.slice(0, 51), "without a prompt the clipped label is what is left");
  assert.equal(workLabel("Fix the auditor"), "Fix the auditor");
});

test("one predicate says what is still work", () => {
  for (const status of [undefined, null, "", "open", "queued", "pending", "active", "running", "awaiting_verification", "verifying", "blocked"]) assert.equal(isOpenWork(status), true, String(status));
  for (const status of ["done", "archived", "absorbed", "dismissed", "rejected", "cancelled", "canceled", "completed", "DONE"]) assert.equal(isOpenWork(status), false, status);
});

test("a split is the card it came from plus its note, not its Follow-up title", () => {
  const first = { id: "f1", title: "Follow-up: Add the banner", prompt: "Write the store", splitFrom: "task_1", status: "open" };
  const board = { tasks: [first] };
  const second = { title: "Follow-up: Add the banner", prompt: "Write the reader", splitFrom: "task_1" };
  assert.equal(represented(board, second), null, "a different note on the same card is new work");
  assert.equal(represented(board, { ...second, prompt: "Write the store" })?.item, first, "the same note again is the card already filed");
  assert.equal(represented({ tasks: [{ ...first, status: "done" }] }, { ...second, prompt: "Write the store" }), null, "a finished follow-up does not stand in for a new answer");
  assert.equal(represented(board, { ...second, splitFrom: "task_2", prompt: "Write the store" }), null, "another card's split is other work");
  assert.equal(hasDecisiveIdentity(second), true);
  assert.equal(splitKeyOf({ splitFrom: "task_1", prompt: "Write the store" }), splitKeyOf(first));
});

test("Work on it rows are their target: other nodes are other work, the same node is the same work", () => {
  const todo = (session) => ({ title: 'Work on "Run tests"', prompt: queuedPrompt("Run tests", "todo", `${session}:t1`), source: "chat", target: { kind: "todo", id: `${session}:t1` }, origin: { kind: "work-on", by: "owner" } });
  const queued = { ...todo("ses_a"), at: 1 };
  assert.equal(represented({ requests: [queued] }, todo("ses_b")), null, "two todos named alike in different sessions are two requests");
  assert.equal(represented({ requests: [queued] }, todo("ses_a"))?.item, queued);
  assert.equal(sameIdentity(todo("ses_a"), todo("ses_b")), false);
  // A stale-session rescue carries its session as its target, so Work on it
  // on that session meets it, whatever either one is titled.
  const rescue = { title: "Resume: Map the tabs", prompt: "A-Eyes overseer: session …", source: "overseer", target: { kind: "session", id: "ses_q" }, origin: { kind: "rescue", by: "overseer" } };
  const workOn = { title: 'Work on "Map the tabs"', prompt: queuedPrompt("Map the tabs", "session", "ses_q"), source: "chat", target: { kind: "session", id: "ses_q" }, origin: { kind: "work-on", by: "owner" } };
  assert.equal(represented({ requests: [rescue] }, workOn)?.item, rescue);
  // A target is not decisive: the label still meets the plain card it names.
  const plain = { id: "gate", title: "Map the tabs", prompt: "Something else entirely", status: "open" };
  assert.equal(represented({ tasks: [plain] }, workOn)?.item, plain);
  // A chat card that merely had the node focused is not about the node.
  const focused = { id: "chat", title: "Add a banner", prompt: "Add a banner", status: "open", target: { kind: "session", id: "ses_q" }, origin: { kind: "chat", by: "owner" } };
  assert.equal(represented({ tasks: [focused] }, workOn), null);
});

test("handed-on and delegated work is decided by its identity alone", () => {
  const child = { title: "Fix stale imports", prompt: "Fix the imports", handoffId: "handoff_a", fromRun: "run_1" };
  const unrelated = { id: "old", title: "Fix stale imports", prompt: "Fix the imports", status: "done" };
  assert.equal(represented({ tasks: [unrelated] }, child, { titles: () => true }), null, "an unrelated card with the same words cannot swallow it");
  assert.equal(represented({ tasks: [{ ...child, id: "t1", status: "done" }] }, child)?.item.id, "t1", "a done child still discharges it");
  const plan = { id: "plan", status: "open", title: "Plan", members: [{ ...child, id: "member" }] };
  assert.equal(represented({ tasks: [plan] }, child)?.item, plan, "a group snapshot represents its member");
});

test("the brief rung never compares the model's reading, and the title rung counts only unfinished work unless told", () => {
  const saved = { id: "s", title: "Add search to the task board", prompt: "Add search to the task board", status: "open" };
  assert.equal(represented({ tasks: [saved] }, { title: "Search", prompt: "Please add search to the task board.", details: "The model's reading" })?.item, saved);
  const titled = { id: "t", title: "Repair tabs", prompt: "Restore tabs after restart", status: "open" };
  const incoming = { title: "Repair tabs!", prompt: "Retain unsaved buffers" };
  assert.equal(represented({ tasks: [titled] }, incoming)?.item, titled);
  assert.equal(represented({ tasks: [titled] }, incoming, { titles: false }), null);
  assert.equal(represented({ tasks: [{ ...titled, status: "done" }] }, incoming), null, "a finished card is not unfinished work");
  assert.equal(represented({ tasks: [{ ...titled, status: "done" }] }, incoming, { titles: (item) => item.status !== "archived" })?.item.id, "t");
  // No empty key ever matches: two titles of punctuation alone are not one card.
  assert.equal(represented({ tasks: [{ id: "x", title: "???", prompt: "first", status: "open" }] }, { title: "!!!", prompt: "second" }), null);
  // Another project's card is not this project's work.
  assert.equal(represented({ tasks: [{ ...titled, projectId: "b" }] }, { ...incoming, projectId: "a" }), null);
});

test("every card is built from one skeleton, with its origin and no claim", () => {
  assert.throws(() => taskRow({ title: "x" }, { id: "t" }), /now is required/);
  assert.throws(() => taskRow({ title: "x" }, { now: 1 }), /id or allocateId/);
  const row = taskRow({ title: "  Build it ", prompt: "Build it", status: "active", runId: "run_1", lease: { pid: 1 }, runningAt: 5, logs: [{ at: 0, text: "filed" }], source: "fix", at: 3 },
    { now: 10, allocateId: () => "task_new", origin: { kind: "request", by: "fix" }, log: "task created by A-Eyes", project: { id: "p", path: "/p" } });
  assert.deepEqual({ ...row }, {
    projectId: "p", projectPath: "/p", logs: [{ at: 0, text: "filed" }, { at: 10, kind: "status", text: "task created by A-Eyes" }], source: "fix", at: 3,
    id: "task_new", title: "Build it", prompt: "Build it", status: "open", color: workAdmission.TASK_COLOR, createdAt: 3, updatedAt: 10, ideas: [], refs: [],
    origin: { kind: "request", by: "fix" },
  });
  const split = taskRow({ title: "Follow-up: x", prompt: "the note", splitFrom: "task_1" }, { now: 1, id: "f" });
  assert.equal(split.splitKey, splitKeyOf({ splitFrom: "task_1", prompt: "the note" }));
  assert.equal("origin" in taskRow({ title: "y", origin: { kind: "" } }, { now: 1, id: "y" }), false, "an incomplete origin is not stamped");
});

test("admitTask creates, finds or refuses, and never saves the fields it only compares", () => {
  const board = { tasks: [{ id: "a", title: "Existing", prompt: "Existing", status: "open" }], requests: [] };
  let serial = 0;
  const options = { now: 5, allocateId: () => `task_${++serial}`, origin: { kind: "chat", by: "owner" } };
  assert.deepEqual(admitTask(board, { title: " " }, options), { refused: true, reason: "A task needs a title." });
  assert.equal(admitTask(board, { title: "Existing", prompt: "Existing" }, options).existing.item.id, "a");
  const created = admitTask(board, { title: "New work", prompt: "New work" }, { ...options, match: { resolvedTitle: "Nothing by this name" } });
  assert.equal(created.created.id, "task_1");
  assert.equal(board.tasks[0].id, "task_1", "new work goes to the front");
  assert.equal("resolvedTitle" in board.tasks[0], false);
  assert.deepEqual({ ...board.tasks[0].origin }, { kind: "chat", by: "owner" });
  const back = admitTask(board, { title: "Planned slice", prompt: "Slice" }, { ...options, place: "back" });
  assert.equal(board.tasks.at(-1).id, back.created.id, "plan work keeps its order at the back");
  assert.match(admitTask(board, { id: "a", title: "Different", prompt: "Different", planningId: "p", planningTaskId: "x" }, options).reason, /already on the board/);
  // The inbox can be left out of the comparison.
  const inbox = { tasks: [], requests: [{ title: "Queued", prompt: "Queued", at: 1 }] };
  assert.ok(admitTask(inbox, { title: "Queued", prompt: "Queued" }, options).existing);
  assert.ok(admitTask(inbox, { title: "Queued", prompt: "Queued" }, { ...options, inbox: false }).created);
});
