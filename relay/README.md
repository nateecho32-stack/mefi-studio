# Mefi Studio relay

The relay connects Mefi Studio apps to each other: rooms, room chat, listen
together, companions in the Playground and cowork file claims. It runs on
Cloudflare Workers and one Durable Object, on the free plan, so no PC of ours
has to stay on and nothing needs a domain of its own.

It speaks the same protocol as the Void Engine hub it replaces, so Studio's
`scripts/hub-client.cjs` talks to it unchanged. Point a Studio at it with the
hub address in Settings › Community › Connection details, or
`MEFI_STUDIO_HUB_URL`.

## What the relay keeps, and what it never keeps

**Never written anywhere:** chat messages, files, IP addresses, Discord access
tokens, request logs. A message is handed to the members of the room who are
online and forgotten. Each Studio keeps its own copy of a room's messages on
its own PC, and a member's Studio can fill a gap for another member through
the relay (peer history). The relay signs every message it passes on, so a copy
that comes back has to match what was actually said.

**Kept, because the features need it:**

| What | Why | How long |
| --- | --- | --- |
| Your Discord id, display name, roles, server join date and timeout | sign-in, room rules ("a week in the server"), member search | until 2 years without signing in, or `POST /v1/me/forget` |
| A keyed hash of a Discord token already checked | a renewal does not ask Discord again | until the token expires, at most 7 days |
| Rooms, who is in them, join requests, invites, removals | rooms | 30 days after a room closes or a request is answered |
| A room's shared player: link, label, position | listen together survives the relay sleeping | while it plays; ends after 30 min paused or 6 h idle |
| Cowork claims: paths, branch, title | agents on different PCs do not edit the same files | 7 days after release |
| Deleted message ids | a peer's copy cannot bring a deleted message back | 7 days |
| Whether you chose not to show in Who's online | the "Show me as online" switch | until you change it, or forget me |
| Credits: balance, rank, streak, and who credited whom (ids, kind, amount) | earning, the anti-farming limits, a moderator's credit review | 180 days for each credit |
| Which member played which project on which day | a play counts once per player and day | 8 days |
| After Forget me: a keyed fingerprint of the account (not its id) | forgetting cannot reset the credit limits | 30 days |
| Reports: the reason, plus the reported message only when its relay signature checks out | moderation | 30 days |
| Moderator actions (ids only) | accountability | 90 days |

Forget me (`POST /v1/me/forget`) deletes every row about you and closes the
rooms you own. Observability is off in `wrangler.toml`. Who's online and The
Lobby's front page (`GET /v1/front`) are read from the live connections when a
member asks; nothing about who was online, or when, is written. An unlisted
room's name never appears on anyone else's front page.

## Credits that cannot be farmed

Credits are earned only by playing and starring other members' projects, and
the relay works out every balance and rank itself: a Studio only shows what
the relay says, so a changed Studio can change only its own screen. Against
alt accounts, trading and replays:

- Both sides must be in good standing: a Discord account at least 30 days
  old (read from the id itself), a week in the Void Engine server, not
  timed out or suspended, and not inside the 30 days after Forget me. Plays
  and stars from anyone else still open the project but count for nothing,
  not even toward "Top".
- A play pays its maker once a day per player, whichever of their projects
  was played, and the player once a day per maker. A star pays a maker once
  a week per member, so unstarring, a second project or sharing the same link
  again pays nothing more.
- One member can make another earn at most 15 credits in 7 days, all kinds
  together, under each kind's daily cap and 60 a day in all.
- A play token pays only for the day it started, so it cannot count on both
  sides of midnight. Starting plays and starring are limited to 30 an hour.
- Forget me keeps a keyed fingerprint for 30 days, so leaving and coming back
  cannot reset a limit, and the credits you gave stay counted for the
  people who received them.
- Featuring is once a week per owner, however projects are removed and
  shared again.
