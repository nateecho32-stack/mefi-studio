// renderer/idle.js's camera-director hook, which Zen flies its camera tour
// (renderer/camera-tour.js) through, sliced out of the file and run in a vm
// the way the other Command suites do: a shot is applied as given, clamped,
// and never fights a hand on the tree or reduced motion; a failing director
// lets go; setting one parks the camera in Free and clearing it springs back
// to the owner's own mode, carrying the flight's speed and returning the
// tilt (or stays put after a grab); the HUD rects and the orbit step aside
// while one flies; Zen flies through it and wakes by gliding home.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");

function section(from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `idle.js has ${from.trim()} before ${to.trim()}`);
  return source.slice(a, b);
}

function environment(overrides = {}, { realZen = false, tour = null, still = false } = {}) {
  const state = {
    active: true, view: "3d", angle: 0.4, pitch: 0.05, zoom: 1, zoomTarget: null, fit: 1,
    camMode: "orbit", follow: null, followZoomTarget: 1.3, ambientZen: false, ambientZenEnabled: true,
    panning: null, rotating: null, settingsPreview: null, director: null,
    camera: { x: 3, y: 4, z: 5, tx: 3, ty: 4, tz: 5 },
    camVel: { x: 1, y: 1, z: 1, zoom: 1 },
    hudRects: [{ x: 0, y: 0, w: 10, h: 10 }], hudRectsAt: 0,
    nodes: [
      { id: "a", kind: "session", x: 10, y: 0, z: 0, _layoutAnchor: { x: 85, y: -20, z: 35 }, _workLabel: "Running" },
      { id: "b", kind: "agent", x: 0, y: 20, z: 0, dying: true },
      { id: "c", kind: "task", x: 0, y: 0, z: 30, retiring: true },
      { id: "d", kind: "todo", x: 5, y: 5, z: 5, _absorbed: true },
      { id: "e", kind: "music", x: -7, y: 8, z: -9 },
    ],
    ...overrides,
  };
  const calls = [];
  const env = vm.createContext({
    state, Date, Math, Number, Array, Object, Boolean,
    PITCH_MAX: 0.55, ORBIT_BASE: 0.00055, CAMERA_SMOOTH: 0.38, CAMERA_RETURN_SMOOTH: 0.8, AMBIENT_ZEN_MS: 30000,
    console: { error: (...args) => calls.push(["error", String(args[0])]) },
    window: { MefiNav: { top: () => "command" }, ...(tour ? { MefiCameraTour: { create: () => { calls.push(["tour"]); return tour; } } } : {}) },
    document: { hidden: false, activeElement: null, body: { dataset: {}, classList: { toggle: (name, on) => calls.push(["class", name, on]) } }, getElementById: () => null, querySelectorAll: () => [] },
    el: { width: 1200, height: 800 }, project: () => ({ x: 600, y: 400 }),
    hideTip: () => {}, bumpHud: () => {}, writeStore: () => {},
    glideZoom: (zoom) => { calls.push(["glide", zoom]); state.zoomTarget = zoom; },
    updateFollowCamera: (_now, force) => calls.push(["follow", force]),
    syncViewControls: () => calls.push(["sync"]),
    renderHint: () => {},
    renderFollowStatus: () => calls.push(["followStatus"]),
    noMotion: () => still,
  });
  vm.runInContext(section("  function smoothDamp(", "  const POPUP_MS"), env);
  vm.runInContext(section("  // An outside camera director", "  function updateFollowCamera("), env);
  vm.runInContext(section("  function orbitTarget(", "  function computeBranch("), env);
  vm.runInContext(section("  function canAmbientZen()", "  function canDim()"), env);
  vm.runInContext(section("  function hudRects()", "  function drawLabels("), env);
  // The canAmbientZen slice carries the real setAmbientZen; the director
  // tests stand in for it, the Zen tests keep it.
  if (!realZen) env.setAmbientZen = (on) => { calls.push(["zen", on]); state.ambientZen = on; };
  return { env, state, calls };
}

const director = (shot, seen = []) => ({ step: (ctx) => { seen.push(ctx); return typeof shot === "function" ? shot(ctx) : shot; } });

