// The board reader's row cache (scripts/eyes.mjs readJson/writeJson with
// { rowCache: true }): an unchanged file hands back the cached parse as
// fresh row bodies sharing the saved history, a caller's edits never leak
// into a later read, and any change to the bytes on disk is seen because the
// cache validates the file's bytes, never a timestamp. Disposable temp
// files only; no store, no live board.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readJson, writeJson } from "../scripts/eyes.mjs";

const rows = () => [
  { id: "t1", title: "One", status: "open", logs: [{ at: 1, text: "made" }], contextHistory: { version: 1, entries: [{ id: "revision_1_a", revision: 1, at: 1, kind: "updated", note: "", hash: "a", snapshot: { id: "t1", title: "One" } }] } },
  { id: "t2", title: "Two", status: "done" },
];

async function folder() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-row-cache-"));
  return { dir, file: path.join(dir, "eyes-tasks.json"), close: () => rm(dir, { recursive: true, force: true }) };
}

test("a cached read returns the written rows as fresh bodies sharing the saved history, and edits to them do not leak", async () => {
  const f = await folder();
  try {
    const saved = rows();
    await writeJson(f.file, saved, { rowCache: true });
    assert.equal(await readFile(f.file, "utf8"), JSON.stringify(saved, null, 2), "the on-disk format is unchanged");
    const first = await readJson(f.file, [], { rowCache: true });
    assert.deepEqual(first, saved);
    assert.notEqual(first[0], saved[0], "a copy, not the writer's row");
    assert.notEqual(first[0].logs, saved[0].logs, "row bodies are cloned");
    assert.equal(first[0].contextHistory, saved[0].contextHistory, "the append-only history is shared by reference");
    first[0].title = "edited by a caller";
    first[0].logs.push({ at: 2, text: "leaked?" });
    first.push({ id: "t3" });
    const second = await readJson(f.file, [], { rowCache: true });
    assert.deepEqual(second, saved, "a caller's edits never reach the cache");
    assert.equal(second[0].contextHistory, first[0].contextHistory, "the same history object rides every unchanged read");
    assert.notEqual(second[0], first[0]);
  } finally {
    await f.close();
  }
});

test("bytes changed on disk by anyone are seen; identical bytes hit the cache again", async () => {
  const f = await folder();
  try {
    const saved = rows();
    await writeJson(f.file, saved, { rowCache: true });
    const cached = await readJson(f.file, [], { rowCache: true });
    const other = [{ id: "t9", title: "Written elsewhere" }];
    await writeFile(f.file, JSON.stringify(other));
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), other, "an external rewrite is read fresh");
    await writeFile(f.file, JSON.stringify(saved, null, 2));
    const reparsed = await readJson(f.file, [], { rowCache: true });
    assert.deepEqual(reparsed, saved);
    assert.notEqual(reparsed[0].contextHistory, cached[0].contextHistory, "a re-parse after the file changed carries new objects");
    const again = await readJson(f.file, [], { rowCache: true });
    assert.equal(again[0].contextHistory, reparsed[0].contextHistory, "and the re-parse is cached in turn");
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), saved);
  } finally {
    await f.close();
  }
});

test("reads and writes without the option keep their plain behaviour and never serve or poison the cache", async () => {
  const f = await folder();
  try {
    const saved = rows();
    await writeJson(f.file, saved, { rowCache: true });
    const cached = await readJson(f.file, [], { rowCache: true });
    const plain = await readJson(f.file, []);
    assert.deepEqual(plain, saved);
    assert.notEqual(plain[0].contextHistory, cached[0].contextHistory, "a plain read is a fresh parse");
    plain[0].contextHistory.entries.length = 0;
    assert.equal((await readJson(f.file, [], { rowCache: true }))[0].contextHistory.entries.length, 1, "the cache is untouched by it");
    await writeJson(f.file, [{ id: "t4" }]);
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), [{ id: "t4" }], "a plain write drops the entry and the next read parses the new file");
  } finally {
    await f.close();
  }
});

test("a write that reuses cached row bytes is byte-identical to the plain pretty stringify, whatever changed", async () => {
  const f = await folder();
  try {
    const history = (id) => ({ version: 1, entries: [{ id: `revision_1_${id}`, revision: 1, at: 1, kind: "updated", note: "multi\nline \"quoted\" ünïcödé  ", hash: id, snapshot: { id, nested: { list: [1, [2, { deep: null }]], empty: {} } } }] });
    const board = [
      { id: "a", title: "A", contextHistory: history("a"), tags: [], logs: [{ at: 1, text: "line\nbreak" }] },
      null,
      { id: "b", contextHistory: history("b"), title: "B — em dash", value: -0, big: 1e21, nan: Number.NaN },
      { id: "c", title: "no history", when: new Date(0), skip: undefined, fn() {} },
      "a bare string",
      [1, 2, { nested: true }],
      { id: "d", contextHistory: null, title: "null history" },
    ];
    const expectFile = async (rows) => assert.equal(await readFile(f.file, "utf8"), JSON.stringify(rows, null, 2));
    await writeJson(f.file, board, { rowCache: true });
    await expectFile(board);
    // Untouched rows come back from the cache as new objects sharing history;
    // rewrite them mixed with every kind of change.
    const read = await readJson(f.file, [], { rowCache: true });
    const next = [
      read[2],                                         // moved, unchanged
      { ...read[0], title: "A, renamed" },             // body changed, same history
      null,
      { ...read[3], when: new Date(1) },               // no history, changed
      read[6],                                         // null history, unchanged
      { ...read[0], contextHistory: history("a") },    // same body, different history object
      { contextHistory: read[0].contextHistory, id: "a", title: "A" }, // history key moved first
      "a bare string",
      { id: "e", title: "brand new" },
    ];
    await writeJson(f.file, next, { rowCache: true });
    await expectFile(next);
    await writeJson(f.file, [], { rowCache: true });
    await expectFile([]);
    await writeJson(f.file, next, { rowCache: true });
    await expectFile(next);
    // After a fresh parse (bytes from disk, no layout) the next write is
    // exact too, and the one after it reuses the layout it recorded.
    await writeFile(f.file, JSON.stringify(board, null, 2));
    const parsed = await readJson(f.file, [], { rowCache: true });
    await writeJson(f.file, [...parsed, { id: "z" }], { rowCache: true });
    await expectFile([...parsed, { id: "z" }]);
    const reread = await readJson(f.file, [], { rowCache: true });
    reread[0].title = "A again";
    await writeJson(f.file, reread, { rowCache: true });
    await expectFile(reread);
    assert.equal((await readJson(f.file, [], { rowCache: true }))[0].title, "A again");
  } finally {
    await f.close();
  }
});

test("a fallback for a missing or corrupt file, and non-array documents, behave as before", async () => {
  const f = await folder();
  try {
    assert.equal(await readJson(f.file, "fallback", { rowCache: true }), "fallback");
    await writeFile(f.file, "{not json");
    assert.equal(await readJson(f.file, "fallback", { rowCache: true }), "fallback");
    assert.equal(await readJson(f.file, "fallback"), "fallback");
    await writeFile(f.file, JSON.stringify({ single: true }));
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), { single: true });
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), { single: true });
    await writeJson(f.file, { single: false }, { rowCache: true });
    assert.deepEqual(await readJson(f.file, [], { rowCache: true }), { single: false });
  } finally {
    await f.close();
  }
});
