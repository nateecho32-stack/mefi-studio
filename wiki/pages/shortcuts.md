# Navigation and shortcuts

Press `Ctrl K` to search Studio for any page, setting, task or action. Press `?` for Studio's own shortcut sheet.

## Social and Studio

Studio has two modes in one window, with the same projects and tasks.

- **Social** is the calm mode, where Studio opens. Its home page, **Today**, has one box to talk or build and a board of what needs you, what's running, what to review and what's done.
- **Studio** is the in-depth mode. Your tasks are sessions in a list on the left, with **New task** (`Ctrl N`) on top. The task you pick fills the middle, and the inspector on the right shows its **Plan**, **Changes**, **Checks**, **Preview** and **Agent**.

Switch with the **Social | Studio** switch at the top left or `Ctrl M`. Search has **Switch to Studio** (or **Switch to Social**) too.

In Social:

- In the box, `Enter` talks it over and `Ctrl Enter` builds it.
- On Today, `T`, `P`, `I` and `M` open compact **Tasks**, **Plans**, **Ideas** and **Team** panels, and `S` opens **Settings**. **Full view** opens the whole page, and **Back** or `Esc` steps out.
- Other pages open beside Social's own narrow rail. **Today**, at its top, takes you back.

See [Social mode](vibe-mode.md).

## The rail in Studio

From top to bottom, the rail holds:

- **Projects**, which opens your projects so you can add or switch folders.
- The four places: **Work**, **Map**, **Team** and **Friends**. Friends also lists its pages under it.
- **Settings** and **Help** at the foot, with your companion. Help holds **Start here**, **Setup guide**, **Shortcuts**, **What's new**, **Report a problem** and the **Void Engine Discord**.

**Keep menu open**, the pin at the bottom, keeps the rail open beside the page in wide windows.

| Place | What's inside |
| --- | --- |
| **Work** | **Today** (your home page), **Tasks**, **Plans**, **Ideas**, the **Inbox**, the **Analyzer** and **Worktrees** |
| **Map** | The live tree, **Fleet** and **Pipelines** |
| **Team** | **Overview**, **Providers**, **Seats and models** and **Permissions**; then **Rules**, **Skills**, **Connectors**, **Related folders** and **Workflows** (Brain maps, Playbook, Project map, Context); then **Health and usage**, **Resources**, **Models** (Catalog, Performance) and **Inspect** (Sessions, Activity and evidence, Trace, Overhead, the profiler, Machine status, the Connection log) |
| **Friends** | **The Lobby**, **Rooms**, **Your PCs**, **Playground**, the **Project hub** and **Events** |
| **Settings** | **General**, **Notifications**, **Appearance**, **Size and density**, **Map look**, **Sound and music**, **Updates**, **Report a problem**, **Other apps** and **System**. See [Settings](settings.md). |

When you open a place, its pages are listed in the column beside the rail, with **Back** and **Forward** for that place (`Alt ←` and `Alt →`).

## The top bar and the status bar

The **top bar** holds, from left to right: the list toggle, the **Social | Studio** switch, where you are, **Search or run a command**, how many things need you (or **All clear**), what's working with its pause button, and the inspector toggle.

The **status bar** at the bottom holds **Layout** (the list, the inspector, the tab strip, their widths, **Reset layout** and **Size and density**), what's running and what waits on you, your AI usage, what's playing, this PC's CPU and memory (it opens **Team › Resources**), today's cost when Studio knows it, and your permission mode.

## Keys with Ctrl

| Key | Action |
| --- | --- |
| `Ctrl M` | Switch between Social and Studio |
| `Ctrl K` | Search |
| `Ctrl J` | Open the Inbox |
| `Ctrl N` | A new task, in Studio mode |
| `Ctrl T` / `Ctrl W` | Add a tab / close the tab you're on. `Ctrl W` never closes the window. |
| `Ctrl Tab`, `Ctrl 1` to `9` | Move between tabs |
| `Ctrl Shift T` | Reopen the tab you closed last |
| `Ctrl B` / `[` | Show or hide the list / the inspector |
| `Ctrl +` `Ctrl −` `Ctrl 0` | Interface scale up, down, or back to normal |
| `Ctrl ,` | Open Settings, even while typing |
| `Ctrl Shift ,` | Open **Configuration**: every setting in one searchable tree |

## Single keys

These work when you're not typing in a text field.

| Key | Opens |
| --- | --- |
| `H` | **Today**, your home page |
| `D` | The Map |
| `T` | The task board, or the Tasks panel on Social's Today |
| `P` | Plans, or the Plans panel on Social's Today |
| `I` | Feature ideas, or the Ideas panel on Social's Today |
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
| `/` | Search the model catalog |
| `R` | Refresh the model catalog |
| `?` | Show shortcuts |
| `Esc` | Close the current menu or layer. With nothing open, it opens your companion's menu. |

Trace has no single key: open it from **Team › Inspect › Trace** or Search.

<span id="in-command-view"></span>

## On the Map

| Key | Action |
| --- | --- |
| `←` `→` | Cycle sessions, or the siblings of the selected item |
| `↑` `↓` | Up to the parent, or down into its to-dos and tasks |
| `]` | The next task node |
| `Enter` | Run the selected node's first action |
| Double-click | The same, on the node you click |
| Right-drag | Orbit the camera |
| `F` | Rearrange and fit the whole tree |
| `Shift F` | Fit the selected branch |
| `Home` | Select the root and fit |
| `+` `−` `0` | Zoom in, out, or reset |
| `Space` | Pause or resume the spin. It doesn't pause the agents. |
| `C` | Camera: Overview, Follow or Free |
| `V` | Switch between the 3D orbit and a flat map |
| `L` | Node labels: Auto, Updates, All or None |
| `S` | Search, which also finds the Map's sessions, to-dos and tasks |
| `N` | Add a task |
| `M` | Message the assistant |

The mouse wheel or a two-finger pinch zooms toward the pointer. Click a node to inspect it, and click empty canvas to let it go. See [The Map](command-center.md).

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

Open the project map from **Team › Workflows › Project map**. Click the map first, then:

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
