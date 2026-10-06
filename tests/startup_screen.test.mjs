// The launch screen (renderer/startup.js) against a stub document and a fake
// bridge: when it applies, what it preselects, which host calls each control
// makes, how the Start agents switch decides the launch, what a row and its
// chip say, and that nothing here ever asks the host to start an agent except
// through the switch's word, and never touches GitHub itself.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/startup.js", import.meta.url), "utf8");
// The choice is built inside the vm realm; compare its plain shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let count = 0; count < 120; count += 1) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// The stub grows with the screen: rows are wrappers around radio buttons, a
// chip is a span holding an inline SVG (createElementNS), panels hold inputs
// and a form, and a double click, a submit or an input are events to fire.
class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ""; this.title = ""; this.ownText = ""; this.id = ""; this.value = "";
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      toggle: (name, on) => { const set = classes(); if (on) set.add(name); else set.delete(name); this.className = [...set].join(" "); },
      contains: (name) => classes().has(name),
    };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.ownText = ""; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  async fire(name, event = {}) { for (const fn of this.listeners[name] ?? []) await fn({ target: this, preventDefault() {}, ...event }); }
  async click() { if (this.disabled) return; if (typeof this.onclick === "function") await this.onclick(); await this.fire("click"); }
  async dblclick() { if (this.disabled) return; await this.fire("dblclick"); }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrolled = options; }
  // tag, .class, #id, [attr] and [attr="value"], joined and comma separated; no combinators.
  matches(selector) {
    return selector.split(",").some((part) => (part.trim().match(/[a-z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/gi) ?? []).every((token) => {
      if (token[0] === ".") return this.className.split(/\s+/).includes(token.slice(1));
      if (token[0] === "#") return this.id === token.slice(1);
      if (token[0] === "[") { const [, key, value] = /\[([\w-]+)(?:="([^"]*)")?\]/.exec(token); return value === undefined ? (key in this.attrs || Boolean(this[key])) : (this.attrs[key] ?? String(this[key])) === value; }
      return this.tagName === token;
    }));
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function environment(bridge) {
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element(id.includes("open") || id.includes("add") ? "button" : "div")); return elements.get(id); };
  const document = { getElementById: (id) => get(id), createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) };
  const warnings = [];
  const stored = new Map();
  const localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key) };
  const context = vm.createContext({ window: { mefiStudio: bridge }, document, localStorage, console: { ...console, warn: (...args) => warnings.push(args) } });
  vm.runInContext(source, context, { filename: "startup.js" });
  const rows = () => get("boot-projects").querySelectorAll('[role="radio"]');
  const wrappers = () => get("boot-projects").children.filter((child) => child.className === "boot-row");
  const button = (root, text) => root.querySelectorAll("button").find((candidate) => candidate.textContent === text) ?? null;
  return {
    startup: context.window.MefiStartup, get, rows, wrappers, button, warnings, stored,
    selected: () => rows().find((row) => row.attrs["aria-checked"] === "true")?.dataset.projectId ?? null,
    slot: (index) => wrappers()[index].querySelector(".boot-chip-slot"),
    note: () => get("boot-choose-note"),
    panel: () => get("boot-panel"),
  };
}

const projectA = { id: "project_a", name: "Alpha", path: "C:/projects/alpha" };
const projectB = { id: "project_b", name: "Beta", path: "C:/projects/beta" };
function bridge(overrides = {}) {
  const calls = [];
  const api = {
    startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [projectA, projectB], activeId: projectB.id }),
    startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, chosen: true, projects: [projectA, projectB], activeId: id }; },
    startupBegin: async () => { calls.push(["begin"]); return { ok: true, released: true, running: true }; },
    projectsAdd: async () => { calls.push(["add"]); return { ok: true, projects: [projectA, projectB], activeId: projectB.id, canceled: true }; },
    ...overrides,
  };
  return { api, calls };
}
const launching = (launch, projects = [projectA, projectB], activeId = projectB.id) => ({ startupState: async () => ({ ok: true, interactive: true, chosen: false, projects, activeId, launch }) });

test("the screen is skipped without the startup contract, on diagnostic launches and after the choice", async () => {
  const { api } = bridge();
  const { startupState, ...withoutContract } = api;
  assert.equal(await environment(withoutContract).startup.choose(), null, "an older host has no launch screen");
  for (const state of [{ ok: false }, { ok: true, interactive: false, chosen: false, projects: [projectA], activeId: projectA.id }, { ok: true, interactive: true, chosen: true, projects: [projectA], activeId: projectA.id }]) {
    const env = environment({ ...api, startupState: async () => state });
    assert.equal(await env.startup.choose(), null, `no screen for ${JSON.stringify(state)}`);
    assert.equal(env.rows().length, 0, "nothing is rendered when the screen does not apply");
  }
  const failing = environment({ ...api, startupState: async () => { throw new Error("bridge gone"); } });
  assert.equal(await failing.startup.choose(), null);
  assert.equal(failing.warnings.length, 1, "an unavailable host is logged, never fatal");
});

test("the last project is preselected and Open selects it on the host with the agents left held", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  const choice = env.startup.choose({ isCurrent: () => true });
  await flush();
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id, projectB.id]);
  assert.equal(env.selected(), projectB.id, "the project Studio last had open is preselected");
  assert.equal(env.rows()[1].focused, true, "focus lands on the preselected row");
  assert.equal(env.rows()[1].className, "boot-project selected");
  assert.equal(env.get("boot-open").textContent, "Open", "one primary, and it says what it does");
  assert.equal(env.get("boot-open").className, "primary");
  assert.equal(env.get("boot-open").disabled, false);
  assert.equal(env.get("boot-start-agents").attrs["aria-checked"], "false");
  assert.equal(env.get("boot-start-agents").hidden, false);
  assert.match(env.note().textContent, /Agents stay off/);
  assert.equal(env.get("boot-detail").textContent, "Pick a project to work on, or add one below.");
  assert.deepEqual(calls, [], "rendering the screen calls nothing on the host");
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(calls, [["choose", projectB.id]]);
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.equal(calls.some(([name]) => name === "begin"), false, "Open with the switch off never starts the agents");
});

