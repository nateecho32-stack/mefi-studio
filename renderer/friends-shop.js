// Friends › Shop (window.MefiShop): scales for Ember, menu effects and style
// packs for the credits members earn by making and playing things (credits
// are never bought with money), and the style packs members make and sell
// each other. Ember the dragon itself comes free with every Studio: it is not
// sold, and its card is an On/Off switch (MefiPets.set({ on })). The relay
// keeps the catalog, the packs and who owns what (relay/src/shop.mjs); this
// page shows them, lets you try anything for two minutes, asks before a
// single credit is spent, and puts what you own to use.
//
// Four views, one segmented control:
//   - Studio: Ember (free), its scales, menu effects and Studio's own style
//     packs.
//   - Community: members' style packs, New or Top, each with Report (and
//     Remove for a moderator, as renderer/friends-mod.js knows one). Buying or
//     getting one can carry a tip for its maker (0 to 100 credits, members'
//     packs only; hubShop "shopBuy" with the tip as its third argument).
//   - Owned: everything you own, with Use.
//   - Make a style: five colours, a node style, a material and a font, a big
//     live preview and how easy its text is to read (WCAG contrast). The
//     relay's own check runs here first (checkPack, the same rules as
//     relay/src/shop-pack.mjs) and says in plain words what stops a pack from
//     publishing. Use it myself puts it on this PC only; Publish lists it,
//     free or for 10 to 250 credits. Your packs lists what you published,
//     with Edit, Unlist or List again, sales and credits earned.
//
// Every card shows its item live: a pet flies on a little canvas
// (MefiPets.paintPreview, drawn only while the card is on screen and motion
// is on; one still frame when motion is off), an effect plays on a little
// menu on hover, focus or Try (MefiEffects.demo), and a pack paints a tiny
// app window from its own colours. Try lasts two minutes, one item at a time,
// under a banner at the top of the page (time left, Buy, Stop); leaving the
// Shop ends it.
//
// What you own is kept in localStorage mefiStudio.shop.v1 ({ owned: { [id]:
// { kind, name, data, updatedAt } }, at }), so it keeps working signed out or
// offline. It is read again from the relay (hubShop "shopOwned") when the
// Shop opens, after a purchase and when the room service connects, and the
// window event `mefi-shop-owned` tells the rest of Studio when it changed.
//
// Everything goes through main's hub:shop channel (window.mefiStudio.hubShop);
// renderer/pets.js, effects.js and music.js do the showing. A part that is not
// in this build says so on its card ("Comes with the next Studio update").
// Text only: names and blurbs go in with textContent.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const PRIMARY = "friends-shop-primary";
  const button = (text, run, id = null, cls = "ghost friends-shop-button") => { const el = node("button", cls, text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  // A change that is hard to take back asks twice (MefiUi.arm), or once in a plain confirm.
  const confirmed = (label, armed, ask, run, id) => {
    if (window.MefiUi?.arm) return window.MefiUi.arm(button(label, () => {}, id), { run, armed });
    return button(label, () => { if (window.confirm?.(ask) !== false) run(); }, id);
  };
  const bridge = () => window.mefiStudio;
  const safe = (read, fallback = null) => { try { return read() ?? fallback; } catch { return fallback; } };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const credits = (n) => plural(n, "credit");
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  // An item id inside an element id: "studio:pet-dragon" -> "studio-pet-dragon".
  const domId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "-");
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const motionOff = () => document.documentElement?.dataset?.motion === "off";
  const focusOn = (id) => { try { document.getElementById?.(id)?.focus?.({ preventScroll: false }); } catch { /* nothing to focus */ } };
  const STORE = "mefiStudio.shop.v1";
  const TRY_MS = 120_000;
  const SOON = "Comes with the next Studio update.";
  const OPENING = "Opening the Shop…";
  const KINDS = ["pet", "skin", "effect", "pack"];
  const VIEWS = [["studio", "Studio"], ["packs", "Community"], ["owned", "Owned"], ["make", "Make a style"]];
  // Studio's pets and their scales share a heading.
  const GROUPS = [["pet", "Pets"], ["effect", "Menu effects"], ["pack", "Style packs"]];
  const groupOf = (kind) => (kind === "skin" ? "pet" : kind);
  const REPORT_REASONS = ["Hard to read", "Copies someone else's work", "A rude or hurtful name", "Something else"];
  // Ember the dragon comes free with every Studio: never a Shop item, so it has a card of its own (a switch, no price).
  const EMBER = "studio:pet-dragon";
  const EMBER_BLURB = "A little dragon that flies around your studio, naps on the edges of your windows and cheers when work is done.";
  // Tips for a member's pack: the quick picks, and the most one purchase can carry.
  const TIPS = [0, 5, 10, 25];
  const TIP_MAX = 100;

  // ---- a style pack is data only (relay/src/shop-pack.mjs checks the same) ----
  const HEX = /^#[0-9a-f]{6}$/i;
  const PACK_BYTES = 2048;
  const PACK_KEYS = ["v", "palette", "nodeStyle", "material", "font"];
  const COLOURS = [["accent", "Accent"], ["accent2", "Second accent"], ["background", "Background"], ["surface", "Panels"], ["text", "Text"]];
  const NEEDED = ["accent", "background", "surface", "text"];
  const NODE_STYLES = ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"];
  const MATERIALS = [["focus", "Focus"], ["studio", "Studio"], ["atmosphere", "Atmosphere"]];
  const FONTS = [["studio", "Studio"], ["display", "Display"], ["serif", "Serif"], ["mono", "Mono"]];
  // What a pack's colours must reach: WCAG contrast, and the words for a pair that does. Studio sets text in the
  // accent too (links, chosen tabs, a light page's headings), so it needs what text needs.
  const READABLE = [["text", "background", "Text on background", 4.5, "Easy to read"], ["text", "surface", "Text on panels", 4.5, "Easy to read"], ["accent", "background", "Accent on background", 4.5, "Reads as text"]];
  // A starting point for a new style when the theme's own colours cannot be read.
  const STARTER = Object.freeze({ accent: "#71cbb7", accent2: "#9db7ff", background: "#050d13", surface: "#101f29", text: "#e7f5ee" });
  const colourName = (key) => COLOURS.find(([id]) => id === key)?.[1] ?? key;
  const nodeStyleName = (key) => safe(() => window.MefiMusic.nodeStyles().find((style) => style.key === key)?.name) || `${key[0].toUpperCase()}${key.slice(1)}`;

  // WCAG 2 relative luminance of #rrggbb, and the contrast ratio of two colours (1 to 21; null for a colour it cannot read).
  function luminance(hex) {
    const value = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || !HEX.test(a) || !HEX.test(b)) return null;
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  }
  // "11.2:1", rounded down so a ratio just under a line never reads as reaching it.
  const ratioText = (ratio) => `${Math.floor(ratio * 10) / 10}:1`;
  const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  function byteLength(text) {
    let bytes = 0;
    for (const ch of text) { const code = ch.codePointAt(0); bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
    return bytes;
  }
  // The pack as the relay will read it (JSON, so a key set to undefined is simply absent), its shape checked and
  // its colours lower-cased: { ok: true, data } or { ok: false, error: "bad-pack" | "too-big", why, field? }.
  function shapeOf(data) {
    const fail = (error, why, field = null) => ({ ok: false, error, why, ...(field ? { field } : {}) });
    let json;
    try { json = JSON.stringify(data); } catch { json = undefined; }
    if (typeof json !== "string") return fail("bad-pack", "Studio could not read that style.");
    if (byteLength(json) > PACK_BYTES) return fail("too-big", "That style is too big for the Shop: 2 KB at most.");
    const pack = JSON.parse(json);
    if (!plainObject(pack)) return fail("bad-pack", "Studio could not read that style.");
    const extra = Object.keys(pack).find((key) => !PACK_KEYS.includes(key));
    if (extra) return fail("bad-pack", `A style has no part called “${extra}”.`, extra);
    if (pack.v !== 1) return fail("bad-pack", "That style was made for a different Studio.", "v");
    if (!plainObject(pack.palette)) return fail("bad-pack", "A style needs its colours.", "palette");
    const odd = Object.keys(pack.palette).find((key) => !COLOURS.some(([id]) => id === key));
    if (odd) return fail("bad-pack", `A style has no colour called “${odd}”.`, `palette.${odd}`);
    const palette = {};
    for (const [key] of COLOURS) {
      if (!Object.hasOwn(pack.palette, key) && !NEEDED.includes(key)) continue;
      const value = pack.palette[key];
      if (typeof value !== "string" || !HEX.test(value)) return fail("bad-pack", `${colourName(key)}: enter a colour as #RRGGBB.`, `palette.${key}`);
      palette[key] = value.toLowerCase();
    }
    const clean = { v: 1, palette };
    for (const [key, allowed, words] of [["nodeStyle", NODE_STYLES, "node style"], ["material", MATERIALS.map(([id]) => id), "material"], ["font", FONTS.map(([id]) => id), "font"]]) {
      if (!Object.hasOwn(pack, key)) continue;
      if (!allowed.includes(pack[key])) return fail("bad-pack", `Choose a ${words} from the list.`, key);
      clean[key] = pack[key];
    }
    return { ok: true, data: clean };
  }
  // The relay's check, here first, so the editor can say what is wrong before anything is sent: the shape, then
  // whether its text is easy to read ("low-contrast": text needs 4.5:1 on the background and on panels, and so
  // does the accent on the background, since it is read as text too).
  function checkPack(data) {
    const shaped = shapeOf(data);
    if (!shaped.ok) return shaped;
    const { palette } = shaped.data;
    for (const [a, b, label, need] of READABLE) {
      const ratio = contrast(palette[a], palette[b]);
      if (ratio < need) return { ok: false, error: "low-contrast", why: `${label} is ${ratioText(ratio)}. It needs ${need}:1 to ${a === "accent" ? "read as text" : "be easy to read"}.`, field: `palette.${a}`, ratio };
    }
    return shaped;
  }
  // A pack's name, line and price, as the relay takes them: { ok: true, name, blurb, price } or { ok: false, error, why }.
  function checkListing({ name, blurb, price }) {
    const cleanName = String(name ?? "").replace(/\s+/g, " ").trim();
    const cleanBlurb = String(blurb ?? "").replace(/\s+/g, " ").trim();
    if (cleanName.length < 2 || cleanName.length > 40) return { ok: false, error: "name", why: "Give it a name of 2 to 40 characters." };
    if (cleanBlurb.length > 160) return { ok: false, error: "blurb", why: "Keep the line about it to 160 characters." };
    if (!(price === 0 || (Number.isInteger(price) && price >= 10 && price <= 250))) return { ok: false, error: "price", why: "A price is free, or a whole number of credits from 10 to 250." };
    return { ok: true, name: cleanName, blurb: cleanBlurb, price };
  }

  // ---- what the relay may say, in plain words ----
  const dateOf = (ms) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "long" });
  const onDay = (ms) => (Number.isFinite(ms) ? ` on ${dateOf(ms)}` : "");
  // Why credits have not started for this member: the Project hub's own words (renderer/project-hub.js holdWords).
  function holdWords(hold) {
    switch (hold?.reason) {
      case "new-account": return `Credits start when your Discord account is 30 days old${onDay(hold.until)}. Until then, plays and stars you give count for no one.`;
      case "new-member": return `Credits start a week after you joined the Void Engine server${onDay(hold.until)}.`;
      case "forgot-me": return `Credits are paused for 30 days after Forget me${Number.isFinite(hold.until) ? `, until ${dateOf(hold.until)}` : ""}.`;
      case "read-only": return "Credits are paused while your account is read-only in the server.";
      default: return "Credits start once your account is in good standing in the server.";
    }
  }
  // The hold a refusal carries: { reason, until }, whether it came as an object, a word, or the reason itself.
  const holdOf = (answer) => (plainObject(answer?.hold) ? answer.hold : { reason: typeof answer?.hold === "string" ? answer.hold : answer?.reason, until: answer?.until });
  const REASONS = {
    unsupported: "The Shop isn't on this room service yet. The rest of Friends still works.",
    offline: "Not connected to the room service.",
    network: "Studio could not reach the room service. Check the connection and try again.",
    "not-configured": "This copy of Studio has no room service address.",
    failed: "The Shop did not answer. Try again in a moment.",
    "rate-limited": "Slow down a moment, then try again.",
    "read-only": "Your account is read-only in the server right now.",
    paused: "The room service is paused right now. The Shop opens again when it is back.",
    forbidden: "Only moderators can do that.",
    "bad-request": "Studio could not send that. Try again.",
    "not-found": "That is no longer in the Shop.",
    gone: "That is no longer in the Shop.",
    // Publishing or changing a pack.
    "bad-pack": "Studio could not read that style. Check that every colour is #RRGGBB.",
    "too-big": "That style is too big for the Shop: 2 KB at most.",
    "low-contrast": "Its text is too hard to read: text needs 4.5:1 on the background and on panels, and so does the accent on the background (it is read as text too).",
    name: "Give it a name of 2 to 40 characters, on one line.",
    "name-taken": "You already have a listed pack with that name.",
    blurb: "Keep the line about it to 160 characters.",
    price: "A price is free, or a whole number of credits from 10 to 250.",
    // The relay's limits ("limit" with one of these reasons; a name clash is "conflict", "name-taken").
    "listed-packs": "You have 12 packs listed. Unlist one to publish another.",
    "daily-publishes": "You have published 4 packs today. Try again tomorrow.",
    "shop-full": "The Shop is full right now. Try again another day.",
    limit: "The Shop's limits are reached for now. Try again later.",
    conflict: "You already have a listed pack with that name.",
    // Reporting.
    reported: "You have already reported it.",
    self: "That's your own pack.",
  };
  // Other spellings the relay may use for the same refusal.
  const ALIASES = { listed: "listed-packs", "packs-listed": "listed-packs", daily: "daily-publishes", full: "shop-full", "same-name": "name-taken", duplicate: "name-taken", "already-reported": "reported", own: "self" };
  function reasonWords(answer, fallback) {
    for (const code of [answer?.reason, answer?.error]) {
      if (typeof code !== "string") continue;
      if (code === "hold") return holdWords(holdOf(answer));
      const key = ALIASES[code] ?? code;
      if (REASONS[key]) return REASONS[key];
    }
    return fallback;
  }

  // ---- what you own, kept on this PC ----
  let cache = null;
  const names = new Map(); // item id -> name, from every list the Shop reads (Moderation names reported packs with it)
  function cleanEntry(id, entry) {
    if (typeof id !== "string" || !id || id.length > 80 || !plainObject(entry) || !KINDS.includes(entry.kind)) return null;
    const shaped = entry.kind === "pack" && entry.data ? shapeOf(entry.data) : null;
    return { kind: entry.kind, name: typeof entry.name === "string" && entry.name ? entry.name.slice(0, 80) : id, data: shaped?.ok ? shaped.data : null, updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0 };
  }
  function readCache() {
    if (cache) return cache;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
    const owned = {};
    if (plainObject(saved?.owned)) for (const [id, entry] of Object.entries(saved.owned)) { const clean = cleanEntry(id, entry); if (clean) owned[id] = clean; }
    cache = { owned, at: Number.isFinite(saved?.at) ? saved.at : 0 };
    for (const [id, entry] of Object.entries(owned)) if (!names.has(id)) names.set(id, entry.name);
    return cache;
  }
  const signature = (owned) => JSON.stringify(Object.keys(owned).sort().map((id) => [id, owned[id].kind, owned[id].name, owned[id].updatedAt, owned[id].data]));
  // Keeps the owned set (in memory when storage is refused) and says so when it changed. -> changed?
  function setOwned(owned) {
    const before = signature(readCache().owned);
    cache = { owned, at: Date.now() };
    try { localStorage.setItem(STORE, JSON.stringify(cache)); } catch { /* kept for this session only */ }
    if (signature(owned) === before) return false;
    try { window.dispatchEvent?.(new CustomEvent("mefi-shop-owned", { detail: { ids: Object.keys(owned) } })); } catch { /* nobody to tell */ }
    return true;
  }
  function markOwned(item) {
    const entry = cleanEntry(item?.id, { ...item, updatedAt: Date.now() });
    if (entry) setOwned({ ...readCache().owned, [item.id]: entry });
  }
  // Ember comes with every Studio, so everyone owns it; anything else, the cache says.
  const owns = (id) => String(id) === EMBER || Object.hasOwn(readCache().owned, String(id));
  const copy = (data) => (data ? JSON.parse(JSON.stringify(data)) : null);
  // What you own, of one kind or all: [{ id, kind, name, data, updatedAt }].
  function ownedList(kind = null) {
    return Object.entries(readCache().owned).filter(([, entry]) => !kind || entry.kind === kind).map(([id, entry]) => ({ id, kind: entry.kind, name: entry.name, data: copy(entry.data), updatedAt: entry.updatedAt }));
  }
  // An owned pack's data ({ v, palette, nodeStyle?, material?, font? }), or null.
  function pack(id) {
    const entry = readCache().owned[id];
    return entry?.kind === "pack" ? copy(entry.data) : null;
  }
  // Reads what you own from the relay. A second ask while one is out runs once more after it, so a purchase is never
  // overwritten by an answer that left before it. -> { ok, changed } or { ok: false, error }
  let refreshing = null, again = false;
  function refresh() {
    if (refreshing) { again = true; return refreshing; }
    const api = bridge();
    if (typeof api?.hubShop !== "function") return Promise.resolve({ ok: false, error: "unavailable" });
    refreshing = (async () => {
      let answer;
      try { answer = await api.hubShop("shopOwned"); } catch { answer = null; }
      if (!answer?.ok || !Array.isArray(answer.items)) return { ok: false, error: answer?.error ?? "failed" };
      const owned = {};
      for (const item of answer.items) {
        const entry = cleanEntry(item?.id, item);
        if (entry) { owned[item.id] = entry; names.set(item.id, entry.name); }
      }
      return { ok: true, changed: setOwned(owned) };
    })().finally(() => {
      refreshing = null;
      if (again) { again = false; void refresh(); }
    });
    return refreshing;
  }

  // ---- which pet, scales or effect an item is: the module's own list says (kinds(), skins(), list()), else its id ----
  const slug = (id) => String(id ?? "").replace(/^studio:/, "");
  const petOf = (id) => safe(() => window.MefiPets.kinds().find((kind) => kind.item === id)?.id) ?? (slug(id).startsWith("pet-") ? slug(id).slice(4) : null);
  const skinOf = (id) => safe(() => window.MefiPets.skins().find((skin) => skin.item === id)?.id) ?? (slug(id).startsWith("skin-") ? slug(id).slice(5) : null);
  const effectOf = (id) => safe(() => window.MefiEffects.list().find((effect) => effect.item === id)?.id) ?? (slug(id).startsWith("fx-") ? slug(id).slice(3) : null);
  // Scales dress the pet they name, Ember when they name none.
  const petOfItem = (item) => petOf(item.kind === "skin" ? item.requires || EMBER : item.id);
  const petState = () => safe(() => window.MefiPets.state(), {});
  // The module that shows each kind, and whether it is in this build.
  const showerOf = (kind) => (kind === "effect" ? window.MefiEffects : kind === "pack" ? window.MefiMusic : window.MefiPets);
  function usable(item) {
    if (item.kind === "pet" || item.kind === "skin") return typeof window.MefiPets?.set === "function";
    if (item.kind === "effect") return typeof window.MefiEffects?.use === "function";
    return typeof window.MefiMusic?.applyPack === "function";
  }
  function tryable(item) {
    if (item.kind === "pet" || item.kind === "skin") return typeof window.MefiPets?.preview === "function";
    if (item.kind === "effect") return typeof window.MefiEffects?.preview === "function";
    return typeof window.MefiMusic?.previewPack === "function";
  }
  // A pack's data, from the relay's item or from what you own; null when it cannot be read.
  function dataOf(item) {
    const shaped = shapeOf(item?.data ?? pack(item?.id));
    return shaped.ok ? shaped.data : null;
  }
  function inUse(item) {
    if (item.kind === "pet") { const now = petState(); return Boolean(now.on) && now.kind === petOf(item.id); }
    if (item.kind === "skin") return petState().skin === skinOf(item.id);
    if (item.kind === "effect") return safe(() => window.MefiEffects.current()) === effectOf(item.id);
    return safe(() => window.MefiMusic.packInfo()?.id) === item.id;
  }

  // ---- the little previews ----
  function gem(cls = "friends-shop-gem") {
    const svg = document.createElementNS?.("http://www.w3.org/2000/svg", "svg") ?? document.createElement("svg");
    svg.setAttribute("class", `glyph ${cls}`); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const use = document.createElementNS?.("http://www.w3.org/2000/svg", "use") ?? document.createElement("use");
    use.setAttribute("href", "#g-shop"); svg.append(use);
    return svg;
  }
  // Pets fly only on screen: one loop for every pet canvas a card shows, about 30 frames a second, paused while the
  // window is hidden, a single still frame when motion is off.
  const pets = { all: new Set(), seen: new Set(), frame: 0, last: 0, watch: null };
  function drawPet(canvas, time) {
    try { window.MefiPets?.paintPreview?.(canvas, { kind: canvas.dataset.kind, skin: canvas.dataset.skin, time }); } catch { /* the next frame tries again */ }
  }
  function petCanvas(kind, skin, label) {
    const canvas = node("canvas", "friends-shop-pet");
    canvas.width = 360; canvas.height = 180;
    canvas.dataset.kind = kind || "dragon"; canvas.dataset.skin = skin || "theme";
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", label);
    pets.all.add(canvas);
    drawPet(canvas, 0);
    if (typeof IntersectionObserver === "function") {
      pets.watch ??= new IntersectionObserver((entries) => {
        for (const entry of entries) { if (entry.isIntersecting) pets.seen.add(entry.target); else pets.seen.delete(entry.target); }
        spin();
      });
      pets.watch.observe(canvas);
    }
    return canvas;
  }
  function spin() {
    if (pets.frame || !pets.seen.size || typeof requestAnimationFrame !== "function") return;
    pets.frame = requestAnimationFrame(petFrame);
  }
  function petFrame(now) {
    pets.frame = 0;
    for (const canvas of [...pets.seen]) if (canvas.isConnected === false) { pets.seen.delete(canvas); pets.all.delete(canvas); pets.watch?.unobserve(canvas); }
    if (!pets.seen.size || document.hidden) return;
    if (motionOff()) { for (const canvas of pets.seen) drawPet(canvas, 0); return; }
    if (now - pets.last >= 33) { pets.last = now; for (const canvas of pets.seen) drawPet(canvas, now); }
    pets.frame = requestAnimationFrame(petFrame);
  }
  function releasePets() {
    for (const canvas of pets.all) pets.watch?.unobserve(canvas);
    pets.all.clear(); pets.seen.clear();
    if (pets.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(pets.frame);
    pets.frame = 0;
  }
  try { document.addEventListener?.("visibilitychange", () => { if (!document.hidden) spin(); }); } catch { /* no document events here */ }

  // A tiny app window painted from a pack's own colours (inline custom properties): a sidebar, a title, two node orbs
  // on a wire, two lines of text and a button. The node style, material and font each change how it looks.
  function paintMock(mock, data) {
    const palette = data?.palette ?? {};
    for (const [key, prop] of [["accent", "--pack-accent"], ["accent2", "--pack-accent2"], ["background", "--pack-bg"], ["surface", "--pack-surface"], ["text", "--pack-text"]]) {
      const value = typeof palette[key] === "string" && HEX.test(palette[key]) ? palette[key] : key === "accent2" && HEX.test(palette.accent ?? "") ? palette.accent : null;
      if (value) mock.style.setProperty(prop, value); else mock.style.removeProperty(prop);
    }
    mock.dataset.nodeStyle = NODE_STYLES.includes(data?.nodeStyle) ? data.nodeStyle : "orbs";
    mock.dataset.material = MATERIALS.some(([id]) => id === data?.material) ? data.material : "studio";
    mock.dataset.font = FONTS.some(([id]) => id === data?.font) ? data.font : "studio";
  }
  function packMock(data, { big = false, title = "" } = {}) {
    const mock = node("div", `friends-shop-mock${big ? " is-big" : ""}`);
    mock.setAttribute("aria-hidden", "true");
    const side = node("div", "friends-shop-mock-side");
    side.append(node("span", "friends-shop-mock-line"), node("span", "friends-shop-mock-line"), node("span", "friends-shop-mock-line is-short"));
    const main = node("div", "friends-shop-mock-main");
    const tree = node("div", "friends-shop-mock-tree");
    tree.append(node("span", "friends-shop-mock-orb"), node("span", "friends-shop-mock-wire"), node("span", "friends-shop-mock-orb is-second"));
    const lines = node("div", "friends-shop-mock-words");
    lines.append(node("span", "friends-shop-mock-line"), node("span", "friends-shop-mock-line is-short"));
    main.append(node("div", "friends-shop-mock-title", title || "Aa"), tree, lines, node("span", "friends-shop-mock-button", big ? "Build it" : "Go"));
    mock.append(side, main);
    paintMock(mock, data);
    return mock;
  }
  // The five colours of a pack in a row, for the list of your packs.
  function swatches(data) {
    const strip = node("span", "friends-shop-swatches");
    strip.setAttribute("aria-hidden", "true");
    for (const [key] of COLOURS) {
      const value = data?.palette?.[key];
      if (typeof value !== "string" || !HEX.test(value)) continue;
      const swatch = node("i");
      swatch.style.setProperty("--swatch", value);
      strip.append(swatch);
    }
    return strip;
  }

  // ---- the Shop page ----
  let current = null; // the card on screen: { hear, show, paint, dispose }
  let hearing = false, watchingMods = false;
  let asked = null; // the view open(view) asked for, for the next card
  let lastView = "studio";
  let sort = "new"; // members' packs: New or Top
  // The style being made, kept while Studio runs (switching views or places keeps it).
  const draft = { name: "", blurb: "", palette: null, nodeStyle: "orbs", material: "studio", font: "studio", price: 0, lastPrice: 50, localId: null };
  let editing = null; // the published pack the editor changes, or null for a new one
  // The theme's own colours, as a new style's starting point.
  function themePalette() {
    const read = (name) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase(); } catch { return ""; } };
    const pick = (name, fallback) => { const value = read(name); return HEX.test(value) ? value : fallback; };
    return { accent: pick("--gold", STARTER.accent), accent2: pick("--info", STARTER.accent2), background: pick("--bg", STARTER.background), surface: pick("--panel-solid", STARTER.surface), text: pick("--ivory", STARTER.text) };
  }
  function freshDraft() {
    Object.assign(draft, { name: "", blurb: "", palette: themePalette(), nodeStyle: "orbs", material: "studio", font: "studio", price: 0, localId: null });
    // A starting point that does not pass the check starts from Studio's own colours instead.
    if (!checkPack({ v: 1, palette: draft.palette }).ok) draft.palette = { ...STARTER };
    editing = null;
  }
  const packFromDraft = () => ({ v: 1, palette: { ...draft.palette }, nodeStyle: draft.nodeStyle, material: draft.material, font: draft.font });

  // The hub's events: a connection that comes up reads what you own again; the card on screen hears the rest.
  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    let up = false;
    api.onHubEvent((event) => {
      if (event?.type === "status") {
        const ready = event.status?.state === "ready";
        if (ready && !up) void refresh();
        up = ready;
      }
      current?.hear(event);
    });
  }

  // A tab row's keys: arrows, Home and End choose the next view, and focus follows it.
  function arrowKeys(row) {
    row.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step && event.key !== "Home" && event.key !== "End") return;
      const items = [...row.children];
      const at = items.indexOf(event.target);
      if (at < 0) return;
      event.preventDefault?.();
      const next = items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + step + items.length) % items.length];
      next.click();
      next.focus?.();
    });
  }

  function card() {
    const root = node("section", "friends-shop");
    root.id = "friends-shop";
    root.setAttribute("aria-labelledby", "friends-shop-title");
    const title = node("h4", "friends-shop-title", "Shop");
    title.id = "friends-shop-title";
    // The try banner: the item being tried, its time left, Buy and Stop.
    const banner = node("div", "friends-shop-try");
    banner.id = "friends-shop-try";
    banner.hidden = true;
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Trying an item");
    const head = node("div", "friends-shop-head");
    const balance = node("span", "friends-shop-balance");
    balance.id = "friends-shop-balance";
    balance.hidden = true;
    const earn = button("How to earn credits", () => window.MefiNav?.go?.("friends-page", { place: "events" }), "friends-shop-earn", "friends-shop-link");
    head.append(balance, earn);
    const tabs = node("div", "friends-shop-views");
    tabs.id = "friends-shop-views";
    tabs.hidden = true;
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Shop views");
    const status = node("p", "friends-shop-status", "Checking the room service…");
    status.id = "friends-shop-status";
    status.setAttribute("role", "status");
    const body = node("div", "friends-shop-body");
    body.id = "friends-shop-body";
    root.append(title, banner, head, tabs, status, body);

    current?.dispose();
    const api = bridge();
    let view = VIEWS.some(([id]) => id === asked) ? asked : lastView;
    asked = null;
    let ready = false, me = null, balanceNow = null, canEarn = true, hold = null;
    let items = [], next = null, mine = [], busy = false, gone = false, seq = 0, autoConnected = false, loading = false;
    let notReady = () => []; // what shows while the Shop cannot be reached (nothing until the room service has answered)
    let confirm = null; // { id, price, tip, where: "card" | "banner", changed, short }: a purchase waiting for a yes
    let reporting = null; // the pack whose report form is open
    let tried = null; // { item, endsAt, timer, clock, words }: the one item being tried
    const stages = new Map(); // effect item id -> its little menu, for Try
    const make = {}; // the editor's live parts

    for (const [id, label] of VIEWS) {
      const tab = button(label, () => show(id), `friends-shop-view-${id}`, "friends-shop-tab");
      tab.dataset.view = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "friends-shop-body");
      tabs.append(tab);
    }
    arrowKeys(tabs);

    const call = async (method, ...args) => { try { return await api.hubShop(method, ...args); } catch { return { ok: false, error: "failed" }; } };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch { status.textContent = "The Shop could not do that. Try again."; }
      busy = false;
      root.removeAttribute("aria-busy");
    };
    const isOwned = (item) => item.owned === true || owns(item.id) || mineItem(item);
    const mineItem = (item) => Boolean(me) && item.maker?.id === me;
    const memberPack = (item) => item.kind === "pack" && !String(item.id).startsWith("studio:");
    const nameOf = (id) => names.get(id) ?? "the item it needs";

    // ---- the parts around the view ----
    function paintChrome() {
      const known = Number.isFinite(balanceNow);
      balance.hidden = !known;
      if (known) balance.replaceChildren(gem(), node("span", "", credits(balanceNow)));
      tabs.hidden = !ready;
      for (const tab of tabs.children) {
        const on = tab.dataset.view === view;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      if (ready) { body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", `friends-shop-view-${view}`); }
      else { body.removeAttribute("role"); body.removeAttribute("aria-labelledby"); }
    }
    const clock = (ms) => { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };
    const tryWords = () => `Trying ${tried.item.name} · ${clock(tried.endsAt - Date.now())} left`;
    function paintTry() {
      if (!tried) { banner.hidden = true; banner.replaceChildren(); return; }
      const { item } = tried;
      banner.hidden = false;
      const words = node("span", "friends-shop-try-words", tryWords());
      words.id = "friends-shop-try-words";
      tried.words = words;
      const parts = [words];
      if (!isOwned(item) && Number.isFinite(item.price) && item.price > 0) parts.push(button("Buy", () => ask(item, "banner"), "friends-shop-try-buy", PRIMARY));
      parts.push(button("Stop", () => stopTry(), "friends-shop-try-stop"));
      banner.replaceChildren(...parts);
      if (confirm?.where === "banner" && confirm.id === item.id) banner.append(confirmPanel(item));
    }

    // ---- one item ----
    function meta(item) {
      const line = node("p", "friends-shop-meta");
      if (isOwned(item)) line.append(node("span", "friends-shop-owned", mineItem(item) ? "Your pack" : "Yours"));
      // A member's free pack can still carry a tip for its maker.
      else if (item.price === 0) line.append(node("span", "friends-shop-price", memberPack(item) ? "Free · tips welcome" : "Free"));
      else if (Number.isFinite(item.price)) {
        const price = node("span", "friends-shop-price");
        price.append(gem(), node("span", "", credits(item.price)));
        line.append(price);
      }
      if (memberPack(item) && count(item.sales) != null) line.append(node("span", "friends-shop-sales", plural(item.sales, "sale")));
      if (item.requires && !isOwned(item) && !owns(item.requires)) line.append(node("span", "friends-shop-needs", `Needs ${nameOf(item.requires)}`));
      if (item.status === "unlisted") line.append(node("span", "friends-shop-note", "No longer listed"));
      return line;
    }
    function preview(item) {
      const box = node("div", "friends-shop-preview");
      if (item.kind === "pet" || item.kind === "skin") {
        if (typeof window.MefiPets?.paintPreview === "function") box.append(petCanvas(petOfItem(item), item.kind === "skin" ? skinOf(item.id) : "theme", `${item.name}, flying`));
        else { const still = node("span", "friends-shop-placeholder"); still.setAttribute("aria-hidden", "true"); still.append(gem("friends-shop-placeholder-gem")); box.append(still); }
      } else if (item.kind === "effect") box.append(effectStage(item));
      else box.append(packMock(dataOf(item), { title: item.name }));
      return box;
    }
    // A little menu that plays the effect's exit (MefiEffects.demo), then comes back fresh for the next look.
    function effectStage(item) {
      const stage = node("div", "friends-shop-stage");
      stage.setAttribute("aria-hidden", "true");
      const menu = () => {
        const box = node("div", "friends-shop-menu");
        box.append(node("span", "friends-shop-menu-head"), node("span", "friends-shop-menu-row"), node("span", "friends-shop-menu-row"), node("span", "friends-shop-menu-row is-short"));
        return box;
      };
      stage.append(menu());
      let playing = false;
      stage.play = () => {
        const demo = window.MefiEffects?.demo;
        if (playing || gone || typeof demo !== "function" || motionOff()) return;
        playing = true;
        let done = null;
        try { done = demo.call(window.MefiEffects, stage.querySelector(".friends-shop-menu"), effectOf(item.id)); } catch { done = null; }
        const settled = done && typeof done.then === "function" ? done.then(() => wait(450), () => wait(450)) : wait(1700);
        void settled.then(() => { stage.replaceChildren(menu()); playing = false; });
      };
      stages.set(item.id, stage);
      return stage;
    }
    function actions(item) {
      const row = node("div", "friends-shop-actions");
      const key = domId(item.id);
      const named = (control) => { control.setAttribute("aria-describedby", `friends-shop-name-${key}`); return control; };
      if (isOwned(item)) {
        if (!usable(item)) row.append(node("span", "friends-shop-soon", SOON));
        else if (inUse(item)) {
          row.append(node("span", "friends-shop-inuse", "In use"));
          if (item.kind === "pet" || item.kind === "effect") row.append(named(button("Turn off", () => turnOff(item), `friends-shop-off-${key}`)));
        } else row.append(named(button("Use", () => use(item), `friends-shop-use-${key}`, PRIMARY)));
      } else if (ready) {
        if (!usable(item) || !tryable(item)) row.append(node("span", "friends-shop-soon", SOON));
        else {
          const trying = tried?.item.id === item.id;
          row.append(named(button(trying ? "Stop trying" : "Try for 2 minutes", () => tryIt(item), `friends-shop-try-${key}`)));
          // Getting a member's free pack asks first too: a tip for its maker may go with it.
          if (item.price === 0) row.append(named(button("Get", () => { if (memberPack(item)) ask(item, "card"); else void get(item); }, `friends-shop-get-${key}`, PRIMARY)));
          else if (Number.isFinite(item.price)) {
            const buyIt = button(`Buy for ${item.price}`, () => ask(item, "card"), `friends-shop-buy-${key}`, PRIMARY);
            buyIt.append(gem());
            row.append(named(buyIt));
          }
        }
      }
      // Anyone may report a member's pack; a moderator may also take it out of the Shop.
      if (ready && memberPack(item) && !mineItem(item)) {
        row.append(named(button(reporting === item.id ? "Cancel report" : "Report", () => { reporting = reporting === item.id ? null : item.id; paint(); focusOn(reporting ? `friends-shop-report-ask-${key}` : `friends-shop-report-${key}`); }, `friends-shop-report-${key}`)));
        if (window.MefiFriendsMod?.isMod?.() === true) row.append(named(confirmed("Remove", "Remove it?", `Take ${item.name} out of the Shop? Members who got it lose it.`, () => { void remove(item); }, `friends-shop-remove-${key}`)));
      }
      return row;
    }
    function itemCard(item) {
      const key = domId(item.id);
      const box = node("article", "friends-shop-item");
      box.dataset.item = item.id;
      box.dataset.kind = item.kind;
      box.setAttribute("aria-labelledby", `friends-shop-name-${key}`);
      const words = node("div", "friends-shop-words");
      const name = node("h3", "friends-shop-name", item.name);
      name.id = `friends-shop-name-${key}`;
      words.append(name);
      const maker = item.maker?.name ? `by ${item.maker.name}` : String(item.id).startsWith("studio:") ? "by Mefi Studio" : "";
      if (maker) words.append(node("p", "friends-shop-by", maker));
      if (item.blurb) words.append(node("p", "friends-shop-blurb", item.blurb));
      words.append(meta(item));
      box.append(preview(item), words, actions(item));
      if (confirm?.where === "card" && confirm.id === item.id) box.append(confirmPanel(item));
      if (reporting === item.id) box.append(reportPanel(item));
      // An effect plays when the card is pointed at or reached with the keyboard.
      const stage = stages.get(item.id);
      if (item.kind === "effect" && stage) { box.addEventListener("pointerenter", () => stage.play()); box.addEventListener("focusin", () => stage.play()); }
      return box;
    }
    function grid(list, first = []) {
      const box = node("div", "friends-shop-grid");
      box.append(...first, ...list.map(itemCard));
      return box;
    }
    // Ember the dragon: free with every Studio, so no price, Try or Buy; a switch lets it out or rests it.
    function emberCard() {
      const box = node("article", "friends-shop-item friends-shop-ember");
      box.dataset.item = EMBER;
      box.dataset.kind = "pet";
      box.setAttribute("aria-labelledby", "friends-shop-name-ember");
      const look = node("div", "friends-shop-preview");
      if (typeof window.MefiPets?.paintPreview === "function") look.append(petCanvas(petOf(EMBER) ?? "dragon", petState().skin || "theme", "Ember the dragon, flying"));
      else { const still = node("span", "friends-shop-placeholder"); still.setAttribute("aria-hidden", "true"); still.append(gem("friends-shop-placeholder-gem")); look.append(still); }
      const words = node("div", "friends-shop-words");
      const name = node("h3", "friends-shop-name", "Ember the dragon");
      name.id = "friends-shop-name-ember";
      const line = node("p", "friends-shop-meta");
      line.append(node("span", "friends-shop-price", "Free"));
      words.append(name, node("p", "friends-shop-by", "Free with every Studio"), node("p", "friends-shop-blurb", EMBER_BLURB), line);
      const row = node("div", "friends-shop-actions");
      if (typeof window.MefiPets?.set !== "function") row.append(node("span", "friends-shop-soon", SOON));
      else {
        const on = petState().on === true;
        const toggle = button("", () => {
          const next = petState().on !== true;
          try { window.MefiPets.set({ on: next }); } catch { /* said below either way */ }
          status.textContent = next ? "Ember is out. Look for it around your studio." : "Ember is resting.";
          paint();
        }, "friends-shop-ember-switch", "friends-shop-switch");
        toggle.setAttribute("role", "switch");
        toggle.setAttribute("aria-checked", String(on));
        toggle.setAttribute("aria-describedby", "friends-shop-name-ember");
        const track = node("span", "friends-shop-switch-track");
        track.setAttribute("aria-hidden", "true");
        track.append(node("span", "friends-shop-switch-thumb"));
        // The switch's name stays "Show Ember"; On or Off beside it is for the eye (the switch's state is aria-checked).
        const state = node("span", "friends-shop-switch-state", on ? "On" : "Off");
        state.setAttribute("aria-hidden", "true");
        toggle.append(track, node("span", "friends-shop-switch-label", "Show Ember"), state);
        row.append(toggle);
      }
      box.append(look, words, row);
      return box;
    }
    // Items under their headings: Pets (Ember first, when asked for, then scales), Menu effects, Style packs.
    function grouped(list, empty, { ember = false } = {}) {
      if (!list.length && !ember) return [node("p", "friends-shop-empty", empty)];
      return GROUPS.map(([key, label]) => {
        const members = list.filter((item) => groupOf(item.kind) === key);
        const first = key === "pet" && ember ? [emberCard()] : [];
        if (!members.length && !first.length) return null;
        const box = node("section", "friends-shop-group");
        box.setAttribute("aria-labelledby", `friends-shop-group-${key}`);
        const heading = node("h2", "friends-shop-group-title", label);
        heading.id = `friends-shop-group-${key}`;
        box.append(heading, grid(members, first));
        return box;
      });
    }

    // ---- buying, with an explicit yes (and, for a member's pack, a tip for its maker if you like) ----
    function ask(item, where = "card") {
      confirm = { id: item.id, price: item.price, tip: 0, where, changed: false, short: false };
      paint();
      focusOn(`friends-shop-ask-${domId(item.id)}`);
    }
    function shortWords(item, price, have) {
      const more = Number.isFinite(have) && Number.isFinite(price) ? price - have : null;
      return `${more != null && more > 0 ? `You need ${credits(more)} more` : "You need more credits"} for ${item.name}. Earn them by playing and starring friends' projects, building together, co-work hours and the Build Jam.`;
    }
    // The biggest tip the balance leaves room for after the price (all of TIP_MAX while the balance is not known).
    const tipRoom = (price) => Math.max(0, Math.min(TIP_MAX, Number.isFinite(balanceNow) ? balanceNow - price : TIP_MAX));
    function setTip(item, amount) {
      if (confirm?.id !== item.id) return;
      const value = Math.floor(Number(amount));
      confirm.tip = Number.isFinite(value) ? Math.max(0, Math.min(tipRoom(confirm.price), value)) : 0;
      paint();
    }
    // "Add a tip for the maker": the quick picks (one the balance cannot cover is off) and any other amount up to 100.
    function tipPart(item) {
      const key = domId(item.id);
      const room = tipRoom(confirm.price);
      const box = node("div", "friends-shop-tips");
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", `friends-shop-tip-title-${key}`);
      const title = node("p", "friends-shop-tip-title", "Add a tip for the maker");
      title.id = `friends-shop-tip-title-${key}`;
      const picks = node("div", "friends-shop-tip-picks");
      for (const amount of TIPS) {
        const pick = button(amount ? String(amount) : "No tip", () => setTip(item, amount), `friends-shop-tip-${key}-${amount}`, "friends-shop-chip");
        pick.setAttribute("aria-pressed", String((confirm.tip ?? 0) === amount));
        if (amount) pick.setAttribute("aria-label", `Tip ${credits(amount)}`);
        pick.disabled = amount > room;
        picks.append(pick);
      }
      const other = node("input", "friends-shop-tip-other");
      other.type = "number";
      other.min = "0";
      other.max = String(room);
      other.step = "1";
      other.id = `friends-shop-tip-${key}-other`;
      other.placeholder = "Other";
      other.value = TIPS.includes(confirm.tip ?? 0) ? "" : String(confirm.tip);
      other.setAttribute("aria-label", `Another tip, up to ${credits(room)}`);
      other.addEventListener("change", () => setTip(item, other.value));
      picks.append(other);
      box.append(title, picks, node("p", "friends-shop-tip-fine", `${item.maker?.name ?? "Its maker"} gets up to three quarters of what you pay.`));
      return box;
    }
    function confirmPanel(item) {
      const key = domId(item.id);
      const where = confirm.where;
      const box = node("div", "friends-shop-confirm");
      box.id = `friends-shop-confirm-${key}`;
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", `friends-shop-ask-${key}`);
      const question = node("p", "friends-shop-ask");
      question.id = `friends-shop-ask-${key}`;
      question.tabIndex = -1;
      const close = () => { confirm = null; paint(); focusOn(where === "banner" ? "friends-shop-try-buy" : item.price === 0 ? `friends-shop-get-${key}` : `friends-shop-buy-${key}`); };
      const price = confirm.price;
      // Tips are for members' packs only; Studio's own items never carry one.
      const tips = memberPack(item);
      const tip = tips ? confirm.tip ?? 0 : 0;
      const total = price + tip;
      const after = Number.isFinite(balanceNow) && Number.isFinite(total) ? balanceNow - total : null;
      if (confirm.short || (Number.isFinite(balanceNow) && Number.isFinite(price) && balanceNow < price)) {
        question.textContent = shortWords(item, price, balanceNow);
        box.append(question, button("How to earn credits", () => window.MefiNav?.go?.("friends-page", { place: "events" }), `friends-shop-earn-${key}`), button("Close", close, `friends-shop-no-${key}`));
      } else {
        const tipped = tip ? ` and tip its maker ${credits(tip)}` : "";
        const asked = price > 0 ? `Buy ${item.name} for ${credits(price)}${tipped}?` : `Get ${item.name}${tipped}?${tip ? "" : " It's free."}`;
        const sum = price > 0 && tip ? ` That is ${credits(total)} in all.` : "";
        const left = after != null && total > 0 ? ` You will have ${credits(after)} left.` : "";
        question.textContent = `${confirm.changed ? `The price changed to ${credits(price)}. ` : ""}${asked}${sum}${left}`;
        const tools = node("div", "friends-shop-actions");
        tools.append(button(price > 0 ? "Yes, buy it" : "Yes, get it", () => { void buy(item, price, tip); }, `friends-shop-yes-${key}`, PRIMARY), button("Not now", close, `friends-shop-no-${key}`));
        box.append(question, ...(tips ? [tipPart(item)] : []), tools);
      }
      box.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); close(); } });
      return box;
    }
    async function buy(item, price, tip = 0) {
      await guard(price > 0 ? "Buying…" : "Getting it…", async () => {
        // A member's pack is bought with its tip (0 to 100); Studio's own items with the price alone.
        const tipping = memberPack(item);
        const answer = tipping ? await call("shopBuy", item.id, price, tip) : await call("shopBuy", item.id, price);
        if (!answer?.ok) { refusal(item, answer, price, tipping ? tip : 0); return; }
        confirm = null;
        // The relay answers { item, paid, balance }: its balance is the one to show, its item the one to keep.
        const paid = Number.isFinite(answer.paid) ? answer.paid : price + (tipping ? tip : 0);
        balanceNow = Number.isFinite(answer.balance) ? answer.balance : Number.isFinite(balanceNow) ? balanceNow - paid : balanceNow;
        item.owned = true;
        markOwned(plainObject(answer.item) && answer.item.id === item.id ? { ...item, ...answer.item } : item);
        // Bought while trying it: it stays on.
        const keep = tried?.item.id === item.id;
        if (keep) { endTry(); use(item, { quiet: true }); }
        const thanks = tipping && tip > 0 ? ` Thank you for the ${tip} credit tip.` : "";
        status.textContent = keep ? `${item.name} is yours, and in use.${thanks}` : `${item.name} is yours.${thanks} Use it any time.`;
        paint();
        focusOn(keep ? "friends-shop-status" : `friends-shop-use-${domId(item.id)}`);
        void refresh();
      });
    }
    async function get(item) {
      await guard("Getting it…", async () => {
        const answer = await call("shopBuy", item.id, 0);
        if (!answer?.ok) { refusal(item, answer, 0); return; }
        item.owned = true;
        markOwned(plainObject(answer.item) && answer.item.id === item.id ? { ...item, ...answer.item } : item);
        status.textContent = `${item.name} is yours. Use it any time.`;
        paint();
        focusOn(`friends-shop-use-${domId(item.id)}`);
        void refresh();
      });
    }
    // Why a purchase did not go through, and what to do about it.
    function refusal(item, answer, price, tip = 0) {
      const code = [answer?.reason, answer?.error].find((value) => ["short", "needs", "price-changed", "no-tip", "owned", "own", "gone", "not-found", "hold"].includes(value)) ?? answer?.error;
      const where = confirm?.where ?? "card";
      switch (code) {
        case "short": {
          const have = Number.isFinite(answer.balance) ? answer.balance : balanceNow;
          const cost = Number.isFinite(answer.price) ? answer.price : price;
          if (Number.isFinite(have)) balanceNow = have;
          // Enough for the pack but not for the tip: ask again, with a tip the balance covers.
          if (tip > 0 && Number.isFinite(have) && have >= cost) {
            confirm = { id: item.id, price: cost, tip: 0, where, changed: false, short: false };
            status.textContent = `You have ${credits(have)}: enough for ${item.name}, not for that tip. Choose a smaller tip, or none.`;
          } else {
            confirm = { id: item.id, price: cost, tip: 0, where, changed: false, short: true };
            status.textContent = shortWords(item, cost, have);
          }
          break;
        }
        case "needs":
          // Nothing in today's Shop needs another item first (Ember's scales are sold on their own); kept for what comes later.
          confirm = null;
          status.textContent = `Get ${nameOf(answer.needs ?? item.requires)} first.`;
          break;
        case "price-changed":
          if (Number.isFinite(answer.price)) {
            item.price = answer.price;
            confirm = { id: item.id, price: answer.price, tip, where, changed: true, short: false };
            status.textContent = `The price of ${item.name} changed to ${credits(answer.price)}. Buy it for that?`;
          } else { confirm = null; status.textContent = `The price of ${item.name} changed. Look again, then buy.`; void loadView(); }
          break;
        case "no-tip":
          confirm = { id: item.id, price, tip: 0, where, changed: false, short: false };
          status.textContent = `${item.name} cannot take a tip: tips are only for members' style packs. Buy it without one?`;
          break;
        case "owned":
          confirm = null;
          item.owned = true;
          markOwned(item);
          status.textContent = `You already own ${item.name}.`;
          void refresh();
          break;
        case "own":
          confirm = null;
          status.textContent = "That's your own pack, so it's already yours to use.";
          break;
        case "gone":
        case "not-found":
          confirm = null;
          status.textContent = `${item.name} is no longer in the Shop.`;
          void loadView();
          break;
        case "hold":
          confirm = null;
          status.textContent = holdWords(holdOf(answer));
          break;
        default:
          status.textContent = reasonWords(answer, "That did not go through. Try again.");
      }
      paint();
      if (confirm) focusOn(`friends-shop-ask-${domId(item.id)}`);
    }

    // ---- trying, two minutes, one item at a time ----
    function tryIt(item) {
      if (tried?.item.id === item.id) { stopTry(); return; }
      endTry();
      try {
        if (item.kind === "pet" || item.kind === "skin") window.MefiPets.preview({ kind: petOfItem(item), skin: item.kind === "skin" ? skinOf(item.id) : petState().skin || "theme" }, TRY_MS);
        else if (item.kind === "effect") window.MefiEffects.preview(effectOf(item.id), TRY_MS);
        else {
          const data = dataOf(item);
          if (!data) throw new Error("no pack");
          window.MefiMusic.previewPack({ id: item.id, name: item.name, ...data });
        }
      } catch {
        status.textContent = `${item.name} could not be tried just now.`;
        return;
      }
      tried = {
        item, endsAt: Date.now() + TRY_MS, words: null,
        timer: setTimeout(() => { const ended = endTry(); if (ended) { status.textContent = `Your two minutes with ${ended.name} are over.`; paint(); } }, TRY_MS),
        clock: setInterval(() => { if (tried?.words) tried.words.textContent = tryWords(); }, 1000),
      };
      status.textContent = `Trying ${item.name} for two minutes.`;
      paint();
      // After the repaint: the card's little menu plays the effect it is trying.
      stages.get(item.id)?.play();
    }
    // Ends the try that is on, if any (its module's endPreview). -> the item that was being tried
    function endTry() {
      if (!tried) return null;
      const { item, timer, clock: ticking } = tried;
      tried = null;
      clearTimeout(timer);
      clearInterval(ticking);
      safe(() => showerOf(item.kind)?.endPreview?.());
      if (confirm?.where === "banner") confirm = null;
      return item;
    }
    function stopTry() {
      const item = endTry();
      if (item) status.textContent = `Stopped trying ${item.name}.`;
      paint();
      if (item) focusOn(`friends-shop-try-${domId(item.id)}`);
    }

    // ---- using what you own ----
    function use(item, { quiet = false } = {}) {
      if (tried) endTry();
      let done = false;
      try {
        if (item.kind === "pet") { window.MefiPets.set({ on: true, kind: petOf(item.id) }); done = true; }
        else if (item.kind === "skin") { window.MefiPets.set({ skin: skinOf(item.id) }); done = true; }
        else if (item.kind === "effect") { window.MefiEffects.use(effectOf(item.id)); done = true; }
        else {
          const data = dataOf(item);
          if (data) { window.MefiMusic.applyPack({ id: item.id, name: item.name, ...data }, true); done = true; }
        }
      } catch { done = false; }
      if (quiet) return done;
      status.textContent = done ? `${item.name} is in use.` : `${item.name} could not be put to use just now.`;
      paint();
      return done;
    }
    function turnOff(item) {
      try {
        if (item.kind === "pet") window.MefiPets.set({ on: false });
        else window.MefiEffects.use("none");
      } catch { /* said below either way */ }
      status.textContent = item.kind === "pet" ? `${item.name} is resting.` : "Menus close the usual way again.";
      paint();
    }

    // ---- reports and removals (members' packs) ----
    function reportPanel(item) {
      const key = domId(item.id);
      const form = node("form", "friends-shop-report");
      form.id = `friends-shop-report-form-${key}`;
      const question = node("p", "friends-shop-ask", `What is wrong with ${item.name}?`);
      question.id = `friends-shop-report-ask-${key}`;
      question.tabIndex = -1;
      const choices = node("div", "friends-shop-reasons");
      choices.setAttribute("role", "radiogroup");
      choices.setAttribute("aria-labelledby", question.id);
      const picks = REPORT_REASONS.map((reason, index) => {
        const label = node("label", "friends-shop-reason");
        const radio = node("input");
        radio.type = "radio";
        radio.name = `friends-shop-why-${key}`;
        radio.value = reason;
        radio.id = `friends-shop-why-${key}-${index}`;
        label.append(radio, node("span", "", reason));
        choices.append(label);
        return radio;
      });
      const more = node("input", "friends-shop-report-text");
      more.type = "text";
      more.maxLength = 300;
      more.id = `friends-shop-report-text-${key}`;
      more.placeholder = "Anything a moderator should know (optional)";
      more.setAttribute("aria-label", "Anything a moderator should know (optional)");
      const send = node("button", PRIMARY, "Send report");
      send.type = "submit";
      send.id = `friends-shop-report-send-${key}`;
      const tools = node("div", "friends-shop-actions");
      tools.append(send, button("Cancel", () => { reporting = null; paint(); focusOn(`friends-shop-report-${key}`); }, `friends-shop-report-cancel-${key}`));
      form.append(question, choices, more, tools);
      form.addEventListener("submit", (event) => {
        event.preventDefault?.();
        const reason = picks.find((radio) => radio.checked)?.value;
        if (!reason) { status.textContent = "Choose what is wrong with it first."; return; }
        void guard("Sending the report…", async () => {
          const text = more.value.trim().slice(0, 300);
          const answer = await call("shopReport", item.id, text ? { reason, text } : { reason });
          if (answer?.ok) reporting = null;
          status.textContent = answer?.ok ? "Thanks. A moderator will look at it." : reasonWords(answer, "The report did not go through.");
          paint();
        });
      });
      return form;
    }
    async function remove(item) {
      await guard("Removing…", async () => {
        const answer = await call("modShopRemove", item.id, {});
        status.textContent = answer?.ok ? `${item.name} is out of the Shop.` : reasonWords(answer, "It could not be removed.");
        if (answer?.ok) await loadView();
      });
    }

    // ---- the views ----
    function communityView() {
      const row = node("div", "friends-shop-sort");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Show members' packs by");
      for (const [key, label] of [["new", "New"], ["top", "Top"]]) {
        // The list on screen stays until the other order arrives.
        const choice = button(label, () => { if (sort === key) return; sort = key; paint(); void loadView(); }, `friends-shop-sort-${key}`, "friends-shop-chip");
        choice.setAttribute("aria-pressed", String(sort === key));
        row.append(choice);
      }
      const parts = [row, node("p", "friends-shop-lead", "Style packs members made. Anyone can make one under Make a style.")];
      parts.push(items.length ? grid(items) : node("p", "friends-shop-empty", sort === "new" ? "No member has published a style pack yet. Be the first: Make a style." : "No pack has sold yet."));
      if (next) parts.push(button("Show more", () => { void loadView({ more: true }); }, "friends-shop-more"));
      return parts;
    }
    // What you own, from this PC's own list, while the Shop is out of reach: it all keeps working.
    function yours() {
      const list = ownedList().filter((entry) => entry.id !== EMBER).map((entry) => ({ id: entry.id, kind: entry.kind, name: entry.name, blurb: "", price: null, requires: null, maker: null, data: entry.data, sales: null, owned: true, status: "listed" }));
      // Ember is everyone's: its switch works here too, when this build has pets.
      const ember = typeof window.MefiPets?.set === "function" ? [emberCard()] : [];
      if (!list.length && !ember.length) return [];
      const box = node("section", "friends-shop-yours");
      box.id = "friends-shop-yours";
      box.setAttribute("aria-labelledby", "friends-shop-yours-title");
      const heading = node("h2", "friends-shop-group-title", "Your items");
      heading.id = "friends-shop-yours-title";
      box.append(heading, node("p", "friends-shop-lead", "What you own keeps working while the Shop is out of reach."), grid(list, ember));
      return [box];
    }

    // ---- Make a style ----
    function makeView() {
      if (!draft.palette) freshDraft();
      const wrap = node("section", "friends-shop-make");
      wrap.id = "friends-shop-make";
      wrap.setAttribute("aria-labelledby", "friends-shop-make-title");
      const heading = node("h2", "friends-shop-group-title", editing ? `Change ${draft.name.trim() || "your pack"}` : "Make a style");
      heading.id = "friends-shop-make-title";
      const lead = node("p", "friends-shop-lead", "Five colours, a node style, a material and a font. Use it yourself, or publish it in the Shop, free or for credits: when a member buys it, you earn three quarters of the price, up to 100 credits a week from any one member.");
      const layout = node("div", "friends-shop-make-layout");
      const side = node("div", "friends-shop-make-side");
      make.mock = packMock(packFromDraft(), { big: true, title: draft.name.trim() || "Your style" });
      make.mock.id = "friends-shop-make-preview";
      make.readout = node("ul", "friends-shop-contrast");
      make.readout.id = "friends-shop-contrast";
      make.readout.setAttribute("aria-label", "How easy it is to read");
      side.append(make.mock, make.readout);
      layout.append(editorForm(), side);
      wrap.append(heading, lead, layout);
      refreshMake();
      return [wrap, minePart()];
    }
    function field(label, control) {
      const wrap = node("label", "friends-shop-field");
      wrap.append(node("span", "friends-shop-label", label), control);
      return wrap;
    }
    function choice(id, options, value, set) {
      const select = node("select");
      select.id = id;
      for (const [key, label, off] of options) {
        const option = node("option", "", label);
        option.value = key;
        if (off) option.disabled = true;
        select.append(option);
      }
      select.value = value;
      select.addEventListener("change", () => { set(select.value); refreshMake(); });
      return select;
    }
    function colourRow(key, label) {
      const row = node("div", "friends-shop-colour");
      const words = node("label", "friends-shop-colour-name", label);
      words.htmlFor = `friends-shop-colour-${key}-hex`;
      const picker = node("input", "friends-shop-picker");
      picker.type = "color";
      picker.id = `friends-shop-colour-${key}`;
      picker.value = HEX.test(draft.palette[key] ?? "") ? draft.palette[key].toLowerCase() : "#000000";
      picker.setAttribute("aria-label", `${label} colour`);
      const hex = node("input", "friends-shop-hex");
      hex.type = "text";
      hex.id = `friends-shop-colour-${key}-hex`;
      hex.value = draft.palette[key] ?? "";
      hex.maxLength = 7;
      hex.spellcheck = false;
      hex.setAttribute("pattern", "#[0-9A-Fa-f]{6}");
      hex.setAttribute("aria-invalid", String(!HEX.test(hex.value)));
      picker.addEventListener("input", () => {
        draft.palette[key] = picker.value.toLowerCase();
        hex.value = draft.palette[key];
        hex.setAttribute("aria-invalid", "false");
        refreshMake();
      });
      hex.addEventListener("input", () => {
        const value = hex.value.trim();
        const fine = HEX.test(value);
        hex.setAttribute("aria-invalid", String(!fine));
        draft.palette[key] = fine ? value.toLowerCase() : value;
        if (fine) picker.value = value.toLowerCase();
        refreshMake();
      });
      row.append(words, picker, hex);
      return row;
    }
    function editorForm() {
      const form = node("form", "friends-shop-form");
      form.id = "friends-shop-form";
      form.setAttribute("aria-label", "Your style");
      const name = node("input");
      name.type = "text";
      name.id = "friends-shop-pack-name";
      name.maxLength = 40;
      name.value = draft.name;
      name.placeholder = "Night market";
      name.addEventListener("input", () => { draft.name = name.value; refreshMake(); });
      const blurb = node("input");
      blurb.type = "text";
      blurb.id = "friends-shop-pack-blurb";
      blurb.maxLength = 160;
      blurb.value = draft.blurb;
      blurb.placeholder = "One line about it (optional)";
      blurb.addEventListener("input", () => { draft.blurb = blurb.value; refreshMake(); });
      const colours = node("fieldset", "friends-shop-colours");
      colours.append(node("legend", "", "Colours"));
      for (const [key, label] of COLOURS) colours.append(colourRow(key, label));
      const looks = node("div", "friends-shop-looks");
      looks.append(
        field("Node style", choice("friends-shop-pack-node", NODE_STYLES.map((key) => [key, nodeStyleName(key)]), draft.nodeStyle, (value) => { draft.nodeStyle = value; })),
        field("Material", choice("friends-shop-pack-material", MATERIALS, draft.material, (value) => { draft.material = value; })),
        field("Font", choice("friends-shop-pack-font", FONTS, draft.font, (value) => { draft.font = value; })),
      );
      // The price: free, or 10 to 250 credits (selling for credits waits for good standing).
      const prices = node("fieldset", "friends-shop-price-row");
      prices.append(node("legend", "", "Price"));
      const amount = node("input", "friends-shop-amount");
      amount.type = "number";
      amount.id = "friends-shop-pack-price";
      amount.min = "10";
      amount.max = "250";
      amount.step = "1";
      amount.value = String(draft.price > 0 ? draft.price : draft.lastPrice);
      amount.hidden = !(draft.price > 0);
      amount.setAttribute("aria-label", "Price in credits, 10 to 250");
      amount.addEventListener("input", () => {
        const value = Number(amount.value);
        draft.price = amount.value.trim() === "" ? NaN : value;
        if (Number.isInteger(value) && value >= 10 && value <= 250) draft.lastPrice = value;
        refreshMake();
      });
      const mode = choice("friends-shop-pack-price-mode", [["free", "Free"], ["credits", "For credits", !canEarn && !(draft.price > 0)]], draft.price > 0 || Number.isNaN(draft.price) ? "credits" : "free", (value) => {
        draft.price = value === "credits" ? draft.lastPrice : 0;
        amount.hidden = value !== "credits";
        amount.value = String(draft.lastPrice);
      });
      mode.setAttribute("aria-label", "Free or for credits");
      prices.append(mode, amount);
      if (!canEarn) prices.append(node("p", "friends-shop-hold", `Selling for credits: ${holdWords(hold)} You can publish it free now.`));
      const check = node("p", "friends-shop-check");
      check.id = "friends-shop-check";
      const publish = node("button", PRIMARY, editing ? "Save changes" : "Publish");
      publish.type = "submit";
      publish.id = "friends-shop-publish";
      publish.setAttribute("aria-describedby", check.id);
      const useMine = button("Use it myself", () => useOwnStyle(), "friends-shop-use-mine");
      useMine.setAttribute("aria-describedby", check.id);
      const tools = node("div", "friends-shop-actions");
      tools.append(publish, useMine);
      if (editing) tools.append(button("Start a new style", () => { freshDraft(); paint(); focusOn("friends-shop-pack-name"); }, "friends-shop-new"));
      form.append(field("Name", name), field("About it", blurb), colours, looks, prices, check, tools);
      form.addEventListener("submit", (event) => { event.preventDefault?.(); void publishDraft(); });
      Object.assign(make, { check, publish, useMine });
      return form;
    }
    // The preview, the contrast readout and what (if anything) stops publishing, live as you change things.
    function refreshMake() {
      if (!make.mock || !make.readout) return;
      const data = packFromDraft();
      paintMock(make.mock, data);
      const mockTitle = make.mock.querySelector(".friends-shop-mock-title");
      if (mockTitle) mockTitle.textContent = draft.name.trim() || "Your style";
      make.readout.replaceChildren(...READABLE.map(([a, b, label, need, good]) => {
        const ratio = contrast(data.palette[a], data.palette[b]);
        const fine = ratio != null && ratio >= need;
        const row = node("li", fine ? "is-good" : "is-low");
        row.append(node("span", "friends-shop-ratio", ratio == null ? `${label}: enter both colours as #RRGGBB` : `${label} ${ratioText(ratio)}`), node("span", "friends-shop-verdict", ratio == null ? "" : fine ? `✓ ${good}` : `Needs ${need}:1`));
        return row;
      }));
      const checked = checkPack(data);
      const listing = checkListing(draft);
      const problem = !checked.ok ? checked.why : !listing.ok ? listing.why : null;
      make.check.textContent = problem ?? (listing.price ? `Ready to publish for ${credits(listing.price)}.` : "Ready to publish, free.");
      make.check.dataset.state = problem ? "blocked" : "ready";
      make.publish.setAttribute("aria-disabled", String(Boolean(problem)));
      make.useMine.setAttribute("aria-disabled", String(!checked.ok || typeof window.MefiMusic?.applyPack !== "function"));
    }
    function useOwnStyle() {
      const checked = checkPack(packFromDraft());
      if (!checked.ok) { status.textContent = `Not yet: ${checked.why}`; return; }
      if (typeof window.MefiMusic?.applyPack !== "function") { status.textContent = `Using your own style: ${SOON}`; return; }
      draft.localId ??= `local:${Math.random().toString(36).slice(2, 10)}`;
      try {
        window.MefiMusic.applyPack({ id: draft.localId, name: draft.name.trim() || "My style", ...checked.data }, true);
        status.textContent = "Your style is on, on this PC only. Change it any time in Settings › Appearance.";
      } catch { status.textContent = "Your style could not be put on just now."; }
    }
    async function publishDraft() {
      const checked = checkPack(packFromDraft());
      const listing = checkListing(draft);
      if (!checked.ok || !listing.ok) { status.textContent = `Not published yet: ${!checked.ok ? checked.why : listing.why}`; return; }
      await guard(editing ? "Saving…" : "Publishing…", async () => {
        const fields = { name: listing.name, blurb: listing.blurb, price: listing.price, data: checked.data };
        const answer = editing ? await call("shopUpdate", editing, fields) : await call("shopPublish", fields);
        if (!answer?.ok) {
          const words = reasonWords(answer, editing ? "Your changes were not saved. Try again." : "It was not published. Try again.");
          status.textContent = [answer?.error, answer?.reason].includes("hold") ? `${words} You can publish it free now.` : words;
          return;
        }
        const was = editing;
        if (!was && typeof answer.pack?.id === "string") editing = answer.pack.id;
        status.textContent = was ? `${listing.name} is saved. Members who got it see the new look.` : `${listing.name} is in the Shop, ${listing.price ? `for ${credits(listing.price)}` : "free"}.`;
        await loadView();
      });
    }
    function minePart() {
      const box = node("section", "friends-shop-mine");
      box.id = "friends-shop-mine";
      box.setAttribute("aria-labelledby", "friends-shop-mine-title");
      const heading = node("h2", "friends-shop-group-title", "Your packs");
      heading.id = "friends-shop-mine-title";
      box.append(heading);
      if (!mine.length) { box.append(node("p", "friends-shop-empty", loading ? "Reading your packs…" : "You have not published a style pack yet.")); return box; }
      const list = node("ul", "friends-shop-mine-list");
      for (const item of mine) {
        const key = domId(item.id);
        const row = node("li", "friends-shop-mine-row");
        row.dataset.item = item.id;
        const words = node("div", "friends-shop-words");
        const facts = [item.status === "listed" ? "Listed" : item.status === "unlisted" ? "Not listed" : "Removed by a moderator", item.price ? credits(item.price) : "Free", plural(count(item.sales) ?? 0, "sale")];
        if (count(item.earned) != null) facts.push(`${credits(item.earned)} earned`);
        words.append(node("strong", "friends-shop-mine-name", item.name), node("span", "friends-shop-meta", facts.join(" · ")));
        const tools = node("div", "friends-shop-actions");
        if (item.status !== "removed") {
          tools.append(button("Edit", () => edit(item), `friends-shop-edit-${key}`));
          tools.append(item.status === "listed"
            ? button("Unlist", () => { void unlist(item); }, `friends-shop-unlist-${key}`)
            : button("List again", () => { void relist(item); }, `friends-shop-relist-${key}`));
          for (const control of tools.children) control.setAttribute("aria-label", `${control.textContent} ${item.name}`);
        }
        row.append(swatches(item.data), words, tools);
        list.append(row);
      }
      box.append(list);
      return box;
    }
    // Edit opens the editor on a published pack.
    function edit(item) {
      const data = dataOf(item) ?? { palette: {} };
      const base = draft.palette ?? { ...STARTER };
      Object.assign(draft, {
        name: item.name, blurb: item.blurb ?? "",
        palette: { ...base, ...data.palette, accent2: data.palette.accent2 ?? data.palette.accent ?? base.accent2 },
        nodeStyle: data.nodeStyle ?? "orbs", material: data.material ?? "studio", font: data.font ?? "studio",
        price: count(item.price) ?? 0, lastPrice: item.price >= 10 ? item.price : draft.lastPrice,
      });
      editing = item.id;
      status.textContent = `Changing ${item.name}. Save changes when it looks right.`;
      paint();
      focusOn("friends-shop-pack-name");
    }
    async function unlist(item) {
      await guard("Unlisting…", async () => {
        const answer = await call("shopUnlist", item.id);
        status.textContent = answer?.ok ? `${item.name} is no longer listed. Members who got it keep it.` : reasonWords(answer, "It could not be unlisted.");
        if (answer?.ok) await loadView();
      });
    }
    async function relist(item) {
      await guard("Listing it again…", async () => {
        const answer = await call("shopUpdate", item.id, { listed: true });
        status.textContent = answer?.ok ? `${item.name} is listed again.` : reasonWords(answer, "It could not be listed again.");
        if (answer?.ok) await loadView();
      });
    }

    // ---- painting ----
    function paint() {
      if (gone) return;
      // The control that had the keyboard keeps it: every control has an id that survives the repaint.
      const active = document.activeElement;
      const focusedId = active && active !== root && root.contains?.(active) ? active.id : "";
      releasePets();
      stages.clear();
      for (const key of Object.keys(make)) delete make[key];
      paintChrome();
      let parts;
      if (!ready) parts = notReady();
      // A view being read for the first time says so in the status line, not with an empty list.
      else if (loading && !items.length && view !== "make") parts = [];
      else if (view === "studio") parts = [node("p", "friends-shop-lead", "Ember the dragon comes free with every Studio. Here are scales for Ember, menu effects and Studio's own style packs; every theme and node style in Settings stays free."), ...grouped(items, "The Shop is empty right now.", { ember: true })];
      else if (view === "packs") parts = communityView();
      else if (view === "owned") parts = grouped(items, "Nothing here yet. What you get in the Shop shows up here.", { ember: true });
      else parts = makeView();
      body.replaceChildren(...parts.filter(Boolean));
      paintTry();
      if (focusedId) focusOn(focusedId);
    }
    function show(id) {
      if (!VIEWS.some(([key]) => key === id)) return;
      const moved = view !== id;
      view = id;
      lastView = id;
      confirm = confirm?.where === "banner" ? confirm : null;
      reporting = null;
      if (!ready) { paint(); return; }
      if (moved) { items = []; next = null; loading = true; }
      paint();
      void loadView();
    }

    // ---- the room service, and reading the Shop ----
    async function loadView({ more = false } = {}) {
      const mineSeq = ++seq;
      const wanted = view;
      const relayView = wanted === "packs" ? sort : wanted === "make" ? "mine" : wanted;
      if (!more && !busy) status.textContent = OPENING;
      loading = !more;
      const answer = await call("shop", relayView, ...(more && next ? [next] : []));
      if (gone || mineSeq !== seq) return;
      loading = false;
      if (status.textContent === OPENING) status.textContent = "";
      if (!answer?.ok) {
        if (answer?.error === "unsupported") { ready = false; root.dataset.state = "unsupported"; status.textContent = REASONS.unsupported; notReady = () => yours(); }
        else status.textContent = reasonWords(answer, "The Shop could not be read just now. Try again in a moment.");
        paint();
        return;
      }
      // Ember is never a Shop item (it has its own card); a relay from before that change may still list it.
      const list = (Array.isArray(answer.items) ? answer.items : []).filter((item) => plainObject(item) && typeof item.id === "string" && item.id !== EMBER && KINDS.includes(item.kind) && typeof item.name === "string");
      for (const item of list) names.set(item.id, item.name);
      if (wanted === "make") mine = list;
      else { items = more ? [...items, ...list] : list; next = typeof answer.next === "string" && answer.next ? answer.next : null; }
      if (Number.isFinite(answer.balance)) balanceNow = answer.balance;
      canEarn = answer.canEarn !== false;
      hold = answer.hold ? holdOf(answer) : null;
      paint();
    }
    const connectNow = () => guard("Connecting…", async () => {
      const answer = await api.hubConnect?.();
      if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
    });
    function gate(note = "") {
      return window.MefiFriendsFront?.gate?.({ onSignedIn: () => { autoConnected = true; void load(); }, ...(note ? { note } : {}) }) ?? null;
    }
    function notMember() {
      root.dataset.state = "not-member";
      status.textContent = "Your Discord account isn't in the Void Engine server yet. Join it, then check again.";
      notReady = () => [button("Join the Discord", () => { void window.MefiCommunity?.join?.(); }, "friends-shop-join"), button("I've joined, check again", () => guard("Checking…", async () => {
        await window.MefiCommunity?.check?.();
        autoConnected = true;
        const answer = await api.hubConnect?.();
        if (answer?.status?.state === "ready" || answer?.ok) await load(); else explain(answer?.status);
      }), "friends-shop-recheck"), ...yours()];
      paint();
    }
    // What the room service's state means for the Shop, and the one thing to do about it. -> ready or not.
    function explain(hub) {
      ready = false;
      notReady = () => yours();
      if (!hub?.configured) { root.dataset.state = "not-configured"; status.textContent = "The Shop needs the room service, which this copy of Studio has no address for."; paint(); return false; }
      if (!hub.linked) {
        root.dataset.state = "not-linked";
        const signIn = gate();
        status.textContent = signIn ? "" : "Sign in with Discord in Friends to use the Shop.";
        notReady = () => [...(signIn ? [signIn] : []), ...yours()];
        paint();
        return false;
      }
      if (hub.error === "not-member") { notMember(); return false; }
      // Signed in and simply not connected yet: opening the Shop is the ask, so connect once by itself.
      if (hub.state === "off" && !hub.error && !autoConnected) {
        autoConnected = true;
        root.dataset.state = "connecting";
        status.textContent = "Connecting to the room service…";
        paint();
        void connectNow();
        return false;
      }
      if (hub.state !== "ready") {
        root.dataset.state = hub.state || "off";
        // Friends' one way of saying it (renderer/friends-front.js hubState): Connect only when it can help.
        const said = window.MefiFriendsFront?.hubState?.(hub) ?? { action: "connect", text: hub.state === "connecting" ? "Connecting to the room service…" : "Connect to open the Shop." };
        const signIn = said.action === "signin" ? gate(said.text) : null;
        status.textContent = signIn ? "" : said.text;
        notReady = () => [...(signIn ? [signIn] : said.action === "connect" ? [button("Connect", () => { void connectNow(); }, "friends-shop-connect")] : []), ...yours()];
        paint();
        return false;
      }
      if (hub.shop === false) { root.dataset.state = "unsupported"; status.textContent = REASONS.unsupported; paint(); return false; }
      root.dataset.state = "ready";
      ready = true;
      return true;
    }
    async function load() {
      let hub = null;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (gone) return;
      me = hub?.user?.id ?? me;
      if (!explain(hub)) return;
      if (status.textContent === "Checking the room service…" || status.textContent === "Connecting…") status.textContent = "";
      void refresh();
      loading = true;
      paint();
      await loadView();
    }

    function hear(event) {
      if (gone) return;
      if (root.isConnected === false) { dispose(); return; }
      if (event?.type === "credits") {
        if (Number.isFinite(event.balance)) { balanceNow = event.balance; paintChrome(); }
        if (event.reason === "sale" && event.delta > 0) status.textContent = `+${credits(event.delta)}: a member bought one of your packs.`;
      } else if (event?.type === "status") void load();
    }
    function dispose() {
      if (gone) return;
      gone = true;
      seq += 1;
      endTry();
      releasePets();
      motionWatch?.disconnect();
      if (current === handle) current = null;
    }
    // Motion switched back on: the pets on screen fly again; switched off, they hold still.
    const motionWatch = typeof MutationObserver === "function" ? new MutationObserver(() => { if (motionOff()) { for (const canvas of pets.seen) drawPet(canvas, 0); } else spin(); }) : null;
    motionWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    // Whether this member moderates arrives after the card (friends-mod.js learn()): their Remove buttons follow.
    if (!watchingMods && typeof window.MefiFriendsMod?.subscribe === "function") { watchingMods = true; window.MefiFriendsMod.subscribe(() => { if (current?.ready()) current.paint(); }); }
    const handle = { hear, dispose, paint, show: (id) => show(id), ready: () => ready };
    current = handle;
    root.dispose = dispose;

    if (typeof api?.hubShop !== "function" || typeof api?.hubStatus !== "function") {
      root.dataset.state = "unavailable";
      status.textContent = typeof api?.hubStatus === "function" ? `The Shop: ${SOON}` : "The Shop works in the desktop app.";
      notReady = () => yours();
      paint();
      return root;
    }
    listen(api);
    paint();
    void load();
    return root;
  }

  // ---- the way in from Settings › Appearance (the Theme section) ----
  let settingsCard = null;
  function mountSettings() {
    if (settingsCard?.parentNode && settingsCard.isConnected !== false) return true;
    const theme = document.querySelector?.("#music-look .music-colors");
    if (!theme?.parentNode) return false;
    const box = node("section", "music-section friends-shop-settings");
    box.id = "friends-shop-settings";
    // The Theme tab shows it with the colour themes (music.js selectAppearanceSection).
    box.dataset.appearancePanel = "themes";
    box.hidden = theme.hidden === true;
    box.setAttribute("aria-labelledby", "friends-shop-settings-title");
    const heading = node("h3", "friends-shop-settings-title", "Pets, menu effects and style packs");
    heading.id = "friends-shop-settings-title";
    const line = node("p", "friends-shop-settings-line", "Ember the dragon comes free with every Studio. The Shop has scales for Ember, menus that crumble away and style packs from Studio and members, for the credits you earn; or make a style of your own.");
    const go = button("Open the Shop", () => open("studio"), "friends-shop-settings-open", PRIMARY);
    go.prepend(gem());
    box.append(heading, line, go);
    if (typeof theme.after === "function") theme.after(box); else theme.parentNode.insertBefore(box, theme.nextSibling ?? null);
    settingsCard = box;
    return true;
  }

  // Friends › Shop at one of its views: studio, packs (members' packs), owned or make.
  function open(view = "studio") {
    const wanted = VIEWS.some(([id]) => id === view) ? view : "studio";
    lastView = wanted;
    if (current) current.show(wanted); else asked = wanted;
    window.MefiNav?.go?.("friends-page", { place: "shop" });
    return true;
  }

  window.MefiShop = { card, owns, owned: ownedList, pack, refresh, open, checkPack, checkListing, contrast, packName: (id) => names.get(id) ?? null, mountSettings };
  listen(bridge());
  const whenReady = (run) => { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true }); else run(); };
  whenReady(() => { mountSettings(); });
  try { window.addEventListener?.("mefi:nav", (event) => { if (event?.detail?.id === "studio") mountSettings(); }); } catch { /* no navigation here */ }
})();
