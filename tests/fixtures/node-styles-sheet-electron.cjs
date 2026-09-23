"use strict";

// Node-style sheets for tools/capture_node_styles.mjs. A blank data: page
// loads renderer/node-styles.js whole (window.MefiNodeStyles) plus tree3d.js's
// agent colours and glyphs, paints every look on plain canvases and hands back
// canvas.toDataURL() and the pixel metrics; the tool writes the PNGs. No Studio
// stores, providers, workers or network.

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.MEFI_NODE_SHEET_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated node sheet directory is required");
const job = JSON.parse(fs.readFileSync(path.join(root, "job.json"), "utf8"));
const outputs = path.join(root, "out");
fs.mkdirSync(outputs, { recursive: true });
const report = { networkAttempts: [], outputs: [], metrics: [], version: null };
app.setName("Studio Node Style Sheets");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
// Sheets are drawn at an explicit canvas scale (--dpr), never the display's.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration();
let finished = false;
let window;
// Finish owns shutdown so closing the last window cannot quit before the
// session has released connections and the report has been written.
app.on("window-all-closed", () => {});
async function finish(error) {
  if (finished) return;
  finished = true;
  const errors = error ? [error] : [];
  try {
    if (window && !window.isDestroyed()) {
      await new Promise((resolve) => { window.once("closed", resolve); window.close(); });
    }
    if (app.isReady()) {
      session.defaultSession.flushStorageData();
      await session.defaultSession.closeAllConnections();
    }
  } catch (shutdownError) { errors.push(shutdownError); }
  if (errors.length) report.failure = errors.map((failure) => failure.stack || String(failure)).join("\nShutdown also failed:\n");
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (report.failure) console.error(report.failure);
  process.exitCode = errors.length ? 1 : 0;
  app.quit();
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

// Everything below runs in the page, after renderer/node-styles.js and the
// tree3d.js agent slices (window.__agentLook). It mirrors what the Command
// view (idle.js drawFrame) hands the module: the same tints, alphas, detail
// tiers, motion flags and hook options. Where a hook declines (false), the
// sheet draws the Command view's own fallback for rings, hub dress and work
// orbits (marked L), a plain 1px line for wires and a plain dot for pulses
// (marked "legacy"), and nothing for arrival and selection.
function pageSetup() {
  const styles = window.MefiNodeStyles;
  const look = window.__agentLook;
  if (!styles) throw new Error("renderer/node-styles.js did not set window.MefiNodeStyles");
  if (typeof look?.agentGlyph !== "function") throw new Error("tree3d.js agent glyphs are missing");
  const TAU = Math.PI * 2;
  const FRAME_MS = 1000 / 30, FRAME = 1 / 30, WARM_FRAMES = 120, GROW_MS = 650;
  const HOVER_S = 0.09 * Math.LN2; // a hover this far in has its lift halfway there
  const FONT = 'system-ui, "Segoe UI", sans-serif';

  // Every gradient anything builds, and every shadowBlur/filter set; the
  // metrics read the deltas around each module call.
  const counts = { radial: 0, linear: 0, conic: 0, shadowBlur: 0, filter: 0 };
  const proto = CanvasRenderingContext2D.prototype;
  for (const [name, key] of [["createRadialGradient", "radial"], ["createLinearGradient", "linear"], ["createConicGradient", "conic"]]) {
    const original = proto[name];
    if (typeof original === "function") proto[name] = function (...args) { counts[key] += 1; return original.apply(this, args); };
  }
  for (const key of ["shadowBlur", "filter"]) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor?.set || !descriptor.configurable) continue;
    Object.defineProperty(proto, key, {
      configurable: true, enumerable: descriptor.enumerable, get: descriptor.get,
      set(value) { if (key === "shadowBlur" ? value > 0 : value !== "none") counts[key] += 1; descriptor.set.call(this, value); },
    });
  }
  const built = () => counts.radial + counts.linear + counts.conic;

  const hexRgb = (value) => {
    const text = String(value ?? "").replace("#", "");
    const full = text.length === 3 ? text.split("").map((char) => char + char).join("") : text.slice(0, 6);
    const int = parseInt(full, 16);
    return Number.isFinite(int) ? [(int >> 16) & 255, (int >> 8) & 255, int & 255] : [230, 201, 141];
  };
  const css = (triple, alpha = 1) => `rgba(${triple[0]},${triple[1]},${triple[2]},${alpha})`;
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

  // The rows of a sheet: what each node is doing. tint names a NODE_RGB key
  // (idle.js syncGraphTheme builds them from the palette, as context() does).
  const ROWS = [
    { id: "idle", label: "idle task", kind: "task", tint: "task" },
    { id: "working", label: "working (Running)", kind: "task", tint: "warm", active: true, orbit: 1.1, progress: 0.62 },
    { id: "glow", label: "working + Extra glow", kind: "task", tint: "warm", active: true, orbit: 1.1, progress: 0.62, extraGlow: true },
    { id: "hover", label: "hover (lift .5)", kind: "task", tint: "task", hover: true },
    { id: "selected", label: "selected (search match)", kind: "task", tint: "task", selected: true },
    { id: "chosen", label: "chosen (clicked)", kind: "task", tint: "task", selected: true, chosen: true },
    { id: "verifying", label: "verifying", kind: "task", tint: "verify" },
    { id: "done", label: "done", kind: "session", tint: "done" },
    { id: "blocked", label: "blocked (amber)", kind: "task", tint: "amber" },
    { id: "stale", label: "stale", kind: "session", tint: "stale" },
    { id: "todo", label: "todo", kind: "todo", tint: "pending" },
    { id: "agent-running", label: "agent running (watcher)", kind: "agent", role: "watcher", status: "running", active: true },
    { id: "agent-queued", label: "agent queued (auditor)", kind: "agent", role: "auditor", status: "queued" },
    { id: "agent-error", label: "agent error (keeper)", kind: "agent", role: "keeper", status: "error" },
    { id: "hub", label: "hub \"M\"", kind: "assistant", tint: "assistant" },
    { id: "music", label: "music \"♪\"", kind: "music", tint: "warm" },
    { id: "far", label: "far LOD (T1 cap)", kind: "task", tint: "task", far: true },
    { id: "far-blur", label: "far LOD, 3 px blur", kind: "task", tint: "task", far: true, blur: true },
    { id: "arrival", label: "arrival (t01 .08 … .92)", kind: "task", tint: "task", arrival: true },
  ];
  const ROW = Object.fromEntries(ROWS.map((row) => [row.id, row]));
  const RADII = [3, 4.5, 6, 8, 12, 15];
  const TIMES = [null, 0, 333, 667, 1000, 2000]; // null: reduced motion
  const ARRIVAL = [0, 1, 2, 3, 4, 5].map((step) => (step + 0.5) / 6);
  // Wires, as idle.js edgeStyleInto and the agent tether hand them over
  // (rows with rail: true, as the tree rail's railWire does).
  const node = (kind, tint, r, extra = {}) => ({ kind, tint, r, ...extra });
  const WIRES = [
    { id: "hub", label: "hub (double)", kind: "hub", tint: "task", dash: [], width: 1, alpha: 0.34, double: true, a: node("session", "session", 7), b: node("assistant", "assistant", 11) },
    { id: "task", label: "task (active, marching)", kind: "task", tint: "warm", dash: [2, 4], width: 1.4, alpha: 0.55, march: true, active: true, a: node("session", "session", 8), b: node("task", "warm", 9, { active: true }) },
    { id: "todo", label: "todo", kind: "todo", tint: "task", dash: [], width: 0.8, alpha: 0.14, a: node("session", "session", 8), b: node("todo", "pending", 4.5) },
    { id: "session", label: "session (inspected, S-curve)", kind: "session", tint: "session", dash: [], width: 1.3, alpha: 0.65, inspected: true, curved: true, a: node("session", "session", 8), b: node("session", "session", 8) },
    { id: "session-quiet", label: "session (quiet)", kind: "session", tint: "task", dash: [], width: 0.9, alpha: 0.16, a: node("session", "session", 8), b: node("session", "session", 7) },
    { id: "folded", label: "folded", kind: "folded", tint: "task", dash: [1, 5], width: 0.9, alpha: 0.22, a: node("session", "session", 8), b: node("folded", "done", 7) },
    { id: "tether", label: "agent tether (working)", kind: "tether", role: "watcher", dash: [6, 4], width: 1, alpha: 0.38, march: true, active: true, a: node("agent", null, 7, { role: "watcher", status: "running", active: true }), b: node("assistant", "assistant", 11) },
  ];
  const PULSES = [
    { id: "pulse-dot", label: "pulse dot (hub → task)", wave: false, color: "#f1dcae", glow: "#e6c98d", duration: 900, wire: WIRES[1], a: node("assistant", "assistant", 11), b: node("task", "warm", 9, { active: true }) },
    { id: "pulse-wave", label: "pulse wave + packet (agent → hub)", wave: true, packet: true, role: "watcher", glow: null, duration: 1100, wire: WIRES[6], a: WIRES[6].a, b: node("assistant", "assistant", 11) },
  ];
  WIRES.push({ id: "rail-edge", label: "rail edge (active session)", kind: "session", tint: "task", dash: [], width: 1, alpha: 0.5, active: true, rail: true, a: node("session", "session", 5), b: node("task", "warm", 5, { active: true }) });
  PULSES.push({ id: "pulse-small", label: "pulse dot small (session → todo)", small: true, wave: false, color: "#a9ffcd", glow: "#57ff9a", duration: 900, wire: WIRES[2], a: node("session", "session", 8), b: node("todo", "pending", 4.5) });
  PULSES.push({ id: "pulse-rail", label: "rail pulse dot", rail: true, wave: false, color: "#f1dcae", glow: "#e6c98d", duration: 900, wire: WIRES[WIRES.length - 1], a: node("session", "session", 5), b: node("task", "warm", 5, { active: true }) });
  // Pulse columns: still, travelling at t .5 and .92 (surge only), then
  // landed (t > 1: u = t − 1 of the 380 ms tail, land only), the order the
  // Command view draws them in.
  const PULSE_T = [null, 0.5, 0.92, 1.1, 1.4, 1.75];

  // One theme's colours: the module theme and the Command view's node tints.
  function context(themeSpec, spec) {
    const palette = themeSpec.palette;
    const theme = styles.theme(palette);
    const bg = hexRgb(palette.background);
    const light = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722 > 145;
    const warm = hexRgb(palette.bright), pending = hexRgb(palette.muted);
    const verify = light ? [59, 86, 160] : [151, 179, 244];
    const tints = {
      warm, assistant: warm, session: hexRgb(palette.text), pending, stale: hexRgb(palette.dim), verify,
      task: pending.map((value, index) => Math.round(value * 0.6 + verify[index] * 0.4)),
      done: [104, 236, 164], amber: [255, 212, 121], dust: [157, 183, 255],
    };
    const roles = new Map();
    const agentHex = (role) => look.AGENT_COLORS?.[role] ?? "#e6c98d";
    const agentTint = (role) => {
      let triple = roles.get(role);
      if (!triple) { triple = hexRgb(agentHex(role)); roles.set(role, triple); }
      return triple;
    };
    const tintOf = (row) => {
      if (row.kind === "agent") return row.status === "error" ? tints.amber : row.status === "done" ? tints.done : row.status === "queued" ? tints.pending : agentTint(row.role);
      return tints[row.tint] ?? tints.session;
    };
    return { key: themeSpec.key, name: themeSpec.name, palette, theme, bg, light, tints, text: hexRgb(palette.text), agentHex, agentTint, tintOf, skips: spec.agentDressSkips ?? [] };
  }

  // A cell's motion record: warmed WARM_FRAMES at 30 Hz in the row's state
  // (clock, work, lit and sel settle), then stepped at 30 Hz to t. Reduced
  // motion steps the same frames with still set, so the levels land at once
  // and the clock holds. A hover is caught HOVER_S after it began.
  function flagsOf(row, style) {
    return {
      style, active: row.active === true, selected: row.selected === true || row.chosen === true, lift: row.chosen === true ? 1 : 0,
      progress: Number.isFinite(row.progress) ? row.progress : null, orbit: Number.isFinite(row.orbit) ? row.orbit : 0,
      status: row.kind === "agent" ? row.status ?? null : null, time: 0, frame: 0,
    };
  }
  function recordAt(row, style, t, still, id = row.id) {
    const record = styles.motionRecord(new Map(), `sheet:${id}`);
    const flags = flagsOf(row, style);
    const frames = Math.round((t ?? 0) / FRAME_MS);
    for (let frame = -WARM_FRAMES; frame < frames; frame += 1) {
      flags.time = (frame + 1) * FRAME_MS; flags.frame = frame + WARM_FRAMES;
      styles.stepMotion(record, flags, FRAME, still);
    }
    if (row.hover) {
      flags.selected = true; flags.lift = 1; flags.time = t ?? 0;
      styles.stepMotion(record, flags, HOVER_S, still);
    }
    return record;
  }
  // The same record one 30 Hz frame on (strips, the gradient scene).
  function stepOn(record, row, style, time, still, frames = 1) {
    const flags = flagsOf(row, style);
    if (row.hover) { flags.selected = true; flags.lift = 1; }
    for (let frame = 0; frame < frames; frame += 1) {
      flags.time = time - (frames - frame - 1) * FRAME_MS;
      styles.stepMotion(record, flags, FRAME, still);
    }
    return record;
  }

  // One node surface as drawFrame paints it: nodeVisualProfile's alpha (.65
  // at rest, 1 lifted, working or the hub), the detail tier under its cap
  // (1 on the far layer; a lit node one above), and the paint options.
  function paintNode(ctx, c, style, p, r, row, record, time, still, fade = 1) {
    const tint = c.tintOf(row);
    const selected = row.selected === true || row.hover === true || row.chosen === true;
    const active = row.active === true;
    const always = active || row.kind === "assistant";
    const lift = always ? 1 : Number.isFinite(record.lift) ? record.lift : 0;
    const surfaceAlpha = Math.max(0.35, 0.65 + 0.35 * lift);
    const lit = active || selected;
    const cap = row.far ? 1 : 3;
    const detail = styles.tier(r, lit ? cap + 1 : cap);
    record.tint = tint;
    const monogram = row.kind === "assistant" || row.kind === "music";
    styles.paint(ctx, style, p, r, tint, {
      kind: row.kind, selected, chosen: row.chosen === true, active, alpha: fade * surfaceAlpha,
      glyph: monogram || row.kind === "agent" && r >= 4.5, monogram, motion: record, time, still, detail,
      extraGlow: row.extraGlow === true, theme: c.theme,
    });
    return { tint, selected, active, surfaceAlpha, detail, fade, time };
  }

  const mark = (notes, hook, drawn, fallback) => {
    const entry = notes[hook] ??= { module: 0, legacy: 0, none: 0 };
    if (drawn) entry.module += 1;
    else if (fallback) entry.legacy += 1;
    else entry.none += 1;
  };
  // The Command view's own drawings for a hook that declines (idle.js at W1).
  function legacyOrbit(ctx, p, ring, phase) {
    ctx.save(); ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(125,178,255,0.22)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU); ctx.stroke();
    for (let segment = 2; segment >= 0; segment -= 1) {
      ctx.strokeStyle = `rgba(125,178,255,${0.8 - segment * 0.24})`; ctx.lineWidth = 2.6 - segment * 0.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase - (segment + 1) * 0.62, phase - segment * 0.62); ctx.stroke();
    }
    ctx.restore();
  }
  function legacyRing(ctx, c, p, radius, ring, tint, status, time, still) {
    const amber = c.tints.amber, done = c.tints.done;
    if (status === "running") {
      const phase = still ? 0 : time / 380;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase, phase + Math.PI * 1.3);
      ctx.strokeStyle = css(tint, 0.9); ctx.lineWidth = 1.3; ctx.stroke();
      if (!still) {
        ctx.beginPath(); ctx.arc(p.x, p.y, ring, phase + Math.PI * 1.5, phase + Math.PI * 1.7);
        ctx.strokeStyle = css(tint, 0.35); ctx.lineWidth = 1; ctx.stroke();
      }
    } else if (status === "queued") {
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU);
      ctx.strokeStyle = css(tint, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.setLineDash([]);
    } else if (status === "error") {
      ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, TAU);
      ctx.strokeStyle = css(amber, 0.85); ctx.lineWidth = 1.4; ctx.stroke();
      const bx = p.x + radius + 3, by = p.y - radius - 3;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fillStyle = "#3a2a12"; ctx.fill();
      ctx.strokeStyle = css(amber, 0.9); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = css(amber); ctx.font = `700 8px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", bx, by + 0.5);
    } else if (status === "done") {
      const bx = p.x + radius + 3, by = p.y - radius - 3;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, TAU); ctx.fillStyle = "#173025"; ctx.fill();
      ctx.strokeStyle = css(done, 0.85); ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = css(done); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(bx - 2.6, by); ctx.lineTo(bx - 0.8, by + 1.9); ctx.lineTo(bx + 2.6, by - 2); ctx.stroke();
    }
  }
  function legacyHub(ctx, p, radius, tint, breathe) {
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 5 + breathe * 2.5, 0, TAU);
    ctx.strokeStyle = css(tint, 0.18 + breathe * 0.14); ctx.lineWidth = 1; ctx.stroke();
  }

  // Everything drawFrame's node loop draws after the surface, in its order:
  // arrival (arrival cells only), selection, work orbit, agent glyph and
  // status ring, hub dress. `legacy` false keeps only what the module drew
  // (strips and metrics). `call` wraps each module call for the metrics.
  const direct = (_name, run) => run();
  function overlays(ctx, c, style, p, r, row, record, info, still, notes, legacy = true, call = direct) {
    const { tint, selected, active, surfaceAlpha, detail, fade, time } = info;
    const theme = c.theme;
    if (selected || row.chosen === true || record.sel > 0.01) {
      const overlay = { kind: row.kind, selected, chosen: row.chosen === true, hover: row.hover === true, active, alpha: fade * surfaceAlpha, time, still, detail, motion: record, theme };
      mark(notes, "select", call("select", () => styles.select(ctx, style, p, r, tint, overlay)), false);
    }
    if (row.orbit) {
      const phase = still ? Math.PI / 3 : time / 1100 * TAU, ring = r + 9;
      const drawn = call("orbit", () => styles.orbit(ctx, style, p, r, record.tint ?? null, { running: true, phase, ring, time, still, motion: record, theme }));
      if (!drawn && legacy) legacyOrbit(ctx, p, ring, phase);
      mark(notes, "orbit", drawn, legacy);
    }
    if (row.kind === "agent" && r >= 4.5 && !c.skips.includes(style)) {
      ctx.save();
      ctx.globalAlpha = fade;
      const dress = call("glyph", () => styles.glyph(style, tint, theme));
      const scale = dress ? dress.scale : 0.7, ink = dress?.ink ?? null, gap = dress ? dress.ringGap : 3.5;
      look.agentGlyph(ctx, row.role, p.x, p.y, r * scale, ink ?? look.glyphInk(c.agentHex(row.role)) ?? "#0b1016");
      const ring = r + gap;
      const drawn = call("ring", () => styles.ring(ctx, style, p, r, tint, { status: row.status ?? null, builder: false, ring, time, still, motion: record, theme }));
      if (!drawn && legacy) legacyRing(ctx, c, p, r, ring, tint, row.status, time, still);
      mark(notes, "ring", drawn, legacy);
      ctx.restore();
    }
    if (row.kind === "assistant") {
      const breathe = still ? 0.5 : (Math.sin(time / 1900) + 1) / 2;
      ctx.save();
      ctx.globalAlpha = fade;
      const drawn = call("hubDress", () => styles.hubDress(ctx, style, p, r, tint, { crew: false, breathe, time, still, motion: record, theme }));
      if (!drawn && legacy) legacyHub(ctx, p, r, tint, breathe);
      mark(notes, "hubDress", drawn, legacy);
      ctx.restore();
    }
  }

  // A node growing in: drawFrame scales it by easeOutBack and fades it in
  // (NODE_GROW_MS 650), then offers the style its arrival over the grow.
  function arrivalCell(ctx, c, style, p, r, row, t01, notes, call = direct) {
    const record = styles.motionRecord(new Map(), `sheet:${row.id}`);
    const flags = flagsOf(row, style);
    const frames = Math.round(t01 * GROW_MS / FRAME_MS);
    for (let frame = 0; frame < frames; frame += 1) { flags.time = (frame + 1) * FRAME_MS; flags.frame = frame; styles.stepMotion(record, flags, FRAME, false); }
    const scale = Math.max(0.01, easeOutBack(t01)), fade = Math.min(1, easeOut(t01) * 2);
    if (scale <= 0.02) return;
    const radius = r * scale, time = t01 * GROW_MS;
    const info = call("paint", () => paintNode(ctx, c, style, p, radius, row, record, time, false, fade));
    const overlay = { kind: row.kind, selected: false, chosen: false, hover: false, active: info.active, alpha: fade * info.surfaceAlpha, time, still: false, detail: info.detail, motion: record, theme: c.theme };
    mark(notes, "arrival", call("arrival", () => styles.arrival(ctx, style, p, radius, info.tint, t01, overlay)), false);
  }

  function paintEndpoint(ctx, c, style, p, spec, t, still, call = direct) {
    const row = { id: `end:${spec.kind}:${spec.r}:${spec.role ?? spec.tint}`, ...spec };
    const record = recordAt(row, style, t, still);
    const info = call("paint", () => paintNode(ctx, c, style, p, spec.r, row, record, t ?? 0, still));
    if (row.kind === "agent" && spec.r >= 4.5 && !c.skips.includes(style)) {
      const dress = styles.glyph(style, info.tint, c.theme);
      look.agentGlyph(ctx, row.role, p.x, p.y, spec.r * (dress ? dress.scale : 0.7), dress?.ink ?? look.glyphInk(c.agentHex(row.role)));
    }
  }
  function wireTint(c, spec) {
    return spec.role ? c.agentTint(spec.role) : c.tints[spec.tint] ?? c.tints.task;
  }
  function drawWire(ctx, c, style, a, b, spec, t, still, notes, call = direct) {
    const tint = wireTint(c, spec);
    const middle = (a.y + b.y) / 2;
    const o = {
      kind: spec.kind, tint, alpha: spec.alpha, width: spec.width, dash: spec.dash, march: spec.march === true && !still,
      double: spec.double === true, active: spec.active === true, inspected: spec.inspected === true, curved: spec.curved === true,
      cp: spec.curved ? { x1: a.x, y1: middle, x2: b.x, y2: middle } : null, far: false, time: t ?? 0, still,
      seed: styles.seed(`sheet:${spec.id}:b`), rA: spec.a.r, rB: spec.b.r, lifetime: 1, theme: c.theme, detail: spec.rail ? 2 : 3,
      // idle: flow on a busy task's anchor, a working tether and the hops
      // toward busy work (offered under still too); the rail's edges never.
      flow: spec.flow ?? (spec.active === true && spec.rail !== true),
    };
    if (spec.rail === true) o.rail = true;
    const drawn = call("wire", () => styles.wire(ctx, style, a, b, o));
    if (!drawn && notes) {
      ctx.strokeStyle = css(tint, spec.alpha); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (notes) mark(notes, "wire", drawn, true);
    return drawn;
  }
  // A pulse at t: t ≤ 1 travels (surge; t 1 under still), t > 1 has landed u =
  // t − 1 into its tail (land). Its colour's triple is stable per colour, as
  // idle's pulseRgb hands it over.
  const pulseRgbs = new Map();
  const pulseRgb = (color) => { let rgb = pulseRgbs.get(color); if (!rgb) { rgb = hexRgb(color); pulseRgbs.set(color, rgb); } return rgb; };
  function drawPulse(ctx, c, style, a, b, spec, t, still, notes, call = direct) {
    const color = spec.color ?? c.agentHex(spec.role);
    const landed = !still && t > 1 ? Math.min(1, t - 1) : null;
    const tt = still ? 1 : Math.min(1, t);
    const pulse = { color, glow: spec.glow ?? color, wave: spec.wave === true, packet: spec.packet === true, small: spec.small === true, start: 0, duration: spec.duration, from: { id: "sheet:a", _pr: spec.a.r }, to: { id: "sheet:b", _pr: spec.b.r } };
    const pulseLook = { kind: pulse.wave ? "wave" : "dot", time: tt * spec.duration + (landed ?? 0) * 380, still, rTo: spec.b.r, detail: spec.rail ? 2 : 3, pulse, motion: null, cp: null, theme: c.theme };
    if (spec.rail === true) pulseLook.rail = true;
    if (landed !== null || still) {
      pulse._rgb = pulseRgb(color);
      if (landed !== null) {
        const drew = call("land", () => styles.land(ctx, style, b, spec.b.r, pulse._rgb, landed, pulseLook));
        if (notes) mark(notes, "land", drew, false);
        return drew;
      }
    }
    const drawn = call("surge", () => styles.surge(ctx, style, a, b, tt, pulse, pulseLook));
    if (!drawn && notes) {
      ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt, 2.2, 0, TAU);
      ctx.fillStyle = color; ctx.fill();
    }
    if (notes) mark(notes, "surge", drawn, true);
    // Under still idle lands every pulse once, at u = 1, in the same frame.
    if (still) {
      const drew = call("land", () => styles.land(ctx, style, b, spec.b.r, pulse._rgb, 1, pulseLook));
      if (notes) mark(notes, "land", drew, false);
    }
    return drawn;
  }

  // ---------- the sheet ----------
  const LABEL_W = 184, GROUP_GAP = 10, MARGIN = 16, HEAD = 96, ROW_H = 80, BLOCK_HEAD = 40, LINE_H = 72;
  const cellWidth = (r) => 2 * (Math.max(14, Math.ceil(Math.max(2.3 * r, r + 11))) + 3);
  function layout() {
    const groups = [];
    let x = LABEL_W;
    for (const r of RADII) { const w = cellWidth(r); groups.push({ r, x, w }); x += w * TIMES.length + GROUP_GAP; }
    const width = x - GROUP_GAP + MARGIN;
    const nodesBottom = HEAD + ROWS.length * ROW_H;
    const wiresTop = nodesBottom + BLOCK_HEAD;
    const pulsesTop = wiresTop + WIRES.length * LINE_H + BLOCK_HEAD;
    const height = pulsesTop + PULSES.length * LINE_H + MARGIN;
    return { groups, width, height, nodesBottom, wiresTop, pulsesTop, lineW: (width - MARGIN - LABEL_W) / TIMES.length };
  }
  const tLabel = (t) => t === null ? "still" : String(t);
  function noteText(notes) {
    const parts = [];
    for (const [hook, entry] of Object.entries(notes)) {
      if (hook === "glyph") continue;
      const tags = [];
      if (entry.module) tags.push("✓");
      if (entry.legacy) tags.push("L");
      if (!entry.module && !entry.legacy) tags.push("–");
      parts.push(`${hook} ${tags.join("/")}`);
    }
    return parts.join("  ·  ");
  }
  function text(ctx, value, x, y, size, color, { weight = 400, align = "left", baseline = "alphabetic" } = {}) {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = baseline;
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function rowLabel(ctx, c, y, height, label, notes, swatch) {
    const ink = css(c.text, 0.94), dim = css(c.text, 0.58);
    let x = 14;
    if (swatch) {
      ctx.fillStyle = css(swatch); ctx.beginPath(); ctx.arc(x + 4, y + height / 2 - 6, 4, 0, TAU); ctx.fill();
      x += 13;
    }
    text(ctx, label, x, y + height / 2 - 2, 11.5, ink, { weight: 600 });
    const note = notes ? noteText(notes) : "";
    if (note) text(ctx, note, x, y + height / 2 + 12, 9.5, dim);
  }

  function sheet(spec) {
    const c = context(spec.theme, spec);
    const style = spec.style, dpr = spec.dpr;
    const L = layout();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(L.width * dpr); canvas.height = Math.round(L.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = c.palette.background; ctx.fillRect(0, 0, L.width, L.height);
    const ink = css(c.text, 0.94), dim = css(c.text, 0.58), rule = css(c.text, 0.07);
    text(ctx, `${spec.styleName} (${style}) — ${c.name}`, 14, 24, 16, ink, { weight: 700 });
    text(ctx, `renderer/node-styles.js v${styles.version} · ${spec.stamp} · DPR ${dpr} · every row paints through MefiNodeStyles as the Command view does`, 14, 42, 10.5, dim);
    text(ctx, "columns: r (px) × t: “still” = reduced motion; t = ms after a 4 s warm-up in the row's state, stepped at 30 Hz.   hooks: ✓ the style drew it · L the style declined and this sheet drew the Command view's fallback · – declined, nothing drawn", 14, 57, 10.5, dim);
    for (const group of L.groups) {
      const span = group.w * TIMES.length;
      text(ctx, `r = ${group.r}`, group.x + span / 2, 76, 11.5, ink, { weight: 700, align: "center" });
      TIMES.forEach((t, index) => text(ctx, tLabel(t), group.x + group.w * (index + 0.5), 90, 9, dim, { align: "center" }));
      ctx.fillStyle = rule; ctx.fillRect(group.x - GROUP_GAP / 2 - 0.5, 66, 1, L.nodesBottom - 66);
    }
    // Node rows. The blurred row paints on its own layer first, like the
    // Command view's far canvas (#idle-layer-far.focused: blur(3px)).
    ROWS.forEach((row, index) => {
      const top = HEAD + index * ROW_H, notes = {};
      let layer = null, target = ctx;
      if (row.blur) {
        layer = document.createElement("canvas");
        layer.width = canvas.width; layer.height = Math.round(ROW_H * dpr);
        target = layer.getContext("2d");
        target.scale(dpr, dpr); target.translate(0, -top);
      }
      for (const group of L.groups) {
        for (let column = 0; column < TIMES.length; column += 1) {
          const p = { x: group.x + group.w * (column + 0.5), y: top + ROW_H / 2 };
          target.save();
          if (row.arrival) {
            arrivalCell(target, c, style, p, group.r, row, ARRIVAL[column], notes);
            target.restore();
            text(ctx, ARRIVAL[column].toFixed(2).replace(/^0/, ""), p.x, top + ROW_H - 5, 8, dim, { align: "center" });
            continue;
          }
          const t = TIMES[column], still = t === null;
          const record = recordAt(row, style, t, still);
          const info = paintNode(target, c, style, p, group.r, row, record, t ?? 0, still);
          overlays(target, c, style, p, group.r, row, record, info, still, notes);
          target.restore();
        }
      }
      if (layer) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = `blur(${3 * dpr}px)`; ctx.drawImage(layer, 0, Math.round(top * dpr));
        ctx.restore();
        layer.width = 0;
      }
      ctx.fillStyle = rule; ctx.fillRect(8, top + ROW_H - 0.5, L.width - 16, 1);
      rowLabel(ctx, c, top, ROW_H, row.label, notes, c.tintOf(row));
    });
    // Wires: one row per relationship, the columns the same times.
    const block = (title, y) => text(ctx, title, 14, y - 14, 12.5, ink, { weight: 700 });
    block("wires — MefiNodeStyles.wire(); a declined wire is drawn as a plain 1 px line marked “legacy”. Columns: still, 0, 333, 667, 1000, 2000 ms", L.wiresTop);
    WIRES.forEach((spec, index) => {
      const top = L.wiresTop + index * LINE_H, notes = {};
      for (let column = 0; column < TIMES.length; column += 1) {
        const x0 = LABEL_W + column * L.lineW, t = TIMES[column], still = t === null;
        const a = { x: x0 + 34, y: top + LINE_H - 24 }, b = { x: x0 + L.lineW - 34, y: top + 24 };
        const before = notes.wire?.module ?? 0;
        ctx.save(); drawWire(ctx, c, style, a, b, spec, t, still, notes); ctx.restore();
        ctx.save(); paintEndpoint(ctx, c, style, a, spec.a, t, still); paintEndpoint(ctx, c, style, b, spec.b, t, still); ctx.restore();
        text(ctx, tLabel(t), x0 + 6, top + 11, 8.5, dim);
        if ((notes.wire?.module ?? 0) === before) text(ctx, "legacy", x0 + L.lineW - 6, top + LINE_H - 6, 8.5, dim, { align: "right" });
        if (column) { ctx.fillStyle = rule; ctx.fillRect(x0 - 0.5, top + 4, 1, LINE_H - 8); }
      }
      ctx.fillStyle = rule; ctx.fillRect(8, top + LINE_H - 0.5, L.width - 16, 1);
      rowLabel(ctx, c, top, LINE_H, spec.label, notes, wireTint(c, spec));
    });
    block("pulses — MefiNodeStyles.surge() while travelling, then land() over the 380 ms tail; a declined surge is drawn as a plain dot marked “legacy”. Columns: still (t 1, landed), t .5, .92, landed u .1, .4, .75", L.pulsesTop);
    PULSES.forEach((spec, index) => {
      const top = L.pulsesTop + index * LINE_H, notes = {};
      for (let column = 0; column < PULSE_T.length; column += 1) {
        const x0 = LABEL_W + column * L.lineW, t = PULSE_T[column], still = t === null;
        const a = { x: x0 + 34, y: top + LINE_H - 24 }, b = { x: x0 + L.lineW - 34, y: top + 24 };
        const time = still ? null : Math.round(t * spec.duration);
        const hook = !still && t > 1 ? "land" : "surge", before = notes[hook]?.module ?? 0;
        ctx.save(); drawWire(ctx, c, style, a, b, spec.wire, time, still, {}); ctx.restore();
        ctx.save(); drawPulse(ctx, c, style, a, b, spec, t, still, notes); ctx.restore();
        ctx.save(); paintEndpoint(ctx, c, style, a, spec.a, time, still); paintEndpoint(ctx, c, style, b, spec.b, time, still); ctx.restore();
        text(ctx, still ? "still" : t > 1 ? `land u ${(t - 1).toFixed(2).replace(/^0/, "")}` : `t ${String(t).replace(/^0/, "")}`, x0 + 6, top + 11, 8.5, dim);
        if ((notes[hook]?.module ?? 0) === before) text(ctx, hook === "land" ? "no landing" : "legacy", x0 + L.lineW - 6, top + LINE_H - 6, 8.5, dim, { align: "right" });
        if (column) { ctx.fillStyle = rule; ctx.fillRect(x0 - 0.5, top + 4, 1, LINE_H - 8); }
      }
      ctx.fillStyle = rule; ctx.fillRect(8, top + LINE_H - 0.5, L.width - 16, 1);
      rowLabel(ctx, c, top, LINE_H, spec.label, notes, hexRgb(spec.color ?? c.agentHex(spec.role)));
    });
    const dataURL = canvas.toDataURL("image/png");
    const size = { width: canvas.width, height: canvas.height };
    canvas.width = 0;
    return { dataURL, ...size };
  }

  // ---------- pixels ----------
  function surface(width, height, scale, fill) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, width, height); }
    return { canvas, ctx };
  }
  const pixels = ({ canvas, ctx }) => ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // Mean absolute channel change (RGB, 0..255) and the share of pixels changed.
  function change(a, b) {
    let sum = 0, changed = 0;
    for (let index = 0; index < a.length; index += 4) {
      const delta = Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]) + Math.abs(a[index + 3] - b[index + 3]);
      sum += delta; if (delta) changed += 1;
    }
    const count = a.length / 4;
    return { mean: sum / (count * 3), changed: changed / count };
  }
  // The farthest drawn pixel (alpha ≥ 4/255) from the centre, in radii.
  function reachOf(draw, r) {
    const scale = 2, half = Math.ceil(r * 3.6);
    const target = surface(half * 2, half * 2, scale, null);
    draw(target.ctx, { x: half, y: half });
    const data = pixels(target), width = target.canvas.width;
    let far = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 4) continue;
      const pixel = (index - 3) / 4, x = (pixel % width + 0.5) / scale - half, y = (Math.floor(pixel / width) + 0.5) / scale - half;
      far = Math.max(far, Math.hypot(x, y));
    }
    target.canvas.width = 0;
    return { reach: Math.round(far / r * 1000) / 1000, clipped: far >= half - 1 };
  }
  const bump = (bucket, key, value) => { if (value > bucket[key].value) bucket[key] = { value, at: bucket.at }; };

  // A working node at r 15 (the strip), stepped at 30 Hz from its warm-up:
  // `fast` frames 33.3 ms apart, `slow` frames 500 ms apart across 6 s.
  function stripFrames(c, style, size, scale, withOverlays, label) {
    const row = ROW.working, r = 15, frames = { fast: [], slow: [] };
    for (const [key, count, steps] of [["fast", 24, 1], ["slow", 12, 15]]) {
      const record = recordAt(row, style, 0, false);
      for (let frame = 0; frame < count; frame += 1) {
        if (frame) stepOn(record, row, style, frame * steps * FRAME_MS, false, steps);
        const time = frame * steps * FRAME_MS;
        const target = surface(size, size, scale, c.palette.background);
        const p = { x: size / 2, y: size / 2 };
        target.ctx.save();
        const info = paintNode(target.ctx, c, style, p, r, row, record, time, false);
        if (withOverlays) overlays(target.ctx, c, style, p, r, row, record, info, false, {}, false);
        target.ctx.restore();
        if (label) text(target.ctx, label, 5, size - 5, 7.5, css(c.text, 0.5));
        frames[key].push(target);
      }
    }
    return frames;
  }
  function sequenceChange(list) {
    const deltas = [];
    for (let index = 1; index < list.length; index += 1) deltas.push(change(pixels(list[index - 1]), pixels(list[index])).mean);
    const round = (value) => Math.round(value * 10000) / 10000;
    return { mean: round(deltas.reduce((sum, value) => sum + value, 0) / (deltas.length || 1)), min: round(Math.min(...deltas)), max: round(Math.max(...deltas)) };
  }

  function metrics(spec) {
    const c = context(spec.theme, spec);
    const style = spec.style;
    const result = { style, theme: c.key };
    const steadyRows = ROWS.filter((row) => !row.arrival && !row.blur && !row.extraGlow);

    // Reduced motion holds a designed pose: the still record after one frame
    // at t 0 and after 5 s at t 5000 paint the same pixels.
    let stillWorst = { mean: 0, changed: 0, at: null };
    for (const row of steadyRows) {
      for (const r of [8, 15]) {
        const shots = [0, 5000].map((t) => {
          const target = surface(110, 110, 1, c.palette.background), p = { x: 55, y: 55 };
          const record = recordAt(row, style, t, true);
          target.ctx.save();
          const info = paintNode(target.ctx, c, style, p, r, row, record, t, true);
          overlays(target.ctx, c, style, p, r, row, record, info, true, {}, false);
          target.ctx.restore();
          return pixels(target);
        });
        const delta = change(shots[0], shots[1]);
        if (delta.mean > stillWorst.mean || !stillWorst.at && delta.changed) stillWorst = { ...delta, at: `${row.id}@${r}` };
      }
    }
    result.still = { meanChange: Math.round(stillWorst.mean * 10000) / 10000, changedShare: Math.round(stillWorst.changed * 10000) / 10000, worst: stillWorst.at };

    // Animation: the working strip, body alone and with the style's overlays.
    const body = stripFrames(c, style, 100, 1, false, null);
    const dressed = stripFrames(c, style, 100, 1, true, null);
    result.strip = { fast: sequenceChange(body.fast), slow: sequenceChange(body.slow), fastWithOverlays: sequenceChange(dressed.fast), slowWithOverlays: sequenceChange(dressed.slow) };
    for (const list of [body.fast, body.slow, dressed.fast, dressed.slow]) for (const target of list) target.canvas.width = 0;

    // Reach, in radii, measured from pixels at r 15.
    const reach = { steady: { value: 0, at: null }, steadyWithOverlays: { value: 0, at: null }, glow: { value: 0, at: null }, arrival: { value: 0, at: null }, clipped: false };
    const r = 15;
    for (const row of steadyRows) {
      for (const t of TIMES) {
        const still = t === null;
        reach.at = `${row.id}@${tLabel(t)}`;
        const plain = reachOf((ctx, p) => { const record = recordAt(row, style, t, still); paintNode(ctx, c, style, p, r, row, record, t ?? 0, still); }, r);
        const outfit = reachOf((ctx, p) => { const record = recordAt(row, style, t, still); const info = paintNode(ctx, c, style, p, r, row, record, t ?? 0, still); overlays(ctx, c, style, p, r, row, record, info, still, {}, false); }, r);
        bump(reach, "steady", plain.reach); bump(reach, "steadyWithOverlays", outfit.reach);
        reach.clipped ||= plain.clipped || outfit.clipped;
      }
    }
    for (const id of ["idle", "working", "chosen"]) {
      const row = { ...ROW[id], extraGlow: true };
      for (const t of [null, 0, 1000]) {
        reach.at = `${id}+glow@${tLabel(t)}`;
        const measured = reachOf((ctx, p) => { const record = recordAt(row, style, t, t === null); paintNode(ctx, c, style, p, r, row, record, t ?? 0, t === null); }, r);
        bump(reach, "glow", measured.reach); reach.clipped ||= measured.clipped;
      }
    }
    for (const t01 of ARRIVAL) {
      reach.at = `arrival@${t01.toFixed(2)}`;
      const measured = reachOf((ctx, p) => arrivalCell(ctx, c, style, p, r, ROW.arrival, t01, {}), r);
      bump(reach, "arrival", measured.reach); reach.clipped ||= measured.clipped;
    }
    delete reach.at;
    reach.declared = { idle: styles.reach(style, recordAt(ROW.idle, style, 0, false)), working: styles.reach(style, recordAt(ROW.working, style, 0, false)) };
    result.reach = reach;

    // Steady frames: every row at four radii, the wires and the pulses on one
    // canvas, stepped at 30 Hz. After two warm-up frames nothing should build
    // a gradient, set shadowBlur or a filter, or leave the context changed.
    const scene = surface(1200, 900, 1, null);
    const ctx = scene.ctx;
    const sceneRows = steadyRows;
    const radii = [4.5, 8, 12, 15];
    const records = sceneRows.map((row) => radii.map(() => recordAt(row, style, 0, false)));
    const categories = ["paint", "overlays", "wires", "pulses"];
    const perFrame = [];
    const leaks = {};
    const STATE = ["globalAlpha", "globalCompositeOperation", "lineWidth", "lineCap", "lineJoin", "lineDashOffset", "fillStyle", "strokeStyle", "font", "textAlign", "textBaseline", "shadowBlur", "shadowColor", "filter"];
    const snapshot = () => { const m = ctx.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f, ctx.getLineDash().join(","), ...STATE.map((key) => String(ctx[key]))].join("|"); };
    let frameCounts = null;
    const categoryOf = (name) => name === "paint" ? "paint" : name === "wire" ? "wires" : name === "surge" || name === "land" ? "pulses" : "overlays";
    const call = (name, run) => {
      const before = snapshot(), gradientsBefore = built(), blurBefore = counts.shadowBlur, filterBefore = counts.filter;
      const value = run();
      const bucket = frameCounts[categoryOf(name)];
      bucket.gradients += built() - gradientsBefore;
      bucket.shadowBlur += counts.shadowBlur - blurBefore;
      bucket.filter += counts.filter - filterBefore;
      if (snapshot() !== before) leaks[name] = (leaks[name] ?? 0) + 1;
      return value;
    };
    const FRAMES = 14, WARM = 2;
    for (let frame = 0; frame < FRAMES; frame += 1) {
      const time = frame * FRAME_MS;
      frameCounts = Object.fromEntries(categories.map((key) => [key, { gradients: 0, shadowBlur: 0, filter: 0 }]));
      ctx.clearRect(0, 0, 1200, 900);
      sceneRows.forEach((row, rowIndex) => {
        radii.forEach((radius, column) => {
          const record = records[rowIndex][column];
          if (frame) stepOn(record, row, style, time, false);
          const p = { x: 40 + (rowIndex % 6) * 190 + column * 44, y: 50 + Math.floor(rowIndex / 6) * 90 };
          const info = call("paint", () => paintNode(ctx, c, style, p, radius, row, record, time, false));
          overlays(ctx, c, style, p, radius, row, record, info, false, {}, false, call);
        });
      });
      WIRES.forEach((spec, index) => {
        const a = { x: 30 + index * 160, y: 800 }, b = { x: 150 + index * 160, y: 740 };
        drawWire(ctx, c, style, a, b, spec, time, false, null, call);
      });
      PULSES.forEach((spec, index) => {
        const a = { x: 30 + index * 300, y: 880 }, b = { x: 280 + index * 300, y: 840 };
        drawPulse(ctx, c, style, a, b, spec, (time % spec.duration) / spec.duration * 0.6 + 0.35, false, null, call);
      });
      perFrame.push(frameCounts);
    }
    const steady = perFrame.slice(WARM);
    const worst = (key, field) => Math.max(...steady.map((entry) => entry[key][field]));
    result.steadyFrames = {
      frames: steady.length,
      gradientsPerFrame: Object.fromEntries(categories.map((key) => [key, worst(key, "gradients")])),
      shadowBlurPerFrame: Object.fromEntries(categories.map((key) => [key, worst(key, "shadowBlur")])),
      filterPerFrame: Object.fromEntries(categories.map((key) => [key, worst(key, "filter")])),
      warmUpGradients: perFrame.slice(0, WARM).map((entry) => categories.reduce((sum, key) => sum + entry[key].gradients, 0)),
      stateLeaks: leaks,
      cache: styles.cacheStats(ctx),
    };
    scene.canvas.width = 0;

    // Extra glow on its own: gradients per frame once warm.
    const glowScene = surface(200, 100, 1, null);
    const glowRows = [{ ...ROW.working, extraGlow: true }, { ...ROW.idle, extraGlow: true }];
    const glowRecords = glowRows.map((row) => recordAt(row, style, 0, false));
    const glowCounts = [];
    for (let frame = 0; frame < 6; frame += 1) {
      const before = built();
      glowRows.forEach((row, index) => {
        if (frame) stepOn(glowRecords[index], row, style, frame * FRAME_MS, false);
        paintNode(glowScene.ctx, c, style, { x: 50 + index * 100, y: 50 }, 12, row, glowRecords[index], frame * FRAME_MS, false);
      });
      glowCounts.push(built() - before);
    }
    result.extraGlowGradientsPerFrame = Math.max(...glowCounts.slice(WARM));
    glowScene.canvas.width = 0;
    return result;
  }

  // The strip for the GIFs: the working node at r 15 with the style's own
  // overlays, drawn three times up; plus one contact sheet of every frame.
  function strip(spec) {
    const c = context(spec.theme, spec);
    const style = spec.style, zoom = 3, size = 100;
    const frames = stripFrames(c, style, size, zoom, true, `${style} · working r 15 · ×3`);
    const tile = 150, columns = 12, labelH = 16, head = 40;
    const rows = Math.ceil(frames.fast.length / columns) + Math.ceil(frames.slow.length / columns);
    const contact = surface(columns * tile + 20, head + rows * (tile + labelH) + 10, 1, c.palette.background);
    const ink = css(c.text, 0.94), dim = css(c.text, 0.58);
    text(contact.ctx, `${spec.styleName} (${style}) — ${c.name} — working node, r 15, drawn ×3`, 10, 18, 13, ink, { weight: 700 });
    text(contact.ctx, `rows 1–2: 24 frames 33.3 ms apart · row 3: 12 frames 500 ms apart (6 s) · ${spec.stamp}`, 10, 33, 10, dim);
    let slot = 0;
    for (const [key, step] of [["fast", FRAME_MS], ["slow", 500]]) {
      frames[key].forEach((target, index) => {
        const x = 10 + (slot % columns) * tile, y = head + Math.floor(slot / columns) * (tile + labelH);
        contact.ctx.drawImage(target.canvas, x, y, tile, tile);
        text(contact.ctx, `${Math.round(index * step)} ms`, x + tile / 2, y + tile + 11, 9, dim, { align: "center" });
        slot += 1;
      });
      slot = Math.ceil(slot / columns) * columns;
    }
    const result = {
      fast: frames.fast.map((target) => target.canvas.toDataURL("image/png")),
      slow: frames.slow.map((target) => target.canvas.toDataURL("image/png")),
      contact: contact.canvas.toDataURL("image/png"),
    };
    for (const target of [...frames.fast, ...frames.slow, contact]) target.canvas.width = 0;
    return result;
  }

  window.__nodeSheet = { sheet, strip, metrics, version: styles.version, styles: [...styles.STYLES] };
}

function save(name, dataURL) {
  const prefix = "data:image/png;base64,";
  if (typeof dataURL !== "string" || !dataURL.startsWith(prefix)) throw new Error(`${name}: the page returned no PNG`);
  const file = path.join(outputs, `${name}.b64`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dataURL.slice(prefix.length));
  report.outputs.push({ name, file });
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith("data:");
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL("data:text/html,<html></html>");
  const run = (expression) => window.webContents.executeJavaScript(expression);
  // The painters load whole, as the booklet bundles them; tree3d.js's agent
  // palette and glyphs load as the slices tests/command_visuals.test.mjs uses.
  const { sources } = job;
  await run(`${sources.nodeStyles}\n;(function () {\n${sources.agentColors}\n${sources.agentGlyphs}\n  window.__agentLook = { AGENT_COLORS, agentGlyph, glyphInk };\n})();\n;(${pageSetup.toString()})();\ntrue`);
  report.version = await run("window.__nodeSheet.version");
  const common = { stamp: job.stamp, agentDressSkips: job.agentDressSkips ?? [] };
  const call = (method, spec) => run(`window.__nodeSheet.${method}(${JSON.stringify({ ...common, ...spec })})`);
  for (const style of job.styles) {
    const styleName = job.styleNames?.[style] ?? style;
    for (const theme of job.themes) {
      console.log(`metrics ${style} ${theme.key}`);
      report.metrics.push(await call("metrics", { style, styleName, theme }));
      for (const dpr of job.dprs) {
        console.log(`sheet ${style} ${theme.key} dpr ${dpr}`);
        const result = await call("sheet", { style, styleName, theme, dpr });
        save(`sheet-${style}-${theme.key}${dpr === 1 ? "" : `@${dpr}x`}`, result.dataURL);
      }
    }
    if (job.strips) {
      console.log(`strip ${style}`);
      const result = await call("strip", { style, styleName, theme: job.themes[0] });
      result.fast.forEach((dataURL, index) => save(`strip-${style}/fast-${String(index).padStart(2, "0")}`, dataURL));
      result.slow.forEach((dataURL, index) => save(`strip-${style}/slow-${String(index).padStart(2, "0")}`, dataURL));
      save(`strip-${style}`, result.contact);
    }
  }
  await finish();
}).catch(finish);
