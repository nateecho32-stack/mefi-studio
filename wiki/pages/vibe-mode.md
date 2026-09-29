# Vibe mode

Vibe is Studio's calm front door and its default mode. You get one box for an idea, a fix or a question. Below it, cards appear only when they have something to show: what needs you, what's building and what just finished.

Vibe arrived in 0.4.2, and 0.4.4 added its panels, **Build it** sizing and **New app**. Items marked <span class="status next">Coming in 0.4.5</span> are finished on main and ship with the next release.

## Vibe or Build

Studio has two modes:

- **Vibe** keeps the conversation, current work and decisions on one quiet page.
- **Build** is the full studio, with **Home**, **Work** and **Agents** in the menu.

Switch with the **Vibe | Build** switch at the top of Vibe, at the foot of Vibe's side rail, or in **Settings › General › Studio mode**. Studio remembers your choice.

In Vibe, every other page you open (Tasks, Plans, Command, Settings or a search result) opens inside Vibe's narrow side rail. The spark at the top of the rail brings you back to Vibe. Only the Build switch leaves the mode.

## Talk it over, or build it

Type in the box, then choose:

- **Talk it over** (`Enter`) to chat with Mefi about the idea first.
- **Build it** (`Ctrl Enter`) to turn your words into work on the board.

To bring in a file, drop text or code files on the box, or use **Add files**. Their contents land in your draft as text you can edit, up to eight files of 128 KB each. A drop never sends anything by itself.

Your draft is saved for each project, so switching projects or pages doesn't lose it.

### How Build it sizes your request

- A short, single change becomes one task at once.
- A bigger request may be split into two to six steps. Each step leaves your project working, and your own card runs last as the final check.
- A split request shows as a **Plan in flight** card. **Make it one task** drops the steps that haven't started, so your card runs as a whole.

If the agents are off, paused or have no AI, **Build it** says so and points at the control that fixes it.

### New app

Choose **+** beside the project name at the top left, then fill in **Name** and **What should it be?** and choose **Make it and start building**. Studio makes a new folder under *Mefi Apps* in your home folder, starts Git in it, opens it as your project and sends your description as its first build.

## The cards

Each card shows only while it has something in it:

- **Needs you**: questions, builds waiting for your go-ahead and stuck tasks.
- **Building now**: what the agents are working on. **Watch it live** opens the live node tree.
- **Plan in flight**: a split request and its steps.
- **Freshly done**: work finished in the last half day.
- **Fresh ideas**: ideas the agents noticed.

A quiet project shows one calm line instead of empty boxes. The pill at the top right says what needs you and what's building.

## Answer what needs you

Each row under **Needs you** has one action:

- **Answer** opens a drawer beside Vibe with the question, the task it blocks, the last lines the agent saw, and the options with the recommended one first. You can also type your own answer. After you answer, the drawer moves to the next item.
- **Review** shows a waiting task's brief. Choose **Approve build** (**Accept this task** in Accept per task mode) or **Drop it**.
- A stuck task shows **See why**, **Try again**, **Resume** or **Run anyway**, depending on why it stopped. The drawer explains the hold and offers to run it again, **It's done** or **Drop it**.

**Open in Watch** shows the same decision in the Command view.

When something holds every agent back, a banner under the box names it and carries the fix, such as **Start agents**, **Resume** or **Connect an AI**. <span class="status next">Coming in 0.4.5</span> The banner can also offer **Try now**, **Restart Studio** or **Open a project**, and it reads the same answer as every other part of Studio, so they never disagree.

Mefi's automatic choices appear as **Decided for you · For you** under the box. See [Permissions and decisions](#/permissions).

## The dock and panels

The dock at the bottom always has **Tasks**, **Team** and **More** (which opens Search). **Watch** joins while agents work, **Plans** while a plan is in play, and **Ideas** while fresh ones wait.

Each one opens a compact panel beside the box. Rows open their details, and **Back** or `Esc` steps out. **Full view** opens the full page inside Vibe's rail.

- **Tasks** shows your work as a **List** or as **Lanes** (Needs you, Ready, Building, Checking, Later and Done). It can pause new work and set a **Worker limit**. Each task's **Inspector** sets its priority, estimated minutes, **Done when** checks and a **Defer until** date. A finished task offers **Ask for a change**.
- **Team** shows who's building and each agent's model, with **Start agents**, **Resume** or **Pause new work**.
- The gear at the top right opens a short **Settings** panel: your permission mode, Studio mode, colours, names and **Open Vibe on launch**.

## Coming in 0.4.5

> <span class="status next">Coming in 0.4.5</span> These are finished on main and not in the 0.4.4 download.

### MEFI: Modify, Experiment, Fix, Improve

The starter chips under the box become four ways to build on the open project:

- **Modify** shapes an existing feature.
- **Experiment** tries a small, reversible idea.
- **Fix** makes something work again.
- **Improve** polishes what's already there.

Pick one, describe the change, then talk it over or build it.

**Suggest a next step** reads your project and suggests next steps, with reasons and the files involved. **Add to draft** adds a suggestion to your box as a brief you can edit, **Save idea** keeps it for later, and **Clear** puts the set away. Nothing starts until you build. The same panel links to the **System map** and **Ideas tree** in the [Agent brain](#/agent-brain).

### Watch Mefi think

**Suggest a next step** and **Build it** show a live strip while they work, instead of one still sentence. It shows the stage they've reached, the files read or steps planned as they arrive, which model is thinking, and a clock against how long it usually takes on your PC.

A split request's **Plan in flight** card draws its steps as a track that ends in the final check. It names the step being built, the tool its agent uses and what that agent is doing now. **Building now** rows and a new timeline in the **Plans** panel show the same. The **Team** panel lists what Mefi is still thinking about under **Thinking now**.

### Smaller changes

- **Talk it over** only talks. In 0.4.4 a message like "Add a search box" could quietly become a task; now the reply offers the board instead, and says plainly when no AI is connected.
- The **Worker limit** offers only what Studio really runs: 1, 2, 3 or **Automatic**. In 0.4.4, higher numbers were quietly treated as 3.
- A deferred task reads **Scheduled for later** and shows why.
- Questions that expired, or whose task left the board, close when the project loads, so **Needs you** shows only live ones.

## Planned

Vibe as Studio's social mode is planned, and not started yet. See the [roadmap](../roadmap.html).

## Related pages

- [Tasks](#/workflow) covers task states and the full board.
- [Plans and ideas](#/planning) is for ideas that need thinking through first.
- [Command view](#/command-center) is the live node tree behind **Watch**.
- [Navigation and shortcuts](#/shortcuts) lists the keys.
