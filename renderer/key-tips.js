// Key tips: small pop-ups beside a button, tab or box that name the key doing
// the same thing, as keycaps. A first launch meets them one or two at a time,
// once the setup helper, the walkthrough and every sheet are out of the way.
// Clicking a tip (or pressing the key it names) fades it away for good; its
// "Turn tips off" link, Settings (#settings-key-tips), Vibe's settings panel
// and Search all switch them off, and "Show key tips again" brings every one
// back. What was seen lives in localStorage, per device, like the other
// first-run notes (mefiStudio.keyHint.v1, mefiStudio.setupHelper.seen).
(function () {
  "use strict";
  const OFF_KEY = "mefiStudio.keyTips";
  const SEEN_KEY = "mefiStudio.keyTips.seen";
  const HOLD_MS = 5000; // quiet after launch before the first tip
  const TICK_MS = 2000;
  const MAX_SHOWN = 2;
  const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private store */ } };

  const vibeMode = () => { try { return window.MefiVibe?.mode?.() === "vibe"; } catch { return false; } };
  const onVibe = () => Boolean(window.MefiVibe?.isActive?.());
  const onCommand = () => Boolean(window.MefiIdle?.isActive?.()) && !window.MefiNav?.state?.sheet;
  const onBuild = () => !vibeMode() && !onCommand();
  // Each tip: where it applies, the control it points at (the first visible
  // match), which side it sits on, and its keys with what they do.
  const TIPS = [
    // Under Build it, not beside the box: the box runs the page's width, so beside it the tip landed on Build it itself.
    { id: "vibe-box", when: onVibe, target: "#vibe-build", side: "bottom", parts: [["/", "jump into the box"], ["Enter", "talk it over"], ["Ctrl+Enter", "build it"]] },
    { id: "vibe-dock", when: onVibe, target: "#vibe-dock", side: "right", parts: [["D", "watch the tree"], ["T", "tasks"], ["M", "team"]] },
    { id: "vibe-pulse", when: onVibe, target: "#vibe-pulse", side: "bottom", parts: [["N", "what needs you"], ["C", "the conversation"]] },
    { id: "vibe-search", when: onVibe, target: "#vibe-layer .vibe-top-actions [data-nav='palette']", side: "bottom", parts: [["Ctrl+K", "find anything"], ["?", "every shortcut"]] },
    { id: "build-home", when: onBuild, target: "#app-rail-sections", side: "right", parts: [["H", "Home"], ["D", "the Map"], ["T", "task board"]] },
    { id: "build-search", when: onBuild, target: "#app-rail-foot [data-nav='palette'], [data-nav='palette']", side: "right", parts: [["Ctrl+K", "jump anywhere"], ["?", "every shortcut"], ["Ctrl+,", "Settings"]] },
    { id: "command-walk", when: onCommand, target: "#map-bar", side: "bottom", parts: [["← →", "walk the tree"], ["Enter", "open a node"], ["F", "fit it all"]] },
    { id: "command-leave", when: onCommand, target: "#map-zoom", side: "top", parts: [["Esc", "step back out"], ["V", "3D or flat map"], ["?", "every key"]] },
  ];

  const state = { shown: new Map(), timer: null, started: false, seen: readSeen() };
  function readSeen() {
    try { const list = JSON.parse(read(SEEN_KEY) || "[]"); return new Set(Array.isArray(list) ? list.map(String) : []); } catch { return new Set(); }
  }
  const saveSeen = () => write(SEEN_KEY, JSON.stringify([...state.seen]));
  const enabled = () => read(OFF_KEY) !== "off";
  const remaining = () => TIPS.filter((tip) => !state.seen.has(tip.id));

  // Nothing pops over the boot gate, the setup helper, the walkthrough,
  // What's new (Vibe's card, and the sheet renderer/whats-new.js opens after an
  // update), an open sheet or dialog, the companion or a menu.
  function busy() {
    const nav = window.MefiNav?.state;
    if (nav?.sheet || nav?.transient) return true;
    if (window.MefiBoot?.isActive?.() || window.MefiSetupHelper?.isOpen?.() || window.MefiSetupHelper?.welcomeOpen?.() || window.MefiCompanionHub?.isOpen?.() || window.MefiSidebar?.isOpen?.()) return true;
    for (const id of ["walkthrough-overlay", "walkthrough-coach", "vibe-notes", "whats-new-sheet", "boot-layer", "setup-welcome", "setup-look-tip", "shell-menu", "today-inbox", "app-help-menu", "music-dropdown"]) {
      const node = document.getElementById(id);
      if (node && !node.hidden && node.getClientRects?.().length) return true;
    }
    // The tab strip's pop-ups (its menus, "+", Tab behaviour): a tip never sits over an open menu.
    for (const node of document.querySelectorAll?.("[id^='mefi-tabs-pop-']") ?? []) if (!node.hidden && node.getClientRects?.().length) return true;
    return document.hidden === true;
  }
  function targetOf(tip) {
    for (const selector of tip.target.split(/,\s*/)) {
      for (const node of document.querySelectorAll(selector)) {
        const rect = node.getBoundingClientRect?.();
        if (rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth) return node;
      }
    }
    return null;
  }

  // ---- the pop-up -----------------------------------------------------------------
  function keyCaps(combo) {
    const holder = document.createElement("span");
    holder.className = "key-tip-keys";
    combo.split("+").forEach((part, index) => {
      if (index) holder.append(document.createTextNode("+"));
      const cap = document.createElement("kbd");
      cap.className = "key";
      cap.textContent = part;
      holder.append(cap);
    });
    return holder;
  }
  function build(tip) {
    const box = document.createElement("div");
    box.className = "key-tip";
    box.dataset.tip = tip.id;
    box.dataset.side = tip.side;
    box.setAttribute("role", "note");
    box.setAttribute("aria-label", `Key tip: ${tip.parts.map(([keys, text]) => `${keys.replace("+", " ")} ${text}`).join(", ")}`);
    box.title = "Click to fade this tip away";
    const list = document.createElement("ul");
    list.className = "key-tip-list";
    for (const [keys, text] of tip.parts) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = text;
      item.append(keyCaps(keys), label);
      list.append(item);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "key-tip-close";
    close.setAttribute("aria-label", "Hide this tip");
    close.textContent = "×";
    const off = document.createElement("button");
    off.type = "button";
    off.className = "key-tip-off";
    off.textContent = "Turn tips off";
    off.addEventListener("click", (event) => { event.stopPropagation(); setEnabled(false); window.MefiToast?.("Key tips are off. Turn them back on in Settings.", "info"); });
    box.append(list, close, off);
    box.addEventListener("click", () => dismiss(tip.id));
    return box;
  }
  function place(box, target, wanted) {
    const rect = target.getBoundingClientRect();
    const width = box.offsetWidth, height = box.offsetHeight, gap = 12, pad = 10;
    // No room beside it on the right: the other side, arrow and all.
    const side = wanted === "right" && rect.right + gap + width > window.innerWidth - pad && rect.left - gap - width >= pad ? "left" : wanted;
    if (box.dataset.side !== side) box.dataset.side = side;
    let left, top;
    if (side === "right") { left = rect.right + gap; top = rect.top + Math.min(rect.height, 160) / 2 - height / 2; }
    else if (side === "left") { left = rect.left - gap - width; top = rect.top + Math.min(rect.height, 160) / 2 - height / 2; }
    else { left = rect.left + rect.width / 2 - width / 2; top = side === "bottom" ? rect.bottom + gap : rect.top - gap - height; }
    const clampedLeft = Math.max(pad, Math.min(window.innerWidth - width - pad, left));
    const clampedTop = Math.max(pad, Math.min(window.innerHeight - height - pad, top));
    box.style.left = `${Math.round(clampedLeft)}px`;
    box.style.top = `${Math.round(clampedTop)}px`;
    // The little arrow keeps pointing at the control when the box is clamped.
    if (side === "top" || side === "bottom") box.style.setProperty?.("--arrow", `${Math.round(rect.left + rect.width / 2 - clampedLeft)}px`);
    else box.style.setProperty?.("--arrow", `${Math.round(Math.max(14, Math.min(height - 14, rect.top + Math.min(rect.height, 160) / 2 - clampedTop)))}px`);
    return { left: clampedLeft, top: clampedTop, right: clampedLeft + width, bottom: clampedTop + height };
  }
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  function hide(id, { seen = false } = {}) {
    const entry = state.shown.get(id);
    if (seen && !state.seen.has(id)) { state.seen.add(id); saveSeen(); }
    if (!entry) return;
    state.shown.delete(id);
    const box = entry.box;
    box.classList.add("is-leaving");
    const gone = () => box.remove();
    const still = window.MefiNav?.noMotion?.();
    if (still) gone(); else { box.addEventListener("transitionend", gone, { once: true }); setTimeout(gone, 400); }
  }
  function dismiss(id) {
    hide(id, { seen: true });
    // The next tip waits a beat instead of popping into the same place.
    schedule(900);
  }

  // One pass: drop tips whose place is gone, move the rest, then add unseen
  // ones for what is on screen until MAX_SHOWN stand.
  function tick() {
    state.timer = null;
    if (!enabled() || headless) { clear(); return; }
    if (busy()) { for (const id of [...state.shown.keys()]) hide(id); schedule(TICK_MS); return; }
    const rects = [];
    for (const [id, entry] of [...state.shown]) {
      const target = entry.tip.when() ? targetOf(entry.tip) : null;
      if (!target) { hide(id); continue; }
      rects.push(place(entry.box, target, entry.tip.side));
    }
    for (const tip of remaining()) {
      if (state.shown.size >= MAX_SHOWN) break;
      if (state.shown.has(tip.id) || !tip.when()) continue;
      const target = targetOf(tip);
      if (!target) continue;
      const box = build(tip);
      if (state.shown.size) box.style.setProperty?.("--tip-delay", "420ms");
      document.body.append(box);
      const rect = place(box, target, tip.side);
      if (rects.some((other) => overlaps(other, rect))) { box.remove(); continue; }
      rects.push(rect);
      state.shown.set(tip.id, { tip, box });
    }
    if (remaining().length) schedule(TICK_MS);
  }
  function schedule(ms) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(tick, ms);
  }
  function clear() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    for (const id of [...state.shown.keys()]) hide(id);
  }

  // Pressing the key a tip names means it landed: that tip fades for good.
  const comboOf = (event) => {
    const key = event.key === " " ? "Space" : event.key?.length === 1 ? event.key.toUpperCase() : event.key;
    const arrows = { ArrowLeft: "← →", ArrowRight: "← →" };
    return [(event.ctrlKey || event.metaKey) && key !== "Control" ? "Ctrl" : null, arrows[key] || (key === "Escape" ? "Esc" : key)].filter(Boolean).join("+");
  };
  function learned(event) {
    if (!state.shown.size) return;
    const combo = comboOf(event);
    // Letters typed into a field are writing, not the shortcut; Enter and
    // Ctrl chords in the box are the keys the box tip names.
    const typing = event.target?.closest?.("input, textarea, select, [contenteditable]");
    if (typing && !combo.startsWith("Ctrl+") && !["Enter", "Esc"].includes(combo)) return;
    for (const [id, entry] of [...state.shown]) if (entry.tip.parts.some(([keys]) => keys.toUpperCase() === combo.toUpperCase())) dismiss(id);
  }

  function setEnabled(on) {
    write(OFF_KEY, on ? null : "off");
    const box = document.getElementById("settings-key-tips");
    if (box) box.checked = on;
    if (on) start(true); else clear();
    return on;
  }
  // Every tip back, as for a first launch.
  function reset() {
    state.seen = new Set();
    write(SEEN_KEY, null);
    setEnabled(true);
    schedule(600);
  }
  function start(soon = false) {
    if (headless) return;
    if (!state.started) {
      state.started = true;
      window.addEventListener("keydown", learned, true);
      window.addEventListener("resize", () => { if (state.shown.size) schedule(60); });
      window.addEventListener("mefi:nav", () => { if (enabled() && remaining().length) schedule(state.shown.size ? 60 : 1200); });
      window.addEventListener("mefi:project-changed", () => schedule(1200));
      const box = document.getElementById("settings-key-tips");
      if (box) { box.checked = enabled(); box.addEventListener("change", () => { setEnabled(box.checked); window.MefiToast?.(box.checked ? "Key tips are on." : "Key tips are off.", "info"); }); }
    }
    if (enabled() && remaining().length) schedule(soon ? 600 : HOLD_MS);
  }

  // The key tips cover what nav.js's one-time "single keys move around" toast
  // says, so a device that will see them skips that toast.
  if (!headless && enabled() && remaining().length) write("mefiStudio.keyHint.v1", "1");

  window.MefiNav?.register?.({
    id: "keyTipsToggle", get label() { return enabled() ? "Turn key tips off" : "Turn key tips on"; }, short: "Key tips", kind: "action", layer: null, section: "help", group: "system",
    key: null, glyph: "g-help", badge: null, desc: "Small pop-ups beside buttons that name the key doing the same thing",
    searchTerms: "key tips hints hotkeys shortcuts keyboard popups help first time", showIn: { palette: true },
    run: () => { const on = setEnabled(!enabled()); window.MefiToast?.(on ? "Key tips are on." : "Key tips are off.", "info"); },
  });
  window.MefiNav?.register?.({
    id: "keyTipsAgain", label: "Show key tips again", short: "Key tips again", kind: "action", layer: null, section: "help", group: "system",
    key: null, glyph: "g-help", badge: null, desc: "Bring back every key tip you faded away",
    searchTerms: "key tips hints hotkeys shortcuts keyboard reset again", showIn: { palette: true },
    run: () => reset(),
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start(), { once: true });
  else start();

  window.MefiKeyTips = { enabled, setEnabled, reset, tick, shown: () => [...state.shown.keys()], seen: () => [...state.seen], tips: () => TIPS.map(({ id, parts }) => ({ id, parts })) };
})();
