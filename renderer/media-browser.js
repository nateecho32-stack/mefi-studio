// The media player's browser toolbar. Websites stay in a sandboxed native
// child view clipped to this viewport inside Studio, with no Studio bridge.
(() => {
  "use strict";
  function create({ host, onMove, onMoveKey, onMinimize, onClose, onChange }) {
    const root = document.createElement("section"); root.className = "music-browser"; root.hidden = true;
    root.setAttribute("aria-label", "Built-in media browser");
    root.innerHTML = `<header class="music-browser-header">
      <button type="button" id="browser-move" title="Move media player; arrow keys move it too">⠿ Media browser</button>
      <button type="button" id="browser-mute" aria-pressed="false">Mute</button>
      <button type="button" id="browser-external" title="Open in your regular browser" aria-label="Open in your regular browser">↗</button>
      <button type="button" id="browser-minimize" aria-label="Minimize media browser">−</button>
      <button type="button" id="browser-close" aria-label="Close media browser and stop playback">×</button>
    </header>
    <form id="browser-form" class="music-browser-address">
      <button id="browser-back" type="button" aria-label="Back" disabled>←</button>
      <button id="browser-forward" type="button" aria-label="Forward" disabled>→</button>
      <button id="browser-reload" type="button" aria-label="Reload">↻</button>
      <input id="browser-address" aria-label="Web address" placeholder="Enter a website or paste a link" autocomplete="off" spellcheck="false" maxlength="8192">
      <button type="submit">Go</button>
    </form>
    <p id="browser-status" class="music-browser-status" role="status">Browse here inside Studio.</p>
    <div id="browser-viewport" class="music-browser-viewport">
      <div class="music-browser-welcome"><span aria-hidden="true">♫</span><h3>Your media, right here.</h3><p>Open a website in this player.</p>
        <div class="music-browser-sites"><button data-url="https://www.youtube.com">YouTube</button><button data-url="https://music.youtube.com">YouTube Music</button><button data-url="https://open.spotify.com">Spotify</button><button data-url="https://soundcloud.com">SoundCloud</button><button data-url="https://www.twitch.tv">Twitch</button></div>
      </div>
    </div>`;
    host.append(root);
    const get = id => root.querySelector(`#browser-${id}`);
    const address = get("address"), viewport = get("viewport"), status = get("status");
    let active = false, subscribed = false, frame = 0, stamp = "", observers = [], revision = 0;
    let state = { url: "", title: "Media browser", loading: false };
    function paint(next) {
      if (!active) return;
      state = next;
      if (document.activeElement !== address) address.value = state.url;
      get("back").disabled = !state.back; get("forward").disabled = !state.forward;
      get("external").disabled = !state.url;
      get("mute").setAttribute("aria-pressed", String(state.muted));
      get("mute").textContent = state.muted ? "Unmute" : "Mute";
      get("reload").textContent = state.loading ? "×" : "↻";
      get("reload").setAttribute("aria-label", state.loading ? "Stop loading" : "Reload");
      status.textContent = state.error || (state.loading ? "Loading…" : state.url ? state.title : "Browse here inside Studio.");
      status.dataset.error = String(Boolean(state.error));
      root.querySelector(".music-browser-welcome").hidden = Boolean(state.url);
      onChange?.(state); schedule();
    }
    async function command(action, url) {
      try {
        const result = await window.mefiStudio?.mediaBrowserCommand?.({ action, url });
        if (result?.state) paint(result.state);
        if (!result?.ok) { status.textContent = result?.error || "Browser controls are unavailable."; status.dataset.error = "true"; }
        return result;
      } catch { status.textContent = "Browser controls are unavailable. Close and reopen the player."; return { ok: false }; }
    }
    function sync() {
      frame = 0;
      if (!active) return;
      const player = root.closest(".media-window"), box = viewport.getBoundingClientRect();
      let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(window.innerWidth, box.right), bottom = Math.min(window.innerHeight, box.bottom);
      // media-window clips its docked DOM surface as the menu scrolls. Native
      // content needs the same clip, independent of the full website size.
      const inset = player && getComputedStyle(player).clipPath.match(/^inset\(([^)]+)\)$/);
      if (inset) {
        const parts = inset[1].trim().split(/\s+/).map(Number.parseFloat), bounds = player.getBoundingClientRect();
        const [north, east = north, south = north, west = east] = parts;
        if (parts.every(Number.isFinite)) {
          left = Math.max(left, bounds.left + west); top = Math.max(top, bounds.top + north);
          right = Math.min(right, bounds.right - east); bottom = Math.min(bottom, bounds.bottom - south);
        }
      }
      // A small Studio notification should not blank the entire website. Keep
      // its visible controls clear while leaving the rest of the page usable.
      for (const notice of document.querySelectorAll("#toast-host .toast")) {
        const area = notice.getBoundingClientRect();
        if (area.width < 1 || area.height < 1 || area.right <= left || area.left >= right || area.bottom <= top || area.top >= bottom) continue;
        if (area.top > top) bottom = Math.min(bottom, area.top - 4);
        else if (area.left > left) right = Math.min(right, area.left - 4);
        else left = Math.max(left, area.right + 4);
      }
      const clip = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      let visible = !root.hidden && !document.hidden && player && !player.hidden && player.dataset.minimized !== "true" && player.dataset.interacting !== "true" && clip.width > 1 && clip.height > 1;
      // Native views sit above DOM content. Yield to Studio dialogs and menus
      // so the website cannot cover their controls or take their clicks.
      const insetX = Math.min(6, clip.width / 2), insetY = Math.min(6, clip.height / 2);
      if (visible) for (const x of [left + insetX, left + clip.width / 2, right - insetX]) {
        for (const y of [top + insetY, top + clip.height / 2, bottom - insetY]) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || !viewport.contains(hit)) visible = false;
        }
      }
      const payload = { action: "layout", visible: Boolean(visible), bounds: { x: box.x, y: box.y, width: box.width, height: box.height }, clip };
      const next = JSON.stringify(payload);
      if (stamp === next) return;
      stamp = next;
      Promise.resolve(window.mefiStudio?.mediaBrowserCommand?.(payload)).catch(() => {});
    }
    function schedule() { if (active && !frame) frame = window.requestAnimationFrame(sync); }
    function observe() {
      const player = root.closest(".media-window");
      const resize = new ResizeObserver(schedule); resize.observe(viewport); if (player) resize.observe(player);
      const notices = document.getElementById("toast-host"); if (notices) resize.observe(notices);
      const position = new MutationObserver(schedule); if (player) position.observe(player, { attributes: true });
      const overlays = new MutationObserver(records => { if (records.some(record => !root.contains(record.target))) schedule(); });
      overlays.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open", "aria-modal"] });
      observers = [resize, position, overlays];
      for (const name of ["pointerdown", "pointerup", "keydown", "focusin", "visibilitychange", "scroll"]) document.addEventListener(name, schedule, true);
      for (const name of ["resize", "mefi:nav", "mefi:shell"]) window.addEventListener(name, schedule);
    }
    function deactivate() {
      active = false; root.hidden = true; stamp = "";
      if (frame) window.cancelAnimationFrame(frame); frame = 0;
      for (const observer of observers) observer.disconnect(); observers = [];
      for (const name of ["pointerdown", "pointerup", "keydown", "focusin", "visibilitychange", "scroll"]) document.removeEventListener(name, schedule, true);
      for (const name of ["resize", "mefi:nav", "mefi:shell"]) window.removeEventListener(name, schedule);
    }
    async function open(raw = "") {
      const request = ++revision;
      const api = window.mefiStudio;
      if (!api?.mediaBrowserOpen) return { ok: false, error: "The built-in browser needs the Studio desktop app." };
      if (!subscribed) {
        api.onMediaBrowserState?.(paint);
        api.onMediaBrowserFocus?.(() => { if (active) { address.focus(); address.select(); } });
        subscribed = true;
      }
      const result = await api.mediaBrowserOpen(raw);
      if (request !== revision) return { ok: false };
      if (!result?.ok) return result;
      deactivate(); active = true; root.hidden = false;
      if (result.state) paint(result.state);
      observe(); schedule(); return result;
    }
    function close() {
      revision++;
      deactivate(); void command("close");
    }
    get("form").addEventListener("submit", event => { event.preventDefault(); address.blur(); void command("navigate", address.value); });
    get("move").addEventListener("pointerdown", onMove); get("move").addEventListener("keydown", onMoveKey);
    get("minimize").addEventListener("click", onMinimize); get("close").addEventListener("click", onClose);
    for (const action of ["back", "forward", "mute", "external"]) get(action).addEventListener("click", () => void command(action));
    get("reload").addEventListener("click", () => void command(state.loading ? "stop" : "reload"));
    for (const link of root.querySelectorAll("[data-url]")) link.addEventListener("click", () => void command("navigate", link.dataset.url));
    root.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") { event.preventDefault(); address.focus(); address.select(); }
      if (event.key === "Escape" && event.target === address) { address.value = state.url; address.blur(); }
    });
    return { open, close, schedule, get active() { return active; }, get state() { return state; } };
  }
  window.MefiMediaBrowser = { create };
})();
