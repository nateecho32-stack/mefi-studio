# Your first project in Mefi's Studio AI+

The in-app walkthrough opens automatically on your first launch and explains
the five steps below. You can close it whenever you want; it remembers your
place and stays closed on later launches. Choose **Start here** in the sidebar
or open the guide from Help to continue.

Each lesson has a **Walk me…** button. It keeps a small coach in the corner
while it opens the matching menu with you and highlights the exact control: the
project **+**, the connection groups, the task box, Live work, and Review. Press
**Done — next stop** and the coach travels to the next menu; the first stop ticks
itself off as soon as you select a project. **Esc** or **End tour** puts the
coach away, and the setup trail under the workspace invitation shows what is
done. Reading the guide never creates or starts work, so nothing runs until you
do it yourself.

## Every launch: choose the project, then start the agents

Studio opens on a launch screen before it reads anything. Pick the project to
open (the one you last had open is preselected) or **Open another folder…**,
then choose **Open studio** or **Open and start agents**. With **Open studio**
the assistant and the coding workers stay off: the companion bar reads *Agents
are waiting for you*, and its **Start agents** button (also in the tray menu)
releases them whenever you are ready. Nothing is built, briefed or spent
before that. A pause you saved earlier still stands and asks for **Resume** as
before, and a renderer reload never shows the screen twice in one launch.

## New machine checklist

A newly installed Studio opens with no project at all: nothing is read or built
until you choose a folder. Work through this list once; only the first two
sections are required, and nothing starts on its own.

### Install what Studio needs

- **Windows** — Studio is built for Windows, and its saved keys are protected
  by the Windows keystore (DPAPI).
- **Node 24 and npm** — needed for a source install only; `npm ci` downloads
  Electron once (about 110 MB). A portable download needs neither.
- **Git** — needed only to clone this repository. **Python 3** is needed only
  for the test contracts (`npm test`).
- **A builder CLI (optional)** — `opencode` is the preferred coding worker;
  `grok`, `claude` and `agy` (Antigravity) are detected too. Studio connects
  without one, but no build can start until one is installed and signed in.
- **`gh` (optional)** — when GitHub CLI is signed in, Studio can reuse its
  token for private release updates instead of saving one.

### Get Studio running

- Source: `npm ci`, then `npm run build-booklet`, then `npm start` from the
  repository root. `npm start` needs a normal shell: if `ELECTRON_RUN_AS_NODE`
  is set (some agent harnesses set it), clear it first or Studio refuses to
  start and prints the fix.
- Portable: extract the entire `Mefi Studio AI+` folder before opening
  `Mefi Studio AI+.exe`, and keep its supporting folders beside it.
- The browser fallback (`npm run start:web`) cannot run desktop workflows such
  as launching builders or the game.

### Open your first folder

Add a folder in **Projects** with **+**, or choose **Open a folder** in the
sidebar. The first folder you open becomes the active project, and Studio scans
it locally — no AI request — showing old plans and starting points in
**Analyzer**. Later folders are added alongside; select one to switch, and
**Remove project** drops a folder from the list without touching its files
(opening it again restores it).

### Connect one assistant and one builder

A fresh install runs **auto setup** by itself on its first launch, from the
keys, CLIs and local servers already on the machine, and Settings says what it
chose. Open **Settings & connections** to review that choice, press **Run auto
setup** again after adding a key or CLI, or pick a route yourself. The
assistant (conversation) and the builder (coding work) are separate
capabilities: a saved key alone never proves a build can start.

| What you have | Choose | What it needs |
| --- | --- | --- |
| z.ai coding plan | **z.ai GLM** | a saved z.ai key |
| OpenCode Go subscription | **OpenCode Go** | its saved key |
| Grok, Claude Code or Antigravity login | that CLI | the CLI on PATH, no key |
| A local model server | **LM Studio (local)** | LM Studio running with a loaded model |
| Another OpenAI-compatible server | **Custom endpoint** | endpoint URL and key |

