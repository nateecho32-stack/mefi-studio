// Mefi's Studio AI+ — Analyzer: drop files or ideas, get read-time findings.
// Local engine works with no key; the AI deep read adds features/ideas/content/gaps.
(function () {
  "use strict";

  const state = { result: null, ai: null };
  const els = {};
  let initialized = false;

  const base = (file) => (file ? file.split(/[\\/]/).pop() : "(unknown)");
  const relative = (file) => (file ? file.replace(/^.*?(mefi-studio|game|render|ui|worldgen|tools|dev|docs)[\\/]/, "$1/") : "");
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

  function renderAi(ai) {
    els.aiOut.textContent = "";
    if (!ai) return;
    const heading = document.createElement("h4");
    heading.textContent = "AI deep read";
    els.aiOut.append(heading);
    if (ai.summary) card(els.aiOut, "SUMMARY", "improver", ai.summary);
    for (const [key, tag] of [["features", "FEATURE"], ["ideas", "IDEA"], ["content", "CONTENT"], ["gaps", "GAP"]]) {
      for (const item of (ai[key] ?? []).slice(0, 6)) card(els.aiOut, tag, key === "gaps" ? "fix" : "", item);
    }
  }

  async function runAi(kind, payload) {
    if (!window.mefiStudio?.analyzerAi) return;
    status("AI deep read in progress…");
    const result = await window.mefiStudio.analyzerAi(kind, payload);
    if (!result.ok) {
      status(`AI read unavailable: ${result.error}`, true);
      return;
    }
    state.ai = result.result;
    renderAi(state.ai);
    status("AI deep read complete");
  }

  function show(result) {
    state.result = result;
    els.findings.textContent = "";
    els.evidence.textContent = "";
    els.aiOut.textContent = "";
    if (result.kind === "file") {
      els.title.textContent = `Findings · ${result.name}`;
      renderFile(result);
      status(`analyzed ${result.name} · ${result.language} · ${result.composition.lines} lines`);
    } else {
      els.title.textContent = "Findings · idea";
      renderIdea(result);
      status(`idea verified · ${result.verdict} · ${result.coverage}% coverage`);
    }
  }

  async function runFile(filePath) {
    if (!filePath || !window.mefiStudio?.analyzerRun) return;
    status(`reading ${base(filePath)}…`);
    const result = await window.mefiStudio.analyzerRun("file", { path: filePath });
    if (!result.ok) {
      status(result.error, true);
      return;
    }
    show(result.result);
    if (els.ai.checked) await runAi("file", { name: result.result.name, language: result.result.language, composition: result.result.composition, outline: result.result.outline, markers: result.result.markers, references: result.result.references, findings: result.result.findings });
  }

  async function runIdea(text) {
    if (!text || !window.mefiStudio?.analyzerRun) return;
    status("verifying idea against the work tree…");
    const result = await window.mefiStudio.analyzerRun("idea", { text });
    if (!result.ok) {
      status(result.error, true);
      return;
    }
    show(result.result);
    if (els.ai.checked) await runAi("idea", { text: result.result.text, verdict: result.result.verdict, coverage: result.result.coverage, keywords: result.result.keywords, hits: result.result.hits.slice(0, 20), uncovered: result.result.uncovered });
  }

  function open(options) {
    window.MefiNav?.claim?.("analyzer");
    const params = optionsOf(options);
    els.overlay.hidden = false;
    if (typeof params.idea === "string" && params.idea) {
      els.idea.value = params.idea;
      if (params.run) els.ideaRun.click();
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
    })) {
      els[key] = document.getElementById(id);
    }
    els.openButton?.addEventListener("click", open);
    els.close?.addEventListener("click", close);
    els.overlay?.addEventListener("click", (event) => {
      if (event.target === els.overlay) close();
    });
    els.file?.addEventListener("click", async () => {
      const picked = await window.mefiStudio?.analyzerPick?.();
      if (picked?.ok) runFile(picked.path);
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
      if (file?.path) runFile(file.path);
    });
  }

  window.MefiAnalyzer = { init, open, close, show, file: runFile, idea: runIdea };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
