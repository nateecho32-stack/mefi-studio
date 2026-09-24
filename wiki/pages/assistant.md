# The assistant and the agent loop

The assistant can always be messaged, and once you start the agents it is always working. It runs in Studio's main process, so it does not depend on a window being open. The repository's [agent-loop.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/agent-loop.md) walks the same loop with file references.

## Nothing runs until you say so

Every launch starts on the project chooser. **Open studio** leaves the assistant and the coding workers off; **Start agents** in the companion bar or the tray releases them. **Open and start agents** starts everything at once. Nothing is built, briefed or spent before that.

## The service loop

A service loop ticks every 30 seconds, or every two minutes while Studio is hidden. On its cadence it organises the node tree, scans the machine, runs the **Auditor** every five minutes, fixes and tidies, and with **Proactive** on, briefs every five minutes.

## Roles

The loop is visible: each role is an agent orbiting the assistant node in [Command view](command-center.md), wearing its own glyph.

| Role | Job |
| --- | --- |
| **watcher** | Notices stale sessions |
| **machine** | Watches CPU, memory and test leases |
| **auditor** | Files findings |
| **keeper** | Prunes |
| **thinker** | Decides what is next |
| **briefer** | Writes summaries |
| **responder** | Answers chat |
| **foreman** | Hands out work |
| **compactor** | Keeps context small |
| **overseer** | Reviews how the loop works |
| **scout** | Notices things other roles own |

A role's 150-second timeout does not cancel every underlying operation. The slot stays held until that operation settles, which blocks the same role from overlapping while unrelated roles carry on.

## Agent mail

The roles talk to each other. The watcher tells the keeper about stale sessions and the auditor about colliding files, the machine tells the foreman when it is holding new starts, and a finished builder tells the agent that called it what it did. Unread mail pulls its reader onto the next tick. On the tree a note rides a packet between two agents' orbs, and the assistant card lists the exchange under **Said to each other**.

## Messaging

Chat is a real conversation: a multiline composer, quick-ask chips, follow-ups resolved against the last reply, and replies grounded in the current board, inbox, open folder and the folder's own plan documents. Plain keywords work without AI.

Asking for work queues it; vague chatter gets a yes-or-no offer instead of an accidental job. **Work on it** on any node makes it the assistant's next piece of work.

Every session, todo and task is a **node folder** of typed context cells. The same cells compile into chat replies and into the prompts builders receive, so what the assistant says and what a builder is told come from one source.

## When an agent needs you

A run that hits something it should not settle alone files an issue instead of guessing. The live brain map triages it: retryable kinds may be settled by the assistant within a limit, and everything else becomes an **Ask** card with a recommended option. See [Brain maps and the decision lane](brain-maps.md).

## The overseer

The **overseer** keeps a playbook and lesson counts, files bounded upgrade requests, and repairs the loop every fifteen minutes: it resumes stale sessions and re-arms interrupted work.

## The tray and interruptions

Closing the window hides Studio to a tray icon and the loop keeps running. Builders journal their progress and checkpoint before quit, and interrupted work resumes on the next start instead of repeating.

If Studio went away mid-work, after a crash, a reboot or an update restart, and the work was under ten minutes old, the next launch reopens that folder and restores the agents that were running. Closing Studio yourself ends the sitting.

This is continuous only while Studio and the computer are running, subject to Pause, provider availability, backoff and budgets.

## Per-session worktrees

Set `MEFI_STUDIO_WORKTREE_RUNS=1` and each builder dispatch gets its own git checkout under `.mefi/worktrees/<runId>` on a `mefi/<runId>` branch, so concurrent runs cannot contend on one index or sweep each other's staged files. A settled branch merges back one run at a time.

- The checkout shares the repository's `node_modules` through a junction, with `npm ci` as the fallback; `MEFI_STUDIO_WORKTREE_NPM_CI=0` skips that.
- Nothing is dropped silently: a failed merge keeps the branch, uncommitted edits keep the checkout, and a crashed attempt's branch is renamed aside rather than deleted.
- A worktree starts from HEAD, so a run does not see other sessions' uncommitted work until it lands.

## Machine coordination

The machine role watches test leases and live processes, holds new starts when Studio becomes laggy, and auto-kills strays, hangs and over-age runs; every kill is logged and queued to the inbox. The default guards are 240 idle seconds, a 20-minute age limit and 1.5 GB. Relax them on a small or busy machine rather than switching them off.
