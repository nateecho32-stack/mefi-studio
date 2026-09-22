import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/onboarding.js", import.meta.url), "utf8");
const navSource = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const KEY = "mefiStudio.walkthrough.v2";
const LEGACY_KEY = "mefiStudio.walkthrough.v1";
// Stop order: Scan, Your workspace, First map, Connections, Create, Monitor, Review.
const STOPS = 7;
const SCAN = 0, WORKSPACE = 1, MAP = 2, CONNECT = 3, CREATE = 4, MONITOR = 5, REVIEW = 6;
const allDone = (...indexes) => Array.from({ length: STOPS }, (_, index) => indexes.includes(index));

function environment(storage = new Map(), { storageDenied = false, host = null } = {}) {
  const elements = new Map(); const routes = []; const claims = []; const releases = []; const listeners = new Map();
  let document;
  class Element {
    constructor(tag = "div") { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.clicks = 0; const classes = new Set(); this.classList = { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), contains: (name) => classes.has(name), toggle() {} }; }
    set textContent(value) { this.copy = String(value); this.children = []; }
    get textContent() { return (this.copy || "") + this.children.map((item) => item.textContent).join(""); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    append(...children) { for (const item of children) { this.children.push(item); item.parent = this; } }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    emit(type, event = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, ...event }); }
    click() { if (!this.disabled) { this.clicks++; this.emit("click"); } }
    focus() { document.activeElement = this; }
    closest(selector) { if (selector === "[hidden]") return this.hidden ? this : this.parent?.closest(selector); return null; }
    querySelectorAll(selector) {
      const all = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
      if (selector === "*") return all;
      if (selector.includes("button")) return all.filter((item) => item.tag === "button" && !item.disabled);
      return [];
    }
  }
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const el = (name) => get(`walkthrough-${name}`);
  const query = (selector) => get(`query:${selector}`);
  document = { activeElement: null, readyState: "loading", body: new Element(), getElementById: get,
    createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    querySelector: query, querySelectorAll: () => [], addEventListener() {},
  };
  for (const id of ["back", "next", "action", "secondary", "dismiss", "scan-run", "scan-apply", "map-run", "map-cancel"]) el(id).tag = "button";
  el("overlay").hidden = true;
  el("coach").hidden = true;
  el("sheet").append(el("steps"), el("action"), el("secondary"), el("back"), el("next"));
  el("overlay").append(el("sheet"));
  const window = {
    MefiNav: { go: (id) => routes.push(id), claim: (id) => claims.push(id), release: (id) => releases.push(id) },
    // The guide may never invoke a provider, project writer or task API by
    // reading or navigating; only the scan and map buttons reach the host,
    // and they do so through an explicitly supplied bridge.
    mefiStudio: host ?? new Proxy({}, { get() { throw new Error("walkthrough touched host API"); } }),
    addEventListener(type, fn) { const list = listeners.get(type) ?? []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { const list = listeners.get(type) ?? []; const at = list.indexOf(fn); if (at >= 0) list.splice(at, 1); },
    dispatchEvent() {},
  };
  const context = vm.createContext({ window, document, localStorage: {
    getItem: (key) => { if (storageDenied) throw new Error("storage unavailable"); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (storageDenied) throw new Error("storage unavailable"); storage.set(key, value); },
  }, URLSearchParams, setTimeout, clearTimeout, console });
  vm.runInContext(source, context);
  window.MefiOnboarding.init();
  function emit(type, event = {}) {
    for (const fn of [...(listeners.get(type) || [])]) fn({ type, target: null, preventDefault() {}, stopPropagation() {}, ...event });
  }
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { guide: window.MefiOnboarding, el, get, query, routes, claims, releases, storage, document, context, emit, settle };
}

test("first launch opens the guide once, at the scan stop, and closing it keeps the saved guide available", () => {
  const env = environment();
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.guide.startup(), true);
  assert.equal(env.el("overlay").hidden, false);
  assert.match(env.el("title").textContent, /scan this computer/i);
  assert.equal(env.el("scan").hidden, false);
  assert.equal(env.el("map").hidden, true);
  assert.equal(env.el("action").hidden, true, "a panel stop has no menu to walk to");
  assert.deepEqual(env.claims, ["onboarding"]);
  assert.equal(JSON.parse(env.storage.get(KEY)).status, "reading");
  assert.equal(env.guide.startup(), false);
  env.guide.close();
  const reloaded = environment(env.storage);
  assert.equal(reloaded.guide.startup(), false);
  assert.equal(reloaded.el("overlay").hidden, true);
  assert.equal(reloaded.el("invitation").hidden, false);
});

