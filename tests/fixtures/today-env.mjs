// renderer/today.js in a vm, over the shared fake DOM (tests/fixtures/renderer-dom.mjs),
// a stand-in for renderer/vibe.js (data(), watch(), refresh()), a recording desktop
// bridge and the few Studio modules it asks (nav, tabs, autonomy, toast, the
// two-press button). One loader for every Today suite, so a suite states only the
// board it cares about.
//
//   const t = await loadToday({ data: board({ needs: [...] }) });
//   await t.settle();                       // let the page paint (it coalesces on a microtask)
//   t.push(board({ ... }));                 // a push from the host: vibe's watcher is told
//   t.calls                                  // every host call, in order: ["assistantAnswer", { ... }]
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./renderer-dom.mjs";

const source = await readFile(new URL("../../renderer/today.js", import.meta.url), "utf8");
export const P = "p1";
export const plain = (value) => JSON.parse(JSON.stringify(value));
export const settle = async () => { for (let turn = 0; turn < 12; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };
export const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);

// ---- what vibe.js would hold (needs(), lanes()), as data() gives it ----------------------
export const question = (over = {}) => ({ id: "q1", status: "open", title: "Should #Work and #work count as the same tag?", at: NOW - 4 * 60000, context: { taskId: "t1", taskTitle: "Search notes by tag", severity: "decision" },
  options: [{ id: "yes", label: "Yes, ignore case", recommended: true }, { id: "no", label: "Keep them separate" }, { id: "say", label: "Answer it in one line", text: true }], ...over });
export const needQuestion = (over = {}) => { const q = question(over); return { kind: "question", id: q.id, tone: "ask", verb: "Answer", title: q.title, meta: "decision", question: q }; };
export const needApproval = (over = {}) => ({ kind: "approval", id: "t5", tone: "ask", verb: "Review", title: "Add a changelog page", meta: "waiting for your go-ahead", row: { id: "t5", canApprove: true, buildScope: "scope-5" }, ...over });
export const needFamily = (over = {}) => ({ kind: "family", id: "t10", tone: "ask", verb: "Review", title: "Split the settings page", meta: "2 steps waiting for your go-ahead", rows: [{ id: "t11", buildScope: "s11", canApprove: true }, { id: "t12", buildScope: "s12", canApprove: true }], ...over });
export const needBlocked = (over = {}) => ({ kind: "blocked", id: "t6", tone: "bad", verb: "Try again", title: "Fix the login redirect loop", meta: "stuck", row: { id: "t6", blockedBy: "loop", reason: "The same check failed three times.", canRetry: true }, ...over });
export const needReview = (over = {}) => ({ kind: "review", id: "t7", tone: "check", verb: "Review", title: "Rename the settings tab", meta: "finished · check the result", ...over });
export const needPlan = (over = {}) => ({ kind: "plan", id: "pl1", tone: "ask", verb: "Review", title: "Offline mode", meta: "its specification waits for your approval", ...over });

/** A `MefiVibe.data()` picture. `needs` are vibe.js rows; the digest (assistant.needsYou) is built from them unless given. */
export function board({ needs = [], running = [], checking = [], next = [], tasks = [], ideas = [], families = [], messages = [], digest = true, projectId = P, projectName = "Sunrise" } = {}) {
  const items = needs.filter((need) => need.kind !== "plan").map((need) => ({ id: need.kind === "question" ? need.id : need.kind === "blocked" ? `parked:${need.id}` : need.kind === "review" ? `review:${need.id}` : `approval:${need.id}`, kind: need.kind === "family" ? "approval" : need.kind === "blocked" ? "parked" : need.kind, title: need.title, at: need.kind === "question" ? need.question.at : NOW - 6 * 60000 }));
  return { projectId, projectName, tasks, needs, running, checking, next, backlog: null, status: {}, ideas, plans: [], families, gate: null, companion: "Mefi", person: "",
    assistant: { projectId, status: "running", questions: needs.filter((need) => need.kind === "question").map((need) => need.question), messages, ...(digest ? { needsYou: { items, counts: { total: items.length } } } : {}) } };
}

/** A running job as vibe.js lists it (`running`), and a finished task. */
export const job = (over = {}) => ({ taskId: "t3", title: "Add dark mode to the settings page", progress: 0.4, phase: "building", startedAt: NOW - 2 * 60000, ...over });
export const finished = (over = {}) => ({ id: "t20", title: "Fix the typo on the about page", status: "done", doneAt: NOW - 3600000, ...over });

