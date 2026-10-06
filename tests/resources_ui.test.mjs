// renderer/resources.js (Team › Resources) in a vm with a small DOM and a fake
// bridge: opening takes a watch lease and reads the picture; the rows, the
// Manual | Auto switch, each app's buttons (End needs a second press) and its
// rule, Make room now and Restore all, the settings, a push repainting, the
// filter and sort, auto mode's toasts while the page is closed, and closing
// giving the lease back. Then the wiring around it: every element the script
// asks for is in the template, the registry record, the build inventory, the
// bridge and main's channels, and the status bar opening it.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const source = await read("renderer/resources.js");
const template = await read("renderer/booklet.template.html");
const navSource = await read("renderer/nav.js");
const shellSource = await read("renderer/shell.js");
const builder = await read("scripts/build-booklet.mjs");
const preload = await read("preload.cjs");
const main = await read("main.cjs");
const flush = async () => { for (let i = 0; i < 60; i += 1) await Promise.resolve(); };
// Objects made inside the vm have its own prototypes: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- a small DOM ----------------------------------------------------------------------
class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; this.value = ""; this.id = "";
    this.type = ""; this.title = ""; this.checked = false; this.selected = false; this.tabIndex = 0; this.style = {}; this.parentElement = null;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  get childNodes() { return this.children.slice(); }
  get options() { return this.children.filter((child) => child.tagName === "OPTION"); }
  append(...children) {
    for (const child of children) {
      if (!child || typeof child !== "object") continue;
      if (child.tagName === "#FRAGMENT") { this.append(...child.children); continue; }
      child.parentElement?.children && (child.parentElement.children = child.parentElement.children.filter((item) => item !== child));
      child.parentElement = this;
      this.children.push(child);
    }
    if (this.tagName === "SELECT") { const picked = this.options.find((option) => option.selected) ?? this.options[0]; if (picked) this.value = picked.value; }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  toggleAttribute(key, on) { if (on) this.attrs[key] = ""; else delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  dispatch(type, extra = {}) {
    // Bubbles from the target up, like the page's delegated listeners expect.
    const event = { type, target: this, preventDefault() { this.prevented = true; }, ...extra };
    for (let node = this; node; node = node.parentElement) for (const listener of node.listeners[type] ?? []) listener(event);
    return event;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { doc.activeElement = this; }
  matches(selector) {
    return selector.split(",").some((part) => {
      const match = /^\s*([a-z]*)((?:\[[a-z-]+\])*)\s*$/i.exec(part);
      if (!match) return false;
      if (match[1] && match[1].toUpperCase() !== this.tagName) return false;
      for (const [, attr] of match[2].matchAll(/\[([a-z-]+)\]/gi)) {
        const key = attr.startsWith("data-") ? attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
        if (key ? !(key in this.dataset) : !(attr in this.attrs)) return false;
      }
      return true;
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches?.(selector)) return node; return null; }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
  contains(node) { return this.all().includes(node); }
  buttons(label) { return this.all().filter((node) => node.tagName === "BUTTON" && node.textContent === label); }
}
let doc = null;

// The page's fixed elements, as the template has them (checked against the template below).
const IDS = ["overlay", "close", "body", "modes", "mode-manual", "mode-auto", "mode-note", "headline", "problem", "meters", "tools", "focus", "restore", "filter", "sort-memory", "sort-cpu", "sort-name", "suggest", "list", "more", "left", "settings", "settings-body", "log-box", "log"];

function page() {
  const nodes = new Map();
  const make = (id, tag = "div") => { const node = new Node(tag); node.id = `resources-${id}`; nodes.set(node.id, node); return node; };
  const overlay = make("overlay");
  overlay.hidden = true;
  const body = make("body");
  overlay.append(make("close", "button"), body);
  const modes = make("modes");
  const manual = make("mode-manual", "button"); manual.dataset.mode = "manual";
  const auto = make("mode-auto", "button"); auto.dataset.mode = "auto";
  modes.append(manual, auto);
  const tools = make("tools");
  tools.append(make("focus", "button"), make("restore", "button"), make("filter", "input"), make("sort-memory", "button"), make("sort-cpu", "button"), make("sort-name", "button"));
  const settings = make("settings", "details");
  settings.append(make("settings-body"));
  const logBox = make("log-box", "details");
  logBox.append(make("log", "ol"));
  body.append(modes, make("mode-note", "p"), make("headline", "p"), make("problem", "p"), make("meters"), tools, make("suggest"), make("list", "ol"), make("more", "button"), make("left", "section"), settings, logBox);
  return nodes;
}

const app = (key, name, extra = {}) => ({
  key, name, kind: null, kindLabel: null, count: 1, cpu: 1, memMB: 100, title: null, foreground: false, kept: 0, protected: null, keptWhy: null,
  paused: "none", slowed: "none", frozen: false, hold: { slow: null, pause: null }, rule: "auto", ruleSet: false, ...extra,
});
function view(extra = {}) {
  const apps = [
    app("msedge", "Microsoft Edge", { kind: "browser", kindLabel: "Browser", count: 30, cpu: 4.2, memMB: 2100, title: "News - Edge" }),
    app("discord", "Discord", { kind: "call", kindLabel: "Calls", count: 6, memMB: 650, rule: "leave", title: "Discord" }),
    app("code", "Visual Studio Code", { memMB: 600, foreground: true, title: "main.cjs" }),
    app("steam", "Steam", { memMB: 400, hold: { slow: null, pause: { by: "auto", at: 1 } }, paused: "all", rule: "pause", ruleSet: true }),
    app("admintool", "AdminTool", { memMB: 90, protected: { code: "hidden", why: "Windows won't tell Studio which program it is, so Studio leaves it alone." } }),
    ...Array.from({ length: 12 }, (_, i) => app(`small${i}`, `Small ${i}`, { memMB: 50 - i, cpu: i })),
  ];
  return {
    ok: true, supported: true, reason: "", error: null, mode: "manual", level: "manual",
    headline: "Manual: Studio changes nothing until you press a button.",
    machine: { cpu: 41, totalMB: 14336, freeMB: 900, usedPct: 94, commitPct: 70 },
    building: { active: true, running: 2, waiting: false },
    studio: { count: 9, cpu: 12, memMB: 1900 }, windows: { count: 180, cpu: 3, memMB: 3200 }, kept: { count: 2, cpu: 0, memMB: 20 },
    apps, short: null, suggest: [], snoozed: false,
    log: [{ at: Date.now() - 5000, text: "Paused Steam (its rule says pause it while agents build)", by: "auto", ok: true, key: "steam", op: "pause" }],
    prefs: { mode: "manual", rules: { steam: "pause" }, keepFreeMB: 2048, heavyCpuPct: 10, heavyMemMB: 500, trimWhenShort: true, restoreAfterSec: 60, notify: true },
    at: 1, ...extra,
  };
}

function environment({ state = view(), answers = {} } = {}) {
  const nodes = page();
  const calls = [];
  const toasts = [];
  const went = [];
  const listeners = {};
  let current = state;
  const timers = [];
  doc = {
    readyState: "complete", hidden: false, activeElement: null,
    getElementById: (id) => nodes.get(id) ?? null,
    createElement: (tag) => new Node(tag),
    createDocumentFragment: () => new Node("#fragment"),
    addEventListener() {},
  };
  const api = {
    resourcesState: async () => { calls.push(["state"]); return current; },
    resourcesWatch: async (payload) => { calls.push(["watch", plain(payload)]); return { ok: true }; },
    resourcesAct: async (key, op) => { calls.push(["act", key, op]); return answers.act ?? { ok: true, text: `${op} ${key}` }; },
    resourcesRestoreAll: async () => { calls.push(["restore-all"]); return { ok: true, restored: 3 }; },
    resourcesSet: async (patch) => { calls.push(["set", plain(patch)]); return { ok: true, prefs: {} }; },
    onResources: (fn) => { listeners.update = fn; },
    onResourcesActed: (fn) => { listeners.acted = fn; },
  };
  const window = {
    mefiStudio: api,
    MefiNav: { go: (...args) => went.push(args), claim() {}, release() {}, close: () => undefined },
    MefiToast: (text, kind, options) => toasts.push({ text, kind, options }),
  };
  const context = vm.createContext({
    window, document: doc, Date, Number, Array, Set, Map, Promise, JSON, Object, String, Math, RegExp, Boolean,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: (fn, ms) => { timers.push({ fn, ms, every: true }); return timers.length; }, clearInterval() {},
    requestAnimationFrame: (fn) => fn(),
  });
  vm.runInContext(source, context);
  const $ = (id) => nodes.get(`resources-${id}`);
  return {
    window, nodes, $, calls, toasts, went, timers, listeners,
    resources: window.MefiResources,
    set: (next) => { current = next; },
    row: (key) => $("list").children.find((item) => item.dataset.key === key) ?? null,
    keys: () => $("list").children.map((item) => item.dataset.key).filter(Boolean),
  };
}

test("opening takes a lease, reads the picture and draws the headline, the meters, and the heaviest apps first", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  assert.deepEqual(env.calls.slice(0, 2).map((call) => call[0]).sort(), ["state", "watch"]);
  assert.deepEqual(env.calls.find((call) => call[0] === "watch")[1], { id: "resources-page", on: true });
  assert.equal(env.$("overlay").hidden, false);
  assert.equal(env.$("headline").textContent, "Manual: Studio changes nothing until you press a button.");
  const meters = env.$("meters").textContent;
  assert.match(meters, /CPU41%/);
  assert.match(meters, /Memory13 GB of 14 GB/);
  assert.match(meters, /900 MB free/);
  assert.match(meters, /Studio and its agents1\.9 GB/);
  assert.match(meters, /Agents2 building/);
  // The twelve heaviest apps, plus any held or in use; what Studio never touches goes under the rest.
  const keys = env.keys();
  assert.equal(keys[0], "msedge");
  assert.ok(keys.includes("steam") && keys.includes("code"));
  assert.equal(keys.length, 12);
  assert.ok(!keys.includes("admintool"));
  assert.equal(env.$("more").hidden, false);
  assert.equal(env.$("more").textContent, "Show all 17 apps");
  env.$("more").click();
  assert.equal(env.keys().length, 17);
  assert.equal(env.keys().at(-1), "admintool", "a protected app sits under the ones Studio may touch");
  assert.match(env.$("left").textContent, /Studio and its agents: 1\.9 GB in 9 processes/);
  assert.match(env.$("log").textContent, /Paused Steam/);
  assert.equal(env.$("mode-manual").getAttribute("aria-checked"), "true");
});

test("each app says what it is and what Studio holds, and its buttons send one action by key", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  const edge = env.row("msedge");
  assert.match(edge.textContent, /Microsoft Edge/);
  assert.match(edge.textContent, /Browser/);
  assert.match(edge.textContent, /30 processes/);
  assert.match(edge.textContent, /News - Edge/);
  assert.match(edge.textContent, /4\.2%/);
  assert.match(edge.textContent, /2\.1 GB/);
  assert.deepEqual(edge.all().filter((node) => node.tagName === "BUTTON").map((node) => node.textContent), ["Slow down", "Pause", "Free memory", "Close", "End"]);
  edge.buttons("Slow down")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "act"), ["act", "msedge", "slow"]);
  assert.match(env.row("msedge").textContent, /slow msedge/, "the answer shows under the row");
  // Steam is paused by auto: it offers Put back, not Pause.
  const steam = env.row("steam");
  assert.match(steam.textContent, /Paused by auto/);
  assert.deepEqual(steam.all().filter((node) => node.tagName === "BUTTON").map((node) => node.textContent), ["Put back", "Slow down", "Free memory", "Close", "End"]);
  // The app in front of you cannot be paused from here.
  const code = env.row("code");
  assert.match(code.textContent, /In use/);
  assert.equal(code.buttons("Pause")[0].disabled, true);
  // A protected app says why and has no buttons.
  env.$("more").click();
  const admin = env.row("admintool");
  assert.match(admin.textContent, /Windows won't tell Studio which program it is/);
  assert.equal(admin.all().filter((node) => node.tagName === "BUTTON").length, 0);
});

