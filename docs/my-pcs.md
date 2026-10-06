# My PCs: your own computers working as one

The owner works from several PCs. **My PCs** (Friends › Your PCs) shows every
one of them that is on, what it has free and what it is doing. It moves
waiting work to a PC with room when one is short of memory or battery, and it
starts work on another PC from the one in front of you. A laptop low on
battery finishes up, hands its started work to the others and waits for you.
A friend can lend you their PC the same way, and every task you send there
waits for their OK unless they chose otherwise.

This is not remote control. A PC never sees another's screen, files or keys.
PCs send each other task cards, short status lines and git branches, and each
PC runs work with its own agents and its own subscriptions.

## What you see

- **Each PC's row:** its name, This PC, online or "offline since …", CPU,
  free memory, the battery (or "plugged in"), what runs against how many it
  may run, and why it is not taking work when it is not.
- **Keep this PC on:** a switch that keeps the PC awake with nothing running,
  so the others can send it work. It holds only while the PC is plugged in.
  Keeping it awake while work runs stays the assistant's own switch in
  Settings ("Keep this computer awake"). Closing a laptop's lid still
  follows Windows' lid setting; Studio never changes power settings.
- **Send work here:** a new task (a title and a brief), or one of the open
  project's ready cards, for a paired PC that has the project open. It runs
  there as your own work, and the answer comes back to "Sent from here".
- **Out on other PCs:** the open project's cards that moved, with Bring back.
- **Each project's switch:** "My other PCs may take this project's work". On
  by default for a project with a GitHub repository; a project without one
  stays on this PC.
- **Handoffs:** work a PC parked for the others, with Pick up and Drop.
- **Pair a PC / Lend this PC:** below the list.

## Pairing: the numbers on both screens

Every PC signs in to the Friends relay with the same Discord account. That
alone lets a PC see the others' rows, never send them work: a Discord login
must never be enough to run code on your PCs (the same rule as
[remote.md](remote.md)).

1. On PC A choose **Pair** on PC B's row.
2. Both screens show six numbers made from both PCs' keys.
3. On PC B, if the numbers match, choose **Pair**. Not mine refuses it.

Each PC keeps an Ed25519 signing key and an X25519 key, made on first use and
kept with the operating system's encryption (`safeStorage`); pairing is
unavailable without it. A paired PC is remembered by its keys. Forget removes
it on both sides when the other is online, and on this side at once. Up to 16
paired PCs.

The relay could swap keys, but then the two screens show different numbers.

## The rules that keep the queue small

- **Moved, never copied.** A task that goes to another PC stays on this PC's
  board as "On Desktop", not runnable here. When Desktop finishes it, the card
  here is done too. Bring back returns a card Desktop has not started.
- **Pull, not push.** A PC takes offered work only while it has a free slot
  right then. It never queues work for later. An offer it cannot take now is
  declined and the card stays where it was. An offer lapses after 2 minutes.
- **Per project.** At most 2 of a project's cards are out on other PCs at
  once, and a card that was moved once is never moved again automatically.
  Only ready cards move: nothing waiting for you, nothing started, nothing a
  friend sent, never the card you pinned to go next.
- **Only to the open project.** A PC runs work for the project it has open
  (`spawnNextJob`), so it takes work only for that one; a card for another
  project would only wait there.
- **One handoff per project per stop**, and at most 3 parked handoffs per
  project. Past that the work stays on the PC that made it (its own progress
  is saved either way) and the row says so.
- Nothing moves to a friend's PC by itself. You send it there.

## When work moves by itself

A PC is **short** when:

- its battery is at or under the low line (20%) and it is not plugged in, or
- Studio's own capacity check (`autopilot.capacity`, scripts/machine.mjs
  `workerCapacity`) has held new work for memory for 2 minutes while ready
  cards wait, or
- every one of its slots has been busy for 2 minutes while ready cards wait:
  this is how the queue is split between PCs, so a card that would only
  wait here runs where a slot is free.

Then, every 30 seconds, it offers the open project's ready cards to one of
your paired PCs that has the project open (same GitHub repository), the
project's switch on, a free slot, no battery under 40% unplugged, and is
taking work. Plugged-in PCs come first, then the most free slots, then the most
free memory. While the offer is out the cards wait here ("Offered to Desk"),
so this PC cannot start them too. A declined card says why on its log: its
slots are full, it does not have or share the project, the project is not
open there, it already has the task, or it is not taking work.

## Battery

| Battery (not plugged in) | What the laptop does |
| --- | --- |
| above 20% | Works normally. |
| 20% or less | Starts nothing new and finishes what is running. Ready cards are offered to your other PCs as above. Back to normal at 25% or when plugged in. |
| 10% or less | Stops its running tasks with their progress saved, parks their changes as one handoff per project, releases Keep this PC on so it may sleep, and waits for you. Plugging in does not start it again: choose **Continue**. |

After Continue below 10%, it stops again 4 points lower (and always at 3%).
The lines are settings (`settings.pcs.battery.low`, `.stop`; 10 to 50 and 5
to 30, low above stop).

