# Canonical Studio accounts in the desktop client

This is prepared source, not deployment or successful Google consent evidence.
Google sign-in is reachable from Friends and Settings > Community. It stays
unavailable unless the native rollout flag MEFI_STUDIO_GOOGLE_SIGNIN=1, an
explicitly configured HTTPS hub origin, and OS encryption are all available.
The flag does not establish identity or authorize the server to advertise a feature.

## Identity and credential boundary

The exact actor-contract.cjs accepts a primitive legacy 17–20 digit account ID,
or studio: followed by a lowercase UUIDv4. Provider subjects, Discord message
IDs, resource IDs, PC IDs and credit-history tombstones retain separate grammars.
Canonical principal DTOs are accepted only after the bootstrap marker
accounts.canonical.1 and a matching WebSocket ready actor/capability. Unknown
markers, missing negotiation, changed renewal actors, and stale HTTP responses
fail closed. Legacy opaque-actor responses return upgrade-required; members and
owners are not silently filtered or replaced with null.

Native account-client.cjs binds 127.0.0.1 on an exclusive ephemeral port and opens
only the Google authorization URL returned by the configured private broker.
The callback carries a constant-time checked delivery state and one-use handoff.
PKCE, handoff, linking session and account authority credentials remain in main.
The broker owns provider verification and canonical admission/alias authority.
No renderer credential, email-based account merge, substitute wallet or fabricated
Google claim is accepted.

The native encrypted studio-account-auth.json is separate from the existing
Discord refresh file. The existing safeStorage implementation works through both
Electron and the Rust host shim. Explicit selected-account mode survives expiry
and failed sign-in, preventing a silent fallback to a Discord wallet. Linking
preserves an existing valid account and requires fresh Google control; a separate
existing alias is an explicit conflict. Cancellation closes the pending callback.
Sign out clears the local Studio authority and old hub session. Use my linked
Discord account is a separate explicit action. There is no provider refresh token,
plaintext fallback, automatic Google activation or credential in localStorage.

## Local history on account changes

Unmarked legacy numeric sessions retain room-history.json. It is never guessed
to belong to a Google account or imported into another account. Canonical sessions
use room-history-actor-<SHA256-of-validated-actor>.json. Both are encrypted by the
existing native helper; file names are derived from trusted hub identity, never
a renderer path. On a switch, an old snapshot and its destination are captured
before the new store loads. Pending snapshots remain available when switching
back before disk persistence completes. Old-client events and late HTTP history
results are fenced from the new account. Existing legacy bytes stay available
for legacy sign-in; no migration to canonical history is claimed.

## Remaining evidence and prerequisites

The registered Google web OAuth client, private secret, exact HTTPS callback,
stable private flow encryption key and deployed broker binding are external
prerequisites. Native and private fixture tests are not proof of live consent or
callback registration. No keys were requested in chat and no live provider
objects or credentials were created by this source work.

Prepared tests cover real hub negotiation, renewal/account fences, exact actor
grammars, native callback state/PKCE, cancellation, encrypted-storage failure,
same-room history isolation, queued writes and reachable disabled UI.
These tests, the full repository gate, generated booklet, Rust host behavior,
combined private integration and UI captures still require execution in the
coordinated validation lane.
## Prepared revision boundary

This revision implements Google broker contract v2. The full exact admission
projection is validated before accepting the new encrypted authority. Admitted
means socialAccess=true and waitlistPosition=null; waitlisted means
socialAccess=false and a primitive safe integer position from 1 through
9007199254740991. Positions above 1000 display without clamping. Waitlisted
authority can link another verified provider to the same account but cannot
supply a hub credential, auto-connect, open Shop/cash, or retry a hub bootstrap.
No Discord fallback occurs. The earlier prepared-v2-identity artifact remains an
immutable historical v1 source snapshot.

Account changes clear companion presence and volatile PC roster, received state,
pairing prompts and relay key hints. Send/receive dispatch from an old hub is
fenced. Existing paired-device records, running task data and durable outboxes
are retained. A captured native hub/actor fence follows incoming PC handlers through async
continuations, queued board/pairing writes, handoff Git steps, sends and UI
publication. Old work cannot resume under a newly selected account. Independent
local task admission and durable paired-device/task/outbox files remain intact.
Deferred real-handler tests are prepared; combined execution is still required.
## Native host integration evidence still required

The existing Rust engine forwards arbitrary IPC channels to the Node sidecar,
whose Electron shim dispatches the registered handler. community:account uses
that path without a new Rust channel registration. The shim already exposes
safeStorage.isEncryptionAvailable/encryptString/decryptString using the host
OSCrypt key; native.rs delegates key access to existing Windows DPAPI code.
No encryption algorithm or app storage name was changed.

Prepared rust_host_bridge fixtures exercise the real Node shim over its pipe,
the real native account parser/storage adapter with a synthetic host keystore,
and the real preload account invocation/event route. They are not a Rust build
or an actual Windows DPAPI acceptance test. The native unavailable-encryption
fixture confirms source behavior without plaintext fallback. Host build/core,
OS-keystore, full application gates and configured OAuth evidence remain unrun
in this source-only lane.
Legacy account or wallet migration refusals retain the existing native account
selection and saved authority where present, and show that account/purchase
history needs migration and review. They never create a wallet, guess an
admission date, or initiate an alternate provider. The actual broker's bounded
signin-cancelled callback closes the flow without redeeming.

Account code loads on first use. Saved encrypted state is read asynchronously
once; Hub creation, account status and account actions await that readiness.
While the read is pending, no temporary Discord fallback is selected. Cancel,
retirement and replacement fence queued actions and drain pending reads and
writes before another account instance becomes authoritative.

The combined public account/PC/history/commerce/referral focus passes 263 checks. The
same 21-sample native-hook measurement confirms zero synchronous credential
reads after this change, compared with one before. Asynchronous first-ready
latency increased in that synthetic measurement; this is not a whole-app
startup or Windows keystore performance claim.
