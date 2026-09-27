// Style & sound: Studio's color themes, node styles and layouts, the members'
// Void collection (its own premium store, gated by MefiCommunity), the
// local-file player, the ad-free radio decks and the Links player. A pasted
// link plays in its service's official embed (YouTube, Spotify, SoundCloud,
// Vimeo) or, for a plain audio or video file such as a Discord attachment, in
// a <video> element of its own; an embed's cross-origin playback state is
// deliberately not guessed. Links no embed can play (a Spotify Jam, Twitch,
// any other page) are handed to their own app or the browser.
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
    motion: { title: "Tree motion", detail: "Let the beat turn, sway and swell the spinning tree. It stays in frame.", enabled: true },
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
    // Leave contrast headroom for the translucent panels and their subtle sheen.
    const text = readableColor(base.text || "#ece5d8", base.panel, 5.5);
    const bright = readableColor(base.bright, base.panel, 4.5);
    const muted = readableColor(base.muted || mixColor(text, base.panel, .32), base.panel, 5.5);
    const dim = readableColor(mixColor(text, base.panel, .5), base.panel, 4.5);
    const border = readableColor(mixColor(base.accent, base.panel, .6), base.panel, 3);
    const canvasText = readableColor(base.text || "#ece5d8", base.bg);
    // Custom background and surface colours may have opposite tones. Reading
    // areas use the safe base; the canvas keeps the exact chosen background.
    const readingBackground = [text, muted, bright].every((ink) => contrast(ink, base.bg) >= 4.5) ? base.bg : base.panel;
    const onAccent = contrast("#FFFFFF", base.accent) > contrast("#000000", base.accent) ? "#FFFFFF" : "#000000";
    const actionEnd = mixColor(base.accent, onAccent === "#FFFFFF" ? "#000000" : "#FFFFFF", .18);
    return { accent: base.accent, bright, accent2: base.accent2 || bright, background: base.bg, readingBackground, actionEnd, surface: base.panel, text, muted, dim, border,
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
  // "external" (a page only its own app or the browser can open). Only https,
  // with no credentials or port; every embed URL is rebuilt from validated
  // ids, never copied from the paste.
  function mediaLink(raw) {
    const value = String(raw ?? "").trim();
    if (!value || value.length > 2048) return null;
    const spotify = spotifyLink(value);
    if (spotify) return spotify;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, "");
    const path = url.pathname;
    const external = (provider, providerName, label, extra = {}) => ({ provider, providerName, kind: "external", url: url.href.replace(/#.*$/, ""), label, short: label, ...extra });
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
    return { theme: isFreeTheme(raw.theme) ? raw.theme : DEFAULT_THEME, customColors: safeCustomColors(raw.customColors), volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .7, links,
      nodeStyle: isFreeNodeStyle(raw.nodeStyle) ? raw.nodeStyle : "orbs",
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
  let mediaMenu = { showLinks: true, copiedLinks: true };
  try {
    const savedMenu = JSON.parse(localStorage.getItem(MEDIA_UI_KEY) || "null");
    mediaMenu = { showLinks: savedMenu?.showLinks !== false, copiedLinks: savedMenu?.copiedLinks !== false };
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
  const PREMIUM_KEY = "mefiStudio.music.premium.v1";
  const COMMUNITY_HINT_KEY = "mefiStudio.community.v1";
  let storedPremium;
  try { storedPremium = JSON.parse(localStorage.getItem(PREMIUM_KEY) || "null"); } catch {}
  // The saved premium choice, kept even while it is locked so a returning
  // member gets it back; `effective` is what is actually on screen.
  const premium = safePremium(storedPremium);
  const effective = { theme: prefs.theme, nodeStyle: prefs.nodeStyle };
  // A locked Void choice can be tried on screen, but never enters either store.
  const previewing = { theme: false, nodeStyle: false };
  // Search may expose configuration without changing the active look or audio.
  const settingsReveal = { custom: false, source: null };
  const keepAfterUnlock = { theme: false, nodeStyle: false };
  // link: what the Links tab plays; handoff: the last link only its own app can
  // open; linkPlaying is real only for a plain file in Studio's own element.
  const state = { source: "local", tracks: [], selected: -1, link: null, handoff: null, linkPlaying: false, linkAutoplay: false, linkFadeIn: false, linkStartMs: 0, opened: false, sending: false, notice: "", error: false,
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
  let dropdownOpenTimer = 0;
  let dropdownCloseTimer = 0;
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
    const title = state.source === "link" ? state.link ? state.link.label : "Paste a link"
      : state.source === "radio" ? tuned ? tuned.name : "Choose a station"
      : track?.title || "Choose your music";
    const deck = activeDeck();
    const playing = state.source === "radio" ? (state.radioPhase === "playing" || state.radioPhase === "buffering") && Boolean(deck?.src) && !deck.paused
      : state.source === "link" ? state.link?.kind === "media" && state.linkPlaying
      : state.source === "local" && Boolean(audio?.src) && !audio.paused && !audio.ended;
    // Links never reach the analyser: an embed is another origin and a pasted
    // file is not CORS-cleared, so the audio link listens to the desktop.
    return { source: state.source, playing, title, track: title, theme: effective.theme, ...graphPreferences(),
      queueLength: state.tracks.length, externalPlayback: state.source === "link", supported: true,
      provider: state.source === "link" ? state.link?.providerName ?? null : null, link: state.source === "link" ? state.link?.url ?? null : null,
      station: state.station, stationName: tuned?.name || null, radioPhase: state.source === "radio" ? state.radioPhase : "idle" };
  }
  const announce = () => { renderDropdownStatus(); event("mefi-music-change", status()); };
  // The header's one line: what is playing, from where.
  function renderDropdownStatus() {
    if (!els.dropdownStatus) return;
    const current = status();
    const tuned = station(state.station);
    const text = state.source === "radio" ? state.radioPhase === "connecting" && tuned ? `Connecting to ${tuned.name}…` : current.playing && tuned ? `Radio · ${tuned.name}` : "Nothing playing"
      : state.source === "link" ? state.link ? `${state.link.providerName} · ${state.link.label}` : "Nothing playing"
      : state.tracks[state.selected] ? `${current.playing ? "Playing" : "Paused"} · ${current.title}` : "Nothing playing";
    if (els.dropdownStatus.textContent !== text) els.dropdownStatus.textContent = text;
    els.dropdownStatus.dataset.live = String(Boolean(current.playing || state.source === "link" && state.link && linkIsPlaying()));
  }
  // A slider's fill is painted from its value, so every range reads alike.
  function fillRange(input) {
    if (!input?.style?.setProperty) return;
    const min = Number(input.min) || 0, max = Number(input.max) || 1, value = Number(input.value);
    const ratio = max > min && Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    input.style.setProperty("--fill", `${Math.round(ratio * 1000) / 10}%`);
  }
  const percent = (value) => `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
  function stepStation(step) {
    const index = STATIONS.findIndex((item) => item.id === state.station);
    const next = STATIONS[(Math.max(0, index) + (index < 0 && step > 0 ? 0 : step) + STATIONS.length) % STATIONS.length];
    if (next) tune(next.id);
  }
  // Play and pause for every player Studio can steer: its own <video>, and
  // YouTube or Vimeo through their player messages.
  function linkIsPlaying() {
    if (!state.link || state.source !== "link") return false;
    return state.link.kind === "media" ? state.linkPlaying : Boolean(linkPlayback?.playing);
  }
  function toggleLink() {
    const link = state.link;
    if (!link || state.source !== "link") return;
    if (!els.linkFrame) { state.linkAutoplay = true; mountLink(); render(); return; }
    const playing = linkIsPlaying();
    if (link.kind === "media") {
      if (playing) els.linkFrame.pause?.();
      else { try { Promise.resolve(els.linkFrame.play?.()).catch(() => {}); } catch {} }
      return;
    }
    if (link.provider === "youtube") sendLinkMessage({ event: "command", func: playing ? "pauseVideo" : "playVideo", args: [], id: "studio-media", channel: "widget" });
    else if (link.provider === "vimeo") sendLinkMessage({ method: playing ? "pause" : "play" });
    else return;
    // The player confirms shortly; the button answers the click now.
    if (linkPlayback) { linkPlayback.playing = !playing; linkPlayback.observed = true; }
    els.floatingPlayer?.playback?.({ playing: !playing });
    renderLinkNow(); renderDropdownStatus();
  }
  // One field for finding and loading: a link plays, words search YouTube. A
  // link typed without https:// (www.youtube.com/…, youtu.be/…) still counts.
  function finderLink(value) {
    const text = String(value ?? "").trim();
    return mediaLink(text) || (/^[\w-]+(\.[\w-]+)+\/\S*$/i.test(text) ? mediaLink(`https://${text}`) : null);
  }
  function finderIntent() {
    const value = els.linkInput?.value.trim() || "";
    if (!value) return "empty";
    if (finderLink(value)) return "link";
    return window.mefiStudio?.youtubeSearch && !/^[a-z][\w+.-]*:/i.test(value) ? "search" : "invalid";
  }
  function renderFinder() {
    if (!els.linkGo) return;
    const intent = finderIntent();
    const label = youtubeSearching ? "Searching…" : intent === "search" ? "Search" : "Play";
    if (els.linkGo.textContent !== label) els.linkGo.textContent = label;
    els.linkGo.disabled = youtubeSearching;
    els.linkQueueTools.hidden = intent !== "link" || !playableLink(finderLink(els.linkInput.value));
  }
  function submitFinder() {
    const intent = finderIntent();
    if (intent === "empty") { els.linkInput.focus(); return; }
    if (intent === "search") { void searchYouTube(els.linkInput.value.trim()); return; }
    playLink(finderLink(els.linkInput.value)?.url || els.linkInput.value);
    renderFinder();
  }
  let noticeTimer = 0;
  function note(text, error = false) {
    state.notice = String(text || ""); state.error = error;
    if (els.notice) { els.notice.textContent = state.notice; els.notice.dataset.error = String(error); }
    window.clearTimeout?.(noticeTimer); noticeTimer = 0;
    // Confirmations clear themselves; a problem stays until the next action.
    if (state.notice && !error && typeof window.setTimeout === "function") noticeTimer = window.setTimeout(() => { noticeTimer = 0; if (!state.error) note(""); }, 7000);
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
    root.style.setProperty("--studio-reading-bg", detail.readingBackground);
    root.style.setProperty("--studio-action-end", detail.actionEnd);
    root.dataset.studioTheme = key;
    root.dataset.studioThemeTier = detail.tier;
    // Shared glass surfaces adapt their edge and shadow to a light palette.
    root.dataset.studioThemeTone = luminance(detail.readingBackground) > 0.35 ? "light" : "dark";
    effective.theme = key;
    for (const button of [...els.themes?.children || [], ...els.premiumThemes?.children || []]) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === key));
      if (button.dataset.theme === "custom") button.style.setProperty("--swatch", prefs.customColors.accent);
    }
    if (els.customPalette) els.customPalette.hidden = key !== "custom" && !settingsReveal.custom;
    for (const [name, pair] of Object.entries(els.customInputs || {})) {
      pair.picker.value = prefs.customColors[name]; pair.hex.value = prefs.customColors[name]; pair.hex.setAttribute("aria-invalid", "false");
    }
    return detail;
  }
  // options.navigate === false: explain a temporary preview without leaving
  // the picker (the Workspace select also fires on every arrow key).
  function applyTheme(theme, save = true, options) {
    settingsReveal.custom = false;
    if (isPremiumTheme(theme)) {
      if (!premiumAllowed()) {
        previewing.theme = true;
        keepAfterUnlock.theme = save === true;
        const detail = paintTheme(theme);
        event("mefi-theme-change", { ...detail, preview: true });
        offerUnlock("theme", theme, THEMES[theme].name, options?.navigate !== false);
        return theme;
      }
      previewing.theme = false;
      keepAfterUnlock.theme = false;
      const detail = paintTheme(theme);
      if (save && premium.theme !== theme) { premium.theme = theme; persistPremium(); }
      event("mefi-theme-change", detail);
      return theme;
    }
    const key = isFreeTheme(theme) ? theme : DEFAULT_THEME;
    previewing.theme = false;
    keepAfterUnlock.theme = false;
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
  // The palette on screen, read every frame by the tree rail and the Command
  // view. resolvePalette runs dozens of contrast searches (about 70 µs), so
  // the answer is kept until the theme or a custom colour changes, and every
  // reader shares one frozen copy.
  let paletteKey = null, paletteMemo = null;
  function themePalette() {
    const theme = effective.theme;
    const custom = prefs.customColors;
    const key = theme === "custom" ? `custom|${custom.accent}|${custom.background}|${custom.surface}|${custom.text}` : theme;
    if (key !== paletteKey || !paletteMemo) {
      const palette = resolvePalette(theme, custom);
      paletteMemo = Object.freeze({ theme, ...palette, canvas: Object.freeze(palette.canvas) });
      paletteKey = key;
    }
    return paletteMemo;
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
        previewing.nodeStyle = true;
        keepAfterUnlock.nodeStyle = save === true;
        effective.nodeStyle = style;
        syncTreePreferences(false);
        offerUnlock("nodeStyle", style, NODE_STYLES[style].name, options?.navigate !== false);
        return style;
      }
      previewing.nodeStyle = false;
      keepAfterUnlock.nodeStyle = false;
      effective.nodeStyle = style;
      if (save && premium.nodeStyle !== style) { premium.nodeStyle = style; persistPremium(); }
      syncTreePreferences(false);
      return style;
    }
    previewing.nodeStyle = false;
    keepAfterUnlock.nodeStyle = false;
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
      if (previewing.theme && keepAfterUnlock.theme) {
        previewing.theme = false;
        keepAfterUnlock.theme = false;
        if (premium.theme !== effective.theme) { premium.theme = effective.theme; persistPremium(); }
        event("mefi-theme-change", themeDetail(effective.theme));
      } else if (!previewing.theme && premium.theme && effective.theme !== premium.theme) event("mefi-theme-change", paintTheme(premium.theme));
      if (previewing.nodeStyle && keepAfterUnlock.nodeStyle) {
        previewing.nodeStyle = false;
        keepAfterUnlock.nodeStyle = false;
        if (premium.nodeStyle !== effective.nodeStyle) { premium.nodeStyle = effective.nodeStyle; persistPremium(); }
        syncTreePreferences(false);
      } else if (!previewing.nodeStyle && premium.nodeStyle && effective.nodeStyle !== premium.nodeStyle) { effective.nodeStyle = premium.nodeStyle; syncTreePreferences(false); }
    } else {
      let revoked = false;
      if (isPremiumTheme(effective.theme) && !previewing.theme) { applyTheme(prefs.theme, false); revoked = true; }
      if (isPremiumNodeStyle(effective.nodeStyle) && !previewing.nodeStyle) { effective.nodeStyle = prefs.nodeStyle; syncTreePreferences(false); revoked = true; }
      if (revoked) window.MefiToast?.("Void collection locked again; your choice is saved.", "info");
    }
    renderPremiumLocks(allowed);
  }
  function endPreview() {
    if (previewing.theme) applyTheme(premiumAllowed() && premium.theme ? premium.theme : prefs.theme, false);
    if (previewing.nodeStyle) applyNodeStyle(premiumAllowed() && premium.nodeStyle ? premium.nodeStyle : prefs.nodeStyle, false);
  }
  // A fork with SELF_UNLOCKED says so instead of thanking a membership.
  function selfUnlocked() {
    try { return window.MefiCommunity?.status?.()?.selfUnlocked === true; } catch { return false; }
  }
  // Locked choices stay clickable for a temporary preview. Only a locked
  // picker shows the link and fork actions; a member gets one quiet line.
  function renderPremiumLocks(allowed = premiumAllowed()) {
    for (const [group, className, what] of [[els.premiumThemes, "music-theme-locked", "theme"], [els.premiumStyles, "music-node-locked", "node style"]]) {
      for (const choice of group?.children || []) {
        if (allowed) { choice.classList.remove(className); choice.removeAttribute("aria-disabled"); choice.title = ""; }
        else { choice.classList.add(className); choice.removeAttribute("aria-disabled"); choice.title = `Preview this Void collection ${what}. Link your Discord membership to keep it.`; }
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
      box.previewNote.hidden = allowed;
      box.fineprint.hidden = allowed;
      if (box.fineprint.textContent !== fork) box.fineprint.textContent = fork;
      box.actions.hidden = allowed || !actions;
      box.desktop.hidden = allowed || actions;
      box.link.hidden = !linkable;
      box.member.hidden = !allowed;
      if (box.memberText.textContent !== unlockedLine) box.memberText.textContent = unlockedLine;
      box.manage.hidden = !manageable;
      box.group.setAttribute("aria-describedby", allowed ? box.member.id : `${box.previewNote.id} ${box.fineprint.id}`);
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
    const previewNote = element("p", "music-fineprint", "Preview any look now. Your saved choice returns when you close the canvas preview or leave Settings; link your Discord membership to keep it.", box);
    previewNote.id = `music-premium-${kind}-preview-note`;
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
    (els.premiumBoxes ||= []).push({ tag, group, previewNote, fineprint, actions, desktop, link, member, memberText, manage });
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
  // A station resumed at launch rises from silence instead of starting at
  // full volume; like a crossfade, it reads the master every step.
  let riseNext = false;
  function riseIn(deck, ms = FADE_MS * 2) {
    finishFade();
    deck.volume = 0;
    const started = window.performance.now();
    fadeTimer = window.setInterval(() => {
      const ratio = Math.min(1, (window.performance.now() - started) / ms);
      deck.volume = prefs.volume * ratio * ratio;
      if (ratio < 1) return;
      window.clearInterval(fadeTimer); fadeTimer = 0;
    }, FADE_STEP_MS);
  }
  function stopDeck(deck) {
    if (!deck) return;
    deck.pause();
    deck.removeAttribute("src");
    try { deck.load(); } catch {}
    deck.volume = 0;
  }
  function tune(id, mirrorIndex = 0, viaFailover = false, rise = false) {
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
    if (!viaFailover) { state.radioNote = ""; riseNext = rise; }
    prefs.station = id; prefs.source = "radio"; prefs.radioOn = true; persist();
    unmountLink();
    target.crossOrigin = "anonymous";
    target.volume = live || riseNext ? 0 : prefs.volume;
    target.src = url;
    try { target.load(); } catch {}
    const settle = () => {
      if (generation !== tuneGeneration) return;
      clearStall();
      pendingDeck = null;
      state.deck = target === deckB ? "b" : "a";
      state.radioPhase = "playing";
      if (riseNext && !outgoing) { riseNext = false; riseIn(target); } else fadeTo(target, outgoing);
      renderRadio(); announce();
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
    riseNext = false;
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
    paintVolume();
  }
  function setSource(source) {
    settingsReveal.source = null;
    // "spotify" is the Links tab's name from before it played other services.
    const next = source === "link" || source === "spotify" ? "link" : source === "radio" ? "radio" : "local";
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
    if (els.linkFrame?.dataset.url === link.url) { els.floatingPlayer?.show(link); return; }
    unmountLink();
    els.floatingPlayer?.show(link);
    const autoplay = state.linkAutoplay;
    // A player resumed after a restart comes up from silence (rampLink).
    const fadeIn = autoplay && state.linkFadeIn;
    // Listen together joins a session part-way through: the offset rides the
    // embed's own start parameter where it has one, and a file seeks once
    // its length is known.
    const startSeconds = Math.floor(state.linkStartMs / 1000);
    linkPlayback = { startMs: state.linkStartMs, playing: autoplay, url: link.url, observed: false, savedAt: 0, fadeIn };
    mediaVolumeApplied = false; volumeSync = null;
    state.linkAutoplay = false; state.linkStartMs = 0; state.linkFadeIn = false;
    if (link.kind === "media") {
      const player = element("video", "music-link-frame music-link-media", null, els.linkPlayer);
      player.dataset.url = link.url; player.dataset.shape = link.shape;
      player.controls = true; player.preload = "metadata"; player.playsInline = true;
      player.title = link.label;
      player.volume = fadeIn ? 0 : mediaVolume; player.muted = mediaMuted;
      const sync = () => { if (els.linkFrame !== player) return; state.linkPlaying = !player.paused && !player.ended; els.floatingPlayer?.playback?.({ playing: state.linkPlaying }); renderLinkNow(); announce(); };
      for (const name of ["play", "playing", "pause", "ended"]) player.addEventListener(name, sync);
      if (fadeIn) player.addEventListener("playing", function rise() { player.removeEventListener?.("playing", rise); if (els.linkFrame === player) rampLink(); });
      player.addEventListener("ended", () => { if (els.linkFrame === player) playQueued(); });
      // The file's own controls set the video volume only; the music and
      // radio volume is separate. Studio's own fade is not a choice.
      player.addEventListener("volumechange", () => { if (els.linkFrame === player && !linkRamp && Number.isFinite(player.volume)) { mediaVolume = player.volume; mediaMuted = Boolean(player.muted); saveLinkVolume(); paintLinkVolume(); } });
      player.addEventListener("error", () => {
        if (els.linkFrame !== player) return;
        state.linkPlaying = false;
        els.floatingPlayer?.playback?.({ playing: false });
        note(link.provider === "discord" ? "Discord could not send that file. Attachment links expire; copy a fresh one from Discord." : "That file could not be played. The link may have expired, or the format is not supported.", true);
        announce();
      });
      if (startSeconds > 0) {
        const seekOnce = () => { player.removeEventListener?.("loadedmetadata", seekOnce); try { player.currentTime = startSeconds; } catch {} };
        player.addEventListener("loadedmetadata", seekOnce);
      }
      player.src = link.url;
      els.linkFrame = player;
      els.floatingPlayer?.playback?.({ playing: autoplay });
      if (autoplay && typeof player.play === "function") {
        try { Promise.resolve(player.play()).catch(sync); } catch { sync(); }
      }
      rememberLink();
      return;
    }
    const frame = element("iframe", "music-link-frame", null, els.linkPlayer);
    frame.dataset.url = link.url; frame.dataset.shape = link.shape; frame.dataset.provider = link.provider;
    let src = link.embed;
    if (startSeconds > 0 && link.provider === "youtube") src = `${src.replace(/&start=\d+/, "")}&start=${startSeconds}`;
    if (autoplay && link.autoplay) src = `${src}${src.includes("?") ? link.autoplay : `?${link.autoplay.slice(1)}`}`;
    // Resumed, the player starts muted and rampLink raises it once it is ready.
    if (fadeIn && link.provider === "youtube") src = `${src}&mute=1`;
    if (fadeIn && link.provider === "vimeo") src = `${src}&muted=1`;
    if (startSeconds > 0 && link.provider === "vimeo") src = `${src}#t=${startSeconds}s`;
    frame.src = src;
    frame.title = `${link.label} player`;
    frame.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
    frame.setAttribute("allowfullscreen", "");
    // The booklet's own policy is no-referrer (SomaFM needs it); the players
    // may see the origin, and main.cjs names Studio to YouTube's.
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    els.linkFrame = frame;
    // Until the player reports, a link that was asked to play counts as playing.
    els.floatingPlayer?.playback?.({ playing: autoplay });
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
  function paintLinkVolume() {
    if (!els.linkVolume) return;
    els.linkVolumeControls.hidden = !state.link || state.source !== "link" || !(state.link.kind === "media" || ["youtube", "vimeo"].includes(state.link.provider));
    els.linkVolume.value = String(Math.round(mediaVolume * 100));
    fillRange(els.linkVolume);
    els.linkVolumeValue.textContent = mediaMuted ? "Muted" : percent(mediaVolume);
    els.linkMute.textContent = mediaMuted ? "Unmute" : "Mute";
    els.linkMute.setAttribute("aria-pressed", String(mediaMuted));
    els.linkMute.dataset.muted = String(mediaMuted || mediaVolume === 0);
  }
  // YouTube and Vimeo keep reporting their own volume for a moment after
  // Studio sets it. Until a report agrees, a report is an echo of the old
  // level, never a choice: taking it saved the service's default (often 100%)
  // over yours, and the next restart came up louder.
  let volumeSync = null;
  function armVolumeSync(ms = 4000) { volumeSync = { volume: Math.round(mediaVolume * 100), muted: mediaMuted, until: Date.now() + ms, resent: false }; }
  function acceptPlayerVolume(volume, muted) {
    if (linkRamp) return false;
    if (volumeSync) {
      const agrees = (volume === null || Math.abs(volume - volumeSync.volume) <= 1) && (muted === null || muted === volumeSync.muted);
      if (agrees) { volumeSync = null; return false; }
      if (Date.now() < volumeSync.until) return false;
      // Still disagreeing after the wait: say it once more, then believe it.
      if (!volumeSync.resent) { applyLinkVolume(); if (volumeSync) volumeSync.resent = true; return false; }
      volumeSync = null;
    }
    return true;
  }
  function applyLinkVolume() {
    const frame = els.linkFrame;
    if (!frame) return;
    if (state.link?.kind === "media") { frame.volume = mediaVolume; frame.muted = mediaMuted; }
    if (state.link?.provider === "youtube") {
      sendLinkMessage({ event: "command", func: "setVolume", args: [Math.round(mediaVolume * 100)], id: "studio-media", channel: "widget" });
      sendLinkMessage({ event: "command", func: mediaMuted ? "mute" : "unMute", args: [], id: "studio-media", channel: "widget" });
      armVolumeSync();
    }
    if (state.link?.provider === "vimeo") {
      sendLinkMessage({ method: "setVolume", value: mediaVolume });
      sendLinkMessage({ method: "setMuted", value: mediaMuted });
      armVolumeSync();
    }
    paintLinkVolume();
  }
  // A player resumed after a restart rises from silence to the saved level
  // over a moment, instead of starting at full volume.
  let linkRamp = 0;
  function rampLink(ms = 1800) {
    window.clearInterval?.(linkRamp); linkRamp = 0;
    const frame = els.linkFrame, link = state.link;
    if (!frame || !link) return;
    if (mediaMuted || typeof window.setInterval !== "function") { applyLinkVolume(); return; }
    const started = window.performance?.now?.() ?? Date.now();
    const level = (value) => {
      if (link.kind === "media") { frame.muted = false; frame.volume = value; }
      else if (link.provider === "youtube") sendLinkMessage({ event: "command", func: "setVolume", args: [Math.round(value * 100)], id: "studio-media", channel: "widget" });
      else if (link.provider === "vimeo") sendLinkMessage({ method: "setVolume", value: Math.round(value * 100) / 100 });
    };
    level(0);
    if (link.provider === "youtube") sendLinkMessage({ event: "command", func: "unMute", args: [], id: "studio-media", channel: "widget" });
    if (link.provider === "vimeo") sendLinkMessage({ method: "setMuted", value: false });
    linkRamp = window.setInterval(() => {
      if (els.linkFrame !== frame) { window.clearInterval(linkRamp); linkRamp = 0; return; }
      const ratio = Math.min(1, ((window.performance?.now?.() ?? Date.now()) - started) / ms);
      // Squared: loudness is heard on a curve, so the rise sounds even.
      level(mediaVolume * ratio * ratio);
      if (ratio < 1) return;
      window.clearInterval(linkRamp); linkRamp = 0;
      applyLinkVolume();
    }, 120);
  }
  function saveLinkQueue() {
    try { localStorage.setItem(LINK_QUEUE_KEY, JSON.stringify(linkQueue)); } catch {}
    renderLinkQueue(); renderLinkNow(); scheduleDropdown();
  }
  function queueLink(raw, title = null, next = false) {
    const link = mediaLink(raw);
    if (!playableLink(link)) { note("Paste a playable media link to add it to the queue.", true); return false; }
    if (linkQueue.length >= LINK_QUEUE_LIMIT) { note("The queue holds 50 videos. Remove one before adding another.", true); return false; }
    const item = { url: link.url, title: typeof title === "string" && title.trim() ? title.trim().slice(0, 160) : link.label };
    if (next) linkQueue.unshift(item); else linkQueue.push(item);
    saveLinkQueue(); note(`${item.title} ${next ? "will play next" : "added to the queue"}.`);
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
  function renderLinkQueue() {
    if (!els.linkQueueList) return;
    els.linkQueueHeading.textContent = `Up next · ${linkQueue.length}`;
    els.linkQueueNext.disabled = !linkQueue.length;
    els.linkQueueEmpty.hidden = Boolean(linkQueue.length);
    els.linkQueueList.textContent = "";
    linkQueue.forEach((item, index) => {
      const row = element("li", "music-link-queue-item", null, els.linkQueueList);
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
    });
  }
  function nextVideo() {
    if (playQueued()) return;
    const current = linkPlayback?.url || state.link?.url;
    const index = youtubeResults.findIndex(item => item.url === current);
    if (index >= 0 && index + 1 < youtubeResults.length) { playLink(youtubeResults[index + 1].url); return; }
    if (state.link?.provider === "youtube" && new URL(state.link.url).searchParams.has("list")) {
      sendLinkMessage({ event: "command", func: "nextVideo", args: [], id: "studio-media", channel: "widget" }); return;
    }
    els.linkInput.focus();
    els.youtubeNotice.textContent = "Search YouTube above; Next video then follows the results, or your YouTube playlist.";
    scheduleDropdown();
  }
  // Results are rows you can play with one click: thumbnail, title, channel
  // and length, with + to queue and ↑ to play next.
  async function searchYouTube(query = els.linkInput?.value.trim() || "") {
    if (youtubeSearching) return;
    if (!query) { els.linkInput.focus(); return; }
    if (!window.mefiStudio?.youtubeSearch) { els.youtubeNotice.textContent = "Restart Studio to search YouTube, or paste a link."; return; }
    youtubeSearching = true; renderFinder();
    els.youtubeNotice.textContent = `Searching YouTube for “${query.slice(0, 60)}”…`;
    try {
      const response = await window.mefiStudio.youtubeSearch(query);
      if (!response?.ok) throw new Error(response?.error || "YouTube search is unavailable.");
      youtubeResults = (response.results || []).filter(item => item && /^[\w-]{11}$/.test(item.id)).slice(0, 20).map(item => ({ ...item, url: `https://www.youtube.com/watch?v=${item.id}` }));
      renderYouTubeResults();
      els.youtubeNotice.textContent = youtubeResults.length ? `${youtubeResults.length} videos · click one to play` : "No videos found. Try other words.";
    } catch (error) { els.youtubeNotice.textContent = error?.message || "YouTube search is unavailable."; }
    finally { youtubeSearching = false; renderFinder(); scheduleDropdown(); }
  }
  function renderYouTubeResults() {
    if (!els.youtubeResults) return;
    els.youtubeResults.textContent = "";
    const current = linkPlayback?.url || state.link?.url;
    for (const item of youtubeResults) {
      const row = element("article", "music-youtube-result", null, els.youtubeResults);
      const main = button("", "music-result-main", row, () => playLink(item.url, { label: item.title }));
      main.setAttribute("aria-label", `Play ${item.title}`); main.title = item.title;
      row.dataset.current = String(current === item.url);
      const thumb = element("span", "music-result-thumb", null, main);
      const image = element("img", null, null, thumb); image.alt = ""; image.loading = "lazy"; image.decoding = "async";
      image.src = `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
      if (item.duration) element("span", "music-result-time", item.duration, thumb);
      const copy = element("span", "music-result-copy", null, main);
      element("strong", null, item.title, copy);
      if (item.channel) element("small", null, item.channel, copy);
      const queueButton = button("Add to queue", "music-icon-button music-icon-add", row, () => queueLink(item.url, item.title));
      queueButton.title = "Add to queue"; queueButton.setAttribute("aria-label", `Add ${item.title} to queue`);
      const nextButton = button("Play next", "music-icon-button music-icon-up", row, () => queueLink(item.url, item.title, true));
      nextButton.title = "Play next"; nextButton.setAttribute("aria-label", `Play ${item.title} next`);
    }
    els.youtubeResults.hidden = !youtubeResults.length;
  }
  function linkMessage(event) {
    const frame = els.linkFrame;
    if (!frame?.contentWindow || !linkPlayback || event.source !== frame.contentWindow) return;
    try { if (event.origin !== new URL(frame.src).origin) return; } catch { return; }
    let message = event.data;
    try { if (typeof message === "string") message = JSON.parse(message); } catch { return; }
    if (!message || typeof message !== "object") return;
    let seconds, playing, ended = false;
    if (state.link?.provider === "youtube") {
      const settle = () => { if (linkPlayback.fadeIn) { linkPlayback.fadeIn = false; armVolumeSync(6000); rampLink(); } else applyLinkVolume(); mediaVolumeApplied = true; };
      if (message.event === "onReady") { settle(); return; }
      if (!["infoDelivery", "initialDelivery", "onStateChange"].includes(message.event)) return;
      if (linkWatchTimer) window.clearInterval(linkWatchTimer);
      linkWatchTimer = null;
      if (message.event === "initialDelivery") sendLinkMessage({ event: "command", func: "addEventListener", args: ["onStateChange"], id: "studio-media", channel: "widget" });
      const info = message.info;
      if (!mediaVolumeApplied) settle();
      else if (info && typeof info === "object" && (Number.isFinite(info.volume) || typeof info.muted === "boolean")
        && acceptPlayerVolume(Number.isFinite(info.volume) ? info.volume : null, typeof info.muted === "boolean" ? info.muted : null)) {
        // A change made in YouTube's own controls.
        if (Number.isFinite(info.volume)) mediaVolume = Math.max(0, Math.min(1, info.volume / 100));
        if (typeof info.muted === "boolean") mediaMuted = info.muted;
        saveLinkVolume(); paintLinkVolume();
      }
      const playerState = message.event === "onStateChange" ? info : info?.playerState;
      if (playerState === 1) linkPlayback.queueStarted = true;
      ended = playerState === 0;
      if ([0, 1, 2, 3].includes(playerState)) playing = playerState === 1 || playerState === 3;
      seconds = info?.currentTime;
      // A playlist may have advanced since the original link was opened.
      if (/^[\w-]{11}$/.test(info?.videoData?.video_id || "")) {
        const url = new URL(linkPlayback.url); url.pathname = "/watch";
        url.searchParams.set("v", info.videoData.video_id); url.searchParams.delete("t");
        linkPlayback.url = url.href;
      }
    } else if (state.link?.provider === "vimeo") {
      if (message.event === "ready") {
        for (const value of ["timeupdate", "play", "pause", "ended", "volumechange"]) sendLinkMessage({ method: "addEventListener", value });
        if (linkPlayback.fadeIn) { linkPlayback.fadeIn = false; armVolumeSync(6000); rampLink(); } else applyLinkVolume();
        return;
      }
      if (message.event === "volumechange") {
        const volume = Number.isFinite(message.data?.volume) ? Math.round(message.data.volume * 100) : null;
        const muted = typeof message.data?.muted === "boolean" ? message.data.muted : null;
        if (!acceptPlayerVolume(volume, muted)) return;
        if (volume !== null) mediaVolume = Math.max(0, Math.min(1, volume / 100));
        if (muted !== null) mediaMuted = muted;
        saveLinkVolume(); paintLinkVolume(); return;
      }
      if (!["timeupdate", "play", "pause", "ended"].includes(message.event)) return;
      seconds = message.data?.seconds;
      if (message.event === "play") linkPlayback.queueStarted = true;
      ended = message.event === "ended";
      if (message.event !== "timeupdate") playing = message.event === "play";
    } else return;
    // Initial, unstarted metadata must not erase a restored seek before playback.
    if (Number.isFinite(seconds) && seconds >= 0 && (seconds > 0 || linkPlayback.observed || playing !== undefined)) linkPlayback.startMs = Math.min(seconds * 1000, 86_400_000);
    if (playing !== undefined && (playing !== linkPlayback.playing || !linkPlayback.observed)) {
      linkPlayback.playing = playing; linkPlayback.observed = true;
      els.floatingPlayer?.playback?.({ playing }); renderLinkNow(); renderDropdownStatus();
    }
    if (Date.now() - linkPlayback.savedAt >= 1000 || playing === false) rememberLink();
    if (ended && linkPlayback.queueStarted) { linkPlayback.queueStarted = false; playQueued(); }
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
    if (playLink(saved.url, { autoplay: saved.autoplay === true, startMs: Number(saved.startMs) || 0, fadeIn: true })) {
      els.floatingPlayer?.restore?.(saved.window);
      rememberLink();
    }
  }
  function unmountLink() {
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
  // Stop from the menu does what the player's own close does.
  function stopLink() {
    if (els.floatingPlayer?.close) els.floatingPlayer.close();
    else { unmountLink(); state.link = null; render(); announce(); }
    els.linkInput?.focus?.({ preventScroll: true });
  }
  // The one door for every link, from the Links field, a recent chip, a drop,
  // or another part of Studio (MefiMusic.playLink). Returns true when the link
  // is now the playing source; a hand-off leaves whatever is playing alone.
  function playLink(raw, { autoplay = true, startMs = 0, label = null, fadeIn = false } = {}) {
    init();
    const link = mediaLink(raw);
    if (link && typeof label === "string" && label.trim()) link.label = label.trim().slice(0, 160);
    if (!link) { note("That doesn't look like a link. Paste a YouTube, Spotify, SoundCloud or Vimeo link, or a link to an audio or video file.", true); return false; }
    if (!playableLink(link)) {
      state.handoff = link;
      if (els.linkInput) els.linkInput.value = link.url;
      settingsReveal.source = "link";
      render();
      note(handoffNote(link), link.provider === "web");
      return false;
    }
    state.handoff = null;
    if (state.link?.url !== link.url) unmountLink();
    state.link = link;
    state.linkAutoplay = autoplay; state.linkFadeIn = fadeIn === true;
    state.linkStartMs = Number.isFinite(startMs) && startMs > 0 ? Math.min(startMs, 86_400_000) : 0;
    prefs.links = [link.url, ...prefs.links.filter((url) => url !== link.url)].slice(0, 8);
    persist();
    setSource("link");
    // Choosing the link that is already loaded plays it rather than reloading.
    if (autoplay && link.kind === "media" && els.linkFrame?.paused && typeof els.linkFrame.play === "function") { try { Promise.resolve(els.linkFrame.play()).catch(() => {}); } catch {} }
    state.linkAutoplay = false; state.linkStartMs = 0; state.linkFadeIn = false;
    if (els.linkInput) els.linkInput.value = link.url;
    note(link.kind === "media" ? `${link.label} is loaded in the floating player.` : `${link.providerName} is ready in the floating player; availability depends on ${link.providerName}.`);
    return true;
  }
  function handoffNote(link) {
    if (link.jam) return "Spotify only lets its own app join a Jam. Open it in Spotify below: listening remotely needs Premium there, joining in person does not.";
    if (link.provider === "twitch") return "Twitch only plays inside its own site from a desktop app. Open the stream below.";
    if (link.provider === "web") return `Studio can't play ${link.label} here. It plays YouTube, Spotify, SoundCloud and Vimeo links and audio or video files.`;
    return `${link.label} opens in ${link.providerName}. Open it below.`;
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
    const playing = !audio.paused && state.source === "local";
    els.trackTitle.textContent = current?.title || "Nothing playing";
    els.trackSub.textContent = current ? `Track ${state.selected + 1} of ${state.tracks.length}` : "Add audio files from your computer below.";
    els.play.textContent = playing ? "Pause" : "Play";
    els.play.setAttribute("aria-label", playing ? "Pause local music" : "Play local music");
    els.play.dataset.state = playing ? "playing" : "paused";
    if (els.localCard) els.localCard.dataset.playing = String(playing);
    els.previous.disabled = !current;
    els.next.disabled = !current;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    els.seek.disabled = !duration || state.source !== "local";
    els.seek.max = String(duration || 1);
    if (document.activeElement !== els.seek) els.seek.value = String(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    fillRange(els.seek);
    els.elapsed.textContent = timeLabel(audio.currentTime);
    els.duration.textContent = timeLabel(duration);
    // The slider shows the chosen level, not a fade passing through it.
    paintVolume();
  }
  function paintVolume() {
    for (const [input, value] of [[els.volume, els.volumeValue], [els.radioVolume, els.radioVolumeValue]]) {
      if (!input) continue;
      if (document.activeElement !== input) input.value = String(prefs.volume);
      fillRange(input);
      if (value && value.textContent !== percent(prefs.volume)) value.textContent = percent(prefs.volume);
    }
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
    const shownSource = settingsReveal.source ?? state.source;
    const local = shownSource === "local";
    const radio = shownSource === "radio";
    els.local.hidden = !local; els.radio.hidden = !radio; els.link.hidden = shownSource !== "link";
    els.localTab.setAttribute("aria-selected", String(local));
    els.radioTab.setAttribute("aria-selected", String(radio));
    els.linkTab.setAttribute("aria-selected", String(shownSource === "link"));
    for (const [source, tab] of [["local", els.localTab], ["radio", els.radioTab], ["link", els.linkTab]]) tab.tabIndex = source === shownSource ? 0 : -1;
    els.dropdown.dataset.source = shownSource;
    scheduleDropdown();
    if (els.sourcePreview) {
      const names = { local: "Local music", radio: "Radio", link: "Links" };
      els.sourcePreview.hidden = shownSource === state.source;
      els.sourcePreview.textContent = shownSource === state.source ? "" : `Viewing ${names[shownSource]} controls. ${names[state.source]} remains the active source.`;
    }
  }
  function render() {
    if (!initialized) return;
    renderSourcePanels();
    renderTransport(); renderQueue(); renderRadio(); renderAudioLink(); renderLinks(); renderFinder(); renderDropdownStatus();
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
    renderLinks(); renderLinkQueue(); renderClipboardOffer();
  }
  function renderLinks() {
    if (!els.recent) return;
    els.recent.textContent = "";
    for (const url of prefs.links) {
      const item = mediaLink(url);
      if (!item) continue;
      const recent = button(mediaMenu.showLinks ? `${item.providerName} ${item.short}` : `${item.providerName} · Recent ${els.recent.children.length + 1}`, "ghost music-recent-link", els.recent, () => playLink(url));
      recent.title = mediaMenu.showLinks ? url : "";
      recent.dataset.provider = item.provider;
      if (state.source === "link" && state.link?.url === url) recent.setAttribute("aria-current", "true");
    }
    if (els.recentBlock) els.recentBlock.hidden = !els.recent.children.length;
    const handoff = state.handoff;
    els.linkHandoff.hidden = !handoff;
    els.linkHandoff.textContent = "";
    if (handoff) {
      element("strong", null, handoff.label, els.linkHandoff);
      element("p", null, handoffNote(handoff), els.linkHandoff);
      const open = button(handoff.jam ? "Open the Jam in Spotify ↗" : `Open in ${handoff.provider === "web" ? "your browser" : handoff.providerName} ↗`, "primary", els.linkHandoff, () => openLink(handoff.url), "music-link-handoff-open");
      open.title = mediaMenu.showLinks ? handoff.url : "";
      if (handoff.jam) element("small", null, "Tip: choose Desktop audio under Listen to and the node tree follows the Jam.", els.linkHandoff);
    }
    renderLinkNow();
  }
  // The loaded link's line: what it is, where it came from, and the two ways
  // to take it elsewhere (its own site, or a copy to post in Discord).
  function renderLinkNow() {
    if (!els.linkNow) return;
    paintLinkVolume();
    const link = state.source === "link" ? state.link : null;
    els.linkNow.dataset.empty = String(!link);
    els.linkNow.dataset.provider = link?.provider || "";
    if (els.linkNext) els.linkNext.hidden = !linkQueue.length && link?.provider !== "youtube";
    // Studio steers its own <video>, YouTube and Vimeo; Spotify and
    // SoundCloud keep play and pause inside their player.
    const steerable = Boolean(link && (link.kind === "media" || ["youtube", "vimeo"].includes(link.provider)));
    const playing = linkIsPlaying();
    els.linkToggle.hidden = !steerable;
    els.linkToggle.textContent = playing ? "Pause" : "Play";
    els.linkToggle.dataset.state = playing ? "playing" : "paused";
    els.linkToggle.setAttribute("aria-label", playing ? "Pause the video" : "Play the video");
    els.linkNow.dataset.playing = String(playing);
    els.linkNowEyebrow.textContent = link ? link.providerName : "Video & links";
    Array.from(els.youtubeResults?.children || []).forEach((row, index) => { row.dataset.current = String(Boolean(link) && youtubeResults[index]?.url === (linkPlayback?.url || link?.url)); });
    if (!link) {
      els.linkNowTitle.textContent = "Nothing playing";
      els.linkNowDetail.textContent = "Search YouTube or paste a link below.";
      return;
    }
    els.linkNowTitle.textContent = link.label;
    const where = mediaMenu.showLinks && link.host ? ` · ${link.host}` : "";
    els.linkNowDetail.textContent = !steerable ? `Play and pause inside the ${link.providerName} player`
      : link.kind === "media" ? `${playing ? "Playing" : "Paused"} in Studio${where}`
      : linkPlayback?.observed ? (playing ? "Playing" : "Paused") : "Loading the player…";
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
    // One round button: Stop while a station sounds, Play to bring the last one back.
    const sounding = ["connecting", "playing", "buffering"].includes(phase);
    if (els.radioTitle) els.radioTitle.textContent = tuned ? tuned.name : "Pick a station";
    if (els.radioCard) { els.radioCard.dataset.phase = phase; els.radioCard.dataset.playing = String(phase === "playing"); }
    if (els.radioPlay) {
      els.radioStop.hidden = !sounding; els.radioPlay.hidden = sounding;
      els.radioPlay.disabled = !tuned;
      els.radioPlay.setAttribute("aria-label", tuned ? `Play ${tuned.name}` : "Pick a station below");
    }
    paintVolume();
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
    fillRange(els.audioResponse);
    els.audioResponse.disabled = !window.MefiIdle?.setAudioResponse;
    els.audioResponseValue.textContent = `${Math.round((status?.response ?? .35) * 100)}%`;
    const tone = connected ? "on" : status?.error ? "error" : status?.pending ? "pending" : "off";
    if (els.audioState.dataset.tone !== tone) els.audioState.dataset.tone = tone;
    for (const [key, effect] of Object.entries(AUDIO_EFFECTS)) {
      els.audioEffects[key].checked = status?.effects?.[key] ?? effect.enabled;
      els.audioEffects[key].disabled = !window.MefiIdle?.setAudioEffects;
    }
    scheduleDropdown();
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
        // Find it here: the Links panel opens over whatever is playing, which
        // keeps playing until a result is chosen.
        if (window.mefiStudio?.youtubeSearch) button("Find on YouTube", "ghost music-suggestion-search", card, () => {
          settingsReveal.source = "link"; renderSourcePanels();
          els.linkInput.value = query; renderFinder(); void searchYouTube(query);
          els.dropdown.scrollTop = 0;
        });
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
    for (const [key, palette] of [...Object.entries(THEMES).filter(([key]) => isFreeTheme(key)), ["custom", { name: "Custom palette", bright: prefs.customColors.accent }]]) {
      const choice = button(palette.name, "music-theme", els.themes, () => applyTheme(key));
      choice.dataset.theme = key; choice.style.setProperty("--swatch", palette.bright); choice.setAttribute("aria-pressed", String(effective.theme === key));
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
    els.premiumThemes = premiumThemeChoices(themeSection);
    element("p", "music-fineprint", "Colors are separate from node style and layout.", themeSection);
    const nodeSection = element("section", "music-node-settings", null, settings);
    nodeSection.dataset.appearancePanel = "nodes";
    nodeSection.setAttribute("aria-labelledby", "music-node-heading");
    const nodeHeading = element("h3", null, "Node tree", nodeSection); nodeHeading.id = "music-node-heading";
    element("p", "music-node-intro", "Give your work a different shape. Changes appear on the live tree.", nodeSection);
    els.nodeStyles = graphChoices(nodeSection, "style", Object.fromEntries(Object.entries(NODE_STYLES).filter(([key]) => isFreeNodeStyle(key))), effective.nodeStyle, applyNodeStyle);
    els.premiumStyles = premiumStyleChoices(nodeSection);
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
    const dropdown = element("section", "music-dropdown", null, document.body);
    els.dropdown = dropdown; dropdown.id = "music-dropdown"; dropdown.hidden = true; dropdown.tabIndex = -1;
    dropdown.setAttribute("role", "dialog"); dropdown.setAttribute("aria-modal", "false"); dropdown.setAttribute("aria-labelledby", "music-dropdown-heading");
    // Header: the menu's name, one line on what is playing, and two quiet tools.
    const dropdownHeader = element("header", "music-dropdown-header", null, dropdown);
    els.dropdownHeader = dropdownHeader;
    const headingCopy = element("div", "music-dropdown-heading", null, dropdownHeader);
    const dropdownTitle = element("h2", null, "Music & video", headingCopy); dropdownTitle.id = "music-dropdown-heading";
    els.dropdownStatus = element("p", "music-dropdown-status", "Nothing playing", headingCopy);
    els.showLinks = button("Show links", "music-icon-button music-icon-eye", dropdownHeader, () => { mediaMenu.showLinks = !mediaMenu.showLinks; saveMediaMenu(); renderMediaMenu(); }, "music-show-links");
    els.showLinks.title = "Show or hide link addresses, for example while streaming";
    els.showLinks.setAttribute("aria-label", "Show link addresses");
    const closeButton = button("Close", "music-icon-button music-icon-close", dropdownHeader, () => closeAudio({ focus: true }), "music-dropdown-close");
    closeButton.title = "Close"; closeButton.setAttribute("aria-label", "Close Music & video");
    els.clipboardOffer = element("section", "music-clipboard-offer", null, dropdownHeader); els.clipboardOffer.id = "music-clipboard-offer"; els.clipboardOffer.hidden = true;
    const clipboardCopy = element("span", "music-clipboard-copy", null, els.clipboardOffer);
    els.clipboardTitle = element("strong", null, "", clipboardCopy); els.clipboardTitle.setAttribute("role", "status");
    els.clipboardUrl = element("small", null, "", clipboardCopy);
    const clipboardActions = element("div", "music-link-tools", null, els.clipboardOffer);
    for (const [action, label, className] of [["play", "Play", "primary mini"], ["queue", "Add to queue", "ghost mini"], ["next", "Play next", "ghost mini"], ["dismiss", "Dismiss", "music-icon-button music-icon-close"]]) {
      const offer = button(label, className, clipboardActions, () => useClipboardOffer(action), `music-clipboard-${action}`);
      if (action === "dismiss") { offer.title = "Dismiss"; offer.setAttribute("aria-label", "Dismiss the copied link"); }
    }
    const dropdownBody = element("div", "music-dropdown-body", null, dropdown);
    els.dropdownBody = dropdownBody;
    // What the last action did, where it is seen: under the header.
    els.notice = element("p", "music-notice", "", dropdownBody); els.notice.setAttribute("role", "status");
    // The tree's ear: whether it is listening, and to what.
    const connection = element("section", "music-connection", null, dropdownBody);
    connection.setAttribute("aria-label", "Node tree audio link");
    const connectionHead = element("div", "music-connection-head", null, connection);
    els.audioState = element("p", "music-audio-state", "Audio link off", connectionHead); els.audioState.id = "music-audio-state"; els.audioState.setAttribute("role", "status");
    els.audioToggle = button("Connect audio", "music-connect", connectionHead, () => {
      const status = window.MefiIdle?.audioStatus?.();
      window.MefiIdle?.setMusicReactive?.(!audioLinkEnabled(status));
      renderAudioLink();
    }, "music-audio-toggle");
    const audioControls = element("div", "music-audio-controls", null, connection);
    const sourceLabel = element("label", null, null, audioControls);
    element("span", null, "Tree listens to", sourceLabel);
    els.audioSource = element("select", null, null, sourceLabel); els.audioSource.id = "music-audio-source";
    for (const [value, title] of [["auto", "Auto · local or desktop"], ["local", "Local player"], ["desktop", "Desktop audio / Spotify"], ["mic", "Microphone"]]) {
      const option = element("option", null, title, els.audioSource); option.value = value;
    }
    els.audioSource.addEventListener("change", () => { window.MefiIdle?.setAudioSource?.(els.audioSource.value); renderAudioLink(); });
    els.audioHint = element("p", "music-fineprint", "", connection); els.audioHint.id = "music-audio-hint";
    els.audioSource.setAttribute("aria-describedby", els.audioHint.id);
    const main = element("section", "music-main", null, dropdownBody);
    main.id = "music-sound"; main.setAttribute("aria-labelledby", "music-sound-label");
    const soundLabel = element("p", "eyebrow music-group-label", "Sound", main); soundLabel.id = "music-sound-label"; soundLabel.tabIndex = -1;
    els.groups = { look: { group: settings, label: lookLabel }, sound: { group: main, label: soundLabel } };
    const tabs = element("div", "music-tabs", null, main); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Music source");
    els.localTab = button("Music files", "music-tab", tabs, () => setSource("local"), "music-local-tab");
    els.radioTab = button("Radio", "music-tab", tabs, () => setSource("radio"), "music-radio-tab");
    els.linkTab = button("Video & links", "music-tab", tabs, () => setSource("link"), "music-link-tab");
    els.localTab.title = "Audio files from your computer";
    els.radioTab.title = "Ad-free, listener-funded radio";
    els.linkTab.title = "YouTube, Spotify, SoundCloud, Vimeo and audio or video file links";
    const tabFor = (source) => source === "local" ? els.localTab : source === "radio" ? els.radioTab : els.linkTab;
    for (const [tab, panelId, source] of [[els.localTab, "music-local-panel", "local"], [els.radioTab, "music-radio-panel", "radio"], [els.linkTab, "music-link-panel", "link"]]) { tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", panelId); tab.dataset.source = source; }
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const order = ["local", "radio", "link"];
      const index = Math.max(0, order.indexOf(settingsReveal.source ?? state.source));
      const source = event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1]
        : order[(index + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length];
      setSource(source); tabFor(source).focus();
    });
    els.sourcePreview = element("p", "music-fineprint", null, main); els.sourcePreview.id = "music-source-preview"; els.sourcePreview.hidden = true; els.sourcePreview.setAttribute("role", "status");
    // Every source opens with the same player card: artwork, what is playing,
    // then its transport and volume. What to choose from follows below it.
    const card = (parent, kind) => {
      const node = element("div", "music-player", null, parent); node.dataset.kind = kind;
      const art = element("div", "music-art", null, node); art.setAttribute("aria-hidden", "true");
      const now = element("div", "music-now", null, node);
      const controls = element("div", "music-controls", null, node);
      return { node, art, now, controls, transport: element("div", "music-transport", null, controls) };
    };
    const volume = (parent, label, id, max = "1", step = ".01") => {
      const row = element("label", "music-volume", null, parent);
      element("span", "music-volume-icon", null, row).setAttribute("aria-hidden", "true");
      const input = element("input", null, null, row); input.type = "range"; input.min = "0"; input.max = max; input.step = step; input.setAttribute("aria-label", label);
      if (id) input.id = id;
      const value = element("output", "music-volume-value", "", row);
      return { row, input, value };
    };
    els.local = element("section", "music-local", null, main); els.local.id = "music-local-panel"; els.local.setAttribute("role", "tabpanel"); els.local.setAttribute("aria-labelledby", "music-local-tab");
    const localCard = card(els.local, "local"); els.localCard = localCard.node;
    element("span", "eyebrow", "Your music", localCard.now);
    els.trackTitle = element("h3", "music-title", null, localCard.now);
    els.trackSub = element("p", "music-subtitle", null, localCard.now);
    els.previous = button("Previous", "music-icon-button music-icon-prev", localCard.transport, () => audio.currentTime > 3 ? (audio.currentTime = 0) : move(-1), "music-previous");
    els.play = button("Play", "music-play-button", localCard.transport, () => state.source !== "local" || audio.paused ? void play() : audio.pause(), "music-play");
    els.next = button("Next", "music-icon-button music-icon-next", localCard.transport, () => move(1), "music-next");
    ({ input: els.volume, value: els.volumeValue } = volume(localCard.controls, "Music volume"));
    els.volume.addEventListener("input", () => setVolume(els.volume.value));
    const timeline = element("div", "music-timeline", null, localCard.node);
    els.elapsed = element("span", null, "0:00", timeline);
    els.seek = element("input", null, null, timeline); els.seek.id = "music-seek"; els.seek.type = "range"; els.seek.min = "0"; els.seek.step = ".1"; els.seek.setAttribute("aria-label", "Playback position");
    els.seek.addEventListener("input", () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(els.seek.value); renderTransport(); });
    els.duration = element("span", null, "0:00", timeline);
    const library = element("section", "music-library", null, els.local);
    const queueHead = element("div", "music-list-heading", null, library);
    element("h3", null, "Your queue", queueHead); els.queueCount = element("span", "music-count", "0", queueHead);
    button("Add files", "ghost mini music-add", queueHead, () => els.files.click(), "music-add-files").title = "Choose audio files, or drop them on this panel";
    els.files = element("input", null, null, library); els.files.id = "music-files"; els.files.type = "file"; els.files.multiple = true; els.files.accept = "audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac,.opus,.webm"; els.files.hidden = true;
    els.files.addEventListener("change", () => { addFiles(els.files.files); els.files.value = ""; });
    els.queue = element("ol", "music-queue", null, library); els.queue.id = "music-queue";
    element("p", "music-fineprint", "Files play straight from your computer and need choosing again after a restart. Drop them anywhere on this panel.", library);
    els.local.addEventListener("dragover", (event) => { event.preventDefault(); els.local.classList.add("drag-over"); });
    els.local.addEventListener("dragleave", () => els.local.classList.remove("drag-over"));
    els.local.addEventListener("drop", (event) => { event.preventDefault(); els.local.classList.remove("drag-over"); addFiles(event.dataTransfer?.files); });
    els.radio = element("section", "music-radio", null, main); els.radio.id = "music-radio-panel"; els.radio.setAttribute("role", "tabpanel"); els.radio.setAttribute("aria-labelledby", "music-radio-tab");
    const radioCard = card(els.radio, "radio"); els.radioCard = radioCard.node;
    element("span", "eyebrow", "Ad-free radio", radioCard.now);
    els.radioTitle = element("h3", "music-title", "Pick a station", radioCard.now);
    els.radioState = element("p", "music-radio-state", "No station tuned", radioCard.now);
    els.radioState.id = "music-radio-state"; els.radioState.setAttribute("role", "status");
    els.radioPrevious = button("Previous station", "music-icon-button music-icon-prev", radioCard.transport, () => stepStation(-1), "music-radio-previous");
    els.radioPlay = button("Play", "music-play-button", radioCard.transport, () => { if (station(state.station)) tune(state.station); }, "music-radio-play");
    els.radioStop = button("Stop radio", "music-play-button", radioCard.transport, () => { stopRadio(); render(); announce(); }, "music-radio-stop");
    els.radioStop.dataset.state = "playing"; els.radioStop.disabled = true;
    els.radioNext = button("Next station", "music-icon-button music-icon-next", radioCard.transport, () => stepStation(1), "music-radio-next");
    ({ input: els.radioVolume, value: els.radioVolumeValue } = volume(radioCard.controls, "Radio volume", "music-radio-volume"));
    els.radioVolume.value = String(prefs.volume);
    els.radioVolume.addEventListener("input", () => setVolume(els.radioVolume.value));
    const stationsHead = element("div", "music-list-heading", null, els.radio);
    element("h3", null, "Stations", stationsHead);
    element("span", "music-list-note", "No ads · listener-funded", stationsHead);
    const stationList = element("div", "music-stations", null, els.radio);
    stationList.setAttribute("role", "group"); stationList.setAttribute("aria-label", "Stations");
    els.stationButtons = {};
    for (const item of STATIONS) {
      const choice = button("", "music-station", stationList, () => tune(item.id), `music-station-${item.id}`);
      const copy = element("span", "music-station-copy", null, choice);
      element("strong", null, item.name, copy);
      element("small", null, `${item.detail} · ${item.origin}`, copy);
      choice.setAttribute("aria-pressed", "false");
      choice.title = `${item.name} — ${item.mirrors.length} mirror${item.mirrors.length === 1 ? "" : "s"}`;
      els.stationButtons[item.id] = choice;
    }
    element("p", "music-fineprint", "If a stream drops, Studio switches to a backup mirror and crosses over, so the music keeps going.", els.radio);
    els.link = element("section", "music-link", null, main); els.link.id = "music-link-panel"; els.link.setAttribute("role", "tabpanel"); els.link.setAttribute("aria-labelledby", "music-link-tab");
    const linkCard = card(els.link, "link");
    els.linkNow = linkCard.node; els.linkArt = linkCard.art;
    const nowCopy = element("span", "music-link-now-copy", null, linkCard.now);
    els.linkNowEyebrow = element("span", "eyebrow", "Video & links", nowCopy);
    els.linkNowTitle = element("strong", "music-title", null, nowCopy);
    els.linkNowDetail = element("small", "music-subtitle", null, nowCopy);
    els.linkToggle = button("Play", "music-play-button", linkCard.transport, toggleLink, "music-link-toggle");
    els.linkNext = button("Next video", "music-icon-button music-icon-next", linkCard.transport, nextVideo, "music-link-next");
    els.linkVolumeControls = element("div", "music-link-volume", null, linkCard.controls);
    els.linkMute = button("Mute", "music-icon-button music-icon-speaker", els.linkVolumeControls, () => { mediaMuted = !mediaMuted; saveLinkVolume(); applyLinkVolume(); }, "music-link-mute");
    ({ input: els.linkVolume, value: els.linkVolumeValue } = volume(els.linkVolumeControls, "Video volume", "music-link-volume", "100", "1"));
    els.linkVolume.addEventListener("input", () => { mediaVolume = Math.max(0, Math.min(1, (Number(els.linkVolume.value) || 0) / 100)); if (mediaVolume > 0) mediaMuted = false; saveLinkVolume(); applyLinkVolume(); });
    const nowTools = element("div", "music-link-tools music-link-actions", null, linkCard.node);
    els.linkPlace = element("span", "music-link-place", null, nowTools);
    button("Show player", "ghost mini", nowTools, () => { mountLink(); els.floatingPlayer?.reveal(); }, "music-link-show");
    button("Copy link", "ghost mini", nowTools, () => state.link && copyLink(state.link.url), "music-link-copy").title = "Copy the link to share it in Discord";
    button("Open ↗", "ghost mini", nowTools, () => state.link && openLink(state.link.url), "music-link-open").title = "Open the original page";
    button("Stop", "ghost mini music-link-stop", nowTools, stopLink, "music-link-stop").title = "Stop playback and close the player";
    els.linkPlayer = element("div", "music-link-player", null, els.link);
    // How the picture shows: the everyday switch stays on the card, the finer
    // settings fold away under Picture.
    els.videoSettings = element("details", "music-video-settings music-fold", null, els.link);
    element("summary", null, "Picture & background", els.videoSettings);
    const videoBody = element("div", "music-fold-body", null, els.videoSettings);
    els.floatingPlayer = window.MefiMediaWindow?.create({
      content: els.linkPlayer,
      settingsHost: els.videoSettings,
      controlsHost: videoBody,
      quickHost: els.linkPlace,
      onSettings: () => open("sound"),
      onClose: () => { unmountLink(); state.link = null; render(); announce(); },
    });
    // Find or paste: one field. A link plays; words search YouTube.
    const finder = element("section", "music-finder", null, els.link);
    const linkForm = element("form", "music-link-form music-omnibox", null, finder);
    els.linkInput = element("input", null, null, linkForm); els.linkInput.id = "music-link-url"; els.linkInput.type = "text"; els.linkInput.placeholder = "Search YouTube or paste a link"; els.linkInput.setAttribute("aria-label", "Search YouTube or paste a media link");
    els.linkInput.autocomplete = "off"; els.linkInput.spellcheck = false; els.linkInput.maxLength = 2048;
    els.linkGo = button("Play", "primary", linkForm, submitFinder, "music-link-load");
    linkForm.addEventListener("submit", (event) => { event.preventDefault(); submitFinder(); });
    els.linkInput.addEventListener("input", renderFinder);
    els.linkQueueTools = element("div", "music-link-tools", null, finder);
    button("Add to queue", "ghost mini", els.linkQueueTools, () => queueLink(finderLink(els.linkInput.value)?.url || els.linkInput.value), "music-link-queue-add");
    button("Play next", "ghost mini", els.linkQueueTools, () => queueLink(finderLink(els.linkInput.value)?.url || els.linkInput.value, null, true), "music-link-queue-first");
    els.linkHandoff = element("div", "music-link-handoff", null, finder); els.linkHandoff.id = "music-link-handoff"; els.linkHandoff.hidden = true;
    els.youtubeNotice = element("p", "music-fineprint music-finder-note", "", finder); els.youtubeNotice.setAttribute("role", "status");
    els.youtubeResults = element("div", "music-youtube-results", null, finder); els.youtubeResults.id = "music-youtube-results";
    els.recentBlock = element("div", "music-recent-block", null, finder);
    element("span", "music-list-note", "Recent", els.recentBlock);
    els.recent = element("div", "music-recent", null, els.recentBlock); els.recent.setAttribute("aria-label", "Recent links");
    const queue = element("section", "music-link-queue", null, els.link); queue.setAttribute("aria-label", "Video queue");
    const queueHeader = element("div", "music-list-heading", null, queue);
    els.linkQueueHeading = element("h3", null, "Up next", queueHeader); els.linkQueueHeading.setAttribute("aria-live", "polite");
    els.linkQueueNext = button("Play next video", "ghost mini", queueHeader, () => playQueued(), "music-link-queue-next");
    els.linkQueueEmpty = element("p", "music-fineprint", "Nothing queued. Add a search result with + or paste a link and choose Add to queue.", queue);
    els.linkQueueList = element("ol", "music-link-queue-list", null, queue); els.linkQueueList.id = "music-link-queue-list";
    renderLinkQueue();
    // renderer/together.js fills this with Listen together and the now-playing
    // share (both need the rooms hub).
    els.together = element("section", "music-together", null, els.link); els.together.hidden = true;
    const linkFooter = element("div", "music-link-footer", null, els.link);
    const copiedLinksLabel = element("label", "music-clipboard-toggle", null, linkFooter);
    els.copiedLinks = element("input", null, null, copiedLinksLabel); els.copiedLinks.id = "music-copied-links"; els.copiedLinks.type = "checkbox";
    element("span", null, "Offer links I copy", copiedLinksLabel);
    copiedLinksLabel.title = "While this menu is open, a media link on your clipboard appears at the top with Play and Add to queue";
    els.copiedLinks.addEventListener("change", () => {
      mediaMenu.copiedLinks = els.copiedLinks.checked; saveMediaMenu();
      clipboardOffer = null; renderClipboardOffer();
      if (mediaMenu.copiedLinks) { lastClipboardUrl = null; startClipboardChecks(); } else stopClipboardChecks();
    });
    element("p", "music-fineprint", "Queued videos move on by themselves when one ends. YouTube and Vimeo pick up where they left off if Studio reopens within ten minutes. For the tree to follow a video, set the tree to Desktop audio.", linkFooter);
    els.link.addEventListener("dragover", (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      if (!types.includes("text/uri-list") && !types.includes("text/plain")) return;
      event.preventDefault(); els.link.classList.add("drag-over");
    });
    els.link.addEventListener("dragleave", () => els.link.classList.remove("drag-over"));
    els.link.addEventListener("drop", (event) => {
      const text = droppedLink(event.dataTransfer);
      els.link.classList.remove("drag-over");
      if (!text) return;
      event.preventDefault();
      playLink(text);
    });
    // Less often needed: how the tree reacts, and music ideas.
    const audioLink = element("details", "music-audio-link music-fold", null, dropdownBody);
    els.audioLink = audioLink;
    audioLink.id = "music-audio-reactions";
    audioLink.setAttribute("aria-labelledby", "music-audio-heading");
    const audioHeading = element("summary", null, "Tree reactions", audioLink); audioHeading.id = "music-audio-heading";
    const audioBody = element("div", "music-fold-body", null, audioLink);
    const responseLabel = element("label", "music-audio-response", null, audioBody);
    element("span", null, "Response", responseLabel);
    els.audioResponse = element("input", null, null, responseLabel); els.audioResponse.id = "music-audio-response";
    els.audioResponse.type = "range"; els.audioResponse.min = "0"; els.audioResponse.max = "2"; els.audioResponse.step = "0.05";
    els.audioResponseValue = element("output", null, "35%", responseLabel); els.audioResponseValue.setAttribute("for", els.audioResponse.id);
    els.audioResponse.addEventListener("input", () => { window.MefiIdle?.setAudioResponse?.(Number(els.audioResponse.value)); renderAudioLink(); });
    const responseHint = element("p", "music-fineprint", "How strongly the tree moves with the sound. 0% settles it without changing the volume.", audioBody); responseHint.id = "music-audio-response-hint";
    els.audioResponse.setAttribute("aria-label", "Audio response strength"); els.audioResponse.setAttribute("aria-describedby", responseHint.id);
    const audioEffectsHeading = element("h4", "music-node-label", "Reactions", audioBody); audioEffectsHeading.id = "music-audio-effects-label";
    const audioEffects = element("div", "music-effects music-audio-effects", null, audioBody); audioEffects.setAttribute("role", "group"); audioEffects.setAttribute("aria-labelledby", audioEffectsHeading.id);
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
    window.MefiTreeDynamics?.mount(audioBody, "audio");
    const aside = element("details", "music-side music-fold", null, dropdownBody);
    els.recommendations = aside;
    element("summary", null, "Music ideas", aside);
    const ai = element("section", "music-section music-ai music-fold-body", null, aside);
    const moodLabel = element("label", "music-mood-label", "What are you in the mood for?", ai);
    els.mood = element("textarea", null, null, moodLabel); els.mood.id = "music-mood"; els.mood.rows = 3; els.mood.maxLength = 600; els.mood.placeholder = "Warm ambient, no vocals, a little energy…";
    els.recommend = button("Ask for recommendations", "ghost", ai, () => void recommend(), "music-recommend");
    els.aiHint = element("p", "music-fineprint", null, ai);
    els.recommendation = element("div", "music-recommendation", "", ai); els.recommendation.id = "music-recommendation"; els.recommendation.setAttribute("aria-live", "polite");
    // Every slider shows how full it is; the fill follows the value.
    dropdown.addEventListener("input", (event) => { if (event.target?.type === "range") fillRange(event.target); });
    dropdown.addEventListener("keydown", audioKey);
    dropdown.addEventListener("pointerenter", cancelAudioHoverTimers);
    dropdown.addEventListener("pointerleave", leaveAudioHover);
    dropdown.addEventListener("pointerdown", pinAudioDropdown);
    dropdown.addEventListener("focusin", pinAudioDropdown);
    dropdown.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !dropdown.contains(event.relatedTarget) && !dropdownAnchor?.contains(event.relatedTarget) && !audioSelectContains(event.relatedTarget)) closeAudio();
    });
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
  // Height follows the visible controls. Width grows for stations and video;
  // only the available space below the opener limits the scrollable panel.
  function positionDropdown() {
    dropdownFrame = 0;
    if (els.dropdown?.hidden !== false) return;
    const edge = 12;
    const width = window.innerWidth || 1024, height = window.innerHeight || 768;
    const anchor = dropdownAnchor?.getBoundingClientRect?.();
    const strip = dropdownAnchor?.closest?.(".cmd-tools")?.getBoundingClientRect?.();
    const bottom = anchor?.height ? Math.max(anchor.bottom, strip?.bottom || 0) : 64;
    const above = anchor?.height ? Math.max(0, anchor.top - 8 - edge) : 0;
    const below = height - bottom - 8 - edge;
    const flip = below < 280 && above > below && above >= 240;
    const top = flip ? edge : Math.max(edge, Math.min(bottom + 8, height - 280));
    const panelWidth = els.dropdown.getBoundingClientRect().width;
    const right = anchor?.width ? width - anchor.right : edge;
    els.dropdown.style.top = `${Math.round(top)}px`;
    els.dropdown.style.right = `${Math.round(Math.max(edge, Math.min(right, width - panelWidth - edge)))}px`;
    els.dropdown.style.maxHeight = `${Math.max(0, flip ? above : height - top - edge)}px`;
    // A floating player never sits on top of the menu that controls it.
    els.floatingPlayer?.avoid?.(els.dropdown.getBoundingClientRect());
  }
  function scheduleDropdown() {
    if (els.dropdown?.hidden !== false || dropdownFrame) return;
    if (typeof window.requestAnimationFrame === "function") dropdownFrame = window.requestAnimationFrame(positionDropdown);
    else positionDropdown();
  }
  function audioOutside(event) {
    if (!els.dropdown?.contains(event.target) && !dropdownAnchor?.contains(event.target) && !audioSelectContains(event.target)) closeAudio();
  }
  function audioSelectContains(target) {
    return window.MefiSelect?.owns?.(els.dropdown) && window.MefiSelect?.contains?.(target);
  }
  function audioKey(event) {
    if (event.key === "Escape" && els.dropdown?.hidden === false) {
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
    const toolbar = document.getElementById?.("idle-music-toggle");
    dropdownAnchor = anchor || (toolbar?.getBoundingClientRect?.().width ? toolbar : document.getElementById?.("settings-audio-open"));
    dropdownFocus = document.activeElement;
    dropdownHover = hover;
    dropdownAnchor?.setAttribute("aria-expanded", "true");
    els.dropdown.hidden = false;
    mountLink(); render(); positionDropdown();
    startClipboardChecks();
    // Every opening starts at the top, where the source tabs, what is playing
    // and its settings are, even if the last visit ended down in the queue.
    els.dropdown.scrollTop = 0;
    document.addEventListener("pointerdown", audioOutside);
    document.addEventListener("keydown", audioKey, true);
    window.addEventListener("scroll", scheduleDropdown, true);
    if (!hover) els.dropdown.focus({ preventScroll: true });
  }
  function closeAudio({ focus = false } = {}) {
    stopClipboardChecks();
    cancelAudioHoverTimers();
    dropdownHover = false;
    if (els.dropdown?.hidden !== false) return;
    if (window.MefiSelect?.owns?.(els.dropdown)) window.MefiSelect.close();
    els.dropdown.hidden = true;
    els.floatingPlayer?.avoid?.(null);
    dropdownAnchor?.setAttribute("aria-expanded", "false");
    document.removeEventListener?.("pointerdown", audioOutside);
    document.removeEventListener?.("keydown", audioKey, true);
    window.removeEventListener?.("scroll", scheduleDropdown, true);
    if (dropdownFrame) window.cancelAnimationFrame?.(dropdownFrame);
    dropdownFrame = 0;
    settingsReveal.source = null;
    if (focus) (dropdownAnchor || dropdownFocus)?.focus?.({ preventScroll: true });
    dropdownAnchor = null; dropdownFocus = null;
  }
  function toggleAudio(anchor) {
    if (els.dropdown?.hidden === false && dropdownHover) openAudio(anchor);
    else if (els.dropdown?.hidden === false) closeAudio({ focus: true });
    else openAudio(anchor);
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
    let recentLink;
    try { recentLink = JSON.parse(localStorage.getItem(LINK_RESUME_KEY) || "null"); localStorage.removeItem(LINK_RESUME_KEY); } catch {}
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
    // per session and must be chosen again; a link returns to the Links tab
    // and its player mounts, without playing, when the dropdown opens, so nothing
    // is fetched from the service before then.
    const lastLink = prefs.source === "link" ? playableLink(mediaLink(prefs.links[0])) : null;
    if (lastLink) { state.link = lastLink; state.source = "link"; }
    else if (prefs.source === "radio") state.source = "radio";
    // A member's premium choice is painted straight away, in place of the free
    // one rather than after it, and nothing is written back.
    const unlocked = premiumAllowed();
    if (unlocked && premium.nodeStyle) effective.nodeStyle = premium.nodeStyle;
    build();
    for (const id of ["idle-music-toggle", "settings-audio-open"]) bindAudioHover(document.getElementById(id));
    window.addEventListener("blur", () => closeAudio());
    if (unlocked && premium.theme) event("mefi-theme-change", paintTheme(premium.theme));
    else applyTheme(prefs.theme, false);
    syncTreePreferences(false); renderPremiumLocks(unlocked); render(); renderMediaMenu();
    if (lastLink) els.linkInput.value = lastLink.url;
    // A station that was sounding when Studio closed is tuned again. Smoke and
    // capture runs share the owner's profile, so they stay silent.
    const headless = /[?&](?:smoke|capture)=1(?:&|$)/.test(String(window.location?.search || ""));
    if (state.source === "radio" && prefs.radioOn && station(state.station) && !headless) tune(state.station, 0, false, true);
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
    window.addEventListener("mefi-community-change", (event) => syncPremium(typeof event?.detail?.premium === "boolean" ? event.detail.premium : premiumAllowed()));
    // Linking can become possible or moot with the entitlement unchanged.
    window.addEventListener("mefi-community-status", () => renderPremiumLocks());
    // Settings can preview a Void look without opening the canvas. Auxiliary
    // overlays leave Settings underneath, so only a page change ends it.
    window.addEventListener("mefi:nav", (event) => {
      if (event?.detail?.action !== "open") return;
      const id = event.detail.id;
      if (id === "audio" || id === "music" && (event.detail.params === "sound" || event.detail.params?.group === "sound")) return;
      closeAudio();
      if (["studio", "music", "appearancePreview"].includes(id)) return;
      const kind = window.MefiNav?.get?.(id)?.kind;
      if (kind === "overlay" || kind === "action") return;
      endPreview();
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
      if (!keepLook) endPreview();
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
    renderPremiumLocks(); render();
  }
  function activateSettings(category) {
    const active = category === "appearance" && document.getElementById("tab-studio")?.hidden === false && Boolean(els.settingsStage) && !state.opened;
    setSettingsAppearance(active);
    if (category !== "appearance" && settingsReveal.custom) {
      settingsReveal.custom = false;
      if (els.customPalette) els.customPalette.hidden = effective.theme !== "custom";
    }
    if (category !== "audio" && settingsReveal.source) { settingsReveal.source = null; renderSourcePanels(); }
  }
  function revealSettingsTarget(target) {
    init();
    for (let node = target; node; node = node.parentElement ?? node.parentNode) {
      if (node.dataset?.appearancePanel) selectAppearanceSection(node.dataset.appearancePanel);
      if (node === els.customPalette) {
        selectAppearanceSection("themes");
        settingsReveal.custom = true; els.customPalette.hidden = false;
        return true;
      }
      for (const source of ["local", "radio", "link"]) if (node === els[source]) {
        settingsReveal.source = source;
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
    renderPremiumLocks();
    render(); syncTreeView(); els.sheet.focus(); schedulePreview();
  }
  function close() {
    if (!els.overlay || els.overlay.hidden) return;
    endPreview();
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
  window.MefiMusic = { init, open, openPreview, openAudio, closeAudio, toggleAudio, mountSettings, activateSettings, revealSettingsTarget, settingsAppearanceActive: () => settingsAppearance, leaveSettingsAppearance: (options) => setSettingsAppearance(false, options), close, status, graphPreferences, applyNodeStyle, applyNodeLayout, applyNodeEffects, getAudioElement: () => { init(); return activeDeck(); }, tune, stopRadio,
    stations: () => STATIONS.map((item) => ({ id: item.id, name: item.name, detail: item.detail, origin: item.origin, mirrors: item.mirrors.length })), setRecommender: (fn) => { recommender = typeof fn === "function" ? fn : null; render(); }, addFiles, setSource, applyTheme, applyCustomColors,
    // The free palettes as swatches, and the one on screen (Vibe's settings panel).
    themes: () => Object.entries(THEMES).filter(([, theme]) => theme.premium !== true).map(([key, theme]) => ({ key, name: theme.name, accent: theme.accent, bright: theme.bright, bg: theme.bg, panel: theme.panel })), theme: () => effective.theme,
    // Links from anywhere in Studio (a chat, a mirrored Discord room): linkInfo
    // says whether and how a link plays, without touching the player.
    playLink, loadSpotify: (raw) => playLink(raw),
    // For renderer/together.js: the Links player that is mounted right now
    // (an iframe, or the <video> of a plain file), and where its section goes.
    linkElement: () => { const frame = els.linkFrame; return frame && state.link && state.source === "link" ? { url: state.link.url, kind: state.link.kind, provider: state.link.provider, element: frame } : null; },
    togetherHost: () => { init(); return els.together; },
    linkInfo: (raw) => { const link = mediaLink(raw); return link ? { provider: link.provider, providerName: link.providerName, kind: link.kind, label: link.label, url: link.url, playable: Boolean(playableLink(link)) } : null; },
    customColors: () => ({ ...prefs.customColors }), themePalette,
    // isNodeStyle is for the tree painters; the catalog feeds Settings › Community.
    isNodeStyle,
    premiumCatalog: () => ({
      themes: Object.entries(THEMES).filter(([key]) => isPremiumTheme(key)).map(([key, theme]) => ({ key, name: theme.name, accent: theme.accent, bright: theme.bright, accent2: theme.accent2 })),
      nodeStyles: Object.entries(NODE_STYLES).filter(([key]) => isPremiumNodeStyle(key)).map(([key, style]) => ({ key, name: style.name, detail: style.detail })),
    }) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
