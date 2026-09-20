# Studio feature audit — September 19, 2026

This checks the capabilities described in the supplied screenshots and the
Studio requirements in this conversation. It distinguishes implemented paths
from broader promises. Passing the test suite does not prove every provider,
external application, or arbitrary task will succeed.

| Claim or requirement | Current state | Evidence and limits |
|---|---|---|
| One manager coordinates specialized agents | Implemented | The assistant roster, foreman, role queue, worker pool and per-role reports are in `main.cjs` and `scripts/assistant.mjs`. Replies have a bounded lane separate from background work so they can request child work without deadlocking a one-slot pool. |
| Several workers handle the backlog | Implemented | The configured coding-worker pool uses readiness, dependency, retry and file-claim checks. An available slot does not guarantee another task is eligible. |
| Agents can see other work and avoid collisions | Partial | Workers receive peer context; known file claims and live-editor observations block conflicts. The scheduler is cooperative, not a filesystem sandbox: unannounced files and unrelated external agents can still conflict. |
| Tasks remain visible through verification and Done | Implemented | Durable attempts, results, handoffs, history and archived completions remain available. Historic successful exits without verification evidence are not invented as Done records. |
| Work is independently verified | Partial | Claimed checks now require recorded successful execution in the exact attempt's session and time window. Failed or pending checks block completion; unavailable evidence waits without spending a retry. Edit-only work may pass on attributable completed edits. This still does not independently execute or certify every acceptance criterion. A successful worker exit alone is insufficient. |
| Durable subagent handoffs | Implemented with limits | New handoffs preserve exact child identity and full scope, recover interrupted admission, become durable task cards and hold parents until children finish. Exhausted children hold parents for review while independent work continues. Only proven matching obligations are discharged; legacy free-form remaining text cannot always be matched. |
| One agent manages system resources | Partial | The machine role observes leases and selected test processes and can clean up configured stray test runs. It is not a general adaptive CPU/RAM scheduler for every application. |
| One agent takes timestamped photos of recent work | Not fully implemented | The explicit capture tour creates Studio screenshots, and A-Eyes indexes existing PNG evidence with file timestamps. There is no dedicated automatic photographer role that captures each completed task or arbitrary game/app output. A screenshot alone would not prove a task passed. |
| Ideas are extracted from reasoning and chats | Partial | Idea scanning reads available OpenCode text messages, filters candidates and can ask the configured AI to curate them. It does not read every provider's hidden reasoning or every external chat. Raw chat fragments are not automatically trustworthy feature requirements. |
| Old plans and logs supply unfinished work | Partial | Existing tasks, grouped obligations, session todos and handoff context can be recovered and searched. There is no exhaustive importer of arbitrary old plan files or all providers' conversation histories. |
| The app builds improvements and closes wiring gaps | Implemented with limits | Auditor, improver and overseer propose or enqueue work; builders perform it. Local wiring audits have specific checks and cannot establish that every missing feature has been found. |
| It works on the game as well as Studio | Supported, separately scoped | Project selection captures each job's repository. The optional Ruins Runner launcher remains external, with its own required test pipeline. This audit did not run game acceptance tests. |
| Requests use smaller models when appropriate | Implemented with limits | Routine/heavy provider routes and Jev intake classification are present. Routing follows configured models and does not automatically compare or manage every paid AI subscription. Jev intake proposals are advisory. |
| Models are ranked by speed, quality, price and errors | Initial implementation | Model Lab has a local per-project ledger, observed timing/throughput/error rates, reported token/cost totals, separate human/model rating records, task-type filtering and effort breakdowns. The UI supports human ratings. Unknown costs/quality are excluded from every model's score; a successful call is not a verified task result. The ranker does not yet change live provider/model routing. |
| Start at the lowest effort and automatically scale it | Partial | Existing heavy GLM/OpenCode calls request low effort and the ledger records requested versus provider-confirmed effort separately. Pure helpers select the lowest explicitly supported level and cap increases to reasoning/validation feedback; these helpers are not yet wired into automatic retries. Auth/quota/transport failures must not increase reasoning effort. |
| Run and judge multiagent demos | Planned | The Compare view describes the pending workflow. Neither isolated runnable project variants nor side-by-side model proposals are launched by this version. Model-rating storage exists, but there is no live judging button or fabricated model rating. The requested demo format remains to be chosen. |
| Context manager and usage tracker | Initial implementation | Task context preview prioritizes the current brief and obligations within an explicitly estimated token budget, listing included, shortened and omitted sources while preserving saved originals. It is not yet the universal worker context compiler. Usage tracks instrumented Studio assistant calls/probes from this version, with unknown counters and retained lifetime totals; external coding CLI sessions and subscription/account balances are not synchronized. |
| Everything is managed in one Studio interface | Partial | The board, project UI, history, activity, music and themes are integrated. Coding still depends on an available configured CLI/provider; all worker runtimes/accounts are not bundled. External tools have launch/detection support, not universal agent or billing synchronization. |
| The system runs continuously | Conditional | It can continue in the tray while Studio and the computer are running, subject to saved Pause, provider availability, backoff and budgets. It is not an always-available cloud service and cannot work through shutdown or loss of connectivity. |
| Active work is visible on a reactive node tree | Implemented | Five saved node styles and five layouts support flat 2D and true 3D depth. Saved task groups expand without hiding running or verifying children; member briefs and history stay available. Active emphasis, role colors, stable anchors and task-aware Follow remain. Reload/resize can reflow positions. Animation itself is not execution evidence. |
| Music, Spotify switching and Studio themes | Implemented with limits | Local playback and audio analysis are built in, with seven preset themes and saved custom accent/background/panel/text colors. Styling and layout are independent. Spotify links use official embeds; queues are session-only and Spotify controls sign-in/playback. There is no full Spotify library/device/account sync. |
| Free distribution / Steam bonus | Not implemented as a release workflow | A portable Windows build exists. The supplied comments describe distribution intent; there is no completed Steam delivery or public release pipeline established by this audit. |

The model/subscription price discussion and third-party product preferences in
the screenshots are not Studio feature requirements or verified pricing claims.

The opening failure observed during this audit was a missing renderer process
with the Studio host still alive. Restarting restored the saved workspace. The
original exit reason was not logged, so its cause is not yet proven. Bounded
renderer recovery and content-free failure diagnostics were added so a
future failure can recover and be diagnosed without discarding the board.

A role's 150-second timeout does not cancel every underlying operation. It now
retains the slot and journal until that operation settles, blocking same-role
overlap while unrelated roles continue. A permanently stuck operation needs an
app restart; end-to-end cancellation remains a separate improvement.
