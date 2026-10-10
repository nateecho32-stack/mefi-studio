# Cash marketplace client

Shop > Cash marketplace contains Browse, Sell and My orders. The public desktop
contains the interface and strict transport contracts. The private service owns
account eligibility, listing versions, prices, fees, tax, payment reconciliation,
reservations and delivery. Installing the client does not enable a marketplace.

## Availability and independent capabilities

- `commerce.catalog.1` exposes eligible listing previews and exact listing detail.
- `commerce.seller.1` exposes the current account's seller setup, reviewed currency
  policy, assets and versioned publication, repricing and unlisting.
- `commerce.orders.2` exposes version-two order creation, checkout, current status
  and actor-only pending/history pagination. A mounted read capability can remain
  available while the service refuses all new payment mutations.

The client does not infer one capability from another. Unsupported panels say
that the corresponding service is unavailable. Seller bank details belong on a
provider-hosted onboarding page; the client does not collect them. Onboarding
uses independently advertised `commerce.onboarding.1`, a fresh authenticated
seller-status check and a native one-use HTTPS `connect.stripe.com` ticket.

## Price and ownership boundaries

A listing identifies a fixed creator good or one existing collectible instance.
The strict collectible preview includes its exact ID, design, owner, rarity,
quality, visual, traits, growth, sizes and hold. User assets are data rendered by
local painters; remote images, arbitrary HTML and scripts are not accepted.
Buying an existing collectible transfers that instance. It does not reroll its
rarity or replace its traits or age. Missing original acquisition evidence is
shown as a cash-resale review; it does not remove the user's owned item.

The buyer reviews a fresh listing version before reserving an order, then reviews
the server-selected order before opening checkout. The item price, exact Studio
seller commission and tax appear separately. New orders deduct verified
processing costs from seller proceeds and add no buyer processing surcharge;
historical orders retain their accepted fee terms.
The client displays the server's commission and never infers it from local
membership or invite counts. Listing cash-price updates create new versions;
they cannot change published credit prices or crate rarity odds.

Amounts are safe integers. Currency exponent and permitted increment are explicit
server facts; the client never infers two decimal places from a country, language
or locale. Seller decimal input is parsed with string/integer arithmetic against
the selected server currency's bounds. Missing currency rules disable publication.

Order V2 has an explicit quote mode. `fixed-gross-v1` contains exact integer tax
and total. `hosted-exclusive-v1` keeps its original tax and total null with pending
status: the buyer sees the final tax and amount in secure checkout. A separate
verified settlement snapshot contains final amounts. Null never means zero.
Verified payment without a delivery receipt is still unresolved delivery. Older
fixed-gross fulfilled orders can have their original immutable quote and receipt
without a separate settlement record.

## Recovery and native browser boundary

Before creating an order, Studio persists the exact account-bound request ID,
listing ID and listing version. An uncertain response keeps that tuple; recovery
reuses it. Checkout resumes by the same order ID. Seller publication, repricing
and unlisting similarly retain an exact request until their result is confirmed.
No timeout creates an automatic replacement payment or publication request.

The native host accepts only short-lived Checkout URLs issued by an authenticated
response for the same order, account and client. URLs are memory-only, allowlisted
to HTTPS `checkout.stripe.com`, single-use and expire after five minutes. Account
or connection changes discard outstanding links and late responses. The renderer
cannot choose a provider account or payment destination. Billing and commerce
use distinct native tickets.

Browser return refreshes account-bound status. It does not prove payment, cancel a
reservation or grant goods. A verified delivery triggers fresh canonical Shop and
collection reads; no receipt is applied as local ownership. Pending, payment
review, refund/dispute review and fulfilled-with-review remain recoverable through
My orders and their order references.

## Source and validation

`scripts/commerce-contract.cjs` owns the order DTO and bounded requests;
`commerce-listings-contract.cjs` owns listing/seller DTOs and the exact collectible
validator. `scripts/hub-client.cjs`, main and preload carry authenticated requests
and native browser opening. `renderer/commerce.js` and `.css` own the interface.

