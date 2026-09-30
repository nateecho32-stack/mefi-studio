// One companion from wake-up to the studio menu. This layer only presents
// existing actions; setup, queue changes and friend connections retain their gates.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, cls = "ghost") => { const el = node("button", cls, text); el.type = "button"; el.addEventListener("click", run); return el; };
  const still = () => window.MefiNav?.noMotion?.() || ["off", "calm"].includes(document.documentElement.dataset.motion) || document.body.classList.contains("ws-still") || document.body.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const name = () => { try { return localStorage.getItem("mefiStudio.workspace.companion")?.trim() || "Mefi"; } catch { return "Mefi"; } };
  // Unit suites load this file without studio-ui.js (MefiUi).
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback;
  // A motion token in ms (styles.css section 1), so JS waits exactly as long as CSS plays.
  function tokenMs(token, fallback) {
    let value = "";
    try { value = getComputedStyle(document.documentElement).getPropertyValue(token).trim(); } catch { /* the fallback */ }
    const number = parseFloat(value);
    return !Number.isFinite(number) ? fallback : /ms$/.test(value) ? number : /s$/.test(value) ? number * 1000 : number;
  }
  const glyphSvg = (id) => `<svg class="glyph" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
  const hub = { open: false, closing: false, section: null, friendTarget: null, locked: new Map(), returnFocus: null, timer: 0 };
  const el = {};
  let host, data, bootPhase, audioFrame = 0, audioAt = 0, energy = 0, wakeTimer = 0, reactionIndex = 0, chatThinking = false, anticTimer = 0, lastTouch = Date.now();
  const plays = new WeakMap();
  // How it carries itself (Settings › Personality): faces or a plain check,
  // and whether it plays on its own while nothing needs it.
  const prefs = { personality: "balanced", expressions: true, antics: false };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // No shared SVG IDs: each light can appear in the launch box, rail and hub.
  const face = () => '<svg class="agent-creature" viewBox="0 0 80 80" aria-hidden="true" focusable="false"><g class="agent-body"><circle class="agent-aura" cx="40" cy="44" r="25"/><path class="agent-vapor" d="M27 52C15 44 22 30 39 31c15 1 22-8 21-17-1 12-7 15-16 19"/><path class="agent-vapor agent-vapor-fine" d="M49 55c12-5 15-16 8-22M23 40c-3 10 3 17 12 17"/><circle class="agent-glow" cx="40" cy="44" r="15"/><circle class="agent-core" cx="40" cy="44" r="8.5"/><circle class="agent-heart" cx="38" cy="42" r="3.5"/><g class="agent-orbit"><circle class="agent-mote" cx="20" cy="41" r="1.5"/><circle class="agent-mote" cx="57" cy="53" r="1.1"/><circle class="agent-mote" cx="49" cy="25" r=".8"/></g></g><text class="agent-thought" x="40" y="21" text-anchor="middle"><tspan>.</tspan><tspan>.</tspan><tspan>.</tspan></text><g class="agent-reactions"/></svg>';

  function clearPlay(target) {
    if (!target) return;
    const previous = plays.get(target);
    if (previous) { clearTimeout(previous.timer); for (const animation of previous.animations) animation.cancel(); plays.delete(target); }
    target.querySelector(".agent-reactions")?.replaceChildren();
  }
  function spark(tag, cls, attrs, text) {
    const item = document.createElementNS("http://www.w3.org/2000/svg", tag);
    item.setAttribute("class", cls);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, value);
    if (text) item.textContent = text;
    return item;
  }

  function play(target, expression) {
    if (!target || document.hidden) return;
    clearPlay(target);
    const motion = !still() && Boolean(target.animate), effects = target.querySelector(".agent-reactions");
    const playback = { animations: [], timer: 0 }; plays.set(target, playback);
    const animate = (item, frames, options) => playback.animations.push(item.animate(frames, options));
    // Without faces (Straight work) a finished reply is a plain check and
    // everything else is only the little hop; "..." still says it is thinking.
    const plain = !prefs.expressions && expression !== "..." && !target.closest('[data-mood="thinking"]');
    if (effects && !(plain && expression !== "^_^")) {
      const words = plain ? "✓" : expression || (target.closest('[data-mood="thinking"]') ? "..." : ["^_^", ":)", ":D", "<3"][reactionIndex++ % 4]);
      const smile = spark("text", "agent-reaction", { x: 40, y: 23, "text-anchor": "middle" }, words); effects.append(smile);
      if (motion && !plain) {
        animate(smile, [{ opacity: 0, transform: "translate(-3px,14px) scale(.4)", easing: "cubic-bezier(.22,1,.36,1)" }, { opacity: 1, transform: "translate(0,0) scale(1.08)", offset: .2 }, { opacity: 1, transform: "translate(2px,-2px) scale(1)", offset: .72 }, { opacity: 0, transform: "translate(5px,-9px) scale(.9)" }], { duration: 1750, easing: "linear", fill: "both" });
        // Replace a burst on repeated taps, so particles never accumulate.
        for (const [i, [x, y]] of [[-25, -8], [-16, -25], [15, -23], [26, -7], [18, 14], [-19, 13]].entries()) {
          const particle = i % 3 === 0 ? spark("text", "agent-spark", { x: 40, y: 46, "text-anchor": "middle" }, "+") : spark("circle", "agent-spark", { cx: 40, cy: 44, r: 1.1 });
          effects.append(particle);
          animate(particle, [{ opacity: 0, transform: "translate(0,0) scale(.5)" }, { opacity: .85, transform: `translate(${x * .45}px,${y * .45}px) scale(1)`, offset: .25 }, { opacity: 0, transform: `translate(${x}px,${y - 5}px) scale(.2)` }], { duration: 1050 + i * 70, delay: i * 18, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" });
        }
      }
    }
    if (motion) animate(target, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-5px) scale(1.09)", offset: .35 }, { transform: "translateY(1px) scale(.98)", offset: .75 }, { transform: "translateY(0) scale(1)" }], { duration: 700, easing: "cubic-bezier(.22,1,.36,1)" });
    playback.timer = setTimeout(() => { if (plays.get(target) === playback) clearPlay(target); }, 1850);
  }
  function syncMood(celebrate = true) {
    const mood = chatThinking || data?.state?.state === "working" ? "thinking" : "idle";
    const target = hub.open ? el.avatar : host?.orb;
    const finished = target?.dataset.mood === "thinking" && mood === "idle";
    for (const item of [host?.orb, el.avatar]) {
      if (!item) continue;
      // A dozing orb sleeps on through quiet refreshes; work or a touch wakes it.
      const next = item === host?.orb && item.dataset.mood === "sleepy" && mood === "idle" ? "sleepy" : mood;
      if (item.dataset.mood !== next) clearPlay(item.querySelector("svg"));
      item.dataset.mood = next;
    }
    if (el.status && data) el.status.textContent = chatThinking ? "Thinking with you…" : data.state?.state === "working" ? "Agents are working · see What I'm doing" : data.status || "Ready when you are";
    if (finished && celebrate && data?.state?.state !== "needs-you") play(target?.querySelector("svg"), "^_^");
  }
  function thinking(active, { celebrate = true } = {}) {
    chatThinking = Boolean(active); syncMood(celebrate);
  }

  // Petting: stroke it back and forth a few times and it leans in, hearts
  // rise, and the bond remembers (one pet per few seconds, host-side).
  function pet(svg) {
    lastTouch = Date.now(); wake();
    play(svg, prefs.expressions ? pick(["<3", "~♡", "^w^", "♡"]) : null);
    window.mefiStudio?.companionBond?.("pet").then((result) => { if (result?.bond && el.bond) el.bond.textContent = result.bond; }).catch(() => {});
  }
  function pettable(control, svgOf) {
    let lastX = null, direction = 0, strokes = 0, strokeAt = 0;
    control.addEventListener("pointermove", (event) => {
      if (event.buttons) { lastX = null; return; }
      // A busy frame folds several moves into one event; a stroke is in them.
      const moves = event.getCoalescedEvents?.() || [];
      for (const move of moves.length ? moves : [event]) {
        if (lastX == null) { lastX = move.clientX; continue; }
        const delta = move.clientX - lastX;
        if (Math.abs(delta) < 4) continue;
        lastX = move.clientX;
        const now = performance.now();
        if (now - strokeAt > 700) strokes = 0;
        if (Math.sign(delta) !== direction) { direction = Math.sign(delta); strokes += 1; strokeAt = now; }
        if (strokes >= 4) { strokes = 0; pet(svgOf()); break; }
      }
    });
    control.addEventListener("pointerleave", () => { lastX = null; strokes = 0; });
  }
  // Idle play (Settings › Idle play): now and then, while nothing needs it
  // and the owner is not using it, the orb does something small on its own.
  // After a long quiet spell it dozes until touched.
  function wake() { if (host?.orb?.dataset.mood === "sleepy") { host.orb.dataset.mood = "idle"; syncMood(false); } }
  function scheduleAntic() {
    clearTimeout(anticTimer);
    anticTimer = setTimeout(() => {
      const orb = host?.orb, svg = orb?.querySelector(".agent-creature");
      const resting = !chatThinking && ["resting", undefined].includes(data?.state?.state);
      if (prefs.antics && svg && !still() && !document.hidden && !hub.open && orb.getClientRects().length && orb.dataset.mood !== "thinking") {
        if (resting && Date.now() - lastTouch > 10 * 60 * 1000) { orb.dataset.mood = "sleepy"; play(svg, "zzz"); }
        else {
          const sound = window.MefiIdle?.audioStatus?.();
          play(svg, sound?.listening ? "♪" : pick(["~", "o_o", "^^", "?", "✦"]));
        }
      }
      scheduleAntic();
    }, 35000 + Math.random() * 45000);
  }
  function character(label) {
    const control = button("", () => play(control.querySelector("svg")), "agent-play");
    pettable(control, () => control.querySelector("svg"));
    control.innerHTML = face(); control.setAttribute("aria-label", label); control.title = "Say hello · move your pointer to play";
    control.addEventListener("pointermove", (event) => {
      if (still()) return;
      const box = control.getBoundingClientRect();
      control.style.setProperty("--agent-look-x", `${Math.max(-3, Math.min(3, (event.clientX - box.left - box.width / 2) / 12))}px`);
      control.style.setProperty("--agent-look-y", `${Math.max(-2, Math.min(2, (event.clientY - box.top - box.height / 2) / 14))}px`);
    });
    control.addEventListener("pointerleave", () => { control.style.setProperty("--agent-look-x", "0px"); control.style.setProperty("--agent-look-y", "0px"); });
    return control;
  }
  function initIntro() {
    const mark = document.querySelector(".boot-mark");
    if (!mark || document.getElementById("boot-agent")) return;
    mark.removeAttribute("aria-hidden"); mark.classList.add("agent-box");
    const agent = character("Wake your companion and say hello"); agent.id = "boot-agent"; agent.dataset.mood = "sleepy";
    const ring = node("span", "boot-spinner"); ring.setAttribute("aria-hidden", "true");
    mark.replaceChildren(ring, agent);
    const caption = node("p", "agent-intro-caption", "A little light, waking up."); caption.id = "boot-agent-caption"; mark.after(caption);
    wakeTimer = setTimeout(() => { agent.dataset.mood = bootPhase === "loading" ? "thinking" : "happy"; caption.textContent = "Hello. Let's make something together."; play(agent.querySelector("svg"), "^_^"); }, still() ? 0 : 650);
  }
  function boot(phase) {
    initIntro();
    if (phase === bootPhase) return;
    const card = document.querySelector(".boot-card"), before = card?.getBoundingClientRect();
    const changing = Boolean(bootPhase && before?.height);
    bootPhase = phase;
    const agent = document.getElementById("boot-agent"), caption = document.getElementById("boot-agent-caption");
    if (!agent) return;
    if (["ready", "error", "loading", "choose"].includes(phase)) { clearTimeout(wakeTimer); agent.dataset.mood = phase === "loading" ? "thinking" : phase === "error" ? "idle" : "happy"; }
    if (caption && phase === "choose") { caption.textContent = "Hello. Let's make something together."; play(agent.querySelector("svg"), "^_^"); }
    if (caption && phase === "ready") { caption.textContent = "I'm here. Your studio is ready."; play(agent.querySelector("svg")); }
    if (caption && phase === "error") caption.textContent = "I'm here. We can try that again together.";
    if (changing && !still()) requestAnimationFrame(() => {
      const after = card.getBoundingClientRect();
      if (after.height && Math.abs(before.height - after.height) > 2) card.animate([{ height: `${before.height}px` }, { height: `${after.height}px` }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" });
    });
  }
  function handoff(rect) {
    if (!rect || still()) return;
    requestAnimationFrame(() => {
      const guide = document.getElementById("walkthrough-agent");
      const target = guide?.getClientRects().length ? guide : host?.orb;
      if (!target?.getClientRects().length) return;
      const end = target.getBoundingClientRect();
      const ghost = node("div", "agent-handoff"); ghost.innerHTML = face(); ghost.setAttribute("aria-hidden", "true");
      Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); document.body.append(ghost);
      const animation = ghost.animate([{ transform: "translate(0,0) scale(1)", opacity: .9 }, { transform: `translate(${end.left + end.width / 2 - rect.left - rect.width / 2}px,${end.top + end.height / 2 - rect.top - rect.height / 2}px) scale(${end.width / rect.width})`, opacity: 0 }], { duration: 620, easing: "cubic-bezier(.22,1,.36,1)" });
      animation.finished.catch(() => {}).finally(() => ghost.remove());
    });
  }
  function guide({ step, coach = false, done = false, busy = false } = {}) {
    const owner = document.getElementById(coach ? "walkthrough-coach" : "walkthrough-sheet");
    if (!owner) return;
    const before = owner.getBoundingClientRect();
    const changed = owner.dataset.agentStep !== String(step);
    owner.dataset.agentStep = String(step);
    let greeting = owner.querySelector(".agent-guide-greeting");
    if (!greeting) {
      greeting = node("div", "agent-guide-greeting");
      const agent = character("Play with your setup companion");
      if (coach) agent.id = "coach-agent"; else agent.id = "walkthrough-agent";
      const copy = node("p"); copy.setAttribute("aria-live", "polite"); greeting.append(agent, copy); owner.querySelector("header")?.after(greeting);
    }
    const messages = ["I'll find our connections. You decide what I can use.", "Show me our project. I'll walk with you.", "I'll explore the folder and bring you a map.", "Let's get our team connected.", "Tell me your idea. We'll take it one step at a time.", "Here's where you can watch us work.", "Let's check what we made together."];
    greeting.querySelector("p").textContent = busy ? "I'm on it. You can stay here with me." : done ? "We did it! Ready for our next step?" : messages[step] || "I'm here with you.";
    const guideAgent = greeting.querySelector("button"), finished = guideAgent.dataset.mood === "thinking" && !busy;
    guideAgent.dataset.mood = busy ? "thinking" : "happy";
    if (finished && done) play(guideAgent.querySelector("svg"), "^_^");
    if (coach && host && !host.panel.contains(document.activeElement)) host.toggle(false);
    if (changed && before.height && !still()) requestAnimationFrame(() => {
      const after = owner.getBoundingClientRect();
      if (after.height && Math.abs(before.height - after.height) > 2) owner.animate([{ height: `${before.height}px` }, { height: `${after.height}px` }], { duration: 400, easing: "cubic-bezier(.22,1,.36,1)" });
    });
  }

  // Six bubbles, one job each: talk, see what it is doing, answer what waits,
  // trade ideas for work, meet friends, and shape how it behaves.
  const items = [
    ["ask", "Talk", "g-help", "Chat, plan, or make a task"],
    ["now", "What I'm doing", "g-command", "Work in progress and what just happened"],
    ["requests", "Needs you", "g-tasks", "Decisions waiting for you"],
    ["ideas", "Suggest work", "g-ideas", "Give me an idea, or take one of mine"],
    ["friends", "Friends", "g-orbit", "Playdates, sharing, rooms and your PCs"],
    ["settings", "Personality", "g-ambience", "How I behave, and settings"],
  ];
  const FRIENDS_ROUTES = new Set(["friends", "rooms", "your-pcs", "playground"]);
  const FRIENDS_TARGETS = { rooms: "rooms-title", pcs: "pc-sync-title", playground: "friends-title" };
  function icon(glyph) { const span = node("span", "agent-hub-icon"); span.innerHTML = `<svg class="glyph" aria-hidden="true"><use href="#${glyph}"/></svg>`; return span; }
  function attach(value) {
    if (host) return;
    host = value;
    const layer = node("section", "agent-hub"); layer.id = "agent-hub"; layer.hidden = true; layer.tabIndex = -1;
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-labelledby", "agent-hub-title");
    const shell = node("div", "agent-hub-shell"), head = node("header", "agent-hub-head");
    const heading = node("div"); heading.append(node("span", "eyebrow", "YOUR STUDIO"));
    const title = node("h2", "", `A moment with ${name()}`); title.id = "agent-hub-title"; heading.append(title);
    const closeButton = button("", () => close(), "agent-hub-dismiss ghost"); closeButton.innerHTML = glyphSvg("g-close"); closeButton.setAttribute("aria-label", "Return to studio"); closeButton.title = "Return to studio (Esc)"; head.append(heading, closeButton);
    const layout = node("div", "agent-hub-layout"), stage = node("div", "agent-hub-stage");
    const orbit = node("div", "agent-hub-orbit"); orbit.setAttribute("aria-hidden", "true"); orbit.append(node("i"), node("i"), node("i")); stage.append(orbit);
    const center = button("", () => close(), "agent-hub-center");
    const avatar = node("span", "agent-hub-avatar"); avatar.innerHTML = face(); avatar.dataset.look = "wisp"; center.append(avatar, node("span", "", "Return to studio"));
    center.id = "agent-hub-return"; stage.append(center);
    for (const [index, [id, label, glyph, hint]] of items.entries()) {
      const control = button("", () => select(id), "agent-hub-node"); control.dataset.hubSection = id;
      control.setAttribute("aria-label", `${label} · ${hint}`); control.setAttribute("aria-expanded", "false"); control.setAttribute("aria-controls", "agent-hub-detail");
      control.style.setProperty("--hub-angle", `${index * 60 - 90}deg`); control.style.setProperty("--hub-delay", `${index * 28}ms`);
      const inner = node("span", "agent-hub-node-inner"); inner.append(icon(glyph), node("span", "", label)); control.append(inner); stage.append(control);
    }
    const detail = node("div", "agent-hub-detail"); detail.id = "agent-hub-detail"; detail.hidden = true;
    const back = button("", () => select(null), "ghost agent-hub-back"); back.innerHTML = `${glyphSvg("g-back")}<span class="label">All bubbles</span>`;
    const extra = node("div", "agent-hub-extra"); detail.append(back, extra); layout.append(stage, detail);
    const foot = node("footer", "agent-hub-foot");
    const status = node("span", "", "Your work keeps its current run settings."); status.id = "agent-hub-status";
    const bond = node("span", "agent-hub-bond"); bond.id = "agent-hub-bond";
    const audio = button("Audio link", () => navigate(() => window.MefiMusic?.openAudio?.()), "ghost mini"); audio.id = "agent-hub-audio";
    foot.append(status, bond, audio, node("kbd", "", "Esc")); shell.append(head, layout, foot); layer.append(shell); document.body.append(layer);
    Object.assign(el, { layer, shell, stage, center, avatar, title, detail, extra, back, status, audio, bond });
    // A pet in the hub or on the orb; any touch on the orb wakes a dozing one.
    pettable(center, () => avatar.querySelector("svg"));
    pettable(host.orb, () => host.orb.querySelector(".agent-creature"));
    host.orb.addEventListener("pointerenter", () => { lastTouch = Date.now(); wake(); });
    scheduleAntic();
    window.MefiPcSync?.subscribe?.(() => syncBadge());
    window.MefiRooms?.subscribe?.(() => syncBadge());
    syncBadge();
    layer.addEventListener("click", (event) => { if (event.target === layer) close(); });
    layer.addEventListener("keydown", trap);
    // The open section's box takes stray typing: Talk, Suggest work, and an
    // open room's message box under Friends. Other sections have none.
    window.MefiNav?.typeScope?.(layer, () => hub.section === "ask" ? host.panel.querySelector("#companion-pane-ask textarea") : hub.section === "ideas" ? extra.querySelector("#agent-hub-suggest-text") : hub.section === "friends" ? extra.querySelector(".rooms-compose") : null);
    // Capture while this modal owns the keyboard; nested selects/confirmations
    // get first refusal and retain their own focus restoration.
    window.addEventListener("keydown", (event) => {
      if (!hub.open || document.querySelector(".studio-choice-popup") || otherDialog() || event.target?.closest?.("#toast-host")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (hub.section) select(null); else close(); }
      // A letter lands in the open section's box (Talk, Suggest work) rather
      // than being dropped; either way Studio's shortcuts never see it.
      else if (!(event.key === "Tab" || event.key === "Enter" || event.key === " " || event.key.startsWith("Arrow") || event.target?.closest?.("input, textarea, select"))) { window.MefiNav?.typeInto?.(event); event.stopPropagation(); }
    }, true);
    window.addEventListener("mefi:nav", (event) => { if (hub.open && !FRIENDS_ROUTES.has(event.detail?.id)) close({ immediate: true, restore: false }); });
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => { el.layer.toggleAttribute("data-suspended", document.hidden); if (document.hidden) for (const creature of document.querySelectorAll(".agent-creature")) clearPlay(creature); cancelAnimationFrame(audioFrame); audioFrame = 0; if (!document.hidden && hub.open) audioFrame = requestAnimationFrame(audioTick); });
    window.addEventListener("mefi-audio-change", updateAudio);
    const stopMotion = () => {
      if (!still()) return;
      for (const creature of document.querySelectorAll(".agent-creature")) clearPlay(creature);
      for (const item of document.querySelectorAll(".agent-hub, .agent-play, .agent-handoff, .boot-card, .walkthrough-sheet, .walkthrough-coach")) for (const animation of item.getAnimations({ subtree: true })) animation.cancel();
      energy = 0; el.layer.style.setProperty("--hub-energy", "0");
      if (hub.closing) close({ immediate: true });
    };
    const motionObserver = new MutationObserver(stopMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    motionObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", stopMotion);
    initIntro();
  }
  function otherDialog() {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((item) => item !== el.layer && !el.layer?.contains(item) && !item.closest("[hidden]") && item.getClientRects().length);
  }
  function open(options = {}) {
    if (!host || window.MefiBoot?.isActive?.() || otherDialog()) return false;
    const section = typeof options === "string" ? options : options?.section;
    const target = typeof options === "object" ? options?.target : null;
    const requested = items.some(([id]) => id === section) ? section : null;
    if (hub.open) {
      if (hub.closing) { clearTimeout(hub.timer); hub.closing = false; el.layer.classList.remove("leaving"); }
      if (requested) { if (hub.section === requested) focusFriend(target); else select(requested, target); }
      return true;
    }
    host.toggle(false); window.MefiCompanionUI?.freeze(); window.MefiSelect?.close();
    lastTouch = Date.now(); wake();
    hub.returnFocus = document.activeElement; hub.open = true; hub.closing = false;
    el.layer.hidden = false; el.layer.classList.remove("leaving"); el.title.textContent = `A moment with ${name()}`;
    host.orb.setAttribute("aria-expanded", "true"); host.orb.setAttribute("aria-controls", "agent-hub");
    for (const child of document.body.children) {
      if (child === el.layer || ["SCRIPT", "STYLE"].includes(child.tagName) || ["studio-floats", "toast-host"].includes(child.id)) continue;
      hub.locked.set(child, child.inert); child.inert = true;
    }
    select(requested, target); update(data); updateAudio();
    const from = host.orb.getBoundingClientRect(), to = el.center.getBoundingClientRect();
    if (!still()) {
      el.avatar.animate([{ transform: `translate(${from.left + from.width / 2 - to.left - to.width / 2}px,${from.top + from.height / 2 - to.top - to.height / 2}px) scale(.3)`, opacity: .4 }, { transform: "translate(0,0) scale(1)", opacity: 1 }], { duration: 540, easing: "cubic-bezier(.22,1,.36,1)" });
    }
    play(el.avatar.querySelector("svg"));
    if (!requested) el.center.focus({ preventScroll: true });
    if (!document.hidden) audioFrame = requestAnimationFrame(audioTick);
    host.refresh?.();
    return true;
  }
  function close({ immediate = false, restore = true } = {}) {
    if (!hub.open) return;
    clearTimeout(hub.timer); hub.closing = true; el.layer.classList.add("leaving");
    const finish = () => {
      host.toggle(false); select(null); hub.open = false; hub.closing = false;
      el.layer.hidden = true; el.layer.classList.remove("leaving"); host.orb.setAttribute("aria-expanded", "false");
      for (const [child, inert] of hub.locked) child.inert = inert;
      hub.locked.clear(); cancelAnimationFrame(audioFrame); audioFrame = 0; energy = 0;
      if (restore) { const target = hub.returnFocus?.isConnected && !hub.returnFocus.closest?.("[hidden]") ? hub.returnFocus : host.orb; target?.focus?.({ preventScroll: true }); }
    };
    // .leaving fades the layer on --motion-slow (companion-hub.css); the lock
    // lifts once it has, and a hidden window that never paints still finishes.
    if (immediate || still()) finish(); else hub.timer = setTimeout(finish, tokenMs("--motion-slow", 280));
  }
  function navigate(action) { close({ immediate: true, restore: false }); action(); }
  function action(title, run) { return button(title, () => navigate(run), "ghost agent-hub-action"); }
  function focusFriend(target) {
    hub.friendTarget = Object.hasOwn(FRIENDS_TARGETS, target) ? target : null;
    const id = hub.friendTarget ? FRIENDS_TARGETS[hub.friendTarget] : null;
    if (!id || !hub.open || hub.section !== "friends") return;
    const heading = el.extra.querySelector(`#${id}`);
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true }); heading.scrollIntoView?.({ block: "start", behavior: "instant" });
  }
  function select(section, target = null) {
    const previous = hub.section; hub.section = section;
    hub.friendTarget = section === "friends" && Object.hasOwn(FRIENDS_TARGETS, target) ? target : null;
    if (host.panel.parentElement === el.detail) {
      host.toggle(false); document.body.append(host.panel); host.panel.inert = hub.locked.has(host.panel) ? true : false;
      host.panel.classList.remove("companion-in-hub"); host.panel.setAttribute("role", "dialog");
    }
    el.layer.dataset.section = section || "home"; el.detail.hidden = !section;
    for (const item of el.stage.querySelectorAll("[data-hub-section]")) item.setAttribute("aria-expanded", String(item.dataset.hubSection === section));
    // A section's panels let go of what they hold (Rooms' open room) first;
    // a copy, since a panel may leave the list as it lets go.
    for (const child of [...el.extra.children]) child.dispose?.();
    if (!section) { el.extra.replaceChildren(); if (previous && hub.open) el.stage.querySelector(`[data-hub-section="${previous}"]`)?.focus({ preventScroll: true }); return; }
    const titles = Object.fromEntries(items.map(([id, label]) => [id, label]));
    const title = node("h3", "", titles[section]); title.tabIndex = -1;
    const paint = () => {
      el.extra.replaceChildren(title);
      const panelTab = { ask: "ask", requests: "status", now: "now", settings: "settings" }[section];
      if (panelTab) {
        el.detail.append(host.panel); host.panel.inert = false; host.panel.classList.add("companion-in-hub"); host.panel.setAttribute("role", "region");
        host.toggle(true, { hub: true }); window.MefiCompanionUI?.showTab(panelTab);
        if (section === "settings") el.extra.append(action("Open app settings", () => window.MefiNav?.go("studio", { category: "general" })));
      } else if (section === "friends") {
        // Friends › Playground (renderer/companion-friends.js): friends'
        // companions, playdates and what yours may share, answered in place.
        const playground = window.MefiCompanionFriends?.card?.({ name: name(), face: (look) => lookFace(look) });
        if (playground) el.extra.append(playground);
        el.extra.append(action("Friends & listening rooms", () => { window.MefiMusic?.openAudio?.(); window.MefiMusic?.setSource?.("link"); window.MefiMusic?.openSection?.("more"); }),
          action("Connect with Discord", () => window.MefiNav?.go("community")));
        // Friends › Rooms (renderer/rooms.js) and Friends › Your PCs
        // (renderer/pc-sync.js) stay in the hub: they answer in place instead
        // of navigating away.
        const rooms = window.MefiRooms?.panel?.();
        if (rooms) el.extra.append(rooms);
        const pcs = window.MefiPcSync?.card?.();
        if (pcs) el.extra.append(pcs);
      } else {
        el.extra.append(...ideas());
      }
      // A target can sit below a delayed section transition. Focus only after
      // its actual card exists; the same cards own all Friends entry points.
      if (section === "friends") requestAnimationFrame(() => focusFriend(hub.friendTarget));
    };
    // The section arrives from the bubbles' side, or across from the last one,
    // which fades where it was (renderer/motion.js); without layout it just paints.
    if (window.MefiMotion?.swap) window.MefiMotion.swap(el.extra, paint, { dir: previous ? 0 : 1 }); else paint();
    // Talk and Suggest work open with the caret in their box: you came to type.
    const box = section === "ask" ? host.panel.querySelector("#companion-pane-ask textarea") : section === "ideas" ? el.extra.querySelector("#agent-hub-suggest-text") : null;
    (box && !box.disabled ? box : title).focus({ preventScroll: true }); resize();
  }
  // A companion face for a look: the wisp is this file's own light, the
  // others the menu foot's drawings (MefiCompanion.face).
  function lookFace(look) { return look === "wisp" || !window.MefiCompanion?.face ? face() : window.MefiCompanion.face(look); }

  // Suggest work: the owner's idea goes to the inbox as their own request
  // (the same add the inbox uses), and the companion offers its next picks
  // from the backlog, each one Work on it away. Nothing starts on its own.
  function ideas() {
    const api = window.mefiStudio;
    const projectId = () => window.MefiWorkspace?.activeProjectId?.() ?? null;
    const form = node("form", "agent-hub-suggest");
    const field = node("textarea"); field.rows = 3; field.maxLength = 4000; field.id = "agent-hub-suggest-text";
    field.placeholder = "An idea, a fix, something you'd like made…"; field.setAttribute("aria-label", "Suggest work for your companion");
    const send = node("button", "primary mini", "Suggest it"); send.type = "submit";
    const said = node("p", "ab-quiet"); said.setAttribute("role", "status");
    form.append(node("p", "muted", "Tell me what you'd like worked on. It goes to the inbox; I'll size it up before anything starts."), field, send, said);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = field.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true; said.textContent = "Adding it…";
      let result;
      try { result = await api?.eyesRequestsAction?.({ action: "add", projectId: projectId(), requests: [{ prompt: text, source: "manual" }] }); } catch (error) { result = { ok: false, error }; }
      send.disabled = false;
      if (result?.ok === false || !result) { said.textContent = plain(result?.error, "That could not be added. Try again."); return; }
      field.value = ""; said.textContent = "Added to the inbox. Thank you!";
      play(el.avatar.querySelector("svg"), "^_^");
    });
    const picks = node("section", "agent-hub-picks"); picks.setAttribute("aria-labelledby", "agent-hub-picks-title");
    const heading = node("h4", "", "My picks for next"); heading.id = "agent-hub-picks-title";
    const list = node("div", "agent-hub-pick-list"); list.append(node("p", "ab-quiet", "Looking at the board…"));
    picks.append(heading, list);
    Promise.resolve(api?.backlogStatus?.()).then((status) => {
      // Only work that can go next: not what is running, held, cooling or waiting.
      const next = (status?.next || []).filter((row) => row?.id && ["ready", "approval"].includes(row.stage)).slice(0, 4);
      list.replaceChildren();
      if (!next.length) list.append(node("p", "ab-quiet", status?.summary || "Nothing is waiting to be picked up."));
      for (const row of next) {
        const item = node("article", "companion-item");
        const go = node("button", "ghost mini", "Work on it"); go.type = "button";
        go.addEventListener("click", async () => {
          go.disabled = true;
          const result = await api?.assistantWorkOn?.({ kind: "task", id: row.id, label: String(row.title || "").slice(0, 80), projectId: projectId() }).catch((error) => ({ ok: false, error }));
          if (result?.ok === false) { window.MefiToast?.(plain(result.error, "That could not start."), "warn"); go.disabled = false; return; }
          go.textContent = "On it"; play(el.avatar.querySelector("svg"), "^_^");
        });
        item.append(node("strong", "", row.title || "Untitled task"), node("span", "ab-quiet", row.reason || ""), go);
        list.append(item);
      }
      resize();
    }).catch(() => { list.replaceChildren(node("p", "ab-quiet", "The board could not be read just now.")); });
    const askMore = action("Ask me for more ideas", () => { window.MefiCompanion?.open?.(); window.MefiCompanionUI?.showTab("ask"); const input = document.querySelector("#companion-pane-ask textarea"); if (input) { input.value = "What should we work on next? Give me a few ideas."; input.focus(); } });
    return [form, picks, askMore];
  }
  function resize() {
    if (!hub.open) return;
    if (host.panel.parentElement === el.detail) {
      const pane = host.panel.querySelector(".companion-menu-pane:not([hidden])");
      const desired = Math.min(510, Math.max(220, (pane?.scrollHeight || 160) + 115));
      host.panel.style.height = `${desired}px`;
      for (const key of ["width", "left", "top", "bottom", "maxHeight"]) host.panel.style[key] = "";
    }
  }
  // The Friends badge: room invites to answer and join requests to decide
  // (renderer/rooms.js), plus Your PCs (renderer/pc-sync.js): work only this
  // PC holds, commits waiting on GitHub, or a GitHub that could not be checked.
  function syncBadge() {
    const friends = el.stage?.querySelector('[data-hub-section="friends"]');
    if (!friends) return;
    const pcs = window.MefiPcSync?.badge?.() ?? 0;
    const rooms = window.MefiRooms?.pending?.() ?? 0;
    const count = pcs + rooms;
    let badge = friends.querySelector(".agent-hub-count");
    if (!badge) { badge = node("span", "agent-hub-count"); friends.append(badge); }
    badge.hidden = !count; badge.textContent = count > 9 ? "9+" : String(count);
    const hint = items.find(([id]) => id === "friends")[3];
    const parts = [rooms ? `${rooms} waiting in Rooms` : "", pcs ? `${pcs} to sync between your PCs` : ""].filter(Boolean);
    friends.setAttribute("aria-label", parts.length ? `Friends · ${parts.join(", ")}` : `Friends · ${hint}`);
  }
  function update(next) {
    if (next) data = next;
    if (data?.state) {
      prefs.personality = data.state.personality || "balanced";
      prefs.expressions = data.state.expressions !== false;
      prefs.antics = data.state.antics === true;
      if (!prefs.antics) wake();
      if (el.bond && data.state.bond) el.bond.textContent = data.state.bond;
    }
    if (!el.layer || !data) return;
    const count = data.state?.queue?.counts?.total ?? data.state?.queue?.items?.length ?? 0;
    const requests = el.stage.querySelector('[data-hub-section="requests"]');
    let badge = requests.querySelector(".agent-hub-count");
    if (!badge) { badge = node("span", "agent-hub-count"); requests.append(badge); }
    badge.hidden = !count; badge.textContent = count > 9 ? "9+" : String(count);
    requests.setAttribute("aria-label", `Requests · ${count} waiting for you`);
    syncBadge();
    const svg = host.orb.querySelector(".companion-face")?.innerHTML, look = host.orb.dataset.look || "wisp";
    if (svg && el.avatar.dataset.look !== look) { el.avatar.innerHTML = svg; el.avatar.querySelector(".agent-reactions")?.replaceChildren(); el.avatar.dataset.look = look; }
    syncMood();
    resize();
  }
  function updateAudio() {
    if (!el.audio) return;
    const status = window.MefiIdle?.audioStatus?.();
    el.audio.textContent = status?.listening ? "♫ Audio linked" : "♫ Audio link";
  }
  function audioTick(now) {
    audioFrame = 0;
    if (!hub.open || document.hidden) return;
    if (now - audioAt > 32) {
      audioAt = now;
      const sound = window.MefiIdle?.audioStatus?.();
      const active = !still() && sound?.reactive && sound?.listening && sound?.phase === "listening" && sound?.effects?.nodes !== false;
      const response = Number.isFinite(sound?.response) ? Math.max(0, Math.min(2, sound.response)) : 0;
      const raw = active ? (Number(sound.energy) || 0) * response : 0;
      const target = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
      energy = still() ? 0 : energy + (target - energy) * .22;
      el.layer.style.setProperty("--hub-energy", energy.toFixed(3));
    }
    audioFrame = requestAnimationFrame(audioTick);
  }
  function trap(event) {
    if (event.key !== "Tab" || document.querySelector(".studio-choice-popup") || otherDialog()) return;
    const controls = [...el.layer.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]'), ...document.querySelectorAll("#toast-host .show button")].filter((item) => item.tabIndex !== -1 && item.getClientRects().length && !item.closest("[hidden]"));
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement);
    if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus(); }
    event.stopPropagation();
  }
  window.MefiCompanionHub = { attach, face, play, thinking, boot, handoff, guide, open, close, update, resize, back: () => select(null), isOpen: () => hub.open, contains: (target) => Boolean(hub.open && el.layer?.contains(target)) };
})();
