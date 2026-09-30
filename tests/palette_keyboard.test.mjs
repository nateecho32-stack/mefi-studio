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
// `storage` is the page's localStorage and `toasts` collects what MefiToast was asked to say.
function environment({ destinations = [], api = {}, projectId = "alpha", nav = {}, storage = null, toasts = null, placeholder = "" } = {}) {
  const document = { readyState: "complete", activeElement: null, addEventListener() {} };
  const make = (id) => element(id, () => document);
  const ids = Object.fromEntries(["palette-overlay", "palette-input", "palette-list", "palette-close", "palette-status"].map((id) => [id, make(id)]));
  const overlay = ids["palette-overlay"], input = ids["palette-input"], list = ids["palette-list"], close = ids["palette-close"], status = ids["palette-status"];
  overlay.hidden = true;
  input.placeholder = placeholder;
  overlay.append(input, list, close, status);
  Object.assign(document, { body: make("body"), getElementById: (id) => ids[id] || null, createElement: () => make(null) });
  const handlers = {}, routes = [], projectHandlers = [], taskHandlers = [];
  const window = {
    MefiNav: { state: {}, list: () => destinations, go: (id, params) => routes.push({ id, params }), claim() {}, release() {}, ...nav },
    MefiTasks: { state: { projectId, tasks: [] } },
    mefiStudio: { ...api, onProjects: (fn) => projectHandlers.push(fn), onTasks: (fn) => taskHandlers.push(fn) },
    ...(toasts ? { MefiToast: (text, kind, options) => toasts.push({ text, kind, options }) } : {}),
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
  };
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout, Promise, ...(storage ? { localStorage: storage } : {}) });
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

// ---- Recent, and "task ..." / "idea ..." (ZA6) ----------------------------------------------
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); } };
};
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGES = [
  { id: "tasks", label: "Task board", group: "tools", desc: "Tasks with connection errors" },
  { id: "plans", label: "Plans", group: "tools" },
  { id: "booklet", label: "Model booklet", group: "surfaces" },
  { id: "graph", label: "Value graph", group: "surfaces" },
];
const kinds = (env) => env.list.children.map((row) => row.children.find((child) => child.className === "kind")?.textContent);
const recentKey = (project) => `mefi.searchRecent.v1.${project}`;
const activeLabel = (env) => env.labels()[env.list.children.findIndex((row) => row.classList.contains("active"))];
const stored = (storage, project) => JSON.parse(storage.map.get(recentKey(project)) ?? "null");
const openItem = async (env, query) => { if (env.overlay.hidden) env.palette.open(); env.type(query); env.key("Enter"); await pause(); };
// Objects made inside the palette's sandbox come from another realm; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const descriptionOf = (row) => row.children.find((child) => child.className === "palette-result-copy")?.children.find((child) => child.className === "description")?.textContent ?? "";

test("with the box empty Search starts with what you last opened or ran, kept for each project", async () => {
  const storage = memoryStorage();
  const env = environment({ destinations: PAGES, storage });
  env.palette.open();
  assert.deepEqual(kinds(env), ["tools", "tools", "surfaces", "surfaces"].map((kind) => kind), "nothing has been opened yet, so there is no Recent group");
  assert.equal(kinds(env).includes("Recent"), false);
  await openItem(env, "plans");
  await openItem(env, "task board");
  assert.deepEqual(env.routes.map((route) => route.id), ["plans", "tasks"], "task board is the page's exact name, so it opens the page");
  assert.deepEqual(stored(storage, "alpha"), ["dest:tasks", "dest:plans"], "newest first, under this project's own key");
  env.palette.open();
  assert.deepEqual(env.labels(), ["Task board", "Plans", "Model booklet", "Value graph"]);
  assert.deepEqual(kinds(env), ["Recent", "Recent", "surfaces", "surfaces"], "Recent leads, and what it holds is not listed a second time");
  assert.equal(env.list.children[0].classList.contains("palette-group-start"), true);
  assert.equal(env.list.children[2].classList.contains("palette-group-start"), true);
  env.key("Escape");

  // Another project has its own list.
  env.emitProject("beta");
  env.palette.open();
  assert.equal(kinds(env).includes("Recent"), false, "beta has opened nothing yet");
  await openItem(env, "value graph");
  assert.deepEqual(stored(storage, "beta"), ["dest:graph"]);
  assert.deepEqual(stored(storage, "alpha"), ["dest:tasks", "dest:plans"], "alpha's list is untouched");
  env.palette.open();
  assert.deepEqual(env.labels().slice(0, 1), ["Value graph"]);
  assert.equal(kinds(env)[0], "Recent");
  env.key("Escape");
  env.emitProject("alpha");
  env.palette.open();
  assert.deepEqual(env.labels().slice(0, 2), ["Task board", "Plans"], "and back in alpha they are back");
});

