// Settings › System › Storage: this PC's own folder and the Scratch store, the
// slower memory tier agents park work in (docs/plans/scratch-tier.md). The
// host decides everything (main.cjs "Scratch tier", scripts/scratch-rules.cjs):
// this file shows its answer and sends the four choices back as plain values.
// The card never opens a store by itself: it asks for the picture with
// `open: false` when the card unfolds, so a launch stays as light as before,
// and only Compact now (or Team › Resources) opens the open project's store.
// MEFI_STUDIO_NO_SCRATCH=1 turns the switches off for the launch and the card
// says so; a setting survives a restart (settings.scratch).
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const state = { view: null, busy: false };

  function paint() {
    const view = state.view;
    if (!view?.ok) return;
    const prefs = view.prefs ?? {};
    const forced = Boolean(prefs.forced);
    const enabled = $("scratch-enabled");
    if (enabled) { enabled.checked = prefs.enabled === true; enabled.disabled = forced; }
    const tools = $("scratch-agent-tools");
    if (tools) { tools.checked = prefs.agentTools === true; tools.disabled = forced || prefs.enabled !== true; }
    const cap = $("scratch-cap");
    if (cap) {
      const value = String(prefs.capMB ?? 512);
      if (![...cap.options].some((option) => option.value === value)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = `${value} MB`;
        cap.append(option);
      }
      cap.value = value;
      cap.disabled = forced;
    }
    const history = $("scratch-history");
    if (history) { history.value = prefs.historyBodies === true ? "on" : prefs.historyBodies === false ? "off" : "auto"; history.disabled = forced; }
    const compact = $("scratch-compact");
    if (compact) compact.disabled = state.busy || prefs.enabled !== true;
    const status = $("scratch-status");
    if (status) status.textContent = view.line ?? "";
    const dir = $("scratch-local-dir");
    if (dir) dir.textContent = view.localDir || "Studio's local folder";
    const note = $("scratch-note");
    if (note) {
      const refused = prefs.refused ? `MEFI_SCRATCH_DIR is ${prefs.refused.reason === "onedrive" ? "inside OneDrive" : "not a full path"}, so Studio keeps the store in its own folder.` : "";
      const words = forced ? "Turned off for this launch by MEFI_STUDIO_NO_SCRATCH." : refused;
      note.hidden = !words;
      note.textContent = words;
    }
  }

  async function refresh({ open = false } = {}) {
    if (typeof api()?.scratchStats !== "function") return null;
    try {
      const view = await api().scratchStats({ open });
      if (view?.ok) { state.view = view; paint(); }
      return view;
    } catch {
      return null;
    }
  }

  async function set(patch) {
    if (typeof api()?.scratchSet !== "function") return;
    let result;
    try { result = await api().scratchSet(patch); }
    catch (error) { result = { ok: false, error: String(error?.message ?? error) }; }
    if (result?.ok) { if (state.view) { state.view = { ...state.view, prefs: result.prefs ?? state.view.prefs, enabled: result.prefs?.enabled ?? state.view.enabled, line: result.line ?? state.view.line }; paint(); } }
    else { window.MefiToast?.(result?.error || "That setting could not be saved.", "bad"); paint(); }
  }

  async function compact() {
    if (typeof api()?.scratchCompact !== "function" || state.busy) return;
    state.busy = true;
    paint();
    let result;
    try { result = await api().scratchCompact(); }
    catch (error) { result = { ok: false, error: String(error?.message ?? error) }; }
    state.busy = false;
    if (result?.ok) window.MefiToast?.(result.removed ? `Compacted: ${result.removed} unused blob${result.removed === 1 ? "" : "s"} dropped.` : "Compacted: nothing was unused.", "good");
    else window.MefiToast?.(result?.error || "The store could not be compacted.", "bad");
    await refresh({ open: true });
  }

  function init() {
    if (typeof api()?.scratchStats !== "function" || !$("settings-storage")) return;
    $("scratch-enabled")?.addEventListener("change", (event) => { void set({ enabled: event.target.checked === true }); });
    $("scratch-agent-tools")?.addEventListener("change", (event) => { void set({ agentTools: event.target.checked === true }); });
    $("scratch-cap")?.addEventListener("change", (event) => { void set({ capMB: Number(event.target.value) }); });
    $("scratch-history")?.addEventListener("change", (event) => { void set({ historyBodies: event.target.value === "on" ? true : event.target.value === "off" ? false : "auto" }); });
    $("scratch-compact")?.addEventListener("click", () => { void compact(); });
    // The card reads when it unfolds, and whenever the host pushes a change.
    $("settings-storage")?.addEventListener("toggle", () => { if ($("settings-storage").open) void refresh(); });
    api()?.onScratchState?.((view) => { if (view?.ok) { state.view = view; paint(); } });
  }

  window.MefiScratch = { refresh, compact, state: () => state.view };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
