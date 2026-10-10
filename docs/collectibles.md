# Pets and stickers: desktop client

Shop → **Pets & collectibles** contains the nursery, crate reveals, sticker
book, market and creator studio. This public change includes the desktop
interface, artwork, pet painter and API adapter. The collectible service is
private and is deployed separately. Publishing or installing this client
does not enable the service, create membership entitlements or grant items.

The connected service must advertise `collectibles.1` before the adapter
makes collectible requests. An older service returns an unavailable state;
the existing free Ember and ordinary Shop purchases keep working.
`MEFI_STUDIO_COLLECTIBLES=0` disables the desktop collectible API.

## What the interface supports

- Individual pets with Original, Common, Uncommon, Rare, Epic and Legendary
  finishes; baby, young and adult appearances; daily care, traits and unlocked
  display sizes. The service supplies the owned instance and its progress.
- Earned-credit crates with the quoted price and odds shown before opening,
  explicit community-pool consent, one skippable reveal and reduced-motion
  support. Purchase request IDs survive retries after a lost reply.
- Nine bundled Studio sticker designs: Idea, Rest, Celebrate, Code, Happy,
  Plan, Curious, Love and Sleep. The service supplies each member's free base
  copies. Downloading the picture does not grant or transfer an owned item.
- Room sticker selection, temporary sharing, and base-design claims. The
  service determines which finishes the member may use; a claim never asks
  the client to copy a rare instance.
- Listings and wanted orders filtered by kind, optional design, rarity range
  and maximum price, with notify or auto-buy. Orders do not reserve credits.
- Member creator tools using a fixed body or glyph, palette and motif. The
  creator confirms permanent price, odds and community-crate participation
  before publication. Afterwards the interface offers list/unlist only.

Membership, ownership, rarity outcomes, balances, trade holds, care progress
and purchases require authoritative service replies. Former supporters retain
their existing ownership and selling rights according to those entitlements.
The UI explains 15-minute Original and one-hour rarity trade holds. A creator
does not receive a self-granted collectible or choose its rolled rarity.

## Public desktop contract

The renderer calls `window.mefiStudio.hubCollectibles(action, payload)`.
`scripts/collectibles-contract.cjs` maps named actions to fixed routes, bounds
request data and excludes caller-supplied ownership and entitlement fields.
No private service implementation, deployment configuration, database schema
or transaction code is included in this change.

| Action | HTTP route |
| --- | --- |
| `list` | `GET /v1/collectibles` |
| `inventory` | `GET /v1/collectibles/inventory?cursor=...` |
| `catalog` | `GET /v1/collectibles/catalog?cursor=...` |
| `market` | `GET /v1/collectibles/market?cursor=...` |
| `open` | `POST /v1/collectibles/open` |
| `create` | `POST /v1/collectibles/create` |
| `updateCreation` | `PUT /v1/collectibles/creations/:id` (`listed` only) |
| `buyCreation` | `POST /v1/collectibles/creations/:id/buy` |
| `care` | `POST /v1/collectibles/instances/:id/care` |
| `updateInstance` | `PUT /v1/collectibles/instances/:id` |
| `transfer` | `POST /v1/collectibles/instances/:id/transfer` |
| `listItem` | `POST /v1/collectibles/listings` |
| `buy`, `cancelListing` | `POST /v1/collectibles/listings/:id/buy`, `DELETE /v1/collectibles/listings/:id` |
| `order`, `cancelOrder` | `POST /v1/collectibles/orders`, `DELETE /v1/collectibles/orders/:id` |
| `stickers` | `GET /v1/rooms/:id/stickers` |
| `share`, `claim` | `POST /v1/collectibles/instances/:id/share`, `POST /v1/collectibles/instances/:id/claim` |

The snapshot contains `inventory`, `catalog`, `creations`, `rarities`,
`crates`, `entitlements`, `balance`, `listings`, `orders`, `notifications` and
`now`. `inventoryNext`, `catalogNext` and `marketNext` continue their respective
lists. Continuation responses contain the named list and `next`. The desktop
finishes inventory pagination before clearing an equipped pet whose ownership
has changed. Catalog and market offer Load more controls.

Crate requests include `crateId`, the quoted `price`, `requestId` and
`poolVersion`; community openings also require `communityOptIn: true`.
Direct creation purchases include their definition, quoted price and stable
request ID. A changed quote requires fresh consent. Mutation replies update
the UI only for the same account; disconnect immediately suspends a
collectible pet until fresh ownership is available.

Room chat uses `sendSticker(roomId, instanceId, name)`. Service messages can
include a bounded sticker snapshot; pet presence names an `instanceId` and
can carry a service-provided collectible appearance. The client advertises
`collectibles.1` alongside its existing capabilities. A private collectible
change notification prompts an authenticated collection refresh.

## Artwork and renderer boundaries

`renderer/collectibles.js` and `.css` own the Shop panels;
`renderer/pets.js` draws the four pet bodies. Custom looks are data, never
executable scripts, CSS or arbitrary remote images. Bundled sticker assets
are selected only from the nine known keys. `assets/discord/` contains two
additional reactions and four native pet previews; the local export tool
prepares Discord-sized files without uploading anything.
