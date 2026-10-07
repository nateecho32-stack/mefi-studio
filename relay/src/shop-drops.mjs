// The Shop's monthly drops and its weekly Featured shelf (relay/src/shop.mjs
// serves both; main.cjs keeps a mirror for the signed-out showroom, and
// tests/shop_host.test.mjs holds the two equal; docs/shop-drops.md says how
// the owner adds a drop).
//
// A drop is a collection of Studio's own items on sale for a while: from
// `from` (inclusive) until `until` (exclusive), both UTC ISO times, usually a
// calendar month. A catalog item that names a drop (`drop: "2026-10"`) is
// hidden before that drop starts, on sale while it runs and rotated out after
// it: not listed and not for sale, while everyone who got it keeps it for
// good. A later drop may bring an item back (its `returning` list names it),
// and it is on sale again for that drop's month. An item with no drop is
// classic: always on sale.
//
// The Featured shelf is four classic items, the same for everyone, picked
// from the ISO week (a seeded shuffle of the classic ids), new every Monday
// 00:00 UTC.

const DAY = 86_400_000;

/** A drop's id: its year and month. */
export const DROP_ID = /^\d{4}-(?:0[1-9]|1[0-2])$/;
/** A drop's times: UTC, to the second (a fraction allowed), always with the Z. */
export const DROP_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const COLOUR = /^#[0-9a-f]{6}$/;
// One line: no CR, LF or Unicode line or paragraph separator.
const SINGLE_LINE = new RegExp(`^[^\r\n${String.fromCharCode(0x2028, 0x2029)}]*$`);
export const DROP_LIMITS = Object.freeze({ nameMin: 2, nameMax: 40, blurbMax: 160, returningMax: 24 });
/** The colours a drop's banner is made from. */
export const DROP_COLOURS = Object.freeze(['accent', 'accent2', 'background']);
/** How many classic items the Featured shelf shows. */
export const FEATURED_COUNT = 4;

const drop = ({ id, name, blurb, from, until, colors, returning = [] }) =>
  Object.freeze({ id, name, blurb, from, until, colors: Object.freeze({ ...colors }), returning: Object.freeze([...returning]) });

/**
 * The drops, oldest first; they never overlap. Add next month's at the end (docs/shop-drops.md): a theme (a Studio style
 * pack) needs nothing but its catalog entry; a pet, an effect or a node style needs its code in a Studio release first,
 * and stays hidden until its drop starts.
 */
export const DROPS = Object.freeze([
  drop({
    id: '2026-10',
    name: 'Haunted Hollow',
    blurb: 'Pumpkins, lanterns and friendly spirits for October.',
    from: '2026-10-01T00:00:00Z',
    until: '2026-11-01T00:00:00Z',
    colors: { accent: '#ff8a3d', accent2: '#9b6bff', background: '#140d1c' },
  }),
]);

const time = (iso) => Date.parse(iso);

/** The windows an item is on sale in, oldest first: its own drop's, then each drop that brings it back. A classic item has none. */
export function windowsOf(item, drops = DROPS) {
  if (!item?.drop) return [];
  return drops
    .filter((entry) => entry.id === item.drop || entry.returning.includes(item.id))
    .map((entry) => ({ drop: entry.id, from: entry.from, until: entry.until }))
    .sort((a, b) => time(a.from) - time(b.from));
}

/**
 * Where an item stands at `now` (ms): { classic, released, available, leaves, current }. `released`: its first window has
 * started (an item is never shown before that); `available`: on sale now; `leaves`: when the window it is on sale in
 * ends (ISO), for a drop's item; `current`: that window's drop.
 */
export function saleOf(item, now, drops = DROPS) {
  if (!item?.drop) return { classic: true, released: true, available: true, leaves: null, current: null };
  const windows = windowsOf(item, drops);
  const open = windows.find((entry) => time(entry.from) <= now && now < time(entry.until)) ?? null;
  return { classic: false, released: windows.some((entry) => time(entry.from) <= now), available: Boolean(open), leaves: open?.until ?? null, current: open?.drop ?? null };
}

const dropView = (entry) => ({ id: entry.id, name: entry.name, blurb: entry.blurb, from: entry.from, until: entry.until, colors: { ...entry.colors } });

/**
 * The drop on sale at `now` (with the ids of the items on sale in it: its own and the ones it brings back), the next
 * dated one as a teaser (no items: they stay hidden until it starts) and the last that ended. Each a view or null.
 */