test("the workspace and create stops offer the saved build choice and only an explicit toggle writes it", async () => {
  const env = environment(); const calls = []; let autoBuild = true;
  env.context.window.MefiWorkspace = {
    buildMode: () => ({ autoBuild, loaded: true, saving: false }),
    setAutoBuild: async (value) => { calls.push(value); autoBuild = value; return { message: "Build preference saved" }; },
  };
  env.guide.startup();
  assert.equal(env.el("build-mode").hidden, true);
  env.el("next").click();
  assert.match(env.el("title").textContent, /Welcome to Mefi/);
  assert.equal(env.el("build-mode").hidden, false);
  assert.equal(env.el("auto-build").checked, true);
  assert.equal(env.el("auto-build").disabled, false);
  assert.deepEqual(calls, []);
  env.el("auto-build").checked = false; env.el("auto-build").emit("change");
  await env.settle();
  assert.deepEqual(calls, [false]);
  assert.equal(env.el("build-mode-label").textContent, "Verify first");
  assert.match(env.el("build-mode-note").textContent, /Unapproved work waits/);
  env.el("next").click(); assert.equal(env.el("build-mode").hidden, true);
  env.el("next").click(); assert.equal(env.el("build-mode").hidden, true);
  env.el("next").click(); assert.equal(env.el("build-mode").hidden, false);
  assert.equal(env.el("auto-build").checked, false);
  env.context.window.MefiWorkspace.setAutoBuild = async () => { throw new Error("Saving unavailable"); };
  env.el("auto-build").checked = true; env.el("auto-build").emit("change");
  await env.settle();
  assert.equal(env.el("auto-build").checked, false);
  assert.equal(env.el("build-mode-feedback").textContent, "Saving unavailable");
});

test("dismissed and completed guides never automatically reopen but remain accessible", () => {
  const env = environment();
  assert.equal(env.el("invitation").hidden, false);
  env.el("dismiss").click();
  assert.equal(env.el("invitation").hidden, true);
  const reloaded = environment(env.storage);
  assert.equal(reloaded.guide.startup(), false);
  assert.equal(reloaded.el("invitation").hidden, true);
  reloaded.guide.open();
  assert.equal(reloaded.el("overlay").hidden, false);
  assert.match(reloaded.el("title").textContent, /scan this computer/i);
  reloaded.el("steps").children[REVIEW].click(); reloaded.el("next").click();
  const completed = environment(env.storage);
  assert.equal(completed.guide.startup(), false);
  assert.equal(completed.el("overlay").hidden, true);
});

test("capture and smoke initialization does not open or consume the first-run walkthrough", () => {
  const env = environment();
  assert.equal(env.guide.startup({ automatic: false }), false);
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.storage.has(KEY), false);
  assert.equal(env.guide.startup(), true);
});

test("lesson progress survives closing, reload and navigation without calling host APIs", () => {
  const env = environment(); env.guide.open();
  for (let i = 0; i < CREATE; i++) env.el("next").click();
  assert.match(env.el("title").textContent, /clear task/);
  env.el("action").click();
  assert.deepEqual(env.routes, ["workspace"]);
  assert.equal(env.get("workspace-mode-work").clicks, 1);
  assert.equal(env.document.activeElement, env.get("workspace-input"));
  assert.equal(env.el("overlay").hidden, true);
  assert.deepEqual(env.releases, ["onboarding"]);
  const reloaded = environment(env.storage); reloaded.guide.open();
  assert.match(reloaded.el("progress").textContent, /Step 5 of 7/);
  reloaded.el("secondary").click();
  assert.deepEqual(reloaded.routes, ["plans"]);
});

test("each menu stop's action reaches the intended control without performing the work; panel stops have none", () => {
  const env = environment();
  for (const index of [WORKSPACE, CONNECT, CREATE, MONITOR, REVIEW]) {
    env.guide.open();
    env.el("steps").children[index].click();
    assert.equal(env.el("action").hidden, false);
    env.el("action").click();
  }
  assert.deepEqual(env.routes, ["workspace", "studio", "workspace", "command", "workspace"]);
  assert.equal(env.get("workspace-add-project").clicks, 0);
  assert.equal(env.get("workspace-review").clicks, 1);
  assert.equal(env.get("workspace-send").clicks, 0);
  for (const index of [SCAN, MAP]) {
    env.guide.open();
    env.el("steps").children[index].click();
    assert.equal(env.el("action").hidden, true);
    env.el("action").click();
    assert.equal(env.el("overlay").hidden, false, "a hidden action never leaves the sheet");
  }
  assert.equal(env.routes.length, 5);
});

test("guide completion only dismisses the guide; lessons can be revisited", () => {
  const env = environment(); env.guide.open();
  env.el("steps").children[REVIEW].click(); env.el("next").click();
  assert.equal(JSON.parse(env.storage.get(KEY)).status, "complete");
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.el("invitation").hidden, true);
  assert.deepEqual(env.routes, []);
  const reloaded = environment(env.storage); reloaded.guide.open();
  reloaded.el("steps").children[0].click();
  assert.equal(reloaded.el("back").disabled, true);
  assert.match(reloaded.el("progress").textContent, /Step 1 of 7/);
});

