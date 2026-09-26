# Changelog

All notable changes to Mefi's Studio AI+ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json`. History before the extraction into this repository on
2026-09-19 is not recorded.

## [Unreleased]

## [0.4.2] - 2026-09-25

### Added
- **Vibe mode** brings conversation, task creation, live work and decisions
  into one focused workspace, with the full Build workspace a switch away.
- **Remastered node styles** give all eight looks distinct shapes, motion,
  wires and completion effects, with clearer previews, light-theme contrast
  and support for reduced motion. Five styles are free; three belong to the
  optional Void collection.
- A 40-second product showreel with a version-matched end card and a compact
  Discord export, using illustrative workflows and Studio's own node painters.
- Vibe mode stays Vibe: every page opened from it (Tasks, Plans, Ideas,
  Agents, Command, Settings, the model pages, Search results and links inside
  them) opens inside Vibe's own rail instead of Build's menu, with the way
  back to Vibe always at the top and the Build switch as the only exit. Build's
  section bar no longer covers Vibe's top buttons, pages no longer show Vibe
  through their glass, leaving Command or pressing Back on a Work page returns
  to Vibe instead of Build's Agents page or nowhere, and a restored session or
  closing Appearance never reopens Build's Home.
- Vibe: answer decisions without leaving it. **Answer** under Needs you opens
  a drawer with the question, the task it blocks, the agent's last lines and
  its options (the recommended one first), or takes your own words, then
  moves on to the next decision.
- Vibe can run on its own: everything that stops the agents is shown and
  cleared from Vibe. A banner under the box offers **Start agents** after a
  launch that left them off, **Resume** when new work is paused, and
  **Connect an AI** when none is. Under Verify first, **Review** shows a
  build's brief and approves it (or turns Verify first off); a stuck task
  shows why and can be tried again, resumed, marked done or dropped. The
  drawer steps through each in order.
- Vibe mode's menus match Vibe: Search, Shortcuts, the project panel, the
  section bar and its hover menus, Command's pop-overs, dropdowns and toasts
  are rounder, denser glass with pill selection. Search and Shortcuts list
  Home once, as Vibe on `H`. Settings › General gains a **Studio mode** switch
  that changes mode without leaving Settings, and its launch switch reads
  **Open Vibe on launch** in Vibe mode.
- Plans: **Archive plan** and **Restore plan**. An archived plan is read-only,
  folds under **Show archived** in the list, and leaves the assistant's plan
  summary and the Analyzer. The 300-plan cap now counts only plans in play.

### Fixed
- Ask cards name the reason a task needs help and avoid repeatedly filing the
  same offer. Task cards distinguish grouped cards from underlying work items.
- **A test run that pauses for a few seconds is no longer killed as hung.**
  One unchanged CPU sample counted as the whole four-minute idle window, so
  during a busy test run (a scan every 5 s) a test waiting briefly on a file
  or a frame could be killed. Idle time is now measured in real time.
- The facts sent with a brief or an overseer review are trimmed field by
  field and stay valid JSON; cutting them at 14,000 characters broke the
  JSON and dropped the machine, work and inbox facts first.
- Vibe: **Build it** no longer promises the task will start when the agents
  are off, paused or have no AI; it says so and points at the control that
  starts them. Work the checker is still verifying shows under Building now
  as "checking its work" instead of under Needs you, and stuck tasks and
  pending approvals are listed one by one instead of as bare counts.
- Vibe: the dock floats over the page instead of cutting the lanes off at a
  hard band, sheets opened on the Vibe page no longer leave a strip at the
  left edge, and the page under Vibe no longer shows its scroll arrow.
- Plans: one bad reference in Mefi's suggested questions no longer throws away
  the whole batch. Unknown prerequisites are dropped, a stale unknown is left
  alone, and malformed proposals are skipped and counted.
- Plans: a failed Mefi reply no longer leaves your already-saved answer in the
  box, where sending it again filed it twice. The box clears, and **Continue with
  Mefi** resumes the interview without resending.
- Plans: renaming a plan keeps its confirmed understanding and approved
  specification, and re-saving an unchanged specification no longer withdraws
  its approval. Reopening a question that is still open is refused instead of
  withdrawing the review.
- Plans: Mefi re-asking a question you already decided no longer produces an
  empty turn, and a long explanation is kept up to the note limit instead of
  being discarded. Plan tasks you dropped or deleted read "Dropped by you" or
  "No longer on the board", not "Done · Review evidence" or "Waiting for board
  status".

### Changed
- **Studio does less work while nothing changes.** Command draws about ten
  frames a second when nothing on it is moving and wakes the moment you touch
  it or data arrives. The task rail stops under full-window sheets, resolves
  the theme once per frame instead of once per node, and no longer re-reads
  the whole session store on every agent action. Agent sparks drop their
  per-spark blur, and the Overhead sheet is capped at 30 fps. The agent loop
  skips no-op promotion transactions, indexes the board once per pass, scans
  ideas and duplicate declarations without re-reading unchanged files, heals
  stale file scopes with one async walk, and runs git off the store
  worker's queue. [docs/performance.md](docs/performance.md) has the
  measurements.
- **Builders get a small context file instead of the whole board.** Each
  task run writes its own saved record, grouped members and dependencies to
  `task-runs/<runId>.json`, and the brief points there instead of at the
  multi-megabyte task board.

## [0.4.0] - 2026-09-25

### Added
- Command's node labels now include Updates, showing code/task reports and task progress while hiding idle names and routine agent chatter.
- Refined glass panels with softer edge highlights and layered shadows.
  Command gains rounded inset work cards, clearer selected tabs, compact status
  tiles and a cleaner task/search bar, with spacing that adapts to smaller windows.
