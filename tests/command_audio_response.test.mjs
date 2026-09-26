import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
function environment(state = {}) {
  const writes = [];
  const env = vm.createContext({
    state, writes, renderMusicStatus() {}, writeStore: (...args) => writes.push(args),
    emphasis: () => 1, rgba: (tint, alpha) => ({ tint, alpha }),
    colorOf: () => [220, 180, 110], NODE_RGB: {
      task: [160, 170, 190], warm: [230, 180, 100],
      pending: [190, 120, 220], session: [100, 200, 240],
    },
    isBusyNode: (node, runningIds) => runningIds.has(node.id), agentRgb: () => [120, 180, 240],
  });
  const start = source.indexOf("  function normalizeAudioPreferences(");
  const end = source.indexOf("  function drawFrame(", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(source.slice(start, end), env);
  return env;
}

function preferences(stored = new Map()) {
  const state = {}, env = environment(state);
  env.readStore = (key) => stored.get(key) ?? null;
  env.writeStore = (key, value) => { stored.set(key, value); env.writes.push([key, value]); };
  const { response, ...effects } = env.readAudioPreferences();
  Object.assign(state, { audioResponse: response, audioEffects: effects });
  return { env, state, stored };
}

function frameInputs(env) {
  const start = source.indexOf("  function drawFrame("), end = source.indexOf("    const graphArea = usableArea();", start);
  assert.ok(start > 0 && end > start);
  env.noMotion = () => false;
  env.audioEnergy = () => 0.8;
  env.workPinIds = () => new Set();
  vm.runInContext(`${source.slice(start, end)} return { audioLinked, audioNodes, visualMusic, backgroundLinked, energy, musicBands, musicBeat }; }`, env);
  return () => env.drawFrame(200);
}

function recordingContext() {
  const strokes = [];
  let path = [];
  return {
    strokes,
    save() {}, restore() {}, fill() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() { path = []; },
    moveTo: (x, y) => path.push({ type: "move", x, y }),
    lineTo: (x, y) => path.push({ type: "line", x, y }),
    bezierCurveTo: (...values) => path.push({ type: "bezier", values }),
    arc: (...values) => path.push({ type: "arc", values }),
    stroke() { strokes.push({ path: structuredClone(path), color: this.strokeStyle, width: this.lineWidth }); },
  };
}

const plainPoints = (wave) => Array.from(wave.points, ({ x, y }) => ({ x, y }));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const waveform = (phase = 0) => Array.from({ length: 64 }, (_, index) => Math.sin(index / 64 * Math.PI * 6 + phase));
const fullMusic = () => ({ bass: 0.8, bassline: 0.8, mid: 0.65, treble: 0.6, kick: 0.7, snare: 0.55, hat: 0.45, waveform: waveform() });

function graphFixture(nodeLayout = "constellation") {
  const nodes = [
    { id: "hub", kind: "assistant", label: "Assistant", x: 0, y: 0, z: 0 },
    { id: "task:first", kind: "task", label: "First task", state: "running", x: 100, y: 100, z: 0 },
    { id: "task:second", kind: "task", label: "Second task", state: "open", x: 300, y: 100, z: 0 },
    { id: "agent:worker", kind: "agent", role: "worker", status: "running", targetId: "task:first", x: 150, y: 130, z: 0 },
    { id: "music", kind: "music", label: "Local track", x: -100, y: 0, z: 0 },
  ];
  const state = {
    nodes, nodeLayout, audioResponse: 1, music: fullMusic(),
    edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 0, b: 3 }],
    branchParents: new Map([[nodes[1].id, nodes[0].id], [nodes[2].id, nodes[0].id]]),
    agentLayout: new Map([[nodes[3].id, { hostId: nodes[1].id }]]),
  };
  return { state, env: environment(state), projected: nodes.map(node => ({ node, p: { x: node.x + 200, y: node.y + 100 } })) };
}

test("audio preferences start gently and normalize malformed saved controls", () => {
  const defaults = { response: 0.35, waves: true, nodes: true, percussion: false, background: false, splitBands: true, motion: true };
  for (const raw of [undefined, "broken json", "null", "[]", "42", '"loud"']) {
    const f = preferences(new Map([["mefiStudio.audioVisuals.v1", raw]]));
    assert.deepEqual({ response: f.state.audioResponse, ...f.state.audioEffects }, defaults);
  }
  for (const [saved, expected] of [
    [{ response: 0, waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false }, { response: 0, waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false }],
    [{ response: 100, waves: "false", nodes: 0, percussion: "true", background: 1, splitBands: "false", motion: "false" }, { ...defaults, response: 2 }],
    [{ response: -4, waves: false }, { ...defaults, response: 0, waves: false }],
    [{ response: "1.8", unrelated: true }, defaults],
  ]) {
    const f = preferences(new Map([["mefiStudio.audioVisuals.v1", JSON.stringify(saved)]]));
    assert.deepEqual({ response: f.state.audioResponse, ...f.state.audioEffects }, expected);
  }
});

