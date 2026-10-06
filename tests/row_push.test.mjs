import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import v8 from "node:v8";

// scripts/row-push.cjs: what one board push carries. The first push, the first
// after a project switch and the first after a resync are whole; after that
// only rows whose content (their JSON without runProgress) changed, the ids
// that left, and the order when it moved. A push with nothing new is null and
// leaves the rev alone, so the page's next base still matches. preload.cjs
// mergeRows is the page's half (tests/preload_fanout.test.mjs); `apply` below
// is the contract it follows, kept small so a mismatch shows here first.

const require = createRequire(import.meta.url);
const { createRowPush, rowSignature } = require("../scripts/row-push.cjs");

const task = (id, extra = {}) => ({ id, title: `Task ${id}`, status: "open", ...extra });

// The page's side of the contract: a whole list replaces what it holds; a
// delta applies only on the rev it was built from.
function apply(held, payload) {
  if (payload.full) {
    const object = !Array.isArray(payload.rows);
    const order = object ? Object.keys(payload.rows) : payload.rows.map((row, at) => (payload.ids ? payload.ids[at] : row.id));
    const byId = new Map(order.map((id, at) => [id, object ? payload.rows[id] : payload.rows[at]]));
    return { rev: payload.rev, projectId: payload.projectId, object, order, byId };
  }
  assert.equal(payload.base, held.rev, "a delta is built on the rev the page holds");
  const byId = new Map(held.byId);
  const gone = held.object ? payload.del : payload.remove;
  const incoming = held.object ? Object.entries(payload.set) : payload.upsert.map((row, at) => [payload.ids ? payload.ids[at] : row.id, row]);
  for (const id of gone) byId.delete(id);
  const added = [];
  for (const [id, row] of incoming) {
    if (!byId.has(id)) added.push(id);
    byId.set(id, row);
  }
  const order = payload.order ?? [...held.order.filter((id) => !gone.includes(id)), ...added];
  return { rev: payload.rev, projectId: payload.projectId, object: held.object, order, byId };
}
const listOf = (held) => (held.object ? Object.fromEntries(held.order.map((id) => [id, held.byId.get(id)])) : held.order.map((id) => held.byId.get(id)));

test("the first push is whole, an unchanged list sends nothing, and a change carries only its row", () => {
  const push = createRowPush({ start: 100 });
  const rows = [task("a"), task("b"), task("c")];
  const first = push.payload(rows, { projectId: "p" });
  assert.deepEqual(first, { rev: 101, full: true, rows, projectId: "p" });
  assert.equal(first.rows, rows, "the whole list is the list handed in");

  assert.equal(push.payload(rows.map((row) => ({ ...row })), { projectId: "p" }), null, "equal content, new objects: nothing new");
  const edited = [task("a"), task("b", { status: "running" }), task("c")];
  const delta = push.payload(edited, { projectId: "p" });
  assert.deepEqual(delta, { rev: 102, base: 101, projectId: "p", upsert: [edited[1]], remove: [] });
  assert.equal(delta.upsert[0], edited[1]);
  assert.equal(push.payload(edited, { projectId: "p" }), null);
  const next = push.payload([task("a", { title: "A" }), task("b", { status: "running" }), task("c")], { projectId: "p" });
  assert.equal(next.base, 102, "the null push left the rev where the page has it");
  assert.equal(next.rev, 103);
});

test("runProgress alone is not new: checkpoints travel as eyes:progress instead", () => {
  const push = createRowPush();
  push.payload([task("a", { runProgress: { runId: "r1", at: 1, progress: 0.1 } }), task("b")], { projectId: "p" });
  assert.equal(push.payload([task("a", { runProgress: { runId: "r1", at: 2, progress: 0.4 } }), task("b")], { projectId: "p" }), null);
  assert.equal(push.payload([task("a"), task("b")], { projectId: "p" }), null, "a row that lost its runProgress alone is not new either");
  const moved = push.payload([task("a", { status: "done", runProgress: { runId: "r1", at: 3 } }), task("b")], { projectId: "p" });
  assert.equal(moved.upsert.length, 1);
  assert.deepEqual(moved.upsert[0].runProgress, { runId: "r1", at: 3 }, "a row that changed goes whole, its progress with it");
});

