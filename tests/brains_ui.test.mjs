// The brain-map editor has two jobs a test can hold it to: a wire must land on
// the port it was drawn from (the geometry is computed, never measured), and a
// wire must only join ends that can carry the same thing. The rest — what a
// selected part says it may do — comes from the catalog, so the inspector is
// checked against that rather than against a fixture.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import brains from "../scripts/brains.cjs";

const source = await readFile(new URL("../renderer/brains.js", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 40; index += 1) await Promise.resolve(); };

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.className = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.parentElement = null;
    this.ownText = "";
    this.rect = { left: 0, top: 0, width: 236, height: 110 };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  get classes() { return String(this.className).split(/\s+/).filter(Boolean); }
  append(...children) {
    for (const child of children) { child.parentElement = this; this.children.push(child); }
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] ?? []).filter((item) => item !== fn); }
  focus() { this.focused = true; }
  scrollTo() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  matches(selector) {
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (part.startsWith(".")) return this.classes.includes(part.slice(1));
      if (part.startsWith("[")) return part.slice(1, -1) in this.attrs;
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) { return this.descendants().filter((node) => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  click() { void this.fire("click"); }
  async fire(name, extra = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const fn of this.listeners[name] ?? []) await fn(event);
    let node = this.parentElement;
    while (node) {
      for (const fn of node.listeners?.[name] ?? []) await fn(event);
      node = node.parentElement;
    }
  }
}

const IDS = [
  "brains-overlay", "brains-canvas", "brains-canvas-wrap", "brains-wires", "brains-inspector",
  "brains-parts-list", "brains-parts-search", "brains-problems", "brains-status", "brains-switcher",
  "brains-save", "brains-activate", "brains-new", "brains-duplicate", "brains-delete", "brains-draft",
  "brains-close", "brains-search", "brains-search-input", "brains-search-list", "brains-search-hint",
  "brains-dirty", "brains-live",
];