test("Recent runs, opens and remembers like any result: Enter on a Recent row opens it and moves it to the front", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["dest:tasks", "dest:plans", "dest:graph"]) });
  const env = environment({ destinations: PAGES, storage });
  env.palette.open();
  assert.deepEqual(env.labels().slice(0, 3), ["Task board", "Plans", "Value graph"]);
  env.key("ArrowDown"); env.key("ArrowDown");
  env.key("Enter"); await pause();
  assert.deepEqual(env.routes.map((route) => route.id), ["graph"]);
  assert.deepEqual(stored(storage, "alpha"), ["dest:graph", "dest:tasks", "dest:plans"]);
});

test("Recent is a short list: eight are kept, six are shown, and a repeat moves up instead of doubling", async () => {
  const storage = memoryStorage();
  const many = Array.from({ length: 12 }, (_, n) => ({ id: `page${n}`, label: `Page ${n}`, group: "tools" }));
  const env = environment({ destinations: many, storage });
  for (let n = 0; n < 12; n += 1) { env.palette.open(); await openItem(env, `page ${n}`); }
  env.palette.open(); await openItem(env, "page 5");
  const kept = stored(storage, "alpha");
  assert.equal(kept.length, 8);
  assert.deepEqual(kept.slice(0, 3), ["dest:page5", "dest:page11", "dest:page10"]);
  assert.equal(new Set(kept).size, 8, "no card twice");
  env.palette.open();
  assert.equal(kinds(env).filter((kind) => kind === "Recent").length, 6);
  assert.deepEqual(env.labels().slice(0, 3), ["Page 5", "Page 11", "Page 10"]);
  assert.equal(env.labels().filter((label) => label === "Page 5").length, 1, "a recent page is not listed again below");
});

test("a remembered target that no longer exists is skipped quietly, not shown as an error, and not forgotten early", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["task:deleted", "dest:renamed-away", "dest:plans", 7, null, ""]) });
  const env = environment({ destinations: PAGES, storage });
  env.palette.open();
  assert.deepEqual(env.labels().slice(0, 1), ["Plans"]);
  assert.deepEqual(kinds(env).filter((kind) => kind === "Recent").length, 1);
  assert.doesNotMatch(env.status.textContent, /couldn't|error|missing|gone/i);
  assert.deepEqual(stored(storage, "alpha").length, 6, "looking does not rewrite the list");
  env.key("Escape");
  // A damaged entry in storage is the same as none.
  const damaged = environment({ destinations: PAGES, storage: memoryStorage({ [recentKey("alpha")]: "{not json" }) });
  damaged.palette.open();
  assert.equal(kinds(damaged).includes("Recent"), false);
  assert.equal(damaged.labels().length, 4);
  const wrong = environment({ destinations: PAGES, storage: memoryStorage({ [recentKey("alpha")]: JSON.stringify({ not: "a list" }) }) });
  wrong.palette.open();
  assert.equal(kinds(wrong).includes("Recent"), false);
});

