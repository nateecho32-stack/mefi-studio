// Project-local decisions and reviewed task handoffs. Model calls happen only
// after explicit buttons; suggestions never record decisions or approve work.
(() => {
  "use strict";
  const $ = (name) => document.getElementById(`plans-${name}`);
  const api = () => window.mefiStudio;
  const state = { projectId: null, projectName: "Your project", plans: [], selected: "new", busy: false, pending: null, tasks: null, workError: null, epoch: 0, opened: false, readId: 0, workReadId: 0 };
  let initialized = false;
  let workTimer = null;
  let workFlight = null;
  let priorFocus = null;
  let drafts = {};
  let sliceCounter = 0;
  try { const saved = JSON.parse(localStorage.getItem("mefiStudio.planning.drafts.v1") || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) drafts = saved; } catch {}
  const persist = () => { try { localStorage.setItem("mefiStudio.planning.drafts.v1", JSON.stringify(drafts)); } catch { /* Form state stays in memory when storage is unavailable. */ } };
  const draftKey = () => JSON.stringify([state.projectId, state.selected]);
  const draft = () => drafts[draftKey()] ||= {};
  const plan = () => state.plans.find((item) => item.id === state.selected);
  const frozen = (item) => ["converted", "converting"].includes(item?.status);
  const ready = (item, question) => (question.dependsOn || []).every((id) => item.questions.some((other) => other.id === id && other.status === "resolved"));
  const settled = (item) => !(item.unknowns || []).length && (item.questions || []).every((question) => question.status === "resolved");
  const unsavedDestination = (item) => Boolean(item && draft().details && ["title", "destination", "outOfScope"].some((key) => draft().details[key] !== item[key]));
  const unsavedQuestions = (item) => Boolean(item?.questions?.some((question) => { const edit = draft().editDirty?.[question.id] && draft().edits?.[question.id]; return edit && (edit.question !== question.question || edit.type !== question.type || JSON.stringify([...edit.dependsOn].sort()) !== JSON.stringify([...question.dependsOn].sort())); }));
  const unsavedPlan = (item) => !frozen(item) && (unsavedDestination(item) || unsavedQuestions(item) || Boolean(draft().unknown?.trim()) || Boolean(draft().question?.question?.trim()));
  function reviewGates() {
    const item = plan(); if (!item) return;
    const pending = unsavedPlan(item); const dirty = Boolean(draft().specDirty);
    const locks = { "suggest-questions": pending, "draft-spec": pending || dirty || !settled(item), "save-spec": pending || !settled(item), approve: pending || dirty || !settled(item) || !item.spec || Boolean(item.spec?.stale) || Boolean(item.spec?.approvedAt), convert: item.status === "converting" ? false : pending || dirty || !item.spec?.approvedAt || !item.spec?.tasks?.length };
    for (const [id, locked] of Object.entries(locks)) if ($(id)) { $(id).disabled = state.busy || locked; $(id).dataset.locked = String(Boolean(locked)); }
  }
  function holdHandoff() {
    reviewGates();
    note(unsavedPlan(plan()) ? "Save your destination, unknown, or question changes before drafting, approving, or creating tasks." : "");
  }
  const guard = (result) => { if (!result?.ok) throw new Error(result?.error || "Studio couldn't complete that action. Your draft is still here."); return result; };
  const node = (tag, className = "", content, parent) => {
    const element = document.createElement(tag); if (className) element.className = className;
    if (content !== undefined && content !== null) element.textContent = String(content);
    if (parent) parent.append(element); return element;
  };
  function note(message = "", error = false) { $("notice").textContent = message; $("notice").dataset.error = String(error); }
  function button(label, parent, run, id, primary = false, locked = false) {
    const result = node("button", primary ? "primary" : "ghost", label, parent);
    result.type = "button"; if (id) result.id = `plans-${id}`;
    result.dataset.locked = String(locked); result.disabled = state.busy || locked;
    result.addEventListener("click", run); return result;
  }
  function field(parent, label, id, value, change, options = {}) {
    const wrap = node("label", "planning-field", label, parent);
    const control = node(options.select ? "select" : options.rows ? "textarea" : "input", "", undefined, wrap);
    if (options.select) for (const [key, copy] of options.select) { const option = node("option", "", copy, control); option.value = key; }
    else if (options.rows) control.rows = options.rows;
    else control.type = "text";
    control.id = `plans-${id}`; control.value = value ?? "";
    control.required = Boolean(options.required); control.maxLength = options.maxLength || 20000;
    control.dataset.locked = String(Boolean(options.locked)); control.disabled = state.busy || Boolean(options.locked);
    if (options.placeholder) control.placeholder = options.placeholder;
    control.addEventListener(options.select ? "change" : "input", () => { change(control.value); persist(); });
    return control;
  }
  function form(parent, id, run, label, locked = false) {
    const result = node("form", "planning-form", undefined, parent); result.id = `plans-${id}`;
    result.addEventListener("submit", (event) => { event.preventDefault(); if (!state.busy && !locked) run(); });
    result.setAttribute("aria-label", label); return result;
  }
  function submit(parent, label, id, locked = false) {
    const result = button(label, parent, () => {}, id, true, locked); result.type = "submit"; return result;
  }
  function section(title, description) {
    const result = node("section", "planning-section", undefined, $("detail"));
    node("h3", "", title, result); if (description) node("p", "", description, result); return result;
  }
  function dependencies(parent, choices, selected, change, label = "Wait for these decisions", locked = false) {
    if (!choices.length) return;
    const group = node("fieldset", "planning-dependencies", undefined, parent); node("legend", "", label, group);
    for (const choice of choices) {
      const wrap = node("label", "planning-check", undefined, group);
      const check = node("input", "", undefined, wrap); check.type = "checkbox"; check.checked = selected.includes(choice.id);
      check.dataset.dependencyId = choice.id; check.dataset.locked = String(locked); check.disabled = state.busy || locked;
      node("span", "", choice.question || choice.title || "Untitled task", wrap);
      check.addEventListener("change", () => { const next = new Set(selected); check.checked ? next.add(choice.id) : next.delete(choice.id); selected = [...next]; change(selected); persist(); });
    }
  }
  const typeChoices = [["discussion", "Discussion — make a choice"], ["research", "Research — gather evidence"], ["prototype", "Prototype — try it out"], ["prerequisite", "Prerequisite — establish a fact"]];
  const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const flowStages = [["idea", "The idea"], ["explore", "Explore"], ["decisions", "Your decisions"], ["spec", "Specification"], ["approval", "Your approval"], ["build", "Build"], ["verify", "Verify"]];
  function navigateTo(...ids) {
    const target = ids.map($).find((element) => element && !element.disabled);
    if (!target) return;
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName?.toLowerCase() === "details") ancestor.open = true;
    target.scrollIntoView?.({ block: "nearest", behavior: "auto" }); target.focus?.({ preventScroll: true });
  }
  function navigation(label, parent, run, id, className = "") {
    const result = node("button", className, label, parent); result.type = "button";
    if (id) result.id = `plans-${id}`; result.dataset.navigate = "true"; result.addEventListener("click", run); return result;
  }
  function taskProgress(task, tasks) {
    if (!task) return { stage: "unknown", label: "Waiting for board status" };
    if (["done", "archived", "completed"].includes(task.status)) {
      if (task.verification?.state === "verified") return { stage: "done", label: "Verified" };
      if (task.verification?.state === "manual") return { stage: "done", label: "Confirmed by you" };
      return { stage: "review", label: "Completed · review evidence" };
    }
    if (["awaiting_verification", "verifying"].includes(task.status)) return { stage: "review", label: "Awaiting verification" };
    if (["active", "running"].includes(task.status) || task.runId) return { stage: "running", label: "Builder working" };
    if (task.verification?.state === "failed" || (task.runFailures || 0) >= 5 || (task.verifyAttempts || 0) >= 3) return { stage: "blocked", label: "Needs your review" };
    if (task.absorbedInto) return { stage: "waiting", label: "Included in a grouped task" };
    if (task.dependsOn?.some((id) => !tasks.some((other) => other.id === id && ["done", "archived", "completed"].includes(other.status)))) return { stage: "waiting", label: "Waiting on a task" };
    if (task.nextRunAt > Date.now()) return { stage: "waiting", label: "Retry scheduled" };
    return { stage: "queued", label: "Queued" };
  }
  function executionRows(item) {
    const tasks = state.tasks || [];
    const ids = new Set(item?.taskIds || []);
    const related = tasks.filter((task) => (!task.projectId || task.projectId === state.projectId) && (ids.has(task.id) || task.planningId === item?.id));
    const rows = [...(item?.taskIds || []).map((id, index) => ({ id, task: related.find((task) => task.id === id), title: item.spec?.tasks?.[index]?.title || `Task ${index + 1}` }))];
    for (const task of related) if (!ids.has(task.id)) rows.push({ id: task.id, task, title: task.title });
    return rows.map((row) => ({ ...row, title: row.task?.title || row.title, ...taskProgress(row.task, tasks) }));
  }
  function workflowState(item) {
    const questions = item?.questions || []; const unknowns = item?.unknowns?.length || 0;
    const resolved = questions.filter((question) => question.status === "resolved");
    const frontier = questions.filter((question) => question.status !== "resolved" && ready(item, question));
    const blocked = questions.filter((question) => question.status !== "resolved" && !ready(item, question));
    const work = frozen(item) ? executionRows(item) : [];
    const complete = work.length > 0 && work.every((task) => task.stage === "done");
    let current = !item ? "idea" : frozen(item) ? (complete || work.some((task) => task.stage === "review") ? "verify" : "build")
      : unknowns || (!questions.length && !item.spec) ? "explore"
      : resolved.length < questions.length ? (frontier.some((question) => question.notes?.length) ? "decisions" : "explore")
      : !item.spec || item.spec.stale ? "spec" : !item.spec.approvedAt ? "approval" : "build";
    if (state.pending?.assist) current = state.pending.kind === "spec" ? "spec" : "explore";
    const completed = new Set(item ? ["idea"] : []);
    if (item && !unknowns && (questions.length > 0 || item.spec) && resolved.length === questions.length) { completed.add("explore"); completed.add("decisions"); }
    if (item?.spec && !item.spec.stale) completed.add("spec");
    if (item?.spec?.approvedAt) completed.add("approval");
    if (complete) { completed.add("build"); completed.add("verify"); }
    return { current, completed, questions, resolved, frontier, blocked, unknowns, work, complete };
  }
  function renderWorkflow(item) {
    let area = $("workflow");
    if (!area) { area = node("section", "planning-workflow", undefined, $("detail")); area.id = "plans-workflow"; area.setAttribute("aria-label", "From idea to verified work"); }
    area.replaceChildren();
    const flow = workflowState(item); area.dataset.stage = flow.current;
    const head = node("div", "planning-flow-head", undefined, area);
    const heading = node("div", "", undefined, head); node("span", "eyebrow", "IDEA → UNDERSTANDING → WORK", heading);
    node("h3", "", "See the next step.", heading);
    node("p", "planning-subtle", "Explore together. You make the decisions and approve what reaches the builders.", heading);
    const badge = node("span", "planning-flow-badge", flow.complete ? "Work confirmed" : item?.status === "converting" ? "Finish task creation" : item?.status === "converted" ? "On the task board" : "Planning space", head);
    badge.dataset.state = flow.complete ? "complete" : "waiting";
    const rail = node("ol", "planning-flow-rail", undefined, area); rail.setAttribute("aria-label", "Planning and work stages");
    const decided = `${flow.resolved.length}/${flow.questions.length} recorded`;
    const subtitles = { idea: item ? "Destination saved" : "Set a destination", explore: `${flow.frontier.length} ready · ${flow.blocked.length} blocked`, decisions: decided, spec: item?.spec?.stale ? "Needs revision" : item?.spec ? "Draft saved" : "Shape the build", approval: item?.spec?.approvedAt ? "Approved by you" : "Review together", build: frozen(item) ? `${flow.work.filter((task) => task.stage === "running").length} working · ${countLabel(item.taskIds?.length || 0, "task")}` : "Create tasks", verify: frozen(item) ? `${flow.work.filter((task) => task.stage === "done").length}/${flow.work.length} confirmed` : "Check the result" };
    for (const [index, [id, label]] of flowStages.entries()) {
      const row = node("li", "", undefined, rail);
      const jump = () => {
        if (id === "idea") navigateTo("title", "destination-section");
        else if (id === "explore") navigateTo(flow.unknowns ? "unknown-text" : "questions-section", "destination-section");
        else if (id === "decisions") { const question = flow.frontier[0] || flow.questions[0]; navigateTo(question ? `resolution-${question.id}` : "questions-section", question ? `question-card-${question.id}` : "destination-section"); }
        else if (id === "spec") navigateTo("spec-text", "specification-section", "destination-section");
        else if (id === "approval") navigateTo("approval-section", "destination-section");
        else navigateTo("execution", "approval-section", "destination-section");
      };
      const stage = navigation("", row, jump, `stage-${id}`, "planning-flow-stage");
      stage.dataset.state = flow.completed.has(id) && id !== flow.current ? "complete" : id === flow.current ? "current" : "waiting";
      stage.setAttribute("aria-label", `${label}: ${subtitles[id]}`);
      if (id === flow.current) stage.setAttribute("aria-current", "step");
      node("span", "planning-stage-number", stage.dataset.state === "complete" ? "✓" : index + 1, stage);
      node("strong", "", label, stage); node("small", "", subtitles[id], stage);
    }
    const status = node("div", "planning-flow-status", undefined, area); status.id = "plans-flow-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    status.dataset.active = String(Boolean(state.pending?.assist));
    status.setAttribute("aria-busy", String(Boolean(state.pending?.assist)));
    node("span", "planning-flow-dot", "", status).setAttribute("aria-hidden", "true");
    const next = { idea: "Start with the outcome you want. Nothing runs until you choose the next action.", explore: flow.unknowns ? `${flow.unknowns} unknown${flow.unknowns === 1 ? " needs" : "s need"} a question or a reason to set aside.` : flow.frontier.length ? `${flow.frontier.length} question${flow.frontier.length === 1 ? " is" : "s are"} ready. Open one to discuss options or record your choice.` : "Add a question yourself or ask Mefi to suggest what needs exploring.", decisions: "Read the discussion and evidence, then record your own decisions.", spec: "The decisions are settled. Draft the specification and its small implementation tasks.", approval: "Review the saved specification, task briefs, and acceptance checks before approving.", build: item?.status === "converted" ? "Tasks follow the current queue and Pause settings. Their board status is shown below." : item?.status === "converting" ? "Finish creating the approved tasks. Existing tasks will be reused." : "Your specification is approved. Create its tasks when you are ready.", verify: flow.complete ? "Every linked task has verified evidence or your recorded confirmation." : "A worker result is ready for verification. Open the task to inspect its evidence." };
    const pendingQuestion = flow.questions.find((question) => question.id === state.pending?.questionId);
    node("span", "", state.pending?.assist ? state.pending.kind === "spec" ? "Mefi is drafting the specification from your saved decisions…" : state.pending.kind === "question" ? `Mefi is exploring: ${pendingQuestion?.question || "the selected question"}` : "Mefi is looking for questions in your saved destination…" : next[flow.current], status);
    if (item && !frozen(item)) renderQuestionMap(area, item, flow);
    if (frozen(item)) renderExecution(area, item, flow.work);
  }
  function renderQuestionMap(area, item, flow) {
    const map = node("div", "planning-question-map", undefined, area); map.id = "plans-question-map";
    const title = node("div", "planning-map-head", undefined, map); node("h4", "", "The questions that shape this idea", title);
    node("span", "planning-subtle", `${flow.frontier.length} ready · ${flow.blocked.length} blocked · ${flow.resolved.length} decided`, title);
    if (!flow.questions.length) { node("p", "planning-subtle", "Questions will connect here as you discover what depends on what.", map); return; }
    const byId = new Map(flow.questions.map((question) => [question.id, question]));
    const depths = new Map();
    const depth = (question, seen = new Set()) => {
      if (depths.has(question.id)) return depths.get(question.id);
      if (seen.has(question.id)) return 0;
      const next = new Set([...seen, question.id]);
      const value = Math.min(6, Math.max(0, ...(question.dependsOn || []).map((id) => byId.has(id) ? 1 + depth(byId.get(id), next) : 1)));
      depths.set(question.id, value); return value;
    };
    const levels = new Map();
    for (const question of flow.questions) { const level = depth(question); if (!levels.has(level)) levels.set(level, []); levels.get(level).push(question); }
    const columns = node("div", "planning-map-columns", undefined, map);
    for (const [level, questions] of [...levels].sort(([a], [b]) => a - b)) {
      const column = node("div", "planning-map-column", undefined, columns); node("span", "planning-map-level", level ? `Then · ${level + 1}` : "Start here", column);
      for (const question of questions) {
        const index = flow.questions.indexOf(question); const questionState = question.status === "resolved" ? "resolved" : ready(item, question) ? "ready" : "blocked";
        const card = node("article", "planning-map-card", undefined, column); card.dataset.questionState = questionState;
        const jump = navigation("", card, () => navigateTo(`resolution-${question.id}`, `question-card-${question.id}`), `map-question-${question.id}`, "planning-map-question");
        jump.dataset.questionState = questionState; jump.dataset.active = String(state.pending?.assist && state.pending.questionId === question.id);
        node("span", "planning-map-label", `Q${index + 1} · ${question.type}`, jump);
        node("strong", "", question.question, jump);
        node("span", "planning-map-state", questionState === "resolved" ? "✓ Decision recorded" : questionState === "ready" ? "● Ready to explore" : "↳ Waiting on a decision", jump);
        if (question.notes?.length && questionState !== "resolved") node("small", "", `${question.notes.length} discussion note${question.notes.length === 1 ? "" : "s"} · your decision is open`, jump);
        if (question.dependsOn?.length) {
          const links = node("div", "planning-map-links", undefined, card); node("span", "", "After", links);
          for (const id of question.dependsOn) {
            const prerequisite = byId.get(id); const number = flow.questions.findIndex((other) => other.id === id) + 1;
            const link = navigation(prerequisite ? `Q${number}${prerequisite.status === "resolved" ? " ✓" : ""}` : "Missing question", links, () => navigateTo(`question-card-${id}`));
            link.title = prerequisite?.question || "This prerequisite is missing";
          }
        }
      }
    }
  }
  function renderExecution(area, item, rows) {
    const work = node("section", "planning-execution", undefined, area); work.id = "plans-execution"; work.tabIndex = -1;
    const head = node("div", "planning-map-head", undefined, work); node("h4", "", "From the task board", head);
    navigation("Open board ↗", head, () => window.MefiNav?.go?.("tasks"), "open-board", "ghost mini");
    if (state.workError) node("p", "planning-subtle", "Task status is unavailable. Open the board or refresh to check the latest work.", work);
    else if (!state.tasks) node("p", "planning-subtle", "Reading the linked tasks…", work);
    const list = node("div", "planning-execution-list", undefined, work);
    for (const row of rows) {
      const button = navigation("", list, () => window.MefiNav?.go?.("tasks", { taskId: row.id }), `work-${row.id}`, "planning-work-task"); button.dataset.taskStage = state.workError ? "unknown" : row.stage;
      node("strong", "", row.title, button); node("span", "", state.workError ? "Status unavailable" : row.label, button);
    }
    if (!rows.length) node("p", "planning-subtle", item.status === "converting" ? "Task creation is still in progress." : "No linked tasks are available yet.", work);
  }
  function controls() {
    for (const region of [$("detail"), $("list")]) for (const control of region.querySelectorAll("input, textarea, select, button")) control.disabled = (state.busy && control.dataset.navigate !== "true") || control.dataset.locked === "true";
    $("new").disabled = state.busy || !state.projectId; $("refresh").disabled = state.busy || !api()?.planningList;
    $("sheet").setAttribute("aria-busy", String(state.busy));
  }
  function accept(result) {
    if (result.projectId && result.projectId !== state.projectId) throw new Error("The project changed. Reopen its plan to continue.");
    if (Array.isArray(result.plans)) state.plans = result.plans;
    else if (result.plan) state.plans = [result.plan, ...state.plans.filter((item) => item.id !== result.plan.id)];
    if (result.plan) state.selected = result.plan.id;
  }
  async function act(action, payload = {}, clean, success = "Saved.", assist = false) {
    if (state.busy || !state.projectId) return false;
    const epoch = state.epoch; const projectId = state.projectId; const selected = state.selected;
    const current = plan(); const savedDraft = draft(); const key = draftKey();
    const request = { projectId, ...(current ? { planId: current.id, version: current.version } : {}), ...payload, ...(assist ? {} : { action }) };
    state.busy = true; state.pending = { assist, kind: payload.kind || action, questionId: payload.questionId }; persist(); renderWorkflow(current); controls(); note(assist ? "Mefi is thinking through the saved plan…" : "Saving your plan…");
    try {
      const result = guard(await (assist ? api().planningAssist(request) : api().planningAction(request)));
      if (epoch !== state.epoch || projectId !== state.projectId || selected !== state.selected) return false;
      accept(result); if (clean) clean(savedDraft); if (action === "create") delete drafts[key]; persist();
      render(); note(result.note || success);
      if (action === "convert") window.MefiWorkspace?.refresh?.(true);
      return true;
    } catch (error) {
      if (epoch === state.epoch && projectId === state.projectId) {
        // A stale-version error needs a fresh saved plan, while keeping every
        // local field. Retrying then uses the latest version, never a blind save.
        try { const fresh = guard(await api().planningList({ projectId })); if (epoch === state.epoch && projectId === state.projectId && (!fresh.projectId || fresh.projectId === projectId)) { state.plans = fresh.plans || []; render(); } } catch {}
        if (epoch === state.epoch) note(`${error.message} Your entered text is kept.`, true);
      }
      return false;
    } finally { if (epoch === state.epoch) { state.busy = false; state.pending = null; renderWorkflow(plan()); controls(); if (frozen(plan())) void refreshWork(); } }
  }
  function renderList() {
    $("project").textContent = state.projectName; $("list").replaceChildren();
    for (const item of state.plans) {
      const row = button("", $("list"), () => { if (state.busy) return; state.selected = item.id; state.workReadId += 1; render(); note(); void refreshWork(); }, null);
      row.dataset.planId = item.id; row.setAttribute("aria-pressed", String(item.id === state.selected));
      node("strong", "", item.title, row);
      const open = (item.questions || []).filter((question) => question.status !== "resolved").length;
      const taskCount = item.taskIds?.length || 0;
      node("small", "", item.status === "converted" ? `${countLabel(taskCount, "task")} created` : item.status === "converting" ? "Task creation needs finishing" : item.spec?.approvedAt ? "Approved · ready for tasks" : `${countLabel(open, "open question")} · ${countLabel(item.unknowns?.length || 0, "unknown")}`, row);
    }
    if (!state.plans.length) node("p", "planning-subtle", "A plan is a place to think before work reaches the board.", $("list"));
  }
  function details(item) {
    const area = section(item ? "1. The destination" : "What would you like to make?", "Describe the outcome you want and what belongs outside this idea. You can refine it as you learn.");
    area.id = "plans-destination-section"; area.tabIndex = -1;
    const local = draft();
    if (item && (!local.detailsDirty || frozen(item))) { local.details = { title: item.title, destination: item.destination, outOfScope: item.outOfScope }; delete local.detailsDirty; }
    const values = local.details ||= { title: item?.title || "", destination: item?.destination || "", outOfScope: item?.outOfScope || "" };
    const locked = frozen(item);
    const edit = form(area, "details-form", () => act(item ? "update" : "create", { ...values }, (saved) => { delete saved.details; delete saved.detailsDirty; }, item ? "Destination saved. Changed scope reopens earlier decisions for review." : "Your plan is ready to explore."), "Plan destination", locked);
    const changed = (key, value) => { values[key] = value; local.detailsDirty = true; if (item) holdHandoff(); };
    field(edit, "Name this idea", "title", values.title, (value) => changed("title", value), { required: true, maxLength: 180, locked, placeholder: "A calmer first five minutes" });
    field(edit, "What should be true when this is finished?", "destination", values.destination, (value) => changed("destination", value), { required: true, rows: 3, locked, maxLength: 16000, placeholder: "Who is this for? What can they do or understand afterward?" });
    field(edit, "Outside this plan", "out-of-scope", values.outOfScope, (value) => changed("outOfScope", value), { rows: 2, locked, maxLength: 12000, placeholder: "Things we are choosing to leave for later" });
    if (!locked) submit(edit, item ? "Save destination" : "Create plan", "save-details");
  }
  function unknowns(item) {
    const area = section("2. What don't we know yet?", "Capture uncertainties. Turn one into a question, or explain why it no longer needs an answer.");
    const local = draft(); const locked = frozen(item);
    for (const unknown of item.unknowns || []) {
      const card = node("article", "planning-card", undefined, area); node("p", "", unknown.text, card);
      if (locked) continue;
      const actions = node("div", "planning-actions", undefined, card);
      const promote = button("Explore as a question", actions, () => { local.question = { question: unknown.text, type: "discussion", dependsOn: [], unknownId: unknown.id }; persist(); render(); $("question-text")?.focus(); });
      promote.dataset.unknownId = unknown.id; promote.dataset.action = "promote";
      const remove = node("details", "", undefined, card); node("summary", "", "Set this uncertainty aside", remove);
      local.removals ||= {};
      const edit = form(remove, `remove-${unknown.id}`, () => act("remove-unknown", { unknownId: unknown.id, reason: local.removals[unknown.id] || "" }, (saved) => { delete saved.removals?.[unknown.id]; }, "Uncertainty set aside with your reason."), "Reason to set aside uncertainty");
      field(edit, "Why doesn't this need an answer?", `remove-reason-${unknown.id}`, local.removals[unknown.id], (value) => { local.removals[unknown.id] = value; }, { required: true, rows: 2 });
      const removeButton = submit(edit, "Set aside", `remove-unknown-${unknown.id}`); removeButton.dataset.action = "remove"; removeButton.dataset.unknownId = unknown.id;
    }
    if (!(item.unknowns || []).length) node("p", "planning-subtle", "No loose unknowns. Add one whenever you notice a gap.", area);
    if (!locked) {
      const edit = form(area, "unknown-form", () => act("add-unknown", { text: local.unknown || "" }, (saved) => { delete saved.unknown; }, "Unknown added."), "Add an unknown");
      field(edit, "Something we're unsure about", "unknown-text", local.unknown, (value) => { local.unknown = value; holdHandoff(); }, { required: true, rows: 2, maxLength: 4000, placeholder: "We don't know whether…" });
      submit(edit, "Add unknown", "add-unknown");
    }
  }
  function questionEditor(parent, item, existing) {
    const local = draft(); const id = existing?.id;
    local.edits ||= {};
    if (id && !local.editDirty?.[id]) local.edits[id] = { question: existing.question, type: existing.type, dependsOn: [...(existing.dependsOn || [])] };
    const values = id ? local.edits[id] ||= { question: existing.question, type: existing.type, dependsOn: [...(existing.dependsOn || [])] } : local.question ||= { question: "", type: "discussion", dependsOn: [] };
    const prefix = id ? `edit-question-${id}` : "question";
    const edit = form(parent, `${prefix}-form`, () => act(id ? "edit-question" : "add-question", { ...values, ...(id ? { questionId: id } : {}) }, (saved) => { if (id) { delete saved.edits?.[id]; delete saved.editDirty?.[id]; } else delete saved.question; }, id ? "Question updated. Its earlier decision and dependent decisions need review." : "Question added. Decide when you're ready."), id ? "Edit question" : "Add a question");
    if (values.unknownId) node("p", "planning-subtle", "This question will replace the selected unknown when saved.", edit);
    const changed = (key, value) => { values[key] = value; if (id) { local.editDirty ||= {}; local.editDirty[id] = true; } holdHandoff(); };
    field(edit, "Question to resolve", `${prefix}-text`, values.question, (value) => changed("question", value), { required: true, rows: 2, maxLength: 4000, placeholder: "Which approach should we choose, and why?" });
    field(edit, "How will we answer it?", `${prefix}-type`, values.type, (value) => changed("type", value), { select: typeChoices });
    dependencies(edit, item.questions.filter((question) => question.id !== id), values.dependsOn, (value) => changed("dependsOn", value));
    submit(edit, id ? "Save question" : "Add question", id ? `save-question-${id}` : "add-question");
  }
  function questionCard(area, item, question) {
    const local = draft(); local.answers ||= {}; local.conversations ||= {};
    const id = question.id; const locked = frozen(item); const canResolve = ready(item, question);
    const resolved = question.status === "resolved";
    const card = node("article", "planning-card", undefined, area); card.dataset.questionId = id;
    card.id = `plans-question-card-${id}`; card.tabIndex = -1;
    const pill = node("span", "planning-pill", resolved ? "Decided" : canResolve ? "Ready to explore" : "Waiting on a decision", card); pill.dataset.state = resolved ? "resolved" : canResolve ? "ready" : "waiting";
    node("h4", "", question.question, card);
    node("p", "planning-subtle", `${typeChoices.find(([type]) => type === question.type)?.[1] || question.type}${question.dependsOn?.length ? ` · Depends on: ${question.dependsOn.map((dependency) => item.questions.find((other) => other.id === dependency)?.question || "Missing question").join("; ")}` : ""}`, card);
    const talk = node("details", "", undefined, card); talk.open = Boolean(local.talkOpen?.[id]); node("summary", "", `Think it through${question.notes?.length ? ` · ${countLabel(question.notes.length, "note")}` : " together"}`, talk);
    talk.addEventListener("toggle", () => { local.talkOpen ||= {}; local.talkOpen[id] = talk.open; persist(); });
    const conversation = node("div", "planning-notes", undefined, talk);
    for (const entry of question.notes || []) { const row = node("div", "planning-note", undefined, conversation); node("strong", "", entry.author === "assistant" ? "Mefi · suggestion" : "You", row); node("p", "", entry.text, row); }
    if (!locked && !resolved) {
      const values = local.conversations[id] ||= { message: "", useWeb: false };
      field(talk, "Your thoughts, options, or a question for Mefi", `note-${id}`, values.message, (value) => { values.message = value; }, { rows: 3, maxLength: 16000, placeholder: "Compare the options, explain a tradeoff, or add what you've learned…" });
      const checkLabel = node("label", "planning-check", undefined, talk); const check = node("input", "", undefined, checkLabel); check.type = "checkbox"; check.checked = Boolean(values.useWeb);
      node("span", "", "Include web references in Mefi's answer", checkLabel); check.addEventListener("change", () => { values.useWeb = check.checked; persist(); });
      const actions = node("div", "planning-actions", undefined, talk);
      const clean = (saved) => { delete saved.conversations?.[id]; saved.talkOpen ||= {}; saved.talkOpen[id] = true; };
      button("Save my note", actions, () => act("add-note", { questionId: id, text: values.message }, clean, "Your note is saved."), `save-note-${id}`);
      button("Ask Mefi", actions, () => act("question", { kind: "question", questionId: id, message: values.message, useWeb: values.useWeb }, clean, "Read Mefi's suggestion below, then make your decision.", true), `ask-${id}`, true);
      node("p", "planning-subtle", "Uses your configured assistant connection. Suggestions add context; you make the decision below.", talk);
    }
    if (resolved) {
      node("p", "planning-answer", question.resolution, card);
      if (question.evidence) node("p", "planning-answer planning-subtle", `Evidence: ${question.evidence}`, card);
      if (!locked) button("Reopen decision", card, () => act("reopen", { questionId: id }, null, "Decision reopened. Review any dependent decisions and refresh the specification."), `reopen-${id}`);
    } else if (!locked) {
      const values = local.answers[id] ||= { resolution: "", evidence: "" };
      const decide = form(card, `resolve-form-${id}`, () => act("resolve", { questionId: id, ...values }, (saved) => { delete saved.answers?.[id]; }, "Your decision is recorded."), "Record your decision", !canResolve);
      field(decide, "Your decision or finding", `resolution-${id}`, values.resolution, (value) => { values.resolution = value; }, { required: true, rows: 3, maxLength: 16000, placeholder: "We will… because…" });
      field(decide, ["research", "prototype"].includes(question.type) ? "Evidence you reviewed (required)" : "Supporting evidence or references", `evidence-${id}`, values.evidence, (value) => { values.evidence = value; }, { required: ["research", "prototype"].includes(question.type), rows: 2, maxLength: 16000, placeholder: "A file, source URL, experiment result, or observation" });
      submit(decide, question.type === "prototype" ? "Accept prototype result" : question.type === "research" ? "Accept finding" : "Record my decision", `resolve-${id}`, !canResolve);
      if (!canResolve) node("p", "planning-subtle", "Resolve its prerequisite decisions first. Your draft answer is saved as you type.", card);
    }
    if (!locked) { const edit = node("details", "", undefined, card); node("summary", "", "Edit this question or its prerequisites", edit); questionEditor(edit, item, question); }
  }
  function questions(item) {
    const area = section("3. Work through the questions", "Discuss a choice, gather research, or try a small prototype. Record a decision only after you've reviewed the result.");
    area.id = "plans-questions-section"; area.tabIndex = -1;
    if (!frozen(item)) {
      const actions = node("div", "planning-actions", undefined, area);
      button("Suggest questions", actions, () => act("questions", { kind: "questions" }, null, "Questions added for you to review.", true), "suggest-questions", false, unsavedPlan(item));
      node("span", "planning-subtle", "Uses the saved destination and your configured assistant.", actions);
    }
    for (const question of item.questions || []) questionCard(area, item, question);
    if (!item.questions.length) node("p", "planning-subtle", "Start with one question that could change what you build.", area);
    if (!frozen(item)) { const add = node("details", "planning-card", undefined, area); add.open = !item.questions.length || Boolean(draft().question?.question); node("summary", "", "+ Add a question yourself", add); questionEditor(add, item); }
  }
  function newSlice() { return { id: `slice-${Date.now().toString(36)}-${++sliceCounter}`, title: "", prompt: "", acceptance: "", dependsOn: [] }; }
  function specification(item) {
    const area = section("4. Turn decisions into a build plan", "Review the specification and small tasks. Each task needs a clear brief, acceptance checks, and any tasks it must wait for.");
    area.id = "plans-specification-section"; area.tabIndex = -1;
    const local = draft(); const locked = frozen(item);
    if (!local.specDirty || locked) { delete local.spec; delete local.specDirty; }
    const values = local.spec ||= { text: item.spec?.text || "", tasks: (item.spec?.tasks || []).map((task) => ({ ...task, acceptance: Array.isArray(task.acceptance) ? task.acceptance.join("\n") : task.acceptance || "", dependsOn: [...(task.dependsOn || [])] })) };
    const markDirty = () => { local.specDirty = true; reviewGates(); };
    if (!settled(item) && !locked) node("p", "planning-subtle", "Draft here as you think. Settle all unknowns and questions before asking Mefi for a specification or approving tasks.", area);
    if (!locked) {
      const actions = node("div", "planning-actions", undefined, area);
      button("Draft specification with Mefi", actions, () => act("spec", { kind: "spec" }, (saved) => { delete saved.spec; delete saved.specDirty; }, "Specification drafted. Review the text, task briefs and acceptance checks.", true), "draft-spec", false, !settled(item) || Boolean(local.specDirty) || unsavedPlan(item));
      if (local.specDirty) node("span", "planning-subtle", "Save your draft before asking Mefi to revise it.", actions);
    }
    const edit = form(area, "spec-form", () => act("draft-spec", { text: values.text, tasks: values.tasks.map((task) => ({ ...task, acceptance: task.acceptance.split("\n").map((line) => line.trim()).filter(Boolean) })) }, (saved) => { delete saved.spec; delete saved.specDirty; }, "Specification draft saved. Review it before approving."), "Specification and implementation tasks", locked);
    const specificationText = field(edit, "Specification", "spec-text", values.text, (value) => { values.text = value; markDirty(); }, { required: true, rows: 8, locked, maxLength: 60000, placeholder: "Describe the agreed behavior, boundaries, decisions, and how we will know it works." }); specificationText.classList.add("planning-spec-text");
    for (const [index, task] of values.tasks.entries()) {
      const card = node("article", "planning-card", undefined, edit); node("h4", "", `Task ${index + 1}`, card);
      field(card, "Task title", `task-title-${index}`, task.title, (value) => { task.title = value; markDirty(); }, { required: true, locked, maxLength: 180 });
      field(card, "Brief for the builder", `task-prompt-${index}`, task.prompt, (value) => { task.prompt = value; markDirty(); }, { required: true, locked, rows: 3, maxLength: 16000 });
      field(card, "Acceptance checks — one per line", `task-acceptance-${index}`, task.acceptance, (value) => { task.acceptance = value; markDirty(); }, { required: true, locked, rows: 3 });
      dependencies(card, values.tasks.filter((other) => other.id !== task.id), task.dependsOn, (value) => { task.dependsOn = value; markDirty(); }, "Start after these tasks finish", locked);
      if (!locked) button("Remove task", card, () => { values.tasks = values.tasks.filter((other) => other.id !== task.id).map((other) => ({ ...other, dependsOn: other.dependsOn.filter((id) => id !== task.id) })); markDirty(); persist(); render(); }, `remove-slice-${index}`);
    }
    if (!locked) {
      const actions = node("div", "planning-actions", undefined, edit);
      button("+ Add a task", actions, () => { values.tasks.push(newSlice()); markDirty(); persist(); render(); $(`task-title-${values.tasks.length - 1}`)?.focus(); }, "add-slice");
      submit(actions, "Save specification draft", "save-spec", !settled(item) || unsavedPlan(item));
      node("p", "planning-subtle", local.specDirty ? "You have unsaved specification edits. Saving a revision clears any earlier approval." : "You can write this entire plan yourself; an assistant connection is optional.", edit);
    }
    const approve = node("div", "planning-confirm", undefined, area);
    approve.id = "plans-approval-section"; approve.tabIndex = -1;
    if (item.status === "converted") {
      const count = item.taskIds?.length || 0;
      node("p", "", `${count} ${count === 1 ? "task was" : "tasks were"} added to this project's queue. Open one to follow its progress.`, approve);
      const actions = node("div", "planning-actions", undefined, approve);
      for (const [index, id] of (item.taskIds || []).entries()) button(item.spec?.tasks?.[index]?.title || `Open task ${index + 1}`, actions, () => window.MefiNav?.go?.("tasks", { taskId: id }));
    } else if (item.status === "converting") {
      node("p", "", "Task creation started. Finish adding the approved tasks to the queue. Existing tasks will be reused.", approve);
      button("Finish creating tasks", approve, () => act("convert", {}, null, "Approved tasks are in your project's queue."), "convert", true);
    } else {
      node("p", "", unsavedPlan(item) ? "Save your destination, unknown, or question changes before drafting or approving the specification." : item.spec?.stale ? "Earlier decisions changed. Review and save a fresh specification before approving it." : item.spec?.approvedAt && !local.specDirty ? "You've approved this specification. Creating tasks adds them to the current queue; they can begin when scheduling is on and their prerequisites are complete." : "Your approval confirms the saved specification and every task brief. Approval alone keeps the work here until you choose to create the tasks.", approve);
      const actions = node("div", "planning-actions", undefined, approve);
      button(item.spec?.approvedAt ? "Specification approved" : "Approve specification", actions, () => act("approve-spec", {}, null, "Specification approved. You can now create the tasks."), "approve", false, !item.spec || !settled(item) || Boolean(local.specDirty) || Boolean(item.spec?.approvedAt) || item.spec?.stale || unsavedPlan(item));
      const count = item.spec?.tasks?.length || 0;
      button(`Create ${count} ${count === 1 ? "task" : "tasks"}`, actions, () => act("convert", {}, null, "Approved tasks are in your project's queue."), "convert", true, !item.spec?.approvedAt || Boolean(local.specDirty) || !count || unsavedPlan(item));
    }
  }
  function history(item) {
    if (!item.history?.length) return;
    const local = draft(); const area = node("details", "planning-card", undefined, $("detail")); area.id = "plans-history";
    node("summary", "", `Plan history · ${countLabel(item.history.length, "saved revision")}`, area);
    node("p", "planning-subtle", "Earlier decisions and specifications remain available here after you change the plan. Copy any text you want to use in a new revision.", area);
    const labels = { create: "Plan created", update: "Destination saved", "add-unknown": "Unknown added", "remove-unknown": "Unknown set aside", "add-question": "Question added", "edit-question": "Question edited", resolve: "Decision recorded", reopen: "Decision reopened", "add-note": "Discussion note saved", "draft-spec": "Specification drafted", "approve-spec": "Specification approved", "begin-conversion": "Task creation started", "mark-converted": "Tasks created" };
    const limit = local.historyLimit || 12;
    for (const entry of [...item.history].reverse().slice(0, limit)) {
      const row = node("details", "", undefined, area);
      node("summary", "", `Revision ${entry.version} · ${labels[entry.action] || "Plan updated"} · ${new Date(entry.at).toLocaleString()}`, row);
      let loaded = false;
      row.addEventListener("toggle", () => {
        if (!row.open || loaded) return; loaded = true;
        const snapshot = entry.snapshot; if (!snapshot) { node("p", "planning-subtle", "This older revision has no saved snapshot.", row); return; }
        node("h4", "", snapshot.title, row); node("p", "planning-answer", `Destination: ${snapshot.destination}`, row);
        if (snapshot.outOfScope) node("p", "planning-answer planning-subtle", `Outside this plan: ${snapshot.outOfScope}`, row);
        if (entry.reason) node("p", "planning-answer", `Reason: ${entry.reason}`, row);
        for (const question of snapshot.questions || []) {
          const decision = node("article", "planning-note", undefined, row); node("strong", "", question.question, decision);
          node("p", "", question.status === "resolved" ? question.resolution : "Open at this revision", decision);
          if (question.evidence) node("p", "planning-subtle", `Evidence: ${question.evidence}`, decision);
        }
        if (snapshot.spec) {
          const spec = node("details", "", undefined, row); node("summary", "", "Specification and task briefs at this revision", spec);
          node("p", "planning-answer", snapshot.spec.text, spec);
          for (const task of snapshot.spec.tasks || []) { const card = node("article", "planning-note", undefined, spec); node("strong", "", task.title, card); node("p", "", task.prompt, card); node("p", "", `Acceptance: ${Array.isArray(task.acceptance) ? task.acceptance.join("\n") : task.acceptance}`, card); }
        }
      });
    }
    if (item.history.length > limit) button("Show older revisions", area, () => { local.historyLimit = limit + 12; render(); const last = $("detail").lastElementChild; if (last) last.open = true; });
  }
  function render() {
    renderList(); $("detail").replaceChildren();
    if (!state.projectId) { node("p", "planning-empty", "Open the desktop app and choose a project to start planning.", $("detail")); controls(); return; }
    const item = plan();
    renderWorkflow(item);
    details(item); if (item) { unknowns(item); questions(item); specification(item); history(item); }
    controls();
  }
  async function refreshWork() {
    const item = plan();
    if (!state.opened || document.hidden || !frozen(item) || state.busy) return;
    const epoch = state.epoch, projectId = state.projectId, selected = state.selected;
    const key = JSON.stringify([epoch, projectId, selected]);
    if (workFlight?.key === key) return workFlight.promise;
    const readId = ++state.workReadId;
    const current = () => state.opened && epoch === state.epoch && projectId === state.projectId && selected === state.selected && readId === state.workReadId;
    const flight = { key };
    flight.promise = (async () => {
      try {
        if (!api()?.tasksList) throw new Error("Task status unavailable");
        const result = guard(await api().tasksList());
        if (!current()) return;
        if (result.projectId !== projectId || !Array.isArray(result.tasks)) throw new Error("Task status belongs to another project");
        const next = result.tasks.filter((task) => !task.projectId || task.projectId === projectId);
        const changed = JSON.stringify(next) !== JSON.stringify(state.tasks) || state.workError;
        state.tasks = next; state.workError = null;
        if (changed) { renderWorkflow(plan()); controls(); }
      } catch (error) {
        if (current()) { state.tasks = null; state.workError = error.message; renderWorkflow(plan()); controls(); }
      }
    })().finally(() => { if (workFlight === flight) workFlight = null; });
    workFlight = flight; return flight.promise;
  }
  function stopWorkPoll() {
    window.MefiBoot?.pollStop?.("planning.work");
    if (workTimer !== null) { clearInterval(workTimer); workTimer = null; }
    state.workReadId += 1; workFlight = null;
  }
  function startWorkPoll() {
    stopWorkPoll();
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("planning.work", refreshWork, 4000);
    else if (typeof setInterval === "function") workTimer = setInterval(refreshWork, 4000);
    void refreshWork();
  }
  async function refresh({ refreshTasks = true } = {}) {
    if (state.busy) return;
    const epoch = state.epoch; const readId = ++state.readId;
    try {
      if (!api()?.projectsList || !api()?.planningList) { render(); note("Planning is available in the desktop app."); return; }
      const projects = guard(await api().projectsList());
      if (epoch !== state.epoch || readId !== state.readId) return;
      if (state.projectId !== projects.activeId) { state.projectId = projects.activeId; state.plans = []; state.selected = "new"; state.tasks = null; state.workError = null; state.workReadId += 1; }
      const projectId = state.projectId; state.projectName = projects.projects.find((item) => item.id === projectId)?.name || "Your project";
      const result = guard(await api().planningList({ projectId }));
      if (epoch !== state.epoch || readId !== state.readId || projectId !== state.projectId || (result.projectId && result.projectId !== projectId)) return;
      state.plans = result.plans || []; render(); if (refreshTasks) void refreshWork();
    } catch (error) { if (epoch === state.epoch && readId === state.readId) { render(); note(error.message, true); } }
  }
  async function open(options = {}) {
    init(); priorFocus = document.activeElement; state.opened = true; $("overlay").hidden = false;
    window.MefiNav?.claim?.("plans"); note("Opening this project's plans…");
    await refresh({ refreshTasks: false });
    if (!state.opened) return;
    if (options.create) { state.selected = "new"; if (options.destination && !draft().details?.destination) { draft().details = { title: "", destination: String(options.destination), outOfScope: "" }; persist(); } }
    else if (options.planId) state.selected = options.planId;
    else if (state.selected === "new" && state.plans.length) state.selected = state.plans[0].id;
    render(); if (state.projectId && api()?.planningList && $("notice").dataset.error !== "true") note("Your drafts stay with this project. Planning does not start build work.");
    startWorkPoll();
    (options.create ? $("title") : $("new"))?.focus();
  }
  function close() { if (!$("overlay") || $("overlay").hidden) return; persist(); state.opened = false; stopWorkPoll(); $("overlay").hidden = true; window.MefiNav?.release?.("plans"); if (!window.MefiNav?.release) priorFocus?.focus?.(); }
  function init() {
    if (initialized || !$("overlay")) return; initialized = true;
    $("new").addEventListener("click", () => { if (state.busy) return; state.selected = "new"; render(); note(); $("title")?.focus(); });
    $("refresh").addEventListener("click", () => refresh()); $("close").addEventListener("click", close);
    $("overlay").addEventListener("click", (event) => { if (event.target === $("overlay")) close(); });
    $("sheet").addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab" && !window.MefiNav?.claim) {
        const fields = [...$("sheet").querySelectorAll("button, input, textarea, select, summary")].filter((element) => !element.disabled && !element.hidden && element.offsetParent !== null);
        if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
      }
    });
    window.addEventListener("mefi:project-changed", (event) => {
      const projectId = event.detail?.projectId; if (projectId === state.projectId) return;
      persist(); state.epoch += 1; state.readId += 1; state.workReadId += 1; state.projectId = projectId; state.selected = "new"; state.plans = []; state.tasks = null; state.workError = null; state.busy = false; state.pending = null;
      if (state.opened) { render(); note("Opening this project's plans…"); void refresh(); }
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.opened) void refreshWork(); });
    window.addEventListener("beforeunload", persist);
  }
  window.MefiPlanning = { open, close, refresh, init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
