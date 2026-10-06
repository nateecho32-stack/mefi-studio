# The agent engine: what lags, and what to build next

Proposed 5 October 2026, waiting for the owner's yes. Written from a day of
measurements on the owner's laptop (16 GB, 13.8 GB usable).

## In one paragraph

Studio's own window and engine are not what slows the PC down. Each coding
agent Studio starts is a separate program of half a gigabyte or more, and the
PC usually has about 1 GB free because other apps (the Claude and ChatGPT
desktop apps, Edge) hold most of the memory. So the plan is to make the engine
decide how many agents can run from the memory that is actually free, reuse
agent programs instead of starting one per task, and show that on screen.
Moving off Electron comes after that, and saves memory rather than speed.

## What was measured

`C:\wt\gap\measure\sample-lag.ps1` recorded every process's memory and CPU
every 15 seconds from 08:41 to 18:55 on 5 October (1,592 samples, 1,020 with
Studio open), while the owner used the PC normally.

| Part | Typical memory (private) | Busiest moment | CPU |
| --- | --- | --- | --- |
| Studio's engine (Electron main process) | 190 MB | 514 MB | 0% typical, 4% at most |
| Studio's window (renderer) | 230 MB | 2.5 GB once | 0% typical, 6% at most |
| Studio's GPU process | 490 MB | 1.1 GB | 0% |
| One agent program (opencode) | 565 MB working set | 731 MB | under 5% |
| One agent program (Claude Code) | 190 MB working set | 290 MB | 1% |
| All agent programs at a moment | 890 MB | 2.3 GB | under 11% |
| Other apps on the PC | Claude desktop 4.3 GB, Edge 3.2 GB, ChatGPT 1.7 GB, Defender 0.85 GB, Discord 0.8 GB | | |

Free memory: median 1.0 GB, at worst under 300 MB. CPU for the whole PC:
median 25%. When the PC lagged, memory was full (Windows was paging), not the
processor.

## What it means

1. **The UI is not holding the engine back.** The window idles at 0% CPU,
   paints only when something changes, and receives row changes instead of
   whole lists. Nothing here says the window should move to another
   technology for speed.
2. **Agents are the cost.** Every agent run starts a CLI that holds 0.2 to
   0.7 GB for as long as it lives. Three opencode runs at once take about
   2 GB, which this PC rarely has free.
3. **Leaving Electron saves memory, not speed.** The Rust/Tauri host would drop
   the GPU process and part of the window (about 0.5 to 0.7 GB in total),
   because WebView2 shares Edge's runtime. Worth doing, but after the engine
   work below, since it does not change how many agents fit.

## The plan, in order

**1. Admission by free memory (the supervisor).** Before the engine starts an
agent, it checks free memory against what that kind of agent typically takes
(measured per CLI and kept up to date from its own runs), keeps a safety
margin for the PC (default 1.5 GB), and otherwise queues the task with a
reason the user can read ("waiting for memory: 0.8 GB free, opencode needs
about 0.6"). A hard cap still applies. An agent that has been idle past a limit
is parked (its session saved) to give memory back. This lives in the engine
(main.cjs today, the Rust host later), never in the window. *Kill switch:* a
setting that turns admission off. *Done when:* starting five tasks on this PC
never pushes free memory under the margin, and each waiting task says why.

**2. Fewer, longer-lived agent programs.** Where a CLI can serve many tasks
from one process (the Codex app-server, opencode's server mode, Claude Code's
SDK sessions), keep one per account and send it work, instead of starting a
CLI per task. *Done when:* four tasks on the same provider run in one process,
and the measured memory per extra task drops below 100 MB.

**3. Engine health on screen.** The status bar shows agents running and
waiting, free memory against the margin, and the next task due to start; the
Map and Fleet mark a task waiting for memory differently from one waiting for
you. The user stays in control: pause all, raise or lower the cap, and start a
waiting task now (accepting the risk).

**4. Measure every run.** Each run records its agent's peak memory and CPU in
the run log, so the numbers above stay current and admission learns real costs
instead of guesses.

**5. Then the host move (Rust migration stage 3).** Swap Electron for the
Tauri host once 0.5.x is stable, for the ~0.5 to 0.7 GB it saves and the
smaller download. The engine modules already ported (settings, keys, projects,
images, snapshots, skills, git) carry over unchanged.

## What the owner decides

- Yes or no to steps 1 to 4 before more Rust ports.
- The default safety margin (1.5 GB proposed) and the default cap (3 agents).
- Whether waiting for memory may ever be skipped automatically (proposed: no,
  only by the user's "start now").
