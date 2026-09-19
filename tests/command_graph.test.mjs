import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const section = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return source.slice(a, b);
};
const musicContext = vm.createContext({ Math, Number });
vm.runInContext(section("function analyzeMusicSpectrum(", "function audioEnergy()"), musicContext);
const analyze = musicContext.analyzeMusicSpectrum;

function spectrum(sampleRate, ranges = []) {
  const fft = new Uint8Array(1024);
  for (let index = 1; index < fft.length; index += 1) {
    const hz = index * sampleRate / 2048;
    for (const [from, to, level] of ranges) if (hz >= from && hz < to) fft[index] = level;
  }
  return fft;
}

test("music bands follow physical frequencies at common sample rates", () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const [key, range] of [["bass", [55, 200, 200]], ["mid", [500, 3000, 200]], ["treble", [6000, 12000, 200]]]) {
      const response = analyze(spectrum(sampleRate, [range]), sampleRate, 2048, null, 1000);
      assert.ok(response[key] > 0.25, `${key} should respond at ${sampleRate}`);
      for (const other of ["bass", "mid", "treble"].filter((band) => band !== key)) assert.equal(response[other], 0);
    }
  }
});

test("silence stays still and loud spectra stay bounded", () => {
  let response = null;
  for (let frame = 0; frame < 100; frame += 1) response = analyze(spectrum(48000), 48000, 2048, response, frame * 33);
  for (const key of ["bass", "mid", "treble", "energy", "beat"]) assert.equal(response[key], 0);
  for (let frame = 100; frame < 200; frame += 1) response = analyze(new Uint8Array(1024).fill(255), 48000, 2048, response, frame * 33);
  for (const key of ["bass", "mid", "treble", "energy", "beat"]) assert.ok(response[key] >= 0 && response[key] <= 1);
});

test("bass attacks trigger one beat, then settle smoothly and retrigger on a new note", () => {
  const kick = spectrum(48000, [[50, 220, 220]]);
  let response = analyze(spectrum(48000), 48000, 2048, null, 1000);
  response = analyze(kick, 48000, 2048, response, 1033);
  assert.equal(response.lastBeat, 1033);
  assert.ok(response.beat > 0.5);
  const attackBass = response.bass;
  for (let frame = 1; frame <= 20; frame += 1) response = analyze(kick, 48000, 2048, response, 1033 + frame * 33);
  assert.equal(response.lastBeat, 1033, "a sustained bass note must not keep inventing beats");
  assert.ok(response.bass > attackBass);
  const heldBass = response.bass;
  response = analyze(spectrum(48000), 48000, 2048, response, 1726);
  assert.ok(response.bass > 0 && response.bass < heldBass, "release should ease toward silence");
  for (let frame = 1; frame <= 35; frame += 1) response = analyze(spectrum(48000), 48000, 2048, response, 1726 + frame * 33);
  response = analyze(kick, 48000, 2048, response, 2947);
  assert.equal(response.lastBeat, 2947);
});