- Project map exploration now has Back/Forward with restored camera positions,
  breadcrumbs, a searchable contents panel, working/changed filters, and a
  clickable minimap. Click to inspect; double-click or Enter to explore.
  Smooth pan, zoom, drag momentum and level transitions settle when idle and
  respect reduced motion. Related systems, every indexed file, and task drafts
  scoped to the selected part or file are reachable from the map.
- Compact choice tiles for short dropdowns, swatch grids for themes, miniature Appearance preset previews, and grouped View, Ambience, Brain map and Tools menus reduce scrolling and oversized rows. Long option lists retain search, and dropdowns support keyboard movement through tiles and option groups.
- A glowing wisp now wakes in the launch box and stays with the setup guide. Playing with it releases little ASCII smiles and sparks; thinking circles lights around its core and pulses `...` during setup, chat and agent work. Click it or press Escape to open a compact, transparent bubble menu for chat, friends, requests, notifications, settings and quick actions, with the return button in the center and motion that follows the existing audio link. Setup keeps its permission steps and resizes only its panels inside Studio.
- Command's automatic 3D Overview now gently pans and resizes like the demo flight while keeping the whole tree inside the space between panels. Manual navigation keeps control; paused spin and reduced motion stop the roaming, and saved camera choices remain unchanged.
- Agent setup now uses short desktop rows with role, model, settings and provider icons alongside each other, a bounded list width, and a compact header and toolbar. Theme-tinted cards highlight selected providers and skills; controls wrap on narrow windows.
- Command's agent settings now open from the top toolbar's Agents dropdown, with queue controls and links to full team setup; the duplicate side-panel tab is removed.
- A full glass finish across Home, Work, Agents, Settings and floating menus:
  theme-coloured translucent surfaces, two-colour gradients, distinctive heading
  fonts and clearer selection states. Reading panels and sticky headers protect
  text contrast; inactive pages no longer show through. Blur off uses a stronger
  translucent tint, reduced transparency uses solid surfaces, and custom palettes
  protect the contrast of reading areas and gradient buttons.
- Agent setup now uses compact model rows with corner provider icons, searchable provider model lists, effort and fast controls, and a left-side + for per-agent local skills and the coding worker's Studio desk MCP tool. Assistant seats can also select HTTP providers and Claude's text-only CLI.
- Transparent, theme-tinted glass navigation and controls with subtle outlines. Agents' child tabs now appear in hover menus, with click, keyboard and compact-window access.
- Command's right panel now docks flush to the window edge with a translucent frosted glass surface, preserving its inspection tabs and readable controls.
- New tasks gather local code, session and chat context automatically. When OpenCode Zen is connected, the configurable scout uses GPT-6 Luna at low reasoning on the fast tier to choose a verified starting file after local references are saved.
- Agents setup now includes companion, scout, overseer and subtask routing, plus a subscription-first switch. The companion opens an Ask panel for chat, task creation and navigation, and shows team work and messages. Command hides its redundant assistant and music nodes; music controls remain in the toolbar. The companion menu tracks the pointer as it resizes and waits for its transition before hover-closing.
- Appearance now showcases the live tree beside a compact, movable sidebar with Theme, Nodes, Layout and Interface sections. Clicking outside dismisses the sidebar without selecting anything underneath; the next click selects normally.
- Plans gains a live AI writing partner that explores project files as you type,
  shows an evidence tree, and offers editable wording and additions. Switch to
  manual writing at any time. A redesigned planning menu, Enter-to-next-field
  navigation, subtle focus glow, and reduced-motion-aware transitions make the
  draft easier to work through. A further polish pass adds field-level Refine
  actions, readable suggestion cards with optional editing, Undo for accepted
  wording, and independent scrolling that keeps the partner controls visible.
  Theme-tinted glass panels and translucent controls now blend with the backdrop,
  with softer borders, quieter background labels, and support for the existing
  glass, blur, and reduced-transparency preferences.
  Each step now has a distinct symbol and accent, compact labels, and matching
  section headers. Staggered card entrances and directional section slides
  preserve draft text and honor reduced motion.
- The audio status box opens an adaptive Music & video dropdown for local music, radio, YouTube and other links, connection setup, reactions and recommendations. Media controls are separate from Appearance; closing the dropdown keeps playback running.
- Media links play in a borderless floating window that stays visible across
  Studio. Drag and resize it, hover for Pin and Move aside toggles, or minimize
  it without interrupting playback. In menus it glides away from the pointer
  once, then stays accessible when followed; position and size are remembered.
