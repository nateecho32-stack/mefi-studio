# Changelog

All notable changes to Mefi's Studio AI+ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json`. History before the extraction into this repository on
2026-09-19 is not recorded.

## [Unreleased]

### Fixed
- Home first displays an existing project conversation at its newest message,
  including when the conversation loaded before Home was visible; scrolling
  back to read older messages remains undisturbed by new updates.
- The Task board labels its grouped overview as cards and explains why its
  card total differs from task filter counts.
- Clicking M+ again closes the Projects panel when the navigation rail is on.

## [0.3.0] - 2026-09-22

One navigation rail, Brain maps as a real node editor, ad-free radio, model
routing split by role, and an agent loop that finishes what it starts.

### Added
- **Loop guard and memory alignment.** The keeper now keeps a small count on
  every card of the failures its own brief caused (charged run failures, and at
  most one failed verification per attempt), and holds a card that reaches 6 of
  them, or the same verification reason 4 times, since the owner's last *Try
  again*. Provider outages, restarts and stops are never counted; *Try again*
  or *Work on it* releases the hold. The same pass brings each card's memory
  folder in line with the board: a run's "finished, verifying" claim is an
  observation until the verifier speaks, the verdict is written back, finished
  cards' notes stop reaching other workers' primer, and owner notes are never
  evicted. `node tools/memory_audit.mjs` prints the whole picture read-only:
  every card as done, doing, review, stopped, stalled, looping or would-hold,
  where memory and board disagree, duplicate card families and duplicate
  lessons. Switches: the `memoryAlign`, `loopGuard` and `loopGuardApply`
  prefs. See docs/agent-loop.md §10.
- **Planning and reading can each answer through their own provider, and
  OpenCode Zen is a route.** Settings › Model routing gains *Routine answers
  via* and *Heavy answers via*: leave either on *Same as above* and routing
  is unchanged, or send heavy passes (plan specs, briefs, reviews, the
  analyzer read) to one provider and routine passes (reading the ask,
  checks, chat) to another. Each role's model field names the provider it
  saves to, and its placeholder shows the model that role runs while the
  field is empty. The Assistant overview pill names a split, such as "plans
  on Claude Code CLI · reads on OpenCode Zen". **OpenCode Zen** joins the
  providers, with its own tile under Providers, and the auto order. It is
  billed to the Zen balance; the key it uses also serves Jev's Zen route, and
  opencode's own `OPENCODE_API_KEY` counts when nothing is saved. OpenAI's models
  there only answer the Responses API, so a `gpt-*` model is sent to
  `/zen/v1/responses` and read back as a chat reply; the rest of Zen's catalog
  stays on chat completions. Plan specs, brain drafts and the analyzer read
  may now ride Claude Code: it is spawned with `--tools=`, so it has no tools
  to turn a discussion into a change. Every other CLI still keeps those calls
  on HTTP, and a failed Claude Code turn falls back once to the keyed HTTP
  routes.
- **Ad-free radio in Style & sound.** A new source tab plays twelve
  listener-funded stations from SomaFM and Radio Paradise, stations that
  carry no advertising at all, through Studio's own player, so the node tree
  reacts to them like a local file. Every station lists verified mirrors:
  when one stalls, drops, ends or never answers, the next comes up on a
  second deck and is crossfaded in, so a lost connection costs a fade instead
  of the music. The last station is remembered but never starts by itself.
  The booklet's CSP gains `media-src` for exactly the four stream hosts, plus
  a `no-referrer` policy, because SomaFM refuses stream requests that carry a
  Referer and `<audio>` has no `referrerpolicy` attribute.

### Changed
- **One navigation rail replaces three menus.** A rail down the left edge now
  holds every destination in the app, grouped **Home**, **Work**, **Live**,
  **Models** and **Settings**, with Key commands, Start here and Shortcuts at
  its foot. It replaces the tabs row, the Command dock and the hover sidebar's
  navigation rows, which each listed the same places their own way. At rest it
  is five named icons; hover or Tab into it and it opens over the page to show
  every destination and its key, without moving anything. **Keep open** pins it.
  The rail's **M+** opens the project panel, which used to hide behind a
  transparent 6px strip at the window's edge. **Switch navigation: rail or
  classic** in `Ctrl K` brings the old menus back.
- The Work rail lists **Current work** first again, ahead of the agent roster,
  so what is running stays on screen however many agents are listed.