test("the Start agents switch is the launch's word: on asks for the agents once the studio is up, and it is never saved by the switch", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  await env.rows()[0].click();
  assert.equal(env.selected(), projectA.id);
  const sw = env.get("boot-start-agents");
  assert.equal(sw.attrs["aria-checked"], "false");
  await sw.click();
  assert.equal(sw.attrs["aria-checked"], "true", "the switch turns on");
  assert.match(env.note().textContent, /Agents start when the studio opens\. Change this in Settings › General\./);
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(calls, [["choose", projectA.id]], "the screen itself only chooses; starting waits for the handoff");
  assert.deepEqual(plain(await choice), { projectId: projectA.id, startAgents: true, changed: true });
  assert.deepEqual(await env.startup.begin(), { ok: true, released: true, running: true });
  assert.deepEqual(calls.at(-1), ["begin"]);
  assert.equal(calls.some(([name]) => /prefs|settings|launch/i.test(String(name))), false, "the switch saves nothing");
});

test("When Studio opens sets where the switch starts; the switch still has the last word", async () => {
  // Resume: the project whose last session ended with agents running opens
  // with them by default. Another project keeps the plain default.
  const resume = bridge(launching({ choice: "resume", last: { projectId: projectB.id, agents: true } }));
  const env = environment(resume.api);
  const choice = env.startup.choose();
  await flush();
  const sw = env.get("boot-start-agents");
  assert.equal(sw.attrs["aria-checked"], "true");
  assert.equal(env.get("boot-open").className, "primary");
  assert.match(env.note().textContent, /were running here when you left/);
  await env.rows()[0].click();
  assert.equal(sw.attrs["aria-checked"], "false", "a project whose agents were not running starts with the switch off");
  assert.match(env.note().textContent, /Agents stay off/);
  await env.rows()[1].click();
  assert.equal(sw.attrs["aria-checked"], "true", "following the default comes back with the project");
  // The owner's explicit "off" still wins over the default.
  await sw.click();
  assert.equal(sw.attrs["aria-checked"], "false");
  assert.match(env.note().textContent, /Agents stay off/);
  await env.rows()[0].click();
  await env.rows()[1].click();
  assert.equal(sw.attrs["aria-checked"], "false", "an explicit choice sticks across the list");
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.equal(resume.calls.some(([name]) => name === "begin"), false);

  // Start: every project defaults to starting its agents. Off: never.
  for (const [launch, expected, sentence] of [[{ choice: "start", last: null }, "true", /Agents start when the studio opens/], [{ choice: "off", last: { projectId: projectB.id, agents: true } }, "false", /Agents stay off/], [null, "false", /Agents stay off/]]) {
    const { api } = bridge(launching(launch));
    const screen = environment(api);
    screen.startup.choose();
    await flush();
    assert.equal(screen.get("boot-start-agents").attrs["aria-checked"], expected, JSON.stringify(launch));
    assert.match(screen.note().textContent, sentence);
  }
  const start = bridge(launching({ choice: "start", last: null }));
  const started = environment(start.api);
  const startedChoice = started.startup.choose();
  await flush();
  await started.get("boot-open").click();
  await flush();
  assert.deepEqual(plain(await startedChoice), { projectId: projectB.id, startAgents: true, changed: false }, "Open with the setting's switch left on asks for the agents");
});

test("project radios keep one Tab stop, keep their nodes when selection changes and retain focus", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  env.startup.choose();
  await flush();
  const before = env.rows();
  assert.deepEqual(before.map((row) => row.tabIndex), [-1, 0]);
  assert.equal(env.startup.navigateProjects("ArrowDown"), true);
  assert.equal(env.selected(), projectA.id, "arrow navigation wraps through the projects");
  assert.deepEqual(env.rows().map((row) => row.tabIndex), [0, -1]);
  assert.equal(env.rows()[0].focused, true, "the new selected row receives focus");
  assert.equal(env.wrappers()[0].scrolled?.block, "nearest", "a row far down the list is scrolled into view");
  env.startup.navigateProjects("End");
  assert.equal(env.selected(), projectB.id);
  env.startup.navigateProjects("Home");
  assert.equal(env.selected(), projectA.id);
  await env.rows()[1].click();
  assert.equal(env.rows()[1].focused, true, "clicking also retains focus");
  assert.deepEqual(env.rows(), before, "a selection change touches the rows in place: the same nodes, so a double click lands");
  assert.equal(env.startup.navigateProjects("Tab"), false);
  assert.deepEqual(calls, [], "browsing projects never opens one or starts work");
});

test("Enter on a row and a double click open it; both wait for nothing else and never start agents on their own", async () => {
  const enter = bridge();
  const env = environment(enter.api);
  const choice = env.startup.choose();
  await flush();
  assert.equal(env.startup.navigateProjects("Enter"), true, "the gate hands Enter to the screen and keeps it from also clicking");
  await flush();
  assert.deepEqual(enter.calls, [["choose", projectB.id]]);
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });

  const double = bridge();
  const other = environment(double.api);
  const opened = other.startup.choose();
  await flush();
  await other.rows()[0].dblclick();
  await flush();
  assert.deepEqual(double.calls, [["choose", projectA.id]], "the double click selects the row it is on, then opens it");
  assert.deepEqual(plain(await opened), { projectId: projectA.id, startAgents: false, changed: true });

  const idle = environment(bridge().api);
  assert.equal(idle.startup.navigateProjects("Enter"), false, "with no screen up, Enter is not the screen's");
});

test("a project the host cannot open keeps the screen up with its reason until a choice succeeds", async () => {
  let attempts = 0;
  const { api, calls } = bridge({ startupChoose: async (id) => { calls.push(["choose", id]); attempts += 1; return attempts === 1 ? { ok: false, error: "That project folder is unavailable. Reconnect it before switching.", projects: [projectA, projectB], activeId: projectB.id } : { ok: true, projects: [projectA, projectB], activeId: id }; } });
  const env = environment(api);
  let settled = null;
  const choice = env.startup.choose().then((value) => { settled = value; return value; });
  await flush();
  await env.get("boot-open").click();
  await flush();
  assert.equal(settled, null, "a refused choice never releases the gate");
  assert.match(env.note().textContent, /unavailable/);
  assert.equal(env.note().classList.contains("error"), true);
  assert.equal(env.note().dataset.kind, "error", "a refusal carries its warning glyph");
  assert.equal(env.get("boot-open").disabled, false, "the controls come back for another try");
  assert.equal(env.get("boot-open").textContent, "Open");
  assert.equal(env.get("boot-start-agents").disabled, false);
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.equal(calls.filter(([name]) => name === "choose").length, 2);
});