test("a recent task shows up when the task list arrives, and goes quietly when the task is gone", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["task:t2", "task:t9", "dest:tasks"]) });
  let deliver;
  const env = environment({ destinations: PAGES, storage, api: { tasksList: () => new Promise((resolve) => { deliver = resolve; }) } });
  env.palette.open();
  await settle();
  assert.deepEqual(env.labels().slice(0, 1), ["Task board"], "only what exists yet");
  deliver({ ok: true, projectId: "alpha", tasks: [{ id: "t1", title: "Welcome screen", projectId: "alpha" }, { id: "t2", title: "Fix the login", projectId: "alpha" }] });
  await settle();
  assert.deepEqual(env.labels().slice(0, 2), ["Fix the login", "Task board"], "the remembered task joins Recent, in its remembered order");
  assert.equal(env.labels().includes("Welcome screen"), true, "other tasks are listed below as before");
  assert.equal(env.labels().filter((label) => label === "Fix the login").length, 1);
  assert.equal(stored(storage, "alpha").length, 3, "the deleted one is still only skipped");
  assert.equal(activeLabel(env), "Fix the login", "the highlight is on the top row, where the last thing you opened joined the list");
  env.key("Enter"); await pause();
  assert.deepEqual(plain(env.routes[0]), { id: "tasks", params: { taskId: "t2" } }, "so Ctrl K then Enter goes back to it");
  assert.deepEqual(stored(storage, "alpha").slice(0, 2), ["task:t2", "task:t9"]);
});

test("a highlight you moved stays on its row when the task list arrives; only the top row follows the list", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["task:t2", "dest:plans", "dest:tasks"]) });
  let deliver;
  const env = environment({ destinations: PAGES, storage, api: { tasksList: () => new Promise((resolve) => { deliver = resolve; }) } });
  env.palette.open();
  await settle();
  assert.deepEqual(env.labels().slice(0, 2), ["Plans", "Task board"]);
  env.key("ArrowDown");
  assert.equal(activeLabel(env), "Task board");
  deliver({ ok: true, projectId: "alpha", tasks: [{ id: "t2", title: "Fix the login", projectId: "alpha" }] });
  await settle();
  assert.deepEqual(env.labels().slice(0, 3), ["Fix the login", "Plans", "Task board"]);
  assert.equal(activeLabel(env), "Task board", "what you moved to stays under the highlight");
  env.key("ArrowUp"); env.key("ArrowUp");
  assert.equal(activeLabel(env), "Fix the login");
});

test("with a query typed nothing changed: a highlight on the top row still stays with its result when the task list arrives", async () => {
  let deliver;
  const env = environment({ destinations: PAGES, api: { tasksList: () => new Promise((resolve) => { deliver = resolve; }) } });
  env.palette.open();
  await settle();
  env.type("task");
  assert.equal(activeLabel(env), "Task board");
  assert.equal(env.list.children[0].classList.contains("active"), true);
  deliver({ ok: true, projectId: "alpha", tasks: [{ id: "t1", title: "Task", projectId: "alpha" }] });
  await settle();
  assert.equal(env.labels()[0], "Task", "a task named exactly like the query now leads the results");
  assert.equal(activeLabel(env), "Task board", "and the highlight went with the page it was on");
});

test("Recent is only for the empty box: a query lists its matches as always", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["dest:plans"]) });
  const env = environment({ destinations: PAGES, storage });
  env.palette.open();
  assert.equal(kinds(env)[0], "Recent");
  env.type("plans");
  assert.deepEqual(kinds(env), ["tools"]);
  assert.deepEqual(env.labels(), ["Plans"]);
  env.type("");
  assert.equal(kinds(env)[0], "Recent", "clearing the box brings it back");
});

test("with Recent switched off nothing is shown or remembered; if the preferences cannot be read it stays on", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["dest:plans"]) });
  const off = environment({ destinations: PAGES, storage, api: { prefsGet: async () => ({ ok: true, prefs: { searchRecents: false } }) } });
  await settle();
  off.palette.open();
  assert.equal(kinds(off).includes("Recent"), false);
  await openItem(off, "task board");
  assert.deepEqual(stored(storage, "alpha"), ["dest:plans"], "and nothing new was remembered");
  const unreadable = environment({ destinations: PAGES, storage, api: { prefsGet: async () => { throw new Error("no host"); } } });
  await settle();
  unreadable.palette.open();
  assert.equal(kinds(unreadable)[0], "Recent");
  const on = environment({ destinations: PAGES, storage, api: { prefsGet: async () => ({ ok: true, prefs: { searchRecents: true } }) } });
  await settle();
  on.palette.open();
  assert.equal(kinds(on)[0], "Recent");
});

