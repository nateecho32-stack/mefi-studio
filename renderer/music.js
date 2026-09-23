// Style & sound: Studio's color themes, node styles and layouts, the members'
// Void collection (its own premium store, gated by MefiCommunity), the
// local-file player and the ad-free radio decks. Streaming stays inside
// Spotify's official embed; its cross-origin playback state is deliberately
// not guessed.
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.music.v1";
  const THEMES = {
    gold: { name: "Studio gold", accent: "#c9a86a", bright: "#e6c98d", rgb: "201,168,106", bg: "#050507", panel: "#0d0e12", muted: "#aaa18f" },
    midnight: { name: "Midnight", accent: "#82a8e6", bright: "#bbd5ff", rgb: "130,168,230", bg: "#050913", panel: "#0d1524", muted: "#a2b2ca" },
    forest: { name: "Forest", accent: "#85bca3", bright: "#b4e1c9", rgb: "133,188,163", bg: "#050d0b", panel: "#0d1915", muted: "#a2b8ae" },
    violet: { name: "Violet", accent: "#b297de", bright: "#dcc4ff", rgb: "178,151,222", bg: "#0c0711", panel: "#181120", muted: "#b5a7c4" },
    ember: { name: "Ember", accent: "#dd997a", bright: "#ffc5a9", rgb: "221,153,122", bg: "#100805", panel: "#21150f", muted: "#c0ab9d" },
    aurora: { name: "Aurora", accent: "#71cbb7", bright: "#a7f3da", rgb: "113,203,183", bg: "#050d13", panel: "#101f29", muted: "#abc4c9", text: "#e7f5ee" },
    rose: { name: "Rose", accent: "#dc96af", bright: "#ffbed3", rgb: "220,150,175", bg: "#10080f", panel: "#23141e", muted: "#c6aebc", text: "#f7e5ea" },
    // The Void collection: members of the Void Engine Discord unlock these (see
    // scripts/community.cjs, whose SELF_UNLOCKED switch unlocks them in a fork).
    // Each carries a second hue that the premium tier paints with.
    void: { name: "Void", accent: "#7c6cff", bright: "#b9b0ff", accent2: "#36d1ff", rgb: "124,108,255", bg: "#030208", panel: "#0b0914", muted: "#a49fc2", text: "#ece9ff", premium: true },
    eclipse: { name: "Eclipse", accent: "#e8a93c", bright: "#ffd98a", accent2: "#ff6a3d", rgb: "232,169,60", bg: "#040404", panel: "#111013", muted: "#b8ad98", text: "#f3ecdf", premium: true },
    abyss: { name: "Abyss", accent: "#2fd6c3", bright: "#8ff5e8", accent2: "#7b5cff", rgb: "47,214,195", bg: "#01080b", panel: "#06151a", muted: "#9dbfc0", text: "#e2f7f4", premium: true },
    dusk: { name: "Neon Dusk", accent: "#ff5fa2", bright: "#ffa3cb", accent2: "#3fd0ff", rgb: "255,95,162", bg: "#0a0512", panel: "#170c24", muted: "#c4a9c9", text: "#fbe9f3", premium: true },
  };
  const DEFAULT_THEME = "aurora";
  const NODE_STYLES = {
    orbs: { name: "Classic orbs", detail: "Luminous circles" },
    glass: { name: "Soft glass", detail: "Translucent surfaces" },
    minimal: { name: "Minimal", detail: "Quiet points" },
    halo: { name: "Halo", detail: "Luminous rings" },
    crystal: { name: "Crystal", detail: "Faceted gems" },
    singularity: { name: "Singularity", detail: "A black hole with a turning disc", premium: true },
    prism: { name: "Prism", detail: "A turning crystal that splits light", premium: true },
    sigil: { name: "Sigil", detail: "Hex runes that assemble as it works", premium: true },
  };
  // Saved preferences only ever hold free keys; a premium choice lives in its
  // own store (PREMIUM_KEY) and shows only while the community layer allows it.
  const isPremiumTheme = (key) => typeof key === "string" && Object.hasOwn(THEMES, key) && THEMES[key].premium === true;
  const isFreeTheme = (key) => key === "custom" || typeof key === "string" && Object.hasOwn(THEMES, key) && THEMES[key].premium !== true;
  const isNodeStyle = (key) => typeof key === "string" && Object.hasOwn(NODE_STYLES, key);
  const isPremiumNodeStyle = (key) => isNodeStyle(key) && NODE_STYLES[key].premium === true;
  const isFreeNodeStyle = (key) => isNodeStyle(key) && NODE_STYLES[key].premium !== true;
  function safePremium(value) {
    const raw = value && typeof value === "object" ? value : {};
    const choice = {};
    if (isPremiumTheme(raw.theme)) choice.theme = raw.theme;
    if (isPremiumNodeStyle(raw.nodeStyle)) choice.nodeStyle = raw.nodeStyle;
    return choice;
  }
  // The fork sentence is community.js's, read when it is needed; this copy
  // covers start:web and load order. tests/community_ui.test.mjs pins it to
  // scripts/community.cjs.
  const FORK_FALLBACK = "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.";
  function forkCopy() {
    try { const copy = window.MefiCommunity?.FORK_COPY; return typeof copy === "string" && copy ? copy : FORK_FALLBACK; } catch { return FORK_FALLBACK; }
  }
  const NODE_LAYOUTS = {
    constellation: { name: "Constellation", detail: "An open arrangement" },
    tree: { name: "Branches", detail: "A clear hierarchy" },
    radial: { name: "Rings", detail: "Concentric groups" },
    helix: { name: "Helix", detail: "A rising spiral" },
    layers: { name: "Terraces", detail: "Stacked levels" },
  };
  const AUDIO_EFFECTS = {
    waves: { title: "Connection waves", detail: "Let sound gently bend the connections.", enabled: true },
    splitBands: { title: "Separate frequency lines", detail: "Bass, mids and treble drive different connections.", enabled: true },
    nodes: { title: "Node glow", detail: "Light the nodes with the music.", enabled: true },
    percussion: { title: "Drum accents", detail: "Add sharper ripples on drum hits.", enabled: false },
    background: { title: "Background glow", detail: "Let the space behind the tree pulse.", enabled: false },
  };
  // Listener-funded and Creative Commons stations that carry no advertising at
  // all, so there is never a break to skip, mute or talk over. Every mirror here
  // was reached directly and answers with CORS open, which is what lets the
  // analyser read the stream and the node tree react to it.
  const STATIONS = [
    { id: "groovesalad", name: "Groove Salad", detail: "Chilled ambient beats", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/groovesalad-128-mp3", "https://ice2.somafm.com/groovesalad-128-mp3", "https://ice4.somafm.com/groovesalad-128-mp3"] },
    { id: "dronezone", name: "Drone Zone", detail: "Atmospheric textures", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/dronezone-128-mp3", "https://ice2.somafm.com/dronezone-128-mp3", "https://ice4.somafm.com/dronezone-128-mp3"] },
    { id: "deepspaceone", name: "Deep Space One", detail: "Deep ambient and experimental", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/deepspaceone-128-mp3", "https://ice2.somafm.com/deepspaceone-128-mp3", "https://ice4.somafm.com/deepspaceone-128-mp3"] },
    { id: "spacestation", name: "Space Station", detail: "Spaced-out electronica", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/spacestation-128-mp3", "https://ice2.somafm.com/spacestation-128-mp3", "https://ice4.somafm.com/spacestation-128-mp3"] },
    { id: "lush", name: "Lush", detail: "Vocal electronica", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/lush-128-mp3", "https://ice2.somafm.com/lush-128-mp3", "https://ice4.somafm.com/lush-128-mp3"] },
    { id: "fluid", name: "Fluid", detail: "Instrumental hip hop and future soul", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/fluid-128-mp3", "https://ice2.somafm.com/fluid-128-mp3", "https://ice4.somafm.com/fluid-128-mp3"] },
    { id: "defcon", name: "DEF CON Radio", detail: "Music for hacking", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/defcon-128-mp3", "https://ice2.somafm.com/defcon-128-mp3", "https://ice4.somafm.com/defcon-128-mp3"] },
    { id: "bootliquor", name: "Boot Liquor", detail: "Americana roots", origin: "SomaFM",
      mirrors: ["https://ice1.somafm.com/bootliquor-128-mp3", "https://ice2.somafm.com/bootliquor-128-mp3", "https://ice4.somafm.com/bootliquor-128-mp3"] },
    { id: "rp-main", name: "Radio Paradise", detail: "Eclectic hand-picked rock", origin: "Radio Paradise",
      mirrors: ["https://stream.radioparadise.com/mp3-128", "https://stream.radioparadise.com/aac-128", "https://stream.radioparadise.com/mp3-192"] },
    { id: "rp-mellow", name: "RP Mellow Mix", detail: "Quieter, slower company", origin: "Radio Paradise",
      mirrors: ["https://stream.radioparadise.com/mellow-128"] },
    { id: "rp-rock", name: "RP Rock Mix", detail: "Guitars to the front", origin: "Radio Paradise",
      mirrors: ["https://stream.radioparadise.com/rock-128"] },
    { id: "rp-global", name: "RP Global Mix", detail: "World and crossover", origin: "Radio Paradise",
      mirrors: ["https://stream.radioparadise.com/global-128"] },
  ];
  const STATION_IDS = new Set(STATIONS.map((station) => station.id));
  const station = (id) => STATIONS.find((item) => item.id === id) || null;
  // A crossfade long enough to hide a rebuffer, short enough to feel deliberate.
  const FADE_MS = 1200;
  const FADE_STEP_MS = 40;
  // A live stream that has gone quiet this long is not coming back on its own.
  const STALL_MS = 7000;
  const CUSTOM_DEFAULTS = Object.freeze({ accent: "#C9A86A", background: "#050507", surface: "#0D0E12", text: "#ECE5D8" });
  const hexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
  const safeCustomColors = (value) => Object.fromEntries(Object.entries(CUSTOM_DEFAULTS).map(([key, fallback]) => [key, hexColor(value?.[key]) || fallback]));
  const channels = (color) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const mixColor = (a, b, amount) => `#${channels(a).map((value, index) => Math.round(value + (channels(b)[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
  const luminance = (color) => channels(color).map((value) => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  function readableColor(color, background, minimum = 4.5) {
    if (contrast(color, background) >= minimum) return color;
    const target = contrast("#FFFFFF", background) >= contrast("#000000", background) ? "#FFFFFF" : "#000000";
    for (let step = 1; step <= 40; step += 1) { const candidate = mixColor(color, target, step / 40); if (contrast(candidate, background) >= minimum) return candidate; }
    return target;
  }
  function resolvePalette(theme, customColors) {
    const custom = safeCustomColors(customColors);
    const base = theme === "custom" ? { accent: custom.accent, bright: mixColor(custom.accent, "#FFFFFF", .3), bg: custom.background, panel: custom.surface, text: custom.text } : THEMES[theme] || THEMES[DEFAULT_THEME];
    const text = readableColor(base.text || "#ece5d8", base.panel);
    const bright = readableColor(base.bright, base.panel, 3);
    const muted = readableColor(base.muted || mixColor(text, base.panel, .32), base.panel);
    const dim = readableColor(mixColor(text, base.panel, .5), base.panel, 3);
    const border = readableColor(mixColor(base.accent, base.panel, .6), base.panel, 3);
    const canvasText = readableColor(base.text || "#ece5d8", base.bg);
    return { accent: base.accent, bright, accent2: base.accent2 || bright, background: base.bg, surface: base.panel, text, muted, dim, border,
      rgb: channels(base.accent).join(","), surfaceRgb: channels(base.panel).join(","),
      onAccent: contrast("#FFFFFF", base.accent) > contrast("#000000", base.accent) ? "#FFFFFF" : "#000000",
      canvas: { background: base.bg, accent: base.accent, bright: readableColor(base.bright, base.bg, 3), accent2: base.accent2 || readableColor(base.bright, base.bg, 3), text: canvasText, muted: readableColor(mixColor(canvasText, base.bg, .32), base.bg), dim: readableColor(mixColor(canvasText, base.bg, .5), base.bg, 3) } };
  }

  function spotifyLink(raw) {
    const value = String(raw ?? "").trim();
    let match = /^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/.exec(value);
    if (!match) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || !["open.spotify.com", "spotify.com", "www.spotify.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
        match = /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      } catch { return null; }
    }
    if (!match) return null;
    const [, type, id] = match;
    return { type, id, url: `https://open.spotify.com/${type}/${id}`, embed: `https://open.spotify.com/embed/${type}/${id}` };
  }

  function safePreferences(value) {
    const raw = value && typeof value === "object" ? value : {};
    const volume = Number(raw.volume);
    const spotify = [...new Set((Array.isArray(raw.spotify) ? raw.spotify : []).map((item) => spotifyLink(item)?.url).filter(Boolean))].slice(0, 6);
    return { theme: isFreeTheme(raw.theme) ? raw.theme : DEFAULT_THEME, customColors: safeCustomColors(raw.customColors), volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .7, spotify,
      nodeStyle: isFreeNodeStyle(raw.nodeStyle) ? raw.nodeStyle : "orbs",
      nodeLayout: Object.hasOwn(NODE_LAYOUTS, raw.nodeLayout) ? raw.nodeLayout : "constellation",
      station: STATION_IDS.has(raw.station) ? raw.station : null,
      // The source tab, and whether a station was sounding when Studio closed.
      source: raw.source === "radio" || raw.source === "spotify" ? raw.source : "local", radioOn: raw.radioOn === true,
      orbitTrails: raw.orbitTrails === true, extraGlow: raw.extraGlow === true };
  }
  function audioFile(file) { return Boolean(file && (String(file.type || "").startsWith("audio/") || /\.(mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i.test(file.name || ""))); }
  function trackName(name) { return String(name || "Untitled audio").replace(/\.[^.]+$/, "").replace(/[_]+/g, " "); }
  function nextIndex(index, length, step = 1, wrap = true) {
    if (!length) return -1;
    const candidate = index + step;
    return wrap ? (candidate % length + length) % length : candidate < 0 || candidate >= length ? -1 : candidate;
  }
  function timeLabel(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }
  let stored;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch {}
  const prefs = safePreferences(stored);
  const PREMIUM_KEY = "mefiStudio.music.premium.v1";
  const COMMUNITY_HINT_KEY = "mefiStudio.community.v1";
  let storedPremium;
  try { storedPremium = JSON.parse(localStorage.getItem(PREMIUM_KEY) || "null"); } catch {}
  // The saved premium choice, kept even while it is locked so a returning
  // member gets it back; `effective` is what is actually on screen.
  const premium = safePremium(storedPremium);
  const effective = { theme: prefs.theme, nodeStyle: prefs.nodeStyle };
  const state = { source: "local", tracks: [], selected: -1, spotify: null, opened: false, sending: false, notice: "", error: false,
    station: null, mirror: 0, deck: "a", radioPhase: "idle", radioNote: "" };
  const els = {};
  let audio = null;
  let initialized = false;
  let recommender = null;
  let priorFocus = null;
  let previewFrame = 0;
  let jumpFrame = 0;
  let restoreWorkspace = false;
  let deckB = null;
  let pendingDeck = null;
  let fadeOut = null;
  let fadeTimer = 0;
  let stallTimer = 0;
  let tuneGeneration = 0;

  const persist = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safePreferences(prefs))); } catch {} };
  const persistPremium = () => { try { localStorage.setItem(PREMIUM_KEY, JSON.stringify(safePremium(premium))); } catch {} };
  const event = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  // The one gate. MefiCommunity answers from its last status (or its boot
  // hint); without it (start:web, or before it loads) the hint it leaves in
  // storage decides, so a member does not flash the free theme at launch.
  function premiumAllowed() {
    const community = window.MefiCommunity;
    if (community && typeof community.has === "function") {
      try { return community.has("premium") === true; } catch { return false; }
    }
    let hint = null;
    try { hint = JSON.parse(localStorage.getItem(COMMUNITY_HINT_KEY) || "null"); } catch {}
    return hint?.premium === true && (hint.validUntil == null || Number.isFinite(hint.validUntil) && hint.validUntil > Date.now());
  }
  // Join, link and copy need the desktop bridge behind MefiCommunity.
  const communityActions = () => Boolean(window.MefiCommunity) && Boolean(window.mefiStudio?.communityLink || window.mefiStudio?.communityOpen);
  // Link needs a build with a Discord client id and an account that is not
  // linked yet, or one Discord asks to link again; before the first status, no.
  function communityLinkable() {
    try {
      const current = window.MefiCommunity?.status?.();
      return current?.configured === true && !(current.linked === true && current.state !== "relink");
    } catch { return false; }
  }
  // navigate:false (the Workspace select, and the Void tiles in this sheet)
  // explains without leaving the view.
  function offerUnlock(kind, key, name, navigate = true) {
    if (typeof window.MefiCommunity?.offer === "function") {
      try { window.MefiCommunity.offer(navigate ? { kind, key, name } : { kind, key, name, navigate: false }); return; } catch {}
    }
    note(`${name} is part of the Void collection. ${forkCopy()}`);
  }
  function status() {
    const track = state.tracks[state.selected];
    const tuned = station(state.station);
    const title = state.source === "spotify" ? state.spotify ? `Spotify ${state.spotify.type}` : "Choose Spotify music"
      : state.source === "radio" ? tuned ? tuned.name : "Choose a station"
      : track?.title || "Choose your music";
    const deck = activeDeck();
    const playing = state.source === "radio" ? (state.radioPhase === "playing" || state.radioPhase === "buffering") && Boolean(deck?.src) && !deck.paused
      : state.source === "local" && Boolean(audio?.src) && !audio.paused && !audio.ended;
    return { source: state.source, playing, title, track: title, theme: effective.theme, ...graphPreferences(),
      queueLength: state.tracks.length, externalPlayback: state.source === "spotify", supported: true,
      station: state.station, stationName: tuned?.name || null, radioPhase: state.source === "radio" ? state.radioPhase : "idle" };
  }
  const announce = () => event("mefi-music-change", status());
  function note(text, error = false) {
    state.notice = String(text || ""); state.error = error;
    if (els.notice) { els.notice.textContent = state.notice; els.notice.dataset.error = String(error); }
  }
  function themeTokens(palette) {
    return { "--gold": palette.accent, "--gold-bright": palette.bright, "--gold-dim": `rgba(${palette.rgb},.32)`, "--hairline": `rgba(${channels(palette.border).join(",")},.5)`, "--hairline-strong": palette.border, "--tint-gold-1": `rgba(${palette.rgb},.06)`, "--tint-gold-2": `rgba(${palette.rgb},.09)`, "--tint-gold-3": `rgba(${palette.rgb},.14)`, "--ring": `0 0 0 3px rgba(${palette.rgb},.15)`, "--glow-gold": `0 0 14px rgba(${palette.rgb},.3)`, "--bg": palette.background, "--bg-deep": palette.background, "--cmd-bg": palette.background, "--panel-solid": palette.surface, "--panel": `rgba(${palette.surfaceRgb},.85)`, "--glass": `rgba(${palette.surfaceRgb},.76)`, "--glass-hard": `rgba(${palette.surfaceRgb},.94)`, "--glass-soft": `rgba(${palette.surfaceRgb},.7)`, "--ivory": palette.text, "--muted": palette.muted, "--dim": palette.dim, "--ink": palette.onAccent };
  }
  const themeDetail = (key) => { const palette = resolvePalette(key, prefs.customColors); return { theme: key, tier: isPremiumTheme(key) ? "premium" : "free", ...palette, tokens: themeTokens(palette) }; };
  // Paints a theme without deciding whether it may be shown or saved.
  function paintTheme(key) {
    const detail = themeDetail(key);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(detail.tokens)) root.style.setProperty(name, value);
    for (const [name, value] of Object.entries(detail.canvas)) root.style.setProperty(`--canvas-${name}`, value);
    root.style.setProperty("--studio-accent-rgb", detail.rgb);
    root.style.setProperty("--accent-2", detail.accent2);
    root.style.setProperty("--accent-2-rgb", channels(detail.accent2).join(","));
    root.dataset.studioTheme = key;
    root.dataset.studioThemeTier = detail.tier;
    effective.theme = key;
    for (const button of [...els.themes?.children || [], ...els.premiumThemes?.children || []]) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === key));
      if (button.dataset.theme === "custom") button.style.setProperty("--swatch", prefs.customColors.accent);
    }
    if (els.customPalette) els.customPalette.hidden = key !== "custom";
    for (const [name, pair] of Object.entries(els.customInputs || {})) {
      pair.picker.value = prefs.customColors[name]; pair.hex.value = prefs.customColors[name]; pair.hex.setAttribute("aria-invalid", "false");
    }
    return detail;
  }
  // options.navigate === false: a locked choice is explained in place (the
  // Workspace select fires on every arrow key, so it must not change the view,
  // and a Void tile in this sheet must not close it).
  function applyTheme(theme, save = true, options) {
    if (isPremiumTheme(theme)) {
      if (!premiumAllowed()) {
        // Locked: nothing changes. Announcing what is still on screen rolls
        // back any picker that already moved (the Workspace theme select).
        event("mefi-theme-change", themeDetail(effective.theme));
        offerUnlock("theme", theme, THEMES[theme].name, options?.navigate !== false);
        return effective.theme;
      }
      const detail = paintTheme(theme);
      if (save && premium.theme !== theme) { premium.theme = theme; persistPremium(); }
      event("mefi-theme-change", detail);
      return theme;
    }
    const key = isFreeTheme(theme) ? theme : DEFAULT_THEME;
    prefs.theme = key;
    const detail = paintTheme(key);
    if (save) {
      persist();
      if (premium.theme) { delete premium.theme; persistPremium(); }
    }
    event("mefi-theme-change", detail);
    return key;
  }
  function applyCustomColors(patch, save = true) {
    const entries = Object.entries(patch && typeof patch === "object" ? patch : {}).filter(([key]) => Object.hasOwn(CUSTOM_DEFAULTS, key));
    if (!entries.length || entries.some(([, value]) => !hexColor(value))) return false;
    prefs.customColors = { ...prefs.customColors, ...Object.fromEntries(entries.map(([key, value]) => [key, hexColor(value)])) };
    applyTheme("custom", save);
    return true;
  }
  // Read per node per frame by the tree rail: plain fields, no storage reads.
  function graphPreferences() { return { nodeStyle: effective.nodeStyle, nodeLayout: prefs.nodeLayout, orbitTrails: prefs.orbitTrails, extraGlow: prefs.extraGlow }; }
  function syncTreePreferences(save) {
    const value = graphPreferences();
    Object.assign(document.documentElement.dataset, value);
    for (const choice of [...els.nodeStyles?.children || [], ...els.premiumStyles?.children || []]) choice.setAttribute("aria-pressed", String(choice.dataset.nodeStyle === value.nodeStyle));
    for (const choice of els.nodeLayouts?.children || []) choice.setAttribute("aria-pressed", String(choice.dataset.nodeLayout === value.nodeLayout));
    if (els.orbitTrails) els.orbitTrails.checked = value.orbitTrails;
    if (els.extraGlow) els.extraGlow.checked = value.extraGlow;
    if (save) persist();
    event("mefi-tree-preferences", value);
  }
  // options.navigate === false, as for applyTheme: the explanation comes where
  // the style was chosen.
  function applyNodeStyle(style, save = true, options) {
    if (isPremiumNodeStyle(style)) {
      if (!premiumAllowed()) {
        // Locked: keep the style on screen and re-announce it for any picker.
        syncTreePreferences(false);
        offerUnlock("nodeStyle", style, NODE_STYLES[style].name, options?.navigate !== false);
        return effective.nodeStyle;
      }
      effective.nodeStyle = style;
      if (save && premium.nodeStyle !== style) { premium.nodeStyle = style; persistPremium(); }
      syncTreePreferences(false);
      return style;
    }
    prefs.nodeStyle = isFreeNodeStyle(style) ? style : "orbs";
    effective.nodeStyle = prefs.nodeStyle;
    if (save && premium.nodeStyle) { delete premium.nodeStyle; persistPremium(); }
    syncTreePreferences(save);
    return prefs.nodeStyle;
  }
  // Community changes re-apply a stored premium choice, or fall back to the
  // free preferences when membership lapses. Neither path writes storage: the
  // premium choice stays saved for when the member links again. The event's
  // own verdict is used as given, so it cannot race MefiCommunity's status.
  function syncPremium(allowed = premiumAllowed()) {
    if (allowed) {
      if (premium.theme && effective.theme !== premium.theme) event("mefi-theme-change", paintTheme(premium.theme));
      if (premium.nodeStyle && effective.nodeStyle !== premium.nodeStyle) { effective.nodeStyle = premium.nodeStyle; syncTreePreferences(false); }
    } else {
      let revoked = false;
      if (isPremiumTheme(effective.theme)) { applyTheme(prefs.theme, false); revoked = true; }
      if (isPremiumNodeStyle(effective.nodeStyle)) { effective.nodeStyle = prefs.nodeStyle; syncTreePreferences(false); revoked = true; }
      if (revoked) window.MefiToast?.("Void collection locked again; your choice is saved.", "info");
    }
    renderPremiumLocks(allowed);
  }
  // A fork with SELF_UNLOCKED says so instead of thanking a membership.
  function selfUnlocked() {
    try { return window.MefiCommunity?.status?.()?.selfUnlocked === true; } catch { return false; }
  }
  // Locked choices keep their full colour and art with a small lock; the
  // pointer's tooltip gives the reason. Only a locked picker shows the fork
  // path and its buttons; a member gets one quiet line instead.
  function renderPremiumLocks(allowed = premiumAllowed()) {
    for (const [group, className, what] of [[els.premiumThemes, "music-theme-locked", "theme"], [els.premiumStyles, "music-node-locked", "node style"]]) {
      for (const choice of group?.children || []) {
        if (allowed) { choice.classList.remove(className); choice.removeAttribute("aria-disabled"); choice.title = ""; }
        else { choice.classList.add(className); choice.setAttribute("aria-disabled", "true"); choice.title = `A Void collection ${what} for Void Engine Discord members. Choose it to see how to unlock it.`; }
        const badge = els.premiumBadges?.get(choice);
        if (badge) badge.hidden = allowed;
      }
    }
    const actions = communityActions();
    const linkable = communityLinkable();
    const manageable = typeof window.MefiCommunity?.open === "function";
    const unlockedLine = selfUnlocked() ? "Unlocked in this build" : "Unlocked with your Void Engine membership";
    const fork = forkCopy();
    for (const box of els.premiumBoxes || []) {
      box.tag.hidden = allowed;
      box.fineprint.hidden = allowed;
      if (box.fineprint.textContent !== fork) box.fineprint.textContent = fork;
      box.actions.hidden = allowed || !actions;
      box.desktop.hidden = allowed || actions;
      box.link.hidden = !linkable;
      box.member.hidden = !allowed;
      if (box.memberText.textContent !== unlockedLine) box.memberText.textContent = unlockedLine;
      box.manage.hidden = !manageable;
      box.group.setAttribute("aria-describedby", allowed ? box.member.id : box.fineprint.id);
    }
  }
  function applyNodeLayout(layout, save = true) {
    prefs.nodeLayout = Object.hasOwn(NODE_LAYOUTS, layout) ? layout : "constellation";
    syncTreePreferences(save);
    return prefs.nodeLayout;
  }
  function applyNodeEffects(effects, save = true) {
    if (effects && typeof effects === "object") {
      for (const key of ["orbitTrails", "extraGlow"]) if (Object.hasOwn(effects, key)) prefs[key] = effects[key] === true;
    }
    syncTreePreferences(save);
    return graphPreferences();
  }
  function element(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function button(text, className, parent, action, id) {
    const node = element("button", className, text, parent);
    node.type = "button";
    if (id) node.id = id;
    node.addEventListener("click", action);
    return node;
  }
  function graphChoices(parent, kind, choices, selected, apply) {
    const title = element("h4", "music-node-label", kind === "style" ? "Node style" : "Layout", parent);
    title.id = `music-node-${kind}-label`;
    const group = element("div", "music-node-choices", null, parent);
    group.id = `music-node-${kind}s`;
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", title.id);
    for (const [key, option] of Object.entries(choices)) {
      const choice = button(null, `music-node-choice music-node-${kind}`, group, () => apply(key), `music-node-${kind}-${key}`);
      choice.dataset[kind === "style" ? "nodeStyle" : "nodeLayout"] = key;
      choice.setAttribute("aria-pressed", String(selected === key));
      const preview = element("span", `music-node-preview music-preview-${key}`, null, choice);
      preview.setAttribute("aria-hidden", "true");
      for (let index = 0; index < (kind === "style" ? 3 : 5); index += 1) element("i", null, null, preview);
      element("strong", null, option.name, choice);
      element("small", null, option.detail, choice);
    }
    return group;
  }
  // The Void collection sits in its own group under the free choices, which
  // stay exactly as they were. Locked buttons stay focusable and clickable
  // (aria-disabled, never disabled) so a click can explain how to unlock them.
  function premiumBox(parent, kind) {
    const box = element("div", "music-premium", null, parent);
    const title = element("h4", "music-node-label music-premium-heading", "Void collection", box);
    title.id = `music-premium-${kind}-label`;
    // A narrow sheet folds this pill to its lock; the word stays for screen readers (music.css).
    const tag = element("span", "music-premium-tag", null, title);
    element("span", "music-premium-tag-text", "Members", tag);
    tag.title = "For Void Engine Discord members";
    // The caller names the group (a literal id, which scripts/auditor.mjs can see).
    const group = element("div", kind === "theme" ? "music-themes" : "music-node-choices", null, box);
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", title.id);
    const fineprint = element("p", "music-fineprint", forkCopy(), box);
    fineprint.id = `music-premium-${kind}-fineprint`;
    group.setAttribute("aria-describedby", fineprint.id);
    const actions = element("div", "music-premium-actions", null, box);
    button("Join the Discord", "ghost mini", actions, () => window.MefiCommunity?.join?.(), `music-premium-${kind}-join`);
    const link = button("Link my Discord", "ghost mini", actions, () => window.MefiCommunity?.link?.(), `music-premium-${kind}-link`);
    button("Copy agent prompt", "ghost mini", actions, () => window.MefiCommunity?.copyAgentPrompt?.(), `music-premium-${kind}-prompt`);
    const desktop = element("p", "music-premium-desktop", "Desktop app only", box);
    desktop.id = `music-premium-${kind}-desktop`;
    const member = element("p", "music-premium-member", null, box);
    member.id = `music-premium-${kind}-member`;
    const memberText = element("span", "music-premium-member-text", "Unlocked with your Void Engine membership", member);
    const manage = button("Manage in Settings › Community", "music-premium-manage", member, () => window.MefiCommunity?.open?.(), `music-premium-${kind}-manage`);
    (els.premiumBoxes ||= []).push({ tag, group, fineprint, actions, desktop, link, member, memberText, manage });
    return group;
  }
  // The lock reads as a glyph; "Members" stays in the button's name for
  // screen readers. It sits beside the name, never over the art.
  function premiumBadge(choice, parent = choice) {
    const badge = element("span", "music-premium-lock", null, parent);
    element("span", "music-premium-lock-text", "Members", badge);
    (els.premiumBadges ||= new Map()).set(choice, badge);
  }
  // A locked tile explains itself where it is (navigate:false): leaving for
  // Settings would close this sheet.
  function premiumThemeChoices(parent) {
    const group = premiumBox(parent, "theme");
    group.id = "music-premium-themes";
    for (const [key, palette] of Object.entries(THEMES).filter(([key]) => isPremiumTheme(key))) {
      const choice = button(palette.name, "music-theme music-theme-premium", group, () => applyTheme(key, true, { navigate: false }), `music-theme-${key}`);
      choice.dataset.theme = key; choice.dataset.premium = "true";
      // Two-tone swatch: the theme's accent ring around its second hue.
      choice.style.setProperty("--swatch", palette.accent); choice.style.setProperty("--swatch-2", palette.accent2);
      choice.setAttribute("aria-pressed", String(effective.theme === key));
      premiumBadge(choice);
    }
    return group;
  }
  function premiumStyleChoices(parent) {
    const group = premiumBox(parent, "style");
    group.id = "music-node-premium-styles";
    for (const [key, option] of Object.entries(NODE_STYLES).filter(([key]) => isPremiumNodeStyle(key))) {
      const choice = button(null, "music-node-choice music-node-style music-node-premium", group, () => applyNodeStyle(key, true, { navigate: false }), `music-node-style-${key}`);
      choice.dataset.nodeStyle = key; choice.dataset.premium = "true";
      choice.setAttribute("aria-pressed", String(effective.nodeStyle === key));
      const preview = element("span", `music-node-preview music-preview-${key}`, null, choice);
      preview.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 3; index += 1) element("i", null, null, preview);
      const label = element("span", "music-premium-name", null, choice);
      element("strong", null, option.name, label);
      premiumBadge(choice, label);
      element("small", null, option.detail, choice);
    }
    return group;
  }
  // Deck A is the element local files always use and the one the analyser
  // binds to first. Deck B exists only once a station has to cross over a
  // station that is already playing, so an untouched radio tab still runs on a
  // single element.
  function activeDeck() { return state.deck === "b" ? deckB : audio; }
  function idleDeck() { return state.deck === "b" ? audio : ensureDeckB(); }
  function ensureDeckB() {
    if (deckB) return deckB;
    deckB = document.createElement("audio");
    deckB.preload = "none";
    // Both station hosts answer with Access-Control-Allow-Origin, so an opted-in
    // CORS fetch keeps the analyser readable. Without it a captured element is
    // tainted, and the Web Audio graph would play it back as silence.
    deckB.crossOrigin = "anonymous";
    deckB.volume = 0;
    bindDeck(deckB);
    return deckB;
  }
  // Only the deck carrying the current station speaks for the stream. While a
  // new station connects on the other deck the old one's troubles are moot,
  // and a stopped deck's late events must not restart anything.
  function radioLive(deck) {
    return state.source === "radio" && state.radioPhase !== "idle" && deck === activeDeck() && (!pendingDeck || pendingDeck === deck);
  }
  function bindDeck(deck) {
    deck.addEventListener("playing", () => { if (radioLive(deck)) { clearStall(); state.radioPhase = "playing"; renderRadio(); announce(); } });
    deck.addEventListener("waiting", () => { if (radioLive(deck)) armStall(); });
    deck.addEventListener("stalled", () => { if (radioLive(deck)) armStall(); });
    deck.addEventListener("ended", () => { if (radioLive(deck)) nextMirror("The stream ended"); });
    deck.addEventListener("error", () => { if (radioLive(deck)) nextMirror(state.radioPhase === "connecting" ? `${station(state.station)?.name || "The station"} could not connect` : "The stream dropped"); });
  }
  function clearStall() { if (stallTimer) { window.clearTimeout(stallTimer); stallTimer = 0; } }
  function armStall() {
    if (stallTimer || state.source !== "radio") return;
    // A first connection keeps saying so; only an established stream buffers.
    if (state.radioPhase !== "connecting") { state.radioPhase = "buffering"; renderRadio(); }
    stallTimer = window.setTimeout(() => {
      stallTimer = 0;
      if (state.source !== "radio" || state.radioPhase === "idle") return;
      nextMirror(state.radioPhase === "connecting" ? `${station(state.station)?.name || "The station"} did not answer` : "The stream stopped sending");
    }, STALL_MS);
  }
  // The swap the watchdog asks for: bring the next mirror up on the idle deck
  // and cross to it, so a dropped connection costs a fade and not the music.
  function nextMirror(reason) {
    const tuned = station(state.station);
    if (!tuned) return;
    const next = state.mirror + 1;
    if (next >= tuned.mirrors.length) {
      clearStall();
      pendingDeck = null;
      state.radioPhase = "error";
      state.radioNote = `${reason}. Every mirror for ${tuned.name} was tried; choose it again to retry.`;
      renderRadio(); announce();
      return;
    }
    state.radioNote = `${reason}. Moving to mirror ${next + 1}.`;
    tune(state.station, next, true);
  }
  // Snap a running crossfade to its end, so a new choice starts from one
  // settled deck instead of racing a fade that is still releasing the other.
  function finishFade() {
    if (!fadeTimer) return;
    window.clearInterval(fadeTimer); fadeTimer = 0;
    activeDeck().volume = prefs.volume;
    if (fadeOut && fadeOut !== activeDeck()) stopDeck(fadeOut);
    fadeOut = null;
  }
  function fadeTo(incoming, outgoing) {
    finishFade();
    if (!outgoing || outgoing === incoming || !outgoing.src || outgoing.paused) {
      incoming.volume = prefs.volume;
      if (outgoing && outgoing !== incoming) stopDeck(outgoing);
      return;
    }
    fadeOut = outgoing;
    // Progress is read from the clock, not counted in ticks, so a hidden
    // window's throttled timer lands the fade late instead of stretching it.
    const started = window.performance.now();
    fadeTimer = window.setInterval(() => {
      const ratio = Math.min(1, (window.performance.now() - started) / FADE_MS);
      // The master is read every step, so moving the volume mid-fade sticks.
      incoming.volume = prefs.volume * ratio;
      outgoing.volume = prefs.volume * (1 - ratio);
      if (ratio < 1) return;
      window.clearInterval(fadeTimer); fadeTimer = 0; fadeOut = null;
      stopDeck(outgoing);
    }, FADE_STEP_MS);
  }
  function stopDeck(deck) {
    if (!deck) return;
    deck.pause();
    deck.removeAttribute("src");
    try { deck.load(); } catch {}
    deck.volume = 0;
  }
  function tune(id, mirrorIndex = 0, viaFailover = false) {
    init();
    const tuned = station(id);
    if (!tuned) { note("That station is not on the list.", true); return false; }
    const url = tuned.mirrors[mirrorIndex];
    if (!url) return false;
    // Choosing the station that is already sounding is not a reason to reconnect.
    if (!viaFailover && state.source === "radio" && state.station === id && state.radioPhase === "playing" && !activeDeck().paused) return true;
    // Every tune supersedes the last: a slow answer that arrives after a newer
    // choice, or after Stop, must not take the speakers back.
    const generation = ++tuneGeneration;
    clearStall();
    finishFade();
    const wasRadio = state.source === "radio";
    const current = activeDeck();
    // Only a deck that is sounding needs the other one. A connection still in
    // flight on this deck is redirected rather than doubled up, and a failed
    // load leaves the element unpaused with an error, so neither is sounding.
    const live = wasRadio && pendingDeck !== current && Boolean(current.src) && !current.paused && !current.error;
    const target = live ? idleDeck() : current;
    const outgoing = live ? current : null;
    if (!wasRadio) audio?.pause();
    state.source = "radio";
    state.station = id;
    state.mirror = mirrorIndex;
    state.radioPhase = "connecting";
    pendingDeck = target;
    if (!viaFailover) state.radioNote = "";
    prefs.station = id; prefs.source = "radio"; prefs.radioOn = true; persist();
    if (els.embed) { els.embed.remove(); els.embed = null; }
    target.crossOrigin = "anonymous";
    target.volume = live ? 0 : prefs.volume;
    target.src = url;
    try { target.load(); } catch {}
    const settle = () => {
      if (generation !== tuneGeneration) return;
      clearStall();
      pendingDeck = null;
      state.deck = target === deckB ? "b" : "a";
      state.radioPhase = "playing";
      fadeTo(target, outgoing); renderRadio(); announce();
    };
    const refused = (error) => {
      if (generation !== tuneGeneration) return;
      nextMirror(`${tuned.name} refused the connection (${error?.message || "unavailable"})`);
    };
    // A connection that never answers gets the same watchdog as a stall.
    armStall();
    render(); announce();
    let started;
    try { started = target.play(); } catch (error) { refused(error); return true; }
    if (started && typeof started.then === "function") started.then(settle, refused);
    else settle();
    return true;
  }
  function stopRadio() {
    tuneGeneration += 1;
    clearStall();
    if (fadeTimer) { window.clearInterval(fadeTimer); fadeTimer = 0; }
    fadeOut = null;
    pendingDeck = null;
    stopDeck(deckB);
    if (state.source === "radio") stopDeck(audio);
    // Local blob URLs never needed CORS; deck A goes back to plain playback.
    audio.crossOrigin = null;
    state.deck = "a";
    state.radioPhase = "idle";
    audio.volume = prefs.volume;
    prefs.radioOn = false; persist();
  }
  function setVolume(value) {
    const level = Number(value);
    if (Number.isFinite(level)) prefs.volume = Math.max(0, Math.min(1, level));
    // A running fade picks the new master up on its next step.
    if (!fadeTimer) activeDeck().volume = prefs.volume;
    if (state.source !== "radio") audio.volume = prefs.volume;
    persist();
    if (els.volume) els.volume.value = String(prefs.volume);
    if (els.radioVolume) els.radioVolume.value = String(prefs.volume);
  }
  function setSource(source) {
    const next = source === "spotify" ? "spotify" : source === "radio" ? "radio" : "local";
    const previous = state.source;
    if (next !== previous) {
      if (previous === "radio") stopRadio();
      audio?.pause();
    }
    state.source = next;
    if (prefs.source !== next) { prefs.source = next; persist(); }
    // Radio borrows deck A, so coming back hands the selected track back to
    // it: loaded, not playing.
    const track = state.tracks[state.selected];
    if (next === "local" && previous !== "local" && track && audio.src !== track.url) { audio.src = track.url; audio.load(); }
    if (next !== "spotify" && els.embed) { els.embed.remove(); els.embed = null; }
    if (next === "spotify" && state.spotify) mountSpotify();
    render(); announce();
  }
  function mountSpotify() {
    if (!state.spotify || state.source !== "spotify" || !els.spotifyPlayer) return;
    if (els.embed?.src === state.spotify.embed) return;
    els.embed?.remove();
    const frame = element("iframe", "music-spotify-frame", null, els.spotifyPlayer);
    frame.src = state.spotify.embed;
    frame.title = `Spotify ${state.spotify.type} player`;
    frame.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    els.embed = frame;
  }
  function loadSpotify(raw) {
    init();
    const link = spotifyLink(raw);
    if (!link) { note("Paste a Spotify playlist, album or track link.", true); return false; }
    state.spotify = link;
    prefs.spotify = [link.url, ...prefs.spotify.filter((url) => url !== link.url)].slice(0, 6);
    persist();
    setSource("spotify");
    if (els.spotifyInput) els.spotifyInput.value = link.url;
    note("Spotify is ready. Use its player below; availability depends on Spotify.");
    return true;
  }
  async function play() {
    if (state.source !== "local") return;
    if (!state.tracks[state.selected]) { els.files?.click(); return; }
    try { await audio.play(); note(""); }
    catch (error) { note(`Could not play this file: ${error?.message || "format unavailable"}`, true); }
    renderTransport(); announce();
  }
  function selectTrack(index, autoplay = false) {
    const track = state.tracks[index];
    if (!track) return false;
    audio.pause();
    state.selected = index;
    setSource("local");
    audio.src = track.url;
    audio.load();
    note(""); render(); announce();
    if (autoplay) void play();
    return true;
  }
  function addFiles(files) {
    init();
    const accepted = Array.from(files || []).filter(audioFile);
    const known = new Set(state.tracks.map((track) => track.key));
    for (const file of accepted) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (known.has(key)) continue;
      known.add(key);
      state.tracks.push({ key, title: trackName(file.name), name: file.name, url: URL.createObjectURL(file) });
    }
    if (state.selected < 0 && state.tracks.length) selectTrack(0);
    else render();
    if (!accepted.length) note("Choose audio files such as MP3, WAV, FLAC or OGG.", true);
    else note(`${state.tracks.length} local track${state.tracks.length === 1 ? "" : "s"} ready.`);
    announce();
    return accepted.length;
  }
  function removeTrack(index) {
    const track = state.tracks[index];
    if (!track) return;
    const wasCurrent = index === state.selected;
    const wasPlaying = !audio.paused;
    if (wasCurrent) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    state.tracks.splice(index, 1);
    URL.revokeObjectURL(track.url);
    if (wasCurrent) {
      state.selected = -1;
      if (state.tracks.length) selectTrack(Math.min(index, state.tracks.length - 1), wasPlaying);
    } else if (index < state.selected) state.selected -= 1;
    render(); announce();
  }
  function move(step, wrap = true) {
    const next = nextIndex(state.selected, state.tracks.length, step, wrap);
    if (next >= 0) selectTrack(next, true);
    else { renderTransport(); announce(); }
  }
  function renderTransport() {
    if (!initialized || !els.play) return;
    const current = state.tracks[state.selected];
    els.trackTitle.textContent = current?.title || "Your own soundtrack";
    els.trackSub.textContent = current ? `Track ${state.selected + 1} of ${state.tracks.length} · Local audio` : "Add music from your computer to get started.";
    els.play.textContent = !audio.paused && state.source === "local" ? "Pause" : "Play";
    els.play.setAttribute("aria-label", !audio.paused ? "Pause local music" : "Play local music");
    els.previous.disabled = !current;
    els.next.disabled = !current;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    els.seek.disabled = !duration;
    els.seek.max = String(duration || 1);
    if (document.activeElement !== els.seek) els.seek.value = String(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    els.elapsed.textContent = timeLabel(audio.currentTime);
    els.duration.textContent = timeLabel(duration);
    els.volume.value = String(audio.volume);
  }
  function renderQueue() {
    if (!els.queue) return;
    els.queue.textContent = "";
    els.queueCount.textContent = String(state.tracks.length);
    if (!state.tracks.length) element("li", "music-empty", "No files added yet. Your local queue stays here for this session.", els.queue);
    for (const [index, track] of state.tracks.entries()) {
      const row = element("li", `music-track${index === state.selected ? " selected" : ""}`, null, els.queue);
      element("span", "music-track-number", String(index + 1).padStart(2, "0"), row);
      const choice = button(track.title, "music-track-select", row, () => selectTrack(index, true));
      choice.title = track.name;
      if (index === state.selected) choice.setAttribute("aria-current", "true");
      const remove = button("×", "ghost music-track-remove", row, () => removeTrack(index));
      remove.setAttribute("aria-label", `Remove ${track.title}`);
    }
  }
  function render() {
    if (!initialized) return;
    const local = state.source === "local";
    const radio = state.source === "radio";
    els.local.hidden = !local; els.radio.hidden = !radio; els.spotify.hidden = !(state.source === "spotify");
    els.localTab.setAttribute("aria-selected", String(local));
    els.radioTab.setAttribute("aria-selected", String(radio));
    els.spotifyTab.setAttribute("aria-selected", String(state.source === "spotify"));
    renderTransport(); renderQueue(); renderRadio(); renderAudioLink();
    els.recent.textContent = "";
    for (const url of prefs.spotify) {
      const item = spotifyLink(url);
      const recent = button(`${item.type} · ${item.id.slice(0, 7)}…`, "ghost music-recent-link", els.recent, () => loadSpotify(url));
      recent.title = url;
    }
    els.recommend.disabled = state.sending || !(recommender || window.mefiStudio?.musicRecommend);
    els.recommend.textContent = state.sending ? "Finding a direction…" : "Ask for recommendations";
    els.aiHint.textContent = recommender || window.mefiStudio?.musicRecommend ? "Uses Studio’s configured assistant. Recommendations appear here." : "Music recommendations need Studio’s assistant connection.";
  }
  function renderRadio() {
    if (!els.radioState) return;
    const tuned = station(state.station);
    const phase = state.source === "radio" ? state.radioPhase : "idle";
    const label = !tuned ? "No station tuned"
      : phase === "connecting" ? `Connecting to ${tuned.name}…`
      : phase === "buffering" ? `${tuned.name} paused for buffer — holding the sound`
      : phase === "playing" ? `${tuned.name}${tuned.origin === tuned.name ? "" : ` · ${tuned.origin}`} · mirror ${state.mirror + 1} of ${tuned.mirrors.length}`
      : phase === "error" ? `${tuned.name} could not be reached`
      : `${tuned.name} ready`;
    els.radioState.textContent = state.radioNote ? `${label} — ${state.radioNote}` : label;
    els.radioState.dataset.phase = phase;
    if (els.radioStop) els.radioStop.disabled = !(state.source === "radio" && phase !== "idle");
    if (els.radioVolume && document.activeElement !== els.radioVolume) els.radioVolume.value = String(prefs.volume);
    for (const [id, node] of Object.entries(els.stationButtons || {})) {
      const current = state.source === "radio" && id === state.station;
      node.setAttribute("aria-pressed", String(current));
      node.dataset.state = current ? phase : "off";
    }
  }
  function renderAudioLink(status = window.MefiIdle?.audioStatus?.()) {
    if (!els.audioToggle) return;
    const connected = audioLinkEnabled(status);
    els.audioToggle.disabled = !window.MefiIdle?.setMusicReactive;
    els.audioToggle.textContent = connected ? "Disconnect" : status?.error ? "Retry audio link" : "Connect audio";
    els.audioToggle.setAttribute("aria-pressed", String(connected));
    const label = status?.label || "Audio link off";
    if (els.audioState.textContent !== label) els.audioState.textContent = label;
    els.audioHint.textContent = status?.description || "Connect local music, desktop audio or your microphone to the nodes.";
    els.audioSource.value = status?.selection || "auto";
    els.audioSource.disabled = !window.MefiIdle?.setAudioSource;
    els.audioResponse.value = String(status?.response ?? .35);
    els.audioResponse.disabled = !window.MefiIdle?.setAudioResponse;
    els.audioResponseValue.textContent = `${Math.round((status?.response ?? .35) * 100)}%`;
    for (const [key, effect] of Object.entries(AUDIO_EFFECTS)) {
      els.audioEffects[key].checked = status?.effects?.[key] ?? effect.enabled;
      els.audioEffects[key].disabled = !window.MefiIdle?.setAudioEffects;
    }
  }
  function audioLinkEnabled(status) {
    return Boolean(status?.reactive && (status.listening || status.pending || status.selection === "local" && !status.error));
  }
  async function recommend() {
    if (state.sending) return;
    const service = recommender || window.mefiStudio?.musicRecommend;
    if (!service) return;
    const mood = els.mood.value.trim() || "Instrumental music for focused creative work";
    state.sending = true; render();
    els.recommendation.textContent = "Listening to your preferences…";
    try {
      const result = await service({ mood: mood.slice(0, 600), source: state.source });
      if (!result?.ok) throw new Error(result?.error || "Recommendations are unavailable.");
      const suggestions = (Array.isArray(result.suggestions) ? result.suggestions : []).filter((item) => item && (item.title || item.query)).slice(0, 5);
      const text = String(result.text || result.reply?.text || "").trim();
      if (!suggestions.length && !text) throw new Error("The assistant returned no recommendations.");
      els.recommendation.textContent = suggestions.length ? "" : text;
      for (const item of suggestions) {
        const card = element("article", "music-suggestion", null, els.recommendation);
        element("strong", null, String(item.title || item.query), card);
        if (item.artist) element("span", "music-suggestion-artist", String(item.artist), card);
        if (item.reason) element("p", null, String(item.reason), card);
        const query = String(item.query || `${item.title || ""} ${item.artist || ""}`).trim().slice(0, 300);
        const url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
        const search = button("Search Spotify ↗", "ghost music-suggestion-search", card, () => {
          if (window.mefiStudio?.openExternal) Promise.resolve(window.mefiStudio.openExternal(url)).catch(() => note("Spotify search could not be opened.", true));
          else window.open(url, "_blank", "noopener,noreferrer");
        });
        search.title = "Search Spotify in your browser, then paste a track or playlist link here";
      }
      els.recommendation.dataset.error = "false";
    } catch (error) {
      els.recommendation.textContent = error?.message || "Recommendations are unavailable.";
      els.recommendation.dataset.error = "true";
    } finally { state.sending = false; render(); }
  }
  function build() {
    els.overlay = element("div", "music-overlay", null, document.body);
    els.overlay.id = "music-overlay"; els.overlay.hidden = true;
    const sheet = element("section", "sheet music-sheet", null, els.overlay);
    sheet.tabIndex = -1; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "false"); sheet.setAttribute("aria-labelledby", "music-heading");
    els.sheet = sheet;
    const header = element("header", "music-header", null, sheet);
    els.header = header;
    const heading = element("div", null, null, header);
    element("span", "eyebrow", "Your look. Your sound.", heading);
    const title = element("h2", null, "Style & sound", heading); title.id = "music-heading";
    // The jump strip: Look · Sound, the group in view marked as you scroll.
    const jump = element("nav", "music-jump", null, heading); jump.setAttribute("aria-label", "Style & sound groups");
    els.jumps = {};
    for (const [group, label, hint] of [["look", "Look", "Color theme and node tree"], ["sound", "Sound", "Music, audio link and recommendations"]]) {
      if (group === "sound") element("span", "music-jump-dot", "·", jump).setAttribute("aria-hidden", "true");
      els.jumps[group] = button(label, "music-jump-link", jump, () => jumpTo(group), `music-jump-${group}`);
      els.jumps[group].title = hint;
    }
    button("Close", "ghost", header, close, "music-close");
    const body = element("div", "music-body", null, sheet);
    // Look first: the color theme, then the node tree with its Void styles.
    // The header strip jumps between Look and Sound; a jump lands on the
    // group's label, so the next Tab continues inside that group.
    const settings = element("div", "music-settings", null, body);
    settings.id = "music-look"; settings.setAttribute("role", "region"); settings.setAttribute("aria-labelledby", "music-look-label");
    const lookLabel = element("p", "eyebrow music-group-label", "Look", settings); lookLabel.id = "music-look-label"; lookLabel.tabIndex = -1;
    const themeSection = element("section", "music-section music-colors", null, settings);
    element("span", "eyebrow", "Set the mood", themeSection); element("h3", null, "Color theme", themeSection);
    els.themes = element("div", "music-themes", null, themeSection);
    els.themes.setAttribute("role", "group"); els.themes.setAttribute("aria-label", "Color theme");
    for (const [key, palette] of [...Object.entries(THEMES).filter(([key]) => isFreeTheme(key)), ["custom", { name: "Custom palette", bright: prefs.customColors.accent }]]) {
      const choice = button(palette.name, "music-theme", els.themes, () => applyTheme(key));
      choice.dataset.theme = key; choice.style.setProperty("--swatch", palette.bright); choice.setAttribute("aria-pressed", String(effective.theme === key));
    }
    els.customPalette = element("fieldset", "music-custom-palette", null, themeSection); els.customPalette.id = "music-custom-palette";
    element("legend", null, "Your colors", els.customPalette);
    const help = element("p", "music-fineprint", "Choose a color or enter #RRGGBB. Studio adjusts text and borders when needed for readability.", els.customPalette); help.id = "music-custom-help";
    els.customInputs = {};
    for (const [key, title] of [["accent", "Accent"], ["background", "Background"], ["surface", "Panels"], ["text", "Text"]]) {
      const row = element("div", "music-color-row", null, els.customPalette);
      const label = element("label", null, title, row); label.htmlFor = `music-color-${key}-hex`;
      const picker = element("input", "music-color-picker", null, row); picker.type = "color"; picker.id = `music-color-${key}`; picker.value = prefs.customColors[key];
      picker.setAttribute("aria-label", `${title} color`); picker.setAttribute("aria-describedby", help.id);
      const hex = element("input", "music-color-hex", null, row); hex.type = "text"; hex.id = `music-color-${key}-hex`; hex.value = prefs.customColors[key]; hex.maxLength = 7; hex.spellcheck = false;
      hex.setAttribute("aria-label", `${title} hex color`); hex.setAttribute("aria-describedby", help.id); hex.setAttribute("pattern", "#[0-9A-Fa-f]{6}");
      picker.addEventListener("input", () => applyCustomColors({ [key]: picker.value }));
      hex.addEventListener("input", () => {
        const valid = Boolean(hexColor(hex.value)); hex.setAttribute("aria-invalid", String(!valid));
        if (valid) applyCustomColors({ [key]: hex.value });
      });
      els.customInputs[key] = { picker, hex };
    }
    button("Reset custom colors", "ghost music-custom-reset", els.customPalette, () => applyCustomColors(CUSTOM_DEFAULTS), "music-custom-reset");
    els.premiumThemes = premiumThemeChoices(themeSection);
    element("p", "music-fineprint", "Colors are separate from node style and layout.", themeSection);
    const nodeSection = element("section", "music-node-settings", null, settings);
    nodeSection.setAttribute("aria-labelledby", "music-node-heading");
    const nodeHeading = element("h3", null, "Node tree", nodeSection); nodeHeading.id = "music-node-heading";
    element("p", "music-node-intro", "See your changes in the live tree. Appearance and arrangement are independent.", nodeSection);
    els.nodeStyles = graphChoices(nodeSection, "style", Object.fromEntries(Object.entries(NODE_STYLES).filter(([key]) => isFreeNodeStyle(key))), effective.nodeStyle, applyNodeStyle);
    els.premiumStyles = premiumStyleChoices(nodeSection);
    els.nodeLayouts = graphChoices(nodeSection, "layout", NODE_LAYOUTS, prefs.nodeLayout, applyNodeLayout);
    const layoutHint = element("p", "music-fineprint", "Choosing a layout rearranges the tree. Existing nodes keep their places as work updates.", nodeSection);
    layoutHint.id = "music-node-layout-hint";
    els.nodeLayouts.setAttribute("aria-describedby", layoutHint.id);
    const effectsHeading = element("h4", "music-node-label", "Effects", nodeSection); effectsHeading.id = "music-effects-label";
    const effects = element("div", "music-effects", null, nodeSection); effects.setAttribute("role", "group"); effects.setAttribute("aria-labelledby", effectsHeading.id);
    for (const [key, id, effectClass, title, hint] of [
      ["orbitTrails", "music-orbit-trails", "music-effect-orbitTrails", "Blue orbit trails", "Circle queued and running work."],
      ["extraGlow", "music-extra-glow", "music-effect-extraGlow", "Extra glow", "Brighter halos and luminous cores."],
    ]) {
      const row = element("label", `music-effect ${effectClass}`, null, effects);
      const sample = element("span", "music-effect-sample", null, row); sample.setAttribute("aria-hidden", "true");
      const copy = element("span", "music-effect-copy", null, row);
      element("strong", null, title, copy);
      const description = element("small", null, hint, copy); description.id = `${id}-hint`;
      const input = element("input", null, null, row); input.type = "checkbox"; input.id = id; input.checked = prefs[key];
      input.setAttribute("aria-label", title); input.setAttribute("aria-describedby", description.id);
      input.addEventListener("change", () => applyNodeEffects({ [key]: input.checked }));
      els[key] = input;
    }
    element("p", "music-fineprint", "Decorative effects keep work nodes in place. Reduced motion pauses the orbit trails.", nodeSection);
    // Sound: the player, the audio link directly under it, then the
    // listening companion (the aside).
    const main = element("main", "music-main", null, body);
    main.id = "music-sound"; main.setAttribute("aria-labelledby", "music-sound-label");
    const soundLabel = element("p", "eyebrow music-group-label", "Sound", main); soundLabel.id = "music-sound-label"; soundLabel.tabIndex = -1;
    els.groups = { look: { group: settings, label: lookLabel }, sound: { group: main, label: soundLabel } };
    const tabs = element("div", "music-tabs", null, main); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Music source");
    els.localTab = button("Local music", "music-tab", tabs, () => setSource("local"), "music-local-tab");
    els.radioTab = button("Ad-free radio", "music-tab", tabs, () => setSource("radio"), "music-radio-tab");
    els.spotifyTab = button("Spotify", "music-tab", tabs, () => setSource("spotify"), "music-spotify-tab");
    const tabFor = (source) => source === "local" ? els.localTab : source === "radio" ? els.radioTab : els.spotifyTab;
    for (const [tab, panelId] of [[els.localTab, "music-local-panel"], [els.radioTab, "music-radio-panel"], [els.spotifyTab, "music-spotify-panel"]]) { tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", panelId); }
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const order = ["local", "radio", "spotify"];
      const index = Math.max(0, order.indexOf(state.source));
      const source = event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1]
        : order[(index + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
      setSource(source); tabFor(source).focus();
    });
    els.local = element("section", "music-local", null, main); els.local.id = "music-local-panel"; els.local.setAttribute("role", "tabpanel"); els.local.setAttribute("aria-labelledby", "music-local-tab");
    const player = element("div", "music-player", null, els.local);
    const art = element("div", "music-art", "♫", player); art.setAttribute("aria-hidden", "true");
    const track = element("div", "music-now", null, player);
    element("span", "eyebrow", "Now playing", track);
    els.trackTitle = element("h3", "music-title", null, track);
    els.trackSub = element("p", "music-subtitle", null, track);
    const transport = element("div", "music-transport", null, track);
    els.previous = button("Previous", "ghost", transport, () => audio.currentTime > 3 ? (audio.currentTime = 0) : move(-1), "music-previous");
    els.play = button("Play", "primary", transport, () => audio.paused ? void play() : audio.pause(), "music-play");
    els.next = button("Next", "ghost", transport, () => move(1), "music-next");
    const timeline = element("div", "music-timeline", null, els.local);
    els.elapsed = element("span", null, "0:00", timeline);
    els.seek = element("input", null, null, timeline); els.seek.id = "music-seek"; els.seek.type = "range"; els.seek.min = "0"; els.seek.step = ".1"; els.seek.setAttribute("aria-label", "Playback position");
    els.seek.addEventListener("input", () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(els.seek.value); renderTransport(); });
    els.duration = element("span", null, "0:00", timeline);
    const utilities = element("div", "music-utilities", null, els.local);
    button("Add audio files", "ghost", utilities, () => els.files.click(), "music-add-files");
    els.files = element("input", null, null, utilities); els.files.id = "music-files"; els.files.type = "file"; els.files.multiple = true; els.files.accept = "audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.webm"; els.files.hidden = true;
    els.files.addEventListener("change", () => { addFiles(els.files.files); els.files.value = ""; });
    const volumeLabel = element("label", "music-volume", "Volume", utilities);
    els.volume = element("input", null, null, volumeLabel); els.volume.type = "range"; els.volume.min = "0"; els.volume.max = "1"; els.volume.step = ".01"; els.volume.setAttribute("aria-label", "Music volume");
    els.volume.addEventListener("input", () => setVolume(els.volume.value));
    const queueHead = element("div", "music-queue-heading", null, els.local);
    element("h3", null, "Your queue", queueHead); els.queueCount = element("span", "music-count", "0", queueHead);
    els.queue = element("ol", "music-queue", null, els.local); els.queue.id = "music-queue";
    element("p", "music-fineprint", "Local playback needs no account. Reselect your files after restarting Studio.", els.local);
    els.local.addEventListener("dragover", (event) => { event.preventDefault(); els.local.classList.add("drag-over"); });
    els.local.addEventListener("dragleave", () => els.local.classList.remove("drag-over"));
    els.local.addEventListener("drop", (event) => { event.preventDefault(); els.local.classList.remove("drag-over"); addFiles(event.dataTransfer?.files); });
    els.radio = element("section", "music-radio", null, main); els.radio.id = "music-radio-panel"; els.radio.setAttribute("role", "tabpanel"); els.radio.setAttribute("aria-labelledby", "music-radio-tab");
    element("h3", null, "Ad-free radio", els.radio);
    element("p", "music-subtitle", "Listener-funded stations that carry no advertising, so there is nothing to skip. These play through Studio’s own player, which means the node tree reacts to them.", els.radio);
    els.radioState = element("p", "music-radio-state", "No station tuned", els.radio);
    els.radioState.id = "music-radio-state"; els.radioState.setAttribute("role", "status");
    const stationList = element("div", "music-stations", null, els.radio);
    stationList.setAttribute("role", "group"); stationList.setAttribute("aria-label", "Stations");
    els.stationButtons = {};
    for (const item of STATIONS) {
      const card = button("", "music-station", stationList, () => tune(item.id), `music-station-${item.id}`);
      const copy = element("span", "music-station-copy", null, card);
      element("strong", null, item.name, copy);
      element("small", null, `${item.detail} · ${item.origin}`, copy);
      card.setAttribute("aria-pressed", "false");
      card.title = `${item.name} — ${item.mirrors.length} mirror${item.mirrors.length === 1 ? "" : "s"}`;
      els.stationButtons[item.id] = card;
    }
    const radioControls = element("div", "music-radio-controls", null, els.radio);
    els.radioStop = button("Stop radio", "ghost", radioControls, () => { stopRadio(); render(); announce(); }, "music-radio-stop");
    els.radioStop.disabled = true;
    const radioVolumeLabel = element("label", "music-volume", "Volume", radioControls);
    els.radioVolume = element("input", null, null, radioVolumeLabel); els.radioVolume.id = "music-radio-volume"; els.radioVolume.type = "range"; els.radioVolume.min = "0"; els.radioVolume.max = "1"; els.radioVolume.step = ".01"; els.radioVolume.setAttribute("aria-label", "Radio volume");
    els.radioVolume.value = String(prefs.volume);
    els.radioVolume.addEventListener("input", () => setVolume(els.radioVolume.value));
    element("p", "music-fineprint", "Each station lists several mirrors. If one stops sending, Studio brings the next one up on a second deck and crosses over, so the music keeps playing through the handover.", els.radio);
    els.spotify = element("section", "music-spotify", null, main); els.spotify.id = "music-spotify-panel"; els.spotify.setAttribute("role", "tabpanel"); els.spotify.setAttribute("aria-labelledby", "music-spotify-tab");
    element("h3", null, "Bring a Spotify playlist", els.spotify);
    element("p", "music-subtitle", "Paste a playlist, album or song link. Spotify’s controls stay right here.", els.spotify);
    const spotifyForm = element("form", "music-link-form", null, els.spotify);
    els.spotifyInput = element("input", null, null, spotifyForm); els.spotifyInput.id = "music-spotify-url"; els.spotifyInput.type = "text"; els.spotifyInput.inputMode = "url"; els.spotifyInput.placeholder = "https://open.spotify.com/playlist/…"; els.spotifyInput.setAttribute("aria-label", "Spotify playlist, album or track link");
    button("Load", "primary", spotifyForm, () => loadSpotify(els.spotifyInput.value), "music-spotify-load");
    spotifyForm.addEventListener("submit", (event) => { event.preventDefault(); loadSpotify(els.spotifyInput.value); });
    els.recent = element("div", "music-recent", null, els.spotify);
    els.spotifyPlayer = element("div", "music-spotify-player", null, els.spotify);
    element("p", "music-fineprint", "Spotify manages playback and may offer previews or ask you to sign in. Local player controls do not control Spotify.", els.spotify);
    const audioLink = element("section", "music-audio-link", null, main);
    audioLink.setAttribute("aria-labelledby", "music-audio-heading");
    const audioHeading = element("h3", null, "Audio link", audioLink); audioHeading.id = "music-audio-heading";
    element("p", "music-fineprint", "Gentle waves and node glow follow quiet or loud music. Add drum accents or background glow when you want more movement.", audioLink);
    const audioControls = element("div", "music-audio-controls", null, audioLink);
    const sourceLabel = element("label", null, "Listen to", audioControls);
    els.audioSource = element("select", null, null, sourceLabel); els.audioSource.id = "music-audio-source";
    for (const [value, title] of [["auto", "Auto · local or desktop"], ["local", "Local player"], ["desktop", "Desktop audio / Spotify"], ["mic", "Microphone"]]) {
      const option = element("option", null, title, els.audioSource); option.value = value;
    }
    els.audioSource.addEventListener("change", () => { window.MefiIdle?.setAudioSource?.(els.audioSource.value); renderAudioLink(); });
    els.audioToggle = button("Connect audio", "ghost", audioControls, () => {
      const status = window.MefiIdle?.audioStatus?.();
      window.MefiIdle?.setMusicReactive?.(!audioLinkEnabled(status));
      renderAudioLink();
    }, "music-audio-toggle");
    els.audioState = element("p", "music-audio-state", "Audio link off", audioLink); els.audioState.id = "music-audio-state"; els.audioState.setAttribute("role", "status");
    els.audioHint = element("p", "music-fineprint", "", audioLink); els.audioHint.id = "music-audio-hint";
    els.audioSource.setAttribute("aria-describedby", els.audioHint.id);
    const responseLabel = element("label", "music-audio-response", "Response", audioLink);
    els.audioResponse = element("input", null, null, responseLabel); els.audioResponse.id = "music-audio-response";
    els.audioResponse.type = "range"; els.audioResponse.min = "0"; els.audioResponse.max = "2"; els.audioResponse.step = "0.05";
    els.audioResponseValue = element("output", null, "35%", responseLabel); els.audioResponseValue.setAttribute("for", els.audioResponse.id);
    els.audioResponse.addEventListener("input", () => { window.MefiIdle?.setAudioResponse?.(Number(els.audioResponse.value)); renderAudioLink(); });
    const responseHint = element("p", "music-fineprint", "Starts gently at 35%. Lower to 0% to settle the effects without changing playback volume.", audioLink); responseHint.id = "music-audio-response-hint";
    els.audioResponse.setAttribute("aria-label", "Audio response strength"); els.audioResponse.setAttribute("aria-describedby", responseHint.id);
    const audioEffectsHeading = element("h4", "music-node-label", "Reactions", audioLink); audioEffectsHeading.id = "music-audio-effects-label";
    const audioEffects = element("div", "music-effects music-audio-effects", null, audioLink); audioEffects.setAttribute("role", "group"); audioEffects.setAttribute("aria-labelledby", audioEffectsHeading.id);
    els.audioEffects = {};
    for (const [key, effect] of Object.entries(AUDIO_EFFECTS)) {
      const id = `music-audio-${key}`;
      const row = element("label", "music-effect", null, audioEffects);
      const copy = element("span", "music-effect-copy", null, row);
      element("strong", null, effect.title, copy);
      const description = element("small", null, effect.detail, copy); description.id = `${id}-hint`;
      const input = element("input", null, null, row); input.type = "checkbox"; input.id = id; input.checked = effect.enabled;
      input.setAttribute("aria-label", effect.title); input.setAttribute("aria-describedby", description.id);
      input.addEventListener("change", () => { window.MefiIdle?.setAudioEffects?.({ [key]: input.checked }); renderAudioLink(); });
      els.audioEffects[key] = input;
    }
    const aside = element("aside", "music-side", null, body);
    const ai = element("section", "music-section music-ai", null, aside);
    element("span", "eyebrow", "A listening companion", ai); element("h3", null, "Find your next sound", ai);
    const moodLabel = element("label", "music-mood-label", "What are you in the mood for?", ai);
    els.mood = element("textarea", null, null, moodLabel); els.mood.id = "music-mood"; els.mood.rows = 3; els.mood.maxLength = 600; els.mood.placeholder = "Warm ambient, no vocals, a little energy…";
    els.recommend = button("Ask for recommendations", "ghost", ai, () => void recommend(), "music-recommend");
    els.aiHint = element("p", "music-fineprint", null, ai);
    els.recommendation = element("div", "music-recommendation", "", ai); els.recommendation.id = "music-recommendation"; els.recommendation.setAttribute("aria-live", "polite");
    els.notice = element("p", "music-notice", "", sheet); els.notice.setAttribute("role", "status");
    const preview = element("section", "music-preview", null, els.overlay);
    preview.setAttribute("aria-labelledby", "music-preview-heading");
    const previewHeader = element("header", "music-preview-header", null, preview);
    const previewTitle = element("h3", null, "Live node tree", previewHeader); previewTitle.id = "music-preview-heading";
    els.previewViews = element("div", "music-preview-views", null, previewHeader); els.previewViews.setAttribute("role", "group"); els.previewViews.setAttribute("aria-label", "Node tree view");
    for (const view of ["2d", "3d"]) {
      const choice = button(view.toUpperCase(), "ghost", els.previewViews, () => { window.MefiIdle?.setView?.(view); syncTreeView(view); schedulePreview(); }, `music-tree-view-${view}`);
      choice.dataset.view = view; choice.setAttribute("aria-label", view === "2d" ? "Flat 2D node tree" : "Perspective 3D node tree");
    }
    els.previewFit = button("Fit", "ghost music-preview-fit", els.previewViews, () => window.MefiIdle?.fitAll?.(), "music-tree-fit");
    els.previewFit.title = "Rearrange and fit the node tree";
    els.previewFit.setAttribute("aria-label", "Fit the node tree in the preview");
    els.previewHint = element("p", null, null, previewHeader);
    syncTreeView();
    // This transparent region measures the available canvas space. The graph
    // remains the existing Command canvas, including its normal interactions.
    els.preview = element("div", "music-tree-preview", null, preview); els.preview.id = "music-tree-preview";
    els.preview.setAttribute("aria-hidden", "true");
    sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    });
    sheet.addEventListener("scroll", scheduleJump, { passive: true });
  }
  // A jump scrolls the group to just under the sticky header (Look is the top)
  // and moves focus to its label without a second scroll; the scroll itself
  // updates the strip's mark.
  function jumpTo(group) {
    const target = els.groups?.[group];
    if (!target || !els.sheet) return;
    let top = 0;
    if (group !== "look") {
      try { top = els.sheet.scrollTop + target.group.getBoundingClientRect().top - els.header.getBoundingClientRect().bottom + 1; } catch { top = 0; }
    }
    let still = false;
    try { still = Boolean(window.MefiNav?.noMotion?.()); } catch {}
    try { els.sheet.scrollTo({ top: Math.max(0, top), behavior: still ? "auto" : "smooth" }); } catch {}
    target.label.focus?.({ preventScroll: true });
  }
  // Sound is marked once its group reaches the header, or the sheet is at its
  // end (a short Sound group never reaches the top); Look otherwise.
  function syncJump() {
    jumpFrame = 0;
    if (!state.opened || !els.groups) return;
    let current = "look";
    try {
      const room = els.sheet.scrollHeight - els.sheet.clientHeight;
      const line = els.header.getBoundingClientRect().bottom + 32;
      if ((room > 2 && els.sheet.scrollTop >= room - 2) || els.groups.sound.group.getBoundingClientRect().top <= line) current = "sound";
    } catch {}
    for (const [group, link] of Object.entries(els.jumps || {})) {
      if (group === current) { if (link.getAttribute?.("aria-current") !== "true") link.setAttribute("aria-current", "true"); }
      else link.removeAttribute("aria-current");
    }
  }
  function scheduleJump() {
    if (!state.opened || jumpFrame) return;
    if (typeof window.requestAnimationFrame === "function") jumpFrame = window.requestAnimationFrame(syncJump);
    else syncJump();
  }
  function updatePreview() {
    previewFrame = 0;
    if (!state.opened || !window.MefiIdle?.setSettingsPreview) return;
    const rect = els.preview?.getBoundingClientRect?.();
    if (!rect || rect.width < 160 || rect.height < 160) return;
    window.MefiIdle.setSettingsPreview({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  }
  function schedulePreview() {
    if (!state.opened || previewFrame) return;
    if (typeof window.requestAnimationFrame === "function") previewFrame = window.requestAnimationFrame(updatePreview);
    else updatePreview();
  }
  function syncTreeView(view = null) {
    const selected = view || window.MefiIdle?.status?.()?.view || window.MefiIdle?.geometryStatus?.()?.view || "3d";
    for (const choice of els.previewViews?.children || []) {
      if (!choice.dataset.view) continue;
      choice.setAttribute("aria-pressed", String(choice.dataset.view === selected));
      choice.disabled = typeof window.MefiIdle?.setView !== "function";
    }
    if (els.previewFit) els.previewFit.disabled = typeof window.MefiIdle?.fitAll !== "function";
    if (els.previewHint) els.previewHint.textContent = selected === "2d" ? "Drag to pan · Scroll to zoom · Fit to see the whole tree" : "Drag to pan · Right-drag to orbit · Scroll to zoom";
  }
  function init() {
    if (initialized) return;
    initialized = true;
    audio = document.createElement("audio"); audio.preload = "metadata"; audio.volume = prefs.volume;
    audio.addEventListener("play", () => { renderTransport(); announce(); });
    audio.addEventListener("pause", () => { renderTransport(); announce(); });
    audio.addEventListener("ended", () => { if (state.source === "local") move(1, false); });
    audio.addEventListener("timeupdate", renderTransport); audio.addEventListener("loadedmetadata", renderTransport); audio.addEventListener("durationchange", renderTransport);
    audio.addEventListener("error", () => {
      // A dead stream is a mirror problem, not a file-format problem; the
      // deck's radio listener already handed it to the mirror watchdog.
      if (state.source === "radio") return;
      if (audio.src) note("This audio file could not be played. Try another format.", true);
      renderTransport(); announce();
    });
    bindDeck(audio);
    state.station = prefs.station;
    // The last session's source comes back with it. Local files are granted
    // per session and must be chosen again; a Spotify link returns to its tab
    // and its player mounts when the sheet opens, since Spotify owns playback.
    const lastSpotify = prefs.source === "spotify" ? spotifyLink(prefs.spotify[0]) : null;
    if (lastSpotify) { state.spotify = lastSpotify; state.source = "spotify"; }
    else if (prefs.source === "radio") state.source = "radio";
    // A member's premium choice is painted straight away, in place of the free
    // one rather than after it, and nothing is written back.
    const unlocked = premiumAllowed();
    if (unlocked && premium.nodeStyle) effective.nodeStyle = premium.nodeStyle;
    build();
    if (unlocked && premium.theme) event("mefi-theme-change", paintTheme(premium.theme));
    else applyTheme(prefs.theme, false);
    syncTreePreferences(false); renderPremiumLocks(unlocked); render();
    if (lastSpotify) els.spotifyInput.value = lastSpotify.url;
    // A station that was sounding when Studio closed is tuned again. Smoke and
    // capture runs share the owner's profile, so they stay silent.
    const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
    if (state.source === "radio" && prefs.radioOn && station(state.station) && !headless) tune(state.station);
    window.addEventListener("resize", schedulePreview);
    window.addEventListener("mefi-tree-view", (event) => syncTreeView(event.detail?.view));
    window.addEventListener("mefi-audio-change", (event) => renderAudioLink(event.detail));
    window.addEventListener("mefi-community-change", (event) => syncPremium(typeof event?.detail?.premium === "boolean" ? event.detail.premium : premiumAllowed()));
    // Linking can become possible or moot with the entitlement unchanged.
    window.addEventListener("mefi-community-status", () => renderPremiumLocks());
    if (typeof window.ResizeObserver === "function") new window.ResizeObserver(schedulePreview).observe(els.preview);
    window.addEventListener("beforeunload", () => { for (const track of state.tracks) URL.revokeObjectURL(track.url); });
  }
  function open() {
    init();
    if (state.opened) { els.sheet.focus(); schedulePreview(); return; }
    priorFocus = document.activeElement;
    restoreWorkspace = Boolean(window.MefiIdle?.setSettingsPreview && window.MefiWorkspace?.isActive?.());
    state.opened = true; els.overlay.hidden = false;
    // Claim before opening the canvas, so navigation retains the true origin.
    window.MefiNav?.claim?.("music");
    els.sheet.setAttribute("aria-modal", "false");
    if (restoreWorkspace) window.MefiWorkspace.exit();
    document.body.classList.add("music-preview-active");
    mountSpotify();
    renderPremiumLocks();
    render(); syncTreeView(); els.sheet.focus(); schedulePreview(); scheduleJump();
  }
  function close() {
    if (!els.overlay || els.overlay.hidden) return;
    state.opened = false; els.overlay.hidden = true;
    if (previewFrame) window.cancelAnimationFrame?.(previewFrame);
    previewFrame = 0;
    if (jumpFrame) window.cancelAnimationFrame?.(jumpFrame);
    jumpFrame = 0;
    window.MefiIdle?.setSettingsPreview?.(null);
    document.body.classList.remove("music-preview-active");
    if (restoreWorkspace) window.MefiWorkspace?.enter?.();
    restoreWorkspace = false;
    window.MefiNav?.release?.("music");
    if (!window.MefiNav?.release) priorFocus?.focus?.();
  }
  window.MefiMusic = { init, open, close, status, graphPreferences, applyNodeStyle, applyNodeLayout, applyNodeEffects, getAudioElement: () => { init(); return activeDeck(); }, tune, stopRadio,
    stations: () => STATIONS.map((item) => ({ id: item.id, name: item.name, detail: item.detail, origin: item.origin, mirrors: item.mirrors.length })), setRecommender: (fn) => { recommender = typeof fn === "function" ? fn : null; render(); }, addFiles, loadSpotify, setSource, applyTheme, applyCustomColors,
    customColors: () => ({ ...prefs.customColors }), themePalette: () => ({ theme: effective.theme, ...resolvePalette(effective.theme, prefs.customColors) }),
    // isNodeStyle is for the tree painters; the catalog feeds Settings › Community.
    isNodeStyle,
    premiumCatalog: () => ({
      themes: Object.entries(THEMES).filter(([key]) => isPremiumTheme(key)).map(([key, theme]) => ({ key, name: theme.name, accent: theme.accent, bright: theme.bright, accent2: theme.accent2 })),
      nodeStyles: Object.entries(NODE_STYLES).filter(([key]) => isPremiumNodeStyle(key)).map(([key, style]) => ({ key, name: style.name, detail: style.detail })),
    }) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