`tests/commerce_contract.test.mjs` and `tests/commerce_ui.test.mjs` cover DTOs,
currency arithmetic, capability isolation, pagination, native tickets, uncertain
outcomes, account changes and authoritative ownership refresh. Their preparation
is not proof of execution. Actual private-gateway and canonical ownership tests,
source/renderer checks, generated booklet, UI captures and the complete release
gate remain required. Provider sandbox results and policy acceptance are separate
from client correctness; no live service activation follows from this source.
## Canonical actors and unresolved requests

Canonical identity follows docs/studio-accounts.md and accounts.canonical.1.
Cash seller and collectible owner fields preserve exact canonical actors; signed
provider/message identifiers remain separate.

The independent commerce.orders.retire.1 capability enables explicit resolution
of the saved original create tuple. An applied result opens the existing strict
order. Only exact not-applied confirmation removes the saved tuple; this server
result permanently prevents that tuple from later committing. Network, unknown,
auth and conflict outcomes retain it. Resolution never cancels an existing
reservation or payment, automatically reprices, or starts another checkout.

Listing mutation replays are original saved receipts, validated against their
original price. A successful receipt triggers current seller/inventory reads.
Only listing_changed, listing_exists, listing_limit, invalid_price,
asset_reserved and seller_not_ready have pinned definitive nonapplication.
The UI shows that refusal and offers an explicit current-terms review before
retiring the saved listing request. Unknown results keep the original request.
Seller country preparation and the current processing-policy disclosure follow the separately pinned contracts below.
## Seller country preparation

The independent commerce.seller-setup.1 capability enables readSellerSetup and
prepareSellerSetup only. The creator explicitly chooses a declared country of
residence or legal business establishment from the server's reviewed allowlist;
no locale, English language, IP, Google identity or default US guess is used.
This self-declaration is not verified residence. Stripe collects KYC and bank
details on its hosted form. Country locks when any provider account intent or
binding exists. A removed historical country remains visible.

A review and confirmation persist the original actor-bound country/request ID
before mutation. Unknown responses retain that tuple across restart. A replay
must match the original declared country; after acknowledgment the client reads
current setup before further action or onboarding. Reads and country preparation
create no provider objects. The existing onboarding request remains requestId
only. Missing capability or an empty server allowlist leaves preparation closed.
The public account, commerce, creator and referral flows pass the combined 263-case
focused run. This does not establish configured provider or final package
acceptance.
## Current and historical commission snapshots

The prospective commission-5-10-15-v3 schedule uses exactly 500/1000/1500 basis
points for subscriber/qualified inviter/standard. Its buyer processing fee is
zero. The actual verified provider processing cost is deducted from seller
proceeds separately from commission; no estimated or unknown-zero net payout
is computed by the client. New-schedule order review discloses that policy.

Legacy 3/8/10 and both prior 7/10/15 schedule labels remain strict historical
readers with their original supplied amounts and buyer fee. They are never
repriced or relabeled using the latest policy. Current seller fee previews may
show only server-confirmed 5/10/15 rates; order history still accepts 7%. The
seller preview alone is not a net-payout or processing-policy receipt.

The qualifying inviter threshold is five verified invited friends, matching
membership. Membership and cash use the same canonical referral-discount
benefit; linked provider aliases cannot count as another invited account.
The earned benefit survives a later invitee departure and remains subject to
explicit benefit revocation. The offline integrated host now records invitations
through authenticated canonical sessions and commits admission reevaluation
with the same account authority. Five verified invited accounts activate that
same benefit for membership and the current cash inviter rate. A room invitation
or client-supplied count is not proof. Hosted availability still requires the
configured private service.

An offline actual-host sale also exercises credits earned through project play,
one unforced random credit-crate pet, its growth and traits, and a new non-donor
cash buyer without room access. The public cash client reads the real host DTOs;
delivery transfers that original instance once without rerolling or changing
credits or lifetime rank. Only outbound provider HTTP is simulated. These checks
do not establish live provider acceptance or enable randomized collectible sales.
