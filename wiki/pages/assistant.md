# Assistant and agents

Mefi, the assistant, is who you talk to: think an idea through, ask about your project, or decide what to work on next. Coding agents take the tasks you give them and work in your project folder. A small team of helpers keeps the work moving in between.

## Where you can talk

- **Today**, in either mode: type in the box. `Enter` talks it over, and `Ctrl Enter` builds it. In Studio mode, **Talk it over** opens the conversation in its **Chat** tab.
- **The conversation**: in Social, the conversation button at the top right (or `C`). In Studio, **Open the conversation** in Search opens the **Chat** tab.
- **Your companion**: click it, or press `Esc` with nothing open, and choose **Talk**. **What are you doing?**, **What's next?** and **Recap today** are one tap away. See [Your companion](companion.md).
- **The Map**: the **Assistant** tab in the side panel, which also holds the **New work** switch.

Your project keeps the conversation and the work that comes out of it.

## Start with a conversation

Use **Talk it over** when you want to explore an idea. Describe the result you want and ask follow-up questions. For example: "I want a small app for sharing recipes. Help me decide what the first version needs."

**Talk it over** only talks. A plain request such as "add a search box" doesn't turn into a task by itself: the reply offers to put it on the board instead.

When you're ready to make something, choose **Build it**, or **New task** (`Ctrl N`) in Studio mode. Studio can break a bigger request into steps, and **Make it one task** keeps it together. Check the brief so the agents have a clear result to aim for. [Tasks](workflow.md) explains that hand-off.

You can also ask the assistant to act on a task by name, such as "stop the search build" or "try the login task again". It acts only on a task your words clearly name, and anything else it offers waits for your OK.

## Who's on the team

**Team › Seats and models** says who does each job, which model it uses and how hard it thinks:

| Who | What they do |
| --- | --- |
| **Companion** | Talks with you, and creates tasks when you ask |
| **Routine assistant** | Quick answers and checks |
| **Planning and review** | Plans, briefs and reviews |
| **Coding worker** | Writes the code in your project, using a coding tool |
| **Lead** | Leads big jobs: sizes and hands out work, then gathers the reports |
| **Desk** | Unsticks workers, and settles ordinary questions for you in **Auto** and **Elevated only** |
| **Scout** | Finds the starting files for each task |
| **Overseer** | Watches the whole team |

Press **Change** on a job to pick its model. **More settings** holds the detailed cards: the roles, routing, the coding workers and saved teams.

With an OpenCode Zen key saved, the companion and the scout start on GPT-6 Luna, and the lead and the desk on GPT-6.1 Sol. The overseer follows **Automatic**. Without Zen, the seats use your planning and review route. [Connect an AI](connections.md) covers providers and models.

Behind them, a service loop of small helpers keeps the work moving: a **watcher** for stale sessions, a **machine** watcher for your PC's load, an **auditor**, a **keeper** that prunes, a **thinker** that looks for what's next, a **briefer** that writes summaries, a **responder** for chat, a **foreman** that hands out work and a **compactor** that keeps context small. The [Agent brain](agent-brain.md) draws a task's pipeline as it runs.

Each agent can also get skills and tools, such as web search: see [Agent tools and skills](tools.md).

> <span class="status next">New in 0.5</span> **Habits** give each agent short rules to follow, such as testing or small steps, each set to off, brief or full. Claude Code, Codex and OpenCode think lightly first and harder when a job gets stuck, and the **Report card** shows what each coding model does well on your PC. The [setup helper](setup-helper.md) holds every team setting in one place.

## Choose when work starts

At launch, the **Start agents** switch beside **Open** decides whether the agents start with the project. **Settings › General › Agents when Studio opens** sets where that switch starts. You can also start them later with **Start agents** on Today, the play button in the top bar or the tray icon's menu.

Your [permission mode](permissions.md) decides what may start without you. **Auto** is the default.

The pause button in the top bar holds new work, while running jobs finish. **Team › Overview** holds the rest of the queue controls:

- **Allow new work** lets queued tasks, builds and the assistant's suggestions in. Turning it off pauses new work.
- **Run the queue** starts ready tasks when workers are free.
- **Build approval**: **Automatic**, or **Review first** to hold new or changed briefs for your OK.
- **Parallel builds**: **Machine managed**, which backs off while your PC is busy, or 1 to 3 workers.
- **Agent coordination**: **Across the queue** gives each task its own builder, and **One shared task** puts the agents together on one.

**Stop all**, under **More** on the Chat tab, stops running agents and keeps their saved progress. **Restart** stops them and relaunches Studio paused. Both ask twice.

## When an agent needs you

A question reaches you in the **Inbox** (`Ctrl J`, or the **needs you** count in the top bar), on Today's board, in the Map's **Ask** tab and in your companion's **Needs you** bubble. Read the task, the question and the recommended answer, then pick an option or write your own. Studio records your decision for the next attempt.

In **Auto** and **Elevated only**, the desk settles ordinary questions for you. Its answers are marked **Mefi decided**, with a reason and **Undo**. Questions about permissions, risk, or things only you can do always wait for you. See [Permissions and decisions](permissions.md).

An open question can hold its task while other work carries on. [Brain maps](brain-maps.md) explains how questions are routed.

## When you're away

Closing the window tucks Studio into the Windows tray, and running work carries on while your PC is on and awake. To exit, choose **Quit** from the tray icon's menu. **Keep running in the tray when the window closes**, in **Help › Setup guide › Machine & app**, turns that off. Closing Studio asks first when the open project has work that exists only on this PC.

When you come back, your companion greets you with a short digest of what happened. If you worked in the project outside Studio, Studio reports those commits, edits and sessions, and checks queued tasks against them first.

After a crash or an update restart, Studio uses the saved progress to pick the work back up. **Start with Windows** opens Studio in the tray when you sign in, so a PC you leave working keeps working.

## Machine coordination

Studio can hold new starts while your PC is busy, and stop workers that go past the limits you set. If a task stops, open its history for the reason before you choose **Try again**. **Team › Resources** can also slow down or pause other apps so the agents get your PC while they build.

## Per-session worktrees

A task run can work in its own Git folder, a worktree, so workers on the same project don't change the same files. Turn on **Give each run its own worktree** in **Work › Worktrees**: each run then works in its own folder under `.mefi/worktrees` and is merged back when it finishes. The same page lists every worktree of the open project and what to do about each, such as **Merge into main** or **Remove and keep a copy**. It needs a Git project. The [architecture notes](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/architecture.md#the-assistant-and-the-agent-loop) explain how it works.
