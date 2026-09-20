// A local, resumable guide. Reading a lesson never changes a project or runs work.
(function () {
  "use strict";
  const KEY = "mefiStudio.walkthrough.v1";
  const VERSION = 1;
  const $ = (id) => document.getElementById(`walkthrough-${id}`);
  const lessons = [
    {
      title: "Welcome to Mefi's Studio", short: "Your workspace", glyph: "g-explorer",
      copy: "Turn an idea into a checked result: talk it through, create a task or plan, follow the work, then review what changed. This guide shows you where to do each step.",
      points: ["Start with Projects in the sidebar. Use + to add an existing folder, then select it. Check the project name above the conversation before adding work.", "Choose how builds start below. Auto build is on by default. Turn it off for Verify first: inspect each task, then approve the ones you want built.", "Each project keeps its own tasks, plans, conversation and results. Your project files stay in their folder; Studio keeps its history separately."],
      action: "Choose a project", route: "project", note: "This opens the workspace and focuses the project controls. It does not change your selected project.",
    },
    {
      title: "Connect the assistant and coding workers", short: "Connections", glyph: "g-ambience",
      copy: "The assistant helps you think and organize. Coding workers carry out tasks in your project. Their provider settings are separate.",
      points: ["In Settings & connections, save the key for the assistant provider you want, or choose Grok with its own CLI login.", "Choose the coding worker provider and ensure its CLI is installed and signed in. Saving an assistant key alone does not prove a worker is ready.", "Manual planning works without an AI key. Jev is optional; it advises on related work and does not replace your coding provider."],
      action: "Open connections", route: "studio", note: "Connection tests and AI requests may use your provider allowance when you explicitly run them.",
    },
    {
      title: "Give a clear task, or explore a plan", short: "Create", glyph: "g-tasks",
      copy: "Use Give a task when the outcome is clear. Use Plan an idea when you need to settle questions before anything is built.",
      points: ["Talk together is for questions and discussion. Give a task saves work in the selected project; Use a task outline helps you describe the result and checks.", "Start small: for example, ‘Add a Create note button to the empty notes list; check that it opens a new note.’ Say what should stay unchanged, too.", "Plan an idea collects questions and decisions. Review and approve the specification, then explicitly create its tasks.", "With Verify first, View task lets you inspect the brief and Approve build, or leave it waiting. New work also follows your Pause and worker settings."],
      action: "Prepare a task", route: "task", secondary: "Explore a plan", secondaryRoute: "plans", note: "These buttons open the editor. They do not submit a task or start a planning request.",
    },
    {
      title: "Follow the queue and current work", short: "Monitor", glyph: "g-command",
      copy: "Your work is the everyday queue. Command's node tree shows live workers, their current step and what is waiting to run.",
      points: ["Your work separates the queue, saved ideas, Review and Done. Open any task for its brief, prerequisites, history and result.", "In Node tree, Live work shows running workers and their reported steps. Click Ready, Waiting or Needs attention to see the matching tasks and their reasons.", "Work through backlog starts existing work and admits saved ideas gradually. Pause stops new scheduling while current workers finish; let them finish before switching projects.", "A prerequisite must finish before dependent work starts. Read connection, retry and file-conflict messages before adding more work."],
      action: "Open live work", route: "command", secondary: "Open task board", secondaryRoute: "tasks", note: "Follow in Command tracks active work. You can pan or select a task to take control of the view.",
    },
    {
      title: "Review results and recover deliberately", short: "Review", glyph: "g-eyes",
      copy: "A worker finishing is a result to inspect. Done should mean there is verification evidence, or you have explicitly confirmed the result yourself.",
      points: ["Open Review in Your work to read the result, evidence and next actions. Inspect the project changes and run any remaining acceptance checks.", "If work needs attention, read its reason first. Correct the connection, brief or prerequisite, then use its retry control when you are ready.", "Keep failed work available for diagnosis. Task history can recover an earlier brief; it does not roll back your project files."],
      action: "Open Review", route: "review", secondary: "Open task board", secondaryRoute: "tasks", note: "You can reopen this guide from Start here in the sidebar, Settings or Shortcuts. Completing the guide does not mark any task done.",
    },
  ];
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      if (value?.version === VERSION) return {
        version: VERSION,
        step: Number.isInteger(value.step) ? Math.max(0, Math.min(lessons.length - 1, value.step)) : 0,
        status: ["new", "reading", "dismissed", "complete"].includes(value.status) ? value.status : "new",
      };
    } catch {}
    return { version: VERSION, step: 0, status: "new" };
  }
  let state = read();
  let initialized = false;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function renderInvitation() {
    const card = $("invitation");
    if (!card) return;
    card.hidden = state.status === "dismissed" || state.status === "complete";
    $("invite-title").textContent = state.status === "reading" ? "Your next step is saved." : "A little guidance for your first project.";
    $("invite-open").textContent = state.status === "reading" ? `Continue guide · ${state.step + 1} of ${lessons.length}` : "Start walkthrough";
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
      const button = node("button", "walkthrough-step", `${index + 1}. ${item.short}`);
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
  function move(index) {
    state = { ...state, step: Math.max(0, Math.min(lessons.length - 1, index)), status: "reading" };
    save(); render(); $("title").focus();
  }
  function open() {
    init();
    if (!$("overlay") || !$("overlay").hidden) return;
    state.status = "reading";
    save(); render();
    $("overlay").hidden = false;
    window.MefiNav?.claim?.("onboarding");
  }
  function close() {
    if (!$("overlay") || $("overlay").hidden) return;
    $("overlay").hidden = true;
    save(); renderInvitation();
    window.MefiNav?.release?.("onboarding");
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
    $("back").addEventListener("click", () => move(state.step - 1));
    $("next").addEventListener("click", () => {
      if (state.step < lessons.length - 1) return move(state.step + 1);
      state.status = "complete"; save(); close();
    });
    $("action").addEventListener("click", () => visit(lessons[state.step].route));
    $("secondary").addEventListener("click", () => visit(lessons[state.step].secondaryRoute));
    $("dismiss").addEventListener("click", () => {
      state.status = "dismissed"; save(); renderInvitation();
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
  window.MefiOnboarding = { init, startup, open, close };
})();
