// Friends › Your PCs: whether the open project on this PC matches its default
// branch on GitHub, what has not reached GitHub yet, and Sync this PC. The
// words come from scripts/sync.mjs through main's sync:status and sync:run;
// this file only lays them out. Opening the card looks (a fetch that moves no
// branch). Only the button pulls and pushes, and only in the directions that
// cannot lose work. renderer/companion-hub.js mounts it in the Friends section.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  // The last answer, so reopening Friends paints at once while it re-checks.
  let last = null;

  function stateOf(result) {
    if (!result || result.ok === false) return "problem";
    if (result.state?.behind || result.pending?.length) return "pending";
    return "clean";
  }

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
    const run = node("button", "ghost pc-sync-run", "Sync this PC");
    run.type = "button";
    run.id = "pc-sync-run";
    const meta = node("p", "muted pc-sync-meta");
    meta.hidden = true;
    const note = node("p", "muted", "Sync pulls what your other PCs pushed and pushes this PC's commits. It never overwrites uncommitted work or force-pushes.");
    root.append(title, status, list, run, meta, note);
    const bridge = window.mefiStudio;
    if (typeof bridge?.syncStatus !== "function" || typeof bridge?.syncRun !== "function") {
      status.textContent = "Syncing your PCs works in the desktop app.";
      run.hidden = true;
      note.hidden = true;
      root.dataset.state = "unavailable";
      return root;
    }
    let busy = false;
    const show = (result) => {
      root.dataset.state = stateOf(result);
      status.textContent = result?.headline || "Sync did not answer. Try again.";
      const details = Array.isArray(result?.lines) ? result.lines.slice(1) : [];
      list.replaceChildren(...details.map((line) => node("li", "", line)));
      list.hidden = !details.length;
      const linked = result?.state?.repo !== false && result?.state?.remote !== false;
      run.hidden = !linked;
      const when = Number.isFinite(result?.checkedAt) ? new Date(result.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      const device = typeof result?.state?.device === "string" && result.state.device ? result.state.device : "This PC";
      meta.textContent = when ? `${device} · checked ${when}` : "";
      meta.hidden = !linked || !when;
    };
    const ask = async (push) => {
      if (busy) return;
      busy = true;
      run.disabled = true;
      run.textContent = push ? "Syncing…" : "Sync this PC";
      root.setAttribute("aria-busy", "true");
      if (push || !last) status.textContent = push ? "Syncing with GitHub…" : "Checking GitHub…";
      let result;
      try {
        result = await (push ? bridge.syncRun() : bridge.syncStatus());
      } catch (error) {
        result = { ok: false, headline: `Sync could not run: ${error?.message || error}`, lines: [] };
      }
      last = result;
      busy = false;
      run.disabled = false;
      run.textContent = "Sync this PC";
      root.removeAttribute("aria-busy");
      show(result);
    };
    run.addEventListener("click", () => { void ask(true); });
    if (last) show(last);
    void ask(false);
    return root;
  }

  window.MefiPcSync = { card };
})();