test("a shot lands as given: camera and target together, the springs zeroed, zoom and tilt clamped", () => {
  const { env, state } = environment();
  const seen = [];
  env.setDirector(director({ x: -10, y: 2, z: 7, zoom: 4, pitch: 0.9, spin: 0.002 }, seen));
  assert.equal(env.stepDirector(1 / 60, false), true);
  assert.deepEqual({ ...state.camera }, { x: -10, y: 2, z: 7, tx: -10, ty: 2, tz: 7 });
  assert.deepEqual({ ...state.camVel }, { x: 0, y: 0, z: 0, zoom: 0, pitch: 0 }, "no leftover velocity drags it off the shot");
  assert.equal(state.zoom, 3.6, "a flight may close in past the wheel's 2.6");
  assert.equal(state.zoomTarget, null);
  assert.equal(state.pitch, 0.55);
  assert.equal(state.directed, true);
  assert.equal(env.orbitTarget(0), 0.002, "the tour sets the spin");
  env.stepDirector(1 / 60, false);
  const ctx = seen.at(-1);
  assert.equal(ctx.dt, 1 / 60);
  assert.deepEqual(ctx.nodes().map((node) => node.id), ["a"], "dying, retiring, absorbed and hidden nodes are not stops");
  assert.equal(ctx.nodes()[0].running, true);
  assert.deepEqual({ ...ctx.position("a") }, { x: 85, y: -20, z: 35 }, "the tour visits the painted layout anchor, not the raw graph position");
  assert.deepEqual({ ...ctx.nodes()[0] }, { id: "a", kind: "session", x: 85, y: -20, z: 35, parentId: undefined, running: true });
  assert.equal(ctx.position("e"), null);
  assert.equal(ctx.position("b"), null);
  assert.equal(ctx.position("c"), null);
  assert.equal(ctx.position("d"), null);
  assert.deepEqual({ ...ctx.viewport }, { x: 0, y: 0, w: 1200, h: 800 });
  assert.equal(typeof ctx.project, "function");
  state.camera.x = 0;
  env.setDirector(director({ x: 0, y: 0, z: 0, zoom: 0.1 }));
  env.stepDirector(1 / 60, false);
  assert.equal(state.zoom, 0.45);
  assert.equal(env.orbitTarget(0), 0.00055, "no spin in the shot keeps the resting orbit");
});

test("a hand on the tree, reduced motion, the Settings preview or an empty shot leave the camera alone", () => {
  for (const [label, patch, still, shot] of [
    ["drag", { panning: { x: 1 } }, false, { x: 1, y: 1, z: 1, zoom: 2 }],
    ["right-drag", { rotating: { x: 1 } }, false, { x: 1, y: 1, z: 1, zoom: 2 }],
    ["preview", { settingsPreview: { x: 0 } }, false, { x: 1, y: 1, z: 1, zoom: 2 }],
    ["reduced motion", {}, true, { x: 1, y: 1, z: 1, zoom: 2 }],
    ["null shot", {}, false, null],
    ["broken shot", {}, false, { x: Number.NaN, y: 1, z: 1, zoom: 2 }],
  ]) {
    const { env, state } = environment();
    env.setDirector(director(shot));
    Object.assign(state, patch);
    assert.equal(env.stepDirector(1 / 60, still), false, label);
    assert.deepEqual({ ...state.camera }, { x: 3, y: 4, z: 5, tx: 3, ty: 4, tz: 5 }, label);
    assert.equal(state.directed, false, label);
  }
  const { env } = environment();
  assert.equal(env.stepDirector(1 / 60, false), false, "no director, nothing to do");
});

test("a director that throws is let go and the camera handed back", () => {
  const { env, state, calls } = environment();
  env.setDirector({ step() { throw new Error("boom"); } });
  assert.equal(env.stepDirector(1 / 60, false), false);
  assert.equal(state.director, null);
  assert.equal(state.returning.camMode, "orbit", "it glides home to Orbit like any hand-back");
  assert.ok(calls.some(([kind, text]) => kind === "error" && /camera director failed/.test(text)));
});

test("a tour eases to the screen centre without reseeding the layout, then returns beside the panels", () => {
  const { env, state } = environment();
  const area = { x: 100, y: 100, w: 500, h: 500 };
  state.graphFrame = { ...area };
  state.camMode = "free";
  env.CAMERA_EASE = 0.045;
  env.usableArea = () => area;
  vm.runInContext(section("  function stepCenter(", "  function project("), env);
  env.stepCenter(area, false);
  assert.equal(state.center.x, 350);
  const frameKey = state.center.frameKey;
  state.director = director(null);
  env.stepCenter(area, false);
  assert.ok(state.center.x > 350 && state.center.x < 370, "opening eases rather than jumping");
  for (let i = 0; i < 250; i += 1) env.stepCenter(area, false);
  assert.equal(state.center.x, 600);
  assert.equal(state.center.y, 400);
  assert.equal(state.center.frameKey, frameKey, "the saved layout frame is unchanged");
  state.director = null;
  env.stepCenter(area, false);
  assert.ok(state.center.x < 600 && state.center.x > 580, "waking glides back beside the panels");
  state.ambientZen = true;
  env.stepCenter(area, true);
  assert.equal(state.center.x, 350, "reduced-motion Zen retains the usual framing");
});

