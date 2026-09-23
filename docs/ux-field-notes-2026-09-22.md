# Hands-on UI notes — September 22, 2026

These notes come from using the running Windows app with an active project.
Task names, project paths and other local work are omitted.

| Where I got confused | What I found | Change |
| --- | --- | --- |
| The Task board filters showed many more items than the “plans & tasks” heading. | Filters count saved task records; the overview folds related tasks and plans into cards. | The overview now says “cards in this view” and names the filter's unit. |
| Home opened on older conversation messages while current activity was visible elsewhere. | The conversation could render before Home became visible, when its scroll area had no usable height. A later identical refresh skipped scrolling. | The first visible view of each project's conversation starts at its newest message. Later updates preserve a reader's manual scroll position. |
| A Home navigation click from Command view initially looked unchanged. | The destination appeared on the next observation after a delayed redraw. The navigation completed. | No navigation change; keep this as a responsiveness observation if it recurs on a quiet machine. |

The first two findings have renderer changes, focused unit checks and a
disposable Electron startup check with a synthetic overflowing conversation.
The navigation delay happened while multiple coding jobs were active, so it
is not yet evidence of a route failure.

## Follow-up menu review

Code inspection found a separate Projects menu interaction issue: a mouse
press on M+ closed an open panel through the outside-press listener, then the
M+ click reopened it. The rail door now waits for its click to toggle the panel,
including when the pointer pauses over M+ or a held press moves focus out of
the panel. Keyboard focus leaving both surfaces still closes the panel. This
was checked with event-order unit coverage and a disposable Electron click
sequence; the running portable app was unavailable for a second hands-on pass.