- Ranks unlock one thing: a room in the public list opens at Flame (200
  credits), which the limits above make slow to reach with second accounts.
  Moderation is never a rank: moderators are named accounts (`OWNER_IDS`).
- Moderators: `GET /v1/admin/credits/:id` shows where a member's credits
  came from in the last 30 days, by who caused them and with their account
  ages; `POST /v1/admin/credits/:id/revoke` (`{ "from": "<id>", "days": 30 }`,
  both optional) takes them back off the balance and the lifetime total, and
  the same plays and stars can never pay again. Suspending a member stops
  their credits too.

## Layout

| File | Purpose |
| --- | --- |
| `src/worker.mjs` | The Worker: answers `/v1/health`, refuses anything outside `/v1/` or over 16 KB, routes the rest to the one Hub object. |
| `src/hub-object.mjs` | The Hub Durable Object: every socket (Hibernation API, with the keepalive ping answered by Cloudflare) and the SQLite database, handed to the core. A plain class, so Node can load it too. |
| `src/relay.mjs` | The core: every HTTP route and WebSocket frame, rooms, chat, presence, companions, peer history, moderation, retention. Platform-free. |
| `src/protocol.mjs` | Frame and body shapes (the hub's v1, plus `companion`, `historyRequest` / `historyReply` / `history`, `hello.features`, `message.sig`). |
| `src/sessions.mjs` | Sign-in with the member's own Discord token, and the relay's 15-minute session tokens. |
| `src/chat.mjs` | Message ids that prove their author, and message signatures. |
| `src/listen.mjs` · `src/media.mjs` | Listen together, and which links are allowed (`publicHost`). |
| `src/leases.mjs` · `src/paths.mjs` | Cowork claims, carried over from the hub. |
| `src/store.mjs` | The schema and its migrations. |
| `node/adapter.mjs` | The real Worker and Hub under Node with in-memory sockets and a scripted Discord, for Studio's tests. |
| `scripts/smoke.mjs` | A real-network check of a running relay. |

The relay makes its own signing key the first time it runs and keeps it in its
database: there is no secret to type in or rotate by hand.

## Tests

From the Studio root, `npm test` runs `tests/relay_*.test.mjs`: Studio's real
hub client against the real Worker and Hub, plus the core's rules.

Against Cloudflare's own runtime on this PC:

```bash
npm ci
npx wrangler dev --ip 127.0.0.1 --port 8787
```

with a `.dev.vars` (never committed) holding
`STUDIO_APP_ID=100000000000000001` and `DISCORD_API_BASE=http://127.0.0.1:8799`
(plus `ROLE_IDS_JSON={"room_host":"300000000000000001"}` to try a Room Host role), then

```bash
node scripts/smoke.mjs http://127.0.0.1:8787 --fake-discord 8799
```

## Deploying

1. A free Cloudflare account, then `npx wrangler login` in this folder.
2. Fill in `[vars]` in `wrangler.toml`: `STUDIO_APP_ID` (the Mefi Studio Link
   Discord application) and `OWNER_IDS` (the moderators' Discord user ids).
   No Discord roles are needed: ranks are Studio's own, from credits, and
   Flame rank unlocks listed rooms. `MOD_ROLE_IDS` and `ROLE_IDS_JSON` are
   optional, for also honouring Discord roles (moderators, a Room Host role,
   extra badges).
3. `npx wrangler deploy` prints `https://mefi-relay.<account>.workers.dev`.
4. `node scripts/smoke.mjs https://mefi-relay.<account>.workers.dev`.

## Free-plan budget

100,000 requests a day for the Worker and for the Durable Object; incoming
WebSocket messages count 20 to 1, and the keepalive ping is free. One awake
Hub object uses at most 10,800 of the 13,000 GB-seconds a day. Chat, presence
and pings write no rows. A signed-in Studio stays connected while it is open:
its keepalive is free and renewing its session is about 100 requests a day,
and The Lobby reads once a minute only while it is on screen. That fits a
community of several hundred people a day; past that, the $5 Workers Paid plan
lifts every limit.
