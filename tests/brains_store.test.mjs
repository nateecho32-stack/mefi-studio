// The store behind the editor: one file of maps per project, the shipped
// pipeline seeded when there is none, and — the part that actually changes how
// the studio behaves — activation moving the real switches its parts name, but
// only the ones the map speaks to, and only after the plan has been shown.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile as writeDisk } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import brains from "../scripts/brains.cjs";
import agentIssues from "../scripts/agent-issues.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

// raw is the store's exact text, for a file that does not parse; env
// overrides any host collaborator for one test.
function storeHost({ file = null, raw = null, settings = { jevShadow: false, modelSelection: "auto" }, autopilot: pilot = {}, env: extra = {} } = {}) {
  const state = assistant.emptyState(1000);
  state.prefs = { ...state.prefs, proactive: true, parallel: 8 };
  const disk = new Map(file || raw !== null ? [["brain-maps.json", raw ?? JSON.stringify(file)]] : []);
  const autopilot = { autoBuild: true, execute: false, parallel: 3, ...pilot };
  const saved = { ...settings };
  const logs = [], sent = [], autopilotCalls = [], prefCalls = [], jevWakes = [], plainWrites = [], atomicWrites = [];
  // read.error makes every read of the store fail with that code.
  const read = { error: null };
  const env = vm.createContext({
    console, path, brains, agentIssues, Buffer,
    require: createRequire(import.meta.url),
    STUDIO_ROOT: "",
    EXECUTOR_PARALLEL_CAP: 3,
    TASKS_PATH: "eyes-tasks.json",
    EXECUTOR_LOG_PATH: "executor-log.jsonl",
    assistantState: state,
    autopilot,
    crypto: { randomBytes: () => ({ toString: () => "abcd" }) },
    projects: { current: () => ({ id: "project-a" }) },
    projectDataPath: (file) => path.basename(file),
    readFile: async (name) => {
      if (read.error) throw Object.assign(new Error(`${read.error}: resource busy`), { code: read.error });
      const held = disk.get(path.basename(name));
      if (held === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return held;
    },
    // The store is never written in place: a crash mid-write would tear it.
    writeFile: async (name, text) => { plainWrites.push(path.basename(name)); disk.set(path.basename(name), text); },
    copyFile: async (from, to) => {
      const held = disk.get(path.basename(from));
      if (held === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      disk.set(path.basename(to), held);
    },
    authStore: {
      atomicWriteJson: async (name, value) => { atomicWrites.push(path.basename(name)); disk.set(path.basename(name), JSON.stringify(value, null, 2)); },
    },
    mkdir: async () => {},
    send: (channel, payload) => sent.push({ channel, payload }),
    assistantLog: (kind, text) => { logs.push({ kind, text }); },
    logError: (text) => { logs.push({ kind: "error", text }); },
    setAutopilot: async (prefs) => { autopilotCalls.push(prefs); Object.assign(autopilot, prefs); return { ok: true }; },
    assistantSetPrefs: async (patch) => { prefCalls.push(patch); Object.assign(state.prefs, patch); return { ok: true }; },
    readSettings: async () => ({ ...saved }),
    writeSettings: async (next) => { Object.assign(saved, next); },
    settingsDisk: { queue: Promise.resolve() },
    getJevQueue: () => ({ wake: () => jevWakes.push(Date.now()) }),
    resolveAiRoute: async () => ({ ok: false }),
    httpAssistantCall: async () => ({ ok: false }),
    getEyes: async () => ({ readJson: async () => [] }),
    ...extra,
  });
  vm.runInContext(section("// ---- brain maps ---", "// ---- agent issues") + section("function updateSettings(", "function send(channel, payload)"), env);
  return { env, disk, autopilot, saved, state, logs, sent, autopilotCalls, prefCalls, jevWakes, plainWrites, atomicWrites, read };
}

// The real preload bridge, so a test sees exactly the payload brains:save gets.
function preloadBridge() {
  const calls = [];
  const page = {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
        ipcRenderer: { invoke: async (channel, payload) => { calls.push({ channel, payload }); return { ok: true }; }, on: () => {} },
      };
    },
  };
  vm.runInNewContext(preloadSource, page);
  return { bridge: page.mefiStudio, calls };
}