test("walk with me stays in the corner, follows the menus, highlights the real control and hands panel stops back to the sheet", () => {
  const env = environment(); env.guide.open();
  env.el("steps").children[WORKSPACE].click();
  env.el("action").click();
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.el("coach").hidden, false);
  assert.deepEqual(env.routes, ["workspace"]);
  assert.deepEqual(env.releases, ["onboarding"]);
  assert.equal(env.get("workspace-mode-work").clicks, 0);
  assert.match(env.el("coach-progress").textContent, /Step 2 of 7 · Your workspace/);
  assert.match(env.el("coach-copy").textContent, /project menu/);
  assert.equal(env.query("#workspace-add-project").classList.contains("walkthrough-focus"), true);
  // The next stop is the map panel: the coach steps aside and the sheet opens there.
  env.el("coach-next").click();
  assert.equal(env.el("coach").hidden, true);
  assert.equal(env.el("overlay").hidden, false);
  assert.match(env.el("title").textContent, /Map the folder/);
  assert.equal(env.el("map").hidden, false);
  const saved = JSON.parse(env.storage.get(KEY));
  assert.equal(saved.done[WORKSPACE], true);
  assert.equal(saved.mode, "sheet");
  assert.equal(saved.step, MAP);
  assert.equal(env.query("#workspace-add-project").classList.contains("walkthrough-focus"), false);
  // From Connections the coach walks again.
  env.el("next").click();
  env.el("action").click();
  assert.deepEqual(env.routes, ["workspace", "studio"]);
  assert.equal(env.query("#settings-assistant-heading").classList.contains("walkthrough-focus"), true);
  assert.match(env.el("coach-progress").textContent, /Step 4 of 7 · Connections/);
  env.el("coach-back").click();
  assert.equal(env.el("coach").hidden, true);
  assert.equal(env.el("overlay").hidden, false);
  assert.match(env.el("progress").textContent, /Step 3 of 7/);
});

test("the workspace stop ticks itself off when the user actually selects a project", () => {
  const env = environment(); env.guide.open();
  env.el("steps").children[WORKSPACE].click();
  env.el("action").click();
  assert.equal(JSON.parse(env.storage.get(KEY)).done[WORKSPACE], false);
  env.emit("mefi:project-changed", { detail: {} });
  assert.equal(JSON.parse(env.storage.get(KEY)).done[WORKSPACE], false);
  env.emit("mefi:project-changed", { detail: { projectId: "alpha" } });
  const saved = JSON.parse(env.storage.get(KEY));
  assert.equal(saved.done[WORKSPACE], true);
  assert.match(env.el("coach-hint").textContent, /Project selected/);
  assert.match(env.el("coach-next").textContent, /Next stop/);
  assert.match(env.el("invite-steps").children[WORKSPACE].textContent, /✓/);
  assert.doesNotMatch(env.el("invite-steps").children[SCAN].textContent, /✓/);
});

test("the invitation can resume as a guided walk at the saved stop", () => {
  const env = environment(new Map([[KEY, JSON.stringify({ version: 2, step: CREATE, status: "reading" })]]));
  assert.match(env.el("invite-walk").textContent, /Walk with me · Create/);
  env.el("invite-walk").click();
  assert.equal(env.el("coach").hidden, false);
  assert.deepEqual(env.routes, ["workspace"]);
  assert.equal(env.get("workspace-mode-work").clicks, 1);
  assert.match(env.el("coach-progress").textContent, /Step 5 of 7 · Create/);
});

test("Escape ends the guided walk without disturbing the app around it", () => {
  const env = environment(); env.guide.open();
  env.el("steps").children[WORKSPACE].click();
  env.el("action").click();
  const event = { key: "Escape", prevented: 0, stopped: 0 };
  env.emit("keydown", { key: "Escape", preventDefault: () => event.prevented++, stopPropagation: () => event.stopped++ });
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1);
  assert.equal(env.el("coach").hidden, true);
  assert.equal(JSON.parse(env.storage.get(KEY)).mode, "idle");
  assert.match(env.el("invite-walk").textContent, /Walk with me · Your workspace/);
  env.emit("keydown", { key: "Escape" });
  assert.equal(env.el("coach").hidden, true);
});

