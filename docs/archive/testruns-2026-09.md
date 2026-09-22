# TESTRUNS.md archive, 2026-09

Rows that rotated out of the live region of `TESTRUNS.md` (the dated rows
above its `## Read Before Any Tests` guide, where only the newest rows
stay). `scripts/rotate-testruns.mjs` moves each row here verbatim as one
block - heading, H3 subsections and unheaded paragraphs together - newest
first. The frozen archive below the guide in `TESTRUNS.md` stays there.

## 2026-09-22 late evening - Shared-file handoff adopted: append_testruns_row and onboarding edits are additive and green; no re-edit needed (run_1790113018520_24)

Verified the A-Eyes shared-file handoff for the two named suites against the tree, not the prior reports. The later commits on each file are purely additive over origin/main and every session's change is intact: node --test tests/append_testruns_row.test.mjs 18/18, node --test tests/onboarding.test.mjs 32/32 (also green together in one process), and the renderer auto-tick producers (tasks.js, workspace.js, planning.js, booklet.js) dispatch the events the guide listens for. npm run check green (check-testruns 74 live rows newest-first, no conflict copies). A resolved handoff needs no re-edit per TESTRUNS.md 'Verifying a session edit-collision handoff', so no logic or docs changed. The only outstanding item stays Studio task-store bookkeeping (task_delegate_b4f73d934d18f69906d57de9's stored acceptance says 'below the anchor'); workers are barred from rewriting the task store, so that needs the owner.

## 2026-09-22 late evening - TESTRUNS append helper: document the helper and its gate in docs/code-map.md (task_388ad4eb331605dd, run_1790113065522_26)

