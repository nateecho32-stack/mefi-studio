// Worktrees: Work's list of every git worktree of the open project (Work ›
// Worktrees). A worktree is another folder holding the same repository on its
// own branch. Studio's task runs make one each while "Give each run its own
// worktree" is on, and side investigations pile up more. Git only lists their
// folders; this page says which hold work that exists nowhere else, which are on
// GitHub but not merged, and which are finished and safe to remove, and does the
// three things that are safe from here: merge a branch into main (a fast-forward,
// or a merge commit when asked), remove a folder (a copy is kept first when the
// folder holds anything no commit does) and forget folders that are gone. The
// host reads and acts (main.cjs "Worktrees", scripts/worktrees.mjs and
// scripts/worktree-actions.mjs); nothing here pushes. Every action names a folder
// from the last list, and the host only acts on a folder git lists for the open
// project. The list is read on open, every 15 s while it is in view, when the
// window regains focus and when a run starts or ends; a repaint that would change
// nothing is skipped, so focus and scroll stay where they were.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`worktrees-${id}`);
  const api = () => window.mefiStudio;
  const REFRESH_MS = 15000;
  const PEEK_MS = 8000;
  const state = { list: null, error: "", loading: false, notes: new Map(), busy: new Set(), timer: 0, reading: null, signature: "", peekAt: 0, runs: "" };
  let initialized = false;

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  const say = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback);

  // What each verdict is called on the page, and how loud it is.
  const STATES = {
    primary: { label: "Main checkout", tone: "quiet" },
    dirty: { label: "Uncommitted work", tone: "bad" },
    unpushed: { label: "Only on this PC", tone: "warn" },
    "on-github": { label: "On GitHub, not merged", tone: "info" },
    missing: { label: "Folder gone", tone: "dim" },
    merged: { label: "Merged", tone: "good" },
  };
  const KINDS = { primary: "Main", run: "Task run", dev: "Branch", detached: "Detached" };
  const COUNTS = [["atRisk", "At risk", "bad"], ["toLand", "On GitHub", "info"], ["safeToRemove", "Merged", "good"], ["missing", "Gone", "dim"]];

  // ---- reading ------------------------------------------------------------------------
  function projectId() {
    return window.MefiWorkspace?.activeProjectId?.() || window.MefiWorkspace?.state?.activeId || undefined;
  }
  async function read({ quiet = false } = {}) {
    if (!api()?.worktreesList) { state.error = "Worktrees are listed in the desktop app."; render(); return null; }
    if (state.reading) return state.reading;
    if (!quiet) { state.loading = true; render(); }
    state.reading = (async () => {
      try {
        const result = await api().worktreesList({ projectId: projectId() });
        if (result?.ok) { state.list = result; state.error = ""; state.peekAt = Date.now(); announce(); }
        else state.error = say(result?.error, "The worktrees could not be read.");
      } catch (error) {
        state.error = say(error, "The worktrees could not be read.");
      }
    })().finally(() => { state.reading = null; state.loading = false; render(); });
    return state.reading;
  }
  // The counts other surfaces show (the Git chip, Build's session rows, Friends).
  function summary() {
    const list = state.list;
    if (!list?.repo) return { repo: Boolean(list?.repo), total: 0, atRisk: 0, toLand: 0, safeToRemove: 0, missing: 0, tasks: [] };
    return { repo: true, ...list.summary, tasks: (Array.isArray(list.rows) ? list.rows : []).filter((row) => row?.task?.taskId).map((row) => row.task.taskId) };
  }
  function announce() { window.dispatchEvent(new CustomEvent("mefi:worktrees", { detail: summary() })); }
  // A quiet look for the badges: at most every few seconds, never while a look is running.
  function peek() {
    if (state.reading || Date.now() - state.peekAt < PEEK_MS) return Promise.resolve(summary());
    return (read({ quiet: true }) ?? Promise.resolve()).then(summary);
  }

  // What to do about a row, in this page's own words (the host's sentence names git commands).
  function advice(row, list) {
    const files = plural(row.dirty, "uncommitted file");
    if (row.kind === "primary") return row.dirty ? `${files} in the main checkout.` : "";
    if (row.state === "missing") return "The folder is gone. Forget it so git stops listing it.";
    if (row.state === "dirty") return `${files}. Open the folder and commit or stash them before merging or removing it.`;
    if (row.state === "unpushed") {
      return row.detached
        ? `${plural(row.ahead, "commit")} on no branch. Open the folder and put ${row.ahead === 1 ? "it" : "them"} on a branch before anything else.`
        : `${plural(row.ahead, "commit")} that exist only on this PC. Merge them into ${list.main}, or push the branch from its folder.`;
    }
    if (row.state === "on-github") return `${plural(row.ahead, "commit")} on GitHub, not merged into ${list.upstream}. Merge them into ${list.main}, or leave the branch parked.`;
    return `Merged into ${list.upstream} and clean. Safe to remove.`;
  }

  // ---- painting -----------------------------------------------------------------------
  function counts() {
    const box = $("counts");
    const list = state.list;
    box.replaceChildren();
    if (!list?.repo) return;
    for (const [key, label, tone] of COUNTS) {
      const value = Number(list.summary?.[key]) || 0;
      if (!value && key !== "atRisk") continue;
      const chip = el("span", `worktrees-count${value ? "" : " is-zero"}`, `${value} ${label.toLowerCase()}`);
      chip.dataset.tone = tone;
      box.append(chip);
    }
  }

  function noteFor(path) { return state.notes.get(path) ?? null; }
  function setNote(path, note) {
    if (note) state.notes.set(path, note); else state.notes.delete(path);
    state.signature = "";
    render();
  }

  function rowNode(row, list) {
    const shown = STATES[row.state] ?? STATES.merged;
    const item = el("li", "worktrees-row");
    item.dataset.tone = shown.tone;
    item.dataset.path = row.path;
    item.dataset.state = row.state;
    item.dataset.kind = row.kind;
    const main = el("div", "worktrees-main");
    const title = el("div", "worktrees-title");
    if (row.kind !== "primary") title.append(el("span", "worktrees-kind", KINDS[row.kind] ?? "Branch"));
    title.append(el("strong", "worktrees-name", row.name));
    if (row.detached) title.append(el("span", "worktrees-branch", `detached at ${row.head}`));
    else title.append(el("span", "worktrees-branch", row.branch));
    if (row.locked) title.append(el("span", "worktrees-flag", "locked"));
    if (row.busy) { const live = el("span", "worktrees-flag", "a run is working here"); live.dataset.tone = "live"; title.append(live); }
    main.append(title);
    if (row.task) {
      const line = el("div", "worktrees-task");
      line.append(el("span", "worktrees-task-label", "Task"));
      const open = el("button", "worktrees-task-link", row.task.title || row.task.taskId || "Open the task");
      open.type = "button";
      open.title = "Open this task";
      open.addEventListener("click", () => window.MefiNav?.go?.("tasks", { taskId: row.task.taskId, projectId: projectId() }));
      if (row.task.taskId) line.append(open); else line.append(el("span", "", row.task.title));
      main.append(line);
    }
    if (row.state !== "missing") {
      const meta = el("div", "worktrees-meta");
      const parts = [];
      if (row.kind !== "primary") {
        parts.push(row.ahead ? `${plural(row.ahead, "commit")} not in ${list.upstream}` : `nothing not in ${list.upstream}`);
        if (row.behind) parts.push(`${row.behind} behind`);
      }
      parts.push(row.dirty ? plural(row.dirty, "uncommitted file") : "no uncommitted files");
      if (row.kind !== "primary" && row.pushed !== null) parts.push(row.pushed ? "on GitHub" : "not on GitHub");
      meta.textContent = parts.join(" · ");
      main.append(meta);
      if (row.last) main.append(el("div", "worktrees-last", `${row.last.date} · ${row.last.subject}`));
    }
    const where = el("div", "worktrees-path", row.path);
    where.title = row.path;
    main.append(where);
    const todo = advice(row, list);
    if (todo) main.append(el("p", "worktrees-action", todo));
    const note = noteFor(row.path);
    if (note) main.append(noteNode(note));

    const side = el("div", "worktrees-side");
    const chip = el("span", "worktrees-state", shown.label);
    chip.dataset.tone = shown.tone;
    side.append(chip);
    const buttons = el("div", "worktrees-buttons");
    const busy = state.busy.has(row.path);
    const add = (label, run, { danger = false, armed = "", title = "", disabled = false, primary = false } = {}) => {
      const button = el("button", `${primary ? "" : "ghost "}mini`, label);
      button.type = "button";
      button.disabled = busy || disabled;
      if (title) button.title = title;
      if (danger && window.MefiUi?.arm) window.MefiUi.arm(button, { run, armed: armed || `${label}: click again` });
      else button.addEventListener("click", run);
      buttons.append(button);
      return button;
    };
    if (row.state !== "missing") add("Open folder", () => act(row, "open"), { title: "Show this folder in the file manager" });
    if (row.kind !== "primary" && row.state !== "missing") {
      const canMerge = Boolean(row.branch) && !row.detached && row.ahead > 0 && !row.dirty;
      add("Merge into main", () => act(row, "merge"), { primary: canMerge, disabled: !canMerge || row.busy, title: canMerge ? `Fast-forward ${list.main} to ${row.branch} on this PC` : row.dirty ? "Commit the uncommitted files first" : row.detached ? "Put its commits on a branch first" : `Nothing here that ${list.main} lacks` });
      add("Remove", () => act(row, "remove"), { danger: true, armed: "Remove: click again", disabled: row.busy || row.locked, title: row.locked ? "It is locked" : "Remove the folder. A branch that is not merged stays." });
    }
    if (row.state === "missing") add("Forget", () => act(row, "forget"), { title: "Ask git to forget this folder" });
    side.append(buttons);
    item.append(main, side);
    return item;
  }

  // A sentence under a row, with the choices that follow from it.
  function noteNode(note) {
    const box = el("div", "worktrees-note");
    box.dataset.tone = note.tone ?? "info";
    box.setAttribute("role", note.tone === "bad" ? "alert" : "status");
    box.append(el("span", "", note.text));
    if (note.choices?.length) {
      const choices = el("span", "worktrees-choices");
      for (const choice of note.choices) {
        const button = el("button", `${choice.primary ? "" : "ghost "}mini`, choice.label);
        button.type = "button";
        if (choice.danger && window.MefiUi?.arm) window.MefiUi.arm(button, { run: choice.run, armed: choice.armed || `${choice.label}: click again` });
        else button.addEventListener("click", choice.run);
        choices.append(button);
      }
      box.append(choices);
    }
    return box;
  }

  function render() {
    const overlay = $("overlay");
    if (!overlay) return;
    const list = state.list;
    const headline = $("headline");
    const box = $("list");
    const failed = state.error && !list;
    const sign = JSON.stringify([state.error, state.loading && !list, list && [list.headline, list.enabled, list.rows?.map((row) => [row.path, row.state, row.ahead, row.behind, row.dirty, row.pushed, row.busy, row.locked, row.head, row.task?.title]), [...state.notes.keys()].map((key) => [key, state.notes.get(key).text]), [...state.busy]]]);
    if (sign === state.signature) return;
    state.signature = sign;
    const held = box.contains(document.activeElement) ? { path: document.activeElement.closest("[data-path]")?.dataset.path, label: document.activeElement.textContent } : null;
    headline.textContent = failed ? state.error : !list ? "Reading the worktrees…" : !list.repo ? "This project is not a Git repository, so it has no worktrees." : list.headline;
    headline.dataset.tone = failed || (state.error && list) ? "bad" : list?.summary?.atRisk ? "warn" : "";
    counts();
    const runs = $("runs");
    runs.checked = list?.enabled?.on === true;
    runs.disabled = list?.enabled?.forced === true || !list?.repo;
    runs.closest("label").title = list?.enabled?.forced ? "Turned on by MEFI_STUDIO_WORKTREE_RUNS=1 for this launch" : "Each task run works in its own folder under .mefi/worktrees and is merged back when it finishes";
    $("forget").hidden = !(list?.summary?.missing > 0);
    if (!list?.repo) { box.replaceChildren(); return; }
    box.replaceChildren(...list.rows.map((row) => rowNode(row, list)));
    if (list.rows.length === 1 && !state.error) box.append(el("li", "worktrees-empty", "Only the main checkout so far. With the switch above on, each task run gets a folder here, and every one you make with git worktree add shows up too."));
    if (held) {
      const again = held.path ? [...box.querySelectorAll("[data-path]")].find((node) => node.dataset.path === held.path) : null;
      const target = again ? [...again.querySelectorAll("button")].find((button) => button.textContent === held.label && !button.disabled) : null;
      target?.focus?.({ preventScroll: true });
    }
  }

  // ---- acting -------------------------------------------------------------------------
  function toast(text, tone = "good") { window.MefiToast?.(text, tone); }

  // Where the keyboard was when an action started: rows are rebuilt while it works (its buttons are
  // held), so focus returns to the same button, else the row's first one, else Refresh.
  function refocus(where) {
    if (!where) return;
    const box = $("list");
    const item = [...box.querySelectorAll("[data-path]")].find((node) => node.dataset.path === where.path);
    const buttons = item ? [...item.querySelectorAll("button")].filter((button) => !button.disabled) : [];
    const target = buttons.find((button) => button.textContent === where.label) ?? buttons[0] ?? $("refresh");
    target?.focus?.({ preventScroll: true });
  }
  function focusOf() {
    const at = document.activeElement;
    return at && $("list").contains(at) ? { path: at.closest("[data-path]")?.dataset.path, label: at.textContent } : null;
  }

  async function act(row, what, extra = {}) {
    if (!api()) return;
    const id = projectId();
    const where = focusOf();
    state.busy.add(row.path);
    setNote(row.path, null);
    let result = null;
    try {
      if (what === "open") result = await api().worktreesOpen({ path: row.path, projectId: id });
      else if (what === "merge") result = await api().worktreesMerge({ path: row.path, projectId: id, ...extra });
      else if (what === "remove") result = await api().worktreesRemove({ path: row.path, projectId: id, deleteBranch: row.kind === "run" && row.state === "merged", ...extra });
      else if (what === "forget") result = await api().worktreesForget({ projectId: id });
    } catch (error) {
      result = { ok: false, error: say(error, "That did not work. Try again.") };
    }
    state.busy.delete(row.path);
    if (what === "open") {
      if (result?.ok === false) setNote(row.path, { tone: "bad", text: say(result.error, "The folder could not be opened.") });
      else render();
      refocus(where);
      return;
    }
    if (result?.ok) {
      if (what === "merge") toast(`Merged ${row.branch} into ${result.into} (${result.how}). Not pushed yet.`);
      else if (what === "remove") toast(result.rescued ? `Removed ${row.name}. A copy of what it held is kept as ${result.rescued}.` : `Removed ${row.name}.`);
      else if (what === "forget") toast(result.pruned ? `Forgot ${plural(result.pruned, "missing folder")}.` : "Nothing to forget.");
      state.notes.delete(row.path);
      state.signature = "";
      await read({ quiet: true });
      if (what === "merge") setNote(row.path, { tone: "good", text: `${result.note}${result.removed?.ok === false ? ` It could not be removed: ${result.removed.error}` : ""}` });
      refocus(where);
      return;
    }
    follow(row, what, result ?? { ok: false, error: "That did not work. Try again." });
    refocus(where);
  }

  // A refusal is a sentence, and where there is a next step the sentence carries it.
  function follow(row, what, result) {
    const text = say(result.error, "That did not work. Try again.");
    const choices = [];
    if (what === "merge" && result.needsMergeCommit) choices.push({ label: "Merge with a merge commit", run: () => act(row, "merge", { mode: "merge" }) });
    if (what === "merge" && result.needsAnyway) choices.push({ label: "Merge anyway", run: () => act(row, "merge", { anyway: true }) });
    if (what === "remove" && result.needsForce) choices.push({ label: "Remove and keep a copy", run: () => act(row, "remove", { force: true }), danger: true, armed: "Remove: click again" });
    if (what === "merge" && result.alreadyMerged) choices.push({ label: "Remove the folder", run: () => act(row, "remove", { deleteBranch: true }), danger: true, armed: "Remove: click again" });
    setNote(row.path, { tone: choices.length ? "warn" : "bad", text, choices });
    if (what === "forget") toast(text, "bad");
    void read({ quiet: true });
  }

  // ---- the sheet ----------------------------------------------------------------------
  function schedule() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!isOpen()) return;
    state.timer = setTimeout(() => { if (document.hidden || !isOpen()) return schedule(); void read({ quiet: true }).then(schedule); return undefined; }, REFRESH_MS);
  }
  function open(params = {}) {
    init();
    window.MefiNav?.claim?.("worktrees");
    $("overlay").hidden = false;
    state.signature = "";
    void read({ quiet: Boolean(state.list) }).then(schedule);
    render();
    if (params?.focus !== false) requestAnimationFrame(() => $("refresh")?.focus?.({ preventScroll: true }));
  }
  function close() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!isOpen()) return;
    $("overlay").hidden = true;
    window.MefiNav?.release?.("worktrees");
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => window.MefiNav?.close?.("worktrees") ?? close());
    $("refresh").addEventListener("click", () => { void read(); });
    $("forget").addEventListener("click", () => { const gone = state.list?.rows?.find((row) => row.state === "missing"); if (gone) void act(gone, "forget"); });
    $("runs").addEventListener("change", async () => {
      const box = $("runs");
      const wanted = box.checked;
      try {
        const result = await api()?.workWorktrees?.(wanted);
        if (result?.ok && state.list) { state.list.enabled = result.worktrees; state.signature = ""; }
        toast(wanted ? "Each task run now gets its own worktree." : "Task runs work in your main checkout again.");
      } catch (error) {
        box.checked = !wanted;
        toast(say(error, "That setting could not be saved."), "bad");
      }
      render();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && isOpen()) { void read({ quiet: true }); schedule(); } });
    window.addEventListener("focus", () => { if (isOpen()) void read({ quiet: true }); });
    // Another project has other worktrees: nothing of the last one's list, notes or badges carries over.
    window.addEventListener("mefi:project-changed", () => {
      state.list = null; state.error = ""; state.peekAt = 0; state.signature = ""; state.notes.clear();
      if (isOpen()) void read(); else announce();
    });
    // A run starting or ending moves a folder in or out: read again shortly after the push.
    let later = 0;
    api()?.onAssistantStatus?.((status) => {
      const runs = JSON.stringify((status?.running ?? status?.autopilot?.running ?? []).map((item) => item?.id ?? "").sort());
      if (runs === state.runs) return;
      state.runs = runs;
      if (!isOpen()) return;
      clearTimeout(later);
      later = setTimeout(() => { void read({ quiet: true }); }, 800);
    });
  }

  // One row in this page's own words (its verdict, how loud it is, what to do about it), for the session inspector's Worktree tab.
  function describe(row) {
    const list = state.list;
    if (!row || !list?.repo) return null;
    const shown = STATES[row.state] ?? STATES.merged;
    return { label: shown.label, tone: shown.tone, advice: advice(row, list), main: list.main, upstream: list.upstream };
  }
  window.MefiWorktrees = { open, close, isOpen, refresh: () => read(), peek, summary, describe, state: () => ({ list: state.list, error: state.error }) };
  // nav.js holds the record (Work, beside Analyzer) and calls open/close.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
