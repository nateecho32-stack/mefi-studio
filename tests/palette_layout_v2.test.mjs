// Search (Ctrl K) in the 0.5 layout (renderer/palette.js, "the 0.5 layout"): the prototype's
// palette (docs/prototype/mefi-studio-0.5-v5.html) over the same registry, keys, Recent and
// "task ..." as v1. The empty box is Recent, the sessions that matter, the rail's places and the
// actions marked for it, twelve rows; a search reaches sessions with their state, the backlog,
// pages, actions, Layout, Tabs and Permission mode; each row is an icon, a name and its state or
// key on the right. v1 is pinned by palette_keyboard.test.mjs. Fake DOM: fixtures/renderer-dom.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/palette.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
const HOUR = 3600000;
const now = Date.now();
const SECTIONS = { home: "Home", work: "Work", agents: "Agents", friends: "Friends", settings: "Settings", help: "Help" };
const RANKS = Object.keys(SECTIONS);

// The registry as the 0.5 layout fills it: the places' pages, a few pages of their own, and the actions the frame, the
// session panels, the inbox, the strip and the permission mode register (their paletteGroup, paletteBrowse and paletteHint).
function registry({ level = "auto" } = {}) {
  const page = (id, label, section, more = {}) => ({ id, label, kind: "overlay", section, showIn: { palette: true }, ...more });
  const action = (id, label, more = {}) => ({ id, label, kind: "action", section: "home", showIn: { palette: true }, ...more });
  return [
    page("workspace", "Home", "home", { key: "H", glyph: "g-home" }),
    page("tasks", "Task board", "work", { key: "T", glyph: "g-tasks", badge: "tasks" }),
    page("agents", "Agents", "agents", { glyph: "g-agents" }),
    page("friends", "Friends", "friends", { glyph: "g-orbit" }),
    page("studio", "Settings", "settings", { chord: "Ctrl ,", glyph: "g-studio" }),
    page("worktrees", "Worktrees", "work", { glyph: "g-worktree" }),
    page("help", "Keyboard shortcuts", "help", { key: "?" }),
    page("palette", "Search", "home", { key: "Ctrl K" }),
    action("sessions-new-task", "New task", { chord: "Ctrl N", paletteGroup: "Actions", paletteBrowse: 1, glyph: "g-add" }),
    action("shell-do-pause", "Pause new work", { paletteGroup: "Actions", paletteBrowse: 2 }),
    action("inbox-open", "Open the Inbox", { chord: "Ctrl J", paletteGroup: "Actions", paletteBrowse: 3, glyph: "g-bell" }),
    action("shell-do-mode", "Switch to Vibe", { chord: "Ctrl M", paletteGroup: "Actions", paletteBrowse: 4 }),
    action("assistantTidy", "Tidy up now", { section: "assistant" }),
    action("shell-do-list", "Hide the list", { chord: "Ctrl B", paletteGroup: "Layout" }),
    action("shell-do-reset", "Reset layout", { paletteGroup: "Layout" }),
    action("tabs-do-reopen", "Reopen a closed tab", { chord: "Ctrl Shift T", paletteGroup: "Tabs" }),
    ...[["ask", "Always ask"], ["accept", "Accept per task"], ["auto", "Auto"], ["elevated", "Elevated only"]].map(([id, title]) => action(`autonomy-set-${id}`, `Set permission mode: ${title}`, { section: "agents", paletteGroup: "Permission mode", paletteHint: () => (level === id ? "current" : "") })),
    action("hidden-one", "Not in this layout", { hidden: () => true }),
  ];
}
const task = (id, title, tone, minutes, more = {}) => ({ id, projectId: "p1", title, prompt: `${title}.`, tone, status: tone === "done" ? "done" : tone === "run" ? "active" : tone === "check" ? "awaiting_verification" : "open", updatedAt: now - minutes * 60000, createdAt: now - 48 * HOUR, ...more });
const TASKS = [
  task("t_done", "Rename the export button", "done", 600),
  task("t_run1", "Search notes by tag", "run", 30),
  task("t_ask", "Add an empty state to the notes list", "ask", 4),
  task("t_run2", "Keyboard shortcut for a new note", "run", 6),
  task("t_review", "Export notes as Markdown", "check", 12),
  task("t_queued", "Dark mode for the settings page", "ready", 120),
  task("t_done2", "Pin favourite notes", "done", 300),
  task("t_old", "An archived experiment", "done", 9000, { status: "archived", archived: true }),
];
const IDEAS = [{ id: "idea_1", title: "Share a note as a link", detail: "A read-only link", status: "open" }, { id: "idea_2", title: "Already a task", status: "open", taskId: "t_done" }];

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