test("Open a folder adopts the folder the host added and a cancelled picker changes nothing", async () => {
  const projectC = { id: "project_c", name: "Gamma", path: "C:/projects/gamma" };
  let picks = 0;
  const { api, calls } = bridge({ projectsAdd: async () => { picks += 1; calls.push(["add"]); return picks === 1 ? { ok: true, projects: [projectA, projectB], activeId: projectB.id, canceled: true } : { ok: true, projects: [projectA, projectB, projectC], activeId: projectB.id, addedId: projectC.id }; } });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  assert.equal(env.get("boot-add-project").textContent, "Open a folder…");
  assert.equal(env.get("boot-add-project").className, "boot-verb", "a list keeps it a quiet verb");
  await env.get("boot-add-project").click();
  await flush();
  assert.equal(env.selected(), projectB.id, "a cancelled picker keeps the selection");
  assert.equal(env.note().classList.contains("error"), false, "and says nothing");
  await env.get("boot-add-project").click();
  await flush();
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id, projectB.id, projectC.id]);
  assert.equal(env.selected(), projectC.id, "the folder just added is the pick");
  await env.get("boot-open").click();
  assert.deepEqual(plain(await choice), { projectId: projectC.id, startAgents: false, changed: true });
  assert.deepEqual(calls, [["add"], ["add"], ["choose", projectC.id]]);

  const failing = bridge({ projectsAdd: async () => ({ ok: false, projects: [projectA, projectB], activeId: projectB.id, error: "" }) });
  const bad = environment(failing.api);
  bad.startup.choose();
  await flush();
  await bad.get("boot-add-project").click();
  await flush();
  assert.equal(bad.note().textContent, "That folder could not be opened.");
  assert.equal(bad.note().classList.contains("error"), true);
});

test("with no project yet the screen leads with Start a new app, offers the folder you have and continuing without one, and never shows the agents switch", async () => {
  const { api, calls } = bridge({ startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [], activeId: null }), startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, projects: [], activeId: null }; } });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  assert.equal(env.rows().length, 0);
  assert.match(env.get("boot-projects").textContent, /New here\? Start a new app and Studio makes the folder for you\. Already have a project folder\? Open it\./);
  assert.equal(env.get("boot-open").textContent, "Continue without a project");
  assert.equal(env.get("boot-open").className, "boot-verb", "continuing without a project is the quietest choice");
  assert.equal(env.get("boot-new-app").textContent, "Start a new app");
  assert.equal(env.get("boot-new-app").className, "primary boot-add", "a beginner's way in leads: Studio makes the folder");
  assert.equal(env.get("boot-add-project").textContent, "Open a folder…");
  assert.equal(env.get("boot-add-project").className, "ghost boot-add");
  assert.equal(env.get("boot-start-agents").hidden, true);
  assert.deepEqual(env.get("boot-go").children, [env.get("boot-new-app"), env.get("boot-add-project")], "a new app leads, beside the folder you already have");
  assert.deepEqual(env.get("boot-verbs").children, [env.get("boot-from-github"), env.get("boot-open")], "the footer keeps GitHub and the quiet continue");
  assert.equal(env.get("boot-choose").dataset.empty, "true");
  assert.equal(env.get("boot-detail").textContent, "", "the title stands alone above the empty note");
  assert.equal(env.get("boot-new-app").focused, true, "the way in has the focus");
  assert.match(env.note().textContent, /M\+ project button, top left/);
  await env.get("boot-open").click();
  assert.deepEqual(plain(await choice), { projectId: null, startAgents: false, changed: false });
  assert.deepEqual(calls, [["choose", null]]);
});

test("a stale gate epoch cancels the choice without touching the screen again", async () => {
  const pending = deferred();
  const { api } = bridge({ startupChoose: async () => pending.promise });
  const env = environment(api);
  let current = true;
  const choice = env.startup.choose({ isCurrent: () => current });
  await flush();
  const clicking = env.get("boot-open").click();
  await flush();
  assert.equal(env.get("boot-open").disabled, true, "the controls lock while the host opens the project");
  current = false;
  pending.resolve({ ok: true, projects: [projectA, projectB], activeId: projectB.id });
  await clicking;
  let settled = false;
  choice.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, "a superseded gate never receives the choice");
  assert.equal(env.get("boot-open").disabled, true, "nothing repaints for a gate that moved on");
});

test("opening locks every control and says so: the primary becomes Opening…, a screen reader hears the project", async () => {
  const pending = deferred();
  const { api } = bridge({ startupChoose: async () => pending.promise });
  const env = environment(api);
  env.startup.choose();
  await flush();
  const clicking = env.get("boot-open").click();
  await flush();
  assert.equal(env.get("boot-open").textContent, "Opening…");
  assert.equal(env.get("boot-open").dataset.busy, "true", "the spinner keys off the busy mark");
  assert.equal(env.get("boot-live").textContent, "Opening Beta…");
  for (const id of ["boot-open", "boot-start-agents", "boot-add-project", "boot-new-app", "boot-from-github"]) assert.equal(env.get(id).disabled, true, `${id} is locked`);
  assert.deepEqual(env.rows().map((row) => row.disabled), [true, true]);
  const before = env.selected();
  await env.rows()[0].click();
  assert.equal(env.selected(), before, "a locked row does not change the pick");
  assert.equal(env.startup.navigateProjects("ArrowUp"), false, "nor does the keyboard");
  await env.get("boot-open").click();
  pending.resolve({ ok: true, projects: [projectA, projectB], activeId: projectB.id });
  await clicking;
  await flush();
});

test("rows say when they were opened, most recent first only when every project can say", async () => {
  const now = Date.now();
  const A = { ...projectA, openedAt: now - (3 * 86400000 + 60000) }, B = { ...projectB, openedAt: now - 12 * 60000 };
  const C = { id: "project_c", name: "Gamma", path: "C:/projects/gamma", openedAt: now - 30 * 3600000 };
  const { api } = bridge(launching(null, [A, B, C], A.id));
  const env = environment(api);
  env.startup.choose();
  await flush();
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [B.id, C.id, A.id], "most recent first");
  assert.equal(env.selected(), A.id, "the sort never moves the preselected project");
  assert.deepEqual(env.wrappers().map((wrap) => wrap.querySelector(".boot-project-opened").textContent), ["Opened 12 minutes ago", "Opened yesterday", "Opened 3 days ago"]);

  const partial = bridge(launching(null, [A, projectB, C], A.id));
  const unsorted = environment(partial.api);
  unsorted.startup.choose();
  await flush();
  assert.deepEqual(unsorted.rows().map((row) => row.dataset.projectId), [A.id, projectB.id, C.id], "one unknown time keeps the host's order");
  assert.equal(unsorted.wrappers()[1].querySelector(".boot-project-opened"), null, "an unknown time shows nothing");
});