test("legacy response becomes gentler once, while new choices and zero survive reload", () => {
  for (const [legacy, expected] of [["1", 0.35], ["2", 0.7], ["0", 0], ["-1", 0], ["100", 0.7], ["", 0.35], ["nope", 0.35]]) {
    const f = preferences(new Map([["mefiStudio.audioResponse", legacy]]));
    assert.equal(f.state.audioResponse, expected);
    f.env.setAudioEffects({ waves: false });
    assert.equal(preferences(f.stored).state.audioResponse, expected, "saving an effect does not apply the migration again");
  }
  const f = preferences(new Map([["mefiStudio.audioResponse", "2"]]));
  f.env.setAudioResponse(1.25);
  f.env.setAudioEffects({ waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false });
  let reloaded = preferences(f.stored);
  assert.equal(reloaded.state.audioResponse, 1.25);
  assert.deepEqual(reloaded.state.audioEffects, { waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false });
  reloaded.state.audioWaves = [{ from: "old" }];
  reloaded.env.setAudioResponse(0);
  assert.equal(reloaded.state.audioWaves.length, 0);
  reloaded = preferences(reloaded.stored);
  assert.equal(reloaded.state.audioResponse, 0, "zero is a saved setting, not a missing value");
  assert.equal(reloaded.env.nodeAudioResponse({ kind: "music" }, fullMusic(), true, reloaded.state.audioResponse).level, 0);
});

test("effect changes save independently and preserve connected audio and playback", () => {
  const f = preferences();
  const unexpected = () => assert.fail("a visual preference cannot reconnect, stop, or play audio");
  const localAudio = { paused: false, play: unexpected, pause: unexpected };
  const inputStream = { getTracks: () => [{ stop: unexpected }] };
  const inputSource = { disconnect: unexpected };
  const pending = Promise.resolve();
  Object.assign(f.state, { reactive: true, localAudio, inputStream, inputSource, inputPending: pending, inputGeneration: 17, audioSource: "local", captureArmed: true });
  Object.assign(f.env, { useReactiveInput: unexpected, stopReactiveInput: unexpected, ensureAudio: unexpected });
  const before = { ...f.state };
  f.env.setAudioEffects({ nodes: false, percussion: true });
  assert.deepEqual({ ...f.state.audioEffects }, { waves: true, nodes: false, percussion: true, background: false, splitBands: true, motion: true });
  f.state.audioWaves = [{ from: "previous frame" }];
  f.env.setAudioEffects({ waves: false, background: true, splitBands: false, motion: false });
  assert.equal(f.state.audioWaves.length, 0, "switching off waves releases their last frame immediately");
  f.env.setAudioEffects({ waves: "yes", nodes: 1, splitBands: 1, motion: "on", response: 2, unexpected: true });
  f.env.setAudioEffects(null);
  f.env.setAudioResponse(0.2);
  assert.deepEqual({ ...f.state.audioEffects }, { waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false });
  const saved = JSON.parse(f.stored.get("mefiStudio.audioVisuals.v1"));
  assert.deepEqual(saved, { response: 0.2, waves: false, nodes: false, percussion: true, background: true, splitBands: false, motion: false });
  for (const key of ["reactive", "localAudio", "inputStream", "inputSource", "inputPending", "inputGeneration", "audioSource", "captureArmed"]) assert.equal(f.state[key], before[key], key);
  assert.equal(localAudio.paused, false);
});

test("connection waves and node lighting can each run alone or both be switched off", () => {
  const { state, env, projected } = graphFixture();
  Object.assign(state, { reactive: true, localAudio: {}, audioResponse: 0.35 });
  const inputs = frameInputs(env);
  for (const waves of [false, true]) {
    for (const nodes of [false, true]) {
      env.setAudioEffects({ waves, nodes });
      const frame = inputs();
      const node = projected[0].node, ctx = recordingContext();
      const response = env.nodeAudioResponse(node, frame.visualMusic, frame.audioNodes, state.audioResponse);
      env.drawNodeAudio(ctx, node, projected[0].p, 12, [200, 180, 120], response, frame.audioNodes ? frame.visualMusic : null, 200);
      env.drawGraphConnections(recordingContext(), projected, new Set(), frame.audioLinked, 200);
      assert.equal(ctx.strokes.length > 0, nodes, `nodes=${nodes}, waves=${waves}`);
      assert.equal(state.audioWaves.length > 0, waves, `nodes=${nodes}, waves=${waves}`);
      assert.equal(state.reactive, true, "the master audio link remains connected");
    }
  }
  env.setAudioResponse(0);
  const frame = inputs();
  assert.equal(frame.audioNodes, false);
  env.drawGraphConnections(recordingContext(), projected, new Set(), frame.audioLinked, 200);
  assert.equal(state.audioWaves.length, 0);
});

