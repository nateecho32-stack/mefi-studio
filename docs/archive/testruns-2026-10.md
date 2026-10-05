# TESTRUNS.md archive, 2026-10

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

## 2026-10-03 Paired worker recovery and bounded history qualification

Corrected candidate: 22 focused coordinator/worker/desktop/UI tests pass. Real
temporary HTTP loopback runs all six Studio checks at exact merged commit
ae5f26c, without changing source or creating a production pairing. Persisted
start grants fence late-success reconciliation; pre-start expired jobs cannot
claim success. Failure injection proves archive append retries are idempotent,
command deadlines settle and hold recovery, and shutdown/restart admission is
bounded. Progress retains only 20 displayed lines with previous/next navigation.
Check and audit pass; offline lint retains 42 baseline warnings and zero errors.
The preserved first candidate passed the full Node/Electron, 248 Python and
six normalized-lock checks; the corrected aggregate run is reported separately.
CodeRabbit completed three reviews (6, 2 and 3 issues). Valid issues were fixed
and tested; history uses bounded pages rather than unbounded append, and late
success requires a persisted grant instead of rejecting every expired reply.
Native UI captures are bridge simulations; LAN/cross-network operation and
distributed AI execution remain unqualified. No live network or owner grants.

## 2026-10-03 Paired repository checks first vertical slice

Isolated opt-in coordinator and worker qualification: 15/15 focused tests pass
with durable queue/registry restart, persisted single start grants, lost reply
reconciliation, stale lease/fence refusal, disconnect abort, bounded transport,
encrypted pairing adapter, and real Git/Node exact-commit checks preserving dirty
source. Real Chromium setup/recovery fixture passes 1/1 at desktop and 600px;
bridge is simulated, zero external network/process attempts. Status stays local
until disclosure; no service or owner grant activates on startup. Detail folds
survive status refresh. No live LAN/cross-network or AI delegation qualification.
Full repository gates are reported separately with their actual outcomes.

## 2026-10-03 - Completed updater review and final channel cleanup

CodeRabbit completed the combined updater delta at 85bc4e6: 21 files reviewed, two minor issues. The channel-toggle cleanup now keeps the switch disabled during checking, downloading, installing or rollback, and the changelog makes deferred artifact publishing explicit. The original three partial review issues were fixed in 85bc4e6. Native screenshot evidence uses an isolated bridge; live update channels, credentials and provider state are untouched.

Final focused tests, generated booklet, checks, audit, lint, exact-head CI and the follow-up review qualify this final small change before landing. The full b481ec0 integration gate and earlier red aggregate remain separately recorded, with their original outcomes and native capability limits.

## 2026-10-03 - Combined updater gate and review follow-up

The combined application head b481ec0 passed the corrected full Windows gate with process-scoped Git trust: 6,796 Node tests, 6,780 passed, zero failed, 16 skipped; 248 Python contracts OK with one skip; six lock checks passed. Its three exact-head GitHub runs passed on Windows and Linux. The earlier failed aggregate remains recorded separately.

CodeRabbit's updater-delta review timed out after 18.5 minutes with three minor partial findings and no completion event. Follow-up fixes add per-version automatic retry backoff, a useful channel-failure message and fallback past unusable package metadata without hiding access failures. Focused updater/boot-health tests pass 48/48; the isolated real-Chromium channel fixture passes, including cancelled consent, missing artifacts and narrow geometry. Final follow-up checks, exact-head CI and a completed review remain required before landing.

Native compositor occlusion is unavailable in this Windows session and synthetic Ctrl+W is not acted on by the native window; those established limitations remain. Screenshots use an isolated bridge and do not change live settings or prove a merge. No workflow, release, credential or provider action is included.

## 2026-10-03 - Combined task-context and update-channel integration

The two application branches are integrated without workflow changes. Both changelog entries and every unique test-history row are retained, and the booklet is regenerated from the combined sources. The rollback VM fixture now supplies the production project-switch state and pins refusal before any rollback side effect.

