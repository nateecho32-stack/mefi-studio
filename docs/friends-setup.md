# Setting up Friends across PCs

Friends › Playground lets companions on different PCs, each signed in with its
own Discord account, meet in a room and play. Studio's side ships in 0.4.5;
the companions reach each other through the Void Engine **rooms hub** (the
`void-hub` half of the private `void-engine-bot` repository), which one PC
runs and Cloudflare exposes. This guide sets that up once and joins three PCs.

What each piece needs:

| Piece | Where | Who does it |
| --- | --- | --- |
| Two Discord applications (the bot and **Mefi Studio Link**) | Discord Developer Portal | The server owner, once |
| The hub (`npm start` in `void-engine-bot`, `ROOMS_ENABLED=true`) | One PC (the "hub PC") | Once, then it runs at login |
| A public HTTPS address for the hub | `cloudflared` on the hub PC | Once |
| Studio 0.4.5 with the hub address and the link app id | Every PC | Once per PC |
| A Discord account in the Void Engine server, in the same room | Every PC | Each person |

## 1. Discord applications (once)

Follow `docs/runbook.md` sections 2 to 4 in `void-engine-bot`: create the
**Void Engine** bot application (its token goes only into the hub PC's `.env`,
never into chat or a screenshot), invite it with `npm run invite`, and create
the **Mefi Studio Link** application with **Public Client** on and the three
redirects `http://127.0.0.1:53134/callback`, `53135` and `53136`.

Write down the Mefi Studio Link **Application ID**. It is not a secret; Studio
and the hub both use it.

## 2. The hub PC (once)

In a clone of `void-engine-bot` on the hub PC:

```powershell
npm ci
npm test
Copy-Item .env.example .env
```

In `.env`, besides the bot settings from the runbook, set:

```
ROOMS_ENABLED=true
STUDIO_APP_ID=<the Mefi Studio Link Application ID>
ROOMS_CHANNEL_ID=<the #rooms channel id>
HUB_SESSION_SECRET=<node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))">
```

Then `npm run register` and `npm start`. The log should say `hub listening`
on `127.0.0.1:8787`. The hub must include the companion relay (commit "Relay
companion cards between Studios in a room"); `ready` then lists the
`companion` feature.

### A public address

For a first test, a quick tunnel needs no Cloudflare account or domain:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

It prints an `https://<words>.trycloudflare.com` address. That address changes
every time the tunnel restarts, so for everyday use set up the named tunnel in
`docs/runbook.md` section 8 (`hub.<your-domain>`), which keeps one address.

Check it from any PC: `https://<address>/v1/health` answers
`{"ok":true,"protocol":1,"paused":false}`.

## 3. Every PC

Update Studio (`git pull` on `main`, `npm ci`, or the portable build once it
is released). Until the release carries the addresses built in, give each PC
the two values once in **Settings › Community › Connection details**:

- **Link app ID**: the Mefi Studio Link Application ID.
- **Rooms hub address**: `https://<the hub address>` (or `http://127.0.0.1:8787`
  on the hub PC itself).

**Save** applies them at once, with no restart, and says whether the hub
answered. The environment variables `MEFI_STUDIO_DISCORD_CLIENT_ID` and
`MEFI_STUDIO_HUB_URL` still work and win over what is saved (Connection
details says so); `setx` only reaches programs started afterwards.

In Studio:

1. **Settings › Community › Link Discord.** Sign in with this PC's Discord
   account (each PC its own account). The account must be in the Void Engine
   server.
2. **Get into the same room.** Open the companion › **Friends** › **Rooms**
   and press **Connect**. On the PC whose account has the Room Host role (or
   is a moderator), press **Make a room**. On the other PCs the room appears
   with **Ask to join**; the owner's **Requests** tab shows each request with
   **Let them in**. (`/room request` in Discord works too, and owners can
   invite by name.) Then **Open** the room on every PC: companions meet
   while the room is open in Studio.
3. **Open the companion › Friends.** Within a few seconds the Playground shows
   the other PCs' companions. Every companion starts at **Play only**: look,
   mood and games, nothing about its owner.
4. **Play.** Press **Play with …** on a friend. **Practice with Pip** works
   on every PC even without the hub.
5. **Let agents work together (optional).** Make a **cowork** room, open it
   under Rooms on each PC and press **Use this room for this project's agents**.
   Builders then claim the files they edit there, and no two PCs' agents edit
   the same file at once.
6. **Reach your PCs from Discord (optional).** On the hub PC, set
   `REMOTE_ENABLED=true` in `.env`, run `npm run register` once for the
   `/studio` command, and restart the hub. On each of your PCs, open Friends ›
   Your PCs › **Reach this PC from Discord**, turn it on, name the PC, and set
   an approval PIN if you want to approve from Discord. Then DM the Void Engine
   bot: `/studio status` answers from every PC that has it on, and a plain DM
   goes to Mefi on your default PC (`/studio use <pc>`). What it can and cannot
   do is in [remote.md](remote.md). Turn on **Start with Windows** (Settings ›
   General › Profile & startup) on each PC you leave working, so it comes back
   after an update restart.

## 4. Checking it works

On each PC, Friends should say how many friends' companions are out. Then:

- On PC 2, set **What Nova shares with them** to **Status** for PC 3's
  companion. PC 3 sees PC 2's status, and is asked whether to share back;
  PC 1 still sees only play.
- On PC 3, answer **For this session**. PC 2 now sees PC 3's status too.
- On PC 1, set **This session** to **Stay home**. PC 1's companion leaves the
  other two Playgrounds, and **What was sent** on PC 1 lists "went home".
- **Play with …** between PC 2 and PC 3 shows the same scene on both screens,
  each from its own side.

The same exchange runs automatically in `tests/companion_e2e.test.mjs`
against the real hub with three simulated accounts:

```powershell
$env:MEFI_STUDIO_BOT_ROOT = "C:\path\to\void-engine-bot"
node --test tests/companion_e2e.test.mjs
```

## Troubleshooting

| Friends says | Meaning |
| --- | --- |
| "…the rooms hub, which this PC isn't connected to yet" | No **Rooms hub address** in Settings › Community › Connection details (and no `MEFI_STUDIO_HUB_URL`) |
| "Discord linking isn't set up on this PC yet" | No **Link app ID** in Connection details (and no `MEFI_STUDIO_DISCORD_CLIENT_ID`) |
| "Link Discord under Community…" | This PC has not linked Discord yet |
| Save says the hub did not answer | The hub is not running, its tunnel is down, or a quick tunnel's address changed since it was saved |
| "Connect under Rooms below…" | This PC is not connected to the hub yet: **Rooms › Connect** |
| "Open a room under Rooms below…" | Connected, but no room is open in Studio: **Open** one |
| "This rooms hub does not carry companions yet" | The hub is older than the companion relay; update `void-engine-bot` and restart it |
| "No friends' companions are out…" | Nobody else in your rooms has Friends open with sharing above Stay home |

Sign-in is refused when `STUDIO_APP_ID` on the hub and Studio's link app ID
are different applications, or the account is not in the server.
