// A local, resumable guide. Reading a lesson never changes a project or runs work.
// The first stop links an AI (the scan) and, from then on, that AI helps with
// the rest of the setup: after "Use this setup and continue" the guide maps
// the selected folder, asks the linked model to plan the remaining stops, and
// shows the plan beside each one, with a progress bar for the setup and an
// activity bar for anything that takes time. Only the scan, map and assistant
// buttons (and the chain they start) reach the host; the scan saves nothing
// until "Use this setup", the map saves ideas, never tasks, and the assistant
// only writes advice. "Walk with me" keeps a small coach in the corner while
// it navigates the real menus with the user and ticks each stop off.
(function () {
  "use strict";
  const KEY = "mefiStudio.walkthrough.v2";
  const LEGACY_KEY = "mefiStudio.walkthrough.v1";
  const VERSION = 2;
  const MODES = ["idle", "sheet", "coach"];
  const SCAN = 0, WORKSPACE = 1, MAP = 2, CONNECT = 3, CREATE = 4, MONITOR = 5, REVIEW = 6;
  const BUILD_MODE_STEPS = [WORKSPACE, CREATE];
  // v1 lesson index → v2 lesson index (the scan and the map are new stops).
  const LEGACY_STEPS = [WORKSPACE, CONNECT, CREATE, MONITOR, REVIEW];
  const SCAN_STEPS = ["locate", "version", "auth", "models", "verbose", "agents"];
  const SCAN_STEP_LABELS = { locate: "finding OpenCode", version: "reading its version", auth: "linked providers", models: "models", verbose: "free models", agents: "agents" };
  const ADVICE_STOPS = [["workspace", WORKSPACE], ["map", MAP], ["connections", CONNECT], ["create", CREATE], ["monitor", MONITOR], ["review", REVIEW]];
  // Subscription CLIs that sign in with their own account (cli-setup.cjs).
  const SUBSCRIPTIONS = ["codex", "claude", "grok", "antigravity"];
  const $ = (id) => document.getElementById(`walkthrough-${id}`);
  const lessons = [
    {
      title: "Link an AI and scan this computer", short: "Scan", glyph: "g-ambience", panel: "scan",
      copy: "Start with the account you already use. Codex, Claude Code, Grok or Antigravity can power your studio through its own login. Install a missing tool here, use an API key (z.ai, OpenRouter, OpenCode Go or Zen, or your own endpoint) or a local model server such as LM Studio, or scan for OpenCode's linked and free models.",
      points: ["The scan asks OpenCode for its version, its linked provider names, its model list and its agents. It never opens the credential store, never sends a prompt and never changes OpenCode's own configuration.", "Free models cost nothing and are used first for exploring; paid plans you have linked are kept for building. Free-tier models may use prompts to improve the model, so keep confidential work on a paid model.", "Nothing is saved until you choose Use this setup and continue. From there the guide maps your selected folder and asks the linked AI to plan the remaining stops. You can run this scan again from Start here, or Auto setup from Agents setup, after linking a provider."],
      action: null, note: "Run the first scan reads OpenCode's own answers. Use this setup and continue saves the choices shown (no key), maps the selected folder, and asks the linked AI what to do next.",
      done: "Setup saved",
    },
    {
      title: "Welcome to Mefi's Studio", short: "Your workspace", glyph: "g-explorer",
      copy: "Turn an idea into a checked result: talk it through, create a task or plan, follow the work, then review what changed. This guide shows you where to do each step, and can walk the menus with you.",
      points: ["Start with Projects: the M+ at the top of the menu on the left. Use + to add an existing folder, then select it. Check the project name above the conversation before adding work.", "Choose how builds start below. Auto build is on by default. Turn it off for Verify first: inspect each task, then approve the ones you want built.", "Each project keeps its own tasks, plans, conversation and results. Your project files stay in their folder; Studio keeps its history separately."],
      action: "Walk me to my projects", route: "project",
      station: "I opened the project menu with you and highlighted +. Add an existing folder, then select it. I tick this off the moment you are in a project.",
      note: "This opens the workspace and the project menu with you. It does not change your selected project. With a setup saved, selecting a folder here starts its map.",
      target: "#workspace-add-project", menu: true, waitFor: "mefi:project-changed", done: "Project selected",
    },
    {
      title: "Map the folder", short: "First map", glyph: "g-explorer", panel: "map",
      copy: "Let a read-only explorer lay out the node tree for the selected folder: what the project is, where its parts live, how it is checked, and what small work could start first.",
      points: ["Your selected provider maps a bounded local inventory and project excerpts without native editing tools. OpenCode's built-in plan explorer is also available when its scan has selected a model.", "Suggested first tasks are saved as ideas in Your work. OpenCode sessions also show a live todo list in the tree.", "Mapping uses your selected account's allowance. It can take a few minutes. Cancel at any point; a cancelled map saves nothing."],
      action: null, note: "Map this project starts one explorer session in the selected folder. Ideas can be promoted to tasks later, one by one.",
      waitFor: "mefi:first-map", done: "Folder mapped",
    },
    {
      title: "Connect the assistant and coding workers", short: "Connections", glyph: "g-ambience",
      copy: "The assistant helps you think and organize. Coding workers carry out tasks in your project. Their provider settings are separate, and the scan's choices are shown at the top of Agents setup.",
      points: ["In Agents › Setup › Connections › Providers, save the key for the assistant provider you want, choose Grok, Claude Code, Codex or Antigravity with their own CLI logins, or point the custom route at your own OpenAI-compatible endpoint.", "LM Studio needs no key: keep its local server running and pick it as the provider.", "Models are saved per provider: set the model you have for each option and switching never mixes them.", "Coding workers run through the builder CLI your setup chose: the subscription tool you connected, or OpenCode on your linked plan or the free model the scan found. Agents › Setup › Team shows which one. The coding tier decides what each build may cost — Free, Fast or Heavy — while Auto lets Studio pick per task. Saving an assistant key alone does not prove a worker is ready.", "Manual planning works without an AI key. Jev is optional; without it the assistant's own model, or a free model, stands in for the small routing decisions."],
      action: "Walk me to connections", route: "studio", params: { section: "settings-assistant" },
      station: "We are in Agents › Setup › Providers. Save the key you want, then open Agents › Setup › Team & models to confirm the CLI and pick a coding tier. Nothing is sent until you choose to test it.",
      note: "Connection tests and AI requests may use your provider allowance when you explicitly run them.",
      target: "#settings-assistant-heading", done: "Connections checked",
    },
    {
      title: "Give a clear task, or explore a plan", short: "Create", glyph: "g-tasks",
      copy: "Use Create task when the outcome is clear. Use Plan an idea when you need to settle questions before anything is built. The map's ideas, and the assistant's suggested first task, are good places to start.",
      points: ["Chat is for questions and discussion. Create task saves work in the selected project, and Use a task outline helps you describe the result and its checks.", "Start small: for example, ‘Add a Create note button to the empty notes list; check that it opens a new note.’ Say what should stay unchanged, too.", "Plan an idea collects questions and decisions. Review and approve the specification, then explicitly create its tasks.", "With Verify first, View task lets you inspect the brief and Approve build, or leave it waiting. New work also follows your Pause and worker settings."],
      action: "Walk me to the task box", route: "task", secondary: "Explore a plan", secondaryRoute: "plans",
      station: "This is the task box for the selected project. Describe the result and how you will check it, or open Use a task outline for a guided shape. I do not send anything from here.",
      // Vibe (the default) hides Build's workspace, so the walk uses its box.
      vibeStation: "This is Vibe's box for the selected project. Describe the result and how you will check it, then choose Build it to save it as a task, or Talk it over to discuss it first. I do not send anything from here.",
      note: "These buttons open the editor and the plan sheet. They do not submit a task or start a planning request.",
      target: "#workspace-input", vibeTarget: "#vibe-input", done: "Task box found",
    },
    {
      title: "Follow the queue and current work", short: "Monitor", glyph: "g-command",
      copy: "Your work is the everyday queue. Command's node tree shows live workers, their current step and what is waiting to run.",
      points: ["Your work separates the queue, saved ideas, Review and Done. Open any task for its brief, prerequisites, history and result.", "In Command view, Live work shows running workers and their reported steps. Click Ready, Waiting or Needs attention to see the matching tasks and their reasons.", "Work through backlog starts existing work and admits saved ideas gradually. Pause stops new scheduling while current workers finish; let them finish before switching projects.", "Free workers run one at a time and take longer than a paid model. A prerequisite must finish before dependent work starts. Read connection, retry and file-conflict messages before adding more work."],
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
      vibeStation: "This is Tasks in Vibe. Open a task under Done to read the result and evidence, then run any remaining acceptance checks. Work that needs attention waits under Needs you with its reason.",
      note: "You can reopen this guide from Start here at the foot of the menu, or from Settings or Shortcuts. Completing the guide does not mark any task done.",
      target: "#workspace-review", vibeTarget: "#vibe-panel", done: "Review found",
    },
  ];
  const blankDone = () => lessons.map(() => false);
  const clampStep = (value) => Number.isInteger(value) ? Math.max(0, Math.min(lessons.length - 1, value)) : 0;
  function normalize(value) {
    return {
      version: VERSION,
      step: clampStep(value?.step),
      status: ["new", "reading", "dismissed", "complete"].includes(value?.status) ? value.status : "new",
      mode: MODES.includes(value?.mode) ? value.mode : "idle",
      done: blankDone().map((_, index) => Boolean(value?.done?.[index])),
    };
  }
  // A v1 guide keeps its ticks under the new numbering. A finished or dismissed
  // v1 guide comes back as an invitation (never as an automatic reopen) so the
  // new stops are offered once.
  function migrate(legacy) {
    const done = blankDone();
    (Array.isArray(legacy?.done) ? legacy.done : []).forEach((value, index) => { if (value && LEGACY_STEPS[index] !== undefined) done[LEGACY_STEPS[index]] = true; });
    const status = ["complete", "dismissed"].includes(legacy?.status) ? "reading" : legacy?.status;
    const step = ["complete", "dismissed"].includes(legacy?.status) ? SCAN : LEGACY_STEPS[Number.isInteger(legacy?.step) ? legacy.step : 0] ?? SCAN;
    return normalize({ step, status, mode: "idle", done });
  }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY));
      if (value?.version === VERSION) return normalize(value);
    } catch {}
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy?.version === 1) return migrate(legacy);
    } catch {}
    return normalize(null);
  }
  let state = read();
  let initialized = false;
  let claimed = false;
  let highlighted = null;
  let scanResult = null;
  let scanBusy = false;
  let scanSynced = false;
  let scanStarted = false;
  let mapResult = null;
  let mapBusy = false;
  let mapStartedAt = 0;
  const mapSteps = [];
  let assistResult = null;
  let assistBusy = false;
  let cliSetupState = null;
  let cliSetupFlight = null;
  let cliSetupBusy = false;
  // A setup window launched from here is still open: Studio regaining focus
  // is the cue to look for the newly installed tool again.
  let cliWindowOpen = false;
  // The person left Scan or First map to save a key or pick a local server:
  // a usable connection (or Back to the scan) brings them back to a fresh scan.
  let keyReturn = false;
  const checkedClis = new Set();
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
  // The only doors to the host. A missing bridge (browser preview, capture,
  // an older desktop build) leaves the panels explaining themselves instead of
  // throwing; reading and navigating never reach these.
  function hostApi(name) {
    try {
      const api = window.mefiStudio;
      const fn = api?.[name];
      return typeof fn === "function" ? (...args) => fn.apply(api, args) : null;
    } catch { return null; }
  }
  // The workspace's active project id is the truth about a selected project;
  // its header text is only a fallback where the workspace is absent (its
  // no-project wording has changed before). Reading either keeps the guide
  // away from every project-writing host API.
  function projectReady() {
    const workspace = window.MefiWorkspace;
    if (typeof workspace?.activeProjectId === "function") {
      try { return Boolean(workspace.activeProjectId()); } catch { return false; }
    }
    const label = document.getElementById("workspace-project-name")?.textContent?.trim() || "";
    if (!label || label === "Workspace") return false;
    return !/^(Your workspace|Opening your project|Loading|Desktop app)/.test(label);
  }
  // Vibe (the default mode) hides Build's workspace: go("workspace") lands
  // on Vibe, so the Create and Review stops point at Vibe's own controls.
  const vibeMode = () => { try { return window.MefiVibe?.mode?.() === "vibe"; } catch { return false; } };
  const targetOf = (lesson) => (vibeMode() && lesson.vibeTarget) || lesson.target;
  const stationOf = (lesson) => (vibeMode() && lesson.vibeStation) || lesson.station || lesson.copy;
  function isDone(index) {
    if (state.done[index]) return true;
    return index === WORKSPACE && projectReady();
  }
  const doneCount = () => lessons.filter((_, index) => isDone(index)).length;
  const setupSaved = () => state.done[SCAN] || Boolean(scanResult?.ok && scanResult.applied);
  // ---- progress -----------------------------------------------------------------------
  function fill(element, fraction) {
    if (!element) return;
    const style = element.style || (element.style = {});
    style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  }
  function renderBars() {
    const done = doneCount();
    for (const [bar, fillId] of [["bar", "bar-fill"], ["invite-bar", "invite-bar-fill"]]) {
      $(bar)?.setAttribute?.("aria-valuenow", String(done));
      $(bar)?.setAttribute?.("aria-valuemax", String(lessons.length));
      fill($(fillId), done / lessons.length);
    }
  }
  function setActivity(active, { label = "", fraction = null } = {}) {
    window.MefiCompanionHub?.guide({ step: state.step, coach: state.mode === "coach", done: isDone(state.step), busy: active });
    const box = $("activity");
    if (!box) return;
    box.hidden = !active;
    fill($("activity-fill"), !active ? 0 : fraction == null ? 0.4 : fraction);
    try { box.classList?.[active && fraction == null ? "add" : "remove"]?.("busy"); } catch {}
    if ($("activity-label")) $("activity-label").textContent = label;
  }
  const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  function renderInvitation() {
    const card = $("invitation");
    if (!card) return;
    const active = state.status === "reading";
    card.hidden = state.status === "dismissed" || state.status === "complete";
    $("invite-title").textContent = active ? "Your place is saved. Pick the setup back up any time." : "Set up your first project together.";
    $("invite-open").textContent = active ? `Open the guide · ${doneCount()} of ${lessons.length} done` : "Start here";
    const walk = $("invite-walk");
    if (walk) walk.textContent = active ? `Walk with me · ${lessons[state.step].short}` : "Walk me through it";
    const trail = $("invite-steps");
    if (trail) trail.replaceChildren(...lessons.map((lesson, index) => {
      const done = isDone(index);
      const item = node("span", `walkthrough-setup-item${done ? " done" : ""}`, `${done ? "✓ " : ""}${lesson.short}`);
      if (index === state.step && state.status !== "complete") item.setAttribute("aria-current", "step");
      return item;
    }));
    renderBars();
  }
  function render() {
    window.MefiCompanionHub?.guide({ step: state.step, done: isDone(state.step), busy: scanBusy || mapBusy || assistBusy });
    const lesson = lessons[state.step];
    // The bar under this line counts finished lessons, so the line names both.
    const finished = doneCount();
    $("progress").textContent = `Step ${state.step + 1} of ${lessons.length}${finished ? ` · ${finished} done` : ""}`;
    $("title").textContent = lesson.title;
    $("copy").textContent = lesson.copy;
    $("points").replaceChildren(...lesson.points.map((text) => node("li", "", text)));
    if ($("build-mode")) $("build-mode").hidden = !BUILD_MODE_STEPS.includes(state.step);
    renderBuildMode();
    $("note").textContent = lesson.note;
    $("action").hidden = !lesson.action;
    $("action").textContent = lesson.action || "";
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
    if (!scanBusy && !mapBusy && !assistBusy) setActivity(false);
    renderScan();
    renderMap();
    renderCliSetup();
    renderAssist();
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
      : "Queued work can start automatically. Turn off to choose which tasks get built. You can change this in Agents › Setup › Run behavior at any time.";
  }
  // ---- the scan stop ----------------------------------------------------------------
  function setPanelStatus(id, text, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = text;
    try { target.classList?.[error ? "add" : "remove"]?.("error"); } catch {}
  }
  const allowFree = () => $("scan-allow-free")?.checked !== false;
  function renderCliSetup() {
    const panel = $("cli-setup");
    if (!panel) return;
    panel.hidden = ![SCAN, MAP].includes(state.step);
    if (panel.hidden) return;
    if (!cliSetupState && !cliSetupFlight) void refreshCliSetup();
    const id = $("cli-choice")?.value || "codex";
    const cli = cliSetupState?.clis?.find((item) => item.id === id);
    const busy = cliSetupBusy || scanBusy || mapBusy;
    if ($("cli-choice")) $("cli-choice").disabled = busy;
    for (const action of ["install", "login", "check", "use", "refresh", "docs", "keys"]) if ($(`cli-${action}`)) $(`cli-${action}`).disabled = busy;
    if ($("cli-install")) $("cli-install").textContent = cli?.installed ? "Update and sign in" : "Install and sign in";
    if ($("cli-login")) $("cli-login").disabled = busy || !cli?.installed;
    if ($("cli-check")) { $("cli-check").disabled = busy || !cli?.installed; $("cli-check").textContent = id === "opencode" ? "Scan OpenCode" : "Check connection"; }
    if ($("cli-use")) { $("cli-use").textContent = id === "opencode" ? "Use scanned setup" : "Use for the whole studio"; $("cli-use").disabled = busy || !cli?.installed || (id === "opencode" ? !scanResult?.plan?.ok : !checkedClis.has(id)); }
    if ($("cli-detail")) $("cli-detail").textContent = !cli ? "Checking installed tools…" : id === "opencode" ? `${cli.installed ? "Installed." : "Not installed yet."} After sign-in, choose Scan OpenCode to discover its models, then Use scanned setup.` : checkedClis.has(id) ? `${cli.name} answered the connection check. Ready to use.` : `${cli.installed ? "Installed" : "Not installed yet"}. ${cli.installed ? "Sign in if needed, then choose Check connection." : "Choose Install and sign in to get started."}`;
  }
  // Callers arriving while a detection runs share it instead of starting a
  // second host read.
  function refreshCliSetup() {
    if (cliSetupFlight) return cliSetupFlight;
    const fn = hostApi("cliSetupStatus");
    if (!fn) { cliSetupState = { clis: [] }; setPanelStatus("cli-status", "Guided installation is available in the desktop app."); return Promise.resolve(); }
    cliSetupFlight = (async () => {
      try {
        const result = await fn();
        if (!result?.ok) throw new Error(result?.error || "Could not check installed tools.");
        const first = !cliSetupState;
        cliSetupState = result;
        if (first && $("cli-choice")) $("cli-choice").value = result.clis?.find((cli) => cli.id === result.selected && cli.installed)?.id || result.clis?.find((cli) => cli.installed)?.id || "codex";
      } catch (error) { cliSetupState = { clis: [] }; setPanelStatus("cli-status", error.message, true); }
    })().finally(() => { cliSetupFlight = null; renderCliSetup(); });
    return cliSetupFlight;
  }
  // The host pushes a closed setup window after re-reading PATH (and the
  // window regaining focus stands in where it cannot): detect the tools again
  // so Sign in and Check connection come alive without a manual refresh.
  async function setupWindowClosed(detail = {}) {
    cliWindowOpen = false;
    // A detection that began before the window closed may predate the
    // install: let it land, then read again.
    if (cliSetupFlight) await cliSetupFlight;
    await refreshCliSetup();
    const cli = cliSetupState?.clis?.find((item) => item.id === (detail?.id || $("cli-choice")?.value));
    if (!cli) return;
    setPanelStatus("cli-status", cli.installed
      ? `${cli.name} is installed. Choose ${cli.id === "opencode" ? "Scan OpenCode" : "Check connection"} next.`
      : `${cli.name} is not detected yet. If its setup finished, choose Refresh installed tools; otherwise run Install and sign in again.`);
  }
  async function cliSetupAction(action) {
    if (cliSetupBusy || mapBusy || scanBusy) return;
    const id = $("cli-choice")?.value || "codex";
    if (id === "opencode" && action === "check") { await runScan(); return; }
    if (id === "opencode" && action === "use") { await applyScan(); return; }
    const fn = hostApi(action === "use" ? "cliSetupUse" : action === "check" ? "cliSetupCheck" : "cliSetupAction");
    if (!fn) { setPanelStatus("cli-status", "Open the desktop app to set up a coding tool."); return; }
    cliSetupBusy = true; renderCliSetup();
    setPanelStatus("cli-status", action === "check" ? "Checking your connection… this can take up to a minute." : action === "use" ? "Connecting the studio to your subscription…" : "Opening setup…");
    try {
      const result = await fn(["use", "check"].includes(action) ? id : { id, action });
      if (!result?.ok) { if (action === "check") checkedClis.delete(id); throw new Error(result?.error || "Setup did not finish. Try again."); }
      if (action === "check") checkedClis.add(id);
      if (action === "install" || action === "login") { checkedClis.delete(id); cliWindowOpen = result.launched === true; }
      setPanelStatus("cli-status", result.message || "Setup instructions opened.");
      if (action === "use") {
        state.done[SCAN] = true; save(); scanResult = null; scanSynced = true;
        if (projectReady()) { move(MAP); void runMap(); } else move(WORKSPACE);
      }
    } catch (error) { setPanelStatus("cli-status", error.message, true); }
    finally { cliSetupBusy = false; renderCliSetup(); }
  }
  function scanFacts(plan, auto = null) {
    if (!plan) return [];
    if (SUBSCRIPTIONS.includes(auto?.active?.provider)) return [auto.summary, "Choose this tool above to check its login and use it for the whole studio. OpenCode is optional."];
    const facts = [];
    const cli = plan.opencode || {};
    if (cli.installed) {
      facts.push(`OpenCode ${cli.version || "(version unknown)"} found${cli.path ? ` at ${cli.path}` : ""}${cli.supported === false ? " — older than the supported 1.x line" : ""}.`);
      const linked = plan.providers?.linked || [];
      facts.push(linked.length ? `Linked in OpenCode: ${linked.join(", ")}.` : "No provider is linked in OpenCode yet.");
      const free = plan.providers?.free || {};
      const best = Array.isArray(free.models) ? free.models.find((model) => model.usable) : null;
      facts.push(free.count ? `${free.count} free model${free.count === 1 ? "" : "s"} available${best ? `, newest ${best.name || best.id}` : ""}.` : "No free model is available right now.");
      facts.push(`Explorer: ${plan.explorer?.model || "OpenCode's default model"} — ${plan.explorer?.reason || ""}`.trim());
      facts.push(`Builder: ${plan.builder?.model || "OpenCode's default model"} — ${plan.builder?.reason || ""}`.trim());
    } else {
      // OpenCode's explorer and builder lines only describe OpenCode; without
      // it they would read as the studio's only road.
      facts.push("OpenCode is not installed on this computer. It is optional: a subscription tool above, an API key or a local model server can run your studio instead.");
    }
    facts.push(`Judge: ${plan.judge?.kind || "fixed"} — ${plan.judge?.reason || ""}`.trim());
    // Auto setup's plan rides along with the scan: the assistant route and
    // builder CLI this machine's keys, CLIs and local servers already allow.
    if (auto?.ok) facts.push(`Auto setup: ${auto.summary || "a working route was found."}`);
    else if (auto?.error) facts.push(`Auto setup: ${auto.error}`);
    return facts;
  }
  function scanNotes(plan, auto = null) {
    if (!plan) return [];
    if (SUBSCRIPTIONS.includes(auto?.active?.provider)) return ["Every agent can use models available to this account. Choose provider defaults or save models per role in Agents setup."];
    return [
      ...(plan.warnings || []).map((text) => `Warning: ${text}`),
      ...(plan.nextSteps || []).map((text) => `Next: ${text}`),
      ...(plan.disclosures || []).map((text) => `Note: ${text}`),
      ...(auto?.ok ? (auto.notes || []).map((text) => `Setup: ${text}`) : []),
    ];
  }
  function renderScan() {
    const panel = $("scan");
    if (!panel) return;
    panel.hidden = state.step !== SCAN;
    if ($("scan-run")) $("scan-run").disabled = scanBusy;
    if ($("scan-apply")) { $("scan-apply").hidden = !(scanResult?.ok && scanResult.plan); $("scan-apply").disabled = scanBusy || cliSetupBusy || !(scanResult?.plan?.ok || scanResult?.autoSetup?.ok); }
    const plan = scanResult?.ok ? scanResult.plan : null;
    $("scan-facts")?.replaceChildren(...scanFacts(plan, scanResult?.autoSetup).map((text) => node("li", "", text)));
    $("scan-notes")?.replaceChildren(...scanNotes(plan, scanResult?.autoSetup).map((text) => node("li", "", text)));
    if (!panel.hidden && !scanSynced) syncScanStatus();
  }
  // A setup saved in an earlier session (or from Settings) counts; the guide
  // reads the host's record instead of trusting this device's storage.
  function syncScanStatus() {
    const fn = hostApi("firstRunStatus");
    scanSynced = true;
    if (!fn) return;
    Promise.resolve().then(() => fn()).then((status) => {
      if (!status?.firstRun) {
        // A fresh install's first launch ran auto setup by itself; the scan
        // adds OpenCode's free explorer and builder on top of that route.
        // A subscription tool still needs its login checked; a key or a local
        // server finishes through the scan's Use this setup.
        if (status?.autoSetup?.summary && !scanResult) setPanelStatus("scan-status", `Auto setup ran on first launch: ${status.autoSetup.summary} ${SUBSCRIPTIONS.includes(status.aiProvider) ? "Choose your tool above to check its connection and finish setup." : "Run the first scan, then choose Use this setup and continue to finish setup."}`);
        return;
      }
      if (!state.done[SCAN]) { state.done[SCAN] = true; save(); }
      if (!scanResult) setPanelStatus("scan-status", status.firstRun.explorer?.transport === "assistant" ? `Setup saved: ${status.firstRun.explorer.provider} handles your map, assistant and builders. You can use the map step now.` : `Setup saved${status.firstRun.appliedAt ? ` on ${new Date(status.firstRun.appliedAt).toLocaleDateString()}` : ""}: explorer ${status.firstRun.explorer?.model || "selected provider"}, builder ${status.firstRun.builder?.model || "selected provider"}, judge ${status.firstRun.judge?.kind || "fixed"}.`);
      render();
    }).catch(() => {});
  }
  function scanProgress(step) {
    const index = SCAN_STEPS.indexOf(step?.id);
    const at = index >= 0 ? index + 1 : 0;
    setActivity(true, { label: `Scanning · ${SCAN_STEP_LABELS[step?.id] || step?.id || "…"} (${at} of ${SCAN_STEPS.length})`, fraction: at / SCAN_STEPS.length });
  }
  async function runScan({ automatic = false } = {}) {
    const fn = hostApi("firstScan");
    if (!fn) { if (!automatic) setPanelStatus("scan-status", "The first scan runs in the desktop app. In this preview nothing is read.", true); return; }
    if (scanBusy) return;
    scanBusy = true; scanStarted = true; scanResult = null; renderScan(); renderCliSetup();
    setActivity(true, { label: "Scanning · asking OpenCode what it has (about ten seconds)", fraction: 0 });
    setPanelStatus("scan-status", "Scanning… asking OpenCode for its version, linked providers, models and agents.");
    try {
      const result = await fn({ prefs: { allowFreeTraining: allowFree() } });
      scanResult = result;
      if (!result?.ok) setPanelStatus("scan-status", result?.error || "The scan did not finish.", true);
      else if (result.plan?.ok) setPanelStatus("scan-status", "Scan complete. Review the facts below, then choose Use this setup and continue: it saves these choices (no key), maps your selected folder and asks the linked AI what to do next.");
      else if (result.autoSetup?.ok && SUBSCRIPTIONS.includes(result.autoSetup.active?.provider)) setPanelStatus("scan-status", `Scan complete. ${result.autoSetup.summary} Choose your installed tool above to use that subscription throughout the studio, including your first map.`);
      else if (result.autoSetup?.ok) setPanelStatus("scan-status", `Scan complete. ${result.autoSetup.summary} Choose Use this setup and continue: it saves this route, maps your selected folder and asks the linked AI what to do next.`);
      else setPanelStatus("scan-status", "Let's connect your first AI. Choose a tool above and Install and sign in, or choose I have an API key or a local model server. You can also continue the tour and connect it later.");
    } catch (error) {
      setPanelStatus("scan-status", error?.message || "The scan failed.", true);
    } finally {
      scanBusy = false; setActivity(false); renderScan(); renderCliSetup();
      if ($("cli-choice")?.value === "opencode") setPanelStatus("cli-status", $("scan-status")?.textContent || "Scan finished.", !scanResult?.ok);
    }
  }
  async function applyScan() {
    const fn = hostApi("firstScanApply");
    if (!fn || !scanResult?.ok) { setPanelStatus("scan-status", "Run the scan first.", true); return; }
    scanBusy = true; renderScan(); renderCliSetup();
    try {
      const result = await fn({ prefs: { allowFreeTraining: allowFree() } });
      if (!result?.ok) { setPanelStatus("scan-status", result?.error || "The setup could not be saved.", true); return; }
      state.done[SCAN] = true; save();
      scanResult = { ...scanResult, applied: true };
      setPanelStatus("scan-status", `Setup saved. ${result.summary || ""} ${(result.notes || []).join(" ")}`.trim());
      // The linked AI takes it from here: map the selected folder now, or wait
      // at the workspace stop for a folder and map it as soon as one is chosen.
      if (projectReady()) { move(MAP); void runMap({ automatic: true }); }
      else move(WORKSPACE);
    } catch (error) {
      setPanelStatus("scan-status", error?.message || "The setup could not be saved.", true);
    } finally {
      scanBusy = false; render();
    }
  }
  // ---- the map stop -----------------------------------------------------------------
  function renderMap() {
    const panel = $("map");
    if (!panel) return;
    panel.hidden = state.step !== MAP;
    if ($("map-run")) $("map-run").disabled = mapBusy;
    if ($("map-cancel")) $("map-cancel").hidden = !mapBusy;
    // Progress lines matter while the explorer runs and when it fails (they show how far it got); a finished map replaces them with facts.
    const showSteps = mapBusy || (mapResult && !mapResult.ok);
    $("map-steps")?.replaceChildren(...(showSteps ? mapSteps.slice(-12).map((text) => node("li", "", text)) : []));
    const tail = $("map-tail");
    if (tail) { const text = !mapBusy && mapResult && !mapResult.ok && mapResult.textTail ? String(mapResult.textTail).trim() : ""; tail.hidden = !text; tail.textContent = text ? `What the explorer wrote instead: ${text}` : ""; }
    const facts = [];
    if (mapResult?.ok) {
      facts.push(mapResult.summary || "Map saved.");
      if (mapResult.ideas) facts.push(`${mapResult.ideas.added} new idea${mapResult.ideas.added === 1 ? "" : "s"} saved to Your work${mapResult.ideas.updated ? `, ${mapResult.ideas.updated} updated` : ""}.`);
      if (mapResult.map?.summary) facts.push(mapResult.map.summary);
      for (const area of (mapResult.map?.areas || []).slice(0, 6)) facts.push(`${area.name}${area.path ? ` (${area.path})` : ""}: ${area.what || ""}`.trim());
    }
    $("map-facts")?.replaceChildren(...facts.map((text) => node("li", "", text)));
  }
  function mapAdvice(result) {
    const reason = result?.reason;
    if (reason === "free-tier-refused") return `${result.error} Choose a paid model in Settings, then map again.`;
    if (reason === "no-scan" || reason === "no-explorer" || reason === "no-opencode") return "Connect an AI right here to make your first map: choose a subscription tool and Install and sign in above, or choose I have an API key or a local model server. You can continue the tour while you set it up.";
    if (reason === "timeout") return `${result.error}`;
    if (reason === "unparsable") return `${result.error} Map again; a second pass usually answers in the requested shape.`;
    if (reason === "busy") return result.error;
    return result?.error || "The map did not finish.";
  }
  async function runMap({ automatic = false } = {}) {
    if (!projectReady()) { setPanelStatus("map-status", "Select a project first (the Your workspace stop), then map it.", true); return; }
    const fn = hostApi("firstMap");
    if (!fn) { if (!automatic) setPanelStatus("map-status", "The first map runs in the desktop app. In this preview nothing is read.", true); return; }
    if (mapBusy) return;
    mapBusy = true; mapResult = null; mapSteps.length = 0; mapStartedAt = Date.now(); renderMap();
    setActivity(true, { label: automatic ? "Mapping the folder you selected · the explorer is reading it" : "Mapping · the explorer is reading the folder" });
    setPanelStatus("map-status", `${automatic ? "The linked AI is mapping the folder you selected. " : ""}Your provider is preparing the map from the project scan. Suggestions will appear below.`);
    try {
      const result = await fn({});
      mapResult = result;
      if (result?.ok) {
        state.done[MAP] = true; save();
        setPanelStatus("map-status", `Folder mapped: ${result.summary || "map saved"}. Open Your work to review the ideas, or continue to Connections.`);
        try { if (typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("mefi:first-map", { detail: result })); } catch {}
      } else setPanelStatus("map-status", mapAdvice(result), true);
    } catch (error) {
      mapResult = { ok: false, error: error?.message || "The map failed." };
      setPanelStatus("map-status", mapResult.error, true);
    } finally {
      mapBusy = false; setActivity(false); render();
    }
    if (mapResult?.ok) void runAssist({ automatic: true });
  }
  function cancelMap() {
    const fn = hostApi("firstMapCancel");
    if (!fn || !mapBusy) return;
    setPanelStatus("map-status", "Cancelling the explorer…");
    Promise.resolve().then(() => fn()).catch(() => {});
  }
  function hostProgress(data) {
    if (!data) return;
    if (data.kind === "scan") { if (scanBusy) scanProgress(data.step); return; }
    if (data.kind !== "map") return;
    if (data.step && mapSteps[mapSteps.length - 1] !== data.step) mapSteps.push(data.step);
    if (mapSteps.length > 40) mapSteps.splice(0, mapSteps.length - 40);
    if (mapBusy) setActivity(true, { label: `Mapping · ${data.step || "reading the folder"}${data.tools ? ` · ${data.tools} read${data.tools === 1 ? "" : "s"}` : ""} · ${clock(Number(data.elapsedMs) || Date.now() - mapStartedAt)}` });
    if (state.step === MAP) renderMap();
  }
  // ---- the assistant --------------------------------------------------------------------
  function adviceLines() {
    const stops = assistResult?.advice?.stops || {};
    return ADVICE_STOPS.filter(([id]) => stops[id]).map(([id, index]) => ({ id, index, label: lessons[index].short, text: stops[id] }));
  }
  function renderAssist() {
    const panel = $("assist");
    if (!panel) return;
    panel.hidden = state.step === SCAN || !setupSaved();
    if ($("assist-run")) { $("assist-run").disabled = assistBusy; $("assist-run").textContent = assistResult ? "Ask again" : "Ask my assistant what to do next"; }
    if ($("assist-task")) $("assist-task").hidden = !assistResult?.advice?.firstTask;
    $("assist-list")?.replaceChildren(...adviceLines().map((line) => {
      const item = node("li", "", `${line.label}: ${line.text}`);
      if (line.index === state.step) item.setAttribute("aria-current", "step");
      return item;
    }));
  }
  function assistSource(result) {
    if (result?.via === "assistant") return `your assistant${result.model ? ` (${result.model})` : ""}`;
    if (result?.via === "opencode-free") return result.model || "the free explorer";
    return "the built-in guide";
  }
  async function runAssist({ automatic = false } = {}) {
    const fn = hostApi("firstAssist");
    if (!fn) { if (!automatic) setPanelStatus("assist-status", "The setup assistant runs in the desktop app.", true); return; }
    if (assistBusy) return;
    assistBusy = true; renderAssist();
    setActivity(true, { label: "Asking the linked AI to plan the rest of the setup" });
    setPanelStatus("assist-status", "Asking the linked AI what to do next…");
    try {
      const result = await fn({ progress: { done: state.done.slice(), step: state.step } });
      assistResult = result;
      if (!result?.ok) setPanelStatus("assist-status", result?.error || "The assistant did not answer.", true);
      else setPanelStatus("assist-status", `${result.advice?.summary || "Here is the plan for the remaining stops."} (From ${assistSource(result)}.)${result.warnings?.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (error) {
      assistResult = null;
      setPanelStatus("assist-status", error?.message || "The assistant did not answer.", true);
    } finally {
      assistBusy = false; setActivity(false); render();
    }
  }
  // Places the suggested brief in the task box and takes the user there. It
  // never submits: sending stays a deliberate click in the workspace.
  // The box is filled after the visit: switching Build's composer to Create
  // task swaps in that mode's draft, and in Vibe the box is Vibe's own. The
  // input event lets the owning surface save the draft and size the box.
  function placeSuggestedTask() {
    const task = assistResult?.advice?.firstTask;
    if (!task) return;
    const input = visit("task");
    if (!input) return;
    input.value = `${task.title}\n\n${task.brief || ""}`.trim();
    try { if (typeof Event === "function") input.dispatchEvent?.(new Event("input", { bubbles: true })); } catch {}
    input.focus?.();
  }
  // ---- coach --------------------------------------------------------------------------
  function renderCoach() {
    if (!$("coach")) return;
    window.MefiCompanionHub?.guide({ step: state.step, coach: true, done: isDone(state.step) });
    const lesson = lessons[state.step];
    const done = isDone(state.step);
    $("coach-progress").textContent = `Step ${state.step + 1} of ${lessons.length} · ${lesson.short}`;
    $("coach-title").textContent = lesson.title;
    $("coach-copy").textContent = stationOf(lesson);
    const returning = keyReturn && state.step === CONNECT;
    $("coach-hint").textContent = returning
      ? "Save your key here, or start LM Studio's server and choose LM Studio as the provider. A saved key brings you back to the scan; otherwise choose Back to the scan."
      : done
        ? `${lesson.done} ✓ — press the button when you are ready for the next stop.`
        : lesson.waitFor
          ? "I will tick this off the moment it is done. Take your time."
          : "I stay out of your way here; press the button when you are ready.";
    $("coach-next").textContent = returning ? "Back to the scan" : state.step === lessons.length - 1 ? "Finish the tour" : done ? "Next stop" : "Done — next stop";
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
    state = { ...state, step: clampStep(index), status: "reading" };
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
    // Closing the guide ends a detour to Connections: a later save must not
    // pull the guide back open.
    keyReturn = false;
    state = { ...state, mode: "idle" };
    save(); releaseLayer(); renderInvitation();
  }
  // Opens Home and reaches the task box or the review list, returning the
  // control it landed on. In Vibe mode Home is Vibe (Build's workspace stays
  // hidden), so the box is Vibe's own and review is Vibe's Tasks panel.
  function reachWorkspace(route) {
    window.MefiNav?.go?.("workspace");
    const vibe = vibeMode();
    if (route === "task") {
      if (!vibe) document.getElementById("workspace-mode-work")?.click();
      const input = document.getElementById(vibe ? "vibe-input" : "workspace-input") ?? null;
      input?.focus?.();
      return input;
    }
    if (route === "review") {
      if (vibe) {
        // The panel focuses its own first control once it has drawn.
        window.MefiVibe?.openPanel?.("tasks", { fold: "done" });
        return document.getElementById("vibe-panel") ?? null;
      }
      const review = document.getElementById("workspace-review") ?? null;
      review?.click(); review?.focus?.();
      return review;
    }
    return null;
  }
  // Safe destinations: navigation and highlighting only. Nothing is submitted,
  // approved or started from a lesson.
  // Returns the real control it focused, if any, so the coach knows whether it
  // still needs to hand focus to its own primary button.
  // The project, task and review stops live on Build's Home. In Vibe, Home is
  // Vibe and those controls are hidden, so the walk switches to Build first
  // (the mode switch on the rail goes back) rather than highlight nothing.
  function buildHome() {
    if (window.MefiVibe?.mode?.() !== "vibe" || typeof window.MefiVibe.setMode !== "function") return;
    window.MefiVibe.setMode("build", { go: false });
    window.MefiToast?.("The tour uses Build mode's Home. Switch back to Vibe any time from the menu.", "info");
  }
  function routeTo(lesson) {
    const route = lesson.route;
    let focused = null;
    if (["project", "task", "review"].includes(route)) { buildHome(); focused = reachWorkspace(route); }
    else window.MefiNav?.go?.(route, lesson.params);
    if (lesson.menu) window.MefiSidebar?.open?.();
    highlight(targetOf(lesson));
    if (route === "project") { focused = document.getElementById("workspace-add-project") ?? null; focused?.focus?.(); }
    const at = state.step;
    later(() => {
      if (state.mode !== "coach" || state.step !== at) return;
      if (lesson.menu) window.MefiSidebar?.open?.();
      highlight(targetOf(lesson));
    });
    return focused;
  }
  function visit(route) {
    close();
    if (["project", "task", "review"].includes(route)) buildHome();
    if (route === "project") {
      window.MefiNav?.go?.("workspace");
      const add = document.getElementById("workspace-add-project");
      add?.focus?.();
      return add ?? null;
    }
    if (["task", "review"].includes(route)) return reachWorkspace(route);
    window.MefiNav?.go?.(route);
    return null;
  }
  // A stop with a panel has no menu to walk to: the coach hands it back to the
  // sheet at that stop, where its button lives.
  function coach(index, options = {}) {
    init();
    const step = clampStep(index);
    if (step !== CONNECT) keyReturn = false;
    if (lessons[step].panel) {
      state = { ...state, step, status: "reading" };
      open();
      return;
    }
    if (!$("coach") || !$("overlay")) return;
    state = { ...state, step, status: "reading", mode: "coach" };
    save();
    $("overlay").hidden = true;
    releaseLayer();
    renderCoach(); renderInvitation();
    // The walk is keyboard-continuable: when the stop has a real control, focus
    // lands there (routeTo returns it); otherwise focus the coach's own Next so
    // the tour never strands focus on the hidden sheet behind it.
    const focused = options.navigate !== false ? routeTo(lessons[state.step]) : null;
    if (!focused) $("coach-next")?.focus?.();
  }
  function advance() {
    if (keyReturn && state.step === CONNECT) { returnToScan(); return; }
    state.done[state.step] = true;
    if (state.step >= lessons.length - 1) { state.status = "complete"; close(); return; }
    coach(state.step + 1);
  }
  // Keys and local model servers live in Connections, not in this panel: the
  // coach walks there, and a usable saved connection (or Back to the scan)
  // returns to the Scan stop and scans again, so auto setup can offer the
  // route that key or server allows before the first map.
  function keyPath() {
    coach(CONNECT);
    keyReturn = true;
    renderCoach();
  }
  function returnToScan() {
    keyReturn = false;
    open();
    move(SCAN);
    void runScan();
  }
  function connectionSaved(event) {
    // A cleared key, or one that leaves no working assistant route, is not a
    // connection (booklet.js reports routeOk; older builds leave it unset).
    if (event?.detail?.routeOk === false) return;
    tickStop(CONNECT);
    if (keyReturn) returnToScan();
  }
  function projectChanged(event) {
    if (!event?.detail?.projectId) return;
    if (!state.done[WORKSPACE]) {
      state.done[WORKSPACE] = true;
      save();
      if (state.mode === "coach") renderCoach();
      if (state.mode === "sheet" && $("overlay") && !$("overlay").hidden) render();
      renderInvitation();
    }
    // The guide was waiting at the workspace stop with a setup saved: the
    // linked AI maps the folder as soon as one is selected.
    if (state.mode === "sheet" && state.step === WORKSPACE && setupSaved() && !state.done[MAP] && $("overlay") && !$("overlay").hidden && projectReady()) {
      move(MAP);
      void runMap({ automatic: true });
    }
  }
  // Real user actions tick the matching stop off. The events are emitted only
  // after the underlying action succeeded, and ticking is idempotent: a repeat
  // never regresses a stop or duplicates progress.
  const REVIEW_STATES = ["done", "awaiting_verification", "archived"];
  function tickStop(index) {
    if (!lessons[index] || isDone(index)) return;
    state.done[index] = true;
    save();
    if (state.mode === "coach") renderCoach();
    if (state.mode === "sheet" && $("overlay") && !$("overlay").hidden) render();
    renderInvitation();
  }
  function taskOpened(event) {
    tickStop(MONITOR);
    const detail = event?.detail || {};
    if (detail.review === true || REVIEW_STATES.includes(detail.status)) tickStop(REVIEW);
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
    document.getElementById("settings-guided-cli")?.addEventListener("click", () => { open(); move(SCAN); });
    window.addEventListener("mefi:project-changed", projectChanged);
    window.addEventListener("mefi:connection-saved", connectionSaved);
    window.addEventListener("mefi:task-created", () => tickStop(CREATE));
    window.addEventListener("mefi:plan-created", () => tickStop(CREATE));
    window.addEventListener("mefi:task-opened", taskOpened);
    window.addEventListener("mefi:nav", () => {
      if (state.mode !== "coach") return;
      const at = state.step;
      later(() => { if (state.mode === "coach" && state.step === at) highlight(targetOf(lessons[at])); });
    });
    // Back from a setup window: the host's push is the cue; Studio regaining
    // focus stands in where that push never arrives (an older host).
    try { hostApi("onCliSetupClosed")?.((detail) => { void setupWindowClosed(detail); }); } catch {}
    window.addEventListener("focus", () => {
      if (!cliWindowOpen || $("overlay")?.hidden !== false || $("cli-setup")?.hidden !== false) return;
      void setupWindowClosed({});
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || state.mode !== "coach") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      // Escape inside a menu, picker, dialog or the sidebar (often one the
      // coach itself opened) closes that first; taking it here closed the
      // coach and left the menu open.
      if (event.target?.closest?.('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"], dialog, .studio-choice-popup, .ws-sidebar') && !$("coach")?.contains(event.target)) return;
      event.preventDefault?.(); event.stopPropagation?.();
      close();
    }, true);
    $("coach-next")?.addEventListener("click", () => advance());
    $("coach-back")?.addEventListener("click", () => coach(state.step - 1));
    $("coach-guide")?.addEventListener("click", () => open());
    $("coach-end")?.addEventListener("click", () => close());
    $("invite-walk")?.addEventListener("click", () => coach(state.status === "new" ? 0 : state.step));
    $("scan-run")?.addEventListener("click", () => { void runScan(); });
    $("scan-apply")?.addEventListener("click", () => { void applyScan(); });
    $("cli-choice")?.addEventListener("change", () => { setPanelStatus("cli-status", ""); renderCliSetup(); });
    $("cli-refresh")?.addEventListener("click", () => { void refreshCliSetup(); });
    $("cli-keys")?.addEventListener("click", () => keyPath());
    for (const action of ["install", "login", "check", "use", "docs"]) $("cli-" + action)?.addEventListener("click", () => {
      void cliSetupAction(action);
    });
    $("map-run")?.addEventListener("click", () => { void runMap(); });
    $("map-cancel")?.addEventListener("click", () => cancelMap());
    $("assist-run")?.addEventListener("click", () => { void runAssist(); });
    $("assist-task")?.addEventListener("click", () => placeSuggestedTask());
    try { hostApi("onFirstMapProgress")?.(hostProgress); } catch {}
    $("back").addEventListener("click", () => move(state.step - 1));
    $("next").addEventListener("click", () => {
      if (state.step < lessons.length - 1) return move(state.step + 1);
      state.status = "complete"; save(); close();
    });
    $("action").addEventListener("click", () => { if (lessons[state.step].action) coach(state.step); });
    $("secondary").addEventListener("click", () => visit(lessons[state.step].secondaryRoute));
    $("dismiss").addEventListener("click", () => {
      state.status = "dismissed"; save();
      close();
      renderInvitation();
      // The header button is hidden under the rail and in Vibe: focus a Start
      // here that can actually be seen.
      const starts = Array.from(document.querySelectorAll?.('[data-nav="onboarding"]') ?? []);
      (starts.find((item) => !item.hidden && !item.closest?.("[hidden], [inert]") && (item.getClientRects?.().length ?? 1) > 0) ?? starts[0])?.focus?.();
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
    // The setup helper runs first on a new profile. When it already connected
    // an AI, the scan stop is done: the tour starts at the workspace instead.
    if (window.MefiSetupHelper?.connected?.() === true && !state.done[SCAN]) {
      state.done[SCAN] = true;
      state.step = WORKSPACE;
    }
    open();
    // The first launch starts linking an AI by itself: the scan is read-only,
    // shows its progress, and still saves nothing until "Use this setup".
    if (!state.done[SCAN] && !scanStarted && hostApi("firstScan")) void runScan({ automatic: true });
    return true;
  }
  // status() lets other quiet prompts (the weekly community card) stay out of
  // the way while the guide is new or still being read.
  window.MefiOnboarding = { init, startup, open, close, coach, status: () => state.status, lessons: () => lessons.map((lesson) => ({ title: lesson.title, short: lesson.short, panel: lesson.panel || null })) };
})();