test("the guided walk finishes the setup and never reopens by itself", () => {
  const env = environment(new Map([[KEY, JSON.stringify({ version: 2, step: MONITOR, status: "reading", done: allDone(SCAN, WORKSPACE, MAP, CONNECT, CREATE) })]]));
  env.el("invite-walk").click();
  assert.match(env.el("coach-progress").textContent, /Step 6 of 7/);
  env.el("coach-next").click();
  assert.match(env.el("coach-progress").textContent, /Step 7 of 7/);
  env.el("coach-next").click();
  assert.equal(env.el("coach").hidden, true);
  const saved = JSON.parse(env.storage.get(KEY));
  assert.equal(saved.status, "complete");
  assert.deepEqual(saved.done, allDone(SCAN, WORKSPACE, MAP, CONNECT, CREATE, MONITOR, REVIEW));
  assert.equal(env.el("invitation").hidden, true);
  const reloaded = environment(env.storage);
  assert.equal(reloaded.guide.startup(), false);
  assert.equal(reloaded.el("coach").hidden, true);
});

test("a v1 guide keeps its ticks under the new numbering and a finished one is invited back, never reopened", () => {
  const finished = environment(new Map([[LEGACY_KEY, JSON.stringify({ version: 1, step: 4, status: "complete", mode: "idle", done: [true, true, true, true, true] })]]));
  assert.equal(finished.guide.startup(), false);
  assert.equal(finished.el("overlay").hidden, true);
  assert.equal(finished.el("invitation").hidden, false);
  const migrated = JSON.parse(finished.storage.get(KEY) ?? "null");
  assert.equal(migrated, null, "nothing is written until the guide changes");
  finished.guide.open();
  const saved = JSON.parse(finished.storage.get(KEY));
  assert.equal(saved.version, 2);
  assert.equal(saved.status, "reading");
  assert.equal(saved.step, SCAN);
  assert.deepEqual(saved.done, allDone(WORKSPACE, CONNECT, CREATE, MONITOR, REVIEW));
  assert.match(finished.el("invite-open").textContent, /5 of 7 done/);
  const midway = environment(new Map([[LEGACY_KEY, JSON.stringify({ version: 1, step: 2, status: "reading", done: [true, false, false, false, false] })]]));
  midway.guide.open();
  assert.match(midway.el("progress").textContent, /Step 5 of 7/);
  assert.deepEqual(JSON.parse(midway.storage.get(KEY)).done, allDone(WORKSPACE));
  const fresh = environment(new Map([[LEGACY_KEY, JSON.stringify({ version: 1, step: 0, status: "new" })]]));
  assert.equal(fresh.guide.startup(), true);
});

test("corrupt saved state and unavailable local storage do not break the guide", () => {
  for (const saved of ["{bad json", JSON.stringify({ version: 2, step: 9999, status: "anything" }), JSON.stringify({ version: 2, step: "2", status: "reading" })]) {
    const env = environment(new Map([[KEY, saved]])); env.guide.open();
    assert.match(env.el("progress").textContent, /^Step [1-7] of 7$/);
  }
  const denied = environment(new Map(), { storageDenied: true });
  denied.guide.open(); denied.el("next").click(); denied.guide.close(); denied.guide.open();
  assert.match(denied.el("progress").textContent, /Step 2 of 7/);
});