- **Brain maps is a proper node editor.** The canvas pans and zooms (scroll,
  Ctrl + scroll, drag empty canvas, **F** to fit) and opens on the whole
  pipeline, with titles drawn large when zoomed out and a minimap once part of
  the map is off screen. Wires are drawn by dragging from end to end, and a
  wire let go on empty canvas opens the parts search with the parts that fit
  first. Parts, the parts rail and the wires that leave them carry their stage
  colour and icon; parts that move a real switch are marked, map-run parts are
  badged and notes show their text. Every edit can be undone with Ctrl Z,
  several parts can be picked, moved, copied and deleted together, F8 walks
  the problems, Ctrl F finds a part on the map and Tidy lines a map up in
  pipeline order. The header is one row with one primary action and a Map
  menu; the inspector leads with what going live would move and keeps its
  place while you edit. Closing the editor keeps unsaved edits for the next
  time it opens instead of asking. `?` shows the legend and every shortcut.
- **A model route that keeps failing is paused instead of retried every
  turn.** Three failures in a row from one provider — a refused key, an
  exhausted quota, a transport error, a timeout, or a CLI that did not
  answer — now pause it for 30 seconds. While it is paused the next route in
  the auto order answers straight away, a paused CLI is not started at all,
  and the connection log names the route and its last error. After the pause
  one probe call is let through; saving a key, changing the routing or
  running auto setup lifts every pause at once. An unusable reply does not
  count, because the route did answer. Until now a route that timed out cost
  every assistant turn up to 120 s (180 s for a CLI) before the fallback was
  tried.
- **The agent loop does less twice and says less that means nothing.** The
  autopilot tick no longer repeats the roster's work: with a key set, the
  briefer, watcher and auditor already brief and scan on their own cadences,
  and the foreman the tick wakes already settles, promotes and dispatches.
  On the live install that was about 30 extra paid brief calls an hour.
  Housekeeping reads the board with a plain read instead of a no-op
  transaction. Idle passes stop posting "0 queued" rows to the Command feed.
  A claim writes no "autopilot picked up task" line; that was a third of all
  card log lines, and half of them belonged to claims released before any
  worker started. Claims and releases no longer snapshot the whole task into
  its history: status and run id are not brief context. Each release now
  records its reason in the executor log. A finished run writes one line
  naming the checks it queued instead of two. Worker transcripts lose colour
  codes and sentinel echoes. Cluster advice keeps size markers instead of
  raw text, which had been 42% of the saved history. The waiting reason is
  pushed only when it changes, and the Workspace re-reads only the backlog
  when a push arrives. In the loop monitor's steady hour, board transactions
  fell from 134 to 99, log lines from 135 to 87 and host CPU from 257 to
  112 ms, with every card settling exactly as before.
- **The Policy Lab records a pick only once its worker starts.** Its
  experience log grew about 3 MB a day, and a third of its decision records
  were for picks released before any worker started, which the Lab's own
  analysis never reads. Held and empty passes are still recorded, once per
  distinct held set.

### Fixed
- Automatic answers to a card's own issue no longer erase its retry budget: an
  auto-settled run-failed, verify, blocked or check-failed issue used to call
  Retry, which cleared `runFailures`, `verifyAttempts` and the backoff, so
  the five-failure and three-verification parks never tripped. The assistant
  now records its decision ("Assistant decided: …") and leaves the card on
  settle's own backoff; a map with no triage node answers nothing by itself.
- A provider outage (usage limit, rate limit, API unreachable) no longer spends
  a card's tries: settle requeues it on an outage backoff (5 min doubling to
  2 h) with no attempt charged, until another run on the same route succeeds
  or the card has sat out 7 outages.
- "Split the extra work out" no longer nests `Follow-up: Follow-up: …` cards
  without lineage; splits are titled `Follow-up 2/3: …`, carry
  `splitFrom`/`splitDepth`, stop at depth 3, and a split answered after the
  card finished still creates its follow-up without reopening the card.
- The overseer's playbook keeps its learned hot and cold file paths across
  reviews (every review used to drop them), merges near-duplicate lessons and
  retires local-finding lessons that have stayed clear for four reviews.
- **A builder model you pin runs, whatever the route.** Under the Auto coding
  tier, a model pinned for OpenCode was ignored whenever routing pointed at
  z.ai, and builders ran the GLM pair instead, although Settings said a
  pinned model wins. Any provider/model pinned there now runs on every route.
  Only the first scan's free suggestion still yields to the z.ai coding plan.
