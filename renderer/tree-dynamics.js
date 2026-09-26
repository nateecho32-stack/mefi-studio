// Shared, saved controls for the Command tree and its Appearance preview.
// Only painted positions change: graph identity, work and saved anchors stay intact.
(function () {
  "use strict";
  const KEY = "mefiStudio.treeDynamics.v1";
  const defaults = Object.freeze({ mode: "music", shape: "layout", width: 1, height: 1, rotation: 0, x: 0, y: 0,
    nodeSize: 1, adaptCount: true, nodeMotion: .25, shapeMotion: .25, positionMotion: .2,
    videoTarget: "dark", videoStrength: .7, videoShape: true, smoothing: 2, dwell: 15,
    nodeBrightness: 1, lineBrightness: 1, nodeBrightnessEnabled: true, lineBrightnessEnabled: true, outlines: false });
  const visibilityKeys = ["nodeBrightness", "lineBrightness", "nodeBrightnessEnabled", "lineBrightnessEnabled", "outlines"];
  const ranges = { width: [.4, 1], height: [.4, 1], rotation: [-180, 180], x: [-1, 1], y: [-1, 1],
    nodeSize: [.5, 1.6], nodeMotion: [0, 1], shapeMotion: [0, 1], positionMotion: [0, 1],
    videoStrength: [0, 1], smoothing: [.2, 8], dwell: [5, 60], nodeBrightness: [0, 2], lineBrightness: [0, 2] };
  const choices = { mode: ["steady", "music", "video", "hybrid"], shape: ["layout", "ring", "wave", "spiral"], videoTarget: ["dark", "bright"] };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function normalize(value) {
    const result = { ...defaults };
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, bounds] of Object.entries(ranges)) if (typeof value[key] === "number" && Number.isFinite(value[key])) result[key] = clamp(value[key], ...bounds);
    for (const [key, options] of Object.entries(choices)) if (options.includes(value[key])) result[key] = value[key];
    for (const key of ["adaptCount", "videoShape", "nodeBrightnessEnabled", "lineBrightnessEnabled", "outlines"]) if (typeof value[key] === "boolean") result[key] = value[key];
    return result;
  }
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!saved) {
    try { if (JSON.parse(localStorage.getItem("mefiStudio.mediaWindow.v1"))?.trackDark === true) saved = { mode: "hybrid" }; } catch {}
  }
  let prefs = normalize(saved), revision = 0, available = false, count = 0, statusText = "Video positioning waits for a background video.";
  let candidate = -1, streak = 0, current = 4, movedAt = -Infinity, scene = null;
  const positions = new Map(), panels = [];
  const musicEnabled = () => prefs.mode === "music" || prefs.mode === "hybrid";
  const videoEnabled = () => prefs.mode === "video" || prefs.mode === "hybrid";
  function clearScene() { scene = null; candidate = -1; streak = 0; current = 4; movedAt = -Infinity; }
  function update(changes) {
    prefs = normalize({ ...prefs, ...changes });
    if (!Object.keys(changes || {}).every(key => visibilityKeys.includes(key))) { revision++; clearScene(); }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
    refresh();
    window.dispatchEvent(new CustomEvent("mefi:tree-dynamics", { detail: { ...prefs } }));
    return { ...prefs };
  }
  function setVideoAvailable(value) {
    if (available === Boolean(value)) return;
    available = Boolean(value); revision++; clearScene();
    statusText = available ? "Waiting for a stable video region; close menus to sample." : "Video positioning waits for a background video.";
    refresh();
  }
  // Match the area scored by the host to the footprint used by the tree.
  function footprint() {
    const minimum = prefs.adaptCount ? clamp(.48 + Math.sqrt(count) * .035, .48, .94) : .4;
    return { coverageW: Math.max(minimum, prefs.width * .78), coverageH: Math.max(minimum, prefs.height * .78) };
  }
  function sampleRequest() { return available && videoEnabled() && prefs.videoStrength > 0 ? { revision, ...footprint() } : null; }
  function acceptSample(scores, token, now = Date.now()) {
    if (token !== revision || !sampleRequest() || !Array.isArray(scores) || scores.length !== 9 || !scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return false;
    const costs = scores.map(n => prefs.videoTarget === "bright" ? 1 - n : n);
    const best = costs.indexOf(Math.min(...costs));
    statusText = `Tracking ${prefs.videoTarget} regions · ${count} visible nodes`;
    if (best === current || costs[current] - costs[best] < .04) { streak = 0; refresh(); return false; }
    streak = best === candidate ? streak + 1 : 1; candidate = best;
    if (streak < 2 || now - movedAt < prefs.dwell * 1000) { refresh(); return false; }
    const row = Math.floor(best / 3), col = best % 3;
    const across = costs[row * 3 + 2] - costs[row * 3], down = costs[6 + col] - costs[col];
    scene = { x: col - 1, y: row - 1, width: 1 - Math.min(.25, Math.abs(across)), height: 1 - Math.min(.25, Math.abs(down)) };
    current = best; movedAt = now; streak = 0; refresh();
    window.dispatchEvent(new CustomEvent("mefi:tree-sample"));
    return true;
  }
  const phaseOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h / 4294967296 * Math.PI * 2; };
  function apply(projected, area, { dt = 0, time = 0, music = null, response = 0, linked = false, still = false, interactive = false } = {}) {
    const live = projected.filter(({ node }) => !node.dying && !node._absorbed);
    if (count !== live.length) { count = live.length; revision++; candidate = -1; streak = 0; refresh(); }
    const ids = new Set(projected.map(({ node }) => node.id));
    for (const id of positions.keys()) if (!ids.has(id)) positions.delete(id);
    // Inspect, pan, Follow and tours own the camera while in use.
    if (interactive || !live.length) { positions.clear(); return false; }
    const audio = !still && linked && musicEnabled() ? clamp(response, 0, 2) : 0;
    const bass = clamp(Number(music?.bass) || 0, 0, 1) * audio;
    const mid = clamp(Number(music?.mid) || 0, 0, 1) * audio;
    const treble = clamp(Number(music?.treble) || 0, 0, 1) * audio;
    const video = !still && available && videoEnabled() ? scene : null;
    const strength = video ? prefs.videoStrength : 0;
    const density = prefs.adaptCount ? clamp(1 / Math.sqrt(Math.max(1, count / 24)), .35, 1) : 1;
    const minimum = prefs.adaptCount ? clamp(Math.sqrt(count) / 18, .4, .9) : .4;
    const width = Math.max(minimum, prefs.width) * (1 - bass * prefs.shapeMotion * .12) * (prefs.videoShape && video ? 1 - (1 - video.width) * strength : 1);
    const height = Math.max(minimum, prefs.height) * (1 - mid * prefs.shapeMotion * .12) * (prefs.videoShape && video ? 1 - (1 - video.height) * strength : 1);
    const angle = prefs.rotation * Math.PI / 180 + Math.sin(time / 2400) * mid * prefs.shapeMotion * .12;
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
    const inset = Math.min(36 * Math.max(1, prefs.nodeSize), Math.min(area.w, area.h) / 4);
    const halfW = Math.max(1, area.w / 2 - inset), halfH = Math.max(1, area.h / 2 - inset);
    const sizeLimit = prefs.shape === "ring" ? Math.PI * Math.min(halfW * width, halfH * height) / Math.max(1, count) / 26
      : Math.sqrt(area.w * area.h * width * height / Math.max(1, count)) / 70;
    const countScale = prefs.adaptCount ? clamp(sizeLimit / prefs.nodeSize, .35, 1) : 1;
    const offsetX = clamp(prefs.x + (video?.x ?? 0) * strength + Math.sin(time / 1700) * bass * prefs.positionMotion * .2, -1, 1);
    const offsetY = clamp(prefs.y + (video?.y ?? 0) * strength + Math.sin(time / 2200) * mid * prefs.positionMotion * .2, -1, 1);
    // Ordered identities keep membership deterministic through graph refreshes.
    const ordered = [...live].sort((a, b) => String(a.node.id).localeCompare(String(b.node.id)));
    const rank = new Map(ordered.map((entry, i) => [entry.node.id, i]));
    let reachX = 1, reachY = 1;
    const targets = projected.map(entry => {
      const { node, p } = entry, i = rank.get(node.id) ?? 0, t = i / Math.max(1, count - 1), theta = i / Math.max(1, count) * Math.PI * 2 - Math.PI / 2;
      let x = p.x - cx, y = p.y - cy;
      if (prefs.shape === "ring") { x = Math.cos(theta) * halfW * .85; y = Math.sin(theta) * halfH * .85; }
      if (prefs.shape === "wave") { x = (t * 2 - 1) * halfW * .85; y = Math.sin(t * Math.PI * 4) * halfH * .65; }
      if (prefs.shape === "spiral") { const r = .15 + .7 * Math.sqrt(t); x = Math.cos(t * Math.PI * 6) * halfW * r; y = Math.sin(t * Math.PI * 6) * halfH * r; }
      if (count === 1 && prefs.shape !== "layout") { x = 0; y = 0; }
      const phase = phaseOf(node.id), drift = (bass + treble) * prefs.nodeMotion * 12 * density;
      const tx = (x * Math.cos(angle) - y * Math.sin(angle)) * width + Math.sin(time / 1100 + phase) * drift;
      const ty = (x * Math.sin(angle) + y * Math.cos(angle)) * height + Math.cos(time / 1400 + phase) * drift;
      if (!node.dying && !node._absorbed) { reachX = Math.max(reachX, Math.abs(tx)); reachY = Math.max(reachY, Math.abs(ty)); }
      node._treeScale = prefs.nodeSize * countScale * (1 + bass * prefs.nodeMotion * .12 * density);
      return { entry, x: tx, y: ty };
    });
    // Reserve space for placement and never clip the transformed tree to a rail.
    const placing = Math.max(Math.abs(offsetX), Math.abs(offsetY));
    const room = 1 - placing * .28;
    const fit = Math.min(1, halfW * room / reachX, halfH * room / reachY);
    const shiftX = offsetX * Math.max(0, halfW - reachX * fit), shiftY = offsetY * Math.max(0, halfH - reachY * fit);
    const ease = still ? 1 : 1 - Math.exp(-Math.max(0, dt) / prefs.smoothing);
    let moving = false;
    for (const { entry, x, y } of targets) {
      const target = { x: cx + x * fit + shiftX, y: cy + y * fit + shiftY };
      // Smooth offsets, rather than absolute points, so camera motion and hit tests agree.
      const previous = positions.get(entry.node.id) ?? { x: 0, y: 0 };
      const dx = target.x - entry.p.x, dy = target.y - entry.p.y;
      previous.x += (dx - previous.x) * ease; previous.y += (dy - previous.y) * ease;
      moving ||= Math.abs(dx - previous.x) + Math.abs(dy - previous.y) > .1;
      entry.p.x = clamp(entry.p.x + previous.x, cx - halfW, cx + halfW);
      entry.p.y = clamp(entry.p.y + previous.y, cy - halfH, cy + halfH);
      positions.set(entry.node.id, previous);
    }
    return moving || audio > 0;
  }
  function refresh() {
    for (const panel of panels) {
      for (const [key, { input, output }] of Object.entries(panel.fields)) {
        if (input.type === "checkbox") input.checked = prefs[key]; else input.value = String(prefs[key]);
        if (output) output.textContent = key === "rotation" ? `${prefs[key]}°` : ["smoothing", "dwell"].includes(key) ? `${prefs[key]}s` : `${Math.round(prefs[key] * 100)}%`;
        if (key === "nodeBrightness" || key === "lineBrightness") input.disabled = !prefs[`${key}Enabled`];
      }
      if (panel.status) panel.status.textContent = `${count} visible nodes · ${videoEnabled() ? statusText : "Shape and position update live in Overview."}`;
    }
  }
  // Canvas filters affect only the requested paint pass. Menus, video and text
  // retain their own colors, and the default 100% path adds no filter work.
  function beginPaint(contexts, kind) {
    const key = kind === "lines" ? "lineBrightness" : "nodeBrightness";
    const amount = prefs[`${key}Enabled`] ? prefs[key] : 1;
    if (amount === 1) return null;
    const saved = [...new Set(contexts.filter(Boolean))].map(ctx => [ctx, ctx.filter]);
    for (const [ctx, previous] of saved) ctx.filter = `${previous && previous !== "none" ? `${previous} ` : ""}brightness(${amount})`;
    return () => { for (const [ctx, previous] of saved) ctx.filter = previous || "none"; };
  }
  function outline(ctx, style, p, radius, motion, alpha = 1) {
    if (!prefs.outlines) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.beginPath();
    if (window.MefiNodeStyles?.outline) window.MefiNodeStyles.outline(ctx, style, p.x, p.y, radius + 1.5, motion);
    else ctx.arc(p.x, p.y, radius + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  function mountVisibility(host, prefix) {
    const add = (tag, text, parent) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    const root = add("details", null, host); root.className = "music-tree-visibility";
    add("summary", "Tree brightness & outlines", root);
    const fields = {};
    for (const [key, title] of [["nodeBrightnessEnabled", "Adjust node brightness"], ["nodeBrightness", "Node brightness"], ["lineBrightnessEnabled", "Adjust line brightness"], ["lineBrightness", "Connecting line brightness"], ["outlines", "Node outlines"]]) {
      const row = add("label", null, root); row.className = "music-tree-control";
      add("span", title, row);
      const input = add("input", null, row); input.id = `${prefix}-tree-${key}`; input.setAttribute("aria-label", title);
      let output;
      if (typeof defaults[key] === "boolean") input.type = "checkbox";
      else { input.type = "range"; input.min = "0"; input.max = "2"; input.step = ".05"; output = add("output", null, row); output.setAttribute("for", input.id); }
      input.addEventListener(input.type === "range" ? "input" : "change", () => update({ [key]: input.type === "checkbox" ? input.checked : Number(input.value) }));
      fields[key] = { input, output };
    }
    const hint = add("p", "Brightness changes nodes and connecting lines independently. Turn an adjustment off to use normal brightness without losing its slider setting. Outlines add a contrasting edge around each node.", root); hint.className = "music-fineprint";
    const reset = add("button", "Reset tree brightness", root); reset.type = "button"; reset.className = "ghost";
    reset.addEventListener("click", () => update(Object.fromEntries(visibilityKeys.map(key => [key, defaults[key]]))));
    panels.push({ fields }); refresh(); return root;
  }
  function mount(host, prefix) {
    const add = (tag, text, parent = host) => { const e = document.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    const root = add("details"); root.className = "music-tree-dynamics";
    add("summary", "Tree modes & movement", root);
    const intro = add("p", "Shape, position and music response for every visible node. Use Overview to edit; connect Audio Link for music and choose Background for video.", root); intro.className = "music-fineprint";
    const fields = {};
    function control(key, title, options) {
      const row = add("label", null, root); row.className = "music-tree-control";
      add("span", title, row);
      const input = add(options ? "select" : "input", null, row); input.id = `${prefix}-tree-${key}`; input.setAttribute("aria-label", title);
      let output;
      if (options) for (const [value, label] of options) { const option = add("option", label, input); option.value = value; }
      else if (typeof defaults[key] === "boolean") input.type = "checkbox";
      else { input.type = "range"; [input.min, input.max] = ranges[key].map(String); input.step = key === "rotation" || key === "dwell" ? "1" : key === "smoothing" ? ".1" : ".05"; output = add("output", null, row); output.setAttribute("for", input.id); }
      input.addEventListener(input.type === "range" ? "input" : "change", () => update({ [key]: input.type === "checkbox" ? input.checked : options ? input.value : Number(input.value) }));
      fields[key] = { input, output };
    }
    control("mode", "Reaction mode", [["steady", "Steady"], ["music", "Music"], ["video", "Video"], ["hybrid", "Music + video"]]);
    control("shape", "Live shape", [["layout", "Chosen layout"], ["ring", "Ring"], ["wave", "Wave"], ["spiral", "Spiral"]]);
    for (const [key, title] of [["adaptCount", "Adapt spacing to node count"], ["width", "Shape width"], ["height", "Shape height"], ["rotation", "Shape rotation"], ["x", "Horizontal position"], ["y", "Vertical position"], ["nodeSize", "Node size"], ["nodeMotion", "Music · node movement & size"], ["shapeMotion", "Music · shape deformation"], ["positionMotion", "Music · position sway"]]) control(key, title);
    control("videoTarget", "Video positioning", [["dark", "Seek dark regions"], ["bright", "Seek bright regions"]]);
    for (const [key, title] of [["videoStrength", "Video positioning strength"], ["videoShape", "Adapt shape to video regions"], ["smoothing", "Movement smoothing"], ["dwell", "Video region hold"]]) control(key, title);
    const reset = add("button", "Reset tree movement", root); reset.type = "button"; reset.className = "ghost"; reset.addEventListener("click", () => update(Object.fromEntries(Object.entries(defaults).filter(([key]) => !visibilityKeys.includes(key)))));
    const status = add("p", null, root); status.className = "music-fineprint"; status.setAttribute("role", "status");
    mountVisibility(root, prefix);
    panels.push({ fields, status }); refresh(); return root;
  }
  window.MefiTreeDynamics = { normalize, update, mount, mountVisibility, beginPaint, outline, apply, musicEnabled, videoEnabled, sampleRequest, acceptSample, setVideoAvailable,
    preferences: () => ({ ...prefs }), status: () => ({ count, available, scene: scene ? { ...scene } : null, revision }) };
})();
