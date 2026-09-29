# Settings and Configuration

**Settings** holds your personal choices: your names, how Studio starts, how it looks and sounds, updates and diagnostics. Everything about agents lives in **Agents › Setup** instead.

Two new ways to find settings are <span class="status next">Coming in 0.4.5</span>: **Configuration**, a searchable list of every setting, and the [setup helper](#/setup-helper), which walks you through every agent setting.

## Open Settings

- Press `4`, or `Ctrl ,` from anywhere, even while you're typing.
- In Build's menu, choose **Settings** at the foot.
- In Vibe, the gear at the top right opens a short **Settings** panel with your permission mode, Studio mode, colours, names and **Open Vibe on launch**. **Full view** opens the whole Settings page.

Settings has four categories: **General**, **Appearance**, **Audio** and **System**. To jump to one control, type its name in **Find a setting…** at the top of the list.

## General

### Profile & startup

- **Your name** and **Companion name**.
- **Studio theme**. **Appearance settings** opens the full theme choices.
- **Motion**: **Full**, **Calm** (no looping animation) or **Off** (no animation).
- **Let your companion move** and **Blur behind panels**.
- **Open Home on launch**, which reads **Open Vibe on launch** in Vibe mode. Turn it off to open the Command view instead.
- **Studio mode**: **Vibe** or **Build**. See [Vibe mode](#/vibe-mode).

<span class="status next">Coming in 0.4.5</span> Three more startup settings:

- **When Studio opens**: **Resume what I had** (the default), **Start agents** or **Keep agents off**. The launch screen's main button follows it, and opening with agents off stays one click away.
- **Show Command view after 5 quiet minutes**, off by default. In 0.4.4, Studio switched to the Command view by itself after five quiet minutes.
- **Start with Windows**: Studio opens in the tray when you sign in to Windows, on the project you had open. The agents then follow **When Studio opens**.

### Community

Your link to the Void Engine Discord. **Help › Community** opens this card too. Linking is optional and unlocks nothing: every theme and look is free without it. Listen together and the Void Engine rooms use the link.

When linking is available, you'll see **Link my Discord**, **Check now** and **Unlink**. Linking reads your Discord id and name, and your roles and join date in the Void Engine server. Nothing about your projects is sent.

<span class="status next">Coming in 0.4.5</span> **Connection details** takes the Mefi Studio Link application ID and the rooms hub's address, once per PC. **Save** says whether the hub answered.

> <span class="status rolling">Rolling out</span> Discord linking and rooms switch on once the owner's rooms hub is online and the Mefi Studio Link app is set up. See [Friends, rooms and playdates](#/friends-and-rooms) and [The Void Engine Discord](#/discord).

## Appearance

Themes, node styles, layouts, motion and glass, shown beside the live tree. Press `U` to open it. It has four sections: **Theme**, **Nodes**, **Layout** and **Interface**. Every look is free. See [Themes, node styles and looks](#/appearance).

## Audio

- **Open music & video** opens the media player, which also holds your audio connection and reactions. See [Music, video and the player](#/media-player).
- **Sound effects** sets Studio's own sounds.

## System

### Updates

- **Published builds**: the portable app checks GitHub every 20 minutes. **Check GitHub** checks now, and **Update** downloads the new build and checks it.
- **Live update** is for source installs: Studio applies changes to its own files while it runs. **Apply updates automatically** lets it do that without asking.

> **In 0.4.4, Update doesn't finish.** It downloads and checks the new release, but the step that installs it never runs. Update by hand this once: the [download page](../download.html#updates) has the steps. This is fixed in 0.4.5. See [Updates](#/updates).

### Diagnostics

The speed probe, the Performance profiler, the auditor and machine tools. See [Trace, logs and diagnostics](#/trace/diagnostics).

### Integrations and Discord Server Styler

Two optional extras for separate projects:

- **Integrations** launches the optional Ruins Runner game. See [Ruins Runner](#/ruins-runner).
- **Discord Server Styler** starts a separate bot and its local dashboard. <span class="status next">Coming in 0.4.5</span> The card stays hidden until Studio finds that project.

## Agent settings

Everything about agents lives in **Agents › Setup**:

| Pane | What's there |
| --- | --- |
| **Team & models** | Who does what and on which model, the agent seats, and saved teams |
| **Providers** | Sign-ins, API keys, local servers, auto setup and the **Connection log** |
| **Routing & fallback** | Which provider answers, model routing and the coding workers |
| **Run behavior** | The queue and approvals, and how the team coordinates and reports |

Team changes wait for **Apply changes**, or **Discard draft** to drop them. Older links to Settings › Connections, Models or Automation open these panes. Your permission mode has its own page: [Permissions and decisions](#/permissions).

## Find any setting

- **Find a setting…** searches inside Settings.
- **Search Studio** (`Ctrl K`) finds any setting by name or label, such as *Blur behind panels*. Picking one opens its category, expands its section and puts the cursor on the control.

## Configuration

> <span class="status next">Coming in 0.4.5</span> Configuration isn't in the 0.4.4 download.

Configuration lists every setting in Studio in one searchable tree.

1. Press `Ctrl Shift ,`, or choose **All settings in one place** under Settings' categories.
2. Pick a group, or type in the search box.
3. Pick a setting to open its real control.

Settings are filed in seven groups: **Inference & Agents**, **Knowledge**, **Files & Exec**, **Web & Community**, **Storage**, **UI & Surfaces** and **Dev & Meta**. Configuration never keeps a second copy of a setting: it always opens the real one.

**UI & Surfaces** also holds **Interface scale**, which makes everything in Studio smaller or larger, from 70% to 150%. Studio keeps your choice on every launch.

## Where settings are kept

Your settings, saved keys, project list and Discord link are stored on your PC in `%APPDATA%\Mefi's Studio AI+`. Keys are encrypted with Windows' own key store, so they only work for the Windows account that saved them. See [Privacy](#/privacy).

## Planned

After 0.4.5, a menu overhaul is planned that puts every setting on one Settings page. See the [roadmap](../roadmap.html).
