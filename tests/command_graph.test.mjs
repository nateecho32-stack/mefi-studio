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

test("the graph frame scheduler draws and reschedules without undeclared runtime state", () => {
  const drawn = [], scheduled = [], errors = [];
  const state = { active: true };
  const document = { hidden: false, body: { dataset: {} } };
  const env = vm.createContext({ state, document, pickerHeld: () => false, drawFrame: (time) => drawn.push(time), requestAnimationFrame: (callback) => { scheduled.push(callback); return scheduled.length; }, console: { error: (...args) => errors.push(args) } });
  vm.runInContext(section("// Animation state belongs", "function drawFrame("), env);
  env.frame(100); env.frame(110); env.frame(150);
  assert.deepEqual(drawn, [100, 150]);
  assert.equal(scheduled.length, 3);
  assert.equal(errors.length, 0);
  document.body.dataset.sheet = "tasks";
  env.frame(200);
  assert.deepEqual(drawn, [100, 150]);
  assert.equal(scheduled.length, 4, "closing a sheet must still have a next graph frame waiting");
  document.body.dataset.sheet = "music"; state.settingsPreview = { x: 600, y: 0, w: 600, h: 800 };
  env.frame(250);
  assert.deepEqual(drawn, [100, 150, 250], "the actual canvas continues drawing inside Music settings");
  document.body.dataset.sheet = "tasks";
  env.frame(300);
  assert.deepEqual(drawn, [100, 150, 250], "preview permission must not draw through other sheets");
});

test("Music preview uses the requested real-graph viewport and restores the prior view on close", () => {
  const state = { active: false, camera: { x: 10, y: 20, z: 30 }, camMode: "free", fit: 1.2, zoom: 1.4, overviewScale: .7, angle: 0.6, pitch: 0.1, nodeLayout: "constellation", screenLayout: { key: "original" } };
  let enters = 0, exits = 0, fits = 0;
  const env = vm.createContext({ state, Number, Math, Object, enter: () => { enters += 1; state.active = true; }, exit: () => { exits += 1; state.active = false; }, refitLayout: () => { fits += 1; state.camera = { x: 0, y: 0, z: 0 }; state.screenLayout = null; }, syncViewControls() {}, renderHint() {} });
  vm.runInContext(section("function setSettingsPreview(", "function applyTreePreferences("), env);
  const viewport = { x: 520, y: 16, w: 900, h: 800 };
  env.setSettingsPreview(viewport);
  assert.equal(enters, 1); assert.equal(fits, 1); assert.equal(state.camMode, "orbit");
  assert.deepEqual(JSON.parse(JSON.stringify(state.settingsPreview)), viewport);
  env.setSettingsPreview(viewport);
  assert.equal(fits, 1, "unchanged bounds do not keep resetting the node arrangement");
  env.setSettingsPreview(null);
  assert.equal(exits, 1); assert.equal(state.camMode, "free");
  assert.deepEqual(JSON.parse(JSON.stringify(state.camera)), { x: 10, y: 20, z: 30 });
  assert.equal(state.zoom, 1.4); assert.equal(state.screenLayout.key, "original");
  assert.equal(state.overviewScale, .7);
});

test("the complete Command module can enter and draw while preserving the default fixed view", async () => {
  const callbacks = [], draws = [], errors = [];
  const classes = { add() {}, remove() {}, toggle() {}, contains: () => false };
  const document = { readyState: "loading", hidden: false, addEventListener() {}, body: { dataset: {}, classList: classes } };
  const window = { addEventListener() {}, dispatchEvent() {}, __draw: (time) => draws.push(time), __audioRequests: 0 };
  const hook = `window.__graphTest = { state, el, setAmbientZenEnabled, prepare() {
    closeAmbience = resize = renderLegend = syncViewControls = setCamMode = loadPngs = updateTelemetry = renderFeed = renderHint = bumpHud = refreshGraph = selectNode = applyEnterParams = () => {};
    refreshTasks = () => Promise.resolve();
    drawFrame = window.__draw;
    bell = ensureReactiveInput = () => { window.__audioRequests += 1; };
  }};`;
  const saved = new Map();
  const env = vm.createContext({ window, document, Promise, Date, Math, Map, Set, WeakMap, localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, CustomEvent: class { constructor(type, details) { this.type = type; this.detail = details.detail; } }, requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length; }, setInterval: () => 1, console: { error: (...args) => errors.push(args) } });
  const load = () => vm.runInContext(source.replace("  window.MefiIdle = {", `${hook}\n  window.MefiIdle = {`), env);
  load();
  const { state, el, prepare } = window.__graphTest;
  prepare(); state.zen = false;
  el.canvas = { focus() {} }; el.hud = { classList: classes };
  assert.equal(window.MefiIdle.status().orbit, "paused");
  assert.equal(window.MefiIdle.status().ambientZenEnabled, false, "Zen starts disabled without a saved opt-in");
  assert.equal(window.MefiIdle.ambientZenStatus().enabled, false);
  window.MefiIdle.enter(true);
  await state.readyPromise;
  assert.equal(window.MefiIdle.status().orbit, "paused", "enter must not override the fixed default");
  callbacks.shift()(100);
  assert.deepEqual(draws, [100]);
  assert.equal(errors.length, 0);
  state.active = false; state.orbit = "auto";
  window.MefiIdle.enter(true);
  await state.readyPromise;
  assert.equal(state.orbit, "auto", "an explicit user camera choice survives reopening");
  state.active = false; state.zen = true; state.reactive = true; state.settingsPreview = { x: 600, y: 0, w: 600, h: 800 };
  window.MefiIdle.enter(true); await state.readyPromise;
  assert.equal(window.__audioRequests, 0, "opening a settings preview cannot start bells or audio capture");
  window.__graphTest.setAmbientZenEnabled(true);
  load();
  assert.equal(window.MefiIdle.ambientZenStatus().enabled, true, "reloading restores an explicit Zen opt-in");
  window.__graphTest.setAmbientZenEnabled(false);
  load();
  assert.equal(window.MefiIdle.ambientZenStatus().enabled, false, "reloading preserves a disabled Zen preference");
});

test("Music preview refreshes real graph snapshots while other sheets remain idle", () => {
  let reads = 0, popups = 0;
  const state = { active: true, settingsPreview: { x: 600, y: 0, w: 600, h: 800 }, assistant: {}, ambient: true, popupAt: 0 };
  const document = { hidden: false, body: { dataset: { sheet: "tasks" } } };
  const env = vm.createContext({ state, document, Date, POPUP_MS: 1000, pickerHeld: () => false, refreshCommandBacklog: () => { reads += 1; }, refreshGraph: () => { reads += 1; }, checkCollisions() {}, updateTelemetry() {}, autopilotJobs: () => [], chatMode: () => false, renderFeed() {}, popup: () => { popups += 1; } });
  vm.runInContext(section("function tick()", "async function checkCollisions("), env);
  env.tick(); assert.equal(reads, 0);
  document.body.dataset.sheet = "music";
  env.tick(); assert.equal(reads, 2); assert.equal(popups, 0);
  document.hidden = true; env.tick(); assert.equal(reads, 2);
});

function zenContext(enabled = true) {
  const classes = new Set(), writes = [];
  const state = { active: true, ambientZenEnabled: enabled, ambientZen: false, lastInput: 1000, camera: { x: 1, y: 2, z: 3, tx: 1, ty: 2, tz: 3 }, camMode: "follow", orbit: "paused", orbitVel: 0, angle: 0.5, pitch: 0.1, view: "3d", feedCollapsed: false, screenLayout: { key: "stable", nodes: new Map() } };
  const classList = { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: (name) => classes.delete(name) };
  const el = { ambientZen: { checked: enabled }, hud: { classList, inert: false }, feed: { classList }, feedContent: { hidden: false }, feedToggle: { attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } } };
  const document = { hidden: false, body: { dataset: {}, classList }, activeElement: null, querySelectorAll: () => [] };
  const window = { MefiNav: { top: () => "command" } };
  const env = vm.createContext({ state, el, document, window, Date: class extends Date { static now() { return 31000; } }, Math, Object, Array, Boolean, String, AMBIENT_ZEN_MS: 30000, ORBIT_BASE: 0.003, ORBIT_ENERGY: 0.001, noMotion: () => false, hideTip() {}, bumpHud() {}, syncViewControls() {}, writeStore: (...args) => writes.push(args) });
  vm.runInContext(section("function canAmbientZen()", "function canDim()"), env);
  vm.runInContext(section("function orbitTarget(", "function computeBranch("), env);
  return { state, el, document, window, env, classes, writes };
}

test("ambient Zen requires opt-in, waits thirty idle seconds, and restores the view on wake or disable", () => {
  const { state, el, env, classes, writes } = zenContext(false);
  const anchors = state.screenLayout;
  assert.equal(env.checkAmbientZen(31000), false, "thirty seconds cannot activate disabled Zen");
  assert.equal(env.checkAmbientZen(90000), false, "remaining idle does not override the disabled preference");
  assert.equal(el.hud.inert, false); assert.equal(classes.has("command-zen"), false);
  env.setAmbientZenEnabled(true);
  assert.equal(el.ambientZen.checked, true); assert.equal(state.lastInput, 31000, "enabling starts a fresh idle clock");
  assert.equal(env.checkAmbientZen(60999), false);
  assert.equal(env.checkAmbientZen(61000), true);
  assert.equal(state.camMode, "orbit"); assert.equal(state.orbit, "auto");
  assert.ok(classes.has("command-zen")); assert.equal(el.hud.inert, true);
  assert.equal(state.screenLayout, anchors);
  assert.ok(env.orbitTarget(0) > 0);
  state.angle = 0.75;
  assert.equal(env.wakeAmbientZen(62000), true);
  assert.equal(state.camMode, "follow"); assert.equal(state.orbit, "paused");
  assert.equal(state.angle, 0.75, "waking preserves the visible angle instead of snapping backwards");
  assert.equal(state.orbitVel, 0); assert.equal(state.lastInput, 62000);
  assert.equal(el.hud.inert, false); assert.equal(classes.has("command-zen"), false);
  assert.equal(state.screenLayout, anchors);
  assert.equal(env.checkAmbientZen(92000), true);
  env.setAmbientZenEnabled(false);
  assert.equal(el.ambientZen.checked, false); assert.equal(state.ambientZen, false);
  assert.equal(el.hud.inert, false); assert.equal(classes.has("command-zen"), false);
  assert.equal(state.camMode, "follow"); assert.equal(state.orbit, "paused");
  assert.equal(env.checkAmbientZen(122000), false);
  assert.deepEqual(writes, [["mefiStudio.ambientZen", "1"], ["mefiStudio.ambientZen", "0"]]);
});

test("Music, menus, typing, dragging, hidden windows and other views cannot enter ambient Zen", () => {
  for (const block of [
    ({ state }) => { state.settingsPreview = { x: 600, y: 0, w: 500, h: 700 }; },
    ({ document }) => { document.body.dataset.sheet = "music"; },
    ({ window }) => { window.MefiNav.top = () => "palette"; },
    ({ state }) => { state.panning = { x: 1 }; },
    ({ state }) => { state.rotating = { x: 1 }; },
    ({ state }) => { state.query = "work"; },
    ({ state }) => { state.feedMenuOpen = true; },
    ({ document }) => { document.activeElement = { matches: () => true }; },
    ({ document }) => { document.querySelectorAll = () => [{ closest: () => null }]; },
    ({ document }) => { document.hidden = true; },
    ({ state }) => { state.active = false; },
  ]) {
    const fixture = zenContext(); block(fixture);
    assert.equal(fixture.env.checkAmbientZen(90000), false);
    assert.equal(fixture.state.lastInput, 90000, "an unavailable view needs a fresh idle interval afterward");
    assert.equal(fixture.el.hud.inert, false);
  }
});

test("reduced motion and a 2D graph can become quiet without rotating or changing their view", () => {
  const { state, env } = zenContext();
  env.noMotion = () => true;
  assert.equal(env.checkAmbientZen(31000), true);
  assert.equal(state.orbit, "paused"); assert.equal(env.orbitTarget(1), 0);
  env.wakeAmbientZen(32000); env.noMotion = () => false; state.view = "2d";
  assert.equal(env.checkAmbientZen(62000), true);
  assert.equal(state.view, "2d"); assert.equal(env.orbitTarget(1), 0);
});

test("Live work collapse updates hidden content, accessibility and saved preference without changing work state", () => {
  const { state, el, env, writes, classes } = zenContext();
  const anchors = state.screenLayout;
  env.setFeedCollapsed(true);
  assert.equal(el.feedContent.hidden, true); assert.equal(el.feedToggle.attrs["aria-expanded"], "false");
  assert.equal(el.feedToggle.title, "Expand live work"); assert.ok(classes.has("collapsed"));
  assert.deepEqual(writes, [["mefiStudio.cmdFeedCollapsed", "1"]]);
  assert.equal(state.screenLayout, anchors); assert.equal(state.graphAreaAt, 0);
  env.setFeedCollapsed(false, false);
  assert.equal(el.feedContent.hidden, false); assert.equal(el.feedToggle.attrs["aria-expanded"], "true");
  assert.equal(el.feedToggle.title, "Collapse live work"); assert.equal(writes.length, 1);
});

test("an explicit graph fit settles its camera before managed anchors are allocated", () => {
  const state = { camera: { x: -200, y: 60, z: 80, tx: 20, ty: 10, tz: 5 }, view: "3d", pitch: 0.2, angle: 2.1, orbit: "auto", orbitVel: .02, screenLayout: {}, camMode: "follow", follow: { key: "task:old" }, followZoomTarget: 2.5, panning: { cam: { x: 400 } }, rotating: { angle: 2.1 }, graphAreaAt: 123, hudRectsAt: 123, agentLayout: new Map([["worker", { x: 800, y: 800 }]]) };
  const el = { canvas: { style: { cursor: "grabbing" } } };
  const env = vm.createContext({ state, el, Date: { now: () => 1000 }, SETTLE_MS: 2500, setZoom: (zoom) => { state.zoom = zoom; }, autoFit() {}, hideTip() {}, setCamMode(mode) { state.camMode = mode; env.refitLayout(); } });
  vm.runInContext(section("function fitAll()", "function nodeState("), env);
  env.fitAll();
  assert.deepEqual(JSON.parse(JSON.stringify(state.camera)), { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 });
  assert.equal(state.screenLayout, null); assert.equal(state.zoom, 1);
  assert.equal(state.view, "3d", "layout repair cannot switch a spatial graph into the flat view");
  assert.equal(state.angle, .5); assert.equal(state.pitch, 0); assert.equal(state.orbitVel, 0);
  assert.equal(state.camMode, "orbit"); assert.equal(state.follow, null); assert.equal(state.followZoomTarget, null);
  assert.equal(state.panning, null); assert.equal(state.rotating, null); assert.equal(el.canvas.style.cursor, "default");
  assert.equal(state.agentLayout.size, 0); assert.equal(state.graphAreaAt, 0); assert.equal(state.hudRectsAt, 0);
  assert.equal(state.settleUntil, 3500); assert.equal(state.orbit, "auto", "Fit settles motion without changing the user's orbit preference");
});

