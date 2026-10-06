# Your first project

Start with a small change in a project you can easily check. Studio helps you talk the idea over, turn it into work and follow the result.

## 1. Choose the folder you want to work on

A **project** is a folder on your PC that holds one app. Studio opens on its launch screen, **The Studio Daily**, with your projects listed and the one you had open last already picked. Press **Open**.

- The **Start agents** switch beside **Open** decides whether the agents start too. With it off, nothing is built until you say so: press **Start agents** on Today when you're ready.
- **Settings › General › Agents when Studio opens** sets where that switch starts: **Resume what I had** (the default), **Start agents** or **Keep agents off**.
- **Open a folder…** opens a folder you already have, and **Get from GitHub** downloads a project and opens it.

Starting from nothing? Press **Start a new app**. Name the app and, under **What do you want to build?**, say what it should do in a sentence or two, then press **Start project**. Studio makes a folder under **Mefi Apps** in your home folder, starts version history in it with Git (which remembers every change so it can be undone), puts your words in its README and opens it. On a first launch, your words wait in the welcome's last step as the first task. You can put the app on GitHub later from the Git chip.

Check the project name at the top before you send any work. Press it to switch to another project. In Social, **+** beside it starts a new app; in Studio, the project menu has **Start a new app…** and **Open a folder…**. Removing a project from the list leaves its files where they are.

## 2. Connect your tools

Studio has no AI of its own. It works through an AI coding tool you sign in to with your own account. On a new install, a short welcome in three steps opens first. Step one, **Pick the AI that builds for you**, says which account each tool uses: **Claude Code** your Claude subscription, **Codex** your ChatGPT plan, **Grok** your Grok account and **Antigravity** your Google account. **OpenCode** has free models to start with.

1. Press **Install and sign in** on the tool you pay for (**Sign in** if it's already installed). A window opens: sign in there with your account.
2. Come back to Studio. A tool you're signed in to says **✓ Ready**.
3. Press **Continue**. Studio switches to that tool for chatting, planning and building.

No subscription? Install **OpenCode** and press **Continue** to use its free models. They cost nothing, but they run one task at a time, and their makers may use what you send to improve them. Have an API key or an AI on your PC? Press **Other ways: an API key, a ChatGPT plan or a local model**. [Connect an AI](connections.md) explains every option.

A subscription's work counts toward that plan's limits, as if you used the tool yourself. Studio adds no bill of its own, and your password stays in the company's own sign-in window.

The second step, **Choose a project**, shows the folder Studio builds in, and the last one asks **What should Studio make first?** **Skip** (or `Esc`) closes the welcome at any step: **Help › Setup guide** has the same settings and more, and **Help › Start here** is a guided tour in seven stops.

## 3. Give one clear task

Type in the box on **Today**. **Enter** sends it to **Talk it over**, to discuss the idea. **Ctrl Enter** sends it to **Build it**, to create work.

Describe the result, and how you'll check it:

```text
Add an empty state to the saved notes list.

Done when:
- An empty list explains that there are no notes yet.
- A Create note button opens the existing note editor.
- Saving a note replaces the empty state with the list.

Keep the existing note format and save location.
```

A bigger **Build it** request may become a few steps, and **Show the plan** follows how far along they are. Use [Plans](planning.md) when you want to settle the decisions before anything is built.

Before you start, check the permission mode in the box. It decides what Mefi may start and answer for you:

- **Always ask**: every new task, yours too, waits for your OK.
- **Accept per task**: you OK each new task once, then Mefi handles its ordinary questions.
- **Auto** (the default): tasks start on their own, agent proposals included.
- **Elevated only**: your tasks start on their own, and tasks the agents propose wait for your OK.

[Permissions and decisions](permissions.md) explains each mode and where to change it.

## 4. Follow the work

Your task shows on **Today** under **Running**. Press it to see what the AI does, step by step. `D` opens **the Map**, a live picture of your agents at work. The pause button in the top bar holds new work; running jobs still finish.

If nothing starts, read the line under the box. It says what's holding the agents and offers one button to fix it:

| The line says | Press |
| --- | --- |
| Agents are off | **Start agents** |
| No AI connected | **Connect an AI** |
| Agents paused | **Resume agents** |
| *N* tasks need your OK | **Review tasks** |
| No project open | **Open a project** |

When the AI has a question or needs your OK, the top bar says **1 needs you**. Press it to open the **Inbox** (`Ctrl J`) and answer there. The [task board](workflow.md) (`T`) lists all the work and its state.

Under the box, **Modify**, **Experiment**, **Fix** and **Improve** start the sentence for you, and **Suggest a next step** asks Mefi for ideas. See [Social mode](vibe-mode.md).

## 5. Review and recover

When the work is done, the task moves to **Review** and Studio runs its own checks. Then it's your turn:

1. Open the task and press **See the changes**. The **Changes** tab lists every file the AI changed, line by line, and **Checks** shows what was tested.
2. Try the app yourself.
3. Happy? Press **Approve and finish**, and the task moves to **Done**.
4. Not happy? **Revert**, beside a file, puts that one file back. **Revert attempt** puts every file back and reopens the task. **Request changes** says what to change, and Studio makes a follow-up task.

[Verification](verification.md) explains what Studio checks for you, and [Troubleshooting](troubleshooting.md) covers connection and scheduling problems.

If Studio went away while work was running, such as after a crash or an update restart, and that work was less than ten minutes old, the next launch reopens the same folder and picks up where you left off. When you close Studio yourself, the next launch asks which project to open.