test("a project with no store is seeded with the shipped pipeline, and it is live", async () => {
  const h = storeHost();
  const state = await h.env.brainsState();
  assert.equal(state.ok, true);
  assert.equal(state.maps.length, 1);
  assert.equal(state.maps[0].builtIn, true);
  assert.equal(state.activeId, state.maps[0].id);
  assert.equal(state.maps[0].ok, true, "the shipped map validates");
  const read = await h.env.brainsRead(null);
  assert.equal(read.map.nodes.length, 18);
  assert.equal(read.compiled.ok, true);
  assert.equal(read.active, true);
  // Reading does not write: a project that never opened the editor keeps a
  // clean data folder.
  assert.equal(h.disk.size, 0);
});

test("a saved store without the shipped map gets it back rather than losing the pipeline", async () => {
  const custom = { ...brains.normalizeMap({ id: "mine", name: "Mine", nodes: [], edges: [], grants: [] }), builtIn: false };
  const h = storeHost({ file: { schema: 1, activeId: "mine", maps: [custom] } });
  const state = await h.env.brainsState();
  assert.equal(state.maps.length, 2);
  assert.ok(state.maps.some((map) => map.builtIn));
  assert.equal(state.activeId, "mine", "the owner's choice of live map is kept");
});

test("saving writes the file, keeps builtIn honest and pushes the change", async () => {
  const h = storeHost();
  const read = await h.env.brainsRead(null);
  const edited = { ...plain(read.map), name: "My pipeline" };
  const saved = await h.env.brainsSave({ map: edited });
  assert.equal(saved.ok, true);
  assert.equal(saved.map.name, "My pipeline");
  assert.equal(saved.map.builtIn, true, "editing the shipped map does not make it a copy");
  assert.ok(saved.map.updatedAt > 0);
  const onDisk = JSON.parse(h.disk.get("brain-maps.json"));
  assert.equal(onDisk.maps[0].name, "My pipeline");
  assert.ok(h.sent.some((event) => event.channel === "brains:changed"));
  assert.ok(h.sent.some((event) => event.channel === "brains:active"), "the live map's rules changed, so the host is told");
  assert.ok(h.logs.some((row) => row.kind === "brains" && row.text.includes("My pipeline")));
  // A map with nothing in it is not saved by accident.
  const empty = await h.env.brainsSave({ map: { id: "blank", name: "Blank", nodes: [], edges: [] } });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /at least one node/);
});

test("an empty map is kept only when the editor asks beside the map, through the real bridge", async () => {
  const h = storeHost();
  const { bridge, calls } = preloadBridge();
  const blank = { id: "blank", name: "Blank", nodes: [], edges: [] };
  const through = async (...args) => {
    await bridge.brainsSave(...args);
    const call = calls.at(-1);
    assert.equal(call.channel, "brains:save");
    return h.env.brainsSave(call.payload);
  };
  const refused = await through(blank);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /at least one node/);
  // The flag riding on the map was how the old editor asked; it is not a request.
  assert.equal((await through({ ...blank, allowEmpty: true })).ok, false);
  assert.equal((await through(blank, { allowEmpty: "yes" })).ok, false, "only a real true asks");
  assert.equal(h.disk.size, 0, "nothing refused reached the file");
  const kept = await through(blank, { allowEmpty: true });
  assert.equal(kept.ok, true);
  assert.equal(kept.map.nodes.length, 0);
  assert.equal(kept.map.allowEmpty, undefined, "the request is not stored on the map");
  const onDisk = JSON.parse(h.disk.get("brain-maps.json"));
  assert.ok(onDisk.maps.some((map) => map.id === "blank" && map.nodes.length === 0));
  assert.ok(kept.state.maps.some((map) => map.id === "blank"), "the switcher lists it");
});

