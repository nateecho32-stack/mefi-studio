/* The local mini-browser toolbar. Remote sites never receive this bridge. */
(() => {
  "use strict";
  const api = window.mediaBrowser;
  if (!api) return;
  const byId = id => document.getElementById(`browser-${id}`);
  const address = byId("address"), status = byId("status");
  let loading = false, currentURL = "";
  function paint(state) {
    loading = state.loading; currentURL = state.url;
    document.querySelector(".browser-welcome").hidden = Boolean(state.url);
    if (document.activeElement !== address) address.value = state.url;
    byId("back").disabled = !state.back; byId("forward").disabled = !state.forward;
    byId("external").disabled = !state.url;
    byId("pin").setAttribute("aria-pressed", String(state.pinned));
    byId("mute").setAttribute("aria-pressed", String(state.muted));
    byId("mute").textContent = state.muted ? "Unmute" : "Mute";
    byId("reload").textContent = loading ? "×" : "↻";
    for (const attr of ["aria-label", "title"]) byId("reload").setAttribute(attr, loading ? "Stop loading" : "Reload");
    status.textContent = state.error || (loading ? "Loading…" : state.url ? state.title : "Ready for your next soundtrack.");
    status.dataset.error = String(Boolean(state.error));
  }
  async function command(action, url) {
    try {
      const result = await api.command(action, url);
      if (!result?.ok) { status.textContent = result?.error || "That action is unavailable."; status.dataset.error = "true"; }
      if (result?.state) paint(result.state);
    } catch { status.textContent = "The media browser is unavailable. Reopen it from Studio."; status.dataset.error = "true"; }
  }
  byId("form").addEventListener("submit", event => { event.preventDefault(); address.blur(); void command("navigate", address.value); });
  address.addEventListener("keydown", event => { if (event.key === "Escape") { address.value = currentURL; address.blur(); } });
  for (const action of ["back", "forward", "pin", "mute", "external"]) byId(action).addEventListener("click", () => void command(action));
  byId("reload").addEventListener("click", () => void command(loading ? "stop" : "reload"));
  for (const link of document.querySelectorAll("[data-url]")) link.addEventListener("click", () => void command("navigate", link.dataset.url));
  api.onState(paint);
  api.onFocusAddress(() => { address.focus(); address.select(); });
  void command("state");
})();
