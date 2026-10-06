# Brain maps

Brain maps let you look at, and change, the steps Studio's work follows: how work is approved, handed to agents and checked, and how the agents ask you for help.

Open **Team › Workflows › Brain maps**, or press `B`. The built-in map, **The studio pipeline**, is a good place to start. You can use Studio without ever editing it.

Brain maps are the rules. The [Agent brain](agent-brain.md) (`J`) is different: it shows one task's pipeline as it runs.

## Read a map

Each part is a step, such as picking a model, starting a worker or checking the evidence. Wires connect the steps, and a part's colour shows its stage: intake, checks, planning, assistant, routing, build or decisions.

Select a part to see its description and settings in the inspector. Watch whether a setting is really used: some are saved with the map but marked **Not read by the studio yet**. In particular, the model shown on a part doesn't replace Studio's own model routing.

The inspector also shows recent activity for supported steps, so you can see how often workers started or questions reached you.

The `?` button explains the marks:

- **Map rules**: the map itself decides here, and your edit takes effect as soon as you save.
- **Note**: a drawing only. It's saved and shown, but nothing runs it.
- Some parts move a real switch when the map goes live.
- A dashed wire is a feedback wire: what it carries lands on the next pass.
- A red ring is a required end with nothing wired. A red part or wire is a problem to fix before the map can go live.

## Make a small change

1. Choose **Map › Duplicate this map** if you'd like to experiment on a copy.
2. Select the part you want to change and adjust its settings.
3. Choose **Save**.
4. Choose **Make this live** to use the map. Read the list of setting changes before you confirm.

Making a map live can change build approval, proactive work, model selection, how work is handed out and the worker limit, which is at most 3. Removing a part that controls a setting can turn that setting off. The confirm list says what will happen.

Changes to the question-handling parts of the live map take effect when you save them. For a fresh start, the **Map** menu has **Reset to the shipped pipeline**. It also holds **New empty map**, **Discard unsaved changes** and **Delete this map**.

> <span class="status next">New in 0.5</span> Making a map live changes your [permission mode](permissions.md) and the New work switch only when the confirm list shows them moving. The Verify first step moves the mode instead of overwriting it: **Always ask** and **Accept per task** move up to **Auto**, or **Auto** and **Elevated only** move down to **Always ask**.

## Work with the editor

Drag a part to move it. To connect two parts, drag from an output end to an input end, or click one and then the other. The editor explains a connection it refuses. It also has **Add part**, **Tidy**, zoom controls and a minimap.

| Action | Shortcut |
| --- | --- |
| Find a part to add | `Space` |
| Find a part already on the map | `Ctrl F` |
| Fit the map | `F` |
| Zoom around the pointer | `Ctrl` + scroll |
| Undo / redo | `Ctrl Z` / `Ctrl Shift Z` |
| Save | `Ctrl S` |
| Go to the next problem | `F8` |

[Navigation and shortcuts](shortcuts.md#in-brain-maps) lists every key.

**Map › Draft with AI** turns a description into a draft for you to review. On an empty map, **Build with AI** does the same. A draft says "Drafted. Nothing is saved yet." Choose **Save as a new map** to keep it, or **Discard draft**. Drafting never makes a map live.

## The decision lane

The parts **Agent issues → Triage → Ask you → Apply the answer** handle the questions agents raise while they work.

Who answers depends on your [permission mode](permissions.md):

- **Always ask**: you answer each question, and Mefi suggests an answer.
- **Accept per task**: once you've accepted a task, Mefi handles its ordinary questions.
- **Auto** and **Elevated only**: the desk settles ordinary questions for you. Its answers are marked **Mefi decided**, keep your stop on the task, and are never learned as your own choice. You can undo them under **Decided for you**.

Questions about permissions, risk, or things only you can do always wait for you.

Questions reach you in the Inbox (`Ctrl J`), on Today's board, in the Map's **Ask** tab, in your companion's **Needs you** bubble, and in a **Decision needed** notice with **Answer**. Each question explains the problem and offers the actions that fit. Depending on the kind of question, you may see:

| Option | What it does |
| --- | --- |
| **Try again** | Re-arms the task, with your decision written on it for the next worker. |
| **Try again with a heavier model** | Routes the next attempt as deep work, so a stronger model picks it up. |
| **Keep to the brief** | The extra work stays out. The agent finishes what was asked and says what it left. |
| **Split the extra work out** | The task keeps its brief, and the rest becomes its own card on the board. |
| **Re-plan this task** | Sends it back to planning with what the agent found. |
| **Answer it in one line** | Your sentence goes onto the task, and the next worker reads it first. |
| **Grant it for this task** | The extra reach is allowed for this task only. |
| **Keep it out of scope** | The agent works with what it has and reports the rest. |
| **Go ahead** | Your approval goes onto the task, so the agent may make the risky change. |
| **I'll take care of it** | Recorded on the task. No new card is made and nothing restarts. |
| **Leave it for review** | Nothing changes. The task keeps the note and waits for you. |

> <span class="status next">New in 0.5</span> **Try again with a heavier model** uses the Heavy-tier model, and only appears where there is one. An answered question leaves the list at once. Questions older than two days, or about a task that left the board, close when the project loads.

For every part and setting, see the [brain map reference](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/brain-maps.md).
