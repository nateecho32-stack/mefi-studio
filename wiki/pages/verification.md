# Verification and storage

Studio's central rule is that a worker saying it is done does not make a task Done. This page covers what counts as evidence, where the board lives, and the observation-only experiments that ride along.

## Awaiting verification

A finished attempt settles to `awaiting_verification` with its evidence attached: the sentinel line, the exit code and the session it spawned.

- A claimed check counts only with a recorded successful run in that attempt's session and time window.
- Failed or pending checks block completion.
- Unavailable evidence waits without spending a retry.
- Edit-only work may pass on attributable completed edits.
- Historic successful exits without evidence are never turned into Done.
- Only cards that can actually settle have their evidence read, so a card waiting on a check or on handed-off children costs nothing per pass.

**In source**, two more guarantees hold. A check result counts only for the attempt it was queued for, so a retry that changed nothing is no longer accepted on an earlier run's pass. A Done you set by hand is no longer reopened by a stale failure. The verdict names who ran the check, and a retry's note carries the failing command and its output for the next worker.

Housekeeping verifies settled attempts, and you can confirm a task yourself in **Review**. Verification does not independently certify every acceptance criterion, which is why [Your first project](getting-started.md#5-review-and-recover) asks you to run the project's checks and try the change before accepting it.

## Where the board lives

Each project's board and stores sit under the app's local `data/projects/<id>/` folder; a portable build keeps its own under `resources/app/data`. None of it is committed or packaged.

- The JSON views are the authoritative board.
- An optional SQLite store can hold the board outside a synced folder: set `MEFI_STUDIO_BOARD_DB`. When it is on, every commit rewrites the JSON view as well.
- `node scripts/reconcile-board.mjs` repairs a backlog offline.
- `node scripts/reconcile-store-fork.mjs --dry-run` previews syncing the missing slice with the portable build's store; drop `--dry-run` to apply.

Workers must never rewrite Studio's own task store; task history belongs to Studio's own code paths.

## Durable handoffs

A new handoff keeps the child's exact identity and full scope, recovers an interrupted admission, becomes a card of its own and holds its parent until the child finishes. Only proven matching obligations are discharged; older free-form "remaining" text cannot always be matched and may need a person to read it.

## Policy Lab

The **Policy Lab** is observation-only. Dispatches append episodes under `data/policy-lab/`, and `npm run policy-lab` replays candidate configurations against them. The lab never changes live dispatch.

## Loop monitor

`node tools/monitor_loop.mjs` runs the real agent loop against a virtual clock, an hour of loop time in about a second, across five worker-behaviour scenarios. It reports where each card's time went, what each pass cost and how the board moved.

## Jev shadow mode

The **Jev intake classifier** records `jev-proposal` events at admission. It can never suppress work, merge tasks or start agents. Its kill switch is `settings.jevShadow === false`.

## Renderer recovery

If the window's renderer process disappears while Studio's host is still alive, bounded renderer recovery restores the saved workspace. Content-free diagnostics are kept so the cause can be found without discarding the board. See [Troubleshooting](troubleshooting.md#the-window-went-blank-or-disappeared).
