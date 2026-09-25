import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import workEvents from "../scripts/work-events.cjs";

const { KINDS, normalizeEvent, createStore, dayBounds, summarize, ledgerCounts, compareWithLedger, parseLines } = workEvents;

// Local wall-clock times, so day filters hold in any timezone.
const local = (day, hours, minutes = 0, seconds = 0) => new Date(2026, 8, day, hours, minutes, seconds).getTime();

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "work-events-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const lines = async (file) => (await readFile(file, "utf8")).split("\n").filter(Boolean);

test("exports exactly the M1 API, with a frozen kind list", () => {
  assert.deepEqual(Object.keys(workEvents).sort(), ["KINDS", "compareWithLedger", "createStore", "dayBounds", "ledgerCounts", "normalizeEvent", "parseLines", "summarize"]);
  assert.deepEqual(KINDS, ["step.start", "step.finish", "step.grow", "step.fold", "agent.out", "agent.home", "report", "help.ask", "help.answer", "file.read", "file.edit", "stage", "mail", "pipeline"]);
  assert.ok(Object.isFrozen(KINDS));
  assert.throws(() => KINDS.push("other"));
});

test("normalizeEvent keeps valid fields, drops unknown ones, and stamps v and at", () => {
  const event = normalizeEvent({
    kind: "agent.out", at: 1234, taskId: "task_1", runId: "run_1", step: "build", role: "builder", agent: "opencode",
    from: "lead", to: "builder", model: "deepseek-v4.1-flash", effort: "medium", stage: "active", prev: "open",
    title: "Fix save", text: "went out", parents: ["task_0"], files: ["a.js"], count: 3, ok: true, project: "studio",
    secret: "dropped", v: 7, nested: { a: 1 },
  }, { now: 99 });
  assert.deepEqual(event, {
    v: 1, at: 1234, kind: "agent.out", taskId: "task_1", runId: "run_1", step: "build", role: "builder", agent: "opencode",
    from: "lead", to: "builder", model: "deepseek-v4.1-flash", effort: "medium", stage: "active", prev: "open",
    title: "Fix save", text: "went out", parents: ["task_0"], files: ["a.js"], count: 3, ok: true, project: "studio",
  });
  assert.deepEqual(normalizeEvent({ kind: "report" }, { now: 500 }), { v: 1, at: 500, kind: "report" });
});

test("normalizeEvent uses now for a missing or bad at, and never mutates its input", () => {
  for (const at of [undefined, 0, -5, NaN, Infinity, "1234", null]) {
    assert.equal(normalizeEvent({ kind: "stage", at }, { now: 42 }).at, 42, `at ${String(at)}`);
  }
  const before = Date.now();
  const stamped = normalizeEvent({ kind: "stage" });
  assert.ok(stamped.at >= before && stamped.at <= Date.now());
  const raw = { kind: "mail", text: "  hi  " };
  const event = normalizeEvent(raw, { now: 1 });
  assert.notEqual(event, raw);
  assert.deepEqual(raw, { kind: "mail", text: "  hi  " });
});

test("normalizeEvent rejects unknown kinds and non-objects", () => {
  for (const raw of [null, undefined, "agent.out", 5, [], {}, { kind: "agent.gone" }, { kind: "Agent.Out" }, { kind: ["agent.out"] }]) {
    assert.equal(normalizeEvent(raw, { now: 1 }), null, JSON.stringify(raw));
  }
  for (const kind of KINDS) assert.equal(normalizeEvent({ kind }, { now: 1 }).kind, kind);
});

test("normalizeEvent clips every field to its cap", () => {
  const event = normalizeEvent({
    kind: "report", taskId: "t".repeat(200), runId: "r".repeat(81), title: "x".repeat(400), text: "y".repeat(400), project: "p".repeat(90),
    parents: ["a", "b", "c", "d", "e", "f"].map((id) => id.repeat(100)),
    files: Array.from({ length: 60 }, (_, index) => `${index}/${"f".repeat(300)}`),
  }, { now: 1 });
  assert.equal(event.taskId.length, 80);
  assert.equal(event.runId.length, 80);
  assert.equal(event.title.length, 160);
  assert.equal(event.text.length, 200);
  assert.equal(event.project.length, 80);
  assert.deepEqual(event.parents, ["a", "b", "c", "d"].map((id) => id.repeat(80)));
  assert.equal(event.files.length, 40);
  assert.ok(event.files.every((file) => file.length === 260));
  assert.equal(event.files[0], `0/${"f".repeat(258)}`);
});