Focused updater/boot-health suites: 44 passed. Build, check, audit and lint pass; lint retains 42 baseline warnings. The first full run completed: 6,796 Node tests, 6,779 passed, one failed, 16 skipped; 248 Python contracts OK with one skip and six normalized-path lock checks passed. Its sole failure was the CSS CLI Git subprocess refusing checkout ownership, not an application assertion; the unchanged CSS suite passes 14/14 with narrowly scoped Git trust. This failed aggregate is preserved as failed. Corrected full verification and exact-head CI/review are pending before main integration.

Stable remains the default; development requires explicit warning/consent. Development artifact publishing is deferred, so no supported development artifact is promised by this application-only change. No release, provider action, UI-default activation or workflow publication is performed.

## 2026-10-03 - Echo GitHub update channels - unfinished review checkpoint

35 focused updater/channel tests pass, including native-consent cancellation, saved channel, stale responses, stable downgrade eligibility, platform/provenance/hash checks, nested artifacts, interrupted downloads and jobs starting during download. The isolated desktop renderer exercise passed after correcting the fixture's desktop capability and checking actual visibility; screenshots are local evidence. Check and application audit pass. Lint: zero errors, the existing 42 warnings. The full Windows npm test gate is still running and has reported failures in attempt_review_host and attempt_snapshots_host; these are untriaged, so this work is not merge-qualified. The initial restricted-account renderer launch failed; the same fixture ran on the real desktop. Official v0.4.4 was downloaded and verified against GitHub's SHA-256 into a separate folder. Original local state and PR3 were not changed. No release/tag published and no live development opt-in. Remaining: finish/triage full gate, final UI capture, CI and review, then integrate the prerequisite ahead of PR3.

## 2026-10-02 late evening - bounded review and tree harness completion

**Result:** complete affected suites passed (29/29). Paired predecessor/candidate probes demonstrated that fixed sleeps can precede async metadata writes and animation callbacks. The isolated harness waits for durable end-shot metadata and the unchanged >1px movement plus radius-growth criterion, with five-second bounds. Controlled delayed completion and permanent-frame-absence checks are recorded in external evidence. Earlier red aggregate remains preserved; full supervised aggregate qualification pending. Application execution, logging, retention and exports are unchanged from the frozen log-diagnostics candidate.

## 2026-10-02 late evening - memory-only durable-log write health

**Result:** focused Node tests passed (40/40). Executor/work-event append failures remain nonthrowing; later writes recover; fixed channels, saturated counts, detached snapshots, broken clock and Trace success/read-failure metadata covered. Full aggregate and native Trace checks queued until the parent releases the game window. No retention, redaction, export or persistent-log changes.

## 2026-10-02 late evening - Deferred navigation focus source diagnosis and proposed guard

Booklet v3 full aggregate completed with 6760 Node tests: 6743 passed, one Tasks retained-focus assertion failed, 16 skipped. Python 248 OK (one skip), locks six passed, real provider-free Fleet ten steps passed; build/check/audit passed. Active task-new, connected retained summary, unchanged card identity/expansion and changed-card checks match the preserved prior symptom. Booklet remains frozen, unqualified and unlanded. Original inventory run (obsolete wiring/partial packaging fixture plus Plans/tree native timeouts), stopped v2, and all prior failures remain reachable in local evidence. Unchanged tree passed controlled repeat and v3 aggregate; no cause claimed for native timeouts.

Exact production claim() source under controlled frame scheduling demonstrates unconditional task-new focus after later summary/search focus or release. Verified predecessor and booklet v3 navigation bytes match and reproduce the ordering. A separate isolated candidate guards pending initial focus against a newer claim, release, hidden destination or changed active element. Eleven focused cases plus existing navigation/startup/settings contracts passed: 58/58. Unchanged predecessor fails the focus regression cases. Input drafts and valid default navigation focus are covered. Native focus event stack/timing instrumentation and trusted-pointer controlled predecessor/booklet/candidate comparison are prepared, not launched: game owns the native window. Native source-attribution probe remains queued. No production/provider actions, shell default changes, push/merge/release or Library retry. Candidate unqualified pending native attribution and full aggregate; source-level evidence is not a native cause claim.

## 2026-10-02 late evening - Booklet inventory contract adaptation after aggregate discovery

