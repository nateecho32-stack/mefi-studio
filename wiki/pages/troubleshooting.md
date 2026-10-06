# Troubleshooting

Start with the message Studio shows for the task or connection. If these steps don't help, [report the problem](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) with your version, install type and the steps that cause it. [Trace, logs and diagnostics](trace.md) shows what to gather first.

## The portable app will not open

1. Extract the entire zip with **Extract All…**. Don't run the app from inside the zip.
2. Open `Mefi Studio AI+.exe` in the extracted folder, and keep its supporting files beside it.
3. If Windows SmartScreen blocks it, check that you downloaded the official release and [verify its SHA-256](../../download.html#verify). The build isn't code-signed, so after checking it, **More info › Run anyway** opens it.

## A different install came forward

A portable build and a source install on the same Windows account share their settings, so only one of them runs at a time. Opening the second one brings the running one forward instead. Quit the running one first, from its tray icon, if you want the other.

## An update doesn't install

In 0.4.4, the in-app update downloads and verifies the new release, but the step that installs it after Studio closes never runs. The old version stays in place. Update by hand instead:

1. Quit Studio from its tray icon.
2. Extract the new release zip into a **new** folder.
3. Copy everything in the old folder's `resources\app\data` into the new one's `resources\app\data`, except `curated.json` and `models.json`. Those hold the new release's model catalog.
4. Open `Mefi Studio AI+.exe` in the new folder.

Settings and saved keys live in `%APPDATA%\Mefi's Studio AI+`, so they carry over by themselves. [Updates](updates.md#update-from-044-by-hand) has the full steps. <span class="status next">New in 0.5</span> The install step works, so updates from 0.5 on install themselves.

## Agents are off or not starting

Read the line under Vibe's box, or the status at the top of Home in Build mode. It names what's holding the agents and offers one button:

- **Waiting for you** means Studio opened with the agents off. Press **Start agents**. The tray icon's menu has **Start agents** too.
- **Paused** means new work is on hold. Press **Resume**.
- **No AI connected** means there's no working AI yet. Press **Connect an AI**, or see [Connect an AI](connections.md).

> <span class="status next">New in 0.5</span> One status explains every hold, everywhere, with the one button that clears it: **Agents are off** (**Start agents**), **Agents paused** (**Resume agents**), **No AI connected** (**Connect an AI**), **No project open** (**Open a project**), **Agents are cooling down** after failed starts (**Try now**), **The work scheduler is stuck** (**Restart Studio**), and tasks that need your OK or review (**Review tasks**). **Settings › General › When Studio opens** decides whether agents start on launch.

## A connection or coding agent is not ready

Open **Help › Start here** and use **Check connection** for the tool you picked. Finish its sign-in if it asks. **Agents › Overview › Check connections** takes you to the connection settings, and `Ctrl K` finds them too.

In 0.4.4 the guided **Install and sign in** window may close as soon as it opens. [Sign in from a terminal](connections.md#sign-in-from-a-terminal), then choose **Refresh installed tools** and **Check connection**. Studio finds a tool you install while it's open, so you don't need to restart it.

A working chat connection doesn't prove the coding worker is ready, so check the coding tool as well. If it still fails, run that tool in a terminal and read its error before you retry in Studio. In 0.4.4, a missing coding tool can show up as "'opencode' is not recognized".

> <span class="status next">New in 0.5</span> A new install starts with a short welcome that lists the coding tools on this PC and marks one that's installed but not signed in, and the [setup helper](setup-helper.md) offers **Set up automatically**. With no coding tool installed, **Start agents** says to install OpenCode, Claude Code or Codex, and a run that fails that way says the tool "is not installed or not on PATH".

## A Claude Code or Codex login hit its limit

Work waits until your plan's limit resets. <span class="status next">New in 0.5</span> Add a second login under the setup helper's **Connect an AI › More than one login**. Studio then moves to the next login when one reaches its limit. See [Connect an AI](connections.md#more-than-one-login).

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

Read the failure and the agent's question. Answer it in **Needs you** or **Ask**, fix the cause, then retry. Check the selected project and connection before running the same attempt again.

If Studio reports a prerequisite cycle, edit the tasks so they no longer depend on each other in a loop.

## A task says Verifying

The worker finished, but Studio doesn't have enough evidence yet that the task is done. Open the task and read its checks and evidence. If automatic checks can't run, test the result yourself and confirm it only once it does what you asked. See [Verification](verification.md).

In 0.4.4, work built by Claude Code, Codex, Grok or Antigravity usually waits for you to check and confirm it, because Studio can't read those runs yet. <span class="status next">New in 0.5</span> Studio checks those builds with its own checks.

## Old questions stay in Needs you

In 0.4.4, **Clear list** in the companion's list takes stuck items off it until something new happens to them.

> <span class="status next">New in 0.5</span> Answered questions leave the list at once. Questions older than two days, or about a task that left the board, close when the project loads.

## Studio switched to Command view by itself

In 0.4.4, Studio switches to Command view after five quiet minutes. Move the mouse or press a key to get back to work. <span class="status next">New in 0.5</span> The Command view is called the Map, and opening it after five quiet minutes becomes a switch in Settings, off by default.

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

In 0.4.4, Listen together has no room service to connect to: the message reads "this build isn't connected to one yet", and reinstalling won't change that. The music player itself works without it.

> <span class="status next">New in 0.5</span> Rooms and Listen together run on the Mefi Studio relay, which is built into Studio, so there's no address to enter. Sign in with Discord in Friends; your account needs to be in the Void Engine server. When Friends can't connect, it says why in one sentence and offers only what helps: sign in again, update Studio, join the Discord or connect. See [Friends, rooms and playdates](friends-and-rooms.md).

## `npm start` says Electron is running as Node

For a source install, clear the variable in the same PowerShell window and start again:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

Run the command from the Studio application folder. The browser preview from `npm run start:web` can't launch coding agents: use the desktop app for that.

## `npm ci` or the tests stop before they start

A source install runs `main`, where `npm ci` stops on a Node.js older than 24 and downloads Electron itself. `npm test` needs Python 3, found as `python`, `py -3` or `python3`, and the Electron tests need a real desktop. Read [TESTRUNS.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/TESTRUNS.md) for setup and known flaky runs. `npm run test:fast` runs the Node suites without Electron while you work, but it doesn't replace the full checks.
