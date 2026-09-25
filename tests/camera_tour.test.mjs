// renderer/camera-tour.js in a vm: the flight Zen hands idle.js through
// setDirector. It must start where the view is, visit visible branches and
// pull back during travel on a bounded path that slows at each stop,
// stay inside the tilt clamp, turn slower close in than wide, and report a
// velocity that matches its own motion (idle.js carries it into the glide
// home when Zen wakes).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/camera-tour.js", import.meta.url), "utf8");
const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
// From cameraDistance: project() reads the camera helpers defined just above it.
const projectionSource = idle.slice(idle.indexOf("  function cameraDistance("), idle.indexOf("  function unprojectForLayout("));

function load() {
  const window = {};
  vm.runInNewContext(source, { window, Math, Number, Date });
  return window.MefiCameraTour;
}

test("the moving overview pans and resizes while every branch stays inside its frame", () => {
  for (const [w, h] of [[1180, 650], [740, 450], [245, 175]]) {
    const overview = load().createOverview();
    const shots = [];
    let maxStep = 0;
    for (let frame = 0; frame < 3600; frame += 1) {
      const angle = frame / 1800;
      const points = Array.from({ length: 24 }, (_, i) => ({
        x: Math.cos(i * 0.83 + angle) * w * 0.47 + w * 0.07,
        y: Math.sin(i * 0.61) * h * (0.32 + 0.08 * Math.sin(angle)),
      }));
      const shot = overview.step({ points, viewport: { w, h }, dt: 1 / 60, moving: true });
      for (const p of points) {
        assert.ok(Math.abs(p.x * shot.scale + shot.x) <= w / 2 - 32 + 1e-6);
        assert.ok(Math.abs(p.y * shot.scale + shot.y) <= h / 2 - 32 + 1e-6);
      }
      const previous = shots.at(-1);
      if (previous) maxStep = Math.max(maxStep, Math.abs(shot.scale - previous.scale));
      shots.push(shot);
    }
    assert.ok(Math.max(...shots.map(s => s.scale)) - Math.min(...shots.map(s => s.scale)) > 0.04, "the whole tree changes scale");
    assert.ok(Math.max(...shots.map(s => s.y)) - Math.min(...shots.map(s => s.y)) > 2, "the framing moves without leaving the safe rectangle");
    assert.ok(maxStep < 0.003, "normal framing changes ease instead of snapping");
    // A panel opening or new far-away work must fit on its very first frame.
    const points = [{ x: -850, y: -600 }, { x: 1600, y: 750 }];
    const narrowed = overview.step({ points, viewport: { w: 180, h: 160 }, dt: 1 / 60, moving: true });
    for (const p of points) {
      assert.ok(Math.abs(p.x * narrowed.scale + narrowed.x) <= 58 + 1e-6);
      assert.ok(Math.abs(p.y * narrowed.scale + narrowed.y) <= 48 + 1e-6);
    }
  }
});

test("overview motion pauses its clock and reduced motion keeps a stable fit", () => {
  const points = [{ x: -150, y: -90 }, { x: 180, y: 110 }];
  const ctx = { points, viewport: { w: 650, h: 400 }, dt: 1 / 60, moving: true };
  const first = load().createOverview(), paused = load().createOverview();
  for (let i = 0; i < 900; i += 1) { first.step(ctx); paused.step(ctx); }
  const before = paused.step({ ...ctx, dt: 0 });
  assert.deepEqual(paused.step({ ...ctx, dt: 0 }), before, "a suspended frame cannot move the lens");
  assert.deepEqual(paused.step({ ...ctx, moving: false }), before, "pausing takes effect immediately");
  let held;
  for (let i = 0; i < 1800; i += 1) held = paused.step({ ...ctx, moving: false, still: true });
  assert.deepEqual(paused.step({ ...ctx, moving: false, still: true }), held);
  const reference = first.step({ ...ctx, moving: false, still: true });
  assert.deepEqual({ ...held }, { ...reference }, "paused and reduced-motion time never advances the path");
  assert.deepEqual({ ...load().createOverview().step({ ...ctx, points: [] }) }, { scale: 1, x: 0, y: 0 });
});

function treeNodes() {
  return [
    { id: "assistant", kind: "assistant", x: 0, y: 0, z: 0, running: false },
    { id: "s1", kind: "session", x: 120, y: 10, z: -40, running: false },
    { id: "s2", kind: "session", x: -110, y: -20, z: 60, running: false },
    { id: "t1", kind: "task", x: 150, y: 30, z: 20, running: true },
    { id: "a1", kind: "agent", x: 135, y: 20, z: 5, running: true },
    { id: "m", kind: "music", x: -40, y: 90, z: -90, running: false },
  ];
}