const box = (left, top, width, height) => ({ hidden: false, getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
function graphContext({ width = 1440, height = 900, chat = false } = {}) {
  const el = {
    width, height,
    top: box(24, 20, width - 48, 100),
    bottom: box(200, height - 74, width - 400, 54),
    feed: box(24, 140, 320, height - 240),
    chatLog: box(width - 324, 140, 300, height - 240),
  };
  const state = { active: true, chatLogOpen: chat, graphArea: null, graphAreaAt: 0, camera: { x: 0, y: 0, z: 0 }, view: "2d", zoom: 1, angle: 0.5, pitch: 0, nodes: [] };
  const env = vm.createContext({ Date, Math, el, state });
  vm.runInContext(section("function centerX()", "function setZoom("), env);
  return { env, state, el };
}

test("graph uses measured header, activity rail, chat and dock space", () => {
  const { env, state } = graphContext({ chat: true });
  const area = env.usableArea();
  assert.equal(area.x, 372);
  assert.equal(area.y, 140);
  assert.equal(area.x + area.w, 1088);
  assert.equal(area.y + area.h, 802);
  state.nodes = [{ x: -215, y: 0, z: -215 }, { x: 215, y: 116, z: 215 }];
  env.autoFit();
  for (const node of state.nodes) {
    const p = env.project(node);
    assert.ok(p.x > area.x && p.x < area.x + area.w);
    assert.ok(p.y > area.y && p.y < area.y + area.h);
  }
});

test("collapsed chat returns space to graph and compact windows never get a negative viewport", () => {
  const collapsed = graphContext();
  assert.equal(collapsed.env.usableArea().x + collapsed.env.usableArea().w, 1412);
  const narrow = graphContext({ width: 820, height: 600, chat: true });
  const area = narrow.env.usableArea();
  assert.ok(area.w >= 160 && area.h >= 160);
  assert.ok(area.x >= 0 && area.x + area.w <= 820);
});

test("important graph labels win crowded placement without covering other text or nodes", () => {
  const { env, el, state } = graphContext();
  Object.assign(state, { labels: "all", selected: null, hoverNode: null, query: "", matchSet: new Set(), labelRects: [], labelWidths: new Map(), hudRects: [], hudRectsAt: 0 });
  el.ctx = { measureText: (text) => ({ width: text.length * 6 }), beginPath() {}, roundRect() {}, fill() {}, stroke() {}, strokeText() {}, fillText() {} };
  vm.runInContext(source.slice(source.indexOf("const LABEL_FONT ="), source.indexOf("// Node life-cycle:")), env);
  Object.assign(env, { emphasis: () => 1, colorOf: () => [230, 201, 141], hexToRgb: () => [230, 201, 141], rgba: (_color, alpha) => `rgba(1,2,3,${alpha})`, NODE_RGB: { assistant: [1, 2, 3], done: [1, 2, 3], task: [1, 2, 3] } });
  vm.runInContext(section("function measure(ctx", "// ---------- hover tooltip"), env);
  const busy = { id: "live", kind: "task", label: "Editing the player controls", state: "active", _workLabel: "Running", _pr: 12 };
  const projected = [{ node: busy, p: { x: 680, y: 400, k: 1, depth: 800 } }];
  for (let i = 0; i < 20; i += 1) projected.push({ node: { id: `quiet${i}`, kind: "agent", label: "background role", status: "done", _pr: 5 }, p: { x: 680 + (i % 4) * 18, y: 430 + Math.floor(i / 4) * 16, k: 1, depth: 800 } });
  assert.equal(env.labelCandidates(projected)[0].node.id, "live");
  env.drawLabels(projected);
  assert.ok(busy._label, "the current job must retain a readable label");
  for (let i = 0; i < state.labelRects.length; i += 1) {
    const rect = state.labelRects[i];
    assert.ok(rect.x >= 12 && rect.x + rect.w <= el.width - 12);
    for (let j = i + 1; j < state.labelRects.length; j += 1) assert.equal(env.overlaps(rect, state.labelRects[j]), false);
  }
});

test("cancelled audio requests cannot restore capture after the toggle was switched off", async () => {
  let resolveCapture;
  let stops = 0;
  const state = { active: true, reactive: true, captureArmed: true, audioSource: "desktop", inputGeneration: 0, inputPending: null, inputStream: null, inputError: null, bands: { bass: 0, mid: 0, treble: 0 }, audio: {} };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: {}, state, el: {}, noMotion: () => false, writeStore() {}, ensureAudio() {}, navigator: { mediaDevices: { getDisplayMedia: () => new Promise((resolve) => { resolveCapture = resolve; }) } } });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  env.useReactiveInput();
  assert.equal(state.inputPending, "desktop");
  env.setMusicReactive(false);
  resolveCapture({ getTracks: () => [{ stop: () => { stops += 1; } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stops, 1);
  assert.equal(state.inputStream, null);
  assert.equal(state.inputPending, null);
});

test("audio permission denial is visible and does not repeatedly reopen capture", async () => {
  let requests = 0;
  const state = { active: true, reactive: true, captureArmed: true, audioSource: "mic", inputGeneration: 0, inputPending: null, inputStream: null, inputError: null, bands: {}, audio: {} };
  const status = { textContent: "" };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: {}, state, el: { musicStatus: status }, noMotion: () => false, writeStore() {}, ensureAudio() {}, navigator: { mediaDevices: { getUserMedia: () => { requests += 1; return Promise.reject({ name: "NotAllowedError" }); } } } });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  env.useReactiveInput();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(state.inputError, /not allowed/);
  assert.equal(status.textContent, "Audio unavailable");
  env.useReactiveInput();
  assert.equal(requests, 1);
});

test("inactive agents leave the constellation without corrupting session edge targets", () => {
  const env = vm.createContext({ Map });
  vm.runInContext(section("function visibleGraphSnapshot(", "function refreshGraph()"), env);
  const nodes = [
    { id: "root", kind: "root" }, { id: "finished", kind: "folded" }, { id: "assistant", kind: "assistant" },
    ...["done", "idle", "queued", "error", "running"].map((status) => ({ id: status, kind: "agent", status })),
    { id: "session", kind: "session" },
  ];
  const edges = nodes.slice(1).map((_node, index) => ({ a: 0, b: index + 1 }));
  const graph = env.visibleGraphSnapshot({ nodes, edges }, nodes.filter((node) => node.kind !== "folded"));
  assert.deepEqual(Array.from(graph.nodes, (node) => node.id), ["root", "assistant", "running", "session"]);
  assert.deepEqual(Array.from(graph.edges, (edge) => `${graph.nodes[edge.a].id}:${graph.nodes[edge.b].id}`), ["root:assistant", "root:running", "root:session"]);
});

test("local player analysis reuses the media source and leaves playback connected when disabled", () => {
  const element = { currentSrc: "blob:fixture-track" };
  const connections = [];
  const disconnected = [];
  let sources = 0;
  const sourceNode = { connect: (node) => connections.push(node), disconnect: (node) => disconnected.push(node) };
  const audio = { destination: { id: "speakers" }, createMediaElementSource: () => { sources += 1; return sourceNode; }, createAnalyser: () => ({ connect() {} }) };
  const state = { active: true, reactive: true, audioSource: "desktop", audio, inputGeneration: 0, mediaElements: new WeakMap(), bands: {}, bus: { disconnect() {}, connect() {} } };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: { MefiMusic: { status: () => ({ source: "local", queueLength: 1 }), getAudioElement: () => element } }, state, el: {}, noMotion: () => false, writeStore() {}, ensureAudio() {}, navigator: { mediaDevices: { getDisplayMedia: () => { throw new Error("local music must not start desktop capture"); } } } });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  env.useReactiveInput();
  const analyser = state.localAudio.analyser;
  assert.equal(connections[0], audio.destination);
  assert.equal(connections[1], analyser);
  env.releaseReactiveInput();
  assert.deepEqual(disconnected, [analyser]);
  assert.equal(state.localAudio, null);
  env.useReactiveInput();
  assert.equal(sources, 1, "an HTML audio element can only create one MediaElementSource");
  assert.equal(state.localAudio.analyser, analyser);
});

