# Trace, logs and diagnostics

When something goes wrong, Trace shows you what Studio was doing. It puts Studio's logs in one viewer that you can search, filter and follow live. For slowdowns and connection checks, **Settings › System › Diagnostics** has a few more tools.

Trace arrived in 0.4.4. Small fixes are <span class="status next">Coming in 0.5</span>, and a bigger logging rework is <span class="status progress">In progress for 0.5</span>.

## Open Trace

- In Build's menu, go to **Agents › Live › Trace**. It sits beside **Activity**.
- Or press `Ctrl K` and type *trace*.

Trace has no single-key shortcut. `Esc` closes it.

## The channels

Pick a channel on the left. Each one shows its size and how many problems it holds.

| Channel | What it holds |
| --- | --- |
| **Studio log** | Everything Studio's host logs: agents, the assistant, tools, workers and updates |
| **Assistant** | The assistant's own log: its roles, decisions, notices and errors |
| **Runs** | Every coding run: when it started, fell back to another route, finished or was released |
| **OpenCode** | OpenCode's own log, from its data folder |
| **Window** | Warnings and errors from Studio's own window |

The **Studio log** and **Window** channels live in memory. They keep this session's newest lines and start empty after a restart, so copy what you need before you restart Studio.

**Refresh** reads every channel again.

## Find what you need

1. Pick a channel.
2. Type in **Search this channel…**.
3. Choose how many recent lines to read with **Tail**: 100, 250, 1000 or 2000.
4. Filter with the level chips (**All**, **Errors**, **Warnings**, **Info**) or with a source chip such as `agents` or `tools`. Each chip shows its count. Or turn on **Problems** to see only warnings and errors.
5. Leave **Follow** on to read new lines every two seconds while Trace is open.
6. **Newest first** flips to **Oldest first** and back.
7. **Copy** copies the lines shown. **Open file** shows the log file in its folder, for channels that have a file.

<span class="status next">Coming in 0.5</span> The chips keep keyboard focus while **Follow** updates them, the level chips no longer read "All undefined", errors read as plain sentences, and an empty channel says so where the lines would be.

## Diagnostics

Open **Settings › System › Diagnostics**:

- **Speed probe**: pick a model and choose **Measure tokens/s**. It sends one small request on your account. The result shows on the model's card in the catalog.
- **Open profiler**: the Performance profiler records frame timing, slow rendering, host requests, CPU and memory. Choose **Start capture**, reproduce the slowdown, then come back to **Stop** and **Export JSON**. A capture stays in memory until you export it.
- **Run auditor** runs local wiring and gap checks. **Machine** shows test runs and the automatic stopping of runaway ones. Both open in the Session explorer.

The **Connection log** (provider, tool and probe activity) is in **Agents › Setup › Providers**.

## Report a bug

1. Note your Studio version, and whether you use the portable download or run from source.
2. Write down what you did, what you expected and what happened instead.
3. In Trace, open the channel that covers the problem, narrow it down with search or **Problems**, then **Copy** the lines.
4. Before you share anything, read it and remove private details: API keys, tokens, email addresses, and file paths that show your name or your projects.
5. Open a [bug report on GitHub](https://github.com/nateecho32-stack/mefi-studio/issues/new?template=bug_report.md) and paste it in.

You can also ask for help in the [Void Engine Discord](https://discord.gg/xgfKc5pVxG). It's optional; GitHub works without it.

## In progress for 0.5

> <span class="status progress">In progress for 0.5</span> A logging rework: structured logs, a transcript of each run, and old logs archived instead of deleted, with all of them kept. It was meant for 0.4.6, which was folded into 0.5. It's being built on a branch, so it isn't on `main` yet. See the [roadmap](../roadmap.html).

## Related pages

- [Troubleshooting](#/troubleshooting) has fixes for common problems.
- [Privacy](#/privacy) explains what stays on your PC.
- [Model Lab and usage](#/model-lab) shows speed and usage for each model.
