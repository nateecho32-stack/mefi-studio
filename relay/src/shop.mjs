// The Shop: new things for Studio that members get with credits, and style
// packs members make for each other.
//
// Two kinds of item. Studio's own (CATALOG below, ids "studio:<slug>"):
// scales for Ember (the dragon that flies around every Studio, free and built
// in), menu effects, two node styles and three style packs, defined here in
// code and shown by Studio by id. And community
// packs: a member's own style pack, data only (shop-pack.mjs checks it: a few
// colours and keys from Studio's lists, never CSS, links or images), free or
// priced from 10 to 250 credits. Everything free in Studio today stays free:
// the Shop sells new things only.
//
// Credits are earned, never bought, and never cashed out; the Shop is where
// they are spent. Buying is one transaction: the item, the price the member
// was shown and their balance are checked, the credits come off the balance,
// and the member owns the item from then on, on every PC (GET /v1/shop/owned).
// A purchase is kept as a shop_owned row, never as a negative credit row
// (several sums over credit_events do not look at the sign). A free pack is a
// Get: owned, and no credits move. A member may add a tip of up to 100
// credits to a community pack, free ones too (never to Studio's own items,
// which have nobody to thank): it is paid with the price, in the same
// transaction.
//
// What a Studio item costs leaves the economy. A community pack's maker earns
// 75% of what the buyer paid (the price and any tip) through credits.sale():
// both must be in good standing, one buyer is worth at most 100 credits to
// one maker in 7 days, and a maker earns at most 300 a day from sales; the
// rest is nobody's. So moving credits between two accounts through the Shop,
// tips included, loses at least a quarter of them every time, and soon pays
// nothing at all.
//
// Makers: 12 listed packs at most, 4 published a day, 2000 in the whole
// Shop, and a name once among a maker's listed packs. Publishing a pack, free
// or priced, needs a member in good standing (credits.mjs standing()), and a
// pack's sales, which its "Top" list ranks by, count only buyers in good
// standing: brand-new second accounts can neither fill the Shop nor push a
// pack up the list. Unlisting keeps a pack
// for the members who own it, with its newest data. A moderator's removal (a
// report resolved with "remove", or POST /v1/admin/shop/:id/remove) takes it
// from everyone for good. Forget me removes the member's packs, with nothing
// of theirs left in them, and what they owned.
//
// Studio's items rotate (shop-drops.mjs, feature "shop.drops"): an item that
// names a monthly drop is listed and sold only while that drop (or a later
// one that brings it back) runs, and refused as "not-available" after it;
// everyone who got it keeps it. Every item says so (`drop`, `available`,
// `leaves`), and each list carries the drops (the current one with its items,
// the next as a teaser, the last that ended) and the week's Featured shelf.

import { DROPS, dropsAt, featuredAt, saleOf } from './shop-drops.mjs';
import { PACK_LIMITS, checkPack } from './shop-pack.mjs';
import { DAY_MS, HOUR_MS, cleanLine, keyedBuckets, newId } from './util.mjs';

export const SHOP = Object.freeze({
  pageSize: 30, // community packs in one page of a list
  priceMin: 10, // a priced pack; 0 is free
  priceMax: 250,
  makerShare: 0.75, // of what a community pack's buyer paid, before the sale caps (credits.mjs EARN.sale, GUARD.salePairWeek)
  tipMax: 100, // a tip for a community pack's maker (protocol.mjs shopBuy says the same)
  listedPerMaker: 12,
  publishesPerDay: 4, // new packs and packs listed again, per maker
  listedTotal: 2000,
  reportsPerHour: 10,
  removedKeepMs: 30 * DAY_MS, // a removed pack's row, and the rows that owned it, then go
});

export const SHOP_VIEWS = Object.freeze(['studio', 'new', 'top', 'owned', 'mine']);
export const ITEM_KINDS = Object.freeze(['pet', 'skin', 'effect', 'nodestyle', 'pack']);
export const PACK_STATUSES = Object.freeze(['listed', 'unlisted', 'removed']);
/** A Studio item's id; a community pack's is the relay's own id (newId('pack')). */
export const STUDIO_ITEM = /^studio:[a-z0-9-]{1,40}$/;
export const PACK_ID = /^pack_[A-Za-z0-9_-]{16}$/;
/** The buy route's :id, which may be a Studio item's ("studio:skin-frost") as well as a pack's. */
export const ITEM_PARAM = 'studio:[a-z0-9-]{1,40}|[A-Za-z0-9_-]{1,64}';