test("normalizeEvent keeps typed fields only when their type is right", () => {
  const event = normalizeEvent({ kind: "file.edit", count: "3", ok: "true", taskId: 12, parents: "task_0", files: "a.js", title: {}, text: 5 }, { now: 1 });
  assert.deepEqual(event, { v: 1, at: 1, kind: "file.edit" });
  assert.equal(normalizeEvent({ kind: "file.edit", count: Infinity }, { now: 1 }).count, undefined);
  assert.equal(normalizeEvent({ kind: "file.edit", count: 0 }, { now: 1 }).count, 0);
  assert.equal(normalizeEvent({ kind: "file.edit", ok: false }, { now: 1 }).ok, false);
  assert.equal(normalizeEvent({ kind: "file.edit", count: -2.5 }, { now: 1 }).count, -2.5);
});

test("normalizeEvent dedupes files, drops empty entries, and keeps parents in order", () => {
  const event = normalizeEvent({
    kind: "file.read",
    files: ["a.js", "", "   ", "a.js", null, 4, "b.js", " a.js "],
    parents: ["", "task_2", 7, "task_1"],
  }, { now: 1 });
  assert.deepEqual(event.files, ["a.js", "b.js"]);
  assert.deepEqual(event.parents, ["task_2", "task_1"]);
  assert.equal("files" in normalizeEvent({ kind: "file.read", files: ["", null] }, { now: 1 }), false);
  assert.equal("parents" in normalizeEvent({ kind: "file.read", parents: [] }, { now: 1 }), false);
});

test("normalizeEvent strips control characters and colour codes, and collapses text whitespace", () => {
  const event = normalizeEvent({
    kind: "report",
    taskId: "task\u0000_\u00071",
    agent: "\u001b[32mopencode\u001b[0m",
    title: "Fix\tthe\r\n  save\u007f button",
    text: "  line one\n\n\tline\u0001 two  ",
    files: ["src/\u0000a.js", "src/a.js"],
    step: "\u0000\u0001\u0002",
  }, { now: 1 });
  assert.equal(event.taskId, "task_1");
  assert.equal(event.agent, "opencode");
  assert.equal(event.title, "Fix the save button");
  assert.equal(event.text, "line one line two");
  assert.deepEqual(event.files, ["src/a.js"]);
  assert.equal("step" in event, false, "a field that is only control characters is dropped");
  assert.doesNotMatch(JSON.stringify(event), /\\u00[01]/);
});

test("normalizeEvent never clips half a surrogate pair", () => {
  const event = normalizeEvent({ kind: "mail", text: `${"a".repeat(199)}\u{1F600}` }, { now: 1 });
  assert.equal(event.text, "a".repeat(199));
});

test("append and read round-trip through a new directory", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "nested", "deeper", "work-events.jsonl");
  const store = createStore({ file });
  assert.equal(store.file, path.resolve(file));
  const stored = await store.append({ kind: "agent.out", at: local(23, 10), taskId: "task_a", runId: "run_1", junk: 1 });
  assert.deepEqual(stored, { v: 1, at: local(23, 10), kind: "agent.out", taskId: "task_a", runId: "run_1" });
  assert.equal(await store.append({ kind: "nope" }), null);
  assert.equal(await store.append(null), null);
  await store.append({ kind: "agent.home", at: local(23, 11), taskId: "task_a", runId: "run_1", ok: true });
  const events = await store.read();
  assert.deepEqual(events.map((event) => event.kind), ["agent.out", "agent.home"]);
  assert.deepEqual(events[0], stored);
  assert.equal((await lines(file)).length, 2, "rejected events write nothing");
  assert.deepEqual(JSON.parse((await lines(file))[1]), { v: 1, at: local(23, 11), kind: "agent.home", taskId: "task_a", runId: "run_1", ok: true });
});

