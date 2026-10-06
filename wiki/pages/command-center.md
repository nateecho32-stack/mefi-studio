# The Map

The Map is a live picture of your agents at work: your project's sessions, agents, to-dos and tasks as one moving tree. Press `D`, or choose **Map** on the rail. In Social, **Map** sits on Social's own rail.

Use it to see what's running, follow a task and answer questions without leaving the work. Before 0.5, the Map was called the Command view.

## Find the work you care about

Agents fly to the work they're doing, and their speech bubbles say what they're up to. Task labels show status and progress. Finished work stays in the task's details, even when the tree folds it into a bigger group.

Click a node or its label to open its details on the right. Press `S` to search, which also finds the Map's sessions, to-dos and tasks, and `N` to add a task.

The tree is an overview. To review what changed and which checks passed, open the task itself. See [Verification](verification.md).

## The bar over the tree

- **Map | Fleet | Pipelines** switches between the Map's three pages. See [other views](#other-live-views) below.
- **Running only** dims everything that isn't running. Studio remembers it on this PC.
- **View** holds the **Layout** (five tree shapes), **Labels** (`L`: Auto, Updates, All or None), the **Camera** (`C`: Overview, Follow or Free), **Flat map** or **3D orbit** (`V`) and **Spin** (`Space`). **Map look** at its foot opens the node styles in Settings.

At the bottom left, the colours of **Running**, **Needs you**, **Review** and **Done** sit beside **Legend**, which explains every colour and ring. At the bottom right, **Fit** (`F`) and the zoom buttons frame the tree.

## Use the side panel

| Tab | What to look for |
| --- | --- |
| **Work** | **Live work**: what's running now and the step it's on, the agents, and what's up next. **Ready**, **Waiting** and **Attention** show those tasks and why they're there. |
| **Assistant** | Your conversation with the assistant, quick asks such as **Status** and **What next?**, and the **New work** switch. |
| **Runs** | Recent build runs, one row per task. |
| **Ask** | Questions waiting for your answer, each with a recommended option. |

Selecting a node adds a **Node** tab, and its details take over the panel. `Esc` steps back out one level at a time: the first press brings the rest of the panel back, the next lets the node go. In a narrow window, details appear in a floating card.

The pause button in the top bar holds new work, while running jobs finish. The rest of the queue controls live in **Team › Overview**. [Assistant and agents](assistant.md) explains each one.

## Move around

- **Fit** (`F`) rearranges the tree and brings it all into view. `Shift F` fits the selected branch.
- **Overview** keeps the whole tree framed, and **Follow** tracks the current work. `C` cycles Overview, Follow and Free.
- **Spin** turns the 3D orbit. `Space` pauses or resumes it. It doesn't pause your agents.
- The mouse wheel or a two-finger pinch zooms toward the pointer. The arrow keys step through the tree, and `[` and `]` through its task nodes.

[Navigation and shortcuts](shortcuts.md#in-command-view) lists every key. If you'd like the tree to hold still, turn off **Spin** and pick a view that's easy to read.

## Make it feel like your space

**Settings › Map look** holds the node styles and tree layouts, and **Node tree details**: the **Backdrop** behind the tree, **Speech bubbles**, the **Card style** (Auto, Outline or Filled) and **Zen mode**. Zen mode fades the panels and tours the tree after 30 seconds without input. Move the mouse or press a key to come back.

Press `U` for **Appearance**: themes, motion and glass. Every theme and node style is free, and you don't need Discord to use any of them. See [Themes, node styles and looks](appearance.md).

The tree can react to a track, desktop audio or your microphone, and a video can play behind it: open **Music & video** to set it up. The microphone only drives the visuals: nothing is transcribed. **Settings › Sound and music** has the **Zen bells**, soft bells that follow how fast your agents work. See [Music, video and the player](media-player.md).

## When the Map opens by itself

Turn on **Show the Map after 5 quiet minutes** in **Settings › General** to have Studio switch to the Map when you leave it alone. It's off by default.

<span id="other-live-views"></span>

## Other views

- **Fleet**, beside the Map, shows every agent seat on the team: who's working on what, and how work moves between them.
- **Pipelines** (the [Agent brain](agent-brain.md), `J`) draws one task's pipeline: the lead, the steps and the helpers it sent out.

**Team › Inspect** holds more ways to look at the work:

- **Sessions** (`E`) shows each coding session and its saved context.
- **Activity and evidence** (`3`): pick a session, then read its change feed, diffs, images or log. The file inspector has **Reveal file** and **Copy path**, and you can pin a spot on a PNG. It reads the session records your coding tool keeps; when a tool keeps none, use the task's evidence and attempts instead.
- **Trace** puts Studio's logs in one viewer. See [Trace, logs and diagnostics](trace.md).
- **Overhead** (`O`) shows how tasks relate to sessions.

Your plan usage shows in the status bar at the bottom of the window. Press it for **Team › Health and usage**. See [Model Lab and usage](model-lab.md).

For reviewing finished work, continue to [Verification](verification.md).
