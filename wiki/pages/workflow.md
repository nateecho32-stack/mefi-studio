# Tasks

A task records what you want changed, what counts as done, and what happened on each attempt. Tasks belong to the selected project.

## Ways to start

- On **Today**, in either mode, **Build it** (`Ctrl Enter`) turns your request into work. A bigger request may become two to six steps, with your own task running last as the final check.
- **Talk it over** (`Enter`) starts a conversation when you want to explore the idea first.
- In Studio mode, **New task** (`Ctrl N`) at the top of the session list starts one from scratch. The **Chat** tab's box also has **Create task**, and **Use a task outline** adds room for the goal, the **Done when** checks and what must stay unchanged.
- [Plans](planning.md) help you record decisions and review a specification before any tasks exist.

Wherever you start, give a concrete outcome and **Done when** checks.

## When work may start

Your [permission mode](permissions.md) decides when new work may start, and who answers the agents' questions:

- **Always ask**: every new task, yours too, waits for your OK. You answer each question, and Mefi suggests an answer.
- **Accept per task**: you OK each new task once. After that, Mefi handles its ordinary questions.
- **Auto** (the default): tasks start on their own, agent proposals included. Mefi handles the choices it's confident about.
- **Elevated only**: your own tasks start on their own, but tasks the agents propose wait for your OK. Elevated requests stay with you.

**Build approval** in **Team › Overview** still works as a shortcut: **Automatic** picks **Auto**, and **Review first** picks **Always ask**. It keeps your mode's meaning: it only moves **Always ask** and **Accept per task** up to **Auto**, or **Auto** and **Elevated only** down to **Always ask**.

To approve a waiting task, open it in the Inbox (`Ctrl J`), under **Needs you**, or on the task board's **Review** filter, read its scope and choose **Approve build**. A changed scope needs a fresh approval. Approval doesn't get past a pause or unfinished prerequisites.

## Where your tasks show

- **Today**, in either mode, shows a board: **Needs you**, **Running** (with what's up next), **Review** and **Done** today.
- In Studio mode, the **session list** on the left groups every task under **Needs you**, **Running**, **Review**, **Queued** and **Done**. Pick one to see its thread, and its **Plan**, **Changes**, **Checks**, **Preview** and **Agent** in the inspector.
- In Social, `T` on Today opens the **Tasks** panel: a **List**, or **Lanes** for **Needs you**, **Ready**, **Building**, **Checking**, **Later** and **Done**, each with a live count. **Full view** opens the full task board.

## Task states

| You see | What it means | What to do |
| --- | --- | --- |
| **Ready** | It can run once a worker and its prerequisites are free. | Nothing, or press **Start this task**. |
| **Awaiting approval** | It waits for your OK in the current permission mode. | Read the brief and approve it when you're ready. |
| **Working** | A worker is on it. | Follow the activity and answer any questions. |
| **Waiting** | Something else must finish first, such as a prerequisite. | Open the task to see what's holding it. |
| **Retry scheduled** | An attempt failed and is cooling down. | Read the failure and the next retry time. |
| **Scheduled for later** | You put it off, or Studio is checking it against work done outside Studio. | Read the reason on the board. |
| **Needs attention** | A blocker or the retry limit stopped it. | Fix the reported cause before you retry. |
| **Verifying** | The attempt finished, and Studio is checking the result. | Read the checks and evidence. See [Verification](verification.md). |
| **In a plan** / **Planning** | It's part of a plan or a split request. | Follow the plan's progress. |
| **On the board** | A request that a task on the board already covers. | Nothing: the task carries it. |
| **Done · Verified** | Studio's checks passed. | Review the change, and ask for another pass if needed. |
| **Done · Confirmed by you** | You marked it done yourself. | Nothing. |
| **Archived** | Put away. | Nothing. |

A task whose checks failed and that is trying again by itself shows with the running work as **Fixing itself**. It reaches the Inbox only if it gives up.

## The task board

Open the task board with `T`, or **Work › Tasks**. It opens straight on its tools: add a task, search, a state picker and the **All**, **Open**, **Review** and **Done** filters. A click anywhere on a card opens its current task: the brief, prerequisites, attempts and evidence.

In Social's Tasks panel, a task's **Inspector** sets the priority, an estimate, acceptance checks and a **Defer until** date. **Return to queue** clears a deferral. Estimates help you plan; they aren't time limits.

## Work done outside Studio

When you reopen a project, Studio reports what changed while it was closed: commits, uncommitted edits, and Claude Code or OpenCode sessions in that folder. Before a worker takes a queued task, Studio checks it against that work. A task that still needs doing runs as usual, and a partly done one runs with its worker told what changed. A task that looks already done waits under **Needs you** with **Mark it done**, **Drop it** or **Build it anyway**. Only you answer those, in every permission mode.

## Queue controls

The pause button in the top bar stops new work from starting while current jobs finish. Press it again to resume. A ready task has **Start this task**.

**Team › Overview** holds the rest:

- **Allow new work** and **Run the queue**: off stops new starts, and running jobs finish.
- **Parallel builds** is **Machine managed**, which backs off while your PC is busy, or a manual limit of 1 to 3 workers.
- **Agent coordination**: **Across the queue** gives each task its own builder. **One shared task** plans and reviews one task with supporting agents.

**Stop all** stops every agent now: progress is saved and the work stays queued. **Restart** stops the agents, then relaunches Studio paused. Both are under **More** on the **Chat** tab, and like every action you can't undo, they ask twice: the first press asks, the second acts.

The Free coding tier runs one worker at a time. Social's Tasks panel has its own **Worker limit**: 1, 2, 3 or **Automatic**.

A split request's steps live in a plan. **Show the plan** opens it, and **Make it one task** removes the steps that haven't started, so the original request runs as a whole.

## Keeping workers apart

Studio tracks which files its workers are changing and holds known conflicts. Other editors and tools can still change those files, so coordinate overlapping work. [Per-session worktrees](assistant.md#per-session-worktrees) give each run its own checkout when you turn them on.

> <span class="status next">New in 0.5</span> Agents on several PCs can share a project through a cowork room. Builders claim the files they'll edit, and a task whose files another PC holds waits. See [Friends, rooms and playdates](friends-and-rooms.md).

## Review and recover

Read the result, look at the changes, run your project's checks and try the affected workflow. A worker finishing is only one piece of evidence.

In Studio mode, open the task and press **See the changes**: the **Changes** tab lists every file the AI changed, and **Checks** shows what was tested. **Approve and finish** moves it to **Done**. **Request changes** says what to change, and Studio makes a follow-up task. For a blocked task, read its last activity and the offered recovery action before you retry. See [Verification](verification.md) and [Troubleshooting](troubleshooting.md).
