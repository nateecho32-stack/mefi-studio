# Getting started with Mefi's Studio AI+

Mefi's Studio AI+ (Studio, for short) is a Windows app that builds software
with AI. You say what you want in plain words. An AI coding tool writes the
code, Studio checks the work, and you decide whether to keep it.

Start with **Your first ten minutes**. The rest is for later: where things
are, what each launch does, and the [New machine checklist](#new-machine-checklist).

## Your first ten minutes

### 1. Open Studio

1. Download the Windows zip from the
   [releases page](https://github.com/nateecho32-stack/mefi-studio/releases).
2. Right-click it, choose **Extract All**, and keep the folder together.
3. Open `Mefi Studio AI+.exe` in that folder.
4. Windows SmartScreen may stop it the first time, because Studio is not
   code-signed yet (signing tells Windows who made an app). Choose **More
   info**, then **Run anyway**.

Running from source? See [Get Studio running](#get-studio-running).

### 2. Start a new app

A **project** is a folder on your PC that holds one app. Studio opens on a
launch screen, **The Studio Daily**, with a card that says **Choose a
project**.

- Press **Start a new app**. Name the app and, under **What do you want to
  build?**, say what it should do in a sentence or two. Press **Start
  project**.
- Studio makes a folder under **Mefi Apps** in your home folder, starts
  version history in it (Git, which remembers every change so it can be
  undone) and opens it.
- Already have a project folder? Press **Open a folder…**. On GitHub? **Get
  from GitHub** downloads it and opens it.

If something fails, a line on the card says why.

### 3. Pick the AI that builds for you

A short welcome in four steps opens next. Step one, **Make it yours**, is
how Studio looks: **Light**, **Dark** or **Stylized** (glowing colour and
bold headings), then a colour from that look, the text size and how much
things move. Each pick changes Studio behind the card straight away, so you
see it before you go on. **Your dragon** is Ember, a little dragon that comes
with every Studio: it flies around, naps on the bars and cheers when work is
done. It is on for a new Studio; press **Off** if you would rather not. All of
this changes again later in **Settings › Appearance**: when the welcome
closes, a small note next to the Settings button says so, and that the
**Shop** (on Friends) has more skins for Ember, menu effects and style packs.

Studio has no AI of its own. It works through an AI coding tool you sign in to
with your own account. Step two, **Pick the AI that builds for you**, says
which account each tool uses:
**Claude Code** your Claude subscription, **Codex** your ChatGPT plan,
**Grok** your Grok account, **Antigravity** your Google account. **OpenCode**
has free models to start with. A subscription's work counts toward that
plan's limits, as if you used the tool yourself. Studio adds no bill of its
own, and your password stays in the company's own sign-in window.

1. Press **Install and sign in** on the tool you pay for (**Sign in** if it is
   already installed). A window opens: sign in there with your account.
2. Come back to Studio. A tool you are signed in to says **✓ Ready**.
3. Press **Continue**. Studio switches to that tool for chatting, planning and
   building, and says so under the list.

No subscription? Install **OpenCode** and press **Continue** to use its free
models. They cost nothing, but they run one task at a time, and their makers
may use what you send to improve them. Have an API key (a secret code from an
AI company; you pay per use), a ChatGPT plan or an AI on your PC? Press
**Other ways: an API key, a ChatGPT plan or a local model** and set it up
there. Then give your first task in the box on Today.

Without an AI, nothing can be built. If Studio later says **No AI connected**,
open **Help › Setup guide** and go to **Connect an AI**. Signed in to a
subscription? Press **Set up automatically**. Using OpenCode? Press **Start
free with OpenCode**, then **Scan OpenCode** and **Use scanned setup**.

### 4. Choose the project

The third step, **Choose a project**, shows the folder Studio builds in. Your
new app is already open (**✓ Open**). Press **Continue**. No project yet?
Choose **Start a new app…** or **Open a folder…** here.

### 5. Say what to make first

The last step asks **What should Studio make first?** What you wrote for your
new app is already in the box. If not, describe something small, the way you
would tell a friend, or tap an example under **Or try one:**. Press **Build
it**. Studio turns your words into a **task** (one job for the AI) and starts
it. **Skip** (or `Esc`) closes the welcome at any step; **Help › Setup
guide** has the same settings and more.

### 6. Watch it work

Your task shows on **Today**, Studio's home page, under **Running**. Press it
to see what the AI does, step by step. `D` opens **the Map**, a live picture
of your agents (the AI helpers) at work. The pause button in the top bar
holds new work; running jobs still finish.

If nothing starts, the line under the box on Today says what holds the agents
back, with one button that fixes it:

| The line says | Press |
| --- | --- |
| Agents are off | **Start agents** |
| No AI connected | **Connect an AI** |
| Agents paused | **Resume agents** |
| *N* tasks need your OK | **Review tasks** |
| No project open | **Open a project** |

When the AI has a question or needs your OK, the top bar says **1 needs you**.
Press it to open the **Inbox** (`Ctrl J`) and answer there.

### 7. Check the result, then keep it or undo it

When the work is done, the task moves to **Review** and Studio runs its own
checks. Then it is your turn:

1. Open the task and press **See the changes**. The **Changes** tab lists every
   file the AI changed, line by line; **Checks** shows what was tested.
2. Try the app yourself.
3. Happy? Press **Approve and finish**, and the task moves to **Done**.
   (**Accept changes**, on the Changes tab, only notes that you looked.)
4. Not happy? **Revert**, beside a file, puts that one file back. **Revert
   attempt** puts every file back and reopens the task: press it again when it
   says **Revert all** and a number, and **Undo** brings the changes back.
   **Request changes** says what to change; Studio makes a follow-up task.

A task Studio checked by itself shows **Verified** under **Done**; you can
still open it and look. That is the loop. Next, try **Talk it over** to chat
about an idea first, or **Plans** for something bigger.

## Where things are

### Social and Studio

Studio has two modes in one window. The **Social** | **Studio** switch at the
top left (`Ctrl M`) flips between them; both show the same projects and tasks.

- **Social**, the calm mode, is where Studio opens. **Today** has the box, then
  your tasks under **Needs you**, **Running**, **Review** and **Done**.
- **Studio**, the in-depth mode, lists every task on the left under **Needs
  you**, **Running**, **Review**, **Queued** and **Done**, with **New task**
  (`Ctrl N`) on top. The task you pick fills the middle; the **inspector** on
  the right shows its **Plan**, **Changes**, **Checks**, **Preview** and
  **Agent**.

In the box, **Build it** (`Ctrl Enter`) makes a task and starts it; **Talk it
over** (`Enter`) chats with **Mefi**, Studio's assistant. **Modify**,
**Experiment**, **Fix** and **Improve** start the sentence for you, and
**Suggest a next step** asks Mefi for ideas. An open task has its own box for
a **Note** to its next run, an **Ask** about it, or a **Change**.

### The menu on the left

| Place | What it is for |
| --- | --- |
| **Today** | Home: the box and your tasks. `H` |
| **Tasks** | The task board, with **All**, **Open**, **Review** and **Done** filters. `T` |
| **Plans** | Think a bigger idea through. Studio asks questions and writes a plan; once you approve it, you choose when to make its tasks. `P` |
| **Ideas** | Ideas the agents noticed. Nothing is built until you make one a task. `I` |
| **Map** | Your agents at work, live. **Live work**, on its right, lists what runs and what waits. `D` |
| **Team** | Who does the work, which AI each part uses (**Providers** holds your AI connections), and how much it may decide alone (**Permissions**). |
| **Friends** | Optional: **The Lobby**, **Rooms**, **Your PCs**, **Playground**, **Project hub** and **Events**. |
| **Search** | Find any page, setting, task or action by typing a few words. `Ctrl K` |
| **Settings** | Your name and startup (**General**), notifications, look (**Size and density** for bigger text), sound, updates and **Other apps**. `Ctrl ,` |
| **Help** | **Start here** (a guided tour in seven stops), **Setup guide** (every agent setting; **Quick setup** takes about two minutes), **Shortcuts** (`?`), **What's new**, **Report a problem** and the **Void Engine Discord**. |

Social lists these one by one and hides the menu on Today itself (from there,
use Search, a key, or the **+** beside the tabs). Studio groups them: **Work**
(Today, with Tasks, Plans, Ideas, Inbox, Analyzer and Worktrees as its
pages), **Map**, **Team** and **Friends**, with Settings and Help at the foot
and Search in the top bar. Each place lists its own pages when you open it.

The **top bar** holds **Search or run a command**, **All clear** or how many
things need you (it opens the **Inbox**: questions, permissions, approvals,
results to check and tasks that stopped), and the agents with their pause
button. The **status bar** at the bottom has **Layout**, your AI usage, this
PC's CPU and memory (it opens **Team › Resources**) and the permission mode.

### Permission modes

The permission mode is how much Studio may do without asking you. Change it
with the chip in the box (it reads **Auto** at first), at the right end of the
status bar, or in **Team › Permissions**.

| Mode | What happens to a new task |
| --- | --- |
| **Always ask** | Every new task, yours too, waits for your OK. |
| **Accept per task** | You OK each new task once. Then Mefi handles its ordinary questions. |
| **Auto** (the default) | Tasks start on their own, the agents' proposals too. Mefi answers what it is sure about. |
| **Elevated only** | Your tasks start on their own. Tasks the agents propose wait for your OK. |

### What each task state means

| Group | What it means | What to do |
| --- | --- | --- |
| **Needs you** | A question, a permission or an OK waits for you. | Answer it on the task or in the Inbox. |
| **Running** | An AI is working on it. | Watch, or leave it. **Stop** saves its progress and waits for you. |
| **Queued** | It waits its turn: for a free worker, for a task it depends on, or for the agents to start. Today shows it under **Running**, marked *up next*. | Usually nothing. If agents are off, press **Start agents**. |
| **Review** | Finished, and being checked. | Look at the changes, then **Approve and finish** or ask for changes. |
| **Done** | Finished. **Verified** means Studio's checks passed. | Try it. **Reopen** puts it back if something is wrong. |

## Every launch: choose the project, then start the agents

Studio shows the launch screen before it reads anything. Your projects are
listed, with the one you had open last already picked. Press **Open**.

- The **Start agents** switch beside **Open** decides whether the agents start
  too. With it off, no AI works and nothing is built until you say so. Today
  says **Agents are off**, and its **Start agents** button (or the play button
  in the top bar, or the tray icon's menu) starts them.
- **Settings › General › Agents when Studio opens** sets where the switch
  starts: **Resume what I had** (the default: on for a project whose agents
  were running when you left), **Start agents** or **Keep agents off**.

One launch skips the question: the one after work was cut short. If Studio
stopped while work was going (a crash, a forced close, a PC restart or its own
restart after an update) and that work was under ten minutes old, the next
launch reopens the same folder and says *Picking up where you left off*.
Agents that were running come back; agents that were held stay held.

Closing Studio yourself is the opposite: the next launch asks again. By
default the window's close button only tucks Studio into the tray (the small
icons by the clock), where running agents keep working. Open it again from the
tray icon, or choose **Quit** there to stop it. **Keep running in the tray when
the window closes** (**Help › Setup guide › Machine & app**) turns that off.

## Stuck? Ask Claude Code or Codex

If you already use Claude Code, Codex or another AI helper, it can walk you
through setup. Once Studio runs, **Copy setup prompt** (in **Settings › Other
apps**, and on the first page of **Help › Setup guide**) copies a prompt that
tells the helper where Studio is on this PC, what to read first and what to
leave alone. Paste it into the helper. It holds no keys.

If Studio isn't running yet, open a terminal in Studio's folder: the one with
`Mefi Studio AI+.exe`, or the source checkout with `main.cjs`. (In File
Explorer, click the address bar, type `cmd` and press Enter.) Start the
helper there (`claude` or `codex`) and paste this:

```text
I'm setting up Mefi's Studio AI+ on this PC and I'd like your help. Studio's
folder is the current folder: check that it holds either "Mefi Studio AI+.exe"
(the portable app; its app files, README.md included, are in resources/app)
or main.cjs and README.md (a source checkout). If it doesn't, ask me where I
put Studio.

Read README.md and GETTING_STARTED.md first (in resources/app for the portable
app), then walk me through setup one step at a time, in plain words:
1. Check what Studio needs: `git --version`, `node --version`,
   `gh auth status`, and the coding tools I might use (`claude --version`,
   `codex --version`, `opencode --version`). Tell me what is missing.
2. Help me start Studio: the .exe for the portable app, or `npm ci`, then
   `npm run build-booklet`, then `npm start` for a source checkout.
3. Help me connect one AI: a subscription I already pay for (Claude Code or
   Codex), OpenCode's free models, or an API key. On the first launch Studio
   asks "Pick the AI that builds for you"; later it is Team › Providers or
   Help › Setup guide. Tell me what to click.
4. Help me start or open my first project and give it one small, clear task.
5. If something fails, read the docs and Studio's log and tell me what went
   wrong.

Ground rules: never open, print, copy or edit my keys (auth.json, any .env
file, API keys or tokens): tell me where to paste them in Studio instead.
Change Studio's settings in Studio's own screens, not in its files. Ask me
before you install anything.
```

Once Studio runs, **Settings › Other apps** can also let those helpers talk to
Studio directly: see what the agents are doing, message Mefi and hand Studio
tasks, which wait for your OK. See [Other apps](docs/studio-api.md).

## New machine checklist

A new install opens with no project: nothing is read or built until you choose
a folder. Work through this list once; nothing starts on its own.

### Install what Studio needs

- **Windows 10 or 11.** Saved keys are protected by the Windows keystore
  (DPAPI).
- **Git** (recommended). Studio uses it for a new app's version history, to
  check a result that claims a commit, and to warn agents about unsaved work.
  **Friends › Your PCs** and worktree runs need it. Without Git, those checks
  are skipped.
- **A coding tool**: Claude Code (`claude`), Codex (`codex`), Grok (`grok`),
  Antigravity (`agy`) or OpenCode (`opencode`). The first launch can install
  one with **Install and sign in**. Without one, Studio still chats and plans,
  but nothing can be built.
- **Node 24 and npm**, only to run from source. `npm ci` downloads Electron
  once (about 110 MB) and stops with "Unsupported engine" on an older Node.
- **Python 3**, only for `npm test`. `python`, `py -3` or `python3` all work.
- **GitHub CLI (`gh`)**, optional. When it is signed in, Studio can reuse its
  token for private release updates instead of saving one.

### Get Studio running

- **Portable:** extract the whole `Mefi Studio AI+` folder before opening
  `Mefi Studio AI+.exe`, and keep its other folders beside it.
- **Source:** `npm ci`, then `npm run build-booklet`, then `npm start` from the
  repository root. `npm start` needs a normal shell: if `ELECTRON_RUN_AS_NODE`
  is set (some agent harnesses set it), clear it first, or Studio refuses to
  start and prints the fix.
- The browser preview (`npm run start:web`) cannot start coding tools or the
  game.

### Connect an AI

The first launch's welcome does this ([step 3](#3-pick-the-ai-that-builds-for-you)).
A new install also runs **auto setup** by itself: it looks at the keys, coding
tools and local model servers on this PC and picks a working setup, without
sending a request or changing a key. **Team › Providers** shows what it chose
and holds every connection; press **Run auto setup** there after you add a
key or a tool.

| What you have | Use | What it needs |
| --- | --- | --- |
| A Claude, ChatGPT, Grok or Google subscription | **Claude Code**, **Codex**, **Grok** or **Antigravity** | The tool installed and signed in. No key. |
| No subscription | **OpenCode** and its free models | OpenCode installed. No key. |
| OpenCode Go subscription | **OpenCode Go** | Its key |
| OpenCode Zen key | **OpenCode Zen** | Its key |
| z.ai coding plan | **z.ai GLM** | Its key |
| OpenRouter key | **OpenRouter** | Its key (free models included) |
| A model running on this PC | **LM Studio** | LM Studio running with a model loaded |
| Ollama or another OpenAI-compatible server | **Custom endpoint** | Its address; a key only if it asks. Auto setup finds Ollama on its usual port. |

- Paste a key into its tile under **Team › Providers** and press **Save**.
  Keys are encrypted with the Windows keystore in
  `%APPDATA%\Mefi's Studio AI+\auth.json`, apart from the `settings.json`
  preferences. They only work for the Windows account that saved them, so
  each person enters their own on each PC.
- **Decision model** (automatic model choice, optional, in Team › Providers)
  needs a key for its route: Vercel AI Gateway, TypeSafe, OpenCode Zen or
  OpenRouter. Without one, Studio uses fixed model defaults.
- No screen to type into? Store a key from the repository root, in PowerShell:

  ```powershell
  $env:MEFI_STUDIO_KEY = "<your OpenCode Go key>"
  npx electron . --set-key
  Remove-Item Env:MEFI_STUDIO_KEY
  ```

  The other flags are `--set-zai-key`, `--set-gateway-key`, `--set-jev-key`,
  `--set-zen-key`, `--set-openrouter-key` and `--set-custom-key`;
  [.env.example](.env.example) pairs each flag with its `MEFI_STUDIO_*_KEY`
  variable. Remove the variable once the key is stored: while it is set,
  Studio uses it instead of the saved key.

### Review the defaults

A new PC starts with these. Each stays on that PC, and each can be changed.

- The **permission mode** is **Auto**; see [Permission modes](#permission-modes).
- **Parallel builds** is **Machine managed**: as many coding workers as this
  PC can take. **Team › Overview** can cap it at one to three.
- Studio stops runaway test runs: idle for 240 seconds, older than 20 minutes
  or using more than 1,500 MB. On a small or busy PC, relax these in **Help ›
  Setup guide › Machine & app** rather than turning them off.
- Your name, the companion's name, **Open Today on launch**, **Always start in
  Social mode** and **Agents when Studio opens** are in **Settings ›
  General**. Themes and motion are in **Settings › Appearance**.

### Optional integrations

- **Ruins Runner (LÖVE)**: the author's game, a separate project. Once Studio
  finds a checkout, **Settings › System** shows an **Integrations** card that
  launches it. Set `MEFI_STUDIO_GAME_ROOT` when it is not a sibling
  `2d Trippy Hell` folder, and run the game's `tools/build-windows.ps1` once
  if its LÖVE runtime is missing.
- **Discord Server Styler**: its card appears under **Settings › System** once
  Studio finds the separate checkout: a sibling `discord-server-styler`
  folder, or the path in `MEFI_STYLER_ROOT`.
- **A different working repository**: set `MEFI_STUDIO_REPO`. Otherwise Studio
  opens with no project until you choose a folder.
- **Private release updates**: save a read-only GitHub token in **Settings ›
  Updates** (**Save token**), set `MEFI_STUDIO_GITHUB_TOKEN`, or let Studio
  reuse the signed-in `gh` token.

### What not to copy between machines

Settings, keys, tasks, conversations, captures and databases are local state
and do not travel; only `data/curated.json` and `data/models.json` belong to
the repository. On one PC, a source install and a portable build keep their
own tasks, ideas, plans and conversations (each in its own `data/` folder;
`resources\app\data` in the portable build) but share
`%APPDATA%\Mefi's Studio AI+`: settings, saved keys, the project list, the
Discord link and resume state. So only one of the two runs at a time. Never
copy `auth.json` to another PC: its encrypted fields cannot be decrypted
there. `settings.json` holds only preferences, but it is still local state.

## Download and data notes

- A downloaded release starts with the public model catalog only: none of the
  maintainer's projects, conversations or keys. Ruins Runner is installed
  separately.
- Back up the install's `data/` folder and `%APPDATA%\Mefi's Studio AI+`
  before you move an installation.
- Coming from 0.4.4? It cannot update itself: move by hand, as the README's
  [Updating from 0.4.4](README.md#updating-from-044) explains. From 0.5 on,
  Studio updates itself (**Settings › Updates**).

More to read: [Unified Studio](docs/unified-studio.md) (the window and the two
modes), [the glossary](docs/architecture.md#glossary) (Studio's own words) and
[Guided CLI setup](docs/cli-setup.md) (coding tools and their account limits).
