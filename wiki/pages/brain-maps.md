# Brain maps and agent questions

Brain maps let you inspect and adjust parts of Studio's workflow: how work is approved, handed to agents and reviewed, and how the agents ask you for help.

Open **Agents › Workflows › Brain maps**, or press `B`. The included **The studio pipeline** map is a useful starting point. You can use Studio without editing it.

## Read a map

Each part represents a step, such as choosing a model, starting a worker or checking evidence. Wires show the connections between steps.

Select a part to see its description and settings in the inspector. Pay attention to whether a setting is active: some settings are saved with the map but marked **Not read by the studio yet**. In particular, the model shown on a part does not replace Studio's model routing.

The inspector also shows recent activity for supported steps, so you can see how often workers started or questions reached you.

## Make a small change

1. Open **Map › Duplicate this map** if you want to experiment with a copy.
2. Select the part you want to change and adjust its settings.
3. Use **Save** to save your edits.
4. Choose **Make this live** to apply the map. Read the proposed setting changes before confirming.

Applying a map can change build approval, proactive work, model selection, dispatch and the worker limit. Removing a controlling part can turn its setting off. The preview explains what will happen.

Changes to question-handling rules on the active map take effect when you save them. For a fresh start, the built-in map has **Reset to the shipped pipeline** in the Map menu.

## Work with the editor

Drag a part to move it. Drag from an output connection to a compatible input to connect two parts. The editor explains a refused connection.

| Action | Shortcut |
| --- | --- |
| Find a part to add | `Space` |
| Find a part already on the map | `Ctrl F` |
| Fit the map | `F` |
| Zoom | `Ctrl` + scroll |
| Undo / redo | `Ctrl Z` / `Ctrl Shift Z` |
| Save | `Ctrl S` |

**Map › Draft with AI** turns a description into a draft for you to review. Drafting does not make it live.

## The decision lane

The parts **Agent issues → Triage → Ask you → Apply the answer** handle questions raised during work. Depending on your settings and the issue, Studio may resolve a routine problem or ask you.

Open **Ask** in [Command view](command-center.md), or **Needs you** in Vibe. Each question explains the problem and offers relevant actions:

- **Retry** makes another attempt with the decision recorded.
- **Narrow** keeps the task to its original brief.
- **Split** puts extra work on a separate card.
- **Re-plan** returns the task to planning.
- **Instruct** gives the next agent your own direction.
- **Hold** leaves the task waiting.

An owner-only question may offer **I'll take care of it**. That records your choice without starting the task again.

For the complete list of parts and supported settings, see the [brain map reference](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/brain-maps.md).
