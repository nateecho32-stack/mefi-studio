// What's new: what changed in the version you are running, in plain words.
//
// After an update installs, Studio says so once: a toast with a "What's new"
// action that opens a small sheet with that version's notes and "Got it". It
// never opens a modal by itself, never speaks on a first install (the host
// seals that version as read) and never repeats a toast it already showed;
// Settings › Updates keeps every version's notes, and the same sheet opens
// from a Read button there or from Search. Everything it says comes from the
// host (main.cjs "What's new", scripts/whats-new.cjs): this file draws the
// answer and asks for two things, "I showed the toast" and "I read it". The
// switch in Settings › Updates and MEFI_STUDIO_NO_WHATS_NEW=1 turn it off.
(function () {
  "use strict";
  const CHANGELOG_URL = "https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const state = { view: null, toasted: false, shown: null, returnFocus: null };

  // ---- what the host says ------------------------------------------------------------
  async function refresh(call = "releaseWhatsNew", ...args) {
    const bridge = api();
    if (typeof bridge?.[call] !== "function") return null;
    try {
      const view = await bridge[call](...args);
      if (view?.ok) { state.view = view; paint(); }
      return view?.ok ? view : null;
    } catch {
      return null;
    }
  }

  // ---- Settings › Updates: every version, in plain words ------------------------------
  function paint() {
    const view = state.view;
    const list = $("whats-new-list");
    if (list && view) {
      list.replaceChildren();
      for (const entry of view.history ?? []) {
        const row = el("div", "whats-new-row");
        row.setAttribute("role", "listitem");
        const words = el("div", "whats-new-words");
        const title = el("b", "", `${entry.version}${entry.current ? " · installed" : ""}`);
        if (entry.current && entry.unread) title.append(el("span", "whats-new-fresh", "New"));
        words.append(title, el("small", "", entry.notes[0] ?? ""));
        const read = el("button", "ghost mini", "Read");
        read.type = "button";
        read.dataset.version = entry.version;
        read.setAttribute("aria-label", `Read what's new in ${entry.version}`);
        read.addEventListener("click", () => open(entry.version));
        row.append(words, read);
        list.append(row);
      }
      if (!list.children.length) list.append(el("p", "muted whats-new-empty", view.current ? `This build carries no notes for ${view.current}. The full changelog has every change.` : "This build does not know its own version."));
      list.append(fullChangelog());
    }
    const on = $("whats-new-on");
    if (on && view) {
      on.checked = view.enabled;
      on.disabled = view.disabled === "env";
    }
    const note = $("whats-new-note");
    if (note && view) {
      note.hidden = view.disabled !== "env";
      note.textContent = view.disabled === "env" ? "Turned off for this session by MEFI_STUDIO_NO_WHATS_NEW." : "";
    }
  }
  function fullChangelog() {
    const link = el("button", "ghost mini whats-new-link", "Full changelog");
    link.type = "button";
    link.addEventListener("click", openChangelog);
    return link;
  }
  function openChangelog() {
    const opened = api()?.openExternal?.(CHANGELOG_URL);
    if (!opened) window.open?.(CHANGELOG_URL, "_blank", "noopener");
  }

  // ---- the sheet ---------------------------------------------------------------------
  const sheet = () => $("whats-new-sheet");
  function keys(event) {
    const node = sheet();
    if (!node || node.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const stops = [...node.querySelectorAll("button")].filter((button) => !button.disabled);
    const first = stops[0], last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function fill(list, notes) {
    list.replaceChildren(...notes.map((text) => el("li", "", text)));
  }
  /** Open the sheet for a version the host listed; false when it has nothing to say about it. */
  function open(version) {
    const node = sheet();
    const view = state.view;
    const entry = (view?.history ?? []).find((row) => row.version === version) ?? (view?.current === version && view.notes?.length ? { version, notes: view.notes, current: true } : null);
    if (!node || !entry) return false;
    // The history is newest first, so the entry after this one is the one before it.
    const history = view.history ?? [];
    const at = history.findIndex((row) => row.version === version);
    const older = at >= 0 ? history[at + 1] ?? null : null;
    $("whats-new-title").textContent = `What's new in ${entry.version}`;
    fill($("whats-new-notes"), entry.notes);
    const before = $("whats-new-before");
    if (older && before) {
      before.hidden = false;
      $("whats-new-before-head").textContent = `Before that · ${older.version}`;
      fill($("whats-new-before-notes"), older.notes);
    } else if (before) before.hidden = true;
    state.shown = entry;
    state.returnFocus = document.activeElement ?? null;
    node.hidden = false;
    document.addEventListener("keydown", keys, true);
    const focus = () => $("whats-new-ok")?.focus?.({ preventScroll: true });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus); else focus();
    return true;
  }
  // Any way of closing counts as having read it: the notes were on the screen.
  function close() {
    const node = sheet();
    if (!node || node.hidden) return;
    node.hidden = true;
    document.removeEventListener("keydown", keys, true);
    const entry = state.shown;
    state.shown = null;
    if (entry?.current) void refresh("releaseWhatsNewSeen", { version: entry.version, how: "read" });
    const back = state.returnFocus;
    state.returnFocus = null;
    if (back && back.isConnected !== false) back.focus?.({ preventScroll: true });
  }

  // ---- after an update: one toast ----------------------------------------------------
  /** The one place the rule lives on this side: the host said `show`, and this page has not toasted yet. */
  const toastText = (view) => (view?.ok && view.show && !state.toasted ? `Studio updated to ${view.current}.` : null);
  async function announce() {
    if (headless) return false;
    const view = await refresh();
    const text = toastText(view);
    if (!text || typeof window.MefiToast !== "function") return false;
    state.toasted = true;
    window.MefiToast(text, "info", { duration: 14000, action: { label: "What's new", run: () => open(view.current) } });
    // Said once: a toast nobody clicked is not repeated at the next launch. The
    // notes stay in Settings › Updates, marked New until they are read.
    void refresh("releaseWhatsNewSeen", { version: view.current, how: "announce" });
    return true;
  }
  // A window parked in the tray at sign-in has nobody to tell yet.
  function whenVisible(run) {
    if (!document.hidden) { run(); return; }
    const wake = () => { if (document.hidden) return; document.removeEventListener("visibilitychange", wake); run(); };
    document.addEventListener("visibilitychange", wake);
  }

  function init() {
    if (typeof api()?.releaseWhatsNew !== "function") return;
    $("whats-new-close")?.addEventListener("click", close);
    $("whats-new-ok")?.addEventListener("click", close);
    $("whats-new-changelog")?.addEventListener("click", openChangelog);
    $("whats-new-sheet")?.addEventListener("click", (event) => { if (event.target === $("whats-new-sheet")) close(); });
    $("whats-new-on")?.addEventListener("change", (event) => { void refresh("releaseWhatsNewSet", event.target.checked === true); });
    window.MefiNav?.register?.({
      id: "release-notes", label: "What's new in this version", short: "Release notes", kind: "action", layer: null, section: "help", group: "system",
      glyph: "g-spark", badge: null, desc: "What changed in the version you are running, in plain words",
      searchTerms: "whats new release notes changelog updated update version",
      showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
      hidden: () => !(state.view?.notes?.length),
      run: () => { if (state.view?.current) open(state.view.current); },
    });
    void refresh();
    // The studio has had a few seconds to come up before anything speaks.
    setTimeout(() => whenVisible(() => { void announce(); }), 4000);
  }

  window.MefiWhatsNew = { open, close, refresh, announce, toastText, state };
  init();
})();