- OpenRouter as a companion provider, with the free router default, a live searchable chat-model list, and the existing encrypted key shared with Jev and usage readings.
- **The Agent Brain** (0.4.0, see docs/roadmap-0.4.0.md). Studio now records
  what its agents do as one stream of work events per project, and draws it:
  - **Agent brain** (`J`, under Live) shows a task's pipeline top down: your
    companion as the head, the lead, the steps, and the sub-agents working
    them. Sub-agents go out, pop when they finish, fly home, circle the lead
    and are absorbed, in your node style; reports climb the tree. **Replay
    today** plays back the day's recorded events.
  - Every task gets a **pipeline** before its worker starts: from the
    Playbook's best recipe for that kind of work, or a template. It grows
    from the worker's own todo list and `MEFI_STEP` lines, within caps, and
    folds finished steps away.
  - Sub-agents **report up the tree**: a delegated child's `MEFI_REPORT` (or
    its result line) reaches its parent, and a finished child wakes the
    foreman so the parent's integration pass starts at once.
  - The **desk worker** answers stuck workers (`MEFI_HELP` lines) on the lead's
    model, folds repeats, and sends only what it cannot answer to you. With
    **Give workers the ask_desk tool** on (Agent brain › Seats), OpenCode and
    Claude Code runs can ask it mid-run through a local MCP tool and wait.
  - The **Playbook**: an archivist files every verified or failed pipeline as
    a recipe; the next task of the same kind starts from the recipe that
    verifies most. Pin, rename, retire or delete recipes on its shelf.
  - The **project map**: the project's recent git history and the files each
    verified run read and changed build a map of its systems. Large folders
    split into the groups of files that change together, and systems are
    linked by how alike their change histories are. Hover a system for its
    card, or jump to one by name. Workers are told the related systems and
    hot files.
  - **Home shows the project map** beside the conversation: pick a system to
    see its tasks, ideas and plans, then **Work on this region**.
  - Your **companion** lives in the menu foot: it greets you with what
    happened while you were away, keeps one queue of everything that needs
    you (with the actions right there, and the count in the tray), rests when
    nothing runs, and shows what it has noticed about how you answer. Pick
    its look and whether it covers this project or all of them.
  - **Seats**: the lead and the desk run GPT 6 Sol through OpenCode Zen at
    medium reasoning effort (Agent brain › Seats changes either). The Cluster
    planner is the lead seat when a Zen key is saved.
  - **Nested delegation** (off by default): a delegated slice may split its
    own part once more, never past three levels.
  - **Head drafts** (off by default): for a compound or systemic task no
    Playbook recipe fits, your heavy model drafts the pipeline once.
  - `node tools/replay-events.mjs --day YYYY-MM-DD --data <project data>`
    compares a day's events with the executor ledger.
- **Links** replaces the Spotify tab in Settings › Audio. It plays a pasted
  or dropped link: YouTube (privacy-enhanced player), Spotify, SoundCloud and
  Vimeo in their official embeds, and a plain audio or video file,
  Discord attachments included, in Studio's own player. A Spotify Jam,
  a Twitch stream or any other page opens in its own app or the browser,
  and whatever was playing keeps playing. **Copy link** makes the loaded
  link easy to share in Discord. The last link returns after a restart
  without autoplaying, and the old saved Spotify link carries over. Other
  modules can use `MefiMusic.playLink` / `linkInfo`.
- **Listen together** in the Links tab. Pick one of your Void Engine rooms
  and play the loaded link for it. Everyone who chooses **Listen along** in
  Studio joins at the same point, and the room's Discord thread gets a note.
  Whoever put it on, or the room's owner, can pause, restart or stop it.
  Sync is exact for audio and video files, and uses the players' own APIs
  for YouTube, Vimeo and SoundCloud. Spotify's player can only be loaded,
  not steered.
- **Share what I'm playing**, off by default, lets the Void Engine bot's
  `/nowplaying` show your current link, station or "Local music". It never
  shows a file's name.
- Both need the rooms hub's address, which this build does not have yet. Set
  it in `scripts/hub-client.cjs` or with `MEFI_STUDIO_HUB_URL`.
- **Home is glass over the live node tree.** The workspace used to sit on a
  flat, opaque background. Now the Command constellation draws behind it,
  and the glance tiles, the conversation, Your work, the menu and the
  project panel are frosted glass that shows the tree through, blurred.
  Behind Home the tree is scenery: no labels or input, about 12 frames a
  second (one a second with Motion off), paused under a sheet. It costs
  about a third of Command's frame time. Every theme tints the glass with
  its own colours, and **Blur behind panels** off makes the panels solid.
- **Tree motion.** With the Audio link on and the Overview spinning in 3D,
  the music moves the tree: the spin quickens with the music's energy, the
  bass swells it, the mids sway it round a small
  figure of eight and the snare nods it toward you. It all happens inside
  room the frame keeps for it, so no node leaves the view, and it settles
  back when the music stops, the spin pauses or a node is focused. Response
  sets how much (full from 50%); **Tree motion** under the audio dropdown's
  Audio reactions turns it off.

### Fixed
- Audio-linked Tree motion now eases bass, snare and spin changes and keeps its
  sway path continuous when a kick is detected, so the whole tree moves smoothly.
- **Claude Code and Antigravity builders are no longer killed for working
  quietly.** Their print mode says nothing until the answer, so every run
  longer than the start budget was killed as a wedged start. The 25-minute
  budget still bounds them.
- **Long runs no longer park the executor.** A run killed at its 25-minute
  budget counted as a failure to start, so three long tasks paused every
  worker for ten minutes. Only a run that never said anything counts now, and
  a breaker pause is no longer saved as "executor off" (which kept it off
  after a restart).
- **Stop all stops everything** even when settings cannot be saved, and a
  wedged CLI's opencode fallback no longer starts after it.
- **Restart Studio restarts once the build it waited for finishes.** It used
  to hold all new work and never restart.
- **Switching projects cannot start a worker in the project you left**, and a
  refused switch no longer stops the assistant's tick.
- **Verification checks no longer see Studio's API keys.** They now get the
  same stripped environment as every other child process.
- A hung verification check is killed with its whole process tree and no
  longer holds a verification slot until restart. A card whose evidence cannot
  be read (a very long check history, a session gone from the store) is parked
  for review after two hours, instead of waiting forever.
- The LÖVE harness result counts, so a failing suite blocks verification. An
  `npm run check` moved to Studio's checkout (the project has no package.json)
  no longer verifies or reopens the project's cards. Reported test paths keep
  their case on Linux.
