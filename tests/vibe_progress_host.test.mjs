// The host half of Vibe's live waits (renderer/vibe-flow.js): a named
// exploration reports reading, what it read and which model is thinking
// (scripts/planning-service.cjs); a named Build it reports the quick look, the
// lead's split with its tool turns, and the board (main.cjs vibeBuild through
// vibeProgress). Progress is advisory: an unnamed request reports nothing, and
// a listener that throws never changes the reply.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { createPlanningService } = require("../scripts/planning-service.cjs");
const requestSizing = require("../scripts/request-sizing.cjs");
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}

const project = { id: "reports", path: "/fixture" };
const references = { scanned: 42, code: [{ file: "src/report.js", line: 1 }, { file: "src/export.js", line: 3 }, { file: "src/report.js", line: 9 }], overview: [{ file: "README.md", line: 1 }] };
function service({ onProgress, complete } = {}) {
  return createPlanningService({
    project, store: { list: async () => [] }, onProgress,
    exploreContext: async () => references,
    complete: complete ?? (async (_prompt, { progress }) => {
      progress?.({ seat: "routine", provider: "zen", model: "gpt-6-luna", cli: false });
      return { ok: true, text: JSON.stringify({ summary: "An exporter exists.", suggestions: [{ target: "destination", label: "Filters", text: "Keep the active filters.", files: ["src/report.js"] }] }) };
    }),
  });
}
const draft = { title: "Improve the report export", destination: "Export filtered rows" };

test("a named exploration reports each step in order, tagged with its request and project", async () => {
  const heard = [];
  const result = await service({ onProgress: (event) => heard.push(event) }).explore({ projectId: project.id, requestId: "vibe-explore-1", draft });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(heard.map((event) => event.stage), ["reading", "read", "asking"]);
  assert.ok(heard.every((event) => event.requestId === "vibe-explore-1" && event.projectId === "reports" && event.kind === "explore" && Number.isFinite(event.at)));
  assert.equal(heard[1].scanned, 42);
  assert.deepEqual(heard[1].files, ["src/report.js", "src/export.js"], "each file once, in the order it ranked");
  assert.deepEqual({ seat: heard[2].seat, provider: heard[2].provider, model: heard[2].model }, { seat: "routine", provider: "zen", model: "gpt-6-luna" });
});

test("an unnamed or oddly named exploration reports nothing, and a throwing listener changes no reply", async () => {
  const heard = [];
  const onProgress = (event) => heard.push(event);
  assert.equal((await service({ onProgress }).explore({ projectId: project.id, draft })).ok, true);
  assert.equal((await service({ onProgress }).explore({ projectId: project.id, requestId: "no spaces allowed", draft })).ok, true);
  assert.deepEqual(heard, [], "the Plans page asks without a name and hears nothing");
  const loud = await service({ onProgress: () => { throw new Error("listener broke"); } }).explore({ projectId: project.id, requestId: "vibe-explore-2", draft });
  assert.equal(loud.ok, true);
  assert.equal(loud.suggestions[0].label, "Filters");
  const refused = [];
  await service({ onProgress: (event) => refused.push(event) }).explore({ projectId: "another", requestId: "vibe-explore-3", draft });
  assert.deepEqual(refused, [], "a request for another project never starts");
});