test("keyboard focus wraps within the guide, excluding hidden and disabled actions", () => {
  const env = environment(); env.guide.open();
  const first = env.el("steps").children[0];
  let prevented = 0;
  env.el("next").focus();
  env.el("overlay").emit("keydown", { key: "Tab", preventDefault: () => prevented++ });
  assert.equal(env.document.activeElement, first);
  first.focus();
  env.el("overlay").emit("keydown", { key: "Tab", shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(env.document.activeElement, env.el("next"));
  assert.equal(prevented, 2);
});

test("without the desktop bridge the scan and map panels explain themselves instead of throwing", async () => {
  const env = environment(); env.guide.open();
  env.el("scan-run").click();
  await env.settle();
  assert.match(env.el("scan-status").textContent, /desktop app/);
  assert.equal(env.el("scan-apply").hidden, true);
  env.el("steps").children[MAP].click();
  env.get("workspace-project-name").textContent = "My project";
  env.el("map-run").click();
  await env.settle();
  assert.match(env.el("map-status").textContent, /desktop app/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], false);
});

const PLAN = {
  ok: true,
  opencode: { installed: true, version: "1.18.31", path: "C:\\bin\\opencode", supported: true },
  providers: { linked: ["opencode-go"], paid: ["opencode-go"], free: { count: 2, models: [{ id: "opencode/nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", usable: true }] } },
  explorer: { model: "opencode/nemotron-3.5-lightning-free", agent: "plan", free: true, reason: "free and current" },
  builder: { model: null, agent: "build", free: false, reason: "your OpenCode Go account" },
  judge: { kind: "assistant", model: null, reason: "the assistant's model judges" },
  warnings: ["OpenRouter is linked only through OPENROUTER_API_KEY."],
  nextSteps: ["Save a Jev key."],
  disclosures: ["Free models may use prompts to improve the model."],
};

function bridge(overrides = {}) {
  const calls = [];
  const host = {
    firstRunStatus: async () => { calls.push(["status"]); return { ok: true, firstRun: null }; },
    firstScan: async (payload) => { calls.push(["scan", payload]); return { ok: true, plan: PLAN }; },
    firstScanApply: async (payload) => { calls.push(["apply", payload]); return { ok: true, summary: "Explorer nemotron, builder OpenCode default, judge assistant.", notes: ["The stand-in judge is saved."] }; },
    firstMap: async (payload) => { calls.push(["map", payload]); return { ok: true, summary: "2 areas, 1 check, 2 first tasks saved as ideas.", ideas: { added: 2, updated: 0, total: 5 }, map: { summary: "A small tool.", areas: [{ name: "src", path: "src/", what: "The code." }] } }; },
    firstMapCancel: async () => { calls.push(["cancel"]); return { ok: true, cancelled: true }; },
    onFirstMapProgress: (callback) => { host.progress = callback; },
    ...overrides,
  };
  return { host, calls };
}

test("the scan stop reads OpenCode only on an explicit press, shows the facts, and saves nothing until Use this setup", async () => {
  const { host, calls } = bridge();
  const env = environment(new Map(), { host }); env.guide.open();
  await env.settle();
  assert.deepEqual(calls, [["status"]], "opening the stop only reads the saved record");
  assert.match(env.el("scan-status").textContent, /Not run yet|^$/);
  assert.equal(env.el("scan-apply").hidden, true);
  env.el("scan-allow-free").checked = true;
  env.el("scan-run").click();
  await env.settle();
  // Payloads are built inside the vm context, so compare their shape, not their prototypes.
  assert.equal(JSON.stringify(calls[1]), JSON.stringify(["scan", { prefs: { allowFreeTraining: true } }]));
  assert.match(env.el("scan-status").textContent, /Scan complete/);
  const facts = env.el("scan-facts").children.map((item) => item.textContent);
  assert.match(facts[0], /OpenCode 1\.18\.31 found at C:\\bin\\opencode/);
  assert.match(facts[1], /Linked in OpenCode: opencode-go/);
  assert.match(facts[2], /2 free models available, newest Nemotron 3\.5 Lightning Free/);
  assert.match(facts[3], /Explorer: opencode\/nemotron-3\.5-lightning-free — free and current/);
  assert.match(facts[4], /Builder: OpenCode's default model — your OpenCode Go account/);
  assert.match(facts[5], /Judge: assistant/);
  const notes = env.el("scan-notes").children.map((item) => item.textContent);
  assert.deepEqual(notes, ["Warning: OpenRouter is linked only through OPENROUTER_API_KEY.", "Next: Save a Jev key.", "Note: Free models may use prompts to improve the model."]);
  assert.equal(env.el("scan-apply").hidden, false);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[SCAN], false);
  env.el("scan-allow-free").checked = false;
  env.el("scan-apply").click();
  await env.settle();
  assert.equal(JSON.stringify(calls[2]), JSON.stringify(["apply", { prefs: { allowFreeTraining: false } }]));
  assert.match(env.el("scan-status").textContent, /Setup saved\. Explorer nemotron.*stand-in judge is saved/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[SCAN], true);
  assert.match(env.el("invite-steps").children[SCAN].textContent, /✓/);
  assert.match(env.el("steps").children[SCAN].textContent, /✓ 1\. Scan/);
});

test("a setup saved earlier (or from Settings) ticks the scan stop off from the host's record", async () => {
  const { host } = bridge({ firstRunStatus: async () => ({ ok: true, firstRun: { appliedAt: 1700000000000, explorer: { model: "opencode/mimo-v2.5-free" }, builder: { model: null }, judge: { kind: "jev" } } }) });
  const env = environment(new Map(), { host }); env.guide.open();
  await env.settle();
  assert.equal(JSON.parse(env.storage.get(KEY)).done[SCAN], true);
  assert.match(env.el("scan-status").textContent, /Setup saved on .*explorer opencode\/mimo-v2\.5-free, builder OpenCode default, judge jev/);
});

test("a failed scan or a refused apply keeps the stop open and honest", async () => {
  const { host } = bridge({ firstScan: async () => ({ ok: false, error: "OpenCode could not start." }) });
  const env = environment(new Map(), { host }); env.guide.open();
  env.el("scan-run").click();
  await env.settle();
  assert.equal(env.el("scan-status").textContent, "OpenCode could not start.");
  assert.equal(env.el("scan-apply").hidden, true);
  assert.equal(env.el("scan-run").disabled, false);
  const unusable = bridge({ firstScan: async () => ({ ok: true, plan: { ...PLAN, ok: false, opencode: { installed: false } } }) });
  const blocked = environment(new Map(), { host: unusable.host }); blocked.guide.open();
  blocked.el("scan-run").click();
  await blocked.settle();
  assert.match(blocked.el("scan-status").textContent, /not usable yet/);
  assert.match(blocked.el("scan-facts").children[0].textContent, /not installed/);
});

test("the map stop needs a selected project, streams the explorer's steps and ticks off on a saved map", async () => {
  const { host, calls } = bridge();
  const env = environment(new Map(), { host }); env.guide.open();
  env.el("steps").children[MAP].click();
  env.el("map-run").click();
  await env.settle();
  assert.match(env.el("map-status").textContent, /Select a project first/);
  assert.ok(!calls.some((call) => call[0] === "map"));
  env.get("workspace-project-name").textContent = "My project";
  let resolveMap;
  host.firstMap = () => new Promise((resolve) => { resolveMap = resolve; });
  env.el("map-run").click();
  await env.settle();
  assert.equal(env.el("map-run").disabled, true);
  assert.equal(env.el("map-cancel").hidden, false);
  host.progress({ kind: "map", phase: "running", step: "glob **/*" });
  host.progress({ kind: "map", phase: "running", step: "glob **/*" });
  host.progress({ kind: "map", phase: "running", step: "read README.md" });
  assert.deepEqual(env.el("map-steps").children.map((item) => item.textContent), ["glob **/*", "read README.md"]);
  resolveMap({ ok: true, summary: "2 areas, 1 check, 2 first tasks saved as ideas.", ideas: { added: 2, updated: 1, total: 5 }, map: { summary: "A small tool.", areas: [{ name: "src", path: "src/", what: "The code." }] } });
  await env.settle();
  assert.equal(env.el("map-run").disabled, false);
  assert.equal(env.el("map-cancel").hidden, true);
  assert.match(env.el("map-status").textContent, /Folder mapped: 2 areas, 1 check, 2 first tasks saved as ideas/);
  const facts = env.el("map-facts").children.map((item) => item.textContent);
  assert.deepEqual(facts, ["2 areas, 1 check, 2 first tasks saved as ideas.", "2 new ideas saved to Your work, 1 updated.", "A small tool.", "src (src/): The code."]);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], true);
  assert.match(env.el("invite-steps").children[MAP].textContent, /✓/);
  env.el("map-cancel").click();
  assert.ok(!calls.some((call) => call[0] === "cancel"), "cancel is inert once the map finished");
});

