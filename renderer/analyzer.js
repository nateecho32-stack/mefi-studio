// Mefi's Studio AI+ — Analyzer: inspect projects, old plans, files and ideas.
// Local engine works with no key; the AI deep read adds features/ideas/content/gaps.
(function () {
  "use strict";

  const state = { result: null, ai: null, projectResult: null, projectId: null, epoch: 0, request: 0, aiRequest: 0, pending: null, aiPending: false };
  const els = {};
  const inputModes = ["project", "file", "idea"];
  function setInputMode(mode, focus = false) {
    const selected = inputModes.includes(mode) ? mode : "project";
    for (const name of inputModes) {
      const tab = document.getElementById(`analyzer-tab-${name}`);
      const panel = document.getElementById(`analyzer-mode-${name}`);
      if (tab) { tab.setAttribute?.("aria-selected", String(name === selected)); tab.tabIndex = name === selected ? 0 : -1; }
      if (panel) panel.hidden = name !== selected;
      if (focus && name === selected) tab?.focus();
    }
  }
  let initialized = false;

  const base = (file) => (file ? file.split(/[\\/]/).pop() : "(unknown)");
  // #analyzer-open binds straight to open(), so arg 0 can be a click Event.
  const optionsOf = (value) =>
    value && typeof value === "object" && typeof value.preventDefault !== "function" ? value : {};

  function status(text, isError) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--bad)" : "";
  }

  function card(parent, tag, tagClass, text) {
    const block = document.createElement("div");
    block.className = "finding";
    const label = document.createElement("span");
    label.className = `src-tag ${tagClass ?? ""}`;
    label.textContent = tag;
    const body = document.createElement("span");
    body.textContent = " " + text;
    block.append(label, body);
    parent.append(block);
    return block;
  }

  function list(parent, heading, items, emptyText) {
    const title = document.createElement("h4");
    title.textContent = heading;
    parent.append(title);
    const ul = document.createElement("ul");
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = emptyText ?? "none";
      ul.append(li);
    }
    for (const item of items) {
      const li = document.createElement("li");
      if (typeof item === "string") li.textContent = item;
      else {
        const key = document.createElement("span");
        key.textContent = item.label;
        key.title = item.title ?? "";
        const value = document.createElement("b");
        value.textContent = item.value ?? "";
        li.append(key, value);
      }
      ul.append(li);
    }
    parent.append(ul);
  }

  function compositionBar(parent, composition) {
    const wrap = document.createElement("div");
    wrap.className = "comp-bar";
    const segments = [
      { className: "code", value: composition.code, label: "code" },
      { className: "comment", value: composition.comment, label: "comments" },
      { className: "blank", value: composition.blank, label: "blank" },
    ];
    for (const segment of segments) {
      const bar = document.createElement("i");
      bar.className = segment.className;
      bar.style.width = `${(segment.value / Math.max(1, composition.lines)) * 100}%`;
      bar.title = `${segment.label}: ${segment.value} lines`;
      wrap.append(bar);
    }
    parent.append(wrap);
    const legend = document.createElement("p");
    legend.className = "eyes-status";
    legend.textContent = `${composition.lines} lines · ${composition.codePercent}% code · ${composition.commentPercent}% comments`;
    parent.append(legend);
  }

  function renderFile(result) {
    for (const finding of result.findings) {
      card(els.findings, finding.kind.toUpperCase(), finding.kind === "markers" ? "collision" : finding.kind === "references" ? "improver" : "", finding.text);
    }
    compositionBar(els.findings, result.composition);
    if (result.outline.length) {
      list(
        els.findings,
        "Outline",
        result.outline.slice(0, 14).map((entry) => ({ label: `L${entry.line}`, value: entry.label })),
        "no outline entries"
      );
      if (result.outline.length > 14) card(els.findings, "OUTLINE", "improver", `…and ${result.outline.length - 14} more entries`);
    }
    if (result.markers.length) {
      list(
        els.findings,
        "Markers",
        result.markers.slice(0, 10).map((marker) => ({ label: `${marker.level} L${marker.line}`, value: marker.text })),
        "clean"
      );
    }
    const missing = result.references.filter((reference) => !reference.found);
    list(
      els.findings,
      "Referenced paths",
      result.references.slice(0, 12).map((reference) => ({
        label: reference.found ? "exists" : "MISSING",
        value: reference.ref,
        title: reference.found ? "present in the work tree" : "not found in the work tree",
      })),
      "no path references"
    );
    for (const reference of missing.slice(0, 8)) {
      const row = document.createElement("li");
      row.className = "muted";
      row.textContent = `missing: ${reference.ref}`;
      els.evidence.append(row);
    }
  }

  function renderIdea(result) {
    const verdictClass = result.verdict === "new" ? "improver" : result.verdict === "related work exists" ? "collision" : "fix";
    card(els.findings, "VERDICT", verdictClass, `${result.verdict} · ${result.coverage}% keyword coverage across ${result.files.length} file(s), ${result.scanned} scanned`);
    const chips = document.createElement("div");
    chips.className = "keyword-row";
    for (const keyword of result.keywords) {
      const chip = document.createElement("span");
      chip.className = `chip ${result.keywordHits[keyword] ? "on" : ""}`;
      chip.textContent = `${keyword} ${result.keywordHits[keyword] ? `·${result.keywordHits[keyword]}` : "· 0"}`;
      chips.append(chip);
    }
    els.findings.append(chips);
    for (const suggestion of result.suggestions) card(els.findings, "NEXT", "", suggestion);
    for (const reference of result.references.slice(0, 8)) {
      card(els.findings, reference.found ? "REF OK" : "REF MISSING", reference.found ? "" : "fix", reference.ref);
    }
    if (result.hits.length) {
      list(
        els.evidence,
        "Evidence",
        result.hits.slice(0, 20).map((hit) => ({
          label: `${hit.file}:${hit.line || 1}`,
          value: hit.snippet,
          title: `${hit.keyword} · ${hit.file}`,
        })),
        "no hits"
      );
    } else {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No evidence hits — every keyword is new ground.";
      els.evidence.append(li);
    }
  }

  function evidence(parent, hits) {
    if (!hits?.length) return;
    const rows = document.createElement("ul");
    for (const hit of hits.slice(0, 8)) {
      const row = document.createElement("li");
      row.textContent = `${hit.file}:${hit.line || 1}${hit.snippet ? ` — ${hit.snippet}` : ""}`;
      rows.append(row);
    }
    parent.append(rows);
  }

  function renderProject(result) {
    const inventory = result.inventory || {};
    const plans = result.plans || [];
    const summary = result.summary || {};
    card(els.findings, "PROJECT", "improver", `${inventory.files || 0} files · ${inventory.sourceFiles || 0} source files · ${inventory.testFiles || 0} test files · ${inventory.documents || 0} documents`);
    card(els.findings, "PLAN CHECK", "", `${plans.length} old plan(s) · ${summary.claimedComplete || 0} completion claim(s) · ${summary.missingReferences || 0} missing path(s). Related code and existing paths are evidence to review; they do not prove a plan is complete.`);

    const heading = document.createElement("h4");
    heading.textContent = "Starting points";
    els.findings.append(heading);
    for (const point of result.startingPoints || []) {
      const block = document.createElement("section");
      card(block, "NEXT", "improver", point.title);
      const reason = document.createElement("p");
      reason.textContent = point.reason;
      block.append(reason);
      list(block, "First step and acceptance", [point.firstStep, point.acceptance].filter(Boolean));
      evidence(block, point.evidence);
      const prepare = document.createElement("button");
      prepare.type = "button";
      prepare.className = "ghost mini";
      prepare.textContent = "Prepare idea";
      const epoch = state.epoch;
      prepare.addEventListener("click", () => {
        if (epoch !== state.epoch || state.projectResult !== result) return;
        els.idea.value = [point.title, point.reason, point.firstStep && `First step: ${point.firstStep}`, point.acceptance && `Acceptance: ${point.acceptance}`].filter(Boolean).join("\n\n");
        els.idea.focus();
        status("Starting point copied into your editable idea. Review it, then choose Analyze idea.");
      });
      block.append(prepare);
      els.findings.append(block);
    }
    if (!result.startingPoints?.length) card(els.findings, "NEXT", "", "Describe the outcome you want in the idea box to explore a starting point.");
    list(els.findings, "Languages", (inventory.languages || []).map((language) => `${language.name} · ${language.count} files`), "No source languages discovered.");
    list(els.findings, "Entry points", inventory.entryPoints || [], "No entry points discovered.");
    list(els.findings, "Checks discovered — not run", (inventory.checks || []).map((check) => `${check.name}: ${check.command}`), "No automated checks discovered.");

    const planHeading = document.createElement("h4");
    planHeading.textContent = "Old plans compared with the current files";
    els.findings.append(planHeading);
    const labels = { "missing-reference": "Missing reference", related: "Related evidence — needs verification", unverified: "Unverified", open: "Open" };
    for (const plan of plans) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `${plan.title} · ${labels[plan.status] || "Needs review"}`;
      details.append(summary);
      const source = document.createElement("p");
      source.className = "muted";
      source.textContent = `${plan.source || "Studio plan"}${plan.line ? `:${plan.line}` : ""}${plan.sourceStatus ? ` · Saved status: ${plan.sourceStatus}` : ""}`;
      details.append(source);
      if (plan.context && typeof plan.context === "object") {
        for (const [key, label] of [["destination", "Destination"], ["outOfScope", "Outside this plan"]]) {
          if (typeof plan.context[key] === "string" && plan.context[key]) card(details, label, "", plan.context[key].slice(0, 1600));
        }
        const decisions = Array.isArray(plan.context.decisions) ? plan.context.decisions.slice(0, 12) : [];
        if (decisions.length) {
          list(details, "Settled planning decisions", decisions.filter((decision) => decision && typeof decision.question === "string" && typeof decision.resolution === "string").map((decision) => `${decision.question.slice(0, 700)} — ${decision.resolution.slice(0, 700)}`));
          const note = document.createElement("p");
          note.className = "muted";
          note.textContent = "These are recorded planning choices. Their implementation still needs verification.";
          details.append(note);
        }
      }
      for (const item of plan.items || []) {
        card(details, labels[item.status] || "Needs review", item.status === "missing-reference" ? "fix" : "", `${item.text}${item.claimedComplete ? " · Marked complete in the plan; completion not verified." : ""}`);
        if (item.line) {
          const location = document.createElement("p");
          location.className = "muted";
          location.textContent = `${plan.source || "Studio plan"}:${item.line}`;
          details.append(location);
        }
        evidence(details, item.evidence);
        if (Array.isArray(item.acceptance) && item.acceptance.length) list(details, "Acceptance checks — not run", item.acceptance.filter((check) => typeof check === "string").slice(0, 6).map((check) => check.slice(0, 400)));
        if (item.references?.length) list(details, "Referenced paths", item.references.map((reference) => {
          const label = reference.found ? "Present" : ({ "outside-project": "Outside project — not inspected", excluded: "Excluded — not inspected", unreadable: "Unreadable — not inspected" })[reference.status] || "Missing";
          return `${label}: ${reference.ref}`;
        }));
      }
      els.findings.append(details);
    }
    if (!plans.length) card(els.findings, "PLANS", "", "No old plans were found in the scanned documents or this project's saved Studio plans.");
    for (const limitation of result.limitations || []) {
      const row = document.createElement("li");
      row.textContent = limitation;
      els.evidence.append(row);
    }
    if (!result.limitations?.length) {
      const row = document.createElement("li");
      row.textContent = "Local inspection only. Tests and application behavior have not been run.";
      els.evidence.append(row);
    }
  }

  function renderAi(ai) {
    els.aiOut.textContent = "";
    if (!ai) return;
    const heading = document.createElement("h4");
    heading.textContent = "AI deep read";
    els.aiOut.append(heading);
    if (typeof ai.summary === "string" && ai.summary) card(els.aiOut, "SUMMARY", "improver", ai.summary);
    for (const [key, tag] of [["features", "FEATURE"], ["ideas", "IDEA"], ["content", "CONTENT"], ["gaps", "GAP"]]) {
      for (const item of (Array.isArray(ai[key]) ? ai[key] : []).filter((entry) => typeof entry === "string").slice(0, 6)) card(els.aiOut, tag, key === "gaps" ? "fix" : "", item);
    }
  }

  function controls() {
    if (els.project) {
      els.project.disabled = !window.mefiStudio?.analyzerRun || state.pending === "project";
      els.project.textContent = state.pending === "project" ? "Analyzing project…" : "Analyze project";
    }
    if (els.projectAi) els.projectAi.disabled = !state.projectResult || state.aiPending || !window.mefiStudio?.analyzerAi;
  }

  function clearResult() {
    state.result = null;
    state.ai = null;
    els.findings.textContent = "";
    els.evidence.textContent = "";
    els.aiOut.textContent = "";
    els.title.textContent = "Findings";
  }

  // Every intent owns one sequence, including the time spent in a native picker.
  // A project switch also changes the epoch, fencing every outstanding IPC.
  function begin(kind) {
    state.request += 1;
    state.aiRequest += 1;
    state.pending = kind;
    state.aiPending = false;
    clearResult();
    controls();
    return { request: state.request, epoch: state.epoch, projectId: state.projectId };
  }

  function current(token, response) {
    if (token.request !== state.request || token.epoch !== state.epoch) return false;
    const responseId = response?.projectId ?? response?.result?.projectId;
    return !responseId || !state.projectId || responseId === state.projectId;
  }

  function finish(token) {
    if (!current(token)) return;
    state.pending = null;
    controls();
  }

  async function runAi(kind, payload, token) {
    if (!window.mefiStudio?.analyzerAi || !current(token)) return;
    const aiRequest = ++state.aiRequest;
    state.aiPending = true;
    controls();
    status("AI deep read in progress…");
    try {
      const response = await window.mefiStudio.analyzerAi(kind, { ...payload, projectId: state.projectId || undefined });
      if (!current(token, response) || aiRequest !== state.aiRequest) return;
      if (!response?.ok) throw new Error(response?.error || "No AI response received");
      if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) throw new Error("AI returned an invalid response. Try another read.");
      state.ai = response.result;
      renderAi(state.ai);
      status("AI deep read complete · suggestions still need verification");
    } catch (error) {
      if (current(token) && aiRequest === state.aiRequest) status(`AI read unavailable: ${error.message}`, true);
    } finally {
      if (current(token) && aiRequest === state.aiRequest) { state.aiPending = false; controls(); }
    }
  }

  function present(result) {
    state.result = result;
    state.ai = null;
    els.findings.textContent = "";
    els.evidence.textContent = "";
    els.aiOut.textContent = "";
    if (result.kind === "project") {
      state.projectResult = result;
      els.title.textContent = `Project · ${result.name}`;
      renderProject(result);
      status(`Project scan complete · ${(result.plans || []).length} old plan(s) · ${(result.startingPoints || []).length} starting point(s) · checks not run`);
    } else if (result.kind === "file") {
      els.title.textContent = `Findings · ${result.name}`;
      renderFile(result);
      status(`analyzed ${result.name} · ${result.language} · ${result.composition.lines} lines`);
    } else {
      els.title.textContent = "Findings · idea";
      renderIdea(result);
      status(`idea compared · ${result.verdict} · ${result.coverage}% keyword coverage`);
    }
    controls();
  }

  function show(result) {
    const token = begin(result.kind);
    present(result);
    finish(token);
  }

  async function runFile(filePath, pickerToken) {
    if (!filePath || !window.mefiStudio?.analyzerRun) return;
    if (pickerToken && !current(pickerToken)) return;
    const token = pickerToken || begin("file");
    status(`reading ${base(filePath)}…`);
    try {
      const response = await window.mefiStudio.analyzerRun("file", { path: filePath, projectId: token.projectId || undefined });
      if (!current(token, response)) return;
      if (!response?.ok) throw new Error(response?.error || "File analysis unavailable");
      const result = response.result;
      present(result);
      if (els.ai.checked) await runAi("file", { name: result.name, language: result.language, composition: result.composition, outline: result.outline, markers: result.markers, references: result.references, findings: result.findings }, token);
    } catch (error) {
      if (current(token)) status(error.message, true);
    } finally {
      finish(token);
    }
  }

  async function runIdea(text) {
    if (!text || !window.mefiStudio?.analyzerRun) return;
    const token = begin("idea");
    status("verifying idea against the work tree…");
    try {
      const response = await window.mefiStudio.analyzerRun("idea", { text, projectId: token.projectId || undefined });
      if (!current(token, response)) return;
      if (!response?.ok) throw new Error(response?.error || "Idea analysis unavailable");
      const result = response.result;
      present(result);
      if (els.ai.checked) await runAi("idea", { text: result.text, verdict: result.verdict, coverage: result.coverage, keywords: result.keywords, hits: result.hits.slice(0, 20), uncovered: result.uncovered }, token);
    } catch (error) {
      if (current(token)) status(error.message, true);
    } finally {
      finish(token);
    }
  }

  async function runProject() {
    state.projectResult = null;
    const token = begin("project");
    if (!window.mefiStudio?.analyzerRun) {
      status("Project analysis is available in the desktop app.");
      finish(token);
      return;
    }
    els.title.textContent = "Reading project…";
    status("Reading project files and old plans locally…");
    try {
      const response = await window.mefiStudio.analyzerRun("project", { projectId: token.projectId || undefined });
      if (!current(token, response)) return;
      if (!response?.ok) throw new Error(response?.error || "Project analysis unavailable");
      if (!state.projectId) state.projectId = response.projectId || response.result?.projectId || null;
      present(response.result);
    } catch (error) {
      if (current(token)) status(`Project scan unavailable: ${error.message}`, true);
    } finally {
      finish(token);
    }
  }

  function projectChanged(event) {
    state.epoch += 1;
    state.projectId = event.detail?.projectId || null;
    state.projectResult = null;
    els.idea.value = "";
    if (!state.projectId) {
      // No project is open: clear the panel instead of scanning the seed store.
      state.request += 1;
      state.aiRequest += 1;
      state.pending = null;
      state.aiPending = false;
      clearResult();
      status("Open a project folder to analyse it.");
      controls();
      return;
    }
    runProject();
  }

  function projectAi() {
    const result = state.projectResult;
    if (!result) return;
    const token = begin("project-ai");
    present(result);
    return runAi("project", {}, token).finally(() => finish(token));
  }

  function open(options) {
    window.MefiNav?.claim?.("analyzer");
    const params = optionsOf(options);
    els.overlay.hidden = false;
    if (typeof params.idea === "string" && params.idea) {
      setInputMode("idea");
      els.idea.value = params.idea;
      if (params.run) els.ideaRun.click();
    } else if (!state.result && !state.pending) {
      runProject();
    }
  }

  function close() {
    if (els.overlay.hidden) return;
    els.overlay.hidden = true;
    window.MefiNav?.release?.("analyzer");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      overlay: "analyzer-overlay",
      drop: "analyzer-drop",
      file: "analyzer-file",
      idea: "analyzer-idea",
      ideaRun: "analyzer-idea-run",
      ai: "analyzer-ai",
      status: "analyzer-status",
      title: "analyzer-title",
      findings: "analyzer-findings",
      evidence: "analyzer-evidence",
      aiOut: "analyzer-ai-out",
      close: "analyzer-close",
      openButton: "analyzer-open",
      project: "analyzer-project",
      projectAi: "analyzer-project-ai",
    })) {
      els[key] = document.getElementById(id);
    }
    els.openButton?.addEventListener("click", open);
    for (const [index, mode] of inputModes.entries()) {
      const tab = document.getElementById(`analyzer-tab-${mode}`);
      tab?.addEventListener("click", () => setInputMode(mode));
      tab?.addEventListener("keydown", (event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % inputModes.length : event.key === "ArrowLeft" ? (index + inputModes.length - 1) % inputModes.length : event.key === "Home" ? 0 : event.key === "End" ? inputModes.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault(); setInputMode(inputModes[next], true);
      });
    }
    els.project?.addEventListener("click", runProject);
    els.projectAi?.addEventListener("click", projectAi);
    els.close?.addEventListener("click", close);
    els.overlay?.addEventListener("click", (event) => {
      if (event.target === els.overlay) close();
    });
    els.file?.addEventListener("click", async () => {
      const token = begin("picker");
      status("Choose a file to analyze…");
      try {
        const picked = await window.mefiStudio?.analyzerPick?.();
        if (!current(token, picked)) return;
        if (picked?.ok && picked.path) await runFile(picked.path, token);
        else status(picked?.error || "File selection cancelled.", Boolean(picked?.error));
      } catch (error) {
        if (current(token)) status(error.message, true);
      } finally { finish(token); }
    });
    els.ideaRun?.addEventListener("click", () => runIdea(els.idea.value.trim()));
    els.drop?.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.drop.classList.add("drag-over");
    });
    els.drop?.addEventListener("dragleave", () => els.drop.classList.remove("drag-over"));
    els.drop?.addEventListener("drop", (event) => {
      event.preventDefault();
      els.drop.classList.remove("drag-over");
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      // File.path left Electron in v32; the preload asks webUtils instead.
      const filePath = window.mefiStudio?.pathForFile?.(file) ?? file.path ?? null;
      if (filePath) runFile(filePath);
      else status("Drop a file saved on this computer, or use Open file…", true);
    });
    window.addEventListener("mefi:project-changed", projectChanged);
    controls();
  }

  window.MefiAnalyzer = { init, open, close, show, file: runFile, idea: runIdea, project: runProject };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
