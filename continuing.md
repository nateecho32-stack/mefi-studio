# Continuing: menu polish pass (handoff, 2026-09-28)

This file is a handoff note. Do not commit it.

The owner approved **everything** in the plan `C:\Users\echor\.claude\plans\foamy-foraging-dewdrop.md`. Read that plan first: it lists batches 1–5 with file:line evidence.

All the work is uncommitted in the worktree **`C:\wt\menu-polish`**. It is detached at 74e5a70 (origin/main at the start), and `node_modules` is a junction to the main checkout. Never switch branches in the OneDrive checkout: peers share it.

## Done so far (uncommitted, tested)

**Shared helpers** in `renderer/studio-ui.js`, exposed as `window.MefiUi = { arm, plainError }`:
- `arm(button, { run, armed, ms })` is a two-step confirm.
- `plainError(error, fallback)` turns an error into a sentence.
- Every caller falls back safely when the helpers are missing, which is the case in the vm test suites.

**My edits:**
- **vibe-panels.js**
  - "N need you" now counts the Needs you list. The test in `tests/vibe_panels.test.mjs` is updated.
  - Every row has a data-key.
  - Stop and Drop it ask twice.
- **project-map-view.js**
  - The empty-map copy now reads "Nothing mapped here yet."
  - The minimap is hidden while the map is empty.
- **agent-brain.js**
  - The empty "Places to explore" section is skipped.
  - Recipe Delete uses arm().
- **styles.css**: `.agent-brain-sheet` added to the sheet presence selectors.
- **agents.js**
  - "Preset deleted." replaces "Preset saved." after a delete.
  - Delete preset and Discard draft ask twice.
  - Errors go through plainError.
- **trace.js / trace.css**
  - Chips update in place: no "All undefined", and focus is kept.
  - Focus is kept on the channel list.
  - The log pane shows an empty-state line.
  - Errors go through plainError.
- **model-lab.js + booklet.template.html** (`#model-lab-lede`)
  - Each view has its own subtitle.
  - The Context status leaves out unknown parts.
  - The Recorded calls fallback is fixed.
  - "Not reported" replaces the Unknown/Unknown token cells.
  - Errors go through plainError.
- **autonomy-ui.js + studio-ui.css**
  - The autonomy block uses theme tokens.
  - Repaints keep focus and an open menu.
  - "Forget all" asks twice.
  - Ids show as words.
  - The dialog has an SVG close.
- **setup-helper.js**
  - Errors go through plainError.
  - Remove key and Delete team ask twice.
- **config-dialog.js**: Tab stays trapped inside the dialog.
- **Dark literals replaced with tokens**: styles.css (sheet-links, rank, meter, feed, log/diff text, segmented, tier-row, auto-order, lab-note, lab-empty box), vibe.css shadows, brains.css scrims.

**Agent A (finished; suites pass, `npm run check` clean):**
- explorer.js, eyes.js, overhead.js, analyzer.js, tracker.js, ideas.js, tasks.js, planning.js, the catalog part of booklet.js, graph.js, profiler.js, and one idle.js line. It also added one `#chips .chip` line to styles.css.
- It updated two test pins: `overhead_poll_backoff`, `ideas_ui`.

**Agent B (companion / Your PCs / Listen together / music) finished. Its suites and `npm run check` pass, including the Electron suites companion_hub_render, media_window_render and media_browser_render.**
- **Files:** companion-hub.js/.css, companion-ui.js/.css, companion-friends.js, together.js, pc-sync.js, pc-vault.js, music.js/.css and media-window.js (only the × glyph there).
- **What it did:**
  - The hub and the companion panel open and close with presence and motion tokens.
  - Hub sections switch through `MefiMotion.swap`. The peer's `dispose` line is already in `select()`.
  - Close buttons use the `#g-close` glyph.
  - Listen together's Stop asks twice ("Stop for everyone?"), and its share checkbox is a `role="switch"`.
  - Your PCs asks twice before "Remove the keys?" and "Remove it?", and fixes plurals and the keys-warning wording.
  - The music queue uses `MefiMotion.keep`, and the dropdown fades out on close.
