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
- Before every commit, work through `.claude/skills/commit-check/SKILL.md`:
  look at recent commits first, send only what is new, keep older work
  reachable on request, stay fast and stable, log properly and lose nothing.
- Ruins Runner is an optional external project. Never move its game files into
  this repository. Use `MEFI_STUDIO_GAME_ROOT` for game integration and
  `MEFI_STUDIO_REPO` to select another working repository.
- Preserve local `data/` and the portable application's separate `dist/` data.
  Only `data/curated.json` and `data/models.json` belong in Git. Do not publish
  user state, settings, API keys, databases, screenshots, or migration backups.
- Preserve the package/app names so existing Electron settings remain usable.
- Game tests must run through the game repository's documented pipeline.

## Working across PCs

The owner works on this repository from three PCs. GitHub `main` is the only
state they share. Local branches, worktrees, stashes, uncommitted files,
Claude Code sessions and Claude's memory stay on the PC that made them.

- A new Claude Code session runs `node scripts/sync.mjs --hook` (the
  SessionStart hook in `.claude/settings.json`). It fetches, fast-forwards
  `main` when it can, and reports what is not on GitHub `main` yet. Act on
  that report before starting new work.
- Land finished work on `main`, then run `npm run sync`. It fetches,
  fast-forwards, runs `npm run check` and pushes `main` only when that passes,
  and lists what is left. When `main` has diverged and nothing is uncommitted,
  `npm run sync -- --rebase` puts this PC's commits on top of GitHub's first
  and stops without changes on a conflict. Never force-push `main`, never
  skip the check to get a push through, and never leave finished work only
  on one PC.
- Resolve merge conflicts file by file. Never keep one side of a conflicted
  file whole (`git checkout --ours`/`--theirs`) or put the tree back to one
  parent: on 2026-09-27 a merge and a "fixes" commit did that and twelve
  commits of work left `main` without a conflict marker or a failing test.
  Regenerate `renderer/booklet.html` and rotate TESTRUNS rows instead of
  choosing a side. `npm run sync` refuses to push a merge that leaves out 200
  or more lines of another branch's changes, and the session hook lists recent
  ones. If a choice is deliberate, say so in history with a `Lost-work-ok: <why>`
  line in the merge's message (or any later commit's); `--allow-lost-work` only
  overrides one push.
- Park unfinished work that another PC may need on a pushed `wip/<topic>`
  branch. Its commit message should say what is missing and which tests fail.
- Other sessions may be working in the same checkout. Check `git status` and
  the running sessions before switching branches, stashing or resetting.
  Isolated work belongs in a separate worktree or clone.
- Studio shows the same report under Friends › Your PCs
  (`renderer/pc-sync.js`, main's `sync:*` channels), badges the Friends
  bubble from a background look, and asks before closing when the open
  project has work on this PC alone.

## Cloud sessions

A Claude Code session on claude.ai runs in a container, not on one of the PCs.
It sees only what GitHub has, so a worktree or branch that was never pushed is
invisible to it, and anything that exists only in the container is lost when it
is reclaimed: push it to a `wip/<topic>` branch.

- The clone is shallow. The session hook deepens it when local `main` cannot be
  compared with GitHub's, and says "not compared" rather than counting commits
  when it still cannot. Branches built on `gh-pages` are the public site's work:
  the report lists them as site branches, and they never merge into `main`.
- The repo needs Node 24 (`package.json` engines, enforced by `.npmrc`). Under
  Node 22, `tests/git_actions.test.mjs` cancels 61 tests that pass on 24.
- Push a working branch first and let `ci.yml` (Windows, the full gate) run,
  then fast-forward `main` with `git push origin HEAD:main`. Run `git fetch`
  again just before that push: `main` moves constantly. Never force-push, and
  never push a `v*` tag from a session: a tag starts `release.yml`, which builds
  and publishes the executable.
