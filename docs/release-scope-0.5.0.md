# 0.5.0 release scope

The local validation candidate is **0.5.0-rc.1**, not a published release.
Its fresh portable folder and zip are separate from the installed application.
The candidate now includes the Friends room desktop in Social and Studio:
Rooms, actual presence, the existing chat, the local build summary, the room
player and the current Build Jam. Narrow panels reveal through buttons and
offline drafts remain in place. The Lobby roundup and all existing Friends
destinations remain reachable. Shared links show their destination and load
supported players on request. Reviewed images and cosmetic swaps require a
compatible private service that enforces room access and ownership; this
desktop candidate does not deploy that service or grant credits or paid access.
The hosted account, subscription and economy proposals remain private drafts;
they are not activated by this candidate. Google social sign-in still needs
registered OAuth configuration and a deployed identity adapter.

Candidate scope updated 10 October 2026. The published Windows download is
still 0.4.4. This records the scope of the next release; it does not announce a
release date or replace the packaging and release checks. **0.4.5 and 0.4.6 are
skipped:** what was planned for them ships in 0.5.0. The plan is
[plans/0.5.0-plan.md](plans/0.5.0-plan.md); the earlier scope note is kept at
[archive/release-scope-0.4.5.md](archive/release-scope-0.4.5.md).

0.5.0 ships as the Electron build. It is also the bridge release the move to
Rust needs: its updater already knows the Rust host's zip, so a later release
can change hosts ([rust-migration.md](rust-migration.md), "The bridge
release"). The Rust host is not on 0.5.0's path: a version tag publishes the
Electron build (`TAG_HOST` in `release.yml`), and a host zip is built only when
the workflow is started by hand with `host: tauri`.

## Included

The work already on `main` since 0.4.4 (`CHANGELOG.md`, Unreleased): the setup
helper and first-run fixes, multiple coding CLI logins, startup preferences,
update installation fixes and the update safety net (a saved copy, a boot watch
and Roll back), consistent agent wait reasons, Social's progress and MEFI
suggestions, the Plans and Task board cleanup, agent habits, Needs you fixes,
Configuration, menu typing and confirmations, the reachable media player,
companion personalities and node finish effects, PC setup and sharing, reduced
work while hidden, Git link and GitHub sync, link reading for agents,
permission modes, the Studio model tracker, and Command-tree child sessions.

The first Fleet page is included: Agents › Live › Fleet has Graph, Table,
Recent, Tree and Health views, the seat inspector, and Open in Command. Friends
is in the main menu with direct Rooms, Your PCs and Playground links, and the
Task board's compact sliding cards extend to Ideas. PC sync also catches a
merge that drops another branch's work, and `npm run worktrees` lists every
worktree of a project with what to do about each.

Landed while finishing 0.5.0: **Work › Worktrees** (every worktree of the open
project with what to do about each, Merge into main, Remove that keeps a copy of
anything at risk, Forget missing folders, and the per-run worktree switch), a
slim scroll indicator that takes no width, Ctrl +, Ctrl - and Ctrl 0 that
remember the interface scale, chat messages over 16,000 characters refused
instead of cut, the multi-PC report counting commits on a detached worktree,
and a compile cache for Studio's own modules.

Merged from branches that were parked, each finished with the tests it was
missing: the tree-brightness GPU fix (the owner's look at it on the laptop is
still owed), the media player redesign (with the bugs its new tests found), and
Studio's coding-agent desktop (builder mode; its sessions Home stays behind its
own switch, off by default), whose task list now marks tasks that work in their
own worktree.

Engine waves A and B, finished on the same integration branch: Windows
notifications, a taskbar flash and count and quiet hours; Report a problem and a
prompt after a crash; What's new after an update; undo for deleted tasks and
ideas (Recently deleted) and plan versions; Search recents and quick add
(`task …`, `idea …`); rules for agents; project search and list tools; changed
files with Accept and Revert for a file or a whole attempt, advisory checks and
the `run_check` and `project_logs` tools, before and after pictures; a time
limit and usage on each task, pictures on a message, the `@ # /` picker and the
Skills page. The room the new shell needs (four derived edges, `MefiNav.layout`
and `MefiNav.usable()`) is in.

