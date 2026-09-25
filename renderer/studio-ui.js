// Shared Studio controls: scrollbar-free overflow, accessible select menus and
// appearance presets. Sources stay native controls so existing form bindings
// and change events keep one owner. No host calls are made by this module.
(function () {
  "use strict";
  const regions = new Map();
  const selects = new Map();
  let floats, serial = 0, frame = 0, popup = null, observer;
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const quiet = () => ["off", "calm"].includes(document.documentElement.dataset.motion) || document.body.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const visible = (el) => el.isConnected && !el.closest("[hidden], [inert]") && el.getClientRects().length > 0;
  const labelOf = (el) => el.getAttribute("aria-label") || (el.id && [...(el.labels || [])].find((label) => label.htmlFor === el.id)?.textContent?.trim()) || labelTitle(el.closest("label")) || el.title || "Options";
  // Checked in priority order: one combined selector would return the wrapper span (title plus its help text) before the <b> title inside it.
  const labelTitle = (label) => [".field-label", ".grow", "b, strong", ":scope > span"].map((selector) => label?.querySelector(selector)?.textContent?.trim()).find(Boolean);
  function layer() {
    if (!floats) { floats = node("div", "studio-floats"); floats.id = "studio-floats"; document.body.append(floats); }
    return floats;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  }
  // DOM churn (a live feed, the Command HUD flipping classes every frame)
  // refreshes at most a few times a second: each refresh measures every
  // scroll region. Input, resize and navigation still refresh next frame.
  let soon = 0;
  function scheduleSoon() {
    if (!soon && !frame) soon = setTimeout(() => { soon = 0; schedule(); }, 150);
  }
  function track(el) {
    if (!el || regions.has(el) || el.closest?.(".studio-scroll-hint")) return;
    const css = getComputedStyle(el);
    if (el !== document.scrollingElement && !/(auto|scroll)/.test(`${css.overflowX} ${css.overflowY}`)) return;
    const hint = node("div", "studio-scroll-hint");
    const region = { el, hint, buttons: {}, addedTab: false, stop: null };
    for (const [direction, glyph] of [["up", "↑"], ["down", "↓"], ["left", "←"], ["right", "→"]]) {
      const button = node("button", `studio-scroll-arrow scroll-${direction}`, glyph);
      button.type = "button"; button.setAttribute("aria-label", `Scroll ${direction}`);
      button.dataset.direction = direction;
      let timer, animation, held = false, last = 0;
      const move = (distance, smooth = false) => {
        const horizontal = direction === "left" || direction === "right";
        el.scrollBy({ [horizontal ? "left" : "top"]: distance * (["up", "left"].includes(direction) ? -1 : 1), behavior: smooth && !quiet() ? "smooth" : "instant" });
        schedule();
      };
      const stop = () => { clearTimeout(timer); cancelAnimationFrame(animation); timer = null; animation = null; last = 0; delete button.dataset.holding; };
      const previousStop = region.stop;
      region.stop = () => { previousStop?.(); stop(); };
      const tick = (now) => {
        if (!visible(el) || button.hidden || document.hidden) { stop(); return; }
        move(Math.min(50, now - (last || now)) * .48); last = now;
        animation = requestAnimationFrame(tick);
      };
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        button.dataset.holding = "true";
        held = false; button.setPointerCapture?.(event.pointerId);
        timer = setTimeout(() => { held = true; animation = requestAnimationFrame(tick); }, 280);
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) button.addEventListener(event, stop);
      button.addEventListener("click", () => { if (!held) move((direction === "left" || direction === "right" ? el.clientWidth : el.clientHeight) * .85, true); held = false; });
      hint.append(button); region.buttons[direction] = button;
    }
    hint.addEventListener("pointerenter", () => hint.classList.add("engaged"));
    hint.addEventListener("pointerleave", () => hint.classList.remove("engaged"));
    layer().append(hint); regions.set(el, region); resize?.observe(el);
    schedule();
  }
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  function placeArrow(button, direction, left, top, width, height) {
    if (button.dataset.holding) return;
    const horizontal = direction === "left" || direction === "right";
    const fixed = horizontal ? direction === "left" ? 3 : width - 33 : direction === "up" ? 3 : height - 29;
    const candidates = [.5, .18, .82].map((at) => horizontal ? [fixed, (height - 26) * at] : [(width - 30) * at, fixed]);
    // A panel's existing padding is available when a full-width action sits
    // on its edge. These controls never reserve space or cover that action.
    candidates.push(...(horizontal ? [[fixed, -28], [fixed, height + 2]] : [[-32, fixed], [width + 2, fixed]]));
    const clear = ([x, y]) => {
      if (left + x < 2 || top + y < 2 || left + x + 30 > innerWidth - 2 || top + y + 26 > innerHeight - 2) return false;
      return [[2, 2], [28, 2], [2, 24], [28, 24], [15, 13]].every(([dx, dy]) => {
        const hit = document.elementsFromPoint(left + x + dx, top + y + dy).find((el) => !el.closest("#studio-floats"));
        return hit && !hit.closest("button, a, input, textarea, select, summary, [role=button], [role=tab], [contenteditable=true]");
      });
    };
    const point = candidates.find(clear);
    if (point) Object.assign(button.style, { left: `${point[0]}px`, top: `${point[1]}px`, right: "auto", bottom: "auto" });
  }
  function refresh() {
    for (const [el, region] of regions) {
      if (!el.isConnected) { region.stop(); region.hint.remove(); resize?.unobserve(el); regions.delete(el); continue; }
      const { hint, buttons } = region;
      if (!visible(el)) { hint.hidden = true; region.stop(); continue; }
      const root = el === document.scrollingElement;
      const style = getComputedStyle(el);
      if (root && getComputedStyle(document.body).overflowY === "hidden" || !root && !/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) { hint.hidden = true; region.stop(); continue; }
      const height = root ? innerHeight : el.clientHeight, width = root ? innerWidth : el.clientWidth;
      const x = el.scrollWidth - width > 2, y = el.scrollHeight - height > 2;
      hint.hidden = !x && !y;
      if (hint.hidden) { region.stop(); if (region.addedTab) { el.removeAttribute("tabindex"); region.addedTab = false; } continue; }
      const bounds = root ? { left: 0, top: 0 } : el.getBoundingClientRect();
      let left = Math.max(0, bounds.left + (el.clientLeft || 0)), top = Math.max(0, bounds.top + (el.clientTop || 0));
      let right = Math.min(innerWidth, bounds.left + width), bottom = Math.min(innerHeight, bounds.top + height);
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflow)) continue;
        const clip = parent.getBoundingClientRect(); left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
      }
      if (right - left < 35 || bottom - top < 35) { hint.hidden = true; region.stop(); continue; }
      Object.assign(hint.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      hint.dataset.scrollOwner = el.id || el.className || el.tagName;
      const directions = { up: y && el.scrollTop > 1, down: y && el.scrollTop + height < el.scrollHeight - 2, left: x && el.scrollLeft > 1, right: x && el.scrollLeft + width < el.scrollWidth - 2 };
      for (const [direction, can] of Object.entries(directions)) { buttons[direction].hidden = !can; hint.classList.toggle(`can-${direction}`, can); }
      hint.classList.toggle("active", el.matches(":hover, :focus-within") || hint.contains(document.activeElement));
      if (hint.classList.contains("active") || hint.classList.contains("engaged")) for (const [direction, button] of Object.entries(buttons)) if (!button.hidden) placeArrow(button, direction, left, top, right - left, bottom - top);
      if (el.tabIndex < 0 && !el.hasAttribute("tabindex") && !el.matches("input, textarea, select, html, body")) { el.tabIndex = 0; region.addedTab = true; }
    }
    for (const [select, control] of selects) {
      if (!select.isConnected) { control.remove(); selects.delete(select); continue; }
      syncSelect(select, control);
    }
    positionPopup();
  }
  function scan(root = document, later = false) {
    if (root.nodeType === 1) { track(root); if (root.matches("select")) enhanceSelect(root); }
    for (const el of root.querySelectorAll?.("*") || []) {
      if (el.closest("#studio-floats, script, style, svg")) continue;
      track(el);
      if (el.tagName === "SELECT") enhanceSelect(el);
    }
    if (later) scheduleSoon(); else schedule();
  }
  function syncSelect(select, button) {
    const title = Array.from(select.selectedOptions || []).map((option) => option.textContent).join(", ") || "Choose…";
    if (button.firstChild.textContent !== title) button.firstChild.textContent = title;
    if (button.disabled !== select.disabled) button.disabled = select.disabled;
    button.hidden = select.hidden || select.classList.contains("segmented-source");
    const label = labelOf(select);
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    button.title = select.title || "";
  }
  function closeSelect(focus = false) {
    if (!popup) return;
    const current = popup; popup = null;
    current.button.setAttribute("aria-expanded", "false"); current.button.removeAttribute("aria-activedescendant");
    current.root.remove();
    if (focus && visible(current.button)) current.button.focus({ preventScroll: true });
    schedule();
  }
  function positionPopup() {
    if (!popup) return;
    if (!visible(popup.button) || popup.select.disabled) { closeSelect(); return; }
    const box = popup.button.getBoundingClientRect();
    // Wide form fields need not turn a handful of choices into long bars.
    const width = Math.min(popup.columns > 1 ? popup.columns * 132 + 16 : Math.max(240, Math.min(360, box.width)), innerWidth - 24);
    const maxHeight = Math.min(380, innerHeight - 24);
    popup.root.style.width = `${width}px`; popup.root.style.maxHeight = `${maxHeight}px`;
    const height = popup.root.getBoundingClientRect().height;
    const top = box.bottom + 6 + height <= innerHeight - 12 ? box.bottom + 6 : Math.max(12, box.top - height - 6);
    popup.root.style.left = `${Math.max(12, Math.min(box.left, innerWidth - width - 12))}px`;
    popup.root.style.top = `${top}px`;
  }
  function choose(option) {
    if (!popup || option.disabled || option.parentElement?.disabled) return;
    const select = popup.select;
    if (select.multiple) option.selected = !option.selected; else select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    closeSelect(true); schedule();
  }
  function drawOptions(query = "") {
    if (!popup) return;
    const current = popup;
    current.list.replaceChildren(); current.options = [];
    let group = null, host = current.list;
    for (const option of Array.from(current.select.options)) {
      if (option.hidden || option.parentElement?.hidden || query && !option.textContent.toLowerCase().includes(query.toLowerCase())) continue;
      const parent = option.parentElement?.tagName === "OPTGROUP" ? option.parentElement : null;
      if (parent !== group) {
        group = parent; host = current.list;
        if (group) {
          host = node("div", "studio-choice-group"); host.setAttribute("role", "group"); host.setAttribute("aria-label", group.label);
          const heading = node("div", "studio-choice-heading", group.label); heading.setAttribute("aria-hidden", "true");
          host.append(heading); current.list.append(host);
        }
      }
      const row = node("button", "studio-choice-option");
      row.append(node("span", "studio-choice-label", option.textContent));
      row.type = "button"; row.id = `studio-option-${++serial}`; row.tabIndex = -1;
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(option.selected));
      row.disabled = option.disabled || option.parentElement?.disabled === true;
      row.addEventListener("click", () => choose(option));
      host.append(row); current.options.push({ option, row });
    }
    const selected = current.options.findIndex(({ option, row }) => option.selected && !row.disabled);
    current.index = selected >= 0 ? selected : current.options.findIndex(({ row }) => !row.disabled);
    current.count.textContent = `${current.options.length} ${current.options.length === 1 ? "option" : "options"}`;
    if (!current.options.length) current.list.append(node("p", "studio-choice-empty muted", "No matching options"));
    positionPopup(); highlight(); track(current.list); schedule();
  }
  function highlight() {
    if (!popup) return;
    popup.options.forEach(({ row }, index) => row.classList.toggle("highlighted", index === popup.index));
    const row = popup.options[popup.index]?.row;
    for (const control of [popup.button, popup.root.querySelector("input")]) {
      if (row) control?.setAttribute("aria-activedescendant", row.id); else control?.removeAttribute("aria-activedescendant");
    }
    row?.scrollIntoView({ block: "nearest" });
  }
  function selectKeys(event) {
    if (!popup) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSelect(true); return; }
    if (event.key === "Tab") { closeSelect(); return; }
    const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || horizontal && popup.columns > 1 && event.target.tagName !== "INPUT") {
      event.preventDefault(); event.stopPropagation();
      const available = popup.options.map(({ row }, index) => ({ row, index })).filter(({ row }) => !row.disabled);
      const backwards = ["ArrowUp", "ArrowLeft", "End"].includes(event.key);
      let next;
      if (event.key === "Home" || event.key === "End" || popup.index < 0) next = backwards ? available.at(-1) : available[0];
      else if (popup.columns > 1) {
        // Geometry handles group headings, wrapped labels and partial rows.
        const box = popup.options[popup.index].row.getBoundingClientRect();
        const center = (r, x) => x ? r.left + r.width / 2 : r.top + r.height / 2;
        next = available.map((item) => {
          const rect = item.row.getBoundingClientRect();
          return { ...item, along: (center(rect, horizontal) - center(box, horizontal)) * (backwards ? -1 : 1), across: Math.abs(center(rect, !horizontal) - center(box, !horizontal)) };
        }).filter((item) => item.along > 2 && (!horizontal || item.across < box.height / 2))
          .sort((a, b) => a.along - b.along || a.across - b.across)[0];
      } else next = backwards ? available.findLast(({ index }) => index < popup.index) : available.find(({ index }) => index > popup.index);
      if (next) popup.index = next.index;
      highlight();
    } else if (event.key === "Enter" || event.key === " " && event.target.tagName !== "INPUT") {
      event.preventDefault(); event.stopPropagation(); if (popup.options[popup.index]) choose(popup.options[popup.index].option);
    }
  }
  function openSelect(select, button) {
    if (select.disabled) return;
    if (popup?.select === select) { closeSelect(true); return; }
    closeSelect();
    const root = node("div", "studio-choice-popup"), list = node("div", "studio-choice-list");
    list.id = `${button.id}-list`; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", labelOf(select));
    root.dataset.selectOwner = select.id;
    const options = Array.from(select.options).filter((option) => !option.hidden && !option.parentElement?.hidden);
    const longest = Math.max(0, ...options.map((option) => option.textContent.trim().length));
    const columns = options.length >= 4 && options.length <= 24 && longest <= 32 ? options.length >= 6 && longest <= 16 ? 3 : 2 : 1;
    root.dataset.layout = columns > 1 ? "tiles" : "list";
    root.style.setProperty("--choice-columns", String(columns));
    const heading = node("div", "studio-choice-header"), count = node("span", "studio-choice-count");
    heading.append(node("strong", "studio-choice-title", labelOf(select)), count); root.append(heading);
    popup = { root, list, select, button, count, columns, index: 0, options: [] };
    if (options.length > 8 && columns === 1) {
      const search = node("input", "studio-choice-search"); search.type = "search"; search.placeholder = "Find an option…"; search.setAttribute("aria-label", "Find an option");
      search.setAttribute("role", "combobox"); search.setAttribute("aria-autocomplete", "list"); search.setAttribute("aria-controls", list.id); search.setAttribute("aria-expanded", "true");
      search.addEventListener("input", () => drawOptions(search.value)); root.append(search);
    }
    root.append(list); layer().append(root); root.addEventListener("keydown", selectKeys);
    button.setAttribute("aria-controls", list.id); button.setAttribute("aria-expanded", "true");
    drawOptions(); root.querySelector("input")?.focus({ preventScroll: true });
  }
  function enhanceSelect(select) {
    if (selects.has(select) || select.hidden || select.classList.contains("segmented-source") || select.getAttribute("aria-hidden") === "true") return;
    if (!select.id) select.id = `studio-select-${++serial}`;
    const button = node("button", "studio-select"); button.type = "button"; button.id = `${select.id}-choice`;
    button.setAttribute("role", "combobox"); button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false");
    button.append(node("span", "studio-select-value"), node("span", "studio-select-chevron", "⌄"));
    select.classList.add("studio-select-source"); select.tabIndex = -1; select.setAttribute("aria-hidden", "true");
    select.after(button); selects.set(select, button); syncSelect(select, button);
    button.addEventListener("click", () => openSelect(select, button));
    button.addEventListener("keydown", (event) => {
      if (popup?.select === select) { selectKeys(event); return; }
      if (["ArrowDown", "ArrowUp", " ", "Enter"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openSelect(select, button); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        const option = Array.from(select.options).find((item) => !item.disabled && !item.hidden && !item.parentElement?.disabled && !item.parentElement?.hidden && item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
        if (option) { event.preventDefault(); select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); schedule(); }
      }
    });
    select.addEventListener("change", schedule);
    select.addEventListener("focus", () => button.focus());
  }
  const appearanceKey = "mefiStudio.appearance";
  let appearance;
  try { appearance = JSON.parse(localStorage.getItem(appearanceKey) || "null"); } catch {}
  appearance = { preset: "studio", density: "comfortable", glass: 45, glow: 35, ...(appearance || {}) };
  const presets = { focus: { glass: 0, glow: 0, density: "compact" }, studio: { glass: 45, glow: 35, density: "comfortable" }, atmosphere: { glass: 85, glow: 80, density: "comfortable" } };
  function applyAppearance(patch = {}, save = true) {
    appearance = { ...appearance, ...(patch.preset ? presets[patch.preset] : {}), ...patch };
    if (!presets[appearance.preset]) appearance.preset = "studio";
    const root = document.documentElement;
    root.dataset.studioStyle = appearance.preset; root.dataset.density = appearance.density === "compact" ? "compact" : "comfortable";
    root.style.setProperty("--studio-glass", String(Math.max(0, Math.min(100, Number(appearance.glass) || 0)) / 100));
    root.style.setProperty("--studio-glow", String(Math.max(0, Math.min(100, Number(appearance.glow) || 0)) / 100));
    if (save) { try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch {} }
    for (const button of document.querySelectorAll(".studio-style-choice[data-studio-style]")) button.setAttribute("aria-pressed", String(button.dataset.studioStyle === appearance.preset));
    window.dispatchEvent(new CustomEvent("mefi:appearance", { detail: { ...appearance } })); schedule();
  }
  function mountAppearance() {
    const parent = document.getElementById("settings-appearance-controls");
    if (!parent || document.getElementById("studio-style-controls")) return;
    const card = node("section", "studio-style-controls"); card.id = "studio-style-controls";
    card.append(node("h3", "", "Studio styling"), node("p", "muted", "Choose a feel, then fine-tune it."));
    const choices = node("div", "studio-style-choices");
    for (const [key, label, description] of [["focus", "Focus", "Quiet tint, precise edges"], ["studio", "Studio", "Soft glass, balanced depth"], ["atmosphere", "Atmosphere", "Open glass, richer colour"]]) {
      const button = node("button", "studio-style-choice"); button.type = "button"; button.dataset.studioStyle = key;
      const preview = node("span", "studio-style-preview"); preview.setAttribute("aria-hidden", "true");
      preview.append(node("i"), node("i"), node("i"));
      button.append(preview, node("strong", "", label), node("small", "", description));
      button.addEventListener("click", () => { applyAppearance({ preset: key, ...presets[key] }); sync(); }); choices.append(button);
    }
    card.append(choices);
    const density = node("select"); density.id = "studio-density";
    for (const key of ["comfortable", "compact"]) { const option = node("option", "", key === "compact" ? "Compact" : "Comfortable"); option.value = key; density.append(option); }
    const fields = {};
    for (const [key, title] of [["density", "Density"], ["glass", "Glass intensity"], ["glow", "Glow intensity"]]) {
      const row = node("label", "studio-field"), control = key === "density" ? density : node("input");
      if (key !== "density") { control.type = "range"; control.min = "0"; control.max = "100"; }
      control.setAttribute("aria-label", title); row.append(node("span", "", title), control); card.append(row); fields[key] = control;
      control.addEventListener("input", () => applyAppearance({ [key]: key === "density" ? control.value : Number(control.value) }));
    }
    const sync = () => { for (const [key, field] of Object.entries(fields)) field.value = appearance[key]; schedule(); };
    sync(); parent.prepend(card); applyAppearance({}, false); scan(card);
  }
  // ---- menus: one highlight that glides ------------------------------------
  // Inside a menu, the rail or the top row, one soft highlight slides to the
  // row under the pointer (or the keyboard's focus) on the spring curve,
  // instead of each row lighting up on its own. It is the host's ::after
  // (studio-ui.css "menus in motion"), placed through --glide-* properties, so
  // no element is ever added to a menu that code or tests count.
  const GLIDE_HOSTS = "#app-help-menu, .agents-nav-subsections, #idle-hud .pop, .surface-tools-menu, .studio-more-links, .studio-choice-list, .workspace .ws-project-actions > div, #app-local-nav, #app-rail";
  const GLIDE_ITEMS = "button, a[href], [role=menuitem], [role=option], .studio-choice-option";
  let glideHost = null, glideItem = null, glideFrame = 0;
  function glideRest() {
    if (glideHost) glideHost.dataset.glide = "off";
    glideHost = null; glideItem = null;
  }
  function glidePlace(host, item, jump) {
    const hostBox = host.getBoundingClientRect(), box = item.getBoundingClientRect();
    if (!box.width || !box.height) { glideRest(); return; }
    const style = host.style;
    style.setProperty("--glide-x", `${box.left - hostBox.left - host.clientLeft + host.scrollLeft}px`);
    style.setProperty("--glide-y", `${box.top - hostBox.top - host.clientTop + host.scrollTop}px`);
    style.setProperty("--glide-w", `${box.width}px`);
    style.setProperty("--glide-h", `${box.height}px`);
    style.setProperty("--glide-r", getComputedStyle(item).borderRadius || "");
    host.dataset.glide = jump ? "jump" : "on";
  }
  function glideTo(item) {
    const host = item?.closest?.(GLIDE_HOSTS);
    if (!host || item.disabled || item.getAttribute("aria-disabled") === "true") { glideRest(); return; }
    if (host === glideHost && item === glideItem) return;
    if (host !== glideHost) {
      glideRest();
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      glideHost = host; glideItem = item;
      // The first row is reached without travel; from there it glides.
      glidePlace(host, item, true);
      cancelAnimationFrame(glideFrame);
      glideFrame = requestAnimationFrame(() => { if (glideHost === host && host.dataset.glide === "jump") host.dataset.glide = "on"; });
      return;
    }
    glideItem = item;
    glidePlace(host, item, false);
  }
  function glideFollow() { if (glideHost && glideItem?.isConnected) glidePlace(glideHost, glideItem, false); }
  function init() {
    layer(); applyAppearance({}, false); scan(); mountAppearance();
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("pointerover", schedule, { passive: true });
    document.addEventListener("pointerout", schedule, { passive: true });
    document.addEventListener("focusin", schedule);
    document.addEventListener("change", schedule);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && popup) { event.preventDefault(); event.stopImmediatePropagation(); closeSelect(true); } }, true);
    document.addEventListener("pointerdown", (event) => { if (popup && !popup.root.contains(event.target) && !popup.button.contains(event.target)) closeSelect(); }, true);
    document.addEventListener("focusin", (event) => { if (popup && !popup.root.contains(event.target) && !popup.button.contains(event.target)) closeSelect(); });
    window.addEventListener("resize", schedule);
    window.addEventListener("blur", () => { for (const region of regions.values()) region.stop(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { closeSelect(); for (const region of regions.values()) region.stop(); } else schedule(); });
    observer = new MutationObserver((records) => {
      // A menu that closes takes its highlight with it, so it never
      // reopens with the last row still lit.
      if (glideHost && records.some((record) => record.attributeName === "hidden" && (record.target === glideHost || record.target.contains?.(glideHost)))) glideRest();
      let changed = false;
      for (const record of records) {
        if (record.target.closest?.("#studio-floats, .studio-select")) continue;
        changed = true;
        for (const added of record.addedNodes) if (added.nodeType === 1 && !added.closest("#studio-floats")) scan(added, true);
      }
      if (changed) scheduleSoon();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "disabled", "open", "class", "selected"] });
    window.addEventListener("mefi:nav", () => { closeSelect(); schedule(); });
    document.addEventListener("pointerover", (event) => {
      if (event.pointerType === "touch") return;
      const item = event.target.closest?.(GLIDE_ITEMS);
      if (item?.closest(GLIDE_HOSTS)) { glideTo(item); return; }
      // Between rows it stays where it is; outside its menu it rests.
      if (glideHost && !glideHost.contains(event.target)) glideRest();
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", glideRest);
    document.addEventListener("focusin", (event) => {
      const item = event.target.closest?.(GLIDE_ITEMS);
      if (item?.closest(GLIDE_HOSTS) && item.matches(":focus-visible")) glideTo(item);
    });
    document.addEventListener("scroll", glideFollow, { capture: true, passive: true });
    // The rail widens as it opens: the highlight follows its row there.
    document.addEventListener("transitionend", (event) => { if (event.target === glideHost && event.propertyName === "width") glideFollow(); });
    window.addEventListener("mefi:nav", glideRest);
  }
  window.MefiScroll = { attach: track, scan, refresh: schedule, owns: (parent, target) => [...regions.values()].some(({ el, hint }) => parent?.contains(el) && hint.contains(target)) };
  window.MefiSelect = { enhance: enhanceSelect, refresh: schedule, close: closeSelect, owns: (parent) => Boolean(popup && parent?.contains(popup.select)), contains: (target) => Boolean(popup?.root.contains(target)), near: (parent, x, y) => { if (!popup || !parent?.contains(popup.select)) return false; const box = popup.root.getBoundingClientRect(); return x >= box.left - 16 && x <= box.right + 16 && y >= box.top - 16 && y <= box.bottom + 16; } };
  window.MefiAppearance = { get: () => ({ ...appearance }), apply: applyAppearance, mount: mountAppearance };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