/** The front door's own markup, as renderer/booklet.template.html has it (the parts Today borrows and the parts it leaves), with the sibling links the fake DOM lacks. */
export function vibeLayer({ document, get }) {
  const siblings = (node) => { Object.defineProperty(node, "nextSibling", { get() { const list = this.parentNode?.children; return list ? list[list.indexOf(this) + 1] ?? null : null; }, configurable: true }); return node; };
  const make = (tag, className, children = []) => { const node = siblings(document.createElement(tag)); node.className = className; node.append(...children); return node; };
  const named = (id, className = "", tag = "div") => { const node = siblings(get(id)); node.tagName = tag; if (className) node.className = className; return node; };
  const layer = siblings(get("vibe-layer"));
  layer.className = "vibe";
  layer.hidden = true;
  const top = make("header", "vibe-top", [
    make("div", "vibe-top-left", [named("vibe-project", "vibe-project", "button"), named("vibe-new-app", "vibe-icon", "button")]),
    make("div", "mode-switch"),
    make("div", "vibe-top-actions", [named("vibe-update", "vibe-pulse", "button"), named("vibe-pulse", "vibe-pulse", "button"), named("vibe-chat-toggle", "vibe-icon", "button")]),
  ]);
  const stage = make("div", "vibe-stage", [
    make("div", "vibe-hero", [make("p", "vibe-kicker"), make("h1", "")]),
    named("vibe-compose", "vibe-compose", "form"), named("vibe-flow", "vibe-flow-slot"), named("vibe-feedback", "vibe-feedback", "p"), named("vibe-sparks", "vibe-sparks"),
    named("vibe-decisions", "vibe-ask-link", "button"), named("vibe-gate", "vibe-gate"), make("section", "vibe-lanes"), named("vibe-quiet", "vibe-quiet", "p"), named("vibe-last", "vibe-last", "button"),
  ]);
  layer.append(make("div", "vibe-sky"), top, stage, named("vibe-dock", "vibe-dock", "nav"));
  const order = (node) => node.children.map((child) => child.id || child.className.split(" ")[0]);
  return { layer, top, stage, order };
}

/**
 * Loads renderer/today.js. `layout` is what html[data-layout] says (v1: the script starts nothing).
 * `bridge` adds or replaces host calls; every call is recorded in `calls` as [name, args].
 */
