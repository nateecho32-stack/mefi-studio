# Assistant and agents

Mefi, the assistant, is who you talk to: think an idea through, ask about your project, or decide what to work on next. Coding agents take the tasks you give them and work in your project folder. A small team of helpers keeps the work moving in between.

## Where you can talk

- **Vibe**: type in the box. `Enter` talks it over, and `Ctrl + Enter` builds it.
- **Home** in Build mode: choose **Chat** in the composer.
- **Your companion**: click it, or press `Esc` with nothing open, and choose **Talk to me**.
- **Command view**: the **Assistant** tab in the side panel, which also holds the **New work** switch.

Your project keeps the conversation and the work that comes out of it.

> <span class="status next">Coming in 0.4.5</span> The companion's bubble is called **Talk**, with three one-tap starters: *What are you doing?*, *What's next?* and *Recap today*. See [Your companion](companion.md).

## Start with a conversation

Use **Chat** or **Talk it over** when you want to explore an idea. Describe the result you want and ask follow-up questions. For example: "I want a small app for sharing recipes. Help me decide what the first version needs."

When you're ready to make something, choose **Create task** on Home or **Build it** in Vibe. Studio can break a bigger request into steps, and **Make it one task** keeps it together. Check the brief so the agents have a clear result to aim for. [Tasks](workflow.md) explains that hand-off.

You can also ask the assistant to act on a task by name, such as "stop the search build" or "try the login task again". It acts only on a task your words clearly name, and anything else it offers waits for your OK.

> <span class="status next">Coming in 0.4.5</span> **Talk it over** only talks. A plain request such as "add a search box" no longer turns into a task by itself: the reply offers to put it on the board instead.

## Who's on the team

You choose each member's provider and model in **Agents › Setup › Team & models**.

| Who | What they do |
| --- | --- |
| **Assistant · routine** | Chat, checks and quick answers |
| **Assistant · planning & review** | Plans, briefs and reviews |
| **Coding worker** | Builds your tasks in the project, using a coding CLI |
| **Companion** | Talks with you, and creates tasks when you ask |
| **Task context scout** | Picks a starting file for each task |
| **Overseer** | Reviews progress across the team |
| **Lead** | Sizes and hands out work, then gathers the reports |
| **Desk** | Helps stuck workers, and settles ordinary questions for you in **Auto** and **Elevated only** |

The last five are **seats**. With an OpenCode Zen key saved, they start on GPT-6 Luna (the companion and the scout) or GPT-6 Sol (the lead and the desk), and the overseer follows **Automatic**. Without Zen, the seats use your planning and review route. [Connect an AI](connections.md) covers providers and models.

Behind them, a service loop of small helpers keeps the work moving: a **watcher** for stale sessions, a **machine** watcher for your PC's load, an **auditor**, a **keeper** that prunes, a **thinker** that looks for what's next, a **briefer** that writes summaries, a **responder** for chat, a **foreman** that hands out work and a **compactor** that keeps context small. The [Agent brain](agent-brain.md) draws a task's pipeline as it runs.

Each agent can also get skills and tools, such as web search: see [Agent tools and skills](tools.md).

> <span class="status next">Coming in 0.4.5</span> **Habits** give each agent short rules to follow, such as testing or small steps, each set to off, brief or full. The [setup helper](setup-helper.md) holds every team setting in one place.

## Choose when work starts

At launch, **Open studio** opens the project with the agents off, and **Open and start agents** starts them too. You can also start them later with **Start agents**.

Your [permission mode](permissions.md) decides what may start without you. **Auto** is the default.

**Agents** in Command view's toolbar holds the queue controls:

- **Autopilot** starts ready tasks and checks what comes back. Turning it off stops new starts; running jobs can finish.
- **Parallel builds** sets the worker limit, or lets Studio fit it to your PC.
- **Build mode › Verify first** holds new or changed briefs for your approval.
- **Agent mode** switches between **Swarm** and **Cluster**.
- **Stop all** stops running agents and keeps their saved progress. **Restart Studio** stops them and relaunches Studio paused.
- Links to **Team & models**, **Providers** and **All run settings**.

Use **Agents › Setup** to change the team, the connections and how work runs. See [Connect an AI](connections.md) if an agent can't start.

## When an agent needs you

A question can reach you in four places: Vibe's **Needs you** drawer, Command's **Ask** tab, your companion's **Requests** bubble, and a **Decision needed** notice with **Answer**, from any view. Read the task, the question and the recommended answer, then pick an option or write your own. Studio records your decision for the next attempt.

In **Auto** and **Elevated only**, the desk settles ordinary questions for you. Its answers are marked **Mefi decided**, with **Why** and **Undo**. Questions about permissions, risk, or things only you can do always wait for you. See [Permissions and decisions](permissions.md).

An open question can hold its task while other work carries on. [Brain maps](brain-maps.md) explains how questions are routed.

> <span class="status next">Coming in 0.4.5</span> The companion's bubble reads **Needs you**, and an answered question leaves the list at once.

## When you're away

Closing the window hides Studio in the Windows tray, and running work carries on while your PC is on and awake. To exit, choose **Quit** from the tray icon's menu.

When you come back, your companion greets you with a short digest of what happened. If you worked in the project outside Studio, Studio reports those commits, edits and sessions, and checks queued tasks against them first.

After a crash or an update restart, Studio uses the saved progress to pick the work back up.

> <span class="status next">Coming in 0.4.5</span> The setup helper's **Machine & app** section has **Keep running in the tray when the window closes** and **Start with Windows**. Closing Studio asks first when the open project has work that exists only on this PC.

## Machine coordination

Studio can hold new starts while your PC is busy, and stop workers that go past the limits you set. If a task stops, open its history for the reason before you choose **Try again**.

## Per-session worktrees

For developers running several workers, `MEFI_STUDIO_WORKTREE_RUNS=1` gives each run its own Git checkout. This is optional, advanced setup: read the [architecture notes](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/architecture.md#the-assistant-and-the-agent-loop) before you turn it on.