test("switching Recent off while Search is open takes the group away at once", async () => {
  const storage = memoryStorage({ [recentKey("alpha")]: JSON.stringify(["dest:plans"]) });
  let prefs = { searchRecents: true };
  const env = environment({ destinations: PAGES, storage, api: { prefsGet: async () => ({ ok: true, prefs }) } });
  await settle();
  env.palette.open();
  assert.equal(kinds(env)[0], "Recent");
  prefs = { searchRecents: false };
  env.key("Escape");
  env.palette.open();
  await settle();
  assert.equal(kinds(env).includes("Recent"), false);
});

test("storage that is blocked or full never breaks Search: no Recent, and every result still opens", async () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const env = environment({ destinations: PAGES, storage: blocked });
  env.palette.open();
  assert.equal(env.labels().length, 4);
  await openItem(env, "plans");
  assert.deepEqual(env.routes.map((route) => route.id), ["plans"]);
  const noStorage = environment({ destinations: PAGES });
  noStorage.palette.open();
  await openItem(noStorage, "plans");
  assert.deepEqual(noStorage.routes.map((route) => route.id), ["plans"], "no localStorage at all is the same");
});

test("typing task or idea and some text puts one Add row on top, above the normal results, and adds nothing yet", async () => {
  const calls = [];
  const env = environment({ destinations: PAGES, api: { tasksCreate: async (payload) => { calls.push(["task", payload]); return { ok: true, task: { id: "x", title: payload.title } }; }, ideasAction: async (payload) => { calls.push(["idea", payload]); return { ok: true, idea: { id: "y", title: payload.title }, added: true }; } } });
  env.palette.open();
  env.type("task board notes");
  assert.equal(env.list.children[0].children.find((child) => child.className === "kind").textContent, "Create");
  assert.equal(env.labels()[0], "Add task: “board notes”");
  assert.equal(env.list.children[0].classList.contains("active"), true, "it is the highlighted row, so Enter takes it");
  assert.equal(env.list.children[0].children.find((child) => child.className === "hint").children[0].textContent, "Enter");
  assert.match(env.status.textContent, /Enter adds it; nothing is added until then\./);
  assert.equal(descriptionOf(env.list.children[0]), "Adds it to the task board; the assistant picks it up.");
  env.type("idea a way to dim the tree");
  assert.equal(env.labels()[0], "Add idea: “a way to dim the tree”");
  assert.equal(descriptionOf(env.list.children[0]), "Saves it in your ideas. Nothing is built from it until you say so.");
  // Typing, moving and closing add nothing.
  env.key("ArrowDown"); env.key("ArrowUp");
  env.key("Escape"); await pause();
  assert.deepEqual(calls, []);
  // The normal results are still there for the same words when there are any.
  env.palette.open();
  env.type("task board plans");
  assert.deepEqual(env.labels(), ["Add task: “board plans”"], "nothing else matches these words, so the row is alone");
  env.type("plans");
  assert.equal(env.labels().some((label) => /^Add /.test(label)), false, "a plain search is untouched");
  env.type("task errors");
  assert.deepEqual(env.labels(), ["Add task: “errors”", "Task board"], "the Add row above the page its words also match");
  env.key("Escape");
  // A query that is exactly the name of a result keeps that result on top: what worked before still opens what it named.
  env.palette.open();
  env.type("task board");
  assert.deepEqual(env.labels(), ["Task board", "Add task: “board”"], "the page first, Add one row down");
  assert.equal(env.list.children[0].classList.contains("active"), true);
  env.key("Enter"); await pause();
  assert.deepEqual(calls, [], "Enter opens the page and creates nothing");
  assert.deepEqual(env.routes.map((route) => route.id), ["tasks"]);
  env.palette.open();
  env.type("TASK BOARD");
  env.key("ArrowDown"); env.key("Enter"); await pause();
  assert.equal(calls.length, 1, "and Add is still one arrow away");
  assert.deepEqual([calls[0][0], calls[0][1].title], ["task", "BOARD"]);
});

