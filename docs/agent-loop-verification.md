# Agent loop and visual planning verification

Verified on 2026-09-19 against the shared source checkout. This pass fixes integration defects and adds a visual planning workflow; it does not certify every possible provider response or external worker failure.

## What is now visible

Open **Plan an idea** or **Plans**. The view follows:

**Idea → Explore → Your decisions → Specification → Your approval → Build → Verify**

The question map distinguishes ready, blocked and resolved questions and links each question to its prerequisites. Clicking a stage or question opens its existing controls. The activity indicator follows an actual pending planning request, including error recovery. Suggestions do not resolve questions or approve a specification.

After conversion, the same view reads the task board and displays queued work, active builders, dependency waits, review and completion. Manual confirmation is labeled separately from verification. Polling stops when the view closes, stale project responses are rejected, and small-window/reduced-motion layouts are supported.

## Integration and reliability changes

- **Intake:** exact duplicates within an admission batch collapse; distinct briefs survive. Full explicit task prompts are retained. Promotion respects priority and existing ownership/completion states.
- **Planning handoff:** approved tasks retain individual identities, prerequisites, acceptance text and plan provenance through queue selection and housekeeping. Retrying interrupted conversion reuses existing tasks. Newly saved tasks reach advisory Jev without blocking the queue.
- **Dispatch:** edits to a selected task's brief or file scope invalidate its old reservation before a worker starts. Broken worker input pipes retain ownership until process closure and report failure instead of crashing the host.
- **Ownership and Pause:** overseer repairs read live ownership inside the board transaction and respect fresh foreign leases. Late overseer responses cannot start new automatic roles after Pause. Worker-requested roles are journaled and held until Resume, including across a paused restart; explicit manual actions remain available.
- **Agent handoffs:** allowed worker role calls route through the host. Reference calls enqueue restartable gathering and attach references to the originating task. New follow-ups retain full scope and exact parent/run/child identity, recover interrupted admission and become durable task cards before execution. Parents wait without spending verification retries; verified children discharge only their matching obligations. Exhausted children hold their parents for review while independent work continues. Cleanup cannot erase accepted handoffs through broad title/theme matching.
- **Verification evidence:** claimed checks require completed command records with an explicit numeric exit code in the attempt's exact session and time window. Failed or pending checks block completion. Temporarily unavailable evidence waits without spending retries; malformed permanent attempt windows use bounded retry instead of waiting forever. Recorded check counts remain on receipts and Done cards without copying command output.
- **Model routing:** planning discussion uses the configured routine model and specification drafting uses the heavy model. Missing heavy defaults no longer become the literal model name `undefined`. Explicit fallback and returned model identity are covered. Model Lab preserves planning provenance.
- **Reporting:** a builder's failure report uses that run's own error, avoiding contamination from a simultaneous worker. Distinct instruction-reference jobs no longer silently coalesce.

## Relationship to Wayfinder and Jev

The planning structure follows [Wayfinder's decision-first workflow](https://www.aihero.dev/skills-wayfinder): record a destination, expose unknowns, resolve dependent questions with evidence, then prepare the specification and implementation work. Studio stores this in project-local plans and hands approved work into its existing executor.

Studio's research and prototype question types currently collect discussion and evidence. They do not autonomously run research agents or build prototypes. Planning assistance can use local references and explicitly requested web references; human decisions and approval remain required.

Jev receives newly admitted work as an advisory comparison. It cannot rewrite approved tasks or their dependencies, approve planning decisions, or select the live worker model. Planning model usage appears in Model Lab; Jev calls use their existing improvement-budget accounting. Tests check self-comparison exclusion and single charging.

## Evidence

- `npm run build-booklet`: generated the renderer bundle successfully.
- `npm run check` and `npm run audit`: passed; audit reported zero errors and warnings.
- Focused planning, intake, coordination, lifecycle, handoff, continuation, Jev and model suites: 157 passed, one skipped. The skipped test is the opt-in live Jev gateway call.
- Integrated `npm test`: 651 Node tests passed, one opt-in live Jev call skipped; all 204 Python tests and six normalized-path claim checks passed. The renderer tests delay collision-state delivery to prove the first frames still paint nodes.
- Thirteen actual host-loop scenarios cover dispatch, streamed settlement, verification, dependent dispatch, three-slot refill, Pause/Resume, own/foreign leases, missing evidence, malformed windows, durable admission recovery and delegated completion. Worker processes, clocks and stores are controlled test boundaries.
- The normalized-path claim checks passed independently: parallel overlap rejection, release, idempotent ownership, dispatcher deferral, atomic multi-file claims and foreign-owner protection.
- `python tools/verify_planning.py --output tools/logs/agent-loop-planning`: 13 real Electron checks, 14 screenshots. Covers the question frontier, controlled pending/error response, decision and approval gates, conversion idempotency, plan/task links, actual board updates, reload/project isolation and layout. No attempted network calls, coding workers or renderer console errors.
- `python tools/verify_workspace.py --output tools/logs/agent-loop-workspace`: 17 real Electron checks, 14 screenshots covering task/idea admission, prerequisites, history and Pause/Resume.
- The real Electron appearance matrix passed all 60 combinations: five styles across five layouts in 2D and 3D, plus every style in both views with a light palette. Thirty real orbit gestures changed perspective without moving world anchors. Fit, reload persistence and controls at 650px also passed, with 49 screenshots and no renderer errors or attempted network/worker calls.
- The follow-up collapsed-panel tour passed five checks with 14 screenshots. At desktop and 900px, all three running jobs retained names and all four checkpoint badges remained stable across successive frames. It covers both views, dark/light colors, panel reopening and saved appearance after reload. The separate Windows computer-use check found the live app, but activation failed and the retry timed out; this pass does not claim a successful live-window inspection.
- The separate palette and idle tour passed eight checks with 13 screenshots, including actual light/dark canvas colors, readable custom palettes, the 30-second Zen transition, mouse wake, reduced motion, and restoration of the camera after leaving settings.
- A read-only sample of the already running portable app showed heartbeats, parallel builders finishing and subsequent dispatch, plus existing Jev proposal and budget records. This is an operational snapshot, not a fresh paid provider or model-quality test.

Tests used isolated stores, controlled model transport and worker boundaries. The live user's projects, settings and task state were not used as disposable fixtures. Screenshots and test logs remain under ignored `tools/logs/`.

## Remaining limits

- Completion verification evaluates attributable edits, observed command results, failures and outstanding obligations. Claimed checks require session-attributed passing execution, but edit-only work can pass on attributable completed edits. This does not independently execute or certify every acceptance criterion. A successful worker exit alone is not verification.
- Agents coordinate through shared context, role jobs, references and follow-up work. There is no general peer-message acknowledgement protocol.
- Jev's advisory comparison queue is in memory; the admitted task itself is durable. Restarting can discard pending advisory comparisons without losing the task.
- Fresh foreign leases are protected and ordinary updates drain work. Hard-kill adoption of surviving external worker processes remains outside the verified recovery guarantee.
- Legacy request deduplication across separate passes still uses title/theme heuristics; approved-plan task identities and explicit admitted handoffs are protected from those heuristics.
- The active host uses serialized local JSON board mutations. Optional SQLite support exists in the repository, but the live host does not currently enable its cross-process board transactions.
- No new paid AI or coding-worker runs were started for this verification. Provider connectivity, generated-code quality and live billing were not newly exercised.