test("setting a director parks the camera in Free and remembers the owner's view; Zen steps out first", () => {
  const { env, state, calls } = environment({ ambientZen: true, camMode: "follow", zoomTarget: 1.8 });
  env.setDirector(director(null));
  assert.equal(state.camMode, "free", "Orbit's rebuild refits would jolt a close-up");
  assert.equal(state.followZoomTarget, null);
  assert.deepEqual(calls.filter(([kind]) => kind === "zen"), [["zen", false]]);
  assert.deepEqual({ ...state.directorRestore }, { camMode: "follow", tx: 3, ty: 4, tz: 5, zoom: 1.8, pitch: 0.05 });
  const second = director(null);
  env.setDirector(second);
  assert.equal(state.director, second);
  assert.equal(state.directorRestore.camMode, "follow", "a swap keeps the first view to return to");
  assert.equal(env.canAmbientZen(), false, "Zen stays off while a director flies");
  assert.deepEqual([...env.hudRects()], [], "labels may use the whole screen while the HUD is faded");
});

test("clearing it glides home to the owner's mode: Orbit to the whole tree (becoming Orbit once there), Free to where it was, Follow to the work", () => {
  {
    const { env, state, calls } = environment({ camMode: "orbit" });
    env.setDirector(director({ x: -50, y: 0, z: 9, zoom: 2.3 }));
    env.stepDirector(1 / 60, false);
    env.setDirector(null);
    assert.equal(state.camMode, "free", "Orbit re-frames from the live zoom, so the return glides in Free");
    assert.equal(state.returning.camMode, "orbit");
    assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz], [0, 0, 0]);
    assert.deepEqual([state.camera.x, state.camera.z], [-50, 9], "the camera itself glides from where the flight left it");
    assert.deepEqual(calls.filter(([kind]) => kind === "glide"), [["glide", 1]]);
    assert.ok(calls.some(([kind]) => kind === "sync"));
    assert.equal(state.directorRestore, null);
    env.stepDirector(1 / 60, false);
    assert.equal(state.camMode, "free", "still on the way");
    Object.assign(state.camera, { x: 0, y: 0, z: 0.2 });
    Object.assign(state, { zoom: 1, zoomTarget: null, pitchHome: null });
    env.stepDirector(1 / 60, false);
    assert.equal(state.camMode, "free", "a fifth of a unit out is not home yet");
    Object.assign(state.camera, { z: 0.03 });
    state.camVel.z = 0.4;
    env.stepDirector(1 / 60, false);
    assert.equal(state.camMode, "orbit", "home: Orbit takes over with nothing left to re-frame");
    assert.equal(state.returning, null);
    assert.equal(state.camera.z, 0, "the last hair of the spring lands exactly, so the tree stops dead still");
    assert.equal(state.camVel.z, 0);
  }
  {
    const { env, state, calls } = environment({ camMode: "free", zoom: 1.7 });
    env.setDirector(director({ x: -50, y: 0, z: 9, zoom: 2.3 }));
    env.stepDirector(1 / 60, false);
    env.setDirector(null);
    assert.equal(state.camMode, "free");
    assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz], [3, 4, 5]);
    assert.deepEqual(calls.filter(([kind]) => kind === "glide"), [["glide", 1.7]]);
    assert.equal(state.returning.camMode, null, "Free returns on the slower glide with no mode to switch");
  }
  {
    const { env, state, calls } = environment({ camMode: "follow" });
    env.setDirector(director(null));
    env.setDirector(null);
    assert.equal(state.camMode, "follow");
    assert.deepEqual(calls.filter(([kind]) => kind === "follow"), [["follow", true]]);
  }
});

