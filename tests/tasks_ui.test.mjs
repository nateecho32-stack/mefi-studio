import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/tasks.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attrs = {};
    this.hidden = false; this.value = ""; this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = { add: (...names) => names.forEach((n) => classes.add(n)), contains: (n) => classes.has(n), toggle: (n, on) => on ? classes.add(n) : classes.delete(n) };
  }
  set textContent(text) { this.ownText = String(text); this.children = []; }
  get textContent() { return (this.ownText ?? "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  insertBefore(child, next) { const index = this.children.indexOf(next); this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = value; }
  querySelectorAll(selector) {
    const match = (el) => selector === "[data-filter]" ? !!el.dataset.filter
      : selector.startsWith('[data-filter="') ? el.dataset.filter === selector.slice(14, -2)
      : selector === "li.selected" ? el.tagName === "li" && el.classList.contains("selected")
      : selector === "input" ? el.tagName === "input" : false;
    return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest() { return this; }
  scrollIntoView() { this.scrolled = true; }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this, stopPropagation() {}, preventDefault() {} }); }
}

function environment({ tasks = [], filter = "all", saveOk = true, prefsWait = null } = {}) {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, new Element()); return els.get(id); };
  for (const filter of ["all", "open", "done"]) {
    const button = new Element("button"); button.dataset.filter = filter; get("task-filters").append(button);
  }
  const saved = []; const notifications = []; let onTasks;
  const prefs = { taskFilter: filter, autoReference: false };
  const context = vm.createContext({
    window: {
      mefiStudio: {
        tasksList: async () => ({ ok: true, tasks: structuredClone(tasks) }),
        tasksSave: async (rows) => { saved.push(structuredClone(rows)); return { ok: saveOk }; },
        prefsGet: async () => { if (prefsWait) await prefsWait; return { ok: true, prefs }; },
        prefsSet: async (patch) => { Object.assign(prefs, patch); return { ok: true, prefs }; },
        onTasks: (fn) => { onTasks = fn; },
      },
      MefiNav: { setBadge() {}, claim() {}, release() {} },
      MefiBoot: { pollStart() {} }, MefiToast: (text) => notifications.push(text),
    },
    document: { readyState: "loading", getElementById: get, createElement: (tag) => new Element(tag), querySelectorAll: () => [], addEventListener() {} },
    setTimeout() {}, setInterval() {}, console,
  });
  vm.runInContext(source, context);
  const api = context.window.MefiTasks; api.init();
  return { api, get, saved, notifications, broadcast: (rows) => onTasks(rows) };
}

const rows = [
  { id: "open", title: "Upcoming task", status: "open", updatedAt: 100 },
  { id: "done", title: "Visible finished task", status: "done", doneAt: 200, updatedAt: 200, verification: { state: "verified", reason: "2 files changed" }, lastAttempt: { result: { parts: { done: "Saved project settings" } } } },
  { id: "archived", title: "Older finished task", status: "archived", doneAt: 50, updatedAt: 400 },
  { id: "verify", title: "Finished worker", status: "awaiting_verification", updatedAt: 300 },
  { id: "review", title: "Needs a check", status: "open", verification: { state: "failed", reason: "No completion evidence" } },
];

test("Done visibly retains archived tasks and offers pending completion checks without declaring them done", async () => {
  const env = environment({ tasks: rows });
  await env.api.open({ filter: "done" });
  const text = env.get("task-list").textContent;
  assert.match(text, /2 finished · 1 archived/);
  assert.match(text, /Visible finished task/);
  assert.match(text, /Older finished task/);
  assert.match(text, /Saved project settings/);
  assert.match(text, /Review 2 attempts/);
  assert.doesNotMatch(text, /Upcoming task/);
  assert.deepEqual(JSON.parse(JSON.stringify(env.api.summary(rows))), { all: 5, open: 1, done: 2, review: 2 });
});

test("All shows completed work expanded on first open", async () => {
  const env = environment({ tasks: rows });
  await env.api.open();
  assert.match(env.get("task-list").textContent, /Visible finished task/);
  assert.equal(env.api.state.doneCollapsed, false);
});

test("deep linking a done task overrides a saved Open filter and exposes the result", async () => {
  const env = environment({ tasks: rows, filter: "open" });
  await env.api.open({ taskId: "done" });
  assert.equal(env.api.state.filter, "done");
  assert.match(env.get("task-list").textContent, /Visible finished task/);
  assert.match(env.get("task-detail").textContent, /Completion accepted: 2 files changed/);
  assert.match(env.get("task-detail").textContent, /Worker reported — done: Saved project settings/);
});

test("Review has its own list and keeps worker success distinct from confirmed completion", async () => {
  const env = environment({ tasks: rows });
  await env.api.open({ filter: "review" });
  const text = env.get("task-list").textContent;
  assert.match(text, /Finished worker/);
  assert.match(text, /completion checks are pending/i);
  assert.match(text, /Needs a check/);
  assert.doesNotMatch(text, /Visible finished task/);
  assert.doesNotMatch(text, /Upcoming task/);
});

test("opening an empty Done view explains pending work and never implies a completed worker is missing", async () => {
  const env = environment({ tasks: rows.filter((row) => row.id === "verify") });
  await env.api.open({ filter: "done" });
  assert.match(env.get("task-list").textContent, /Review 1 attempt/);
  assert.match(env.get("task-list").textContent, /No confirmed completions/);
});

test("failed task saves do not leave a fake task in the board", async () => {
  const env = environment({ tasks: [], saveOk: false });
  const created = await env.api.addTask("This must be saved");
  assert.equal(created, null);
  assert.equal(env.api.state.tasks.length, 0);
  assert.match(env.notifications.at(-1), /could not be written/);
});

test("the selected task stays visible when a completion arrives while viewing open work", async () => {
  const env = environment({ tasks: [{ id: "one", title: "Finish me", status: "open" }], filter: "open" });
  await env.api.open({ taskId: "one" });
  env.broadcast([{ id: "one", title: "Finish me", status: "done", doneAt: 400 }]);
  assert.equal(env.api.state.filter, "done");
  assert.match(env.get("task-list").textContent, /Finish me/);
});

test("an in-flight board load cannot overwrite a newer completion broadcast", async () => {
  let resolve;
  const prefsWait = new Promise((done) => { resolve = done; });
  const env = environment({ tasks: [{ id: "one", title: "Finish me", status: "open" }], prefsWait });
  const opening = env.api.open();
  env.broadcast([{ id: "one", title: "Finish me", status: "done", doneAt: 400 }]);
  resolve();
  await opening;
  assert.equal(env.api.state.tasks[0].status, "done");
  assert.equal(env.api.summary().done, 1);
});
