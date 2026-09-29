# 0.4.5 release scope

Updated 29 September 2026. The published Windows download is still 0.4.4.
This records the scope of the next release; it does not announce a release
date or replace the packaging and release checks.

## Included

The work already on `main`: the setup helper and first-run fixes, multiple
coding CLI logins, startup preferences, update installation fixes, consistent
agent wait reasons, Vibe progress and MEFI suggestions, the Plans and Task
board cleanup, agent habits, Needs you fixes, Configuration, menu typing and
confirmations, the reachable media player, companion personalities and node
finish effects, PC setup and sharing, and reduced work while hidden.

The first Fleet page is included: Agents › Live › Fleet has Graph, Table,
Recent, Tree and Health views, the seat inspector, and Open in Command. Its
host model and page are on `main`; the larger Fleet overhaul remains later
work. Configuration already finds setup-helper sections and pins Walk me
through setup. PC sync also catches a merge that drops another branch's work.

This quick-win pass adds Friends to the main menu with direct Rooms, Your PCs
and Playground links, and extends the Task board's compact sliding cards to
Ideas through one shared layout helper.

## Included with a service dependency

Rooms, shared playback, playdates, cowork file claims, Discord linking and
Discord remote controls have desktop-side code. They need a configured rooms
hub and Discord connection, and remote controls also need the bot's matching
support. Describe these as rolling out, not available to every installation.
The local media player and Practice with Pip work without a hub.

## Deferred

- **Targeted for 0.4.6:** the broader agent delta/context/journal work,
  structured logging and transcripts, the measured startup/cache work, and
  Friends 2.0. Existing groundwork can remain in 0.4.5 without promising these
  complete features.
- **Later Fleet work:** agent lanes and budgets, missions measured from
  verified work, and other PCs' and friends' fleets.
- **Work in progress outside this release:** the coding-agent desktop,
  community model ratings, Command sub-agent additions, the media-player
  redesign and tree-brightness changes still on their own branches. Each
  needs its own review and checks before it becomes a release commitment.
- **Planned or undecided:** the full menu overhaul, welcome-back hub, the
  rest of the card-layout rollout (Providers, Plans, Vibe and Project map),
  Linux packaging, creative-tool integrations, room GitHub access, shared
  agent capacity, community credits and cosmetics, shared mixes, voice and
  code signing. No date is promised for these.

## Public site

The release boundary is shown on the
[roadmap](https://nateecho32-stack.github.io/mefi-studio/roadmap.html) and
the [0.4.5 guide](https://nateecho32-stack.github.io/mefi-studio/wiki/#/coming-in-0-4-5).
Their source lives on `gh-pages`, separately from the application. Keep the
download and latest-release labels on 0.4.4 until 0.4.5 is actually published.
