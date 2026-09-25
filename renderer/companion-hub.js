// One companion from wake-up to the studio menu. This layer only presents
// existing actions; setup, queue changes and friend connections retain their gates.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, cls = "ghost") => { const el = node("button", cls, text); el.type = "button"; el.addEventListener("click", run); return el; };
  const still = () => window.MefiNav?.noMotion?.() || ["off", "calm"].includes(document.documentElement.dataset.motion) || document.body.classList.contains("ws-still") || document.body.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const name = () => { try { return localStorage.getItem("mefiStudio.workspace.companion")?.trim() || "Mefi"; } catch { return "Mefi"; } };
  const hub = { open: false, closing: false, section: null, locked: new Map(), returnFocus: null, timer: 0 };
  const el = {};
  let host, data, bootPhase, audioFrame = 0, audioAt = 0, energy = 0, wakeTimer = 0, reactionIndex = 0, chatThinking = false;
  const plays = new WeakMap();
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
    if (effects) {
      const words = expression || (target.closest('[data-mood="thinking"]') ? "..." : ["^_^", ":)", ":D", "<3"][reactionIndex++ % 4]);
      const smile = spark("text", "agent-reaction", { x: 40, y: 23, "text-anchor": "middle" }, words); effects.append(smile);
      if (motion) {
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
    for (const item of [host?.orb, el.avatar]) if (item) { if (item.dataset.mood !== mood) clearPlay(item.querySelector("svg")); item.dataset.mood = mood; }
    if (el.status && data) el.status.textContent = chatThinking ? "Thinking with you…" : data.state?.state === "working" ? "Agents are working · run controls in Quick actions" : data.status || "Ready when you are";
    if (finished && celebrate && data?.state?.state !== "needs-you") play(target?.querySelector("svg"), "^_^");
  }
  function thinking(active, { celebrate = true } = {}) {
    chatThinking = Boolean(active); syncMood(celebrate);
  }
  function character(label) {
    const control = button("", () => play(control.querySelector("svg")), "agent-play");
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

  const items = [
    ["ask", "Talk to me", "g-help", "Ask, plan, or make a task"],
    ["friends", "Friends", "g-orbit", "Connect and listen together"],
    ["requests", "Requests", "g-tasks", "Decisions waiting for you"],
    ["notices", "Notifications", "g-ideas", "What happened in your studio"],
    ["settings", "Settings", "g-ambience", "Make this space yours"],
    ["quick", "Quick actions", "g-command", "Setup, team, and audio"],
  ];
  function icon(glyph) { const span = node("span", "agent-hub-icon"); span.innerHTML = `<svg class="glyph" aria-hidden="true"><use href="#${glyph}"/></svg>`; return span; }
  function attach(value) {
    if (host) return;
    host = value;
    const layer = node("section", "agent-hub"); layer.id = "agent-hub"; layer.hidden = true; layer.tabIndex = -1;
    layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true"); layer.setAttribute("aria-labelledby", "agent-hub-title");
    const shell = node("div", "agent-hub-shell"), head = node("header", "agent-hub-head");
    const heading = node("div"); heading.append(node("span", "eyebrow", "YOUR STUDIO"));
    const title = node("h2", "", `A moment with ${name()}`); title.id = "agent-hub-title"; heading.append(title);
    const closeButton = button("×", () => close(), "agent-hub-dismiss ghost"); closeButton.setAttribute("aria-label", "Return to studio"); head.append(heading, closeButton);
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
    const back = button("‹ All bubbles", () => select(null), "ghost agent-hub-back");
    const extra = node("div", "agent-hub-extra"); detail.append(back, extra); layout.append(stage, detail);
    const foot = node("footer", "agent-hub-foot");
    const status = node("span", "", "Your work keeps its current run settings."); status.id = "agent-hub-status";
    const audio = button("Audio link", () => navigate(() => window.MefiMusic?.openAudio?.()), "ghost mini"); audio.id = "agent-hub-audio";
    foot.append(status, audio, node("kbd", "", "Esc")); shell.append(head, layout, foot); layer.append(shell); document.body.append(layer);
    Object.assign(el, { layer, shell, stage, center, avatar, title, detail, extra, back, status, audio });
    layer.addEventListener("click", (event) => { if (event.target === layer) close(); });
    layer.addEventListener("keydown", trap);
    // Capture while this modal owns the keyboard; nested selects/confirmations
    // get first refusal and retain their own focus restoration.
    window.addEventListener("keydown", (event) => {
      if (!hub.open || document.querySelector(".studio-choice-popup") || otherDialog() || event.target?.closest?.("#toast-host")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (hub.section) select(null); else close(); }
      else if (!(event.key === "Tab" || event.key === "Enter" || event.key === " " || event.key.startsWith("Arrow") || event.target?.closest?.("input, textarea, select"))) event.stopPropagation();
    }, true);
    window.addEventListener("mefi:nav", () => { if (hub.open) close({ immediate: true, restore: false }); });
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
  function open() {
    if (!host || window.MefiBoot?.isActive?.() || otherDialog()) return false;
    if (hub.open) { if (hub.closing) { clearTimeout(hub.timer); hub.closing = false; el.layer.classList.remove("leaving"); } return true; }
    host.toggle(false); window.MefiCompanionUI?.freeze(); window.MefiSelect?.close();
    hub.returnFocus = document.activeElement; hub.open = true; hub.closing = false;
    el.layer.hidden = false; el.layer.classList.remove("leaving"); el.title.textContent = `A moment with ${name()}`;
    host.orb.setAttribute("aria-expanded", "true"); host.orb.setAttribute("aria-controls", "agent-hub");
    for (const child of document.body.children) {
      if (child === el.layer || ["SCRIPT", "STYLE"].includes(child.tagName) || ["studio-floats", "toast-host"].includes(child.id)) continue;
      hub.locked.set(child, child.inert); child.inert = true;
    }
    select(null); update(data); updateAudio();
    const from = host.orb.getBoundingClientRect(), to = el.center.getBoundingClientRect();
    if (!still()) {
      el.avatar.animate([{ transform: `translate(${from.left + from.width / 2 - to.left - to.width / 2}px,${from.top + from.height / 2 - to.top - to.height / 2}px) scale(.3)`, opacity: .4 }, { transform: "translate(0,0) scale(1)", opacity: 1 }], { duration: 540, easing: "cubic-bezier(.22,1,.36,1)" });
    }
    play(el.avatar.querySelector("svg"));
    el.center.focus({ preventScroll: true });
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
    if (immediate || still()) finish(); else hub.timer = setTimeout(finish, 280);
  }
  function navigate(action) { close({ immediate: true, restore: false }); action(); }
  function action(title, run) { return button(title, () => navigate(run), "ghost agent-hub-action"); }
  function select(section) {
    const previous = hub.section; hub.section = section;
    if (host.panel.parentElement === el.detail) {
      host.toggle(false); document.body.append(host.panel); host.panel.inert = hub.locked.has(host.panel) ? true : false;
      host.panel.classList.remove("companion-in-hub"); host.panel.setAttribute("role", "dialog");
    }
    el.layer.dataset.section = section || "home"; el.detail.hidden = !section; el.extra.replaceChildren();
    for (const item of el.stage.querySelectorAll("[data-hub-section]")) item.setAttribute("aria-expanded", String(item.dataset.hubSection === section));
    if (!section) { if (previous && hub.open) el.stage.querySelector(`[data-hub-section="${previous}"]`)?.focus({ preventScroll: true }); return; }
    const titles = Object.fromEntries(items.map(([id, label]) => [id, label]));
    const title = node("h3", "", titles[section]); title.tabIndex = -1; el.extra.append(title);
    const panelTab = { ask: "ask", requests: "status", notices: "activity", settings: "settings" }[section];
    if (panelTab) {
      el.detail.append(host.panel); host.panel.inert = false; host.panel.classList.add("companion-in-hub"); host.panel.setAttribute("role", "region");
      host.toggle(true, { hub: true }); window.MefiCompanionUI?.showTab(panelTab);
      if (section === "settings") el.extra.append(action("Open app settings", () => window.MefiNav?.go("studio", { category: "general" })));
    } else if (section === "friends") {
      el.extra.append(node("p", "muted", "Make a little room for your friends. Link your community account, then join a room to listen together."),
        action("Connect with Discord", () => window.MefiNav?.go("community")),
        action("Friends & listening rooms", () => { window.MefiMusic?.openAudio?.(); window.MefiMusic?.setSource?.("link"); window.MefiMusic?.togetherHost?.()?.scrollIntoView({ block: "nearest" }); }),
        node("p", "ab-quiet", "Choose Connect or Join in the room controls when you're ready."));
    } else {
      el.extra.append(node("p", "muted", "A few useful things, close at hand."),
        action("Walk me through setup", () => window.MefiOnboarding?.open?.()),
        action("Team & connections", () => window.MefiNav?.go("agents", { section: "setup", pane: "team" })),
        action("Audio & music", () => window.MefiMusic?.openAudio?.()),
        action("Appearance", () => window.MefiNav?.go("studio", { category: "appearance" })),
        action("Run & pause controls", () => { window.MefiCompanion?.open?.(); window.MefiCompanionUI?.showTab("settings"); }));
    }
    title.focus({ preventScroll: true }); resize();
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
  function update(next) {
    if (next) data = next;
    if (!el.layer || !data) return;
    const count = data.state?.queue?.counts?.total ?? data.state?.queue?.items?.length ?? 0;
    const requests = el.stage.querySelector('[data-hub-section="requests"]');
    let badge = requests.querySelector(".agent-hub-count");
    if (!badge) { badge = node("span", "agent-hub-count"); requests.append(badge); }
    badge.hidden = !count; badge.textContent = count > 9 ? "9+" : String(count);
    requests.setAttribute("aria-label", `Requests · ${count} waiting for you`);
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