Studio reads the battery from Windows (`Win32_Battery` through PowerShell):
every 5 minutes on mains power; on battery every 3 minutes above 40%, every
minute under it and every 30 seconds under 25% (one PowerShell call each). A PC without a battery is looked at again every 30 minutes (a
docked laptop). `powerMonitor`'s on-battery and on-ac events read it at once.

## Handoffs

A handoff is a git branch on the project's own GitHub repository:
`mefi/handoff/<pc>-<date>-<time>`. It is as visible as the repository: a
public repository's handoffs are public. Studio builds its commit from a
temporary index: HEAD plus the files changed since the first stopped run
started (a deleted file only when a card named it), so the working tree, the
index and HEAD of the PC that parks it are never touched. The commit message
names the PC, why it stopped, each task's brief and its last log lines, and
ends with one `Mefi-Handoff:` line of JSON that Studio reads back. Only a
project whose switch is on is parked; otherwise the work stays on this PC with
its progress saved.

Another PC lists the open project's handoffs with `git ls-remote` every five
minutes, and at once when a paired PC says it parked one. Pick up first checks
that the changes apply to its working tree (`git apply --check`), then deletes
the branch with a lease on its exact commit, so two PCs cannot both take it,
then applies the changes to the working tree only (nothing staged) and puts
the tasks on its board with a note to carry on, not start over. If the changes
do not apply after all, the branch is pushed back and the row says why. A PC
that is taking work picks up a handoff from one of the owner's paired PCs by
itself when the changes apply cleanly; any other waits for Pick up. Drop
deletes the branch after a native question (Cancel by default).

**Continue** on the laptop that parked it first looks at GitHub: a handoff
still there is taken back (deleted with the same lease) and its cards run
here again; a card whose handoff another PC already picked up stays on that
PC ("On another PC") and is marked done when that PC finishes it. When GitHub
cannot be reached, Continue says so and changes nothing.

## Lending a PC to a friend

**Lend this PC to a friend** finds people by name (Friends' member search);
the relay counts a lend only to someone you share a room with. While it is
on, that person's PCs can see this PC (its name, whether it takes work and how
busy it is, never its projects) and pair with it. Each task they send:

