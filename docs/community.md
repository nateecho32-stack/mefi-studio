# The Void Engine community link

Studio can link your Discord account to the **Void Engine** server
(<https://discord.gg/xgfKc5pVxG>), where people share what they build with
Studio, swap model setups and listen together. Linking is optional, and
nothing contacts Discord until you choose **Link my Discord**. The link and
its status live in **Settings › Community**, which **Community** at the foot
of the menu opens.

This page follows the feature end to end: the weekly card, the login, the
weekly re-check, what is stored and where, the setup a maintainer does once,
and what later phases add. The short version is in the README's
[Community](../README.md#community) section, and the privacy summary is in
[SECURITY.md](../SECURITY.md).

## Nothing is locked behind the link

Every theme and node style Studio comes with is free for everyone, in every
build (the Shop's two extra node styles, Dragon scales and Constellation, are
for credits members earn, never for money). The
two-tone **Void collection** (themes Void, Eclipse, Abyss and Neon Dusk; node
styles Singularity, Prism and Sigil) sits in **Settings › Appearance** under
its own small heading, and saves like any other choice. The link is what
**Listen together** and the Void Engine rooms use, and it keeps a member from
being asked to join.

| Node style | Key | What it looks like |
| --- | --- | --- |
| **Singularity** | `singularity` | A black hole with a turning disc |
| **Prism** | `prism` | A turning crystal that splits light |
| **Sigil** | `sigil` | Hex runes that assemble as it works |

Earlier builds kept the collection for Discord members. What they left behind
is cleaned up on the first launch of a build without the lock:

- A Void theme or node style saved in
  `localStorage["mefiStudio.music.premium.v1"]` moves into the ordinary
  preferences (`mefiStudio.music.v1`) and the old key is removed
  (`renderer/music.js`). A write that fails keeps the old key for the next
  launch.
- The boot hint `localStorage["mefiStudio.community.v1"]` is removed
  (`renderer/community.js`).
- A `localStyleUnlock` field in `settings.json` is no longer read. It is left
  in place and does nothing.

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
community.publicStatus() → community:event → window.MefiCommunity
        │
        ▼
mefi-community-status → renderer/together.js (Listen together)
```

### 1. The weekly card

A small card invites people who are not in the server to join. The rules are in
`promptDue()` and `applyPrompt()` in `scripts/community.cjs`, and the state is
`settings.community.prompt`:

- **First showing.** Main stamps `firstSeenAt` the first time it computes the
  status. The card is not due until three days after that.
- **After that,** it is due seven days after it was last shown, and never while
  a snooze is running.
- **Back-off.** After four showings the gap grows to 30 days. The count starts
  over when you press **Join the Discord**.
- **Never shown** when you chose **Don't show again**, to a linked member
  (`isMember()`: a check has said "member" and none has said "not a member"
  since), or when the community modules are missing (`available: false`).
- **Once per session.** The renderer shows it at most once per app session.

What each button does:

| Button | Effect |
| --- | --- |
| **Join the Discord** | Opens the invite in your browser, resets the showing count and holds the card for a day, long enough to join and come back to link. |
| **Link my Discord** | Starts the login. Hidden when linking is not configured, or when an account is already linked and does not need linking again. |
| **Not now** (or Esc) | Snoozes the card for a week. |
| **Don't show again** | Stops the card. Settings › Community keeps Join and Link available. |

The card waits for a quiet moment (`renderer/community.js`). It needs all of
these:

- not a `?capture=1` or `?smoke=1` launch
- the desktop bridge is present
- the boot layer is gone
- no sheet or dialog is open (`MefiNav.state.transient`)
- the *Start here* walkthrough is neither new nor being read, and its own
  invitation is not on screen
- no key was pressed in the last 45 seconds
- the window is visible

A busy moment retries every few seconds for about ten minutes. After that the
card waits for the window to become visible again or for the six-hour
`MefiBoot.pollStart("community.prompt")` re-read, which is a local read with no
network. On the workspace the card appears inline, after the walkthrough
invitation. Elsewhere it is a 12-second toast with **Open Community**.

The card's copy says what the server is for: "Share what you're building,
swap model setups, and listen together with other builders." It promises no
unlock.

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
   - A not-member login still stores the link, as a non-member, so
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
  a card coming due reaches the window without a restart.
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
| Not in the server | `not-member` | `member` turns false **at once**, roles cleared, next check in 7 days. |
| Grant refused (`401`/`403`, `invalid_grant`) | `relink` | Settings says Discord needs you to link again and offers **Link my Discord**. The last answer stands. |
| Network error, `5xx`, rate limit | `offline` | Retries after 1 hour, then 6 hours, then daily. A longer `Retry-After` wins, up to 7 days. The last answer stands. |

### 4. Membership

`isMember(link)` answers whether the saved link says the account is in the
Void Engine server: a check has answered "member" at least once
(`lastOkAt`), and none has said "not a member" since. A failed or refused
check (`offline`, `relink`) keeps the last answer; nothing expires, because
nothing is locked behind it. The status carries it as `member`, and main uses
it so the weekly card never asks a member to join.

The renderer announces link changes with the `mefi-community-status` window
event (detail `{ configured, linked, member, state, linking }`), which fires
after the first status and whenever one of those changes.
`renderer/together.js` re-reads the rooms hub on it.

## Data and storage

| What | Where | Notes |
| --- | --- | --- |
| Card cadence: `firstSeenAt`, last shown, snooze, "never", showing count | `settings.json` → `community.prompt` | Plain JSON. `prefs:set` cannot write it. |
| Public half of the link: Discord user id, username, display name, role ids in the Void Engine server, join date, linked/checked/last-good/next-check times, state, failure count | `settings.json` → `community.link` | `normalize()` keeps only these fields, so a token that strayed into the object is dropped before the write. |
| Refresh token | `community-auth.json` → `{ refreshTokenEncrypted }` | Encrypted with `safeStorage` (the OS keystore, DPAPI on Windows) and written atomically. A separate file from `auth.json`. |
| Access token | memory only | Gone when Studio quits. |

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
finds out at the next check: the link goes to `relink`, and Settings offers
**Link my Discord** again.

## The IPC surface

Every call returns `{ ok: true, status }` or `{ ok: false, error, status }`.
`community:event` pushes the bare status, and only when its `signature()`
changes. The `community:` prefix bypasses the project gate in
`handleProjectIpc`, because the link is app-wide.

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
{ available, configured, linked, linking, member,
  user: { id, username, globalName } | null, roles, state,
  checkedAt, lastOkAt, nextCheckAt,
  prompt: { due, never, snoozeUntil },
  inviteUrl, serverUrl }
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

In the renderer, `window.MefiCommunity` offers `status()`, `refresh()`,
`open()`, `join()`, `link()`, `cancelLink()`, `check()` and `unlink()`.
`open()` opens Settings › Community; where Settings cannot show it, the
workspace's inline card stands in, else a toast whose action opens the invite.

It also registers the "Void Engine Discord" action, which Search Studio
(`Ctrl K`) files under Community. `RAIL_SLOTS` in `renderer/nav.js` gives it a
place at the foot of the menu, so **Community** there opens Settings ›
Community too. So do the Community row in Settings' own list and, on the
classic shell, the project panel's **Community** button.

## Maintainer setup (Phase 0)

The code ships with `CLIENT_ID = ""`. Until an id is set, the status reports
`configured: false`:
- The weekly card and Settings offer **Join the Discord**, but no Link
  button.
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
   Until then, each PC can save it in Settings › Community › Connection
   details (`settings.communitySetup`, checked by `community.normalizeSetup`),
   which applies at once. The `MEFI_STUDIO_DISCORD_CLIENT_ID` environment
   variable wins over both, and an id that is not all digits counts as unset.
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

1. Link, and Settings shows the account as a member.
2. Leave the server, press **Check now**, and it shows "not in the server".
3. Unlink, and `community-auth.json` is deleted.

Confirm that the file holds only ciphertext and that `settings.json` holds no
token.

## The Mefi Studio relay (2026-10-05)

Rooms, Listen together, companions, cowork claims and the Project hub now run
on the Mefi Studio relay ([relay/README.md](../relay/README.md)) instead of a
Void Engine hub on the maintainer's PC: a Cloudflare Worker with one Durable
Object, free plan, at `https://mefi-relay.mefi-studio.workers.dev`. It speaks
the hub's protocol v1, so everything below about frames and routes still
holds, with these differences:

- Rooms are the relay's own, not Discord threads. Chat is passed along and
  never stored; each Studio keeps its own copy (`scripts/room-history.cjs`)
  and fills other members' gaps through peer history (`historyRequest` /
  `historyReply` / `history`, feature `history.peer`). Every message carries
  the relay's `sig`, which the relay checks when a copy comes back.
- Sign-in reads the member's roles, join date and timeout with the member's
  own token (`guilds.members.read`); the relay holds no bot token. `/v1/health`
  names the Studio Link app (`studioAppId`).
- New `ready.features`: `keepalive` (a `{"type":"ping"}` every 30 s that
  Cloudflare answers without waking the relay), `messages.signed`, `credits`
  and `projects` (the Project hub: `/v1/me`, `/v1/members/:id/card`,
  `/v1/projects`, play, star and feature). The Discord remote returns once the
  bot is linked to the relay.

## What comes later

Phase 1, described above, is the Studio side only. Later phases each get their
own plan when they start:

- **Phase 2, the Void Engine bot.** A separate repository, run on the
  maintainer's machine. It grants participation roles (Regular, Builder,
  Helper and others). The bot never needs to be online for Studio's
  membership check.