test("added, removed and moved rows: the order rides along only when the page cannot work it out", () => {
  const push = createRowPush();
  push.payload([task("a"), task("b"), task("c")], { projectId: "p" });
  const appended = push.payload([task("a"), task("b"), task("c"), task("d")], { projectId: "p" });
  assert.deepEqual(appended.upsert.map((row) => row.id), ["d"]);
  assert.equal("order" in appended, false, "a row added at the end needs no order");

  const removed = push.payload([task("a"), task("c"), task("d")], { projectId: "p" });
  assert.deepEqual(removed.upsert, []);
  assert.deepEqual(removed.remove, ["b"]);
  assert.equal("order" in removed, false, "the kept rows keep their order");

  const prepended = push.payload([task("e"), task("a"), task("c"), task("d")], { projectId: "p" });
  assert.deepEqual(prepended.upsert.map((row) => row.id), ["e"]);
  assert.deepEqual(prepended.order, ["e", "a", "c", "d"], "a row added at the front names the order");

  const swapped = push.payload([task("e"), task("c"), task("a"), task("d")], { projectId: "p" });
  assert.deepEqual(swapped.upsert, [], "a move alone sends no rows");
  assert.deepEqual(swapped.remove, []);
  assert.deepEqual(swapped.order, ["e", "c", "a", "d"]);
});

test("a project switch and a resync start over whole; last() keeps the newest list for the resend", () => {
  const push = createRowPush({ start: 0 });
  push.payload([task("a")], { projectId: "p" });
  const other = [task("x")];
  const switched = push.payload(other, { projectId: "q" });
  assert.equal(switched.full, true, "another project's board crosses whole");
  assert.equal(switched.projectId, "q");
  assert.equal(push.payload(other, { projectId: "q" }), null);
  assert.deepEqual(push.last(), { rows: other, projectId: "q" }, "a push with nothing new still records the newest list");

  push.resync();
  const again = push.payload(other, { projectId: "q" });
  assert.deepEqual(again, { rev: 3, full: true, rows: other, projectId: "q" });
  assert.equal(push.payload(other, { projectId: "q" }), null, "and deltas resume after it");
});

test("a list whose rows cannot all be named goes whole every time, as before", () => {
  const push = createRowPush();
  const inbox = [{ title: "No id", prompt: "x" }, task("a")];
  assert.equal(push.payload(inbox, { projectId: "p" }).full, true);
  assert.equal(push.payload(inbox, { projectId: "p" }).full, true, "no id: never a delta");
  const twice = [task("a"), task("a", { title: "again" })];
  assert.equal(push.payload(twice, { projectId: "p" }).full, true, "an id twice: never a delta");
  assert.equal(push.payload([task("a"), null], { projectId: "p" }).full, true, "a hole in the list");
  const named = [task("a"), task("b")];
  assert.equal(push.payload(named, { projectId: "p" }).full, true, "the first nameable list is whole");
  assert.equal(push.payload(named, { projectId: "p" }), null, "then deltas");
});

test("the checkpoint store travels as set and del, and its key order only when it moved", () => {
  const push = createRowPush();
  const store = { s1: [{ note: "one", at: 1 }], s2: [{ note: "two", at: 2 }] };
  const first = push.payload(store, { projectId: "p" });
  assert.equal(first.full, true);
  assert.equal(first.rows, store);

  const added = push.payload({ s1: store.s1, s2: [{ note: "two again", at: 3 }, ...store.s2], s3: [{ note: "three", at: 4 }] }, { projectId: "p" });
  assert.deepEqual(Object.keys(added.set), ["s2", "s3"]);
  assert.deepEqual(added.del, []);
  assert.equal("upsert" in added, false);
  assert.equal("order" in added, false);

  const dropped = push.payload({ s2: [{ note: "two again", at: 3 }, ...store.s2], s3: [{ note: "three", at: 4 }] }, { projectId: "p" });
  assert.deepEqual(dropped.set, {});
  assert.deepEqual(dropped.del, ["s1"]);

  const reordered = push.payload({ s3: [{ note: "three", at: 4 }], s2: [{ note: "two again", at: 3 }, ...store.s2] }, { projectId: "p" });
  assert.deepEqual(reordered.order, ["s3", "s2"]);
  assert.equal(push.payload([task("a")], { projectId: "p" }).full, true, "a list after a store is a new shape: whole");
});

