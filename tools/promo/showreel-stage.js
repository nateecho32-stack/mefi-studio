// Showreel: a 20-second motion piece drawn with the Studio's own node painters
// (renderer/node-styles.js), agent glyphs (tree3d.js) and the Void theme's
// canvas palette (music.js), injected by showreel.cjs before this script runs.
// window.seek(t) draws the frame at t seconds; nothing animates on its own.
/* global MefiNodeStyles, __agentLook, __palette, __themeInfo */
(() => {
  "use strict";
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const styles = window.MefiNodeStyles;
  const look = window.__agentLook;
  const palette = window.__palette;
  const info = window.__themeInfo;
  const theme = styles.theme(palette);
  const DURATION = 20;

  const DISPLAY = '"Bahnschrift", "Segoe UI", sans-serif';
  const MONO = '"Cascadia Mono", "Consolas", monospace';
  const SERIF = 'Georgia, "Times New Roman", serif';

  // ---- colour --------------------------------------------------------------
  const hex = (value) => {
    const text = String(value).replace("#", "");
    const n = parseInt(text.length === 3 ? text.split("").map((c) => c + c).join("") : text.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (triple, a = 1) => `rgba(${triple[0]},${triple[1]},${triple[2]},${a})`;
  const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const BG = hex(info.bg), INK = hex(info.text), MUTED = hex(info.muted);
  const ACCENT = hex(info.accent), BRIGHT = hex(info.bright), ACCENT2 = hex(info.accent2);
  const DONE = [104, 236, 164], AMBER = [255, 212, 121];
  const TINT = {
    hub: BRIGHT, session: INK, task: mixc(MUTED, [151, 179, 244], 0.4), warm: BRIGHT,
    pending: MUTED, done: DONE, amber: AMBER, verify: [151, 179, 244],
  };

  // ---- time ----------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const expoOut = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
  const expoInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2);
  const backOut = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }

  // Scene cuts (seconds), on the score's 0.4 s beat (150 BPM): the score lands
  // an impact on each, and every style and slammed word takes one beat.
  const CUTS = { ignite: 0, wall: 2.0, tree: 4.0, styles: 7.2, crew: 10.4, flow: 12.8, slam: 15.2, end: 16.8 };
  window.__cuts = CUTS;
  window.__duration = DURATION;

  // ---- node painting through the Studio's painters --------------------------
  // Painters are tuned for 3–15 px nodes; bigger nodes are painted at 14 px
  // under a scale, so every stroke keeps its proportion.
  const records = new Map();
  let lastT = -1;
  const PAINT_R = 14;
  function recordFor(id, style, flags, t) {
    let entry = records.get(id);
    if (!entry || entry.style !== style) {
      entry = { style, record: styles.motionRecord(new Map(), `reel:${id}:${style}`), at: t };
      // warm the motion clock a second in, at 60 Hz
      const f = { style, active: false, selected: false, lift: 0, progress: null, orbit: 0, status: null, stale: false, time: 0, frame: 0, ...flags };
      for (let i = 0; i < 60; i += 1) { f.time = (t - 1 + i / 60) * 1000; f.frame = i; styles.stepMotion(entry.record, f, 1 / 60, false); }
      records.set(id, entry);
    }
    return entry;
  }
  function node(id, style, x, y, r, o = {}) {
    const t = o.t ?? now;
    const flags = {
      style, active: o.active === true, selected: o.selected === true, lift: o.selected ? 1 : 0, progress: o.progress ?? null,
      orbit: o.orbit ?? 0, status: o.status ?? null, stale: false, time: t * 1000, frame: Math.round(t * 60),
    };
    const entry = recordFor(id, style, flags, t);
    styles.stepMotion(entry.record, flags, frameDt, false);
    const tint = o.tint ?? TINT.task;
    entry.record.tint = tint;
    const k = r / PAINT_R;
    const p = { x: 0, y: 0 };
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.globalAlpha = o.alpha ?? 1;
    const lit = o.active || o.selected;
    const monogram = o.kind === "assistant";
    styles.paint(ctx, style, p, PAINT_R, tint, {
      kind: o.kind ?? "task", selected: o.selected === true, chosen: false, active: o.active === true, stale: false,
      alpha: o.alpha ?? 1, glyph: monogram || o.kind === "agent", monogram, motion: entry.record, time: t * 1000,
      still: false, detail: styles.tier(PAINT_R, lit ? 4 : 3), extraGlow: o.glow === true, theme,
    });
    if (o.arrive != null && o.arrive < 1) {
      styles.arrival(ctx, style, p, PAINT_R, tint, o.arrive, { kind: o.kind ?? "task", selected: false, chosen: false, hover: false, active: o.active === true, alpha: 1, time: t * 1000, still: false, detail: 3, motion: entry.record, theme });
    }
    if (o.orbit) styles.orbit(ctx, style, p, PAINT_R, tint, { running: true, phase: t * 1000 / 1100 * TAU, ring: PAINT_R + 9, time: t * 1000, still: false, motion: entry.record, theme });
    if (o.kind === "agent") {
      const dress = styles.glyph(style, tint, theme);
      const scale = dress ? dress.scale : 0.7, gap = dress ? dress.ringGap : 3.5;
      look.agentGlyph(ctx, o.role, 0, 0, PAINT_R * scale, dress?.ink ?? look.glyphInk(look.AGENT_COLORS[o.role]) ?? "#0b1016");
      styles.ring(ctx, style, p, PAINT_R, tint, { status: o.status ?? "running", builder: false, ring: PAINT_R + gap, time: t * 1000, still: false, motion: entry.record, theme });
    }
    if (o.kind === "assistant") {
      styles.hubDress(ctx, style, p, PAINT_R, tint, { crew: o.crew === true, breathe: (Math.sin(t * 1000 / 1900) + 1) / 2, time: t * 1000, still: false, motion: entry.record, theme });
    }
    ctx.restore();
  }
  function wire(style, a, b, o = {}) {
    const middle = (a.y + b.y) / 2;
    const cp = o.curved === false ? null : o.horizontal ? { x1: (a.x + b.x) / 2, y1: a.y, x2: (a.x + b.x) / 2, y2: b.y } : { x1: a.x, y1: middle, x2: b.x, y2: middle };
    const k = o.scale ?? 1;
    ctx.save();
    ctx.globalAlpha = o.fade ?? 1;
    // Wires are drawn at the stage's scale: widths are in the painter's px.
    ctx.lineWidth = 1;
    const look_ = {
      kind: o.kind ?? "session", tint: o.tint ?? TINT.task, alpha: o.alpha ?? 0.5, width: (o.width ?? 1) * k, dash: o.dash ?? [], march: o.march === true,
      double: o.double === true, active: o.active === true, inspected: o.inspected === true, curved: Boolean(cp), cp, far: false,
      time: now * 1000, still: false, seed: styles.seed(`reel:${o.id ?? "w"}`), rA: o.rA ?? 0, rB: o.rB ?? 0, lifetime: 1, theme, detail: 3,
      flow: o.flow ?? o.active === true,
    };
    if (!styles.wire(ctx, style, a, b, look_)) {
      ctx.strokeStyle = rgba(look_.tint, look_.alpha); ctx.lineWidth = look_.width;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      if (cp) ctx.bezierCurveTo(cp.x1, cp.y1, cp.x2, cp.y2, b.x, b.y); else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
    return cp;
  }
  function pulse(style, a, b, u, o = {}) {
    if (u <= 0) return;
    const color = o.color ?? "#" + BRIGHT.map((v) => v.toString(16).padStart(2, "0")).join("");
    const p = { color, glow: o.glow ?? color, wave: o.wave === true, packet: o.packet === true, small: o.small === true, start: 0, duration: 900, from: { id: "a", _pr: o.rA ?? 8 }, to: { id: "b", _pr: o.rB ?? 8 } };
    const pl = { kind: p.wave ? "wave" : "dot", time: Math.min(1, u) * 900, still: false, rTo: o.rB ?? 8, detail: 3, pulse: p, motion: null, cp: o.cp ?? null, theme };
    if (u <= 1) {
      if (!styles.surge(ctx, style, a, b, u, p, pl)) {
        ctx.beginPath(); ctx.arc(lerp(a.x, b.x, u), lerp(a.y, b.y, u), 3, 0, TAU); ctx.fillStyle = color; ctx.fill();
      }
    } else if (u < 2) {
      p._rgb = hex(color);
      pl.time = 900 + (u - 1) * 380;
      styles.land(ctx, style, b, o.rB ?? 8, p._rgb, u - 1, pl);
    }
  }

  // ---- type ----------------------------------------------------------------
  function font(size, weight = 700, family = DISPLAY, stretch = "normal") {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fontStretch = stretch;
  }
  function text(str, x, y, o = {}) {
    font(o.size ?? 40, o.weight ?? 700, o.family ?? DISPLAY, o.stretch ?? "normal");
    ctx.textAlign = o.align ?? "left"; ctx.textBaseline = o.base ?? "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${o.track ?? 0}px`;
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth ?? 2; ctx.strokeText(str, x, y); }
    if (o.fill !== null) { ctx.fillStyle = o.fill ?? rgba(INK); ctx.fillText(str, x, y); }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
  // Letters rising out of a mask, one after another.
  function riseText(str, x, y, u, o = {}) {
    font(o.size ?? 40, o.weight ?? 700, o.family ?? DISPLAY, o.stretch ?? "normal");
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${o.track ?? 0}px`;
    const total = ctx.measureText(str).width;
    let cx = o.align === "center" ? x - total / 2 : o.align === "right" ? x - total : x;
    const size = o.size ?? 40;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 20, y - size * 1.05, total + 40, size * 1.3); ctx.clip();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const letters = [...str];
    letters.forEach((ch, i) => {
      const w = ctx.measureText(ch).width;
      const local = expoOut(clamp(u * (1 + letters.length * (o.stagger ?? 0.06)) - i * (o.stagger ?? 0.06)));
      ctx.fillStyle = o.fill ?? rgba(INK);
      ctx.fillText(ch, cx, y + (1 - local) * size * 1.1);
      cx += w;
    });
    ctx.restore();
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
  function scramble(str, u, seed) {
    const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#%+";
    const r = rng(seed + Math.floor(now * 30));
    return [...str].map((ch, i) => (ch === " " || u * str.length * 1.4 > i + 3 ? ch : glyphs[Math.floor(r() * glyphs.length)])).join("");
  }

  // ---- HUD frame, always on -------------------------------------------------
  function timecode(t) {
    const f = Math.floor(t * 60) % 60, s = Math.floor(t) % 60;
    return `00:00:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }
  let hudInk = INK;
  function hud(t, label, index) {
    const u = expoOut(span(t, 0.1, 1.1));
    const m = 44;
    ctx.save();
    ctx.globalAlpha = 0.9 * u;
    ctx.strokeStyle = rgba(hudInk, 0.55); ctx.lineWidth = 1.5;
    const arm = 26 * u;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * arm); ctx.lineTo(x, y); ctx.lineTo(x + sx * arm, y); ctx.stroke();
    }
    const small = { size: 15, weight: 500, family: MONO, fill: rgba(hudInk, 0.72), track: 2 };
    text("MEFI'S STUDIO AI+", m + 40, m + 20, small);
    text("SHOWREEL · 2026", m + 40, m + 42, { ...small, fill: rgba(hudInk, 0.42) });
    text(`${String(index).padStart(2, "0")} · ${label}`, W - m - 40, m + 20, { ...small, align: "right" });
    text(`THEME · ${info.name.toUpperCase()}`, W - m - 40, m + 42, { ...small, align: "right", fill: rgba(hudInk, 0.42) });
    text(timecode(t), m + 40, H - m - 14, small);
    text("1920×1080 · 60", m + 250, H - m - 14, { ...small, fill: rgba(hudInk, 0.42) });
    // progress ticks
    const bx = W - m - 40 - 300, by = H - m - 20;
    for (let i = 0; i < 40; i += 1) {
      const on = i / 40 < t / DURATION;
      ctx.fillStyle = rgba(hudInk, on ? 0.8 : 0.2);
      ctx.fillRect(bx + i * 7.5, by - (i % 5 === 0 ? 10 : 6), 2, i % 5 === 0 ? 10 : 6);
    }
    ctx.restore();
  }
  function grain(t, amount = 0.06) {
    const r = rng(Math.floor(t * 60) * 7919);
    ctx.save();
    for (let i = 0; i < 1400; i += 1) {
      ctx.fillStyle = r() < 0.5 ? `rgba(255,255,255,${amount * r()})` : `rgba(0,0,0,${amount * 1.6 * r()})`;
      ctx.fillRect(r() * W, r() * H, 2, 2);
    }
    ctx.restore();
  }
  function vignette(strength = 0.55) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function starfield(t, drift = 1, alpha = 1, seed = 11) {
    const r = rng(seed);
    for (let i = 0; i < 260; i += 1) {
      const z = 0.2 + r() * 0.8;
      const x = ((r() * W + t * 14 * z * drift) % W + W) % W, y = r() * H;
      ctx.fillStyle = rgba(INK, (0.05 + 0.3 * z * r()) * alpha);
      ctx.fillRect(x, y, z * 2, z * 2);
    }
  }
  function flash(t, at, len = 0.12, color = [255, 255, 255]) {
    const u = span(t, at, at + len);
    if (u <= 0 || u >= 1) return;
    ctx.fillStyle = rgba(color, 0.55 * (1 - u));
    ctx.fillRect(0, 0, W, H);
  }

  // ---- scenes --------------------------------------------------------------
  function sceneIgnite(t) {
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    starfield(t, 0.4, easeOut(span(t, 0.2, 1.5)));
    const cx = W / 2, cy = H / 2 - 20;
    // expanding rings off the ignition
    for (let i = 0; i < 4; i += 1) {
      const u = span(t, 0.35 + i * 0.16, 1.9 + i * 0.16);
      if (u <= 0 || u >= 1) continue;
      ctx.beginPath(); ctx.arc(cx, cy, 40 + easeOut(u) * (420 + i * 90), 0, TAU);
      ctx.strokeStyle = rgba(i % 2 ? ACCENT2 : ACCENT, 0.5 * (1 - u)); ctx.lineWidth = 2 - u; ctx.stroke();
    }
    // crosshair lines drawing in
    const lu = expoInOut(span(t, 0.05, 0.9));
    ctx.strokeStyle = rgba(INK, 0.14); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 900 * lu, cy); ctx.lineTo(cx + 900 * lu, cy); ctx.moveTo(cx, cy - 480 * lu); ctx.lineTo(cx, cy + 480 * lu); ctx.stroke();
    const grow = span(t, 0.3, 1.1);
    const r = 92 * Math.max(0.01, backOut(grow));
    if (grow > 0) node("hub", "singularity", cx, cy, r, { kind: "assistant", tint: TINT.hub, active: true, arrive: grow, glow: true });
    // title bar underneath
    const tu = span(t, 0.9, 1.7);
    riseText("ONE PROMPT. A WHOLE CREW.", cx, cy + 220, tu, { size: 34, weight: 600, align: "center", track: 10, fill: rgba(INK, 0.9) });
    const lineU = expoOut(span(t, 1.1, 1.9));
    ctx.fillStyle = rgba(ACCENT, 0.9); ctx.fillRect(cx - 150 * lineU, cy + 246, 300 * lineU, 2);
    // the exit: everything collapses into the hub's core
    const out = easeIn(span(t, 1.8, 2.0));
    if (out > 0) { ctx.fillStyle = rgba(BG, out); ctx.fillRect(0, 0, W, H); }
  }

  function sceneWall(t) {
    const lt = t - CUTS.wall;
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    const words = ["PLAN", "BUILD", "CHECK", "SHIP"];
    const slot = 0.4;
    const idx = Math.min(words.length - 1, Math.floor(lt / slot));
    const into = Math.min(1, (lt - idx * slot) / slot);
    const word = words[idx];
    const rows = 9, rowH = 128;
    font(150, 800, DISPLAY, "condensed");
    for (let row = 0; row < rows; row += 1) {
      const y = H / 2 + (row - (rows - 1) / 2) * rowH + 52;
      const dir = row % 2 ? 1 : -1;
      const center = row === (rows - 1) / 2;
      const unit = `${word}  `;
      font(150, 800, DISPLAY, "condensed");
      const w = ctx.measureText(unit).width;
      const off = ((dir * lt * (160 + Math.abs(row - 4) * 40)) % w + w) % w;
      const dist = Math.abs(row - (rows - 1) / 2);
      for (let x = -w * 2 + off; x < W + w; x += w) {
        if (center) continue;
        text(unit, x, y, { size: 150, weight: 800, stretch: "condensed", fill: null, stroke: rgba(INK, 0.32 - dist * 0.055), lineWidth: 1.4 });
      }
    }
    // the centre row: one solid word, rolled in from below on each change
    const cy = H / 2 + 52;
    ctx.save();
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, cy - 124, W, 150);
    ctx.beginPath(); ctx.rect(0, cy - 130, W, 162); ctx.clip();
    const roll = expoOut(clamp(into * 3));
    const prev = idx > 0 ? words[idx - 1] : null;
    if (prev && roll < 1) text(prev, W / 2, cy - roll * 170, { size: 170, weight: 800, stretch: "condensed", align: "center", fill: rgba(INK) });
    text(word, W / 2, cy + (1 - roll) * 170, { size: 170, weight: 800, stretch: "condensed", align: "center", fill: rgba(idx === words.length - 1 ? ACCENT2 : INK) });
    ctx.restore();
    // caption tag
    text(scramble(`STAGE ${idx + 1}/4 · ${["THE PLANNER DRAFTS", "BUILDERS WRITE CODE", "THE VERIFIER RUNS TESTS", "YOU APPROVE, IT LANDS"][idx]}`, clamp(into * 2), 77 + idx), W / 2, cy + 90, { size: 18, weight: 500, family: MONO, align: "center", track: 3, fill: rgba(BRIGHT, 0.9) });
    // wipe out: a band sweeps across
    const wipe = expoInOut(span(lt, 1.78, 2.0));
    if (wipe > 0) { ctx.fillStyle = rgba(ACCENT); ctx.fillRect(-W * 0.2 + wipe * W * 1.4 - W, 0, W, H); ctx.fillStyle = rgba(BG); ctx.fillRect(-W * 0.2 + wipe * W * 1.4 - W * 2 + 60, 0, W, H); }
  }

  // The tree: hub → three sessions → tasks → todos, grown in with S-curves.
  const TREE = (() => {
    const hub = { id: "t-hub", x: 330, y: 630, r: 34, kind: "assistant", tint: TINT.hub, at: 0 };
    const sessions = [
      { id: "s1", x: 760, y: 440, r: 20, kind: "session", tint: TINT.session, at: 0.25 },
      { id: "s2", x: 760, y: 630, r: 22, kind: "session", tint: TINT.warm, at: 0.35, active: true },
      { id: "s3", x: 760, y: 820, r: 20, kind: "session", tint: TINT.session, at: 0.45 },
    ];
    const tasks = [];
    const todos = [];
    const r = rng(5);
    const tints = [TINT.done, TINT.warm, TINT.task, TINT.verify, TINT.done, TINT.amber, TINT.task, TINT.done, TINT.warm];
    sessions.forEach((s, si) => {
      for (let k = 0; k < 3; k += 1) {
        const id = `k${si}${k}`;
        const y = s.y + (k - 1) * 60;
        const task = { id, parent: s, x: 1160, y, r: 15, kind: "task", tint: tints[si * 3 + k], at: 0.7 + si * 0.14 + k * 0.08, active: tints[si * 3 + k] === TINT.warm };
        tasks.push(task);
        const count = 2 + Math.floor(r() * 2);
        for (let j = 0; j < count; j += 1) {
          todos.push({ id: `${id}t${j}`, parent: task, x: 1480 + j * 58 + (si % 2) * 20, y: y + (j - (count - 1) / 2) * 19, r: 7, kind: "todo", tint: task.tint === TINT.done ? TINT.done : TINT.pending, at: task.at + 0.45 + j * 0.07 });
        }
      }
    });
    return { hub, sessions, tasks, todos };
  })();
  function sceneTree(t) {
    const lt = t - CUTS.tree;
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    starfield(t, 1, 0.8, 23);
    const style = "prism";
    // slow push-in and drift
    const push = easeInOut(span(lt, 0, 3.2));
    const k = lerp(0.92, 1.08, push);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 40); ctx.scale(k, k); ctx.rotate(lerp(-0.015, 0.01, push)); ctx.translate(-W / 2 - 40 + push * 40, -H / 2 - 40);
    const grown = (n) => span(lt, n.at, n.at + 0.55);
    const all = [TREE.hub, ...TREE.sessions, ...TREE.tasks, ...TREE.todos];
    // wires first
    for (const n of [...TREE.sessions.map((s) => ({ n: s, p: TREE.hub })), ...TREE.tasks.map((x) => ({ n: x, p: x.parent })), ...TREE.todos.map((x) => ({ n: x, p: x.parent }))]) {
      const g = grown(n.n);
      if (g <= 0) continue;
      const a = { x: n.p.x, y: n.p.y };
      const reach = expoOut(g);
      const b = { x: lerp(a.x, n.n.x, reach), y: lerp(a.y, n.n.y, reach) };
      const cp = wire(style, a, b, { id: n.n.id, kind: n.n.kind === "todo" ? "todo" : n.n.kind === "task" ? "task" : "session", tint: n.n.kind === "session" ? TINT.session : n.n.tint, alpha: n.n.kind === "todo" ? 0.3 : 0.55, width: n.n.kind === "todo" ? 0.8 : 1.3, active: n.n.active === true, march: n.n.kind === "task" && n.n.active, dash: n.n.kind === "task" ? [2, 4] : [], horizontal: true, rA: n.p.r, rB: n.n.r });
      // a pulse runs out along each new branch as it lands
      const pu = span(lt, n.n.at + 0.1, n.n.at + 0.75) * 1.0 + span(lt, n.n.at + 0.75, n.n.at + 1.13);
      if (n.n.kind !== "todo" && pu > 0 && pu < 2) pulse(style, a, { x: n.n.x, y: n.n.y }, pu, { cp, rA: n.p.r, rB: n.n.r, color: n.n.kind === "session" ? "#b9b0ff" : "#36d1ff" });
    }
    // then nodes, far to near
    for (const n of all) {
      const g = n === TREE.hub ? 1 : grown(n);
      if (g <= 0) continue;
      node(n.id, style, n.x, n.y, n.r * Math.max(0.05, backOut(g)), { kind: n.kind, tint: n.tint, active: n.active === true, arrive: g, orbit: n.active && n.kind === "task" ? 1.8 : 0 });
    }
    ctx.restore();
    // labels
    const cu = span(lt, 0.3, 1.2);
    riseText("COMMAND VIEW", 150, 176, cu, { size: 22, weight: 600, family: MONO, track: 6, fill: rgba(BRIGHT) });
    riseText("Every task is a node.", 150, 250, span(lt, 0.45, 1.4), { size: 64, weight: 700 });
    riseText("Every agent, a pulse you can follow.", 150, 318, span(lt, 0.7, 1.7), { size: 40, weight: 400, family: SERIF, fill: rgba(INK, 0.75) });
    // counter HUD on the right
    const done = TREE.tasks.filter((x) => lt > x.at + 0.6 && x.tint === TINT.done).length;
    text(`TASKS ${String(TREE.tasks.filter((x) => lt > x.at).length).padStart(2, "0")}   DONE ${String(done).padStart(2, "0")}   RUNNING ${TREE.tasks.filter((x) => lt > x.at && x.active).length}`, W - 150, 176, { size: 17, weight: 500, family: MONO, align: "right", track: 3, fill: rgba(INK, 0.7 * span(lt, 0.8, 1.2)) });
    const out = easeIn(span(lt, 3.0, 3.2));
    if (out > 0) { ctx.fillStyle = rgba(BG, out); ctx.fillRect(0, 0, W, H); }
  }

  const STYLE_NAMES = { orbs: "CLASSIC ORBS", glass: "SOFT GLASS", minimal: "MINIMAL", halo: "HALO", crystal: "CRYSTAL", singularity: "SINGULARITY", prism: "PRISM", sigil: "SIGIL" };
  function sceneStyles(t) {
    const lt = t - CUTS.styles;
    const list = [...styles.STYLES];
    const slot = 3.2 / list.length;
    const idx = Math.min(list.length - 1, Math.floor(lt / slot));
    const into = (lt - idx * slot) / slot;
    const style = list[idx];
    const premium = styles.PREMIUM.includes(style);
    const inverted = idx % 4 === 3;
    const bg = inverted ? ACCENT : BG;
    ctx.fillStyle = rgba(bg); ctx.fillRect(0, 0, W, H);
    hudInk = inverted ? [12, 8, 26] : INK;
    // giant outlined name behind, sliding
    const name = STYLE_NAMES[style] ?? style.toUpperCase();
    const slide = lerp(80, -80, into);
    text(name, W / 2 + slide, H / 2 + 110, { size: 330, weight: 800, stretch: "condensed", align: "center", fill: null, stroke: rgba(inverted ? [12, 8, 26] : INK, 0.22), lineWidth: 2 });
    // concentric guide
    ctx.strokeStyle = rgba(inverted ? [12, 8, 26] : INK, 0.12); ctx.lineWidth = 1;
    for (const rr of [170, 250, 340]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, rr, 0, TAU); ctx.stroke(); }
    // the node itself, big, working
    const pop = backOut(clamp(into * 4));
    node(`style-${style}`, style, W / 2, H / 2, 150 * Math.max(0.05, pop), { kind: "task", tint: idx % 2 ? TINT.warm : TINT.done, active: true, selected: into > 0.5, orbit: 1.8, arrive: clamp(into * 3), glow: premium });
    // small satellites in other states
    const sat = [[-420, -170, TINT.task, false], [430, 150, TINT.amber, false], [-360, 230, TINT.verify, false], [380, -210, TINT.pending, false]];
    sat.forEach(([dx, dy, tint], i) => {
      const su = expoOut(clamp(into * 3 - 0.3 - i * 0.12));
      if (su > 0) node(`sat-${style}-${i}`, style, W / 2 + dx * su, H / 2 + dy * su, 34 * su, { kind: "task", tint });
    });
    // label block
    const ink = inverted ? [12, 8, 26] : INK;
    text(`${String(idx + 1).padStart(2, "0")}/${String(list.length).padStart(2, "0")}`, 150, 190, { size: 20, weight: 500, family: MONO, track: 4, fill: rgba(ink, 0.7) });
    riseText(name, 150, 262, clamp(into * 3), { size: 64, weight: 800, stretch: "condensed", fill: rgba(ink) });
    text(premium ? "VOID COLLECTION" : "FREE STYLE", 150, 300, { size: 17, weight: 500, family: MONO, track: 4, fill: rgba(premium && !inverted ? ACCENT2 : ink, 0.85) });
    text("NODE STYLES · ANIMATED, THEMED, 60 FPS", W - 150, H - 150, { size: 17, weight: 500, family: MONO, align: "right", track: 3, fill: rgba(ink, 0.55) });
    // hard-cut flash on each change
    if (into < 0.12) { ctx.fillStyle = rgba(inverted ? [255, 255, 255] : BRIGHT, 0.18 * (1 - into / 0.12)); ctx.fillRect(0, 0, W, H); }
  }

  const CREW = ["planner", "builder", "watcher", "auditor", "keeper", "overseer"].filter((role) => look.AGENT_COLORS[role] || role === "planner").map((role) => (look.AGENT_COLORS[role] ? role : "thinker"));
  function sceneCrew(t) {
    const lt = t - CUTS.crew;
    hudInk = INK;
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    starfield(t, -0.6, 0.7, 41);
    const style = "sigil";
    const cx = 1260, cy = 540;
    const zoom = lerp(1.15, 1, expoOut(span(lt, 0, 1)));
    ctx.save(); ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
    // orbit guides
    ctx.strokeStyle = rgba(INK, 0.08); ctx.lineWidth = 1;
    for (const rr of [250, 360]) { ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, TAU); ctx.stroke(); }
    const agents = CREW.map((role, i) => {
      const ring = i % 2 ? 360 : 250;
      const ang = i / CREW.length * TAU + lt * 0.42;
      return { role, i, x: cx + Math.cos(ang) * ring, y: cy + Math.sin(ang) * ring * 0.62, z: Math.sin(ang) };
    });
    const statuses = (i) => {
      const s = lt - 0.4 - i * 0.22;
      return s < 0 ? "queued" : s < 1.3 ? "running" : "done";
    };
    // tethers + packets inbound
    for (const a of agents) {
      const tint = hex(look.AGENT_COLORS[a.role]);
      const cp = wire(style, { x: a.x, y: a.y }, { x: cx, y: cy }, { id: `tether-${a.role}`, kind: "tether", tint, alpha: 0.4, dash: [6, 4], march: true, active: true, curved: false, rA: 26, rB: 64 });
      const pu = ((lt * 0.9 + a.i * 0.37) % 1.6);
      pulse(style, { x: a.x, y: a.y }, { x: cx, y: cy }, pu, { wave: true, packet: true, color: look.AGENT_COLORS[a.role], rA: 26, rB: 64, cp });
    }
    node("crew-hub", style, cx, cy, 64, { kind: "assistant", tint: TINT.hub, active: true, crew: true });
    for (const a of [...agents].sort((p, q) => p.z - q.z)) {
      const status = statuses(a.i);
      const tint = status === "done" ? DONE : status === "queued" ? MUTED : hex(look.AGENT_COLORS[a.role]);
      node(`crew-${a.role}`, style, a.x, a.y, 26 + a.z * 4, { kind: "agent", role: a.role, status, tint, active: status === "running" });
      text(a.role.toUpperCase(), a.x, a.y + 58, { size: 14, weight: 500, family: MONO, align: "center", track: 3, fill: rgba(INK, 0.55) });
    }
    ctx.restore();
    riseText("YOUR CREW,", 150, 420, span(lt, 0.1, 0.9), { size: 110, weight: 800, stretch: "condensed" });
    riseText("WORKING IN", 150, 530, span(lt, 0.25, 1.05), { size: 110, weight: 800, stretch: "condensed" });
    riseText("THE OPEN.", 150, 640, span(lt, 0.4, 1.2), { size: 110, weight: 800, stretch: "condensed", fill: rgba(ACCENT2) });
    text("Planner, builders, verifier, keeper — each one a live node.", 150, 700, { size: 26, weight: 400, family: SERIF, fill: rgba(INK, 0.7 * span(lt, 0.9, 1.5)) });
    const out = easeIn(span(lt, 2.25, 2.4));
    if (out > 0) { ctx.fillStyle = rgba(BG, out); ctx.fillRect(0, 0, W, H); }
  }

  function sceneFlow(t) {
    const lt = t - CUTS.flow;
    hudInk = INK;
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    const style = "halo";
    const cols = ["READY", "WORKING", "REVIEW", "DONE"];
    const x0 = 300, x1 = 1620, y = 560;
    const colX = (i) => lerp(x0, x1, i / (cols.length - 1));
    // track
    const draw = expoOut(span(lt, 0, 0.6));
    ctx.strokeStyle = rgba(INK, 0.18); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(lerp(x0, x1, draw), y); ctx.stroke();
    cols.forEach((c, i) => {
      const cu = span(lt, 0.1 + i * 0.1, 0.6 + i * 0.1);
      text(c, colX(i), y + 110, { size: 22, weight: 600, family: MONO, align: "center", track: 6, fill: rgba(INK, 0.75 * cu) });
      ctx.fillStyle = rgba(INK, 0.35 * cu); ctx.fillRect(colX(i) - 1, y - 14, 2, 28);
    });
    // the task travelling: stops at each column
    const stops = [0.5, 0.9, 1.4, 1.8];
    let pos = 0;
    for (let i = 1; i < stops.length; i += 1) pos += expoInOut(span(lt, stops[i - 1] + 0.05, stops[i] - 0.05));
    const x = lerp(x0, x1, pos / 3);
    const stage = Math.round(pos);
    const tint = stage >= 3 ? DONE : stage === 2 ? TINT.verify : stage === 1 ? AMBER : TINT.task;
    // trail
    for (let i = 1; i < 18; i += 1) {
      const tx = lerp(x0, x1, Math.max(0, (pos - i * 0.012)) / 3);
      ctx.fillStyle = rgba(tint, 0.25 * (1 - i / 18)); ctx.beginPath(); ctx.arc(tx, y, 34 * (1 - i / 22), 0, TAU); ctx.fill();
    }
    node("flow-task", style, x, y, 46 + (stage === 3 ? 8 * backOut(span(lt, 1.75, 2.0)) : 0), { kind: "task", tint, active: stage === 1, selected: stage === 3, orbit: stage === 1 ? 1.8 : 0 });
    // check list ticking during review
    const checks = ["npm run check", "npm test", "npm run audit"];
    checks.forEach((c, i) => {
      const cu = span(lt, 1.05 + i * 0.12, 1.25 + i * 0.12);
      if (cu <= 0) return;
      const yy = y - 230 + i * 44;
      text(`${cu >= 1 ? "✓" : "…"}  ${c}`, colX(2) - 150, yy, { size: 22, weight: 500, family: MONO, fill: rgba(cu >= 1 ? DONE : INK, 0.9 * cu) });
    });
    // the worker log, typed in as the task moves
    const LOG = [
      [0.15, "planner", "split the idea into 3 tasks", "+0:04"],
      [0.55, "builder", "editing renderer/idle.js, node-styles.js", "+2:31"],
      [0.95, "builder", "done · 4 files changed", "+6:48"],
      [1.10, "verifier", "npm test · 3,605 pass, 0 fail", "+7:02"],
      [1.40, "keeper", "merged into main", "+7:40"],
    ];
    LOG.forEach(([at, who, what, stamp], i) => {
      const lu = span(lt, at, at + 0.35);
      if (lu <= 0) return;
      const yy = 790 + i * 38;
      const shown = what.slice(0, Math.ceil(what.length * lu));
      text(stamp, 300, yy, { size: 19, weight: 500, family: MONO, fill: rgba(INK, 0.35) });
      text(who.toUpperCase().padEnd(9, " "), 420, yy, { size: 19, weight: 600, family: MONO, track: 2, fill: rgba(look.AGENT_COLORS[who] ? hex(look.AGENT_COLORS[who]) : BRIGHT, 0.95) });
      text(shown + (lu < 1 && Math.floor(now * 8) % 2 ? "▍" : ""), 590, yy, { size: 19, weight: 500, family: MONO, fill: rgba(INK, 0.8) });
    });
    riseText("From idea to merged,", 150, 200, span(lt, 0.1, 0.9), { size: 64, weight: 700 });
    riseText("with the checks in plain sight.", 150, 262, span(lt, 0.3, 1.1), { size: 40, weight: 400, family: SERIF, fill: rgba(INK, 0.75) });
    // done burst
    const burst = span(lt, 1.8, 2.3);
    if (burst > 0 && burst < 1) {
      for (let i = 0; i < 16; i += 1) {
        const a = i / 16 * TAU;
        const r0 = 60 + easeOut(burst) * 120, r1 = r0 + 40 * (1 - burst);
        ctx.strokeStyle = rgba(DONE, 1 - burst); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1 + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x1 + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke();
      }
    }
  }

  function sceneSlam(t) {
    const lt = t - CUTS.slam;
    const words = ["LOCAL-FIRST.", "NO TELEMETRY.", "NO ACCOUNT.", "MIT."];
    const slot = 1.6 / words.length;
    const idx = Math.min(words.length - 1, Math.floor(lt / slot));
    const into = (lt - idx * slot) / slot;
    const inv = idx % 2 === 1;
    const bg = inv ? INK : BG, fg = inv ? BG : INK;
    ctx.fillStyle = rgba(bg); ctx.fillRect(0, 0, W, H);
    hudInk = fg;
    const scale = lerp(1.18, 1, expoOut(clamp(into * 2.5)));
    ctx.save(); ctx.translate(W / 2, H / 2 + 70); ctx.scale(scale, scale);
    // echo copies behind (motion smear)
    for (let e = 3; e >= 1; e -= 1) text(words[idx], 0, e * 34 * (1 - clamp(into * 3)), { size: 250, weight: 800, stretch: "condensed", align: "center", fill: rgba(fg, 0.08 * e) });
    text(words[idx], 0, 0, { size: 250, weight: 800, stretch: "condensed", align: "center", fill: rgba(idx === 3 ? ACCENT : fg) });
    ctx.restore();
    text(["KEYS STAY IN YOUR OS KEYSTORE", "NOTHING PHONES HOME", "OPEN THE APP AND GO", "OPEN SOURCE, FOREVER"][idx], W / 2, H / 2 + 170, { size: 20, weight: 500, family: MONO, align: "center", track: 6, fill: rgba(fg, 0.6) });
  }

  function sceneEnd(t) {
    const lt = t - CUTS.end;
    const dark = [10, 7, 24];
    // violet wipe up from the bottom
    ctx.fillStyle = rgba(BG); ctx.fillRect(0, 0, W, H);
    const wipe = expoOut(span(lt, 0, 0.5));
    ctx.fillStyle = rgba(ACCENT); ctx.fillRect(0, H * (1 - wipe), W, H * wipe);
    hudInk = dark;
    if (wipe < 1) return;
    // emblem: a Sigil hub on the left, turning
    const eu = span(lt, 0.35, 1.0);
    node("end-sigil", "sigil", 420, 470, 120 * Math.max(0.05, backOut(eu)), { kind: "assistant", tint: [250, 248, 255], active: true, arrive: eu });
    riseText("MEFI'S STUDIO", 620, 520, span(lt, 0.45, 1.2), { size: 170, weight: 800, stretch: "condensed", fill: rgba(dark) });
    riseText("AI+", 620, 640, span(lt, 0.7, 1.4), { size: 110, weight: 800, stretch: "condensed", fill: rgba([250, 248, 255]) });
    riseText("agents you can watch work", 830, 630, span(lt, 0.85, 1.7), { size: 54, weight: 400, family: SERIF, fill: rgba(dark, 0.9) });
    const ru = expoOut(span(lt, 1.2, 1.8));
    ctx.fillStyle = rgba(dark, 0.85); ctx.fillRect(620, 690, 1150 * ru, 2);
    const row = ["v0.4.0", "WINDOWS", "MIT LICENSE", "GITHUB.COM/NATEECHO32-STACK/MEFI-STUDIO"];
    let x = 620;
    row.forEach((item, i) => {
      const iu = span(lt, 1.3 + i * 0.1, 1.6 + i * 0.1);
      text(item, x, 740, { size: 20, weight: 600, family: MONO, track: 3, fill: rgba(dark, 0.85 * iu) });
      font(20, 600, MONO); if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
      x += ctx.measureText(item).width + 48;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    });
  }

  // ---- frame ---------------------------------------------------------------
  let now = 0, frameDt = 1 / 60;
  function draw(t) {
    if (t < lastT) records.clear();
    frameDt = lastT < 0 || t < lastT ? 1 / 60 : clamp(t - lastT, 0, 0.1);
    lastT = t;
    now = t;
    hudInk = INK;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    let label = "IGNITION", index = 1;
    if (t < CUTS.wall) sceneIgnite(t);
    else if (t < CUTS.tree) { sceneWall(t); label = "PIPELINE"; index = 2; }
    else if (t < CUTS.styles) { sceneTree(t); label = "COMMAND VIEW"; index = 3; }
    else if (t < CUTS.crew) { sceneStyles(t); label = "NODE STYLES"; index = 4; }
    else if (t < CUTS.flow) { sceneCrew(t); label = "THE CREW"; index = 5; }
    else if (t < CUTS.slam) { sceneFlow(t); label = "TASK FLOW"; index = 6; }
    else if (t < CUTS.end) { sceneSlam(t); label = "PRINCIPLES"; index = 7; }
    else { sceneEnd(t); label = "END"; index = 8; }
    for (const at of [CUTS.tree, CUTS.styles, CUTS.crew, CUTS.flow, CUTS.slam]) flash(t, at, 0.1, BRIGHT);
    if (t < CUTS.end) vignette(0.6);
    grain(t, t >= CUTS.end ? 0.035 : 0.05);
    hud(t, label, index);
    // fade from and to black at the very ends
    const fin = span(t, 0, 0.25), fout = span(t, DURATION - 0.35, DURATION);
    if (fin < 1 || fout > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.max(1 - fin, fout)})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }
  window.seek = (t) => { draw(t); return true; };
  window.ready = document.fonts.ready.then(() => true);
  if (location.search.includes("play")) {
    const start = performance.now();
    const loop = () => { draw(((performance.now() - start) / 1000) % DURATION); requestAnimationFrame(loop); };
    loop();
  } else {
    draw(0);
  }
})();
