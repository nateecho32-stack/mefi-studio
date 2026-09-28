# Continuing: handoff (2026-09-28, afternoon)

Two things are open:
1. **The 0.4.5 build.** It started today and paused at about 13:10, when the account hit its usage limit (it resets at 2:10 pm Central). The work is partial and uncommitted, in worktrees on this PC only.
2. **Menu Batch 3.** This is the owner's decision, unchanged (section 2).

## 1. 0.4.5: agents send only what's new, logging, load times, Friends 2.0

**Plan.** The owner approved it on 2026-09-28. The full text is at `C:\Users\echor\.claude\plans\enumerated-hugging-fern.md` on this PC; it isn't in Git. Its sections:
- A: agent send and receive
- B: logging
- C: load times
- D: Friends 2.0, across Studio and the private `void-engine-bot` hub
- E: the commit skill
- F: tabs and menus
- G: framework answers
- H: Linux
- I: the tool-bridge roadmap
- J: order of work and owner actions
- K: verification

The owner's decisions:
- **Hold the 0.4.5 tag** until A–D land.
- **Agents' older history** defaults to the whole project (`agentTools[role].history`).
- **Old logs are archived and all kept,** in a local folder OneDrive doesn't sync.
- **The hub** stays on the owner's PC, portable, and holds a YouTube Data API key.
- **Same Wi-Fi connects automatically,** plus signed invite links and guest passes. Guest passes may slip to 0.4.6.
- **A closed room's Discord thread** is deleted 7 days after the room closes, unless a report is open.
- **The tool bridge** is roadmap only.
- **Linux** is ported after 0.4.5.

### Where each slice stands

All worktrees are detached at `6c1c940`, with a `node_modules` junction. None of this is committed or pushed.

| Slice | Worktree | State | Next |
|---|---|---|---|
| E, commit skill | `C:\wt\skill` | **Done.** Commit `bc2dc19` on `39a153d`, not pushed. | Push after the site is live, unless the owner says otherwise. Then add its TESTRUNS row (draft in the session scratchpad: `row-skill.md`). |
| S3, row-delta pushes | `C:\wt\s3-rows` | New `scripts/row-push.cjs` and `tests/row_push.test.mjs`; changes to main.cjs, preload.cjs (`mergeRows`, `eyes:progress`, `eyes:rows-sync`), and the board_gateway, host_push_batching, module_purity and preload_fanout tests (+713/−37). S4 consumers not started. | Run its suites, then S4 (tasks.js progress, the `eyes:backlog` push, agent-brain.js taking rows from onTasks). Measure push bytes. |
| S1, settings cache + startup marks | `C:\wt\s1-boot` | New `scripts/settings-cache.cjs`, `scripts/startup-marks.cjs`, `renderer/startup-marks.js`, and three test files; edits to main.cjs, preload.cjs, booklet.js, build-booklet.mjs, booklet_build, module_purity, and `tools/benchmark_startup.py` (stopped in the benchmark edits). | Finish the benchmark so it recognises Vibe. The new renderer file needs **all 7 registrations**; check `tools/test_mefi_studio_updater.py` and the template. Then run the tests. |
| S12 + S14a, live CLI progress + prompt caching | `C:\wt\s12-cli` | New `scripts/cli-stream.cjs` and `scripts/prompt-cache.cjs`; edits to main.cjs, agent-tools.cjs, executor-core.cjs, executor-resume.cjs and task-oversight.cjs (+205/−54). No tests yet; it stopped just before running the suites. | Write the cli_stream and prompt-cache tests, fix the pins (executor_core, executor_builder_cli, agent_tools), check the prompt order. The co-work session waits for this slice before its subscription-first routing; message it when it lands. |
| S2 + S15, local dirs + archive + log core | `C:\wt\s2-log` | New `scripts/local-dirs.cjs`, `scripts/segment-archive.cjs` and `scripts/log-core.cjs`; main.cjs "Log core" block half written (+26/−5). No tests, and Trace "Load older" not started. | Tests for all three (crash at each seal step, torn line, month rollover, zcat round trip), finish the block, then Trace. |
| FH2 + FH3, fair queue + YouTube metadata (bot repo) | `C:\wt\fh2-queue` (hub worktree off `61b1deb`) | New `src/rooms/queue.mjs` (1,143 lines; the core works) and `src/media/youtube.mjs` (605 lines). No tests yet. | `test/rooms-queue.test.mjs` with the plan's 26 scenarios, and `test/media-youtube.test.mjs` with a fake fetch. Wire config only after the perks session's push. |

Landing recipe for each slice:
1. Rebase onto the current `origin/main`. At the time of writing it is `5732ceb`: the Discord remote changed main.cjs (chat-path remote gate, a "Discord remote" block), preload.cjs (remote*) and hub-client.cjs, so expect conflicts there.
2. Run `npm run build-booklet`, `check`, `lint`, `audit` and the full `npm test`.
3. Commit with explicit paths, and add a TESTRUNS row through `scripts/append-testruns-row.mjs`.
4. From the gated worktree, run `git push origin HEAD:main` (fast-forward only), because the shared checkout is dirty with other sessions' work.
5. Remove the junction with `rmdir` before `git worktree remove`.