test("read of a missing file is empty", async (t) => {
  const dir = await tempDir(t);
  const store = createStore({ file: path.join(dir, "none", "work-events.jsonl") });
  assert.deepEqual(await store.read(), []);
  assert.deepEqual(await store.read({ day: "2026-09-23" }), []);
});

test("concurrent appends keep every line, in call order", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "work-events.jsonl");
  const store = createStore({ file });
  const other = createStore({ file }); // a second store on the same file shares the chain
  const pending = [];
  for (let index = 0; index < 60; index += 1) {
    pending.push((index % 2 ? other : store).append({ kind: "step.start", at: 1000 + index, text: `step ${index}` }));
  }
  const stored = await Promise.all(pending);
  assert.ok(stored.every(Boolean));
  const written = (await lines(file)).map((line) => JSON.parse(line).text);
  assert.deepEqual(written, Array.from({ length: 60 }, (_, index) => `step ${index}`));
});

test("read waits for appends already queued", async (t) => {
  const dir = await tempDir(t);
  const store = createStore({ file: path.join(dir, "work-events.jsonl") });
  for (let index = 0; index < 5; index += 1) store.append({ kind: "report", at: 10 + index });
  assert.equal((await store.read()).length, 5);
});

test("append never throws and resolves null when the file cannot be written", async (t) => {
  const dir = await tempDir(t);
  const blocker = path.join(dir, "blocker");
  await writeFile(blocker, "a file, not a directory", "utf8");
  const store = createStore({ file: path.join(blocker, "work-events.jsonl") });
  assert.equal(await store.append({ kind: "report", at: 1 }), null);
  // The chain is not poisoned by the failure.
  const good = createStore({ file: path.join(dir, "ok.jsonl") });
  assert.ok(await good.append({ kind: "report", at: 2 }));
  const circular = { kind: "report" };
  circular.self = circular;
  assert.ok(await good.append(circular), "an unknown circular field is dropped, not serialized");
  assert.equal(await store.append({ kind: "report", at: 3 }), null);
  assert.throws(() => createStore({}), TypeError);
});

test("the first append in a process trims an oversize file to its last lines", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "work-events.jsonl");
  const old = Array.from({ length: 10 }, (_, index) => JSON.stringify({ v: 1, at: 100 + index, kind: "report", text: `old ${index}` }));
  await writeFile(file, `${old.join("\n")}\n`, "utf8");
  const store = createStore({ file, maxBytes: 200, keepLines: 3 });
  await store.append({ kind: "report", at: 500, text: "new" });
  assert.deepEqual((await lines(file)).map((line) => JSON.parse(line).text), ["old 8", "old 9", "new"]);
  // Checked once per process: later appends only append.
  await store.append({ kind: "report", at: 501, text: "newer" });
  assert.equal((await lines(file)).length, 4);
  assert.deepEqual((await readFile(file, "utf8")).endsWith("\n"), true);
});

test("a file under the cap is left alone", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "work-events.jsonl");
  const old = Array.from({ length: 10 }, (_, index) => JSON.stringify({ v: 1, at: 100 + index, kind: "report" }));
  await writeFile(file, `${old.join("\n")}\n`, "utf8");
  const store = createStore({ file, maxBytes: 1024 * 1024, keepLines: 3 });
  await store.append({ kind: "report", at: 500 });
  assert.equal((await lines(file)).length, 11);
});