test("only the word, a space and some text is a command: task alone, plurals and longer words stay plain searches", () => {
  const env = environment({ destinations: PAGES, api: { tasksCreate: async () => ({ ok: true, task: { id: "t", title: "x" } }), ideasAction: async () => ({ ok: true, added: true, idea: { id: "i", title: "x" } }) } });
  env.palette.open();
  const created = (query) => { env.type(query); return env.labels().find((label) => /^Add (task|idea):/.test(label)) ?? null; };
  for (const query of ["task", "task ", "  task  ", "idea", "ideas", "ideas about dark mode", "tasks list", "taskforce now", "ideal thing", "idea-board", "mytask fix", "the task fix", "task:fix"]) assert.equal(created(query), null, JSON.stringify(query));
  assert.equal(created("task fix"), "Add task: “fix”");
  assert.equal(created("Task Fix the login"), "Add task: “Fix the login”", "any case, and the text keeps its own");
  assert.equal(created("IDEA   dim the tree  "), "Add idea: “dim the tree”");
  assert.equal(created("  task   spaced   out  "), "Add task: “spaced out”", "surrounding space and the run of spaces are tidied in the label");
  assert.equal(created("idea\tfrom a tab"), "Add idea: “from a tab”");
  assert.equal(created(`task ${"x".repeat(200)}`), `Add task: “${"x".repeat(59)}…”`, "a long text is cut in the label only");
});

test("Enter on Add task sends the text as the title, cut at 180, and all of it as the brief, then says so with an Open that goes to the task", async () => {
  const toasts = [], sent = [];
  const env = environment({ destinations: PAGES, toasts, api: { tasksCreate: async (payload) => { sent.push(structuredClone(payload)); return { ok: true, task: { id: "t42", title: "Fix the login redirect" }, tasks: [], projectId: "alpha" }; } } });
  env.palette.open();
  env.type("task Fix the login redirect");
  env.key("Enter"); await pause();
  assert.deepEqual(sent, [{ title: "Fix the login redirect", prompt: "Fix the login redirect", projectId: "alpha" }]);
  assert.equal(env.overlay.hidden, true, "Search closes");
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].text, "Task added: “Fix the login redirect”");
  assert.equal(toasts[0].kind, "good");
  assert.equal(toasts[0].options.action.label, "Open");
  assert.equal(toasts[0].options.duration, 8000);
  toasts[0].options.action.run();
  assert.deepEqual(plain(env.routes.at(-1)), { id: "tasks", params: { taskId: "t42" } });
  // A long text keeps its whole brief and a 180-character title.
  const long = `${"a".repeat(230)} end`;
  env.palette.open(); env.type(`task ${long}`); env.key("Enter"); await pause();
  assert.equal(sent.at(-1).title, "a".repeat(180));
  assert.equal(sent.at(-1).prompt, long);
  // A cut that lands on a space does not leave the title ending in it.
  const spaced = `${"a".repeat(179)} ${"b".repeat(40)} end`;
  env.palette.open(); env.type(`task ${spaced}`); env.key("Enter"); await pause();
  assert.equal(sent.at(-1).title, "a".repeat(179));
  assert.equal(sent.at(-1).prompt, spaced);
});

