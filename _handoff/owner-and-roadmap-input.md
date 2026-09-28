# Owner requests and roadmap input for the site rebuild (2026-09-28)

## The owner's request (verbatim intent)
Update the site. Use what we are doing now and list off everything that is in it. This should be a
repolishing and upgrade of the current site, plus a better roadmap people can see: what's done,
being worked on, and planned, with a way for people to request new features on GitHub or in the
Discord. A solid visual design; it's a web page, so use web page elements; make it easy and simple;
focus on the community side. The owner plans to make Studio a way to share ideas and projects with
other people and get credits for playing or looking at their project, spend the credits to advertise
the one you have, sell cosmetics for the credits you get or offer styles, and share mixes and show
which ones are played the most if you have "share music taste" turned on in the Friends/profile tab.
Make sure the wiki is up to date. Feel free to update and restyle.

## Labels and honesty rules
- Latest release: 0.4.4 (2026-09-27). The download stays 0.4.4. package.json says 0.4.5 but it is not
  released; the owner is holding the 0.4.5 tag for more work.
- Things already built on main but not released: "Coming in 0.4.5" (built, ships with 0.4.5).
- The owner's 0.4.5 decisions below have NOT started engineering: label them "Planned for 0.4.5",
  not "in progress", until work begins. The roadmap is data (one JSON file) so statuses can flip.
- Credits / showcase / cosmetics / styles / mixes are the owner's plan: label "Planned" (idea stage,
  details open). Credits are earned only, never bought, and never tied to inviting people or to
  Discord activity (Discord's Platform Manipulation policy bans invite rewards; the owner already
  declined them). Invite rewards must never appear.
- Discord is the easiest way in, never a requirement. The owner wants no single required service.
- Rooms need the owner-run hub online (the owner chose to run it on their own PC, portable), so
  rooms availability depends on that; LAN connections work without it.
- Shared rooms / Listen together are "Rolling out" until the hub and the Discord link app id are live.
- Keep invite counts honest: GitHub counts 2 zip downloads across 7 releases; don't invent numbers.

## Roadmap in plain words (from the "Build 4.5 roadmap" session, owner-approved decisions)
Planned for 0.4.5 (the owner holds the tag until these land):
- Faster agent send/receive: agents get what's new, not whole packages; a work journal keeps every
  task's older history, run transcripts and relevant git commits; agents see recent actions first
  and can ask for older ones (default scope the whole project, narrowed in Settings); live progress
  for Claude/Codex runs; smaller updates pushed to the page; retries continue where the agent left off.
- Logging rework: structured logs, a full transcript per run, old logs archived and all kept
  (monthly archives outside OneDrive).
- Faster launch: a shorter launch gate, no blank fade, fewer startup calls, a code cache.
- Friends 2.0: a lobby with 3 default rooms (chat plus a shared video player); who's online; friends'
  cursors on a shared tree in project rooms; friends and invites without copy-paste codes (one-click
  invite links); Studios on the same Wi-Fi find each other automatically (one-time matching-code
  confirm); project rooms; chat with the Discord bot and see its cards in Studio; a fair shared-video
  queue (longest-present member controls the player; a newcomer gets one free "play next" then waits
  24h; each person's videos play in boxes of 3 taking turns; new members get 8 minutes per video,
  server roles unlock longer videos and no cut-ins; no playlists in the lobby, in private rooms a
  playlist expands into the queue; every queued item shows the requester, length and media type).
  Discord is the fastest way in but not required.
- Menus: Friends gets its own place in the menu; nothing gets lost.
Planned after 0.4.5:
- The Fleet view (every agent as a seat in pods, lanes and missions).
- The menu overhaul: separate Live and Friends sections, one Settings page.
- Linux support.
- Studio as a bridge to creative tools: Blender, Godot and Unity through MCP; setups that need no AI
  (e.g. a player plus project file watching); coding agents that build the support for a new tool.