First frozen inventory aggregate exposed five Node wiring cases that still asserted individual builder reads and parallel codeParts lists. Updated those five files plus two Python contract files to read the declared inventory while retaining source membership, startup prefix, module dependency ordering, stylesheet adjacency, fixture coverage and CLI/export contracts. Updated Node suites: 125 passed. Focused Python: 3 passed. Builder/auditor/renderer bytes match the first inventory candidate; original LF/CRLF equivalence evidence remains applicable and preserved. Build/check/audit passed. Full repeated aggregate queued after first frozen run completes; prior failure/source retained, candidate unqualified and unlanded. No runtime, shell-default, production/provider or publication changes.

## 2026-10-02 evening - Isolated booklet input consolidation focused validation

One ordered inventory covers current 76 scripts and 28 stylesheets. Preserved old builder and candidate emitted byte-identical booklet and source manifest under identical LF and CRLF inputs; new build reported changed=false over each baseline output. Five build cases and 31 inventory/source-location/auditor cases passed, including 16 new missing/duplicate/order/foreign-root contracts. Build/check/audit passed. Native and full aggregate remain queued while game owns the heavy window. Isolated candidate unqualified and unlanded; verified detail-action candidate preserved. No provider, production, shell-default or release changes.

## 2026-10-02 late afternoon - Isolated detail-action reply ordering focused validation

129 focused Tasks/groups tests passed, including 16 restore/prerequisite ordering and epoch cases. Controlled actual host handler/gateway/coalesced-send plus renderer reproduction: baseline regressed accepted context version 5 to 4 in both actions; candidate preserved version 5. Memory-only adapter, no production/provider actions. Build/check/audit passed. Native IPC fixture prepared, not launched: parent reserves heavy window for game. Full npm test and real Fleet gate pending; candidate remains unqualified and unlanded. Prior Gather candidate and unexplained focus failure preserved.

## 2026-10-02 — Deferred reference-gather project and generation fences

**Scope:** Separate candidate from fully verified task-open-race; project identity/epoch and gather generation fence replies and save completions. No host cancellation, provider or dispatch changes.

**Results:** 113 focused Tasks/group tests pass, including 16 new gather regressions. Host pool suite exercised unchanged cancellation and queue contracts; exact results in external evidence. Native baseline/candidate cases prepared but not launched while the game owns the window. Full aggregate queued.

**Limits:** Unit bridges only, no production writes or provider calls. Original verified candidates and focus-failure evidence preserved. No publication.

## 2026-10-02 — Pending task-open project and view fences

**Scope:** Isolated candidate derived byte-for-byte from the verified task-card retention source; original preserved.

**Results:** 97 focused Tasks/group tests pass, including six asynchronous open regressions. Native baseline reproduces a same-ID cross-project gather/announcement; native candidate passes six cases. Broader overview/delegation/plan/retention fixture passes on repeat. Build, check and audit pass. Full aggregate pending coordinated window.

**Limits:** Provider-free synthetic bridges, no production actions. Initial native sandbox launch failure and an earlier native retention-focus failure preserved in external evidence; no assertions weakened. No push, merge or release.

## 2026-10-02 - Tasks overview card retention focused qualification

Isolated local/task-card-retention-20261002 candidate, derived from the aggregate-verified Fleet recovery source. Tasks UI and task overview grouping: 90 passed, 0 failed, including unchanged DOM identity, insertion/removal/reorder, grouping changes, focus/expansion, canonical actions, drafts, hidden reopen, stale reads and project isolation. Paired Electron benchmarks and aggregate gate are pending; no performance improvement is claimed yet.

## 2026-10-02 - Fleet read failure and recovery: isolated focused validation

79 focused Fleet model, host, layout and UI tests passed. The real Chromium fixture passed all 25 existing layouts plus cached, unavailable and recovered states at 1440x900 and 600x560, with no page overflow, console errors, network attempts or child execution. Project switches clear all old team content; same-project errors persist across repaint; deterministic deferred tests cover late success, rejection and push ordering. Host run-identity checks remain unchanged. Full aggregate validation follows on the frozen candidate; its separate evidence records the outcome without changing tested source.

## 2026-10-02 - Maxwells-PC task plan provenance focused verification

