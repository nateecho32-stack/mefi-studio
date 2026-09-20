import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/explorer.js", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const MINUTE = 60000;

function sessionsFixture() {
  const now = Date.now();
  return [
    { id: "ses-root", title: "Root session", agent: "autopilot", model: { id: "glm-5.3-flash" }, timeUpdated: now - 5 * MINUTE },
    { id: "ses-child", title: "Child <b>session</b> & \"quoted\"", agent: "autopilot", model: { id: "glm-5.3-flash" }, timeUpdated: now - 4 * MINUTE, parentId: "ses-root" },
    { id: "ses-unnamed", title: "", agent: "a-eyes", model: { id: "deepseek-v4.1-flash" }, timeUpdated: now - 90 * MINUTE },
    { id: "ses-todos", title: "Todo carrier", agent: "autopilot", model: { id: "glm-5.3-flash" }, timeUpdated: now - 2 * MINUTE },
  ];
}

function todosFixture() {
  return [
    { sessionId: "ses-todos", content: "Write the explorer pin test", status: "in_progress" },
    { sessionId: "ses-todos", content: "Ship the harness", status: "completed" },
  ];
}

function environment(bridge = {}) {
  const ids = new Map();
  const listeners = new Map();
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.value = "";
      this.checked = false;
      this.disabled = false;
      this.hidden = true;
      this.draggable = false;
      this.tabIndex = 0;
      this.title = "";
      this.classes = new Set();
      this.scrollHeight = 0;
      this.scrollTop = 0;
      this.clientHeight = 0;
      this.classList = {
        add: (...names) => { for (const name of names) this.classes.add(name); },
        remove: (...names) => { for (const name of names) this.classes.delete(name); },
        contains: (name) => this.classes.has(name),
      };
    }
    set className(value) { this.classValue = String(value); this.classes = new Set(this.classValue.split(/\s+/).filter(Boolean)); }
    get className() { return this.classValue ?? ""; }
    set textContent(value) { this.text = value == null ? "" : String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => (typeof child === "string" ? child : child.textContent)).join(""); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    prepend(...children) { this.children.unshift(...children); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, detail = {}) {
      for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, dataTransfer: { setData() {}, getData: () => "" }, ...detail });
    }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
    querySelector() { return null; }
    contains() { return false; }
    closest() { return null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    scrollIntoView() {}
  }
  const element = (id) => { if (!ids.has(id)) ids.set(id, new Element("div")); return ids.get(id); };
  document = {
    readyState: "complete",
    getElementById: (id) => element(id),
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => ({ textContent: String(data) }),
    addEventListener: () => {},
    activeElement: null,
    visibilityState: "visible",
    hidden: false,
  };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init?.detail; }
  }
  const window = {
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatchEvent: (event) => { for (const fn of listeners.get(event.type) ?? []) fn(event); },
    MefiBoot: { pollStart() {} },
    mefiStudio: {
      eyesState: async () => ({ ok: true, sessions: sessionsFixture(), todos: todosFixture(), changes: [] }),
      machineStatus: async () => ({ ok: false, error: "stub" }),
      machineSet: async () => ({ ok: false }),
      ...bridge,
    },
  };
  vm.runInContext(source, vm.createContext({ window, document, CustomEvent, console }));
  const labelOf = (row) => row.children.find((child) => child.className === "label");
  return {
    window,
    document,
    explorer: window.MefiExplorer,
    tree: () => element("explorer-tree"),
    rows: () => element("explorer-tree").children,
    labelOf,
    element,
    open: async () => { window.MefiExplorer.open(); await flush(); },
  };
}

