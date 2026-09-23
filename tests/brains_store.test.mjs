// The store behind the editor: one file of maps per project, the shipped
// pipeline seeded when there is none, and — the part that actually changes how
// the studio behaves — activation moving the real switches its parts name, but
// only the ones the map speaks to, and only after the plan has been shown.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";
import * as assistant from "../scripts/assistant.mjs";
import brains from "../scripts/brains.cjs";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function storeHost({ file = null, settings = { jevShadow: false, modelSelection: "auto" } } = {}) {
  const state = assistant.emptyState(1000);
  state.prefs = { ...state.prefs, proactive: true, parallel: 8 };
  const disk = new Map(file ? [["brain-maps.json", JSON.stringify(file)]] : []);
  const autopilot = { autoBuild: true, execute: false };
  const saved = { ...settings };
  const logs = [], sent = [], autopilotCalls = [], prefCalls = [], jevWakes = [];
  const env = vm.createContext({
    console, path, brains,
    STUDIO_ROOT: "",
    assistantState: state,
    autopilot,
    crypto: { randomBytes: () => ({ toString: () => "abcd" }) },
    projects: { current: () => ({ id: "project-a" }) },
    projectDataPath: (file) => path.basename(file),
    readFile: async (name) => {
      const held = disk.get(path.basename(name));
      if (held === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return held;
    },
    writeFile: async (name, text) => { disk.set(path.basename(name), text); },
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
  });
  vm.runInContext(section("// ---- brain maps ---", "// ---- agent issues") + section("function updateSettings(", "function send(channel, payload)"), env);
  return { env, disk, autopilot, saved, state, logs, sent, autopilotCalls, prefCalls, jevWakes };
}

// The real preload bridge, so a test sees exactly the payload brains:save gets.
function preloadBridge() {
  let bridge = null;
  const calls = [];
  vm.runInNewContext(preloadSource, {
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
        ipcRenderer: { invoke: async (channel, payload) => { calls.push({ channel, payload }); return { ok: true }; }, on: () => {} },
      };
    },
  });
  return { bridge, calls };
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
  const h = storeHost();
  const read = await h.env.brainsRead(null);
  const result = await h.env.brainsActivate(read.map.id, { applyGates: true });
  assert.equal(result.ok, true);
  assert.equal(h.autopilot.autoBuild, false, "verify-first holds each saved scope");
  assert.equal(h.autopilot.execute, true);
  assert.equal(h.saved.jevShadow, true);
  assert.equal(h.saved.modelSelection, "auto");
  assert.equal(h.state.prefs.proactive, true);
  assert.equal(h.state.prefs.parallel, 4, "the dispatch part's worker count is applied");
  assert.equal(h.jevWakes.length, 1);
  assert.ok(result.moved.includes("Jev routing"));
  assert.ok(h.sent.some((event) => event.channel === "brains:active"));
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