Source/provenance: local/task-plan-trace-20261002 in the separate mefi-studio-plan-trace checkout at b3a4f468348a4485112c6741026b565f106e9821 plus the aggregate-verified Health candidate. Original checkout and verified UI/loop, recap and Health candidates remain untouched. No commit, push, merge or release.

Change: Task Details reads the current saved destination through its explicit planningId and existing scoped plan read. It labels missing, unreadable, foreign, ambiguous, stale, changed-specification, archived or unapproved context; the recorded brief is not replaced. The existing plan navigation is reused only for an identifiable scoped plan. Plan-only refreshes patch that section in place, retain other detail nodes and note drafts/focus, and move focus off a link if it becomes hidden. No prompt, dispatch, permission, task-store or publishing changes.

Focused validation: 82 Node tests passed, zero failures/skips across task_overview_groups and tasks_ui. Meaningful cases cover explicit association, read-only inputs, foreign and duplicate plan identities, unreadable cached context, legacy scoped plans, missing/large destinations, changed/stale/archive/unapproved context, preserved briefs, existing navigation, plan-only refresh with draft/focus, unavailable/recovery transitions and late prior-project responses. Two initial DOM assertions needed fixture corrections: the UI normalizes placeholder punctuation to an ellipsis, and the existing task controls need the appropriate bridge for a Start action. Stable entry identity and existing task controls retained the intended assertions; corrected complete focused run passed.

Expanded affected suites: 92 tests passed, zero failures/skips across task_overview_groups, tasks_ui, task_groups and task_groups_node_edges. The refresh test follows the visible History-to-Details flow; recovery makes the existing plan link available again without replacing the detail nodes.

The Chromium fixture is prepared for desktop and 600x560 captures of current, changed, missing and foreign links, with text size, horizontal bounds, no overflow, original-brief and navigation-availability assertions. Visual, full aggregate and disposable-profile runtime checks remain pending coordinated server release; no heavy launch was made while game native tests owned the window.

Dependency evidence: frozen Health candidate passed build/check/audit, full npm test (6,661 Node passes, zero failures, 16 skips; 248 Python tests OK with one skip; six path-lock checks), 25 Fleet size/view checks and waited real Fleet 10/10 steps. Its 1,012 source hashes remained unchanged and all test processes drained. Platform limitations remain native Close through synthetic Ctrl+W unverified and occlusion capability unavailable. That prior aggregate does not validate this new renderer change.

## 2026-10-02 - Maxwells-PC advisory handoff progress focused verification

Source/provenance: local/fleet-handoff-health-20261002 in the separate mefi-studio-health checkout, based on b3a4f468348a4485112c6741026b565f106e9821 plus the aggregate-verified recap candidate. The frozen recap source, original checkout and prior UI/loop candidate remain untouched. No commit, push, merge or release.

Change: an informational Fleet Health note for at least three distinct handed-off tasks from one builder seat in the last 24 hours without later recorded verification. It counts task identity rather than event volume, clears verified and human-confirmed child evidence, ignores future or expired events, remains project scoped and opens the source seat through the existing Look action. It describes retained evidence and explicitly says waiting for verification can be normal; no attention-count increase, automatic pause or dispatch change.

Focused validation: 30 Node tests passed, zero failures/skips across fleet and fleet_host. Tests use real board/status/report observations and cover duplicate/title-changed events, pending completion reports, verification and human confirmation, persistence, renewed handoffs, expiry, future events, read-only history and cross-project isolation. The extended Chromium fixture is prepared for desktop/narrow note and inspector screenshots, but was not launched while the game held the shared server window. Required full aggregate and real Fleet verification remain pending coordination; no aggregate validation is claimed for this new batch.

Dependency evidence: the unchanged recap candidate passed build, check, audit and full npm test (6,656 Node passes, zero failures, 16 skips; 248 Python tests OK with one skip; six normalized-path lock checks). All 1,012 tracked files matched the source freeze after the gate. Its synchronous disposable-profile real Fleet check passed all ten steps. The PowerShell GUI launch's initial zero-second entry was replaced with the actual waited child exit and report. Platform limitations: synthetic Ctrl+W did not exercise native Close; Electron occlusion events were unavailable. That evidence belongs to the prior recap candidate, not this new Health change.

