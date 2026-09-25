import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/ideas.js", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 25; index += 1) await Promise.resolve(); };

function environment(ideas = [{ id: "idea-1", title: "Better export", detail: "Keep export consistent", source: "chat", at: 1, read: true, tags: [] }]) {
  const elements = new Map(), documentListeners = new Map();
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  let document;
  class Element {
    constructor(tag = "div") {
      this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
      this.hidden = false; this.open = false; this.style = { setProperty() {} }; this.clientWidth = 500;
      this.classes = new Set(); this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)) };
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, detail = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...detail }); }
    click() { this.dispatch("click"); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
    closest(selector) { return selector === this.tagName ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector) { return this.children.find((child) => selector === "summary" ? child.tagName === "summary" : selector === "li.selected" && child.classes?.has("selected")) || null; }
    getContext() { return context; }
  }
  const get = (name) => { const id = `ideas-${name}`; if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get("canvas").hidden = true; get("graph-col").hidden = true; get("graph-col").append(get("canvas"));
  get("tools").append(new Element("summary"));
  const actions = [];
  const window = { mefiStudio: { ideasList: async () => ({ ok: true, projectId: "project-a", ideas }), ideasAction: async (payload) => { actions.push(payload); return { ok: true }; } }, MefiNav: { claim() {}, release() {}, setBadge() {} } };
  document = { readyState: "complete", getElementById: (id) => get(id.replace(/^ideas-/, "")), createElement: (tag) => new Element(tag), createTextNode: (text) => ({ textContent: String(text) }), addEventListener: (type, fn) => documentListeners.set(type, fn) };
  vm.runInContext(source, vm.createContext({ window, document }));
  return { ui: window.MefiIdeas, get, document, documentListeners, actions, window };
}

test("Ideas starts as a list, retains selected detail through graph changes, and returns to the list", async () => {
  const env = environment();
  env.window.matchMedia = () => ({ matches: true });
  env.ui.open({ ideaId: "idea-1" }); await flush();
  assert.equal(env.get("canvas").hidden, true);
  assert.equal(env.get("graph-col").hidden, true);
  assert.match(env.get("detail").textContent, /Keep export consistent/);
  assert.equal(env.get("overlay").dataset.detail, "true");
  assert.equal(env.document.activeElement, env.get("back"));
  env.get("back").click();
  assert.equal(env.get("overlay").dataset.detail, "false");
  env.get("view").click();
  assert.equal(env.get("overlay").dataset.detail, "false", "the graph control reveals the graph from a narrow detail view");
  assert.equal(env.get("graph-col").hidden, false);
  assert.equal(env.get("view").attributes["aria-pressed"], "true");
  env.get("view").click();
  assert.equal(env.get("graph-col").hidden, true);
  assert.match(env.get("detail").textContent, /Keep export consistent/);
  assert.equal(env.actions.length, 0, "view navigation must not mutate idea status");
});

test("Ideas tools closes on Escape and outside click, restoring focus to its summary", () => {
  const env = environment();
  env.get("tools").open = true;
  env.get("tools").dispatch("keydown", { key: "Escape" });
  assert.equal(env.get("tools").open, false);
  assert.equal(env.document.activeElement, env.get("tools").querySelector("summary"));
  env.get("tools").open = true;
  env.documentListeners.get("pointerdown")({ target: env.get("list") });
  assert.equal(env.get("tools").open, false);
});

test("Ideas loads after navigation replaces the classic link and removes its badge", async () => {
  const env = environment();
  const find = env.document.getElementById;
  env.document.getElementById = (id) => id === "ideas-badge" ? null : find(id);
  let badge = null;
  env.window.MefiNav.setBadge = (id, count) => { badge = { id, count }; };
  env.ui.open(); await flush();
  assert.match(env.get("list").textContent, /Better export/);
  assert.equal(env.get("unread").textContent, "0");
  assert.deepEqual(badge, { id: "ideas", count: 0 });
  assert.doesNotMatch(env.get("hint").textContent, /Cannot set/);
});

test("idea tags are native toggle buttons that filter without discarding keyboard focus", async () => {
  const env = environment([
    {id:"idea-1",title:"Export",detail:"Consistent export",source:"chat",at:2,read:true,tags:["navigation","output"]},
    {id:"idea-2",title:"Theme",detail:"More themes",source:"chat",at:1,read:true,tags:["appearance"]}
  ]);
  env.ui.open({ideaId:"idea-1"}); await flush();
  const chips=env.get("detail").children.find(child=>child.className==="keyword-row").children;
  assert.equal(chips[0].tagName,"button");
  assert.equal(chips[0].type,"button","native buttons provide Enter and Space activation");
  assert.equal(chips[0].attributes["aria-label"],"Filter ideas tagged navigation");
  assert.equal(chips[0].attributes["aria-pressed"],"false");
  chips[0].focus(); chips[0].click();
  assert.equal(chips[0].attributes["aria-pressed"],"true");
  assert.equal(chips[1].attributes["aria-pressed"],"false");
  assert.doesNotMatch(env.get("list").textContent,/Theme/);
  assert.equal(env.document.activeElement,chips[0]);
  chips[0].click();
  assert.equal(chips[0].attributes["aria-pressed"],"false");
  assert.match(env.get("list").textContent,/Theme/);
  assert.equal(env.actions.length,0,"tag filtering never changes saved ideas");
});

test("a sparse idea row leaves out its missing source and time instead of printing undefined or Invalid Date", async () => {
  const env = environment([
    { id: "sparse", title: "Sync notes between devices", status: "new", read: false },
    { id: "full", title: "Note templates", source: "chat", at: 5, read: false },
  ]);
  env.ui.open(); await flush();
  const text = env.get("list").textContent;
  assert.doesNotMatch(text, /undefined|Invalid Date|NaN/);
  assert.match(text, /Sync notes between devices/);
  assert.match(text, /unread/);
  assert.match(text, /chat · /);
});
