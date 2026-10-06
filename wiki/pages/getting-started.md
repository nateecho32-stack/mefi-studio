# Your first project

Start with a small change in a project you can easily check. Studio helps you talk the idea over, turn it into work and follow the result.

## 1. Choose the folder you want to work on

At launch, pick an existing project or choose **Open another folder…**. Then:

- **Open studio** opens the project with the agents off. Press **Start agents** when you're ready.
- **Open and start agents** opens the project and starts them.

Check the project name at the top before you send any work. In Vibe, the project picker sits at the top of the page. In Build, **M+** at the top of the menu opens **Projects**, where you add or switch folders. Removing a project from the list leaves its files where they are.

Starting from nothing? **New app**, the button beside Vibe's project picker, asks for a name and a description. Studio makes a folder under **Mefi Apps** in your home folder, starts Git there with a short README, opens it, and sends your description through **Build it** as the first request.

> <span class="status next">New in 0.5</span> The launch screen has one **Open** button with a **Start agents** switch, and **Open a folder…**, **Start a new app** and **Get from GitHub** at its foot. **Settings › General › When Studio opens** decides whether agents start: **Resume what I had** (the default), **Start agents** or **Keep agents off**.

## 2. Connect your tools

Open **Help › Start here**. You can also reach the same controls from **Agents › Setup › Providers** with **Install a coding tool or use one subscription for Studio**.

1. Choose your coding tool: Codex, Claude Code, Grok, Antigravity or OpenCode.
2. Select **Install and sign in**, or **Sign in** if it's already installed.
3. Back in Studio, choose **Refresh installed tools**, then **Check connection**.
4. Select **Use for the whole studio** to use that account for chat, planning, mapping and coding.

For OpenCode, the last two steps are **Scan OpenCode**, then **Use scanned setup**.

In 0.4.4 the setup window may close as soon as it opens. If it does, [sign in from a terminal](connections.md#sign-in-from-a-terminal), then do steps 3 and 4.

The connection check uses a little of your account's allowance, and your provider's plan and limits apply. API keys and local models work too: [Connect an AI](connections.md) explains every option.

The **Start here** walkthrough has seven stops and remembers your place. A stop's **Walk me to…** button opens the matching part of the app and points at the control.

> <span class="status next">New in 0.5</span> A new install starts with a three-step welcome: pick the AI that builds for you (a coding tool you sign in to with your own account, OpenCode's free models, or another way to connect), choose a project, and say what Studio should make first. Studio adds that task and starts it. **Skip** leaves the [setup helper](setup-helper.md) waiting in Help and Search. Its **Quick setup** takes three steps: connect an AI, choose how much Mefi may decide for you, and finish. **Set up automatically** uses the login you already have. **Start free with OpenCode** uses OpenCode's free models, with no subscription or key. When you close a setup window, Studio finds the tool by itself.

## 3. Give one clear task

In Vibe, type in the box in the middle. **Enter** sends it to **Talk it over**, to discuss the idea. **Ctrl + Enter** sends it to **Build it**, to create work. In Build mode, Home's composer offers **Chat** and **Create task** instead.

Describe the result, and how you'll check it:

```text
Add an empty state to the saved notes list.

Done when:
- An empty list explains that there are no notes yet.
- A Create note button opens the existing note editor.
- Saving a note replaces the empty state with the list.

Keep the existing note format and save location.
```

A bigger **Build it** request may become a few steps. The **Plan in flight** card shows how far along they are. Use [Plans](planning.md) when you want to settle the decisions before anything is built.

Before you start, check the permission mode. It decides what Mefi may start and answer for you:

- **Always ask**: every new task, yours too, waits for your OK.
- **Accept per task**: you OK each new task once, then Mefi handles its ordinary questions.
- **Auto** (the default): tasks start on their own, agent proposals included.
- **Elevated only**: your tasks start on their own, and tasks the agents propose wait for your OK.

[Permissions and decisions](permissions.md) explains each mode and where to change it.

## 4. Follow the work

Vibe shows **Building now** and **Needs you** while they have something to show. Open a task to read its brief, activity and result. When an agent needs a decision, answer it under **Needs you**.

If nothing starts, read the line under Vibe's box. It says what's holding the agents and offers one button to fix it, such as **Start agents**, **Resume** or **Connect an AI**.

**Watch** opens the live tree, where tasks, agents and their steps appear as work moves. The [task board](workflow.md) lists all the work and its state.

**Pause** stops new starts while running jobs finish. If a task is waiting, read the reason on its card.

> <span class="status next">New in 0.5</span> The same line also names a cooldown after failed starts, a stuck scheduler or tasks waiting for your OK, with **Try now**, **Restart Studio** or **Review tasks**. Social, as Vibe is called from 0.5, also offers **Modify**, **Experiment**, **Fix** and **Improve** starting points, and **Suggest a next step**. See [Vibe mode](vibe-mode.md).

## 5. Review and recover

Read the finished task's evidence, look at the changed files and try the new behavior. Run your project's checks before you accept the result. [Verification](verification.md) explains what Studio checks for you.

Use **Ask for a change** on a finished task when it needs another pass. For blocked work, open the task and fix the reported problem before you retry. [Troubleshooting](troubleshooting.md) covers connection and scheduling problems.

If Studio went away while work was running, such as after a crash or an update restart, and that work was less than ten minutes old, the next launch reopens the same folder and picks up where you left off. When you close Studio yourself, the next launch asks which project to open.
