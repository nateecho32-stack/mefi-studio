# Verification

When an agent finishes an attempt, Studio checks the evidence before it calls the task done. While it checks, the task reads **Verifying**. A finished task reads **Done · Verified** when Studio's checks passed, or **Done · Confirmed by you** when you confirmed it yourself.

A good review answers three questions: what changed, which checks ran, and whether the result does what you asked.

## Where to review

- **On Today**, in either mode, finished work waits under **Review**, and what finished today shows under **Done**. In Social, the **Tasks** panel's **Checking** and **Done** lanes hold the rest.
- **In Studio mode**, the session list's **Review** group holds finished work. Open a session and press **See the changes**: the inspector's **Changes** tab lists every changed file, line by line, and **Checks** shows what was tested. The task board's **Review** filter lists the same work.

## Read the result

Start with the agent's summary, then open the changed files or the running app. Compare the result with the task's brief and its acceptance checks.

On the task board, a task's details have four tabs: **Details**, **Evidence**, **History** and **References**.

- **Evidence** shows **Work done outside Studio**, **Result & completion checks** and **Follow-up work**.
- **History** holds the **Brief history** and every **Attempt**.

A claim such as "tests passed" needs a recorded, passing run from that same attempt. A failed or unfinished check keeps the task under review.

Some work, such as a small edit in a project with no test command, can be verified from the recorded changes alone. Automatic checks don't test the whole experience, so try the result yourself when behavior or looks matter.

## Builds from other coding tools

Studio verifies builds from every coding tool, Claude Code, Codex, Grok and Antigravity included, with its own checks. Every run reports what it did before it ends, and Studio checks the work against that report.

> <span class="status next">New in 0.5</span> In 0.4.4, work built by Claude Code, Codex, Grok or Antigravity usually waited for you to confirm it yourself, or to retry it on OpenCode.

## If the task is still waiting

A finished worker and a finished task are different stages. Studio may still be collecting evidence, running a check or waiting for a related task.

Read the reason on the card before you retry:

- **Evidence is pending**: give the records time to arrive.
- **A check failed**: look at its command and output.
- **A question needs your answer**: open the Inbox (`Ctrl J`).
- **Follow-up work is unfinished**: open the linked task to see what's left.

## Accept it, or send it back

In Studio mode, **Approve and finish** on a finished session moves it to **Done**. On the Changes tab, **Accept changes** only notes that you looked. **Revert**, beside a file, puts that one file back. **Revert attempt** puts every file back and reopens the task: press it again when it says **Revert all** and a number, and **Undo** brings the changes back.

On the task board, a task waiting for your review has **Confirm done**; otherwise its button reads **Mark done**. Choose it once you've checked a result you want to keep. Studio records your confirmation apart from its own verification.

If the result needs more work, use **Request changes** (or **Ask for a change** in Social's Tasks panel) to start a follow-up task about it, or give a specific change request and retry the task. See [Tasks](workflow.md) for task states and recovery.

## Work done outside Studio

When you reopen a project, Studio compares it with its last look: commits, uncommitted edits, and Claude Code or OpenCode sessions in that folder. A queued task that looks already done waits under **Needs you** with **Mark it done**, **Drop it** or **Build it anyway**. Without an AI connection, the check only matches file names and commit titles, and says the task "may already be done".

## Where your work lives

Your code stays in the project folder you opened. Studio's own records, such as the board, conversations and plans, are kept apart from your code:

- In the portable build they're in `resources\app\data` inside the Studio folder. A source install keeps them in its `data\projects\<id>\` folders.
- Settings, saved keys, the project list and your place live in `%APPDATA%\Mefi's Studio AI+`. A portable build and a source install on the same Windows account share that folder, so only one of them runs at a time.

Pushing a project to GitHub doesn't copy Studio's records to another PC.

> <span class="status next">New in 0.5</span> **Friends › Your PCs › Share between my PCs** carries the items you choose between your own PCs, through a private, sealed GitHub repository: open tasks and ideas, model results, learned decisions, team setups, brains, Playbook recipes, memory notes and preferences. Keys go only after you type a confirmation. Conversations stay on each PC. See [Your PCs](your-pcs.md).

## Back up or recover

Before you move or replace a portable install, quit Studio from its tray icon and copy its data folder. Keep your project files backed up too, for example with Git.

Updating keeps your data: the in-app update leaves `resources\app\data` in place, and when you [update by hand](updates.md#update-from-044-by-hand) you copy it across.

If Studio went away while work was running, and that work was less than ten minutes old, the next launch reopens the same folder and picks up where you left off. If the window crashed or disappeared, reopen Studio and check the saved project before you start the same tasks again.

> <span class="status next">New in 0.5</span> **Settings › General › Agents when Studio opens** decides whether agents start on launch: **Resume what I had** (the default), **Start agents** or **Keep agents off**.

For a blank window, a missing project or repeated failed checks, see [Troubleshooting](troubleshooting.md). In a bug report, include your Studio version, the task's state and the error, and leave keys and private project content out.
