// A local, resumable guide. Reading a lesson never changes a project or runs work.
// "Walk with me" keeps a small coach in the corner while it navigates the real
// menus with the user, highlights the exact control and ticks each stop off.
(function () {
  "use strict";
  const KEY = "mefiStudio.walkthrough.v1";
  const VERSION = 1;
  const MODES = ["idle", "sheet", "coach"];
  const $ = (id) => document.getElementById(`walkthrough-${id}`);
  const lessons = [
    {
      title: "Welcome to Mefi's Studio", short: "Your workspace", glyph: "g-explorer",
      copy: "Turn an idea into a checked result: talk it through, create a task or plan, follow the work, then review what changed. This guide shows you where to do each step, and can walk the menus with you.",
      points: ["Start with Projects in the sidebar. Use + to add an existing folder, then select it. Check the project name above the conversation before adding work.", "Choose how builds start below. Auto build is on by default. Turn it off for Verify first: inspect each task, then approve the ones you want built.", "Each project keeps its own tasks, plans, conversation and results. Your project files stay in their folder; Studio keeps its history separately."],
      action: "Walk me to my projects", route: "project",
      station: "I opened the project menu with you and highlighted +. Add an existing folder, then select it. I tick this off the moment you are in a project.",
      note: "This opens the workspace and the project menu with you. It does not change your selected project.",
      target: "#workspace-add-project", menu: true, waitFor: "mefi:project-changed", done: "Project selected",
    },
    {
      title: "Connect the assistant and coding workers", short: "Connections", glyph: "g-ambience",
      copy: "The assistant helps you think and organize. Coding workers carry out tasks in your project. Their provider settings are separate.",
      points: ["In Settings & connections, save the key for the assistant provider you want, choose Grok, Claude Code or Antigravity with their own CLI logins, or point the custom route at your own OpenAI-compatible endpoint.", "LM Studio needs no key: keep its local server running and pick it as the provider.", "Models are saved per provider: set the model you have for each option and switching never mixes them.", "Choose the coding worker provider and ensure its CLI is installed and signed in. Saving an assistant key alone does not prove a worker is ready.", "Manual planning works without an AI key. Jev is optional; it advises on related work and does not replace your coding provider."],
      action: "Walk me to connections", route: "studio",
      station: "We are in Settings & connections together, at the assistant group. Save the key you want, then scroll to the coding worker group and confirm its CLI is signed in. Nothing is sent until you choose to test it.",
      note: "Connection tests and AI requests may use your provider allowance when you explicitly run them.",
      target: "#settings-assistant-heading", done: "Connections checked",
    },
    {
      title: "Give a clear task, or explore a plan", short: "Create", glyph: "g-tasks",
      copy: "Use Give a task when the outcome is clear. Use Plan an idea when you need to settle questions before anything is built.",
      points: ["Talk together is for questions and discussion. Give a task saves work in the selected project; Use a task outline helps you describe the result and checks.", "Start small: for example, ‘Add a Create note button to the empty notes list; check that it opens a new note.’ Say what should stay unchanged, too.", "Plan an idea collects questions and decisions. Review and approve the specification, then explicitly create its tasks.", "With Verify first, View task lets you inspect the brief and Approve build, or leave it waiting. New work also follows your Pause and worker settings."],
      action: "Walk me to the task box", route: "task", secondary: "Explore a plan", secondaryRoute: "plans",
      station: "This is the task box for the selected project. Describe the result and how you will check it, or open Use a task outline for a guided shape. I do not send anything from here.",
      note: "These buttons open the editor and the plan sheet. They do not submit a task or start a planning request.",
      target: "#workspace-input", done: "Task box found",
    },
    {
      title: "Follow the queue and current work", short: "Monitor", glyph: "g-command",
      copy: "Your work is the everyday queue. Command's node tree shows live workers, their current step and what is waiting to run.",
      points: ["Your work separates the queue, saved ideas, Review and Done. Open any task for its brief, prerequisites, history and result.", "In Node tree, Live work shows running workers and their reported steps. Click Ready, Waiting or Needs attention to see the matching tasks and their reasons.", "Work through backlog starts existing work and admits saved ideas gradually. Pause stops new scheduling while current workers finish; let them finish before switching projects.", "A prerequisite must finish before dependent work starts. Read connection, retry and file-conflict messages before adding more work."],
      action: "Walk me to Live work", route: "command", secondary: "Open task board", secondaryRoute: "tasks",
      station: "We are in Command. Live work on the right follows running workers and their reported steps; the node tree behind it follows your selection. Open a reason like Ready, Waiting or Needs attention to see the matching tasks.",
      note: "Follow in Command tracks active work. You can pan or select a task to take control of the view.",
      target: "#idle-feed", done: "Live work found",
    },
    {
      title: "Review results and recover deliberately", short: "Review", glyph: "g-eyes",
      copy: "A worker finishing is a result to inspect. Done should mean there is verification evidence, or you have explicitly confirmed the result yourself.",
      points: ["Open Review in Your work to read the result, evidence and next actions. Inspect the project changes and run any remaining acceptance checks.", "If work needs attention, read its reason first. Correct the connection, brief or prerequisite, then use its retry control when you are ready.", "Keep failed work available for diagnosis. Task history can recover an earlier brief; it does not roll back your project files."],
      action: "Walk me to Review", route: "review",
      station: "This is Review in Your work. Open a finished task to read the result and evidence, then run any remaining acceptance checks. Tasks that need attention keep their reason and retry controls here.",
      note: "You can reopen this guide from Start here in the sidebar, Settings or Shortcuts. Completing the guide does not mark any task done.",
      target: "#workspace-review", done: "Review found",
    },
  ];
  const blankDone = () => lessons.map(() => false);
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      if (value?.version === VERSION) return {
        version: VERSION,
        step: Number.isInteger(value.step) ? Math.max(0, Math.min(lessons.length - 1, value.step)) : 0,
        status: ["new", "reading", "dismissed", "complete"].includes(value.status) ? value.status : "new",
        mode: MODES.includes(value.mode) ? value.mode : "idle",
        done: blankDone().map((_, index) => Boolean(value.done?.[index])),
      };
    } catch {}
    return { version: VERSION, step: 0, status: "new", mode: "idle", done: blankDone() };
  }
  let state = read();
  let initialized = false;
  let claimed = false;
  let highlighted = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function later(fn) {
    try { if (typeof requestAnimationFrame === "function") { requestAnimationFrame(fn); return; } } catch {}
    try { setTimeout(fn, 0); } catch { fn(); }
  }
  // The workspace header carries the truth about a selected project. Reading it
  // keeps the guide away from every project-writing host API.
  function projectReady() {
    const label = document.getElementById("workspace-project-name")?.textContent?.trim() || "";
    if (!label) return false;
    return !/^(Your workspace|Opening your project|Loading|Desktop app)/.test(label);
  }
  function isDone(index) {
    if (state.done[index]) return true;
    return index === 0 && projectReady();
  }
  const doneCount = () => lessons.filter((_, index) => isDone(index)).length;
  function renderInvitation() {
    const card = $("invitation");
    if (!card) return;
    const active = state.status === "reading";
    card.hidden = state.status === "dismissed" || state.status === "complete";
    $("invite-title").textContent = active ? "Your place is saved. Pick the setup back up any time." : "Set up your first project together.";
    $("invite-open").textContent = active ? `Open the guide · ${doneCount()} of ${lessons.length} done` : "Start walkthrough";
    const walk = $("invite-walk");
    if (walk) walk.textContent = active ? `Walk with me · ${lessons[state.step].short}` : "Walk me through it";
    const trail = $("invite-steps");
    if (trail) trail.replaceChildren(...lessons.map((lesson, index) => {
      const done = isDone(index);
      const item = node("span", `walkthrough-setup-item${done ? " done" : ""}`, `${done ? "✓ " : ""}${lesson.short}`);
      if (index === state.step && state.status !== "complete") item.setAttribute("aria-current", "step");
      return item;
    }));
  }
  function render() {
    const lesson = lessons[state.step];
    $("progress").textContent = `Step ${state.step + 1} of ${lessons.length}`;
    $("title").textContent = lesson.title;
    $("copy").textContent = lesson.copy;
    $("points").replaceChildren(...lesson.points.map((text) => node("li", "", text)));
    if ($("build-mode")) $("build-mode").hidden = ![0, 2].includes(state.step);
    renderBuildMode();
    $("note").textContent = lesson.note;
    $("action").textContent = lesson.action;
    $("secondary").hidden = !lesson.secondary;
    $("secondary").textContent = lesson.secondary || "";
    $("back").disabled = state.step === 0;
    $("next").textContent = state.step === lessons.length - 1 ? "Finish guide" : "Next step";
    const steps = lessons.map((item, index) => {
      const button = node("button", `walkthrough-step${isDone(index) ? " done" : ""}`, `${isDone(index) ? "✓ " : ""}${index + 1}. ${item.short}`);
      button.type = "button";
      button.setAttribute("aria-current", index === state.step ? "step" : "false");
      button.addEventListener("click", () => move(index));
      return button;
    });
    $("steps").replaceChildren(...steps);
    renderInvitation();
  }
  function renderBuildMode() {
    const mode = window.MefiWorkspace?.buildMode?.();
    if (!$("auto-build")) return;
    $("auto-build").checked = mode?.autoBuild !== false;
    $("auto-build").disabled = !mode?.loaded || mode.saving;
    $("build-mode-label").textContent = mode?.saving ? "Saving…" : !mode?.loaded ? "Available in the desktop workspace" : mode.autoBuild ? "Automatic" : "Verify first";
    $("build-mode-note").textContent = mode?.autoBuild === false
      ? "Unapproved work waits in Review. Open a task to review its scope and approve its build. This choice is saved for all projects."
      : "Queued work can start automatically. Turn off to choose which tasks get built. You can change this above Your work at any time.";
  }
  function renderCoach() {
    if (!$("coach")) return;
    const lesson = lessons[state.step];
    const done = isDone(state.step);
    $("coach-progress").textContent = `Step ${state.step + 1} of ${lessons.length} · ${lesson.short}`;
    $("coach-title").textContent = lesson.title;
    $("coach-copy").textContent = lesson.station || lesson.copy;
    $("coach-hint").textContent = done
      ? `${lesson.done} ✓ — press the button when you are ready for the next stop.`
      : lesson.waitFor
        ? "I will tick this off the moment it is done. Take your time."
        : "I stay out of your way here; press the button when you are ready.";
    $("coach-next").textContent = state.step === lessons.length - 1 ? "Finish the tour" : done ? "Next stop" : "Done — next stop";
    $("coach-back").disabled = state.step === 0;
    $("coach").hidden = false;
  }
  function clearHighlight() {
    if (!highlighted) return;
    try { highlighted.classList?.remove?.("walkthrough-focus"); } catch {}
    highlighted = null;
  }
  function highlight(selector) {
    clearHighlight();
    if (!selector) return null;
    const target = document.querySelector(selector);
    if (!target) return null;
    try { target.classList?.add?.("walkthrough-focus"); } catch {}
    highlighted = target;
    try { target.scrollIntoView?.({ block: "center", inline: "nearest" }); } catch {}
    return target;
  }
  function claimLayer() {
    if (claimed) return;
    claimed = true;
    window.MefiNav?.claim?.("onboarding");
  }
  function releaseLayer() {
    if (!claimed) return;
    claimed = false;
    window.MefiNav?.release?.("onboarding");
  }
  function move(index) {
    state = { ...state, step: Math.max(0, Math.min(lessons.length - 1, index)), status: "reading" };
    save(); render(); $("title").focus();
  }
  function open() {
    init();
    const overlay = $("overlay");
    if (!overlay) return;
    state = { ...state, status: "reading", mode: "sheet" };
    save(); render();
    const coachEl = $("coach");
    if (coachEl) coachEl.hidden = true;
    clearHighlight();
    overlay.hidden = false;
    claimLayer();
  }
  function close() {
    const overlay = $("overlay");
    if (!overlay) return;
    const coachEl = $("coach");
    if (overlay.hidden && (!coachEl || coachEl.hidden)) return;
    overlay.hidden = true;
    if (coachEl) coachEl.hidden = true;
    clearHighlight();
    state = { ...state, mode: "idle" };
    save(); releaseLayer(); renderInvitation();
  }
  // Safe destinations: navigation and highlighting only. Nothing is submitted,
  // approved or started from a lesson.
  function routeTo(lesson) {
    const route = lesson.route;
    if (["project", "task", "review"].includes(route)) {
      window.MefiNav?.go?.("workspace");
      if (route === "task") {
        document.getElementById("workspace-mode-work")?.click();
        document.getElementById("workspace-input")?.focus?.();
      } else if (route === "review") {
        const review = document.getElementById("workspace-review");
        review?.click(); review?.focus?.();
      }
    } else window.MefiNav?.go?.(route);
    if (lesson.menu) window.MefiSidebar?.open?.();
    highlight(lesson.target);
    if (route === "project") document.getElementById("workspace-add-project")?.focus?.();
    const at = state.step;
    later(() => {
      if (state.mode !== "coach" || state.step !== at) return;
      if (lesson.menu) window.MefiSidebar?.open?.();
      highlight(lesson.target);
    });
  }
  function visit(route) {
    close();
    if (["project", "task", "review"].includes(route)) {
      window.MefiNav?.go?.("workspace");
      if (route === "task") {
        document.getElementById("workspace-mode-work")?.click();
        document.getElementById("workspace-input")?.focus();
      } else if (route === "review") {
        const review = document.getElementById("workspace-review");
        review?.click(); review?.focus();
      } else document.getElementById("workspace-add-project")?.focus();
    } else window.MefiNav?.go?.(route);
  }
  function coach(index, options = {}) {
    init();
    if (!$("coach") || !$("overlay")) return;
    state = { ...state, step: Math.max(0, Math.min(lessons.length - 1, index)), status: "reading", mode: "coach" };
    save();
    $("overlay").hidden = true;
    releaseLayer();
    renderCoach(); renderInvitation();
    if (options.navigate !== false) routeTo(lessons[state.step]);
  }
  function advance() {
    state.done[state.step] = true;
    if (state.step >= lessons.length - 1) { state.status = "complete"; close(); return; }
    coach(state.step + 1);
  }
  function projectChanged(event) {
    if (!event?.detail?.projectId || isDone(0)) return;
    state.done[0] = true;
    save();
    if (state.mode === "coach") renderCoach();
    if (state.mode === "sheet" && $("overlay") && !$("overlay").hidden) render();
    renderInvitation();
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("auto-build")?.addEventListener("change", async () => {
      try {
        const result = await window.MefiWorkspace.setAutoBuild($("auto-build").checked);
        $("build-mode-feedback").textContent = result.message;
      } catch (error) { $("build-mode-feedback").textContent = error.message; }
      renderBuildMode();
    });
    window.addEventListener("mefi:build-mode", renderBuildMode);
    window.addEventListener("mefi:project-changed", projectChanged);
    window.addEventListener("mefi:nav", () => {
      if (state.mode !== "coach") return;
      const at = state.step;
      later(() => { if (state.mode === "coach" && state.step === at) highlight(lessons[at].target); });
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || state.mode !== "coach") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      event.preventDefault?.(); event.stopPropagation?.();
      close();
    }, true);
    $("coach-next")?.addEventListener("click", () => advance());
    $("coach-back")?.addEventListener("click", () => coach(state.step - 1));
    $("coach-guide")?.addEventListener("click", () => open());
    $("coach-end")?.addEventListener("click", () => close());
    $("invite-walk")?.addEventListener("click", () => coach(state.status === "new" ? 0 : state.step));
    $("back").addEventListener("click", () => move(state.step - 1));
    $("next").addEventListener("click", () => {
      if (state.step < lessons.length - 1) return move(state.step + 1);
      state.status = "complete"; save(); close();
    });
    $("action").addEventListener("click", () => coach(state.step));
    $("secondary").addEventListener("click", () => visit(lessons[state.step].secondaryRoute));
    $("dismiss").addEventListener("click", () => {
      state.status = "dismissed"; save();
      close();
      renderInvitation();
      document.querySelector('[data-nav="onboarding"]')?.focus();
    });
    $("overlay").addEventListener("click", (event) => { if (event.target === $("overlay")) close(); });
    $("overlay").addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from($("sheet").querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]')).filter((item) => !item.hidden && !item.closest("[hidden]"));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first?.focus(); }
    });
    renderInvitation();
  }
  function startup({ automatic = true } = {}) {
    init();
    // Only a fresh guide opens itself. Save 'reading' before displaying it so
    // closing, following a lesson link or reloading never restarts the tour.
    // Capture/smoke callers can initialize the controls without consuming it.
    if (!automatic || state.status !== "new" || !$("overlay")) return false;
    open();
    return true;
  }
  window.MefiOnboarding = { init, startup, open, close, coach };
})();
