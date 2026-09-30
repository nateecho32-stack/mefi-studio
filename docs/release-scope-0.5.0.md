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

## Planned for 0.5.0

In this order. Anything not finished and tested at the first release candidate
moves to 0.5.x instead of holding the release.

- **The new shell.** Vibe (calm, glanceable) and Build (in depth) share one menu,
  one tab set, one inbox and one status bar. Tabs can be added and pinned and
  Studio manages the rest; panels resize; text and information size have a live
  preview; scrollbars show only while a pane can scroll and take no width; media
  and previews stay visible. Design source: `docs/prototype/`.
- **Load times, agents sending only what is new, logging and Friends 2.0** (the
  work planned for the skipped 0.4.5 and 0.4.6): measured first, then fixed.
- **Worktrees in Studio:** landed (see above), with the mark on Build's task
  rows; what remains is the Worktrees entry in the new shell.

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
  `layout_contract_render` (about 5 minutes; recorded on Linux, every number is
  CSS geometry and should match), `builder_render`, `command_render`.
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
  from 0.4.5 to 0.5.0.

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
