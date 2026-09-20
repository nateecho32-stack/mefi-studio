import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");

function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}

// Same normalization contract the other admission tests pin.
const workTitleKey = (value) =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function expandHost() {
  const logs = [];
  const env = vm.createContext({ Date, workTitleKey, logLine: (line) => logs.push(line) });
  vm.runInContext(section("function requestsFromExpand(", "// Every queued request also becomes a task card"), env);
  return { env, logs };
}

test("expand proposals matching a finished session title are dropped, casing and spacing included", () => {
  const { env, logs } = expandHost();
  const briefing = {
    finishedTitles: ["Full  Suite Green Rerun", "Feed overseer verificationRun results into verifyCompletion"],
    expand: [
      { title: "full suite green rerun", prompt: "resurrect" },
      { title: "  Feed overseer verificationRun results into verifyCompletion ", prompt: "again" },
      { title: "Fresh unfinished follow-up", prompt: "do this" },
    ],
  };
  const requests = env.requestsFromExpand(briefing, [], "grow");
  assert.deepEqual([...requests.map((row) => row.title)], ["Fresh unfinished follow-up"]);
  assert.equal(requests[0].source, "grow");
  assert.equal(logs.length, 1, "drops are observable, not silent");
  assert.match(logs[0], /grow: dropped 2 expand proposal\(s\) matching finished session title\(s\)/);
});

test("a briefing without finished titles (overseer upgrades) flows through unchanged", () => {
  const { env, logs } = expandHost();
  const requests = env.requestsFromExpand(
    { expand: [{ title: "Overseer: tighten the loop", prompt: "x" }] },
    [{ title: "Queued elsewhere" }],
    "overseer",
  );
  assert.deepEqual([...requests.map((row) => row.title)], ["Overseer: tighten the loop"]);
  assert.equal(logs.length, 0);
});

test("blank finished titles never match; whitespace proposals are not treated as finished matches", () => {
  const { env, logs } = expandHost();
  const requests = env.requestsFromExpand(
    { finishedTitles: ["", "   ", null], expand: [{ title: "   " }, { title: "Real work", prompt: "y" }, null] },
    [],
    "improver",
  );
  assert.deepEqual([...requests.map((row) => row.title)], ["   ", "Real work"]);
  assert.equal(logs.length, 0, "blank keys never count as a finished match");
});

test("runAssistant attaches trusted finished titles from facts, not model output", () => {
  const wiring = section("async function runAssistant(", "// ---- the assistant service");
  assert.match(wiring, /briefing\.finishedTitles = /);
  assert.match(wiring, /facts\.recentTitles/);
  assert.match(wiring, /facts\.archive/);
  assert.match(wiring, /facts\.recentSessions/);
  assert.match(wiring, /row\?\.finished === true/, "only rows the finished flag marks count, never model text");
});
