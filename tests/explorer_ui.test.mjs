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

function environment(bridge = {}, { readyState = "complete" } = {}) {
  const ids = new Map();
  const listeners = new Map();
  const domContentLoaded = [];
  // init() is the only caller of document.getElementById, so counting lookups
  // is a CDP-free probe of whether the element map has been built yet. A
  // pre-navigation open() must leave the count at zero.
  let lookups = 0;
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
    // Enough of a selector engine for "tag.class" (explorer.js asks for
    // "input.grow" and "li.selected"); anything richer matches nothing.
    querySelector(selector) {
      const [tag, cls] = String(selector).split(".");
      const walk = (node) => {
        for (const child of node.children) {
          if (typeof child !== "object" || !child.children) continue;
          if ((!tag || child.tagName === tag) && (!cls || child.classes.has(cls))) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return /^[a-z]*(\.[\w-]+)?$/i.test(String(selector)) ? walk(this) : null;
    }
    contains() { return false; }
    closest() { return null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    scrollIntoView() {}
  }
  const element = (id) => { if (!ids.has(id)) ids.set(id, new Element("div")); return ids.get(id); };
  document = {
    readyState,
    getElementById: (id) => { lookups += 1; return element(id); },
    createElement: (tag) => new Element(tag),
    createTextNode: (data) => ({ textContent: String(data) }),
    addEventListener: (type, fn) => { if (type === "DOMContentLoaded") domContentLoaded.push(fn); },
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
    get lookups() { return lookups; },
    tree: () => element("explorer-tree"),
    rows: () => element("explorer-tree").children,
    labelOf,
    element,
    open: async () => { window.MefiExplorer.open(); await flush(); },
    domReady() { document.readyState = "interactive"; for (const fn of domContentLoaded.splice(0)) fn(); },
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

test("the audit switches beside Proactive reflect saved prefs, save one pref each, and put a failed save back", async () => {
  const browser = environment();
  await browser.open();
  for (const id of ["memory-align", "loop-guard", "loop-guard-apply"]) assert.equal(browser.element(id).disabled, true, `${id} needs the desktop bridge`);

  const saves = [];
  const feeds = [];
  const prefs = { proactive: true, memoryAlign: false, loopGuard: true, loopGuardApply: true };
  let reply = (patch) => ({ ok: true, state: { prefs: { ...prefs, ...patch } } });
  const env = environment({
    assistantState: async () => ({ ok: true, state: { prefs } }),
    assistantMessage: async () => ({ ok: true }),
    assistantPrefs: async (patch) => { saves.push(patch); return reply(patch); },
    onAssistant: (fn) => feeds.push(fn),
  });
  await env.open();
  const memory = env.element("memory-align");
  const guard = env.element("loop-guard");
  const hold = env.element("loop-guard-apply");
  const line = env.element("assistant-status");
  assert.deepEqual([memory.checked, guard.checked, hold.checked], [false, true, true], "the switches show the saved prefs");
  assert.deepEqual([memory.disabled, guard.disabled, hold.disabled], [false, false, false]);

  guard.checked = false;
  guard.dispatch("change");
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(saves)), [{ loopGuard: false }], "one pref per switch, through assistantPrefs");
  assert.equal(hold.disabled, true, "Hold looping cards greys out while the loop guard is off");
  assert.equal(hold.checked, true, "its own pref is left alone");
  assert.match(line.text, /^loop guard off · every held card is released/);

  feeds.forEach((fn) => fn({ state: { prefs: { ...prefs, loopGuard: true, loopGuardApply: false } } }));
  assert.deepEqual([guard.checked, hold.checked, hold.disabled], [true, false, false], "a pushed state is reflected whenever it arrives");

  hold.checked = true;
  hold.dispatch("change");
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(saves.at(-1))), { loopGuardApply: true });
  assert.match(line.text, /^holding looping cards/);

  reply = () => ({ ok: false, error: "settings file is read-only" });
  memory.checked = true;
  memory.dispatch("change");
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(saves.at(-1))), { memoryAlign: true });
  assert.equal(memory.checked, false, "a failed save puts the switch back");
  assert.equal(line.text, "settings file is read-only");
  assert.equal(line.style.color, "var(--bad)");
});