test("session rows pin their visible label text and row-label title on the row", async () => {
  const env = environment();
  await env.open();
  const tree = env.tree();
  const rows = tree.children;
  assert.equal(rows.length, 6, "the tree renders three root sessions, one child session and two todo rows");
  for (const row of rows) assert.equal(row.parent, tree, "every row nests directly under #explorer-tree");

  const expected = [
    ["Root session", "li"],
    ["Child <b>session</b> & \"quoted\"", "li"],
    ["ses-unnamed", "li"],
    ["Todo carrier", "li"],
    ["Write the explorer pin test", "li"],
    ["Ship the harness", "li"],
  ];
  expected.forEach(([labelText, tag], index) => {
    const row = rows[index];
    assert.equal(row.tagName, tag, `row ${index} is a list item`);
    assert.equal(row.title, labelText, `row ${index} carries the label text as its title`);
    const label = env.labelOf(row);
    assert.ok(label, `row ${index} renders a .label span`);
    assert.equal(label.text, labelText, `row ${index} .label span shows the same text the title pins`);
  });

  const unnamed = rows[2];
  assert.equal(unnamed.title, "ses-unnamed", "a session with an empty title falls back to its id on both surfaces");
  assert.equal(env.labelOf(unnamed).text, "ses-unnamed");

  const child = rows[1];
  assert.equal(child.title, "Child <b>session</b> & \"quoted\"", "markup-looking titles stay literal text on the title");
  assert.equal(env.labelOf(child).text, "Child <b>session</b> & \"quoted\"", "markup-looking titles stay literal text on the label");
  assert.notEqual(child.title, rows[0].title, "a nested child row keeps its own label, not its parent's");
});

test("re-rendering after a row click clears the tree and rebuilds rows with titles intact", async () => {
  const env = environment();
  await env.open();
  const before = env.rows();
  const count = before.length;
  const rootRow = before[0];
  rootRow.click();
  await flush();
  const after = env.rows();
  assert.equal(after.length, count, "the tree is cleared between renders — no duplicated rows");
  assert.ok(after[0] !== rootRow, "rows are rebuilt, not reused from the previous render");
  assert.ok(after[0].classes.has("selected"), "the clicked session's rebuilt row is marked selected");
  assert.equal(after[0].title, "Root session", "the rebuilt selected row keeps its label-title pin");
  assert.equal(env.labelOf(after[0]).text, "Root session");
});

test("stale tags and the folded group keep their own row-label titles", async () => {
  const env = environment({
    assistantState: async () => ({ ok: true, state: { organization: { order: ["ses-todos"], stale: ["ses-root"], folded: ["ses-unnamed"] } } }),
  });
  await env.open();
  const rows = env.rows();
  assert.deepEqual(rows.map((row) => row.title), [
    "Todo carrier",
    "Write the explorer pin test",
    "Ship the harness",
    "Root session",
    "Child <b>session</b> & \"quoted\"",
    "Finished sessions the assistant folded away — click to expand",
  ], "ordered roots lead with their own rows, the rest follow, and the folded group collapses into one control row");

  const staleRow = rows[3];
  assert.ok(staleRow.classes.has("stale"), "the stale session row is marked stale");
  const mark = env.labelOf(staleRow).children.find((child) => child.className === "src-tag stale");
  assert.equal(mark?.text, "STALE", "the stale tag is visible on the label");
  assert.equal(staleRow.title, "Root session", "the stale tag never leaks into the row title");
  assert.equal(env.labelOf(staleRow).text, "Root session", "the label's own text stays the bare session title");

  const folded = rows[5];
  assert.ok(folded.classes.has("folded-row"), "the collapsed group renders its control row");
  assert.equal(env.labelOf(folded).text, "Finished (1)");
  assert.notEqual(folded.title, env.labelOf(folded).text, "the control row's title describes the group instead of echoing its label");

  folded.click();
  await flush();
  const expanded = env.rows();
  assert.deepEqual(expanded.map((row) => row.title), [
    "Todo carrier",
    "Write the explorer pin test",
    "Ship the harness",
    "Root session",
    "Child <b>session</b> & \"quoted\"",
    "Finished sessions the assistant folded away — click to expand",
    "ses-unnamed",
  ], "expanding the group reveals the folded session with its own label-title pin");
  assert.equal(expanded[6].title, env.labelOf(expanded[6]).text, "the revealed row keeps title and label in sync");
});
