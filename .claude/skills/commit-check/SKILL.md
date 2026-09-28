---
name: commit-check
description: Use before every commit or landing in the Mefi Studio repository (Claude Code, Codex, OpenCode and Studio's own builders). A short checklist the owner set on 2026-09-28 - look at recent commits first, send only what is new, keep recent work in reach and older work on request, keep the app fast and stable, log properly, lose nothing, then pass the gates and land.
---

# Commit check

Work through this before you commit or land. Each rule says how to check it.
When a rule does not apply to your change, skip it; when it does and you
cannot meet it, say so in your report instead of committing around it.

## 1. Look before you land

- `git fetch`, then `git log origin/main -20 -- <the paths you changed>`.
  If someone already did this work, or is doing it, adopt theirs instead of
  landing a second copy.
- `git status` in the checkout you are about to land from. Other sessions
  work in the same repository (AGENTS.md "Working across PCs"): never
  stash, reset or switch branches over someone else's files, and commit
  only your own paths.
- Studio's cowork claims and "Keep this PC up to date" show what other PCs
  are editing; a file another PC holds waits.

## 2. Send only what is new

- A changed row travels as a row delta, never as the whole list or state
  (`scripts/row-push.cjs`, `scripts/assistant-push.cjs`: rev plus changed
  keys, a resync when the page lacks the base).
- A resumed agent gets what changed since its last run (new decisions,
  changed sections, new commits touching its files), not the whole brief
  again.
- Check: a push or prompt you touched stays small when one row changes;
  the test says so.

## 3. Recent first, older on request

- Lists, histories, logs and prompts carry a recent window.
- Older entries stay reachable through the pager, the `studio_history`
  tool or the archives, behind the scope setting (off / task / project).
- Never drop data silently: trimming only removes what the journal or
  archive already holds.

## 4. Keep it fast

- No new synchronous I/O or eager `require` on startup or on a hot path
  (board writes, pushes, worker output, frames).
- No repaint per line or per frame; nothing runs for a surface nobody can
  see (hidden sheets, a covered window).
- Measure hot paths before and after with the recipes in
  `docs/performance.md`, and put the numbers in the commit message or the
  TESTRUNS row. Measure before patching: audits overstate costs.

## 5. Log it properly

- Structured lines: level, channel, run and task ids where they exist.
- No secrets, keys, tokens or personal paths in logs.
- Every sink is bounded; old logs are archived, never deleted.

## 6. Keep it stable

- Writes are atomic (temp file plus rename), and a failure in a new side
  path (journal, log, friends) never fails a board write, a dispatch or a
  run.
- `main.cjs` gets small `typeof`-guarded, try/catch-wrapped hooks inside
  marked blocks; many vm suites slice `main.cjs` by marker comments, so
  keep function names and markers.
- Never edit pushed payloads in the renderer; they are shared by every
  listener. Never edit a task's `contextHistory` in place.
- After a format change, old files still read.
- Every new behaviour has a kill switch and a test that pins it.

## 7. Lose nothing, add no friction

- Every destination, setting, shortcut and deep link that existed is still
  reachable (the route pins and the reachability test pass). Old deep links
  redirect.
- A migration keeps a backup and the old reader.
- One home per control; anywhere else it appears as a chip that opens that
  home, not a second copy. No new navigation system.
- CHANGELOG says, in plain words, what moved or changed for the user.

## 8. Gates and landing

Follow CONTRIBUTING.md and AGENTS.md; in short:

- Renderer edits: `npm run build-booklet`, and commit the rebuilt
  `renderer/booklet.html` (rebuild it, never hand-merge it).
- `npm run check`, `npm run lint` (no new warnings), `npm run audit`, and
  `npm test` (or `npm run test:fast` plus the Electron fixture you touched
  while iterating). Check a red Electron fixture against clean main before
  blaming your change; `TESTRUNS.md` lists the known flakes.
- A CHANGELOG line under Unreleased for anything a user notices, and a
  TESTRUNS row through `node scripts/append-testruns-row.mjs`.
- Commit with explicit paths and the attribution line your harness gives.
- Land with `git merge --ff-only` (or `git push origin HEAD:main` from a
  gated worktree when the shared checkout is dirty), then `npm run sync`.
  Never force-push `main`, never skip the check to get a push through.
- Unfinished work goes to a pushed `wip/<topic>` branch whose commit
  message says what is missing.

## 9. Report

Say what changed, what you measured, what you checked (commands and
results), and what is still open.