test("a custom key names the rows it sends, and a custom signature decides what is new", () => {
  const byTitle = createRowPush({ key: (row) => row?.title, signature: (row) => String(row.status) });
  const first = byTitle.payload([{ title: "one", status: "open", note: 1 }, { title: "two", status: "open" }], { projectId: "p" });
  assert.deepEqual(first.ids, ["one", "two"], "a whole list names its rows when they have no id to be named by");
  assert.equal(byTitle.payload([{ title: "one", status: "open", note: 2 }, { title: "two", status: "open" }], { projectId: "p" }), null, "only the signature counts");
  const delta = byTitle.payload([{ title: "one", status: "done" }, { title: "two", status: "open" }], { projectId: "p" });
  assert.deepEqual(delta.ids, ["one"]);
  assert.deepEqual(delta.upsert, [{ title: "one", status: "done" }]);
  assert.equal("ids" in createRowPush().payload([task("a")], { projectId: "p" }), false, "the default key needs no names");
});

test("rowSignature leaves out runProgress only, and an unreadable row always goes", () => {
  assert.equal(rowSignature({ id: "a", runProgress: { at: 1 }, title: "x" }), JSON.stringify({ id: "a", title: "x" }));
  assert.equal(rowSignature({ id: "a", title: "x" }), JSON.stringify({ id: "a", title: "x" }));
  assert.equal(rowSignature(undefined), "null");
  assert.equal(rowSignature([1, 2]), "[1,2]");
  const loop = { id: "loop" };
  loop.self = loop;
  assert.notEqual(rowSignature(loop), rowSignature(loop), "a row that cannot be read never reads as unchanged");
  const push = createRowPush();
  push.payload([loop], { projectId: "p" });
  assert.equal(push.payload([loop], { projectId: "p" }).upsert[0], loop);
});

// A seeded walk through board edits (new cards front and back, removals,
// moves, edits, progress-only checkpoints, project switches and resyncs):
// the page's copy, rebuilt from every push, always equals the host's list.
test("every push rebuilds the host's list exactly, and only a change sends anything", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const push = createRowPush({ start: 1000 });
  let project = "p";
  let rows = Array.from({ length: 12 }, (_, at) => task(`t${at}`));
  let page = null;
  let serial = 12;
  let sent = 0;
  for (let step = 0; step < 600; step += 1) {
    const roll = random();
    let expectNull = false;
    if (roll < 0.15) rows = [...rows, task(`t${serial++}`)];
    else if (roll < 0.25) rows = [task(`t${serial++}`), ...rows];
    else if (roll < 0.35 && rows.length > 2) { const id = pick(rows).id; rows = rows.filter((row) => row.id !== id); }
    else if (roll < 0.45 && rows.length > 2) { const at = Math.floor(random() * rows.length); const [row] = rows.splice(at, 1); rows = [row, ...rows]; }
    else if (roll < 0.7) { const id = pick(rows).id; rows = rows.map((row) => (row.id === id ? { ...row, title: `${row.title}.` } : row)); }
    else if (roll < 0.95) { const id = pick(rows).id; rows = rows.map((row) => (row.id === id ? { ...row, runProgress: { runId: "r", at: step } } : row)); expectNull = page !== null; }
    else if (roll < 0.975) { project = project === "p" ? "q" : "p"; }
    else push.resync();
    const payload = push.payload(rows, { projectId: project });
    if (payload === null) {
      assert.ok(expectNull || JSON.stringify(listOf(page).map(rowSignature)) === JSON.stringify(rows.map(rowSignature)), `step ${step}: only a no-op may send nothing`);
      continue;
    }
    if (expectNull && !payload.full) assert.fail(`step ${step}: a progress-only change sent ${JSON.stringify(payload)}`);
    sent += 1;
    page = apply(page, structuredClone(payload));
    assert.equal(page.projectId, project);
    assert.deepEqual(listOf(page).map(rowSignature), rows.map(rowSignature), `step ${step}`);
  }
  assert.ok(sent > 200 && sent < 600, `${sent} pushes of 600 steps`);
});