This pass closed the last in-repo gap left by the append-helper brief: docs/code-map.md listed only check-syntax/targets/css/spec-collisions as `npm run check` and never named the helper at all. The 'Build, checks and release (CLIs)' section now adds check-testruns.mjs to the check chain and documents append-testruns-row.mjs as its write-side companion, stating the true top is the dated rows ABOVE the `## Read Before Any Tests` anchor (the archive below is frozen) - the direction the delegated acceptance worded backwards. Independently re-verified before editing: node --test tests/append_testruns_row.test.mjs 18/18, tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-testruns 73 live rows newest-first, no conflict copies), index clean. The only outstanding item is Studio task-store bookkeeping (task_delegate_b4f73d934d18f69906d57de9's stored acceptance says 'below the anchor'); workers are barred from rewriting the task store, so it needs the owner. This row was inserted through the helper itself.

## 2026-09-22 late evening - TESTRUNS append helper follow-up re-verified: landed contracts intact and no tracked artifact asserts the inverted anchor direction (task_5c7e89e86b59f637, run_1790112852595_20)

Re-verified this split follow-up against the tree, not the prior reports. scripts/append-testruns-row.mjs and its contracts pass (node --test tests/append_testruns_row.test.mjs 18/18), npm run check is green (check-testruns 72 live rows newest-first, no conflict copies), and no tracked artifact asserts the inverted 'directly below Read Before Any Tests' direction - the only remaining occurrences in the helper and this notebook label that wording as inverted against the shipped above-anchor layout. The parent split scope has no further in-repo implementation; the stale Studio task-store acceptance wording for task_delegate_b4f73d934d18f69906d57de9 is owner/Studio bookkeeping, not repository work. No logic or docs changed this pass.

## 2026-09-22 late evening - Per-role provider selection and the OpenCode Zen route land path-limited; feature isolation pinned (task_ed28a7a9019d3329, run_1790112423740_5)

Landed the uncommitted per-role provider work after verifying the tree: roleProvider/aiRoleProviders resolve each assistant role through its own provider (an unset role follows the main pick), OpenCode Zen joins AI_PROVIDERS/the auto order with its own zenApiKeyEncrypted key source (including opencode's OPENCODE_API_KEY) and a gpt-* Responses shim, DATA_ONLY_CLIS admits only Claude Code (spawned --tools=) to plan specs, brain drafts and the analyzer read, and the shared cliAssistantCall half keeps every other CLI on HTTP with a one-shot keyed fallback. Added tests/role_provider_isolation.test.mjs, which drives the real settings:set-ai-routing handler against an in-memory store and proves changing one role's provider, one provider's role model, or the role-wide fallback never touches another role, another provider, the main pick or builder models, plus clear and invalid-patch behavior. Repaired the jev_routing_ui harness to carry the IIFE-scoped noteConnectionSaved helper its save handlers call. Checks: node --test tests/planning_routing.test.mjs tests/analyzer_host.test.mjs tests/executor_tiers.test.mjs tests/jev_routing_ui.test.mjs tests/role_provider_isolation.test.mjs 67/67, python -m unittest discover -s tools -p test_mefi_studio_routing.py 23/23, npm run check exit 0 (check-syntax 103 files, check-testruns green). renderer/booklet.html is deliberately left for task_c77783a02984a415 to rebuild from the landed sources.

## 2026-09-22 late evening - TESTRUNS append helper: live-region direction stated at the point of writing (--help + CONTRIBUTING) with a regression guard (task_f29eb72be6de663b, run_1790111425937_5)

Follow-up split from the append-helper card. Its brief/acceptance said 'insert directly below Read Before Any Tests', which is inverted against the shipped layout: every live newest-first row sits ABOVE the anchor and the archive below it is frozen. The helper already targets the true top (planInsertion comment + tests). This pass closed the wording gap where future briefs are written: the --help USAGE now names the anchor and states rows land above it, CONTRIBUTING.md's Checks note says the same, and a new contract asserts the help text keeps that direction so the inverted phrasing cannot silently return. Nothing in the append/gate behavior changed. Checks: node --test tests/append_testruns_row.test.mjs 16/16 (was 15), tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-testruns 70 live rows). This row was inserted through the helper itself.

## 2026-09-22 late evening - check-css --unused excludes the generated booklet artifact from sibling usage: artifact-only class now flagged (task_524c9513b1a6d003, run_1790110273032_3)

runUnused counted renderer/booklet.html as same-directory sibling usage, but that file is generated by build-booklet.mjs and bakes in a copy of every stylesheet and script, so a stale copy could keep a dropped class alive and mask orphaned selectors. The sibling corpus now skips booklet.html (basename match, mirroring the auditor fix in 984de99); the booklet template, renderer scripts and sibling stylesheets still carry every class the artifact can legitimately use. New temp-dir fixture writes .artifact-only only into booklet.html and its baked style block, asserts --unused exits 1 with UNUSED-SELECTOR sheet.css:2: .artifact-only, and pins a class used by a real sibling page as alive. Blind spot proven directly: booklet text in the corpus gives [] for .artifact-only, excluding it flags it. node --test tests/check_css_unused.test.mjs 15/15 including the default tree-clean test; npm run check:css:unused ALL-SELECTORS-USED across 5 stylesheets.

## 2026-09-22 late evening - TESTRUNS append helper: close the pre-swap and rollback windows (task_2ddbeec8fa4c102a, run_1790110167470_2)

Competing edits are now impossible on two more paths: the snapshot is re-verified inside atomicReplace AFTER the replacement bytes are staged and fsynced (read->rename is the only window left), and a post-append gate failure no longer restores the stale snapshot over a concurrent save - it leaves the live bytes for a deliberate merge. Two deterministic race tests use injected beforeRename/afterWrite hooks (15/15 contracts, up from 13). Live dry-run inserted at the true top (line 32); check-testruns 68 rows green.

## 2026-09-22 late evening - TESTRUNS concurrent-editor integration: both delegated fixes present and validated first-hand, gate green (task_2ddbeec8fa4c102a, run_1790109932765_4)

Parent integration pass over the two verified child cards on one tree. Inspected the landed sources rather than the reports: scripts/append-testruns-row.mjs is the write-side lock (cross-process lock file in the OS temp dir, re-read snapshot under the lock, newest-first splice into the live region above the "Read Before Any Tests" anchor, byte-compare re-read before an atomic temp-file+rename, post-write gate audit with byte-exact rollback, and row fields accepted as JSON stdin/--file/argument or --date/--daypart/--title/--task/--run/--body flags); scripts/check-testruns.mjs is the read-side gate (duplicate H2, stale-anchor ordering above the anchor only, OneDrive conflict-copy siblings, BOM, single trailing newline) wired into npm run check, with the archive below the anchor BLESSED by the recorded decision in its header and pinned by tests/check_testruns.test.mjs, and a missing anchor failing loudly so the live/archive boundary can never silently rescope. The alert's session-convergence claim remains unverifiable from repository artifacts and is not asserted; the fix prevents the stale-anchor/duplicate-row clobbering class instead of reconstructing that incident. Checks this pass: node --test tests/append_testruns_row.test.mjs 13/13, node --test tests/check_testruns.test.mjs 9/9, npm run check exit 0 (check-targets 103, spec-collisions 207, check-syntax 103 files, check-testruns 67 live rows newest-first, no conflict copies). Known bound reported not fixed: the lock is cooperative, so a non-cooperating writer can still land in the window between the pre-write re-read and the rename; read-verify-write narrows it and the gate flags any resulting duplicate or stale row. This row was inserted through the helper itself.

## 2026-09-22 late evening - CSS audit: drop the dead .planning-progress rule (task_8e4a4c25e1924180, run_1790109688562_1)

A-Eyes warn fixed: renderer/planning.css dropped the orphaned .planning-progress wrapper rule. Whole-repo grep finds the class nowhere in renderer html/js or any sibling stylesheet - only its own definition and the bundled booklet copy - so it is genuinely dead. npm run build-booklet regenerated renderer/booklet.html with exactly this one-line deletion vs HEAD (git diff --stat: 1 deletion in each of planning.css and booklet.html), so no sibling session's in-flight renderer edits were baked in. Gates: npm run check green - check-targets ok (103), spec-collisions ok (207), check-css --unused ALL-SELECTORS-USED (5 stylesheets), check-syntax ok (103 files), check-testruns ok (66 rows). Requested narrow suite: python -m unittest discover -s tools -p test_mefi_studio_*.py -> 247 tests OK.

## 2026-09-22 late evening - TESTRUNS append helper re-verified and anchor direction pinned in code + tests: live CLI insert at the true top, mid-run abort contract 13/13, check green (task_delegate_b4f73d934d18f69906d57de9, run_1790109712521_2)

Third pass on this card, starting by re-reading the helper and gate rather than trusting the prior rows. What this pass changed: the brief/acceptance phrase "directly below 'Read Before Any Tests'" is inverted against the shipped layout - the anchor is at TESTRUNS.md:3729 and every live newest-first row sits far above it (the archive below is deliberately exempt and frozen, decision in check-testruns.mjs header, pinned by tests/check_testruns.test.mjs and by the sibling archive-ordering card). A literal below-anchor splice would write into that blessed archive, so the helper's true-top-of-the-live-region target is correct and is now pinned: planInsertion carries a comment stating the direction and why, and tests/append_testruns_row.test.mjs asserts the fresh row lands above the guide (not below it). This row was inserted through the helper itself - node scripts/append-testruns-row.mjs --file <JSON spec> - so the acceptance's first clause is demonstrated live: the row became the first line of the live region. The second clause (non-zero exit, no write on a mid-run change) is covered by the read-verify-write guard: appendTestrunsRow re-reads the target after the snapshot and throws on any byte drift (contract: a side-effecting block mutates the file between the snapshot and the verify, the helper aborts and the concurrent bytes survive unclobbered), and the CLI maps that throw to exit 1 with no write via the existing main() error path. Checks this pass: node --test tests/append_testruns_row.test.mjs 13/13, node --test tests/check_testruns.test.mjs 9/9, node scripts/append-testruns-row.mjs live insert, then npm run check.

## 2026-09-22 late evening - CSS audit: dead usage-pop selector removed; tools suite re-run with 5 sibling-only routing failures (task_ef6dfb9706a24762, run_1790109281683_1)

A-Eyes warn fixed: renderer/styles.css dropped the never-used #idle-hud .usage-pop .tracker-line-account rule (the class appears nowhere in renderer html/js - tracker.js only ever writes tracker-line and tracker-line-warn). npm run build-booklet regenerated renderer/booklet.html; a no-index diff against the pre-build snapshot proved the rebuild changed exactly that one line, so the sibling session's in-flight booklet output was preserved byte-for-byte. Gates: npm run check green, including check-css --unused (ALL-SELECTORS-USED across 5 stylesheets) and check-testruns (64 live rows). Narrow suites palette+booklet+idle+eyes: 54 tests OK. Full python -m unittest discover -s tools: 247 tests, 5 failures, all in test_mefi_studio_routing (provider-router assertions against main.cjs/scripts/credentials.cjs) caused by the sibling session's mid-flight edits to those exact files - none touch styles.css or booklet.html, and the same 5 failed before this change's files were involved.

## 2026-09-22 late evening - TESTRUNS append helper verified, field/JSON input added: contracts 13/13, check green (task_delegate_b4f73d934d18f69906d57de9, run_1790109315655_2)

Verification pass on a7dfa70: the commit touched exactly scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and one row - the verifier snapshot changedFiles: 6 was sibling sessions dirt in the shared tree, not scope creep. Anchor direction re-confirmed against the pinned layout: the live newest-first region sits ABOVE the Read Before Any Tests anchor and the archive below it is blessed (check-testruns.mjs header decision, pinned by tests/check_testruns.test.mjs), so the acceptance wording below-the-anchor is inverted and the helper true-top target is correct. Closed the one real gap against the brief this pass: rows can now arrive as fields - a JSON object via stdin, --file, or one argument, or --date/--daypart/--title/--task/--run/--body flags - formatted into the canonical house row shape and audited by the same check-testruns gate; this very row was inserted through that stdin-JSON path. Checks: node --test tests/append_testruns_row.test.mjs 13/13 (11 prior plus field-flags/JSON and real-stdin contracts), node --test tests/check_testruns.test.mjs 9/9, npm run check green including the testruns gate.

## 2026-09-22 late evening - TESTRUNS append helper hardened with read-verify-write: a mid-run concurrent edit now aborts non-zero with no write instead of being clobbered; contracts 11/11 (task_delegate_b4f73d934d18f69906d57de9, run_1790108056387_13)

The committed helper (76ee209) already did lock-serialized atomic newest-first
insertion, but its write path never re-verified the snapshot bytes before the
temp-file+rename replace: a non-cooperating editor saving between the locked
read and the rename would have been silently reverted. appendTestrunsRow now
re-reads the target right before the atomic replace and throws (CLI exit 1, no
write, concurrent bytes left intact) on any drift since the snapshot. Saves
that land while the helper waits for the lock were already incorporated
because the snapshot is taken under the lock - now pinned by a spawn-level
test that holds the lock, mutates, releases. lockPathFor exported for tests.

Checks: `node --test tests/append_testruns_row.test.mjs` 11/11 (was 9/9; new
mid-run-abort contract fires deterministically via a side-effecting block
toString inside the read-to-write window, plus the parked-lock handoff test),
`node --test tests/check_testruns.test.mjs` 9/9, full `npm run check` green
before this row; this row itself inserted by the helper at the true top and
`node scripts/check-testruns.mjs` re-run green afterwards. Touches only
scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and this
row.

## 2026-09-22 late evening - verification-loop closure for the main.cjs refactor card: landed bytes re-confirmed at a93e9aa, check green (task_c5a704c58fcda993, run run_1790107636695_7)

Retry 3 after two "outstanding obligations remain" denials that were the
known prose-shape pattern: the prior pass's remaining text ("none for this
card (brains dirt belongs to task_7aae675692432cb7)") carries a
parenthetical without a handed-on keyword, so the denial reader could not
see it as a denial owed here; the work itself was already done and gated.
Independently re-checked this pass rather than trusting the prior reports:
`git show 89e4dc9 --numstat -- main.cjs` is exactly 34 insertions /
20 deletions as gated; `2f9d3d4` touches TESTRUNS.md only (27+);
landed-parity markers re-verified against current HEAD: `consecutiveFailures`
0 references, `runVerificationJobs()` parameter-less with both call sites
matching (main.cjs 10236, 10859), `doneClearing` still owned by the clear
path (declared 7381, reset 7439, trim guard 7549). Fresh gate for this
attempt: `npm run check` exit 0 (103 targets, testruns gate 61 live rows,
no conflict copies). The 2064 -> 2091 node-test delta between the two
earlier rows is the intervening sibling commits (brains editor, testruns
gate + helper contracts), not masked reds - run 2's stage was 0-fail.
Note: after 2f9d3d4 the brains sibling landed a93e9aa touching main.cjs
(brainsState/brainsSave scope) and holds CHANGELOG.md dirt; that work gates
on its own card (task_7aae675692432cb7). This commit touches only this row.

## 2026-09-22 late evening - post-commit gate rerun closes the main.cjs refactor card: 89e4dc9 landed the gated 34+/20- bytes, landed-parity re-verified at HEAD, check green (103 files), node 2091/2088/0/3, Python 247 OK, lock green (task_c5a704c58fcda993, run run_1790107034713_1)

The follow-up the 42797b9 row owed. The loop-cleanup sibling's commit landed
as 89e4dc9 ("Do the agent loop's housekeeping once and log less noise; fold
worker transcripts in the feed") with main.cjs at exactly 34 insertions /
20 deletions - the state the previous pass gated - plus its test, doc and
CHANGELOG files. Landed-byte parity re-verified at HEAD 76ee209 (no later
commit touches main.cjs): `consecutiveFailures` 0 references repo-wide;
`doneClearing` still declared at main.cjs:7379 owned by the clear path
(guard 7381/7382, reset 7437, trim guard 7547); `runVerificationJobs()`
parameter-less at main.cjs:10857 with both call sites (10234, 10881)
matching; the commit diff carries the setAutopilotWaiting measurement-only
masking, the overseerMiss settle-note helper, `delete next.verification`
evidence-streak restart, and the learn-loop guard against a project switch
mid-merge; no `ipcMain.handle/on` registration lines touched. Official
post-commit rerun: `npm run check` exit 0 (103 targets, testruns gate 60
live rows); `npm test` node stage 2091 tests / 2088 pass / 0 fail /
3 skipped (43 s, serialized eyes/occlusion suites green - cleaner than the
prior pass, whose lone brains_ui vm-read red is the documented rotating
environmental row), Python 247 OK (44 s), normalized-path lock audit green.
Caveat: the tree was not fully quiet - the brains-store sibling's
uncommitted dirt (main.cjs 4+/2- confined to brainsState/brainsSave,
preload.cjs, scripts/brains.cjs, tests/brains_{map,store}.test.mjs,
CHANGELOG.md) sat in the worktree; those suites ran green in-stage anyway,
and their quiet-tree slice-commit stays with their own card
(task_7aae675692432cb7). This commit touches only this row.

## 2026-09-22 late evening - TESTRUNS append helper scripts/append-testruns-row.mjs: lock-serialized atomic newest-first insertion with gate-audit rollback; contracts tests/append_testruns_row.test.mjs 9/9 (run_1790106299967_29, task_1ce49050ba42afe1)

The write-side companion to scripts/check-testruns.mjs (a1eea61): instead of
only detecting duplicate headings and stale-anchor ordering after a hand
edit, sessions append with `node scripts/append-testruns-row.mjs --file
<block>` (a quoted positional or stdin also work). The helper holds a
cross-process lock (temp-dir file keyed by the target path, breakable after
30 s stale), re-reads TESTRUNS.md under the lock, splices the row above the
first live row with an equal-or-older date - the true top for a fresh run,
the correct slot for a late backfill, bottom-of-region just above the guide
for the oldest - keeps the on-disk CRLF convention byte-for-byte outside the
inserted block, writes temp-file + fsync + rename (copyFileSync fallback if
Windows holds the target), then re-runs the check-testruns audit and rolls
back to the exact prior bytes on any new problem. It refuses to run at all
while the gate already flags the file (duplicate H2, conflict-copy sibling,
malformed tail, BOM), so appends never bury a known problem.

Checks: `node --test tests/append_testruns_row.test.mjs` 9/9 (true-top
insert, CRLF byte-exactness, late-backfill ordering, oldest-row-at-guide,
malformed/duplicate/gate refusals with the file left byte-identical,
dry-run, CLI forms, two concurrent CLI appends both surviving under the
lock) and full `npm run check` green before this row - check-targets 103
targets full coverage (the new script rides the check-syntax discovery
pass), spec-collisions 207 unique basenames, check-testruns 59 live rows;
this row itself was inserted by the helper and `node
scripts/check-testruns.mjs` re-run green afterwards. Touches only
scripts/append-testruns-row.mjs, tests/append_testruns_row.test.mjs and
this row; nothing else staged.

## 2026-09-22 late evening - archive below "Read Before Any Tests" blessed as-is: newest-first gate stays live-region-only, exemption documented and pinned by tests, missing anchor now fails loudly (task_87f7dbf510f14bef, run run_1790106278990_28)

Decision on the a-eyes card: bless, do not normalize. Evidence gathered
first-hand rather than adopted: the archive region holds 11 H2s - three
undated reference sections ("Python contracts", "App commands and captures",
"Agent loop, Jev and startup regressions") interleaved with eight dated rows
whose tail block runs oldest-first as a chronological narrative, including
the attempt/retry pair sharing run_1790085745914_2 that ad5bba2 already
verified as deliberately authored. Enforcing newest-first there would flag
the doc sections as non-rows or churn ~1,200 frozen verified lines to
prevent nothing: stale-anchor appends, duplicate rows and conflict copies
only ever land in the live region where new rows are inserted. Changes:
scripts/check-testruns.mjs header comment now records the decision and
rationale; a missing "## Read Before Any Tests" anchor is an explicit check
failure (previously a missing anchor silently enforced the whole file with
confusing non-row errors - the exemption boundary is loud now); new
tests/check_testruns.test.mjs (9 tests) pins live-region enforcement AND
the archive exemption so a future session cannot quietly "fix" the skip
back; the "How to read this file" preamble states the archive rule. Checks:
node scripts/check-testruns.mjs ok (58 live rows), node --test
tests/check_testruns.test.mjs 9/9, full npm run check green. Nothing else
touched; this commit is only scripts/check-testruns.mjs,
tests/check_testruns.test.mjs and this row.

## 2026-09-22 late evening - TESTRUNS concurrent-editor alert triaged as unverifiable, prior collision verified intact first-hand, structural gate scripts/check-testruns.mjs added to "check" so future append collisions fail the gate (run_1790105837299_25)

The dispatch named sessions ses_f359e43c/ses_f3573159/ses_f3572383 and an
"owner final version to adopt"; none of those IDs exist anywhere in the
A-Eyes data (data/eyes-*.json grep zero matches), TESTRUNS.md carried zero
uncommitted bytes at HEAD e24f429, no OneDrive conflict-copy siblings exist,
and the file's newest commit ad5bba2 is the already-verified 35-session
collision repair - so there was no owner version to adopt and nothing to
clobber. Root cause of the recurring alerts is structural: sessions append
newest-first rows by hand with no lock and no automated integrity check, so
stale-anchor inserts and duplicate/clobbered rows are only ever caught by
manual repair (ad5bba2 was exactly that). Fix:
scripts/check-testruns.mjs, wired into `npm run check` (and standalone as
`npm run check:testruns`), verifies the preamble and known-failures table
are intact, all H2 headings unique, live-region rows (above "Read Before
Any Tests") strictly newest-first by date, exactly one trailing newline, no
UTF-8 BOM, and no TESTRUNS* conflict-copy siblings in the repo root; the
frozen archive below the guide keeps its blessed order untouched. Checks:
`node scripts/check-testruns.mjs` ok (57 live rows) and full
`npm run check` green including the new stage. Sibling in-flight dirty
files (renderer/brains*, tests/brains_ui.test.mjs, booklet) left
byte-for-byte as found, nothing staged; this commit touches only
scripts/check-testruns.mjs, package.json and this row.

## 2026-09-22 late evening - main.cjs refactor gate on the settled-in-worktree loop-cleanup edit: check green, node 2064/2060/1/3 with the lone red a documented mid-run vm read (solo rerun green), Python 247 OK, lock green (task_c5a704c58fcda993, run run_1790104668687_12)

The card asked for a dedicated gate on the in-flight main.cjs edit once it
settled. By this pass the brief's 47+/64− snapshot had evolved to 34+/20− (the
sibling kept refining; still uncommitted). Static parity review of the diff:
`consecutiveFailures` is gone repo-wide (0 references after removal from the
autopilot state, both resume paths, the finish path and adoptProject);
`doneClearing` survives declared at main.cjs:7379 owned by the clear path, only
the trim's redundant flag copy removed; the `runVerificationJobs()` call site
now matches the parameter-less signature at main.cjs:10857 (the old `job`
argument was already ignored); no `ipcMain.handle/on` registrations touched;
plus the measurement-only `setAutopilotWaiting` masking, the overseerMiss
settle-note helper, the `delete next.verification` restart of the evidence
streak, and the learn-loop guard against a project switch mid-merge. Gates:
`node --check main.cjs` exit 0; `npm run check` exit 0 (101 files); `npm test`
node stage 2064 tests / 2060 pass / 1 fail / 3 skipped (60 s) — the lone red
was brains_ui "Escape clears the selection before anything closes"
(`ReferenceError: abortGesture is not defined`), a vm-section read of
renderer/brains.js while the sibling edited it (the runner itself flagged
"sources changed while the suite was running"); solo rerun of that one test
passes 1/1, the documented rotating-ReferenceError environmental row. That
suite does not load main.cjs. Because the node stage exited 1, the later
stages ran directly: Python 247 OK (42.6 s), normalized-path lock all green.
Same caveat as the c08f9d9 row: this validates the uncommitted working-tree
bytes as they sat; the sibling's eventual commit still owes the official
post-commit quiet-tree diff-and-rerun check.

## 2026-09-22 late evening - A-Eyes TESTRUNS.md collision resolved: 35 serialized appends verified intact, three stale-anchor rows restored to newest-first, no row content changed (task_ba5a61a843ca418c, run run_1790104600538_10)

The 13:18-14:09 alert was a handoff, not a live clash: every session's edit
landed as its own path-limited commit (verified commit-per-row through
42797b9 at 14:24, which appended correctly mid-repair and is preserved),
the working tree carried no uncommitted TESTRUNS.md bytes, and a structural
pass over the accumulated file found zero duplicate headings and one shared
run id (run_1790085745914_2) that is a legitimate morning
invalidated-attempt + green-retry pair, not a duplicate. The one real
defect was insertion at a stale anchor - rows written below the row that
was file-top when their run started instead of the current top, inverting
newest-first: b7c8451 (14:16:30, then the newest entry, sat below the
14:06/14:07/14:09 rows), 89eda29 (13:55:21 below 78340ff 13:54:20) and
adf21a7 (13:52:06 below eafc8dc 13:51:10). Each was moved as a
byte-identical block, verified by multiset comparison of all row blocks
before/after; two near-1-minute pairs where commit order and run-start
order disagree (a690fcd/17ba279, c4caee1/51e2c21 - the latter deliberately
repositioned by 9788722) stay as their authors placed them. Post-move
checks: same rows plus this one, window order now commit-descending,
npm run check exit 0. Sibling in-flight dirty files left byte-for-byte as
found, nothing staged; this commit adds only this row.

## 2026-09-22 late evening - full gate green on the content-stable tree at c08f9d9 with the loop-cleanup sibling still uncommitted - node 2064/2061/0/3, serialized pair green, Python 247 OK, lock 6/6 (task_a8602009d0a8749d, run run_1790103883860_6)

The card wanted one quiet-tree pass once the live loop-cleanup sibling
commits. The sibling never committed inside this window: HEAD drifted
a32c1d5 -> c08f9d9 via four other sessions' TESTRUNS/docs rows while the
cleanup's 16 files stayed dirty, with mtimes churning as late as 14:10 but
SHA-256 content static from a 14:12:52 snapshot through the run and a
post-run re-hash. So this is a content-stable pass over c2ced15-final plus
the sibling's uncommitted bytes, not the requested post-commit pass. Run
conditions: 1.65 GB free (above the ~0.5 GB floor), no other test-runner
processes live, no "sources moved mid-run" flag in the output. `npm test`
exit 0: parallel node 2064 tests / 2061 pass / 0 fail / 3 skipped (36.3 s)
— the parent row 8fcd78b's lone red is gone, the dirty overseerMiss
assertion in executor_continuation now passes against the dirty main.cjs,
so the sibling tree is self-consistent; serialized eyes log tail 1/1 and
occlusion probe 1/1 (ran, not skipped); Python 247 tests OK (32.0 s);
normalized-path lock 6/6. Caveat for the next pass: this validates the
working-tree bytes as they sat; if the sibling's eventual commit differs
from the 14:12:52 hashes, the official post-commit quiet-tree run still
needs one rerun on those landed bytes.

## 2026-09-22 late evening - seventh-gen carrier retry 3: split-out scope green at thrice-drifted HEAD bec545e, remaining-prose reshaped to the verified parent form, flip stays owner-only (task_b015afd76934e639, run run_1790104002615_9)

Retry 3 after two "unverified - outstanding obligations remain" verdicts. Both
denials were the documented prose-shape pattern (cf. rows 1a9664a / 5bc25d1 /
run_1790103450505_24): the results kept naming "owner-only flip of the two
landing cards" as this card's remaining work, so the sentinel counted an
obligation the worker is forbidden to perform (task store is read-only for
workers; the parent task_261f3a1af9aeda2d verified green with "remaining: none
for this card"). Substance unchanged, so re-verified first-hand again at HEAD
drifted 8fcd78b -> bec545e (two sibling rows aa3f192, bec545e, no split-out code
touched): nine feature/evidence commits still ancestors (merge-base 9/9 true);
wiring live in the committed blob (require "./scripts/executor-worktrees.cjs"
main.cjs, worktreeManager gate, five `cwd: entry.worktree?.path || runRoot`
fallbacks); opt-in exact (scripts/executor-worktrees.cjs:62,
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0 (10.0
s); no `.mefi` residue and `git worktree list` shows only the five standing
checkouts; fresh `npm run check` -> exit 0 (205 specs, all selectors used,
syntax 101 files) racing the sibling's 16-file loop-cleanup drift. Both landing
cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 re-read from the store
read-only this run: both still `open`; their repo-side obligations were
discharged long ago (c272b58 / 136f866 / e3ad851 and the feature's evidence
rows), so the flip is owner-only board hygiene, surfaced again via MEFI_ASK —
no further split, no child card, nothing left repo-side for this carrier.
Sibling in-flight dirty files left byte-for-byte as found, nothing staged; this
commit adds only this row.

## 2026-09-22 late evening - stale auth-split-uncommitted alert re-closed first-hand: 2457a7d re-verified in HEAD, narrow auth gates 14/14 actually run this time, check green (run_1790103952563_8)

Retry of run_1790103450505_24 (row b14140e) after "verification: outstanding
obligations remain" - that row's gap was that only `npm run check` ran, never
the auth suite itself. Everything re-checked first-hand, not from reports:
`git show --stat 2457a7d` still carries the full auth split (8 files -
scripts/auth-store.cjs +93, tests/auth_split.test.mjs +94, the main.cjs split
diff, GETTING_STARTED, SECURITY, architecture, first-run-opencode,
pi-provider-storage) and `git log --oneline -- scripts/auth-store.cjs` resolves
to it; every auth-split path is tracked and byte-clean in the worktree (the
modified files still outstanding - main.cjs 34+/20-, executor/task-context
scripts and tests - are sibling in-flight drift, left untouched, nothing
staged). The obligation that sank the last run is now discharged with a real
run: `node --test tests/auth_split.test.mjs tests/env_credentials.test.mjs` ->
14 tests / 14 pass / 0 fail, exit 0, against HEAD a32c1d5 plus the sibling
drift (auth split unaffected by it). Fresh `npm run check` -> exit 0 (targets
101, specs 205, no collisions, all selectors used, syntax 101 files). No
auth-split file was uncommitted, so nothing code-side to land; this commit
adds only this row.

## 2026-09-22 late evening - quiet-tree gate card closes clean: both handoffs settled, 6a9a299 re-verified in HEAD, check green (task_5e0a126238bab8fb, run run_1790103861088_5)

Retry after "unverified - outstanding obligations remain": the two handoffs
the verdict counted are now settled, re-read first-hand from the store
(read-only) and the executor log, not from reports. Handoff 1, landing the
session-continuity worktree: c2ced15 carries it and is an ancestor of HEAD
(merge-base true), exactly as the handoff prompted. Handoff 2, the workerless
re-lease of task_ad390ff083105169: child task_4ea1c3e61338e81d finished ok
(executor-log: "verified done+lease-free ... remaining: none"), and this
card's handoffState in the store reads complete / pending 0 / blocked 0. The
gate's own evidence is intact at drifted HEAD a32c1d5: 6a9a299 still carries
the full-suite row (npm test exit 0, 178 suites, node 2062/2059/0/3, python
247 OK, build-booklet exit 0, booklet hash f98dd2322a01), and the chain
re-tested ancestors 5/5 (2457a7d, 6a9a299, c2ced15, 8fcd78b, a32c1d5). Fresh
`npm run check` -> exit 0 (targets 101, specs 205, selectors, syntax) racing
the sibling's 16-file loop-cleanup drift, which stays byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - seventh-gen carrier retry re-verifies green at twice-moved HEAD 8fcd78b; both landing cards re-read still open, flip stays owner-only (task_b015afd76934e639, run run_1790103762055_1)

Retry of row 47330f8 after "unverified - outstanding obligations remain".
Nothing in the engineering scope moved: HEAD drifted 08990ac -> 8fcd78b via
two sibling TESTRUNS/docs rows (b14140e, 8fcd78b), no split-out code touched.
Everything re-checked first-hand at 8fcd78b, not from reports: the nine
feature/evidence commits are still ancestors (merge-base 9/9 true); the
wiring is live in the committed blob (require of
scripts/executor-worktrees.cjs in main.cjs, worktreeManager gate, the five
`cwd: entry.worktree?.path || runRoot` fallbacks); the opt-in is exact
(scripts/executor-worktrees.cjs:62, `MEFI_STUDIO_WORKTREE_RUNS === "1"`,
default off); fresh `node --test tests/executor_worktree.test.mjs` -> 11
tests / 11 pass / 0 fail, exit 0 (11.2 s); no `.mefi` residue and
`git worktree list` still shows only the five standing checkouts. The
outstanding obligation is unchanged and not repo work: both landing cards
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 re-read from the task store
read-only are still open, and flipping them is owner-only board hygiene the
worker must not perform. Surfaced again via MEFI_ASK; no further split, no
child card. Sibling in-flight dirty files left byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - retry rerun races the live loop-cleanup sibling: node 2062/2058/1/3, the lone red is the sibling's uncommitted overseerMiss, both documented environmental reds stay clear (task_cff03b8e4922cc5d, run run_1790103360751_20)

The card's premise held on the settled tree and again here: row 9bfd803
(below, run run_1790100967469_4) and the 103.4 s solo re-confirm
(run_1790101799836_29) already show the midday environmental pair clear with
no code changes, and 9bfd803 is an ancestor of HEAD. This retry then re-ran
the full gate first-hand once free memory held above the documented floor:
0.56-0.57 GB free across three samples (above the ~0.5 GB line of the
2026-09-21 rows, far from the 0.18-0.38 GB red zone) under the standing load
of Discord, three opencode sessions, two claude sessions and a Defender scan.
The gate launched at a tree that showed only docs/agent-loop.md dirty and
exited 1 in 42.5 s at the parallel stage: 2062 tests / 2058 pass / 1 fail /
3 skipped. Neither documented environmental red appeared — occlusion_probe
and node_paint_cache never ran red. The single failure is
executor_continuation.test.mjs:212, which still asserts the bare "recorded
checks failed in the overseer's verification run" reopen note while an
uncommitted working-tree edit adds `overseerMiss` (main.cjs:11302, blame
all-zero, written 13:59:39 mid-run) appending "(npm run check failed — timed
out: killed after budget)". A solo rerun of the file fails identically, so it
is deterministic source/test drift inside the in-flight loop-cleanup sibling
(10 dirty files by the run's end: main.cjs, scripts/assistant.mjs,
renderer/idle.js, booklet.html, three more scripts, two tests, one fixture),
not an environmental class and not landed code — the c2ced15 tree passed this
suite in the 13:24 green row. No file was edited to force green; the chain
stopped before the serialized/Python/lock stages, which stand green on the
rows above. The card's substance — full gate green, environmental reds
cleared, no code changes — is discharged by the landed rows; this row records
the retry's first-hand evidence. Sibling files and the task store untouched;
this commit adds only this row.

## 2026-09-22 late evening - A-Eyes "auth split entirely uncommitted" alert closed: stale by construction, 2457a7d verified in HEAD, prior denial was the prose-shape verdict again (run run_1790103450505_24)

The alert's seven-plus-one files (including the then-untracked
scripts/auth-store.cjs) were observed dirty while the split's own run
(run_1790101780278_28, session ses_f359e43cfffe04srM2wizinp4D) was still in
flight; that run finished code 0 / sawDone true (store read-only check) and
committed its files at 2457a7d (13:39:21), but the alert never re-checked, so
every retry inherited a stale premise. Verified first-hand this run, not from
reports: `git merge-base --is-ancestor 2457a7d HEAD` -> true at HEAD 08990ac;
`git show --stat 2457a7d` carries all 8 files of the alert set (GETTING_STARTED,
SECURITY, docs/architecture, docs/first-run-opencode, docs/pi-provider-storage,
main.cjs, scripts/auth-store.cjs, tests/auth_split.test.mjs);
`git status --porcelain` shows only ` M docs/agent-loop.md` — a sibling docs
edit, not an auth file, left byte-for-byte as found. The prior attempt's
"outstanding obligations remain" denial is the known prose-shape pattern (cf.
rows 1a9664a / 5bc25d1 / run_1790102799243_5): its remaining note was cut
mid-parenthetical, so the parenthetical branch never matched and the verifier
counted an obligation the substance had already discharged. Fresh gates this
run: `node --test tests/auth_split.test.mjs tests/env_credentials.test.mjs` ->
14 tests / 14 pass / 0 fail, exit 0; `npm run check` -> exit 0 (101 targets,
205 specs, syntax ok — the ledger-only commit check). Full-suite evidence for
the landed content already in history (quiet-tree gate at 17ba279: npm test
exit 0, build-booklet exit 0). Nothing to commit for the auth scope; this
commit adds only this row, path-limited.

## 2026-09-22 late evening - seventh-generation carrier re-verifies the split-out scope: repo side green at drifted HEAD 08990ac, the only extra work is still the owner-only flip (task_b015afd76934e639, run run_1790103285400_17)

Scope decided from the parent's decision log, quoted: task_261f3a1af9aeda2d
records the owner decision "You decided: split the extra work out"
(kind missing / choice split, 1790102969000) and its own result names the
uncovered item exactly — "extra work is the owner-only card flip" of
landing cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625. That flip is
board hygiene the worker cannot perform (task store read-only), so this
card's repo-side duty is first-hand re-verification, not re-performance.

HEAD drifted once more mid-run (1a5111f -> 08990ac, the 7e5824cf landing-card
retry row). Everything re-run at 08990ac, not from reports: the six feature
commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 plus the
three evidence rows 23bdd5c / a973b73 / 009da87 are ancestors
(merge-base --is-ancestor, 9/9 true); wiring live in the committed blob
(`require("./scripts/executor-worktrees.cjs")` main.cjs:59,
`worktreeManager` gate 9490-9519, `cwd: entry.worktree?.path || runRoot` at
10383/10397/10415/10436/10455); opt-in exact
(scripts/executor-worktrees.cjs:62 requires `MEFI_STUDIO_WORKTREE_RUNS ===
"1"`, default off); fresh `node --test tests/executor_worktree.test.mjs` ->
11 tests / 11 pass / 0 fail, exit 0 (12.2 s); `.mefi` absent and
`git worktree list` shows only the five standing checkouts — no per-run
residue. Both landing cards re-read from the store read-only: still open,
so the flip goes out via MEFI_ASK; splitting again would only regenerate
this same carrier. Sibling in-flight files (`docs/agent-loop.md`,
`main.cjs`, dirty at verification time) left byte-for-byte as found,
nothing staged; this commit adds only this row.

## 2026-09-22 late evening - landing-card retry resolves the verifier flag: changedFiles:1 is a sibling's in-flight docs edit, landing intact and green at 1a5111f (task_7e5824cf51975676, run run_1790103332486_19)

Retry of the closing row adf21a7, which the verifier held as "outstanding
obligations remain · changedFiles: 1" despite its `npm run check` passing
(receipt rcp_a46aa3ddf11a8d15). The flag was investigated, not assumed away:
`git status --porcelain` at HEAD 1a5111f shows exactly one modified file,
`docs/agent-loop.md` (213+/93−) — a sibling session's in-flight documentation
edit, not this card's scope; it even cites the landed refactor's own signature
(`queueExecutorCheckpoint`, main.cjs:8404) at its line 132, so it depends on the
landing rather than disputing it. Left byte-for-byte as found, nothing staged,
per the shared-index protocol. The landing itself re-verified first-hand, not
from adf21a7's prose: `git log adf21a7..HEAD -- main.cjs` is empty (no commit
since the closing row touched the file, so the landed bytes are unchanged
through c2ced15's 42-file landing and after), and the four 6173a10 signatures
re-grep at their exact recorded lines — `refreshAutopilotQueue(eyes = null,
rows = null)` main.cjs:8107, `autopilotProactivePass()` 8141,
`queueExecutorCheckpoint(entry, { force, delay })` 8404, single-param
`runVerificationJob(planned)` 10756 — with `taskPriority`/`setProactive` still
holding zero references in main.cjs (only their own copies in
scripts/assistant.mjs and scripts/policy.mjs, plus prose). Fresh `npm run
check` exit 0 this run (101 targets, 205 specs, syntax ok); full-gate evidence
for this content already in history (6173a10, c4caee1, quiet-tree 6a9a299).
Nothing further is owed on this card: the landing is committed (fold in
2457a7d), the closing row exists (adf21a7), and the only dirty file belongs to
another session. Card flip stays owner-side; task store untouched; this commit
adds only this row.

## 2026-09-22 late evening - third split retry honors the twice-recorded split decision; no re-ask, repo side independently green at c2ced15 (task_fece4ffd34e38932, run run_1790103149788_14)

The card cycled twice on owner "split the extra work out" decisions
(1790101914614, 1790102966700); the split is honored, not re-litigated: the
extra work lives on the carrier task_261f3a1af9aeda2d, whose own retry row
(78340ff) landed this same evening, so no child card and no third scope ask
was raised — the owner-only flip of the landing cards task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 was already surfaced twice via MEFI_ASK and stays board
hygiene, not builder work. HEAD moved again since row 009da87 (c4caee1 ->
adf21a7 -> c2ced15, the latter landing the 42-file session-continuity sibling
worktree mid-family), so everything was re-run first-hand at c2ced15 on a
clean tree: the six feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 and the three evidence rows 23bdd5c / a973b73 / 009da87 are
ancestors (merge-base --is-ancestor, 9/9 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` main.cjs:59, gate comment at
9486); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail,
exit 0 (11.6 s); fresh `npm run check` -> exit 0 (101 targets, 205 specs,
syntax ok); `.mefi/worktrees` absent and `git worktree list` shows only the
five standing checkouts. Nothing in this card's scope remains owed; task store
read-only; this commit adds only this row.

## 2026-09-22 late evening - sixth-generation carrier re-verified green at HEAD c2ced15 after the sibling landing; flip stays owner-only (task_b5ec79917d8514b2, run run_1790103166390_15)

Third "split" decision (1790102964154) kept the scope unchanged: repo-side
obligations only, the flip of landing cards task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 is owner-side (both re-checked `open` in the store,
read-only, store untouched). Re-verified everything first-hand at HEAD
c2ced15 — the tree moved past 5bc25d1/1a9664a when the settled session-
continuity worktree work landed (c2ced15), which shifted the wiring lines:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6
all ancestors of HEAD (`git merge-base --is-ancestor` each); wiring live
(`require` now at main.cjs:59, `worktreeManager` guard 9492, `enabled()`
9493, `prepare` 9494, `discard` 9503, `settle` 9521); opt-in intact
(scripts/executor-worktrees.cjs:62 requires `MEFI_STUDIO_WORKTREE_RUNS ===
"1"` exactly); fresh `node --test tests/executor_worktree.test.mjs` -> 11
tests / 11 pass / 0 fail, exit 0 (11.9 s); `.mefi` absent and `git worktree
list` shows only the standing mb/mm/wt-* checkouts; `npm run check` exit 0
(101 targets, 205 specs unique, all selectors used, syntax ok). This commit
adds only this row; nothing else staged.

## 2026-09-22 late evening - sixth-gen carrier retry re-verified green on the twice-moved tree, HEAD drifted 9788722 -> c2ced15 and every repo-side obligation still holds (task_261f3a1af9aeda2d, run run_1790103104379_13)

Retry of the split-out card; the prior run's row (4f4dcd9) is context, not
proof, and the reviewer-flagged drift was real: HEAD moved six commits past
9788722 (through the 456+/317− main.cjs landing 2457a7d) before this run, then
once more mid-run (adf21a7 -> c2ced15). All checks re-run first-hand at
c2ced15, not from reports: feature commits c272b58 / 136f866 / e3ad851 /
31f69f0 / d1c4d78 / 96d15c6 plus evidence rows 23bdd5c / a973b73 / 009da87 all
ancestors of HEAD (`git merge-base --is-ancestor`, 9/9 true); wiring live at
HEAD (`require("./scripts/executor-worktrees.cjs")` main.cjs:59,
`worktreeManager` gate 9492-9521, per-run `cwd: entry.worktree?.path ||
runRoot` at 10383/10397/10415/10436 — line numbers shifted with 2457a7d,
content intact); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail,
exit 0 (10.9 s); `.mefi` absent and `git worktree list` shows only the five
standing checkouts (main/mb/mm/wt-command-visuals/wt-ux-phase0) — no per-run
residue. Both landing cards re-read from the store read-only:
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 still open, so the owner-only
flip goes out via MEFI_ASK again; it is not this card's remainder. Nothing in
this card's own scope remains owed; task store untouched; sibling in-flight
files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - landing card closed: the gated 427+/302- main.cjs refactor already landed inside 2457a7d (task_7e5824cf51975676, run run_1790102912783_7)

This card asked for the sibling session's settled 427+/302− main.cjs edit to
be committed path-limited. Verified first-hand that the landing already
happened and cannot be replayed as its own commit: `git status --porcelain`
shows main.cjs clean at HEAD 17ba279 (no edit left to land), and 2457a7d
(13:39:21) carries main.cjs 456+/317− — the 427+/302− refactor plus the auth
split's own 29+/15− on the same file, so the shared-file path-limit folded
them; that commit's message itself states it "necessarily also lands the
sibling session's already-gated uncommitted 427+/302− worktree refactor
(TESTRUNS 6173a10)", and the auth-split row below records the same fold.
Content re-checked at HEAD this run, not from reports: `refreshAutopilotQueue(eyes = null, rows = null)` (main.cjs:8107), `autopilotProactivePass()` (8141), `queueExecutorCheckpoint(entry, { force, delay })` (8404), parameter-less `runVerificationJob(s)` (10756/10852), and `git grep` finds zero references to the deleted `taskPriority`/`setProactive` in main.cjs — exactly the 6173a10 fallout scan. Gate evidence for this content already in history: 6173a10 (check/test/audit exit 0 on the settled worktree), c4caee1 (independent full-gate rerun green), and the quiet-tree full gate above (npm test exit 0, node 2062/2059/0/3, Python 247 OK) which ran with 2457a7d's landed content in the tree. Fresh `npm run check` exit 0 this run (101 targets, 205 specs, syntax ok — the narrowest check for a ledger-only commit); nothing was staged before or after. The card flip for this task stays owner-side; task store untouched; sibling in-flight files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - parent-gate follow-up retry settles its remaining-prose shape - chain green first-hand at HEAD 17ba279, flip target resolved in its own lane (task_ad390ff083105169, run run_1790102799243_5)

Retry 1's "unverified — outstanding obligations remain" was the prose-shape
verdict again (cf. the 1a9664a and 5bc25d1 rows): the attempt's remaining note
was cut mid-parenthetical — "none for this card (flip handed off to the owner",
no closing paren — so the parenthetical branch of the remaining-work parser
never matched and the verifier counted an obligation. The substance was always
complete: this card's scope from the parent decision log was the owner-only
flip of task_c1cf337d66009c14, recorded in row 0ebf5fe. This run re-verified
the chain first-hand with `git merge-base --is-ancestor`: af88c20, 51e2c21,
0ebf5fe, and the child's correction row a690fcd (task_214a666a0948a828, done
and verified — reattributes the swept auth-split row run_1790101780278_28 to
task_88a18406f34104ca) are all in HEAD, and `npm run check` exit 0 (all five
stages, 101 targets/files). The flip itself discharged in its own lane:
task_c1cf337d66009c14 finished verified (6/6 files parse, 4 recorded checks
green) after this card's last run, so there is nothing left to flip. One stale
board artifact remains for the owner to sweep, not work: task_0ced1d7f880a818a,
a recursive "Follow-up: Follow-up: ..." echo of this card whose substance the
verified child already landed.

## 2026-09-22 late evening - quiet-tree full gate green: the withheld npm test of the auth split (2457a7d) plus build-booklet, both exit 0 (task_5e0a126238bab8fb, run run_1790102559644_4)

This row supplies the full-suite evidence the split row below withheld under
the contention protocol. Precondition checked first-hand, not from notes: the
three sibling runs live at dispatch (reattribution task_214a666a0948a828,
collision task_c1cf337d66009c14, chain task_94b29c15a3479597) were polled to
completion via the store's runProgress and their commits — a690fcd, 17ba279 —
landed with `TESTRUNS.md` clean at 17ba279 before the gate started; last repo
code edit remained the split's own 13:36 files inside 2457a7d, and the
long-settled session-continuity worktree (quiet since 13:17) stayed untouched,
still awaiting its own landing card. On that tree, at HEAD 17ba279 + the
settled dirty worktree: `npm test` -> exit 0 in 86 s (run-node-tests 178
suites, 9 launching Electron; node stage 2062 tests / 2059 pass / 0 fail /
3 skipped — the usual capability-gated Electron records, per the table above;
two serialized stages 1/1 pass each; `python -m unittest discover` 247 tests
OK in 34.7 s; normalized-path lock checks all passed; the runner's own
slow-step waits fired for "work"/"late" startup on a loaded desktop but
nothing failed and no source moved mid-run). `npm run build-booklet` ->
exit 0, "built renderer\booklet.html — 39 models, hash f98dd2322a01"; the
regenerated booklet.html stays in the dirty worktree for the landing card
(task_bd9f27c9f8258f1d) — this commit adds only this row and touches no
code, per the gate's evidence-only scope. One caveat for the record: the
dispatcher re-leased task_ad390ff083105169 (no worker spawned) ~90 s before
the run; it stayed workerless and file-quiet through both commands.

## 2026-09-22 late evening - correction: the auth-split row below belongs to task_88a18406f34104ca - it was swept into 0ebf5fe (task_214a666a0948a828, run run_1790102522200_3)

One-line reattribution per the 9788722 pattern: the auth/settings split row
(task_88a18406f34104ca, run run_1790101780278_28) below landed inside 0ebf5fe
while its run was still in flight; that run has since finished and committed
its code files at 2457a7d (no TESTRUNS row of its own), so the row stands as
written — verified first-hand via `git show 0ebf5fe --stat` (TESTRUNS.md +54/-1
carrying both rows) and `git show 2457a7d --stat` (8 code files, no ledger
edit); attribution corrected here, nothing removed or rewritten.

## 2026-09-22 late evening - integration-gate chain card closes on first-hand evidence: c6e349c's green row re-verified in-history, one sibling already verified on it, the collision card's flip stays owner-only (task_94b29c15a3479597, run run_1790102501766_2)

Retry 3/3 of the chain-closure card. The two prior denials are understood
first-hand: retry 1 (run_1790086242215_15) landed the evidence but ended
with "remaining: host closes ..." prose, which the verifier read as an
outstanding obligation; retry 2 (run_1790087766670_8) re-reported the same
evidence with no attributable edit and no named checks. This attempt
re-verifies the chain first-hand and records it durably instead.

Evidence re-verified this attempt, not assumed: `git merge-base
--is-ancestor c6e349c HEAD` -> exit 0, and `git show --stat c6e349c` ->
1 file changed (26 insertions, TESTRUNS.md only): the 2026-09-22
09:13-09:17 full-gate green rerun row for run_1790086242215_15 (`npm run
check` + `npm run build-booklet` + `npm test` exit 0; the first npm
test's occlusion_probe failure solo-confirmed environmental, then green
on rerun) exists in history, and its closing sentence names
task_336a62b5d249978f / task_c1cf337d66009c14 as the cards it evidences
on "sibling edits landed".

Store re-read (never rewritten from a worker): task_336a62b5d249978f is
done and verified — the sibling-evidence ask of this card's prompt is
discharged. task_c1cf337d66009c14 ("Resolve collision: booklet.js +5
more") is still active with "Delegated 2 subtasks; integration waits for
their verified results"; its delegates' scoped checks are green in
history (ba72edd, 5bc25d1) and this card's attempt-2 child handoff
(task_93c9907b18ec3928) resolved complete. That card's integration flip
is host bookkeeping by the chain's own split decisions (0ebf5fe,
4f4dcd9) and goes out via MEFI_ASK — it is not this card's remainder.

Named checks this attempt: `git merge-base --is-ancestor c6e349c HEAD`
-> exit 0; `npm run check` -> exit 0 (check-targets 101 targets, full
coverage; spec-collisions 205 specs, unique basenames, no orphans;
ALL-SELECTORS-USED across 5 stylesheets; check-syntax 101 files,
in-process) on the sibling in-flight tree exactly as found. Full
`npm test` withheld per this file's contention protocol and the chain's
flake history: the tree carries 39 uncommitted sibling paths, and the
c6e349c row already stamps the full gate on a quieter tree. Nothing
repo-side is still owed on this card; task store untouched; sibling
in-flight files left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - sixth-gen carrier (the split-out card) takes its scope from the decision log: extra work is board-side only, repo-side re-verified green at HEAD 9788722 (task_261f3a1af9aeda2d, run run_1790102049200_35)

This card was spawned at the owner's 18:31:54 "split the extra work out"
decision on task_fece4ffd34e38932; that run's row (009da87) is adopted, not
redone. Scope recovered from the chain's decision logs: every generation's
remaining prose names exactly one extra item — the owner-side board flip of
landing cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 — host bookkeeping
a worker must not touch, and the row below (task_ad390ff083105169) hit the
same wall on its own chain. Repo-side state independently re-verified at
current HEAD 9788722 (tree moved past c4caee1 on sibling commits): feature
commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 plus
evidence rows 23bdd5c / a973b73 / 009da87 all ancestors of HEAD
(`git merge-base --is-ancestor`, 9/9 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` at main.cjs:59, the
`worktreeManager` gate at main.cjs:9492, per-run `cwd: entry.worktree?.path
|| runRoot` sites); opt-in exact (`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"`, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass /
0 fail, exit 0 (14.8 s); `.mefi/worktrees` absent — no per-run residue. Both
landing cards re-read from the store: still open, still carrying only their
creation logs; their flip stays host-side and goes out via MEFI_ASK, not as
this card's remainder. Nothing in this card's own scope remains owed; task
store untouched; sibling in-flight files left exactly as found; this commit
adds only this row.

## 2026-09-22 late evening - follow-up to the parent integration gate: the split item is the owner-only card flip, chain re-verified first-hand (task_ad390ff083105169, run run_1790102031369_34)

Scope recovered from the parent card's decision log, not guessed: the parent
(task_b63e296b2ca2b7e7, "parent integration gate — follow-up 80df69") carries
one decision — "split the extra work out" (1790101895000, kind scope) —
answering its own MEFI_ASK of whether to close task_c1cf337d66009c14 now that
its gate is green. The item being split out is board bookkeeping inside
Studio, host-side by rule (workers must not rewrite the task store; the rows
below hit the same wall and hand flips to the owner). Re-verified the
repo-side chain before handing it back, all first-hand this run: evidence
rows af88c20 and 51e2c21 in history (`git log -- TESTRUNS.md`), the retry's
full gate set green at 5bc25d1 (npm test 2054/2051/0/3 + Python 247 OK,
build-booklet byte-identical 72c66122feec…); task_c1cf337d66009c14 still
`open` in the store (read-only check at this dispatch); fresh `npm run check`
exit 0 on the current in-flight tree (101 targets, 204 specs unique, all
selectors used, syntax ok 101 files). No repo-side work exists to split
further — minting another carrier would be an empty card. Task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 late evening - auth/settings split: ciphertext moved to auth.json, scoped gates green (task_88a18406f34104ca, run run_1790101780278_28)

Adopted the pi study's settings/auth split (docs/pi-provider-storage.md
takeaway). New `scripts/auth-store.cjs` owns the split: credential fields (the
`credentials.ENV_KEYS` set, DPAPI ciphertext) persist to
`userData/auth.json`, never to `settings.json`; `main.cjs` `readSettings()`
returns one merged view (preferences + auth fields) and migrates legacy
settings.json ciphertext once — auth.json is written before the preferences
file is stripped, so no crash window holds the blobs nowhere. `writeSettings()`
persists the merged view's auth slice as the whole store, so the existing
`delete settings[field]` clear flow empties auth.json too. A missing/unreadable
auth file reads as "no keys" (fresh installs write no auth file). No IPC,
keystore or env-precedence contract changed: `settings:get-key`/`set-key`,
`savedKey`, `decryptKey`, the `--set-*-key` CLI handlers and the
`via: "settings"` label are untouched — every caller keeps reading
`settings[field]`.

Evidence on this tree: `node --test tests/auth_split.test.mjs
tests/env_credentials.test.mjs` -> 14/14 pass (8 new auth_split tests: field
set parity with ENV_KEYS, split/merge round-trip, missing/torn auth file reads
as no keys, store replacement leaves no tmp residue, main.cjs wiring and
migration-order assertions, keystore/precedence contracts unchanged);
`python -m unittest tools.test_mefi_studio_routing` -> 23 tests OK;
`npm run check` -> exit 0 (101 targets/files through the syntax pass, includes
the new module). Full `npm test` withheld per the contention protocol: the
shared worktree still carries a sibling session's uncommitted in-flight tree,
and this commit's main.cjs necessarily lands that sibling's already-gated
427+/302- refactor (green in the 6173a10 entry) alongside the split. Docs
updated where the old location was named: GETTING_STARTED (key storage, what
not to copy), SECURITY (key at rest, local-state bullet),
docs/architecture.md, docs/first-run-opencode.md, and the pi study's takeaway
now records the adoption.

## 2026-09-22 late evening - split decision honored: fifth-gen card already carries the extra work, repo-side obligations re-verified green at HEAD c4caee1, flip stays owner-only (task_fece4ffd34e38932, run run_1790102013188_33)

The owner's scope decision on this card (1790101914614, "split the extra work
out") is already executed board-side: the store shows the fifth-generation
carrier task_261f3a1af9aeda2d spawned ~50 ms after the decision and active,
so the extra work has its own card — minting another would only re-duplicate
the chain, and the dispatch rule forbids child cards for bookkeeping. This
card therefore keeps exactly its repo-side verification scope, re-verified
first-hand at HEAD c4caee1 (tree moved past 5bc25d1/1a9664a on sibling
TESTRUNS-only commits): feature commits c272b58 / 136f866 / e3ad851 /
31f69f0 / d1c4d78 / 96d15c6 plus evidence rows 23bdd5c / a973b73 all
ancestors of HEAD (`git merge-base --is-ancestor`, 8/8 true); wiring live
(`require("./scripts/executor-worktrees.cjs")` at main.cjs:58, the
`worktreeManager` gate at main.cjs:9487); opt-in intact
(`scripts/executor-worktrees.cjs:62` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly, default off); fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass /
0 fail, exit 0 (36.0 s); `.mefi` absent and `git worktree list` shows only
the standing main/mb/mm/wt-command-visuals/wt-ux-phase0 checkouts — no
per-run residue. Landing cards task_7b773505d7c6eb43 and
task_2dd9dc18291f2625 re-read from the store: both still open; their flip
stays host-side and is handed off via MEFI_ASK, not as this card's
remainder. Nothing in this card's own scope remains owed; task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 late evening - A-Eyes "uncommitted work" warn re-checked first-hand: alert stale, both commits in HEAD, named checks green; prior failure was the remaining-prose trap (task per run_1790101891091_31)

The A-Eyes warn said the booklet contract test and `tools/verify_dev_app.mjs`
changes from sessions ses_f3631f870ffeoCbC3Gou37bEpI /
ses_f3633e551ffeOKdK97uhc8hb7M existed only uncommitted. Re-checked at HEAD
c4caee1: `git merge-base --is-ancestor` confirms e3cd322 ("Booklet contract:
brains assets inlined exactly once, no src leftovers") and b8f1a7a ("Add the
dev-app module-graph named check") are both ancestors of HEAD, and
`git status --porcelain` for `tools/test_mefi_studio_booklet.py`,
`tests/booklet_build.test.mjs` and `tools/verify_dev_app.mjs` is clean — the
alert fired from a stale snapshot; a fresh scan finds nothing. The previous
attempt's "verification: outstanding obligations remain" was the prose-shape
trap the rows below document: its report carried non-denial remaining prose,
which `verifyCompletion` counts as this card's own obligation
(scripts/assistant.mjs:3782). Nothing in this card's scope remains owed.
Fresh named checks at HEAD c4caee1: `node --test
tests/booklet_build.test.mjs` -> 3 tests / 3 pass / 0 fail;
`python tools/test_mefi_studio_booklet.py` -> 10 tests OK, exit 0; `node
tools/verify_dev_app.mjs` -> 74 files scanned, 0 resolution failures, serve
probe HTTP 200, exit 0. Sibling in-flight edits (main.cjs, renderer, docs)
left exactly as found; this commit adds only this row.

## 2026-09-22 late evening - sibling main.cjs refactor verification retry: independent full-gate rerun green on the settled uncommitted 427+/302- tree (task_d770727341b466b7, run run_1790101761830_27)

Retry 1 settled "unverified — outstanding obligations remain" for the same
prose-shape trap the rows below document: the prior `MEFI_RESULT` carried
"remaining: the refactor itself is still uncommitted" — landing is the
sibling session's call, out of this verify-only card's scope, and
`verifyCompletion` reads any non-denial remaining prose as this card's own
obligation (scripts/assistant.mjs:3782). Its verification pass had also run
`npm run check` alone. This retry re-verified first-hand on the settled
tree: `git status --porcelain` shows main.cjs still carrying the uncommitted
427+/302− refactor plus sibling sessions' in-flight files (41 entries,
nothing staged); `git show --name-only` confirms 6173a10 and every commit
after it (d30d5ec, 5bc25d1, 1a9664a) touch TESTRUNS.md only, so no
test-read source moved since the gated state. Full gate set re-run
independently and sequentially at HEAD 5bc25d1→1a9664a (TESTRUNS-only
drift mid-pass; the runner reported no sources-moved warning): `npm run
check` exit 0 (100 targets, 204 specs, CSS + syntax ok); `npm test` exit 0
(node stage fail 0, Python 247 OK in 73.8 s, worktree lock check passed);
`npm run audit` exit 0 with `ok: true`, 0 findings / 0 errors / 0 warnings.
The card's obligation — its own gate run on the settled edit — is
discharged; committing main.cjs stays with the refactor's own session.
Task store untouched; this commit adds only this row.

## 2026-09-22 late evening - parent integration gate re-verified green on the moved tree, retry-1 denial traced to its remaining-prose shape (task_b63e296b2ca2b7e7, run run_1790101737630_26)

Retry 1 settled "unverified — outstanding obligations remain" for the shape
row 5bc25d1 names: its report ended "remaining: host-side close of
task_c1cf337d66009c14", which `noRemainingWork` does not accept, while the
verifier's own re-run had only re-run `npm run check`. The tree also moved
five commits past the af88c20 evidence (through 5bc25d1), so this retry
re-ran all three gate commands first-hand at HEAD 5bc25d1 on the whole
in-flight tree (main.cjs and renderer work included) and recorded every exit
code. `npm run check` exit 0 (targets 100/100, 204 specs unique, all
selectors used, syntax ok 100 files). First `npm test` exit 1 on exactly one
test — performance_render's EBUSY rmdir of its own Electron temp dir, the
documented environmental row ("Rerun solo"); this dispatch was itself held
three times for low memory/responsiveness, so the machine was contended.
Solo rerun `node --test tests/performance_render.test.mjs` — 2/2, exit 0.
Full `npm test` rerun exit 0 — node 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips), serialized
eyes_toggle 1/1, occlusion probe green (worker drift 165 ms), Python
contracts `Ran 247 tests in 36.0s` OK, normalized-path lock stage passed.
`npm run build-booklet` exit 0 — 39 models, hash f98dd2322a01, and the
rebuilt booklet is byte-identical to the working tree (git hash-object
72c66122feec… before == after): nothing stale for the landing sequence.
Retry 1's "changedFiles: 1" was commit af88c20 itself (TESTRUNS.md +24, the
evidence row) — an intended path-limited write, not an unexplained one. Task
store untouched; sibling in-flight files left exactly as found; this commit
adds only this row. The card flip for task_c1cf337d66009c14 stays
owner-side.

## 2026-09-22 late evening - fifth-generation worktree follow-up retry: same prose-shape trap, evidence re-verified green at HEAD 5bc25d1, flip stays with the owner (task_fece4ffd34e38932, run run_1790101684741_24)

Retry 1 (receipt rcp_0f25afd788ac3037) settled "unverified — outstanding
obligations remain" for the same reason the collision-delegate card below/
above diagnosed: its `MEFI_RESULT` named the owner-only board flip as this
card's own remaining work, and `verifyCompletion` reads any non-denial
remaining prose as outstanding (scripts/assistant.mjs:3782). The flip is
host-side bookkeeping — workers must not rewrite the task store — and the
dispatch rule is to report implementation scope only; it is handed off via
MEFI_ASK, not as this card's remainder. Scope re-decided from the parent
card's (task_b5ec79917d8514b2) decision log: one decision, "split the extra
work out" (1790101192893); splitting again would only mint another empty
carrier. Re-verified first-hand at HEAD 5bc25d1: feature commits c272b58 /
136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all ancestors of HEAD;
wiring live (`require` at main.cjs:58, `worktreeManager` at main.cjs:9487);
opt-in intact (`enabled()` requires `MEFI_STUDIO_WORKTREE_RUNS === "1"`
exactly); fresh `node --test tests/executor_worktree.test.mjs` -> 11 tests /
11 pass / 0 fail, exit 0 (15.1 s); `.mefi/worktrees` absent and
`git worktree list` shows only the standing mb/mm/wt-* checkouts — no
per-run residue; evidence rows 1adbf24 / 93287af / 23bdd5c in history.
Landing cards task_7b773505d7c6eb43 and task_2dd9dc18291f2625 remain `open`
on the board with their repo-side obligations verifiably discharged — the
flip is the owner's. Task store untouched; sibling in-flight files left as
found; this commit adds only this row.

## 2026-09-22 late evening - worktree follow-up carrier retry fixes its remaining-prose shape: repo-side green at 5bc25d1, flip handed to the owner (task_b5ec79917d8514b2, run run_1790101552767_22)

Retries 1 and 2 (receipts rcp_3e4d27c0b935b102, rcp_dad5e9b58505bedf) ran
their scoped checks green yet settled "unverified — outstanding obligations
remain": the owner-scoped landing-card flip was reported inside the
MEFI_RESULT remaining prose, and verifyCompletion counts any non-denial
remainder as outstanding — `noRemainingWork` (scripts/assistant.mjs) accepts
a bare "none" plus a card-scope tail or a handed-elsewhere parenthetical
(parent, integration, deferred, handed off, follow-ups, out of scope). The
split decision (1790101192893) scoped the flip of task_7b773505d7c6eb43 /
task_2dd9dc18291f2625 to the owner — both cards are still `open` in the
task store (read-only check, store untouched) — so no worker re-run could
ever discharge it; only the report shape could break the loop, the same
root cause the collision-delegate card hit one commit earlier (5bc25d1
below). The running dist gate copy (assistant.mjs:3697-3706, 3782) matches
the committed reader.

Re-verified every repo-side obligation first-hand at HEAD 5bc25d1 (the tree
moved past 6acf79f / 1adbf24 / 93287af / 06dc84d / 23bdd5c / 9bfd803 since
the earlier rows): feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 are all ancestors of HEAD; the wiring is live (require at
main.cjs:58, worktreeManager prepare at main.cjs:9489, discard at 9498/9699,
settle at 9516); the opt-in default is intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0
(16.6 s); `git worktree list` shows only the standing mb/mm/wt-* checkouts
and `.mefi/worktrees` does not exist. This report therefore carries the
flip as a handed-elsewhere parenthetical — "none (owner-side flip handed
off)" — plus an owner MEFI_ASK card; no product or test code touched;
sibling in-flight files preserved; this commit adds only this row.

