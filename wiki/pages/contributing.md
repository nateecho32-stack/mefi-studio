# Contributing

Mefi's Studio AI+ is a standalone Electron application. The repository's [CONTRIBUTING.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/CONTRIBUTING.md) is the authoritative version of this page, and [docs/code-map.md](https://github.com/nateecho32-stack/mefi-studio/blob/main/docs/code-map.md) says which file does what.

## Repository map

| Path | What lives there |
| --- | --- |
| `main.cjs` | The Electron main process: windows, tray, IPC handlers, the service loop host and dispatch. One file by design, with banner comments marking sections. |
| `preload.cjs` | The `window.mefiStudio` bridge. Every renderer call to the host goes through it. |
| `scripts/` | Host-side logic: the assistant and roles, the OpenCode store reader, machine capacity, policy, packaging, the check gates and the booklet build. |
| `renderer/` | The UI: `booklet.template.html` plus one script per surface and the stylesheets. `booklet.html` is generated from all of it and committed. |
| `tests/` | Node suites (`*.test.mjs`) and `tests/fixtures/` for Electron fixtures, fake bridges and replay data. |
| `tools/` | Python contracts, the Electron verifiers and profiling helpers. |
| `data/` | Only `curated.json` and `models.json` are tracked; everything else is local state. |
| `docs/` | Longer docs; `docs/archive/` for superseded ones; `docs/images/` for README screenshots. |

## Which file extension?

`package.json` sets `"type": "module"`, so the rule is by consumer:

- **`.cjs`** for anything `main.cjs` or `preload.cjs` requires, since Electron's main process is CommonJS.
- **`.mjs`** for anything imported by tests or other scripts, and every CLI script under `scripts/`.
- **`.js`** under `renderer/` only: classic scripts inlined into the booklet, sharing `window.Mefi*` namespaces, with no imports.

`npm run check` catches a misplaced file.

## Changing one control, end to end

1. Edit the markup in `renderer/booklet.template.html` and the behaviour in the matching `renderer/*.js`.
2. Run `npm run build-booklet` to regenerate `renderer/booklet.html`, and commit it with the source change; CI compares the two.
3. Run `npm run check`, then `npm run test:fast` while iterating, then the full `npm test` and `npm run audit` before the pull request.
4. See it with `npm start`, or `npm run start:web` for a browser preview with no host.
5. If the control is user-visible, update `docs/architecture.md` and add a line under *Unreleased* in `CHANGELOG.md`.

## The gates

```powershell
npm run check       # syntax, target coverage, spec collisions, CSS cascade gates
npm test            # Node suites + Electron fixtures + Python contracts
npm run audit       # renderer/template contracts

npm run test:fast   # while iterating: Node suites without the Electron fixtures
npm run lint        # eslint, check-only; undefined identifiers fail, unused ones warn
```

`npm test` needs Python 3 on PATH as `python` and a real desktop, because the Electron fixtures drive real windows. `npm run lint` fetches eslint through `npx`, so the app keeps zero runtime dependencies. `.editorconfig` sets two-space indentation, LF line endings and UTF-8.

Record test runs in `TESTRUNS.md` with `node scripts/append-testruns-row.mjs` rather than editing the file by hand: it takes a cross-process lock, keeps rows newest-first and rolls back if the gate audit fails.

## Two spec trees

| Tree | Runner | Discovery pattern |
| --- | --- | --- |
| `tests/**/*.test.mjs` | `node --test` | every `*.test.mjs` under `tests/` |
| `tools/` | `python -m unittest discover -s tools -p "test_mefi_studio_*.py"` | `tools/test_mefi_studio_*.py` only |

`npm run check:specs` enforces two rules:

1. **Spec basenames are unique across both trees**, in any case variation. Python's discovery imports by basename, so a duplicate silently shadows the first.
2. **Every `tools/test_*.py` is reachable by the discovery pattern.** A contract named outside `test_mefi_studio_*` ships with a discovery shim of that name that re-exports it.

## Working alongside other sessions

People and agents may work on the repository at the same time.

- Studio's dispatch holds a normalized-path write lock: one writer per path. The locks are cooperative and do not stop unrelated tools.
- Adopt the existing owner's work and integrate what is missing; never clobber a competing session's edits.
- After resolving a `renderer/styles.css` merge conflict, prove the result with `npm run check:css:merge`, which compares each side's cascade winners with the merge base.
- Workers must not rewrite Studio's own task store.

## Pull requests

- One change per pull request, described in the template: what it changes, how to see it, and the three gates ticked.
- Rebuild and commit `renderer/booklet.html` with any renderer change.
- Commit messages: a short imperative subject, and a body that says why when it is not obvious.
- Nothing from `data/`, no keys, and no screenshots with private paths. README screenshots come from seeded sample data, never from a real project.
- A maintainer runs the full gate on Windows before merging. A red Electron fixture is checked against the known-failure table at the top of `TESTRUNS.md` before it counts as a regression.

## Repository hygiene

- Local `data/` and the portable build's data are user state: never commit settings, keys, databases, screenshots or migration backups.
- Ruins Runner is an optional external project; never move its game files into the repository.
- Keep the package and app names, `mefi-studio` and "Mefi's Studio AI+", so existing Electron settings keep working.