test("a refused, cancelled or unparsable map explains what to do and leaves the stop unticked", async () => {
  const cases = [
    [{ ok: false, reason: "free-tier-refused", error: "The free tier refused this run." }, /refused this run\. Choose a paid model in Settings/],
    [{ ok: false, reason: "no-scan", error: "Run the first scan first." }, /Go back to the Scan stop/],
    [{ ok: false, reason: "unparsable", error: "The explorer's reply contained no JSON object." }, /Map again; a second pass/],
    [{ ok: false, reason: "cancelled", error: "The map was cancelled." }, /was cancelled/],
  ];
  for (const [result, expected] of cases) {
    const { host } = bridge({ firstMap: async () => result });
    const env = environment(new Map(), { host }); env.guide.open();
    env.el("steps").children[MAP].click();
    env.get("workspace-project-name").textContent = "My project";
    env.el("map-run").click();
    await env.settle();
    assert.match(env.el("map-status").textContent, expected);
    assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], false);
  }
  const { host, calls } = bridge({ firstMap: () => new Promise(() => {}) });
  const env = environment(new Map(), { host }); env.guide.open();
  env.el("steps").children[MAP].click();
  env.get("workspace-project-name").textContent = "My project";
  env.el("map-run").click();
  await env.settle();
  env.el("map-cancel").click();
  await env.settle();
  assert.ok(calls.some((call) => call[0] === "cancel"));
  assert.match(env.el("map-status").textContent, /Cancelling/);
});

test("the progress bar follows the ticked stops in the sheet and on the invitation", () => {
  const env = environment(); env.guide.open();
  assert.equal(env.el("bar-fill").style.width, "0%");
  assert.equal(env.el("bar").attrs["aria-valuenow"], "0");
  assert.equal(env.el("bar").attrs["aria-valuemax"], "7");
  env.emit("mefi:project-changed", { detail: { projectId: "alpha" } });
  assert.equal(env.el("bar-fill").style.width, "14%");
  assert.equal(env.el("invite-bar-fill").style.width, "14%");
  const halfway = environment(new Map([[KEY, JSON.stringify({ version: 2, step: CONNECT, status: "reading", done: allDone(SCAN, WORKSPACE, MAP, CONNECT) })]]));
  halfway.guide.open();
  assert.equal(halfway.el("bar-fill").style.width, "57%");
  assert.equal(halfway.el("invite-bar").attrs["aria-valuenow"], "4");
});