- An inbox request typed without a title starts instead of stranding its
  claim. A request with a long or non-Latin title no longer runs beside the
  card it became, or becomes a new card on every pass.
- A resumed run no longer replays the previous run's done line and hand-offs
  when its CLI echoes the prompt. Escape codes alone are not a worker
  speaking, and cursor codes no longer hide the done line.
- The opencode fallback is judged on its own start and verdict.
- A stopped run or an uncharged requeue is no longer reported as "Failed". A
  failure question names this run's error, and a stale run asks nothing about
  a card another run owns.
- A run that started ends the card's streak of failed starts, and Try again
  resets it. A reopened done card gets its own receipt. "Let it run" and "Keep
  them all" no longer erase each other.
- **Toasts no longer cover the opened menu.** A tip in the bottom-left corner
  sat over Shortcuts, Community and Keep menu open; it now steps aside while
  the menu is open.
- **Search Studio names each section once.** Every row repeated its section
  ("WORK", "WORK", "WORK"…); the name now heads its group, and shows faintly
  on the row you are on. The search field's focus ring follows the sheet's
  rounded corner instead of cutting across it.
- The project panel's "Mefi's Studio" heading no longer wears the current-page
  highlight on Home, and the Shortcuts sheet's key column is narrowed to its
  longest key.
- **The spinning tree stays in frame, turning in place.** The Overview
  turned the tree about the world's origin rather than its own centre, so a
  lopsided tree swung up to a few hundred pixels to one side, and the frame
  shrank and grew with every turn (down to a seventh of its size for
  Branches and Terraces on a wide window). It now turns about the tree's
  centre, sizes the frame once for the whole turn, and keeps the camera far
  enough back that the near end of a wide tree no longer balloons.
- Zen and demo camera flights now follow visible layout positions, keep connected
  branches in view, and adapt zoom to the window. Gentler turns, coordinated
  tilt and zoom, and wider transitions prevent long flights through empty space.
- **The Review list shows only work that needs you.** A task whose worker
  finished and handed the rest on used to count as a review, and so did
  every task above it in the chain, so one stuck follow-up could appear on
  the list four times. Those tasks now read "Waiting on follow-ups" and
  finish by themselves; only the stuck follow-up is flagged. On the
  2d Trippy Hell board this took Review from 90 to 40 before any triage.
- **Drop closes a task you won't do** without marking it done. The task
  that handed it on stops waiting for it, and Reopen brings it back. Before
  this, Confirm done (a false completion) was the only way to clear a stuck
  card, and deleting a follow-up brought it back as a new card.
- A task that handed two pieces of work on no longer fails "outstanding
  obligations remain" after both follow-ups finish just because the
  worker's summary worded them differently from the follow-up titles.
- YouTube embeds no longer stop with "Error 153": main now sends
  YouTube's player an app Referer, which a `file://` page cannot send.
- **Brain maps drafted with AI arrive wired correctly.** The model used to see
  only port names, so it wired ends that could never carry what it sent, for
  example "Needs work" into an approval that only takes work. Those drafts
  opened with errors on them. The model is now told what every end carries
  and takes. What it still gets wrong is repaired before you see it:
  mismatched wires are moved or removed, empty required inputs are fed, and
  loops are marked as feedback. Anything left goes back to the model once.
  Each repair is listed in the inspector until you save.
- **Decisions about a task that has left the board no longer ask you.** A
  worker's run can outlive its card, for example when the card was moved to
  another project's store mid-run. Its questions then reached Ask and a
  "Decision needed" toast, and every option failed with "That task is no
  longer on the board." Those questions are now logged instead of asked.
  Open ones close as soon as the card leaves, and their toasts close too.
  A click that gets there first clears the question and tells you why.

### Changed
- **Board and assistant updates reach the window once.** Every panel that
  listens to an update used to get its own copy, so the whole board was
  copied seven or more times per update, and the assistant's state as often,
  up to four times a second. An update is now copied once and shared, and
  assistant updates leave out what the window already has. On the live
  80-card board the window's work per board update fell from about 44 to
  17 ms in Command and from 54 to 13 ms on Home, and per assistant update
  from 105 to 58 ms and 87 to 67 ms (docs/performance.md). A panel that
  fails on an update no longer keeps the panels after it from getting it.
- **Menus are frosted glass and move.** Floating menus, the menu down the
  left and the top row let the page behind show through a lighter tint over
  a stronger blur, with a softer shadow. Every menu grows open on a soft
  spring from the edge it belongs to, its rows follow one after another, and
  it leaves quickly. One highlight glides between rows under the pointer or
  keyboard focus instead of each row lighting up on its own. Motion Off,
  reduced motion, Blur off and reduced transparency keep their plain
  versions.
- **Your companion knows where you are and what is waiting.** Replies use
  the name you gave your companion and know which screen you are on, from
  every chat box. "Requests", "what needs me" and the badge now mean one
  list, so the companion's count matches "N need you" instead of saying
  nothing is waiting. It remembers the updates it posted and what it just
  offered: "all of them", "both" or "each of them" starts every card it
  offered and nothing else. The Ask tab shows those offers as one-tap
  buttons, with All of them when there are several. Replies carry the
  companion's name, and the tab updates as soon as a reply or update
  lands. Starting an offered card from the chat also closes its "Pick the
  next piece of work" card.