test("the switcher judges a map that calls another brain against the saved maps", async () => {
  const h = storeHost();
  const inner = { id: "inner", name: "Inner", grants: ["create-task"], nodes: [brains.makeNode("user.request", { id: "n_req" })], edges: [] };
  const caller = {
    id: "caller", name: "Caller", grants: ["create-task"],
    nodes: [brains.makeNode("user.request", { id: "n_req" }), brains.makeNode("brain.call", { id: "n_call", config: { map: "inner" } })],
    edges: [{ id: "e_in", from: { node: "n_req", port: "request" }, to: { node: "n_call", port: "in" } }],
  };
  assert.equal((await h.env.brainsSave({ map: inner })).ok, true);
  assert.equal((await h.env.brainsSave({ map: caller })).ok, true);
  const listed = (await h.env.brainsState()).maps.find((map) => map.id === "caller");
  assert.equal(listed.errors, 0, "a call to a saved map is not a missing map");
  assert.equal(listed.ok, true);
  // The switcher and the editor agree on what is wrong with the map.
  const read = await h.env.brainsRead("caller");
  assert.equal(read.compiled.problems.filter((item) => item.level === "error").length, listed.errors);
});

test("the shipped map can be reset but never deleted, and the last map always stays", async () => {
  const h = storeHost();
  const read = await h.env.brainsRead(null);
  const deleted = await h.env.brainsDelete(read.map.id);
  assert.equal(deleted.ok, false);
  assert.match(deleted.error, /cannot be deleted/);
  await h.env.brainsSave({ map: { ...plain(read.map), name: "Trimmed", nodes: plain(read.map).nodes.slice(0, 4) } });
  const reset = await h.env.brainsReset(read.map.id);
  assert.equal(reset.ok, true);
  assert.equal(reset.map.nodes.length, 18, "reset restores the shipped pipeline");
});

test("a map another map calls cannot be deleted out from under it", async () => {
  const h = storeHost();
  const inner = { id: "inner", name: "Inner", grants: ["message-user"], nodes: [brains.makeNode("ask.user", { id: "n_ask" })], edges: [] };
  await h.env.brainsSave({ map: inner });
  const read = await h.env.brainsRead(null);
  const caller = plain(read.map);
  caller.nodes.push({ ...brains.makeNode("brain.call", { id: "n_call", config: { map: "inner" } }) });
  await h.env.brainsSave({ map: caller });
  const deleted = await h.env.brainsDelete("inner");
  assert.equal(deleted.ok, false);
  assert.match(deleted.error, /calls this map/);
});

test("the gate plan says what would move before anything moves", async () => {
  const h = storeHost();
  const plan = await h.env.brainsGatePlan(null);
  assert.equal(plan.ok, true);
  const byKey = Object.fromEntries(plan.changes.map((change) => [change.key, change]));
  // Verify-first is off and Jev is off in this fixture; the shipped map wants
  // both on, and dispatch on.
  assert.equal(byKey.approveBeforeBuild.from, false);
  assert.equal(byKey.approveBeforeBuild.to, true);
  assert.equal(byKey.jev.to, true);
  assert.equal(byKey.dispatch.from, false);
  assert.equal(byKey.dispatch.to, true);
  assert.equal(byKey.briefing.moves, false, "proactive is already on, so it is not listed as a move");
  assert.deepEqual(plain(plan.moves).map((move) => move.key).sort(), ["approveBeforeBuild", "dispatch", "jev"]);
  // Planning moves nothing by itself.
  assert.deepEqual(plain(h.autopilotCalls), []);
  assert.equal(h.saved.jevShadow, false);
});

test("activating moves exactly the switches the map names", async () => {
  const h = storeHost({ autopilot: { parallel: 2 } });
  const read = await h.env.brainsRead(null);
  const result = await h.env.brainsActivate(read.map.id, { applyGates: true });
  assert.equal(result.ok, true);
  assert.equal(h.autopilot.autoBuild, false, "verify-first holds each saved scope");
  assert.equal(h.autopilot.execute, true);
  assert.equal(h.saved.jevShadow, true);
  assert.equal(h.saved.modelSelection, "auto");
  assert.equal(h.state.prefs.proactive, true);
  // Workers at once is the build worker limit, not the assistant's roster.
  assert.equal(h.autopilot.parallel, 3, "the dispatch part's worker count is the build worker limit");
  assert.equal(h.state.prefs.parallel, 8, "the assistant's roster width is left alone");
  assert.ok(h.prefCalls.every((patch) => !("parallel" in patch)));
  assert.ok(result.moved.includes("Workers at once"));
  assert.equal(h.jevWakes.length, 1);
  assert.ok(result.moved.includes("Jev routing"));
  assert.ok(h.sent.some((event) => event.channel === "brains:active"));
});

