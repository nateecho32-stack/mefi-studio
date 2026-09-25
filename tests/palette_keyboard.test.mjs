// Command-palette keyboard contract, driven for real: renderer/palette.js runs
// against a minimal DOM stub, synthetic window keydown events walk the list,
// and the assertions watch the active option wrap at both ends, Home/End jump
// to the first/last option, aria-activedescendant track the highlight, and
// focus land back on the opener after Escape and after Enter. No Electron.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/palette.js", import.meta.url), "utf8");

function element(id, getDocument = () => globalThis.document) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    id,
    listeners,
    attrs,
    hidden: false,
    value: "",
    title: "",
    children: [],
    isConnected: true,
    clientWidth: 420,
    clientHeight: 600,
    classList: {
      add: (...names) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names) => {
        for (const name of names) classes.delete(name);
      },
      contains: (name) => classes.has(name),
      toggle() {},
    },
    append(...kids) {
      el.children.push(...kids);
    },
    appendChild(kid) {
      el.children.push(kid);
      return kid;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    contains(node) {
      for (const child of el.children) {
        if (child === node || child.contains?.(node)) return true;
      }
      return false;
    },
    querySelector(selector) {
      if (selector === "li.active") {
        return el.children.find((child) => child.classList?.contains?.("active")) ?? null;
      }
      return null;
    },
    closest: () => null,
    focus() {
      const document = getDocument();
      if (document) document.activeElement = el;
    },
    blur() {},
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 600 }),
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set(next) {
      text = String(next);
      if (!text) el.children.length = 0; // clearing text drops the children, like the DOM
    },
  });
  return el;
}

