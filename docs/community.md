# The Void Engine community link

Studio can link your Discord account to the **Void Engine** server
(<https://discord.gg/xgfKc5pVxG>). Members unlock the **Void collection**,
four extra themes and three node styles. Linking is optional, and nothing
contacts Discord until you choose **Link my Discord**. The lock is honest: a
fork can switch it off with one documented constant (see
[Unlocking it yourself](#unlocking-it-yourself)).

This page follows the feature end to end: the weekly card, the login, the
weekly re-check, what is stored and where, the setup a maintainer does once,
and what later phases add. The short version is in the README's
[Community & perks](../README.md#community--perks) section, and the privacy
summary is in [SECURITY.md](../SECURITY.md).

## What members get

Everything that was free stays free: the seven original themes, **Custom
colors** and the five original node styles. The Void collection adds:

| Theme | Key | Colours | Command-view sky |
| --- | --- | --- | --- |
| **Void** | `void` | violet and cyan | Deep space |
| **Eclipse** | `eclipse` | amber on black | Warm dust |
| **Abyss** | `abyss` | teal and indigo | Fireflies |
| **Neon Dusk** | `dusk` | pink and cyan | Quiet grid |

| Node style | Key | Look |
| --- | --- | --- |
| **Singularity** | `singularity` | A dark core in a bright ring |
| **Prism** | `prism` | Refracting facets |
| **Sigil** | `sigil` | Rune-marked rings |

- Each Void theme has a second accent hue (`--accent-2`). While one is on,
  `:root[data-studio-theme-tier="premium"]` gives primary buttons a gradient
  and a second-hue glow. The only motion is a hover sheen, and only when motion
  is allowed. Nothing animates at rest.
- The node-style painters in `renderer/idle.js` and `renderer/tree3d.js` build
  their geometry once and cache their gradients per canvas, like the existing
  orb paints, so the Command frame budget does not grow.
- The pickers in **Style & sound** show the collection as its own "Void
  collection" group under the free choices. The workspace's **Studio theme**
  select has a "Void collection · Discord members" group.

### Locked, unlocked, and losing access

- **Locked items** stay focusable. They carry `aria-disabled="true"` (never
  `disabled`) and a **Members** badge. Clicking one changes nothing: the
  current theme or style is announced again, so the workspace select rolls
  back. Then **Settings › Community** opens with a note such as "Void is a Void
  collection theme."
- Every locked group shows the same fine print:

  > Members of the Void Engine Discord unlock these. Studio is MIT-licensed:
  > fork the project and unlock it yourself, or ask an agent to do it for you.

  Under it are **Join the Discord**, **Link my Discord** and **Copy agent
  prompt**. In the browser preview (`npm run start:web`) there is no desktop
  bridge, so the group says "Desktop app only".
- **Unlocked,** a pick applies at once and is saved only in
  `localStorage["mefiStudio.music.premium.v1"]` as `{ theme, nodeStyle }`. The
  ordinary saved preferences keep accepting free keys only, so they always hold
  a free fallback. Picking a free item clears the matching premium entry.
- **When access ends** (you leave the server, or the offline grace runs out),
  Studio falls back to your saved free choice without writing anything. It
  shows "Void collection locked again; your choice is saved." once. If you get
  access back, your premium choice returns.
- **At launch** a member's premium choice paints from a boot hint, so the free
  theme does not flash first. The hint is
  `localStorage["mefiStudio.community.v1"] = { premium, validUntil }` and is
  rewritten on every status.

## The flow end to end

```
weekly card / Settings › Community / a locked item
        │  Link my Discord
        ▼
main: discord-oauth.authorize()
  ├─ 127.0.0.1:53134..53136  GET /callback (one hit, 5 min)
  ├─ browser → discord.com/oauth2/authorize  (PKCE S256, identify + guilds.members.read)
  ├─ POST /api/v10/oauth2/token              (no client secret)
  └─ GET  /users/@me, /users/@me/guilds/{Void Engine}/member
        │
        ▼
community.recordCheck() → settings.community.link   (public fields only)
refresh token → safeStorage → community-auth.json   (access token: memory only)
        │
        ▼
community.entitlement() → publicStatus() → community:event → window.MefiCommunity
        │
        ▼
MefiCommunity.has("premium") → music.js pickers, idle.js / tree3d.js painters
```

### 1. The weekly card

A small card invites non-members to join. The rules are in
`promptDue()` and `applyPrompt()` in `scripts/community.cjs`, and the state is
`settings.community.prompt`:

- **First showing.** Main stamps `firstSeenAt` the first time it computes the
  status. The card is not due until three days after that.
- **After that,** it is due seven days after it was last shown, and never while
  a snooze is running.
- **Back-off.** After four showings the gap grows to 30 days. The count starts
  over when you press **Join the Discord**.
- **Never shown** when you chose **Don't show again**, when you already have the
  perks, or when the community modules are missing (`available: false`).
- **Once per session.** The renderer shows it at most once per app session.

What each button does:

| Button | Effect |
| --- | --- |
| **Join the Discord** | Opens the invite in your browser, resets the showing count and holds the card for a day, long enough to join and come back to link. |
| **I'm a member – link my account** | Starts the login. Hidden when linking is not configured, or when an account is already linked and does not need linking again. |
| **Not now** (or Esc) | Snoozes the card for a week. |
| **Don't show again** | Stops the card. Settings › Community keeps Join and Link available. |

The card waits for a quiet moment (`renderer/community.js`). It needs all of
these:

- not a `?capture=1` or `?smoke=1` launch
- the desktop bridge is present
- the boot layer is gone
- no sheet or dialog is open (`MefiNav.state.transient`)
- the *Start here* walkthrough is neither new nor being read
- no key was pressed in the last 45 seconds
- the window is visible

A busy moment retries every few seconds for about ten minutes. After that the
card waits for the window to become visible again or for the six-hour
`MefiBoot.pollStart("community.prompt")` re-read, which is a local read with no
network. On the workspace the card appears inline, after the walkthrough
invitation. Elsewhere it is a 12-second toast with **See the perks**.

### 2. Linking: OAuth2 with PKCE and a loopback redirect

`authorize()` in `scripts/discord-oauth.cjs`:

1. `community.pkce()` makes a 64-character verifier, its S256 challenge and a
   random `state`.
2. A server bound to `127.0.0.1` only starts on the first free port of
   `53134`, `53135` and `53136`.
   - It serves `GET /callback` and nothing else, and refuses any request whose
     `Host` header is not exactly `127.0.0.1:<port>`, which stops DNS
     rebinding.
   - It accepts one callback and gives up after five minutes.
3. Main opens the hard-coded authorize URL in your browser, with scopes
   `identify` and `guilds.members.read`. `shell.openExternal` only receives a
   URL that passes `isAllowedDiscordUrl`: https, exactly `discord.com`,
   `www.discord.com` or `discord.gg`, and no port or userinfo.
4. The callback's `state` is compared in constant time before anything else
   is read. A hit with the wrong or no `state` (a web page's `<img>`, another
   local process, an old callback tab reloaded) gets a 400 and the wait goes
   on, so it cannot end or cancel the login. The real callback gets a static
   page with no script (Cache-Control `no-store` and a `default-src 'none'`
   CSP), and the server closes.
5. The code is exchanged at `POST https://discord.com/api/v10/oauth2/token`
   **without a client secret**. The app is a public client, and a secret
   shipped in an MIT client would be no secret.
6. `GET /users/@me` and `GET /users/@me/guilds/1345380333302059129/member`
   say who you are and whether you are in the Void Engine server.
   - A 404 (Discord code 10004) means "not a member".
   - A not-member login still stores the link, with perks locked, so
     **Check now** can notice when you join.

A few more details:

- Every request uses `redirect: "error"` and has a 20-second timeout.
- **Cancel** in Settings aborts a login that is waiting. If Discord had
  already granted access, that grant is revoked. So is a grant whose
  `/users/@me` or member read fails after the code exchange (network, rate
  limit, auth): `authorize()` returns the tokens with every failure after the
  exchange, and main revokes any grant it does not record. That includes a
  grant main fails to keep (the token file or `settings.json` write fails,
  answered `storage`) and one a Cancel reaches before the link is saved. The
  tokens in memory and `community-auth.json` go back to what they were. A
  Cancel that arrives after the link is saved is too late; Unlink removes it.
- Every POST the feature makes lives in `discord-oauth.cjs`: the token
  exchange, refresh and revoke. That is why `tests/outbound_privacy.test.mjs`
  still finds exactly one `method: "POST"` in `main.cjs`.

### 3. The weekly re-check

`startCommunityWatch()` in `main.cjs` sits next to the release watcher, and
`stopCommunityWatch()` stops it with the other watchers when Studio closes its
last window or applies a release update.

**When checks run:**
- It first runs 15 seconds after boot, then every hour on an unref'd timer.
  It is skipped in smoke, capture and CLI runs.
- A tick contacts Discord only when `checkDue()` says so: at `nextCheckAt`,
  or `checkedAt` plus seven days. Every tick still republishes the status, so
  a card coming due or a grace period running out reaches the window without
  a restart.
- **Check now** in Settings runs the same check, at most once a minute (it
  answers `throttled` otherwise). Only one check runs at a time.

**What a check does:**
- It uses the in-memory access token while that has more than five minutes
  left.
- Otherwise it trades the refresh token for a new pair. Discord rotates the
  refresh token, so the new one is encrypted and saved **before** the new
  access token is used.

**What the answer does** (`recordCheck()`):

| Answer | Link state | Effect |
| --- | --- | --- |
| Member | `ok` | Roles refreshed. `lastOkAt` and `checkedAt` set to now, next check in 7 days. |
| Not in the server | `not-member` | Perks locked **at once**, roles cleared, next check in 7 days. |
| Grant refused (`401`/`403`, `invalid_grant`) | `relink` | Settings offers **Link again**. Perks last until the grace period ends. |
| Network error, `5xx`, rate limit | `offline` | Retries after 1 hour, then 6 hours, then daily. A longer `Retry-After` wins, up to 7 days. Perks last until the grace period ends. |

### 4. Entitlement

`entitlement({ link, now, selfUnlocked })` returns
`{ premium, perks, validUntil, reason }`:

| Reason | When | Premium |
| --- | --- | --- |
| `self` | `SELF_UNLOCKED` is true | yes, every perk, no expiry |
| `member` | the last check said member (or the link is session-only) and it is within 14 days of `lastOkAt` | yes |
| `grace` | the last check failed or needs a relink, but the last good one is within 14 days | yes, until `validUntil` |
| `not-member` | Discord said you are not in the server | no |
| `unlinked` | no account linked | no |
| `expired` | 14 days passed since the last good check | no |

`perks` is `["premium"]` plus whatever `ROLE_PERKS` maps your role ids to.
`ROLE_PERKS` is empty in Phase 1. The renderer asks
`MefiCommunity.has("premium")` and listens for the `mefi-community-change`
window event, whose detail is the entitlement. The event fires once after the
first status and again whenever the entitlement changes. A second event,
`mefi-community-status` (detail `{ configured, linked, state, linking }`),
fires when whether linking is possible changes; the Style pickers show
**Link my Discord** only in a configured build, for an account that is not
linked yet or that Discord asks to link again.

## Data and storage

| What | Where | Notes |
| --- | --- | --- |
| Card cadence: `firstSeenAt`, last shown, snooze, "never", showing count | `settings.json` → `community.prompt` | Plain JSON. `prefs:set` cannot write it. |
| Public half of the link: Discord user id, username, display name, role ids in the Void Engine server, join date, linked/checked/last-good/next-check times, state, failure count | `settings.json` → `community.link` | `normalize()` keeps only these fields, so a token that strayed into the object is dropped before the write. |
| Refresh token | `community-auth.json` → `{ refreshTokenEncrypted }` | Encrypted with `safeStorage` (the OS keystore, DPAPI on Windows) and written atomically. A separate file from `auth.json`. |
| Access token | memory only | Gone when Studio quits. |
| Boot hint, premium choice | the renderer's `localStorage` | `{ premium, validUntil }` and `{ theme, nodeStyle }`; no identity. |

- `settings.json` and `community-auth.json` sit side by side in Electron's
  userData folder, `%APPDATA%\Mefi's Studio AI+` on Windows. Nothing goes in
  `data/`.
- **No keystore:** if `safeStorage` is unavailable, nothing is written. The
  link lives in memory for the session, reports the state `session`, and
  Settings says the link lasts until Studio closes.
- **What is read:** only `identify` and `guilds.members.read`. Studio never
  reads messages, your email or your other servers, and sends nothing about
  your projects.
- **Where it talks:** only `discord.com`, plus the one-shot loopback listener
  on `127.0.0.1` during a login.
- **Tokens never cross IPC.** The renderer sees only the public status.

### Unlinking

**Unlink** in Settings › Community does the following, in order:

1. Cancels a login that is still waiting, and waits for a check in flight.
2. Revokes the grant at `POST /api/v10/oauth2/token/revoke`, best effort, as
   Discord's developer terms ask.
3. Deletes `community-auth.json` and drops the tokens from memory.
4. Clears `settings.community.link`. The card cadence is kept.

The reply says whether Discord confirmed the revoke. You can also remove
"Mefi Studio Link" under Discord › User Settings › Authorized Apps. Studio then
finds out at the next check: the link goes to `relink`, and the perks last
until the 14-day grace period ends.

## The IPC surface

Every call returns `{ ok: true, status }` or `{ ok: false, error, status }`.
`community:event` pushes the bare status, and only when its `signature()`
changes. The `community:` prefix bypasses the project gate in
`handleProjectIpc`, because perks are app-wide.

| Preload method | Channel | Notes |
| --- | --- | --- |
| `communityStatus()` | `community:status` | Recomputes `prompt.due` on every call. |
| `communityLink()` | `community:link` | Pushes `linking: true` while the browser login runs. |
| `communityLinkCancel()` | `community:link-cancel` | `not-linking` when no login is open. |
| `communityCheck()` | `community:check` | `throttled` (with `retryAfterMs`) within a minute of the last manual check; `unlinked` with no account. |
| `communityUnlink()` | `community:unlink` | Adds `revoked: true/false`. |
| `communityPrompt(action)` | `community:prompt` `{ action }` | `shown`, `snooze`, `never`, `reset` or `joined`. |
| `communityOpen(target)` | `community:open` `{ target }` | `invite` or `server` only. Main maps the name to a hard-coded URL, so no renderer-supplied URL reaches the shell. |
| `onCommunityEvent(cb)` | `community:event` | Status pushes. |

The status is:

```
{ available, configured, linked, linking, selfUnlocked,
  user: { id, username, globalName } | null, roles, state,
  entitlement: { premium, perks, validUntil, reason },
  checkedAt, lastOkAt, nextCheckAt,
  prompt: { due, never, snoozeUntil },
  inviteUrl, serverUrl, forkCopy, agentPrompt }
```

**Error codes:**
- From `authorize`: `canceled`, `timeout`, `port-busy`, `auth`, `network`,
  `not-member`, `rate-limit` and `not-configured`. (`state` stays in the
  list of codes, but a wrong `state` no longer ends the login; see step 4.)
- Added by main: `unavailable`, `busy`, `unlinked`, `throttled`,
  `not-linking`, `action`, `target`, `open` and `storage`.
  - `storage` means Studio could not write or delete its own copy. From
    `community:unlink`, deleting the link or `community-auth.json` failed.
    From `community:link`, keeping the new grant failed (the token file or
    `settings.json`), so the grant was revoked and nothing was kept.
  - `canceled` also comes from `community:check`: a link or unlink landed
    while the check was out, so its answer was dropped.

In the renderer, `window.MefiCommunity` offers:
- `has(perk)`, `status()`, `refresh()`
- `offer({ kind, key, name, navigate })`, `open({ note })`. With
  `navigate: false` (the Workspace theme select, which fires on every arrow
  key) a locked item is explained in place, in the inline card or a toast,
  and the view never changes.
- `join()`, `link()`, `cancelLink()`, `check()`, `unlink()`
- `copyAgentPrompt()`
- the `FORK_COPY` and `AGENT_PROMPT` strings

It also registers a `Ctrl K` action, "Void Engine Discord & perks". The
workspace's **Community** button and the Settings nav item open the same card.

## Maintainer setup (Phase 0)

The code ships with `CLIENT_ID = ""`. Until an id is set, the status reports
`configured: false`:
- The weekly card and Settings offer **Join the Discord** and the fork path,
  but no Link button.
- `community:link` answers `not-configured` without opening a port.

To turn linking on:

1. In the Discord Developer Portal, create a **separate application** named
   **Mefi Studio Link**. Do not reuse the bot's application, which stays
   confidential.
2. Under OAuth2, turn **Public Client** on. Studio never sends a client
   secret.
3. Register these three redirects:
   - `http://127.0.0.1:53134/callback`
   - `http://127.0.0.1:53135/callback`
   - `http://127.0.0.1:53136/callback`
4. Put the application's client id in `CLIENT_ID` in `scripts/community.cjs`.
   To test before committing, set the `MEFI_STUDIO_DISCORD_CLIENT_ID`
   environment variable instead. The environment wins, and an id that is not
   all digits counts as unset.
5. `GUILD_ID` (`1345380333302059129`) and `INVITE_URL` already point at the
   Void Engine server. Keep the invite permanent.

Before shipping, prove these once against the real application:

- the PKCE code exchange works without a secret;
- a refresh works without a secret (if it does not, the fallback is a
  one-click weekly relink, since the access token lasts seven days anyway);
- the member endpoint returns `roles`, and a 404 with code 10004 for a
  non-member;
- the rate-limit headers are what `discord-oauth.cjs` expects.

Then walk the whole flow in an Electron probe with its own userData:

1. Link, and the member perks unlock.
2. Leave the server, press **Check now**, and the perks lock.
3. Unlink, and `community-auth.json` is deleted.

Confirm that the file holds only ciphertext and that `settings.json` holds no
token.

## Unlocking it yourself

Studio is MIT-licensed, and the Void collection is a thank-you to community
members, not DRM. There is one switch and no obfuscation. In your fork, open
`scripts/community.cjs` and change:

```js
const SELF_UNLOCKED = true;
```

Restart Studio, and every perk unlocks with no Discord account and no network
request. Settings › Community then says "Unlocked in this build
(SELF_UNLOCKED)". The file is part of the main process, so there is no booklet
to rebuild. Run `npm run check` and `npm test` as for any change.

Or let a coding agent do it. **Copy agent prompt**, on every locked group and
in Settings › Community, copies exactly this:

```
In my fork of Mefi's Studio AI+, set SELF_UNLOCKED to true in scripts/community.cjs so the Void collection themes and node styles unlock without Discord, then run npm run check and npm test.
```

`tests/community_ui.test.mjs` pins the renderer's copy of both sentences to
the constants in `scripts/community.cjs`.

## What comes later

Phase 1, described above, is the Studio side only. Later phases each get their
own plan when they start:

- **Phase 2, the Void Engine bot.** A separate repository, run on the
  maintainer's machine. It grants participation roles (Regular, Builder,
  Helper and others). `ROLE_PERKS` then maps those role ids to extra perks. The
  bot never needs to be online for Studio's membership check.
- **Phase 3, rooms.** Chat rooms you join by invite or request, backed by
  Discord and mirrored inside Studio.
- **Phase 4, cowork rooms.** Rooms that grant GitHub access to a project,
  where members' agents coordinate so they don't collide.
- **Phase 5, capacity pools.** Members can offer their coding-agent capacity
  to a room under a shared cap.

Phase 1 rewards nothing for inviting people: joining only moves the card's
schedule, and plain membership is the only condition. The approved plan leaves
invite rewards out because Discord's Platform Manipulation policy forbids
inducing server joins.

## Files

| File | Role |
| --- | --- |
| `scripts/community.cjs` | Pure rules: constants, the fork switch, card cadence, re-check timing, entitlement, link allow-list, PKCE and the public status. Held to its "Pure module" header by `tests/module_purity.test.mjs`. |
| `scripts/discord-oauth.cjs` | The network half: loopback login, token exchange, refresh, member read and revoke. |
| `main.cjs` | The "Discord community link" block (state, storage, watcher, link/check/unlink), the `// ---- Community ----` IPC handlers, and the `community:` project-gate bypass. |
| `preload.cjs` | The eight `community*` bridge methods. |
| `renderer/community.js` | `window.MefiCommunity`: the perk gate, the weekly card, Settings › Community, and the palette action. |
| `renderer/music.js`, `music.css`, `idle.js`, `tree3d.js` | The Void collection itself: catalog, pickers, the premium tier CSS and the node painters. |
| `tests/community_rules.test.mjs`, `discord_oauth.test.mjs`, `community_host.test.mjs`, `community_bridge.test.mjs`, `community_ui.test.mjs` | Rules; real loopback login against a fake Discord; the main block in a `vm` slice; the preload pairs; the renderer card and gates. |
