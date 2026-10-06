# Navigation and shortcuts

Press `Ctrl K` to search Studio for any page, tool, task or setting. Press `?` for Studio's own shortcut sheet.

## Vibe and Build

Studio has two modes. **Vibe** is the calm front door: one box to talk or build, the work in progress and what needs you. **Build** is the full studio, with the menu down the left side.

Switch with the **Vibe / Build** toggle at the top of Vibe, the **Build** button at the foot of Vibe's rail, **Settings › General › Studio mode**, or **Switch to Build** in Search. Studio remembers your choice.

In Vibe:

- In the box, **Enter** talks it over and **Ctrl + Enter** builds it.
- The dock holds **Watch**, **Tasks**, **Plans**, **Ideas**, **Team** and **More**. Watch, Plans and Ideas appear only while they have something to show.
- Each dock stop opens a compact panel. **Full view** opens the full page inside Vibe's rail, and **Back** or `Esc` steps out.
- Other pages open inside Vibe's own rail. The spark at the top takes you back to Vibe.

See [Vibe mode](vibe-mode.md).

## The menu in Build

From top to bottom, the menu holds:

- **M+ Projects**, which opens your projects so you can add or switch folders.
- **Vibe mode**, **New task** and **Search**.
- The three sections: **Home**, **Work** and **Agents**.
- **Recent tasks** from the current project.
- **Settings** and **Help** at the foot. Help holds **Start here**, **Shortcuts** and **Community**.

The pin button, **Keep the menu open**, keeps the menu open beside the page in wide windows.

| Where | What's inside |
| --- | --- |
| **Home** | Your workspace: the conversation, your work and Studio's status |
| **Work** | Tasks, Plans, Ideas and Analyzer |
| **Agents › Overview** | Your team, whether it's ready, and the queue switches |
| **Agents › Setup** | Team & models, Providers, Routing & fallback, Run behavior |
| **Agents › Live** | Command, Pipelines, Sessions, Activity, Trace, Overhead; <span class="status next">Coming in 0.5</span> Fleet, beside the Map |
| **Agents › Workflows** | Brain maps, Playbook, Project map, Context |
| **Agents › Models** | Catalog, Performance |
| **Agents › Usage** | Recorded calls, Provider accounts |
| **Settings** | General, Appearance, Audio, System. See [Settings](settings.md). |

> <span class="status next">Coming in 0.5</span> **M+** opens Projects with keyboard focus on the project you're in.

<span class="status next">Coming in 0.5</span> The 0.5 layout replaces this menu with a rail of four places: **Work** (Tasks, Plans, Ideas, the Inbox, the Analyzer and Worktrees), **Map** (the live tree, Fleet and Pipelines), **Team** (everything under Agents today) and **Friends** (The Lobby, Rooms, Your PCs, Playground, the Project hub and Events), with **Search**, **Settings** and **Help** at its foot. Search opens any place directly, and the companion's Friends bubble stays available. See [the 0.5 layout](coming-in-0-5.md#the-05-layout).

## In the 0.5 layout <span class="status next">Coming in 0.5</span>

| Key | Action |
| --- | --- |
| `Ctrl M` | Switch between Social and Studio |
| `Ctrl K` | Search, from the top bar |
| `Ctrl J` | Open the Inbox |
| `Ctrl N` | A new task, in Studio mode |
| `Ctrl T` / `Ctrl W` | Add a tab / close the tab you're on. `Ctrl W` never closes the window. |
| `Ctrl Tab`, `Ctrl 1` to `9` | Move between tabs |
| `Ctrl Shift T` | Reopen the tab you closed last |
| `Ctrl B` / `[` | Show or hide the session list / the inspector |
| `Ctrl +` `Ctrl −` `Ctrl 0` | Interface scale up, down, or back to normal |

On the Map, `N` opens a new task and `S` opens Search.

## Single keys

These work when you're not typing in a text field.

| Key | Opens |
| --- | --- |
| `H` | Home, or Vibe in Vibe mode |
| `D` | Command view |
| `T` | Task board |
| `P` | Plans |
| `I` | Feature ideas |
| `B` | Brain maps |
| `J` | Agent brain |
| `E` | Session explorer |
| `O` | Overhead |
| `A` | Analyzer |
| `1` | Model catalog |
| `2` | Performance |
| `3` | Activity & evidence |
| `4` | Settings |
| `U` | Appearance |

| Key | Action |
| --- | --- |
| `Ctrl K` | Search Studio |
| `Ctrl ,` | Open Settings, even while typing |
| `Ctrl Shift ,` | <span class="status next">Coming in 0.5</span> Open **Configuration**: every setting in one searchable tree |
| `/` | Search the model catalog |
| `R` | Refresh the model catalog |
| `G` | Pin the node-tree preview |
| `?` | Show shortcuts |
| `Esc` | Close the current menu or layer. With nothing open, it opens your companion's menu. |

Trace has no single key: open it from **Agents › Live › Trace** or Search.

## In Command view

| Key | Action |
| --- | --- |
| `←` `→` | Cycle sessions, or the siblings of the selected item |
| `↑` `↓` | Up to the parent, or down into its to-dos and tasks |
| `[` `]` | Cycle task nodes |
| `Enter` | Run the selected node's first action |
| Double-click | The same, on the node you click |
| Right-drag | Orbit the camera |
| `F` | Rearrange and fit the whole tree |
| `Shift F` | Fit the selected branch |
| `Home` | Select the root and fit |
| `+` `−` `0` | Zoom in, out, or reset |
| `Space` | Pause or resume the spin. It doesn't pause the agents. |
| `C` | Camera: overview, follow or free |
| `V` | Switch between the 3D orbit and a flat 2D map |
| `L` | Node labels: auto, updates, all or none |
| `S` | Find a session, to-do or task |
| `N` | Add a task |
| `M` | Message the assistant |

The mouse wheel or a two-finger pinch zooms toward the pointer. Click a node to inspect it, and click empty canvas to let it go. See [Command view](command-center.md).

## In Brain maps

| Key | Action |
| --- | --- |
| `F` | Fit the map |
| `Space` | Search for a part to add |
| `Ctrl F` | Find a part already on the map |
| `Ctrl A` | Select all parts |
| `Shift` + click | Pick several parts. `Shift` + drag on empty canvas picks a region. |
| `Ctrl D` | Duplicate the selected parts and the wires between them |
| `Delete` | Remove the selected parts |
| Arrow keys | Nudge the selected parts (`Shift`: further) |
| `Ctrl` + scroll | Zoom around the pointer |
| `0` `+` `-` | 100%, zoom in, zoom out |
| `Ctrl Z` / `Ctrl Shift Z` | Undo / redo |
| `Ctrl S` | Save, even from inside a field |
| `F8` | Go to the next problem (`Shift`: the one before) |
| `[` / `]` | Hide or show the parts panel / the inspector |
| `?` | Open the map's legend and shortcuts |
| `Esc` | Cancel a wire, clear the selection, then close |

## In the project map

Open the project map from **Agents › Workflows › Project map**. Click the map first, then:

| Key | Action |
| --- | --- |
| Arrow keys | Move to the nearest item in that direction |
| `Shift` + arrow keys | Pan the map |
| `Enter` | Explore the selected item |
| `Backspace` or `Esc` | Go up a level |
| `Alt ←` / `Alt →` | Back / forward |
| `Home` or `0` | Fit the map |
| `+` `-` | Zoom in, zoom out |
| `/` | Search the map |

## On this site

Press `/` on a guide page to jump to its search box.