test("relative times and long paths read the way the board says", () => {
  const env = environment(bridge().api);
  const { relative, splitPath } = env.startup;
  const now = Date.UTC(2026, 8, 29, 12, 0, 0);
  const at = (ms) => relative(now - ms, now);
  assert.equal(at(20000), "just now");
  assert.equal(at(60000), "1 minute ago");
  assert.equal(at(12 * 60000), "12 minutes ago");
  assert.equal(at(3600000), "1 hour ago");
  assert.equal(at(5 * 3600000), "5 hours ago");
  assert.equal(at(24 * 3600000), "yesterday");
  assert.equal(at(47 * 3600000), "yesterday");
  assert.equal(at(3 * 86400000), "3 days ago");
  assert.equal(at(15 * 86400000), "2 weeks ago");
  assert.match(at(120 * 86400000), /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/, "old work gets a date");
  assert.equal(relative(null, now), "");
  assert.equal(relative(0, now), "");
  assert.equal(relative(now + 60000, now), "just now", "a clock a little ahead never says the future");

  assert.deepEqual(plain(splitPath("C:\\Users\\echor\\OneDrive\\Desktop\\Coding Projects\\Mefi's Studio AI+")), ["C:\\Users\\echor\\OneDrive\\Desktop\\Coding Projects", "\\Mefi's Studio AI+"], "the drive is kept and the folder name is its own piece");
  assert.deepEqual(plain(splitPath("C:/projects/alpha/")), ["C:/projects", "/alpha"]);
  assert.deepEqual(plain(splitPath("alpha")), ["", "alpha"]);
  assert.deepEqual(plain(splitPath("")), ["", ""]);
});

test("a chip arrives after the rows: a pulsing placeholder first, then the host's model, and nothing when it could not be read", async () => {
  const gate = deferred(), asked = [];
  const { api } = bridge({ projectsGlance: async (ids) => { asked.push(ids); return gate.promise; } });
  const env = environment(api);
  env.startup.choose();
  await flush();
  assert.deepEqual(plain(asked), [[projectB.id, projectA.id]], "the selected project is looked at first, in one call");
  for (const index of [0, 1]) {
    const waiting = env.slot(index).children[0];
    assert.equal(waiting.className, "boot-chip-wait");
    assert.equal(waiting.children[0].className, "boot-chip-skeleton");
    assert.equal(waiting.children[0].attrs["aria-hidden"], "true");
    assert.equal(waiting.children[1].textContent, "Checking GitHub", "the words are read out, the pulse is for eyes");
  }
  gate.resolve({ ok: true, items: [
    { id: projectA.id, available: true, chip: { id: "ahead", label: "2 to push", tone: "info", glyph: "ahead", sentence: "Some work on this PC is not on GitHub yet." } },
    { id: projectB.id, available: true, chip: null },
  ] });
  await flush();
  const chip = env.slot(0).children[0];
  assert.equal(chip.className, "boot-chip");
  assert.equal(chip.dataset.tone, "info");
  assert.equal(chip.dataset.state, "ahead");
  assert.equal(chip.textContent, "2 to push");
  assert.equal(chip.title, "Some work on this PC is not on GitHub yet.");
  assert.equal(chip.children[0].tagName, "svg", "the glyph is a small inline drawing");
  assert.equal(chip.children[0].attrs["aria-hidden"], "true");
  assert.equal(chip.children[0].children[0].attrs.d, "M8 12.5V4M4.8 7.2 8 4l3.2 3.2");
  assert.equal(env.slot(1).children.length, 0, "unknown shows nothing, never a guess");
});

test("a chip is only what the host modelled: unknown tones stay neutral, unknown glyphs get the dotted ring, junk shows nothing", async () => {
  const items = [
    { id: projectA.id, chip: { id: "no-remote", label: "Only on this PC", tone: "neutral", glyph: "no-remote" } },
    { id: projectB.id, chip: { id: "novel", label: "Something new", tone: "sparkly", glyph: "__proto__" } },
  ];
  const { api } = bridge({ projectsGlance: async () => ({ ok: true, items }) });
  const env = environment(api);
  env.startup.choose();
  await flush();
  assert.equal(env.slot(0).children[0].children[0].children[0].attrs["stroke-dasharray"], "3 2", "a dashed cloud for a project only on this PC");
  const odd = env.slot(1).children[0];
  assert.equal(odd.dataset.tone, "neutral");
  assert.equal(odd.children[0].children[0].attrs["stroke-dasharray"], "0.01 3.14", "the fallback is the unknown ring");

  for (const chip of [null, "chip", { label: "" }, { label: "   " }, { label: 4 }]) {
    const junk = environment(bridge({ projectsGlance: async () => ({ ok: true, items: [{ id: projectA.id, chip }] }) }).api);
    junk.startup.choose();
    await flush();
    assert.equal(junk.slot(0).children.length, 0, `nothing for ${JSON.stringify(chip)}`);
  }
});

test("a glance that fails, refuses or is absent never leaves a placeholder or breaks the screen", async () => {
  const refused = environment(bridge({ projectsGlance: async () => ({ ok: false }) }).api);
  refused.startup.choose();
  await flush();
  assert.equal(refused.slot(0).children.length, 0, "a refusal shows nothing");
  const throwing = environment(bridge({ projectsGlance: async () => { throw new Error("no host"); } }).api);
  throwing.startup.choose();
  await flush();
  assert.equal(throwing.slot(0).children.length, 0);
  assert.equal(throwing.warnings.length, 1, "a failed look is logged, never fatal");
  const older = environment(bridge().api);
  older.startup.choose();
  await flush();
  assert.equal(older.wrappers()[0].querySelector(".boot-chip-slot"), null, "a host without the look draws no chip slot at all");
});

test("a long list is looked at in batches, the selected project first, and never after the gate has moved on", async () => {
  const projects = Array.from({ length: 8 }, (_, index) => ({ id: `project_${index}`, name: `P${index}`, path: `C:/p/${index}` }));
  const asked = [];
  const { api } = bridge({ ...launching(null, projects, "project_5"), projectsGlance: async (ids) => { asked.push(ids); return { ok: true, items: ids.map((id) => ({ id, chip: { id: "in-sync", label: "In sync", tone: "good", glyph: "in-sync" } })) }; } });
  const env = environment(api);
  env.startup.choose();
  await flush();
  assert.deepEqual(plain(asked), [["project_5", "project_0", "project_1", "project_2", "project_3", "project_4"], ["project_6", "project_7"]]);
  assert.equal(env.slot(7).children[0].textContent, "In sync");

  const late = deferred();
  let current = true;
  const stale = environment(bridge({ projectsGlance: async () => late.promise }).api);
  stale.startup.choose({ isCurrent: () => current });
  await flush();
  current = false;
  late.resolve({ ok: true, items: [{ id: projectA.id, chip: { id: "ahead", label: "2 to push", tone: "info", glyph: "ahead" } }] });
  await flush();
  assert.equal(stale.slot(0).children[0].className, "boot-chip-wait", "a gate that moved on is not repainted");
});

