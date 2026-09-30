// Work stats (scripts/work-stats.cjs): what one project's ledgers say about the
// work done in it, for the greeting card on Build's Home. Every number is
// counted from a record, so these suites feed the pure module rows and read
// back exactly what it may claim: the All / 30d / 7d ranges, the twenty-two
// week heatmap window, the model names read from a run's `via`, tokens, and
// what an empty ledger says (nothing, never a guess).
//
// A day is the machine's local calendar day, so every timestamp here is built
// from local calendar fields, at midday or mid-morning, far from a midnight or
// a clock change: the suite holds in any time zone and needs no wall clock.
import test from "node:test";
import assert from "node:assert/strict";
import stats from "../scripts/work-stats.cjs";

const { RANGES, HEAT_DAYS, ledgerRows, runsOf, modelOf, tokensOf, workStats, dayKeyOf } = stats;

// Wednesday 15 July 2026, 14:30 local. Its neighbours in June and July hold no
// clock change in any zone that observes one.
const at = (day, hour = 12, minute = 0) => new Date(2026, 6, day, hour, minute).getTime();
const NOW = at(15, 14, 30);
const ago = (days, hour = 12, minute = 0) => at(15 - days, hour, minute);
const key = (days) => dayKeyOf(ago(days));

const OPUS = "claude cli · main · heavy tier (opus)";
const GLM = "opencode-go/glm-5.1 · fast tier";
const start = (runId, when, via, task = `task-${runId}`) => ({ event: "start", runId, kind: "task", task, title: `Run ${runId}`, via, pid: 4242, at: when });
const finish = (runId, when, ok = true, seconds = 90) => ({ event: "finish", runId, kind: "task", task: `task-${runId}`, ok, code: ok ? 0 : 1, seconds, at: when });
const jsonl = (...rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
const clean = (value) => JSON.parse(JSON.stringify(value));

test("the ranges are All, 30d and 7d, and the heatmap is twenty-two weeks", () => {
  assert.deepEqual(clean(RANGES), { all: null, "30d": 30, "7d": 7 });
  assert.equal(HEAT_DAYS, 22 * 7);
  assert.equal(dayKeyOf(at(5, 23, 59)), "2026-07-05", "a day is the local calendar day, zero-padded");
  assert.equal(dayKeyOf(new Date(2026, 0, 3, 0, 1).getTime()), "2026-01-03");
});

test("the executor ledger: a torn line and rows without a run or a time are skipped", () => {
  const good = start("r1", ago(1), OPUS);
  const text = [
    JSON.stringify(good),
    "{\"event\":\"start\",\"runId\":\"r2\",\"at\":12",                 // torn by a crash mid-write
    "not json at all",
    "",
    JSON.stringify({ event: "start", at: ago(1) }),                   // no run id
    JSON.stringify({ event: "start", runId: "", at: ago(1) }),         // an empty run id
    JSON.stringify({ event: "start", runId: "r3" }),                  // no time
    JSON.stringify({ event: "start", runId: "r4", at: "yesterday" }),  // a time that is not a number
    JSON.stringify(finish("r1", ago(1) + 5000)),
  ].join("\n");
  assert.deepEqual(ledgerRows(text).map((row) => [row.runId, row.event]), [["r1", "start"], ["r1", "finish"]]);
  assert.deepEqual(ledgerRows(null), []);
  assert.deepEqual(ledgerRows(undefined), []);
  assert.deepEqual(ledgerRows(""), []);
});

test("a run is its start row, or its finish row when the start was trimmed away", () => {
  const rows = ledgerRows(jsonl(
    start("kept", ago(2, 9), OPUS), finish("kept", ago(2, 9) + 120000, true, 120),
    finish("trimmed", ago(3, 10) + 60000, false, 60),        // the start row fell off the front of the ledger
    start("open", ago(0, 9), GLM),                            // still running: no finish yet
  ));
  const runs = Object.fromEntries(runsOf(rows).map((run) => [run.runId, run]));
  assert.equal(runs.kept.at, ago(2, 9), "the start row dates the run");
  assert.equal(runs.kept.via, OPUS);
  assert.equal(runs.kept.ok, true);
  assert.equal(runs.kept.seconds, 120);
  assert.equal(runs.trimmed.at, ago(3, 10) + 60000, "without its start the finish row dates the run");
  assert.equal(runs.trimmed.ok, false);
  assert.equal(runs.trimmed.via, "");
  assert.equal(runs.open.ok, null, "a run with no finish row has no verdict yet");
  assert.equal(runs.open.seconds, null);
  assert.equal(Object.keys(runs).length, 3);
});

test("model names are read from the route label; a worker row's own model wins", () => {
  assert.equal(modelOf(OPUS), "Claude Code (opus)");
  assert.equal(modelOf("codex cli · main"), "Codex");
  assert.equal(modelOf("grok default · main"), "Grok");
  assert.equal(modelOf("agy cli · free tier"), "Antigravity");
  assert.equal(modelOf("mycli cli · main"), "mycli", "an unknown CLI keeps its own word");
  assert.equal(modelOf(GLM), "glm-5.1", "a provider path is trimmed to the model");
  assert.equal(modelOf("opencode-go/glm-5.1"), "glm-5.1");
  assert.equal(modelOf("a route · with parts"), "a route", "the first part of the label names it");
  assert.equal(modelOf(""), "");
  assert.equal(modelOf(undefined), "");
  assert.equal(modelOf(OPUS, { model: "anthropic/claude-opus-4-1" }), "claude-opus-4-1", "the Studio ledger's model beats the label");
  assert.equal(modelOf("", { model: "openai/gpt-6" }), "gpt-6");
  assert.equal(modelOf(OPUS, { model: "   " }), "Claude Code (opus)", "a blank worker model falls back to the label");
});

test("tokens: the reported total wins, else the parts add up, else the row says nothing", () => {
  assert.equal(tokensOf({ tokenUsage: { totalTokens: 1234, inputTokens: 1 } }), 1234);
  assert.equal(tokensOf({ tokenUsage: { inputTokens: 200, outputTokens: 300, reasoningTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 50 } }), 1000);
  assert.equal(tokensOf({ tokenUsage: { inputTokens: 7 } }), 7);
  assert.equal(tokensOf({ tokenUsage: { totalTokens: 0 } }), 0, "a reported zero is a count, not a gap");
  assert.equal(tokensOf({ tokenUsage: {} }), null);
  assert.equal(tokensOf({ tokenUsage: { totalTokens: "12", inputTokens: "3" } }), null, "text is not a count");
  assert.equal(tokensOf({}), null);
  assert.equal(tokensOf(null), null);
});

test("All, 30d and 7d each count only the local days inside their range", () => {
  const ledger = jsonl(
    start("today", ago(0, 9), OPUS), finish("today", ago(0, 9) + 120000, true),
    start("d3", ago(3, 15), GLM), finish("d3", ago(3, 15) + 60000, false),
    start("d10", ago(10, 11), "codex cli · main"), finish("d10", ago(10, 11) + 60000, true),
    start("d40", ago(40, 10), OPUS), finish("d40", ago(40, 10) + 60000, true),
    start("d200", ago(200, 10), GLM), finish("d200", ago(200, 10) + 60000, true),
  );
  const all = workStats({ ledger, now: NOW });
  const month = workStats({ ledger, now: NOW, range: "30d" });
  const week = workStats({ ledger, now: NOW, range: "7d" });
  assert.deepEqual([all.range, month.range, week.range], ["all", "30d", "7d"]);
  assert.equal(all.since, null, "All has no lower bound");
  assert.equal(dayKeyOf(month.since), key(29), "30d opens on the local day twenty-nine days back");
  assert.equal(dayKeyOf(week.since), key(6), "7d opens on the local day six days back");
  assert.deepEqual([all.totals.runs, month.totals.runs, week.totals.runs], [5, 3, 2]);
  assert.deepEqual([all.totals.succeeded, month.totals.succeeded, week.totals.succeeded], [4, 2, 1], "succeeded counts finish rows that said ok");
  assert.deepEqual([all.totals.activeDays, month.totals.activeDays, week.totals.activeDays], [5, 3, 2]);
});

test("a range edge holds at the local day: six days back at midday is in 7d, eight is not", () => {
  const ledger = jsonl(start("edge-in", ago(6, 8), OPUS), start("edge-out", ago(8, 20), OPUS));
  const week = workStats({ ledger, now: NOW, range: "7d" });
  assert.equal(week.totals.runs, 1);
  assert.deepEqual(week.days.map((day) => day.day), [key(6)]);
});

test("an unknown range reads as All; a missing one too", () => {
  const ledger = jsonl(start("old", ago(100), OPUS));
  for (const range of ["everything", "", null, "90d", undefined]) {
    const card = workStats({ ledger, now: NOW, range });
    assert.equal(card.range, "all", `${String(range)} is All`);
    assert.equal(card.totals.runs, 1);
  }
});

test("the heatmap reaches back twenty-two weeks for any range and lights only the range", () => {
  const ledger = jsonl(
    start("d0", ago(0, 9), OPUS), start("d3", ago(3, 9), OPUS), start("d10", ago(10, 9), OPUS), start("d40", ago(40, 9), OPUS),
    start("in", ago(150, 9), OPUS),   // twenty-one weeks and a bit back: on the map
    start("out", ago(158, 9), OPUS),  // past twenty-two weeks: counted by All, off the map
  );
  const all = workStats({ ledger, now: NOW });
  assert.equal(all.totals.runs, 6);
  assert.deepEqual(all.days.map((day) => day.day), [key(150), key(40), key(10), key(3), key(0)], "the map is the last 22 weeks, oldest first");
  assert.equal(all.totals.activeDays, 6, "the tile counts every active day; the map shows the last 22 weeks");
  assert.deepEqual(all.days.map((day) => day.count), [1, 1, 1, 1, 1]);
  assert.deepEqual(all.days.map((day) => day.runs), [1, 1, 1, 1, 1]);
  assert.deepEqual(workStats({ ledger, now: NOW, range: "30d" }).days.map((day) => day.day), [key(10), key(3), key(0)]);
  assert.deepEqual(workStats({ ledger, now: NOW, range: "7d" }).days.map((day) => day.day), [key(3), key(0)]);
  for (const range of ["all", "30d", "7d"]) {
    const days = workStats({ ledger, now: NOW, range }).days.map((day) => day.day);
    assert.deepEqual(days, [...days].sort(), `${range}: day keys are dates, in order`);
  }
});

test("a day's moments add runs, tasks made and tasks finished, and tokens ride on the day", () => {
  const ledger = jsonl(start("a", ago(2, 9), OPUS), start("b", ago(2, 16), GLM));
  const tasks = [
    { id: "t1", createdAt: ago(2, 8), status: "done", doneAt: ago(2, 17), verification: { state: "verified", at: ago(2, 17) } },
    { id: "t2", createdAt: ago(2, 13), status: "open" },
  ];
  const usage = [{ at: ago(2, 10), model: "glm-5.1", tokenUsage: { totalTokens: 900 } }];
  const card = workStats({ ledger, tasks, usage, now: NOW, range: "7d" });
  assert.deepEqual(clean(card.days), [{ day: key(2), count: 5, runs: 2, tasks: 2, tokens: 900 }]);
  assert.equal(card.totals.activeDays, 1);
});

test("tokens are the sum of the rows in range, from the total or the parts; a range with none says null", () => {
  const usage = [
    { at: ago(0, 10), model: "openai/gpt-6", tokenUsage: { totalTokens: 1000 } },
    { at: ago(0, 11), model: "claude-opus", tokenUsage: { inputTokens: 200, outputTokens: 300, cacheReadTokens: 500 } },
    { at: ago(0, 12), model: "silent", tokenUsage: {} },                // no count: not a zero, not a row
    { at: ago(10, 12), model: "gpt-6", tokenUsage: { totalTokens: 50 } },
  ];
  assert.equal(workStats({ usage, now: NOW }).totals.tokens, 2050);
  assert.equal(workStats({ usage, now: NOW, range: "30d" }).totals.tokens, 2050);
  assert.equal(workStats({ usage, now: NOW, range: "7d" }).totals.tokens, 2000);
  const none = workStats({ usage: [{ at: ago(0), model: "silent", tokenUsage: {} }, { at: ago(40), tokenUsage: { totalTokens: 9 } }], now: NOW, range: "7d" });
  assert.equal(none.totals.tokens, null, "no token rows in range: unknown, not 0");
  assert.equal(workStats({ now: NOW }).totals.tokens, null);
});

test("models are named from `via`, ranked by runs then tokens then name, with wins and losses from the Studio ledger", () => {
  // Codex ran before the run that names claude-opus-4-1, so a name tie-break is
  // the only thing that puts claude-opus-4-1 ahead of it.
  const ledger = jsonl(
    start("r1", ago(1, 9), OPUS), start("r2", ago(1, 10), OPUS),
    start("r3", ago(1, 11), "codex cli · main"),
    start("r4", ago(1, 12), GLM),
    start("r5", ago(1, 13), OPUS),
  );
  const observations = [
    { role: "worker", runId: "r5", model: "anthropic/claude-opus-4-1", outcome: "win" },  // its own model names the run
    { role: "worker", runId: "r4", model: "", outcome: "loss" },                            // no model: the label stands
    { role: "worker", runId: "r3", outcome: "win" },
    { role: "assistant", runId: "r1", model: "gpt-x", outcome: "win" },                     // not a worker row: ignored
    { role: "worker", outcome: "win" },                                                      // no run id: ignored
    null,
  ];
  const usage = [
    { at: ago(1, 12), model: "opencode-go/glm-5.1", tokenUsage: { totalTokens: 700 } },
    { at: ago(1, 13), model: "gpt-6", tokenUsage: { totalTokens: 5000 } },                  // tokens with no run: still listed
  ];
  const card = workStats({ ledger, observations, usage, now: NOW });
  assert.deepEqual(clean(card.models), [
    { name: "Claude Code (opus)", runs: 2, tokens: null, wins: 0, losses: 0 },   // most runs first
    { name: "glm-5.1", runs: 1, tokens: 700, wins: 0, losses: 1 },              // one run each: more tokens first
    { name: "claude-opus-4-1", runs: 1, tokens: null, wins: 1, losses: 0 },     // then by name, alphabetically
    { name: "Codex", runs: 1, tokens: null, wins: 1, losses: 0 },
    { name: "gpt-6", runs: 0, tokens: 5000, wins: 0, losses: 0 },               // tokens without a run come last
  ]);
  const withTokens = clean(card.models).filter((model) => model.tokens !== null).map((model) => model.name);
  assert.deepEqual(withTokens, ["glm-5.1", "gpt-6"], "a model with no token rows in range has tokens null, not 0");
});

test("the model list is kept to twelve, and a name is one model however it is cased", () => {
  const rows = [];
  for (let index = 0; index < 15; index += 1) rows.push(start(`m${index}`, ago(1, 9), `opencode-go/model-${String(index).padStart(2, "0")} · fast tier`));
  rows.push(start("dup1", ago(1, 10), "opencode-go/Model-00 · fast tier"), start("dup2", ago(1, 11), "opencode-go/model-00 · fast tier"));
  const card = workStats({ ledger: jsonl(...rows), now: NOW });
  assert.equal(card.models.length, 12);
  assert.equal(card.models[0].runs, 3, "Model-00 and model-00 are one model");
  assert.equal(card.models[0].name.toLowerCase(), "model-00");
});

test("tasks: made in range, and verified only when finished, checked and not dropped", () => {
  const iso = (when) => new Date(when).toISOString();
  const tasks = [
    { id: "t1", createdAt: ago(0, 8), status: "done", doneAt: ago(0, 10), verification: { state: "verified" } },
    { id: "t2", createdAt: iso(ago(3, 9)), status: "open" },
    { id: "t3", createdAt: ago(10, 9), status: "done", verification: { state: "manual", at: ago(9, 9) } },   // no doneAt: the check's own time dates it
    { id: "t4", createdAt: ago(5, 9), status: "archived", doneAt: ago(4, 9), dropped: { at: ago(4, 9) }, verification: { state: "verified" } },
    { id: "t5", createdAt: ago(60, 9), status: "done", doneAt: ago(50, 9), verification: { state: "verified" } },
    { id: "t6", createdAt: ago(2, 9), status: "done", doneAt: ago(1, 9), verification: { state: "failed" } },
    null,
  ];
  const all = workStats({ tasks, now: NOW });
  const month = workStats({ tasks, now: NOW, range: "30d" });
  const week = workStats({ tasks, now: NOW, range: "7d" });
  assert.deepEqual([all.totals.tasks, month.totals.tasks, week.totals.tasks], [6, 5, 4], "made counts createdAt, as a number or a date string");
  assert.deepEqual([all.totals.verified, month.totals.verified, week.totals.verified], [3, 2, 1], "verified and manual count; failed, dropped and unfinished do not");
});

test("the peak hour is the local hour work most often moved, the earlier one on a tie, and null without work", () => {
  const busy = jsonl(start("a", ago(1, 9, 5), OPUS), start("b", ago(2, 9, 55), OPUS), start("c", ago(3, 14, 0), OPUS));
  const card = workStats({ ledger: busy, now: NOW });
  assert.equal(card.peakHour, 9);
  assert.equal(card.hours.length, 24);
  assert.equal(card.hours[9], 2);
  assert.equal(card.hours[14], 1);
  assert.equal(card.hours.reduce((sum, count) => sum + count, 0), 3);
  const tie = workStats({ ledger: jsonl(start("a", ago(1, 15), OPUS), start("b", ago(1, 10), OPUS)), now: NOW });
  assert.equal(tie.peakHour, 10, "the earlier hour of a tie");
  assert.equal(workStats({ now: NOW }).peakHour, null);
});

test("nothing recorded says nothing: zeros and nulls, never an invented number", () => {
  const empty = workStats({ now: NOW });
  assert.deepEqual(clean(empty), {
    range: "all", since: null,
    totals: { tasks: 0, runs: 0, succeeded: 0, verified: 0, tokens: null, activeDays: 0 },
    days: [], hours: new Array(24).fill(0), peakHour: null, models: [],
  });
  assert.deepEqual(clean(workStats({ ledger: "", observations: [], usage: [], tasks: [], now: NOW, range: "7d" })).totals, { tasks: 0, runs: 0, succeeded: 0, verified: 0, tokens: null, activeDays: 0 });
  // A ledger that has only torn lines, and inputs of the wrong type, read as empty.
  const wrong = workStats({ ledger: "{\"runId\":", observations: "nope", usage: { at: 1 }, tasks: 7, now: NOW });
  assert.equal(wrong.totals.runs, 0);
  assert.equal(wrong.totals.tokens, null);
  assert.deepEqual(wrong.days, []);
});

test("`now` is required and a clock-less call is refused, so the module never reads the clock", () => {
  assert.throws(() => workStats({}), TypeError);
  assert.throws(() => workStats(), TypeError);
  assert.throws(() => workStats({ now: "today" }), TypeError);
  assert.throws(() => workStats({ now: NaN }), TypeError);
});

test("a row up to a minute ahead of `now` counts (clock skew); further ahead does not", () => {
  const ledger = jsonl(start("skew", NOW + 30000, OPUS), start("future", NOW + 120000, OPUS));
  assert.equal(workStats({ ledger, now: NOW }).totals.runs, 1);
  assert.equal(workStats({ ledger, now: NOW, range: "7d" }).totals.runs, 1);
});

test("a run whose start was trimmed still counts once, on its finish row's day", () => {
  const ledger = jsonl(finish("lone", ago(4, 10), true, 30), finish("lone", ago(4, 10) + 1000, true, 30));
  const card = workStats({ ledger, now: NOW, range: "7d" });
  assert.equal(card.totals.runs, 1);
  assert.deepEqual(card.days.map((day) => day.day), [key(4)]);
});