// When the catalog's items were last changed: Studio compares it with what it keeps.
const CATALOG_AT = Date.UTC(2026, 9, 6);
// `drop`: the monthly drop an item comes out in (shop-drops.mjs DROPS); none for a classic item, always on sale.
const studioItem = (id, kind, name, price, blurb, { requires = null, data = null, drop = null } = {}) => Object.freeze({ id, kind, name, price, requires, blurb, data, drop, at: CATALOG_AT });
const studioPack = ({ accent, accent2, background, surface, text, nodeStyle, material, font }) =>
  Object.freeze({ v: 1, palette: Object.freeze({ accent, background, surface, text, accent2 }), nodeStyle, material, font });

/**
 * Studio's own items. Studio knows how to show each one by its id; the packs carry their data, as members' do.
 * Ember the dragon is free in every Studio, so it is not sold here and its scales need nothing first. An item may
 * still name another it needs (`requires`, refused as "needs" until that one is owned); none does today. An item of a
 * monthly drop says so (`drop: '2026-10'`); main.cjs SHOP_STUDIO_ITEMS mirrors this list (tests/shop_host.test.mjs).
 */
export const CATALOG = Object.freeze([
  studioItem('studio:skin-frost', 'skin', 'Frost scales', 40, 'Ember in icy blue.'),
  studioItem('studio:skin-jade', 'skin', 'Jade scales', 40, 'Ember in green and gold.'),
  studioItem('studio:skin-void', 'skin', 'Void scales', 60, 'Ember in black with a violet glow.'),
  studioItem('studio:skin-gold', 'skin', 'Gold scales', 60, 'Ember in shining gold.'),
  studioItem('studio:pet-cloud', 'pet', 'Cloud dragon', 120, 'A long, wingless dragon that swims through the air in waves.'),
  studioItem('studio:pet-phoenix', 'pet', 'Phoenix', 150, 'A firebird with a long, flowing tail of flame feathers.'),
  studioItem('studio:pet-wisp', 'pet', 'Will-o\'-wisp', 90, 'A small ghostly flame that trails drifting sparks.', { drop: '2026-10' }),
  studioItem('studio:fx-dissolve', 'effect', 'Dissolve', 60, 'Menus crumble into pixels when they close.'),
  studioItem('studio:fx-embers', 'effect', 'Burn away', 90, 'Menus burn away from the edges with glowing embers.'),
  studioItem('studio:fx-stardust', 'effect', 'Stardust', 90, 'Menus scatter into drifting stars.'),
  studioItem('studio:fx-wind', 'effect', 'Blown away', 60, 'Menus drift aside like sand in the wind.'),
  studioItem('studio:fx-shatter', 'effect', 'Shatter', 90, 'Menus crack like glass and fall away in shards.'),
  studioItem('studio:fx-glitch', 'effect', 'Glitch', 60, 'Menus tear into flickering slices and blink out.'),
  studioItem('studio:fx-spirits', 'effect', 'Spirits', 90, 'Menus fade into ghostly wisps that rise and curl away.', { drop: '2026-10' }),
  studioItem('studio:style-dragonscale', 'nodestyle', 'Dragon scales', 80, 'Nodes covered in shimmering dragon scales, with ember sparks along the wires.'),
  studioItem('studio:style-constellation', 'nodestyle', 'Star chart', 80, 'Nodes as bright stars joined by star-chart lines, with shooting stars.'),
  studioItem('studio:style-lantern', 'nodestyle', 'Lanterns', 80, 'Glowing paper lanterns that sway, their warm light flickering at work.', { drop: '2026-10' }),
  studioItem('studio:style-neon', 'nodestyle', 'Neon', 80, 'Bright neon tubes with a soft glow that buzz on when work starts.'),
  studioItem('studio:pack-synthwave', 'pack', 'Synthwave', 50, 'Hot pink and violet on midnight blue.', {
    data: studioPack({ accent: '#ff4fa3', accent2: '#8b5cff', background: '#0d0b1f', surface: '#17132e', text: '#f3ecff', nodeStyle: 'halo', material: 'atmosphere', font: 'display' }),
  }),
  studioItem('studio:pack-deep-sea', 'pack', 'Deep sea', 50, 'Teal light on deep ocean blue.', {
    data: studioPack({ accent: '#2fd6c3', accent2: '#3a7bff', background: '#04131c', surface: '#0a2230', text: '#e2f6f7', nodeStyle: 'glass', material: 'studio', font: 'studio' }),
  }),
  studioItem('studio:pack-sakura', 'pack', 'Sakura (light)', 50, 'Soft pink on warm white, a light look.', {
    data: studioPack({ accent: '#b8325f', accent2: '#8a6bd1', background: '#fbf6f4', surface: '#ffffff', text: '#2b1f24', nodeStyle: 'minimal', material: 'focus', font: 'studio' }),
  }),
  studioItem('studio:pack-pumpkin-spice', 'pack', 'Pumpkin Spice', 45, 'Warm pumpkin orange and spiced gold on deep brown.', {
    data: studioPack({ accent: '#ff8a3d', accent2: '#d4a245', background: '#1b100a', surface: '#2a1a10', text: '#fbeedd', nodeStyle: 'orbs', material: 'studio', font: 'serif' }), drop: '2026-10',
  }),
  studioItem('studio:pack-haunted', 'pack', 'Haunted', 50, 'Violet and ghostly green glowing on near-black.', {
    data: studioPack({ accent: '#b48cff', accent2: '#6ef2b0', background: '#09080e', surface: '#15121c', text: '#ebe6f4', nodeStyle: 'sigil', material: 'atmosphere', font: 'display' }), drop: '2026-10',
  }),
  studioItem('studio:pack-candlelight', 'pack', 'Candlelight (light)', 45, 'Warm cream lit by amber candlelight, a light look.', {
    data: studioPack({ accent: '#a05a00', accent2: '#b0442a', background: '#fbf3e2', surface: '#fffaf0', text: '#2f2418', nodeStyle: 'halo', material: 'focus', font: 'serif' }), drop: '2026-10',
  }),
  studioItem('studio:pack-midnight-neon', 'pack', 'Midnight Neon', 50, 'Electric cyan and magenta on midnight navy.', {
    data: studioPack({ accent: '#2fe4ff', accent2: '#ff3fb1', background: '#06071a', surface: '#10122b', text: '#eef0ff', nodeStyle: 'singularity', material: 'atmosphere', font: 'mono' }),
  }),
  studioItem('studio:pack-forest-glade', 'pack', 'Forest Glade', 40, 'Sunlit fern green and gold on deep forest.', {
    data: studioPack({ accent: '#a5d46a', accent2: '#e3c262', background: '#0b1510', surface: '#14231a', text: '#e7f2e3', nodeStyle: 'glass', material: 'studio', font: 'studio' }),
  }),
  studioItem('studio:pack-ocean-breeze', 'pack', 'Ocean Breeze (light)', 40, 'Sea blue and coral on a breezy white, a light look.', {
    data: studioPack({ accent: '#0a6a86', accent2: '#c2502f', background: '#edf6f8', surface: '#ffffff', text: '#11303a', nodeStyle: 'minimal', material: 'focus', font: 'studio' }),
  }),
  studioItem('studio:pack-rose-gold', 'pack', 'Rose Gold (light)', 45, 'Rose and soft gold on blush cream, a light look.', {
    data: studioPack({ accent: '#a24b59', accent2: '#9a7224', background: '#f9efea', surface: '#fffaf7', text: '#3b2328', nodeStyle: 'prism', material: 'studio', font: 'serif' }),
  }),
  studioItem('studio:pack-frost', 'pack', 'Frost', 40, 'Icy blue and pale lilac on cool slate grey.', {
    data: studioPack({ accent: '#a7dcf3', accent2: '#c7cfff', background: '#1d2731', surface: '#27323e', text: '#e9f0f6', nodeStyle: 'crystal', material: 'atmosphere', font: 'display' }),
  }),
]);