Skills everywhere and Connectors (landed 6 October): answer styles for the chat
(Explain like I'm 5 by default, Short answers, Teach me, Brainstorm, Poke holes,
Expert) on a chip in Social's and Studio's message boxes; every skill always on,
picked when it fits (`use_skill`) or only called, separately for the chat, the
helper agents and the builders (Skills › How skills are used); Team ›
Connectors adding, approving, testing and importing MCP servers (from Claude
Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex, OpenCode and Gemini
CLI), with encrypted values and per-place switches; and a tool loop whose calls
run side by side, with MCP servers kept open between calls and Streamable HTTP
servers supported.

The new shell itself, built in pieces on the same branch: the frame (a top bar
with the Social | Studio switch, Search and the need pill; a session-list column
and an inspector you resize by dragging or with keys, or fold into drawers in a
small window; a status bar; Reset layout), tabs you add and pin that Studio
keeps tidy (a preview tab, a background tab with a badge when an agent needs
you, at most 8, Recently closed, Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+1 to 9), Size
and density with a live miniature of the window, Today (Social's home) with one
Inbox for everything waiting on you, and Studio's session list, thread and
inspector (Plan, Changes, Checks, Preview, Agent).

Landed from 1 to 5 October, ending with **the 0.5 layout as the only layout** (5
October): the classic layout and its code are gone, with no way back (no
Settings switch, no Search action, no `MEFI_STUDIO_LAYOUT`). In it: Work, Map,
Team and Friends on the rail; Settings, a three-step first run and the plan
draft page; the status bar, Search and one Inbox; Today in both modes; the Map
(Map | Fleet | Pipelines, Running only, View); Team's places; and Friends as one
page. The new **Chrome** theme (matte black and chrome with an iridescent
finish) is what a new install opens in, and every theme had a finish pass.

Friends needs no setup any more: rooms, room chat, Listen together, companions
and cowork file claims run through the Mefi Studio relay, a free Cloudflare
worker built into Studio (its code is under `relay/`). The Lobby, invite
codes, Who's online and the Project hub with credits and ranks came with it.

Landed on 5 and 6 October, after the layout:

- **Social and Studio** are the two modes' names (Social for time with friends
  and a light eye on agents, Studio for in-depth building with the social
  features still there). Labels only: settings keep `vibe` and `build`, so
  nothing resets. Studio's rail shows each place's whole word at every window
  size, Search has one home (the top bar), and the window no longer scrolls
  under a page.
- **The social side:** an open room reads like a chat app, rooms are cards,
  Friends has icons and plain words; a review's fixes (say what helps, why a
  play earned nothing, private first rooms, a steady Lobby, one vocabulary);
  two Studios meeting through the relay are proven end to end; Friends ›
  Moderation and Report on projects; pop-ups from friends (a friend opened
  Studio, an invite or request, a play or star of your project); Building now
  in The Lobby; Friends › Events (the week's Build Jam, co-work hours,
  building together, a community budget); credits that cannot be farmed, and
  no Discord roles needed (Flame rank lists a room, moderators are named
  accounts). Your PCs and Friends reconnect by themselves after a restart,
  update, rollback or crash, and only a Studio that is really behind is asked
  to update.
- **Media:** Playlists in the media menu (five starting points, your own
  lists), shared in a room or on the Project hub.
- **Team:** the simple Seats and models page and Providers (one provider for
  every project, logins), how-to text behind small "i" circles, thinking
  levels for Claude Code, Codex and OpenCode (light first, a step harder per
  miss, a stronger model after two) with a report card and 5-job trials per
  kind of job, and a way to Routing that opens More settings at Routing. Kill
  switches: `MEFI_STUDIO_THINKING_OFF=1`, localStorage `mefiStudio.infoTips` =
  `off`.
