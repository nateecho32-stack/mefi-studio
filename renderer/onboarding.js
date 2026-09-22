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
  const $ = (id) => document.getElementById(`walkthrough-${id}`);
  const lessons = [
    {
      title: "Link an AI and scan this computer", short: "Scan", glyph: "g-ambience", panel: "scan",
      copy: "Before anything is read or built, find out what this computer already has: the OpenCode command line, the providers linked in it, the free models it can reach, and the keys saved in Studio. The AI chosen here helps with the rest of this setup.",
      points: ["The scan asks OpenCode for its version, its linked provider names, its model list and its agents. It never opens the credential store, never sends a prompt and never changes OpenCode's own configuration.", "Free models cost nothing and are used first for exploring; paid plans you have linked are kept for building. Free-tier models may use prompts to improve the model, so keep confidential work on a paid model.", "Nothing is saved until you choose Use this setup and continue. From there the guide maps your selected folder and asks the linked AI to plan the remaining stops. You can run the scan again from Settings & connections after linking a provider."],
      action: null, note: "Run the first scan reads OpenCode's own answers. Use this setup and continue saves the choices shown (no key), maps the selected folder, and asks the linked AI what to do next.",
      done: "Setup saved",
    },
    {
      title: "Welcome to Mefi's Studio", short: "Your workspace", glyph: "g-explorer",
      copy: "Turn an idea into a checked result: talk it through, create a task or plan, follow the work, then review what changed. This guide shows you where to do each step, and can walk the menus with you.",
      points: ["Start with Projects: the M+ at the top of the left rail. Use + to add an existing folder, then select it. Check the project name above the conversation before adding work.", "Choose how builds start below. Auto build is on by default. Turn it off for Verify first: inspect each task, then approve the ones you want built.", "Each project keeps its own tasks, plans, conversation and results. Your project files stay in their folder; Studio keeps its history separately."],
      action: "Walk me to my projects", route: "project",
      station: "I opened the project menu with you and highlighted +. Add an existing folder, then select it. I tick this off the moment you are in a project.",
      note: "This opens the workspace and the project menu with you. It does not change your selected project. With a setup saved, selecting a folder here starts its map.",
      target: "#workspace-add-project", menu: true, waitFor: "mefi:project-changed", done: "Project selected",
    },
    {
      title: "Map the folder", short: "First map", glyph: "g-explorer", panel: "map",
      copy: "Let a read-only explorer lay out the node tree for the selected folder: what the project is, where its parts live, how it is checked, and what small work could start first.",
      points: ["The explorer runs OpenCode's built-in plan agent on the model the scan chose (a free one when available). It reads and searches; it cannot edit files or run commands.", "As it works it writes its map as a todo list, which appears as nodes under its session in the tree. Its suggested first tasks are saved as ideas in Your work — nothing is admitted or built.", "Free models answer one request at a time and can take a few minutes on a large folder. Cancel at any point; a cancelled map saves nothing."],
      action: null, note: "Map this project starts one explorer session in the selected folder. Ideas can be promoted to tasks later, one by one.",
      waitFor: "mefi:first-map", done: "Folder mapped",
    },
    {
      title: "Connect the assistant and coding workers", short: "Connections", glyph: "g-ambience",
      copy: "The assistant helps you think and organize. Coding workers carry out tasks in your project. Their provider settings are separate, and the scan's choices are shown at the top of Settings.",
      points: ["In Settings & connections, save the key for the assistant provider you want, choose Grok, Claude Code, Codex or Antigravity with their own CLI logins, or point the custom route at your own OpenAI-compatible endpoint.", "LM Studio needs no key: keep its local server running and pick it as the provider.", "Models are saved per provider: set the model you have for each option and switching never mixes them.", "Coding workers run through OpenCode by default: on your linked plan, or on the free model the scan found. The coding tier decides what each build may cost — Free, Fast or Heavy — while Auto lets Studio pick per task. Saving an assistant key alone does not prove a worker is ready.", "Manual planning works without an AI key. Jev is optional; without it the assistant's own model, or a free model, stands in for the small routing decisions."],
      action: "Walk me to connections", route: "studio",
      station: "We are in Settings & connections together, at the assistant group. Save the key you want, then scroll to the coding worker group, confirm its CLI is signed in and pick a coding tier. Nothing is sent until you choose to test it.",
      note: "Connection tests and AI requests may use your provider allowance when you explicitly run them.",
      target: "#settings-assistant-heading", done: "Connections checked",
    },
    {
      title: "Give a clear task, or explore a plan", short: "Create", glyph: "g-tasks",
      copy: "Use Give a task when the outcome is clear. Use Plan an idea when you need to settle questions before anything is built. The map's ideas, and the assistant's suggested first task, are good places to start.",
      points: ["Talk together is for questions and discussion. Give a task saves work in the selected project; Use a task outline helps you describe the result and checks.", "Start small: for example, ‘Add a Create note button to the empty notes list; check that it opens a new note.’ Say what should stay unchanged, too.", "Plan an idea collects questions and decisions. Review and approve the specification, then explicitly create its tasks.", "With Verify first, View task lets you inspect the brief and Approve build, or leave it waiting. New work also follows your Pause and worker settings."],
      action: "Walk me to the task box", route: "task", secondary: "Explore a plan", secondaryRoute: "plans",
      station: "This is the task box for the selected project. Describe the result and how you will check it, or open Use a task outline for a guided shape. I do not send anything from here.",
      note: "These buttons open the editor and the plan sheet. They do not submit a task or start a planning request.",
      target: "#workspace-input", done: "Task box found",
    },
    {
      title: "Follow the queue and current work", short: "Monitor", glyph: "g-command",
      copy: "Your work is the everyday queue. Command's node tree shows live workers, their current step and what is waiting to run.",
      points: ["Your work separates the queue, saved ideas, Review and Done. Open any task for its brief, prerequisites, history and result.", "In Node tree, Live work shows running workers and their reported steps. Click Ready, Waiting or Needs attention to see the matching tasks and their reasons.", "Work through backlog starts existing work and admits saved ideas gradually. Pause stops new scheduling while current workers finish; let them finish before switching projects.", "Free workers run one at a time and take longer than a paid model. A prerequisite must finish before dependent work starts. Read connection, retry and file-conflict messages before adding more work."],
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
      note: "You can reopen this guide from Start here at the foot of the left rail, or from Settings or Shortcuts. Completing the guide does not mark any task done.",
      target: "#workspace-review", done: "Review found",
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
  // The workspace header carries the truth about a selected project. Reading it
  // keeps the guide away from every project-writing host API.
  function projectReady() {
    const label = document.getElementById("workspace-project-name")?.textContent?.trim() || "";
    if (!label) return false;
    return !/^(Your workspace|Opening your project|Loading|Desktop app)/.test(label);
  }
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
    renderBars();
  }
  function render() {
    const lesson = lessons[state.step];
    $("progress").textContent = `Step ${state.step + 1} of ${lessons.length}`;
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
      : "Queued work can start automatically. Turn off to choose which tasks get built. You can change this above Your work at any time.";
  }
  // ---- the scan stop ----------------------------------------------------------------
  function setPanelStatus(id, text, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = text;
    try { target.classList?.[error ? "add" : "remove"]?.("error"); } catch {}
  }
  const allowFree = () => $("scan-allow-free")?.checked !== false;
  function scanFacts(plan, auto = null) {
    if (!plan) return [];
    const facts = [];
    const cli = plan.opencode || {};
    facts.push(cli.installed ? `OpenCode ${cli.version || "(version unknown)"} found${cli.path ? ` at ${cli.path}` : ""}${cli.supported === false ? " — older than the supported 1.x line" : ""}.` : "OpenCode is not installed on this computer.");
    const linked = plan.providers?.linked || [];
    facts.push(linked.length ? `Linked in OpenCode: ${linked.join(", ")}.` : "No provider is linked in OpenCode yet.");
    const free = plan.providers?.free || {};
    const best = Array.isArray(free.models) ? free.models.find((model) => model.usable) : null;
    facts.push(free.count ? `${free.count} free model${free.count === 1 ? "" : "s"} available${best ? `, newest ${best.name || best.id}` : ""}.` : "No free model is available right now.");
    facts.push(`Explorer: ${plan.explorer?.model || "OpenCode's default model"} — ${plan.explorer?.reason || ""}`.trim());
    facts.push(`Builder: ${plan.builder?.model || "OpenCode's default model"} — ${plan.builder?.reason || ""}`.trim());
    facts.push(`Judge: ${plan.judge?.kind || "fixed"} — ${plan.judge?.reason || ""}`.trim());
    // Auto setup's plan rides along with the scan: the assistant route and
    // builder CLI this machine's keys, CLIs and local servers already allow.
    if (auto?.ok) facts.push(`Auto setup: ${auto.summary || "a working route was found."}`);
    else if (auto?.error) facts.push(`Auto setup: ${auto.error}`);
    return facts;
  }
  function scanNotes(plan, auto = null) {
    if (!plan) return [];
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
    if ($("scan-apply")) { $("scan-apply").hidden = !(scanResult?.ok && scanResult.plan); $("scan-apply").disabled = scanBusy; }
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
        if (status?.autoSetup?.summary && !scanResult) setPanelStatus("scan-status", `Auto setup ran on first launch: ${status.autoSetup.summary} Run the scan to add OpenCode's free explorer and builder.`);
        return;
      }
      if (!state.done[SCAN]) { state.done[SCAN] = true; save(); }
      if (!scanResult) setPanelStatus("scan-status", `Setup saved${status.firstRun.appliedAt ? ` on ${new Date(status.firstRun.appliedAt).toLocaleDateString()}` : ""}: explorer ${status.firstRun.explorer?.model || "OpenCode default"}, builder ${status.firstRun.builder?.model || "OpenCode default"}, judge ${status.firstRun.judge?.kind || "fixed"}. Run the scan again after linking a provider.`);
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
    scanBusy = true; scanStarted = true; scanResult = null; renderScan();
    setActivity(true, { label: "Scanning · asking OpenCode what it has (about ten seconds)", fraction: 0 });
    setPanelStatus("scan-status", "Scanning… asking OpenCode for its version, linked providers, models and agents.");
    try {
      const result = await fn({ prefs: { allowFreeTraining: allowFree() } });
      scanResult = result;
      if (!result?.ok) setPanelStatus("scan-status", result?.error || "The scan did not finish.", true);
      else if (result.plan?.ok) setPanelStatus("scan-status", "Scan complete. Review the facts below, then choose Use this setup and continue: it saves these choices (no key), maps your selected folder and asks the linked AI what to do next.");
      else if (result.autoSetup?.ok) setPanelStatus("scan-status", `Scan complete. OpenCode is not usable yet, but auto setup found a working route: ${result.autoSetup.summary} Choose Use this setup to save it; install OpenCode later for the free explorer.`);
      else setPanelStatus("scan-status", "Scan complete, but OpenCode is not usable yet. Follow the next steps below, then scan again.", true);
    } catch (error) {
      setPanelStatus("scan-status", error?.message || "The scan failed.", true);
    } finally {
      scanBusy = false; setActivity(false); renderScan();
    }
  }
  async function applyScan() {
    const fn = hostApi("firstScanApply");
    if (!fn || !scanResult?.ok) { setPanelStatus("scan-status", "Run the scan first.", true); return; }
    scanBusy = true; renderScan();
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
    if (reason === "no-scan" || reason === "no-explorer" || reason === "no-opencode") return `${result.error} Go back to the Scan stop.`;
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
    setPanelStatus("map-status", `${automatic ? "The linked AI is mapping the folder you selected. " : ""}The explorer is reading the folder; its todo list appears in the tree as it goes.`);
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
  function placeSuggestedTask() {
    const task = assistResult?.advice?.firstTask;
    if (!task) return;
    const input = document.getElementById("workspace-input");
    if (input) { input.value = `${task.title}\n\n${task.brief || ""}`.trim(); }
    visit("task");
  }
  // ---- coach --------------------------------------------------------------------------
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
    state = { ...state, mode: "idle" };
    save(); releaseLayer(); renderInvitation();
  }
  // Safe destinations: navigation and highlighting only. Nothing is submitted,
  // approved or started from a lesson.
  // Returns the real control it focused, if any, so the coach knows whether it
  // still needs to hand focus to its own primary button.
  function routeTo(lesson) {
    const route = lesson.route;
    let focused = null;
    if (["project", "task", "review"].includes(route)) {
      window.MefiNav?.go?.("workspace");
      if (route === "task") {
        document.getElementById("workspace-mode-work")?.click();
        focused = document.getElementById("workspace-input") ?? null;
        focused?.focus?.();
      } else if (route === "review") {
        const review = document.getElementById("workspace-review");
        review?.click(); review?.focus?.();
        focused = review ?? null;
      }
    } else window.MefiNav?.go?.(route);
    if (lesson.menu) window.MefiSidebar?.open?.();
    highlight(lesson.target);
    if (route === "project") { focused = document.getElementById("workspace-add-project") ?? null; focused?.focus?.(); }
    const at = state.step;
    later(() => {
      if (state.mode !== "coach" || state.step !== at) return;
      if (lesson.menu) window.MefiSidebar?.open?.();
      highlight(lesson.target);
    });
    return focused;
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
  // A stop with a panel has no menu to walk to: the coach hands it back to the
  // sheet at that stop, where its button lives.
  function coach(index, options = {}) {
    init();
    const step = clampStep(index);
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
    state.done[state.step] = true;
    if (state.step >= lessons.length - 1) { state.status = "complete"; close(); return; }
    coach(state.step + 1);
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
    $("scan-run")?.addEventListener("click", () => { void runScan(); });
    $("scan-apply")?.addEventListener("click", () => { void applyScan(); });
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
    // The first launch starts linking an AI by itself: the scan is read-only,
    // shows its progress, and still saves nothing until "Use this setup".
    if (!scanStarted && hostApi("firstScan")) void runScan({ automatic: true });
    return true;
  }
  window.MefiOnboarding = { init, startup, open, close, coach, lessons: () => lessons.map((lesson) => ({ title: lesson.title, short: lesson.short, panel: lesson.panel || null })) };
})();
