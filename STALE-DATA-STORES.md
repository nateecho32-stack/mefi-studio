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

All operational reads/writes are remapped to the per-project store
`data/projects/<projectId>/` by `projects.dataPath()` (`scripts/projects.cjs`)
via the scoped eyes facade in `main.cjs`. Only `curated.json` and
`models.json` remain app-wide at the top level.

## Why the sweep is permanent

`scripts/package-portable.mjs` ships only the CATALOG set
(`curated.json`, `models.json`) into a payload, so rebuilding the portable app
cannot re-create the five swept files.
