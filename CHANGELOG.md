# Changelog

All notable changes to Mefi's Studio AI+ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
`package.json`. History before the extraction into this repository on
2026-09-19 is not recorded.

## [Unreleased]

- **A wave of new accounts can't farm credits for someone.** When more than
  three members in their first 30 days in the server pay the same member in a
  week (by playing their project, starring it or buying their pack), the
  first three are paid as usual and what the rest would pay waits for a
  moderator: the member sees "N credits waiting for a quick check" in the
  Project hub, and **Friends › Moderation › Credits on hold** shows who it
  came from, with each account's age and join date, and **Pay** or **Drop**
  it (all of it, or one newcomer's). Held credits drop by themselves after 30
  days. Members who have been around longer, and newcomers' own credits, work
  as before. The room service can also tell you in Discord: in a private
  channel through a webhook, and now as a direct message from the Studio bot.

- **The Shop is a page of its own, with a new drop every month.** Friends ›
  Shop (and Settings › Appearance's **Open the Shop**) now open a roomy,
  storefront-like page: the month's drop as a banner with its pieces moving
  inside it and how long it has left ("Leaves in 24 days"), **Featured this
  week**, and **Pets**, **Menu effects**, **Node styles**, **Themes**,
  **Community** and **Owned** along the top. Cards show each item large and
  live, with its price and a **New**, **Leaving soon** or **In use** badge;
  click one for its details, **Try for 2 minutes**, and **Buy** or **Use**.
  A drop's pieces are on sale for their month and then rotate out; everyone
  who got one keeps it, and a later drop may bring one back. Signed out, the
  same page lets you look around and try anything, with **Sign in to get
  it** in place of Buy. When a member gets one of your style packs, a pop-up
  says what it brought you ("+12 credits"), and **Your packs** says how many
  times each was got. In Social, the Shop stays in Social.
- **Pet your dragon, and more pets.** Rest the pointer on Ember for half a
  second and it stops, turns to look at the pointer and purrs, with a few
  small hearts and its name above it; circle the pointer quickly near it and
  it gives chase for a moment. Clicks still go through to whatever is under
  it. Now and then it does a little thing of its own: a stretch and a yawn
  as it wakes, a flick of the tail while it rests, a tiny sneeze of sparks,
  a firefly to chase. None of it happens with motion Off, and Calm keeps it
  small. Settings › Appearance › Interface's pet card now shows your pet
  moving, has **Pet**, **Name** and **Colours** picks (each pet keeps its own
  name) and a **Plays with your pointer** switch. Three more pets are in the
  Shop: a **Cloud dragon** that swims through the air with a flowing mane, a
  **Phoenix** with a long tail of flame feathers and, for October, a
  **Will-o'-wisp**, a little ghostly flame that trails sparks. Every skin
  fits every pet, any of them can be tried for two minutes first, and
  friends' pets visit as themselves. Ember stays free, and a pet a friend's
  older Studio does not know yet shows there as Ember. The first run's
  **Your dragon** row has a tiny Ember beside it, a pet's name sits on a
  small nameplate that reads on light and dark pages, and the Shop's pet
  cards fly at their proper calm pace again (they were spinning far too fast).
- **Four more menu effects, and they play in more places.** The Shop gets
  **Blown away** (the menu drifts aside like sand in the wind, its grains
  streaming off), **Shatter** (it cracks like glass and falls away in
  pieces), **Glitch** (it tears into slices that jump with a colour split and
  blink out) and, for October, **Spirits** (it fades into ghostly wisps of
  smoke that rise and curl away). Whichever effect you use now also plays
  when a right-click or tab menu, Search or a popover closes (permissions,
  the chat's tools, the Inbox, Build's More, the session panel's menus, the
  Layout card). A closing menu is out of the keyboard's and screen readers'
  way at once, a menu you open again mid-effect is back at once, and motion
  Off or **It fades out** still close every menu at once.
- **The Map reads at a glance.** When a job changes state (it starts
  running, needs you, goes to review or finishes), its ring sends out one
  soft ripple in the new state's colour; with motion Off there is none. The
  legend's four states are now buttons that count their jobs on the Map:
  point at one and its jobs light up while everything else dims, click it
  to keep them lit, and click it again or press Esc to show everything
  (screen readers hear both). Hovering a job shows a small card with its
  name, its state and how long it has been in it ("Running · for 12 min").
  The four states keep clearly different colours in every theme: when a
  theme's own colour comes close to one, that state turns within its family
  (Review toward violet on Daylight and Midnight, Done toward lime on Forest
  and Aurora, Needs you toward rose on Studio gold and Eclipse and toward
  yellow on Ember and Paper), and on Daylight and Paper the rings, legend
  dots and coloured card text hold 4.5:1.
- **Two new node styles and eight new themes in the Shop.** **Lanterns** (part
  of October's drop) turns every node on the Map into a glowing paper lantern
  that sways on its cord; its candle flickers while a job runs, its lines are
  strings of festival lights, a small lantern floats along them to bring
  news, and fireflies circle the one you chose. **Neon** draws each node as a
  bright neon tube with a soft glow that buzzes on when a job starts; its
  lines are lit tubes with current running along them. Both are in Settings ›
  Appearance under **From the Shop** and can be tried for two minutes first.
  New themes: **Pumpkin Spice**, **Haunted** and **Candlelight** (light) for
  October, and **Midnight Neon**, **Forest Glade**, **Ocean Breeze** (light),
  **Rose Gold** (light) and **Frost**. Every theme and node style Studio
  already had stays free.

- **Credits are harder to farm, and moderators can act on it.** Nobody could
  change a balance before either; what changed is how far extra Discord
  accounts get. The Top list and the Lobby's project of the week count each
  player once a week per project. The Shop's Top list counts sales only from
  members who may earn credits, and publishing a style pack (a free one too)
  or entering the Build Jam needs a member in good standing. What someone who
  used **Forget me** had given others stays, under an id that names nobody,
  so a moderator can still see it and take it back. The **Build Jam**'s
  results now come a day after voting closes (Tuesday): votes from accounts
  made and brought into the server together count once, and a moderator
  first sees every vote, whether it counts and why, and each voter's account
  age. **Friends › Moderation** gains that **Build Jam** review (Don't count a
  voter, Remove an entry, Pay the prizes now, Hold the prizes) and
  **Rewards** switches that turn plays, stars, co-work rewards, Shop sales,
  featuring or the jam's prizes off for a while without pausing anything
  else (the jam's review day and its one-vote-per-batch rule have switches
  too). With an optional webhook, the room service also posts a one-line
  heads-up, naming nobody, to a private moderators' Discord channel.

- **Social uses a wide window.** Home no longer sits in a narrow column with
  empty sides. On a wide window it has a column at the right: **Friends** at
  the top, now compact (one line a row, smaller faces), and the conversation
  with Mefi under it with the box at its foot, like a chat; your work takes
  the rest of the page, its cards side by side. The conversation's close
  button hands the box back to the page, and that is remembered until you
  open it again; Friends keeps the column. A narrower window keeps the box on
  the page, Friends beside your work and the conversation as a drawer.
  **Activity**, **Projects** and every **Friends** place use the width too
  (The Lobby sets its top story beside what friends are building).
- **Menus without odd gaps.** Card titles, both What's new cards, the tab
  settings, the walkthrough's coach, the Model Lab's cards and the Decided
  for you panel lost the extra space above and between their parts;
  the Layout menu's switches are switches again, not squares; the
  permission choices in Social's Settings panel wrap instead of running off
  its edge; the project button opens a short menu under it instead of a
  tall drawer over the tabs; cards side by side keep their lines together;
  and Friends no longer shows its places twice, as chips and as a picker.
  What's new and the shortcut list say what Social's box does now (Send,
  and Ctrl Enter to build right away).

- **Sign in to GitHub can finish.** Its setup window opened blank: the
  GitHub CLI never showed its one-time code or opened the browser, so the
  sign-in behind the Git chip, Publish to GitHub, Link to a repository, the
  launch screen and Your PCs could not complete. The window is now a real
  console, titled *Mefi Studio: Sign in to GitHub*, where the code shows and
  Enter opens GitHub. A coding CLI's **Install and sign in** window had the
  same fault and is fixed too.

- **Make it yours, Ember the dragon, menu effects and the Shop.** The first
  run now starts with **Make it yours**: pick **Light**, **Dark** or
  **Stylized** (glowing colour and bold headings), a colour within it, the
  text size and how much things move, and see Studio change behind the card
  as you pick. When the welcome closes, a small note by the Settings button
  says all of it lives in **Settings › Appearance**. New light themes,
  **Daylight** and **Paper**, hold 4.5:1 contrast on every page, and the
  two-tone Void themes paint their second colour again. Every Studio comes
  with **Ember**, a little dragon that flies around the window, naps on the
  top and status bars, comes to look at your pointer, loops with a puff of
  fire when a job finishes and flies to the Inbox when something needs you.
  It stays on its perch while you type, sleeps when you step away and sits
  still with motion Off. A new install starts with Ember on (the first run
  has the switch); on an existing install, turn it on in Settings ›
  Appearance › Interface. In a room, friends' dragons fly in and play with
  yours. The new **Shop** (Friends › Shop, also from Settings › Appearance)
  has skins for Ember, menu effects that make menus **Dissolve**, **Burn
  away** or turn to **Stardust** when they close, two node styles for the
  Map (**Dragon scales**, whose seams glow like fire while a job runs, and
  **Star chart**, stars on dotted chart lines with shooting-star pulses) and
  style packs, all for credits you earn on the social side; credits can't be
  bought or cashed out. Every theme and node style Studio already had stays
  free. Try anything free for two minutes first. Anyone can
  make a style pack (colours, node style, font) and list it free or for
  credits; buyers can add a tip, the maker gets three quarters, and the rest
  is taken out of circulation.
- **The Map shows each job's state at a glance.** Every task orb wears a
  ring in the legend's colours: it breathes while the job runs, pulses when
  it needs you, and holds still for Review and Done (on a light theme the
  rings and the legend take deeper inks). Task orbs are a size bigger, and a
  small tree spreads out to fill the 3D view instead of sitting in the
  middle.

- **Social is about people, rooms and a simple talk with Mefi.** Social's
  rail (Home, Friends, Projects, Activity) is on its Home too. Home has one
  box with one action, Send: Mefi offers to build what you describe, and
  Ctrl Enter still builds right away. Under it, your work is a short list
  beside who is online, the rooms open now and what friends shared this
  week. Studio's pages (the Map, the boards, Team, Fleet, Trace, Worktrees)
  and sessions open in Studio from Social, keeping where you were going, and
  Social's status bar leaves usage, cost, the machine's load and the
  permission mode to Studio. A task's state reads the same everywhere (needs
  you, running, up next or paused, in review, done), so a column never says
  Running 0 over queued work, and the line under the box clears once its
  news is old. Fixed: the tab picker finds Friends' places (Friends, Lobby,
  a laptop), a key tip no longer covers a control (one covered Resume), a
  briefing about high CPU no longer files a "Fix:" task, a GitHub CLI
  sign-in made while Studio is open counts for the updater within a minute,
  the in-memory relay tests wait up to ten seconds on a slow PC, and a card
  on Today that is redrawn while you tab through it (its "4 min" turning "5
  min") keeps the keyboard on the same button.

- **Friends › Your PCs starts with Connect another PC.** Three plain
  steps (open Studio on the other PC, sign in to Friends with the same
  Discord account on both, press Pair and check that both show the same six
  numbers) follow what Studio sees as you go, and fold to one button once a
  PC of yours is paired. Your PCs come next. Keeping this PC in step with
  GitHub, power and battery, lending this PC, setting it up, paired workers
  and reaching it from Discord are folded groups below, the GitHub line
  still showing when this PC is behind, and sharing has its own heading,
  Share projects.

- **A more compact Studio: less empty space, more of your work on screen.**
  Today puts its board about 130 px higher. The line of keys under the box
  is gone (Talk it over shows Enter, Build it shows Ctrl Enter), the scope
  line shows only once you narrow it to an area, "Decided for you" is a
  count beside the others, the drop-files hint waits until it has news, and
  the project picker is one line, in line with the page. Every page's header
  is 48 px with an 18 px title (it was 64 px and 22 px), Team's header lost
  its extra band, a board card no longer keeps an empty row under a one-line
  title, Studio's Today sets its greeting beside a smaller orb, and the
  session list puts the Git chip and the worktree count on one row. The
  launch switch reads *Open Today on launch* in both modes. Fixed: the
  project's cards in Studio's inspector ran past the window's right edge at
  1920 px (a long team member's name now ends in "…").
- **0.5 polish: an easier first run, and menus that behave.** A new
  install now starts with **Start a new app** (Studio makes the folder) beside
  **Open a folder…**, and the Studio Daily says *Welcome to Studio*. The first
  run asks **Pick the AI that builds for you** in plain words (which account
  each tool uses), offers OpenCode's free models when you have no
  subscription, and now really switches Studio to the tool you signed in to
  when you press Continue (before, it kept the default), including one you
  signed in to in its own window a moment ago. Its last step, **What
  should Studio make first?**, has examples to tap, already holds what you
  said a new app should be, and never adds a task with no project open.
  Social's rail uses Studio's names (Friends, Map, Team) and
  gains Help; Friends and Team show their places as a row of chips when the
  side list is closed, so Rooms, Events, Your PCs and every Team page are
  reachable from Social; Events is in Studio's menu and in Search. Fixed:
  switching Social to Studio while a page was open left the menu blank;
  Configuration and Friends could stay open or leave their name in the
  breadcrumb and tab after you left them; Search listed "Switch to Studio"
  twice and the + menu listed Today twice; a key tip covered Build it and the
  first-run dialog; the old node-tree strip covered the right edge of
  Settings; the Ruins Runner launcher showed without the game; the status
  bar's player opened the media menu in the wrong place; Plans squeezed its
  editor in a smaller window; the breadcrumb cut every crumb to a few letters;
  Size and density's picture could take most of the page beside its controls;
  N on Social's Today opened the old decision drawer instead of the Inbox; and
  on the Map, [ hid the inspector instead of stepping back through the tasks.
  Team lists Resources, the place row turns into one picker in a narrow page
  and steps aside in a very short window, and the startup settings read
  *Open Today on launch*, *Always start in Social mode* and *Agents when
  Studio opens*.
- **My PCs: your PCs work as one.** Friends › Your PCs now lists every PC
  you sign in to Friends on, live: its CPU, free memory, battery and how
  many tasks it runs, and why it is not taking work. Pair each PC once by
  checking the same six numbers on both screens; only paired PCs can send
  each other work, so a Discord login alone never can. From any PC, **Send
  work here** starts a task on another or moves a ready card to it. When
  every slot on a PC has been busy for two minutes, it is short of memory
  that long, or a laptop's battery is at 20%, its ready cards move to a
  paired PC with a free slot and the same project open; a card is moved,
  never copied, at most two per project are out at
  once, and it is marked done here when the other PC finishes it. At 20% a
  laptop also starts nothing new; at 10% it stops its work with the
  progress saved, parks the changes as a `mefi/handoff/*` branch another PC
  can pick up, lets itself sleep, and waits for **Continue** (plugging in is
  not enough). **Keep this PC on** can now keep a plugged-in PC awake with
  nothing running, so the others can send it work. Each project has its own
  switch, and a friend can lend you their PC: your tasks there wait for
  their OK unless they choose otherwise. See docs/my-pcs.md.
- **Other apps: Claude Code, Codex and your scripts can talk to Studio.**
  Settings › Other apps has a switch, off until you turn it on, that lets
  apps on this PC reach Studio. They can see what the agents are doing and
  what waits on you, message Mefi, hand Studio a task and leave you a note.
  Claude Code and Codex connect with one command the card shows (an MCP server
  with eight tools), Cursor, Claude Desktop and VS Code with a JSON block, and
  **Save to Claude Code** adds a skill that tells Claude Code when to use
  Studio. Scripts and Claude Code hooks use the same file as a command line
  (`studio-link.mjs status`, `say`, `task`, `notify`). Only this PC can
  connect, with a key kept in your user folder, and no web page can call it.
  An app has the same narrower powers as a message from Discord: **every task
  it files waits for your OK in every permission mode**, and approving,
  answering and settings stay in Studio. Its messages show in Mefi's thread
  under the app's name. **Copy setup prompt** (on the same card and on the
  setup helper's first page) copies a prompt for Claude Code, Codex or another
  AI helper that says where Studio is on this PC, what to read and what to
  leave alone, so it can walk you through setup. GETTING_STARTED.md has a
  version for before Studio runs. See [docs/studio-api.md](docs/studio-api.md).
- **Lighter background work.** Studio's background git reads (sync, Your
  PCs, the Git chip, worker checkouts, the project inventory) no longer leave
  git's file-system monitor running in every worktree they look at (one daemon
  of about 44 MB each, which never exited). Claude Code workers start only the
  MCP servers Studio gives them, as OpenCode runs already did, instead of
  also starting your own Claude Code servers (about 380 MB together). Set
  `MEFI_STUDIO_WORKER_OWN_MCP=1` to give workers your own servers back.
- **A test that hangs no longer holds the PC.** A stage of `npm test` that runs
  far past its time (two hours for the quick suites, 90 minutes for the live
  test windows) is stopped together with everything it started, and the run
  says which suites were still going. One stuck test window had held every
  session's window tests for nine hours.
- **Share a playlist with friends inside Studio.** A playlist's **Share**
  now has **Send it to friends**: **Post** puts it in any room you're in (the
  Lobby too), where it shows as a playlist card friends can play or save, and
  **Add to the Project hub** lists a playlist of YouTube videos there. On the
  hub (and as the Lobby's top project) a playlist's **Play** plays it in
  Studio's own player instead of opening the browser, and the play still
  earns you both credits. Long lists fit one message; the YouTube link
  carries every video.
- **A way to Routing lands on Routing again.** Routing moved into **More
  settings** on Team's Seats and models page, so Search's Routing (and
  Team's own links to it) opened the page with Routing folded away. It now
  opens More settings at Routing.
- **The rail's words are whole.** At rest, Settings, Friends and Search
  no longer end in "…": a tile's word now gets the rail's whole width
  (Settings needed 43 px and had 39). Studio's rail is checked at every
  window size, the smallest at 150% included, for places that can't be
  reached and words that are cut.
- **Resources: make room for your agents.** Team › Resources lists the other
  apps on this PC with their CPU and memory, and lets Studio hold them back
  while agents build: **Slow down** (lowest priority and efficiency mode),
  **Pause** (frozen, its memory handed back to Windows), **Free memory**,
  **Close** and **End**, each undone by **Put back** or **Restore all**. In
  **Manual** mode Studio only does what you press (or one round with **Make
  room now**); in **Auto** mode it slows heavy apps you are not using while
  agents build, gives memory back when building runs short, pauses or closes
  only the apps you allow, and puts everything back when the agents finish.
  Calls, music, recording, remote access and terminals are left alone unless
  you say otherwise; Studio, its agents and Windows are never touched; a paused
  app runs again the moment you switch to it; and nothing stays paused after
  Studio closes, even if it crashes. Windows only for now. The status bar's
  CPU · Mem reading now opens this page; the test-run Machine status it used
  to open is still in Settings › Diagnostics and in Search.
- **Friends › Events: the community runs its own events.** Every week a
  **Build Jam** opens on Monday with a theme (and shows next week's): enter
  one of your shared projects until Saturday, play the others and vote for up
  to three until Monday, when the results are paid (Studio shows these times
  in your own time zone). A vote counts only for an entry you played for two
  minutes, and votes stay hidden until the results; a place needs three votes,
  and whoever wins one sits out the next two jams' places.
  Three times a day (02:00, 10:00 and 18:00 UTC) a **co-work hour** opens a
  room: join it, keep Studio open and work on anything, and everyone who
  stays with others earns 4 credits. **Building together** in your own
  co-work room with a friend earns you both 4 credits a day. Credits still come
  from making and playing things together, never from inviting people
  (Discord's rules forbid invite rewards): to bring a friend, send them your
  room's join code. The prizes and co-work rewards share a daily community
  pot that grows with the number of people active that week, so the credits
  keep their worth as the community grows; plays and stars pay as before.

- **Your PCs and Friends reconnect by themselves.** A paired coordinator or
  worker you started now comes back by itself after Studio restarts, updates,
  rolls back or crashes, and a worker that loses its coordinator keeps trying
  (5 s, then longer, up to a minute) and tries at once when the PC wakes. A
  running check rides out a short drop instead of stopping. Updates no longer
  wait for you to stop idle paired services: they wait only for a check that
  is running, close the services cleanly and start them again after the
  relaunch. Each role has a "Start by itself when Studio starts" switch, and
  Stop turns it off. Friends has a **Reconnect by itself** switch at the foot
  of The Lobby (on unless you turn it off) and reconnects at once after
  sleep. PCs and friends on different Studio versions keep connecting: each
  side accepts a window of protocol versions (`scripts/link-compat.cjs`), and
  only a Studio that is really behind is asked to update, after which it
  looks for the update and reconnects by itself. Your PCs shows each paired
  PC's Studio version and notes "older, still connects".

- **Friends says what helps.** When the connection to the room service can't
  be made, Friends now says why in one sentence and offers only what helps:
  Sign in with Discord again when the sign-in ran out, Update Studio when it
  is too old, Join the Discord when your account isn't in the server, and
  Connect only when connecting can work. A play that earns nothing says why
  (your own project, a new account, a limit reached). New rooms start
  private, so a first room never fails on the Flame rank. The Lobby nudges
  you to share only if you haven't, says when your credits start if they
  haven't yet, stops redrawing under your hands, and shows this week's Build
  Jam and cowork hour when the room service runs them. The same words are
  used everywhere (room service, invite code, Sign in with Discord, Join),
  the companion's bubble labels are 12 px, Play and Star buttons name their
  project for screen readers, the tab switches move with the arrow keys, and
  Search finds The Lobby, the Project hub and moderation.
- **Ready-to-run beta builds of main.** Every green push to `main` now also
  packages the portable build and keeps it on GitHub for 14 days, so a new PC
  can download Studio and run it without Node, Git or any commands, and
  Settings › System › Updates › Development / beta keeps that copy on the
  newest build. Every check run also packages the build, so a change that
  breaks packaging fails before it reaches `main`. No release or tag is made.
- **Vibe is now Social, Build is now Studio.** The two modes have new names
  for what they are for: **Social** is vibing with friends and keeping a
  light eye on your agents, **Studio** is in-depth building, with the social
  features still there. The switch at the top, Search ("Switch to Studio"),
  the keys sheet, Settings ("Always start in Social") and the Size page say
  the new names. Nothing else changes: your saved mode, settings and links
  carry over as they are.
- **The window no longer scrolls under a page.** The Model catalog and
  Settings pages sat, invisible, under Home, the Map, Work's pages and
  Friends and kept the window three screens tall, so a scroll arrow sat
  over the status bar and the mouse wheel could scroll the window. They
  are now left out while another page is on show.
- **Activity, the permissions menu and the Team card no longer cover or
  cut their own words.** On Home's chat view, Activity used to lie over the
  conversation, message box and Send included, at every window width in the
  0.5 layout; in a window 700 px tall or more it now takes the
  conversation's place above the box, which stays where it was (a shorter
  window keeps the drawer). The permissions menu on Today opens below its
  button over the board instead of up under the bars, with its choices
  wrapped inside it. The inspector's Team card shows a worker's name with
  an ellipsis and its state whole (it read "ixture builder … workin g").
- **Team, Fleet and the Project map fit narrow windows in the 0.5 layout.**
  With the session list beside them they have less room than the window:
  Team's seat rows now fold by the page's own width (at 1100 px Effort and
  Fast mode no longer sit on the provider button), Fleet folds its columns
  by its own width (so Fit shows the whole team at 1100 px), and in the
  smallest window at 150% the Project map keeps a map with its zoom
  controls (it had no room left at all).
- **Studio is lighter: the classic layout's code is gone.** The classic tab
  row, sidebar menus, Search rows, Agents navigation, Command toolbar and
  its Ambience, View and Agent settings pop-overs, and the companion's own
  Friends section are removed, about 2,600 lines of Studio's own code. Every control
  they held already has its place in the 0.5 layout (Settings › Map look
  and Sound and music, Team › Overview, the Map's View menu, the Friends
  page). The short "About these controls" note that sat under the old
  Agent settings is gone with them.
- **"Start the first task" on an empty Map works again in Build.** It
  pointed at the classic task box, which the 0.5 layout hides, so it did
  nothing; it now opens a new task, as N does. The first-run key tips for
  the Map sit on its bar and its zoom, and Build's on the rail, instead of
  on hidden controls where they never showed.
- **Studio's log is kept, and Trace can read back through it.** The studio
  log, the assistant's log and the window's warnings are now saved on this PC
  (in its local app-data folder, never in OneDrive), packed into monthly
  archives that are never deleted. Trace's new **Load older** button pages
  back past the last few thousand lines, and **Open file** shows the folder.
  `MEFI_STUDIO_LOG_CORE=0` (or `logs.keep: false` in settings) keeps the log in
  memory only, as before.
- **Claude Code and Codex builders show their steps while they work.** A
  task run on Claude Code or Codex now shows its todo list, the tool it is
  running and its token use as it goes, as OpenCode runs already did, instead
  of nothing until it finishes. `MEFI_STUDIO_LIVE_PROGRESS=0` (or
  `executor.liveProgress: false` in settings) turns it off.
- **Repeated prompts cost less where the provider caches them.** Builders'
  prompts, the chat's context and research rounds now put the parts that stay
  the same first, so Zen's GPT models and OpenRouter's Claude and Gemini
  models can bill them as cache reads, and the usage page counts cached input
  from every provider. `MEFI_STUDIO_PROMPT_CACHE=0` (or `ai.promptCache: false`)
  turns it off.
- **Friends looks and feels like a chat app.** An open room now fills the
  page: one header with the room's name, faces of who is here, Listen
  together and a ⋯ menu (invite code, invite by name, lock, close or leave),
  the conversation growing above one message box that stays at the bottom.
  Enter sends and Shift+Enter starts a new line; Report and Delete wait in a
  small ⋯ on each message; a mention of someone Studio can't name reads
  "@someone". Rooms are cards with a New room button, the Rooms and Project
  hub switches show which view is chosen, Rooms and the Project hub have
  their own icons (and so does every Friends tab), and The Lobby updates
  within seconds when a friend arrives or leaves. The Playground says what
  friends see in one plain sentence. It all fits from a small window at 150%
  to 1920x1080, in dark and light colours.
- **Test runs on one PC take turns.** When several sessions test Studio from
  their own folders at once, `npm test` and the new `npm run test:one --
  tests/x.test.mjs` now wait for their turn instead of starving each other:
  one set of live test windows on the PC at a time, two batches of the quick
  suites at a time, first come first served, with a line every 30 seconds
  saying who is running. `npm run test:lease` shows the line-up. The quick
  suites run as many at once as free memory allows, and every run starts its
  slowest suites first, from timings each run records. `MEFI_TEST_LEASE=off`
  turns the turns off.
- **Playlists in the media menu.** A new Playlists section (under every
  source) starts you off with five lists of real videos: Code & math
  explorers (Sebastian Lague, 2swap, 3Blue1Brown, Emergent Garden),
  Visualizers, Focus streams, Shaders & graphics and Simulated worlds. Make
  your own from scratch or from Up next, save any video with the new **+** on
  Browse cards and the playing video, and drag rows to reorder. **Share**
  copies a list as text that reads well in Discord, with a link that plays it
  on YouTube; paste that text into **Add a shared playlist** or the Browse box
  and Studio turns it back into a playlist.
- **Moderation in Studio, and Report on projects.** Moderators get a
  Friends › Moderation place (nobody else sees it): who looks like they are
  farming credits (most of their credits from one person, or two people
  trading), the open reports for messages and projects, and a lookup by name.
  A member's review shows where their credits came from and how old each
  account is, with Take back (from one person or everything in 30 days) and
  Suspend for a day or a week. Anyone can now Report someone else's project
  in the Project hub (spam or a broken link, not safe to open, someone
  else's work), and a moderator can take a project off the hub there too.
- **Pop-ups from friends.** Studio now says when someone you share a room
  with opens Studio (several at once are one pop-up), when someone invites
  you to a room or asks to join yours, and when someone plays or stars your
  project, each with a button to the right Friends page. Nobody is announced
  to the whole Lobby or while they hide from Who's online, and the same
  friend at most every 30 minutes. **Pop-ups from friends** at the foot of
  The Lobby turns them off.
- **Building now in The Lobby.** Turn on **Share what I'm building** at the
  foot of The Lobby and friends see your open project's name with a small
  live tree: a lit leaf for each task running and a dim one for each finished
  today. Only the name and the counts are shared, never task titles or files,
  and it is off until you turn it on.
- **Credits cannot be farmed.** Credits and ranks are worked out by the
  relay, never by Studio, and they now hold up against second accounts,
  trading and replays: credits start once a Discord account is 30 days old
  and a week in the Void Engine server; a play pays a maker once a day per
  player whichever project it was, and a star once a week; one person can
  make another earn at most 15 credits a week; a play counts only for the
  day it started; Forget me cannot reset a limit; featuring is once a week;
  and only plays and stars from members in good standing count toward Top.
  The Project hub says when your credits start, and moderators can see
  where someone's credits came from and take farmed ones back.
- **No Discord roles needed.** Ranks are Studio's own, from credits: Flame
  rank (200 credits) now unlocks showing a room in the public list, which
  used to need a Room Host role in the Discord server. Anyone a week in the
  server can still make an unlisted room and invite people with its code.
  Moderators are named accounts.
- **Friends has a front page, a sign-in and shows you online.** Friends now
  opens on **The Lobby**, a front page in the style of The Studio Daily: who
  is online right now and which room they are in, the week's top project
  with a Play button, the rooms open now, what was shared this week, who
  moved up a rank, and your own credits and week. At its foot are **Show me
  as online** and your room's invite code with **Copy invite**. Until you
  sign in, The Lobby, Rooms and the Project hub show one **Sign in with
  Discord** card; Your PCs and the Playground work without it. Once signed
  in, Studio connects by itself a few seconds after it opens, so friends see
  you online without you opening Friends (untick Show me as online to hide).
  The Lobby is also in the rail's Friends menu and in Search.
- **Claude Code, Codex and OpenCode now think lightly first and harder when
  stuck.** Studio never told the coding CLIs how hard to think, so every run
  used the CLI's default. Every job now starts with light thinking
  (`--effort` for Claude Code, `model_reasoning_effort` for Codex, `--variant`
  for OpenCode models that list one). A coding job that fails its check
  retries one step harder; after two misses a stronger model takes it (the
  Heavy tier, else Flash to Pro on OpenCode Go and Sonnet to Opus on Claude
  Code); Max thinking waits for you. Seats and the chat on Claude Code or
  Codex take a thinking level too. Each attempt's level is written to the
  model record and the attempt list, and when a harder level keeps working
  for one kind of job, that kind of job starts there. Team settings:
  `agentThinking` (mode, step up, ask before Max, try other models). A CLI
  whose own help does not list the flag gets none, and
  `MEFI_STUDIO_THINKING_OFF=1` turns the flags off.
- **A report card, and each kind of coding job on the model that does it
  best.** Team › Seats and models reads every checked coding task on this PC
  and says what each model is good and bad at (building features, exploring a
  codebase, analysing code...). A kind of job the usual model keeps failing
  gets a suggestion; "Try it" sends the next 5 jobs of that kind to that model,
  and Studio keeps it for that kind only if it did clearly better. With "Try
  other models now and then" on and models picked automatically, Studio starts
  such a trial itself (one at a time, Sonnet on your Claude login first) and
  says so in the feed. Team setting: `agentKinds`.
- **Use for the whole studio now covers every project.** A project that had
  saved its own team kept its old providers; now each one moves to the chosen
  subscription too (its rules stay), and the message says how many project
  teams were switched.
- **A coding CLI is stopped when Studio stops waiting for it.** The Jev
  stand-in (15 s), the Daily editor (60 s), the chat and the outside-work
  check gave up on a slow Claude Code or Codex answer while the CLI ran on for
  up to three minutes on your subscription; now it is stopped then, and that
  does not count as the tool failing.
- **The first project map moves to your next login too.** On Claude Code or
  Codex it ran on the main login only; now a login at its usage limit hands
  the map to the next one, like every other call, a paused tool is not
  started for it, and the map's call is counted in Usage.
- **The scout no longer spends a CLI login on every new task.** A scout on
  Claude Code, Codex, Grok or Antigravity (as after "Use for the whole
  studio") started the CLI for each task made from chat and dropped the
  answer after 8 s; now it makes no call, the task keeps its local code
  matches, and the log says so once. Scouts on Zen and other keyed routes
  are unchanged.
- **Jev stays on your subscription after "Use for the whole studio".** Sorting
  new work against the board and sizing cards could still go to the Vercel AI
  Gateway, TypeSafe, Zen or OpenRouter when a Jev key sat in Settings or in
  your environment; while the team is held to one subscription, the assistant
  on that subscription answers those questions instead.
- **Team › Seats and models is simpler.** It opens on who does what in plain
  words, six choices for how Studio decides (pick models, how hard to think,
  what a stuck job does, asking before Max, trying other models, subscriptions
  first), one line per job with its model, what it is good for, its thinking
  and its results on this PC, the report card, and the steps a stuck job
  climbs. The how-to sits in small "i" circles, and the detailed cards wait
  under More settings. Team › Providers starts with "Use one provider for
  everything" and your subscription logins.
- **How-to text waits behind a small "i".** In Settings, Size and density,
  the setup helper and Start here's account step, the longer explanations
  under a title now sit behind a round "i" beside it: click it (or press
  Enter or Space), or rest the pointer on it, to read them; Esc or a click
  elsewhere closes it. Short hints, warnings and status lines stay in view.
- **Studio times its own launch.** Trace shows one `[startup]` line per
  launch (app ready, first paint, each loading step and when the window was
  ready), and `--startup-report <file>` writes the same as JSON.
  `MEFI_STUDIO_STARTUP_MARKS=0` turns it off.
- **Settings are read from memory while the files are unchanged.** Studio no
  longer re-reads `settings.json` and `auth.json` on every model call; an edit
  from outside Studio is still picked up at once. `MEFI_STUDIO_SETTINGS_CACHE=0`
  turns it off.
- **The board reaches the window as changes, not as a copy of every card.**
  When a task changes, Studio now sends only that card (about 5 KB instead of
  about 690 KB on a 134-card board), and a running task's progress travels as
  a few hundred bytes. Nothing on screen changes. `MEFI_STUDIO_FULL_PUSHES=1`
  brings back whole-board pushes for one launch.
- **Answer styles for the chat, with ELI5 as the default.** Mefi now explains
  things like you're five unless you pick another style: Short answers, Teach
  me, Brainstorm, Poke holes, Expert or plain. The new chip beside the
  permission mode in Vibe's and Build's message boxes shows the style and
  changes it; `/eli5` (or any style or skill) in a message uses it once. A
  reply now shows chips for the skills and tools it used.
- **Skills, any way you want them.** Every skill (the project's, your home
  folder's, and the styles built into Studio) can be always on, picked by the
  agent when it fits, or used only when called, separately for the chat,
  Studio's helper agents and the builders (Skills › How skills are used). A
  skill that fits is loaded on demand with a new `use_skill` tool instead of
  being pasted into every request, coding workers get the same skills through
  Studio's tool server, and a task that says `/skill-name` gives its builder
  that skill. A built-in style can be copied into the project and edited.
- **Connectors you can manage from Studio.** Team › Connectors now adds,
  approves, tests and imports MCP servers: Studio shows the exact command
  before anything runs, finds a server's tools by itself, imports the ones
  Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex, OpenCode and
  Gemini CLI already use, keeps their tokens encrypted, and lets you choose
  which ones the chat, the helper agents and the builders get. Online
  (Streamable HTTP) servers work too.
- **A faster, steadier tool harness.** The tool calls a model asks for in one
  turn run side by side, a connector's server stays open between calls (so a
  browser it opened is still there for the next click), and a connector's
  pictures reach a builder as pictures.
- **Chrome's buttons no longer look struck through.** The metal on main
  buttons and chosen tabs had a hard dark line at half height, right behind
  the words. Its horizon is now a soft band below them, and the darkest part
  is lighter, so the lettering reads better too.
- **One page at a time over the Map.** In the 0.5 layout, Fleet, Pipelines,
  Team and the other pages that open over the Map no longer show the Map's
  nodes faintly through the theme's glass.
- **The 0.5 layout is Studio's only layout.** Studio opens in it every time
  (Work, Map, Team and Friends on the rail, the session list, tabs and the
  status bar), whatever was chosen before. The way back to the classic
  layout is gone: Settings › You no longer has "Try the 0.5 layout",
  Search no longer offers "Switch layout: 0.5 or classic" or the rail
  switch, and `MEFI_STUDIO_LAYOUT` and `?layout=` are no longer read. The
  old choice stays in this PC's storage and does nothing.
- **The Command view is the Map in the 0.5 layout, as in the prototype.** With
  the new layout on (`?layout=v2`), the Map keeps your sessions in the list
  beside it, and a small bar over the tree holds Map | Fleet | Pipelines,
  "Running only" (everything that is not running dims, remembered on this
  PC) and View ▾: the five layouts, Labels (L), Camera (C), flat map or 3D
  orbit (V) with Spin (Space), and a way to Settings › Map look. The colours
  of the four states (Running, Needs you, Review, Done) sit bottom left beside
  the Legend, and Fit and zoom bottom right. Fleet and Pipelines (the Agent
  brain's live work) carry the same Map | Fleet | Pipelines switch in their
  heads. The classic toolbar's choices are the same settings; in the new
  layout its top bar folds away (Search, New task and the player live in the
  frame). N opens a new task and S opens Search on the Map. The classic
  layout is unchanged.
- **Friends works with no setup: the Mefi Studio relay.** Rooms, room chat,
  Listen together, companions in the Playground and cowork file claims now
  run through a free relay on Cloudflare
  (`https://mefi-relay.mefi-studio.workers.dev`) that is built into Studio.
  You no longer enter a hub address, and no PC has to stay on. The relay keeps
  no chat: your Studio keeps its own encrypted copy of each room's messages for
  a week, and when you open a room after being away, the messages you missed
  are filled in from other members' copies. Every message is signed by the
  relay, so a copy cannot be altered. Its code is public under `relay/`.
  Linking is one button: **Link Discord** in Friends asks Discord once in
  your browser and connects by itself; if your account is not in the Void
  Engine server yet, it offers **Join the Discord** and checks again.
- **Project hub with credits and ranks (Friends › Project hub).** Share what
  you make as a card (a public link, a title, a line about it; never a file)
  and play what friends make. A star map draws every shared project; New, Top
  and Mine list them. Sharing is free and earns nothing by itself: when a
  member plays someone else's project for two minutes, both earn credits (the
  maker 5, the player 2), and a star earns the maker 3, up to 60 a day.
  Credits are never bought; 100 features a project at the top of the hub for
  a day. Ranks run Spark, Ember, Flame, Comet, Star, Nova, Void, and your
  Discord roles show as special ranks. Your balance is yours alone; others see
  your rank.
- **Meeting people is simple: the Lobby, invite codes and Who's online.**
  Everyone signed in is in the Lobby, a room that opens by itself the first
  time you open Rooms, so there is always someone to say hi to. Every other
  room has a short invite code (like `7K3Q-M2XR`): **Copy invite** puts it in
  a message you can paste anywhere, and a friend types it into **Join with a
  code** to come straight in, no approval needed. The owner can make a new
  code, and the old one stops working. Rooms' **Online** tab lists who is in
  Studio right now, with **Invite to** your rooms and **Start a room
  together**; untick **Show me as online** to hide.
- **Friends is one roomy page in both layouts.** The classic layout's Friends
  now opens the same full page as the 0.5 layout instead of a small bubble
  card, with tabs for Rooms, Your PCs, Playground and Project hub and a Close
  button. The Project hub is in the rail's Friends menu and in Search. Your
  PCs sums up a long report in a few lines ("3 other worktrees have
  uncommitted work", "2 branches on GitHub not merged into main") with
  **Show all** for the full list.

- **Friends is a place of its own in the 0.5 layout.** With the new layout on
  (`?layout=v2`), the rail's Friends opens a page instead of the companion's
  bubbles: Rooms, Your PCs and Playground in the list beside it, one at a
  time, each with a line that says what it is for. They are the same cards
  as before (rooms and their invitations, syncing your PCs through GitHub,
  playdates and what your companion may share); Playground also keeps
  "Friends & listening rooms" and "Connect with Discord". Search's Rooms,
  Your PCs and Playground, and the companion's own Friends bubble, open the
  page at that place, and each place can be a tab.
- **A task that will fix itself no longer looks like a problem.** In the 0.5
  layout, a task whose checks failed and that tries again by itself is listed
  with the running work as "Fixing itself", and its page says so calmly
  instead of showing a red failure; it reaches the Inbox only if it gives
  up. A step that goes ahead with its whole request's one approval says
  "Goes ahead with its request".
- **Your own words wait behind a link in the Inbox.** A question card shows
  its options first, with a small "Answer in my own words" link that opens
  the box. An option that asks for words, or a half-written answer, opens it
  too.
- **Small things in the 0.5 layout's frame.** The status bar's player shows
  the time left ("Deep Focus 40:32"), ticking once a second only while
  something plays and the window can be seen. The usage meters read again
  after each run ends and every five minutes while Studio is in view, without
  opening Usage. Search says "N more results · keep typing to narrow them"
  when there are more than the twelve it shows.
- **The 0.5 layout's rail and Team, as in the prototype.** With the new layout
  on (`?layout=v2`), the rail has four places, Work, Map, Team and Friends,
  with Search, Settings and Help at its foot. Each place remembers where you
  were in it. The Command view is called the Map, and Help lists Start here,
  Setup guide, Shortcuts, What's new, Report a problem and the Void Engine
  Discord. Agents is now **Team**, filed into the prototype's twelve places in
  the list beside the page: Overview, Providers, Seats and models,
  Permissions, then Rules, Skills, Connectors, Related folders and Workflows
  ("Context for agents"), then Health and usage, Models and Inspect
  ("Monitor"). What moved where: Settings' Connections is Team › Providers,
  its Models are Team › Seats and models, its Automation is in Team ›
  Overview, and Mefi's permission mode (which Build opened as a dialog) is
  Team › Permissions. The Rules card has its own place. Connectors lists the
  servers in `~/.mefi-studio/mcp.json` with their tools. Related folders says
  plainly that Studio cannot add them yet. The model catalog, Performance,
  Usage, Brain maps, the Playbook, Project map, Context, the Session explorer,
  Activity and evidence, Trace, Overhead and the profiler open from their Team
  place with that place open in the list. Old links, Search and Settings' Find
  a setting all land on the place that holds a control now; a plain button
  such as Run auto setup is named by its own words in Search, so it no longer
  shows as "Settings › Connections". Settings lists its places in the same
  column. Team's pages read at 12 px or more and fit a narrow window without
  scrolling sideways. The classic layout is unchanged.
- **The Map and Team are called that everywhere.** Buttons, tooltips, toasts
  and messages that still said Command view, Live or Agents › Setup now say
  the Map and Team, and point where things are now: Team › Providers to
  connect an AI or install a coding tool, Team › Seats and models for coding
  models and the provider order, Help › Setup guide for Continue with
  ChatGPT, and Settings › Report a problem in Search. "Open in Command" and
  "View in Live" read "Open in Map" and "View in Map", and the companion's
  "Open the Map" (it was "Open live agent work") opens the Map instead of
  Team's Overview.
- **Start here speaks plainly and walks to the 0.5 places.** The guided
  tour's seven stops are rewritten for someone new to building with AI: Pick
  the AI that builds for you, Open your project, Let your AI map your
  project, See your AI accounts, Tell Studio what to make, Watch your AI work
  and Check what your AI made. They name places as they are now (Today,
  Ideas, the Map, the Inbox, Team › Providers, Help › Start here and Help ›
  Setup guide), and every Walk me to… button lands on something you can see:
  Team › Providers, the Map with Live work in front, the box on Today in
  either mode, and for review Today's Review column in Social or the task
  board's Review in Studio (it pointed at Home's old Review filter, which 0.5
  hides). In Studio the walk to the box no longer switches it to Create task,
  so what you typed stays in view. Your AI's advice in the tour uses the same
  words, and the toast after the welcome says the tour waits under Help ›
  Start here.
- **Vibe's board lists a waiting task once.** A queued task that has asked
  you something (a permission, a question) is under Needs you only, not also
  "up next" under Running.
- **Chrome catches the light.** The Chrome theme keeps its matte black and
  brushed metal and gains a cool iridescent finish, like anodised chrome, in
  silver, ice blue, lilac and pale aqua, used sparingly: a faint tint in the
  background and in Vibe's sky, a soft sheen on panels and cards, an
  iridescent stripe along the edge of the place, session, page or search
  result you are on, an iridescent line under the open tab and the chosen tab
  or theme, faint iridescent lines between the bars and along the top of
  menus, and an iridescent usage meter, switches and Vibe's project mark. Main
  buttons are a touch cooler and glow softly under the pointer, and Vibe's
  greeting takes the same tint. Nothing moves, animates or changes size, the
  colours that mean something (working, needs you, errors, review) are
  unchanged, and the colours are the same ones the website uses.
- **A new Chrome theme, now the look a new install opens in.** Chrome is a
  matte black with smooth metal: flat dark panels with a fine light edge,
  primary buttons and the chosen side of a switch (Vibe | Build, Sessions |
  Backlog, tabs) in brushed chrome with dark lettering, quiet secondary
  buttons with a chrome outline, a thin chrome edge on the place, row or tab
  you are on, a silver focus ring, and silver nodes and links over a dark
  starry sky in the Command view. It is the same palette as the website. It
  is listed first in Settings › Appearance, Settings › You, Vibe's settings
  and the setup helper's Look step. If you already chose a theme (Aurora,
  the old default, included) you keep it; every other theme is still there.
  The colours that mean something (working, needs you, errors, review) are
  unchanged.
- **A finer finish in every theme.** Buttons and list rows ease into hover and
  press instead of snapping (and stay still with motion off), raised controls
  and menus catch a fine top highlight, a pressed main button darkens a touch,
  and the tab menus share the other menus' corners. Nothing moves or changes
  size.
- **A shorter README that says where Studio is now.** It opens with the 0.5
  layout and says what is current: the download is 0.4.4, 0.5 is being built,
  and Studio is moving to Rust (with the three stages). It has new screenshots
  of the 0.5 layout (`docs/images/0.5/`), the manual steps for updating from
  0.4.4, and the 0.4.4 tour in a fold. The full "Working from several PCs"
  text moved to `docs/your-pcs.md`, and the optional integrations sit in a
  fold at the end.
- **Today, in both modes, as in the 0.5 prototype.** With the new layout on
  (`?layout=v2`), Build's Home with no session open is now Today: a greeting
  and "What's next for your project?", the message box with Add files or an
  image, the permission mode, Talk it over and Build it (Ctrl Enter), the
  Modify, Experiment, Fix and Improve starters and Suggest a next step, then
  the first thing that needs you (answer it right there), what is running now
  and what finished. A run that waits on you is listed under Needs you only,
  not under Running as well (in Today and in Work's session list). Talk it over sends your words to Mefi and opens the
  conversation; Build it makes a task. Build's earlier Home (the
  conversation, the queue, Activity and the app preview) is still there as
  the Chat tab (Talk it over or Search's "Open the conversation" opens it).
  Vibe's Today is the prototype's board: four columns that say when they are
  empty, a card that waits on you shows its task, its question in a box and
  its first two answers or actions, a result to review sits under Review, and
  Build it shows its key. The classic layout is unchanged.
- **The 0.5 layout's status bar, Search and Inbox, as in the prototype.** With
  the new layout on (`?layout=v2`), the status bar also shows the machine's
  load ("CPU 34% · Mem 61%", from what the resource watcher already measures)
  and lists its items in the prototype's order. Search (Ctrl K) opens under
  the top bar as one tidy list: the sessions that matter with their state, the
  places on the rail with their keys and the main actions, and a search finds
  sessions, ideas, pages, actions, layout and tab commands and the permission
  mode (which it can now set). The Inbox is one list everywhere: the top bar,
  the status bar, Home's "N need you" (which now opens it), the tabs and the
  session list's Needs you all count the same things. Its cards say who asked
  and which task they come from, a finished result offers Approve and finish,
  Review changes and Send it back, and the Inbox page now lives under Work
  (Work › Inbox). The classic layout is unchanged.
- **A plan draft opens as its own page in the 0.5 layout.** A plan picked from
  Work's Backlog now shows as one page, as in the 0.5 prototype: its name, where
  it stands and how many decisions are left, its outcome, the next step (Build
  it once its specification is approved, Talk it over before that), Archive, and
  its versions with Restore this version. Open the full plan shows every step
  as before, and Plans opened anywhere else is unchanged.
- **A three-step first run in the 0.5 layout.** With the new layout on, a
  fresh profile meets the 0.5 prototype's welcome instead of the whole setup
  helper: connect the AI you already use (each coding tool found on this PC,
  Ready or Sign in), choose a project (or open a folder, or start a new app),
  and give it a first task, which Studio adds and starts. Skip leaves the setup
  helper waiting in Help and Search as before, and Other ways to connect opens
  it at Connect an AI. An update still shows the helper; the classic layout is
  unchanged.
- **Settings in the 0.5 layout, as the 0.5 prototype files it.** With the new
  layout on (`?layout=v2`), Settings lists General, Notifications, Appearance
  (with Size and density under it), Map look and Sound and music, then Updates
  and Report a problem under "Updates and help" and System under "Advanced".
  Notifications, Updates and Report a problem are now pages of their own, laid
  out as panels side by side; Map look is the Nodes and Layout half of
  Appearance; Find a setting sits beside the page title; rows put the words on
  the left and the switch on the right, and no text is under 12 px. Every
  setting, deep link and Search result still reaches the same control. The
  classic layout is unchanged.
- **The 0.5 layout's top bar says where you are.** With the new layout on
  (`?layout=v2`), the bar's middle is a breadcrumb, as in the 0.5 prototype:
  the project and the open session (or Today), or the project, section and
  page; on the Task board its task opens with one press. A section's pages
  (Work's Task board, Plans, Ideas, Analyzer and Worktrees; Agents' sections
  and views; Settings) moved from the bar into the left column, with Back,
  Forward and the Git chip beside them. The classic layout is unchanged.
- **The 0.5 session list's head.** The project name opens a project menu
  (switch project, Open a folder, Start a new app, All projects), the Git chip
  sits under it with the branch and what is waiting, and "N worktrees" opens
  Work › Worktrees. Backlog lists plan drafts as well as ideas, with Scan the
  project and Scan chats for ideas at its top.
- **The 0.5 thread and its box.** A session's head says where it stands, who is
  on it, its branch, its checks and (once known) its cost. The box spans the
  thread and has one row: Note, Ask or Change, Attach (now for a Note too:
  its pictures wait for an Ask or a Change), one run menu ("Auto · OpenCode")
  that holds the permission mode, the coding worker and its tier and the
  folder, the Worktree switch and Send.
- **The 0.5 inspector.** A session's inspector has a Worktree tab (where its
  run works and whether that work is safe), and tabs that do not fit wait
  behind More. Plan shows the run's own steps and the acceptance checks.
  With no session open, Home's inspector shows the project (repository,
  team, latest activity); on pages that are not a session the inspector
  folds away instead of saying there is nothing to inspect.
- **GPT-6.1 Sol.** The lead, desk and overseer seats and the heavy Zen role
  now default to `gpt-6.1-sol` (released at DevDay 2026: near Astra quality
  at a fifth of Astra's price). It appears in the Zen model pickers and keeps
  the GPT-6 family's full effort ladder and Fast tier; seats you picked
  yourself are unchanged.
- **Codex workers run over `codex app-server`.** A harness
  (`scripts/codex-harness.cjs`) drives Codex's JSON-RPC server instead of
  `codex exec` while the executor reads the same lines. It is the default
  (Setup › Coding worker › Connection switches back to classic exec, and a
  server that cannot start retries over exec): MCP servers with
  credentials are no longer dropped, the owner's own Codex MCP servers stay
  out of Studio's runs, and token use and plan limits arrive live.
- **Use your ChatGPT plan.** Setup › Connect an AI has a "Continue with
  ChatGPT" card (Sign in with ChatGPT, OpenAI's open-source token-sharing
  preview from DevDay 2026). Once signed in, the ChatGPT Plus/Pro plan pays
  for Studio's assistant calls instead of a metered key: pick "ChatGPT plan"
  for a role or seat, or let Auto use it first among the subscriptions. The
  plan's limits are shared with ChatGPT and Codex; at a limit Studio moves on
  to the next route and links to ChatGPT's usage settings.
- **The launch screen is a daily paper.** The Studio Daily prints the day's
  biggest AI and developer-tool news beside your projects: a lead, three
  stories, In brief and a Studio wire of CLI releases, gathered once a day
  from ten news wires, headlines and short summaries only. Offline it shows
  yesterday's edition; Settings › General turns it off. Above the news,
  "Since you were away" says what changed in your recent projects (finished
  tasks, questions waiting on you, new commits), which models are new since
  your last visit (OpenCode Go, Zen, Claude, z.ai, OpenRouter and your ChatGPT
  plan), and what is new in Studio; a project's name picks it in the chooser.
- **Models › Catalog and Performance get a face lift.** The catalog is one
  aligned table under a sticky toolbar whose column names sort it, with a
  quality bar per row, four picks (top quality, best value, biggest context,
  newest) and the plan in one quiet line; Performance leads with KPI tiles, a
  leaderboard with inline bars, a task type switch and one card explaining how
  rankings fill in.

- Studio is moving from Electron to Rust in stages (docs/rust-migration.md).
  A source checkout can now run on the new Rust host with `npm run host`: the
  same screens, saved settings and API keys, with the engine running beside
  it under Node. The Electron build is unchanged and is still what ships.
  On the Rust host the OpenCode session store is now read by Rust: the same
  answers, and the usage ledger's repeat reads about nine times faster.
  Multi-PC sync, the Worktrees page's list, merge, remove and forget, and the
  @ picker's file search run in Rust there too, and so does the Git chip's
  work: its look at each project, Save and push, Publish and Link, with the
  same checks for keys, big files and folders that must stay out.
- On the Rust host the Media browser, before and after screenshots, dropped
  files and the Recycle Bin now work as they do on Electron, a page that fails
  to load is reported, and the first launch brings over what the Electron
  build kept in the page (panel sizes, names, plan drafts). Zen's desktop
  audio listens to what the PC plays without asking which screen to share.
- A portable build can now ship on the Rust host (`npm run package:host`):
  the same folder as the Electron build, with Node beside the program. The
  updater in this version can install either kind of build and roll back
  from either, so the next releases can move to the Rust host. The release
  workflow builds it when asked (`host: tauri`); a version tag still
  publishes the Electron build until this version has reached installed
  copies.
- More of the engine runs in Rust on the Rust host: the Skills page's files, a
  message's pictures, the before and after pictures behind Changed files and
  Revert, settings.json and auth.json (with the same care for a broken
  settings file: it is copied aside and never rewritten from nothing), and
  the Git chip's own state and queue. Each gives the same answers as the
  JavaScript it replaces, held equal by a test that runs both.

- The Publish dialog's "This drive cannot keep a Git project reliably" warning
  and Set up this PC's exFAT/FAT drive checks work without administrator
  rights. They asked `fsutil`, which Windows refuses to a normal user, so they
  never showed; they now ask PowerShell, which takes about 0.2 s.

- Your PCs can explicitly start a coordinator and pair check workers. Queued
  Studio checks use isolated exact-commit checkouts, retain restart journals,
  and hold uncertain assignments for owner recovery. Services stay off after
  app restart; another PC requires trusted HTTPS and separate network setup.

- Failed automatic development updates wait an hour before retrying the same
  build; manual updates remain available. Missing or malformed build metadata
  falls back to an older eligible build, and failed channel changes show a reason.

- Booklet scripts and styles use one ordered inventory for reads, emission,
  error-source attribution and fixtures. Audits read the audited tree's declared
  inventory and report missing or duplicate inputs.

- Task brief restore and prerequisite replies preserve newer accepted brief and
  run state. Returning to a project cannot revive an older detail action reply.

- Reference gather replies cannot save into another project or repaint a closed
  detail. New gathers supersede older replies without cancelling host work;
  stale success, error and save completions leave the current view alone.

- Pending task opens stop their detail, announcement and reference-gather actions
  after a project switch, closing the view or opening a newer detail. A stale
  failed read cannot replace the current detail's status.

- Task overview updates retain unchanged cards and folds instead of rebuilding
  the whole board. Changed groups refresh their content and actions while
  preserving expansion and keyboard focus; project switches clear retained cards.

- Fleet labels cached team facts after a failed refresh, clears the previous
  project's content on a switch, and restores controls only after a confirmed
  scoped snapshot. Older replies cannot overwrite a newer read or push outcome.

- Task Details shows the linked plan's current saved destination without changing
  the task's recorded brief. Missing, unreadable, foreign, ambiguous, changed,
  archived or unapproved plan context is labelled honestly. Plan-only refreshes
  retain note drafts and focus; View linked plan reuses the existing navigation.

- Fleet Health adds an informational note when a seat hands off three distinct
  tasks within a day without later recorded verification. Duplicate events do
  not inflate it, verified or human-confirmed evidence clears each task, and
  Look opens the source seat. The note never pauses agents or changes dispatch.

- Fleet seats retain a deterministic recap of their recent recorded generations,
  capped at 1,500 characters. The inspector shows it and the next assigned worker
  receives the same history alongside its current brief and saved progress;
  interrupted runs and unverified completion reports remain clearly labelled.

- Identical worker handoffs repeated across stdout and stderr are admitted once;
  distinct follow-up briefs remain separate.

- Expanded session controls retain a readable conversation area in short
  windows, including 150% zoom, while keeping the draft intact.
- Stable updates use published GitHub release builds only. An optional
  Development / beta switch asks for confirmation about untested changes,
  instability and possible data loss. Once artifact publishing is separately
  delivered, it can automatically receive packaged artifacts from successful
  main builds. Returning to Stable stops development
  updates and can restore the published stable build. Installed apps no longer
  hot-swap raw source files from a nearby checkout; downloads require SHA-256,
  matching platform and build identity, and development updates require rollback.
  Development artifact publishing is deferred from this application-only
  checkpoint; until the workflow is separately delivered, the channel reports
  that no supported development artifact is available. This remains review work.

- **Room for a session list, an inspector, a tab strip and a status bar (off by
  default, nothing changes yet).** The window's layout now keeps room for four
  panels that are not built yet. Nothing looks different: every page, sheet,
  toast, the companion's orb and the media window are exactly where they were,
  checked to the hundredth of a pixel in four window sizes. Developers can try
  the wider layout with `?layout=v2`; below 900 px wide the list and the
  inspector fold away.
- **One place decides where the free space is.** The companion's orb, the media
  window, toasts and pop-up lists ask the shell where the window is free, so they
  will stay clear of the new panels.
- **Size and density, with a live preview (new layout only).** Settings has a
  Size and density page: make text bigger or smaller (never under 12 px), pick
  Compact, Comfortable or Spacious rows, and choose how much each row shows
  (titles, status or everything). A miniature of the window beside the controls
  changes as you drag, so you do not have to flip back and forth. **Apply** puts
  it on the whole window (with **Undo**), **Reset** goes back to the defaults, and
  leaving the page keeps what you have not applied. The interface scale is on the
  same page, and Ctrl +, Ctrl - and Ctrl 0 still move it and the page follows.
  Spacious is new; older windows read it as Comfortable, and Settings ›
  Appearance points to this page instead of a separate Density list. The first
  time a new choice is saved, your old appearance settings are backed up.
- **Today, Vibe's home in the new layout (new layout only).** Your box to build or
  talk, and under it a board with one line for everything, in four groups: Needs
  you, Running, Review and Done today. How much each line says follows your Size
  and density setting, and a question can be answered right on its line. The
  node tree stays behind it.
- **An Inbox for everything waiting on you (new layout only).** Questions and
  permissions, approvals, finished work to check and tasks that stopped, in one
  place, with what each is, which task it is from and how long it has waited. Your
  choices use the same buttons as before, leave a "Decided" line, and can be
  undone where Studio has a way back. Open it from the "N need you" button, with
  Ctrl J, or as a page.
- **Clicking a Windows notification opens the task it was about, or the Inbox when
  it told you about several things (new layout only).**
- **A new, optional 0.5 layout, with a bar, a list, an inspector and a status bar
  around every page (classic stays the default).** Turn it on in Settings ("Try
  the 0.5 layout") or with Search ("Switch layout: 0.5 or classic"); Studio
  reloads to switch. `MEFI_STUDIO_LAYOUT=v2` opens Studio in it for one launch, and
  `MEFI_STUDIO_LAYOUT=v1` forces the classic layout whatever was saved.
- **The 0.5 layout's top bar** has a list toggle, a Vibe | Build switch (Ctrl M),
  where you are, Search, how many things need you, how much is working with a
  pause button, and an inspector toggle.
- **The 0.5 layout's status bar** has a Layout menu (list, inspector and tab strip
  switches, each mode's widths, Reset layout with Undo, Size and density), what is
  running and what waits on you. When Studio has them it also shows usage meters,
  the player, the permission mode and today's cost.
- **Resize the list and the inspector by dragging their edge, with the arrow keys
  (Shift for bigger steps, Home and End for the ends), or by double-clicking to
  reset (new layout only).** Vibe and Build each remember their own layout. Ctrl B
  shows or hides the list, and [ the inspector. In a small window they open as
  drawers over the page and close on Esc or a click outside.
- **Tabs you add and pin (new layout only).** With the 0.5 layout on, a row of
  tabs sits at the top of the window. Home stays at the left. Press + (or Ctrl+T)
  to open any page, or one of this project's sessions, in a tab; pin the ones you
  always want so they stay; drag a tab to put it where you like. Each project keeps
  its own tabs, pinned pages follow you into every project, and your tabs are still
  there after Studio restarts or updates itself. In a small window the row becomes
  one button with a menu of every tab, and Build's session page starts right under
  the row.
- **Studio keeps your tabs tidy, and every part has a switch (Configuration ›
  UI & Surfaces › Tab behaviour, or the sliders button on the row).** A page you
  only look at opens in one italic preview tab that your next click replaces,
  until you type in it, pin it or double-click it. When an agent needs you, its tab
  gets a badge and opens in the background (or only gets the badge, or takes you
  there: your choice). Tabs of finished sessions close after 30 minutes you have
  not opened them. At most 8 unpinned tabs are kept (3 to 12, or no limit): the one
  you used longest ago closes, with an Undo. After you open the same page three
  times, a small chip offers to pin it, once. Pinned tabs never close by
  themselves, and whatever Studio closes comes back from Recently closed or with
  Ctrl+Shift+T. One master switch turns all of it off, and so does starting Studio
  with `MEFI_STUDIO_NO_TAB_MANAGER=1` (for that run).
- **Keys for tabs (new layout only).** Ctrl+T opens the add menu, Ctrl+W closes the
  tab you are on, Ctrl+Tab and Ctrl+Shift+Tab move between tabs, Ctrl+1 to 9 jump to
  one (9 is the last), Ctrl+Shift+T brings the last closed tab back, Ctrl+Alt+P
  pins or unpins, Ctrl+Shift+Left and Right move the tab, and a middle-click
  closes it. With the 0.5 layout on, Ctrl+W no longer closes the Studio window (its
  close button and Ctrl+Q still do). Nothing is taken from a box you are typing in.
- **Build's tasks as a session list (new layout only, off by default).** With
  the new layout on (`?layout=v2`), Build's Home lists this project's tasks as
  sessions: Needs you, Running, Review, Queued and Done, newest first, each with
  a status dot, its title and a line of words (Settings' detail level picks
  titles only, titles and status, or everything). A run in its own worktree
  wears a branch mark. Each row's menu opens it in a new tab, pins, renames,
  stops or deletes it (a delete asks first and can be undone from Recently
  deleted). A filter box and a Sessions | Backlog switch narrow the list; Ctrl N
  starts a task. Developers can switch the panels off with `?sessions=off`.
- **Each session opens as a thread (new layout only).** It shows the brief with
  its pictures, every run with its steps and what it said, a live line while a
  worker is on it, your notes, your questions to Mefi and the answers, what Mefi
  decided for you (with Undo), and before and after shots that open larger. A
  question that waits on you sits above the message box with its options, what
  Mefi suggests, a box for your own words and Decide later. The box at the foot
  takes a Note, an Ask or a Change, with Attach picture, the @ # / picker and
  chips for the branch, Worktree, permission mode and coding worker. In a small
  window it folds behind a More button.
- **An inspector beside the thread (new layout only).** Plan (where it stands,
  the brief, what it is done when, earlier versions with Restore), Changes and
  Checks (the same files, diffs, Accept, Revert and checks as the task board,
  with live counts on the tabs), Preview (the project's preview controls and
  Before and After) and Agent (who is on it, what it took, the time limit,
  Stop).
- **A task opened from anywhere lands in its thread (new layout only).** The
  palette, a notification, a tab and View task select the session and show it.
  Each project remembers its open session, folded groups and inspector tabs
  across a reload. The task board is still one press away.
- **Build's Home can list your tasks like sessions, in a coding-agent desktop
  layout (off by default).** Search › Switch Home layout turns it on. The menu
  lists this project's tasks the way the Claude Code and Codex desktop apps list
  sessions (Chat with Mefi, Pinned, Needs you, Working, then by day). The page
  opens on a greeting card that counts what has been built here (tasks, runs,
  tokens, active days, peak hour, top model and a heat map of the last twenty
  weeks) over the composer, with chips for the project, its branch, the
  permission mode, the coding worker and **Worktree**. A task opens as a session
  with its brief, runs, checks and a Note / Ask / Change composer, and Activity,
  Preview, Queue and Status become panes that dock beside the page or pop out as
  windows. The composer stays on one line at 1920 wide and the Permissions menu
  is no longer cut off.
- **Windows tells you when something needs you.** When a question, an approval, a
  permission or a task that failed after Mefi stopped retrying is still waiting 20
  seconds on, and Studio is not the window you are looking at, Windows shows one
  notification (a finished task only if you switch that on). Nothing is sent while
  you are looking at Studio, inside quiet hours, twice for the same task within 15
  minutes, or more than 12 an hour. The words are generic ("Something needs you")
  unless you choose task titles in Settings › General › Notifications, which also
  has a test button. Clicking a notification brings Studio up and opens the task.
- **The taskbar icon flashes and shows a count.** It flashes until you switch back
  to Studio and shows a number for what is waiting on you. Both can be switched
  off, and so can all notifications (the master switch, or
  `MEFI_STUDIO_NO_ALERTS=1`).
- **Quiet hours are shared with the Discord remote.** The hours you set for one now
  keep the other quiet too; change them in either place.
- **Windows knows Studio by a fixed name.** Notifications and the taskbar button
  use the id `MefiStudio.StudioAIPlus`, so a portable, a moved and an updated copy
  are one app. A taskbar button pinned earlier may need pinning again;
  `MEFI_STUDIO_KEEP_APP_ID=1` keeps the old id.
- **Report a problem.** Settings › System › Diagnostics builds a small report on this
  PC: Studio's version, one line per task, the last 1,000 log rows, what the
  builders said and, after a crash, what Studio wrote down. Keys, home folders, this
  PC's names, e-mail and network addresses are removed; you can read every file
  first, swap task titles for numbers, and save it as a zip where you choose.
  Nothing is uploaded, and settings, sign-in files, the vault, screenshots and
  project files never go in.
- **Studio tells you when it closed unexpectedly.** After a crash, a freeze or a lost
  window, the next start shows one toast with Review the report and Dismiss, once
  per crash. A normal quit, an update restart and a rolled-back update never show
  it. Switch it off in the Report a problem card or with
  `MEFI_STUDIO_NO_CRASH_PROMPT=1`.
- **Studio says what changed after an update.** A toast "Studio updated to X" with a
  What's new button opens a short sheet of that version's notes, once. It never
  opens a window by itself and is silent on a first install. The notes stay in
  Settings › Updates, marked New until read; "Tell me what's new after an update"
  turns the toast off (or `MEFI_STUDIO_NO_WHATS_NEW=1`).
- **Each task can have its own time limit.** In a task's Evidence, pick Stop an
  attempt after 5 to 240 minutes (25 unless you change it). A run that hits its
  limit is stopped the way your Stop button stops it: progress is saved, it does
  not count as a failure, and the card waits for you. Studio's own 25 minute
  ceiling still applies, and the page says so if you ask for longer.
  `MEFI_STUDIO_NO_TASK_CAP=1` switches limits off.
- **A task's Evidence shows its usage.** A new Usage & limit section gives the
  time, tokens and cost of this attempt and of the whole task. A builder that
  reports nothing says Not reported, and a plan that does not price a call says
  Unpriced, instead of showing zero.
- **You can attach pictures to a message.** In Home's message box, use Attach
  picture, paste one, or drop it in (PNG, JPEG, WebP or GIF, up to 5 MB each, four
  per message). A model that can see pictures is sent them; one that cannot says
  so once in its reply. Coding tools and tasks made from the box are told where
  the file is, in one plain line. Pictures stay on this PC under the project's
  data folder. `MEFI_STUDIO_NO_IMAGE_ATTACH=1` switches it off.
- **Typing @, # or / in Home's message box suggests what you mean.** `@` offers
  the project's files, `#` its tasks and `/` its skills, and what a message points
  at shows as small chips under the box. Saying /skill-name in chat gives Mefi
  that skill's instructions for that reply; `@path` tells Mefi the file exists
  and never sends its contents. A Settings switch, "Suggest files, tasks and
  skills while I type", turns it off (or `MEFI_STUDIO_NO_COMPOSER_PICKER=1`).
- **A Skills page: Agents › Setup › Skills.** See the skills your project keeps,
  write or edit one with checks as you type, start from a ready-made example,
  import one from a folder, export one as a folder or zip, and delete one (it
  asks twice; a copy of the old text is kept on this PC). Skills that other tools
  keep are listed read-only. It writes only under `.agents/skills`, and
  `MEFI_STUDIO_NO_SKILL_EDIT=1` makes it read-only.
- **A task a worker has run shows what changed, and lets you take it back.** Its
  Evidence tab has a new "Changes and checks" section: the files the attempt
  changed with their changes, a before and after look at the preview, and the
  checks that ran. Accept changes, put one file back, or put the whole attempt
  back: Revert attempt asks twice, reopens the task and keeps a copy of the
  folder first so it can be undone, and Studio never overwrites a file you
  edited after the attempt ended.
- **Studio keeps a private before and after picture of the folder for each
  attempt.** It is local git data, only on this PC and never pushed, and it does
  not touch your index, branch or files.
- **After an attempt, Studio runs the project's lint and typecheck and shows the
  result as advice.** It never stops a task from being done. Builders can run the
  same checks and read the preview's output themselves.
- **When Studio's own preview is running, it takes a before and after screenshot
  for each attempt.** Screenshots stay on this PC and are never added to a
  problem report. Three switches (pictures, checks and their build, screenshots)
  sit under "What Studio keeps for each attempt", and each can be turned off with
  an environment variable (`MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS=1`,
  `MEFI_STUDIO_NO_ADVISORY_CHECKS=1`, `MEFI_STUDIO_NO_EVIDENCE_SHOTS=1`).
- **Deleting a task or an idea can be undone.** A toast with Undo stays for about
  eight seconds on the Task board and in Ideas, and Clear finished ideas gets one
  Undo for all of them. A new Recently deleted list (Task board › More for tasks
  and ideas, Ideas › Tools for ideas) keeps deleted cards for 30 days, up to 50
  per project; Restore puts a card back where it was and never over one that is
  there again. A delete keeps a copy first, and if Studio cannot keep the copy,
  nothing is deleted and it says why. `MEFI_STUDIO_NO_BOARD_TRASH=1` gives the
  old delete-for-good back.
- **Plans keep every edit as a version.** Each one records who made it (you,
  Mefi or Studio), when, and a one-line note. Versions (it was Plan history) lists
  the newest 20, and Restore this version brings an older one back as a new
  version: nothing is erased, and you confirm and approve again before tasks are
  made.
- **Search (Ctrl K) starts with what you used last, and can add work.** The empty
  box shows Recent (what you last opened or ran from it, kept for each project).
  Type "task ..." or "idea ..." and press Enter to add one; a toast offers Open,
  and an idea added this way reads "From you". Both can be switched off:
  settings `ui.searchRecents` and `ui.searchQuickCreate` set to false, or
  `MEFI_STUDIO_NO_SEARCH_RECENTS=1` and `MEFI_STUDIO_NO_QUICK_CREATE=1`.
- **Rules for your agents: a new card in Agents › Team & models.** Write up to
  4,000 characters of standing rules for a project and every Studio model working
  on it reads them first. A rule text that is too long is refused, never cut. Two
  switches on the card also send the project's own AGENTS.md and CLAUDE.md (the
  first 8,000 characters of each, read fresh each time); they are off until you
  switch them on, because their text reaches the models as instructions. Claude
  Code, Codex and OpenCode keep reading those files themselves, so they are given
  only your written rules; Grok and Antigravity builders are given the files by
  Studio. The card shows what the rules add to every request and who reads what.
  A project that follows the Studio defaults shows their rules; saving rules for
  it gives it a team of its own, and "Use Studio defaults" asks twice before it
  would drop a project's rules. Saved teams do not carry rules, and applying one
  keeps the project's. `MEFI_STUDIO_NO_AGENT_RULES=1` turns the rules off.
- **Studio's own models can list a project's folders and search its text.** When
  Read project files is on, they no longer guess file names: `project_list` and
  `project_search` follow .gitignore, skip hidden, private, binary and very large
  files, and never follow a link out of the project. Read project files now also
  refuses key and database files and data files whose names say they hold
  secrets. Coding CLIs keep their own tools. `MEFI_STUDIO_NO_PROJECT_SEARCH=1`
  removes the two tools.
- **Media player fixes.** Next in a YouTube playlist follows the playlist. A
  remembered video link no longer asks YouTube for its picture until you open the
  media menu. The card follows radio and buffering; its ideas, hints and Up next
  drags stay current. In a small window the floating player keeps Close inside
  its bar and no longer flies in from the corner when the menu closes.
- **Small text in Build's sessions layout is no longer under 12 px.** The
  count beside the branch, the hints under the composer, the labels on panes, the
  "you" line at the foot of the menu and a few other notes were 10.5 to 11.5 px.
  A real-window test now opens that layout at five window sizes and checks the
  task list, the branch mark, the composer's one-line row and this size. In a
  very short window (the smallest one at 150% zoom) the words box is one line
  high, so the whole message box, with its Attach picture button and Send, stays
  on screen; drag the box taller when there is room.
- **Tree brightness is much lighter on the graphics card.** Command, Home and
  Vibe paint brightened nodes and lines once per pass instead of once per shape
  (on the owner's laptop at 200%: Vibe 4.6 to 42 fps, Command 8.8 to 36, Home 4.1
  to 43). Node outlines stay pale over the real layer. Appearance › Tree
  brightness & outlines › Fast brightness turns it off if a look changes.
- **Studio's own code loads from a compile cache after the first launch.** Each
  of the hundred or so files behind the window is compiled once and read back
  compiled the next time (module loading dropped from about 90 ms to 50 ms on a
  fast Linux machine; more where disk reads are slow). It is keyed by each file's
  content, so an update can never load old code. `MEFI_STUDIO_NO_COMPILE_CACHE=1`
  turns it off.
- **A chat message over 16,000 characters is refused, not cut.** Every box that
  talks to Mefi used to send only the first 16,000 characters of a very long
  paste and keep that in the thread, so the rest vanished without a word. It now
  says how long the message was and that nothing was sent, and the box keeps what
  you typed.
- **Commits made in a detached worktree now count as work only this PC has.**
  The Friends badge, the session report and the question before closing Studio
  listed a worktree only when it had uncommitted files, and every branch's
  commits by branch, so commits on a detached HEAD (which belong to no branch)
  were invisible until the folder was deleted. They are listed when no branch,
  local or on GitHub, holds them.
- **Ctrl +, Ctrl − and Ctrl 0 change the interface scale, and it is remembered.**
  They walk the same 70% to 150% ladder as the slider in Configuration › UI &
  Surfaces (fine below 130%), from wherever the slider left it, and Ctrl 0 is
  100%. They used to zoom without saving and without a limit, so a reload put
  the scale back. A short line says where it ended, and an open slider follows.
- **Worktrees have a page in Studio: Work › Worktrees.** It lists every
  worktree of the open project, worst first: which hold work that only this PC
  has, which are on GitHub but not merged and which are merged and safe to
  remove, with the task a run belongs to. From it you can open a folder, merge a
  branch into main (a fast-forward; a merge commit only when you ask for one,
  and never while the worktree or the main checkout has uncommitted files),
  remove a folder (two presses; a folder holding uncommitted files or commits on
  no branch keeps a copy as `refs/mefi/rescue/…` first) and forget folders that
  are gone, and turn on "Give each run its own worktree". Nothing on the page
  pushes, and a run's folder is left alone while it works.
- **Build's task list marks tasks that work in their own worktree.** A small
  branch mark sits on the row of any task whose run has a worktree, so you can
  see which work lives in another folder without opening Work › Worktrees. It
  follows that page (a merged run's mark goes) and starts over when you switch
  projects. Switching projects also clears the Worktrees page's old list at once
  instead of showing it until the next read.
- **Panes that can scroll show a slim indicator.** Scrollbars stay hidden
  everywhere, so it was easy to miss that a pane scrolled. While the pointer is
  over a pane that overflows, and for a moment after you scroll it, a thin
  indicator on its edge shows where you are. It takes no room from the pane,
  never catches a click, and does not exist on panes that fit.
- **`npm run worktrees` lists every worktree of a project.** Each row shows the
  branch, how far it is from `main`, what is uncommitted or unpushed and what to
  do about it (push it, land it, or remove it because it is merged). `--json`
  gives the same rows to other tools. It changes nothing.
- **The multi-PC sync report no longer cries wolf.** A shallow clone (such as a
  cloud session's) reported its whole history as "not pushed yet"; the check now
  fetches back far enough to compare `main` with GitHub's, or says they were not
  compared. Branches built on `gh-pages` are listed as site branches, not as work
  to bring into `main`.
- **Security notes are up to date.** `SECURITY.md` now says what coding workers
  (approval prompts off), link reading, the update safety net's saved copy and
  audio-reactive input do with your data, and the Friends setup guide names the
  0.5.0 release.
- **Agents can read the web pages you link.** A new `web_read` tool, with its
  own **Read web pages you link** switch (in Agents › Setup and the setup
  helper's Tools & skills; it starts wherever the role's search switch is),
  lets chat, Vibe sizing, Plans and the other assistant roles read a page you
  paste or one a search found, and coding workers get it with their other
  Studio tools. It opens only links it was given, never an address the model
  makes up, and reads public `http`/`https` addresses only: local, private,
  cloud metadata and this PC's own addresses are refused, checked again when
  the connection opens and on each of at most five redirects. A read stops at 15 seconds and 512 KB and sends no cookies,
  logins or keys. `<noscript>` text is kept, a page built by JavaScript also
  returns up to three of its own same-origin JSON files, and a long page comes
  in parts the agent reads on through. Page text is marked as untrusted data.
  See [docs/agent-tools.md](docs/agent-tools.md).
- **Tool requests no longer leak into chat.** A reply that wrapped its tool
  request in a code fence, repeated it or added text around it was shown as
  the answer, raw JSON and all. Studio now finds the request anywhere in the
  reply and runs each call once. Calls past the per-turn or per-answer cap are
  skipped and the model is told. When the tool budget is spent the model gets
  one more turn without tools, and a reply that still asks for tools fails
  with a plain error instead of reaching you.
- **A plan your login does not have no longer burns a task's retries.** When
  a provider refuses the login itself (OpenCode Go's "An active OpenCode Go
  subscription is required", a model the plan leaves out, HTTP 402), the card
  goes back on the outage backoff with no attempt charged, and it says why.
  The route then waits, 5 minutes doubling to half an hour, so the other cards
  on it are not each refused in turn (a plan that leaves out one model holds
  only that model). You hear it once, in the thread and the feed, with the
  fix: pick another coding model in Agents › Setup › Team & models, or renew
  the plan. Starting the card yourself still tries the route, and a run that
  finishes on it, or a restart, ends the wait.
- **Workers report every run and leave landing to you.** Every run must now
  print its `MEFI_RESULT` line before the final one: Studio checks the work
  from it, and a Claude Code, Codex, Grok or Antigravity run cannot be
  verified without it. Workers never push, pull, merge or run `npm run sync`,
  even where a project's own notes say to; Studio and you land the work. They
  are told not to invent names, commands, environment variables or packages
  (a detail only you know becomes an ask), to look for a roadmap item's plan
  in `docs/` before building it, and on Windows to use `Select-Object` where
  PowerShell has no `head` or `tail`.
- **Asks only you can answer stay on your list.** In a test run, two asks only
  the owner could answer (a merge and a push decision) were closed as "Leave
  it for review" before anyone saw them. Nothing automatic can close an
  owner-only ask now: the desk leaves it in Needs you with its note, the host
  refuses such an answer made for you, and your own click still closes it. A
  dismissed ask records who closed it.
- **One chat message can file several tasks.** "Add three tasks: 1) … 2) …"
  filed one card, because each carried the whole message and admission read
  the others as the first one again. When your message lists the tasks (a
  numbered or bulleted list, or a comma list), each gets its own card with its
  item first in the brief. One request that the model splits into steps is
  still one card, one title asked twice is one card, and sending the message
  again files nothing new.
- **Vibe says what really happened, and asks before what cannot be undone.**
  When sizing times out, no lead model answers or the plan has too many steps,
  the strip says so ("The lead took too long, so it's one task") instead of
  "Best as one task", and a failed sizing no longer sets the usual time.
  **Building now** rows get a **Stop** that asks twice and keeps the run's
  progress, and **Drop it**, **It's done** and **Make it one task** ask twice
  too. A check still running after half an hour shows in Needs you as **Still
  checking**, with View checks and It's done, instead of looking stuck. **Ask
  for a change** adds the follow-up under your draft instead of replacing it,
  names the task and puts the caret where the change goes. Freshly done and
  the Done list go by when a card finished, so a note on an old card no longer
  makes it "done just now", and dropped work stays out of Freshly done.
- **Build and Live ask before they stop work, and loose ends are tied.**
  Command's Stop all and Restart need a second press, Home's ask first, and a
  running task's Stop in Work › Tasks asks twice. Stop all says when a run is
  still finishing instead of calling it stopped. A card held by a grouped plan
  offers **Open group** instead of buttons the host refuses. Fleet's **Open in
  Command** on an idle seat lands on its task, or the group holding it. The
  Explorer's Machine list offers Stop only on test runs and reports what the
  host answered. The Agent brain draws step titles on a pipeline with no
  running step, and Command's "Desktop store not available" hint clears once
  the store answers again. A dropped card you then mark done reads as
  finished, not dropped. Auto setup no longer tells a machine with a saved key
  or a signed-in CLI that "the saved custom endpoint answers".
- **An update can be undone, and a broken one undoes itself.** Before an
  in-app update replaces the portable folder, Studio saves the build it is
  replacing outside the install folder (`%LOCALAPPDATA%\MefiStudio\rollback`).
  The installer helper then starts the new build and waits for it to say it
  came up. A build that exits or never reports is started once more, and then
  the saved build is put back and Studio says why on the next launch. **Roll
  back** in Settings › Updates does the same by hand. Projects, tasks and
  settings (`resources\app\data`) are never touched by an update or a
  rollback, and a backup that cannot be made skips the update instead of
  risking it. The update helper is also written with a byte order mark now, so
  a Windows user name with a non-ASCII letter no longer points it at another
  folder. `MEFI_STUDIO_NO_ROLLBACK=1` keeps the old plain swap. Only updates
  made *from* a build that carries this are protected, so the first
  protected update is the one after this release.
- **Security fixes for remote approvals, catalogs and sharing.** Work filed
  from Discord retains its approval requirement through task admission and
  promotion. Concurrent PIN attempts count toward one lockout and approval
  buttons can be used once. Catalog token limits accept finite nonnegative
  numbers and render safely. Idea scans stay inside the selected project,
  skip linked paths and redact credentials before clipping excerpts. Friend
  exports and Discord messages remove complete home paths, including paths
  already shortened to `~`.

- **Friends is easy to find.** Build's main menu and Vibe's rail now have
  Friends. Build also links straight to Rooms, Your PCs and Playground, and
  Search finds each one. The links open and focus the existing Friends cards;
  the companion's Friends bubble remains available.
- **Compact cards for Ideas.** The inbox now shows each idea's title, a short
  detail preview and its source in responsive cards that fill the space under
  shorter neighbours. Ideas and the Task board share the same resize-aware
  layout, respect reduced motion, and stop their layout watchers when closed.
- **The 0.4.5 boundary is recorded.** The public roadmap and guide separate
  the included desktop work from features awaiting a rooms service and work
  deferred to later releases. The existing Fleet page is included; agent
  lanes, missions, Friends 2.0 and the wider overhauls remain later work.
- **The Git chip: where this project stands against GitHub, and Push, Pull,
  Save and Publish from it.** A small chip beside the project name in Vibe (and
  at the end of the section bar in Build) says in words and a glyph whether the
  open project is in sync, has work to send ("2 to push") or to get ("3 to
  pull"), changed on both sides, has files you have not saved, is only on this
  PC, or cannot reach GitHub. Click it for one plain sentence, the details and
  the one button that fits ("Push 2 commits", "Pull 3 commits", "Publish to
  GitHub", "Sign in to GitHub", "Save and push 4 files"), with "Last checked"
  and "Check now". Studio never commits for you: with uncommitted files the
  button opens **Save and push**, where you tick the files, edit the message and
  see anything it stopped (a private key, an `.env`, a file over 100 MB); it
  commits only what you ticked, never with `add -A` or `--no-verify`.
  **Publish to GitHub** creates a private repository named for the folder
  (public needs its name typed back), writes the `.gitignore` before the first
  commit and never replaces an existing `origin`. **Link to a repository** picks
  one from your own list and refuses a repository with a different history.
  Pushing the default branch still runs the project's own `npm run check` and
  the lost-work guard. Behind it: `scripts/git-link.cjs` (the states and rules),
  `scripts/git-actions.cjs` (the git and gh calls), `scripts/git-host.cjs` (one
  writer at a time, one model) and `renderer/git-sync.js`.
- **Start a new app on GitHub.** New app asks what should happen on GitHub: a
  private repository (the default once you are signed in), one you already
  have, or only this PC for now. The folder is made first and publishing is a
  separate step, so a failed publish never loses the folder; the chip shows what
  happened.
- **A quieter launch screen.** One **Open** button that never moves and a
  **Start agents** switch replace the two open buttons that swapped places. Rows
  show when each project was opened and its GitHub state (the chip arrives a
  moment after the list); a folder that has gone says so, keeps Open off and
  offers **Remove from list**; Enter or a double click opens a row; and **Open a
  folder…**, **Start a new app** and **Get from GitHub** sit at the foot. The
  loading card's spinner and progress bar no longer sit above the list.

- **The Windows app is called Studio, not Electron, and is ready to be
  signed.** The portable `Mefi Studio AI+.exe` now carries Studio's name,
  version, copyright and icon. Task Manager, the file's Properties and
  Windows' SmartScreen prompt stopped saying "Electron" by "GitHub, Inc.".
  The release workflow
  ([.github/workflows/release.yml](.github/workflows/release.yml)) now opens
  the packaged app once before it publishes anything, builds the tag it is
  given, has a gate that GitHub's own machines can pass, and signs through
  SignPath once the project is accepted and its settings are added. Until
  then releases stay unsigned. See [docs/code-signing.md](docs/code-signing.md).
- **Live › Fleet: every seat on your team, and the wires between them.** A
  new page beside Command shows the open project's team the way OpenRig draws a
  rig. An explorer lists it as pods (Lead, Build, Check, Keep) of seats such as
  `builder-2`, each with a status dot, and five views sit beside it. **Graph**
  is the branches: seat cards in columns, wired by why (a handoff, a
  delegation, a check, rework, a desk question, an ask that reaches you);
  drag to pan, wheel to zoom, **Fit** to see the whole team, and a team too
  big for the window still shows every name and state. **Table** is a row per
  seat, **Recent** is a feed of claims, handoffs, checks, asks, merges and
  kept branches with filters, **Tree** draws the team as a node tree, and
  **Health** lists what needs a look: a run quiet for ten minutes, an ask
  waiting fifteen, three tries at one task, a branch that was kept, an
  escalation, and the agents' loop holding ready work (with its own reason and
  button). Click a seat for its inspector: what it is doing now, the runs it
  has had (a retry goes back to the same seat), the wires in and out, and
  **Stop this run** (two presses, and only for the run you were looking at),
  **Open task** and **Open in Command**, which lands on its orb; the Command
  node tree is unchanged. The arrow keys walk the explorer, the graph and the
  feed, and Escape steps back. Studio only pushes updates while the page is open
  and the window is visible, keeps the seats per project, and sends nothing
  beyond clipped titles (no prompts, paths, keys or addresses). In a narrower
  window the inspector becomes a drawer under the tabs, and in the narrowest
  the page stacks, down to Studio's 600 px minimum.
- **A merge that drops another branch's work is caught before it is pushed.**
  On 2026-09-27 a merge kept one PC's copy of every file both sides had
  changed, and the next commit put the rest of the tree back to that copy:
  twelve commits of work left `main` with no conflict marker and no failing
  test. `npm run sync` now finds that shape (a path one side of a merge
  changed, where the tip holds exactly the other side's copy), and when 200 or
  more lines of the other side's work vanish it refuses to push and names the
  merge, the lines and the files. The session hook and Friends › Your PCs list
  recent ones without blocking. A deliberate choice is recorded in history
  with a `Lost-work-ok: <why>` line in the merge's message (or a later
  commit's); `--allow-lost-work` overrides one push. The generated booklet and
  TESTRUNS rows are exempt. Run against the real history it flags `65703a6`
  (136 files, 10,474 lines).
- **Configuration is the one index for agent setup.** Ctrl Shift , now also
  lists the setup helper's sections beside the settings they configure
  (Connect an AI, Team & models and Routing under Inference & Agents; How work
  runs, Permissions and Tools & skills under Files & Exec; Machine & app under
  Dev & Meta; Look under UI & Surfaces), each opening the helper at that
  section, and pins **Walk me through setup** at the head of Inference &
  Agents.

- **Sub-agents on the Command tree.** A session's sub-agent sessions now hang
  under it on the tree and in Command, the newest three busy in the last six
  hours, with "+n sub-agents" beside the parent for the rest. Each pops out
  of its parent and flies home into it when it leaves. A delegated part pops
  out of the task that handed it out and, once closed, flies straight home
  into that task instead of vanishing. Every flight home on the Command tree
  plays the node style's finish beat, as the Agent brain does. Sub-agents
  are not counted as sessions.

- **A calmer Task board.** The board opens straight on its tools: add a
  task, then search with the state picker beside it, then the All / Open /
  Review / Done chips as one compact row. The explanatory heading and the
  "cards in this view" paragraph are gone; the count line only says how many
  tasks the cards group when the two differ. Cards are tighter and open
  their current task when you click anywhere on them (the separate "Open
  current task" button is gone), the open card is ringed, and the task you
  are reading is highlighted in its list. Cards no longer wait below the
  tallest card in their row: each slides up into the free space under the
  card above it, and cards glide to their new place when a card's task
  list opens or the window resizes (not when motion is off). Task rows drop
  the ref and log counts. In the detail, **← All cards** closes the task at any width, the
  status box sits at the top of Details only, with a stage pill, the facts
  as fine print, the hold as a callout and a plain **Next** line (its
  redundant Home button is gone), the brief has a heading, and the
  "Readiness will refresh" filler and the repeated "Verifying: …" line no
  longer show.
- **Reach your PCs from Discord.** Friends › Your PCs › **Reach this PC from
  Discord** lets a DM with the Void Engine bot check on this PC and talk to
  Mefi here: `/studio status`, `needs`, `made` (what is being built and what
  finished today), `digest`, `pause`, `resume`, or just a message. Alerts come
  to your DMs when something needs you, a task stops or agents sit on work,
  with quiet hours and a daily digest. A message from Discord is your chat
  with less power: work it files waits for your OK in every permission mode,
  and it cannot approve, answer asks, undo or close cards, or change
  permissions, keys or settings. Approve buttons ask for a PIN you set here,
  in a Discord form that is never posted in the chat; five wrong PINs lock
  Discord approvals until you unlock them. Only your own Discord account is
  answered, no port opens on your PC, and everything sent is scrubbed of
  keys, paths, emails and addresses first. It needs a rooms hub with the
  remote turned on ([docs/remote.md](docs/remote.md)).

- **Studio opens in Vibe.** Every launch starts in Vibe, even if you closed
  Studio in Build. A reload during a live update still comes back where you
  were. Settings › Always start in Vibe turns this off. The Start here walk
  no longer switches you to Build: its project, task and review stops use
  Vibe's own project menu, box and Tasks panel.
- **More of what needs you, answered in Vibe.** Results waiting on a slow
  check can be confirmed or sent back from the Needs you drawer. When a plan's
  interview asks you something, you answer it in the drawer. Plans waiting
  for approval or for their tasks to be created are listed too, and open on
  the plan page inside Vibe. Cards held because work outside Studio may
  already cover them offer Build it anyway. A waiting update shows in
  Vibe's top bar, which used to hide it.
- **A new project's tree.** Watch stays in Vibe's dock from the first
  minute, not only while agents work. Watch on a project with nothing on
  its board shows its root, plus a small card with Start the first task and
  Plan an idea.
- **Key tips and Vibe keys.** First-time users see small pop-ups beside
  buttons with the key that does the same thing, as keycaps. Click one, or
  press its key, and it fades away for good. Use Turn tips off on a tip, the
  Settings or Vibe settings switch, or Search to turn them off. Show key tips
  again brings them back. On Vibe's page, outside the box: / types in the
  box, N opens what needs you, C the conversation, T tasks, P plans, I ideas,
  M the team and S settings. The dock and the box show their keys, and ? lists
  them.
- **Start with Windows.** Settings › General › Profile & startup (and the
  setup helper's Machine & app) has a **Start with Windows** switch. Studio
  then opens in the tray when you sign in, on the project you had open,
  without the launch screen's question, and the agents follow **When Studio
  opens**. A PC you leave working keeps working after an update restart. The
  switch shows what Windows really holds, including Task Manager › Startup
  apps turning Studio off, and Studio points the entry at its own folder
  again if the app moved. With the tray off, a login launch opens minimized
  instead.
- **Your PCs shows what each PC's agents are doing.** Each PC's line in
  Friends › Your PCs › Share between my PCs now says what its agents are
  building (or why they are not), how many things wait for you there, and
  what finished or stopped today, for example "Working on Add the login
  page · 1 needs you · 4 done today". The line travels sealed in the vault
  like the rest, holds only clipped titles and counts, and is refreshed when
  the agents' work changes, at most every ten minutes.
- **The model tracker is current again.** Models › Catalog has the new
  OpenCode Go models (GPT 6 Luna, Grok 4.7, MiMo V2.6 Flash and Pro, LongCat
  2.5 preview, Space Bunny) with verdicts that say when no benchmark is
  published, fixes verdicts the newer models made wrong, and lists the Claude,
  Zen and z.ai models Studio routes to under **Also tracked**.
- **What the community says about a model, and Studio's own probes.** Models ›
  Performance › **Community** shows the Void Engine community's ratings,
  release-note claims, observed strengths and weaknesses, tips and a link to
  the model's Discord thread, from a public feed Studio reads at most every
  six hours (Refresh reads it now). **Run probes** gives the model seven
  small fixed tasks (planning, structuring, coding, writing, commits, tests,
  setup) scored by fixed checks; they run only when you click, cost like any
  call on that model and show under Usage. Model picks lean on both only a
  little, and never on opinions: your verified task results still decide.
- **Answered asks leave the Needs you list.** An ask you answered in the
  companion menu used to stay on screen after it closed (the count already
  lower), and clicking it again only said "That question is no longer
  waiting" until Clear list moved focus away. It now leaves as soon as it is
  handled, a second click while the first is on its way is ignored, and the
  keyboard moves on to the next item.
- **No dead asks after a restart.** Asks past their age (two days by
  default) and asks whose card left the board while Studio was closed or
  another project was open are closed when the project loads, not on your
  click. The all-projects list leaves other projects' expired asks out.
- **Every node style finishes in its own way.** In the Agent brain, a step
  whose work came back and the lead taking its agent in now play the chosen
  style's own beat: Classic orbs' ring bursts, Soft glass ripples like a drop
  on water, Minimal draws a check, Halo flares and slips its ring over the
  lead, Crystal glints across its facets, Singularity's disc flares and the
  agent spirals in, Prism shatters and fuses back from six angles, and
  Sigil's rune writes itself shut and stamps the lead. A failed check
  finishes in amber. With reduced motion on, the Agent brain plays no beats.
  The Agent brain's pipeline list no longer cuts long titles off on the left
  or squeezes its rows together, the Playbook shelf keeps its books in tight
  rows, and the feed no longer says nothing happened on a task that finished
  steps before Studio opened.
- **Watch Mefi think, and watch your team work.** In Vibe, **Suggest a next
  step** and **Build it** no longer wait behind one still sentence. Each shows
  a live strip: the stage it has reached (reading the project, thinking,
  planning the steps), the files it read or the steps it planned as they
  arrive, which model is thinking, and a clock against how long it usually
  takes on this PC. A split request's plan card draws its steps as a track
  to the final check and names the step being built, its agent's tool and
  what it is doing now. **Building now** rows and the plan panel's new
  timeline show the same, and **Team** lists what Mefi is thinking about.
  Build it's messages now show just under the box instead of below the
  suggestions.
- **Suggestions stay usable.** Adding one suggestion to your draft no longer
  locks the others, a built draft leaves the rest ready for the next one, and
  **Clear** puts a set away. The plan panel's **Make it one task** is now the
  same single action as the drawer's; dropping steps one at a time was
  refused for a step another one waits on. Pressing Enter in a New app field
  now shows "Making it…" and its first build being sized.
- **Menus say what they mean.** Vibe › Tasks counts the same Needs you list
  it shows. Trace's chips no longer read "All undefined" and keep keyboard
  focus while Follow updates them. Performance, Usage and Context each have
  their own subtitle, and "Not reported" replaces the Unknown/Unknown cells.
  Sessions, Activity, Tasks, Ideas, Plans and the Catalog leave out a value
  the store did not record instead of printing "?", "undefined" or "Invalid
  Date". Errors read as sentences instead of "Cannot read properties of
  undefined". After deleting a preset, Agents says "Preset deleted.".
- **Actions that can't be undone ask twice.** Closing, leaving or deleting in
  Rooms, removing keys or a library item in Your PCs, stopping Listen together
  for everyone, removing a key or deleting a team in Setup, stopping a worker
  or dropping a task in Vibe, Stop all, Restart and killing a run in Sessions,
  Forget all in Why/Undo, and deleting a preset, a draft or a recipe share
  one two-step button: the first press asks, the second acts.
- **Calmer, steadier menus.** The companion hub and panel open and close with
  the shared motion tokens and an SVG close. Lists that rebuild (Vibe's
  panels, the music queue, Rooms, Your PCs) keep their rows in place. The
  Why/Undo panel keeps focus and an open menu when it repaints, and
  Configuration keeps Tab inside its dialog. Several dark leftovers (sheet
  links, Activity text, Model Lab, Vibe shadows, Brain map scrims) now follow
  light palettes.
- **M+ opens Projects on the selected project.** Keyboard focus lands on the
  project you are in, or Add project when none is available.
- **A first run with no AI connected says so.** Home, Vibe and the agents'
  status read "No AI connected" with **Connect an AI** instead of "Waiting for
  you", and the held switch reads "Agents off". With no coding tool installed,
  Start agents no longer burns five tries on "'opencode' is not recognized";
  it says to install OpenCode, Claude Code or Codex. A run that fails that way
  reads "x is not installed or not on PATH".
- **Talk it over talks.** Vibe's Talk it over no longer files a task from "Add
  a search box". The reply offers the board instead, and says plainly when no
  AI is connected. Replies no longer mention "the foreman".
- **Setup finds the login you have.** Setup opens on Quick setup, leads Connect
  an AI with **Set up automatically** and **Start free with OpenCode**, and
  marks a coding tool that is installed but not signed in. Such a tool no
  longer counts as a connected AI until it signs in or passes its check, and
  automatic setup picks a signed-in Claude Code, Codex, Grok or Antigravity
  login first (Claude Code, then Codex, when none says). Saving a key keeps
  its confirmation and your place on the page.
- **One welcome at a time.** Closing the setup helper leaves the guided tour
  waiting in Start here, with a toast to start it, instead of opening a
  second welcome sheet. The keyboard tip waits until nothing has been open
  for 30 seconds. With no project yet, the launch screen leads with **Open a
  folder…**.
- **Set up this PC's setup windows open again.** Install Git, the GitHub
  CLI or Node.js, Sign in to GitHub and Install packages started a
  PowerShell window that closed before it ran, while Studio said "Finish in
  the setup window". They now open attached, like CLI setup.
- **A share the review cannot read to the end is blocked.** A `.mefishare`
  padded with thousands of empty strings or deep nesting could hide an
  instruction to your agents past the point the review stops reading. Such an
  item is now blocked as "more text or deeper nesting than Studio checks".
- **A friend's preferences cannot change your permissions.** A friend's
  `.mefishare` now carries only how agents behave and learn (learning,
  habits, efforts, subtasks). Preferences from your other PCs are checked like
  the Settings controls that write them, and an ask that needs your
  confirmation to switch off stays on.
- **Approvals survive the references gathered after them.** Approving a new
  task before its automatic file, session and context references landed no
  longer drops the approval or a named Start as "the brief changed".
- **Rooms show the right room.** Opening one room right after another no
  longer shows the first one's chat (or reports and deletes its messages).
  Leaving a room in Rooms no longer stops Listen together, and the reverse.
  A new message or room update keeps what you were typing, the room name and
  a report reason. The Friends badge counts invites while Friends is closed.
- **The media player takes focus only when you minimize it.** Switching to
  Radio, Background or a restored layout no longer pulls keyboard focus into a
  player that is about to hide.
- **The loop status follows a project switch.** Home, Vibe and the tray count
  the new project's board at once, instead of saying "2 tasks need your OK"
  about the old one until the next board change.
- **"What changed while I was away?" is more careful.** Without a key, a card
  matched only by file and commit names now says it "may already be done",
  as its Ask card does, and a task like "When the user logs out, clear the
  cache" is no longer answered with the away report.
- **Your PCs is more exact about what is only on this PC.** A file whose only
  difference is line endings Git would undo no longer counts as uncommitted
  work, and a branch whose commits are all on GitHub already (on another
  branch or gh-pages) is no longer listed as this PC's alone. The look never
  takes Git's optional lock inside a worktree an agent is using.
- **Share between my PCs keeps every PC's evidence.** Model results, what
  Mefi learned and preferences are kept per PC, so the owner's PCs no longer
  overwrite each other's and a third PC sees them all; the older shared
  files are still read. Vault calls take turns, so a status line landing
  during a share no longer rolls the share back while saying it was sent. A
  change is only dropped when another PC changed the same thing at the same
  moment, and the vault then says which. A failed pairing or a vault that
  could not be made the first time no longer blocks the next try.
- **Share with friends saves what was previewed.** Picking another item or
  kind clears the preview, and Save writes exactly the item shown. Changing
  the shelf in Share between my PCs clears the lists read from the old one.
- **More than one Claude Code or Codex login.** Setup › Connect an AI › **More
  than one login** adds a second (up to a sixth) subscription login for
  Claude Code or Codex: Studio makes the login its own folder, opens the
  sign-in window there, and hands the folder to the CLI as `CLAUDE_CONFIG_DIR`
  or `CODEX_HOME`. Work fills the first login that is not topped out. When one
  reports its usage limit, it is set aside until the reset its message or its
  usage reading names: an assistant call asks the next login at once, and a
  coding worker's card goes straight back to the queue for it, uncharged and
  with no outage backoff. Other providers answer only once every login is
  topped out, and only through the fallbacks already allowed; otherwise the
  workers wait for the first reset and say so. Each login gets its own row
  in Usage › Provider accounts, the limit marks survive a restart, and a
  Claude Code login shares the main login's `projects/` (sessions and memory)
  through a link that removing the login never deletes through.
- **Agents on several PCs never edit the same file at once.** Link a cowork
  room to a project (Friends › Rooms, open the room, **Use this room for this
  project's agents**). Before a builder starts, Studio claims the files it will
  edit in that room; every PC hears it within a second, and a task whose files
  another PC holds waits and picks other work. A run that did its work keeps
  its claim until this PC pushes (or 30 minutes), so the other PCs only edit
  those files once they can pull the change. The room lists what is claimed
  and by which PC. With no room, hub or Discord link, nothing waits.
- **Keep this PC up to date** (Friends › Your PCs, on by default). Studio asks
  GitHub once a minute whether another PC pushed, looks when one did, and
  brings the work in with a fast-forward when this PC has nothing of its own
  in the way and no builder is running. Other PCs' work arrives within about a
  minute instead of at the next 15-minute look.
- **Set up this PC** also lists what links this PC: the vault, the link app ID,
  the Discord link and the rooms hub, each with a button to the place that
  finishes it. A hub that names its link app fills in the link app ID from its
  address alone. Every room now says that Void Engine moderators can read it.

- **Discord linking and Rooms without environment variables.** Settings ›
  Community › **Connection details** takes the Mefi Studio Link Application
  ID and the rooms hub's address once per PC, saves them in settings and uses
  them at once: Link my Discord appears, and Rooms, Friends and Listen
  together reach the hub without `setx` or a restart. Save says whether the
  hub answered. The environment variables still win for test setups, and
  every "not connected yet" message now says where to add the missing value.
- **Share between my PCs no longer gets stuck.** A PC whose push lost the
  race to another PC's status line kept its change unsent and then could
  neither send nor receive anything, so the other PCs got nothing. The vault
  now puts this PC's commits on top of GitHub's and sends them again; when
  two PCs change the same item at the same moment, GitHub's version is kept
  and the PC is told. Keys and setup opened while the vault is still loading
  gets its list instead of staying empty, a phrase that does not match says
  why Share stays off, and a finished share says where the other PC picks
  the keys up.
- **Agents say why they are not working.** The host now sends one answer
  (`scripts/loop-status.cjs`) with every status push. It covers whether
  agents are on, what is holding work back, and the one control that clears
  it. It names the launch hold, a pause, a stopped executor, a worker-start
  cooldown, an update drain, a stuck scheduler, no open project, tasks
  waiting for your OK (and which permission mode holds them), and tasks that
  need review. Home, Vibe, the Command header, the Agents switches, the task
  page and the chat assistant all read it, instead of five separate
  re-derivations that disagreed. The worst case was "Allow new work"
  reading On while nothing could start. A ready task that will not start
  says why instead of "Start this task when you are ready". A task that
  shares its title with a running worker says it is waiting for that worker.
  The free coding model's one-at-a-time limit now shows as the reason
  instead of "nothing ready".
- **Approvals are no longer cancelled silently.** Approving a new task before
  its automatic references finished gathering used to drop the approval
  without a word. Gathered file, session and context references (now stamped
  `auto`) no longer count as reviewed scope, while web references and anything
  you or a planner wrote still do. Existing approvals hash exactly as before.
  An approval that is cleared because the brief really changed now says so in
  the task's log.
- **Permission modes keep their meaning.** The old Auto build switch (brain
  maps, older screens) used to overwrite the permission mode with Auto or
  Always ask, so Elevated became Auto and Accept per task became Always ask.
  It now only moves Always ask and Accept per task up to Auto, or Auto and
  Elevated down to Always ask. Activating a brain map changes the permission
  mode and New work only when its confirm list shows them moving. Each mode's
  description now says what happens to a new task, for example "Every new
  task, yours too, waits for your OK".
- **When Studio opens.** A new setting in Settings › General › Profile &
  startup: **Resume what I had** (default), **Start agents** or **Keep agents
  off**. The launch screen's default button follows it. With Resume, a
  project whose agents were running when you closed Studio opens with them
  running; **Open with agents off** is still one click away.
- **No more surprise jump to Command view.** After five quiet minutes Studio
  used to switch to Command view by itself. That is now a switch, **Show
  Command view after 5 quiet minutes**, and it is off by default.
- Vibe's worker limit offers only what the host honours (1, 2, 3 or
  Automatic). 4, 6 and 8 used to be clamped to 3 silently. The "deferred"
  stage reads **Scheduled for later** and shows its reason on the board.
- **Friends across PCs.** With the rooms hub's companion relay, companions on
  different PCs and Discord accounts meet in an open room and play;
  `docs/friends-setup.md` sets up the hub and each PC, and
  `tests/companion_e2e.test.mjs` runs three accounts through the real hub
  (make a room, ask, let in, share rules, a mirrored playdate, stay home).
  Friends says which step is missing (connect, open a room).
- **Share between my PCs** (Friends › Your PCs). One private GitHub
  repository, `<you>/mefi-studio-vault`, carries what you choose between
  your own PCs, sealed with AES-256-GCM under a key only your paired PCs
  hold; the first PC makes it and shows a pairing code, and each other PC
  types it. Shelves: how models did by kind of task, decisions Studio
  learned from, team setups, brains, Playbook recipes, Claude Code memory
  notes, preferences without keys or addresses, and open tasks and ideas.
  Every item is checked going out (keys, tokens, passwords and logins in
  links stop it; paths, names, emails and addresses are removed) and again
  coming in, where instructions aimed at an agent, downloaded scripts and
  paste or webhook hosts keep it out. Received items are added beside yours
  and never overwrite; kept model results and decisions count as another
  PC's experience until you remove them. Keys and setup need the exact typed
  confirmation under a warning that they can be stolen, then a native
  prompt, and land straight in protected storage. Each PC's line shows when
  it last synced and what waits on it.
- **Share with friends**: one brain, recipe, team setup, set of model
  results, memory note or preferences in a `.mefishare` file, scrubbed and
  previewed before you save it; a friend's file is reviewed before it can go
  to your library, and a risky one is kept out.

- **Setup helper**: one menu for every setting that decides what the agents
  do. It opens first on a new install, and once after updating to this
  version: Connect an AI (subscription logins, API keys, LM Studio and custom
  endpoints, automatic setup), Team & models (every role, the coding worker
  and its tier, subtask builders, all five seats, saved teams), Routing (Jev
  or fixed, the Automatic order, subscription logins first, fallback, Jev's
  route and key), How work runs (new work, the queue on its own, pass
  interval, workers at once, coordination, reporting, delegation, backlog
  mode, roster and housekeeping), Permissions, per-agent Tools & skills,
  Machine & app (keep awake, tray, resource limits, updates, companion,
  GitHub token) and Look. Quick setup is three steps; Search reaches every
  section. Every control saves through the host call its setting already had.
  The Start here walkthrough follows it, skips its scan when an AI is already
  connected, and switches Vibe to Build before pointing at Home's controls.
- Settings that saved but did nothing now work: saving an LM Studio or custom
  endpoint no longer copies the project off the Studio defaults (so an open
  team draft no longer fails as stale); activating a brain map no longer
  writes a model selection that the next team save refused; "Work through
  the backlog" can be stopped; the Jev gate preview reads Jev as on when it
  is; `machine:set` keeps only the resource manager's fields, range-checked.
  The Agents "desk handles asks" switch, which nothing read, is gone from the
  helper: the permission mode decides that.

- **Media controls stay within reach.** Floating players now have a move handle,
  Settings, minimize and close buttons, and minimize to a visible restore bar.
  The media menu opens at the video, websites get the full panel width, and
  scrolling or overlapping notifications no longer blank the built-in browser.
- **Build on your app with MEFI.** Vibe offers Modify, Experiment, Fix and
  Improve, contextual briefs from the map, and suggestions that can be added
  to a draft or saved as ideas. Saving a suggestion does not start work.
- **A map that shows relationships.** Connected system cards show observed
  co-changes, parts and files. The separate Ideas tree groups ideas and tasks
  by system and progress, keeps their lineage, and reorganizes as agents
  discover files and work advances.
- **Asking what changed while you were away works without a model.** The
  chat answers from the report of work done outside Studio. A card that only
  matched on files and commit subjects now says "may already be done" on its
  hold, its Evidence tab and the thread, as its Ask card already did.
- First-time setup and agent choice. **Install**: `npm ci` fetches the
  Electron binary again (Electron 44 stopped doing it), the launcher fetches
  it itself when missing, `npm ci` stops on a Node older than 24, and
  `npm test` finds Python 3 as `python`, `py -3` or `python3`. The test
  runner works from deep folders (Windows' command-line limit). **Any
  builder**: Claude Code, Codex, Grok and Antigravity builds are verified by
  Studio's own checks instead of always parking as "retry it on OpenCode";
  npm-installed Grok and Antigravity start; a run that fails after working is
  no longer re-run from scratch on OpenCode (and never when OpenCode isn't
  installed); "Try again with a heavier model" runs the Heavy-tier model and
  is only offered where one exists; Codex builders get Studio's tools; tools
  stay attached when the temp path has a space or apostrophe. **Any AI
  route**: Auto with only a CLI login counts as connected; a saved OpenRouter,
  Zen or custom key works on Auto without editing the order; auto setup
  recognises Zen and a local Ollama; the custom endpoint key is optional; the
  Auditor, scout, music suggestions and brain drafts no longer need a z.ai,
  OpenCode Go or Zen key; errors keep the real reason; LM Studio only shows
  ready when it is running with a model. **Start here**: no folder is no
  longer "project selected"; Scan and First map offer an API-key or
  local-server path; Vibe-mode walks use Vibe's box and Tasks panel; closing
  a setup window refreshes the tools; the setup window finds per-user
  install folders; setups save to Studio defaults so later folders keep the
  route. Settings hides the Server Styler card until its checkout exists. The
  docs give the PowerShell headless key form and say what source and
  portable installs share.
- **Friends › Rooms.** The room service's rooms, requests and invites in
  Studio. Browse your rooms and the listed ones, ask to join with a note, and
  cancel a request. Accept or decline invites. Let requesters in or decline
  them, invite people by name, lock or close rooms you own, and make new ones.
  Each room has its chat: plain text with @names, links never made
  clickable, and a message that did not go through kept with the reason.
  Waiting invites and requests are counted on the Friends badge. The hub
  client checks every argument against the hub protocol before it leaves,
  and main allows only a fixed list of room calls.
- **The companion as a pet and a friend.** Its menu is six bubbles with one
  job each: Talk (with three one-tap starters), What I'm doing (the work, the
  team and recent activity together), Needs you, Suggest work (your idea to
  the inbox, or one of its next picks with Work on it), Friends and
  Personality. **Personality** is Straight work, Balanced or Friendly &
  expressive: it sets faces, idle play and roaming, and chat replies follow
  its manner without doing anything differently. Stroke it to pet it; it
  remembers days together, pets and playdates, and with idle play on it
  fidgets and dozes. **Friends › Playground** lets companions in the same room
  meet and play short scripted playdates, like toys that linked up, with a
  practice buddy on this PC. Nothing about you or your work is shared until you
  allow it, for everyone, a room or a friend, this session or always; a friend
  sharing more makes it ask, and What was sent lists every card that left.
  Playdates with friends need the rooms hub to relay `companion` frames
  (docs/community.md).
- Second bug-hunt pass over the newest features. **Guided CLI setup** opens
  its terminal again (a detached PowerShell never ran its script), and the
  **release updater**'s install helper now actually runs after Studio exits.
  The **built-in browser** keeps playing when a dropped file or link is
  refused, and embedded players may load their own blob/data frames.
  **Vibe**: the Needs you drawer recovers after a project switch mid-action,
  typed answers and task notes survive repaints and failed saves, and the
  Team panel shows the current project's agents. **Agents setup** reloads
  after settings change elsewhere instead of ignoring edits and Apply. The
  **walkthrough** puts its suggested task in the right box without
  overwriting your chat draft, and Escape closes a menu the coach opened
  before the coach. **Autonomy**: a split card is no longer left waiting on
  an Undo that finished, a card with a queued undo no longer floods the
  decision history, Elevated holds a card only after two decisions applied,
  and a failed decision can't be undone.
- **Set up this PC** (Friends › Your PCs). A checklist of what a PC needs to
  share projects through GitHub: Git, the GitHub CLI, Node.js, a GitHub
  sign-in (in the browser; Studio never sees a token), and for the open
  project a GitHub remote, installed packages and a drive that can hold Git
  worktrees. Each gap has a button that opens a visible setup window running
  Studio's own command. **Get a project from GitHub** clones one of your own
  repositories into a folder you pick, refuses exFAT and FAT drives, and opens
  it.
- **Configuration** (Ctrl Shift ,, and **All settings in one place** under
  Settings' categories): every setting Studio has, in one searchable tree
  filed under Inference & Agents, Knowledge, Files & Exec, Web & Community,
  Storage, UI & Surfaces and Dev & Meta. It reads the same records Search
  lists, so picking a setting opens its real control; nothing is copied.
  UI & Surfaces also holds a new **Interface scale** (70% to 150%), saved and
  put back on every launch. Settings are filed by the page they live on
  (Appearance's Zen mode is a look, not a Zen key), a lone Save or a second
  copy of a picker is left out, and choice buttons are named by their bold
  part in Search too ("Full", not "Fullevery animation").
- **Menus move cleanly.** Vibe's cards, panels, conversation and dock, and
  Build's Configuration, Trace and Habits, no longer replay every row on
  each refresh: a row that stays keeps still and glides to its new place, a
  new one rises (cascading when several arrive), and one that leaves fades
  where it was. Moving into a task's detail slides in from the right and Back
  slides it out; switching panels or categories fades through instead of
  overlapping. The open panel's dock stop, the current Configuration
  category and the open Trace channel each wear one mark that springs from
  item to item; dock stops fold open and shut so the others slide over; the
  permissions menu rises from its chip in Vibe's own colours and closes on a
  click elsewhere; Off / Brief / Full slides one thumb and the habit total
  counts to its new value. Reduced motion and the Motion setting turn it
  all off.
- **Habits** in each agent's Skills, tools & habits panel (Agents › Setup):
  short rules of behaviour, such as explaining changes, testing, small
  steps, matching the code around it, report shape and a to-do list, each
  with its variants and **off / brief / full**, and what the agent's habits
  add to every prompt in tokens. They reach every prompt the agent's skills
  reach and ride its team like its skills.
- Multi-PC sync holds up better. **Sync this PC** and `npm run sync` push
  only after the project's own `npm run check` passes. **Put my commits on
  top of GitHub's** rebases diverged work when nothing is uncommitted, and
  changes nothing on a conflict. The **Friends bubble badges** work this PC
  alone holds, from a look 45 seconds after launch and every 15 minutes.
  **Closing Studio asks first** when the open project has such work. A fetch
  that fails for a reason other than the network (a lapsed sign-in, a renamed
  repository) is now shown as a problem instead of passing as offline. A Git
  `merge.autoStash` or `rebase.autoStash` setting can no longer move live
  edits during a sync.

## [0.4.4] - 2026-09-27

- **The Void collection is free.** Its four themes and three node styles sit
  beside the others in Appearance and save like any other choice. Linking
  Discord is still optional and only joins you to the community.
- Studio no longer stops at launch on a leftover theme-lock call in the
  music module.
- **Work done outside Studio.** Studio now keeps a last look at each project
  folder while it watches it, and when you open the folder again it reports
  what changed meanwhile: commits, uncommitted edits, and Claude Code, Codex
  or OpenCode sessions run in the folder. The thread, the chat assistant ("what
  did I do while Studio was closed?") and the welcome-back digest all see it.
  When the code changed, every queued card is checked against that work
  before a worker takes it.
  Cards that are still needed run as before; partly done ones run with their
  worker told what changed; cards that look already done or no longer needed
  wait in Needs you with Mark it done, Drop it or Build it anyway. Only you
  answer those, in every permission mode. Without a model the check matches
  files and commit subjects and only says "may already be done".
- The verification settle timer reads the clock once, so it is always armed
  for the moment asked for (a flaky `verification_drain` test under load).

- Bug-hunt fixes across the host, tooling and renderer.
  **Project switches** no longer write one project's assistant state, reply
  or verification result into another. **Stop all** no longer re-runs a reply
  that finished anyway, and one Ask answer can't apply twice. **Torn store
  files** with multi-field records are salvaged instead of reset. **Updates**:
  the Update button can't start a second download, "Updated to vX" is no
  longer re-announced on every restart, installed apps receive the new model
  catalog, and release zips carry no local data. MCP servers
  configured as `npx` (a `.cmd` shim) start on Windows. **Privacy**: tool
  transcripts and scout payloads are redacted before JSON-escaping, and
  `Authorization: Bearer` tokens are masked. **Work tracking**: hung LÖVE test
  runs are recognised on Windows again; board file refs schedule their focused
  tests; delegated tasks' relative file scopes keep their files; quoted and
  non-ASCII git paths are read correctly; a worker's worktree edits are no
  longer blamed on the main tree; evidence scopes match file names in any
  case on Windows. **Screens**: a typed Ask answer survives the rail
  repainting; Enter on a task row's Mark done marks it done; evidence images
  under `#` or `?` folders load; Trace, Usage and Model Lab recover after a
  mid-read switch; model catalog text is escaped; Home work cards show their
  status stripe again; Settings switches and the autonomy controls follow the
  theme; focused fields show one focus ring. Only one LÖVE launcher run can
  be open at a time, and stopping Server Styler during setup is a stop, not
  an "install failed". `check-syntax` now checks renderer files as the classic
  scripts the booklet runs them as.
- A pass over the node tree. **Wires**: Command drew every connection past
  the (hidden) assistant hub to the wrong node and dropped the last one, and
  the Branches/Terraces layouts spaced by the same wrong parents; wires and
  branch parents now follow the drawn nodes. **Layout**: live additions in 3D
  Overview no longer shrink the tree step by step; crowded trees (90+ nodes)
  share the room instead of stacking overflow nodes on one point; a resize
  waits until the window holds still and then re-lays the tree out under the
  view it was first laid out in, so a turned or zoomed tree keeps its shape
  instead of jumping; Fit keeps the reach it measured while the layout holds,
  so work arriving far out no longer shrinks a settled tree when a panel
  moves; the paused Overview grows back
  after work leaves; the Overview's drift folds away when you click a node or
  Follow; live shapes ease back on interaction instead of snapping, and
  workers or finishing nodes no longer reshuffle ring slots, and a finishing
  node lands on its host where the shape draws it. **Graph**: a
  builder keeps one orb for its whole run (no second pop when its session is
  found); a project switch no longer flies the old project's tasks into the
  new hub or pops its whole backlog; stale task and store reads that land
  after a switch are dropped; the assistant's own chores no longer take the
  owner's twelve task slots; finished tasks stop reserving layout slots;
  session progress counts every todo, not only the drawn ones; the rail and
  Command stay in step after each rail rebuild; a job matches its session the
  way Work on it does, and agents can fly to approved-plan groups.
  **Interaction**: the wheel and a two-finger pinch zoom toward the pointer;
  touch and pen drag, tap and focus like the mouse; a click lands on the node
  as it is after a rebuild; arrow keys stay with the card while it has focus;
  hover follows a spinning tree; double-clicking a
  callout opens it; arrow keys reach task groups and skip sunk work; the rail
  picks the nearest node; a finished task's card offers only Open in Tasks and
  Done can't send twice; the card keeps focus, notes and open folds across
  pushes and updates when its node changes; card rows are keyboard links;
  screen readers hear one line per selection instead of whole cards; the exit
  button is labelled Close like every other. **Music**: a band far below the
  loudest one (spill, such as a snare's click in the bass) is no longer
  scaled up into a hit of its own, so drum cues stop firing on each other.
  **Cost**: a resting Command sleeps between its ten frames a second instead
  of waking on every display refresh; music frames stop allocating per wire
  and node; the nebula, bokeh and firefly skies reuse their gradients; each
  node is projected once less per frame; long callout titles no longer flush the text cache every frame,
  the label grid is built once per frame, a frame that throws no longer
  leaves the canvas clipped, the rail stops animating under Vibe and skips
  rebuilds when a push changes nothing, stars and backdrop colours are
  cached, and the Zen tour fits with far fewer projections. Overhead keeps
  polling after a failed read, counts tasks awaiting verification, and both
  it and the rail re-render after a display-scale change.

- Hints and docs point to where settings live now: Jev and providers under
  **Agents › Setup › Providers**, build approval under **Agents › Setup › Run
  behavior**. "Model Lab" leftovers read **Performance** or **Usage**, the
  launch switch says **Open Home on launch**, and a sheet opened from Home
  offers **Back to Home**.

- A polish pass on long-untouched menus. **Search Studio** names Settings
  choices properly ("Motion › Full", "Node style › Classic orbs") instead of
  running their words together. **Analyzer** never leaves Findings or
  Evidence blank, uses sentence-case tags and real plurals. **Activity &
  evidence** has readable filters and inspector labels, theme-coloured pins
  and a keyboard-reachable Remove per pin (a click on a pin row no longer
  deletes it). **Feature ideas** shows each idea's title, source and state,
  asks before Delete, and its graph follows the active theme. The
  **Performance profiler** shows "—" for Long tasks until a capture runs,
  marks over-budget frames and readings, and uses the standard Close button.

- Command's canvases use transferred drawing contexts where supported,
  avoiding document style updates while setting callout fonts. Resize,
  transparency and the ordinary canvas fallback are retained.

- Music & video puts the player, background toggle and saved video queue in
  one panel. The queue sits beside playback on wide windows and below it on
  smaller screens, with audio setup options tucked underneath.

- Music & video browses web links inside its existing player, with an address
  bar, navigation, mute, minimize and close controls. Website popup links stay
  in that same player. The music menu adds a listening-room layout and record
  artwork, with clearer local playback, radio and link controls.

- Shared scroll controls batch geometry reads before updating their arrows,
  reducing repeated style calculations during live activity.

- Update's **Restart now** stops coding agents, saves their latest work for
  continuation, and relaunches Studio paused instead of waiting for builds to finish.

- Background video keeps a stronger reading tint under pages, navigation and
  menus. Zero Glass intensity makes reading surfaces solid. Narrow Agent
  routing fields and Ideas tools fit the viewport, and sticky Settings
  categories stay below the top navigation without showing text through them.

- Auto starts agent-proposed tasks without a separate approval. Routine test
  and archive conflicts stay actionable, and missing CLI verification evidence
  permits a bounded repair or rerun instead of an owner-only dead end.

- Changing an AI route or credential releases the previous provider's retry
  backoff. The offline warning stays until a request actually succeeds.

- Chat composers use native content sizing when supported, avoiding repeated
  height measurements during status updates and following width/font changes.

- Home's controls sit below the navigation bar. Trace is available under
  Agents > Live with a full page and Back navigation, and Pipelines, Playbook
  and Project map update the selected navigation view after loading.

- Failed assistant CLI processes no longer turn partial output into successful
  briefs or queue requests from that output.

- Assistant thinking updates retain the existing chat bubbles and text
  selection, reducing DOM work while replies are being prepared.

- Claude connection errors show the actual quota or login message instead of
  "claude error: success". A successful AI reply also clears the offline warning.

- **Trace** (Live, beside Activity): Studio's logs as channels in one viewer.
  The studio log, the assistant's log, the run ledger, OpenCode's log and
  the window's own warnings, each with its size and problem count; search,
  a tail of 100 to 2000 lines, level chips (errors, warnings, info) and
  source chips with counts, problems only, follow, newest first or last,
  copy and open the file. The studio log and the window's warnings are now
  kept in bounded rings so they can be read back.

- Mefi's permission chip, elevated switches and learning controls now share
  one saved state across Vibe, companion settings, Agents and the palette.
  Vibe shows automatic decisions with Why/Undo, human to-dos, suggestions,
  inline offers and confirmations, and the accepted-task approval label.
  One-line answers collect text; delayed errors stay on their item; unread
  dots follow message IDs; dispatch messages report actual holds and pauses.
  Approval families share one Needs you count. Elevated budget exhaustion
  records a durable, undoable hold without spending a third settle.

- Chat and the desk now share recent decision reasons, pending to-dos, learned
  preferences, task desk answers and the owner's recent messages. Named chat
  approvals follow the permission mode and saved task scope; immediate chat
  confirmations, suggested answers, Undo and exact inbox promotion use the
  existing host actions. Refusals appear in the reply. OpenRouter and local
  companion seats also clear the outer model availability gate.

- Vibe Tasks gains List/Lanes, live queue counts, pause/resume and worker limits.
  Its Inspector saves task priority, estimates, acceptance checks and deferral
  dates, with revision checks and the same dispatch and approval gates.

### Added
- Guided CLI installation, sign-in and connection checks in Start here, including recovery at First map. A single Codex, Claude Code, Grok or Antigravity subscription can route the assistant, mapping, planning, agent seats, coding and subtasks through its own account.
- Multi-PC sync. **Friends › Your PCs** shows whether this PC matches the open project's default branch on GitHub and lists work that has not reached it. **Sync this PC** pulls and pushes that branch without force. `npm run sync` does the same from a terminal, and a Claude Code SessionStart hook fetches, fast-forwards and reports at the start of each new session.
- Mefi learns from successful owner answers, including family choices, approvals,
  offers and chat. Recent choices count more, corrections count double, and
  learning can be disabled or forgotten by project or across projects. Auto
  leaves choices that disagree with a strong preference for owner review.
- Model outcomes now retain their project. Learned routing supports this
  project, all projects, a default 30% cross-project blend, or off. Existing
  local ledgers are read in place; old unscoped records remain global evidence.
- Four saved permission modes: Always ask, Accept per task, Auto (default),
  and Elevated only. Six elevated categories keep their decisions with the
  owner unless switched off; grants and irreversible changes require the
  warning acknowledgement. Agent-filed tasks wait for approval by default.
- Automatic answers have a bounded decision history with reasons and Undo.
  Undo waits for a running worker and preserves later edits and daily budgets.
  Real-world leftovers become a short For you list. Task reservations keep
  work from starting until the decision and its undo evidence are saved.
- "Mefi sizes it": **Build it** in Vibe asks whether a request is one task.
  A short, single change goes straight onto the board; a bigger one gets one
  call to the lead seat, which may split it into two to six steps that each
  leave the project working. The steps are admitted under your card in the
  same save, as its delegated slices, so your card runs last as the final
  integration and check. A **Plan in flight** card shows how far along it
  is; when approval is required, its waiting steps are one row under Needs you and
  start together, and **Make it one task** drops the steps that have not
  started. No AI, a slow one or an unusable answer keeps it one card.
- **New app** beside Vibe's project picker: name it and say what it should
  be, and Studio makes an empty folder under Mefi Apps in your home folder,
  starts git in it, opens it as the project and sends the description through
  Build it as its first request.
- Vibe has its own menus. Tasks, Plans, Ideas, Team and Settings open as
  compact panels beside the front door instead of Build's full pages: short
  rows with one or two actions, a row opens its detail, Back or Esc steps out,
  and **Full view** opens the Build page for the same thing inside Vibe's
  rail. A queued task takes a note for its next attempt, a finished one can
  be sent back with **Ask for a change**, an idea is built or set aside in
  place, and Team shows who is building and which model each seat runs on.
- Vibe's cards and dock come and go with what they have to say. Needs you,
  Building now, Freshly done (the last half day) and the new Fresh ideas card
  show only while they have something; a quiet project gets one calm line.
  Watch steps into the dock while agents work, Plans while a plan is in play
  and Ideas while fresh ones wait. The status pill opens what it names, and a
  decision toast answers in Vibe's own drawer while Vibe is the mode.

- The desk can handle asks for you. With "Let the desk handle asks for you"
  on (the companion's Settings tab, the Agent brain's Seats tab or Agents ›
  Setup), your companion settles open asks and re-arms parked cards on the
  desk's model and says in the chat what it chose and why. Permission, risk
  and "only you can do this" asks always wait for you. The companion's list
  also gains **Clear list**, which takes stuck items off it until something
  new happens to them.

### Fixed
- First map can use the selected provider and local project excerpts without OpenCode. Subscription setup clears conflicting role overrides and keeps other providers out of unrequested fallback calls.
- Coding CLIs installed while Studio is open no longer show "not found" until a
  full quit and relaunch. On Windows, the CLI status pills, auto setup and each
  launch (including a self-update restart, which inherits the old environment)
  re-read PATH from the registry before looking the tools up.
- A Vibe card whose count was empty (Freshly done, or Building now with
  nothing running) pushed its title to the far edge of the card.
- An answer the desk gave for you counted as yours: the card said "You
  decided", your own stop on the card was lifted, and its failure and loop
  budgets were wiped, so a failing card could loop through the desk all day.
  Such answers are now marked "Mefi decided" with its reason.
  They keep your stop and the card's budgets, and they are never learned as
  your preference. If one cannot be applied, the card goes back to waiting
  for you.
- A question the desk could not answer, and handed on to you, was quietly
  settled as a retry instead of reaching you.
- The companion's list showed a parked card's project as a raw id, and a card
  you had stopped could still be retried as "parked".
- "Only you can do this" asks that several cards raised about the same need,
  in different words, now fold into one. An ask you had cleared no longer
  comes back as an instruction.
- In Auto and Elevated only, the pieces Studio split off your own task waited
  for your approval, as if an agent had filed them. Your task then waited on
  its pieces, so your own work stalled. Pieces of your own work now build.
  Follow-ups and requests an agent files still wait while "Work agents
  propose" is on.
- A parked card whose ask you left for review got the same ask back on the
  next pass. It now stays off your list until the card parks again.

## [0.4.3] - 2026-09-26

### Added
- Saved node and connecting-line brightness sliders (0–200%) have independent enable switches. Optional contrasting node outlines improve tree readability. Controls synchronize between the media menu and Appearance without moving the tree or dimming labels, video, or menus.
- The media menu offers newly copied playable links with Play, Add to queue, Queue next and Dismiss. Copied-link detection and URL visibility are saved toggles; Show links masks pasted URLs and hides clipboard, recent and queue URLs without changing playback.
- Hover the audio/media button to open the current source's settings. The dropdown stays open while crossing into it, holds open for slider adjustments, preserves keyboard focus on hover, and stays hidden in Zen.
- Tree modes & movement adds Steady, Music, Video and combined reactions, live ring/wave/spiral shapes, size/width/height/rotation/position controls, count-aware spacing, per-part music movement, and smoothed dark or bright video-region positioning. Controls are shared between Appearance and Audio reactions and saved locally.
- Parking the mouse at the right edge of Live / Command view starts the Zen tree tour after a short pause and hides the pointer. Moving back, clicking or typing returns to the live controls.
- A machine-local `localStyleUnlock` preference keeps the Void themes and node styles unlocked across rebuilds and updates without changing release defaults.
- Link media keeps settings in Music & video so YouTube controls stay clickable and Zen stays clear. Adds a darkened video background, transparency, optional slow tree placement in dark areas, task-completion fades, ten-minute playback/placement restoration, saved volume/mute and Audio Link restoration, and a built-in YouTube explorer with Next video.
- The media menu now has a persistent Up next queue: add links or YouTube results, queue an item next, play immediately, or remove it. Next video uses queued items first; YouTube, Vimeo and direct files advance automatically on completion.
- Separate Tree transparency and Video transparency sliders keep the node tree readable. Video brightness now defaults to 100% with an adjustable 25–150% range instead of fixed dimming; inactive page styles no longer dim the Command tree over video.
- Drop text and code files into Home, Vibe and Plans, or use Add files, to include editable file contents in a draft. Plans restore the last selected plan and step per project, and Vibe keeps project-specific drafts.
- Planning reads fresh project excerpts, README/build context and explicitly named files; resumed interviews retain earlier human answers.
- Per-agent web search, project-read permissions and MCP tool allowlists in Agents setup, with shared research turns across AI surfaces and MCP attachments for OpenCode and Claude workers. See [Agent tools](docs/agent-tools.md).

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
  **Connect an AI** when none is. When approval is required, **Review** shows a
  build's brief, approves its scope and links to permission settings; a stuck task
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

[Unreleased]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.4.4...main
[0.4.4]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.4.0...v0.4.2
[0.4.0]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/nateecho32-stack/mefi-studio/compare/v0.3.0...v0.3.3
[0.3.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.3.0
[0.2.0]: https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.2.0