// main.cjs: vibeProgress + seatLabel, and vibeBuild itself, with the model seat stubbed.
function host({ reply, toolTurn = false } = {}) {
  const sent = [], seats = [];
  const context = vm.createContext({
    send: (channel, payload) => sent.push([channel, payload]),
    projects: { current: () => ({ id: "p1", name: "Sunrise" }) },
    requestSizing,
    getEyes: async () => ({ readJson: async () => [] }),
    TASKS_PATH: "tasks.json",
    SEAT_DEFAULTS: { lead: { model: "lead-default" } },
    seatChoice: (_settings, seat) => ({ provider: "zen", model: seat === "lead" ? "gpt-6-sol" : "", effort: "", fast: false }),
    readAgentSettings: async () => ({}),
    seatFetch: async (seat, _system, _user, _max, options) => {
      seats.push(seat);
      if (toolTurn) options.onTool({ name: "web_search", ok: true });
      return reply;
    },
    composerTask: async ({ intake }) => ({ ok: true, task: { id: "t1" }, ...(intake ? { steps: intake.steps.length } : {}) }),
    assistantLog: () => {}, assistantClip: (text) => String(text), logError: () => {},
  });
  vm.runInContext([section("// Vibe's long waits, step by step", "function taskView("), section("  async function vibeBuild(", "  // The committed catalog is available immediately")].join("\n"), context);
  return { context, sent, seats, progress: () => sent.filter(([channel]) => channel === "vibe:progress").map(([, payload]) => payload) };
}
const big = "Add a save system with three slots, autosave on checkpoints and a load menu on the title screen";
const breakdown = JSON.stringify({ size: "steps", summary: "Data first, then the menus.", steps: [
  { id: "s1", title: "Save data model", prompt: "Build the save data.", acceptance: ["Saves load"], dependsOn: [] },
  { id: "s2", title: "Slots menu", prompt: "Build the slots menu.", acceptance: ["Three slots show"], dependsOn: ["s1"] },
  { id: "s3", title: "Load menu", prompt: "Build the load menu.", acceptance: ["Loads a slot"], dependsOn: ["s1", "s2"] },
] });

test("a named Build it reports the quick look, the lead and its tool turns, the planned steps, then the board", async () => {
  const h = host({ reply: { ok: true, text: breakdown }, toolTurn: true });
  const result = await h.context.vibeBuild({ prompt: big, projectId: "p1", requestId: "vibe-size-1" });
  assert.equal(result.ok, true);
  assert.equal(result.steps, 3);
  const events = h.progress();
  assert.deepEqual(events.map((event) => event.stage), ["quick", "sizing", "tool", "sized", "adding"]);
  assert.ok(events.every((event) => event.requestId === "vibe-size-1" && event.projectId === "p1" && event.kind === "size"));
  assert.equal(events[0].verdict, "maybe");
  assert.deepEqual({ seat: events[1].seat, provider: events[1].provider, model: events[1].model }, { seat: "lead", provider: "zen", model: "gpt-6-sol" });
  assert.deepEqual({ name: events[2].name, ok: events[2].ok }, { name: "web_search", ok: true });
  assert.equal(events[3].size, "steps");
  assert.deepEqual(plain(events[3].steps), [{ title: "Save data model", after: [] }, { title: "Slots menu", after: [0] }, { title: "Load menu", after: [0, 1] }], "each step and the earlier steps it waits on, by position");
});

test("a small ask reports its quick look and the board without asking the lead; an unnamed one reports nothing", async () => {
  const small = host({ reply: { ok: true, text: breakdown } });
  await small.context.vibeBuild({ prompt: "Fix the jump sound", projectId: "p1", requestId: "vibe-size-2" });
  assert.deepEqual(small.progress().map((event) => event.stage), ["quick", "adding"]);
  assert.deepEqual(small.seats, [], "no model call for one change");
  const quiet = host({ reply: { ok: true, text: breakdown } });
  const result = await quiet.context.vibeBuild({ prompt: big, projectId: "p1" });
  assert.equal(result.steps, 3, "sizing works the same without a name");
  assert.deepEqual(quiet.progress(), []);
});

test("a lead that cannot be used keeps it one card and says so in its sized step", async () => {
  const h = host({ reply: { ok: false, error: "No model answered" } });
  const result = await h.context.vibeBuild({ prompt: big, projectId: "p1", requestId: "vibe-size-3" });
  assert.equal(result.ok, true);
  assert.equal(result.steps, undefined);
  const sized = h.progress().find((event) => event.stage === "sized");
  assert.equal(sized.size, "kept");
});
