# The 0.5 shell prototype

`mefi-studio-0.5.html` is a snapshot of the clickable prototype of the 0.5 shell.
It is reference material: it is not part of the application, is not built into
`renderer/booklet.html`, and no check reads it. Open it in a browser.

- **What it is:** one self-contained page (no network, no storage) on sample data
  for a fictional Notes app: a rail, a session list, the session thread with its
  Note / Ask / Change composer, an inspector (Plan, Changes, Checks, Preview,
  Agent), a status bar, Today, Map, Team, Friends, Settings and Help. Its
  "Try it" buttons simulate events (an agent asks, a task finishes, checks fail,
  a permission is asked).
- **Where the source of truth is:** this file. The published copy is the
  claude.ai artifact `Dt7NLamh1gHEzEGWYr4dcR` (version `1790747158-aaa8`, the
  fourth revision). If the two ever differ, republish from here.
- **What it records, beyond the look:** the table "Where everything in today's
  menus went" (269 menu entries: 177 moved, 79 kept, 6 merged, 1 renamed, 4 waiting
  on a decision, 2 dropped on purpose) and the wiring table "How each screen
  connects to the engine" (waves A, B and C: ZA1-ZA9, ZB1-ZB8, ZC1-ZC7).
- **What it is not:** it is not the spec for scrollbars. It draws thin visible
  ones; the application hides all scrollbars by design (`renderer/studio-ui.css`)
  and shows an overlay thumb only while a pane overflows. It has no tabs, no
  resizable panels and no size and density settings yet; those are in
  `docs/plans/0.5.0-plan.md` and are added here (revision 5) before they are built.
- **Palette:** it uses the application's Aurora theme values, so the eleven themes
  and the custom palette apply to whatever is built from it.

The plan for building it into the application is `docs/plans/0.5.0-plan.md`.
