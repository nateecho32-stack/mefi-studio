# Troubleshooting

Start with the message Studio shows for the task or connection. If these steps do not help, [report the problem](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) with your version, install type and steps to reproduce.

## The portable app will not open

1. Extract the entire ZIP with **Extract All…**. Do not run the app from inside the ZIP.
2. Open `Mefi Studio AI+.exe` in the extracted folder, keeping the supporting files beside it.
3. If Windows SmartScreen blocks it, check that you downloaded the official release and [verify its SHA-256](../../download.html#verify). The build is not code-signed; after checking it, **More info → Run anyway** lets you open it.

## “Agents are waiting for you”

**Open studio** opens the project with agents off. Press **Start agents** when you are ready. If you previously paused work, use **Resume**.

## A connection or coding agent is not ready

Open **Start here** and use **Check connection** for the agent you selected. Complete its sign-in if needed. You can also search Studio with `Ctrl+K` to find its connection settings.

A working assistant connection does not prove the builder is ready. Check the coding agent separately. If it still fails, try that CLI directly in a terminal and read its error before retrying in Studio.

## A task stays Ready

Open the task and read its waiting reason. Then check:

1. Agents are running and new work is not paused.
2. The selected builder is connected.
3. Any required build approval has been given.
4. Prerequisite tasks are complete.
5. Another worker is not already using the same files, and the worker limit has room for another run.

Studio may wait while the machine is busy or a failed connection cools down. Repeatedly recreating the task will not clear that wait.

## I created a task but it did not appear

Use **Retry loading** before creating it again. A failed board refresh can hide a task that was saved successfully.

## A task says Needs attention

Read the failure and the agent's question. Answer it in **Needs you** or **Ask**, fix the reported cause, then retry. Check the selected project and connection before running the same attempt again.

If a prerequisite cycle is reported, edit the tasks so they no longer depend on each other in a loop.

## A task is Awaiting verification

Open **Review** and read the checks and evidence. A worker saying it finished is not enough to mark a task done. If automatic verification cannot run, test the result yourself and confirm only after it meets the request. See [Verification](verification.md).

## A worker will not stop

Follow the recovery steps shown by Studio. Do not delete task or ownership records to start a second worker on the same files. If an external process is stuck, stop that process before restarting Studio.

## The window went blank or disappeared

If you closed the window, look for Studio in the Windows tray. If the window went blank, allow the app a moment to recover, then restart it if needed. Do not delete its data folder as a repair step. Include the error and what you were doing in a bug report if it repeats.

## My saved connection does not work on another PC

Sign in or enter the key again on that PC. Saved credentials are protected by the Windows account that created them. Copying `auth.json` or `settings.json` is not a way to transfer a login.

## The app behaves oddly in OneDrive

A synced folder can lock files while uploading them. Try keeping the Studio installation outside OneDrive. Back up local data before moving an installation; a new copy has its own project store.

## I cannot join a shared listening room

The personal media player is available in 0.4.4. Synced rooms and the app's Discord connection are still rolling out, so those controls may be unavailable in your build. Reinstalling does not enable a service that has not been configured for that release.

## `npm start` says Electron is running as Node

For a source install, clear the variable in the same PowerShell window and start again:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm start
```

Run the command from the Studio application folder. The browser preview from `npm run start:web` cannot launch coding agents; use the desktop app for that.

## Application tests stop before they start

`npm test` needs Python 3 available as `python`, and Electron tests need a usable desktop. Read the repository's [TESTRUNS.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/TESTRUNS.md) for setup and known environmental failures. `npm run test:fast` runs the Node suites without Electron while you iterate; it does not replace the full checks.
