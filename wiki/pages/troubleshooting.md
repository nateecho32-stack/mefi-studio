# Troubleshooting

Start with the message Studio shows for the task or connection. If these steps don't help, [report the problem](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) with your version, install type and the steps that cause it. [Trace, logs and diagnostics](trace.md) shows what to gather first.

## The portable app will not open

1. Extract the entire zip with **Extract All…**. Don't run the app from inside the zip.
2. Open `Mefi Studio AI+.exe` in the extracted folder, and keep its supporting files beside it.
3. If Windows SmartScreen blocks it, check that you downloaded the official release and [verify its SHA-256](../../download.html#verify). The build isn't code-signed, so after checking it, **More info › Run anyway** opens it.

## A different install came forward

A portable build and a source install on the same Windows account share their settings, so only one of them runs at a time. Opening the second one brings the running one forward instead. Quit the running one first, from its tray icon, if you want the other.

## An update doesn't install

Coming from 0.4.4? Its in-app update downloads and verifies the new release, but the step that installs it after Studio closes never runs, so the old version stays in place. Update by hand this once:

1. Quit Studio from its tray icon.
2. Extract the new release zip into a **new** folder.
3. Copy everything in the old folder's `resources\app\data` into the new one's `resources\app\data`, except `curated.json` and `models.json`. Those hold the new release's model catalog.
4. Open `Mefi Studio AI+.exe` in the new folder.

Settings and saved keys live in `%APPDATA%\Mefi's Studio AI+`, so they carry over by themselves. [Updates](updates.md#update-from-044-by-hand) has the full steps. From 0.5 on, updates install themselves. If a new build misbehaves, **Roll back** in **Settings › Updates** puts back the one before.

## Agents are off or not starting

Read the line under the box on Today. It names what's holding the agents and offers the one button that clears it:

| The line says | What it means | Press |
| --- | --- | --- |
| **Agents are off** | Studio opened with the agents off. | **Start agents**. The play button in the top bar and the tray icon's menu start them too. |
| **Agents paused** | New work is on hold. | **Resume agents** |
| **No AI connected** | There's no working AI yet. | **Connect an AI**, or see [Connect an AI](connections.md). |
| **No project open** | Agents have nowhere to work. | **Open a project** |
| **Agents are cooling down** | Workers failed to start several times in a row. | **Try now** |
| **The work scheduler is stuck** | Its last pass ran past its time limit. | **Restart Studio** |
| *N* **tasks need your OK** or **your review** | Tasks wait for you. | **Review tasks** |

The same status shows everywhere, so the parts of Studio never disagree. **Settings › General › Agents when Studio opens** decides whether agents start on launch.

## A connection or coding agent is not ready

Open **Help › Start here** and use **Check connection** for the tool you picked. Finish its sign-in if it asks. **Team › Overview › Check connections** takes you to **Team › Providers**, and `Ctrl K` finds them too.

Studio finds a tool you install while it's open, so you don't need to restart it: choose **Refresh installed tools**, then **Check connection**. If the setup window doesn't work for you, [sign in from a terminal](connections.md#sign-in-from-a-terminal).

A working chat connection doesn't prove the coding worker is ready, so check the coding tool as well. If it still fails, run that tool in a terminal and read its error before you retry in Studio.

> <span class="status next">New in 0.5</span> A new install starts with a short welcome that lists the coding tools on this PC and marks one that's installed but not signed in, and the [setup helper](setup-helper.md) offers **Set up automatically**. With no coding tool installed, **Start agents** says to install OpenCode, Claude Code or Codex, and a run that fails that way says the tool "is not installed or not on PATH".

## A Claude Code or Codex login hit its limit

Work waits until your plan's limit resets, without using up the task's tries. <span class="status next">New in 0.5</span> Add a second login under **Your subscriptions** in **Team › Providers**, or the setup helper's **Connect an AI › More than one login**. Studio then moves to the next login when one reaches its limit. See [Connect an AI](connections.md#more-than-one-login).

## A task stays Ready

Open the task and read its waiting reason. Then check that:

1. The agents are running and new work isn't paused.
2. The selected coding tool is connected.
3. Any approval the task needs has been given.
4. Its prerequisite tasks are done.
5. No other worker is using the same files, and the worker limit has room for another run.

Studio may also wait while the PC is busy, or while a failed connection cools down. Creating the task again won't clear that wait.

> <span class="status next">New in 0.5</span> A ready task that won't start says why: new work is paused, the agents are cooling down, the scheduler is stuck, the task needs your OK in the current [permission mode](permissions.md), the free coding model runs one task at a time, or it waits for a running worker with the same title. A task you put off reads **Scheduled for later**. With a cowork room linked to the project, a task also waits while another PC holds its files.

## I created a task but it did not appear

Use **Retry loading** before you create it again. A failed board refresh can hide a task that was saved.

## A task says Needs attention

Read the failure and the agent's question. Answer it in the Inbox (`Ctrl J`), fix the cause, then retry. Check the selected project and connection before running the same attempt again.

If Studio reports a prerequisite cycle, edit the tasks so they no longer depend on each other in a loop.

## A task says Verifying

The worker finished, but Studio doesn't have enough evidence yet that the task is done. Open the task and read its checks and evidence. If automatic checks can't run, test the result yourself and confirm it only once it does what you asked. See [Verification](verification.md).

Studio checks builds from every coding tool with its own checks. <span class="status next">New in 0.5</span> In 0.4.4, work built by Claude Code, Codex, Grok or Antigravity usually waited for you to confirm it yourself.

## Old questions stay in Needs you

Answered questions leave the list at once. Questions older than two days, or about a task that left the board, close when the project loads. **Clear list**, in your companion's **Needs you** bubble, takes stuck items off the list until something new happens to them.

<span id="studio-switched-to-command-view-by-itself"></span>

## Studio switched to the Map by itself

That's **Show the Map after 5 quiet minutes**, in **Settings › General**. It's off by default: turn it off, and Studio stays on the page you left. Before 0.5, Studio always switched to the Map, then called the Command view, after five quiet minutes.

## A worker will not stop

Follow the recovery steps Studio shows. Don't delete task or ownership records to start a second worker on the same files. If an outside process is stuck, stop that process before you restart Studio.

## The window went blank or disappeared

If you closed the window, look for Studio in the Windows tray. If the window went blank, give the app a moment to recover, then restart it if needed. Don't delete its data folder as a fix. If it keeps happening, report the error and what you were doing.

## My saved connection does not work on another PC

Sign in or enter the key again on that PC. Saved keys are protected by the Windows account that saved them, so copying `auth.json` or `settings.json` won't move a login.

> <span class="status next">New in 0.5</span> **Friends › Your PCs › Share between my PCs** can move keys and setup to your other PC's protected storage, after you type a confirmation. See [Your PCs](your-pcs.md).

## Sync this PC doesn't sync

**Friends › Your PCs › Sync this PC** works only on the project's default branch, while that branch is checked out, and only in two safe ways: it fast-forwards, or it pushes without force. It never merges histories that went apart, rebases, stashes or throws anything away. When something needs you, such as edits a pull would overwrite, it lists what's left to do.

> <span class="status next">New in 0.5</span> Sync pushes only after the project's own `npm run check` passes. When both this PC and GitHub moved, **Put my commits on top of GitHub's** combines them; on a conflict it changes nothing and names the files. A lapsed GitHub sign-in shows as a problem instead of "offline". **Set up this PC** flags a drive that can't hold Git worktrees, such as exFAT or FAT.

## The app behaves oddly in OneDrive

A synced folder can lock files while it uploads them. Try keeping the Studio folder outside OneDrive. Back up your data before you move an installation, because a new copy has its own project store.

## I cannot join a shared listening room

Rooms and Listen together run on the Mefi Studio relay, which is built into Studio, so there's no address to enter. Sign in with Discord in Friends; your account needs to be in the Void Engine server. When Friends can't connect, it says why in one sentence and offers only what helps: sign in again, update Studio, join the Discord or connect. See [Friends, rooms and playdates](friends-and-rooms.md).

Still on 0.4.4? Its Listen together has no room service to connect to, and reinstalling won't change that. [Update to 0.5](updates.md#update-from-044-by-hand). The music player itself works without it.

## `npm start` says Electron is running as Node

For a source install, clear the variable in the same PowerShell window and start again:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

Run the command from the Studio application folder. The browser preview from `npm run start:web` can't launch coding agents: use the desktop app for that.

## `npm ci` or the tests stop before they start

A source install runs `main`, where `npm ci` stops on a Node.js older than 24 and downloads Electron itself. `npm test` needs Python 3, found as `python`, `py -3` or `python3`, and the Electron tests need a real desktop. Read [TESTRUNS.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/TESTRUNS.md) for setup and known flaky runs. `npm run test:fast` runs the Node suites without Electron while you work, but it doesn't replace the full checks.