test("the rail rebuilds when a running role finishes, without making queued roles look active", async () => {
  const treeSource = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
  const assistant = { state: { agents: [{ role: "builder", status: "done" }, { role: "reference", status: "queued" }] } };
  const nodes = [{ id: "assistant", kind: "assistant" }, { id: "old-builder", kind: "agent", role: "builder", status: "running" }];
  const env = vm.createContext({ assistant, nodes, agentRoster: () => assistant.state.agents, assistantSummary: () => ({ tone: "ok", sublabel: "Ready" }), reconcileMotions() {} });
  vm.runInContext(treeSource.slice(treeSource.indexOf("function agentStateOf("), treeSource.indexOf("function rebuild()")), env);
  assert.equal(env.activeAgentRoster().length, 0);
  assert.equal(env.syncAssistantNode(), true, "the old orbiting builder needs to leave the graph");
  nodes.pop();
  assert.equal(env.syncAssistantNode(), false);
  assistant.state.agents[1].status = "running";
  assert.equal(env.syncAssistantNode(), true, "the newly started role needs a visible satellite");
});

test("the music node opens the player and does not claim Spotify playback is known", () => {
  let opened = 0;
  const env = vm.createContext({ String, window: { MefiMusic: { status: () => ({ source: "spotify", title: "Spotify playlist", playing: false, externalPlayback: true }), open: () => { opened += 1; } } }, bumpHud() {} });
  vm.runInContext(section("function musicNodeDetails()", "function appendMusicNode()"), env);
  vm.runInContext(section("function selectNode(", "function select(id)"), env);
  const details = env.musicNodeDetails();
  assert.equal(details.state, "music");
  assert.match(details.label, /Spotify/);
  assert.doesNotMatch(details.label, /Playing/);
  env.selectNode({ kind: "music" });
  assert.equal(opened, 1);
});