- **Brain maps: New, Duplicate and Build with AI work in the app.** All three
  asked their question with `window.prompt`, which Electron does not
  implement, so they silently did nothing; they now ask in a panel inside the
  editor, and a new map is kept locally until it has a part, since the host
  refuses to save an empty one. Dragging a part no longer throws it to the top
  corner (the grabbed element was rebuilt before it was measured), and wires
  can be clicked, hovered and deleted again (the parts layer covered them).
  Switching maps no longer throws away unsaved edits without asking, and
  Make this live no longer carries on when the save before it failed.
- **Brain maps: the host's empty-map switch is reachable, and a map that
  calls another brain no longer lists a false problem.** The editor asked to
  keep an empty map by putting `allowEmpty` on the map, and the preload bridge
  forwards only the map, so the host refused every such save with "A brain
  map needs at least one node." The request now rides beside the map, as
  `brainsSave(map, { allowEmpty: true })`; a flag on the map itself still
  counts for nothing. The map switcher checked each map without the other
  saved maps, so every configured **Another brain** part read as calling a
  missing map and a clean map showed "· 1 problem"; the list now checks
  against the saved maps, as the editor already did.
- **Run smoke and Launch Ruins Runner start the game again.** Both handed
  cmd.exe a hand-quoted script path, and Node re-escaped those quotes into
  `\"`, which cmd cannot read, so every launch failed with
  `'\"…\Run Game (LOVE2D).cmd\"' is not recognized` — whichever folder the
  game lived in, since both script names contain spaces. The line is now
  built by `scripts/windows-command-line.cjs` (ported from BetterC0de; see
  `THIRD_PARTY_NOTICES.md`) and passed verbatim, and a game folder whose path
  cmd cannot carry is refused with a message instead of launched mangled.
- **Hand-off chains finish instead of stalling forever.** A run at the
  chain's depth limit is told not to hand off; when it printed `MEFI_NEXT`
  anyway, the line still became an obligation on its card that nothing
  could ever discharge, since no child is admitted past the limit. The
  card failed verification three times, re-running its worker each time,
  and was parked, while every card above it waited on it for good. One
  task that used the hand-off protocol as written grew into a 15-card tree
  with none of it done after four hours. Such lines are now declined and
  named on the card's log. The same tree now finishes: 15 runs, all 15
  cards done, where before it took 31 runs and finished none.
- **A slow worker CLI no longer means nothing ever completes.** The
  wedged-start watchdog killed any run that was silent for three minutes,
  so a runner that reliably needs three and a half minutes to print
  anything was killed on every card, forever. The start budget now learns
  from the runs that do start — never less than twice the slowest of the
  last eight — and widens 1.5x after each kill, up to twice the base, with
  a ten-minute ceiling. With first output at 3.5 to 5 minutes, nine tasks
  went from none done in two hours (19 kills, 57 slot-minutes burned) to
  all nine (3 kills, 9 slot-minutes). Runs that genuinely never speak now
  cost about a fifth more slot time before they are killed.
- **A retry is no longer verified by an earlier attempt's check.** A card's
  overseer check result was never cleared. A later attempt that changed
  nothing and ran nothing was accepted on the old run's pass; on the live
  board that is how 26 cards reached Done. The result now counts only for the
  attempt it was queued for. A stale failure no longer reopens a later
  attempt, and a Done you set by hand is no longer reopened by one either.
  The verdict names who ran the check, and a retry's note carries the failing
  command and its output, which the next worker's brief quotes.
- **Long result lines are kept.** A worker's `MEFI_RESULT` line over 300
  characters was dropped whole. 13 of 30 recent reports were lost that way,
  and with them the overseer check they should have queued. Long lines are
  now clipped instead.
- **Failure notes name the failure.** A run's recorded last line was often a
  bare colour-reset code, so the card, the feed and the next worker's prompt
  said "failed: \u001b[0m". Tails are now colour-stripped and blank-free.
- **Stale snapshot locks are swept.** The sweep that clears an OpenCode
  snapshot `index.lock` left behind by a killed worker threw before removing
  anything, on every call.