test("End needs a second press", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  env.row("msedge").buttons("End")[0].click();
  await flush();
  assert.equal(env.calls.filter((call) => call[0] === "act").length, 0);
  assert.equal(env.row("msedge").buttons("End: click again").length, 1);
  env.row("msedge").buttons("End: click again")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "act"), ["act", "msedge", "end"]);
});

test("an app's rule, the mode and the settings each save through resourcesSet", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  const pick = env.row("msedge").all().find((node) => node.tagName === "SELECT");
  assert.deepEqual(pick.options.map((option) => option.value), ["auto", "leave", "slow", "pause", "close"]);
  assert.equal(pick.value, "auto");
  assert.equal(env.row("discord").all().find((node) => node.tagName === "SELECT").options[0].textContent, "Auto decides (leave it alone)", "a call app's default says so");
  assert.equal(env.row("steam").all().find((node) => node.tagName === "SELECT").value, "pause");
  pick.value = "pause";
  pick.dispatch("change");
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "set")[1], { rule: { app: "msedge", value: "pause" } });
  env.$("mode-auto").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "set").at(-1)[1], { mode: "auto" });
  const keep = env.$("settings-body").all().find((node) => node.dataset.pref === "keepFreeMB");
  assert.equal(keep.value, "2048");
  // MefiPatch carries a choice by its markup: the chosen option and an on switch carry the attribute.
  assert.deepEqual(keep.options.filter((option) => option.getAttribute("selected") !== null).map((option) => option.value), ["2048"]);
  assert.deepEqual(env.row("steam").all().filter((node) => node.tagName === "OPTION" && node.getAttribute("selected") !== null).map((option) => option.value), ["pause"]);
  assert.equal(env.$("settings-body").all().find((node) => node.dataset.pref === "notify").getAttribute("checked"), "");
  keep.value = "3072";
  keep.dispatch("change");
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "set").at(-1)[1], { keepFreeMB: 3072 });
  const notify = env.$("settings-body").all().find((node) => node.dataset.pref === "notify");
  notify.checked = false;
  notify.dispatch("change");
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "set").at(-1)[1], { notify: false });
});