test("tree reaction modes gate node, connection and background music without disconnecting the input", () => {
  const { state, env, projected } = graphFixture();
  Object.assign(state, { reactive: true, localAudio: {}, audioResponse: 1, bands: { bass: .8, mid: .6, treble: .4 } });
  env.setAudioEffects({ waves: true, nodes: true, background: true, percussion: true });
  const inputs = frameInputs(env);
  for (const enabled of [false, true, false]) {
    env.window = { MefiTreeDynamics: { musicEnabled: () => enabled } };
    const frame = inputs();
    assert.equal(frame.audioLinked, enabled); assert.equal(frame.audioNodes, enabled); assert.equal(frame.backgroundLinked, enabled);
    env.drawGraphConnections(recordingContext(), projected, new Set(), frame.audioLinked, 200);
    assert.equal(state.audioWaves.length > 0, enabled);
    assert.equal(state.reactive, true); assert.ok(state.localAudio);
  }
});

test("percussion is optional while sustained bass, mids, treble and waveform remain responsive", () => {
  const env = environment(), music = { ...fullMusic(), beat: 0.9, energy: 0.7 };
  const before = structuredClone(music), calm = env.visualMusicResponse(music, { percussion: false });
  for (const voice of ["kick", "snare", "hat", "beat"]) assert.equal(calm[voice], 0);
  for (const voice of ["bass", "bassline", "mid", "treble", "energy", "waveform"]) assert.equal(calm[voice], music[voice]);
  for (const node of [{ kind: "assistant" }, { kind: "session" }, { kind: "agent" }]) {
    const quiet = env.nodeAudioResponse(node, calm, true, 0.35);
    const drums = env.nodeAudioResponse(node, env.visualMusicResponse(music, { percussion: true }), true, 0.35);
    assert.ok(quiet.level > 0);
    assert.equal(quiet.beat, 0);
    assert.equal(drums.level, quiet.level);
    assert.ok(drums.beat > 0);
  }
  const { state, env: graph, projected } = graphFixture();
  state.music = { kick: 0.9, snare: 0.8, hat: 0.7, beat: 1 };
  graph.setAudioEffects({ percussion: false });
  graph.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  assert.equal(state.audioWaves.length, 0);
  graph.setAudioEffects({ percussion: true });
  graph.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  assert.ok(state.audioWaves.length > 0);
  assert.deepEqual(music, before, "visual toggles do not rewrite the analyzer snapshot");
});