- Refined all graph views with shared theme-aware node finishes, clearer callouts and connections, quieter editor cards, and readable, scrollable pipeline branches.
- Command's Work panel has single-line readiness counts, shorter worker cards, compact agent rows, expandable activity details and folded recent agents. Its tab bar keeps labels and counts on one line with a clearer selected state; intentional preparation stops no longer appear as errors needing attention.
- Redesigned Home around a bottom composer, neutral dark surfaces, recent
  tasks in the navigation menu and an expandable Activity panel. A compact
  task summary keeps progress, blockers and completion actions visible.
  Queue, system status and setup panels start collapsed.
- Default Swarm dispatch uses one builder per task without mandatory planner
  and reviewer calls. Cluster retains coordinated planning and delegation;
  existing delegated tasks keep their dependencies and verification gates.
- Home now keeps the selected task's worker, current action, activity age,
  recorded checks and next step together. Task selection follows Home, Work
  and Live; compact titles retain the complete brief in task details.
- Project previews have their own Start, Open and Stop controls and readiness
  state, separate from whether a coding worker is running or a task is verified.
  Completed tasks expose Open app, View checks and Request a change.
- Start this task and confirmed chat starts request only that task while
  keeping the rest of a paused queue held. Prerequisites, build approval,
  worker capacity and project boundaries still apply.
- Quiet OpenCode workers now expose their pending or running tool, its safe
  description and elapsed time in current activity and assistant context.
- Verification checks stay in the dispatched task's project and record their
  working directory. New projects use their own check/test script or root
  JavaScript tests; missing checks cannot borrow a passing Studio check.
- Fresh folders can be built without Git when the task does not require a
  commit. Concurrent booklet builds use separate temporary files and bounded
  retries for Windows file locks.
- Remastered the full interface around Home, Work, Live and Models, with a
  local navigation row for related tools. Main tools are workspace pages;
  temporary dialogs keep keyboard focus and return behavior.
- Settings now has seven focused categories with individual-setting search,
  expandable connection forms, integrated Appearance/Audio controls and
  synchronized Automation settings. Existing links and shortcuts still work.
- Reorganized task details, session tools, plan stages and Analyzer inputs;
  added compact model rows, separate usage sources, optional evidence
  inspection and narrow-screen detail navigation.
- Home and Command now show a worker's current step or latest output, route
  and last-update age, including workers without an OpenCode session. Home
  distinguishes preparation and finishing from building; assistant replies
  receive the current project's recent task events.
- Simplified the navigation menu so each destination appears once, with the
  menu open by default on wide windows and the user's saved choice respected.
- Unified workspace colors and typography, reduced decorative surfaces, and
  grouped build preferences under Queue settings. Chat and task actions now
  use direct labels and concise status messages.
- Settings now names Preferences and Decision model explicitly. Search finds
  individual control labels, and keyboard navigation focuses the chosen card.

### Fixed
- History note and idea fields keep keyboard focus and text selection through
  task refreshes, including a refresh between clicking the empty field and typing.
- Intentionally stopped workers now show "stopped on request — progress saved"
  in their session checkpoint and context, matching the task's saved state.
- **Sequential project work no longer creates false collision repairs.** When
  one session finishes before the next starts, its edits remain inspectable
  history without queuing repair work. Finished sessions no longer appear as
  active editors; genuine concurrent conflicts remain detectable.
- **Save & switch waits for saved progress.** Stopping a worker now waits for
  its checkpoints, task state and history to finish saving before changing
  projects. A pending live update also waits for those saves and the project
  change; repeated update retries no longer repeat the same toast notices.
- **A machine that settles just under busy no longer holds new workers
  forever.** After a lag spike, new worker starts waited for two readings at
  40 ms or less, and a laptop that settled at 41–99 ms never got there. Once
  every reading has stayed under the 100 ms busy line for three minutes the
  hold lifts; a busy reading restarts that clock, and the hold says how long
  is left.
- **Memory and lag holds are no longer filed as "Fix:" cards.** A briefing
  alert about the machine's memory or responsiveness described the host, not
  the code, and its card only ran into the same hold. An alert that names a
  file is still filed.
- **Ctrl R keeps your place.** Electron's default menu reloaded the window
  without saving the view, selection and typed text. Studio's own menu saves
  them first, the way an update's reload does, and keeps the edit, zoom and
  full-screen shortcuts.
- **Explorer's request inbox shows up when you open it.** It was drawn only
  after a push or an edit, so a fresh open showed an empty list; expand and
  audit requests are labelled as such instead of "REQ".
- A worker's result line keeps a ";" inside brackets in one field, so
  "remaining: none (owner-only: a; b)" no longer reads as outstanding work,
  and a clipped field keeps its closing bracket.
- A card split out of another now starts with that card's requirement,
  decisions and last result as context.
- The keyless brief backs off after a failure (5, 10, 20, 40, then 60
  minutes) and waits out the shared AI backoff, instead of asking a failing
  route again every few minutes.
- Settings readings (key sources, update and release status, the model
  catalog, speed readings, shell helpers) answer during a project switch
  instead of "Switching projects"; applying an update and restarting still
  wait for the switch.
- Overhead's task boxes fit a long title with "…" instead of running past
  the box, and Home's usage note shows a sub-cent day as $0.004, not $0.00.
- The Machine scan starts PowerShell only when a LÖVE process is running,
  which roughly halves the cost of a scan.
- On Linux and macOS a worker's own checkout (`MEFI_STUDIO_WORKTREE_RUNS=1`)
  is removed after its work merges. Its `node_modules` link is a symlink
  there, which the exclude rule `node_modules/` did not match, so every
  settled checkout was kept as if it held unsaved edits.

