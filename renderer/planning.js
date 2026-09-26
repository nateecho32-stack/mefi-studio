// Project-local decisions and reviewed task handoffs. Mefi interviews you here
// and organizes what you say. Live drafting is optional, and nothing it writes
// becomes your answer, your decision, or your approval without your action.
(() => {
  "use strict";
  const $ = (name) => document.getElementById(`plans-${name}`);
  const api = () => window.mefiStudio;
  // Tell the Start here walkthrough that a real planning action happened. The
  // guide's own listener ticks the matching stop; failures never announce.
  const announce = (name, detail) => {
    try { if (typeof CustomEvent === "function" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  };
  const state = { projectId: null, projectName: "Your project", plans: [], selected: "new", busy: false, pending: null, tasks: null, workError: null, epoch: 0, opened: false, readId: 0, workReadId: 0, existing: null, existingOpen: false, showArchived: false };
  let initialized = false;
  let workTimer = null;
  let workFlight = null;
  let priorFocus = null;
  let drafts = {};
  let restoreSelection = true;
  const selectionKey = () => `mefiStudio.planning.selection.v1.${state.projectId}`;
  function rememberSelection() {
    if (!state.projectId || restoreSelection) return;
    try { localStorage.setItem(selectionKey(), state.selected); } catch { /* Keep the open plan in memory. */ }
  }
  function restoreProjectPlan() {
    if (!restoreSelection) return;
    let saved;
    try { saved = localStorage.getItem(selectionKey()); } catch {}
    state.selected = saved === "new" || state.plans.some((item) => item.id === saved && !archived(item)) ? saved : state.plans.find((item) => !archived(item))?.id || "new";
    restoreSelection = false;
  }
  let sliceCounter = 0;
  let exploreTimer = null;
  let exploreFlight = null;
  let exploreGeneration = 0;
  let focusedField = "destination";
  let composeKey = null;
  let copilot = { status: "idle", result: null, signature: null, error: "" };
  let suggestionUndo = null;
  let viewedStep = null;
  let viewedStepKey = null;
  let lastWorkflowStep = null;
  const stepAnimations = new WeakMap();
  const fieldTargets = { title: "title", destination: "destination", "out-of-scope": "outOfScope", "question-text": "question", "draft-question": "question", "unknown-text": "unknown", "draft-unknown": "unknown", "spec-text": "specText" };
  const targetLabels = { title: "Plan name", destination: "Outcome", outOfScope: "Outside this plan", question: "Open question", unknown: "Uncertainty", specText: "Specification" };
  const draftFieldId = (target) => ({ title: "title", destination: "destination", outOfScope: "out-of-scope", question: plan() ? "question-text" : "draft-question", unknown: plan() ? "unknown-text" : "draft-unknown", specText: "spec-text" })[target];
  try { const saved = JSON.parse(localStorage.getItem("mefiStudio.planning.drafts.v1") || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) drafts = saved; } catch {}
  const persist = () => { try { localStorage.setItem("mefiStudio.planning.drafts.v1", JSON.stringify(drafts)); } catch { /* Form state stays in memory when storage is unavailable. */ } };
  const draftKey = () => JSON.stringify([state.projectId, state.selected]);
  const draft = () => drafts[draftKey()] ||= {};
  const plan = () => state.plans.find((item) => item.id === state.selected);
  // On the board: its tasks exist, so its view follows their progress.
  // Frozen: read-only, which also covers a plan you archived.
  const onBoard = (item) => ["converted", "converting"].includes(item?.status);
  const archived = (item) => item?.archivedAt != null;
  const frozen = (item) => onBoard(item) || archived(item);
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
  // `answered` is the turn in between: your words are the last thing saved to
  // the plan and Mefi has not replied (its reply failed, or you saved a note
  // yourself). A note and the plan share one save time, so any later change,
  // such as Mefi opening a new question, means the answer was already heard.
  function pendingAsk(item) {
    const open = (item?.questions || []).filter((question) => question.status === "open");
    for (const question of [...open].reverse()) {
      const last = (question.notes || []).at(-1);
      if (last?.author === "assistant" && ["question", "conflict"].includes(last.kind)) return { question, ask: last.text, followUp: true, awaiting: true };
    }
    const answered = open.find((question) => { const last = (question.notes || []).at(-1); return last?.author === "user" && last.at >= item.updatedAt; });
    if (answered) return { question: answered, ask: answered.question, followUp: false, awaiting: false, answered: true };
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
    const wrap = node("div", "planning-field", undefined, parent);
    const head = node("div", "planning-field-head", undefined, wrap);
    const caption = node("label", "planning-field-title", undefined, head); caption.setAttribute("for", `plans-${id}`);
    if (options.step) node("span", "planning-field-number", options.step, caption).setAttribute("aria-hidden", "true");
    node("span", "", label, caption);
    if (options.optional) node("small", "planning-field-optional", "Optional", caption);
    if (options.step && !options.locked && api()?.planningExplore) {
      const refine = button("✦ Refine", head, () => {
        draft().assisted = true; draft().copilotTab = "suggestions"; focusedField = fieldTargets[id]; persist(); void exploreDraft("write");
      }, `refine-${id}`);
      refine.className = "planning-refine"; refine.setAttribute("aria-label", `Help me write: ${label}`);
    }
    const control = node(options.select ? "select" : options.rows ? "textarea" : "input", "", undefined, wrap);
    if (options.select) for (const [key, copy] of options.select) { const option = node("option", "", copy, control); option.value = key; }
    else if (options.rows) control.rows = options.rows;
    else control.type = "text";
    control.id = `plans-${id}`; control.value = value ?? "";
    control.required = Boolean(options.required); control.maxLength = options.maxLength || 20000;
    control.dataset.locked = String(Boolean(options.locked)); control.disabled = state.busy || Boolean(options.locked);
    if (options.placeholder) control.placeholder = options.placeholder;
    control.dataset.planField = "true";
    control.addEventListener(options.select ? "change" : "input", () => { change(control.value); persist(); renderDraftFeedback(); if (fieldTargets[id]) scheduleExploration(); });
    control.addEventListener("focus", () => { if (fieldTargets[id]) { focusedField = fieldTargets[id]; if ($("help-target")) $("help-target").textContent = `Helping with ${targetLabels[focusedField].toLowerCase()}`; } });
    control.addEventListener("keydown", (event) => advanceField(event, control));
    if (!options.locked && (id === "destination" || id === "interview-answer" || id === "spec-text" || id.startsWith("evidence-"))) window.MefiFileInputs?.bind(control, { scope: () => `${state.epoch}:${draftKey()}`, blocked: () => state.busy || !state.opened, limit: control.maxLength });
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
    const item = plan(), local = draft();
    const stage = workflowState(item).current;
    const order = Number.parseInt(title, 10);
    const relevant = !item || (order === 1 && stage === "idea") || (order === 2 && stage === "explore") || (order === 3 && workflowState(item).unknowns > 0) || (order === 4 && stage === "decisions") || (order === 5 && stage === "review") || (order === 6 && ["spec", "approval", "build", "verify"].includes(stage));
    const result = node("details", "planning-section", undefined, $("editor") || $("detail"));
    const step = ({ 1: "idea", 2: "explore", 3: "explore", 4: "decisions", 5: "review", 6: "spec" })[order] || "idea";
    result.dataset.step = step; result.dataset.sectionTitle = title;
    result.open = local.sections?.[title] ?? relevant;
    const heading = node("summary", "planning-section-heading", undefined, result);
    stepIcon(step, heading);
    const copy = node("span", "planning-section-title", undefined, heading);
    node("small", "", order === 3 ? "Explore · Find the gaps" : `${String(flowStages.findIndex(([id]) => id === step) + 1).padStart(2, "0")} · ${stepLooks[step].verb}`, copy);
    node("strong", "", title.replace(/^\d+\.\s*/, ""), copy);
    node("span", "planning-section-chevron", "⌄", heading).setAttribute("aria-hidden", "true");
    heading.addEventListener("click", () => {
      (local.sections ||= {})[title] = !result.open; persist();
      if (!result.open) { selectStep(step); slideStep(result); }
    });
    if (description) node("p", "", description, result); return result;
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
  const stepLooks = {
    idea: { icon: "g-ideas", label: "Idea", verb: "Imagine" },
    explore: { icon: "g-help", label: "Interview", verb: "Discover" },
    decisions: { icon: "g-route", label: "Decisions", verb: "Choose" },
    review: { icon: "g-eyes", label: "Review", verb: "Reflect" },
    spec: { icon: "g-plans", label: "Spec", verb: "Define" },
    approval: { icon: "g-key", label: "Approval", verb: "Approve" },
    build: { icon: "g-wrench", label: "Build", verb: "Create" },
    verify: { icon: "g-tasks", label: "Verify", verb: "Check" },
  };
  function stepIcon(step, parent) {
    const mark = node("span", "planning-step-icon", undefined, parent); mark.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${stepLooks[step].icon}`); svg.append(use); mark.append(svg);
    return mark;
  }
  function slideStep(element, direction = 1, delay = 0) {
    stepAnimations.get(element)?.cancel();
    if (!element?.animate || document.documentElement?.dataset?.motion === "off" || document.body?.classList?.contains?.("no-motion") || document.body?.classList?.contains?.("ws-still") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate([{ opacity: .45, transform: `translateX(${direction * 12}px)` }, { opacity: 1, transform: "translateX(0)" }], { duration: 260, delay, easing: "cubic-bezier(.2,.75,.25,1)" });
    stepAnimations.set(element, animation);
  }
  function selectStep(id) {
    viewedStep = id;
    draft().viewedStep = id; draft().workflowStep = workflowState(plan()).current; persist();
    if ($("workflow")) $("workflow").dataset.viewedStep = id;
    for (const [key] of flowStages) {
      const stage = $(`stage-${key}`); if (!stage) continue;
      stage.dataset.selected = String(key === id); stage.setAttribute("aria-pressed", String(key === id));
    }
  }
  function advanceField(event, control) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat || control.disabled) return;
    if (!["input", "textarea"].includes(control.tagName.toLowerCase())) return;
    let scope = control.parentElement;
    while (scope && scope.tagName.toLowerCase() !== "form") scope = scope.parentElement;
    if (!scope) return;
    const visible = (element) => {
      for (let parent = element; parent && parent !== scope; parent = parent.parentElement) if (parent.hidden || (parent.tagName.toLowerCase() === "details" && !parent.open)) return false;
      return !element.disabled && (element.dataset.planField === "true" || element.type === "submit");
    };
    const fields = [...scope.querySelectorAll("input, textarea, select, button")].filter(visible);
    const next = fields[fields.indexOf(control) + 1];
    event.preventDefault(); event.stopPropagation();
    if (!next) return;
    const wrap = control.parentElement;
    wrap.dataset.departing = "true";
    if (typeof setTimeout === "function") setTimeout(() => { delete wrap.dataset.departing; }, 460);
    next.focus?.({ preventScroll: true }); next.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }
  function stopExploration() {
    if (exploreTimer !== null) { clearTimeout(exploreTimer); exploreTimer = null; }
    exploreGeneration += 1;
  }
  function composeSnapshot() {
    const local = draft(), item = plan();
    return { title: local.details?.title ?? item?.title ?? "", destination: local.details?.destination ?? item?.destination ?? "", outOfScope: local.details?.outOfScope ?? item?.outOfScope ?? "", question: local.question?.question || "", unknown: local.unknown || "", specText: local.spec?.text ?? item?.spec?.text ?? "" };
  }
  const composeSignature = () => JSON.stringify([draftKey(), plan()?.version, composeSnapshot()]);
  function scheduleExploration() {
    stopExploration();
    copilot.status = "idle"; copilot.error = "";
    if (draft().assisted === false || !api()?.planningExplore || frozen(plan())) { renderCopilot(); return; }
    const snapshot = composeSnapshot();
    if (`${snapshot.title} ${snapshot.destination}`.trim().length < 12) { renderCopilot(); return; }
    copilot.status = "waiting"; renderCopilot();
    if (typeof setTimeout === "function") exploreTimer = setTimeout(() => { exploreTimer = null; void exploreDraft(); }, 1500);
  }
  async function exploreDraft(intent = "suggest") {
    if (!state.opened || document.hidden || !state.projectId || state.busy || frozen(plan()) || draft().assisted === false || !api()?.planningExplore) return;
    if (exploreFlight) { copilot.status = "waiting"; renderCopilot(); return; }
    const snapshot = composeSnapshot();
    if (`${snapshot.title} ${snapshot.destination}`.trim().length < 12) { copilot.error = "Describe a little more of your idea first."; renderCopilot(); return; }
    stopExploration();
    const generation = exploreGeneration, key = draftKey(), signature = composeSignature(), epoch = state.epoch, item = plan();
    const current = () => state.opened && !document.hidden && generation === exploreGeneration && key === draftKey() && epoch === state.epoch && signature === composeSignature() && draft().assisted !== false;
    const flight = {}; exploreFlight = flight;
    copilot.status = "exploring"; copilot.error = ""; renderCopilot();
    try {
      const result = await api().planningExplore({ projectId: state.projectId, ...(item ? { planId: item.id, version: item.version } : {}), draft: snapshot, focus: focusedField, intent });
      if (!current()) return;
      if (result?.projectId !== state.projectId) throw new Error("The project changed. Explore this plan again.");
      copilot = { status: result.ok ? "ready" : "error", result, signature, error: result.ok ? "" : result.error || "AI help is unavailable. Keep writing or try again." };
    } catch (error) { if (current()) { copilot.status = "error"; copilot.error = error.message; } }
    finally {
      if (exploreFlight === flight) exploreFlight = null;
      if (state.opened) {
        renderCopilot();
        // One in-flight request; edits during it coalesce into the latest draft.
        if (copilot.status === "waiting" && draft().assisted !== false && !document.hidden && !state.busy) scheduleExploration();
      }
    }
  }
  function setDraftText(target, text) {
    const local = draft(), values = composeSnapshot();
    if (["title", "destination", "outOfScope"].includes(target)) { local.details ||= { title: values.title, destination: values.destination, outOfScope: values.outOfScope }; local.details[target] = text; local.detailsDirty = true; }
    else if (target === "question") { local.question ||= { question: "", type: "discussion", dependsOn: [] }; local.question.question = text; }
    else if (target === "unknown") local.unknown = text;
    else { local.spec ||= { text: "", tasks: [] }; local.spec.text = text; local.specDirty = true; }
  }
  const draftFeedbackSignature = () => JSON.stringify([composeSignature(), draft().spec?.tasks]);
  function renderDraftFeedback() {
    const area = $("draft-feedback"); if (!area) return;
    area.replaceChildren();
    const available = suggestionUndo && !frozen(plan()) && suggestionUndo.signature === draftFeedbackSignature();
    area.hidden = !available; if (!available) return;
    node("span", "", `${targetLabels[suggestionUndo.target]} updated with your chosen wording.`, area);
    button("Undo", area, () => {
      if (!suggestionUndo || suggestionUndo.signature !== draftFeedbackSignature() || state.busy) return;
      const prior = suggestionUndo; suggestionUndo = null;
      setDraftText(prior.target, prior.before);
      if (["title", "destination", "outOfScope"].includes(prior.target)) draft().detailsDirty = prior.detailsDirty;
      else if (prior.target === "specText") draft().specDirty = prior.specDirty;
      persist(); render(); navigateTo(draftFieldId(prior.target)); holdHandoff(); scheduleExploration();
    }, "undo-wording");
  }
  function useSuggestion(suggestion, append = false) {
    if (state.busy || frozen(plan()) || copilot.signature !== composeSignature()) return;
    const local = draft(), values = composeSnapshot();
    if (!suggestion.text.trim()) return;
    const text = append && values[suggestion.target] ? `${values[suggestion.target]}\n\n${suggestion.text}` : suggestion.text;
    const max = { title: 180, destination: 16000, outOfScope: 12000, question: 4000, unknown: 4000, specText: 60000 }[suggestion.target];
    if (text.length > max) { copilot.error = "This addition exceeds the field's length limit. Shorten the suggestion first."; renderCopilot(); return; }
    suggestionUndo = { target: suggestion.target, before: values[suggestion.target], detailsDirty: local.detailsDirty, specDirty: local.specDirty };
    setDraftText(suggestion.target, text); suggestionUndo.signature = draftFeedbackSignature();
    persist(); render();
    navigateTo(draftFieldId(suggestion.target)); holdHandoff(); scheduleExploration();
    note();
  }
  function renderCopilot() {
    const area = $("copilot"); if (!area || !state.projectId) return;
    const oldScroll = $("copilot-body")?.scrollTop || 0;
    const oldFocus = area.contains?.(document.activeElement) ? document.activeElement?.id : null;
    area.replaceChildren();
    const chrome = node("div", "planning-copilot-chrome", undefined, area);
    const finish = () => {
      if ($("copilot-body")) $("copilot-body").scrollTop = oldScroll;
      const control = oldFocus && document.getElementById(oldFocus);
      if (control && !control.hidden && !control.disabled) control.focus?.({ preventScroll: true });
    };
    const assisted = draft().assisted !== false, locked = frozen(plan());
    for (const id of ["title", "destination", "out-of-scope"]) if ($(`refine-${id}`)) {
      $(`refine-${id}`).dataset.locked = String(locked || Boolean(exploreFlight));
      $(`refine-${id}`).disabled = state.busy || locked || Boolean(exploreFlight);
    }
    const head = node("div", "planning-copilot-head", undefined, chrome);
    node("span", "planning-copilot-mark", "✦", head).setAttribute("aria-hidden", "true");
    const title = node("div", "", undefined, head); node("h3", "", "Your planning partner", title); node("p", "planning-subtle", "A little help from Mefi", title);
    const modes = node("div", "planning-compose-modes", undefined, chrome); modes.setAttribute("aria-label", "Writing mode");
    for (const [value, label] of [[true, "Write with Mefi"], [false, "Write manually"]]) {
      const control = button(label, modes, () => { draft().assisted = value; persist(); stopExploration(); copilot.status = "idle"; copilot.error = ""; renderCopilot(); if (value) scheduleExploration(); }, value ? "mode-assisted" : "mode-manual", false, locked);
      control.setAttribute("aria-pressed", String(assisted === value));
    }
    const status = node("p", "planning-copilot-status", undefined, chrome); status.id = "plans-copilot-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    status.dataset.active = String(assisted && copilot.status === "exploring");
    status.dataset.error = String(Boolean(copilot.error));
    status.textContent = locked ? archived(plan()) ? "This plan is archived. Restore it to keep planning." : "This plan is on the task board." : !assisted ? "Your words, your pace. Mefi is paused." : !api()?.planningExplore ? "AI help is available in the desktop app." : copilot.error || ({ idle: "Write a little. Mefi will follow along.", waiting: "Following your draft…", exploring: "Reading files and connecting the details…", ready: `${copilot.result?.suggestions?.length || 0} suggestions ready to explore.` }[copilot.status] || "Keep writing, or try exploring again.");
    const result = copilot.result;
    const showSuggestions = assisted && !locked && draft().copilotTab === "suggestions";
    if (assisted && !locked) {
      const actions = node("div", "planning-actions planning-copilot-actions", undefined, chrome);
      const unavailable = !api()?.planningExplore || copilot.status === "exploring" || copilot.status === "waiting" && Boolean(exploreFlight);
      button("Help me write", actions, () => { draft().copilotTab = "suggestions"; persist(); void exploreDraft("write"); }, "help-write", true, unavailable);
      button("↻ Explore", actions, () => exploreDraft(), "explore-now", false, unavailable).title = "Refresh the file exploration and suggestions";
      node("p", "planning-copilot-foot", `Helping with ${(targetLabels[focusedField] || "Outcome").toLowerCase()}`, chrome).id = "plans-help-target";
      const tabs = node("div", "planning-copilot-tabs", undefined, chrome); tabs.setAttribute("aria-label", "Planning partner views");
      for (const [tab, label] of [["explore", "Explore files"], ["suggestions", `Suggestions${result?.suggestions?.length ? ` · ${result.suggestions.length}` : ""}`]]) {
        const control = navigation(label, tabs, () => { draft().copilotTab = tab; persist(); renderCopilot(); $(`copilot-tab-${tab}`)?.focus(); }, `copilot-tab-${tab}`);
        control.setAttribute("aria-pressed", String(tab === (showSuggestions ? "suggestions" : "explore")));
      }
    }
    const body = node("div", "planning-copilot-body", undefined, area); body.id = "plans-copilot-body";
    const tree = node("div", "planning-explore-tree", undefined, body); tree.id = "plans-explore-tree"; tree.setAttribute("aria-label", "Plan exploration tree");
    tree.hidden = showSuggestions;
    const root = node("div", "planning-tree-root", undefined, tree); node("span", "planning-tree-dot", "", root); node("strong", "", composeSnapshot().title || "Your idea", root);
    const branches = node("ul", "planning-tree-branches", undefined, tree);
    const branch = (label, detail) => { const row = node("li", "planning-tree-branch", undefined, branches); node("strong", "", label, row); if (detail) node("p", "planning-subtle", detail, row); return row; };
    branch("The outcome", composeSnapshot().destination || "Describe what you want to make possible.");
    const references = copilot.result?.references;
    const stale = copilot.signature !== composeSignature();
    const files = branch("Project files", references ? `${references.code?.length || 0} matching excerpts · ${references.scanned || 0} files scanned${stale ? " · earlier draft" : ""}` : "Relevant file excerpts will appear here.");
    for (const hit of references?.code || []) {
      const entry = node("details", "planning-file-node", undefined, files);
      const local = draft(); entry.open = local.fileOpen?.[hit.file] === true;
      entry.addEventListener("toggle", () => { (local.fileOpen ||= {})[hit.file] = entry.open; persist(); });
      node("summary", "", `${hit.file}:${hit.line}`, entry);
      node("pre", "", hit.snippet, entry);
    }
    if (references?.overview?.length) {
      const overview = branch("Project overview", references.structure?.join(" · "));
      for (const hit of references.overview) { const entry = node("details", "planning-file-node", undefined, overview); node("summary", "", `${hit.file}:${hit.line}`, entry); node("pre", "", hit.snippet, entry); }
    }
    if (references?.limitations?.length) { const limits = node("details", "planning-scan-limits", undefined, files); node("summary", "", "Scan coverage", limits); for (const line of references.limitations) node("p", "planning-subtle", line, limits); }
    const item = plan();
    const decisions = branch("Decisions to shape", item ? `${item.questions.length} questions · ${item.questions.filter((question) => question.status === "resolved").length} decided` : "Questions appear here as the idea takes shape.");
    for (const question of (item?.questions || []).slice(0, 6)) {
      const jump = navigation(`${question.status === "resolved" ? "✓" : "○"} ${question.question}`, decisions, () => navigateTo(`resolution-${question.id}`, `question-card-${question.id}`), null, "planning-decision-node");
      jump.dataset.resolved = String(question.status === "resolved");
    }
    if (!assisted || locked) { finish(); return; }
    const proposals = node("div", "", undefined, body); proposals.id = "plans-suggestions-view"; proposals.hidden = !showSuggestions;
    if (result?.summary) node("p", "planning-explore-summary", result.summary, proposals);
    if (result?.suggestions?.length) {
      const suggestions = node("section", "planning-suggestions", undefined, proposals); node("h4", "", "Ideas to build on", suggestions);
      if (stale) node("p", "planning-subtle", "Your draft changed. Refresh the suggestions before using them.", suggestions);
      for (const suggestion of result.suggestions) {
        if (suggestion.target === "specText" && !item) continue;
        const card = node("article", "planning-suggestion", undefined, suggestions);
        const heading = node("div", "planning-suggestion-head", undefined, card);
        node("span", "planning-suggestion-target", targetLabels[suggestion.target], heading);
        const dismiss = button("×", heading, () => { result.suggestions = result.suggestions.filter((entry) => entry !== suggestion); renderCopilot(); }, `dismiss-${suggestion.id}`);
        dismiss.className = "planning-suggestion-dismiss"; dismiss.setAttribute("aria-label", `Dismiss suggestion: ${suggestion.label}`); dismiss.title = "Dismiss suggestion";
        node("h4", "", suggestion.label, card);
        const preview = node("p", "planning-suggestion-copy", suggestion.text, card); preview.hidden = Boolean(suggestion.editing);
        const text = node("textarea", "", undefined, card); text.id = `plans-suggestion-editor-${suggestion.id}`; text.value = suggestion.text; text.rows = 4; text.hidden = !suggestion.editing; text.disabled = state.busy || stale; text.dataset.locked = String(stale); text.setAttribute("aria-label", `Edit suggestion: ${suggestion.label}`);
        text.addEventListener("input", () => { suggestion.text = text.value; preview.textContent = text.value; for (const id of [`use-${suggestion.id}`, `append-${suggestion.id}`]) if ($(id)) { $(id).disabled = !text.value.trim() || state.busy || stale; $(id).dataset.locked = String(!text.value.trim() || stale); } });
        if (suggestion.reason) node("p", "planning-subtle", suggestion.reason, card);
        for (const file of suggestion.files || []) node("code", "planning-suggestion-source", file, card);
        const actions = node("div", "planning-actions", undefined, card);
        const hasText = Boolean(composeSnapshot()[suggestion.target]);
        button(hasText ? "Replace field" : "Use wording", actions, () => useSuggestion(suggestion), `use-${suggestion.id}`, true, stale || !suggestion.text.trim());
        if (hasText && suggestion.target !== "title") button("Add to field", actions, () => useSuggestion(suggestion, true), `append-${suggestion.id}`, false, stale || !suggestion.text.trim());
        const edit = button(suggestion.editing ? "Done editing" : "Edit", actions, () => { suggestion.editing = !suggestion.editing; renderCopilot(); (suggestion.editing ? $(`suggestion-editor-${suggestion.id}`) : $(`edit-${suggestion.id}`))?.focus(); }, `edit-${suggestion.id}`, false, stale);
        edit.setAttribute("aria-expanded", String(Boolean(suggestion.editing))); edit.setAttribute("aria-controls", text.id);
      }
    } else node("p", "planning-subtle", result?.ok ? "No additions suggested for now. Keep shaping the idea." : "Mefi's suggestions will appear here after you describe the idea. You can keep writing while it explores.", proposals);
    finish();
  }
  function navigateTo(...ids) {
    const target = ids.map($).find((element) => element && !element.disabled);
    if (!target) return;
    let section;
    for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName?.toLowerCase() === "details") ancestor.open = true;
      if (ancestor.dataset?.sectionTitle) { section = ancestor; (draft().sections ||= {})[ancestor.dataset.sectionTitle] = true; }
    }
    if (section) {
      const previous = flowStages.findIndex(([id]) => id === viewedStep), next = flowStages.findIndex(([id]) => id === section.dataset.step);
      selectStep(section.dataset.step); persist(); slideStep(section, next < previous ? -1 : 1);
    } else slideStep(target);
    section?.scrollIntoView?.({ block: "start", behavior: "auto" });
    target.scrollIntoView?.({ block: "nearest", behavior: "auto" }); target.focus?.({ preventScroll: true });
    return target;
  }
  function navigation(label, parent, run, id, className = "") {
    const result = node("button", className, label, parent); result.type = "button";
    if (id) result.id = `plans-${id}`; result.dataset.navigate = "true"; result.addEventListener("click", run); return result;
  }
  function taskProgress(task, tasks) {
    // Once the board has been read, a linked task it does not hold was deleted.
    if (!task) return state.tasks ? { stage: "missing", label: "No longer on the board" } : { stage: "unknown", label: "Waiting for board status" };
    const label = (stage, fallback) => window.MefiStage?.label?.(stage, task) ?? fallback;
    // The owner's "won't do" (backlog.cjs droppedTask): archived unfinished,
    // never a completion, so it neither reads as done nor confirms the plan.
    if (task.status === "archived" && task.dropped && typeof task.dropped === "object" && !task.doneAt && task.verification?.state !== "verified" && !task.completionFromTaskId) return { stage: "dropped", label: "Dropped by you" };
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
    const work = onBoard(item) ? executionRows(item) : [];
    const complete = work.length > 0 && work.every((task) => task.stage === "done");
    let current = !item ? "idea" : onBoard(item) ? (complete || work.some((task) => task.stage === "review") ? "verify" : "build")
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
    const entering = !area;
    if (!area) { area = node("section", "planning-workflow", undefined, $("detail")); area.id = "plans-workflow"; area.setAttribute("aria-label", "From idea to verified work"); }
    area.replaceChildren();
    const flow = workflowState(item); area.dataset.stage = flow.current;
    if (viewedStepKey !== draftKey()) viewedStep = draft().workflowStep === flow.current && flowStages.some(([id]) => id === draft().viewedStep) ? draft().viewedStep : flow.current;
    else if (lastWorkflowStep !== flow.current) viewedStep = flow.current;
    viewedStepKey = draftKey(); lastWorkflowStep = flow.current; area.dataset.viewedStep = viewedStep;
    const head = node("div", "planning-flow-head", undefined, area);
    const heading = node("div", "", undefined, head);
    node("span", "planning-flow-kicker", `Step ${flowStages.findIndex(([key]) => key === flow.current) + 1} of ${flowStages.length} · ${flowStages.find(([key]) => key === flow.current)?.[1] || "Planning"}`, heading);
    node("h3", "", composeSnapshot().title || "New plan", heading).id = "plans-draft-title";
    const badge = node("span", "planning-flow-badge", archived(item) ? "Archived" : flow.complete ? "Work confirmed" : item?.status === "converting" ? "Finish task creation" : item?.status === "converted" ? "On the task board" : item ? "Planning" : "Draft", head);
    badge.dataset.state = flow.complete ? "complete" : "waiting";
    // Set a plan aside without deleting it; a plan still creating its tasks
    // has to finish first. Restoring brings it back exactly as it was.
    if (item && item.status !== "converting") {
      const shelf = archived(item)
        ? button("Restore plan", head, () => act("restore", {}, null, "Plan restored. It is back in your list."), "restore", true)
        : button("Archive plan", head, () => act("archive", {}, null, "Plan archived. Find it under Archived in the list; restoring brings it back as it was."), "archive");
      shelf.classList.add("mini");
    }
    if (item && !archived(item)) navigation("Continue where you left off", head, () => $(`stage-${viewedStep}`)?.click?.(), "resume");
    const rail = node("ol", "planning-flow-rail", undefined, area); rail.setAttribute("aria-label", "Planning and work stages");
    const decided = `${flow.resolved.length}/${flow.questions.length} recorded`;
    const subtitles = { idea: item ? "Destination saved" : "Set a destination", explore: flow.ask?.awaiting ? "Waiting for your answer" : `${flow.frontier.length} ready · ${flow.blocked.length} blocked`, decisions: decided, review: confirmed(item) ? "Confirmed by you" : "Review decisions", spec: item?.spec?.stale ? "Needs revision" : item?.spec ? "Draft saved" : "Draft specification", approval: item?.spec?.approvedAt ? "Approved by you" : "Review specification", build: frozen(item) ? `${flow.work.filter((task) => task.stage === "running").length} working · ${countLabel(item.taskIds?.length || 0, "task")}` : "Create tasks", verify: frozen(item) ? `${flow.work.filter((task) => task.stage === "done").length}/${flow.work.length} confirmed` : "Check the result" };
    for (const [index, [id, label]] of flowStages.entries()) {
      const row = node("li", "", undefined, rail); row.dataset.step = id;
      const jump = () => {
        if (id === "idea") navigateTo("title", "destination-section");
        else if (id === "explore") navigateTo("interview-answer", "interview-start", "interview-section", "destination-section");
        else if (id === "decisions") { const question = flow.frontier[0] || flow.questions[0]; navigateTo(question ? `resolution-${question.id}` : "questions-section", question ? `question-card-${question.id}` : "destination-section"); }
        else if (id === "review") navigateTo("confirm-understanding", "review-section", "destination-section");
        else if (id === "spec") navigateTo("spec-text", "specification-section", "destination-section");
        else if (id === "approval") navigateTo("approval-section", "destination-section");
        else navigateTo("execution", "approval-section", "destination-section");
        selectStep(item ? id : "idea");
      };
      const stage = navigation("", row, jump, `stage-${id}`, "planning-flow-stage");
      stage.dataset.state = flow.completed.has(id) && id !== flow.current ? "complete" : id === flow.current ? "current" : "waiting";
      stage.dataset.step = id; stage.dataset.selected = String(id === viewedStep);
      stage.setAttribute("aria-pressed", String(id === viewedStep)); stage.title = `${label} · ${subtitles[id]}`;
      stage.setAttribute("aria-label", `${label}: ${subtitles[id]}`);
      if (id === flow.current) stage.setAttribute("aria-current", "step");
      stepIcon(id, stage);
      const copy = node("span", "planning-stage-copy", undefined, stage);
      node("span", "planning-stage-number", stage.dataset.state === "complete" ? "✓ Complete" : `${String(index + 1).padStart(2, "0")} · ${stepLooks[id].verb}`, copy);
      node("strong", "", stepLooks[id].label, copy); node("small", "planning-stage-detail", subtitles[id], stage);
      if (entering) slideStep(stage, 1, index * 22);
    }
    const status = node("div", "planning-flow-status", undefined, area); status.id = "plans-flow-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    status.dataset.active = String(Boolean(state.pending?.assist));
    status.setAttribute("aria-busy", String(Boolean(state.pending?.assist)));
    node("span", "planning-flow-dot", "", status).setAttribute("aria-hidden", "true");
    const next = { idea: "Start with the outcome. Build work begins after your approval.", explore: flow.ask?.awaiting ? "Mefi is waiting for your answer. Reply in your own words; it reads your answer back before moving on." : flow.unknowns ? `${flow.unknowns} unknown${flow.unknowns === 1 ? " needs" : "s need"} a question or a reason to set aside.` : "Let Mefi ask you the next question, or add one yourself.", decisions: "Read the interview back, then record your own decisions.", review: "Read what this plan now says the feature is. Nothing is drafted until you confirm it.", spec: "The decisions are settled. Draft the specification and its small implementation tasks.", approval: "Review the saved specification, task briefs, and acceptance checks before approving.", build: item?.status === "converted" ? "Tasks follow the current queue and Pause settings. Their board status is shown below." : item?.status === "converting" ? "Finish creating the approved tasks. Existing tasks will be reused." : "Your specification is approved. Create its tasks when you are ready.", verify: flow.complete ? "Every linked task has verified evidence or your recorded confirmation." : "A worker result is ready for verification. Open the task to inspect its evidence." };
    const pendingQuestion = flow.questions.find((question) => question.id === state.pending?.questionId);
    node("span", "", state.pending?.assist ? state.pending.kind === "spec" ? "Mefi is drafting the specification from your saved decisions…" : state.pending.kind === "interview" ? "Mefi is reading your answer and working out what to ask next…" : state.pending.kind === "question" ? `Mefi is exploring: ${pendingQuestion?.question || "the selected question"}` : "Mefi is looking for questions in your saved destination…" : archived(item) ? "This plan is archived. Restore it to pick up where you left off." : next[flow.current], status);
    if (item && !frozen(item)) renderQuestionMap(area, item, flow);
    if (onBoard(item)) renderExecution(area, item, flow.work);
  }
  function renderQuestionMap(area, item, flow) {
    const map = node("details", "planning-question-map", undefined, area); map.id = "plans-question-map";
    map.open = draft().mapOpen === true;
    map.addEventListener("toggle", () => { draft().mapOpen = map.open; persist(); });
    const title = node("summary", "planning-map-head", undefined, map); node("h4", "", "Questions and dependencies", title);
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
    if ([...$("detail").querySelectorAll("textarea")].some((input) => window.MefiFileInputs?.isReading(input))) { note("Wait for the files to finish reading."); return false; }
    const epoch = state.epoch; const projectId = state.projectId; const selected = state.selected;
    const current = plan(); const savedDraft = draft(); const key = draftKey();
    const request = { projectId, ...(current ? { planId: current.id, version: current.version } : {}), ...payload, ...(assist ? {} : { action }) };
    stopExploration(); copilot.status = "idle";
    state.busy = true; state.pending = { assist, kind: payload.kind || action, questionId: payload.questionId }; persist(); renderWorkflow(current); renderCopilot(); controls(); note(assist ? "Mefi is thinking through the saved plan…" : "Saving your plan…");
    let answerSaved = false;
    try {
      const reply = await (assist ? api().planningAssist(request) : api().planningAction(request));
      // The host filed your words before Mefi's reply failed. Clear the box
      // they came from, so a retry asks Mefi to continue instead of sending
      // the same answer again.
      if (reply?.ok === false && reply.answerSaved && epoch === state.epoch && projectId === state.projectId) { answerSaved = true; if (clean) clean(savedDraft); persist(); }
      const result = guard(reply);
      if (epoch !== state.epoch || projectId !== state.projectId || selected !== state.selected) return false;
      accept(result); if (clean) clean(savedDraft); if (action === "create") { drafts[draftKey()] = savedDraft; delete drafts[key]; } persist();
      render(); note(result.note || success);
      if (action === "create") announce("mefi:plan-created", { planId: result.plan?.id || current?.id || null, projectId });
      if (action === "convert") announce("mefi:task-created", { planId: current?.id || null, projectId });
      if (action === "convert") window.MefiWorkspace?.refresh?.(true);
      return true;
    } catch (error) {
      if (epoch === state.epoch && projectId === state.projectId) {
        // A stale-version error needs a fresh saved plan, while keeping every
        // local field. Retrying then uses the latest version, never a blind save.
        try { const fresh = guard(await api().planningList({ projectId })); if (epoch === state.epoch && projectId === state.projectId && (!fresh.projectId || fresh.projectId === projectId)) { state.plans = fresh.plans || []; render(); } } catch {}
        if (epoch === state.epoch) note(answerSaved ? `${error.message} Your answer is saved; choose Continue with Mefi to try again.` : `${error.message} Your entered text is kept.`, true);
      }
      return false;
    } finally { if (epoch === state.epoch) { state.busy = false; state.pending = null; renderWorkflow(plan()); renderCopilot(); controls(); if (onBoard(plan())) void refreshWork(); } }
  }
  function renderList() {
    $("project").textContent = state.projectName; $("list").replaceChildren();
    // Archived plans fold under one toggle; a selected one stays visible.
    const shelved = state.plans.filter(archived);
    const showShelf = state.showArchived || archived(plan());
    const rows = [...state.plans.filter((item) => !archived(item)), ...(showShelf ? shelved : [])];
    for (const [index, item] of rows.entries()) {
      if (archived(item) && !archived(rows[index - 1])) node("p", "planning-subtle planning-list-divider", "Archived", $("list"));
      const row = button("", $("list"), () => { if (state.busy) return; window.MefiNav?.note?.("plans", { planId: item.id }); state.selected = item.id; state.workReadId += 1; render(); note(); void refreshWork(); }, null);
      row.dataset.planId = item.id; row.setAttribute("aria-pressed", String(item.id === state.selected));
      node("strong", "", item.title, row);
      const open = (item.questions || []).filter((question) => question.status !== "resolved").length;
      const taskCount = item.taskIds?.length || 0;
      if (archived(item)) row.dataset.archived = "true";
      node("small", "", archived(item) ? `Archived${item.status === "converted" ? ` · ${countLabel(item.taskIds?.length || 0, "task")} created` : ""}` : item.status === "converted" ? `${countLabel(taskCount, "task")} created` : item.status === "converting" ? "Task creation needs finishing" : item.spec?.approvedAt ? "Approved · ready for tasks" : `${countLabel(open, "open question")} · ${countLabel(item.unknowns?.length || 0, "unknown")}`, row);
    }
    if (shelved.length && !archived(plan())) {
      const toggle = navigation(state.showArchived ? `Hide archived · ${shelved.length}` : `Show archived · ${shelved.length}`, $("list"), () => { state.showArchived = !state.showArchived; renderList(); controls(); }, "archived-toggle", "ghost mini");
      toggle.setAttribute("aria-expanded", String(state.showArchived));
    }
    if (!state.plans.length) {
      const empty = node("div", "planning-library-empty", undefined, $("list"));
      node("span", "", "◇", empty).setAttribute("aria-hidden", "true");
      node("strong", "", "Room for your ideas", empty);
      node("p", "planning-subtle", state.projectId ? "Your saved plans will live here, with this project." : "Choose a project to start a plan.", empty);
    }
  }
  function details(item) {
    // "New plan" already heads the workflow card above; the section names its part.
    const area = section("1. The destination", "Describe the intended outcome and what is outside the scope.");
    area.id = "plans-destination-section"; area.tabIndex = -1;
    const local = draft();
    if (item && (!local.detailsDirty || frozen(item))) { local.details = { title: item.title, destination: item.destination, outOfScope: item.outOfScope }; delete local.detailsDirty; }
    const values = local.details ||= { title: item?.title || "", destination: item?.destination || "", outOfScope: item?.outOfScope || "" };
    const locked = frozen(item);
    const edit = form(area, "details-form", () => act(item ? "update" : "create", { ...values }, (saved) => { delete saved.details; delete saved.detailsDirty; }, item ? "Destination saved. Changed scope reopens earlier decisions for review." : "Plan created. Add questions or start the interview."), "Plan destination", locked);
    const changed = (key, value) => { values[key] = value; local.detailsDirty = true; if (key === "title" && $("draft-title")) $("draft-title").textContent = value || "New plan"; if (item) holdHandoff(); };
    field(edit, "Plan name", "title", values.title, (value) => changed("title", value), { step: "01", required: true, maxLength: 180, locked, placeholder: "Improve first-time setup" });
    field(edit, "What should be true when this is finished?", "destination", values.destination, (value) => changed("destination", value), { step: "02", required: true, rows: 3, locked, maxLength: 16000, placeholder: "Who is this for? What can they do or understand afterward?" });
    field(edit, "Outside this plan", "out-of-scope", values.outOfScope, (value) => changed("outOfScope", value), { step: "03", optional: true, rows: 2, locked, maxLength: 12000, placeholder: "Things we are choosing to leave for later" });
    if (!item && local.question?.question) field(edit, "A question to carry forward", "draft-question", local.question.question, (value) => { local.question.question = value; }, { rows: 2, maxLength: 4000 });
    if (!item && local.unknown) field(edit, "An uncertainty to carry forward", "draft-unknown", local.unknown, (value) => { local.unknown = value; }, { rows: 2, maxLength: 4000 });
    if (!locked) {
      const actions = node("div", "planning-destination-actions", undefined, edit);
      node("span", "planning-key-hint", "Enter → next field · Shift+Enter → new line", actions);
      submit(actions, item ? "Save destination" : "Create plan", "save-details");
    }
  }
  function unknowns(item) {
    const area = section("3. Unknowns", "Turn each uncertainty into a question, or explain why it no longer needs an answer.");
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
    if (frozen(item)) { node("p", "planning-subtle", archived(item) && !onBoard(item) ? "This plan is archived. Its interview stays below as a record; restore the plan to continue it." : "This plan is on the task board. Its interview stays below as a record.", area); return; }
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
    node("span", "planning-pill", ask.followUp ? `Follow-up on Q${index}` : ask.answered ? `Q${index} · Your answer is saved` : `Q${index} · ${typeChoices.find(([type]) => type === ask.question.type)?.[1] || ask.question.type}`, card).dataset.state = "ready";
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
    // Your answer is on the record but Mefi has not replied: ask it to read
    // what you said and carry on, without sending the words a second time.
    if (ask.answered) button("Continue with Mefi", actions, async () => {
      if (await act("interview", { kind: "interview", questionId: ask.question.id, useWeb: values.useWeb }, null, "Mefi read your answer back. Check what it understood, then answer the next question.", true)) navigateTo("interview-answer", "interview-start");
    }, "interview-continue", true, pending);
    button(ask.answered ? "Add to my answer" : "Send answer", actions, async () => {
      if (!values.message.trim()) { note("Type your answer first, or ask Mefi to explain the tradeoffs.", true); navigateTo("interview-answer"); return; }
      if (await act("interview", { kind: "interview", questionId: ask.question.id, message: values.message, useWeb: values.useWeb }, clean, "Mefi read your answer back. Check what it understood, then answer the next question.", true)) navigateTo("interview-answer", "interview-start");
    }, "interview-send", !ask.answered, pending);
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
    if (!locked && (!settled(item) || !confirmed(item))) node("p", "planning-subtle", settled(item) ? "Draft here as you think. Confirm what we understand before asking Mefi for a specification or approving tasks." : "Draft here as you think. Settle all unknowns and questions, then confirm what you understand, before drafting or approving.", area);
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
    approve.dataset.step = item.spec?.approvedAt ? "build" : "approval";
    const heading = node("div", "planning-handoff-heading", undefined, approve);
    stepIcon(approve.dataset.step, heading); node("strong", "", item.spec?.approvedAt ? "Ready to build" : "Your approval", heading);
    if (item.status === "converted") {
      const count = item.taskIds?.length || 0;
      node("p", "", `${count} ${count === 1 ? "task was" : "tasks were"} added to this project's queue. Open one to follow its progress.`, approve);
      const actions = node("div", "planning-actions", undefined, approve);
      for (const [index, id] of (item.taskIds || []).entries()) button(item.spec?.tasks?.[index]?.title || `Open task ${index + 1}`, actions, () => window.MefiNav?.go?.("tasks", { taskId: id }));
    } else if (archived(item)) {
      node("p", "", "This plan is archived. Restore it to review, approve or create its tasks.", approve);
    } else if (item.status === "converting") {
      node("p", "", "Task creation started. Finish adding the approved tasks to the queue. Existing tasks will be reused.", approve);
      button("Finish creating tasks", approve, () => act("convert", {}, null, "Approved tasks are in your project's queue."), "convert", true);
    } else {
      node("p", "", unsavedPlan(item) ? "Save your destination, unknown, or question changes before drafting or approving the specification." : !confirmed(item) ? "Confirm what we understand in Your review first. Approval builds on the reading you confirmed, not on Mefi's suggestions." : item.spec?.stale ? "Earlier decisions changed. Review and save a fresh specification before approving it." : item.spec?.approvedAt && !local.specDirty ? "You've approved this specification. Creating tasks adds them to the current queue; they can begin when scheduling is on and their prerequisites are complete." : "Your approval confirms the saved specification and every task brief. Approval alone keeps the work here until you choose to create the tasks.", approve);
      const actions = node("div", "planning-actions", undefined, approve);
      button(item.spec?.approvedAt ? "Specification approved" : "Approve specification", actions, () => act("approve-spec", {}, null, "Specification approved. You can now create the tasks."), "approve", false, !item.spec || !settled(item) || !confirmed(item) || Boolean(local.specDirty) || Boolean(item.spec?.approvedAt) || item.spec?.stale || unsavedPlan(item));
      const count = item.spec?.tasks?.length || 0;
      button(`Create ${count} ${count === 1 ? "task" : "tasks"}`, actions, () => act("convert", {}, null, "Approved tasks are in your project's queue."), "convert", true, !item.spec?.approvedAt || Boolean(local.specDirty) || !count || unsavedPlan(item));
    }
  }
  function history(item) {
    if (!item.history?.length) return;
    const local = draft(); const area = node("details", "planning-card", undefined, $("editor") || $("detail")); area.id = "plans-history";
    node("summary", "", `Plan history · ${countLabel(item.history.length, "saved revision")}`, area);
    node("p", "planning-subtle", "Earlier decisions and specifications remain available here after you change the plan. Copy any text you want to use in a new revision.", area);
    const labels = { create: "Plan created", update: "Destination saved", "add-unknown": "Unknown added", "remove-unknown": "Unknown set aside", "add-question": "Question added", "edit-question": "Question edited", resolve: "Decision recorded", reopen: "Decision reopened", "add-note": "Interview line saved", "confirm-understanding": "Understanding confirmed", "draft-spec": "Specification drafted", "approve-spec": "Specification approved", "begin-conversion": "Task creation started", "mark-converted": "Tasks created", archive: "Plan archived", restore: "Plan restored" };
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
    if (item.history.length > limit) button("Show older revisions", area, () => { local.historyLimit = limit + 12; render(); if ($("history")) { $("history").open = true; $("history").scrollIntoView?.({ block: "nearest" }); } });
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
    rememberSelection();
    if (composeKey !== draftKey()) { stopExploration(); composeKey = draftKey(); focusedField = "destination"; copilot = { status: "idle", result: null, signature: null, error: "" }; suggestionUndo = null; }
    renderList(); $("detail").replaceChildren();
    if (!state.projectId) {
      const empty = node("div", "planning-empty", undefined, $("detail"));
      node("p", "", api()?.projectsList ? "Choose a project to start planning." : "Open the desktop app and choose a project to start planning.", empty);
      if (api()?.projectsList && window.MefiSidebar?.open) button("Choose project", empty, () => { close(); window.MefiSidebar.open({ focus: true }); }, "choose-project", true);
      controls(); return;
    }
    const item = plan();
    renderWorkflow(item);
    const canvas = node("div", "planning-canvas", undefined, $("detail"));
    const editor = node("div", "planning-editor", undefined, canvas); editor.id = "plans-editor";
    const feedback = node("div", "planning-draft-feedback", undefined, editor); feedback.id = "plans-draft-feedback"; feedback.setAttribute("role", "status"); feedback.hidden = true;
    const assistant = node("aside", "planning-copilot", undefined, canvas); assistant.id = "plans-copilot"; assistant.setAttribute("aria-label", "AI planning partner");
    details(item); if (item) { interviewPanel(item); unknowns(item); questions(item); review(item); specification(item); history(item); }
    existingWork(item);
    renderDraftFeedback(); renderCopilot();
    controls();
  }
  async function refreshWork() {
    const item = plan();
    if (!state.opened || document.hidden || !onBoard(item) || state.busy) return;
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
      if (state.projectId !== projects.activeId) { restoreSelection = true; state.projectId = projects.activeId; state.plans = []; state.selected = "new"; state.tasks = null; state.workError = null; state.existing = null; state.workReadId += 1; }
      const projectId = state.projectId; state.projectName = projects.projects.find((item) => item.id === projectId)?.name || "No project selected";
      if (!projectId) { render(); note(); return; }
      const result = guard(await api().planningList({ projectId }));
      if (epoch !== state.epoch || readId !== state.readId || projectId !== state.projectId || (result.projectId && result.projectId !== projectId)) return;
      state.plans = result.plans || []; state.existing = result.existing ?? null; restoreProjectPlan(); render(); if (refreshTasks) void refreshWork();
    } catch (error) { if (epoch === state.epoch && readId === state.readId) { render(); note(error.message, true); } }
  }
  async function open(options = {}) {
    init(); priorFocus = document.activeElement; state.opened = true; $("overlay").hidden = false;
    window.MefiNav?.claim?.("plans"); note("Opening this project's plans…");
    await refresh({ refreshTasks: false });
    if (!state.opened) return;
    if (options.create) { state.selected = "new"; if (options.destination && !draft().details?.destination) { draft().details = { title: "", destination: String(options.destination), outOfScope: "" }; persist(); } }
    else if (options.planId) state.selected = options.planId;
    render(); if (state.projectId && api()?.planningList && $("notice").dataset.error !== "true") note();
    startWorkPoll();
    (options.create ? $("title") : $("new"))?.focus();
  }
  function close() { if (!$("overlay") || $("overlay").hidden) return; persist(); state.opened = false; stopExploration(); copilot.status = "idle"; stopWorkPoll(); $("overlay").hidden = true; window.MefiNav?.release?.("plans"); if (!window.MefiNav?.release) priorFocus?.focus?.(); }
  function init() {
    if (initialized || !$("overlay")) return; initialized = true;
    $("new").addEventListener("click", () => { if (state.busy) return; state.selected = "new"; render(); note(); $("title")?.focus(); });
    $("refresh").addEventListener("click", () => refresh()); $("close").addEventListener("click", () => window.MefiNav?.close ? window.MefiNav.close("plans") : close());
    // A pushed board change repaints an open plan's workflow at once; the poll
    // below is only a backstop for a missed push.
    api()?.onTasks?.((tasks) => {
      if (!state.opened || !state.projectId || !Array.isArray(tasks)) return;
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
      stopExploration();
      rememberSelection(); restoreSelection = true;
      persist(); state.epoch += 1; state.readId += 1; state.workReadId += 1; state.projectId = projectId; state.selected = "new"; state.plans = []; state.tasks = null; state.workError = null; state.existing = null; state.busy = false; state.pending = null;
      if (state.opened) { render(); note("Opening this project's plans…"); void refresh(); }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { stopExploration(); copilot.status = "idle"; } else if (state.opened) void refreshWork(); });
    window.addEventListener("beforeunload", persist);
  }
  window.MefiPlanning = { open, close, refresh, init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
