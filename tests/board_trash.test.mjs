// scripts/board-trash.cjs: Recently deleted, the board's trash. The rules of
// what is kept (the whole record, who and when and where it sat), for how long
// and how many (30 days, 50 items, oldest first), what a restore may do (put the
// record back at its place, never over a card that exists), and the store that
// keeps it through an injected read and write. No files, no clock: the module
// is pure and every test hands it the time.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const trash = require("../scripts/board-trash.cjs");
const { KEPT_MS, MAX_ITEMS } = trash;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const task = (id, extra = {}) => ({ id, title: `Task ${id}`, prompt: `Do ${id}`, status: "open", createdAt: 5, contextHistory: { version: 1, entries: [{ id: `revision_1_${id}` }] }, ...extra });
const idea = (id, extra = {}) => ({ id, title: `Idea ${id}`, detail: `Detail of ${id}`, status: "new", ...extra });
const entry = (kind, record, extra = {}) => ({ kind, record, by: "owner", via: "tasks:delete", index: 0, afterId: null, ...extra });
const ids = (state) => state.items.map((item) => item.id);

test("the limits are the owner's: 30 days and 50 items", () => {
  assert.equal(trash.KEPT_DAYS, 30);
  assert.equal(KEPT_MS, 30 * DAY);
  assert.equal(MAX_ITEMS, 50);
  assert.deepEqual([...trash.KINDS], ["task", "idea"]);
});

test("a deleted record is kept whole, with who deleted it, when, where it sat and its title", () => {
  const record = task("task_a", { notes: "keep me", refs: [{ kind: "file", detail: "a.js" }] });
  const out = trash.keep(trash.empty(), [entry("task", record, { by: "owner", via: "tasks:delete", index: 3, afterId: "task_prev" })], NOW);
  assert.equal(out.kept.length, 1);
  const [item] = out.state.items;
  assert.equal(item.kind, "task");
  assert.equal(item.id, "task_a");
  assert.equal(item.title, "Task task_a");
  assert.equal(item.deletedAt, NOW);
  assert.equal(item.by, "owner");
  assert.equal(item.via, "tasks:delete");
  assert.equal(item.index, 3);
  assert.equal(item.afterId, "task_prev");
  assert.deepEqual(item.record, record, "every field of the record, including its saved history, comes back");
  assert.equal(item.record.contextHistory, record.contextHistory);
  assert.equal(record.notes, "keep me", "the record it was handed is not touched");
});

test("a title comes from the record: its title, else the first line of its brief, else a plain name", () => {
  assert.equal(trash.titleOf("task", { id: "a", title: "  Fix   the\n login " }), "Fix the login");
  assert.equal(trash.titleOf("task", { id: "a", prompt: "\n\nAdd export\nmore words" }), "Add export");
  assert.equal(trash.titleOf("idea", { id: "a", detail: "Show the graph\nsecond line" }), "Show the graph");
  assert.equal(trash.titleOf("task", { id: "a" }), "Untitled task");
  assert.equal(trash.titleOf("idea", null), "Untitled idea");
  const long = trash.titleOf("task", { title: "x".repeat(400) });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
});

test("newest first, and an item leaves only when it is older than 30 days", () => {
  let state = trash.empty();
  state = trash.keep(state, [entry("task", task("old"))], NOW - 29 * DAY).state;
  state = trash.keep(state, [entry("task", task("mid"))], NOW - 10 * DAY).state;
  state = trash.keep(state, [entry("idea", idea("new"), { via: "ideas:action:delete" })], NOW - 1000).state;
  assert.deepEqual(ids(state), ["new", "mid", "old"]);
  // The oldest is 29 days old now; a day later it is exactly 30 and still kept, a millisecond after it is gone.
  assert.deepEqual(ids(trash.read(state, NOW).state), ["new", "mid", "old"]);
  const edge = trash.read(state, NOW - 29 * DAY + KEPT_MS);
  assert.deepEqual(ids(edge.state), ["new", "mid", "old"], "exactly 30 days old is still kept");
  const past = trash.read(state, NOW - 29 * DAY + KEPT_MS + 1);
  assert.deepEqual(ids(past.state), ["new", "mid"]);
  assert.deepEqual(past.dropped.map((row) => [row.item.id, row.why]), [["old", "expired"]]);
  // Keeping something new persists that pruning too.
  const kept = trash.keep(state, [entry("task", task("later"))], NOW - 29 * DAY + KEPT_MS + 1);
  assert.deepEqual(ids(kept.state), ["later", "new", "mid"]);
  assert.deepEqual(kept.dropped.map((row) => [row.item.id, row.why]), [["old", "expired"]]);
});