function environment({ layout = "v2", board = true, destinations = registry(), storage = memoryStorage(), tasksList = null } = {}) {
  const { document, get } = createDom({ ids: ["palette-overlay", "palette-input", "palette-list", "palette-close", "palette-status", "palette-hint"] });
  if (layout) document.documentElement.dataset.layout = layout;
  const overlay = get("palette-overlay"), input = get("palette-input"), list = get("palette-list"), close = get("palette-close"), status = get("palette-status"), hint = get("palette-hint");
  overlay.hidden = true;
  input.placeholder = "Find a tool, task, or setting…";
  hint.textContent = "↑ ↓ to choose · Enter to open · Esc to close";
  const row = document.createElement("div"); row.className = "palette-search-row"; row.append(input, close);
  overlay.append(row, list, status, hint);
  document.body.append(overlay);
  for (const node of [input, close]) node.focus = () => { document.activeElement = node; };
  const routes = [], calls = [], handlers = {};
  const sectionOf = (dest) => dest.section;
  const window = {
    MefiNav: {
      state: {}, badges: { tasks: 7 },
      list: ({ showIn } = {}) => destinations.filter((dest) => dest.showIn?.[showIn] && !dest.hidden?.()),
      get: (id) => destinations.find((dest) => dest.id === id) ?? null,
      go: (id, params) => routes.push(params ? [id, params] : [id]),
      claim() {}, release() {},
      sectionLabel: (dest) => SECTIONS[sectionOf(dest)] ?? null,
      sectionRank: (dest) => { const at = RANKS.indexOf(sectionOf(dest)); return at < 0 ? RANKS.length : at; },
    },
    MefiWorkspace: { snapshot: () => (board ? { projectId: "p1", tasks: TASKS, ideas: IDEAS, status: {}, assistant: {}, backlog: null } : { projectId: null, tasks: [], ideas: [] }) },
    MefiBuilder: { reading: (row) => ({ tone: row.tone }) },
    MefiTasks: { state: { projectId: "p1", tasks: [] } },
    mefiStudio: {
      tasksList: async () => { calls.push("tasksList"); return tasksList ?? { ok: true, projectId: "p1", tasks: [] }; },
      tasksCreate: async () => ({ ok: true, task: { id: "new" } }), ideasAction: async () => ({ ok: true, idea: { id: "i" } }),
      prefsGet: async () => ({ ok: true, prefs: {} }), onProjects() {}, onTasks() {},
    },
    addEventListener(type, fn) { (handlers[type] ??= []).push(fn); },
  };
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout, Promise, localStorage: storage });
  const key = (name, extras = {}) => { const event = { key: name, preventDefault() { event.defaultPrevented = true; }, ...extras }; for (const fn of handlers.keydown || []) fn(event); return event; };
  const type = (value) => { input.value = value; for (const fn of input.listeners.input || []) fn({ target: input }); };
  // What the list shows: headings and rows, each row as [group, label, right-hand words, glyph].
  const shown = () => list.children.map((node) => node.classList.contains("palette-heading") ? `# ${node.textContent}` : [node.dataset.group, node.querySelector(".label")?.textContent ?? "", node.querySelector(".hint")?.textContent ?? "", node.querySelector("use")?.getAttribute("href") ?? ""]);
  const rows = () => list.children.filter((node) => node.classList.contains("palette-row"));
  return { palette: window.MefiPalette, window, document, overlay, input, list, close, status, hint, row, key, type, shown, rows, routes, calls, storage };
}