test("automatic layout refits preserve the chosen yaw and camera mode", () => {
  const state = { camera: { x: 10, y: 20, z: 30 }, angle: 1.8, pitch: .2, camMode: "follow", orbit: "paused", agentLayout: new Map([["worker", {}]]) };
  const env = vm.createContext({ state, setZoom() {}, autoFit() {}, hideTip() {} });
  vm.runInContext(section("function refitLayout()", "function nodeState("), env);
  env.refitLayout();
  assert.equal(state.angle, 1.8); assert.equal(state.camMode, "follow"); assert.equal(state.orbit, "paused");
  assert.equal(state.agentLayout.size, 1, "automatic refits retain ongoing worker motion");
});

test("F and Home repair the overview while Shift F keeps branch focus and typing is untouched", () => {
  let fits = 0, branches = 0;
  const state = { active: true, selected: null };
  const document = { body: { dataset: {} } };
  const root = { id: "root" };
  const env = vm.createContext({ state, document, fitAll: () => { fits += 1; }, branchFit: () => { branches += 1; }, rootNode: () => root, selectNode: (node) => { state.selected = { node }; } });
  vm.runInContext(section("function handleKey(", "// One Esc step"), env);
  for (const key of ["f", "F", "Home"]) assert.equal(env.handleKey({ key }), true);
  assert.equal(fits, 3); assert.equal(state.selected.node, root);
  assert.equal(env.handleKey({ key: "F", shiftKey: true }), true);
  assert.equal(branches, 1); assert.equal(fits, 3);
  assert.equal(env.handleKey({ key: "f", target: { closest: () => true } }), false);
  assert.equal(env.handleKey({ key: "f", ctrlKey: true }), false);
  document.body.dataset.sheet = "music";
  assert.equal(env.handleKey({ key: "f" }), false);
  assert.equal(fits, 3);
});

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
    chatLog: box(width - 324, 140, 300, chat ? height - 240 : 64),
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
  assert.ok(area.w > 0 && area.h > 0);
  assert.ok(area.x >= 0 && area.x + area.w <= 820);
  assert.ok(area.x >= 344 && area.x + area.w <= 496, "even a crowded window must not reuse the space occupied by expanded panels");
});

test("node details and Follow controls reserve real graph space", () => {
  const { env, state, el } = graphContext({ chat: true });
  el.info = box(800, 210, 300, 500);
  el.followStatus = box(372, 140, 420, 40);
  const area = env.usableArea();
  for (const panel of [el.feed, el.chatLog, el.info, el.followStatus]) {
    const r = panel.getBoundingClientRect();
    assert.ok(area.x + area.w <= r.left || area.x >= r.right || area.y + area.h <= r.top || area.y >= r.bottom);
  }
  el.info.hidden = true; el.followStatus.hidden = true; state.graphAreaAt = 0;
  assert.ok(env.usableArea().w > area.w, "closing the detail card returns its space");
});

test("inspect mode's wider rail carves the clear area but keeps the layout frame, so a click never re-seeds the tree", () => {
  const { env, state, el } = graphContext();
  el.hud = {};
  env.getComputedStyle = () => ({ getPropertyValue: (name) => (name === "--command-rail-width" ? "344px" : "") });
  el.rail = box(1440 - 24 - 344, 150, 344, 700);
  const resting = { ...env.usableArea() };
  const frame = { ...state.graphFrame };
  // Selecting a node turns on inspect mode: the rail widens and rises.
  state.focusMode = true; state.graphAreaAt = 0;
  el.rail = box(1440 - 24 - 520, 76, 520, 800);
  const inspecting = env.usableArea();
  assert.deepEqual({ ...state.graphFrame }, frame, "the frame the saved layout is keyed on stays put");
  assert.ok(inspecting.x + inspecting.w <= 1440 - 24 - 520 - 20, "the clear rectangle still keeps off the wider rail");
  assert.ok(inspecting.w < resting.w, "and the tree glides over to make room");
  state.focusMode = false; state.graphAreaAt = 0;
  el.rail = box(1440 - 24 - 344, 150, 344, 700);
  assert.deepEqual({ ...env.usableArea() }, resting, "leaving inspect mode gives the space back");
});

test("Zen releases invisible panel bounds and wake immediately restores them", () => {
  const { env, state, el } = graphContext({ chat: true });
  Object.assign(state, { hudRects: [], hudRectsAt: 0 });
  vm.runInContext(section("function hudRects()", "function drawLabels("), env);
  const normal = { ...env.usableArea() };
  assert.ok(env.hudRects().length > 0);
  state.ambientZen = true;
  assert.deepEqual({ ...env.usableArea() }, { x: 28, y: 28, w: el.width - 56, h: el.height - 56 });
  assert.equal(env.hudRects().length, 0, "faded panels cannot hide labels either");
  state.ambientZen = false;
  assert.deepEqual({ ...env.usableArea() }, normal);
  assert.ok(env.hudRects().length > 0);
});

test("important graph labels win crowded placement without covering other text or nodes", () => {
  const { env, el, state } = graphContext();
  Object.assign(state, { labels: "all", selected: null, hoverNode: null, query: "", matchSet: new Set(), labelRects: [], labelWidths: new Map(), hudRects: [], hudRectsAt: 0 });
  el.ctx = { measureText: (text) => ({ width: text.length * 6 }), beginPath() {}, moveTo() {}, lineTo() {}, roundRect() {}, fill() {}, fillRect() {}, stroke() {}, strokeText() {}, fillText() {} };
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

function labelContext(options) {
  const { env, el, state } = graphContext(options);
  Object.assign(state, { camMode: "orbit", labels: "auto", selected: null, hoverNode: null, query: "", matchSet: new Set(), labelRects: [], labelWidths: new Map(), hudRects: [], hudRectsAt: 0 });
  el.ctx = { measureText: (text) => ({ width: text.length * 6 }), beginPath() {}, moveTo() {}, lineTo() {}, roundRect() {}, fill() {}, fillRect() {}, stroke() {}, strokeText() {}, fillText() {} };
  vm.runInContext(source.slice(source.indexOf("const LABEL_FONT ="), source.indexOf("// Node life-cycle:")), env);
  Object.assign(env, { emphasis: () => 1, colorOf: () => [230, 201, 141], hexToRgb: () => [230, 201, 141], rgba: (_color, alpha) => `rgba(1,2,3,${alpha})`, NODE_RGB: { assistant: [1, 2, 3], done: [1, 2, 3], task: [1, 2, 3] } });
  vm.runInContext(section("function measure(ctx", "// ---------- hover tooltip"), env);
  return { env, el, state };
}

test("Auto caps Orbit and Free labels by clear viewport, regardless of backlog size", () => {
  for (const [options, expected] of [[{ width: 1440, height: 900 }, 8], [{ width: 1100, height: 900 }, 6], [{ width: 820, height: 600, chat: true }, 4]]) {
    for (const camMode of ["orbit", "free"]) {
      const { env, state } = labelContext(options);
      state.camMode = camMode;
      const area = env.usableArea();
      const projected = Array.from({ length: 100 }, (_, index) => ({
        node: { id: `task:${String(index).padStart(3, "0")}`, kind: "task", label: `Work ${index}`, state: "active", _pr: 5 },
        p: { x: area.x + 40 + (index % 4) * (area.w - 80) / 4, y: area.y + 40 + Math.floor(index / 4) * 90, k: 1, depth: 800 },
      }));
      assert.equal(env.labelBudget(), expected);
      assert.equal(env.labelCandidates(projected).length, expected);
      env.drawLabels(projected);
      assert.ok(state.labelRects.length > 0 && state.labelRects.length <= expected);
      for (const rect of state.labelRects) {
        assert.ok(rect.x >= area.x && rect.x + rect.w <= area.x + area.w);
        assert.ok(rect.y >= area.y && rect.y + rect.h <= area.y + area.h);
      }
      for (let i = 0; i < state.labelRects.length; i += 1) {
        for (let j = i + 1; j < state.labelRects.length; j += 1) assert.equal(env.overlaps(state.labelRects[i], state.labelRects[j]), false);
      }
    }
  }
});

test("Auto hides unrelated backlog text while hover, selection, search and All retain access", () => {
  const { env, state } = labelContext();
  const nodes = [
    { id: "running", kind: "task", label: "Current worker", state: "active" },
    ...Array.from({ length: 80 }, (_, index) => ({ id: `quiet:${index}`, kind: "task", label: `Saved task ${index}`, state: "task" })),
    { id: "old-todo", kind: "todo", sessionId: "old", status: "in_progress", _workLabel: "Running", label: "Old session step" },
    { id: "session", kind: "session", label: "Prior session" },
  ];
  const projected = nodes.map((node) => ({ node, p: { k: 1, depth: 800 } }));
  assert.deepEqual(Array.from(env.labelCandidates(projected), ({ node }) => node.id), ["running"]);
  state.selected = nodes[1];
  state.hoverNode = nodes[2];
  state.query = "Saved";
  state.matchSet = new Set(nodes.slice(3, 70).map((node) => node.id));
  let candidates = env.labelCandidates(projected);
  assert.equal(candidates.length, 8);
  assert.equal(candidates[0].node, nodes[1]);
  assert.equal(candidates[1].node, nodes[2]);
  assert.ok(candidates.slice(2).every(({ node }) => state.matchSet.has(node.id)));
  state.query = "";
  state.labels = "all";
  candidates = env.labelCandidates(projected);
  assert.ok(candidates.length > 8 && candidates.some(({ node }) => node.id === "quiet:20"));
  assert.equal(nodes.length, 83, "label filtering must not remove saved graph nodes");
});

test("Auto keeps only two quiet session landmarks and its choices remain stable during rotation", () => {
  const { env, state } = labelContext();
  const projected = Array.from({ length: 20 }, (_, index) => ({ node: { id: `session:${index}`, kind: "session", label: `Session ${index}` }, p: { k: 1, depth: 500 + index * 40 } }));
  const ids = (items) => Array.from(env.labelCandidates(items), ({ node }) => node.id);
  const before = ids(projected);
  assert.equal(before.length, 2);
  assert.deepEqual(ids(projected.toReversed().map((item) => ({ ...item, p: { ...item.p, depth: 1500 - item.p.depth } }))), before);
  state.hoverNode = projected[19].node;
  assert.equal(ids(projected)[0], "session:19");
});

test("Auto clips display labels without changing saved titles and expands inspected text", () => {
  const { env, el, state } = labelContext();
  const title = "Implement resilient workflow continuation and dependency checks for grouped work";
  const node = { id: "long", kind: "task", label: title, _workLabel: "Running" };
  const compact = env.labelText(el.ctx, node, env.fontFor(node));
  assert.ok(el.ctx.measureText(compact).width <= 180);
  assert.match(compact, /…$/);
  state.hoverNode = node;
  const inspected = env.labelText(el.ctx, node, env.fontFor(node));
  assert.ok(inspected.length > compact.length);
  assert.ok(el.ctx.measureText(inspected).width <= 230);
  assert.equal(node.label, title);
});

test("orbs reserve size and brightness emphasis for working or inspected nodes", () => {
  const state = { selected: null, hoverNode: null };
  const env = vm.createContext({ state });
  vm.runInContext(section("function nodeVisualProfile(", "function traceNodeSurface("), env);
  const quiet = { id: "quiet", kind: "session", state: "idle" };
  const active = { id: "active", kind: "session", state: "active" };
  const calm = env.nodeVisualProfile(quiet);
  const busy = env.nodeVisualProfile(active);
  assert.equal(calm.shape, "circle");
  assert.ok(calm.maxRadius < busy.maxRadius && calm.alpha < busy.alpha);
  assert.equal(env.nodeVisualProfile({ kind: "agent" }).shape, "circle");
  assert.equal(env.nodeVisualProfile({ kind: "task" }).shape, "circle");
  assert.equal(env.nodeVisualProfile({ kind: "agent", status: "running" }).prominent, true);
  assert.equal(env.nodeVisualProfile({ kind: "agent", status: "queued" }).prominent, false);
  state.hoverNode = quiet;
  assert.equal(env.nodeVisualProfile(quiet).prominent, true);
});

test("collapsed panel headers stay outside the graph while their side gutters become usable", () => {
  const { env, state, el } = graphContext({ width: 1920, height: 1200 });
  state.feedCollapsed = true;
  el.feed = box(30, 196, 410, 84);
  el.chatLog = box(1560, 196, 330, 64);
  const area = env.usableArea();
  assert.equal(area.x, 28);
  assert.equal(area.x + area.w, 1892);
  assert.ok(area.y >= 304, "collapsed Live work and Assistant headers are real obstructions");
  state.settingsPreview = { x: 530, y: 20, w: 1300, h: 1100 };
  assert.deepEqual({ ...env.usableArea() }, state.settingsPreview, "Music preview keeps its explicit unobstructed viewport");
});

test("collapsed Live work returns its gutter to the graph and keeps assistant composer access", () => {
  const { state, el, env } = graphContext();
  const wide = env.usableArea().w;
  state.feedCollapsed = true; state.graphAreaAt = 0;
  el.feed = box(24, 140, 220, 48);
  assert.ok(env.usableArea().w > wide + 200);
  el.feed.offsetWidth = 320; state.selected = { kind: "assistant" };
  vm.runInContext(section("function feedVisible()", "function centerX()"), env);
  vm.runInContext(section("function chatMode()", "function composerInput()"), env);
  assert.equal(env.feedVisible(), false); assert.equal(env.chatMode(), false, "the hidden rail cannot swallow the floating assistant composer");
  state.feedCollapsed = false;
  assert.equal(env.feedVisible(), true); assert.equal(env.chatMode(), true);
});

test("style changes preserve managed positions and only explicit layout changes request a reflow", () => {
  const saved = { nodes: new Map() };
  const state = { nodeStyle: "orbs", nodeLayout: "constellation", screenLayout: saved, active: true };
  let fits = 0;
  const env = vm.createContext({ state, el: { width: 1400, height: 900 }, refitLayout: () => { fits += 1; } });
  vm.runInContext(section("function applyTreePreferences(", "function traceNodeSurface("), env);
  env.applyTreePreferences({ nodeStyle: "glass", nodeLayout: "constellation" });
  assert.equal(state.screenLayout, saved); assert.equal(fits, 0);
  env.applyTreePreferences({ nodeStyle: "minimal", nodeLayout: "tree" });
  assert.equal(state.screenLayout, null); assert.equal(fits, 1);
  state.screenLayout = saved;
  env.applyTreePreferences({ nodeStyle: "invalid", nodeLayout: "invalid" });
  assert.equal(state.screenLayout, saved); assert.equal(state.nodeStyle, "minimal"); assert.equal(fits, 1);
  env.applyTreePreferences({ orbitTrails: true, extraGlow: true });
  assert.equal(state.orbitTrails, true); assert.equal(state.extraGlow, true);
  assert.equal(state.screenLayout, saved); assert.equal(fits, 1, "effects cannot reflow fixed anchors");
  env.applyTreePreferences({ orbitTrails: "false" });
  assert.equal(state.orbitTrails, true, "invalid effect values cannot silently change a saved preference");
});

test("blue work orbits are optional, truthful and static for reduced motion", () => {
  const state = { orbitTrails: false }, arcs = [];
  const env = vm.createContext({ state, Math });
  vm.runInContext(section("function drawWorkOrbit(", "function graphLayoutSeeds("), env);
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, arc: (...args) => arcs.push(args), stroke() {} };
  const node = { id: "work", kind: "task", _workLabel: "Running", x: 3, y: 4, z: 5 };
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 100, false);
  assert.equal(arcs.length, 0); assert.equal(node._orbitTrail, null);
  state.orbitTrails = true;
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 100, false);
  const first = node._orbitTrail.phase;
  assert.equal(arcs.length, 4); assert.equal(node._orbitTrail.segments, 3); assert.equal(node._orbitTrail.radius, 21);
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 200, false);
  assert.ok(node._orbitTrail.phase > first);
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 300, true);
  const still = node._orbitTrail.phase;
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 8000, true);
  assert.equal(node._orbitTrail.phase, still); assert.equal(node._orbitTrail.animated, false);
  assert.deepEqual([node.x, node.y, node.z], [3, 4, 5]);
  for (const label of [null, "Done", "Blocked"]) { node._workLabel = label; env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 9000, false); assert.equal(node._orbitTrail, null); }
  node._workLabel = "Next";
  env.drawWorkOrbit(ctx, node, { x: 50, y: 50 }, 12, 1000, false);
  assert.ok(node._orbitTrail.drawn, "explicit queued work retains the old blue indicator");
});