test("Workers at once shows in the plan as its own row, and never passes the executor's cap", async () => {
  const h = storeHost({ autopilot: { parallel: 1 } });
  const plan = await h.env.brainsGatePlan(null);
  const row = plan.changes.find((change) => change.key === "parallel");
  assert.equal(row.label, "Workers at once");
  assert.equal(row.setting, "autopilot.parallel");
  assert.equal(row.from, 1, "from is the build worker limit in force now");
  assert.equal(row.to, 3);
  assert.equal(row.moves, true);
  assert.ok(plan.moves.some((move) => move.key === "parallel"), "the owner sees it before activation");
  // A map saved by an older build asked for more workers than the studio runs.
  const read = await h.env.brainsRead(null);
  const wide = plain(read.map);
  wide.nodes.find((node) => node.type === "work.dispatch").config.parallel = 12;
  await h.env.brainsSave({ map: wide });
  assert.equal((await h.env.brainsGatePlan(null)).gates.parallel, 3);
  await h.env.brainsActivate(read.map.id, { applyGates: true });
  assert.equal(h.autopilot.parallel, 3);
  assert.deepEqual(plain(h.autopilotCalls.filter((call) => "parallel" in call)), [{ parallel: 3 }]);
  // The host's own cap wins over the map's even if the two ever drift apart.
  const capped = storeHost({ autopilot: { parallel: 1 }, env: { EXECUTOR_PARALLEL_CAP: 2 } });
  assert.equal((await capped.env.brainsGatePlan(null)).gates.parallel, 2);
});

test("a session narrowing is not undone by a map that asks for the chosen limit", async () => {
  // A wedged start narrowed 3 to 2 for the session; setAutopilot restores the
  // chosen limit whenever one is sent, so the map must not send one.
  const h = storeHost({ autopilot: { parallel: 2, parallelNarrowedFrom: 3, adaptiveParallel: true } });
  const plan = await h.env.brainsGatePlan(null);
  const row = plan.changes.find((change) => change.key === "parallel");
  assert.equal(row.from, 2, "the plan shows the limit in force");
  assert.equal(row.moves, false, "the chosen limit already matches");
  assert.match(row.detail, /Machine agent is managing workers now/, "and says the limit waits behind the Machine agent");
  const read = await h.env.brainsRead(null);
  await h.env.brainsActivate(read.map.id, { applyGates: true });
  assert.ok(h.autopilotCalls.every((call) => !("parallel" in call)));
  assert.equal(h.autopilot.parallel, 2);
});

test("a map without a part leaves that stage off, and an empty map moves nothing", async () => {
  const h = storeHost();
  const read = await h.env.brainsRead(null);
  const lean = plain(read.map);
  lean.id = "lean";
  lean.name = "No Jev, no approval";
  lean.nodes = lean.nodes.filter((node) => !["jev.classify", "check.user"].includes(node.type));
  lean.edges = lean.edges.filter((edge) => lean.nodes.some((node) => node.id === edge.from.node) && lean.nodes.some((node) => node.id === edge.to.node));
  const saved = await h.env.brainsSave({ map: lean });
  assert.equal(saved.ok, true);
  await h.env.brainsActivate("lean", { applyGates: true });
  assert.equal(h.saved.jevShadow, false, "no Jev part means Jev routing is off");
  assert.equal(h.autopilot.autoBuild, true, "no approval part means work is not held");
  assert.equal(h.autopilot.execute, true, "the dispatch part is still there");
});