test("saved reactivity never starts desktop capture until the music control is explicitly used", () => {
  let captures = 0;
  const state = { active: true, reactive: true, captureArmed: false, audioSource: "desktop", inputGeneration: 0, inputError: null, audio: {}, bands: {} };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: {}, state, el: {}, noMotion: () => false, writeStore() {}, ensureAudio() {}, navigator: { mediaDevices: { getDisplayMedia: () => { captures += 1; return new Promise(() => {}); } } } });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  env.useReactiveInput();
  assert.equal(captures, 0);
  env.setMusicReactive(true);
  assert.equal(captures, 1);
  env.releaseReactiveInput();
  env.useReactiveInput();
  assert.equal(captures, 1, "leaving or disconnecting must not re-arm OS capture");
});

test("Spotify switches and removing the last track disconnect local analysis without starting capture", () => {
  let captures = 0;
  const player = { source: "local", title: "Fixture", queueLength: 1, playing: false };
  const element = { currentSrc: "blob:fixture-track", src: "blob:fixture-track" };
  const disconnected = [];
  const sourceNode = { connect() {}, disconnect: (node) => disconnected.push(node) };
  const state = {
    active: true, reactive: true, captureArmed: false, audioSource: "desktop", inputGeneration: 0, inputError: null,
    audio: { createMediaElementSource: () => sourceNode, createAnalyser: () => ({ connect() {} }), destination: {} },
    mediaElements: new WeakMap(), bus: { disconnect() {}, connect() {} }, bands: {}, nodes: [],
  };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: { MefiMusic: { status: () => player, getAudioElement: () => element } }, state, el: {}, noMotion: () => false, writeStore() {}, ensureAudio() {}, refreshGraph() {}, navigator: { mediaDevices: { getDisplayMedia: () => { captures += 1; return new Promise(() => {}); } } } });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  vm.runInContext(section("function musicNodeDetails()", "// Open/active tasks"), env);
  env.syncMusicNode();
  assert.ok(state.localAudio);
  const analyser = state.localAudio.analyser;
  state.music = { energy: 0.8, beat: 0.5 };
  player.source = "spotify";
  env.syncMusicNode();
  assert.equal(state.localAudio, null);
  assert.equal(state.music, null);
  assert.equal(captures, 0);
  assert.equal(disconnected[0], analyser);
  player.source = "local";
  env.syncMusicNode();
  assert.ok(state.localAudio, "returning to a loaded local track can reconnect directly");
  player.queueLength = 0;
  element.src = ""; // currentSrc can lag removal until the next media event.
  env.syncMusicNode();
  assert.equal(state.localAudio, null);
  assert.equal(state.music, null);
  assert.equal(captures, 0);
});

test("reduced motion keeps music meter levels static while retaining truthful audio status", () => {
  const levels = {};
  const state = { reactive: true, audioSource: "desktop", localAudio: {}, inputError: null, inputPending: null, music: { energy: 0.9 }, bands: { bass: 0.9, mid: 0.6, treble: 0.7 } };
  const el = {
    musicStatus: { textContent: "" },
    musicLevel: { style: { setProperty: (name, value) => { levels[name] = value; } }, children: [0, 1, 2].map((index) => ({ style: { setProperty: (_name, value) => { levels[index] = value; } } })) },
  };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, window: {}, state, el, noMotion: () => true });
  vm.runInContext(section("function renderMusicStatus(", "function bell("), env);
  env.renderMusicStatus(true);
  assert.equal(el.musicStatus.textContent, "Track linked");
  assert.deepEqual(levels, { 0: "0", 1: "0", 2: "0", "--music-level": "0" });
});