// The node painters live in renderer/node-styles.js (tests/node_styles.test.mjs);
// idle.js keeps thin adapters that hand each node to window.MefiNodeStyles
// and keep their own plain drawing when it is absent or a style declines.
test("drawNodeSurface hands each node to MefiNodeStyles, and a bare harness paints one plain disc", () => {
  const painted = [];
  const theme = { key: "theme" }, motion = { seed: 0.5, clock: 3 };
  const spy = { paint(ctx, style, p, radius, tint, o) { painted.push({ ctx, style, p, radius, tint, o: { ...o } }); } };
  const state = { nodeStyle: "prism", extraGlow: true, nodeTheme: theme };
  const env = vm.createContext({ state, Math, WeakMap, Map, window: { MefiNodeStyles: spy }, rgba: (_tint, alpha) => `rgba(1,2,3,${alpha})` });
  vm.runInContext(section("function traceNodeSurface(", "function drawWorkOrbit("), env);
  const ctx = {}, p = { x: 40, y: 60 }, tint = [220, 180, 110];
  const agent = { id: "agent:a", kind: "agent", _fade: 0.5, x: 1, y: 2, z: 3 };
  env.drawNodeSurface(ctx, agent, p, 12, tint, { selected: true, active: false, alpha: 0.4, time: 1234, still: true, detail: 2, chosen: true, motion });
  assert.equal(painted.length, 1);
  const [call] = painted;
  assert.ok(call.ctx === ctx && call.p === p && call.tint === tint, "the canvas, point and tint pass through as given");
  assert.deepEqual([call.style, call.radius], ["prism", 12]);
  assert.deepEqual({ ...call.o, motion: call.o.motion === motion, theme: call.o.theme === theme }, { kind: "agent", selected: true, chosen: true, active: false, alpha: 0.2, glyph: true, monogram: false, motion: true, time: 1234, still: true, detail: 2, extraGlow: true, theme: true }, "flags, the fade × emphasis alpha, the clock, the tier and the theme are forwarded");
  assert.equal(agent._extraGlow, true);
  assert.deepEqual([agent.x, agent.y, agent.z], [1, 2, 3], "painting never moves a node");
  env.drawNodeSurface(ctx, { kind: "assistant" }, p, 15, tint);
  assert.deepEqual([painted[1].o.monogram, painted[1].o.glyph, painted[1].o.alpha, painted[1].o.time, painted[1].o.still, painted[1].o.detail, painted[1].o.motion], [true, true, 1, 0, false, 3, null], "the hub wears its monogram; defaults for an old caller");
  env.drawNodeSurface(ctx, { kind: "agent" }, p, 4, tint);
  assert.equal(painted[2].o.glyph, false, "an agent too small for its glyph is told so");
  state.nodeStyle = undefined; state.extraGlow = false;
  env.drawNodeSurface(ctx, { kind: "task" }, p, 12, tint, { active: true });
  assert.deepEqual([painted[3].style, painted[3].o.extraGlow, painted[3].o.active], ["orbs", false, true]);
  // No module (a bare harness, a slice sandbox): one plain disc.
  const bare = vm.createContext({ state: { nodeStyle: "sigil", extraGlow: true }, Math, rgba: (_tint, alpha) => `rgba(1,2,3,${alpha})` });
  vm.runInContext(section("function traceNodeSurface(", "function drawWorkOrbit("), bare);
  const calls = { arc: 0, fill: 0, stroke: 0, saves: 0, restores: 0, alphas: [] };
  const disc = { save() { calls.saves++; }, restore() { calls.restores++; }, beginPath() {}, arc() { calls.arc++; }, fill() { calls.fill++; calls.alphas.push(this.globalAlpha); }, stroke() { calls.stroke++; calls.alphas.push(this.globalAlpha); } };
  const node = { kind: "task", _fade: 0.5 };
  bare.drawNodeSurface(disc, node, p, 12, tint, { alpha: 0.4 });
  assert.deepEqual([calls.arc, calls.fill, calls.stroke], [1, 1, 1]);
  assert.equal(calls.saves, calls.restores);
  assert.deepEqual(calls.alphas, [0.2, 0.2], "the fallback keeps the fade and emphasis");
  assert.equal(node._extraGlow, true);
});

test("the agent dress, hub dress and work orbit let a style draw its own and keep theirs otherwise", () => {
  const glyphs = [], asked = [], details = [], options = { ring: new Set(), hub: new Set(), orbit: new Set() };
  let arcs = [], answer = false;
  const spy = {
    glyph: (style) => style === "sigil" ? { ink: "INK", scale: 0.5, ringGap: 4 } : null,
    ring: (_ctx, style, _p, _radius, _tint, o) => { options.ring.add(o); details.push(o.detail); asked.push(["ring", style, o.status, o.ring, o.still]); return answer; },
    hubDress: (_ctx, style, _p, _radius, _tint, o) => { options.hub.add(o); details.push(o.detail); asked.push(["hub", style, o.crew]); return answer; },
    orbit: (_ctx, style, _p, _radius, _tint, o) => { options.orbit.add(o); details.push(o.detail); asked.push(["orbit", style, o.running, o.ring]); return answer; },
  };
  const state = { nodeStyle: "sigil", nodeTheme: null, agentTrails: new Map(), nodes: [{ kind: "agent" }], orbitTrails: true };
  const env = vm.createContext({
    state, Math, Map, WeakMap, emphasis: () => 1, agentHex: () => "#8fd0ff", rgba: (_tint, alpha) => `rgba(1,2,3,${alpha})`, rgb: () => "rgb(1,2,3)",
    NODE_RGB: { amber: [255, 212, 121], done: [104, 236, 164] }, TRAIL_MAX: 8, TRAIL_MS: 500,
    window: { MefiNodeStyles: spy, MefiTree: { agentGlyph: (...args) => glyphs.push(args.slice(1)), glyphInk: () => "#0b1016" } },
  });
  vm.runInContext(section("function traceNodeSurface(", "function graphLayoutSeeds("), env);
  const ctx = { save() {}, restore() {}, beginPath() {}, arc: (...args) => arcs.push(args), stroke() {}, fill() {}, setLineDash() {}, moveTo() {}, lineTo() {}, fillText() {} };
  const p = { x: 50, y: 50 }, tint = [120, 180, 220];
  const agent = { id: "agent:a", kind: "agent", role: "watcher", status: "running" };
  env.drawAgentDress(ctx, agent, p, 10, tint, 100, false);
  assert.deepEqual(glyphs.at(-1), ["watcher", 50, 50, 5, "INK"], "the style's glyph size and ink");
  assert.deepEqual(asked.at(-1), ["ring", "sigil", "running", 14, false], "the ring sits the style's gap out");
  assert.equal(arcs.length, 2, "a declined ring keeps the spinning arc and its tail");
  arcs = []; answer = true;
  env.drawAgentDress(ctx, agent, p, 10, tint, 100, false);
  assert.equal(arcs.length, 0, "a style that draws the ring replaces it");
  state.nodeStyle = "orbs"; answer = false;
  env.drawAgentDress(ctx, agent, p, 10, tint, 100, true);
  assert.deepEqual(glyphs.at(-1), ["watcher", 50, 50, 7, "#0b1016"], "no glyph dress: the orb's own ink at 0.7");
  assert.deepEqual(asked.at(-1), ["ring", "orbs", "running", 13.5, true]);
  state.nodeStyle = "minimal"; const before = asked.length;
  env.drawAgentDress(ctx, agent, p, 10, tint, 100, false);
  assert.equal(asked.length, before + 1, "Minimal dresses its agents too");
  assert.deepEqual([glyphs.at(-1)[0], asked.at(-1)], ["watcher", ["ring", "minimal", "running", 13.5, false]], "its glyph and its status ring");
  state.nodeStyle = "prism"; arcs = [];
  env.drawHubDress(ctx, { kind: "assistant" }, p, 15, tint, 100, false);
  assert.deepEqual(asked.at(-1), ["hub", "prism", true]);
  assert.equal(arcs.length, 2, "a declined hub dress keeps the breathing ring and the crew ring");
  arcs = []; answer = true;
  env.drawHubDress(ctx, { kind: "assistant" }, p, 15, tint, 100, false);
  assert.equal(arcs.length, 0);
  const work = { id: "work", kind: "task", _workLabel: "Running" };
  env.drawWorkOrbit(ctx, work, p, 12, 100, false);
  assert.deepEqual(asked.at(-1), ["orbit", "prism", true, 21]);
  assert.equal(arcs.length, 0, "a style's own orbit replaces the blue arcs");
  assert.deepEqual({ ...work._orbitTrail, phase: undefined }, { drawn: true, animated: true, segments: 3, phase: undefined, radius: 21 }, "and still reports the orbit it drew");
  assert.equal([...options.orbit][0].run, 1, "a Running orbit is all Running (o.run, eased over a Running <-> Next change)");
  answer = false;
  env.drawWorkOrbit(ctx, work, p, 12, 100, false);
  assert.equal(arcs.length, 4, "a declined orbit keeps the blue arcs");
  assert.deepEqual([options.ring.size, options.hub.size, options.orbit.size], [1, 1, 1], "each hook's options are one scratch, reused for every node");
  // Each hook gets the tier drawFrame capped for the node (node._detail), T3
  // for a node the loop has not tiered.
  assert.ok(details.every((detail) => detail === 3), "no tier yet: full detail");
  details.length = 0;
  agent._detail = 1; work._detail = 2;
  env.drawAgentDress(ctx, agent, p, 10, tint, 100, false);
  env.drawHubDress(ctx, { kind: "assistant", _detail: 0 }, p, 15, tint, 100, false);
  env.drawWorkOrbit(ctx, work, p, 12, 100, false);
  assert.deepEqual(details, [1, 0, 2], "the ring, the hub dress and the orbit read the node's capped tier");
  // The orbit turns on the record's integrated phase, so starting or stopping
  // work never jumps it; reduced motion parks it at π/3.
  work._m = { orbit: 1.23 };
  env.drawWorkOrbit(ctx, work, p, 12, 100, false);
  assert.equal(work._orbitTrail.phase, 1.23);
  env.drawWorkOrbit(ctx, work, p, 12, 5000, true);
  assert.equal(work._orbitTrail.phase, Math.PI / 3);
});

// drawFrame's landing pass hands every arrived pulse to landPulse.
test("a landed pulse kicks its node's motion once and belongs to the style for the landing tail", () => {
  const lands = [];
  let answer = true;
  const styles = { land: (_ctx, style, point, radius, tint, u, o) => { lands.push({ style, point, radius, tint: [...tint], u, kind: o.kind, detail: o.detail, pulse: o.pulse, motion: o.motion }); return answer; } };
  const record = { kick: 0 };
  const state = { nodeStyle: "sigil", nodeMotion: new Map([["task", record]]), styleBurstUntil: 0 };
  const env = vm.createContext({ state, Math, LAND_TAIL_MS: 380, hexToRgb: () => [1, 2, 3] });
  vm.runInContext(section("function landPulse(", "function surgeLine("), env);
  const look = { kind: "dot", time: 0, still: false, rTo: 0, detail: 3, pulse: null, motion: null };
  const node = { id: "task", _pr: 12, _detail: 1 }, point = { x: 10, y: 20 };
  const pulse = { to: node, color: "#010203", wave: true };
  env.landPulse({}, styles, pulse, point, 0, look, 1000, false);
  assert.equal(record.kick, 1, "the arrival kicks the node's motion");
  assert.equal(state.styleBurstUntil, 1380, "a landing draws at the hot cadence for its tail");
  assert.deepEqual({ ...lands[0], pulse: lands[0].pulse === pulse, motion: lands[0].motion === record }, { style: "sigil", point, radius: 12, tint: [1, 2, 3], u: 0, kind: "wave", detail: 1, pulse: true, motion: true }, "the landing gets the target's radius and its capped tier");
  record.kick = 0.4;
  env.landPulse({}, styles, pulse, point, 190, look, 1190, false);
  assert.equal(record.kick, 0.4, "only the first landed frame kicks");
  assert.equal(lands[1].u, 0.5, "u runs over the landing tail");
  env.landPulse({}, styles, pulse, point, 900, look, 1900, false);
  assert.equal(lands[2].u, 1);
  assert.equal(pulse._landed, undefined, "a style that lands keeps the pulse to the end of its tail");
  // A style without a landing: the kick still lands, the pulse goes.
  answer = false; state.styleBurstUntil = 0; record.kick = 0;
  const declined = { to: node };
  env.landPulse({}, styles, declined, point, 5, look, 2000, false);
  assert.deepEqual([record.kick, declined._landed, state.styleBurstUntil], [1, true, 0]);
  // Reduced motion: no kick, the landing's end pose.
  const quiet = { to: { id: "task" } }; record.kick = 0;
  env.landPulse({}, styles, quiet, point, -400, look, 3000, true);
  assert.deepEqual([record.kick, lands.at(-1).u, lands.at(-1).detail], [0, 1, 3], "a node not tiered yet lands at full detail");
  // drawFrame keeps a pulse through its landing only with the node styles, and
  // an arrived pulse no longer draws its head.
  const frame = section("function drawFrame(", "function measure(");
  assert.ok(frame.includes("const landTail = nodeStyles ? LAND_TAIL_MS : 0;"));
  assert.ok(frame.includes("now - pulse.start < pulse.duration + (pulse._landed ? 0 : landTail)"));
  assert.ok(frame.includes("if (!still && now - pulse.start >= pulse.duration) continue;"));
  assert.ok(frame.includes("pulseLook.detail = pulse.to?._detail ?? 3;"), "a travelling pulse carries its target's tier to surge");
  assert.ok(frame.includes("node._detail = detail;"), "the node loop leaves each node's tier for its hooks, wires and pulses");
});