test("a map with errors cannot go live", async () => {
  const h = storeHost();
  const read = await h.env.brainsRead(null);
  const broken = plain(read.map);
  broken.id = "broken";
  broken.name = "Broken";
  broken.grants = [];
  await h.env.brainsSave({ map: broken });
  const result = await h.env.brainsActivate("broken", { applyGates: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /Fix \d+ problem/);
  assert.ok(result.problems.length);
  assert.deepEqual(plain(h.autopilotCalls), [], "nothing moved");
});

test("the live map's decision rules are what triage reads", async () => {
  const h = storeHost();
  const policy = await h.env.activeIssuePolicy();
  assert.equal(policy.triage, true);
  assert.equal(policy.asks, true);
  assert.equal(policy.autoRetryLimit, 2);
  assert.equal(policy.maxOpenAsks, 6);
  const read = await h.env.brainsRead(null);
  const edited = plain(read.map);
  const triage = edited.nodes.find((node) => node.type === "issue.triage");
  triage.config.auto = [];
  triage.config.autoRetryLimit = 0;
  await h.env.brainsSave({ map: edited });
  const after = await h.env.activeIssuePolicy();
  assert.deepEqual(plain(after.auto), [], "an edit to the live map reaches the next issue");
  assert.equal(after.autoRetryLimit, 0);
});

test("the live policy carries the new decision settings, and a lane in another brain is found", async () => {
  const h = storeHost();
  const policy = await h.env.activeIssuePolicy();
  assert.equal(policy.splitDepth, 3);
  assert.equal(policy.repeatAsks, "fold");
  assert.equal(policy.announce, true);
  // A live map whose Agent issues feed a brain holding the whole lane.
  const lane = {
    id: "lane", name: "Lane", grants: ["read-project", "message-user", "create-task", "close-task"],
    nodes: [
      brains.makeNode("issue.triage", { id: "t", config: { repeatAsks: "ask" } }), brains.makeNode("ask.user", { id: "a" }),
      brains.makeNode("answer.apply", { id: "p", config: { splitDepth: 1, announce: false } }),
    ],
    edges: [
      { id: "e1", from: { node: "t", port: "ask" }, to: { node: "a", port: "ask" } },
      { id: "e2", from: { node: "a", port: "answer" }, to: { node: "p", port: "answer" } },
    ],
  };
  const outer = {
    id: "outer", name: "Outer", grants: ["read-project"],
    nodes: [brains.makeNode("issue.intake", { id: "i" }), brains.makeNode("brain.call", { id: "c", config: { map: "lane" } })],
    edges: [{ id: "e1", from: { node: "i", port: "issue" }, to: { node: "c", port: "in" } }],
  };
  assert.equal((await h.env.brainsSave({ map: lane })).ok, true);
  assert.equal((await h.env.brainsSave({ map: outer })).ok, true);
  assert.equal((await h.env.brainsActivate("outer", { applyGates: false })).ok, true);
  const nested = await h.env.activeIssuePolicy();
  assert.equal(nested.triage, true, "the store's maps reach issuePolicyFor");
  assert.equal(nested.asks, true, "so permission and risk questions still reach the owner");
  assert.equal(nested.splitDepth, 1);
  assert.equal(nested.repeatAsks, "ask");
  assert.equal(nested.announce, false);
});

test("a store that does not parse is copied aside and said out loud, never quietly replaced", async () => {
  const torn = '{"schema":1,"activeId":"mine","maps":[{"id":"mine","name":"Mi';
  const h = storeHost({ raw: torn });
  const state = await h.env.brainsState();
  assert.equal(state.ok, true, "the editor still opens, on the shipped pipeline");
  const aside = [...h.disk.keys()].filter((name) => /^brain-maps\.broken-\d+\.json$/.test(name));
  assert.equal(aside.length, 1, "the unreadable store is kept beside it");
  assert.equal(h.disk.get(aside[0]), torn, "byte for byte");
  assert.ok(h.logs.some((row) => row.kind === "error" && row.text.includes(aside[0])), "the error log names the copy");
  assert.ok(h.logs.some((row) => row.kind === "brains" && row.text.includes(aside[0])), "and so does the activity log");
  // The next save writes a whole new store, atomically, and the copy survives it.
  const read = await h.env.brainsRead(null);
  assert.equal((await h.env.brainsSave({ map: { ...plain(read.map), name: "After" } })).ok, true);
  assert.equal(h.disk.get(aside[0]), torn);
  assert.deepEqual(h.atomicWrites, ["brain-maps.json"]);
  assert.deepEqual(h.plainWrites, [], "never a plain in-place write");
  assert.equal(JSON.parse(h.disk.get("brain-maps.json")).maps[0].name, "After");
});

test("a store that cannot be read right now is not seeded over", async () => {
  const mine = { ...brains.normalizeMap({ id: "mine", name: "Mine", grants: ["create-task"], nodes: [brains.makeNode("user.request", { id: "n" })], edges: [] }), builtIn: false };
  const h = storeHost({ file: { schema: 1, activeId: "mine", maps: [mine] } });
  h.read.error = "EBUSY";
  await assert.rejects(h.env.brainsState(), /could not be read \(EBUSY\); nothing was changed/);
  await assert.rejects(h.env.brainsSave({ map: { id: "other", name: "Other", nodes: [brains.makeNode("user.request", { id: "n" })], edges: [] } }), /could not be read/);
  // The live policy falls back to the defaults rather than to "only log it".
  const policy = await h.env.activeIssuePolicy();
  assert.equal(policy.triage, true);
  assert.equal(policy.asks, true);
  assert.deepEqual(h.atomicWrites, [], "nothing was written over the owner's maps");
  assert.deepEqual([...h.disk.keys()], ["brain-maps.json"]);
  // Once the file can be read again, the owner's maps are exactly where they were.
  h.read.error = null;
  const state = await h.env.brainsState();
  assert.equal(state.activeId, "mine");
  assert.ok(state.maps.some((map) => map.id === "mine"));
});

// Build with AI through the host: replies are handed out in order, and each
// call's prompt is kept so a test can read what the model was told.
function draftHost(replies) {
  const calls = [];
  const h = storeHost({
    env: {
      DATA_ONLY_CLIS: new Set(["claude"]),
      resolveAiRoute: async () => ({ ok: true, provider: "zen" }),
      httpAssistantCall: async (_route, system, user, maxTokens, options) => {
        calls.push({ system, user, maxTokens, options });
        const reply = replies[calls.length - 1];
        return reply === undefined ? { ok: false, error: "no more replies" } : { ok: true, text: typeof reply === "string" ? reply : JSON.stringify(reply), model: `model-${calls.length}` };
      },
    },
  });
  return { ...h, calls };
}
const draftNode = (id, type, x = 0, y = 0) => ({ id, type, x, y });
const draftWire = (from, fromPort, to, toPort) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

test("a drafted map comes back with its wiring repaired and every repair listed, in one call", async () => {
  const h = draftHost([`Here it is:\n${JSON.stringify({
    name: "Ask first",
    nodes: [draftNode("you", "user.request"), draftNode("clarity", "check.model", 260), draftNode("approve", "check.user", 520, 160), draftNode("scope", "analyze.scope", 780)],
    edges: [draftWire("you", "request", "clarity", "in"), draftWire("clarity", "clear", "scope", "in"), draftWire("clarity", "unclear", "approve", "in"), draftWire("approve", "approved", "scope", "in")],
  })}`]);
  const result = await h.env.brainsDraft({ text: "Ask me before anything is planned" });
  assert.equal(result.ok, true, result.error);
  assert.equal(h.calls.length, 1, "a draft the repairs settle costs one call");
  assert.match(h.calls[0].system, /only where the out port carries a kind the in port takes/);
  assert.match(h.calls[0].user, /out: clear <request>, unclear <rejected>/, "the model is told what each end carries");
  assert.match(h.calls[0].user, /Build a pipeline for this request:\nAsk me before anything is planned$/);
  assert.equal(result.compiled.problems.filter((item) => item.level === "error").length, 0);
  assert.equal(result.map.id, "map_abcd");
  assert.equal(result.map.builtIn, false);
  assert.deepEqual(plain(result.map.grants).sort(), brains.requiredGrants(result.map).sort());
  assert.ok(plain(result.fixes).some((line) => line.startsWith("Removed the wire from \"A model checks it\" · Needs work")));
  assert.equal(result.redrawn, false);
  assert.equal(result.model, "model-1");
  assert.ok(h.logs.some((row) => row.kind === "brains" && /drafted "Ask first" · 4 parts, 2 repairs, 0 errors left/.test(row.text)));
  assert.equal(h.disk.size, 0, "a draft is not saved until the owner saves it");
});

test("errors the repairs cannot settle go back to the model once, in the validator's words", async () => {
  const lonely = { name: "Jev only", nodes: [draftNode("you", "user.request"), draftNode("jev", "jev.classify", 260)], edges: [] };
  const fixed = {
    name: "Jev with a question",
    nodes: [draftNode("you", "user.request"), draftNode("scope", "analyze.scope", 260), draftNode("setup", "assistant.setup", 520), draftNode("jev", "jev.classify", 780)],
    edges: [draftWire("you", "request", "scope", "in"), draftWire("scope", "direct", "setup", "in"), draftWire("setup", "question", "jev", "in")],
  };
  const h = draftHost([lonely, fixed]);
  const result = await h.env.brainsDraft({ text: "Only Jev" });
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].user, /Your map still has these errors:\n- "Jev" has nothing wired into Jev question\./);
  assert.match(h.calls[1].user, /Build a pipeline for this request:\nOnly Jev\n/, "the second pass still carries the catalog and the request");
  assert.equal(result.redrawn, true);
  assert.equal(result.model, "model-2");
  assert.equal(result.map.name, "Jev with a question");
  assert.equal(result.compiled.problems.filter((item) => item.level === "error").length, 0);
  assert.ok(plain(result.fixes).some((line) => /^Sent 1 error the repairs could not settle back to the model/.test(line)));

  // A second pass that is no better leaves the first draft, errors drawn on it.
  const stuck = draftHost([lonely, lonely]);
  const kept = await stuck.env.brainsDraft({ text: "Only Jev" });
  assert.equal(kept.ok, true);
  assert.equal(kept.redrawn, false);
  assert.equal(kept.model, "model-1");
  assert.ok(kept.compiled.problems.some((item) => item.code === "missing-input"));

  // Two replies that are not maps are an error, not an empty map.
  const prose = draftHost(["I would suggest a pipeline with a check.", "Still prose."]);
  const refused = await prose.env.brainsDraft({ text: "Anything" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /was not a map/);
  assert.match(prose.calls[1].user, /Your reply was not a map in the format asked for/);
});