test("in the 0.5 layout the empty box is twelve rows: the sessions that matter, the rail's places, then the actions marked for it, under one heading each", async () => {
  const env = environment();
  env.palette.open();
  await settle();
  assert.deepEqual(env.shown(), [
    "# Sessions",
    ["Sessions", "Add an empty state to the notes list", "Needs you", "#g-tasks"],
    ["Sessions", "Keyboard shortcut for a new note", "Running", "#g-tasks"],
    ["Sessions", "Search notes by tag", "Running", "#g-tasks"],
    ["Sessions", "Export notes as Markdown", "Review", "#g-tasks"],
    ["Sessions", "Dark mode for the settings page", "Queued", "#g-tasks"],
    ["Sessions", "Pin favourite notes", "Done", "#g-tasks"],
    "# Places",
    ["Places", "Go to Home", "H", "#g-home"],
    ["Places", "Go to Work", "T", "#g-tasks"],
    ["Places", "Go to Agents", "", "#g-agents"],
    ["Places", "Go to Friends", "", "#g-orbit"],
    ["Places", "Go to Settings", "Ctrl ,", "#g-studio"],
    "# Actions",
    ["Actions", "New task", "Ctrl N", "#g-add"],
  ], "the session list's order (needs you, running, review, queued, done; newest first), six of them; the archived one waits for a search");
  assert.equal(env.rows().length, 12, "twelve rows, as the prototype");
  assert.equal(env.status.textContent, "12 results.", "the count is still said, for a screen reader");
  // The headings are not options: the keys walk the twelve rows and wrap within them.
  for (const heading of env.list.children.filter((node) => node.classList.contains("palette-heading"))) {
    assert.equal(heading.getAttribute("role"), "presentation");
    assert.equal(heading.id, "");
  }
  assert.equal(env.rows()[0].getAttribute("aria-selected"), "true");
  assert.equal(env.input.getAttribute("aria-activedescendant"), "palette-option-0");
  env.key("ArrowUp");
  assert.equal(env.input.getAttribute("aria-activedescendant"), "palette-option-11", "Up from the first row is the last of the twelve");
  env.key("ArrowDown");
  assert.equal(env.input.getAttribute("aria-activedescendant"), "palette-option-0");
  env.key("End");
  assert.equal(env.input.getAttribute("aria-activedescendant"), "palette-option-11");
});

test("a search reaches every group, with the state, the key or \"page\" on the right, and stays at twelve rows", async () => {
  const env = environment();
  env.palette.open();
  await settle();
  env.type("archived");
  assert.deepEqual(env.shown(), ["# Sessions", ["Sessions", "An archived experiment", "Archived", "#g-tasks"]], "an archived task is found and says so");
  env.type("share a note");
  assert.deepEqual(env.shown(), ["# Backlog", ["Backlog", "Share a note as a link", "Idea", "#g-ideas"]], "the backlog is the ideas nobody made a task of");
  env.type("already a task");
  assert.deepEqual(env.shown().filter((row) => row[0] === "Backlog"), [], "an idea that became a task is not in the backlog");
  env.type("worktrees");
  assert.deepEqual(env.shown(), ["# Work", ["Work", "Worktrees", "page", "#g-worktree"]], "a page of its own is under its section, and says page");
  env.type("set permission mode");
  assert.deepEqual(env.shown(), ["# Permission mode", ["Permission mode", "Set permission mode: Always ask", "", "#g-spark"], ["Permission mode", "Set permission mode: Accept per task", "", "#g-spark"], ["Permission mode", "Set permission mode: Auto", "current", "#g-spark"], ["Permission mode", "Set permission mode: Elevated only", "", "#g-spark"]], "the mode in force says current");
  env.type("reset layout");
  assert.deepEqual(env.shown()[1], ["Layout", "Reset layout", "", "#g-spark"]);
  env.type("reopen");
  assert.deepEqual(env.shown()[1], ["Tabs", "Reopen a closed tab", "Ctrl Shift T", "#g-spark"]);
  env.type("tidy");
  assert.deepEqual(env.shown()[1], ["Actions", "Tidy up now", "", "#g-spark"], "an action with no group of its own is an Action");
  env.type("task board");
  assert.deepEqual(env.shown()[1], ["Work", "Task board", "T", "#g-tasks"]);
  assert.equal(env.rows()[0].querySelector(".count")?.textContent, "7", "a count the page has is still shown");
  env.type("not in this layout");
  assert.deepEqual(env.rows(), [], "a record hidden in this layout is not listed");
  env.type("e");
  assert.equal(env.rows().length, 12, "a wide search shows its best twelve");
  assert.match(env.status.textContent, /^Showing 12 of \d+ results\. Keep typing to narrow them\./);
  env.type("search");
  assert.equal(env.shown().some((row) => Array.isArray(row) && row[1] === "Search"), false, "Search does not list itself");
});

