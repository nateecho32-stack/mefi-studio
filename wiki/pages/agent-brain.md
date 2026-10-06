# Agent brain, Playbook and project map

The Agent brain shows how a task is broken into steps and who is working on each one. Next to it are the **Playbook**, which keeps the step recipes that worked, and the **project map**, which shows your project as systems, parts and files.

Everything here is drawn from events Studio recorded, so nothing moves without real work behind it. The Agent brain arrived in 0.4.0. Finishing beats for every node style and a few map features are <span class="status next">New in 0.5</span>.

## Open it

- Press `J`.
- In Build's menu, go to **Agents › Live › Pipelines** for live work, or **Agents › Workflows › Playbook** or **Agents › Workflows › Project map**.
- Or press `Ctrl K` and type *agent brain*.

The sheet has three tabs: **Explore** (the project map), **Live work** and **Playbook**. The models behind the agent seats live in **Agents › Setup › Team & models**.

## Live work

Pick a task from the list on the left. The canvas draws its pipeline from the top down: your companion at the head, then the lead agent, the steps, and the sub-agents working on them.

- When a sub-agent finishes, it flies home and is absorbed, and its report climbs the tree.
- The list under the canvas says what happened on the task.
- **Replay today** plays back the day's recorded events for that task.

### Where the steps come from

Before a worker starts, each task gets a plan of steps. It comes from the Playbook's best recipe for that kind of work, or from a template. The plan then grows from the worker's own to-do list, up to 12 steps, and folds finished steps away.

When a worker gets stuck, the **desk** agent answers its question and adds the answer to the worker's next brief. A question only you can answer goes to **Needs you** as one ordinary question. With **Let workers ask the desk** turned on (in **Agents › Setup › Run behavior**), OpenCode and Claude Code workers can ask the desk in the middle of a run.

## Playbook

Every pipeline that passed or failed its checks is filed as a recipe. The next task of the same kind starts from the recipe that passes most often.

Recipes stand on a shelf like book spines: a thicker spine has more runs, and its colour shows how often it passed. Pick one to see its steps, runs and pass rate. Then you can:

- **Pin as the default** (or **Unpin**) to make it the first choice;
- **Retire** it (or **Restore** it);
- rename it in the name box;
- **Delete** it.

## Explore: the project map

The map shows your project as systems. It's built from the files in your project now, your recent Git history, and the files touched by runs that passed their checks. Systems split into parts, and parts into files.

1. Click a system, part or file to inspect it.
2. Double-click it, press `Enter`, or choose **Explore parts →** (or **Explore files →**) to go inside.
3. Choose **Work here** (or **Work on this file**) to start a task draft about it. Files also have **Copy path**.

To move around:

- Use the **←** and **→** buttons (`Alt Left` and `Alt Right`) to go back and forward, and **↑** (`Backspace`) to go up a level. The breadcrumbs show where you are.
- **Browse** searches every system, part and file. The **All**, **Working** and **Changed** filters narrow the current level.
- Drag to pan, `Ctrl` and the mouse wheel to zoom, or click the minimap. Arrow keys select, `Shift` and arrows pan, and `Home` fits the view.

Under **Map actions**, **Refresh files** reads your files again, and **Name systems** asks the lead agent to name systems the first map left unnamed.

A line between two systems means their files **changed together**. It doesn't mean one imports or runs the other.

<span id="coming-in-05"></span>

## New in 0.5

> <span class="status next">New in 0.5</span> These came with 0.5.

- **Every node style finishes in its own way.** When a step's work comes back, and when the lead takes its agent in, Live work plays your node style's own beat. Classic orbs' ring bursts, Soft glass ripples, Minimal draws a check, Halo slips its ring over the lead, Crystal glints, Singularity's disc flares, Prism shatters and fuses back, and Sigil's rune stamps the lead. A failed check finishes in amber. With reduced motion on, no beats play.
- **Tidier lists.** The pipeline list no longer cuts long titles off, the Playbook shelf keeps its books in tight rows, and the feed no longer says nothing happened on a task that finished steps before Studio opened.
- **Connected system cards.** Systems whose files change together share a branch, with their parts and files. Systems without that evidence wait under **Connections still to discover**.
- **The Ideas tree.** A **Systems | Ideas tree** switch shows your ideas and tasks grouped by system and progress. Ideas sit under their tasks, and subtasks under their parents. The tree regroups as agents find files and work moves on, and work that hasn't found its place waits under **To explore**.
- **Work with Mefi.** Idea cards have **Work with Mefi**, and an inspected system has **Modify**, **Experiment**, **Fix** and **Improve**. Each prepares a draft about that area in your message box, as [Vibe's MEFI starters](#/vibe-mode/mefi-modify-experiment-fix-improve) do.

## Agent brain or Brain maps?

- The **Agent brain** (`J`) shows what the agents are doing and what they learned.
- **Brain maps** (`B`) are the editable rules behind every pipeline: intake, planning, checks and verification. See [Brain maps](#/brain-maps).

## The Fleet page

<span class="status next">New in 0.5</span> The Fleet page, **Map › Fleet** (beside the Map and Pipelines), shows every agent as a seat in Lead, Build, Check and Keep pods, in Graph, Table, Recent, Tree and Health views. In 0.5 the Agent brain's live work is the Map's **Pipelines** view.

<span class="status planned">Planned</span> Fleet lanes, missions and your other PCs' fleets come after 0.5. See the [roadmap](../roadmap.html).

## Related pages

- [Command view](#/command-center) shows the whole project as a live node tree.
- [Assistant and agents](#/assistant) explains who is on the team.
- [Verification](#/verification) explains what "passed its checks" means.