- **Jev model selection** needs a key for its route (Vercel AI Gateway,
  TypeSafe, OpenCode Zen or OpenRouter); without one Studio uses fixed model
  defaults. Without any connection, the catalog, manual planning and saved work
  still function.
- Keys are encrypted with the Windows keystore inside
  `%APPDATA%\Mefi's Studio AI+\settings.json` and are bound to the Windows
  account that saved them. A new user enters their own keys — copying the file
  between machines does not work. Headless installs can pass keys with
  `electron . --set-key`, `--set-zai-key`, `--set-gateway-key`,
  `--set-jev-key`, `--set-zen-key`, `--set-openrouter-key` and
  `--set-custom-key`; the README's Keys section pairs each flag with its
  `MEFI_STUDIO_*_KEY` variable.
- Models are saved per provider and per builder CLI, so switching routes never
  carries one provider's model id into another.

### Review the defaults

These ship on and are the choices most worth a look on another machine; every
one stays editable in **Settings & connections** or the workspace.

- **Auto build** is on by default. Turn it off for **Verify first** when a new
  user should approve each task before it runs.
- **Parallel builds** follows **Machine managed** admission; manual limits of
  one to three workers suit a machine dedicated to Studio.
- **Proactive** briefings, **useWeb**, **auto reference** and the machine
  guards (auto-kill strays, 240 idle seconds, 20-minute age, 1.5 GB) are on.
  Relax the guards on a small or busy machine rather than switching them off.
- **Your name**, the **companion name**, **Studio theme** and the movement
  preference live under **Make yourself at home** and stay per machine.

### Optional integrations

- **Ruins Runner (LÖVE)** — the Studio tab launches the game checkout when one
  is found. Set `MEFI_STUDIO_GAME_ROOT` when it is not a sibling `2d Trippy
  Hell` folder, and run the game's `tools/build-windows.ps1` once if its LÖVE
  runtime is missing.
- **A different working repository** — set `MEFI_STUDIO_REPO`; otherwise Studio
  opens with no project until a folder is chosen.
- **Private release updates** — save a read-only GitHub token in **App
  updates**, set `MEFI_STUDIO_GITHUB_TOKEN`, or let Studio reuse the `gh`
  token.

### What not to copy between machines

Settings, keys, tasks, conversations, captures and databases are local state
and do not travel. Only `data/curated.json` and `data/models.json` belong to
the repository, and a source install and a portable build keep separate local
stores. Never copy `settings.json` to another machine: its encrypted fields
cannot be decrypted there. Build the new machine's own state with the steps
above.

## 1. Choose the folder you want to work on

In **Projects**, choose **+** and select an existing project folder. The first
folder you open becomes the active project; Studio scans it locally and shows
what it found in **Analyzer**. Check the name and folder above the conversation.
Later folders are added to the sidebar — select one to switch. Tasks,
conversations, plans and references belong to that project. For your first run,
use a small project whose changes you can easily inspect.

Choose **Auto build** in the guide or in the backlog panel under **Your work**.
It is on by default.
Turn it off for **Verify first** if you want to choose what gets built. This
preference is saved for all projects and can be changed at any time.

## 2. Connect your tools

Open **Settings & connections**. A fresh install already ran auto setup once on
its first launch; configure your assistant connection and coding provider using
the connection controls there, or choose **Run auto setup** to apply a
configuration from the keys, CLIs and local servers already on this machine. The setup overview above the controls shows what was detected; auto
setup explains each choice and never sends a request or changes a saved key.
You do not need every option: save the model for the provider you actually
have (models are kept per provider, so switching never mixes them), and the
readiness line names what the selected option has. Conversation and coding
are separate capabilities: saving an assistant key alone does not prove a coding
worker can start. Read the connection result before starting a task. The model
catalog, manual planning and browsing saved work remain available without AI.

## 3. Give one clear task