test("Make room now and Restore all go to the host and say what happened", async () => {
  const env = environment({ answers: { act: { ok: true, text: "Made room: 2 changes to background apps." } } });
  env.resources.open();
  await flush();
  env.$("focus").click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "act"), ["act", "", "focus"]);
  assert.equal(env.toasts.at(-1).text, "Made room: 2 changes to background apps.");
  assert.equal(env.$("restore").disabled, false, "something is held");
  env.$("restore").click();
  await flush();
  assert.ok(env.calls.some((call) => call[0] === "restore-all"));
  assert.equal(env.toasts.at(-1).text, "Put back 3 processes.");
});

test("a push repaints in place; the filter and the sort change what is listed", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  const next = view({ headline: "Agents are building, so Studio is making room.", mode: "auto", level: "focus" });
  next.apps = next.apps.map((entry) => (entry.key === "msedge" ? { ...entry, hold: { slow: { by: "auto", at: 2 }, pause: null }, slowed: "all" } : entry));
  env.listeners.update(next);
  assert.equal(env.$("headline").textContent, "Agents are building, so Studio is making room.");
  assert.match(env.row("msedge").textContent, /Slowed by auto/);
  assert.equal(env.$("mode-auto").getAttribute("aria-checked"), "true");
  env.$("filter").value = "disc";
  env.$("filter").dispatch("input");
  assert.deepEqual(env.keys(), ["discord"]);
  env.$("filter").value = "";
  env.$("filter").dispatch("input");
  env.$("sort-cpu").click();
  assert.equal(env.keys()[0], "small11", "the busiest CPU first");
  assert.equal(env.$("sort-cpu").getAttribute("aria-pressed"), "true");
});