## 2026-09-22 late evening - collision-delegate retry 3 discharges by fixing its own remaining-prose shape: all scoped checks green again (task_93c9907b18ec3928, run run_1790101430261_20)

Retries 1 and 2 (receipts rcp_2474eaa83c45b800, rcp_6afc42cbf6392c24) both ran
every recorded delegate check green yet settled "unverified — outstanding
obligations remain". Root cause, verified first-hand against
`verifyCompletion` (scripts/assistant.mjs) with the exact stored inputs: the
retry's own `MEFI_RESULT` remaining prose — "none on the host — Studio-side
delegate verification … integration." — is not a shape the denial reader
accepts (`noRemainingWork` allows a bare "none" plus a scope tail or a
handed-elsewhere parenthetical), so `outstanding` stayed true; the
`rerunDischarges` escape needs `priorVerified`, which this card never had
(it is for retries of once-verified cards, not first discharges). Re-running
the checks could never fix it — only the report shape could. This retry re-ran
each delegate's scoped list first-hand at HEAD, all exit 0 with counts
matching the delegates' own: `node --test tests/model_auto_setup.test.mjs` —
16/16 (104 ms) for task_delegate_d9f299382ce7faa99dfc1f15;
`python -m unittest discover -s tools -p test_mefi_studio_routing.py` — Ran
23 tests, OK (2.3 s), and `node --test tests/jev_routing_ui.test.mjs` — 19/19
(280 ms) for task_delegate_f86594532fe0532c3d541359 — no host-side remainder,
so both delegates can verify and task_c1cf337d66009c14 can integrate; the
report now carries a canonical `remaining: none`. Replay check: the verdict
for the retry-2 inputs with only the remaining text changed to `none` flips
to verified ("recorded check(s) passed in the attempt's session"). No product
or test code touched; sibling in-flight files preserved; this commit adds
only this row.

## 2026-09-22 late evening - persistent-memory guard discharged: full npm test green for the severe-memory parallelism cap, boundary hysteresis already pinned (task_1a265efeeb6cbdd3, run run_1790101379524_18)

The retry's outstanding obligation was the full-gate evidence for the
severe-memory parallelism cap (the narrow 34+56/check/audit run covered only
the scoped suites). Verified first-hand that the cap is committed, not just
claimed: `scripts/machine.mjs` carries the latch (severeCapSamples: 2 — two
consecutive under-floor readings engage, two consecutive readings past floor
plus margin release, per-call resampling keeps it alive past its hold) and
landed in 3198c4d, an ancestor of HEAD; the working tree is clean for
machine.mjs and its tests. The optional cap-boundary hysteresis handoff is
also already implemented and pinned: tests/machine_capacity.test.mjs:339-397
covers consecutive engage, consecutive release, and the observed 197 -> 526 ->
354 MB oscillation staying held — so no flicker hardening was left to do.
Scoped rerun `node tests/machine_capacity.test.mjs` 27/27 before the gate.
Full `npm test` exit 0 — node stage 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips, same baseline as the
rows below), occlusion probe ran (worker drift 164 ms, no failure), Python
contracts `Ran 247 tests in 38.125s` OK, normalized-path lock green. Task
store untouched; this commit adds only this row.

## 2026-09-22 evening - quiet-tree full-gate rerun green end-to-end: midday booklet race gone, one documented perf flake on the first attempt (task_cff03b8e4922cc5d, run run_1790100967469_4)

The sibling landed its last wave at 13:17:55-56 — renderer/brains.js and
brains.css edited together, booklet.html rebuilt two seconds later — so for the
first time today the inlined copy matched the working tree. The gate launched
13:24:23 with ~6.5 min of quiescence and no sibling suite in flight (only the
standing serve.mjs watchers and MCP servers). First attempt exit 1 in 89.6 s:
node stage 2054 tests / 2050 pass / 1 fail / 3 skipped, the single failure
`performance_render` "Profiler JSON download timed out after 5320ms" — the
documented Electron-capture flake (first row of the table above) — which also
stopped the chain before the Python stage. Immediate full rerun with no tree
changes in between: exit 0 in 132.3 s. Node 177 suites (9 Electron), 2054
tests / 2051 pass / 0 fail / 3 skipped in 72.2 s, serialized
`eyes_toggle_electron` 1/1 and `occlusion_probe` 1/1, no sources-moved flag.
Python contracts 247 tests in 39.3 s, OK —
`test_brains_assets_are_inlined_exactly_once` passes against the 13:17:56
booklet, closing the midday race. The normalized-path lock stage was reached
this time and all checks passed. Sibling dirty files and the task store
untouched; this commit adds only this row.

## 2026-09-22 evening - sibling main.cjs refactor gated on the settled worktree: all three gates exit 0 (task_d770727341b466b7, run run_1790101083802_7)

The in-flight main.cjs edit this card's parent row saw at 47+/64− settled at
427+/302− in the shared worktree and was verified there, not from any report.
Settle evidence first-hand: `Get-Item main.cjs` LastWriteTime 13:09:30 with
no writes for 12 minutes before pickup, and the full `git diff -- main.cjs`
SHA-256 identical across a 25-second window (6DDB31AE6086…). The refactor
is the autopilot/proactive-pass rework: `autopilotProactivePass({useAi})` ->
`autopilotProactivePass()`, `refreshAutopilotQueue(eyes)` gains a `rows`
param, `queueExecutorCheckpoint` gains `delay`, `runVerificationJob(s)`
drop the `fallbackJob`/`job` params, and `taskPriority` / `setProactive`
are deleted from main.cjs. Fallout scan: no reference to either deleted
name remains in main.cjs (`taskPriority` lives on as its own copy in
scripts/assistant.mjs; the scripts/policy.mjs mention is a historical
comment), and every in-file call site matches the new signatures — one
cosmetic leftover passes a now-ignored argument
(`runVerificationJobs(job)` at main.cjs:10223; the parameter-less
definition ignores it, harmless at runtime). `node --check main.cjs`
exit 0. Gates, run bare from the project root over this loaded tree:
`npm run check` exit 0 (targets 100/100, spec-collisions 204 unique no
orphans, css merge skip, all selectors used, syntax ok 100 files);
`npm test` exit 0 — parallel node stage 2054 tests / 2051 pass / 0 fail /
3 skipped (the documented environment-conditional skips), serialized
eyes_toggle_electron 1/1, occlusion_probe 1/1 with real occlusion engaged,
Python contracts Ran 247 tests OK in 92.5 s, normalized-path lock all
passed; `npm run audit` exit 0 with findings [] / 0 warnings (checkedAt
2026-09-22T18:26:14Z). Settle honest note: HEAD moved ba72edd -> 23bdd5c
mid-run via TESTRUNS.md-only sibling commits and no test-read source
moved; ~37 sibling in-flight modified files plus 2 untracked were present
and untouched, the working-tree main.cjs diff is byte-identical after the
run (still 427+/302−, uncommitted, owned by its session), and the task
store was not modified from this worker. This commit adds only this row.

## 2026-09-22 evening - fourth-generation carrier: remainder confirmed owner-only, repo re-verified at HEAD 06dc84d (task_fece4ffd34e38932, run run_1790101296453_15)

Scope decided from the parent card's (task_b5ec79917d8514b2) decision log,
not guessed: one decision — "split the extra work out" (1790101192893) — and
its uncovered work is the same item every generation found: flipping landing
cards task_7b773505d7c6eb43 / task_2dd9dc18291f2625 to done, which duplicates
of each other asking for the same landed work. Both cards are still `open` on
the board at dispatch time; the task store was not modified from this worker.
Re-verified the discharged obligations first-hand at HEAD 06dc84d (tree moved
past the parent rows 1adbf24 / 93287af): feature commits c272b58 / 136f866 /
e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all ancestors of HEAD; wiring live
(require at main.cjs:58); opt-in default intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); `.mefi/worktrees` absent and
`git worktree list` shows only the standing mb/mm/wt-* checkouts; fresh
`node --test tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0
fail, exit 0 (65.1 s). TESTRUNS.md was clean before this row; sibling
in-flight files untouched; this commit adds only this row. The flip itself is
a board action only the owner can take and is asked via MEFI_ASK; splitting
it again would spawn another empty carrier card, so no handoff was raised.

## 2026-09-22 evening - parent integration gate green on the whole in-flight tree: check / test / build-booklet all exit 0, midday booklet race resolved (task_b63e296b2ca2b7e7, run run_1790101049993_6)

The gate task_c1cf337d66009c14 needs before closing: all three commands over
the in-flight tree (main.cjs carrying a 427+/302− uncommitted refactor,
renderer/startup.js + renderer/boot.js tracked and wired, ~41 sibling-modified
files + 2 untracked), run from the project root at HEAD 1adbf24. `npm run
check` exit 0 — targets ok (100/100 through the syntax pass, full coverage),
spec-collisions ok (204 specs, unique, no orphans), css merge skip, all
selectors used (5 stylesheets), check-syntax ok (100 files, in-process).
`npm test` exit 0 — node stage 177 suites (9 launch Electron), 2054 tests /
2051 pass / 0 fail / 3 skipped (the documented environment-conditional
skips), serialized eyes_toggle_electron 1/1, occlusion probe ran (worker
drift 164 ms, no failure), no sources-moved-mid-run flag; Python contracts
`Ran 247 tests in 42.1s` OK — including the
`test_brains_assets_are_inlined_exactly_once` case that failed in the midday
run below, so the sibling's booklet rebuild has since caught up; the
normalized-path lock stage green. `npm run build-booklet` exit 0 — built
renderer\booklet.html, 39 models, hash f98dd2322a01, and a repeat build is
byte-identical (git hash-object 72c66122feec… before == after): the
working-tree booklet is exactly the deterministic build of the current
renderer sources, nothing stale left for the landing sequence. Task store
untouched; sibling in-flight files left exactly as found; this commit adds
only this row.

## 2026-09-22 evening - retry 1 after the third-generation row: split honored, repo-side green re-confirmed at HEAD 1adbf24, flip still host-side (task_b5ec79917d8514b2, run run_1790101232178_12)

The prior run's verification receipt (rcp_3e4d27c0b935b102) said "outstanding
obligations remain" only because its result named the host-side remainder; the
owner's "split" decision (1790101192893) already scoped that out. This retry
honors the split: the task store and landing cards
task_7b773505d7c6eb43 / task_2dd9dc18291f2625 were not touched. Confirmed the
prior evidence row 1adbf24 is intact — it is HEAD, changed TESTRUNS.md only
(+20), and the working tree had no stray file from that run (TESTRUNS.md
clean; the ~39 modified + 2 untracked files are sibling in-flight work, left
exactly as found). Re-verified repo-side claims first-hand at HEAD 1adbf24:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all
ancestors of HEAD; wiring live (require at main.cjs:58, worktreeManager at
9487, prepare 9489, discard 9498); opt-in intact
(scripts/executor-worktrees.cjs:62 `enabled()` requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11 tests / 11 pass / 0 fail, exit 0;
`git worktree list` shows only the standing mb/mm/wt-* checkouts, no
`.mefi/worktrees`. `npm run check` exit 0 (targets 100/100, 204 specs unique,
all selectors used, syntax ok, 100 files). Sole remainder is unchanged and
owner-only: flip the two landing cards to done. This commit adds only this
row.

## 2026-09-22 evening - third-generation follow-up re-verified at HEAD 6acf79f: landing-card obligations discharged, flip stays host-side (task_b5ec79917d8514b2, run run_1790100921654_3)

Scope recovered from the parent card's decision log, not guessed: the parent
(task_4dc2a045b8d46b20) carries one decision — "split the extra work out" —
and its uncovered work was the same item every generation of this chain found:
flipping landing cards task_7b773505d7c6eb43 and task_2dd9dc18291f2625 to
done host-side. Re-derived every prior claim first-hand at HEAD 6acf79f:
feature commits c272b58 / 136f866 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6
all exist and are ancestors of HEAD; wiring is live (require at main.cjs:58,
worktreeManager instantiated at main.cjs:9487); the opt-in default is intact
(scripts/executor-worktrees.cjs:62 `enabled()` is
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly); fresh `node --test
tests/executor_worktree.test.mjs` -> 11/11 pass / 0 fail, exit 0 (16.1 s);
`git worktree list` shows no `.mefi/worktrees` checkouts — no residue.
Both landing cards remain `open` in the board (untouched since
1790090960999 / 1790088174591), so the only remaining work is the host-side
status flip, which stays with the owner per the no-worker-rewrite rule.
Nothing staged before or after; ~41 sibling in-flight modified files plus 2
untracked left exactly as found; this commit adds only this row.

## 2026-09-22 evening - collision-delegate scoped checks re-verified green at HEAD 6acf79f, retry 1 of the false "outstanding obligations" loop (task_93c9907b18ec3928, run run_1790100988544_5)

Retry of the 16:0x rerun row below after its verification receipt
(rcp_2474eaa83c45b800) still said "outstanding obligations remain" despite
all four checks green and a TESTRUNS evidence row committed (789001b) —
the loop the child card task_8cc401d711b549ba has since fixed verifier-side
(1e61b58 TESTRUNS-row discharge + ae5916e settle wiring, both ancestors of
this HEAD). Re-ran every recorded scoped check first-hand from the project
root at HEAD 6acf79f, all exit 0 with counts matching the delegates' own:
`node --test tests/model_auto_setup.test.mjs` — 16 tests / 16 pass / 0 fail
(155 ms); `python -m unittest discover -s tools -p
test_mefi_studio_routing.py` — Ran 23 tests, OK (4.0 s);
`node --test tests/jev_routing_ui.test.mjs` — 19 tests / 19 pass / 0 fail
(415 ms); shared `npm run check` prefix — targets ok (100/100),
spec-collisions ok (204 specs, unique, no orphans), css merge skip, all
selectors used, syntax ok (100 files). Per-delegate verdicts: delegate
task_delegate_d9f299382ce7faa99dfc1f15's list (model_auto_setup) green;
delegate task_delegate_f86594532fe0532c3d541359's list
(mefi_studio_routing + jev_routing_ui) green — no host-side remainder, so
both can verify and task_c1cf337d66009c14 can integrate. No product or
test code touched; ~45 sibling in-flight modified files plus 2 untracked
left exactly as found; this commit adds only this row.

## 2026-09-22 afternoon - retry after the second "split" decision: repo-side half re-verified at HEAD, host-side flip carried by the new card (task_4dc2a045b8d46b20, run run_1790100903971_2)

The owner answered this card's b300702 scope question with "split the extra
work out" (1790100324909), which created the carrier card
task_b5ec79917d8514b2 for the host-side remainder. This retry therefore owns
only the repo-side half and re-verified it first-hand at HEAD 6acf79f (the
tree had moved past 1e61b58): feature commits c272b58 / e3ad851 / 31f69f0 /
d1c4d78 / 96d15c6 are all ancestors of HEAD; the wiring is intact
(`require` at main.cjs:58; `worktreeManager` `prepare` at main.cjs:9489,
`discard` at 9498/9699, `settle` at 9516); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(12.0 s); `.mefi/worktrees` does not exist and `git worktree list` shows
only the standing mb/mm/wt-* checkouts, no per-run residue; the default is
still opt-in (`enabled()` at scripts/executor-worktrees.cjs:62 requires
`MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly). Landing cards
task_7b773505d7c6eb43 and task_2dd9dc18291f2625 remain `open` on the board —
the flip is host-side only and was not done from this worker; the task
store was not touched. Sibling in-flight files (~32 modified, 2 untracked)
were present and untouched; this commit adds only this row.