test("separate connection voices isolate bass, mids and treble and stay attached after graph reordering", () => {
  const nodes = [{ id: "hub", kind: "assistant" }, ...Array.from({ length: 12 }, (_, index) => ({ id: `task:voice:${index}`, kind: "task", _audioResponse: { level: 1, beat: 1 } }))];
  const state = { nodes, audioResponse: 0.35, edges: nodes.slice(1).map((_, index) => ({ a: 0, b: index + 1 })), music: fullMusic() };
  const env = environment(state);
  const projected = nodes.map((node, index) => ({ node, p: { x: index * 30, y: index % 3 * 50 + 40 } }));
  env.setAudioEffects({ splitBands: true, percussion: true });
  const draw = () => {
    const ctx = recordingContext();
    env.drawGraphConnections(ctx, projected, new Set(), true, 200);
    return ctx;
  };
  draw();
  const voices = new Map(Array.from(state.audioWaves, wave => [wave.to, wave.band]));
  assert.equal(voices.size, 12);
  assert.deepEqual(new Set(voices.values()), new Set(["bass", "mid", "treble"]));
  for (const [band, music] of [
    ["bass", { bassline: 0.8 }], ["mid", { mid: 0.8 }], ["treble", { treble: 0.8 }],
    ["bass", { kick: 0.8 }], ["mid", { snare: 0.8 }], ["treble", { hat: 0.8 }],
  ]) {
    state.music = { ...music, waveform: waveform() };
    const quiet = recordingContext();
    env.drawGraphConnections(quiet, projected, new Set(), false, 200);
    const playing = draw();
    const expected = [...voices].filter(([, voice]) => voice === band).map(([id]) => id).sort();
    assert.deepEqual(Array.from(state.audioWaves, wave => wave.to).sort(), expected, `${Object.keys(music)[0]} reaches only its own cables`);
    assert.ok(state.audioWaves.every(wave => wave.band === band && wave.amplitude > 0));
    assert.deepEqual(playing.strokes.filter(stroke => stroke.path.length === 2), quiet.strokes, "other-band node brightness does not leak into a connection's base tether");
    assert.equal(playing.strokes.filter(stroke => stroke.path.length > 2).length, expected.length * 2, "only assigned cables receive painted wave strokes");
  }
  state.music = fullMusic();
  const snapshot = structuredClone(state.music);
  state.nodes.reverse(); projected.reverse();
  const hubIndex = state.nodes.findIndex(node => node.id === "hub");
  state.edges = state.nodes.flatMap((node, index) => index === hubIndex ? [] : [{ a: hubIndex, b: index }]);
  draw();
  assert.deepEqual(new Map(Array.from(state.audioWaves, wave => [wave.to, wave.band])), voices, "voices depend on node identity rather than edge indices");
  assert.deepEqual(state.music, snapshot, "routing leaves the analyzer's shared snapshot intact");
  env.setAudioEffects({ splitBands: false });
  state.music = { mid: 0.8, waveform: waveform() };
  draw();
  assert.equal(state.audioWaves.length, 12, "full mix can intentionally reach every cable");
  assert.ok(state.audioWaves.every(wave => wave.band === "mix"));
  env.setAudioEffects({ splitBands: true, percussion: false });
  state.music = { kick: 1, snare: 1, hat: 1, beat: 1, waveform: waveform() };
  draw();
  assert.equal(state.audioWaves.length, 0, "splitting the bands cannot re-enable disabled drum attacks");
});

test("background response stays off by default and follows its own toggle and response amount", () => {
  const state = { reactive: true, localAudio: {}, bands: { bass: 0.8, mid: 0.6, treble: 0.4 }, music: { ...fullMusic(), beat: 0.9 }, audioResponse: 0.35 };
  const env = environment(state), inputs = frameInputs(env);
  const off = inputs();
  assert.equal(off.energy, 0);
  assert.deepEqual({ ...off.musicBands }, { bass: 0, mid: 0, treble: 0 });
  assert.equal(off.musicBeat, 0);
  env.setAudioEffects({ background: true, waves: false, nodes: false });
  const background = inputs();
  assert.equal(background.energy, 0.8 * 0.35);
  assert.equal(background.musicBands.mid, 0.6 * 0.35);
  assert.equal(background.musicBeat, 0, "background does not enable drum flashes by itself");
  env.setAudioEffects({ percussion: true });
  assert.equal(inputs().musicBeat, 0.9 * 0.35);
  env.setAudioResponse(0);
  assert.equal(inputs().energy, 0);
  assert.equal(inputs().musicBeat, 0);
  env.setAudioResponse(1);
  env.noMotion = () => true;
  const still = inputs();
  assert.equal(still.energy, 0);
  assert.equal(still.musicBeat, 0);
  assert.deepEqual({ ...still.musicBands }, { bass: 0, mid: 0, treble: 0 });
  env.noMotion = () => false;
  for (const connection of [{ reactive: false, localAudio: {} }, { reactive: true, localAudio: null }]) {
    Object.assign(state, connection);
    const disconnected = inputs();
    assert.equal(disconnected.energy, 0, "the master link also gates background motion");
    assert.equal(disconnected.musicBeat, 0);
    assert.deepEqual({ ...disconnected.musicBands }, { bass: 0, mid: 0, treble: 0 });
  }
});

test("the default connection response stays subtle and travels slowly between frames", () => {
  const f = preferences(), a = { x: 0, y: 0 }, b = { x: 400, y: 0 };
  const music = f.env.visualMusicResponse(fullMusic(), f.state.audioEffects);
  const gentle = f.env.audioConnectionWave(a, b, music, f.state.audioResponse, 200);
  const full = f.env.audioConnectionWave(a, b, music, 1, 200);
  assert.ok(gentle.amplitude > 0.1 && gentle.amplitude <= 4.2, `default displacement ${gentle.amplitude}px`);
  assert.ok(gentle.amplitude < full.amplitude * 0.4);
  assert.ok(gentle.activity < full.activity * 0.4, "lower response also lowers connection brightness");
  const first = f.env.audioConnectionWave(a, b, { bassline: 1 }, 1, 200);
  const later = f.env.audioConnectionWave(a, b, { bassline: 1 }, 1, 300);
  const travel = Math.max(...first.points.map((point, index) => distance(point, later.points[index])));
  assert.ok(travel > 0.1 && travel < 2, `bass moves ${travel}px over 100ms`);
});