test("graph connections offer each wire to the style and keep the plain line when it declines", () => {
  const assistant = { node: { id: "assistant", kind: "assistant", _pr: 15, _detail: 3, _m: { seed: 0.25 } }, p: { x: 50, y: 80 } };
  const task = { node: { id: "task", kind: "task", _pr: 12, _detail: 2, _m: { seed: 0.75 } }, p: { x: 850, y: 480 } };
  const agent = { node: { id: "agent", kind: "agent", role: "builder", status: "running", _detail: 1, targetNode: task.node }, p: { x: 890, y: 480 } };
  const offered = [];
  let answer = false;
  const spy = { wire: (_pen, style, a, b, o) => { offered.push({ style, a, b, o: { ...o, cp: o.cp && { ...o.cp }, dash: o.dash && [...o.dash], tint: o.tint && [...o.tint] } }); return answer; } };
  const theme = { key: "theme" };
  const state = { nodeStyle: "sigil", nodeLayout: "tree", nodeTheme: theme, edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 2 }], branchParents: new Map([["task", "assistant"]]), agentLayout: new Map([["agent", { hostId: "task" }]]) };
  const env = vm.createContext({ state, Math, Map, NODE_RGB: { task: [1, 2, 3] }, rgba: () => "color", agentRgb: () => [4, 5, 6], colorOf: () => [7, 8, 9], isBusyNode: () => false, window: { MefiNodeStyles: spy } });
  vm.runInContext(section("function drawGraphConnections(", "function drawFrame("), env);
  let paths = [], path;
  const dashes = [], caps = [];
  const ctx = { lineCap: "butt", beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, bezierCurveTo(...points) { path.push(points.slice(-2)); }, stroke() { paths.push(path); caps.push(this.lineCap); }, setLineDash(dash) { dashes.push(dash); } };
  const render = () => { paths = []; offered.length = 0; dashes.length = 0; caps.length = 0; env.drawGraphConnections(ctx, [assistant, task, agent], new Set(), false, 500); return paths; };
  assert.deepEqual(render(), [[[50, 80], [850, 480]], [[890, 480], [850, 480]]], "a declined wire keeps the plain branch and tether");
  assert.ok(caps.every((cap) => cap === "round") && ctx.lineCap === "butt", "every line has round caps, and the nodes after them get the canvas default back");
  assert.ok(dashes.every((dash) => Object.isFrozen(dash)), "the plain lines share frozen dash patterns: no edge allocates one a frame");
  const first = [...dashes];
  render();
  assert.ok(dashes.every((dash, index) => dash === first[index]), "the same dash arrays, frame after frame");
  assert.equal(offered.length, 2);
  const [edge, tether] = offered;
  assert.ok(edge.a === assistant.p && edge.b === task.p && tether.a === agent.p && tether.b === task.p, "the painted points pass through");
  assert.equal(edge.o.theme, theme, "the wire carries the node theme");
  assert.deepEqual({ ...edge.o, theme: null }, { kind: "task", tint: [1, 2, 3], alpha: 0.32, width: 1, dash: [2, 4], march: false, flow: false, double: false, active: false, inspected: false, curved: true, cp: { x1: 50, y1: 280, x2: 850, y2: 280 }, far: false, time: 500, still: true, seed: 0.75, rA: 15, rB: 12, detail: 2, lifetime: 1, theme: null }, "the branch arrives with its look, its S-curve controls, both radii and the lower end's tier");
  assert.deepEqual({ ...tether.o, alpha: Math.round(tether.o.alpha * 100) / 100, theme: null }, { kind: "tether", tint: [4, 5, 6], alpha: 0.18, width: 1, dash: [6, 4], march: false, flow: true, double: false, active: true, inspected: false, curved: false, cp: null, far: false, time: 500, still: true, seed: 0, rA: 0, rB: 12, detail: 1, lifetime: 1, theme: null }, "the tether is a wire of its own kind; a working one carries work (flow) even with motion off");
  task.node._detail = undefined; agent.node._detail = undefined; render();
  assert.deepEqual(offered.map(({ o }) => o.detail), [3, 3], "ends not tiered yet: full detail");
  assert.ok(offered.every(({ style }) => style === "sigil"));
  // A busy task's branch carries work: it flows, and marches while motion is on.
  env.isBusyNode = (node) => node.id === "task";
  env.noMotion = () => false;
  render();
  assert.deepEqual([offered[0].o.active, offered[0].o.march, offered[0].o.flow, offered[0].o.still], [true, true, true, false]);
  env.noMotion = () => true;
  render();
  assert.deepEqual([offered[0].o.march, offered[0].o.flow, offered[0].o.still], [false, true, true], "reduced motion: no march, the flow is still offered (held)");
  delete env.noMotion; env.isBusyNode = () => false;
  answer = true;
  assert.deepEqual(render(), [], "a style that draws the wire replaces the plain line");
  assert.equal(ctx.lineCap, "butt");
});

test("the session and todo hops on the way to busy work carry work too, and the edge loop allocates no look", () => {
  const root = { node: { id: "root", kind: "root" }, p: { x: 0, y: 0 } };
  const session = { node: { id: "s1", kind: "session" }, p: { x: 100, y: 100 } };
  const todo = { node: { id: "s1:0", kind: "todo", sessionId: "s1", state: "active" }, p: { x: 200, y: 200 } };
  const offered = [];
  const spy = { wire: (_pen, _style, _a, _b, o) => { offered.push({ kind: o.kind, active: o.active, march: o.march, flow: o.flow, dash: o.dash }); return true; } };
  const state = { nodeStyle: "orbs", nodeLayout: "constellation", edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }] };
  let busy = new Set();
  const env = vm.createContext({ state, Math, Map, NODE_RGB: { task: [1, 2, 3] }, rgba: () => "color", agentRgb: () => [4, 5, 6], colorOf: () => [7, 8, 9], isBusyNode: (node) => busy.has(node.id), window: { MefiNodeStyles: spy } });
  vm.runInContext(section("function drawGraphConnections(", "function drawFrame("), env);
  const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {} };
  const render = () => { offered.length = 0; env.drawGraphConnections(ctx, [root, session, todo], new Set(), false, 500); return offered.map(({ kind, flow }) => `${kind}:${flow}`); };
  assert.deepEqual(render(), ["session:false", "todo:false"], "quiet hops carry nothing");
  busy = new Set(["s1", "s1:0"]);
  env.noMotion = () => false;
  assert.deepEqual(render(), ["session:true", "todo:true"], "the hops toward busy work flow (the style runs them calmer than the task's own wire)");
  assert.ok(offered.every(({ active, march }) => active === true && march === false), "active, with no dashes to march");
  env.noMotion = () => true;
  assert.deepEqual(render(), ["session:true", "todo:true"], "reduced motion still offers them, held");
  delete env.noMotion;
  const loop = section("function drawGraphConnectionsImpl(", "// ---------- backdrop scenes");
  assert.ok(loop.includes("const style = edgeStyleInto(EDGE_LOOK, edge, a, b, active, inspected, primary);"), "the edge loop fills one look scratch");
  assert.ok(!loop.includes("{ active, inspected, primary }"), "and builds no option literal per edge");
});

// A pulse along a tree branch rides the branch's S-curve; the hub link and
// the constellation stay straight.
test("a travelling pulse carries its branch's S-curve controls and the node theme to surge", () => {
  // drawFrame's pulse pass, run on its own with a spy surge.
  const frame = section("function drawFrame(", "function measure(");
  const start = frame.indexOf("    // pulses: bright travelling dots"), end = frame.indexOf("    // particles: vaporized external work");
  assert.ok(start > 0 && end > start, "the pulse pass");
  const surges = [], lands = [];
  const spy = { surge: (_ctx, style, _from, _to, _t, pulse, o) => { surges.push({ id: pulse.id, style, cp: o.cp && { ...o.cp }, theme: o.theme, kind: o.kind }); return true; } };
  const theme = { key: "theme" };
  const root = { id: "root", kind: "root", x: 0, y: 0 }, hub = { id: "assistant", kind: "assistant", x: 100, y: 0 };
  const session = { id: "s1", kind: "session", x: 40, y: 100 }, task = { id: "t1", kind: "task", x: 200, y: 300 };
  const state = { nodeStyle: "orbs", nodeLayout: "tree", nodeTheme: theme, nodeMotion: new Map(), pulses: [], branchParents: new Map([["s1", "root"], ["t1", "s1"], ["assistant", "root"]]) };
  const env = vm.createContext({
    state, Math, Map, Date: { now: () => 1000 }, LAND_TAIL_MS: 380, musicBands: { bass: 0 }, hexToRgb: () => [1, 2, 3],
    project: (node) => ({ x: node.x, y: node.y }), surgeLine() { throw new Error("the style drew it"); }, landPulse: (...args) => lands.push(args),
  });
  vm.runInContext(`function pulsePass(ctx, nodeStyles, time, still, screenPoints) {\n${frame.slice(start, end)}\n}`, env);
  const screen = new Map([root, hub, session, task].map((node) => [node.id, { x: node.x, y: node.y }]));
  const run = () => {
    surges.length = 0;
    const pulse = (id, from, to, extra = {}) => ({ id, from, to, start: 500, duration: 900, color: "#ffffff", ...extra });
    state.pulses = [pulse("down", session, task), pulse("up", task, session, { wave: true }), pulse("hub", root, hub), pulse("back", hub, root), pulse("across", hub, task)];
    env.pulsePass({}, spy, 1000, false, screen);
    return Object.fromEntries(surges.map(({ id, cp }) => [id, cp]));
  };
  const tree = run();
  assert.deepEqual(tree.down, { x1: 40, y1: 200, x2: 200, y2: 200 }, "parent → child rides the branch's S-curve");
  assert.deepEqual(tree.up, { x1: 200, y1: 200, x2: 40, y2: 200 }, "child → parent too, the same curve walked the other way");
  assert.deepEqual([tree.hub, tree.back, tree.across], [null, null, null], "the hub link (either way) and a pulse off any branch stay straight");
  assert.ok(surges.every(({ theme: seen, style }) => seen === theme && style === "orbs"), "every pulse carries the node theme");
  assert.deepEqual(surges.map(({ kind }) => kind), ["dot", "wave", "dot", "dot", "dot"]);
  assert.equal(lands.length, 0, "nothing has landed yet");
  state.nodeLayout = "layers";
  assert.deepEqual(run().down, { x1: 40, y1: 200, x2: 200, y2: 200 }, "Layers draws the same S-curves");
  state.nodeLayout = "constellation";
  assert.ok(Object.values(run()).every((cp) => cp === null), "the constellation's straight wires carry straight pulses");
  assert.ok(section("function landPulse(", "function surgeLine(").includes("look.cp = null;"), "a landing never sees a travelling pulse's curve");
});

test("Branches follows real parent edges, Rings uses separate concentric slots, and layouts retain surviving points", () => {
  const { env, state } = graphContext(); Object.assign(state, { fit: 1, nodeLayout: "tree", nodeStyle: "orbs", tasks: [] });
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const nodes = [{ id: "root", kind: "root", x: 0, y: 0, z: 0 }, { id: "session", kind: "session", x: 1, y: 1, z: 1 }, { id: "assistant", kind: "assistant", x: 2, y: 2, z: 2 }, ...Array.from({ length: 12 }, (_, index) => ({ id: `task:${index}`, kind: "task", x: 3 + index, y: 3, z: 3 + index }))];
  const edgesFor = (list) => list.filter((node) => node.kind !== "root").map((node) => ({ a: list.findIndex((candidate) => candidate.id === (node.kind === "task" ? "session" : "root")), b: list.indexOf(node) }));
  const run = (list) => { state.edges = edgesFor(list); const projected = list.map((node) => ({ node, p: env.project(node) })); env.layoutProjectedGraph(projected, env.usableArea(), "orbit"); return new Map(projected.map(({ node, p }) => [node.id, [p.x, p.y]])); };
  const branches = run(nodes);
  assert.ok(branches.get("session")[1] > branches.get("root")[1]);
  assert.ok(branches.get("task:0")[1] > branches.get("session")[1]);
  const added = run([...nodes.slice().reverse(), { id: "task:new", kind: "task", x: 12, y: 0, z: 8 }]);
  for (const [id, point] of branches) assert.deepEqual(added.get(id), point);
  state.nodeLayout = "radial"; const rings = run(nodes);
  assert.ok(nodes.filter((node) => Math.hypot(...rings.get(node.id).map((value, index) => value - branches.get(node.id)[index])) > 8).length >= 10);
  assert.notDeepEqual(rings.get("session"), rings.get("assistant"), "ring1 shares a slot pool across node kinds");
});

test("Constellation balances loose tasks around its hub and keeps related work in short branch sectors", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const area = { x: 40, y: 260, w: 1560, h: 760 };
  const nodes = [{ id: "root", kind: "root" }, { id: "assistant", kind: "assistant" }, { id: "music", kind: "music" }];
  const parents = new Map([["assistant", "root"]]);
  for (let branch = 0; branch < 6; branch += 1) {
    const id = `session:${branch}`; nodes.push({ id, kind: "session" }); parents.set(id, "root");
    for (let index = 0; index < 3; index += 1) { const child = `${id}:step:${index}`; nodes.push({ id: child, kind: "todo" }); parents.set(child, id); }
  }
  for (let index = 0; index < 12; index += 1) nodes.push({ id: `task:${index}`, kind: "task" });
  const projected = nodes.map((node) => ({ node, p: {} }));
  const seeds = env.graphLayoutSeeds(projected, area, "constellation", parents, new Map());
  const root = seeds.get("root");
  assert.equal(root.x, area.x + area.w / 2); assert.equal(root.y, area.y + area.h / 2);
  const reversed = env.graphLayoutSeeds([...projected].reverse(), area, "constellation", parents, new Map());
  for (const [id, point] of seeds) {
    assert.deepEqual(reversed.get(id), point, "board recency cannot change a fresh arrangement");
    assert.ok(point.x > area.x + 32 && point.x < area.x + area.w - 32 && point.y > area.y + 32 && point.y < area.y + area.h - 32);
    if (id.startsWith("task:")) assert.ok(Math.hypot(point.x - root.x, point.y - root.y) > 170, "loose tasks do not share a cramped center ring");
    const parent = parents.get(id);
    if (parent && parent !== "root") {
      const host = seeds.get(parent);
      assert.ok(Math.hypot(point.x - host.x, point.y - host.y) < area.w * 0.22, "a child's connection remains local to its branch");
    }
  }
  // Existing positions win when another child arrives. The new child follows
  // its established parent instead of a rebalanced imaginary branch center.
  const fixed = new Map([["session:0", { x: 400, y: 500 }]]);
  const shifted = env.graphLayoutSeeds(projected, area, "constellation", parents, new Map(), fixed);
  assert.deepEqual(shifted.get("session:0"), fixed.get("session:0"));
  const child = "session:0:step:0", original = seeds.get(child), host = seeds.get("session:0");
  assert.ok(Math.abs(shifted.get(child).x - original.x - (400 - host.x)) < 1e-7);
  assert.ok(Math.abs(shifted.get(child).y - original.y - (500 - host.y)) < 1e-7);
});

test("dominant circular branches keep children beside their session instead of wrapping around the hub", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const area = { x: 40, y: 80, w: 1100, h: 700 };
  for (const layout of ["constellation", "radial"]) for (const sessionCount of [1, 2]) {
    const nodes = [{ id: "root", kind: "root" }, { id: "assistant", kind: "assistant" }, ...Array.from({ length: 3 }, (_, index) => ({ id: `loose:${index}`, kind: "task" }))];
    const parents = new Map([["assistant", "root"]]);
    for (let session = 0; session < sessionCount; session += 1) {
      const parent = `session:${session}`;
      nodes.push({ id: parent, kind: "session" }); parents.set(parent, "root");
      for (let child = 0; child < (session === 0 ? 14 : 2); child += 1) {
        const id = `${parent}:task:${child}`;
        nodes.push({ id, kind: "task" }); parents.set(id, parent);
      }
    }
    const projected = nodes.map((node) => ({ node, p: {} }));
    const points = env.graphLayoutSeeds(projected, area, layout, parents, new Map());
    const reversed = env.graphLayoutSeeds([...projected].reverse(), area, layout, parents, new Map());
    const hub = points.get("root");
    for (const [id, point] of points) {
      assert.deepEqual(reversed.get(id), point, `${layout} keeps the same sectors when display ordering changes`);
      const parentId = parents.get(id);
      if (!parentId?.startsWith("session:")) continue;
      const parent = points.get(parentId);
      const parentDirection = { x: (parent.x - hub.x) / area.w, y: (parent.y - hub.y) / area.h };
      const childDirection = { x: (point.x - hub.x) / area.w, y: (point.y - hub.y) / area.h };
      assert.ok(parentDirection.x * childDirection.x + parentDirection.y * childDirection.y > 0, `${layout} keeps ${id} on its session's side of the hub`);
      assert.ok(Math.hypot(point.x - parent.x, point.y - parent.y) < area.w * 0.45, `${layout} avoids a canvas-spanning connection for ${id}`);
    }
  }
});