### Still to build (plan section J; wave numbers from the plan)

- **Wave 2:**
  - S4 push consumers; S5 journal store (in a worker thread); S14b dispatch path; S16–S17 ledgers; S18 dev-logs (archive the 966 MB `tools/logs`); C2 and C4 launch path.
  - The gate steps become `snapshot`, `view` and `fonts`, plus `tree` only when Command is home.
  - `studio:bootSnapshot` with a `bootSnapshotParts` registry; the loading-screen session adds `art` there.
  - FH0 hub reconcile and FH1 protocol v2 (it keeps the remote frames from `docs/remote.md` unchanged); FS1 hub client v2; F3 Configuration indexes the setup-helper records.
- **Wave 3:** S6 journal host and run transcripts; S9 run-file cap (≤64 KB); FH4 queue service; FH5 lobby; FH6 friends; FH8 room lifecycle and the 7-day deletion job; FS3 Friends section; F1 reachability test.
- **Wave 4:** S7 board offload; S10 `studio_history` tool; FH7 signed links; FH9 cursor and tree relay; FH10 bot routes (use the perks session's `createChatService`: direct, opt-in, never fed room messages); FS4/FS5 lobby and queue UI; FS6 People.
- **Wave 5:** S8 logs field; S11 commit index and GitHub monitor; S13 resume with a delta; C5 code cache; FS2 deep links (plus `join.html` on gh-pages); FS7 tree and cursors; FS8 project rooms; FS9 bot panel; FS10 same-Wi-Fi link; FS11 vault pairing v2; guest passes.
- **Wave 6:** a soak day with 3–5 builders, before-and-after numbers, the Friends end-to-end tests on two PCs, then release 0.4.5 (plan section J, "Release 0.4.5").

### Held by other sessions (don't edit their files)

- **The public site** ("Continuing fixes"): it is rebuilding gh-pages in `C:\wt\site` and publishing now, not tied to 0.4.5. gh-pages was still `3fdf4b9` at 13:10.
- **The boot fade and release, C3** ("App loading screen animation"): boot.js, startup.js, the #boot-layer markup and the boot CSS.
- **GPU and paint cost** ("In-app performance"): vibe.css, the glass/material tokens in styles.css, and idle.js frame pacing.
- **The bot repo** has a set order:
  1. "Discord community perks and verification" pushes its integrator commit first (chat, persona, memory, fun, releases, models-watch).
  2. Then the co-work session's `remote-dms` branch (in `C:\wt\veb-remote`).
  3. Then FH0/FH1, rebased on both.
  
  The model-reviews session also waits on that push. FH2/FH3 touch new files only.

### The owner's to-do list (it unblocks Friends 2.0 and the release)

1. Say where the hub copy with the **companion relay** lives. It isn't on GitHub, so it's probably on the hub PC. Or approve rebuilding it.
2. **Discord:**
   - Create the "Mefi Studio Link" app: a public client with redirects `127.0.0.1:53134–53136`.
   - Give the bot these permissions:
     - View Channel;
     - Send Messages, including in threads;
     - Read Message History;
     - Create Private Threads;
     - Manage Threads;
     - Manage Webhooks.
   - Create a Lobby category with 3 text channels, and share their ids and names.
3. A **YouTube Data API v3 key** in the hub's `.env` (`YOUTUBE_API_KEY`).
4. The hub's **tunnel address** (`hub.<domain>`), and a backup of `DATA_DIR`.
5. Run `gh auth refresh -s workflow`.

## 2. Left for the owner: Batch 3, one page frame

The menu polish pass is on main. The "Continuing fixes" session finished it in six commits, from "One two-step confirm and one plain error sentence for every menu" to "Rooms: plain connection errors, two-step Close, Leave and Delete".

The tab pages (Performance, Usage, Context, Model catalog, Settings, Activity) sit in a centred column at most 1,560 px wide, with the 84 px tree strip (`#tree-rail`) at the right edge. The sheets use a full-width 64 px header band. The plan was to:
- hide `#tree-rail` outside Command and drop its padding (`styles.css` `--rail-gap`, section 10);
- give the tab pages and Agent brain the sheets' header band and content edge;
- keep one Settings category nav (Appearance swaps to pills today).

It wasn't done, because the first step contradicts a pinned contract: `tests/fixtures/command-render-electron.cjs` asserts "visible rail resumes painting" on the Model catalog page.
- Decide whether the tree strip should stay on tab pages. If it goes, change that assertion with it.
- Either way, capture before and after (the seeded fake-bridge preview at 1920x1080).
- Leave `styles.css` ~4833 (the `data-nav-section` padding) and the `studio-ui.css` `@media (max-height: 600px)` rail block alone.

Remove this section once that is decided, and delete the file when both sections are done.