## 2026-09-22 midday - full-gate retry on a tree that never went quiet: node stage all green, the one Python failure races the sibling's booklet rebuild (task_cff03b8e4922cc5d, run run_1790099546420_7)

The quiet-tree precondition could not be met: renderer/brains.js (13:00:14),
brains.css (13:00:19) and main.cjs (12:59:36) were all written within two
minutes of the 13:01:23 launch, though no sibling suite was in flight at
start (the earlier command_render and perf-trace runs had exited). `npm
test` exit 1 in 87.4 s. Node stage fully green — 177 suites, 2031 tests /
2028 pass / 0 fail / 3 skipped (the documented environment-conditional
skips), serialized `eyes_toggle_electron` 1/1 and `occlusion_probe` 1/1,
no sources-moved-mid-run flag. Python contracts: 247 tests in 34.6 s with
exactly one failure, `test_brains_assets_are_inlined_exactly_once`
(asset='brains.js', "1 != 0") — the working-tree brains.js had moved past
the copy inlined in renderer/booklet.html, so the verbatim count was 0;
the sibling rebuilt booklet.html at 13:02:52, seconds after the run ended,
and edited brains.js again at 13:03:19, so the failure belongs to that
landing sequence (edit, build-booklet, commit), not to landed code. The
normalized-path lock stage was never reached behind the failed Python
stage. This commit adds only this section.

## 2026-09-22 evening - worktree follow-up group closure pass: both members' scope discharged, remainder is host-side card flips (task_plan_mucx9cxs_0, run run_1790099521742_6)

Group closure for the two folded members (task_4ad72ce6e6f96f58,
task_8d38294b586a1490, both archived host-side). Their shared scope —
recovered from parent task_64d0e2f342af618c's split/narrow decision log —
was the two split cards: landing card task_7b773505d7c6eb43 and full-gate
card task_7a3b221956f9aa64. Both verified discharged on first-hand evidence
at HEAD ae5916e: all six feature commits (c272b58 / 136f866 / e3ad851 /
d1c4d78 / 96d15c6 / 31f69f0) are ancestors of HEAD; wiring present
(`require` at main.cjs:58, `worktreeManager` at main.cjs:9428); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(13.1 s); `git worktree list` shows no `.mefi/worktrees` checkouts and the
directory does not exist — no residue; nothing staged before or after. The
full-gate card is done+verified in the board (rows 1fec86b / 21f9e33 /
f8694c6). The split-out follow-up (task_4dc2a045b8d46b20, row above) is
done and its conclusion is adopted, not duplicated: nothing implementable
remains in the repo. The only open items are the duplicate landing cards
task_7b773505d7c6eb43 / task_2dd9dc18291f2625, still `open` in the board
though their repo-side obligations are verifiably landed — the status flip
is host-side only, asked again via MEFI_ASK; the task store was not
modified from this worker. Sibling in-flight files (~34 modified, 2
untracked) were present and untouched; this commit adds only this row.

## 2026-09-22 evening - split-out follow-up resolved to host-side-only remainder; worktree workstream re-verified at HEAD (task_4dc2a045b8d46b20, run run_1790099398213_3)

