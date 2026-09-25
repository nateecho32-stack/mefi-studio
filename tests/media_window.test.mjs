import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/media-window.js", import.meta.url), "utf8");
function environment(saved = null) {
  const ids = new Map(), storage = new Map();
  if (saved) storage.set("mefiStudio.mediaWindow.v1", JSON.stringify(saved));
  let time = 10000, route = "studio", reduced = false, closed = 0, settings = 0;
  const emitter = (target = {}) => Object.assign(target, {
    listeners: {},
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    emit(name, values = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...values }; for (const fn of this.listeners[name] || []) fn(event); },
  });
  let document;
  class Element {
    constructor(tag) { emitter(this); this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.attrs = {}; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = document.body; }
    click() { this.emit("click"); }
    setPointerCapture(id) { this.captured = id; }
    releasePointerCapture() { this.captured = null; }
  }
  document = emitter({ body: new Element("body"), documentElement: new Element("html"), getElementById: id => ids.get(id), querySelector: () => null, createElement: tag => new Element(tag) });
  const window = emitter({ innerWidth: 1440, innerHeight: 900, performance: { now: () => time }, MefiNav: { top: () => route }, matchMedia: () => ({ matches: reduced }) });
  const content = new Element("div"), frame = new Element("iframe"); content.append(frame);
  const context = vm.createContext({ document, window, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(source, context);
  const controller = window.MefiMediaWindow.create({ content, onClose: () => { closed++; }, onSettings: () => { settings++; } });
  const root = ids.get("media-window");
  const rect = () => ({ x: parseFloat(root.style.left), y: parseFloat(root.style.top), width: parseFloat(root.style.width), height: parseFloat(root.style.height) });
  const pointer = (x, y, values = {}) => document.emit("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", buttons: 0, ...values });
  const begin = (id, x, y) => ids.get(`media-window-${id}`).emit("pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 1 });
  const finish = () => document.emit("pointerup", { pointerId: 1 });
  const advance = ms => { time += ms; };
  return { controller, root, content, frame, ids, document, window, storage, rect, pointer, begin, finish, advance,
    route: value => { route = value; }, reduced: value => { reduced = value; }, closed: () => closed, settings: () => settings,
    show: (shape = "video") => controller.show({ shape, label: "Fixture video" }),
  };
}

test("Media moves and resizes without remounting content, persists only deliberate geometry and stays on screen", () => {
  const env = environment();
  assert.equal(env.root.hidden, true);
  env.show(); const original = env.rect();
  env.begin("move", original.x + 30, original.y + 20);
  env.pointer(original.x - 170, original.y - 80, { buttons: 1 }); env.finish();
  assert.equal(env.rect().x, original.x - 200); assert.equal(env.rect().y, original.y - 100);
  const moved = env.rect();
  env.begin("resize-se", moved.x + moved.width, moved.y + moved.height);
  env.pointer(moved.x + moved.width + 90, moved.y + moved.height + 80, { buttons: 1 }); env.finish();
  assert.equal(env.rect().width, original.width + 90); assert.equal(env.rect().height, original.height + 80);
  const preference = JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1"));
  assert.equal(preference.size.video.width, 530);
  const restored = environment(preference); restored.show(); assert.deepEqual(restored.rect(), env.rect());
  env.window.innerWidth = 600; env.window.innerHeight = 560; env.window.emit("resize");
  const small = env.rect(); assert.ok(small.x >= 16 && small.y >= 16 && small.x + small.width <= 584 && small.y + small.height <= 544);
  assert.equal(env.content.parent, env.root); assert.equal(env.content.children[0], env.frame);
  assert.equal(env.frame.parent, env.content, "the playing browsing context stays mounted");
});

test("All eight resize grips preserve the opposite edges and obey minimum and viewport limits", () => {
  for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
    const env = environment({ x: .5, y: .5 }); env.show(); const before = env.rect();
    env.begin(`resize-${edge}`, 700, 450); env.pointer(720, 465, { buttons: 1 }); env.finish(); const after = env.rect();
    if (edge.includes("w")) assert.equal(after.x + after.width, before.x + before.width);
    else assert.equal(after.x, before.x);
    if (edge.includes("n")) assert.equal(after.y + after.height, before.y + before.height);
    else assert.equal(after.y, before.y);
    env.begin(`resize-${edge}`, 700, 450); env.pointer(-10000, -10000, { buttons: 1 }); env.finish();
    const bounded = env.rect(); assert.ok(bounded.width >= 304 && bounded.height >= 152 && bounded.x >= 16 && bounded.y >= 16);
  }
});

