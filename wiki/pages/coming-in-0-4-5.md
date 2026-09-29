# New in 0.4.5

> <span class="status next">New in 0.4.5</span> Everything on this page is new in Studio 0.4.5, released on 28 September 2026. [What's new](#/whats-new) also covers what 0.4.4 added.

**Coming from 0.4.4?** The in-app update can't install 0.4.5 for you, so [update by hand](#/updates/update-from-044-by-hand) this once. From 0.4.5 on, updates install themselves. The next release, 0.4.6, is [being built now](#/coming-in-0-4-5/being-built-for-046).

A few things below need the rooms hub, which the owner runs. They're marked <span class="status rolling">Rolling out</span>, because they switch on only once the hub is online.

If you run Studio from source on main, you already have everything here. See [Install Studio](#/installation).

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
- **A map that shows relationships.** Connected system cards, an **Ideas tree** and **Work with Mefi** in the project map. See [Agent brain, Playbook and project map](#/agent-brain/new-in-045).
- **Plans, one step at a time.** Plans opens without waiting for the folder scan, shows one step at a time with an **Up next** button, and answers with a quick model first, asking a deeper one only when needed. **Think harder** goes straight to the deep one. See [Plans and ideas](#/planning).
- **A calmer Task board.** Search and filters sit in one compact row, a click anywhere on a card opens its task, and short cards slide up into free space. See [Tasks](#/workflow).

## Settings and menus

- **Configuration.** Every setting in one searchable tree (`Ctrl Shift ,`), with a new **Interface scale** from 70% to 150%. See [Configuration](#/settings/configuration).
- **When Studio opens.** Choose **Resume what I had**, **Start agents** or **Keep agents off**.
- **No surprise Command view.** Switching to the Command view after five quiet minutes is now a setting, off by default.
- **Start with Windows.** Studio can open in the tray when you sign in, so a PC you leave working keeps working after an update restart. See [Settings and Configuration](#/settings).
- **One two-step confirm.** Every action that can't be undone, from **Stop all** to deleting a recipe, asks the same way: the first press asks, the second acts.
- **Plain words.** Errors read as sentences, and pages leave out values that weren't recorded instead of showing "undefined".
- **Calmer menus.** Rows that stay keep still and glide to their new place, new rows rise in, and old ones fade out. Reduced motion turns it off.
- **Typing goes to the open menu.** With a menu open, what you type lands in its text box instead of setting off single-key shortcuts.
- **Projects on M+.** The project panel opens with the keyboard on your current project.
- **Media controls stay in reach.** Floating players have a move handle and minimize to a restore bar. See [Music, video and the player](#/media-player).

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
- **Reach this PC from Discord.** Check on a PC and talk to Mefi from a direct message with the Void Engine bot. Studio's side is built; it works once the bot's side goes live. Work asked for this way always waits for your OK.

## Friends and rooms

> <span class="status rolling">Rolling out</span> Studio's side of these is built. They switch on once the owner's rooms hub is online and the Mefi Studio Link app is set up.

- **Friends › Rooms.** Browse rooms, ask to join, accept invites and chat, all inside Studio. See [Friends, rooms and playdates](#/friends-and-rooms).
- **Connection details.** Enter the link app ID and the hub's address once per PC in **Settings › General › Community**. No environment variables or restart needed.
- **Playdates with friends.** Companions in the same room meet and play short playdates. Nothing about you or your work is shared until you allow it. When a friend's companion shares more, yours asks **Share back?** and never decides for you.
- **Agents on several PCs.** Link a cowork room to a project, and builders on different PCs claim the files they'll edit, so two PCs never edit the same file at once.

## Speed and fixes

- **In-app updates install.** In 0.4.4, **Update** downloads a new release but never installs it. That's fixed from 0.4.5 on. To get from 0.4.4 to 0.4.5, [update by hand](#/updates/update-from-044-by-hand) this once. The [download page](../download.html#updates) has the same steps.
- **Guided sign-in works again.** In 0.4.4, the setup window for installing or signing in to a coding tool may close at once. Until then, [sign in from a terminal](#/connections/sign-in-from-a-terminal); [Set up in 0.4.4](#/setup-helper/set-up-in-044) has the rest.
- **Lighter in the tray.** While Studio's window is hidden or minimized, task lists and machine status wait until you open it.
- **Starting up.** Studio no longer gets stuck on "Picking up where you left off" when its window is covered or in the tray.
- **Settings that did nothing now work.** For example, saving an LM Studio or custom endpoint no longer breaks an open team draft, and **Work through the backlog** can be stopped.
- **Running from source.** `npm ci` fetches Electron again and needs Node 24 or newer, and `npm test` finds Python 3 under any of its usual names.

## Being built for 0.4.6

> <span class="status progress">In progress for 0.4.6</span> Work on these started on 28 September 2026. They aren't in a download yet, and there's no date.

- **Faster agent sends.** Agents get only what's new instead of whole packages. A work journal keeps each task's older history and a transcript of each run, and a retry continues where the agent left off.
- **A logging rework.** Structured logs, with old logs archived instead of deleted, and all of them kept. See [Trace, logs and diagnostics](#/trace).
- **A faster launch.** A shorter start, with no blank fade and fewer calls while Studio starts.
- **Friends 2.0.** A lobby with rooms, who's online, Studios on the same Wi-Fi finding each other, invite links you click instead of codes you copy, and a fair queue for shared videos. Discord is the fastest way in, but you won't need it.

<span class="status planned">Planned</span> A new launch screen: your project assembles as a constellation of its systems, and a welcome-back hub shows what changed when you've been away for 10 minutes or more. It isn't started yet.

More is planned after that. See the [roadmap](../roadmap.html) for what's planned and to ask for a feature.
