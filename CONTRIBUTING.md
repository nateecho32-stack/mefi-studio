# Contributing to Mefi's Studio AI+

This is a standalone Electron application. Application sources live at the
repository root (`main.cjs`, `preload.cjs`, `scripts/`, `renderer/`,
`assets/`, `tools/`, `tests/`); run all npm commands from this directory.

## Checks

Every application change must pass the three gates:

```
npm run check     # syntax + target coverage + spec-collision audit
npm test          # node --test tests/**/*.test.mjs  +  python unittest discover
npm run audit     # scripts/auditor.mjs (renderer/template contracts)
```

Two named sub-gates run inside `npm run check` and work standalone:

- `npm run check:targets` (`scripts/check-targets.mjs`) — catches stale
  checks: every node target referenced by a npm script must exist on disk,
  and every `scripts/*.mjs` + `renderer/*.js` source (plus the `main`
  entry) must be covered by the check chain. Guarded by
  `tests/check_targets.test.mjs`.
- `npm run check:specs` (`scripts/spec-collisions.mjs`) — duplicate spec
  names and unshimmed contracts; see "Test file conventions" below.

Rebuild the model booklet after editing renderer sources
(`npm run build-booklet`; the generated `renderer/booklet.html` is committed).

## Test file conventions

Two spec trees, two runners, one naming rule per tree:

| Tree | Runner | Discovery pattern |
| --- | --- | --- |
| `tests/**/*.test.mjs` | `node --test` | every `*.test.mjs` under `tests/` |
| `tools/` | `python -m unittest discover -s tools -p "test_mefi_studio_*.py"` | `tools/test_mefi_studio_*.py` only |

The rules below are enforced by `npm run check:specs`
(`scripts/spec-collisions.mjs`), which runs as part of `npm run check`,
guarded by synthetic-fixture tests in `tests/spec_collisions.test.mjs`, and
gated in CI by `.github/workflows/spec-collisions.yml` (audit + guard tests +
full check on every push and pull request).

### 1. Spec basenames are unique across `tools/` and `tests/`

Two spec files may never share a basename, in any case variation, even in
different directories. Python's unittest discovery imports by basename, so a
second `test_mefi_studio_eyes.py` anywhere under `tools/` silently shadows the
first — this caused three separate session collisions before the rule was
codified. Keep migration copies and snapshots out of the spec trees (the
git-ignored `.local-migration/` folder must never host a `test_*.py` that the
live tree also has).

### 2. Every `tools/test_*.py` must be reachable by the discovery pattern

A contract spec whose overseer directive names it outside the
`test_mefi_studio_*` pattern (for example `tools/test_claim_registry.py`) is
**not run by `npm test`** on its own. It must ship with a discovery shim named
`tools/test_mefi_studio_<stem>.py` that re-exports it:

```python
"""npm-test discovery shim: the claim-registry contracts live in
tools/test_claim_registry.py; this module re-exports them so the dev set
runs them too."""
from test_claim_registry import *  # noqa: F401,F403

if __name__ == "__main__":
    import unittest

    unittest.main()
```

`check:specs` flags an unshimmed contract as an orphan instead of letting it
silently drop out of the test run. Document any new shim in `TESTRUNS.md`.

### 3. Editing conventions under parallel sessions

Workers may run in parallel against this repository. Before editing:

- Studio holds a normalized-path write-lock registry
  (`scripts/assistant.mjs`: `writeClaimKey`, `claimWrite`, `releaseWrite`,
  `heldWritePaths`, consulted by `claimWork`). One writer per path: a second
  dispatch on the same file is refused or deferred until the first releases.
  Dispatch resolves relative paths against the selected project's root before
  registering them. Separators and case are normalized, so spellings of the
  same path are one claim. These are cooperative dispatch locks; they do not
  prevent unrelated tools from editing files outside Studio.
- Adopt the existing owner's work and integrate missing pieces; never clobber
  a competing session's edits. A collision notice assigns ownership by edit
  history — rebase onto that work instead of pushing rival edits.
- After resolving any `renderer/styles.css` merge conflict (two sessions
  restyled it in parallel), verify the resolution against **both sides and
  the merge base** with `npm run check:css:merge`
  (`scripts/check-css.mjs --merge`): it diffs each side's cascade winners
  against the merge base and fails when the resolved file drops a winner one
  side changed, resurrects a winner a side deleted, or settles a both-sides
  change on neither side's value. The gate runs as part of `npm run check`
  and is a no-op (exit 0, `MERGE-CSS-SKIP`) when no merge is in progress;
  pass `--theirs <ref>` to audit any branch pair without a live merge.
  Guarded by `tests/check_css_merge.test.mjs`.
- Workers must not rewrite Studio's own task store (`data/` in the app, and
  the portable build's separate `dist/` data). Task-history edits belong to
  Studio's own code paths.
- Contracts for these behaviors live in `tools/test_claim_registry.py`,
  `tools/test_assistant_write_lock.py`,
  `tools/test_mefi_studio_normalized_path_lock.py`, and
  `tools/test_normalized_path_lock.mjs` (run directly with `node`).

## Repository hygiene

- Local `data/` and the portable build's `dist/` data are user state: never
  publish or commit user settings, API keys, databases, screenshots, or
  migration backups. Only `data/curated.json` and `data/models.json` belong
  in Git.
- Ruins Runner is an optional external project: never move its game files
  into this repository (`MEFI_STUDIO_GAME_ROOT` selects the game checkout,
  `MEFI_STUDIO_REPO` another working repository).
- Preserve the package/app names (`mefi-studio`, "Mefi's Studio AI+") so
  existing Electron settings keep working.