test("short of memory in auto mode, the page offers what pausing would free, and both offers act", async () => {
  const env = environment({ state: view({ mode: "auto", short: { freeMB: 600, wantMB: 2048 }, suggest: [{ key: "msedge", freesMB: 2100, name: "Microsoft Edge" }] }) });
  env.resources.open();
  await flush();
  const box = env.$("suggest");
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /600 MB free, 2\.0 GB wanted/);
  assert.match(box.textContent, /Microsoft Edge · about 2\.1 GB/);
  box.buttons("Pause it now")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "act"), ["act", "msedge", "pause"]);
  box.buttons("Always pause it while building")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "set").at(-1)[1], { rule: { app: "msedge", value: "pause" } });
});

test("auto mode's actions become one toast while the page is closed, with Open and Put back; none when you turned them off", async () => {
  const env = environment();
  env.listeners.acted({ at: 1, text: "Slowed down Microsoft Edge", by: "auto", ok: true, key: "msedge", op: "slow", notify: true });
  env.listeners.acted({ at: 2, text: "Paused Steam", by: "auto", ok: true, key: "steam", op: "pause", notify: true });
  env.listeners.acted({ at: 3, text: "you did this", by: "you", ok: true, key: "x", notify: true });
  const due = env.timers.filter((timer) => !timer.every);
  assert.equal(due.length, 1, "one toast for the batch");
  due[0].fn();
  assert.equal(env.toasts.length, 1);
  assert.equal(env.toasts[0].text, "Auto mode made room: Slowed down Microsoft Edge; Paused Steam.");
  env.toasts[0].options.action.run();
  assert.deepEqual(env.went.at(-1), ["resources"]);
  assert.equal(env.toasts[0].options.secondary, null, "two apps: no single Put back");
  const quiet = environment();
  quiet.listeners.acted({ at: 1, text: "Slowed down Edge", by: "auto", ok: true, key: "msedge", notify: false });
  assert.equal(quiet.timers.filter((timer) => !timer.every).length, 0);
  const one = environment();
  one.listeners.acted({ at: 1, text: "Paused Steam", by: "auto", ok: true, key: "steam", notify: true });
  one.timers.find((timer) => !timer.every).fn();
  one.toasts[0].options.secondary.run();
  await flush();
  assert.deepEqual(one.calls.find((call) => call[0] === "act"), ["act", "steam", "restore"]);
});