### Changed
- **Home and the task board follow your theme.** The workspace was still
  written in an older olive-and-cream palette of about 170 one-off colours,
  and a patch layer repainted only part of it, so borders, secondary text,
  status chips and the companion stayed olive on every theme. Every one of
  them is now a theme token, status colours come from the shared ok / warn /
  bad / info tokens (plus a new `--idea` violet for ideas and grouped work),
  and its corner radii use the radius scale.
- **Buttons and tints stop showing the old gold.** Every button's resting
  and hover fill was a fixed warm brown, and 33 hovers, borders and chips
  used the retired champagne gold; they now take the theme's surface and
  accent. Hand-written warning, error and live tints go through their
  tokens too.
- **`npm test` runs every leg and every stage**, even after one fails, and
  ends with a pass/FAIL line per leg; one red suite used to hide whether the
  Electron lane, the Python contracts and the path lock passed.
- Four timing-sensitive tests no longer fail on a loaded machine: the eyes
  worker's read after a restart, commit evidence's git probes, the Electron
  fixtures' temp-folder cleanup (which also hid the real error), and the
  model-performance ctime check on filesystems that do not advance ctime.
- The TESTRUNS append helper no longer doubles a "(task, run)" suffix the
  title already carries.
- **The node styles are remastered, and every node moves.** Both canvases
  paint every node through one shared module (`renderer/node-styles.js`), so
  the tree rail's own drifted copies of the eight styles are gone and the rail
  wears the Command view's looks. Every node animates all the time, faster
  while it works; reduced motion holds each style in a designed still pose.
  - The Void collection has full style packs, each with its own agent ring,
    hub dress, work orbit, arrival, selection, wires, pulses and landing:
    **Sigil** is a hex seal whose rune ring turns while six hex cells
    assemble round it as it works; **Singularity** is a black hole with a
    tilted accretion disc, falling sparks, jets at work and wires bent by
    its gravity; **Prism** is a turning crystal whose light band sweeps and
    whose wires split into three spectral strands.
  - The five free styles are polished and follow the theme (no fixed navy
    bodies on light themes): orbs sway with a travelling glint, Soft glass
    sweeps a sheen, Minimal breathes and keeps its agents' glyph and status
    ring, Halo turns a dashed ring without a blur, Crystal is an octagonal
    brilliant.
  - Wires, pulses and landings wear the style, the done badge pulses, labels
    step clear of a look that reaches past its node, and the picker
    thumbnails animate when motion is allowed. Paints are cached per canvas:
    a steady frame builds no gradients.
  - Wires stop at each node's edge instead of crossing a see-through body,
    and the rims round a node (the file-clash rim, the done echo) follow its
    shape: a hexagon round Sigil, an octagon round Crystal, a kite round Prism.
  - On light themes a resting node keeps its state readable: done, blocked
    and stale rims stand at least 3:1 off the page, status badges are filled
    wells, and a Singularity stays a black core in a coloured ring. A stale
    session reads as stalled: its rim is dashed and it moves at a slower pace.

### Security
- The Analyzer's GitHub issue read runs `gh` without a shell and without
  Studio's `MEFI_STUDIO_*_KEY` / `_TOKEN`, like every other child process.

## [0.3.3] - 2026-09-23

Discord perks and Server Styler controls, a regrouped menu, a Usage popover
for every provider, owner asks that end the follow-up loop, task run
history, and a safer host: a local-only web preview, settings saves that
cannot undo each other, and child processes that no longer see Studio's
keys.

### Added
- **Discord Server Styler controls.** Settings can start the separate bot and
  local dashboard, open the dashboard or bot folder, show setup and online
  status, and stop a process Studio started. It finds a sibling
  `discord-server-styler/` checkout or the path in `MEFI_STYLER_ROOT`.
- **Void Engine Discord perks.** Members of the Void Engine Discord unlock
  the **Void collection**. It has four themes, **Void**, **Eclipse**,
  **Abyss** and **Neon Dusk**, each with a second accent hue, its own
  Command-view sky and a premium finish on primary buttons. It also has three
  node styles, **Singularity**, **Prism** and **Sigil**. All are in Style &
  sound, and the themes also in the theme select in Settings › Your Studio;
  everything that was free stays free.
  - **Linking.** Settings › Community, which **Community** at the foot of the
    menu opens, links a Discord account through Discord's own login in the
    browser. It uses OAuth2 with PKCE, a loopback redirect on 127.0.0.1, and
    no client secret. Studio then re-reads the membership every seven days;
    a failed check is retried after an hour, then six hours, then daily, and
    keeps the perks for 14 days. Leaving the server locks them at the next
    check.
  - **The weekly card.** A small card invites non-members to join: not in
    the first three days, then at most weekly, and monthly after four
    ignored showings. **Not now** and **Don't show again** are honoured.
  - **Privacy.** Nothing reaches Discord until you link. The refresh token is
    encrypted with the OS keystore in its own `community-auth.json`, and
    **Unlink** revokes the grant and deletes that file.
  - **Locked items** stay clickable and explain themselves where you are, in
    a toast or the workspace's inline card, without changing the view; **See
    the perks** opens Settings › Community.
  - **Forks.** The lock is honest: `SELF_UNLOCKED = true` in
    `scripts/community.cjs` unlocks everything without Discord. Every locked
    group offers **Copy agent prompt**, which asks a coding agent to make that
    change.

  Linking stays off until the maintainer sets the Discord application id (or
  `MEFI_STUDIO_DISCORD_CLIENT_ID`). The new files are `scripts/community.cjs`,
  `scripts/discord-oauth.cjs` and `renderer/community.js`, with five new test
  suites. See docs/community.md.
