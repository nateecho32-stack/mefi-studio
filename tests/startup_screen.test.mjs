// The launch screen (renderer/startup.js) against a stub document and a fake
// bridge: when it applies, what it preselects, which host calls each button
// makes, and that nothing here ever asks the host to start an agent except
// through the one explicit "Open and start agents" choice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/startup.js", import.meta.url), "utf8");
// The choice is built inside the vm realm; compare its plain shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let count = 0; count < 30; count += 1) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ""; this.title = ""; this.ownText = "";
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
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  async click() { if (this.disabled) return; if (typeof this.onclick === "function") await this.onclick(); for (const fn of this.listeners.click ?? []) await fn({ target: this }); }
  focus() { this.focused = true; }
  matches(selector) {
    if (selector === "button") return this.tagName === "button";
    if (selector === '[aria-checked="true"]') return this.attrs["aria-checked"] === "true";
    return false;
  }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function environment(bridge) {
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element(id.includes("open") || id.includes("add") ? "button" : "div")); return elements.get(id); };
  const document = { getElementById: (id) => get(id), createElement: (tag) => new Element(tag) };
  const warnings = [];
  const context = vm.createContext({ window: { mefiStudio: bridge }, document, console: { ...console, warn: (...args) => warnings.push(args) } });
  vm.runInContext(source, context, { filename: "startup.js" });
  const rows = () => get("boot-projects").querySelectorAll("button");
  return { startup: context.window.MefiStartup, get, rows, warnings, selected: () => rows().find((row) => row.attrs["aria-checked"] === "true")?.dataset.projectId ?? null };
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

test("the last project is preselected and Open studio selects it on the host with the agents left held", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  const choice = env.startup.choose({ isCurrent: () => true });
  await flush();
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id, projectB.id]);
  assert.equal(env.selected(), projectB.id, "the project Studio last had open is preselected");
  assert.equal(env.rows()[1].focused, true, "focus lands on the preselected row");
  assert.equal(env.get("boot-open").textContent, "Open studio");
  assert.equal(env.get("boot-open-start").hidden, false);
  assert.match(env.get("boot-choose-note").textContent, /Agents stay off/);
  assert.deepEqual(calls, [], "rendering the screen calls nothing on the host");
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(calls, [["choose", projectB.id]]);
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.equal(calls.some(([name]) => name === "begin"), false, "Open studio never starts the agents");
});

test("picking another project and Open and start agents chooses it and asks for the agents once the studio is up", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  await env.rows()[0].click();
  assert.equal(env.selected(), projectA.id);
  assert.equal(env.get("boot-projects").querySelectorAll("button")[0].className, "boot-project selected");
  await env.get("boot-open-start").click();
  await flush();
  assert.deepEqual(calls, [["choose", projectA.id]], "the screen itself only chooses; starting waits for the handoff");
  assert.deepEqual(plain(await choice), { projectId: projectA.id, startAgents: true, changed: true });
  assert.deepEqual(await env.startup.begin(), { ok: true, released: true, running: true });
  assert.deepEqual(calls.at(-1), ["begin"]);
});

test("project radios keep one Tab stop and retain focus when selection changes", async () => {
  const { api, calls } = bridge();
  const env = environment(api);
  env.startup.choose();
  await flush();
  assert.deepEqual(env.rows().map((row) => row.tabIndex), [-1, 0]);
  assert.equal(env.startup.navigateProjects("ArrowDown"), true);
  assert.equal(env.selected(), projectA.id, "arrow navigation wraps through the projects");
  assert.deepEqual(env.rows().map((row) => row.tabIndex), [0, -1]);
  assert.equal(env.rows()[0].focused, true, "the new selected row receives focus after rendering");
  env.startup.navigateProjects("End");
  assert.equal(env.selected(), projectB.id);
  env.startup.navigateProjects("Home");
  assert.equal(env.selected(), projectA.id);
  await env.rows()[1].click();
  assert.equal(env.rows()[1].focused, true, "clicking also retains focus after rendering");
  assert.equal(env.startup.navigateProjects("Tab"), false);
  assert.deepEqual(calls, [], "browsing projects never opens one or starts work");
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
  assert.match(env.get("boot-choose-note").textContent, /unavailable/);
  assert.equal(env.get("boot-choose-note").classList.contains("error"), true);
  assert.equal(env.get("boot-open").disabled, false, "the controls come back for another try");
  assert.equal(env.get("boot-open").textContent, "Open studio");
  await env.get("boot-open").click();
  await flush();
  assert.deepEqual(plain(await choice), { projectId: projectB.id, startAgents: false, changed: false });
  assert.equal(calls.filter(([name]) => name === "choose").length, 2);
});

test("Open another folder adopts the folder the host added and a cancelled picker changes nothing", async () => {
  const projectC = { id: "project_c", name: "Gamma", path: "C:/projects/gamma" };
  let picks = 0;
  const { api, calls } = bridge({ projectsAdd: async () => { picks += 1; calls.push(["add"]); return picks === 1 ? { ok: true, projects: [projectA, projectB], activeId: projectB.id, canceled: true } : { ok: true, projects: [projectA, projectB, projectC], activeId: projectB.id, addedId: projectC.id }; } });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  await env.get("boot-add-project").click();
  await flush();
  assert.equal(env.selected(), projectB.id, "a cancelled picker keeps the selection");
  await env.get("boot-add-project").click();
  await flush();
  assert.deepEqual(env.rows().map((row) => row.dataset.projectId), [projectA.id, projectB.id, projectC.id]);
  assert.equal(env.selected(), projectC.id, "the folder just added is the pick");
  await env.get("boot-open").click();
  assert.deepEqual(plain(await choice), { projectId: projectC.id, startAgents: false, changed: true });
  assert.deepEqual(calls, [["add"], ["add"], ["choose", projectC.id]]);
});

test("with no project yet the screen offers to continue without one and never shows the agents choice", async () => {
  const { api, calls } = bridge({ startupState: async () => ({ ok: true, interactive: true, chosen: false, projects: [], activeId: null }), startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, projects: [], activeId: null }; } });
  const env = environment(api);
  const choice = env.startup.choose();
  await flush();
  assert.equal(env.rows().length, 0);
  assert.match(env.get("boot-projects").textContent, /No project is open yet/);
  assert.equal(env.get("boot-open").textContent, "Continue without a project");
  assert.equal(env.get("boot-open-start").hidden, true);
  assert.equal(env.get("boot-open").focused, true);
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