test("low response also softens optional drum flashes and stroke thickness", () => {
  const state = { audioEffects: { percussion: true, splitBands: false }, music: { kick: 1, snare: 1, hat: 1 }, audioWaves: [] };
  const env = environment(state);
  const a = { node: { id: "hub" }, p: { x: 0, y: 0 } }, b = { node: { id: "task" }, p: { x: 400, y: 0 } };
  const draw = (response) => {
    state.audioResponse = response;
    const ctx = recordingContext();
    env.drawAudioConnection(ctx, a, b, [230, 180, 100], 1, 200);
    return ctx.strokes;
  };
  const loud = draw(1)[1];
  for (const response of [0.35, 0.1, 0.01]) {
    const quiet = draw(response)[1];
    assert.ok(quiet.color.alpha <= loud.color.alpha * response * 1.01, `drum brightness follows response ${response}`);
    assert.ok(quiet.width < loud.width, "quiet settings also soften the drum's outline");
  }
  assert.equal(draw(0).length, 0);
});

test("frequency voices stay attached to nodes across reordering and all bands affect quiet work", () => {
  const env = environment();
  const nodes = [
    { id: "hub", kind: "assistant" }, { id: "session", kind: "session" },
    { id: "todo", kind: "todo" }, { id: "worker", kind: "agent" },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `task:${index}`, kind: "task", state: "open" })),
  ];
  const voices = new Map(nodes.map(node => [node.id, env.nodeAudioResponse(node, {}, true).band]));
  assert.equal(new Set(nodes.filter(node => node.kind === "task").map(node => voices.get(node.id))).size, 3);
  for (const node of nodes.reverse()) {
    for (const band of ["bass", "mid", "treble"]) {
      const result = env.nodeAudioResponse(node, { [band]: 0.8 }, true, 1);
      assert.equal(result.band, voices.get(node.id));
      assert.equal(result.level > 0.5, band === voices.get(node.id));
    }
    assert.equal(node.state === "active", false, "music never marks work active");
  }
});

test("silence and disabled/reduced-motion response stay dark; sensitivity is bounded and saved", () => {
  const state = {}, env = environment(state), node = { id: "music", kind: "music" };
  const loud = { bass: 1, mid: 1, treble: 1, beat: 1, energy: 1 };
  for (const [music, enabled] of [[{}, true], [loud, false]]) {
    const response = env.nodeAudioResponse(node, music, enabled);
    assert.equal(response.level, 0); assert.equal(response.beat, 0);
  }
  const quiet = { bass: 0.2, energy: 0.1, beat: 0.15 };
  assert.ok(env.nodeAudioResponse(node, quiet, true, 2).level > env.nodeAudioResponse(node, quiet, true, 0.25).level * 3);
  for (const strength of [0.25, 1, 2, 100]) {
    const response = env.nodeAudioResponse(node, loud, true, strength);
    assert.ok(response.level >= 0 && response.level <= 1);
    assert.ok(response.beat >= 0 && response.beat <= 1);
  }
  env.setAudioResponse(100); assert.equal(state.audioResponse, 2);
  env.setAudioResponse(-1); assert.equal(state.audioResponse, 0);
  env.setAudioResponse(NaN); assert.equal(state.audioResponse, 0);
  assert.equal(env.writes.length, 2);
});

test("music light stays inside each node and graph links retain their endpoints and work tint", () => {
  const a = { id: "hub", kind: "assistant" }, b = { id: "task", kind: "task", _audioResponse: { level: 0.8, beat: 0.5 } };
  const state = { nodes: [a, b], edges: [{ a: 0, b: 1 }], branchParents: new Map([[b.id, a.id]]), audioEffects: { splitBands: false } };
  const env = environment(state), arcs = [], strokes = [], points = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {},
    arc: (...args) => arcs.push(args),
    createRadialGradient: () => ({ addColorStop() {} }),
    moveTo: (...args) => points.push(args), lineTo: (...args) => points.push(args),
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
  };
  const projected = [{ node: a, p: { x: 10, y: 30 } }, { node: b, p: { x: 100, y: 130 } }];
  const before = structuredClone(projected);
  env.drawNodeAudio(ctx, b, projected[1].p, 11, [100, 150, 200], { level: 1, beat: 1 });
  assert.ok(arcs.length > 0 && arcs.every(([x, y, radius]) => x === 100 && y === 130 && radius <= 11));
  strokes.length = 0;
  env.drawGraphConnections(ctx, projected, new Set(), false);
  const quiet = strokes.pop();
  env.drawGraphConnections(ctx, projected, new Set(), true);
  const musical = strokes.pop();
  assert.ok(musical.color.alpha > quiet.color.alpha && musical.width > quiet.width);
  assert.deepEqual(musical.color.tint, quiet.color.tint);
  assert.deepEqual(points.slice(0, 2), points.slice(2));
  assert.deepEqual(projected, before, "audio cannot move anchors, change labels or assign a work state");
});