test("the activity read gives the map's parts their last day, from a bounded ledger tail", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brains-activity-"));
  try {
    const ledger = path.join(dir, "executor-log.jsonl");
    const now = Date.now();
    const rows = [
      { at: now - 3 * 86400000, event: "start", runId: "old" },
      { at: now - 60000, event: "start", runId: "r1" },
      { at: now - 50000, event: "release", runId: "r1", reason: "Machine busy (111 MB available)" },
      { at: now - 40000, event: "start", runId: "r2" },
      { at: now - 30000, event: "finish", runId: "r2", ok: true },
    ];
    await writeDisk(ledger, `${rows.map((row) => JSON.stringify(row)).join("\n")}\nnot json\n`);
    const tasks = [{ id: "task_a", decisions: [{ at: now - 1000, kind: "verify", choice: "retry", text: "the assistant settled this: verify on attempt 1 of 2" }],
      logs: [{ at: now - 2000, kind: "status", text: "verified — 2 recorded check(s) passed" }] }];
    const h = storeHost({
      env: {
        projectDataPath: (file) => (path.basename(file) === "executor-log.jsonl" ? ledger : path.basename(file)),
        getEyes: async () => ({ readJson: async (file) => (path.basename(file) === "eyes-tasks.json" ? tasks : []) }),
      },
    });
    h.state.questions = [{ id: "q1", at: now - 5000, source: "issue", status: "open", context: { issueKind: "scope" }, options: [] }];
    const activity = await h.env.brainsActivity();
    assert.equal(activity.ok, true);
    assert.ok(activity.now >= now);
    assert.equal(activity.windowMs, 86400000);
    const parts = plain(activity.parts);
    assert.equal(parts["work.dispatch"].starts, 2, "a start from three days ago is outside the day");
    assert.equal(parts["work.dispatch"].finishes, 1);
    assert.deepEqual(parts["work.dispatch"].topRelease, { reason: "Machine busy", count: 1 });
    assert.equal(parts["issue.triage"].settled, 1);
    assert.equal(parts["ask.user"].open, 1);
    assert.equal(parts["verify.evidence"].verified, 1);
    // The tail reads only the end of the ledger, and never half a row.
    const tail = plain(await h.env.brainLedgerTail(ledger, 120));
    assert.ok(tail.length >= 1 && tail.length < rows.length);
    assert.deepEqual(tail.at(-1), rows.at(-1));
    assert.deepEqual(plain(await h.env.brainLedgerTail(path.join(dir, "missing.jsonl"))), [], "no ledger reads as no rows");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
