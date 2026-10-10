// Pets & collectibles inside the Shop: an authoritative inventory, transparent
// crate odds, growing pets, owned stickers, the market and the supporter studio.
// The relay owns all credits, rolls, rights, traits and holds. This renderer never
// mints an item or infers ownership from a downloaded visual. Custom art is data
// only; neither HTML nor creator-provided URLs are rendered. One bounded reveal
// follows a confirmed result; it can be skipped and respects reduced motion.
(function () {
  "use strict";
  const VIEWS = [["collection", "Nursery"], ["crates", "Crates"], ["stickers", "Sticker book"], ["market", "Market"], ["creator", "Creator studio"]];
  const GLYPHS = { heart: "♥", star: "★", moon: "☾", spark: "✦", leaf: "❧", wave: "≈" };
  const STICKER_ASSETS = ["idea", "rest", "celebrate", "code", "happy", "plan", "curious", "love", "sleep"];
  const RARITIES = ["none", "common", "uncommon", "rare", "epic", "legendary"];
  const HEX = /^#[0-9a-f]{6}$/i;
  const cleanColor = (color, fallback = "#8b7cf6") => HEX.test(String(color)) ? color : fallback;
  const node = (tag, cls = "", text = null) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const btn = (text, run, primary = false) => { const el = node("button", primary ? "friends-shop-primary" : "ghost friends-shop-button", text); el.type = "button"; el.addEventListener("click", run); return el; };
  const word = (value) => String(value || "").replace(/^./, (letter) => letter.toUpperCase());
  const credits = (n) => `${Number.isFinite(n) ? n : "—"} credits`;
  const chanceText = (value) => {
    const chance = Number(value);
    if (!Number.isFinite(chance) || chance < 0 || chance > 100) return "—";
    const rounded = Number(chance.toPrecision(6));
    return `${rounded !== chance ? "≈ " : ""}${rounded.toLocaleString(undefined, { maximumSignificantDigits: 6, useGrouping: false })}%`;
  };
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  let state = null, readFlight = null, epoch = 0, identityEpoch = 0, statusEpoch = 0, requestedView = "collection", dirty = false, accountId = null, connectionReady = true, dynamicCratesAvailable = false;
  const listeners = new Set();
  const cards = new Set();
  // An uncertain acquisition keeps its id across tab changes and inventory
  // repaints. Only a confirmed response (or an invalidated quote) releases it.
  const pendingAcquisitions = new Map();
  const acquisitionKey = (kind, id, price, version = "") => `${accountId || state?.inventory?.[0]?.ownerId || "current"}:${kind}:${id}:${price}:${version}`;
  function acquisition(key, payload) {
    if (!pendingAcquisitions.has(key)) pendingAcquisitions.set(key, { ...payload, requestId: globalThis.crypto?.randomUUID?.() || `acquire-${Date.now()}-${Math.random().toString(36).slice(2)}` });
    return pendingAcquisitions.get(key);
  }
  const interested = () => Boolean(window.MefiPets?.state?.()?.chosen?.instanceId) || [...cards].some((root) => root.isConnected !== false && !root.closest?.("[hidden]") && document.visibilityState !== "hidden");
  const ERRORS = {
    "monthly-required": "Active paid, lifetime or intro membership is needed to make new pets or stickers. Your existing creations stay yours.",
    "supporter-required": "Selling requires supporter history. Adding rarity requires active paid, lifetime or intro membership.",
    "trade-hold": "This item is still on trade hold. Check the time shown on its card.",
    "short": "You do not have enough earned credits for this.",
    "pool-changed": "The community pool changed. Review the updated odds and opt in again.",
    "price-changed": "The price changed. Review the current price before confirming again.",
    "not-owner": "This item belongs to another member now. Your collection has been refreshed.",
    "listed": "Unlist this item before caring for it, changing it or trading it.",
    "size-locked": "That size has not been unlocked yet.",
    "already-cared": "You already cared for this pet today. It will keep growing over time.",
    "limit": "You have reached this feature's current limit.",
    "starter-claimed": "Your welcome crate has already been opened.",
    "already-claimed": "Your welcome crate has already been opened. Its rewards stay in your collection.",
    "collectibles-disabled": "Pets & collectibles is paused on this community service right now.",
    "credit-hold": "Earned-credit trading is waiting for your account to be in good standing with the community.",
    "rarity-limits": "Rarity designs cost at least 10 credits. Common must be at least 50%; Rare at most 20%, Epic at most 5%, Legendary at most 1%.",
    "rarity-price-min": "A design with rarity chances must cost at least 10 earned credits.",
    "not-found": "That item is no longer available.",
    "offline": "Connect to Friends to load your collection.",
    "not-linked": "Sign in with Discord in Friends to start collecting.",
    "not-configured": "This copy of Studio has no room service configured.",
    "unsupported": "Pets & collectibles needs the updated community service.",
    "incomplete-inventory": "Your complete collection could not be read. Your equipped pet has been kept; try again to refresh.",
    "dynamic-crates-unavailable": "Topic crates are not available on this community service yet.",
    "recipe-unavailable": "That topic and budget are no longer available. Refresh the configured choices.",
    "empty-pool": "There are not enough eligible rewards for this exact count and budget.",
    "pool-too-large": "This pool is too large to quote safely. Choose another configured topic or budget.",
    "quote-expired": "This quote expired. Get a new quote and review it before opening.",
    "quote-unavailable": "This quote is no longer available. Review a fresh quote before opening.",
    "quote-consumed": "This quote has already been opened. Refresh your collection to see its rewards.",
    "quote-mismatch": "These opening terms do not match the saved quote. Review a new quote.",
    "request-conflict": "This request no longer matches its saved terms. Review a new quote.",
    "terms-changed": "The creation's terms changed. Read the current terms and confirm again.",
    "opt-in-required": "This recipe needs your explicit permission to include community creations before it can be quoted.",
    "rate-limited": "Too many quotes were requested recently. Please wait before asking for another.",
    "read-only": "This account currently has read-only community access.",
    "paused": "The community service is paused. Your existing collection remains yours.",
    "bad-response": "The service returned an incomplete quote or receipt. Nothing new will be opened; retry the same request to recover its result.",
  };
  const errorWords = (answer) => ERRORS[answer?.error] || (typeof answer?.why === "string" ? answer.why : "The community service could not complete that. Try again.");
  const call = async (action, payload = {}) => {
    if (typeof window.mefiStudio?.hubCollectibles !== "function") return { ok: false, error: "unsupported" };
    try { return await window.mefiStudio.hubCollectibles(action, payload); } catch { return { ok: false, error: "network" }; }
  };
  function accept(answer) {
    if (!answer?.ok || !Array.isArray(answer.inventory)) return false;
    state = clone(answer);
    const equipped = window.MefiPets?.state?.()?.chosen?.instanceId;
    if (equipped) window.MefiPets?.equip?.(state.inventory.find((item) => item.id === equipped && item.kind === "pet") ?? null);
    for (const listener of listeners) listener();
    try { window.dispatchEvent(new CustomEvent("mefi-collectibles-changed", { detail: clone(state) })); } catch { /* standalone preview */ }
    return true;
  }
  async function refresh() {
    if (readFlight) return readFlight;
    dirty = false;
    const ownEpoch = epoch;
    readFlight = (async () => {
      const answer = await call("list");
      if (ownEpoch !== epoch) return { ok: false, error: "stale" };
      if (!answer?.ok || !Array.isArray(answer.inventory)) return answer;
      const inventory = new Map(answer.inventory.map((item) => [item.id, item]));
      let cursor = answer.inventoryNext || null, pages = 0;
      const seen = new Set();
      while (cursor) {
        if (pages++ >= 5 || seen.has(cursor)) return { ok: false, error: "incomplete-inventory" };
        seen.add(cursor);
        const page = await call("inventory", { cursor });
        if (ownEpoch !== epoch) return { ok: false, error: "stale" };
        if (!page?.ok || !Array.isArray(page.inventory)) return page?.ok ? { ok: false, error: "incomplete-inventory" } : page;
        for (const item of page.inventory) inventory.set(item.id, item);
        cursor = page.next || null;
      }
      const complete = { ...answer, inventory: [...inventory.values()], inventoryNext: null };
      accept(complete); return complete;
    })().finally(() => { readFlight = null; if (dirty && connectionReady && interested()) void refresh(); });
    return readFlight;
  }
  const rarityOf = (id) => state?.rarities?.find((entry) => entry.id === id) || { id, name: id === "none" ? "Original" : word(id), color: "#a7afbd" };
  const stickerGlyph = (item) => Object.hasOwn(GLYPHS, item?.visual?.glyph) ? GLYPHS[item.visual.glyph] : "✦";
  const stickerSource = (item) => STICKER_ASSETS.includes(item?.visual?.asset) ? `../assets/stickers/studio-${item.visual.asset}.png` : null;
  const stickerMotif = (item) => ["stars", "sparkles", "stripes"].includes(item?.visual?.motif) ? item.visual.motif : "plain";
  const stickerPreviews = new Map();
  // One bounded painter serves the book, creator preview, room chat and PNG.
  // Only fixed shapes, allowlisted glyphs and validated hex colors are drawn.
  function paintSticker(canvas, item, edge) {
    const ctx = canvas.getContext?.("2d"); if (!ctx) return false;
    canvas.width = edge; canvas.height = edge; ctx.scale(edge / 512, edge / 512);
    const primary = cleanColor(item?.visual?.primary), secondary = cleanColor(item?.visual?.secondary, "#172039");
    const motif = stickerMotif(item);
    ctx.beginPath(); ctx.roundRect(0, 0, 512, 512, 116); ctx.fillStyle = secondary; ctx.fill();
    ctx.save(); ctx.clip(); ctx.globalAlpha = 0.28; ctx.fillStyle = primary; ctx.strokeStyle = primary;
    if (motif === "stripes") {
      ctx.lineWidth = 24; ctx.beginPath();
      for (let offset = -512; offset <= 512; offset += 128) { ctx.moveTo(offset, 0); ctx.lineTo(offset + 512, 512); }
      ctx.stroke();
    } else if (motif !== "plain") {
      const points = motif === "stars" ? 5 : 4, inner = motif === "stars" ? 10 : 5;
      for (let row = 0; row < 4; row += 1) for (let col = 0; col < 4; col += 1) {
        ctx.beginPath();
        for (let point = 0; point < points * 2; point += 1) {
          const angle = -Math.PI / 2 + point * Math.PI / points, radius = point % 2 ? inner : 26;
          const x = 64 + col * 128 + Math.cos(angle) * radius, y = 64 + row * 128 + Math.sin(angle) * radius;
          if (!point) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore(); ctx.fillStyle = primary; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 330px sans-serif"; ctx.fillText(stickerGlyph(item), 256, 256);
    return true;
  }
  function stickerPreview(item) {
    // A full room book may repeat many instances of the same artwork. Retain
    // only 64 small encoded previews, never a canvas per visible instance.
    const key = JSON.stringify([stickerGlyph(item), cleanColor(item?.visual?.primary), cleanColor(item?.visual?.secondary, "#172039"), stickerMotif(item)]);
    if (stickerPreviews.has(key)) { const source = stickerPreviews.get(key); stickerPreviews.delete(key); stickerPreviews.set(key, source); return source; }
    const canvas = node("canvas"); if (!paintSticker(canvas, item, 96)) return null;
    const source = canvas.toDataURL("image/png"); stickerPreviews.set(key, source);
    if (stickerPreviews.size > 64) stickerPreviews.delete(stickerPreviews.keys().next().value);
    return source;
  }
  function renderSticker(item) {
    const art = node("span", "collectibles-sticker", stickerGlyph(item));
    art.style.color = cleanColor(item?.visual?.primary);
    art.style.backgroundColor = cleanColor(item?.visual?.secondary, "#172039");
    art.dataset.rarity = RARITIES.includes(item?.rarity) ? item.rarity : "none";
    art.setAttribute("role", "img"); art.setAttribute("aria-label", item?.name || "Sticker");
    const source = stickerSource(item) || stickerPreview(item);
    if (source) { const image = node("img"); image.src = source; image.alt = item?.name || "Sticker"; image.loading = "lazy"; art.replaceChildren(image); }
    return art;
  }
  function downloadSticker(item) {
    let source = stickerSource(item);
    if (!source) {
      const canvas = document.createElement("canvas"); if (!paintSticker(canvas, item, 512)) return;
      source = canvas.toDataURL("image/png");
    }
    const link = node("a"); link.href = source; link.download = `${String(item?.name || "sticker").replace(/[^a-z0-9_-]/gi, "-").slice(0, 50)}.png`; document.body.append(link); link.click(); link.remove();
  }
  const motionOff = () => document.documentElement?.dataset?.motion === "off" || document.documentElement?.dataset?.motion === "calm" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  function field(label, input) { const wrap = node("label", "collectibles-field"); wrap.append(node("span", "", label), input); return wrap; }
  function input(type, value = "", min = null, max = null) {
    const el = node("input"); el.type = type; el.value = String(value);
    if (min != null) el.min = String(min); if (max != null) el.max = String(max);
    if (type === "number") el.step = "1";
    return el;
  }
  function select(entries, value) {
    const el = node("select");
    for (const entry of entries) { const [id, label] = Array.isArray(entry) ? entry : [entry, word(entry)]; const option = node("option", "", label); option.value = id; el.append(option); }
    el.value = value ?? (Array.isArray(entries[0]) ? entries[0][0] : entries[0]); return el;
  }
  function title(name, line) { const box = node("div", "collectibles-section-head"); box.append(node("h3", "", name), node("p", "collectibles-note", line)); return box; }
  function empty(name, line) { const box = node("div", "collectibles-empty"); box.append(node("strong", "", name), node("p", "collectibles-note", line)); return box; }
  function stamp(item) {
    const rarity = rarityOf(item.rarity), el = node("span", "collectibles-rarity");
    const dot = node("span", "collectibles-rarity-dot"); dot.style.backgroundColor = cleanColor(rarity.color, "#a7afbd"); dot.setAttribute("aria-hidden", "true");
    el.append(dot, document.createTextNode(rarity.name)); return el;
  }
  function tradeWords(item) {
    if (item.bound) return "Base sticker · stays in your book";
    if (item.listingId) return "Listed in the market";
    if (item.tradeHoldUntil > Date.now()) return `Trade hold until ${new Date(item.tradeHoldUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return "Ready to trade";
  }
  function preview(item) {
    const art = node("div", "collectibles-art"); art.dataset.rarity = RARITIES.includes(item.rarity) ? item.rarity : "none";
    if (item.kind === "sticker") art.append(renderSticker(item));
    else {
      const canvas = node("canvas", "collectibles-pet-canvas"); canvas.width = 360; canvas.height = 200;
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${item.name}, ${item.stage || "baby"} pet`);
      art.append(canvas);
      // Static previews cost no idle animation loop. The opened pet lives on the desktop.
      try { window.MefiPets?.paintPreview?.(canvas, { ...item, time: 0 }); } catch { /* unavailable in browser preview */ }
    }
    return art;
  }
  function itemCard(item) {
    const card = node("article", "collectibles-item"); card.dataset.instance = item.id || "";
    const words = node("div", "collectibles-item-words"); words.append(stamp(item), node("h4", "", item.name), node("p", "collectibles-note", item.blurb || (item.kind === "pet" ? "A little companion with a story of its own." : "A collectible mark for your conversations.")));
    card.append(preview(item), words); return { card, words };
  }
  function open(view = "collection") { requestedView = VIEWS.some(([id]) => id === view) ? view : "collection"; window.MefiShop?.open?.("collectibles"); for (const listener of listeners) listener(requestedView); }
  function card() {
    let view = requestedView, gone = false, busy = false, loaded = false, revealTimer = null;
    let crateKind = "all", topic = "studio";
    const inventoryShown = { pet: 40, sticker: 60 };
    const root = node("section", "collectibles"); root.setAttribute("aria-label", "Pets and collectibles");
    const hero = node("div", "collectibles-hero"); const intro = node("div");
    intro.append(node("p", "collectibles-eyebrow", "COLLECT · CARE · SHARE"), node("h2", "", "Small companions. Big personalities."), node("p", "collectibles-note", "Bring home a baby pet, grow together, and pass its story on. Collect stickers and trade with friends using credits earned in the community."));
    const balance = node("div", "collectibles-wallet"); hero.append(intro, balance);
    const tabs = node("div", "collectibles-tabs"); tabs.setAttribute("aria-label", "Collectible views");
    for (const [id, label] of VIEWS) { const tab = btn(label, () => { view = id; requestedView = id; confirmation.hidden = true; paint(); }); tab.dataset.view = id; tabs.append(tab); }
    const status = node("p", "collectibles-status", "Loading your collection…"); status.setAttribute("role", "status");
    const body = node("div", "collectibles-body"); const confirmation = node("div", "collectibles-confirm"); confirmation.hidden = true;
    const reveal = node("dialog", "collectibles-reveal"); reveal.setAttribute("aria-label", "Your crate rewards");
    root.append(hero, tabs, status, confirmation, body, reveal);
    const say = (message) => { status.textContent = message; };
    const dynamic = window.MefiDynamicCrates?.create?.({
      ui: { node, btn, field, input, select, title, empty, credits, chanceText }, call,
      context: () => ({ enabled: connectionReady && dynamicCratesAvailable, account: accountId, identity: identityEpoch }),
      changed: () => paint(), message: say, errorWords,
      refreshOwned: async () => {
        const refreshIdentity = identityEpoch;
        epoch += 1; if (readFlight) await readFlight;
        if (refreshIdentity !== identityEpoch) return false;
        const freshShop = async () => {
          if (typeof window.MefiShop?.refresh !== "function") return { ok: false };
          // Shop.refresh can return a read that began before the grant, while
          // queuing another internally. Drain it, then await a post-grant read.
          try { await window.MefiShop.refresh(); } catch { /* the fresh read below decides success */ }
          if (refreshIdentity !== identityEpoch) return { ok: false };
          return window.MefiShop.refresh();
        };
        const results = await Promise.allSettled([refresh(), freshShop()]);
        return results.every((entry) => entry.status === "fulfilled" && entry.value?.ok);
      },
      reveal: (rewards) => { if (!gone && view === "crates") showRewards(rewards, true); },
    });
    const focusRestore = (active) => { if (active?.dataset?.focus) body.querySelector(`[data-focus="${active.dataset.focus}"]`)?.focus?.(); };
    function ask(message, label, run) {
      confirmation.hidden = false; confirmation.replaceChildren(node("p", "", message), btn(label, async () => { if (busy) return; confirmation.hidden = true; await run(); }, true), btn("Cancel", () => { confirmation.hidden = true; }));
      confirmation.querySelector("button")?.focus?.();
    }
    async function act(action, payload, success, after = null) {
      if (busy || gone) return null;
      const actionIdentity = identityEpoch, actionView = view;
      busy = true; root.setAttribute("aria-busy", "true"); say("Saving with the community service…");
      let answer;
      try {
        answer = await call(action, payload);
        if (gone || actionIdentity !== identityEpoch) return answer;
        if (answer?.ok) { epoch += 1; if (readFlight) await readFlight; await refresh(); if (!gone && actionIdentity === identityEpoch) { say(success); if (view === actionView) after?.(answer); } }
        else { say(errorWords(answer)); if (["price-changed", "pool-changed", "not-owner", "not-found", "trade-hold"].includes(answer?.error)) await refresh(); }
      } finally { busy = false; root.removeAttribute("aria-busy"); }
      return answer;
    }
    function controls(item, { sticker = false } = {}) {
      const box = node("div", "collectibles-controls");
      box.append(node("p", "collectibles-note", tradeWords(item)));
      const row = node("div", "collectibles-actions");
      if (!sticker) {
        const using = window.MefiPets?.state?.()?.chosen?.instanceId === item.id;
        row.append(btn(using ? "Return to Ember" : "Keep me company", () => { window.MefiPets?.equip?.(using ? null : item); paint(); }, !using));
        const care = select([["play", "Play · playful"], ["explore", "Explore · curious"], ["rest", "Rest · gentle"]], "play");
        const careButton = btn(item.caredToday ? "Cared for today" : "Care today", () => act("care", { instanceId: item.id, action: care.value }, "Care saved. Your pet carries its traits wherever it goes."));
        careButton.disabled = Boolean(item.listingId || item.caredToday); row.append(field("Time together", care), careButton);
        const sizes = item.unlockedSizes || ["tiny"];
        const size = select(sizes, item.size || "tiny"); size.disabled = Boolean(item.listingId);
        size.addEventListener("change", () => act("updateInstance", { instanceId: item.id, size: size.value }, "Pet size updated."));
        row.append(field("Unlocked sizes", size));
      }
      box.append(row);
      if (!item.listingId && !item.bound) {
        const trade = node("details", "collectibles-fold"); trade.append(node("summary", "", "Trade or sell"));
        const recipient = input("text"); recipient.placeholder = "Discord user ID"; recipient.maxLength = 24;
        const send = btn("Review transfer", () => {
          const userId = recipient.value.trim();
          if (!/^\d{5,24}$/.test(userId)) { say("Enter the recipient's Discord user ID."); return; }
          ask(`Transfer ${item.name} to member ${userId}? Ownership, growth and traits move with it. ${item.rarity === "none" ? "15-minute" : "One-hour"} hold after the transfer.`, "Transfer this item", () => act("transfer", { instanceId: item.id, userId }, "Item transferred. Its story goes with it."));
        }); send.disabled = item.tradeHoldUntil > Date.now();
        trade.append(field("Send to a friend", recipient), send);
        const price = input("number", 20, 1, 250);
        const sell = btn("Review listing", () => {
          const amount = Number(price.value);
          if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250) { say("Choose a whole-number price from 1 to 250 earned credits."); return; }
          ask(`List ${item.name} for ${credits(amount)}? A matching automatic order can buy it immediately.`, "List for sale", () => act("listItem", { instanceId: item.id, price: amount }, "Listing saved."));
        });
        sell.disabled = !state?.entitlements?.canSell || item.tradeHoldUntil > Date.now();
        trade.append(field("Price in earned credits", price), sell);
        if (!state?.entitlements?.canSell) trade.append(node("p", "collectibles-note", "Current and past supporters can sell. Everyone can collect and trade."));
        box.append(trade);
      }
      return box;
    }
    function collection(stickers = false) {
      const section = node("section"); section.append(title(stickers ? "Your sticker book" : "The nursery", stickers ? "Owned stickers are yours to use in chat. Room sharing lasts only while the owner stays in the room; downloading a visual does not transfer ownership." : "Every pet begins as a baby. Age and daily care unlock new stages and sizes. Play, explore or rest to give it traits that travel with it."));
      const items = (state?.inventory || []).filter((item) => item.kind === (stickers ? "sticker" : "pet"));
      if (!items.length) { section.append(empty(stickers ? "Your first page is waiting" : "A little friend is waiting", "Open your free welcome crate to begin, or find a companion in the market."), btn("Browse crates", () => { view = "crates"; paint(); })); return section; }
      const grid = node("div", "collectibles-grid");
      const itemKind = stickers ? "sticker" : "pet";
      for (const item of items.slice(0, inventoryShown[itemKind])) {
        const { card: itemEl, words } = itemCard(item);
        if (!stickers) {
          words.append(node("p", "collectibles-growth", `${word(item.growth?.stage || item.stage || "baby")} · ${item.careDays ?? item.growth?.careDays ?? 0} days cared for`));
          const traits = node("div", "collectibles-traits"); for (const trait of item.traits || []) traits.append(node("span", "collectibles-trait", trait.name || word(trait.id))); words.append(traits);
          if (item.growth?.nextStageDays) words.append(node("p", "collectibles-note", `Next stage from day ${item.growth.nextStageDays}, with regular care.`));
        } else words.append(node("p", "collectibles-note", item.bound ? "Your free sticker. Use it in Friends chat; its base design stays in your book." : "Use the sticker button in a Friends chat to send or share this sticker."), btn("Download image", () => { downloadSticker(item); say("Image downloaded. Ownership stays with you."); }));
        words.append(controls(item, { sticker: stickers })); grid.append(itemEl);
      }
      section.append(grid);
      if (items.length > inventoryShown[itemKind]) section.append(btn(`Show more ${stickers ? "stickers" : "pets"} (${items.length - inventoryShown[itemKind]} more)`, () => { inventoryShown[itemKind] += 60; paint(); }));
      return section;
    }
    function showRewards(items, typed = false) {
      clearTimeout(revealTimer); reveal.replaceChildren(); reveal.dataset.phase = motionOff() ? "revealed" : "opening";
      const heading = node("h3", "", "A new chapter for your collection");
      const opening = node("div", "collectibles-opening", "✦"); opening.setAttribute("aria-hidden", "true");
      const rewards = node("div", "collectibles-grid");
      for (const reward of items || []) {
        const item = typed ? reward.item : reward;
        if (!typed || reward.type === "collectible") {
          const { card: itemEl, words } = itemCard(item); words.append(node("p", "collectibles-note", item.kind === "pet" ? "Born today. Ready to grow with you." : "A new page in your sticker book.")); rewards.append(itemEl);
        } else if (["catalog-license", "community-pack-license"].includes(reward.type)) {
          const itemEl = node("article", "collectibles-item"), words = node("div", "collectibles-item-words");
          words.append(node("span", "collectibles-rarity", "Shop license"), node("h4", "", item.name), node("p", "collectibles-note", reward.type === "community-pack-license" ? "A community pack for your Studio. This license stays with your account." : "A new look for your Studio. Open Owned in the Shop to apply it."), btn("Open Shop ownership", () => { reveal.close?.(); window.MefiShop?.open?.("owned"); }));
          itemEl.append(words); rewards.append(itemEl);
        }
      }
      const revealNow = () => { clearTimeout(revealTimer); reveal.dataset.phase = "revealed"; skip.hidden = true; done.focus?.(); };
      const skip = btn("Skip animation", revealNow); skip.hidden = motionOff();
      const done = btn("Add to my day", () => { reveal.close?.(); view = "collection"; paint(); }, true);
      reveal.append(heading, opening, rewards, skip, done); reveal.showModal?.();
      if (!motionOff()) revealTimer = setTimeout(revealNow, 950); else done.focus?.();
    }
    function crates() {
      const section = node("section"); section.append(title("Choose your next surprise", "One opening, real published odds, earned credits only. The animation never changes the result. The welcome crate is free once per account."));
      const filters = node("div", "collectibles-filters");
      const kind = select([["all", "All rewards"], ["pet", "Pets"], ["sticker", "Stickers"]], crateKind);
      const source = select([["studio", "Studio originals"], ["community", "Community creations"]], topic);
      kind.addEventListener("change", () => { crateKind = kind.value; paint(); }); source.addEventListener("change", () => { topic = source.value; paint(); });
      filters.append(field("Reward type", kind), field("Collection", source)); section.append(filters);
      const grid = node("div", "collectibles-grid");
      const available = (state?.crates || []).filter((crate) => (topic === "community" ? crate.requiresOptIn : !crate.requiresOptIn) && (crateKind === "all" || crate.kind === crateKind || crate.kind === "mixed" || crate.kind === "any"));
      for (const crate of available) {
        const cardEl = node("article", "collectibles-crate"); cardEl.append(node("div", "collectibles-crate-mark", crate.requiresOptIn ? "✧" : "✦"), node("h4", "", crate.name), node("p", "", `${crate.count} ${crate.count === 1 ? "reward" : "rewards"} · ${crate.price === 0 ? "Free" : credits(crate.price)}`));
        const odds = node("dl", "collectibles-odds");
        for (const entry of crate.odds || []) { odds.append(node("dt", "", rarityOf(entry.rarity).name), node("dd", "", chanceText(entry.chance))); }
        cardEl.append(odds);
        let consent = null;
        if (crate.requiresOptIn) { consent = input("checkbox"); consent.checked = false; const opt = node("label", "collectibles-optin"); opt.append(consent, node("span", "", "Include this community pool. I have reviewed the current odds and price.")); cardEl.append(opt); }
        const openButton = btn(crate.price === 0 ? "Open free welcome crate" : `Review opening · ${credits(crate.price)}`, () => {
          if (consent && !consent.checked) { say("Opt in to the current community pool before opening it."); return; }
          ask(`Open ${crate.name} for ${credits(crate.price)} and receive ${crate.count} random ${crate.count === 1 ? "item" : "items"}? The odds above apply to this opening.`, crate.price === 0 ? "Open free crate" : `Spend ${credits(crate.price)}`, async () => {
            const key = acquisitionKey("crate", crate.id, crate.price, crate.poolVersion);
            const payload = acquisition(key, { crateId: crate.id, price: crate.price, ...(crate.poolVersion ? { poolVersion: crate.poolVersion } : {}), ...(crate.requiresOptIn ? { communityOptIn: true } : {}) });
            const answer = await act("open", payload, "Your rewards are in your collection.", (reply) => showRewards(reply.items || []));
            if (answer?.ok || ["pool-changed", "price-changed"].includes(answer?.error)) pendingAcquisitions.delete(key);
          });
        }, true);
        if (crate.available === false || crate.claimed === true) { openButton.disabled = true; openButton.textContent = crate.claimed ? "Already claimed" : "No eligible items yet"; }
        cardEl.append(openButton); grid.append(cardEl);
      }
      section.append(available.length ? grid : empty("No matching crate right now", "Try another reward type or collection. Community pools need eligible creators to opt their work in."));
      if (dynamic) section.append(dynamic.crates()); return section;
    }
    function market() {
      const section = node("section"); section.append(title("The community market", "Find a look you love, or leave one order for a match. Original items have a 15-minute trade hold after transfer; every rarity tier has a one-hour hold. Growth and traits stay with the pet."));
      const listings = node("div", "collectibles-grid");
      for (const listing of state?.listings || []) {
        const item = listing.item || {}; const { card: itemEl, words } = itemCard(item);
        words.append(node("p", "", `${credits(listing.price)} · ${listing.sellerName || "Community member"}`));
        const owned = (state.inventory || []).some((entry) => entry.id === listing.instanceId);
        words.append(owned ? btn("Unlist", () => act("cancelListing", { listingId: listing.id }, "Item returned to your collection.")) : btn("Review purchase", () => ask(`Buy ${item.name} for ${credits(listing.price)}? Its ${item.rarity === "none" ? "15-minute" : "one-hour"} trade hold starts on purchase.`, `Buy · ${credits(listing.price)}`, () => act("buy", { listingId: listing.id, price: listing.price }, "Purchased. Your collection has been updated.")), true));
        listings.append(itemEl);
      }
      section.append(listings.children.length ? listings : empty("The market has room to grow", "List an eligible item from your collection, or save a matching order below."));
      if (state?.marketNext) section.append(btn("Load more listings", async () => {
        if (busy || gone) return;
        const before = state, identity = identityEpoch, cursor = state.marketNext;
        busy = true; say("Reading more listings…");
        try {
          const answer = await call("market", { cursor });
          if (gone || identity !== identityEpoch || before !== state) return;
          if (!answer?.ok) { say(errorWords(answer)); return; }
          const combined = new Map((state.listings || []).map((entry) => [entry.id, entry]));
          for (const entry of answer.listings || []) combined.set(entry.id, entry);
          state.listings = [...combined.values()]; state.marketNext = answer.next || null;
          say("More listings loaded."); paint();
        } finally { busy = false; }
      }));
      const order = node("div", "collectibles-order"); order.append(title("Find my next favorite", "Orders do not reserve credits. Auto buy checks your balance when it finds one matching item at or below your maximum. Notify leaves your credits untouched."));
      const kind = select(["pet", "sticker"], "pet"), minimum = select(RARITIES, "none"), maximum = select(RARITIES, "legendary"), price = input("number", 25, 1, 250), mode = select([["notify", "Notify me"], ["auto", "Auto buy one item"]], "notify");
      const definitions = select([["", "Any design"], ...(state.catalog || []).map((entry) => [entry.id, entry.name])], "");
      const form = node("div", "collectibles-filters"); form.append(field("Kind", kind), field("Design", definitions), field("Minimum rarity", minimum), field("Maximum rarity", maximum), field("Maximum credits", price), field("When a match appears", mode)); order.append(form);
      order.append(btn("Review order", () => {
        if (RARITIES.indexOf(minimum.value) > RARITIES.indexOf(maximum.value)) { say("Minimum rarity cannot be above maximum rarity."); return; }
        const payload = { kind: kind.value, minRarity: minimum.value, maxRarity: maximum.value, maxPrice: Number(price.value), mode: mode.value, ...(definitions.value ? { definitionId: definitions.value } : {}) };
        ask(mode.value === "auto" ? `Automatically buy one matching ${kind.value} for up to ${credits(payload.maxPrice)}? No credits are reserved; your balance is checked when the order fills. It may fill immediately.` : `Notify you when a ${kind.value} in your rarity range is listed for up to ${credits(payload.maxPrice)}?`, mode.value === "auto" ? "Create auto-buy order" : "Create notification", () => act("order", payload, "Order saved."));
      }, true)); section.append(order);
      for (const entry of state?.orders || []) { const row = node("div", "collectibles-market-row"); row.append(node("span", "", `${entry.mode === "auto" ? "Auto buy" : "Notify"} · ${entry.kind} · ${word(entry.minRarity)}–${word(entry.maxRarity)} · up to ${credits(entry.maxPrice)} · ${entry.status || "open"}`)); if (!entry.status || entry.status === "open") row.append(btn("Cancel order", () => act("cancelOrder", { orderId: entry.id }, "Order cancelled."))); section.append(row); }
      for (const notice of state?.notifications || []) section.append(node("p", "collectibles-notification", `Match found: ${notice.itemName} · ${credits(notice.price)}. Check current listings above.`));
      const designs = (state?.catalog || []).filter((entry) => entry.listed && entry.maker);
      if (designs.length) {
        section.append(title("Creator originals", "Buy a new copy of a community creation. Its published rarity chances determine its finish."));
        const grid = node("div", "collectibles-grid");
        for (const design of designs) {
          const { card: el, words } = itemCard({ ...design, rarity: "none" });
          words.append(node("p", "collectibles-note", Object.entries(design.rarityWeights || {}).filter(([, weight]) => weight > 0).map(([rarity, weight]) => `${rarityOf(rarity).name} ${weight / 100}%`).join(" · ")));
          words.append(btn(`Review · ${credits(design.price)}`, () => ask(`Get a new ${design.name} for ${credits(design.price)}? Its finish follows the chances shown on its card.`, `Get · ${credits(design.price)}`, async () => {
            const key = acquisitionKey("design", design.id, design.price);
            const payload = acquisition(key, { definitionId: design.id, price: design.price });
            const result = await act("buyCreation", payload, "Your creator original is in your collection.", (reply) => showRewards([reply.item]));
            if (result?.ok || result?.error === "price-changed") pendingAcquisitions.delete(key);
          }), true)); grid.append(el);
        }
        section.append(grid);
      }
      if (state?.catalogNext) section.append(btn("Load more creator designs", async () => {
        if (busy || gone) return;
        const before = state, identity = identityEpoch, cursor = state.catalogNext;
        busy = true; say("Reading more creator designs…");
        try {
          const answer = await call("catalog", { cursor });
          if (gone || identity !== identityEpoch || before !== state) return;
          if (!answer?.ok) { say(errorWords(answer)); return; }
          const combined = new Map((state.catalog || []).map((entry) => [entry.id, entry]));
          for (const entry of answer.catalog || []) combined.set(entry.id, entry);
          state.catalog = [...combined.values()]; state.catalogNext = answer.next || null;
          say("More creator designs loaded."); paint();
        } finally { busy = false; }
      }));
      return section;
    }
    function creator() {
      const section = node("section"); section.append(title("Give your imagination a home", "Active membership lets you create pets and stickers and choose their rarity chances. Price, visuals and rarity chances are permanently locked when created. Past members keep their existing rarity items and trading rights, and can list or take down their designs."));
      section.append(btn("View membership", () => window.MefiShop?.open?.("membership")));
      const allowed = state?.entitlements?.canCreate === true;
      if (!allowed) section.append(empty("Creation needs active membership", "Paid, lifetime and unexpired intro membership provide the same creator benefits. Your existing collection and free community participation stay available."));
      else {
        const editor = node("div", "collectibles-editor");
        const kind = select(["pet", "sticker"], "pet"), name = input("text", "My little companion"), blurb = input("text"), bodyChoice = select(["dragon", "cloud", "phoenix", "wisp"], "dragon"), glyph = select(Object.entries(GLYPHS).map(([id, value]) => [id, `${value} ${word(id)}`]), "star"), primary = input("color", "#8b7cf6"), secondary = input("color", "#73d6cf"), motif = select(["plain", "stars", "sparkles", "stripes"], "stars"), price = input("number", 0, 0, 250);
        name.maxLength = 40; blurb.maxLength = 160;
        const form = node("div", "collectibles-filters"); form.append(field("Create a", kind), field("Name", name), field("About it", blurb), field("Pet shape", bodyChoice), field("Sticker symbol", glyph), field("Main color", primary), field("Second color", secondary), field("Visual finish", motif), field("Price in earned credits", price));
        const live = node("div", "collectibles-creator-preview");
        const paintDraft = () => { live.replaceChildren(preview({ kind: kind.value, name: name.value, rarity: "none", stage: "baby", visual: { body: bodyChoice.value, glyph: glyph.value, primary: primary.value, secondary: secondary.value, motif: motif.value } })); };
        for (const control of [kind, name, bodyChoice, glyph, primary, secondary, motif]) control.addEventListener("input", paintDraft);
        paintDraft(); editor.append(form, live);
        const odds = node("div", "collectibles-filters"); const weights = new Map();
        for (const rarity of RARITIES) { const chance = input("number", rarity === "none" ? 100 : 0, 0, 100); chance.step = "0.01"; chance.disabled = !state.entitlements.canSetRarity && rarity !== "none"; weights.set(rarity, chance); odds.append(field(`${rarityOf(rarity).name} %`, chance)); }
        editor.append(title("Publish the chances", "Use 100% Original, or percentages totaling 100% with Common at least 50%, Rare at most 20%, Epic at most 5%, and Legendary at most 1%. Rarity designs cost at least 10 earned credits."), odds);
        const preset = btn("Use community rarity chances", () => { for (const [rarity, value] of Object.entries({ none: 0, common: 60, uncommon: 26, rare: 10, epic: 3.5, legendary: 0.5 })) weights.get(rarity).value = String(value); if (Number(price.value) < 10) price.value = "10"; }); preset.disabled = !state.entitlements.canSetRarity; editor.append(preset);
        const listed = input("checkbox"); listed.checked = true;
        const listedLabel = node("label", "collectibles-optin"); listedLabel.append(listed, node("span", "", "List in the community shop.")); editor.append(listedLabel);
        const inCrates = input("checkbox"); inCrates.checked = false;
        const cratesLabel = node("label", "collectibles-optin"); cratesLabel.append(inCrates, node("span", "", "Permanently allow this design in opt-in community crates while listed. The crate's credits are split across rewards and creators receive their share.")); editor.append(cratesLabel);
        editor.append(btn("Review creation", () => {
          if ([...weights.values()].some((chance) => { const value = Number(chance.value); return !Number.isFinite(value) || value < 0 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001; })) { say("Each rarity chance must be from 0 to 100%, with at most two decimal places."); return; }
          const rarityWeights = Object.fromEntries([...weights].map(([rarity, chance]) => [rarity, Math.round(Number(chance.value) * 100)]).filter(([, weight]) => weight > 0));
          if (Object.values(rarityWeights).reduce((sum, weight) => sum + weight, 0) !== 10000) { say("Rarity percentages must total exactly 100%."); return; }
          if (rarityWeights.none && rarityWeights.none !== 10000) { say("Choose 100% Original, or divide 100% among the rarity tiers. Original cannot be mixed with rarity rolls."); return; }
          if (!rarityWeights.none && (Number(price.value) < 10 || (rarityWeights.common || 0) < 5000 || (rarityWeights.rare || 0) > 2000 || (rarityWeights.epic || 0) > 500 || (rarityWeights.legendary || 0) > 100)) { say(ERRORS["rarity-limits"]); return; }
          if (name.value.trim().length < 2) { say("Give your creation a name of at least two characters."); return; }
          const payload = { kind: kind.value, name: name.value.trim(), blurb: blurb.value.trim(), visual: { body: bodyChoice.value, glyph: glyph.value, primary: primary.value, secondary: secondary.value, motif: motif.value }, rarityWeights, price: Number(price.value), listed: listed.checked, inCrates: inCrates.checked };
          const chances = Object.entries(rarityWeights).map(([rarity, weight]) => `${rarityOf(rarity).name} ${weight / 100}%`).join(", ");
          ask(`Create ${payload.name}${payload.listed ? " and publish it" : " privately"}? Permanent price: ${credits(payload.price)}. Permanent chances: ${chances}. Community crate permission: ${payload.inCrates ? "yes, while listed" : "no"}. Price, visuals, chances and crate permission cannot be changed later. To own a copy, you pay the same price and receive the same roll as everyone else.`, "Create with these permanent terms", () => act("create", payload, "Design saved. Get a copy from Creator originals in the market at its published price and chances."));
        }, true)); section.append(editor);
      }
      section.append(title("Your published designs", "Taking a design down stops new copies. Everyone who already owns one keeps it."));
      for (const definition of state?.creations || []) { const row = node("div", "collectibles-market-row"); row.append(node("span", "", `${definition.name} · ${credits(definition.price)} · ${definition.listed ? "Listed" : "Unlisted"}`), btn(definition.listed ? "Take down" : "List again", () => act("updateCreation", { definitionId: definition.id, listed: !definition.listed }, definition.listed ? "Design unlisted. Existing copies remain owned." : "Design listed again."))); section.append(row); }
      if (dynamic) section.append(dynamic.contributions());
      return section;
    }
    function paint(nextView = null) {
      if (gone) return;
      if (typeof nextView === "string") { view = nextView; confirmation.hidden = true; }
      const active = document.activeElement;
      balance.textContent = state ? `${credits(state.balance)}\nEarned, never bought` : "Earned credits only";
      for (const tab of tabs.children) { tab.setAttribute("aria-pressed", String(tab.dataset.view === view)); }
      if (!state) { confirmation.hidden = true; body.replaceChildren(empty(loaded ? "Connect to your collection" : "Getting your collection ready", "Your inventory, credits and trading rights are verified by the community service."), btn("Try again", () => void load()), btn("Open Friends", () => window.MefiNav?.go?.("friends-page")) ); return; }
      const content = view === "collection" ? collection() : view === "stickers" ? collection(true) : view === "crates" ? crates() : view === "market" ? market() : creator();
      body.replaceChildren(content); focusRestore(active);
    }
    async function load() {
      const before = identityEpoch, beforeStatus = statusEpoch;
      if (typeof window.mefiStudio?.hubStatus === "function") {
        try {
          const hub = (await window.mefiStudio.hubStatus())?.status;
          if (gone || before !== identityEpoch) return;
          if (beforeStatus === statusEpoch) {
            dynamicCratesAvailable = hub?.state === "ready" && hub?.collectibles === true && hub?.dynamicCrates === true;
            if (hub?.state === "ready" && hub.user?.id) accountId = hub.user.id;
          }
        } catch { if (beforeStatus === statusEpoch) dynamicCratesAvailable = false; }
      }
      const answer = await refresh(); if (gone || answer?.error === "stale") return; loaded = true; say(answer?.ok ? "" : errorWords(answer)); paint();
    }
    listeners.add(paint); cards.add(root);
    root.dispose = () => { gone = true; dynamic?.dispose(); listeners.delete(paint); cards.delete(root); clearTimeout(revealTimer); reveal.close?.(); };
    paint(); void load(); return root;
  }
  window.MefiCollectibles = { card, open, refresh, snapshot: () => clone(state), stickerGlyph, renderSticker, stickers: (roomId) => call("stickers", { roomId }), share: (instanceId, roomId, shared) => call("share", { instanceId, roomId, shared }), errorWords };
  function invalidate() { epoch += 1; dirty = true; if (connectionReady && interested()) void refresh(); }
  window.mefiStudio?.onHubEvent?.((event) => {
    if (event?.type === "status") {
      statusEpoch += 1;
      connectionReady = event.status?.state === "ready";
      dynamicCratesAvailable = connectionReady && event.status?.collectibles === true && event.status?.dynamicCrates === true;
      const nextAccount = event.status?.user?.id || null;
      if (!connectionReady || (accountId && nextAccount !== accountId)) {
        epoch += 1; identityEpoch += 1; state = null; dirty = false;
        if (accountId && nextAccount && nextAccount !== accountId) pendingAcquisitions.clear();
        window.MefiPets?.suspendCollectible?.();
        for (const listener of listeners) listener();
      }
      if (nextAccount) accountId = nextAccount;
      if (connectionReady && (interested() || dirty)) invalidate();
    } else if (event?.type === "credits" || event?.type === "collectibles") invalidate();
  });
  document.addEventListener?.("visibilitychange", () => { if (dirty && connectionReady && interested()) void refresh(); });
  const restore = () => { if (window.MefiPets?.state?.()?.chosen?.instanceId) void refresh(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore, { once: true });
  else Promise.resolve().then(restore);
})();
