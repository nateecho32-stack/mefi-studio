# Troubleshooting

Short entries, most common first. If yours is missing, the [community page](../../community.html) explains how to report it.

## Studio refuses to start and prints a fix

`npm start` needs a normal shell. If `ELECTRON_RUN_AS_NODE` is set, as some agent harnesses do, Studio refuses to start and prints the fix. Clear the variable and start again:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE
npm start
```

## The portable exe does nothing or complains about missing files

Extract the whole zip first. Right-click it, choose **Extract All…**, and open `Mefi Studio AI+.exe` from the extracted folder with its supporting folders beside it.

## Windows SmartScreen blocks the exe

The build is not code-signed, so SmartScreen may show "Windows protected your PC" once. Verify the `.sha256` digest as described on the [download page](../../download.html#verify); if it matches, choose **More info → Run anyway**.

## "Agents are waiting for you"

You chose **Open studio**, which keeps the assistant and the coding workers off. Press **Start agents** in the companion bar or the tray menu. A pause you saved earlier asks for **Resume** instead.

## Studio reopened a folder without asking

That is session continuity: work was interrupted less than ten minutes ago by a crash, a reboot or an update restart, so Studio picked up where it left off. Closing Studio yourself ends the sitting, and the next launch asks again.

## I created a task but the board did not update

A failed board refresh does not mean creation failed. Use **Retry loading** before adding the same work again, or the task will be duplicated.

## A task stays Ready and nothing starts

Check, in order:

1. Is new work **paused**? The workspace strip and Command view's **New work** switch share one hold.
2. Is a **builder** actually ready? A saved assistant key alone never proves a builder can start; read the readiness line in **Settings & connections**.
3. Is **Verify first** on? The task waits for **Approve build** in Review.
4. Is **Machine managed** admission holding starts because Studio is laggy? Wait, or set a manual worker limit.
5. Does the task share files with a running worker, or wait on a prerequisite? Open the task; the reason is shown.
6. On the **Free** coding tier, workers run one at a time.
7. **In source**, a provider that failed three times in a row is paused for 30 seconds; the connection log names it.

## A task says Waiting on prerequisites or reports a cycle

Open the named prerequisite and finish or correct it. Dependency cycles are surfaced on the board; break one by editing the prerequisites.

## A task Needs attention

A blocker or the retry limit needs a decision. Read the failure and correct the cause before retrying; retrying unchanged repeats the failure. If an agent asked a question, answer it in **Ask**.

## An attempt sits in Awaiting verification

Completion is not established until its checks have a recorded successful run in that attempt's session and time window. Unavailable evidence waits without spending a retry. Read the checks and evidence in **Review**, run the project's checks yourself, and confirm the task if it is genuinely done.

## A worker never starts, or a slow CLI keeps getting killed

A run that prints nothing and registers no session within the start budget is killed. That does not spend one of the task's five tries: start failures requeue on a cooldown of 1, 2, 4 and up to 30 minutes. **In source**, the budget learns from runs that do start, so a CLI that reliably needs a few minutes to speak is no longer killed every time. Check that the builder CLI is signed in and works on its own first.

## My manual worker limit dropped to one

In v0.2.0, each stalled worker start in manual mode lowered the pool by one and saved it as your setting. **In source**, the pool narrows for the session only and steps back up after three normal starts, and your saved limit is never touched. A limit an earlier version already lowered stays saved: set it back once in the workspace, under **Parallel builds**.

## A chain of handed-off tasks never finishes

**In source** this is fixed: a run at the chain's depth limit that still asks to hand off has the request declined and named on the card's log, instead of leaving an obligation nothing can discharge. On v0.2.0, confirm or re-plan the stuck parent by hand.

## A worker will not stop

A worker that cannot be confirmed stopped keeps its file ownership so no other attempt writes over its files. Follow the reported recovery steps; do not delete task records or ownership files to force another run. If an external operation is unresponsive, stop that process first, then restart Studio.

## The window went blank or disappeared

If the renderer process dies while the host is alive, bounded renderer recovery restores the saved workspace. If it does not, restart Studio; the saved workspace comes back. The failure diagnostics hold no content and are safe to attach to a bug report.

## Live update says it is on hold

A broken file, or three restarts within a minute, holds the update instead of crashing the app. Fix the file; changed scripts are syntax-checked first, so the log names it. Then apply the update from **Settings › Updates & diagnostics**.

## The board or stores misbehave inside OneDrive

Synced folders can lock files while they upload. Keep the board's SQLite store outside the synced tree with `MEFI_STUDIO_BOARD_DB`, or keep the installation itself outside OneDrive.

## My keys stopped working on another machine or account

Keys are bound to the Windows account that saved them and cannot be decrypted elsewhere. Enter them again on the new machine; never copy `auth.json` or `settings.json`.

## The usage tracker says "unpriced"

A plan or subscription reports no per-call cost, so those calls are unpriced rather than free. Builder runs on the Grok, Claude and Antigravity CLIs report no tokens at all.

## Launching Ruins Runner fails with "is not recognized"

This was a quoting bug in how the launch line reached `cmd.exe`, and it is fixed in source. On v0.2.0, launch the game with its own `.cmd` files for now. See [Ruins Runner](ruins-runner.md).

## `npm test` stops before running anything

`npm test` needs Python 3 on PATH as `python` and says so when it is missing. Use `npm run test:fast` for the Node suites alone. The two Electron fixtures are timing-sensitive and need a real, unlocked desktop.

## The browser preview cannot start builders

`npm run start:web` is a browser-only preview. It cannot run desktop workflows such as launching builders or the game. Use `npm start` or the portable build.

## Where to look next

- **Settings & connections** for connection errors, and **Settings › Log** for what the assistant did last.
- **Task board** for prerequisites and retry limits.
- **Session explorer** for session details, the Auditor and the inbox.
- **Command view › Ask** for questions waiting on you.
