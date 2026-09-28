# Tasks and the board

A task records what you want changed, what counts as done and what happened during each attempt. Tasks belong to the selected project.

## Three ways to start

- In Vibe, **Build it** turns your request into work. A larger request may become two to six steps with a final integration check.
- **Talk it over** opens a conversation when you want to explore the idea first.
- [Plans](planning.md) helps you record decisions and review a specification before creating tasks.

Build mode's Home composer offers **Chat** and **Create task**. Whichever view you use, include a concrete outcome and **Done when** checks.

## Auto build and Verify first

Your permission setting controls when work may start and who answers questions:

- **Always ask** leaves each decision to you.
- **Accept per task** asks you to accept a task once, then handles its ordinary questions.
- **Auto** starts eligible queued tasks, including agent proposals, and handles decisions it can make confidently.
- **Elevated only** handles ordinary decisions and asks you about elevated requests.

The **Auto build** switch is a shortcut: off selects **Always ask**, on selects **Auto**. The older **Verify first** label describes the approval hold.

Open the waiting task under **Needs you** or **Review**, read its scope and choose the displayed approval action. Changed scope requires fresh approval. Approval does not bypass a pause or unfinished prerequisites.

## Studio at a glance and Your work

Vibe keeps **Building now**, **Needs you** and recent results near the conversation. Its **Tasks** panel offers a list or lanes. **Full view** opens the larger board.

In Build mode, Home's status strip shows running workers, waiting decisions and upcoming work. **Your work** groups the queue, ideas, review items and completed tasks.

## Task states

| Status | What to do |
| --- | --- |
| Ready | It can run when a worker and its dependencies are ready. |
| Awaiting build approval | Read the brief and approve it when ready. |
| Working | Follow the activity and answer any questions. |
| Waiting on prerequisites | Open the required task to see what is holding it. |
| Retry scheduled | Read the failure and the next retry time. |
| Needs attention | Fix the reported blocker before retrying. |
| Awaiting verification | Inspect the result and its checks. |
| Done | Review the completed change; ask for another pass if needed. |

## The task board

Open **Task board** with `T`. Each card shows progress and opens the brief, prerequisites, attempts and evidence.

In Vibe's task inspector, you can edit priority, estimated time, acceptance checks and a **Defer until** date for eligible tasks. **Return to queue** clears a deferral. Estimates help planning; they are not execution time limits.

## Queue controls

**Pause** stops new scheduling while current jobs finish. **Resume** allows eligible work to start again.

**Parallel builds** can follow automatic capacity or a manual worker limit. **Swarm** distributes independent tasks across workers; **Cluster** organizes workers around one shared goal. The Free coding tier uses one worker.

A split request has a **Plan in flight** card. **Make it one task** removes steps that have not started so the original request can run as a whole.

## Keeping workers apart

Studio tracks which files its workers are changing and holds known conflicts. Other editors and tools can still change those files, so coordinate overlapping work. [Per-session worktrees](assistant.md#per-session-worktrees) provide separate checkouts when enabled.

## Review and recover

Read the result, inspect the changes, run your project's checks and try the affected workflow. A successful process exit is only one piece of evidence.

Use **Ask for a change** on finished work that needs revision. For a blocked task, read its last activity and the offered recovery action before retrying. See [Verification and storage](verification.md) and [Troubleshooting](troubleshooting.md).
