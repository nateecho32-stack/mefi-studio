# Shared content and item swaps

`renderer/social-content.js` draws text and bounded link cards without remote
images, favicons or fetched HTML. A reader chooses whether to open a destination
or load a supported player. Its URL check catches credentials, secret query
parameters and obvious private-network addresses; it cannot certify a website's
contents, redirects or the personal information in a message. Shared playlists
use a local placeholder. Listen together requires fresh consent to each origin.

`renderer/room-images.js` accepts JPEG/PNG, checks dimensions before decoding,
re-encodes to a JPEG no larger than 1280 pixels per side and 96 KiB, and presents
a local review. Neither the original filename nor camera metadata is uploaded.
People must check the visible picture for private information. Recipients click
to fetch pixels through the authenticated host bridge. The compatible service
advertises `messages.images`, enforces room access, and retains images for seven
days; members may keep their own copies. A signed report can retain a bounded
copy for 30 days from the first report. Moderators explicitly reveal its pixels
and confirm removal from the room. Report lists never preload the image.
Forgetting an account does not erase private report evidence.

`renderer/item-trades.js` opens from Shop. It shows the participant and exact
owned items, reviews an immutable offer, and reviews acceptance separately.
`scripts/social-client.cjs` validates the public `shop.trades` contract and stable
receipts. The private service owns eligibility, inventory, atomic transfer,
expiry and abuse controls. These client files cannot grant credits or ownership.
Collectible swaps use the exact `item_` instance ID and show its immutable
design, rarity and quality in both reviews. Catalog IDs remain supported.
Inventory replies are bounded to 1,200 items per side, including up to 1,000
unique collectibles; larger replies are refused instead of silently truncated.
Old services return unsupported. The desktop does not set launch dates, Donor
benefits or seller earning caps, and this change does not deploy server code.

For recovery, localStorage keys `mefiStudio.social.content`,
`mefiStudio.social.images` and `mefiStudio.trades` accept `off`. Content-off still
redacts unsafe links. Removing a key restores its default. Service operators can
also suspend image uploads and trade acceptance independently. Existing text
chat, purchases, rooms and agent building remain available.

Validation lives in `social_content`, `social_client`, `social_content_render`
and `together_ui` tests, plus the existing moderation, room, Shop and hub client suites.
The real Chromium fixture uses synthetic images, isolated data and blocked
network/permissions. Private service tests and implementation stay outside this
public repository.
