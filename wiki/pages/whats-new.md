# What's new in 0.4.4

Studio 0.4.4 came out on 27 September 2026, and it's the current download. [Download it for Windows](../../download.html) or open the [GitHub release](https://github.com/nateecho32-stack/mefi-studio/releases/tag/v0.4.4).

## Easier setup

**Start here** can install Codex, Claude Code, Grok or Antigravity, open its sign-in and check the connection. **Use for the whole studio** then runs chat, project mapping, planning, the agents and coding through that one account. In 0.4.4 the install and sign-in window may close at once: see [Known problems](#known-problems-in-044).

**New app**, beside Vibe's project picker, makes a project folder under Mefi Apps, starts Git in it and sends your description through **Build it** as the first request.

[Set up your first project](getting-started.md).

## Work you can follow

**Build it** in Vibe can split a bigger request into two to six steps. A **Plan in flight** card follows them, and **Make it one task** puts the steps that haven't started back into a single task.

When you reopen a project, Studio reports what changed while it was closed: commits, uncommitted edits, and Claude Code or OpenCode sessions in that folder. It checks queued tasks against that work before a worker takes them. A task that looks already done waits under **Needs you** with **Mark it done**, **Drop it** or **Build it anyway**, and only you answer it.

Vibe's cards come and go with what they have to say: **Needs you**, **Building now**, **Freshly done** and **Fresh ideas**. Tasks, Plans, Ideas, Team and Settings open as compact panels inside Vibe. The Tasks panel shows a list or lanes, and a finished task has **Ask for a change** for another pass. See [Vibe mode](vibe-mode.md).

## More control over agents

There are four permission modes: **Always ask**, **Accept per task**, **Auto** and **Elevated only**. **Auto** is the default. Every choice Mefi makes for you keeps its reason, with **Why** and **Undo**, and things only a person can do go into a short **For you** list.

Mefi learns from your answers. You can scope what it learns to this project or all projects, switch **Learn from my answers** off, or **Forget** what it learned.

In **Auto** and **Elevated only**, the desk agent settles ordinary questions for you and marks its answers **Mefi decided**. Questions about permissions, risk or things only you can do always wait for you. The companion's list of what needs you gains **Clear list**. [Permissions and decisions](permissions.md) has the details.

## Appearance and media

Every theme and node style is free, including the Void collection. Pick them in **Appearance**; you don't need Discord for any of them. See [Themes, node styles and looks](appearance.md).

Music & video puts the player and the saved queue in one panel. **Browse here** opens websites inside the player, and local music shows record artwork. See [Music, video and the player](media-player.md).

## Across PCs

**Friends › Your PCs** shows how this PC compares with the project's default branch on GitHub. **Sync this PC** pulls and pushes that branch without ever force-pushing. Conversations, settings and saved keys stay on each PC. See [Your PCs](your-pcs.md).

## Other changes

**Trace**, under **Agents › Live**, shows Studio's log channels in one viewer. See [Trace, logs and diagnostics](trace.md).

An update's **Restart now** stops the coding agents, saves their latest work and relaunches Studio paused, instead of waiting for builds to finish. This release also brings many bug fixes and a faster Command view.

## Known problems in 0.4.4

- **In-app updates don't finish installing.** Studio can check GitHub, download a new release and verify it, but the step that installs it after Studio closes doesn't run. When 0.5 comes out, [update by hand](updates.md#update-from-044-by-hand); the 0.5 release will say how. The fix ships in 0.5, so in-app updates work from 0.5 on.
- **Guided sign-in windows may close at once.** [Sign in from a terminal](connections.md#sign-in-from-a-terminal), then use **Check connection** and **Use for the whole studio**. Fixed in 0.5.

## Coming in 0.5

0.4.4 is still the current download. The next release is 0.5, and it's being built now, with no release date yet. There is no 0.4.5 or 0.4.6: both were folded into 0.5.

0.5 is taking shape on `main`: the setup helper, clearer reasons when agents aren't working, more than one Claude Code or Codex login, sharing between your own PCs, an optional new layout, Windows notifications, undo for deleted tasks and ideas, Sign in with ChatGPT, and more. Rooms and companion playdates are built too, and they're <span class="status rolling">Rolling out</span>. Faster agent sends, kept logs, a faster launch and Friends 2.0 are planned for 0.5 and still <span class="status progress">In progress</span>. [Coming in 0.5](coming-in-0-5.md) lists it all.

## Studio is moving to Rust

On 3 October 2026, work started on moving Studio to Rust with Tauri 2, in stages. The screens stay HTML and JavaScript, with the same settings and API keys. The Electron build is unchanged and is still what ships, and there's no date for the switch. [Studio is moving to Rust](coming-in-0-5.md#studio-is-moving-to-rust) has the stages.

## Full history

Read the [changelog](https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md) for every change, release by release.

The [40-second showreel](https://github.com/nateecho32-stack/mefi-studio/releases/download/v0.4.2/mefi-studio-v0.4.2-discord.mp4) shows Studio's look, using the earlier 0.4.2 release.
