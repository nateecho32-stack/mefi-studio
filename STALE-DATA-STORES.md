# Stale legacy data-store copies — swept 2026-09-21

The five top-level data files below were dead pre-store-fork copies, frozen at
the store fork on **2026-09-20 01:20 local (06:20Z)**. Nothing wrote them after
the fork, so the frozen machine gauge could be mistaken for a live reading.
They were deleted from the portable payload (task `task_65cd526223857ac3`,
project "2d Trippy Hell") and a tombstone was left in the payload itself.

## Dist payload paths (deleted)

- `dist/Mefi Studio AI+/resources/app/data/machine-status.json`
- `dist/Mefi Studio AI+/resources/app/data/resource-manager.json`
- `dist/Mefi Studio AI+/resources/app/data/eyes-assistant.json`
- `dist/Mefi Studio AI+/resources/app/data/eyes-briefing.json`
- `dist/Mefi Studio AI+/resources/app/data/eyes-tasks.json`

A per-payload note with the sweep evidence lives at
`dist/Mefi Studio AI+/resources/app/data/_STALE_LEGACY.md` (untracked; dist/
is gitignored).

## Repo-local twins (intentionally preserved, not live)

The repo `data/` tree has analogous frozen top-level twins
(`data/machine-status.json`, `data/resource-manager.json`,
`data/eyes-assistant.json`, `data/eyes-briefing.json`,
`data/eyes-tasks.json`). They are out of scope per AGENTS.md ("preserve local
data/ and the portable application's separate dist/ data") and are gitignored;
do not read them as live state.

## Live store pointer

Project-scoped reads/writes are remapped to the per-project store
`data/projects/<projectId>/` by `projects.dataPath()` (`scripts/projects.cjs`)
via the scoped eyes facade in `main.cjs`, and only `curated.json` and
`models.json` are app-wide *catalog* files. (Correction 2026-09-21: the
app-wide machine gauge, resource log, assistant state, legacy board writes and
briefing regen still target top-level `data/*.json` — see the UPDATE section
below.)

## Why the sweep is permanent

`scripts/package-portable.mjs` ships only the CATALOG set
(`curated.json`, `models.json`) into a payload, so rebuilding the portable app
cannot re-create the five swept files.

## UPDATE 2026-09-21 13:25 — the sweep did NOT hold; the re-emitted copies are live

The claim above (and "nothing writes them after the fork") is **obsolete**.
The store fork did not remove the top-level writers from `main.cjs`; after the
post-sweep repack/restart the payload app re-created four of the five files
with fresh mtimes (observed 2026-09-21 11:43 and 12:30, right after the
12:28:45 `03a7e7b` boot):

- `machine-status.json` + `resource-manager.json` — written on every machine
  tick by `main.cjs` (`MACHINE_STATUS_PATH`/`RESOURCE_LOG_PATH`, lines
  228-229, used at 328-329).
- `eyes-tasks.json` — `TASKS_PATH` (`main.cjs:1222`) is still a live write
  target for board writes.
- `eyes-assistant.json` — `ASSISTANT_PATH` (`main.cjs:2641`) is written on
  every assistant state save.
- `eyes-briefing.json` — still absent only because its writer
  (`BRIEFING_PATH`, `main.cjs:1221`, write at 2606) is the AI-gated briefer
  run, which has not fired since the sweep. Expect it back too.

**How to read a same-named top-level file now:** the pack script indeed ships
only the CATALOG set, but the *runtime* re-emits these names, so a file
present in `dist/Mefi Studio AI+/resources/app/data/` with a post-sweep mtime
is a **live app write, not a frozen relic**. The original hazard — a gauge
frozen at 2026-09-20 01:20 being read as live — is resolved by the runtime
itself (the gauge ticks again), but the frozen marker to watch for is the
**2026-09-20 01:20 local mtime** / `updatedAt: 2026-09-20T06:20:52.050Z`
content: only a restored pre-fork payload or backup produces that. Sweeping
the re-emitted files again is pointless while the app runs (the next tick
recreates them); stopping the re-emission requires removing/remapping the
`main.cjs` writers listed above, which is a code change outside this task's
scope. The per-project store (`data/projects/<projectId>/`) remains the
authority for project-scoped board data; these top-level writes are the
app-wide surface the fork left in place. The payload tombstone
(`_STALE_LEGACY.md`) carries the same correction.
