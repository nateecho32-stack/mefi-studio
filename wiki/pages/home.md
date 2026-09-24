# Mefi's Studio AI+ wiki

Mefi's Studio AI+ is a local-first Windows workspace where you talk an idea through with an AI companion, hand it over as a task, watch coding agents build it and verify the result. It runs coding CLIs in parallel on your own folders, with whichever provider you already have, and keeps them from writing over each other.

![Command view with the assistant, its agents and the sample project's sessions and tasks](../../assets/screens/command.webp)

This wiki is the community companion to the repository docs. When the two disagree, the repository wins: the [README](https://github.com/nateecho32-stack/mefi-studio#readme), [GETTING_STARTED.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/GETTING_STARTED.md), [docs/architecture.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/architecture.md) and the [CHANGELOG](https://github.com/nateecho32-stack/mefi-studio/blob/main/CHANGELOG.md).

## Where to start

| If you want to… | Read |
| --- | --- |
| Install it | [Installation](installation.md) |
| Run your first task | [Your first project](getting-started.md) |
| Connect a provider or a coding CLI | [Connections and providers](connections.md) |
| See what changed recently | [What's new](whats-new.md) |
| Find your way around | [Getting around and shortcuts](shortcuts.md) |
| Understand what the board is telling you | [Tasks and the board](workflow.md) |
| Fix something | [Troubleshooting](troubleshooting.md) |
| Improve this wiki | [About this wiki](about-this-wiki.md) |

## Release and source

**v0.2.0**, published on 22 September 2026, is the first public release: a portable Windows zip that later updates itself in place. The source on `main` moves ahead every day. Pages describe the current source and say so when the release behaves differently.

These are in source but not yet in a release:

- one navigation **rail** down the left edge, replacing the tabs row, the Command dock and the hover sidebar's menus;
- saved keys in their own `auth.json` beside `settings.json`;
- **Brain maps** as a full node editor with pan, zoom, undo and multi-select;
- ad-free radio in **Style & sound**;
- a 30-second pause for a provider that fails three times in a row.

[What's new](whats-new.md) has the full list.

## The pieces

- **Workspace** (`H`). The home screen: *Studio at a glance*, the conversation with your companion, and **Your work**.
- **Task board** (`T`), **Plans** (`P`) and **Ideas** (`I`). Work with briefs, prerequisites, attempts and evidence; plans that interview you; an inbox of ideas.
- **Command view** (`D`). Every session, task and agent as a live node tree, with a rail for Work, Agents, Assistant, Done and Ask.
- **Brain maps** (`B`). The agent pipeline drawn as a map you can rewire, and the decision lane that brings agents' questions to you.
- **The service loop.** Watcher, machine, auditor, keeper, thinker, briefer, responder, foreman, compactor, overseer and scout roles keep working from the tray.
- **Model catalog** (`1`), **Model Lab** (`2`) and the usage tracker. Cost, quality and privacy side by side, measured latency, and readings from your provider accounts.
- **Activity & evidence** (`3`), **Session explorer** (`E`), **Analyzer** (`A`), **Overhead** (`O`) and the profiler. Read-only views of what the work did.
- **Settings & connections** (`4`) and **Style & sound** (`U`).

## Honest scope

The repository is careful to separate what works from what is promised, and so is this wiki.

- **The scheduler is cooperative, not a sandbox.** File claims give one writer per path, and live-editor observations block known collisions. Unannounced files and unrelated tools can still collide. Opt-in per-session worktrees give each run its own checkout.
- **Verification reads evidence.** A finished attempt waits until its checks pass or you confirm it. It does not certify every acceptance criterion by itself.
- **It runs while your computer runs.** Studio keeps working from the tray, but it is not a cloud service and cannot work through a shutdown.
- **Model Lab measures; it does not pick your route.** Routing follows your settings, Jev or the coding tier.
- **Jev intake is advisory.** It runs in shadow mode and can never suppress, merge or start work.

A dated, claim-by-claim audit from 19 September 2026 is kept as a [historical record](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/archive/feature-audit-2026-09-19.md).

## Quick facts

| | |
| --- | --- |
| Platform | Windows 10/11; other platforms untested |
| License | MIT |
| Runtime | Electron 44; Node 24 for source installs |
| Telemetry | None, and no hosted account |
| Keys | Encrypted with the Windows keystore (DPAPI) |
| Repository | [nateecho32-stack/mefi-studio](https://github.com/nateecho32-stack/mefi-studio) |
