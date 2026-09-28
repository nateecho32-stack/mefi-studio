# Find the right tool

Most day-to-day work fits in Home or Vibe. Use the other views when you need to inspect a session, find a change or understand why a task is waiting.

Press `Ctrl K` to search Studio by a tool's name. Press `?` for shortcuts. Single-letter shortcuts work when you are not typing in a text field.

## Inspect what changed

**Agents › Live › Activity** (`3`) opens **Activity & evidence**. Choose a session and use the change feed, diff, image or log view to inspect what it recorded. Filters help narrow the results by session, agent and time.

The file inspector includes **Reveal file** and **Copy path**. PNG evidence supports pins when you need to point at a particular part of an image.

Activity reads supported session records for the open project. If a worker's tool does not provide those records, use the task's evidence and attempt history instead.

## Look through a session

Open **Agents › Live › Sessions** (`E`) and select a session in the tree. Its details show the work and saved context.

**Session tools** opens the Assistant, Activity and Diagnostics tabs. These include briefings, the request inbox and local checks. Keep the panel closed when you only need the session details.

For a different overview, **Agents › Live › Overhead** (`O`) shows how tasks relate to sessions.

## Compare plans with the project

Open **Analyzer** (`A`) to compare project plans and notes with the source. Its findings point to files and lines, missing references or completion claims that need checking.

Start with the local analysis. The optional AI analysis uses your configured connection and sends selected excerpts when you request it.

Use the findings to decide what to inspect or turn into a task. [Tasks and the board](workflow.md) covers creating work; [Verification](verification.md) covers reviewing the result.

## Find logs and performance problems

**Agents › Live › Trace** puts Studio's logs in one viewer. Select a channel and inspect the messages around the problem you saw.

The **Performance profiler** is under **Settings › System › Diagnostics**. Start a recording, reproduce the slowdown, stop, then use **Export JSON** if you want to share the measurements in a bug report.

The **Connection log** under **Agents › Setup › Providers** helps explain failed provider calls or speed probes.

## Change the workspace

| Where | What you can change |
| --- | --- |
| **Agents › Setup** | Team, providers, models, routing and run behavior. |
| **Settings › General** | Names and startup preferences. |
| **Settings › Appearance** (`U`) | Themes, node styles, layouts and interface effects. |
| **Settings › Audio** | Music, video and sound effects. |
| **Settings › System** | Updates, diagnostics and optional integrations. |

All themes and node styles are free in 0.4.4. For the live tree's controls and media, see [Command view](command-center.md).