test("circular overviews distribute loose task families across the canvas instead of clustering lexical IDs", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const area = { x: 28, y: 280, w: 1456, h: 780 };
  const nodes = [{ id: "root", kind: "root" }, { id: "assistant", kind: "assistant" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `session:${index}`, kind: "session" })),
    ...Array.from({ length: 16 }, (_, index) => ({ id: `task:${index}`, kind: "task" }))];
  const parents = new Map(nodes.filter((node) => node.kind === "session" || node.kind === "assistant").map((node) => [node.id, "root"]));
  for (const layout of ["constellation", "radial"]) {
    const points = env.graphLayoutSeeds(nodes.map((node) => ({ node, p: {} })), area, layout, parents, new Map());
    const hub = points.get("root"), quadrants = [0, 0, 0, 0];
    for (const node of nodes.filter((node) => node.kind === "task")) {
      const point = points.get(node.id);
      quadrants[Number(point.x >= hub.x) + Number(point.y >= hub.y) * 2] += 1;
    }
    assert.ok(quadrants.every((count) => count >= 3), `${layout} gives task families room in every quadrant (${quadrants.join(", ")})`);
  }
});

test("dominant circular branches use the long viewport dimension while keeping their children local", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const nodes = [{ id: "root", kind: "root" }, { id: "assistant", kind: "assistant" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `session:${index}`, kind: "session" })),
    ...Array.from({ length: 16 }, (_, index) => ({ id: `task:${index}`, kind: "task" }))];
  const parents = new Map(nodes.filter((node) => node.kind !== "root").map((node) => [node.id, node.kind === "task" ? "session:0" : "root"]));
  for (const layout of ["constellation", "radial"]) for (const [w, h] of [[1456, 780], [440, 700]]) {
    const area = { x: 28, y: 280, w, h };
    const points = env.graphLayoutSeeds(nodes.map((node) => ({ node, p: {} })), area, layout, parents, new Map());
    const hub = points.get("root"), parent = points.get("session:0");
    const children = nodes.filter((node) => node.kind === "task").map((node) => points.get(node.id));
    const axis = w >= h ? "x" : "y", side = w >= h ? "y" : "x";
    const span = Math.max(...children.map((point) => point[axis])) - Math.min(...children.map((point) => point[axis]));
    assert.ok(span > Math.max(w, h) * 0.62, `${layout} gives the dominant branch most of the ${axis} span (${span.toFixed(1)}px)`);
    assert.ok(Math.abs(parent[axis] - hub[axis]) < 1e-7, "the parent sits across the short viewport axis");
    assert.ok(children.every((point) => (point[side] - hub[side]) * (parent[side] - hub[side]) > 0), "all children stay on their parent's side of the hub");
  }
});

test("managed layout anchors transform coherently under zoom and Follow targets the displayed work", () => {
  for (const view of ["2d", "3d"]) {
    const { env, state } = graphContext(); Object.assign(state, { fit: 1, zoom: 1, view, nodeLayout: "radial", tasks: [], edges: [] });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    vm.runInContext(section("function followFrame(", "function updateFollowCamera("), env);
    const task = { id: "task:zoom", kind: "task", x: 200, y: -100, z: 120 };
    const area = env.usableArea(); const first = [{ node: task, p: env.project(task) }];
    env.layoutProjectedGraph(first, area, "orbit");
    const anchor = { ...task._layoutAnchor }, projected = env.project(anchor);
    assert.ok(Math.abs(projected.x - first[0].p.x) < 1e-7 && Math.abs(projected.y - first[0].p.y) < 1e-7);
    state.zoom = 1.4; state.camera.x = 20; state.camera.y = -15;
    const next = [{ node: task, p: env.project(task) }]; env.layoutProjectedGraph(next, area, "free");
    const expected = env.project(anchor);
    assert.ok(Math.abs(expected.x - next[0].p.x) < 1e-7 && Math.abs(expected.y - next[0].p.y) < 1e-7);
    const follow = env.followFrame({ node: task, context: [task] }, area, state);
    assert.ok(Math.abs(follow.x + anchor.x) < 1e-7 && Math.abs(follow.y + anchor.y) < 1e-7 && Math.abs(follow.z + anchor.z) < 1e-7);
  }
});

test("tidy Branches centers parent groups, uses the available height and separates dense sibling rows", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const nodes = [{ id: "root", kind: "root" }], parents = new Map();
  for (let session = 0; session < 4; session += 1) {
    const id = `session:${session}`; nodes.push({ id, kind: "session" }); parents.set(id, "root");
    for (let child = 0; child < 6; child += 1) { const tid = `${id}:todo:${child}`; nodes.push({ id: tid, kind: "todo" }); parents.set(tid, id); }
  }
  const projected = nodes.map((node) => ({ node, p: {} }));
  for (const width of [920, 500, 306]) {
    const area = { x: 20, y: 40, w: width, h: 680 };
    const points = env.graphLayoutSeeds(projected, area, "tree", parents, new Map());
    const again = env.graphLayoutSeeds([...projected].reverse(), area, "tree", parents, new Map());
    for (const [id, point] of points) assert.deepEqual(again.get(id), point, "input recency must not reorder a fresh tree");
    for (const node of nodes) {
      const point = points.get(node.id), radius = node.kind === "todo" ? 6 : 15;
      assert.ok(point.x - radius >= area.x && point.x + radius <= area.x + area.w);
      assert.ok(point.y - radius >= area.y && point.y + radius <= area.y + area.h);
      const parent = parents.get(node.id);
      if (parent) assert.ok(point.y > points.get(parent).y, "every primary child stays below its parent");
    }
    for (let session = 0; session < 4; session += 1) {
      const id = `session:${session}`, parent = points.get(id);
      const children = [...parents].filter(([, pid]) => pid === id).map(([child]) => points.get(child));
      assert.ok(Math.abs(parent.x - (Math.min(...children.map((p) => p.x)) + Math.max(...children.map((p) => p.x))) / 2) < 0.001);
    }
    const values = [...points.values()];
    assert.ok(Math.max(...values.map((p) => p.y)) - Math.min(...values.map((p) => p.y)) > area.h * 0.8, "branches use the canvas height instead of crowding its top");
    for (let a = 0; a < nodes.length; a += 1) for (let b = a + 1; b < nodes.length; b += 1) {
      const pa = points.get(nodes[a].id), pb = points.get(nodes[b].id);
      const min = (nodes[a].kind === "todo" ? 6 : 15) + (nodes[b].kind === "todo" ? 6 : 15);
      assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) > min, "visible sibling orbs do not overlap");
    }
  }
});

test("Branches chooses actual session parents deterministically and refuses secondary-link cycles", () => {
  const { env } = graphContext(); vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const projected = [{ node: { id: "root", kind: "root" } }, { node: { id: "session", kind: "session" } }, { node: { id: "task", kind: "task", anchorSessionId: "session" } }];
  const edges = [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 2 }, { a: 2, b: 0 }];
  const parents = env.primaryBranchParents(projected, edges);
  assert.equal(parents.get("task"), "session");
  for (const id of parents.keys()) {
    const seen = new Set(); let cursor = id;
    while (cursor) { assert.equal(seen.has(cursor), false); seen.add(cursor); cursor = parents.get(cursor); }
  }
  assert.deepEqual([...env.primaryBranchParents(projected, [...edges].reverse())], [...parents]);
});

test("managed display anchors survive role arrivals, removal, status changes and temporary task filtering", () => {
  const area = { x: 300, y: 150, w: 800, h: 600 };
  const state = { tasks: [{ id: "a" }, { id: "b" }], view: "2d" };
  const project = (world) => ({ x: 600 + world.x, y: 400 + world.y, depth: 800, k: 1 });
  const env = vm.createContext({ state, project, unprojectForLayout: (p, world) => ({ x: p.x - 600, y: p.y - 400, z: world.z }), Map, Set, Number, Math, String });
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const a = { id: "task:a", kind: "task", x: 0, y: 0, z: 1 };
  const b = { id: "task:b", kind: "task", x: 2, y: 4, z: 2 };
  const session = { id: "session", kind: "session", x: -40, y: -40, z: 0 };
  const run = (nodes, cardIds = new Set(["task:a"])) => {
    const projected = nodes.map((node) => ({ node, p: project(node) }));
    env.layoutProjectedGraph(projected, area, "orbit", cardIds);
    return new Map(projected.map(({ node, p }) => [node.id, [p.x, p.y]]));
  };
  const before = run([a, b, session]);
  const helper = { id: "__agent__:watcher", kind: "agent", x: 1, y: 2, z: 4 };
  const joined = run([helper, b, session, a]);
  for (const [id, position] of before) assert.deepEqual(joined.get(id), position, `${id} does not move when a helper joins`);
  const filtered = run([a, session]);
  for (const [id, position] of filtered) assert.deepEqual(position, before.get(id));
  assert.ok(state.screenLayout.nodes.has("task:b"), "a saved task keeps its place outside the visible subset");
  assert.equal(state.screenLayout.nodes.has(helper.id), false, "retired roles release their slot");
  a.state = "task"; b.state = "active";
  const changed = run([b, a, session], new Set(["task:b"]));
  for (const [id, position] of before) assert.deepEqual(changed.get(id), position, `${id} retains its anchor when work changes`);
  // Incoming simulation positions are not allowed to turn a managed point
  // into an idle animation; explicit camera projection remains available.
  session.x += 40; session.y += 20;
  assert.deepEqual(run([a, b, session]).get("session"), before.get("session"));
});

test("orb labels paint full clickable bounds and retain truthful compact work status", () => {
  const { env, el, state } = labelContext();
  const strings = [];
  el.ctx.fillText = (value) => strings.push(value);
  const node = { id: "task:current", kind: "task", label: "Refine navigation", state: "active", _workLabel: "Running", _pr: 12 };
  const projected = [{ node, p: { x: 720, y: 360, depth: 800, k: 1 } }];
  env.drawLabels(projected);
  assert.ok(node._label);
  assert.equal(node._cardRect, null);
  assert.ok(strings.includes("RUNNING") && strings.includes("Refine navigation"), "status and the complete title occupy separate lines");
  assert.equal(strings.some((value) => /%/.test(value)), false);
  Object.assign(node, { _px: 720, _py: 360 }); state.nodes = [node];
  vm.runInContext(section("function nodeAt(", "function bubbleAt("), env);
  assert.equal(env.nodeAt(node._label.x + 3, node._label.y + 3), node);
});