test("at most 50 items: the oldest are dropped first and the drop is reported", () => {
  let state = trash.empty();
  for (let n = 0; n < MAX_ITEMS; n += 1) state = trash.keep(state, [entry("task", task(`t${n}`))], NOW + n).state;
  assert.equal(state.items.length, 50);
  assert.equal(state.items.at(-1).id, "t0", "the first one kept is the oldest");
  const out = trash.keep(state, [entry("idea", idea("fifty-one"))], NOW + 100);
  assert.equal(out.state.items.length, 50);
  assert.equal(out.state.items[0].id, "fifty-one");
  assert.equal(out.state.items.at(-1).id, "t1");
  assert.deepEqual(out.dropped.map((row) => [row.item.id, row.why]), [["t0", "overflow"]]);
  // A bulk delete bigger than the cap keeps 50 and says what it could not.
  const bulk = trash.keep(trash.empty(), Array.from({ length: 60 }, (_, n) => entry("idea", idea(`i${n}`), { index: n })), NOW);
  assert.equal(bulk.state.items.length, 50);
  assert.equal(bulk.kept.length, 50);
  assert.equal(bulk.dropped.length, 10);
  assert.ok(bulk.dropped.every((row) => row.why === "overflow"));
  assert.equal(bulk.state.items.filter((item) => item.kind === "idea").length, 50);
});

test("deleting the same card again keeps one item, the newest", () => {
  let state = trash.keep(trash.empty(), [entry("task", task("same", { title: "First version" }))], NOW).state;
  const again = trash.keep(state, [entry("task", task("same", { title: "Second version" }), { index: 7 })], NOW + 5);
  assert.equal(again.state.items.length, 1);
  assert.equal(again.state.items[0].record.title, "Second version");
  assert.equal(again.state.items[0].index, 7);
  assert.deepEqual(again.dropped.map((row) => row.why), ["replaced"]);
  // A task and an idea with one id are two cards.
  const both = trash.keep(again.state, [entry("idea", idea("same"))], NOW + 6).state;
  assert.equal(both.items.length, 2);
});

test("entries that are not records are ignored, and a bad file reads as an empty list", () => {
  const out = trash.keep(trash.empty(), [entry("task", { title: "no id" }), entry("note", task("x")), null, "text", entry("task", task("ok"))], NOW);
  assert.deepEqual(ids(out.state), ["ok"]);
  const doc = { version: 1, items: [{ kind: "task", record: task("good"), deletedAt: NOW, by: "owner", via: "x", index: 2, afterId: "p" }, { kind: "task", record: {}, deletedAt: NOW }, { kind: "idea", record: idea("late"), deletedAt: "soon" }, 5] };
  const read = trash.read(doc, NOW);
  assert.deepEqual(ids(read.state), ["good"]);
  assert.equal(read.skipped, 3);
  assert.equal(read.damaged, false);
  assert.equal(trash.read(null, NOW).damaged, false, "no file is not a damaged file");
  assert.equal(trash.read("", NOW).damaged, false);
  assert.equal(trash.read("{not json", NOW).damaged, true);
  assert.equal(trash.read({ version: 1, items: "no" }, NOW).damaged, true);
  assert.equal(trash.read([], NOW).damaged, true);
  assert.deepEqual(trash.read("{not json", NOW).state, trash.empty());
});

test("a file from a newer Studio is refused rather than written over", () => {
  assert.throws(() => trash.read({ version: 2, items: [] }, NOW), /newer Studio/);
  assert.throws(() => trash.read(JSON.stringify({ version: 9, items: [] }), NOW), /newer Studio/);
});

test("removed() names the rows a change took out, with their place, and ignores rows that are not cards", () => {
  const before = [task("a"), task("b"), { title: "no id" }, task("c"), task("d")];
  const after = [task("a"), task("d")];
  const gone = trash.removed("task", before, after, { by: "owner", via: "tasks:delete" });
  assert.deepEqual(gone.map((row) => [row.record.id, row.index, row.afterId]), [["b", 1, "a"], ["c", 3, "b"]]);
  assert.ok(gone.every((row) => row.kind === "task" && row.by === "owner" && row.via === "tasks:delete"));
  assert.deepEqual(trash.removed("task", before, before), []);
  assert.deepEqual(trash.removed("idea", [idea("first")], []).map((row) => [row.record.id, row.index, row.afterId]), [["first", 0, null]]);
  assert.deepEqual(trash.removed("task", null, null), []);
});