test("clearing it with { stay: true } keeps the view where the flight left it, in Free", () => {
  const { env, state, calls } = environment({ camMode: "orbit" });
  env.setDirector(director({ x: -50, y: 1, z: 9, zoom: 2.3 }));
  env.stepDirector(1 / 60, false);
  env.setDirector(null, { stay: true });
  assert.equal(state.camMode, "free");
  assert.deepEqual({ ...state.camera }, { x: -50, y: 1, z: 9, tx: -50, ty: 1, tz: 9 });
  assert.equal(state.zoom, 2.3);
  assert.equal(calls.filter(([kind]) => kind === "glide").length, 0, "inside the wheel's range: no glide");
  env.setDirector(director({ x: -50, y: 1, z: 9, zoom: 3.3 }));
  env.stepDirector(1 / 60, false);
  env.setDirector(null, { stay: true });
  assert.deepEqual(calls.filter(([kind]) => kind === "glide"), [["glide", 2.6]], "past it, the zoom glides back inside");
  const glides = calls.length;
  env.setDirector(null);
  assert.equal(state.camMode, "free", "a second clear is a no-op");
  assert.equal(calls.length, glides);
});

test("drawFrame asks the director after Follow and before the orbit, and a flight runs at the hot cadence", () => {
  const frame = section("  function drawFrame(", "    const { ctx } = el;");
  const follow = frame.indexOf("updateFollowCamera(Date.now());");
  const step = frame.indexOf("const directed = stepDirector(dt, still);");
  const orbit = frame.indexOf("const target = orbitTarget(energy);");
  assert.ok(follow > 0 && step > follow && orbit > step, "Follow, then the director, then the orbit");
  assert.match(frame, /state\.motionHot = [^\n]+\n\s*if \(directed\) state\.motionHot = true;/, "on its own line after the motionHot line");
  assert.match(source, /\r?\n    setDirector,\r?\n[\s\S]{0,400}?\r?\n    enterZen: \(\) => \{[\s\S]{0,300}?\r?\n    directorStatus: \(\) => /, "MefiIdle exports the hook and Zen now");
});

// ---- Zen flies ----------------------------------------------------------------
function zenTour(velocity = { x: 12, y: -3, z: 4, zoom: -0.8 }) {
  return { step: () => ({ x: -40, y: 6, z: 18, zoom: 3.1, pitch: 0.3, spin: 0.0024 }), velocity: () => velocity };
}

test("Zen flies: the camera tour takes the camera from the view as it is, and its own flight never wakes it", () => {
  const tour = zenTour();
  const { env, state, calls } = environment({ camMode: "orbit", pitch: 0.05, lastInput: 0 }, { realZen: true, tour });
  assert.equal(env.checkAmbientZen(31000), true);
  assert.equal(state.director, tour);
  assert.equal(state.zenDirector, tour);
  assert.equal(state.camMode, "free", "parked for the flight");
  assert.deepEqual({ ...state.directorRestore }, { camMode: "orbit", tx: 3, ty: 4, tz: 5, zoom: 1, pitch: 0.05 });
  assert.ok(calls.some(([kind, name, on]) => kind === "class" && name === "command-zen" && on === true));
  assert.equal(env.stepDirector(1 / 60, false), true);
  assert.equal(env.canAmbientZen(), true, "Zen's own director does not count against it");
  assert.equal(env.checkAmbientZen(32000), true, "so the quiet clock keeps it flying");
  assert.equal(state.director, tour);
});

test("waking glides home: the owner's mode back, the flight's speed carried, the tilt springing back, the angle kept", () => {
  const tour = zenTour();
  const { env, state, calls } = environment({ camMode: "orbit", pitch: 0.05, angle: 1.2, lastInput: 0 }, { realZen: true, tour });
  env.checkAmbientZen(31000);
  env.stepDirector(1 / 60, false);
  assert.equal(state.pitch, 0.3);
  state.angle = 2.5;
  assert.equal(env.wakeAmbientZen(40000), true);
  assert.equal(state.director, null);
  assert.equal(state.zenDirector, null);
  assert.equal(state.camMode, "free");
  assert.equal(state.returning.camMode, "orbit", "Orbit takes over once the camera is home");
  assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz], [0, 0, 0], "home is the whole tree");
  assert.deepEqual([state.camera.x, state.camera.y, state.camera.z], [-40, 6, 18], "the camera itself glides from where the flight was");
  assert.deepEqual(calls.filter(([kind]) => kind === "glide"), [["glide", 1]]);
  assert.deepEqual([state.camVel.x, state.camVel.y, state.camVel.z, state.camVel.zoom], [12, -3, 4, -0.8], "the glide starts at the flight's speed");
  assert.equal(state.pitchHome, 0.05);
  assert.equal(state.angle, 2.5, "no rewind of the spin");
  assert.ok(calls.some(([kind, name, on]) => kind === "class" && name === "command-zen" && on === false));
  // The tilt springs home over the next frames and lets go once there.
  let frames = 0;
  while (state.pitchHome !== null && frames < 240) { env.stepDirector(1 / 60, false); frames += 1; }
  assert.equal(state.pitch, 0.05);
  assert.ok(frames > 10 && frames < 240, `the tilt eases back over ${frames} frames instead of snapping`);
  assert.equal(state.camMode, "free", "the camera is still on its way home");
  Object.assign(state.camera, { x: 0, y: 0, z: 0 });
  Object.assign(state, { zoom: 1, zoomTarget: null });
  env.stepDirector(1 / 60, false);
  assert.equal(state.camMode, "orbit");
});