test("read filters by day, range, task and kinds, and limit keeps the last matches", async (t) => {
  const dir = await tempDir(t);
  const store = createStore({ file: path.join(dir, "work-events.jsonl") });
  const rows = [
    { kind: "agent.out", at: local(22, 23, 59, 59), taskId: "task_a" },
    { kind: "agent.out", at: local(23, 0, 0, 0), taskId: "task_a" },
    { kind: "step.start", at: local(23, 9), taskId: "task_b" },
    { kind: "file.read", at: local(23, 10), taskId: "task_a" },
    { kind: "agent.home", at: local(23, 11), taskId: "task_a" },
    { kind: "step.finish", at: local(23, 23, 59, 59), taskId: "task_b" },
    { kind: "agent.home", at: local(24, 0, 0, 0), taskId: "task_a" },
  ];
  for (const row of rows) await store.append(row);
  const at = (events) => events.map((event) => event.at);
  assert.deepEqual(at(await store.read({ day: "2026-09-23" })), rows.slice(1, 6).map((row) => row.at));
  assert.deepEqual(at(await store.read({ since: local(23, 9), until: local(23, 11) })), [local(23, 9), local(23, 10)], "since is inclusive, until is exclusive");
  assert.deepEqual(at(await store.read({ day: "2026-09-23", since: 0, until: 1 })), rows.slice(1, 6).map((row) => row.at), "day overrides since and until");
  assert.deepEqual((await store.read({ taskId: "task_b" })).map((event) => event.kind), ["step.start", "step.finish"]);
  assert.deepEqual(at(await store.read({ kinds: ["agent.out", "agent.home"], day: "2026-09-23" })), [local(23, 0), local(23, 11)]);
  assert.deepEqual((await store.read({ kinds: "file.read" })).length, 1, "a single kind may be a string");
  assert.deepEqual(at(await store.read({ limit: 2 })), [local(23, 23, 59, 59), local(24, 0)], "limit keeps the last matches");
  assert.deepEqual(at(await store.read({ taskId: "task_a", limit: 1 })), [local(24, 0)]);
  assert.equal((await store.read({ limit: Infinity })).length, 7);
  assert.equal((await store.read({ limit: 0 })).length, 7, "a bad limit falls back to the default");
  assert.deepEqual(await store.read({ day: "2026-13-01" }), [], "a malformed day matches nothing");
  assert.deepEqual(await store.read({ kinds: [] }), []);
});

test("read skips malformed, unknown and untimed lines", async (t) => {
  const dir = await tempDir(t);
  const file = path.join(dir, "work-events.jsonl");
  await writeFile(file, [
    "\uFEFF" + JSON.stringify({ v: 1, at: 10, kind: "report", text: "first" }),
    "not json",
    JSON.stringify({ v: 1, at: 11, kind: "gone" }),
    JSON.stringify({ v: 1, kind: "report", text: "no time" }),
    JSON.stringify([1, 2]),
    "null",
    "",
    JSON.stringify({ v: 1, at: 12, kind: "mail", text: "x".repeat(500), extra: true }) + "\r",
    '{"v":1,"at":13,"kind":"report"', // torn final append
  ].join("\n"), "utf8");
  const events = await createStore({ file }).read();
  assert.deepEqual(events.map((event) => event.at), [10, 12]);
  assert.equal(events[1].text.length, 200, "stored rows are re-normalized on read");
  assert.equal("extra" in events[1], false);
});

test("parseLines reads JSONL text the same way", () => {
  const text = [
    JSON.stringify({ v: 1, at: 5, kind: "agent.out", taskId: "t" }),
    "{bad",
    JSON.stringify({ v: 1, at: 6, kind: "later.kind" }),
    JSON.stringify({ v: 1, at: 7, kind: "agent.home", taskId: "t" }),
  ].join("\r\n");
  assert.deepEqual(parseLines(text), [{ v: 1, at: 5, kind: "agent.out", taskId: "t" }, { v: 1, at: 7, kind: "agent.home", taskId: "t" }]);
  assert.deepEqual(parseLines(""), []);
  assert.deepEqual(parseLines(null), []);
});

test("dayBounds spans local midnight to the next local midnight", () => {
  assert.deepEqual(dayBounds("2026-09-23"), { since: new Date(2026, 8, 23).getTime(), until: new Date(2026, 8, 24).getTime() });
  assert.deepEqual(dayBounds("2026-12-31"), { since: new Date(2026, 11, 31).getTime(), until: new Date(2027, 0, 1).getTime() });
  assert.deepEqual(dayBounds("2028-02-29"), { since: new Date(2028, 1, 29).getTime(), until: new Date(2028, 2, 1).getTime() });
  for (const day of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-9-23", "20260923", "2026-09-23T00:00", "", null, 20260923]) {
    assert.equal(dayBounds(day), null, String(day));
  }
});

