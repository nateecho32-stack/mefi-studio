# Contributing to Mefi's Studio AI+

This is a standalone Electron application. Application sources live at the
repository root (`main.cjs`, `preload.cjs`, `scripts/`, `renderer/`,
`assets/`, `tools/`, `tests/`); run all npm commands from this directory.

## Repository map

| Path | What lives there |
| --- | --- |
| `main.cjs` | The Electron main process: windows, tray, IPC handlers, the service loop host, dispatch. One file, by design; sections are marked with banner comments. |
| `preload.cjs` | The `window.mefiStudio` bridge. Every renderer call to the host goes through here. |
| `scripts/` | Host-side logic outside the main process: the assistant and agent roles (`assistant.mjs`), the OpenCode store reader (`eyes.mjs`), machine capacity, policy, packaging, the check gates and the booklet build. |
| `renderer/` | The UI. `booklet.template.html` plus one classic-script `.js` per surface (`workspace.js`, `idle.js` for Command view, `nav.js` for the destination registry, `tasks.js`, `onboarding.js`, ...) and the stylesheets. `booklet.html` is generated from all of it and committed. |
| `tests/` | Node suites (`*.test.mjs`) and `tests/fixtures/` (Electron fixtures, fake bridges, replay data). |
| `tools/` | Python contracts (`test_mefi_studio_*.py`), the Electron verifiers (`verify_*.py`) and profiling helpers. |
| `data/` | Only `curated.json` and `models.json` are tracked; everything else here is your local state. |
| `docs/` | Longer docs; `docs/archive/` for superseded ones; `docs/images/` for README screenshots. |
| `.github/` | CI (`ci.yml`), the release workflow, issue and PR templates. |

## `.cjs`, `.mjs` or `.js`?

`package.json` says `"type": "module"`, so the rule is by consumer:

- **`.cjs`** for anything `main.cjs` or `preload.cjs` `require()`s (Electron's
  main process is CommonJS). Examples: `scripts/projects.cjs`, `scripts/planning.cjs`.
- **`.mjs`** for anything imported by tests or other scripts, and for every
  CLI script under `scripts/`. Examples: `scripts/assistant.mjs`, `scripts/eyes.mjs`.
- **`.js`** under `renderer/` only: classic scripts inlined into the booklet,
  sharing `window.Mefi*` namespaces, no imports.

`scripts/check-syntax.mjs` compiles each kind the right way, and
`scripts/check-targets.mjs` fails if a new `scripts/*.mjs` or `renderer/*.js`
is not reachable by the check chain, so a misplaced file is caught at
`npm run check`.

## Changing one control, end to end

1. Edit the markup in `renderer/booklet.template.html` and the behaviour in
   the matching `renderer/*.js` (each surface owns its file; `nav.js` owns
   keys and destinations; `idle.js` owns the Command canvas and its rail).
2. `npm run build-booklet` to regenerate `renderer/booklet.html`. CI diffs the
   committed bundle, so commit it with the source change.
3. `npm run check`, then `npm run test:fast` while iterating (Node suites
   without the Electron fixtures, under a minute), then the full `npm test`
   and `npm run audit` before the pull request.
4. To see it: `npm start`, or `npm run start:web` for a browser preview of the
   renderer with no host.
5. If the control is user-visible, update `docs/architecture.md` and add a
   line under *Unreleased* in `CHANGELOG.md`.


## Checks

Every application change must pass the three gates:

```
npm run check     # syntax + target coverage + spec-collision audit
npm test          # node --test tests/**/*.test.mjs  +  python unittest discover
npm run audit     # scripts/auditor.mjs (renderer/template contracts)
```

While iterating:

```
npm run test:fast   # Node suites only, minus the nine that launch Electron
npm run lint        # eslint, check-only: undefined identifiers fail, unused ones warn
```

`npm test` needs Python 3 on PATH as `python` (the runner checks first and
says so) and a real desktop: the Electron fixtures drive real windows and are
timing-sensitive under load. `npm run lint` fetches eslint through `npx` so the
app keeps zero runtime dependencies; CI runs it too. `.editorconfig` sets
two-space indentation, LF line endings and UTF-8.

Two named sub-gates run inside `npm run check` and work standalone:

- `npm run check:targets` (`scripts/check-targets.mjs`) — catches stale
  checks: every node target referenced by a npm script must exist on disk,
  and every `scripts/*.mjs` + `renderer/*.js` source (plus the `main`
  entry) must be covered by the check chain. Guarded by
  `tests/check_targets.test.mjs`.
- `npm run check:specs` (`scripts/spec-collisions.mjs`) — duplicate spec
  names and unshimmed contracts; see "Test file conventions" below.

Record each test run in `TESTRUNS.md` by appending through
`node scripts/append-testruns-row.mjs` (row block as a quoted argument,
`--file <path|->` or stdin; `--dry-run` previews the landing spot) instead
of editing the file by hand: it holds a cross-process lock, inserts at the
true top of the live region (the dated rows above the `## Read Before Any
Tests` guide - the archive below that anchor is frozen), keeps rows
newest-first and rolls back if the post-write gate audit fails. Once the live
region passes 20 rows it rotates the oldest ones, whole and verbatim, into
`docs/archive/testruns-YYYY-MM.md` (newest first; preview with
`node scripts/rotate-testruns.mjs --dry-run`), so never trim rows by hand.
A heading that already rotated out is refused as a duplicate, exactly like
one still in `TESTRUNS.md`: give a follow-up row its own heading.

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
gated in CI by `.github/workflows/ci.yml` (audit + guard tests +
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

## Pull requests

- One change per pull request, described in the template: what it changes,
  how to see it, and the three gates ticked.
- Rebuild and commit `renderer/booklet.html` with any renderer change.
- Commit messages: a short imperative subject and, when the why is not
  obvious, a body that says it.
- Nothing from `data/`, no keys, no screenshots with private paths.
- Expect a maintainer to run the full gate on Windows before merging; a red
  Electron fixture is checked against the known-failure table at the top of
  `TESTRUNS.md` before it counts as a regression.

## Tools you may not know about

| Command | What it does |
| --- | --- |
| `node tools/profile_studio.mjs --help` | Reproducible renderer workloads for profiling (see `docs/performance.md`). |
| `python tools/verify_workspace.py --output tools/logs/workspace-ui` | Drives the real Electron workspace through the walkthrough and screenshots each step. `verify_command.py`, `verify_planning.py` and `verify_model_lab.py` do the same for their surfaces. |
| `python tools/benchmark_startup.py` | Startup timing. |
| `npm run capture` | Screenshot tour of the tabs into `tools/logs/mefi_studio_captures/` (uses your live data; README images come from seeded previews instead). |
| `node scripts/reconcile-board.mjs` | Offline backlog repair; `reconcile-store-fork.mjs --dry-run` previews a sync with the portable build's store. |
| `npm run policy-lab` | Replays recorded dispatch episodes under `data/policy-lab/` against candidate policies. |
| `npm run check:css -- a.css b.css` | Proves two stylesheets keep the same cascade winners. |

## Documentation

- `README.md` is the front door; keep it short and put detail in `docs/`.
- `docs/architecture.md` holds the feature walkthrough and glossary; update it
  when a screen or control is renamed.
- Dated audits, handoffs and one-off logs go to `docs/archive/` with a
  "Historical record" banner instead of staying at the root.
- README screenshots live in `docs/images/` (1440 px wide, 256-colour PNG);
  capture them from seeded sample data, never from a real project.
- `CHANGELOG.md` follows Keep a Changelog; add a line under *Unreleased* with
  user-visible changes.

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