- waits for your OK on this PC (an owner's hold of kind "friend": say "work
  on it"), unless you ticked **Run without asking** for them,
- runs with this PC's agents and subscriptions, in this PC's clone of their
  project, which must be the open project here (otherwise it is refused and
  says so),
- shows who sent it, and goes back to them as done or not done.

Nothing moves to a friend's PC by itself. Stop lending removes their pairing
here at once.

## Protocol (relay feature `pcs`)

The relay lists `pcs` in `ready.features`. Studio sends none of these frames
to a relay without it. The relay keeps a PC's id, name, kind, public keys and
lend list on its socket only, and stores nothing.

### Studio -> relay

| Frame | Fields | Effect |
| --- | --- | --- |
| `pcHello` | `pc: {id, name, kind}`, `keys: {sign, box}`, `lendTo: [userId]` | This socket is PC `id` (the cowork machine id, `pc-<uuid>`), `kind` `desktop` or `laptop`, keys base64 raw 32 bytes, up to 8 user ids. Sent after each `ready`; sent again on any change. A lend to someone the member shares no room with (the Lobby aside) is dropped. At most 20 a minute per socket (`error rateLimited` past that). |
| `pcState` | `state` (object, up to 3 KB as JSON) | Forwarded as `pcState` to every socket that can see this PC. `state.projects` goes only to the owner's own sockets. At most 6 a minute per socket. |
| `pcSend` | `to` (pc id), `env` (object, up to 12 KB), `nonce`? | Delivered to the socket that is PC `to` when the sender may reach it; acked or nacked `not-online` / `not-allowed`. At most 60 a minute per socket. |

### Relay -> Studio

| Frame | Fields | When |
| --- | --- | --- |
| `pcs` | `pcs: [{id, name, kind, owner: {id, name}, mine, lends, keys, since}]` | After this socket's `pcHello`, and to every viewer when a PC it can see says hello, changes, or closes. Up to 16, never this socket's own PC. |
| `pcState` | `from` (pc id), `state` | A visible PC's status. |
| `pcMsg` | `from` (pc id), `fromUser`, `fromName`, `keys`, `env` | A `pcSend` for this PC. `keys` are the sender's, as it said them in `pcHello`; `fromName` is its member's name. |

**Who sees whom.** Viewer V sees PC P when P is another socket of V's own
user (`mine: true`), or P's lend list holds V's user id (`lends: true`). A
`pcSend` from S to T is delivered when S and T are the same user, T lends to
S's user, or S lends to T's user (so a lent PC can answer). A lent PC does not
see the borrower's PCs, so it takes their keys from the `pcMsg` that carries
their pairing ask. Two sockets that say the same PC id are listed once (the
member's own before a lent one, then the latest `pcHello`), and a `pcSend`
goes to that one.

### Envelopes

`env` is `{v: 1, k: "pair" | "sealed", ...}` (scripts/pc-trust.cjs):

- `pair`: `{from, to, at, n, step: "ask" | "ok" | "no" | "forget", relation:
  "mine" | "borrow", name, sig}`, signed with the sender's signing key over
  `pcs1|pair|from|to|at|n|step|relation`. Keys come from the relay's `pcs`
  roster, or from the `pcMsg` for a borrower's PC; the six numbers are the first 20 bits of
  `sha256("pcs1|sas|" + sorted(signA + boxA, signB + boxB).join("|"))`,
  shown as `123 456`.
- `sealed`: `{from, to, at, n, iv, ct, sig}`. `ct` is AES-256-GCM of the
  body's JSON under HKDF-SHA256(X25519(mine, theirs), salt `pcs1|<ids
  sorted>`, info `mefi-pcs-v1`), with `from|to|at|n` as associated data; `sig`
  is Ed25519 over `pcs1|sealed|from|to|at|n|iv|ct`. A receiver refuses an
  unpaired sender, a bad signature, a time more than 10 minutes off, and a
  nonce it has seen.

Sealed bodies (`{type, ...}`):

| type | Fields | Answer |
| --- | --- | --- |
| `offer` | `offerId`, `project {key, name}`, `why` (`battery`, `memory`, `busy`, `you`), `tasks: [card]` (up to 4) | `offerReply {offerId, taken: [{id, as}], declined: [{id, reason}]}` |
| `start` | `reqId`, `project {key, name}`, `title`, `prompt` | `startReply {reqId, ok, taskId?, held?, error?}` |
| `done` | `taskId` (the sender's card), `as`, `outcome` (`done`, `failed`, `dropped`), `note` | none; resent until the origin is online (outbox, 14 days) |
| `recall` | `taskId` | `recallReply {taskId, ok, error?}` |
| `handoff` | `project {key, name}`, `branch`, `sha`, `titles` | none: the receiver may pick it up |

A card is `{id, title, prompt, details?, files?, intent?}`: the title as on
the board, the brief up to 6,000 characters, at most 40 files.

A project's key is `p-` and the first 16 hex characters of the SHA-256 of its
GitHub `owner/name` in lower case, so the relay sees no repository name in a
key; the name beside it is the project's display name.

## State line (`pcState.state`)

```
{ v: 1, at, name, kind, cpu, freeMB, totalMB,
  battery: { level, plugged } | null,
  stage: "ok" | "low" | "stopped",
  stayOn: "off" | "working" | "always", awake,
  slots: { running, max, canStart, hold },
  accepting,
  projects: [{ key, name, open, share, queued, running }] }
```

Sent when it changes (at most every 10 seconds; CPU and free memory alone
are not a change) and at least every 60 seconds while the relay is connected.
A PC whose last line this PC heard more than 3 minutes ago is shown as not
answering, and is never offered work.

The page reads `pcs:status` with a watch lease (90 seconds, renewed every 45
while My PCs is open); main pushes `pcs:event` only while one is held. The
board is read for offers only while this PC is short, an offer is out, or a
card from another PC may have finished.

## Where it lives

- `scripts/pc-power.cjs`: battery reading and the low/stop stages (pure, the
  spawn is injected).
- `scripts/pc-trust.cjs`: keys, the six numbers, sealing and opening (pure,
  Node `crypto`).
- `scripts/pc-fleet.cjs`: the state line, offer planning, taking offers,
  project keys, the outbox (pure).
- `scripts/pc-handoff.cjs`: parking and picking up handoff branches (git is
  injected).
- `main.cjs` "My PCs": loaded on first use; `MEFI_STUDIO_NO_PCS=1` switches
  it all off. Wiring, the `pcs:*` IPC channels (`status`, `set`,
  `pair`, `pair-answer`, `forget`, `start`, `move`, `recall`, `continue`,
  `handoffs`, `pick-up`, `drop`), the dispatch gate (`spawnNextJob` returns
  `"battery"`), Keep this PC on (`applyKeepAwake` reads `pcsAwakeWanted`), the
  battery stop and the relay connection at launch (`hubPresenceWanted` also
  connects a paired or lent PC). Files: `userData/pcs/` (identity, paired PCs,
  outbox, sent work).
- `scripts/backlog.cjs` `workState`: a moved card waits ("On Desk: it runs
  there and reports back"); battery, friend and came-back holds say so.
- `relay/src/pcs.mjs`: the relay side; `scripts/hub-client.cjs`: `setPc`,
  `pcState`, `pcSend` and the `pcs`, `pcState`, `pcMsg` events.
- `renderer/pc-fleet.js`: the My PCs section of the Your PCs card, mounted
  by `renderer/pc-sync.js`; its styles are in `renderer/companion-hub.css`.
- Tests: `pc_trust`, `pc_power`, `pc_fleet`, `pc_handoff` (real git),
  `pcs_host` (the main block, several PCs on a fake relay), `pc_fleet_ui`,
  `relay_pcs`, `hub_client_pcs`.