- **Speed:** board pushes carry only the rows that changed (S3), startup marks
  and a settings cache (S1), live CLI progress and prompts a provider can cache
  (S12), the studio log on disk and Trace's Load older (S2). Each has a kill
  switch: `MEFI_STUDIO_FULL_PUSHES=1`, `MEFI_STUDIO_STARTUP_MARKS=0`,
  `MEFI_STUDIO_SETTINGS_CACHE=0`, `MEFI_STUDIO_LIVE_PROGRESS=0`,
  `MEFI_STUDIO_PROMPT_CACHE=0`, `MEFI_STUDIO_LOG_CORE=0`. Measured in TESTRUNS
  and [performance.md](performance.md). Background git calls start no
  fsmonitor daemons, and Claude workers get only the desk's MCP servers
  (`MEFI_STUDIO_WORKER_OWN_MCP=1` gives them the owner's own).
- **Builds and tests:** every green push to `main` leaves a ready-to-run beta
  zip in Actions for 14 days (Studio's Development channel installs it, see
  [update-channels.md](update-channels.md)); the release workflow has a gate
  GitHub's machines can pass, a smoke launch before anything is published,
  SignPath signing that switches on with its settings, and the Rust host
  switch ([code-signing.md](code-signing.md)); test runs on one PC take turns,
  and a stage that runs past its limit is stopped with everything it started.

Landed on the evening of 6 October:

- **My PCs** (`feat/my-pcs`): your PCs live in Friends › Your PCs, sending work
  between them, and a laptop that hands off on low battery
  ([my-pcs.md](my-pcs.md)). **Other apps** (`feat/studio-api`): a setup prompt
  and a Studio API, MCP server and skill for other apps on this PC, off until
  turned on. **Resources** (Team › Resources): the resource manager for other
  apps. The model-performance ledger race (`fix/model-perf-race`).
- **The 0.5 polish pass** (`wip/polish-0.5`): a fresh-profile walk of every
  page and menu in both modes, every theme, interface scale 80 to 150% and
  window sizes down to 600 px. The first run in plain words that really puts
  Studio on the tool you signed in to (or OpenCode's free models), Start a new
  app leading a first launch, Social's rail and reach (Friends' and Team's
  places as a row when the list column is closed, Help), one list for Friends'
  places (Events in the rail and Search), the guided tour rewritten for the
  0.5 layout, the Map and Team named that everywhere, and fixes: a blank menu
  after switching modes from a page, Configuration and Friends leaving their
  layer behind, the classic tree strip over Settings, Plans squeezed in a
  smaller window, key tips over the first-run dialog and menus.

From the DevDay branch: GPT-6.1 Sol, Codex workers over `codex app-server`,
using a ChatGPT plan, the Studio Daily on the launch screen, the Models
Catalog and Performance face lift, and security fixes for remote approvals,
catalogs and sharing.

The Rust host is on `main` too (stages 1 and 2 of
[rust-migration.md](rust-migration.md)): a source checkout runs on it with
`npm run host`, a portable host build exists (`npm run package:host`), and
parts of the engine already run in Rust there (settings and keys, a message's
pictures, the Skills page's files, before and after pictures, the Git chip).
None of it changes the Electron build that ships; `release.yml` builds a host
zip only when it is started by hand with `host: tauri`.

## Still to land for 0.5.0

As of the evening of 6 October every finished branch is on `main`. What is left
on GitHub is parked work for 0.5.x, the site's branches (`gh-pages`) and
branches already replaced on `main`.

| Work | Branch | State |
| --- | --- | --- |
| Space plays or pauses the video on the Map | `wip/space-plays-video` | Parked for 0.5.x: unfinished (nothing calls it yet), and it stops saving the Map's spin, which your toggles-survive-restarts rule keeps |
| `scripts/agent-link.mjs`, a draft | `wip/agent-link` | Parked; Other apps' `studio-link.mjs` (on `main`) does what it sketched |
| Not built: an embedded live Preview tab (the inspector's Preview has the project's controls and Before and After), the pinned tree strip as a panel, Drafts in the session list (the app keeps none) | — | 0.5.x. Design source: `docs/prototype/` |

Replaced on `main`, safe to delete once their chats agree:
`wip/s1-boot-startup-marks`, `wip/s2-log-core`, `wip/s3-row-push`,
`wip/s12-cli-stream`, the `land/s*` and `land/speed-*` branches, `fx/scaling`,
`wip/land-ui-today`, `ui/social-studio-names` and
`fix/git-fsmonitor-worker-mcp` (both landed as replayed copies),
`wip/release-0.4.5*` and `wip/release-yml-host-switch` (folded into
`release.yml` on 6 October), `feat/studio-api`, `feat/my-pcs`,
`fix/model-perf-race` and `land/model-perf-race` (landed 6 October), and the
local `claude/stage-2-verification-gates-1e8dc9` (its release.yml host switch
is the one `main` has).

Worktrees in Studio are implemented, including the entry in the new shell and
the mark on Studio's task rows; the attended owner workflow checks remain (Try
by hand, below).

## What still needs the owner

Nothing below blocks the code landing on `main`. These need a Windows PC or a
decision, and each has an owner-side default already in the code.

**On each PC, once `main` is pulled**

- Friends: one real Sign in with Discord (Friends, Sign in with Discord,
  Authorize in the browser, The Lobby appears). Optionally, the Discord user
  IDs of anyone else who should moderate. No Discord role IDs are needed, and
  the developer portal settings are done.
- Publish every branch that exists only on a PC (`overhaul/phase2`,
  `codex/release-signing-gated`, the `C:\wt\*` worktrees) as `wip/<topic>`
  with GitHub Desktop, then run `npm run worktrees` and `npm run sync`. A
  branch that is not on GitHub cannot be seen from a cloud session and is lost
  with the PC. (DevDay is published and on `main`.)
- Copy `C:\Users\echor\.claude\plans\enumerated-hugging-fern.md` into
  `docs/plans/` so every PC and session can read it.
- After pulling, delete the local branches `git branch --merged origin/main`
  lists. On GitHub, only delete a branch that is in `main` or `gh-pages`, never
  one listed under "Still to land" above. The branch-cleanup chat has its list
  ready and waits for your "yes" in that chat.
- The full `npm test` passed on the owner's PC on 6 October, every window suite
  included (`shell_render` at 125% display scaling with 4b150b3), so a failure
  there now is new. On the Linux lane `project_map_render`, `settings_render`,
  `team_render`, `unified_studio_render`, `workflow_render` and `command_render`
  fail at the small window sizes before and after the 5 and 6 October work
  (Linux fonts); judge them on Windows.
- Check that the live relay runs `main`'s relay code: Friends › Events and the
  community budget (`relay/src/events.mjs`, `economy.mjs`, store schema 5)
  came after its first deploy on 5 October, and the reconnect work's version
  window (the hello's `oldest` field) is not deployed yet; both Studios connect
  meanwhile. Redeploy it ([relay/README.md](../relay/README.md), "Deploying").
- To try `main` on another PC without packaging a release: download the newest
  beta zip from a green "Studio checks" run on `main` (the
  `mefi-studio-development-win32-x64` artifact), then Settings › System ›
  Updates › Development / beta keeps it current (it needs a GitHub login that
  can read Actions; [update-channels.md](update-channels.md)).
- Measure startup once (`tools/benchmark_startup.py`) so the load-time work has
  a number to beat.

**Try by hand (what tests cannot prove)**

- Notifications: the test button with Studio in front and then away, a real
  question while you are away, the taskbar count, a click that opens the task,
  quiet hours, killing Studio in Task Manager and relaunching (one crash prompt),
  an update followed by What's new, and a rollback that stays silent.
- Changed files: a real builder run on a Git project with the preview running,
  then the task's Evidence: Changes and checks (files, diff, Accept, Revert all,
  Undo, Run build); CRLF files; `node_modules` junctions.
- Pictures and the picker: a pasted screenshot (Win+Shift+S), a dragged image,
  the `@ # /` popup with an input method open, the Skills page on a synced or
  OneDrive folder.
- Delete then Undo, More › Recently deleted, Search › Recent and `task …`, and
  Plans › Versions › Restore.
- Project search: turn Read project files on, ask the companion to search, then
  try a folder junction, a differently-cased path and a `.gitignore` saved by
  Notepad.

**Try by hand: the new layout** (the only layout now; the real-window tests
check geometry, not how it feels)

- Keys on a real keyboard: Ctrl+M (Social or Studio), Ctrl+B and `[` (list,
  inspector), Ctrl+T, Ctrl+W (closes a tab and never the window, also on Today),
  Ctrl+Tab, Ctrl+1 to 9, Ctrl+Shift+T, Ctrl+N (new task), Ctrl+J (Inbox). On an
  AltGr layout (German, Polish, Czech) check that characters typed with AltGr
  are not swallowed.
- Display scaling 125, 150 and 175% at the smallest window (600x560): the bar, the
  tab strip's "N more" and one-menu forms, the drawers, the Layout menu and the
  Size page stay inside the window with no text under 12 px; Segoe UI text at
  Size › Largest.
- Drag the list and inspector edges (mouse, then touch or pen), double-click to
  reset, Reset layout and its Undo; restart and let Studio update itself: the
  panels, tabs, pins and the open session come back.
- A real agent asking a question: a background tab with a badge and the need
  pill; a Windows notification whose click opens that task (one) or the Inbox
  (several); the tab card's Badge only and Open and focus choices.
- A session thread with real pictures (Attach picture, paste, the lightbox with a
  very large PNG), Accept, Revert and Undo in the inspector, a worktree run's
  branch mark on a Windows path.
- Interface scale: Ctrl +, Ctrl - and Ctrl 0 following the page, and the real
  window zoom against the Size page's miniature; a light theme and a custom
  palette (the badge, the count chip, focus rings). Windows high-contrast mode is
  not handled anywhere in the app.
- Start Studio with `MEFI_STUDIO_NO_TAB_MANAGER=1` from a shortcut: the tab card
  says so and its master switch stays off.

**Try by hand: what landed 1 to 5 October**

- Friends between two PCs through the relay: an invite code, Who's online, a
  room's chat after one PC was closed for a while (the missed messages fill
  in), Listen together, a cowork file claim, and a Project hub card played for
  two minutes (both sides earn credits).