test("bass lines, mids, highs and each drum attack bend and animate the actual connection path", () => {
  const env = environment(), a = { x: 20, y: 90 }, b = { x: 420, y: 90 };
  const shapes = [];
  for (const voice of ["bassline", "mid", "treble", "kick", "snare", "hat"]) {
    const music = { [voice]: 0.8 };
    const first = env.audioConnectionWave(a, b, music, 1, 120, false, 0.4);
    const later = env.audioConnectionWave(a, b, music, 1, 360, false, 0.4);
    assert.ok(first && later, `${voice} works without bass energy or a global beat`);
    assert.ok(first.points.some(point => Math.abs(point.y - a.y) > 0.5), `${voice} produces visible displacement`);
    assert.ok(first.points.some((point, index) => distance(point, later.points[index]) > 0.5), `${voice} travels between frames`);
    assert.deepEqual(plainPoints(first).at(0), a);
    assert.deepEqual(plainPoints(first).at(-1), b);
    shapes.push(plainPoints(first));
  }
  for (let index = 1; index < shapes.length; index += 1) {
    assert.notDeepEqual(shapes[index], shapes[index - 1], "frequency and drum voices do not collapse to one common pulse");
  }
  assert.deepEqual(plainPoints(env.audioConnectionWave(a, b, { bass: 0.8 }, 1, 120, false, 0.4)), shapes[0], "bass-only snapshots retain the bass-line voice");
});

test("the measured waveform changes connection and node contours while staying inside the node", () => {
  const env = environment(), a = { x: 50, y: 70 }, b = { x: 390, y: 250 };
  const firstMusic = { ...fullMusic(), waveform: waveform(0) };
  const secondMusic = { ...firstMusic, waveform: waveform(Math.PI) };
  const first = env.audioConnectionWave(a, b, firstMusic, 1, 600, true);
  const second = env.audioConnectionWave(a, b, secondMusic, 1, 600, true);
  assert.ok(first.points.some((point, index) => distance(point, second.points[index]) > 1), "sample data changes geometry at the same time and band levels");
  const node = { id: "task:contour", kind: "task", state: "open" }, p = { x: 200, y: 180 }, radius = 14;
  const before = structuredClone(node), contours = [];
  for (const band of ["bass", "mid", "treble"]) {
    for (const music of [firstMusic, secondMusic]) {
      const ctx = recordingContext();
      env.drawNodeAudio(ctx, node, p, radius, [180, 190, 210], { band, level: 0.9, beat: 0.8 }, music, 600);
      const contour = ctx.strokes.find(stroke => stroke.path.length > 2).path;
      assert.ok(contour.every(point => distance(point, p) < radius), "the waveform preserves the status rim");
      assert.ok(distance(contour[0], contour.at(-1)) < 1e-9, "the orb contour closes without a seam");
      contours.push(contour);
    }
    assert.notDeepEqual(contours.at(-2), contours.at(-1), `${band} contour consumes the live waveform`);
  }
  assert.notDeepEqual(contours[0], contours[2], "midrange attacks produce a different contour from bass");
  assert.notDeepEqual(contours[2], contours[4], "high attacks produce a different contour from midrange");
  assert.deepEqual(node, before);
});