test("Menus yield once to an approaching mouse and following the relocated player wins", () => {
  const env = environment(); env.show(); env.advance(1800);
  const before = env.rect(); env.pointer(before.x - 40, before.y + 80); const moved = env.rect();
  assert.notDeepEqual(moved, before); assert.equal(env.storage.size, 0, "dodging does not overwrite the saved placement");
  for (let index = 0; index < 8; index++) { env.advance(1000); env.pointer(moved.x + moved.width + 200 - index * 24, moved.y + 60); }
  assert.deepEqual(env.rect(), moved, "even a slow pursuit must not trigger a second dodge");
  env.root.emit("pointerenter"); env.pointer(moved.x + 15, moved.y + 15); env.advance(10000);
  assert.deepEqual(env.rect(), moved);
  env.root.emit("pointerleave"); env.pointer(0, 0); env.advance(2500); env.pointer(0, 0); env.pointer(moved.x + moved.width + 40, moved.y + 80);
  assert.notDeepEqual(env.rect(), moved, "after time away, a fresh approach can move it again");
});

test("Home, Command, hover, keyboard focus, touch, pin and reduced motion keep the player still", () => {
  for (const scenario of ["workspace", "command", "hover", "focus", "touch", "pin", "avoid-off", "motion-off", "os-reduce", "fullscreen"]) {
    const env = environment(); env.show(); env.advance(1800); const before = env.rect();
    if (["workspace", "command"].includes(scenario)) env.route(scenario);
    if (scenario === "hover") env.root.emit("pointerenter");
    if (scenario === "focus") env.frame.focus();
    if (scenario === "pin") env.ids.get("media-window-pin").click();
    if (scenario === "avoid-off") env.ids.get("media-window-avoid").click();
    if (scenario === "motion-off") env.document.documentElement.dataset.motion = "off";
    if (scenario === "os-reduce") env.reduced(true);
    if (scenario === "fullscreen") env.document.fullscreenElement = env.frame;
    env.pointer(before.x - 40, before.y + 80, { pointerType: scenario === "touch" ? "touch" : "mouse" });
    assert.deepEqual(env.rect(), before, scenario);
  }
});

test("Minimize, reveal, navigation and shape changes retain the frame; close delegates stopping playback", () => {
  const env = environment(); env.show(); const first = env.rect();
  env.ids.get("media-window-minimize").click(); assert.equal(env.rect().height, 44);
  env.window.emit("mefi:nav"); assert.equal(env.root.hidden, false);
  env.controller.reveal(); assert.deepEqual(env.rect(), first);
  env.show("tall"); assert.equal(env.rect().height, 352);
  env.show("audio"); assert.equal(env.rect().height, 104);
  assert.equal(env.frame.parent, env.content);
  env.ids.get("media-window-settings").click(); assert.equal(env.settings(), 1);
  env.ids.get("media-window-close").click(); assert.equal(env.closed(), 1); assert.equal(env.root.hidden, true);
});

test("Keyboard adjustments and pointer cancellation are bounded and preference corruption is harmless", () => {
  const env = environment({ x: 900, y: -55, size: { video: { width: "bad", height: -500 } }, avoid: "false", pinned: "true" }); env.show();
  const before = env.rect(); assert.equal(before.width, 440); assert.equal(before.y, 16); assert.equal(before.height, 152);
  env.ids.get("media-window-move").emit("keydown", { key: "ArrowLeft" }); assert.equal(env.rect().x, before.x - 16);
  env.ids.get("media-window-resize-se").emit("keydown", { key: "ArrowDown", shiftKey: true }); assert.equal(env.rect().height, 154);
  env.begin("move", 700, 450); env.document.emit("pointercancel", { pointerId: 1 });
  assert.equal(env.root.dataset.interacting, "false");
  const canceled = env.rect(); env.pointer(100, 100, { buttons: 1 }); assert.deepEqual(env.rect(), canceled);
  env.ids.get("media-window-pin").click(); env.ids.get("media-window-avoid").click();
  const persisted = JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1")); assert.equal(persisted.pinned, true); assert.equal(persisted.avoid, false);
});