test("summarize counts kinds, tasks and agents", () => {
  const events = [
    { v: 1, at: 30, kind: "agent.home", taskId: "b" },
    { v: 1, at: 10, kind: "agent.out", taskId: "a" },
    { v: 1, at: 20, kind: "agent.out", taskId: "b" },
    { v: 1, at: 25, kind: "file.edit", taskId: "a" },
    { v: 1, at: 26, kind: "mail" },
    { v: 1, at: 27, kind: "unknown" },
    null,
  ];
  const summary = summarize(events);
  assert.deepEqual(summary, { total: 5, byKind: { "agent.out": 2, "agent.home": 1, "file.edit": 1, mail: 1 }, tasks: 2, agentsOut: 2, agentsHome: 1, firstAt: 10, lastAt: 30 });
  assert.deepEqual(Object.keys(summary.byKind), ["agent.out", "agent.home", "file.edit", "mail"], "byKind follows KINDS order");
  assert.deepEqual(summarize([]), { total: 0, byKind: {}, tasks: 0, agentsOut: 0, agentsHome: 0, firstAt: null, lastAt: null });
  assert.deepEqual(summarize(undefined).total, 0);
});

const ledger = [
  { at: 100, event: "start", runId: "run_1", task: "a" },
  { at: 150, event: "fallback", runId: "run_1", task: "a" },
  { at: 200, event: "finish", runId: "run_1", task: "a", ok: true },
  { at: 300, event: "start", runId: "run_2", task: "b" },
  { at: 350, event: "release", runId: "run_3", task: "c" },
  { at: 400, event: "finish", runId: "run_2", task: "b", ok: false },
  { at: "bad", event: "start", runId: "run_4" },
  null,
];

test("ledgerCounts counts start and finish rows in [since, until)", () => {
  assert.deepEqual(ledgerCounts(ledger), { starts: 2, finishes: 2 });
  assert.deepEqual(ledgerCounts(ledger, { since: 100, until: 300 }), { starts: 1, finishes: 1 });
  assert.deepEqual(ledgerCounts(ledger, { since: 101, until: 400 }), { starts: 1, finishes: 1 });
  assert.deepEqual(ledgerCounts([]), { starts: 0, finishes: 0 });
  const text = `${ledger.filter(Boolean).map((row) => JSON.stringify(row)).join("\n")}\n{torn`;
  assert.deepEqual(ledgerCounts(text), { starts: 2, finishes: 2 }, "the ledger's JSONL text is read too");
});

test("compareWithLedger is ok when agents out and home match starts and finishes", () => {
  const events = [
    { v: 1, at: 101, kind: "agent.out", runId: "run_1" },
    { v: 1, at: 120, kind: "file.read", runId: "run_1" },
    { v: 1, at: 201, kind: "agent.home", runId: "run_1" },
    { v: 1, at: 301, kind: "agent.out", runId: "run_2" },
    { v: 1, at: 401, kind: "agent.home", runId: "run_2" },
  ];
  assert.deepEqual(compareWithLedger(events, ledger), { ok: true, events: { out: 2, home: 2 }, ledger: { starts: 2, finishes: 2 }, diff: { out: 0, home: 0 } });
  assert.deepEqual(compareWithLedger(events, ledger, { since: 100, until: 250 }), { ok: true, events: { out: 1, home: 1 }, ledger: { starts: 1, finishes: 1 }, diff: { out: 0, home: 0 } });
  assert.equal(compareWithLedger([], []).ok, true);
});

test("compareWithLedger reports a mismatch with signed diffs", () => {
  const events = [
    { v: 1, at: 101, kind: "agent.out" },
    { v: 1, at: 102, kind: "agent.out" },
    { v: 1, at: 103, kind: "agent.out" },
    { v: 1, at: 201, kind: "agent.home" },
  ];
  assert.deepEqual(compareWithLedger(events, ledger), { ok: false, events: { out: 3, home: 1 }, ledger: { starts: 2, finishes: 2 }, diff: { out: 1, home: -1 } });
  const onlyHome = compareWithLedger([{ v: 1, at: 201, kind: "agent.home" }], ledger, { since: 150, until: 250 });
  assert.equal(onlyHome.ok, true, "a finish whose start fell before the window still pairs by count");
});
