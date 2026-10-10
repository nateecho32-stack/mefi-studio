/* Vibe Studio website — colour themes.
   The palettes are the app's own (THEMES in the app repository's
   renderer/music.js), so the site can be dressed in the same eleven looks as
   Studio. It is loaded from <head>: a saved choice is applied before the first
   paint. Vibe (lime and mint on deep green) is the public default. The
   historical chrome key stays compatible; vibe.css supplies the final tokens.
   Picker UI lives in fx.js (every page) and demo.js (Home). */
(function () {
  "use strict";
  var KEY = "mefiSite.theme.v1";
  var DEFAULT = "chrome";
  var root = document.documentElement;
  // <html class="motion"> before the first paint unless the visitor asked for
  // less motion: fx.css and home.css only stage entrances under it.
  try { if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) root.classList.add("motion"); } catch (e) { /* old engines: no entrances */ }

  // a2 / a3 are the two decorative companions of the accent (headline gradient,
  // glows, the sky). The Void collection carries its own second hue; the rest
  // get analogues of the accent.
  var THEMES = {
    chrome:   { name: "Vibe",     accent: "#c5ff73", bright: "#deffb1", bg: "#080c0b", panel: "#141e19", muted: "#b0bdb4", text: "#e0e7e2", a2: "#86efdd", a3: "#45cbb5" },
    aurora:   { name: "Aurora",     accent: "#71cbb7", bright: "#a7f3da", bg: "#050d13", panel: "#101f29", muted: "#a9c1c6", text: "#e9f6f0", a2: "#36d1ff", a3: "#8c7bff" },
    midnight: { name: "Midnight",   accent: "#82a8e6", bright: "#bbd5ff", bg: "#050913", panel: "#0d1524", muted: "#a2b2ca" },
    forest:   { name: "Forest",     accent: "#85bca3", bright: "#b4e1c9", bg: "#050d0b", panel: "#0d1915", muted: "#a2b8ae" },
    violet:   { name: "Violet",     accent: "#b297de", bright: "#dcc4ff", bg: "#0c0711", panel: "#181120", muted: "#b5a7c4" },
    rose:     { name: "Rose",       accent: "#dc96af", bright: "#ffbed3", bg: "#10080f", panel: "#23141e", muted: "#c6aebc", text: "#f7e5ea" },
    ember:    { name: "Ember",      accent: "#dd997a", bright: "#ffc5a9", bg: "#100805", panel: "#21150f", muted: "#c0ab9d" },
    gold:     { name: "Studio gold", accent: "#c9a86a", bright: "#e6c98d", bg: "#050507", panel: "#0d0e12", muted: "#aaa18f" },
    void:     { name: "Void",       accent: "#7c6cff", bright: "#b9b0ff", bg: "#030208", panel: "#0b0914", muted: "#a49fc2", text: "#ece9ff", a2: "#36d1ff", a3: "#b9b0ff", collection: "void" },
    eclipse:  { name: "Eclipse",    accent: "#e8a93c", bright: "#ffd98a", bg: "#040404", panel: "#111013", muted: "#b8ad98", text: "#f3ecdf", a2: "#ff6a3d", a3: "#ffd98a", collection: "void" },
    abyss:    { name: "Abyss",      accent: "#2fd6c3", bright: "#8ff5e8", bg: "#01080b", panel: "#06151a", muted: "#9dbfc0", text: "#e2f7f4", a2: "#7b5cff", a3: "#8ff5e8", collection: "void" },
    dusk:     { name: "Neon Dusk",  accent: "#ff5fa2", bright: "#ffa3cb", bg: "#0a0512", panel: "#170c24", muted: "#c4a9c9", text: "#fbe9f3", a2: "#3fd0ff", a3: "#ffa3cb", collection: "void" }
  };
  var ORDER = ["chrome", "aurora", "midnight", "forest", "violet", "rose", "ember", "gold", "void", "eclipse", "abyss", "dusk"];

  // ---- colour helpers ------------------------------------------------------
  function rgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function hex(c) { return "#" + c.map(function (v) { return ("0" + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(""); }
  function chan(h) { var c = rgb(h); return c[0] + " " + c[1] + " " + c[2]; }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function rotate(h, deg) {
    var c = rgb(h).map(function (v) { return v / 255; });
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), l = (mx + mn) / 2, s = 0, hue = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hue = mx === c[0] ? (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0) : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
      hue *= 60;
    }
    hue = (hue + deg + 360) % 360;
    function f(n) { var k = (n + hue / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }
    return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
  }

  function vars(t) {
    var a2 = t.a2 || rotate(t.accent, 42), a3 = t.a3 || rotate(t.accent, -48);
    var ivory = t.text || mix("#ffffff", t.bright, 0.12);
    var bg2 = mix(t.bg, t.panel, 0.55), panel2 = mix(t.panel, "#ffffff", 0.035);
    var v = {
      "--accent": t.accent, "--accent-bright": t.bright, "--accent-2": a2, "--accent-3": a3,
      "--accent-rgb": chan(t.accent), "--bright-rgb": chan(t.bright), "--accent-2-rgb": chan(a2), "--accent-3-rgb": chan(a3),
      "--bg": t.bg, "--bg-2": bg2, "--bg-rgb": chan(t.bg), "--bg-2-rgb": chan(bg2),
      "--panel-solid": mix(t.panel, t.bg, 0.12), "--panel-raised": panel2, "--panel-rgb": chan(t.panel), "--panel-2-rgb": chan(panel2),
      "--ivory": ivory, "--text": mix(ivory, t.muted, 0.3), "--muted": t.muted, "--dim": mix(t.muted, t.bg, 0.42),
      "--ink": mix(t.bg, "#000000", 0.4)
    };
    return v;
  }

  var current = DEFAULT;
  var listeners = [];

  function apply(id, silent) {
    if (!THEMES[id]) id = DEFAULT;
    var v = vars(THEMES[id]);
    for (var name in v) {
      if (id === DEFAULT) root.style.removeProperty(name); else root.style.setProperty(name, v[name]);
    }
    if (id === DEFAULT) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", id);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", id === DEFAULT ? "#080c0b" : THEMES[id].bg);
    current = id;
    if (!silent) {
      listeners.forEach(function (fn) { try { fn(id, THEMES[id]); } catch (e) { /* a listener must not break the switch */ } });
      try { document.dispatchEvent(new CustomEvent("mefi-theme", { detail: { id: id, theme: THEMES[id] } })); } catch (e) { /* old engines */ }
    }
  }

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(id) { try { if (id === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch (e) { /* private window: still applies for this page */ } }

  window.MefiTheme = {
    themes: THEMES,
    order: ORDER,
    defaultId: DEFAULT,
    current: function () { return current; },
    set: function (id) { if (!THEMES[id]) return; apply(id); save(id); },
    onChange: function (fn) { listeners.push(fn); },
    // The four colours a swatch paints with, whatever theme is showing.
    swatch: function (id) { var v = vars(THEMES[id]); return { bg: v["--bg"], accent: v["--accent"], bright: v["--accent-bright"], a2: v["--accent-2"] }; },
    // "r g b" of a CSS channel token, as numbers, for canvas painting.
    channel: function (name) {
      var s = getComputedStyle(root).getPropertyValue(name).trim().split(/\s+/).map(Number);
      return s.length === 3 && s.every(function (n) { return n >= 0; }) ? s : null;
    }
  };

  // A shared link can carry ?theme=abyss; otherwise use what the visitor chose last time.
  var wanted = null;
  try { wanted = new URLSearchParams(location.search).get("theme"); } catch (e) { /* no URLSearchParams */ }
  if (!THEMES[wanted]) wanted = saved();
  if (THEMES[wanted]) { apply(wanted, true); if (wanted !== saved()) save(wanted); }
  document.addEventListener("DOMContentLoaded", function () { apply(current, true); });
})();