test("the Machine panel surfaces the latched severe-memory cap instead of reading as a free machine", async () => {
  const machineFeeds = [];
  const env = environment({ onMachineStatus: (fn) => machineFeeds.push(fn) });
  await env.open();
  assert.ok(machineFeeds.length, "the explorer subscribes to machine status passes");
  const badge = env.element("machine-badge");
  const lines = env.element("machine-lines");
  const feed = (status) => machineFeeds.forEach((fn) => fn(status));
  // Latch set while admission is clear (a drained pool may start its one
  // worker): the panel must say the cap holds, not "idle".
  feed({
    lines: "350 MB RAM available · Severe-memory parallelism cap still latched — new worker starts stay capped until free memory recovers.",
    wait: false,
    leases: { exclusive: false, busy: false, holders: [] },
    running: [],
    processes: [],
    actions: [],
    capacity: { canStart: true, reason: null, resources: { memorySevereCapped: true, holdKind: null } },
  });
  assert.equal(badge.text, "memory cap", "a latched cap with clear admission shows on the badge");
  assert.ok(badge.classes.has("trains"), "the capped badge keeps the busy tone");
  assert.ok(badge.title.includes("capped"), "the badge explains the cap on hover");
  assert.equal(lines.style.color, "var(--info)", "the summary stays tinted while capped");
  // The active hold (holdKind "memory-cap", canStart false) keeps the busy
  // badge path and the same tint.
  feed({
    lines: "Machine memory is recovering from the severe floor (350 MB available; 450 MB needed) — worker parallelism stays capped at 4 until free memory recovers.",
    wait: true,
    leases: { exclusive: false, busy: false, holders: [] },
    running: [{ pid: 12, status: "healthy", ageMinutes: 1, memMB: 512 }],
    processes: [],
    actions: [],
    capacity: { canStart: false, reason: "capped", resources: { memorySevereCapped: true, holdKind: "memory-cap" } },
  });
  assert.equal(badge.text, "busy", "the active memory-cap hold reads as busy");
  assert.ok(badge.classes.has("trains"));
  // Released latch: the panel returns to the free reading.
  feed({
    lines: "8192 MB RAM available",
    wait: false,
    leases: { exclusive: false, busy: false, holders: [] },
    running: [],
    processes: [],
    actions: [],
    capacity: { canStart: true, reason: null, resources: { memorySevereCapped: false, holdKind: null } },
  });
  assert.equal(badge.text, "idle", "a released cap returns the idle badge");
  assert.ok(badge.classes.has("free"));
  assert.equal(lines.style.color, "", "the tint clears with the cap");
  assert.equal(badge.title, "", "the cap tooltip clears with the latch");
});

// A restored explorer deep link (nav's resumeReady) can reach open() from its
// own DOMContentLoaded handler before explorer.js's init() has run. Reproduce
// that ordering in the main world without CDP: load explorer.js while the
// document is still parsing (so init() defers to DOMContentLoaded), call the
// pre-navigation open(), then fire DOMContentLoaded. The old unguarded
// `els.overlay.hidden = false` threw "Cannot set properties of undefined
// (setting 'hidden')" here; the guard must leave open() a no-op until init().
test("a pre-navigation deep link runs open() before init() without the .hidden throw", async () => {
  const env = environment({}, { readyState: "loading" });
  const explorer = env.window.MefiExplorer;
  assert.ok(explorer, "explorer.js exposes its API before init() runs");
  assert.equal(env.lookups, 0, "init() is deferred while the document is still loading");

  const trace = [];
  await explorer.open({ sessionId: "ses-root" });
  trace.push(`open:mapBuilt=${env.lookups > 0}`);

  // close() shares the same element map, so a pre-navigation close() must also
  // no-op instead of throwing or building the map ahead of init().
  explorer.close();
  assert.equal(env.lookups, 0, "close() before init() does not build the element map");
  assert.equal(env.element("explorer-overlay").hidden, true, "close() before init() leaves the overlay closed");

  env.domReady();
  trace.push(`init:mapBuilt=${env.lookups > 0}`);

  assert.deepEqual(trace, ["open:mapBuilt=false", "init:mapBuilt=true"],
    "open() is observed before init(), and open() must not build the element map itself");
  assert.equal(env.element("explorer-overlay").hidden, true, "no overlay was opened pre-init");

  // The same deep link after init() opens normally, proving the guard did not
  // swallow the restored navigation.
  await env.open();
  assert.equal(env.element("explorer-overlay").hidden, false, "open() after init() shows the restored sheet");
  assert.ok(env.rows().length > 0, "the restored session tree renders once init() has run");
});

