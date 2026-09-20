import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/onboarding.js", import.meta.url), "utf8");
const navSource = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");
const KEY = "mefiStudio.walkthrough.v1";

function environment(storage = new Map(), { storageDenied = false } = {}) {
  const elements = new Map(); const routes = []; const claims = []; const releases = [];
  let document;
  class Element {
    constructor(tag = "div") { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.clicks = 0; this.classList = { toggle() {} }; }
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
  document = { activeElement: null, readyState: "loading", body: new Element(), getElementById: get,
    createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    querySelector: () => get("sidebar-guide"), querySelectorAll: () => [], addEventListener() {},
  };
  for (const id of ["back", "next", "action", "secondary", "dismiss"]) el(id).tag = "button";
  el("overlay").hidden = true;
  el("sheet").append(el("steps"), el("action"), el("secondary"), el("back"), el("next"));
  el("overlay").append(el("sheet"));
  const window = {
    MefiNav: { go: (id) => routes.push(id), claim: (id) => claims.push(id), release: (id) => releases.push(id) },
    // The guide may never invoke a provider, project writer or task API.
    mefiStudio: new Proxy({}, { get() { throw new Error("walkthrough touched host API"); } }),
    addEventListener() {}, dispatchEvent() {},
  };
  const context = vm.createContext({ window, document, localStorage: {
    getItem: (key) => { if (storageDenied) throw new Error("storage unavailable"); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (storageDenied) throw new Error("storage unavailable"); storage.set(key, value); },
  }, URLSearchParams, setTimeout, clearTimeout, console });
  vm.runInContext(source, context);
  window.MefiOnboarding.init();
  return { guide: window.MefiOnboarding, el, get, routes, claims, releases, storage, document, context };
}

test("first launch opens the guide once and closing it keeps the saved guide available", () => {
  const env = environment();
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.guide.startup(), true);
  assert.equal(env.el("overlay").hidden, false);
  assert.match(env.el("title").textContent, /Welcome to Mefi/);
  assert.deepEqual(env.claims, ["onboarding"]);
  assert.equal(JSON.parse(env.storage.get(KEY)).status, "reading");
  assert.equal(env.guide.startup(), false);
  env.guide.close();
  const reloaded = environment(env.storage);
  assert.equal(reloaded.guide.startup(), false);
  assert.equal(reloaded.el("overlay").hidden, true);
  assert.equal(reloaded.el("invitation").hidden, false);
});

test("the first lesson offers the saved build choice and only an explicit toggle writes it", async () => {
  const env = environment(); const calls = []; let autoBuild = true;
  env.context.window.MefiWorkspace = {
    buildMode: () => ({ autoBuild, loaded: true, saving: false }),
    setAutoBuild: async (value) => { calls.push(value); autoBuild = value; return { message: "Build preference saved" }; },
  };
  env.guide.startup();
  assert.equal(env.el("build-mode").hidden, false);
  assert.equal(env.el("auto-build").checked, true);
  assert.equal(env.el("auto-build").disabled, false);
  assert.deepEqual(calls, []);
  env.el("auto-build").checked = false; env.el("auto-build").emit("change");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(calls, [false]);
  assert.equal(env.el("build-mode-label").textContent, "Verify first");
  assert.match(env.el("build-mode-note").textContent, /Unapproved work waits/);
  env.el("next").click(); assert.equal(env.el("build-mode").hidden, true);
  env.el("next").click(); assert.equal(env.el("build-mode").hidden, false);
  assert.equal(env.el("auto-build").checked, false);
  env.context.window.MefiWorkspace.setAutoBuild = async () => { throw new Error("Saving unavailable"); };
  env.el("auto-build").checked = true; env.el("auto-build").emit("change");
  for (let i = 0; i < 5; i++) await Promise.resolve();
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
  assert.match(reloaded.el("title").textContent, /Welcome to Mefi/);
  reloaded.el("steps").children[4].click(); reloaded.el("next").click();
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
  env.el("next").click(); env.el("next").click();
  assert.match(env.el("title").textContent, /clear task/);
  env.el("action").click();
  assert.deepEqual(env.routes, ["workspace"]);
  assert.equal(env.get("workspace-mode-work").clicks, 1);
  assert.equal(env.document.activeElement, env.get("workspace-input"));
  assert.equal(env.el("overlay").hidden, true);
  assert.deepEqual(env.releases, ["onboarding"]);
  const reloaded = environment(env.storage); reloaded.guide.open();
  assert.match(reloaded.el("progress").textContent, /Step 3 of 5/);
  reloaded.el("secondary").click();
  assert.deepEqual(reloaded.routes, ["plans"]);
});

test("each lesson action reaches the intended control without performing the work", () => {
  const env = environment();
  for (let index = 0; index < 5; index++) {
    env.guide.open();
    env.el("steps").children[index].click();
    env.el("action").click();
  }
  assert.deepEqual(env.routes, ["workspace", "studio", "workspace", "command", "workspace"]);
  assert.equal(env.get("workspace-add-project").clicks, 0);
  assert.equal(env.get("workspace-review").clicks, 1);
  assert.equal(env.get("workspace-send").clicks, 0);
});

test("guide completion only dismisses the guide; lessons can be revisited", () => {
  const env = environment(); env.guide.open();
  env.el("steps").children[4].click(); env.el("next").click();
  assert.equal(JSON.parse(env.storage.get(KEY)).status, "complete");
  assert.equal(env.el("overlay").hidden, true);
  assert.equal(env.el("invitation").hidden, true);
  assert.deepEqual(env.routes, []);
  const reloaded = environment(env.storage); reloaded.guide.open();
  reloaded.el("steps").children[0].click();
  assert.equal(reloaded.el("back").disabled, true);
  assert.match(reloaded.el("progress").textContent, /Step 1 of 5/);
});

test("corrupt saved state and unavailable local storage do not break the guide", () => {
  for (const saved of ["{bad json", JSON.stringify({ version: 1, step: 9999, status: "anything" }), JSON.stringify({ version: 1, step: "2", status: "reading" })]) {
    const env = environment(new Map([[KEY, saved]])); env.guide.open();
    assert.match(env.el("progress").textContent, /^Step [1-5] of 5$/);
  }
  const denied = environment(new Map(), { storageDenied: true });
  denied.guide.open(); denied.el("next").click(); denied.guide.close(); denied.guide.open();
  assert.match(denied.el("progress").textContent, /Step 2 of 5/);
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

test("workspace tool menu groups destinations and excludes duplicated sidebar links", () => {
  const env = environment(); vm.runInContext(navSource, env.context);
  const target = env.get("workspace-tool-links");
  env.context.window.MefiNav.renderWorkspaceTools(target);
  assert.deepEqual(target.children.map((group) => group.attrs["aria-label"]), ["Work", "Monitor & inspect", "Models"]);
  const buttons = target.querySelectorAll("button");
  const destinations = buttons.map((button) => button.dataset.nav);
  for (const id of ["tasks", "plans", "ideas", "explorer", "eyes", "booklet", "graph"]) assert.ok(destinations.includes(id));
  for (const id of ["workspace", "command", "studio", "music", "onboarding"]) assert.ok(!destinations.includes(id));
  assert.equal(new Set(destinations).size, destinations.length);
});
