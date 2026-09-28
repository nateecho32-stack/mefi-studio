# Roadmap updates after the research (read with owner-and-roadmap-input.md; this file wins where they differ)

Checked against origin/main and continuing.md at 2026-09-28 17:05.

## Built on main since the research, so "Coming in 0.4.5"
- 704ef0d Typing goes to the open menu's box.
- 39a153d Start with Windows; Your PCs shows what each PC's agents are doing.
- 6a94370 Startup opens even when the window paints nothing.
- 16544dd Plans face lift: one step at a time, quick-then-deep models, project ready early.
- 5732ceb Reach your PCs from Discord: the Studio side of the DM remote (the bot side is not live yet,
  so describe it as coming with the bot side, not as working today).
Re-run `git log --oneline v0.4.4..origin/main` in the app repo for anything newer.

## Now In progress (work has started; label "In progress", say what it is for)
- **The 0.4.5 build** (started 2026-09-28, paused at the usage limit, partial and uncommitted). The
  0.4.5 tag waits for these four:
  - agents get only what's new instead of whole packages, a work journal with older history, and
    run transcripts;
  - structured logs, with old logs archived and all kept;
  - faster launch;
  - Friends 2.0: a lobby with rooms, who's online, same-Wi-Fi discovery, signed invite links (guest
    passes may slip to 0.4.6), and a fair shared-video queue. A closed room's Discord thread is
    deleted 7 days after the room closes unless a report is open.

  Label these "In progress for 0.4.5" (not "Planned for 0.4.5"). Keep the queue details from
  owner-and-roadmap-input.md.
- **Community model ratings and an updated model tracker.**
  - A #model-reviews forum in the Discord, run by the bot, with one post per model. Members rate
    models per task and post tips.
  - Ratings feed Studio's model picks from real use: release notes first, comments broken into
    task kinds, and probes Studio can run on demand.
  - Community evidence nudges a pick only a little.
  - Built on work-in-progress branches in both repos, not on main yet.
- **Build mode as a coding-agent desktop.**
  - Build mode manages work the way the Claude Code and Codex desktop apps do: tasks listed like
    sessions, a task session page, and panes (Activity, Output, Checks, Preview, Queue, Status)
    that dock or pop out as windows.
  - Built on a branch and not yet tested. The owner still has questions to answer.
- **Home PCs that keep working, reachable from Discord.** The Studio side is on main (Coming in
  0.4.5); the bot side is on a branch.

## Planned
- **Vibe as the social mode**, with Home bringing Vibe back. Not started.
- **After 0.4.5:** Linux (ported after 0.4.5); the creative-tool bridge (roadmap only); plus the
  rest of the after-0.4.5 list in owner-and-roadmap-input.md.
- **Keep the community plan exactly as given:** credits are earned only, never bought, never for
  invites, and never tied to Discord activity.
