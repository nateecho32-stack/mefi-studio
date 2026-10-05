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
| Your Discord id, display name, roles, server join date and timeout | sign-in, room rules ("Room Host", "a day in the server"), member search | until 2 years without signing in, or `POST /v1/me/forget` |
| A keyed hash of a Discord token already checked | a renewal does not ask Discord again | until the token expires, at most 7 days |
| Rooms, who is in them, join requests, invites, removals | rooms | 30 days after a room closes or a request is answered |
| A room's shared player: link, label, position | listen together survives the relay sleeping | while it plays; ends after 30 min paused or 6 h idle |
| Cowork claims: paths, branch, title | agents on different PCs do not edit the same files | 7 days after release |
| Deleted message ids | a peer's copy cannot bring a deleted message back | 7 days |
| Whether you chose not to show in Who's online | the "Show me as online" switch | until you change it, or forget me |
| Reports: the reason, plus the reported message only when its relay signature checks out | moderation | 30 days |
| Moderator actions (ids only) | accountability | 90 days |

Forget me (`POST /v1/me/forget`) deletes every row about you and closes the
rooms you own. Observability is off in `wrangler.toml`. Who's online and The
Lobby's front page (`GET /v1/front`) are read from the live connections when a
member asks; nothing about who was online, or when, is written. An unlisted
room's name never appears on anyone else's front page.

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
`STUDIO_APP_ID=100000000000000001`, `DISCORD_API_BASE=http://127.0.0.1:8799` and
`ROLE_IDS_JSON={"room_host":"300000000000000001"}`, then

```bash
node scripts/smoke.mjs http://127.0.0.1:8787 --fake-discord 8799
```

## Deploying

1. A free Cloudflare account, then `npx wrangler login` in this folder.
2. Fill in `[vars]` in `wrangler.toml`: `STUDIO_APP_ID` (the Mefi Studio Link
   Discord application), `OWNER_IDS`, and the role ids in `MOD_ROLE_IDS` and
   `ROLE_IDS_JSON` (`room_host`, and the rank roles).
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
