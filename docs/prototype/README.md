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
  `docs/plans/0.5.0-plan.md` and are drawn in revision 5 (below) before they are built.
- **Palette:** it uses the application's Aurora theme values, so every theme (twelve with Chrome)
  and the custom palette apply to whatever is built from it.

The plan for building it into the application is `docs/plans/0.5.0-plan.md`.

## Revision 5

`mefi-studio-0.5-v5.html` is revision 5, made from a copy of the fourth revision
after the owner's review; `mefi-studio-0.5.html` stays as it was. Everything in
the fourth revision still works (tours, simulated events, both tables, search,
settings, themes). Revision 5 adds Vibe and Build as two modes of one shell
(Ctrl M, each with its own layout), which settles the four entries that waited
on that decision: the table now reads 181 moved, 79 kept, 6 merged, 1 renamed
and 2 dropped on purpose. It also adds tabs you add and pin that Studio keeps
tidy (a preview tab, a choice of what an agent's question does, idle closing, a
cap with Undo, Recently closed), panels with draggable edges, Settings ›
Appearance › Size and density with a live miniature of the window, a Worktrees
page, image, before and after, video and device previews, and a docked video
card that stays across pages. Like the application it shows no scrollbars, only
a 3 px overlay line while a pane is pointed at or scrolled, and it works down to
a 600 by 560 window. Its published copy is a separate claude.ai artifact titled
"Mefi Studio 0.5 rev 5", made by dropping the doctype, `html`, `head` and `body`
wrapper lines, which the artifact page adds itself; the fourth revision's
artifact is unchanged.
