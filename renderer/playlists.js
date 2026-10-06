// Playlists: lists of videos and links to play, line up, keep and share, in
// the media menu's Playlists section. music.js hands over the section and the
// player (MefiMusic.playlists); a list plays and queues only through those
// hands. Studio ships a few starting points, and a list you make, copy or add
// is kept on this PC (mefiStudio.playlists.v1).
//
// A list travels as plain text that reads well in Discord or a room: its
// name, one numbered line per video ending in the video's link, and, when
// every video is on YouTube, a link that plays the lot on YouTube for anyone
// without Studio. Pasting that text, or only that YouTube link, into Add a
// shared playlist or the Browse box brings it back as a list of your own.
(() => {
  "use strict";
  const STORE = "mefiStudio.playlists.v1";
  const LIST_LIMIT = 40, ITEM_LIMIT = 50, NAME_LIMIT = 80, TITLE_LIMIT = 160, TEXT_LIMIT = 24000;
  const SHARE_HEAD = "Mefi Studio playlist:";
  const PLAY_ALL = "Play all on YouTube:";
  const DISCORD_MESSAGE = 2000;
  // Drags: a row of your own list (reordering), and the media menu's own
  // types (music.js), so a row drops onto Up next and an Up next row here.
  const ROW_DRAG = "application/x-mefi-playlist-row", MEDIA_DRAG = "application/x-mefi-media", QUEUE_DRAG = "application/x-mefi-queue";

  // Starting points: real uploads, looked up on YouTube on 5 October 2026.
  // The three radios in Focus streams are Lofi Girl's live streams.
  const video = (id, title, channel, duration = "") => ({ url: `https://www.youtube.com/watch?v=${id}`, title, channel, duration });
  const STARTERS = [
    { id: "explorers", name: "Code & math explorers", about: "Coding adventures, solved games, living simulations and the shapes behind the math.",
      more: ["Sebastian Lague", "2swap", "3Blue1Brown", "Emergent Garden"], items: [
        video("Qz0KTGYJtUk", "Coding Adventure: Ray Tracing", "Sebastian Lague", "37:58"),
        video("aircAruvnKk", "But what is a neural network? | Deep learning chapter 1", "3Blue1Brown", "18:40"),
        video("KaljD3Q3ct0", "I Solved Connect 4", "2swap", "18:56"),
        video("2g-CrQfYNtE", "Artificial Life", "Emergent Garden", "35:05"),
        video("rSKMYc1CQHE", "Coding Adventure: Simulating Fluids", "Sebastian Lague", "47:52"),
        video("d4EgbgTm0Bg", "Visualizing the 4d numbers Quaternions", "3Blue1Brown", "31:51"),
        video("dtjb2OhEQcU", "Double Pendulums are Chaoticn't", "2swap", "8:58"),
        video("TkwXa7Cvfr8", "Watching Neural Networks Learn", "Emergent Garden", "25:28"),
        video("U4ogK0MIzqk", "Coding Adventure: Chess", "Sebastian Lague", "29:22"),
        video("LPZh9BOjkQs", "Large Language Models explained briefly", "3Blue1Brown", "7:58"),
        video("Ed1gsyxxwM0", "Mandelbrot's Evil Twin", "2swap", "7:47"),
        video("0HqUYpGQIfs", "Emergent Complexity", "Emergent Garden", "32:40"),
      ] },
    { id: "visualizers", name: "Visualizers", about: "Fractal zooms, MilkDrop and VJ loops that run for hours. Try one with Play behind your workspace.",
      more: ["Mandelbrot fractal zoom", "MilkDrop visualizer", "4K VJ loops"], items: [
        video("pCpLWbHVNhk", "Eye of the Universe - Mandelbrot Fractal Zoom", "Maths Town", "1:11:00"),
        video("Y_a6MzuAgHk", "Psychedelic Trance Winamp Visualization Milkdrop Mix", "Speed Music", "2:59:56"),
        video("QFRPF9OQ3eA", "Cosmic Bloom | 2 Hour Generative Visual Journey in 4K", "AntisocialApe", "2:01:24"),
        video("ZWyv_w_cFiw", "NEON CITY | Cyberpunk Night Flight | Music Visualizer", "CYBERLOPOD", "4:00:01"),
        video("uEoo2kawyHg", "My Favorite Milkdrop 2 Visualizations 4K 60", "Chron", "17:23"),
        video("Yh8OY286HDc", "The Colour of Infinity - Mandelbrot Fractal Zoom", "Maths Town", "2:16:56"),
        video("FwIHSDiFye8", "3 Hours of Amazing DJ Visuals - VJ Loops (4K)", "LOOPY LAD", "3:11:51"),
        video("qirWins5tus", "Winamp Visualization 12 Hours (4K) / MilkDrop, no audio", "Jay Mayor", "12:00:00"),
      ] },
    { id: "focus", name: "Focus streams", about: "Lofi, jazz and synthwave that keep going while you build. The three radios are live.",
      more: ["lofi hip hop", "synthwave mix", "ambient music for focus"], items: [
        video("rFZHOHl-L8A", "lofi hip hop radio: beats to relax/study to", "Lofi Girl"),
        video("4xDzrJKXOOY", "synthwave radio: beats to chill/game to", "Lofi Girl"),
        video("fhL67fnDXcU", "coding music: synthwave beats to program to", "Lofi Girl", "3:00:00"),
        video("E2vONfzoyRI", "jazz lofi radio: beats to chill/study to", "Lofi Girl"),
        video("lTRiuFIWV54", "1 A.M Study Session [lofi hip hop]", "Lofi Girl", "1:01:14"),
        video("TlWYgGyNnJo", "1 A.M Chill Session [synthwave]", "Lofi Girl", "2:29:12"),
        video("CFGLoQIhmow", "lofi hip hop mix: beats to relax/study to (Part 1)", "Lofi Girl", "2:50:41"),
      ] },
    { id: "graphics", name: "Shaders & graphics", about: "How games and demos draw what they draw, from painting with math to faking water.",
      more: ["Acerola", "Inigo Quilez", "Freya Holmér"], items: [
        video("0ifChJ0nJfM", "Learn to Paint with Mathematics", "Inigo Quilez", "24:02"),
        video("PH9q0HNBjT4", "How Games Fake Water", "Acerola", "22:52"),
        video("Cp5WWtMoeKg", "Coding Adventure: Ray Marching", "Sebastian Lague", "5:06"),
        video("jvPPXbo87ds", "The Continuity of Splines", "Freya Holmér", "1:13:50"),
        video("Y0Ko0kvwfgA", "How Do Games Render So Much Grass?", "Acerola", "15:52"),
        video("BFld4EBO2RE", "I painted a Landscape with Mathematics", "Inigo Quilez", "42:00"),
        video("8wOUe32Pt-E", "Color Quantization and Dithering", "Acerola", "11:55"),
        video("SO83KQuuZvg", "Coding Adventure: Rendering Text", "Sebastian Lague", "1:10:54"),
        video("kfM-yu0iQBk", "Shader Basics, Blending & Textures (Shaders for Game Devs, Part 1)", "Freya Holmér", "3:53:11"),
      ] },
    { id: "simulated", name: "Simulated worlds", about: "Evolution, ecosystems and emergence, one simulation at a time.",
      more: ["Primer", "The Coding Train", "Emergent Garden"], items: [
        video("0ZGbIKd0XrM", "Simulating Natural Selection", "Primer", "10:00"),
        video("X-iSQQgOd1A", "Coding Adventure: Ant and Slime Simulations", "Sebastian Lague", "17:54"),
        video("DksO3mqh0kg", "Evolving Brains in the Life Engine", "Emergent Garden", "16:00"),
        video("FWSR_7kZuYg", "Coding Challenge 85: The Game of Life", "The Coding Train", "38:20"),
        video("tCoEYFbDVoI", "Simulating the Evolution of Rock, Paper, Scissors", "Primer", "15:00"),
        video("r_It_X7v-1E", "Coding Adventure: Simulating an Ecosystem", "Sebastian Lague", "6:40"),
        video("L4u7Zy_b868", "Coding Challenge 180: Falling Sand", "The Coding Train", "23:00"),
        video("7x9J7rsLC50", "Ants that are Computers", "Emergent Garden", "14:22"),
        video("kzwT3wQWAHE", "Complex Behaviour from Simple Rules: 3 Simulations", "Sebastian Lague", "10:52"),
      ] },
  ];

  // ---- The model: plain data in, plain data out. `info` is MefiMusic's link
  // reader ({ playable, url, label, youtube } or null), so a list only ever
  // holds links the player itself would take.
  const clean = (value, limit) => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
  const DURATION = /^\d{1,2}(?::\d{2}){1,2}$/;
  const seconds = (duration) => DURATION.test(duration || "") ? duration.split(":").reduce((sum, part) => sum * 60 + Number(part), 0) : 0;
  const count = (n) => `${n} video${n === 1 ? "" : "s"}`;
  function lengthLabel(items) {
    const minutes = Math.round(items.reduce((sum, item) => sum + seconds(item.duration), 0) / 60);
    if (!minutes) return "";
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  }
  function cleanItem(raw, info) {
    const link = raw && typeof raw === "object" && typeof raw.url === "string" ? info(raw.url) : null;
    if (!link?.playable) return null;
    const duration = clean(raw.duration, 12);
    return { url: link.url, title: clean(raw.title, TITLE_LIMIT), channel: clean(raw.channel, 80), duration: DURATION.test(duration) ? duration : "" };
  }
  function cleanList(raw, info) {
    if (!raw || typeof raw !== "object") return null;
    const name = clean(raw.name, NAME_LIMIT);
    const id = typeof raw.id === "string" && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : null;
    if (!name || !id) return null;
    const at = (value) => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, ITEM_LIMIT).map((item) => cleanItem(item, info)).filter(Boolean);
    return { id, name, items, from: raw.from === "shared" ? "shared" : "", made: at(raw.made), updated: at(raw.updated) };
  }
  // A plain YouTube video (no list, no start time): the only kind youtu.be
  // and YouTube's play-them-all link carry.
  function plainYouTube(url, info) {
    const link = info(url);
    return link?.youtube && link.url === `https://www.youtube.com/watch?v=${link.youtube}` ? link.youtube : null;
  }
  function youtubeAll(list, info) {
    const ids = list.items.map((item) => plainYouTube(item.url, info));
    if (ids.length < 2 || ids.some((id) => !id)) return "";
    return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}&title=${encodeURIComponent(list.name)}`;
  }
  // Links sit in <…> so Discord shows the text, not a dozen previews.
  function shareText(list, info) {
    const lines = [`${SHARE_HEAD} ${list.name}`];
    list.items.forEach((item, index) => {
      const id = plainYouTube(item.url, info);
      const words = [item.title, item.channel && `· ${item.channel}`, item.duration && `· ${item.duration}`].filter(Boolean).join(" ");
      lines.push(`${index + 1}. ${words ? `${words} ` : ""}<${id ? `https://youtu.be/${id}` : item.url}>`);
    });
    const all = youtubeAll(list, info);
    if (all) lines.push(`${PLAY_ALL} <${all}>`);
    return lines.join("\n");
  }
  // A shared list back from text: the share text above (whole, or pasted into
  // a one-line box that lost its line breaks), a YouTube watch_videos link,
  // or, when loose, any text with playable links. { name, items } or null.
  function parseShare(text, info, { loose = false } = {}) {
    let value = String(text ?? "").slice(0, TEXT_LIMIT).replace(/\r\n?/g, "\n");
    if (!value.trim()) return null;
    let name = "";
    const head = /Mefi Studio playlist:[ \t]*([^\n]*?)[ \t]*(?=\n|\s1[.)]\s|$)/i.exec(value);
    if (head) { name = clean(head[1], NAME_LIMIT); value = `${value.slice(0, head.index)}\n${value.slice(head.index + head[0].length)}`; }
    // Each item's link ends its line, so a line break goes after every link.
    const lines = value.replace(/(<?https?:\/\/[^\s<>]+>?)[ \t]+(?=\S)/g, "$1\n").split("\n");
    const items = [];
    let watch = null;
    for (const line of lines) {
      const found = /<?(https?:\/\/[^\s<>]+?)>?[.,;)]*\s*$/.exec(line);
      if (!found) continue;
      let url;
      try { url = new URL(found[1]); } catch { continue; }
      if (/^(?:www\.|m\.)?youtube\.com$/i.test(url.hostname) && url.pathname === "/watch_videos") { watch ||= url; continue; }
      if (items.length >= ITEM_LIMIT) continue;
      const item = cleanItem({ url: found[1] }, info);
      if (!item || items.some((known) => known.url === item.url)) continue;
      // Words before the link name it when the text is numbered like ours.
      const numbered = /^\s*\d{1,3}[.)]\s/.test(line);
      if (head || numbered) {
        let words = line.slice(0, found.index).replace(/^\s*\d{1,3}[.)]\s*/, "").replace(/\s*[—–:-]\s*$/, "").trim();
        const time = / · (\d{1,2}(?::\d{2}){1,2})$/.exec(words);
        if (time) { item.duration = time[1]; words = words.slice(0, time.index); }
        const dot = words.lastIndexOf(" · ");
        if (dot > 0 && words.length - dot - 3 <= 80) { item.channel = clean(words.slice(dot + 3), 80); words = words.slice(0, dot); }
        item.title = clean(words, TITLE_LIMIT);
      }
      items.push(item);
    }
    if (!items.length && watch) {
      const ids = String(watch.searchParams.get("video_ids") || "").split(",").filter((id) => /^[\w-]{11}$/.test(id));
      for (const id of ids.slice(0, ITEM_LIMIT)) { const item = cleanItem({ url: `https://www.youtube.com/watch?v=${id}` }, info); if (item && !items.some((known) => known.url === item.url)) items.push(item); }
    }
    if (watch && !name) name = clean(watch.searchParams.get("title"), NAME_LIMIT);
    if (!items.length || !(head || watch || loose)) return null;
    return { name: name || "Shared playlist", items };
  }

  // ---- Saved lists.
  let api = null;
  let store = { lists: [] };
  function readStore(info) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch {}
    const seen = new Set();
    const lists = (Array.isArray(saved?.lists) ? saved.lists : []).slice(0, LIST_LIMIT).map((list) => cleanList(list, info)).filter((list) => list && !seen.has(list.id) && seen.add(list.id));
    return { lists };
  }
  function writeStore() {
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, lists: store.lists })); }
    catch { say("Your playlists could not be saved on this PC.", true); }
  }
  let made = 0;
  const newId = () => `pl-${Date.now().toString(36)}${(++made).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  function freeName(name) {
    const base = clean(name, NAME_LIMIT) || "My playlist";
    const taken = new Set(store.lists.map((list) => list.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 100; n++) { const next = `${base.slice(0, NAME_LIMIT - 4)} ${n}`; if (!taken.has(next.toLowerCase())) return next; }
    return base;
  }
  function createList(name, items = [], from = "") {
    if (store.lists.length >= LIST_LIMIT) { say(`Studio keeps ${LIST_LIMIT} playlists. Delete one to make room.`, true); return null; }
    const now = Date.now();
    const seen = new Set();
    const list = { id: newId(), name: freeName(name), items: items.map((item) => cleanItem(item, api.info)).filter((item) => item && !seen.has(item.url) && seen.add(item.url)).slice(0, ITEM_LIMIT), from, made: now, updated: now };
    store.lists.unshift(list);
    writeStore();
    return list;
  }
  const touch = (list) => { list.updated = Date.now(); writeStore(); };
  const starterKey = (id) => `starter:${id}`;
  function listFor(key) {
    if (typeof key !== "string") return null;
    if (key.startsWith("starter:")) { const starter = STARTERS.find((item) => starterKey(item.id) === key); return starter ? { ...starter, key, starter: true } : null; }
    return store.lists.find((item) => item.id === key) || null;
  }
  const keyOf = (list) => list.starter ? starterKey(list.id) : list.id;
  // Adds one item (at a place, else the end); a video already there stays put.
  function addItem(list, raw, at = null) {
    const item = cleanItem(raw, api.info);
    if (!item) { say("That link doesn't play here. Try YouTube, Vimeo or SoundCloud, or an audio or video file.", true); return false; }
    if (list.items.some((known) => known.url === item.url)) { say(`That one is already in ${list.name}.`); return false; }
    if (list.items.length >= ITEM_LIMIT) { say(`${list.name} is full: a playlist holds ${ITEM_LIMIT} videos.`, true); return false; }
    list.items.splice(Number.isInteger(at) ? Math.max(0, Math.min(list.items.length, at)) : list.items.length, 0, item);
    touch(list);
    say(`${titleOf(item)} is in ${list.name}.`);
    return true;
  }
  function moveItem(list, from, to) {
    if (!list.items[from]) return;
    const [item] = list.items.splice(from, 1);
    list.items.splice(Math.max(0, Math.min(list.items.length, to > from ? to - 1 : to)), 0, item);
    touch(list);
  }
  const titleOf = (item) => item.title || api?.info(item.url)?.label || "Video";
  const say = (text, error = false) => api?.note?.(text, error);

  // ---- Drawing. The section paints only while it shows (thumbnails are
  // YouTube's pictures: nothing asks for one before the menu is open), and
  // again when its lists change.
  const ui = { view: null, form: null, drafts: { new: "", import: "", rename: "", add: "" }, dirty: true, playing: null, rows: [] };
  let want = null, focusKey = null;
  function element(tag, className, text, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function button(text, className, parent, action) {
    const node = element("button", className, text, parent);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function iconButton(name, label, parent, action, className = "") {
    const node = button(null, `ghost music-icon${className ? ` ${className}` : ""}`, parent, action);
    api.glyph(name, node);
    node.setAttribute("aria-label", label); node.title = label;
    return node;
  }
  // A labelled button with its glyph first (Play, Shuffle, Share…).
  function actionButton(name, label, className, parent, action) {
    const node = button(null, className, parent, action);
    api.glyph(name, node); element("span", null, label, node);
    return node;
  }
  const mark = (node, key) => { if (key === focusKey) want = node; return node; };
  // Shown: the section is the one on show, in an unfolded deck of an open menu.
  const visible = () => Boolean(api?.host) && !api.host.hidden && api.host.parentElement?.hidden !== true && api.menu?.hidden === false;
  function paint({ focus = null } = {}) {
    if (!api?.host) return;
    if (!visible()) { ui.dirty = true; return; }
    ui.dirty = false;
    const host = api.host;
    const inside = host.contains(document.activeElement);
    focusKey = focus; want = null; ui.rows = [];
    host.textContent = "";
    const list = ui.view ? listFor(ui.view) : null;
    if (ui.view && !list) ui.view = null;
    if (list) paintList(host, list); else paintAll(host);
    if (want && (focus || inside)) want.focus?.({ preventScroll: Boolean(!focus) });
    focusKey = null; want = null;
    api.relayout?.();
  }
  function show(key, focus = null) {
    const previous = ui.view;
    ui.view = key; ui.form = null; ui.drafts.rename = ""; ui.drafts.add = "";
    if (api.host.parentElement) api.host.parentElement.scrollTop = 0;
    paint({ focus: focus || (key ? "back" : previous ? `card:${previous}` : null) });
  }
  function openForm(form, focus) { ui.form = ui.form === form ? null : form; paint({ focus: ui.form ? focus : null }); }
  function meta(list) {
    const length = lengthLabel(list.items);
    return [count(list.items.length), length && `about ${length}`].filter(Boolean).join(" · ");
  }
  function cover(parent, list, className = "music-pl-cover") {
    const node = element("span", className, null, parent); node.setAttribute("aria-hidden", "true");
    const pictures = list.items.map((item) => api.thumbnail(item.url)).filter(Boolean);
    // Four videos make a mosaic; fewer show the first.
    const shown = pictures.length >= 4 ? pictures.slice(0, 4) : pictures.slice(0, 1);
    node.dataset.tiles = String(shown.length);
    for (const source of shown) {
      const img = element("img", null, null, node);
      img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.draggable = false;
      img.addEventListener("error", () => { img.hidden = true; });
      img.src = source;
    }
    if (!shown.length) api.glyph("playlists", node);
    return node;
  }
  function card(grid, list) {
    const node = element("article", "music-pl-card", null, grid);
    const key = keyOf(list);
    node.dataset.key = key;
    const open = mark(button(null, "music-pl-open", node, () => show(key)), `card:${key}`);
    open.setAttribute("aria-label", `Open ${list.name}, ${count(list.items.length)}`);
    cover(open, list);
    const copy = element("span", "music-pl-copy", null, open);
    element("strong", null, list.name, copy);
    element("small", null, meta(list), copy);
    const by = list.starter ? [...new Set(list.items.map((item) => item.channel).filter(Boolean))].join(", ") : list.from === "shared" ? "Shared with you" : "Yours";
    element("small", "music-pl-by", by, copy);
    const play = iconButton("play", `Play ${list.name}`, node, () => playList(list), "music-pl-card-play");
    play.disabled = !list.items.length;
  }
  function paintAll(host) {
    const head = element("div", "music-pl-head", null, host);
    element("h3", null, "Playlists", head);
    const tools = element("div", "music-link-tools", null, head);
    mark(button("New playlist", "ghost mini", tools, () => openForm("new", "new-name")), "new").setAttribute("aria-expanded", String(ui.form === "new"));
    mark(button("Add a shared playlist", "ghost mini", tools, () => openForm("import", "import-box")), "import").setAttribute("aria-expanded", String(ui.form === "import"));
    if (ui.form === "new") paintNewForm(host);
    if (ui.form === "import") paintImportForm(host);
    element("h4", "music-node-label", store.lists.length ? `Yours · ${store.lists.length}` : "Yours", host);
    if (!store.lists.length) element("p", "music-fineprint music-pl-empty", "Nothing saved yet. Make one, copy a starting point below, or save a video with its + button in Browse.", host);
    else { const grid = element("div", "music-pl-grid", null, host); for (const list of store.lists) card(grid, list); }
    element("h4", "music-node-label", "Starting points", host);
    const grid = element("div", "music-pl-grid", null, host);
    for (const starter of STARTERS) card(grid, listFor(starterKey(starter.id)));
    element("p", "music-fineprint", "Your lists stay on this PC. Share one and it copies as text for Discord or a room; anyone with Studio adds it back with Add a shared playlist.", host);
  }
  function paintNewForm(host) {
    const form = element("form", "music-pl-form", null, host);
    const label = element("label", "music-pl-field", null, form);
    element("span", null, "Name", label);
    const input = mark(element("input", null, null, label), "new-name");
    input.type = "text"; input.maxLength = NAME_LIMIT; input.placeholder = "My playlist"; input.value = ui.drafts.new; input.autocomplete = "off";
    input.addEventListener("input", () => { ui.drafts.new = input.value; });
    const queued = api.queued();
    let withQueue = null;
    if (queued.length) {
      const choice = element("label", "music-pl-check", null, form);
      withQueue = element("input", null, null, choice); withQueue.type = "checkbox";
      element("span", null, `Start with the ${count(queued.length)} in Up next`, choice);
    }
    const tools = element("div", "music-link-tools", null, form);
    const create = element("button", "primary mini", "Create", tools); create.type = "submit";
    button("Cancel", "ghost mini", tools, () => openForm(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const list = createList(input.value, withQueue?.checked ? api.queued() : []);
      if (!list) return;
      ui.drafts.new = "";
      say(`${list.name} is ready.${list.items.length ? ` It starts with ${count(list.items.length)} from Up next.` : " Add videos with + in Browse, or paste links here."}`);
      show(list.id, list.items.length ? "back" : "add-link");
    });
  }
  function paintImportForm(host) {
    const form = element("form", "music-pl-form", null, host);
    const label = element("label", "music-pl-field", null, form);
    element("span", null, "Paste a playlist someone shared: its text, or its YouTube link", label);
    const box = mark(element("textarea", null, null, label), "import-box");
    box.rows = 4; box.maxLength = TEXT_LIMIT; box.spellcheck = false; box.value = ui.drafts.import;
    box.placeholder = `${SHARE_HEAD} Late-night code\n1. A video · Its channel <https://youtu.be/…>`;
    const preview = element("small", "music-pl-preview", "", form); preview.setAttribute("aria-live", "polite");
    const tools = element("div", "music-link-tools", null, form);
    const save = mark(element("button", "primary mini", "Save playlist", tools), "import-save"); save.type = "submit";
    button("Cancel", "ghost mini", tools, () => { ui.drafts.import = ""; openForm(null); });
    const update = () => {
      ui.drafts.import = box.value;
      const parsed = parseShare(box.value, api.info, { loose: true });
      preview.textContent = parsed ? `${parsed.name} · ${count(parsed.items.length)}` : box.value.trim() ? "No links that play here yet." : "";
      save.disabled = !parsed;
    };
    box.addEventListener("input", update);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const parsed = parseShare(box.value, api.info, { loose: true });
      if (!parsed) return;
      const list = createList(parsed.name, parsed.items, "shared");
      if (!list) return;
      ui.drafts.import = "";
      say(`${list.name} is saved with ${count(list.items.length)}.`);
      show(list.id);
    });
    update();
  }
  function paintList(host, list) {
    const back = mark(actionButton("back", "All playlists", "ghost mini music-pl-back", host, () => show(null)), "back");
    back.setAttribute("aria-label", "Back to all playlists");
    const head = element("header", "music-pl-detail", null, host);
    cover(head, list);
    const words = element("div", "music-pl-words", null, head);
    element("small", "music-pl-kicker", list.starter ? "Starting point" : list.from === "shared" ? "Shared with you" : "Your playlist", words);
    if (ui.form === "rename" && !list.starter) renameForm(words, list);
    else element("h3", null, list.name, words);
    if (list.about) element("p", null, list.about, words);
    element("small", "music-pl-meta", meta(list), words);
    // Your own list: Rename and Delete sit with its name, out of the play row.
    if (!list.starter && ui.form !== "rename") {
      const manage = element("div", "music-pl-manage", null, words);
      mark(button("Rename", "ghost mini", manage, () => { ui.drafts.rename = list.name; openForm("rename", "rename"); }), "rename-open");
      mark(button("Delete", "ghost mini music-pl-danger", manage, () => openForm("delete", "delete-keep")), "delete-open").setAttribute("aria-expanded", String(ui.form === "delete"));
    }
    const actions = element("div", "music-pl-actions", null, host);
    const empty = !list.items.length;
    mark(actionButton("play", "Play", "primary mini", actions, () => playList(list)), "play").disabled = empty;
    actionButton("shuffle", "Shuffle", "ghost mini", actions, () => playList(list, { shuffle: true })).disabled = empty;
    actionButton("queue", "Add to Up next", "ghost mini", actions, () => api.queue(list.items, list.name)).disabled = empty;
    const share = mark(actionButton("share", "Share", "ghost mini", actions, () => openForm("share", "copy")), "share");
    share.disabled = empty; share.setAttribute("aria-expanded", String(ui.form === "share"));
    if (list.starter) mark(button("Make it yours", "ghost mini", actions, () => copyStarter(list)), "copy-starter").title = "Save a copy you can change";
    if (ui.form === "share" && !empty) sharePanel(host, list);
    if (ui.form === "delete" && !list.starter) deleteConfirm(host, list);
    if (list.starter && list.more?.length) {
      const more = element("div", "music-pl-more", null, host);
      element("span", null, "Find more", more);
      for (const words of list.more) button(words, "ghost music-feed-idea", more, () => void api.browse(words)).title = `Search YouTube for ${words}`;
    }
    if (!list.starter) addForm(host, list);
    rows(host, list);
  }
  function renameForm(parent, list) {
    const form = element("form", "music-pl-rename", null, parent);
    const input = mark(element("input", null, null, form), "rename");
    input.type = "text"; input.maxLength = NAME_LIMIT; input.value = ui.drafts.rename; input.setAttribute("aria-label", "Playlist name");
    input.addEventListener("input", () => { ui.drafts.rename = input.value; });
    const save = element("button", "primary mini", "Save", form); save.type = "submit";
    button("Cancel", "ghost mini", form, () => openForm(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = clean(input.value, NAME_LIMIT);
      if (!name) { input.focus(); return; }
      if (name !== list.name) { const old = list.name; list.name = ""; list.name = freeName(name); touch(list); say(`${old} is now ${list.name}.`); }
      ui.form = null; paint({ focus: "rename-open" });
    });
  }
  function deleteConfirm(host, list) {
    const box = element("div", "music-pl-confirm", null, host); box.setAttribute("role", "alertdialog"); box.setAttribute("aria-label", `Delete ${list.name}?`);
    element("p", null, `Delete ${list.name}? Its ${count(list.items.length)} go with it, and this can't be undone.`, box);
    const tools = element("div", "music-link-tools", null, box);
    button("Delete", "primary mini music-pl-danger", tools, () => {
      store.lists = store.lists.filter((item) => item.id !== list.id); writeStore();
      say(`Deleted ${list.name}.`);
      show(null, "new");
    });
    mark(button("Keep it", "ghost mini", tools, () => openForm(null)), "delete-keep");
  }
  function sharePanel(host, list) {
    const panel = element("section", "music-pl-share", null, host); panel.setAttribute("aria-label", "Share this playlist");
    const text = shareText(list, api.info), all = youtubeAll(list, api.info);
    element("p", null, all ? "Copy it as text for Discord or a room. Every line is a link, the last one plays the whole list on YouTube, and Studio turns the text back into this playlist."
      : "Copy it as text for Discord or a room. Every line is a link, and Studio turns the text back into this playlist.", panel);
    const box = element("textarea", "music-pl-share-text", null, panel);
    box.readOnly = true; box.rows = Math.min(8, list.items.length + 2); box.spellcheck = false; box.setAttribute("aria-label", "This playlist as text");
    // Show links off (More › This menu) keeps addresses off the screen.
    box.value = api.showLinks() ? text : `${SHARE_HEAD} ${list.name}\n${count(list.items.length)}: the links are hidden while Show links is off.`;
    const tools = element("div", "music-link-tools", null, panel);
    mark(button("Copy as text", "primary mini", tools, () => copy(text, "Copied. Paste it in Discord, a room or any chat.")), "copy");
    if (all) button("Copy the YouTube link", "ghost mini", tools, () => copy(all, "Copied the YouTube link. It plays the whole list on YouTube, and Studio adds it back too."));
    if (text.length > DISCORD_MESSAGE) element("small", null, `That's longer than one Discord message (${DISCORD_MESSAGE.toLocaleString("en-US")} characters).${all ? " The YouTube link fits, and Studio reads it back too." : " Send it in two parts."}`, panel);
  }
  function copy(text, done) {
    try {
      const clipboard = window.navigator?.clipboard;
      if (clipboard?.writeText) { clipboard.writeText(text).then(() => say(done), () => say("That could not be copied.", true)); return; }
    } catch {}
    say("That could not be copied.", true);
  }
  function addForm(host, list) {
    const form = element("form", "music-find music-pl-add", null, host);
    api.glyph("link", form);
    const input = mark(element("input", null, null, form), "add-link");
    input.type = "text"; input.maxLength = 8192; input.autocomplete = "off"; input.spellcheck = false; input.value = ui.drafts.add;
    input.placeholder = "Paste a video link to add it"; input.setAttribute("aria-label", `Add a video link to ${list.name}`);
    input.addEventListener("input", () => { ui.drafts.add = input.value; });
    const add = element("button", "primary", "Add", form); add.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      if (addItem(list, { url: input.value.trim() })) { ui.drafts.add = ""; paint({ focus: "add-link" }); }
    });
    const now = api.playing();
    if (now && !list.items.some((item) => item.url === now.url)) {
      const playing = button(`Add what's playing: ${now.title}`, "ghost mini music-pl-add-now", host, () => { if (addItem(list, now)) paint({ focus: "add-link" }); });
      playing.title = now.title;
    }
  }
  function rows(host, list) {
    const own = !list.starter;
    const ol = element("ol", "music-pl-items", null, host);
    ol.setAttribute("aria-label", `Videos in ${list.name}`);
    ol.dataset.own = String(own);
    if (own && !list.items.length) ol.dataset.empty = "Drop a video here from Up next";
    list.items.forEach((item, index) => {
      const title = titleOf(item);
      const row = element("li", "music-pl-item", null, ol);
      row.dataset.key = item.url;
      const picture = api.thumbnail(item.url);
      row.dataset.thumb = String(Boolean(picture));
      if (picture) row.style.setProperty("--thumb", `url("${picture}")`);
      if (item.url === ui.playing) row.dataset.state = "playing";
      const main = mark(button(null, "music-pl-row", row, () => playList(list, { from: index })), `row:${index}`);
      main.setAttribute("aria-label", `Play ${title}${index + 1 < list.items.length ? `, then the rest of ${list.name}` : ""}`);
      element("span", "music-pl-num", String(index + 1), main);
      const copyNode = element("span", "music-pl-row-copy", null, main);
      element("strong", null, title, copyNode);
      element("small", null, [item.channel, item.duration].filter(Boolean).join(" · ") || api.info(item.url)?.providerName || "", copyNode);
      const tools = element("span", "music-pl-row-tools", null, row);
      iconButton("queue", `Add ${title} to Up next`, tools, () => api.queue([item]));
      if (own) iconButton("close", `Remove ${title} from ${list.name}`, tools, () => {
        list.items.splice(index, 1); touch(list); say(`Removed ${title} from ${list.name}.`);
        paint({ focus: list.items.length ? `row:${Math.min(index, list.items.length - 1)}` : "add-link" });
      });
      api.drag(row, { url: item.url, title });
      if (own) row.addEventListener("dragstart", (event) => { try { event.dataTransfer?.setData(ROW_DRAG, String(index)); if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove"; } catch {} });
      ui.rows.push(row);
    });
    if (own) dropInto(ol, list);
  }
  // Your own list takes drops: its rows to reorder, a video from Up next or
  // a link from anywhere to add.
  function dropInto(ol, list) {
    const types = (event) => Array.from(event?.dataTransfer?.types || []);
    const index = (event) => { const at = Array.from(ol.children).findIndex((row) => { const box = row.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; }); return at < 0 ? ol.children.length : at; };
    const markAt = (at) => { Array.from(ol.children).forEach((row, i) => { if (i === at) row.dataset.drop = "before"; else delete row.dataset.drop; }); ol.dataset.drop = at == null ? "" : at >= ol.children.length ? "end" : "row"; };
    ol.addEventListener("dragover", (event) => {
      const kinds = types(event);
      if (!kinds.includes(ROW_DRAG) && !kinds.includes(MEDIA_DRAG) && !kinds.includes("text/uri-list")) return;
      event.preventDefault(); event.stopPropagation?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = kinds.includes(ROW_DRAG) || kinds.includes(QUEUE_DRAG) ? "move" : "copy";
      markAt(index(event));
    });
    ol.addEventListener("dragleave", (event) => { if (!ol.contains(event.relatedTarget)) markAt(null); });
    ol.addEventListener("drop", (event) => {
      const at = index(event); markAt(null);
      const data = (type) => { try { return event.dataTransfer?.getData?.(type) || ""; } catch { return ""; } };
      const from = Number.parseInt(data(ROW_DRAG), 10);
      let media = null;
      try { media = JSON.parse(data(MEDIA_DRAG) || "null"); } catch {}
      const url = typeof media?.url === "string" ? media.url : data("text/uri-list").split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#"));
      if (!Number.isInteger(from) && !url) return;
      event.preventDefault(); event.stopPropagation?.();
      if (Number.isInteger(from) && list.items[from]) { moveItem(list, from, at); paint(); return; }
      if (addItem(list, { url, title: typeof media?.title === "string" ? media.title : "" }, at)) paint();
    });
  }
  function playList(list, { shuffle = false, from = 0 } = {}) {
    let items = list.items.slice(from);
    if (shuffle) {
      items = list.items.slice();
      for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
    }
    return api.play(items, list.name);
  }
  function copyStarter(starter) {
    const list = createList(starter.name, starter.items);
    if (!list) return;
    say(`${list.name} is yours now: rename it, reorder it, add to it.`);
    show(list.id);
  }

  // ---- Save to a playlist: a small list beside a Save button (a Browse card,
  // or the video that is playing), inside the media menu.
  let pop = null;
  function save(anchor, raw) {
    if (!api) return;
    dismiss();
    const item = cleanItem(raw, api.info);
    if (!item) { say("That can't be saved to a playlist.", true); return; }
    const node = element("section", "music-pl-save", null, api.menu);
    node.setAttribute("role", "dialog"); node.setAttribute("aria-label", "Save to a playlist");
    pop = { anchor, item, node, draft: "" };
    paintSave("first");
    place();
    document.addEventListener("pointerdown", outside, true);
  }
  function paintSave(focus = null) {
    if (!pop) return;
    const { node, item } = pop;
    want = null;
    node.textContent = "";
    const head = element("header", null, null, node);
    element("strong", null, "Save to a playlist", head);
    element("small", null, titleOf(item), head).title = titleOf(item);
    const lists = element("div", "music-pl-save-lists", null, node);
    store.lists.forEach((list, index) => {
      const has = list.items.some((known) => known.url === item.url);
      const row = button(null, "music-pl-save-row", lists, () => toggleIn(list));
      if (focus === `save:${list.id}` || (focus === "first" && index === 0)) want = row;
      row.setAttribute("aria-pressed", String(has));
      element("span", "music-pl-tick", null, row).setAttribute("aria-hidden", "true");
      element("span", null, list.name, row);
      element("small", null, count(list.items.length), row);
    });
    if (!store.lists.length) element("p", "music-fineprint", "No playlists yet. Name your first one:", node);
    const form = element("form", "music-pl-save-new", null, node);
    const input = element("input", null, null, form);
    if (focus === "first" && !store.lists.length) want = input;
    input.type = "text"; input.maxLength = NAME_LIMIT; input.placeholder = "New playlist"; input.value = pop.draft; input.autocomplete = "off";
    input.setAttribute("aria-label", "New playlist name");
    input.addEventListener("input", () => { if (pop) pop.draft = input.value; });
    const create = element("button", "ghost mini", "Create", form); create.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!pop) return;
      const list = createList(input.value || "My playlist", [pop.item]);
      if (!list) return;
      pop.draft = "";
      say(`Saved to ${list.name}.`);
      paintSave(`save:${list.id}`); paint();
    });
    button("Done", "ghost mini music-pl-save-done", node, () => dismiss());
    want?.focus?.({ preventScroll: true });
    want = null;
  }
  function toggleIn(list) {
    if (!pop) return;
    const at = list.items.findIndex((known) => known.url === pop.item.url);
    if (at >= 0) { list.items.splice(at, 1); touch(list); say(`Removed from ${list.name}.`); }
    else if (!addItem(list, pop.item)) return;
    paintSave(`save:${list.id}`); paint();
  }
  // Under the button, kept inside the menu; over it when there is no room.
  function place() {
    if (!pop) return;
    const box = api.menu.getBoundingClientRect(), anchor = pop.anchor?.getBoundingClientRect?.();
    const width = Math.max(200, Math.min(290, box.width - 16));
    const left = Math.max(8, Math.min((anchor ? anchor.right - box.left : box.width) - width, box.width - width - 8));
    const height = pop.node.getBoundingClientRect().height || 0;
    let top = anchor ? anchor.bottom - box.top + 6 : 8;
    if (anchor && top + height > box.height - 8) top = Math.max(8, anchor.top - box.top - 6 - height);
    Object.assign(pop.node.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${Math.round(width)}px` });
  }
  function dismiss() {
    if (!pop) return false;
    const { node, anchor } = pop;
    const inside = node.contains(document.activeElement);
    pop = null;
    node.remove();
    document.removeEventListener("pointerdown", outside, true);
    if (inside && anchor?.isConnected !== false) anchor?.focus?.({ preventScroll: true });
    return true;
  }
  function outside(event) {
    if (pop && !pop.node.contains(event.target) && !pop.anchor?.contains?.(event.target)) dismiss();
  }

  // A shared list typed or pasted into the Browse box opens here, ready.
  function offer(text) {
    if (!api) return false;
    const parsed = parseShare(text, api.info);
    if (!parsed) return false;
    ui.view = null; ui.form = "import"; ui.drafts.import = String(text).slice(0, TEXT_LIMIT);
    api.open();
    paint({ focus: "import-save" });
    say(`${parsed.name}: ${count(parsed.items.length)} ready to save.`);
    return true;
  }
  // music.js says when the section shows; it repaints only if it changed.
  function shown() { if (api && ui.dirty) paint(); }
  // The video that plays is marked; a video saved before its title was known
  // (a shared YouTube link) takes the title its player reports.
  function heard(event) {
    const detail = event?.detail;
    if (!api || !detail) return;
    const url = detail.source === "link" && typeof detail.link === "string" ? detail.link : null;
    let named = false;
    if (url && typeof detail.title === "string" && detail.title && detail.title !== api.info(url)?.label) {
      for (const list of store.lists) for (const item of list.items) if (item.url === url && !item.title) { item.title = clean(detail.title, TITLE_LIMIT); named = true; }
      if (named) writeStore();
    }
    if (named) { ui.playing = url; paint(); return; }
    if (url === ui.playing) return;
    ui.playing = url;
    for (const row of ui.rows) { if (row.dataset.key === url) row.dataset.state = "playing"; else delete row.dataset.state; }
  }

  function init() {
    if (api) return true;
    const music = window.MefiMusic;
    if (typeof music?.playlists !== "function") return false;
    const hands = music.playlists({ save, dismiss, offer, shown });
    if (!hands?.host) return false;
    api = hands;
    store = readStore(api.info);
    window.addEventListener("mefi-music-change", heard);
    if (typeof MutationObserver === "function" && api.menu) new MutationObserver(() => { if (api.menu.hidden) dismiss(); }).observe(api.menu, { attributes: true, attributeFilter: ["hidden"] });
    return true;
  }
  window.MefiPlaylists = {
    init,
    // Opens the menu's Playlists section, on one list when a key is given
    // ("starter:explorers", or a saved list's id).
    open: (key = null) => { if (!init()) return false; ui.view = listFor(key) ? key : null; ui.form = null; api.open(); paint({ focus: ui.view ? "back" : null }); return true; },
    lists: () => store.lists.map((list) => ({ id: list.id, name: list.name, from: list.from, items: list.items.map((item) => ({ ...item })) })),
    starters: () => STARTERS.map((starter) => ({ id: starter.id, name: starter.name, about: starter.about, items: starter.items.map((item) => ({ ...item })) })),
    // The share text for a list, and a list back from text, for other places
    // that carry links (a room, a chat).
    shareText: (key) => { const list = init() ? listFor(key) : null; return list ? shareText(list, api.info) : ""; },
    parse: (text) => init() ? parseShare(text, api.info, { loose: true }) : null,
    model: { parseShare, shareText, youtubeAll, cleanList, lengthLabel, SHARE_HEAD, ITEM_LIMIT, LIST_LIMIT },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
