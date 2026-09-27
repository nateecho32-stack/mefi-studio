// A persistent, borderless home for the Links player. Moving this surface only
// changes geometry: its iframe/video is never reparented or recreated.
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.mediaWindow.v1";
  const GAP = 16;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const distance = (point, box) => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height));

  // settingsHost shows only while a player is open; controlsHost (inside it)
  // takes the settings and quickHost the everyday Studio background switch.
  function create({ content, onClose, onSettings, settingsHost, controlsHost, quickHost }) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
    let pinned = saved?.pinned === true;
    let avoid = saved?.avoid !== false;
    let background = saved?.background === true;
    let transparency = clamp(finite(saved?.transparency, 0), 0, 90);
    let treeTransparency = clamp(finite(saved?.treeTransparency, 0), 0, 90);
    let videoBrightness = clamp(finite(saved?.videoBrightness, 100), 25, 150);
    let fadeOnDone = saved?.fadeOnDone !== false, faded = false;
    // A background that stops moving (a paused video, an album-art video, a
    // player with no picture) dims just enough for the tree to read over it.
    let stillDim = saved?.stillDim !== false, playing = null, motionless = false;
    let sceneStill = false, stillStreak = 0, sceneLight = null, sampledWith = null, stillShown = null, dimShown = -1, sceneRevision = 0;
    let trackDark = saved?.trackDark === true, sceneTimer = null, sceneBusy = false;
    // While the media menu is open the floating player steps out of its way.
    let avoiding = null, shownUrl = null;
    let darkCandidate = -1, darkStreak = 0, darkCurrent = 4, darkMovedAt = 0;
    let knownTasks = null, projectId = null, taskRevision = 0;
    let box = null, shape = "video", minimized = false, gesture = null;
    let visible = false, hovered = false, yielded = false, awaySince = 0, lastDistance = Infinity, graceUntil = 0;
    let size = {};
    for (const key of ["video", "tall", "compact", "audio"]) {
      const value = saved?.size?.[key];
      if (value && typeof value === "object") size[key] = { width: finite(value.width, undefined), height: finite(value.height, undefined) };
    }
    const now = () => window.performance.now();
    const root = document.createElement("section");
    if (settingsHost) settingsHost.hidden = true;
    root.id = "media-window"; root.className = "media-window"; root.hidden = true;
    root.setAttribute("role", "region"); root.setAttribute("aria-label", "Media player");
    const controls = document.createElement("div"); controls.className = "media-window-controls";
    const button = (id, label, title, action, parent = controls) => {
      const node = document.createElement("button");
      node.type = "button"; node.id = `media-window-${id}`; node.textContent = label;
      node.title = title; node.setAttribute("aria-label", title);
      if (action) node.addEventListener("click", action);
      parent.append(node); return node;
    };
    // On/off settings read as switch rows; aria-pressed carries the state.
    const toggle = (...args) => { const node = button(...args); node.className = "media-window-switch"; return node; };
    const line = (id) => { const node = document.createElement("p"); node.className = "media-window-note"; node.id = `media-window-${id}`; controls.append(node); return node; };
    // Label, slim track and value on one line, like every slider in the menu.
    const slider = (id, label, min, max, input) => {
      const row = document.createElement("label"); row.className = "media-window-transparency";
      const text = document.createElement("span"); text.textContent = label;
      const node = document.createElement("input");
      node.id = `media-window-${id}`; node.type = "range"; node.min = String(min); node.max = String(max); node.step = "5";
      node.setAttribute("aria-label", label);
      node.addEventListener("input", () => input(node));
      const value = document.createElement("output"); value.className = "media-window-value";
      row.append(text, node, value); controls.append(row);
      return { text: value, input: node };
    };
    const fill = (node) => { const ratio = (Number(node.value) - Number(node.min)) / Math.max(1, Number(node.max) - Number(node.min)); node.style.setProperty("--fill", `${Math.round(clamp(ratio, 0, 1) * 1000) / 10}%`); };
    // The floating player's own bar: drag, what is playing (opens the menu),
    // minimize and close. It sits above the video, never over it.
    const toolbar = document.createElement("div"); toolbar.className = settingsHost ? "media-window-toolbar media-window-bar" : "media-window-toolbar";
    const move = button("move", "⠿", "Move media · drag or use arrow keys (Shift for fine steps)", null, toolbar);
    move.className = "media-window-move";
    const caption = document.createElement("button");
    caption.type = "button"; caption.className = "media-window-caption";
    caption.id = "media-window-settings"; caption.title = "Open Music & video settings";
    caption.addEventListener("click", onSettings);
    toolbar.append(caption);
    const minimize = button("minimize", "−", "Minimize media", () => {
      minimized = !minimized; root.dataset.minimized = String(minimized);
      minimize.textContent = minimized ? "↗" : "−";
      minimize.title = minimized ? "Restore media" : "Minimize media";
      minimize.setAttribute("aria-label", minimize.title); minimize.setAttribute("aria-pressed", String(minimized));
      root.setAttribute("aria-label", minimized ? "Media player minimized" : "Media player");
      layout();
    }, toolbar);
    const close = button("close", "×", "Close media and stop playback", () => { hide(); onClose(); }, toolbar);
    if (!settingsHost) controls.append(toolbar);
    const backgroundButton = toggle("background", "Studio background", "Use video as Studio background", () => {
      end(); background = !background;
      if (minimized) minimize.click();
      paintVideo(); layout(); persist();
    });
    const { text: brightnessText, input: brightnessInput } = slider("brightness", "Video brightness", 25, 150, (node) => { videoBrightness = clamp(Number(node.value) || 100, 25, 150); faded = false; paintVideo(); persist(); });
    const { text: opacityText, input: opacityInput } = slider("transparency", "Video transparency", 0, 90, (node) => { transparency = clamp(Number(node.value) || 0, 0, 90); faded = false; paintVideo(); persist(); });
    const { text: treeOpacityText, input: treeOpacityInput } = slider("tree-transparency", "Tree transparency", 0, 90, (node) => { treeTransparency = clamp(Number(node.value) || 0, 0, 90); paintVideo(); persist(); });
    const stillButton = toggle("still", "Dim a still picture", "Dim the background while the video is paused or its picture stays still, so the tree reads clearly", () => {
      stillDim = !stillDim; sampledWith = null; stillStreak = 0;
      paintVideo(); persist();
    });
    const stillNote = line("still-note");
    const darkButton = toggle("dark", "Keep tree in dark areas", "Slowly move the tree toward a consistently darker part of the background video", () => {
      if (window.MefiTreeDynamics) {
        const dynamics = window.MefiTreeDynamics;
        const enabled = dynamics.videoEnabled() && dynamics.preferences().videoTarget === "dark";
        dynamics.update({ mode: enabled ? (dynamics.musicEnabled() ? "music" : "steady") : (dynamics.musicEnabled() ? "hybrid" : "video"), videoTarget: "dark" });
        return;
      }
      trackDark = !trackDark; darkCandidate = -1; darkStreak = 0; darkCurrent = 4; darkMovedAt = 0;
      window.MefiIdle?.setMediaFocus?.(null); paintVideo(); persist();
    });
    const fadeButton = toggle("fade", "Fade on finish", "Fade video and notify when a task finishes", () => {
      fadeOnDone = !fadeOnDone;
      if (!fadeOnDone) faded = false;
      paintVideo(); persist();
    });
    const restoreButton = button("restore", "Restore video", "Restore video after task completion", () => { faded = false; paintVideo(); });
    const pin = toggle("pin", "Pin in place", "Pin media in place", () => { pinned = !pinned; root.dataset.dodging = "false"; paintToggles(); persist(); });
    const dodge = toggle("avoid", "Move aside for the pointer", "Move aside near the pointer in menus", () => { avoid = !avoid; yielded = false; paintToggles(); persist(); });
    window.MefiTreeDynamics?.mountVisibility?.(controls, "media");
    if (quickHost) quickHost.append(backgroundButton);
    if (settingsHost) { root.append(toolbar); root.dataset.bar = "true"; }
    root.append(content);
    (controlsHost || settingsHost || root).append(controls);
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
      // Keep the menu and local navigation reachable even at the 600px app minimum.
      const rail = document.getElementById("app-rail")?.getBoundingClientRect();
      const nav = document.getElementById("app-local-nav")?.getBoundingClientRect();
      const left = rail?.width > 0 ? clamp(rail.right, 0, Math.max(0, window.innerWidth - 320)) : 0;
      return { left: left + GAP, top: Math.max(GAP, (nav?.height > 0 ? nav.bottom : 0) + GAP), right: window.innerWidth - GAP, bottom: window.innerHeight - GAP };
    }
    function limits() {
      const area = bounds();
      const maxWidth = Math.max(1, area.right - area.left), maxHeight = Math.max(1, area.bottom - area.top);
      return { area, maxWidth, maxHeight, minWidth: Math.min(464, maxWidth), minHeight: Math.min(shape === "tall" ? 240 : shape === "audio" ? 104 : 216, maxHeight) };
    }
    function fit(candidate) {
      const { area, maxWidth, maxHeight, minWidth, minHeight } = limits();
      const width = clamp(finite(candidate.width, 600), minWidth, maxWidth);
      const height = clamp(finite(candidate.height, 248), minHeight, maxHeight);
      return { width, height, x: clamp(finite(candidate.x, area.right - width), area.left, area.right - width), y: clamp(finite(candidate.y, area.bottom - height), area.top, area.bottom - height) };
    }
    function visibleBox() {
      if (minimized) return { ...box, width: Math.min(box.width, 304), height: 44 };
      if (background) { const area = bounds(); return { x: area.left, y: area.top, width: area.right - area.left, height: area.bottom - area.top }; }
      return box;
    }
    function layout() {
      if (!box) return;
      box = fit(box);
      const current = visibleBox();
      Object.assign(root.style, { left: `${current.x}px`, top: `${current.y}px`, width: `${current.width}px`, height: `${current.height}px` });
      for (const grip of edges) grip.hidden = minimized || background;
      paintVideo();
    }
    function persist() {
      if (!box) return;
      const area = bounds();
      // Stepping aside for the menu is transient; the chosen place is saved.
      const placed = avoiding && !avoiding.moved ? avoiding.home : box;
      saved = { pinned, avoid, background, transparency, treeTransparency, videoBrightness, fadeOnDone, stillDim, trackDark, size, x: (placed.x - area.left) / Math.max(1, area.right - area.left - placed.width), y: (placed.y - area.top) / Math.max(1, area.bottom - area.top - placed.height) };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
    }
    function paintToggles() {
      pin.setAttribute("aria-pressed", String(pinned)); dodge.setAttribute("aria-pressed", String(avoid));
      pin.title = pinned ? "Unpin media to allow Move aside" : "Pin media in place";
      pin.setAttribute("aria-label", pin.title);
      dodge.title = pinned ? "Move aside is paused while pinned" : "Move aside near the pointer in menus";
    }
    // Why the background is dimmed right now, or "" when it is not.
    function stillReason() {
      if (!stillDim || !visible || !background || minimized || faded) return "";
      if (motionless) return "audio";
      if (playing === false) return "paused";
      return sceneStill ? "still" : "";
    }
    // Just enough dimming to bring the picture near the tree's dark sky: a
    // bright still dims further than a dark one.
    function stillLevel(reason) {
      if (!reason) return 0;
      if (!Number.isFinite(sceneLight)) return .55;
      return Math.round(clamp((sceneLight - .14) / Math.max(sceneLight, .01), .3, .72) * 100) / 100;
    }
    // Only where the tree is on screen, and never under an open menu.
    function sampleView() {
      const route = window.MefiNav?.top?.() || window.MefiNav?.current?.();
      return ["command", "workspace", "vibe"].includes(route) && document.getElementById("music-dropdown")?.hidden !== false && !document.querySelector(".surface-tools[open], .studio-more[open], .cmd-more-tools[open]");
    }
    function paintVideo() {
      if (settingsHost) settingsHost.hidden = !visible;
      const backdrop = visible && background && !minimized;
      const backdropChanged = document.body.dataset.mediaBackground !== String(backdrop);
      root.dataset.background = String(backdrop);
      document.body.dataset.mediaVisible = String(visible && !minimized);
      document.body.dataset.mediaBackground = String(backdrop);
      document.body.style.setProperty("--media-tree-opacity", String(1 - treeTransparency / 100));
      document.body.dataset.mediaView = window.MefiNav?.top?.() || window.MefiNav?.current?.() || "";
      if (backdropChanged && typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("mefi:media-background"));
      content.style.opacity = String(faded ? 0.08 : (1 - transparency / 100));
      content.style.filter = `brightness(${videoBrightness / 100})`;
      const reason = stillReason(), dim = stillLevel(reason);
      if (reason !== stillShown) { stillShown = reason; root.dataset.still = reason ? "true" : "false"; }
      if (dim !== dimShown) { dimShown = dim; content.style.setProperty("--media-still-dim", String(dim)); }
      backgroundButton.setAttribute("aria-pressed", String(background));
      fadeButton.setAttribute("aria-pressed", String(fadeOnDone));
      stillButton.setAttribute("aria-pressed", String(stillDim));
      stillNote.textContent = !stillDim ? "The background keeps its own brightness." : !background ? "Applies while the video is the Studio background."
        : reason === "audio" ? "Dimmed: this player has no moving picture." : reason === "paused" ? "Dimmed while the video is paused."
        : reason === "still" ? "Dimmed: the picture has stayed still." : "Full brightness while the picture moves.";
      const dynamics = window.MefiTreeDynamics;
      dynamics?.setVideoAvailable(backdrop && !faded);
      const tracking = dynamics ? Boolean(dynamics.sampleRequest()) : trackDark;
      darkButton.setAttribute("aria-pressed", String(dynamics ? dynamics.videoEnabled() && dynamics.preferences().videoTarget === "dark" : trackDark));
      restoreButton.hidden = !faded;
      opacityInput.value = String(transparency);
      opacityText.textContent = `${transparency}%`;
      treeOpacityInput.value = String(treeTransparency);
      treeOpacityText.textContent = `${treeTransparency}%`;
      brightnessInput.value = String(videoBrightness);
      brightnessText.textContent = `${videoBrightness}%`;
      for (const node of [opacityInput, treeOpacityInput, brightnessInput]) fill(node);
      move.disabled = background; pin.disabled = background; dodge.disabled = background;
      // Floating-only settings leave the menu while the video is a background.
      pin.hidden = background; dodge.hidden = background;
      // A backdrop must never take keyboard focus or intercept workspace clicks.
      content.inert = backdrop || minimized;
      // One sampler serves dark-area tracking and still-picture dimming. A
      // player known to be paused or pictureless needs no looking at.
      const watching = backdrop && !faded && (tracking || stillDim && !motionless && playing !== false && sampleView());
      if (watching && window.mefiStudio?.mediaSceneSample && !sceneTimer) sceneTimer = window.setInterval(sampleScene, 5000);
      if (!watching && sceneTimer) { window.clearInterval(sceneTimer); sceneTimer = null; }
      if (dynamics || !backdrop || !trackDark) {
        darkCandidate = -1; darkStreak = 0; darkCurrent = 4; darkMovedAt = 0;
        window.MefiIdle?.setMediaFocus?.(null);
      }
    }
    // Motion is read against the last look at the same scene. A change of dim,
    // brightness or transparency in between is a change of paint, not motion.
    const scenePaint = () => `${sceneRevision}|${dimShown}|${videoBrightness}|${transparency}|${faded}|${stillDim}`;
    function noticeMotion(result) {
      const paint = scenePaint();
      const comparable = sampledWith === paint;
      sampledWith = paint;
      if (Number.isFinite(result?.light) && dimShown <= 0) sceneLight = clamp(result.light, 0, 1);
      if (!comparable || !Number.isFinite(result?.motion)) { stillStreak = 0; return; }
      // Dimmed or transparent video shows smaller changes for the same motion.
      const visibility = Math.max(.15, (1 - Math.max(0, dimShown)) * videoBrightness / 100 * (1 - transparency / 100));
      const motion = result.motion / visibility;
      if (motion < .0015) {
        stillStreak++;
        if (stillStreak >= 2 && !sceneStill) { sceneStill = true; paintVideo(); }
      } else {
        stillStreak = 0;
        if (motion > .003 && sceneStill) { sceneStill = false; paintVideo(); }
      }
    }
    async function sampleScene() {
      const dynamics = window.MefiTreeDynamics, request = dynamics?.sampleRequest();
      if (sceneBusy || !visible || !background || minimized || faded || document.hidden) return;
      const tracking = dynamics ? Boolean(request) : trackDark;
      const area = tracking ? window.MefiIdle?.mediaSceneArea?.() : null;
      const still = stillDim && !motionless && playing !== false && sampleView();
      if (!area && !still) return;
      const bound = bounds();
      const paint = scenePaint();
      sceneBusy = true;
      try {
        const result = await window.mefiStudio.mediaSceneSample(area ? { ...area, ...(request || {}) } : { x: bound.left, y: bound.top, w: bound.right - bound.left, h: bound.bottom - bound.top });
        if (!visible || !background || minimized || faded || paint !== scenePaint()) return;
        if (result?.ok && still && sampleView()) noticeMotion(result);
        if (!area || !(dynamics ? dynamics.sampleRequest() : trackDark) || !window.MefiIdle?.mediaSceneArea?.()) return;
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
      if (!visible || !fadeOnDone || !completed.length) return;
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
    function forgetScene() { sceneRevision++; sceneStill = false; stillStreak = 0; sceneLight = null; sampledWith = null; }
    function show(link) {
      window.MefiTreeDynamics?.setVideoAvailable(false);
      root.dataset.dodging = "false";
      const nextShape = link.shape || "video";
      if (link.url !== shownUrl) { shownUrl = link.url; playing = null; forgetScene(); }
      motionless = nextShape !== "video";
      if (!box || nextShape !== shape) {
        shape = nextShape;
        // With its bar, a video window opens at 16:9 instead of letterboxed.
        const defaults = shape === "tall" ? { width: 540, height: settingsHost ? 402 : 368 } : shape === "compact" ? { width: 540, height: 216 } : shape === "audio" ? { width: 540, height: 104 } : { width: 600, height: settingsHost ? 372 : 264 };
        const preferred = size[shape];
        box = fit({ ...defaults, width: finite(preferred?.width, defaults.width), height: finite(preferred?.height, defaults.height), x: box?.x, y: box?.y });
        const area = bounds();
        box.x = area.left + clamp(finite(saved?.x, 1), 0, 1) * Math.max(0, area.right - area.left - box.width);
        box.y = area.top + clamp(finite(saved?.y, 1), 0, 1) * Math.max(0, area.bottom - area.top - box.height);
      }
      caption.textContent = link.label;
      caption.title = `${link.label} · open Music & video settings`;
      content.dataset.shape = shape; root.dataset.shape = shape;
      visible = true; root.hidden = false; layout();
      graceUntil = now() + 1600;
    }
    function hide() {
      if (minimized) minimize.click();
      avoiding = null; shownUrl = null; playing = null; forgetScene();
      end(); visible = false; root.hidden = true; hovered = false; yielded = false; awaySince = 0; faded = false; paintVideo();
    }
    // Music reports what the player is doing; a paused video is a still one.
    function playback(value = {}) {
      const next = typeof value.playing === "boolean" ? value.playing : null;
      if (next === playing) return;
      // A pause or restart invalidates pending samples and the motion baseline.
      sceneRevision++; sceneStill = false; stillStreak = 0; sampledWith = null;
      playing = next; paintVideo();
    }
    // Step clear of a rect (the open media menu), and return to the chosen
    // place when it goes, unless the player was deliberately moved meanwhile.
    function avoidRect(rect) {
      const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      root.dataset.menuOpen = String(Boolean(rect?.width > 0 && rect?.height > 0));
      if (!rect || !(rect.width > 0 && rect.height > 0)) {
        const previous = avoiding; avoiding = null;
        if (previous && !previous.moved && box && visible) { box = fit(previous.home); root.dataset.dodging = "true"; layout(); }
        else layout();
        return;
      }
      if (!visible || background || !box || gesture) return;
      avoiding ??= { home: { ...box }, moved: false };
      const blocker = { x: rect.x - GAP / 2, y: rect.y - GAP / 2, width: rect.width + GAP, height: rect.height + GAP };
      if (!overlaps(visibleBox(), blocker)) return;
      const area = bounds(), shown = visibleBox(), current = box;
      const place = (x, y) => fit({ ...current, x, y });
      const candidates = [
        place(blocker.x - shown.width, shown.y), place(blocker.x - shown.width, area.bottom - shown.height), place(blocker.x - shown.width, area.top),
        place(area.left, area.bottom - shown.height), place(area.left, area.top), place(area.right - shown.width, area.bottom - shown.height),
      ].filter((candidate) => { box = candidate; const clear = !overlaps(visibleBox(), blocker); box = current; return clear; });
      if (!candidates.length) return;
      candidates.sort((a, b) => Math.hypot(a.x - shown.x, a.y - shown.y) - Math.hypot(b.x - shown.x, b.y - shown.y));
      box = candidates[0]; root.dataset.dodging = "true"; layout();
    }
    function reveal() {
      if (minimized) minimize.click();
      graceUntil = now() + 1600;
      (background ? backgroundButton : move).focus({ preventScroll: true });
    }
    function start(event, edge = "move") {
      if (event.button !== 0 || gesture || !visible || background) return;
      event.preventDefault(); event.stopPropagation();
      gesture = { edge, x: event.clientX, y: event.clientY, box: { ...box }, target: event.currentTarget, pointerId: event.pointerId };
      root.dataset.dodging = "false";
      root.dataset.interacting = "true";
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      graceUntil = now() + 1600;
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
      if (avoiding) avoiding.moved = true;
      persist(); graceUntil = now() + 1600;
    }
    function keyboard(event, edge) {
      const vectors = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!vectors[event.key] || !box || background) return;
      event.preventDefault(); event.stopPropagation();
      root.dataset.dodging = "false";
      const step = event.shiftKey ? 2 : 16;
      box = changed(vectors[event.key][0] * step, vectors[event.key][1] * step, edge, box);
      if (edge !== "move") size = { ...size, [shape]: { width: box.width, height: box.height } };
      if (avoiding) avoiding.moved = true;
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
      if (!visible || minimized || background || event.buttons || event.pointerType && event.pointerType !== "mouse") return;
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
      if (!avoid || pinned || avoiding || hovered || root.contains(document.activeElement) || time < graceUntil || !approaching || gap > 52 || !deepMenu()) return;
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
    return { show, hide, reveal, playback, avoid: avoidRect, close: () => close.click(), stillStatus: () => ({ reason: stillReason(), dim: dimShown, still: sceneStill, light: sceneLight }),
      snapshot: () => ({ minimized }), restore: (value) => { if (Boolean(value?.minimized) !== minimized) minimize.click(); } };
  }
  window.MefiMediaWindow = { create };
})();
