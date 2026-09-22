# Mefi's Studio AI+

This is the standalone Electron application repository. Read `README.md` for
the overview, `docs/architecture.md` for the feature walkthrough and glossary,
`docs/code-map.md` for which file does what, `CONTRIBUTING.md` for the gates,
and `TESTRUNS.md` before running tests.
Longer-form docs live under `docs/`; superseded ones under `docs/archive/`.

- Application sources live at the root: `main.cjs`, `preload.cjs`, `scripts/`,
  `renderer/`, `assets/`. Run npm commands from this directory.
- Run `npm run check`, `npm test`, and `npm run audit` for application changes.
  Run `npm run build-booklet` after editing renderer sources; the generated
  `renderer/booklet.html` is committed.
- Ruins Runner is an optional external project. Never move its game files into
  this repository. Use `MEFI_STUDIO_GAME_ROOT` for game integration and
  `MEFI_STUDIO_REPO` to select another working repository.
- Preserve local `data/` and the portable application's separate `dist/` data.
  Only `data/curated.json` and `data/models.json` belong in Git. Do not publish
  user state, settings, API keys, databases, screenshots, or migration backups.
- Preserve the package/app names so existing Electron settings remain usable.
- Game tests must run through the game repository's documented pipeline.