// extraIds adds elements the default page leaves out (brains.js guards every
// optional one), bridge overrides host calls, and activeId makes another map
// the live one.
async function editor({ map = brains.defaultMap(), saves = [], extraIds = [], bridge: overrides = {}, activeId = null } = {}) {
  const elements = new Map([...IDS, ...extraIds].map((id) => [id, new Element(id.includes("input") || id.includes("search") ? "input" : "div")]));
  const documentKeys = [];
  const catalog = brains.catalog();
  let current = brains.normalizeMap(map);
  const bridge = {
    brainsCatalog: async () => ({ ok: true, catalog }),
    brainsState: async () => ({ ok: true, activeId: activeId ?? current.id, maps: [brains.summarize(current)] }),
    brainsRead: async () => ({ ok: true, map: current, compiled: brains.compileMap(current), active: true }),
    brainsValidate: async (candidate) => {
      const normalized = brains.normalizeMap(candidate);
      return { ok: true, map: normalized, result: brains.validateMap(normalized), compiled: brains.compileMap(normalized) };
    },
    brainsSave: async (candidate) => {
      saves.push(candidate);
      current = brains.normalizeMap(candidate);
      return { ok: true, map: current, compiled: brains.compileMap(current) };
    },
    onBrains: () => {},
    ...overrides,
  };
  const context = {
    console,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
    document: {
      readyState: "complete",
      getElementById: (id) => elements.get(id) ?? null,
      createElement: (tag) => new Element(tag),
      createElementNS: (_ns, tag) => new Element(tag),
      addEventListener: (name, fn) => { if (name === "keydown") documentKeys.push(fn); },
    },
    window: {
      mefiStudio: bridge,
      MefiNav: { claim() {}, release() {}, go() {} },
      addEventListener: () => {},
      confirm: () => true,
      prompt: () => "Prompted name",
    },
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.window.MefiBrains.open();
  await flush();
  const canvas = elements.get("brains-canvas");
  const key = async (event) => { for (const fn of documentKeys) await fn({ preventDefault() {}, stopPropagation() {}, target: elements.get("brains-canvas-wrap"), ...event }); };
  return {
    context, elements, canvas, key, saves,
    nodes: () => canvas.querySelectorAll(".brains-node"),
    wires: () => elements.get("brains-wires").querySelectorAll("path"),
    port: (node, port, dir) => canvas.querySelectorAll(".brains-port").find((item) => item.dataset.node === node && item.dataset.port === port && item.dataset.dir === dir),
    status: () => elements.get("brains-status").textContent,
    inspector: () => elements.get("brains-inspector"),
    problems: () => elements.get("brains-problems").textContent,
  };
}

test("the shipped pipeline draws every part and every wire", async () => {
  const ui = await editor();
  assert.equal(ui.nodes().length, 18);
  assert.equal(ui.wires().length, 23);
  assert.equal(ui.elements.get("brains-save").disabled, true, "nothing to save before an edit");
  assert.match(ui.problems(), /No problems/);
  // The parts rail offers the whole catalog, grouped.
  const parts = ui.elements.get("brains-parts-list").querySelectorAll(".brains-part");
  assert.equal(parts.length, brains.NODE_TYPES.length);
});

test("a wire starts and ends on the port dot it was drawn from", async () => {
  const ui = await editor();
  const dot = (node, port, dir) => {
    const box = ui.nodes().find((item) => item.dataset.node === node);
    const column = box.querySelectorAll(".brains-port").filter((item) => item.dataset.dir === dir);
    const index = column.findIndex((item) => item.dataset.port === port);
    const top = Number(String(box.style.top).replace("px", ""));
    const left = Number(String(box.style.left).replace("px", ""));
    // head 48 + border 1 + half a 36px row, and 11px in from the edge.
    return { x: left + (dir === "in" ? 11 : 236 - 11), y: top + 1 + 48 + index * 36 + 18 };
  };
  for (const path of ui.wires()) {
    const [, x1, y1, x2, y2] = path.attrs.d.match(/^M ([\d.-]+) ([\d.-]+) C [\d.-]+ [\d.-]+, [\d.-]+ [\d.-]+, ([\d.-]+) ([\d.-]+)$/);
    const edge = brains.defaultMap().edges.find((item) => item.id === path.dataset.edge);
    assert.ok(edge, `${path.dataset.edge} is a real wire`);
    const from = dot(edge.from.node, edge.from.port, "out");
    const to = dot(edge.to.node, edge.to.port, "in");
    assert.deepEqual([Number(x1), Number(y1)], [from.x, from.y], `${edge.id} starts on its output dot`);
    assert.deepEqual([Number(x2), Number(y2)], [to.x, to.y], `${edge.id} ends on its input dot`);
  }
});

test("clicking two ends wires them, and only when they can carry the same thing", async () => {
  const ui = await editor();
  const before = ui.wires().length;
  await ui.port("n_jev_classify", "values", "out").fire("click");
  assert.match(ui.status(), /Wiring from Jev/);
  assert.equal(ui.canvas.querySelectorAll(".brains-port").filter((port) => port.dataset.armed === "true").length, 1);
  // values into an analysis input cannot mean anything, and says so.
  await ui.port("n_plan_build", "in", "in").fire("click");
  assert.match(ui.status(), /Values carries values; Analysis takes analysis\/request/);
  assert.equal(ui.wires().length, before, "nothing was wired");
  // the same output into the model picker's values input is exactly right
  await ui.port("n_model_pick", "values", "in").fire("click");
  assert.match(ui.status(), /already wired/, "that wire is already in the shipped map");
  await ui.port("n_verify_evidence", "issues", "out").fire("click");
  await ui.port("n_issue_triage", "issue", "in").fire("click");
  assert.equal(ui.wires().length, before + 1);
  assert.equal(ui.elements.get("brains-save").disabled, false, "an edit can be saved");
  assert.equal(ui.elements.get("brains-dirty").hidden, false);
});

test("Space searches the parts, and Enter drops the highlighted one in", async () => {
  const ui = await editor();
  const nodes = ui.nodes().length;
  await ui.key({ key: " ", code: "Space" });
  assert.equal(ui.elements.get("brains-search").hidden, false);
  const input = ui.elements.get("brains-search-input");
  input.value = "triage";
  await input.fire("input");
  const rows = ui.elements.get("brains-search-list").querySelectorAll(".brains-search-row");
  assert.equal(rows[0].dataset.type, "issue.triage");
  await ui.key({ key: "Enter" });
  assert.equal(ui.elements.get("brains-search").hidden, true);
  assert.equal(ui.nodes().length, nodes + 1);
  assert.match(ui.status(), /Added "Triage"/);
});

test("a part added while a wire is armed is wired in on arrival", async () => {
  const ui = await editor();
  const wires = ui.wires().length;
  await ui.port("n_work_dispatch", "issues", "out").fire("click");
  await ui.key({ key: " ", code: "Space" });
  const input = ui.elements.get("brains-search-input");
  input.value = "triage";
  await input.fire("input");
  assert.match(ui.elements.get("brains-search-hint").textContent, /wired to the end you armed/);
  await ui.key({ key: "Enter" });
  assert.equal(ui.wires().length, wires + 1);
  assert.match(ui.status(), /wired it in/);
});

test("Delete removes what is selected, wires and all", async () => {
  const ui = await editor();
  const jev = ui.nodes().find((node) => node.dataset.node === "n_jev_classify");
  await jev.querySelector(".brains-node-head").fire("pointerdown", { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(ui.inspector().querySelector(".brains-title-input").value, "Jev");
  await ui.key({ key: "Delete" });
  assert.equal(ui.nodes().length, 17);
  assert.equal(ui.wires().length, 21, "both of its wires went with it");
  assert.match(ui.status(), /Removed "Jev"/);
  await ui.key({ key: " ", code: "Space" });
  assert.equal(ui.elements.get("brains-search").hidden, false, "the canvas still takes keys after a delete");
});

test("the inspector says what the selected part may and may not do", async () => {
  const ui = await editor();
  const dispatch = ui.nodes().find((node) => node.dataset.node === "n_work_dispatch");
  await dispatch.querySelector(".brains-node-head").fire("pointerdown", { clientX: 4, clientY: 4, pointerId: 1 });
  const text = ui.inspector().textContent;
  const spec = brains.nodeType("work.dispatch");
  for (const line of spec.can) assert.ok(text.includes(line), `inspector says it can: ${line}`);
  for (const line of spec.cannot) assert.ok(text.includes(line), `inspector says it cannot: ${line}`);
  for (const key of spec.permissions) {
    const label = brains.PERMISSIONS.find((item) => item.key === key).label;
    assert.ok(text.includes(label), `inspector names the permission: ${label}`);
  }
  assert.ok(text.includes(brains.GATES.dispatch.label), "and the switch it moves");
  assert.ok(text.includes("Workers at once"), "and its own settings");
});

test("an empty map reads as empty rather than as the pipeline", async () => {
  const ui = await editor({ map: { id: "blank", name: "Blank", nodes: [], edges: [], grants: [] } });
  assert.equal(ui.nodes().length, 0);
  assert.equal(ui.wires().length, 0);
  assert.match(ui.problems(), /no nodes yet/);
  assert.equal(ui.elements.get("brains-activate").disabled, true, "an empty map cannot go live");
});

// ---- the upgraded editor --------------------------------------------------

const head = (ui, id) => ui.nodes().find((node) => node.dataset.node === id).querySelector(".brains-node-head");
const pick = (ui, id, extra = {}) => head(ui, id).fire("pointerdown", { clientX: 10, clientY: 10, pointerId: 1, ...extra });
const wireOne = async (ui) => {
  await ui.port("n_verify_evidence", "issues", "out").fire("click");
  await ui.port("n_issue_triage", "issue", "in").fire("click");
};
const part = (ui, type) => ui.elements.get("brains-parts-list").querySelectorAll(".brains-part").find((item) => item.dataset.type === type);

test("a map stored left of the origin draws where it is stored", async () => {
  const map = {
    id: "west", name: "West", grants: ["read-project", "write-files", "run-commands", "spawn-worker", "spend-model", "create-work"],
    nodes: [{ id: "a", type: "note", title: "Far left", x: -200, y: 40, config: { text: "" } }],
    edges: [],
  };
  const ui = await editor({ map });
  assert.equal(ui.nodes()[0].style.left, "-200px");
});

test("arrow keys nudge the selected part, past the left edge too, and one undo puts it back", async () => {
  const ui = await editor();
  await pick(ui, "n_idea_planner");
  for (let step = 0; step < 3; step += 1) await ui.key({ key: "ArrowLeft" });
  const moved = ui.nodes().find((node) => node.dataset.node === "n_idea_planner");
  assert.equal(moved.style.left, "-20px");
  assert.equal(ui.elements.get("brains-save").disabled, false);
  await ui.key({ key: "z", ctrlKey: true });
  assert.equal(ui.nodes().find((node) => node.dataset.node === "n_idea_planner").style.left, "40px", "a run of nudges is one undo step");
  assert.equal(ui.elements.get("brains-save").disabled, true, "back at the saved map, nothing is left to save");
});

test("pressing a part without moving it leaves the map clean", async () => {
  const ui = await editor();
  await pick(ui, "n_plan_build");
  assert.equal(ui.elements.get("brains-save").disabled, true);
  assert.equal(ui.elements.get("brains-dirty").hidden, true);
});

test("a wire that runs backwards dips under the parts it passes instead of across them", async () => {
  const ui = await editor();
  const map = brains.defaultMap();
  const loop = map.edges.find((edge) => edge.feedback);
  const path = ui.wires().find((item) => item.dataset.edge === loop.id);
  const [, , , c1x, c1y, c2x, c2y] = path.attrs.d.match(/^M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), [\d.-]+ [\d.-]+$/).map(Number);
  const from = map.nodes.find((node) => node.id === loop.from.node);
  const to = map.nodes.find((node) => node.id === loop.to.node);
  const lowest = Math.max(...map.nodes.filter((node) => node.x < from.x && node.x + 236 > to.x).map((node) => node.y + 48 + 36 * 2 + 26));
  assert.ok(c1y > lowest && c2y > lowest, `both handles sit below the lowest part it passes (${c1y}, ${c2y} > ${lowest})`);
  assert.ok(c1x > from.x && c2x < to.x + 236, "it leaves to the right and comes back in from the left");
});

test("a wire takes the colour of the part it leaves", async () => {
  const ui = await editor();
  const edge = brains.defaultMap().edges.find((item) => item.from.node === "n_jev_classify");
  const path = ui.wires().find((item) => item.dataset.edge === edge.id);
  assert.equal(path.dataset.group, brains.nodeType("jev.classify").group);
});

test("closing keeps unsaved edits, and the next open has them back", async () => {
  const ui = await editor();
  const before = ui.wires().length;
  await wireOne(ui);
  ui.context.window.MefiBrains.close();
  assert.equal(ui.elements.get("brains-overlay").hidden, true, "closing does not ask");
  assert.equal(ui.saves.length, 0, "and saves nothing behind the owner's back");
  await ui.context.window.MefiBrains.open();
  await flush();
  assert.equal(ui.wires().length, before + 1);
  assert.equal(ui.elements.get("brains-dirty").hidden, false);
  assert.match(ui.status(), /still here/);
});

test("New starts a local map and saves nothing until it has a part", async () => {
  const ui = await editor();
  await ui.elements.get("brains-new").fire("click");
  await flush();
  assert.equal(ui.saves.length, 0, "an empty map is never sent to the host, which refuses it");
  assert.equal(ui.nodes().length, 0);
  assert.equal(ui.elements.get("brains-save").disabled, true, "nothing to keep yet");
  assert.match(ui.status(), /Created "Prompted name"/);
  await ui.key({ key: " ", code: "Space" });
  const input = ui.elements.get("brains-search-input");
  input.value = "you ask";
  await input.fire("input");
  await ui.key({ key: "Enter" });
  assert.equal(ui.nodes().length, 1);
  assert.equal(ui.elements.get("brains-save").disabled, false, "with a part it can be saved");
  await ui.elements.get("brains-save").fire("click");
  await flush();
  assert.equal(ui.saves.length, 1);
  assert.equal(ui.saves[0].name, "Prompted name");
});

test("Make this live stops when the save before it fails", async () => {
  const calls = [];
  const ui = await editor({
    activeId: "some-other-map",
    bridge: {
      brainsSave: async () => ({ ok: false, error: "Disk is full." }),
      brainsGatePlan: async () => { calls.push("plan"); return { ok: true, moves: [] }; },
      brainsActivate: async () => { calls.push("activate"); return { ok: true }; },
    },
  });
  await wireOne(ui);
  await ui.elements.get("brains-activate").fire("click");
  await flush();
  assert.deepEqual(calls, [], "nothing moves while the screen and the saved map disagree");
  assert.match(ui.status(), /Disk is full/);
});

test("Space on a focused button presses the button instead of opening the search", async () => {
  const ui = await editor();
  ui.elements.get("brains-search").hidden = true; // as the template ships it
  await ui.key({ key: " ", code: "Space", target: part(ui, "note") });
  assert.equal(ui.elements.get("brains-search").hidden, true);
});

test("Delete only deletes while the canvas has the keyboard", async () => {
  const ui = await editor();
  await pick(ui, "n_jev_classify");
  await ui.key({ key: "Delete", target: part(ui, "note") });
  assert.equal(ui.nodes().length, 18, "focus in the parts rail leaves the map alone");
  await ui.key({ key: "Delete" });
  assert.equal(ui.nodes().length, 17);
});

test("Ctrl S saves from inside a field", async () => {
  const ui = await editor();
  await wireOne(ui);
  await ui.key({ key: "s", ctrlKey: true, target: ui.elements.get("brains-parts-search") });
  await flush();
  assert.equal(ui.saves.length, 1);
});

test("a note shows its text on the canvas", async () => {
  const map = { id: "notes", name: "Notes", grants: [], edges: [], nodes: [{ id: "n_note", type: "note", title: "Note", x: 40, y: 40, config: { text: "Check the budget first" } }] };
  const ui = await editor({ map });
  assert.ok(ui.nodes()[0].textContent.includes("Check the budget first"));
});

test("a stage says which switch it moves, and no part repeats 'live stage'", async () => {
  const ui = await editor();
  const dispatch = ui.nodes().find((node) => node.dataset.node === "n_work_dispatch");
  assert.ok(dispatch.textContent.includes(`moves ${brains.GATES.dispatch.label}`));
  for (const node of ui.nodes()) {
    const foot = node.querySelector(".brains-node-foot");
    assert.ok(!foot.textContent.includes("live stage"), `${node.dataset.node} footer: ${foot.textContent}`);
  }
});

test("the problems list can show every problem, not just the first eight", async () => {
  const map = { id: "six", name: "Six", grants: [], edges: [], nodes: Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, type: "plan.build", title: `Plan ${index}`, x: 40 + index * 300, y: 40 })) };
  const ui = await editor({ map });
  const problems = brains.validateMap(brains.normalizeMap(map)).problems;
  assert.ok(problems.length > 8);
  const more = ui.elements.get("brains-problems").querySelectorAll(".brains-problem-more")[0];
  await more.fire("click");
  for (const problem of problems) assert.ok(ui.problems().includes(problem.text), problem.text);
});

