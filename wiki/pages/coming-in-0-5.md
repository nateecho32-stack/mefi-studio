# Everything new in 0.5

> <span class="status next">New in 0.5</span> Studio 0.5 came out on __RELEASE_DATE__, and it's the current download. This page lists everything it added; [What’s new in 0.5](#/whats-new) is the short version.

**Where did 0.4.5 and 0.4.6 go?** Both were skipped and folded into 0.5. What was planned for them is in 0.5, apart from [what's still being built](#/coming-in-0-5/still-being-built-for-05).

**Coming from 0.4.4?** Its in-app update can't install 0.5, so [update by hand](#/updates/update-from-044-by-hand) this once. From 0.5 on, updates install themselves.

**New names.** In 0.5, Vibe is called **Social**, Build is called **Studio**, the Command view is **the Map** and Agents is **Team**. Some pages of this guide still show 0.4.4's screens and use the old names.

<span id="what-will-and-wont-ship"></span>

## What 0.5 brings, and what comes later

0.5 brings one new layout, with Social and Studio, the Map, Team, tabs and one Inbox; Friends with nothing to set up, on a relay built into Studio, with The Lobby, rooms, the Project hub, credits and a weekly Build Jam; the setup helper; Connectors, skills any way you want them and thinking that steps up when a job is stuck; a review of each worker run's changes; Windows notifications; Sign in with ChatGPT; My PCs, Other apps and Resources; and the new Chrome look. The lists below cover all of it.

**Still being built:** a faster launch, now planned for 0.5.x.

**Planned for 0.5.x:** Related folders, starting a new app from a template, saved map views, and three pieces of the 0.5 design that aren't built yet: a live Preview tab, the pinned tree strip as a panel, and Drafts in the session list.

**Later, with no date:** Fleet lanes, missions and fleets from other PCs, Linux, voice, bridges to creative tools, cosmetics and shared mixes.

**Needs a part outside Studio:** <span class="status rolling">Rolling out</span> **Reach this PC from Discord** and the bot's `/nowplaying` are built on Studio's side, and work once the Studio bot is linked to the relay. Rooms, Listen together, playdates and cowork claims need nothing extra, because the relay is built into Studio; they do use a Discord sign-in.

## The 0.5 layout

From 0.5 this is Studio's only layout. The classic layout and the switch back to it are gone, and every control they held has a place in the new one.

- **Social and Studio.** The two modes were called Vibe and Build. **Social** is for time with friends and a light eye on your agents; **Studio** is for in-depth building, with the social side still there. Switch in the top bar or with `Ctrl M`. Only the names change: your saved mode, settings and links carry over.
- **A rail with four places:** **Work** (Tasks, Plans, Ideas, the Inbox, the Analyzer and Worktrees), **Map**, **Team** and **Friends**, with **Search**, **Settings** and **Help** at its foot. Each place remembers where you were.
- **A top bar** with the Social | Studio switch, where you are, **Search** (`Ctrl K`) and how many things need you.
- **A session list and an inspector.** Resize them by dragging or with the keys, or fold them into drawers in a small window.
- **A status bar** along the bottom: what's running, what waits on you, usage, the machine's load and what's playing.
- **Tabs you add and pin.** Studio keeps them tidy.
- **Size and density**, with a live preview.
- **Today**, and one **Inbox** for everything waiting on you (`Ctrl J`).
- **Your tasks as sessions.** Studio mode lists the project's tasks as sessions. Each one has a thread and an inspector with **Plan**, **Changes**, **Checks**, **Preview** and **Agent**.
- **New Settings, Search and first run.** Settings and Search are rebuilt, and a new install gets a three-step welcome: pick the AI that builds for you, choose a project, and say what Studio should make first.
- **Help** holds Start here, the setup guide, Shortcuts, What's new, Report a problem and the Discord.

## The Map and Team

- **The Map.** The Command view is now the Map. Your sessions stay in the list beside the tree, and a small bar over it holds **Map | Fleet | Pipelines**, **Running only** and **View**: the layouts, labels, the camera, and a flat map or a 3D orbit. `N` opens a new task and `S` opens Search.
- **Team.** Agents is now Team, with a place for each part: Overview, Providers, Seats and models, Permissions, Rules, Skills, Connectors, Related folders, Workflows, Health and usage, Resources, Models and Inspect. **Seats and models** says who does each job in plain words, and longer how-to waits behind small "i" circles.
- **Connectors.** **Team › Connectors** adds, approves, tests and imports MCP servers, including the ones Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex, OpenCode and Gemini CLI already use. Studio shows the exact command before anything runs, keeps their tokens encrypted, and lets you choose which ones the chat, the helper agents and the builders get. Online servers work too.
- **Skills any way you want them.** **Team › Skills** has an editor and live checks. Every skill can be always on, picked when it fits, or used only when called, separately for the chat, the helper agents and the builders. **Team › Rules** sets what every agent should always do.
- **Thinking that steps up.** Claude Code, Codex and OpenCode start every job with light thinking and think harder only when it fails its check. After two misses a stronger model takes it, and Max thinking waits for your OK. A report card in **Team › Seats and models** says what each model is good and bad at on this PC.
- **Answer styles.** Mefi explains things like you're five unless you pick another style: Short answers, Teach me, Brainstorm, Poke holes, Expert or plain. A chip beside the permission mode in each message box shows the style and changes it.
- **Resources.** **Team › Resources** lists the other apps on this PC and can slow down, pause, close or end them while agents build, by hand or automatically. Auto puts everything back when the agents finish, and nothing stays paused after Studio closes. Windows only.

## Setting up

- **The setup helper.** One guided sheet for every agent setting. It opens once after you update, and waits in Help and Search. See [The setup helper](#/setup-helper).
- **Setup finds the login you have.** **Set up automatically** and **Start free with OpenCode** come first. A coding tool that's installed but not signed in says so, and no longer counts as connected.
- **More than one Claude Code or Codex login.** Add up to six logins for each tool. When one reaches its usage limit, work moves to the next. See [More than one login](#/setup-helper/more-than-one-login).
- **A first run with no AI says so.** Today and the agents' status read "No AI connected" with a **Connect an AI** button. With no coding tool installed, **Start agents** says which one to install instead of failing five times.
- **A quieter launch screen.** One **Open** button with a **Start agents** switch, and **Open a folder…**, **Start a new app** and **Get from GitHub** at its foot.
- **One welcome at a time.** Closing the setup helper leaves the guided tour waiting on the Start here card.
- **No subscription?** The Start here scan offers **I have an API key or a local model server**.
- **More AI routes work on Auto.** Auto setup finds OpenCode Zen and a local Ollama. A saved OpenRouter, Zen or custom key works without editing the provider order, and a custom endpoint no longer needs a key.
- **Every coding tool's builds are checked.** Builds by Claude Code, Codex, Grok and Antigravity are verified by Studio's own checks, instead of always waiting for you to confirm them.
- **Other apps.** **Settings › Other apps**, off until you turn it on, lets Claude Code, Codex and your scripts on this PC see what the agents are doing, message Mefi and hand Studio a task. Every task an app files waits for your OK. **Copy setup prompt** gives an AI helper what it needs to walk you through setup.

## Social

- **MEFI: Modify, Experiment, Fix, Improve.** Four ways to build on the open project, plus **Suggest a next step**. Suggestions can go into your draft or be saved as ideas, and nothing starts until you build. See [Vibe mode](#/vibe-mode/mefi-modify-experiment-fix-improve).
- **Watch Mefi think.** **Suggest a next step** and **Build it** show a live strip: the stage, the files read or steps planned, which model is thinking, and a clock. A split request draws its steps as a track. See [Watch Mefi think](#/vibe-mode/watch-mefi-think).
- **Talk it over only talks.** It no longer turns a message like "Add a search box" into a task.
- **Honest worker limits.** The worker limit offers 1, 2, 3 or Automatic, which is what Studio really runs.
- **Scheduled for later.** A deferred task says so, and why.

## Agents, tasks and plans

- **Agents say why they aren't working.** Today, the Map, each task and the chat all give one answer about what's holding work back, and the one control that clears it.
- **Permission modes keep their meaning.** The old Auto build switch no longer overwrites your mode, and each mode says what happens to a new task. See [Permissions and decisions](#/permissions).
- **Approvals stick.** Approving a new task before its references finish gathering no longer drops the approval.
- **A tidier Needs you.** Answered questions leave the list at once, and expired questions close when the project loads.
- **Habits for each agent.** Short rules such as explaining changes, testing and small steps, each set to off, brief or full, with its cost in tokens. Find them in **Team › Seats and models**, on each job's card under **More settings**. See [Agent tools and skills](#/tools).
- **"What changed while I was away?" works without an AI.** Studio answers from its record of work done outside Studio. A task matched only by file and commit names now says it "may already be done".
- **A heavier model when it helps.** **Try again with a heavier model** really uses the Heavy tier, and only shows where one exists.
- **Every node style finishes in its own way.** In the Agent brain, a step whose work came back, and an agent the lead takes in, play your node style's own beat. A failed check finishes in amber.
- **A map that shows relationships.** Connected system cards, an **Ideas tree** and **Work with Mefi** in the project map. See [Agent brain, Playbook and project map](#/agent-brain/coming-in-05).
- **Plans, one step at a time.** Plans opens without waiting for the folder scan, shows one step at a time with an **Up next** button, and answers with a quick model first, asking a deeper one only when needed. **Think harder** goes straight to the deep one. See [Plans and ideas](#/planning).
- **The Fleet page.** **Map › Fleet** shows the open project’s seats in Lead, Build, Check and Keep pods, with Graph, Table, Recent, Tree and Health views. Click a seat for its work and earlier runs, **Open task**, a way to its node on the Map and a two-press **Stop this run**. Lanes, missions and other PCs come later.
- **Sub-agents on the Map.** A session's sub-agents hang under it, pop out of their parent and fly home into it when they're done.
- **A calmer Task board.** Search and filters sit in one compact row, a click anywhere on a card opens its task, and short cards slide up into free space. See [Tasks](#/workflow).
- **Compact Ideas cards.** Clear titles, short excerpts and status tags replace the long rows. Short cards slide into free space, and the layout adapts to the window. Choosing a card opens its existing detail and actions. See [Plans and ideas](#/planning).
- **Undo.** Deleted tasks and ideas wait in **Recently deleted**, so you can bring them back, and plans keep their earlier versions.

## Building with agents

- **See what a run changed.** After a worker run, Studio lists the changed files, with **Accept** and **Revert** for one file or the whole attempt.
- **Advisory checks.** Lint and typecheck run as advisory checks.
- **Before and after.** Screenshots from before and after a run.
- **A time limit and usage for each task.**
- **Pictures on a message.** Add pictures to what you send.
- **The @ # / picker.** Type `@`, `#` or `/` in a message to pick from a list. `@` searches your project's files.
- **Work › Worktrees.** Every Git worktree of the project, with what to do about each.
- **A coding-agent desktop.** Off by default: Search's **Switch Home layout** lists your tasks the way coding-agent desktop apps list sessions.

## Models and sign-in

- **Sign in with ChatGPT.** Use your ChatGPT plan in Studio.
- **Codex workers over `codex app-server`.**
- **GPT-6.1 Sol for heavy seats.** It's the default model for heavy seats.
- **A face lift for Team › Models.** The Catalog is one sortable table with four picks, and Performance leads with a leaderboard.

## Keeping you posted

- **Windows notifications.** A taskbar flash and a count, with quiet hours.
- **The Studio Daily.** The launch screen becomes a daily paper of what changed while you were away.
- **What's new after an update.** Studio shows what changed once it has updated.
- **Report a problem.** Send a report from Studio, and get a prompt to do so after a crash.

## Settings and menus

- **Chrome, the new default look.** A new theme of matte black panels, silver type and brushed chrome on the main buttons and the side of a switch you are on, an iridescent finish (silver, ice blue, lilac and aqua) on the edges, the selection bars and the highlights, and silver nodes on the Map. New installs open in it. A theme you already picked, Aurora included, stays. Every theme also gets a finer finish: buttons ease into hover and press, and raised controls catch a fine top highlight. See [Appearance](#/appearance).
- **Configuration.** Every setting in one searchable tree (`Ctrl Shift ,`), with the setup helper’s sections, a pinned **Walk me through setup**, and a new **Interface scale** from 70% to 150%. See [Configuration](#/settings/configuration).
- **When Studio opens.** Choose **Resume what I had**, **Start agents** or **Keep agents off**.
- **No surprise Map.** Opening the Map after five quiet minutes is now a setting, off by default.
- **Start with Windows.** Studio can open in the tray when you sign in, so a PC you leave working keeps working after an update restart. See [Settings and Configuration](#/settings).
- **One two-step confirm.** Every action that can't be undone, from **Stop all** to deleting a recipe, asks the same way: the first press asks, the second acts.
- **Plain words.** Errors read as sentences, and pages leave out values that weren't recorded instead of showing "undefined".
- **Calmer menus.** Rows that stay keep still and glide to their new place, new rows rise in, and old ones fade out. Reduced motion turns it off.
- **Typing goes to the open menu.** With a menu open, what you type lands in its text box instead of setting off single-key shortcuts.
- **Media controls stay in reach.** Floating players have a move handle and minimize to a restore bar. See [Music, video and the player](#/media-player).
- **A smaller media player.** The media menu becomes a mini player with play, pause, back, forward and volume, quick switches for the node tree, and YouTube videos to scroll through.
- **Playlists.** Five starting lists of real videos, lists of your own, and **Share**, which copies a list as text with a link that plays it on YouTube, or posts it to a room or the Project hub.

## Your companion

- **Six bubbles, one job each.** **Talk**, **What I'm doing**, **Needs you**, **Suggest work**, **Friends** and **Personality**. See [Your companion](#/companion).
- **A personality.** Straight work, Balanced or Friendly & expressive. It changes the companion's manner, not what it may do.
- **A pet.** Stroke it and it remembers. With idle play on, it fidgets and dozes.
- **Friends › Playground.** **Practice with Pip** plays a short playdate on your own PC.

## Your PCs

- **My PCs: your PCs work as one.** **Friends › Your PCs** lists every PC you sign in to Friends on, live, with its load, battery and running tasks. Pair each PC once by checking the same six numbers on both screens. **Send work here** starts a task on another PC, and a PC that stays busy, or a laptop low on battery, hands its ready cards to a paired one. See [Your PCs](#/your-pcs).
- **Set up this PC.** A checklist of what a PC needs to share projects through GitHub, with a button for each gap, plus **Get a project from GitHub**.
- **Keep this PC up to date.** Studio checks GitHub once a minute and brings in another PC's work when nothing on this PC is in the way.
- **Share between my PCs.** A sealed, private vault on GitHub carries your setups, recipes, what Mefi learned, and open tasks and ideas between your own PCs. Each PC's line also says what its agents are doing.
- **Share with friends.** Save one brain, recipe, team setup or set of preferences as a `.mefishare` file. Everything is scrubbed and previewed before it's saved, and a friend's file is reviewed before it's kept. It can't change your permissions.
- **Safer sync.** **Sync this PC** pushes only after the project's own checks pass. **Put my commits on top of GitHub's** handles work that has split. Closing Studio asks first when work exists only on this PC.
- **A guard against lost work.** Sync refuses to push a merge that silently drops 200 or more lines of another branch’s changes, and names the merge and files. **Your PCs** reports recent suspicious merges too.
- <span class="status rolling">Rolling out</span> **Reach this PC from Discord.** Check on a PC and talk to Mefi from a direct message with the Void Engine bot. Studio's side is built and the relay carries it; it works once the Studio bot is linked to the relay. Work asked for this way always waits for your OK.

## Friends and rooms

> <span class="status next">New in 0.5</span> Friends runs on the Mefi Studio relay, a free service built into Studio, so there's nothing to set up and no PC has to stay on. Sign in with Discord once; your account needs to be in the Void Engine server.

- **Friends, a place of its own.** The rail's **Friends** opens one page: **The Lobby**, **Rooms**, **Your PCs**, **Playground**, the **Project hub** and **Events**. Search and the companion's Friends bubble open it at the right place.
- **The Lobby.** Who is online and in which room, the week's top project, the rooms open now, what was shared this week and who moved up a rank. Everyone signed in is in the Lobby room, so there's always someone to say hi to.
- **Rooms like a chat app.** Browse rooms, ask to join, accept invites, or type a friend's invite code to come straight in. An open room fills the page, and **Enter** sends. See [Friends, rooms and playdates](#/friends-and-rooms).
- **The Project hub.** Share a project as a card and play what friends make. Playing someone else's project for two minutes earns you both credits, and 100 credits put a project at the top of the hub for a day. Ranks run from Spark to Void. Credits are never bought, and never earned by inviting people.
- **Friends › Events.** A Build Jam every week with a theme, co-work hours three times a day, and credits for building together with a friend.
- **Playdates with friends.** Companions in the same room meet and play short playdates. Nothing about you or your work is shared until you allow it. When a friend's companion shares more, yours asks **Share back?** and never decides for you.
- **Agents on several PCs.** Link a cowork room to a project, and builders on different PCs claim the files they'll edit, so two PCs never edit the same file at once.
- **The relay keeps no chat.** Each Studio keeps its own copy of a room's messages for a week, and fills in what you missed from other members' copies. The relay signs every message, and its code is public.

## Speed and fixes

- **In-app updates install.** In 0.4.4, **Update** downloads a new release but never installs it. That's fixed from 0.5 on. To get from 0.4.4 to 0.5, [update by hand](#/updates/update-from-044-by-hand) this once: the [download page](../../download.html#from-044) has the steps.
- **Studio sends only what changed.** When a task changes, Studio sends the window that one card instead of the whole board, and Claude Code and Codex runs show their steps while they work.
- **Studio's log is kept.** The logs are saved on this PC in monthly archives that are never deleted, and Trace's **Load older** reads back through them. See [Trace, logs and diagnostics](#/trace).
- **Portable build details.** The executable carries Studio’s name, version and icon.
- **Guided sign-in works again.** In 0.4.4, the setup window for installing or signing in to a coding tool could close at once; in 0.5 it stays open and runs the setup. Still on 0.4.4? [Sign in from a terminal](#/connections/sign-in-from-a-terminal).
- **Tree brightness is lighter on the graphics card.** It takes much less work from the graphics card than before.
- **Lighter in the tray.** While Studio's window is hidden or minimized, task lists and machine status wait until you open it.
- **Starting up.** Studio no longer gets stuck on "Picking up where you left off" when its window is covered or in the tray.
- **Settings that did nothing now work.** For example, saving an LM Studio or custom endpoint no longer breaks an open team draft, and **Work through the backlog** can be stopped.
- **Running from source.** `npm ci` fetches Electron again and needs Node 24 or newer, and `npm test` finds Python 3 under any of its usual names.

<span id="still-being-built-for-05"></span>

## Still being built

> <span class="status progress">In progress for 0.5.x</span> **A faster launch:** Studio opening sooner, without the blank fade. In 0.5 so far: timing marks for every startup step, a settings cache and a compile cache for Studio's own code. Still to do: a shorter launch gate and fewer calls at startup.

The rest of what was meant for 0.4.6 is in 0.5 and listed above: Studio sending only what changed, the kept logs, and The Lobby with who's online.

<span class="status planned">Planned for 0.5.x</span> Related folders, starting a new app from a template, saved map views, a live Preview tab, the pinned tree strip as a panel, and Drafts in the session list.

<span class="status planned">Planned</span> More for Friends: Studios on the same Wi-Fi finding each other, project rooms with friends' cursors on a shared tree, and a fair queue for shared videos. The next Fleet phases add agent lanes, missions measured from verified work, and your other PCs' and friends' fleets.

<span class="status planned">Planned</span> A launch screen where your project assembles as a constellation of its systems. The Studio Daily (above) already shows what changed while you were away.

More is planned after that. See the [roadmap](../../roadmap.html) for what's planned and to ask for a feature.

## Studio is moving to Rust

Work started on 3 October 2026 to move Studio to Rust with Tauri 2, in stages. The screens stay HTML and JavaScript, shown by WebView2, with the same settings and API keys. The Electron build is unchanged and is still what ships. There's no date for the switch.

- **Stage 1: the Rust host.** The window, tray, dialogs, the page's bridge and saved keys. It's done on main and runs from source with `npm run host`.
- **Stage 2: the engine, part by part.** <span class="status progress">In progress</span> Done so far: the OpenCode session store, multi-PC sync and the Worktrees page's actions, the @ picker's file search, the Git chip's actions and state, the Skills page's files, a message's pictures, before/after pictures and **Revert**, and settings and saved keys. Each part gives the same answers as the JavaScript it replaces, and tests that run both keep them equal.
- **Stage 3: no Node sidecar.** A release then carries only the Rust host.