- **Phase 3, rooms.** Chat rooms you join by invite or request, backed by
  Discord and mirrored inside Studio. A media link posted in a room can play
  in Studio's Links player: `MefiMusic.linkInfo(url)` reports whether and
  how a link plays, and `MefiMusic.playLink(url)` plays it.
  **Listen together** is the first piece of rooms that Studio ships. In
  Settings › Audio › Links, a member picks one of their rooms and plays the
  loaded link for it. The hub keeps the room's shared player (link, host,
  playing or paused, position) in memory. It pushes every change to members
  subscribed in Studio and posts one line in the room's Discord thread.
  Whoever put it on, or the room's owner, steers it. Everyone else chooses
  **Listen along**. **Share what I'm playing**, off by default, feeds the
  bot's `/nowplaying`. Both run through `scripts/hub-client.cjs` (main's
  "Rooms hub" block) and `renderer/together.js`. They need the hub's address
  in `hub-client.cjs`'s `HUB_URL`, in Settings › Community › Connection
  details, or in `MEFI_STUDIO_HUB_URL` (which wins), and a linked Discord
  account.
  **Cowork rooms** also carry live file claims (the hub's `/v1/rooms/:id/claims`
  and the `claims` frame): Studio claims the files a builder will edit in the
  room linked to the project, and waits for files another PC holds (main.cjs
  "Cowork claims"). For the bot's rebuild: if `/v1/health` also returns
  `studioAppId` (the Mefi Studio Link Application ID), Studio fills the link
  app ID from the hub address alone, and a release that builds the hub's
  permanent address in needs no setup values on any PC.
  **Companion playdates** are the second piece, and the first that needs the
  hub to learn something new. Studio's side ships; the hub only relays:
  - The hub's `ready` frame lists `features`. Studio sends companion frames
    only when it lists `"companion"`, and addresses one member only when it
    also lists `"companion.direct"`. A hub without them is never sent one.
  - Studio → hub: `{ type: "companion", roomId, card, to? }` for a room the
    member subscribed. `card` is a small object (at most a few hundred bytes)
    or `null` for "went home". With `to` (a member's Discord id) the hub must
    deliver it to that member alone, or drop it; it must never broadcast a
    frame that carries `to`.
  - Hub → Studio: the same frame with `from` (the sender's Discord id) added,
    and `to` kept on a one-member delivery. The hub does not read, store or
    log cards, and does not replay them: Studio sends its card again when a
    newcomer shows in the room's `presence`.
  What a card holds is Studio's business (`scripts/companion-friends.cjs`
  checks both the cards it sends and the ones it hears); the owner's sharing
  rules are in [architecture.md](architecture.md) (Friends › Playground).
- **Phase 4, cowork rooms.** Rooms that grant GitHub access to a project,
  where members' agents coordinate so they don't collide.
- **Phase 5, capacity pools.** Members can offer their coding-agent capacity
  to a room under a shared cap.

Nothing rewards inviting people: joining only moves the card's schedule.
Invite rewards stay out because Discord's Platform Manipulation policy forbids
inducing server joins.

## Files

| File | Role |
| --- | --- |
| `scripts/community.cjs` | Pure rules: constants, card cadence, re-check timing, what an answer means (`recordCheck`, `isMember`), link allow-list, PKCE and the public status. Held to its "Pure module" header by `tests/module_purity.test.mjs`. |
| `scripts/discord-oauth.cjs` | The network half: loopback login, token exchange, refresh, member read and revoke. |
| `main.cjs` | The "Discord community link" block (state, storage, watcher, link/check/unlink), the `// ---- Community ----` IPC handlers, and the `community:` project-gate bypass. |
| `preload.cjs` | The eight `community*` bridge methods. |
| `renderer/community.js` | `window.MefiCommunity`: the weekly card, Settings › Community, and the action that Search lists and the menu foot shows as **Community**. |
| `renderer/nav.js` | `RAIL_SLOTS`, which places that late-registered action at the menu foot. |
| `tests/community_rules.test.mjs`, `discord_oauth.test.mjs`, `community_host.test.mjs`, `community_bridge.test.mjs`, `community_ui.test.mjs` | Rules; real loopback login against a fake Discord; the main block in a `vm` slice; the preload pairs; the renderer card and gates, and that no lock copy is left. |