test("linear and branch waves pin endpoints with finite, bounded geometry at awkward lengths", () => {
  const env = environment(), music = fullMusic();
  const pairs = [
    [{ x: 10, y: 30 }, { x: 10, y: 430 }],
    [{ x: 410, y: 430 }, { x: 10, y: 30 }],
    [{ x: -200, y: 30 }, { x: 410, y: 30 }],
    [{ x: 10, y: 30 }, { x: 14, y: 30 }],
    [{ x: 10, y: 30 }, { x: 10.01, y: 30.01 }],
    [{ x: 10, y: 30 }, { x: 10, y: 30 }],
  ];
  for (const [a, b] of pairs) {
    for (const curved of [false, true]) {
      const wave = env.audioConnectionWave(a, b, music, 2, 200, curved);
      if (distance(a, b) < 4) {
        assert.equal(wave, null, "tiny and coincident anchors do not produce unstable waves");
        continue;
      }
      assert.deepEqual(plainPoints(wave)[0], a);
      assert.deepEqual(plainPoints(wave).at(-1), b);
      assert.ok(wave.points.length <= 57, "long links retain a fixed vertex budget");
      const limit = Math.min(22, distance(a, b) * 0.11) * 2;
      for (const [index, point] of wave.points.entries()) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        const t = index / (wave.points.length - 1), u = 1 - t;
        const middle = (a.y + b.y) / 2;
        const base = curved ? {
          x: u ** 3 * a.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * b.x,
          y: u ** 3 * a.y + 3 * u ** 2 * t * middle + 3 * u * t ** 2 * middle + t ** 3 * b.y,
        } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        assert.ok(distance(point, base) <= limit + 1e-9, "displacement is bounded around the real straight or Bezier tether");
      }
    }
  }
  const [a, b] = pairs[1];
  assert.deepEqual(plainPoints(env.audioConnectionWave(a, b, music, 100, 200)), plainPoints(env.audioConnectionWave(a, b, music, 2, 200)));
  assert.equal(env.audioConnectionWave(a, b, music, -100, 200), null);
  assert.equal(env.audioConnectionWave(a, b, music, 0, 200), null);
  assert.ok(env.audioConnectionWave(a, b, music, 2, 200).amplitude > env.audioConnectionWave(a, b, music, 0.25, 200).amplitude * 4);
});

test("playing waves preserve work links, status tint, assignments and anchors in straight and branch layouts", () => {
  for (const layout of ["constellation", "tree", "layers"]) {
    const { state, env, projected } = graphFixture(layout), runningIds = new Set(["task:first"]);
    const before = structuredClone({ nodes: state.nodes, edges: state.edges, branchParents: state.branchParents, agentLayout: state.agentLayout, projected });
    const quiet = recordingContext(), playing = recordingContext();
    env.drawGraphConnections(quiet, projected, runningIds, false, 100);
    env.drawGraphConnections(playing, projected, runningIds, true, 100);
    const workStrokes = playing.strokes.filter(stroke => stroke.path.length === 2);
    assert.deepEqual(workStrokes, quiet.strokes, "the original work tethers and their status tint remain underneath the wave");
    assert.deepEqual({ nodes: state.nodes, edges: state.edges, branchParents: state.branchParents, agentLayout: state.agentLayout, projected }, before);
    const waves = Array.from(state.audioWaves, wave => ({ from: wave.from, to: wave.to, source: wave.sourceLink }));
    assert.deepEqual(waves, [
      { from: "hub", to: "task:first", source: false },
      { from: "hub", to: "task:second", source: false },
      { from: "agent:worker", to: "task:first", source: false },
      { from: "music", to: "hub", source: true },
    ]);
    assert.equal(state.edges.some(edge => state.nodes[edge.a].kind === "music" || state.nodes[edge.b].kind === "music"), false, "the source cable cannot become a task dependency");
    for (const wave of state.audioWaves) {
      const from = projected.find(entry => entry.node.id === wave.from).p;
      const to = projected.find(entry => entry.node.id === wave.to).p;
      assert.deepEqual(plainPoints(wave)[0], from);
      assert.deepEqual(plainPoints(wave).at(-1), to);
    }
    const paintedWaves = playing.strokes.filter(stroke => stroke.path.length > 2);
    assert.equal(paintedWaves.length, state.audioWaves.length * 2);
    state.audioWaves.forEach((wave, index) => {
      for (const stroke of paintedWaves.slice(index * 2, index * 2 + 2)) {
        assert.deepEqual(stroke.path.map(({ x, y }) => ({ x, y })), plainPoints(wave), "both visible wave strokes paint the sampled geometry");
      }
    });
  }
});

test("silence and disabled audio clear rendered waves without leaving a previous frame behind", () => {
  const { state, env, projected } = graphFixture();
  const play = () => env.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  play(); assert.ok(state.audioWaves.length > 0);
  const quietMusic = { waveform: waveform(), bass: 0, mid: 0, treble: 0, kick: 0, snare: 0, hat: 0, energy: 0 };
  state.music = quietMusic;
  const silence = recordingContext();
  env.drawGraphConnections(silence, projected, new Set(), true, 250);
  assert.equal(state.audioWaves.length, 0, "stale waveform samples alone cannot animate silence");
  assert.ok(silence.strokes.every(stroke => stroke.path.length === 2));
  state.music = fullMusic(); play(); assert.ok(state.audioWaves.length > 0);
  const disabled = recordingContext();
  env.drawGraphConnections(disabled, projected, new Set(), false, 300);
  assert.equal(state.audioWaves.length, 0);
  assert.ok(disabled.strokes.every(stroke => stroke.path.length === 2));
});