test("command palette: arrows wrap at both ends, Escape and Enter restore the opener", async () => {
  const overlay = element("palette-overlay");
  const input = element("palette-input");
  const list = element("palette-list");
  overlay.append(input, list); // restoreOpener() treats input-in-overlay as stranded focus
  const registry = { "palette-overlay": overlay, "palette-input": input, "palette-list": list };

  const listeners = {};
  const goCalls = [];
  const nav = {
    state: {},
    list: () => [
      { id: "booklet", label: "Model booklet", group: "surfaces" },
      { id: "graph", label: "Value graph", group: "surfaces" },
      { id: "tasks", label: "Task board", group: "surfaces" },
    ],
    go: (id) => goCalls.push(id),
    claim: () => {},
    release: () => {},
  };

  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    MefiNav: nav,
  };
  globalThis.document = {
    readyState: "complete",
    body: element("body"),
    activeElement: null,
    getElementById: (id) => registry[id] ?? null,
    createElement: () => element(null),
    addEventListener() {},
  };

  await import(new URL("../renderer/palette.js?keyboard-test", import.meta.url).href);
  const palette = globalThis.window.MefiPalette;
  assert.ok(palette, "palette.js must expose window.MefiPalette");

  const key = (name) => {
    const event = { key: name, preventDefault() { event.defaultPrevented = true; } };
    for (const handler of listeners.keydown ?? []) handler(event);
    return event;
  };
  // typing fires the input listeners (filter()) for real, narrowing the list
  const type = (value) => {
    input.value = value;
    for (const handler of input.listeners.input ?? []) handler({ target: input });
  };
  const activeId = () => list.querySelector("li.active")?.id ?? null;

  // open from a real trigger: the palette focuses its field and names option 0
  const opener = element("tools-booklet");
  opener.focus();
  assert.equal(globalThis.document.activeElement, opener);
  palette.open();
  assert.equal(overlay.hidden, false);
  assert.equal(globalThis.document.activeElement, input);
  assert.equal(activeId(), "palette-option-0");
  assert.equal(input.attrs["aria-activedescendant"], "palette-option-0");
  assert.equal(list.attrs["aria-activedescendant"], "palette-option-0", "the listbox names the active option too");
  assert.equal(list.children[0].attrs["aria-posinset"], "1", "options announce their position");
  assert.equal(list.children[0].attrs["aria-setsize"], "3", "position is against the full result set");

  // ArrowDown walks 0 -> 1 -> 2, then wraps at the last option back to 0
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(activeId(), "palette-option-2");
  const downWrap = key("ArrowDown");
  assert.equal(downWrap.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-0", "ArrowDown wraps from the last option to the first");
  assert.equal(input.attrs["aria-activedescendant"], "palette-option-0");
  assert.equal(list.attrs["aria-activedescendant"], "palette-option-0", "aria-activedescendant tracks arrow-key movement on the listbox as well");

  // ArrowUp wraps the other way: from the first option straight to the last
  const upWrap = key("ArrowUp");
  assert.equal(upWrap.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-2", "ArrowUp wraps from the first option to the last");
  key("ArrowUp");
  assert.equal(activeId(), "palette-option-1");

  // Home/End jump to the first and last option while browsing the default list
  const end = key("End");
  assert.equal(end.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-2", "End jumps to the last option");
  assert.equal(input.attrs["aria-activedescendant"], "palette-option-2");
  const home = key("Home");
  assert.equal(home.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-0", "Home jumps to the first option");
  key("Home");
  assert.equal(activeId(), "palette-option-0", "Home at the first option stays put");

  // with a query typed, Home/End keep their native caret role in the field
  input.value = "task";
  const homeTyping = key("Home");
  assert.notEqual(homeTyping.defaultPrevented, true, "Home stays a caret key while a query is typed");
  assert.equal(activeId(), "palette-option-0");
  input.value = "";

  // a typed query narrows the list and the wrap span follows the filtered set:
  // "task" matches only the Task board, so Down/Up wrap inside a one-row list
  type("task");
  assert.equal(list.children.length, 1, "the query really narrowed the rendered list");
  const filteredDown = key("ArrowDown");
  assert.equal(filteredDown.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-0", "a one-row filtered list wraps onto itself");
  const filteredEscape = key("Escape");
  assert.equal(filteredEscape.defaultPrevented, true, "Escape is claimed by the palette even mid-filter");
  assert.equal(overlay.hidden, true);
  assert.equal(input.attrs["aria-expanded"], "false");
  assert.equal(globalThis.document.activeElement, opener, "Escape restores the opener after a filtered session");

  // reopen with a two-row filtered list ("bo" matches booklet and Task board)
  // and watch ArrowUp from the first row wrap to the last of the span
  opener.focus();
  palette.open();
  type("bo");
  assert.equal(list.children.length, 2);
  const filteredUp = key("ArrowUp");
  assert.equal(filteredUp.defaultPrevented, true);
  assert.equal(activeId(), "palette-option-1", "ArrowUp wraps within the filtered span, not the full set");
  key("ArrowDown");
  assert.equal(activeId(), "palette-option-0", "ArrowDown wraps back within the filtered span");

  // Escape closes the palette and hands focus back to the element that opened it
  const escape = key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(overlay.hidden, true);
  assert.equal(globalThis.document.activeElement, opener, "Escape restores the opener's focus");
  assert.equal(input.attrs["aria-expanded"], "false");

  // reopening re-anchors at the first option with a fresh opener capture;
  // Enter runs the active item and every close path restores focus too
  const secondOpener = element("tools-graph");
  secondOpener.focus();
  palette.open();
  assert.equal(activeId(), "palette-option-0");
  key("ArrowDown");
  assert.equal(activeId(), "palette-option-1");
  assert.equal(list.children[1].attrs["aria-posinset"], "2", "position follows the highlight");
  key("Enter");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(goCalls, ["graph"]);
  assert.equal(overlay.hidden, true);
  assert.equal(globalThis.document.activeElement, secondOpener, "Enter restores the opener's focus");
});

// `nav` adds to the MefiNav stand-in, e.g. the sectionLabel/sectionRank pair.
function environment({ destinations = [], api = {}, projectId = "alpha", nav = {} } = {}) {
  const document = { readyState: "complete", activeElement: null, addEventListener() {} };
  const make = (id) => element(id, () => document);
  const ids = Object.fromEntries(["palette-overlay", "palette-input", "palette-list", "palette-close", "palette-status"].map((id) => [id, make(id)]));
  const overlay = ids["palette-overlay"], input = ids["palette-input"], list = ids["palette-list"], close = ids["palette-close"], status = ids["palette-status"];
  overlay.hidden = true;
  overlay.append(input, list, close, status);
  Object.assign(document, { body: make("body"), getElementById: (id) => ids[id] || null, createElement: () => make(null) });
  const handlers = {}, routes = [], projectHandlers = [], taskHandlers = [];
  const window = {
    MefiNav: { state: {}, list: () => destinations, go: (id, params) => routes.push({ id, params }), claim() {}, release() {}, ...nav },
    MefiTasks: { state: { projectId, tasks: [] } },
    mefiStudio: { ...api, onProjects: (fn) => projectHandlers.push(fn), onTasks: (fn) => taskHandlers.push(fn) },
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
  };
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout, Promise });
  const key = (name, extras = {}) => {
    const event = { key: name, preventDefault() { event.defaultPrevented = true; }, ...extras };
    for (const handler of handlers.keydown || []) handler(event);
    return event;
  };
  const type = (value) => { input.value = value; for (const fn of input.listeners.input || []) fn({ target: input }); };
  const labels = () => list.children.map((row) => row.children.find((child) => child.className === "palette-result-copy")?.children.find((child) => child.className === "label")?.textContent).filter(Boolean);
  const emitProject = (activeId) => { for (const fn of projectHandlers) fn({ activeId }); };
  const emitTasks = (tasks) => { for (const fn of taskHandlers) fn(tasks); };
  return { palette: window.MefiPalette, document, input, list, close, status, overlay, key, type, labels, routes, emitProject, emitTasks, make };
}

test("palette finds everyday words and descriptions, ranks titles first, and keeps Tab inside its dialog", () => {
  const env = environment({ destinations: [
    { id: "tasks", label: "Task board", group: "tools", desc: "Tasks with connection errors" },
    { id: "studio", label: "Settings & connections", group: "surfaces", desc: "Assistant providers and API keys" },
    { id: "command", label: "Command view", group: "surfaces", desc: "The node tree / constellation" },
    { id: "music", label: "Music & themes", group: "tools", searchTerms: "color colour appearance" },
  ] });
  const opener = env.make("search"); opener.focus(); env.palette.open();
  for (const [query, expected] of [["api key", "Settings & connections"], ["node tree", "Command view"], ["color", "Music & themes"]]) {
    env.type(query);
    assert.deepEqual(env.labels(), [expected]);
  }
  env.type("connection");
  assert.equal(env.labels()[0], "Settings & connections", "literal titles outrank descriptive matches");
  assert.equal(env.key("Tab").defaultPrevented, true);
  assert.equal(env.document.activeElement, env.close);
  assert.notEqual(env.key("Enter").defaultPrevented, true, "the Close button keeps its native activation");
  env.key("Tab");
  assert.equal(env.document.activeElement, env.input);
  env.key("Tab", { shiftKey: true });
  assert.equal(env.document.activeElement, env.close);
  // Escape claims closing from any control inside the dialog, not just the
  // field: from the focused Close button it still closes and restores the opener.
  const closeEscape = env.key("Escape");
  assert.equal(closeEscape.defaultPrevented, true);
  assert.equal(env.overlay.hidden, true);
  assert.equal(env.document.activeElement, opener, "Escape from the Close button restores the opener");
  env.palette.open();
  assert.equal(env.overlay.hidden, false);
  for (const fn of env.close.listeners.click) fn();
  assert.equal(env.overlay.hidden, true);
  assert.equal(env.document.activeElement, opener);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("opening Search again preserves the query, selection and original focus return", () => {
  const env = environment({ destinations: [
    { id: "tasks", label: "Task board", group: "tools" },
    { id: "plans", label: "Task plans", group: "tools" },
  ] });
  const opener = env.make("search-button");
  opener.focus();
  env.palette.open();
  env.type("task");
  env.key("ArrowDown");
  env.close.focus();
  env.palette.open();
  assert.equal(env.input.value, "task");
  assert.equal(env.document.activeElement, env.input);
  assert.equal(env.input.attrs["aria-activedescendant"], "palette-option-1");
  env.key("Escape");
  assert.equal(env.document.activeElement, opener);
});

test("palette searches saved tasks before the board is visited and discards previous-project responses", async () => {
  const pending = [];
  const env = environment({ api: { tasksList: () => new Promise((resolve) => pending.push(resolve)) } });
  env.palette.open(); env.type("welcome");
  await settle();
  assert.equal(pending.length, 1);
  assert.match(env.status.textContent, /Loading project tasks/);
  pending[0]({ ok: true, projectId: "alpha", tasks: [{ id: "a", title: "Welcome screen", projectId: "alpha" }] });
  await settle();
  assert.deepEqual(env.labels(), ["Welcome screen"]);
  assert.equal(env.input.value, "welcome", "background loading preserves what the user typed");

  env.palette.close(); env.palette.open();
  await settle();
  env.emitProject("beta"); env.type("welcome");
  await settle();
  assert.equal(pending.length, 3);
  pending[2]({ ok: true, projectId: "beta", tasks: [{ id: "b", title: "Welcome to beta", projectId: "beta" }] });
  await settle();
  pending[1]({ ok: true, projectId: "alpha", tasks: [{ id: "old", title: "Welcome old project", projectId: "alpha" }] });
  await settle();
  assert.deepEqual(env.labels(), ["Welcome to beta"], "a late previous-project response cannot replace the current task list");
  env.key("Enter");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(env.routes[0].id, "tasks");
  assert.equal(env.routes[0].params.taskId, "b");
});

test("palette keeps newer task broadcasts, ignores closed searches, and explains failed task reads", async () => {
  const pending = [];
  const env = environment({ destinations: [{ id: "tasks", label: "Task board", group: "tools" }], api: { tasksList: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } });
  env.palette.open(); env.type("new"); await settle();
  env.emitTasks([{ id: "fresh", title: "New task", projectId: "alpha" }]);
  pending[0].resolve({ ok: true, projectId: "alpha", tasks: [] }); await settle();
  assert.deepEqual(env.labels(), ["New task"]);

  env.palette.close(); env.palette.open(); await settle();
  env.palette.close(); env.palette.open(); await settle();
  pending[2].reject(new Error("Read failed")); await settle();
  pending[1].resolve({ ok: true, projectId: "alpha", tasks: [{ id: "old", title: "Stale task" }] }); await settle();
  assert.deepEqual(env.labels(), ["Task board"]);
  assert.match(env.status.textContent, /Tasks couldn't be loaded/);
  env.palette.close();
});

test("palette rejects foreign task responses and requires a known project before accepting unscoped reads", async () => {
  for (const [projectId, result] of [
    ["alpha", { ok: true, projectId: "beta", tasks: [{ id: "foreign", title: "Foreign task", projectId: "beta" }] }],
    [null, { ok: true, tasks: [{ id: "foreign", title: "Foreign task", projectId: "beta" }] }],
    ["alpha", { ok: false, projectId: "alpha", tasks: [{ id: "foreign", title: "Foreign task" }] }],
  ]) {
    const env = environment({ projectId, api: { tasksList: async () => result } });
    env.palette.open();
    env.emitTasks([{ id: "foreign", title: "Foreign task", projectId: "beta" }]);
    assert.deepEqual(env.labels(), [], "broadcasts cannot supply results for an unknown or different project");
    await settle();
    assert.deepEqual(env.labels(), []);
    assert.match(env.status.textContent, /Tasks couldn't be loaded/);
    env.palette.close();
  }
  const env = environment({ api: { tasksList: async () => ({ ok: true, projectId: "alpha", tasks: [
    { id: "a", title: "Current task", projectId: "alpha" },
    { id: "b", title: "Foreign task", projectId: "beta" },
  ] }) } });
  env.palette.open(); await settle();
  assert.deepEqual(env.labels(), ["Current task"]);
  env.palette.close();
});

test("palette files each result under its rail section, keeps sections together, and hover moves the highlight in place", () => {
  // nav.sectionLabel / nav.sectionRank, as renderer/nav.js exports them.
  const sections = { workspace: ["Home", 0], tasks: ["Work", 1], plans: ["Work", 1], command: ["Live", 2], studio: ["Settings", 4], music: ["Settings", 4], help: ["Help", 5] };
  const env = environment({
    destinations: [
      { id: "command", label: "Command view", group: "surfaces", desc: "Live plans and workers" },
      { id: "studio", label: "Settings", group: "surfaces" },
      { id: "tasks", label: "Pitch lanes", group: "tools" },
      { id: "music", label: "Style & sound", group: "tools" },
      { id: "help", label: "Shortcuts", group: "system", key: "?" },
      { id: "plans", label: "Plans", group: "tools" },
      { id: "workspace", label: "Your workspace", group: "surfaces", key: "H" },
    ],
    nav: { sectionLabel: (dest) => sections[dest.id]?.[0] ?? null, sectionRank: (dest) => sections[dest.id]?.[1] ?? 9 },
  });
  const kinds = () => env.list.children.map((row) => row.children.find((child) => child.className === "kind")?.textContent);
  const starts = () => env.list.children.map((row) => row.classList.contains("palette-group-start"));
  env.palette.open();
  assert.deepEqual(kinds(), ["Home", "Work", "Work", "Live", "Settings", "Settings", "Help"], "the kind is the section, and the browse list follows the rail top to bottom");
  assert.deepEqual(env.labels(), ["Your workspace", "Pitch lanes", "Plans", "Command view", "Settings", "Style & sound", "Shortcuts"]);
  assert.deepEqual(starts(), [true, true, false, true, true, false, true], "the first row of each section carries the divider marker");

  // A query ranks rows, then keeps each section together: Plans (an exact
  // title) leads, and the Work row that only matched loosely follows it
  // ahead of the Live row that outscored it.
  env.type("plans");
  assert.deepEqual(env.labels(), ["Plans", "Pitch lanes", "Command view"]);
  assert.deepEqual(kinds(), ["Work", "Work", "Live"]);
  assert.deepEqual(starts(), [true, false, true]);

  // Hover moves the highlight without rebuilding a single row.
  const rows = env.list.children.slice();
  for (const fn of rows[2].listeners.mouseenter) fn();
  assert.ok(env.list.children.every((row, at) => row === rows[at]), "the rows are the same elements");
  assert.equal(rows[0].classList.contains("active"), false);
  assert.equal(rows[0].attrs["aria-selected"], "false");
  assert.equal(rows[2].classList.contains("active"), true);
  assert.equal(rows[2].attrs["aria-selected"], "true");
  assert.equal(env.input.attrs["aria-activedescendant"], rows[2].id, "the combobox names the hovered option");
  assert.equal(env.list.attrs["aria-activedescendant"], rows[2].id);
  // The keys pick up from the hovered row.
  env.key("ArrowUp");
  assert.equal(env.input.attrs["aria-activedescendant"], "palette-option-1");
});