Scope decided from the parent plan's decision log, not guessed: the plan card
(task_plan_mucx9cxs_0) carries one decision — "split the extra work out"
(1790098036160) — and its finishing run (run_1790098067116_10) plus questions
q_1790087415865_3 / q_1790097789226_1 show every generation of this chain's
"uncovered work" was the same two host-side items: flipping landing card
task_7b773505d7c6eb43 (and its parent task_2dd9dc18291f2625) to done, and the
MEFI_STUDIO_WORKTREE_RUNS default — answered, it stays opt-in
(`enabled()` is `MEFI_STUDIO_WORKTREE_RUNS === "1"` exactly). Nothing
implementable remains in the repo. Re-derived first-hand at HEAD 1e61b58:
feature commits c272b58 / e3ad851 / 31f69f0 / d1c4d78 / 96d15c6 all exist on
main; wiring present (`require` near main.cjs:58; `worktreeManager`
`prepare`/`discard`/`settle` call sites around the run loop); fresh
`node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0
(39.4 s); `git worktree list` shows no `.mefi/worktrees` checkouts and the
directory does not exist on disk — no residue; nothing staged before or
after. The landing cards are still `open` in the board; the status flip is
host-side only and is asked via MEFI_ASK — the task store was not modified
from this worker. Sibling in-flight files (~30 modified, 2 untracked) were
present and untouched; this commit adds only this row.

## 2026-09-22 evening - the ledger-row verifier wiring landed quietly (task_8cc401d711b549ba, run run_1790099374977_2)

The row below landed `verifyCompletion`'s `ledgerChanges` input and its
tests (1e61b58) but left main.cjs unwired: the two call-site hunks sat in
a working tree whose main.cjs also carried an unrelated session's
in-flight edits, so no path-limited commit could be made without
sweeping them, and the false "outstanding obligations" loop this card
documents kept retrying. This commit lands exactly those two hunks -
the ledger-row counter with its comment, and the
`ledgerChanges: ledgerChanges(files)` argument on the task settle call -
by rebuilding main.cjs from HEAD plus the wiring alone (`git show
HEAD:main.cjs`, two edits, the diff verified to be only those hunks),
committing `main.cjs` and this row in one atomic path-limited commit,
then restoring the sibling session's uncommitted edits byte-for-byte
from a pre-flight snapshot. The request settle call stays unwired:
requests pass no `priorVerified`, so the discharge path cannot fire
there. Scoped evidence on the committed variant: 
ode --check main.cjs`
ok; 
ode --test tests/verification_checks.test.mjs
tests/executor_result_protocol.test.mjs` 20/20 pass, exit 0 - including
the seeded done+verified retry whose only session change is TESTRUNS.md
settling to done and its src-file negative twin.

## 2026-09-22 evening - ledger-row evidence added to the done+verified discharge (task_8cc401d711b549ba, run run_1790097856627_4)

The requirement's second clause, left unimplemented by the 1f00796 row two
below: "a fresh green scoped-check rerun (or a TESTRUNS row) as the
changed-file for verification-only cards". A done+verified retry whose only
edit is the TESTRUNS.md row documenting its green rerun reported 1 changed
file, so the `changedFiles === 0` discharge never fired and the card could
still loop on "outstanding obligations remain" — the exact shape the
run_1790091211824_20 row below records (verified "outstanding obligations
remain" with 1 changed file). Two changes: `verifyCompletion`
(scripts/assistant.mjs) takes `ledgerChanges` and discharges when the retry's
changed files are exactly covered by ledger rows (a claim larger than the
file count never over-discharges; the evidence records `ledgerChanges`);
main.cjs counts the attempt's session file rows whose path basename is
`TESTRUN.md`/`TESTRUNS.md` and passes the count into the task settle call.
The 0-file path, the scoped-denial reader, and the `verifiedOnce` stamp from
1f00796 are untouched. Scoped evidence: `node --test
tests/verification_checks.test.mjs tests/executor_result_protocol.test.mjs`
19/19 — including a new host integration test that settles a seeded
done+verified retry whose only session change is `TESTRUNS.md` to `done`
with no re-run loop, and its negative twin (a `src/feature.js` + ledger
pair stays "outstanding obligations remain"); the unit test adds the
ledger-row positive plus code-file, partial-coverage, never-verified, and
over-claim negatives. `node --test tests/board.test.mjs
tests/executor_parallel.test.mjs tests/policy_experience.test.mjs
tests/verification_drain.test.mjs tests/executor_continuation.test.mjs` with
the two above: 97/97, exit 0. `npm run check` all five stages ok (100
targets, 204 specs, css merge skip, all selectors used, syntax ok 100
files). The card's own earlier false failure (16:42:58, 44 s after 1f00796
landed) was the running app still judging with the pre-fix module — the
packaged app now carries the fixed reader, per the row below. This commit
adds this row and the verifier change only.

## 2026-09-22 evening - main.cjs "SyntaxError line 2014" alert triaged: collision already repaired, hold discharged at HEAD (run run_1790098034326_9)

A-Eyes warned and Overseer reported a `main.cjs` SyntaxError at line 2014
blocking updates after multi-session edits. Root cause is in
`data/eyes-requests.json`: a live collision request records two sessions
editing `main.cjs` in the same window (09:38–09:42, 9 edits vs 1 around
09:41), the known transient-broken state the environmental-failures row for
racing sibling edits already describes. The updater behaved as designed —
its syntax hold (`scripts/updater.mjs:515`, verdict from
`scripts/check-syntax.mjs`) refused to apply while the file was broken, which
is the "blocking updates" Overseer saw. The repair landed in `4e64b7f`
(12:17): at verification time `git diff HEAD -- main.cjs` was empty and the
line-2014 region (`resolveAiRoute`) parsed clean. No code was changed in this
pass; every main.cjs copy was verified instead — root, packaged
`dist/Mefi Studio AI+/resources/app/main.cjs`, and all three worktrees
(mgctl, command-visuals, ux-phase0) pass `node --check`, and
`data/machine-status.json` shows no leases or holds (canStart true). A
sibling session began a further in-flight main.cjs edit (47+/64−) during this
pass; it was re-checked immediately and also parses — `node --check` and the
repo gate both exit 0 on the loaded tree. Evidence:
`node scripts/check-syntax.mjs main.cjs` exit 0 solo; `npm run check`
exit 0 (targets 100/100, 204 specs, selectors used, syntax ok over
100 files); `node --test tests/check_syntax.test.mjs
tests/updater_deferred.test.mjs` — 12 pass, 1 capability-gated skip, 0 fail,
including the deferred-retry suite that proves a held syntax verdict
re-validates new source before any restart. This row is the only change.

## 2026-09-22 evening - performance_render timeout headroom for the loaded full gate (task_07a6989d1e5972eb, run run_1790097924274_6)

The remaining non-adaptive deadlines in performance_render were the outer
ones: a 40s fixture kill bound and a 50s per-test timeout. The incident row
(one 50s timeout under concurrent machine load, 2-of-3 passes) plus the
2026-09-22 guard row's measurement (~25s for a healthy fixture inside a
loaded parallel stage) left only 1.6x kill headroom and ~10s of outer slack
for booklet build + spawn + cleanup. tests/performance_render.test.mjs now
uses the 80s kill convention command_render and occlusion_probe already
document, with both test timeouts at 100s so build + cleanup still fit
between the kill bound and the deadline. Retry and load-aware skip were
considered and rejected: node:test `retry` relaunches while the timed-out
first attempt's abandoned Electron may still be live (a timeout never
cancels the fn), compounding the load that caused the flake, and the
fixture's internal budgets are already pace-adaptive (6f3b370/520e22b), so
only the outer bounds needed slack. Evidence: solo
`node --test tests/performance_render.test.mjs` twice back-to-back, 2/2
exit 0 both times (fixtures 12.4/6.1s then 15.7/7.2s); `npm run check`
exit 0 (targets 100/100, 204 specs, selectors used, syntax ok). Sibling
in-flight files in the shared tree were present and untouched; only this
test file and this row changed.

## 2026-09-22 evening - verify-and-close pass for the visible-phase foreground card at HEAD (task_03ad46c09bd30216, run run_1790097832067_3)

The re-plan asked for the fix to be proven real rather than reported: repo-wide
grep confirms the steal is in the fixture, not just in prior rows —
`app.focus({ steal: true })` at raise and at the 2s re-raise
(tests/fixtures/occlusion-probe-electron.cjs lines 389/430) and on the cover
(lines 507/529) — and the frames-channel resampling is the bounded
`sampleProbe` (3 attempts, 400ms apart, every sample recorded) whose visible
`acceptable` predicate demands a frames answer AND <100ms lag, so retries
cannot mask a throttling regression. `git diff HEAD --
tests/fixtures/occlusion-probe-electron.cjs` is empty; the 379c5b1 fixture
commit and rows 56087b2 / d69fd2f are all on main. Fresh validation at HEAD
7bbc50f: `node --test tests/occlusion_probe.test.mjs` twice back-to-back,
2/2 exit 0, no "must answer via frames" failure, first run engaged real
native occlusion (document.hidden flip, occluded rAF growth 0); `npm run
check` exit 0. Sibling in-flight files in the shared tree were present and
untouched. This row is the only change.

## 2026-09-22 evening - per-session worktree follow-up group re-verified at HEAD; landing-card closure stays host-side (task_plan_mucx9cxs_0, run run_1790097361397_4)

Scope recovered from the decision logs, not guessed: member task_8d38294b586a1490's
obligations are the two split cards of task_64d0e2f342af618c ("split the extra work
out", 1790094-), and member task_4ad72ce6e6f96f58 is the extra work split out of
task_8d38294 (q_1790094724337_4 answered "split" at 1790096005851) — host-side
closure of landing card task_7b773505d7c6eb43, whose repo-side obligations the
prior run had already verified. Both members re-derived first-hand at HEAD
d69fd2f; no code changed in this pass.

- Member task_8d38294 (previously verified as rcp_a2aa528cd4d618cd, owner retry):
  every feature commit is an ancestor of HEAD — `git merge-base --is-ancestor`
  exit 0 for c272b58 (lifecycle module), e3ad851 (wiring, buildable checkouts),
  31f69f0 (start-grace), d1c4d78 (npm ci kill-switch pin), 96d15c6 (8.3 path
  canonicalization), plus rows 7cf07f5 / 17d35a3 / 5852541. Fresh
  `node --test tests/executor_worktree.test.mjs` -> 11/11 pass, exit 0 (18.0 s;
  the suite grew by the 8.3 short-path test since the prior 10/10 row).
  `git worktree list` shows no `.mefi/worktrees` checkouts and
  `.mefi/worktrees` does not exist on disk after the run — no residue. Gate card
  task_7a3b221956f9aa64 is done+verified host-side (rows 1fec86b / 21f9e33 /
  f8694c6 / f66b8d3, the last a quiet-HEAD worktree gate exit 0).
- Member task_4ad72ce: landing card task_7b773505d7c6eb43's two obligations are
  verifiably discharged in history — the in-flight main.cjs/module/test edits
  (junction + leak fix) landed as the commits above, and the feature's TESTRUNS
  evidence rows exist (17d35a3 and later, through 5852541). The card itself is
  still `open` in the board; the status flip is host-side only — the task store
  was not modified from this worker, and the closure is asked via MEFI_ASK.
- Tree notes: sibling in-flight files (CHANGELOG.md, docs/ux-audit.md,
  renderer/booklet.html, renderer/music.js, tests/music.test.mjs, README.md,
  tools/verify_command.py, untracked tests/module_purity.test.mjs) were present,
  went dirty mid-run, and were never touched; the suite left no edits behind.
  This commit adds only this row.

## 2026-09-22 evening - post-replan confirmation pass for the visible-phase foreground card (task_03ad46c09bd30216, run run_1790097316663_2)

The card had already reached a trusted "verified" receipt
(rcp_0ff6e145d5fb395f, run run_1790094834453_140) when the owner re-planned
it; this pass re-derived the evidence rather than trusting any report. No
code changed: `git diff HEAD -- tests/fixtures/occlusion-probe-electron.cjs`
is empty, so the committed 379c5b1 fix — `app.focus({ steal: true })` at
raise and re-raise (fixture lines 389/430), the bounded `acceptable`
resampling (line 454: frames-answer AND <100ms lag), and the
frames-preferring `bestSample` — is what runs. Fresh `node --test
tests/occlusion_probe.test.mjs` four times back-to-back: 4/4 exit 0, no
"must answer via frames" failure in any run, and the final run engaged real
native occlusion (document.hidden flip, occluded rAF growth 0, worker drift
163ms, MessageChannel 1ms) rather than the capability skip. The card's own
obligations — fixture commit 379c5b1 and rows 56087b2 / 7bbe03a — are all
on main; the many dirty files in the shared tree belong to sibling sessions
and are untouched here. This row is the only change.

## 2026-09-22 evening - fourth full-gate rerun for 6c5e94: why the card stuck unverified, and a quiet-HEAD gate in a throwaway worktree (task_7a3b221956f9aa64, run run_1790095876536_5)

Why the card stayed unverified through three green rows (`1fec86b`,
`21f9e33`, `f8694c6` — all present on main, TESTRUNS-only): the last failed
verification ran 11:37:11, and `1f00796` (the `noRemainingScopeTail` scoped
denial reader) landed 11:42:14 — every prior "remaining: none for this card"
was rejected by the pre-fix verifier as an outstanding obligation. The
packaged app now carries the fixed reader, so the loop cause is gone; this
row is the rerun the retries kept asking for.

The shared tree is not quiet: a sibling's in-flight radio-stations feature
(uncommitted `renderer/music.js` et al.) adds `station: null` to the music
settings object, and three landed assertions refuse the extra key
(`tests/music.test.mjs:98`, `:215`, `:264` — `git show HEAD:renderer/music.js`
has no station; the key exists only in the working-tree diff). A first
`npm test` in the shared tree exit 1 with exactly those three failures plus
the runner's "sources changed while the suite was running" note; they belong
to the sibling's landing commit, which must update those tests in the same
change. Landed code is not implicated.

The gate therefore ran against landed content only, in a throwaway detached
worktree of HEAD `1a9a760` with the shared `node_modules` junctioned (the
per-session worktree feature this card exists to gate): `npm test` exit 0 in
90 s — node 1962 tests / 1959 pass / 0 fail / 3 skipped (the documented
environment-conditional skips), serialized `eyes_toggle_electron` 1/1 and
`occlusion_probe` 1/1, Python contracts 247 tests in 34.6 s OK,
normalized-path lock all ok. `npm run check` exit 0 (check-targets ok,
merge-css skip, all-selectors-used across 5 stylesheets, check-syntax ok 100
files); `npm run audit` exit 0 with findings `[]` / 0 warnings (checkedAt
2026-09-22T16:57:31Z). node v24.15.0, npm 11.12.1. The junction was unlinked
as a link before `git worktree remove` — no `.mefi/worktrees` residue; the
sibling dirty files were never touched, and the task store was not modified
from this worker. This commit adds only this section.

## 2026-09-22 evening - verifier taught to discharge done+verified retries with 0 changed files (task_8cc401d711b549ba, run run_1790094227868_122)

The false "outstanding obligations" loop this closes is documented two rows
of 2026-09-22 below (the collision-delegate loops and the per-feature card
retry): verification-only attempts whose scoped checks re-ran green over
already-landed work died at the outstanding gate because their remaining
prose ("none within this subtask's scope", "none in scope (parent handles
final integration)", "none for this card") is a scoped denial the reader did
not recognize, and done+verified retries with 0 changed files had no
discharge path at all. Three changes: `noRemainingWork`
(scripts/assistant.mjs) now reads scoping qualifiers and a
parent/integration parenthetical as denials — "none of the tests pass" and
"none in the other module" stay obligations; `verifyCompletion` takes
`priorVerified` and discharges the changed-file obligation when the retry's
own scoped-check rerun is recorded green (0 changed files, no handed-on
remaining list, red/pending reruns still fail); main.cjs stamps a durable
`verifiedOnce` at verified settle and passes `priorVerified` (stamp or a
prior "verified —" log line) into the task settle call. Scoped evidence:
`node --test tests/verification_checks.test.mjs
tests/executor_result_protocol.test.mjs` — 18/18, including the new
discharge unit tests (positive + four negative shapes) and a host
integration test that settles a seeded done+verified retry with 0 files and
a green rerun to `done` with no re-run loop; plus
tests/board.test.mjs, tests/executor_parallel.test.mjs,
tests/policy_experience.test.mjs 50/50; `npm run check` all five stages ok;
`npm run audit` 0 findings. Full `npm test`: parallel 1962 tests / 1956
pass / 3 fail, all three in tests/music.test.mjs on the new `station`
preference key — a sibling session's in-flight renderer/music.js +
renderer/booklet.html work (untouched here, the runner flagged moved
sources mid-run), not this change; serialized eyes_toggle 1/1, Python
contracts 247/247 OK, lock checks ok. This commit adds this row and the
verifier change only.

## 2026-09-22 evening - re-verification of the visible-phase foreground card on a concurrently loaded tree (task_03ad46c09bd30216, run run_1790094834453_140)

Third pass over this card, run while several sibling sessions were
mid-flight in the shared tree. No code changed: `git diff` on
tests/fixtures/occlusion-probe-electron.cjs is still empty, so the
committed 379c5b1 fix (probe-window `app.focus({ steal: true })` at raise
and re-raise — the cover's own sanctioned grab, confirmed pre-existing at
its call sites — plus the `acceptable`-predicate resampling and the
frames-preferring `bestSample`) is what runs. Fresh `node --test
tests/occlusion_probe.test.mjs` three times back-to-back: 3/3 exit 0, no
"must answer via frames" failure in any run; the visible phase (this
card's scope) asserted frames-answer and <100ms lag every time, and all
three runs then took the documented occlusion-capability skip — the
desktop was under sibling Electron load holding foreground, the same
environment-conditional path the 7/7 row already covers with six
real-occlusion runs. `npm run check` exit 0 (100 targets, 200 specs,
merge skip, all selectors used, 100 files). The card's recurring
"verification could not confirm (N changed files)" failures were
diagnosed, not discharged here: each one coincided with another session's
uncommitted edits in the shared tree (the 16:29Z failure was
scripts/executor-worktrees.cjs, which its own card landed minutes later
as 96d15c6); this card's own obligations — fixture commit 379c5b1 and
rows 379c5b1/56087b2 — are all committed and re-checked by this run.

## 2026-09-22 evening - closing full-gate pass for the per-feature model-config idea card (task_idea_mubob3xr_0, run run_1790094521980_132)

Closing verification for "Per-feature model config with graceful fallbacks".
The implementation was re-verified first-hand at HEAD rather than trusted
from run_1790082165537_103's report: `armedFallbackRoutes` (main.cjs:1991)
plus the `withFallbacks`/`degrade` wiring in `resolveAiRoute`
(main.cjs:2010-2058) are present, the 9-test suite
`tests/explicit_route_fallback.test.mjs` landed with the routing hunks in
520e22b, and the prior attempt's 9-file obligation has no uncommitted
remainder — `git status --porcelain` showed those paths clean at pickup.
The delegated gate obligations are also on record (rows for
task_baa66f9ab1ec0f2e at 10:28/10:36 and task_d9f157833b296be0 at 10:40);
this pass repeats the narrow suites and the whole gate at current HEAD so
the parent card carries its own first-hand evidence. Narrow: `node --test
tests/explicit_route_fallback.test.mjs tests/planning_routing.test.mjs` —
21 tests / 21 pass / 0 fail / 0 skipped, exit 0. `npm run check` — all
five stages ok (100/100 targets, 200 specs unique with no orphans, merge
skip, all selectors used, 100 files syntax). Full `npm test` verbatim,
exit 0 on every stage: parallel 173 suites (9 launch Electron), 1959
tests / 1956 pass / 0 fail / 3 skipped (the documented
environment-conditional skips); serialized eyes_toggle_electron 1/1;
occlusion_probe took the documented capability skip (visibility never
flipped, unattended desktop); Python contracts 247/247 OK in 37.2 s (one
more than the 10:4x rows — a sibling landed a new contract since);
normalized-path lock all ok. Settle honest note: HEAD moved 56087b2 ->
96d15c6 (a sibling's worktree-path canonicalization commit) while this
gate ran and four sibling in-flight files are dirty now (main.cjs,
renderer/booklet.html, scripts/assistant.mjs,
tests/verification_checks.test.mjs) — the runner's settle preflight
passed and it raised no moved-sources diagnosis, the gate exited 0, and
those files were left untouched. This commit adds only this row.

## 2026-09-22 evening - third full-gate rerun for the 6c5e94 follow-up card on a concurrently loaded tree (task_7a3b221956f9aa64, run run_1790094398262_129)

Third full-gate row for this card. Preconditions verified first-hand: start
HEAD 21f9e33 (the second full-gate row) over landing commit e3cd322; gate
targets of task_bf79bd8c1d8fced5 still on history (c272b58 worktree module,
e3ad851 wiring, 31f69f0 + d1c4d78 follow-ons; `scripts/executor-worktrees.cjs`
and `tests/executor_worktree.test.mjs` present on disk); tree clean, nothing
staged. node v24.15.0, npm 11.12.1. Two other-session evidence rows (56087b2,
5852541, TESTRUNS.md-only) landed mid-suite and tripped the run-node-tests
"sources changed" advisory twice; both were treated as noise, not regressions.

`npm test` was run end-to-end twice; each full run had exactly one
timing-sensitive failure and the two failures were disjoint files: run 1 node
stage 1959 tests / 1955 pass / 1 fail / 3 skipped with only
performance_render.test.mjs:72 (profiler JSON download 5260 ms @1.05x), run 2
with only eyes_worker.test.mjs:91 (150 ms store read timeout). Both are
documented load signatures (the perf-profiler table row and the eyes_worker
read-past-timeout note), and the host was measured loaded during the runs
(60% CPU, sibling claude/electron sessions). Documented remediation applied
and confirmed: solo `node --test tests/performance_render.test.mjs` passed
2/2 exit 0 in 12.7 s on the second solo attempt (first solo attempt 1/2 with
the other test in the file timing out — same contention signature), solo
`node --test tests/eyes_worker.test.mjs` exit 0. The `&&`-gated tail stages
were then run individually to completion: Python contracts 247/247 OK in
54.0 s exit 0; normalized-path lock 6/6 ok exit 0. `npm run check` exit 0
(targets 100/100, spec-collisions 200 unique no orphans, css merge skip, all
selectors used across 5 stylesheets, syntax ok 100 files). `npm run audit`
exit 0 with 0 findings / 0 warnings (checkedAt 2026-09-22T16:35:47Z). Gate
conclusion: every suite green in-suite except one rotating documented flake
per pass, each flake green solo, all three `npm test` stages and both
supporting gates exit 0 first-hand at this HEAD.

## 2026-09-22 evening - scope pass for the third worktree follow-up: both split obligations verified discharged (task_8d38294b586a1490, run run_1790094266535_124)

Scope decided from the parent's decision log (task_64d0e2f342af618c,
"split the extra work out"): the uncovered work is the two split cards'
obligations, verified here first-hand at HEAD 56087b2 rather than trusted
from prior reports.

- Landing card task_7b773505d7c6eb43 (never dispatched itself): the feature
  is present end to end — `scripts/executor-worktrees.cjs`, the `main.cjs`
  wiring (require at main.cjs:58, per-run `prepare`/`discard` around
  main.cjs:9354-9376, kill-switch `MEFI_STUDIO_WORKTREE_NPM_CI`), the
  `docs/architecture.md` opt-in section, and the TESTRUNS rows from d1c4d78 /
  e3ad851. Fresh `node --test tests/executor_worktree.test.mjs` -> 10/10
  pass (11.6 s), including the junction cleanup and the lazy
  `.git/info/exclude` write (asserted by the suite itself).
- Full-gate card task_7a3b221956f9aa64: gates exited 0 at e3cd322 (rows
  1fec86b / 21f9e33); `git diff e3cd322..HEAD` touches TESTRUNS.md only, so
  that evidence still covers HEAD's code. The card's failed verification
  ("1 changed file") was line-ending noise, not content:
  `git diff --ignore-all-space --numstat` on renderer/booklet.html was empty
  (`git ls-files --eol`: index lf, worktree crlf). Restored with
  `git checkout -- renderer/booklet.html`; `git status --porcelain` is now
  empty, so the next gate-card retry verifies against a quiet tree.
- No residue: `git worktree list` shows no `.mefi/worktrees` checkouts on
  this repo.

## 2026-09-22 evening - repeat verification for the visible-phase foreground card (task_03ad46c09bd30216, run run_1790094247017_123)

Closing verification for "Visible-phase foreground robustness". The
implementation landed as 379c5b1 (fixture + the row below only — 2 files,
verified via `git show --stat`, not the 6 dirty working-tree files the
sentinel saw, which belonged to sibling sessions); both dispatches after it
died on the 5-hour usage limit before running anything. This pass trusts no
prior report and re-derived the evidence: `git diff HEAD` on
tests/fixtures/occlusion-probe-electron.cjs is empty, so the committed steal
(`app.focus({ steal: true })` at raise + re-raise) and the frames-channel
resampling (`acceptable` predicate — a sample must answer via frames AND read
<100ms within the same bounded 3 attempts — plus `bestSample` preferring
frames answers) are what actually runs. Then `node --test
tests/occlusion_probe.test.mjs` seven times back-to-back: 7/7 exit 0, six
engaging real native occlusion (document.hidden flip, occluded rAF growth 0,
worker drift 151-166ms, MessageChannel 0ms, recovery after cover removal) and
one taking the documented capability skip — no "must answer via frames"
failure in any run, which is the flake this card exists to kill. (A first
looped attempt printed exit 1 with no test output: `Select-Object -First 6`
stopped the pipeline after exactly the 6 summary lines and killed node — a
capture artifact, per the known-failures table's "never through
`Select-Object -Last N`" note, not a test result.) `npm run check` exit 0,
all five stages ok (100 targets, 200 specs, merge skip, all selectors used,
100 files syntax). This commit adds only this row.

## 2026-09-22 afternoon - second full-gate rerun for the 6c5e94 follow-up card after the usage-limit stall (task_7a3b221956f9aa64, run run_1790094001667_115)

Second full-gate row for this card, run from scratch on the quiet tree. The
first pass (run_1790091912218_46, row landed as 1fec86b) ran the whole gate
green, yet verification closed with "sentinel seen, 0 changed files" and left
obligations open; the six dispatches after that all died on the 5-hour usage
limit before any command ran (usage-limit tails, not test failures). This
pass re-ran every gate itself and trusts neither earlier report.

Preconditions verified independently, not from the handoff: HEAD e3cd322
("Booklet contract: brains assets inlined exactly once, no src leftovers"),
tree fully clean and nothing staged at start; the gate target of card
task_bf79bd8c1d8fced5 — c272b58 (scripts/executor-worktrees.cjs lifecycle
module) and e3ad851 (main.cjs wiring, buildable worktree runs) with follow-ons
31f69f0 and d1c4d78 — all still on HEAD's history. Three commits landed since
the first row and are exercised by this run: fa35236 (CHANGELOG-only), b8f1a7a
(TESTRUNS.md + tools/verify_dev_app.mjs, neither suite-read), and e3cd322
(booklet contract: tests/booklet_build.test.mjs assertions plus the 247th
Python contract).

`npm test` end-to-end, exit 0, ~82 s, every stage separately green: parallel
node 1959 tests / 1956 pass / 0 fail / 3 skipped in 39.3 s (the three skips
are the documented environment-conditional ones); serialized
eyes_toggle_electron 1/1 (3.2 s, baseline 2 fetches/295 ms, one resume snap,
6 fetches total); occlusion_probe 1/1 (5.6 s) with the documented capability
skip NOT taken this time — real occlusion engaged (document.hidden, occluded
rAF growth 0, worker drift ~152 ms, lag 0 ms of 1 sample); Python contracts
247/247 OK in 30.4 s; normalized-path lock 6/6 ok. `npm run check` exit 0
(targets 100/100, spec-collisions 200 unique no orphans, css merge skip, all
selectors used across 5 stylesheets, syntax ok 100 files). `npm run audit`
exit 0 with 0 findings / 0 warnings (checkedAt 2026-09-22T16:23:21Z).
node v24.15.0, npm 11.12.1. HEAD did not move during any gate this time; no
suite reads TESTRUNS.md. The task store was not modified from this worker.
This commit adds only this section.

Quiet-tree full-gate rerun for the 34d02e follow-up card, exit 0 with one
documented environmental flake remediated per this file's own table; landing
card task_2dd9dc18291f2625 verified discharged (2026-09-22, ~11:2x-11:3x,
run_1790094209046_121 for task_0b98acc8d32d5f67 "Full-gate rerun on the quiet
tree — follow-up 34d02e", parent task_01a24e9b78aaef34 "Follow-up:
Per-session worktrees for executor runs"). Precondition verified
independently, not from the handoff: the sibling start-grace edits landed as
31f69f0 (start-kill grace in main.cjs — the HEAD graced-kill path at
main.cjs:9589 — plus 38 lines of tests/executor_lifecycle.test.mjs including
"start kills past the grace are charged as ordinary failures"), an ancestor
of HEAD. Quiet tree took an explicit wait: at pickup a sibling session was
actively rebuilding renderer/booklet.html (a stray `<script src="brains.js">`
after `</html>` drifted in and was rebuilt away within ~2 min); the only
young node process left was the long-lived `scripts/serve.mjs` server, and
the gate launched on a fully clean tree at 56087b2 after two TESTRUNS-only
sibling commits (21f9e33, 56087b2). Gate: `npm run check` exit 0; `npm test`
parallel node stage 1959 tests / 1955 pass / 1 fail / 3 skipped (the
documented environment-conditional skips) in 73.3 s — the one failure was
performance_render "Profiler JSON download timed out after 6080ms at 1.22x
observed pace", the first row of this file's known-environmental table;
remediated exactly as that table prescribes: solo rerun
`node --test tests/performance_render.test.mjs` -> 2/2 pass, exit 0. The
`&&` aggregate stopped at the node stage, so every later stage ran solo and
green: serialized eyes_toggle_electron 1/1 (6.1 s, baseline 2 fetches/295 ms,
one resume snap, 6 fetches total); occlusion_probe 1/1 exit 0 (the real
visible-phase pass, not the capability skip — the 379c5b1 foreground-steal
resampling); Python contracts 247/247 OK in 77.3 s; normalized-path lock all
ok. `npm run audit` exit 0, 0 findings / 0 warnings. Settle honest note: HEAD
moved 56087b2 -> 5852541 mid-run via one TESTRUNS.md-only sibling commit; no
test-read source moved, the runner raised no moved-sources diagnosis, and
the tree is fully clean after. Landing card task_2dd9dc18291f2625 ("Land the
worktree tree + TESTRUNS row") verify-and-close: both obligations are
verifiably in history — the in-flight main.cjs/module/test edits (junction +
leak fix) landed as c272b58 (lifecycle module, shared-install junction, leak
fix), 136f866 (main.cjs wiring + shared fake DOM) and e3ad851 (junction
guards, no-path-strands-a-worktree leak fix, buildable checkouts), with
follow-on d1c4d78 pinning the npm ci kill-switch; the feature's evidence row
is the late-morning entry at the bottom of this file. The card is discharged
on repo evidence; Studio's task store was not modified from this worker, so
the status flip itself stays host-side. This commit adds only this row.

## 2026-09-22 afternoon - restart-dev-app re-dispatch loop diagnosed; scoped named check added (task_5494e9f92f34b95a, run run_1790091964934_47)

Card task_cd738240985f9b00 ("Restart dev app after repair — follow-up
332b9d") re-minted for hours. Root cause, from the policy-lab receipts
(rcp_7b2b1d6773a1b8e3, rcp_7fe9cedffbaa4789, rcp_6d80a5c56723ca11): each
retry finished ok (`verdictOk: true`, session, no outstanding obligations)
with 0 changed files and `result: null` — the workers never emitted a
parseable MEFI_RESULT note, so `scheduleVerificationOnDone` queued no
overseer check run, and `verifyCompletion`'s only remaining pass paths
(changed files / observed checks / matched commit) had nothing to accept:
"no attributable edits and no named checks". The card is operational (it
restarted serve and the dev app — both were confirmed live in the runs'
own evidence), so it can never produce changed-file evidence; and each
manual "Retry requested" reset `verifyAttempts`, re-arming the 3-attempt
park budget indefinitely. The general verifier change (green scoped-check
rerun discharging verification-only cards) is card
task_8cc401d711b549ba's open scope and was not touched.

What landed here: `tools/verify_dev_app.mjs`, the named check that card's
actual scope lacked — it resolves every static external require/import
across main.cjs, preload.cjs and scripts/* (the "confirm no
ERR_MODULE_NOT_FOUND" promise of the node_modules repair; the app has
exactly one runtime external, `electron`) and probes serve as
informational. `node tools/verify_dev_app.mjs` -> 74 file(s) scanned,
1 unique external package, 0 resolution failures, serve probe HTTP 200 on
4173, exit 0; `npm run check` -> exit 0 (targets, spec collisions, css,
syntax, 100 files). Next dispatch of the card can run this command in its
session to discharge via observed checks. A host-side close of
task_cd738240985f9b00 remains the owner's call (asked via MEFI_ASK); the
task store was not modified from this worker.

Quiet-tree full-gate rerun for the 6c5e94 follow-up card, exit 0
(2026-09-22, ~15:4x, run_1790091912218_46 for task_7a3b221956f9aa64
"Full-gate rerun on the quiet tree — follow-up 6c5e94", parent
task_64d0e2f342af618c "Follow-up: Follow-up: Per-session worktrees for
executor runs"). Preconditions verified independently before launching,
not taken from the handoff: the gate target of card task_bf79bd8c1d8fced5
is the landed worktree module + wiring — c272b58
(scripts/executor-worktrees.cjs lifecycle module) and e3ad851 (main.cjs
wiring, buildable worktree runs) both on HEAD's history with follow-ons
31f69f0 and d1c4d78; the tree was fully clean and nothing staged at
start (HEAD cb79b9f). `npm test` ran end-to-end, exit 0 on every stage:
parallel node 1959 tests / 1956 pass / 0 fail / 3 skipped in 37.0 s
(1959 counts d1c4d78's npm-ci kill-switch gating test; the three skips
are the documented environment-conditional ones); serialized
eyes_toggle_electron 1/1 (3.3 s, baseline 2 fetches/298 ms, one resume
snap, 6 fetches total); occlusion_probe took the documented capability
skip (visibility never flipped under a focused cover); Python contracts
246/246 OK in 35.8 s; normalized-path lock 6/6 ok. The same pass also
ran `npm run check` exit 0 (targets 100/100, spec-collisions 200 unique
no orphans, css merge skip, all selectors used, syntax ok 100 files) and
`npm run audit` exit 0 with 0 findings / 0 warnings. Settle honest note:
HEAD moved cb79b9f -> 6e5f233 during the run — a TESTRUNS.md-only
sibling commit that is the original card's own retry row
(run_1790091813384_42 for task_bf79bd8c1d8fced5), so that card now
carries its own fresh green gate row and this row discharges only the
follow-up; no test-read source moved, no suite reads TESTRUNS.md, and
the runner raised no moved-sources diagnosis. After the run a sibling
session holds an in-flight edit on tests/fixtures/occlusion-probe-electron.cjs
(46 insertions / 6 deletions, occlusion-hardening work) that was left
untouched. This commit adds only this row.


Visible-phase foreground robustness for the occlusion-probe fixture
(2026-09-22, run_1790091834654_43 for task_03ad46c09bd30216 "Visible-phase
foreground robustness", parent task_e65d8260beb42082). The visible phase
raised the probe window with a plain `window.focus()` — deniable under the
Windows foreground lock, the same denial the cover already works around with
`app.focus({ steal: true })` — and judged "must answer via frames" on the
lowest-lag sample while the probe's in-page channels race two rAF ticks
against a ~150ms unthrottled timer, so under load a healthy window's worker
answer could win the race and shadow its frames answer (flake observed
2026-09-22). The fixture now raises/re-raises the probe window with the same
sanctioned steal as the cover, resamples (same bounded 3 attempts) until a
sample both answers via frames and reads <100ms, and prefers frames-answering
samples in bestSample — the occluded/proxy phases are unchanged (their
samples must never answer via frames, asserted per-sample). Retries still
cannot mask real failures: throttling answers via frames never, a wedged page
answers via nothing, on every sample. Verified live:
`node --test tests/occlusion_probe.test.mjs` 1/1 pass, 0 skipped — the run
even engaged real native occlusion (via document.hidden, occluded rAF growth
0, occluded probe answered workerDriftMs 166ms / lag 0ms, recovered), so the
changed visible phase and the untouched occluded contract both exercised
green; `npm run check` all five stages ok. Changed only
tests/fixtures/occlusion-probe-electron.cjs and this file.

Closing verification for the per-feature model-config landing card
(2026-09-22, ~11:1x, run_1790091744134_39 for task_6b445d8ac92eeed6 "Land
the per-feature model-config tree"). Re-verified at HEAD instead of trusting
the prior report: all eight waited-on paths — main.cjs, preload.cjs,
scripts/assistant.mjs, scripts/task-context.cjs, scripts/agent-issues.cjs,
scripts/brains.cjs, tests/agent_issues.test.mjs, tests/brains_map.test.mjs —
landed in a16b752 (exactly those 8 files, +2198/−26), with main.cjs evolved
further by e3ad851 and 31f69f0, and all clean in `git status --porcelain`
this pass, so no re-commit was made. The follow-on rerun card
task_baa66f9ab1ec0f2e is done and verified (its own row: e936982, full
npm test exit 0 on the settled tree), so no re-trigger was needed. The two
earlier retries of this card looped on verification mechanics, not
substance: the first ran its checks through a PowerShell pipe the runner
does not observe as a check, and the second answered "remaining: none for
this card", which the verifier does not recognize as no-remaining-work.
This pass ran the checks bare so they count: `node --test
tests/agent_issues.test.mjs tests/brains_map.test.mjs` — 26 tests /
26 pass / 0 fail / 0 skipped, exit 0, and `npm run check` — all five
stages ok (100 targets, 200 specs, no merge in progress, every class
selector used, 100 files syntax). A sibling session's in-flight
package-lock.json hunk was left untouched.

Quiet-tree full-gate rerun for the 69ecdf follow-up card, exit 0
(2026-09-22, ~16:2x, run_1790091792644_41 for task_e2a0db32d964df2f
"Full-gate rerun on the quiet tree — follow-up 69ecdf", parent
task_01a24e9b78aaef34 "Follow-up: Per-session worktrees for executor
runs"). Precondition verified independently before launching: the card's
gate was the landed worktree module + wiring per task_bf79bd8c1d8fced5
— e3ad851 (main.cjs wiring, buildable worktree runs) is on HEAD's
history with follow-ons 31f69f0 and d1c4d78; the "69ecdf" in the title
is the handoff id suffix (handoff_a15c507ec55352cabf69ecdf), not a
commit. `npm test` ran solo end-to-end over d1c4d78, exit 0 on every
stage: parallel node 1959 tests / 1956 pass / 0 fail / 3 skipped in
37.5 s (1959 counts d1c4d78's new npm-ci kill-switch gating test);
serialized eyes_toggle_electron 1/1 (3.7 s, baseline 2 fetches/298 ms,
one resume snap, 6 fetches total); occlusion_probe took the documented
capability skip (visibility never flipped under a focused cover);
Python contracts 246/246 OK in 34.5 s; normalized-path lock all ok.
Settle honest note: HEAD moved d1c4d78 -> cb79b9f mid-run — a
package-lock.json-only sibling commit landing the 3-line `engines`
sync that had been floating in the working tree; no test-read source
moved, no suite reads the lockfile, and the runner raised no
moved-sources diagnosis; the tree is fully clean after (that hunk is
now committed by its owner). This commit adds only this row.

Quiet-tree full-gate rerun closing the floating-lockfile blocker, exit 0
(2026-09-22, ~15:4x, run_1790091813384_42 for task_bf79bd8c1d8fced5
"Full-gate rerun on the quiet tree", retry after run_1790091211824_20
verified "outstanding obligations remain" with 1 changed file). The
prior run's gate was genuine (8e43ac8) but verification could not pass
while a 3-line `engines` sync npm had written into package-lock.json
kept floating in the tree — every earlier session left it untouched as
a sibling artifact. This retry reconciled it instead: the hunk only
adds `"engines": {"node": ">=24"}` to the lockfile's root entry, which
matches package.json's declared engines exactly, so it was committed
path-limited as cb79b9f (3 insertions, nothing else swept, tree quiet
before and after). The full gate then ran at the new HEAD:
`npm run check` exit 0 (targets 100/100, spec-collisions 200 unique
no orphans, css merge skip, all selectors used, syntax ok 100 files);
`npm test` exit 0 — parallel 1959 tests / 1956 pass / 0 fail /
3 skipped in 35.3 s, serialized eyes_toggle_electron 1/1 (3.5 s,
baseline 2 fetches/299 ms, resume snap 1, 6 fetches total),
occlusion_probe took the documented capability skip, Python contracts
246/246 OK in 35.6 s, normalized-path lock 6/6 ok; `npm run audit`
exit 0 with 0 findings / 0 warnings. Settle honest note: HEAD moved
cb79b9f -> fb56717 mid-run via two TESTRUNS.md-only sibling commits
(90a784c, fb56717 — the second being the parallel sibling gate's own
row), and the sibling gate run_1790091792644_41 for
task_e2a0db32d964df2f overlapped this run's Electron stages — every
stage still exited 0 and the runner raised no moved-sources diagnosis;
the worktree gate target suites stay green in-stage per the 8e43ac8
and d1c4d78 rows below. This commit adds only this row.

Scoped-check rerun un-sticking the two collision-delegate verification
loops (2026-09-22, ~16:0x, run_1790091633044_35 for
task_93c9907b18ec3928 "Unstick collision-delegate verification loops",
parent task_94b29c15a3479597). Both delegates of the booklet/routing
collision (task_delegate_d9f299382ce7faa99dfc1f15 on booklet.js +
model_auto_setup, task_delegate_f86594532fe0532c3d541359 on README +
routing tests + template) had already reported done with their scheduled
verification chains passing, then looped on "0 changed file(s),
outstanding obligations" — correct in mechanism, not in substance: the
merge had landed before pickup, so a faithful re-check changes nothing.
Re-ran every recorded scoped check from the project root at HEAD this
run, all exit 0 and matching the delegates' own counts exactly:
`node --test tests/model_auto_setup.test.mjs` — 16 tests / 16 pass /
0 fail (92 ms); `python -m unittest discover -s tools -p
test_mefi_studio_routing.py` — Ran 23 tests, OK (2.28 s);
`node --test tests/jev_routing_ui.test.mjs` — 19 tests / 19 pass /
0 fail (208 ms); plus the shared `npm run check` prefix of both chains
— targets ok (100/100), spec-collisions ok (200, unique, no orphans),
css merge skip (no merge in progress), all selectors used, syntax ok
(100 files). No host-side remainder: each delegate's full recorded
check list re-executed green, so both delegates can verify and
task_c1cf337d66009c14 can integrate. No product or test code touched;
this commit adds only this row, and a sibling session's in-flight
package-lock.json hunk was left untouched.

First-hand full-gate confirmation after the model-config landing, exit 0
(2026-09-22, 10:40-10:42, run_1790091443127_27 for task_d9f157833b296be0
"Run the full npm test gate after the model-config commit", parent idea
"Per-feature model config with graceful fallbacks"). Precondition verified
independently before launching: the per-feature model-config chain is
committed — a16b752 landed the brain maps / agent-issues lane / Command
inspect tree (scripts/brains.cjs, scripts/agent-issues.cjs,
renderer/brains.js et al.) and 31f69f0 the last in-flight monitor-loop
paths — and no test source was dirty. The whole `npm test` aggregate ran
verbatim: exit 0 on every stage — parallel 1958 tests / 1955 pass /
0 fail / 3 skipped in 36.0 s; serialized eyes_toggle_electron 1/1
(3.5 s); occlusion_probe took the documented capability skip;
Python contracts 246/246 OK in 33.6 s (the card brief's 204 is stale —
the brain-map contracts lifted the count); normalized-path lock 6/6 ok.
Settle honest note: HEAD moved e936982 -> 09d8e38 mid-run, a
TESTRUNS.md-only sibling commit ("per-feature model-config landing
confirmation"), and the concurrent quiet-tree gate one row below
(task_bf79bd8c1d8fced5, 10:38-10:42) overlapped this run's Electron
stages — both gates still exited 0 and the runner raised no
moved-sources diagnosis; the 3-line package-lock.json `engines` sync
floating in the working tree matches that row's note and was left
untouched. The card's report target task_baa66f9ab1ec0f2e is done and
verified on its own runs (settled-tree row below). This commit adds
only this row.

Quiet-tree full-gate rerun over the landed worktree module + wiring, exit 0
(2026-09-22, 10:38-10:42, run_1790091211824_20 for
task_bf79bd8c1d8fced5 "Full-gate rerun on the quiet tree", parent
"Per-session worktrees for executor runs"). Preconditions verified
first-hand before launching: the combined in-flight tree landed as 31f69f0
(start-kill grace, settle-only verification prefetch, monitor-loop tool),
`git status --porcelain` was empty, and the one sibling `run-node-tests`
node stage in flight at pickup (PID 23216) was waited out, so this gate
ran solo; `npm run check` (all five stages) and `npm run audit` (0
findings, 0 warnings) were green immediately before. Exit 0: node stage
173 suites (9 launch Electron), 1958 tests / 1955 pass / 0 fail /
3 skipped in 35.8 s (the documented environment-conditional skips);
Python contracts 246/246 OK in 31.6 s; normalized-path lock all ok;
serialized eyes_toggle_electron 1/1 (3.1 s, baseline 2 fetches/296 ms,
one resume snap, 6 fetches total); occlusion_probe took the documented
capability skip (visibility never flipped). The card's target suites ran
green in-stage: worktree prepare/settle lifecycle (3.6 s) and
keep-worktree-on-uncommitted-edits (2.8 s). Settle honest note: the
before/after `git status` snapshots differ by one outside-process change
— a 3-line `engines` sync npm wrote into package-lock.json mid-run; no
test-read source moved, no suite reads the lockfile, and the runner
raised no moved-sources diagnosis; the hunk belongs to a sibling session
and was left untouched. This commit adds only this row.

Restart-coverage verification for the staged-index warning card
(2026-09-22, ~15:0x, run_1790091589134_33 for task_d89c17863bf8ccdb
"Restart coverage for staged-index warnings", parent
task_7247a03061fd07b9 "Feed the staged-sweep warning into the next
dispatch"). The previous attempt's verification flagged "0 changed
files, outstanding obligations" — correct in mechanism, not in
substance: the decision was already committed (the dispatch-time
gitPorcelain probe hunk rode the sibling whole-file landing e3ad851,
certified again by 31f69f0's full gate), so the retry had nothing left
to change. Re-verified at HEAD instead of trusting the report: the
probe lives in main.cjs (dispatch path, "Restart coverage" block —
when no fresh parked entry exists it re-derives the CAUTION from
`git status --porcelain`, sync in production so no await joins the
gate, async in the vm hosts) and reads `eyes.gitPorcelain({ root:
runRoot })`, never the in-memory map; the 30-minute window remains
only as the parked-entry freshness gate, subordinate to the probe.
Narrow gate rerun solo: `node --test tests/executor_end_to_end.test.mjs`
— 18 tests / 18 pass / 0 fail / 0 skipped in 0.55 s, exit 0, including
"staged-index advice survives a dispatcher restart through the
dispatch-time porcelain probe" (map wiped as a restart would; the probe
still advises; it never touches the map). This commit adds only this
row, closing the card's changed-file obligation; a sibling session's
in-flight package-lock.json hunk was left untouched.

Landing confirmation for the per-feature model-config tree (2026-09-22,
10:39-10:40, run_1790091413818_26 for task_6b445d8ac92eeed6 "Land the
per-feature model-config tree", parent "whats left to do?"). This card's
commit obligation was already discharged by a sibling session before pickup:
`git show --name-only a16b752` ("Land brain maps, the agent-issues decision
lane and Command inspect mode", 09:24) contains all eight waited-on paths —
main.cjs, preload.cjs, scripts/assistant.mjs, scripts/task-context.cjs,
scripts/agent-issues.cjs, scripts/brains.cjs, tests/agent_issues.test.mjs,
tests/brains_map.test.mjs — with main.cjs evolved further in e3ad851 and
31f69f0, all committed; `git status --porcelain` showed those paths clean
throughout this pass, so no re-commit was made. Narrow check on the landed
pair: `node --test tests/agent_issues.test.mjs
tests/brains_map.test.mjs` — 26 tests / 26 pass / 0 fail / 0 skipped in
0.13 s, exit 0. `npm run check` — all five stages ok (100/100 targets
through the syntax pass, 200 specs with unique basenames and no orphans, no
merge in progress, every class selector used, 100 files in-process syntax).
The follow-on rerun card task_baa66f9ab1ec0f2e had already run green on the
settled tree and recorded its own row below (e936982), so both of this
card's obligations are met without re-triggering. This commit adds only
this row; a sibling session's in-flight package-lock.json hunk was left
untouched.

Audit-verify that the A-Eyes dead-selector warn on `.brains-sheet` is
already resolved (2026-09-22, 10:39-10:41, run_1790091495454_29 for
task_fd3fcbcfff3656e4 "Audit: css"). The warn was raised at 08:42 against
the pre-landing tree; a16b752 (09:24) then landed brain maps complete, so
`brains-sheet` now appears in renderer/booklet.template.html:1050 and the
built renderer/booklet.html. No edit made — deleting the selector would
strip the live dialog's layout. Evidence: `node scripts/auditor.mjs`
audit() reports zero css findings at both the repo root and
dist/Mefi Studio AI+/resources/app; `node scripts/check-css.mjs --unused
renderer/brains.css` prints ALL-SELECTORS-USED; the requested gate
`python -m unittest discover -s tools -p "test_mefi_studio_*.py"` ran
246 tests OK in 33.0 s, exit 0, output captured to a file. HEAD 7f9cbe5
throughout; the only dirty path, package-lock.json, is another session's
and was left untouched. This commit adds only this row.

Settled-tree full-gate rerun, exit 0 (2026-09-22, 10:36-10:38,
run_1790091305943_21 for task_baa66f9ab1ec0f2e "Full-gate rerun after
in-flight work settles", parent idea "Per-feature model config with
graceful fallbacks"). This is the rerun the two rows below anticipated:
they certified the combined tree while the six monitor-loop paths were
still uncommitted in-flight (and the earlier attempt's verification
flagged exactly that outstanding tree), so this run is the first
complete `npm test` on the settled combined tree — HEAD 31f69f0, which
landed those six paths on top of 17d35a3 plus the two TESTRUNS-only
commits. Exit 0 on every stage: parallel 1958 tests / 1955 pass /
0 fail / 3 skipped in 36.5 s; serialized eyes_toggle_electron 1/1
(3.7 s, baseline 2 fetches, one resume snap, 6 fetches total);
occlusion_probe took the documented capability skip (visibility never
flipped, unattended desktop); Python contracts 246/246 OK in 33.7 s;
normalized-path lock all ok. Settle check for this run: HEAD was
31f69f0 before and after, and `git status --porcelain` captured before
and after is byte-identical and empty — the in-flight work this task
waited on had fully settled, no sibling landed mid-run, and the runner
raised no moved-sources diagnosis. This commit adds only this row.

Landing verification for the combined in-flight tree (2026-09-22, 10:35,
run_1790091189066_19 for task_2fe0bffe3a85cde1 "Land the sweep-advice
main.cjs hunk", parent "Feed the staged-sweep warning into the next
dispatch"). The six in-flight paths the two full-gate rows below already
certified green on the identical tree (HEAD 17d35a3's six monitor-loop
paths: CHANGELOG.md, docs/agent-loop.md, main.cjs,
tests/executor_lifecycle.test.mjs, tests/fixtures/host_executor.mjs,
tools/monitor_loop.mjs — untouched since, the three commits in between being
TESTRUNS.md-only) landed as one commit with this row. Before committing,
`node --test tests/executor_end_to_end.test.mjs
tests/executor_lifecycle.test.mjs`: 52 tests / 52 pass / 0 fail /
0 skipped in 0.25 s, exit 0 — covering the committed 1567a16 sweep-advice
suite (finish-time staged-index warning rides exactly the next dispatch as
collab advice; stale warnings age out) and the new start-kill grace (a
start kill spends none of the card's five tries below five start kills,
past grace it is charged, and a run that does start clears the streak).

Independent full-gate rerun, concurrent with the row below, same green
result (2026-09-22, 10:28-10:29, run_1790090737796_6 for
task_baa66f9ab1ec0f2e "Full-gate rerun after in-flight work settles",
parent idea "Per-feature model config with graceful fallbacks"). Launched
six seconds after the row below's run on the identical combined tree
(HEAD 17d35a3 plus the six in-flight monitor-loop paths), so the two
complete `npm test` chains overlapped for most of their length — two full
gates at once on one tree, the load scenario the environmental-failures
table warns about, and neither surfaced a flake. Exit 0: parallel stage
173 suites (9 launch Electron), 1958 tests / 1955 pass / 0 fail /
3 skipped in 36.3 s; serialized eyes_toggle_electron 1/1 (3.1 s,
baseline 2 fetches, one resume snap, 6 fetches total); occlusion_probe
took the documented capability skip (visibility never flipped); Python
contracts 246/246 OK in 30.1 s; normalized-path lock all ok. Settle
check for this run: `git status --porcelain` captured before and after
is byte-identical — no sibling landed and no source moved mid-run, so
the vm suites read a still tree and the runner raised no
moved-sources diagnosis. This commit adds only this row.

Green exit-0 full `npm test` gate for the parent integration-gate chain
(2026-09-22, 10:27–10:29, run_1790090677908_4 for task_0b1780b06ba74eb0).
This is the settled-tree rerun the previous attempt (run_1790040270702_1:
2 deterministic usage-HUD failures, serialized/python stages unreached)
owed. The usage-HUD work has long since landed; the only in-flight sibling
session (monitor-loop: main.cjs, tests/executor_lifecycle.test.mjs,
tests/fixtures/host_executor.mjs, docs/agent-loop.md, CHANGELOG.md, new
tools/monitor_loop.mjs) was quiet — last source write 10:06, run launched
10:27:57, the runner's settle preflight passed, and no mid-run source-drift
diagnosis fired. Preconditions: no sibling suite in flight (only MCP-proxy
node/python processes, no electron processes at all), CPU ~21%, free RAM
0.31 GB — a floor prior green gates have passed below. Result: exit 0 —
node stage 173 suites (9 launching Electron), parallel 1958 tests /
1955 pass / 0 fail / 3 skipped in 38.0 s (the documented
environment-conditional skips; the count grew 1937 → 1958 with the
sibling's in-flight suite additions, all green on this tree); serialized
eyes_toggle_electron 1/1 in 3.4 s (baseline 2 fetches/298 ms, hidden
0/1200 ms, one resume snap, fetch gaps 297-1266 ms, 6 fetches total);
serialized occlusion_probe took its documented capability-gated skip
(cover shown focused but visibility never flipped within 15 s — the
expected table row on this desktop, not a regression); Python contracts
"Ran 246 tests ... OK" in 30.0 s; normalized-path lock "all checks
passed". `npm run check` exit 0 on the same tree (100 targets, 200 specs,
all selectors used, syntax ok), and the run left the working tree
byte-identical: the same six sibling paths in git status before and after,
nothing staged, nothing clobbered, no source edits by this run. Full log:
%TEMP%\opencode\gate-0b1780\test-run1.log (386 KB). This row is the
citable exit-0 gate artifact task_6672802f6623e7bd ("Resolve TESTRUNS and
booklet collisions", acceptance: npm test passes) needs; the card flip
itself stays with Studio per the no-store-writes rule, as does the
still-open child task_0c78fba13bc152a1 (TESTRUNS/test-file side).

Staged-index sweep advice closed for restarts, and the stale landing
note corrected (2026-09-22, ~14:5x, run_1790087682481_6 for
task_7247a03061fd07b9 "Feed the staged-sweep warning into the next
dispatch", retry on the owner's note). Verified first: the previous
run's "main.cjs stays uncommitted" claim was already stale — a16b752
had swept the producer/consumer into the tree 23 s before the test
commit 1567a16, and d9cfc8c landed the row below, so "land the hunk"
needed no new commit. The retry's real gap was restart coverage: the
parked warning map is in-memory, so a Studio restart dropped it.
Chose the dispatch-time gitPorcelain probe over a file-backed store —
the index itself is the durable signal, so when no fresh parked entry
exists the dispatch probe re-derives the same CAUTION advice straight
from git ("the index currently holds ... BEFORE editing"); the
production probe is spawnSync, so no await joins the gate path, and
async git observation (the vm test hosts) rides the same await.
Updated the two prior cases (a staged index at dispatch now warns;
the aged-out case heals the porcelain to model a healed repo) and
added the restart case (map wiped as a restart would, probe still
advises; the probe reads git, never touches the map). Narrow gate:
`node --test tests/executor_end_to_end.test.mjs` solo 18/18 pass,
exit 0. Sliced neighbors green in one invocation (executor_lifecycle +
executor_parallel + backlog_engine + planning_execution: 53/53).
`npm run check` green (100 targets, no collisions, syntax ok). The
main.cjs probe hunk rode the sibling worktree session's path-limited
landing e3ad851 (its whole-file commit carried the already-in-place
probe alongside its own wiring); this commit adds the updated cases
and this row.

Sweep-advice change verified end to end for task_7247a03061fd07b9
(2026-09-22, ~14:2x, run_1790086311775_18 "Feed the staged-sweep warning
into the next dispatch"). The finish()-time sweep now parks its
staged-files warning on the dispatcher keyed by repo root, and the NEXT
dispatch into that repo carries it as collab advice
("CAUTION shared git index ... commit or unstage BEFORE editing") naming
the files; one read consumes it, a run that ignores it re-arms it through
its own finish sweep, and entries older than 30 minutes age out. Narrow
gate: `node --test tests/executor_end_to_end.test.mjs` solo 17/17 pass,
exit 0 (two new cases). Sliced neighbors green in one invocation
(executor_lifecycle + executor_parallel + backlog_engine +
planning_execution: 53/53). `npm run check` green (99 targets, no
collisions, syntax ok). `npm run test:fast`: one fail in eyes_worker —
the documented load-dependent read-timeout row — solo rerun 8/8 pass,
exit 0. Python contracts 246 OK; normalized-path lock green;
`npm run audit` ok, zero findings. The main.cjs side of the change stays
uncommitted on purpose: the file also carries the sibling agent-issues /
model-config in-flight hunks, so a path-limited commit now would sweep
them; it rides the combined in-flight tree landing card.

Full gate backing the combined in-flight tree landing (2026-09-22, ~14:1x,
run_1790086456428_22 for task_85b21602201d47e7 "Commit the combined in-flight
tree" — brain maps, agent-issues decision lane, Command inspect mode,
provider breaker, windows command-line port; booklet regenerated first via
`npm run build-booklet`, which brought `renderer/booklet.html` back in sync
with the edited renderer sources). `npm run check` green (99 targets, no
collisions, all selectors used, syntax ok). First `npm test`: 1937 tests,
1932 pass / 2 fail / 3 skip — both fails in `executor_end_to_end.test.mjs`
(the two staged-index warning cases), the parallel-stage contention class in
the table above, not the tree: solo `node --test
tests/executor_end_to_end.test.mjs` immediately after, 17/17 pass, exit 0.
Full `npm test` rerun then ran the whole chain green (Node stage exit 0,
Python contracts 246 OK, normalized-path lock "all checks passed").
`npm run audit` ok, zero findings. occlusion_probe skipped with its usual
capability-gated record (this desktop never emits Electron occlusion
events); no other skips or fails.

performance_render guard task closed with first-hand solo and in-suite
evidence (2026-09-22, 09:17–09:22, run_1790086407101_20 for
task_9e1fabae123a9443 "Guard performance_render flake", retry after the
unverified settlement). Verified the claimed hardening is real and landed
before crediting it: the 40 s kill/report contract (taskkill /T /F tree-kill,
exitCode race guard, PID/root timeout diagnostics, timer cleared on exit) is
committed in 3198c4d and the load-tolerant downloadCapture budget in
6f3b370/520e22b; both files have zero worktree drift. Deferred to the sibling
gate: at 09:16 the board showed a live `node --test
tests/performance_render.test.mjs` plus another suite and 82% CPU; launched
after they cleared (09:17:12, CPU 31%). Solo `node --test
tests/performance_render.test.mjs`: 2/2 pass, exit 0, wall 9.8 s (fixtures
4.5 s/5.1 s). In-suite `node scripts/run-node-tests.mjs` starting inside the
tail of the sibling 09:16 gate: 1937 tests / 1932 pass / 2 fail / 3 skipped,
both performance_render tests ✔ — fixtures 24.5 s and 6.1 s under that
residual load, inside the 40 s kill contract and 50 s test timeout. The two
failures are executor_end_to_end.test.mjs staged-index warning cases; solo
rerun 17/17, exit 0 on the same uncommitted tree (the known moving-tree /
parallel-load table row — sibling main.cjs / scripts/assistant.mjs edits in
flight, not this task's scope). The ~1/8 loaded-run exit-1 recurrence named
as remaining by the first attempt is closed by the rows below: the 14-run
loaded loop with no repro (run_1790028475698_40) and the captured-and-
classified full-contention signature (fixture-internal download timeout,
since covered by the pace-scaled downloadCapture budget). Logs:
%TEMP%\opencode\perf-verify\ (solo1.log, insuite.log, executor-solo.log).
No source changes this run; this entry is the only edit.

Fresh full-gate green rerun closing the integration-gate chain
(2026-09-22, 09:13–09:17, run_1790086242215_15 for task_94b29c15a3479597).
Purpose: the sibling-edits evidence task_336a62b5d249978f asked for — its
own green gate (run_1790081870798_93) explicitly required a rerun once
sibling runs landed further edits, and this run covers that in-flight tree.
Tree at HEAD a9b4671 with 32+ uncommitted sibling paths present and
untouched (main.cjs, preload.cjs, renderer/*, scripts/*, tests/* including
the new brains/provider-breaker/windows-command-line suites); no source
writes in the 3 minutes before launch, and the only electron group running
was the Studio app itself (one app's main/gpu/utility/renderer set, up
since 09:08:57), no test fixtures. `npm run check`: exit 0 (spec-collisions
198 specs, ALL-SELECTORS-USED across 5 stylesheets, check-syntax 99 files).
`npm run build-booklet`: exit 0. First `npm test` attempt (09:14, 1.5 min):
exit 1 on the serialized occlusion_probe suite — cleanest-of-3 lag 435 ms
against the ~0 expectation, samples [1589, 588, 435] — the known
environmental cover-window row, not a source regression; solo
`node --test tests/occlusion_probe.test.mjs` then passed 1/0, exit 0,
6.1 s. Second `npm test` (09:16–09:17:35): exit 0 in 1.4 min — node stage
171 suites (9 launching Electron), 1935 tests / 1932 pass / 0 fail /
3 skipped (capability-gated), serialized display suites each 1/1, Python
contracts "Ran 246 tests ... OK", normalized-path lock suite green via the
exit-0 chain. Full logs captured to temp (gate-check.log, gate-booklet.log,
gate-test.log, gate-test2.log, occ-solo.log). This row is the citable
gate-green artifact for closing task_336a62b5d249978f and
task_c1cf337d66009c14 on "sibling edits landed".

performance_render solo re-confirmation on the landed profiler tree
(2026-09-22, ~09:0x, run_1790085767760_3 for task_9892bbd6444a088e,
re-running the evening row's requirement on the current clock). No suite
load and zero electron processes at launch (the two concurrent-session
mefi-command-render fixture groups sighted at 09:00:09/09:04:10 had
exited, verified via Win32_Process). `node --test
tests/performance_render.test.mjs` solo: 2/0 pass, exit 0, wall 32.9 s
(fixtures 26.2 s/5.9 s - slower than the evening's 14.4 s with only
~0.03 GB free RAM reported by os.freemem() and ~17% CPU on 16 logical
cores, still far under the 40 s kill contract and 50 s test timeout).
Serialized display stage exactly as scripts/run-node-tests.mjs runs it,
one invocation per fixture: occlusion_probe 1/0, exit 0, 5.9 s (lag 0 ms,
worker drift 166 ms); eyes_toggle_electron 1/0, exit 0, 3.5 s. All three
runs left zero electron processes of their own (the only electrons after
were the concurrent session's 09:07:04 mefi-command-render group). Tree
at HEAD 18c1025, which includes the committed kill-contract hardening
and the load-tolerant downloadCapture budget
(tests/fixtures/performance-render-electron.cjs:133); concurrent
sessions' uncommitted work untouched. Confirms on the landed tree what
the evening row found in-flight: the timeout is environmental, not the
profiler change, and the classification follow-up is already closed by
the row below.

performance_render historical full-`npm test` contention signature verified
and closed (2026-09-22, ~08:4x, run_1790084276208_9 for
task_37a437c156658816 "classify historical full-npm-test contention
signature"). The historical-condition repro and classification were already
captured and landed by the 2026-09-21 night row below (run_1790036825250_4:
full `npm test` parallel stage plus serialized display fixtures plus a
node_modules OneDrive churn writer while the flake-loop harness ran the
performance_render suite); this attempt audited every on-disk artifact of
that capture instead of re-landing it, per the adopt-don't-clobber handoff.
Audit result — all committed claims reproduce from the files: run-20260921-
193144/meta.json (exit1Captured true, harnessKilled false, iteration 1 exit
1 in 80.2 s, before-snapshot 100% CPU / 45 MB free RAM / 39 node + 8
electron processes); iter-01/stdout.log (test 1 "real performance profiler
catches blocking work..." hit node:test's 50000 ms budget; test 2 failed
`Error: Profiler JSON download timed out` at
tests/fixtures/performance-render-electron.cjs:127:47, runFixture assert
1 !== 0); iter-01/desktop-host/report.json failure text identical, elapsedMs
10522. Classification per run-flake-loop.ps1's signature rules:
fixture-internal-uncovered (download-timeout + :127 stack frame) — the 5 s
will-download fixed budget inside downloadCapture() expired under host
saturation; explicitly not kill-contract-covered (no "Performance fixture
timed out: PID" marker, the 150 s harness hard kill never fired), not the
GPU-contention class (those suites pass solo), and not state corruption
(the in-suite performance_render copy survived slowed-but-green in the same
concurrent run). Current-tree check on this clock: the committed
load-tolerant downloadCapture budget (paceFactor-scaled 5-30 s, message
prefix preserved so the harness classifier still matches) is present at
tests/fixtures/performance-render-electron.cjs:132-138, and solo
`node --test tests/performance_render.test.mjs` passed 2/2 in 12.4 s with
zero leftover electron processes. Honest limit: the load-tolerant budget has
solo + synthetic-12-spinner evidence but has not been re-run under a fresh
full-`npm test` + churn condition on today's tree; the 2026-09-21 capture
remains the only under-condition repro, and the loop harness
(tools/logs/performance-render-flake-loop/run-flake-loop.ps1, gitignored)
is reusable as-is for that if it is ever wanted.

Full `npm test` gate green on the combined tree at HEAD 7dbd66f (2026-09-22,
~10:0x, run_1790082653725_120 for task_3762737ae0251810 "Full npm test gate —
follow-up ef8e2f"). The commits the earlier full-gate card waited on had
landed (Clear-confirm fixture 2415c29/45fa832, TESTRUNS UTF-8 repair 77bcc69,
a272 entry correction 7dbd66f), so the whole gate re-ran end-to-end over the
tree as it stands, sibling uncommitted work (main.cjs, renderer sources,
scripts/auditor.mjs, executor/performance-render test edits, auditor_catalogs
+ startup_resume suites) adopted intact and nothing clobbered; this run made
no source edits. Result: exit 0 — runner settle preflight passed, node stage
163 suites (9 launch Electron), parallel aggregate 1836 pass / 0 fail /
3 skipped; serialized eyes_toggle_electron 1/1 in ~3.3 s (baseline 2
fetches/300 ms, hidden 0/1200 ms, one resume snap, 6 fetches total);
occlusion_probe took its documented capability skip this time — Discord held
the win32 foreground, visibility never flipped within 15 s and rAF stayed
loud — the expected row of the table above, not a regression; Python
contracts 246 tests OK in 35 s; normalized-path lock all checks passed.
Full log: %TEMP%\opencode\npm-test-gate-ef8e2f.log. This is the exit-0
full-gate evidence task_3762737ae0251810 was carded for; it also supersedes
the 06:2x full-gate row below by covering the landed follow-up commits.

Green exit-0 full `node scripts/run-node-tests.mjs` re-landed on the current
tree after API-drop retries (2026-09-22, ~08:01, run_1790081829114_82 for
task_a272d75c6e9c5bf5 "Land green exit-0 full-suite run and close toggle
card"). The two attempts after the 06:26 green run (below) died before doing
any work — the autopilot worker lost its model API ("Cannot connect to API /
fetch failed", exit 1, planner+reviewer support) — a tooling outage, not a
repo problem, so no fix was needed beyond rerunning; this row supplies the
first exit-0 evidence against the tree as it stands now, with the sibling
session's uncommitted work adopted intact (main.cjs, renderer/boot.js +
startup.js + booklet.html, scripts/auditor.mjs, executor_resume test,
performance-render fixture, new auditor_catalogs + startup_resume suites)
and nothing clobbered. Preconditions checked at launch: desktop minimized
(Studio included), no sibling suite in flight (only Studio/MCP node+electron
processes), runner settle preflight passed. Result: exit 0 in 46 s —
parallel stage 163 suites (9 launch Electron), 1839 tests / 1836 pass /
0 fail / 3 skipped (the documented environment-conditional skips; the count
grew 1819 → 1839 from the sibling's two new suites, all green); serialized
eyes_toggle_electron 1/1 in ~3.2 s (baseline 2 fetches/294 ms, hidden
0/1200 ms, one resume snap, fetch gaps 294-1257 ms, 6 fetches total);
serialized occlusion_probe 1/1 strict native occlusion (document.hidden
signal, occluded rAF growth 0, lag 0 ms, worker drift 155 ms,
MessageChannel 1 ms, 0 console errors). `npm run check` exit 0 and
`npm run audit` 0 warnings on the same tree. Full log:
%TEMP%\opencode\node-tests-full-a272-rerun.log. Flipping
task_11085243b2d2452f to settled stays with Studio per the no-child-task
rule; this row is the evidence it needs.

performance_render downloadCapture made load-tolerant (2026-09-22, ~09:5x,
run_1790076573386_24 for task_2c6ba2f8206d1e61 "Make downloadCapture budget
load-tolerant"). Acting on the captured exit-1 in
tools/logs/performance-render-flake-loop/run-20260921-193144 (100% CPU, 45 MB
free RAM before the iteration; signature "download-timeout + :127 stack
frame", fixture report elapsedMs 10522 with every pre-export stage green
through hostFrozen): tests/fixtures/performance-render-electron.cjs
downloadCapture now probes its own main-process timer pace (250 ms sleep)
before the export click and scales the will-download deadline
5000·paceFactor, floored at the old 5 s and capped at 30 s to match the
capturePage tolerance; the "Profiler JSON download timed out" message prefix
is preserved so the flake-loop classifier still matches, and the fixture
report now records downloadBudget {paceFactor, budgetMs} for triage.
Fixture-only: no renderer/main/runner changes; sibling uncommitted work
(main.cjs, command-render-electron.cjs TESTRUNS row above) untouched.
Validation: solo `node --test tests/performance_render.test.mjs` 2/2 green
in 9.5 s (quiet host, factor 1.0 → 5 s floor, behavior unchanged); desktop
variant under synthetic load (12 busy node spinners on 16 cores) green with
the budget verifiably engaged at paceFactor 1.06 → 5300 ms, elapsedMs 4015;
`npm run check` all-green; eslint clean on the file. Honest limit: the full
saturation profile of the captured failure (memory-exhausted host) was not
re-created on this shared machine; tolerance beyond the probe rests on the
captured evidence plus the scaled headroom.

Full npm test gate green after fixing the command-render Clear confirm
regression (2026-09-22, ~06:29, run_1790076061072_1 for
task_416bb7bda070b8d0 "Rerun full npm test gate, land fixture changes",
resuming the interrupted run_1790041643677_1). The interrupted run's only
fixture edit (the Python updater contract reading docs/architecture.md)
was verified already landed in 96929cb; the working tree was clean at
pickup. First full `npm test` on this clock went red in the parallel stage
(1819 tests / 1815 pass / 1 fail) on command_render "real Command renderer
paints finite task nodes..." failing `Timed out: Clear empties the done log
through the host` (tests/fixtures/command-render-electron.cjs until():152
via :930) — and the solo rerun failed with the identical signature at a
0.36 GB free-RAM floor, which ruled out the documented GPU-contention class
(those pass solo). Root cause: a418a84 (2026-09-21 20:37, after the last
green full gate run_1790035430350_1) made Clear ask first through
window.MefiConfirm — a 12 s toast whose committing button nobody presses in
the offscreen fixture, resolving false, so the host clear never fires and
the fixture's 5 s until expires deterministically: committed test red on
committed code, missed because no full gate ran between a418a84 and here.
Fix: the fixture now pins the ask and approves it like a user — after
clicking cmd-done-clear it waits for the `#toast-host .toast-action`
"Clear" button and clicks it before the host-clear wait (fixture-only
change; renderer untouched, build-booklet rebuilt byte-identical, hash
f98dd2322a01). Evidence: `node --test tests/command_render.test.mjs` solo
1/1 exit 0 on the same starved host; full `npm test` rerun exit 0 through
the whole chain — parallel stage 1819 tests / 1816 pass / 0 fail /
3 skipped in 34.0 s (the documented environment-conditional skips, incl.
the in-process vm-modules source check), serialized eyes_toggle_electron
1/1 in 3.2 s (one hide/show toggle, no duplicates), serialized
occlusion_probe 1/1 strict native in 5.7 s (document.hidden occlusion,
occluded rAF growth 0, lag 0 ms, worker drift 166 ms, console errors 0),
python contracts 246 OK in 30.0 s, normalized-path lock checks all
passed; the runner's settle preflight reported no mid-run source drift.
`npm run check` clean (94 targets, 188 specs, CSS merge-skip/unused,
syntax) and `npm run audit` clean (0 findings) on the same tree. A
concurrent session's uncommitted work was landing around the run (the
eyes-toggle TESTRUNS entry 06:28, an in-flight session-continuity edit
to main.cjs last written 06:31 — after the gate finished) and was left
untouched; committing that work belongs to its own card.