test("place() puts a record back after the row it followed, else at its index, and never over a card that is there", () => {
  const rows = [task("a"), task("b"), task("c")];
  const item = (record, extra = {}) => trash.keep(trash.empty(), [entry("task", record, extra)], NOW).state.items[0];
  const afterA = trash.place(rows, item(task("x"), { index: 9, afterId: "a" }));
  assert.equal(afterA.ok, true);
  assert.deepEqual(afterA.rows.map((row) => row.id), ["a", "x", "b", "c"], "the row it followed is still there");
  assert.equal(afterA.index, 1);
  const front = trash.place(rows, item(task("x"), { index: 0, afterId: null }));
  assert.deepEqual(front.rows.map((row) => row.id), ["x", "a", "b", "c"]);
  const byIndex = trash.place(rows, item(task("x"), { index: 2, afterId: "gone" }));
  assert.deepEqual(byIndex.rows.map((row) => row.id), ["a", "b", "x", "c"], "its predecessor left, so its old index stands");
  const clamped = trash.place(rows, item(task("x"), { index: 40, afterId: "gone" }));
  assert.deepEqual(clamped.rows.map((row) => row.id), ["a", "b", "c", "x"], "a shorter board takes it at the end");
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"], "the rows it was given are not changed");
  const empty = trash.place([], item(task("x"), { index: 5 }));
  assert.deepEqual(empty.rows.map((row) => row.id), ["x"]);
  assert.equal(afterA.rows[1].contextHistory.entries.length, 1, "the record comes back whole");

  const clash = trash.place(rows, item(task("b", { title: "The old B" })));
  assert.equal(clash.ok, false);
  assert.equal(clash.exists, true);
  assert.match(clash.error, /“The old B” is already on the board again/);
  assert.match(clash.error, /not put over it/);
  assert.match(clash.error, /stays in Recently deleted/);
  assert.equal(clash.rows, undefined, "a refusal hands back no rows to write");
  const ideaClash = trash.place([idea("i")], trash.keep(trash.empty(), [entry("idea", idea("i", { title: "Old idea" }))], NOW).state.items[0]);
  assert.match(ideaClash.error, /“Old idea” is already in your ideas again/);
  assert.equal(trash.place(rows, { kind: "task", record: {} }).ok, false);
});

test("the list shows summaries newest first, flags a card that is back, and can be narrowed to one kind", () => {
  let state = trash.empty();
  state = trash.keep(state, [entry("task", task("t1", { status: "done" }), { via: "tasks:delete" })], NOW - 2000).state;
  state = trash.keep(state, [entry("idea", idea("i1"), { via: "ideas:action:delete", by: "owner" })], NOW - 1000).state;
  const rows = trash.list(state, { now: NOW });
  assert.deepEqual(rows.map((row) => [row.kind, row.id, row.title, row.status, row.restorable]), [["idea", "i1", "Idea i1", "new", true], ["task", "t1", "Task t1", "done", true]]);
  assert.equal(rows[0].expiresAt, NOW - 1000 + KEPT_MS);
  assert.equal(rows[0].by, "owner");
  assert.equal(rows[0].via, "ideas:action:delete");
  assert.equal("record" in rows[0], false, "the list never carries the record");
  const flagged = trash.list(state, { now: NOW, exists: (kind, id) => kind === "task" && id === "t1" });
  assert.deepEqual(flagged.map((row) => [row.id, row.restorable, row.reason]), [["i1", true, undefined], ["t1", false, "already-there"]]);
  assert.deepEqual(trash.list(state, { now: NOW, kinds: ["idea"] }).map((row) => row.id), ["i1"]);
});

test("find and remove take one item by kind and id", () => {
  const state = trash.keep(trash.empty(), [entry("task", task("a")), entry("idea", idea("a"))], NOW).state;
  assert.equal(trash.find(state, "idea", "a").kind, "idea");
  assert.equal(trash.find(state, "task", "zzz"), null);
  const out = trash.remove(state, "task", "a");
  assert.equal(out.item.id, "a");
  assert.deepEqual(out.state.items.map((item) => item.kind), ["idea"]);
  assert.equal(state.items.length, 2, "the state it was given is untouched");
  assert.equal(trash.remove(state, "task", "missing").item, null);
});

function memory(initial = null) {
  const disk = { document: initial, writes: 0, failWrites: 0, failReads: 0, aside: [] };
  let clock = NOW;
  const store = trash.createTrashStore({
    read: async () => { if (disk.failReads) { disk.failReads -= 1; throw new Error("read failed"); } return disk.document === null ? null : JSON.parse(JSON.stringify(disk.document)); },
    write: async (document) => { if (disk.failWrites) { disk.failWrites -= 1; throw new Error("disk full"); } disk.writes += 1; disk.document = JSON.parse(JSON.stringify(document)); },
    now: () => clock,
    setAside: async (text) => { disk.aside.push(text); },
  });
  return { disk, store, tick: (ms) => { clock += ms; } };
}