test("Enter on Add idea saves it through the ideas action as one from you, then says so with an Open that goes to the idea", async () => {
  const toasts = [], sent = [];
  const env = environment({ destinations: PAGES, toasts, api: { ideasAction: async (payload) => { sent.push(structuredClone(payload)); return { ok: true, added: true, idea: { id: "idea_owner_1", title: payload.title }, ideas: [] }; } } });
  env.palette.open();
  env.type("idea Let the tree dim when nothing runs");
  env.key("Enter"); await pause();
  assert.deepEqual(sent, [{ action: "add", source: "owner", title: "Let the tree dim when nothing runs", detail: "Let the tree dim when nothing runs", projectId: "alpha" }]);
  assert.equal(toasts[0].text, "Idea saved: “Let the tree dim when nothing r…”", "the toast clips the name; the saved idea keeps all of it");
  assert.equal(toasts[0].options.action.label, "Open");
  assert.equal(toasts[0].options.duration, 8000);
  toasts[0].options.action.run();
  assert.deepEqual(plain(env.routes.at(-1)), { id: "ideas", params: { ideaId: "idea_owner_1" } });
  // The same words again are the same idea, and the toast says it was already there.
  // A long idea keeps all of its text in the detail and a 200-character title.
  const longIdea = `${"i".repeat(199)} ${"j".repeat(60)}`;
  env.palette.open(); env.type(`idea ${longIdea}`); env.key("Enter"); await pause();
  assert.equal(sent.at(-1).title, "i".repeat(199), "cut at 200, and not left ending in the space");
  assert.equal(sent.at(-1).detail, longIdea);
  const again = environment({ destinations: PAGES, toasts, api: { ideasAction: async () => ({ ok: true, added: false, idea: { id: "idea_owner_1", title: "Let the tree dim" } }) } });
  again.palette.open(); again.type("idea Let the tree dim"); again.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Already in your ideas: “Let the tree dim”");
});

test("a project that is not known yet is asked for before an idea is saved", async () => {
  const sent = [], toasts = [];
  const env = environment({ destinations: PAGES, toasts, projectId: null, api: { ideasList: async () => ({ ok: true, projectId: "gamma", ideas: [] }), ideasAction: async (payload) => { sent.push(payload.projectId); return { ok: true, added: true, idea: { id: "i", title: "t" } }; } } });
  env.palette.open();
  env.type("idea from nowhere"); env.key("Enter"); await pause();
  assert.deepEqual(sent, ["gamma"]);
  const none = environment({ destinations: PAGES, toasts, projectId: null, api: { ideasList: async () => ({ ok: true, ideas: [] }), ideasAction: async () => { throw new Error("must not be called"); } } });
  none.palette.open(); none.type("idea from nowhere"); none.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Idea not saved · open a project first");
  assert.equal(toasts.at(-1).kind, "bad");
});

test("a task or idea the host refuses says why in the toast and adds nothing, with no Open", async () => {
  const toasts = [];
  const env = environment({ destinations: PAGES, toasts, api: {
    tasksCreate: async () => ({ ok: false, error: "“Fix the login” is already on the board. No new task was added." }),
    ideasAction: async () => ({ ok: false, error: "Shorten the idea to 16,000 characters before saving; no text was saved." }),
  } });
  env.palette.open(); env.type("task Fix the login"); env.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Task not added · “Fix the login” is already on the board. No new task was added.");
  assert.equal(toasts.at(-1).kind, "bad");
  assert.equal(toasts.at(-1).options, undefined);
  env.palette.open(); env.type("idea too long"); env.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Idea not saved · Shorten the idea to 16,000 characters before saving; no text was saved.");
  const thrown = environment({ destinations: PAGES, toasts, api: { tasksCreate: async () => { throw new Error("bridge down"); }, ideasAction: async () => { throw new Error("bridge down"); } } });
  thrown.palette.open(); thrown.type("task anything"); thrown.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Task not added · bridge down");
  thrown.palette.open(); thrown.type("idea anything"); thrown.key("Enter"); await pause();
  assert.equal(toasts.at(-1).text, "Idea not saved · bridge down");
});