test("Enter runs the row: a session through the router (the session panels take it there), an idea opens Ideas, a place its page", async () => {
  const env = environment();
  const run = async (query) => { env.palette.open(); env.type(query); env.key("Enter"); await new Promise((resolve) => setTimeout(resolve, 50)); };
  await run("empty state");
  assert.deepEqual(plain(env.routes.at(-1)), ["tasks", { taskId: "t_ask" }]);
  await run("share a note");
  assert.deepEqual(plain(env.routes.at(-1)), ["ideas", { ideaId: "idea_1" }]);
  await run("go to work");
  assert.deepEqual(plain(env.routes.at(-1)), ["tasks"]);
  await run("open the inbox");
  assert.deepEqual(plain(env.routes.at(-1)), ["inbox-open"]);
  // What was run comes back first under Recent, with its own icon and words.
  env.palette.open();
  await settle();
  assert.deepEqual(env.shown().slice(0, 5), ["# Recent", ["Recent", "Open the Inbox", "Ctrl J", "#g-bell"], ["Recent", "Go to Work", "T", "#g-tasks"], ["Recent", "Share a note as a link", "Idea", "#g-ideas"], ["Recent", "Add an empty state to the notes list", "Needs you", "#g-tasks"]]);
  assert.equal(env.rows().length, 12, "Recent counts towards the twelve");
  assert.equal(env.shown().filter((row) => Array.isArray(row) && row[1] === "Add an empty state to the notes list").length, 1, "and is not listed twice");
});

test("the box, the footer and Close read as the prototype's; the count stays for a screen reader; v1 gets its own back", async () => {
  const env = environment();
  env.palette.open();
  await settle();
  assert.equal(env.input.placeholder, "Search, or type “task …” or “idea …” to add one");
  assert.equal(env.close.hidden, true, "no Close button: the scrim and Escape close it");
  assert.equal(env.overlay.dataset.look, "v2");
  assert.deepEqual(env.hint.children.map((part) => [part.className, part.textContent]), [["palette-key", "↑↓ move"], ["palette-key", "Enter open"], ["palette-key", "Esc close"], ["palette-note", "Adding a task or idea only happens on Enter"]]);
  assert.deepEqual(env.hint.querySelectorAll("kbd").map((node) => node.textContent), ["↑", "↓", "Enter", "Esc"], "the keys as keys");
  assert.ok(env.row.querySelector(".palette-search-glyph"), "the prototype's magnifier before the box");
  // "task ..." leads, adds only on Enter, and has its icon.
  env.type("task Write the release notes");
  assert.deepEqual(env.shown()[1], ["Create", "Add task: “Write the release notes”", "Enter", "#g-add"]);
  env.key("Escape");
  // The layout goes off: the next look is v1's again.
  delete env.document.documentElement.dataset.layout;
  env.palette.open();
  await settle();
  assert.equal(env.input.placeholder, "Search · “task …” or “idea …” to add");
  assert.equal(env.close.hidden, false);
  assert.equal(env.hint.textContent, "↑ ↓ to choose · Enter to open · Esc to close");
  assert.equal(env.row.querySelector(".palette-search-glyph"), null);
  assert.equal(env.list.children.some((node) => node.classList.contains("palette-heading")), false, "v1 rows have no headings");
});

test("sessions come from the board Home already holds: no read of its own while there is one, v1's read when there is none", async () => {
  const env = environment();
  env.palette.open();
  await settle();
  assert.deepEqual(env.calls, [], "the board is there: no tasks:list");
  const bare = environment({ board: false, tasksList: { ok: true, projectId: "p1", tasks: [task("t_x", "Only in the store", "ready", 5)] } });
  bare.palette.open();
  await settle(); await settle();
  assert.deepEqual(bare.calls, ["tasksList"]);
  bare.type("only in the store");
  assert.deepEqual(bare.shown(), ["# Sessions", ["Sessions", "Only in the store", "Queued", "#g-tasks"]]);
});
