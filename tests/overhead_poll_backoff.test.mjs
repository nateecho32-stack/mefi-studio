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

function environment() {
  const timers = new Map(), frames = new Map(), elements = new Map(), navigations = [], documentListeners = {};
  let timerId = 0, frameId = 0, fetches = 0;
  let tasks = [{ id: "task-1", title: "Overhead poll backoff", prompt: "", status: "open", color: "#57ff9a" }];
  let painted = [], rectangles = [];
  const ctx = new Proxy({ clearRect() { painted = []; rectangles = []; }, fillText(...args) { painted.push(args); }, roundRect(x,y,w,h) { rectangles.push({x,y,w,h}); } }, { get: (target,key) => target[key] ?? (() => {}), set: () => true });
  const element = (tagName = "div") => ({
    tagName, hidden: false, title: "", className: "", checked: false, children: [], listeners: {}, dataset: {}, attributes: {},
    set textContent(value) { this.text=String(value); this.children=[]; },
    get textContent() { return (this.text||"")+this.children.map(child=>child.textContent).join(""); },
    style: { setProperty() {} }, classList: { add() {} }, parentElement: { clientWidth: 800 },
    append(...nodes) { this.children.push(...nodes); },
    setAttribute(name,value) { this.attributes[name]=String(value); },
    focus() { document.activeElement=this; this.dispatch("focus"); },
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...event }); },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 770, height: 560 }),
  });
  const get = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get("overhead-overlay").hidden = true;
  const document = {
    readyState: "complete", visibilityState: "visible", hidden: false,
    addEventListener(name, fn) { (documentListeners[name] ||= []).push(fn); }, getElementById: get, createElement: element,
  };
  const window = {
    devicePixelRatio: 1,
    addEventListener() {},
    MefiNav: { noMotion: () => true, claim() {}, release() {}, go: (tab, options) => navigations.push([tab, { ...options }]) },
    // Fresh objects on every read, as the real snapshot and IPC answers are.
    MefiTree: { snapshot: () => ({ nodes: [{ id: "session-1", kind: "session", label: "overhead poll backoff", x: 0, y: 0, z: 0, r: 4, state: "active" }], edges: [] }) },
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
    window, document, get, navigations,
    fetches: () => fetches,
    setTasks: (next) => { tasks = next; },
    pendingFrames: () => frames.size,
    painted: () => painted,
    rectangles: () => rectangles,
    setHidden(hidden) { document.hidden = hidden; document.visibilityState = hidden ? "hidden" : "visible"; for (const fn of documentListeners.visibilitychange ?? []) fn(); },
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

test("Overhead exposes tasks as native buttons and preserves keyboard focus through refresh", async () => {
  const env=environment();
  await env.window.MefiOverhead.open();
  const button=env.get("overhead-legend").children[0].children[0];
  assert.equal(button.tagName,"button");
  assert.equal(button.type,"button","native buttons support Enter and Space without canvas input");
  assert.equal(button.attributes["aria-label"],"Open task: Overhead poll backoff (open)");
  button.focus(); button.dispatch("click");
  assert.deepEqual(env.navigations,[["tasks",{taskId:"task-1"}]]);
  await env.poll().run();
  const refreshed=env.get("overhead-legend").children[0].children[0];
  assert.notEqual(refreshed,button);
  assert.equal(env.document.activeElement,refreshed);
  env.setTasks([]);
  await env.poll().run();
  assert.equal(env.document.activeElement,env.get("overhead-inspector-toggle"),"removing the last row returns focus to its inspector control");
});

test("Overhead suspends hidden frames and reduced motion holds the overview highlight", async () => {
  const env = environment();
  env.setTasks([{ id: "one", title: "First task", status: "open" }, { id: "two", title: "Second task", status: "active" }]);
  await env.window.MefiOverhead.open();
  const toggle = env.get("overhead-overview"); toggle.checked = true; toggle.dispatch("change");
  env.frame(16); const first = structuredClone(env.painted());
  env.frame(6016); assert.deepEqual(env.painted(), first, "overview does not move work under reduced motion");
  env.setHidden(true); assert.equal(env.pendingFrames(), 0);
  env.setHidden(false); assert.equal(env.pendingFrames(), 1);
  env.frame(7016); assert.deepEqual(env.painted(), first);
  env.window.MefiOverhead.close(); assert.equal(env.pendingFrames(), 0);
});

test("crowded Overhead cards stay separated and overflow remains in the task list", async () => {
  const env = environment();
  env.setTasks(Array.from({length:80},(_,i)=>({id:`task-${i}`,title:`Overhead poll backoff task ${i}`,status:"open"})));
  await env.window.MefiOverhead.open(); env.frame(16);
  const boxes = env.rectangles();
  assert.ok(boxes.length > 1 && boxes.length < 80);
  assert.equal(env.get("overhead-legend").children.length, 80);
  for (const box of boxes) {
    assert.ok(box.x >= 0 && box.x + box.w <= 770 && box.y >= 0 && box.y + box.h <= 560);
    for (const other of boxes) if (other !== box) assert.ok(box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h <= other.y || other.y + other.h <= box.y);
  }
});
