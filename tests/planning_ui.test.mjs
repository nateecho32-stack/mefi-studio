import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import planning from "../scripts/planning.cjs";

const source = await readFile(new URL("../renderer/planning.js", import.meta.url), "utf8");
const stageSource = await readFile(new URL("../renderer/stage-labels.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ""; this.disabled = false; this.hidden = false; this.classList = { add() {} }; }
  set textContent(value) { this.copy = String(value); this.children = []; }
  get textContent() { return (this.copy || "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.copy = ""; this.children = []; this.append(...children); }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  async trigger(name, extra = {}) { if (name === "click" && this.disabled) return; for (const callback of this.listeners[name] || []) await callback({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }); await flush(); }
  querySelectorAll(selector) { const tags = selector.split(",").map((tag) => tag.trim()); return this.children.flatMap((child) => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}

function savedPlan() {
  const project = { id: "project-a" }; const plans = [];
  let result = planning.applyPlanningAction(plans, { action: "create", title: "Saved idea", destination: "Saved outcome", outOfScope: "" }, { project });
  assert.equal(result.ok, true);
  result = planning.applyPlanningAction(plans, { action: "confirm-understanding", planId: result.plan.id, version: result.plan.version }, { project });
  assert.equal(result.ok, true);
  result = planning.applyPlanningAction(plans, { action: "draft-spec", planId: result.plan.id, version: result.plan.version, text: "Saved specification", tasks: [{ id: "first", title: "Build the thing", prompt: "Implement the saved outcome", acceptance: ["Outcome is verified"], dependsOn: [] }] }, { project });
  assert.equal(result.ok, true);
  return result.plan;
}

async function environment(item = savedPlan(), storage = new Map()) {
  const root = new Element(); const fixed = new Map(); const events = {}; const calls = []; const polls = new Map(); const navigation = []; const documentEvents = {};
  for (const id of ["overlay", "sheet", "notice", "new", "refresh", "close", "project", "list", "detail"]) { const element = new Element(["new", "refresh", "close"].includes(id) ? "button" : "div"); element.id = `plans-${id}`; fixed.set(element.id, element); root.append(element); }
  const find = (id, node = root) => node.id === id ? node : node.children.map((child) => find(id, child)).find(Boolean);
  const el = (id) => find(`plans-${id}`);
  const projects = { ok: true, activeId: "project-a", projects: [{ id: "project-a", name: "Project A" }, { id: "project-b", name: "Project B" }] };
  const data = { "project-a": [structuredClone(item)], "project-b": [] };
  const tasks = { "project-a": [], "project-b": [] };
  const bridge = {
    projectsList: async () => structuredClone(projects),
    onTasks: (fn) => { events.tasks = fn; },
    planningList: async ({ projectId }) => ({ ok: true, projectId, plans: structuredClone(data[projectId]) }),
    planningAction: async (payload) => { calls.push(structuredClone(payload)); const result = planning.applyPlanningAction(data[payload.projectId], payload, { project: { id: payload.projectId } }); return { ...result, projectId: payload.projectId }; },
    planningAssist: async (payload) => { calls.push(structuredClone(payload)); return { ok: false, error: "Connection unavailable" }; },
    tasksList: async () => ({ ok: true, projectId: projects.activeId, tasks: structuredClone(tasks[projects.activeId]) }),
  };
  const document = { readyState: "complete", hidden: false, activeElement: null, createElement: (tag) => new Element(tag), getElementById: find, addEventListener: (name, callback) => { documentEvents[name] = callback; } };
  const context = vm.createContext({ window: { mefiStudio: bridge, addEventListener: (name, callback) => { events[name] = callback; }, MefiNav: { claim() {}, release() {}, go: (...args) => navigation.push(args) }, MefiBoot: { pollStart: (key, fn) => polls.set(key, fn), pollStop: (key) => polls.delete(key) } }, document, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, console });
  vm.runInContext(stageSource, context);
  vm.runInContext(source, context);
  await context.window.MefiPlanning.open({ planId: item.id }); await flush();
  const input = async (id, value) => { const target = el(id); assert.ok(target, `Missing input ${id}`); target.value = value; await target.trigger("input"); };
  return { ui: context.window.MefiPlanning, el, input, bridge, data, projects, events, calls, storage, polls, tasks, navigation, document, documentEvents };
}

test("the workflow follows saved stages and navigation never advances approval or execution", async () => {
  const env = await environment();
  assert.equal(env.el("stage-approval").dataset.state, "current");
  assert.equal(env.el("stage-spec").dataset.state, "complete");
  assert.equal(env.el("stage-build").dataset.state, "waiting");
  await env.el("stage-verify").trigger("click");
  assert.equal(env.el("approval-section").focused, true);
  assert.equal(env.calls.length, 0, "viewing a future stage cannot approve, resolve, or create work");
  await env.el("approve").trigger("click");
  assert.equal(env.el("stage-approval").dataset.state, "complete");
  assert.equal(env.el("stage-build").dataset.state, "current");
  await env.el("new").trigger("click");
  assert.equal(env.el("stage-idea").dataset.state, "current");
  assert.equal(env.el("stage-explore").dataset.state, "waiting");
  const count = env.calls.length;
  await env.el("stage-spec").trigger("click");
  assert.equal(env.el("destination-section").focused, true);
  assert.equal(env.calls.length, count);
});

test("the question map shows the ready frontier, prerequisite links, and human decisions", async () => {
  const item = savedPlan(); item.spec = null;
  item.questions = [
    { id: "choice", question: "Choose a storage format?", type: "discussion", status: "open", dependsOn: [], notes: [], resolution: "", evidence: "" },
    { id: "proof", question: "Does migration preserve data?", type: "research", status: "open", dependsOn: ["choice"], notes: [], resolution: "", evidence: "" },
  ];
  const env = await environment(item);
  assert.equal(env.el("map-question-choice").dataset.questionState, "ready");
  assert.equal(env.el("map-question-proof").dataset.questionState, "blocked");
  assert.match(env.el("question-map").textContent, /1 ready · 1 blocked · 0 decided/);
  assert.match(env.el("map-question-proof").parentElement.textContent, /AfterQ1/);
  await env.el("map-question-choice").trigger("click");
  assert.equal(env.el("resolution-choice").focused, true);
  assert.equal(env.calls.length, 0);
  await env.input("resolution-choice", "Use JSON for the fixture.");
  await env.el("resolve-form-choice").trigger("submit");
  assert.equal(env.el("map-question-choice").dataset.questionState, "resolved");
  assert.equal(env.el("map-question-proof").dataset.questionState, "ready");
  assert.equal(env.el("stage-decisions").textContent.includes("1/2 recorded"), true);
});

test("the activity indicator represents only an actual pending AI request and stops on failure", async () => {
  const env = await environment(); const pending = deferred();
  env.bridge.planningAssist = () => pending.promise;
  assert.equal(env.el("flow-status").attributes["aria-busy"], "false");
  const click = env.el("draft-spec").trigger("click"); await flush();
  assert.equal(env.el("flow-status").attributes["aria-busy"], "true");
  assert.match(env.el("flow-status").textContent, /drafting the specification/);
  assert.equal(env.el("stage-spec").dataset.state, "current");
  assert.equal(env.el("stage-idea").disabled, false, "read-only stage navigation remains usable during a model request");
  pending.resolve({ ok: false, error: "Fixture offline" }); await click;
  assert.equal(env.el("flow-status").attributes["aria-busy"], "false");
  assert.equal(env.el("stage-approval").dataset.state, "current");
  assert.equal(env.data["project-a"][0].spec.approvedAt, undefined);
});

test("converted plans read real task progress without treating creation or an exit as verification", async () => {
  const item = savedPlan(); item.status = "converted"; item.taskIds = ["first", "second"];
  const env = await environment(item);
  assert.equal(env.el("work-first").dataset.taskStage, "unknown");
  assert.equal(env.el("stage-build").dataset.state, "current");
  env.tasks["project-a"] = [
    { id: "first", title: "Build it", projectId: "project-a", planningId: item.id, status: "active" },
    { id: "second", title: "Check it", projectId: "project-a", status: "done", lastAttempt: { code: 0 } },
    { id: "foreign", title: "Other project work", projectId: "project-b", planningId: item.id, status: "active" },
  ];
  await env.polls.get("planning.work")();
  assert.equal(env.el("work-first").dataset.taskStage, "running");
  assert.equal(env.el("work-second").dataset.taskStage, "review");
  assert.equal(env.el("work-foreign"), undefined);
  assert.equal(env.el("stage-verify").dataset.state, "current");
  assert.doesNotMatch(env.el("workflow").textContent, /Work confirmed/);
  await env.el("work-first").trigger("click");
  assert.equal(env.navigation[0][0], "tasks"); assert.equal(env.navigation[0][1].taskId, "first");
  env.tasks["project-a"][0].status = "done"; env.tasks["project-a"][0].verification = { state: "verified" };
  env.tasks["project-a"][1].verification = { state: "manual" };
  await env.polls.get("planning.work")();
  assert.match(env.el("workflow").textContent, /Work confirmed/);
  assert.match(env.el("work-first").textContent, /Verified/);
  assert.match(env.el("work-second").textContent, /Confirmed by you/);
  assert.equal(env.calls.length, 0, "polls never start workers or alter planning state");
});

test("task polling is visible-only, stops on close, and rejects late or foreign project results", async () => {
  const item = savedPlan(); item.status = "converted"; item.taskIds = ["first"];
  const env = await environment(item); const pending = deferred(); let reads = 0;
  env.bridge.tasksList = () => { reads += 1; return pending.promise; };
  env.document.hidden = true;
  await env.polls.get("planning.work")(); assert.equal(reads, 0);
  env.document.hidden = false;
  const read = env.polls.get("planning.work")(); await flush();
  env.ui.close(); assert.equal(env.polls.size, 0);
  pending.resolve({ ok: true, projectId: "project-a", tasks: [{ id: "first", status: "done", verification: { state: "verified" } }] }); await read;
  assert.equal(env.el("work-first").dataset.taskStage, "unknown", "a closed view ignores its late read");
  env.bridge.tasksList = async () => ({ ok: true, projectId: "project-b", tasks: [{ id: "first", status: "done", verification: { state: "verified" } }] });
  await env.ui.open({ planId: item.id }); await flush();
  assert.equal(env.el("work-first").dataset.taskStage, "unknown");
  assert.match(env.el("execution").textContent, /unavailable/);
  assert.doesNotMatch(env.el("workflow").textContent, /Work confirmed/);
});

test("approval and queue controls never approve a destination or uncertainty still being edited", async () => {
  const env = await environment();
  assert.equal(env.el("approve").disabled, false);
  assert.equal(env.calls.length, 0, "opening a plan performs no model call or write");
  await env.input("destination", "A different outcome");
  for (const id of ["approve", "convert", "draft-spec", "suggest-questions"]) assert.equal(env.el(id).disabled, true, id);
  await env.el("approve").trigger("click"); assert.equal(env.calls.length, 0);
  await env.input("destination", "Saved outcome"); assert.equal(env.el("approve").disabled, false);
  await env.input("unknown-text", "We have not decided whether it works offline"); assert.equal(env.el("approve").disabled, true);
  await env.input("unknown-text", ""); assert.equal(env.el("approve").disabled, false);
  await env.input("question-text", "Should it work offline?"); assert.equal(env.el("approve").disabled, true);
  await env.input("question-text", ""); assert.equal(env.el("approve").disabled, false);
  await env.el("approve").trigger("click");
  assert.equal(env.calls.at(-1).action, "approve-spec"); assert.equal(env.el("convert").disabled, false);
  await env.input("unknown-text", "Another uncertainty"); assert.equal(env.el("convert").disabled, true);
});

test("failed specification save keeps every task field and blocks stale approval, including after reopening", async () => {
  const env = await environment();
  await env.input("spec-text", "Carefully revised specification");
  await env.input("task-prompt-0", "Carefully revised task brief");
  env.bridge.planningAction = async () => ({ ok: false, error: "Disk is full" });
  await env.el("spec-form").trigger("submit");
  assert.match(env.el("notice").textContent, /Disk is full/);
  assert.equal(env.el("spec-text").value, "Carefully revised specification");
  assert.equal(env.el("task-prompt-0").value, "Carefully revised task brief");
  assert.equal(env.el("approve").disabled, true);
  env.ui.close(); await env.ui.open();
  assert.equal(env.el("spec-text").value, "Carefully revised specification");
  const restarted = await environment(env.data["project-a"][0], env.storage);
  assert.equal(restarted.el("task-prompt-0").value, "Carefully revised task brief");
  assert.equal(restarted.el("approve").disabled, true);
});

function interviewPlan() {
  const item = savedPlan(); item.spec = null; delete item.reviewedAt;
  item.questions = [{ id: "rows", question: "Which rows should the export contain?", type: "discussion", status: "open", dependsOn: [], resolution: "", evidence: "", resolvedBy: null, notes: [
    { id: "n1", at: 1, author: "user", kind: "answer", text: "Just what I can see on screen." },
    { id: "n2", at: 2, author: "assistant", kind: "interpretation", text: "Only the rows left after the active filters." },
    { id: "n3", at: 3, author: "assistant", kind: "question", text: "Should the applied filters appear in the file name?" },
  ] }];
  return item;
}

test("the interview waits on Mefi's own question and keeps it after you leave and return", async () => {
  const item = interviewPlan();
  const env = await environment(item);
  assert.match(env.el("interview-ask").textContent, /appear in the file name/);
  assert.equal(env.el("stage-explore").dataset.state, "current");
  const transcript = env.el("interview-section").textContent;
  for (const label of ["You answered", "Mefi understood this — not yet your decision", "Mefi asked"]) assert.match(transcript, new RegExp(label));
  assert.equal(env.calls.length, 0, "opening the interview asks Mefi nothing on its own");
  await env.input("interview-answer", "Yes, include the filters.");
  env.ui.close(); await env.ui.open({ planId: item.id }); await flush();
  assert.match(env.el("interview-ask").textContent, /appear in the file name/);
  assert.equal(env.el("interview-answer").value, "Yes, include the filters.");
  await env.el("interview-send").trigger("click");
  assert.equal(env.calls.at(-1).kind, "interview");
  assert.equal(env.calls.at(-1).questionId, "rows");
  assert.equal(env.calls.at(-1).message, "Yes, include the filters.");
  assert.equal(env.calls.at(-1).action, undefined, "an interview turn is a request for a question, never a write");
  assert.equal(env.data["project-a"][0].questions[0].status, "open");
});

test("Mefi's reading of your answer only ever reaches the decision box for you to record", async () => {
  const env = await environment(interviewPlan());
  await env.el("use-note-n2").trigger("click");
  assert.equal(env.el("resolution-rows").value, "Only the rows left after the active filters.");
  assert.equal(env.calls.length, 0, "a reading is not a decision until you record it");
  assert.equal(env.data["project-a"][0].questions[0].status, "open");
  await env.input("resolution-rows", "Only the rows left after the active filters, plus the filters in the file name.");
  await env.el("resolve-form-rows").trigger("submit");
  assert.equal(env.calls.at(-1).action, "resolve");
  assert.equal(env.data["project-a"][0].questions[0].resolvedBy, "user");
  assert.match(env.el("review-section").textContent, /Confirmed by you/);
  assert.match(env.el("review-section").textContent, /1 line Mefi proposed that your decision does not include/);
});

test("no specification is drafted or approved until you confirm what the plan says", async () => {
  const item = savedPlan(); delete item.reviewedAt;
  const env = await environment(item);
  for (const id of ["draft-spec", "save-spec", "approve"]) assert.equal(env.el(id).disabled, true, id);
  assert.equal(env.el("stage-review").dataset.state, "current");
  assert.match(env.el("review-section").textContent, /Saved outcome/);
  await env.el("draft-spec").trigger("click");
  assert.equal(env.calls.length, 0, "a locked draft button cannot reach Mefi");
  await env.el("confirm-understanding").trigger("click");
  assert.equal(env.calls.at(-1).action, "confirm-understanding");
  assert.ok(env.data["project-a"][0].reviewedAt);
  assert.equal(env.el("confirm-understanding").disabled, true);
  for (const id of ["draft-spec", "save-spec", "approve"]) assert.equal(env.el(id).disabled, false, id);
  assert.equal(env.el("stage-review").dataset.state, "complete");
  await env.input("destination", "A different outcome");
  await env.el("details-form").trigger("submit");
  assert.equal(env.data["project-a"][0].reviewedAt, undefined, "changing the destination withdraws the reading you confirmed");
  assert.equal(env.el("approve").disabled, true);
});

test("stale saved specifications require a fresh revision and frozen plans show saved content", async () => {
  const item = savedPlan(); item.spec.stale = true;
  const env = await environment(item);
  assert.equal(env.el("approve").disabled, true);
  assert.match(env.el("detail").textContent, /Earlier decisions changed/);
  await env.input("destination", "Unsaved destination"); await env.input("spec-text", "Unsaved spec");
  const saved = env.data["project-a"][0]; saved.status = "converted"; saved.taskIds = ["task-one"];
  await env.ui.refresh();
  assert.equal(env.el("destination").value, "Saved outcome");
  assert.equal(env.el("spec-text").value, "Saved specification");
  assert.equal(env.el("destination").disabled, true); assert.equal(env.el("spec-text").disabled, true);
});

test("an old project response cannot replace the next project's form", async () => {
  const env = await environment(); const pending = deferred();
  env.bridge.planningAssist = () => pending.promise;
  const click = env.el("suggest-questions").trigger("click"); await flush();
  env.projects.activeId = "project-b";
  env.events["mefi:project-changed"]({ detail: { projectId: "project-b" } }); await flush();
  await env.input("title", "B's draft");
  pending.resolve({ ok: true, projectId: "project-a", plans: env.data["project-a"], plan: env.data["project-a"][0] }); await click; await flush();
  assert.equal(env.el("project").textContent, "Project B");
  assert.equal(env.el("title").value, "B's draft");
  assert.doesNotMatch(env.el("list").textContent, /Saved idea/);
  assert.equal(env.el("save-details").disabled, false);
});

test("external question changes refresh untouched fields while keeping actual edits reviewable", async () => {
  const item = savedPlan(); const plans = [item];
  const added = planning.applyPlanningAction(plans, { action: "add-question", planId: item.id, version: item.version, question: "Original question?", type: "discussion", dependsOn: [] }, { project: { id: item.projectId } });
  assert.equal(added.ok, true);
  const env = await environment(added.plan); const id = added.plan.questions[0].id;
  const saved = env.data["project-a"][0];
  saved.questions[0].question = "Updated outside this window?"; saved.version += 1;
  await env.ui.refresh();
  assert.equal(env.el(`edit-question-${id}-text`).value, "Updated outside this window?");
  assert.equal(env.el("suggest-questions").disabled, false, "initializing an editor is not an unsaved change");
  await env.input(`edit-question-${id}-text`, "My considered revision?");
  saved.questions[0].question = "Another external change?"; saved.questions[0].status = "resolved"; saved.questions[0].resolution = "An external recorded choice"; saved.version += 1;
  await env.ui.refresh();
  assert.equal(env.el(`edit-question-${id}-text`).value, "My considered revision?");
  assert.equal(env.el(`save-question-${id}`).disabled, false, "a retained edit can still be saved after the question was externally resolved");
  assert.equal(env.el("suggest-questions").disabled, true);
});

test("a pushed board change repaints a converted plan without a task read", async () => {
  const item = savedPlan(); item.status = "converted"; item.taskIds = ["first"];
  const env = await environment(item);
  let reads = 0; const original = env.bridge.tasksList;
  env.bridge.tasksList = async (...args) => { reads += 1; return original(...args); };
  env.events.tasks([{ id: "first", title: "Build it", projectId: "project-a", planningId: item.id, status: "active" }, { id: "foreign", title: "Elsewhere", projectId: "project-b", status: "active" }]);
  assert.equal(env.el("work-first").dataset.taskStage, "running");
  assert.equal(env.el("work-foreign"), undefined);
  assert.equal(reads, 0, "the push carries the board; no read is issued");
  assert.equal(env.calls.length, 0);
});

// The modal shows what the folder already holds — wayfinder maps, tickets,
// GitHub issues and the tooling available — so an existing map is planned
// from instead of planned twice.
test("the modal lists existing maps, tickets and tooling and plans from a map", async () => {
  const existing = {
    ok: true, root: "/repo",
    tracker: { kind: "local", doc: "docs/agents/issue-tracker.md", labelsDoc: "docs/agents/triage-labels.md", domainDoc: null, contextDoc: "CONTEXT.md", contextMap: null, summary: "Local Markdown" },
    efforts: [{ slug: "calmer-onboarding", dir: ".scratch/calmer-onboarding", map: { file: ".scratch/calmer-onboarding/map.md", title: "Calmer onboarding", destination: "A first five minutes that never asks for a key.", decisions: 2, fog: 3, outOfScope: 1, notes: null }, spec: null,
      tickets: [{ number: 2, slug: "free-model", title: "Free model or none", file: "x", status: "claimed", type: "grilling", blockedBy: [1], unblocked: true }, { number: 3, slug: "resume", title: "Resume after a crash", file: "y", status: "open", type: "prototype", blockedBy: [2], unblocked: false }],
      counts: { open: 1, claimed: 1, resolved: 1, frontier: 0 } }],
    remote: { ok: true, provider: "github", maps: [{ number: 12, title: "Remote map", url: "https://github.com/o/r/issues/12", labels: ["wayfinder:map"], assigned: false }], tickets: [{ number: 14, title: "Export button", url: null, labels: ["ready-for-agent"], assigned: false }], counts: { open: 1, wayfinder: 0, readyForAgent: 1, claimed: 0 }, error: null },
    tooling: { agents: [{ name: "reviewer", scope: "project", source: ".claude/agents", description: null }], skills: [{ name: "wayfinder", scope: "plugin", source: "mattpocock-skills", description: "Plan a map." }, { name: "grill-me", scope: "project", source: ".claude/skills", description: null }], commands: [], plugins: [{ name: "mattpocock-skills", skills: 1, agents: 0, commands: 0 }], docs: { agentsMd: "AGENTS.md", claudeMd: null, mcp: null }, counts: { agents: 1, skills: 2, commands: 0, plugins: 1 } },
    counts: { maps: 2, specs: 0, open: 3, frontier: 0, resolved: 1 },
  };
  const env = await environment();
  env.bridge.planningList = async ({ projectId }) => ({ ok: true, projectId, plans: structuredClone(env.data[projectId]), existing: structuredClone(existing) });
  await env.ui.open({ planId: env.data["project-a"][0].id }); await flush();
  const panel = env.el("existing-section");
  assert.ok(panel, "the panel renders for a saved plan");
  const summary = env.el("existing-summary");
  assert.match(summary.textContent, /Issue tracker: local markdown under \.scratch\//);
  assert.match(summary.textContent, /2 maps · 3 open tickets/);
  assert.match(summary.textContent, /1 agent, 2 skills, 0 commands/);
  assert.equal(env.el("existing-details").open, false, "folded under a saved plan");
  const text = panel.textContent;
  assert.match(text, /Calmer onboarding/);
  assert.match(text, /A first five minutes that never asks for a key\./);
  assert.match(text, /2 decisions so far · 3 items not yet specified/);
  assert.match(text, /02 Free model or none · claimed · grilling/);
  assert.match(text, /03 Resume after a crash · open · prototype · blocked by 2/);
  assert.match(text, /Remote map/);
  assert.match(text, /GitHub issue #12 · wayfinder map/);
  assert.match(text, /#14 Export button · ready-for-agent/);
  assert.match(text, /docs\/agents\/issue-tracker\.md/);
  assert.match(text, /wayfinder/);
  assert.match(text, /grill-me/);
  assert.match(text, /reviewer/);
  // Planning from the local map fills a new plan's destination without saving.
  await env.el("plan-from-calmer-onboarding").trigger("click");
  assert.equal(env.el("title").value, "Calmer onboarding");
  assert.equal(env.el("destination").value, "A first five minutes that never asks for a key.");
  assert.equal(env.el("existing-details").open, true, "unfolded while a new idea is set up");
  assert.equal(env.calls.filter((call) => call.action === "create").length, 0, "nothing is saved until Create plan");
  // A GitHub map carries its link into the destination.
  await env.el("plan-from-issue-12").trigger("click");
  assert.equal(env.el("title").value, "Remote map");
  assert.match(env.el("destination").value, /https:\/\/github\.com\/o\/r\/issues\/12/);
});

test("a failed scan and a bare folder explain themselves in the panel", async () => {
  const env = await environment();
  env.bridge.planningList = async ({ projectId }) => ({ ok: true, projectId, plans: structuredClone(env.data[projectId]), existing: { ok: false, error: "gh exploded" } });
  await env.ui.open({ create: true }); await flush();
  assert.match(env.el("existing-section").textContent, /could not be scanned: gh exploded/);
  env.bridge.planningList = async ({ projectId }) => ({ ok: true, projectId, plans: structuredClone(env.data[projectId]), existing: { ok: true, tracker: { kind: null }, efforts: [], remote: null, tooling: { agents: [], skills: [], commands: [], plugins: [], docs: {}, counts: { agents: 0, skills: 0, commands: 0, plugins: 0 } }, counts: { maps: 0, specs: 0, open: 0, frontier: 0, resolved: 0 } } });
  await env.ui.open({ create: true }); await flush();
  const text = env.el("existing-section").textContent;
  assert.match(text, /No issue tracker yet/);
  assert.match(text, /setup-matt-pocock-skills/);
  assert.match(text, /No maps or tickets found/);
  assert.match(text, /No project or user agents, skills or commands were found/);
  const plain = await environment();
  await plain.ui.open({ create: true }); await flush();
  assert.equal(plain.el("existing-section"), undefined, "no panel without a scan");
});
