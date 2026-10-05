"use strict";

// What the Electron fixtures measure about the words on a page, in real pixels: every line of text a person reads under
// a root (decorative marks, aria-hidden or drawn at a zero font size, are not), whether any is under 12 px, and whether
// any reads at less than 4.5:1 against what is painted behind it at that point (a sibling drawn behind it included,
// a gradient counted as the mean of its stops, everything composited over the theme's --bg). Text in a dimmed or
// disabled control is left out, as WCAG leaves out inactive controls. `textProbe(selector)` is a script for
// webContents.executeJavaScript inside an async function: it returns { count, small, low }.
const textProbe = (selector) => `
  const root = document.querySelector(${JSON.stringify(selector)});
  if (!root) return { count: 0, small: [], low: [], missing: true };
  const shown = (node) => { if (!node.getClientRects().length) return false; for (let n = node; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const own = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
  const rgba = (value) => { let m = /^rgba?\\(([^)]+)\\)/.exec(value); if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; } m = /^color\\(srgb ([^)]+)\\)/.exec(value); if (m) { const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } return null; };
  const hex = (value) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value).trim()); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1] : null; };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const base = hex(getComputedStyle(document.documentElement).getPropertyValue('--bg')) || [5, 13, 19, 1];
  const paint = (node) => { const s = getComputedStyle(node); let c = rgba(s.backgroundColor); const stops = s.backgroundImage === 'none' ? [] : [...s.backgroundImage.matchAll(/rgba?\\([^)]+\\)|color\\(srgb[^)]+\\)/g)].map((m) => rgba(m[0])).filter(Boolean); if (stops.length) { const mean = stops.reduce((a, x) => [a[0] + x[0], a[1] + x[1], a[2] + x[2], a[3] + x[3]], [0, 0, 0, 0]).map((v) => v / stops.length); c = c && c[3] > 0 ? over(mean, c) : mean; } return c && c[3] > 0 ? c : null; };
  const behind = (node) => { const r = node.getClientRects()[0]; let under = null; if (r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth) { const stack = document.elementsFromPoint(r.left + Math.min(r.width / 2, 10), r.top + r.height / 2); const at = stack.indexOf(node); if (at >= 0) under = stack.slice(at); } if (!under) { under = []; for (let n = node; n; n = n.parentElement) under.push(n); } let color = base; for (const layer of under.reverse()) { const c = paint(layer); if (c) color = over(c, color); } return color; };
  const dimmed = (node) => { for (let n = node; n && n !== document.documentElement; n = n.parentElement) { if (parseFloat(getComputedStyle(n).opacity) < 0.95 || n.disabled || n.getAttribute?.('aria-disabled') === 'true') return true; } return false; };
  const name = (node) => (node.id || String(node.className).slice(0, 40) || node.tagName) + ':' + node.textContent.trim().slice(0, 30);
  const text = [root, ...root.querySelectorAll('*')].filter((node) => shown(node) && own(node) && !node.closest('[aria-hidden="true"]') && parseFloat(getComputedStyle(node).fontSize) > 0);
  const small = text.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 11.95).map((node) => name(node) + ':' + getComputedStyle(node).fontSize);
  const low = text.filter((node) => !dimmed(node)).map((node) => { const ink = rgba(getComputedStyle(node).color); if (!ink) return null; const under = behind(node); const r = ratio(over(ink, under), under); return r < 4.5 ? name(node) + ' at ' + (Math.round(r * 100) / 100) + ':1' : null; }).filter(Boolean);
  return { count: text.length, small, low };`;

module.exports = { textProbe };
