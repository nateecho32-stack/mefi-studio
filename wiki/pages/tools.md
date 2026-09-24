# Activity, Explorer, Analyzer and tools

Besides the workspace and Command view, Studio has a set of views that show what the work did. None of them start work.

## Activity & evidence (3)

**Activity & evidence**, once called A-Eyes, reads the OpenCode session store read-only, on a worker thread so the app stays responsive:

- a **change feed** with diffs, filterable by session, agent and time;
- per-session totals;
- **PNG** evidence you can drop pins on;
- a **log** tail.

Sessions are scoped to the project's folder. Clicking a node in the tree filters the feed and focuses the assistant on that session. The inspector shows the file, tool, line counts, agent, model, session and time, with **Reveal file** and **Copy path**.

## Session explorer (E)

The **Session explorer** holds the always-on assistant thread, the collateral watch, the local **Auditor** and the request **inbox**. Checkpoint actions are **Reference**, **Explore**, **Restore** and **Expand**.

## Analyzer (A)

The **Analyzer** compares plans and notes with the current source and lists `file:line` evidence, missing references and unverified completion claims. It runs locally on the folder Studio scanned when you opened it. The optional AI read sends bounded excerpts only when you ask.

## Task board (T), Ideas (I), Overhead (O)

- The **Task board** holds briefs, prerequisites, attempts, evidence and history. See [Tasks and the board](workflow.md).
- **Ideas** is the feature-idea inbox and graph. Idea scanning reads the available OpenCode text messages, filters candidates and can ask the configured AI to curate them. An idea becomes a task only when you or **Work through backlog** promote it.
- **Overhead** maps tasks to sessions.

## Performance profiler

The in-app **Performance profiler**, under **Live** in the rail, captures frames, scopes and hitches and exports JSON. Reports hold measurements, never task text or paths. The repository's [performance.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/performance.md) has the measurements and how to reproduce them.

## Key commands (Ctrl K)

The palette finds any tool, task or setting by familiar terms. Type what you would call it, not necessarily what Studio calls it. It also holds commands with no key, such as **Run auditor**, **Scan chats for ideas** and **Switch navigation: rail or classic**.

## Settings & connections (4)

Settings is split into sections down its left side:

| Section | Holds |
| --- | --- |
| **Auto setup** | One pass over what this machine already has |
| **Providers** | Keys, local servers and CLI logins, each with its status |
| **Model routing** | Who answers, the auto order and fallback, model selection |
| **Coding workers** | The builder CLI, coding tiers and per-CLI models |
| **Jev** | Jev routes and their keys |
| **Studio** | Whether a launch lands on the workspace or in Command view, and other app preferences |
| **Updates & diagnostics** | **App updates** and live update |
| **Integrations** | Optional tools, such as the [Ruins Runner](ruins-runner.md) launcher |
| **Log** | The studio log: what the assistant and the loop did last |

## Style & sound (U)

Recolours Studio with seven preset themes or your own colours, and plays local files, Spotify links and, in source, ad-free radio. See [Command view and the node tree](command-center.md#style-sound).

## Machine coordination

The machine role watches test leases and live processes, holds new starts when Studio becomes laggy, and auto-kills strays, hangs and over-age runs; every kill is logged and queued to the inbox. See [The assistant and the agent loop](assistant.md#machine-coordination).

## Developer tools

From a source checkout:

| Command | What it does |
| --- | --- |
| `node tools/monitor_loop.mjs` | Runs the real agent loop against a virtual clock, an hour in about a second, and reports where each card's time went |
| `node tools/profile_studio.mjs --help` | Reproducible renderer workloads for profiling |
| `python tools/verify_workspace.py --output tools/logs/workspace-ui` | Drives the real Electron workspace through the walkthrough and screenshots each step |
| `python tools/benchmark_startup.py` | Startup timing |
| `npm run capture` | Screenshot tour into `tools/logs/`; it uses your live data, so never publish those images |
| `npm run policy-lab` | Replays recorded dispatch episodes against candidate policies |