export function dropsAt(now, drops = DROPS, catalog = []) {
  const sorted = [...drops].sort((a, b) => time(a.from) - time(b.from));
  const current = sorted.find((entry) => time(entry.from) <= now && now < time(entry.until)) ?? null;
  const next = sorted.find((entry) => time(entry.from) > now) ?? null;
  const last = sorted.filter((entry) => time(entry.until) <= now).at(-1) ?? null;
  return {
    current: current ? { ...dropView(current), items: catalog.filter((item) => saleOf(item, now, drops).current === current.id).map((item) => item.id) } : null,
    next: next ? dropView(next) : null,
    last: last ? dropView(last) : null,
  };
}

/** The ISO 8601 week of a time: weeks start on Monday, and week 1 is the one with the year's first Thursday. */
export function isoWeek(now) {
  const date = new Date(now);
  const day = (date.getUTCDay() + 6) % 7;
  const thursday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  return { year, week: 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY)) };
}

// mulberry32: a small seeded generator, so every relay (and main.cjs's mirror) shuffles a week the same way.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The week's Featured shelf: { items: [ids], until (ISO, the next Monday 00:00 UTC) }, classic items only. */
export function featuredAt(catalog, now, count = FEATURED_COUNT) {
  const { year, week } = isoWeek(now);
  const random = seeded(year * 100 + week);
  const ids = catalog.filter((item) => !item.drop).map((item) => item.id).sort();
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [ids[index], ids[other]] = [ids[other], ids[index]];
  }
  const date = new Date(now);
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 7);
  return { items: ids.slice(0, count), until: new Date(monday).toISOString() };
}

/**
 * What is wrong with a list of drops, as sentences (an empty list when nothing is): ids, names, times and colours in
 * shape, oldest first with no overlaps, every catalog item's drop known, and every returning item a drop item whose
 * own drop ended before it returns.
 */
export function checkDrops(drops = DROPS, catalog = []) {
  const problems = [];
  const ids = new Set();
  drops.forEach((entry, index) => {
    const name = `drop ${entry?.id ?? index}`;
    if (!DROP_ID.test(String(entry?.id ?? ''))) problems.push(`${name}: the id is YYYY-MM`);
    if (ids.has(entry?.id)) problems.push(`${name}: the id is used twice`);
    ids.add(entry?.id);
    const title = String(entry?.name ?? '').trim();
    if (title.length < DROP_LIMITS.nameMin || title.length > DROP_LIMITS.nameMax || !SINGLE_LINE.test(title)) problems.push(`${name}: a name of ${DROP_LIMITS.nameMin} to ${DROP_LIMITS.nameMax} characters on one line`);
    if (typeof entry?.blurb !== 'string' || entry.blurb.length > DROP_LIMITS.blurbMax || !SINGLE_LINE.test(entry.blurb)) problems.push(`${name}: a line of at most ${DROP_LIMITS.blurbMax} characters`);
    if (!DROP_TIME.test(String(entry?.from)) || !DROP_TIME.test(String(entry?.until)) || !(time(entry.from) < time(entry.until))) problems.push(`${name}: from and until are UTC ISO times, from first`);
    for (const key of DROP_COLOURS) if (!COLOUR.test(String(entry?.colors?.[key] ?? ''))) problems.push(`${name}: colors.${key} is #rrggbb in lower case`);
    if (Object.keys(entry?.colors ?? {}).some((key) => !DROP_COLOURS.includes(key))) problems.push(`${name}: colors holds ${DROP_COLOURS.join(', ')} only`);
    const before = drops[index - 1];
    if (before && !(time(before.from) < time(entry.from))) problems.push(`${name}: drops are listed oldest first`);
    if (before && time(before.until) > time(entry.from)) problems.push(`${name}: it starts before ${before.id} ends`);
    const returning = Array.isArray(entry?.returning) ? entry.returning : null;
    if (!returning || returning.length > DROP_LIMITS.returningMax || new Set(returning).size !== returning.length) problems.push(`${name}: returning is a list of up to ${DROP_LIMITS.returningMax} different item ids`);
    for (const id of returning ?? []) {
      const item = catalog.find((candidate) => candidate.id === id);
      if (!item) { problems.push(`${name}: ${id} is not in the catalog`); continue; }
      const home = drops.find((candidate) => candidate.id === item.drop);
      if (!item.drop) problems.push(`${name}: ${id} is a classic item, on sale already`);
      else if (!home) problems.push(`${name}: ${id}'s own drop ${item.drop} is not listed`);
      else if (!(time(home.until) <= time(entry.from))) problems.push(`${name}: ${id} returns before its own drop ${home.id} has ended`);
    }
  });
  for (const item of catalog) {
    if (item.drop != null && !ids.has(item.drop)) problems.push(`${item.id}: its drop ${item.drop} is not listed`);
  }
  return problems;
}
