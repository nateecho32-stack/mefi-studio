# Setting up Friends across PCs

Friends (Rooms, the Playground's companions, Listen together, cowork claims
and the Project hub) connects Studios through the **Mefi Studio relay**: a
small service on Cloudflare's free plan whose code is in this repository
under [`relay/`](../relay/README.md). No PC has to stay on for it, nothing
needs a domain, and the relay stores no chat: each Studio keeps its own copy
of a room's messages for a week.

Studio has the relay's address and the "Mefi Studio Link" Discord app built
in, so a PC only needs Studio and a Discord account in the Void Engine
server.

## 1. Every PC

1. **Settings › Community › Link Discord.** Sign in with this PC's Discord
   account (each person their own account). The account must be in the Void
   Engine server.
2. **Get into the same room.** Open **Friends › Rooms** and press
   **Connect**. Someone with the Room Host role (or a moderator) can make a
   listed room; anyone a week or more in the server can make an unlisted one
   and invite people by name. Others see a listed room with **Ask to join**;
   the owner's **Requests** tab lets them in. Then **Open** the room on every
   PC: companions meet while the room is open in Studio.
3. **Friends › Playground.** Within a few seconds it shows the other PCs'
   companions. Every companion starts at **Play only**: look, mood and games,
   nothing about its owner. **Practice with Pip** works without the relay.
4. **Let agents work together (optional).** Make a **cowork** room, open it
   on each PC and press **Use this room for this project's agents**. Builders
   then claim the files they edit, and no two PCs' agents edit the same file
   at once.
5. **Project hub (optional).** **Friends › Project hub** lists members'
   shared projects as a star map and as lists. **Share** adds yours: a public
   link (itch.io, GitHub Pages, a store page), a title and a line about it,
   never a file. Sharing is free and earns nothing by itself. When a member
   plays someone else's project for two minutes, both earn credits (the maker
   5, the player 2); a star earns the maker 3; at most 60 a day. Credits are
   never bought; 100 features a project at the top of the hub for a day.
   Ranks go Spark, Ember, Flame, Comet, Star, Nova, Void by lifetime credits,
   and your Discord roles show as special ranks.

## 2. Checking it works

- Friends › Rooms says **Signed in as …** after Connect.
- A message sent on one PC appears on the other at once. Close Studio on one
  PC, send a few messages from another, then open the room again: the
  messages you missed are filled in from the other members' copies.
- On PC 2, set **What Nova shares with them** to **Status** for PC 3's
  companion; PC 3 sees PC 2's status, and PC 1 still sees only play.
- **Play with …** between two PCs shows the same scene on both screens.

The same flows run in `tests/relay_e2e.test.mjs` (Studio's real client
against the real relay under Node), and `relay/scripts/smoke.mjs` checks the
live relay: `node relay/scripts/smoke.mjs https://mefi-relay.mefi-studio.workers.dev`.

## 3. Pointing a PC somewhere else (testing)

**Settings › Community › Connection details** overrides the built-in values,
and the environment variables `MEFI_STUDIO_HUB_URL` and
`MEFI_STUDIO_DISCORD_CLIENT_ID` win over both. A relay run on this PC with
`npx wrangler dev` (relay/README.md) answers on `http://127.0.0.1:8787`.

## 4. Reaching your PCs from Discord

The Discord remote ([remote.md](remote.md)) needs the Void Engine bot linked
to the relay, which is not done yet. Until then Friends › Your PCs says the
rooms service does not carry the Discord remote.

## Troubleshooting

| Friends says | Meaning |
| --- | --- |
| "Link your Discord account…" | This PC has not linked Discord yet: Settings › Community › Link Discord |
| "Not connected to the room service" | Press **Connect**; if it keeps failing, check that this PC is online and that `https://mefi-relay.mefi-studio.workers.dev/v1/health` opens |
| "Only members of the Void Engine server can use rooms" | The linked Discord account is not in the server |
| "Making your own rooms opens after a week in the server" | Unlisted rooms need a week in the server; ask a Room Host meanwhile |
| "New members can share links after their first day" | The server's day-one rule, for chat, listening and the Project hub |
| "This room service has no project hub yet" | Connection details point at an older Void Engine hub instead of the relay |

The relay's own limits, what it keeps and for how long, and how to deploy a
copy are in [relay/README.md](../relay/README.md).
