// Skills: Agents' page for the reusable instructions a project keeps as plain
// files (Agents › Skills). A skill is <project>/.agents/skills/<name>/SKILL.md:
// front matter with a name and a description, then the instructions. Agents can
// load one when a task matches, and anyone can call one by typing /name in Home's
// message box. The host reads and writes (main.cjs "Skills", scripts/skills.cjs,
// the rules in scripts/skill-format.cjs); this page sends names and text, never a
// path, and the only file a skill ever lives in is that SKILL.md.
//
//  - The list says what each skill is for, how big it is, and anything that keeps
//    agents from using it (no description, too big, a name that does not agree).
//  - New skill, Edit and the starters share one editor: name, when to use it,
//    instructions, a byte counter and what the size means. Studio never overwrites
//    a skill, so New refuses a name that is taken. A name can not change once a
//    skill exists: it is the folder, and saved team settings point at it.
//  - Delete asks twice, and the host keeps a copy of the old text first.
//  - Import reads a folder you choose (its SKILL.md only); Export writes a folder
//    or a zip where you choose.
//  - How skills are used: every skill this project can reach (its own, the home
//    folder's and the answer styles built into Studio, like ELI5) is always on, picked
//    when it fits, or used only when called, separately for the chat, Studio's helper
//    agents and the builders (main.cjs "Skills and connectors everywhere", skill-use.cjs).
//    A built-in one can be copied into the project, where it can be edited.
// The checks here are the host's own rules written again so the editor can say
// what is wrong as you type (tests/skills_ui.test.mjs holds the two together);
// the host checks everything again. With MEFI_STUDIO_NO_SKILL_EDIT=1 the page is
// read-only and says so.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`skills-${id}`);
  const api = () => window.mefiStudio;
  const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const NAME_PROBLEM = "Use lowercase letters, numbers and dashes, up to 64 characters.";
  const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
  const RESERVED_PROBLEM = "Windows keeps that name for itself. Choose another.";
  const MAX_BYTES = 32000;
  const AUTO_LOAD_CHARS = 16000;
  const MAX_DESCRIPTION = 300;
  const OFF = "Editing skills is switched off on this PC.";
  const state = { list: null, error: "", loading: false, editor: null, busy: new Set(), note: null, reading: null, signature: "", project: "", use: null };
  let initialized = false;

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  const say = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback);
  const toast = (text, tone = "good") => window.MefiToast?.(text, tone);
  const projectId = () => window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId || "";
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const bytesOf = (text) => new TextEncoder().encode(String(text ?? "")).length;
  const writable = () => state.list?.writable !== false;

  // ---- the rules, as the host has them (scripts/skill-format.cjs) ---------------------------------
  function nameProblem(name) {
    if (typeof name !== "string" || !name) return "Give the skill a name.";
    if (!NAME_PATTERN.test(name)) return NAME_PROBLEM;
    return RESERVED.test(name) ? RESERVED_PROBLEM : null;
  }
  function yamlValue(text) {
    const plain = /^[A-Za-z0-9(][^\n]*$/.test(text) && !/(^|\s)#|:\s|:$|["'\\`{}[\],&*!|>%@]/.test(text) && !/^(true|false|null|yes|no|on|off|~|[-+]?[0-9][0-9._]*)$/i.test(text) && text === text.trim();
    return plain ? text : JSON.stringify(text);
  }
  /** The file a draft would be saved as, the way the host builds it. */
  function build({ name, description, body }) {
    return `---\nname: ${name}\ndescription: ${yamlValue(String(description ?? "").trim())}\n---\n\n${String(body ?? "").replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
  }
  /** What is wrong with a draft, most useful first: [{ field, message }]. */
  function problems(draft, { taken = [] } = {}) {
    const found = [];
    if (draft.mode === "new") {
      const bad = nameProblem(draft.name);
      if (bad) found.push({ field: "name", message: bad });
      else if (taken.includes(draft.name)) found.push({ field: "name", message: `A skill named ${draft.name} already exists. Studio never overwrites one.` });
    }
    const about = String(draft.description ?? "").trim();
    if (!about) found.push({ field: "description", message: "Say when to use it, in one line an agent can match a task against." });
    else if (about.length > MAX_DESCRIPTION) found.push({ field: "description", message: `Keep the description to ${MAX_DESCRIPTION} characters.` });
    if (!String(draft.body ?? "").trim()) found.push({ field: "body", message: "Write the instructions." });
    else if (bytesOf(build({ ...draft, description: about })) > MAX_BYTES) found.push({ field: "body", message: `This skill is ${kb(bytesOf(build({ ...draft, description: about })))}; the most is 32 KB.` });
    return found;
  }

  // ---- reading --------------------------------------------------------------------------------
  async function read({ quiet = false } = {}) {
    if (!api()?.skillsList) { state.error = "Skills are listed in the desktop app."; render(); return null; }
    if (state.reading) return state.reading;
    if (!quiet) { state.loading = true; render(); }
    const asked = projectId();
    state.reading = (async () => {
      try {
        const result = await api().skillsList();
        if (asked !== projectId()) return;
        if (result?.ok) {
          if (state.project && state.project !== asked) state.editor = null;
          state.list = result; state.error = ""; state.project = asked;
        } else { state.error = say(result?.error, "The skills could not be read."); if (result?.off) state.error = OFF; }
        // How each skill is used: a page without it (an older host) shows the list alone.
        const use = api().skillsUse ? await api().skillsUse().catch(() => null) : null;
        if (asked === projectId()) state.use = use?.ok && Array.isArray(use.skills) ? use : null;
      } catch (error) {
        state.error = say(error, "The skills could not be read.");
      }
    })().finally(() => { state.reading = null; state.loading = false; render(); });
    return state.reading;
  }

  // ---- painting ---------------------------------------------------------------------------------
  function headline() {
    const list = state.list;
    if (state.error && !list) return state.error;
    if (!list) return "Reading the skills…";
    if (list.blocked) return list.blocked;
    const count = list.skills.length;
    const text = count ? `${plural(count, "skill")} in this project. Type / in Home's message box to call one.` : "No skills in this project yet. Start from one below, or make your own.";
    return writable() ? text : `${text} ${OFF}`;
  }

  function chipsFor(skill) {
    const chips = [];
    if (skill.problem) { const chip = el("span", "skills-flag", skill.problem); chip.dataset.tone = "warn"; chips.push(chip); }
    if (!skill.problem && skill.loadsByItself === false) { const chip = el("span", "skills-flag", `Over 16 KB: agents use it only when you call /${skill.name}`); chip.dataset.tone = "info"; chips.push(chip); }
    return chips;
  }

  function rowNode(skill) {
    const item = el("li", "skills-row");
    item.dataset.name = skill.name;
    item.dataset.tone = skill.problem ? "warn" : "";
    const main = el("div", "skills-main");
    const title = el("div", "skills-title");
    title.append(el("strong", "skills-name", `/${skill.name}`));
    main.append(title);
    main.append(el("p", "skills-blurb", skill.description || "No description."));
    main.append(el("div", "skills-meta", `${skill.path} · ${kb(skill.bytes)}`));
    for (const chip of chipsFor(skill)) main.append(chip);
    const side = el("div", "skills-buttons");
    const busy = state.busy.has(skill.name);
    const add = (label, run, { title = "", disabled = false, danger = false, armed = "" } = {}) => {
      const button = el("button", "ghost mini", label);
      button.type = "button";
      button.disabled = busy || disabled;
      if (title) button.title = title;
      if (danger && window.MefiUi?.arm) window.MefiUi.arm(button, { run, armed: armed || `${label}: click again` });
      else button.addEventListener("click", run);
      side.append(button);
    };
    add("Edit", () => void edit(skill.name), { disabled: !skill.editable || !writable(), title: !writable() ? OFF : skill.editable ? "Change this skill" : skill.problem || "This skill can not be edited here" });
    add("Export folder", () => void exportSkill(skill.name, "folder"), { title: "Save a copy as a folder you choose" });
    add("Export zip", () => void exportSkill(skill.name, "zip"), { title: "Save a copy as a zip file you choose" });
    add("Delete", () => void remove(skill.name), { danger: true, armed: "Delete: click again", disabled: !writable(), title: writable() ? "Delete this skill. A copy of its text is kept on this PC." : OFF });
    item.append(main, side);
    return item;
  }

  function starterNode(starter) {
    const item = el("li", "skills-row skills-starter");
    item.dataset.name = starter.name;
    const main = el("div", "skills-main");
    main.append(el("strong", "skills-name", `/${starter.name}`), el("p", "skills-blurb", starter.description));
    const side = el("div", "skills-buttons");
    const button = el("button", "ghost mini", "Add");
    button.type = "button";
    button.disabled = !writable() || state.busy.has(starter.name);
    button.title = writable() ? `Save ${starter.name} into this project as it is. You can change it afterwards.` : OFF;
    button.addEventListener("click", () => void addStarter(starter));
    side.append(button);
    item.append(main, side);
    return item;
  }

  // The editor: one panel for a new skill and for a changed one.
  function editorNode() {
    const draft = state.editor;
    const isNew = draft.mode === "new";
    const panel = el("section", "skills-editor");
    panel.setAttribute("aria-label", isNew ? "New skill" : `Edit ${draft.name}`);
    const head = el("h3", "skills-editor-head", isNew ? "New skill" : `Edit /${draft.name}`);
    const where = el("span", "skills-editor-path", "");
    head.append(where);
    panel.append(head);
    const grid = el("div", "skills-fields");
    const field = (id, label, control, hint) => {
      const box = el("div", "skills-field");
      const tag = el("label", "skills-label", label);
      tag.htmlFor = `skills-${id}`;
      control.id = `skills-${id}`;
      box.append(tag, control);
      if (hint) { const note = el("p", "skills-hint", hint); note.id = `skills-${id}-hint`; control.setAttribute("aria-describedby", note.id); box.append(note); }
      return box;
    };
    const name = el("input", "skills-input");
    name.type = "text"; name.value = draft.name; name.placeholder = "release-check"; name.autocomplete = "off"; name.spellcheck = false; name.maxLength = 64;
    name.disabled = !isNew;
    name.addEventListener("input", () => { draft.name = name.value.trim(); revalidate(); });
    grid.append(field("name", "Name", name, isNew ? "This becomes the folder name and the /command." : "The name is the folder, and saved team settings point at it, so it can not change."));
    const about = el("input", "skills-input");
    about.type = "text"; about.value = draft.description; about.placeholder = "One line an agent can match a task against"; about.autocomplete = "off"; about.maxLength = MAX_DESCRIPTION;
    about.addEventListener("input", () => { draft.description = about.value; revalidate(); });
    grid.append(field("description", "When to use it", about));
    panel.append(grid);
    const body = el("textarea", "skills-text");
    body.value = draft.body; body.rows = 9; body.spellcheck = false;
    body.setAttribute("aria-label", "Skill instructions");
    body.addEventListener("input", () => { draft.body = body.value; revalidate(); });
    panel.append(field("body", "Instructions", body));
    const counter = el("div", "skills-counter");
    const size = el("span", "skills-size"); size.id = "skills-size";
    const meaning = el("span", "skills-meaning"); meaning.id = "skills-meaning";
    counter.append(size, meaning);
    panel.append(counter);
    if (draft.hasExtra) panel.append(el("p", "skills-hint", "This file has other front matter (for example another tool's allowed-tools). Saving keeps it exactly as it is."));
    const error = el("p", "skills-error"); error.id = "skills-error"; error.setAttribute("role", "alert");
    panel.append(error);
    const buttons = el("div", "skills-editor-buttons");
    const save = el("button", "primary", draft.saving ? "Saving…" : "Save skill"); save.type = "button"; save.id = "skills-save";
    save.addEventListener("click", () => void saveDraft());
    const cancel = el("button", "ghost", "Cancel"); cancel.type = "button"; cancel.id = "skills-cancel";
    cancel.addEventListener("click", closeEditor);
    buttons.append(save, cancel);
    panel.append(buttons);
    // What is said follows the words without drawing the panel again, so the caret stays where it is.
    function revalidate() {
      where.textContent = `.agents/skills/${draft.name || "name"}/SKILL.md`;
      const now = problems(draft, { taken: (state.list?.skills ?? []).map((skill) => skill.name) });
      const shown = now.find((item) => draft.touched?.has(item.field)) ?? now.find((item) => item.field === "name" && draft.name);
      const bytes = bytesOf(draft.name && draft.description !== undefined ? build({ name: draft.name || "name", description: draft.description, body: draft.body }) : "");
      size.textContent = `${kb(bytes)} of 32 KB`;
      counter.dataset.tone = bytes > MAX_BYTES ? "bad" : "";
      meaning.textContent = bytes > AUTO_LOAD_CHARS ? `Over 16 KB: agents skip it unless you call /${draft.name || "name"}` : "Loads by itself when a task matches";
      error.textContent = shown ? shown.message : "";
      error.hidden = !shown;
      save.disabled = draft.saving === true || now.length > 0 || !writable();
      name.setAttribute("aria-invalid", String(now.some((item) => item.field === "name" && Boolean(draft.name))));
    }
    for (const [control, key] of [[name, "name"], [about, "description"], [body, "body"]]) control.addEventListener("blur", () => { (draft.touched ??= new Set()).add(key); revalidate(); });
    revalidate();
    return panel;
  }

  function othersNode(others) {
    const box = el("details", "skills-others");
    const summary = el("summary", "", `Also available to agents: ${plural(others.length, "skill")} from other places`);
    box.append(summary);
    box.append(el("p", "skills-hint", "These live in other tools' folders or your home folder. Agents can use them, and /name calls them; Studio does not edit them from here."));
    const list = el("ul", "skills-other-list");
    for (const item of others) {
      const row = el("li", "skills-other");
      row.append(el("strong", "", `/${item.name}`), el("span", "skills-meta", `${item.scope === "user" ? "your home folder" : "this project"} · ${item.source || "other folder"}`));
      list.append(row);
    }
    box.append(list);
    return box;
  }

  // ---- how skills are used ------------------------------------------------------------------
  const USE_LABELS = { always: "Always on", auto: "When it fits", call: "Only when called" };
  const PLACE_LABELS = [["chat", "Chat"], ["agents", "Agents"], ["builders", "Builders"]];
  function useNode(use) {
    const section = el("section", "skills-section skills-use");
    section.id = "skills-use";
    section.setAttribute("aria-label", "How skills are used");
    section.append(el("h3", "skills-section-head", "How skills are used"));
    section.append(el("p", "skills-hint", "Always on: in every request there. When it fits: the agent loads it by itself when a request matches what it is for. Only when called: when you type /name in a message, or a task's words name it."));
    const switches = el("div", "skills-use-auto");
    switches.id = "skills-use-auto";
    for (const [place, label] of PLACE_LABELS) {
      const wrap = el("label", "skills-use-switch");
      const box = el("input"); box.type = "checkbox"; box.setAttribute("role", "switch"); box.checked = use.auto?.[place] !== false; box.dataset.place = place;
      box.disabled = state.busy.has(`auto:${place}`);
      box.addEventListener("change", () => void setUse({ place, auto: box.checked }, `auto:${place}`, box.checked ? `${label}: skills pick themselves when they fit.` : `${label}: skills are used only when called.`));
      wrap.append(box, el("span", "", `${label} picks skills by itself`));
      switches.append(wrap);
    }
    section.append(switches);
    const table = el("ul", "skills-use-list");
    table.id = "skills-use-list";
    for (const skill of use.skills) {
      const row = el("li", "skills-use-row");
      row.dataset.skill = skill.name;
      const who = el("div", "skills-use-who");
      who.append(el("strong", "skills-name", `/${skill.name}`));
      const where = skill.scope === "builtin" ? (skill.kind === "style" ? "Answer style, built into Studio" : "Built into Studio") : skill.scope === "user" ? "Your home folder" : "This project";
      who.append(el("span", "skills-meta", skill.title && skill.title !== skill.name ? `${skill.title} · ${where}` : where));
      row.append(who);
      const picks = el("div", "skills-use-picks");
      for (const [place, label] of PLACE_LABELS) {
        const field = el("label", "skills-use-pick");
        const select = el("select", "skills-input skills-use-select");
        select.dataset.place = place;
        select.setAttribute("aria-label", `/${skill.name} in ${label.toLowerCase()}`);
        for (const value of ["always", "auto", "call"]) {
          const option = el("option", "", `${USE_LABELS[value]}${skill.defaults?.[place] === value ? " (default)" : ""}`);
          option.value = value;
          if (value === "auto" && skill.chars > AUTO_LOAD_CHARS) option.disabled = true;
          select.append(option);
        }
        select.value = skill.chosen?.[place] ?? skill.defaults?.[place] ?? skill.uses?.[place] ?? "call";
        if (skill.uses?.[place] && skill.uses[place] !== select.value) select.title = `In force now: ${USE_LABELS[skill.uses[place]]}, because ${label.toLowerCase()} does not pick skills by itself.`;
        select.disabled = state.busy.has(skill.name);
        select.addEventListener("change", () => void setUse({ name: skill.name, place, use: select.value === skill.defaults?.[place] ? "default" : select.value }, skill.name, `/${skill.name} in ${label.toLowerCase()}: ${USE_LABELS[select.value].toLowerCase()}.`));
        field.append(el("span", "skills-label", label), select);
        picks.append(field);
      }
      row.append(picks);
      if (skill.scope === "builtin") {
        const copy = el("button", "ghost mini", "Copy to this project");
        copy.type = "button";
        const taken = (state.list?.skills ?? []).some((item) => item.name === skill.name);
        copy.disabled = !writable() || taken || state.busy.has(`copy:${skill.name}`);
        copy.title = taken ? "This project already has its own copy, and it is the one in use." : `Save /${skill.name} into .agents/skills, where you can change it. The project's copy is then the one in use.`;
        copy.addEventListener("click", () => void copyBuiltin(skill.name));
        row.append(copy);
      }
      table.append(row);
    }
    section.append(table);
    return section;
  }
  async function setUse(payload, key, done) {
    if (!api()?.skillsSetUse) return;
    state.busy.add(key); state.signature = ""; render();
    let result = null;
    try { result = await api().skillsSetUse(payload); } catch (error) { result = { ok: false, error: say(error, "That could not be saved.") }; }
    state.busy.delete(key); state.signature = "";
    if (result?.ok && Array.isArray(result.skills)) { state.use = result; toast(done); render(); return; }
    setNote({ tone: "bad", text: say(result?.error, "That could not be saved.") });
  }
  async function copyBuiltin(name) {
    if (!api()?.skillsCopyBuiltin || !writable()) return;
    const key = `copy:${name}`;
    state.busy.add(key); state.signature = ""; render();
    let result = null;
    try { result = await api().skillsCopyBuiltin(name); } catch (error) { result = { ok: false, error: say(error, "The skill could not be copied.") }; }
    state.busy.delete(key); state.signature = "";
    if (result?.ok) { toast(`Copied /${name} into .agents/skills/${name}. Edit it there; the project's copy is now the one in use.`); await read({ quiet: true }); return; }
    setNote({ tone: "bad", text: say(result?.error, "The skill could not be copied.") });
  }

  function render() {
    const overlay = $("overlay");
    if (!overlay) return;
    const list = state.list;
    const box = $("list");
    // Typing does not redraw: what marks an editor is which one it is, not what is in it.
    const editing = state.editor ? [state.editor.mode, state.editor.key, Boolean(state.editor.saving)] : null;
    const sign = JSON.stringify([state.error, state.loading && !list, list && [list.blocked, list.writable, list.skills?.map((skill) => [skill.name, skill.description, skill.bytes, skill.updatedAt, skill.problem, skill.editable, skill.loadsByItself]), list.starters?.map((starter) => starter.name), list.others?.map((item) => [item.name, item.scope, item.source])], [...state.busy], state.note, editing, state.use && [state.use.auto, state.use.skills.map((skill) => [skill.name, skill.scope, skill.uses, skill.chosen])]]);
    if (sign === state.signature) return;
    state.signature = sign;
    const held = overlay.contains(document.activeElement) && box.contains(document.activeElement) && !document.activeElement.closest(".skills-editor") ? { name: document.activeElement.closest("[data-name]")?.dataset.name, label: document.activeElement.textContent } : null;
    const failed = state.error && !list;
    $("headline").textContent = headline();
    $("headline").dataset.tone = failed || list?.blocked ? "bad" : list && !writable() ? "warn" : "";
    const tools = [$("new"), $("import")];
    for (const button of tools) { button.disabled = !list || !writable() || Boolean(list.blocked) || state.loading; button.title = !writable() && list ? OFF : button.id === "skills-import" ? "Choose a folder that holds a SKILL.md" : "Write a new skill"; }
    const nodes = [];
    if (state.note) nodes.push(noteNode(state.note));
    if (state.editor) nodes.push(editorNode());
    if (list && !failed) {
      const section = el("section", "skills-section");
      section.setAttribute("aria-label", "Skills in this project");
      section.append(el("h3", "skills-section-head", "In this project"));
      const rows = el("ul", "skills-list");
      for (const skill of list.skills) rows.append(rowNode(skill));
      if (!list.skills.length && !list.blocked) rows.append(el("li", "skills-empty", "Nothing here yet. Skills are plain files under .agents/skills, so they travel with the project and show up in Git."));
      section.append(rows);
      nodes.push(section);
      if (list.starters?.length && writable() && !list.blocked) {
        const starters = el("section", "skills-section");
        starters.setAttribute("aria-label", "Starter skills");
        starters.append(el("h3", "skills-section-head", "Starters"));
        const starterRows = el("ul", "skills-list");
        for (const starter of list.starters) starterRows.append(starterNode(starter));
        starters.append(starterRows);
        nodes.push(starters);
      }
      if (list.others?.length) nodes.push(othersNode(list.others));
      if (state.use?.skills?.length) nodes.push(useNode(state.use));
    }
    // A redraw while someone is typing keeps their place in the editor.
    const typing = document.activeElement?.closest?.(".skills-editor") && document.activeElement.id ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    box.replaceChildren(...nodes);
    if (typing) {
      const again = box.querySelector(`#${typing.id}`);
      again?.focus?.({ preventScroll: true });
      if (again && typing.start !== undefined && typing.start !== null) again.setSelectionRange?.(typing.start, typing.end);
    }
    if (held) {
      const again = held.name ? [...box.querySelectorAll("[data-name]")].find((node) => node.dataset.name === held.name) : null;
      const target = again ? [...again.querySelectorAll("button")].find((button) => button.textContent === held.label && !button.disabled) : null;
      target?.focus?.({ preventScroll: true });
    }
  }

  function noteNode(note) {
    const box = el("div", "skills-note");
    box.dataset.tone = note.tone ?? "info";
    box.setAttribute("role", note.tone === "bad" ? "alert" : "status");
    box.append(el("span", "", note.text));
    const dismiss = el("button", "ghost mini", "Dismiss");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => setNote(null));
    box.append(dismiss);
    return box;
  }
  function setNote(note) { state.note = note; state.signature = ""; render(); }

  // ---- acting -----------------------------------------------------------------------------------
  function closeEditor() { state.editor = null; state.signature = ""; render(); $("new")?.focus?.({ preventScroll: true }); }
  function startEditor(draft) {
    if (state.editor?.dirty) { toast("Save or cancel the skill you are editing first.", "bad"); return false; }
    state.editor = { touched: new Set(), key: draft.mode === "new" ? "__new" : draft.name, ...draft };
    state.note = null; state.signature = ""; render();
    requestAnimationFrame(() => $("list")?.querySelector(draft.mode === "new" ? "#skills-name" : "#skills-description")?.focus?.({ preventScroll: true }));
    return true;
  }
  function dirty() { if (state.editor) state.editor.dirty = true; }

  function newSkill() {
    if (!writable()) return;
    startEditor({ mode: "new", name: "", description: "", body: "" });
  }
  async function edit(name) {
    if (!api()?.skillsRead || !writable()) return;
    state.busy.add(name); state.signature = ""; render();
    let result = null;
    try { result = await api().skillsRead(name); } catch (error) { result = { ok: false, error: say(error, "The skill could not be opened.") }; }
    state.busy.delete(name); state.signature = "";
    if (!result?.ok) { setNote({ tone: "bad", text: say(result?.error, "The skill could not be opened.") }); return; }
    startEditor({ mode: "edit", name: result.name, description: result.description, body: result.body, hasExtra: result.hasExtra === true });
  }
  async function addStarter(starter) {
    await create({ name: starter.name, description: starter.description, body: starter.body }, { starter: true });
  }

  // One create, for the editor and for a starter: the host says no to a name that is taken.
  async function create(draft, { starter = false } = {}) {
    if (!api()?.skillsCreate) return null;
    const id = projectId();
    state.busy.add(draft.name); state.signature = ""; render();
    let result = null;
    try { result = await api().skillsCreate({ name: draft.name, description: draft.description, body: draft.body }); } catch (error) { result = { ok: false, error: say(error, "The skill could not be saved.") }; }
    state.busy.delete(draft.name);
    if (id !== projectId()) return result;
    if (result?.ok) {
      toast(`Saved .agents/skills/${draft.name}/SKILL.md. Type /${draft.name} in Home's message box to use it.`);
      if (!starter) state.editor = null;
      state.signature = "";
      await read({ quiet: true });
      return result;
    }
    if (starter) setNote({ tone: "bad", text: say(result?.error, "The skill could not be saved.") });
    else if (state.editor) { state.editor.saving = false; state.editor.serverError = result?.error; state.signature = ""; render(); showServerError(result); }
    return result;
  }
  async function saveDraft() {
    const draft = state.editor;
    if (!draft || draft.saving) return;
    if (problems(draft, { taken: (state.list?.skills ?? []).map((skill) => skill.name) }).length) return;
    draft.saving = true; state.signature = ""; render();
    if (draft.mode === "new") { await create({ name: draft.name, description: draft.description.trim(), body: draft.body }); return; }
    const id = projectId();
    let result = null;
    try { result = await api().skillsSave({ name: draft.name, description: draft.description.trim(), body: draft.body }); } catch (error) { result = { ok: false, error: say(error, "The skill could not be saved.") }; }
    if (id !== projectId()) return;
    if (result?.ok) {
      toast(result.unchanged ? `/${draft.name} is already saved this way.` : `Saved /${draft.name}. A copy of the old text is kept on this PC.`);
      state.editor = null; state.signature = "";
      await read({ quiet: true });
      return;
    }
    draft.saving = false; state.signature = ""; render(); showServerError(result);
  }
  function showServerError(result) {
    const error = $("list")?.querySelector("#skills-error");
    if (!error) return;
    error.textContent = say(result?.error, "The skill could not be saved.");
    error.hidden = false;
  }
  async function remove(name) {
    if (!api()?.skillsDelete || !writable()) return;
    const id = projectId();
    state.busy.add(name); state.signature = ""; render();
    let result = null;
    try { result = await api().skillsDelete(name); } catch (error) { result = { ok: false, error: say(error, "The skill could not be deleted.") }; }
    state.busy.delete(name);
    if (id !== projectId()) return;
    if (result?.ok) {
      toast(`Deleted /${name}. A copy of its text is kept on this PC.${result.keptFiles ? ` The folder stays, because it holds ${plural(result.keptFiles, "other file")}.` : ""}`);
      if (state.editor?.name === name) state.editor = null;
      state.signature = "";
      await read({ quiet: true });
      return;
    }
    state.signature = "";
    setNote({ tone: "bad", text: say(result?.error, "The skill could not be deleted.") });
    void read({ quiet: true });
  }
  async function importSkill() {
    if (!api()?.skillsImport || !writable()) return;
    const id = projectId();
    let result = null;
    try { result = await api().skillsImport(); } catch (error) { result = { ok: false, error: say(error, "The skill could not be imported.") }; }
    if (id !== projectId() || result?.canceled) return;
    if (result?.ok) {
      const left = result.skipped ? ` ${plural(result.skipped, "other file")} in that folder ${result.skipped === 1 ? "was" : "were"} not imported; a skill is its SKILL.md.` : "";
      setNote({ tone: "good", text: `Imported /${result.skill?.name}.${left}` });
      await read({ quiet: true });
      return;
    }
    setNote({ tone: "bad", text: say(result?.error, "The skill could not be imported.") });
  }
  async function exportSkill(name, kind) {
    if (!api()?.skillsExport) return;
    let result = null;
    try { result = await api().skillsExport({ name, kind }); } catch (error) { result = { ok: false, error: say(error, "The skill could not be exported.") }; }
    if (result?.canceled) return;
    if (result?.ok) toast(`Exported /${name} as a ${kind === "zip" ? "zip file" : "folder"}.`);
    else setNote({ tone: "bad", text: say(result?.error, "The skill could not be exported.") });
  }

  // ---- the sheet --------------------------------------------------------------------------------
  function open(params = {}) {
    init();
    window.MefiNav?.claim?.("skills");
    $("overlay").hidden = false;
    state.signature = "";
    void read({ quiet: Boolean(state.list) });
    render();
    if (params?.focus !== false) requestAnimationFrame(() => $("new")?.focus?.({ preventScroll: true }));
  }
  function close() {
    if (!isOpen()) return;
    $("overlay").hidden = true;
    window.MefiNav?.release?.("skills");
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => window.MefiNav?.close?.("skills") ?? close());
    $("refresh").addEventListener("click", () => { void read(); });
    $("new").addEventListener("click", newSkill);
    $("import").addEventListener("click", () => void importSkill());
    // Typing in the editor marks it as changed, so a second New or Edit does not throw the words away.
    $("list").addEventListener("input", (event) => { if (event.target?.closest?.(".skills-editor")) dirty(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && isOpen()) void read({ quiet: true }); });
    window.addEventListener("focus", () => { if (isOpen()) void read({ quiet: true }); });
  }

  window.MefiSkills = { open, close, isOpen, refresh: () => read(), problems, build, nameProblem, state: () => ({ list: state.list, error: state.error, editor: state.editor }) };
  // nav.js holds the record (Agents, beside Agent Brain) and calls open/close.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
