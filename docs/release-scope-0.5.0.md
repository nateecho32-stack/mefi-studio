# 0.5.0 release scope

Updated 30 September 2026. The published Windows download is still 0.4.4. This
records the scope of the next release; it does not announce a release date or
replace the packaging and release checks. **0.4.5 and 0.4.6 are skipped:** what
was planned for them ships in 0.5.0. The plan is
[plans/0.5.0-plan.md](plans/0.5.0-plan.md); the earlier scope note is kept at
[archive/release-scope-0.4.5.md](archive/release-scope-0.4.5.md).

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
and `MefiNav.usable()`) is in and off by default: `?layout=v2` shows it.

The new shell itself, built in pieces on the same branch and off by default
(`?layout=v2`, or `MEFI_STUDIO_LAYOUT=v2`; every piece draws, stores and asks for
nothing without it): the frame (a top bar with the Vibe | Build switch, Search and
the need pill; a session-list column and an inspector you resize by dragging or
with keys, or fold into drawers in a small window; a status bar; Reset layout),
tabs you add and pin that Studio keeps tidy (a preview tab, a background tab with
a badge when an agent needs you, at most 8, Recently closed, Ctrl+T, Ctrl+W,
Ctrl+Tab and Ctrl+1 to 9), Size and density with a live miniature of the window,
Today (Vibe's home) with one Inbox for everything waiting on you, and Build's
session list, thread and inspector (Plan, Changes, Checks, Preview, Agent).

## Planned for 0.5.0

In this order. Anything not finished and tested at the first release candidate
moves to 0.5.x instead of holding the release.

- **The new shell:** built and off by default (see above): Vibe (calm,
  glanceable) and Build (in depth) share one menu, one tab set, one inbox and one
  status bar; tabs can be added and pinned and Studio manages the rest; panels
  resize; text and information size have a live preview; scrollbars show only
  while a pane can scroll and take no width. What remains is the owner's look at
  it on the PC, fixing what that shows, and turning it on by default. Not built:
  an embedded live Preview tab (the inspector's Preview has the project's
  controls and Before and After), the pinned tree strip as a panel, and Drafts in
  the session list (the app keeps none). Design source: `docs/prototype/`.
- **Load times, agents sending only what is new, logging and Friends 2.0** (the
  work planned for the skipped 0.4.5 and 0.4.6): measured first, then fixed.
- **Worktrees in Studio:** implemented, including the entry in the new shell
  and the mark on Build's task rows. The current Windows aggregate exercises
  the Worktrees page; attended owner workflow checks remain.

## What still needs the owner

Nothing below blocks the code landing on `main`. These need a Windows PC or a
decision, and each has an owner-side default already in the code.

**On each PC, once `main` is pulled**

- Publish every branch that exists only on a PC (`feat/devday-2026`,
  `overhaul/phase2`, `codex/release-signing-gated`, the `C:\wt\*` worktrees) as
  `wip/<topic>` with GitHub Desktop, then run `npm run worktrees` and
  `npm run sync`. A branch that is not on GitHub cannot be seen from a cloud
  session and is lost with the PC.
- Copy `C:\Users\echor\.claude\plans\enumerated-hugging-fern.md` into
  `docs/plans/` so every PC and session can read it.
- After pulling, delete the local branches `git branch --merged origin/main`
  lists (the parked `wip/*` branches are in `main` now).
- Run the real-window fixtures that hosted CI skips, one at a time: at least
  `builder_render` and `command_render`.
  `project_map_render` also fails on the Linux lane at 600x560 and 150% zoom
  (9 px over its box) with or without this work; check it on Windows.
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

**Try by hand: the new layout** (`?layout=v2`, or `MEFI_STUDIO_LAYOUT=v2`; the
real-window tests ran on Linux fonts and Linux zoom only)

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
- The new shell: the two modes' labels (keep Vibe and Build, or rename), whether
  the classic chrome is deleted at 0.5.0 or 0.5.1, the pinned tree strip as an
  optional panel, and publishing the site's motion work after it is retargeted
  from 0.4.5 to 0.5.0. In the tabs: that Ctrl+W never closes the window in the new
  layout, even on Today (or lets Ctrl+W on Today fall through to Close), whether
  the tab keys get a switch of their own, and that Home is titled Today in Build
  too. In Today: "Answer all" (named in the brief, in no plan or prototype) is not
  built, the count leaves out plans waiting on you, and "Decide later" lasts for
  the session. In the sessions: a Queued group was added, there is no decision
  countdown (the host decides at once where the permission mode allows it, and
  waits otherwise), a Note cannot carry a picture and Ctrl+N is not bound in
  Vibe. In Size: Configuration keeps its own live Interface scale slider beside
  the page's draft and Apply (one home per control if you want a chip later).

**At release time only**

- Bump the version and cut `[0.5.0]`, then run `node scripts/release-notes.mjs`
  and commit the JSON it writes (`tests/release_notes.test.mjs` fails on the
  repo until it does), and consider wiring `node scripts/release-notes.mjs
  --check` into `npm run check`.
- Write `docs/releases/0.5.0.md` leading with the manual update steps (0.4.4
  cannot update itself), retarget the README, the docs and the public roadmap
  from 0.4.5, and rehearse the update with `tests/update_rehearsal.test.mjs`.
- No executable, tag or `gh-pages` publish happens before you say so.

## Follows in 0.5.x

Connectors, related folders, new app from a template, effort settings, saved map
views, and good-for text for seats you define.

## Included with a service dependency

Rooms, shared playback, playdates, cowork file claims, Discord linking and
Discord remote controls have desktop-side code. They need a configured rooms hub
and Discord connection, and remote controls also need the bot's matching
support. Describe these as rolling out, not available to every installation. The
local media player and Practice with Pip work without a hub.

## Deferred or undecided

Fleet's later work (agent lanes and budgets, missions measured from verified
work, other PCs' and friends' fleets), Linux packaging, creative-tool
integrations, room GitHub access, shared agent capacity, community credits and
cosmetics, shared mixes, voice and code signing. No date is promised for these.

## Public site

The release boundary is shown on the
[roadmap](https://nateecho32-stack.github.io/mefi-studio/roadmap.html) and the
0.4.5 guide on `gh-pages`. Those pages still say 0.4.5 and must be retargeted to
0.5.0 before anything is published. Their source lives on `gh-pages`, separately
from the application. Keep the download and latest-release labels on 0.4.4 until
0.5.0 is actually published.
