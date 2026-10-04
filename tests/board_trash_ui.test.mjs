// The page side of Recently deleted (ZA3): the Task board's Delete toast with
// Undo, the Recently deleted list under More, and the same for ideas (a toast
// with Undo after Delete and Clear finished ideas, the list under Tools, and
// "From you" for an idea the owner typed). Renderer scripts run in vm sandboxes
// with a fake DOM and a fake bridge; nothing here touches a real host.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const tasksSource = await readFile(new URL("../renderer/tasks.js", import.meta.url), "utf8");
const ideasSource = await readFile(new URL("../renderer/ideas.js", import.meta.url), "utf8");
const stageSource = await readFile(new URL("../renderer/stage-labels.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const settle = async () => { for (let index = 0; index < 40; index += 1) await Promise.resolve(); };

class Element {
  constructor(tag = "div", ownerDocument = null) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attrs = {};
    this.ownerDocument = ownerDocument; this.hidden = false; this.value = ""; this.open = false; this.title = "";
    this.style = { setProperty() {} }; this.clientWidth = 500;
    this.classes = new Set();
    this.classList = { add: (...names) => names.forEach((n) => this.classes.add(n)), contains: (n) => this.classes.has(n), toggle: (n, on) => (on ? this.classes.add(n) : this.classes.delete(n)) };
  }
  // className is a plain string in scripts and a class list in styles: keep both in step, as a real element does.
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value ?? "").split(/\s+/).filter(Boolean)); }
  set textContent(text) { this.ownText = String(text); this.children = []; }
  get textContent() { return (this.ownText ?? "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  insertBefore(child, next) { const index = this.children.indexOf(next); child.parentElement = this; this.children.splice(index < 0 ? this.children.length : index, 0, child); }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  querySelectorAll(selector) {
    const match = (el) => selector === "[data-filter]" ? !!el.dataset.filter : selector === "li.selected" ? el.tagName === "li" && el.classes.has("selected") : false;
    return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return selector === "summary" ? (this.children.find((child) => child.tagName === "summary") ?? null) : (this.querySelectorAll(selector)[0] ?? null); }
  closest() { return this; }
  contains(element) { return Boolean(element) && (element === this || this.children.some((child) => child.contains(element))); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  dispatch(name, extra = {}) { for (const fn of this.listeners[name] ?? []) fn({ target: this, stopPropagation() {}, preventDefault() {}, ...extra }); }
  click() { this.dispatch("click"); }
}
const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
const rows = (list) => list.children.filter((child) => child.classes.has("recent-deleted-row"));
const cells = (row) => Object.fromEntries(row.children.map((child) => [[...child.classes][0] ?? child.tagName, child.textContent]));

// ---- the Task board -------------------------------------------------------------
function tasksEnvironment({ tasks = [], bridge = {}, plainBridge = false } = {}) {
  const els = new Map();
  const documentListeners = {};
  const document = { readyState: "loading", activeElement: null, getElementById: (id) => get(id), createElement: (tag) => new Element(tag, document), querySelectorAll: () => [], addEventListener: (name, fn) => { documentListeners[name] = fn; } };
  const get = (id) => { if (!els.has(id)) els.set(id, new Element("div", document)); return els.get(id); };
  for (const filter of ["all", "open", "done"]) { const button = new Element("button"); button.dataset.filter = filter; get("task-filters").append(button); }
  get("tasks-tools").append(new Element("summary"));
  const toasts = [];
  const calls = [];
  const bridgeCalls = (name) => JSON.parse(JSON.stringify(calls.filter((call) => call.name === name).map((call) => call.payload)));
  const listed = { tasks: structuredClone(tasks) };
  const track = (name, fn) => async (payload) => { calls.push({ name, payload: structuredClone(payload) }); return fn(payload); };
  const context = vm.createContext({
    window: {
      mefiStudio: {
        tasksList: async () => ({ ok: true, projectId: "p", tasks: structuredClone(listed.tasks) }),
        tasksSave: async () => ({ ok: true }),
        prefsGet: async () => ({ ok: true, prefs: { taskFilter: "all", autoReference: false } }),
        prefsSet: async () => ({ ok: true, prefs: {} }),
        onTasks() {}, onProjects() {}, onAssistantStatus() {},
        ...(plainBridge ? {} : {
          tasksDelete: track("tasksDelete", async ({ taskId }) => { listed.tasks = listed.tasks.filter((task) => task.id !== taskId); return { ok: true, tasks: structuredClone(listed.tasks), trashed: [{ kind: "task", id: taskId, title: "kept", deletedAt: 1 }] }; }),
          tasksUndelete: track("tasksUndelete", async ({ taskId }) => ({ ok: true, projectId: "p", tasks: structuredClone(tasks), task: tasks.find((task) => task.id === taskId) })),
          boardTrash: track("boardTrash", async () => ({ ok: true, enabled: true, projectId: "p", keptDays: 30, max: 50, items: [] })),
          ideasAction: track("ideasAction", async () => ({ ok: true })),
        }),
        ...bridge,
      },
      MefiNav: { setBadge() {}, claim() {}, release() {} },
      MefiBoot: { pollStart() {} },
      MefiToast: (text, kind, options) => { toasts.push({ text, kind, options }); return { dismiss() {} }; },
      dispatchEvent: () => true,
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    document, setTimeout: () => 0, setInterval() {}, console,
  });
  vm.runInContext(stageSource, context);
  vm.runInContext(tasksSource, context);
  const api = context.window.MefiTasks;
  api.init();
  return { api, get, toasts, calls, bridgeCalls, listed, window: context.window, documentListeners };
}

async function deleteViaButtons(env, title = "Delete") {
  const button = () => env.get("task-status-row").children.find((child) => child.textContent === title);
  button().click();
  const armed = env.get("task-status-row").children.find((child) => child.textContent === "Really delete?");
  assert.ok(armed, "the first press arms the delete");
  armed.click();
  await settle();
}

test("the template carries the More menu on the Task board and the recent list in both menus", () => {
  assert.match(template, /<details class="surface-tools" id="tasks-tools"><summary>More<\/summary>/);
  assert.match(template, /<section class="recent-deleted" id="tasks-recent" aria-label="Recently deleted" hidden><\/section>/);
  assert.match(template, /<section class="recent-deleted" id="ideas-recent" aria-label="Recently deleted ideas" hidden><\/section>/);
});

test("deleting a task that Recently deleted kept says Deleted “…” with an Undo for about eight seconds", async () => {
  const task = { id: "one", projectId: "p", title: "Export notes as Markdown", status: "open" };
  const env = tasksEnvironment({ tasks: [task, { id: "two", projectId: "p", title: "Another task", status: "open" }] });
  await env.api.open({ taskId: "one" });
  await deleteViaButtons(env);
  assert.deepEqual(env.bridgeCalls("tasksDelete"), [{ taskId: "one", projectId: "p" }]);
  assert.equal(env.api.state.tasks.some((row) => row.id === "one"), false, "the card leaves the board at once");
  assert.equal(env.toasts.length, 1);
  const [toast] = env.toasts;
  assert.equal(toast.text, "Deleted “Export notes as Markdown”");
  assert.equal(toast.kind, "good");
  assert.equal(toast.options.action.label, "Undo");
  assert.equal(toast.options.duration, 8000);
  // Undo asks the host to put it back, then shows the card again and says so.
  toast.options.action.run();
  await settle();
  assert.deepEqual(env.bridgeCalls("tasksUndelete"), [{ taskId: "one", projectId: "p" }]);
  assert.equal(env.api.state.tasks.some((row) => row.id === "one"), true, "the restored card is back on the board");
  assert.equal(env.api.state.selected, "one");
  assert.equal(env.toasts.at(-1).text, "Put back “Export notes as Markdown”");
  assert.equal(env.toasts.at(-1).kind, "good");
});

test("a long title is cut in the toast, and a restore that comes with a warning says so", async () => {
  const title = "Rework the saved filter panel so every filter keeps its state across project switches and reloads";
  const task = { id: "long", projectId: "p", title, status: "open" };
  const env = tasksEnvironment({ tasks: [task], bridge: { tasksUndelete: async () => ({ ok: true, projectId: "p", tasks: [task], warning: "It waits for a task that is no longer on the board. Open it to change its prerequisites." }) } });
  await env.api.open({ taskId: "long" });
  await deleteViaButtons(env);
  assert.equal(env.toasts[0].text, "Deleted “Rework the saved filter panel so every…”");
  env.toasts[0].options.action.run();
  await settle();
  assert.match(env.toasts.at(-1).text, /^Put back “Rework the saved filter panel so every…” · It waits for a task that is no longer on the board/);
  assert.equal(env.toasts.at(-1).kind, "warn");
});

test("when nothing was kept (Recently deleted is switched off) the toast is the plain one with no Undo", async () => {
  const task = { id: "one", projectId: "p", title: "Export notes", status: "open" };
  const env = tasksEnvironment({ tasks: [task], bridge: { tasksDelete: async () => ({ ok: true, tasks: [] }) } });
  await env.api.open({ taskId: "one" });
  await deleteViaButtons(env);
  assert.equal(env.toasts.at(-1).text, "Task deleted · Export notes");
  assert.equal(env.toasts.at(-1).options, undefined);
  // A build whose bridge has no undelete never offers one either, even if the host kept it.
  const old = tasksEnvironment({ tasks: [task], bridge: { tasksUndelete: undefined } });
  await old.api.open({ taskId: "one" });
  await deleteViaButtons(old);
  assert.equal(old.toasts.at(-1).text, "Task deleted · Export notes");
});

test("a delete the host refused still puts the card back and says why, with no Undo offered", async () => {
  const task = { id: "one", projectId: "p", title: "Export notes", status: "open" };
  const env = tasksEnvironment({ tasks: [task], bridge: { tasksDelete: async () => ({ ok: false, error: "Nothing was deleted: Studio could not keep a copy in Recently deleted first (disk full)." }) } });
  await env.api.open({ taskId: "one" });
  await deleteViaButtons(env);
  assert.equal(env.api.state.tasks.some((row) => row.id === "one"), true);
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.match(env.toasts.at(-1).text, /Task not deleted · Nothing was deleted: Studio could not keep a copy/);
  assert.equal(env.toasts.at(-1).options, undefined);
});

test("an Undo the host refuses says why and leaves the board alone", async () => {
  const task = { id: "one", projectId: "p", title: "Export notes", status: "open" };
  const env = tasksEnvironment({ tasks: [task], bridge: { tasksUndelete: async () => ({ ok: false, error: "“Export notes” is already on the board again, so the deleted copy was not put over it. It stays in Recently deleted." }) } });
  await env.api.open({ taskId: "one" });
  await deleteViaButtons(env);
  env.toasts[0].options.action.run();
  await settle();
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.match(env.toasts.at(-1).text, /^Not put back · “Export notes” is already on the board again/);
  assert.equal(env.api.state.tasks.some((row) => row.id === "one"), false);
  const thrown = tasksEnvironment({ tasks: [task], bridge: { tasksUndelete: async () => { throw new Error("bridge down"); } } });
  await thrown.api.open({ taskId: "one" });
  await deleteViaButtons(thrown);
  thrown.toasts[0].options.action.run();
  await settle();
  assert.equal(thrown.toasts.at(-1).text, "Not put back · bridge down");
});

const trashItem = (extra = {}) => ({ kind: "task", id: "t1", title: "Fix the login", status: "open", deletedAt: Date.now() - 2 * 3600000, expiresAt: Date.now() + 29 * 86400000, by: "owner", via: "tasks:delete", restorable: true, ...extra });

test("More › Recently deleted lists what can be put back, newest first, and reads it each time the menu opens", async () => {
  const items = [trashItem({ kind: "idea", id: "i1", title: "Dark mode", deletedAt: Date.now() - 60000 }), trashItem()];
  const env = tasksEnvironment({ bridge: { boardTrash: async (payload) => { env.calls.push({ name: "boardTrash", payload }); return { ok: true, enabled: true, projectId: "p", keptDays: 30, max: 50, items }; } } });
  const tools = env.get("tasks-tools");
  tools.open = true;
  tools.dispatch("toggle");
  await settle();
  const container = env.get("tasks-recent");
  assert.equal(container.hidden, false);
  assert.equal(container.children[0].textContent, "Recently deleted");
  const list = container.children[1];
  assert.deepEqual(rows(list).map((row) => [row.dataset.kind, row.dataset.id]), [["idea", "i1"], ["task", "t1"]]);
  assert.deepEqual(cells(rows(list)[0]), { "recent-deleted-kind": "Idea", "recent-deleted-name": "Dark mode", "recent-deleted-when": "Deleted 1m ago", ghost: "Restore" });
  assert.equal(cells(rows(list)[1])["recent-deleted-when"], "Deleted 2h ago");
  assert.match(container.children[2].textContent, /Kept for 30 days/);
  assert.equal(container.children[2].attrs.role, "status");
  // Closing and opening reads again.
  tools.open = false; tools.dispatch("toggle");
  assert.equal(env.bridgeCalls("boardTrash").length, 1, "closing reads nothing");
  tools.open = true; tools.dispatch("toggle");
  await settle();
  assert.equal(env.bridgeCalls("boardTrash").length, 2);
});

test("Restore on a task calls the host, says so, and refreshes the list; on an idea it uses the ideas action", async () => {
  let items = [trashItem(), trashItem({ kind: "idea", id: "i1", title: "Dark mode" })];
  const env = tasksEnvironment({ bridge: {
    boardTrash: async () => ({ ok: true, enabled: true, projectId: "p", keptDays: 30, max: 50, items }),
    tasksUndelete: async (payload) => { env.calls.push({ name: "tasksUndelete", payload }); items = items.filter((item) => item.id !== payload.taskId); return { ok: true, projectId: "p", tasks: [] }; },
    ideasAction: async (payload) => { env.calls.push({ name: "ideasAction", payload }); items = items.filter((item) => item.id !== payload.ideaId); return { ok: true, projectId: "p", ideas: [] }; },
  } });
  const tools = env.get("tasks-tools");
  tools.open = true; tools.dispatch("toggle"); await settle();
  const list = () => env.get("tasks-recent").children[1];
  const restoreOf = (id) => descendants(list()).find((el) => el.tagName === "button" && el.parentElement.dataset.id === id);
  restoreOf("t1").click();
  await settle();
  assert.deepEqual(env.bridgeCalls("tasksUndelete"), [{ taskId: "t1", projectId: "p" }]);
  assert.equal(env.toasts.at(-1).text, "Put back “Fix the login”");
  assert.deepEqual(rows(list()).map((row) => row.dataset.id), ["i1"], "the row is gone once the list is read again");
  restoreOf("i1").click();
  await settle();
  assert.deepEqual(env.bridgeCalls("ideasAction"), [{ action: "restore", ideaId: "i1", projectId: "p" }]);
  assert.equal(env.toasts.at(-1).text, "Put back “Dark mode”");
  assert.equal(rows(list()).length, 0);
  assert.match(env.get("tasks-recent").children[2].textContent, /Nothing deleted lately\. What you delete stays here for 30 days\./);
});

test("a row whose card is back is offered greyed out, and a refused restore says why and keeps the row", async () => {
  const items = [trashItem({ restorable: false, reason: "already-there" }), trashItem({ id: "t2", title: "Second" })];
  const env = tasksEnvironment({ bridge: {
    boardTrash: async () => ({ ok: true, enabled: true, projectId: "p", keptDays: 30, max: 50, items }),
    tasksUndelete: async () => ({ ok: false, error: "That task is not in Recently deleted any more." }),
  } });
  const tools = env.get("tasks-tools");
  tools.open = true; tools.dispatch("toggle"); await settle();
  const list = env.get("tasks-recent").children[1];
  const buttons = descendants(list).filter((el) => el.tagName === "button");
  assert.equal(buttons[0].disabled, true);
  assert.match(buttons[0].title, /already back/);
  assert.equal(buttons[1].disabled ?? false, false);
  buttons[1].click();
  await settle();
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.equal(env.toasts.at(-1).text, "Not put back · That task is not in Recently deleted any more.");
  assert.equal(rows(env.get("tasks-recent").children[1]).length, 2, "nothing disappears on a refusal");
});

test("the list says so when Recently deleted is switched off, when it cannot be read, and hides More with no bridge", async () => {
  const off = tasksEnvironment({ bridge: { boardTrash: async () => ({ ok: true, enabled: false, items: [], projectId: "p" }) } });
  off.get("tasks-tools").open = true; off.get("tasks-tools").dispatch("toggle"); await settle();
  assert.match(off.get("tasks-recent").children[2].textContent, /Switched off for this run of Studio, so deletes are for good\./);
  assert.equal(rows(off.get("tasks-recent").children[1]).length, 0);
  const broken = tasksEnvironment({ bridge: { boardTrash: async () => ({ ok: false, error: "Recently deleted could not be read: permission denied" }) } });
  broken.get("tasks-tools").open = true; broken.get("tasks-tools").dispatch("toggle"); await settle();
  assert.equal(broken.get("tasks-recent").children[2].textContent, "Could not be read · permission denied", "the host's own words, without the list's name said twice");
  const thrown = tasksEnvironment({ bridge: { boardTrash: async () => { throw new Error("bridge down"); } } });
  thrown.get("tasks-tools").open = true; thrown.get("tasks-tools").dispatch("toggle"); await settle();
  assert.equal(thrown.get("tasks-recent").children[2].textContent, "Could not be read · bridge down");
  const bare = tasksEnvironment({ bridge: { boardTrash: async () => ({ ok: false }) } });
  bare.get("tasks-tools").open = true; bare.get("tasks-tools").dispatch("toggle"); await settle();
  assert.equal(bare.get("tasks-recent").children[2].textContent, "Could not be read · try again");
  const plain = tasksEnvironment({ plainBridge: true });
  assert.equal(plain.get("tasks-tools").hidden, true, "a browser preview has no list, so it has no More menu");
});

test("a list read that lands after a newer one for the same place is dropped", async () => {
  const pending = [];
  const env = tasksEnvironment({ bridge: { boardTrash: () => new Promise((resolve) => pending.push(resolve)) } });
  const tools = env.get("tasks-tools");
  tools.open = true; tools.dispatch("toggle");
  tools.open = false; tools.dispatch("toggle");
  tools.open = true; tools.dispatch("toggle");
  assert.equal(pending.length, 2);
  const answer = (id) => ({ ok: true, enabled: true, projectId: "p", keptDays: 30, items: [trashItem({ id, title: `Row ${id}` })] });
  pending[1](answer("new")); await settle();
  pending[0](answer("old")); await settle();
  assert.deepEqual(rows(env.get("tasks-recent").children[1]).map((row) => row.dataset.id), ["new"]);
});

test("More closes with Esc and with a click outside, and with the sheet", async () => {
  const env = tasksEnvironment();
  const tools = env.get("tasks-tools");
  tools.open = true;
  const keydown = { prevented: false };
  tools.dispatch("keydown", { key: "Escape", preventDefault() { keydown.prevented = true; } });
  assert.equal(tools.open, false);
  assert.equal(keydown.prevented, true);
  tools.open = true;
  env.documentListeners.pointerdown({ target: env.get("task-list") });
  assert.equal(tools.open, false);
  tools.open = true;
  env.documentListeners.pointerdown({ target: tools });
  assert.equal(tools.open, true, "a click inside it keeps it open");
  await env.api.open();
  env.get("tasks-overlay").hidden = false;
  env.api.close();
  assert.equal(tools.open, false);
});

// ---- the Ideas sheet ------------------------------------------------------------
function ideasEnvironment({ ideas = [], trash = true, bridge = {}, withTasks = false } = {}) {
  const els = new Map(); const documentListeners = new Map();
  const context = new Proxy({}, { get: () => () => {}, set: () => true });
  let document;
  class IdeasElement extends Element {
    constructor(tag = "div") { super(tag, null); this.style = { setProperty() {} }; }
    getContext() { return context; }
    closest(selector) { return selector === this.tagName ? this : this.parentElement?.closest?.(selector) || null; }
  }
  const get = (name) => { const id = `ideas-${name}`; if (!els.has(id)) els.set(id, new IdeasElement()); return els.get(id); };
  get("canvas").hidden = true; get("graph-col").hidden = true; get("graph-col").append(get("canvas"));
  get("tools").append(new IdeasElement("summary"));
  const toasts = []; const actions = []; const confirms = []; const recents = [];
  let current = structuredClone(ideas);
  const window = {
    mefiStudio: {
      ideasList: async () => ({ ok: true, projectId: "project-a", ideas: structuredClone(current), trash }),
      ideasAction: async (payload) => {
        actions.push(structuredClone(payload));
        if (payload.action === "delete") { const gone = current.find((idea) => idea.id === payload.ideaId); current = current.filter((idea) => idea.id !== payload.ideaId); return { ok: true, ideas: structuredClone(current), trashed: trash ? [{ kind: "idea", id: gone.id, title: gone.title, deletedAt: 1 }] : undefined }; }
        if (payload.action === "clean") { const gone = current.filter((idea) => payload.ideaIds.includes(idea.id) && idea.status === "done"); current = current.filter((idea) => !gone.includes(idea)); return { ok: true, ideas: structuredClone(current), ...(trash ? { trashed: gone.map((idea) => ({ kind: "idea", id: idea.id, title: idea.title, deletedAt: 1 })) } : {}), ...(payload.notKept ? {} : {}) }; }
        if (payload.action === "restore") return { ok: true, ideas: structuredClone(current), restored: { kind: "idea", id: payload.ideaId } };
        return { ok: true };
      },
      ...bridge,
    },
    MefiNav: { claim() {}, release() {}, setBadge() {} },
    MefiToast: (text, kind, options) => { toasts.push({ text, kind, options }); return { dismiss() {} }; },
    MefiConfirm: async (text, options) => { confirms.push({ text, options }); return true; },
    ...(withTasks ? { MefiTasks: { showRecentlyDeleted: (container, options) => recents.push({ container, options }) } } : {}),
  };
  document = { readyState: "complete", getElementById: (id) => get(id.replace(/^ideas-/, "")), createElement: (tag) => new IdeasElement(tag), createTextNode: (text) => ({ textContent: String(text) }), addEventListener: (type, fn) => documentListeners.set(type, fn) };
  vm.runInContext(ideasSource, vm.createContext({ window, document }));
  return { ui: window.MefiIdeas, get, toasts, actions, confirms, recents, window, setCurrent: (rows) => { current = structuredClone(rows); } };
}
const detailButtons = (env) => env.get("detail").children.find((child) => child.className === "row").children;
const idea = (id, extra = {}) => ({ id, title: `Idea ${id}`, detail: `Detail ${id}`, source: "chat", at: 1, read: true, tags: [], status: "new", ...extra });

test("deleting an idea asks what is true, then offers Undo for about eight seconds", async () => {
  const env = ideasEnvironment({ ideas: [idea("i1"), idea("i2")] });
  env.ui.open({ ideaId: "i1" }); await settle();
  detailButtons(env).find((button) => button.textContent === "Delete").click();
  await settle();
  assert.match(env.confirms[0].text, /^Delete the idea "Idea i1"\? You can bring it back from Recently deleted for 30 days\.$/);
  assert.equal(env.confirms[0].options.label, "Delete");
  assert.deepEqual(env.actions.find((action) => action.action === "delete"), { action: "delete", ideaId: "i1", projectId: "project-a" });
  const toast = env.toasts.at(-1);
  assert.equal(toast.text, "Deleted “Idea i1”");
  assert.equal(toast.kind, "good");
  assert.equal(toast.options.action.label, "Undo");
  assert.equal(toast.options.duration, 8000);
  assert.doesNotMatch(env.get("list").textContent, /Idea i1/, "it is gone from the list");
  env.setCurrent([idea("i1"), idea("i2")]);
  toast.options.action.run();
  await settle();
  assert.deepEqual(env.actions.filter((action) => action.action === "restore"), [{ action: "restore", ideaId: "i1", projectId: "project-a" }]);
  assert.equal(env.toasts.at(-1).text, "Put back “Idea i1”");
  assert.match(env.get("list").textContent, /Idea i1/, "and back in it");
});

test("with Recently deleted off the question says it cannot be undone, and no Undo is offered", async () => {
  const env = ideasEnvironment({ ideas: [idea("i1")], trash: false });
  env.ui.open({ ideaId: "i1" }); await settle();
  detailButtons(env).find((button) => button.textContent === "Delete").click();
  await settle();
  assert.match(env.confirms[0].text, /This cannot be undone\.$/);
  assert.equal(env.toasts.length, 0, "no toast, as before");
});

test("Clear finished ideas offers one Undo for all of them, and says when only the newest could be kept", async () => {
  const env = ideasEnvironment({ ideas: [idea("i1", { status: "done" }), idea("i2", { status: "done" }), idea("i3")] });
  env.ui.open(); await settle();
  env.get("clean").click();
  await settle();
  const toast = env.toasts.at(-1);
  assert.equal(toast.text, "Removed 2 finished ideas");
  assert.equal(toast.options.action.label, "Undo");
  env.setCurrent([idea("i1", { status: "done" }), idea("i2", { status: "done" }), idea("i3")]);
  toast.options.action.run();
  await settle();
  assert.deepEqual(env.actions.filter((action) => action.action === "restore").map((action) => action.ideaId), ["i1", "i2"]);
  assert.equal(env.toasts.at(-1).text, "Put back 2 ideas");
  // A bulk clean bigger than the list holds says how many can come back.
  const big = ideasEnvironment({ ideas: [idea("i1", { status: "done" })], bridge: { ideasAction: async (payload) => (payload.action === "clean" ? { ok: true, ideas: [], trashed: [{ kind: "idea", id: "i1", title: "Idea i1" }], notKept: 9 } : { ok: true }) } });
  big.ui.open(); await settle();
  big.get("clean").click(); await settle();
  assert.equal(big.toasts.at(-1).text, "Removed 10 finished ideas · the newest 1 can be brought back");
  const single = ideasEnvironment({ ideas: [idea("i1", { status: "done" })] });
  single.ui.open(); await settle();
  single.get("clean").click(); await settle();
  assert.equal(single.toasts.at(-1).text, "Removed 1 finished idea");
});

test("an Undo that fails for some ideas says how many came back and why the rest did not", async () => {
  const env = ideasEnvironment({ ideas: [idea("i1", { status: "done" }), idea("i2", { status: "done" })], bridge: { ideasAction: async (payload) => {
    if (payload.action === "clean") return { ok: true, ideas: [], trashed: [{ kind: "idea", id: "i1", title: "A" }, { kind: "idea", id: "i2", title: "B" }] };
    return payload.ideaId === "i1" ? { ok: true, ideas: [] } : { ok: false, error: "“B” is already in your ideas again, so the deleted copy was not put over it. It stays in Recently deleted." };
  } } });
  env.ui.open(); await settle();
  env.get("clean").click(); await settle();
  env.toasts.at(-1).options.action.run();
  await settle();
  assert.equal(env.toasts.at(-1).kind, "bad");
  assert.match(env.toasts.at(-1).text, /^1 put back · Not put back · “B” is already in your ideas again/);
});

test("the Ideas Tools menu shows the ideas that were deleted, through the same list as the Task board", async () => {
  const env = ideasEnvironment({ ideas: [idea("i1")], withTasks: true });
  env.ui.open(); await settle();
  const tools = env.get("tools");
  tools.open = true; tools.dispatch("toggle");
  assert.equal(env.recents.length, 1);
  assert.equal(env.recents[0].container, env.get("recent"));
  assert.deepEqual(JSON.parse(JSON.stringify(env.recents[0].options)), { kinds: ["idea"], projectId: "project-a" });
  tools.open = false; tools.dispatch("toggle");
  assert.equal(env.recents.length, 1);
  // Without the Task board's script loaded the menu simply has no list.
  const alone = ideasEnvironment({ ideas: [idea("i1")] });
  alone.ui.open(); await settle();
  alone.get("tools").open = true; alone.get("tools").dispatch("toggle");
});

test("an idea the owner typed reads From you, in the list and the detail", async () => {
  const env = ideasEnvironment({ ideas: [idea("mine", { source: "owner", title: "Dark mode", detail: "Follow the system setting.", at: 5 })] });
  env.ui.open({ ideaId: "mine" }); await settle();
  assert.match(env.get("list").textContent, /you · /);
  assert.doesNotMatch(env.get("list").textContent, /owner/);
  assert.match(env.get("detail").textContent, /From you/);
  assert.doesNotMatch(env.get("detail").textContent, /owner/);
  const chat = ideasEnvironment({ ideas: [idea("theirs")] });
  chat.ui.open({ ideaId: "theirs" }); await settle();
  assert.match(chat.get("detail").textContent, /From chat/);
});
