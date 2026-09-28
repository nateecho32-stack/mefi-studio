# Your first project

Start with a small change in a project you can inspect. Mefi Studio can help you discuss the idea, turn it into work and follow the result.

## 1. Choose the folder you want to work on

At launch, choose an existing project or **Open another folder…**.

- **Open studio** opens the workspace with agents held. Select **Start agents** when you are ready.
- **Open and start agents** opens the workspace and starts the agents.

Check the project name above the conversation before sending work. Use the project picker to add or switch folders. Removing a project from the list leaves its files in place.

For a new project, **New app** beside Vibe's project picker asks for a name and description. Studio creates a folder under **Mefi Apps**, initializes Git and sends the description as the first build request.

## 2. Connect your tools

Open **Help › Start here**, or **Agents › Setup › Providers**.

1. Choose Codex, Claude Code, Grok or Antigravity.
2. Select **Install and sign in**, or **Sign in** if it is already installed.
3. Return to Studio, choose **Refresh installed tools**, then **Check connection**.
4. Select **Use for the whole studio** to use that account for chat, mapping, planning and coding.

The connection check uses a small amount of your account's allowance. Your provider's subscription and limits still apply. OpenCode, API keys and local models are other options; [Connections and providers](connections.md) explains them.

The **Start here** walkthrough remembers your place. Its **Walk with me** controls take you to the relevant part of the app.

## 3. Give one clear task

In Vibe, use **Talk it over** to discuss an idea or **Build it** to create work. In Build mode's Home composer, the corresponding choices are **Chat** and **Create task**.

Describe the result and how you will check it:

```text
Add an empty state to the saved notes list.

Done when:
- An empty list explains that there are no notes yet.
- A Create note button opens the existing note editor.
- Saving a note replaces the empty state with the list.

Keep the existing note format and save location.
```

A larger **Build it** request may become several steps. The **Plan in flight** card shows their progress. Use [Plans](planning.md) when you want to work through the decisions before creating tasks.

Review the permission setting before starting. **Always ask**, or turning **Auto build** off, holds new work for your approval. **Auto** allows eligible work to start.

## 4. Follow the work

Vibe shows **Building now** and **Needs you**. Open a task to read its brief, activity and result. Answer questions under **Needs you** when an agent requires a decision.

**Watch** opens the live tree. Tasks, agents and their reported steps appear as work progresses. The [task board](workflow.md) gives a list of work and its status.

**Pause** holds new starts while running jobs finish. If a task is waiting, read the reason shown on its card.

## 5. Review and recover

Read the finished task's evidence, inspect the changed files and try the new behavior. Run your project's checks before accepting the result.

Use **Ask for a change** on a finished task if it needs another pass. For blocked work, open the task and address the reported problem before retrying. [Troubleshooting](troubleshooting.md) covers connection and scheduling problems.

After a crash or interrupted update, Studio may resume recent work automatically. A normal new session asks which project to open.