test("a folder that is gone says so on its row, blocks Open with the exact sentence and can be removed from the list", async () => {
  const gone = { ...projectB, available: false };
  let removed = null;
  const { api, calls } = bridge({ ...launching(null, [projectA, gone], gone.id), projectsRemove: async (id) => { removed = id; calls.push(["remove", id]); return { ok: true, projects: [projectA], activeId: projectA.id, removedId: id }; }, projectsGlance: async (ids) => { calls.push(["glance", ids]); return { ok: true, items: [] }; } });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  assert.deepEqual(plain(calls.filter(([name]) => name === "glance")), [["glance", [projectA.id]]], "a folder that is gone is not looked at");
  const chip = env.slot(1).children[0];
  assert.equal(chip.dataset.state, "folder-missing");
  assert.equal(chip.dataset.tone, "warn");
  assert.equal(chip.textContent, "Folder missing");
  assert.equal(env.get("boot-open").disabled, true, "Open is disabled for a folder that is gone");
  assert.equal(env.note().textContent, "That project folder is unavailable. Reconnect it before switching.");
  assert.equal(env.note().dataset.kind, "missing");
  assert.equal(env.note().classList.contains("error"), false, "it is said plainly, not in red");
  assert.equal(env.startup.navigateProjects("Enter"), true);
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(calls.filter(([name]) => name === "choose"), [], "the host is never asked to open a folder the screen knows is gone");

  await env.rows()[0].click();
  assert.equal(env.get("boot-open").disabled, false, "another project opens as usual");
  assert.equal(env.note().dataset.kind, "");
  await env.rows()[1].click();
  const remove = env.button(env.get("boot-projects"), "Remove from list");
  assert.equal(remove.className, "mini danger");
  await remove.click();
  await flush();
  assert.equal(removed, gone.id);
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id]);
  assert.equal(env.selected(), projectA.id, "the list closes ranks and the pick moves to what is left");
  assert.equal(env.button(env.get("boot-projects"), "Remove from list"), null);
  assert.equal(env.get("boot-open").disabled, false);
  await env.get("boot-open").click();
  assert.deepEqual(plain(await choice), { projectId: projectA.id, startAgents: false, changed: true });
});

test("removing the last project falls back to the first-launch screen; a refused removal says why and changes nothing", async () => {
  const gone = { ...projectA, available: false };
  const refuse = bridge({ ...launching(null, [gone], gone.id), projectsRemove: async () => ({ ok: false, error: "Finish or stop the 2 running build(s) before switching projects.", busy: true }) });
  const env = environment(refuse.api);
  env.startup.choose();
  await flush();
  await env.button(env.get("boot-projects"), "Remove from list").click();
  await flush();
  assert.equal(env.note().textContent, "Finish or stop the 2 running build(s) before switching projects.");
  assert.equal(env.note().classList.contains("error"), true);
  assert.equal(env.rows().length, 1);
  assert.equal(env.button(env.get("boot-projects"), "Remove from list").disabled, false, "the controls come back");

  const last = bridge({ ...launching(null, [gone], gone.id), projectsRemove: async () => ({ ok: true, projects: [], activeId: null }) });
  const emptied = environment(last.api);
  emptied.startup.choose();
  await flush();
  await emptied.button(emptied.get("boot-projects"), "Remove from list").click();
  await flush();
  assert.equal(emptied.rows().length, 0);
  assert.equal(emptied.get("boot-open").textContent, "Continue without a project");
  assert.equal(emptied.get("boot-new-app").className, "primary boot-add");
  assert.equal(emptied.get("boot-start-agents").hidden, true);
  assert.equal(emptied.get("boot-new-app").focused, true, "the way in has the focus again");
});

test("the filter appears from the sixth project and narrows the list without losing the pick", async () => {
  const many = (count) => Array.from({ length: count }, (_, index) => ({ id: `project_${index}`, name: index === 3 ? "Field Notes" : `App ${index}`, path: `C:/p/${index === 3 ? "notes" : "app" + index}` }));
  const five = environment(bridge(launching(null, many(5), "project_0")).api);
  five.startup.choose();
  await flush();
  assert.equal(five.get("boot-filter-row").hidden, true, "five projects need no filter");
  const six = environment(bridge(launching(null, many(6), "project_0")).api);
  six.startup.choose();
  await flush();
  assert.equal(six.get("boot-filter-row").hidden, false);
  const filter = six.get("boot-filter");
  filter.value = "  FIELD ";
  await filter.fire("input");
  assert.deepEqual(six.wrappers().map((wrap) => wrap.hidden), [true, true, true, false, true, true]);
  assert.equal(six.selected(), "project_3", "a pick that no longer shows moves to the first that does");
  assert.equal(six.startup.navigateProjects("ArrowDown"), true);
  assert.equal(six.selected(), "project_3", "arrows only walk what shows");
  filter.value = "zzz";
  await filter.fire("input");
  assert.equal(six.wrappers().every((wrap) => wrap.hidden), true);
  assert.equal(six.get("boot-projects").children.at(-1).hidden, false);
  assert.equal(six.get("boot-projects").children.at(-1).textContent, "No project matches that.");
  filter.value = "";
  await filter.fire("input");
  assert.equal(six.wrappers().every((wrap) => !wrap.hidden), true);
});

