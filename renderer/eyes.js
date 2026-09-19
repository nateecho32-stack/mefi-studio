// Mefi's Studio AI+ — A-Eyes: change feed, diffs, PNG evidence with pins, log tail.
(function () {
  "use strict";

  const state = {
    sessions: [],
    changes: [],
    todos: [],
    pngs: [],
    sessionId: null,
    agent: null,
    windowMs: 0,
    changeId: null,
    mode: "png",
    png: null,
    pins: {},
    pendingPin: null,
  };

  const els = {};
  let initialized = false;
  let pinCanvasCtx = null;

  const base = (file) => (file ? file.split(/[\\/]/).pop() : "(unknown)");
  const ago = (time) => {
    const seconds = Math.max(0, (Date.now() - time) / 1000);
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  function status(text, isError) {
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--bad)" : "";
  }

  function renderSessions() {
    const options = ['<option value="">All sessions</option>'];
    for (const session of state.sessions) {
      const label = `${session.title || session.id} · ${session.agent ?? "?"} · ${session.model.id ?? "?"}`;
      options.push(`<option value="${session.id}">${label.replace(/</g, "&lt;")}</option>`);
    }
    els.session.innerHTML = options.join("");
    els.session.value = state.sessionId ?? "";
    const agents = [...new Set(state.sessions.map((session) => session.agent).filter(Boolean))].sort();
    els.agent.innerHTML = ['<option value="">all agents</option>', ...agents.map((agent) => `<option value="${agent}">${agent}</option>`)].join("");
    els.agent.value = state.agent ?? "";
  }

  function visibleChanges() {
    let items = state.sessionId ? state.changes.filter((change) => change.sessionId === state.sessionId) : state.changes;
    if (state.agent) {
      const sessions = new Set(state.sessions.filter((session) => session.agent === state.agent).map((session) => session.id));
      items = items.filter((change) => sessions.has(change.sessionId));
    }
    if (state.windowMs) items = items.filter((change) => Date.now() - change.time <= state.windowMs);
    return items;
  }

  function updateSummary(items) {
    const additions = items.reduce((sum, change) => sum + change.additions, 0);
    const deletions = items.reduce((sum, change) => sum + change.deletions, 0);
    const files = new Set(items.map((change) => change.file).filter(Boolean)).size;
    const session = state.sessionId ? state.sessions.find((item) => item.id === state.sessionId) : null;
    const cost = session ? ` · session cost $${Number(session.cost ?? 0).toFixed(3)}` : "";
    els.summary.textContent = `${items.length} changes · ${files} files · +${additions}/-${deletions}${cost}`;
  }

  const GLYPHS = { edit: "✎", write: "✎", patch: "⚑", bash: "⌘", read: "◇", grep: "◌", glob: "◌", websearch: "☍", webfetch: "☍", task: "◆" };
  const FTYPE_COLORS = { lua: "#e6c98d", py: "#9db7ff", js: "#57ff9a", mjs: "#57ff9a", cjs: "#57ff9a", md: "#ece5d8", json: "#a8e6cf", css: "#86d1d6", htm: "#ffb38a", html: "#ffb38a", ps1: "#c9a8ff", cmd: "#c9a8ff" };
  const ftypeColor = (file) => {
    const ext = (file ?? "").split(".").pop()?.toLowerCase() ?? "";
    return FTYPE_COLORS[ext] ?? "#6c6455";
  };

  function renderFeed() {
    const items = visibleChanges();
    updateSummary(items);
    els.feed.textContent = "";
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No edits found for this filter yet.";
      els.feed.append(empty);
      return;
    }
    for (const change of items) {
      const li = document.createElement("li");
      li.dataset.id = change.id;
      if (change.id === state.changeId) li.classList.add("selected");
      const file = document.createElement("div");
      file.className = "file";
      const dot = document.createElement("span");
      dot.className = "ftype";
      dot.style.background = ftypeColor(change.file);
      file.append(dot, document.createTextNode(base(change.file) + (change.files?.length > 1 ? ` +${change.files.length - 1}` : "")));
      file.title = change.file ?? "";
      const meta = document.createElement("div");
      meta.className = "meta";
      const tag = document.createElement("span");
      tag.className = "tool-tag";
      tag.textContent = `${GLYPHS[change.tool] ?? "·"} ${change.tool}`;
      const plus = document.createElement("span");
      plus.className = "plus";
      plus.textContent = change.tool === "patch" ? `${change.files?.length ?? 0} file${(change.files?.length ?? 0) === 1 ? "" : "s"}` : `+${change.additions}`;
      const minus = document.createElement("span");
      minus.className = "minus";
      minus.textContent = change.tool === "patch" ? "" : `-${change.deletions}`;
      const when = document.createElement("span");
      when.textContent = ago(change.time) + " ago";
      meta.append(tag, plus, minus, when);
      li.append(file, meta);
      li.addEventListener("click", () => selectChange(change.id));
      els.feed.append(li);
    }
  }

  function findChange(id) {
    return state.changes.find((change) => change.id === id) ?? null;
  }

  function selectChange(id) {
    state.changeId = id;
    renderFeed();
    renderInspector();
    const change = findChange(id);
    if (change) setMode("diff");
    renderDiff();
  }

  function renderDiff() {
    const change = findChange(state.changeId);
    els.diff.textContent = "";
    if (!change) {
      els.diff.textContent = "Select a change in the feed to see its diff.";
      return;
    }
    if (!change.diff) {
      els.diff.textContent = change.tool === "patch"
        ? `Patch set (${change.files.length} files):\n\n` + change.files.join("\n")
        : "No stored diff for this change.";
      return;
    }
    for (const line of change.diff.split("\n")) {
      const span = document.createElement("span");
      span.textContent = line + "\n";
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:")) span.className = "head";
      else if (line.startsWith("@@")) span.className = "hunk";
      else if (line.startsWith("+")) span.className = "add";
      else if (line.startsWith("-")) span.className = "del";
      els.diff.append(span);
    }
  }

  function renderInspector() {
    const change = findChange(state.changeId);
    els.inspector.textContent = "";
    const hasFile = Boolean(change?.file);
    if (els.reveal) els.reveal.disabled = !hasFile;
    if (els.copy) els.copy.disabled = !hasFile;
    if (!change) {
      els.inspector.innerHTML = '<span class="k muted">no selection</span>';
      return;
    }
    const session = state.sessions.find((item) => item.id === change.sessionId);
    const rows = [
      ["file", change.file ?? "(unknown)"],
      ["tool", change.tool],
      ["lines", `+${change.additions} / -${change.deletions}`],
      ["agent", session?.agent ?? "?"],
      ["model", session?.model.id ?? "?"],
      ["session", session?.title ?? change.sessionId],
      ["when", new Date(change.time).toLocaleString()],
    ];
    for (const [key, value] of rows) {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = key;
      const v = document.createElement("span");
      v.textContent = value;
      els.inspector.append(k, v);
    }
  }

  function renderPngSelect() {
    const options = ['<option value="">newest evidence…</option>'];
    for (const png of state.pngs) {
      options.push(`<option value="${png.path.replace(/"/g, "&quot;")}">${png.name} · ${ago(png.mtime)} ago</option>`);
    }
    els.pngSelect.innerHTML = options.join("");
    if (state.png) els.pngSelect.value = state.png;
  }

  function imageUrl(filePath) {
    return encodeURI("file:///" + filePath.replace(/\\/g, "/"));
  }

  function loadPng(filePath) {
    state.png = filePath || null;
    state.pendingPin = null;
    if (filePath && !state.pngs.some((png) => png.path === filePath)) {
      state.pngs = [{ path: filePath, name: base(filePath), size: 0, mtime: Date.now() }, ...state.pngs];
      renderPngSelect();
    }
    if (els.pngSelect) els.pngSelect.value = filePath || "";
    if (!filePath) {
      els.png.hidden = true;
      els.pngEmpty.hidden = false;
      drawPins();
      return;
    }
    els.png.src = imageUrl(filePath);
    els.png.hidden = false;
    els.pngEmpty.hidden = true;
  }

  function currentPins() {
    return state.png ? state.pins[state.png] ?? [] : [];
  }

  function savePins() {
    if (!state.png) return;
    const next = { ...state.pins };
    if (currentPins().length) next[state.png] = currentPins();
    else delete next[state.png];
    state.pins = next;
    window.mefiStudio?.eyesPinsWrite?.(next);
  }

  function drawPins() {
    const canvas = els.pinsLayer;
    const image = els.png;
    if (!canvas) return;
    const width = image.hidden ? 0 : image.clientWidth;
    const height = image.hidden ? 0 : image.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    pinCanvasCtx = width ? canvas.getContext("2d") : null;
    if (!pinCanvasCtx) return;
    pinCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pinCanvasCtx.clearRect(0, 0, width, height);
    const pins = currentPins();
    pinCanvasCtx.font = "600 11px system-ui";
    pins.forEach((pin, index) => {
      const x = pin.x * width;
      const y = pin.y * height;
      pinCanvasCtx.beginPath();
      pinCanvasCtx.arc(x, y, 9, 0, Math.PI * 2);
      pinCanvasCtx.fillStyle = "rgba(201, 168, 106, 0.92)";
      pinCanvasCtx.fill();
      pinCanvasCtx.strokeStyle = "#050507";
      pinCanvasCtx.lineWidth = 2;
      pinCanvasCtx.stroke();
      pinCanvasCtx.fillStyle = "#171307";
      pinCanvasCtx.fillText(String(index + 1), x - 3.5, y + 4);
    });
  }

  function renderPinList() {
    els.pinsList.textContent = "";
    const pins = currentPins();
    pins.forEach((pin, index) => {
      const li = document.createElement("li");
      li.textContent = `${index + 1}. ${pin.note || "(no note)"} · ${Math.round(pin.x * 100)}%,${Math.round(pin.y * 100)}%`;
      li.title = "click to remove";
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        const next = pins.filter((_, i) => i !== index);
        if (state.png) state.pins[state.png] = next;
        if (!next.length && state.png) delete state.pins[state.png];
        savePins();
        renderPinList();
        drawPins();
      });
      els.pinsList.append(li);
    });
    if (state.pendingPin) {
      const li = document.createElement("li");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "note for pin " + (pins.length + 1) + " · Enter saves";
      input.style.width = "100%";
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          if (!state.png) return;
          state.pins[state.png] = [...currentPins(), { ...state.pendingPin, note: input.value.trim() }];
          state.pendingPin = null;
          savePins();
          renderPinList();
          drawPins();
        }
        if (event.key === "Escape") {
          state.pendingPin = null;
          renderPinList();
        }
      });
      li.append(input);
      els.pinsList.append(li);
      input.focus();
    }
  }

  let logTimer = null;

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".mode-row .chip").forEach((chip) => chip.classList.toggle("on", chip.dataset.mode === mode));
    els.modePng.hidden = mode !== "png";
    els.modeDiff.hidden = mode !== "diff";
    els.modeLog.hidden = mode !== "log";
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
    if (mode === "log") {
      refreshLog();
      logTimer = setInterval(refreshLog, 5000);
    }
    if (mode === "png") requestAnimationFrame(drawPins);
  }

  async function refreshLog() {
    if (document.hidden) return;
    if (!window.mefiStudio?.eyesLog) return;
    const result = await window.mefiStudio.eyesLog(220);
    els.log.textContent = result.ok ? result.text : `log unavailable: ${result.error}`;
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function refresh({ keepSelection = true } = {}) {
    if (!window.mefiStudio?.eyesState) {
      status("Desktop mode only — run npm start inside mefi-studio to read live sessions.", true);
      return;
    }
    const result = await window.mefiStudio.eyesState(state.sessionId);
    if (!result.ok) {
      status(`OpenCode store unavailable: ${result.error}`, true);
      return;
    }
    state.sessions = result.sessions;
    state.changes = result.changes;
    state.todos = result.todos;
    // A restored checkpoint's png can be older than the live list: keep the
    // synthesised entry loadPng() made, or the picker forgets what is on screen.
    state.pngs =
      state.png && !result.pngs.some((png) => png.path === state.png)
        ? [{ path: state.png, name: base(state.png), size: 0, mtime: Date.now() }, ...result.pngs]
        : result.pngs;
    if (!keepSelection || !findChange(state.changeId)) state.changeId = null;
    renderSessions();
    renderFeed();
    renderDiff();
    renderInspector();
    renderPngSelect();
    if (!state.png && state.pngs.length) loadPng(state.pngs[0].path);
    const edits = visibleChanges().length;
    status(`${state.sessions.length} sessions · ${edits} changes shown · live poll 1.5s`);
  }

  function wire() {
    els.session.addEventListener("change", () => {
      state.sessionId = els.session.value || null;
      state.changeId = null;
      renderFeed();
      renderDiff();
      renderInspector();
    });
    els.agent.addEventListener("change", () => {
      state.agent = els.agent.value || null;
      renderFeed();
    });
    els.window.addEventListener("change", () => {
      state.windowMs = Number(els.window.value) || 0;
      renderFeed();
    });
    els.reveal.addEventListener("click", () => {
      const change = findChange(state.changeId);
      if (change?.file) window.mefiStudio?.shellReveal?.(change.file);
    });
    els.copy.addEventListener("click", async () => {
      const change = findChange(state.changeId);
      if (!change?.file) return;
      await window.mefiStudio?.shellCopy?.(change.file);
      status(`copied ${base(change.file)} path to clipboard`);
    });
    els.refresh.addEventListener("click", () => refresh());
    els.pngSelect.addEventListener("change", () => loadPng(els.pngSelect.value || null));
    els.pngOpen.addEventListener("click", async () => {
      if (!window.mefiStudio?.eyesPickPng) return;
      const picked = await window.mefiStudio.eyesPickPng();
      if (picked?.ok) loadPng(picked.path);
    });
    const pngPane = document.getElementById("eyes-mode-png");
    pngPane.addEventListener("dragover", (event) => event.preventDefault());
    pngPane.addEventListener("drop", (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file?.path) loadPng(file.path);
    });
    document.querySelectorAll(".mode-row .chip").forEach((chip) => chip.addEventListener("click", () => setMode(chip.dataset.mode)));
    // The 5s log tail pauses while the window is hidden (refreshLog bails) and
    // snaps back the moment the window is shown, so no tick is spent on a
    // fetch nobody can see.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.mode === "log") refreshLog();
    });
    els.png.addEventListener("load", () => requestAnimationFrame(drawPins));
    els.png.addEventListener("click", (event) => {
      if (!state.png) return;
      const rect = els.png.getBoundingClientRect();
      state.pendingPin = {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      };
      renderPinList();
    });
    window.addEventListener("resize", () => requestAnimationFrame(drawPins));
    window.addEventListener("mefi:restore-png", (event) => {
      if (event.detail?.path) {
        loadPng(event.detail.path);
        status(`visual state restored from checkpoint: ${base(event.detail.path)}`);
      }
    });
    // Registered here, not at the end of init(): init() is async, and a deep link
    // from the Command view or the Explorer dispatches as soon as showTab() returns.
    window.addEventListener("mefi:tree-select", (event) => {
      state.sessionId = event.detail?.sessionId ?? null;
      if (els.session) els.session.value = state.sessionId ?? "";
      state.changeId = null;
      renderFeed();
      renderInspector();
      renderDiff();
      if (els.feed) els.feed.scrollTop = 0;
    });
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      status: "eyes-status",
      session: "eyes-session",
      agent: "eyes-agent",
      window: "eyes-window",
      summary: "eyes-summary",
      feed: "eyes-feed",
      refresh: "eyes-refresh",
      reveal: "eyes-reveal",
      copy: "eyes-copy",
      modePng: "eyes-mode-png",
      modeDiff: "eyes-mode-diff",
      modeLog: "eyes-mode-log",
      diff: "eyes-diff",
      log: "eyes-log",
      pngSelect: "eyes-png-select",
      pngOpen: "eyes-png-open",
      png: "eyes-png",
      pngEmpty: "eyes-png-empty",
      pinsLayer: "eyes-pins-layer",
      inspector: "eyes-inspector",
      pinsList: "eyes-pins",
    })) {
      els[key] = document.getElementById(id);
    }
    wire();
    if (window.mefiStudio?.eyesPinsRead) {
      const result = await window.mefiStudio.eyesPinsRead();
      if (result?.ok) state.pins = result.pins ?? {};
    }
    renderPinList();
    await refresh({ keepSelection: false });
    window.mefiStudio?.eyesWatch?.(true);
    window.mefiStudio?.onEyesActivity?.((data) => {
      const touched = (data.activity ?? []).some((item) => ["edit", "write", "patch"].includes(item.tool));
      if (touched) refresh({ keepSelection: true });
      window.dispatchEvent(new CustomEvent("mefi:eyes-activity", { detail: data }));
    });
    window.mefiStudio?.onEyesError?.((message) => status(`poll error: ${message}`, true));
  }

  window.MefiEyes = { init, refresh, state };
})();