test("a builder session links back to the task it served, and other sessions offer no task link", async () => {
  const asked = [], went = [];
  const env = environment({
    tasksAttempts: async (payload) => { asked.push(payload); return payload.sessionId === "ses-root" ? { ok: true, projectId: "project-a", taskId: "task-fix", attempts: [] } : { ok: true, taskId: null, attempts: [] }; },
  });
  env.window.MefiNav = { go: (...args) => went.push(args) };
  await env.open();
  env.rows()[0].click(); await flush();
  const buttons = () => { const found = []; const walk = (node) => { for (const child of node.children || []) { if (child.tagName === "button") found.push(child); walk(child); } }; walk(env.element("explorer-detail")); return found; };
  const open = buttons().find((button) => button.textContent === "Open task");
  assert.ok(open, "the resolved task shows an Open task link");
  open.click();
  assert.deepEqual(JSON.parse(JSON.stringify(went)), [["tasks", { taskId: "task-fix", projectId: "project-a", filter: "all" }]]);
  env.rows()[2].click(); await flush();
  assert.ok(!buttons().some((button) => button.textContent === "Open task"), "a session with no ledger row has no task link");
  env.rows()[0].click(); await flush();
  assert.equal(asked.filter((payload) => payload.sessionId === "ses-root").length, 1, "a resolved session is not asked again");
});

test("a late Open task lookup repaints without losing a half-typed checkpoint", async () => {
  let answer = null;
  const env = environment({ tasksAttempts: () => new Promise((resolve) => { answer = resolve; }) });
  await env.open();
  env.rows()[0].click(); await flush();
  const detail = env.element("explorer-detail");
  const draft = detail.querySelector("input.grow");
  assert.ok(draft, "the checkpoint box is shown");
  draft.value = "half a note";
  answer({ ok: true, projectId: "project-a", taskId: "task-fix", attempts: [] }); await flush();
  assert.ok(detail.textContent.includes("Open task"), "the resolved task link appears");
  assert.equal(detail.querySelector("input.grow").value, "half a note", "the repaint keeps the draft");
});

test("the request inbox adds and removes through targeted actions and reports a refusal", async () => {
  const calls = [];
  let reply = (payload) => ({ ok: true, requests: payload.action === "add" ? [{ at: 9, prompt: "Fix the export", source: "manual" }, { at: 1, prompt: "Older", runId: "run_1" }] : [] });
  const env = environment({
    eyesRequestsRead: async () => ({ ok: true, requests: [{ at: 1, prompt: "Older", runId: "run_1" }] }),
    eyesRequestsWrite: async () => { throw new Error("a whole-list write must not be used"); },
    eyesRequestsAction: async (payload) => { calls.push(payload); return reply(payload); },
  });
  await env.open();
  env.element("request-input").value = "Fix the export";
  env.element("request-add").click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { action: "add", requests: [{ prompt: "Fix the export", source: "manual" }] });
  assert.match(env.element("request-list").textContent, /Fix the export/);
  reply = () => ({ ok: false, error: "A worker holds this request. Stop it or let it finish before removing it." });
  const removeOlder = () => { const rows = env.element("request-list").children; const row = rows.find((li) => /Older/.test(li.textContent)); const actions = row.children[1]; return actions.children.find((button) => button.textContent === "×"); };
  removeOlder().click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { action: "remove", key: { at: 1, prompt: "Older" } });
  assert.match(env.element("request-list").textContent, /Older/, "a refused remove leaves the request listed");
  assert.match(env.element("assistant-status").textContent, /A worker holds this request/);
});