// Feeds the director frame after frame the way idle.js stepDirector does:
// each shot becomes the camera the next frame reads.
function fly(director, seconds, { fps = 60, view = "3d", start = { camera: { x: 0, y: 0, z: 0 }, zoom: 1, pitch: 0 }, nodes = treeNodes() } = {}) {
  const shots = [];
  let camera = { ...start.camera }, zoom = start.zoom, pitch = start.pitch;
  for (let frame = 0; frame < seconds * fps; frame += 1) {
    const shot = director.step({ dt: 1 / fps, view, angle: 0, pitch, zoom, camera, nodes: () => nodes, position: (id) => nodes.find((node) => node.id === id) ?? null });
    shots.push({ ...shot, velocity: director.velocity() });
    camera = { x: shot.x, y: shot.y, z: shot.z };
    zoom = shot.zoom;
    pitch = shot.pitch;
  }
  return shots;
}

test("one continuous path that closes in on nodes, pulls back out and never halts", () => {
  const shots = fly(load().create({ seed: 42 }), 120);
  assert.ok(shots.every((shot) => [shot.x, shot.y, shot.z, shot.zoom, shot.pitch, shot.spin].every(Number.isFinite)));
  const zooms = shots.map((shot) => shot.zoom);
  assert.ok(Math.max(...zooms) > 1.5 && Math.max(...zooms) <= 2.1, `branch visits use a restrained close-up (max zoom ${Math.max(...zooms).toFixed(2)})`);
  assert.ok(Math.min(...zooms.slice(600)) < 1.1, `and pulls back out to the whole tree (min zoom ${Math.min(...zooms.slice(600)).toFixed(2)})`);
  // Smooth: no frame jumps, and the velocity itself changes gently.
  let worstStep = 0, worstBend = 0, worstZoom = 0;
  for (let i = 2; i < shots.length; i += 1) {
    const [a, b, c] = [shots[i - 2], shots[i - 1], shots[i]];
    worstStep = Math.max(worstStep, Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z));
    worstBend = Math.max(worstBend, Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y, c.z - 2 * b.z + a.z));
    worstZoom = Math.max(worstZoom, Math.abs(Math.log(c.zoom) - Math.log(b.zoom)));
  }
  assert.ok(worstStep < 2, `largest step per frame ${worstStep.toFixed(3)} world units`);
  assert.ok(worstBend < 0.02, `largest change of velocity per frame ${worstBend.toFixed(4)}`);
  assert.ok(worstZoom < 0.01, `largest zoom step per frame ${worstZoom.toFixed(4)} (log)`);
  // After the establishing view, every second of branch travel moves.
  for (let second = 12; second < 120; second += 1) {
    const [from, to] = [shots[second * 60], shots[second * 60 + 59]];
    const moved = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) + Math.abs(Math.log(to.zoom / from.zoom)) * 100;
    assert.ok(moved > 0.3, `second ${second} moved ${moved.toFixed(3)}`);
  }
  // Close in, the camera arcs slowly; wide, the tree turns faster.
  const close = shots.filter((shot) => shot.zoom > 1.5), wide = shots.filter((shot) => shot.zoom < 1.2);
  assert.ok(close.length && wide.length);
  assert.ok(Math.max(...close.map((shot) => shot.spin)) < Math.min(...wide.map((shot) => shot.spin)));
  assert.ok(shots.every((shot) => Math.abs(shot.pitch) < 0.4), "the sway stays inside the tilt clamp");
});

test("long flights keep visible branches inside the real perspective projection at wide and narrow sizes", () => {
  for (const view of ["2d", "3d"]) for (const [w, h] of [[600, 560], [1440, 900], [1920, 700]]) {
    const nodes = Array.from({ length: 15 }, (_, i) => ({
      id: `n${i}`, kind: i % 5 ? "task" : "session", parentId: i % 5 ? `n${i - i % 5}` : null,
      x: 140 + (i % 5 - 2) * 85, y: -80 + (Math.floor(i / 5) - 1) * 120,
      z: (Math.floor(i / 5) - 1) * 95 + Math.sin(i) * 50, running: i === 8,
    }));
    const state = { view, angle: 0, fit: Math.min(w / 700, h / 460), overviewScale: 0.85, camera: { x: -140, y: 80, z: 0 }, zoom: 1, pitch: 0 };
    const env = vm.createContext({ state, Math, centerX: () => w / 2, centerY: () => h / 2 });
    vm.runInContext(projectionSource, env);
    const director = load().create({ seed: 42 });
    let minimum = Infinity, maxZoomStep = 0, previousZoom = 1;
    for (let frame = 0; frame < 120 * 30; frame += 1) {
      const shot = director.step({ ...state, dt: 1 / 30, nodes: () => nodes, viewport: { x: 0, y: 0, w, h }, project: env.project });
      state.camera = { x: shot.x, y: shot.y, z: shot.z };
      state.zoom = shot.zoom; state.pitch = shot.pitch; state.angle += shot.spin;
      const projected = nodes.map((node) => env.project(node));
      const visible = projected.filter((p) => p.x > w * 0.1 && p.x < w * 0.9 && p.y > h * 0.1 && p.y < h * 0.9);
      if (frame > 90) minimum = Math.min(minimum, visible.length);
      maxZoomStep = Math.max(maxZoomStep, Math.abs(Math.log(shot.zoom / previousZoom)));
      previousZoom = shot.zoom;
    }
    assert.ok(minimum >= 3, `${view} ${w}x${h}: at least one branch stays comfortably on screen (minimum ${minimum})`);
    assert.ok(maxZoomStep < 0.035, `${view} ${w}x${h}: framing never snaps the zoom (${maxZoomStep})`);
  }
});