## 2026-10-02 - Maxwells-PC Fleet seat recap focused verification

Source/provenance: local/fleet-seat-recaps-20261002 in a separate mefi-studio-recaps checkout at b3a4f468348a4485112c6741026b565f106e9821, with the previously verified UI/loop candidate applied first. The original checkout and mefi-studio-current candidate remain untouched. No commit, push, merge or release.

Fleet recap batch: deterministic recorded history from up to four prior generations, capped at 1,500 characters, shown in the seat inspector and passed to the next assigned worker. Live generations are excluded; interrupted, awaiting-verification and verified outcomes remain distinct; exact repeated handoffs collapse while distinct child identities survive. The full ledger and task history remain intact. Lookup stays project scoped, is bounded at two seconds and fails open for dispatch; no additional model calls.

Focused validation: 148 Node tests passed, zero failures/skips across fleet, fleet_host, executor_core and executor_lifecycle, including cross-project and project-switch isolation, saved interruption/verification history, handoff identity, bounded text/prompt budget, actual prompt delivery, unavailable history and a stalled lookup. Initial new history test needed its active board seed before checking the observed verified transition; corrected focused run passed. Fleet Chromium fixture passed in 31.1 seconds: 25 layout/view combinations across five size/zoom cases, desktop/narrow recap geometry, real inspector content, no renderer errors, network or child attempts. Screenshots retained at 1440x900 and 600x560. Build-booklet, check and audit passed; zero audit findings/errors/warnings. Required full aggregate gate is pending parent coordination of the shared server CPU window; this row does not claim aggregate validation of the recap batch.

Separate live evidence: the unchanged prior candidate passed actual native restart during a real Codex worker, app PID 10360 -> 7212, original app exit 0. Interrupted progress/claims persisted without a failure charge; old worker process tree drained before explicit resume, paused dwell admitted no worker, exactly one resumed worker completed and the actual project check/verifier reached Done/Verified; shipped review Accept ran once. Both workers were sequential and the same one task survived. This used disposable Git/project/profile and existing authorized ChatGPT login. No production tasks, credentials, original checkout, default Classic or release state changed. The complete raw active-native-restart report/controller/screenshots stay outside Git under task-2/evidence.

## 2026-10-02 - Maxwells-PC modern UI and live-loop verification

Source/provenance: isolated branch local/ui-loop-current-20261001 at b3a4f468348a4485112c6741026b565f106e9821. Independently reproduced on the server; Echo's uncommitted patch was unavailable and was not assumed transferred. The installed OneDrive checkout remains clean at 1dd9518be7b8843616cd56778f8d834fcb534e58. No push, merge, release, production restart, credentials or default-setting changes.

Product changes: expanded optional session controls preserve a 60 px conversation area and the draft in short windows, including 150% zoom. A real Codex worker repeated its identical MEFI_NEXT title/brief on stdout and stderr; executor-core now admits that pair once per run while preserving distinct titles or briefs. No other lifecycle implementation changed.

Harness repairs: asynchronous Windows cleanup lets background Git completion drain; cancelled claims wait for the actual dropped event within a bound instead of sleeping 300 ms. Plans reasserts its existing CDP focus emulation before native Enter, preserving the actual focus-paint assertion. The full workspace verifier follows current Agents navigation and compact pickers, the Finish-to-tour flow, completed guide, named decision cards, current Work search/overview/History views, project switching, saveResume reload, and admission semantics. Visibility/hit tests, durable-store checks, scope approval/rejection, worker guards, and renderer-error checks remain enforced.

Final aggregate on frozen source, Node 24.9.0 and Python 3.10: build-booklet, check, audit and npm test all exit 0. CPU: 6599 tests, 6585 pass, 0 fail, 14 skip. Desktop: 62 tests, 61 pass, 0 fail, 1 skip. Exclusive Command and Eyes: 1 pass each; occlusion: 2 pass. Node total: 6665 tests, 6650 pass, 0 fail, 15 skip. Python: 248 tests, OK with 1 skip. Normalized-path lock: 6 checks pass. Node stage 1322 s, Python 53 s, whole npm test 1376 s. No source-drift warning. Audit: 0 findings, errors or warnings. Booklet hash bfe811c509c8.