test("Start a new app takes a name and a note, makes the folder, opens it, and never reaches GitHub from here", async () => {
  const made = { id: "project_new", name: "Field Notes", path: "C:/Users/x/Mefi Apps/field-notes" };
  const seen = [];
  const { api, calls } = bridge({
    projectsCreate: async (payload) => { calls.push(["create", payload]); return { ok: true, projects: [projectA, projectB, made], activeId: made.id, addedId: made.id, selectedId: made.id, folder: made.path, git: true }; },
    startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, chosen: true, projects: [projectA, projectB, made], activeId: id }; },
    gitPublish: async (...args) => { seen.push(args); return { ok: true }; },
    gitLink: async (...args) => { seen.push(args); return { ok: true }; },
    githubAccount: async () => { seen.push(["account"]); return { ok: true, account: "someone" }; },
  });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  await env.get("boot-new-app").click();
  const panel = env.panel();
  assert.equal(panel.hidden, false);
  assert.equal(env.get("boot-projects").hidden, true, "the panel takes the list's place");
  assert.equal(env.get("boot-go").hidden, true);
  assert.equal(env.get("boot-verbs").hidden, true);
  assert.equal(env.get("boot-title").textContent, "Start a new app", "the card's own heading names the panel");
  assert.equal(env.get("boot-detail").textContent, "Studio makes the folder, starts version history in it and opens it as your project.");
  assert.match(panel.textContent, /You can put it on GitHub from the Git chip once it opens\./);
  assert.match(panel.textContent, /Mefi Apps › your-app/);
  const name = panel.querySelector("#boot-new-name"), about = panel.querySelector("#boot-new-about");
  assert.equal(name.placeholder, "Name your app");

  const form = panel.querySelector("#boot-new-form");
  await form.fire("submit");
  await flush();
  assert.equal(env.note().textContent, "Give the new app a name.", "an empty name is said, not sent");
  assert.equal(env.note().classList.contains("error"), true);
  assert.equal(calls.some(([call]) => call === "create"), false);

  name.value = "Field Notes";
  await name.fire("input");
  assert.match(panel.textContent, /Mefi Apps › field-notes/, "the folder follows the name");
  about.value = "  A small notes app.  ";
  await form.fire("submit");
  await flush();
  assert.deepEqual(plain(calls), [["create", { name: "Field Notes", about: "A small notes app." }], ["choose", made.id]], "the folder first, then it opens like any chosen project");
  assert.deepEqual(plain(await choice), { projectId: made.id, startAgents: false, changed: true });
  assert.deepEqual(seen, [], "the launch screen never publishes, links or even asks about GitHub");
  assert.deepEqual(JSON.parse(env.stored.get("mefiStudio.firstTask")), { projectId: made.id, text: "A small notes app." }, "what they want to build waits as that app's first task in the welcome");
});

test("Start a new app: a description is optional, a refusal keeps the panel up in red, and a folder made but not opened still shows in the list", async () => {
  const oldOne = { id: "project_old", name: "Old", path: "C:/x/old" };
  let attempt = 0;
  const { api, calls } = bridge({
    projectsCreate: async (payload) => {
      calls.push(["create", payload]);
      attempt += 1;
      if (attempt === 1) return { ok: false, projects: [projectA, projectB], activeId: projectB.id, error: "C:/Users/x/Mefi Apps/field-notes already exists and is not empty. Choose another name." };
      return { ok: false, created: true, projects: [projectA, projectB, oldOne], activeId: projectB.id, addedId: oldOne.id, error: "That project folder is unavailable. Reconnect it before switching." };
    },
  });
  const env = environment(api);
  env.startup.choose();
  await flush();
  await env.get("boot-new-app").click();
  const name = env.panel().querySelector("#boot-new-name");
  name.value = "Field Notes";
  await env.panel().querySelector("#boot-new-form").fire("submit");
  await flush();
  assert.deepEqual(plain(calls), [["create", { name: "Field Notes" }]], "no description, no about");
  assert.equal(env.note().textContent, "C:/Users/x/Mefi Apps/field-notes already exists and is not empty. Choose another name.");
  assert.equal(env.note().classList.contains("error"), true);
  assert.equal(env.panel().hidden, false, "the panel stays for another name");
  const start = env.button(env.panel(), "Start project");
  assert.ok(start, "the primary is back to its own words");
  assert.equal(start.disabled, false);
  assert.equal(env.get("boot-open").disabled, false);

  await env.panel().querySelector("#boot-new-form").fire("submit");
  await flush();
  assert.equal(env.note().textContent, "That project folder is unavailable. Reconnect it before switching.");
  await env.button(env.panel(), "Cancel").click();
  assert.equal(env.panel().hidden, true);
  assert.equal(env.get("boot-projects").hidden, false);
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id, projectB.id, oldOne.id], "the folder that was made is in the list to try again");
  assert.equal(env.selected(), oldOne.id);
  assert.equal(env.get("boot-new-app").focused, true, "focus goes back to the verb that opened the panel");
});

test("Get from GitHub lists the account's projects, downloads the pick into a folder main chooses and opens it", async () => {
  const repos = [
    { repo: "me/alpha-two", private: true, description: "The second one", updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { repo: "me/open-source", private: false, description: "", updatedAt: "" },
  ];
  const cloned = { id: "project_g", name: "alpha-two", path: "C:/Code/alpha-two" };
  const listAfter = [projectA, projectB, cloned];
  let reads = 0;
  const { api, calls } = bridge({
    startupState: async () => { reads += 1; calls.push(["state", reads]); return { ok: true, interactive: true, chosen: false, projects: reads === 1 ? [projectA, projectB] : listAfter, activeId: projectB.id }; },
    pcSetupRepos: async () => { calls.push(["repos"]); return { ok: true, repos }; },
    pcSetupClone: async (repo) => { calls.push(["clone", repo]); return { ok: true, folder: "C:\\Code\\alpha-two\\" }; },
    startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, chosen: true, projects: listAfter, activeId: id }; },
  });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  await env.get("boot-from-github").click();
  await flush();
  const panel = env.panel();
  assert.equal(env.get("boot-title").textContent, "Get from GitHub");
  assert.equal(env.get("boot-detail").textContent, "Studio asks where to put it, then downloads it and opens it.");
  const radios = panel.querySelectorAll('[role="radio"]');
  assert.deepEqual(radios.map((radio) => radio.dataset.repo), ["me/alpha-two", "me/open-source"]);
  assert.match(radios[0].textContent, /Private/);
  assert.match(radios[0].textContent, /Updated 2 days ago/);
  assert.match(radios[1].textContent, /Public/);
  assert.equal(radios[0].focused, true, "the list has the focus once it shows");
  const go = env.button(panel, "Download and open");
  assert.equal(go.disabled, true, "nothing is chosen yet");
  assert.equal(env.startup.navigateProjects("ArrowDown"), true, "the gate's radio keys walk this list while it is up");
  assert.equal(radios[0].attrs["aria-checked"], "true", "with nothing chosen, forward lands on the first");
  await radios[1].click();
  assert.equal(radios[1].className, "boot-repo selected");
  assert.equal(radios[0].className, "boot-repo");
  assert.equal(env.startup.navigateProjects("Home"), true);
  assert.equal(radios[0].attrs["aria-checked"], "true");
  assert.equal(radios[1].attrs["aria-checked"], "false");
  assert.equal(go.disabled, false);
  await go.click();
  await flush();
  assert.deepEqual(plain(calls.filter(([name]) => name !== "state")), [["repos"], ["clone", "me/alpha-two"], ["choose", "project_g"]], "the folder dialog is main's; the list is read again to find the new project");
  assert.deepEqual(plain(await choice), { projectId: "project_g", startAgents: false, changed: true });
});