- The Map with real sessions: Map | Fleet | Pipelines, Running only, View ▾
  and its keys, at 600x560 and at full size.
- Chrome on a real display: the gradients, focus rings and small text at 125
  and 150% scaling, and a switch to another theme.
- A ChatGPT plan sign-in, one Codex worker over `codex app-server`, and the
  Studio Daily after a night away.

**Try by hand: what landed 5 and 6 October**

- The names: the top bar's Social | Studio switch, Settings' "Always start in
  Social", Search's "Switch to Studio", and that your mode and settings came
  through the rename unchanged.
- An open room as a chat between two PCs, Friends › Events (the Build Jam and
  a co-work hour), a pop-up when a friend opens Studio, Report on a project,
  and a playlist shared into a room and onto the Project hub.
- Team › Seats and models with the "i" circles, Providers with your real
  logins, and a Claude Code run's thinking level in its attempt list.
- A long Claude Code or Codex run showing its steps live, and Trace's Load
  older reading past what is in memory.

**Decisions**

- Notifications: the defaults (finished tasks off, quiet hours off, sound off)
  and the Windows toast header. The portable build has no Start Menu shortcut,
  so the header may show the raw id `MefiStudio.StudioAIPlus`: register a display
  name and icon (an HKCU AppUserModelId key) or write a Start Menu shortcut
  with that id. Social's own "What's new" card and the new one could be merged.
