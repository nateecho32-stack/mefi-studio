# Reach your PCs from Discord

Your home PCs keep working while you are out, and you check on them and talk
to them from Discord. This page is the plan and the contract between Studio
and the Void Engine bot's rooms hub (the `void-engine-bot` repository).
Telegram comes later, through the same hub.

## What you get

- **A DM with the Void Engine bot is a remote for every PC you linked.** It
  answers only your own Discord account, and every reply says which PC
  answered.
- **Look:** `/studio status` (each PC's agents, what they build, what waits on
  you), `/studio needs`, `/studio made` (what is being built now and what
  finished today), `/studio digest`, `/studio pcs`.
- **Talk:** a plain DM goes to Mefi on your default PC (`/studio use <pc>`
  picks it) and Mefi's reply comes back. `/studio pause` and `/studio resume`
  stop and restart new work.
- **Alerts:** a DM when something needs you, when a task stops, when agents
  sit waiting, and a daily digest at the hour you choose. Each kind can be
  switched off, and quiet hours hold them back. The quiet hours are the same
  ones Windows notifications keep (Settings › General › Notifications): change
  them in either place and both follow.
- **Approvals with a PIN:** an approval shows an **Approve** button. It asks
  for the PIN you set in Studio in a Discord form, which never appears in
  the chat history.

## What Discord can never do

A message from Discord is treated like your own chat in Studio, with less
power:

- **Tasks started from Discord wait for your OK**, in every permission mode,
  and so do their slices. You give the OK in Studio, or with **Approve** and
  your PIN.
- **Approvals, answers, undo and closing tasks are Studio-only**, except
  Approve with the PIN.
- **Permissions, keys, settings, sharing and the vault never change from
  Discord.**
- **Five wrong PINs lock Discord approvals** until you unlock them in Studio,
  and the lock is sent to you as an alert.
- **Switching the remote off in Studio**, or unlinking Discord, ends it at
  once.

Why: builders run with their CLI's permission checks turned off. A stolen
Discord login that could start work without your OK could run code on your
PCs.

What passes through Discord and the hub: your messages, Mefi's replies, task
titles and short progress lines. Everything Studio sends there goes through
the same scrubber as a friend share first, so keys, tokens, paths, emails,
addresses and this PC's names are taken out. The hub keeps no message text.

## How it works

```
Discord DM / slash command
        │  (Discord gateway)
        ▼
void-hub (the bot and the rooms hub, on the hub PC, behind the tunnel)
        │  sends `remote` frames only to sockets of the same Discord user
        ▼  that turned the remote on (remoteHello)
Studio on each PC: one outbound WebSocket, no open ports at home
        │  scripts/remote.cjs decides what a command may do
        ▼  main.cjs "Discord remote" runs it and answers
```

Studio keeps the hub connection open while the remote is on, even with the
window closed to the tray. No port is opened on your home PCs.

## Protocol (hub protocol version 1, feature `remote`)

The hub lists `remote` in `ready.features` when `REMOTE_ENABLED=true`. Studio
sends none of the frames below to a hub without it. Unknown fields are
dropped on both ends.

### Studio -> hub

| Frame | Fields | Effect |
| --- | --- | --- |
| `remoteHello` | `pc: { id, name }`, `on: boolean` | Registers (or with `on:false` withdraws) this socket as one of the member's PCs. `id` is 1-64 of `[A-Za-z0-9_.:-]` (Studio's cowork `machineId`, `pc-<uuid>`); `name` is 1-40 characters, one line. A later socket with the same `id` replaces the earlier one. At most 8 PCs per member. The hub answers with `remoteState`. |
| `remoteReply` | `requestId`, `text` (1-1900), `buttons?`, `done?` (default true) | Answers a `remote` frame this socket received. The hub refuses a `requestId` that was not sent to this socket, or that is older than 5 minutes. At most one reply with `done:false` before the final one. |
| `remoteNotice` | `key` (1-64 of `[A-Za-z0-9_.:-]`), `kind`, `text` (1-1900), `buttons?` | An alert for the member's DMs. `kind` is `needs-you`, `done`, `failed`, `stuck`, `digest` or `info`. The hub drops a repeated `key` within an hour, and keeps to 20 alerts an hour per member. |

