# Social mode

Social is Studio's calm mode, and the one Studio opens in. It's for time with friends and a light eye on your agents. Its home page, **Today**, has one box for an idea, a fix or a question. Under it, a board shows what needs you, what's running, what to review and what finished today.

Before 0.5, Social was called **Vibe** and Studio mode was called **Build**. Only the names changed: your saved mode and settings carried over.

## Social and Studio

Studio has two modes in one window. Both show the same projects and the same tasks.

- **Social** keeps things simple: Today, with the box and the board. Other pages open beside Social's own narrow rail.
- **Studio** is for in-depth work: your tasks as sessions in a list, each with its thread and an inspector, and the rail with **Work**, **Map**, **Team** and **Friends**.

To switch, use the **Social | Studio** switch at the top left (`Ctrl M`), the **Studio** button at the foot of Social's rail, **Mode** in **Settings › General**, or **Switch to Studio** in Search (`Ctrl K`).

Every launch starts in Social. To open the mode you used last instead, turn off **Always start in Social mode** in **Settings › General**.

Pages you open from Social, such as Tasks, Plans or the Map, open beside Social's rail. **Today**, at the top of that rail, brings you back. Only the Studio switch leaves the mode.

## Today

Today greets you and asks what's next for your project. Type in the box, then choose:

- **Talk it over** (`Enter`) to chat with Mefi about the idea first. It only talks: nothing is built.
- **Build it** (`Ctrl Enter`) to turn your words into work on the board.

**Modify**, **Experiment**, **Fix** and **Improve**, under the box, start the sentence for you. **Suggest a next step** asks Mefi for ideas. See [MEFI](#mefi-modify-experiment-fix-improve) below.

To bring in a file, drop text or code files on the box, or use **Add files**. Their contents land in your draft as text you can edit, up to eight files of 128 KB each. A drop never sends anything by itself. Your draft is kept for each project, so switching projects or pages doesn't lose it.

The chips in the box show your [permission mode](#/permissions) and how Mefi answers (Explain like I'm 5 at first). Press one to change it.

### The line under the box

When something holds the agents back, a line under the box says what, with one button that fixes it:

| The line says | Press |
| --- | --- |
| Agents are off | **Start agents** |
| No AI connected | **Connect an AI** |
| Agents paused | **Resume agents** |
| Agents are cooling down | **Try now** |
| The work scheduler is stuck | **Restart Studio** |
| *N* tasks need your OK | **Review tasks** |
| No project open | **Open a project** |

### The board

The board has four groups: **Needs you**, **Running**, **Review** and **Done** (what finished today). Each says so when it's empty. A task that waits its turn shows under **Running**, marked *up next*.

A card that waits on you shows its question and its first answers right there. **Answer** or **More** opens it in the Inbox. How much each card shows is up to you: **Settings › Size and density › Detail** has **Titles**, **Titles and status** and **Everything**.

### Start a new app

Press **+** beside the project name at the top left. Fill in **Name** and **What should it be?**, then choose what happens on GitHub: **Create a private GitHub repository**, **Link a repository I already have** or **Only on this PC for now**. Studio makes a folder under **Mefi Apps** in your home folder, starts Git in it, opens it and sends your description as its first build.

## How Build it sizes your request

- A short, single change becomes one task at once.
- A bigger request may be split into two to six steps. Each step leaves your project working, and your own card runs last as the final check.
- When the steps are ready, **Show the plan** opens them in the **Plans** panel. **Make it one task** drops the steps that haven't started, so your card runs as a whole.

If the agents are off, paused or have no AI, **Build it** says so and points at the control that fixes it.

## Answer what needs you

When something needs you, the top bar says how many things (for example **1 needs you**). Press it, or press `Ctrl J`, to open the **Inbox**: every question, permission, approval and stopped task in one list.

- A question shows its options with the recommended one first. Press one, or a number key from `1` to `9`. **Answer in my own words** opens a box for your own answer.
- A task waiting for your OK offers **Approve build** (**Accept this task** in Accept per task mode) or **Drop it**.
- A stopped task offers **Try again**, **Resume**, **Run anyway** or **Build it anyway**, depending on why it stopped, and **It's done** or **Drop it**.
- **Decide later** puts an item last for now. It still needs you.

An answered item leaves a short **Decided** line, with **Undo** where Studio can undo it. **Open as a tab** keeps the Inbox open as a page, **Work › Inbox**.

Mefi's automatic choices show as **Decided for you · For you** under the box. See [Permissions and decisions](#/permissions).

## Social's panels

On Today, single keys open compact panels beside the box. Rows open their details, and **Back** or `Esc` steps out. **Full view** opens the whole page beside Social's rail.

| Key | Opens |
| --- | --- |
| `T` | **Tasks**: your work as a **List** or as **Lanes** |
| `P` | **Plans**: plans in progress, and a split request's steps |
| `I` | **Ideas**: ideas the agents noticed |
| `M` | **Team**: who's working, and on which model |
| `S` | **Settings**, also behind the Settings button at the top right |
| `C` | The conversation with Mefi |
| `N` | The first thing that needs you |
| `/` | The box |

- **Tasks** shows **Lanes** for **Needs you**, **Ready**, **Building**, **Checking**, **Later** and **Done**, each with a count. It can pause new work and set a **Worker limit**: 1, 2, 3 or **Automatic**. A task's **Inspector** sets its priority, estimated minutes, **Done when** checks and a **Defer until** date. A finished task offers **Ask for a change**.
- **Ideas** offers **Build it**, **Keep for later** (or **Not now**) and **Dismiss** on each idea.
- **Team** shows who's building and each agent's model, with **Start agents**, **Resume** or **Pause new work**, and what Mefi is still thinking about under **Thinking now**.
- **Settings** has your permission mode, **Mode**, colours, names, **Open Social on launch**, **Always start in Social mode** and **Key tips**.

These keys work while you're not typing. Press `?` for the full list.

## MEFI: Modify, Experiment, Fix, Improve

Four ways to build on the open project, Studio itself included:

- **Modify** shapes an existing feature.
- **Experiment** tries a small, reversible idea.
- **Fix** makes something work again.
- **Improve** polishes what's already there.

Pick one, describe the change, then talk it over or build it.

**Suggest a next step** reads your project and suggests next steps, with reasons and the files involved. **Add to draft** puts a suggestion in your box as a brief you can edit, **Save idea** keeps it for later, and **Clear** puts the set away. Nothing starts until you build. The same panel links to the **System map** and **Ideas tree** in the [Agent brain](#/agent-brain).

## Watch Mefi think

**Suggest a next step** and **Build it** show a live strip while they work. It shows the stage they've reached, the files read or steps planned as they arrive, which model is thinking, and a clock against how long it usually takes on your PC.

A split request's plan draws its steps as a track that ends in the final check. It names the step being built, the tool its agent uses and what that agent is doing now. The **Plans** panel shows the same timeline, and the **Team** panel lists what Mefi is still thinking about under **Thinking now**.

## Related pages

- [Tasks](#/workflow) covers task states and the full task board.
- [Plans and ideas](#/planning) is for ideas that need thinking through first.
- [The Map](#/command-center) is the live picture of your agents at work.
- [Navigation and shortcuts](#/shortcuts) lists the keys.