- Undo for deletes: a failed write to the trash file refuses the delete ("Nothing
  was deleted: the disk is full") instead of deleting with no way back.
  `MEFI_STUDIO_NO_BOARD_TRASH=1` switches the trash off.
- Time limit and skills: whether to lift the 25 minute hard kill so longer limits
  work; whether to raise the 16 KB skill cap; whether custom or local models may
  be marked as able to see pictures; whether pictures and the picker reach the
  task session's and Social's message boxes too.
- Project search: whether Grok and Antigravity keep receiving `AGENTS.md` and
  `CLAUDE.md` from Studio, and whether the 4,000 and 8,000 character limits and
  the off-by-default switches suit you.
- Studio's Home: whether the sessions layout becomes the only Home (the classic
  Home is the default today, and every fixture that pins it would need
  rewriting); whether Social keeps its Build it box and work cards or goes
  social-first with one compact work card; that the Worktree chip turns per-run
  worktrees on from the window (the module keeps them opt-in until you flip the
  default); and that the worker and tier pickers copy the routing defaults into
  a Project team when a project inherits them.
- The tree-brightness look (Singularity's crescent and progress fill keep more
  colour; the front ring of two overlapping nodes runs under the one behind), and
  the media queue rule (it is still in progress, tests pin today's order, and the
  redesign has no kill switch).
