// A persistent home for the Links player. Its iframe/video is never
// recreated: floating, the surface only changes geometry; docked in the
// media menu, the whole surface is carried into the menu's stage with a
// state-preserving move (moveBefore), so it scrolls and animates with the
// menu natively instead of being chased there frame by frame.
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.mediaWindow.v1";
  const GAP = 16;
  const TOOLBAR_HEIGHT = 44; // 36px controls and the gap above playback.
  const NARROW = 420; // the whole bar (title, transport, volume, window buttons) needs about this much.
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const distance = (point, box) => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height));
  // Only a state-preserving move may carry a live player: append or
  // insertBefore would unload its iframe and restart playback.
  const canCarry = (host) => typeof host?.moveBefore === "function";

  function create({ content, onClose, onSettings, settingsHost, onPlacement, transport }) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    let pinned = saved?.pinned === true;
    let avoid = saved?.avoid === true;
    let background = saved?.background === true;
    let transparency = clamp(finite(saved?.transparency, 0), 0, 90);
    let treeTransparency = clamp(finite(saved?.treeTransparency, 0), 0, 90);
    let videoBrightness = clamp(finite(saved?.videoBrightness, 100), 25, 150);
    let fadeOnDone = saved?.fadeOnDone !== false, faded = false;
    let trackDark = saved?.trackDark === true, sceneTimer = null, sceneBusy = false;
    let darkCandidate = -1, darkStreak = 0, darkCurrent = 4, darkMovedAt = 0;
    let knownTasks = null, projectId = null, taskRevision = 0;
    // dockHost: the menu's stage while the menu shows this player. dockClip:
    // the part of a docked website outside the menu's scroller (a native view
    // is not clipped by the page). aside: the open menu's rect, which a
    // floating player steps clear of without saving the move.
    let box = null, dockHost = null, dockClip = null, dockDetached = false, aside = null, placementStamp = "", shape = "video", minimized = false, gesture = null;
    let visible = false, hovered = false, yielded = false, awaySince = 0, lastDistance = Infinity, graceUntil = 0;
    let size = {};
    for (const key of ["video", "tall", "compact", "audio", "browser"]) {
      const value = saved?.size?.[key];
      if (value && typeof value === "object") size[key] = { width: finite(value.width, undefined), height: finite(value.height, undefined) };
    }
    const now = () => window.performance.now();
    const root = document.createElement("section");
    if (settingsHost) settingsHost.hidden = true;
    root.id = "media-window"; root.className = "media-window"; root.hidden = true;
    root.setAttribute("role", "region"); root.setAttribute("aria-label", "Media player");
    const controls = document.createElement("div"); controls.className = "media-window-controls";
    const button = (id, label, title, action) => {
      const node = document.createElement("button");
      node.type = "button"; node.id = `media-window-${id}`; node.textContent = label;
      node.title = title; node.setAttribute("aria-label", title);
      if (action) node.addEventListener("click", action);
      controls.append(node); return node;
    };
    const move = button("move", "⠿ Media", "Move media · drag or use arrow keys (Shift for fine steps)");
    move.className = "media-window-move";
    const pin = button("pin", "Pin", "Pin media in place", () => { pinned = !pinned; root.dataset.dodging = "false"; paintToggles(); persist(); });
    const dodge = button("avoid", "Move aside", "Move aside near the pointer in menus", () => { avoid = !avoid; yielded = false; paintToggles(); persist(); });
    const minimize = button("minimize", "−", "Minimize media", () => setMinimized(!minimized));
    // Only the owner's own minimize moves focus; code that un-minimizes on the way to something else leaves it alone.
    function setMinimized(value, { focus = true } = {}) {
      minimized = Boolean(value); root.dataset.minimized = String(minimized);
      minimize.textContent = minimized ? "↗" : "−";
      minimize.title = minimized ? "Restore media" : "Minimize media";
      minimize.setAttribute("aria-label", minimize.title); minimize.setAttribute("aria-pressed", String(minimized));
      root.setAttribute("aria-label", minimized ? "Media player minimized" : "Media player");
      layout(); if (focus) focusPlayer();
    }
    const close = button("close", "", "Close media and stop playback", () => { hide(); onClose(); });
    close.innerHTML = '<svg class="glyph" aria-hidden="true" focusable="false"><use href="#g-close"/></svg>';
    const backgroundButton = button("background", "Background", "Use video as Studio background", () => {
      end(); background = !background;
      if (minimized) setMinimized(false, { focus: false });
      paintVideo(); layout(); persist();
    });
    const opacityLabel = document.createElement("label"); opacityLabel.className = "media-window-transparency";
    const opacityText = document.createElement("span");
    const opacityInput = document.createElement("input");
    opacityInput.id = "media-window-transparency"; opacityInput.type = "range";
    opacityInput.min = "0"; opacityInput.max = "90"; opacityInput.step = "5";
    opacityInput.setAttribute("aria-label", "Video transparency");
    opacityInput.addEventListener("input", () => { transparency = clamp(Number(opacityInput.value) || 0, 0, 90); faded = false; paintVideo(); persist(); });
    opacityLabel.append(opacityText, opacityInput); controls.append(opacityLabel);
    const treeOpacityLabel = document.createElement("label"); treeOpacityLabel.className = "media-window-transparency";
    const treeOpacityText = document.createElement("span");
    const treeOpacityInput = document.createElement("input");
    treeOpacityInput.id = "media-window-tree-transparency"; treeOpacityInput.type = "range";
    treeOpacityInput.min = "0"; treeOpacityInput.max = "90"; treeOpacityInput.step = "5";
    treeOpacityInput.setAttribute("aria-label", "Tree transparency");
    treeOpacityInput.addEventListener("input", () => { treeTransparency = clamp(Number(treeOpacityInput.value) || 0, 0, 90); paintVideo(); persist(); });
    treeOpacityLabel.append(treeOpacityText, treeOpacityInput);
    const brightnessLabel = document.createElement("label"); brightnessLabel.className = "media-window-transparency";
    const brightnessText = document.createElement("span");
    const brightnessInput = document.createElement("input");
    brightnessInput.id = "media-window-brightness"; brightnessInput.type = "range";
    brightnessInput.min = "25"; brightnessInput.max = "150"; brightnessInput.step = "5";
    brightnessInput.setAttribute("aria-label", "Video brightness");
    brightnessInput.addEventListener("input", () => { videoBrightness = clamp(Number(brightnessInput.value) || 100, 25, 150); faded = false; paintVideo(); persist(); });
    brightnessLabel.append(brightnessText, brightnessInput);
    const fadeButton = button("fade", "Fade on finish", "Fade video and notify when a task finishes", () => {
      fadeOnDone = !fadeOnDone;
      if (!fadeOnDone) faded = false;
      paintVideo(); persist();
    });
    const restoreButton = button("restore", "Restore video", "Restore video after task completion", () => { faded = false; paintVideo(); });
    const darkButton = button("dark", "Keep tree in dark areas", "Slowly move the tree toward a consistently darker part of the background video", () => {
      if (window.MefiTreeDynamics) {
        const dynamics = window.MefiTreeDynamics;
        const enabled = dynamics.videoEnabled() && dynamics.preferences().videoTarget === "dark";
        dynamics.update({ mode: enabled ? (dynamics.musicEnabled() ? "music" : "steady") : (dynamics.musicEnabled() ? "hybrid" : "video"), videoTarget: "dark" });
        return;
      }
      trackDark = !trackDark; darkCandidate = -1; darkStreak = 0; darkCurrent = 4; darkMovedAt = 0;
      window.MefiIdle?.setMediaFocus?.(null); paintVideo(); persist();
    });
    const caption = document.createElement("button");
    caption.type = "button"; caption.className = "media-window-caption";
    caption.id = "media-window-settings"; caption.title = "Music & video controls";
    caption.innerHTML = '<svg class="glyph" aria-hidden="true" focusable="false"><use href="#g-sliders"/></svg>';
    caption.setAttribute("aria-label", caption.title);
    caption.addEventListener("click", onSettings);
    const toolbar = document.createElement("div"); toolbar.className = "media-window-toolbar";
    toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "Media window controls");
    // The player's own transport (music.js paints it) rides between the
    // title and the window buttons, so a floating video is playable as is.
    toolbar.append(move, ...(transport ? [transport] : []), caption, minimize, close);
    let toolbarInSettings = false;
    controls.append(backgroundButton, opacityLabel, treeOpacityLabel, brightnessLabel, darkButton, fadeButton, restoreButton, pin, dodge);
    window.MefiTreeDynamics?.mountVisibility?.(controls, "media");
    root.append(toolbar, content);
    (settingsHost || root).append(controls);
    const edges = [];
    for (const edge of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
      const grip = document.createElement("button");
      grip.type = "button"; grip.className = "media-window-resize"; grip.dataset.edge = edge;
      grip.id = `media-window-resize-${edge}`;
      grip.tabIndex = edge === "se" ? 0 : -1;
      grip.setAttribute("aria-label", "Resize media · drag or use arrow keys (Shift for fine steps)");
      grip.title = "Resize media";
      grip.addEventListener("pointerdown", (event) => start(event, edge));
      grip.addEventListener("keydown", (event) => keyboard(event, edge));
      root.append(grip); edges.push(grip);
    }
    document.body.append(root);

    function bounds() {
      // The shell knows what chrome there is: the rail and the local navigation
      // and, in layout v2, the list, the tab strip, the inspector and the status
      // bar. In v1 that is the very measurement below.
      const area = window.MefiNav?.usable?.();
      if (area) {
        const left = clamp(area.left, 0, Math.max(0, window.innerWidth - 320));
        return { left: left + GAP, top: Math.max(GAP, area.top + GAP), right: area.right - GAP, bottom: area.bottom - GAP };
      }
      // Keep the menu and local navigation reachable even at the 600px app minimum.
      const rail = document.getElementById("app-rail")?.getBoundingClientRect();
      const nav = document.getElementById("app-local-nav")?.getBoundingClientRect();
      const left = rail?.width > 0 ? clamp(rail.right, 0, Math.max(0, window.innerWidth - 320)) : 0;
      return { left: left + GAP, top: Math.max(GAP, (nav?.height > 0 ? nav.bottom : 0) + GAP), right: window.innerWidth - GAP, bottom: window.innerHeight - GAP };
    }
    function limits() {
      const area = bounds();
      const maxWidth = Math.max(1, area.right - area.left), maxHeight = Math.max(1, area.bottom - area.top);
      const minContentHeight = shape === "browser" ? 300 : shape === "tall" ? 240 : shape === "audio" ? 104 : 216;
      return { area, maxWidth, maxHeight, minWidth: Math.min(464, maxWidth), minHeight: Math.min(minContentHeight + (shape === "browser" ? 0 : TOOLBAR_HEIGHT), maxHeight) };
    }
    function fit(candidate) {
      const { area, maxWidth, maxHeight, minWidth, minHeight } = limits();
      const width = clamp(finite(candidate.width, 600), minWidth, maxWidth);
      const height = clamp(finite(candidate.height, 248), minHeight, maxHeight);
      return { width, height, x: clamp(finite(candidate.x, area.right - width), area.left, area.right - width), y: clamp(finite(candidate.y, area.bottom - height), area.top, area.bottom - height) };
    }
    // A floating player under the open menu steps to the nearest clear side
    // of it; the saved place is untouched, so it returns when the menu closes.
    function stepAside(current) {
      if (!aside) return current;
      if (current.x >= aside.right || current.x + current.width <= aside.left || current.y >= aside.bottom || current.y + current.height <= aside.top) return current;
      const area = bounds(), gap = 12;
      const options = [
        { ...current, x: aside.left - gap - current.width }, { ...current, y: aside.bottom + gap },
        { ...current, x: aside.right + gap }, { ...current, y: aside.top - gap - current.height },
      ].filter((option) => option.x >= area.left && option.y >= area.top && option.x + option.width <= area.right && option.y + option.height <= area.bottom);
      options.sort((a, b) => Math.hypot(a.x - current.x, a.y - current.y) - Math.hypot(b.x - current.x, b.y - current.y));
      return options[0] || current;
    }
    function visibleBox() {
      if (minimized) return stepAside({ ...box, width: Math.min(box.width, 304), height: 60 });
      if (background && shape !== "browser") { const area = bounds(); return { x: area.left, y: area.top, width: area.right - area.left, height: area.bottom - area.top }; }
      return stepAside(box);
    }
    const parentOf = () => root.parentElement ?? root.parentNode;
    function carry(host) {
      if (parentOf() === host) return true;
      try { host.moveBefore(root, null); return true; } catch { return false; }
    }
    function layout() {
      if (!box) return;
      box = fit(box);
      // Docked, the menu's stage sizes the player and the menu's own scroll
      // moves it; a backdrop or a minimized pill always lives on the page.
      let inMenu = Boolean(dockHost && visible && !minimized && !(background && shape !== "browser"));
      if (inMenu && !carry(dockHost)) { dockHost = null; inMenu = false; }
      if (!inMenu && parentOf() !== document.body) carry(document.body);
      // Docking and undocking are jumps. The glide is for a floating player stepping aside; laid on a change
      // of frame (the stage's `inset: 0` against a place on the page) it flew the player in from the page's
      // corner whenever the menu closed after a step aside.
      if ((root.dataset.docked === "true") !== inMenu) root.dataset.dodging = "false";
      root.dataset.docked = String(inMenu);
      let narrow = false;
      if (inMenu) {
        Object.assign(root.style, { left: "", top: "", width: "", height: "" });
        root.style.clipPath = dockClip ? `inset(${dockClip.join("px ")}px)` : "none";
      } else {
        const current = visibleBox();
        root.style.clipPath = "none";
        Object.assign(root.style, { left: `${current.x}px`, top: `${current.y}px`, width: `${current.width}px`, height: `${current.height}px` });
        // Too narrow for the whole bar (a small window with the rail open): the
        // volume stays with the menu, so the transport and the window's own
        // buttons, Close among them, never run off the edge.
        narrow = !minimized && current.width < NARROW;
      }
      root.dataset.narrow = String(narrow);
      for (const grip of edges) grip.hidden = inMenu || minimized || background && shape !== "browser";
      paintVideo();
    }
    function persist() {
      if (!box) return;
      const area = bounds();
      saved = { pinned, avoid, background, transparency, treeTransparency, videoBrightness, fadeOnDone, trackDark, size, x: (box.x - area.left) / Math.max(1, area.right - area.left - box.width), y: (box.y - area.top) / Math.max(1, area.bottom - area.top - box.height) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    }
    function paintToggles() {
      pin.setAttribute("aria-pressed", String(pinned)); dodge.setAttribute("aria-pressed", String(avoid));
      pin.title = pinned ? "Unpin media to allow Move aside" : "Pin media in place";
      pin.setAttribute("aria-label", pin.title);
      dodge.title = pinned ? "Move aside is paused while pinned" : "Move aside near the pointer in menus";
    }
    function paintVideo() {
      if (settingsHost) settingsHost.hidden = !visible;
      const browsing = shape === "browser";
      const backdrop = visible && background && !minimized && !browsing;
      // Keep window controls beside the player. Only background playback puts
      // its toolbar in settings, because the workspace must stay clickable.
      if (backdrop !== toolbarInSettings) {
        toolbarInSettings = backdrop;
        if (backdrop) controls.prepend(toolbar);
        else root.insertBefore(toolbar, content);
      }
      // In the menu, the menu's own card is the toolbar.
      toolbar.hidden = browsing && !minimized || root.dataset.docked === "true";
      caption.hidden = minimized;
      const backdropChanged = document.body.dataset.mediaBackground !== String(backdrop);
      root.dataset.background = String(backdrop);
      document.body.dataset.mediaVisible = String(visible && !minimized);
      document.body.dataset.mediaBackground = String(backdrop);
      document.body.style.setProperty("--media-tree-opacity", String(1 - treeTransparency / 100));
      document.body.dataset.mediaView = window.MefiNav?.top?.() || window.MefiNav?.current?.() || "";
      if (backdropChanged && typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi:media-background"));
      content.style.opacity = String(browsing ? 1 : faded ? 0.08 : (1 - transparency / 100));
      content.style.filter = browsing ? "none" : `brightness(${videoBrightness / 100})`;
      backgroundButton.setAttribute("aria-pressed", String(background));
      backgroundButton.textContent = background ? "Float video" : "Background";
      fadeButton.setAttribute("aria-pressed", String(fadeOnDone));
      const dynamics = window.MefiTreeDynamics;
      dynamics?.setVideoAvailable(backdrop && !faded);
      const tracking = dynamics ? Boolean(dynamics.sampleRequest()) : trackDark;
      darkButton.setAttribute("aria-pressed", String(dynamics ? dynamics.videoEnabled() && dynamics.preferences().videoTarget === "dark" : trackDark));
      restoreButton.hidden = !faded;
      opacityInput.value = String(transparency);
      opacityText.textContent = `Video transparency · ${transparency}%`;
      treeOpacityInput.value = String(treeTransparency);
      treeOpacityText.textContent = `Tree transparency · ${treeTransparency}%`;
      brightnessInput.value = String(videoBrightness);
      brightnessText.textContent = `Video brightness · ${videoBrightness}%`;
      move.disabled = backdrop; pin.disabled = backdrop || browsing; dodge.disabled = backdrop || browsing;
      for (const control of [backgroundButton, opacityInput, brightnessInput, fadeButton, darkButton]) control.disabled = browsing;
      // A backdrop must never take keyboard focus or intercept workspace clicks.
      content.inert = backdrop || minimized;
      const placement = { background: backdrop, minimized, docked: root.dataset.docked === "true", visible };
      const nextStamp = JSON.stringify(placement);
      if (nextStamp !== placementStamp) { placementStamp = nextStamp; onPlacement?.(placement); }
      if (backdrop && tracking && window.mefiStudio?.mediaSceneSample && !sceneTimer) sceneTimer = window.setInterval(sampleDarkArea, 5000);
      if ((!backdrop || !tracking) && sceneTimer) { window.clearInterval(sceneTimer); sceneTimer = null; }
      if (dynamics || !backdrop || !trackDark) {
        darkCandidate = -1; darkStreak = 0; darkCurrent = 4; darkMovedAt = 0;
        window.MefiIdle?.setMediaFocus?.(null);
      }
    }
    async function sampleDarkArea() {
      const dynamics = window.MefiTreeDynamics, request = dynamics?.sampleRequest();
      if (sceneBusy || !visible || !background || minimized || !(dynamics ? request : trackDark) || faded || document.hidden) return;
      const area = window.MefiIdle?.mediaSceneArea?.();
      if (!area) return;
      sceneBusy = true;
      try {
        const result = await window.mefiStudio.mediaSceneSample({ ...area, ...(request || {}) });
        if (!visible || !background || minimized || faded || !(dynamics ? dynamics.sampleRequest() : trackDark) || !window.MefiIdle?.mediaSceneArea?.()) return;
        const scores = result?.scores;
        if (!result?.ok || !Array.isArray(scores) || scores.length !== 9 || !scores.every(Number.isFinite)) return;
        if (dynamics) { dynamics.acceptSample(scores, request.revision); return; }
        const best = scores.indexOf(Math.min(...scores));
        // Broad overlapping regions, sustained improvement, then a long dwell:
        // scene cuts and a passing shadow cannot send the tree chasing the video.
        if (best === darkCurrent || scores[darkCurrent] - scores[best] < 0.04) { darkStreak = 0; return; }
        darkStreak = best === darkCandidate ? darkStreak + 1 : 1; darkCandidate = best;
        if (darkStreak < 3 || Date.now() - darkMovedAt < 30000) return;
        if (window.MefiIdle.setMediaFocus({ x: (best % 3) / 2, y: Math.floor(best / 3) / 2 })) {
          darkCurrent = best; darkMovedAt = Date.now(); darkStreak = 0;
        }
      } catch {} finally { sceneBusy = false; }
    }
    function noticeTasks(tasks) {
      if (!Array.isArray(tasks)) return;
      taskRevision++;
      const next = new Map();
      const completed = [];
      for (const task of tasks) {
        if (!task?.id || projectId && task.projectId && task.projectId !== projectId) continue;
        const key = `${task.projectId || projectId || ""}:${task.id}`;
        const previous = knownTasks?.get(key);
        next.set(key, task.status);
        if (previous && !["done", "archived", "absorbed"].includes(previous) && task.status === "done" && !task.dropped) completed.push(task);
      }
      knownTasks = next;
      if (!visible || shape === "browser" || !fadeOnDone || !completed.length) return;
      faded = true; paintVideo();
      const task = completed[0];
      window.MefiToast?.(completed.length === 1 ? `Task finished: ${task.title || "Untitled task"}` : `${completed.length} tasks finished`, "good", {
        duration: 15000,
        action: { label: "View result", run: () => window.MefiNav?.go?.("tasks", { taskId: task.id, projectId: task.projectId || projectId }) },
        secondary: { label: "Restore video", run: () => { faded = false; paintVideo(); } },
      });
    }
    function seedTasks() {
      const revision = taskRevision;
      Promise.resolve(window.mefiStudio?.tasksList?.()).then((result) => {
        if (revision !== taskRevision || !result?.ok || !Array.isArray(result.tasks)) return;
        projectId = result.projectId || projectId; noticeTasks(result.tasks);
      }).catch(() => {});
    }
    function show(link) {
      window.MefiTreeDynamics?.setVideoAvailable(false);
      root.dataset.dodging = "false";
      const nextShape = link.shape || "video";
      if (!box || nextShape !== shape) {
        shape = nextShape;
        const defaults = shape === "browser" ? { width: 760, height: 520 } : shape === "tall" ? { width: 540, height: 368 } : shape === "compact" ? { width: 540, height: 216 } : shape === "audio" ? { width: 540, height: 104 } : { width: 600, height: 264 };
        if (shape !== "browser") defaults.height += TOOLBAR_HEIGHT;
        const preferred = size[shape];
        box = fit({ ...defaults, width: finite(preferred?.width, defaults.width), height: finite(preferred?.height, defaults.height), x: box?.x, y: box?.y });
        const area = bounds();
        box.x = area.left + clamp(finite(saved?.x, 1), 0, 1) * Math.max(0, area.right - area.left - box.width);
        box.y = area.top + clamp(finite(saved?.y, 1), 0, 1) * Math.max(0, area.bottom - area.top - box.height);
      }
      move.textContent = `⠿ ${link.label || "Media"}`;
      content.dataset.shape = shape; root.dataset.shape = shape;
      visible = true; root.hidden = false; layout();
      graceUntil = now() + 1600;
    }
    function hide() {
      if (minimized) setMinimized(false, { focus: false });
      end(); visible = false; root.hidden = true; hovered = false; yielded = false; awaySince = 0; faded = false; paintVideo();
    }
    function reveal() {
      if (minimized) setMinimized(false, { focus: false });
      graceUntil = now() + 1600;
      focusPlayer();
    }
    function focusPlayer() {
      const target = minimized ? minimize : background && shape !== "browser" ? backgroundButton
        : shape === "browser" ? content.querySelector?.("#browser-move") || move : move;
      target.focus({ preventScroll: true });
    }
    function start(event, edge = "move") {
      if (event.button !== 0 || gesture || !visible || background && !minimized && shape !== "browser") return;
      if (root.dataset.docked === "true") detach();
      event.preventDefault(); event.stopPropagation();
      gesture = { edge, x: event.clientX, y: event.clientY, box: { ...box }, target: event.currentTarget, pointerId: event.pointerId };
      root.dataset.dodging = "false";
      root.dataset.interacting = "true";
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      graceUntil = now() + 1600;
    }
    function detach() {
      // A drag begins where the user grabbed the docked player, rather than
      // jumping back to the last floating position under the same pointer.
      const drawn = root.getBoundingClientRect?.();
      if (!minimized && drawn?.width > 0 && drawn?.height > 0) {
        box = fit({ x: drawn.left, y: drawn.top, width: drawn.width, height: drawn.height });
        size = { ...size, [shape]: { width: box.width, height: box.height } };
      }
      dockHost = null; dockClip = null; dockDetached = true;
      layout();
    }
    function changed(dx, dy, edge, origin) {
      const { area, minWidth, minHeight } = limits();
      if (edge === "move") return fit({ ...origin, x: origin.x + dx, y: origin.y + dy });
      let left = origin.x, top = origin.y, right = origin.x + origin.width, bottom = origin.y + origin.height;
      if (edge.includes("w")) left = clamp(left + dx, area.left, right - minWidth);
      if (edge.includes("e")) right = clamp(right + dx, left + minWidth, area.right);
      if (edge.includes("n")) top = clamp(top + dy, area.top, bottom - minHeight);
      if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, area.bottom);
      return fit({ x: left, y: top, width: right - left, height: bottom - top });
    }
    function end(event) {
      if (!gesture || event && event.pointerId !== gesture.pointerId) return;
      const previous = gesture; gesture = null;
      root.dataset.interacting = "false";
      try { previous.target.releasePointerCapture?.(previous.pointerId); } catch {}
      if (previous.edge !== "move") size = { ...size, [shape]: { width: box.width, height: box.height } };
      // A deliberate move is where the player lives now, even beside the menu.
      aside = null;
      persist(); graceUntil = now() + 1600;
    }
    function keyboard(event, edge) {
      const vectors = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!vectors[event.key] || !box || background && !minimized && shape !== "browser") return;
      if (root.dataset.docked === "true") detach();
      event.preventDefault(); event.stopPropagation();
      root.dataset.dodging = "false"; aside = null;
      const step = event.shiftKey ? 2 : 16;
      box = changed(vectors[event.key][0] * step, vectors[event.key][1] * step, edge, box);
      if (edge !== "move") size = { ...size, [shape]: { width: box.width, height: box.height } };
      layout(); persist();
    }
    function deepMenu() {
      const route = window.MefiNav?.top?.() || window.MefiNav?.current?.();
      return route && !["command", "workspace"].includes(route) || document.getElementById("music-dropdown")?.hidden === false || Boolean(document.querySelector(".surface-tools[open], .studio-more[open], .cmd-more-tools[open]"));
    }
    function pointer(event) {
      if (gesture) {
        if (event.pointerId !== gesture.pointerId) return;
        box = changed(event.clientX - gesture.x, event.clientY - gesture.y, gesture.edge, gesture.box);
        layout(); return;
      }
      if (!visible || minimized || root.dataset.docked === "true" || background || shape === "browser" || event.buttons || event.pointerType && event.pointerType !== "mouse") return;
      const point = { x: event.clientX, y: event.clientY }, gap = distance(point, box), time = now();
      const approaching = gap < lastDistance; lastDistance = gap;
      // After one dodge, following the player always wins. Rearm only after
      // spending time away without approaching it, never while hovered/focused.
      if (yielded) {
        if (hovered || approaching || gap < 180) awaySince = 0;
        else if (!awaySince) awaySince = time;
        else if (time - awaySince > 2400) { yielded = false; awaySince = 0; }
        return;
      }
      if (!avoid || pinned || hovered || root.contains(document.activeElement) || time < graceUntil || !approaching || gap > 52 || !deepMenu()) return;
      if (document.documentElement.dataset.motion === "off" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.fullscreenElement) return;
      const area = bounds();
      const candidates = [
        { ...box, x: area.left, y: area.top }, { ...box, x: area.right - box.width, y: area.top },
        { ...box, x: area.left, y: area.bottom - box.height }, { ...box, x: area.right - box.width, y: area.bottom - box.height },
      ].filter((candidate) => distance(point, candidate) > 100);
      candidates.sort((a, b) => Math.hypot(a.x - box.x, a.y - box.y) - Math.hypot(b.x - box.x, b.y - box.y));
      if (!candidates.length) return;
      box = candidates[0]; yielded = true; awaySince = 0; lastDistance = distance(point, box);
      root.dataset.dodging = "true";
      // Automatic motion is transient; only a deliberate move/resize is saved.
      layout();
    }
    move.addEventListener("pointerdown", (event) => start(event));
    move.addEventListener("keydown", (event) => keyboard(event, "move"));
    root.addEventListener("pointerenter", () => { hovered = true; awaySince = 0; });
    root.addEventListener("pointerleave", () => { hovered = false; graceUntil = now() + 1200; });
    root.addEventListener("focusin", () => { awaySince = 0; });
    root.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); if (gesture) end(); else document.activeElement?.blur?.(); } });
    for (const node of [move, ...edges]) node.addEventListener("lostpointercapture", end);
    document.addEventListener("pointermove", pointer);
    document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    window.addEventListener("blur", () => { end(); hovered = false; });
    window.addEventListener("resize", () => { end(); root.dataset.dodging = "false"; layout(); });
    window.addEventListener("mefi:shell", layout);
    window.addEventListener("mefi:tree-dynamics", paintVideo);
    window.addEventListener("mefi:nav", () => { lastDistance = Infinity; awaySince = 0; root.dataset.dodging = "false"; layout(); });
    window.mefiStudio?.onTasks?.(noticeTasks);
    window.mefiStudio?.onProjects?.((payload) => {
      if (!payload?.activeId || payload.activeId === projectId) return;
      projectId = payload.activeId; knownTasks = null; taskRevision++; faded = false; paintVideo(); seedTasks();
    });
    seedTasks();
    paintToggles();
    return { show, hide, reveal,
      // Carry the player into the menu's stage (an element), or home with
      // null. A player dragged out of the menu stays out until it closes.
      dock: host => {
        if (!host) { dockDetached = false; dockClip = null; }
        else if (dockDetached || !canCarry(host)) return false;
        if (host !== dockHost || !host && parentOf() !== document.body) { dockHost = host || null; layout(); }
        return root.dataset.docked === "true";
      },
      // Top, right, bottom and left insets of a docked website that lie
      // outside the menu's scroller: media-browser.js clips its native view to them.
      clip: inset => {
        const next = Array.isArray(inset) && inset.length === 4 && inset.every(Number.isFinite) && inset.some((value) => value > 0) ? inset.map((value) => Math.max(0, Math.round(value))) : null;
        if (String(next) === String(dockClip)) return;
        dockClip = next;
        if (root.dataset.docked === "true") root.style.clipPath = dockClip ? `inset(${dockClip.join("px ")}px)` : "none";
      },
      // The open menu's rect (left, top, right, bottom), or null once it closes.
      avoid: rect => {
        const next = rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
        if (JSON.stringify(next) === JSON.stringify(aside)) return;
        aside = next; root.dataset.dodging = "true"; layout();
      },
      rename: label => { move.textContent = `⠿ ${String(label || "Media").slice(0, 160)}`; },
      setBackground: value => { if (Boolean(value) !== background) backgroundButton.click(); },
      beginMove: start, moveKey: event => keyboard(event, "move"), minimize: () => minimize.click(),
      snapshot: () => ({ minimized }), restore: (value) => { if (Boolean(value?.minimized) !== minimized) setMinimized(value?.minimized, { focus: false }); } };
  }
  window.MefiMediaWindow = { create };
})();
