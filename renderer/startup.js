// The launch screen inside the startup gate: which project to open, and
// whether the agents may start. It runs before any readiness step reads the
// workspace, so the steps load the project the user named. Choosing only
// selects the project on the host; the agents stay held (autopilot.held in
// main.cjs) until "Open and start agents" here, or the workspace's Start
// agents control, releases them. Diagnostic launches, a renderer reload after
// the choice, and any bridge without the startup contract skip the screen.
(function () {
  "use strict";
  const $ = (id) => document.getElementById("boot-" + id);
  const api = () => window.mefiStudio;
  const available = () => Boolean(api()?.startupState && api()?.startupChoose && api()?.startupBegin);
  const state = { projects: [], selectedId: null, busy: false };

  function node(tag, className, textContent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = textContent;
    return element;
  }
  function note(text, error = false) {
    const target = $("choose-note");
    if (!target) return;
    target.textContent = text || (state.selectedId ? "Agents stay off until you start them." : "You can add a folder later from the sidebar.");
    target.classList.toggle("error", Boolean(error));
  }
  // The host's answer names the selection: a folder it just opened, a folder
  // it just added, the current pick if it still exists, else the active one.
  function adopt(result) {
    if (Array.isArray(result?.projects)) state.projects = result.projects;
    const known = (id) => state.projects.some((project) => project.id === id);
    const preferred = [result?.selectedId, result?.addedId, state.selectedId, result?.activeId, state.projects[0]?.id].find((id) => typeof id === "string" && known(id));
    state.selectedId = preferred ?? null;
  }
  function render() {
    const list = $("projects");
    if (!list) return;
    list.replaceChildren();
    if (!state.projects.length) list.append(node("p", "boot-projects-empty", "No project is open yet. Open a folder and Studio will start there, or continue without one."));
    for (const project of state.projects) {
      const selected = project.id === state.selectedId;
      const row = node("button", selected ? "boot-project selected" : "boot-project");
      row.type = "button";
      row.setAttribute("role", "radio");
      row.setAttribute("aria-checked", String(selected));
      row.dataset.projectId = project.id;
      row.title = project.path || "";
      const text = node("span", "boot-project-text");
      text.append(node("span", "boot-project-name", project.name || project.path || "Project"), node("span", "boot-project-path", project.path || ""));
      row.append(node("span", "boot-project-icon", String(project.name || "P").slice(0, 1).toUpperCase()), text);
      row.addEventListener("click", () => { if (state.busy) return; state.selectedId = project.id; render(); note(""); });
      list.append(row);
    }
    if ($("open")) $("open").textContent = state.selectedId ? "Open studio" : "Continue without a project";
    if ($("open-start")) $("open-start").hidden = !state.selectedId;
  }
  function setBusy(busy, label) {
    state.busy = busy;
    for (const id of ["open", "open-start", "add-project"]) if ($(id)) $(id).disabled = busy;
    for (const row of $("projects")?.querySelectorAll?.("button") ?? []) row.disabled = busy;
    if ($("open") && label) $("open").textContent = label;
  }
  function focusSelected() {
    const row = $("projects")?.querySelector?.('[aria-checked="true"]');
    (row || $("open"))?.focus?.({ preventScroll: true });
  }

  // Resolves with the choice once the host has the project open, or with null
  // when the screen does not apply (the gate then proceeds as before).
  async function choose({ isCurrent = () => true } = {}) {
    if (!available() || !$("choose")) return null;
    let info = null;
    try { info = await api().startupState(); } catch (error) { console.warn("Startup state unavailable", error); return null; }
    if (!isCurrent() || !info?.ok || info.interactive === false || info.chosen === true) return null;
    adopt({ projects: info.projects, activeId: info.activeId });
    render();
    note("");
    return new Promise((resolve) => {
      const finish = async (startAgents) => {
        if (state.busy || !isCurrent()) return;
        setBusy(true, state.selectedId ? "Opening…" : "Continuing…");
        note("");
        try {
          const result = await api().startupChoose(state.selectedId);
          if (!isCurrent()) return;
          if (result?.ok === false) { note(result.error || "The project could not be opened.", true); return; }
          adopt(result);
          const changed = (result?.activeId ?? null) !== (info.activeId ?? null);
          resolve({ projectId: result?.activeId ?? state.selectedId ?? null, startAgents, changed });
        } catch (error) { note(error?.message || "The project could not be opened.", true); }
        finally { if (isCurrent()) { setBusy(false); render(); } }
      };
      $("open").onclick = () => finish(false);
      $("open-start").onclick = () => finish(true);
      if ($("add-project")) $("add-project").onclick = async () => {
        if (state.busy || !api()?.projectsAdd) return;
        setBusy(true);
        try {
          const result = await api().projectsAdd();
          if (!isCurrent()) return;
          if (result?.ok === false) note(result.error || "That folder could not be opened.", true);
          else if (!result?.canceled) { adopt(result); note(""); }
        } catch (error) { note(error?.message || "That folder could not be opened.", true); }
        finally { if (isCurrent()) { setBusy(false); render(); focusSelected(); } }
      };
      focusSelected();
    });
  }

  // "Open and start agents": called once the studio is up, never before.
  async function begin() {
    if (!api()?.startupBegin) return { ok: false, error: "Desktop app only." };
    try { return await api().startupBegin(); }
    catch (error) { console.warn("Starting the agents failed", error); return { ok: false, error: error?.message || "Starting the agents failed." }; }
  }

  window.MefiStartup = { choose, begin, available, state: () => ({ projects: state.projects.map((project) => project.id), selectedId: state.selectedId, busy: state.busy }) };
})();
