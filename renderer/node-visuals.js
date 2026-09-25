// Shared graph finishes. Each view owns geometry, work state and animation.
// Unit-space paints follow the canvas transform and are bounded per context.
(() => {
  "use strict";
  const paints = new WeakMap(), texts = new WeakMap();
  let currentPalette = null;
  const TAU = Math.PI * 2;
  const styles = new Set(["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"]);
  const channels = (color) => {
    if (Array.isArray(color)) return color;
    const value = String(color ?? "#9db7ff");
    if (value.startsWith("#")) {
      const hex = value.length === 4 ? value.slice(1).split("").map((c) => c + c).join("") : value.slice(1, 7);
      const n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return (value.match(/[\d.]+/g) ?? [157, 183, 255]).slice(0, 3).map(Number);
  };
  const rgba = (color, a) => `rgba(${channels(color).join(",")},${a})`;
  const mix = (a, b, amount) => {
    const left = channels(a), right = channels(b);
    return `rgb(${left.map((v, i) => Math.round(v + (right[i] - v) * amount)).join(",")})`;
  };
  function palette() {
    if (currentPalette) return currentPalette;
    const css = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
    const read = (key, fallback) => css?.getPropertyValue(key).trim() || fallback;
    const canvas = window.MefiMusic?.themePalette?.()?.canvas ?? {};
    currentPalette = Object.freeze({
      background: canvas.background ?? read("--bg", "#071117"), surface: read("--panel-solid", "#10232c"),
      text: canvas.text ?? read("--ivory", "#e7f5ee"), muted: canvas.muted ?? read("--muted", "#abc4c9"),
      dim: canvas.dim ?? read("--dim", "#7c8a8c"), accent: canvas.accent ?? read("--gold", "#71cbb7"),
      bright: canvas.bright ?? read("--gold-bright", "#a7f3da"), accent2: canvas.accent2 ?? read("--info", "#9db7ff"),
      live: read("--live", "#57ff9a"), good: read("--good", "#afdfc2"), warn: read("--warn", "#ffd479"), bad: read("--bad", "#ff9c9c"),
    });
    return currentPalette;
  }
  function cachedPaint(ctx, color, lit, P) {
    let cache = paints.get(ctx);
    if (!cache) { cache = new Map(); paints.set(ctx, cache); }
    const key = `${color}|${lit}|${P.surface}|${P.accent2}`;
    if (cache.has(key)) return cache.get(key);
    const ink = mix(color, "#ffffff", 0.72), deep = mix(P.surface, color, 0.12);
    const body = ctx.createRadialGradient(-0.32, -0.4, 0.03, 0, 0, 1);
    body.addColorStop(0, mix(color, "#ffffff", 0.6)); body.addColorStop(0.3, rgba(color, lit ? 0.85 : 0.64));
    body.addColorStop(0.72, rgba(color, 0.2)); body.addColorStop(1, rgba(color, 0.04));
    const glass = ctx.createLinearGradient(-0.7, -1, 0.6, 1);
    glass.addColorStop(0, rgba(ink, 0.38)); glass.addColorStop(0.48, rgba(color, 0.12)); glass.addColorStop(1, rgba(color, 0.03));
    const glow = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 2.4);
    glow.addColorStop(0, rgba(color, lit ? 0.24 : 0.09)); glow.addColorStop(1, rgba(color, 0));
    const result = { body, glass, glow, ink, deep, rim: rgba(color, lit ? 0.95 : 0.65), shade: mix(color, P.surface, 0.55), accent: P.accent2 };
    if (cache.size >= 96) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function polygon(ctx, r, count = 6) {
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const a = i * TAU / count - Math.PI / 2;
      if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function drawNode(ctx, p, radius, color, { style = "orbs", active = false, selected = false, glyph = false, extraGlow = false } = {}) {
    if (!styles.has(style) || !Number.isFinite(radius) || radius <= 0) return false;
    const P = palette(), lit = Boolean(active || selected), tint = Array.isArray(color) ? `rgb(${color.join(",")})` : color;
    const paint = cachedPaint(ctx, tint, lit, P);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(radius, radius);
    if (style !== "minimal" && (lit || extraGlow || style === "orbs")) {
      ctx.save();
      if (extraGlow) ctx.globalAlpha *= 1.45;
      ctx.fillStyle = paint.glow; circle(ctx, 0, 0, 2.4); ctx.fill(); ctx.restore();
    }
    ctx.lineWidth = (selected ? 1.8 : active ? 1.35 : 0.9) / radius; ctx.strokeStyle = paint.rim;
    if (style === "minimal") {
      circle(ctx, 0, 0, active || selected ? 0.68 : 0.5); ctx.fillStyle = tint; ctx.fill();
    } else if (style === "crystal" || style === "prism") {
      const shape = window.MefiTree?.voidShapes;
      const path = () => { if (style === "prism" && shape) { ctx.beginPath(); shape.trace(ctx, shape.prismRim); } else polygon(ctx, 1); };
      path(); ctx.fillStyle = paint.deep; ctx.fill(); ctx.fillStyle = paint.glass; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.beginPath(); ctx.moveTo(0, -1.1); ctx.lineTo(-1, -0.12); ctx.lineTo(0, 0.25); ctx.closePath(); ctx.fillStyle = tint; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -1.1); ctx.lineTo(1, -0.12); ctx.lineTo(0, 0.25); ctx.closePath(); ctx.fillStyle = paint.ink; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 0.25); ctx.lineTo(1, -0.12); ctx.lineTo(0, 1.1); ctx.closePath(); ctx.fillStyle = paint.shade; ctx.fill(); ctx.restore();
      path(); ctx.stroke();
      if (glyph) { circle(ctx, 0, 0, 0.64); ctx.fillStyle = paint.deep; ctx.fill(); }
    } else if (style === "singularity") {
      circle(ctx, 0, 0, 1); ctx.fillStyle = paint.deep; ctx.fill(); ctx.fillStyle = paint.glass; ctx.fill(); ctx.stroke();
      circle(ctx, 0, 0, 0.67); ctx.fillStyle = P.background; ctx.fill(); ctx.strokeStyle = paint.ink; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, 1.16, 0.45, -0.35, Math.PI, TAU); ctx.strokeStyle = paint.accent; ctx.lineWidth = 1.5 / radius; ctx.stroke();
    } else {
      circle(ctx, 0, 0, 1); ctx.fillStyle = paint.deep; ctx.fill();
      ctx.fillStyle = style === "orbs" ? paint.body : paint.glass; ctx.fill(); ctx.stroke();
      if (style === "sigil") {
        polygon(ctx, 0.76); ctx.strokeStyle = paint.accent; ctx.lineWidth = 0.8 / radius; ctx.stroke();
        if (!glyph) { polygon(ctx, 0.28, 3); ctx.fillStyle = paint.ink; ctx.fill(); }
      } else if (style === "halo") {
        circle(ctx, 0, 0, 0.67); ctx.strokeStyle = paint.accent; ctx.lineWidth = 0.7 / radius; ctx.stroke();
        if (!glyph) { circle(ctx, 0, 0, 0.17); ctx.fillStyle = paint.ink; ctx.fill(); }
      }
      if (radius >= 5 && (style === "orbs" || style === "glass")) {
        ctx.beginPath(); ctx.arc(0, 0, 0.82, Math.PI * 1.12, Math.PI * 1.6); ctx.strokeStyle = paint.ink; ctx.lineWidth = 0.8 / radius; ctx.stroke();
      }
    }
    if (glyph && style !== "minimal" && radius >= 4.5) {
      circle(ctx, 0, 0, 0.62); ctx.fillStyle = paint.deep; ctx.fill();
    }
    // Separate subpaths prevent a chord from connecting the two brackets.
    if (selected) {
      ctx.strokeStyle = P.text; ctx.lineWidth = 1 / radius;
      ctx.beginPath(); ctx.arc(0, 0, 1 + 2 / radius, -0.5, 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1 + 2 / radius, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
    }
    ctx.restore();
    return true;
  }
  function fitText(ctx, text, maxWidth, font = ctx.font) {
    text = String(text ?? "").replace(/\s+/g, " ").trim();
    let cache = texts.get(ctx);
    if (!cache) { cache = new Map(); texts.set(ctx, cache); }
    const key = `${font}|${maxWidth}|${text}`;
    if (cache.has(key)) return cache.get(key);
    const before = ctx.font; ctx.font = font;
    let result = text;
    if (ctx.measureText(text).width > maxWidth) {
      const chars = Array.from(text);
      let low = 0, high = chars.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (ctx.measureText(chars.slice(0, mid).join("") + "…").width <= maxWidth) low = mid; else high = mid - 1;
      }
      result = ctx.measureText("…").width <= maxWidth ? chars.slice(0, low).join("").trimEnd() + "…" : "";
    }
    ctx.font = before;
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  }
  function endpoints(a, b, ar = 0, br = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!length) return { a, b };
    const start = Math.min(Math.max(0, ar), length * 0.45), end = Math.min(Math.max(0, br), length * 0.45);
    return { a: { x: a.x + dx / length * start, y: a.y + dy / length * start }, b: { x: b.x - dx / length * end, y: b.y - dy / length * end } };
  }
  window.addEventListener("mefi-theme-change", () => { currentPalette = null; });
  window.MefiNodeVisuals = Object.freeze({ palette, drawNode, fitText, endpoints, rgba, mix,
    surfacePaints: (ctx, color, active = false) => cachedPaint(ctx, color, Boolean(active), palette()),
  });
})();