function followContext() {
  const taskA = { id: "task:a", kind: "task", task: { id: "a", title: "Build garden", status: "active" }, x: 80, y: 60, z: 20 };
  const taskB = { id: "task:b", kind: "task", task: { id: "b", title: "Test forecast", status: "active" }, x: -90, y: 80, z: -30 };
  const sessionA = { id: "sa", kind: "session", label: "Worker A", x: 20, y: 0, z: 0 };
  const sessionB = { id: "sb", kind: "session", label: "Worker B", x: -50, y: 0, z: 0 };
  const todo = { id: "todo:a", kind: "todo", sessionId: "sa", label: "Editing flower styles", status: "in_progress", x: 30, y: 34, z: 10 };
  const nodes = [taskA, taskB, sessionA, sessionB, todo, { id: "maintenance", kind: "session", label: "Watcher housekeeping", x: 300, y: 0, z: 0 }];
  const jobs = [{ taskId: "a", sessionId: "sa", title: "Build garden", startedAt: 100 }, { taskId: "b", sessionId: "sb", title: "Test forecast", startedAt: 200 }];
  const touches = new Map([["sa", { at: 2000 }], ["sb", { at: 1000 }], ["maintenance", { at: 10000 }]]);
  const state = { active: true, camMode: "follow", nodes, touches, completedTaskIds: new Set(), assistant: { running: jobs }, follow: null, followReadAt: 0, followZoomTarget: null, camera: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }, fit: 1, zoom: 1, view: "3d", angle: 0.5, pitch: 0 };
  const env = vm.createContext({ Date, Math, Number, String, Boolean, Set, Map, state, el: {}, autopilotJobs: (assistant) => assistant.running, noMotion: () => false, usableArea: () => ({ x: 300, y: 150, w: 750, h: 500 }), renderHint() {}, setZoom: (value) => { state.zoom = value; } });
  vm.runInContext(section("function followCandidates(", "function refreshAssistantCache()"), env);
  return { env, state, nodes, jobs, touches, taskA, taskB };
}

test("Follow targets workers' tasks before sessions and ignores unrelated maintenance activity", () => {
  const { env, nodes, jobs, touches } = followContext();
  const candidates = env.followCandidates(nodes, jobs, touches, 10000);
  assert.deepEqual(Array.from(candidates, (candidate) => candidate.key), ["task:a", "task:b"]);
  assert.deepEqual(Array.from(candidates[0].context, (node) => node.id), ["task:a", "sa", "todo:a"]);
  assert.equal(candidates[0].stage, "Editing flower styles");
  assert.equal(candidates[0].activityAt, 2000);
});

test("Follow holds a task long enough to read, follows new work, and rotates parallel workers on a calm dwell", () => {
  const { env, nodes, jobs, touches } = followContext();
  let candidates = env.followCandidates(nodes, jobs, touches, 10000);
  const first = env.chooseFollowTarget(candidates, null, 10000);
  touches.set("sb", { at: 12000 });
  candidates = env.followCandidates(nodes, jobs, touches, 12000);
  assert.equal(env.chooseFollowTarget(candidates, first, 12000).key, "task:a");
  const changed = env.chooseFollowTarget(candidates, first, 18001);
  assert.equal(changed.key, "task:b");
  assert.equal(changed.reason, "Latest work activity");
  const rotated = env.chooseFollowTarget(candidates, changed, 36002);
  assert.equal(rotated.key, "task:a");
  assert.equal(rotated.reason, "Next active worker");
  assert.equal(env.chooseFollowTarget(candidates, changed, 36002, { reducedMotion: true }).key, "task:b");
});