test("crowded working orbs keep their task titles by using clear whitespace without moving anchors", () => {
  const { env, el, state } = labelContext();
  let leaders = 0; el.ctx.lineTo = () => { leaders += 1; };
  const tasks = [0, 1, 2].map((index) => ({ node: { id: `task:busy:${index}`, kind: "task", label: `Current work ${index}`, state: "active", _workLabel: "Running", _pr: 15 }, p: { x: 840 + index * 32, y: 420, depth: 800, k: 1 } }));
  const crowd = Array.from({ length: 25 }, (_, index) => ({ node: { id: `quiet:${index}`, kind: "task", label: "Quiet", _pr: 11 }, p: { x: 770 + index % 5 * 35, y: 350 + Math.floor(index / 5) * 35, depth: 800, k: 1 } }));
  const anchors = tasks.map(({ p }) => [p.x, p.y]);
  env.drawLabels([...tasks, ...crowd]);
  assert.ok(tasks.every(({ node }) => node._label), "all three actual task titles remain visible");
  assert.ok(leaders > 0, "displaced labels retain a visible connection to their orb");
  assert.deepEqual(tasks.map(({ p }) => [p.x, p.y]), anchors);
  assert.ok(state.labelRects.length <= env.labelBudget());
  for (let i = 0; i < state.labelRects.length; i += 1) for (let j = i + 1; j < state.labelRects.length; j += 1) assert.equal(env.overlaps(state.labelRects[i], state.labelRects[j]), false);
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
  const state = { active: true, reactive: true, audioSource: "auto", audio, inputGeneration: 0, mediaElements: new WeakMap(), bands: {}, bus: { disconnect() {}, connect() {} } };
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

test("the rail retains finishing roles without making queued roles look active", async () => {
  const treeSource = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
  const assistant = { state: { agents: [{ role: "builder", status: "done" }, { role: "reference", status: "queued" }] } };
  const nodes = [{ id: "assistant", kind: "assistant" }, { id: "old-builder", kind: "agent", role: "builder", status: "running" }];
  const motions = new Map([["builder", { agent: { role: "builder" }, retiring: true, retired: false }]]);
  const env = vm.createContext({ assistant, nodes, motions, agentRoster: () => assistant.state.agents, assistantSummary: () => ({ tone: "ok", sublabel: "Ready" }), reconcileMotions() {} });
  vm.runInContext(treeSource.slice(treeSource.indexOf("function agentStateOf("), treeSource.indexOf("function rebuild()")), env);
  assert.equal(env.activeAgentRoster().length, 0);
  assert.equal(env.syncAssistantNode(), false, "a finishing builder must remain while it returns and fades");
  motions.get("builder").retired = true;
  assert.equal(env.syncAssistantNode(), true, "only a fully faded builder leaves the graph");
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
    active: true, reactive: true, captureArmed: false, audioSource: "auto", inputGeneration: 0, inputError: null,
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

test("task layout survives priority changes and new arrivals without moving existing work", () => {
  const env = vm.createContext({ Map, Set, Number, String, Math });
  vm.runInContext(section("function taskPlacements(", "// Open/active tasks"), env);
  const tasks = ["a", "b", "c"].map((id) => ({ id, title: `Fixture ${id}` }));
  const before = env.taskPlacements(tasks, [], []);
  const after = env.taskPlacements([{ id: "new", title: "Just arrived" }, tasks[2], tasks[0], tasks[1]], [], [], before.layout);
  const positions = (entries) => new Map(entries.map((entry) => [entry.task.id, [entry.x, entry.y, entry.z]]));
  const original = positions(before.entries);
  const changed = positions(after.entries);
  for (const task of tasks) assert.deepEqual(changed.get(task.id), original.get(task.id));
  const retired = env.taskPlacements([tasks[2], { id: "replacement", title: "New replacement" }], [], [], after.layout);
  assert.deepEqual(positions(retired.entries).get("c"), original.get("c"));
  assert.equal(retired.layout.size, 2, "retired tasks release their layout records");
  assert.equal(retired.layout.get("replacement").slot, 0, "new work can reuse the freed slot");
});

test("tasks join a newly assigned session and then retain their place through status changes and filtering", () => {
  const env = vm.createContext({ Map, Set, Number, String, Math });
  vm.runInContext(section("function taskPlacements(", "// Open/active tasks"), env);
  const task = { id: "stable", title: "Independent task" };
  const before = env.taskPlacements([task], [], []);
  const original = before.entries[0];
  const session = { id: "new-worker", kind: "session", x: 140, y: -60, z: 100, label: "Current worker" };
  const changed = env.taskPlacements([{ ...task, status: "active", priority: 10 }], [session], [{ taskId: task.id, sessionId: session.id }], before.layout);
  assert.equal(changed.entries[0].anchor.id, session.id, "the connection updates to the actual worker");
  assert.notDeepEqual([changed.entries[0].x, changed.entries[0].y, changed.entries[0].z], [original.x, original.y, original.z]);
  assert.ok(Math.hypot(changed.entries[0].x - session.x, changed.entries[0].z - session.z) <= 78, "new work joins its actual session's local ring");
  const assigned = { ...task, run: { sessionId: session.id } };
  const stable = env.taskPlacements([{ ...assigned, status: "awaiting_verification" }], [session], [], changed.layout);
  const settled = [changed.entries[0].x, changed.entries[0].y, changed.entries[0].z];
  assert.deepEqual([stable.entries[0].x, stable.entries[0].y, stable.entries[0].z], settled);
  const hidden = env.taskPlacements([], [], [], changed.layout, new Set([task.id]));
  assert.ok(hidden.layout.has(task.id));
  const restored = env.taskPlacements([assigned], [session], [], hidden.layout);
  assert.deepEqual([restored.entries[0].x, restored.entries[0].y, restored.entries[0].z], settled);
});

test("task connections prefer the actual worker and ignore a single generic matching word", () => {
  const env = vm.createContext({ Map, Set, Number, String, Math });
  vm.runInContext(section("function taskPlacements(", "// Open/active tasks"), env);
  const sessions = [
    { id: "similar", kind: "session", label: "Polish keyboard navigation", x: 100, y: 0, z: 50 },
    { id: "actual", kind: "session", label: "Implementation worker", x: -100, y: 30, z: -50 },
  ];
  const task = { id: "task", title: "Polish keyboard navigation" };
  const connected = env.taskPlacements([task], sessions, [{ taskId: "task", sessionId: "actual" }]);
  assert.equal(connected.entries[0].anchor.id, "actual");
  assert.equal(env.taskPlacements([{ id: "loose", title: "Polish color contrast" }], sessions, []).entries[0].anchor, null);
  assert.equal(env.taskPlacements([task], sessions, []).entries[0].anchor.id, "similar", "distinctive shared words still provide a fallback for older tasks");
});

test("session and active-role slots remain stable through recency reordering and completion", async () => {
  const tree = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
  const env = vm.createContext({ Map, Set, Number });
  vm.runInContext(tree.slice(tree.indexOf("function stableNodeSlots("), tree.indexOf("// Agent travel:")), env);
  const initial = env.stableNodeSlots(["one", "two", "three"]);
  const reordered = env.stableNodeSlots(["new", "three", "one", "two"], initial);
  for (const id of ["one", "two", "three"]) assert.equal(reordered.get(id), initial.get(id));
  const completed = env.stableNodeSlots(["three", "new"], reordered);
  assert.equal(completed.get("three"), initial.get("three"));
  assert.equal(completed.get("new"), reordered.get("new"));
  assert.equal(completed.has("one"), false);
  assert.equal(new Set(completed.values()).size, completed.size);
});

test("Follow labels emphasize the working task without repeating its title around every satellite", () => {
  const { env, state, taskA, taskB, nodes } = followContext();
  const focus = env.followCandidates(nodes, state.assistant.running, state.touches, 10000)[0];
  Object.assign(state, { follow: focus, labels: "auto", labelWidths: new Map(), query: "", matchSet: new Set() });
  const builder = { id: "builder:a", kind: "agent", builder: true, job: { taskId: "a" }, label: "Build garden", status: "running", startedAt: Date.now() - 20000 };
  const helper = { id: "agent:reference", kind: "agent", role: "reference", label: "reference · Build garden", status: "running", targetId: taskA.id };
  const quiet = { id: "task:quiet", kind: "task", label: "Queued backlog", state: "task" };
  const pending = { id: "todo:pending", kind: "todo", sessionId: "sa", label: "Later work", status: "pending" };
  taskA._workLabel = taskB._workLabel = "Running";
  const allNodes = [...nodes, builder, helper, quiet, pending, { id: "music", kind: "music", label: "Music" }];
  vm.runInContext(source.slice(source.indexOf("const LABEL_FONT ="), source.indexOf("// Node life-cycle:")), env);
  vm.runInContext(section("function followsNode(", "// Animation state belongs"), env);
  vm.runInContext(section("function measure(ctx", "// ---------- hover tooltip"), env);
  const projected = allNodes.map((node) => ({ node, p: { k: 1, depth: 800 } }));
  const labels = () => Array.from(env.labelCandidates(projected), (entry) => entry.node.id);
  for (const id of [taskA.id, taskB.id, "todo:a", builder.id, helper.id, "music"]) assert.ok(labels().includes(id), `${id} retains context`);
  for (const id of ["sa", "maintenance", quiet.id, pending.id]) assert.equal(labels().includes(id), false, `${id} does not clutter automatic Follow labels`);
  assert.equal(env.emphasis(builder), 1);
  assert.equal(env.emphasis(helper), 1);
  assert.equal(env.emphasis(quiet), 0.2);
  const ctx = { measureText: (text) => ({ width: text.length * 6 }) };
  assert.match(env.labelText(ctx, builder, "font"), /^Builder · \d+s$/);
  assert.equal(env.labelText(ctx, helper, "font"), "reference");
  assert.equal(helper.label, "reference · Build garden", "the full target remains available for search and details");
  state.labels = "all";
  assert.ok(labels().includes(quiet.id));
  state.labels = "auto";
  state.query = "Queued";
  state.matchSet.add(quiet.id);
  assert.ok(labels().includes(quiet.id), "search can reveal work outside the followed task");
});

test("the rounded task frame and its label remain clickable within the graph viewport", () => {
  const task = { id: "task:a", kind: "task", _px: 100, _py: 100, _pr: 18, _label: { x: 130, y: 90, w: 160, h: 18 } };
  const state = { camMode: "follow", nodes: [task] };
  const env = vm.createContext({ Math, state, usableArea: () => ({ x: 50, y: 50, w: 300, h: 200 }) });
  vm.runInContext(section("function nodeAt(", "function bubbleAt("), env);
  assert.equal(env.nodeAt(119, 119), task, "a visible frame corner is a task hit");
  assert.equal(env.nodeAt(200, 100), task, "its title remains a target");
  assert.equal(env.nodeAt(10, 100), null, "the activity panel cannot accidentally select a clipped node");
  assert.equal(env.nodeAt(325, 200), null);
});

test("every layout has real stable 3D depth and an orderly flat 2D counterpart", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) {
    const { env, state } = graphContext();
    Object.assign(state, { fit: 1, view: "3d", nodeLayout: layout, tasks: [] });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const nodes = [{ id: "root", kind: "root", x: 0, y: 0, z: 0 }];
    for (let group = 0; group < 4; group += 1) {
      nodes.push({ id: `session:${group}`, kind: "session", x: group * 20, y: 0, z: 0 });
      for (let item = 0; item < 3; item += 1) nodes.push({ id: `todo:${group}:${item}`, sessionId: `session:${group}`, kind: "todo", x: item * 10, y: group * 10, z: 0 });
    }
    state.edges = nodes.slice(1).map((node) => ({ a: nodes.findIndex((candidate) => candidate.id === (node.sessionId ?? "root")), b: nodes.indexOf(node) }));
    const area = env.usableArea();
    const run = () => { const projected = nodes.map((node) => ({ node, p: env.project(node) })); env.layoutProjectedGraph(projected, area, "orbit"); return projected; };
    const initial = run();
    const depths = initial.map(({ p }) => p.depth);
    assert.ok(Math.max(...depths) - Math.min(...depths) > 40, `${layout} is a volume, not a flat billboard`);
    for (const { p } of initial) assert.ok(p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h, `${layout} fits at rest`);
    const anchors = new Map(nodes.map((node) => [node.id, { ...node._layoutAnchor }]));
    state.angle += 0.45;
    const rotated = run();
    assert.ok(rotated.some(({ p }, index) => Math.hypot(p.x - initial[index].p.x, p.y - initial[index].p.y) > 12), `${layout} responds to camera rotation`);
    for (const node of nodes) assert.deepEqual({ ...node._layoutAnchor }, anchors.get(node.id), `${layout} anchors do not drift`);
    state.view = "2d";
    const flat = run();
    assert.ok(flat.every(({ p }) => p.depth === 500), `${layout} retains a genuine flat mode`);
  }
});

test("a complete overview orbit keeps fixed nodes clear of panel clipping", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) {
    const { env, state } = graphContext({ width: 1920, height: 1170 });
    Object.assign(state, { fit: 1, view: "3d", nodeLayout: layout, tasks: [] });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: i ? `task:${i}` : "root", kind: i ? "task" : "root", x: 0, y: 0, z: 0 }));
    state.edges = nodes.slice(1).map((_, i) => ({ a: Math.floor(i / 4), b: i + 1 }));
    const area = env.usableArea();
    const run = (mode = "orbit") => {
      const points = nodes.map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(points, area, mode);
      return points;
    };
    run();
    const saved = nodes.map((node) => ({ ...node._layoutAnchor }));
    for (let step = 0; step <= 32; step++) {
      state.angle = .5 + step * Math.PI / 16;
      for (const { p } of run()) assert.ok(p.x - 25 >= area.x - 1e-6 && p.x + 25 <= area.x + area.w + 1e-6 && p.y - 25 >= area.y - 1e-6 && p.y + 25 <= area.y + area.h + 1e-6, `${layout} retains complete node surfaces at step ${step}`);
      nodes.forEach((node, i) => assert.deepEqual({ ...node._layoutAnchor }, saved[i], "fitting cannot rearrange saved world anchors"));
    }
    state.angle = 2;
    const overview = run();
    const free = run("free");
    free.forEach(({ node, p }, i) => {
      assert.deepEqual({ ...p }, { ...overview[i].p }, "handing control to the user must not jump out of the fitted view");
      const world = env.unprojectForLayout(p, node._layoutAnchor);
      const back = env.project(world);
      assert.ok(Math.hypot(back.x - p.x, back.y - p.y) < 1e-6, "fitted projection remains invertible for new arrivals");
    });
    state.camera.x = -10000;
    assert.ok(run("free").some(({ p }) => p.x < area.x || p.x > area.x + area.w), "manual pan remains under user control");
  }
});

test("circular 3D views retain meaningful volume and separate work rims through modest camera turns", () => {
  for (const layout of ["constellation", "radial"]) for (const width of [1100, 1456]) for (const family of ["loose", "dominant", "several"]) {
    const { env, state } = graphContext();
    const area = { x: 28, y: 280, w: width, h: 780 };
    Object.assign(state, { fit: 1, view: "3d", nodeLayout: layout, tasks: [], settingsPreview: area });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const nodes = [{ id: "root", kind: "root" }, { id: "assistant", kind: "assistant" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `session:${index}`, kind: "session" })),
      ...Array.from({ length: 16 }, (_, index) => ({ id: `task:${index}`, kind: "task", _workLabel: index % 3 === 0 ? "Running" : null })),
    ].map((node) => ({ ...node, x: 0, y: 0, z: 0 }));
    state.edges = nodes.flatMap((node, index) => index ? [{
      a: node.kind === "task" ? family === "loose" ? 0 : family === "dominant" ? 2 : 2 + (index - 10) % 4 : 0,
      b: index,
    }] : []);
    const run = () => {
      const points = nodes.map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(points, area, "orbit", 1000, true);
      return points;
    };
    const first = run();
    const depths = first.map(({ p }) => p.depth);
    const shortSide = Math.min(area.w, area.h);
    assert.ok(Math.max(...depths) - Math.min(...depths) > shortSide * 0.2, `${layout} depth remains substantial relative to the graph, including after its initial fit`);
    const anchors = nodes.map((node) => ({ ...node._layoutAnchor }));
    // A tilted billboard has a depth range too. Fit the closest depth plane
    // and require substantial remaining curvature through the whole cloud.
    const cloud = anchors.map((point) => [point.x * Math.cos(state.angle) - point.z * Math.sin(state.angle), point.y, point.x * Math.sin(state.angle) + point.z * Math.cos(state.angle)]);
    const center = [0, 1, 2].map((axis) => cloud.reduce((sum, point) => sum + point[axis], 0) / cloud.length);
    const centered = cloud.map((point) => point.map((value, axis) => value - center[axis]));
    const product = (a, b) => centered.reduce((sum, point) => sum + point[a] * point[b], 0);
    const xx = product(0, 0), yy = product(1, 1), xy = product(0, 1), xz = product(0, 2), yz = product(1, 2);
    const determinant = xx * yy - xy * xy;
    const slopeX = (xz * yy - yz * xy) / determinant, slopeY = (yz * xx - xz * xy) / determinant;
    const thickness = Math.sqrt(centered.reduce((sum, [x, y, z]) => sum + (z - slopeX * x - slopeY * y) ** 2, 0) / cloud.length);
    assert.ok(Number.isFinite(thickness) && thickness > shortSide * 0.04, `${layout} retains a curved volume instead of a flat or tilted field (${thickness.toFixed(1)}px)`);
    const surfaceRadius = ({ node, p }) => {
      const working = node._workLabel === "Running";
      const base = node.kind === "task" ? 12 : node.kind === "assistant" ? 15 : 11;
      const radius = Math.min(working || node.kind === "assistant" ? 15 : 11, base * Math.max(0.75, Math.min(1.15, p.k)));
      return radius + (working ? 9 : 0);
    };
    for (const yaw of [-0.45, -0.25, 0, 0.25, 0.45]) for (const pitch of [-0.2, 0, 0.2]) {
      state.angle = 0.5 + yaw; state.pitch = pitch;
      const points = run();
      for (let a = 0; a < points.length; a += 1) for (let b = 0; b < a; b += 1) {
        const distance = Math.hypot(points[a].p.x - points[b].p.x, points[a].p.y - points[b].p.y);
        assert.ok(distance >= surfaceRadius(points[a]) + surfaceRadius(points[b]) + 1,
          `${layout}/${family}/${width}px yaw ${yaw} pitch ${pitch}: ${points[a].node.id} and ${points[b].node.id} keep distinct surfaces`);
      }
      nodes.forEach((node, index) => assert.deepEqual({ ...node._layoutAnchor }, anchors[index], "camera movement cannot rearrange world anchors"));
    }
  }
});

test("verification stays distinct from running work even when its saved graph state is active", () => {
  const state = { selected: null, hoverNode: null };
  const NODE_RGB = { warm: [230,201,141], verify: [151,179,244], task: [140,155,180], dust: [157,183,255] };
  const env = vm.createContext({ state, NODE_RGB });
  vm.runInContext(section("function colorOf(", "function setSettingsPreview("), env);
  const verifying = { id: "a-check", kind: "task", state: "active", _workLabel: "Verifying", task: { status: "awaiting_verification" } };
  const running = { id: "z-build", kind: "task", state: "active", _workLabel: "Running" };
  assert.deepEqual(env.colorOf(verifying), NODE_RGB.verify);
  assert.deepEqual(env.colorOf(running), NODE_RGB.warm);
  assert.equal(env.nodeVisualProfile(verifying).prominent, false);
  assert.equal(env.nodeVisualProfile(running).prominent, true);
  const labels = labelContext();
  const projected = [verifying, running].map((node) => ({ node, p: { k: 1, depth: 800 } }));
  assert.deepEqual(Array.from(labels.env.labelCandidates(projected), ({ node }) => node.id), [running.id, verifying.id]);
});