- **Owner controls for the loop guard.** The Explorer panel gains *Memory
  alignment*, *Loop guard* and *Hold looping cards* switches next to
  *Proactive*. A card the loop guard holds shows why and how to fix it in the
  Tasks view, with a **Try again** button that releases the hold and restarts
  the count. A card waiting on a duplicate shows "Waiting for <title>" with a
  **Run anyway** button. See docs/agent-loop.md §10.
- **Duplicate card families become one owner decision.** When open cards look
  like the same work, the keeper asks once: keep the oldest and wait the rest
  on it, or keep them all. Linked copies wait for the kept card and close with
  it. Nothing is linked until you answer.
- **Repeating work is put to you once.** A chain of follow-ups and "Work on"
  cards whose runs keep re-verifying finished work (3 of its last 4 runs
  changed nothing but the TESTRUNS notebook) raises one question: hold it for
  your review, or let it run. The verifier marks a run whose only changes were
  the ledger (`verification.ledgerOnly`).
- **Owner asks.** Something only you can do (moving a card on the board,
  correcting Studio's stored record of a task, landing another session's
  files) now reaches you once as "needs something only you can do", answered
  **I'll take care of it**, instead of an agent splitting it into a new card
  that asks again. A follow-up chain split from one question no longer loops.
  - **Repeat questions fold.** The same question from another card, within a
    day, waits on the open card or takes your earlier answer as a record.
    Two questions about the same cards must also be worded alike, so a
    different question is still asked.
  - **Split cards carry the question** they were split for, never re-run
    their parent, and stop at the brain map's split depth (3 by default).
- **Task run history.** A task's detail shows each attempt (who ran it, how
  it ended, what it changed), and Explorer and Analyzer sessions link to the
  task they served with **Open task**. The Needs you count breaks down what
  is waiting for you.

