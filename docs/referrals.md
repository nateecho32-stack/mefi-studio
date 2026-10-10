# Referral invitations in Studio

The existing Studio Account card contains Referral rewards. Friends links to that
same card. Existing room invitations still open rooms; they do not count as
canonical account referrals. No new navigation destination is introduced.

The public client requires an admitted, authenticated Hub session with
accounts.canonical.1 and referrals.1. Waitlisted accounts show their queue
position and cannot read or mutate this surface. Google availability is separate:
an admitted canonical Discord-backed session can use referrals too.

The service owns the threshold (currently five), qualifying account count and
active award. The renderer does not infer qualification from a count; an earned
award may outlast an invitee's admission. OAuth account verification is not proof
that each account represents a distinct natural human. Current seller commission
and processing costs remain server facts shown by the cash marketplace.

## Public and native boundaries

The pinned public contract is referrals.1. The admitted Hub advertises
referralInvitations and implements readReferralStatus, issueReferralInvitation,
and redeemReferralInvitation. Only the exact pinned actor-free bodies go over
HTTP. Mutations use the configured HTTPS Hub Origin. Credentials stay in main.

The preload bridge is hubReferrals(action, payload, actorId), using hub:referrals.
The outer actorId is an expected-current-account assertion, never a credential
selector or HTTP actor parameter. Main waits for native readiness and checks the
validated actor, account instance, action generation, current Hub client and
capability. The Hub client also captures its original session object, token,
generation and expiry and fences the response. It does not renew and replay a
mutation after a 401.

The Rust host's existing generic invoke path transports this channel through
src-tauri/src/init.js, engine.rs and scripts/tauri-electron.cjs. No Rust per-channel
registration or new crypto port is needed. The prepared regression uses the real
page initializer and preload plus the actual main handler. It is synthetic
behavioral coverage, not evidence of a Rust build or real OS keystore execution.

## Durable recovery

Before a mutation, the client persists the exact tuple in the account-specific
local key mefi.referrals.pending.v1:<validated actor>. It contains public
request IDs and referral codes only, not credentials. Failed storage or malformed
saved data blocks new requests without overwriting the old bytes.

Unknown network/auth/service outcomes keep the original tuple. Recovery is a
separate explicit action and remains reachable when new requests are paused,
read-only or unavailable. A status read with attributionRecorded true cannot
retire a saved redemption: it identifies no original request. A positive exact
receipt clears the pending tuple. Only the three pinned exact durable negative
responses with the matching requestId enable Review another code; the user must
then explicitly confirm a corrected code before the client generates a new ID.

Account changes invalidate late responses and leave the old tuple in its own
account bucket. No automatic request is sent for the next account. Expired issue
receipts remain valid historical acknowledgements, and never trigger automatic
renewal. Copying an active referral code creates no request and sends no message.

## Validation and availability

The rebuilt booklet and both referral suites pass, including 26 contract, native
handler, real Rust page bridge and renderer cases. The affected public focus
passes 263 checks. The offline private host passes all 843 checks, including
eight mounted referral cases, both complete cash-sale journeys and the original
1,000-member rehearsal within its unchanged limits. A restored native account,
the actual main handler and the public Hub client also exercise the signed host
together. This is synthetic provider/keystore evidence; real provider, Windows
keystore, hosted and physical-PC acceptance remain separate.

The final desktop application gate, packaged visual checks and installed update
remain required. No provider keys, production capability advertisement or
production enablement are changed by this client patch.