test("quick add switched off between two openings of Search is picked up at the second: the row goes and the box reads as before", async () => {
  const PLAIN = "Find a tool, task, or setting…";
  let prefs = {};
  const env = environment({ destinations: PAGES, placeholder: PLAIN, api: { tasksCreate: async () => ({ ok: true, task: { id: "t", title: "x" } }), prefsGet: async () => ({ ok: true, prefs }) } });
  await settle();
  env.palette.open(); await settle();
  assert.notEqual(env.input.placeholder, PLAIN, "on: the box mentions it");
  env.type("task fix it");
  assert.equal(env.labels()[0], "Add task: “fix it”");
  env.key("Escape");
  prefs = { searchQuickCreate: false };
  env.palette.open(); await settle();
  assert.equal(env.input.placeholder, PLAIN);
  env.type("task fix it");
  assert.equal(env.labels().some((label) => /^Add /.test(label)), false);
});

test("without the desktop app's bridge there is no Add row and the box does not mention one; a bridge that can add one kind offers only that", async () => {
  const PLAIN = "Find a tool, task, or setting…";
  const web = environment({ destinations: PAGES, placeholder: PLAIN });
  await settle();
  web.palette.open();
  assert.equal(web.input.placeholder, PLAIN, "nothing to advertise");
  web.type("task board notes");
  assert.equal(web.labels().some((label) => /^Add /.test(label)), false, "a plain search, as in a browser tab before");
  web.type("idea board notes");
  assert.equal(web.labels().some((label) => /^Add /.test(label)), false);
  const tasksOnly = environment({ destinations: PAGES, placeholder: PLAIN, api: { tasksCreate: async () => ({ ok: true, task: { id: "t", title: "x" } }) } });
  await settle();
  tasksOnly.palette.open();
  assert.match(tasksOnly.input.placeholder, /to add$/, "one kind is enough to mention it");
  tasksOnly.type("task fix it");
  assert.equal(tasksOnly.labels()[0], "Add task: “fix it”");
  tasksOnly.type("idea fix it");
  assert.equal(tasksOnly.labels().some((label) => /^Add /.test(label)), false, "but no idea row where ideas cannot be saved");
});

test("Add task and Add idea are never remembered as recent", async () => {
  const storage = memoryStorage();
  const env = environment({ destinations: PAGES, storage, toasts: [], api: { tasksCreate: async () => ({ ok: true, task: { id: "t", title: "x" } }), ideasAction: async () => ({ ok: true, added: true, idea: { id: "i", title: "x" } }) } });
  env.palette.open(); env.type("task something"); env.key("Enter"); await pause();
  env.palette.open(); env.type("idea something"); env.key("Enter"); await pause();
  assert.equal(storage.map.has(recentKey("alpha")), false);
  env.palette.open();
  assert.equal(kinds(env).includes("Recent"), false);
});

test("with the quick add switched off, task ... is a plain search again and the box says what it said before", async () => {
  const PLAIN = "Find a tool, task, or setting…";
  const bridge = { tasksCreate: async () => ({ ok: true, task: { id: "t", title: "x" } }), ideasAction: async () => ({ ok: true, added: true, idea: { id: "i", title: "x" } }) };
  const off = environment({ destinations: PAGES, placeholder: PLAIN, api: { ...bridge, prefsGet: async () => ({ ok: true, prefs: { searchQuickCreate: false } }) } });
  await settle();
  off.palette.open(); await settle();
  off.type("task board");
  assert.equal(off.labels().some((label) => /^Add task/.test(label)), false);
  assert.deepEqual(off.labels(), ["Task board"]);
  assert.equal(off.input.placeholder, PLAIN, "the box reads exactly as it did before quick add");
  const on = environment({ destinations: PAGES, placeholder: PLAIN, api: { ...bridge, prefsGet: async () => ({ ok: true, prefs: {} }) } });
  await settle();
  on.palette.open(); await settle();
  assert.equal(on.input.placeholder, "Search · “task …” or “idea …” to add");
  assert.ok(on.input.placeholder.length <= 36, "short enough to be read whole in a 600px window, which shows about 37 characters");
  on.type("task board notes");
  assert.equal(on.labels()[0], "Add task: “board notes”");
});