test("removing a visited branch returns to the live tree, and a zero-time frame never jumps", () => {
  const director = load().create({ seed: 7 });
  let nodes = treeNodes().map((node) => ({ ...node, x: node.x + 500 }));
  const state = { camera: { x: -500, y: 0, z: 0 }, zoom: 1, pitch: 0.5, view: "3d" };
  const frame = (dt) => {
    const shot = director.step({ ...state, dt, nodes: () => nodes });
    state.camera = { x: shot.x, y: shot.y, z: shot.z }; state.zoom = shot.zoom; state.pitch = shot.pitch;
    return shot;
  };
  const first = frame(0);
  assert.deepEqual([first.x, first.y, first.z, first.zoom, first.pitch], [-500, 0, 0, 1, 0.5]);
  for (let i = 0; i < 750; i += 1) frame(1 / 30);
  nodes = [{ id: "remaining", kind: "task", x: -250, y: 60, z: -40 }];
  for (let i = 0; i < 600; i += 1) frame(1 / 30);
  assert.ok(Math.hypot(state.camera.x - 250, state.camera.y + 60, state.camera.z - 40) < 1, "no stale stop survives removal of its subject");
  assert.ok(state.zoom < 1, "the remaining tree is shown wide");
});

test("the flight starts from the view it takes over, with no jump", () => {
  const nodes = treeNodes();
  const shot = load().create({ seed: 7 }).step({ dt: 1 / 60, view: "3d", angle: 0, pitch: 0.1, zoom: 1.4, camera: { x: -20, y: 5, z: 12 }, nodes: () => nodes, position: (id) => nodes.find((node) => node.id === id) ?? null });
  assert.ok(Math.hypot(shot.x + 20, shot.y - 5, shot.z - 12) < 0.05, "the first shot is where the camera was");
  assert.ok(Math.abs(shot.zoom - 1.4) < 0.01);
  assert.ok(Math.abs(shot.pitch - 0.1) < 0.05);
});

test("velocity() is the flight's own motion, per second, zoom in log space", () => {
  const shots = fly(load().create({ seed: 3 }), 40);
  let checked = 0;
  for (let i = 120; i < shots.length; i += 97) {
    const [a, b] = [shots[i - 1], shots[i]];
    const measured = { x: (b.x - a.x) * 60, y: (b.y - a.y) * 60, z: (b.z - a.z) * 60, zoom: (Math.log(b.zoom) - Math.log(a.zoom)) * 60 };
    for (const key of ["x", "y", "z", "zoom"]) {
      const tolerance = key === "zoom" ? 0.05 : 1 + Math.abs(measured[key]) * 0.05;
      assert.ok(Math.abs(b.velocity[key] - measured[key]) < tolerance, `frame ${i} ${key}: reported ${b.velocity[key].toFixed(3)}, moved ${measured[key].toFixed(3)}`);
    }
    checked += 1;
  }
  assert.ok(checked >= 5);
});

test("a vanished node reframes the remaining tree, a sparse tree still flies, and 2D never spins", () => {
  const nodes = treeNodes();
  const director = load().create({ seed: 11 });
  let camera = { x: 0, y: 0, z: 0 }, zoom = 1;
  for (let frame = 0; frame < 60 * 30; frame += 1) {
    const live = frame > 600 ? nodes.slice(0, 2) : nodes;
    const shot = director.step({ dt: 1 / 60, view: "2d", angle: 0, pitch: 0, zoom, camera, nodes: () => live, position: (id) => live.find((node) => node.id === id) ?? null });
    assert.ok([shot.x, shot.y, shot.z, shot.zoom].every(Number.isFinite), `frame ${frame}`);
    assert.equal(shot.spin, 0);
    camera = { x: shot.x, y: shot.y, z: shot.z };
    zoom = shot.zoom;
  }
  const empty = load().create({ seed: 1 });
  const shot = empty.step({ dt: 1 / 60, view: "3d", angle: 0, pitch: 0, zoom: 1, camera: { x: 0, y: 0, z: 0 }, nodes: () => [], position: () => null });
  assert.ok(Number.isFinite(shot.zoom), "an empty tree pulls back wide instead of failing");
});