### Changed
- **The menus are regrouped so each section means one thing.** The menu down
  the left edge (the rail) now reads **Home**; **Work**: Task board, Plans,
  Ideas, Brain maps and Analyzer; **Live**: Command view, Activity, Explorer
  and Overhead; **Models**: Model catalog and Model Lab; and **Settings**:
  Settings, Style & sound and Profiler. Its foot holds **Search** (`Ctrl K`),
  **Start here**, **Shortcuts** (`?`), **Community** and the update badge,
  and **Keep menu open** pins it. The menu is one tab stop that the arrow keys
  walk, and `Ctrl ,` opens Settings from anywhere. A pinned menu behaves
  unpinned in windows under 1100px wide, and the window no longer shrinks
  below 600×560. The tab pages' header names the page you are on, with a
  **← Command view** chip when Command sent you there.
  - **Search Studio.** `Ctrl K` (it was Key commands) files every result
    under its menu section, and finds each Settings card by name ("Settings ›
    Providers").
  - **Settings** gains **Find a setting** and three groups: **Connections**
    (Auto setup, Providers, Model routing, Coding workers, Jev, and **Agents &
    queue ↗** to Command's Agents panel), **Personal** (Your Studio,
    Community, and **Style & sound ↗**) and **System** (Updates, Diagnostics,
    Integrations, Connection log). Every card has a deep link,
    `MefiNav.go("studio", { section })`, and the update badge and the update
    toasts open Settings › Updates.
  - **Your Studio** gathers your name, the companion's name and a theme quick
    select (from the project panel's *Make yourself at home*), **Motion**
    (from the page header, now Full · Calm · Off), whether the companion
    moves, **Blur behind panels** (from the Task board) and **Open Workspace
    on launch**. The **M+** project panel now holds projects only.
  - **Diagnostics** is a new Settings card with the speed probe (moved out of
    the updates card), **Open profiler**, **Run auditor** and **Machine**.
  - **Style & sound** opens on **Look** (the colour theme with the Void
    collection, then the node tree) before **Sound** (the player, the Audio
    link, Find your next sound), with a **Look · Sound** strip in its header.
    A locked Void item explains itself in the sheet instead of leaving it.
- **The Command toolbar is four labelled groups and Leave**, nine controls
  where there were thirteen: **Agents** (Swarm / Cluster) · **Camera** (Fit,
  Overview / Follow, Spin) · **View ▾** (Map 2D / 3D, Labels, Zoom) ·
  **Sound** (Music, Ambience). The two controls both called Orbit are now
  **Spin**, the only one that turns the tree (`Space` pauses it), and
  **Overview**, the camera mode that keeps the whole tree framed, with its own
  icon. **Ambience** reads Look → Sound → Calm, hangs from its own button and
  links on to Style & sound; its Audio link row moved to Style & sound.
- **Finished cards keep a compact history.** Once a completed card is past
  the tidy clock, the keeper drops the revisions that changed neither its
  brief nor an attempt's final result, up to 20 cards a pass. Every brief it
  can be restored to, each attempt's last entry and the first and latest
  revisions stay, unchanged. On a copy of the frozen 2d Trippy Hell board this
  took 1150 revisions to 649 and the file from 7.9 MB to 4.7 MB. The tidy line
  and `node tools/memory_audit.mjs` report what it saves; the `compactHistory`
  pref turns it off.
- **Hold looping cards off now releases the keeper's holds** (it used to stop
  only new ones); holds you asked for stay until Try again.
- **The Usage popover covers every provider.** It now has one card per plan,
  each with a bar and reset time per window: OpenCode Go, z.ai, and new
  cards for Claude Code, Codex, Grok and Antigravity. The coding CLIs are
  read through their own logins with no prompt and no credential read:
  Claude Code's `get_usage`, Codex's app-server rate limits (between reads,
  its session rollouts), Grok's billing extension and Antigravity's
  `/usage`. These CLIs start only while the popover or the Model Lab tracker
  is open, two at a time, and a reading is kept five minutes.
  - **Balances:** OpenRouter shows the free-model allowance and a signed
    account balance instead of a lifetime "spent · $0.00 left". Vercel AI
    Gateway and a local LM Studio server (reachable, which model) are listed
    too.
  - **Today:** one row per provider with recorded calls. A failed call reads
    "1 call · 1 failed", never "? tokens".
  - **Go estimate:** the local estimate shows only while the live Go read is
    down.
  - **The pill** shows the lead plan's first window and its fullest other
    window, so a spent month is not hidden behind an empty 5-hour window.
  - **Escape** closes the popover without leaving Command, and opening
    either Legend or Usage closes the other.
- OpenCode Zen replies now record their reported `cost`, so Zen calls are
  priced instead of unpriced (Go's `cost: "0"` is still never read as a
  price). The account readings no longer wait for, or hold up, a project
  switch.
- **Brain maps show what they do.** Each part of the live map shows its
  recent activity, and every setting says whether the host reads it or "not
  read yet". *Repeat questions* and *Split depth* drive the decision lane, and
  *Say what changed* posts a short line in the thread after you answer a
  card. *Workers at once* now sets the build worker limit (at most 3); it used
  to set a background pool that never changed how many builds ran.
- A builder run on a CLI that writes no OpenCode session (Claude Code, Grok,
  Codex, Antigravity) is parked for you on its first check instead of
  retrying a verification it can never pass.

### Fixed
- **z.ai usage reads again.** z.ai moved coding plans to credits on
  2026-07-30 (`CREDIT_LIMIT` rows), and the parser only knew the older token
  windows, so the panel said "The z.ai quota reply has no recognisable
  window". Credit plans now show credits used of the cap. A team plan or a
  key with no plan says so instead of failing, and an impossible five-hour
  reset time is dropped.
- An idle rolling window no longer prints a reset time that moves on every
  read.
- A torn `eyes-assistant.json` is copied aside (`.broken-<time>.json`) before
  the assistant starts over, instead of being overwritten by the empty state
  on the next save.
- Settings saves no longer undo each other. Every change to `settings.json`
  (a preference toggle, an autopilot save, a Community stamp, a saved key)
  waits its turn on one queue and applies to a fresh read, so two changes
  landing together both stick.
- A `settings.json` that stops parsing is copied aside
  (`settings.broken-<time>.json`) and logged instead of silently read as
  empty. The next save rebuilds it from the last good copy read this session;
  with none, changes last until restart rather than rewriting every
  preference and the project list from nothing.
- The keeper no longer drops a checkpoint written while its pass is in flight.
- An assistant pref only changes once it is saved; an error raised while
  switching projects still reaches the app log; a failed save at quit is
  logged.
- Catalog tools' "Where should I use it?" ranking and task fit heatmap weigh
  request headroom again. An unlimited model entered the speed scale at a raw
  10^9 and pushed every limited model's speed score to zero; it now sits one
  step above the roomiest limited model.
- The Overhead sheet's task poll backs off again while the board is
  unchanged. Its task boxes were written onto the task data, so every painted
  frame made the next poll look new.
- **Command's Done button marks the task done.** It saved the whole board
  and reported success without changing the task's status.
- The request inbox adds and removes one request at a time, and a request a
  worker holds is refused with a reason instead of being rewritten away.
- Brain maps are saved atomically, and a map store that no longer parses is
  set aside instead of being read as empty and overwritten.
- An answer that could not be applied keeps its reason, and its card says
  "not applied".
- Explorer: a deep link restored before the panel was ready no longer throws,
  and a late Open task lookup no longer wipes a half-typed checkpoint.

### Security
- **`npm run start:web` is loopback-only and serves an allow-list.** The
  browser fallback now listens on 127.0.0.1 and serves only `renderer/`,
  `assets/` and the public `data/models.json` catalog. It used to listen on
  every interface and serve the whole repository, including the local tasks,
  conversations and logs under `data/`. Pinned by `tests/serve_web.test.mjs`.
- **`shell:open` opens only http and https links.** It used to hand any URL
  the renderer passed straight to the OS shell, including `file:` and custom
  schemes. Community links do not use it: the renderer names a target and
  main opens a hard-coded Discord URL.
- **The Studio window never leaves its own page.** A link that asks for a new
  window opens in the default browser, and only if it is http or https;
  nothing opens as a child window of the app. Anything that would navigate
  the window itself away from the bundled page (a dropped link, a stray
  `href`, a script) is refused, while the page's own reloads still work.
  `setWindowOpenHandler` and a `will-navigate` guard in `main.cjs`; pinned by
  `tests/main_window_guards.test.mjs`.
- **Child processes no longer inherit Studio's keys.** git, npm, the first
  scan and executor worktree runs spawn through `scripts/platform.cjs`, which
  withholds `MEFI_STUDIO_*_KEY` and `_TOKEN` from their environment.
- **Updates are checked against their published SHA-256.** A digest that
  does not match, or a checksum that cannot be read, stops the update and
  removes what was staged; a release without a checksum is staged unverified
  and the log says so.
- **Stopping a process from the Machine panel is checked in main.** Only a
  pid from the latest scan that the panel offers a stop for is killed; a
  malformed pid or a failed scan is refused rather than trusting the page.

### Fixed
- The Task board labels its grouped overview as cards and explains why its
  card total differs from task filter counts.

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

[Unreleased]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.4.0...main
[0.4.0]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.3.0...v0.3.3
[0.3.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.3.0
[0.2.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.2.0