// The numbers in docs/performance.md ("Board pushes send only changed rows"),
// printed as this test's diagnostics: a synthetic 134-card board of about
// 5 KB a card (0.67 MB, the size measured on the live board) and a
// 104-session checkpoint store (0.74 MB), one card or session changing.
const words = "board card worker brief verify scope files review attempt result handoff queue".split(" ");
const text = (n, at) => Array.from({ length: n }, (_, i) => words[(i * 7 + at) % words.length]).join(" ");
function syntheticBoard(count = 134) {
  return Array.from({ length: count }, (_, at) => ({
    id: `task_${String(at).padStart(4, "0")}${"f".repeat(12)}`, title: text(9, at), prompt: text(410, at), status: at % 5 ? "open" : "done",
    projectId: "project_1", projectPath: "C:/projects/one", createdAt: 1_700_000_000_000 + at, updatedAt: 1_700_000_100_000 + at,
    files: [`src/${at}.js`, `tests/${at}.test.mjs`], dependsOn: [], contextVersion: 3, buildScope: `scope-${at}`,
    logs: Array.from({ length: 6 }, (_, i) => ({ at: 1_700_000_000_000 + i, kind: "status", text: text(24, at + i) })),
    lastAttempt: { runId: `run_${at}`, at: 1_700_000_200_000, code: 0, tail: text(40, at) },
    runProgress: { version: 1, runId: `run_${at}`, at: 1_700_000_300_000, progress: 0.5, todos: [{ content: text(12, at), status: "in_progress" }], outputTail: [text(30, at), text(30, at + 1)] },
  }));
}

function syntheticStore(sessions = 104, per = 27) {
  return Object.fromEntries(Array.from({ length: sessions }, (_, s) => [`ses_${String(s).padStart(4, "0")}${"x".repeat(22)}`,
    Array.from({ length: per }, (_, i) => ({ note: text(30, s + i), at: 1_700_000_000_000 + i, source: "autopilot", files: [`src/${s}.js`], png: null }))]));
}

test("one changed card on a 134-card board crosses as a sliver of the whole list", (t) => {
  const board = syntheticBoard();
  const full = v8.serialize(board).length;
  const push = createRowPush({ start: 0 });
  push.payload(board, { projectId: "project_1" });
  const edited = board.map((row, at) => (at === 67 ? { ...row, status: "running", updatedAt: row.updatedAt + 1 } : row));
  const delta = v8.serialize(push.payload(edited, { projectId: "project_1" })).length;
  assert.ok(full > 600_000, `the synthetic board is board-sized (${full} bytes)`);
  assert.ok(delta < full / 50, `one card: ${delta} of ${full} bytes`);
  const progress = board[67].runProgress;
  const checkpoint = v8.serialize({ projectId: "project_1", byTask: { [board[67].id]: { ...progress, at: progress.at + 1 } } }).length;
  assert.ok(checkpoint < full / 200, `a checkpoint: ${checkpoint} of ${full} bytes`);
  assert.equal(push.payload(edited.map((row, at) => (at === 67 ? { ...row, runProgress: { ...progress, at: progress.at + 1 } } : row)), { projectId: "project_1" }), null);

  const store = syntheticStore();
  const storeFull = v8.serialize(store).length;
  const stores = createRowPush({ start: 0 });
  stores.payload(store, { projectId: "project_1" });
  const session = Object.keys(store)[5];
  const added = { ...store, [session]: [{ note: "autopilot: a run finished", at: 1_800_000_000_000, source: "autopilot", files: [], png: null }, ...store[session]].slice(0, 50) };
  const storeDelta = v8.serialize(stores.payload(added, { projectId: "project_1" })).length;
  assert.ok(storeDelta < storeFull / 50, `one session: ${storeDelta} of ${storeFull} bytes`);
  t.diagnostic(`eyes:tasks, 134 cards: whole ${full} B, one card changed ${delta} B; a checkpoint: eyes:progress ${checkpoint} B and no list`);
  t.diagnostic(`eyes:checkpoints, 104 sessions: whole ${storeFull} B, one session changed ${storeDelta} B`);
});