- The community economy (owner's plan): share ideas and projects; credits for playing or looking at
  others' projects; spend credits to advertise yours; cosmetics and creator-offered styles for
  credits; shared mixes with most-played lists for people who turn on "share music taste".
Ideas, no dates: "Hey Studio" voice, code signing, a Mentor role, a "Made with Studio" wall.
Also open: the menu polish "one page frame" for tab pages waits for a design decision.

## Website ideas from the "Build 4.5 roadmap" session (use what fits)
- One tab bar on every page with one gliding highlight (today Home's tabs are in-page anchors and
  "Community" jumps to #friends); the Download pill on every page. On Home, section links become a
  slim "on this page" strip that follows the scroll.
- Cross-document view transitions (`@view-transition { navigation: auto; }`): nav and brand stay
  still, the active pill slides; falls back to a normal load. The wiki is a hash router (wiki.js
  show() ~350): wrap it in document.startViewTransition so the sidebar holds still.
- community.html has 10 stacked sections: group them (Hang out, Show your work, Contribute, Report a
  problem).
- Phones: home.css:209 (<=960px) hides every nav link but Community and Download; the wiki is only
  reachable from the footer. Needs a compact menu.
- Motion (owner's rules: smooth continuous morphs, the app's own motifs, no flashes): the hero tilt
  should follow scroll instead of flipping at 40px (home.js:83); reveals use smooth easing; optional
  live hero from tools/promo/showreel-stage.js on main (heavy: needs node-styles.js ~300 KB).
- Dead weight: media/mefi-work-in-motion.mp4 (3.7 MB), assets/shots/friends-panel.webp and
  assets/launch.css are unused.
- Community: live pulse from https://discord.com/api/v10/invites/xgfKc5pVxG?with_counts=true
  (approximate_member_count, approximate_presence_count; cross-origin OK; hide on failure). The guild
  widget is OFF and must stay counts-only. "Made with Studio" wall (showcase.json, by PR or picked
  from Discord with consent). Idea votes from GitHub issue 👍 counts. An all-releases timeline.
- Install gap: a 3-step install strip including the SmartScreen "More info > Run anyway" step (the
  build is unsigned); a clickable browser demo of the real UI with the Notes-app sample data (idea).

## Links
- Discord invite: https://discord.gg/xgfKc5pVxG
- GitHub repo: https://github.com/nateecho32-stack/mefi-studio
- Feature request (template): https://github.com/nateecho32-stack/mefi-studio/issues/new?template=feature_request.md
- Bug report (template): https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md
- Releases: https://github.com/nateecho32-stack/mefi-studio/releases
- Enhancement issues (for votes): https://github.com/nateecho32-stack/mefi-studio/issues?q=is%3Aissue+label%3Aenhancement

## Verified facts added during the build (2026-09-28, by the coordinating session)
- In-app updates in 0.4.4 and earlier: Studio can check GitHub, download and verify a new release,
  but the install helper that should replace the files after Studio exits never ran (a detached
  PowerShell exits without running its script). Fixed on main (CHANGELOG [Unreleased] "the release
  updater's install helper now actually runs after Studio exits"), so it works from 0.4.5 on.
  Therefore the download page must tell 0.4.4 users how to update by hand: extract the new zip to a
  new folder, and to keep tasks, ideas, plans and conversations copy the old folder's
  resources\app\data into the new one. Settings, saved keys, the project list and the Discord link
  live in %APPDATA%\Mefi's Studio AI+ and carry over by themselves (GETTING_STARTED.md "What not to
  copy between machines" and "Download and data notes"). Don't claim updates "just work" for 0.4.4.
- Guided CLI install/sign-in windows in 0.4.4 may close before their script runs (same detached
  PowerShell problem); fixed on main (Coming in 0.4.5). In 0.4.4, sign in from a terminal, then use
  Check connection and Use for the whole studio.
- main moved during the build: "Typing goes to the open menu's box" (704ef0d) and "Start with
  Windows; Your PCs shows what each PC's agents are doing" (39a153d) are now BUILT on main: Coming in
  0.4.5, not in progress.
- Credits rules and statuses from features_completeness.json statusFixes apply (e.g. playdates with
  friends and "Share back?" are Rolling out; the two-step confirm is new in 0.4.5 but some confirms
  existed since 0.2.0; Learns which model wins applies only on the z.ai route and OpenCode Go).