test("Get from GitHub: the list can be searched from the sixth project, the arrows walk only what shows and a hidden pick stays the pick", async () => {
  const repos = Array.from({ length: 7 }, (_, index) => ({ repo: `me/${index === 4 ? "field-notes" : "app-" + index}`, private: index % 2 === 0, description: index === 2 ? "A little map maker" : "", updatedAt: "" }));
  const five = environment(bridge({ pcSetupRepos: async () => ({ ok: true, repos: repos.slice(0, 5) }) }).api);
  five.startup.choose();
  await flush();
  await five.get("boot-from-github").click();
  await flush();
  assert.equal(five.panel().querySelectorAll('[role="radio"]').length, 5);
  assert.equal(five.panel().querySelector(".boot-filter").hidden, true, "five projects need no search");

  const env = environment(bridge({ pcSetupRepos: async () => ({ ok: true, repos }) }).api);
  env.startup.choose();
  await flush();
  await env.get("boot-from-github").click();
  await flush();
  const search = env.panel().querySelector("#boot-repo-filter");
  const rows = () => env.panel().querySelectorAll('[role="radio"]');
  assert.equal(rows().length, 7);
  assert.equal(search.attrs["aria-label"], "Search your GitHub projects");
  search.value = " MAP ";
  await search.fire("input");
  assert.deepEqual(rows().map((row) => row.hidden), [true, true, false, true, true, true, true], "the words match the name or the description");
  await rows()[2].click();
  search.value = "field";
  await search.fire("input");
  assert.deepEqual(rows().map((row) => row.hidden), [true, true, true, true, false, true, true]);
  assert.equal(env.button(env.panel(), "Download and open").disabled, false, "a pick the search hides is still the pick");
  assert.equal(env.startup.navigateProjects("ArrowDown"), true);
  assert.equal(rows()[4].attrs["aria-checked"], "true", "the arrows walk only what shows");
  search.value = "zzz";
  await search.fire("input");
  const none = env.panel().querySelectorAll("p").find((line) => line.textContent === "No GitHub projects match your search.");
  assert.equal(none.hidden, false, "a search nothing matches says so");
  search.value = "";
  await search.fire("input");
  assert.equal(rows().every((row) => !row.hidden), true);
  assert.equal(none.hidden, true, "clearing the search clears the message");
  assert.equal(env.panel().querySelector(".boot-filter").hidden, false, "seven projects earn the search field");
});

test("Get from GitHub: a cancelled folder dialog says nothing, a refusal is red, and a sign-in is offered when the list is refused", async () => {
  const answers = [{ canceled: true, ok: false }, { ok: false, error: "That drive is exFAT. Git cannot keep separate worktrees there; choose a folder on an NTFS drive." }];
  const { api, calls } = bridge({
    pcSetupRepos: async () => { calls.push(["repos"]); return { ok: true, repos: [{ repo: "me/alpha-two", private: true, description: "", updatedAt: "" }] }; },
    pcSetupClone: async (repo) => { calls.push(["clone", repo]); return answers.shift(); },
  });
  const env = environment(api);
  env.startup.choose();
  await flush();
  await env.get("boot-from-github").click();
  await flush();
  await env.panel().querySelector('[role="radio"]').click();
  const go = env.button(env.panel(), "Download and open");
  await go.click();
  await flush();
  assert.equal(env.note().textContent, "", "a cancelled dialog changes nothing and says nothing");
  assert.equal(go.disabled, false, "the controls are back");
  await go.click();
  await flush();
  assert.equal(env.note().textContent, "That drive is exFAT. Git cannot keep separate worktrees there; choose a folder on an NTFS drive.");
  assert.equal(env.note().classList.contains("error"), true);
  assert.equal(env.panel().hidden, false, "the panel stays so another project can be picked");
  assert.equal(calls.some(([name]) => name === "choose"), false, "nothing opens when nothing was downloaded");

  const signedOut = bridge({
    pcSetupRepos: async () => { signedOut.calls.push(["repos"]); return { ok: false, error: "Could not list your GitHub repositories. Sign in to GitHub first." }; },
    pcSetupAction: async (action) => { signedOut.calls.push(["action", action]); return { ok: true, launched: true, message: "Finish in the setup window, then choose Check again." }; },
  });
  const out = environment(signedOut.api);
  out.startup.choose();
  await flush();
  await out.get("boot-from-github").click();
  await flush();
  assert.match(out.panel().textContent, /Sign in to GitHub first\. Your projects there will be listed here\./);
  assert.match(out.panel().textContent, /Studio never sees your password or token\./);
  assert.equal(out.panel().querySelectorAll('[role="radio"]').length, 0);
  await out.button(out.panel(), "Sign in to GitHub").click();
  await flush();
  assert.deepEqual(plain(signedOut.calls.filter(([name]) => name === "action")), [["action", "github-login"]], "it names the setup checklist's own action, never a command");
  assert.equal(out.note().textContent, "Finish in the setup window, then choose Check again.");
  await out.button(out.panel(), "Check again").click();
  await flush();
  assert.equal(signedOut.calls.filter(([name]) => name === "repos").length, 2, "checking again asks again");

  const other = bridge({ pcSetupRepos: async () => ({ ok: false, error: "GitHub's answer could not be read." }) });
  const bad = environment(other.api);
  bad.startup.choose();
  await flush();
  await bad.get("boot-from-github").click();
  await flush();
  assert.match(bad.panel().textContent, /GitHub's answer could not be read\./);
  assert.equal(bad.button(bad.panel(), "Sign in to GitHub"), null, "only a missing sign-in offers one");
  assert.ok(bad.button(bad.panel(), "Try again"));
});

test("Get from GitHub: a download main did not register stays in the list to open by hand, and Cancel returns to the list", async () => {
  const { api } = bridge({
    pcSetupRepos: async () => ({ ok: true, repos: [{ repo: "me/alpha-two", private: false, description: "", updatedAt: "" }] }),
    pcSetupClone: async () => ({ ok: true, folder: "C:/Code/elsewhere" }),
  });
  const env = environment(api);
  env.startup.choose();
  await flush();
  await env.get("boot-from-github").click();
  await flush();
  await env.panel().querySelector('[role="radio"]').click();
  await env.button(env.panel(), "Download and open").click();
  await flush();
  assert.equal(env.note().textContent, "Got me/alpha-two. Choose it in the list, then Open.");
  assert.equal(env.panel().hidden, true);
  assert.equal(env.get("boot-open").disabled, false);

  await env.get("boot-from-github").click();
  await flush();
  await env.button(env.panel(), "Cancel").click();
  assert.equal(env.panel().hidden, true);
  assert.equal(env.get("boot-projects").hidden, false);
  assert.equal(env.get("boot-title").textContent, "Choose a project", "the card's heading comes back with the list");
  assert.equal(env.get("boot-detail").textContent, "Pick a project to work on, or add one below.");
  assert.equal(env.get("boot-from-github").focused, true);
  assert.equal(env.startup.navigateProjects("ArrowDown"), true, "the list's keys work again");
});

test("panels lock with the screen while the host works, and an empty launch offers the same two panels", async () => {
  const pending = deferred();
  const { api } = bridge({ projectsCreate: async () => pending.promise });
  const env = environment(api);
  env.startup.choose();
  await flush();
  await env.get("boot-new-app").click();
  const name = env.panel().querySelector("#boot-new-name");
  name.value = "Notes";
  const submitting = env.panel().querySelector("#boot-new-form").fire("submit");
  await flush();
  for (const control of [name, env.panel().querySelector("#boot-new-about"), env.button(env.panel(), "Making it…"), env.button(env.panel(), "Cancel"), env.get("boot-open"), env.get("boot-start-agents")]) assert.equal(control.disabled, true);
  await env.button(env.panel(), "Cancel").click();
  assert.equal(env.panel().hidden, false, "a locked panel does not close under the host");
  pending.resolve({ ok: false, projects: [projectA, projectB], activeId: projectB.id, error: "Give the new app a name." });
  await submitting;
  await flush();
  assert.equal(name.disabled, false);

  const empty = environment(bridge({ startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [], activeId: null }) }).api);
  empty.startup.choose();
  await flush();
  await empty.get("boot-new-app").click();
  assert.equal(empty.panel().hidden, false);
  assert.equal(empty.get("boot-go").hidden, true, "the first-launch buttons give way to the panel too");
  await empty.button(empty.panel(), "Cancel").click();
  assert.equal(empty.get("boot-go").hidden, false);
  assert.equal(empty.get("boot-new-app").className, "primary boot-add");
});

