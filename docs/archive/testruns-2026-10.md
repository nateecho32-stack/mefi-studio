# TESTRUNS.md archive, 2026-10

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

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
