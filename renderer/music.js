// Style & sound: Studio's color themes, node styles and layouts (the two-tone
// Void collection among them, free like the rest), the local-file player, the ad-free radio decks and the Links player. A pasted
// link plays in its service's official embed (YouTube, Spotify, SoundCloud,
// Vimeo) or, for a plain audio or video file such as a Discord attachment, in
// a <video> element of its own. An embed's playback state is only what its
// own player reports (YouTube and Vimeo speak a message API; Spotify and
// SoundCloud keep theirs), never guessed. Links no embed can play (a Spotify
// Jam, Twitch, any other page) can open in the player's built-in browser.
// Every source plays through one card: the media menu's mini player, with a
// transport, a volume and quick tree switches, that unfolds into sections.
// It also owns the light themes, the three looks the first run offers (Light,
// Dark, Stylized) with their heading faces, and the Shop's style packs: see
// "Looks and style packs" below for the calls. The node styles the Shop sells
// go on once they are owned ("Node styles from the Shop").
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.music.v1";
  const LINK_RESUME_KEY = "mefiStudio.mediaResume.v1";
  const LINK_RESUME_MS = 600000;
  const LINK_QUEUE_KEY = "mefiStudio.mediaQueue.v1";
  const LINK_QUEUE_LIMIT = 50;
  let linkResumeTimer = null;
  let linkWatchTimer = null, linkPlayback = null;
  let youtubeResults = [], youtubeSearching = false;
  const THEMES = {
    // Chrome, the default: matte black panels and brushed-metal controls
    // (renderer/chrome.css), the same palette as the public website.
    chrome: { name: "Chrome", accent: "#c3c8d0", bright: "#eef1f5", rgb: "195,200,208", bg: "#0a0a0c", panel: "#141418", muted: "#a4a9b2", text: "#edeff2" },
    gold: { name: "Studio gold", accent: "#c9a86a", bright: "#e6c98d", rgb: "201,168,106", bg: "#050507", panel: "#0d0e12", muted: "#aaa18f" },
    midnight: { name: "Midnight", accent: "#82a8e6", bright: "#bbd5ff", rgb: "130,168,230", bg: "#050913", panel: "#0d1524", muted: "#a2b2ca" },
    forest: { name: "Forest", accent: "#85bca3", bright: "#b4e1c9", rgb: "133,188,163", bg: "#050d0b", panel: "#0d1915", muted: "#a2b8ae" },
    violet: { name: "Violet", accent: "#b297de", bright: "#dcc4ff", rgb: "178,151,222", bg: "#0c0711", panel: "#181120", muted: "#b5a7c4" },
    ember: { name: "Ember", accent: "#dd997a", bright: "#ffc5a9", rgb: "221,153,122", bg: "#100805", panel: "#21150f", muted: "#c0ab9d" },
    aurora: { name: "Aurora", accent: "#71cbb7", bright: "#a7f3da", rgb: "113,203,183", bg: "#050d13", panel: "#101f29", muted: "#abc4c9", text: "#e7f5ee" },
    rose: { name: "Rose", accent: "#dc96af", bright: "#ffbed3", rgb: "220,150,175", bg: "#10080f", panel: "#23141e", muted: "#c6aebc", text: "#f7e5ea" },
    // The light themes (tone "light"): dark ink on a pale page, which the
    // stylesheets answer with a light color-scheme, softer shadows and deeper
    // status hues. "bright" is the accent's deeper ink here, as it is its
    // paler one on a dark theme: links, focus rings and chosen tabs use it.
    daylight: { name: "Daylight", accent: "#2753b2", bright: "#1d479e", rgb: "39,83,178", bg: "#eef1f5", panel: "#fbfcfd", muted: "#4b5567", text: "#18202c", tone: "light" },
    paper: { name: "Paper", accent: "#8f421d", bright: "#7a3312", rgb: "143,66,29", bg: "#f3eee4", panel: "#fffcf6", muted: "#625849", text: "#2b241d", tone: "light" },
    // The Void collection, free like every theme: each carries a second hue
    // (accent2) that the "duo" tier paints with, and the pickers list them
    // under their own small heading.
    void: { name: "Void", accent: "#7c6cff", bright: "#b9b0ff", accent2: "#36d1ff", rgb: "124,108,255", bg: "#030208", panel: "#0b0914", muted: "#a49fc2", text: "#ece9ff", collection: "void" },
    eclipse: { name: "Eclipse", accent: "#e8a93c", bright: "#ffd98a", accent2: "#ff6a3d", rgb: "232,169,60", bg: "#040404", panel: "#111013", muted: "#b8ad98", text: "#f3ecdf", collection: "void" },
    abyss: { name: "Abyss", accent: "#2fd6c3", bright: "#8ff5e8", accent2: "#7b5cff", rgb: "47,214,195", bg: "#01080b", panel: "#06151a", muted: "#9dbfc0", text: "#e2f7f4", collection: "void" },
    dusk: { name: "Neon Dusk", accent: "#ff5fa2", bright: "#ffa3cb", accent2: "#3fd0ff", rgb: "255,95,162", bg: "#0a0512", panel: "#170c24", muted: "#c4a9c9", text: "#fbe9f3", collection: "void" },
  };
  // A new install opens in Chrome; a saved choice (Aurora, the default until
  // the Chrome look, among them) is kept as it is.
  const DEFAULT_THEME = "chrome";
  const NODE_STYLES = {
    orbs: { name: "Classic orbs", detail: "Luminous circles" },
    glass: { name: "Soft glass", detail: "Translucent surfaces" },
    minimal: { name: "Minimal", detail: "Quiet points" },
    halo: { name: "Halo", detail: "Luminous rings" },
    crystal: { name: "Crystal", detail: "Faceted gems" },
    singularity: { name: "Singularity", detail: "A black hole with a turning disc", collection: "void" },
    prism: { name: "Prism", detail: "A turning crystal that splits light", collection: "void" },
    sigil: { name: "Sigil", detail: "Hex runes that assemble as it works", collection: "void" },
    // The ones the Shop sells (`shop` is the item: relay/src/shop.mjs CATALOG).
    dragonscale: { name: "Dragon scales", detail: "Scaled gems with ember sparks", shop: "studio:style-dragonscale" },
    constellation: { name: "Star chart", detail: "Bright stars and shooting stars", shop: "studio:style-constellation" },
    lantern: { name: "Lanterns", detail: "Paper lanterns that sway and glow", shop: "studio:style-lantern" },
    neon: { name: "Neon", detail: "Glowing tubes that buzz on at work", shop: "studio:style-neon" },
  };
  // Every theme and node style is free but the ones the Shop sells; `collection`
  // only groups the pickers. A Shop style is worn once MefiShop says it is owned.
  const isTheme = (key) => key === "custom" || typeof key === "string" && Object.hasOwn(THEMES, key);
  const isVoidTheme = (key) => typeof key === "string" && Object.hasOwn(THEMES, key) && THEMES[key].collection === "void";
  const isNodeStyle = (key) => typeof key === "string" && Object.hasOwn(NODE_STYLES, key);
  const isVoidNodeStyle = (key) => isNodeStyle(key) && NODE_STYLES[key].collection === "void";
  const isShopNodeStyle = (key) => isNodeStyle(key) && typeof NODE_STYLES[key].shop === "string";
  const isLightTheme = (key) => typeof key === "string" && Object.hasOwn(THEMES, key) && THEMES[key].tone === "light";
  const NODE_LAYOUTS = {
    constellation: { name: "Constellation", detail: "An open arrangement" },
    tree: { name: "Branches", detail: "A clear hierarchy" },
    radial: { name: "Rings", detail: "Concentric groups" },
    helix: { name: "Helix", detail: "A rising spiral" },
    layers: { name: "Terraces", detail: "Stacked levels" },
  };
  // Heading faces (html[data-studio-font] and --font-display on the root),
  // the one table of them: looks, packs and the Settings picker all name
  // these keys. "studio" keeps each theme's own face (studio-ui.css gives
  // Studio gold its serif and Neon Dusk its Trebuchet); the others replace it
  // on every theme. Faces that ship with the system only: Studio loads no web
  // font, and each stack ends in a generic family.
  const FONTS = {
    studio: { name: "Studio", detail: "Each theme's own headings", stack: null },
    display: { name: "Display", detail: "Tall, condensed headings", stack: '"Bahnschrift Condensed", "Bahnschrift SemiCondensed", "Arial Narrow", "Roboto Condensed", sans-serif', tracking: "0em" },
    serif: { name: "Serif", detail: "Book headings", stack: '"Sitka Heading", "Georgia", "Times New Roman", serif', tracking: "-.015em" },
    mono: { name: "Mono", detail: "Code-style headings", stack: '"Cascadia Code", "Consolas", ui-monospace, monospace', tracking: "-.02em" },
  };
  const isFont = (key) => typeof key === "string" && Object.hasOwn(FONTS, key);
  // Materials are MefiAppearance's presets (renderer/studio-ui.js): how much
  // glass, glow and roundness the surfaces have.
  const MATERIALS = ["focus", "studio", "atmosphere"];
  // The looks the first run offers. Each lists its themes, its default first,
  // and the extras it brings: Light and Dark keep the plain material and each
  // theme's own headings, Stylized opens the glass, raises the glow and sets
  // the display face. A theme added to the table lands in Light or Dark by its
  // tone; Stylized is the expressive ones, named here.
  const STYLIZED_THEMES = ["aurora", "void", "eclipse", "abyss", "dusk"];
  const LOOKS = Object.freeze([
    { id: "light", name: "Light", themes: Object.keys(THEMES).filter((key) => isLightTheme(key)), material: "studio", font: "studio" },
    { id: "dark", name: "Dark", themes: Object.keys(THEMES).filter((key) => !isLightTheme(key) && !STYLIZED_THEMES.includes(key)), material: "studio", font: "studio" },
    { id: "stylized", name: "Stylized", themes: STYLIZED_THEMES, material: "atmosphere", font: "display" },
  ].map((look) => Object.freeze({ ...look, themes: Object.freeze([...look.themes]) })));
  // A style pack as music.js keeps it: the Shop's pack data (#rrggbb colours,
  // keys from the tables above) with its id and name. Only these fields are
  // copied, so nothing else a caller hands over is painted or stored; a colour
  // or key that is not one of ours refuses the whole pack (null).
  const PACK_COLORS = ["accent", "background", "surface", "text", "accent2"];
  function safePack(value) {
    if (!value || typeof value !== "object" || !value.palette || typeof value.palette !== "object") return null;
    const palette = {};
    for (const key of PACK_COLORS) {
      if (key === "accent2" && value.palette.accent2 == null) continue;
      const color = hexColor(value.palette[key]);
      if (!color) return null;
      palette[key] = color.toLowerCase();
    }
    const id = typeof value.id === "string" && /^[\w:.-]{1,80}$/.test(value.id) ? value.id : null;
    const name = typeof value.name === "string" && value.name.trim() ? value.name.replace(/\s+/g, " ").trim().slice(0, 60) : "Style pack";
    const pack = { id, name, palette };
    // (a pack's node style is one of the free ones, as the relay's pack check allows)
    for (const [key, valid] of [["nodeStyle", (style) => isNodeStyle(style) && !isShopNodeStyle(style)], ["material", (material) => MATERIALS.includes(material)], ["font", isFont]]) {
      if (value[key] == null) continue;
      if (!valid(value[key])) return null;
      pack[key] = value[key];
    }
    return pack;
  }
  const AUDIO_EFFECTS = {
    waves: { title: "Connection waves", detail: "Let sound gently bend the connections.", enabled: true },
    splitBands: { title: "Separate frequency lines", detail: "Bass, mids and treble drive different connections.", enabled: true },
    nodes: { title: "Node glow", detail: "Light the nodes with the music.", enabled: true },
    motion: { title: "Tree motion", detail: "Let the beat turn, sway and swell the spinning tree. It stays in frame.", enabled: true },
    percussion: { title: "Drum accents", detail: "Add sharper ripples on drum hits.", enabled: false },
    background: { title: "Background glow", detail: "Let the space behind the tree pulse.", enabled: false },
  };
  // The mini player's quick tree switches: the audio link itself, the audio
  // reactions above, and the two node effects. [key, label, what it does, icon].
  const QUICK_TOGGLES = [
    ["react", "React", "The node tree listens to what is playing", "react"],
    ["waves", "Waves", AUDIO_EFFECTS.waves.detail, "waves"],
    ["nodes", "Glow", AUDIO_EFFECTS.nodes.detail, "glow"],
    ["motion", "Motion", AUDIO_EFFECTS.motion.detail, "motion"],
    ["percussion", "Drums", AUDIO_EFFECTS.percussion.detail, "drums"],
    ["background", "Aura", AUDIO_EFFECTS.background.detail, "aura"],
    ["orbitTrails", "Trails", "Blue orbit trails circle queued and running work.", "trails"],
    ["extraGlow", "Halos", "Brighter halos and luminous cores.", "halos"],
  ];
  // Player glyphs, 24px, drawn in currentColor. Static markup only.
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    play: '<path d="M8.2 5.6v12.8c0 .8.9 1.3 1.6.9l9.8-6.4c.6-.4.6-1.3 0-1.7L9.8 4.7c-.7-.4-1.6.1-1.6.9z" fill="currentColor"/>',
    pause: '<rect x="6.3" y="5" width="4.2" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4.2" height="14" rx="1.3" fill="currentColor"/>',
    previous: '<rect x="5" y="5.5" width="2.4" height="13" rx="1.1" fill="currentColor"/><path d="M18.6 6.5v11c0 .8-.9 1.3-1.6.8l-8.1-5.5c-.6-.4-.6-1.2 0-1.6L17 5.7c.7-.5 1.6 0 1.6.8z" fill="currentColor"/>',
    next: '<rect x="16.6" y="5.5" width="2.4" height="13" rx="1.1" fill="currentColor"/><path d="M5.4 6.5v11c0 .8.9 1.3 1.6.8l8.1-5.5c.6-.4.6-1.2 0-1.6L7 5.7c-.7-.5-1.6 0-1.6.8z" fill="currentColor"/>',
    volume: `<path d="M4.6 9.4h2.9l4.1-3.5c.6-.5 1.4-.1 1.4.6v11c0 .7-.8 1.1-1.4.6l-4.1-3.5H4.6c-.6 0-1.1-.5-1.1-1.1V10.5c0-.6.5-1.1 1.1-1.1z" fill="currentColor"/><path d="M16 9.1a4.1 4.1 0 0 1 0 5.8M18.6 6.5a7.7 7.7 0 0 1 0 11" ${STROKE}/>`,
    muted: `<path d="M4.6 9.4h2.9l4.1-3.5c.6-.5 1.4-.1 1.4.6v11c0 .7-.8 1.1-1.4.6l-4.1-3.5H4.6c-.6 0-1.1-.5-1.1-1.1V10.5c0-.6.5-1.1 1.1-1.1z" fill="currentColor"/><path d="M16.3 9.7l4.6 4.6m0-4.6l-4.6 4.6" ${STROKE}/>`,
    expand: `<path d="M14 5h5v5M10 19H5v-5M19 5l-5.6 5.6M5 19l5.6-5.6" ${STROKE}/>`,
    collapse: `<path d="M18.5 10H14V5.5M5.5 14H10v4.5M14 10l5.5-5.5M10 14l-5.5 5.5" ${STROKE}/>`,
    close: `<path d="M7 7l10 10M17 7L7 17" ${STROKE}/>`,
    popout: `<path d="M13.5 4.5h6v6M19.5 4.5l-8 8" ${STROKE}/><path d="M17.5 13.5v4.2c0 1-.8 1.8-1.8 1.8H6.3c-1 0-1.8-.8-1.8-1.8V8.3c0-1 .8-1.8 1.8-1.8h4.2" ${STROKE}/>`,
    backdrop: `<rect x="3.5" y="5" width="17" height="14" rx="2.4" ${STROKE}/><path d="M6.8 16l3.6-4 2.7 2.8 1.9-1.9 2.4 3.1" ${STROKE}/><circle cx="15.8" cy="9" r="1.3" fill="currentColor"/>`,
    link: `<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1" ${STROKE}/>`,
    external: `<path d="M14 5h5v5M19 5l-7.5 7.5M17 14v3.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5v-9C5 7.7 5.7 7 6.5 7H10" ${STROKE}/>`,
    music: `<path d="M9 17.5V6.8c0-.5.3-.9.8-1l8-2c.6-.1 1.2.3 1.2 1V15" ${STROKE}/><circle cx="6.6" cy="17.6" r="2.4" ${STROKE}/><circle cx="16.6" cy="15.2" r="2.4" ${STROKE}/>`,
    radio: `<rect x="3.5" y="8.5" width="17" height="11" rx="2.4" ${STROKE}/><path d="M7 8.5l9-4" ${STROKE}/><circle cx="15.5" cy="14" r="2.3" ${STROKE}/><path d="M6.8 12.2h3.4M6.8 15.8h3.4" ${STROKE}/>`,
    video: `<rect x="3.5" y="5.5" width="17" height="13" rx="2.6" ${STROKE}/><path d="M10.4 9.4v5.2c0 .4.4.6.7.4l4-2.6c.3-.2.3-.6 0-.8l-4-2.6c-.3-.2-.7 0-.7.4z" fill="currentColor"/>`,
    queue: `<path d="M4.5 7h11M4.5 12h11M4.5 17h7" ${STROKE}/><path d="M17.5 14.5v5l3.5-2.5z" fill="currentColor"/>`,
    find: `<circle cx="10.5" cy="10.5" r="5.5" ${STROKE}/><path d="M14.6 14.6l4.9 4.9" ${STROKE}/>`,
    picture: `<rect x="3.5" y="5" width="17" height="14" rx="2.4" ${STROKE}/><circle cx="12" cy="12" r="3.2" ${STROKE}/><path d="M12 5v2M12 17v2M3.5 12h2M18.5 12h2" ${STROKE}/>`,
    tree: `<circle cx="12" cy="5.5" r="2.2" ${STROKE}/><circle cx="6" cy="17.5" r="2.2" ${STROKE}/><circle cx="18" cy="17.5" r="2.2" ${STROKE}/><path d="M11 7.4l-4 8.2M13 7.4l4 8.2M8.2 17.5h7.6" ${STROKE}/>`,
    more: `<path d="M4.5 7h9M17.5 7h2M4.5 12h3M11.5 12h8M4.5 17h11M19.5 17h0" ${STROKE}/><circle cx="15.5" cy="7" r="2" ${STROKE}/><circle cx="9.5" cy="12" r="2" ${STROKE}/><circle cx="17.5" cy="17" r="2" ${STROKE}/>`,
    tracks: `<path d="M9 17.5V6.8c0-.5.3-.9.8-1l8-2c.6-.1 1.2.3 1.2 1V15" ${STROKE}/><circle cx="6.6" cy="17.6" r="2.4" ${STROKE}/><circle cx="16.6" cy="15.2" r="2.4" ${STROKE}/>`,
    stations: `<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" ${STROKE}/>`,
    react: `<path d="M4 12h2.5l2-5 3 10 3-13 2.5 8H20" ${STROKE}/>`,
    waves: `<path d="M3.5 12c2.1-4 4.2-4 6.3 0s4.2 4 6.3 0 2.8-2.6 4.4-1" ${STROKE}/><path d="M3.5 17c2.1-2 4.2-2 6.3 0s4.2 2 6.3 0" ${STROKE} opacity=".5"/>`,
    glow: `<circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" ${STROKE}/>`,
    motion: `<path d="M19 12a7 7 0 1 1-2.1-5" ${STROKE}/><path d="M17.6 3.8l-.6 3.3-3.3-.5" ${STROKE}/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>`,
    drums: `<ellipse cx="12" cy="9" rx="7.5" ry="3" ${STROKE}/><path d="M4.5 9v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V9" ${STROKE}/><path d="M9 3.5l3 5.5M15 3.5l-3 5.5" ${STROKE}/>`,
    aura: `<circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="5.6" ${STROKE} opacity=".7"/><circle cx="12" cy="12" r="8.6" ${STROKE} opacity=".35"/>`,
    trails: `<ellipse cx="12" cy="12" rx="8.5" ry="4.2" transform="rotate(-24 12 12)" ${STROKE}/><circle cx="18.4" cy="7.9" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
    halos: `<path d="M12 3.8l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z" fill="currentColor"/><circle cx="18.2" cy="18" r="1.3" fill="currentColor"/><circle cx="5.8" cy="17.2" r=".9" fill="currentColor"/>`,
    playlists: `<rect x="3.5" y="4.5" width="13" height="9.5" rx="2" ${STROKE}/><path d="M6.5 17h11.5c.8 0 1.5-.7 1.5-1.5V8M9.5 20h10.5c.8 0 1.5-.7 1.5-1.5V11" ${STROKE} opacity=".6"/><path d="M8.7 7.3v4c0 .3.3.5.6.3l3.1-2c.3-.2.3-.5 0-.7l-3.1-2c-.3-.1-.6 0-.6.4z" fill="currentColor"/>`,
    save: `<path d="M4.5 7h10M4.5 12h10M4.5 17h6" ${STROKE}/><path d="M18 13.5v7M14.5 17h7" ${STROKE}/>`,
    shuffle: `<path d="M4 7.5h3.2c1.4 0 2.6.7 3.4 1.8l2.8 5.4c.8 1.1 2 1.8 3.4 1.8H20M4 16.5h3.2c1 0 1.9-.4 2.6-1M13.2 8.5c.7-.6 1.6-1 2.6-1H20" ${STROKE}/><path d="M17.5 5l2.5 2.5-2.5 2.5M17.5 14l2.5 2.5-2.5 2.5" ${STROKE}/>`,
    share: `<circle cx="17.5" cy="6" r="2.4" ${STROKE}/><circle cx="6.5" cy="12" r="2.4" ${STROKE}/><circle cx="17.5" cy="18" r="2.4" ${STROKE}/><path d="M8.6 10.8l6.8-3.6M8.6 13.2l6.8 3.6" ${STROKE}/>`,
    back: `<path d="M14.5 6l-6 6 6 6" ${STROKE}/>`,
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
  // `target` is the end an ink moves toward: by default whichever of white
  // and black reads better on `background`.
  function readableColor(color, background, minimum = 4.5, target = contrast("#FFFFFF", background) >= contrast("#000000", background) ? "#FFFFFF" : "#000000") {
    if (contrast(color, background) >= minimum) return color;
    for (let step = 1; step <= 40; step += 1) { const candidate = mixColor(color, target, step / 40); if (contrast(candidate, background) >= minimum) return candidate; }
    return target;
  }
  // "custom" paints the saved custom colours and "pack" a style pack's palette
  // (`pack`, as safePack keeps it); both take the same steps from here on.
  function resolvePalette(theme, customColors, pack = null) {
    const custom = safeCustomColors(customColors);
    const chosen = theme === "custom" ? { accent: custom.accent, bg: custom.background, panel: custom.surface, text: custom.text }
      : theme === "pack" && pack?.palette ? { accent: pack.palette.accent, accent2: pack.palette.accent2, bg: pack.palette.background, panel: pack.palette.surface, text: pack.palette.text } : null;
    // Chosen colours get their stronger accent ink from the panel's tone:
    // brighter on a dark panel, deeper on a light one.
    const base = chosen ? { ...chosen, bright: mixColor(chosen.accent, luminance(chosen.panel) > .35 ? "#000000" : "#FFFFFF", .3) } : THEMES[theme] || THEMES[DEFAULT_THEME];
    // Leave contrast headroom for the translucent panels and their subtle sheen.
    let text = readableColor(base.text || "#ece5d8", base.panel, 5.5);
    let bright = readableColor(base.bright, base.panel, 4.5);
    let muted = readableColor(base.muted || mixColor(text, base.panel, .32), base.panel, 5.5);
    let dim = readableColor(mixColor(text, base.panel, .5), base.panel, 4.5);
    const border = readableColor(mixColor(base.accent, base.panel, .6), base.panel, 3);
    const canvasText = readableColor(base.text || "#ece5d8", base.bg);
    // Custom background and surface colours may have opposite tones. Reading
    // areas use the safe base; the canvas keeps the exact chosen background.
    const readingBackground = [text, muted, bright].every((ink) => contrast(ink, base.bg) >= 4.5) ? base.bg : base.panel;
    // Where the page is a reading surface too, each ink keeps its minimum
    // there as well, moving the way it moved for the panel: a light page sits
    // a shade darker than its panels, so an ink just readable on a panel could
    // fall short on it. A light page also takes the panels' tinted glass and
    // its own colour washes, which darken it a little more, so there every ink
    // keeps .8 of headroom on the page and the panels alike. A dark page is
    // darker than its panels and those layers only lift contrast: nothing moves.
    if (readingBackground === base.bg) {
      const toward = contrast("#FFFFFF", base.panel) >= contrast("#000000", base.panel) ? "#FFFFFF" : "#000000";
      const headroom = luminance(base.bg) > .35 ? .8 : 0;
      [text, bright, muted, dim] = [[text, 5.5], [bright, 4.5], [muted, 5.5], [dim, 4.5]].map(([ink, minimum]) => readableColor(readableColor(ink, base.panel, minimum + headroom, toward), base.bg, minimum + headroom, toward));
    }
    // The ink on the accent's fills (primaries, badges, the chosen segment).
    // Many of them run from the accent to bright, so it is whichever of white
    // and black reads better on both: on a light panel a chosen accent's bright
    // is deeper than the accent, and black on it would fail.
    const inkOn = (ink) => Math.min(contrast(ink, base.accent), contrast(ink, bright));
    const onAccent = inkOn("#FFFFFF") > inkOn("#000000") ? "#FFFFFF" : "#000000";
    const awayFromInk = onAccent === "#FFFFFF" ? "#000000" : "#FFFFFF";
    const actionEnd = mixColor(base.accent, awayFromInk, .18);
    // The second hue as a fill under that ink: the two-tone primaries end on it.
    const accent2Fill = readableColor(base.accent2 || bright, onAccent, 4.5, awayFromInk);
    return { accent: base.accent, bright, accent2: base.accent2 || bright, accent2Fill, background: base.bg, readingBackground, actionEnd, surface: base.panel, text, muted, dim, border,
      rgb: channels(base.accent).join(","), surfaceRgb: channels(base.panel).join(","),
      onAccent,
      canvas: { background: base.bg, accent: base.accent, bright: readableColor(base.bright, base.bg, 3), accent2: base.accent2 || readableColor(base.bright, base.bg, 3), text: canvasText, muted: readableColor(mixColor(canvasText, base.bg, .32), base.bg), dim: readableColor(mixColor(canvasText, base.bg, .5), base.bg, 3) } };
  }

  const SPOTIFY_TYPES = { track: "track", album: "album", playlist: "playlist", episode: "episode", show: "podcast", artist: "artist" };
  function spotifyLink(raw) {
    const value = String(raw ?? "").trim();
    let match = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{22})$/.exec(value);
    if (!match) {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || !["open.spotify.com", "spotify.com", "www.spotify.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
        match = /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
      } catch { return null; }
    }
    if (!match) return null;
    const [, type, id] = match;
    return { type, id, url: `https://open.spotify.com/${type}/${id}`, embed: `https://open.spotify.com/embed/${type}/${id}`,
      provider: "spotify", providerName: "Spotify", kind: "embed", label: `Spotify ${SPOTIFY_TYPES[type]}`, short: `${SPOTIFY_TYPES[type]} · ${id.slice(0, 7)}…`,
      shape: type === "track" || type === "episode" ? "compact" : "tall", autoplay: "" };
  }
  // "90", "90s", "1m30s" or "1h2m3s" as whole seconds; anything else is 0.
  function startSeconds(value) {
    const match = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/.exec(String(value ?? ""));
    if (!match || !value) return 0;
    const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    return Number.isFinite(seconds) && seconds > 0 && seconds < 86400 ? seconds : 0;
  }
  const MEDIA_FILE = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba|mp4|m4v|webm|mov|ogv)$/i;
  const VIDEO_FILE = /\.(mp4|m4v|webm|mov|ogv)$/i;
  const DISCORD_CDN = ["cdn.discordapp.com", "media.discordapp.net"];
  // Any pasted link, as what Studio can do with it: "embed" (an official
  // player in an iframe), "media" (a plain file in Studio's own <video>) or
  // "external" (a page for the mini browser). Embeds require https with no
  // credentials or port; their URLs are rebuilt from validated service ids.
  function mediaLink(raw) {
    let value = String(raw ?? "").trim();
    if (!value || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(value)) value = `https://${value}`;
    const spotify = spotifyLink(value);
    if (spotify) return spotify;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
    const path = url.pathname;
    const external = (provider, providerName, label, extra = {}) => ({ provider, providerName, kind: "external", url: url.href, label, short: label, ...extra });
    if (url.protocol !== "https:" || url.port) return external("web", host, host);
    if (["youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"].includes(host)) {
      let id = null;
      if (host === "youtu.be") id = path.slice(1).replace(/\/$/, "");
      else if (path === "/watch") id = url.searchParams.get("v");
      else id = /^\/(?:shorts|live|embed|v)\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
      const list = /^[A-Za-z0-9_-]{10,64}$/.test(url.searchParams.get("list") || "") ? url.searchParams.get("list") : null;
      if (id === "videoseries") id = null;
      if (id != null && !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      if (!id && !list) return external("youtube", "YouTube", "YouTube page");
      const music = host === "music.youtube.com";
      const name = music ? "YouTube Music" : "YouTube";
      if (!id) return { provider: "youtube", providerName: name, kind: "embed", shape: "video", autoplay: "&autoplay=1", label: `${name} playlist`, short: `playlist · ${list.slice(0, 7)}…`,
        url: `https://www.youtube.com/playlist?list=${list}`, embed: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&rel=0&playsinline=1&enablejsapi=1` };
      const start = startSeconds(url.searchParams.get("t") || url.searchParams.get("start"));
      return { provider: "youtube", providerName: name, kind: "embed", shape: "video", autoplay: "&autoplay=1", label: music ? "YouTube Music track" : list ? "YouTube playlist" : "YouTube video", short: `${list ? "playlist" : "video"} · ${id.slice(0, 7)}…`,
        url: `https://www.youtube.com/watch?v=${id}${list ? `&list=${list}` : ""}${start ? `&t=${start}s` : ""}`,
        embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1${list ? `&list=${list}` : ""}${start ? `&start=${start}` : ""}` };
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const match = /^\/(?:video\/|channels\/[\w-]{1,64}\/|groups\/[\w-]{1,64}\/videos\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?\/?$/.exec(path);
      if (!match) return external("vimeo", "Vimeo", "Vimeo page");
      const hash = match[2] || (/^[0-9a-f]{6,20}$/.test(url.searchParams.get("h") || "") ? url.searchParams.get("h") : null);
      return { provider: "vimeo", providerName: "Vimeo", kind: "embed", shape: "video", autoplay: "&autoplay=1", label: "Vimeo video", short: `video · ${match[1]}`,
        url: `https://vimeo.com/${match[1]}${hash ? `/${hash}` : ""}`, embed: `https://player.vimeo.com/video/${match[1]}?dnt=1${hash ? `&h=${hash}` : ""}` };
    }
    if (host === "soundcloud.com") {
      const match = /^\/([\w-]{1,64})\/(sets\/)?([\w-]{1,128})(\/s-[A-Za-z0-9]{4,32})?\/?$/.exec(path);
      if (!match || (!match[2] && ["sets", "tracks", "albums", "reposts", "likes", "followers", "following", "popular-tracks"].includes(match[3]))) return external("soundcloud", "SoundCloud", "SoundCloud page");
      const canonical = `https://soundcloud.com/${match[1]}/${match[2] || ""}${match[3]}${match[4] || ""}`;
      return { provider: "soundcloud", providerName: "SoundCloud", kind: "embed", shape: "tall", autoplay: "&auto_play=true", label: match[2] ? "SoundCloud playlist" : "SoundCloud track", short: `${match[2] ? "playlist" : "track"} · ${match[3].slice(0, 12)}`,
        url: canonical, embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}&visual=true&show_comments=false` };
    }
    if (MEDIA_FILE.test(path)) {
      let name = path.split("/").pop() || "media";
      try { name = decodeURIComponent(name); } catch {}
      name = name.slice(0, 80);
      const discord = DISCORD_CDN.includes(host);
      const video = VIDEO_FILE.test(path);
      // A Discord attachment link is signed; its query is the signature, so it
      // is kept whole.
      return { provider: discord ? "discord" : "file", providerName: discord ? "Discord" : "Web", host, kind: "media", media: video ? "video" : "audio", shape: video ? "video" : "audio",
        label: `${discord ? "Discord attachment" : video ? "Video file" : "Audio file"} · ${name}`, short: `${discord ? "attachment" : video ? "video" : "audio"} · ${name.slice(0, 24)}`, url: url.href.replace(/#.*$/, "") };
    }
    if (host === "open.spotify.com" && /^\/(?:intl-[a-z]{2}\/)?socialsession\/[A-Za-z0-9_-]{6,128}\/?$/.test(path)) return external("spotify", "Spotify", "Spotify Jam", { jam: true });
    if (host === "spotify.link" || host === "spotify.app.link") return external("spotify", "Spotify", "Spotify share link");
    if (host === "open.spotify.com" || host === "spotify.com") return external("spotify", "Spotify", "Spotify page");
    if (host === "twitch.tv" || host === "clips.twitch.tv") return external("twitch", "Twitch", "Twitch stream");
    if (host === "on.soundcloud.com") return external("soundcloud", "SoundCloud", "SoundCloud share link");
    return external("web", host, host);
  }
  const playableLink = (link) => link && (link.kind === "embed" || link.kind === "media") ? link : null;

  function safePreferences(value) {
    const raw = value && typeof value === "object" ? value : {};
    const volume = Number(raw.volume);
    // Links that can play again, newest first; `spotify` is the list's name
    // from before the Links tab, read once and never written again.
    const links = [...new Set([...(Array.isArray(raw.links) ? raw.links : []), ...(Array.isArray(raw.spotify) ? raw.spotify : [])]
      .map((item) => playableLink(mediaLink(item))?.url).filter(Boolean))].slice(0, 8);
    // A style pack is kept only while it is the theme on screen.
    const pack = raw.theme === "pack" ? safePack(raw.pack) : null;
    return { theme: pack ? "pack" : isTheme(raw.theme) ? raw.theme : DEFAULT_THEME, pack, font: isFont(raw.font) ? raw.font : "studio",
      customColors: safeCustomColors(raw.customColors), volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .7, links,
      nodeStyle: isNodeStyle(raw.nodeStyle) ? raw.nodeStyle : "orbs",
      nodeLayout: Object.hasOwn(NODE_LAYOUTS, raw.nodeLayout) ? raw.nodeLayout : "constellation",
      station: STATION_IDS.has(raw.station) ? raw.station : null,
      // The source tab, and whether a station was sounding when Studio closed.
      source: raw.source === "radio" ? "radio" : raw.source === "link" || raw.source === "spotify" ? "link" : "local", radioOn: raw.radioOn === true,
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
  const MEDIA_UI_KEY = "mefiStudio.mediaMenu.v1";
  // section: the part of the unfolded menu last opened (Up next, Add, …).
  // playlists: the Playlists section and its Save buttons (renderer/playlists.js).
  let mediaMenu = { showLinks: true, copiedLinks: true, playlists: true, section: null };
  try {
    const savedMenu = JSON.parse(localStorage.getItem(MEDIA_UI_KEY) || "null");
    mediaMenu = { showLinks: savedMenu?.showLinks !== false, copiedLinks: savedMenu?.copiedLinks !== false, playlists: savedMenu?.playlists !== false, section: typeof savedMenu?.section === "string" ? savedMenu.section.slice(0, 20) : null };
  } catch {}
  let clipboardOffer = null, lastClipboardUrl = null, clipboardTimer = 0, clipboardBusy = false, clipboardGeneration = 0;
  let linkQueue = [];
  try {
    const savedQueue = JSON.parse(localStorage.getItem(LINK_QUEUE_KEY) || "[]");
    if (Array.isArray(savedQueue)) linkQueue = savedQueue.slice(0, LINK_QUEUE_LIMIT).flatMap(item => {
      const link = mediaLink(item?.url);
      return playableLink(link) ? [{ url: link.url, title: typeof item.title === "string" ? item.title.slice(0, 160) : link.label }] : [];
    });
  } catch {}
  let mediaVolume = prefs.volume, mediaMuted = false, mediaVolumeApplied = false;
  try {
    const savedVolume = JSON.parse(localStorage.getItem("mefiStudio.mediaVolume.v1") || "null");
    if (Number.isFinite(savedVolume?.volume)) mediaVolume = Math.max(0, Math.min(1, savedVolume.volume));
    mediaMuted = savedVolume?.muted === true;
  } catch {}
  // While the Void collection was for Discord members, a Void theme or node
  // style was saved apart, in LEGACY_VOID_KEY. A valid choice there moves into
  // the ordinary preferences once, and the old store goes after that write.
  const LEGACY_VOID_KEY = "mefiStudio.music.premium.v1";
  try {
    const legacy = localStorage.getItem(LEGACY_VOID_KEY);
    if (legacy != null) {
      let saved = null;
      try { saved = JSON.parse(legacy); } catch {}
      const theme = isVoidTheme(saved?.theme) ? saved.theme : null;
      const nodeStyle = isVoidNodeStyle(saved?.nodeStyle) ? saved.nodeStyle : null;
      if (theme) prefs.theme = theme;
      if (nodeStyle) prefs.nodeStyle = nodeStyle;
      if (theme || nodeStyle) localStorage.setItem(STORAGE_KEY, JSON.stringify(safePreferences(prefs)));
      localStorage.removeItem(LEGACY_VOID_KEY);
    }
  } catch {}
  // The node style the tree wears: the chosen one, or Classic orbs while it
  // is a Shop style this PC does not own (or does not know it owns yet:
  // friends-shop.js loads after this file, so init() asks again). The choice
  // itself stays saved, so a style bought on another PC comes back once the
  // Shop has read what you own (mefi-shop-owned). Worked out when the choice
  // or what you own changes, never per frame: the tree reads it every frame.
  const wearable = (key) => isNodeStyle(key) && (!isShopNodeStyle(key) || window.MefiShop?.owns?.(NODE_STYLES[key].shop) === true);
  let worn = "orbs";
  const wear = () => { worn = wearable(prefs.nodeStyle) ? prefs.nodeStyle : "orbs"; return worn; };
  wear();
  // Search may expose configuration without changing the active look or audio.
  const settingsReveal = { custom: false, source: null };
  // link: what the Links tab plays; handoff: the last link only its own app can
  // open; linkPlaying is real only for a plain file in Studio's own element.
  const state = { source: "local", tracks: [], selected: -1, link: null, handoff: null, linkPlaying: false, linkAutoplay: false, linkStartMs: 0, opened: false, sending: false, notice: "", error: false,
    station: null, mirror: 0, deck: "a", radioPhase: "idle", radioNote: "" };
  const els = {};
  let audio = null;
  let initialized = false;
  let recommender = null;
  let priorFocus = null;
  let previewFrame = 0;
  let dropdownFrame = 0;
  let dropdownAnchor = null;
  let dropdownFocus = null;
  let dropdownHover = false;
  let watchHost = null;
  let dropdownOpenTimer = 0;
  let dropdownCloseTimer = 0;
  let restoreWorkspace = false;
  let deckB = null;
  let pendingDeck = null;
  let fadeOut = null;
  let fadeTimer = 0;
  let stallTimer = 0;
  let tuneGeneration = 0;
  // Local and radio share one master level (prefs.volume); Mute holds the
  // decks at zero for this session without saving a silent level.
  let soundMuted = false;
  const level = () => soundMuted ? 0 : prefs.volume;
  // Links played before the current one this session, newest last (Back).
  const linkHistory = [];
  // The mini player unfolds into one section at a time (see DECK_SECTIONS).
  let deckOpen = false, deckSection = null, nowFrame = 0, typeScoped = false;
  // What Studio last asked an embed for, and when: a report that disagrees
  // right after it is the player echoing an older level or position.
  let volumeSentAt = -Infinity, seekSentAt = -Infinity, seekSent = 0;
  // renderer/playlists.js, once it has registered (MefiMusic.playlists): it
  // fills the Playlists section and answers the Save buttons. More › This
  // menu turns all of it off (mediaMenu.playlists).
  let playlistsHook = null;
  const playlistsOn = () => Boolean(playlistsHook) && mediaMenu.playlists !== false;

  const persist = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safePreferences(prefs))); } catch {} };
  const event = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  function status() {
    const track = state.tracks[state.selected];
    const tuned = station(state.station);
    const title = state.source === "link" ? els.browser?.active ? els.browser.state.title || "Media browser" : state.link ? linkPlayback?.title || state.link.label : "Paste a link"
      : state.source === "radio" ? tuned ? tuned.name : "Choose a station"
      : track?.title || "Choose your music";
    const deck = activeDeck();
    // A file plays in Studio's own element; an embed counts as playing only
    // once its player has said so (YouTube and Vimeo report it).
    const playing = state.source === "radio" ? (state.radioPhase === "playing" || state.radioPhase === "buffering") && Boolean(deck?.src) && !deck.paused
      : state.source === "link" ? Boolean(state.link?.kind === "media" ? state.linkPlaying : linkPlayback?.observed && linkPlayback.playing)
      : state.source === "local" && Boolean(audio?.src) && !audio.paused && !audio.ended;
    // Links never reach the analyser: an embed is another origin and a pasted
    // file is not CORS-cleared, so the audio link listens to the desktop.
    return { source: state.source, playing, title, track: title, theme: prefs.theme, ...graphPreferences(),
      queueLength: state.tracks.length, externalPlayback: state.source === "link", supported: true,
      provider: state.source === "link" ? state.link?.providerName ?? null : null, link: state.source === "link" ? state.link?.url ?? null : null,
      station: state.station, stationName: tuned?.name || null, radioPhase: state.source === "radio" ? state.radioPhase : "idle" };
  }
  const announce = () => event("mefi-music-change", status());
  let noteTimer = 0;
  function note(text, error = false) {
    state.notice = String(text || ""); state.error = error;
    if (els.notice) { els.notice.textContent = state.notice; els.notice.dataset.error = String(error); }
    // A passing word fades after a while; a problem stays until the next word.
    window.clearTimeout(noteTimer); noteTimer = 0;
    if (state.notice && !error) noteTimer = window.setTimeout(() => { noteTimer = 0; note(""); }, 7000);
  }
  function themeTokens(palette) {
    return { "--gold": palette.accent, "--gold-bright": palette.bright, "--gold-dim": `rgba(${palette.rgb},.32)`, "--hairline": `rgba(${channels(palette.border).join(",")},.5)`, "--hairline-strong": palette.border, "--tint-gold-1": `rgba(${palette.rgb},.06)`, "--tint-gold-2": `rgba(${palette.rgb},.09)`, "--tint-gold-3": `rgba(${palette.rgb},.14)`, "--ring": `0 0 0 3px rgba(${palette.rgb},.15)`, "--glow-gold": `0 0 14px rgba(${palette.rgb},.3)`, "--bg": palette.background, "--bg-deep": palette.background, "--cmd-bg": palette.background, "--panel-solid": palette.surface, "--panel": `rgba(${palette.surfaceRgb},.85)`, "--glass": `rgba(${palette.surfaceRgb},.76)`, "--glass-hard": `rgba(${palette.surfaceRgb},.94)`, "--glass-soft": `rgba(${palette.surfaceRgb},.7)`, "--ivory": palette.text, "--muted": palette.muted, "--dim": palette.dim, "--ink": palette.onAccent };
  }
  // tier "duo": a theme with a second hue of its own (the Void collection, a
  // pack with an accent2), which the stylesheets paint with (--accent-2) and
  // music.css and styles.css answer under [data-studio-theme-tier="duo"];
  // every other theme is "solo".
  const themeDetail = (key, pack = prefs.pack) => {
    const palette = resolvePalette(key, prefs.customColors, pack);
    const second = key === "pack" ? pack?.palette?.accent2 : THEMES[key]?.accent2;
    return { theme: key, tier: second ? "duo" : "solo", ...palette, tokens: themeTokens(palette) };
  };
  // Paints a theme; applyTheme decides whether it is saved. "pack" paints
  // `pack`: the applied one, or the one the Shop is trying.
  function paintTheme(key, pack = prefs.pack) {
    const detail = themeDetail(key, pack);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(detail.tokens)) root.style.setProperty(name, value);
    for (const [name, value] of Object.entries(detail.canvas)) root.style.setProperty(`--canvas-${name}`, value);
    root.style.setProperty("--studio-accent-rgb", detail.rgb);
    root.style.setProperty("--accent-2", detail.accent2);
    root.style.setProperty("--accent-2-rgb", channels(detail.accent2).join(","));
    root.style.setProperty("--accent-2-fill", detail.accent2Fill);
    root.style.setProperty("--studio-reading-bg", detail.readingBackground);
    root.style.setProperty("--studio-action-end", detail.actionEnd);
    root.dataset.studioTheme = key;
    root.dataset.studioThemeTier = detail.tier;
    // Shared glass surfaces adapt their edge and shadow to a light palette.
    root.dataset.studioThemeTone = luminance(detail.readingBackground) > 0.35 ? "light" : "dark";
    for (const button of [...els.themes?.children || [], ...els.lightThemes?.children || [], ...els.voidThemes?.children || []]) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === key));
      if (button.dataset.theme === "custom") button.style.setProperty("--swatch", prefs.customColors.accent);
    }
    if (els.customPalette) els.customPalette.hidden = key !== "custom" && !settingsReveal.custom;
    for (const [name, pair] of Object.entries(els.customInputs || {})) {
      pair.picker.value = prefs.customColors[name]; pair.hex.value = prefs.customColors[name]; pair.hex.setAttribute("aria-invalid", "false");
    }
    return detail;
  }
  // Every theme applies and saves the same way, Void collection included;
  // "pack" repaints the applied style pack (applyPack chooses one). Choosing
  // for real ends a pack the Shop is trying.
  function applyTheme(theme, save = true) {
    endPreview(false);
    settingsReveal.custom = false;
    const key = theme === "pack" ? prefs.pack ? "pack" : DEFAULT_THEME : isTheme(theme) ? theme : DEFAULT_THEME;
    prefs.theme = key;
    if (key !== "pack") prefs.pack = null;
    const detail = paintTheme(key);
    if (save) persist();
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
  // ---- Looks and style packs ---------------------------------------------------
  // What the first run's "choose your look" and the Shop call (owner checks
  // stay with the Shop: it decides what may be applied, this paints it; the
  // one exception is a Shop node style, which goes on only once MefiShop
  // says it is owned, see "Node styles from the Shop" below):
  //
  //   looks() -> [{ id, name, themes, material, font }]: Light, Dark and
  //     Stylized, each with its theme keys (its default first) and the extras
  //     it brings: a material (a MefiAppearance preset) and a heading face (a
  //     FONTS key).
  //   applyLook(lookId, themeKey, save = true) -> the theme key it applied (a
  //     key the look does not list is its first), or null for no such look.
  //     The look's material and face go on with it, so Light and Dark put the
  //     plain ones back. Everything is kept: the theme and face here, the
  //     material in MefiAppearance's own store.
  //   look() -> the id of the look the theme on screen belongs to, or null
  //     (Custom, a pack).
  //   fonts() -> [{ key, name, detail, stack }]; applyFont(key, save = true)
  //     -> the key it applied ("studio" for one it does not know); font() ->
  //     the face that is kept.
  //   applyPack({ id, name, palette, nodeStyle?, material?, font? }, save = true)
  //     -> true, or false (nothing changes) for a pack it cannot paint. The
  //     pack becomes the theme "pack", painted from its palette the way Custom
  //     is (plus accent2, which makes it two-tone), with its node style and
  //     material when it names them and its face ("studio" when it names
  //     none). It is kept in mefiStudio.music.v1 and comes back at boot.
  //   previewPack(pack) -> true or false; paints a pack, its node style, face
  //     and material for the Shop's Try without saving anything.
  //     endPreview() -> true when it ended one: everything a try changed goes
  //     back as it was. Choosing a theme, a face, a node style, a look or a
  //     pack for real ends a try first.
  //   packInfo() -> a copy of the applied pack, or null.
  const lookOf = (theme) => LOOKS.find((look) => look.themes.includes(theme))?.id ?? null;
  // What a material leaves on MefiAppearance, to tell whether it is still on.
  const materialOf = (value) => value ? `${value.preset}|${value.glass}|${value.glow}` : "";
  // The person's density (Size and density) stays as it is under any material.
  function applyMaterial(material, save = true) {
    const appearance = window.MefiAppearance;
    if (!MATERIALS.includes(material) || typeof appearance?.apply !== "function") return false;
    const density = appearance.get?.()?.density;
    appearance.apply(density ? { preset: material, density } : { preset: material }, save);
    return true;
  }
  function paintFont(key) {
    const root = document.documentElement;
    const chosen = isFont(key) ? key : "studio";
    root.dataset.studioFont = chosen;
    for (const [name, value] of [["--font-display", FONTS[chosen].stack], ["--studio-title-tracking", FONTS[chosen].tracking]]) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty?.(name);
    }
    for (const choice of els.fonts?.children || []) choice.setAttribute("aria-pressed", String(choice.dataset.font === chosen));
  }
  function applyFont(key, save = true) {
    endPreview();
    prefs.font = isFont(key) ? key : "studio";
    paintFont(prefs.font);
    if (save) persist();
    return prefs.font;
  }
  function applyLook(lookId, themeKey, save = true) {
    const look = LOOKS.find((one) => one.id === lookId);
    if (!look) return null;
    const theme = applyTheme(look.themes.includes(themeKey) ? themeKey : look.themes[0], save);
    applyMaterial(look.material, save);
    applyFont(look.font, save);
    return theme;
  }
  function applyPack(value, save = true) {
    const pack = safePack(value);
    if (!pack) return false;
    endPreview(false);
    prefs.pack = pack;
    applyTheme("pack", save);
    if (pack.nodeStyle) applyNodeStyle(pack.nodeStyle, save);
    if (pack.material) applyMaterial(pack.material, save);
    applyFont(pack.font || "studio", save);
    return true;
  }
  // What the Shop is trying, and what it changed beyond prefs (which a try
  // never touches): a pack (with the MefiAppearance store as it was, and the
  // material the try left on, if any), or a node style alone (pack null).
  // One try at a time: trying a pack ends a node style's try, and the other
  // way round.
  let trying = null;
  function previewPack(value) {
    const pack = safePack(value);
    if (!pack) return false;
    if (trying && !trying.pack) trying = null;
    const appearance = window.MefiAppearance;
    trying ||= { before: appearance?.get?.() ?? null, material: "" };
    trying.pack = pack;
    trying.nodeStyle = pack.nodeStyle || worn;
    event("mefi-theme-change", { ...paintTheme("pack", pack), preview: true });
    syncTreePreferences(false);
    paintFont(pack.font || "studio");
    if (pack.material && applyMaterial(pack.material, false)) trying.material = materialOf(appearance.get?.());
    else if (trying.material && trying.before) { appearance.apply(trying.before, false); trying.material = ""; }
    return true;
  }
  // paint false: the caller paints a theme of its own right after.
  function endPreview(paint = true) {
    if (!trying) return false;
    const { before, material, nodeStyle, pack } = trying;
    trying = null;
    if (paint && pack) event("mefi-theme-change", paintTheme(prefs.theme));
    if (nodeStyle !== worn) syncTreePreferences(false);
    if (pack) paintFont(prefs.font);
    // The material goes back only while the try's is still on: one chosen in
    // Settings meanwhile stays.
    const appearance = window.MefiAppearance;
    if (material && before && materialOf(appearance?.get?.()) === material) appearance.apply(before, false);
    return true;
  }
  const copyPack = (pack) => pack ? { ...pack, palette: { ...pack.palette } } : null;
  // The palette on screen, read every frame by the tree rail and the Command
  // view. resolvePalette runs dozens of contrast searches (about 70 µs), so
  // the answer is kept until the theme or a custom colour changes, and every
  // reader shares one frozen copy. A pack the Shop is trying is on screen too.
  let paletteKey = null, paletteMemo = null;
  function themePalette() {
    const theme = trying?.pack ? "pack" : prefs.theme;
    const pack = trying?.pack ? trying.pack : prefs.pack;
    const custom = prefs.customColors;
    const key = theme === "custom" ? `custom|${custom.accent}|${custom.background}|${custom.surface}|${custom.text}` : theme === "pack" ? `pack|${PACK_COLORS.map((name) => pack?.palette?.[name] ?? "").join("|")}` : theme;
    if (key !== paletteKey || !paletteMemo) {
      const palette = resolvePalette(theme, custom, pack);
      paletteMemo = Object.freeze({ theme, ...palette, canvas: Object.freeze(palette.canvas) });
      paletteKey = key;
    }
    return paletteMemo;
  }
  // Read per node per frame by the tree rail: plain fields, no storage reads.
  function graphPreferences() { return { nodeStyle: trying ? trying.nodeStyle : worn, nodeLayout: prefs.nodeLayout, orbitTrails: prefs.orbitTrails, extraGlow: prefs.extraGlow }; }
  function syncTreePreferences(save) {
    const value = graphPreferences();
    Object.assign(document.documentElement.dataset, value);
    for (const choice of [...els.nodeStyles?.children || [], ...els.voidStyles?.children || [], ...els.shopStyles?.children || []]) choice.setAttribute("aria-pressed", String(choice.dataset.nodeStyle === value.nodeStyle));
    for (const choice of els.nodeLayouts?.children || []) choice.setAttribute("aria-pressed", String(choice.dataset.nodeLayout === value.nodeLayout));
    if (els.orbitTrails) els.orbitTrails.checked = value.orbitTrails;
    if (els.extraGlow) els.extraGlow.checked = value.extraGlow;
    renderQuick();
    if (save) persist();
    event("mefi-tree-preferences", value);
  }
  // ---- Node styles from the Shop ----
  //   applyNodeStyle(key, save = true) -> the style the tree wears after it.
  //     A Shop style this PC does not own is refused: nothing changes (a try
  //     on screen included) and the answer is the style still worn.
  //   previewNodeStyle(key) -> true or false; shows any known style on the
  //     tree for the Shop's Try, saving nothing, until endPreview() (the same
  //     one packs use) or a real choice ends it. One try at a time.
  //   nodeStyle() -> the style worn (a try aside); nodeStyles() -> the styles
  //     this PC can wear, each with its Shop item or null; shopStyles() -> the
  //     Shop's, owned or not ({ key, item, name, detail, owned }).
  function applyNodeStyle(style, save = true) {
    if (isShopNodeStyle(style) && !wearable(style)) return worn;
    endPreview();
    prefs.nodeStyle = isNodeStyle(style) ? style : "orbs";
    wear();
    syncTreePreferences(save);
    return worn;
  }
  function previewNodeStyle(style) {
    if (!isNodeStyle(style)) return false;
    if (trying?.pack) endPreview();
    trying = { before: null, material: "", pack: null, nodeStyle: style };
    syncTreePreferences(false);
    return true;
  }
  // What you own changed (friends-shop.js fires mefi-shop-owned): a Shop
  // style just bought or restored on this PC goes on if it was the choice,
  // one no longer owned gives way to Classic orbs, and the pickers follow.
  function ownedChanged() {
    const was = worn;
    wear();
    paintShopStyles();
    if (worn !== was && !trying) syncTreePreferences(false);
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
  // A 24px player glyph (ICONS: static markup only), hidden from readers.
  function glyph(name, parent) {
    const node = element("span", "music-glyph", null, parent);
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${ICONS[name] || ""}</svg>`;
    return node;
  }
  function iconButton(name, label, parent, action, id) {
    const node = button(null, "ghost music-icon", parent, action, id);
    glyph(name, node);
    node.setAttribute("aria-label", label); node.title = label;
    return node;
  }
  // The Shop's styles in Settings: one this PC owns is an ordinary choice; one
  // it does not own says so and stays off (the Shop's Try shows it on the
  // tree for two minutes), and the line under them offers the Shop while any
  // is still there to get.
  function paintShopStyles() {
    let missing = false;
    for (const choice of els.shopStyles?.children || []) {
      const key = choice.dataset.nodeStyle, owned = wearable(key);
      missing ||= !owned;
      choice.disabled = !owned;
      const name = choice.children?.[1];
      if (name) name.textContent = owned ? NODE_STYLES[key].name : `${NODE_STYLES[key].name} (in the Shop)`;
    }
    if (els.shopLine) els.shopLine.hidden = !missing;
  }
  // `set` names a second group of the same kind (the Void collection's styles,
  // under their own small heading); its ids are literal at the call site.
  function graphChoices(parent, kind, choices, selected, apply, set = { label: kind === "style" ? "Node style" : "Layout", id: `music-node-${kind}` }) {
    const title = element("h4", "music-node-label", set.label, parent);
    title.id = `${set.id}-label`;
    const group = element("div", "music-node-choices", null, parent);
    group.id = `${set.id}s`;
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
  // The light themes: an ordinary choice each, under a small heading of their
  // own. The swatch is the theme's page with its accent on it.
  function lightThemeChoices(parent) {
    const title = element("h4", "music-node-label", "Light", parent);
    title.id = "music-light-theme-label";
    const group = element("div", "music-themes", null, parent);
    group.id = "music-light-themes";
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", title.id);
    for (const [key, palette] of Object.entries(THEMES).filter(([key]) => isLightTheme(key))) {
      const choice = button(palette.name, "music-theme music-theme-light", group, () => applyTheme(key), `music-theme-${key}`);
      choice.dataset.theme = key;
      choice.style.setProperty("--swatch", palette.accent); choice.style.setProperty("--swatch-2", palette.bg);
      choice.setAttribute("aria-pressed", String(prefs.theme === key));
    }
    return group;
  }
  // The heading faces (FONTS), each choice showing a sample in its own face.
  function fontChoices(parent) {
    const title = element("h4", "music-node-label", "Headings", parent);
    title.id = "music-font-label";
    const group = element("div", "music-fonts", null, parent);
    group.id = "music-fonts";
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", title.id);
    for (const [key, font] of Object.entries(FONTS)) {
      const choice = button(null, "music-font", group, () => applyFont(key), `music-font-${key}`);
      choice.dataset.font = key;
      const sample = element("span", "music-font-sample", "Aa", choice);
      sample.setAttribute("aria-hidden", "true");
      if (font.stack) sample.style.fontFamily = font.stack;
      const copy = element("span", "music-font-copy", null, choice);
      element("strong", null, font.name, copy);
      element("small", null, font.detail, copy);
      choice.setAttribute("aria-pressed", String(prefs.font === key));
    }
    return group;
  }
  // The Void collection's themes: an ordinary choice each, under a small
  // heading of their own below the others.
  function voidThemeChoices(parent) {
    const title = element("h4", "music-node-label", "Void collection", parent);
    title.id = "music-void-theme-label";
    const group = element("div", "music-themes", null, parent);
    group.id = "music-void-themes";
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", title.id);
    for (const [key, palette] of Object.entries(THEMES).filter(([key]) => isVoidTheme(key))) {
      const choice = button(palette.name, "music-theme music-theme-duo", group, () => applyTheme(key), `music-theme-${key}`);
      choice.dataset.theme = key;
      // Two-tone swatch: the theme's accent ring around its second hue.
      choice.style.setProperty("--swatch", palette.accent); choice.style.setProperty("--swatch-2", palette.accent2);
      choice.setAttribute("aria-pressed", String(prefs.theme === key));
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
    activeDeck().volume = level();
    if (fadeOut && fadeOut !== activeDeck()) stopDeck(fadeOut);
    fadeOut = null;
  }
  function fadeTo(incoming, outgoing) {
    finishFade();
    if (!outgoing || outgoing === incoming || !outgoing.src || outgoing.paused) {
      incoming.volume = level();
      if (outgoing && outgoing !== incoming) stopDeck(outgoing);
      return;
    }
    fadeOut = outgoing;
    // Progress is read from the clock, not counted in ticks, so a hidden
    // window's throttled timer lands the fade late instead of stretching it.
    const started = window.performance.now();
    fadeTimer = window.setInterval(() => {
      const ratio = Math.min(1, (window.performance.now() - started) / FADE_MS);
      // The master is read every step, so moving the volume (or Mute) mid-fade sticks.
      incoming.volume = level() * ratio;
      outgoing.volume = level() * (1 - ratio);
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
    if (!viaFailover) { settingsReveal.source = null; renderSourcePanels(); }
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
    unmountLink();
    target.crossOrigin = "anonymous";
    target.volume = live ? 0 : level();
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
    audio.volume = level();
    prefs.radioOn = false; persist();
  }
  function setVolume(value) {
    const next = Number(value);
    if (Number.isFinite(next)) prefs.volume = Math.max(0, Math.min(1, next));
    // Raising the level is a request to hear it.
    if (prefs.volume > 0) soundMuted = false;
    applyLevel(); persist(); renderNow();
  }
  // A running fade picks the new master up on its next step.
  function applyLevel() {
    if (!audio) return;
    if (!fadeTimer) activeDeck().volume = level();
    if (state.source !== "radio") audio.volume = level();
  }
  function setSource(source) {
    settingsReveal.source = null;
    // "spotify" is the Links tab's name from before it played other services.
    const next = source === "link" || source === "spotify" ? "link" : source === "radio" ? "radio" : "local";
    const previous = state.source;
    if (next !== previous) {
      if (previous === "radio") stopRadio();
      audio?.pause();
      // A new source opens on its own list (Tracks, Stations, Browse).
      if (["tracks", "stations", "browse", "picture"].includes(deckSection)) deckSection = null;
      if (!state.error) note("");
    }
    state.source = next;
    if (prefs.source !== next) { prefs.source = next; persist(); }
    // Radio borrows deck A, so coming back hands the selected track back to
    // it: loaded, not playing.
    const track = state.tracks[state.selected];
    if (next === "local" && previous !== "local" && track && audio.src !== track.url) { audio.src = track.url; audio.load(); }
    if (next !== "link") unmountLink();
    if (next === "link" && state.link) mountLink();
    render(); announce();
  }
  // The player for state.link, built once per link: reopening the sheet or
  // repainting keeps the same frame, so nothing restarts. Recent restores retain
  // the last observed playback state, including a deliberately paused video.
  function mountLink() {
    const link = state.link;
    if (!link || state.source !== "link" || !els.linkPlayer) return;
    if (els.linkFrame?.dataset.url === link.url) { els.floatingPlayer?.show(linkPlayback?.title ? { ...link, label: linkPlayback.title } : link); return; }
    unmountLink();
    els.floatingPlayer?.show(link);
    const autoplay = state.linkAutoplay;
    // Listen together joins a session part-way through: the offset rides the
    // embed's own start parameter where it has one, and a file seeks once
    // its length is known.
    const startSeconds = Math.floor(state.linkStartMs / 1000);
    // position/duration/title are what the player last reported (at: when).
    linkPlayback = { startMs: state.linkStartMs, playing: autoplay, url: link.url, observed: false, savedAt: 0, position: startSeconds, duration: 0, at: 0, title: null, author: null };
    mediaVolumeApplied = false;
    state.linkAutoplay = false; state.linkStartMs = 0;
    if (link.kind === "media") {
      const player = element("video", "music-link-frame music-link-media", null, els.linkPlayer);
      player.dataset.url = link.url; player.dataset.shape = link.shape;
      player.controls = true; player.preload = "metadata"; player.playsInline = true;
      player.title = link.label;
      player.volume = mediaVolume; player.muted = mediaMuted;
      const sync = () => { if (els.linkFrame !== player) return; state.linkPlaying = !player.paused && !player.ended; renderLinkNow(); scheduleNow(); announce(); };
      for (const name of ["play", "playing", "pause", "ended"]) player.addEventListener(name, sync);
      for (const name of ["timeupdate", "durationchange", "loadedmetadata"]) player.addEventListener(name, () => { if (els.linkFrame === player) scheduleNow(); });
      player.addEventListener("ended", () => { if (els.linkFrame === player) playQueued(); });
      // The file's own controls move the video's level only; the music
      // master (local and radio) is a separate saved level.
      player.addEventListener("volumechange", () => { if (els.linkFrame === player && Number.isFinite(player.volume)) { mediaVolume = player.volume; mediaMuted = Boolean(player.muted); saveLinkVolume(); renderNow(); } });
      player.addEventListener("error", () => {
        if (els.linkFrame !== player) return;
        state.linkPlaying = false;
        note(link.provider === "discord" ? "Discord could not send that file. Attachment links expire; copy a fresh one from Discord." : "That file could not be played. The link may have expired, or the format is not supported.", true);
        scheduleNow(); announce();
      });
      if (startSeconds > 0) {
        const seekOnce = () => { player.removeEventListener?.("loadedmetadata", seekOnce); try { player.currentTime = startSeconds; } catch {} };
        player.addEventListener("loadedmetadata", seekOnce);
      }
      player.src = link.url;
      els.linkFrame = player;
      if (autoplay && typeof player.play === "function") {
        try { Promise.resolve(player.play()).catch(() => {}); } catch {}
      }
      rememberLink();
      return;
    }
    const frame = element("iframe", "music-link-frame", null, els.linkPlayer);
    frame.dataset.url = link.url; frame.dataset.shape = link.shape; frame.dataset.provider = link.provider;
    let src = link.embed;
    if (startSeconds > 0 && link.provider === "youtube") src = `${src.replace(/&start=\d+/, "")}&start=${startSeconds}`;
    if (autoplay && link.autoplay) src = `${src}${src.includes("?") ? link.autoplay : `?${link.autoplay.slice(1)}`}`;
    if (startSeconds > 0 && link.provider === "vimeo") src = `${src}#t=${startSeconds}s`;
    frame.src = src;
    frame.title = `${link.label} player`;
    frame.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    // The booklet's own policy is no-referrer (SomaFM needs it); the players
    // may see the origin, and main.cjs names Studio to YouTube's.
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    els.linkFrame = frame;
    const subscribe = () => {
      if (els.linkFrame !== frame) return;
      if (link.provider === "youtube") sendLinkMessage({ event: "listening", id: "studio-media", channel: "widget" });
      if (link.provider === "vimeo") for (const value of ["timeupdate", "play", "pause", "ended", "volumechange"]) sendLinkMessage({ method: "addEventListener", value });
    };
    frame.addEventListener("load", subscribe);
    if (link.provider === "youtube") linkWatchTimer = window.setInterval(subscribe, 500);
    rememberLink();
  }
  function sendLinkMessage(message) {
    const frame = els.linkFrame;
    if (!frame?.contentWindow) return;
    try { frame.contentWindow.postMessage(JSON.stringify(message), new URL(frame.src).origin); } catch {}
  }
  function saveLinkVolume() {
    try { localStorage.setItem("mefiStudio.mediaVolume.v1", JSON.stringify({ volume: mediaVolume, muted: mediaMuted })); } catch {}
  }
  const youtubeCommand = (func, args = []) => sendLinkMessage({ event: "command", func, args, id: "studio-media", channel: "widget" });
  function applyLinkVolume() {
    const frame = els.linkFrame;
    if (!frame) return;
    if (state.link?.kind === "media") { frame.volume = mediaVolume; frame.muted = mediaMuted; }
    if (state.link?.provider === "youtube") {
      youtubeCommand("setVolume", [Math.round(mediaVolume * 100)]);
      youtubeCommand(mediaMuted ? "mute" : "unMute");
    }
    if (state.link?.provider === "vimeo") {
      sendLinkMessage({ method: "setVolume", value: mediaVolume });
      sendLinkMessage({ method: "setMuted", value: mediaMuted });
    }
    volumeSentAt = window.performance.now();
    renderNow();
  }
  function saveLinkQueue() {
    try { localStorage.setItem(LINK_QUEUE_KEY, JSON.stringify(linkQueue)); } catch {}
    renderLinkQueue(); renderLinkNow(); paintFeedMarks(); renderNow(); scheduleDropdown();
  }
  // at: a place in the queue (a drop), else the end, or the front for next.
  function queueLink(raw, title = null, next = false, { at = null } = {}) {
    const link = mediaLink(raw);
    if (!playableLink(link)) { note("Paste a playable media link to add it to the queue.", true); return false; }
    if (linkQueue.length >= LINK_QUEUE_LIMIT) { note("The queue holds 50 videos. Remove one before adding another.", true); return false; }
    const item = { url: link.url, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 160) : link.label };
    const index = Number.isInteger(at) ? Math.max(0, Math.min(linkQueue.length, at)) : next ? 0 : linkQueue.length;
    linkQueue.splice(index, 0, item);
    saveLinkQueue(); note(index === 0 && linkQueue.length > 1 ? `${item.title} will play next.` : `${item.title} is number ${index + 1} in Up next.`);
    return true;
  }
  // ---- Playlists (renderer/playlists.js) play and queue through these two.
  const listItems = (items) => (Array.isArray(items) ? items : []).flatMap((item) => {
    const link = playableLink(mediaLink(item?.url));
    return link ? [{ url: link.url, title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 160) : link.label }] : [];
  });
  // A list starts at its first video; the rest go to the front of Up next,
  // ahead of what was already waiting, as many as the queue has room for.
  function playItems(items, name = "") {
    const list = listItems(items);
    if (!list.length) { note("Nothing in that list plays here.", true); return false; }
    const [first, ...rest] = list;
    // Starting a list on the video already loaded restarts it.
    if (state.link?.url === first.url) unmountLink();
    if (!playLink(first.url, { label: first.title, keepField: true })) return false;
    const lined = rest.slice(0, Math.max(0, LINK_QUEUE_LIMIT - linkQueue.length));
    if (lined.length) { linkQueue.splice(0, 0, ...lined); saveLinkQueue(); }
    const left = rest.length - lined.length;
    note(`${name ? `${name}: ` : ""}${first.title} is playing.${lined.length ? ` ${lined.length} more ${lined.length === 1 ? "is" : "are"} first in Up next.` : ""}${left ? ` ${left} did not fit: the queue holds ${LINK_QUEUE_LIMIT}.` : ""}`);
    return true;
  }
  // The loaded video as a list item: what Save to a playlist keeps. A YouTube
  // list link keeps the video it is on.
  function playingItem() {
    const link = state.source === "link" && !els.browser?.active ? playableLink(state.link) : null;
    if (!link) return null;
    const current = linkPlayback?.url ? playableLink(mediaLink(linkPlayback.url)) : null;
    return { url: current?.url || link.url, title: linkPlayback?.title || link.label, channel: linkPlayback?.author || "" };
  }
  function queueItems(items, name = "") {
    const list = listItems(items);
    if (!list.length) { note("Nothing in that list plays here.", true); return 0; }
    const lined = list.slice(0, Math.max(0, LINK_QUEUE_LIMIT - linkQueue.length));
    if (!lined.length) { note(`The queue holds ${LINK_QUEUE_LIMIT} videos. Remove some before adding more.`, true); return 0; }
    linkQueue.push(...lined); saveLinkQueue();
    const left = list.length - lined.length;
    note(`${lined.length} ${lined.length === 1 ? "video" : "videos"}${name ? ` from ${name}` : ""} added to Up next.${left ? ` ${left} did not fit.` : ""}`);
    return lined.length;
  }
  function moveQueued(from, to) {
    if (!linkQueue[from]) return false;
    const [item] = linkQueue.splice(from, 1);
    linkQueue.splice(Math.max(0, Math.min(linkQueue.length, to > from ? to - 1 : to)), 0, item);
    saveLinkQueue();
    return true;
  }
  function playQueued(index = 0) {
    const item = linkQueue[index];
    if (!item) return false;
    const placement = els.floatingPlayer?.snapshot?.();
    // Repeated entries are intentional: remount to restart the same video.
    if (state.link?.url === item.url) unmountLink();
    if (!playLink(item.url, { label: item.title })) return false;
    linkQueue.splice(index, 1); saveLinkQueue();
    els.floatingPlayer?.restore?.(placement); rememberLink();
    return true;
  }
  // A YouTube id's thumbnail, rebuilt from a validated id (CSP img-src).
  const youtubeId = (url) => { try { const link = mediaLink(url); if (link?.provider !== "youtube") return null; const id = new URL(link.url).searchParams.get("v"); return /^[\w-]{11}$/.test(id || "") ? id : null; } catch { return null; } };
  const thumbnail = (id) => /^[\w-]{11}$/.test(id || "") ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
  // A picture for a row or card: the video's thumbnail, else a quiet tile.
  function thumbInto(parent, id, className = "music-thumb") {
    const holder = element("span", className, null, parent); holder.setAttribute("aria-hidden", "true");
    const source = thumbnail(id);
    if (source) {
      const img = element("img", null, null, holder);
      img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.draggable = false;
      img.addEventListener("error", () => { img.hidden = true; });
      img.src = source;
    }
    return holder;
  }
  // Drags between the feed, the queue and the stage carry these types; a
  // link dragged in from Discord or a browser arrives as a URI list.
  const DRAG_MEDIA = "application/x-mefi-media", DRAG_QUEUE = "application/x-mefi-queue";
  const dragTypes = (event) => Array.from(event?.dataTransfer?.types || []);
  function draggedMedia(event) {
    let item = null;
    try { item = JSON.parse(event.dataTransfer.getData(DRAG_MEDIA) || "null"); } catch {}
    if (item && typeof item.url === "string") return { url: item.url, title: typeof item.title === "string" ? item.title : null };
    const url = droppedLink(event.dataTransfer);
    return url ? { url, title: null } : null;
  }
  function dragMedia(node, item, { queueIndex = null } = {}) {
    node.draggable = true;
    node.addEventListener("dragstart", (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return;
      try {
        transfer.setData(DRAG_MEDIA, JSON.stringify({ url: item.url, title: item.title }));
        if (queueIndex != null) transfer.setData(DRAG_QUEUE, String(queueIndex));
        transfer.setData("text/uri-list", item.url); transfer.setData("text/plain", item.url);
        transfer.effectAllowed = queueIndex != null ? "move" : "copy";
      } catch {}
      els.dropdown.dataset.dragging = queueIndex != null ? "queue" : "media";
    });
    node.addEventListener("dragend", () => { delete els.dropdown.dataset.dragging; markQueueDrop(null); });
  }
  // Where a drop lands in Up next: before the first row whose middle is
  // below the pointer, else at the end.
  function queueDropIndex(event) {
    const rows = Array.from(els.linkQueueList.children);
    for (const [index, row] of rows.entries()) { const box = row.getBoundingClientRect(); if (event.clientY < box.top + box.height / 2) return index; }
    return rows.length;
  }
  function markQueueDrop(index) {
    Array.from(els.linkQueueList?.children || []).forEach((row, at) => { if (at === index) row.dataset.drop = "before"; else delete row.dataset.drop; });
    if (els.linkQueueBox) els.linkQueueBox.dataset.drop = index == null ? "" : index >= linkQueue.length ? "end" : "row";
  }
  function bindQueueDrops(box) {
    box.addEventListener("dragover", (event) => {
      const types = dragTypes(event);
      if (!types.includes(DRAG_MEDIA) && !types.includes("text/uri-list")) return;
      event.preventDefault(); event.stopPropagation?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = types.includes(DRAG_QUEUE) ? "move" : "copy";
      markQueueDrop(queueDropIndex(event));
    });
    box.addEventListener("dragleave", (event) => { if (!box.contains(event.relatedTarget)) markQueueDrop(null); });
    box.addEventListener("drop", (event) => {
      const at = queueDropIndex(event);
      markQueueDrop(null);
      const from = Number.parseInt(event.dataTransfer?.getData?.(DRAG_QUEUE) ?? "", 10);
      const media = draggedMedia(event);
      if (!Number.isInteger(from) && !media) return;
      event.preventDefault(); event.stopPropagation?.();
      if (Number.isInteger(from)) {
        // A row is moved, never copied. Its place was read when the drag began;
        // if the queue has changed since (a video ended and took the head), the
        // row is found again by its link, and a row that is gone is left alone.
        const row = linkQueue[from] && (!media || linkQueue[from].url === media.url) ? from : media ? linkQueue.findIndex((item) => item.url === media.url) : -1;
        if (row >= 0) moveQueued(row, at);
      } else queueLink(media.url, media.title, false, { at });
    });
  }
  function renderLinkQueue() {
    if (!els.linkQueueList) return;
    els.linkQueueHeading.textContent = `Up next · ${linkQueue.length}`;
    els.linkQueueNext.disabled = !linkQueue.length;
    els.linkQueueEmpty.hidden = Boolean(linkQueue.length);
    const paint = () => {
      els.linkQueueList.textContent = "";
      linkQueue.forEach((item, index) => {
        const row = element("li", "music-link-queue-item", null, els.linkQueueList);
        row.dataset.key = item.url;
        const copy = element("span", "music-link-queue-copy", null, row);
        element("strong", null, `${index + 1}. ${item.title}`, copy);
        element("small", null, item.url, copy).hidden = !mediaMenu.showLinks;
        const actions = element("span", "music-link-queue-actions", null, row);
        button("Play now", "ghost", actions, () => playQueued(index)).setAttribute("aria-label", `Play ${item.title} now`);
        const next = button("Play next", "ghost", actions, () => { linkQueue.unshift(...linkQueue.splice(index, 1)); saveLinkQueue(); });
        next.disabled = index === 0; next.setAttribute("aria-label", `Move ${item.title} to next`);
        button("Remove", "ghost", actions, () => {
          linkQueue.splice(index, 1); saveLinkQueue();
          const neighbor = els.linkQueueList.children[Math.min(index, linkQueue.length - 1)];
          (neighbor?.querySelector?.("button") || els.linkInput).focus();
        }).setAttribute("aria-label", `Remove ${item.title} from queue`);
        // The picture is the row's backdrop (a custom property), so the
        // copy and action spans keep their places for keyboard and tests.
        const id = youtubeId(item.url);
        if (id) row.style.setProperty("--thumb", `url("${thumbnail(id)}")`);
        row.dataset.thumb = String(Boolean(id));
        dragMedia(row, item, { queueIndex: index });
      });
    };
    // Rows are keyed by link, so a reorder glides them (MefiMotion.keep,
    // motion.js). A removed row fades over the queue section, not inside the
    // list: Remove above finds its neighbour by index among the rows.
    if (window.MefiMotion?.keep) window.MefiMotion.keep(els.linkQueueList, paint, { ghostHost: els.linkQueueList.parentElement });
    else paint();
  }
  function nextVideo() {
    if (playQueued()) return;
    const current = linkPlayback?.url || state.link?.url;
    // A playlist plays its own order, even when its video is also on screen in
    // the feed; a single video (whatever start time its link carried) follows the feed.
    const playlist = state.link?.provider === "youtube" && new URL(state.link.url).searchParams.has("list");
    const index = playlist ? -1 : youtubeResults.findIndex(item => item.url === current || item.id === youtubeId(current));
    if (index >= 0 && index + 1 < youtubeResults.length) { playLink(youtubeResults[index + 1].url, { label: youtubeResults[index + 1].title, keepField: true }); return; }
    if (playlist) { youtubeCommand("nextVideo"); return; }
    // Nothing lined up: the feed is where the next one comes from.
    openSection("browse");
    feedNote("Pick what plays next: click a video to queue it, or drag it onto Up next.");
  }
  // Back: the start of this video, else the one before it.
  function previousVideo() {
    const now = playbackPosition();
    if (now.seekable && now.position > 5) { seekTo(0, true); return; }
    if (state.link?.provider === "youtube" && new URL(state.link.url).searchParams.has("list")) { youtubeCommand("previousVideo"); return; }
    const previous = linkHistory.pop();
    if (previous) { playLink(previous.url, { label: previous.title, history: false }); return; }
    if (now.seekable) seekTo(0, true);
  }

  // ---- The YouTube feed: search, more like the playing video, endless scroll.
  // youtubeResults is the list on screen (Next follows it); feed.more is the
  // token for the page after it, feed.about what the list is.
  const feed = { kind: null, query: "", about: "", more: null, generation: 0, observer: null };
  const FEED_IDEAS = ["lofi beats", "synthwave", "jazz for work", "ambient focus", "piano covers", "nature 4K", "retro game music", "deep house"];
  function feedNote(text) { if (els.youtubeNotice) els.youtubeNotice.textContent = String(text || ""); }
  // With nothing on, a click plays; with something on, it lines up after it.
  const feedBusy = () => state.source === "link" && Boolean(state.link || els.browser?.active);
  const feedHint = (item) => `${item.title} — click to ${feedBusy() ? "add it to Up next" : "play it"}; drag it onto Up next to place it`;
  const feedItems = new WeakMap();
  function feedPick(item) {
    if (!feedBusy()) { playLink(item.url, { label: item.title, keepField: true }); return; }
    if (state.link?.url === item.url) { renderNow(); return; }
    if (queueLink(item.url, item.title)) window.MefiMotion?.enter?.(els.linkQueueHeading);
  }
  function feedCard(item) {
    const card = element("article", "music-youtube-result", null, els.youtubeResults);
    card.dataset.key = item.id;
    feedItems.set(card, item); card.title = feedHint(item);
    // children[0] the picture and words; then Play, Add to queue, Queue next.
    const copy = element("span", "music-yt-copy", null, card);
    const picture = thumbInto(copy, item.id, "music-yt-thumb");
    if (item.duration) element("small", "music-yt-time", item.duration, picture);
    element("strong", null, item.title, copy);
    element("small", null, item.channel || "YouTube", copy);
    const play = iconButton("play", `Play ${item.title} now`, card, () => playLink(item.url, { label: item.title, keepField: true }));
    const add = iconButton("queue", `Add ${item.title} to queue`, card, () => queueLink(item.url, item.title));
    const next = iconButton("next", `Queue ${item.title} next`, card, () => queueLink(item.url, item.title, true));
    for (const node of [play, add, next]) node.classList.add("music-yt-action");
    if (playlistsHook) {
      const save = iconButton("save", `Save ${item.title} to a playlist`, card, () => playlistsHook?.save?.(save, { url: item.url, title: item.title, channel: item.channel, duration: item.duration }));
      save.classList.add("music-yt-action", "music-yt-save");
    }
    card.addEventListener("click", (event) => { if (!event.target?.closest?.("button")) feedPick(item); });
    dragMedia(card, item);
    return card;
  }
  // Marks each card that is playing or already waiting in Up next, and keeps
  // its hint true to what a click will do.
  function paintFeedMarks() {
    if (!els.youtubeResults) return;
    const queued = new Set(linkQueue.map((item) => youtubeId(item.url)).filter(Boolean));
    const playing = youtubeId(linkPlayback?.url || state.link?.url);
    for (const card of Array.from(els.youtubeResults.children)) {
      const id = card.dataset?.key;
      const mark = id && id === playing ? "playing" : queued.has(id) ? "queued" : "";
      if ((card.dataset.state || "") !== mark) card.dataset.state = mark;
      const item = feedItems.get(card), hint = item ? feedHint(item) : card.title;
      if (card.title !== hint) card.title = hint;
    }
  }
  // The ideas are the same until the playing YouTube video changes (or ends up
  // none), so they are painted once per video; render() asks on every repaint,
  // which is what puts them on a Browse that opens before anything has played.
  let ideasFor;
  function paintFeedIdeas() {
    if (!els.feedIdeas) return;
    const current = state.source === "link" ? youtubeId(state.link?.url) : null;
    if (ideasFor === current) return;
    ideasFor = current;
    els.feedIdeas.textContent = "";
    if (current) button("More like this video", "ghost music-feed-idea", els.feedIdeas, () => void loadFeed({ related: current }, { about: `More like ${linkPlayback?.title || "this video"}` })).dataset.kind = "related";
    for (const idea of FEED_IDEAS) button(idea, "ghost music-feed-idea", els.feedIdeas, () => { els.linkInput.value = idea; void searchYouTube(idea); });
  }
  // request: a search (a string), { related: id } or { more: token }.
  async function loadFeed(request, { about = "", append = false } = {}) {
    if (youtubeSearching && !append) feed.generation++;
    else if (youtubeSearching) return false;
    if (!window.mefiStudio?.youtubeSearch) { feedNote("Restart Studio to browse YouTube here."); return false; }
    const generation = ++feed.generation;
    youtubeSearching = true;
    els.youtubeResults.dataset.loading = append ? "more" : "fresh";
    if (!append) feedNote(typeof request === "string" ? `Searching YouTube for “${request}”…` : "Finding videos like this one…");
    try {
      const response = await window.mefiStudio.youtubeSearch(request);
      if (generation !== feed.generation) return false;
      if (!response?.ok) throw new Error(response?.error || "YouTube is unavailable right now.");
      const known = new Set(append ? youtubeResults.map((item) => item.id) : []);
      const fresh = (response.results || []).filter((item) => item && /^[\w-]{11}$/.test(item.id) && typeof item.title === "string" && !known.has(item.id) && known.add(item.id))
        .slice(0, 40).map((item) => ({ id: item.id, title: item.title.slice(0, 200), channel: typeof item.channel === "string" ? item.channel.slice(0, 120) : "", duration: typeof item.duration === "string" ? item.duration.slice(0, 20) : "", url: `https://www.youtube.com/watch?v=${item.id}` }));
      if (!append) {
        youtubeResults = fresh; els.youtubeResults.textContent = ""; els.youtubeResults.scrollTop = 0;
        feed.kind = typeof request === "string" ? "search" : "related"; feed.query = typeof request === "string" ? request : ""; feed.about = about;
      } else youtubeResults = [...youtubeResults, ...fresh];
      feed.more = typeof response.more === "string" && response.more.length <= 8192 ? response.more : null;
      for (const item of fresh) feedCard(item);
      paintFeedMarks();
      els.feedTitle.textContent = feed.kind === "related" ? feed.about || "More like this" : feed.query ? `Results for “${feed.query}”` : "YouTube";
      feedNote(youtubeResults.length ? `${youtubeResults.length} videos · click to add, drag onto Up next to place it${feed.more ? " · scroll for more" : ""}.` : "No videos found. Try another search.");
      watchFeedEnd();
      return true;
    } catch (error) {
      if (generation === feed.generation) feedNote(error?.message || "YouTube is unavailable right now.");
      return false;
    } finally {
      if (generation === feed.generation) { youtubeSearching = false; delete els.youtubeResults.dataset.loading; scheduleDropdown(); }
    }
  }
  // The next page loads as the list's end scrolls into view.
  function watchFeedEnd() {
    if (!els.feedEnd || typeof window.IntersectionObserver !== "function") return;
    feed.observer ||= new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && feed.more && !youtubeSearching && !els.youtubeResults.closest?.("[hidden]")) void loadFeed({ more: feed.more }, { append: true });
    }, { root: els.deck, rootMargin: "0px 0px 320px 0px" });
    feed.observer.disconnect(); feed.observer.observe(els.feedEnd);
    els.feedEnd.hidden = !feed.more;
  }
  function searchYouTube(query = els.linkInput?.value) {
    const words = String(query ?? "").trim().slice(0, 160);
    if (!words) { els.linkInput?.focus?.(); return Promise.resolve(false); }
    openSection("browse");
    return loadFeed(words);
  }
  function linkMessage(event) {
    const frame = els.linkFrame;
    if (!frame?.contentWindow || !linkPlayback || event.source !== frame.contentWindow) return;
    try { if (event.origin !== new URL(frame.src).origin) return; } catch { return; }
    let message = event.data;
    try { if (typeof message === "string") message = JSON.parse(message); } catch { return; }
    if (!message || typeof message !== "object") return;
    let seconds, playing, ended = false, duration, title = null, author = null;
    if (state.link?.provider === "youtube") {
      if (message.event === "onReady") { applyLinkVolume(); mediaVolumeApplied = true; return; }
      if (!["infoDelivery", "initialDelivery", "onStateChange"].includes(message.event)) return;
      if (linkWatchTimer) window.clearInterval(linkWatchTimer);
      linkWatchTimer = null;
      if (message.event === "initialDelivery") youtubeCommand("addEventListener", ["onStateChange"]);
      const info = message.info;
      if (!mediaVolumeApplied) { applyLinkVolume(); mediaVolumeApplied = true; }
      else if (info && typeof info === "object" && (Number.isFinite(info.volume) || typeof info.muted === "boolean")) {
        acceptVolume(Number.isFinite(info.volume) ? info.volume / 100 : mediaVolume, typeof info.muted === "boolean" ? info.muted : mediaMuted);
      }
      const playerState = message.event === "onStateChange" ? info : info?.playerState;
      if (playerState === 1) linkPlayback.queueStarted = true;
      ended = playerState === 0;
      if ([0, 1, 2, 3].includes(playerState)) playing = playerState === 1 || playerState === 3;
      seconds = info?.currentTime;
      duration = info?.duration;
      if (typeof info?.videoData?.title === "string") { title = info.videoData.title; author = info.videoData.author; }
      // A playlist may have advanced since the original link was opened.
      if (/^[\w-]{11}$/.test(info?.videoData?.video_id || "")) {
        const url = new URL(linkPlayback.url); url.pathname = "/watch";
        url.searchParams.set("v", info.videoData.video_id); url.searchParams.delete("t");
        linkPlayback.url = url.href;
      }
    } else if (state.link?.provider === "vimeo") {
      if (message.event === "ready") {
        for (const value of ["timeupdate", "play", "pause", "ended", "volumechange"]) sendLinkMessage({ method: "addEventListener", value });
        sendLinkMessage({ method: "getVideoTitle" }); sendLinkMessage({ method: "getDuration" });
        applyLinkVolume();
        return;
      }
      // Answers to the two questions asked on ready.
      if (message.method === "getVideoTitle" && typeof message.value === "string") title = message.value;
      else if (message.method === "getDuration") duration = message.value;
      else if (message.event === "volumechange") {
        acceptVolume(Number.isFinite(message.data?.volume) ? message.data.volume : mediaVolume, typeof message.data?.muted === "boolean" ? message.data.muted : mediaMuted);
        return;
      } else if (!["timeupdate", "play", "pause", "ended"].includes(message.event)) return;
      else {
        seconds = message.data?.seconds;
        duration = message.data?.duration;
        if (message.event === "play") linkPlayback.queueStarted = true;
        ended = message.event === "ended";
        if (message.event !== "timeupdate") playing = message.event === "play";
      }
    } else return;
    // Initial, unstarted metadata must not erase a restored seek before playback.
    if (Number.isFinite(seconds) && seconds >= 0 && (seconds > 0 || linkPlayback.observed || playing !== undefined)) linkPlayback.startMs = Math.min(seconds * 1000, 86_400_000);
    // Just after a seek, a report far from it is the old place, not the new one.
    const seeking = window.performance.now() - seekSentAt < 1200 && Number.isFinite(seconds) && Math.abs(seconds - seekSent) > 2;
    if (Number.isFinite(seconds) && seconds >= 0 && !seeking) { linkPlayback.position = Math.min(seconds, 86_400); linkPlayback.at = window.performance.now(); }
    if (Number.isFinite(duration) && duration > 0) linkPlayback.duration = Math.min(duration, 86_400);
    const named = typeof title === "string" && title.trim() && title.trim().slice(0, 160) !== linkPlayback.title;
    if (named) {
      linkPlayback.title = title.trim().slice(0, 160);
      linkPlayback.author = typeof author === "string" && author.trim() ? author.trim().slice(0, 120) : null;
      els.floatingPlayer?.rename?.(linkPlayback.title);
    }
    const turned = playing !== undefined && (playing !== linkPlayback.playing || !linkPlayback.observed);
    if (playing !== undefined) { linkPlayback.playing = playing; linkPlayback.observed = true; }
    if (Date.now() - linkPlayback.savedAt >= 1000 || playing === false) rememberLink();
    if (named || turned) { renderLinkNow(); paintFeedMarks(); announce(); }
    scheduleNow();
    if (ended && linkPlayback.queueStarted) { linkPlayback.queueStarted = false; playQueued(); }
  }
  // A level the player reports. While Studio's own slider moves, or just
  // after Studio asked for a level, a different report is the player's echo
  // of an older one; later, it is a change made in the player itself.
  function acceptVolume(volume, muted) {
    const next = Math.max(0, Math.min(1, Number(volume) || 0));
    if (Math.abs(next - mediaVolume) < .01 && muted === mediaMuted) return;
    const sliding = [els.volume, els.floatVolume].includes(document.activeElement);
    if (sliding || window.performance.now() - volumeSentAt < 1500) return;
    mediaVolume = next; mediaMuted = Boolean(muted);
    saveLinkVolume(); renderNow();
  }
  // Keep a recent presence stamp while open, including paused/minimized media.
  // Explicitly closing the player or changing source clears it; closing Studio
  // saves one final stamp. This also covers a renderer/app crash between beats.
  function rememberLink() {
    if (!els.linkFrame || !state.link || state.source !== "link") return;
    const native = state.link.kind === "media";
    try {
      localStorage.setItem(LINK_RESUME_KEY, JSON.stringify({ at: Date.now(), url: linkPlayback?.url || state.link.url,
        startMs: native ? (Number.isFinite(els.linkFrame.duration) ? Math.max(0, Number(els.linkFrame.currentTime) || 0) * 1000 : linkPlayback?.startMs || 0) : linkPlayback?.startMs || 0,
        autoplay: native ? !els.linkFrame.paused && !els.linkFrame.ended : Boolean(linkPlayback?.playing), window: els.floatingPlayer?.snapshot?.() }));
      if (linkPlayback) linkPlayback.savedAt = Date.now();
    } catch {}
    if (!linkResumeTimer) linkResumeTimer = window.setInterval(rememberLink, 15000);
  }
  function restoreRecentLink(saved) {
    if (!saved || !Number.isFinite(saved.at) || saved.at > Date.now() || Date.now() - saved.at > LINK_RESUME_MS || els.linkFrame) return;
    if (playLink(saved.url, { autoplay: saved.autoplay === true, startMs: Number(saved.startMs) || 0 })) {
      els.floatingPlayer?.restore?.(saved.window);
      rememberLink();
    }
  }
  let browserRequest = 0;
  function unmountLink({ keepBrowser = false } = {}) {
    if (!keepBrowser) { browserRequest++; els.browser?.close(); }
    if (linkResumeTimer) window.clearInterval(linkResumeTimer);
    linkResumeTimer = null;
    if (linkWatchTimer) window.clearInterval(linkWatchTimer);
    linkWatchTimer = null; linkPlayback = null;
    try { localStorage.removeItem(LINK_RESUME_KEY); } catch {}
    els.floatingPlayer?.hide();
    const frame = els.linkFrame;
    if (!frame) return;
    els.linkFrame = null;
    state.linkPlaying = false;
    if (frame.tagName === "video" || frame.tagName === "VIDEO") { try { frame.pause?.(); frame.removeAttribute("src"); frame.load?.(); } catch {} }
    frame.remove();
  }
  // The one door for every link, from the Links field, a recent chip, a drop,
  // or another part of Studio (MefiMusic.playLink). Returns true when the link
  // is now the playing source; a hand-off leaves whatever is playing alone.
  // history: false for Back itself; keepField leaves a search in the box
  // when a result plays, so the next pick needs no retyping.
  function playLink(raw, { autoplay = true, startMs = 0, label = null, history = true, keepField = false } = {}) {
    init();
    const link = mediaLink(raw);
    if (link && typeof label === "string" && label.trim()) link.label = label.trim().slice(0, 160);
    if (!link) { note("Enter a web address, a media link or an audio/video file URL.", true); return false; }
    if (!playableLink(link)) {
      state.handoff = link;
      if (els.linkInput) els.linkInput.value = link.url;
      settingsReveal.source = "link";
      render();
      if (!link.jam && window.mefiStudio?.mediaBrowserOpen) { void openMediaBrowser(link.url); return true; }
      note(handoffNote(link));
      return false;
    }
    state.handoff = null;
    if (state.link?.url !== link.url) {
      if (state.link && history && state.source === "link") linkHistory.push({ url: linkPlayback?.url || state.link.url, title: linkPlayback?.title || state.link.label });
      if (linkHistory.length > 30) linkHistory.shift();
      unmountLink();
    }
    state.link = link;
    state.linkAutoplay = autoplay;
    state.linkStartMs = Number.isFinite(startMs) && startMs > 0 ? Math.min(startMs, 86_400_000) : 0;
    prefs.links = [link.url, ...prefs.links.filter((url) => url !== link.url)].slice(0, 8);
    persist();
    setSource("link");
    // Choosing the link that is already loaded plays it rather than reloading.
    if (autoplay && link.kind === "media" && els.linkFrame?.paused && typeof els.linkFrame.play === "function") { try { Promise.resolve(els.linkFrame.play()).catch(() => {}); } catch {} }
    state.linkAutoplay = false; state.linkStartMs = 0;
    if (els.linkInput && !(keepField && els.linkInput.value.trim() && !mediaLink(els.linkInput.value))) els.linkInput.value = link.url;
    note(link.kind === "media" ? `${link.label} is loaded.` : `${link.providerName} is loading. What plays is up to ${link.providerName}.`);
    paintFeedMarks(); paintFeedIdeas();
    return true;
  }
  function handoffNote(link) {
    if (link.jam) return "Spotify only lets its own app join a Jam. Open it in Spotify below: listening remotely needs Premium there, joining in person does not.";
    return `${link.label} can open in the mini browser. Some services require your regular browser for sign-in or protected playback.`;
  }
  async function openMediaBrowser(raw = "") {
    if (!els.browser || !window.mefiStudio?.mediaBrowserOpen) { note("The built-in browser is available in the Studio desktop app.", true); return false; }
    const request = ++browserRequest;
    try {
      const result = await els.browser.open(raw);
      if (request !== browserRequest) return false;
      if (!result?.ok) { note(result?.error || "The browser could not open.", true); return false; }
      stopRadio(); audio.pause(); unmountLink({ keepBrowser: true });
      state.link = null; state.handoff = null; state.source = "link"; prefs.source = "link"; persist();
      els.floatingPlayer?.show({ shape: "browser", label: "Media browser" });
      els.floatingPlayer?.restore?.({ minimized: false });
      render(); announce(); openAudio(); scheduleDropdown(); els.browser.schedule?.();
      note("Browse and play inside Studio. Use the website’s playback controls.");
      return true;
    } catch { note("The browser could not open. Try again.", true); return false; }
  }
  function openLink(url) {
    if (!window.mefiStudio?.openExternal) { note("Opening links needs the Studio desktop app.", true); return; }
    Promise.resolve(window.mefiStudio.openExternal(url)).then((result) => { if (result && result.ok === false) note(result.error || "That link could not be opened.", true); }, () => note("That link could not be opened.", true));
  }
  function copyLink(url) {
    const done = () => note("Link copied. Paste it in Discord or anywhere else to share it.");
    try {
      const clipboard = window.navigator?.clipboard;
      if (clipboard?.writeText) { clipboard.writeText(url).then(done, () => note("The link could not be copied.", true)); return; }
    } catch {}
    note("The link could not be copied.", true);
  }
  // A link dragged in from Discord, a browser tab or a chat arrives as a URI
  // list or as text.
  function droppedLink(transfer) {
    if (!transfer?.getData) return "";
    let text = "";
    try { text = transfer.getData("text/uri-list") || transfer.getData("text/plain") || ""; } catch {}
    return String(text).split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "";
  }
  async function play() {
    if (state.source !== "local") setSource("local");
    if (!state.tracks[state.selected]) { els.files?.click(); return; }
    try { await audio.play(); note(""); }
    catch (error) { note(`Could not play this file: ${error?.message || "format unavailable"}`, true); }
    renderNow(); announce();
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
    else { renderNow(); announce(); }
  }

  // ---- The mini player: one card and one transport for the source on show.
  // A settings search can show one source's controls while another plays;
  // the transport acts on the one on show, as its panel does.
  const shownSource = () => settingsReveal.source ?? state.source;
  const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
  const setAttr = (node, name, value) => { if (node && node.getAttribute?.(name) !== value) node.setAttribute(name, value); };
  // Where the shown source is: seconds, and whether Studio can move it.
  function playbackPosition() {
    const source = shownSource();
    if (source === "local") {
      const live = state.source === "local" && Boolean(audio?.src);
      const duration = live && Number.isFinite(audio.duration) ? audio.duration : 0;
      return { position: Number.isFinite(audio?.currentTime) ? audio.currentTime : 0, duration, seekable: live && duration > 0 };
    }
    if (source !== "link" || state.source !== "link" || !state.link || !linkPlayback) return { position: 0, duration: 0, seekable: false };
    if (state.link.kind === "media") {
      const frame = els.linkFrame;
      const duration = Number.isFinite(frame?.duration) ? frame.duration : 0;
      return { position: Number(frame?.currentTime) || 0, duration, seekable: duration > 0 };
    }
    if (!["youtube", "vimeo"].includes(state.link.provider)) return { position: 0, duration: 0, seekable: false };
    // Between two reports a playing video keeps moving at its own speed.
    const drift = linkPlayback.playing && linkPlayback.observed && linkPlayback.at ? Math.min(2, (window.performance.now() - linkPlayback.at) / 1000) : 0;
    const duration = linkPlayback.duration || 0;
    return { position: Math.max(0, Math.min(duration || Infinity, (linkPlayback.position || 0) + drift)), duration, seekable: duration > 0 };
  }
  // What the card says and which controls act, for the source on show.
  function nowPlaying() {
    const source = shownSource();
    const where = playbackPosition();
    if (source === "radio") {
      const tuned = station(state.station);
      const phase = state.source === "radio" ? state.radioPhase : "idle";
      const on = ["playing", "buffering", "connecting"].includes(phase);
      return { source, ...where, playing: on, live: true, canToggle: true, canPrevious: true, canNext: true, volume: prefs.volume, muted: soundMuted, canVolume: true,
        kicker: phase === "playing" ? "Live radio" : phase === "connecting" ? "Connecting…" : phase === "buffering" ? "Holding the sound…" : phase === "error" ? "Station unavailable" : "Ad-free radio",
        title: tuned?.name || "Pick a station", detail: tuned ? `${tuned.detail} · ${tuned.origin}` : "Listener-funded stations. No ads, ever." };
    }
    if (source === "link") {
      const browser = state.source === "link" && els.browser?.active ? els.browser.state : null;
      const link = state.source === "link" ? state.link : null;
      if (browser) return { source, ...where, playing: false, canToggle: false, canPrevious: false, canNext: linkQueue.length > 0, volume: mediaVolume, muted: mediaMuted, canVolume: false,
        kicker: "Browsing", title: browser.title || "Media browser", detail: "Use the website’s own play controls." };
      if (!link) return { source, ...where, playing: false, canToggle: linkQueue.length > 0, canPrevious: linkHistory.length > 0, canNext: true, volume: mediaVolume, muted: mediaMuted, canVolume: true,
        kicker: "Video & links", title: "Nothing playing yet", detail: linkQueue.length ? `${linkQueue.length} waiting in Up next` : "Search YouTube or paste a link." };
      const native = link.kind === "media";
      const talks = native || link.provider === "youtube" || link.provider === "vimeo";
      const playing = native ? state.linkPlaying : Boolean(linkPlayback?.observed && linkPlayback.playing);
      return { source, ...where, playing, canToggle: talks, canPrevious: true, canNext: true, volume: mediaVolume, muted: mediaMuted, canVolume: talks,
        kicker: playing ? "Now playing" : talks && (native || linkPlayback?.observed) ? "Paused" : link.providerName,
        title: linkPlayback?.title || link.label,
        detail: talks ? [linkPlayback?.author, link.providerName].filter(Boolean).join(" · ") : `${link.providerName} · play and pause inside its player`,
        thumb: thumbnail(youtubeId(linkPlayback?.url || link.url)) };
    }
    const track = state.tracks[state.selected];
    const playing = state.source === "local" && Boolean(audio?.src) && !audio.paused && !audio.ended;
    return { source: "local", ...where, playing, canToggle: true, canPrevious: Boolean(track), canNext: Boolean(track), volume: prefs.volume, muted: soundMuted, canVolume: true,
      kicker: !track ? "Your soundtrack" : playing ? "Now playing" : "Ready to play", title: track?.title || "Your own soundtrack",
      detail: track ? `Track ${state.selected + 1} of ${state.tracks.length} · Local audio` : "Add music from your computer to get started." };
  }
  // Paints the card and the floating player's bar; a busy player repaints
  // at most once a frame (scheduleNow).
  function renderNow() {
    if (nowFrame) { window.cancelAnimationFrame?.(nowFrame); nowFrame = 0; }
    if (!initialized || !els.play) return;
    const now = nowPlaying();
    const card = els.nowCard;
    card.dataset.source = now.source; card.dataset.playing = String(now.playing);
    setText(els.nowKicker, now.kicker); setText(els.nowTitle, now.title); setText(els.nowDetail, now.detail);
    els.nowTitle.title = now.title;
    // The picture beside the words: a video's thumbnail when the video itself
    // is not in the stage, else the source's own mark. Only an open menu asks
    // for it: a closed one shows nobody a picture, and a remembered or freshly
    // loaded link must not reach YouTube's image host before the menu opens.
    const picture = els.dropdown.hidden === false && now.source === "link" && els.linkStage.dataset.docked !== "true" ? now.thumb : null;
    if ((els.nowThumb.dataset.src || "") !== (picture || "")) {
      els.nowThumb.dataset.src = picture || "";
      if (picture) els.nowThumb.src = picture; else els.nowThumb.removeAttribute("src");
    }
    els.nowThumb.hidden = !picture;
    card.dataset.art = picture ? "thumb" : now.source === "link" && els.linkStage.dataset.docked === "true" ? "stage" : now.source;
    for (const [play, previous, next] of [[els.play, els.previous, els.next], [els.floatPlay, els.floatPrevious, els.floatNext]]) {
      if (!play) continue;
      play.dataset.playing = String(now.playing); play.disabled = !now.canToggle;
      const verb = now.source === "radio" ? now.playing ? "Stop the radio" : "Play the radio" : now.playing ? "Pause" : "Play";
      setAttr(play, "aria-label", verb); play.title = now.canToggle ? verb : "Use the player’s own play button";
      previous.disabled = !now.canPrevious; next.disabled = !now.canNext;
    }
    const seek = els.seek;
    seek.disabled = !now.seekable;
    els.nowSeek.dataset.live = String(Boolean(now.live));
    const max = now.seekable ? now.duration : 1;
    if (seek.max !== String(max)) seek.max = String(max);
    if (document.activeElement !== seek) seek.value = String(now.seekable ? Math.min(now.position, max) : 0);
    seek.style.setProperty("--fill", `${now.seekable ? Math.min(100, Number(seek.value) / max * 100) : 0}%`);
    setText(els.elapsed, now.live ? "Live" : timeLabel(now.position));
    setText(els.duration, now.live ? "" : now.seekable ? timeLabel(now.duration) : "--:--");
    const volume = String(Math.round((now.muted ? 0 : now.volume) * 100));
    for (const [slider, mute] of [[els.volume, els.mute], [els.floatVolume, els.floatMute]]) {
      if (!slider) continue;
      slider.disabled = !now.canVolume; mute.disabled = !now.canVolume;
      if (document.activeElement !== slider) slider.value = volume;
      slider.style.setProperty("--fill", `${slider.value}%`);
      setAttr(slider, "aria-valuetext", now.muted ? "Muted" : `${slider.value}%`);
      mute.dataset.muted = String(now.muted); setAttr(mute, "aria-pressed", String(now.muted));
      setAttr(mute, "aria-label", now.muted ? "Unmute" : "Mute"); mute.title = now.muted ? "Unmute" : "Mute";
    }
    renderNextLine();
  }
  function scheduleNow() {
    if (nowFrame || !initialized) return;
    if (typeof window.requestAnimationFrame === "function") nowFrame = window.requestAnimationFrame(() => { nowFrame = 0; renderNow(); });
    else renderNow();
  }
  // "Up next" in one line under the transport: the next link, or a nudge.
  function renderNextLine() {
    if (!els.nextLine) return;
    const show = shownSource() === "link" && linkQueue.length > 0;
    els.nextLine.hidden = !show;
    if (!show) return;
    setText(els.nextLineTitle, linkQueue[0].title);
    setText(els.nextLineMore, linkQueue.length > 1 ? `+${linkQueue.length - 1}` : "");
  }
  function transportToggle() {
    const source = shownSource();
    if (source === "local") { if (state.source !== "local" || audio.paused) void play(); else audio.pause(); return; }
    if (source === "radio") {
      if (state.source === "radio" && ["playing", "buffering", "connecting"].includes(state.radioPhase)) { stopRadio(); render(); announce(); }
      else tune(state.station || STATIONS[0].id);
      return;
    }
    if (state.source !== "link" || !state.link) { if (!playQueued()) openSection("browse"); return; }
    if (state.link.kind === "media") {
      const frame = els.linkFrame;
      if (frame?.paused || frame?.ended) { try { Promise.resolve(frame.play?.()).catch(() => {}); } catch {} } else frame?.pause?.();
      return;
    }
    const playing = Boolean(linkPlayback?.observed && linkPlayback.playing);
    if (state.link.provider === "youtube") youtubeCommand(playing ? "pauseVideo" : "playVideo");
    else if (state.link.provider === "vimeo") sendLinkMessage({ method: playing ? "pause" : "play" });
    else return;
    // Shown at once; the player's next report confirms or corrects it.
    if (linkPlayback) { linkPlayback.position = playbackPosition().position; linkPlayback.at = window.performance.now(); linkPlayback.playing = !playing; linkPlayback.observed = true; }
    renderNow(); announce();
  }
  function stepStation(step) {
    const index = STATIONS.findIndex((item) => item.id === state.station);
    const next = index < 0 ? STATIONS[step > 0 ? 0 : STATIONS.length - 1] : STATIONS[(index + step + STATIONS.length) % STATIONS.length];
    tune(next.id);
  }
  function transportPrevious() {
    const source = shownSource();
    if (source === "local") { if (audio.currentTime > 3) { audio.currentTime = 0; renderNow(); } else move(-1); return; }
    if (source === "radio") { stepStation(-1); return; }
    previousVideo();
  }
  function transportNext() {
    const source = shownSource();
    if (source === "local") move(1);
    else if (source === "radio") stepStation(1);
    else nextVideo();
  }
  // final: a drag's last word; while a drag moves, YouTube only previews.
  function seekTo(seconds, final = true) {
    const target = Math.max(0, Number(seconds) || 0);
    const source = shownSource();
    if (source === "local") { if (Number.isFinite(audio.duration)) audio.currentTime = target; renderNow(); return; }
    if (source !== "link" || state.source !== "link" || !state.link) return;
    if (state.link.kind === "media") { try { els.linkFrame.currentTime = target; } catch {} renderNow(); return; }
    seekSentAt = window.performance.now(); seekSent = target;
    if (linkPlayback) { linkPlayback.position = target; linkPlayback.at = seekSentAt; }
    if (state.link.provider === "youtube") youtubeCommand("seekTo", [target, final]);
    else if (state.link.provider === "vimeo") sendLinkMessage({ method: "setCurrentTime", value: target });
    renderNow();
  }
  function transportVolume(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
    if (shownSource() !== "link") { setVolume(value); return; }
    mediaVolume = value;
    if (value > 0) mediaMuted = false;
    saveLinkVolume(); applyLinkVolume();
  }
  function transportMute() {
    if (shownSource() === "link") { mediaMuted = !mediaMuted; saveLinkVolume(); applyLinkVolume(); return; }
    soundMuted = !soundMuted; applyLevel(); renderNow();
  }

  // ---- Unfolding: the card grows into one section at a time.
  const DECK_SECTIONS = {
    local: [["tracks", "Tracks", "tracks"]],
    radio: [["stations", "Stations", "stations"]],
    link: [["browse", "Browse", "find"], ["picture", "Picture", "picture"]],
    // Playlists shows under every source (playing one turns to Video), once
    // renderer/playlists.js has registered.
    all: [["playlists", "Playlists", "playlists"], ["tree", "Tree", "tree"], ["more", "More", "more"]],
  };
  const sectionsFor = (source) => [...(DECK_SECTIONS[source] || []), ...DECK_SECTIONS.all].filter(([key]) => key !== "playlists" || playlistsOn());
  function currentSection(source = shownSource()) {
    const keys = sectionsFor(source).map(([key]) => key);
    return keys.includes(deckSection) ? deckSection : keys[0];
  }
  // The menu eases between its sizes: measured before and after a change,
  // it grows from its right edge (it hangs under the toolbar button) and down.
  function morph(change) {
    const panel = els.dropdown;
    const still = !panel || panel.hidden || typeof panel.animate !== "function" || window.MefiMotion?.off?.() || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const before = still ? null : panel.getBoundingClientRect();
    change();
    if (still) { scheduleDropdown(); return; }
    positionDropdown();
    const after = panel.getBoundingClientRect();
    if (Math.abs(before.width - after.width) < 2 && Math.abs(before.height - after.height) < 2) return;
    for (const running of panel.getAnimations?.() || []) if (running.id === "music-morph") running.cancel();
    const run = panel.animate([{ width: `${before.width}px`, height: `${before.height}px` }, { width: `${after.width}px`, height: `${after.height}px` }], { duration: 280, easing: "cubic-bezier(.2, 0, 0, 1)" });
    run.id = "music-morph";
    panel.dataset.morphing = "true";
    const done = () => { delete panel.dataset.morphing; scheduleDropdown(); };
    run.onfinish = done; run.oncancel = done;
  }
  function openSection(section, { focus = true } = {}) {
    init();
    if (els.dropdown.hidden) openAudio();
    const source = shownSource();
    const target = sectionsFor(source).some(([key]) => key === section) ? section : currentSection(source);
    morph(() => { deckOpen = true; deckSection = target; mediaMenu.section = target; saveMediaMenu(); renderDeck(); });
    if (target === "browse") {
      if (!youtubeResults.length && !youtubeSearching && youtubeId(state.link?.url) && state.source === "link") void loadFeed({ related: youtubeId(state.link.url) }, { about: `More like ${linkPlayback?.title || "this video"}` });
      if (focus && !els.linkInput.value.trim()) els.linkInput.focus?.({ preventScroll: true });
    }
    return target;
  }
  function closeDeck() { if (watchHost) return; if (deckOpen) morph(() => { deckOpen = false; renderDeck(); }); }
  function renderDeck() {
    if (!els.deck) return;
    const source = shownSource();
    const section = currentSection(source);
    els.dropdown.dataset.size = deckOpen ? "full" : "compact";
    els.dropdown.dataset.section = section;
    els.deck.hidden = !deckOpen;
    // A source's own panel is the one its first section shows.
    els.local.hidden = !(source === "local" && section === "tracks");
    els.radio.hidden = !(source === "radio" && section === "stations");
    els.link.hidden = !(source === "link" && (section === "browse" || section === "picture"));
    els.linkBrowse.hidden = section !== "browse"; els.linkPicture.hidden = section !== "picture";
    els.audioLink.hidden = section !== "tree"; els.more.hidden = section !== "more";
    els.playlists.hidden = section !== "playlists";
    if (deckOpen && !els.playlists.hidden) playlistsHook?.shown?.();
    const defs = sectionsFor(source);
    const signature = defs.map(([key]) => key).join(",");
    if (els.sections.dataset.signature !== signature) {
      els.sections.dataset.signature = signature;
      els.sections.textContent = "";
      for (const [key, label, icon] of defs) {
        const tab = button(null, "music-section-tab", els.sections, () => { if (deckOpen && currentSection() === key) closeDeck(); else openSection(key); }, `music-section-${key}`);
        glyph(icon, tab); element("span", null, label, tab);
        tab.dataset.section = key; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "music-deck");
      }
    }
    for (const tab of Array.from(els.sections.children)) {
      const on = deckOpen && tab.dataset.section === section;
      setAttr(tab, "aria-selected", String(on));
      tab.tabIndex = on || (!deckOpen && tab === els.sections.children[0]) ? 0 : -1;
    }
    els.expand.dataset.open = String(deckOpen);
    setAttr(els.expand, "aria-expanded", String(deckOpen));
    setAttr(els.expand, "aria-label", deckOpen ? "Show less" : "Show more");
    els.expand.title = deckOpen ? "Fold back to the mini player" : `Unfold: queue, search, ${playlistsOn() ? "playlists, " : ""}picture and tree settings`;
    renderNextLine();
    scheduleDropdown();
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
  function renderSourcePanels() {
    const shown = shownSource();
    els.localTab.setAttribute("aria-selected", String(shown === "local"));
    els.radioTab.setAttribute("aria-selected", String(shown === "radio"));
    els.linkTab.setAttribute("aria-selected", String(shown === "link"));
    for (const [source, tab] of [["local", els.localTab], ["radio", els.radioTab], ["link", els.linkTab]]) tab.tabIndex = source === shown ? 0 : -1;
    els.dropdown.dataset.source = shown;
    els.dropdown.dataset.video = String(shown === "link" && state.link?.shape === "video");
    if (els.sourcePreview) {
      const names = { local: "Local music", radio: "Radio", link: "Links" };
      els.sourcePreview.hidden = shown === state.source;
      els.sourcePreview.textContent = shown === state.source ? "" : `Viewing ${names[shown]} controls. ${names[state.source]} remains the active source.`;
    }
    renderDeck();
  }
  function render() {
    if (!initialized) return;
    renderSourcePanels();
    renderQueue(); renderRadio(); renderAudioLink(); renderLinks(); paintFeedIdeas(); paintFeedMarks(); renderNow();
    els.recommend.disabled = state.sending || !(recommender || window.mefiStudio?.musicRecommend);
    els.recommend.textContent = state.sending ? "Finding a direction…" : "Ask for recommendations";
    els.aiHint.textContent = recommender || window.mefiStudio?.musicRecommend ? "Uses Studio’s configured assistant. Recommendations appear here." : "Music recommendations need Studio’s assistant connection.";
  }
  function saveMediaMenu() {
    try { localStorage.setItem(MEDIA_UI_KEY, JSON.stringify(mediaMenu)); } catch {}
  }
  function renderClipboardOffer() {
    if (!els.clipboardOffer) return;
    els.clipboardOffer.hidden = !clipboardOffer;
    els.clipboardTitle.textContent = clipboardOffer ? `Copied link · ${clipboardOffer.label}` : "";
    els.clipboardUrl.textContent = clipboardOffer?.url || "";
    els.clipboardUrl.hidden = !mediaMenu.showLinks;
    scheduleDropdown();
  }
  function useClipboardOffer(action) {
    if (!clipboardOffer) return;
    const url = clipboardOffer.url;
    if (action === "dismiss" || (action === "play" ? playLink(url) : queueLink(url, null, action === "next"))) {
      clipboardOffer = null; renderClipboardOffer();
    }
  }
  function stopClipboardChecks() {
    if (clipboardTimer) window.clearInterval(clipboardTimer);
    clipboardTimer = 0; clipboardGeneration++;
  }
  async function checkClipboardLink() {
    if (clipboardBusy || !mediaMenu.copiedLinks || els.dropdown?.hidden !== false || document.body.classList.contains("command-zen") || document.visibilityState === "hidden" || document.hasFocus?.() === false || !window.mefiStudio?.mediaClipboardLink) return;
    clipboardBusy = true;
    const generation = clipboardGeneration;
    try {
      const result = await window.mefiStudio.mediaClipboardLink();
      if (generation !== clipboardGeneration || !result?.ok || els.dropdown.hidden || !mediaMenu.copiedLinks) return;
      const link = typeof result.url === "string" && result.url.length <= 8192 ? playableLink(mediaLink(result.url)) : null;
      const url = link?.url || "";
      const available = url && url !== state.link?.url && !linkQueue.some(item => item.url === url);
      if (url === lastClipboardUrl) {
        if (!available && clipboardOffer) { clipboardOffer = null; renderClipboardOffer(); }
        return;
      }
      lastClipboardUrl = url;
      clipboardOffer = available ? link : null;
      renderClipboardOffer();
    } catch { /* Clipboard unavailability leaves manual paste available. */ }
    finally { clipboardBusy = false; }
  }
  function startClipboardChecks() {
    stopClipboardChecks();
    if (!mediaMenu.copiedLinks || !window.mefiStudio?.mediaClipboardLink) return;
    void checkClipboardLink();
    clipboardTimer = window.setInterval(checkClipboardLink, 2000);
  }
  function renderMediaMenu() {
    els.showLinks?.setAttribute("aria-pressed", String(mediaMenu.showLinks));
    if (els.linkInput) els.linkInput.type = mediaMenu.showLinks ? "text" : "password";
    if (els.copiedLinks) els.copiedLinks.checked = mediaMenu.copiedLinks;
    if (els.playlistsSwitch) { els.playlistsSwitch.checked = mediaMenu.playlists; els.playlistsSwitch.parentElement.hidden = !playlistsHook; }
    // A Browse card's Save stays drawn; the switch hides it (music.css).
    if (els.dropdown) els.dropdown.dataset.playlists = String(playlistsOn());
    renderLinks(); renderLinkQueue(); renderClipboardOffer();
  }
  function renderLinks() {
    if (!els.recent) return;
    els.recent.textContent = "";
    els.recentHead.hidden = !prefs.links.length;
    for (const url of prefs.links) {
      const item = mediaLink(url);
      if (!item) continue;
      const recent = button(mediaMenu.showLinks ? `${item.providerName} ${item.short}` : `${item.providerName} · Recent ${els.recent.children.length + 1}`, "ghost music-recent-link", els.recent, () => playLink(url));
      recent.title = mediaMenu.showLinks ? url : "";
      recent.dataset.provider = item.provider;
      if (state.source === "link" && state.link?.url === url) recent.setAttribute("aria-current", "true");
    }
    const handoff = state.handoff;
    els.linkHandoff.hidden = !handoff;
    els.linkHandoff.textContent = "";
    if (handoff) {
      element("strong", null, handoff.label, els.linkHandoff);
      element("p", null, handoffNote(handoff), els.linkHandoff);
      button("Browse here", "ghost", els.linkHandoff, () => void openMediaBrowser(handoff.url), "music-link-handoff-browser");
      const open = button(handoff.jam ? "Open the Jam in Spotify ↗" : `Open in ${handoff.provider === "web" ? "your browser" : handoff.providerName} ↗`, "primary", els.linkHandoff, () => openLink(handoff.url), "music-link-handoff-open");
      open.title = mediaMenu.showLinks ? handoff.url : "";
      if (handoff.jam) element("small", null, "Tip: choose Desktop audio under Listen to and the node tree follows the Jam.", els.linkHandoff);
    }
    renderLinkNow();
  }
  // The stage and the player's own buttons: where the loaded video is, and
  // the ways to move it (behind the workspace, out of the menu, closed).
  function renderLinkNow() {
    if (!els.linkStage) return;
    const shown = shownSource() === "link";
    const link = state.source === "link" ? state.link : null;
    const browser = state.source === "link" && els.browser?.active ? els.browser.state : null;
    const placement = els.mediaPlacement || {};
    const loaded = Boolean(link || browser);
    const shape = browser ? "browser" : link?.shape || "video";
    els.linkStage.dataset.shape = shape;
    els.dropdown.dataset.shape = shown && loaded ? shape : "none";
    els.linkStage.dataset.mode = placement.background ? "background" : placement.minimized ? "minimized" : "player";
    els.linkStage.hidden = !shown || !loaded;
    setText(els.stageTitle, placement.background ? "Playing behind your workspace" : placement.minimized ? "The player is minimized" : "The player is out on its own");
    setText(els.stageAction, placement.background ? "Bring it back" : "Show player");
    const candidate = browser ? mediaLink(browser.url) : link;
    els.backgroundToggle.disabled = !playableLink(candidate) || candidate.shape === "audio";
    setAttr(els.backgroundToggle, "aria-pressed", String(Boolean(placement.background)));
    const backdrop = placement.background ? "Bring the video back from behind your workspace" : "Play behind your workspace";
    setAttr(els.backgroundToggle, "aria-label", backdrop); els.backgroundToggle.title = backdrop;
    els.nowActions.hidden = !shown || !loaded;
    els.saveNow.hidden = !playlistsOn() || !playingItem();
    els.linkTools.hidden = !shown || !loaded;
    els.browseLink.hidden = Boolean(browser);
    els.pictureEmpty.hidden = loaded && !browser;
    scheduleDropdown();
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
    for (const [id, node] of Object.entries(els.stationButtons || {})) {
      const current = state.source === "radio" && id === state.station;
      node.setAttribute("aria-pressed", String(current));
      node.dataset.state = current ? phase : "off";
    }
    // The card says the same thing (Live radio, Holding the sound…, Station
    // unavailable): a phase change repaints it too, not only the panel.
    scheduleNow();
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
    renderQuick(status);
    scheduleDropdown();
  }
  function audioLinkEnabled(status) {
    return Boolean(status?.reactive && (status.listening || status.pending || status.selection === "local" && !status.error));
  }
  // The card's tree switches mirror the Tree section and the node effects;
  // a reaction switch stays dim while the tree is not listening.
  function renderQuick(status = window.MefiIdle?.audioStatus?.()) {
    if (!els.quick) return;
    const idle = window.MefiIdle;
    const listening = audioLinkEnabled(status);
    for (const [key] of QUICK_TOGGLES) {
      const chip = els.quick[key];
      const tree = key === "orbitTrails" || key === "extraGlow";
      const on = key === "react" ? listening : tree ? prefs[key] : status?.effects?.[key] ?? AUDIO_EFFECTS[key].enabled;
      setAttr(chip, "aria-pressed", String(Boolean(on)));
      chip.disabled = key === "react" ? !idle?.setMusicReactive : !tree && !idle?.setAudioEffects;
      chip.dataset.idle = String(!tree && key !== "react" && !listening);
    }
    setText(els.quickState, listening ? status?.label || "Listening" : "The tree is not listening");
  }
  function quickToggle(key) {
    if (key === "orbitTrails" || key === "extraGlow") { applyNodeEffects({ [key]: !prefs[key] }); return; }
    const status = window.MefiIdle?.audioStatus?.();
    if (key === "react") window.MefiIdle?.setMusicReactive?.(!audioLinkEnabled(status));
    else window.MefiIdle?.setAudioEffects?.({ [key]: !(status?.effects?.[key] ?? AUDIO_EFFECTS[key].enabled) });
    renderAudioLink();
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
    const title = element("h2", null, "Canvas preview", heading); title.id = "music-heading";
    button("Close", "ghost", header, close, "music-close");
    const body = element("div", "music-body", null, sheet);
    els.body = body;
    // Appearance owns only the color theme and node tree. The players stay
    // mounted in their own dropdown, including while this preview is open.
    const settings = element("div", "music-settings", null, body);
    settings.id = "music-look"; settings.setAttribute("role", "region"); settings.setAttribute("aria-labelledby", "music-look-label");
    const lookLabel = element("p", "eyebrow music-group-label", "Look", settings); lookLabel.id = "music-look-label"; lookLabel.tabIndex = -1;
    const themeSection = element("section", "music-section music-colors", null, settings);
    themeSection.dataset.appearancePanel = "themes";
    element("h3", null, "Color theme", themeSection);
    els.themes = element("div", "music-themes", null, themeSection);
    els.themes.setAttribute("role", "group"); els.themes.setAttribute("aria-label", "Color theme");
    for (const [key, palette] of [...Object.entries(THEMES).filter(([key]) => !isVoidTheme(key) && !isLightTheme(key)), ["custom", { name: "Custom palette", bright: prefs.customColors.accent }]]) {
      const choice = button(palette.name, "music-theme", els.themes, () => applyTheme(key));
      choice.dataset.theme = key; choice.style.setProperty("--swatch", palette.bright); choice.setAttribute("aria-pressed", String(prefs.theme === key));
    }
    els.customPalette = element("fieldset", "music-custom-palette", null, themeSection); els.customPalette.id = "music-custom-palette";
    element("legend", null, "Your colors", els.customPalette);
    const help = element("p", "music-fineprint", "Changing a color applies your custom palette. Choose a color or enter #RRGGBB; Studio adjusts text and borders for readability.", els.customPalette); help.id = "music-custom-help";
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
    els.lightThemes = lightThemeChoices(themeSection);
    els.voidThemes = voidThemeChoices(themeSection);
    els.fonts = fontChoices(themeSection);
    element("p", "music-fineprint", "Colors are separate from node style and layout.", themeSection);
    const nodeSection = element("section", "music-node-settings", null, settings);
    nodeSection.dataset.appearancePanel = "nodes";
    nodeSection.setAttribute("aria-labelledby", "music-node-heading");
    const nodeHeading = element("h3", null, "Node tree", nodeSection); nodeHeading.id = "music-node-heading";
    element("p", "music-node-intro", "Give your work a different shape. Changes appear on the live tree.", nodeSection);
    els.nodeStyles = graphChoices(nodeSection, "style", Object.fromEntries(Object.entries(NODE_STYLES).filter(([key]) => !isVoidNodeStyle(key) && !isShopNodeStyle(key))), worn, applyNodeStyle);
    els.voidStyles = graphChoices(nodeSection, "style", Object.fromEntries(Object.entries(NODE_STYLES).filter(([key]) => isVoidNodeStyle(key))), worn, applyNodeStyle, { label: "Void collection", id: "music-void-style" });
    els.shopStyles = graphChoices(nodeSection, "style", Object.fromEntries(Object.entries(NODE_STYLES).filter(([key]) => isShopNodeStyle(key))), worn, applyNodeStyle, { label: "From the Shop", id: "music-shop-style" });
    els.shopLine = element("p", "music-fineprint music-shop-line", "Get these in the Shop for credits you earn. Try shows one on this tree for two minutes first.", nodeSection);
    els.shopLine.id = "music-shop-line";
    button("Open the Shop", "ghost music-shop-open", els.shopLine, () => { if (typeof window.MefiShop?.open === "function") window.MefiShop.open("studio"); else window.MefiNav?.go?.("friends-page", { place: "shop" }); }, "music-shop-open");
    paintShopStyles();
    const layoutSection = element("section", "music-section", null, settings);
    layoutSection.dataset.appearancePanel = "layout";
    element("h3", null, "Arrange the tree", layoutSection);
    els.nodeLayouts = graphChoices(layoutSection, "layout", NODE_LAYOUTS, prefs.nodeLayout, applyNodeLayout);
    const layoutHint = element("p", "music-fineprint", "Choosing a layout rearranges the tree. Existing nodes keep their places as work updates.", layoutSection);
    layoutHint.id = "music-node-layout-hint";
    els.nodeLayouts.setAttribute("aria-describedby", layoutHint.id);
    window.MefiTreeDynamics?.mount(layoutSection, "appearance");
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
    // The media menu: a mini player that unfolds. The header switches source;
    // the card (#music-sound) holds the stage, the words, the transport and the
    // quick tree switches; the deck beside it shows one section at a time.
    const dropdown = element("section", "music-dropdown", null, document.body);
    els.dropdown = dropdown; dropdown.id = "music-dropdown"; dropdown.hidden = true; dropdown.tabIndex = -1;
    dropdown.dataset.size = "compact";
    dropdown.setAttribute("role", "dialog"); dropdown.setAttribute("aria-modal", "false"); dropdown.setAttribute("aria-labelledby", "music-dropdown-heading");
    // Typing in the menu (or with the pointer on it) goes to the box on show:
    // the search-or-link box, the AI mood (nav.js typeInto).
    dropdown.dataset.typeScope = "";
    const dropdownHeader = element("header", "music-dropdown-header", null, dropdown);
    els.dropdownHeader = dropdownHeader;
    const dropdownTitle = element("h2", "music-dropdown-title", "Music & video", dropdownHeader); dropdownTitle.id = "music-dropdown-heading";
    const tabs = element("div", "music-tabs", null, dropdownHeader); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Music source");
    const sourceTab = (source, label, icon, id, title) => {
      const tab = button(null, "music-tab", tabs, () => setSource(source), id);
      glyph(icon, tab); element("span", null, label, tab);
      tab.title = title; tab.setAttribute("role", "tab");
      return tab;
    };
    els.localTab = sourceTab("local", "Music", "music", "music-local-tab", "Your own audio files");
    els.radioTab = sourceTab("radio", "Radio", "radio", "music-radio-tab", "Ad-free radio stations");
    els.linkTab = sourceTab("link", "Video", "video", "music-link-tab", "YouTube, links and videos, or any website");
    const tabFor = (source) => source === "local" ? els.localTab : source === "radio" ? els.radioTab : els.linkTab;
    for (const [tab, panelId] of [[els.localTab, "music-local-panel"], [els.radioTab, "music-radio-panel"], [els.linkTab, "music-link-panel"]]) tab.setAttribute("aria-controls", panelId);
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const order = ["local", "radio", "link"];
      const index = Math.max(0, order.indexOf(settingsReveal.source ?? state.source));
      const source = event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1]
        : order[(index + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
      setSource(source); tabFor(source).focus();
    });
    els.expand = button(null, "ghost music-icon music-expand", dropdownHeader, () => { if (deckOpen) closeDeck(); else openSection(currentSection()); }, "music-dropdown-expand");
    glyph("expand", els.expand).dataset.glyph = "expand"; glyph("collapse", els.expand).dataset.glyph = "collapse";
    els.expand.setAttribute("aria-controls", "music-deck");
    iconButton("close", "Close", dropdownHeader, () => closeAudio({ focus: true }), "music-dropdown-close");
    els.clipboardOffer = element("section", "music-clipboard-offer", null, dropdownHeader); els.clipboardOffer.id = "music-clipboard-offer"; els.clipboardOffer.hidden = true;
    els.clipboardTitle = element("strong", null, "", els.clipboardOffer); els.clipboardTitle.setAttribute("role", "status");
    els.clipboardUrl = element("small", null, "", els.clipboardOffer);
    const clipboardActions = element("div", "music-link-tools", null, els.clipboardOffer);
    for (const [action, label] of [["play", "Play"], ["queue", "Add to queue"], ["next", "Queue next"], ["dismiss", "Dismiss"]]) button(label, "ghost mini", clipboardActions, () => useClipboardOffer(action), `music-clipboard-${action}`);
    const dropdownBody = element("div", "music-dropdown-body", null, dropdown);
    els.dropdownBody = dropdownBody;

    // ---- The card: what plays, and everything to steer it.
    const main = element("section", "music-main", null, dropdownBody);
    main.id = "music-sound"; main.setAttribute("aria-labelledby", "music-sound-label");
    els.nowColumn = main;
    const soundLabel = element("p", "eyebrow music-group-label", "Now playing", main); soundLabel.id = "music-sound-label"; soundLabel.tabIndex = -1;
    els.groups = { look: { group: settings, label: lookLabel }, sound: { group: main, label: soundLabel } };
    els.nowCard = element("div", "music-now-card", null, main);
    // The loaded video docks here (media-window.js carries it in); the note
    // underneath shows while it plays elsewhere.
    els.linkStage = element("div", "music-video-stage", null, els.nowCard); els.linkStage.id = "music-video-stage";
    const stageNote = element("div", "music-stage-note", null, els.linkStage);
    glyph("video", stageNote);
    els.stageTitle = element("strong", null, "", stageNote);
    els.stageAction = button("Show player", "ghost mini", stageNote, () => {
      if (els.mediaPlacement?.background) { els.floatingPlayer?.setBackground(false); renderLinkNow(); scheduleDropdown(); return; }
      mountLink(); els.floatingPlayer?.reveal(); scheduleDropdown();
    }, "music-link-show");
    const meta = element("div", "music-now-meta", null, els.nowCard);
    const art = element("div", "music-now-art", null, meta); art.setAttribute("aria-hidden", "true");
    element("span", "music-record", null, art);
    glyph("stations", art).classList.add("music-now-radio");
    els.nowThumb = element("img", "music-now-thumb", null, art); els.nowThumb.alt = ""; els.nowThumb.hidden = true; els.nowThumb.draggable = false;
    const words = element("div", "music-now-words", null, meta);
    els.nowKicker = element("span", "music-now-kicker", "", words);
    els.nowTitle = element("strong", "music-now-title", "", words);
    els.nowDetail = element("small", "music-now-detail", "", words);
    const actions = element("div", "music-now-actions", null, meta);
    els.nowActions = actions;
    els.saveNow = iconButton("save", "Save to a playlist", actions, () => {
      const item = playingItem();
      if (item) playlistsHook?.save?.(els.saveNow, item);
    }, "music-video-save");
    els.saveNow.hidden = true;
    els.backgroundToggle = iconButton("backdrop", "Play behind your workspace", actions, () => {
      const browsing = els.browser?.active;
      if (browsing && !playLink(els.browser.state.url)) return;
      els.floatingPlayer?.setBackground(browsing || !els.mediaPlacement?.background);
      renderLinkNow(); scheduleDropdown();
    }, "music-video-background");
    els.floatPlayer = iconButton("popout", "Pop out the player", actions, () => {
      els.floatingPlayer?.setBackground(false);
      closeAudio();
      els.floatingPlayer?.reveal();
    }, "music-video-float");
    els.closePlayer = iconButton("close", "Close the video", actions, () => { unmountLink(); state.link = null; render(); announce(); }, "music-link-close");
    els.nowSeek = element("div", "music-now-seek", null, els.nowCard);
    els.elapsed = element("span", "music-now-time", "0:00", els.nowSeek);
    els.seek = element("input", "music-range", null, els.nowSeek); els.seek.id = "music-seek"; els.seek.type = "range"; els.seek.min = "0"; els.seek.step = ".1"; els.seek.setAttribute("aria-label", "Playback position");
    // A drag previews on YouTube (a few times a second) and settles on release.
    let seekPreviewAt = -Infinity;
    els.seek.addEventListener("input", () => {
      const embed = shownSource() === "link" && state.link && state.link.kind !== "media";
      if (embed && window.performance.now() - seekPreviewAt < 180) { els.seek.style.setProperty("--fill", `${Number(els.seek.value) / (Number(els.seek.max) || 1) * 100}%`); return; }
      seekPreviewAt = window.performance.now();
      seekTo(els.seek.value, !embed);
    });
    els.seek.addEventListener("change", () => seekTo(els.seek.value, true));
    els.duration = element("span", "music-now-time", "0:00", els.nowSeek);
    const transport = element("div", "music-transport", null, els.nowCard); transport.setAttribute("role", "group"); transport.setAttribute("aria-label", "Playback");
    els.previous = iconButton("previous", "Previous", transport, transportPrevious, "music-previous");
    els.play = button(null, "primary music-play", transport, transportToggle, "music-play");
    glyph("play", els.play).dataset.glyph = "play"; glyph("pause", els.play).dataset.glyph = "pause";
    els.next = iconButton("next", "Next", transport, transportNext, "music-next");
    const levels = element("div", "music-level", null, transport);
    els.mute = button(null, "ghost music-icon music-mute", levels, transportMute, "music-mute");
    glyph("volume", els.mute).dataset.glyph = "volume"; glyph("muted", els.mute).dataset.glyph = "muted";
    els.volume = element("input", "music-range music-volume-range", null, levels); els.volume.id = "music-volume";
    els.volume.type = "range"; els.volume.min = "0"; els.volume.max = "100"; els.volume.step = "1"; els.volume.setAttribute("aria-label", "Volume");
    els.volume.addEventListener("input", () => transportVolume(els.volume.value));
    // Quick tree switches: the audio link, its reactions and two node effects.
    const quick = element("section", "music-quick", null, main); quick.id = "music-quick"; quick.setAttribute("aria-labelledby", "music-quick-label");
    const quickHead = element("div", "music-quick-head", null, quick);
    element("span", null, "Tree visuals", quickHead).id = "music-quick-label";
    els.quickState = element("small", "music-quick-state", "", quickHead);
    button("All tree settings", "ghost mini music-quick-more", quickHead, () => openSection("tree"), "music-quick-settings");
    const quickGrid = element("div", "music-quick-grid", null, quick); quickGrid.setAttribute("role", "group"); quickGrid.setAttribute("aria-labelledby", "music-quick-label");
    els.quick = {};
    for (const [key, label, detail, icon] of QUICK_TOGGLES) {
      const chip = button(null, "music-quick-chip", quickGrid, () => quickToggle(key), `music-quick-${key}`);
      glyph(icon, chip); element("span", null, label, chip);
      chip.title = detail; chip.dataset.quick = key; chip.setAttribute("aria-pressed", "false");
      els.quick[key] = chip;
    }
    // One line of Up next under the card; the whole list shows unfolded.
    els.nextLine = button(null, "music-next-line", main, () => openSection("browse", { focus: false }), "music-next-line");
    element("span", "music-next-label", "Up next", els.nextLine);
    els.nextLineTitle = element("strong", null, "", els.nextLine);
    els.nextLineMore = element("small", null, "", els.nextLine);
    els.nextLine.hidden = true;
    const queue = element("section", "music-link-queue", null, main); queue.setAttribute("aria-label", "Video queue");
    els.linkQueueBox = queue;
    const queueHeader = element("div", "music-link-queue-header", null, queue);
    els.linkQueueHeading = element("h3", null, "Up next", queueHeader); els.linkQueueHeading.setAttribute("aria-live", "polite");
    els.linkQueueNext = button("Play next video", "ghost mini", queueHeader, () => playQueued(), "music-link-queue-next");
    els.linkQueueEmpty = element("p", "music-fineprint music-queue-empty", "Nothing lined up. Browse for a video, or drag a link here.", queue);
    els.linkQueueList = element("ol", "music-link-queue-list", null, queue); els.linkQueueList.id = "music-link-queue-list";
    bindQueueDrops(queue);
    const linkTools = element("div", "music-link-tools music-now-tools", null, main);
    els.linkTools = linkTools;
    button("Copy link", "ghost mini", linkTools, () => { const url = els.browser?.active ? els.browser.state.url : state.link?.url; if (url) copyLink(url); }, "music-link-copy").title = "Copy the link to share it in Discord";
    button("Open in browser ↗", "ghost mini", linkTools, () => { const url = els.browser?.active ? els.browser.state.url : state.link?.url; if (url) openLink(url); }, "music-link-open").title = "Open the original page in your regular browser";
    els.browseLink = button("Its page, here", "ghost mini", linkTools, () => state.link && void openMediaBrowser(state.link.url), "music-link-popout");
    els.browseLink.title = "Open the original site in the built-in browser";
    els.sourcePreview = element("p", "music-fineprint", null, main); els.sourcePreview.id = "music-source-preview"; els.sourcePreview.hidden = true; els.sourcePreview.setAttribute("role", "status");
    els.notice = element("p", "music-notice", "", main); els.notice.setAttribute("role", "status");
    // A video dropped on the card plays now.
    els.nowCard.addEventListener("dragover", (event) => {
      if (!dragTypes(event).includes(DRAG_MEDIA)) return;
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      els.nowCard.dataset.drop = "true";
    });
    els.nowCard.addEventListener("dragleave", (event) => { if (!els.nowCard.contains(event.relatedTarget)) delete els.nowCard.dataset.drop; });
    els.nowCard.addEventListener("drop", (event) => {
      delete els.nowCard.dataset.drop;
      if (!dragTypes(event).includes(DRAG_MEDIA)) return;
      const media = draggedMedia(event);
      if (!media) return;
      event.preventDefault(); event.stopPropagation?.();
      const from = Number.parseInt(event.dataTransfer?.getData?.(DRAG_QUEUE) ?? "", 10);
      if (Number.isInteger(from) && linkQueue[from]?.url === media.url) playQueued(from);
      else playLink(media.url, { label: media.title, keepField: true });
    });

    // ---- The sections: chips under the card, tabs over the deck unfolded.
    els.sections = element("div", "music-sections", null, dropdownBody); els.sections.setAttribute("role", "tablist"); els.sections.setAttribute("aria-label", "More controls");
    els.sections.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabsNow = Array.from(els.sections.children);
      const at = tabsNow.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabsNow.length - 1 : (at + (event.key === "ArrowRight" ? 1 : -1) + tabsNow.length) % tabsNow.length;
      tabsNow[next].focus();
    });
    els.deck = element("section", "music-deck", null, dropdownBody); els.deck.id = "music-deck"; els.deck.hidden = true; els.deck.setAttribute("aria-label", "More controls");

    // Tracks (local).
    els.local = element("section", "music-local", null, els.deck); els.local.id = "music-local-panel"; els.local.setAttribute("role", "tabpanel"); els.local.setAttribute("aria-labelledby", "music-local-tab");
    const queueHead = element("div", "music-queue-heading", null, els.local);
    element("h3", null, "Your tracks", queueHead); els.queueCount = element("span", "music-count", "0", queueHead);
    button("Add audio files", "ghost mini", queueHead, () => els.files.click(), "music-add-files");
    els.files = element("input", null, null, queueHead); els.files.id = "music-files"; els.files.type = "file"; els.files.multiple = true; els.files.accept = "audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.webm"; els.files.hidden = true;
    els.files.addEventListener("change", () => { addFiles(els.files.files); els.files.value = ""; });
    els.queue = element("ol", "music-queue", null, els.local); els.queue.id = "music-queue";
    element("p", "music-fineprint", "Drop audio files here. Local playback needs no account; reselect your files after restarting Studio.", els.local);
    els.local.addEventListener("dragover", (event) => { event.preventDefault(); els.local.classList.add("drag-over"); });
    els.local.addEventListener("dragleave", () => els.local.classList.remove("drag-over"));
    els.local.addEventListener("drop", (event) => { event.preventDefault(); els.local.classList.remove("drag-over"); addFiles(event.dataTransfer?.files); });

    // Stations (radio).
    els.radio = element("section", "music-radio", null, els.deck); els.radio.id = "music-radio-panel"; els.radio.setAttribute("role", "tabpanel"); els.radio.setAttribute("aria-labelledby", "music-radio-tab");
    const radioHead = element("div", "music-queue-heading", null, els.radio);
    element("h3", null, "Ad-free radio", radioHead);
    els.radioStop = button("Stop radio", "ghost mini", radioHead, () => { stopRadio(); render(); announce(); }, "music-radio-stop");
    els.radioStop.disabled = true;
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
    element("p", "music-fineprint", "Listener-funded stations with no advertising, through Studio’s own player, so the node tree reacts to them. If a stream stops, the next mirror crosses in on a second deck.", els.radio);

    // Browse and Picture (video & links).
    els.link = element("section", "music-link", null, els.deck); els.link.id = "music-link-panel"; els.link.setAttribute("role", "tabpanel"); els.link.setAttribute("aria-labelledby", "music-link-tab");
    els.linkBrowse = element("div", "music-browse", null, els.link); els.linkBrowse.dataset.deckSection = "browse";
    // Typing on Browse goes to its box (nav.js typeInto: [data-type-here]).
    els.linkBrowse.dataset.typeScope = "";
    const linkForm = element("form", "music-link-form music-find", null, els.linkBrowse);
    glyph("find", linkForm);
    els.linkInput = element("input", null, null, linkForm); els.linkInput.id = "music-link-url"; els.linkInput.type = "text"; els.linkInput.placeholder = "Search YouTube, or paste a link";
    els.linkInput.setAttribute("aria-label", "Search YouTube or paste a media link"); els.linkInput.dataset.typeHere = "";
    els.linkInput.autocomplete = "off"; els.linkInput.spellcheck = false; els.linkInput.maxLength = 8192;
    // Words search YouTube; a link (with or without https://) plays.
    // A shared playlist (its text, or a YouTube watch_videos link) opens in
    // Playlists, ready to save.
    const findOrPlay = () => { const value = els.linkInput.value.trim(); if (!value) { els.linkInput.focus(); return; } if (playlistsOn() && playlistsHook.offer?.(value)) { els.linkInput.value = ""; return; } if (mediaLink(value)) playLink(value); else void searchYouTube(value); };
    button("Go", "primary", linkForm, findOrPlay, "music-link-load");
    linkForm.addEventListener("submit", (event) => { event.preventDefault(); findOrPlay(); });
    const queueTools = element("div", "music-link-tools", null, els.linkBrowse);
    // A link queued from the box leaves the box ready for the next one.
    const queueFromBox = (next) => { if (queueLink(els.linkInput.value, null, next)) { els.linkInput.value = ""; els.linkInput.focus?.({ preventScroll: true }); } };
    button("Add to queue", "ghost mini", queueTools, () => queueFromBox(false), "music-link-queue-add");
    button("Play next", "ghost mini", queueTools, () => queueFromBox(true), "music-link-queue-first");
    button("Open as a website", "ghost mini", queueTools, () => void openMediaBrowser(els.linkInput.value.trim()), "music-link-browser");
    els.linkHandoff = element("div", "music-link-handoff", null, els.linkBrowse); els.linkHandoff.id = "music-link-handoff"; els.linkHandoff.hidden = true;
    const feedHead = element("div", "music-feed-head", null, els.linkBrowse);
    els.feedTitle = element("h3", null, "YouTube", feedHead);
    els.youtubeNotice = element("p", "music-fineprint music-feed-note", "Search above, or start from an idea. Click a video to add it; drag it onto Up next to place it.", els.linkBrowse); els.youtubeNotice.setAttribute("role", "status");
    els.feedIdeas = element("div", "music-feed-ideas", null, els.linkBrowse); els.feedIdeas.setAttribute("aria-label", "Ideas");
    els.youtubeResults = element("div", "music-youtube-results", null, els.linkBrowse); els.youtubeResults.id = "music-youtube-results";
    els.feedEnd = element("div", "music-feed-end", "Loading more…", els.linkBrowse); els.feedEnd.hidden = true;
    const recentHead = element("h4", "music-node-label", "Recent", els.linkBrowse);
    els.recent = element("div", "music-recent", null, els.linkBrowse); els.recent.setAttribute("aria-label", "Recent links");
    els.recentHead = recentHead;
    const browserCard = element("div", "music-browser-card", null, els.linkBrowse);
    const browserCopy = element("div", "music-browser-copy", null, browserCard);
    element("strong", null, "Need the whole website?", browserCopy);
    element("span", null, "Open any page inside Studio’s player.", browserCopy);
    button("Browse a website", "ghost mini", browserCard, () => void openMediaBrowser(), "music-browser-launch");
    els.linkPicture = element("div", "music-picture", null, els.link); els.linkPicture.dataset.deckSection = "picture";
    const pictureHead = element("h3", null, "Picture", els.linkPicture);
    pictureHead.id = "music-picture-heading";
    els.pictureEmpty = element("p", "music-fineprint", "Play a video to set its picture: background, transparency and brightness.", els.linkPicture);
    const videoSettings = element("div", "music-video-settings", null, els.linkPicture);
    element("p", "music-fineprint", "Background and Transparency put the video behind your work. Keep tree in dark areas waits for a darker area, then glides slowly. Fade on finish dims the video and tells you when a task completes.", els.linkPicture);
    els.linkPlayer = element("div", "music-link-player", null, els.link);
    // The player's own bar carries a small transport too (media-window.js).
    const floatBar = element("div", "media-window-transport", null, null);
    els.floatPrevious = iconButton("previous", "Previous", floatBar, transportPrevious, "media-window-previous");
    els.floatPlay = button(null, "music-icon media-window-play", floatBar, transportToggle, "media-window-play");
    glyph("play", els.floatPlay).dataset.glyph = "play"; glyph("pause", els.floatPlay).dataset.glyph = "pause";
    els.floatNext = iconButton("next", "Next", floatBar, transportNext, "media-window-next");
    els.floatMute = button(null, "music-icon media-window-mute", floatBar, transportMute, "media-window-mute");
    glyph("volume", els.floatMute).dataset.glyph = "volume"; glyph("muted", els.floatMute).dataset.glyph = "muted";
    els.floatVolume = element("input", "music-range", null, floatBar); els.floatVolume.id = "media-window-volume";
    els.floatVolume.type = "range"; els.floatVolume.min = "0"; els.floatVolume.max = "100"; els.floatVolume.step = "1"; els.floatVolume.setAttribute("aria-label", "Volume");
    els.floatVolume.addEventListener("input", () => transportVolume(els.floatVolume.value));
    els.floatingPlayer = window.MefiMediaWindow?.create({
      content: els.linkPlayer,
      settingsHost: videoSettings,
      transport: floatBar,
      onPlacement: placement => { els.mediaPlacement = placement; renderLinkNow(); renderNow(); scheduleDropdown(); },
      onSettings: () => open("sound"),
      onClose: () => { unmountLink(); state.link = null; render(); announce(); },
    });
    els.browser = window.MefiMediaBrowser?.create({
      host: els.linkPlayer,
      onMove: event => els.floatingPlayer?.beginMove(event),
      onMoveKey: event => els.floatingPlayer?.moveKey(event),
      onMinimize: () => els.floatingPlayer?.minimize(),
      onClose: () => { unmountLink(); state.link = null; render(); announce(); },
      onChange: () => { renderLinkNow(); renderNow(); },
    });
    els.link.addEventListener("dragover", (event) => {
      const types = dragTypes(event);
      // A card or a row dragged inside the menu is placed by its drop target.
      if (types.includes(DRAG_MEDIA) || (!types.includes("text/uri-list") && !types.includes("text/plain"))) return;
      event.preventDefault(); els.link.classList.add("drag-over");
    });
    els.link.addEventListener("dragleave", () => els.link.classList.remove("drag-over"));
    els.link.addEventListener("drop", (event) => {
      els.link.classList.remove("drag-over");
      if (dragTypes(event).includes(DRAG_MEDIA)) return;
      const text = droppedLink(event.dataTransfer);
      if (!text) return;
      event.preventDefault();
      playLink(text);
    });

    // Playlists: renderer/playlists.js draws it (MefiMusic.playlists).
    els.playlists = element("section", "music-playlists", null, els.deck); els.playlists.id = "music-playlists"; els.playlists.hidden = true;
    els.playlists.setAttribute("aria-label", "Playlists");

    // Tree: what the node tree listens to and how it moves.
    const audioLink = element("section", "music-audio-link", null, els.deck);
    els.audioLink = audioLink;
    audioLink.id = "music-audio-reactions";
    audioLink.setAttribute("aria-labelledby", "music-audio-heading");
    const audioHeading = element("h3", null, "Tree reactions", audioLink); audioHeading.id = "music-audio-heading";
    const connection = element("div", "music-connection", null, audioLink);
    const audioControls = element("div", "music-audio-controls", null, connection);
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
    els.audioState = element("p", "music-audio-state", "Audio link off", connection); els.audioState.id = "music-audio-state"; els.audioState.setAttribute("role", "status");
    els.audioHint = element("p", "music-fineprint", "", connection); els.audioHint.id = "music-audio-hint";
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
    window.MefiTreeDynamics?.mount(audioLink, "audio");

    // More: recommendations, sharing and the menu's own switches.
    els.more = element("section", "music-more", null, els.deck); els.more.id = "music-more";
    element("h3", null, "More", els.more);
    // renderer/together.js fills this with Listen together and the
    // now-playing share (both need the rooms hub).
    els.together = element("section", "music-together", null, els.more); els.together.hidden = true;
    const aside = element("section", "music-side", null, els.more);
    els.recommendations = aside;
    element("h4", "music-node-label", "Music ideas", aside);
    const ai = element("section", "music-section music-ai", null, aside);
    const moodLabel = element("label", "music-mood-label", "What are you in the mood for?", ai);
    els.mood = element("textarea", null, null, moodLabel); els.mood.id = "music-mood"; els.mood.rows = 3; els.mood.maxLength = 600; els.mood.placeholder = "Warm ambient, no vocals, a little energy…";
    els.recommend = button("Ask for recommendations", "ghost", ai, () => void recommend(), "music-recommend");
    els.aiHint = element("p", "music-fineprint", null, ai);
    els.recommendation = element("div", "music-recommendation", "", ai); els.recommendation.id = "music-recommendation"; els.recommendation.setAttribute("aria-live", "polite");
    const menuSwitches = element("div", "music-menu-switches", null, els.more);
    element("h4", "music-node-label", "This menu", menuSwitches);
    const copiedLinksLabel = element("label", "music-clipboard-toggle", null, menuSwitches);
    els.copiedLinks = element("input", null, null, copiedLinksLabel); els.copiedLinks.id = "music-copied-links"; els.copiedLinks.type = "checkbox";
    element("span", null, "Offer media links I copy", copiedLinksLabel);
    els.copiedLinks.addEventListener("change", () => {
      mediaMenu.copiedLinks = els.copiedLinks.checked; saveMediaMenu();
      clipboardOffer = null; renderClipboardOffer();
      if (mediaMenu.copiedLinks) { lastClipboardUrl = null; startClipboardChecks(); } else stopClipboardChecks();
    });
    const playlistsLabel = element("label", "music-clipboard-toggle", null, menuSwitches);
    els.playlistsSwitch = element("input", null, null, playlistsLabel); els.playlistsSwitch.id = "music-playlists-switch"; els.playlistsSwitch.type = "checkbox";
    element("span", null, "Playlists in this menu", playlistsLabel);
    playlistsLabel.hidden = true;
    els.playlistsSwitch.addEventListener("change", () => {
      mediaMenu.playlists = els.playlistsSwitch.checked; saveMediaMenu();
      if (!mediaMenu.playlists) playlistsHook?.dismiss?.();
      render(); renderMediaMenu();
    });
    els.showLinks = button("Show links", "ghost mini", menuSwitches, () => { mediaMenu.showLinks = !mediaMenu.showLinks; saveMediaMenu(); renderMediaMenu(); }, "music-show-links");
    els.showLinks.title = "Show or hide URLs in this menu (queue, recent and copied links)";
    element("p", "music-fineprint", "Embedded players keep their service’s sign-in, ads and availability rules. YouTube and Vimeo pick up where they were if Studio reopens within ten minutes. Set Listen to to Desktop audio and the tree follows them.", els.more);

    dropdown.addEventListener("keydown", audioKey);
    if (typeof ResizeObserver === "function") new ResizeObserver(scheduleDropdown).observe(dropdownHeader);
    dropdown.addEventListener("pointerenter", cancelAudioHoverTimers);
    dropdown.addEventListener("pointerleave", leaveAudioHover);
    dropdown.addEventListener("pointerdown", pinAudioDropdown);
    dropdown.addEventListener("focusin", pinAudioDropdown);
    dropdown.addEventListener("focusout", (event) => {
      if (!watchHost && event.relatedTarget && !dropdown.contains(event.relatedTarget) && !mediaPlayerContains(event.relatedTarget) && !dropdownAnchor?.contains(event.relatedTarget) && !audioSelectContains(event.relatedTarget)) closeAudio();
    });
    // Embedded pages do not bubble pointer/focus events to Studio. Once the
    // pointer enters the player, keep its menu in place until dismissed.
    const playerSurface = document.getElementById("media-window") || els.linkPlayer;
    for (const event of ["pointerenter", "pointerdown", "focusin"]) playerSurface.addEventListener(event, pinAudioDropdown);
    playerSurface.addEventListener("pointerleave", leaveAudioHover);
    renderLinkQueue();
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
  }
  // The menu hangs under its opener (or over it near the window's foot);
  // its height follows what it shows, up to the room the window has.
  function positionDropdown() {
    dropdownFrame = 0;
    if (els.dropdown?.hidden !== false) return;
    if (watchHost) { placePlayer(); return; }
    const edge = 12;
    const width = window.innerWidth || 1024;
    // Layout v2 keeps the menu inside the free area (nav.js usable()); v1 is the window.
    const area = window.MefiNav?.layout?.on?.() ? window.MefiNav.usable() : null;
    const height = area ? area.bottom : window.innerHeight || 768;
    const roof = area ? area.top : 0;
    const anchor = dropdownAnchor?.getBoundingClientRect?.();
    const bottom = anchor?.height ? anchor.bottom : 64;
    const above = anchor?.height ? Math.max(0, anchor.top - 8 - edge - roof) : 0;
    const below = height - bottom - 8 - edge;
    const flip = below < 280 && above > below && above >= 240;
    const top = flip ? roof + edge : Math.max(roof + edge, Math.min(bottom + 8, height - 280));
    const panelWidth = els.dropdown.getBoundingClientRect().width;
    const right = anchor?.width ? width - anchor.right : edge;
    const style = els.dropdown.style;
    const put = (key, value) => { if (style[key] !== value) style[key] = value; };
    put("top", `${Math.round(top)}px`);
    put("right", `${Math.round(Math.max(area ? width - area.right + edge : edge, Math.min(right, width - panelWidth - (area ? area.left : 0) - edge)))}px`);
    put("maxHeight", `${Math.max(0, flip ? above : height - top - edge)}px`);
    placePlayer();
  }
  // While the menu shows the loaded video, the video sits in the card's
  // stage (carried there, never reloaded); otherwise it floats beside it.
  function placePlayer() {
    const player = els.floatingPlayer;
    if (!player) return;
    const open = els.dropdown?.hidden === false;
    const loaded = state.source === "link" && Boolean(state.link || els.browser?.active);
    const wanted = open && loaded && shownSource() === "link" && !els.mediaPlacement?.background && !els.linkStage.hidden;
    const docked = wanted ? player.dock(els.linkStage) : (player.dock(null), false);
    if (els.linkStage.dataset.docked !== String(Boolean(docked))) { els.linkStage.dataset.docked = String(Boolean(docked)); renderNow(); }
    // A website is a native view the page cannot clip: cut it to the part
    // of the stage its scroller shows. A video iframe needs nothing.
    if (docked && els.browser?.active) {
      const stage = els.linkStage.getBoundingClientRect();
      const scroller = (getComputedStyle(els.nowColumn).overflowY === "visible" ? els.dropdownBody : els.nowColumn).getBoundingClientRect();
      player.clip?.([Math.max(0, scroller.top - stage.top), Math.max(0, stage.right - scroller.right), Math.max(0, stage.bottom - scroller.bottom), Math.max(0, scroller.left - stage.left)]);
    } else player.clip?.(null);
    player.avoid?.(open && !docked ? els.dropdown.getBoundingClientRect() : null);
  }
  function scheduleDropdown() {
    if (els.dropdown?.hidden !== false || dropdownFrame) return;
    if (typeof window.requestAnimationFrame === "function") dropdownFrame = window.requestAnimationFrame(positionDropdown);
    else positionDropdown();
  }
  // The menu's own scrolling moves nothing but a docked website's clip.
  function pageScroll(event) {
    if (els.dropdown?.contains?.(event?.target) && !els.browser?.active) return;
    scheduleDropdown();
  }
  function audioOutside(event) {
    if (watchHost) return;
    if (!els.dropdown?.contains(event.target) && !mediaPlayerContains(event.target) && !dropdownAnchor?.contains(event.target) && !audioSelectContains(event.target)) closeAudio();
  }
  function mediaPlayerContains(target) {
    return document.getElementById("media-window")?.contains(target) || els.linkPlayer?.contains(target);
  }
  function audioSelectContains(target) {
    return window.MefiSelect?.owns?.(els.dropdown) && window.MefiSelect?.contains?.(target);
  }
  function audioKey(event) {
    if (event.key === "Escape" && els.dropdown?.hidden === false) {
      const top = window.MefiNav?.top?.();
      if (watchHost && top && top !== "watch") return;
      // An open Save to a playlist list closes first.
      if (playlistsHook?.dismiss?.()) { event.preventDefault(); event.stopPropagation(); return; }
      if (window.MefiSelect?.owns?.(els.dropdown)) {
        event.preventDefault(); event.stopPropagation(); window.MefiSelect.close(true); return;
      }
      event.preventDefault(); event.stopPropagation(); closeAudio({ focus: !dropdownHover });
    }
  }
  function cancelAudioHoverTimers() {
    window.clearTimeout(dropdownOpenTimer); window.clearTimeout(dropdownCloseTimer);
    dropdownOpenTimer = 0; dropdownCloseTimer = 0;
  }
  function pinAudioDropdown() {
    cancelAudioHoverTimers();
    dropdownHover = false;
  }
  function leaveAudioHover() {
    cancelAudioHoverTimers();
    if (dropdownHover) dropdownCloseTimer = window.setTimeout(() => closeAudio(), 450);
  }
  function bindAudioHover(anchor) {
    if (!anchor) return;
    anchor.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      cancelAudioHoverTimers();
      if (els.dropdown?.hidden === false) return;
      dropdownOpenTimer = window.setTimeout(() => {
        dropdownOpenTimer = 0;
        if (!document.body.classList.contains("command-zen") && anchor.getBoundingClientRect().width > 0) openAudio(anchor, { hover: true });
      }, 200);
    });
    anchor.addEventListener("pointerleave", leaveAudioHover);
    // Touch and keyboard activation keep the existing click behavior.
    anchor.addEventListener("pointercancel", cancelAudioHoverTimers);
  }
  function openAudio(anchor, { hover = false } = {}) {
    init();
    cancelAudioHoverTimers();
    if (document.body.classList.contains("command-zen")) return;
    if (!els.dropdown.hidden) { if (!hover) { pinAudioDropdown(); els.dropdown.focus({ preventScroll: true }); } return; }
    if (state.opened) close();
    dropdownAnchor = anchor || document.getElementById?.("settings-audio-open");
    dropdownFocus = document.activeElement;
    // Native browser views receive their own mouse events, so Studio cannot
    // reliably tell a pointer entering the website from one leaving the menu.
    dropdownHover = hover && !els.browser?.active;
    dropdownAnchor?.setAttribute("aria-expanded", "true");
    // Typing on the card while a video source shows is a search: it opens
    // Browse with the caret in its box (nav.js typeInto).
    if (!typeScoped && window.MefiNav?.typeScope) {
      typeScoped = true;
      window.MefiNav.typeScope(els.dropdown, () => { if (shownSource() !== "link") return null; if (!deckOpen || currentSection() !== "browse") openSection("browse", { focus: false }); return els.linkInput; });
    }
    // Every visit starts as the mini player, at the top of the card.
    deckOpen = false;
    els.dropdown.hidden = false;
    mountLink(); render(); positionDropdown();
    startClipboardChecks();
    els.dropdownBody.scrollTop = 0; els.nowColumn.scrollTop = 0;
    scheduleDropdown();
    document.addEventListener("pointerdown", audioOutside);
    document.addEventListener("keydown", audioKey, true);
    window.addEventListener("scroll", pageScroll, true);
    if (!hover) els.dropdown.focus({ preventScroll: true });
  }
  function closeAudio({ focus = false, leavingWatch = false } = {}) {
    if (watchHost && !leavingWatch) { window.MefiNav?.close?.("watch"); return; }
    stopClipboardChecks();
    cancelAudioHoverTimers();
    dropdownHover = false;
    if (els.dropdown?.hidden !== false) return;
    if (window.MefiSelect?.owns?.(els.dropdown)) window.MefiSelect.close();
    els.dropdown.hidden = true;
    for (const running of els.dropdown.getAnimations?.() || []) if (running.id === "music-morph") running.cancel();
    els.floatingPlayer?.dock?.(null); els.floatingPlayer?.clip?.(null); els.floatingPlayer?.avoid?.(null);
    if (els.linkStage) els.linkStage.dataset.docked = "false";
    dropdownAnchor?.setAttribute("aria-expanded", "false");
    document.removeEventListener?.("pointerdown", audioOutside);
    document.removeEventListener?.("keydown", audioKey, true);
    window.removeEventListener?.("scroll", pageScroll, true);
    if (dropdownFrame) window.cancelAnimationFrame?.(dropdownFrame);
    dropdownFrame = 0;
    settingsReveal.source = null;
    deckOpen = false; renderDeck();
    if (focus) (dropdownAnchor || dropdownFocus)?.focus?.({ preventScroll: true });
    dropdownAnchor = null; dropdownFocus = null;
  }
  function toggleAudio(anchor) {
    if (watchHost) { openAudio(anchor); return; }
    if (els.dropdown?.hidden === false && dropdownHover) openAudio(anchor);
    else if (els.dropdown?.hidden === false) closeAudio({ focus: true });
    else openAudio(anchor);
  }

  function openWatch(host) {
    if (!host) return false;
    init();
    closeAudio({ leavingWatch: true });
    watchHost = host;
    host.append(els.dropdown);
    els.dropdown.dataset.watch = "true";
    els.dropdown.setAttribute("role", "region");
    openAudio();
    // Show videos without interrupting a radio station or local track.
    settingsReveal.source = "link";
    deckOpen = true; deckSection = "browse";
    render(); positionDropdown();
    return true;
  }
  function closeWatch() {
    if (!watchHost) return false;
    closeAudio({ leavingWatch: true });
    watchHost = null;
    delete els.dropdown.dataset.watch;
    els.dropdown.setAttribute("role", "dialog");
    document.body.append(els.dropdown);
    return true;
  }
  function updatePreview() {
    previewFrame = 0;
    if ((!state.opened && !settingsAppearance) || !window.MefiIdle?.setSettingsPreview) return;
    const rect = (settingsAppearance ? els.settingsViewport : els.preview)?.getBoundingClientRect?.();
    if (!rect || rect.width < 160 || rect.height < 160) return;
    const focused = document.activeElement;
    window.MefiIdle.setSettingsPreview({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
    // Entering Command starts the real canvas; the setting being edited keeps focus.
    if (settingsAppearance && document.getElementById("tab-studio")?.contains(focused)) focused.focus?.({ preventScroll: true });
  }
  function schedulePreview() {
    if ((!state.opened && !settingsAppearance) || previewFrame) return;
    if (typeof window.requestAnimationFrame === "function") previewFrame = window.requestAnimationFrame(updatePreview);
    else updatePreview();
  }
  function syncTreeView(view = null) {
    const selected = view || window.MefiIdle?.status?.()?.view || window.MefiIdle?.geometryStatus?.()?.view || "3d";
    for (const choice of [...els.previewViews?.children || [], ...els.settingsViews?.children || []]) {
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
    // Every script has loaded by now: a Shop style the Shop says this PC owns
    // goes on, and what you own changing later is followed.
    wear();
    window.addEventListener("mefi-shop-owned", ownedChanged);
    let recentLink;
    try { recentLink = JSON.parse(localStorage.getItem(LINK_RESUME_KEY) || "null"); localStorage.removeItem(LINK_RESUME_KEY); } catch {}
    audio = document.createElement("audio"); audio.preload = "metadata"; audio.volume = prefs.volume;
    audio.addEventListener("play", () => { renderNow(); announce(); });
    audio.addEventListener("pause", () => { renderNow(); announce(); });
    audio.addEventListener("ended", () => { if (state.source === "local") move(1, false); });
    for (const name of ["timeupdate", "loadedmetadata", "durationchange"]) audio.addEventListener(name, scheduleNow);
    audio.addEventListener("error", () => {
      // A dead stream is a mirror problem, not a file-format problem; the
      // deck's radio listener already handed it to the mirror watchdog.
      if (state.source === "radio") return;
      if (audio.src) note("This audio file could not be played. Try another format.", true);
      renderNow(); announce();
    });
    bindDeck(audio);
    state.station = prefs.station;
    // The last session's source comes back with it. Local files are granted
    // per session and must be chosen again; a link returns to the Links tab
    // and its player mounts, without playing, when the dropdown opens, so nothing
    // is fetched from the service before then.
    const lastLink = prefs.source === "link" ? playableLink(mediaLink(prefs.links[0])) : null;
    if (lastLink) { state.link = lastLink; state.source = "link"; }
    else if (prefs.source === "radio") state.source = "radio";
    build();
    bindAudioHover(document.getElementById("settings-audio-open"));
    window.addEventListener("blur", () => { if (!watchHost && !els.browser?.active && !els.linkPlayer?.contains(document.activeElement)) closeAudio(); });
    applyTheme(prefs.theme, false); paintFont(prefs.font);
    syncTreePreferences(false); render(); renderMediaMenu();
    if (lastLink) els.linkInput.value = lastLink.url;
    // A station that was sounding when Studio closed is tuned again. Smoke and
    // capture runs share the owner's profile, so they stay silent.
    const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
    if (state.source === "radio" && prefs.radioOn && station(state.station) && !headless) tune(state.station);
    if (!headless && recentLink) Promise.resolve(window.MefiBoot?.ready?.()).then(() => restoreRecentLink(recentLink)).catch(() => {});
    window.addEventListener("resize", () => { schedulePreview(); scheduleDropdown(); });
    // Capture the complete dismissal gesture before the tree or rail sees it.
    for (const type of ["pointerdown", "pointerup", "pointercancel", "click", "auxclick", "contextmenu"]) window.addEventListener(type, appearanceOutside, true);
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !settingsAppearance || window.MefiNav?.state?.transient || window.MefiNav?.state?.sheet) return;
      const drawer = document.getElementById("tab-studio");
      if (window.MefiSelect?.owns?.(drawer)) { event.preventDefault(); event.stopImmediatePropagation(); window.MefiSelect.close(true); return; }
      if (event.target?.id === "settings-find" && event.target.value) return;
      event.preventDefault(); event.stopImmediatePropagation(); dismissAppearance();
    }, true);
    window.addEventListener("mefi-tree-view", (event) => syncTreeView(event.detail?.view));
    window.addEventListener("mefi-audio-change", (event) => renderAudioLink(event.detail));
    // Settings can preview a Void look without opening the canvas. Auxiliary
    // overlays leave Settings underneath, so only a page change ends it.
    window.addEventListener("mefi:nav", (event) => {
      if (event?.detail?.action !== "open") return;
      const id = event.detail.id;
      // Search and other temporary dialogs leave Watch underneath them.
      if (watchHost && window.MefiNav?.get?.(id)?.layer === "transient") return;
      if (id === "audio" || id === "music" && (event.detail.params === "sound" || event.detail.params?.group === "sound")) return;
      if (id !== "watch") closeAudio();
      if (["studio", "music", "appearancePreview"].includes(id)) return;
      const kind = window.MefiNav?.get?.(id)?.kind;
      if (kind === "overlay" || kind === "action") return;
      activateSettings(null);
    });
    if (typeof window.ResizeObserver === "function") {
      new window.ResizeObserver(schedulePreview).observe(els.preview);
      const dropdownObserver = new window.ResizeObserver(scheduleDropdown);
      dropdownObserver.observe(els.dropdown); dropdownObserver.observe(els.dropdownBody);
    }
    window.addEventListener("pagehide", rememberLink);
    window.addEventListener("message", linkMessage);
    window.addEventListener("beforeunload", () => { rememberLink(); for (const track of state.tracks) URL.revokeObjectURL(track.url); });
  }
  let settingsHosts = null;
  let previewRoute = "music";
  let settingsAppearance = false;
  let appearanceSection = "themes";
  let appearanceDock = "left";
  try { if (localStorage.getItem("mefiStudio.appearanceDock") === "right") appearanceDock = "right"; } catch {}
  let dismissPointer = null, dismissClick = false;
  function selectAppearanceSection(section) {
    if (!["themes", "nodes", "layout", "interface"].includes(section)) return;
    appearanceSection = section;
    const pane = document.getElementById("settings-category-appearance");
    for (const panel of pane?.querySelectorAll?.("[data-appearance-panel]") || []) panel.hidden = settingsAppearance && panel.dataset.appearancePanel !== section;
    for (const control of pane?.querySelectorAll?.("[data-appearance-section]") || []) control.setAttribute("aria-pressed", String(control.dataset.appearanceSection === section));
    document.getElementById("settings-sections")?.scrollTo?.({ top: 0, behavior: "instant" });
    window.MefiScroll?.refresh?.();
  }
  function syncAppearanceDock() {
    document.body.dataset.appearanceDock = appearanceDock;
    const dock = document.getElementById("appearance-dock");
    if (dock) {
      const label = `Move sidebar to the ${appearanceDock === "left" ? "right" : "left"}`;
      dock.textContent = appearanceDock === "left" ? "⇥" : "⇤";
      dock.title = label; dock.setAttribute("aria-label", label);
    }
    schedulePreview();
  }
  function setSettingsAppearance(active, { keepTree = false, keepLook = false } = {}) {
    if (active === settingsAppearance) { if (active) schedulePreview(); return; }
    settingsAppearance = active;
    if (active) {
      document.body.classList.add("appearance-settings-active");
      els.settingsStage.hidden = false;
      syncAppearanceDock(); syncTreeView(); selectAppearanceSection(appearanceSection);
      schedulePreview();
    } else {
      document.body.classList.remove("appearance-settings-active");
      if (els.settingsStage) els.settingsStage.hidden = true;
      selectAppearanceSection(appearanceSection);
      if (previewFrame) window.cancelAnimationFrame?.(previewFrame);
      previewFrame = 0;
      window.MefiIdle?.setSettingsPreview?.(null, { keepActive: keepTree });
    }
  }
  function dismissAppearance() {
    if (settingsAppearance) {
      setSettingsAppearance(false, { keepTree: true });
      // Dismissing is not a task selection, including the navigation layer's
      // remembered task. Leave the tree ready for a separate, deliberate click.
      window.MefiNav?.go?.("command", { preserveSelection: true });
      document.getElementById("idle-layer")?.focus?.({ preventScroll: true });
    } else if (state.opened) close();
  }
  function appearanceOwns(target) {
    const drawer = settingsAppearance ? document.getElementById("tab-studio") : els.sheet;
    return drawer?.contains(target) || (settingsAppearance ? els.settingsViews : els.previewViews)?.contains(target)
      || window.MefiSelect?.owns?.(drawer) && window.MefiSelect?.contains?.(target)
      || window.MefiScroll?.owns?.(drawer, target);
  }
  function appearanceOutside(event) {
    // Vibe's rail is how Vibe mode moves between pages: its clicks navigate
    // (go() leaves the preview) instead of dismissing into Command.
    if (event.target?.closest?.("#vibe-rail") || event.target?.closest?.("#media-window")) return;
    // So are the 0.5 layout's rail and its list column (Settings' places, Map look among them): a row there navigates.
    if (document.documentElement?.dataset?.layout === "v2" && event.target?.closest?.("#shell-pages, #app-rail")) return;
    const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    const canDismiss = () => {
      const transient = window.MefiNav?.state?.transient;
      return (settingsAppearance || state.opened) && !appearanceOwns(event.target)
        && (!transient || transient === previewRoute) && !window.MefiNav?.state?.sheet;
    };
    if (event.type === "pointerdown") {
      // A fresh gesture always releases the previous dismissal latch, even if
      // its pointerup happened outside the window and no click was delivered.
      dismissPointer = null; dismissClick = false;
      if (!canDismiss()) return;
      dismissPointer = event.pointerId; dismissClick = true;
      consume(); dismissAppearance();
    } else if (event.type === "pointercancel") {
      dismissPointer = null; dismissClick = false;
    } else if (event.type === "pointerup" && dismissClick && event.pointerId === dismissPointer) {
      consume();
    } else if (["click", "auxclick", "contextmenu"].includes(event.type) && dismissClick) {
      consume();
      if (event.type !== "contextmenu") { dismissPointer = null; dismissClick = false; }
    } else if (event.type === "click" && canDismiss()) {
      // Keyboard/assistive clicks need the same dismissal rule without a pointer.
      consume(); dismissAppearance();
    }
  }
  function mountAppearanceSidebar() {
    const pane = document.getElementById("settings-category-appearance");
    if (!pane || els.settingsStage) return;
    const stage = element("section", "appearance-stage", null, document.body);
    stage.id = "appearance-stage"; stage.hidden = true; stage.setAttribute("aria-label", "Live appearance preview");
    els.settingsStage = stage;
    const header = element("header", "appearance-stage-header", null, stage);
    const copy = element("div", null, null, header);
    element("p", "appearance-live-label", "Live preview", copy);
    element("h2", null, "Your live tree", copy);
    element("p", "appearance-stage-hint", "Click outside the sidebar to close it. Click again to explore.", copy);
    els.settingsViews = element("div", "music-preview-views", null, header);
    els.settingsViews.setAttribute("role", "group"); els.settingsViews.setAttribute("aria-label", "Live tree view");
    for (const view of ["2d", "3d"]) {
      const choice = button(view.toUpperCase(), "ghost", els.settingsViews, () => { window.MefiIdle?.setView?.(view); syncTreeView(view); }, `appearance-view-${view}`);
      choice.dataset.view = view;
    }
    button("Fit", "ghost music-preview-fit", els.settingsViews, () => window.MefiIdle?.fitAll?.(), "appearance-tree-fit");
    els.settingsViewport = element("div", "appearance-viewport", null, stage);
    els.settingsViewport.setAttribute("aria-hidden", "true");
    const controls = document.getElementById("settings-appearance");
    if (controls) controls.dataset.appearancePanel = "interface";
    const tree = document.getElementById("settings-tree");
    if (tree) tree.dataset.appearancePanel = "nodes";
    document.getElementById("appearance-sections")?.addEventListener("click", (event) => {
      const section = event.target.closest?.("[data-appearance-section]");
      if (section) selectAppearanceSection(section.dataset.appearanceSection);
    });
    document.getElementById("appearance-close")?.addEventListener("click", dismissAppearance);
    document.getElementById("appearance-dock")?.addEventListener("click", () => {
      appearanceDock = appearanceDock === "left" ? "right" : "left";
      try { localStorage.setItem("mefiStudio.appearanceDock", appearanceDock); } catch {}
      syncAppearanceDock();
    });
    if (typeof window.ResizeObserver === "function") new window.ResizeObserver(schedulePreview).observe(els.settingsViewport);
    syncAppearanceDock();
  }
  function mountSettings(hosts) {
    init();
    settingsHosts = hosts;
    if (state.opened) return;
    const move = (node, host) => {
      if (!node || !host || (node.parentElement ?? node.parentNode) === host) return;
      if (typeof host.moveBefore === "function") { try { host.moveBefore(node, null); return; } catch {} }
      node.remove?.(); host.append(node);
    };
    if (hosts.look && !document.getElementById("settings-canvas-preview")) {
      const preview = button("Preview canvas", "ghost settings-preview-button", hosts.look, openPreview);
      preview.id = "settings-canvas-preview";
      preview.title = "Open the live canvas beside these appearance controls";
    }
    move(els.groups.look.group, hosts.look);
    mountAppearanceSidebar();
    render();
  }
  function activateSettings(category) {
    const active = category === "appearance" && document.getElementById("tab-studio")?.hidden === false && Boolean(els.settingsStage) && !state.opened;
    setSettingsAppearance(active);
    if (category !== "appearance" && settingsReveal.custom) {
      settingsReveal.custom = false;
      if (els.customPalette) els.customPalette.hidden = prefs.theme !== "custom";
    }
    if (category !== "audio" && settingsReveal.source) { settingsReveal.source = null; renderSourcePanels(); }
  }
  function revealSettingsTarget(target) {
    init();
    // The section a control sits in (Browse or Picture of the video panel).
    let section = null;
    for (let node = target; node; node = node.parentElement ?? node.parentNode) {
      if (node.dataset?.appearancePanel) selectAppearanceSection(node.dataset.appearancePanel);
      if (node === els.customPalette) {
        selectAppearanceSection("themes");
        settingsReveal.custom = true; els.customPalette.hidden = false;
        return true;
      }
      section ||= node.dataset?.deckSection || null;
      for (const source of ["local", "radio", "link"]) if (node === els[source]) {
        settingsReveal.source = source;
        deckSection = section || sectionsFor(source)[0][0];
        renderSourcePanels(); renderNow();
        return true;
      }
      for (const [key, panel] of [["tree", els.audioLink], ["more", els.more]]) if (node === panel) {
        deckSection = key;
        renderSourcePanels();
        return true;
      }
    }
    return false;
  }
  function open(group = "look") {
    if (group === "sound") { openAudio(); return; }
    if (window.MefiBooklet?.jumpToSettings && window.MefiNav?.go) {
      window.MefiNav.go("studio", { section: "appearance" });
      return;
    }
    openPreview();
  }
  function openPreview() {
    init();
    closeAudio();
    setSettingsAppearance(false, { keepLook: true });
    if (state.opened) { els.sheet.focus(); schedulePreview(); return; }
    priorFocus = document.activeElement;
    if (settingsHosts) { els.groups.look.group.remove?.(); els.body.append(els.groups.look.group); }
    restoreWorkspace = Boolean(window.MefiIdle?.setSettingsPreview && window.MefiWorkspace?.isActive?.());
    state.opened = true; els.overlay.hidden = false;
    // Claim before opening the canvas, so navigation retains the true origin.
    previewRoute = settingsHosts || window.MefiNav?.get?.("appearancePreview") ? "appearancePreview" : "music";
    window.MefiNav?.claim?.(previewRoute);
    els.sheet.setAttribute("aria-modal", "false");
    if (restoreWorkspace) window.MefiWorkspace.exit();
    document.body.classList.add("music-preview-active");
    render(); syncTreeView(); els.sheet.focus(); schedulePreview();
  }
  function close() {
    if (!els.overlay || els.overlay.hidden) return;
    state.opened = false; els.overlay.hidden = true;
    if (previewFrame) window.cancelAnimationFrame?.(previewFrame);
    previewFrame = 0;
    window.MefiIdle?.setSettingsPreview?.(null);
    document.body.classList.remove("music-preview-active");
    if (restoreWorkspace) window.MefiWorkspace?.enter?.();
    restoreWorkspace = false;
    window.MefiNav?.release?.(previewRoute);
    if (settingsHosts) {
      mountSettings(settingsHosts);
      document.getElementById("settings-canvas-preview")?.focus?.();
    }
    if (!window.MefiNav?.release) priorFocus?.focus?.();
  }
  // For renderer/playlists.js: its section, and the player's hands. Lists
  // play and queue through here, never by touching the player's state.
  function registerPlaylists(hook) {
    init();
    playlistsHook = hook && typeof hook === "object" ? hook : null;
    render(); renderMediaMenu();
    return {
      host: els.playlists, menu: els.dropdown, glyph, note, relayout: scheduleDropdown,
      info: (raw) => { const link = mediaLink(raw); return link ? { provider: link.provider, providerName: link.providerName, kind: link.kind, label: link.label, url: link.url, playable: Boolean(playableLink(link)), youtube: youtubeId(link.url) } : null; },
      thumbnail: (url) => thumbnail(youtubeId(url)),
      play: playItems, queue: queueItems, playing: playingItem,
      queued: () => linkQueue.map((item) => ({ url: item.url, title: item.title })),
      // A channel's videos in Browse, without changing what plays.
      browse: (query) => { if (shownSource() !== "link") { settingsReveal.source = "link"; renderSourcePanels(); } return searchYouTube(query); },
      open: () => openSection("playlists"),
      drag: (node, item) => dragMedia(node, item),
      showLinks: () => mediaMenu.showLinks,
    };
  }
  window.MefiMusic = { init, open, openPreview, openAudio, closeAudio, toggleAudio, openWatch, closeWatch, openSection, mountSettings, activateSettings, revealSettingsTarget, settingsAppearanceActive: () => settingsAppearance, leaveSettingsAppearance: (options) => setSettingsAppearance(false, options), close, status, graphPreferences, applyNodeStyle, applyNodeLayout, applyNodeEffects, getAudioElement: () => { init(); return activeDeck(); }, tune, stopRadio,
    stations: () => STATIONS.map((item) => ({ id: item.id, name: item.name, detail: item.detail, origin: item.origin, mirrors: item.mirrors.length })),
    // Where the playing source is ({ position, duration } in seconds; duration 0 for a stream with no end): the status bar's time left.
    playback: () => { const at = playbackPosition(); return { position: at.position, duration: at.duration }; }, setRecommender: (fn) => { recommender = typeof fn === "function" ? fn : null; render(); }, addFiles, setSource, applyTheme, applyCustomColors,
    // The free palettes as swatches, and the one on screen (Vibe's settings panel).
    themes: () => Object.entries(THEMES).map(([key, theme]) => ({ key, name: theme.name, accent: theme.accent, bright: theme.bright, bg: theme.bg, panel: theme.panel, tone: isLightTheme(key) ? "light" : "dark", ...(theme.accent2 ? { accent2: theme.accent2 } : {}) })),
    // Looks and style packs (see "Looks and style packs" above).
    looks: () => LOOKS.map((look) => ({ ...look, themes: [...look.themes] })), applyLook, look: () => lookOf(prefs.theme),
    fonts: () => Object.entries(FONTS).map(([key, font]) => ({ key, name: font.name, detail: font.detail, stack: font.stack })), applyFont, font: () => prefs.font,
    applyPack, previewPack, endPreview: () => endPreview(), packInfo: () => copyPack(prefs.theme === "pack" ? prefs.pack : null),
    // Node styles from the Shop (see "Node styles from the Shop" above).
    previewNodeStyle, nodeStyle: () => worn,
    shopStyles: () => Object.entries(NODE_STYLES).filter(([key]) => isShopNodeStyle(key)).map(([key, style]) => ({ key, item: style.shop, name: style.name, detail: style.detail, owned: wearable(key) })),
    // The node styles this PC can wear (a Shop style once it is owned), and
    // every layout, for the setup helper's Look section.
    nodeStyles: () => Object.entries(NODE_STYLES).filter(([key]) => wearable(key)).map(([key, style]) => ({ key, name: style.name, detail: style.detail, item: style.shop ?? null })),
    nodeLayouts: () => Object.entries(NODE_LAYOUTS).map(([key, layout]) => ({ key, name: layout.name, detail: layout.detail })), theme: () => prefs.theme,
    // Links from anywhere in Studio (a chat, a mirrored Discord room): linkInfo
    // says whether and how a link plays, without touching the player.
    playLink, loadSpotify: (raw) => playLink(raw),
    // For renderer/together.js: the Links player that is mounted right now
    // (an iframe, or the <video> of a plain file), and where its section goes.
    linkElement: () => { const frame = els.linkFrame; return frame && state.link && state.source === "link" ? { url: state.link.url, kind: state.link.kind, provider: state.link.provider, element: frame } : null; },
    togetherHost: () => { init(); return els.together; },
    playlists: registerPlaylists,
    linkInfo: (raw) => { const link = mediaLink(raw); return link ? { provider: link.provider, providerName: link.providerName, kind: link.kind, label: link.label, url: link.url, playable: Boolean(playableLink(link)) } : null; },
    customColors: () => ({ ...prefs.customColors }), themePalette,
    // isNodeStyle is for the tree painters; the catalog feeds Settings › Community.
    isNodeStyle,
    premiumCatalog: () => ({
      themes: Object.entries(THEMES).filter(([key]) => isVoidTheme(key)).map(([key, theme]) => ({ key, name: theme.name, accent: theme.accent, bright: theme.bright, accent2: theme.accent2 })),
      nodeStyles: Object.entries(NODE_STYLES).filter(([key]) => isVoidNodeStyle(key)).map(([key, style]) => ({ key, name: style.name, detail: style.detail })),
    }) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