test("completed followed tasks move immediately to the next actual worker, including a stale running-list entry", () => {
  const { env, nodes, jobs, touches } = followContext();
  const first = env.chooseFollowTarget(env.followCandidates(nodes, jobs, touches, 10000), null, 10000);
  const withoutCompletedNode = nodes.filter((node) => node.id !== "task:a");
  const candidates = env.followCandidates(withoutCompletedNode, jobs, touches, 10100, new Set(["a"]));
  const next = env.chooseFollowTarget(candidates, first, 10100);
  assert.equal(next.key, "task:b");
  assert.equal(next.reason, "Next active task");
  assert.equal(env.chooseFollowTarget([], next, 10200), null);
});

test("Follow frames meaningful task context without zoom jitter from orbiting builders", () => {
  const { env, state, nodes, jobs, touches } = followContext();
  const worker = { id: "builder:a", kind: "agent", builder: true, job: jobs[0], x: 800, y: 900, z: 800 };
  nodes.push(worker);
  const target = env.followCandidates(nodes, jobs, touches, 10000)[0];
  const area = { w: 750, h: 500 };
  const before = env.followFrame(target, area, state);
  worker.x = -900; worker.y = -700; worker.z = -900;
  const after = env.followFrame(env.followCandidates(nodes, jobs, touches, 10300)[0], area, state);
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
  assert.ok(before.zoom > 1 && before.zoom <= 2.35);
  assert.ok(before.x < 0 && before.y < 0, "the camera follows the working branch, not the world origin");
});

test("Follow updates use eased targets, respect manual control, and snap only for reduced motion", () => {
  const { env, state } = followContext();
  env.updateFollowCamera(10000, true);
  assert.equal(state.follow.key, "task:a");
  assert.equal(state.camera.x, 0, "the normal view must ease rather than teleport");
  assert.notEqual(state.camera.tx, 0);
  const snapshot = JSON.stringify(state.camera);
  state.camMode = "free";
  state.touches.set("sb", { at: 50000 });
  env.updateFollowCamera(50000, true);
  assert.equal(JSON.stringify(state.camera), snapshot, "manual view remains in control");
  state.camMode = "follow";
  env.noMotion = () => true;
  env.updateFollowCamera(50001, true);
  assert.equal(state.camera.x, state.camera.tx);
  assert.equal(state.camera.y, state.camera.ty);
  assert.equal(state.zoom, state.followZoomTarget);
});

test("a quiet board holds position and Follow prioritizes an explicitly selected active task", () => {
  const { env, nodes, jobs } = followContext();
  assert.equal(env.followCandidates(nodes, [], new Map(), 10000).length, 0);
  const candidates = env.followCandidates(nodes, jobs, new Map(), 10000);
  assert.equal(env.chooseFollowTarget(candidates, null, 10000, { preferredId: "task:b" }).key, "task:b");
});

test("Follow can refit its task and session after a narrower viewport and expanded chat", () => {
  const { env, state, el } = graphContext();
  const task = { id: "task:a", kind: "task", x: 300, y: 120, z: 160 };
  const session = { id: "session:a", kind: "session", x: -80, y: 0, z: -80 };
  const target = { node: task, context: [task, session] };
  Object.assign(state, { camMode: "follow", view: "3d", fit: 2, zoom: 2.3, nodes: [task, session] });
  vm.runInContext(section("function followFrame(", "function updateFollowCamera("), env);
  const oldFit = state.fit;
  el.width = 1100;
  el.height = 720;
  el.top = box(24, 20, 1052, 100);
  el.bottom = box(200, 646, 700, 54);
  el.feed = box(24, 140, 320, 500);
  el.chatLog = box(776, 140, 300, 500);
  state.chatLogOpen = true;
  state.graphAreaAt = 0;
  env.autoFit();
  assert.ok(state.fit < oldFit, "the base fit must shrink along with the graph's available space");
  const area = env.usableArea();
  const frame = env.followFrame(target, area, state);
  state.camera = { x: frame.x, y: frame.y, z: frame.z };
  state.zoom = frame.zoom;
  for (const node of target.context) {
    const p = env.project(node);
    assert.ok(p.x > area.x && p.x < area.x + area.w, `${node.id} stays inside the horizontal clear area`);
    assert.ok(p.y > area.y && p.y < area.y + area.h, `${node.id} stays inside the vertical clear area`);
  }
});
