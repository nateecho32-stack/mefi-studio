# FAQ

## Is Studio free?

Yes. Mefi Studio is free and open source under the MIT license. Every theme and node style is included in 0.4.4, including the Void collection. AI services may charge for the account or API you connect.

## Can I join the community without using the app?

Yes. Join the [Void Engine Discord](https://discord.gg/xgfKc5pVxG) to share an idea, show a work in progress, ask a question or hang out. You can also meet Studio, the new Discord bot, and help shape what it becomes.

## Do I need an API key?

Not necessarily. You can use a supported coding CLI login, an API key or a local model for the assistant. Building tasks also needs a coding CLI installed and signed in. **Start here** guides you through setup; [Connections and providers](connections.md) explains the choices.

You can open the app, browse the catalog and use saved work without an AI connection.

## Which coding agents work with it?

OpenCode, Claude Code, Codex, Grok and Antigravity. Start with one you already use and check its connection before creating a task.

## Does it work on macOS or Linux?

Studio is built and tested for Windows 10 and 11. Other platforms are untested. The portable Windows download needs no installer or Node.js.

## Does my code leave my computer?

It may, when a connected AI provider or coding agent needs project context. Studio keeps its records locally and has no usage telemetry. Media, Discord and shared-room features use their own connected services. See [Privacy and security](privacy.md).

## Can we watch videos together?

Studio 0.4.4 has a personal media player. Synced watch-and-listen rooms are rolling out and depend on the app's Discord and room services being available. The Discord community is open now; see [Community](../../community.html) for what's available and what's planned.

## Can I say “Hey Studio” to open it?

Not in 0.4.4. An optional voice popup, transcription through a service you choose, and optional spoken replies are ideas for the future.

## Can several agents work on my project?

Yes. Studio can run several builders and coordinates their file access. Start with a small worker limit, and avoid having unrelated tools edit the same files at the same time. See [Tasks and the board](workflow.md).

## Will it keep working when I close the window?

With background mode enabled, closing the window hides Studio to the tray; active work can continue while the computer is on and awake. Quit from the tray when you want to close the app. A sleeping or shut-down computer cannot keep running agents.

## Why is a task waiting for verification?

The worker has finished its attempt, but Studio still needs evidence that it works. Open **Review** to read the checks and results. See [Verification](verification.md) before confirming it yourself.

## Can I use Studio on several PCs?

Install it on each PC. **Friends → Your PCs** helps sync project Git commits through GitHub. Tasks, conversations and local settings do not sync that way; set up your connections on each computer.

## How do I update or get help?

Check **App updates** in Settings, or use the [download page](../../download.html). For a problem, start with [Troubleshooting](troubleshooting.md). To help improve Studio, see [Contributing](contributing.md).