Green exit-0 full `node scripts/run-node-tests.mjs` closing the eyes
toggle card (2026-09-22, 06:26, run_1790076152216_4 for
task_a272d75c6e9c5bf5, settling task_11085243b2d2452f "Stabilize eyes
toggle timing fixture" on this evidence). Preconditions verified before
launch, not assumed: the flake fixes are committed (ce3e6ec —
eyes_toggle/occlusion runner+fixture fixes; cb93e79 — occlusion
skip-on-external-destroy; plus the runner's tree-settle preflight
logged below), `git status` clean on HEAD 3138002, no sibling suite in
flight (the concurrent gate attempt's last test process had drained;
only MCP-proxy node processes remained), and the live Studio main
window (pid 26912) was minimized per the card's quiet-desktop
requirement. The run: exit 0 in 58 s with the memory floor at ~0.5 GB
available — parallel stage 161 suites, 1819 tests / 1816 pass / 0
fail / 3 skipped (including the documented environment-conditional
live-gateway and vm-modules skips); serialized eyes_toggle_electron
1/1 in ~3.1 s — baseline 2 fetches/298 ms, hidden 0/1200 ms, one
resume snap, fetch gaps 298-1256 ms, 6 fetches total — the log-tail
toggle assertion that used to drift (146 solo vs 158 in-suite) stable
in-suite; serialized occlusion_probe 1/1 strict native occlusion
(document.hidden signal, occluded rAF growth 0, lag 32 ms, worker
drift 160 ms, MessageChannel 1 ms, 0 console errors). This chain also
supersedes the sibling gate attempt minutes earlier
(npmtest-gate-run_1790076061072.log + command-render-solo-rerun.log:
command_render "Clear empties the done log through the host" red
in-suite and in a solo rerun under the same memory floor): that
transient-saturation reading is withdrawn — the red was the a418a84
Clear confirm gate, not load: the new done-log confirm toast left the
fixture's wait unanswered, and the identical solo run passes after
exactly one change, 2415c29 teaching the fixture to approve the toast
(command-render-solo-rerun.log red -> command-render-solo-fixed.log
green, 1/1). Full log:
%TEMP%\opencode\node-tests-full-a272.log (177 KB, kept).

Rotating in-suite vm ReferenceErrors root-caused to source drift, runner
gained a settle preflight (2026-09-21, night, run_1790038455313_19 for
task_b98d5abec0a9f2cc "Root-cause rotating in-suite vm ReferenceErrors").
Forensics on the two captured failing runs (node-tests-full.log /
node-tests-full2.log, 17:35/17:38): every reported failure is a
section()/vm-eval test throwing "ReferenceError: X is not defined" where X
(ASSISTANT_MAIL_RULE, assistantTakeMail, pickerHeld) is either stubbed in
the current test sandboxes or declared at the markers the current
main.cjs/renderer/idle.js answer — i.e. the eval'd slices came from bytes
that were not the settled tree. The reads themselves succeeded (no EBUSY,
no missing-section asserts), so the children read transient or stale
content while sibling sessions had those exact files mid-edit that evening
(the agent-mail session edited main.cjs/scripts/assistant.mjs, the callout
session edited renderer/idle.js; OneDrive sync lengthens the unstable
window). Which file is mid-edit rotates per run, which is why the failing
set rotated (executor_modes+expand_finished_guard vs
boot_poll_visibility+command_graph+command_visuals) while every file
passes solo against settled bytes. Discriminating evidence on the quiet
current tree: two full `node scripts/run-node-tests.mjs` runs (1738
tests) produced zero vm/section failures — run 1 failed only
performance_render (Profiler JSON download timeout) and run 2 only
command_render (initial painted task frames timeout, 73 s under the
active sibling session), both the separately tracked live-Electron
load flakes, not vm evals. Fix landed in scripts/run-node-tests.mjs:
before the parallel stage the runner fingerprints main.cjs, preload.cjs,
scripts/, renderer/, tests/ and data/models.json (content hash over
paths+bytes; data/'s live stores deliberately excluded or it would never
settle), re-checks after 1.5 s, waits up to 10 attempts for the tree to
hold still, and exits 1 with a named diagnosis instead of launching into
a mid-edit window; if the parallel stage fails and the fingerprint moved
meanwhile, it prints that the vm failures may be transient-content reads
before propagating the exit code. Algorithm self-test (stable pass,
content-change detect, second-change detect, unwatched-extension ignore,
re-stable) 5/5 in %TEMP%\opencode\preflight-selftest.mjs; `node --check`
clean; both full runs above exercised the real runner end to end
(preflight settled instantly on the quiet tree, no false-positive drift
diagnostics). Sibling concurrent suite runs: checked at task start, none
running (only MCP proxies and one other agent CLI). Not claimed here: a
green exit-0 full-suite run (the two verification runs each hit one known
Electron-under-load flake while the sibling session was active) — that
remains the toggle card's own gate; and the mid-edit window cannot be
closed for edits that start after launch, only diagnosed.

performance_render residual flake CAPTURED under real suite contention —
fixture-internal, uncovered by the kill contract (2026-09-21, night,
run_1790036825250_4 for task_3d33701ba75b4e48 "Capture residual flake
detail"). This closes the capture obligation left by the 14-run loaded
loop below and supersedes the child handoff's 19:15:35 "exit1Captured"
meta (run-20260921-191535): that record came from an intermediate harness
revision and is invalid evidence — exitCode null, no stdout/stderr
preserved, classification unclassified — it is retained on disk as a
buggy-harness artifact only. Valid capture: full `npm test` (pid 41816,
log npmtest-20260921-193008.log) plus a node_modules OneDrive churn
writer (2 s cadence, 5 min) ran while the current full-capture harness
(tools/logs/performance-render-flake-loop/run-flake-loop.ps1, per-iter
stdout/stderr + host snapshots) ran `node --test
tests/performance_render.test.mjs`. Iteration 1 (run-20260921-193144/
iter-01) exited 1 from the process itself (harnessKilled false, 80.2 s
vs ~10 s unloaded) under 100% CPU, 45 MB free RAM, 39 node + 8 electron
processes: test 1 "real performance profiler catches blocking work..."
hit node:test's 50000 ms budget, test 2 "desktop performance capture
measures real Electron processes..." failed with the exact historical
signature — `Error: Profiler JSON download timed out` at
tests/fixtures/performance-render-electron.cjs:127:47 (the 5 s
will-download completion timer in downloadCapture()), runFixture
assert 1 !== 0. Classification per the established rules:
fixture-internal-uncovered (download-timeout + :127 stack frame); the
kill contract's "Performance fixture timed out: PID" marker is absent
and its 150 s harness hard-kill never fired — the hardened kill
contract is not implicated. Root cause anatomy: the renderer's
profiler-export click -> will-download -> capture.json write pipeline
exceeds its fixed 5 s budget when the host is saturated; the in-suite
performance_render copy inside the same concurrent npm test survived
(36.3 s + 8.1 s, slowed but green), so the flake is a load-dependent
fixed-budget miss, not state corruption. Ambient-load note: the
concurrent suite itself degraded as predicted — serialized
occlusion_probe failed "rAF must stay silent while occluded
(growth=2)" this run (environment-conditional per run_1790035430350_1)
and the child's 19:15 concurrent suite failed executor_parallel
"session tool edits remain attributable" (0 !== 3) — both are
contention symptoms, not performance_render regressions. Stale
`%TEMP%\mefi-performance-render-*` dirs re-audited: 0 remain (the
fixture teardown reclaimed both once load subsided). Suggested
follow-up (out of scope here): make downloadCapture's 5 s budget
load-tolerant (deadline scaled to observed fixture pace or one retry)
— small fixture-only change, needs its own card. `npm run check` exit
0 after this row.

Full node suite green after the cap-boundary hysteresis, on top of the
memory-cap merge (2026-09-21, late night, run_1790036998516_6 for
task_29e6146a127aaf79, parent task_12e1b622aa97c583 "Cap boundary
hysteresis"). The change under test is the severe-memory cap's boundary
latch in scripts/machine.mjs (landed in 3198c4d, on HEAD 0c9ce23):
severeCapSamples consecutive readings below memorySevereFloorMB engage
the cap, the same count of consecutive readings at or above floor plus
memorySevereReleaseMarginMB release it, and recovery-band readings hold
the latch while resetting both streaks — so solitary 299/451 blips can
no longer toggle parallelism; tests/machine_capacity.test.mjs pins the
streak behavior. `node scripts/run-node-tests.mjs` exited 0 through the
whole chain on the current tree, which also carries the concurrent
sessions' uncommitted work (machine.mjs telemetry line, assistant.mjs
scope qualifier, commit-evidence and project-work tests): parallel stage
1732 tests / 1730 pass / 0 fail / 2 skipped in 42.1 s — the same two
known environment-conditional skips as run_1790035430350_1 (live
gateway Jev-model resolution without credentials; in-process vm-modules
source check needing --experimental-vm-modules); serialized
eyes_toggle_electron 1/1 in 6.6 s (baseline 2 fetches/285 ms, hidden
0/1200 ms, one resume snap, fetch gaps 285-1306 ms, 6 fetches total);
serialized occlusion_probe 1/1 strict native occlusion pass in 7.4 s
(document.hidden signal, occluded rAF growth 0, lag 0 ms, worker drift
158 ms, MessageChannel 0 ms, 0 console errors) — where run_1790035430350_1
had taken that probe's occlusionUnsupported environment skip. A first
invocation of the same runner minutes earlier went red under desktop
contention (parallel stage 97.4 s vs 42.1 s green): five red entries —
3 fail plus 2 cancelled — namely performance_render and node_paint_cache
50 s timeouts, package_privacy spawnSync ETIMEDOUT, eyes_worker 150 ms
store-read timeout, and the commit_evidence unscoped-check assertion;
every one of them passed in the green retry with no source change
between invocations, and the runner's exit-code chaining stopped that
red attempt before the serialized fixtures ran at all. No
hysteresis-related failure appeared in either attempt — the
machine_capacity suite passed both times.

Independent re-run of the same runner plus the npm-test tail
(2026-09-21, late night, run_1790038076467_15 for the same
task_29e6146a127aaf79, verifying the row above on the current tree).
`npm test` attempt 2 on this clock confirmed the runner green through
every stage — parallel stage 1732 tests / 1730 pass / 0 fail / 2 skipped
in 53.3 s (the same two environment-conditional skips), serialized
eyes_toggle 1/1 in 4.7 s (baseline 2/304 ms, hidden 0/1200 ms, one
resume snap, 6 fetches total), serialized occlusion_probe
environment-skip (this desktop never emitted occlusion events while a
Claude window held the foreground, matching the run_1790035430350_1
precedent) — and then exposed a real regression the node-only runner
cannot see: the python unittest stage failed
test_fixture_local_replies_are_grounded because 0ac92e8's longer help
line ("open issues and tickets") pushed "roster" past the 600-char
REPLY_MAX_CHARS clip in scripts/assistant.mjs's localReply help case
(committed test red on committed code). Fixed on this clock by trimming
the help wording only ("the whole roster out" -> "the roster out", "They
talk to each other too" -> "They talk to each other", "read what they
said" -> "read the mail", "the request inbox and quiet sessions" ->
"the inbox and quiet sessions"; "request inbox" remains in the agents
line) so the clipped reply again ends at "sends the roster out." with
every asserted piece inside 600 — the python test is green solo and the
node help-routing suite still passes. Two other npm test attempts on
this clock went red purely from host saturation (0.18 GB free RAM,
Memory Compression 1.3 GB, CPU 55-74% from Discord, two Claude
sessions and a Defender scan): performance_render Profiler-JSON
download timeouts (one with the kill-contract "Performance fixture
timed out: PID" marker), startup_render 65 s and task_overview_render
45 s node:test budget timeouts — all in the documented
load-dependent classes above, no source regression, and
machine_capacity (the hysteresis pin) green in every attempt.

"Land the fixture/runner files once green" audit (2026-09-21, night,
run_1790036793362_3 for task_bc33fdd783d99ad5, re-carded todo from the
task_073a02b3a82eec7d gate family). The deliverable was verified already
landed, not re-landed: 3a6ef13 carries the fixture files
(command_graph, command_visuals, executor_continuation,
verification_drain) with its green-gate TESTRUNS row, ce3e6ec the
eyes_toggle/occlusion runner+fixture fixes, cb93e79 the occlusion
skip-on-external-destroy hardening; `git status` shows zero pending
diffs on scripts/run-node-tests.mjs, package.json, tests/fixtures/ or
the serialized fixture tests, and the only uncommitted test files
(commit_evidence, project_work + 8 modified) belong to the
commit-evidence family under its own commit card. Fresh gate attempts
on this attempt's clock could not reproduce green purely from host
load — machine at a 0.38/13.77 GB memory floor: full runner run 1 red
(occlusion_probe lag samples 173/1901/1303 ms under parallel-stage
contention; solo rerun exit 0, skipped via the cb93e79 guard with the
forensic pointing at an external foreground process closing the probe
window), full runner run 2 red on a different, diff-free committed
fixture (node_paint_cache "No pixel fixture report" — the documented
Electron-under-load class). No fixture or runner file was edited to
force green; the combined-tree full gate stays carded separately
(task_3762737ae025181) and should rerun on an unloaded machine.

Second-user reports: schema-less OpenCode store, "open issues" reply,
planning modal blind to existing maps/tickets (2026-09-21, night).
Reports came as Discord screenshots from another machine, so nothing
reproduced locally. (1) "Store unavailable · no such table: session":
`storePresent` in scripts/eyes.mjs now checks sqlite_master (5 s cache,
cleared by closeReadDb) and a store file carrying none of
session/message/part/todo reads as empty; a partial store (fixtures build
only `part`) still reads, and a read of a missing table still throws.
New `storeStatus()` (on the eyes-worker allowlist) explains missing /
no-session-table / legacy storage/ layouts; eyes:state, the watcher's
problem list and usage:tracker carry its note, and the Command empty
card shows "No sessions in the store yet" with the fix instead of a
modal. (2) "What are the open issues currently in the project?" fell to
chat and echoed focus + memory; the tasks intent now matches open
issues/tickets/bugs phrasings (queue cleaning and the fix pass keep
their routes) and the reply adds the repo's tracker line from the new
`projectWork` fact. (3) New scripts/project-work.cjs reads the
mattpocock-skills layout (docs/agents/issue-tracker.md, wayfinder maps
and tickets under .scratch/<effort>/, `gh issue list` for GitHub
trackers with a 6 s timeout) plus agents/skills/commands from .claude/,
.opencode/, opencode.json, ~/.claude, ~/.config/opencode and installed
Claude plugins; planning:list returns it as `existing` and the modal
renders "Already in this project" with a Plan-from-this-map button.
(4) Usage panel "Unknown" for unpriced calls now reads "unpriced" ($0
when no calls). Evidence: tests/project_work.test.mjs 5/5,
eyes_missing_store 4/4 (two new), assistant_question_routing,
planning_service, planning_ui (new cases) green; full
run-node-tests 1732 tests: first run 1 fail (executor_parallel's
part-only fixture, fixed by the any-core-table rule), rerun 2 fails
that pass alone (node_paint_cache, performance_render — Electron
fixture timeouts under load), 1728 pass otherwise; npm run check exit 0
(91 targets, 179 specs, CSS all used); npm run audit 0 findings;
build-booklet rebuilt renderer/booklet.html; fake-bridge browser preview
showed the modal panel, Plan-from-map filling the destination, and the
Command card's store note. Uncommitted; peer sessions have other
uncommitted edits in the same tree (explorer.js, machine.mjs,
receipts.mjs and their tests).

Commit-evidence verification loop closed on the remaining-text gate
(2026-09-21, night, run_1790035904812_8 for task_326aafb524dcb758).
The prior attempt's feature work (claimedCommitHash + commit branch in
verifyCompletion, commitEvidence in scripts/eyes.mjs, eyes-worker
allowlist, main.cjs evidence.commits prefetch, runner-observed-commit
receipt trust, unit + real-git tests) was re-verified present and green,
and its deployment was proven, not assumed: sha256 of String(
verifyCompletion) from this tree equals evaluator.sourceSha256
e51b386ebc464a928ae896c5b8797252f7658be02c72977f59eca9a1c0644ca4 in
receipt rcp_ccc78643aae122d6 — the live app was already evaluating with
the new code when it failed. The loop's true cause was the receipt's
input outstanding: true: noRemainingWork rejected "none in scope"
(the attempt's remaining text) and the outstanding gate fires before
any evidence branch, so commit evidence never got the chance.
Fix: noRemainingWork (scripts/assistant.mjs) accepts an optional
"in/within (this) scope" qualifier on its none/nothing/no-remaining
phrases; guards pinned in tests/verification_checks.test.mjs keep
"none of the tests pass" and "none in the other module" outstanding.
Evidence: node --test verification_checks + commit_evidence +
executor_result_protocol 17/17 pass; npm run check exit 0 (90 targets,
178 specs); npm run audit 0 findings; end-to-end repro of the exact
prior receipt shape now returns verified ("1 recorded check(s)
passed", outstanding false) while an unobserved commit claim still
fails. Uncommitted-tree commit + dist payload file re-sync remain with
the commit-owner card; full npm test gate is carded separately.

Cover-window interference verification re-pass (2026-09-21, night,
run_1790035748558_5 for task_17537ddbe6106840, retry after
run_1790031638041_10's recorded checks could not be confirmed).
Re-established ground truth on HEAD 0c9ce23: the coverLost work is
committed (cb93e79 — occlusion-probe-electron.cjs cover "closed"
listener with the coverTeardownStarted self-destroy flag plus
coverLostRecord routing in finish(), occlusion_probe.test.mjs skip
before any per-phase assert), and this session re-proved every claim
from scratch rather than trusting the report: `npm run check` clean
(90 targets, 178 specs, css, syntax); serialized `node --test
tests/occlusion_probe.test.mjs` passed strict native occlusion
(document.hidden, occluded rAF growth 0, lag 0 ms, 1 pass / 0 fail);
and the live interference itself, reproduced via an external Win32
WM_CLOSE posted to the "occluder" cover mid-occluded-measure —
fixture-direct exited 0 with the coverLost record (phase=
occluded-measure, trigger, coverDestroyed=true, measuredRafGrowth=
null for the never-finished measure) and the same close under the
node harness yielded 1 skipped / 0 fail / exit 0 with the full
diagnostic line (occlusion detection, foreground identity, timeline
tail). The earlier verification failure was session check-recording,
not the tree: the flagged changed files are the concurrent sessions'
uncommitted work, untouched here.

Memory-cap telemetry surfaced in the Explorer Machine panel and briefing
facts (2026-09-21, night, run_1790035560126_2 for task_c87b4bfb6577188c,
parent task_653bec47a4549e05 "Persistent-memory guard — follow-up e2b151").
This row also logs run_1790027578783_19, the parent build that authored the
severe-memory parallelism cap (severeCapSamples hysteresis, holdKind
"memory-cap", resources.memorySevereCapped in scripts/machine.mjs plus the
machine_capacity and assistant_readiness_reply coverage) and left the UI
surfacing as this card's scope; that code landed in 3198c4d (verified via
git log -S memorySevereCapped) and its full-gate runs are logged below
(run_1790028566027_42, run_1790035430350_1). This attempt:
scripts/machine.mjs describe() now pushes "Severe-memory parallelism cap
still latched — new worker starts stay capped until free memory recovers"
whenever memorySevereCapped is true without the active memory-cap hold (the
drained-pool case where admission is clear for one worker but parallelism
is not — tests/machine_capacity.test.mjs pins both the hold-reason summary
and the latched-clear summary); renderer/explorer.js renderMachine reads
status.capacity.resources and shows a "memory cap" badge (trains tone, info
tint, hover title) while the latch holds, keeps "busy" under the active
hold, and reverts to idle/free when the latch releases
(tests/explorer_ui.test.mjs drives the onMachineStatus feed through
latched-clear, active-hold and released states); scripts/assistant.mjs
buildFacts adds memorySevereCapped to the executor capacity resources
allowlist beside holdKind/memoryShortfall/memoryWarning, with the
latch-clear fixture pinned in tests/assistant_readiness_reply.test.mjs.
Booklet rebuilt (hash f98dd2322a01, unchanged model set). Verification:
node --test on machine_capacity + assistant_readiness_reply + explorer_ui
38/38 pass; npm run check clean (90 targets, 178 specs, css merge-skip and
unused selectors, syntax). The concurrent commit-evidence session's
uncommitted work (main.cjs autopilotHousekeeping, the verifyCompletion
block in scripts/assistant.mjs, scripts/eyes-client.cjs, scripts/eyes.mjs,
scripts/receipts.mjs, tests/verification_checks.test.mjs, untracked
tests/commit_evidence.test.mjs) was left untouched — the assistant.mjs
edit here is the buildFacts allowlist line only. Full npm test not run in
this attempt; the three touched suites plus the check gate cover the
change, and the full-gate baseline for this tree is logged in
run_1790035430350_1 above.

Full npm test re-run green after the severe-memory parallelism cap
merge landed in commits (2026-09-21, night). Run run_1790035430350_1
for task_cf5dbf3b66810435 (parent task_1a265efeeb6cbdd3
"Persistent-memory guard"), the verification retry after the original
green run could not be confirmed: that run's TESTRUNS row stands (see
run_1790028566027_42 below) and its only leftover, the then-
uncommitted cap code, has since landed, so this attempt re-proved the
gate on the current tree. Pre-run verification: HEAD 0c9ce23 carries
the cap (3198c4d touches scripts/machine.mjs — the severeCapSamples
hysteresis — and tests/machine_capacity.test.mjs, confirmed via git
log) plus the later cb93e79 and 0c9ce23, while the concurrent
session's uncommitted verifyCompletion/commit-evidence work (main.cjs,
scripts/assistant.mjs, scripts/eyes-client.cjs, scripts/eyes.mjs,
scripts/receipts.mjs, tests/verification_checks.test.mjs, untracked
tests/commit_evidence.test.mjs) sat in the worktree untouched. Full
`npm test` exited 0 through the whole chain: the main node stage 1719
tests / 1717 pass / 0 fail / 2 skipped in 41.3 s — the same two known
environment-conditional skips as before (the live gateway Jev-model
resolution without credentials, and the in-process vm-modules source
check needing --experimental-vm-modules); serialized eyes_toggle 1/1
(3.5 s, fetch gaps 295-1264 ms, 6 fetches); serialized occlusion_probe
took its documented occlusionUnsupported environment skip this time
(1 skip / 0 fail, 19.0 s: this desktop never emitted occlusion events
— cover shown focused but visibility never flipped and rAF never went
silent within 15 s, 8 focus reassertions — where run_1790028566027_42
and cb93e79's landing run both saw the strict native pass); python
contracts 246 OK in 48.5 s; normalized-path lock checks 6/6 "all
checks passed". The suite grew 1695 → 1719 tests since that run
(landed sibling work plus the in-flight commit-evidence tests). The
concurrent session's uncommitted work remains uncommitted for its
owner; committing it (and this row) is follow-up scope, not test
scope.

Occlusion-probe cover guard landed, in-flight tree remainder closed
out (2026-09-21, night, run_1790031887248_14 for
task_65726c87fbcd7cf9, commit owner for the in-flight tree). The
dirty-tree remainder after 3a6ef13 was the coverLost half of the
parent hardening task ("Harden occlusion-probe fixture against
external window destruction"): tests/fixtures/occlusion-probe-
electron.cjs learns the mirror-image guard (cover "closed" listener
with a coverTeardownStarted flag so fixture-requested destroys never
fire, coverLostRecord carrying phase/trigger/occlusion detection/rAF
growth/foreground/timeline tail plus any suppressed failure verbatim,
finish() routing it to a clean exit) and tests/occlusion_probe.test.mjs
skips with that reason before any per-phase assert, exactly like
windowLost. Reviewed the full diff hunk by hunk, then serialized
`node --test tests/occlusion_probe.test.mjs` passed strict native
occlusion (document.hidden signal, occluded rAF growth 0, lag 0 ms,
worker drift 161 ms, 1 pass / 0 fail, no skip — the interrupted
run_1790030986320_1 ERR_ASSERTION exit-1 tail was that same probe
under interference) and `npm run check` clean (90 targets, 177 specs,
css, syntax). Not run here: the full npm test gate — 3a6ef13's gate
was green on this tree's siblings and the changed files are exactly
the serialized probe above. The one-line package-lock.json
"license": "MIT" sync (package.json already declared it at HEAD;
stale lock from a later npm install) committed separately.

Full npm test gate green, verification-settlement work landed
(2026-09-21, late evening, run_1790031327079_1 for
task_073a02b3a82eec7d, resuming the interrupted
run_1790031092452_3). The uncommitted tree (kickVerificationSettlement
dwell/retry re-arm and shared base checks in main.cjs, verifying-orb
label ranking in renderer/idle.js, the four new fixtures in
tests/command_graph / command_visuals / executor_continuation /
verification_drain, AGENT_LOOP.md notes, booklet rebuilt to the same
hash f98dd2322a01) was verified end to end: the first full `npm test`
hit the known eyes_worker "read past the timeout" load flake in the
parallel stage (1 fail of 1716; passes 8/0 alone, same signature as
the 2026-09-21 entries above); the rerun was fully green in one
invocation - parallel stage 1716 tests / 1714 pass / 0 fail / 2 skip,
serialized eyes_toggle_electron 1/0 (fetch gaps 292-1300 ms, 6
fetches), serialized occlusion_probe 1/0 (lag 0 ms, worker drift
163 ms), python contracts 246 OK, normalized-path lock checks ok,
exit 0. `npm run check` clean (90 targets, 177 specs, css, syntax)
and `npm run audit` ok (0 findings) on the same tree. Not run: a
live app session watching a card settle through the new kick.

performance_render isolated re-run, timeout confirmed environmental
(2026-09-21, evening, run_1790030471057_2 for task_9892bbd6444a088e,
resuming the interrupted run_1790030285727_13). With zero electron
processes on the desktop (the interrupted run's leftover electron.exe
PIDs had already exited on their own; verified via tasklist + Win32_Process
before and after) and no suite load, `node --test
tests/performance_render.test.mjs` passed twice back-to-back: 2/0 then
2/0, exit 0, wall clock 14.4 s and 12.0 s, fixtures 7.3/5.7 s and
5.2/6.5 s - an order of magnitude under the 40 s kill contract and 50 s
test timeouts. Environment pinned before/after: 16 logical cores, 0.57 GB
free RAM, ~23% CPU load, HEAD ce3e6ec with the concurrent sessions'
uncommitted work untouched (the in-flight 25-line kill-contract hardening
in tests/performance_render.test.mjs is the only profiler-area delta; its
taskkill /T /F path never fired and both runs left zero leftover electron
processes; the only %TEMP%\mefi-performance-render-* dirs remaining are
the pre-existing Sep 19 / Sep 21 17:03 stale ones). Conclusion: the 50 s
timeout seen in run_1790028119882_30's full `npm test` reproduces only
under shared load - it is environmental, not caused by the in-flight
profiler change. Remaining: reproduce under the historical full-`npm test`
contention condition to classify the exact signature (TESTRUNS residual
note above), using the reusable flake-loop harness.

Agent-to-agent mail channel (2026-09-21, evening, "Agent-to-agent
communication" session; shared tree, uncommitted). Roster seats can now write
each other notes: scripts/assistant.mjs gained a pure mail section beside the
intel one (sendMail / inbox / readMail / rolesWithMail / mailLines, state.mail,
MAIL_CAP 48 rows, MAIL_UNREAD_PER_ROLE 6, read notes age out after an hour,
unread mail makes its recipient due in dueRoles, digest.chatter and
facts.chatter carry the lines, the "agents" local reply adds "Said to each
other"). main.cjs delivers it: assistantSendMail / assistantDeliverMail /
assistantTakeMail next to assistantReportIntel, assistantStart hands a job its
unread notes as entry.inbox, assistantSettle sends a result's messages[] (at
most three), the watcher writes the keeper (stale sessions) and the auditor
(collisions), the machine writes the foreman (canStart false / unhealthy), the
auditor, compactor and keeper write the foreman/compactor, the foreman writes
the thinker, the overseer sends its say to every role it wakes, a builder's
MEFI_CALL writes the seat it calls, and the brief/grow/improve prompts share
ASSISTANT_MAIL_RULE (facts.chatter, facts.inbox, optional messages[] reply key
relayed by the briefer and build jobs). Renderer: a "mail" event case in
idle.js draws a packet sender -> recipient with send/receive bubbles and the
assistant card lists "Said to each other"; tree3d.js draws the same packet;
styles.css adds .assistant-mail; booklet rebuilt (hash f98dd2322a01, shared
with the performance session's booklet.js change). Tests: new
tests/assistant_mail.test.mjs (12 tests: pure API, bounds, round trip, dueRoles
pull, host helpers via vm, wiring assertions). The vm-host suites needed the
new collaborators stubbed (assistantTakeMail / assistantDeliverMail /
assistantSendMail) in tests/assistant_pool.test.mjs,
tests/executor_handoffs.test.mjs, tests/assistant_coordination.test.mjs and
tests/fixtures/host_executor.mjs, and tests/expand_finished_guard.test.mjs now
slices the shared ASSISTANT_MAIL_RULE const with each prompt array - without
those, ~30 unrelated tests fail with ReferenceError (the other session saw the
same six in executor_modes/expand_finished_guard before the fix). Results:
node scripts/run-node-tests.mjs first pass 1707 tests / 1697 pass / 7 fail
(the six above plus eyes_worker "read past the timeout" and performance_render
timing out at 50 s under the shared load); after the stubs, executor_modes +
expand_finished_guard + eyes_worker 37/0, performance_render 2/0 alone,
assistant_* + agent_modes + planning_assistant + executor_handoffs 161/0,
node scripts/assistant.mjs --self-test 184 checks ok, npm run check clean,
python -m unittest tools.test_mefi_studio_assistant tools.test_builder_intel
tools.test_mefi_studio_builder_intel 72/0. Not verified: a live app run of the
packet drawing (no preview launched); the performance_render 50 s timeout is
the known load flake, not a regression.

Command frame pass (2026-09-21, evening). Renderer-only change:
renderer/idle.js (callout placement ranked once per pass with an agent-host
set and one shared Intl.Collator, the label grid answering leader-vs-orb
queries, rgb/rgba and speechLines memoized, drawNodeSurface painting halo
and body under one transform block) and renderer/booklet.js (studioLog
bounded to the newest 400 lines); renderer/booklet.html rebuilt (hash
f98dd2322a01, which also carries the concurrent agent-mail session's
edits). `npm run check` passed (90 targets, 177 specs, css clean, syntax
ok). `node scripts/run-node-tests.mjs` on the shared tree: 1707 tests /
1699 pass / 6 fail / 2 skipped in 53.5 s; the six failures are all in
tests/executor_modes.test.mjs and tests/expand_finished_guard.test.mjs,
which exercise main.cjs and scripts/assistant.mjs while the agent-mail
session had both files mid-edit (neither test loads renderer code). Every
Command and renderer suite passed (command_visuals, command_performance,
command_render in real Chromium, node_paint_cache with a max pixel delta of
1 at DPR 1, 1.5 and 2, catalog_renderer, jev_routing_ui,
performance_render), and the two exclusive fixtures each passed in their
own invocation afterwards (eyes_toggle 1/1, occlusion_probe 1/1). The
before/after frame numbers are in PERFORMANCE.md (top section).

performance_render residual-flake loaded loop, no repro (2026-09-21, evening,
run_1790028475698_40 for task_3d33701ba75b4e48). Observation-only loop harness
(`tools/logs/performance-render-flake-loop/run-flake-loop.ps1`, gitignored)
ran `node --test tests/performance_render.test.mjs` 14 times with full
per-iteration capture (verbatim stdout/stderr, exit code, duration, report.json
plus profiler PNGs via MEFI_PERFORMANCE_CAPTURE_DIR, host CPU/free-RAM and
electron/node process counts before/after): round 1 idle baseline + 7 runs
under 4 CPU spinners (11-22s each), round 2 baseline + 5 runs under 12 of 16
logical cores spun (fixture slowed to 38-53s - real pressure), all exit 0 with
report.errors/networkAttempts/processAttempts empty. The hardened kill contract
(uncommitted 40s `taskkill /T /F` hunk) never fired and left zero leftover
electron processes; pre-existing stale `%TEMP%\mefi-performance-render-*` dirs
(Sep 19, Sep 21 17:03, from earlier failed runs) and ~500-650MB free RAM confirm
this host runs near overload. The same-day full `npm test` in run_1790028566027_42
(1695 tests, exit 0) also saw no recurrence. Historical signatures stay
unclassified: the pak-load failure and the fixture-internal `Profiler JSON
download timed out` (`tests/fixtures/performance-render-electron.cjs:127`,
5s will-download deadline - not covered by the kill contract, which only handles
the 40s-hang case) did not recur under synthetic load. Remaining: reproduce under
the historical condition - full `npm test` contention (parallel node stage plus
serialized display fixtures, multiple concurrent Electron launches) plus OneDrive
sync churn on node_modules - then classify via the same signature rules; the loop
harness is reusable as-is.

Full npm test after the severe-memory parallelism cap merge (2026-09-21,
evening). Run run_1790028566027_42 for task_cf5dbf3b66810435 (parent
task_1a265efeeb6cbdd3 "Persistent-memory guard"). Pre-run verification: the
cap change is present in the working tree (uncommitted, adopted as-is) —
`scripts/machine.mjs` latches `severeMemoryCap` on any under-floor sample
(300 MB severe floor), releases only at floor + release margin, and reports
holdKind "memory-cap" with runningCount in the reason while recovering;
`tests/machine_capacity.test.mjs` covers the latch outliving the floor, the
recovery band refusing re-admission on the memory override, and the distinct
holdKind. Full `npm test` (unmodified tree, concurrent sessions' uncommitted
work untouched) exited 0 through the whole `&&` chain: the main node stage
1695 tests / 1693 pass / 0 fail / 2 skipped in 47.8 s — the two skips are the
known environment-conditional ones ("live: the gateway resolves the pinned
Jev model" without credentials, and the in-process vm-modules source check
that needs --experimental-vm-modules); the two exclusive Electron fixtures
each ran in their own invocation and passed: eyes_toggle 1/1 (3.6 s,
load-tolerant span judgement) and occlusion_probe 1/1 strict native
(6.3 s — occlusion via document.hidden, occluded rAF growth 0, worker-channel
lag 0 ms); `python -m unittest discover -s tools` 246 OK in 43.7 s;
`node tools/test_normalized_path_lock.mjs` 6/6 with "all checks passed". The
previously documented performance_render Electron Profiler flake did not
recur in this run. The memory-cap code and its tests remain uncommitted in
the worktree alongside the other in-flight session work; committing them is
the parent task's follow-up.

check-css CRLF normalization (2026-09-21, evening). Build of
run_1790028119882_30 for task_f2faf80852cb9049: made
`scripts/check-css.mjs` line-ending agnostic — `cascadeWinners` now folds
`\r\n`/`\r` to `\n` in memory (single funnel for the default HEAD-vs-worktree
mode, the two-file form and every `--merge` side through `mergeResolution`;
files are never rewritten). Reproduced the reported failure first
(`node scripts/check-css.mjs` → `CASCADE-DIVERGED: 7 mismatch(es)`, all
`\r\n`-vs-`\n` inside multi-line values), then exit 0
`CASCADE-EQUIVALENT: winners identical for all 6401 ... keys` after the fix.
Regression tests added: CRLF-candidate equivalence + real-change-still-diverges
unit tests and a two-file CLI CRLF case in `tests/check_css.test.mjs`, and a
CRLF-resolution-vs-LF-git-sides case (clean, plus reverted still flagged) in
`tests/check_css_merge.test.mjs`. `node --test` on the three check-css suites
37/37; `npm run check` clean (90 targets, 176 specs, css merge-skip/unused,
syntax); `npm run audit` clean (0 findings); `node --test
tests/auditor_dom.test.mjs` 4/4 (auditor imports findUnusedSelectors —
behavior unchanged). Full `npm test`: `tests/performance_render.test.mjs`
fails (Profiler JSON download timed out — Electron fixture under load, file
modified by a concurrent session; same class as the documented
eyes_toggle/occlusion Electron flakes) — not touched by this change, which is
pure-Node CSS comparison. Concurrent session's uncommitted work left
untouched.

TESTRUNS flake triage: eyes_toggle_electron + occlusion_probe (2026-09-21,
evening, run_1790028053881_29). Adopted and completed the uncommitted fixture
work already in the tree rather than rewriting it. Root cause reproduced, not
guessed: recreating the old serialized stage (both display fixtures in one
`node --test` invocation, the pre-fix `runGroup(exclusive)` shape) plus four
CPU spinners fails eyes_toggle with "show must snap exactly one immediate
refresh (got 2)" — the occlusion fixture's always-on-top cover reasserts
`app.focus({ steal: true })` every 2s, flapping the eyes window's visibility
so the shipped listener correctly snaps once per real visibilitychange. The
landed fix is the combination already staged in the worktree:
`scripts/run-node-tests.mjs` now gives each exclusive fixture its own
invocation (`node --test a b` runs files concurrently); the log-tail fixture
judges phases load-tolerantly (fetch counts awaited with deadlines, the
hidden phase judged by fetches stamped `document.hidden` at call time,
doubling read from fetch timestamps, the window pinned always-on-top), with
the test wrapper's count-based `<= 6` doubling window replaced by the same
span judgement and the stale "while minimized" message corrected; the
occlusion fixture recognizes external window destruction (`windowLost`:
phase, trigger, window/cover state, Win32 foreground identity, timeline
tail) at its shared exit and the test skips with that reason — the live app
holding the desktop destroying the probe window mid-occluded-phase is a
diagnostic, not a contract failure. Verified: `node --test
tests/eyes_toggle_electron.test.mjs` isolated 1/1; `node --test
tests/occlusion_probe.test.mjs` isolated passes strictly natively
(document.hidden detection, occluded rAF growth 0, worker-channel lag 0ms);
eyes_toggle under four CPU spinners alone passes (load tolerance holds —
the flake needs the window fight, which the runner separation removes); the
new stage shape (one invocation per fixture, sequential) under the same load
passes both; `node --check` on every changed file and `npm run check` (90
targets, 176 specs, CSS merge/unused, syntax) are clean. The adjacent
uncommitted performance_render kill-contract hardening (taskkill /T /F on
the fixture's own tree) parses and its `spawn` import is intact; it belongs
to the still-open residual performance_render task. Remaining: the full
`npm test` combined gate was not rerun end-to-end here (serialized-stage
evidence is the targeted equivalent), and the worktree changes are
uncommitted.

First-map plan verification, 7 ideas (2026-09-21, evening). Run
run_1790027371112_14 for task_plan_mubs2uat_0 — read/verify checklist, no
source changes: `npm run build-booklet` reproduced `renderer/booklet.html`
byte-identical (39 models, hash f98dd2322a01; git shows no renderer diff).
`npm run check:css` (default HEAD-vs-worktree mode) FAILS on this checkout
with 7 winner mismatches that are all pure CRLF artifacts — `core.autocrlf`
is true, the working copy is CRLF and the HEAD blob is LF; comparing both
sides LF-normalized through `cascadeEquivalence` gives 0 problems across 6401
winner keys, and the modes `npm run check` actually wires pass
(`--merge` skip-clean, `--unused` ALL-SELECTORS-USED over 4 stylesheets).
Gate itself is line-ending sensitive; follow-up filed. `npm run audit` clean
(0 findings, 0 warnings). Focused suites green: foreman_lag_gate 8/8,
verification_checks + verification_evidence 17/17, package_privacy 1/1
(payload data/ = curated.json + models.json only; source settings/projects/
cache never ship; live portable state preserved across rebuilds). Website
previewed over HTTP per website/README.md (`python -m http.server`): index,
wiki shell, pages.json, download and `wiki/pages/home.md` all 200, then the
server was stopped. Docs surveyed: GETTING_STARTED (npm ci → build-booklet →
npm start; clear ELECTRON_RUN_AS_NODE), AGENT_LOOP_VERIFICATION (verified
2026-09-19; claimed checks need session-attributed recorded execution),
FEATURE_AUDIT (partials: verification, collision sandboxing, photographer
role, Steam release). Concurrent session's uncommitted TESTRUNS.md /
run-node-tests.mjs / fixture edits left untouched.

Silent-probe resourcePass resume verification (2026-09-21, evening). Resume of
run_1790027270074_12 for task_9f795c0f862dd7ae: the interrupted session's two
code todos had already landed — `b1d4042` scoped the resourcePass silence rule
(main.cjs `samplerLagMs` gates the poll's lag on
`measureWorkerLag.cache?.silent`, so a frozen renderer feeds the sampler null
instead of the 1000ms sentinel) and `tests/foreman_lag_gate.test.mjs`'s
resource-pass test pins it — so this run verified rather than re-edited:
`node --test tests/foreman_lag_gate.test.mjs` 8/8 (including "the resource
pass applies the same silence rule"), the lag-gate trio
(`worker_responsiveness`, `machine_capacity`, `assistant_lag_gate`) 47/47,
`python tools/test_mefi_studio_machine.py` 7/7, `npm run check` clean (90
targets, 175 specs, CSS merge/unused, syntax), `npm run audit` clean (0
findings). Full `npm test`: the parallel `node --test` stage 1682 tests, 1680
pass, 0 fail; the serialized display stage had `eyes_toggle_electron` flake
under suite load (one fetch while hidden) and pass 1/1 isolated, while
`occlusion_probe` fails while the live Mefi Studio app holds the interactive
desktop — the probe window is destroyed mid-occluded-phase ("Object has been
destroyed" through `fixtures/occlusion-probe-electron.cjs` `run()`), which is
not the fixture's capability-gated skip path and is unrelated to the
resourcePass change (the fixture reads main.cjs only as text for the probe
expression); it needs a re-run without the live app on the desktop.

Mefi first map verification (2026-09-21, evening). Resume of run_1790021119814_13
(progress 0 at interruption) for task_86a2670145d882c9; no source changes were
needed — the prior session's first-map implementation is already committed and
all of the map's first-task verification commands pass on a clean tree:
`node --test tests/first_map.test.mjs` 6/6 and
`node --test tests/first_run_service.test.mjs` 9/9; `npm run build-booklet`
rebuilt `renderer/booklet.html` (39 models, hash f98dd2322a01) with zero git
diff; `npm run check:targets` ok (90 targets, 90 through the syntax pass, full
coverage); `npm run check:specs` ok (175 specs, unique basenames, no orphans);
`npm run audit` ok (0 findings, 0 warnings); full `npm run check` ok including
check-css merge/unused and check-syntax (90 files).

Coding tiers, Codex CLI and the Command usage dropdown (2026-09-21 16:00). Settings
› Coding workers gained a coding tier (`executorTier`: Auto / Free / Fast /
Heavy) with per-CLI tier models (`executorTierModels`) resolved by
`executorTierDefaults` in main.cjs (z.ai GLM pair on the plan, the first scan's
free pick, Claude Code's `sonnet`/`opus` aliases, otherwise the CLI default;
Free never falls back to a billed model and runs one worker at a time). Codex
is a fifth builder seat (`codex exec` on stdin, sandbox bypassed like the other
CLIs) and an assistant route (`codex exec --json -s read-only`, parsed by
`parseCodexCliResult`). The Command usage panel leads with the first live plan
account (Go windows or z.ai quota), then aligned rows, with an informative
collapsed header; the workspace usage tile follows the same lead. Validated on
a tree shared live with the menu-cleanup session (coordinated by message, no
overlapping regions): `npm run check` clean; `tests/executor_tiers.test.mjs`
(new, 8), model_auto_setup, executor_parallel, planning_routing,
jev_routing_ui, usage_tracker, usage_tracker_host, usage_tracker_ui,
first_run_service and the host batch (assistant_work_on, build_approval,
executor_delegation, executor_lifecycle, executor_modes) all green; the full
Node suite 1676/1682 under machine load, with each miss (eyes_worker timeout
case, performance_render, renderer_recovery, task_overview_render) passing
alone; Python contracts 246 OK. Browser check with a fake bridge on the built
booklet: Codex in both selects, tier switching updates the model field,
placeholder and status line, the usage dropdown renders lead + rows and the
collapsed header reads `Updated … · z.ai GLM 5h 40.5% · wk 12%`. Not run: a
real `codex exec` build (no paid run started).

Menu cleanup pass (2026-09-21, afternoon). The studio sidebar is one menu with
a visible grip on the left edge (`.sidebar-grip` inside the unchanged
`#workspace-sidebar-toggle`), four go-to rows with keycaps and badges, the
project list, an inline two-column tools grid (`#workspace-tools` is open by
default and exempt from nav.js's outside-click / Escape / activation folding;
`renderWorkspaceTools` now also drops `tasks` and `plans`, which the rows above
pin), a Settings / Music / Start here row and the "Make yourself at home"
drawer; the entry that owns the visible surface carries `aria-current="page"`
(`MefiNav.paintCurrent`, repainted on every `mefi:nav` and on menu open). Every
"More tools" menu (tabs row, sheet headers, the dock) shares `moreSummary()`:
glyph, label, turning chevron and one grouped glass card. Refresh and
Print / PDF moved from the header into the catalog toolbar; the opencode.ai
link moved to the footer. The Settings tab is one page of cards with a sticky
`#settings-nav` (booklet.js `wireSettingsNav` / `syncSettingsNav`; entries
whose card sits under a hidden `#studio-desktop` drop out, folded cards open on
jump). The Command rail's "Work settings" tab is "Agents" with an at-a-glance
strip (`renderAgentsGlance` in idle.js: Autopilot / Workers / Mode chips) and
glyph-led rows; every id the harnesses read is unchanged. The toolbar's quick
agent-mode select was removed and then restored: the Electron render fixture
asserts it stays in `.cmd-tools` with Live work collapsed. Validated:
`npm run check` (88 targets, every selector used), `npm run audit` (0
findings), `tools.test_mefi_studio_idle` + `tools.test_mefi_studio_booklet`
(27 OK), the renderer batch (sidebar, onboarding, nav_startup,
palette_keyboard, workspace_ui, auditor_dom, booklet_build, catalog_renderer,
jev_routing_ui, model_auto_setup, command_new_work: 119/119) and
`command_render` + `command_visuals` + `agent_modes` (pass after the restore);
`tests/onboarding.test.mjs` and `tools/verify_workspace.py` updated for the
pinned-rows exclusion (`[data-nav=explorer]` in the harness). The booklet was
rebuilt and walked in the browser build at 1440x900: sidebar, Settings,
Command rail Agents tab, dock and sheet-header menus, catalog toolbar.

Host-batch lag-gate re-run (2026-09-21). The 79 host-batch failures in the
launch-screen entry below were tied to the then-uncommitted silent-probe lag
gate; that work has since landed in `b1d4042` (machine memory-warn override
and the silent-probe rule in the foreman's lag gate) with test alignment in
`83a3ee5` (readSettings/machineMemoryWarnOverride). Re-run on the merged tree:
the lag-gate trio (`foreman_lag_gate`, `machine_capacity`,
`worker_responsiveness`) at 48/48 and the nine-file host batch
(assistant_loop, assistant_work_on, backlog_engine, build_approval,
executor_lifecycle, board_growth, projects, executor_resume,
executor_delegation) at 170/170, 0 fail; `npm run check` clean (88 targets).
The explorer state poll from the same snapshot is in place
(`renderer/explorer.js` `EXPLORER_POLL_MS` 5000 via `MefiBoot.pollStart`).

Launch screen and agent hold (2026-09-21). An interactive launch opens on a
project chooser inside the boot gate (`renderer/startup.js`, boot.js phase
`choose`) before any readiness step reads the workspace, and the assistant
service, executor fill, proactive pass and foreman ask all wait on
`autopilot.held` until the user presses **Open and start agents**, the
workspace's **Start agents**, the tray entry, **Resume** or **Work through
backlog** (`releaseStartupHold`; IPC `startup:state`, `startup:choose`,
`startup:begin`, which bypass the project-scope wrapper like `projects:*`).
Smoke, capture and CLI launches keep their automatic start; a renderer reload
never shows the screen twice; a saved pause still asks for Resume. Validated:
`npm run check` (84 targets, every selector used); the 244 Python contracts
(one pins the literal `window.MefiWorkspace?.ready?.({ retry })` in
booklet.js, kept); `tests/startup_screen.test.mjs` (7),
`tests/startup_hold.test.mjs` (5) and two new `renderer_startup` cases;
the renderer batch (renderer_startup, startup_screen, startup_hold,
catalog_renderer, workspace_ui, boot_poll_visibility, booklet_build,
explorer_ui, command_new_work, assistant_pool) at 119/119. The host batch
(assistant_loop, assistant_work_on, backlog_engine, build_approval,
executor_lifecycle, board_growth, projects, executor_resume,
executor_delegation) reads 91 pass / 79 fail: the same Work-on, cluster and
swarm set plus `logLine is not defined` in `readCapacity` that fails without
this change (the uncommitted lag-gate work); no failure references the hold
code. An offscreen Electron run of the real main process (fresh profile, two
seeded projects, network blocked, machine watch off) confirmed the screen
appears with every readiness step pending, nothing starts across the 1.5 s
service and 8 s executor timers, choosing the second project opens it, Start
agents releases the hold and starts the service, and a reload skips the
screen. The packaged copy was refreshed with `npm run package`.

Command view visual layer (2026-09-21, branch `command-visuals` in the
`mefi-studio-wt-command-visuals` worktree): backdrop scenes keyed to the colour
theme with an Ambience override (`renderer/idle.js` drawBackdrop), speech
bubbles beside the agents for hops, findings (→ leaving, ← landing), thoughts
and replies, the foreman's hand-out packet, per-role glyphs, status rings and
flight wakes shared with the rail through `MefiTree.agentGlyph`, and the
Done-tab Absorb that flies its records into the assistant orb and keeps the
last twenty on the assistant's card (`mefiStudio.cmdAbsorbed.<project>`).
`tests/command_visuals.test.mjs` (10 tests) covers scene selection and the
override, bubble lifetime, cap, expiry and hover hold, the remark prefix strip,
the two-line wrap, the hand-out, the per-project ledger cap and reload, every
role's glyph, every scene painting in motion and still, and the HUD, CSS and
API wiring. Validated the same day: `npm run check` clean (81 targets, every
selector used), `npm run audit` zero findings, the 20 vm-based renderer suites
at 266 pass / 0 fail, the 6 Electron render suites (command_render,
startup_render, node_paint_cache, tree3d_performance, performance_render,
task_overview_render) at 16 pass / 0 fail, and the idle, assistant, booklet,
tree_keyboard, palette and launcher Python contracts at 119 OK. A scratch
offscreen capture harness (an isolated booklet build against an in-memory
bridge: no store, no main process) produced the look-gate PNGs for every theme
scene, the three overrides, agents at work with bubbles and packets, the
absorb flight and both absorbed ledgers, with zero renderer errors.

Second pass the same day, same branch — callouts and focus: every session,
task, the hub and each agent working somewhere without a card gets a callout
(a leader at seventy degrees into a horizontal top bar, the numbered title
with a status mark and done/left counts above it, agent thoughts below it),
placed among fixed side × up/down × length candidates that avoid other
cards, the HUD and orbs, kept between frames, held briefly when blocked and
stepped aside to a compact label rather than overlapped (running work and
the card the user is on may take a crowded spot). Hover lifts a card and
softens the rest; a click focuses the node (camera by kind, a slow orbit
borrowed and returned on Esc) with everything outside the branch painted on
a second, CSS-blurred canvas (`#idle-layer-far`). Edges got per-relationship
styles (hub double, task dotted and marching, agent dashed, folded stippled,
done todo green) and a Card style control joined the Ambience pop.
`tests/command_visuals.test.mjs` grew to 18 tests (leader geometry, placement
routing/hold/step-aside, card content, edge styles, focus sets and the
borrowed orbit, drift, drawCallouts separation and hit-testing, wiring).
Validated: `npm run check` clean, `npm run audit` zero findings, the 17
vm-based renderer suites at 251 pass / 0 fail, the 6 Electron render suites
at 16 pass / 0 fail, the 119 Python contracts OK; the capture harness added
hover, task-focus, session-focus and Escape steps and reported the sharp
sets, the borrowed orbit and zero renderer errors.