// A control that locks under the keyboard drops focus to the page; when the
// action ends and the screen stays up, the person is put back where they were.
test("a refused, failed or cancelled action that leaves the screen up gives focus back", async () => {
  const refused = environment(bridge({ startupChoose: async () => ({ ok: false, error: "Finish or stop the 2 running build(s) before switching projects.", projects: [projectA, projectB], activeId: projectB.id }) }).api);
  refused.startup.choose();
  await flush();
  refused.rows()[1].focused = false;
  await refused.get("boot-open").click();
  await flush();
  assert.equal(refused.rows()[1].focused, true, "a refused Open puts focus back on the selected row");

  const failing = environment(bridge({ projectsCreate: async () => ({ ok: false, projects: [projectA, projectB], activeId: projectB.id, error: "Choose another name." }) }).api);
  failing.startup.choose();
  await flush();
  await failing.get("boot-new-app").click();
  const name = failing.panel().querySelector("#boot-new-name");
  name.value = "Notes";
  name.focused = false;
  await failing.panel().querySelector("#boot-new-form").fire("submit");
  await flush();
  assert.equal(name.focused, true, "a refused new app puts focus back in the name field");

  const cancelled = environment(bridge({
    pcSetupRepos: async () => ({ ok: true, repos: [{ repo: "me/alpha-two", private: true, description: "", updatedAt: "" }] }),
    pcSetupClone: async () => ({ ok: false, canceled: true }),
  }).api);
  cancelled.startup.choose();
  await flush();
  await cancelled.get("boot-from-github").click();
  await flush();
  const radio = cancelled.panel().querySelector('[role="radio"]');
  await radio.click();
  radio.focused = false;
  await cancelled.button(cancelled.panel(), "Download and open").click();
  await flush();
  assert.equal(radio.focused, true, "a cancelled folder dialog puts focus back on the pick");
});

test("a filter cannot hide the pick: Open waits when nothing matches, and a project just added or made clears the filter", async () => {
  const many = Array.from({ length: 6 }, (_, index) => ({ id: `project_${index}`, name: `App ${index}`, path: `C:/p/app${index}` }));
  const zed = { id: "project_zed", name: "Zed", path: "C:/p/zed" };
  const env = environment(bridge({ ...launching(null, many, "project_0"), projectsAdd: async () => ({ ok: true, projects: [...many, zed], activeId: "project_0", addedId: zed.id }) }).api);
  env.startup.choose();
  await flush();
  const filter = env.get("boot-filter");
  filter.value = "zzz";
  await filter.fire("input");
  assert.equal(env.get("boot-open").disabled, true, "with nothing showing, nothing is opened blind");
  filter.value = "app 3";
  await filter.fire("input");
  assert.equal(env.selected(), "project_3");
  assert.equal(env.get("boot-open").disabled, false, "a match brings Open back");
  await env.get("boot-add-project").click();
  await flush();
  assert.equal(filter.value, "", "the filter typed before the folder was added is cleared");
  assert.equal(env.selected(), zed.id, "the folder just added is the pick");
  assert.equal(env.wrappers().every((wrap) => !wrap.hidden), true, "and every row shows again");

  const made = { id: "project_made", name: "Field Notes", path: "C:/Users/x/Mefi Apps/field-notes" };
  const opened = [];
  const creating = environment(bridge({
    ...launching(null, many, "project_0"),
    projectsCreate: async () => ({ ok: true, projects: [...many, made], activeId: made.id, addedId: made.id, selectedId: made.id }),
    startupChoose: async (id) => { opened.push(id); return { ok: true, projects: [...many, made], activeId: id }; },
  }).api);
  const choice = creating.startup.choose();
  await flush();
  const search = creating.get("boot-filter");
  search.value = "app 2";
  await search.fire("input");
  await creating.get("boot-new-app").click();
  creating.panel().querySelector("#boot-new-name").value = "Field Notes";
  await creating.panel().querySelector("#boot-new-form").fire("submit");
  await flush();
  assert.deepEqual(opened, [made.id], "the app that was made opens, not the row the filter still showed");
  assert.equal(plain(await choice).projectId, made.id);
});