test("the store keeps records through an injected read and write and gets them back after a fresh read", async () => {
  const m = memory();
  const out = await m.store.keep([entry("task", task("a"), { index: 2, afterId: "z" }), entry("idea", idea("b"))]);
  assert.deepEqual(out.kept.map((row) => [row.kind, row.id, row.title]), [["task", "a", "Task a"], ["idea", "b", "Idea b"]]);
  assert.equal("record" in out.kept[0], false, "what a keep reports is small");
  assert.deepEqual(out.dropped, []);
  assert.equal(m.disk.writes, 1);
  assert.equal(m.disk.document.version, 1);
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(m.disk.document.items[0].record, task("a"), "the file holds the whole record");
  // A second store over the same document (a new run of the app) reads it back.
  const again = trash.createTrashStore({ read: async () => JSON.parse(JSON.stringify(m.disk.document)), write: async () => {}, now: () => NOW + 1000 });
  const found = await again.find("task", "a");
  assert.equal(found.index, 2);
  assert.equal(found.afterId, "z");
  assert.deepEqual(found.record, task("a"));
  assert.deepEqual((await again.list()).map((row) => row.id), ["a", "b"]);
  // remove takes it out of the file, and only when there.
  assert.equal((await m.store.remove("task", "a")).id, "a");
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["b"]);
  const writes = m.disk.writes;
  assert.equal(await m.store.remove("task", "a"), null);
  assert.equal(m.disk.writes, writes, "removing what is not there writes nothing");
});

test("calls run one at a time, so two deletes at once both land", async () => {
  const m = memory();
  const slow = trash.createTrashStore({
    read: async () => { await new Promise((resolve) => setImmediate(resolve)); return m.disk.document === null ? null : JSON.parse(JSON.stringify(m.disk.document)); },
    write: async (document) => { await new Promise((resolve) => setImmediate(resolve)); m.disk.document = JSON.parse(JSON.stringify(document)); },
    now: () => NOW,
  });
  await Promise.all([slow.keep([entry("task", task("a"))]), slow.keep([entry("task", task("b"))]), slow.keep([entry("idea", idea("c"))])]);
  assert.deepEqual(m.disk.document.items.map((item) => item.id).sort(), ["a", "b", "c"]);
});

test("a write that fails rejects the call and leaves what was kept untouched", async () => {
  const m = memory();
  await m.store.keep([entry("task", task("safe"))]);
  m.disk.failWrites = 1;
  await assert.rejects(m.store.keep([entry("task", task("lost"))]), /disk full/);
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["safe"]);
  // The store carries on after a failure.
  await m.store.keep([entry("task", task("next"))]);
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["next", "safe"]);
  // A read that fails is not an empty list: the call rejects and nothing is written over what is there.
  m.disk.failReads = 1;
  const writes = m.disk.writes;
  await assert.rejects(m.store.keep([entry("task", task("blind"))]), /read failed/);
  assert.equal(m.disk.writes, writes);
});

test("a file that cannot be read is set aside before it is written over, and a newer one is never touched", async () => {
  const m = memory("{this is not json");
  await m.store.keep([entry("task", task("a"))]);
  assert.deepEqual(m.disk.aside, ["{this is not json"]);
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["a"]);
  const future = memory({ version: 7, items: [] });
  await assert.rejects(future.store.keep([entry("task", task("a"))]), /newer Studio/);
  assert.equal(future.disk.writes, 0);
  assert.deepEqual(future.disk.document, { version: 7, items: [] });
});

test("expired items leave the file the next time it is written, and are gone from the list at once", async () => {
  const m = memory();
  await m.store.keep([entry("task", task("old"))]);
  m.tick(31 * DAY);
  assert.deepEqual(await m.store.list(), [], "past 30 days it is not offered");
  assert.equal(m.disk.document.items.length, 1, "a read does not write");
  const out = await m.store.keep([entry("task", task("fresh"))]);
  assert.deepEqual(out.dropped, [{ kind: "task", id: "old", why: "expired" }]);
  assert.deepEqual(m.disk.document.items.map((item) => item.id), ["fresh"]);
});

test("a store needs its collaborators", () => {
  assert.throws(() => trash.createTrashStore({}), /read, write and now/);
  assert.throws(() => trash.createTrashStore({ read: () => null, write: () => {} }), /read, write and now/);
});