test("an automatic first launch with the desktop bridge starts the scan by itself, once, and shows its progress", async () => {
  const { host, calls } = bridge();
  const env = environment(new Map(), { host });
  assert.equal(env.guide.startup(), true);
  assert.equal(env.el("activity").hidden, false);
  assert.match(env.el("activity-label").textContent, /Scanning/);
  host.progress({ kind: "scan", step: { id: "auth", ok: true } });
  assert.match(env.el("activity-label").textContent, /linked providers \(3 of 6\)/);
  assert.equal(env.el("activity-fill").style.width, "50%");
  await env.settle();
  assert.equal(calls.filter((call) => call[0] === "scan").length, 1);
  assert.equal(env.el("activity").hidden, true);
  assert.match(env.el("scan-status").textContent, /Scan complete/);
  assert.equal(env.el("scan-apply").hidden, false);
  assert.equal(env.guide.startup(), false);
  await env.settle();
  assert.equal(calls.filter((call) => call[0] === "scan").length, 1);
  // A manual reopen never scans on its own.
  const quiet = environment(new Map([[KEY, JSON.stringify({ version: 2, step: SCAN, status: "reading" })]]), { host: bridge().host });
  quiet.guide.open();
  await quiet.settle();
  assert.equal(quiet.el("activity").hidden, true);
});

test("Use this setup and continue maps the selected folder and asks the linked AI to plan the rest", async () => {
  const { host, calls } = bridge();
  host.firstAssist = async (payload) => { calls.push(["assist", payload]); return { ok: true, via: "assistant", model: "deepseek-v4.1-flash", advice: { summary: "Mapped; connect a key next.", stops: { connections: "Save a Jev key.", create: "Start with the README task." }, firstTask: { title: "Document how to run the game", brief: "Add a Run section. Check: README names the command." } }, warnings: [] }; };
  const env = environment(new Map(), { host });
  env.get("workspace-project-name").textContent = "My project";
  env.guide.open();
  env.el("scan-run").click();
  await env.settle();
  env.el("scan-apply").click();
  await env.settle();
  // The saved-record read is a deferred microtask; the chain itself is ordered.
  assert.deepEqual(calls.map((call) => call[0]).filter((name) => name !== "status"), ["scan", "apply", "map", "assist"]);
  assert.ok(calls.some((call) => call[0] === "status"));
  assert.match(env.el("progress").textContent, /Step 3 of 7/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], true);
  assert.match(env.el("map-status").textContent, /Folder mapped/);
  assert.equal(env.el("activity").hidden, true);
  assert.equal(env.el("assist").hidden, false);
  assert.match(env.el("assist-status").textContent, /Mapped; connect a key next\. \(From your assistant \(deepseek-v4\.1-flash\)\.\)/);
  const lines = env.el("assist-list").children.map((item) => item.textContent);
  assert.deepEqual(lines, ["Connections: Save a Jev key.", "Create: Start with the README task."]);
  assert.equal(JSON.stringify(calls.find((call) => call[0] === "assist")[1].progress.done), JSON.stringify([true, false, true, false, false, false, false]));
  env.el("next").click();
  assert.equal(env.el("assist-list").children[0].attrs["aria-current"], "step");
  env.el("next").click();
  assert.equal(env.el("assist-task").hidden, false);
  env.el("assist-task").click();
  assert.equal(env.get("workspace-input").value, "Document how to run the game\n\nAdd a Run section. Check: README names the command.");
  assert.deepEqual(env.routes, ["workspace"]);
  assert.equal(env.get("workspace-send").clicks, 0);
  assert.equal(env.el("overlay").hidden, true);
});

test("without a folder, Use this setup waits at the workspace stop and maps the folder the moment one is selected", async () => {
  const { host, calls } = bridge();
  host.firstAssist = async () => ({ ok: true, via: "static", advice: { summary: "Static.", stops: { connections: "Connect." }, firstTask: null }, warnings: [] });
  const env = environment(new Map(), { host });
  env.guide.open();
  env.el("scan-run").click();
  await env.settle();
  env.el("scan-apply").click();
  await env.settle();
  assert.match(env.el("progress").textContent, /Step 2 of 7/);
  assert.ok(!calls.some((call) => call[0] === "map"));
  env.get("workspace-project-name").textContent = "My project";
  env.emit("mefi:project-changed", { detail: { projectId: "alpha" } });
  await env.settle();
  assert.match(env.el("progress").textContent, /Step 3 of 7/);
  assert.equal(calls.filter((call) => call[0] === "map").length, 1);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[WORKSPACE], true);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], true);
  assert.equal(env.el("assist-task").hidden, true);
  assert.match(env.el("assist-status").textContent, /From the built-in guide/);
  // Selecting another project later never restarts the map on its own.
  env.emit("mefi:project-changed", { detail: { projectId: "beta" } });
  await env.settle();
  assert.equal(calls.filter((call) => call[0] === "map").length, 1);
});

