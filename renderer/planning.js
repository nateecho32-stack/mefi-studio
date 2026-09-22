// Project-local decisions and reviewed task handoffs. Mefi interviews you here
// and organizes what you say; model calls happen only after explicit buttons,
// and nothing it writes becomes your answer, your decision, or your approval.
(() => {
  "use strict";
  const $ = (name) => document.getElementById(`plans-${name}`);
  const api = () => window.mefiStudio;
  const state = { projectId: null, projectName: "Your project", plans: [], selected: "new", busy: false, pending: null, tasks: null, workError: null, epoch: 0, opened: false, readId: 0, workReadId: 0, existing: null, existingOpen: false };
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
  const confirmed = (item) => Boolean(item?.reviewedAt);
  // Where every line of the interview came from. Only your own answer states a
  // requirement; a reading or suggestion stays a proposal until you resolve the
  // question yourself. Notes saved before kinds existed read as plain notes.
  const noteLabels = { answer: "You answered", note: "Your note", question: "Mefi asked", interpretation: "Mefi understood this — not yet your decision", advice: "Mefi suggested", conflict: "Mefi flagged a conflict" };
  const noteLabel = (note) => noteLabels[note.kind] || (note.author === "user" ? noteLabels.note : noteLabels.advice);
  // The one thing Mefi is waiting on: its newest follow-up, else a question it
  // opened that you have not answered, else the next question ready to explore.
  // `awaiting` separates the first two — your turn to answer — from the last,
  // where the interview has said its piece and the decision is yours to record.
  function pendingAsk(item) {
    const open = (item?.questions || []).filter((question) => question.status === "open");
    for (const question of [...open].reverse()) {
      const last = (question.notes || []).at(-1);
      if (last?.author === "assistant" && ["question", "conflict"].includes(last.kind)) return { question, ask: last.text, followUp: true, awaiting: true };
    }
    const fresh = [...open].reverse().find((question) => !(question.notes || []).some((note) => note.author === "user"));
    if (fresh) return { question: fresh, ask: fresh.question, followUp: false, awaiting: true };
    const next = open.find((question) => ready(item, question)) || open[0];
    return next ? { question: next, ask: next.question, followUp: false, awaiting: false } : null;
  }
  const unsavedDestination = (item) => Boolean(item && draft().details && ["title", "destination", "outOfScope"].some((key) => draft().details[key] !== item[key]));
  const unsavedQuestions = (item) => Boolean(item?.questions?.some((question) => { const edit = draft().editDirty?.[question.id] && draft().edits?.[question.id]; return edit && (edit.question !== question.question || edit.type !== question.type || JSON.stringify([...edit.dependsOn].sort()) !== JSON.stringify([...question.dependsOn].sort())); }));
  const unsavedPlan = (item) => !frozen(item) && (unsavedDestination(item) || unsavedQuestions(item) || Boolean(draft().unknown?.trim()) || Boolean(draft().question?.question?.trim()));
  function reviewGates() {
    const item = plan(); if (!item) return;
    const pending = unsavedPlan(item); const dirty = Boolean(draft().specDirty);
    const locks = { "suggest-questions": pending, "confirm-understanding": pending || !settled(item) || confirmed(item), "draft-spec": pending || dirty || !settled(item) || !confirmed(item), "save-spec": pending || !settled(item) || !confirmed(item), approve: pending || dirty || !settled(item) || !confirmed(item) || !item.spec || Boolean(item.spec?.stale) || Boolean(item.spec?.approvedAt), convert: item.status === "converting" ? false : pending || dirty || !item.spec?.approvedAt || !item.spec?.tasks?.length };
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
  const flowStages = [["idea", "The idea"], ["explore", "Mefi asks"], ["decisions", "Your decisions"], ["review", "Your review"], ["spec", "Specification"], ["approval", "Your approval"], ["build", "Build"], ["verify", "Verify"]];
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
    const label = (stage, fallback) => window.MefiStage?.label?.(stage, task) ?? fallback;
    if (["done", "archived", "completed"].includes(task.status)) {
      if (task.verification?.state === "verified") return { stage: "done", label: label("done", "Done · Verified") };
      if (task.verification?.state === "manual") return { stage: "done", label: label("done", "Done · Confirmed by you") };
      return { stage: "review", label: "Done · Review evidence" };
    }
    if (["awaiting_verification", "verifying"].includes(task.status)) return { stage: "review", label: label("review", "Verifying") };
    if (["active", "running"].includes(task.status) || task.runId) return { stage: "running", label: label("running", "Working") };
    if (task.verification?.state === "failed" || (task.runFailures || 0) >= 5 || (task.verifyAttempts || 0) >= 3) return { stage: "blocked", label: label("blocked", "Needs attention") };
    if (task.absorbedInto) return { stage: "waiting", label: label("grouped", "In a plan") };
    if (task.dependsOn?.some((id) => !tasks.some((other) => other.id === id && ["done", "archived", "completed"].includes(other.status)))) return { stage: "waiting", label: `${label("waiting", "Waiting")} · on a task` };
    if (task.nextRunAt > Date.now()) return { stage: "waiting", label: label("cooling", "Retry scheduled") };
    return { stage: "queued", label: label("ready", "Ready") };
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
      : resolved.length < questions.length ? (!pendingAsk(item)?.awaiting && frontier.some((question) => question.notes?.length) ? "decisions" : "explore")
      : !confirmed(item) ? "review"
      : !item.spec || item.spec.stale ? "spec" : !item.spec.approvedAt ? "approval" : "build";
    if (state.pending?.assist) current = state.pending.kind === "spec" ? "spec" : "explore";
    const completed = new Set(item ? ["idea"] : []);
    if (item && !unknowns && (questions.length > 0 || item.spec) && resolved.length === questions.length) { completed.add("explore"); completed.add("decisions"); }
    if (confirmed(item)) completed.add("review");
    if (item?.spec && !item.spec.stale) completed.add("spec");
    if (item?.spec?.approvedAt) completed.add("approval");
    if (complete) { completed.add("build"); completed.add("verify"); }
    return { current, completed, questions, resolved, frontier, blocked, unknowns, work, complete, ask: pendingAsk(item) };
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
    const subtitles = { idea: item ? "Destination saved" : "Set a destination", explore: flow.ask?.awaiting ? "Waiting for your answer" : `${flow.frontier.length} ready · ${flow.blocked.length} blocked`, decisions: decided, review: confirmed(item) ? "Confirmed by you" : "Read it back", spec: item?.spec?.stale ? "Needs revision" : item?.spec ? "Draft saved" : "Shape the build", approval: item?.spec?.approvedAt ? "Approved by you" : "Review together", build: frozen(item) ? `${flow.work.filter((task) => task.stage === "running").length} working · ${countLabel(item.taskIds?.length || 0, "task")}` : "Create tasks", verify: frozen(item) ? `${flow.work.filter((task) => task.stage === "done").length}/${flow.work.length} confirmed` : "Check the result" };
    for (const [index, [id, label]] of flowStages.entries()) {
      const row = node("li", "", undefined, rail);
      const jump = () => {
        if (id === "idea") navigateTo("title", "destination-section");
        else if (id === "explore") navigateTo("interview-answer", "interview-start", "interview-section", "destination-section");
        else if (id === "decisions") { const question = flow.frontier[0] || flow.questions[0]; navigateTo(question ? `resolution-${question.id}` : "questions-section", question ? `question-card-${question.id}` : "destination-section"); }
        else if (id === "review") navigateTo("confirm-understanding", "review-section", "destination-section");
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
    const next = { idea: "Start with the outcome you want. Nothing runs until you choose the next action.", explore: flow.ask?.awaiting ? "Mefi is waiting for your answer. Reply in your own words; it reads your answer back before moving on." : flow.unknowns ? `${flow.unknowns} unknown${flow.unknowns === 1 ? " needs" : "s need"} a question or a reason to set aside.` : "Let Mefi ask you the next question, or add one yourself.", decisions: "Read the interview back, then record your own decisions.", review: "Read what this plan now says the feature is. Nothing is drafted until you confirm it.", spec: "The decisions are settled. Draft the specification and its small implementation tasks.", approval: "Review the saved specification, task briefs, and acceptance checks before approving.", build: item?.status === "converted" ? "Tasks follow the current queue and Pause settings. Their board status is shown below." : item?.status === "converting" ? "Finish creating the approved tasks. Existing tasks will be reused." : "Your specification is approved. Create its tasks when you are ready.", verify: flow.complete ? "Every linked task has verified evidence or your recorded confirmation." : "A worker result is ready for verification. Open the task to inspect its evidence." };
    const pendingQuestion = flow.questions.find((question) => question.id === state.pending?.questionId);
    node("span", "", state.pending?.assist ? state.pending.kind === "spec" ? "Mefi is drafting the specification from your saved decisions…" : state.pending.kind === "interview" ? "Mefi is reading your answer and working out what to ask next…" : state.pending.kind === "question" ? `Mefi is exploring: ${pendingQuestion?.question || "the selected question"}` : "Mefi is looking for questions in your saved destination…" : next[flow.current], status);
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
        if (question.notes?.length && questionState !== "resolved") node("small", "", `${countLabel(question.notes.length, "interview line")} · your decision is open`, jump);
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
    const area = section("3. Loose ends we noticed", "Uncertainties too vague to decide yet. Turn one into a question, or explain why it no longer needs an answer.");
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
  // The interview, shown wherever a question appears. Each line says where it
  // came from, and Mefi's reading of your answer can only ever be copied into
  // your decision box for you to edit and record yourself.
  function transcript(parent, item, question, locked = false) {
    const local = draft(); const wrap = node("div", "planning-notes", undefined, parent);
    for (const entry of question.notes || []) {
      const row = node("div", "planning-note", undefined, wrap);
      row.dataset.noteKind = entry.kind || (entry.author === "user" ? "note" : "advice");
      node("strong", "", noteLabel(entry), row); node("p", "", entry.text, row);
      if (entry.kind === "interpretation" && question.status !== "resolved" && !locked) button("Use as my decision", row, () => {
        local.answers ||= {}; (local.answers[question.id] ||= { resolution: "", evidence: "" }).resolution = entry.text;
        persist(); render(); navigateTo(`resolution-${question.id}`, `question-card-${question.id}`);
        note("Mefi's reading is in your decision box. Edit it until it says what you mean, then record it.");
      }, `use-note-${entry.id}`);
    }
    if (!(question.notes || []).length) node("p", "planning-subtle", "Nothing said about this yet.", wrap);
    return wrap;
  }
  function interviewPanel(item) {
    const area = section("2. Mefi's questions for you", "Mefi asks, you answer in your own words, and it reads your answer back before moving on. Nothing here records a decision — you do that under each question.");
    area.id = "plans-interview-section"; area.tabIndex = -1;
    if (frozen(item)) { node("p", "planning-subtle", "This plan is on the task board. Its interview stays below as a record.", area); return; }
    const local = draft(); const values = local.interview ||= { message: "", useWeb: false };
    const pending = unsavedPlan(item); const ask = pendingAsk(item);
    const card = node("article", "planning-card planning-interview", undefined, area);
    if (!ask) {
      node("p", "planning-interview-ask", item.questions?.length ? "Mefi has nothing open. Ask it to keep going, or review what you understand together." : "Mefi hasn't asked anything yet. It will start with the one question that would most change what gets built.", card);
      const actions = node("div", "planning-actions", undefined, card);
      button(item.questions?.length ? "Ask me something else" : "Start the interview", actions, async () => { if (await act("interview", { kind: "interview" }, null, "Mefi asked a question. Answer it in your own words.", true)) navigateTo("interview-answer"); }, "interview-start", true, pending);
      if (item.questions?.length && settled(item)) navigation("Review what we understand ↓", actions, () => navigateTo("confirm-understanding", "review-section"), "interview-to-review", "ghost mini");
      node("p", "planning-subtle", pending ? "Save your destination, unknown, or question edits first." : "Uses your configured assistant connection. You can also write the questions yourself below.", card);
      return;
    }
    const index = item.questions.indexOf(ask.question) + 1;
    node("span", "planning-pill", ask.followUp ? `Follow-up on Q${index}` : `Q${index} · ${typeChoices.find(([type]) => type === ask.question.type)?.[1] || ask.question.type}`, card).dataset.state = "ready";
    node("p", "planning-interview-ask", ask.ask, card).id = "plans-interview-ask";
    const talk = node("details", "", undefined, card); talk.open = local.interviewOpen !== false;
    node("summary", "", `What we've said about this${ask.question.notes?.length ? ` · ${countLabel(ask.question.notes.length, "line")}` : ""}`, talk);
    talk.addEventListener("toggle", () => { local.interviewOpen = talk.open; persist(); });
    transcript(talk, item, ask.question);
    field(card, "Your answer", "interview-answer", values.message, (value) => { values.message = value; }, { rows: 4, maxLength: 16000, placeholder: "Answer in your own words. Say what you want to be true, not how to build it." });
    const checkLabel = node("label", "planning-check", undefined, card); const check = node("input", "", undefined, checkLabel); check.type = "checkbox"; check.checked = Boolean(values.useWeb);
    node("span", "", "Let Mefi cite web references", checkLabel);
    check.addEventListener("change", () => { values.useWeb = check.checked; persist(); });
    const actions = node("div", "planning-actions", undefined, card);
    const clean = (saved) => { delete saved.interview; };
    button("Send answer", actions, async () => {
      if (!values.message.trim()) { note("Type your answer first, or ask Mefi to explain the tradeoffs.", true); navigateTo("interview-answer"); return; }
      if (await act("interview", { kind: "interview", questionId: ask.question.id, message: values.message, useWeb: values.useWeb }, clean, "Mefi read your answer back. Check what it understood, then answer the next question.", true)) navigateTo("interview-answer", "interview-start");
    }, "interview-send", true, pending);
    button("Explain the tradeoffs", actions, () => act("question", { kind: "question", questionId: ask.question.id, message: values.message, useWeb: values.useWeb }, clean, "Mefi explained the tradeoffs. It still needs your answer.", true), "interview-explain", false, pending);
    navigation("Record my decision ↓", actions, () => navigateTo(`resolution-${ask.question.id}`, `question-card-${ask.question.id}`), "interview-to-decision", "ghost mini");
    node("p", "planning-subtle", pending ? "Save your destination, unknown, or question edits first." : "Uses your configured assistant connection. Mefi does the asking and the organizing; every decision stays yours.", card);
  }
  // The gate the specification waits behind: what this plan now says the
  // feature is, in your words, with anything Mefi only proposed kept separate.
  function review(item) {
    const area = section("5. What we understand", "Read this back before anything is drafted. It is built from your decisions, not from Mefi's suggestions.");
    area.id = "plans-review-section"; area.tabIndex = -1;
    node("p", "planning-answer", `Destination: ${item.destination}`, area);
    if (item.outOfScope) node("p", "planning-answer planning-subtle", `Outside this plan: ${item.outOfScope}`, area);
    const decided = (item.questions || []).filter((question) => question.status === "resolved");
    for (const [index, question] of decided.entries()) {
      const row = node("article", "planning-card", undefined, area);
      node("h4", "", `${index + 1}. ${question.question}`, row);
      node("p", "planning-answer", question.resolution, row);
      node("p", "planning-subtle", question.evidence ? `Confirmed by you · Evidence: ${question.evidence}` : "Confirmed by you", row);
      const proposed = (question.notes || []).filter((note) => note.author === "assistant" && ["interpretation", "advice"].includes(note.kind));
      if (!proposed.length) continue;
      const more = node("details", "", undefined, row);
      node("summary", "", `${countLabel(proposed.length, "line")} Mefi proposed that your decision does not include`, more);
      for (const entry of proposed) { const line = node("div", "planning-note", undefined, more); line.dataset.noteKind = entry.kind; node("strong", "", noteLabel(entry), line); node("p", "", entry.text, line); }
    }
    if (!decided.length) node("p", "planning-subtle", "No decisions were needed. The destination above is the whole understanding.", area);
    const open = [...(item.questions || []).filter((question) => question.status !== "resolved").map((question) => question.question), ...(item.unknowns || []).map((unknown) => unknown.text)];
    if (open.length) node("p", "planning-subtle", `Still unresolved: ${open.join(" · ")}`, area);
    if (frozen(item)) return;
    const confirm = node("div", "planning-confirm", undefined, area);
    node("p", "", confirmed(item) ? `You confirmed this on ${new Date(item.reviewedAt).toLocaleString()}. Changing the destination, an unknown, or any decision asks you to read it again.`
      : settled(item) ? "Confirm this is the feature you meant. Mefi drafts the specification only from what you confirm here."
      : "Finish the interview first: every question needs your decision, and every unknown a question or a reason to set it aside.", confirm);
    button(confirmed(item) ? "Understanding confirmed" : "Yes, this is what I meant", confirm, () => act("confirm-understanding", {}, null, "Understanding confirmed. You can draft the specification now."), "confirm-understanding", true, !settled(item) || confirmed(item) || unsavedPlan(item));
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
    const talk = node("details", "", undefined, card); talk.open = Boolean(local.talkOpen?.[id]); node("summary", "", `The interview on this question${question.notes?.length ? ` · ${countLabel(question.notes.length, "line")}` : " · nothing said yet"}`, talk);
    talk.addEventListener("toggle", () => { local.talkOpen ||= {}; local.talkOpen[id] = talk.open; persist(); });
    transcript(talk, item, question, locked);
    if (!locked && !resolved) {
      const values = local.conversations[id] ||= { message: "", useWeb: false };
      field(talk, "Answer this, or ask Mefi about it", `note-${id}`, values.message, (value) => { values.message = value; }, { rows: 3, maxLength: 16000, placeholder: "Answer in your own words, or ask what the tradeoffs are…" });
      const checkLabel = node("label", "planning-check", undefined, talk); const check = node("input", "", undefined, checkLabel); check.type = "checkbox"; check.checked = Boolean(values.useWeb);
      node("span", "", "Include web references in Mefi's answer", checkLabel); check.addEventListener("change", () => { values.useWeb = check.checked; persist(); });
      const actions = node("div", "planning-actions", undefined, talk);
      const clean = (saved) => { delete saved.conversations?.[id]; saved.talkOpen ||= {}; saved.talkOpen[id] = true; };
      button("Send answer", actions, async () => {
        if (!values.message.trim()) { note("Type your answer first, or ask Mefi to explain the tradeoffs.", true); navigateTo(`note-${id}`); return; }
        if (await act("interview", { kind: "interview", questionId: id, message: values.message, useWeb: values.useWeb }, clean, "Mefi read your answer back. Check what it understood, then answer the next question.", true)) navigateTo("interview-answer", `note-${id}`);
      }, `answer-${id}`, true);
      button("Explain the tradeoffs", actions, () => act("question", { kind: "question", questionId: id, message: values.message, useWeb: values.useWeb }, clean, "Mefi explained the tradeoffs. Your decision is still open below.", true), `ask-${id}`);
      button("Save my note", actions, () => act("add-note", { questionId: id, text: values.message }, clean, "Your note is saved."), `save-note-${id}`);
      node("p", "planning-subtle", "Uses your configured assistant connection. Mefi's lines are proposals; only the decision you record below is a requirement.", talk);
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
    const area = section("4. Every question and your decision", "The full map of what the interview opened. Record a decision only after you have reviewed what was said.");
    area.id = "plans-questions-section"; area.tabIndex = -1;
    if (!frozen(item)) {
      const actions = node("div", "planning-actions", undefined, area);
      button("Suggest more questions", actions, () => act("questions", { kind: "questions" }, null, "Questions added for you to review.", true), "suggest-questions", false, unsavedPlan(item));
      node("span", "planning-subtle", "A batch of open questions in one go. The interview above asks them one at a time and follows what you say.", actions);
    }
    for (const question of item.questions || []) questionCard(area, item, question);
    if (!item.questions.length) node("p", "planning-subtle", "Start with one question that could change what you build.", area);
    if (!frozen(item)) { const add = node("details", "planning-card", undefined, area); add.open = !item.questions.length || Boolean(draft().question?.question); node("summary", "", "+ Add a question yourself", add); questionEditor(add, item); }
  }
  function newSlice() { return { id: `slice-${Date.now().toString(36)}-${++sliceCounter}`, title: "", prompt: "", acceptance: "", dependsOn: [] }; }
  function specification(item) {
    const area = section("6. Turn decisions into a build plan", "Review the specification and small tasks. Each task needs a clear brief, acceptance checks, and any tasks it must wait for.");
    area.id = "plans-specification-section"; area.tabIndex = -1;
    const local = draft(); const locked = frozen(item);
    if (!local.specDirty || locked) { delete local.spec; delete local.specDirty; }
    const values = local.spec ||= { text: item.spec?.text || "", tasks: (item.spec?.tasks || []).map((task) => ({ ...task, acceptance: Array.isArray(task.acceptance) ? task.acceptance.join("\n") : task.acceptance || "", dependsOn: [...(task.dependsOn || [])] })) };
    const markDirty = () => { local.specDirty = true; reviewGates(); };
    if (!locked && (!settled(item) || !confirmed(item))) node("p", "planning-subtle", settled(item) ? "Draft here as you think. Confirm what you understand in section 5 before asking Mefi for a specification or approving tasks." : "Draft here as you think. Settle all unknowns and questions, then confirm what you understand, before drafting or approving.", area);
    if (!locked) {
      const actions = node("div", "planning-actions", undefined, area);
      button("Draft specification with Mefi", actions, () => act("spec", { kind: "spec" }, (saved) => { delete saved.spec; delete saved.specDirty; }, "Specification drafted. Review the text, task briefs and acceptance checks.", true), "draft-spec", false, !settled(item) || !confirmed(item) || Boolean(local.specDirty) || unsavedPlan(item));
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
      submit(actions, "Save specification draft", "save-spec", !settled(item) || !confirmed(item) || unsavedPlan(item));
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
      node("p", "", unsavedPlan(item) ? "Save your destination, unknown, or question changes before drafting or approving the specification." : !confirmed(item) ? "Confirm what you understand in section 5 first. Approval builds on the reading you confirmed, not on Mefi's suggestions." : item.spec?.stale ? "Earlier decisions changed. Review and save a fresh specification before approving it." : item.spec?.approvedAt && !local.specDirty ? "You've approved this specification. Creating tasks adds them to the current queue; they can begin when scheduling is on and their prerequisites are complete." : "Your approval confirms the saved specification and every task brief. Approval alone keeps the work here until you choose to create the tasks.", approve);
      const actions = node("div", "planning-actions", undefined, approve);
      button(item.spec?.approvedAt ? "Specification approved" : "Approve specification", actions, () => act("approve-spec", {}, null, "Specification approved. You can now create the tasks."), "approve", false, !item.spec || !settled(item) || !confirmed(item) || Boolean(local.specDirty) || Boolean(item.spec?.approvedAt) || item.spec?.stale || unsavedPlan(item));
      const count = item.spec?.tasks?.length || 0;
      button(`Create ${count} ${count === 1 ? "task" : "tasks"}`, actions, () => act("convert", {}, null, "Approved tasks are in your project's queue."), "convert", true, !item.spec?.approvedAt || Boolean(local.specDirty) || !count || unsavedPlan(item));
    }
  }
  function history(item) {
    if (!item.history?.length) return;
    const local = draft(); const area = node("details", "planning-card", undefined, $("detail")); area.id = "plans-history";
    node("summary", "", `Plan history · ${countLabel(item.history.length, "saved revision")}`, area);
    node("p", "planning-subtle", "Earlier decisions and specifications remain available here after you change the plan. Copy any text you want to use in a new revision.", area);
    const labels = { create: "Plan created", update: "Destination saved", "add-unknown": "Unknown added", "remove-unknown": "Unknown set aside", "add-question": "Question added", "edit-question": "Question edited", resolve: "Decision recorded", reopen: "Decision reopened", "add-note": "Interview line saved", "confirm-understanding": "Understanding confirmed", "draft-spec": "Specification drafted", "approve-spec": "Specification approved", "begin-conversion": "Task creation started", "mark-converted": "Tasks created" };
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
  // What the folder already holds, read by the desktop app when the plans
  // list is fetched: wayfinder maps and tickets on the repo's issue tracker
  // (local .scratch/ files or GitHub issues) and the agents, skills and
  // commands its coding tools can call. Shown while a new idea is being
  // set up so an existing map is planned from, not planned twice; a saved
  // plan keeps it folded under a summary line.
  function existingWork(item) {
    const work = state.existing;
    if (!work) return;
    const area = section("Already in this project", "Maps, tickets and issues Studio found in this folder, and the tooling available to the agents that will work here.");
    area.id = "plans-existing-section"; area.classList.add("planning-existing");
    if (work.ok === false) { node("p", "planning-subtle", `The folder could not be scanned: ${work.error || "unknown error"}.`, area); return; }
    const tracker = work.tracker || {};
    const efforts = Array.isArray(work.efforts) ? work.efforts : [];
    const remote = work.remote || null;
    const tooling = work.tooling || null;
    const counts = work.counts || {};
    const trackerName = { github: "GitHub issues", gitlab: "GitLab issues", linear: "Linear", local: "local markdown under .scratch/", other: "a custom tracker" }[tracker.kind] || null;
    const summary = [
      trackerName ? `Issue tracker: ${trackerName}` : "No issue tracker configured",
      `${countLabel(counts.maps || 0, "map")}`,
      `${countLabel(counts.open || 0, "open ticket")}${counts.frontier ? ` (${counts.frontier} on the frontier)` : ""}`,
      tooling ? `${countLabel(tooling.counts?.agents || 0, "agent")}, ${countLabel(tooling.counts?.skills || 0, "skill")}, ${countLabel(tooling.counts?.commands || 0, "command")}` : null,
    ].filter(Boolean).join(" · ");
    const folded = Boolean(item) && !state.existingOpen;
    const wrap = node("details", "", undefined, area); wrap.open = !folded; wrap.id = "plans-existing-details";
    const head = node("summary", "", summary, wrap); head.id = "plans-existing-summary";
    wrap.addEventListener("toggle", () => { state.existingOpen = Boolean(wrap.open); });
    const grid = node("div", "planning-existing-grid", undefined, wrap);
    const card = (title) => { const result = node("article", "planning-card", undefined, grid); node("h4", "", title, result); return result; };
    // The tracker and its docs.
    const setup = card(trackerName ? `Tracker: ${trackerName}` : "No issue tracker yet");
    if (!trackerName) node("p", "planning-subtle", "Nothing under docs/agents/issue-tracker.md and no .scratch/ tickets. Run the engineering skills' setup (setup-matt-pocock-skills) in this folder, or plan here and create tasks on the board.", setup);
    else {
      if (tracker.summary) node("p", "planning-subtle", tracker.summary, setup);
      const docs = node("ul", "", undefined, setup);
      for (const [label, file] of [["Tracker", tracker.doc], ["Triage labels", tracker.labelsDoc], ["Domain docs", tracker.domainDoc], ["Context", tracker.contextDoc], ["Context map", tracker.contextMap]]) if (file) { const row = node("li", "", `${label}: `, docs); node("code", "", file, row); }
    }
    // Local efforts: map, spec, tickets.
    const planFrom = (title, destination) => { state.selected = "new"; draft().details = { title: String(title || "").slice(0, 180), destination: String(destination || ""), outOfScope: "" }; draft().detailsDirty = true; persist(); render(); note(`Planning from "${title}". The map stays where it is; this plan records your decisions in Studio.`); $("destination")?.focus(); };
    if (!efforts.length && !(remote?.maps?.length || remote?.tickets?.length)) {
      const none = card("No maps or tickets found");
      node("p", "planning-subtle", tracker.kind === "github" ? (remote?.ok === false ? `GitHub issues could not be listed: ${remote.error}.` : "The repository has no open issues right now.") : "A wayfinder map lives at .scratch/<effort>/map.md with tickets under issues/; none exist here yet.", none);
    }
    for (const effort of efforts.slice(0, 12)) {
      const box = card(effort.map ? effort.map.title : effort.spec ? effort.spec.title : effort.slug);
      const meta = node("p", "planning-subtle", undefined, box);
      meta.textContent = [effort.dir, effort.map ? "wayfinder map" : null, effort.spec ? "spec" : null, effort.tickets.length ? `${countLabel(effort.counts.open + effort.counts.claimed, "open ticket")} · ${effort.counts.frontier} on the frontier · ${effort.counts.resolved} resolved` : null].filter(Boolean).join(" · ");
      if (effort.map?.destination) node("p", "", effort.map.destination, box);
      if (effort.map) node("p", "planning-subtle", `${countLabel(effort.map.decisions, "decision")} so far · ${countLabel(effort.map.fog, "item")} not yet specified · ${countLabel(effort.map.outOfScope, "item")} out of scope`, box);
      const frontier = effort.tickets.filter((ticket) => ticket.status !== "resolved").slice(0, 6);
      if (frontier.length) {
        const list = node("ul", "", undefined, box);
        for (const ticket of frontier) { const row = node("li", "", `${ticket.number !== null ? `${String(ticket.number).padStart(2, "0")} ` : ""}${ticket.title}`, list); node("small", "", ` · ${ticket.status}${ticket.type ? ` · ${ticket.type}` : ""}${ticket.blockedBy.length && !ticket.unblocked ? ` · blocked by ${ticket.blockedBy.join(", ")}` : ""}`, row); }
        if (effort.tickets.filter((ticket) => ticket.status !== "resolved").length > frontier.length) node("p", "planning-subtle", `+${effort.tickets.filter((ticket) => ticket.status !== "resolved").length - frontier.length} more open`, box);
      }
      if (effort.map && !frozen(item)) { const actions = node("div", "planning-actions", undefined, box); button("Plan from this map", actions, () => planFrom(effort.map.title, effort.map.destination), `plan-from-${effort.slug}`); }
    }
    // Remote tracker: GitHub maps and issues.
    if (remote?.ok) {
      for (const map of remote.maps.slice(0, 6)) {
        const box = card(map.title);
        node("p", "planning-subtle", `GitHub issue #${map.number} · wayfinder map${map.assigned ? " · claimed" : ""}`, box);
        const actions = node("div", "planning-actions", undefined, box);
        if (!frozen(item)) button("Plan from this map", actions, () => planFrom(map.title, map.url ? `Reach the destination of the wayfinder map "${map.title}" (${map.url}).` : ""), `plan-from-issue-${map.number}`);
      }
      if (remote.tickets.length) {
        const box = card(`${countLabel(remote.tickets.length, "open GitHub issue")}`);
        node("p", "planning-subtle", `${remote.counts?.readyForAgent || 0} ready-for-agent · ${remote.counts?.claimed || 0} assigned · ${remote.counts?.wayfinder || 0} wayfinder tickets`, box);
        const list = node("ul", "", undefined, box);
        for (const issue of remote.tickets.slice(0, 8)) { const row = node("li", "", `#${issue.number} ${issue.title}`, list); if (issue.labels.length) node("small", "", ` · ${issue.labels.slice(0, 3).join(", ")}`, row); }
        if (remote.tickets.length > 8) node("p", "planning-subtle", `+${remote.tickets.length - 8} more`, box);
      }
    } else if (remote && remote.ok === false && efforts.length) node("p", "planning-subtle", `GitHub issues could not be listed: ${remote.error}.`, wrap);
    // Tooling: agents, skills, commands by scope.
    if (tooling) {
      const box = card("Tooling available here");
      const docs = [tooling.docs?.claudeMd, tooling.docs?.agentsMd, tooling.docs?.mcp].filter(Boolean);
      node("p", "planning-subtle", `${countLabel(tooling.counts?.agents || 0, "agent")} · ${countLabel(tooling.counts?.skills || 0, "skill")} · ${countLabel(tooling.counts?.commands || 0, "command")}${tooling.counts?.plugins ? ` · ${countLabel(tooling.counts.plugins, "plugin")}` : ""}${docs.length ? ` · ${docs.join(", ")}` : ""}`, box);
      const chips = (label, rows) => {
        if (!rows.length) return;
        node("p", "planning-subtle", label, box);
        const list = node("ul", "planning-tool-list", undefined, box);
        for (const row of rows.slice(0, 40)) { const chip = node("li", "", row.name, list); chip.dataset.scope = row.scope; chip.title = `${row.scope}${row.source ? ` · ${row.source}` : ""}${row.description ? `\n${row.description}` : ""}`; }
        if (rows.length > 40) node("li", "", `+${rows.length - 40} more`, list);
      };
      const byScope = (rows) => [...(rows || [])].sort((a, b) => ({ project: 0, user: 1, plugin: 2 }[a.scope] ?? 3) - ({ project: 0, user: 1, plugin: 2 }[b.scope] ?? 3) || a.name.localeCompare(b.name));
      chips("Agents", byScope(tooling.agents)); chips("Skills", byScope(tooling.skills)); chips("Commands", byScope(tooling.commands));
      if (!(tooling.agents?.length || tooling.skills?.length || tooling.commands?.length)) node("p", "planning-subtle", "No project or user agents, skills or commands were found (.claude/, .opencode/, ~/.claude, ~/.config/opencode).", box);
    }
  }
  function render() {
    renderList(); $("detail").replaceChildren();
    if (!state.projectId) { node("p", "planning-empty", "Open the desktop app and choose a project to start planning.", $("detail")); controls(); return; }
    const item = plan();
    renderWorkflow(item);
    details(item); if (item) { interviewPanel(item); unknowns(item); questions(item); review(item); specification(item); history(item); }
    existingWork(item);
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
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("planning.work", refreshWork, 30000);
    else if (typeof setInterval === "function") workTimer = setInterval(refreshWork, 30000);
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
      state.plans = result.plans || []; state.existing = result.existing ?? null; render(); if (refreshTasks) void refreshWork();
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
    // A pushed board change repaints an open plan's workflow at once; the poll
    // below is only a backstop for a missed push.
    api()?.onTasks?.((tasks) => {
      if (!state.opened || !Array.isArray(tasks)) return;
      const next = tasks.filter((task) => !task.projectId || task.projectId === state.projectId);
      if (JSON.stringify(next) === JSON.stringify(state.tasks) && !state.workError) return;
      state.tasks = next; state.workError = null; renderWorkflow(plan()); controls();
    });
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