- Friends: whether it ships switched on in 0.5.0 if the real sign-in test is
  not done by the release candidate (it can ship switched off; the relay is
  deployed, and nothing waits on Discord roles).
- The new shell: the pinned tree strip as an optional panel, and whether
  Social's Home gets a rail (it has none). (Decided on 5 October: the modes are
  Social and Studio, and the classic layout went at 0.5.0 instead of 0.5.1.) In
  the tabs: that Ctrl+W never closes the window, even on Today (or lets Ctrl+W
  on Today fall through to Close), whether the tab keys get a switch of their
  own, and that Home is titled Today in Studio too. In Today: "Answer all"
  (named in the brief, in no plan or prototype) is not built, the count leaves
  out plans waiting on you, and "Decide later" lasts for the session. In the
  sessions: a Queued group was added, there is no decision countdown (the host
  decides at once where the permission mode allows it, and waits otherwise), a
  Note cannot carry a picture and Ctrl+N is not bound in Social. In Size:
  Configuration keeps its own live Interface scale slider beside the page's
  draft and Apply (one home per control if you want a chip later).

**At release time only**

- The release workflow is ready (6 October): a tag push runs the full `npm test`
  on a hosted Windows runner, where four real-window suites have failed since
  0.4.0. If it stops there, start **Publish portable release** by hand with the
  tag and `gate: hosted`, which runs everything else; only for a tag that passed
  the full gate on a PC (its TESTRUNS row). Either way the packaged app must
  open once before anything is published, and a tag publishes the Electron
  build, as 0.5.0 should. Signing stays off until SignPath accepts the project
  and its settings are added ([code-signing.md](code-signing.md)).
- Bump the version (`package.json` still says 0.4.5) and cut `[0.5.0]`, then
  run `node scripts/release-notes.mjs` and commit the JSON it writes:
  `assets/whats-new.json` stops at 0.4.4, and `--check` fails once `[0.5.0]`
  is cut until it is regenerated. Consider wiring `node
  scripts/release-notes.mjs --check` into `npm run check`.
- Write `docs/releases/0.5.0.md` leading with the manual update steps (0.4.4
  cannot update itself), retarget the docs that still name 0.4.5 (the README
  and the public site already say 0.5), and rehearse the update with
  `tests/update_rehearsal.test.mjs`.
- No executable, tag or `gh-pages` download change happens before you say so.

## Follows in 0.5.x

Related folders, new app from a template, effort settings, saved map views, and
good-for text for seats you define. (Connectors landed in 0.5.0: see Included.)

## Included with a service dependency

Rooms, room chat, shared playback, companions in the Playground and cowork file
claims run through the Mefi Studio relay, which is deployed and built in, so
they need no setup. Discord linking, Sign in with Discord and Discord remote
controls still need the Discord app's settings, and remote controls also need
the bot's matching support. Describe the Discord parts as rolling out, not
available to every installation. The local media player and Practice with Pip
need neither.

## Deferred or undecided

Fleet's later work (agent lanes and budgets, missions measured from verified
work, other PCs' and friends' fleets), Linux packaging, creative-tool
integrations, room GitHub access, shared agent capacity, cosmetics, shared
mixes, voice and code signing. No date is promised for these. (Credits and
ranks landed with the Project hub.)

## Public site

The [site](https://nateecho32-stack.github.io/mefi-studio/) and its
[roadmap](https://nateecho32-stack.github.io/mefi-studio/roadmap.html) say 0.5
is being built and that Studio is moving to Rust, with screenshots of the
0.5 layout. The public site now uses the supplied Vibe Studio V/star artwork
and a dark, lime and aqua finish; the app's existing looks remain available.
The site labels its demo as simulated and its launch offers as planned, with
checkout unopened. Their source lives on `gh-pages`, separately
from the application, and never merges into `main`. Keep the download and
latest-release labels on 0.4.4 until 0.5.0 is actually published.
