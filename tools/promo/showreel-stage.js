// Showreel: a 40-second motion piece drawn with the Studio's own node painters
// (renderer/node-styles.js), agent glyphs (tree3d.js) and theme palettes
// (music.js), injected by showreel.cjs before this script runs. Its motifs are
// the app's: the icon, the Command view's tree and callout plates, the node
// styles and themes. Scenes change through an iris that opens out of a node.
// window.seek(t) draws the frame at t seconds; nothing animates on its own.
(() => {
  "use strict";
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const styles = window.MefiNodeStyles;
  const look = window.__agentLook;
  const THEMES = window.__themes;
  const DURATION = 40;

  const DISPLAY = '"Bahnschrift", "Segoe UI", sans-serif';
  const UI = '"Segoe UI", system-ui, sans-serif';
  const MONO = '"Cascadia Mono", "Consolas", monospace';
  const SERIF = 'Georgia, "Times New Roman", serif';

  // ---- colour and themes ------------------------------------------------------
  const hex = (value) => {
    const text = String(value).replace("#", "");
    const n = parseInt(text.length === 3 ? text.split("").map((c) => c + c).join("") : text.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = (triple) => "#" + triple.map((v) => v.toString(16).padStart(2, "0")).join("");
  const rgba = (triple, a = 1) => `rgba(${triple[0]},${triple[1]},${triple[2]},${a})`;
  const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const DONE = [104, 236, 164], AMBER = [255, 212, 121];
  function makeTheme(key) {
    const { info, palette } = THEMES[key];
    const BG = hex(info.bg), INK = hex(info.text), MUTED = hex(info.muted), ACCENT = hex(info.accent), BRIGHT = hex(info.bright);
    const ACCENT2 = hex(info.accent2 ?? info.bright);
    return {
      key, name: info.name, BG, INK, MUTED, ACCENT, BRIGHT, ACCENT2, PANEL: hex(info.panel ?? info.bg),
      nodeTheme: styles.theme(palette),
      TINT: { hub: BRIGHT, session: INK, task: mixc(MUTED, [151, 179, 244], 0.4), warm: BRIGHT, pending: MUTED, done: DONE, amber: AMBER, verify: [151, 179, 244] },
    };
  }
  const THEME_CACHE = {};
  const themeOf = (key) => (THEME_CACHE[key] ??= makeTheme(key));
  let TH = themeOf(window.__themeKey ?? "void");
  // Two themes part-way: every colour mixed, the painters' theme built from a
  // mixed canvas palette (quantised, so a blend makes at most 24 of them).
  const BLEND_CACHE = new Map();
  function blendTheme(a, b, u) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    const q = Math.round(u * 24) / 24, key = `${a.key}>${b.key}@${q}`;
    let out = BLEND_CACHE.get(key);
    if (out) return out;
    const m = (x, y) => mixc(x, y, q);
    const pa = THEMES[a.key].palette, pb = THEMES[b.key].palette;
    const palette = {};
    for (const k of Object.keys(pb)) {
      const x = pa[k], y = pb[k];
      palette[k] = typeof x === "string" && typeof y === "string" && /^#[0-9a-f]{6}$/i.test(x) && /^#[0-9a-f]{6}$/i.test(y) ? toHex(m(hex(x), hex(y))) : q < 0.5 ? x ?? y : y;
    }
    out = {
      key: b.key, name: q < 0.5 ? a.name : b.name, BG: m(a.BG, b.BG), INK: m(a.INK, b.INK), MUTED: m(a.MUTED, b.MUTED), ACCENT: m(a.ACCENT, b.ACCENT),
      BRIGHT: m(a.BRIGHT, b.BRIGHT), ACCENT2: m(a.ACCENT2, b.ACCENT2), PANEL: m(a.PANEL, b.PANEL), nodeTheme: styles.theme(palette),
      TINT: Object.fromEntries(Object.keys(b.TINT).map((k) => [k, m(a.TINT[k], b.TINT[k])])),
    };
    BLEND_CACHE.set(key, out);
    return out;
  }
  const BASE = TH;

  // ---- time ------------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const expoOut = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
  const expoInOut = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2);
  const backOut = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }

  // Scene cuts (seconds), on the score's 0.4 s beat (150 BPM).
  const CUTS = { ignite: 0, prompt: 3.2, tree: 7.2, styles: 12.0, grid: 15.2, themes: 16.8, crew: 20.0, flow: 24.0, numbers: 27.2, principles: 30.4, end: 33.6 };
  window.__cuts = CUTS;
  window.__duration = DURATION;

  // ---- node painting through the Studio's painters ----------------------------
  // Painters are tuned for 3–15 px nodes; bigger ones are painted at 14 px under
  // a scale, so every stroke keeps its proportion.
  const records = new Map();
  let lastT = -1, now = 0, frameDt = 1 / 60;
  const PAINT_R = 14;
  function recordFor(id, style, flags, t) {
    const key = `${id}:${style}`;
    let entry = records.get(key);
    if (!entry) {
      entry = { record: styles.motionRecord(new Map(), `reel:${key}`) };
      const f = { style, active: false, selected: false, lift: 0, progress: null, orbit: 0, status: null, stale: false, time: 0, frame: 0, ...flags };
      for (let i = 0; i < 60; i += 1) { f.time = (t - 1 + i / 60) * 1000; f.frame = i; styles.stepMotion(entry.record, f, 1 / 60, false); }
      records.set(key, entry);
    }
    return entry;
  }
  function node(id, style, x, y, r, o = {}) {
    if (!(r > 0.3)) return;
    const t = now;
    const flags = {
      style, active: o.active === true, selected: o.selected === true, lift: o.selected ? 1 : 0, progress: o.progress ?? null,
      orbit: o.orbit ?? 0, status: o.status ?? null, stale: false, time: t * 1000, frame: Math.round(t * 60),
    };
    const entry = recordFor(id, style, flags, t);
    styles.stepMotion(entry.record, flags, frameDt, false);
    const tint = o.tint ?? TH.TINT.task;
    entry.record.tint = tint;
    const theme = TH.nodeTheme;
    const p = { x: 0, y: 0 };
    ctx.save();
    ctx.translate(x, y); ctx.scale(r / PAINT_R, r / PAINT_R);
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
    const cp = o.curved === false ? null : { x1: (a.x + b.x) / 2, y1: a.y, x2: (a.x + b.x) / 2, y2: b.y };
    ctx.save();
    ctx.globalAlpha = o.fade ?? 1;
    const spec = {
      kind: o.kind ?? "session", tint: o.tint ?? TH.TINT.task, alpha: o.alpha ?? 0.5, width: o.width ?? 1, dash: o.dash ?? [], march: o.march === true,
      double: o.double === true, active: o.active === true, inspected: false, curved: Boolean(cp), cp, far: false,
      time: now * 1000, still: false, seed: styles.seed(`reel:${o.id ?? "w"}`), rA: o.rA ?? 0, rB: o.rB ?? 0, lifetime: 1, theme: TH.nodeTheme, detail: 3,
      flow: o.flow ?? o.active === true,
    };
    if (!styles.wire(ctx, style, a, b, spec)) {
      ctx.strokeStyle = rgba(spec.tint, spec.alpha); ctx.lineWidth = spec.width;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      if (cp) ctx.bezierCurveTo(cp.x1, cp.y1, cp.x2, cp.y2, b.x, b.y); else ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
    return cp;
  }
  function pulse(style, a, b, u, o = {}) {
    if (!(u > 0) || u >= 2) return;
    const color = o.color ?? toHex(TH.BRIGHT);
    const p = { color, glow: o.glow ?? color, wave: o.wave === true, packet: o.packet === true, small: o.small === true, start: 0, duration: 900, from: { id: "a", _pr: o.rA ?? 8 }, to: { id: "b", _pr: o.rB ?? 8 } };
    const pl = { kind: p.wave ? "wave" : "dot", time: Math.min(1, u) * 900, still: false, rTo: o.rB ?? 8, detail: 3, pulse: p, motion: null, cp: o.cp ?? null, theme: TH.nodeTheme };
    if (u <= 1) {
      if (!styles.surge(ctx, style, a, b, u, p, pl)) {
        ctx.beginPath(); ctx.arc(lerp(a.x, b.x, u), lerp(a.y, b.y, u), 3, 0, TAU); ctx.fillStyle = color; ctx.fill();
      }
    } else {
      p._rgb = hex(color);
      pl.time = 900 + (u - 1) * 380;
      styles.land(ctx, style, b, o.rB ?? 8, p._rgb, u - 1, pl);
    }
  }

  // ---- type ------------------------------------------------------------------
  function font(size, weight = 700, family = DISPLAY, stretch = "normal") {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fontStretch = stretch;
  }
  function text(str, x, y, o = {}) {
    font(o.size ?? 40, o.weight ?? 700, o.family ?? DISPLAY, o.stretch ?? "normal");
    ctx.textAlign = o.align ?? "left"; ctx.textBaseline = o.base ?? "alphabetic";
    ctx.letterSpacing = `${o.track ?? 0}px`;
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth ?? 2; ctx.strokeText(str, x, y); }
    if (o.fill !== null) { ctx.fillStyle = o.fill ?? rgba(TH.INK); ctx.fillText(str, x, y); }
    ctx.letterSpacing = "0px";
  }
  function measure(str, o = {}) {
    font(o.size ?? 40, o.weight ?? 700, o.family ?? DISPLAY, o.stretch ?? "normal");
    ctx.letterSpacing = `${o.track ?? 0}px`;
    const w = ctx.measureText(str).width;
    ctx.letterSpacing = "0px";
    return w;
  }
  // Letters rising out of a mask, one after another.
  function riseText(str, x, y, u, o = {}) {
    if (u <= 0) return;
    const size = o.size ?? 40;
    const total = measure(str, o);
    let cx = o.align === "center" ? x - total / 2 : o.align === "right" ? x - total : x;
    font(size, o.weight ?? 700, o.family ?? DISPLAY, o.stretch ?? "normal");
    ctx.letterSpacing = `${o.track ?? 0}px`;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 20, y - size * 1.1, total + 40, size * 1.45); ctx.clip();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const letters = [...str], stagger = o.stagger ?? 0.05;
    letters.forEach((ch, i) => {
      const w = ctx.measureText(ch).width;
      const local = expoOut(clamp(u * (1 + letters.length * stagger) - i * stagger));
      ctx.fillStyle = o.fill ?? rgba(TH.INK);
      ctx.fillText(ch, cx, y + (1 - local) * size * 1.15);
      cx += w;
    });
    ctx.restore();
    ctx.letterSpacing = "0px";
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  // A glass panel the way the app's surfaces look: tinted, hairline, top highlight.
  function glass(x, y, w, h, r = 18, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    roundRect(x, y, w, h, r); ctx.fillStyle = rgba(mixc(TH.PANEL, TH.BG, 0.2), 0.86); ctx.fill();
    ctx.shadowColor = "transparent";
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, rgba(TH.INK, 0.07)); g.addColorStop(0.3, rgba(TH.INK, 0.015)); g.addColorStop(1, rgba(TH.ACCENT, 0.04));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = rgba(TH.INK, 0.13); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  // ---- the app's own motifs ------------------------------------------------------
  // The icon: a serif M over a gold ring, a plus under it. u runs the draw-in.
  const GOLD = [207, 169, 100], IVORY = [239, 230, 214];
  function drawIcon(cx, cy, size, u, { plate = true } = {}) {
    const k = size / 256;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-128, -128);
    if (plate) {
      const pu = easeOut(span(u, 0, 0.25));
      roundRect(0, 0, 256, 256, 44); ctx.fillStyle = `rgba(21,19,17,${0.92 * pu})`; ctx.fill();
      ctx.strokeStyle = rgba(GOLD, 0.25 * pu); ctx.lineWidth = 2; ctx.stroke();
    }
    const ring = easeInOut(span(u, 0.08, 0.6));
    ctx.lineCap = "round";
    if (ring > 0) { ctx.beginPath(); ctx.arc(128, 136, 96, -Math.PI / 2, -Math.PI / 2 + TAU * ring); ctx.strokeStyle = rgba(GOLD); ctx.lineWidth = 8; ctx.stroke(); }
    const inner = easeInOut(span(u, 0.2, 0.7));
    if (inner > 0) { ctx.beginPath(); ctx.arc(128, 136, 84, Math.PI / 2, Math.PI / 2 + TAU * inner); ctx.strokeStyle = rgba(GOLD, 0.45); ctx.lineWidth = 2; ctx.stroke(); }
    const m = expoOut(span(u, 0.35, 0.75));
    if (m > 0) {
      ctx.save();
      ctx.beginPath(); ctx.rect(20, -10, 216, 110); ctx.clip();
      ctx.font = `700 132px ${SERIF}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = rgba(IVORY); ctx.fillText("M", 128, 96 + (1 - m) * 110);
      ctx.restore();
    }
    const plus = easeOut(span(u, 0.55, 0.95));
    if (plus > 0) {
      ctx.fillStyle = rgba(IVORY);
      ctx.fillRect(128 - 36 * plus, 199, 72 * plus, 11);
      ctx.fillRect(122, 205 - 34 * plus, 11, 68 * plus);
    }
    ctx.restore();
  }
  // A Command view callout: a leader leaving the orb, a top bar with the
  // number, title and done/left counts above it, and what is happening below.
  function callout(x, y, r, o, u) {
    if (u <= 0) return;
    const side = o.side ?? 1, vert = o.vert ?? -1, len = o.length ?? 46;
    // the bar is as long as its words need
    const numberW = o.number ? measure(o.number, { size: 13, weight: 600, family: MONO }) + 8 : 0;
    const titleW = measure(o.title, { size: 17, weight: 600, family: UI });
    const countsW = o.counts ? measure(o.counts, { size: 13, weight: 500, family: MONO }) + 24 : 0;
    const thoughtW = o.thought ? measure(o.thought, { size: 15, weight: 400, family: UI }) : 0;
    const bar = Math.max(o.bar ?? 0, 20 + numberW + titleW + countsW, thoughtW + 8);
    const ang = vert < 0 ? (side > 0 ? -Math.PI / 4 : -3 * Math.PI / 4) : (side > 0 ? Math.PI / 4 : 3 * Math.PI / 4);
    const sx = x + Math.cos(ang) * (r + 4), sy = y + Math.sin(ang) * (r + 4);
    const ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    const lu = easeOut(span(u, 0, 0.35)), bu = expoOut(span(u, 0.25, 0.7)), tu = span(u, 0.45, 1);
    const tint = o.tint ?? TH.INK;
    const left = side > 0 ? ex + 2 : ex - bar;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    // the plate: a dark, soft card under the words, so wires behind stay quiet
    if (tu > 0) {
      ctx.save(); ctx.globalAlpha *= easeOut(tu);
      roundRect(left - 10, ey - 32, bar + 20, o.thought ? 66 : 42, 10);
      ctx.fillStyle = rgba(TH.BG, 0.78); ctx.fill();
      ctx.strokeStyle = rgba(TH.INK, 0.06); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = rgba(tint, 0.6); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, ex, lu), lerp(sy, ey, lu)); ctx.stroke();
    if (bu > 0) {
      const far = side > 0 ? ex + bar * bu : ex - bar * bu;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(far, ey); ctx.stroke();
      // the tab: a short, heavier plate at the bar's far end
      ctx.fillStyle = rgba(tint, 0.85);
      ctx.fillRect(side > 0 ? far - 18 : far, ey - 1.5, 18, 3);
    }
    if (tu > 0) {
      ctx.globalAlpha *= easeOut(tu);
      const lift = (1 - easeOut(tu)) * 8;
      let tx = left;
      if (o.mark === "check") {
        ctx.strokeStyle = rgba(DONE); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(tx + 1, ey - 12 + lift); ctx.lineTo(tx + 5, ey - 8 + lift); ctx.lineTo(tx + 12, ey - 17 + lift); ctx.stroke();
        tx += 20;
      } else {
        const pulseA = o.mark === "live" ? 0.5 + 0.5 * Math.sin(now * 8) : 0.6;
        ctx.beginPath(); ctx.arc(tx + 5, ey - 12 + lift, 4, 0, TAU); ctx.fillStyle = rgba(o.mark === "live" ? TH.ACCENT2 : TH.MUTED, pulseA); ctx.fill();
        tx += 16;
      }
      if (o.number) { text(o.number, tx, ey - 7 + lift, { size: 13, weight: 600, family: MONO, fill: rgba(TH.MUTED, 0.9) }); tx += numberW; }
      text(o.title, tx, ey - 7 + lift, { size: 17, weight: 600, family: UI, fill: rgba(TH.INK, 0.95) });
      if (o.counts) text(o.counts, left + bar, ey - 7 + lift, { size: 13, weight: 500, family: MONO, align: "right", fill: rgba(o.mark === "check" ? DONE : TH.MUTED, 0.9) });
      if (o.thought) text(o.thought, left, ey + 21 - lift, { size: 15, weight: 400, family: UI, fill: rgba(TH.INK, 0.62) });
    }
    ctx.restore();
  }

  // ---- HUD and finish ------------------------------------------------------------
  function timecode(t) {
    const f = Math.floor(t * 60) % 60, s = Math.floor(t) % 60;
    return `00:00:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  }
  function hud(t, label, index, count) {
    const u = expoOut(span(t, 0.1, 1.1)) * (1 - span(t, DURATION - 0.9, DURATION - 0.3));
    const m = 44, ink = BASE.INK;
    ctx.save();
    ctx.globalAlpha = 0.9 * u;
    ctx.strokeStyle = rgba(ink, 0.5); ctx.lineWidth = 1.5;
    const arm = 26 * u;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * arm); ctx.lineTo(x, y); ctx.lineTo(x + sx * arm, y); ctx.stroke();
    }
    const small = { size: 15, weight: 500, family: MONO, fill: rgba(ink, 0.7), track: 2 };
    text("MEFI'S STUDIO AI+", m + 40, m + 20, small);
    text("COMMAND · LIVE", m + 40, m + 42, { ...small, fill: rgba(ink, 0.4) });
    text(`${String(index).padStart(2, "0")}/${String(count).padStart(2, "0")} · ${label}`, W - m - 40, m + 20, { ...small, align: "right" });
    text(`THEME · ${hudTheme.toUpperCase()}`, W - m - 40, m + 42, { ...small, align: "right", fill: rgba(ink, 0.4) });
    text(timecode(t), m + 40, H - m - 14, small);
    text("1920×1080 · 60", m + 250, H - m - 14, { ...small, fill: rgba(ink, 0.4) });
    const bx = W - m - 40 - 300, by = H - m - 20;
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = rgba(ink, i / 40 < t / DURATION ? 0.75 : 0.18);
      ctx.fillRect(bx + i * 7.5, by - (i % 5 === 0 ? 10 : 6), 2, i % 5 === 0 ? 10 : 6);
    }
    ctx.restore();
  }
  let hudTheme = BASE.name;
  function grain(t) {
    const r = rng(Math.floor(t * 30) * 7919);
    ctx.save();
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.04 * r()})` : `rgba(0,0,0,${0.07 * r()})`;
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
    for (let i = 0; i < 240; i += 1) {
      const z = 0.2 + r() * 0.8;
      const x = ((r() * W + t * 14 * z * drift) % W + W) % W, y = r() * H;
      ctx.fillStyle = rgba(TH.INK, (0.05 + 0.28 * z * r()) * alpha);
      ctx.fillRect(x, y, z * 2, z * 2);
    }
  }
  function backdrop(t, { stars = 1, seed = 11, drift = 1, glowAt = null } = {}) {
    ctx.fillStyle = rgba(TH.BG); ctx.fillRect(0, 0, W, H);
    if (glowAt) {
      const g = ctx.createRadialGradient(glowAt.x, glowAt.y, 0, glowAt.x, glowAt.y, glowAt.r ?? 700);
      g.addColorStop(0, rgba(glowAt.color ?? TH.ACCENT, glowAt.a ?? 0.12)); g.addColorStop(1, rgba(glowAt.color ?? TH.ACCENT, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (stars) starfield(t, drift, stars, seed);
  }
  function headline(lt, label, big, sub, { y = 176, at = 0.1, out = null } = {}) {
    const fade = out == null ? 1 : 1 - easeOut(span(lt, out, out + 0.35));
    if (fade <= 0) return;
    ctx.save(); ctx.globalAlpha *= fade;
    if (label) riseText(label, 150, y, span(lt, at, at + 0.7), { size: 20, weight: 600, family: MONO, track: 6, fill: rgba(TH.BRIGHT) });
    if (big) riseText(big, 150, y + 76, span(lt, at + 0.15, at + 0.95), { size: 64, weight: 700 });
    if (sub) riseText(sub, 150, y + 140, span(lt, at + 0.35, at + 1.2), { size: 38, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.72), stagger: 0.02 });
    ctx.restore();
  }

  // ---- 1. ignite: the icon draws itself --------------------------------------------
  function sceneIgnite(t) {
    backdrop(t, { stars: easeOut(span(t, 0.2, 1.6)), seed: 3, drift: 0.4, glowAt: { x: W / 2, y: H / 2 - 60, r: 620, a: 0.14 * easeOut(span(t, 0.3, 1.6)) } });
    const cx = W / 2, cy = H / 2 - 70;
    const lu = expoInOut(span(t, 0.05, 1.0));
    ctx.strokeStyle = rgba(TH.INK, 0.1); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 900 * lu, cy); ctx.lineTo(cx + 900 * lu, cy); ctx.moveTo(cx, cy - 480 * lu); ctx.lineTo(cx, cy + 480 * lu); ctx.stroke();
    // three small nodes orbit the icon: the engine's first sign of life
    const ou = easeOut(span(t, 1.3, 2.2));
    if (ou > 0) {
      ctx.strokeStyle = rgba(TH.INK, 0.08 * ou);
      ctx.beginPath(); ctx.ellipse(cx, cy, 250, 250 * 0.4, 0, 0, TAU); ctx.stroke();
      [["o1", "singularity", TH.TINT.hub], ["o2", "prism", DONE], ["o3", "sigil", TH.ACCENT2]].forEach(([id, style, tint], i) => {
        const a = t * 0.9 + i * TAU / 3;
        node(id, style, cx + Math.cos(a) * 250, cy + Math.sin(a) * 100, (10 + Math.sin(a) * 3) * ou, { tint, active: true });
      });
    }
    drawIcon(cx, cy, 250, span(t, 0.25, 1.9));
    riseText("MEFI'S STUDIO AI+", cx, cy + 250, span(t, 1.5, 2.3), { size: 40, weight: 700, align: "center", track: 12 });
    riseText("a studio where agents work in the open", cx, cy + 305, span(t, 1.9, 2.8), { size: 32, weight: 400, family: SERIF, align: "center", fill: rgba(TH.INK, 0.7), stagger: 0.02 });
  }

  // ---- 2. prompt: a task typed in, collapsing into the hub ---------------------------
  const HUB = { x: 330, y: 630 };
  const SESSIONS = [
    { id: "s1", x: 760, y: 440, title: "Settings toggle", number: "01", thought: "writing the switch and its label" },
    { id: "s2", x: 760, y: 630, title: "Theme tokens", number: "02", thought: "swapping hard-coded hex for tokens" },
    { id: "s3", x: 760, y: 820, title: "Tests", number: "03", thought: "npm test · running" },
  ];
  const PROMPT = "Add a dark-mode toggle to Settings, and test it.";
  function scenePrompt(t) {
    const lt = t - CUTS.prompt;
    backdrop(t, { stars: 0.7, seed: 17, glowAt: { x: W / 2, y: 560, r: 800, a: 0.08 } });
    headline(lt, "NEW TASK", "Say what you want.", "Studio turns it into a plan.", { out: 2.7 });
    // the composer
    const enter = easeOut(span(lt, 0.0, 0.5));
    const collapse = easeInOut(span(lt, 2.9, 3.45));
    const pw = lerp(1040, 68, collapse), ph = lerp(160, 68, collapse);
    const px = lerp(W / 2, HUB.x, collapse), py = lerp(600, HUB.y, collapse) + (1 - enter) * 40;
    const panelAlpha = enter * (1 - span(lt, 3.3, 3.55));
    if (panelAlpha > 0) {
      glass(px - pw / 2, py - ph / 2, pw, ph, lerp(20, 34, collapse), panelAlpha);
      const inner = 1 - span(lt, 2.85, 3.05);
      if (inner > 0) {
        ctx.save(); ctx.globalAlpha *= panelAlpha * inner;
        const typed = PROMPT.slice(0, Math.floor(PROMPT.length * span(lt, 0.35, 2.6)));
        const tx = px - pw / 2 + 40, ty = py - 18;
        if (!typed) text("Describe a task…", tx, ty, { size: 30, weight: 400, family: UI, fill: rgba(TH.MUTED, 0.6) });
        text(typed, tx, ty, { size: 30, weight: 400, family: UI, fill: rgba(TH.INK) });
        if (Math.floor(lt * 2.2) % 2 === 0 || (lt > 0.35 && lt < 2.6)) {
          const cw = measure(typed, { size: 30, weight: 400, family: UI });
          ctx.fillStyle = rgba(TH.ACCENT2); ctx.fillRect(tx + cw + 3, ty - 26, 2.5, 34);
        }
        // chips and the button
        let cx = tx;
        for (const c of ["Auto model", "This project", "Verify first"]) {
          const w = measure(c, { size: 15, weight: 500, family: UI }) + 28;
          roundRect(cx, py + 26, w, 32, 16); ctx.strokeStyle = rgba(TH.INK, 0.16); ctx.lineWidth = 1; ctx.stroke();
          text(c, cx + 14, py + 47, { size: 15, weight: 500, family: UI, fill: rgba(TH.INK, 0.7) });
          cx += w + 10;
        }
        const press = span(lt, 2.7, 2.85) * (1 - span(lt, 2.85, 3.0));
        const bw = 170, bh = 44, bx = px + pw / 2 - bw - 24, by = py + 20;
        ctx.save();
        ctx.translate(bx + bw / 2, by + bh / 2); ctx.scale(1 - 0.05 * press, 1 - 0.05 * press); ctx.translate(-(bx + bw / 2), -(by + bh / 2));
        roundRect(bx, by, bw, bh, 12);
        const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        g.addColorStop(0, rgba(mixc(TH.ACCENT, [255, 255, 255], 0.1 + 0.2 * press))); g.addColorStop(1, rgba(TH.ACCENT2));
        ctx.fillStyle = g; ctx.fill();
        text("Create task", bx + bw / 2, by + 29, { size: 17, weight: 600, family: UI, align: "center", fill: "rgba(10,8,20,0.92)" });
        ctx.restore();
        ctx.restore();
      }
    }
    // the hub takes the composer's place, then the plan branches out of it
    const hubU = span(lt, 3.2, 3.6);
    if (hubU > 0) {
      for (const [i, s] of SESSIONS.entries()) {
        const g = span(lt, 3.35 + i * 0.1, 3.9 + i * 0.1);
        if (g <= 0) continue;
        const b = { x: lerp(HUB.x, s.x, expoOut(g)), y: lerp(HUB.y, s.y, expoOut(g)) };
        wire("prism", HUB, b, { id: s.id, kind: "session", tint: TH.TINT.session, alpha: 0.55, width: 1.3, rA: 34, rB: 20 });
        node(s.id, "prism", b.x, b.y, 20 * Math.max(0.05, backOut(g)), { kind: "session", tint: i === 1 ? TH.TINT.warm : TH.TINT.session, active: i === 1, arrive: g });
      }
      node("t-hub", "prism", HUB.x, HUB.y, 34 * backOut(hubU), { kind: "assistant", tint: TH.TINT.hub, active: true, arrive: hubU });
    }
  }

  // ---- 3. tree: the Command view, with callouts, reports travelling back -------------
  const TREE = (() => {
    const tasks = [], todos = [];
    const r = rng(5);
    const order = [4, 0, 7, 2, 5, 1, 8, 3, 6];
    SESSIONS.forEach((s, si) => {
      for (let k = 0; k < 3; k += 1) {
        const id = `k${si}${k}`, y = s.y + (k - 1) * 60, idx = si * 3 + k;
        const task = { id, parent: s, x: 1160, y, r: 15, at: 0.15 + si * 0.14 + k * 0.08, doneAt: 1.9 + order.indexOf(idx) * 0.26, working: idx % 3 === 1 };
        tasks.push(task);
        const count = 2 + Math.floor(r() * 2);
        for (let j = 0; j < count; j += 1) todos.push({ id: `${id}t${j}`, parent: task, x: 1480 + j * 58 + (si % 2) * 20, y: y + (j - (count - 1) / 2) * 19, r: 7, at: task.at + 0.45 + j * 0.07 });
      }
    });
    return { tasks, todos };
  })();
  function sceneTree(t) {
    const lt = t - CUTS.tree;
    backdrop(t, { stars: 0.8, seed: 23 });
    const style = "prism";
    const push = easeInOut(span(lt, 0, 4.8));
    const k = lerp(1, 1.07, push);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 40); ctx.scale(k, k); ctx.translate(-W / 2 - push * 30, -H / 2 - 40);
    const grown = (n) => span(lt, n.at, n.at + 0.55);
    const doneU = (task) => span(lt, task.doneAt, task.doneAt + 0.3);
    // wires: hub → sessions → tasks → todos
    for (const s of SESSIONS) wire(style, HUB, s, { id: s.id, kind: "session", tint: TH.TINT.session, alpha: 0.55, width: 1.3, rA: 34, rB: 20 });
    for (const task of TREE.tasks) {
      const g = grown(task);
      if (g <= 0) continue;
      const a = task.parent, reach = expoOut(g);
      const b = { x: lerp(a.x, task.x, reach), y: lerp(a.y, task.y, reach) };
      const isDone = doneU(task) >= 1;
      const cp = wire(style, a, b, { id: task.id, kind: "task", tint: isDone ? DONE : TH.TINT.task, alpha: 0.5, width: 1.2, dash: [2, 4], active: !isDone && task.working, march: !isDone && task.working, rA: 20, rB: 15 });
      // the brief goes out as the task lands; the report comes back when it is done
      const out = span(lt, task.at + 0.1, task.at + 0.7) + span(lt, task.at + 0.7, task.at + 1.08);
      if (out > 0 && out < 2) pulse(style, a, task, out, { cp, rA: 20, rB: 15, color: toHex(TH.ACCENT2) });
      const back = span(lt, task.doneAt - 0.5, task.doneAt) + span(lt, task.doneAt, task.doneAt + 0.38);
      if (back > 0 && back < 2) pulse(style, task, a, back, { rA: 15, rB: 20, color: toHex(DONE), wave: true });
    }
    for (const td of TREE.todos) {
      const g = grown(td);
      if (g <= 0) continue;
      const a = td.parent, reach = expoOut(g);
      wire(style, a, { x: lerp(a.x, td.x, reach), y: lerp(a.y, td.y, reach) }, { id: td.id, kind: "todo", tint: doneU(a) >= 1 ? DONE : TH.TINT.pending, alpha: 0.28, width: 0.8, rA: 15, rB: 7 });
    }
    // nodes
    node("t-hub", style, HUB.x, HUB.y, 34, { kind: "assistant", tint: TH.TINT.hub, active: true });
    SESSIONS.forEach((s, i) => {
      const allDone = TREE.tasks.filter((x) => x.parent === s).every((x) => doneU(x) >= 1);
      node(s.id, style, s.x, s.y, 20, { kind: "session", tint: allDone ? DONE : i === 1 ? TH.TINT.warm : TH.TINT.session, active: !allDone && i === 1 });
    });
    for (const task of TREE.tasks) {
      const g = grown(task);
      if (g <= 0) continue;
      const d = doneU(task);
      const base = task.working ? TH.TINT.warm : TH.TINT.task;
      node(task.id, style, task.x, task.y, task.r * Math.max(0.05, backOut(g)) * (1 + 0.25 * Math.sin(Math.PI * d)), { kind: "task", tint: d > 0 ? mixc(base, DONE, d) : base, active: task.working && d < 1, arrive: g, orbit: task.working && d < 1 ? 1.8 : 0 });
    }
    for (const td of TREE.todos) {
      const g = grown(td);
      if (g > 0) node(td.id, style, td.x, td.y, td.r * Math.max(0.05, backOut(g)), { kind: "todo", tint: doneU(td.parent) >= 1 ? DONE : TH.TINT.pending, arrive: g });
    }
    // callouts on the sessions, the way Command labels them
    SESSIONS.forEach((s, i) => {
      const mine = TREE.tasks.filter((x) => x.parent === s && lt > x.at);
      const done = mine.filter((x) => doneU(x) >= 1).length;
      const all = mine.length === 3 && done === 3;
      callout(s.x, s.y, 20, {
        side: -1, vert: i === 2 ? 1 : -1, length: i === 1 ? 70 : 40, bar: 0, number: s.number, title: s.title,
        counts: mine.length ? `${done} done · ${mine.length - done} left` : null,
        mark: all ? "check" : "live",
        thought: all ? "report sent to the hub" : s.thought,
      }, span(lt, 0.3 + i * 0.15, 1.2 + i * 0.15));
    });
    ctx.restore();
    headline(lt, "COMMAND VIEW", "Every task is a node.", "Every agent, a pulse you can follow.", { at: 0.0 });
    const doneCount = TREE.tasks.filter((x) => doneU(x) >= 1).length;
    text(`TASKS ${String(TREE.tasks.filter((x) => lt > x.at).length).padStart(2, "0")}   DONE ${String(doneCount).padStart(2, "0")}   RUNNING ${TREE.tasks.filter((x) => lt > x.at && x.working && doneU(x) < 1).length}`, W - 150, 176, { size: 17, weight: 500, family: MONO, align: "right", track: 3, fill: rgba(TH.INK, 0.7 * span(lt, 0.6, 1.0)) });
  }

  // ---- 4. the eight node styles, one a beat --------------------------------------------
  const STYLE_NAMES = { orbs: "CLASSIC ORBS", glass: "SOFT GLASS", minimal: "MINIMAL", halo: "HALO", crystal: "CRYSTAL", singularity: "SINGULARITY", prism: "PRISM", sigil: "SIGIL" };
  const STYLE_LINES = {
    orbs: "a lit core in a soft halo", glass: "frosted, with a moving highlight", minimal: "a clean dot that breathes",
    halo: "a ringed core, dashes on the turn", crystal: "a faceted gem catching the light", singularity: "a black hole with its own accretion disc",
    prism: "a turning crystal that splits the light", sigil: "a hex seal whose runes write themselves",
  };
  // The carousel's position: style i rests at the centre for the first part of
  // its beat, then the track glides one step to the next.
  const CAROUSEL_GAP = 560;
  function carouselPos(lt) {
    const last = styles.STYLES.length - 1;
    const i = clamp(Math.floor(lt / 0.4), 0, last);
    const frac = clamp((lt - i * 0.4) / 0.4);
    return i + (i < last ? easeInOut(clamp((frac - 0.4) / 0.6)) : 0);
  }
  function carouselNode(style, j, pos, alpha = 1) {
    const d = j - pos, focus = easeInOut(1 - clamp(Math.abs(d)));
    const x = W / 2 + d * CAROUSEL_GAP;
    if (x < -300 || x > W + 300) return null;
    return { x, y: H / 2, r: lerp(56, 150, focus), focus, alpha: alpha * lerp(0.5, 1, focus) };
  }
  function sceneStyles(t) {
    const lt = t - CUTS.styles;
    const list = [...styles.STYLES];
    const pos = carouselPos(lt);
    const near = clamp(Math.round(pos), 0, list.length - 1);
    const off = pos - near; // -0.5 … 0.5 from the nearest style
    const show = 1 - clamp(Math.abs(off) * 2); // 1 at rest, 0 halfway between two
    const style = list[near];
    const premium = styles.PREMIUM.includes(style);
    const glowMix = clamp(list.slice(0).reduce((acc, s, j) => acc + (styles.PREMIUM.includes(s) ? Math.max(0, 1 - Math.abs(j - pos)) : 0), 0));
    backdrop(t, { stars: 0.5, seed: 31, drift: 1.5, glowAt: { x: W / 2, y: H / 2, r: 600, a: lerp(0.1, 0.16, glowMix), color: mixc(TH.ACCENT, TH.ACCENT2, glowMix) } });
    const name = STYLE_NAMES[style] ?? style.toUpperCase();
    text(name, W / 2 - off * 700, H / 2 + 110, { size: 330, weight: 800, stretch: "condensed", align: "center", fill: null, stroke: rgba(TH.INK, 0.14 * show), lineWidth: 2 });
    ctx.strokeStyle = rgba(TH.INK, 0.09); ctx.lineWidth = 1;
    for (const rr of [190, 270, 350]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, rr, 0, TAU); ctx.stroke(); }
    // the track, drawn far to near so the focused node sits on top
    const order = list.map((s, j) => [s, j]).sort((a, b) => Math.abs(b[1] - pos) - Math.abs(a[1] - pos));
    for (const [s, j] of order) {
      const c = carouselNode(s, j, pos);
      if (!c) continue;
      node(`style-${s}`, s, c.x, c.y, c.r, { kind: "task", tint: j % 2 ? TH.TINT.warm : DONE, active: true, selected: c.focus > 0.9, orbit: c.focus > 0.5 ? 1.8 : 0, glow: styles.PREMIUM.includes(s), alpha: c.alpha });
    }
    text(`${String(near + 1).padStart(2, "0")}/${String(list.length).padStart(2, "0")}`, 150, 190, { size: 20, weight: 500, family: MONO, track: 4, fill: rgba(TH.INK, 0.7) });
    riseText(name, 150, 262, show, { size: 64, weight: 800, stretch: "condensed", stagger: 0.03 });
    text(premium ? "VOID COLLECTION" : "FREE STYLE", 150, 300, { size: 17, weight: 500, family: MONO, track: 4, fill: rgba(premium ? TH.ACCENT2 : TH.INK, 0.85 * show) });
    text(STYLE_LINES[style] ?? "", 150, 340, { size: 24, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.65 * show) });
  }

  // ---- 5. all eight at once ------------------------------------------------------------
  function sceneGrid(t) {
    const lt = t - CUTS.grid;
    const list = [...styles.STYLES];
    const last = list[list.length - 1];
    // everything of the carousel but its nodes eases away as the grid forms
    const leave = 1 - easeInOut(span(lt, 0, 0.5));
    backdrop(t, { stars: 0.5, seed: 31, drift: 1.5, glowAt: { x: W / 2, y: H / 2, r: 600, a: 0.16 * leave, color: TH.ACCENT2 } });
    if (leave > 0) {
      text(STYLE_NAMES[last], W / 2, H / 2 + 110, { size: 330, weight: 800, stretch: "condensed", align: "center", fill: null, stroke: rgba(TH.INK, 0.14 * leave), lineWidth: 2 });
      ctx.strokeStyle = rgba(TH.INK, 0.09 * leave); ctx.lineWidth = 1;
      for (const rr of [190, 270, 350]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, rr * lerp(1.3, 1, leave), 0, TAU); ctx.stroke(); }
      ctx.save(); ctx.globalAlpha = leave; ctx.translate(0, -30 * (1 - leave));
      text(`${String(list.length).padStart(2, "0")}/${String(list.length).padStart(2, "0")}`, 150, 190, { size: 20, weight: 500, family: MONO, track: 4, fill: rgba(TH.INK, 0.7) });
      text(STYLE_NAMES[last], 150, 262, { size: 64, weight: 800, stretch: "condensed" });
      text("VOID COLLECTION", 150, 300, { size: 17, weight: 500, family: MONO, track: 4, fill: rgba(TH.ACCENT2, 0.85) });
      text(STYLE_LINES[last] ?? "", 150, 340, { size: 24, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.65) });
      ctx.restore();
    }
    headline(lt, "NODE STYLES", "Eight looks. Every one alive.", null, { at: 0.3 });
    const endPos = list.length - 1;
    list.forEach((style, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const cx = 450 + col * 340, cy = 520 + row * 290;
      const from = carouselNode(style, i, endPos, 1) ?? { x: W / 2 + (i - endPos) * CAROUSEL_GAP, y: H / 2, r: 56 };
      const fx = Math.max(-200, from.x);
      const u = easeInOut(span(lt, 0.02 + (endPos - i) * 0.04, 0.8 + (endPos - i) * 0.04));
      const panel = easeOut(span(lt, 0.5 + i * 0.04, 0.9 + i * 0.04));
      if (panel > 0) glass(cx - 140, cy - 120, 280, 240, 18, 0.9 * panel);
      // an arc, not a straight line: the nodes swing up into their places
      const x = lerp(fx, cx, u), y = lerp(from.y, cy - 18, u) - Math.sin(Math.PI * u) * 90;
      node(`style-${style}`, style, x, y, lerp(from.r ?? 56, 52, u), { kind: "task", tint: i % 2 ? TH.TINT.warm : DONE, active: true, orbit: 1.8, glow: styles.PREMIUM.includes(style) });
      if (panel > 0) text(STYLE_NAMES[style], cx, cy + 92, { size: 15, weight: 600, family: MONO, align: "center", track: 3, fill: rgba(styles.PREMIUM.includes(style) ? TH.ACCENT2 : TH.INK, 0.85 * panel) });
    });
  }

  // ---- 6. the same tree in four themes -----------------------------------------------------
  const THEME_RUN = ["aurora", "eclipse", "abyss", "dusk"].filter((k) => THEMES[k]);
  function miniTree(lt, id, style) {
    const hub = { x: 1180, y: 560 };
    const turn = lt * 0.22;
    const leaves = [[-300, -200], [-340, 40], [-230, 230], [260, -220], [330, 20], [240, 240]].map(([dx, dy]) => {
      const a = Math.atan2(dy, dx) + turn, r = Math.hypot(dx, dy);
      return [Math.cos(a) * r, Math.sin(a) * r * 0.82];
    });
    leaves.forEach(([dx, dy], i) => {
      const b = { x: hub.x + dx, y: hub.y + dy };
      wire(style, hub, b, { id: `${id}-w${i}`, kind: "task", tint: i % 2 ? TH.TINT.task : TH.TINT.session, alpha: 0.5, width: 1.2, rA: 40, rB: 22, active: i === 1 || i === 4, march: i === 1 || i === 4 });
      pulse(style, hub, b, ((lt * 0.8 + i * 0.3) % 1.4) * 1.3, { rA: 40, rB: 22, color: toHex(TH.ACCENT2) });
    });
    leaves.forEach(([dx, dy], i) => node(`${id}-n${i}`, style, hub.x + dx, hub.y + dy, 24, { kind: "task", tint: [DONE, TH.TINT.warm, TH.TINT.task, TH.TINT.verify, TH.TINT.warm, DONE][i], active: i === 1 || i === 4, orbit: i === 1 ? 1.8 : 0 }));
    node(`${id}-hub`, style, hub.x, hub.y, 44, { kind: "assistant", tint: TH.TINT.hub, active: true });
  }
  function sceneThemes(t) {
    const lt = t - CUTS.themes;
    const slot = 0.8;
    const idx = clamp(Math.floor(lt / slot), 0, THEME_RUN.length - 1);
    const into = clamp((lt - idx * slot) / slot);
    const prev = themeOf(idx > 0 ? THEME_RUN[idx - 1] : BASE.key), cur = themeOf(THEME_RUN[idx]);
    // the whole picture eases from one theme's colours into the next
    TH = blendTheme(prev, cur, easeInOut(clamp(into / 0.5)));
    hudTheme = cur.name;
    ctx.fillStyle = rgba(TH.BG); ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(1180, 560, 0, 1180, 560, 720);
    g.addColorStop(0, rgba(TH.ACCENT, 0.16)); g.addColorStop(1, rgba(TH.ACCENT, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    starfield(t, 0.6, 0.6, 43);
    miniTree(lt, "theme", "prism");
    riseText("THEMES", 150, 176, span(lt, 0, 0.6), { size: 20, weight: 600, family: MONO, track: 6, fill: rgba(TH.BRIGHT) });
    riseText("Eleven themes.", 150, 252, span(lt, 0.1, 0.8), { size: 64, weight: 700 });
    riseText("Every surface follows.", 150, 316, span(lt, 0.3, 1.1), { size: 38, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.72), stagger: 0.02 });
    // the theme's name, rolling in on its beat
    ctx.save();
    ctx.beginPath(); ctx.rect(140, 470, 700, 170); ctx.clip();
    const roll = easeInOut(clamp(into * 2.2));
    if (roll < 1) text((idx > 0 ? prev.name : "").toUpperCase(), 150, 600 - roll * 170, { size: 130, weight: 800, stretch: "condensed", fill: rgba(TH.INK, 0.9) });
    text(cur.name.toUpperCase(), 150, 600 + (1 - roll) * 170, { size: 130, weight: 800, stretch: "condensed", fill: rgba(TH.ACCENT) });
    ctx.restore();
    // every theme as a swatch; the ring glides to this one
    const keys = Object.keys(THEMES);
    const ringAt = lerp(keys.indexOf(prev.key), keys.indexOf(cur.key), easeInOut(clamp(into / 0.5)));
    keys.forEach((key, i) => {
      const x = 170 + i * 52, y = 720, info = THEMES[key].info;
      ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fillStyle = info.bg; ctx.fill();
      ctx.strokeStyle = rgba(TH.INK, 0.2); ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fillStyle = info.accent; ctx.fill();
    });
    ctx.beginPath(); ctx.arc(170 + ringAt * 52, 720, 21, 0, TAU); ctx.strokeStyle = rgba(TH.INK, 0.9); ctx.lineWidth = 2; ctx.stroke();
    text(`${String(keys.indexOf(cur.key) + 1).padStart(2, "0")}/${String(keys.length).padStart(2, "0")} · STYLE & SOUND`, 150, 780, { size: 16, weight: 500, family: MONO, track: 3, fill: rgba(TH.INK, 0.55) });
  }

  // ---- 7. the crew ------------------------------------------------------------------------
  const CREW = ["thinker", "builder", "watcher", "auditor", "keeper", "overseer"].filter((role) => look.AGENT_COLORS[role]);
  const CREW_HUB = { x: 1260, y: 540 };
  function sceneCrew(t) {
    const lt = t - CUTS.crew;
    backdrop(t, { stars: 0.7, seed: 41, drift: -0.6 });
    const style = "sigil", cx = CREW_HUB.x, cy = CREW_HUB.y;
    const zoom = lerp(1.12, 1, expoOut(span(lt, 0, 1.2)));
    ctx.save(); ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);
    ctx.strokeStyle = rgba(TH.INK, 0.08); ctx.lineWidth = 1;
    for (const rr of [250, 360]) { ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, TAU); ctx.stroke(); }
    const agents = CREW.map((role, i) => {
      const ring = i % 2 ? 360 : 250, ang = i / CREW.length * TAU + lt * 0.4;
      return { role, i, x: cx + Math.cos(ang) * ring, y: cy + Math.sin(ang) * ring * 0.62, z: Math.sin(ang) };
    });
    const statusOf = (i) => { const s = lt - 0.5 - i * 0.3; return s < 0 ? "queued" : s < 1.8 ? "running" : "done"; };
    for (const a of agents) {
      const tint = hex(look.AGENT_COLORS[a.role]);
      const cp = wire(style, { x: a.x, y: a.y }, { x: cx, y: cy }, { id: `tether-${a.role}`, kind: "tether", tint, alpha: 0.4, dash: [6, 4], march: true, active: true, curved: false, rA: 26, rB: 64 });
      pulse(style, { x: a.x, y: a.y }, { x: cx, y: cy }, (lt * 0.9 + a.i * 0.37) % 1.6, { wave: true, packet: true, color: look.AGENT_COLORS[a.role], rA: 26, rB: 64, cp });
    }
    node("crew-hub", style, cx, cy, 64, { kind: "assistant", tint: TH.TINT.hub, active: true, crew: true });
    for (const a of [...agents].sort((p, q) => p.z - q.z)) {
      const status = statusOf(a.i);
      const tint = status === "done" ? DONE : status === "queued" ? TH.MUTED : hex(look.AGENT_COLORS[a.role]);
      node(`crew-${a.role}`, style, a.x, a.y, 26 + a.z * 4, { kind: "agent", role: a.role, status, tint, active: status === "running" });
      text(a.role.toUpperCase(), a.x, a.y + 58, { size: 14, weight: 500, family: MONO, align: "center", track: 3, fill: rgba(TH.INK, 0.55) });
    }
    ctx.restore();
    riseText("YOUR CREW,", 150, 420, span(lt, 0.1, 0.9), { size: 110, weight: 800, stretch: "condensed" });
    riseText("WORKING IN", 150, 530, span(lt, 0.25, 1.05), { size: 110, weight: 800, stretch: "condensed" });
    riseText("THE OPEN.", 150, 640, span(lt, 0.4, 1.2), { size: 110, weight: 800, stretch: "condensed", fill: rgba(TH.ACCENT2) });
    riseText("Each agent a live node with its own ring: queued, running, done.", 150, 700, span(lt, 0.9, 1.9), { size: 24, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.7), stagger: 0.012 });
  }

  // ---- 8. a task from Ready to Done ----------------------------------------------------------
  const FLOW = { x0: 300, x1: 1620, y: 560 };
  function sceneFlow(t) {
    const lt = t - CUTS.flow;
    backdrop(t, { stars: 0.4, seed: 47 });
    const style = "halo", { x0, x1, y } = FLOW;
    const cols = ["READY", "WORKING", "REVIEW", "DONE"];
    const colX = (i) => lerp(x0, x1, i / (cols.length - 1));
    const draw = expoOut(span(lt, 0, 0.6));
    ctx.strokeStyle = rgba(TH.INK, 0.18); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(lerp(x0, x1, draw), y); ctx.stroke();
    cols.forEach((c, i) => {
      const cu = span(lt, 0.1 + i * 0.1, 0.6 + i * 0.1);
      text(c, colX(i), y + 110, { size: 22, weight: 600, family: MONO, align: "center", track: 6, fill: rgba(TH.INK, 0.75 * cu) });
      ctx.fillStyle = rgba(TH.INK, 0.35 * cu); ctx.fillRect(colX(i) - 1, y - 14, 2, 28);
    });
    const stops = [0.5, 1.1, 1.8, 2.4];
    let pos = 0;
    for (let i = 1; i < stops.length; i += 1) pos += expoInOut(span(lt, stops[i - 1] + 0.05, stops[i] - 0.05));
    const x = lerp(x0, x1, pos / 3);
    const stage = Math.round(pos);
    const tint = stage >= 3 ? DONE : stage === 2 ? TH.TINT.verify : stage === 1 ? AMBER : TH.TINT.task;
    for (let i = 1; i < 18; i += 1) {
      const tx = lerp(x0, x1, Math.max(0, pos - i * 0.012) / 3);
      ctx.fillStyle = rgba(tint, 0.22 * (1 - i / 18)); ctx.beginPath(); ctx.arc(tx, y, 34 * (1 - i / 22), 0, TAU); ctx.fill();
    }
    node("flow-task", style, x, y, 46 + (stage === 3 ? 8 * backOut(span(lt, 2.35, 2.6)) : 0), { kind: "task", tint, active: stage === 1, selected: stage === 3, orbit: stage === 1 ? 1.8 : 0 });
    callout(x, y, 46, { side: 1, vert: -1, length: 34, bar: 250, number: "02", title: "Theme tokens", counts: ["queued", "running", "verifying", "done"][stage], mark: stage === 3 ? "check" : "live", thought: ["waiting for a builder", "editing styles.css", "npm test · running", "merged into main"][stage] }, span(lt, 0.3, 1.0));
    ["npm run check", "npm test", "npm run audit"].forEach((c, i) => {
      const cu = span(lt, 1.35 + i * 0.12, 1.55 + i * 0.12);
      if (cu > 0) text(`${cu >= 1 ? "✓" : "…"}  ${c}`, colX(2) - 150, y - 250 + i * 44, { size: 22, weight: 500, family: MONO, fill: rgba(cu >= 1 ? DONE : TH.INK, 0.9 * cu) });
    });
    [[0.15, "thinker", "split the idea into 3 tasks", "+0:04"], [0.7, "builder", "editing renderer/styles.css, settings.js", "+2:31"], [1.2, "builder", "done · 4 files changed", "+6:48"], [1.5, "auditor", "npm test · 3,605 pass, 0 fail", "+7:02"], [2.1, "keeper", "merged into main", "+7:40"]].forEach(([at, who, what, stamp], i) => {
      const lu = span(lt, at, at + 0.35);
      if (lu <= 0) return;
      const yy = 790 + i * 38;
      text(stamp, 300, yy, { size: 19, weight: 500, family: MONO, fill: rgba(TH.INK, 0.35) });
      text(who.toUpperCase(), 420, yy, { size: 19, weight: 600, family: MONO, track: 2, fill: rgba(hex(look.AGENT_COLORS[who] ?? toHex(TH.BRIGHT)), 0.95) });
      text(what.slice(0, Math.ceil(what.length * lu)), 590, yy, { size: 19, weight: 500, family: MONO, fill: rgba(TH.INK, 0.8) });
    });
    headline(lt, "TASK FLOW", "From idea to merged,", "with the checks in plain sight.", { at: 0 });
  }

  // ---- 9. the numbers, as status tiles --------------------------------------------------------
  const STATS = [
    { value: 8, label: "NODE STYLES", note: "five free, three Void" },
    { value: 11, label: "THEMES", note: "and your own palettes" },
    { value: 3600, label: "TESTS PASSING", note: "every change is checked", plus: true },
    { value: 0, from: 99, label: "TELEMETRY CALLS", note: "nothing phones home" },
  ];
  function sceneNumbers(t) {
    const lt = t - CUTS.numbers;
    backdrop(t, { stars: 0.4, seed: 53, glowAt: { x: W / 2, y: 600, r: 900, a: 0.07 } });
    headline(lt, "BY THE NUMBERS", "Built to be watched.", null, { at: 0 });
    STATS.forEach((s, i) => {
      const at = i * 0.8;
      const u = expoOut(span(lt, at, at + 0.35));
      if (u <= 0) return;
      const w = 360, h = 330, gap = 36, x = (W - (4 * w + 3 * gap)) / 2 + i * (w + gap), y = 430 + (1 - u) * 40;
      const active = lt >= at && lt < at + 0.8;
      ctx.save(); ctx.globalAlpha = u;
      glass(x, y, w, h, 20);
      if (active) { ctx.fillStyle = rgba(TH.ACCENT2); ctx.fillRect(x + 24, y + 22, 44 * easeOut(span(lt, at, at + 0.3)), 3); }
      const c = easeOut(span(lt, at + 0.05, at + 0.6));
      const v = Math.round(lerp(s.from ?? 0, s.value, c));
      const str = v.toLocaleString("en-US") + (s.plus && c >= 1 ? "+" : "");
      text(str, x + 24, y + 190, { size: 150, weight: 800, stretch: "condensed", fill: rgba(active ? TH.INK : mixc(TH.INK, TH.MUTED, 0.4)) });
      text(s.label, x + 26, y + 240, { size: 17, weight: 600, family: MONO, track: 3, fill: rgba(active ? TH.ACCENT2 : TH.INK, 0.85) });
      text(s.note, x + 26, y + 280, { size: 20, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.6) });
      ctx.restore();
    });
  }

  // ---- 10. principles, as the app's own settings --------------------------------------------------
  const ROWS = [
    { label: "Run everything on this machine", note: "Projects, stores and history stay local", control: "on" },
    { label: "Send usage telemetry", note: "There is none to turn on", control: "off" },
    { label: "Sign in to an account", note: "Not needed. Open the app and go", control: "NOT NEEDED" },
    { label: "License", note: "Open source, forever", control: "MIT" },
  ];
  function scenePrinciples(t) {
    const lt = t - CUTS.principles;
    backdrop(t, { stars: 0.4, seed: 59, glowAt: { x: 1180, y: 540, r: 800, a: 0.08 } });
    riseText("SETTINGS · PRIVACY", 150, 360, span(lt, 0, 0.6), { size: 20, weight: 600, family: MONO, track: 6, fill: rgba(TH.BRIGHT) });
    riseText("Yours.", 150, 470, span(lt, 0.1, 0.8), { size: 120, weight: 800, stretch: "condensed" });
    riseText("Locally.", 150, 590, span(lt, 0.25, 0.95), { size: 120, weight: 800, stretch: "condensed", fill: rgba(TH.ACCENT2) });
    const px = 760, py = 250, pw = 1010, ph = 560;
    const u = expoOut(span(lt, 0, 0.45));
    ctx.save(); ctx.globalAlpha = u; ctx.translate(0, (1 - u) * 30);
    glass(px, py, pw, ph, 22);
    text("Privacy & data", px + 40, py + 64, { size: 30, weight: 600, family: UI });
    ctx.fillStyle = rgba(TH.INK, 0.1); ctx.fillRect(px + 40, py + 92, pw - 80, 1);
    ROWS.forEach((row, i) => {
      const at = 0.25 + i * 0.8, ry = py + 130 + i * 104;
      const on = span(lt, at, at + 0.25);
      const active = lt >= at && lt < at + 0.8;
      if (active) { roundRect(px + 20, ry - 12, pw - 40, 92, 14); ctx.fillStyle = rgba(TH.ACCENT, 0.08 * easeOut(on)); ctx.fill(); ctx.fillStyle = rgba(TH.ACCENT2, 0.9); ctx.fillRect(px + 20, ry, 3, 68); }
      text(row.label, px + 44, ry + 30, { size: 24, weight: 600, family: UI, fill: rgba(TH.INK, 0.95) });
      text(row.note, px + 44, ry + 62, { size: 18, weight: 400, family: UI, fill: rgba(TH.INK, 0.55) });
      const cx = px + pw - 60;
      if (row.control === "on" || row.control === "off") {
        const lit = row.control === "on" ? easeOut(on) : 0;
        roundRect(cx - 70, ry + 18, 70, 36, 18);
        ctx.fillStyle = row.control === "on" ? rgba(mixc(TH.INK, TH.ACCENT, 0.2 + 0.8 * lit), 0.25 + 0.6 * lit) : rgba(TH.INK, 0.1);
        ctx.fill(); ctx.strokeStyle = rgba(TH.INK, 0.2); ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx - 52 + 34 * lit, ry + 36, 13, 0, TAU); ctx.fillStyle = rgba(row.control === "on" ? mixc(TH.MUTED, [255, 255, 255], lit) : TH.MUTED); ctx.fill();
        if (row.control === "off" && on > 0) {
          // a lock: telemetry cannot be turned on
          ctx.save(); ctx.globalAlpha *= easeOut(on);
          ctx.strokeStyle = rgba(TH.INK, 0.7); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx - 100, ry + 30, 7, Math.PI, 0); ctx.stroke();
          roundRect(cx - 110, ry + 30, 20, 16, 3); ctx.fillStyle = rgba(TH.INK, 0.7); ctx.fill();
          ctx.restore();
        }
      } else {
        const w = measure(row.control, { size: 16, weight: 700, family: MONO, track: 3 }) + 32;
        ctx.save(); ctx.globalAlpha *= easeOut(on);
        roundRect(cx - w, ry + 18, w, 36, 18); ctx.fillStyle = rgba(row.control === "MIT" ? TH.ACCENT2 : TH.ACCENT, 0.22); ctx.fill();
        ctx.strokeStyle = rgba(row.control === "MIT" ? TH.ACCENT2 : TH.ACCENT, 0.6); ctx.stroke();
        text(row.control, cx - w / 2, ry + 42, { size: 16, weight: 700, family: MONO, align: "center", track: 3, fill: rgba(TH.INK) });
        ctx.restore();
      }
    });
    ctx.restore();
  }

  // ---- 11. the end card -----------------------------------------------------------------------
  function sceneEnd(t) {
    const lt = t - CUTS.end;
    backdrop(t, { stars: 0.6, seed: 61, drift: 0.3, glowAt: { x: 560, y: 540, r: 760, a: 0.16 } });
    // a faint constellation turning behind the icon
    ctx.save(); ctx.globalAlpha = 0.35 * easeOut(span(lt, 0.4, 1.6));
    const list = [...styles.STYLES];
    for (let i = 0; i < 7; i += 1) {
      const a = lt * 0.25 + i * TAU / 7;
      const x = 560 + Math.cos(a) * 360, y = 540 + Math.sin(a) * 150;
      ctx.strokeStyle = rgba(TH.INK, 0.12); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(560, 540); ctx.lineTo(x, y); ctx.stroke();
      node(`end-orbit-${i}`, list[i % list.length], x, y, 10 + Math.sin(a) * 3, { kind: "task", tint: [DONE, TH.TINT.warm, TH.ACCENT2, TH.TINT.task][i % 4], active: true });
    }
    ctx.restore();
    drawIcon(560, 540, 300, span(lt, 0.0, 1.3));
    riseText("MEFI'S STUDIO", 800, 520, span(lt, 0.4, 1.2), { size: 150, weight: 800, stretch: "condensed" });
    riseText("AI+", 800, 640, span(lt, 0.65, 1.35), { size: 100, weight: 800, stretch: "condensed", fill: rgba(TH.ACCENT) });
    riseText("agents you can watch work", 990, 630, span(lt, 0.85, 1.8), { size: 50, weight: 400, family: SERIF, fill: rgba(TH.INK, 0.85), stagger: 0.02 });
    ctx.fillStyle = rgba(TH.INK, 0.4); ctx.fillRect(800, 690, 980 * expoOut(span(lt, 1.2, 1.9)), 1.5);
    let x = 800;
    ["v0.4.0", "WINDOWS", "MIT", "GITHUB.COM/NATEECHO32-STACK/MEFI-STUDIO"].forEach((item, i) => {
      const o = { size: 19, weight: 600, family: MONO, track: 3, fill: rgba(i === 3 ? TH.BRIGHT : TH.INK, 0.85 * span(lt, 1.35 + i * 0.12, 1.7 + i * 0.12)) };
      text(item, x, 740, o);
      x += measure(item, o) + 44;
    });
  }

  // ---- the running order -------------------------------------------------------------------------
  // iris: the point the scene opens out of over the previous one (null: a
  // straight cut, where the two scenes meet on the same picture).
  const SCENES = [
    { key: "ignite", fn: sceneIgnite, label: "IGNITION" },
    { key: "prompt", fn: scenePrompt, label: "NEW TASK", iris: { x: W / 2, y: H / 2 - 70 } },
    { key: "tree", fn: sceneTree, label: "COMMAND VIEW", iris: null },
    { key: "styles", fn: sceneStyles, label: "NODE STYLES", iris: { x: 760, y: 630 } },
    { key: "grid", fn: sceneGrid, label: "NODE STYLES", iris: null },
    { key: "themes", fn: sceneThemes, label: "THEMES", iris: { x: 1130, y: 500 } },
    { key: "crew", fn: sceneCrew, label: "THE CREW", iris: { x: 1180, y: 560 } },
    { key: "flow", fn: sceneFlow, label: "TASK FLOW", iris: { x: CREW_HUB.x, y: CREW_HUB.y } },
    { key: "numbers", fn: sceneNumbers, label: "BY THE NUMBERS", iris: { x: FLOW.x1, y: FLOW.y } },
    { key: "principles", fn: scenePrinciples, label: "PRIVACY", iris: { x: W / 2, y: 600 } },
    { key: "end", fn: sceneEnd, label: "MEFI'S STUDIO AI+", iris: { x: 1260, y: 530 } },
  ];
  const IRIS_BEFORE = 0.4, IRIS_AFTER = 0.4;
  function renderScene(i, t) {
    TH = BASE;
    ctx.save();
    SCENES[i].fn(t);
    ctx.restore();
    TH = BASE;
  }
  // Scene j opening out of its iris point over what is already drawn.
  function iris(j, t) {
    const at = CUTS[SCENES[j].key];
    const u = easeInOut(span(t, at - IRIS_BEFORE, at + IRIS_AFTER));
    const { x, y } = SCENES[j].iris;
    const r = u * (Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) + 40);
    if (r <= 0.5) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    renderScene(j, t);
    ctx.restore();
    // the iris edge: a thin ring in the accent, like a node's own rim
    if (u < 1) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
      ctx.strokeStyle = rgba(BASE.ACCENT2, 0.55 * (1 - u)); ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + 10, 0, TAU);
      ctx.strokeStyle = rgba(BASE.ACCENT, 0.2 * (1 - u)); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
  }

  function draw(t) {
    if (t < lastT) records.clear();
    frameDt = lastT < 0 || t < lastT ? 1 / 60 : clamp(t - lastT, 0, 0.1);
    lastT = t; now = t;
    hudTheme = BASE.name;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let i = 0;
    while (i + 1 < SCENES.length && t >= CUTS[SCENES[i + 1].key]) i += 1;
    const next = SCENES[i + 1];
    if (SCENES[i].iris && t < CUTS[SCENES[i].key] + IRIS_AFTER) {
      renderScene(i - 1, t);
      iris(i, t);
    } else if (next && next.iris && t >= CUTS[next.key] - IRIS_BEFORE) {
      renderScene(i, t);
      iris(i + 1, t);
    } else {
      renderScene(i, t);
    }
    vignette(0.55);
    grain(t);
    hud(t, SCENES[i].label, i + 1, SCENES.length);
    const fin = span(t, 0, 0.3), fout = span(t, DURATION - 0.9, DURATION - 0.05);
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