test("closing gives the lease back; a PC where it does not run hides the controls and says why", async () => {
  const env = environment();
  env.resources.open();
  await flush();
  env.resources.close();
  await flush();
  assert.equal(env.$("overlay").hidden, true);
  assert.deepEqual(env.calls.filter((call) => call[0] === "watch").at(-1)[1], { id: "resources-page", on: false });
  const mac = environment({ state: view({ supported: false, headline: "The resource manager works on Windows for now.", apps: [], machine: null }) });
  mac.resources.open();
  await flush();
  assert.equal(mac.$("headline").textContent, "The resource manager works on Windows for now.");
  assert.equal(mac.$("tools").hidden, true);
  assert.equal(mac.$("settings").hidden, true);
});

// ---- the wiring around the page --------------------------------------------------------
test("every element the page asks for is in the template, inside the Resources overlay", () => {
  const start = template.indexOf('<div class="overlay explorer" id="resources-overlay" hidden>');
  const end = template.indexOf('<div class="overlay explorer" id="skills-overlay" hidden>');
  assert.ok(start > 0 && end > start);
  const markup = template.slice(start, end);
  const asked = new Set([...source.matchAll(/\$\("([a-z-]+)"\)/g)].map((match) => match[1]));
  for (const id of IDS) asked.add(id);
  for (const id of asked) assert.ok(markup.includes(`id="resources-${id}"`), `the template has #resources-${id}`);
  assert.match(markup, /<summary>How it works<\/summary>/, "the manual is on the page");
});

test("the registry, the build, the bridge, main's channels and the status bar all know the page", () => {
  assert.match(navSource, /id: "resources",[\s\S]{0,400}section: "agents",[\s\S]{0,700}element: "resources-overlay"/);
  assert.match(navSource, /agents: \["agents", "command", "fleet", "resources",/);
  assert.match(navSource, /const WORKSPACE_PAGES = new Set\(\[[^\]]*"resources"/);
  assert.match(navSource, /id: "resources-focus",[\s\S]{0,600}window\.MefiResources\?\.focusNow/);
  assert.match(builder, /"worktrees\.js",\n {4}"resources\.js",/);
  assert.match(builder, /"worktrees\.css",\n {4}"resources\.css",/);
  for (const [method, channel] of [["resourcesState", "resources:state"], ["resourcesWatch", "resources:watch"], ["resourcesAct", "resources:act"], ["resourcesRestoreAll", "resources:restore-all"], ["resourcesSet", "resources:set"]]) {
    assert.match(preload, new RegExp(`${method}: \\([^)]*\\) => ipcRenderer\\.invoke\\("${channel}"`));
    assert.ok(main.includes(`ipcMain.handle("${channel}"`), `main handles ${channel}`);
  }
  assert.match(preload, /onResources: \(callback\) => ipcRenderer\.on\("resources:update"/);
  assert.match(preload, /onResourcesActed: \(callback\) => ipcRenderer\.on\("resources:acted"/);
  assert.match(main, /if \(channel === "resources:update"\) send\("resources:update", payload\);\n\s+else if \(channel === "resources:acted"\) send\("resources:acted", payload\);/);
  assert.match(shellSource, /if \(n\?\.get\?\.\("resources"\)\) n\.go\?\.\("resources"\);/);
  // A test, capture or command-line launch never starts the helper.
  assert.match(main, /SMOKE \|\| CAPTURE \|\| CLI_MODE \? "The resource manager does not run in a test, capture or command-line launch\." : null/);
  assert.match(main, /if \(typeof resourceHostLoaded !== "undefined" && resourceHostLoaded\) resourceHostLoaded\.quit\(\);/);
  // Loaded on first use, never while Studio starts; its page's picture waits while the window is hidden.
  assert.doesNotMatch(main, /^const resourceHost = \(\(\) => \{/m);
  assert.match(main, /function resourceHostGet\(\) \{\n  if \(resourceHostLoaded !== undefined\) return resourceHostLoaded;/);
  assert.match(main, /const HELD_WHILE_HIDDEN = new Set\(\[[^\]]*"resources:update"\]\);/);
});