test("the draw-frame audio gate disables all wave links for reduced motion and disconnected sources", () => {
  const { state, env, projected } = graphFixture();
  let still = false;
  env.noMotion = () => still;
  env.audioEnergy = () => 1;
  const start = source.indexOf("  function drawFrame("), end = source.indexOf("    // Nodes the assistant", start);
  assert.ok(start > 0 && end > start);
  // Execute the real frame's input gate, then send its result to the real
  // connection renderer; unrelated camera and DOM work need no mock here.
  vm.runInContext(`${source.slice(start, end)} return audioLinked; }`, env);
  state.reactive = true;
  const cases = [
    { still: false, reactive: true, localAudio: {}, inputStream: null, enabled: true },
    { still: true, reactive: true, localAudio: {}, inputStream: null, enabled: false },
    { still: false, reactive: false, localAudio: {}, inputStream: null, enabled: false },
    { still: false, reactive: true, localAudio: null, inputStream: null, enabled: false },
    { still: false, reactive: true, localAudio: null, inputStream: {}, enabled: true },
  ];
  for (const current of cases) {
    still = current.still;
    Object.assign(state, { reactive: current.reactive, localAudio: current.localAudio, inputStream: current.inputStream });
    const linked = env.drawFrame(200);
    assert.equal(linked, current.enabled);
    env.drawGraphConnections(recordingContext(), projected, new Set(), linked, 200);
    assert.equal(state.audioWaves.length > 0, current.enabled);
  }
});

test("retargeted, fading, absorbed and removed workers leave no old waveform tether", () => {
  const { state, env, projected } = graphFixture();
  const draw = () => env.drawGraphConnections(recordingContext(), projected, new Set(), true, 200);
  const workerWaves = () => Array.from(state.audioWaves).filter(wave => wave.from === "agent:worker" || wave.to === "agent:worker");
  draw(); assert.equal(workerWaves().length, 1);
  state.agentLayout.set("agent:worker", { hostId: "task:second" });
  draw(); assert.equal(workerWaves().length, 1); assert.equal(workerWaves()[0].to, "task:second");
  const worker = projected[3].node;
  worker._fade = 0.01; draw(); assert.equal(workerWaves().length, 0);
  worker._fade = 1; draw(); assert.equal(workerWaves().length, 1);
  worker._absorbed = true; draw(); assert.equal(workerWaves().length, 0);
  worker._absorbed = false; draw(); assert.equal(workerWaves().length, 1);
  // A graph rebuild removes both the worker and its old indexed graph edge.
  state.edges = state.edges.filter(edge => edge.b !== 3);
  state.nodes.splice(3, 1); projected.splice(3, 1); state.agentLayout.delete(worker.id);
  draw(); assert.equal(workerWaves().length, 0);
  projected.find(entry => entry.node.kind === "music").node._fade = 0.01;
  draw(); assert.equal(state.audioWaves.some(wave => wave.sourceLink), false, "a disappearing source cable also releases");
});

test("dense graphs keep wave amplitude, vertices and strokes bounded at maximum response", () => {
  const nodes = Array.from({ length: 257 }, (_, index) => ({ id: `task:${index}`, kind: "task", state: "open" }));
  const state = { nodes, edges: nodes.slice(1).map((_, index) => ({ a: 0, b: index + 1 })), music: fullMusic(), audioResponse: 100 };
  const projected = nodes.map((node, index) => ({ node, p: { x: index * 100, y: index % 7 * 120 } }));
  const env = environment(state), ctx = recordingContext();
  env.drawGraphConnections(ctx, projected, new Set(), true, 400);
  assert.equal(state.audioWaves.length, 256);
  assert.equal(ctx.strokes.length, state.edges.length * 3, "each edge has one work stroke and two waveform strokes");
  assert.ok(state.audioWaves.every(wave => wave.points.length <= 57 && wave.amplitude <= 44 + 1e-9));
  assert.ok(ctx.strokes.every(stroke => stroke.path.length <= 57 && stroke.color.alpha <= 1 && stroke.width <= 5));
  assert.ok(state.audioWaves.every(wave => wave.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
});