test("a wheel zoom, a drag or a mode click on the way home keeps the view the user made", () => {
  for (const [label, act] of [
    ["wheel", (state) => Object.assign(state, { zoom: 1.7, zoomTarget: null })],
    ["drag", (state) => { state.panning = { x: 1 }; }],
    ["mode click", (state) => { state.camMode = "follow"; }],
  ]) {
    const { env, state } = environment({ camMode: "orbit" });
    env.setDirector(director({ x: -50, y: 0, z: 9, zoom: 2.3 }));
    env.stepDirector(1 / 60, false);
    env.setDirector(null);
    Object.assign(state.camera, { x: 0, y: 0, z: 0 });
    Object.assign(state, { zoom: 1, zoomTarget: null, pitchHome: null });
    act(state);
    env.stepDirector(1 / 60, false);
    assert.equal(state.returning, null, label);
    assert.notEqual(state.camMode, "orbit", `${label}: the user's own view wins`);
  }
});

test("a right-drag takes the tilt over from the return, and reduced motion lands it at once", () => {
  const { env, state } = environment({ pitchHome: 0.1, pitch: 0.4, rotating: { x: 1 } });
  env.stepDirector(1 / 60, false);
  assert.equal(state.pitchHome, null);
  assert.equal(state.pitch, 0.4, "the drag owns the tilt now");
  const still = environment({ pitchHome: 0.1, pitch: 0.4 });
  still.env.stepDirector(1 / 60, true);
  assert.equal(still.state.pitch, 0.1);
  assert.equal(still.state.pitchHome, null);
});

test("with reduced motion Zen only fades the panels: no flight, the camera untouched", () => {
  const tour = zenTour();
  const { env, state, calls } = environment({ camMode: "follow", lastInput: 0 }, { realZen: true, tour, still: true });
  assert.equal(env.checkAmbientZen(31000), true);
  assert.equal(state.director, null);
  assert.equal(calls.filter(([kind]) => kind === "tour").length, 0);
  assert.equal(state.camMode, "follow");
  assert.equal(env.orbitTarget(0), 0);
  assert.equal(env.wakeAmbientZen(32000), true);
  assert.deepEqual({ ...state.camera }, { x: 3, y: 4, z: 5, tx: 3, ty: 4, tz: 5 });
});

test("Zen keeps the graph frame (no layout re-seed on wake), paints the whole canvas, and a rebuild retargets a glide home", () => {
  assert.doesNotMatch(section("  function usableArea()", "  function autoFit("), /ambientZen/, "Zen no longer swaps in a full-screen frame");
  const clip = section("  function drawFrame(", "    syncAgentMotion(").match(/const clip = ([^;]+);/)[1];
  const graphArea = { x: 20, y: 30, w: 400, h: 300 }, base = { x: 20, y: 30, w: 600, h: 500 };
  const region = (directed, state) => JSON.parse(JSON.stringify(vm.runInNewContext(clip, { directed, state, graphArea, el: { width: 1000, height: 800 } })));
  assert.deepEqual(region(false, {}), graphArea);
  assert.deepEqual(region(false, { mediaFocus: { x: 0, y: 0 }, mediaSceneBase: base }), base, "a media glide retains the full available region");
  for (const [directed, state] of [[true, {}], [false, { ambientZen: true, mediaFocus: { x: 0, y: 0 }, mediaSceneBase: base }]]) assert.deepEqual(region(directed, state), { x: 0, y: 0, w: 1000, h: 800 });
  assert.match(source, /if \(state\.camMode === "orbit"\) \{ if \(state\.zoomTarget != null\) state\.zoomTarget = 1; else setZoom\(1\); \}/);
});
