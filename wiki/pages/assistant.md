# The assistant and your agents

Use the assistant to talk through an idea, ask about your project, or decide what to work on next. Coding agents take the tasks you give them and work in your project folder.

You can chat from Home, Vibe, the companion, or the **Assistant** tab in [Command view](command-center.md). Your project keeps the conversation and the work that comes out of it.

## Start with a conversation

Use **Chat** when you want to explore an idea. Describe the result you want and ask follow-up questions. For example: “I want a small app for sharing recipes. Help me decide what the first version needs.”

When you are ready to make something, choose **Create task** on Home or **Build it** in Vibe. Studio can break a larger request into steps; **Make it one task** keeps it together. Review the brief so the agents have a clear result to aim for. [Tasks and the board](workflow.md) explains that handoff.

## Choose when work starts

At launch, **Open studio** opens the project with agents off. **Open and start agents** starts them too. You can also start them after opening the project.

Open **Agents** in the Command toolbar for the queue controls:

- **Autopilot** starts ready tasks and verifies completed attempts. Turning it off stops new starts; running jobs can finish.
- **Build mode › Verify first** holds new or changed briefs for your approval.
- **Parallel builds** sets the worker limit, or lets Studio adjust it to the machine.
- **Stop all** stops running agents and keeps their saved progress.

Use **Agents › Setup** to change the team, connections and run behavior. See [Connections and providers](connections.md) if an agent cannot start.

## When an agent needs you

Questions appear in Vibe's **Needs you** drawer or Command's **Ask** tab. Read the task, the question and the recommended answer, then choose an option or add an instruction. Studio records that decision for the next attempt.

An unanswered question can hold its task while other work continues. [Brain maps](brain-maps.md) explains how questions are handled.

## Leaving and returning

With background mode enabled, closing the window hides Studio to the tray, where active work can continue. Quit from the tray when you want to exit the application.

After an interruption, Studio uses saved progress to recover work. When you reopen a project, it also checks for changes made outside Studio before picking up the old queue.

## Machine coordination

Studio can reduce new starts when the computer is busy and stop workers that exceed its configured limits. If a task stops, open its history for the reason before choosing **Try again**.

## Per-session worktrees

For developers running several workers, `MEFI_STUDIO_WORKTREE_RUNS=1` gives each run a separate Git checkout. This is optional advanced setup; see the [agent-loop reference](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/agent-loop.md) before enabling it.