test("a failed map still lets the assistant be asked by hand, and the panels stay hidden before a setup exists", async () => {
  const { host } = bridge({ firstMap: async () => ({ ok: false, reason: "timeout", error: "The explorer did not finish within 10 minutes." }) });
  host.firstAssist = async () => ({ ok: false, error: "The assistant did not answer." });
  const env = environment(new Map(), { host });
  env.guide.open();
  env.el("steps").children[CONNECT].click();
  assert.equal(env.el("assist").hidden, true, "no setup saved yet");
  env.el("steps").children[SCAN].click();
  env.get("workspace-project-name").textContent = "My project";
  env.el("scan-run").click();
  await env.settle();
  env.el("scan-apply").click();
  await env.settle();
  assert.match(env.el("map-status").textContent, /did not finish within 10 minutes/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[MAP], false);
  assert.equal(env.el("assist").hidden, false);
  env.el("assist-run").click();
  await env.settle();
  assert.equal(env.el("assist-status").textContent, "The assistant did not answer.");
  assert.equal(env.el("activity").hidden, true);
});

test("workspace tool menu groups destinations and excludes duplicated sidebar links", () => {
  const env = environment(); vm.runInContext(navSource, env.context);
  const target = env.get("workspace-tool-links");
  env.context.window.MefiNav.renderWorkspaceTools(target);
  assert.deepEqual(target.children.map((group) => group.attrs["aria-label"]), ["Work", "Monitor & inspect", "Models"]);
  const buttons = target.querySelectorAll("button");
  const destinations = buttons.map((button) => button.dataset.nav);
  for (const id of ["ideas", "explorer", "eyes", "overhead", "analyzer", "booklet", "graph"]) assert.ok(destinations.includes(id));
  // pinned at the top of the sidebar or in its bottom row, so never repeated in the grid
  for (const id of ["workspace", "command", "tasks", "plans", "studio", "music", "onboarding"]) assert.ok(!destinations.includes(id));
  assert.equal(new Set(destinations).size, destinations.length);
});

test("a machine without OpenCode is still configured: the scan shows auto setup's route and Use this setup stays available", async () => {
  const auto = { ok: true, applied: false, planned: true, summary: "Assistant on Claude Code CLI, fixed model defaults, builders on Claude Code.", notes: ["No assistant key saved: the assistant answers through the Claude Code CLI's own subscription login."] };
  const { host, calls } = bridge({
    firstScan: async (payload) => { calls.push(["scan", payload]); return { ok: true, plan: { ...PLAN, ok: false, opencode: { installed: false }, nextSteps: ["Install the OpenCode CLI."] }, autoSetup: auto }; },
    firstScanApply: async (payload) => { calls.push(["apply", payload]); return { ok: true, summary: "OpenCode is not usable yet; " + auto.summary, notes: ["Auto setup: " + auto.summary], autoSetup: { ...auto, applied: true } }; },
  });
  const env = environment(new Map(), { host }); env.guide.open();
  await env.settle();
  env.el("scan-run").click();
  await env.settle();
  assert.match(env.el("scan-status").textContent, /auto setup found a working route: Assistant on Claude Code CLI/);
  const facts = env.el("scan-facts").children.map((item) => item.textContent);
  assert.match(facts[0], /OpenCode is not installed/);
  assert.match(facts[facts.length - 1], /^Auto setup: Assistant on Claude Code CLI/);
  const notes = env.el("scan-notes").children.map((item) => item.textContent);
  assert.ok(notes.includes("Next: Install the OpenCode CLI."));
  assert.ok(notes.some((text) => text.startsWith("Setup: No assistant key saved")));
  assert.equal(env.el("scan-apply").hidden, false, "the route can be saved without OpenCode");
  env.el("scan-apply").click();
  await env.settle();
  assert.equal(calls.filter((call) => call[0] === "apply").length, 1);
  assert.match(env.el("scan-status").textContent, /Setup saved\. OpenCode is not usable yet; Assistant on Claude Code CLI.*Auto setup: Assistant on Claude Code CLI/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[SCAN], true);
});

test("a first launch that already ran auto setup is reported at the scan stop before any scan", async () => {
  const { host } = bridge({ firstRunStatus: async () => ({ ok: true, firstRun: null, autoSetup: { at: 1, automatic: true, summary: "Assistant on z.ai GLM, fixed model defaults, builders on OpenCode." } }) });
  const env = environment(new Map(), { host }); env.guide.open();
  await env.settle();
  assert.match(env.el("scan-status").textContent, /Auto setup ran on first launch: Assistant on z\.ai GLM.*Run the scan/);
  assert.equal(JSON.parse(env.storage.get(KEY)).done[SCAN], false, "auto setup alone does not complete the scan stop");
});
