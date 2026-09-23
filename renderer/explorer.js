// Mefi's Studio AI+ — A-Eyes session explorer overlay.
// Tree browser over live sessions/todos, checkpoint bubbles, collateral watch,
// the always-on assistant (its thread, service line and activity), the
// DeepSeek V4.1 Flash briefing, and the request inbox.
(function () {
  "use strict";

  const state = {
    sessions: [],
    todos: [],
    changes: [],
    collisions: [],
    presence: [],
    requests: [],
    checkpoints: {},
    reviews: {},
    briefing: null,
    selected: null,
    audit: null,
    autoTimer: null,
    // The assistant service state, the folded group's disclosure, and when the
    // sheet last told main its replies were seen.
    assistant: null,
    foldedOpen: false,
    seenAt: 0,
  };
  const els = {};
  let initialized = false;
  // Sequence token for store reads: a slow read that resolves after a newer
  // one (poll tick, re-open, show snap-back) must not overwrite fresh content.
  let loadSeq = 0;
  // Session refresh cadence while the sheet is open. The interval itself stops
  // while the window hides (boot.js's shared poll guard) and restarts when it
  // shows, and the tick bails while hidden or while the sheet is closed, so a
  // hidden app issues no store reads.
  const EXPLORER_POLL_MS = 5000;
  // The keeper audit's switches beside Proactive (docs/agent-loop.md §10):
  // the assistant pref each one saves and the status line for either side.
  const AUDIT_SWITCHES = {
    memoryAlign: { name: "memory alignment", on: "memory alignment on · the keeper writes each checker verdict into the card's notes and quiets finished cards", off: "memory alignment off · card notes stay as the workers wrote them" },
    loopGuard: { name: "loop guard", on: "loop guard on · cards that keep failing without progress are counted from the next keeper pass", off: "loop guard off · every held card is released on the next keeper pass" },
    loopGuardApply: { name: "hold looping cards", on: "holding looping cards · a looping card waits for your Try again", off: "not holding looping cards · the cards it holds are released on the next keeper pass, and it only reports what it would hold" },
  };

  const base = (file) => (file ? file.split(/[\\/]/).pop() : "(unknown)");
  // #tree-explore & friends bind straight to open(), so arg 0 can be a click Event.
  const optionsOf = (value) =>
    value && typeof value === "object" && typeof value.preventDefault !== "function" ? value : {};
  const ago = (time) => {
    if (!Number.isFinite(Number(time)) || !time) return "—";
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
  };

  function status(text, isError) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? "var(--bad)" : "";
  }

  async function load() {
    if (!window.mefiStudio?.eyesState) {
      status("Desktop mode only — run npm start inside mefi-studio.", true);
      treeNote("Desktop mode only — run npm start inside mefi-studio.");
      return;
    }
    const seq = ++loadSeq;
    // The first read of the store can take a second or two on a busy machine;
    // an empty column reads as "nothing here", so say what is happening. This
    // is the pending state open() relies on: the sheet is already up while the
    // read is in flight, and nothing here holds it hostage.
    if (!state.sessions.length) treeNote("Loading sessions…");
    try {
      const [stateResult, requests, checkpoints, briefing, collisions, service] = await Promise.all([
        window.mefiStudio.eyesState().catch((error) => ({ ok: false, error: String(error?.message ?? error) })),
        window.mefiStudio.eyesRequestsRead?.().catch(() => null) ?? null,
        window.mefiStudio.eyesCheckpointsRead?.().catch(() => null) ?? null,
        window.mefiStudio.eyesBriefingRead?.().catch(() => null) ?? null,
        window.mefiStudio.eyesCollisions?.().catch(() => null) ?? null,
        window.mefiStudio.assistantState?.().catch(() => null) ?? null,
      ]);
      // A newer read started while this one was in flight; drop the stale
      // result instead of clobbering the content it already rendered.
      if (seq !== loadSeq) return;
      if (!stateResult?.ok) {
        status(`session store unavailable: ${stateResult?.error ?? "unknown error"}`, true);
      }
      state.sessions = stateResult?.sessions ?? [];
      state.todos = stateResult?.todos ?? [];
      state.changes = stateResult?.changes ?? [];
      state.requests = requests?.requests ?? [];
      state.checkpoints = checkpoints?.checkpoints ?? {};
      state.briefing = briefing?.briefing ?? null;
      state.collisions = collisions?.collisions ?? [];
      state.presence = collisions?.presence ?? [];
      if (service?.ok && service.state) {
        state.assistant = service.state;
        window.MefiTree?.applyAssistant?.({ state: service.state });
      } else {
        state.assistant = window.MefiTree?.assistantState?.() ?? state.assistant;
      }
      paintTreeAndDetail();
      renderAssistant();
      // A failed store read must not read as "nothing here": name the failure
      // in the tree too, and let the next poll tick retry.
      if (!stateResult?.ok && !state.sessions.length) {
        treeNote(`session store unavailable: ${stateResult?.error ?? "unknown error"}`);
      }
      if (!state.audit) runAudit();
      window.mefiStudio?.machineStatus?.().then((result) => {
        // A failed scan must read as degraded, never as a free machine.
        if (result?.ok) renderMachine(result.status);
        else if (els.machineLines) {
          els.machineLines.textContent = `machine scan unavailable: ${result?.error ?? "unknown error"}`;
          els.machineLines.style.color = "var(--bad)";
        }
      }).catch((error) => {
        if (els.machineLines) els.machineLines.textContent = `machine scan failed: ${String(error?.message ?? error)}`;
      });
      // Read once per open, and read-only: machineSet({}) as a read rewrote
      // settings.json and auth.json on every 5 s tick.
      if (!state.machinePrefsRead) {
        state.machinePrefsRead = true;
        (window.mefiStudio?.machineGet ?? window.mefiStudio?.machineSet)?.({}).then((result) => {
          if (result?.ok && els.machineAuto) els.machineAuto.checked = result.machine.autoKill !== false;
          if (result?.ok && els.machineMemoryOverride) els.machineMemoryOverride.checked = result.machine.memoryWarnOverride === true;
        }).catch(() => { state.machinePrefsRead = false; });
      }
    } catch (error) {
      // Never leave the pending "Loading sessions…" note stuck: render the
      // failure and let the poll retry.
      if (seq !== loadSeq) return;
      status(`explorer failed: ${String(error?.message ?? error)}`, true);
      treeNote(`explorer failed: ${String(error?.message ?? error)} — retrying on the next poll`);
    }
  }

  function sessionTodos(sessionId) {
    return state.todos.filter((todo) => todo.sessionId === sessionId);
  }

  function checkpointReference(session, note) {
    const files = (note.files ?? []).join(", ") || "n/a";
    return [
      `A-EYES CHECKPOINT ${new Date(note.at).toISOString()}`,
      `session: ${session.title} (${session.agent ?? "?"} · ${session.model?.id ?? "?"})`,
      `note: ${note.note}`,
      `files: ${files}`,
      note.png ? `visual: ${note.png}` : "visual: n/a",
    ].join("\n");
  }

  async function exploreCheckpoint(session, note) {
    if (!window.mefiStudio?.assistantRun) return;
    status("exploring checkpoint on deepseek-v4.1-flash…");
    const result = await window.mefiStudio.assistantRun("explore", session.id, { note: note.note, at: note.at, files: note.files ?? [] });
    if (!result.ok) {
      status(result.error, true);
      return;
    }
    state.reviews[`${session.id}:${note.at}`] = result.briefing?.review ?? {};
    renderDetail();
    status("checkpoint reviewed");
  }

  function restoreCheckpoint(session, note) {
    if (note.png) {
      // nav exits Command, shows A-Eyes, then dispatches tree-select and
      // restore-png in that order, so eyes.js is listening first (spec 2.6).
      window.MefiNav?.go?.("eyes", { sessionId: session.id, png: note.png });
      window.MefiToast?.(`visual state restored to ${new Date(note.at).toLocaleTimeString()}`, "good");
      return;
    }
    window.mefiStudio?.shellCopy?.(`Restore ${session.title} to ${new Date(note.at).toISOString()} — files: ${(note.files ?? []).join(", ")}`);
    status("no visual attached; restore brief copied to clipboard");
  }

  async function expandCheckpoint(session, note) {
    if (!window.mefiStudio?.assistantRun) return;
    status("expanding checkpoint…");
    const result = await window.mefiStudio.assistantRun("expand", session.id, { note: note.note, at: note.at, files: note.files ?? [] });
    if (!result.ok) {
      status(result.error, true);
      return;
    }
    const drafts = result.briefing?.expand ?? [];
    state.requests.unshift(
      ...drafts.map((draft) => ({ title: draft.title, prompt: draft.prompt, at: Date.now(), source: "expand" }))
    );
    await persistRequests();
    status(`expand: ${drafts.length} draft request${drafts.length === 1 ? "" : "s"} added`);
  }

  function checkpointChip(session, note, index) {
    const li = document.createElement("li");
    li.className = "checkpoint";
    li.draggable = true;
    li.title = "Drag into the request box to reference this checkpoint";
    li.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", checkpointReference(session, note));
      event.dataTransfer.effectAllowed = "copy";
    });
    const head = document.createElement("div");
    head.className = "cp-head";
    head.textContent = `#${index + 1} · ${new Date(note.at).toLocaleTimeString()} · ${note.source ?? "manual"}`;
    const body = document.createElement("div");
    body.className = "cp-note";
    body.textContent = note.note;
    const review = state.reviews[`${session.id}:${note.at}`];
    if (review) {
      const reviewEl = document.createElement("div");
      reviewEl.className = "cp-review";
      reviewEl.textContent = `${review.verdict ?? "review"} — ${review.progress ?? ""}${review.remaining ? ` · remaining: ${review.remaining}` : ""}`;
      body.append(reviewEl);
    }
    const actions = document.createElement("div");
    actions.className = "cp-actions";
    const actionButton = (label, title, handler) => {
      const button = document.createElement("button");
      button.className = "ghost mini";
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
      });
      return button;
    };
    actions.append(
      actionButton("Reference", "Copy this checkpoint as chat context", async () => {
        await window.mefiStudio?.shellCopy?.(checkpointReference(session, note));
        status(`checkpoint #${index + 1} copied — paste it into any chat`);
      }),
      actionButton("Explore", "Review progress, remaining work, and whether it is done", () => exploreCheckpoint(session, note)),
      actionButton("Restore", note.png ? "Reload the visual state captured with this checkpoint" : "Copy a restore brief (no visual attached)", () =>
        restoreCheckpoint(session, note)
      ),
      actionButton("Expand", "Draft follow-up work built on this checkpoint", () => expandCheckpoint(session, note))
    );
    li.append(head, body, actions);
    return li;
  }

  function renderCheckpoints(session) {
    const wrapper = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = "Checkpoints";
    const addRow = document.createElement("div");
    addRow.className = "row tight";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "Log a checkpoint…";
    addInput.className = "grow";
    addInput.autocomplete = "off";
    const addButton = document.createElement("button");
    addButton.className = "ghost";
    addButton.textContent = "Add";
    addButton.addEventListener("click", async () => {
      const value = addInput.value.trim();
      if (!value) return;
      const result = await window.mefiStudio?.checkpointAdd?.(session.id, value);
      if (result?.ok) {
        addInput.value = "";
        status("checkpoint logged");
      }
    });
    addInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addButton.click();
    });
    addRow.append(addInput, addButton);
    const list = document.createElement("ul");
    const notes = state.checkpoints[session.id] ?? [];
    if (!notes.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No checkpoints yet — add one, or let the assistant log them.";
      list.append(empty);
    }
    notes.forEach((note, index) => list.append(checkpointChip(session, note, index)));
    wrapper.append(heading, addRow, list);
    els.detail.append(wrapper);
  }

  function dotClass(sessionId) {
    const todos = sessionTodos(sessionId);
    if (!todos.length) return "dot";
    if (todos.every((todo) => todo.status === "completed")) return "dot done";
    if (todos.some((todo) => todo.status === "in_progress")) return "dot active";
    return "dot";
  }

  function treeNote(text) {
    if (!els.tree) return;
    els.tree.textContent = "";
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = text;
    els.tree.append(li);
  }

  const TODO_DOT = { completed: "dot done", in_progress: "dot active" };

  function renderTree() {
    els.tree.textContent = "";
    const allRoots = state.sessions.filter((session) => !session.parentId);
    if (!allRoots.length) {
      treeNote("No sessions in the OpenCode store yet.");
      return;
    }
    // The assistant's organisation orders the roots (active, working, stale) and
    // names the finished ones, which collapse under one row at the bottom. The
    // Explorer is the full list, so roots past the tree's cap follow the ordered ones.
    const org = state.assistant?.organization ?? null;
    const foldedSet = new Set(Array.isArray(org?.folded) ? org.folded : []);
    const staleSet = new Set(Array.isArray(org?.stale) ? org.stale : []);
    const byId = new Map(allRoots.map((session) => [session.id, session]));
    const orderedIds = Array.isArray(org?.order) ? org.order : [];
    const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    const rest = allRoots.filter((session) => !orderedIds.includes(session.id) && !foldedSet.has(session.id));
    const roots = [...ordered, ...rest];
    const folded = allRoots.filter((session) => foldedSet.has(session.id));
    const children = (id) => state.sessions.filter((session) => session.parentId === id);
    const row = (labelText, whoText, className, onSelect, sessionId, todoStatus, tag) => {
      const li = document.createElement("li");
      if (className) li.className = className;
      if (sessionId && sessionId === state.selected) li.classList.add("selected");
      const dot = document.createElement("span");
      // Sessions summarise their todos; a todo row shows its own status, so a
      // finished list reads green at a glance instead of a column of grey dots.
      dot.className = sessionId ? dotClass(sessionId) : TODO_DOT[todoStatus] ?? "dot";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = labelText;
      if (tag) {
        const mark = document.createElement("span");
        mark.className = `src-tag ${tag}`;
        mark.textContent = tag.toUpperCase();
        label.prepend(mark, " ");
      }
      if (whoText) {
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = ` · ${whoText}`;
        label.append(who);
      }
      li.append(dot, label);
      const notes = sessionId ? state.checkpoints[sessionId] : null;
      if (notes?.length) {
        const bubble = document.createElement("span");
        bubble.className = "bubble";
        bubble.title = `${notes.length} checkpoint${notes.length === 1 ? "" : "s"}: ${notes[0].note}`;
        li.append(bubble);
      }
      // Focusable because nav's claim() focuses "#explorer-tree li.selected".
      li.tabIndex = 0;
      li.title = labelText;
      li.addEventListener("click", onSelect);
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          li.click();
        }
      });
      els.tree.append(li);
      return li;
    };

    const walk = (session, depth, extra = "") => {
      const stale = staleSet.has(session.id);
      const classes = [depth ? "indent" : "", stale ? "stale" : "", extra].filter(Boolean).join(" ");
      row(
        session.title || session.id,
        `${session.agent ?? "?"} · ${session.model?.id ?? "?"} · ${ago(session.timeUpdated)}`,
        classes,
        () => select(session.id),
        session.id,
        undefined,
        stale ? "stale" : null
      );
      for (const todo of sessionTodos(session.id)) {
        row(todo.content, String(todo.status ?? "pending").replace("_", " "), extra ? `indent ${extra}` : "indent", () => select(session.id), null, todo.status);
      }
      for (const child of children(session.id)) walk(child, depth + 1, extra);
    };
    roots.forEach((session) => walk(session, 0));
    if (folded.length) {
      const li = document.createElement("li");
      li.className = `folded-row${state.foldedOpen ? " open" : ""}`;
      li.tabIndex = 0;
      li.title = "Finished sessions the assistant folded away — click to expand";
      const dot = document.createElement("span");
      dot.className = "dot done";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = `Finished (${folded.length})`;
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = state.foldedOpen ? " · click to collapse" : " · click to expand";
      label.append(who);
      li.append(dot, label);
      li.addEventListener("click", () => {
        state.foldedOpen = !state.foldedOpen;
        renderTree();
      });
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          li.click();
        }
      });
      els.tree.append(li);
      if (state.foldedOpen) folded.forEach((session) => walk(session, 1, "folded"));
    }
  }

  // The 5 s poll re-reads everything. Repainting identical rows would wipe a
  // half-typed checkpoint and pull keyboard focus off the tree, so the poll
  // repaints only when something the tree or the detail shows has changed
  // (the minute bucket keeps the "3m ago" labels honest).
  let paintedSignature = "";
  function treeSignature() {
    const org = state.assistant?.organization ?? null;
    return JSON.stringify([
      state.selected, Boolean(state.foldedOpen), Math.floor(Date.now() / 60000),
      state.sessions.map((s) => [s.id, s.parentId, s.title, s.agent, s.model?.id, s.timeUpdated, s.cost, s.tokens?.input, s.tokens?.output]),
      state.todos.map((t) => [t.id, t.sessionId, t.status, t.content]),
      Object.entries(state.checkpoints ?? {}).map(([id, notes]) => [id, notes?.length ?? 0, notes?.[0]?.note]),
      state.changes.filter((c) => c.sessionId === state.selected).slice(0, 12).map((c) => [c.id, c.time]),
      [org?.order, org?.folded, org?.stale],
    ]);
  }
  function paintTreeAndDetail() {
    const signature = treeSignature();
    if (signature === paintedSignature) return;
    const active = document.activeElement;
    const draft = els.detail?.querySelector?.("input.grow");
    const draftValue = draft?.value ?? "";
    const draftFocused = Boolean(draft) && active === draft;
    const treeIndex = active && els.tree?.contains?.(active) ? [...els.tree.children].indexOf(active) : -1;
    renderTree();
    renderDetail();
    paintedSignature = signature;
    const nextDraft = els.detail?.querySelector?.("input.grow");
    if (nextDraft && draftValue) nextDraft.value = draftValue;
    if (nextDraft && draftFocused) nextDraft.focus({ preventScroll: true });
    else if (treeIndex >= 0) els.tree.children[Math.min(treeIndex, els.tree.children.length - 1)]?.focus?.({ preventScroll: true });
  }

  function revealSelected() {
    // .explorer-col is the scroller, so this moves the column, not the page.
    els.tree?.querySelector("li.selected")?.scrollIntoView({ block: "center" });
  }

  function select(sessionId) {
    state.selected = sessionId;
    window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId } }));
    renderTree();
    renderDetail();
    paintedSignature = treeSignature();
    revealSelected();
  }

  function renderDetail() {
    const session = state.sessions.find((item) => item.id === state.selected);
    els.detail.textContent = "";
    els.explorerTitle.textContent = session ? session.title : "Select a session";
    if (!session) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Pick a session on the left, or a node in the rail behind this sheet.";
      els.detail.append(hint);
      return;
    }
    const section = (title, build) => {
      const wrapper = document.createElement("section");
      const heading = document.createElement("h4");
      heading.textContent = title;
      const list = document.createElement("ul");
      build(list);
      wrapper.append(heading, list);
      els.detail.append(wrapper);
    };
    section("Session", (list) => {
      for (const [key, value] of [
        ["agent", session.agent ?? "?"],
        ["model", session.model?.id ?? "?"],
        ["updated", ago(session.timeUpdated)],
        ["cost", `$${Number(session.cost ?? 0).toFixed(3)}`],
        ["tokens in/out", `${session.tokens?.input ?? 0} / ${session.tokens?.output ?? 0}`],
        ["id", session.id],
      ]) {
        const li = document.createElement("li");
        const k = document.createElement("span");
        k.textContent = key;
        const v = document.createElement("b");
        v.textContent = String(value);
        li.append(k, v);
        list.append(li);
      }
    });
    // Two ways back out of the sheet, both through nav so it closes itself.
    const links = document.createElement("div");
    links.className = "row tight";
    const link = (label, title, handler) => {
      const button = document.createElement("button");
      button.className = "ghost mini";
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", handler);
      links.append(button);
    };
    link("Filter A-Eyes feed", "Show only this session's changes in the A-Eyes feed (3)", () =>
      window.MefiNav?.go?.("eyes", { sessionId: session.id })
    );
    link("Open in Command", "Select this session in the Command view (D)", () =>
      window.MefiNav?.go?.("command", { sessionId: session.id })
    );
    els.detail.append(links);
    const todos = sessionTodos(session.id);
    if (todos.length) {
      section("Tasks", (list) => {
        for (const todo of todos) {
          const li = document.createElement("li");
          const k = document.createElement("span");
          k.textContent = `${todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "→" : "·"} ${todo.content}`;
          const v = document.createElement("b");
          v.textContent = todo.status;
          li.append(k, v);
          list.append(li);
        }
      });
    }
    const changes = state.changes.filter((change) => change.sessionId === session.id).slice(0, 12);
    if (changes.length) {
      section("Recent changes", (list) => {
        for (const change of changes) {
          const li = document.createElement("li");
          const k = document.createElement("span");
          k.textContent = `${base(change.file)} · ${ago(change.time)}`;
          k.title = change.file ?? "";
          const v = document.createElement("b");
          v.textContent = change.tool === "patch" ? `${change.files?.length ?? 0} files` : `+${change.additions}/-${change.deletions}`;
          li.append(k, v);
          list.append(li);
        }
      });
    }
    renderCheckpoints(session);
  }

  function renderAudit() {
    if (!els.auditFindings) return;
    els.auditFindings.textContent = "";
    const findings = state.audit?.findings ?? [];
    if (!findings.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No findings yet — press Audit now.";
      els.auditFindings.append(li);
      return;
    }
    for (const finding of findings.slice(0, 14)) {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = `src-tag ${finding.level === "error" ? "fix" : finding.level === "warn" ? "collision" : "improver"}`;
      tag.textContent = finding.level.toUpperCase();
      li.append(tag, document.createTextNode(` ${finding.area}: ${finding.message}`));
      li.title = finding.message;
      els.auditFindings.append(li);
    }
  }

  function renderMachine(status) {
    if (!els.machineLines) return;
    state.machine = status;
    // The severe-memory cap rides the capacity resources: holdKind
    // "memory-cap" is the active hold (canStart false), memorySevereCapped
    // the latch that outlives it — a drained pool may start one worker while
    // still capped, so the panel must not read as a fully free machine.
    const resources = status?.capacity?.resources ?? null;
    const memoryCapped = resources?.memorySevereCapped === true || resources?.holdKind === "memory-cap";
    els.machineLines.textContent = status?.lines ?? "no scan yet";
    els.machineLines.style.color = status?.leases?.exclusive ? "var(--warn)" : status?.wait || memoryCapped ? "var(--info)" : "";
    if (els.machineBadge) {
      els.machineBadge.textContent = status?.wait ? (status.leases.exclusive ? "exclusive" : "busy") : memoryCapped ? "memory cap" : "idle";
      els.machineBadge.className = `badge ${status?.wait || memoryCapped ? "trains" : "free"}`;
      els.machineBadge.title = memoryCapped ? "Severe-memory parallelism cap latched — worker starts stay capped until free memory recovers past the release band." : "";
    }
    els.machineList.textContent = "";
    for (const entry of status?.running ?? []) {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("span"), { className: `src-tag ${entry.status === "healthy" ? "improver" : "fix"}`, textContent: entry.status.toUpperCase() }));
      li.append(document.createTextNode(` pid ${entry.pid} · ${entry.ageMinutes}m · ${entry.memMB}MB`));
      const killButton = document.createElement("button");
      killButton.className = "ghost mini";
      killButton.textContent = "×";
      killButton.title = "Kill this run";
      killButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await window.mefiStudio?.machineKill?.(entry.pid);
        window.MefiToast?.(`kill sent for pid ${entry.pid}`, "bad");
      });
      li.append(killButton);
      els.machineList.append(li);
    }
    for (const holder of status?.leases?.holders ?? []) {
      const li = document.createElement("li");
      li.textContent = `lease: ${holder.label || holder.agent} · width ${holder.width}${holder.exclusive ? " · EXCLUSIVE" : ""} · ${holder.ageMinutes}m`;
      els.machineList.append(li);
    }
    if (!els.machineList.children.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No test leases or LOVE runs — machine is free.";
      els.machineList.append(li);
    }
    els.machineEvents.textContent = "";
    for (const event of (status?.actions ?? []).slice(0, 5)) {
      const li = document.createElement("li");
      li.textContent = `killed pid ${event.pid} (${event.status})`;
      li.title = event.commandLine ?? "";
      els.machineEvents.append(li);
    }
    if (!els.machineEvents.children.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No resource actions yet.";
      els.machineEvents.append(li);
    }
  }

  async function runAudit() {    if (!window.mefiStudio?.auditorRun) return;
    if (els.auditStatus) els.auditStatus.textContent = "auditing…";
    const result = await window.mefiStudio.auditorRun();
    state.audit = result;
    renderAudit();
    if (result?.ai?.ok) {
      state.briefing = result.ai.briefing;
      renderAssistant();
    }
    if (els.auditStatus) {
      els.auditStatus.textContent = `${result?.errors ?? 0} error(s) · ${result?.warnings ?? 0} warning(s) · ${result?.queued ?? 0} queued`;
      els.auditStatus.style.color = result?.errors ? "var(--bad)" : "";
    }
  }

  // The log kinds map onto the request-inbox tag palette: red for errors, amber
  // for collisions, green for work done, ivory for the thread, gold otherwise.
  function logTagClass(kind) {
    if (kind === "error") return "fix";
    if (kind === "collision") return "collision";
    if (kind === "tidy" || kind === "organize" || kind === "fix") return "tidy";
    if (kind === "message" || kind === "reply" || kind === "think") return "chat";
    return "";
  }

  function bubble(message) {
    const thought = message.role === "thinking";
    const element = document.createElement("div");
    element.className = `assistant-msg ${message.role === "user" ? "user" : thought ? "assistant thinking" : "assistant"}`;
    element.textContent = String(message.text ?? "");
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = thought
      ? `${ago(message.at)} · thinking`
      : `${ago(message.at)}${message.role !== "user" && message.via === "local" ? " · local" : ""}`;
    element.append(when);
    return element;
  }

  // The composer is a textarea that grows with the draft up to a few lines.
  function growArea(area) {
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(120, Math.max(38, area.scrollHeight))}px`;
  }

  // A responder job in the work journal means a reply is being written — the
  // dots go up even when the send came from another surface.
  function replyPending(service) {
    if (String(service?.thinking?.text ?? "").trim()) return true;
    const work = Array.isArray(service?.work) ? service.work : [];
    if (work.some((job) => job.kind === "responder" || job.role === "responder" || job.role === "thinker")) return true;
    return (Array.isArray(service?.agents) ? service.agents : []).some((agent) => agent?.role === "thinker" && agent.status === "running");
  }

  function thinkingBubble(service) {
    const element = document.createElement("div");
    element.className = "assistant-msg assistant thinking";
    const live = String(service?.thinking?.text ?? "").trim();
    if (live) {
      const line = document.createElement("span");
      line.className = "thought";
      line.textContent = live;
      element.append(line);
    }
    const dots = document.createElement("span");
    dots.className = "dots";
    dots.setAttribute("aria-label", live ? "the assistant is thinking" : "the assistant is replying");
    dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    element.append(dots);
    return element;
  }

  // The audit switches save through the desktop bridge only, and Hold looping
  // cards means nothing while the loop guard itself is off.
  function syncAuditSwitches() {
    const bridge = Boolean(window.mefiStudio?.assistantPrefs);
    for (const key of Object.keys(AUDIT_SWITCHES)) if (els[key]) els[key].disabled = !bridge;
    if (els.loopGuardApply && els.loopGuard?.checked === false) els.loopGuardApply.disabled = true;
  }

  // The service part of the column: status line, thread, composer, the three
  // controls, activity and housekeeping. Cheap enough to run on every push.
  function renderAssistantService() {
    const service = state.assistant;
    const bridge = Boolean(window.mefiStudio?.assistantMessage);
    const summary = window.MefiTree?.assistantSummary?.(service) ?? { sublabel: bridge ? "starting…" : "desktop app only", tone: bridge ? "paused" : "offline" };
    if (els.service) {
      if (!bridge) els.service.textContent = "desktop app only — the assistant service runs inside the desktop app.";
      else if (!service) els.service.textContent = "service starting…";
      else {
        const unread = Number(service.unread) || 0;
        const focused = service.focus?.id ? ` · on "${String(service.focus.label || service.focus.id).slice(0, 30)}"` : "";
        els.service.textContent = `${summary.sublabel} · tick ${service.tickCount ?? 0} · heartbeat ${ago(service.heartbeatAt)}${focused}${unread ? ` · ${unread} unread` : ""}`;
      }
      // The short form on the line, the whole text in its tooltip.
      els.service.title = summary.detail ?? summary.sublabel ?? "";
      els.service.dataset.tone = summary.tone;
    }
    if (els.input) {
      els.input.disabled = !bridge;
      const focused = service?.focus?.id ? service.focus : null;
      els.input.placeholder = !bridge
        ? "desktop app only"
        : focused
          ? `Work on "${String(focused.label || focused.id).slice(0, 40)}"… (Enter)`
          : "Message the assistant… (Enter)";
      growArea(els.input);
    }
    if (els.send) els.send.disabled = !bridge;
    for (const button of [els.tidy, els.fix, els.pause, els.stopAll, els.restart]) if (button) button.disabled = !bridge;
    if (els.pause) els.pause.textContent = service?.status === "paused" ? "Resume" : "Pause";
    if (els.proactive) {
      els.proactive.disabled = !bridge;
      if (service?.prefs) els.proactive.checked = service.prefs.proactive !== false;
    }
    for (const key of Object.keys(AUDIT_SWITCHES)) {
      if (els[key] && service?.prefs) els[key].checked = service.prefs[key] !== false;
    }
    syncAuditSwitches();
    if (els.thread) {
      els.thread.textContent = "";
      const messages = (service?.messages ?? []).slice(-20);
      if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = bridge
          ? "No messages yet. Ask for a status, say what to tidy or fix, or give it work — a reply always comes back."
          : "The thread lives in the desktop app.";
        els.thread.append(empty);
      }
      for (const message of messages) els.thread.append(bubble(message));
      const live = String(service?.thinking?.text ?? "").trim();
      const last = messages[messages.length - 1];
      const sameLive = Boolean(live && last?.role === "thinking" && String(last.text ?? "") === live);
      if (replyPending(service) && !sameLive) els.thread.append(thinkingBubble(service));
      const scrolled = Math.abs(els.thread.scrollHeight - els.thread.scrollTop - els.thread.clientHeight) < 40;
      if (scrolled) els.thread.scrollTop = els.thread.scrollHeight;
    }
    if (els.activity) {
      els.activity.textContent = "";
      const log = (service?.log ?? []).slice(-8).reverse();
      if (!log.length) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = bridge ? "No activity yet — the first tick lands within a minute." : "No service in the browser.";
        els.activity.append(li);
      }
      for (const entry of log) {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = `src-tag ${logTagClass(entry.kind)}`;
        tag.textContent = String(entry.kind ?? "log").toUpperCase();
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String(entry.text ?? "");
        text.title = text.textContent;
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = ago(entry.at);
        li.append(tag, text, when);
        els.activity.append(li);
      }
    }
    if (els.work) {
      els.work.textContent = "";
      const work = Array.isArray(service?.work) ? service.work : [];
      if (!work.length) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = bridge ? "Nothing in flight." : "No journal in the browser.";
        els.work.append(li);
      }
      for (const job of work) {
        const li = document.createElement("li");
        const tag = document.createElement("span");
        tag.className = `src-tag ${job.status === "queued" ? "improver" : ""}`;
        tag.textContent = String(job.kind ?? job.role ?? "job").toUpperCase();
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String(job.text ?? "");
        text.title = `${text.textContent}${job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}`;
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = job.status === "queued" ? "queued" : `started ${ago(job.startedAt)}`;
        li.append(tag, text, when);
        els.work.append(li);
      }
    }
    if (els.agents) {
      els.agents.textContent = "";
      const roster = Array.isArray(service?.agents) ? service.agents : [];
      const head = document.createElement("li");
      head.className = roster.length ? "agents-head" : "muted";
      if (!roster.length) head.textContent = bridge ? "No agents reported yet." : "No agents in the browser.";
      else {
        const working = roster.filter((agent) => agent.status === "running").length;
        const queued = roster.filter((agent) => agent.status === "queued").length;
        const pool = service.pool ?? {};
        head.textContent = `${roster.length} agents · ${working} working${queued ? ` · ${queued} queued` : ""} · ${pool.parallel ?? service.prefs?.parallel ?? "?"} in parallel · ${pool.aiParallel ?? service.prefs?.aiParallel ?? "?"} on AI`;
      }
      els.agents.append(head);
      for (const agent of roster) {
        const li = document.createElement("li");
        li.className = `agent-${agent.status ?? "idle"}`;
        li.style.borderLeftColor = window.MefiTree?.agentColor?.(agent.role) ?? "";
        const tag = document.createElement("span");
        tag.className = `src-tag ${agent.status === "error" ? "fix" : agent.status === "running" ? "" : agent.status === "queued" ? "improver" : "stale"}`;
        tag.textContent = String(agent.status ?? "idle").toUpperCase();
        const name = document.createElement("b");
        name.textContent = agent.role;
        // Same colour coding as the constellation; errored agents keep warn.
        if (agent.status !== "error") name.style.color = window.MefiTree?.agentColor?.(agent.role) ?? "";
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = String((agent.status === "error" && agent.error) || agent.text || "");
        text.title = text.textContent;
        const when = document.createElement("span");
        when.className = "when";
        when.textContent = agent.status === "running" ? `since ${ago(agent.since)}` : agent.lastRunAt ? ago(agent.lastRunAt) : "never";
        li.append(tag, name, text, when);
        els.agents.append(li);
      }
    }
    if (els.housekeeping) {
      const housekeeping = service?.housekeeping ?? null;
      els.housekeeping.textContent = housekeeping?.lastAt
        ? `last tidy ${ago(housekeeping.lastAt)} · ${housekeeping.tasksArchived ?? 0} tasks archived · ${housekeeping.ideasPruned ?? 0} ideas pruned · ${housekeeping.requestsCleared ?? 0} requests cleared · ${housekeeping.checkpointsDropped ?? 0} checkpoints dropped`
        : "no housekeeping yet";
      els.housekeeping.title = housekeeping?.lastText ?? "";
    }
    // Replies read here count as seen; main zeroes unread and pushes the state.
    if (bridge && !els.overlay?.hidden && Number(service?.unread) > 0 && Date.now() - state.seenAt > 5000 && window.mefiStudio?.assistantControl) {
      state.seenAt = Date.now();
      window.mefiStudio
        .assistantControl("seen")
        .then((result) => {
          if (result?.ok && result.state) takeAssistant(result.state);
        })
        .catch(() => {});
    }
  }

  function takeAssistant(next) {
    if (!next) return;
    state.assistant = next;
    window.MefiTree?.applyAssistant?.({ state: next });
    renderAssistantService();
  }

  async function sendMessage(direct) {
    // Chips pass their prompt in; the click handler passes the event instead.
    const text = String(typeof direct === "string" ? direct : els.input?.value ?? "").trim();
    if (!text) return;
    if (!window.mefiStudio?.assistantMessage) {
      status("desktop app only", true);
      return;
    }
    els.send.disabled = true;
    status("sending…");
    try {
      const result = await window.mefiStudio.assistantMessage(text);
      if (!result?.ok) {
        status(result?.error ?? "not sent", true);
        return;
      }
      // A chip send keeps a half-typed draft: only clear what just went out.
      if (els.input.value.trim() === text) {
        els.input.value = "";
        growArea(els.input);
      }
      takeAssistant(result.state);
      status(result.reply?.via === "ai" ? "replied on deepseek-v4.1-flash" : "replied locally");
    } catch (error) {
      status(`not sent · ${String(error?.message ?? error)}`, true);
    } finally {
      els.send.disabled = !window.mefiStudio?.assistantMessage;
      els.input?.focus();
    }
  }

  async function control(action) {
    if (!window.mefiStudio?.assistantControl) {
      status("desktop app only", true);
      return;
    }
    status(`${action}…`);
    try {
      const result = await window.mefiStudio.assistantControl(action);
      if (!result?.ok) {
        status(result?.error ?? `${action} failed`, true);
        return;
      }
      takeAssistant(result.state);
      const service = state.assistant ?? {};
      if (action === "tidy") status(service.housekeeping?.lastText || "tidy pass done");
      else if (action === "fix") {
        const last = (service.fixes ?? []).slice(-1)[0];
        status(last ? `fix · ${last.text}` : "fix pass done · nothing to repair");
      } else if (action === "organize") {
        renderTree();
        status("tree organised");
      } else if (action === "overseer") {
        const overseer = service.overseer;
        status(overseer?.lastSummary ? `overseer · ${overseer.lastSummary}` : "overseer review queued");
      } else if (action === "stop-all") {
        const stopped = Number(result.stopped) || 0;
        status(stopped ? `stopped ${stopped} agent(s) · progress saved, work stays queued` : "no agents were running · new work is off");
      } else status(`assistant ${service.status ?? action}`);
    } catch (error) {
      status(`${action} failed · ${String(error?.message ?? error)}`, true);
    }
  }

  // Restart with the agents stopped first, so a running build cannot defer the
  // relaunch. Studio comes back paused; Resume starts work again.
  async function restartStudio() {
    if (!window.mefiStudio?.appRestart) {
      status("desktop app only", true);
      return;
    }
    status("stopping agents, then restarting…");
    try {
      const result = await window.mefiStudio.appRestart({ stopAgents: true });
      if (result?.deferred) status(`restart deferred · ${result.reason ?? "work is still running"}`);
      else if (result?.ok === false) status(result.error ?? "restart failed", true);
    } catch (error) {
      status(`restart failed · ${String(error?.message ?? error)}`, true);
    }
  }

  function renderAssistant() {
    renderAssistantService();
    if (els.model) els.model.textContent = state.assistant?.ai?.model || "not connected";
    els.brief.textContent = "";
    if (!state.briefing) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "No briefing yet. Save an OpenCode Go key in Studio, then press Brief me.";
      els.brief.append(hint);
    } else {
      const summary = document.createElement("div");
      summary.className = "summary";
      summary.textContent = state.briefing.summary ?? "(no summary)";
      els.brief.append(summary);
      for (const alert of state.briefing.alerts ?? []) {
        const block = document.createElement("div");
        block.className = `alert ${alert.severity ?? "info"}`;
        const title = document.createElement("div");
        title.className = "t";
        const name = document.createElement("span");
        name.textContent = alert.title ?? "alert";
        const severity = document.createElement("span");
        severity.textContent = alert.severity ?? "info";
        title.append(name, severity);
        const detail = document.createElement("div");
        detail.className = "d";
        detail.textContent = alert.detail ?? "";
        block.append(title, detail);
        els.brief.append(block);
      }
      const meta = document.createElement("p");
      meta.className = "eyes-status";
      meta.textContent = `${state.briefing.model ?? ""} · ${ago(Date.parse(state.briefing.generatedAt))}`;
      els.brief.append(meta);
    }
    // Collateral watch is independent of a briefing: live editors and
    // collisions still paint when the brief column is empty.
    renderCollisions();
  }

  function sessionRows(entries) {
    return (entries ?? []).map((entry) => (typeof entry === "string" ? { sessionId: entry } : entry));
  }

  function shortId(id) {
    return String(id ?? "").slice(-6);
  }

  function clock(time) {
    return Number.isFinite(time) ? new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  }

  // A session's edit window inside the collision, e.g. "14:02–14:38".
  function windowLabel(entry) {
    const first = clock(entry?.firstEdit);
    const last = clock(entry?.lastEdit);
    return first && last ? `${first}–${last}` : "";
  }

  // The row's time range: the group's overlap window when the sessions
  // genuinely co-edited, otherwise the span from the earliest to the latest
  // edit (a gap-tolerated handoff has an empty intersection).
  function overlapRange(collision, rows) {
    const overlap = collision.overlap;
    if (overlap && Number.isFinite(overlap.first) && Number.isFinite(overlap.last) && overlap.first <= overlap.last) {
      return overlap;
    }
    const windows = rows.filter((entry) => Number.isFinite(entry.firstEdit) && Number.isFinite(entry.lastEdit));
    if (!windows.length) return null;
    return {
      first: Math.min(...windows.map((entry) => entry.firstEdit)),
      last: Math.max(...windows.map((entry) => entry.lastEdit)),
    };
  }

  // The same live rule idle.js's checkCollisions applies: only sessions with
  // an active edit keep a collision live. An idle-only group is history — its
  // row still lists with its handoff labels — but it must not hide the live
  // solo editors the presence read reports on the same files.
  function collisionIsLive(collision) {
    return (collision?.sessions ?? []).some((entry) => entry && typeof entry === "object" && entry.active === true);
  }

  function renderCollisions() {
    if (!els.collisions) return;
    els.collisions.textContent = "";
    const collidingFiles = new Set(
      (state.collisions ?? [])
        .filter(collisionIsLive)
        .flatMap((collision) => collision.files ?? [collision.file])
        .filter(Boolean)
    );
    const liveSolo = (state.presence ?? []).filter((row) => row?.file && !row.colliding && !collidingFiles.has(row.file));
    if (!state.collisions.length && !liveSolo.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No live editors or file collisions.";
      els.collisions.append(li);
      return;
    }
    for (const collision of state.collisions) {
      const li = document.createElement("li");
      const files = collision.files ?? [collision.file];
      const grouped = files.length > 1 ? ` · ${files.length} files` : "";
      const rows = sessionRows(collision.sessions);
      const activeRows = rows.filter((entry) => entry.active === true);
      const ownerIdle = rows.some((entry) => entry.sessionId === collision.owner && entry.active === false);
      const activity = ownerIdle ? "handoff" : activeRows.length ? `${activeRows.length} active` : "idle";
      // Every per-file owner is shown, not just the group's overall owner: a
      // stalled owner sitting on one file while a peer owns another must name
      // both. An idle owner with an overlapping live peer is a handoff, so the
      // live peer is named beside it instead of the single stale owner.
      const splitOwners = [...new Set((collision.ownership ?? []).map((row) => row?.owner).filter(Boolean))];
      const owners = splitOwners.length ? splitOwners : collision.owner ? [collision.owner] : [];
      const peer = ownerIdle && activeRows.length ? activeRows[0] : null;
      const holders = owners.map((id) => `${shortId(id)}${id === collision.owner && ownerIdle ? " (idle)" : ""}`);
      if (peer && !owners.includes(peer.sessionId)) holders.push(`${shortId(peer.sessionId)} live`);
      const ownerLabel = holders.join(" + ");
      const ownerName = collision.owner ? shortId(collision.owner) : "none";
      const ownerBit = !ownerLabel ? "" : owners.length > 1 || peer ? ` · ${ownerLabel}` : ` · owner ${ownerLabel}`;
      const range = overlapRange(collision, rows);
      const rangeBit = range ? ` · ${clock(range.first)}–${clock(range.last)}` : "";
      // Detail header: the shared overlap window when the sessions truly
      // co-edited, else the handoff span — the same distinction the
      // dispatched fix prompt draws between "Overlap window" and "Edit span".
      const overlap = collision.overlap;
      const shared = Boolean(
        overlap && Number.isFinite(overlap.first) && Number.isFinite(overlap.last) && overlap.first <= overlap.last
      );
      const rangeHead = range
        ? shared
          ? `overlap window ${clock(range.first)}–${clock(range.last)}`
          : `no shared window · handoff span ${clock(range.first)}–${clock(range.last)}`
        : "no shared window";
      li.textContent = `${base(collision.file)} · ${rows.length} sessions · ${collision.edits} edits${grouped} · ${activity}${ownerBit}${rangeBit}`;
      // Tab must reach every collision row, and a screen reader needs the
      // owner in the accessible name — the bare textContent alone is not one.
      const holderPhrase = owners.length > 1 || peer ? ownerLabel || `owner ${ownerName}` : ownerLabel ? `owner ${ownerLabel}` : `owner ${ownerName}`;
      li.tabIndex = 0;
      li.setAttribute(
        "aria-label",
        `Collision on ${base(collision.file)}${grouped ? `, ${files.length} files` : ""}, ` +
          `${rows.length} sessions, ${collision.edits} edits, ${activity}, ${holderPhrase}` +
          (range
            ? shared
              ? `, overlap window ${clock(range.first)}–${clock(range.last)}`
              : `, no shared window, handoff span ${clock(range.first)}–${clock(range.last)}`
            : ", no shared window")
      );
      const ownership = (collision.ownership ?? [])
        .filter((row) => row?.owner)
        .map((row) => `${base(row.file)} → ${shortId(row.owner)}`);
      li.title =
        (rangeHead ? `${rangeHead}\n` : "") +
        `${files.join("\n")}` +
        (ownership.length ? `\n${ownership.join("\n")}` : "") +
        `\n` +
        rows
          .map((entry) => {
            const edits = entry.edits ? ` ×${entry.edits}` : "";
            const windowBit = windowLabel(entry);
            const flag = entry.sessionId === collision.owner ? " ← owner" : "";
            const owned = (entry.files ?? []).map((file) => base(file)).filter(Boolean);
            const filesBit = owned.length ? ` on ${owned.join(", ")}` : "";
            const ownerFlag =
              entry.sessionId === collision.owner && entry.active === false
                ? " ← owner (inactive, confirm handoff)"
                : flag;
            return `${entry.sessionId}${edits}${entry.active === false ? " (idle)" : " (active)"}${windowBit ? ` ${windowBit}` : ""}${ownerFlag}${filesBit}`;
          })
          .join("\n");
      els.collisions.append(li);
    }
    for (const row of liveSolo) {
      const li = document.createElement("li");
      const editors = sessionRows(row.editors);
      const ownerName = row.owner ? shortId(row.owner) : "none";
      const owner = row.owner ? ` · owner ${ownerName}` : "";
      li.textContent = `${base(row.file)} · live ${editors.length} editor${editors.length === 1 ? "" : "s"}${owner}`;
      li.tabIndex = 0;
      li.setAttribute(
        "aria-label",
        `Live editor on ${base(row.file)}, ${editors.length} editor${editors.length === 1 ? "" : "s"}, owner ${ownerName}`
      );
      li.title = editors
        .map((entry) => `${entry.sessionId}${entry.edits ? ` ×${entry.edits}` : ""} (active)`)
        .join("\n");
      els.collisions.append(li);
    }
  }

  function renderRequests() {
    els.requests.textContent = "";
    if (!state.requests.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Inbox empty. Add a request, or use Grow / Proactive.";
      els.requests.append(li);
      return;
    }
    state.requests.forEach((request, index) => {
      const li = document.createElement("li");
      const text = document.createElement("span");
      const tag = document.createElement("span");
      tag.className = `src-tag ${request.source ?? "manual"}`;
      tag.textContent = request.source === "fix" ? "FIX" : request.source === "collision" ? "COLLIDE" : request.source === "duplicate" ? "DUP" : request.source === "improver" ? "IMPROVE" : request.source === "grow" ? "GROW" : "REQ";
      const label = document.createElement("span");
      label.textContent = request.title ? ` ${request.title} — ${request.prompt ?? ""}` : ` ${request.prompt ?? ""}`;
      text.append(tag, label);
      text.title = request.prompt ?? "";
      const actions = document.createElement("span");
      const copy = document.createElement("button");
      copy.className = "ghost mini";
      copy.textContent = "Copy";
      copy.addEventListener("click", async (event) => {
        event.stopPropagation();
        await window.mefiStudio?.shellCopy?.(request.prompt ?? request.title ?? "");
        status(`copied request ${index + 1}`);
      });
      const remove = document.createElement("button");
      remove.className = "ghost mini";
      remove.textContent = "×";
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        state.requests.splice(index, 1);
        await persistRequests();
      });
      actions.append(copy, remove);
      li.append(text, actions);
      els.requests.append(li);
    });
  }

  async function persistRequests() {
    await window.mefiStudio?.eyesRequestsWrite?.(state.requests);
    renderRequests();
  }

  // sessionId/payload are optional: the header buttons pass neither, the Command
  // view's checkpoint actions pass both (idle.js) — and used to have them dropped.
  async function runAssistant(mode, sessionId, payload) {
    if (!window.mefiStudio?.assistantRun) return;
    const target = typeof sessionId === "string" && sessionId ? sessionId : state.selected;
    status(`${mode} running on deepseek-v4.1-flash…`);
    els.briefRun.disabled = true;
    els.growRun.disabled = true;
    try {
      const result = await window.mefiStudio.assistantRun(mode, target, payload);
      if (!result.ok) {
        status(result.error, true);
        return;
      }
      if (mode === "grow" || mode === "improve" || mode === "expand") {
        const drafts = result.briefing?.expand ?? [];
        state.requests.unshift(
          ...drafts.map((draft) => ({
            title: draft.title,
            prompt: draft.prompt,
            at: Date.now(),
            source: mode === "improve" ? "improver" : mode === "expand" ? "expand" : "grow",
          }))
        );
        await persistRequests();
        status(`${mode}: ${drafts.length} draft request${drafts.length === 1 ? "" : "s"} added to the inbox`);
      } else {
        state.briefing = result.briefing;
        state.checkpoints = result.checkpoints ?? state.checkpoints;
        renderAssistant();
        renderTree();
        renderDetail();
        status(`briefed · ${new Date().toLocaleTimeString()}`);
      }
    } finally {
      els.briefRun.disabled = false;
      els.growRun.disabled = false;
    }
  }

  function open(options) {
    // A restored deep link (nav's resumeReady) runs from its own
    // DOMContentLoaded handler, which is registered before this module's
    // init(); open() can therefore reach the els.overlay write below while the
    // map is still empty, throwing "Cannot set properties of undefined
    // (setting 'hidden')". Build the map on demand — init() is idempotent and
    // only safe once the document is parsed — then bail if the overlay is
    // genuinely absent instead of throwing.
    if (!els.overlay && document.readyState !== "loading") init();
    if (!els.overlay) return Promise.resolve();
    window.MefiNav?.claim?.("explorer");
    const params = optionsOf(options);
    els.overlay.hidden = false;
    state.machinePrefsRead = false;
    if (typeof params.sessionId === "string" && params.sessionId) {
      state.selected = params.sessionId;
      // The shared "current session" signal: the rail highlights it, A-Eyes
      // filters its feed, the constellation refreshes, and we re-render.
      window.dispatchEvent(new CustomEvent("mefi:tree-select", { detail: { sessionId: params.sessionId } }));
    }
    // { assistant: true } lands in the composer; { assistant: { mode } } is the
    // older deep link that runs a briefing mode; { folded: true } opens the
    // Finished group (the rail's folded node sends it).
    const assistant = params.assistant;
    if (params.folded) state.foldedOpen = true;
    // The first read of the store can take a second or two on a busy machine,
    // so nothing here waits on it: the sheet opens at once into load()'s
    // pending state ("Loading sessions…" until the read resolves), focus and
    // assistant deep links land now, and the tree rows are asserted once the
    // read completes. nav's claim() focuses a frame from now; its fallback
    // keeps focus on the sheet while the tree holds only the loading note.
    els.overlay.querySelector(".explorer-sheet")?.focus();
    if (assistant === true && !els.overlay.hidden) {
      els.input?.focus();
      els.input?.scrollIntoView?.({ block: "nearest" });
    } else if (assistant?.mode) runAssistant(assistant.mode, params.sessionId ?? state.selected, assistant.payload);
    const settled = load();
    // Back onto the tree rows once they exist — deliberately not gating open():
    // a slow first read must never hold the sheet's startup. claim() focuses
    // one frame after open(), when the tree holds only the non-focusable
    // loading note, and renderTree() replaces any row it did focus — either
    // way focus can end up on the bare sheet, so re-assert it on the row now
    // that the rows exist. Only while the sheet is still up: a close during
    // load() already handed focus back, and the next surface must keep it.
    settled.then(() => {
      if (!els.overlay) return;
      revealSelected();
      const sheet = els.overlay.querySelector(".explorer-sheet");
      const active = document.activeElement;
      if (!els.overlay.hidden && (active === sheet || !els.overlay.contains(active))) (els.tree?.querySelector("li.selected") ?? sheet)?.focus();
    });
    // load() handles its own errors; the promise stays unobserved on purpose
    // so a slow or failed read can never block whoever opened us.
    settled.catch(() => {});
    return Promise.resolve();
  }

  function close() {
    if (!els.overlay || els.overlay.hidden) return;
    els.overlay.hidden = true;
    window.MefiNav?.release?.("explorer");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      overlay: "explorer-overlay",
      tree: "explorer-tree",
      detail: "explorer-detail",
      explorerTitle: "explorer-title",
      status: "assistant-status",
      brief: "assistant-brief",
      briefRun: "brief-run",
      improveRun: "improve-run",
      growRun: "grow-run",
      close: "explorer-close",
      collisions: "collision-list",
      requests: "request-list",
      requestInput: "request-input",
      requestAdd: "request-add",
      proactive: "proactive-mode",
      memoryAlign: "memory-align",
      loopGuard: "loop-guard",
      loopGuardApply: "loop-guard-apply",
      auditRun: "audit-run",
      auditStatus: "audit-status",
      auditFindings: "audit-findings",
      machineBadge: "machine-badge",
      machineLines: "machine-lines",
      machineAuto: "machine-auto",
      machineMemoryOverride: "machine-memory-override",
      machineList: "machine-list",
      machineEvents: "machine-events",
      openButton: "tree-explore",
      service: "assistant-service",
      model: "assistant-model",
      thread: "assistant-thread",
      input: "assistant-input",
      send: "assistant-send",
      chips: "assistant-chips",
      activity: "assistant-activity",
      work: "assistant-work",
      agents: "assistant-agents",
      housekeeping: "assistant-housekeeping",
      tidy: "assistant-tidy",
      fix: "assistant-fix",
      pause: "assistant-pause",
      overseer: "assistant-overseer",
      stopAll: "assistant-stop-all",
      restart: "assistant-restart",
    })) {
      els[key] = document.getElementById(id);
    }
    els.send?.addEventListener("click", () => sendMessage());
    els.input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    els.input?.addEventListener("input", () => growArea(els.input));
    els.chips?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-msg]");
      if (chip) sendMessage(chip.dataset.msg);
    });
    els.tidy?.addEventListener("click", () => control("tidy"));
    els.fix?.addEventListener("click", () => control("fix"));
    els.overseer?.addEventListener("click", () => control("overseer"));
    // Resume is the same start-work every surface sends, so a Workspace pause
    // (which also holds new work) is fully lifted from here too.
    els.pause?.addEventListener("click", () => control(state.assistant?.status === "paused" ? "start-work" : "pause"));
    els.stopAll?.addEventListener("click", () => control("stop-all"));
    els.restart?.addEventListener("click", () => restartStudio());
    window.mefiStudio?.onAssistant?.((payload) => {
      window.MefiTree?.applyAssistant?.(payload);
      if (payload?.state) state.assistant = payload.state;
      if (els.overlay?.hidden) return;
      renderAssistantService();
      if (payload?.event?.kind === "organize") renderTree();
    });
    window.addEventListener("mefi:assistant-focus", (event) => {
      if (els.overlay?.hidden) return;
      const node = event.detail?.node;
      // A rail click hands the composer a ready instruction for the node —
      // staged only into an empty box, so it never eats a half-typed message.
      if (node?.id && els.input && !els.input.value.trim()) {
        els.input.value = `Work on "${String(node.label ?? node.id).slice(0, 60)}"`;
      }
      els.input?.focus();
    });
    renderAssistantService();
    els.auditRun?.addEventListener("click", runAudit);
    els.machineAuto?.addEventListener("change", async () => {
      const result = await window.mefiStudio?.machineSet?.({ autoKill: els.machineAuto.checked });
      status(`resource manager auto-kill ${result?.machine?.autoKill ? "on" : "off"}`);
    });
    els.machineMemoryOverride?.addEventListener("change", async () => {
      const result = await window.mefiStudio?.machineSet?.({ memoryWarnOverride: els.machineMemoryOverride.checked === true });
      status(`memory warn override ${result?.machine?.memoryWarnOverride === true ? "on" : "off"}`);
    });
    window.mefiStudio?.onMachineStatus?.((status) => renderMachine(status));
    // A quiet backstop poll: the push subscriptions above carry live updates,
    // and the browser fallback has none. boot.js's shared guard clears the
    // interval the moment the window hides and restarts it when it shows, so
    // hide/show toggles never stack intervals; the visibilitychange listener
    // still snaps a fresh load the moment the window is shown instead of
    // waiting out the interval.
    const explorerTick = () => {
      if (!window.mefiStudio?.eyesState) return;
      if (document.visibilityState === "visible" && els.overlay && !els.overlay.hidden) load();
    };
    if (window.MefiBoot?.pollStart) window.MefiBoot.pollStart("explorer.state", explorerTick, EXPLORER_POLL_MS);
    else setInterval(explorerTick, EXPLORER_POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && els.overlay && !els.overlay.hidden) explorerTick();
    });
    els.requestInput?.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.requestInput.classList.add("drag-over");
    });
    els.requestInput?.addEventListener("dragleave", () => els.requestInput.classList.remove("drag-over"));
    els.requestInput?.addEventListener("drop", (event) => {
      event.preventDefault();
      els.requestInput.classList.remove("drag-over");
      const text = event.dataTransfer?.getData("text/plain") ?? "";
      if (!text) return;
      els.requestInput.value = els.requestInput.value ? `${els.requestInput.value}\n\n${text}` : text;
      els.requestInput.focus();
      status("checkpoint dropped into the request box");
    });
    els.openButton?.addEventListener("click", open);
    els.close?.addEventListener("click", close);
    els.overlay?.addEventListener("click", (event) => {
      if (event.target === els.overlay) close();
    });
    els.briefRun?.addEventListener("click", () => runAssistant("brief"));
    els.improveRun?.addEventListener("click", () => runAssistant("improve"));
    els.growRun?.addEventListener("click", () => runAssistant("grow"));
    els.requestAdd?.addEventListener("click", async () => {
      const value = els.requestInput.value.trim();
      if (!value) return;
      state.requests.unshift({ prompt: value, at: Date.now(), source: "manual" });
      els.requestInput.value = "";
      await persistRequests();
      status(`request added (${state.requests.length} in inbox)`);
    });
    els.requestInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") els.requestAdd.click();
    });
    // Proactive is a service preference now: the loop runs regardless, the
    // switch only decides whether its ticks add an AI brief.
    els.proactive?.addEventListener("change", async () => {
      const proactive = els.proactive.checked;
      if (!window.mefiStudio?.assistantPrefs) {
        status("proactive requires desktop mode", true);
        els.proactive.checked = !proactive;
        return;
      }
      const result = await window.mefiStudio.assistantPrefs({ proactive }).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
      if (!result?.ok) {
        status(result?.error ?? "preference not saved", true);
        els.proactive.checked = !proactive;
        return;
      }
      takeAssistant(result.state);
      status(proactive ? "proactive on · the service briefs with AI every 5 minutes when a key is saved" : "proactive off · tidy, fix and organise still run every tick");
    });
    // The audit switches save the same way: one assistant pref each, the
    // switch put back when the save fails, the status line on success.
    for (const [key, words] of Object.entries(AUDIT_SWITCHES)) {
      const input = els[key];
      input?.addEventListener("change", async () => {
        const value = input.checked;
        syncAuditSwitches();
        if (!window.mefiStudio?.assistantPrefs) {
          status(`${words.name} requires desktop mode`, true);
          input.checked = !value;
          syncAuditSwitches();
          return;
        }
        const result = await window.mefiStudio.assistantPrefs({ [key]: value }).catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
        if (!result?.ok) {
          status(result?.error ?? "preference not saved", true);
          input.checked = !value;
          syncAuditSwitches();
          return;
        }
        takeAssistant(result.state);
        status(value ? words.on : words.off);
      });
    }
    window.mefiStudio?.onCheckpoints?.((data) => {
      state.checkpoints = data ?? {};
      renderTree();
      renderDetail();
    });
    window.mefiStudio?.onBriefing?.((briefing) => {
      state.briefing = briefing;
      renderAssistant();
    });
    window.mefiStudio?.onRequests?.((requests) => {
      state.requests = Array.isArray(requests) ? requests : [];
      renderRequests();
    });
    window.addEventListener("mefi:tree-select", (event) => {
      state.selected = event.detail?.sessionId ?? null;
      if (els.overlay && !els.overlay.hidden) {
        renderTree();
        renderDetail();
      }
    });
  }

  // What a live-update reload hands back to open(): the selected session and
  // whether the Finished group was open.
  function saveState() {
    return { sessionId: state.selected ?? null, folded: Boolean(state.foldedOpen) };
  }

  window.MefiExplorer = { init, open, close, refresh: load, runAssistant, saveState };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