Choose **Give a task**, describe the intended change and what would count as
done, then choose **Create task**. **Use a task outline** adds space for the
goal, acceptance checks and boundaries. For example:

```text
Add a clear empty state to the saved notes list.

Done when:
- With no saved notes, show a short explanation and a Create note button.
- Creating a note replaces the empty state with the normal list.
- The layout works in the smallest supported window.

Keep unchanged:
The existing note format and save location.
```

Chat and task drafts are saved separately for each project. After creation,
**View task** opens the saved brief and status. A failed board refresh does not
mean creation failed; use **Retry loading** before adding the same work again.
If scheduling is paused, the task waits until you choose **Resume**.
With **Verify first**, open the task in **Review**, inspect its full brief,
files and prerequisites, then choose **Approve build**. Leave it waiting if
you do not want to build it. Editing the scope or explicitly retrying requires
approval again. Approval does not override Pause or unfinished prerequisites.

Use **Talk together** for discussion. Use **Plan an idea** when the approach is
unclear or the work has several dependent steps. In Plans, settle the questions,
review the specification, approve it, then explicitly create its tasks.

## 4. Follow the work

The strip at the top of the workspace shows the service state, running
workers, what needs you, what is next, the machine and today's usage; its
**Pause** button holds all new work until you press **Resume**.

**Your work** gives you All, Queue, Ideas, Review and Done views. **Command
view** in the sidebar opens
Command, where **Live work** shows running workers, reported steps and queue
readiness, and the **Agents** tab holds Autopilot, Parallel builds, Build mode
and Agent mode with an at-a-glance strip above them. Open a task to inspect its brief, dependencies, attempts and evidence.

| What you see | What it means | Next step |
| --- | --- | --- |
| Ready | Eligible for scheduling | Check Pause, the coding connection and any dispatcher hold |
| Awaiting build approval | Verify first is holding unapproved work | Review the full task and choose Approve build, or leave it waiting |
| Working | A worker has started | Follow its reported activity and inspect the result when it finishes |
| Waiting on prerequisites | Required tasks are unfinished | Open the named prerequisite |
| Retry scheduled | A failed attempt is cooling down | Inspect the failure and displayed retry time |
| Needs attention | A blocker or retry limit needs a decision | Open the task and correct the cause before retrying |
| Awaiting verification | The attempt finished but completion is not established | Review checks, evidence and delegated work |
| Done | Verified or explicitly confirmed complete | Read the result and inspect the actual project change |

**Work through backlog** admits saved ideas in small batches alongside existing
tasks. Independent tasks can use **Parallel builds**; shared files and unfinished
prerequisites can make a task wait even when another worker slot is available.

## 5. Review and recover

Open **Review** for unfinished verification and blocked tasks. A worker's exit
alone does not prove the intended behavior works. Read the evidence, run the
project's relevant checks and try the changed workflow before accepting it.

**Pause** stops new scheduling while current jobs finish. It does not cancel
them. If work stops progressing, read its last activity and the scheduling
reason before retrying. A worker that cannot be confirmed stopped retains its
file ownership, preventing another attempt from writing over it. Follow the
reported recovery instructions; do not delete task records or ownership files
to force another run. An unresponsive external operation can still require
restarting Studio after the external process is stopped.

Use **Settings & connections** for connection errors, **Tasks** for prerequisites
and retry limits, and **Session explorer** for session details. **Ctrl K** finds
tools, **H** returns home, **D** opens Command and **Esc** closes the current layer.

## Download and data notes

For a published Windows portable release, extract the entire application folder
before opening `Mefi Studio AI+.exe`; keep its supporting folders beside it.
Source installs use `npm ci`, `npm run build-booklet`, then `npm start` from the
repository root. The browser preview cannot run local desktop workflows.

Source and portable installations retain separate local project stores. Back
up the installation's local data before moving it. A downloaded release begins
with the public model catalog; it does not contain the maintainer's projects,
conversations or credentials. Ruins Runner is optional and is installed separately.
