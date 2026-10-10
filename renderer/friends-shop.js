// The Shop (window.MefiShop): scales for Ember, menu effects, node styles and
// themes (Studio's own style packs) for the credits members earn by making and
// playing things (credits are never bought with money), and the style packs
// members make and sell each other. Ember the dragon itself comes free with
// every Studio: it is not sold, and its card is an On/Off switch
// (MefiPets.set({ on })). The relay keeps the catalog, the packs and who owns
// what (relay/src/shop.mjs); this page shows them, lets you try anything for
// two minutes, asks before a single credit is spent, and puts what you own to
// use.
//
// A page of its own (route "shop", openPage/closePage; Friends' place "Shop",
// Settings › Appearance and Search open it), clean and roomy: the month's drop
// as a banner made from the drop's own data (its colours, name, how long it
// has left and its items shown live inside it, relay/src/shop-drops.mjs), its
// items, the week's Featured shelf, then the categories. One row of views:
//   - Home: the drop, the Featured shelf and every category.
//   - Pets, Menu effects, Node styles, Themes: one category each.
//   - Community: members' style packs, New or Top. Buying or getting one can
//     carry a tip for its maker (0 to 100 credits, members' packs only;
//     hubShop "shopBuy" with the tip as its third argument).
//   - Owned: everything you own.
//   - Make a style: five colours, a node style, a material and a font, a big
//     live preview and how easy its text is to read (WCAG contrast). The
//     relay's own check runs here first (checkPack, the same rules as
//     relay/src/shop-pack.mjs) and says in plain words what stops a pack from
//     publishing. Use it myself puts it on this PC only; Publish lists it,
//     free or for 10 to 250 credits. Your packs lists what you published,
//     with Edit, Unlist or List again, how many times each was got and
//     credits earned.
// Cards are a big live preview with the name, the price (or Owned) and badges
// (New, Leaving soon, In use); a card opens its detail (a modal dialog) with a
// large live preview, the line about it, Try for 2 minutes and Buy, Get or Use,
// and Report or Remove for a member's pack.
//
// Signed out or out of reach, the same page is a showroom: Studio's own items
// from this PC's copy of the catalog (main's hub:shop "shopCatalog", no relay
// asked), each with its preview and Try, and in place of Buy the one thing
// that helps (Sign in to get it, Connect to get it, Join the Discord to get
// it); members' packs say they need sign-in; Friends' sign-in card is at the
// foot. What you own keeps working from this PC's list.
//
// Every preview is live: a pet flies on a little canvas (MefiPets.paintPreview),
// a node style paints a little board of its own nodes, wires and a pulse in
// the theme's sky (MefiNodeStyles), an effect plays on a little menu on hover,
// focus or Try (MefiEffects.demo) and by itself in the banner and the detail,
// and a theme paints a tiny Studio window from its own colours. Only what is on
// screen moves, only with motion on (one still frame with motion Off; cards
// hold still with motion Calm), and nothing moves while the window is hidden.
// Try lasts two minutes, one item at a time, under a banner at the top of the
// page (time left, Buy, Stop); leaving the Shop ends it. A node style's Try
// puts it on the real tree (MefiMusic.previewNodeStyle), and Use wears it
// (MefiMusic.applyNodeStyle).
//
// What you own is kept in localStorage mefiStudio.shop.v1 ({ owned: { [id]:
// { kind, name, data, updatedAt } }, at }), so it keeps working signed out or
// offline. It is read again from the relay (hubShop "shopOwned") when the
// Shop opens, after a purchase and when the room service connects, and the
// window event `mefi-shop-owned` tells the rest of Studio when it changed.
//
// Kill switches, per device (localStorage): "mefiStudio.shop.page" = "off"
// shows the Shop as a Friends place again (the card inside Friends' page);
// "mefiStudio.shop.showroom" = "off" shows a signed-out Shop only Friends'
// sign-in and what you own.
//
// Everything goes through main's hub:shop channel (window.mefiStudio.hubShop);
// renderer/pets.js, effects.js and music.js do the showing. A part that is not
// in this build says so ("Comes with the next Studio update").
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
  // Motion: Off holds every preview still; Calm lets only the open detail move.
  const motionLevel = () => document.documentElement?.dataset?.motion ?? "full";
  const motionOff = () => motionLevel() === "off";
  const focusOn = (id) => { try { document.getElementById?.(id)?.focus?.({ preventScroll: false }); } catch { /* nothing to focus */ } };
  const readStore = (key) => { try { return globalThis.localStorage?.getItem?.(key) ?? null; } catch { return null; } };
  // The kill switches (see the top of this file).
  const pageOn = () => readStore("mefiStudio.shop.page") !== "off";
  const showroomOn = () => readStore("mefiStudio.shop.showroom") !== "off";
  const STORE = "mefiStudio.shop.v1";
  const TRY_MS = 120_000;
  const DAY_MS = 86_400_000;
  // A drop's item has this long left when it says "Leaving soon"; a member's pack is new for this long.
  const SOON_MS = 7 * DAY_MS;
  const SOON = "Comes with the next Studio update.";
  const OPENING = "Opening the Shop…";
  const ABOUT = "New looks for Studio, for the credits you earn with friends. Credits are never bought, and everything Studio comes with stays free.";
  const KINDS = ["pet", "skin", "effect", "nodestyle", "pack"];
  // The views, in the row's order. "studio" (Home) and "packs" (Community) keep their old names for every way in.
  const VIEWS = [["studio", "Home"], ["pets", "Pets"], ["effects", "Menu effects"], ["nodestyles", "Node styles"], ["themes", "Themes"], ["packs", "Community"], ["owned", "Owned"], ["make", "Make a style"]];
  const STUDIO_VIEWS = ["studio", "pets", "effects", "nodestyles", "themes"];
  const viewOf = (wanted) => (VIEWS.some(([id]) => id === wanted) ? wanted : { home: "studio", community: "packs", mine: "make" }[wanted] ?? null);
  // Studio's categories: a heading and a line each. Pets and their scales share one.
  const CATEGORIES = [
    ["pets", "Pets", "Ember the dragon comes free with every Studio. Scales dress it in new colours."],
    ["effects", "Menu effects", "How menus leave the screen when they close."],
    ["nodestyles", "Node styles", "How the nodes on your Map and tree are drawn. Every style Studio already had stays free."],
    ["themes", "Themes", "Studio's own style packs: colours, a node style, a material and a font together."],
  ];
  const categoryOf = (kind) => (kind === "pet" || kind === "skin" ? "pets" : kind === "effect" ? "effects" : kind === "nodestyle" ? "nodestyles" : "themes");
  const categoryName = (key) => CATEGORIES.find(([id]) => id === key)?.[1] ?? "Themes";
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
    // An item of a monthly drop after its month (relay/src/shop-drops.mjs).
    "not-available": "This one has rotated out. Everyone who got it keeps it.",
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

  // ---- the rotation's words: how long a drop's item has left, when the Featured shelf changes ----
  const msOf = (iso) => { const at = typeof iso === "string" ? Date.parse(iso) : NaN; return Number.isFinite(at) ? at : null; };
  // "in 24 days", "in a day", "in 5 hours", "within the hour" (rounded down, so it never promises more time than is left).
  function timeLeft(iso, now = Date.now()) {
    const at = msOf(iso);
    if (at == null || at <= now) return null;
    const left = at - now;
    if (left < 3_600_000) return "within the hour";
    if (left < DAY_MS) return `in ${plural(Math.floor(left / 3_600_000), "hour")}`;
    const days = Math.floor(left / DAY_MS);
    return days === 1 ? "in a day" : `in ${days} days`;
  }
  const leavesWords = (iso) => { const left = timeLeft(iso); return left ? `Leaves ${left}` : ""; };
  const leavingSoon = (item) => { const at = msOf(item?.leaves); return at != null && at > Date.now() && at - Date.now() <= SOON_MS; };
  // A drop is a calendar month by its id (UTC); its days are said in this PC's own time, its last day as the last moment
  // it is on sale (until is the moment it leaves).
  const monthOf = (iso) => { const at = msOf(iso); return at == null ? "" : new Date(at).toLocaleDateString([], { month: "long", timeZone: "UTC" }); };
  const dayOf = (iso, before = 0) => { const at = msOf(iso); return at == null ? "" : new Date(at - before).toLocaleDateString([], { day: "numeric", month: "long" }); };

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
  const styleOf = (id) => safe(() => window.MefiMusic.shopStyles().find((style) => style.item === id)?.key) ?? (slug(id).startsWith("style-") ? slug(id).slice(6) : null);
  // Scales dress the pet they name, Ember when they name none.
  const petOfItem = (item) => petOf(item.kind === "skin" ? item.requires || EMBER : item.id);
  const petState = () => safe(() => window.MefiPets.state(), {});
  // The module that shows each kind, and whether it is in this build.
  const showerOf = (kind) => (kind === "effect" ? window.MefiEffects : kind === "pack" || kind === "nodestyle" ? window.MefiMusic : window.MefiPets);
  function usable(item) {
    if (item.kind === "pet" || item.kind === "skin") return typeof window.MefiPets?.set === "function";
    if (item.kind === "effect") return typeof window.MefiEffects?.use === "function";
    if (item.kind === "nodestyle") return typeof window.MefiMusic?.applyNodeStyle === "function" && Boolean(styleOf(item.id));
    return typeof window.MefiMusic?.applyPack === "function";
  }
  function tryable(item) {
    if (item.kind === "pet" || item.kind === "skin") return typeof window.MefiPets?.preview === "function";
    if (item.kind === "effect") return typeof window.MefiEffects?.preview === "function";
    if (item.kind === "nodestyle") return typeof window.MefiMusic?.previewNodeStyle === "function";
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
    if (item.kind === "nodestyle") return safe(() => window.MefiMusic.nodeStyle()) === styleOf(item.id);
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
  // Pets fly and node styles move only on screen: one loop for every live part a page shows (a pet's canvas, a node
  // style's board, which carries its style in data-node-style, and an effect's menu that plays by itself), paused while
  // the window is hidden, a single still frame with motion Off. A card draws about 15 frames a second and holds still
  // with motion Calm; the banner and an open detail ("big") draw about 30.
  const live = { all: new Set(), seen: new Set(), frame: 0, drawn: new WeakMap(), watch: null };
  const isBig = (part) => part.dataset?.size === "big";
  function drawLive(part, time) {
    try {
      if (part.play) { if (time > 0 && !part.playing && time - (live.drawn.get(part) ?? 0) >= 4200) { live.drawn.set(part, time); part.play(); } return; }
      if (part.dataset.nodeStyle) paintBoard(part, time);
      else {
        // A big preview (the banner's, a detail's) shows the pet bigger than a card's (paintPreview stops at 1 by itself).
        const size = isBig(part) ? Math.max(1, Math.min(2.4, Math.min(part.clientWidth || 0, part.clientHeight || 0) / 160)) : 0;
        // A board counts in milliseconds; a pet's flight in seconds.
        window.MefiPets?.paintPreview?.(part, { kind: part.dataset.kind, skin: part.dataset.skin, time: time / 1000, ...(size ? { size } : {}) });
      }
    } catch { /* the next frame tries again */ }
  }
  function watchLive(part) {
    live.all.add(part);
    if (!part.play) drawLive(part, 0);
    if (typeof IntersectionObserver === "function") {
      live.watch ??= new IntersectionObserver((entries) => {
        for (const entry of entries) { if (entry.isIntersecting) live.seen.add(entry.target); else live.seen.delete(entry.target); }
        spin();
      });
      live.watch.observe(part);
    }
    return part;
  }
  function petCanvas(kind, skin, label, big = false) {
    const canvas = node("canvas", "friends-shop-pet");
    canvas.width = 360; canvas.height = 180;
    canvas.dataset.kind = kind || "dragon"; canvas.dataset.skin = skin || "theme";
    if (big) canvas.dataset.size = "big";
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", label);
    return watchLive(canvas);
  }
  function spin() {
    if (live.frame || !live.seen.size || typeof requestAnimationFrame !== "function") return;
    live.frame = requestAnimationFrame(liveFrame);
  }
  function liveFrame(now) {
    live.frame = 0;
    for (const part of [...live.seen]) if (part.isConnected === false) { live.seen.delete(part); live.all.delete(part); live.watch?.unobserve(part); }
    if (!live.seen.size || document.hidden) return;
    const level = motionLevel();
    if (level === "off") { for (const part of live.seen) if (!part.play) drawLive(part, 0); return; }
    let moving = false;
    for (const part of live.seen) {
      // Calm: only the open detail and the banner move; cards hold their still frame.
      if (level === "calm" && !isBig(part)) continue;
      moving = true;
      if (part.play) { drawLive(part, now); continue; }
      const every = isBig(part) ? 33 : 66;
      if (now - (live.drawn.get(part) ?? -Infinity) >= every) { live.drawn.set(part, now); drawLive(part, now); }
    }
    if (moving) live.frame = requestAnimationFrame(liveFrame);
  }
  function releaseLive(keep = null) {
    for (const part of [...live.all]) {
      if (keep?.contains?.(part)) continue;
      live.watch?.unobserve(part);
      live.all.delete(part); live.seen.delete(part);
    }
    if (live.frame && typeof cancelAnimationFrame === "function" && !live.seen.size) { cancelAnimationFrame(live.frame); live.frame = 0; }
  }
  try { document.addEventListener?.("visibilitychange", () => { if (!document.hidden) spin(); }); } catch { /* no document events here */ }

  // A node style's board: four nodes on their wires, painted by MefiNodeStyles in the theme's own sky (its canvas
  // palette and node tints, as the Map's are): a task at work on a wire that carries work (a pulse runs it every
  // 2.4 s and lands, kicking it), an idle task, a finished session that is chosen (so its selection mark shows) on
  // a quiet wire, and a todo. The board is 360 by 180 and fills the canvas (a card shows it at about 0.6, so its
  // nodes are a size up from the Map's: the card is a close look); each canvas keeps its own motion records.
  // Motion off: the style's still pose.
  const BOARD = Object.freeze([
    Object.freeze({ id: "idle", x: 66, y: 114, r: 16, kind: "task", tint: "task" }),
    Object.freeze({ id: "work", x: 180, y: 70, r: 23, kind: "task", tint: "warm", active: true }),
    Object.freeze({ id: "done", x: 292, y: 112, r: 16, kind: "session", tint: "done", chosen: true }),
    Object.freeze({ id: "todo", x: 134, y: 152, r: 8, kind: "todo", tint: "pending" }),
  ]);
  const BOARD_WIRES = Object.freeze([
    Object.freeze({ a: 0, b: 1, kind: "task", tint: "warm", alpha: 0.55, width: 1.4, active: true, flow: true, march: true, dash: Object.freeze([2, 4]) }),
    Object.freeze({ a: 1, b: 2, kind: "session", tint: "task", alpha: 0.32, width: 1.1, inspected: true }),
    Object.freeze({ a: 0, b: 3, kind: "todo", tint: "task", alpha: 0.2, width: 0.9 }),
  ]);
  const BOARD_PULSE_MS = 2400, BOARD_TRAVEL_MS = 900, BOARD_LAND_MS = 380;
  const boards = new WeakMap(); // canvas -> { motion, last, landed, pulse }
  // The Map's node tints from a canvas palette (renderer/idle.js syncGraphTheme does the same), kept per palette.
  let boardTints = { palette: undefined, tints: null };
  const hexTriple = (value, fallback) => (typeof value === "string" && HEX.test(value) ? Object.freeze([parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)]) : fallback);
  function tintsOf(palette) {
    if (boardTints.palette === palette && boardTints.tints) return boardTints.tints;
    const background = hexTriple(palette?.background, [5, 5, 7]);
    const light = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722 > 145;
    const pending = hexTriple(palette?.muted, [138, 128, 108]), verify = light ? [59, 86, 160] : [151, 179, 244];
    const tints = {
      warm: hexTriple(palette?.bright, [230, 201, 141]), pending, done: Object.freeze([104, 236, 164]),
      task: Object.freeze(pending.map((value, index) => Math.round(value * 0.6 + verify[index] * 0.4))),
    };
    boardTints = { palette, tints };
    return tints;
  }
  function paintBoard(canvas, time) {
    const styles = window.MefiNodeStyles, key = canvas.dataset.nodeStyle, ctx = canvas.getContext?.("2d");
    if (!styles || !ctx || !key) return;
    const width = canvas.clientWidth || canvas.width || 360, height = canvas.clientHeight || canvas.height || 180;
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    let board = boards.get(canvas);
    if (!board) {
      // (the pulse's colour as one stable triple, so the style's paints for it are built once; a board in a drop's banner
      // keeps the drop's own sky, data-sky, so it sits in the banner whatever the theme)
      const sky = HEX.test(canvas.dataset.sky ?? "") ? Object.freeze({ background: canvas.dataset.sky, text: inkOn(canvas.dataset.sky), accent2: HEX.test(canvas.dataset.skyAccent ?? "") ? canvas.dataset.skyAccent : null }) : null;
      board = { motion: new Map(), last: 0, landed: -1, sky, pulse: { color: "#f1dcae", glow: "#e6c98d", duration: BOARD_TRAVEL_MS, start: 0 }, rgb: hexTriple("#f1dcae", null), look: { time: 0, still: false, theme: null } };
      boards.set(canvas, board);
    }
    const palette = board.sky ?? safe(() => window.MefiMusic.themePalette().canvas);
    const theme = styles.theme(palette), tints = tintsOf(palette), still = motionOff() || !(time > 0);
    const dt = still || !board.last ? 0 : Math.min(0.1, Math.max(0, (time - board.last) / 1000));
    board.last = still ? 0 : time;
    const at = still ? 0 : time;
    // The pulse's turn: travelling, then landing, then resting until the next one.
    const turn = Math.floor(at / BOARD_PULSE_MS), since = at - turn * BOARD_PULSE_MS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette?.background ?? "#050507";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / 360, canvas.height / 180);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - 360 * scale) / 2, (canvas.height - 180 * scale) / 2);
    const motions = BOARD.map((spot) => {
      const record = styles.motionRecord(board.motion, spot.id);
      if (spot.id === "work" && !still && since >= BOARD_TRAVEL_MS && board.landed !== turn) { board.landed = turn; record.kick = 1; }
      styles.stepMotion(record, { style: key, active: spot.active === true, selected: spot.chosen === true, progress: null, orbit: 0, status: null, stale: false, time: at, frame: 0 }, dt, still);
      return record;
    });
    for (const wire of BOARD_WIRES) {
      const a = BOARD[wire.a], b = BOARD[wire.b];
      styles.wire(ctx, key, a, b, { kind: wire.kind, tint: tints[wire.tint], alpha: wire.alpha, width: wire.width, dash: wire.dash ?? null, march: wire.march === true && !still, flow: wire.flow === true, double: false, active: wire.active === true, inspected: wire.inspected === true, curved: false, cp: null, far: false, time: at, still, seed: motions[wire.b].seed, rA: a.r, rB: b.r, detail: 3, lifetime: 1, theme });
    }
    if (!still) {
      const from = BOARD[0], to = BOARD[1], look = board.look;
      Object.assign(look, { kind: "dot", time: at, still: false, rTo: to.r, detail: 3, pulse: board.pulse, motion: motions[1], cp: null, theme });
      if (since < BOARD_TRAVEL_MS) styles.surge(ctx, key, from, to, since / BOARD_TRAVEL_MS, board.pulse, look);
      else if (since < BOARD_TRAVEL_MS + BOARD_LAND_MS) styles.land(ctx, key, to, to.r, board.rgb, (since - BOARD_TRAVEL_MS) / BOARD_LAND_MS, look);
    }
    BOARD.forEach((spot, index) => {
      const motion = motions[index], tint = tints[spot.tint], chosen = spot.chosen === true;
      const options = { kind: spot.kind, selected: chosen, chosen, active: spot.active === true, alpha: spot.active || chosen ? 1 : theme.light ? 0.85 : 0.65, motion, time: at, still, detail: styles.tier(spot.r, 4), theme };
      styles.paint(ctx, key, spot, spot.r, tint, options);
      if (chosen) styles.select(ctx, key, spot, spot.r, tint, options);
    });
  }
  function boardCanvas(key, label, big = false) {
    const canvas = node("canvas", "friends-shop-pet friends-shop-board");
    canvas.width = 360; canvas.height = 180;
    canvas.dataset.nodeStyle = key;
    if (big) canvas.dataset.size = "big";
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", label);
    return watchLive(canvas);
  }

  // A tiny Studio window painted from a pack's own colours (inline custom properties): a title bar, the rail, a list
  // with one row chosen, and the main area with a title, two node orbs on a wire, two lines of text and a button.
  // The node style, material and font each change how it looks.
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
    const bar = node("div", "friends-shop-mock-bar");
    bar.append(node("span", "friends-shop-mock-dot"), node("span", "friends-shop-mock-dot"), node("span", "friends-shop-mock-dot"));
    const rail = node("div", "friends-shop-mock-rail");
    rail.append(node("span", "friends-shop-mock-pip is-on"), node("span", "friends-shop-mock-pip"), node("span", "friends-shop-mock-pip"));
    const side = node("div", "friends-shop-mock-side");
    side.append(node("span", "friends-shop-mock-line is-chosen"), node("span", "friends-shop-mock-line"), node("span", "friends-shop-mock-line is-short"));
    const main = node("div", "friends-shop-mock-main");
    const tree = node("div", "friends-shop-mock-tree");
    tree.append(node("span", "friends-shop-mock-orb"), node("span", "friends-shop-mock-wire"), node("span", "friends-shop-mock-orb is-second"));
    const lines = node("div", "friends-shop-mock-words");
    lines.append(node("span", "friends-shop-mock-line"), node("span", "friends-shop-mock-line is-short"));
    main.append(node("div", "friends-shop-mock-title", title || "Aa"), tree, lines, node("span", "friends-shop-mock-button", big ? "Build it" : "Go"));
    const window_ = node("div", "friends-shop-mock-body");
    window_.append(rail, side, main);
    mock.append(bar, window_);
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
  // The text colour that reads best on a drop's banner colour (white or near-black, whichever has more contrast).
  const inkOn = (background) => (HEX.test(background ?? "") && (contrast(background, "#ffffff") ?? 0) < (contrast(background, "#14110f") ?? 0) ? "#14110f" : "#ffffff");

  // ---- the Shop's state that outlives one page ----
  let current = null; // the page on screen: { hear, show, paint, dispose, ready }
  let hearing = false, watchingMods = false;
  let asked = null; // the view open(view) asked for, for the next page
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

  // The hub's events: a connection that comes up reads what you own again; the page on screen hears the rest.
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
      if (event?.type === "credits" && event.reason === "trade") void refresh();
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

  // ---- the page ----
  // onPage: the Shop's own page (it mounts Friends' places for Social, and is the route "shop"); otherwise a card for
  // Friends' place (the "mefiStudio.shop.page" kill switch). view: the view to open on.
  function card({ view: wantedView = null, onPage = false } = {}) {
    const root = node("section", `friends-shop${onPage ? " is-page" : ""}`);
    root.id = "friends-shop";
    root.setAttribute("aria-labelledby", "friends-shop-title");
    // The head: the page's title and what the Shop is, the balance and how to earn more.
    const head = node("header", "friends-shop-head");
    const headWords = node("div", "friends-shop-head-words");
    const title = node("h1", "friends-shop-title", "Shop");
    title.id = "friends-shop-title";
    title.tabIndex = -1;
    headWords.append(title, node("p", "friends-shop-about", ABOUT));
    const headTools = node("div", "friends-shop-head-tools");
    const balance = node("span", "friends-shop-balance");
    balance.id = "friends-shop-balance";
    balance.hidden = true;
    const earn = button("How to earn credits", () => window.MefiNav?.go?.("friends-page", { place: "events" }), "friends-shop-earn", "friends-shop-link");
    headTools.append(balance, earn);
    if (window.MefiTrades) headTools.append(button("Trade items", () => { void window.MefiTrades.open(); }, "friends-shop-trades", "friends-shop-link"));
    head.append(headWords, headTools);
    // Friends' places as a row, for when the list column is not showing them (Social, a small window).
    if (onPage) window.MefiShell?.placeBar?.(head, "friends");
    // The try banner: the item being tried, its time left, Buy and Stop.
    const banner = node("div", "friends-shop-try");
    banner.id = "friends-shop-try";
    banner.hidden = true;
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Trying an item");
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
    // An item's detail: a modal dialog over the page.
    const detailRoot = node("dialog", "friends-shop-detail");
    detailRoot.id = "friends-shop-detail";
    detailRoot.setAttribute("aria-labelledby", "friends-shop-detail-name");
    root.append(head, banner, tabs, status, body, detailRoot);

    current?.dispose();
    const api = bridge();
    let view = viewOf(wantedView) ?? viewOf(asked) ?? lastView;
    asked = null;
    lastView = view;
    let ready = false, me = null, balanceNow = null, canEarn = true, hold = null;
    // Studio's list: the relay's (signed in) or this PC's copy (the showroom), with the drops and the Featured shelf.
    let catalog = null; // { items, drops, featured, featuredUntil, local, at }
    let items = [], next = null, mine = [], busy = false, gone = false, seq = 0, autoConnected = false, loading = false;
    let notReady = () => []; // what shows while the Shop cannot be reached and there is no showroom
    // This PC's copy of the list is on its way (the showroom paints when it lands, so the old page never flashes first).
    let cataloguing = showroomOn() && typeof api?.hubShop === "function";
    let stateWords = ""; // what the room service's state means, as explain() said it
    let way = null; // the showroom's one thing that helps: { label, run } (Sign in, Connect or Join to get it)
    let gateEl = null; // Friends' sign-in card, while signing in is what helps
    // In the showroom the card waits out of sight at the page's foot (the line at the top has Sign in) until a
    // Sign in or a "Sign in to get it" calls it; then it shows with each step of signing in.
    let gateCalled = false;
    let confirm = null; // { id, price, tip, where: "card" | "banner", changed, short }: a purchase waiting for a yes
    let reporting = null; // the pack whose report form is open
    let tried = null; // { item, endsAt, timer, clock, words, scope }: the one item being tried
    const stages = new Map(); // `${scope}:${item id}` -> its little menu, for a demo
    const make = {}; // the editor's live parts
    const detail = { item: null, scope: null, said: "" }; // the item whose detail is open, where it was opened from

    for (const [id, label] of VIEWS) {
      const tab = button(label, () => show(id), `friends-shop-view-${id}`, "friends-shop-tab");
      tab.dataset.view = id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "friends-shop-body");
      tabs.append(tab);
    }
    arrowKeys(tabs);

    const call = async (method, ...args) => { try { return await api.hubShop(method, ...args); } catch { return { ok: false, error: "failed" }; } };
    // A message for the page's status line, and the open detail's too (the page is behind the dialog).
    const setStatus = (text) => {
      status.textContent = text;
      if (detail.item) { detail.said = text; const line = detailRoot.querySelector?.("#friends-shop-detail-status"); if (line) line.textContent = text; }
    };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      if (label) setStatus(label);
      try { await work(); } catch { setStatus("The Shop could not do that. Try again."); }
      busy = false;
      root.removeAttribute("aria-busy");
    };
    const showroom = () => !ready && showroomOn() && Boolean(catalog?.local);
    const isOwned = (item) => item.id === EMBER || item.owned === true || owns(item.id) || mineItem(item);
    const mineItem = (item) => Boolean(me) && item.maker?.id === me;
    const memberPack = (item) => item.kind === "pack" && !String(item.id).startsWith("studio:");
    const nameOf = (id) => names.get(id) ?? "the item it needs";
    const isNew = (item) => (item.drop ? item.drop === catalog?.drops?.current?.id : memberPack(item) && Number.isFinite(item.createdAt) && Date.now() - item.createdAt <= SOON_MS);
    const openId = (item, scope) => `friends-shop-open-${scope}-${domId(item.id)}`;

    // ---- the parts around the view ----
    function paintChrome() {
      const known = Number.isFinite(balanceNow);
      balance.hidden = !known;
      if (known) balance.replaceChildren(gem(), node("span", "", credits(balanceNow)));
      const shown = ready || showroom();
      tabs.hidden = !shown;
      root.dataset.view = view;
      for (const tab of tabs.children) {
        const on = tab.dataset.view === view;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
      }
      if (shown) { body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", `friends-shop-view-${view}`); }
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
      if (!isOwned(item) && Number.isFinite(item.price) && item.price > 0) {
        if (ready) parts.push(button("Buy", () => ask(item, "banner"), "friends-shop-try-buy", PRIMARY));
        else if (way) parts.push(button(way.label, () => way.run(), "friends-shop-try-way", PRIMARY));
      }
      parts.push(button("Stop", () => stopTry(), "friends-shop-try-stop"));
      banner.replaceChildren(...parts);
      if (confirm?.where === "banner" && confirm.id === item.id) banner.append(confirmPanel(item));
    }

    // ---- one item: its card ----
    // The price, or Owned, as one line ("Your pack" for your own; a member's free pack welcomes a tip).
    function priceLine(item, { sales = true } = {}) {
      const line = node("p", "friends-shop-meta");
      if (item.id === EMBER) line.append(node("span", "friends-shop-price", "Free"));
      else if (isOwned(item)) line.append(node("span", "friends-shop-owned", mineItem(item) ? "Your pack" : "Owned"));
      else if (item.price === 0) line.append(node("span", "friends-shop-price", memberPack(item) ? "Free · tips welcome" : "Free"));
      else if (Number.isFinite(item.price)) {
        const price = node("span", "friends-shop-price");
        price.append(gem(), node("span", "", credits(item.price)));
        line.append(price);
      }
      if (sales && memberPack(item) && count(item.sales) != null) line.append(node("span", "friends-shop-sales", plural(item.sales, "sale")));
      if (item.requires && !isOwned(item) && !owns(item.requires)) line.append(node("span", "friends-shop-needs", `Needs ${nameOf(item.requires)}`));
      if (item.status === "unlisted") line.append(node("span", "friends-shop-note", "No longer listed"));
      return line;
    }
    // The badges over a card's preview: In use, then New or Leaving soon.
    function badges(item) {
      const list = [];
      if (item.id === EMBER ? petState().on === true : isOwned(item) && usable(item) && inUse(item)) list.push(["inuse", "In use"]);
      if (item.available !== false && leavingSoon(item)) list.push(["leaving", "Leaving soon"]);
      else if (isNew(item)) list.push(["new", "New"]);
      if (!list.length) return null;
      const row = node("span", "friends-shop-badges");
      for (const [kind, words] of list) { const badge = node("span", `friends-shop-badge is-${kind}`, words); row.append(badge); }
      return row;
    }
    // The preview a card, the banner or a detail shows (big: the detail's and the banner's, which move faster).
    function preview(item, scope, { big = false } = {}) {
      const box = node("div", "friends-shop-preview");
      if (item.id === EMBER) {
        if (typeof window.MefiPets?.paintPreview === "function") box.append(petCanvas(petOf(EMBER) ?? "dragon", petState().skin || "theme", "Ember the dragon, flying", big));
        else box.append(placeholder());
      } else if (item.kind === "pet" || item.kind === "skin") {
        if (typeof window.MefiPets?.paintPreview === "function") box.append(petCanvas(petOfItem(item), item.kind === "skin" ? skinOf(item.id) : "theme", `${item.name}, flying`, big));
        else box.append(placeholder());
      } else if (item.kind === "effect") box.append(effectStage(item, scope, big));
      else if (item.kind === "nodestyle") {
        const key = styleOf(item.id);
        if (key && window.MefiNodeStyles?.STYLES?.includes?.(key)) box.append(boardCanvas(key, `${item.name}: nodes and wires in this style`, big));
        else box.append(placeholder());
      } else box.append(packMock(dataOf(item), { title: item.name, big }));
      return box;
    }
    function placeholder() {
      const still = node("span", "friends-shop-placeholder");
      still.setAttribute("aria-hidden", "true");
      still.append(gem("friends-shop-placeholder-gem"));
      return still;
    }
    // A little menu that plays the effect's exit (MefiEffects.demo), then comes back fresh for the next look. A big one
    // (the banner's, a detail's) plays by itself every few seconds while it is on screen.
    function effectStage(item, scope, big = false) {
      const stage = node("div", "friends-shop-stage");
      stage.setAttribute("aria-hidden", "true");
      const menu = () => {
        const box = node("div", "friends-shop-menu");
        box.append(node("span", "friends-shop-menu-head"), node("span", "friends-shop-menu-row"), node("span", "friends-shop-menu-row"), node("span", "friends-shop-menu-row is-short"));
        return box;
      };
      stage.append(menu());
      stage.playing = false;
      const play = () => {
        const demo = window.MefiEffects?.demo;
        if (stage.playing || gone || typeof demo !== "function" || motionOff()) return;
        stage.playing = true;
        let done = null;
        try { done = demo.call(window.MefiEffects, stage.querySelector(".friends-shop-menu"), effectOf(item.id)); } catch { done = null; }
        const settled = done && typeof done.then === "function" ? done.then(() => wait(450), () => wait(450)) : wait(1700);
        void settled.then(() => { stage.replaceChildren(menu()); stage.playing = false; });
      };
      stages.set(`${scope}:${item.id}`, stage);
      if (big) { stage.dataset.size = "big"; stage.play = play; watchLive(stage); }
      else stage.demo = play;
      return stage;
    }
    // A card: a big live preview with its badges, the name (a button that opens the detail; the whole card answers
    // the pointer) and the price. An effect plays when the card is pointed at or reached with the keyboard.
    function itemCard(item, scope) {
      const box = node("article", "friends-shop-item");
      box.dataset.item = item.id;
      box.dataset.kind = item.kind;
      const look = preview(item, scope);
      const marks = badges(item);
      if (marks) look.append(marks);
      const words = node("div", "friends-shop-words");
      const name = node("h3", "friends-shop-name");
      const open = button(item.name, () => openDetail(item, scope), openId(item, scope), "friends-shop-open");
      open.setAttribute("aria-haspopup", "dialog");
      box.setAttribute("aria-labelledby", open.id);
      name.append(open);
      words.append(name);
      if (memberPack(item) && item.maker?.name) words.append(node("p", "friends-shop-by", `by ${item.maker.name}`));
      words.append(priceLine(item));
      box.append(look, words);
      const stage = stages.get(`${scope}:${item.id}`);
      if (item.kind === "effect" && stage?.demo) { box.addEventListener("pointerenter", () => stage.demo()); box.addEventListener("focusin", () => stage.demo()); }
      return box;
    }
    // Ember the dragon: free with every Studio, a card like the others; its detail has the switch.
    const EMBER_ITEM = Object.freeze({ id: EMBER, kind: "pet", name: "Ember the dragon", blurb: EMBER_BLURB, price: 0, requires: null, maker: null, data: null, owned: true, status: "listed", drop: null, available: true, leaves: null });
    const emberCard = (scope) => itemCard(EMBER_ITEM, scope);
    function grid(list, scope, first = []) {
      const box = node("div", "friends-shop-grid");
      box.append(...first, ...list.map((item) => itemCard(item, scope)));
      return box;
    }
    // A section of the page: a heading, a line under it, its content, and an action at the end of its heading.
    function section(id, heading, lead, content, action = null) {
      const box = node("section", "friends-shop-group");
      box.id = `friends-shop-group-${id}`;
      box.setAttribute("aria-labelledby", `friends-shop-group-${id}-title`);
      const top = node("div", "friends-shop-group-head");
      const words = node("div", "friends-shop-group-words");
      const title = node("h2", "friends-shop-group-title", heading);
      title.id = `friends-shop-group-${id}-title`;
      words.append(title);
      if (lead) words.append(node("p", "friends-shop-lead", lead));
      top.append(words);
      if (action) top.append(action);
      box.append(top, ...[].concat(content).filter(Boolean));
      return box;
    }

    // ---- one item: its detail ----
    function openDetail(item, scope) {
      detail.item = item;
      detail.scope = scope;
      detail.said = "";
      confirm = confirm?.where === "banner" ? confirm : null;
      reporting = null;
      paintDetail();
      try {
        if (typeof detailRoot.showModal === "function") { if (!detailRoot.open) detailRoot.showModal(); }
        else detailRoot.open = true;
      } catch { detailRoot.open = true; }
      if (!detailRoot.open) detailRoot.setAttribute("open", "");
      focusOn("friends-shop-detail-name");
    }
    function closeDetail({ focus = true } = {}) {
      if (!detail.item) return;
      const { item, scope } = detail;
      detail.item = null;
      if (confirm?.where === "card") confirm = null;
      reporting = null;
      try { if (typeof detailRoot.close === "function" && detailRoot.open) detailRoot.close(); } catch { /* closed already */ }
      detailRoot.open = false;
      detailRoot.removeAttribute("open");
      detailRoot.replaceChildren();
      if (focus) focusOn(openId(item, scope));
    }
    // Esc closes the detail (or, first, a question inside it); so does a press on the dimmed page around it.
    detailRoot.addEventListener("keydown", (event) => { if (event.key === "Escape" && detail.item) { event.preventDefault?.(); event.stopPropagation?.(); closeDetail(); } });
    detailRoot.addEventListener("cancel", (event) => { event.preventDefault?.(); closeDetail(); });
    detailRoot.addEventListener("click", (event) => { if (event.target === detailRoot) closeDetail(); });
    // Pets · Haunted Hollow; Community · by Nova.
    function kickerOf(item) {
      if (memberPack(item)) return "Community";
      const drop = item.drop && catalog?.drops?.current?.id === item.drop ? catalog.drops.current.name : null;
      return [categoryName(categoryOf(item.kind)), drop].filter(Boolean).join(" · ");
    }
    function paintDetail() {
      if (!detail.item) return;
      const item = detail.item;
      const active = document.activeElement;
      const held = active && detailRoot.contains?.(active) ? active.id : "";
      // The detail's last previews stop before its new ones start; the page's own keep going.
      releaseLive(body);
      const box = node("div", "friends-shop-detail-box");
      const look = preview(item, "detail", { big: true });
      look.classList.add("friends-shop-detail-preview");
      const marks = badges(item);
      if (marks) look.append(marks);
      const words = node("div", "friends-shop-detail-words");
      const kicker = node("p", "friends-shop-detail-kicker", kickerOf(item));
      const name = node("h2", "friends-shop-detail-name", item.name);
      name.id = "friends-shop-detail-name";
      name.tabIndex = -1;
      words.append(kicker, name);
      const maker = item.id === EMBER ? "Free with every Studio" : item.maker?.name ? `by ${item.maker.name}` : String(item.id).startsWith("studio:") ? "by Mefi Studio" : "";
      if (maker) words.append(node("p", "friends-shop-by", maker));
      if (item.blurb) words.append(node("p", "friends-shop-blurb", item.blurb));
      const meta = priceLine(item);
      const leaves = item.available !== false ? leavesWords(item.leaves) : "";
      if (leaves) meta.append(node("span", "friends-shop-leaves", leaves));
      if (item.available === false && !isOwned(item)) meta.append(node("span", "friends-shop-note", "Rotated out"));
      words.append(meta, item.id === EMBER ? emberSwitch() : actions(item));
      const said = node("p", "friends-shop-detail-status", detail.said);
      said.id = "friends-shop-detail-status";
      said.setAttribute("role", "status");
      words.append(said);
      if (confirm?.where === "card" && confirm.id === item.id) words.append(confirmPanel(item));
      if (reporting === item.id) words.append(reportPanel(item));
      box.append(look, words);
      const close = button("", () => closeDetail(), "friends-shop-detail-close", "ghost friends-shop-detail-close");
      close.setAttribute("aria-label", "Close");
      close.title = "Close (Esc)";
      close.append(node("span", "friends-shop-detail-x", "×"));
      close.lastChild.setAttribute("aria-hidden", "true");
      detailRoot.replaceChildren(box, close);
      detailRoot.dataset.kind = item.kind;
      detailRoot.dataset.item = item.id;
      if (held) focusOn(held);
    }
    // What a detail offers: Use or In use (Turn off for a pet or an effect); Try for 2 minutes and Buy or Get; in the
    // showroom, Try and the one thing that helps; Report, and Remove for a moderator, on a member's pack.
    function actions(item) {
      const row = node("div", "friends-shop-actions");
      const key = domId(item.id);
      if (isOwned(item)) {
        if (!usable(item)) row.append(node("span", "friends-shop-soon", SOON));
        else if (inUse(item)) {
          row.append(node("span", "friends-shop-inuse", "In use"));
          if (item.kind === "pet" || item.kind === "effect") row.append(button("Turn off", () => turnOff(item), `friends-shop-off-${key}`));
        } else row.append(button("Use", () => use(item), `friends-shop-use-${key}`, PRIMARY));
      } else if (item.available === false) {
        row.append(node("span", "friends-shop-soon", REASONS["not-available"]));
      } else if (!usable(item) || !tryable(item)) {
        row.append(node("span", "friends-shop-soon", SOON));
      } else {
        const trying = tried?.item.id === item.id;
        row.append(button(trying ? "Stop trying" : "Try for 2 minutes", () => tryIt(item), `friends-shop-try-${key}`));
        if (ready) {
          // Getting a member's free pack asks first too: a tip for its maker may go with it.
          if (item.price === 0) row.append(button("Get", () => { if (memberPack(item)) ask(item, "card"); else void get(item); }, `friends-shop-get-${key}`, PRIMARY));
          else if (Number.isFinite(item.price)) {
            const buyIt = button(`Buy for ${item.price}`, () => ask(item, "card"), `friends-shop-buy-${key}`, PRIMARY);
            buyIt.append(gem());
            row.append(buyIt);
          }
        } else if (way) row.append(button(way.label, () => way.run(), `friends-shop-way-${key}`, PRIMARY));
        else if (stateWords) row.append(node("span", "friends-shop-soon", stateWords));
      }
      // Anyone may report a member's pack; a moderator may also take it out of the Shop.
      if (ready && memberPack(item) && !mineItem(item)) {
        row.append(button(reporting === item.id ? "Cancel report" : "Report", () => { reporting = reporting === item.id ? null : item.id; paint(); focusOn(reporting ? `friends-shop-report-ask-${key}` : `friends-shop-report-${key}`); }, `friends-shop-report-${key}`));
        if (window.MefiFriendsMod?.isMod?.() === true) row.append(confirmed("Remove", "Remove it?", `Take ${item.name} out of the Shop? Members who got it lose it.`, () => { void remove(item); }, `friends-shop-remove-${key}`));
      }
      return row;
    }
    // Ember's switch: it lets Ember out or rests it.
    function emberSwitch() {
      const row = node("div", "friends-shop-actions");
      if (typeof window.MefiPets?.set !== "function") { row.append(node("span", "friends-shop-soon", SOON)); return row; }
      // On when Ember itself is out: another pet from the Shop flying instead is Ember resting.
      const emberOut = () => petState().on === true && (petState().kind ?? "dragon") === "dragon";
      const on = emberOut();
      const toggle = button("", () => {
        const next = !emberOut();
        try { window.MefiPets.set(next ? { on: true, kind: "dragon" } : { on: false }); } catch { /* said below either way */ }
        setStatus(next ? "Ember is out. Look for it around your studio." : "Ember is resting.");
        paint();
      }, "friends-shop-ember-switch", "friends-shop-switch");
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(on));
      toggle.setAttribute("aria-describedby", "friends-shop-detail-name");
      const track = node("span", "friends-shop-switch-track");
      track.setAttribute("aria-hidden", "true");
      track.append(node("span", "friends-shop-switch-thumb"));
      // The switch's name stays "Show Ember"; On or Off beside it is for the eye (the switch's state is aria-checked).
      const state = node("span", "friends-shop-switch-state", on ? "On" : "Off");
      state.setAttribute("aria-hidden", "true");
      toggle.append(track, node("span", "friends-shop-switch-label", "Show Ember"), state);
      row.append(toggle);
      return row;
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
        setStatus(keep ? `${item.name} is yours, and in use.${thanks}` : `${item.name} is yours.${thanks} Use it any time.`);
        paint();
        focusOn(keep ? (detail.item ? "friends-shop-detail-status" : "friends-shop-status") : `friends-shop-use-${domId(item.id)}`);
        void refresh();
      });
    }
    async function get(item) {
      await guard("Getting it…", async () => {
        const answer = await call("shopBuy", item.id, 0);
        if (!answer?.ok) { refusal(item, answer, 0); return; }
        item.owned = true;
        markOwned(plainObject(answer.item) && answer.item.id === item.id ? { ...item, ...answer.item } : item);
        setStatus(`${item.name} is yours. Use it any time.`);
        paint();
        focusOn(`friends-shop-use-${domId(item.id)}`);
        void refresh();
      });
    }
    // Why a purchase did not go through, and what to do about it.
    function refusal(item, answer, price, tip = 0) {
      const code = [answer?.reason, answer?.error].find((value) => ["short", "needs", "price-changed", "no-tip", "owned", "own", "gone", "not-found", "not-available", "hold"].includes(value)) ?? answer?.error;
      const where = confirm?.where ?? "card";
      switch (code) {
        case "short": {
          const have = Number.isFinite(answer.balance) ? answer.balance : balanceNow;
          const cost = Number.isFinite(answer.price) ? answer.price : price;
          if (Number.isFinite(have)) balanceNow = have;
          // Enough for the pack but not for the tip: ask again, with a tip the balance covers.
          if (tip > 0 && Number.isFinite(have) && have >= cost) {
            confirm = { id: item.id, price: cost, tip: 0, where, changed: false, short: false };
            setStatus(`You have ${credits(have)}: enough for ${item.name}, not for that tip. Choose a smaller tip, or none.`);
          } else {
            confirm = { id: item.id, price: cost, tip: 0, where, changed: false, short: true };
            setStatus(shortWords(item, cost, have));
          }
          break;
        }
        case "needs":
          // Nothing in today's Shop needs another item first (Ember's scales are sold on their own); kept for what comes later.
          confirm = null;
          setStatus(`Get ${nameOf(answer.needs ?? item.requires)} first.`);
          break;
        case "price-changed":
          if (Number.isFinite(answer.price)) {
            item.price = answer.price;
            confirm = { id: item.id, price: answer.price, tip, where, changed: true, short: false };
            setStatus(`The price of ${item.name} changed to ${credits(answer.price)}. Buy it for that?`);
          } else { confirm = null; setStatus(`The price of ${item.name} changed. Look again, then buy.`); void loadView({ fresh: true }); }
          break;
        case "no-tip":
          confirm = { id: item.id, price, tip: 0, where, changed: false, short: false };
          setStatus(`${item.name} cannot take a tip: tips are only for members' style packs. Buy it without one?`);
          break;
        case "owned":
          confirm = null;
          item.owned = true;
          markOwned(item);
          setStatus(`You already own ${item.name}.`);
          void refresh();
          break;
        case "own":
          confirm = null;
          setStatus("That's your own pack, so it's already yours to use.");
          break;
        case "gone":
        case "not-found":
          confirm = null;
          setStatus(`${item.name} is no longer in the Shop.`);
          void loadView({ fresh: true });
          break;
        case "not-available":
          // Its drop's month is over: it rotated out while the page was open.
          confirm = null;
          item.available = false;
          setStatus(REASONS["not-available"]);
          void loadView({ fresh: true });
          break;
        case "hold":
          confirm = null;
          setStatus(holdWords(holdOf(answer)));
          break;
        default:
          setStatus(reasonWords(answer, "That did not go through. Try again."));
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
        else if (item.kind === "nodestyle") { if (window.MefiMusic.previewNodeStyle(styleOf(item.id)) !== true) throw new Error("no style"); }
        else {
          const data = dataOf(item);
          if (!data) throw new Error("no pack");
          window.MefiMusic.previewPack({ id: item.id, name: item.name, ...data });
        }
      } catch {
        setStatus(`${item.name} could not be tried just now.`);
        return;
      }
      // The detail steps aside, so what is tried can be seen; the banner at the top has the time left, Buy and Stop.
      const scope = detail.item?.id === item.id ? detail.scope : null;
      closeDetail({ focus: false });
      tried = {
        item, scope, endsAt: Date.now() + TRY_MS, words: null,
        timer: setTimeout(() => { const ended = endTry(); if (ended) { setStatus(`Your two minutes with ${ended.name} are over.`); paint(); } }, TRY_MS),
        clock: setInterval(() => { if (tried?.words) tried.words.textContent = tryWords(); }, 1000),
      };
      setStatus(`Trying ${item.name} for two minutes.`);
      paint();
      if (scope) focusOn(openId(item, scope));
      // After the repaint: the card's little menu plays the effect it is trying.
      if (scope) stages.get(`${scope}:${item.id}`)?.demo?.();
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
      const was = tried;
      const item = endTry();
      if (item) setStatus(`Stopped trying ${item.name}.`);
      paint();
      if (item && was?.scope) focusOn(openId(item, was.scope));
    }

    // ---- using what you own ----
    function use(item, { quiet = false } = {}) {
      if (tried) endTry();
      let done = false;
      try {
        if (item.kind === "pet") { window.MefiPets.set({ on: true, kind: petOf(item.id) }); done = true; }
        else if (item.kind === "skin") { window.MefiPets.set({ skin: skinOf(item.id) }); done = true; }
        else if (item.kind === "effect") { window.MefiEffects.use(effectOf(item.id)); done = true; }
        else if (item.kind === "nodestyle") {
          // music.js wears a Shop style only once this list says it is owned: one the relay just said is yours goes on it first.
          if (item.owned === true && !owns(item.id)) markOwned(item);
          const key = styleOf(item.id);
          done = Boolean(key) && window.MefiMusic.applyNodeStyle(key, true) === key;
        } else {
          const data = dataOf(item);
          if (data) { window.MefiMusic.applyPack({ id: item.id, name: item.name, ...data }, true); done = true; }
        }
      } catch { done = false; }
      if (quiet) return done;
      setStatus(done ? `${item.name} is in use.` : `${item.name} could not be put to use just now.`);
      paint();
      return done;
    }
    function turnOff(item) {
      try {
        if (item.kind === "pet") window.MefiPets.set({ on: false });
        else window.MefiEffects.use("none");
      } catch { /* said below either way */ }
      setStatus(item.kind === "pet" ? `${item.name} is resting.` : "Menus close the usual way again.");
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
        if (!reason) { setStatus("Choose what is wrong with it first."); return; }
        void guard("Sending the report…", async () => {
          const text = more.value.trim().slice(0, 300);
          const answer = await call("shopReport", item.id, text ? { reason, text } : { reason });
          if (answer?.ok) reporting = null;
          setStatus(answer?.ok ? "Thanks. A moderator will look at it." : reasonWords(answer, "The report did not go through."));
          paint();
        });
      });
      return form;
    }
    async function remove(item) {
      await guard("Removing…", async () => {
        const answer = await call("modShopRemove", item.id, {});
        setStatus(answer?.ok ? `${item.name} is out of the Shop.` : reasonWords(answer, "It could not be removed."));
        if (answer?.ok) { closeDetail({ focus: false }); await loadView({ fresh: true }); }
      });
    }

    // ---- the views ----
    // Studio's items on sale (a relay from before drops says nothing, and everything it lists is).
    const studioItems = () => (catalog?.items ?? []).filter((item) => item.available !== false);
    // The month's drop as a banner made from its own data: a gradient and a soft pattern from its colours, its month,
    // how long it has left, its name and line, and up to three of its items live inside it (a pet flying, a node style
    // lit, a theme as a little window, an effect playing). Then its items as cards.
    function dropPart() {
      const drop = catalog?.drops?.current;
      if (!drop) return [];
      const inDrop = (Array.isArray(drop.items) ? drop.items : []).map((id) => studioItems().find((item) => item.id === id)).filter(Boolean);
      const hero = node("section", "friends-shop-hero");
      hero.id = "friends-shop-hero";
      hero.setAttribute("aria-labelledby", "friends-shop-hero-name");
      const colours = drop.colors ?? {};
      for (const [key, prop] of [["accent", "--drop-accent"], ["accent2", "--drop-accent2"], ["background", "--drop-bg"]]) if (HEX.test(colours[key] ?? "")) hero.style.setProperty(prop, colours[key]);
      // Its words in white or near-black, whichever reads better on its background (4.5:1 or more).
      hero.style.setProperty("--drop-ink", inkOn(colours.background));
      const words = node("div", "friends-shop-hero-words");
      const left = timeLeft(drop.until);
      words.append(node("p", "friends-shop-hero-kicker", [`${monthOf(drop.from)} drop`, left ? `Leaves ${left}` : ""].filter(Boolean).join(" · ")));
      const name = node("h2", "friends-shop-hero-name", drop.name);
      name.id = "friends-shop-hero-name";
      words.append(name);
      if (drop.blurb) words.append(node("p", "friends-shop-hero-blurb", drop.blurb));
      words.append(node("p", "friends-shop-hero-note", inDrop.length ? `${plural(inDrop.length, "piece")} for this month only. Everyone who gets one keeps it.` : "Its pieces arrive soon. Everyone who gets one keeps it."));
      const stage = node("div", "friends-shop-hero-stage");
      stage.setAttribute("aria-hidden", "true");
      // One of each kind, in this order, so the banner shows the drop's range: a pet (or scales) flying in the big tile, a
      // node style lit and a theme as a little window in the two wide ones.
      const shown = [];
      for (const kinds of [["pet", "skin"], ["nodestyle"], ["pack"], ["effect"]]) { const found = inDrop.find((item) => kinds.includes(item.kind) && !shown.includes(item)); if (found && shown.length < 3) shown.push(found); }
      for (const item of shown) {
        const tile = node("div", "friends-shop-hero-tile");
        tile.dataset.kind = item.kind;
        const look = preview(item, "hero", { big: true });
        // A node style's board in the banner paints on the drop's own colour, not the theme's sky.
        const board = look.querySelector?.("canvas[data-node-style]");
        if (board && HEX.test(colours.background ?? "")) { board.dataset.sky = colours.background; if (HEX.test(colours.accent2 ?? "")) board.dataset.skyAccent = colours.accent2; boards.delete(board); drawLive(board, 0); }
        tile.append(look);
        stage.append(tile);
      }
      hero.dataset.pieces = String(shown.length);
      hero.append(words, stage);
      const parts = [hero];
      if (inDrop.length) parts.push(section("drop", `In ${drop.name}`, `On sale until ${dayOf(drop.until, 1)}.`, grid(inDrop, "drop")));
      return parts;
    }
    // The next drop, as a teaser: its name and how soon it starts (its items stay hidden until then). Said as a time from
    // now, as "Leaves in 24 days" is: a drop starts at midnight UTC, which is the evening before in the Americas, so a
    // date would name the wrong day for many. One whose start has passed (a list read before it) says nothing.
    function teaserPart() {
      const drop = catalog?.drops?.next;
      const soon = drop ? timeLeft(drop.from) : null;
      if (!soon) return null;
      const box = node("p", "friends-shop-teaser");
      box.id = "friends-shop-teaser";
      const swatch = node("span", "friends-shop-teaser-swatch");
      swatch.setAttribute("aria-hidden", "true");
      for (const key of ["accent", "accent2", "background"]) if (HEX.test(drop.colors?.[key] ?? "")) { const dot = node("i"); dot.style.setProperty("--swatch", drop.colors[key]); swatch.append(dot); }
      box.append(swatch, node("span", "", `Next drop: ${drop.name}, ${soon}.`));
      return box;
    }
    function featuredPart() {
      const ids = Array.isArray(catalog?.featured) ? catalog.featured : [];
      const list = ids.map((id) => studioItems().find((item) => item.id === id)).filter(Boolean);
      if (!list.length) return null;
      const left = timeLeft(catalog.featuredUntil);
      return section("featured", "Featured this week", left ? `New picks ${left}.` : "", grid(list, "featured"));
    }
    function categoryPart(key, scope, { full = false } = {}) {
      const [, label, lead] = CATEGORIES.find(([id]) => id === key);
      const list = studioItems().filter((item) => categoryOf(item.kind) === key && !memberPack(item));
      const first = key === "pets" ? [emberCard(scope)] : [];
      if (!list.length && !first.length) return full ? section(key, label, lead, node("p", "friends-shop-empty", "Nothing here right now. A new month's drop may bring some.")) : null;
      const more = full ? null : button(`All ${label.toLowerCase()}`, () => show(key), `friends-shop-more-${key}`, "friends-shop-link");
      return section(scope === key ? key : `${scope}-${key}`, label, lead, grid(list, scope, first), more);
    }
    function homeView() {
      if (!studioItems().length && !catalog) return [];
      if (!studioItems().length) return [node("p", "friends-shop-empty", "The Shop is empty right now. Come back soon.")];
      const community = section("community-teaser", "Community", "Style packs members make, free or for credits.", null, button(ready ? "See members' packs" : "About members' packs", () => show("packs"), "friends-shop-see-packs", "friends-shop-link"));
      return [...dropPart(), teaserPart(), featuredPart(), ...CATEGORIES.map(([key]) => categoryPart(key, "home")), community];
    }
    function communityView() {
      if (!ready) {
        const box = section("packs", "Community", "Style packs members make and share, free or for credits.", node("p", "friends-shop-empty", "Members' packs need sign-in: they come from the room service."), way ? button(way.label.replace(/ to get it$/, ""), () => way.run(), "friends-shop-packs-way", PRIMARY) : null);
        return [box];
      }
      const row = node("div", "friends-shop-sort");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Show members' packs by");
      for (const [key, label] of [["new", "New"], ["top", "Top"]]) {
        // The list on screen stays until the other order arrives.
        const choice = button(label, () => { if (sort === key) return; sort = key; paint(); void loadView({ fresh: true }); }, `friends-shop-sort-${key}`, "friends-shop-chip");
        choice.setAttribute("aria-pressed", String(sort === key));
        row.append(choice);
      }
      const makeOwn = button("Make a style", () => show("make"), "friends-shop-make-own", "friends-shop-link");
      const empty = sort === "new"
        ? [node("p", "friends-shop-empty", "No member has published a style pack yet. Be the first:"), button("Make a style", () => show("make"), "friends-shop-empty-make", PRIMARY)]
        : [node("p", "friends-shop-empty", "No pack has been got yet. See the newest under New."), button("New", () => { sort = "new"; paint(); void loadView({ fresh: true }); }, "friends-shop-empty-new")];
      const content = [row, ...(items.length ? [grid(items, "packs")] : [node("div", "friends-shop-empty-box", null)])];
      if (!items.length) content.at(-1).append(...empty);
      if (next) content.push(button("Show more", () => { void loadView({ more: true }); }, "friends-shop-more"));
      return [section("packs", "Community", "Style packs members made. Anyone can make one under Make a style.", content, makeOwn)];
    }
    function ownedView() {
      const list = ready ? items : ownedList().map((entry) => ({ id: entry.id, kind: entry.kind, name: entry.name, blurb: "", price: null, requires: null, maker: null, data: entry.data, sales: null, owned: true, status: "listed" }));
      const content = [grid(list.filter((item) => item.id !== EMBER), "owned", [emberCard("owned")])];
      if (!list.length) content.push(node("p", "friends-shop-empty", "Nothing else yet. What you get in the Shop shows up here."), button("See what's in the Shop", () => show("studio"), "friends-shop-empty-shop"));
      return [section("owned", "Owned", ready ? "Everything you have, on every PC you sign in on." : "What this PC knows you own. It keeps working while the Shop is out of reach.", content)];
    }
    // What you own, from this PC's own list, while the Shop is out of reach and there is no showroom: it all keeps working.
    function yours() {
      const list = ownedList().filter((entry) => entry.id !== EMBER).map((entry) => ({ id: entry.id, kind: entry.kind, name: entry.name, blurb: "", price: null, requires: null, maker: null, data: entry.data, sales: null, owned: true, status: "listed" }));
      // Ember is everyone's: its switch works here too, when this build has pets.
      const ember = typeof window.MefiPets?.set === "function" ? [emberCard("yours")] : [];
      if (!list.length && !ember.length) return [];
      const box = node("section", "friends-shop-yours");
      box.id = "friends-shop-yours";
      box.setAttribute("aria-labelledby", "friends-shop-yours-title");
      const heading = node("h2", "friends-shop-group-title", "Your items");
      heading.id = "friends-shop-yours-title";
      box.append(heading, node("p", "friends-shop-lead", "What you own keeps working while the Shop is out of reach."), grid(list, "yours", ember));
      return [box];
    }
    // The showroom's line at the top: where you stand, and the one thing that helps.
    function noticePart() {
      if (!showroom()) return null;
      const box = node("div", "friends-shop-notice");
      box.id = "friends-shop-notice";
      box.setAttribute("role", "note");
      box.append(gem("friends-shop-notice-gem"), node("p", "friends-shop-notice-words", stateWords || "The Shop is out of reach right now. Look around and try anything for two minutes."));
      if (gateEl) box.append(button("Sign in", () => callGate(), "friends-shop-notice-signin", PRIMARY));
      else if (way) box.append(button(way.label.replace(/ to get it$/, ""), () => way.run(), "friends-shop-notice-way", PRIMARY));
      return box;
    }
    // Friends' sign-in card at the foot of the showroom. "Sign in to get it" is that card's own Sign in with Discord: it
    // comes into view, takes the keyboard and starts (Discord asks in the browser; the card's status line says each step
    // and onSignedIn opens the Shop for real). A card already signing in is only brought into view.
    function callGate() {
      closeDetail({ focus: false });
      const card_ = gateEl;
      if (!card_) return;
      gateCalled = true;
      card_.classList?.remove("friends-shop-gate-tucked");
      try { card_.scrollIntoView?.({ block: "center", behavior: motionOff() ? "auto" : "smooth" }); } catch { /* it is on the page */ }
      card_.classList?.add("is-called");
      setTimeout(() => card_.classList?.remove("is-called"), 1600);
      const signIn = card_.querySelector?.("#friends-gate-signin") ?? null;
      (signIn ?? card_).focus?.({ preventScroll: true });
      if (signIn && !signIn.disabled) signIn.click?.();
    }
    function viewParts() {
      if (!ready && !showroom()) return cataloguing ? [] : notReady();
      const lead = noticePart();
      const foot = showroom() && gateEl ? [gateEl] : [];
      if (foot.length && !gateCalled) gateEl.classList?.add("friends-shop-gate-tucked");
      if (loading && ready && (view === "packs" || view === "owned") && !items.length) return [lead];
      if (view === "make") return [lead, ...makeView(), ...foot];
      if (view === "packs") return [lead, ...communityView(), ...foot];
      if (view === "owned") return [lead, ...ownedView(), ...foot];
      // A view being read for the first time says so in the status line, not with an empty list.
      if (loading && !catalog) return [lead];
      if (view === "studio") return [lead, ...homeView(), ...foot];
      return [lead, categoryPart(view, view, { full: true }), ...foot];
    }

    // ---- Make a style ----
    function makeView() {
      if (!draft.palette) freshDraft();
      const wrap = node("section", "friends-shop-make");
      wrap.id = "friends-shop-make";
      wrap.setAttribute("aria-labelledby", "friends-shop-make-title");
      const heading = node("h2", "friends-shop-group-title", editing ? `Change ${draft.name.trim() || "your pack"}` : "Make a style");
      heading.id = "friends-shop-make-title";
      const lead = node("p", "friends-shop-lead", "Five colours, a node style, a material and a font. Use it yourself, or publish it in the Shop, free or for credits: eligible makers earn a share of each sale.");
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
      // Signed out, publishing is what signing in brings: the button says so and leads there.
      const publish = node("button", PRIMARY, ready ? (editing ? "Save changes" : "Publish") : way ? way.label.replace(/ to get it$/, " to publish") : "Publish");
      publish.type = "submit";
      publish.id = "friends-shop-publish";
      publish.setAttribute("aria-describedby", check.id);
      const useMine = button("Use it myself", () => useOwnStyle(), "friends-shop-use-mine");
      useMine.setAttribute("aria-describedby", check.id);
      const tools = node("div", "friends-shop-actions");
      tools.append(publish, useMine);
      if (editing) tools.append(button("Start a new style", () => { freshDraft(); paint(); focusOn("friends-shop-pack-name"); }, "friends-shop-new"));
      form.append(field("Name", name), field("About it", blurb), colours, looks, prices, check, tools);
      form.addEventListener("submit", (event) => {
        event.preventDefault?.();
        if (ready) { void publishDraft(); return; }
        if (way) way.run(); else setStatus(stateWords || "Publishing needs the room service.");
      });
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
      make.check.textContent = problem ?? (!ready ? "It reads well. Use it yourself now; sign in to publish it." : listing.price ? `Ready to publish for ${credits(listing.price)}.` : "Ready to publish, free.");
      make.check.dataset.state = problem ? "blocked" : "ready";
      make.publish.setAttribute("aria-disabled", String(Boolean(problem) && ready));
      make.useMine.setAttribute("aria-disabled", String(!checked.ok || typeof window.MefiMusic?.applyPack !== "function"));
    }
    function useOwnStyle() {
      const checked = checkPack(packFromDraft());
      if (!checked.ok) { setStatus(`Not yet: ${checked.why}`); return; }
      if (typeof window.MefiMusic?.applyPack !== "function") { setStatus(`Using your own style: ${SOON}`); return; }
      draft.localId ??= `local:${Math.random().toString(36).slice(2, 10)}`;
      try {
        window.MefiMusic.applyPack({ id: draft.localId, name: draft.name.trim() || "My style", ...checked.data }, true);
        setStatus("Your style is on, on this PC only. Change it any time in Settings › Appearance.");
      } catch { setStatus("Your style could not be put on just now."); }
    }
    async function publishDraft() {
      const checked = checkPack(packFromDraft());
      const listing = checkListing(draft);
      if (!checked.ok || !listing.ok) { setStatus(`Not published yet: ${!checked.ok ? checked.why : listing.why}`); return; }
      await guard(editing ? "Saving…" : "Publishing…", async () => {
        const fields = { name: listing.name, blurb: listing.blurb, price: listing.price, data: checked.data };
        const answer = editing ? await call("shopUpdate", editing, fields) : await call("shopPublish", fields);
        if (!answer?.ok) {
          const words = reasonWords(answer, editing ? "Your changes were not saved. Try again." : "It was not published. Try again.");
          setStatus([answer?.error, answer?.reason].includes("hold") ? `${words} You can publish it free now.` : words);
          return;
        }
        const was = editing;
        if (!was && typeof answer.pack?.id === "string") editing = answer.pack.id;
        setStatus(was ? `${listing.name} is saved. Members who got it see the new look.` : `${listing.name} is in the Shop, ${listing.price ? `for ${credits(listing.price)}` : "free"}.`);
        await loadView({ fresh: true });
      });
    }
    // How many times a pack of yours was got (bought or, free, got), as a maker reads it.
    const gotWords = (n) => (n === 0 ? "No one has got it yet" : n === 1 ? "Got once" : `Got ${n} times`);
    function minePart() {
      const box = node("section", "friends-shop-mine");
      box.id = "friends-shop-mine";
      box.setAttribute("aria-labelledby", "friends-shop-mine-title");
      const heading = node("h2", "friends-shop-group-title", "Your packs");
      heading.id = "friends-shop-mine-title";
      box.append(heading);
      if (!ready) { box.append(node("p", "friends-shop-empty", "Sign in to publish a style and to see the ones you published.")); return box; }
      if (!mine.length) { box.append(node("p", "friends-shop-empty", loading ? "Reading your packs…" : "You have not published a style pack yet. Make one above, then press Publish.")); return box; }
      const list = node("ul", "friends-shop-mine-list");
      for (const item of mine) {
        const key = domId(item.id);
        const row = node("li", "friends-shop-mine-row");
        row.dataset.item = item.id;
        const words = node("div", "friends-shop-words");
        const facts = [item.status === "listed" ? "Listed" : item.status === "unlisted" ? "Not listed" : "Removed by a moderator", item.price ? credits(item.price) : "Free", gotWords(count(item.sales) ?? 0)];
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
      setStatus(`Changing ${item.name}. Save changes when it looks right.`);
      paint();
      focusOn("friends-shop-pack-name");
    }
    async function unlist(item) {
      await guard("Unlisting…", async () => {
        const answer = await call("shopUnlist", item.id);
        setStatus(answer?.ok ? `${item.name} is no longer listed. Members who got it keep it.` : reasonWords(answer, "It could not be unlisted."));
        if (answer?.ok) await loadView({ fresh: true });
      });
    }
    async function relist(item) {
      await guard("Listing it again…", async () => {
        const answer = await call("shopUpdate", item.id, { listed: true });
        setStatus(answer?.ok ? `${item.name} is listed again.` : reasonWords(answer, "It could not be listed again."));
        if (answer?.ok) await loadView({ fresh: true });
      });
    }

    // ---- painting ----
    function paint() {
      if (gone) return;
      // The control that had the keyboard keeps it: every control has an id that survives the repaint.
      const active = document.activeElement;
      const focusedId = active && active !== root && root.contains?.(active) && !detailRoot.contains?.(active) ? active.id : "";
      releaseLive(detail.item ? detailRoot : null);
      for (const key of [...stages.keys()]) if (!key.startsWith("detail:")) stages.delete(key);
      for (const key of Object.keys(make)) delete make[key];
      paintChrome();
      // The showroom's line says where you stand; the status line keeps what just happened.
      if (showroom() && status.textContent === stateWords) status.textContent = "";
      body.replaceChildren(...viewParts().filter(Boolean));
      paintTry();
      paintDetail();
      if (focusedId) focusOn(focusedId);
    }
    function show(id) {
      const wanted = viewOf(id);
      if (!wanted) return;
      const moved = view !== wanted;
      view = wanted;
      lastView = wanted;
      confirm = confirm?.where === "banner" ? confirm : null;
      reporting = null;
      closeDetail({ focus: false });
      if (!ready) { paint(); return; }
      // Studio's categories share one read of the Studio list.
      if (moved && !(STUDIO_VIEWS.includes(wanted) && catalog && !catalog.local)) { items = []; next = null; loading = true; }
      paint();
      void loadView();
    }

    // ---- the room service, and reading the Shop ----
    // Studio's list as the relay (or this PC's copy) gives it.
    function takeCatalog(answer, local) {
      const list = (Array.isArray(answer?.items) ? answer.items : []).filter((item) => plainObject(item) && typeof item.id === "string" && item.id !== EMBER && KINDS.includes(item.kind) && typeof item.name === "string");
      for (const item of list) names.set(item.id, item.name);
      const drops = plainObject(answer?.drops) ? answer.drops : null;
      catalog = {
        items: list, local, at: Date.now(),
        drops: drops ? { current: plainObject(drops.current) ? drops.current : null, next: plainObject(drops.next) ? drops.next : null, last: plainObject(drops.last) ? drops.last : null } : null,
        featured: Array.isArray(answer?.featured) ? answer.featured.filter((id) => typeof id === "string") : [],
        featuredUntil: typeof answer?.featuredUntil === "string" ? answer.featuredUntil : null,
      };
    }
    async function loadView({ more = false, fresh = false } = {}) {
      if (!ready) return;
      const mineSeq = ++seq;
      const wanted = view;
      const studio = STUDIO_VIEWS.includes(wanted);
      // Studio's list is read once for all its views (again after a minute, or when something changed).
      if (studio && catalog && !catalog.local && !fresh && Date.now() - catalog.at < 60_000) { loading = false; paint(); return; }
      const relayView = studio ? "studio" : wanted === "packs" ? sort : wanted === "make" ? "mine" : wanted;
      if (!more && !busy) setStatus(OPENING);
      loading = !more;
      const answer = await call("shop", relayView, ...(more && next ? [next] : []));
      if (gone || mineSeq !== seq) return;
      loading = false;
      if (status.textContent === OPENING) setStatus("");
      if (!answer?.ok) {
        if (answer?.error === "unsupported") { ready = false; root.dataset.state = "unsupported"; stateWords = REASONS.unsupported; setStatus(REASONS.unsupported); notReady = () => yours(); void loadShowroom(); }
        else setStatus(reasonWords(answer, "The Shop could not be read just now. Try again in a moment."));
        paint();
        return;
      }
      if (studio) takeCatalog(answer, false);
      else {
        // Ember is never a Shop item (it has its own card); a relay from before that change may still list it.
        const list = (Array.isArray(answer.items) ? answer.items : []).filter((item) => plainObject(item) && typeof item.id === "string" && item.id !== EMBER && KINDS.includes(item.kind) && typeof item.name === "string");
        for (const item of list) names.set(item.id, item.name);
        if (wanted === "make") mine = list;
        else { items = more ? [...items, ...list] : list; next = typeof answer.next === "string" && answer.next ? answer.next : null; }
      }
      if (Number.isFinite(answer.balance)) balanceNow = answer.balance;
      canEarn = answer.canEarn !== false;
      hold = answer.hold ? holdOf(answer) : null;
      paint();
    }
    // The showroom's list: this PC's copy of Studio's (main's hub:shop "shopCatalog"; no relay asked).
    async function loadShowroom() {
      if (ready || !showroomOn() || catalog?.local) { cataloguing = false; paint(); return; }
      cataloguing = true;
      const answer = await call("shopCatalog");
      cataloguing = false;
      if (gone || ready) return;
      if (answer?.ok && Array.isArray(answer.items) && answer.items.length) takeCatalog(answer, true);
      paint();
    }
    const connectNow = () => guard("Connecting…", async () => {
      const answer = await api.hubConnect?.();
      if (answer?.status?.state === "ready" || answer?.ok) await load(); else { explain(answer?.status); void loadShowroom(); }
    });
    function gate(note = "") {
      return window.MefiFriendsFront?.gate?.({ onSignedIn: () => { autoConnected = true; void load(); }, ...(note ? { note } : {}) }) ?? null;
    }
    function notMember() {
      root.dataset.state = "not-member";
      stateWords = "Your Discord account isn't in the Void Engine server yet. Join it, then check again.";
      setStatus(stateWords);
      way = { label: "Join the Discord to get it", run: () => { closeDetail({ focus: false }); void window.MefiCommunity?.join?.(); } };
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
      way = null;
      gateEl = null;
      gateCalled = false;
      notReady = () => yours();
      if (!hub?.configured) { root.dataset.state = "not-configured"; stateWords = "The Shop needs the room service, which this copy of Studio has no address for."; setStatus(stateWords); paint(); return false; }
      if (!hub.linked) {
        root.dataset.state = "not-linked";
        gateEl = gate();
        stateWords = gateEl ? "You're signed out. Look around and try anything for two minutes; sign in with Discord to get what you like." : "Sign in with Discord in Friends to use the Shop.";
        setStatus(gateEl ? "" : stateWords);
        if (gateEl) way = { label: "Sign in to get it", run: () => callGate() };
        notReady = () => [...(gateEl ? [gateEl] : []), ...yours()];
        paint();
        return false;
      }
      if (hub.error === "not-member") { notMember(); return false; }
      // Signed in and simply not connected yet: opening the Shop is the ask, so connect once by itself.
      if (hub.state === "off" && !hub.error && !autoConnected) {
        autoConnected = true;
        root.dataset.state = "connecting";
        stateWords = "Connecting to the room service…";
        setStatus(stateWords);
        paint();
        void connectNow();
        return false;
      }
      if (hub.state !== "ready") {
        root.dataset.state = hub.state || "off";
        // Friends' one way of saying it (renderer/friends-front.js hubState): Connect only when it can help.
        const said = window.MefiFriendsFront?.hubState?.(hub) ?? { action: "connect", text: hub.state === "connecting" ? "Connecting to the room service…" : "Connect to open the Shop." };
        gateEl = said.action === "signin" ? gate(said.text) : null;
        stateWords = said.text;
        setStatus(gateEl ? "" : said.text);
        if (gateEl) way = { label: "Sign in to get it", run: () => callGate() };
        else if (said.action === "connect") way = { label: "Connect to get it", run: () => { closeDetail({ focus: false }); void connectNow(); } };
        notReady = () => [...(gateEl ? [gateEl] : said.action === "connect" ? [button("Connect", () => { void connectNow(); }, "friends-shop-connect")] : []), ...yours()];
        paint();
        return false;
      }
      if (hub.shop === false) { root.dataset.state = "unsupported"; stateWords = REASONS.unsupported; setStatus(REASONS.unsupported); paint(); return false; }
      root.dataset.state = "ready";
      stateWords = "";
      ready = true;
      // Signed in now: the showroom's copy of the list gives way to the relay's.
      if (catalog?.local) catalog = null;
      return true;
    }
    async function load() {
      let hub = null;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (gone) return;
      me = hub?.user?.id ?? me;
      if (!explain(hub)) { await loadShowroom(); return; }
      if (status.textContent === "Checking the room service…" || status.textContent === "Connecting…") setStatus("");
      void refresh();
      loading = true;
      paint();
      await loadView({ fresh: true });
    }

    function hear(event) {
      if (gone) return;
      if (root.isConnected === false) { dispose(); return; }
      if (event?.type === "credits") {
        if (Number.isFinite(event.balance)) { balanceNow = event.balance; paintChrome(); }
        // A member got one of your packs: Friends' pop-up says so (renderer/friends-front.js); with pop-ups off, this
        // page's status line does. Your packs read again for their counts.
        if (event.reason === "sale" && event.delta > 0) {
          const told = window.MefiFriendsFront?.popups?.on?.() === true && document.visibilityState !== "hidden";
          if (!told) setStatus(`A member got one of your style packs: +${credits(event.delta)}.`);
          if (view === "make" && ready) void loadView({ fresh: true });
        }
      } else if (event?.type === "status") void load();
    }
    function dispose() {
      if (gone) return;
      gone = true;
      seq += 1;
      endTry();
      closeDetail({ focus: false });
      releaseLive();
      motionWatch?.disconnect();
      if (current === handle) current = null;
    }
    // Motion switched back on: the pets and boards on screen move again; switched off, they hold still.
    const motionWatch = typeof MutationObserver === "function" ? new MutationObserver(() => { if (motionOff()) { for (const part of live.seen) if (!part.play) drawLive(part, 0); } else spin(); }) : null;
    motionWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    // Whether this member moderates arrives after the page (friends-mod.js learn()): their Remove buttons follow.
    if (!watchingMods && typeof window.MefiFriendsMod?.subscribe === "function") { watchingMods = true; window.MefiFriendsMod.subscribe(() => { if (current?.ready()) current.paint(); }); }
    const handle = { hear, dispose, paint, show: (id) => show(id), ready: () => ready };
    current = handle;
    root.dispose = dispose;

    if (typeof api?.hubShop !== "function" || typeof api?.hubStatus !== "function") {
      root.dataset.state = "unavailable";
      cataloguing = false;
      setStatus(typeof api?.hubStatus === "function" ? `The Shop: ${SOON}` : "The Shop works in the desktop app.");
      notReady = () => yours();
      paint();
      return root;
    }
    listen(api);
    paint();
    void load();
    return root;
  }

  // ---- the page of its own (route "shop", registered with MefiNav below) ----
  const page = { root: null, sheet: null, card: null };
  function mountPage() {
    if (page.root) return page.root;
    const overlay = node("div", "overlay workspace-page friends-shop-page");
    overlay.id = "friends-shop-page";
    overlay.hidden = true;
    const sheet = node("section", "sheet friends-shop-sheet");
    sheet.tabIndex = -1;
    sheet.setAttribute("role", "region");
    sheet.setAttribute("aria-labelledby", "friends-shop-title");
    overlay.append(sheet);
    document.body.append(overlay);
    Object.assign(page, { root: overlay, sheet });
    return overlay;
  }
  const pageOpen = () => Boolean(page.root && page.root.hidden === false);
  function openPage(params = {}) {
    mountPage();
    const view = viewOf(params?.view) ?? viewOf(asked);
    asked = null;
    window.MefiNav?.claim?.("shop");
    page.root.hidden = false;
    // The frame measures again now the page shows (the list column lists Friends' places, Shop current).
    window.MefiShell?.sync?.("shop");
    if (!page.card || page.card.isConnected === false || !current) {
      page.card = card({ view, onPage: true });
      page.sheet.replaceChildren(page.card);
    } else if (view) current.show(view);
    window.MefiScroll?.scan?.(page.root);
    return true;
  }
  function closePage() {
    if (!pageOpen()) return false;
    page.card?.dispose?.();
    page.card = null;
    page.sheet.replaceChildren();
    page.root.hidden = true;
    window.MefiNav?.release?.("shop");
    return true;
  }
  function registerPage() {
    window.MefiNav?.register?.({
      id: "shop", label: "Shop", short: "Shop", kind: "overlay", layer: "sheet", section: "friends", group: "tools",
      glyph: "g-shop", badge: null, desc: "Scales for Ember, menu effects, node styles and themes for the credits you earn, and style packs members make",
      // Search finds the Shop through Friends' own row ("friends-shop" in renderer/nav.js), which opens this page.
      searchTerms: "shop store buy credits pet dragon effects style pack theme drop featured",
      showIn: { tabs: false, tools: false, dock: false, palette: false, help: false, footer: false },
      element: "friends-shop-page", focus: "#friends-shop-title",
      open: (params) => openPage(params), close: () => closePage(), isOpen: () => pageOpen(),
    });
  }
  if (window.MefiNav?.register) registerPage();
  else { try { document.addEventListener?.("DOMContentLoaded", registerPage, { once: true }); } catch { /* no document events here */ } }

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
    const line = node("p", "friends-shop-settings-line", "Ember the dragon comes free with every Studio. The Shop has scales for Ember, menus that crumble away, node styles and themes, a new drop every month and style packs from members, for the credits you earn; or make a style of your own.");
    const go = button("Open the Shop", () => open("studio"), "friends-shop-settings-open", PRIMARY);
    go.prepend(gem());
    box.append(heading, line, go);
    if (typeof theme.after === "function") theme.after(box); else theme.parentNode.insertBefore(box, theme.nextSibling ?? null);
    settingsCard = box;
    return true;
  }

  // The Shop at one of its views (studio, pets, effects, nodestyles, themes, packs, owned or make): its own page, or
  // Friends' place "shop" with the "mefiStudio.shop.page" kill switch.
  function open(view = "studio") {
    const wanted = viewOf(view) ?? "studio";
    lastView = wanted;
    if (pageOn()) {
      asked = wanted;
      window.MefiNav?.go?.("shop", { view: wanted });
      return true;
    }
    if (current) current.show(wanted); else asked = wanted;
    window.MefiNav?.go?.("friends-page", { place: "shop" });
    return true;
  }

  window.MefiShop = { card, owns, owned: ownedList, pack, refresh, open, openPage, closePage, pageOn, checkPack, checkListing, contrast, packName: (id) => names.get(id) ?? null, mountSettings };
  listen(bridge());
  const whenReady = (run) => { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true }); else run(); };
  whenReady(() => { mountSettings(); });
  try { window.addEventListener?.("mefi:nav", (event) => { if (event?.detail?.id === "studio") mountSettings(); }); } catch { /* no navigation here */ }
})();
