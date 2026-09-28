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
