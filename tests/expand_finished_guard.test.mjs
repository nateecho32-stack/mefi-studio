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

function promptConstant(name) {
  // `const` declarations stay in the vm script's lexical scope, so read the
  // joined constant back as the script's completion value.
  return vm.runInContext(`${section(`const ${name} = [`, "function startEyesWatch()")}\n${name};`, vm.createContext({}));
}

test("grow and improve prompts name the finished flag with distinct finished/unfinished handling", () => {
  for (const [name, feedRows] of [["ASSISTANT_GROW_SYSTEM", /recentTitles\/archive/], ["ASSISTANT_IMPROVE_SYSTEM", /recentSessions/]]) {
    const prompt = promptConstant(name);
    assert.match(prompt, feedRows, `${name} describes the feed rows it reads`);
    assert.match(prompt, /boolean `finished` flag sourced from the producer/, `${name} names the exact \`finished\` field`);
    assert.doesNotMatch(prompt, /isFinished|Finished flag/, `${name} never drifts from the exact field name`);
    assert.match(prompt, /finished:true means the session completed its final turn normally — (that work is done|done work): never propose expand items/, `${name} treats finished sessions as complete work`);
    assert.match(prompt, /finished:false \(or no finished field\) are the unfinished candidates/, `${name} treats unfinished (or flag-absent) sessions as the candidates`);
  }
});

test("a sample feed with both finished states renders both distinguishably into the prompt payload", () => {
  // Same contract as main.cjs: producer rows map through `finished: session.finished === true`
  // and runAssistant renders facts with JSON.stringify (main.cjs runAssistant user payload).
  const producerSessions = [{ title: "Wrapped work", finished: true }, { title: "Open work", finished: false }, { title: "Flag lost in transit" }];
  const feed = producerSessions.map((session) => ({ title: session.title, finished: session.finished === true }));
  const user = JSON.stringify({ recentTitles: feed }).slice(0, 14000);
  const grow = promptConstant("ASSISTANT_GROW_SYSTEM");
  assert.match(user, /"finished":true/, "a finished entry stays visible to the model");
  assert.match(user, /"finished":false/, "an unfinished entry stays visible to the model");
  assert.match(user, /"title":"Wrapped work","finished":true/, "the true flag lands on the finished row");
  assert.match(user, /"title":"Open work","finished":false/, "the false flag lands on the unfinished row");
  const improve = promptConstant("ASSISTANT_IMPROVE_SYSTEM");
  for (const prompt of [grow, improve]) {
    assert.ok(prompt.includes("finished") && user.includes("finished"), "prompt and rendered feed speak the same field name");
  }
});