test("F8 walks to the first problem that belongs to a part", async () => {
  const map = { id: "six", name: "Six", grants: [], edges: [], nodes: Array.from({ length: 3 }, (_, index) => ({ id: `p${index}`, type: "plan.build", title: `Plan ${index}`, x: 40 + index * 300, y: 40 })) };
  const ui = await editor({ map });
  const first = brains.validateMap(brains.normalizeMap(map)).problems.filter((item) => item.level === "error").find((item) => item.nodeId);
  await ui.key({ key: "F8" });
  const expected = brains.normalizeMap(map).nodes.find((node) => node.id === first.nodeId).title;
  assert.equal(ui.inspector().querySelector(".brains-title-input").value, expected);
  assert.match(ui.status(), /^Problem 1 of /);
});

test("with nothing selected, the inspector leads with what going live means", async () => {
  const ui = await editor();
  const text = ui.inspector().textContent;
  const live = text.indexOf("What this map holds");
  assert.ok(live >= 0, "the live map says what it holds");
  assert.ok(live < text.indexOf("What this map grants"));
});

test("an empty search lists every part", async () => {
  const ui = await editor();
  await ui.key({ key: " ", code: "Space" });
  assert.equal(ui.elements.get("brains-search-list").querySelectorAll(".brains-search-row").length, brains.NODE_TYPES.length);
});

