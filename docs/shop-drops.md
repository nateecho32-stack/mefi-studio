# Shop drops: a new collection every month

The Shop (Friends › Shop, its own page) sells Studio's own items for the
credits members earn, never for money. Most of them are **classic**: always
on sale. Every month a **drop** brings a small collection of new ones (a pet,
a menu effect, a node style, a few themes) that is on sale for that month
and then **rotates out**: it is no longer listed or sold, and everyone who got
it keeps it for good. A later drop may bring an item back.

This page is for whoever adds next month's drop. The short version: add one
entry to `DROPS`, tag the new items with the drop's id, mirror both in
`main.cjs`, and run two test suites.

## Where it lives

| What | File | Kept equal by |
| --- | --- | --- |
| The drops | `relay/src/shop-drops.mjs` `DROPS` | `tests/shop_host.test.mjs` (the mirror) and `tests/relay_shop_drops.test.mjs` (the shape) |
| Studio's items | `relay/src/shop.mjs` `CATALOG` | `tests/shop_host.test.mjs` |
| The mirrors (the signed-out showroom) | `main.cjs` `SHOP_DROPS` and `SHOP_STUDIO_ITEMS` | `tests/shop_host.test.mjs` |
| The rules | `relay/src/shop-drops.mjs` (`saleOf`, `dropsAt`, `featuredAt`), and the same in `main.cjs` (`shopSaleOf`, `shopDropsAt`, `shopFeaturedAt`) | `tests/shop_host.test.mjs` runs both on the same items and times |

## Add a monthly drop

1. **Add the drop** at the end of `DROPS` in `relay/src/shop-drops.mjs`
   (drops are listed oldest first and never overlap):

   ```js
   drop({
     id: '2026-11',                    // the year and month, YYYY-MM
     name: 'Frost Fair',               // 2 to 40 characters, one line
     blurb: 'Ice lanterns and a winter market.', // up to 160 characters, one line
     from: '2026-11-01T00:00:00Z',     // UTC; on sale from this moment
     until: '2026-12-01T00:00:00Z',    // UTC; rotated out at this moment
     colors: { accent: '#7fd3ff', accent2: '#c3a6ff', background: '#0b1622' }, // lower-case #rrggbb
     returning: [],                    // earlier drop items this drop brings back
   }),
   ```

   The Shop's banner is made from the drop's own data, so a new month needs no
   new art: a gradient and a soft pattern from `colors`, its name, how long it
   has left, and its items shown live inside it. Pick a `background` dark
   enough for light text (or light enough for dark text); Studio chooses the
   text colour that reads at 4.5:1 on it.

2. **Tag the new items** in `CATALOG` (`relay/src/shop.mjs`) with
   `drop: '2026-11'`:

   ```js
   studioItem('studio:pack-frost-fair', 'pack', 'Frost Fair', 50, 'Ice blue on midnight.', {
     data: studioPack({ accent: '#7fd3ff', accent2: '#c3a6ff', background: '#0b1622', surface: '#132233', text: '#e8f4ff', nodeStyle: 'glass', material: 'studio', font: 'studio' }),
     drop: '2026-11',
   }),
   ```

   - **Themes** (Studio's style packs) are data only. The relay serves them,
     and every Studio that is signed in can show, try and use one without an
     app update. The pack must pass the same checks as a member's
     (`relay/src/shop-pack.mjs`: text and accent at 4.5:1).
   - **Pets, menu effects and node styles** are drawn by Studio's own code
     (`renderer/pets.js`, `renderer/effects.js`, `renderer/node-styles.js`
     with `renderer/music.js`), so that code must ship in a Studio release
     **before** the drop starts. Until its drop starts an item is hidden
     everywhere. A Studio that is too old to show it says "Comes with the next
     Studio update." on its card instead of offering it.

3. **Mirror both in `main.cjs`**: the drop in `SHOP_DROPS` (the same fields,
   `returning` included) and each new item in `SHOP_STUDIO_ITEMS` (its `id`,
   `kind`, `name`, `price`, `blurb`, `drop` and, for a theme, `data`). This is
   what Studio shows while signed out or offline, so a theme added only on the
   relay shows signed-in until the next Studio release carries the mirror.

4. **Bring an item back** (optional): put its id in the new drop's
   `returning`. It is on sale again for that drop's month, with the same price.
   Only an item of an earlier drop that has already ended can return; a
   classic item is on sale anyway.

5. **Check it**:

   ```
   npm run test:one -- tests/relay_shop_drops.test.mjs tests/shop_host.test.mjs tests/relay_shop.test.mjs
   ```

   `checkDrops` names anything out of shape: an id that is not YYYY-MM, a
   drop listed out of order or overlapping the one before, times that are not
   UTC ISO, colours that are not lower-case `#rrggbb`, an item whose drop is
   not listed, or a returning item that is not in the catalog or whose own
   drop has not ended. `shop_host` fails if `main.cjs` and the relay disagree.

6. **Deploy the relay** (`relay/README.md`) before the drop's `from`. A drop
   listed early is safe: its items stay hidden until it starts, and Studio
   shows it only as a teaser ("Next: Frost Fair, from 1 November").

## The Featured shelf

Every ISO week (Monday 00:00 UTC) the Shop features four classic items, the
same for everyone: a seeded shuffle of the classic ids, seeded with the year
and week (`featuredAt`). Nothing to do: adding or removing a classic item
changes the picks from then on.

## The contract

What the relay sends (feature `shop.drops` in its `ready` frame) and Studio
reads:

| Where | Field | Meaning |
| --- | --- | --- |
| A drop (`DROPS`) | `id` | `YYYY-MM` |
| | `name`, `blurb` | 2 to 40 characters; up to 160 |
| | `from`, `until` | UTC ISO times; on sale from `from`, rotated out at `until` |
| | `colors.accent`, `colors.accent2`, `colors.background` | the banner's colours, lower-case `#rrggbb` |
| | `returning` | ids of earlier drop items this drop brings back |
| A catalog item | `drop` | the drop it comes out in; none (null) for a classic item |
| Every item `GET /v1/shop` lists | `drop` | as above (a member's pack: null) |
| | `available` | on sale now (a member's pack: listed) |
| | `leaves` | for a drop item on sale, when its drop ends (UTC ISO); else null |
| Every `GET /v1/shop` answer | `drops.current` | the drop on sale now, with `items` (the ids on sale in it), or null |
| | `drops.next` | the next dated drop, a teaser without items, or null |
| | `drops.last` | the last drop that ended, or null |
| | `featured`, `featuredUntil` | the week's four classic ids, and when they change (UTC ISO) |
| `POST /v1/shop/:id/buy` | `not-available` (409, with `drop`) | the item's drop has rotated out or has not started |

The Studio list (`view=studio`) holds only what is on sale now. The owned
list keeps everything a member got, rotated out or not (`available: false`).
An older Studio keeps working against a relay with drops: it ignores the new
fields, never sees a rotated-out item listed, and says a `not-available`
refusal in its general words.
