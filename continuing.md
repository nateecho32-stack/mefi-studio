# Continuing: Vibe by default, answers in Vibe, a new project's tree, key tips (2026-09-28)

Owner's ask: Vibe open by default; everything to see or answer doable from
Vibe; a new project's tree visible before anything starts; first-run pop-up
key tips (click to fade, can be turned off) with keycaps.

**Built and fully gated, not on main yet.** One commit on branch
`wip/vibe-home-key-tips` ("Open in Vibe, answer more from Vibe, a new
project's tree, key tips"), worktree `C:\wt\vibe-tips`. `npm run check`,
`npm run audit` and `npm test` all pass on 39a153d plus this commit, and the
TESTRUNS row is in the commit.

## What is left

1. **Land it.** Main has moved past 39a153d (16544dd Plans face lift,
   6a94370 startup paint fix, 5732ceb Discord DM remote). Those commits only
   share `CHANGELOG.md`, `TESTRUNS.md`, `docs/archive/testruns-2026-09.md`,
   `docs/code-map.md` and the generated `renderer/booklet.html` with this one.
   In the worktree: `git rebase origin/main`, keep both sides' changelog
   entries, re-add the TESTRUNS row with `scripts/append-testruns-row.mjs`
   if it conflicts, `node scripts/build-booklet.mjs`, then `npm run check`
   and the focused suites (vibe_home, key_tips, vibe_panels, vibe_pipeline,
   vibe_flow, vibe_frame, onboarding, nav_startup, booklet_build,
   type_into_menu). Push with `git push origin HEAD:main` (fast-forward only),
   then run `npm run sync` in the shared checkout. Remove the worktree after:
   rmdir the `node_modules` junction first, then `git worktree remove`.
   16544dd rewrote the Plans page. Check that a plan's interview follow-up
   still has the note shape `planNeed()` in `renderer/vibe.js` reads (the
   last note has author "assistant" and kind "question" or "conflict"), and
   that `planningAssist` still takes `kind: "interview"`.
2. **Owner review on screen.** The changes to review:
   - Every launch now resets a saved Build mode to Vibe. Settings › Always
     start in Vibe turns that off.
   - The tip placement: the box and dock tips sit to the right of their
     controls, and flip left when there is no room.
   - The dock keycaps: `⌃K` on More.
   Before/after captures come from
   `scratchpad vp/make_preview.cjs ?state=fresh|busy&needs=1&tips=on&mode=build`.
   The recipe is in memory note vibe-home-and-key-tips.
3. **Open follow-ups, not started:**
   - A new project's root node still reads "Sessions · 0 sessions". It could
     name the project. Vibe's backdrop tree is barely visible on an empty
     project.
   - In Build mode only the rail tip showed in the capture. The
     `build-search` tip found no visible palette control. Point it at the
     Home sidebar's Search row.
   - A result the checker is still verifying, and younger than the
     companion's REVIEW_AFTER_MS, still reads "checking its work" with
     nothing to press. It becomes a Needs you review only after that age.
   - Build Home's "Work through backlog" and batch run are still not
     reachable from Vibe.
   - Plan questions nobody has started exploring stay off Needs you on
     purpose (noise). Revisit only if the owner asks.

## What changed (for whoever lands or reviews it)

- `renderer/vibe.js`:
  - The launch reset (`mefiStudio.uiMode.launch`, resume-aware).
  - Needs you gains `review` and `plan` kinds, plus Build it anyway for
    relevance holds.
  - Watch always shows in the dock.
  - `#vibe-update` mirrors the rail's update pill.
  - Vibe's single keys `/ N C T P I M S`. They stand down under sheets and
    inside an open drawer, where nav.js typeInto owns the letters.
- `renderer/key-tips.js` is new (`MefiKeyTips`): tips, keycaps, the off
  switch and Show key tips again. Its CSS is in `studio-ui.css`.
- `renderer/onboarding.js`: the walk no longer switches to Build.
- `renderer/idle.js`: the "fresh" variant of `#cmd-empty`.
- Template:
  - Settings switches `#settings-start-vibe` and `#settings-key-tips`.
  - Keycaps on the Vibe dock and box.
  - `#cmd-empty-start`.
- Tests: `tests/vibe_home.test.mjs`, `tests/key_tips.test.mjs`. The
  onboarding and vibe_panels expectations were updated.

Delete this section once it is on main and the owner has reviewed it.

# Continuing: menu polish pass (status, 2026-09-28)

The menu polish pass is on main. It was finished by the "Continuing fixes"
session: six commits from "One two-step confirm and one plain error sentence
for every menu" to "Rooms: plain connection errors, two-step Close, Leave and
Delete". That covers Batches 1, 2, 4 and 5, the Projects-menu focus port from
`refs/backup/ux-clarity`, and the Rooms items. The worktree
`C:\wt\menu-polish` is gone.

## Left for the owner: Batch 3, one page frame

The tab pages (Performance, Usage, Context, Model catalog, Settings,
Activity) sit in a centred column at most 1,560 px wide, with the 84 px tree
strip (`#tree-rail`) at the right edge. The sheets use a full-width 64 px
header band. The plan was to:
- hide `#tree-rail` outside Command and drop its padding (`styles.css`
  `--rail-gap`, section 10);
- give the tab pages and Agent brain the sheets' header band and content edge;
- keep one Settings category nav (Appearance swaps to pills today).

It was not done, because the first step contradicts a pinned contract:
`tests/fixtures/command-render-electron.cjs` asserts "visible rail resumes
painting" on the Model catalog page. Decide whether the tree strip should
stay on tab pages. If it goes, change that assertion with it. Either way,
capture before and after (the seeded fake-bridge preview at 1920x1080), and
leave `styles.css` ~4833 (the `data-nav-section` padding) and the
`studio-ui.css` `@media (max-height: 600px)` rail block alone.

Delete this file once that is decided.
