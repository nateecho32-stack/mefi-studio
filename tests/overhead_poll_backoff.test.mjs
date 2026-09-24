// renderer/overhead.js backs its task poll off while reads come back
// unchanged, comparing a JSON signature of nodes/edges/tasks taken before and
// after each load(). draw() used to stamp its hit boxes onto the task objects
// (task._box), so any painted frame between two polls made the signature
// differ and the delay never grew. Hit boxes now live in their own map; this
// suite runs the shipped module with one open task and paints between polls.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/overhead.js", import.meta.url), "utf8");

function environment({ motion = false } = {}) {
  const timers = new Map(), frames = new Map(), elements = new Map(), navigations = [];
  let timerId = 0, frameId = 0, fetches = 0, paints = 0, labelReads = 0;
  const writes = [];
  let tasks = [{ id: "task-1", title: "Overhead poll backoff", prompt: "", status: "open", color: "#57ff9a" }];
  const ctx = new Proxy({}, {
    get: (_target, key) => key === "clearRect" ? () => { paints += 1; } : () => {},
    set: (_target, key, value) => { writes.push([key, value]); return true; },
  });
  const element = () => ({
    hidden: false, textContent: "", title: "", className: "", checked: false, children: [], listeners: {},
    style: { setProperty() {} }, classList: { add() {} }, parentElement: { clientWidth: 800 },
    append(...nodes) { this.children.push(...nodes); },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...event }); },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 770, height: 560 }),
  });
  const get = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get("overhead-overlay").hidden = true;
  const document = {
    readyState: "complete", visibilityState: "visible", hidden: false,
    addEventListener() {}, getElementById: get, createElement: element,
  };
  const window = {
    devicePixelRatio: 1,
    addEventListener() {},
    MefiNav: { noMotion: () => !motion, claim() {}, release() {}, go: (tab, options) => navigations.push([tab, { ...options }]) },
    // Fresh objects on every read, as the real snapshot and IPC answers are.
    MefiTree: { snapshot: () => ({ nodes: [{ id: "session-1", kind: "session", get label() { labelReads += 1; return "overhead poll backoff"; }, x: 0, y: 0, z: 0, r: 4, state: "active" }], edges: [] }) },
    mefiStudio: { tasksList: async () => { fetches += 1; return { tasks: structuredClone(tasks) }; }, onTasks() {} },
  };
  vm.runInContext(source, vm.createContext({
    window, document, console,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  }));
  return {
    window, get, navigations, writes, frames,
    fetches: () => fetches, paints: () => paints, labelReads: () => labelReads,
    setTasks: (next) => { tasks = next; },
    frame(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(time)); },
    // The single live poll timer: its delay, and a runner that awaits the poll.
    poll() {
      assert.equal(timers.size, 1, "the sheet keeps exactly one poll timer armed");
      const [[id, timer]] = timers;
      return { ms: timer.ms, run: () => { timers.delete(id); return timer.fn(); } };
    },
  };
}

test("an unchanged board backs the poll off even when frames paint task boxes between polls", async () => {
  const env = environment();
  await env.window.MefiOverhead.open();
  assert.equal(env.fetches(), 1);
  const delays = [env.poll().ms];
  for (let round = 1; round <= 3; round++) {
    env.frame(round * 16); // draw() lays out the open task's box between polls
    await env.poll().run();
    delays.push(env.poll().ms);
  }
  assert.equal(env.fetches(), 4);
  assert.deepEqual(delays, [15000, 30000, 60000, 60000], "identical reads double the delay up to the cap");

  env.frame(80);
  env.setTasks([{ id: "task-1", title: "Overhead poll backoff", prompt: "", status: "active", color: "#57ff9a" }]);
  await env.poll().run();
  assert.equal(env.poll().ms, 15000, "a changed read snaps back to the base cadence");
});

test("hover and click still find the painted task box", async () => {
  const env = environment();
  await env.window.MefiOverhead.open();
  env.frame(16);
  const canvas = env.get("overhead-canvas");
  // The anchor session projects to (385, 250); the first slot puts the box right of it.
  canvas.dispatch("mousemove", { clientX: 450, clientY: 250 });
  assert.equal(canvas.style.cursor, "pointer");
  canvas.dispatch("click");
  assert.deepEqual(env.navigations, [["tasks", { taskId: "task-1" }]]);
  canvas.dispatch("mousemove", { clientX: 40, clientY: 40 });
  assert.equal(canvas.style.cursor, "default");
});

test("the sheet paints at about 30 fps whatever the display rate", async () => {
  const env = environment({ motion: true });
  await env.window.MefiOverhead.open();
  for (let tick = 0; tick < 25; tick += 1) env.frame(1000 + tick * 1000 / 144);
  assert.equal(env.paints(), 5, "a 144 Hz display paints every fifth tick");
  const before = env.paints();
  for (let tick = 1; tick <= 12; tick += 1) env.frame(1200 + tick * 1000 / 60);
  assert.equal(env.paints() - before, 6, "a 60 Hz display paints every other tick");
  assert.equal(env.frames.size, 1, "one callback stays armed between paints");
});

test("task anchors are matched once per load, and the focused box glows without a canvas shadow", async () => {
  const env = environment();
  await env.window.MefiOverhead.open();
  const toggle = env.get("overhead-overview");
  toggle.checked = true;
  toggle.dispatch("change");
  env.frame(5000);
  const reads = env.labelReads();
  assert.ok(reads > 0, "the first frame matches the task to its session");
  for (let frame = 1; frame <= 20; frame += 1) env.frame(5000 + frame * 40);
  assert.equal(env.labelReads(), reads, "later frames reuse the match instead of rescanning every session");
  await env.poll().run();
  env.frame(6000);
  assert.ok(env.labelReads() > reads, "a new load matches again against its fresh nodes");
  assert.equal(env.writes.some(([key, value]) => key === "shadowBlur" && value > 0), false, "no shadow pass for the focused box");
  assert.ok(env.writes.some(([key, value]) => key === "lineWidth" && value === 36), "its glow is a wide faint stroke instead");
});
