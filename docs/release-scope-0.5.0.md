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

Merged from branches that were parked, and being finished before they reach a
release: the tree-brightness GPU fix, the media player redesign, and Build as a
coding-agent desktop (behind a layout switch, off by default).

## Planned for 0.5.0

In this order. Anything not finished and tested at the first release candidate
moves to 0.5.x instead of holding the release.

- **The new shell.** Vibe (calm, glanceable) and Build (in depth) share one menu,
  one tab set, one inbox and one status bar. Tabs can be added and pinned and
  Studio manages the rest; panels resize; text and information size have a live
  preview; scrollbars show only while a pane can scroll and take no width; media
  and previews stay visible. Design source: `docs/prototype/`.
- **Engine, wave A:** alerts and Windows notifications, the long-paste limit,
  undo for deletes and plan versions, Report a problem and the crash prompt,
  What's new per version, Ctrl K recents, rules for agents, project search and
  list tools. (Updater rollback has landed.)
- **Engine, wave B:** changed files with Accept and Revert, advisory checks,
  usage and a time cap, before and after shots, image attach, the `@ # /` picker
  and the Skills page.
- **Load times, agents sending only what is new, logging and Friends 2.0** (the
  work planned for the skipped 0.4.5 and 0.4.6): measured first, then fixed.
- **Worktrees in Studio:** a Worktrees page and a per-run Worktree choice, on top
  of `npm run worktrees`.

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
