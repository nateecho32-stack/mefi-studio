// Friends › Your PCs: whether the open project on this PC matches its default
// branch on GitHub, what has not reached GitHub yet, and Sync this PC. The
// words come from scripts/sync.mjs through main's sync:status, sync:run and
// sync:event; this file only lays them out. Opening the card looks (a fetch
// that moves no branch). Only the buttons pull and push: Sync this PC, and Put
// my commits on top of GitHub's when both sides moved and nothing is
// uncommitted. A push waits for the project's own check. badge() is what the
// Friends bubble shows: work only this PC holds, plus commits waiting on
// GitHub, plus a GitHub that could not be checked. renderer/companion-hub.js
// mounts the card in the Friends section and draws the badge.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const bridge = () => window.mefiStudio;
  // The last answer from any source (a card, a sync, the background look), so
  // reopening Friends paints at once while it re-checks.
  let last = null;
  const listeners = new Set();

  const kinds = (result) => (Array.isArray(result?.problems) ? result.problems.map((item) => item?.kind) : []);
  function stateOf(result) {
    if (!result || result.ok === false) return "problem";
    if (result.state?.behind || result.pending?.length) return "pending";
    if (kinds(result).includes("offline")) return "offline";
    return "clean";
  }

  function badge(result = last) {
    if (!result) return 0;
    const risk = Number.isFinite(result.risk) ? result.risk : 0;
    const unchecked = kinds(result).some((kind) => kind === "fetch-failed" || kind === "error") ? 1 : 0;
    return risk + (result.state?.behind ? 1 : 0) + unchecked;
  }

  function remember(result) {
    if (!result || typeof result !== "object") return;
    last = result;
    for (const fn of listeners) { try { fn(result); } catch {} }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = bridge();
  if (typeof api?.onSyncEvent === "function") api.onSyncEvent(remember);
  // A new project gets a fresh look, so the badge never speaks for the last one.
  window.addEventListener?.("mefi:project-changed", () => {
    last = null;
    for (const fn of listeners) { try { fn(null); } catch {} }
    if (typeof bridge()?.syncStatus === "function") bridge().syncStatus().then(remember, () => {});
  });

  function card() {
    const root = node("section", "pc-sync");
    root.setAttribute("aria-labelledby", "pc-sync-title");
    const title = node("h4", "pc-sync-title", "Your PCs");
    title.id = "pc-sync-title";
    const status = node("p", "pc-sync-status", "Checking GitHub…");
    status.id = "pc-sync-status";
    status.setAttribute("role", "status");
    const list = node("ul", "pc-sync-list");
    list.hidden = true;
    const actions = node("div", "pc-sync-actions");
    const run = node("button", "ghost pc-sync-run", "Sync this PC");
    run.type = "button";
    run.id = "pc-sync-run";
    const rebase = node("button", "ghost pc-sync-run", "Put my commits on top of GitHub's");
    rebase.type = "button";
    rebase.id = "pc-sync-rebase";
    rebase.hidden = true;
    actions.append(run, rebase);
    const meta = node("p", "muted pc-sync-meta");
    meta.hidden = true;
    const note = node("p", "muted", "Sync pulls what your other PCs pushed and pushes this PC's commits after the project's check passes. It never overwrites uncommitted work or force-pushes.");
    root.append(title, status, list, actions, meta, note);
    const api = bridge();
    if (typeof api?.syncStatus !== "function" || typeof api?.syncRun !== "function") {
      status.textContent = "Syncing your PCs works in the desktop app.";
      actions.hidden = true;
      note.hidden = true;
      root.dataset.state = "unavailable";
      return root;
    }
    let busy = false;
    const show = (result) => {
      if (!result) return;
      root.dataset.state = stateOf(result);
      status.textContent = result.headline || "Sync did not answer. Try again.";
      const details = Array.isArray(result.lines) ? result.lines.slice(1) : [];
      list.replaceChildren(...details.map((line) => node("li", "", line)));
      list.hidden = !details.length;
      const linked = result.state?.repo !== false && result.state?.remote !== false;
      run.hidden = !linked;
      rebase.hidden = !linked || result.canRebase !== true;
      const when = Number.isFinite(result.checkedAt) ? new Date(result.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      const device = typeof result.state?.device === "string" && result.state.device ? result.state.device : "This PC";
      meta.textContent = when ? `${device} · checked ${when}` : "";
      meta.hidden = !linked || !when;
    };
    const ask = async (mode) => {
      if (busy) return;
      busy = true;
      run.disabled = rebase.disabled = true;
      if (mode === "sync") run.textContent = "Syncing…";
      if (mode === "rebase") rebase.textContent = "Putting your commits on top…";
      root.setAttribute("aria-busy", "true");
      if (mode !== "look" || !last) status.textContent = mode === "look" ? "Checking GitHub…" : "Syncing with GitHub…";
      let result;
      try {
        result = await (mode === "look" ? api.syncStatus() : api.syncRun({ rebase: mode === "rebase" }));
      } catch (error) {
        result = { ok: false, headline: `Sync could not run: ${error?.message || error}`, lines: [] };
      }
      remember(result);
      busy = false;
      run.disabled = rebase.disabled = false;
      run.textContent = "Sync this PC";
      rebase.textContent = "Put my commits on top of GitHub's";
      root.removeAttribute("aria-busy");
      show(result);
    };
    run.addEventListener("click", () => { void ask("sync"); });
    rebase.addEventListener("click", () => { void ask("rebase"); });
    // A background look that lands while the card is open repaints it; a card
    // that has left the page stops listening.
    const off = subscribe((result) => {
      if (root.isConnected === false) { off(); return; }
      if (!busy) show(result);
    });
    if (last) show(last);
    void ask("look");
    return root;
  }

  window.MefiPcSync = { card, badge, subscribe, last: () => last };
})();
