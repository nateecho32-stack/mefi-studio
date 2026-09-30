import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/media-window.js", import.meta.url), "utf8");
const dynamicsSource = await readFile(new URL("../renderer/tree-dynamics.js", import.meta.url), "utf8");
function environment(saved = null, withSettingsHost = false) {
  const ids = new Map(), storage = new Map();
  if (saved) storage.set("mefiStudio.mediaWindow.v1", JSON.stringify(saved));
  const toasts = [], intervals = new Map(), placements = [], moves = [];
  let timerId = 0;
  let tasksListener, projectsListener;
  let time = 10000, route = "studio", reduced = false, closed = 0, settings = 0;
  const emitter = (target = {}) => Object.assign(target, {
    listeners: {},
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    emit(name, values = {}) { const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...values }; for (const fn of this.listeners[name] || []) fn(event); },
  });
  let document;
  class Element {
    constructor(tag) { emitter(this); this.tagName = tag; this.style = { setProperty(key, value) { this[key] = value; } }; this.dataset = {}; this.children = []; this.attrs = {}; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    get parentElement() { return this.parent ?? null; }
    // Moving a node that already has a parent by any way but moveBefore
    // unloads whatever plays inside it (an iframe restarts); `reloads` counts those.
    adopt(node) { if (node.parent && node.parent !== this) node.reloads = (node.reloads || 0) + 1; }
    append(...nodes) { for (const node of nodes) { this.adopt(node); node.remove(); node.parent = this; this.children.push(node); } }
    prepend(...nodes) { for (const node of [...nodes].reverse()) { this.adopt(node); node.remove(); node.parent = this; this.children.unshift(node); } }
    insertBefore(node, reference) { this.adopt(node); node.remove(); node.parent = this; this.children.splice(this.children.indexOf(reference), 0, node); }
    // The state-preserving move: the node keeps playing. A host can be told to refuse it.
    moveBefore(node, reference) {
      if (this.refuseMoves) throw new Error("InvalidStateError");
      node.remove(); node.parent = this; const at = reference ? this.children.indexOf(reference) : -1;
      if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
      moves.push([node.id, this.id || this.tagName]);
    }
    getBoundingClientRect() { const r = this.rect || { x: 0, y: 0, width: 0, height: 0 }; return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelector(selector) { return this.children.find(child => `#${child.id}` === selector) || this.children.map(child => child.querySelector(selector)).find(Boolean) || null; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = document.body; }
    click() { this.emit("click"); }
    setPointerCapture(id) { this.captured = id; }
    releasePointerCapture() { this.captured = null; }
  }
  document = emitter({ body: new Element("body"), documentElement: new Element("html"), getElementById: id => ids.get(id), querySelector: () => null, createElement: tag => new Element(tag) });
  const window = emitter({ setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id), mefiStudio: { onTasks: fn => { tasksListener = fn; }, onProjects: fn => { projectsListener = fn; } }, MefiToast: (...args) => toasts.push(args), innerWidth: 1440, innerHeight: 900, performance: { now: () => time }, MefiNav: { top: () => route }, matchMedia: () => ({ matches: reduced }) });
  const content = new Element("div"), frame = new Element("iframe"); content.append(frame);
  const settingsHost = withSettingsHost ? new Element("section") : undefined;
  if (settingsHost) document.body.append(settingsHost);
  const context = vm.createContext({ Date: { now: () => time }, document, window, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(source, context);
  const controller = window.MefiMediaWindow.create({ content, settingsHost, onPlacement: placement => placements.push({ ...placement }), onClose: () => { closed++; }, onSettings: () => { settings++; } });
  const root = ids.get("media-window");
  const rect = () => ({ x: parseFloat(root.style.left), y: parseFloat(root.style.top), width: parseFloat(root.style.width), height: parseFloat(root.style.height) });
  // Where the player is drawn: floating, its own style; carried into another
  // element (the menu's stage), that element's box.
  root.getBoundingClientRect = () => root.parent !== document.body && root.parent?.rect ? root.parent.getBoundingClientRect() : { ...rect(), left: rect().x, top: rect().y };
  // A stand-in for the menu's stage: an element with a box of its own.
  const stage = (box = { x: 150, y: 220, width: 520, height: 300 }) => { const node = document.createElement("div"); node.id = "fixture-stage"; node.rect = box; document.body.append(node); return node; };
  const pointer = (x, y, values = {}) => document.emit("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", buttons: 0, ...values });
  const begin = (id, x, y) => ids.get(`media-window-${id}`).emit("pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 1 });
  const finish = () => document.emit("pointerup", { pointerId: 1 });
  const advance = ms => { time += ms; };
  return { intervals, toasts, placements, moves, stage, tasks: value => tasksListener(value), projects: value => projectsListener(value), controller, root, content, frame, settingsHost, ids, document, window, storage, rect, pointer, begin, finish, advance,
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
  assert.equal(preference.size.video.width, 690);
  const restored = environment(preference); restored.show(); assert.deepEqual(restored.rect(), env.rect());
  env.window.innerWidth = 600; env.window.innerHeight = 560; env.window.emit("resize");
  const small = env.rect(); assert.ok(small.x >= 16 && small.y >= 16 && small.x + small.width <= 584 && small.y + small.height <= 544);
  assert.equal(env.content.parent, env.root); assert.equal(env.content.children[0], env.frame);
  assert.equal(env.frame.parent, env.content, "the playing browsing context stays mounted");
});

test("Window controls remain on the player when video settings are in a separate menu", () => {
  const env = environment(null, true); env.show();
  const toolbar = env.ids.get("media-window-move").parent;
  assert.equal(toolbar.parent, env.root);
  assert.equal(env.ids.get("media-window-move").textContent, "⠿ Fixture video");
  for (const action of ["settings", "minimize", "close"]) assert.equal(env.ids.get(`media-window-${action}`).parent, toolbar);
  assert.equal(env.settingsHost.contains(env.ids.get("media-window-background")), true);
  env.settingsHost.hidden = true;
  env.ids.get("media-window-minimize").click();
  assert.equal(toolbar.parent, env.root); assert.equal(toolbar.hidden, false);
  assert.equal(env.ids.get("media-window-settings").hidden, true);
  env.ids.get("media-window-minimize").click();
  assert.equal(env.ids.get("media-window-settings").hidden, false);
  env.ids.get("media-window-settings").click(); assert.equal(env.settings(), 1);
  env.controller.setBackground(true);
  assert.equal(env.settingsHost.contains(toolbar), true);
  env.controller.setBackground(false);
  assert.equal(toolbar.parent, env.root); assert.equal(env.root.children[0], toolbar);
  env.show("browser"); assert.equal(toolbar.hidden, true, "the browser provides its own expanded toolbar");
  env.ids.get("media-window-minimize").click(); assert.equal(toolbar.hidden, false, "a minimized browser still offers Restore");
  env.ids.get("media-window-close").click(); assert.equal(env.closed(), 1);
  assert.equal(env.frame.parent, env.content);
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
    const bounded = env.rect(); assert.ok(bounded.width >= 464 && bounded.height >= 260 && bounded.x >= 16 && bounded.y >= 16);
  }
});

// Docking (the 2026-09 redesign): the menu hands over the element of its stage
// and the whole player is carried into it with moveBefore, the one move that
// keeps a live iframe playing. The stage then sizes and places the player, and
// the menu's own scroll moves it, so no script chases it frame by frame.
test("The media panel docks the same frame, releases it for backgrounds, and preserves floating placement", () => {
  const env = environment(); env.show(); const floating = env.rect();
  const stage = env.stage();
  assert.equal(env.controller.dock(stage), true);
  assert.equal(env.root.parent, stage, "the player is carried into the stage");
  assert.deepEqual(env.moves.at(-1), ["media-window", "fixture-stage"], "with moveBefore");
  assert.equal(env.root.dataset.docked, "true");
  for (const key of ["left", "top", "width", "height"]) assert.equal(env.root.style[key], "", `the stage, not a script, sets the ${key}`);
  assert.equal(env.root.style.clipPath, "none");
  env.controller.clip([0, 0, 30, 0]);
  assert.equal(env.root.style.clipPath, "inset(0px 0px 30px 0px)", "a website is cut to the part of the stage the menu shows");
  env.controller.setBackground(true);
  assert.equal(env.root.dataset.background, "true"); assert.equal(env.root.dataset.docked, "false"); assert.equal(env.content.inert, true);
  assert.equal(env.root.parent, env.document.body, "a backdrop lives on the page, not in the menu");
  env.controller.setBackground(false); assert.equal(env.root.dataset.docked, "true");
  assert.equal(env.root.parent, stage, "it returns to the stage when the backdrop is turned off");
  env.controller.dock(null); assert.deepEqual(env.rect(), floating);
  assert.equal(env.root.parent, env.document.body);
  assert.equal(env.frame.parent, env.content); assert.equal(env.root.style.clipPath, "none");
  assert.equal(env.root.reloads ?? 0, 0, "the player only ever moved with moveBefore, so its frame never reloaded");
  assert.equal(env.storage.get("mefiStudio.mediaWindow.v1")?.includes('"width":520') ?? false, false, "docking never overwrites floating dimensions");
});

test("Dragging or moving a docked player starts from its visible location and keeps it detached", () => {
  for (const method of ["pointer", "keyboard"]) {
    const env = environment(); env.show();
    const dock = { x: 150, y: 220, width: 520, height: 300 };
    const stage = env.stage(dock);
    env.controller.dock(stage);
    if (method === "pointer") {
      env.begin("move", 180, 240);
      assert.deepEqual(env.rect(), dock, "grabbing the toolbar does not teleport the player");
      assert.equal(env.root.parent, env.document.body, "a dragged player leaves the stage");
      env.pointer(210, 260, { buttons: 1 }); env.finish();
      assert.deepEqual(env.rect(), { ...dock, x: 180, y: 240 });
    } else {
      env.ids.get("media-window-move").emit("keydown", { key: "ArrowRight" });
      assert.deepEqual(env.rect(), { ...dock, x: 166 });
    }
    const detached = env.rect(); assert.equal(env.controller.dock(stage), false);
    assert.deepEqual(env.rect(), detached, "menu layout does not snap a manually moved player back");
    assert.equal(env.root.dataset.docked, "false"); assert.equal(env.root.parent, env.document.body);
    const restored = environment(JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1"))); restored.show();
    for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(restored.rect()[key] - detached[key]) < .001, key);
    assert.equal(env.frame.parent, env.content);
    // Closing the menu ends the detour: the next time it opens, the player docks again.
    env.controller.dock(null); assert.equal(env.controller.dock(stage), true); assert.equal(env.root.parent, stage);
  }
});

test("The default player stays still as its controls are approached; Move aside is opt-in", () => {
  const env = environment(); env.show(); env.advance(1800);
  const before = env.rect(); env.pointer(before.x - 40, before.y + 80);
  assert.deepEqual(env.rect(), before); assert.equal(env.ids.get("media-window-avoid").attrs["aria-pressed"], "false");
  env.ids.get("media-window-avoid").click(); env.pointer(before.x - 30, before.y + 80);
  assert.notDeepEqual(env.rect(), before);
  assert.equal(JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1")).avoid, true);
});

test("Menus yield once to an approaching mouse and following the relocated player wins", () => {
  const env = environment({ avoid: true }); env.show(); env.advance(1800);
  const saved = env.storage.get("mefiStudio.mediaWindow.v1");
  const before = env.rect(); env.pointer(before.x - 40, before.y + 80); const moved = env.rect();
  assert.notDeepEqual(moved, before); assert.equal(env.storage.get("mefiStudio.mediaWindow.v1"), saved, "dodging does not overwrite the saved placement");
  for (let index = 0; index < 8; index++) { env.advance(1000); env.pointer(moved.x + moved.width + 200 - index * 24, moved.y + 60); }
  assert.deepEqual(env.rect(), moved, "even a slow pursuit must not trigger a second dodge");
  env.root.emit("pointerenter"); env.pointer(moved.x + 15, moved.y + 15); env.advance(10000);
  assert.deepEqual(env.rect(), moved);
  env.root.emit("pointerleave"); env.pointer(0, 0); env.advance(2500); env.pointer(0, 0); env.pointer(moved.x + moved.width + 40, moved.y + 80);
  assert.notDeepEqual(env.rect(), moved, "after time away, a fresh approach can move it again");
});

test("Home, Command, hover, keyboard focus, touch, pin and reduced motion keep the player still", () => {
  for (const scenario of ["workspace", "command", "hover", "focus", "touch", "pin", "avoid-off", "motion-off", "os-reduce", "fullscreen"]) {
    const env = environment({ avoid: true }); env.show(); env.advance(1800); const before = env.rect();
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
  env.ids.get("media-window-minimize").click(); assert.equal(env.rect().height, 60);
  env.window.emit("mefi:nav"); assert.equal(env.root.hidden, false);
  env.controller.reveal(); assert.deepEqual(env.rect(), first);
  env.show("tall"); assert.equal(env.rect().height, 412);
  env.show("audio"); assert.equal(env.rect().height, 148);
  assert.equal(env.frame.parent, env.content);
  env.ids.get("media-window-settings").click(); assert.equal(env.settings(), 1);
  env.ids.get("media-window-close").click(); assert.equal(env.closed(), 1); assert.equal(env.root.hidden, true);
});

test("Browser and provider minimize, restore and reveal focus the visible player controls", () => {
  for (const shape of ["browser", "video"]) {
    const env = environment(null, true);
    const browserMove = env.document.createElement("button"); browserMove.id = "browser-move"; env.content.append(browserMove);
    env.show(shape);
    const move = shape === "browser" ? browserMove : env.ids.get("media-window-move");
    const minimize = env.ids.get("media-window-minimize");
    move.focus(); env.controller.minimize();
    assert.equal(env.document.activeElement, minimize, "minimizing transfers focus out of hidden playback");
    assert.equal(env.content.inert, true);
    minimize.click();
    assert.equal(env.document.activeElement, move, "restoring focuses the toolbar that remains visible");
    assert.equal(env.content.inert, false);
    env.document.body.focus(); env.controller.reveal();
    assert.equal(env.document.activeElement, move, "Float player / Show player focuses the current playback toolbar");
    env.controller.minimize(); env.controller.reveal();
    assert.equal(env.document.activeElement, move);
  }
});

test("Code that un-minimizes the player on its way elsewhere leaves focus where it was", () => {
  const env = environment(); env.show();
  const elsewhere = env.document.createElement("button"); env.document.body.append(elsewhere);
  const minimized = () => env.root.dataset.minimized === "true";
  for (const [name, run] of [
    ["hide", () => env.controller.hide()],
    ["setBackground", () => env.controller.setBackground(true)],
    ["restore", () => env.controller.restore({ minimized: false })],
  ]) {
    env.controller.setBackground(false); env.show(); env.controller.minimize(); assert.equal(minimized(), true, name);
    elsewhere.focus(); run();
    assert.equal(minimized(), false, name);
    assert.equal(env.document.activeElement, elsewhere, `${name} must not pull focus into the player`);
  }
  elsewhere.focus(); env.controller.restore({ minimized: true });
  assert.equal(minimized(), true); assert.equal(env.document.activeElement, elsewhere, "restoring a saved minimized state does not focus either");
});

test("Keyboard adjustments and pointer cancellation are bounded and preference corruption is harmless", () => {
  const env = environment({ x: 900, y: -55, size: { video: { width: "bad", height: -500 } }, avoid: "false", pinned: "true" }); env.show();
  const before = env.rect(); assert.equal(before.width, 600); assert.equal(before.y, 16); assert.equal(before.height, 260);
  env.ids.get("media-window-move").emit("keydown", { key: "ArrowLeft" }); assert.equal(env.rect().x, before.x - 16);
  env.ids.get("media-window-resize-se").emit("keydown", { key: "ArrowDown", shiftKey: true }); assert.equal(env.rect().height, 262);
  env.begin("move", 700, 450); env.document.emit("pointercancel", { pointerId: 1 });
  assert.equal(env.root.dataset.interacting, "false");
  const canceled = env.rect(); env.pointer(100, 100, { buttons: 1 }); assert.deepEqual(env.rect(), canceled);
  env.ids.get("media-window-pin").click(); env.ids.get("media-window-avoid").click();
  const persisted = JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1")); assert.equal(persisted.pinned, true); assert.equal(persisted.avoid, true);
});


test("Background and transparency preserve the player, floating geometry and saved settings", () => {
  const env = environment(); env.show(); const original = env.rect();
  env.ids.get("media-window-background").click();
  assert.equal(env.root.dataset.background, "true"); assert.equal(env.content.inert, true);
  assert.equal(env.document.body.dataset.mediaBackground, "true");
  const slider = env.ids.get("media-window-transparency"); slider.value = "65"; slider.emit("input");
  assert.equal(env.content.style.opacity, "0.35");
  env.controller.reveal(); assert.equal(env.document.activeElement, env.ids.get("media-window-background"));
  const saved = JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1"));
  const restored = environment(saved); restored.show();
  assert.equal(restored.root.dataset.background, "true"); assert.equal(restored.content.style.opacity, "0.35");
  env.ids.get("media-window-background").click(); assert.deepEqual(env.rect(), original);
  assert.equal(env.content.inert, false); assert.equal(env.frame.parent, env.content);
  env.controller.hide(); assert.equal(env.document.body.dataset.mediaBackground, "false");
});

test("Tree transparency and video brightness are independent, start undimmed, persist and clamp", () => {
  const env = environment(); env.show(); env.ids.get("media-window-background").click();
  assert.equal(env.content.style.filter, "brightness(1)"); assert.equal(env.content.style.opacity, "1");
  assert.equal(env.document.body.style["--media-tree-opacity"], "1");
  const tree = env.ids.get("media-window-tree-transparency"), brightness = env.ids.get("media-window-brightness");
  tree.value = "35"; tree.emit("input"); brightness.value = "125"; brightness.emit("input");
  assert.equal(env.content.style.opacity, "1"); assert.equal(env.content.style.filter, "brightness(1.25)");
  assert.equal(env.document.body.style["--media-tree-opacity"], "0.65");
  const restored = environment(JSON.parse(env.storage.get("mefiStudio.mediaWindow.v1"))); restored.show();
  assert.equal(restored.content.style.filter, "brightness(1.25)"); assert.equal(restored.document.body.style["--media-tree-opacity"], "0.65");
  env.controller.hide(); assert.equal(env.document.body.dataset.mediaVisible, "false");
  const bounded = environment({ treeTransparency: 200, videoBrightness: -10 }); bounded.show();
  assert.equal(bounded.ids.get("media-window-tree-transparency").value, "90"); assert.equal(bounded.content.style.filter, "brightness(0.25)");
});

test("Adjusting video transparency or brightness releases a completion fade", () => {
  for (const [id, value] of [["media-window-transparency", "0"], ["media-window-brightness", "100"]]) {
    const env = environment(); env.show(); env.tasks([{ id: "task", status: "active" }]); env.tasks([{ id: "task", status: "done" }]);
    assert.equal(env.content.style.opacity, "0.08");
    const slider = env.ids.get(id); slider.value = value; slider.emit("input");
    assert.equal(env.content.style.opacity, "1"); assert.equal(env.content.style.filter, "brightness(1)");
    assert.equal(env.ids.get("media-window-restore").hidden, true);
  }
});

test("Only newly completed tasks fade media and notify, with restore, opt-out and project guards", () => {
  const env = environment(); env.show();
  const task = (id, status, extra = {}) => ({ id, status, title: id, projectId: "a", ...extra });
  env.projects({ activeId: "a" });
  env.tasks([task("old", "done"), task("work", "active"), task("drop", "active")]);
  assert.equal(env.toasts.length, 0);
  env.tasks([task("old", "done"), task("work", "awaiting_verification"), task("drop", "done", { dropped: { at: 1 } })]);
  assert.equal(env.toasts.length, 0);
  env.tasks([task("work", "done")]); assert.equal(env.toasts.length, 1);
  assert.equal(env.content.style.opacity, "0.08");
  env.tasks([task("work", "done")]); assert.equal(env.toasts.length, 1);
  env.toasts[0][2].secondary.run(); assert.equal(env.content.style.opacity, "1");
  env.ids.get("media-window-fade").click();
  env.tasks([task("work", "active")]); env.tasks([task("work", "done")]); assert.equal(env.toasts.length, 1);
  env.ids.get("media-window-fade").click();
  env.projects({ activeId: "b" }); env.tasks([task("work", "done", { projectId: "b" })]); assert.equal(env.toasts.length, 1);
  env.controller.hide(); env.tasks([task("work", "active", { projectId: "b" })]); env.tasks([task("work", "done", { projectId: "b" })]);
  assert.equal(env.toasts.length, 1);
});


test("Dark-area tracking waits for stable shadows, holds its position, and stops when disabled", async () => {
  const env = environment(); const moves = [];
  let scores = [.05, .2, .3, .2, .3, .4, .3, .4, .5];
  env.window.mefiStudio.mediaSceneSample = async () => ({ ok: true, scores });
  env.window.MefiIdle = { mediaSceneArea: () => ({ x: 0, y: 0, w: 800, h: 600 }), setMediaFocus: point => { if (point) moves.push(point); return true; } };
  env.show(); env.ids.get("media-window-background").click(); env.ids.get("media-window-dark").click();
  const sample = [...env.intervals.values()][0]; assert.equal(typeof sample, "function");
  env.advance(30000); await sample(); await sample(); assert.equal(moves.length, 0);
  await sample(); assert.equal(moves.length, 1); assert.equal(moves[0].x, 0); assert.equal(moves[0].y, 0);
  scores = [.5, .4, .3, .4, .3, .2, .3, .2, .01];
  await sample(); await sample(); await sample(); assert.equal(moves.length, 1, "cooldown prevents chasing a scene cut");
  env.advance(31000); await sample(); assert.equal(moves.length, 2);
  env.ids.get("media-window-dark").click(); assert.equal(env.intervals.size, 0);
});

test("Shared video modes start sampling, pass the tree footprint, and reject old responses after mode changes", async () => {
  const env = environment();
  env.window.dispatchEvent = event => env.window.emit(event.type);
  vm.runInNewContext(dynamicsSource, { window: env.window, document: env.document,
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => env.storage.get(key), setItem: (key, value) => env.storage.set(key, value) } });
  const d = env.window.MefiTreeDynamics;
  const moves = []; let request, resolve;
  env.window.MefiIdle = { mediaSceneArea: () => ({ x: 0, y: 0, w: 800, h: 600 }), setMediaFocus: point => moves.push(point) };
  env.window.mefiStudio.mediaSceneSample = rect => { request = rect; return new Promise(done => { resolve = done; }); };
  env.show(); env.ids.get("media-window-background").click();
  assert.equal(env.intervals.size, 0);
  d.update({ mode: "hybrid", videoTarget: "bright" });
  assert.equal(env.intervals.size, 1);
  const sample = [...env.intervals.values()][0]; const pending = sample();
  assert.ok(request.coverageW >= .4 && request.coverageW <= .96);
  d.update({ mode: "steady" }); assert.equal(env.intervals.size, 0);
  resolve({ ok: true, scores: [.9, .4, .3, .4, .5, .4, .3, .2, .1] }); await pending;
  assert.equal(d.status().scene, null); assert.ok(moves.every(point => point === null));
  env.ids.get("media-window-dark").click(); assert.equal(d.preferences().mode, "video");
  assert.equal(d.preferences().videoTarget, "dark"); assert.equal(env.intervals.size, 1);
  env.controller.hide(); assert.equal(d.status().available, false); assert.equal(env.intervals.size, 0);
});
