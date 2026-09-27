// One saved permission control, learning view and decision history for every
// Studio surface. The host owns policy; this module only displays and edits it.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const project = () => window.MefiWorkspace?.activeProjectId?.() || current?.projectId || null;
  // Each line says what happens to a new task, since that is what decides
  // whether agents start (scripts/autonomy.cjs needsApproval).
  const MODES = [
    ["ask", "Always ask", "Every new task, yours too, waits for your OK. You choose each step; Mefi suggests an answer."],
    ["accept", "Accept per task", "Every new task waits for your OK once. After that, Mefi handles its ordinary asks."],
    ["auto", "Auto", "Tasks start on their own, agent proposals included. Mefi handles confident choices."],
    ["elevated", "Elevated only", "Your tasks start on their own; tasks agents propose wait for your OK. Elevated requests stay yours."],
  ];
  const SCOPE = [["blend", "This project + others"], ["project", "This project"], ["global", "All projects"]];
  let current = null, learned = null, flight = null, epoch = 0;
  const mounts = new Map(), skillMounts = new Set();
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const label = () => MODES.find(([id]) => id === current?.level)?.[1] || "Auto";
  const button = (text, action, cls = "") => { const node = el("button", `autonomy-button ${cls}`.trim(), text); node.type = "button"; node.addEventListener("click", action); return node; };
  const outcome = (result, fallback = "Saved.") => result?.dispatch?.message || result?.message || (result?.dispatch?.paused || result?.paused ? "Saved. New work is paused." : result?.dispatch?.held || result?.held ? "Saved. The task is waiting for its next check." : fallback);
  function announce() {
    for (const [root, options] of mounts) { if (root.isConnected === false) mounts.delete(root); else paint(root, options); }
    for (const root of skillMounts) { if (root.isConnected === false) skillMounts.delete(root); else skills(root); }
    window.dispatchEvent(new CustomEvent("mefi:autonomy-changed", { detail: { projectId: current?.projectId, level: current?.level } }));
  }
  async function refresh({ learning = false } = {}) {
    if (!api()?.autonomyState) return null;
    if (flight) return flight;
    const mine = epoch, expected = project();
    flight = (async () => {
      const values = await Promise.allSettled([api().autonomyState(), learning || !learned ? api().learningState?.() : Promise.resolve(null)]);
      if (mine !== epoch || expected && project() !== expected) return null;
      const config = values[0].status === "fulfilled" ? values[0].value : null;
      if (config?.ok && (!expected || !config.projectId || config.projectId === expected)) current = config;
      const memory = values[1].status === "fulfilled" ? values[1].value : null;
      if (memory?.ok && (!current?.projectId || memory.projectId === current.projectId)) learned = memory;
      announce();
      return current;
    })().finally(() => { flight = null; });
    return flight;
  }
  async function change(root, call, { learning = false } = {}) {
    const note = root.querySelector(".autonomy-note");
    root.setAttribute("aria-busy", "true");
    for (const control of root.querySelectorAll("button, input, select")) control.disabled = true;
    const expected = project(), mine = epoch;
    try {
      const result = await call();
      if (result?.ok !== true) throw new Error(result?.error || "This setting could not be saved.");
      if (mine !== epoch || expected !== project()) return;
      if (result.level) current = result;
      if (learning) learned = null;
      await refresh({ learning });
    } catch (error) {
      if (mine === epoch && expected === project()) { if (mounts.has(root)) paint(root, mounts.get(root)); const errorNote = root.querySelector(".autonomy-note") || note; if (errorNote) { errorNote.textContent = error.message; errorNote.dataset.tone = "bad"; } }
    } finally {
      root.removeAttribute("aria-busy");
      for (const control of root.querySelectorAll("button, input, select")) control.disabled = control.dataset.autonomyLocked === "true";
    }
  }
  function openSettings() {
    if (window.MefiVibe?.mode?.() === "vibe") window.MefiVibe.openPanel("settings");
    else {
      let dialog = document.getElementById("autonomy-settings-dialog");
      if (!dialog) {
        dialog = el("dialog", "autonomy-settings-dialog"); dialog.id = "autonomy-settings-dialog"; dialog.setAttribute("aria-label", "Mefi's permissions");
        const close = button("Close", () => dialog.close());
        const body = el("div"); dialog.append(close, body); document.body.append(dialog); mount(body, { full: true });
      }
      if (!dialog.open) dialog.showModal();
    }
  }
  function modeChoices(root, holder) {
    holder.setAttribute("role", "radiogroup"); holder.setAttribute("aria-label", "Permission mode");
    for (const [id, title, description] of MODES) {
      const choice = button(title, () => void change(root, () => api().autonomySet({ level: id })), "autonomy-mode");
      choice.setAttribute("role", "radio"); choice.setAttribute("aria-checked", String(current?.level === id));
      choice.append(el("small", "", description)); choice.disabled = !current;
      holder.append(choice);
    }
  }
  function field(root, title, options, value, save) {
    const row = el("label", "autonomy-field"); row.append(el("span", "", title));
    const select = el("select"); select.setAttribute("aria-label", title);
    for (const [id, text] of options) { const option = el("option", "", text); option.value = id; select.append(option); }
    select.value = value; select.addEventListener("change", () => void change(root, () => save(select.value), { learning: true }));
    row.append(select); return row;
  }
  function settings(root) {
    const levels = el("div", "autonomy-modes"); modeChoices(root, levels); root.append(levels);
    const elevated = el("details", "autonomy-elevated"); elevated.append(el("summary", "", "Elevated requests…"));
    elevated.append(el("p", "autonomy-hint", "Checked requests stay yours. Turn one off to let Mefi handle it under your mode."));
    for (const category of current?.categories || []) {
      const row = el("label", "autonomy-check");
      const input = el("input"); input.type = "checkbox"; input.checked = current.elevated?.[category.id] !== false;
      if (category.id === "agent-filed" && current.level === "auto") { input.checked = false; input.disabled = true; input.dataset.autonomyLocked = "true"; }
      const words = el("span", "", category.label); words.append(el("small", "", category.blurb)); row.append(input, words);
      input.addEventListener("change", () => {
        const value = input.checked;
        if (!value && category.warn) {
          input.checked = true;
          const warning = el("div", "autonomy-warning"); warning.setAttribute("role", "alert"); warning.append(el("p", "", category.warn));
          warning.append(button("Let Mefi handle this", () => void change(root, () => api().autonomySet({ elevated: { [category.id]: false }, confirmed: [category.id] }))), button("Keep asking me", () => warning.remove()));
          elevated.append(warning);
        } else void change(root, () => api().autonomySet({ elevated: { [category.id]: value } }));
      }); elevated.append(row);
    }
    root.append(elevated);
    const memory = el("section", "autonomy-learning"); memory.append(el("h4", "", "Learning"));
    const enabled = el("label", "autonomy-check"), box = el("input"); box.type = "checkbox"; box.checked = learned?.decisions?.enabled !== false;
    box.addEventListener("change", () => void change(root, () => api().learningSet({ decisions: { enabled: box.checked } }), { learning: true }));
    enabled.append(box, el("span", "", "Learn from my answers")); memory.append(enabled);
    memory.append(field(root, "Use my decisions from", SCOPE, learned?.decisions?.scope || "blend", (scope) => api().learningSet({ decisions: { scope } })));
    memory.append(field(root, "Learn model strengths from", [...SCOPE, ["off", "Off"]], learned?.models || "blend", (models) => api().learningSet({ models })));
    memory.append(el("h4", "", "What Mefi has learned"));
    let scope = "project";
    const picks = el("div", "autonomy-tabs"), list = el("div", "autonomy-preferences");
    const render = () => {
      list.replaceChildren();
      for (const control of picks.children) control.setAttribute("aria-pressed", String(control.dataset.scope === scope));
      const preferences = learned?.profiles?.[scope] || [];
      if (!preferences.length) list.append(el("p", "autonomy-hint", "No learned preferences here yet."));
      for (const group of preferences) for (const verb of group.verbs || []) {
        const item = el("div", "autonomy-preference"); item.append(el("span", "", `${group.kind}: ${verb.verb} · ${Math.round(verb.share * 100)}% of weighted choices (${group.n} answers)`), button("Forget", () => void change(root, () => api().learningForget({ projectId: current?.projectId, scope, kind: group.kind, verb: verb.verb }), { learning: true }))); list.append(item);
      }
      if (preferences.length) list.append(button("Forget all in this view", () => void change(root, () => api().learningForget({ projectId: current?.projectId, scope, all: true }), { learning: true })));
    };
    for (const [id, title] of [["project", "This project"], ["global", "All projects"]]) { const pick = button(title, () => { scope = id; render(); }); pick.dataset.scope = id; picks.append(pick); }
    render(); memory.append(picks, list); root.append(memory);
  }
  function paint(root, options) {
    root.replaceChildren(); root.classList.add("autonomy-control");
    const note = el("p", "autonomy-note"); note.setAttribute("role", "status");
    if (options.full) { root.append(el("h3", "", "Mefi's permissions")); settings(root); }
    else {
      const toggle = button(current ? label() : "Permissions…", () => { menu.hidden = !menu.hidden; toggle.setAttribute("aria-expanded", String(!menu.hidden)); if (!menu.hidden) menu.querySelector("button")?.focus(); }, "autonomy-chip");
      if (options.id) toggle.id = options.id;
      toggle.setAttribute("aria-haspopup", "true"); toggle.setAttribute("aria-expanded", "false"); toggle.title = "Choose how much Mefi handles for you";
      const menu = el("div", "autonomy-popover"); menu.hidden = true; modeChoices(root, menu); menu.append(button("Elevated requests…", () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); openSettings(); }));
      menu.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.focus(); } });
      root.append(toggle, menu);
    }
    root.append(note);
  }
  // A click anywhere else closes an open permissions menu, like every other menu.
  document.addEventListener?.("pointerdown", (event) => {
    for (const menu of document.querySelectorAll?.(".autonomy-popover:not([hidden])") ?? []) {
      const control = menu.closest?.(".autonomy-control");
      if (control?.contains?.(event.target)) continue;
      menu.hidden = true;
      control?.querySelector?.(".autonomy-chip")?.setAttribute("aria-expanded", "false");
    }
  }, true);
  function mount(root, options = {}) { if (!root) return; mounts.set(root, options); paint(root, options); if (!current || options.full && !learned) void refresh({ learning: options.full }); }
  function history(root, data = current) {
    root.replaceChildren(); root.classList.add("autonomy-history");
    root.append(el("h3", "", "Decided for you"));
    const decisions = (data?.decisions || []).filter((row) => !row.failed && !row.pending).slice(-40).reverse();
    if (!decisions.length) root.append(el("p", "autonomy-hint", "Choices Mefi handles appear here with a reason and Undo."));
    for (const decision of decisions) {
      const row = el("article", "autonomy-decision"); row.append(el("strong", "", decision.label || decision.choice));
      const why = el("details"); why.append(el("summary", "", "Why"), el("p", "", decision.reason || "No further reason was recorded.")); row.append(why);
      if (decision.undone) row.append(el("span", "autonomy-hint", "Undone"));
      else if (decision.undoPending) row.append(el("span", "autonomy-hint", "Undo waits for the worker to finish"));
      else row.append(button("Undo", () => void change(row, () => api().autonomyUndo({ id: decision.id, projectId: data.projectId }))));
      row.append(el("p", "autonomy-note")); root.append(row);
    }
    root.append(el("h3", "", "For you"));
    const todos = (data?.todos || []).filter((row) => !row.doneAt);
    if (!todos.length) root.append(el("p", "autonomy-hint", "Nothing waiting for you outside Studio."));
    for (const todo of todos) {
      const row = el("article", "autonomy-todo"); row.append(el("p", "", todo.text));
      for (const [action, title] of [["done", "Done"], ["not-mine", "Not mine"]]) row.append(button(title, () => void change(row, () => api().autonomyTodo({ id: todo.id, action, projectId: data.projectId }))));
      row.append(el("p", "autonomy-note")); root.append(row);
    }
  }
  function skills(root) {
    skillMounts.add(root);
    root.replaceChildren(); root.classList.add("autonomy-skills"); root.append(el("h3", "", "What each model is good at"));
    let scope = "project";
    const tabs = el("div", "autonomy-tabs"), body = el("div", "autonomy-skills-body");
    const paint = () => {
      body.replaceChildren(); for (const pick of tabs.children) pick.setAttribute("aria-pressed", String(pick.dataset.scope === scope));
      const rows = learned?.skills?.[scope] || [];
      if (!rows.length) { body.append(el("p", "autonomy-hint", "Model strengths appear after observed outcomes.")); return; }
      const table = el("table"), head = el("tr"); for (const title of ["Task", "Model", "Win estimate", "Runs"]) head.append(el("th", "", title)); table.append(head);
      for (const row of rows) { const tr = el("tr"); for (const value of [row.taskType, row.model, `${Math.round(row.p * 100)}%`, String(row.n)]) tr.append(el("td", "", value)); table.append(tr); } body.append(table);
    };
    for (const [id, title] of [["project", "This project"], ["global", "All projects"]]) { const pick = button(title, () => { scope = id; paint(); }); pick.dataset.scope = id; tabs.append(pick); }
    root.append(tabs, body); paint();
    if (!learned) void refresh({ learning: true }).then(paint);
  }
  function best() {
    const rows = (learned?.skills?.project || []).filter((row) => /fix|repair|debug/.test(row.taskType));
    const row = [...rows].sort((a, b) => b.p - a.p || b.n - a.n)[0];
    return row ? `Best at fixes here: ${row.model} · ${row.wins} of ${row.n}` : "Model strengths appear as your team finishes work.";
  }
  window.MefiAutonomy = { mount, refresh, label, history, skills, best, outcome, state: () => current, learning: () => learned, openSettings };
  window.addEventListener("mefi:project-changed", () => { epoch++; current = null; learned = null; flight = null; void refresh({ learning: true }); });
  api()?.onAssistant?.((payload) => {
    if (payload?.event?.kind === "autonomy") void refresh();
  });
  window.MefiNav?.register?.({ id: "settings:autonomy", kind: "action", section: "agents", group: "tools", label: "Mefi's permission mode", desc: "Always ask, Accept per task, Auto or Elevated only", showIn: { palette: true }, run: openSettings });
})();
