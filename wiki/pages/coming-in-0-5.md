# Coming in 0.5

> <span class="status next">Coming in 0.5</span> This is the scope for the next release: work built on main, the app’s development branch, plus small usability wins. 0.5 is being built now. It isn't published yet and has no release date. The current download is 0.4.4, from 27 September 2026. [What’s new in 0.4.4](#/whats-new) covers that release.

**Where did 0.4.5 and 0.4.6 go?** Both were skipped and folded into 0.5. Everything that was coming in 0.4.5 is built on main and ships in 0.5. What was in progress for 0.4.6 is now planned for 0.5 and [still being built](#/coming-in-0-5/still-being-built-for-05).

**On 0.4.4?** Its in-app update can't install 0.5 for you, so when 0.5 is out, [update by hand](#/updates/update-from-044-by-hand) this once. The 0.5 release will say how. From 0.5 on, updates install themselves.

A few things below need the rooms hub, which the owner runs. They're marked <span class="status rolling">Rolling out</span>, because they switch on only once the hub is online.

A source install on main includes the built 0.5 work listed below. Features marked **Rolling out** still need the hub; the later sections describe deferred work. See [Install Studio](#/installation).

## What will and won’t ship

0.5 includes the setup helper, Configuration’s setup index, clearer agent status and live Vibe progress, the Fleet page, PC setup and sharing, Friends in the main menu, and compact Task and Ideas cards. It also brings an optional new layout, Build as a desktop for coding agents, a review of each worker run's changes, Windows notifications, Sign in with ChatGPT, the media player redesign and tree brightness that's lighter on the graphics card. The lists below cover the built work.

**Still in progress for 0.5:** faster agent sends, kept logs, the faster launch and Friends 2.0. They're planned for 0.5 and being built on branches, not on main. Fleet lanes, missions and other PCs are planned for 0.5 too. The full menu overhaul and card cleanup for Providers, Plans, Vibe and the Project map stay planned without a release target. Command sub-agent visuals and community ratings still have branch work or decisions ahead of them. Linux, voice, credits and creative-tool bridges are later plans or ideas.

**Conditional features:** rooms, Listen together, friends’ playdates and cross-PC file claims need the rooms hub and Discord link online. Discord remote controls also need the bot’s matching support. Publishing 0.5 does not activate these services.

## The 0.5 layout

The 0.5 layout is optional and off by default. Turn it on with **Try the 0.5 layout** in Settings, or type **Switch layout: 0.5 or classic** in Search. The same command takes you back.

- **A top bar** with a **Vibe | Build** switch.
- **A session list and an inspector.** Resize them, or fold them into drawers.
- **A status bar** along the bottom.
- **Tabs you add and pin.** Studio keeps them tidy.
- **Size and density**, with a live preview.
- **Today**, and one **Inbox** for everything waiting on you.
- **Build's tasks as sessions.** Tasks become a session list. Each one has a thread and an inspector with **Plan**, **Changes**, **Checks**, **Preview** and **Agent**.
- **New Settings and Search.** The layout has its own Settings, Search (`Ctrl K`) and a three-step first run.

## Setting up

- **The setup helper.** One guided sheet for every agent setting. It opens first on a new install, and once after you update. See [The setup helper](#/setup-helper).
- **Setup finds the login you have.** **Set up automatically** and **Start free with OpenCode** come first. A coding tool that's installed but not signed in says so, and no longer counts as connected.
- **More than one Claude Code or Codex login.** Add up to six logins for each tool. When one reaches its usage limit, work moves to the next. See [More than one login](#/setup-helper/more-than-one-login).
- **A first run with no AI says so.** Home, Vibe and the agents' status read "No AI connected" with a **Connect an AI** button. With no coding tool installed, **Start agents** says which one to install instead of failing five times.
- **One welcome at a time.** Closing the setup helper leaves the guided tour waiting on the Start here card. With no project yet, the launch screen leads with **Open a folder…**.
- **No subscription?** The Start here scan offers **I have an API key or a local model server**.
- **More AI routes work on Auto.** Auto setup finds OpenCode Zen and a local Ollama. A saved OpenRouter, Zen or custom key works without editing the provider order, and a custom endpoint no longer needs a key.
- **Every coding tool's builds are checked.** Builds by Claude Code, Codex, Grok and Antigravity are verified by Studio's own checks, instead of always waiting for you to confirm them.

## Vibe

- **MEFI: Modify, Experiment, Fix, Improve.** Four ways to build on the open project, plus **Suggest a next step**. Suggestions can go into your draft or be saved as ideas, and nothing starts until you build. See [Vibe mode](#/vibe-mode/mefi-modify-experiment-fix-improve).
- **Watch Mefi think.** **Suggest a next step** and **Build it** show a live strip: the stage, the files read or steps planned, which model is thinking, and a clock. A split request draws its steps as a track. See [Watch Mefi think](#/vibe-mode/watch-mefi-think).
- **Talk it over only talks.** It no longer turns a message like "Add a search box" into a task.
- **Honest worker limits.** Vibe offers 1, 2, 3 or Automatic, which is what Studio really runs.
- **Scheduled for later.** A deferred task says so, and why.

## Agents, tasks and plans

- **Agents say why they aren't working.** Home, Vibe, the Command view, each task and the chat all give one answer about what's holding work back, and the one control that clears it.
- **Permission modes keep their meaning.** The old Auto build switch no longer overwrites your mode, and each mode says what happens to a new task. See [Permissions and decisions](#/permissions).
- **Approvals stick.** Approving a new task before its references finish gathering no longer drops the approval.
- **A tidier Needs you.** Answered questions leave the list at once, and expired questions close when the project loads.
- **Habits for each agent.** Short rules such as explaining changes, testing and small steps, each set to off, brief or full, with its cost in tokens. They're in each agent's **Skills, tools & habits** panel in **Agents › Setup**. See [Agent tools and skills](#/tools).
- **"What changed while I was away?" works without an AI.** Studio answers from its record of work done outside Studio. A task matched only by file and commit names now says it "may already be done".
- **A heavier model when it helps.** **Try again with a heavier model** really uses the Heavy tier, and only shows where one exists.
- **Every node style finishes in its own way.** In the Agent brain, a step whose work came back, and an agent the lead takes in, play your node style's own beat. A failed check finishes in amber.
- **A map that shows relationships.** Connected system cards, an **Ideas tree** and **Work with Mefi** in the project map. See [Agent brain, Playbook and project map](#/agent-brain/coming-in-05).
- **Plans, one step at a time.** Plans opens without waiting for the folder scan, shows one step at a time with an **Up next** button, and answers with a quick model first, asking a deeper one only when needed. **Think harder** goes straight to the deep one. See [Plans and ideas](#/planning).
- **The Fleet page.** **Agents › Live › Fleet** shows the open project’s seats in Lead, Build, Check and Keep pods, with Graph, Table, Recent, Tree and Health views. Click a seat for its work and earlier runs, **Open task**, **Open in Command** and a two-press **Stop this run**. Lanes, missions and other PCs are planned for 0.5.
- **A calmer Task board.** Search and filters sit in one compact row, a click anywhere on a card opens its task, and short cards slide up into free space. See [Tasks](#/workflow).
- **Compact Ideas cards.** Clear titles, short excerpts and status tags replace the long rows. Short cards slide into free space, and the layout adapts to the window. Choosing a card opens its existing detail and actions. See [Plans and ideas](#/planning).
- **Undo.** Deleted tasks and ideas wait in **Recently deleted**, so you can bring them back, and plans keep their earlier versions.

## Building with agents

- **Build as a coding-agent desktop.** Build becomes a desktop for working with your coding agents.
- **See what a run changed.** After a worker run, Studio lists the changed files, with **Accept** and **Revert**.
- **Advisory checks.** Lint and typecheck run as advisory checks.
- **Before and after.** Screenshots from before and after a run.
- **A time limit and usage for each task.**
- **Pictures on a message.** Add pictures to what you send.
- **The @ # / picker.** Type `@`, `#` or `/` in a message to pick from a list. `@` searches your project's files.
- **Rules for your agents.** Set rules your agents work by.
- **A Skills page.** Your agents' skills get their own page, **Agents › Setup › Skills**.
- **Work › Worktrees.** A page for your project's Git worktrees.

## Models and sign-in

- **Sign in with ChatGPT.** Use your ChatGPT plan in Studio.
- **Codex workers over `codex app-server`.**
- **GPT-6.1 Sol for heavy seats.** It's the default model for heavy seats.
- **A face lift for Models › Catalog and Performance.**

## Keeping you posted

- **Windows notifications.** A taskbar flash and a count, with quiet hours.
- **The Studio Daily.** The launch screen becomes a daily paper of what changed while you were away.
- **What's new after an update.** Studio shows what changed once it has updated.
- **Report a problem.** Send a report from Studio, and get a prompt to do so after a crash.

## Settings and menus

- **Configuration.** Every setting in one searchable tree (`Ctrl Shift ,`), with the setup helper’s sections, a pinned **Walk me through setup**, and a new **Interface scale** from 70% to 150%. See [Configuration](#/settings/configuration).
- **When Studio opens.** Choose **Resume what I had**, **Start agents** or **Keep agents off**.
- **No surprise Command view.** Switching to the Command view after five quiet minutes is now a setting, off by default.
- **Start with Windows.** Studio can open in the tray when you sign in, so a PC you leave working keeps working after an update restart. See [Settings and Configuration](#/settings).
- **One two-step confirm.** Every action that can't be undone, from **Stop all** to deleting a recipe, asks the same way: the first press asks, the second acts.
- **Plain words.** Errors read as sentences, and pages leave out values that weren't recorded instead of showing "undefined".
- **Calmer menus.** Rows that stay keep still and glide to their new place, new rows rise in, and old ones fade out. Reduced motion turns it off.
- **Typing goes to the open menu.** With a menu open, what you type lands in its text box instead of setting off single-key shortcuts.
- **Friends in the main menu.** A Build menu section links straight to **Rooms**, **Your PCs** and **Playground** in the existing Friends hub. Friends also has a stop in Vibe’s rail, and Search reaches the hub and each card in both modes. The companion bubble stays available.
- **Projects on M+.** The project panel opens with the keyboard on your current project.
- **Media controls stay in reach.** Floating players have a move handle and minimize to a restore bar. See [Music, video and the player](#/media-player).
- **A redesigned media player.**

## Your companion

- **Six bubbles, one job each.** **Talk**, **What I'm doing**, **Needs you**, **Suggest work**, **Friends** and **Personality**. See [Your companion](#/companion).
- **A personality.** Straight work, Balanced or Friendly & expressive. It changes the companion's manner, not what it may do.
- **A pet.** Stroke it and it remembers. With idle play on, it fidgets and dozes.
- **Friends › Playground.** **Practice with Pip** plays a short playdate on your own PC.

## Your PCs

- **Set up this PC.** A checklist of what a PC needs to share projects through GitHub, with a button for each gap, plus **Get a project from GitHub**. See [Your PCs](#/your-pcs).
- **Keep this PC up to date.** Studio checks GitHub once a minute and brings in another PC's work when nothing on this PC is in the way.
- **Share between my PCs.** A sealed, private vault on GitHub carries your setups, recipes, what Mefi learned, and open tasks and ideas between your own PCs. Each PC's line also says what its agents are doing.
- **Share with friends.** Save one brain, recipe, team setup or set of preferences as a `.mefishare` file. Everything is scrubbed and previewed before it's saved, and a friend's file is reviewed before it's kept. It can't change your permissions.
- **Safer sync.** **Sync this PC** pushes only after the project's own checks pass. **Put my commits on top of GitHub's** handles work that has split. Closing Studio asks first when work exists only on this PC.
- **A guard against lost work.** Sync refuses to push a merge that silently drops 200 or more lines of another branch’s changes, and names the merge and files. **Your PCs** reports recent suspicious merges too.
- **Reach this PC from Discord.** Check on a PC and talk to Mefi from a direct message with the Void Engine bot. Studio's side is built; it works once the bot's side goes live. Work asked for this way always waits for your OK.

## Friends and rooms

> <span class="status rolling">Rolling out</span> Studio's side of these is built. They switch on once the owner's rooms hub is online and the Mefi Studio Link app is set up.

- **Friends › Rooms.** Browse rooms, ask to join, accept invites and chat, all inside Studio. See [Friends, rooms and playdates](#/friends-and-rooms).
- **Connection details.** Enter the link app ID and the hub's address once per PC in **Settings › General › Community**. No environment variables or restart needed.
- **Playdates with friends.** Companions in the same room meet and play short playdates. Nothing about you or your work is shared until you allow it. When a friend's companion shares more, yours asks **Share back?** and never decides for you.
- **Agents on several PCs.** Link a cowork room to a project, and builders on different PCs claim the files they'll edit, so two PCs never edit the same file at once.

## Speed and fixes

- **In-app updates install.** In 0.4.4, **Update** downloads a new release but never installs it. That's fixed from 0.5 on. To get from 0.4.4 to 0.5, [update by hand](#/updates/update-from-044-by-hand) this once. The 0.5 release will say how, and the [download page](../download.html#updates) has the steps as they stand today.
- **Portable build details.** The executable carries Studio’s name, version and icon.
- **Guided sign-in works again.** In 0.4.4, the setup window for installing or signing in to a coding tool may close at once. Until then, [sign in from a terminal](#/connections/sign-in-from-a-terminal); [Set up in 0.4.4](#/setup-helper/set-up-in-044) has the rest.
- **Tree brightness is lighter on the graphics card.** It takes much less work from the graphics card than before.
- **Lighter in the tray.** While Studio's window is hidden or minimized, task lists and machine status wait until you open it.
- **Starting up.** Studio no longer gets stuck on "Picking up where you left off" when its window is covered or in the tray.
- **Settings that did nothing now work.** For example, saving an LM Studio or custom endpoint no longer breaks an open team draft, and **Work through the backlog** can be stopped.
- **Running from source.** `npm ci` fetches Electron again and needs Node 24 or newer, and `npm test` finds Python 3 under any of its usual names.

## Still being built for 0.5

> <span class="status progress">In progress for 0.5</span> These were meant for 0.4.6 and are now planned for 0.5. Work on them started on 28 September 2026. They're being built on branches, so they aren't on main or in a download yet, and there's no date.

- **Faster agent sends.** Agents get only what's new instead of whole packages. A work journal keeps each task's older history and a transcript of each run, and a retry continues where the agent left off.
- **A logging rework.** Structured logs, with old logs archived instead of deleted, and all of them kept. See [Trace, logs and diagnostics](#/trace).
- **A faster launch.** A shorter start, with no blank fade and fewer calls while Studio starts.
- **Friends 2.0.** A lobby with rooms, who's online, Studios on the same Wi-Fi finding each other, invite links you click instead of codes you copy, and a fair queue for shared videos. Discord is the fastest way in, but you won't need it.

<span class="status planned">Planned for 0.5</span> The next Fleet phases add agent lanes, missions measured from verified work, and your other PCs and friends’ fleets. The full menu overhaul remains planned with no release target.

<span class="status planned">Planned</span> A launch screen where your project assembles as a constellation of its systems. The Studio Daily (above) already shows what changed while you were away.

More is planned after that. See the [roadmap](../roadmap.html) for what's planned and to ask for a feature.

## Studio is moving to Rust

Work started on 3 October 2026 to move Studio to Rust with Tauri 2, in stages. The screens stay HTML and JavaScript, shown by WebView2, with the same settings and API keys. The Electron build is unchanged and is still what ships. There's no date for the switch.

- **Stage 1: the Rust host.** The window, tray, dialogs, the page's bridge and saved keys. It's done on main and runs from source with `npm run host`.
- **Stage 2: the engine, part by part.** <span class="status progress">In progress</span> Done so far: the OpenCode session store, multi-PC sync and the Worktrees page's actions, the @ picker's file search, the Git chip's actions and state, the Skills page's files, a message's pictures, before/after pictures and **Revert**, and settings and saved keys. Each part gives the same answers as the JavaScript it replaces, and tests that run both keep them equal.
- **Stage 3: no Node sidecar.** A release then carries only the Rust host.
