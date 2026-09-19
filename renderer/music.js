// Studio's own local-file player. Streaming stays inside Spotify's official
// embed; its cross-origin playback state is deliberately not guessed.
(() => {
  "use strict";
  const STORAGE_KEY = "mefiStudio.music.v1";
  const THEMES = {
    gold: { name: "Studio gold", accent: "#c9a86a", bright: "#e6c98d", rgb: "201,168,106", bg: "#050507", panel: "#0d0e12", muted: "#aaa18f" },
    midnight: { name: "Midnight", accent: "#82a8e6", bright: "#bbd5ff", rgb: "130,168,230", bg: "#050913", panel: "#0d1524", muted: "#a2b2ca" },
    forest: { name: "Forest", accent: "#85bca3", bright: "#b4e1c9", rgb: "133,188,163", bg: "#050d0b", panel: "#0d1915", muted: "#a2b8ae" },
    violet: { name: "Violet", accent: "#b297de", bright: "#dcc4ff", rgb: "178,151,222", bg: "#0c0711", panel: "#181120", muted: "#b5a7c4" },
    ember: { name: "Ember", accent: "#dd997a", bright: "#ffc5a9", rgb: "221,153,122", bg: "#100805", panel: "#21150f", muted: "#c0ab9d" },
  };

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
    return { theme: Object.hasOwn(THEMES, raw.theme) ? raw.theme : "gold", volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .7, spotify };
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
  const state = { source: "local", tracks: [], selected: -1, spotify: null, opened: false, sending: false, notice: "", error: false };
  const els = {};
  let audio = null;
  let initialized = false;
  let recommender = null;
  let priorFocus = null;

  const persist = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(safePreferences(prefs))); } catch {} };
  const event = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  function status() {
    const track = state.tracks[state.selected];
    const title = state.source === "spotify" ? state.spotify ? `Spotify ${state.spotify.type}` : "Choose Spotify music" : track?.title || "Choose your music";
    return { source: state.source, playing: state.source === "local" && Boolean(audio?.src) && !audio.paused && !audio.ended, title, track: title, theme: prefs.theme, queueLength: state.tracks.length, externalPlayback: state.source === "spotify", supported: true };
  }
  const announce = () => event("mefi-music-change", status());
  function note(text, error = false) {
    state.notice = String(text || ""); state.error = error;
    if (els.notice) { els.notice.textContent = state.notice; els.notice.dataset.error = String(error); }
  }
  function applyTheme(theme, save = true) {
    const key = Object.hasOwn(THEMES, theme) ? theme : "gold";
    const palette = THEMES[key];
    prefs.theme = key;
    const tokens = { "--gold": palette.accent, "--gold-bright": palette.bright, "--gold-dim": `rgba(${palette.rgb},.32)`, "--hairline": `rgba(${palette.rgb},.18)`, "--hairline-strong": `rgba(${palette.rgb},.4)`, "--tint-gold-1": `rgba(${palette.rgb},.06)`, "--tint-gold-2": `rgba(${palette.rgb},.09)`, "--tint-gold-3": `rgba(${palette.rgb},.14)`, "--ring": `0 0 0 3px rgba(${palette.rgb},.15)`, "--glow-gold": `0 0 14px rgba(${palette.rgb},.3)`, "--bg": palette.bg, "--bg-deep": palette.bg, "--cmd-bg": palette.bg, "--panel-solid": palette.panel, "--muted": palette.muted };
    for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, value);
    document.documentElement.style.setProperty("--studio-accent-rgb", palette.rgb);
    document.documentElement.dataset.studioTheme = key;
    for (const button of els.themes?.children || []) button.setAttribute("aria-pressed", String(button.dataset.theme === key));
    if (save) persist();
    event("mefi-theme-change", { theme: key, accent: palette.accent, bright: palette.bright, background: palette.bg });
    return key;
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
  function setSource(source) {
    const next = source === "spotify" ? "spotify" : "local";
    if (next !== state.source) audio?.pause();
    state.source = next;
    if (next === "local" && els.embed) { els.embed.remove(); els.embed = null; }
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
    els.local.hidden = !local; els.spotify.hidden = local;
    els.localTab.setAttribute("aria-selected", String(local));
    els.spotifyTab.setAttribute("aria-selected", String(!local));
    renderTransport(); renderQueue();
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
    sheet.tabIndex = -1; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "music-heading");
    els.sheet = sheet;
    const header = element("header", "music-header", null, sheet);
    const heading = element("div", null, null, header);
    element("span", "eyebrow", "Make room for a little rhythm", heading);
    const title = element("h2", null, "Music & atmosphere", heading); title.id = "music-heading";
    button("Close", "ghost", header, close, "music-close");
    const body = element("div", "music-body", null, sheet);
    const main = element("main", "music-main", null, body);
    const tabs = element("div", "music-tabs", null, main); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Music source");
    els.localTab = button("Local music", "music-tab", tabs, () => setSource("local"), "music-local-tab");
    els.spotifyTab = button("Spotify", "music-tab", tabs, () => setSource("spotify"), "music-spotify-tab");
    for (const [tab, panelId] of [[els.localTab, "music-local-panel"], [els.spotifyTab, "music-spotify-panel"]]) { tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", panelId); }
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const source = event.key === "Home" ? "local" : event.key === "End" ? "spotify" : state.source === "local" ? "spotify" : "local";
      setSource(source); (source === "local" ? els.localTab : els.spotifyTab).focus();
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
    els.volume.addEventListener("input", () => { audio.volume = Number(els.volume.value); prefs.volume = audio.volume; persist(); });
    const queueHead = element("div", "music-queue-heading", null, els.local);
    element("h3", null, "Your queue", queueHead); els.queueCount = element("span", "music-count", "0", queueHead);
    els.queue = element("ol", "music-queue", null, els.local); els.queue.id = "music-queue";
    element("p", "music-fineprint", "Local playback needs no account. Reselect your files after restarting Studio.", els.local);
    els.local.addEventListener("dragover", (event) => { event.preventDefault(); els.local.classList.add("drag-over"); });
    els.local.addEventListener("dragleave", () => els.local.classList.remove("drag-over"));
    els.local.addEventListener("drop", (event) => { event.preventDefault(); els.local.classList.remove("drag-over"); addFiles(event.dataTransfer?.files); });
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
    const aside = element("aside", "music-side", null, body);
    const themeSection = element("section", "music-section", null, aside);
    element("span", "eyebrow", "Set the mood", themeSection); element("h3", null, "Studio theme", themeSection);
    els.themes = element("div", "music-themes", null, themeSection);
    for (const [key, palette] of Object.entries(THEMES)) {
      const choice = button(palette.name, "music-theme", els.themes, () => applyTheme(key));
      choice.dataset.theme = key; choice.style.setProperty("--swatch", palette.bright); choice.setAttribute("aria-pressed", String(prefs.theme === key));
    }
    const ai = element("section", "music-section music-ai", null, aside);
    element("span", "eyebrow", "A listening companion", ai); element("h3", null, "Find your next sound", ai);
    const moodLabel = element("label", "music-mood-label", "What are you in the mood for?", ai);
    els.mood = element("textarea", null, null, moodLabel); els.mood.id = "music-mood"; els.mood.rows = 3; els.mood.maxLength = 600; els.mood.placeholder = "Warm ambient, no vocals, a little energy…";
    els.recommend = button("Ask for recommendations", "ghost", ai, () => void recommend(), "music-recommend");
    els.aiHint = element("p", "music-fineprint", null, ai);
    els.recommendation = element("div", "music-recommendation", "", ai); els.recommendation.id = "music-recommendation"; els.recommendation.setAttribute("aria-live", "polite");
    els.notice = element("p", "music-notice", "", sheet); els.notice.setAttribute("role", "status");
    els.overlay.addEventListener("click", (event) => { if (event.target === els.overlay) close(); });
    sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab" && !window.MefiNav?.claim) {
        const focusable = [...sheet.querySelectorAll("button, input, textarea, iframe")].filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
  }
  function init() {
    if (initialized) return;
    initialized = true;
    audio = document.createElement("audio"); audio.preload = "metadata"; audio.volume = prefs.volume;
    audio.addEventListener("play", () => { renderTransport(); announce(); });
    audio.addEventListener("pause", () => { renderTransport(); announce(); });
    audio.addEventListener("ended", () => move(1, false));
    audio.addEventListener("timeupdate", renderTransport); audio.addEventListener("loadedmetadata", renderTransport); audio.addEventListener("durationchange", renderTransport);
    audio.addEventListener("error", () => { if (audio.src) note("This audio file could not be played. Try another format.", true); renderTransport(); announce(); });
    build(); applyTheme(prefs.theme, false); render();
    window.addEventListener("beforeunload", () => { for (const track of state.tracks) URL.revokeObjectURL(track.url); });
  }
  function open() {
    init(); priorFocus = document.activeElement; state.opened = true; els.overlay.hidden = false;
    window.MefiNav?.claim?.("music");
    render(); els.sheet.focus();
  }
  function close() {
    if (!els.overlay || els.overlay.hidden) return;
    state.opened = false; els.overlay.hidden = true;
    window.MefiNav?.release?.("music");
    if (!window.MefiNav?.release) priorFocus?.focus?.();
  }
  window.MefiMusic = { init, open, close, status, getAudioElement: () => { init(); return audio; }, setRecommender: (fn) => { recommender = typeof fn === "function" ? fn : null; render(); }, addFiles, loadSpotify, setSource, applyTheme };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