const isPackId = (value) => typeof value === 'string' && PACK_ID.test(value);

/**
 * createShop({ store, now, credits, catalog, drops })
 *   credits: createCredits(...) (account, standing, heldUntil, spend, sale, tell)
 *   catalog: Studio's items, CATALOG unless a test gives its own
 *   drops: the monthly drops, shop-drops.mjs DROPS unless a test gives its own
 * -> { routes(route), remove(packId, modId, reason), forget(uid), upkeep(), owns(uid, itemId) }
 */
export function createShop({ store, now, credits, catalog = CATALOG, drops = DROPS }) {
  const studioItems = new Map(catalog.map((item) => [item.id, item]));
  const publishes = keyedBuckets({ capacity: SHOP.publishesPerDay, refillPerSec: SHOP.publishesPerDay / (DAY_MS / 1000), now });
  const reportTaps = keyedBuckets({ capacity: SHOP.reportsPerHour, refillPerSec: SHOP.reportsPerHour / (HOUR_MS / 1000), now });
  const count = (sql, ...args) => Number(store.get(sql, ...args)?.n ?? 0);
  const nameOf = (uid) => store.get('SELECT name FROM members WHERE user_id = ?', uid)?.name ?? 'member';
  const packRow = (id) => (isPackId(id) ? store.get('SELECT * FROM shop_packs WHERE id = ?', id) : undefined);
  const hasRow = (uid, itemId) => Boolean(store.get('SELECT 1 AS yes FROM shop_owned WHERE user_id = ? AND item_id = ?', uid, itemId));
  /** Whether a member owns an item (pets.mjs asks about a pet's skin): a Studio item they got, or a pack still served. */
  function owns(uid, itemId) {
    if (!isPackId(itemId)) return hasRow(uid, itemId);
    const pack = packRow(itemId);
    return Boolean(pack) && pack.status !== 'removed' && (pack.maker_id === uid || hasRow(uid, itemId));
  }

  /** The ids a member owns: what they got in the Shop (a removed pack left out) and their own packs. */
  function ownedIds(uid) {
    const ids = new Set();
    for (const row of store.all(`SELECT o.item_id FROM shop_owned o LEFT JOIN shop_packs p ON p.id = o.item_id WHERE o.user_id = ? AND (p.id IS NULL OR p.status <> 'removed')`, uid)) ids.add(row.item_id);
    for (const row of store.all(`SELECT id FROM shop_packs WHERE maker_id = ? AND status <> 'removed'`, uid)) ids.add(row.id);
    return ids;
  }

  /** How many members own each Studio item. */
  const studioSales = () => new Map(store.all(`SELECT item_id, COUNT(*) AS n FROM shop_owned WHERE item_id LIKE 'studio:%' GROUP BY item_id`).map((row) => [row.item_id, Number(row.n)]));

  // A Studio item with its place in the rotation: its drop, whether it is on sale now and, for a drop's item, when it leaves.
  function studioView(item, owned, sales, at = now()) {
    const sale = saleOf(item, at, drops);
    return {
      id: item.id, kind: item.kind, name: item.name, blurb: item.blurb, price: item.price, requires: item.requires, maker: null,
      data: item.data, sales: sales.get(item.id) ?? 0, owned: owned.has(item.id), status: 'listed', createdAt: item.at, updatedAt: item.at,
      drop: item.drop ?? null, available: sale.available, leaves: sale.leaves,
    };
  }

  function packView(row, owned) {
    return {
      id: row.id, kind: 'pack', name: row.name, blurb: row.blurb, price: row.price, requires: null,
      maker: row.maker_id ? { id: row.maker_id, name: nameOf(row.maker_id) } : null,
      data: JSON.parse(row.data), sales: row.sales, owned: owned.has(row.id), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      drop: null, available: row.status === 'listed', leaves: null,
    };
  }

  /** Everything a member owns, newest first: Studio items and packs they got, and their own packs. */
  function ownedList(uid) {
    const owned = ownedIds(uid);
    const sales = studioSales();
    const out = [];
    for (const row of store.all('SELECT item_id, at FROM shop_owned WHERE user_id = ?', uid)) {
      const item = studioItems.get(row.item_id);
      const pack = item ? null : packRow(row.item_id);
      if (item) out.push({ at: row.at, view: studioView(item, owned, sales) });
      else if (pack && pack.status !== 'removed') out.push({ at: row.at, view: packView(pack, owned) });
    }
    for (const pack of store.all(`SELECT * FROM shop_packs WHERE maker_id = ? AND status <> 'removed'`, uid)) out.push({ at: pack.created_at, view: packView(pack, owned) });
    return out.sort((x, y) => y.at - x.at || (x.view.id < y.view.id ? -1 : 1)).map((entry) => entry.view);
  }

  // A page's cursor is where the next page starts. Studio only hands it back, so it may change shape later.
  const cursorAt = (value) => (/^\d{1,4}$/.test(String(value ?? '')) ? Math.min(Number(value), SHOP.listedTotal) : 0);
  const nextAfter = (offset, more) => (more ? String(offset + SHOP.pageSize) : null);

  /** Whether a maker's listed packs already use this name, upper or lower case alike (`except`: the pack being renamed). */
  const nameTaken = (uid, name, except = null) => store.all(`SELECT id, name FROM shop_packs WHERE maker_id = ? AND status = 'listed'`, uid).some((row) => row.id !== except && row.name.toLowerCase() === name.toLowerCase());

  /**
   * A pack's fields from a request, each one it names cleaned and checked: the name 2-40 characters on one line,
   * the price 0 or 10-250, the data through checkPack(). -> { fields } | { error }
   */
  function readFields(body, fail) {
    const fields = {};
    if (body.name !== undefined) {
      fields.name = cleanLine(body.name, PACK_LIMITS.nameMax);
      if (fields.name.length < PACK_LIMITS.nameMin) return { error: fail(400, 'bad-request', { reason: 'name' }) };
    }
    if (body.blurb !== undefined) fields.blurb = cleanLine(body.blurb, PACK_LIMITS.blurbMax);
    if (body.price !== undefined) {
      if (body.price !== 0 && (body.price < SHOP.priceMin || body.price > SHOP.priceMax)) return { error: fail(400, 'bad-request', { reason: 'price' }) };
      fields.price = body.price;
    }
    if (body.data !== undefined) {
      const checked = checkPack(body.data);
      if (!checked.ok) return { error: fail(400, checked.error) };
      fields.data = checked.pack;
    }
    return { fields };
  }

  /** Room for one more listed pack: the maker's 12, the Shop's 2000, and the name free among the maker's listed. */
  function roomToList(uid, name, fail) {
    if (count(`SELECT COUNT(*) AS n FROM shop_packs WHERE maker_id = ? AND status = 'listed'`, uid) >= SHOP.listedPerMaker) return fail(409, 'limit', { reason: 'listed-packs' });
    if (count(`SELECT COUNT(*) AS n FROM shop_packs WHERE status = 'listed'`) >= SHOP.listedTotal) return fail(409, 'limit', { reason: 'shop-full' });
    if (nameTaken(uid, name)) return fail(409, 'conflict', { reason: 'name-taken' });
    return null;
  }

  /** One of the maker's four publishes a day, taken only once everything else allows it, so a refusal costs none. */
  function takePublish(uid, fail) {
    const rate = publishes.take(uid);
    return rate.ok ? null : fail(429, 'rate-limited', { retryAfter: rate.retryAfterMs });
  }

  /**
   * A moderator takes a pack off for good: it is never served again, so its owners lose it too; its open reports are
   * resolved and the removal is audited. Safe to run twice. -> false when there is no such pack.
   */
  function remove(packId, modId, reason = null) {
    const at = now();
    return store.transaction(() => {
      const row = packRow(packId);
      if (!row) return false;
      if (row.status !== 'removed') {
        store.run(`UPDATE shop_packs SET status = 'removed', updated_at = ? WHERE id = ?`, at, row.id);
        store.run('INSERT INTO audit (kind, actor_id, target_id, detail, at) VALUES (?, ?, ?, ?, ?)', 'shop-remove', modId, row.maker_id || null, JSON.stringify({ packId: row.id, ...(reason ? { reason } : {}) }), at);
      }
      store.run(`UPDATE reports SET status = 'resolved' WHERE room_id = 'shop' AND message_id = ? AND status = 'open'`, row.id);
      return true;
    });
  }

  function routes(route) {
    const reply = (status, body) => ({ status, body });
    const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });
    const standingOf = async (uid) => credits.standing(uid, await credits.heldUntil(uid));

    // The Shop's lists: Studio's items on sale now, members' packs newest or best-selling first (30 a page), what this
    // member owns, and their own packs (unlisted ones too). With the balance and whether they may earn, as /v1/me says
    // it, and the rotation: the drops (current, next, last) and the week's Featured shelf.
    route('GET', '/v1/shop', async ({ actor, query }) => {
      const view = String(query?.get?.('view') ?? 'studio');
      if (!SHOP_VIEWS.includes(view)) return fail(400, 'bad-request', { reason: 'view' });
      const offset = cursorAt(query?.get?.('cursor'));
      const owned = ownedIds(actor.uid);
      const at = now();
      let items = [];
      let next = null;
      if (view === 'studio') {
        const sales = studioSales();
        // An item of a drop that has not started, or that has rotated out, is not listed.
        items = catalog.filter((item) => saleOf(item, at, drops).available).map((item) => studioView(item, owned, sales, at));
      } else if (view === 'owned') {
        const all = ownedList(actor.uid);
        items = all.slice(offset, offset + SHOP.pageSize);
        next = nextAfter(offset, all.length > offset + SHOP.pageSize);
      } else {
        const rows =
          view === 'mine'
            ? store.all(`SELECT * FROM shop_packs WHERE maker_id = ? AND status <> 'removed' ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, actor.uid, SHOP.pageSize + 1, offset)
            : store.all(`SELECT * FROM shop_packs WHERE status = 'listed' ORDER BY ${view === 'top' ? 'sales DESC, ' : ''}created_at DESC, id LIMIT ? OFFSET ?`, SHOP.pageSize + 1, offset);
        items = rows.slice(0, SHOP.pageSize).map((row) => packView(row, owned));
        next = nextAfter(offset, rows.length > SHOP.pageSize);
      }
      const stand = await standingOf(actor.uid);
      const featured = featuredAt(catalog, at);
      return reply(200, {
        ok: true, view, items, next, balance: credits.account(actor.uid).balance, canEarn: stand.ok, hold: stand.ok ? null : { reason: stand.reason, until: stand.until },
        drops: dropsAt(at, drops, catalog), featured: featured.items, featuredUntil: featured.until,
      });
    });

    // What a member owns, for a new PC to put back: removed packs left out, a pack's data always its newest.
    route('GET', '/v1/shop/owned', ({ actor }) => reply(200, { ok: true, items: ownedList(actor.uid).map(({ id, kind, name, data, updatedAt }) => ({ id, kind, name, data, updatedAt })) }));

    // Buying, or getting a free pack, with a tip for its maker if the member likes. Refusals say what Studio needs to
    // explain them: the item to get first (needs), the price now, the balance (and the tip that made it short), and a
    // Studio item whose drop has rotated out or not started (not-available, with its drop). The answer says what was
    // paid, the tip included.
    route(
      'POST',
      '/v1/shop/:id/buy',
      async ({ actor, params, body }) => {
        const item = studioItems.get(params.id) ?? null;
        const first = item ? null : packRow(params.id);
        if (!item && first?.status !== 'listed') return fail(404, 'gone');
        // A tip thanks a pack's maker: Studio's own items have nobody to thank.
        const tip = body.tip ?? 0;
        if (item && tip > 0) return fail(400, 'no-tip');
        // The holds are read first (heldUntil is async); the sale checks them inside the transaction.
        const buyerHeld = await credits.heldUntil(actor.uid);
        const makerHeld = first?.maker_id ? await credits.heldUntil(first.maker_id) : 0;
        const result = store.transaction(() => {
          const pack = item ? null : packRow(params.id);
          if (!item && pack?.status !== 'listed') return { error: fail(404, 'gone') };
          const price = item ? item.price : pack.price;
          if (pack && pack.maker_id === actor.uid) return { error: fail(409, 'own') };
          if (hasRow(actor.uid, params.id)) return { error: fail(409, 'owned') };
          if (item && !saleOf(item, now(), drops).available) return { error: fail(409, 'not-available', item.drop ? { drop: item.drop } : {}) };
          if (item?.requires && !hasRow(actor.uid, item.requires)) return { error: fail(409, 'needs', { needs: item.requires }) };
          if (body.price !== price) return { error: fail(409, 'price-changed', { price }) };
          const paid = price + tip;
          if (!credits.spend(actor.uid, paid)) return { error: fail(409, 'short', { balance: credits.account(actor.uid).balance, price, ...(tip ? { tip } : {}) }) };
          store.run('INSERT INTO shop_owned (user_id, item_id, price, at) VALUES (?, ?, ?, ?)', actor.uid, params.id, paid, now());
          if (!pack) return { paid, payout: 0, makerId: null };
          // A pack's sales rank it on "Top": only a buyer in good standing counts, so new second accounts cannot push it up.
          if (credits.standing(actor.uid, buyerHeld).ok) store.run('UPDATE shop_packs SET sales = sales + 1 WHERE id = ?', pack.id);
          // The maker's share of what was paid, a tip included; what the sale caps leave out is nobody's.
          const payout = paid > 0 ? credits.sale({ buyer: actor.uid, maker: pack.maker_id, itemId: pack.id, amount: Math.floor(paid * SHOP.makerShare), buyerHeld, makerHeld }) : 0;
          return { paid, payout, makerId: pack.maker_id };
        });
        if (result.error) return result.error;
        credits.tell(actor.uid, -result.paid, 'shop');
        if (result.makerId) credits.tell(result.makerId, result.payout, 'sale');
        const owned = ownedIds(actor.uid);
        return reply(200, { ok: true, item: item ? studioView(item, owned, studioSales()) : packView(packRow(params.id), owned), paid: result.paid, balance: credits.account(actor.uid).balance });
      },
      { write: true, body: 'shopBuy', param: ITEM_PARAM },
    );

    // Publishing a style pack, free or priced, needs a maker in good standing (credits.mjs standing()), so a second
    // account can neither sell before it could earn any other way nor fill the Shop with free packs.
    route(
      'POST',
      '/v1/shop/packs',
      async ({ actor, body }) => {
        const read = readFields(body, fail);
        if (read.error) return read.error;
        const { fields } = read;
        const stand = await standingOf(actor.uid);
        if (!stand.ok) return fail(403, 'hold', { hold: stand.reason, until: stand.until });
        const at = now();
        const result = store.transaction(() => {
          const full = roomToList(actor.uid, fields.name, fail);
          if (full) return { error: full };
          const rate = takePublish(actor.uid, fail);
          if (rate) return { error: rate };
          // The rate bucket forgets when the relay sleeps; the day's new packs in the store do not.
          if (count('SELECT COUNT(*) AS n FROM shop_packs WHERE maker_id = ? AND created_at > ?', actor.uid, at - DAY_MS) >= SHOP.publishesPerDay) return { error: fail(409, 'limit', { reason: 'daily-publishes' }) };
          const id = newId('pack');
          store.run(
            'INSERT INTO shop_packs (id, maker_id, name, blurb, price, data, status, sales, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
            id, actor.uid, fields.name, fields.blurb ?? '', fields.price, JSON.stringify(fields.data), 'listed', at, at,
          );
          return { id };
        });
        if (result.error) return result.error;
        return reply(201, { ok: true, pack: packView(packRow(result.id), ownedIds(actor.uid)) });
      },
      { write: true, body: 'shopPublish' },
    );

    // Changing a pack, by its maker: any of its fields, or listed (true puts an unlisted pack back on the Shop,
    // within the limits; false takes it off). Its owners always get the newest data.
    route(
      'PUT',
      '/v1/shop/packs/:id',
      async ({ actor, params, body }) => {
        const read = readFields(body, fail);
        if (read.error) return read.error;
        const { fields } = read;
        const first = packRow(params.id);
        if (!first || first.status === 'removed') return fail(404, 'not-found');
        if (first.maker_id !== actor.uid) return fail(403, 'forbidden');
        const relist = body.listed === true && first.status === 'unlisted';
        // A price set is selling, and listing a pack again is publishing: both need a maker in good standing, as
        // publishing does.
        if (relist || ((fields.price ?? first.price) > 0 && fields.price !== undefined)) {
          const stand = await standingOf(actor.uid);
          if (!stand.ok) return fail(403, 'hold', { hold: stand.reason, until: stand.until });
        }
        const result = store.transaction(() => {
          const row = packRow(params.id);
          if (!row || row.status === 'removed' || row.maker_id !== actor.uid) return { error: fail(404, 'not-found') };
          const name = fields.name ?? row.name;
          const status = body.listed === true ? 'listed' : body.listed === false ? 'unlisted' : row.status;
          if (status === 'listed' && row.status === 'listed' && nameTaken(actor.uid, name, row.id)) return { error: fail(409, 'conflict', { reason: 'name-taken' }) };
          // Listing it again counts as publishing: the same limits, and one of the day's four.
          if (status === 'listed' && row.status !== 'listed') {
            const full = roomToList(actor.uid, name, fail) ?? takePublish(actor.uid, fail);
            if (full) return { error: full };
          }
          store.run(
            'UPDATE shop_packs SET name = ?, blurb = ?, price = ?, data = ?, status = ?, updated_at = ? WHERE id = ?',
            name, fields.blurb ?? row.blurb, fields.price ?? row.price, fields.data ? JSON.stringify(fields.data) : row.data, status, now(), row.id,
          );
          return { id: row.id };
        });
        if (result.error) return result.error;
        return reply(200, { ok: true, pack: packView(packRow(result.id), ownedIds(actor.uid)) });
      },
      { write: true, body: 'shopUpdate' },
    );

    // Unlisting, by its maker: off the Shop's lists, kept for everyone who owns it.
    route(
      'DELETE',
      '/v1/shop/packs/:id',
      ({ actor, params }) => {
        const row = packRow(params.id);
        if (!row || row.status === 'removed') return fail(404, 'not-found');
        if (row.maker_id !== actor.uid) return fail(403, 'forbidden');
        if (row.status === 'listed') store.run(`UPDATE shop_packs SET status = 'unlisted', updated_at = ? WHERE id = ?`, now(), row.id);
        return reply(200, { ok: true, pack: packView(packRow(row.id), ownedIds(actor.uid)) });
      },
      { write: true, readOnlyOk: true },
    );

    // Reporting a pack (someone else's work, a hurtful name): it joins the moderators' report list as room "shop"
    // with the pack's id as its message, once per member, never your own.
    route(
      'POST',
      '/v1/shop/packs/:id/report',
      ({ actor, params, body }) => {
        const row = packRow(params.id);
        if (!row || row.status === 'removed') return fail(404, 'not-found');
        if (row.maker_id === actor.uid) return fail(403, 'forbidden', { reason: 'self' });
        const rate = reportTaps.take(actor.uid);
        if (!rate.ok) return fail(429, 'rate-limited', { retryAfter: rate.retryAfterMs });
        const said = typeof body.text === 'string' ? cleanLine(body.text, 300) : '';
        store.run(
          'INSERT INTO reports (id, room_id, message_id, author_id, reporter_id, reason, text, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (reporter_id, message_id) DO NOTHING',
          newId('rep'), 'shop', row.id, row.maker_id, actor.uid, body.reason, said ? `${row.name} · ${said}` : row.name, now(),
        );
        return reply(202, { ok: true });
      },
      { body: 'shopReport', readOnlyOk: true },
    );

    // Moderators: a pack off the Shop for good, its owners' copies too.
    route(
      'POST',
      '/v1/admin/shop/:id/remove',
      ({ actor, params, body }) => (remove(params.id, actor.uid, cleanLine(body.reason ?? '', 200) || null) ? reply(200, { ok: true }) : fail(404, 'not-found')),
      { mod: true, body: 'shopRemove' },
    );
  }

  /** Forget me: what the member owned, and their packs off the Shop for everyone, with nothing of theirs left in them. */
  function forget(uid) {
    store.run('DELETE FROM shop_owned WHERE user_id = ?', uid);
    store.run(`UPDATE shop_packs SET status = 'removed', maker_id = '', name = '', blurb = '', data = '{}', updated_at = ? WHERE maker_id = ?`, now(), uid);
  }

  /** Daily: a removed pack, and the rows that owned it, 30 days after it was removed. */
  function upkeep() {
    for (const row of store.all(`SELECT id FROM shop_packs WHERE status = 'removed' AND updated_at < ?`, now() - SHOP.removedKeepMs)) {
      store.run('DELETE FROM shop_owned WHERE item_id = ?', row.id);
      store.run('DELETE FROM shop_packs WHERE id = ?', row.id);
    }
  }

  return Object.freeze({ routes, remove, forget, upkeep, owns });
}