test("the Void collection's styles pass the Command style allowlist; unknown keys still do not", () => {
  const state = { nodeStyle: "orbs", nodeLayout: "constellation", screenLayout: null, active: false };
  let fits = 0;
  const env = vm.createContext({ state, el: { width: 0, height: 0 }, refitLayout: () => { fits += 1; } });
  vm.runInContext(section("function applyTreePreferences(", "function traceNodeSurface("), env);
  for (const style of ["singularity", "prism", "sigil"]) {
    env.applyTreePreferences({ nodeStyle: style, nodeLayout: "constellation" });
    assert.equal(state.nodeStyle, style);
  }
  for (const bad of ["invalid", "__proto__", "Prism", null]) {
    env.applyTreePreferences({ nodeStyle: bad });
    assert.equal(state.nodeStyle, "sigil", String(bad));
  }
  assert.equal(fits, 0, "a style change never reflows the layout");
  // With music.js present its style list is the one that counts.
  const asked = [];
  const music = vm.createContext({ state, el: { width: 0, height: 0 }, refitLayout: () => { fits += 1; }, window: { MefiMusic: { isNodeStyle: (key) => { asked.push(key); return key === "nebula"; } } } });
  vm.runInContext(section("function applyTreePreferences(", "function traceNodeSurface("), music);
  music.applyTreePreferences({ nodeStyle: "nebula" });
  assert.equal(state.nodeStyle, "nebula", "a style music.js knows passes");
  music.applyTreePreferences({ nodeStyle: "prism" });
  assert.equal(state.nodeStyle, "nebula", "a style music.js does not list is refused");
  assert.deepEqual(asked, ["nebula", "prism"]);
});

test("checkpoint click targets cannot be covered by task labels", () => {
  const { env, state } = labelContext();
  const note = { id: "session:note", kind: "session", _pr: 10, _bubble: { x: 748, y: 350, w: 22, h: 21 } };
  const task = { id: "task:busy", kind: "task", label: "Read the evidence", state: "active", _workLabel: "Running", _pr: 12 };
  env.drawLabels([{ node: task, p: { x: 720, y: 360, k: 1 } }, { node: note, p: { x: 850, y: 420, k: 1 } }]);
  assert.ok(task._label);
  assert.ok(state.labelRects.every((rect) => !env.overlaps(rect, note._bubble)), "paint and padding leave note targets available");
});

function hierarchyLayoutFixture() {
  // IDs deliberately sort children before their parents and the root last.
  const nodes = [{ id: "z:root", kind: "root" }], parents = new Map();
  for (const [branch, count] of [1, 4, 7, 2].entries()) {
    const id = `parent:${branch}`;
    nodes.push({ id, kind: "session" }); parents.set(id, "z:root");
    for (let child = 0; child < count; child += 1) {
      const childId = `child:${branch}:${child}`;
      nodes.push({ id: childId, kind: child === 0 ? "task-group" : "task" }); parents.set(childId, id);
    }
  }
  nodes.push({ id: "a:obligation", kind: "task" }); parents.set("a:obligation", "child:1:0");
  return { nodes, parents, projected: nodes.map((node) => ({ node, p: {} })) };
}

test("Rings uses the wide canvas and keeps obligations outside their actual parent tier", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const { projected, parents } = hierarchyLayoutFixture();
  const area = { x: 28, y: 250, w: 1460, h: 760 };
  const points = env.graphLayoutSeeds(projected, area, "radial", parents, new Map());
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const reach = (point) => Math.hypot((point.x - cx) / area.w, (point.y - cy) / area.h);
  assert.ok(reach(points.get("z:root")) < 1e-8, "the root is the shared center");
  for (const [id, parent] of parents) assert.ok(reach(points.get(id)) > reach(points.get(parent)) + 0.015, `${id} advances beyond its actual parent regardless of node kind`);
  const xs = [...points.values()].map((point) => point.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > area.w * 0.65, "a wide graph does not leave most of its horizontal space unused");
  const reversed = env.graphLayoutSeeds([...projected].reverse(), area, "radial", parents, new Map());
  for (const [id, point] of points) assert.deepEqual(reversed.get(id), point, "recency cannot scramble the branch sectors");
});

test("Helix keeps each branch contiguous with parents before descendants", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const { projected, parents } = hierarchyLayoutFixture();
  const area = { x: 40, y: 80, w: 1100, h: 720 };
  const points = env.graphLayoutSeeds(projected, area, "helix", parents, new Map());
  const ordered = [...points].sort(([, a], [, b]) => a.y - b.y).map(([id]) => id);
  assert.equal(ordered[0], "z:root", "the root leads even when its ID sorts last");
  for (const [id, parent] of parents) assert.ok(points.get(id).y > points.get(parent).y, `${parent} precedes ${id}`);
  for (let branch = 0; branch < 4; branch += 1) {
    const root = `parent:${branch}`;
    const indices = ordered.flatMap((id, index) => {
      let cursor = id;
      while (cursor && cursor !== root) cursor = parents.get(cursor);
      return cursor === root ? [index] : [];
    });
    assert.equal(Math.max(...indices) - Math.min(...indices) + 1, indices.length, "unrelated branches cannot split a session from its obligations");
  }
  const reversed = env.graphLayoutSeeds([...projected].reverse(), area, "helix", parents, new Map());
  for (const [id, point] of points) assert.deepEqual(reversed.get(id), point);
});

test("Terraces has centered level rows distinct from the subtree-centered Branches layout", () => {
  const { env } = graphContext();
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const { projected, parents } = hierarchyLayoutFixture();
  const area = { x: 40, y: 80, w: 1100, h: 720 };
  const terraces = env.graphLayoutSeeds(projected, area, "layers", parents, new Map());
  const branches = env.graphLayoutSeeds(projected, area, "tree", parents, new Map());
  const levels = new Map();
  for (const [id, point] of terraces) {
    let depth = 0, cursor = parents.get(id);
    while (cursor) { depth += 1; cursor = parents.get(cursor); }
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth).push(point);
    const parent = parents.get(id);
    if (parent) assert.ok(point.y > terraces.get(parent).y);
  }
  for (const row of levels.values()) {
    const xs = row.map((point) => point.x);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - area.x - area.w / 2) < 1, "sparse levels remain centered rather than leaning toward one large subtree");
  }
  assert.ok([...terraces].filter(([id, point]) => Math.hypot(point.x - branches.get(id).x, point.y - branches.get(id).y) > 20).length >= 5, "the two layout choices offer visibly different arrangements");
  const reversed = env.graphLayoutSeeds([...projected].reverse(), area, "layers", parents, new Map());
  for (const [id, point] of terraces) assert.deepEqual(reversed.get(id), point);
});

test("all five layouts leave room for working node rings in every style and both views", () => {
  const { nodes, parents } = hierarchyLayoutFixture();
  const edges = [...parents].map(([id, parent]) => ({ a: nodes.findIndex((node) => node.id === parent), b: nodes.findIndex((node) => node.id === id) }));
  for (const width of [1100, 440]) for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) for (const view of ["2d", "3d"]) {
    let original;
    for (const style of ["orbs", "glass", "minimal", "halo", "crystal"]) {
      const { env, state } = graphContext();
      const area = { x: 28, y: 170, w: width, h: 720 };
      Object.assign(state, { fit: 1, view, nodeLayout: layout, nodeStyle: style, settingsPreview: area, tasks: [], edges, orbitTrails: true, extraGlow: true });
      vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
      const projected = nodes.map((node) => ({ node: { ...node, x: 0, y: 0, z: 0, state: "active", _workLabel: "Running" }, p: { x: 0, y: 0 } }));
      env.layoutProjectedGraph(projected, area, "orbit");
      const positions = projected.map(({ p }) => [p.x, p.y]);
      if (original) assert.deepEqual(positions, original, "every style shares the same readable layout spacing");
      else original = positions;
      for (const { p } of projected) assert.ok(p.x - 15 >= area.x && p.x + 15 <= area.x + area.w && p.y - 15 >= area.y && p.y + 15 <= area.y + area.h, `${layout}/${view}/${style} fits its node surfaces at ${width}px`);
      for (let a = 0; a < positions.length; a += 1) for (let b = a + 1; b < positions.length; b += 1) {
        const distance = Math.hypot(positions[a][0] - positions[b][0], positions[a][1] - positions[b][1]);
        assert.ok(distance >= 47.9, `${layout}/${view}/${style} leaves distinct working rings at ${width}px (${nodes[a].id}, ${nodes[b].id}: ${distance.toFixed(1)}px)`);
      }
    }
  }
});

test("newly revealed descendants follow their established parent in every layout", () => {
  const area = { x: 40, y: 80, w: 1100, h: 720 };
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) {
    const { env, state } = graphContext();
    Object.assign(state, { fit: 1, view: "2d", nodeLayout: layout, settingsPreview: area, tasks: [] });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const nodes = [
      { id: "root", kind: "root", x: 0, y: 0, z: 0 },
      { id: "session", kind: "session", x: 0, y: 0, z: 0 },
      { id: "task:child", kind: "task", x: 0, y: 0, z: 0 },
      { id: "task:obligation", kind: "task", x: 0, y: 0, z: 0 },
    ];
    const parents = new Map([["session", "root"], ["task:child", "session"], ["task:obligation", "task:child"]]);
    const run = (visible) => {
      state.edges = visible.slice(1).map((node, index) => ({ a: index, b: index + 1 }));
      const projected = visible.map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(projected, area, "orbit");
      return new Map(projected.map(({ node, p }) => [node.id, p]));
    };
    run(nodes.slice(0, 2));
    // A parent can already have a different managed position because of a
    // collision or an earlier, smaller board. Expansion must honor it.
    const original = env.graphLayoutSeeds(nodes.map((node) => ({ node, p: {} })), area, layout, parents, new Map());
    const parent = original.get("session"), established = { x: parent.x + 70, y: parent.y - 45 };
    const saved = env.unprojectForLayout(established, nodes[1]);
    state.screenLayout.nodes.set("session", { world: saved });
    const moved = run(nodes);
    assert.ok(Math.hypot(moved.get("session").x - established.x, moved.get("session").y - established.y) < 1e-7, `${layout} preserves the saved parent`);
    for (const id of ["task:child", "task:obligation"]) {
      const before = original.get(id), after = moved.get(id);
      assert.ok(Math.abs(after.x - before.x - 70) < 1e-7 && Math.abs(after.y - before.y + 45) < 1e-7, `${layout} keeps the incoming ${id} with its established branch`);
    }
  }
});

function reassignedBranchFixture(layout, view) {
  const { env, state } = graphContext();
  const area = { x: 40, y: 80, w: 1100, h: 720 };
  Object.assign(state, { fit: 1, view, nodeLayout: layout, settingsPreview: area, tasks: [{ id: "parent" }, { id: "child" }] });
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const nodes = ["root", "a", "b", "task:parent", "task:child", "spare", "zz:child"].map((id, index) => ({
    id, kind: index === 0 ? "root" : index < 3 ? "session" : "task", x: 0, y: 0, z: 0,
  }));
  const parents = new Map([["a", "root"], ["b", "root"], ["task:parent", "a"], ["task:child", "task:parent"], ["spare", "b"], ["zz:child", "spare"]]);
  const run = (visible = nodes) => {
    state.nodes = visible;
    state.edges = [...parents].map(([child, parent]) => ({ a: visible.findIndex((node) => node.id === parent), b: visible.findIndex((node) => node.id === child) })).filter((edge) => edge.a >= 0 && edge.b >= 0);
    const projected = visible.map((node) => ({ node, p: env.project(node) }));
    env.layoutProjectedGraph(projected, area, "free", 1000, true);
    return new Map(projected.map(({ node, p }) => [node.id, { x: p.x, y: p.y }]));
  };
  return { nodes, parents, run };
}

const graphPointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("reassigned tasks and their descendants organize beside their new session in every layout and view", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) for (const view of ["2d", "3d"]) {
    const { nodes, parents, run } = reassignedBranchFixture(layout, view);
    const before = run();
    parents.set("task:parent", "b");
    const after = run([...nodes].reverse());
    const oldDistance = graphPointDistance(before.get("task:parent"), before.get("b"));
    const newDistance = graphPointDistance(after.get("task:parent"), after.get("b"));
    assert.ok(newDistance < oldDistance * 0.65 && newDistance < 310, `${layout}/${view} shortens the task's new session connection (${oldDistance.toFixed(1)} → ${newDistance.toFixed(1)})`);
    for (const id of ["task:parent", "task:child"]) assert.ok(graphPointDistance(after.get(id), before.get(id)) > 80, `${layout}/${view} moves ${id} with the reassigned branch`);
    assert.ok(graphPointDistance(after.get("task:parent"), after.get("task:child")) < 280, `${layout}/${view} keeps obligations beside their task`);
    for (const id of ["root", "a", "b", "spare", "zz:child"]) assert.ok(graphPointDistance(after.get(id), before.get(id)) < 1e-7, `${layout}/${view} keeps unrelated work still`);
    nodes[3].state = "active";
    const agent = { id: "helper", kind: "agent", role: "builder", targetId: "task:parent", x: 10, y: 0, z: 0 };
    const repeated = run([agent, ...nodes]);
    for (const [id, point] of after) assert.ok(graphPointDistance(repeated.get(id), point) < 1e-7, `${layout}/${view} status, input order and worker arrival do not restart organization`);
    const reordered = reassignedBranchFixture(layout, view);
    reordered.run([...reordered.nodes].reverse());
    reordered.parents.set("task:parent", "b");
    const reorderedResult = reordered.run();
    for (const [id, point] of after) assert.ok(graphPointDistance(reorderedResult.get(id), point) < 1e-7, `${layout}/${view} organizes the same topology deterministically`);
  }
});

test("hidden descendants return beside their task after its session changes", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) for (const view of ["2d", "3d"]) {
    const { nodes, parents, run } = reassignedBranchFixture(layout, view);
    const before = run();
    const collapsed = nodes.filter((node) => node.id !== "task:child");
    run(collapsed);
    parents.set("task:parent", "b");
    const moved = run(collapsed);
    const restored = run([...nodes].reverse());
    assert.ok(graphPointDistance(restored.get("task:child"), before.get("task:child")) > 80, `${layout}/${view} does not restore a child to the abandoned branch`);
    assert.ok(graphPointDistance(restored.get("task:child"), restored.get("task:parent")) < 280, `${layout}/${view} restores a local task connection`);
    assert.ok(graphPointDistance(restored.get("task:parent"), moved.get("task:parent")) < 1e-7, `${layout}/${view} expansion preserves the task's new position`);
  }
});