Complete modern workspace UI run: 17 workflows, 17 screenshots, 1280x720 and 600x760 layouts, 0 external network attempts, 0 coding-worker attempts and 0 renderer errors. The complete Sessions fixture also passes in the aggregate at six sizes with pictures, Accept/Revert/Undo, expanded controls, draft retention, reload, layout-off checks and 32 screenshots. Focused loop/handoff: 79 pass. Focused cleanup/snapshot/CSS: 66 pass, 3 skip.

Real provider probes use the scoped official Codex 0.160.0 CLI and existing ChatGPT authentication: actual greeting edit plus delegated worker and both local checks pass; a real unsupported-model rejection settles without edits, false completion or handoff; stop/save kills a real isolated Codex child, saves pending progress, reopens without a failure charge and pauses admission, then explicit test resume edits and checks successfully. Board/storage, timers, helper delivery and window relaunch are fixture adapters. These probes do not establish a real application relaunch, cross-process database recovery, or provider-backed Done/Accept. No production project/profile was used.

Earlier failures are retained in current-combined.log: Windows cleanup/cancellation timing and default-CLI Git ownership were harness/environment issues; the earlier Plans focus failure used the original fixture and passes after fixture repair. The Git ownership workaround is process-scoped to the verified isolated clone, with no global Git configuration change. The earlier diagnostic source-drift warning is historical; the final aggregate held source still.

Evidence and deliverables remain under task-2/evidence: final gate logs, modern UI report/screenshots, real provider-probe reports and a b3a4f46-based candidate patch. Private CLI logs and production data are not part of the patch or screenshot deliverables.

## 2026-10-01 - Maxwells-PC isolated current-main short-session validation

Source/provenance: independently reproduced on b3a4f468348a4485112c6741026b565f106e9821, branch local/ui-loop-current-20261001. The installed clean OneDrive checkout is 1dd9518be7b8843616cd56778f8d834fcb534e58, an ancestor 290 commits behind; it was not modified. Echo's uncommitted working patch was unavailable. The earlier local old-baseline patch and test counts are historical, superseded by this run.

Change: optional 0.5 session layout keeps a 60 px conversation minimum in short windows with controls expanded. A renderer regression failed before the CSS change at 600x560 and 150% zoom (0 px); after the change, asking and reviewing both retain 60 px and the draft. No lifecycle implementation or app defaults changed.

Validation: Node 24.9.0 portable runtime; booklet bfe811c509c8; check and audit pass. Focused lifecycle/resume/delegation/verification/provider-isolation/updater-continuity suites: 190 pass. Complete standalone session fixture passes at six sizes with Accept/Revert/Undo, pictures, reload, layout-off checks and 32 screenshots; it also passes in the combined gate. Scoped disposable real-app IPC probe passes setup/tour/verify-first persistence, synthetic assistant-message failure with draft/retry retained, and reload with workers paused. External calls and coding workers were blocked. No actual provider delegation or Codex CLI execution is claimed (Codex CLI absent).

The legacy full tools/verify_workspace.py is still red: current agents.js deliberately hides the old Home queue disclosures and settings the verifier clicks. First-run harness assumptions were updated to follow the supported Finish-to-tour flow and saveResume reload path; no workflow assertions were removed. The separate scoped IPC probe does not replace this full workflow gate.

Combined gate results and CPU triage are recorded in the external current-status.json and current-combined.log. Initial CPU stage: 6579 pass, 5 fail, 14 skip; serial triage: 64 pass, 2 fail, 3 skip, retaining a Windows EPERM cleanup and CSS CLI child error. Subsequent CSS solo: 14 pass; direct cascade checker: equivalent. Remaining cancelled snapshot assertion and cleanup failures did not repeat in serial triage. No changes made to snapshot/lifecycle behavior on this evidence.

Evidence: task-2/evidence contains current-session screenshots, current-ipc-probe report, complete gate/triage logs and the final b3a4f46-based patch. No credentials or production profile copied; no push, merge, release or production agent action.