export async function loadToday({ layout = "v2", detail = null, data = board(), bridge = {}, extras = {}, mode = "vibe", active = false, layer = false } = {}) {
  const calls = [];
  const events = {};
  const timers = [];
  const { document, get, body, documentElement } = createDom({ ids: templateIds((id) => /^(today|inbox|vibe)-/.test(id)) });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  documentElement.dataset = {};
  if (layout) documentElement.dataset.layout = layout;
  if (detail) documentElement.dataset.detail = detail;
  for (const id of ["today-overlay", "inbox-overlay"]) get(id).hidden = true;
  const front = layer ? vibeLayer({ document, get }) : null;
  const record = (name, reply) => async (args) => { calls.push([name, plain(args)]); return typeof reply === "function" ? reply(args) : reply; };
  const mefiStudio = {
    assistantAnswer: record("assistantAnswer", { ok: true }),
    backlogControl: record("backlogControl", { ok: true }),
    tasksAction: record("tasksAction", { ok: true }),
    autonomyUndo: record("autonomyUndo", { ok: true }),
    ...Object.fromEntries(Object.entries(bridge).map(([name, reply]) => [name, record(name, reply)])),
  };
  // vibe.js, reduced to what today.js asks of it.
  const watchers = new Set();
  const vibe = { current: data, refreshes: 0, active, watchers };
  const MefiVibe = {
    data: () => vibe.current,
    watch: (callback) => { watchers.add(callback); return () => watchers.delete(callback); },
    refresh: async () => { vibe.refreshes += 1; for (const callback of [...watchers]) callback(); },
    isActive: () => vibe.active, mode: () => mode,
    openPanel: (kind) => calls.push(["openPanel", kind]),
  };
  const nav = {
    registered: [], gone: [], claimed: [], released: [], closed: [],
    register(record) { nav.registered.push(record); return record; },
    go(id, params) { nav.gone.push([id, plain(params ?? null)]); },
    claim(id) { nav.claimed.push(id); }, release(id) { nav.released.push(id); },
    // As nav.js does: close(id) asks the record's own close(), and answers nothing.
    close(id) { nav.closed.push(id); nav.registered.find((entry) => entry.id === id)?.close?.(); },
    usable: () => ({ left: 64, top: 56, right: 1100, bottom: 700, width: 1036, height: 644 }),
  };
  // The two-press button, as studio-ui.js makes it: the first press asks, the second acts.
  const arm = (button, { run, armed = "Really?" } = {}) => {
    let asking = false; const resting = { text: null };
    button.classList.add("danger");
    button.addEventListener("click", (event) => { if (!asking) { asking = true; resting.text = button.textContent; button.textContent = armed; button.classList.add("danger-armed"); return; } asking = false; button.classList.remove("danger-armed"); button.textContent = resting.text; run(event); });
    return button;
  };
  // studio-ui.js's own rule for what a person may read of an error: a sentence passes, a programming error reads as the fallback.
  const plainError = (error, fallback = "That did not work. Try again.") => {
    if (error && typeof error === "object" && ["TypeError", "SyntaxError", "ReferenceError", "RangeError"].includes(error.name)) return fallback;
    let text = typeof error === "string" ? error : error?.message || error?.error || "";
    text = String(text).replace(/^Error invoking remote method '[^']*':\s*/i, "").replace(/^(Error|TypeError|SyntaxError):\s*/, "").trim();
    if (!text || /^[a-z0-9_.-]+$/.test(text)) return fallback;
    if (/cannot read propert|is not a function|is not defined|is not valid json|unexpected (token|end)|\bundefined\b|\[object /i.test(text)) return fallback;
    return text[0].toUpperCase() + text.slice(1);
  };
  const toasts = [];
  const window = {
    mefiStudio, MefiVibe, MefiNav: nav,
    MefiUi: { arm, plainError },
    MefiToast: (text, tone) => toasts.push([text, tone]),
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    removeEventListener(name, callback) { events[name] = (events[name] || []).filter((entry) => entry !== callback); },
    dispatchEvent(event) { for (const callback of [...(events[event.type] || [])]) callback(event); return true; },
    innerWidth: 1200, innerHeight: 800,
    ...extras,
  };
  // The clock the page reads: fixed at NOW, moved by `t.clock.now`, so "4 min" and "done today" are the same on every run.
  const clock = { now: NOW };
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(clock.now); else super(...args); }
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    window, document, console,
    setTimeout: (callback, ms) => { timers.push({ callback, ms, id: timers.length + 1, cancelled: false }); return timers.length; }, clearTimeout: (id) => { const timer = timers[id - 1]; if (timer) timer.cancelled = true; },
    setInterval: (callback, ms) => { timers.push({ callback, ms, every: true, id: timers.length + 1, cancelled: false }); return timers.length; }, clearInterval: (id) => { const timer = timers[id - 1]; if (timer) timer.cancelled = true; },
    requestAnimationFrame: (callback) => { callback(); return 0; },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Date: FakeDate,
  });
  vm.runInContext(source, context);
  const key = (value, { target = body, ...more } = {}) => {
    let prevented = false;
    const event = { type: "keydown", key: value, target, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() {}, ...more };
    for (const callback of events.keydown || []) callback(event);
    return prevented;
  };
  // A key pressed inside the Inbox popover (its own listener, not the window's).
  const inboxKey = (value, { target, ...more } = {}) => {
    const node = document.querySelector("#today-inbox");
    let prevented = false;
    const event = { type: "keydown", key: value, target: target ?? node, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, get defaultPrevented() { return prevented; }, preventDefault() { prevented = true; }, stopPropagation() {}, ...more };
    for (const callback of node?.listeners?.keydown ?? []) callback(event);
    return prevented;
  };
  const push = async (next) => { vibe.current = next; for (const callback of [...watchers]) callback(); await settle(); };
  const fire = async (kind = "timeout") => { for (const timer of timers.splice(0)) if (!timer.cancelled && (kind === "all" || !timer.every)) { await timer.callback(); } await settle(); };
  const inbox = () => document.querySelector("#today-inbox");
  const text = (node) => (node ? node.textContent : "");
  return { window, document, get, body, documentElement, front, today: window.MefiToday, clock, calls, nav, vibe, toasts, events, timers, key, inboxKey, push, fire, inbox, text, settle, callsOf: (name) => calls.filter((call) => call[0] === name).map((call) => call[1]) };
}
