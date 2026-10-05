# Tasks

A task records what you want changed, what counts as done, and what happened on each attempt. Tasks belong to the selected project.

## Three ways to start

- In Vibe, **Build it** (`Ctrl + Enter`) turns your request into work. A bigger request may become two to six steps, with your own task running last as the final check.
- **Talk it over** (`Enter`) starts a conversation when you want to explore the idea first.
- [Plans](planning.md) help you record decisions and review a specification before any tasks exist.

In Build mode, Home's composer offers **Chat** and **Create task**. Wherever you start, give a concrete outcome and **Done when** checks.

## When work may start

Your [permission mode](permissions.md) decides when new work may start, and who answers the agents' questions:

- **Always ask**: every new task, yours too, waits for your OK. You answer each question, and Mefi suggests an answer.
- **Accept per task**: you OK each new task once. After that, Mefi handles its ordinary questions.
- **Auto** (the default): tasks start on their own, agent proposals included. Mefi handles the choices it's confident about.
- **Elevated only**: your own tasks start on their own, but tasks the agents propose wait for your OK. Elevated requests stay with you.

The older **Auto build** switch, and **Build mode › Verify first**, still work as shortcuts: on picks **Auto**, off picks **Always ask**.

> <span class="status next">Coming in 0.5</span> The Auto build switch keeps your mode's meaning. It only moves **Always ask** and **Accept per task** up to **Auto**, or **Auto** and **Elevated only** down to **Always ask**, instead of replacing the mode you chose.

To approve a waiting task, open it under **Needs you** or **Review**, read its scope and choose **Approve build**. A changed scope needs a fresh approval. Approval doesn't get past a pause or unfinished prerequisites.

## Studio at a glance and Your work

Vibe keeps **Building now**, **Needs you** and recent results beside the conversation. Its **Tasks** panel shows a **List** or **Lanes**: **Needs you**, **Ready**, **Building**, **Checking**, **Later** and **Done**, each with a live count. **Full view** opens the full board.

In Build mode, the status strip at the top of Home shows running workers, waiting decisions and what's next. **Your work** groups the queue, ideas, review items and finished tasks.

## Task states

| You see | What it means | What to do |
| --- | --- | --- |
| **Ready** | It can run once a worker and its prerequisites are free. | Nothing, or press **Start this task**. |
| **Awaiting approval** | It waits for your OK in the current permission mode. | Read the brief and approve it when you're ready. |
| **Working** | A worker is on it. | Follow the activity and answer any questions. |
| **Waiting** | Something else must finish first, such as a prerequisite. | Open the task to see what's holding it. |
| **Retry scheduled** | An attempt failed and is cooling down. | Read the failure and the next retry time. |
| **Needs attention** | A blocker or the retry limit stopped it. | Fix the reported cause before you retry. |
| **Verifying** | The attempt finished, and Studio is checking the result. | Read the checks and evidence. See [Verification](verification.md). |
| **In a plan** / **Planning** | It's part of a plan or a split request. | Follow the plan's progress. |
| **On the board** | A request that a task on the board already covers. | Nothing: the task carries it. |
| **Done · Verified** | Studio's checks passed. | Review the change, and ask for another pass if needed. |
| **Done · Confirmed by you** | You marked it done yourself. | Nothing. |
| **Archived** | Put away. | Nothing. |

> <span class="status next">Coming in 0.5</span> A task you put off reads **Scheduled for later**, with its reason on the board.

## The task board

Open the **Task board** with `T`. Each card shows progress and opens the brief, prerequisites, attempts and evidence.

In Vibe's task inspector you can set the priority, an estimate, acceptance checks and a **Defer until** date. **Return to queue** clears a deferral. Estimates help you plan; they aren't time limits.

> <span class="status next">Coming in 0.5</span> A calmer board: it opens straight on its tools (add a task, search, a state picker and the All, Open, Review and Done chips), and a click anywhere on a card opens its current task.

## Work done outside Studio

When you reopen a project, Studio reports what changed while it was closed: commits, uncommitted edits, and Claude Code or OpenCode sessions in that folder. Before a worker takes a queued task, Studio checks it against that work. A task that still needs doing runs as usual, and a partly done one runs with its worker told what changed. A task that looks already done waits under **Needs you** with **Mark it done**, **Drop it** or **Build it anyway**. Only you answer those, in every permission mode.

## Queue controls

**Pause** stops new work from starting while current jobs finish. **Resume** lets it start again. A ready task has **Start this task**.

**Agents** in Command view's toolbar holds the rest:

- **Autopilot** starts ready tasks and checks what comes back. Off stops new starts; running jobs finish.
- **Parallel builds** is **Machine managed**, which backs off while your PC is busy, or a manual limit of 1 to 3 workers.
- **Agent mode**: **Swarm** gives each task its own builder across the queue. **Cluster** plans and reviews one shared task with supporting agents.
- **Stop all** stops every agent now. Progress is saved and the work stays queued.
- **Restart Studio** stops the agents, then relaunches Studio paused.

The Free coding tier runs one worker at a time.

Vibe's Tasks panel has its own **Worker limit**. Studio runs at most three build workers, so in 0.4.4 the higher choices there (4, 6 and 8) still run three.

> <span class="status next">Coming in 0.5</span> Vibe's worker limit offers only 1, 2, 3 or **Automatic**. Actions you can't undo, such as **Stop all**, **Restart** or dropping a task, ask twice: the first press asks, the second acts. And Studio says why agents aren't working, with the one control that fixes it.

A split request has a **Plan in flight** card. **Make it one task** removes the steps that haven't started, so the original request runs as a whole.

## Keeping workers apart

Studio tracks which files its workers are changing and holds known conflicts. Other editors and tools can still change those files, so coordinate overlapping work. [Per-session worktrees](assistant.md#per-session-worktrees) give each run its own checkout when you turn them on.

> <span class="status next">Coming in 0.5</span> <span class="status rolling">Rolling out</span> Agents on several PCs can share a project through a cowork room. Builders claim the files they'll edit, and a task whose files another PC holds waits. See [Friends, rooms and playdates](friends-and-rooms.md).

## Review and recover

Read the result, look at the changes, run your project's checks and try the affected workflow. A worker finishing is only one piece of evidence.

Use **Ask for a change** on finished work that needs another pass. For a blocked task, read its last activity and the offered recovery action before you retry. See [Verification](verification.md) and [Troubleshooting](troubleshooting.md).