test("working and returning agents draw one connection to their current host", () => {
  const assistant = { node: { id: "assistant", kind: "assistant" }, p: { x: 50, y: 80 } };
  const task = { node: { id: "task", kind: "task" }, p: { x: 850, y: 480 } };
  const agent = { node: { id: "agent", kind: "agent", role: "builder", targetNode: task.node }, p: { x: 890, y: 480 } };
  const state = { nodeLayout: "tree", edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 2 }], branchParents: new Map([["task", "assistant"]]), agentLayout: new Map([["agent", { hostId: "task" }]]) };
  const env = vm.createContext({ state, Math, Map, NODE_RGB: { task: [1, 2, 3] }, rgba: () => "color", agentRgb: () => [1, 2, 3], colorOf: () => [1, 2, 3], isBusyNode: () => false });
  vm.runInContext(section("function drawGraphConnections(", "function drawFrame("), env);
  let paths = [], path;
  const ctx = { beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, bezierCurveTo(...points) { path.push(points.slice(-2)); }, stroke() { paths.push(path); } };
  const render = () => { paths = []; env.drawGraphConnections(ctx, [assistant, task, agent], new Set()); return paths; };
  assert.deepEqual(render(), [[[50, 80], [850, 480]], [[890, 480], [850, 480]]], "the real branch remains and the worker has one local tether, without a distant assistant tether");
  state.agentLayout.set("agent", { hostId: "assistant" });
  assert.deepEqual(render(), [[[50, 80], [850, 480]], [[890, 480], [50, 80]]], "return flights use the managed host even while the previous target is still present");
  agent.node._absorbed = true;
  assert.deepEqual(render(), [[[50, 80], [850, 480]]], "absorbed workers leave no residual connection");
});

test("builder satellites clear their host work rim without moving its saved anchor", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) for (const view of ["2d", "3d"]) {
    const { env, state } = graphContext();
    Object.assign(state, { fit: 1, view, nodeLayout: layout, tasks: [], edges: [] });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const host = { id: "task:working", kind: "task", x: 0, y: 0, z: 0, _workLabel: "Running" };
    const area = env.usableArea();
    const first = [{ node: host, p: env.project(host) }];
    env.layoutProjectedGraph(first, area, "orbit");
    const original = { ...host._layoutAnchor };
    for (const offset of [0, 1, 10]) {
      const agent = { id: "agent:builder", kind: "agent", status: "running", hostId: host.id, x: offset, y: 0, z: offset };
      const projected = [host, agent].map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(projected, area, "orbit");
      const [hostPoint, agentPoint] = projected.map(({ p }) => p);
      assert.ok(Math.hypot(hostPoint.x - agentPoint.x, hostPoint.y - agentPoint.y) >= 37.99, `${layout}/${view} keeps the builder outside its host ring`);
      assert.deepEqual({ ...host._layoutAnchor }, original, "a builder arrival cannot move the task it works on");
      assert.deepEqual([agent.x, agent.y, agent.z], [offset, 0, offset], "display clearance leaves simulation coordinates intact");
      assert.equal(agent._layoutAnchor, null, "a moving worker does not acquire a fixed graph slot");
    }
  }
});

test("parallel builder satellites avoid neighboring work and panel edges", () => {
  const { env, state } = graphContext();
  const area = { x: 40, y: 80, w: 440, h: 480 };
  Object.assign(state, { fit: 1, view: "2d", nodeLayout: "constellation", settingsPreview: area, tasks: [], edges: [] });
  vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
  const host = { id: "task:working", kind: "task", x: 0, y: 0, z: 0 };
  const neighbor = { id: "task:neighbor", kind: "task", x: 0, y: 0, z: 0 };
  env.layoutProjectedGraph([host, neighbor].map((node) => ({ node, p: env.project(node) })), area, "orbit");
  const hostPoint = { x: area.x + area.w - 29, y: area.y + 29 };
  const neighborPoint = { x: hostPoint.x - 52, y: hostPoint.y };
  for (const [node, point] of [[host, hostPoint], [neighbor, neighborPoint]]) state.screenLayout.nodes.set(node.id, { world: env.unprojectForLayout(point, node) });
  const workers = Array.from({ length: 3 }, (_, index) => ({ id: `agent:${index}`, kind: "agent", status: "running", hostId: host.id, x: 0, y: 0, z: 0 }));
  const projected = [host, neighbor, ...workers].map((node) => ({ node, p: env.project(node) }));
  env.layoutProjectedGraph(projected, area, "orbit");
  const agents = projected.slice(2).map(({ p }) => p);
  for (const point of agents) {
    assert.ok(point.x - 13 >= area.x && point.x + 13 <= area.x + area.w && point.y - 13 >= area.y && point.y + 13 <= area.y + area.h, "panel boundaries do not clip a builder's surface");
    for (const task of [hostPoint, neighborPoint]) assert.ok(Math.hypot(point.x - task.x, point.y - task.y) >= 40.99, "workers clear both their host rim and nearby work");
  }
  for (let a = 0; a < agents.length; a += 1) for (let b = a + 1; b < agents.length; b += 1) assert.ok(Math.hypot(agents[a].x - agents[b].x, agents[a].y - agents[b].y) >= 28.99, "parallel builders remain separate hit targets");
  assert.ok(Math.hypot(projected[0].p.x - hostPoint.x, projected[0].p.y - hostPoint.y) < 1e-7);
  assert.ok(Math.hypot(projected[1].p.x - neighborPoint.x, projected[1].p.y - neighborPoint.y) < 1e-7);
  const savedHost = { ...host._layoutAnchor };
  state.camera.x -= 1000;
  const panned = [host, neighbor, ...workers].map((node) => ({ node, p: env.project(node) }));
  env.layoutProjectedGraph(panned, area, "free");
  assert.ok(panned.slice(2).every(({ p }) => p.x + 13 < area.x), "panning a host offscreen carries its builders along instead of pinning them to the panel edge");
  assert.deepEqual({ ...host._layoutAnchor }, savedHost);
});

test("dense 277px node trees retain a readable running task name clear of nodes and controls", () => {
  for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) for (const view of ["2d", "3d"]) {
    const { env, el, state } = labelContext({ width: 1001, height: 943, chat: true });
    Object.assign(state, { fit: 1, view, nodeLayout: layout, tasks: [], orbitTrails: true });
    vm.runInContext(section("function graphLayoutSeeds(", "function hexToRgb("), env);
    const area = env.usableArea();
    assert.equal(area.w, 277, "the fixture reproduces the canvas left between expanded panels");
    const nodes = [
      { id: "root", kind: "root", label: "Workspace" },
      { id: "assistant", kind: "assistant", label: "Assistant" },
      { id: "music", kind: "music", label: "Music" },
      { id: "group:0", kind: "task-group", label: "Project work" },
      { id: "group:1", kind: "task-group", label: "Review work" },
    ];
    const parents = new Map(nodes.slice(1).map((node) => [node.id, "root"]));
    for (let session = 0; session < 4; session += 1) {
      const id = `session:${session}`;
      nodes.push({ id, kind: "session", label: `Session ${session + 1}` }); parents.set(id, "root");
      for (let todo = 0; todo < 6; todo += 1) {
        const child = `todo:${session}:${todo}`;
        nodes.push({ id: child, kind: "todo", sessionId: id, label: `Session step ${todo + 1}` }); parents.set(child, id);
      }
    }
    for (let task = 0; task < 12; task += 1) {
      const id = `task:${task}`;
      nodes.push({ id, kind: "task", label: task < 3 ? `Improve renderer ${task + 1}` : `Saved project task ${task + 1}`, state: task < 3 ? "active" : "task", _workLabel: task < 3 ? "Running" : null });
      parents.set(id, `session:${task % 4}`);
    }
    for (let worker = 0; worker < 3; worker += 1) nodes.push({ id: `agent:${worker}`, kind: "agent", status: "running", hostId: `task:${worker}`, label: `Builder ${worker + 1}` });
    assert.equal(nodes.length, 48);
    for (const node of nodes) {
      Object.assign(node, { x: 0, y: 0, z: 0, _pr: node.kind === "todo" ? 5 : node._workLabel === "Running" ? 15 : 11 });
      if (node._workLabel === "Running") node._orbitTrail = { radius: 24 };
    }
    state.nodes = nodes;
    state.edges = [...parents].map(([id, parent]) => ({ a: nodes.findIndex((node) => node.id === parent), b: nodes.findIndex((node) => node.id === id) }));
    const painted = [];
    el.ctx.fillText = (text) => painted.push(text);
    const run = () => {
      const projected = nodes.map((node) => ({ node, p: env.project(node) }));
      env.layoutProjectedGraph(projected, area, "orbit");
      env.drawLabels(projected);
      return projected;
    };
    const projected = run();
    assert.ok(nodes.some((node) => node.kind === "task" && node._workLabel === "Running" && node._label && painted.includes(node.label)), `${layout}/${view} must name actual running work in Auto`);
    const controls = env.hudRects();
    for (const rect of state.labelRects) {
      assert.ok(rect.x >= area.x && rect.x + rect.w <= area.x + area.w && rect.y >= area.y && rect.y + rect.h <= area.y + area.h);
      for (const control of controls) assert.equal(env.overlaps(rect, control), false, "a name cannot cover an opaque control");
      for (const { node, p } of projected) {
        const radius = node._orbitTrail?.radius ?? node._pr;
        const nearestX = Math.max(rect.x, Math.min(p.x, rect.x + rect.w));
        const nearestY = Math.max(rect.y, Math.min(p.y, rect.y + rect.h));
        assert.ok(Math.hypot(p.x - nearestX, p.y - nearestY) >= radius, "painted names leave node surfaces and working rings clear");
      }
    }
    for (let a = 0; a < state.labelRects.length; a += 1) for (let b = a + 1; b < state.labelRects.length; b += 1) assert.equal(env.overlaps(state.labelRects[a], state.labelRects[b]), false);
    const anchors = nodes.filter((node) => node.kind !== "agent").map((node) => [node.id, { ...node._layoutAnchor }]);
    const labels = state.labelRects.map((rect) => ({ ...rect }));
    run();
    for (const [id, anchor] of anchors) assert.deepEqual({ ...nodes.find((node) => node.id === id)._layoutAnchor }, anchor, "label placement and idle redraws cannot move saved work");
    assert.deepEqual(state.labelRects.map((rect) => ({ ...rect })), labels, "the dense overview retains stable readable names");
  }
});

test("parallel work labels wrap distinctive task titles and fit beside their own orbs", () => {
  const { env, el, state } = labelContext({ width: 1920, height: 1200, chat: true });
  state.feedCollapsed = true;
  el.feed = box(24, 140, 220, 48);
  const titles = [
    "Guard the remaining live-state transitions",
    "Verify store recovery after a live refresh",
    "Commit search-suite registration changes",
    "Audit renderer behavior and keyboard tests",
    "Run the complete Python discovery sweep",
    "Mark idle-only sessions in the work tree",
  ];
  const projected = titles.map((label, index) => ({
    node: { id: `task:parallel:${index}`, kind: "task", label, _workLabel: "Running", _pr: 15 },
    p: { x: 320 + index % 3 * 420, y: 390 + Math.floor(index / 3) * 330, depth: 800, k: 1 },
  }));
  env.drawLabels(projected);
  for (const { node, p } of projected) {
    assert.ok(node._label, `${node.label} remains named`);
    assert.equal(Array.from(node._labelLines).join(" "), node.label, "two lines preserve the distinguishing end of each title");
    assert.equal(node._labelLines.length, el.ctx.measureText(node.label).width > 200 ? 2 : 1);
    const rect = node._label;
    const gap = Math.hypot(Math.max(rect.x - p.x, 0, p.x - rect.x - rect.w), Math.max(rect.y - p.y, 0, p.y - rect.y - rect.h));
    assert.ok(gap >= node._pr && gap <= node._pr + 15, "the padded name stays beside its orb without covering it");
    assert.ok(node._labelLines.every((line) => el.ctx.measureText(line).width <= 200));
  }
  assert.ok(state.labelRects.length <= env.labelBudget());
  const first = projected.map(({ node }) => ({ ...node._label }));
  env.drawLabels([...projected].reverse());
  assert.deepEqual(projected.map(({ node }) => ({ ...node._label })), first, "refresh ordering cannot shuffle labels");
});

test("two-line work labels clip oversized and unbroken titles without changing their source", () => {
  const { env, el } = labelContext();
  for (const title of ["Validate grouped worker transitions and interrupted result recovery across every saved project in the workspace", "x".repeat(500)]) {
    const node = { id: "long-title", kind: "task", label: title, _workLabel: "Running" };
    const lines = env.workLabelLines(el.ctx, node, env.fontFor(node), "Running");
    assert.equal(lines.length, 2);
    assert.match(lines[1], /…$/);
    assert.ok(lines.every((line) => el.ctx.measureText(line).width <= 200));
    assert.equal(node.label, title);
  }
});

test("fractional camera motion keeps equal-distance labels on the same side of their orb", () => {
  const { env } = labelContext();
  env.workLabelLines = () => ["A running task", "with fractional text metrics"];
  env.measure = () => 199.17;
  // Leave equal left/right openings while other branches obstruct the top
  // and bottom. Real canvas text and perspective both use fractional pixels.
  env.blocked = (rect) => Math.abs(rect.y + rect.h / 2 - 400) > 2;
  const node = { id: "fractional", kind: "task", label: "A running task", _workLabel: "Running", _pr: 24 };
  const p = { x: 700, y: 400, depth: 800, k: 1 };
  for (let step = 0; step < 100; step += 1) {
    p.x = 700 + step / 100;
    env.drawLabels([{ node, p }]);
    assert.ok(node._label.x > p.x, "subpixel rounding cannot flip a label across the orb");
  }
});

test("work titles rewrap into a nearby opening before using distant whitespace", () => {
  const { env, el } = labelContext();
  const node = { id: "narrow-opening", kind: "task", label: "Keep worker names beside their own nodes", _workLabel: "Running", _pr: 15 };
  const p = { x: 700, y: 450, depth: 800, k: 1 };
  // Controls leave a short horizontal opening beside this work node. A
  // wide chip cannot fit; two narrower lines can retain the whole title.
  env.hudRects = () => [
    { x: 0, y: 0, w: 1500, h: 400 },
    { x: 0, y: 500, w: 1500, h: 500 },
    { x: 0, y: 400, w: 675, h: 100 },
    { x: 916, y: 400, w: 600, h: 100 },
  ];
  env.drawLabels([{ node, p }]);
  assert.ok(node._label, "the nearby opening retains a working name");
  assert.equal(Array.from(node._labelLines).join(" "), node.label);
  assert.ok(node._label.x > p.x && node._label.x - p.x < 40);
  assert.ok(node._label.w < 190, "the chip uses the narrow opening");
  assert.ok(node._labelLines.every((line) => el.ctx.measureText(line).width <= node._label.w - 14));
});

test("only the newest verifying cards keep a name at rest; the rest are tinted orbs until hovered, selected or All", () => {
  const labels = labelContext();
  const verifying = (id, at) => ({ id, kind: "task", label: id, state: "active", _workLabel: "Verifying", task: { status: "awaiting_verification", lastAttempt: { at } }, _pr: 5 });
  const nodes = [verifying("t-old", 1), verifying("t-mid", 2), verifying("t-new", 3), verifying("t-newest", 4)];
  const projected = nodes.map((node, index) => ({ node, p: { x: 200 + index * 150, y: 300, k: 1, depth: 800 } }));
  assert.deepEqual([...labels.env.recentVerifyingIds(projected)].sort(), ["t-new", "t-newest"]);
  assert.deepEqual(Array.from(labels.env.labelCandidates(projected), ({ node }) => node.id).sort(), ["t-new", "t-newest"], "Auto names the two newest verifying cards only");
  labels.state.hoverNode = nodes[0];
  assert.ok(labels.env.labelCandidates(projected).some(({ node }) => node.id === "t-old"), "a hovered verifying orb gets its name back");
  labels.state.hoverNode = null;
  labels.state.labels = "all";
  assert.equal(labels.env.labelCandidates(projected).length, 4, "All shows every name");
});
