# FAQ

## Is Studio free?

Yes. Mefi Studio is free and open source under the MIT license. Every theme and node style has been free since 0.4.4, including the Void collection. AI services may charge for the account or API you connect.

## Will there be paid extras?

Today, nothing in Studio costs money. The owner plans community credits: you'd earn them by trying or looking at other people's projects, and spend them to promote your own project or on cosmetics and creator styles. Credits are earned only, never bought. This is <span class="status planned">Planned</span>, and the details are still open. Follow it on the [roadmap](../roadmap.html).

## Can I join the community without using the app?

Yes. Join the [Void Engine Discord](https://discord.gg/xgfKc5pVxG) to share an idea, show a work in progress, ask a question or hang out. You can also try the Void Engine bot there and help shape what it becomes. See [The Void Engine Discord](discord.md).

The Discord is optional: nothing in Studio needs it.

## Do I need an API key?

Not necessarily. The assistant can use a coding CLI login, an API key or a local model. Building tasks also needs a coding CLI that's installed and signed in. **Start here** guides you through setup, and [Connect an AI](connections.md) explains the choices.

You can open the app, browse the catalog and use your saved work without any AI connection.

## Which coding agents work with it?

OpenCode, Claude Code, Codex, Grok and Antigravity. Start with one you already use, and check its connection before you create a task.

In 0.4.4, work built by a tool other than OpenCode usually waits for you to confirm it. <span class="status next">New in 0.4.5</span> Studio checks every tool's builds itself. See [Verification](verification.md).

## What are Vibe and Build?

**Vibe** is the calm front door: one box to talk an idea over or build it, what's being built, and what needs you. **Build** is the full studio, with the Command view, the boards, the models and every setting. Switch with the toggle at the top of Vibe or in **Settings › General › Studio mode**. See [Vibe mode](vibe-mode.md).

## Does it work on macOS or Linux?

Studio is built and tested for Windows 10 and 11. Other systems are untested. Linux support is <span class="status planned">Planned</span> for after 0.4.5: see the [roadmap](../roadmap.html). The portable Windows download needs no installer or Node.js.

## Does my code leave my computer?

It may, when a connected AI provider or coding agent needs project context. Studio keeps its own records locally and has no usage telemetry. Media, Discord and room features use their own services. See [Privacy](privacy.md).

## Can we watch videos together?

Studio 0.4.4 has a personal media player. Listen together and shared rooms are <span class="status rolling">Rolling out</span>: they depend on the rooms hub that the Studio owner runs, and on a linked Discord account. See [Friends, rooms and playdates](friends-and-rooms.md), or the [Community page](../../community.html) for what's available and what's planned.

## Can I say "Hey Studio" to open it?

Not yet. An optional voice popup that transcribes through a service you choose, with optional spoken replies, is an <span class="status idea">Idea</span>.

## Can several agents work on my project?

Yes. Studio can run up to three builders at once and coordinates which files they touch. Start with a small worker limit, and avoid having other tools edit the same files at the same time. See [Tasks](workflow.md).

## Will it keep working when I close the window?

Yes. Closing the window hides Studio in the Windows tray, and running work carries on while your PC is on and awake. To exit, choose **Quit** from the tray icon. A sleeping or switched-off PC can't run agents.

> <span class="status next">New in 0.4.5</span> A **Keep running in the tray when the window closes** switch in the [setup helper](setup-helper.md), and **Start with Windows**, which opens Studio in the tray when you sign in.

## Why does a task say Verifying?

The worker finished its attempt, but Studio still needs evidence that it works. Open the task to read the checks and results. See [Verification](verification.md) before you confirm it yourself.

## Can I use Studio on several PCs?

Yes. Install it on each PC. **Friends › Your PCs** keeps a project's Git commits in step through GitHub, with **Sync this PC**. Tasks, conversations and settings don't travel that way, so set up your connections on each PC.

> <span class="status next">New in 0.4.5</span> **Share between my PCs** carries the items you choose, such as open tasks and ideas, preferences and model results, between your own PCs. Keys go only after you type a confirmation. Conversations still stay on each PC. See [Your PCs](your-pcs.md).

## Can I share my setup with a friend?

<span class="status next">New in 0.4.5</span> Yes. **Share with friends** saves one brain, recipe, team setup, set of model results, memory note or your preferences to a `.mefishare` file. Studio cleans it and shows you what's inside first. A friend's file is reviewed before you use it, and it can't change your permissions.

## Can I use two Claude or ChatGPT subscriptions?

<span class="status next">New in 0.4.5</span> Yes. Add up to six Claude Code or Codex logins under **Connect an AI › More than one login** in the setup helper. Studio moves to the next login when one reaches its usage limit. See [Connect an AI](connections.md#more-than-one-login).

## What's new in 0.4.5, and what's next?

0.4.5 came out on 28 September 2026: see [New in 0.4.5](coming-in-0-4-5.md). The next release, 0.4.6, is <span class="status progress">In progress</span>, with faster agents, kept logs, a faster launch and Friends 2.0. There's no date yet. The [roadmap](../roadmap.html) shows what's being built.

## How do I update?

Open **Settings › System › Updates** and choose **Check GitHub**, or use the [download page](../../download.html). In 0.4.4 the in-app update can't finish installing, so move to 0.4.5 [by hand](updates.md#update-from-044-by-hand).

## Where do I ask for a feature or get help?

[Request a feature on GitHub](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=feature_request.md), or ask in the [Discord](https://discord.gg/xgfKc5pVxG). Check the [roadmap](../roadmap.html) first: it may already be planned. For a problem, start with [Troubleshooting](troubleshooting.md). To help build Studio, see [Contributing](contributing.md).
