// The Agent Brain's host side (scripts/agent-brain-host.cjs) driven through a
// task's whole life with the real pure modules, a fake clock, a temp data
// folder and fake seats: what the main process's one-line hooks produce.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import host from "../scripts/agent-brain-host.cjs";

function harness({ seat = null, project = "p1" } = {}) {
  const dirs = new Map();
  const sent = [];
  const raised = [];
  const woke = [];
  const clock = { t: 1_000_000 };
  let current = project;
  const ready = mkdtemp(path.join(os.tmpdir(), "brain-host-"));
  const brain = host.createAgentBrain({
    dataFile: (name) => path.join(dirs.get(current), name),
    projectId: () => current,
    now: () => clock.t,
    send: (channel, payload) => sent.push({ channel, payload }),
    seatFetch: seat,
    raiseIssue: async (raw) => { raised.push(raw); return null; },
    askForWork: (reason) => woke.push(reason),
    projectRoot: () => "C:/proj",
    random: () => 0.99,
  });
  return {
    brain, sent, raised, woke, clock,
    async setup() { const root = await ready; dirs.set(project, root); return root; },
    async use(id) { if (!dirs.has(id)) dirs.set(id, await mkdtemp(path.join(os.tmpdir(), `brain-host-${id}-`))); current = id; },
    dir: (id = current) => dirs.get(id),
    events: (kind) => sent.filter((row) => row.channel === "brain:event" && (!kind || row.payload.kind === kind)).map((row) => row.payload),
    async cleanup() { for (const dir of dirs.values()) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); },
  };
}

const task = (extra = {}) => ({ id: "t1", title: "Add the filter bar", prompt: "Build a filter bar for the task list", status: "open", ...extra });