`buttons` is a list of at most 5 `{ id, label, style?, pin? }`: `id` is 1-48
of `[A-Za-z0-9_.:-]` (Studio's own name for it), `label` is 1-40 characters,
one line, `style` is `primary`, `secondary`, `success` or `danger` (default
`secondary`), and `pin: true` asks for the PIN first. The hub keeps each
button in memory for 24 hours and gives Discord a short opaque custom id, so
Discord never sees Studio's ids. A button pressed after that says it expired.

### Hub -> Studio

| Frame | Fields |
| --- | --- |
| `remote` | `requestId` (1-64 of `[A-Za-z0-9_-]`), `from` (the member's snowflake), `command`, `text?`, `buttonId?`, `pin?`, `sentAt` |
| `remoteState` | `pcs: [{ id, name, since }]`: the member's PCs that have the remote on (up to 8) |

`command` is one of `status`, `needs`, `made`, `digest`, `say`, `pause`,
`resume` and `button`. `text` (1-2000) comes with `say`, `buttonId` with
`button`, and `pin` (4-12 digits) only with a `button` whose `pin` was true,
taken from a Discord form. A `remote` frame goes only to a socket of the same
member that sent `remoteHello{on:true}`: to the PC the command named, to the
member's default PC for a plain DM, and to every PC for `status` and `pcs`
(the hub answers `pcs` itself). Studio also checks that `from` is its own
session's user.

### Discord side (the bot)

- **Intents:** DirectMessages, plus the Channel partial so DMs arrive. A DM's
  content reaches the bot without the MessageContent intent.
- **`/studio` command:** global, usable in the bot's DMs. Subcommands:
  `status [pc]`, `needs [pc]`, `made [pc]`, `digest [pc]`, `pcs`,
  `use <pc>`, `pause [pc]`, `resume [pc]`, `say <text> [pc]`. The `pc`
  option autocompletes from `remoteState`.
- **A plain DM** is `say` to the default PC (the one `use` picked, else the
  only one, else the one seen most recently).
- **Replies:** the bot defers the interaction, then edits it with the reply,
  prefixed with the PC's name. With no answer in 20 seconds it says that PC
  did not answer and asks whether Studio is running. A `say` gets an interim
  reply at once (`done: false`, "Mefi is on it…"); the bot shows it, then
  waits up to three minutes for the final reply and edits the same message.
  It never pings anyone (`allowed_mentions: { parse: [] }`) and suppresses
  link embeds.
- **DMs and the bot's own chat:** a plain DM goes to the remote only when its
  author has a Studio with the remote on connected, and such a DM never
  reaches the bot's persona or its model. Every other DM is left to the
  bot's own chat. Members with the remote on talk to the persona by
  mentioning the bot in the server or with `/chat`, and the remote's help
  says so.
- **Buttons with `pin`** open a modal with one 4-12 digit field. The PIN goes
  in the `remote` frame and is never posted, logged or stored.
- **Limits:** 10 commands a minute per member. Only members of the Void Engine
  server who linked Studio are served; anyone else is told how to link.
- **Kept:** ids and counts only, never message text. `/forget-me` drops the
  member's default PC and pending buttons.

## Studio side

- `scripts/remote.cjs` (pure): the command rules, the reply wording, the notice
  policy (keys, quiet hours, rate), PIN hashing (scrypt with a salt) and the
  lockout.
- `scripts/hub-client.cjs`: `setRemote`, `remoteReply`, `remoteNotice`; `remote`
  and `remoteState` events.
- `main.cjs` "Discord remote" block: `settings.remote` (on, PC name, alert
  choices, quiet hours, digest hour, PIN hash and lockout), keeps the hub
  connected while on, answers commands from `agentsSnapshot`, the needs-you
  digest and the companion's digest, sends `say` through `assistantMessage`
  with `remote: true`, and watches for alerts once a minute.
- The chat gate (`assistantRespond`): with `user.remote`, only `create_task`,
  `note`, `pause`, `resume`, `stop`, `work_on` and `retry` run. A task it files
  has `origin.via = "remote"`, and `autonomy.needsApproval` holds remote work
  and its slices for approval in every mode.
- Friends › Your PCs › **Reach this PC from Discord**: the switch, the PC's
  name, what the alerts cover, quiet hours and the digest hour, the approval
  PIN (set, change, remove, unlock), and the last 20 commands this PC answered.
- `settings.remote.quiet` (`{ from, to }` in 24-hour `HH:MM`, or null) is the
  one clock for quiet hours. The Windows notifications of Settings ›
  General › Notifications (`scripts/alerts.cjs`, main.cjs "Notifications") read
  and write it too, through `alerts:get` and `alerts:set`, and tell the Friends
  card (`remote:event`) when they change it; `tests/alerts.test.mjs` pins that
  both modules accept and reject the same windows and call the same minutes
  quiet. The Windows alerts keep it even when the remote is off.

## Order of work

1. Studio side against a fake hub (tests), then the settings section.
2. The bot side in `void-engine-bot`, on a branch until its newest commits
   (the companion relay) are on GitHub, then merged there.
3. End to end: Studio's real hub client against the real hub over loopback,
   with a fake Discord.
4. Live: the owner runs the hub with `REMOTE_ENABLED=true`, turns the remote on
   in each PC, and DMs the bot.
5. Later: Telegram, linked to the same member with a one-time code Studio
   shows, reaching the same PCs.
