// The owner's demo panel: a card that drops out of the Command rail's Work tab
// every three minutes and tells whoever is watching what Studio is, how it
// works, how to get it and where the Discord is.
//
// One machine only. Nothing is drawn or scheduled unless that machine's
// settings.json carries ui.demoPanel: true (read through prefs:get). No
// Settings control writes it, so every other install stays silent: it costs
// them one prefs read at launch and a key listener. On the machine that has
// it, Ctrl Alt Shift D turns it off and on again.
//
// It floats in a fixed layer of its own, outside #idle-hud. The tree fits
// itself around the HUD boxes idle.js measures (usableArea, hudRects), and
// this card is not one of them, so a pop-up never resizes, refits or re-seeds
// the tree. Zen fades the HUD but leaves the card, which suits a stream.
//
// Ctrl Alt Shift F is Zen now: it turns Zen on if it is off and starts its
// camera flight at once (renderer/camera-tour.js flies it for everyone).
(function () {
  "use strict";
  const EVERY_MS = 3 * 60 * 1000;   // one pop-up per three minutes
  const FIRST_MS = 20000;           // the first one after a launch
  const SLIDE_MS = 9000;            // each of the four cards
  const RETRY_MS = 5000;            // due, but Command is not on screen yet
  const RECHECK_MS = 60000;         // how stale the switch may be at a tick
  const STORE_KEY = "mefiStudio.demoPanel.lastShown";
  const RELEASES_URL = "https://github.com/nateecho32-stack/mefi-studio/releases/latest";
  const REPO_LABEL = "github.com/nateecho32-stack/mefi-studio";
  // scripts/community.cjs INVITE_URL; MefiCommunity reports the live one.
  const INVITE_URL = "https://discord.gg/xgfKc5pVxG";

  const SLIDES = [
    {
      key: "what",
      eyebrow: "What you're watching",
      title: "Mefi's Studio AI+",
      text: "A local-first desktop workspace for building software with AI. Talk an idea through with a companion, hand it over as a task, watch coding agents build it and check the result.",
      tags: ["Free · MIT", "No telemetry", "Keys stay on your PC"],
    },
    {
      key: "how",
      eyebrow: "How it works",
      title: "Idea, task, verified build",
      steps: [
        "Open a project folder. Studio scans it on your machine.",
        "Chat the idea through, or create a task with acceptance checks.",
        "Coding agents build it. This node tree is them working, live.",
        "Done means verified: each result waits in Review with its evidence.",
      ],
    },
    {
      key: "get",
      eyebrow: "How to get it",
      title: "Download the portable build",
      text: "Windows 10 or 11. Grab the latest release, extract the folder and open Mefi Studio AI+.exe. Nothing to install.",
      link: { label: REPO_LABEL, action: "Open releases", glyph: "g-update", open: () => openLink(RELEASES_URL) },
      fine: "Bring an API key, a coding CLI you already use (OpenCode, Claude Code, Codex) or a local model.",
    },
    {
      key: "discord",
      eyebrow: "Community",
      title: "Join the Void Engine Discord",
      text: "Share what you build, swap model setups and hang out with other builders. Members unlock the Void themes and node styles.",
      link: { label: () => inviteUrl().replace(/^https?:\/\//, ""), action: "Join the Discord", glyph: "g-community", open: openInvite },
    },
  ];

  const state = {
    enabled: false,
    checkedAt: 0,
    open: false,
    slide: 0,
    slideLeft: SLIDE_MS,
    slideFrom: 0,
    held: false,        // the pointer or keyboard focus is on the card
    due: 0,
    bootAt: Date.now(),
    shows: 0,
  };
  const el = {};
  let slideTimer = 0, dueTimer = 0, watchTimer = 0, bar = null, observer = null;

  const now = () => Date.now();
  const bridge = () => window.mefiStudio ?? null;
  const noMotion = () => window.MefiNav?.noMotion?.() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  function readStore(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  function inviteUrl() {
    const live = window.MefiCommunity?.status?.()?.inviteUrl;
    return typeof live === "string" && /^https:\/\/discord\.gg\//.test(live) ? live : INVITE_URL;
  }
  async function openLink(url) {
    try { await bridge()?.openExternal?.(url); } catch {}
  }
  async function openInvite() {
    try {
      const opened = await bridge()?.communityOpen?.("invite");
      if (opened?.ok) return;
    } catch {}
    await openLink(inviteUrl());
  }

  // The switch lives in settings.ui, which prefs:get merges over its defaults.
  async function readEnabled() {
    state.checkedAt = now();
    try {
      const result = await bridge()?.prefsGet?.();
      state.enabled = result?.prefs?.demoPanel === true;
    } catch {
      state.enabled = false;
    }
    return state.enabled;
  }

  // Command is up, the window is showing and Settings is not borrowing the
  // canvas for a node-style preview.
  function commandShowing() {
    const idle = window.MefiIdle;
    if (!idle?.isActive?.() || document.hidden) return false;
    return !idle.settingsPreviewStatus?.()?.active;
  }

  // ---- markup --------------------------------------------------------------
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function glyph(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "glyph");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${id}`);
    svg.append(use);
    return svg;
  }

  function ensureStyle() {
    if (el.style) return;
    el.style = node("style");
    el.style.dataset.demoPanel = "";
    el.style.textContent = CSS;
    document.head.append(el.style);
  }

  function build() {
    if (el.panel) return;
    ensureStyle();
    const panel = node("aside", "demo-panel");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "About Mefi's Studio AI+");
    panel.hidden = true;

    const head = node("div", "demo-head");
    const mark = node("span", "monogram small demo-mark", "M+");
    mark.setAttribute("aria-hidden", "true");
    const name = node("span", "demo-name", "Mefi's Studio AI+");
    el.step = node("span", "demo-step");
    const close = node("button", "ghost mini demo-close");
    close.type = "button";
    close.title = "Hide until the next one";
    close.setAttribute("aria-label", "Hide the demo panel");
    close.append(glyph("g-close"));
    close.addEventListener("click", () => hide());
    head.append(mark, name, el.step, close);

    el.body = node("div", "demo-body");

    const foot = node("div", "demo-foot");
    el.dots = SLIDES.map((slide, index) => {
      const dot = node("button", "demo-dot");
      dot.type = "button";
      dot.setAttribute("aria-label", `Show ${slide.eyebrow}`);
      dot.addEventListener("click", () => goTo(index));
      return dot;
    });
    const dots = node("div", "demo-dots");
    dots.append(...el.dots);
    const track = node("div", "demo-track");
    el.bar = node("i", "demo-bar");
    track.append(el.bar);
    foot.append(dots, track);

    panel.append(head, el.body, foot);
    // The pointer on the card, or keyboard focus in it, holds the slide. A
    // clicked button keeps focus but not :focus-visible, so it lets go.
    const keyboardIn = () => Boolean(panel.querySelector(":focus-visible"));
    panel.addEventListener("pointerenter", () => hold(true));
    panel.addEventListener("pointerleave", () => hold(keyboardIn()));
    panel.addEventListener("focusin", () => { if (keyboardIn()) hold(true); });
    panel.addEventListener("focusout", (event) => { if (!panel.contains(event.relatedTarget)) hold(panel.matches(":hover")); });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); hide(); }
    });
    document.body.append(panel);
    el.panel = panel;
  }

  function renderSlide() {
    const slide = SLIDES[state.slide];
    const body = node("div", "demo-slide");
    body.dataset.slide = slide.key;
    body.append(node("p", "demo-eyebrow", slide.eyebrow), node("h2", "demo-title", slide.title));
    if (slide.text) body.append(node("p", "demo-text", slide.text));
    if (slide.steps) {
      const list = node("ol", "demo-steps");
      for (const step of slide.steps) list.append(node("li", "", step));
      body.append(list);
    }
    if (slide.tags) {
      const tags = node("p", "demo-tags");
      for (const tag of slide.tags) tags.append(node("span", "demo-tag", tag));
      body.append(tags);
    }
    if (slide.link) {
      const row = node("div", "demo-link");
      const label = typeof slide.link.label === "function" ? slide.link.label() : slide.link.label;
      const url = node("span", "demo-url", label);
      const go = node("button", "primary mini demo-go");
      go.type = "button";
      go.append(glyph(slide.link.glyph), node("span", "", slide.link.action));
      go.addEventListener("click", () => void slide.link.open());
      row.append(url, go);
      body.append(row);
    }
    if (slide.fine) body.append(node("p", "demo-fine", slide.fine));
    el.body.replaceChildren(body);
    el.step.textContent = `${state.slide + 1} / ${SLIDES.length}`;
    el.dots.forEach((dot, index) => dot.setAttribute("aria-current", index === state.slide ? "step" : "false"));
  }

  // ---- placement: under the Work tab, never measured by the tree ------------
  function place() {
    const panel = el.panel;
    if (!panel) return;
    const rail = document.getElementById("cmd-rail");
    const tabs = rail?.querySelector(".rail-tabs");
    const work = document.getElementById("cmd-rail-tab-work");
    const r = rail?.getBoundingClientRect?.(), t = tabs?.getBoundingClientRect?.(), w = work?.getBoundingClientRect?.();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left, top, width, side = "none", caret = 0;
    if (!r || r.width < 160 || !t || !w || w.width <= 0) {
      // No rail on screen (narrow window): the top-right corner instead.
      width = Math.min(340, vw - 32);
      left = vw - width - 16;
      top = 76;
    } else if (t.width >= t.height) {
      // The strip runs across the top of the rail: hang the card beneath it.
      left = t.left;
      width = t.width;
      top = t.bottom + 10;
      side = "top";
      caret = w.left + w.width / 2 - left;
    } else {
      // Inspect mode stands the strip up along the rail's right edge.
      width = Math.max(240, Math.min(360, t.left - r.left - 22));
      left = t.left - 10 - width;
      top = w.top;
      side = "right";
      caret = w.top + w.height / 2 - top;
    }
    panel.style.left = `${Math.round(Math.max(8, left))}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.width = `${Math.round(width)}px`;
    panel.style.maxHeight = `${Math.max(180, Math.round(vh - top - 16))}px`;
    panel.dataset.caret = side;
    panel.style.setProperty("--demo-caret", `${Math.round(caret)}px`);
  }

  // ---- the cycle -----------------------------------------------------------
  function runBar(ms) {
    bar?.cancel?.();
    bar = null;
    if (!el.bar || noMotion() || typeof el.bar.animate !== "function") return;
    const done = 1 - ms / SLIDE_MS;
    bar = el.bar.animate([{ transform: `scaleX(${done})` }, { transform: "scaleX(1)" }], { duration: ms, easing: "linear", fill: "forwards" });
  }

  function startSlide(ms = SLIDE_MS) {
    clearTimeout(slideTimer);
    state.slideLeft = ms;
    state.slideFrom = now();
    runBar(ms);
    if (state.held) { bar?.pause?.(); return; }
    slideTimer = setTimeout(nextSlide, ms);
  }

  function nextSlide() {
    if (state.slide >= SLIDES.length - 1) { hide(); return; }
    goTo(state.slide + 1);
  }

  function goTo(index) {
    if (!state.open) return;
    state.slide = Math.max(0, Math.min(SLIDES.length - 1, index));
    renderSlide();
    place();
    startSlide();
  }

  function hold(on) {
    if (!state.open || on === state.held) return;
    state.held = on;
    if (on) {
      clearTimeout(slideTimer);
      state.slideLeft = Math.max(0, state.slideLeft - (now() - state.slideFrom));
      bar?.pause?.();
    } else {
      // A slide read to its end under the pointer still gets a moment after.
      const ms = Math.max(1500, state.slideLeft);
      state.slideFrom = now();
      state.slideLeft = ms;
      runBar(ms);
      slideTimer = setTimeout(nextSlide, ms);
    }
  }

  function show() {
    if (!state.enabled) return false;
    build();
    state.open = true;
    state.held = false;
    state.slide = 0;
    state.shows += 1;
    writeStore(STORE_KEY, String(now()));
    renderSlide();
    place();
    el.panel.hidden = false;
    startSlide();
    // Follow the rail while the card is up: inspect mode and a resize move it.
    clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      if (!commandShowing()) hide();
      else place();
    }, 1000);
    if (typeof ResizeObserver === "function" && !observer) {
      observer = new ResizeObserver(() => { if (state.open) place(); });
      const rail = document.getElementById("cmd-rail");
      if (rail) observer.observe(rail);
    }
    schedule();
    return true;
  }

  function hide() {
    clearTimeout(slideTimer);
    clearInterval(watchTimer);
    bar?.cancel?.();
    bar = null;
    observer?.disconnect?.();
    observer = null;
    state.open = false;
    state.held = false;
    if (el.panel) {
      // Keyboard focus inside a closing card goes back to the Work tab.
      if (el.panel.contains(document.activeElement)) document.getElementById("cmd-rail-tab-work")?.focus?.({ preventScroll: true });
      el.panel.hidden = true;
    }
  }

  // The next pop-up is three minutes after the last one, whichever launch it
  // was in, so a hot-deploy relaunch does not bring one straight back.
  function schedule(delay = null) {
    clearTimeout(dueTimer);
    const last = Number(readStore(STORE_KEY)) || 0;
    state.due = delay === null ? Math.max(last + EVERY_MS, state.bootAt + FIRST_MS) : now() + delay;
    dueTimer = setTimeout(tick, Math.max(0, state.due - now()));
  }

  // A due pop-up waits for Command to be on screen, re-reading the switch at
  // most once a minute, so a hand edit to settings.json that turns it off
  // takes hold without a relaunch.
  async function tick() {
    if (now() - state.checkedAt >= RECHECK_MS) await readEnabled();
    if (!state.enabled) { hide(); clearTimeout(dueTimer); return; }
    if (state.open) { schedule(); return; }
    if (!commandShowing()) { schedule(RETRY_MS); return; }
    show();
  }

  async function toggle() {
    const next = !state.enabled;
    try {
      const saved = await bridge()?.prefsSet?.({ demoPanel: next });
      if (!saved?.ok) return;
    } catch {
      return;
    }
    state.enabled = next;
    state.checkedAt = now();
    if (next) {
      writeStore(STORE_KEY, "0");
      state.bootAt = now() - FIRST_MS;
      if (commandShowing()) show();
      else schedule(RETRY_MS);
    } else {
      hide();
      clearTimeout(dueTimer);
    }
  }

  function chord(event, code) {
    return event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey && event.code === code;
  }

  function onKey(event) {
    const zen = state.enabled && chord(event, "KeyF");
    if (!chord(event, "KeyD") && !zen) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (zen) window.MefiIdle?.enterZen?.();
    else void toggle();
  }

  async function init() {
    if (!bridge()?.prefsGet) return;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", () => { if (state.open) place(); });
    if (await readEnabled()) schedule();
  }

  const CSS = `
.demo-panel {
  --panel-solid: var(--theme-panel-solid); --hairline: var(--theme-hairline); --hairline-strong: var(--theme-hairline-strong);
  --demo-edge: color-mix(in srgb, var(--gold) 38%, var(--hairline-strong));
  position: fixed; z-index: var(--z-pop); box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10px;
  padding: 11px 13px 12px; overflow: visible;
  border: 1px solid var(--demo-edge); border-radius: var(--r-md, 12px);
  background: var(--panel-solid); color: var(--ivory);
  box-shadow: var(--shadow-2), 0 0 26px color-mix(in srgb, var(--gold) 16%, transparent);
  font: 13px/1.45 var(--font-ui); pointer-events: auto;
  transition: opacity var(--motion-base) var(--ease-out), translate var(--motion-spring) var(--ease-spring), display var(--motion-base) allow-discrete;
}
.demo-panel[hidden] {
  opacity: 0; translate: 0 -8px; pointer-events: none;
  transition: opacity var(--motion-exit) var(--ease-in), translate var(--motion-exit) var(--ease-in), display var(--motion-exit) allow-discrete;
}
@starting-style { .demo-panel:not([hidden]) { opacity: 0; translate: 0 -10px; } }
.demo-panel::before {
  content: ""; position: absolute; width: 10px; height: 10px; box-sizing: border-box;
  background: var(--panel-solid); border: 1px solid var(--demo-edge); display: none;
}
.demo-panel[data-caret="top"]::before { display: block; top: -6px; left: calc(var(--demo-caret) - 5px); border-right: 0; border-bottom: 0; rotate: 45deg; }
.demo-panel[data-caret="right"]::before { display: block; right: -6px; top: calc(var(--demo-caret) - 5px); border-left: 0; border-bottom: 0; rotate: 45deg; }
.demo-head { display: flex; align-items: center; gap: 9px; min-height: 28px; }
.demo-mark { flex: none; }
.demo-name { flex: 1; min-width: 0; font-weight: 600; letter-spacing: var(--track-ui); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.demo-step { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.demo-close { flex: none; width: 26px; min-height: 26px; padding: 0; display: grid; place-items: center; }
.demo-body { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.demo-slide { display: flex; flex-direction: column; gap: 7px; transition: opacity var(--motion-base) var(--ease-out), translate var(--motion-base) var(--ease-out); }
@starting-style { .demo-slide { opacity: 0; translate: 6px 0; } }
.demo-eyebrow { margin: 0; color: var(--gold-bright); font-size: var(--fs-2xs); font-weight: 600; letter-spacing: var(--track-eyebrow); text-transform: uppercase; }
.demo-title { margin: 0; font-size: var(--fs-lg); line-height: var(--lh-tight); color: var(--ivory); }
.demo-text, .demo-fine { margin: 0; color: var(--muted); }
.demo-fine { font-size: var(--fs-xs); }
.demo-steps { margin: 0; padding: 0; list-style: none; counter-reset: demo; display: grid; gap: 6px; }
.demo-steps li { counter-increment: demo; display: grid; grid-template-columns: 20px 1fr; gap: 8px; align-items: start; color: var(--ivory); }
.demo-steps li::before {
  content: counter(demo); display: grid; place-items: center; width: 20px; height: 20px; margin-top: 0;
  border: 1px solid var(--demo-edge); border-radius: 999px; color: var(--gold-bright); font-size: 10.5px; font-weight: 600;
}
.demo-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 0; }
.demo-tag { padding: 2px 8px; border: 1px solid var(--hairline-strong); border-radius: 999px; color: var(--ivory); font-size: 11px; }
.demo-link { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-sm, 8px); background: color-mix(in srgb, var(--ivory) 4%, var(--panel-solid)); }
.demo-url { flex: 1 1 160px; min-width: 0; font: 600 12.5px var(--font-mono); color: var(--gold-bright); overflow-wrap: anywhere; }
.demo-go { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.demo-foot { display: flex; align-items: center; gap: 10px; }
.demo-dots { display: flex; gap: 5px; }
.demo-dot { width: 8px; height: 8px; min-height: 0; padding: 0; border: 1px solid var(--hairline-strong); border-radius: 999px; background: transparent; box-shadow: none; cursor: pointer; }
.demo-dot[aria-current="step"] { background: var(--gold); border-color: var(--gold); }
.demo-dot:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.demo-track { flex: 1; height: 2px; border-radius: 2px; background: var(--hairline); overflow: hidden; }
.demo-bar { display: block; height: 100%; background: var(--gold); transform-origin: left; transform: scaleX(0); }
html[data-motion="off"] .demo-bar { transform: none; opacity: .5; }
`;

  window.MefiDemoPanel = {
    show,
    hide,
    toggle,
    status: () => ({
      enabled: state.enabled,
      open: state.open,
      slide: state.open ? SLIDES[state.slide].key : null,
      held: state.held,
      due: state.due,
      shows: state.shows,
      caret: el.panel?.dataset.caret ?? null,
    }),
    slides: SLIDES.map((slide) => slide.key),
    EVERY_MS,
    SLIDE_MS,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void init());
  else void init();
})();
