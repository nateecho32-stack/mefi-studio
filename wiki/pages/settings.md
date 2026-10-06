# Settings and Configuration

**Settings** holds your personal choices: your names, how Studio starts, how it looks and sounds, notifications, updates and diagnostics. Everything about agents lives in **Team** instead.

Two more ways to find a setting: **Configuration**, a searchable list of every setting, and the [setup helper](#/setup-helper) (**Help › Setup guide**), which walks you through every agent setting.

## Open Settings

- Press `Ctrl ,` from anywhere, even while you're typing, or press `4`.
- Choose **Settings** at the foot of the rail.
- In Social, the Settings button at the top right of Today (or `S`) opens a short **Settings** panel: your permission mode, **Mode**, colours, names, **Open Social on launch**, **Always start in Social mode** and **Key tips**. **Full view** opens the whole Settings page.

Settings lists its places on the left: **General**, **Notifications**, **Appearance** with **Size and density** under it, **Map look** and **Sound and music**; then, under **Updates and help**, **Updates**, **Report a problem** and **Other apps**; and under **Advanced**, **System**. To jump to one control, type its name in **Find a setting…** at the top of the page.

## General

### Profile & startup

- **Your name** and **Companion name**.
- **Open Home on launch** (it reads **Open Today on launch** in Social). Turn it off to reopen the last page you used.
- **Always start in Social mode**. Turn it off to open the mode you used last.
- **Show key tips**: small pop-ups beside buttons that show the key that does the same thing.
- **Suggest files, tasks and skills while I type**: `@`, `#` and `/` in the message box.
- **Show the Map after 5 quiet minutes**, off by default.
- **Agents when Studio opens**: **Resume what I had** (the default), **Start agents** or **Keep agents off**. The launch screen's **Start agents** switch follows it, and opening with agents off stays one click away.
- **Daily news on the launch screen**: the day's AI and developer-tool news beside your projects, fetched once a day.
- **Start with Windows**: Studio opens in the tray when you sign in to Windows, on the project you had open. The agents then follow **Agents when Studio opens**.
- **Mode**: **Social** or **Studio**. See [Social mode](#/vibe-mode).

### Community

Your link to the Void Engine Discord. Linking is optional and unlocks nothing: every theme and look is free without it.

When linking is available, you'll see **Link my Discord**, **Check now** and **Unlink**. Linking reads your Discord id and name, and your roles and join date in the Void Engine server. Nothing about your projects is sent.

Friends needs no setup: the Mefi Studio relay is built into Studio, and **Sign in with Discord** sits in Friends. See [Friends, rooms and playdates](#/friends-and-rooms) and [The Void Engine Discord](#/discord).

## Notifications

Studio tells Windows when something waits on you, and only while Studio isn't the window you're looking at. **Send Windows notifications** turns them on or off. Choose what counts (**A task needs me**, **A task fails**, **A task finishes**), whether to **Flash the taskbar icon**, **Show a count on the taskbar icon** or **Play a sound**, and **Stay quiet at night** between the hours you pick. **What a notification says** is **Generic** at first, so task titles don't end up in Windows' history. **Send me a test notification** tries it.

## Appearance

**Theme** and **Interface**: colour themes, the **Focus**, **Studio** and **Atmosphere** presets with **Density**, **Glass intensity** and **Glow intensity**, **Motion** (**Full**, **Calm** or **Off**), **Let your companion move** and **Blur behind panels**. Press `U` to open it. Every look is free. See [Themes, node styles and looks](#/appearance).

**Size and density**, under Appearance, has its own page with a live picture of the window: **Interface scale** (70% to 150%), **Text size**, **Density** (**Compact**, **Comfortable** or **Spacious**) and **Detail**, how much each session row and board card shows. **Apply** keeps your choice, and **Reset** goes back to the defaults.

## Map look

The node styles and tree layouts, and **Node tree details**: the **Backdrop**, **Speech bubbles**, the **Card style** and **Zen mode**. See [The Map](#/command-center).

## Sound and music

- **Open music & video** opens the media player, which also holds your audio connection and reactions. See [Music, video and the player](#/media-player).
- **Sound effects** has the **Zen bells** and their **Profile**.

## Updates

- **Published builds**: the portable app checks GitHub every 20 minutes. **Check GitHub** checks now, and **Update** downloads the new build, checks it and installs it after Studio closes. **Roll back** puts back the build this one replaced. Your projects, tasks and settings stay as they are.
- **Development / beta** receives built updates automatically, for testing.
- **Live update** is for source installs: Studio applies changes to its own files while it runs. **Apply updates automatically** lets it do that without asking.
- **Tell me what's new after an update** shows what changed when an update lands.

A private repository needs a read-only token: **Save token**. See [Updates](#/updates).

## Report a problem

Builds a report you can read before you save it, with **Replace task titles with numbers** and **Include the crash record**. **Tell me when Studio closes unexpectedly** offers a report after a crash. See [Trace, logs and diagnostics](#/trace).

## Other apps

**Copy setup prompt** copies a prompt for Claude Code, Codex or another AI helper, so it can walk you through setup. **Let apps on this PC talk to Studio** lets those apps see what the agents are doing, message Mefi and hand Studio tasks, which wait for your OK. It's off until you turn it on. The [Other apps guide](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/studio-api.md) has the details.

## System

### Diagnostics

The speed probe, the Performance profiler, the auditor and machine tools. See [Trace, logs and diagnostics](#/trace/diagnostics).

### Integrations and Discord Server Styler

Two optional extras for separate projects:

- **Integrations** launches the optional Ruins Runner game. See [Ruins Runner](#/ruins-runner).
- **Discord Server Styler** starts a separate bot and its local dashboard. Its card stays hidden until Studio finds that project.

## Agent settings

Everything about agents lives in **Team**:

| Place | What's there |
| --- | --- |
| **Overview** | Your team, whether it's ready, the queue switches and how work runs |
| **Providers** | Sign-ins, more than one login, API keys, local servers, auto setup and the **Connection log** |
| **Seats and models** | Who does each job and on which model, how hard it thinks, and **More settings** for routing, the coding workers and saved teams |
| **Permissions** | How much Mefi may decide for you. See [Permissions and decisions](#/permissions). |

Team changes wait for **Apply changes**, or **Discard draft** to drop them. Older links to Settings › Connections, Models or Automation open these places.

## Find any setting

- **Find a setting…** searches inside Settings.
- **Search** (`Ctrl K`) finds any setting by name or label, such as *Blur behind panels*. Picking one opens its place and puts the cursor on the control.

## Configuration

Configuration lists every setting in Studio in one searchable tree.

1. Press `Ctrl Shift ,`, or choose **All settings in one place** under Settings' places.
2. Pick a group, or type in the search box.
3. Pick a setting to open its real control.

Settings are filed in seven groups: **Inference & Agents**, **Knowledge**, **Files & Exec**, **Web & Community**, **Storage**, **UI & Surfaces** and **Dev & Meta**. Configuration never keeps a second copy of a setting: it always opens the real one. It also indexes the [setup helper](#/setup-helper)’s sections under the same groups, with **Walk me through setup** pinned at the top of **Inference & Agents**.

**UI & Surfaces** also holds **Interface scale**, which makes everything in Studio smaller or larger, from 70% to 150%. Studio keeps your choice on every launch.

## Where settings are kept

Your settings, saved keys, project list and Discord link are stored on your PC in `%APPDATA%\Mefi's Studio AI+`. Keys are encrypted with Windows' own key store, so they only work for the Windows account that saved them. See [Privacy](#/privacy).