- **The Command header shows Pause.** A stale waiting reason ("waiting ·
  tasks cooling down") no longer outlives a pause or a stop, and the
  Assistant hub's working and queued counts no longer blink off on every
  status push.
- **The worker's collaboration advice is no longer cut mid-sentence.** Its
  file-ownership and live-editor instructions were clipped to 320 characters,
  less than its own parts.
- **A slow worker start no longer shrinks your manual worker limit for good.**
  In manual mode each stalled start lowered the pool by one and saved that as
  your setting, and nothing ever raised it again, so one slow stretch could
  leave Studio at one worker. The pool is now lowered for the session only,
  steps back up by one after three normal starts in a row, and your saved
  limit is never overwritten. Changing the limit or the mode yourself ends the
  narrowing at once. A limit an earlier version already lowered stays saved;
  set it back once in Workspace.
- **A claim released for machine pressure keeps its advice.** A quarter of
  claims were dropped when memory or responsiveness dipped during the
  planner/reviewer advice, and the next claim of the same card paid for the
  same two calls and code search again. The answered advice is now reused for
  30 minutes until a worker has run on the card; advice where both advisors
  failed is asked for again.

### Security
- **Coding workers no longer inherit Studio's own keys.** A headless or
  container install hands Studio its keys as `MEFI_STUDIO_*_KEY` and
  `MEFI_STUDIO_GITHUB_TOKEN` variables, and every child process inherited all
  of them — including the coding workers, which run repository-driven
  commands with their approvals bypassed — although no child reads them.
  `scripts/platform.cjs`, the spawn every child goes through, now withholds
  them. Names other tools share (`GH_TOKEN`, `OPENROUTER_API_KEY`) and
  Studio's settings variables (`MEFI_STUDIO_REPO`, `MEFI_STUDIO_PORT`, …)
  still pass through, and a key a child needs is still handed to it under its
  own name.

## [0.2.0] - 2026-09-22

First public release: a portable Windows build published to GitHub Releases,
which installed copies pick up through the in-app updater.

### Added
- **`tools/monitor_loop.mjs`** runs the real agent loop against a virtual
  clock — an hour of loop time in about a second — and reports where each
  card's time went, what each pass cost and how the board moved, across five
  worker-behaviour scenarios. See [docs/agent-loop.md](docs/agent-loop.md) §9.
- **Brain maps.** The agent pipeline as an editable graph (**B**, sidebar,
  Command dock or palette): typed parts, typed ports and wires between them.
  The shipped map is the loop the studio already runs, drawn out; editing the
  live map changes the decision rules straight away, while making a map live
  shows exactly which switches it moves (build approval, dispatch, briefing,
  Jev, model choice) and waits for your confirm. **Build with AI** drafts a map
  from a sentence — the reply is normalized and validated, never executed.
- **A decision lane for agent issues.** Runs file what needs you as issues
  instead of only prose: blockers, decisions and notes are triaged by the live
  brain map's rules, surface as ask cards with the task, check and last output
  lines they came from, and link back to the triage part that decided to ask.
- **Inspect mode in Command view.** Clicking a node hands its detail the whole
  right rail at full window height, and every other surface retreats to its own
  edge: the rail's tabs become a 56px icon column, the dock folds to its
  **More tools** pill, **Legend** and **Usage** keep their glyphs and drop their
  words, and the view toolbar goes glyph-only. Nothing is removed — each
  collapsed edge peeks back on hover or keyboard focus, and **Esc** steps out
  one level at a time: first the menus come back with the node still open, then
  the node itself. Measured at 1896×1198, the detail goes from 300×295 to
  484×1077 (5.9× the reading area) and the clear canvas from 1124px to 1240px.

- Project chooser on every launch with **Open studio** (agents off) and
  **Open and start agents**.
- Session continuity: a launch that follows work interrupted less than ten
  minutes ago — a crash, a reboot, an update relaunch — reopens that folder
  without asking and restores the agents that were running. Closing the studio
  yourself (Alt+F4, the close button, the tray's **Quit**) ends the sitting, so
  the next launch asks for a folder again.
- Seven-stop **Start here** walkthrough with a **Walk with me** coach that opens
  the real menus and highlights the control; progress is saved per device.
- **Studio at a glance** strip on the workspace: service state with a single
  Pause / Resume, running workers, what needs you, up next, machine and usage.
  A new agent question raises a toast with an **Answer** button from any view.
- **Settings & connections** tab with **Run auto setup**, multi-provider
  routing (z.ai, OpenCode Go, Grok / Claude Code / Codex / Antigravity CLIs,
  LM Studio, custom endpoint), Jev routes, per-provider models and coding
  tiers (Auto / Free / Fast / Heavy).
- Usage tracker per day, provider and model, with live account readings for
  providers that expose them.
- Agent mail: roles leave each other notes; the exchange shows on the assistant
  card and as packets on the node tree.
- Command view: themed skies, numbered callouts, click-to-focus camera, agent
  glyphs, verifying orbs and the absorb animation for finished work.
- Verification stage: finished attempts settle to *Awaiting verification* with
  evidence before they count as done.
- Machine capacity gate (lag, memory, leases) that holds new starts, plus an
  in-app performance profiler and an observation-only policy lab.
- Portable Windows packaging, GitHub release workflow and an in-app updater
  that verifies the published SHA-256.
- Repository docs: `docs/` folder, `CHANGELOG.md`, `SECURITY.md`,
  `.env.example`, issue and pull-request templates, screenshots in the README.
- Contributor loop: `npm run test:fast` (Node suites without the nine
  Electron fixtures, under half a minute), `npm run lint` (check-only eslint,
  also in CI), a Python preflight with a clear message in `npm test`,
  `.editorconfig`, a repository map and module rule in `CONTRIBUTING.md`, and a
  known-environmental-failures table at the top of `TESTRUNS.md`.
- One shared fake DOM for the renderer UI suites,
  `tests/fixtures/renderer-dom.mjs`, with a general selector matcher and ids
  read from the real template instead of a copied list. Three suites moved onto
  it; the header records why the rest need per-file work first.

### Changed
- **Verification only reads evidence for cards it can actually settle.** The
  housekeeping prefetch fetched each `awaiting_verification` card's session
  changes and checks before the pass decided whether to judge it, so cards
  waiting on an in-flight overseer check or on handed-off children paid two
  OpenCode store round trips per card per pass, discarded every time. Both
  skips now run before the prefetch, the handoff one against the same
  reconciliation the settling mutator computes. A monitored handoff-heavy
  hour went from 2,464 store reads to 22 with an identical board outcome.
- **The Work rail is one scroller.** The agent roster moved inside the work
  list instead of sitting above it behind a 168px cap of its own, and the
  technical log lost its 180px cap, so the panel scrolls as one column with its
  section heads sticking as you pass them. Readiness stays pinned above.
  Absorbed-work ledgers and the chat-mode work list no longer scroll inside
  the surface that already scrolls.
- **Plans** leads with an interview instead of an advice desk. Mefi asks the
  question that would most change what gets built, waits for your answer, reads
  it back as an unconfirmed interpretation, raises a conflict when a new answer
  contradicts an earlier one, and follows what you said into the next question;
  asking it to explain the tradeoffs is now the secondary action. Every
  interview line is labelled by origin — your answer, Mefi's reading, its
  recommendation, its question — and a reading can only be copied into your
  decision box for you to edit and record. A batch of questions now sees what
  you actually said, not only decisions already written down.
- A specification waits for **What we understand**: the plan is read back to
  you and drafting or approving needs your explicit confirmation. Changing the
  destination, an unknown or any decision withdraws it.
- Destructive actions ask first, in Studio's own style: clearing the Done
  log, removing a project and switching away from working agents use a toast
  confirm with one committing button instead of a one-click wipe or the OS
  `confirm()` dialog.
- Error toasts stay for 7 s and hold while hovered; a one-time tip explains
  the single-key navigation and points at the `?` shortcut sheet.
- **Open Workspace on launch** moved from the Command view's Ambience popover
  to Settings › Studio; the workspace's Jev pill explains what Jev is on hover.
- OpenCode store reads moved to a worker thread; sessions are scoped by folder.
- One status vocabulary across the board, workspace, plans and Command view.
- Naming pass: "Command view" everywhere, "Task board", "Activity & evidence".
- Detailed feature prose moved from the README to `docs/architecture.md`; the
  CI workflow file is now `.github/workflows/ci.yml`.

### Fixed
- **A worker that never starts no longer costs the task one of its five
  tries.** The wedged-start watchdog kills a run that has registered no
  OpenCode session and printed no line within three minutes. That is the
  runner failing, not the brief, but the kill was still filed as a task
  failure: five slow CLI starts in a row parked a perfectly good card as
  "gave up after 5 tries" without a word of its brief having been read. The
  studio's own executor log for 2026-09-18 has 91 of 160 runs killed that way
  and not one task reaching done. Start kills now count on their own budget
  (`startFailures`), requeue the card on a 1m/2m/4m…30m cooldown, and are
  charged as ordinary failures only past five in a row, so a task that really
  does wedge its runner still reaches review. Any run that does start clears
  the streak, and the executor breaker still parks dispatch after three
  infrastructure failures.
- Foreman lag gate no longer self-blocks on replayed samples; unreadable lease
  reads fail closed.
- Occlusion-probe and eyes-toggle fixtures skip cleanly when the desktop is
  locked or the cover window is destroyed.
- Project switch drains background work instead of refusing it.

[Unreleased]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.3.0...main
[0.3.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.3.0
[0.2.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.2.0