test("Ctrl F finds a part already on the map", async () => {
  const ui = await editor();
  await ui.key({ key: "f", ctrlKey: true });
  assert.equal(ui.elements.get("brains-search").hidden, false);
  const input = ui.elements.get("brains-search-input");
  input.value = "jev";
  await input.fire("input");
  const rows = ui.elements.get("brains-search-list").querySelectorAll(".brains-search-row");
  assert.equal(rows[0].dataset.type, "jev.classify");
  const nodes = ui.nodes().length;
  await ui.key({ key: "Enter" });
  assert.equal(ui.nodes().length, nodes, "finding adds nothing");
  assert.equal(ui.elements.get("brains-search").hidden, true);
  assert.equal(ui.inspector().querySelector(".brains-title-input").value, "Jev");
});

test("two parts added in a row do not stack", async () => {
  const ui = await editor({ map: { id: "blank", name: "Blank", nodes: [], edges: [], grants: [] } });
  await part(ui, "note").fire("click");
  await part(ui, "note").fire("click");
  const [a, b] = ui.nodes();
  assert.notDeepEqual([a.style.left, a.style.top], [b.style.left, b.style.top]);
});

test("Shift picks several parts, and Delete removes them all", async () => {
  const ui = await editor();
  await pick(ui, "n_jev_classify");
  await pick(ui, "n_model_pick", { shiftKey: true });
  assert.match(ui.inspector().textContent, /2 parts picked/);
  await ui.key({ key: "Delete" });
  assert.equal(ui.nodes().length, 16);
  assert.match(ui.status(), /Removed 2 parts/);
});

test("Ctrl D copies the picked parts and the wire between them", async () => {
  const ui = await editor();
  await pick(ui, "n_jev_classify");
  await pick(ui, "n_model_pick", { shiftKey: true });
  const wires = ui.wires().length;
  await ui.key({ key: "d", ctrlKey: true });
  assert.equal(ui.nodes().length, 20);
  assert.equal(ui.wires().length, wires + 1, "the Jev → model wire is copied; wires to outside parts are not");
});

test("Escape clears the selection before anything closes", async () => {
  const ui = await editor();
  await pick(ui, "n_jev_classify");
  await ui.key({ key: "Escape" });
  assert.match(ui.status(), /Selection cleared/);
  assert.equal(ui.inspector().querySelector(".brains-title-input").attrs["aria-label"], "Map name");
});

test("Tidy lines the parts up, and Ctrl Z puts them back", async () => {
  const ui = await editor({ extraIds: ["brains-tidy"] });
  const where = () => ui.nodes().map((node) => `${node.dataset.node}@${node.style.left},${node.style.top}`).join(" ");
  const before = where();
  await ui.elements.get("brains-tidy").fire("click");
  assert.notEqual(where(), before);
  await ui.key({ key: "z", ctrlKey: true });
  assert.equal(where(), before);
});
