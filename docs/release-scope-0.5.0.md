# 0.5.0 release scope

Updated 6 October 2026. The published Windows download is still 0.4.4. This
records the scope of the next release; it does not announce a release date or
replace the packaging and release checks. **0.4.5 and 0.4.6 are skipped:** what
was planned for them ships in 0.5.0. The plan is
[plans/0.5.0-plan.md](plans/0.5.0-plan.md); the earlier scope note is kept at
[archive/release-scope-0.4.5.md](archive/release-scope-0.4.5.md).

0.5.0 ships as the Electron build. It is also the bridge release the move to
Rust needs: its updater already knows the Rust host's zip, so a later release
can change hosts ([rust-migration.md](rust-migration.md), "The bridge
release"). The Rust host is not on 0.5.0's path.

## Included

The work already on `main` since 0.4.4 (`CHANGELOG.md`, Unreleased): the setup
helper and first-run fixes, multiple coding CLI logins, startup preferences,
update installation fixes and the update safety net (a saved copy, a boot watch
and Roll back), consistent agent wait reasons, Vibe progress and MEFI
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
Build as a coding-agent desktop (behind a layout switch, off by default), whose
task list now marks tasks that work in their own worktree.

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

The new shell itself, built in pieces on the same branch behind a switch
(every piece draws, stores and asks for nothing in the classic layout): the
frame (a top bar with the Vibe | Build switch, Search and
the need pill; a session-list column and an inspector you resize by dragging or
with keys, or fold into drawers in a small window; a status bar; Reset layout),
tabs you add and pin that Studio keeps tidy (a preview tab, a background tab with
a badge when an agent needs you, at most 8, Recently closed, Ctrl+T, Ctrl+W,
Ctrl+Tab and Ctrl+1 to 9), Size and density with a live miniature of the window,
Today (Vibe's home) with one Inbox for everything waiting on you, and Build's
session list, thread and inspector (Plan, Changes, Checks, Preview, Agent).

Landed from 1 to 5 October, ending with **the 0.5 layout as the default**:
Studio opens in it unless you chose the classic one before, and the classic
layout stays one switch away (Settings › You, Search's "Switch layout", or
`MEFI_STUDIO_LAYOUT=v1` for one launch). In it: Work, Map, Team and Friends on
the rail; Settings, a three-step first run and the plan draft page; the status
bar, Search and one Inbox; Today in both modes; the Map (Map | Fleet |
Pipelines, Running only, View); Team's places; and Friends as one page. The new
**Chrome** theme (matte black and chrome with an iridescent finish) is what a
new install opens in, and every theme had a finish pass.

Friends needs no setup any more: rooms, room chat, Listen together, companions
and cowork file claims run through the Mefi Studio relay, a free Cloudflare
worker built into Studio (its code is under `relay/`). The Lobby, invite
codes, Who's online and the Project hub with credits and ranks came with it.

From the DevDay branch: GPT-6.1 Sol, Codex workers over `codex app-server`,
using a ChatGPT plan, the Studio Daily on the launch screen, the Models
Catalog and Performance face lift, and security fixes for remote approvals,
catalogs and sharing.

The Rust host is on `main` too (stages 1 and 2 of
[rust-migration.md](rust-migration.md)): a source checkout runs on it with
`npm run host`, a portable host build exists (`npm run package:host`), and
parts of the engine already run in Rust there (settings and keys, a message's
pictures, the Skills page's files, before and after pictures, the Git chip).
None of it changes the Electron build that ships.

## Still to land for 0.5.0

As of 6 October. Anything not finished and tested at the first release
candidate moves to 0.5.x instead of holding the release.

| Work | Where it is | State |
| --- | --- | --- |
| Subscriptions and agent routing | `wip/models` | On today's `main`, in CI |
| Credits that cannot be farmed; the Lobby front page and one Sign in with Discord card; no Discord roles needed (Flame rank lists a room, moderators are named accounts) | `wip/credits-guard` (includes `wip/social`) | Windows CI green; landing with the relay redeployed. Nothing waits on Discord role IDs any more |
| Load times and agents sending only what is new: row push deltas (S3), startup marks and a settings cache (S1), live CLI progress and the prompt cache (S12), the log core (S2) | `wip/s3-row-push`, `wip/s1-boot-startup-marks`, `wip/s12-cli-stream`, `wip/s2-log-core` | Partial, parked on a 3 October base. Being finished one at a time, measured before and after. S1's cache sits in front of settings, which the Rust host also reads, so the parity rule applies |
| Vibe and Build as two modes of one shell | in progress | The labels are yours to decide (below) |
| Two real-window suites red on the PCs, even on clean `main`: `layout_contract_render` (the window opens at 1921x1081) and `shell_render` (one pixel at 1100 px) | tests | Display-scaling rounding; to be fixed without weakening what they check. Hosted CI skips them |
| Linux CI (`studio-linux.yml`) red since 4 October | `tests/rust_modules.test.mjs` (image-store folder), `tests/package_host.test.mjs` (`.exe` name) | Two Rust-side tests assume Windows paths. Windows CI is green |
| Not built: an embedded live Preview tab (the inspector's Preview has the project's controls and Before and After), the pinned tree strip as a panel, Drafts in the session list (the app keeps none) | — | Design source: `docs/prototype/` |

Worktrees in Studio are implemented, including the entry in the new shell and
the mark on Build's task rows; the attended owner workflow checks remain (Try
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
  one listed under "Still to land" above.
- The full `npm test` on the PCs fails only in `shell_render`, as on clean
  `main`, until the fix above lands (`layout_contract_render` was retired with
  the classic layout); any other failure is new. `project_map_render` and
  `settings_render` also fail on the Linux lane at 600x560 and 150% zoom, with
  or without this work.
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

**Try by hand: the new layout** (the default now; the real-window tests check
geometry, not how it feels)

- Keys on a real keyboard: Ctrl+M (mode), Ctrl+B and `[` (list, inspector),
  Ctrl+T, Ctrl+W (closes a tab and never the window, also on Today), Ctrl+Tab,
  Ctrl+1 to 9, Ctrl+Shift+T, Ctrl+N (new task), Ctrl+J (Inbox). On an AltGr layout
  (German, Polish, Czech) check that characters typed with AltGr are not swallowed.
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
  and 150% scaling, and a switch back to the classic layout and to another
  theme.
- A ChatGPT plan sign-in, one Codex worker over `codex app-server`, and the
  Studio Daily after a night away.

**Decisions**

- Notifications: the defaults (finished tasks off, quiet hours off, sound off)
  and the Windows toast header. The portable build has no Start Menu shortcut,
  so the header may show the raw id `MefiStudio.StudioAIPlus`: register a display
  name and icon (an HKCU AppUserModelId key) or write a Start Menu shortcut
  with that id. Vibe's own "What's new" card and the new one could be merged.
- Undo for deletes: a failed write to the trash file refuses the delete ("Nothing
  was deleted: the disk is full") instead of deleting with no way back.
  `MEFI_STUDIO_NO_BOARD_TRASH=1` switches the trash off.
- Time limit and skills: whether to lift the 25 minute hard kill so longer limits
  work; whether to raise the 16 KB skill cap; whether custom or local models may
  be marked as able to see pictures; whether pictures and the picker reach the
  task session's and Vibe's message boxes too.
- Project search: whether Grok and Antigravity keep receiving `AGENTS.md` and
  `CLAUDE.md` from Studio, and whether the 4,000 and 8,000 character limits and
  the off-by-default switches suit you.
- Build's Home: whether the sessions layout becomes the only Home (the classic
  Home is the default today, and every fixture that pins it would need
  rewriting); whether Vibe keeps its Build it box and work cards or goes
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
- The new shell: the two modes' labels (keep Vibe and Build, or rename),
  whether the classic chrome is deleted at 0.5.0 or 0.5.1 (the plan says
  0.5.1), and the pinned tree strip as an optional panel. In the tabs: that
  Ctrl+W never closes the window in the new layout, even on Today (or lets
  Ctrl+W on Today fall through to Close), whether the tab keys get a switch of
  their own, and that Home is titled Today in Build too. In Today: "Answer
  all" (named in the brief, in no plan or prototype) is not built, the count
  leaves out plans waiting on you, and "Decide later" lasts for the session.
  In the sessions: a Queued group was added, there is no decision countdown
  (the host decides at once where the permission mode allows it, and waits
  otherwise), a Note cannot carry a picture and Ctrl+N is not bound in Vibe.
  In Size: Configuration keeps its own live Interface scale slider beside the
  page's draft and Apply (one home per control if you want a chip later).

**At release time only**

- Before the first tag, fix the release workflow's gate. A tag push runs the
  full `npm test` on a hosted Windows runner, where the real-window suites have
  failed since 0.4.0. The fix is drafted in `docs/release-workflow-signpath.yml`
  (a `gate` input, `full` or `hosted`, plus a smoke launch and SignPath
  signing). Changing a workflow file needs a token with the `workflow` scope
  (`gh auth refresh -s workflow` on a PC). `release.yml` has no host switch
  yet either, so tags stay Electron, as 0.5.0 should.
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

Connectors, related folders, new app from a template, effort settings, saved map
views, and good-for text for seats you define.

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
is being built and that Studio is moving to Rust, in the Chrome look, with
screenshots of the 0.5 layout. Their source lives on `gh-pages`, separately
from the application, and never merges into `main`. Keep the download and
latest-release labels on 0.4.4 until 0.5.0 is actually published.