test("companion movement preferences persist and learning stays with its project", async () => {
  const h = harness(); await h.setup();
  try {
    assert.ok((await h.brain.companionPrefs({ roaming: false, pinned: true, bubbles: false, growth: false, anchor: { x: .7, y: .4 } })).ok);
    for (let n = 0; n < 12; n++) await h.brain.recordDecision({ kind: "scope", verb: "narrow" });
    const state = await h.brain.companionState();
    assert.equal(state.roaming, false); assert.equal(state.pinned, true); assert.equal(state.bubbles, false); assert.equal(state.growth, false);
    assert.deepEqual(state.anchor, { x: .7, y: .4 }); assert.ok(state.preferences.length);
    const stored = JSON.parse(await readFile(path.join(h.dir(), "companion.json"), "utf8"));
    assert.equal(stored.pinned, true); assert.equal(stored.decisions[0].projectId, "p1");
    assert.equal((await h.brain.companionPrefs({ look: "fox", anchor: { x: 9, y: 1 } })).ok, false);
    assert.equal((await h.brain.companionState()).look, "wisp", "invalid changes do not partially apply");
    await h.use("p2");
    assert.deepEqual((await h.brain.companionState()).preferences, []);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("a run lays out a pipeline and tells the worker the protocol", async () => {
  const h = harness();
  await h.setup();
  try {
    const hints = await h.brain.prepareRun({ task: task(), shape: { intent: "implement", complexity: "compound" } });
    assert.match(hints.protocol, /MEFI_STEP: add ::/);
    assert.match(hints.protocol, /MEFI_HELP:/);
    assert.doesNotMatch(hints.protocol, /MEFI_REPORT/, "only a sub-agent reports to a parent");
    assert.match(hints.brief, /^ Pipeline: /, "the brief starts with a space so it never runs into the section before it");
    const child = await h.brain.prepareRun({ task: task({ id: "c1", parentTaskId: "t1" }), shape: null });
    assert.match(child.protocol, /MEFI_REPORT: found:/);
    const state = await h.brain.state();
    assert.ok(state.pipelines.t1.steps.length >= 4);
    assert.equal(state.pipelines.t1.summary.total, state.pipelines.t1.steps.length);
    assert.equal(h.events("pipeline").length, 2);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("start, lines, todos and finish move the pipeline and report up the tree", async () => {
  const h = harness();
  await h.setup();
  try {
    const parent = task({ id: "parent", title: "Task list", delegation: { childTaskIds: ["kid"] } });
    const kid = task({ id: "kid", title: "Filter state", parentTaskId: "parent" });
    await h.brain.observeTasks([parent, kid]);
    await h.brain.prepareRun({ task: parent, shape: null });
    await h.brain.prepareRun({ task: kid, shape: null });
    h.brain.runStarted({ task: kid, runId: "run_1", model: "deepseek" });
    const out = h.events("agent.out");
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].parents, ["parent"]);
    assert.ok(h.events("step.start").length >= 1);
    h.brain.workerLine({ taskId: "kid", runId: "run_1", line: "reading the brief", first: true });
    h.brain.workerLine({ taskId: "kid", runId: "run_1", line: "MEFI_STEP: add :: wire the store" });
    h.brain.todos({ taskId: "kid", runId: "run_1", todos: [{ content: "write tests", status: "in_progress" }] });
    h.brain.todos({ taskId: "kid", runId: "run_1", todos: [{ content: "write tests", status: "in_progress" }] });
    h.brain.workerLine({ taskId: "kid", runId: "run_1", line: "\u001b[32mMEFI_REPORT: found: the store needs a reset; changed: store.js\u001b[0m" });
    const grown = (await h.brain.state()).pipelines.kid.steps.filter((step) => step.grown).map((step) => step.title);
    assert.ok(grown.includes("wire the store"));
    assert.ok(grown.includes("write tests"));
    h.brain.runFinished({ task: kid, runId: "run_1", ok: true });
    const home = h.events("agent.home");
    assert.equal(home.length, 1);
    assert.equal(home[0].ok, true);
    const report = h.events("report");
    assert.equal(report.length, 1);
    assert.equal(report[0].taskId, "parent");
    assert.equal(report[0].from, "kid");
    assert.match(report[0].text, /store needs a reset/);
    // A stopped run neither reports nor counts as home with a result.
    await h.brain.prepareRun({ task: kid });
    h.brain.runStarted({ task: kid, runId: "run_2" });
    h.brain.runFinished({ task: kid, runId: "run_2", ok: true, userStop: true });
    assert.equal(h.events("report").length, 1);
    assert.equal(h.events("agent.home").at(-1).ok, false);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("the board's writes become stages, verdicts, Playbook records and a woken foreman", async () => {
  const h = harness();
  await h.setup();
  try {
    const shape = { intent: "implement", complexity: "atomic" };
    await h.brain.observeTasks([task(), task({ id: "kid", parentTaskId: "t1" })]);
    assert.equal(h.events("stage").length, 0, "first sight is not a transition");
    await h.brain.prepareRun({ task: task(), shape });
    h.brain.runStarted({ task: task(), runId: "run_a" });
    h.clock.t += 60_000;
    h.brain.runFinished({ task: task(), runId: "run_a", ok: true });
    await h.brain.observeTasks([task({ status: "awaiting_verification" }), task({ id: "kid", parentTaskId: "t1" })]);
    assert.equal(h.events("stage").at(-1).stage, "awaiting_verification");
    h.clock.t += 30_000;
    await h.brain.observeTasks([
      task({ status: "done", doneAt: h.clock.t, verification: { state: "verified", at: h.clock.t } }),
      task({ id: "kid", parentTaskId: "t1", status: "done", verification: { state: "verified", at: h.clock.t } }),
    ]);
    const archivist = h.events("pipeline").filter((row) => row.role === "archivist");
    assert.equal(archivist.length, 1);
    assert.match(archivist[0].text, /Playbook \(verified\)/);
    assert.deepEqual(h.woke, ["a delegated child reported"]);
    const playbook = await h.brain.playbookState();
    assert.equal(playbook.recipes.length, 1);
    assert.equal(playbook.recipes[0].verified, 1);
    await h.brain.flush();
    const saved = JSON.parse(await readFile(path.join(h.dir(), "playbook.json"), "utf8"));
    assert.equal(saved.recipes.length, 1);
    const pipelines = JSON.parse(await readFile(path.join(h.dir(), "pipelines.json"), "utf8"));
    assert.equal(pipelines.pipelines.t1.done, true);
    // The next task of this shape starts from the recipe.
    const next = task({ id: "t2", title: "Add the sort bar" });
    const hints = await h.brain.prepareRun({ task: next, shape });
    assert.match(hints.brief, /recipe "/);
    // A card out of verification tries is reported as stopped work.
    await h.brain.observeTasks([next]);
    await h.brain.observeTasks([{ ...next, status: "open", verification: { state: "failed", at: h.clock.t + 1 } }]);
    assert.equal(h.events("stage").at(-1).stage, "parked");
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("the desk answers a stuck worker, folds repeats and escalates what it cannot answer", async () => {
  const calls = [];
  const answers = [
    { ok: true, text: '```json\n{"answer":"Split it into the grid, the state and the keys.","parts":["layout grid","filter state","keyboard nav"],"escalate":false,"reason":""}\n```' },
    { ok: true, text: '{"answer":"","parts":[],"escalate":true,"reason":"Only the owner can say which design wins"}' },
  ];
  const h = harness({ seat: async (seat, system, user) => { calls.push({ seat, user }); return answers.shift() ?? { ok: false, error: "no more" }; } });
  await h.setup();
  try {
    await h.brain.observeTasks([task()]);
    await h.brain.prepareRun({ task: task() });
    h.brain.runStarted({ task: task(), runId: "run_d" });
    h.brain.workerLine({ taskId: "t1", runId: "run_d", line: "MEFI_HELP: how should I split the view step? :: tried one big component" });
    h.brain.workerLine({ taskId: "t1", runId: "run_d", line: "MEFI_HELP: How should I split the view step?" });
    await h.brain.flush();
    assert.equal(calls.length, 1, "the repeat is folded");
    assert.equal(calls[0].seat, "desk");
    const answered = h.events("help.answer");
    assert.equal(answered.length, 1);
    assert.equal(answered[0].ok, true);
    const hints = await h.brain.prepareRun({ task: task() });
    assert.match(hints.brief, /Desk answer to "how should I split the view step\?"/);
    h.brain.workerLine({ taskId: "t1", runId: "run_d", line: "MEFI_HELP: which design should win?" });
    await h.brain.flush();
    assert.equal(h.raised.length, 1);
    assert.equal(h.raised[0].taskId, "t1");
    assert.match(h.raised[0].title, /The desk could not answer/);
    assert.equal(h.events("help.answer").at(-1).ok, false);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("without a seat the desk escalates instead of staying silent", async () => {
  const h = harness();
  await h.setup();
  try {
    h.brain.workerLine({ taskId: "t1", runId: "r", line: "MEFI_HELP: what are the parts?" });
    await h.brain.flush();
    assert.equal(h.raised.length, 1);
    assert.match(h.raised[0].detail, /no model is set up/);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("verified file sets build the project map and name related systems in the brief", async () => {
  const h = harness();
  const root = await h.setup();
  try {
    await h.brain.observeTasks([task()]);
    h.brain.filesTouched({ taskId: "t1", runId: "r1", reads: ["C:/proj/renderer/nav.js", "C:/proj/data/secret.json"], edits: ["C:/proj/renderer/tasks.js", "C:/proj/scripts/backlog.cjs"], root: "C:/proj" });
    h.brain.filesTouched({ taskId: "t1", runId: "r2", reads: [], edits: ["C:/proj/renderer/tasks.js", "C:/proj/scripts/backlog.cjs"], root: "C:/proj" });
    assert.equal(h.events("file.edit").length, 2);
    assert.ok(!h.events("file.read")[0].files.some((file) => file.includes("data/")), "data/ never enters the map");
    await h.brain.flush();
    const index = (await readFile(path.join(root, "file-index.jsonl"), "utf8")).trim().split("\n");
    assert.equal(index.length, 2);
    const { map } = await h.brain.mapState();
    const ids = map.systems.map((row) => row.id);
    assert.ok(ids.includes("renderer"));
    assert.ok(ids.includes("scripts"));
    assert.ok(map.links.some((link) => [link.a, link.b].sort().join() === "renderer,scripts"));
    const hints = await h.brain.prepareRun({ task: task({ title: "Fix the tasks renderer list", prompt: "renderer tasks list" }) });
    assert.match(hints.brief, /Related systems:/);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("the companion greets after an absence, queues what needs the owner and learns preferences", async () => {
  const h = harness();
  await h.setup();
  try {
    assert.equal((await h.brain.welcome({ tasks: [] })).digest, null, "no greeting before the owner was ever seen");
    await h.brain.seen({ reason: "hide" });
    await h.brain.observeTasks([task()]);
    h.clock.t += 3 * 3600 * 1000;
    await h.brain.prepareRun({ task: task() });
    h.brain.runStarted({ task: task(), runId: "run_w" });
    const done = task({ status: "done", doneAt: h.clock.t });
    const { digest } = await h.brain.welcome({ tasks: [done] });
    assert.ok(digest);
    assert.equal(digest.finished.length, 1);
    assert.equal(digest.started, 1);
    assert.match(digest.headline, /3 h/);
    const question = { id: "q1", at: h.clock.t, kind: "question", source: "issue", title: "Scope?", status: "open", context: { issueKind: "owner", taskId: "t1" }, options: [{ id: "acknowledge", label: "I'll take care of it" }] };
    const state = await h.brain.companionState({ questions: [question], tasks: [done], running: 1 });
    assert.equal(state.state, "greeting");
    assert.equal(state.queue.counts.question, 1);
    assert.deepEqual((await h.brain.companionPrefs({ look: "dragon" })).ok, false);
    assert.equal((await h.brain.companionPrefs({ look: "fox", scope: "all" })).look, "fox");
    for (let i = 0; i < 5; i += 1) h.brain.recordDecision({ kind: "scope", verb: "narrow" });
    const later = await h.brain.companionState({ questions: [], tasks: [], running: 0 });
    assert.equal(later.look, "fox");
    assert.equal(later.scope, "all");
    assert.ok(later.preferences.some((line) => /Keep to the brief/.test(line)));
    await h.brain.flush();
    const saved = JSON.parse(await readFile(path.join(h.dir(), "companion.json"), "utf8"));
    assert.equal(saved.look, "fox");
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("each project keeps its own files and state, and a broken file never throws", async () => {
  const h = harness();
  const first = await h.setup();
  try {
    await writeFile(path.join(first, "pipelines.json"), "{ not json", "utf8");
    await h.brain.prepareRun({ task: task() });
    await h.use("p2");
    await h.brain.prepareRun({ task: task({ id: "other" }) });
    await h.brain.flush();
    const second = JSON.parse(await readFile(path.join(h.dir("p2"), "pipelines.json"), "utf8"));
    assert.deepEqual(Object.keys(second.pipelines), ["other"]);
    const firstSaved = JSON.parse(await readFile(path.join(first, "pipelines.json"), "utf8"));
    assert.deepEqual(Object.keys(firstSaved.pipelines), ["t1"]);
    // The events of one project never reach the other's file.
    const { events } = await h.brain.events({});
    assert.ok(events.every((row) => row.project === "p2"));
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("hooks with missing identities are ignored rather than thrown", async () => {
  const h = harness();
  await h.setup();
  try {
    h.brain.runStarted({});
    h.brain.workerLine({});
    h.brain.todos({ taskId: "x" });
    h.brain.runFinished({ task: null });
    h.brain.filesTouched({});
    await h.brain.observeTasks(null);
    assert.deepEqual(await h.brain.prepareRun({}), { protocol: "", brief: "" });
    assert.equal(h.sent.length, 0);
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("one companion across projects: shared look and reach, other projects' asks named", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "brain-app-"));
  const dirs = { p1: await mkdtemp(path.join(os.tmpdir(), "brain-p1-")), p2: await mkdtemp(path.join(os.tmpdir(), "brain-p2-")) };
  let current = "p1";
  const brain = host.createAgentBrain({ dataFile: (name) => path.join(dirs[current], name), appDataFile: (name) => path.join(appDir, name), projectId: () => current, now: () => 5_000_000 });
  try {
    await brain.companionPrefs({ look: "owl", scope: "all" });
    current = "p2";
    assert.equal(await brain.companionScope(), "all", "the choice made in one project holds in the next");
    const ask = (id) => ({ id, at: 1, kind: "question", source: "issue", title: `Ask ${id}`, status: "open", context: { issueKind: "scope", taskId: "t" }, options: [{ id: "narrow", label: "Keep to the brief" }] });
    const state = await brain.companionState({ questions: [ask("here")], tasks: [], running: 0, project: "Second", others: [{ project: "First", projectId: "p1", questions: [ask("there")] }] });
    assert.equal(state.look, "owl");
    assert.equal(state.queue.counts.question, 2);
    const there = state.queue.items.find((item) => item.id === "there");
    assert.equal(there.project, "First");
    assert.equal(there.projectId, "p1");
    await brain.companionPrefs({ scope: "project" });
    const narrow = await brain.companionState({ questions: [], tasks: [], others: [{ project: "First", projectId: "p1", questions: [ask("there")] }] });
    assert.equal(narrow.queue.counts.total, 0, "this project only: other projects' asks stay out");
    await brain.flush();
    const saved = JSON.parse(await readFile(path.join(appDir, "companion.json"), "utf8"));
    assert.equal(saved.look, "owl");
    await assert.rejects(readFile(path.join(dirs.p1, "companion.json"), "utf8"), "no per-project copy is written");
  } finally {
    await brain.flush();
    for (const dir of [appDir, ...Object.values(dirs)]) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("ideas and plans placed on a system survive a map rebuild", async () => {
  const h = harness();
  const root = await h.setup();
  try {
    assert.equal((await h.brain.placeOnMap({ kind: "task", id: "x", systemId: "renderer" })).ok, false);
    assert.equal((await h.brain.placeOnMap({ kind: "idea", id: "", systemId: "renderer" })).ok, false);
    await h.brain.placeOnMap({ kind: "idea", id: "i1", systemId: "renderer" });
    await h.brain.placeOnMap({ kind: "plan", id: "pl1", systemId: "scripts" });
    await h.brain.placeOnMap({ kind: "plan", id: "pl1", systemId: null });
    const { places } = await h.brain.mapState({ rebuild: true });
    assert.deepEqual(places, { ideas: { i1: "renderer" }, plans: {} });
    await h.brain.flush();
    const saved = JSON.parse(await readFile(path.join(root, "map-places.json"), "utf8"));
    assert.equal(saved.ideas.i1, "renderer");
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("the head drafts a complex task's pipeline when no recipe fits, once, and never under a moving run", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brain-draft-"));
  const calls = [];
  const draft = JSON.stringify({ steps: [{ kind: "read", title: "Read the ask", parents: [] }, { kind: "map", title: "Map the store files", parents: [0] }, { kind: "build", title: "Store", parents: [1] }, { kind: "build", title: "View", parents: [1] }, { kind: "test", title: "Test", parents: [2, 3] }, { kind: "verify", title: "Verify", parents: [4] }, { kind: "land", title: "Land", parents: [5] }] });
  let reply = { ok: true, text: draft };
  const brain = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), now: () => 9_000_000, headFetch: async (system, user) => { calls.push(user); return reply; } });
  const shape = { intent: "implement", complexity: "systemic" };
  try {
    // Off unless asked, and never for a simple task.
    await brain.prepareRun({ task: { id: "a", title: "A" }, shape });
    await brain.prepareRun({ task: { id: "b", title: "B" }, shape: { intent: "implement", complexity: "atomic" }, draft: true });
    await brain.flush();
    assert.equal(calls.length, 0);
    await brain.prepareRun({ task: { id: "c", title: "Rework the store" }, shape, draft: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await brain.flush();
    assert.equal(calls.length, 1);
    const drafted = (await brain.state()).pipelines.c;
    assert.equal(drafted.drafted, true);
    assert.deepEqual(drafted.steps.map((step) => step.title), ["Read the ask", "Map the store files", "Store", "View", "Test", "Verify", "Land"]);
    // A run that moved past its first steps keeps its layout; the draft waits.
    await brain.prepareRun({ task: { id: "d", title: "D" }, shape, draft: false });
    brain.runStarted({ task: { id: "d", title: "D" }, runId: "r_d" });
    brain.workerLine({ taskId: "d", runId: "r_d", line: "first", first: true });
    brain.todos({ taskId: "d", runId: "r_d", todos: [{ content: "build it", status: "completed" }] });
    const before = (await brain.state()).pipelines.d.steps.length;
    reply = { ok: true, text: draft };
    const s = await brain.prepareRun({ task: { id: "d2", title: "D2" }, shape, draft: true });
    assert.ok(s.protocol);
    assert.equal((await brain.state()).pipelines.d.steps.length, before);
    reply = { ok: true, text: "not json at all" };
    await brain.prepareRun({ task: { id: "e", title: "E" }, shape, draft: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await brain.flush();
    assert.equal((await brain.state()).pipelines.e.drafted, undefined, "an unusable draft leaves the template");
  } finally {
    await brain.flush();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("review fixes: a failed child fails its step, a requeued one waits again, a started step shows working", async () => {
  const h = harness();
  await h.setup();
  try {
    const parent = task({ id: "parent", delegation: { childTaskIds: ["kid"] } });
    const kid = task({ id: "kid", title: "Filter state", parentTaskId: "parent" });
    await h.brain.observeTasks([parent, kid]);
    await h.brain.prepareRun({ task: parent });
    await h.brain.observeTasks([parent, { ...kid, status: "active" }]);
    const stepOf = async () => (await h.brain.state()).pipelines.parent.steps.find((step) => step.owner === "kid");
    assert.equal((await stepOf()).status, "active");
    await h.brain.observeTasks([parent, { ...kid, status: "open" }]);
    assert.equal((await stepOf()).status, "queued", "a child whose run ended without a verdict waits again");
    await h.brain.observeTasks([parent, { ...kid, status: "open", verification: { state: "failed", at: 5 } }]);
    assert.equal((await stepOf()).status, "failed", "out of verification tries is failed, though the board says open");
    await h.brain.prepareRun({ task: task({ id: "solo" }) });
    h.brain.runStarted({ task: task({ id: "solo" }), runId: "r_s" });
    h.brain.workerLine({ taskId: "solo", runId: "r_s", line: "MEFI_STEP: add :: wire the store" });
    const grown = (await h.brain.state()).pipelines.solo.steps.find((step) => step.title === "wire the store");
    assert.equal(grown.status, "active");
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("review fixes: the newest desk answer and related systems fit the brief's 700 characters", async () => {
  const answers = [
    { ok: true, text: JSON.stringify({ answer: `old ${"x".repeat(580)}`, parts: ["a"], escalate: false, reason: "" }) },
    { ok: true, text: JSON.stringify({ answer: "NEWEST answer: do the store first", parts: ["store"], escalate: false, reason: "" }) },
  ];
  const h = harness({ seat: async () => answers.shift() });
  await h.setup();
  try {
    await h.brain.observeTasks([task()]);
    await h.brain.prepareRun({ task: task() });
    h.brain.runStarted({ task: task(), runId: "r1" });
    h.brain.workerLine({ taskId: "t1", runId: "r1", line: "MEFI_HELP: first question" });
    await h.brain.flush();
    h.brain.workerLine({ taskId: "t1", runId: "r1", line: "MEFI_HELP: second question" });
    await h.brain.flush();
    const { brief } = await h.brain.prepareRun({ task: task() });
    assert.ok(brief.slice(0, 700).includes("NEWEST answer"), "the newest answer comes first");
  } finally { await h.brain.flush(); await h.cleanup(); }
});

test("review fixes: an escalation for a project that is not open waits for it, and early decisions keep the saved look", async () => {
  const raised = [];
  let active = false;
  const dir = await mkdtemp(path.join(os.tmpdir(), "brain-defer-"));
  const brain = host.createAgentBrain({ dataFile: (name) => path.join(dir, name), isActive: () => active, raiseIssue: async (raw) => { raised.push(raw); } });
  try {
    brain.workerLine({ taskId: "t1", runId: "r", line: "MEFI_HELP: what now?" });
    await brain.flush();
    assert.equal(raised.length, 0, "held while its project is not the open one");
    active = true;
    await brain.observeTasks([task()]);
    await brain.flush();
    assert.equal(raised.length, 1);
    await writeFile(path.join(dir, "companion.json"), JSON.stringify({ v: 1, look: "owl", scope: "all", lastSeenAt: 7, decisions: [] }), "utf8");
    const fresh = host.createAgentBrain({ dataFile: (name) => path.join(dir, name) });
    await fresh.recordDecision({ kind: "scope", verb: "narrow" });
    await fresh.flush();
    const saved = JSON.parse(await readFile(path.join(dir, "companion.json"), "utf8"));
    assert.equal(saved.look, "owl");
    assert.equal(saved.scope, "all");
    assert.equal(saved.decisions.length, 1);
  } finally {
    await brain.flush();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("atomic writes leave no temp behind and clear stale temps from killed or refused writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brain-temps-"));
  try {
    const file = path.join(dir, "companion.json");
    const stale = path.join(dir, "companion.json.4242.tmp");
    await writeFile(stale, "");
    await utimes(stale, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    await writeFile(path.join(dir, "companion.json.4343.tmp"), "{}"); // a live writer's, under a minute old
    await writeFile(path.join(dir, "other.json.4242.tmp"), "{}"); // another file's temp is not ours to clear
    await host.writeJsonAtomic(file, { v: 2 });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { v: 2 });
    assert.deepEqual((await readdir(dir)).sort(), ["companion.json", "companion.json.4343.tmp", "other.json.4242.tmp"]);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