- **Test pins updated or added:** `tests/pc_vault_ui.test.mjs`, `tests/together_ui.test.mjs`, `tests/fixtures/companion-hub-render-electron.cjs`.
- **Skipped on purpose:**
  - **Unpair is not armed:** `main.cjs` already asks in a native dialog. It got the `danger` class instead.
  - **The ✓/• checklist is unchanged:** a test pins it.
- **Leftover:** `rooms.js` and `community.js` still say "Settings › Community › Connection details". Change them to "Settings › General › Community › Connection details" when you do the Rooms items; `rooms_ui.test.mjs` pins the old text.

## Broken right now: fix this first

I ported the Projects-menu focus fix from `refs/backup/ux-clarity` with `git apply --3way`. It left **unmerged conflicts**:
- `docs/architecture.md`
- `tests/fixtures/startup-render-electron.cjs`
- `tests/startup_render.test.mjs`

`tests/sidebar.test.mjs` applied cleanly and is staged.

To finish:
- Resolve by keeping ours and adding only the ux-clarity lines:
  - the `focusedProject` field in the fixture report and in its assert;
  - the one architecture.md sentence "Keyboard focus starts on the selected project, or Add project when none is available."
- Then run `git add` on them. Check with `git diff 0a901eb refs/backup/ux-clarity -- <file>`.
- **Still to do for this port**:
  - `renderer/sidebar.js` `open({ focus = false, by = "sticky" })`: add `projectFocus = false`. Focus the `aria-pressed="true"` button in `#workspace-projects`, then `#workspace-add-project`, then the first usable control. Without preventScroll only when a project target is used. The code is in that ref's diff.
  - `renderer/nav.js` ~1711: `sidebar.open({ focus: true, projectFocus: true })`.
  - A CHANGELOG line.

## Still to do (from the plan)

1. **Batch 3, page frame.** Confirmed ours by "Menu and navigation overhaul". Do not touch `styles.css` ~4833 (the `data-nav-section` padding) or the studio-ui.css `@media (max-height: 600px)` rail block.
   - Hide `#tree-rail` outside Command, and drop the 84px padding (styles.css ~1348-1358, 1414).
   - Give the tab pages (Performance, Usage, Context, Catalog, Settings, Activity) the sheets' 64px header band and content edge.
   - Give Agent brain the same band.
   - Keep one Settings category nav: Appearance swaps to pills today.
2. **Rooms** (rooms.js): wait for "Plan improvements and fixes" to land its rooms.js rewrite; it will message. Then add:
   - *2026-09-28 update:* the rewrite is on main ("Rooms: show the right room's chat, keep what you type, share rooms fairly"). Rebase onto main, then go ahead. Line numbers moved: find the error sentences by `REASONS` and the actions by their button labels.
   - REASONS entries for auth, version and unsupported;
   - plainError at ~89 and ~397;
   - arm() on Close room, Leave room and message Delete.
3. **companion-hub.js select()** must keep the peer's line `for (const child of [...el.extra.children]) child.dispose?.();` just before the children are replaced (as landed on main, with the spread copy).
4. **Gates**, in the worktree:
   - `npm run build-booklet`, `npm run check`, `npm test`, `npm run audit`.
   - Known flakes: command_render and media_window_render. Control them against clean main.
   - Line endings: renderer files are CRLF. Use Edit or Python byte-level edits, not `sed -i`.
5. **Visual check.** Scratchpad capture recipe: `C:\Users\echor\AppData\Local\Temp\claude\C--Users-echor-OneDrive-Desktop-Coding-Projects-Mefi-s-Studio-AI-\0dbfd214-44e8-4c43-979b-db60912719d4\scratchpad\shots\`.
   - Point `make_preview.cjs` at the worktree's built booklet, then run `capture.cjs` with electron.exe through Start-Process. It shoots 48 menus at 1920x1080 into `out/`.
6. **Commit and land.**
   - Commit per area, with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - Fetch, then rebase onto origin/main. Multi-login landed 07150aa and 732026f; they touch setup-helper.js hunks near ~197, ~391, ~402 and ~1110, and that login Remove button already calls `MefiUi.arm`.
   - Land with `git merge --ff-only` in the main checkout, then `npm run sync`.
   - Add a TESTRUNS row with `node scripts/append-testruns-row.mjs`, and CHANGELOG lines.
   - After landing, message "Multiple subscriptions per provider" and "Plan improvements and fixes" that `MefiUi.arm` and `plainError` are on main.
